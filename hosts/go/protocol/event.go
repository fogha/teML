package protocol

import (
	"encoding/json"
	"fmt"
)

// SessionEvent is one engine→host message on stdout.
type SessionEvent struct {
	Type string `json:"type"`

	// frame (full or patch)
	Seq           int                `json:"seq,omitempty"`
	FocusedID     *string            `json:"focusedId"`
	Plain         *string            `json:"plain"`
	ANSI          *string            `json:"ansi"`
	Rows          int                `json:"rows,omitempty"`
	Patches       []FramePatch       `json:"patches,omitempty"`
	Viewport      *ViewportMeta      `json:"viewport,omitempty"`
	ScrollRegions []ScrollRegionMeta `json:"scrollRegions,omitempty"`
	Protocol      *ProtocolVersion   `json:"protocol,omitempty"`
	Capabilities  []string           `json:"capabilities,omitempty"`

	// change
	ID    string `json:"id,omitempty"`
	Value string `json:"value,omitempty"`

	// toggle
	Checked bool `json:"checked,omitempty"`

	// click
	Values map[string]string `json:"values,omitempty"`

	// error
	Message string `json:"message,omitempty"`
}

// IsFrame reports whether the event carries a terminal frame payload.
func (e SessionEvent) IsFrame() bool {
	return e.Type == "frame"
}

// IsPatch reports whether the frame is row-patch mode.
func (e SessionEvent) IsPatch() bool {
	return e.IsFrame() && e.Patches != nil
}

// FocusedIDString returns the focused widget id or empty string.
func (e SessionEvent) FocusedIDString() string {
	if e.FocusedID == nil {
		return ""
	}
	return *e.FocusedID
}

// DecodeEvent parses one NDJSON line into a SessionEvent.
func DecodeEvent(line string) (SessionEvent, error) {
	var event SessionEvent
	if err := json.Unmarshal([]byte(line), &event); err != nil {
		return SessionEvent{}, fmt.Errorf("invalid event JSON: %w", err)
	}
	if event.Type == "" {
		return SessionEvent{}, fmt.Errorf("event missing type")
	}
	return event, nil
}
