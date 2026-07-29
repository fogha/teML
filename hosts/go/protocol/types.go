package protocol

// ProtocolVersion is the negotiated interactive protocol revision.
type ProtocolVersion struct {
	Major int `json:"major"`
	Minor int `json:"minor"`
}

// ProtocolMajor and ProtocolMinor match src/interactive/protocol.ts.
const (
	ProtocolMajor = 1
	ProtocolMinor = 3
)

// ProtocolCapability names an optional engine feature.
type ProtocolCapability string

const (
	CapFrameFormats      ProtocolCapability = "frameFormats"
	CapPatches           ProtocolCapability = "patches"
	CapResize            ProtocolCapability = "resize"
	CapViewport          ProtocolCapability = "viewport"
	CapPointerColumns    ProtocolCapability = "pointerColumns"
	CapKeyModifiers      ProtocolCapability = "keyModifiers"
	CapScroll            ProtocolCapability = "scroll"
	CapContextualInput   ProtocolCapability = "contextualInput"
	CapRadio             ProtocolCapability = "radio"
	CapTextarea          ProtocolCapability = "textarea"
	CapScrollRegions     ProtocolCapability = "scrollRegions"
	CapUpdate            ProtocolCapability = "update"
	CapDocumentMutations ProtocolCapability = "documentMutations"
)

// EngineCapabilities lists the finite capability vocabulary for protocol 1.3.
var EngineCapabilities = []ProtocolCapability{
	CapFrameFormats,
	CapPatches,
	CapResize,
	CapViewport,
	CapPointerColumns,
	CapKeyModifiers,
	CapScroll,
	CapContextualInput,
	CapRadio,
	CapTextarea,
	CapScrollRegions,
	CapUpdate,
	CapDocumentMutations,
}

const (
	MaxDocumentBlocks         = 10_000
	MaxMutationTargetChildren = 2_000
)

// KeyName is a normalized navigation or editing key.
type KeyName string

const (
	KeyTab       KeyName = "tab"
	KeyShiftTab  KeyName = "shiftTab"
	KeyEnter     KeyName = "enter"
	KeyBackspace KeyName = "backspace"
	KeyEscape    KeyName = "escape"
	KeyLeft      KeyName = "left"
	KeyRight     KeyName = "right"
	KeyUp        KeyName = "up"
	KeyDown      KeyName = "down"
	KeyHome      KeyName = "home"
	KeyEnd       KeyName = "end"
	KeyDelete    KeyName = "delete"
	KeyPageUp    KeyName = "pageUp"
	KeyPageDown  KeyName = "pageDown"
	KeyF1        KeyName = "f1"
	KeyF2        KeyName = "f2"
	KeyF3        KeyName = "f3"
	KeyF4        KeyName = "f4"
	KeyF5        KeyName = "f5"
	KeyF6        KeyName = "f6"
	KeyF7        KeyName = "f7"
	KeyF8        KeyName = "f8"
	KeyF9        KeyName = "f9"
	KeyF10       KeyName = "f10"
	KeyF11       KeyName = "f11"
	KeyF12       KeyName = "f12"
)

// KeyModifiers carries optional modifier flags on key commands.
type KeyModifiers struct {
	Ctrl  bool `json:"ctrl,omitempty"`
	Alt   bool `json:"alt,omitempty"`
	Shift bool `json:"shift,omitempty"`
}

// DocFormat is the markup language for render and mutation commands.
type DocFormat string

const (
	DocTEML     DocFormat = "teml"
	DocMarkdown DocFormat = "markdown"
	DocHTML     DocFormat = "html"
)

// FrameFormat selects which payload fields appear in frames.
type FrameFormat string

const (
	FrameANSI  FrameFormat = "ansi"
	FramePlain FrameFormat = "plain"
	FrameBoth  FrameFormat = "both"
)

// FrameMode selects full re-renders or row-level patches.
type FrameMode string

const (
	FrameFull    FrameMode = "full"
	FramePatches FrameMode = "patches"
)

// ViewportMeta describes a visible window into a larger document.
type ViewportMeta struct {
	Offset int `json:"offset"`
	Height int `json:"height"`
	Total  int `json:"total"`
}

// ScrollRegionMeta describes a nested scroll container.
type ScrollRegionMeta struct {
	ID     string `json:"id"`
	Offset int    `json:"offset"`
	Height int    `json:"height"`
	Total  int    `json:"total"`
}

// FramePatch is one changed row in patches mode.
type FramePatch struct {
	Row   int     `json:"row"`
	Plain *string `json:"plain"`
	ANSI  *string `json:"ansi"`
}
