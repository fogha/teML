package engine

import (
	"strings"
	"testing"

	"github.com/fogha/teml/hosts/go/protocol"
)

func TestSendRejectsOversizedCommands(t *testing.T) {
	s := &Session{closed: false}
	s.stdin = nil
	cmd := protocol.Char(strings.Repeat("x", protocol.MaxNDJSONLineBytes))
	err := s.Send(cmd)
	if err == nil || !strings.Contains(err.Error(), "NDJSON limit") {
		t.Fatalf("err = %v", err)
	}
}
