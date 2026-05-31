package routes

import (
	"github.com/labstack/echo/v4"
	"github.com/P3X-118/LocalAI/core/config"
	"github.com/P3X-118/LocalAI/core/http/endpoints/jina"
	"github.com/P3X-118/LocalAI/core/http/middleware"
	"github.com/P3X-118/LocalAI/core/schema"

	"github.com/P3X-118/LocalAI/pkg/model"
)

func RegisterJINARoutes(app *echo.Echo,
	re *middleware.RequestExtractor,
	cl *config.ModelConfigLoader,
	ml *model.ModelLoader,
	appConfig *config.ApplicationConfig) {

	// POST endpoint to mimic the reranking
	rerankHandler := jina.JINARerankEndpoint(cl, ml, appConfig)
	app.POST("/v1/rerank",
		rerankHandler,
		re.BuildFilteredFirstAvailableDefaultModel(config.BuildUsecaseFilterFn(config.FLAG_RERANK)),
		re.SetModelAndConfig(func() schema.LocalAIRequest { return new(schema.JINARerankRequest) }))
}
