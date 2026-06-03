package localai

import (
	"net/http"

	"github.com/labstack/echo/v4"
	"github.com/P3X-118/LocalAI/core/application"
	"github.com/mudler/LocalAGI/core/state"
	"github.com/mudler/LocalAGI/pkg/llm"
	"github.com/mudler/xlog"
	"github.com/sashabaranov/go-openai/jsonschema"
)

// agentRole is the minimal shape returned by GenerateGroupProfiles and
// accepted by CreateGroup — name + description + system prompt per agent.
// Matches the upstream LocalAGI `AgentRole` struct exactly.
type agentRole struct {
	Name         string `json:"name"`
	Description  string `json:"description"`
	SystemPrompt string `json:"system_prompt"`
}

// GenerateGroupProfilesEndpoint asks the configured agent-pool LLM to
// invent N agent profiles from a free-form team description, using guided
// JSON-schema generation so the response is always parseable.
//
// Ported from upstream LocalAGI webui/app.go:700 (Fiber → Echo). Reuses
// pkg/llm/json.go's GenerateTypedJSONWithGuidance verbatim.
//
//	POST /api/agents/group/generateProfiles
//	{ "description": "3-agent customer-support team for a SaaS product" }
//	→ [ { name, description, system_prompt }, ... ]
func GenerateGroupProfilesEndpoint(app *application.Application) echo.HandlerFunc {
	return func(c echo.Context) error {
		var req struct {
			Description string `json:"description"`
		}
		if err := c.Bind(&req); err != nil {
			return c.JSON(http.StatusBadRequest, map[string]any{
				"error": map[string]string{"type": "invalid_request", "message": err.Error()},
			})
		}
		if req.Description == "" {
			return c.JSON(http.StatusBadRequest, map[string]any{
				"error": map[string]string{"type": "invalid_request", "message": "description is required"},
			})
		}

		cfg := app.ApplicationConfig().AgentPool
		client := llm.NewClient(cfg.APIKey, cfg.APIURL, "10m")

		var results struct {
			Agents []agentRole `json:"agents"`
		}

		xlog.Debug("Generating group profiles", "description", req.Description, "model", cfg.DefaultModel)
		err := llm.GenerateTypedJSONWithGuidance(c.Request().Context(), client, req.Description, cfg.DefaultModel, jsonschema.Definition{
			Type: jsonschema.Object,
			Properties: map[string]jsonschema.Definition{
				"agents": {
					Type: jsonschema.Array,
					Items: &jsonschema.Definition{
						Type:     jsonschema.Object,
						Required: []string{"name", "description", "system_prompt"},
						Properties: map[string]jsonschema.Definition{
							"name":          {Type: jsonschema.String, Description: "The name of the agent"},
							"description":   {Type: jsonschema.String, Description: "The description of the agent"},
							"system_prompt": {Type: jsonschema.String, Description: "The system prompt for the agent"},
						},
					},
				},
			},
		}, &results)
		if err != nil {
			xlog.Warn("group profile generation failed", "err", err)
			return c.JSON(http.StatusInternalServerError, map[string]any{
				"error": map[string]string{"type": "llm_error", "message": err.Error()},
			})
		}
		return c.JSON(http.StatusOK, results.Agents)
	}
}

// CreateGroupEndpoint creates several agents in one shot, all sharing the
// supplied AgentConfig but each given the per-agent name, description, and
// system prompt. Wraps the existing CreateAgentForUser pool call so the
// agents land under the caller's user ID (same scoping as POST /api/agents).
//
// Ported from upstream LocalAGI webui/app.go:750 (Fiber → Echo).
//
//	POST /api/agents/group/create
//	{
//	  "agents": [ { name, description, system_prompt }, ... ],
//	  "agent_config": { model, api_url, api_key, connectors[], actions[], ... }
//	}
//	→ { "created": N, "names": [...] }
func CreateGroupEndpoint(app *application.Application) echo.HandlerFunc {
	return func(c echo.Context) error {
		var req struct {
			Agents      []agentRole       `json:"agents"`
			AgentConfig state.AgentConfig `json:"agent_config"`
		}
		if err := c.Bind(&req); err != nil {
			return c.JSON(http.StatusBadRequest, map[string]any{
				"error": map[string]string{"type": "invalid_request", "message": err.Error()},
			})
		}
		if len(req.Agents) == 0 {
			return c.JSON(http.StatusBadRequest, map[string]any{
				"error": map[string]string{"type": "invalid_request", "message": "agents array is empty"},
			})
		}

		svc := app.AgentPoolService()
		if svc == nil {
			return c.JSON(http.StatusServiceUnavailable, map[string]any{
				"error": map[string]string{"type": "unavailable", "message": "agent pool not running"},
			})
		}
		userID := effectiveUserID(c)

		// Each call mutates Name/Description/SystemPrompt on the shared
		// AgentConfig template, so we keep a local copy per loop iteration to
		// stay safe if the pool retains the pointer.
		created := make([]string, 0, len(req.Agents))
		for _, a := range req.Agents {
			ac := req.AgentConfig // copy
			ac.Name = a.Name
			ac.Description = a.Description
			ac.SystemPrompt = a.SystemPrompt
			xlog.Info("creating group agent", "user", userID, "name", a.Name)
			if err := svc.CreateAgentForUser(userID, &ac); err != nil {
				// Partial failure: return what we managed to create + the failing name.
				return c.JSON(http.StatusInternalServerError, map[string]any{
					"error":   map[string]string{"type": "create_failed", "message": err.Error()},
					"created": created,
					"failed":  a.Name,
				})
			}
			created = append(created, a.Name)
		}
		return c.JSON(http.StatusOK, map[string]any{
			"status":  "ok",
			"created": len(created),
			"names":   created,
		})
	}
}
