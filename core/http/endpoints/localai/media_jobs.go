package localai

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/P3X-118/LocalAI/core/application"
	"github.com/P3X-118/LocalAI/core/schema"
	"github.com/P3X-118/LocalAI/core/services"
)

// mediaTypeFromPath maps the route's :type param to a MediaType.
func mediaTypeFromPath(t string) (schema.MediaType, error) {
	switch t {
	case "image", "images":
		return schema.MediaImage, nil
	case "video", "videos":
		return schema.MediaVideo, nil
	case "tts", "audio_tts", "speech":
		return schema.MediaAudioTTS, nil
	case "sound", "audio_sound":
		return schema.MediaAudioSound, nil
	}
	return "", fmt.Errorf("unsupported media type: %s", t)
}

// modelFromRequestBody extracts the `model` field from the raw JSON body
// without requiring the full schema struct (different shapes per media type).
func modelFromRequestBody(body []byte) string {
	var probe struct {
		Model   string `json:"model"`
		ModelID string `json:"model_id"`
	}
	_ = json.Unmarshal(body, &probe)
	if probe.Model != "" {
		return probe.Model
	}
	return probe.ModelID
}

// EnqueueMediaJobEndpoint accepts the same request body as the sync media
// endpoint of the given :type, but returns immediately with a job record
// (queued). A background worker calls the sync endpoint via loopback; the
// resulting MediaArtifact ID is set on the job on completion.
func EnqueueMediaJobEndpoint(app *application.Application) echo.HandlerFunc {
	return func(c echo.Context) error {
		mediaType, err := mediaTypeFromPath(c.Param("type"))
		if err != nil {
			return c.JSON(http.StatusBadRequest, map[string]any{
				"error": map[string]string{"message": err.Error()},
			})
		}
		body, err := io.ReadAll(c.Request().Body)
		if err != nil || len(body) == 0 {
			return c.JSON(http.StatusBadRequest, map[string]any{
				"error": map[string]string{"message": "empty request body"},
			})
		}
		model := modelFromRequestBody(body)
		userID := services.RequestUserID(c)

		job, err := app.MediaJobService().Enqueue(userID, mediaType, model, body)
		if err != nil {
			status := http.StatusInternalServerError
			if job != nil {
				status = http.StatusTooManyRequests
			}
			return c.JSON(status, map[string]any{
				"error": map[string]string{"message": err.Error()},
				"job":   job,
			})
		}
		return c.JSON(http.StatusAccepted, job)
	}
}

// ListMediaJobsEndpoint returns the caller's recent jobs.
//
//	?limit=50&offset=0
func ListMediaJobsEndpoint(app *application.Application) echo.HandlerFunc {
	return func(c echo.Context) error {
		userID := services.RequestUserID(c)
		limit, _ := strconv.Atoi(c.QueryParam("limit"))
		offset, _ := strconv.Atoi(c.QueryParam("offset"))
		jobs := app.MediaJobService().List(userID, limit, offset)
		return c.JSON(http.StatusOK, map[string]any{
			"items": jobs,
			"count": len(jobs),
		})
	}
}

// GetMediaJobEndpoint returns a single job snapshot.
func GetMediaJobEndpoint(app *application.Application) echo.HandlerFunc {
	return func(c echo.Context) error {
		userID := services.RequestUserID(c)
		id := c.Param("id")
		j := app.MediaJobService().Get(userID, id)
		if j == nil {
			return c.JSON(http.StatusNotFound, map[string]any{
				"error": map[string]string{"message": "not found"},
			})
		}
		return c.JSON(http.StatusOK, j)
	}
}

// CancelMediaJobEndpoint marks the job cancelled (and signals any running
// worker to abort). 200 ok if cancelled, 404 if missing.
func CancelMediaJobEndpoint(app *application.Application) echo.HandlerFunc {
	return func(c echo.Context) error {
		userID := services.RequestUserID(c)
		id := c.Param("id")
		if ok := app.MediaJobService().Cancel(userID, id); !ok {
			return c.JSON(http.StatusNotFound, map[string]any{
				"error": map[string]string{"message": "not found"},
			})
		}
		return c.JSON(http.StatusOK, map[string]any{"status": "cancelled"})
	}
}

// SSEMediaJobEndpoint streams every status transition of one job as
// Server-Sent Events. The client should reconnect on transport errors and use
// the final "status: completed|failed|cancelled" event to stop listening.
func SSEMediaJobEndpoint(app *application.Application) echo.HandlerFunc {
	return func(c echo.Context) error {
		userID := services.RequestUserID(c)
		id := c.Param("id")

		// Initial snapshot — emit immediately so the client knows the current
		// state even if no transitions happen.
		initial := app.MediaJobService().Get(userID, id)
		if initial == nil {
			return c.JSON(http.StatusNotFound, map[string]any{
				"error": map[string]string{"message": "not found"},
			})
		}

		c.Response().Header().Set("Content-Type", "text/event-stream")
		c.Response().Header().Set("Cache-Control", "no-cache")
		c.Response().Header().Set("Connection", "keep-alive")
		c.Response().WriteHeader(http.StatusOK)

		write := func(j *schema.MediaJob) error {
			b, _ := json.Marshal(j)
			if _, err := fmt.Fprintf(c.Response(), "event: status\ndata: %s\n\n", b); err != nil {
				return err
			}
			c.Response().Flush()
			return nil
		}

		if err := write(initial); err != nil {
			return nil
		}
		// If the job is already terminal, no point subscribing.
		if isTerminal(initial.Status) {
			return nil
		}

		ch := app.MediaJobService().Subscribe(id)
		defer app.MediaJobService().Unsubscribe(id, ch)

		// Heartbeat ticker so proxies don't close the connection.
		tick := time.NewTicker(15 * time.Second)
		defer tick.Stop()

		for {
			select {
			case <-c.Request().Context().Done():
				return nil
			case ev, ok := <-ch:
				if !ok {
					return nil
				}
				// Defensive scope check (subscriber list is per-job not per-user).
				if ev.UserID != "" && ev.UserID != userID {
					continue
				}
				j := ev
				if err := write(&j); err != nil {
					return nil
				}
				if isTerminal(ev.Status) {
					return nil
				}
			case <-tick.C:
				if _, err := fmt.Fprintf(c.Response(), ": ping\n\n"); err != nil {
					return nil
				}
				c.Response().Flush()
			}
		}
	}
}

func isTerminal(s schema.MediaJobStatus) bool {
	switch s {
	case schema.MediaJobCompleted, schema.MediaJobFailed, schema.MediaJobCancelled:
		return true
	}
	return false
}
