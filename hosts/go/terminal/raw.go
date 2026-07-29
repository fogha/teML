package terminal

import (
	"fmt"
	"io"
	"os"
	"strings"

	"golang.org/x/term"

	"github.com/fogha/teml/hosts/go/screen"
)

// RawTerminal enables raw mode on stdin and guarantees restoration on Close.
//
// Mouse clicks are delivered when the host enables xterm SGR mouse reporting
// before entering raw mode. Write EnableMouse to stdout after MakeRaw and call
// DisableMouse during Close. golang.org/x/term does not decode mouse events;
// hosts must parse the ANSI sequences themselves or use a higher-level TUI
// library on top of the passthrough bytes. On Windows, console mouse support
// varies by terminal emulator — test on your target platform matrix.
type RawTerminal struct {
	fd       int
	oldState *term.State
}

// IsTerminal reports whether both stdin and stdout are TTYs.
func IsTerminal() bool {
	return term.IsTerminal(int(os.Stdin.Fd())) && term.IsTerminal(int(os.Stdout.Fd()))
}

// EnterRaw puts stdin into raw mode. The previous state is restored by Close.
func EnterRaw() (*RawTerminal, error) {
	fd := int(os.Stdin.Fd())
	if !term.IsTerminal(fd) {
		return nil, fmt.Errorf("stdin is not a terminal")
	}
	oldState, err := term.MakeRaw(fd)
	if err != nil {
		return nil, err
	}
	return &RawTerminal{fd: fd, oldState: oldState}, nil
}

// Close restores the terminal and disables mouse capture.
func (t *RawTerminal) Close() error {
	if t.oldState == nil {
		return nil
	}
	_, _ = io.WriteString(os.Stdout, DisableMouse)
	err := term.Restore(t.fd, t.oldState)
	t.oldState = nil
	return err
}

// EnableMouse is the xterm SGR mouse tracking sequence written to stdout.
const EnableMouse = "\x1b[?1000h\x1b[?1002h\x1b[?1006h"

// DisableMouse turns off mouse reporting.
const DisableMouse = "\x1b[?1006l\x1b[?1002l\x1b[?1000l"

// EnableMouseCapture writes the mouse-enable sequence to stdout.
func EnableMouseCapture(w io.Writer) error {
	_, err := io.WriteString(w, EnableMouse)
	return err
}

// Paint clears the screen and writes buffer text with ONLCR-safe newlines.
//
// Raw mode disables ONLCR on many platforms, so a bare '\n' no longer returns
// the cursor to column 0. Expand newlines to "\r\n" or frames staircase.
func Paint(w io.Writer, buffer *screen.Buffer) error {
	if _, err := io.WriteString(w, "\x1b[2J\x1b[H"); err != nil {
		return err
	}
	text := strings.ReplaceAll(buffer.Text(), "\n", "\r\n")
	if _, err := io.WriteString(w, text); err != nil {
		return err
	}
	return nil
}

// Size returns the terminal dimensions in columns and rows.
func Size() (width, height int, err error) {
	w, h, err := term.GetSize(int(os.Stdout.Fd()))
	if err != nil {
		return 0, 0, err
	}
	if w < 1 {
		w = 1
	}
	if h < 1 {
		h = 1
	}
	return w, h, nil
}
