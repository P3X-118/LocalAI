package reasoning

// TagPair represents a start/end tag pair for reasoning extraction
type TagPair struct {
	Start string `yaml:"start" json:"start"`
	End   string `yaml:"end" json:"end"`
}

type Config struct {
	DisableReasoningTagPrefill *bool     `yaml:"disable_reasoning_tag_prefill,omitempty" json:"disable_reasoning_tag_prefill,omitempty"`
	DisableReasoning           *bool     `yaml:"disable,omitempty" json:"disable,omitempty"`
	StripReasoningOnly         *bool     `yaml:"strip_reasoning_only,omitempty" json:"strip_reasoning_only,omitempty"`
	// ContentFallbackToReasoning surfaces the reasoning text as the message
	// content when a model leaves content EMPTY after extraction.
	//
	// Reasoning-distill models (qwen3.5-9b-glm5.1-distill, and gemma distills)
	// emit their whole answer inside the thinking span, so extraction correctly
	// strips it and leaves content "". Any consumer that reads only `content`
	// then sees nothing. That is invisible to a direct API caller who knows to
	// read `content || reasoning`, but it silently breaks the AGENT POOL:
	// LocalAGI calls back into /v1/chat/completions, gets empty content, and
	// returns the user input verbatim — the agent appears to echo its prompt.
	//
	// Off by default and set PER MODEL, so only the distill models that need it
	// are affected and every other model keeps the clean content/reasoning split.
	ContentFallbackToReasoning *bool `yaml:"content_fallback_to_reasoning,omitempty" json:"content_fallback_to_reasoning,omitempty"`
	ThinkingStartTokens        []string  `yaml:"thinking_start_tokens,omitempty" json:"thinking_start_tokens,omitempty"`
	TagPairs                   []TagPair `yaml:"tag_pairs,omitempty" json:"tag_pairs,omitempty"`
}
