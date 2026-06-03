package backend

import (
	"context"
	"fmt"
	"time"

	"github.com/P3X-118/LocalAI/core/config"
	"github.com/P3X-118/LocalAI/core/trace"
	"github.com/P3X-118/LocalAI/pkg/grpc/proto"
	model "github.com/P3X-118/LocalAI/pkg/model"
)

func Rerank(request *proto.RerankRequest, loader *model.ModelLoader, appConfig *config.ApplicationConfig, modelConfig config.ModelConfig) (*proto.RerankResult, error) {
	opts := ModelOptions(modelConfig, appConfig)
	rerankModel, err := loader.Load(opts...)
	if err != nil {
		recordModelLoadFailure(appConfig, modelConfig.Name, modelConfig.Backend, err, nil)
		return nil, err
	}

	if rerankModel == nil {
		return nil, fmt.Errorf("could not load rerank model")
	}

	var startTime time.Time
	if appConfig.EnableTracing {
		trace.InitBackendTracingIfEnabled(appConfig.TracingMaxItems)
		startTime = time.Now()
	}

	res, err := rerankModel.Rerank(context.Background(), request)

	if appConfig.EnableTracing {
		errStr := ""
		if err != nil {
			errStr = err.Error()
		}

		trace.RecordBackendTrace(trace.BackendTrace{
			Timestamp: startTime,
			Duration:  time.Since(startTime),
			Type:      trace.BackendTraceRerank,
			ModelName: modelConfig.Name,
			Backend:   modelConfig.Backend,
			Summary:   trace.TruncateString(request.Query, 200),
			Error:     errStr,
			Data: map[string]any{
				"query":           request.Query,
				"documents_count": len(request.Documents),
				"top_n":           request.TopN,
			},
		})
	}

	return res, err
}
