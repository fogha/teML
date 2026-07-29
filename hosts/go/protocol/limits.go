package protocol

// Wire resource limits shared with the engine (see src/interactive/protocol.ts).
const (
	MaxCharBytes         = 64 * 1024
	MaxRenderMarkupBytes = 4 * 1024 * 1024
	MaxNDJSONLineBytes   = 8 * 1024 * 1024
	MaxScrollRows        = 10_000
)
