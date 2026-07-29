package screen

import (
	"strings"
	"testing"

	"github.com/fogha/teml/hosts/go/protocol"
)

func strPtr(s string) *string { return &s }

func TestReconstructsGrowthChangeAndTruncation(t *testing.T) {
	screen := NewBuffer(PreferredPlain)
	if err := screen.Apply(protocol.SessionEvent{
		Type: "frame", Seq: 1, FocusedID: strPtr("name"),
		Plain: strPtr("one\ntwo\n"), ANSI: nil,
	}); err != nil {
		t.Fatal(err)
	}
	if err := screen.Apply(protocol.SessionEvent{
		Type: "frame", Seq: 2, FocusedID: strPtr("name"), Rows: 3,
		Patches: []protocol.FramePatch{
			{Row: 1, Plain: strPtr("TWO"), ANSI: nil},
			{Row: 2, Plain: strPtr("three"), ANSI: nil},
		},
	}); err != nil {
		t.Fatal(err)
	}
	if got := screen.Text(); got != "one\nTWO\nthree" {
		t.Fatalf("got %q", got)
	}

	if err := screen.Apply(protocol.SessionEvent{
		Type: "frame", Seq: 3, FocusedID: strPtr("name"), Rows: 1,
		Patches: []protocol.FramePatch{},
	}); err != nil {
		t.Fatal(err)
	}
	if got := screen.Text(); got != "one" {
		t.Fatalf("got %q", got)
	}
}

func TestRejectsPatchSequenceGaps(t *testing.T) {
	screen := NewBuffer(PreferredANSI)
	if err := screen.Apply(protocol.SessionEvent{
		Type: "frame", Seq: 1, FocusedID: nil,
		Plain: strPtr("plain\n"), ANSI: strPtr("ansi\n"),
	}); err != nil {
		t.Fatal(err)
	}
	err := screen.Apply(protocol.SessionEvent{
		Type: "frame", Seq: 3, FocusedID: nil, Rows: 1,
		Patches: []protocol.FramePatch{},
	})
	if err == nil || !strings.Contains(err.Error(), "sequence gap") {
		t.Fatalf("expected sequence gap error, got %v", err)
	}
}

func TestPreservesValidatedViewportMetadata(t *testing.T) {
	screen := NewBuffer(PreferredPlain)
	if err := screen.Apply(protocol.SessionEvent{
		Type: "frame", Seq: 1, FocusedID: nil,
		Plain: strPtr("row 8\nrow 9\n"), ANSI: nil,
		Viewport: &protocol.ViewportMeta{Offset: 8, Height: 2, Total: 10},
	}); err != nil {
		t.Fatal(err)
	}
	vp := screen.Viewport()
	if vp == nil || vp.Offset != 8 || vp.Height != 2 || vp.Total != 10 {
		t.Fatalf("viewport = %+v", vp)
	}
}

func TestPreservesScrollRegionsAndCapabilities(t *testing.T) {
	screen := NewBuffer(PreferredPlain)
	if err := screen.Apply(protocol.SessionEvent{
		Type: "frame", Seq: 1, FocusedID: strPtr("logs"),
		Plain: strPtr("one\ntwo\n"), ANSI: nil,
		Protocol:     &protocol.ProtocolVersion{Major: 1, Minor: 1},
		Capabilities: []string{"scroll", "future"},
		ScrollRegions: []protocol.ScrollRegionMeta{
			{ID: "logs", Offset: 2, Height: 2, Total: 8},
		},
	}); err != nil {
		t.Fatal(err)
	}
	if !screen.HasCapability("scroll") {
		t.Fatal("expected scroll capability")
	}
	if len(screen.ScrollRegions()) != 1 || screen.ScrollRegions()[0].ID != "logs" {
		t.Fatalf("scroll regions = %+v", screen.ScrollRegions())
	}
}
