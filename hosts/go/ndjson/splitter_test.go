package ndjson

import (
	"strings"
	"testing"
)

func TestSplitterHandlesPartialReads(t *testing.T) {
	var s Splitter
	inputs := s.Push(`{"type":"exit"}
{"type":"frame"`)
	inputs = append(inputs, s.Push(`,"seq":1}`+"\n")...)
	if len(inputs) != 2 {
		t.Fatalf("got %d inputs", len(inputs))
	}
}

func TestSplitterDropsBlankLines(t *testing.T) {
	var s Splitter
	inputs := s.Push("\n\n{\"type\":\"exit\"}\n\n")
	if len(inputs) != 1 || inputs[0].Line != `{"type":"exit"}` {
		t.Fatalf("inputs = %+v", inputs)
	}
}

func TestSplitterReportsOversizedLines(t *testing.T) {
	var s Splitter
	chunk := strings.Repeat("x", 9*1024*1024) + "\n"
	inputs := s.Push(chunk)
	if len(inputs) != 1 || inputs[0].Error == "" {
		t.Fatal("expected oversized line error")
	}
}

func TestFlushReturnsTrailingLine(t *testing.T) {
	var s Splitter
	s.Push(`{"type":"exit"}`)
	inputs := s.Flush()
	if len(inputs) != 1 {
		t.Fatalf("flush = %+v", inputs)
	}
}
