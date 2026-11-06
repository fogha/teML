package ndjson

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"
)

type contractPart struct {
	Text   string `json:"text"`
	Repeat int    `json:"repeat"`
}

type contractCase struct {
	Name   string           `json:"name"`
	Parts  []contractPart   `json:"parts"`
	Chunks []int            `json:"chunks"`
	Events []map[string]any `json:"events"`
}

func loadContractCases(t *testing.T) []contractCase {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	path := filepath.Join(filepath.Dir(file), "..", "..", "..", "fixtures", "protocol", "ndjson-cases.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("shared contract: %v", err)
	}
	var fixture struct {
		Cases []contractCase `json:"cases"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatalf("decode shared contract: %v", err)
	}
	if len(fixture.Cases) == 0 {
		t.Fatal("shared contract is empty")
	}
	return fixture.Cases
}

func contractInput(parts []contractPart) []byte {
	var input []byte
	for _, part := range parts {
		input = append(input, bytes.Repeat([]byte(part.Text), part.Repeat)...)
	}
	return input
}

func runContract(testCase contractCase) []map[string]any {
	var splitter Splitter
	var events []map[string]any
	collect := func(inputs []Input) {
		for _, input := range inputs {
			if input.Error != "" {
				events = append(events, map[string]any{"type": "error", "message": input.Error})
				continue
			}
			var event map[string]any
			if err := json.Unmarshal([]byte(input.Line), &event); err != nil {
				panic(err)
			}
			events = append(events, event)
		}
	}

	input := contractInput(testCase.Parts)
	offset := 0
	for index := 0; offset < len(input); index++ {
		size := testCase.Chunks[index%len(testCase.Chunks)]
		end := min(len(input), offset+size)
		collect(splitter.Push(string(input[offset:end])))
		offset = end
	}
	collect(splitter.Flush())
	return events
}

func TestSharedNDJSONContract(t *testing.T) {
	for _, testCase := range loadContractCases(t) {
		t.Run(testCase.Name, func(t *testing.T) {
			if got := runContract(testCase); !reflect.DeepEqual(got, testCase.Events) {
				t.Fatalf("events = %#v, want %#v", got, testCase.Events)
			}
		})
	}
}
