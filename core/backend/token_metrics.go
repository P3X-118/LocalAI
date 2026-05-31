package backend

import (
	"context"
	"fmt"

	"github.com/P3X-118/LocalAI/core/config"
	"github.com/P3X-118/LocalAI/pkg/grpc/proto"
	model "github.com/P3X-118/LocalAI/pkg/model"
)

func TokenMetrics(
	modelFile string,
	loader *model.ModelLoader,
	appConfig *config.ApplicationConfig,
	modelConfig config.ModelConfig) (*proto.MetricsResponse, error) {

	opts := ModelOptions(modelConfig, appConfig, model.WithModel(modelFile))
	model, err := loader.Load(opts...)
	if err != nil {
		recordModelLoadFailure(appConfig, modelConfig.Name, modelConfig.Backend, err, nil)
		return nil, err
	}

	if model == nil {
		return nil, fmt.Errorf("could not loadmodel model")
	}

	res, err := model.GetTokenMetrics(context.Background(), &proto.MetricsRequest{})

	return res, err
}
