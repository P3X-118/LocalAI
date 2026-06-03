package schema

import (
	"encoding/json"
	"time"
)

// MediaJobStatus is the lifecycle state of a background media-generation job.
type MediaJobStatus string

const (
	MediaJobQueued    MediaJobStatus = "queued"
	MediaJobRunning   MediaJobStatus = "running"
	MediaJobCompleted MediaJobStatus = "completed"
	MediaJobFailed    MediaJobStatus = "failed"
	MediaJobCancelled MediaJobStatus = "cancelled"
)

// MediaJob is the persistent record for an asynchronous generation request.
// Written to `{StateDir}/media_jobs/<id>.json` on every status transition.
//
// When the job finishes successfully the worker writes a MediaArtifact sidecar
// next to the produced file *and* sets ArtifactID on the job so clients can
// jump from the job-status response straight into the history record.
type MediaJob struct {
	ID          string          `json:"id"`
	UserID      string          `json:"user_id"`
	Type        MediaType       `json:"type"`
	Model       string          `json:"model"`
	Status      MediaJobStatus  `json:"status"`
	Request     json.RawMessage `json:"request"` // original API payload (for replay/debug)
	Progress    float64         `json:"progress"` // 0..1 if backend reports steps; else 0 until completion
	Error       string          `json:"error,omitempty"`
	CreatedAt   time.Time       `json:"created_at"`
	StartedAt   *time.Time      `json:"started_at,omitempty"`
	CompletedAt *time.Time      `json:"completed_at,omitempty"`
	ArtifactID  string          `json:"artifact_id,omitempty"` // points to MediaArtifact.ID once completed
	ArtifactURL string          `json:"artifact_url,omitempty"`
}
