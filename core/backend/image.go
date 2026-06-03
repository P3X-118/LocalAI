package backend

import (
	"time"

	"github.com/P3X-118/LocalAI/core/config"
	"github.com/P3X-118/LocalAI/core/trace"

	"github.com/P3X-118/LocalAI/pkg/grpc/proto"
	model "github.com/P3X-118/LocalAI/pkg/model"
)

func ImageGeneration(height, width, step, seed int, strength float32, positive_prompt, negative_prompt, src, dst string, loader *model.ModelLoader, modelConfig config.ModelConfig, appConfig *config.ApplicationConfig, refImages []string, cfgScale float32, sampler, scheduler string, clipSkipOverride int, hiresFix bool, hiresUpscale float32, hiresSteps int) (func() error, error) {

	opts := ModelOptions(modelConfig, appConfig)
	inferenceModel, err := loader.Load(
		opts...,
	)
	if err != nil {
		recordModelLoadFailure(appConfig, modelConfig.Name, modelConfig.Backend, err, nil)
		return nil, err
	}

	fn := func() error {
		// Pick the per-request override over the model's CLIP skip default.
		clipSkip := int32(modelConfig.Diffusers.ClipSkip)
		if clipSkipOverride != 0 {
			clipSkip = int32(clipSkipOverride)
		}
		_, err := inferenceModel.GenerateImage(
			appConfig.Context,
			&proto.GenerateImageRequest{
				Height:           int32(height),
				Width:            int32(width),
				Step:             int32(step),
				Seed:             int32(seed),
				CLIPSkip:         clipSkip,
				PositivePrompt:   positive_prompt,
				NegativePrompt:   negative_prompt,
				Dst:              dst,
				Src:              src,
				EnableParameters: modelConfig.Diffusers.EnableParameters,
				RefImages:        refImages,
				Strength:         strength,
				CfgScale:         cfgScale,
				Sampler:          sampler,
				Scheduler:        scheduler,
				ClipSkipOverride: int32(clipSkipOverride),
				HiresFix:         hiresFix,
				HiresUpscale:     hiresUpscale,
				HiresSteps:       int32(hiresSteps),
			})
		return err
	}

	if appConfig.EnableTracing {
		trace.InitBackendTracingIfEnabled(appConfig.TracingMaxItems)

		traceData := map[string]any{
			"positive_prompt": positive_prompt,
			"negative_prompt": negative_prompt,
			"height":          height,
			"width":           width,
			"step":            step,
			"seed":            seed,
			"strength":        strength,
			"source_image":    src,
			"destination":     dst,
		}

		startTime := time.Now()
		originalFn := fn
		fn = func() error {
			err := originalFn()
			duration := time.Since(startTime)

			errStr := ""
			if err != nil {
				errStr = err.Error()
			}

			trace.RecordBackendTrace(trace.BackendTrace{
				Timestamp: startTime,
				Duration:  duration,
				Type:      trace.BackendTraceImageGeneration,
				ModelName: modelConfig.Name,
				Backend:   modelConfig.Backend,
				Summary:   trace.TruncateString(positive_prompt, 200),
				Error:     errStr,
				Data:      traceData,
			})

			return err
		}
	}

	return fn, nil
}

// ImageGenerationFunc is a test-friendly indirection to call image generation logic.
// Tests can override this variable to provide a stub implementation.
var ImageGenerationFunc = ImageGeneration
