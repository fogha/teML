package terminal

import (
	"bufio"
	"fmt"
	"io"
	"strconv"
	"strings"

	"github.com/fogha/teml/hosts/go/protocol"
)

// Reader decodes stdin bytes in raw mode into protocol commands.
type Reader struct {
	in *bufio.Reader
}

// NewReader wraps a raw-mode stdin stream.
func NewReader(r io.Reader) *Reader {
	return &Reader{in: bufio.NewReader(r)}
}

// ReadCommand blocks until one mappable command is available.
func (r *Reader) ReadCommand() (*protocol.Command, error) {
	for {
		b, err := r.in.ReadByte()
		if err != nil {
			return nil, err
		}
		switch b {
		case 3: // Ctrl+C
			cmd := protocol.Exit()
			return &cmd, nil
		case '\r':
			cmd := protocol.Key(protocol.KeyEnter, nil)
			return &cmd, nil
		case '\n':
			cmd := protocol.Key(protocol.KeyEnter, &protocol.KeyModifiers{Ctrl: true})
			return &cmd, nil
		case '\t':
			cmd := protocol.Key(protocol.KeyTab, nil)
			return &cmd, nil
		case 127, 8:
			cmd := protocol.Key(protocol.KeyBackspace, nil)
			return &cmd, nil
		case 27:
			return r.readEscape()
		default:
			if b >= 32 && b != 127 {
				cmd := protocol.Char(string(rune(b)))
				return &cmd, nil
			}
		}
	}
}

func (r *Reader) readEscape() (*protocol.Command, error) {
	seq, err := r.readCSI()
	if err != nil {
		return nil, err
	}
	if seq == "" {
		cmd := protocol.Key(protocol.KeyEscape, nil)
		return &cmd, nil
	}
	if strings.HasPrefix(seq, "[") {
		body := seq[1:]
		switch body {
		case "A":
			return ptr(protocol.Key(protocol.KeyUp, nil)), nil
		case "B":
			return ptr(protocol.Key(protocol.KeyDown, nil)), nil
		case "C":
			return ptr(protocol.Key(protocol.KeyRight, nil)), nil
		case "D":
			return ptr(protocol.Key(protocol.KeyLeft, nil)), nil
		case "H":
			return ptr(protocol.Key(protocol.KeyHome, nil)), nil
		case "F":
			return ptr(protocol.Key(protocol.KeyEnd, nil)), nil
		case "3~":
			return ptr(protocol.Key(protocol.KeyDelete, nil)), nil
		case "5~":
			return ptr(protocol.Key(protocol.KeyPageUp, nil)), nil
		case "6~":
			return ptr(protocol.Key(protocol.KeyPageDown, nil)), nil
		case "Z":
			return ptr(protocol.Key(protocol.KeyShiftTab, nil)), nil
		}
		if strings.HasSuffix(body, "~") && len(body) >= 2 {
			num, err := strconv.Atoi(body[:len(body)-1])
			if err == nil && num >= 1 && num <= 12 {
				cmd := protocol.Key(protocol.KeyName(fmt.Sprintf("f%d", num)), nil)
				return &cmd, nil
			}
		}
	}
	if strings.HasPrefix(seq, "[<") && strings.HasSuffix(seq, "M") {
		// SGR mouse press: ESC [ < btn ; col ; row M (1-based; convert to 0-based).
		parts := strings.Split(strings.TrimSuffix(strings.TrimPrefix(seq, "[<"), "M"), ";")
		if len(parts) == 3 {
			button, err0 := strconv.Atoi(parts[0])
			row, err1 := strconv.Atoi(parts[2])
			col, err2 := strconv.Atoi(parts[1])
			if err0 == nil && err1 == nil && err2 == nil {
				if button&64 != 0 {
					if button&3 <= 1 {
						rows := 3
						if button&1 == 0 {
							rows = -rows
						}
						cmd := protocol.Scroll(rows)
						return &cmd, nil
					}
					return nil, nil
				}
				cmd := protocol.Pointer(row-1, col-1)
				return &cmd, nil
			}
		}
	}
	return nil, nil
}

func (r *Reader) readCSI() (string, error) {
	var sb strings.Builder
	for {
		b, err := r.in.ReadByte()
		if err != nil {
			return sb.String(), err
		}
		sb.WriteByte(b)
		if sb.Len() == 1 && (b == '[' || b == 'O') {
			continue
		}
		if b == '~' || (b >= '@' && b <= '~') {
			return sb.String(), nil
		}
		if sb.Len() > 32 {
			return sb.String(), nil
		}
	}
}

func ptr(cmd protocol.Command) *protocol.Command {
	return &cmd
}
