package application

import (
	"context"
	"sync"
	"sync/atomic"

	"github.com/P3X-118/LocalAI/core/config"
	mcpTools "github.com/P3X-118/LocalAI/core/http/endpoints/mcp"
	"github.com/P3X-118/LocalAI/core/services"
	"github.com/P3X-118/LocalAI/core/templates"
	"github.com/P3X-118/LocalAI/pkg/model"
	"github.com/mudler/xlog"
	"gorm.io/gorm"
)

type Application struct {
	backendLoader      *config.ModelConfigLoader
	modelLoader        *model.ModelLoader
	applicationConfig  *config.ApplicationConfig
	startupConfig      *config.ApplicationConfig // Stores original config from env vars (before file loading)
	templatesEvaluator *templates.Evaluator
	galleryService     *services.GalleryService
	agentJobService    *services.AgentJobService
	agentPoolService   atomic.Pointer[services.AgentPoolService]
	mediaHistory       *services.MediaHistory
	mediaJobService    *services.MediaJobService
	authDB             *gorm.DB
	watchdogMutex      sync.Mutex
	watchdogStop       chan bool
	p2pMutex           sync.Mutex
	p2pCtx             context.Context
	p2pCancel          context.CancelFunc
	agentJobMutex      sync.Mutex
}

func newApplication(appConfig *config.ApplicationConfig) *Application {
	ml := model.NewModelLoader(appConfig.SystemState)

	// Close MCP sessions when a model is unloaded (watchdog eviction, manual shutdown, etc.)
	ml.OnModelUnload(func(modelName string) {
		mcpTools.CloseMCPSessions(modelName)
	})

	return &Application{
		backendLoader:      config.NewModelConfigLoader(appConfig.SystemState.Model.ModelsPath),
		modelLoader:        ml,
		applicationConfig:  appConfig,
		templatesEvaluator: templates.NewEvaluator(appConfig.SystemState.Model.ModelsPath),
	}
}

func (a *Application) ModelConfigLoader() *config.ModelConfigLoader {
	return a.backendLoader
}

func (a *Application) ModelLoader() *model.ModelLoader {
	return a.modelLoader
}

func (a *Application) ApplicationConfig() *config.ApplicationConfig {
	return a.applicationConfig
}

func (a *Application) TemplatesEvaluator() *templates.Evaluator {
	return a.templatesEvaluator
}

func (a *Application) GalleryService() *services.GalleryService {
	return a.galleryService
}

func (a *Application) AgentJobService() *services.AgentJobService {
	return a.agentJobService
}

func (a *Application) AgentPoolService() *services.AgentPoolService {
	return a.agentPoolService.Load()
}

// MediaHistory returns the sidecar metadata service for generated artifacts
// (image / video / audio). Always non-nil — initialized in start().
func (a *Application) MediaHistory() *services.MediaHistory {
	return a.mediaHistory
}

// MediaJobService returns the background-job queue for media generation.
// Always non-nil — initialized in start().
func (a *Application) MediaJobService() *services.MediaJobService {
	return a.mediaJobService
}

// AuthDB returns the auth database connection, or nil if auth is not enabled.
func (a *Application) AuthDB() *gorm.DB {
	return a.authDB
}

// StartupConfig returns the original startup configuration (from env vars, before file loading)
func (a *Application) StartupConfig() *config.ApplicationConfig {
	return a.startupConfig
}

func (a *Application) start() error {
	galleryService := services.NewGalleryService(a.ApplicationConfig(), a.ModelLoader())
	err := galleryService.Start(a.ApplicationConfig().Context, a.ModelConfigLoader(), a.ApplicationConfig().SystemState)
	if err != nil {
		return err
	}

	a.galleryService = galleryService

	// Initialize agent job service
	agentJobService := services.NewAgentJobService(
		a.ApplicationConfig(),
		a.ModelLoader(),
		a.ModelConfigLoader(),
		a.TemplatesEvaluator(),
	)

	err = agentJobService.Start(a.ApplicationConfig().Context)
	if err != nil {
		return err
	}

	a.agentJobService = agentJobService

	// Media history (sidecar metadata for generated images/videos/audio) and
	// the background-job queue for async media generation. Both are cheap to
	// construct; the job service spawns its workers on Start().
	a.mediaHistory = services.NewMediaHistory(a.ApplicationConfig())
	a.mediaJobService = services.NewMediaJobService(a.ApplicationConfig(), a.mediaHistory)
	if err := a.mediaJobService.Start(a.ApplicationConfig().Context); err != nil {
		return err
	}

	return nil
}

// StartAgentPool initializes and starts the agent pool service (LocalAGI integration).
// This must be called after the HTTP server is listening, because backends like
// PostgreSQL need to call the embeddings API during collection initialization.
func (a *Application) StartAgentPool() {
	if !a.applicationConfig.AgentPool.Enabled {
		return
	}
	aps, err := services.NewAgentPoolService(a.applicationConfig)
	if err != nil {
		xlog.Error("Failed to create agent pool service", "error", err)
		return
	}
	if a.authDB != nil {
		aps.SetAuthDB(a.authDB)
	}
	if err := aps.Start(a.applicationConfig.Context); err != nil {
		xlog.Error("Failed to start agent pool", "error", err)
		return
	}

	// Wire per-user scoped services so collections, skills, and jobs are isolated per user
	usm := services.NewUserServicesManager(
		aps.UserStorage(),
		a.applicationConfig,
		a.modelLoader,
		a.backendLoader,
		a.templatesEvaluator,
	)
	aps.SetUserServicesManager(usm)

	// Load agents AFTER userServices is wired, so each agent's KB resolves against
	// its owner's per-user collections at construction time (see StartAgents).
	aps.StartAgents()

	a.agentPoolService.Store(aps)
}
