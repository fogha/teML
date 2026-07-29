package ndjson

import (
	"strings"

	"github.com/fogha/teml/hosts/go/protocol"
)

// Input is one complete line or a recoverable splitter error.
type Input struct {
	Line  string
	Error string
}

// Splitter buffers arbitrary read chunks into complete NDJSON lines.
// Oversized lines produce one recoverable error and are discarded through
// their next newline without retaining the data.
type Splitter struct {
	buffer              strings.Builder
	bufferBytes         int
	discardingOversized bool
}

// Push feeds a raw chunk of text.
func (s *Splitter) Push(chunk string) []Input {
	var inputs []Input
	start := 0
	for start < len(chunk) {
		newline := strings.IndexByte(chunk[start:], '\n')
		endsLine := newline >= 0
		end := len(chunk)
		if endsLine {
			end = start + newline
		}

		if s.discardingOversized {
			if !endsLine {
				return inputs
			}
			s.discardingOversized = false
			start = start + newline + 1
			continue
		}

		segment := chunk[start:end]
		segmentBytes := utf8ByteLen(segment)
		if s.bufferBytes+segmentBytes > protocol.MaxNDJSONLineBytes {
			s.buffer.Reset()
			s.bufferBytes = 0
			inputs = append(inputs, Input{
				Error: "NDJSON line exceeds the 8388608-byte limit",
			})
			if !endsLine {
				s.discardingOversized = true
				return inputs
			}
			start = start + newline + 1
			continue
		}

		s.buffer.WriteString(segment)
		s.bufferBytes += segmentBytes
		if !endsLine {
			return inputs
		}

		line := strings.TrimSuffix(s.buffer.String(), "\r")
		s.buffer.Reset()
		s.bufferBytes = 0
		if strings.TrimSpace(line) != "" {
			inputs = append(inputs, Input{Line: line})
		}
		start = start + newline + 1
	}
	return inputs
}

// Flush returns whatever remains unterminated when the stream ends.
func (s *Splitter) Flush() []Input {
	if s.discardingOversized {
		s.discardingOversized = false
		s.buffer.Reset()
		s.bufferBytes = 0
		return nil
	}
	rest := s.buffer.String()
	s.buffer.Reset()
	s.bufferBytes = 0
	if strings.TrimSpace(rest) == "" {
		return nil
	}
	return []Input{{Line: rest}}
}

func utf8ByteLen(value string) int {
	return len([]byte(value))
}
