package schema

import "time"

// MediaType identifies what kind of generated artifact this is. The string
// values match the on-disk directory and the React UI tab names.
type MediaType string

const (
	MediaImage      MediaType = "image"
	MediaVideo      MediaType = "video"
	MediaAudioTTS   MediaType = "audio_tts"
	MediaAudioSound MediaType = "audio_sound"
)

// MediaArtifact is the persistent record written next to every generated
// image / video / audio file as a `<file>.json` sidecar. Reading these
// sidecars back is how the React UI builds the Generations history page.
//
// Designed so the same struct describes both sync-handler outputs (Phase 1)
// and async job outputs (Phase 2 — the job worker writes the same shape).
type MediaArtifact struct {
	ID             string         `json:"id"`
	UserID         string         `json:"user_id"`
	Type           MediaType      `json:"type"`
	Model          string         `json:"model"`
	Prompt         string         `json:"prompt"`
	NegativePrompt string         `json:"negative_prompt,omitempty"`
	Params         map[string]any `json:"params,omitempty"`
	CreatedAt      time.Time      `json:"created_at"`
	DurationMs     int64          `json:"duration_ms"`
	OutputPath     string         `json:"output_path"`           // absolute path inside container
	OutputURL      string         `json:"output_url,omitempty"`  // /generated-*/... if served
	RequestID      string         `json:"request_id,omitempty"`
	JobID          string         `json:"job_id,omitempty"`      // set when produced via async job
}
