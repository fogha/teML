package terminal

import (
	"strings"
	"testing"

	"github.com/fogha/teml/hosts/go/protocol"
)

func TestReaderMapsSGRPointerCoordinatesToZeroBasedCells(t *testing.T) {
	reader := NewReader(strings.NewReader("\x1b[<0;9;4M"))

	command, err := reader.ReadCommand()
	if err != nil {
		t.Fatal(err)
	}
	if command == nil || command.Type != "pointer" || command.Row != 3 || command.Col != 8 {
		t.Fatalf("pointer command = %+v", command)
	}
}

func TestReaderMapsCSIArrowKey(t *testing.T) {
	reader := NewReader(strings.NewReader("\x1b[A"))

	command, err := reader.ReadCommand()
	if err != nil {
		t.Fatal(err)
	}
	if command == nil || command.Type != "key" || command.Key != protocol.KeyUp {
		t.Fatalf("key command = %+v", command)
	}
}

func TestReaderMapsVerticalSGRWheelEventsToScrollRows(t *testing.T) {
	tests := []struct {
		name string
		seq  string
		rows int
	}{
		{name: "up", seq: "\x1b[<64;9;4M", rows: -3},
		{name: "down", seq: "\x1b[<65;9;4M", rows: 3},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			reader := NewReader(strings.NewReader(test.seq))
			command, err := reader.ReadCommand()
			if err != nil {
				t.Fatal(err)
			}
			if command == nil || command.Type != "scroll" || command.ScrollRows != test.rows {
				t.Fatalf("scroll command = %+v", command)
			}
		})
	}
}

func TestMapScrollFallsBackWhenCapabilityIsMissing(t *testing.T) {
	supported := MapScroll(-3, true)
	if supported.Type != "scroll" || supported.ScrollRows != -3 {
		t.Fatalf("supported scroll = %+v", supported)
	}

	fallback := MapScroll(-3, false)
	if fallback.Type != "key" || fallback.Key != protocol.KeyPageUp {
		t.Fatalf("fallback scroll = %+v", fallback)
	}
}
