package backend

import (
	"github.com/P3X-118/LocalAI/core/config"

	"github.com/P3X-118/LocalAI/pkg/grpc"
	"github.com/P3X-118/LocalAI/pkg/model"
)

func StoreBackend(sl *model.ModelLoader, appConfig *config.ApplicationConfig, storeName string, backend string) (grpc.Backend, error) {
	if backend == "" {
		backend = model.LocalStoreBackend
	}
	sc := []model.Option{
		model.WithBackendString(backend),
		model.WithModel(storeName),
	}

	return sl.Load(sc...)
}
