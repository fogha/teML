package screen

import (
	"fmt"
	"strings"

	"github.com/fogha/teml/hosts/go/protocol"
)

// PreferredFrame selects ansi or plain payloads when both are present.
type PreferredFrame int

const (
	PreferredANSI PreferredFrame = iota
	PreferredPlain
)

// Viewport is validated viewport metadata from a frame.
type Viewport struct {
	Offset int
	Height int
	Total  int
}

// ScrollRegion is validated scroll-region metadata from a frame.
type ScrollRegion struct {
	ID     string
	Offset int
	Height int
	Total  int
}

// Buffer reconstructs full and patch frames into paintable rows.
type Buffer struct {
	preferred     PreferredFrame
	rows          []string
	lastSeq       uint64
	focusedID     string
	viewport      *Viewport
	scrollRegions []ScrollRegion
	protocol      *protocol.ProtocolVersion
	capabilities  []string
}

// NewBuffer creates an empty screen buffer.
func NewBuffer(preferred PreferredFrame) *Buffer {
	return &Buffer{preferred: preferred}
}

// Apply merges one frame event into the buffer.
func (b *Buffer) Apply(event protocol.SessionEvent) error {
	if event.Type != "frame" {
		return fmt.Errorf("expected a frame event")
	}
	if event.Seq < 1 {
		return fmt.Errorf("frame needs a positive integer seq")
	}
	seq := uint64(event.Seq)
	if seq <= b.lastSeq {
		return fmt.Errorf("non-monotonic frame sequence: %d after %d", seq, b.lastSeq)
	}

	if event.Patches != nil {
		if b.lastSeq == 0 {
			return fmt.Errorf("patch frame arrived before a full frame")
		}
		if seq != b.lastSeq+1 {
			return fmt.Errorf("patch frame sequence gap: expected %d, got %d", b.lastSeq+1, seq)
		}
		if event.Rows < 0 {
			return fmt.Errorf("patch frame needs a non-negative rows count")
		}
		for _, patch := range event.Patches {
			if patch.Row < 0 || patch.Row >= event.Rows {
				return fmt.Errorf("patch row %d is outside the %d-row frame", patch.Row, event.Rows)
			}
			text, err := patchPayload(&patch, b.preferred)
			if err != nil {
				return err
			}
			if len(b.rows) <= patch.Row {
				grow := patch.Row + 1 - len(b.rows)
				b.rows = append(b.rows, make([]string, grow)...)
			}
			b.rows[patch.Row] = text
		}
		if len(b.rows) > event.Rows {
			b.rows = b.rows[:event.Rows]
		} else if len(b.rows) < event.Rows {
			grow := event.Rows - len(b.rows)
			b.rows = append(b.rows, make([]string, grow)...)
		}
	} else {
		rendered, err := fullPayload(&event, b.preferred)
		if err != nil {
			return err
		}
		b.rows = splitRows(rendered)
	}

	viewport, err := parseViewport(event.Viewport, len(b.rows))
	if err != nil {
		return err
	}
	regions, err := parseScrollRegions(event.ScrollRegions)
	if err != nil {
		return err
	}
	b.viewport = viewport
	b.scrollRegions = regions
	if event.FocusedID != nil {
		b.focusedID = *event.FocusedID
	} else {
		b.focusedID = ""
	}
	if event.Protocol != nil &&
		event.Protocol.Major >= 0 && event.Protocol.Minor >= 0 {
		b.protocol = &protocol.ProtocolVersion{
			Major: event.Protocol.Major,
			Minor: event.Protocol.Minor,
		}
	}
	if event.Capabilities != nil {
		b.capabilities = append([]string(nil), event.Capabilities...)
	}
	b.lastSeq = seq
	return nil
}

// Text joins reconstructed rows for painting.
func (b *Buffer) Text() string {
	return strings.Join(b.rows, "\n")
}

// LastSeq returns the last applied frame sequence number.
func (b *Buffer) LastSeq() uint64 {
	return b.lastSeq
}

// FocusedID returns the focused widget id from the last frame.
func (b *Buffer) FocusedID() string {
	return b.focusedID
}

// Viewport returns validated viewport metadata, if any.
func (b *Buffer) Viewport() *Viewport {
	return b.viewport
}

// ScrollRegions returns validated scroll-region metadata.
func (b *Buffer) ScrollRegions() []ScrollRegion {
	return append([]ScrollRegion(nil), b.scrollRegions...)
}

// Protocol returns discovery metadata from the last full frame.
func (b *Buffer) Protocol() *protocol.ProtocolVersion {
	if b.protocol == nil {
		return nil
	}
	copy := *b.protocol
	return &copy
}

// Capabilities returns capability strings from the last full frame.
func (b *Buffer) Capabilities() []string {
	return append([]string(nil), b.capabilities...)
}

// HasCapability reports whether a capability was advertised.
func (b *Buffer) HasCapability(name string) bool {
	for _, cap := range b.capabilities {
		if cap == name {
			return true
		}
	}
	return false
}

func fullPayload(event *protocol.SessionEvent, preferred PreferredFrame) (string, error) {
	text, ok := payload(event.Plain, event.ANSI, preferred)
	if !ok {
		return "", fmt.Errorf("full frame has no usable payload")
	}
	return text, nil
}

func patchPayload(patch *protocol.FramePatch, preferred PreferredFrame) (string, error) {
	text, ok := payload(patch.Plain, patch.ANSI, preferred)
	if !ok {
		return "", fmt.Errorf("patch row %d has no usable payload", patch.Row)
	}
	return text, nil
}

func payload(plain, ansi *string, preferred PreferredFrame) (string, bool) {
	switch preferred {
	case PreferredANSI:
		if ansi != nil {
			return *ansi, true
		}
		if plain != nil {
			return *plain, true
		}
	case PreferredPlain:
		if plain != nil {
			return *plain, true
		}
		if ansi != nil {
			return *ansi, true
		}
	}
	return "", false
}

func splitRows(rendered string) []string {
	if rendered == "" {
		return nil
	}
	if strings.HasSuffix(rendered, "\n") {
		rendered = rendered[:len(rendered)-1]
	}
	return strings.Split(rendered, "\n")
}

func parseViewport(meta *protocol.ViewportMeta, rowCount int) (*Viewport, error) {
	if meta == nil {
		return nil, nil
	}
	if meta.Offset < 0 || meta.Height < 1 || meta.Total < meta.Height ||
		meta.Offset+meta.Height > meta.Total || meta.Height != rowCount {
		return nil, fmt.Errorf("invalid frame viewport bounds")
	}
	return &Viewport{
		Offset: meta.Offset,
		Height: meta.Height,
		Total:  meta.Total,
	}, nil
}

func parseScrollRegions(entries []protocol.ScrollRegionMeta) ([]ScrollRegion, error) {
	if entries == nil {
		return nil, nil
	}
	regions := make([]ScrollRegion, 0, len(entries))
	for _, entry := range entries {
		if entry.ID == "" {
			return nil, fmt.Errorf("scroll region needs an id")
		}
		if entry.Height < 1 || entry.Offset > max(0, entry.Total-entry.Height) {
			return nil, fmt.Errorf("invalid scroll region bounds")
		}
		regions = append(regions, ScrollRegion{
			ID:     entry.ID,
			Offset: entry.Offset,
			Height: entry.Height,
			Total:  entry.Total,
		})
	}
	return regions, nil
}
