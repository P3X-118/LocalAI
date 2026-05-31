package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/P3X-118/LocalAI/core/config"
	"github.com/P3X-118/LocalAI/core/schema"
	"github.com/mudler/xlog"
)

// mediaJobWorkers is how many concurrent generations the background queue
// will run. Heavy GPU pipelines (SDXL/video) don't parallelize well on a
// single Tegra iGPU, so the default is small. Override via LOCALAI_MEDIA_JOB_WORKERS.
const defaultMediaJobWorkers = 2
const mediaJobQueueBuffer = 64

// MediaJobService runs media-generation requests asynchronously. The async
// API (POST /api/generations/:type) enqueues; workers POST to the sync OpenAI
// endpoints on localhost (reusing all model-loading / middleware logic), then
// the MediaHistory service writes the sidecar next to the produced artifact.
type MediaJobService struct {
	appConfig *config.ApplicationConfig
	history   *MediaHistory

	mu        sync.RWMutex
	jobs      map[string]*schema.MediaJob // in-memory mirror of {StateDir}/media_jobs/*.json

	queue     chan string // job IDs awaiting a worker
	cancels   map[string]context.CancelFunc

	subsMu sync.Mutex
	subs   map[string]map[chan schema.MediaJob]struct{} // jobID → subscribers

	workers int

	ctx       context.Context
	cancelAll context.CancelFunc
}

func NewMediaJobService(appConfig *config.ApplicationConfig, history *MediaHistory) *MediaJobService {
	workers := defaultMediaJobWorkers
	if v := os.Getenv("LOCALAI_MEDIA_JOB_WORKERS"); v != "" {
		var n int
		if _, err := fmt.Sscanf(v, "%d", &n); err == nil && n > 0 {
			workers = n
		}
	}
	return &MediaJobService{
		appConfig: appConfig,
		history:   history,
		jobs:      make(map[string]*schema.MediaJob),
		queue:     make(chan string, mediaJobQueueBuffer),
		cancels:   make(map[string]context.CancelFunc),
		subs:      make(map[string]map[chan schema.MediaJob]struct{}),
		workers:   workers,
	}
}

// Start hydrates from disk and launches workers. Safe to call once.
func (s *MediaJobService) Start(parent context.Context) error {
	s.ctx, s.cancelAll = context.WithCancel(parent)

	dir := s.jobsDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}

	// Re-load any persisted jobs. Anything still "queued" or "running" at
	// startup is poisoned (we crashed mid-flight) — mark failed so the
	// client sees a definite outcome instead of forever-running.
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		j, err := s.readJob(filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		if j.Status == schema.MediaJobQueued || j.Status == schema.MediaJobRunning {
			j.Status = schema.MediaJobFailed
			j.Error = "service restarted mid-job"
			now := time.Now().UTC()
			j.CompletedAt = &now
			_ = s.writeJob(j)
		}
		s.mu.Lock()
		s.jobs[j.ID] = j
		s.mu.Unlock()
	}

	for i := 0; i < s.workers; i++ {
		go s.workerLoop(i)
	}
	xlog.Info("media job service started", "workers", s.workers, "dir", dir)
	return nil
}

// Enqueue creates a new job, persists it, returns immediately with the job.
// The worker will POST to the OpenAI-compatible sync endpoint on localhost.
func (s *MediaJobService) Enqueue(userID string, mediaType schema.MediaType, model string, request json.RawMessage) (*schema.MediaJob, error) {
	if model == "" {
		return nil, fmt.Errorf("model is required")
	}
	job := &schema.MediaJob{
		ID:        uuid.New().String(),
		UserID:    userID,
		Type:      mediaType,
		Model:     model,
		Status:    schema.MediaJobQueued,
		Request:   request,
		CreatedAt: time.Now().UTC(),
	}
	if err := s.writeJob(job); err != nil {
		return nil, err
	}
	s.mu.Lock()
	s.jobs[job.ID] = job
	s.mu.Unlock()

	select {
	case s.queue <- job.ID:
	default:
		// Queue full — fail fast rather than block API.
		s.transition(job.ID, func(j *schema.MediaJob) {
			j.Status = schema.MediaJobFailed
			j.Error = "queue full; retry later"
			now := time.Now().UTC()
			j.CompletedAt = &now
		})
		return s.snapshot(job.ID), fmt.Errorf("media job queue full")
	}
	return job, nil
}

// Get returns a snapshot of the job. Scoped to userID; pass "" to skip.
func (s *MediaJobService) Get(userID, id string) *schema.MediaJob {
	s.mu.RLock()
	j, ok := s.jobs[id]
	s.mu.RUnlock()
	if !ok {
		return nil
	}
	if userID != "" && j.UserID != userID {
		return nil
	}
	c := *j
	return &c
}

