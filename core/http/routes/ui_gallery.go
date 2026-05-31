package routes

import (
	"github.com/labstack/echo/v4"
	"github.com/P3X-118/LocalAI/core/config"
	"github.com/P3X-118/LocalAI/core/services"
)

func registerGalleryRoutes(app *echo.Echo, cl *config.ModelConfigLoader, appConfig *config.ApplicationConfig, galleryService *services.GalleryService, opcache *services.OpCache) {
	// Gallery routes are now handled by the React SPA at /app/browse
	// This function is kept for backward compatibility but no longer registers routes
	// (routes are registered directly in RegisterUIRoutes)
}
