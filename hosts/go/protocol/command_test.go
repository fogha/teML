package protocol_test

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/fogha/teml/hosts/go/protocol"
	hostterminal "github.com/fogha/teml/hosts/go/terminal"
)

func TestUpdateMarshaling(t *testing.T) {
	line, err := protocol.Update("deploy", map[string]string{
		"value": "73",
		"max":   "100",
	}).MarshalNDJSON()
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(line, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded["type"] != "update" || decoded["id"] != "deploy" {
		t.Fatalf("decoded = %#v", decoded)
	}
	props, ok := decoded["props"].(map[string]any)
	if !ok || props["value"] != "73" || props["max"] != "100" {
		t.Fatalf("props = %#v", decoded["props"])
	}
}

func TestUpdateMarshalingPreservesZeroRowPointerSeparateFromUpdate(t *testing.T) {
	pointer, err := protocol.Pointer(0, 3).MarshalNDJSON()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(pointer), `"row":0`) {
		t.Fatalf("pointer = %s", pointer)
	}
	update, err := protocol.Update("logs", map[string]string{"offset": "0"}).MarshalNDJSON()
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(update), `"row"`) {
		t.Fatalf("update leaked row field: %s", update)
	}
}

func TestProtocolVersionMinorThree(t *testing.T) {
	if protocol.ProtocolMajor != 1 || protocol.ProtocolMinor != 3 {
		t.Fatalf("protocol version = %d.%d", protocol.ProtocolMajor, protocol.ProtocolMinor)
	}
}

func TestEngineCapabilitiesIncludeUpdate(t *testing.T) {
	foundUpdate := false
	foundMutations := false
	for _, cap := range protocol.EngineCapabilities {
		if cap == protocol.CapUpdate {
			foundUpdate = true
		}
		if cap == protocol.CapDocumentMutations {
			foundMutations = true
		}
	}
	if !foundUpdate || !foundMutations {
		t.Fatalf("EngineCapabilities missing update or documentMutations: %#v", protocol.EngineCapabilities)
	}
}

func TestDocumentMutationMarshaling(t *testing.T) {
	tests := []struct {
		command protocol.Command
		want    string
	}{
		{
			command: protocol.Replace("summary", "**Complete**", protocol.DocMarkdown),
			want:    `{"type":"replace","target":"summary","markup":"**Complete**","format":"markdown"}`,
		},
		{
			command: protocol.Append("logs", "Next", ""),
			want:    `{"type":"append","target":"logs","markup":"Next"}`,
		},
		{
			command: protocol.Remove("completed"),
			want:    `{"type":"remove","target":"completed"}`,
		},
	}
	for _, test := range tests {
		line, err := test.command.MarshalNDJSON()
		if err != nil {
			t.Fatal(err)
		}
		if string(line) != test.want {
			t.Fatalf("command = %s, want %s", line, test.want)
		}
	}
}

func TestDecodeSharedV1ConformanceTranscript(t *testing.T) {
	_, source, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot resolve test source path")
	}
	path := filepath.Join(
		filepath.Dir(source),
		"..", "..", "..",
		"tests", "system", "snapshots", "interactive-v1.ndjson",
	)
	transcript, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer transcript.Close()

	var eventTypes []string
	var firstFrame protocol.SessionEvent
	scanner := bufio.NewScanner(transcript)
	for scanner.Scan() {
		event, err := protocol.DecodeEvent(scanner.Text())
		if err != nil {
			t.Fatal(err)
		}
		if len(eventTypes) == 0 {
			firstFrame = event
		}
		eventTypes = append(eventTypes, event.Type)
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	if len(eventTypes) != 2 || eventTypes[0] != "frame" || eventTypes[1] != "exit" {
		t.Fatalf("event types = %#v", eventTypes)
	}
	supportsScroll := false
	for _, capability := range firstFrame.Capabilities {
		if capability == string(protocol.CapScroll) {
			supportsScroll = true
		}
	}
	fallback := hostterminal.MapScroll(-3, supportsScroll)
	if fallback.Type != "key" || fallback.Key != protocol.KeyPageUp {
		t.Fatalf("legacy capability fallback = %+v", fallback)
	}
}

func TestDecodeFrameToleratesOptionalMetadataAndUnknownFields(t *testing.T) {
	event, err := protocol.DecodeEvent(
		`{"type":"frame","seq":1,"focusedId":null,"plain":"ok\n","ansi":null,` +
			`"protocol":{"major":1,"minor":2},"capabilities":["scroll","future"],` +
			`"futureCapabilityFlag":true}`,
	)
	if err != nil {
		t.Fatal(err)
	}
	if event.Protocol == nil || event.Protocol.Major != 1 || event.Protocol.Minor != 2 {
		t.Fatalf("protocol = %#v", event.Protocol)
	}
	if len(event.Capabilities) != 2 || event.Capabilities[0] != "scroll" {
		t.Fatalf("capabilities = %#v", event.Capabilities)
	}
}
