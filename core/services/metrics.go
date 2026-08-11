package services

import (
	"context"

	"github.com/mudler/xlog"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/prometheus"
	"go.opentelemetry.io/otel/metric"
	metricApi "go.opentelemetry.io/otel/sdk/metric"
)

type LocalAIMetricsService struct {
	Meter              metric.Meter
	ApiTimeMetric      metric.Float64Histogram
	UnknownModelMetric metric.Int64Counter
}

func (m *LocalAIMetricsService) ObserveAPICall(method string, path string, duration float64) {
	opts := metric.WithAttributes(
		attribute.String("method", method),
		attribute.String("path", path),
	)
	m.ApiTimeMetric.Record(context.Background(), duration, opts)
}

// ObserveUnknownModel counts requests for models that have no configuration —
// the caller is about to receive an error, and without this counter a remote
// system pinned to a renamed/retired model fails invisibly. Nil-safe so call
// sites don't need to care whether metrics are enabled.
func (m *LocalAIMetricsService) ObserveUnknownModel(modelName string, path string) {
	if m == nil || m.UnknownModelMetric == nil {
		return
	}
	// Model names are caller-controlled: bound the label to keep cardinality
	// and series size sane even if a client sends garbage.
	if len(modelName) > 64 {
		modelName = modelName[:64]
	}
	m.UnknownModelMetric.Add(context.Background(), 1, metric.WithAttributes(
		attribute.String("model", modelName),
		attribute.String("path", path),
	))
}

// setupOTelSDK bootstraps the OpenTelemetry pipeline.
// If it does not return an error, make sure to call shutdown for proper cleanup.
func NewLocalAIMetricsService() (*LocalAIMetricsService, error) {
	exporter, err := prometheus.New()
	if err != nil {
		return nil, err
	}
	provider := metricApi.NewMeterProvider(metricApi.WithReader(exporter))
	meter := provider.Meter("github.com/P3X-118/LocalAI")

	apiTimeMetric, err := meter.Float64Histogram("api_call", metric.WithDescription("api calls"))
	if err != nil {
		return nil, err
	}

	unknownModelMetric, err := meter.Int64Counter("unknown_model_requests",
		metric.WithDescription("requests for models that have no configuration (caller receives an error)"))
	if err != nil {
		return nil, err
	}

	return &LocalAIMetricsService{
		Meter:              meter,
		ApiTimeMetric:      apiTimeMetric,
		UnknownModelMetric: unknownModelMetric,
	}, nil
}

func (lams LocalAIMetricsService) Shutdown() error {
	// TODO: Not sure how to actually do this:
	//// setupOTelSDK bootstraps the OpenTelemetry pipeline.
	//// If it does not return an error, make sure to call shutdown for proper cleanup.

	xlog.Warn("LocalAIMetricsService Shutdown called, but OTelSDK proper shutdown not yet implemented?")
	return nil
}
