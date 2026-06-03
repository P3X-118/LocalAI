package localai

import (
	"net/http"
	"strconv"

	"github.com/labstack/echo/v4"
	"github.com/P3X-118/LocalAI/core/application"
	"github.com/P3X-118/LocalAI/core/schema"
	"github.com/P3X-118/LocalAI/core/services"
)

// ListGenerationsEndpoint returns the caller's generated-media history. Filters:
//
//	?type=image|video|audio_tts|audio_sound  (optional — defaults to all)
//	?limit=50                                (optional, 0 = no limit)
//	?offset=0                                (optional)
func ListGenerationsEndpoint(app *application.Application) echo.HandlerFunc {
	return func(c echo.Context) error {
		userID := services.RequestUserID(c)
		mediaType := schema.MediaType(c.QueryParam("type"))
		limit, _ := strconv.Atoi(c.QueryParam("limit"))
		offset, _ := strconv.Atoi(c.QueryParam("offset"))

		items, err := app.MediaHistory().List(userID, mediaType, limit, offset)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]any{
				"error": map[string]string{"message": err.Error()},
			})
		}
		return c.JSON(http.StatusOK, map[string]any{
			"items": items,
			"count": len(items),
		})
	}
}

// GetGenerationEndpoint returns one artifact by ID, scoped to the caller.
func GetGenerationEndpoint(app *application.Application) echo.HandlerFunc {
	return func(c echo.Context) error {
		userID := services.RequestUserID(c)
		id := c.Param("id")
		a, err := app.MediaHistory().Get(userID, id)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]any{
				"error": map[string]string{"message": err.Error()},
			})
		}
		if a == nil {
			return c.JSON(http.StatusNotFound, map[string]any{
				"error": map[string]string{"message": "not found"},
			})
		}
		return c.JSON(http.StatusOK, a)
	}
}

// DeleteGenerationEndpoint removes both the artifact and its sidecar.
// Idempotent: returns 200 with status=ok even if the record was already gone.
func DeleteGenerationEndpoint(app *application.Application) echo.HandlerFunc {
	return func(c echo.Context) error {
		userID := services.RequestUserID(c)
		id := c.Param("id")
		if err := app.MediaHistory().Delete(userID, id); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]any{
				"error": map[string]string{"message": err.Error()},
			})
		}
		return c.JSON(http.StatusOK, map[string]any{"status": "ok"})
	}
}
