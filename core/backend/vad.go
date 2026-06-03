package backend

import (
	"context"

	"github.com/P3X-118/LocalAI/core/config"
	"github.com/P3X-118/LocalAI/core/schema"
	"github.com/P3X-118/LocalAI/pkg/grpc/proto"
	"github.com/P3X-118/LocalAI/pkg/model"
)

func VAD(request *schema.VADRequest,
	ctx context.Context,
	ml *model.ModelLoader,
	appConfig *config.ApplicationConfig,
	modelConfig config.ModelConfig) (*schema.VADResponse, error) {
	opts := ModelOptions(modelConfig, appConfig)
	vadModel, err := ml.Load(opts...)
	if err != nil {
		recordModelLoadFailure(appConfig, modelConfig.Name, modelConfig.Backend, err, nil)
		return nil, err
	}

	req := proto.VADRequest{
		Audio: request.Audio,
	}
	resp, err := vadModel.VAD(ctx, &req)
	if err != nil {
		return nil, err
	}

	segments := []schema.VADSegment{}
	for _, s := range resp.Segments {
		segments = append(segments, schema.VADSegment{Start: s.Start, End: s.End})
	}

	return &schema.VADResponse{
		Segments: segments,
	}, nil
}