// List returns user-scoped jobs sorted newest-first.
func (s *MediaJobService) List(userID string, limit, offset int) []schema.MediaJob {
	s.mu.RLock()
	out := make([]schema.MediaJob, 0, len(s.jobs))
	for _, j := range s.jobs {
		if userID != "" && j.UserID != userID {
			continue
		}
		out = append(out, *j)
	}
	s.mu.RUnlock()
	sort.Slice(out, func(i, k int) bool { return out[i].CreatedAt.After(out[k].CreatedAt) })
	if offset >= len(out) {
		return []schema.MediaJob{}
	}
	out = out[offset:]
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out
}

// Cancel marks the job as cancelled (or signals a running worker to abort).
// Returns true if the job exists and we transitioned it.
func (s *MediaJobService) Cancel(userID, id string) bool {
	s.mu.Lock()
	j, ok := s.jobs[id]
	if !ok || (userID != "" && j.UserID != userID) {
		s.mu.Unlock()
		return false
	}
	cancel := s.cancels[id]
	s.mu.Unlock()

	if cancel != nil {
		cancel() // worker sees ctx.Err on next backend call
	}
	s.transition(id, func(j *schema.MediaJob) {
		if j.Status == schema.MediaJobCompleted || j.Status == schema.MediaJobFailed {
			return
		}
		j.Status = schema.MediaJobCancelled
		now := time.Now().UTC()
		j.CompletedAt = &now
	})
	return true
}

// Subscribe returns a channel that receives every status transition of the
// given job, until the caller calls Unsubscribe(jobID, ch) or the job ends.
func (s *MediaJobService) Subscribe(jobID string) chan schema.MediaJob {
	ch := make(chan schema.MediaJob, 4)
	s.subsMu.Lock()
	if s.subs[jobID] == nil {
		s.subs[jobID] = make(map[chan schema.MediaJob]struct{})
	}
	s.subs[jobID][ch] = struct{}{}
	s.subsMu.Unlock()
	return ch
}

func (s *MediaJobService) Unsubscribe(jobID string, ch chan schema.MediaJob) {
	s.subsMu.Lock()
	if set, ok := s.subs[jobID]; ok {
		delete(set, ch)
	}
	s.subsMu.Unlock()
	close(ch)
}

func (s *MediaJobService) workerLoop(idx int) {
	xlog.Debug("media job worker started", "idx", idx)
	for {
		select {
		case <-s.ctx.Done():
			return
		case id := <-s.queue:
			s.runJob(id)
		}
	}
}

func (s *MediaJobService) runJob(id string) {
	j := s.snapshot(id)
	if j == nil || j.Status != schema.MediaJobQueued {
		return
	}
	ctx, cancel := context.WithCancel(s.ctx)
	s.mu.Lock()
	s.cancels[id] = cancel
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.cancels, id)
		s.mu.Unlock()
		cancel()
	}()

	now := time.Now().UTC()
	s.transition(id, func(j *schema.MediaJob) {
		j.Status = schema.MediaJobRunning
		j.StartedAt = &now
	})

	// Loopback POST to the OpenAI-compatible sync endpoint. The sync handler
	// already writes the sidecar (Phase 1) so we just need to pluck the
	// resulting artifact ID out of the latest sidecar in that type's dir.
	urlPath, err := endpointPathForMediaType(j.Type)
	if err != nil {
		s.fail(id, err)
		return
	}

	beforeMtime := newestSidecarMtime(s.history.DirsForType(j.Type))

	respBody, err := s.loopbackPost(ctx, urlPath, j.Request, j.UserID)
	if err != nil {
		s.fail(id, err)
		return
	}

	// Find the new sidecar (created since `beforeMtime`) and link it to the job.
	artifactID, artifactURL := findNewSidecar(s.history.DirsForType(j.Type), beforeMtime, j.UserID)
	completed := time.Now().UTC()
	s.transition(id, func(j *schema.MediaJob) {
		j.Status = schema.MediaJobCompleted
		j.CompletedAt = &completed
		j.Progress = 1.0
		j.ArtifactID = artifactID
		j.ArtifactURL = artifactURL
	})
	xlog.Debug("media job completed", "id", id, "artifact", artifactID, "bytes", len(respBody))
}

