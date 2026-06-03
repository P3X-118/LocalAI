package services

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/P3X-118/LocalAI/core/config"
	"github.com/P3X-118/LocalAI/core/http/auth"
	"github.com/P3X-118/LocalAI/core/schema"
	"github.com/mudler/xlog"
)

// RequestUserID extracts a stable user identifier from the incoming Echo
// request. Resolution order:
//
//	1. X-LocalAI-User header — set by the in-process job worker so async
//	   sync-loopback calls land under the originating user.
//	2. auth.GetUser(c) — the user record set by the auth middleware.
//	3. "legacy-api-key" — the fallback the agent pool uses when only the
//	   legacy LOCALAI_API_KEY bearer is present and no user record exists.
//
// Returning a stable non-empty string makes the sidecar files queryable.
func RequestUserID(c echo.Context) string {
	if c == nil {
		return "legacy-api-key"
	}
	if h := c.Request().Header.Get("X-LocalAI-User"); h != "" {
		return h
	}
	if u := auth.GetUser(c); u != nil && u.ID != "" {
		return u.ID
	}
	return "legacy-api-key"
}

// MediaHistory writes and reads `<artifact>.json` sidecar metadata next to
// every generated image / video / audio file.
//
// Persistence is intentionally dumb: one JSON file per artifact, sitting on
// the same bind-mounted disk as the artifact itself. That way:
//   - No schema migrations as the metadata shape evolves.
//   - Deleting an artifact (rm output.png) leaves a stale sidecar that the
//     lister skips gracefully.
//   - Backups of `./images`/`./videos`/`./audio` already capture history.
type MediaHistory struct {
	appConfig *config.ApplicationConfig
	mu        sync.Mutex // guards filesystem writes; reads are stateless
}

func NewMediaHistory(appConfig *config.ApplicationConfig) *MediaHistory {
	return &MediaHistory{appConfig: appConfig}
}

// Write atomically saves a sidecar next to artifact.OutputPath. The sidecar
// path is "<OutputPath>.json". If artifact.ID is empty a UUID is assigned.
func (h *MediaHistory) Write(a *schema.MediaArtifact) error {
	if a == nil || a.OutputPath == "" {
		return fmt.Errorf("media history: artifact missing output_path")
	}
	if a.ID == "" {
		a.ID = uuid.New().String()
	}

	sidecar := a.OutputPath + ".json"
	tmp := sidecar + ".tmp"

	h.mu.Lock()
	defer h.mu.Unlock()

	body, err := json.MarshalIndent(a, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(tmp, body, 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, sidecar); err != nil {
		os.Remove(tmp)
		return err
	}
	xlog.Debug("media history sidecar written", "path", sidecar, "id", a.ID, "type", a.Type)
	return nil
}

// List returns artifacts filtered by user and (optionally) media type, newest
// first. limit==0 means "all". offset is applied after sort.
func (h *MediaHistory) List(userID string, mediaType schema.MediaType, limit, offset int) ([]schema.MediaArtifact, error) {
	dirs := h.dirsForType(mediaType)
	out := make([]schema.MediaArtifact, 0, 64)
	for _, dir := range dirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, err
		}
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
				continue
			}
			a, err := h.readSidecar(filepath.Join(dir, e.Name()))
			if err != nil {
				xlog.Debug("media history: skipping unreadable sidecar", "path", e.Name(), "err", err)
				continue
			}
			if userID != "" && a.UserID != userID {
				continue
			}
			if mediaType != "" && a.Type != mediaType {
				continue
			}
			out = append(out, a)
		}
	}

	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })

	if offset >= len(out) {
		return []schema.MediaArtifact{}, nil
	}
	out = out[offset:]
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

// Get returns a single artifact by ID, scoped to userID (pass "" to skip
// the scope check — admins). Returns nil, nil if not found.
func (h *MediaHistory) Get(userID, id string) (*schema.MediaArtifact, error) {
	all, err := h.List(userID, "", 0, 0)
	if err != nil {
		return nil, err
	}
	for i := range all {
		if all[i].ID == id {
			return &all[i], nil
		}
	}
	return nil, nil
}

// Delete removes both the artifact file and its sidecar. Scoped to userID.
// Returns nil if the record doesn't exist (idempotent).
func (h *MediaHistory) Delete(userID, id string) error {
	a, err := h.Get(userID, id)
	if err != nil {
		return err
	}
	if a == nil {
		return nil
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	// Remove artifact + sidecar; tolerate either missing.
	_ = os.Remove(a.OutputPath)
	_ = os.Remove(a.OutputPath + ".json")
	xlog.Info("media history: deleted", "id", id, "user", userID, "path", a.OutputPath)
	return nil
}

func (h *MediaHistory) dirsForType(mediaType schema.MediaType) []string {
	root := h.appConfig.GeneratedContentDir
	if root == "" {
		root = "/tmp/generated"
	}
	switch mediaType {
	case schema.MediaImage:
		return []string{filepath.Join(root, "images")}
	case schema.MediaVideo:
		return []string{filepath.Join(root, "videos")}
	case schema.MediaAudioTTS, schema.MediaAudioSound:
		return []string{filepath.Join(root, "audio")}
	}
	// "" → scan all
	return []string{
		filepath.Join(root, "images"),
		filepath.Join(root, "videos"),
		filepath.Join(root, "audio"),
	}
}

// DirsForType returns the directories the sidecar lister scans for a given
// media type. Exported so the job service can sample mtimes to detect
// newly-produced artifacts.
func (h *MediaHistory) DirsForType(t schema.MediaType) []string { return h.dirsForType(t) }

func (h *MediaHistory) readSidecar(path string) (schema.MediaArtifact, error) {
	var a schema.MediaArtifact
	data, err := os.ReadFile(path)
	if err != nil {
		return a, err
	}
	if err := json.Unmarshal(data, &a); err != nil {
		return a, err
	}
	if a.ID == "" {
		return a, fmt.Errorf("sidecar missing id")
	}
	return a, nil
}