func (s *MediaJobService) loopbackPost(ctx context.Context, urlPath string, body json.RawMessage, userID string) ([]byte, error) {
	addr := s.appConfig.ApiKeys // re-use; first key is used for self-auth
	// Build URL: localhost + LOCALAI_ADDRESS port
	host := "127.0.0.1"
	port := "8080"
	if a := os.Getenv("LOCALAI_ADDRESS"); a != "" {
		if i := strings.LastIndex(a, ":"); i >= 0 {
			port = a[i+1:]
		}
	}
	u := fmt.Sprintf("http://%s:%s%s", host, port, urlPath)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if len(addr) > 0 {
		req.Header.Set("Authorization", "Bearer "+addr[0])
	}
	// Pass the originating user so the sync handler writes the sidecar under
	// the right user_id.
	if userID != "" {
		req.Header.Set("X-LocalAI-User", userID)
	}

	cli := &http.Client{Timeout: 30 * time.Minute}
	resp, err := cli.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		excerpt := b
		if len(excerpt) > 300 {
			excerpt = excerpt[:300]
		}
		return b, fmt.Errorf("loopback %s returned %d: %s", urlPath, resp.StatusCode, string(excerpt))
	}
	return b, nil
}

func endpointPathForMediaType(t schema.MediaType) (string, error) {
	switch t {
	case schema.MediaImage:
		return "/v1/images/generations", nil
	case schema.MediaVideo:
		return "/video", nil
	case schema.MediaAudioTTS:
		return "/v1/audio/speech", nil
	case schema.MediaAudioSound:
		return "/v1/sound-generation", nil
	}
	return "", fmt.Errorf("unsupported media type: %s", t)
}

func newestSidecarMtime(dirs []string) time.Time {
	var newest time.Time
	for _, dir := range dirs {
		entries, _ := os.ReadDir(dir)
		for _, e := range entries {
			if !strings.HasSuffix(e.Name(), ".json") {
				continue
			}
			info, err := e.Info()
			if err != nil {
				continue
			}
			if info.ModTime().After(newest) {
				newest = info.ModTime()
			}
		}
	}
	return newest
}

func findNewSidecar(dirs []string, after time.Time, userID string) (string, string) {
	type cand struct {
		id, url string
		mtime   time.Time
	}
	var best cand
	for _, dir := range dirs {
		entries, _ := os.ReadDir(dir)
		for _, e := range entries {
			if !strings.HasSuffix(e.Name(), ".json") {
				continue
			}
			info, err := e.Info()
			if err != nil || !info.ModTime().After(after) {
				continue
			}
			data, err := os.ReadFile(filepath.Join(dir, e.Name()))
			if err != nil {
				continue
			}
			var a schema.MediaArtifact
			if err := json.Unmarshal(data, &a); err != nil {
				continue
			}
			if userID != "" && a.UserID != userID {
				continue
			}
			if info.ModTime().After(best.mtime) {
				best = cand{id: a.ID, url: a.OutputURL, mtime: info.ModTime()}
			}
		}
	}
	return best.id, best.url
}

func (s *MediaJobService) fail(id string, err error) {
	xlog.Warn("media job failed", "id", id, "err", err)
	now := time.Now().UTC()
	s.transition(id, func(j *schema.MediaJob) {
		j.Status = schema.MediaJobFailed
		j.Error = err.Error()
		j.CompletedAt = &now
	})
}

func (s *MediaJobService) transition(id string, mut func(*schema.MediaJob)) {
	s.mu.Lock()
	j, ok := s.jobs[id]
	if !ok {
		s.mu.Unlock()
		return
	}
	mut(j)
	snap := *j
	s.mu.Unlock()

	_ = s.writeJob(&snap)
	s.broadcast(id, snap)
}

func (s *MediaJobService) broadcast(jobID string, snap schema.MediaJob) {
	s.subsMu.Lock()
	subs := s.subs[jobID]
	s.subsMu.Unlock()
	for ch := range subs {
		select {
		case ch <- snap:
		default:
		}
	}
}

func (s *MediaJobService) snapshot(id string) *schema.MediaJob {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if j, ok := s.jobs[id]; ok {
		c := *j
		return &c
	}
	return nil
}

func (s *MediaJobService) jobsDir() string {
	root := s.appConfig.GeneratedContentDir
	if root == "" {
		root = "/tmp/generated"
	}
	return filepath.Join(root, "media_jobs")
}

func (s *MediaJobService) writeJob(j *schema.MediaJob) error {
	dir := s.jobsDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	p := filepath.Join(dir, j.ID+".json")
	tmp := p + ".tmp"
	body, err := json.MarshalIndent(j, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(tmp, body, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

func (s *MediaJobService) readJob(path string) (*schema.MediaJob, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var j schema.MediaJob
	if err := json.Unmarshal(data, &j); err != nil {
		return nil, err
	}
	return &j, nil
}

