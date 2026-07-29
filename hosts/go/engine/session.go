package engine

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"

	"github.com/fogha/teml/hosts/go/ndjson"
	"github.com/fogha/teml/hosts/go/protocol"
)

// SpawnOptions configures a teml run child process.
type SpawnOptions struct {
	ResolveOptions
	ViewPath string
	Width    int
	Height   int
	// Frames and Mode are optional CLI flags. Leave empty when negotiating via
	// stdin configure — do not combine startup --frames/--mode with configure.
	Frames  protocol.FrameFormat
	Mode    protocol.FrameMode
	NoColor bool
}

// Session drives teml run over piped NDJSON stdio with unbuffered pipe I/O.
type Session struct {
	child    *exec.Cmd
	stdinRaw io.WriteCloser
	stdin    *bufio.Writer
	stdout   io.Reader
	splitter ndjson.Splitter
	pending  []ndjson.Input
	mu       sync.Mutex
	closed   bool
	Engine   ResolvedEngine
}

// Spawn starts teml run with the resolved engine and returns after pipes are ready.
func Spawn(opts SpawnOptions) (*Session, error) {
	engine, err := Resolve(opts.ResolveOptions)
	if err != nil {
		return nil, err
	}
	if opts.ViewPath == "" {
		return nil, errors.New("view path is required")
	}
	width := opts.Width
	if width < 1 {
		width = 80
	}
	height := opts.Height
	if height < 1 {
		height = 24
	}
	args := append(append([]string{}, engine.Args...),
		"run", opts.ViewPath,
		"--width", fmt.Sprintf("%d", width),
		"--height", fmt.Sprintf("%d", height),
	)
	if opts.Frames != "" {
		args = append(args, "--frames", string(opts.Frames))
	}
	if opts.Mode != "" {
		args = append(args, "--mode", string(opts.Mode))
	}
	if opts.NoColor {
		args = append(args, "--no-color")
	}

	cmd := exec.Command(engine.Program, args...)
	cmd.Stderr = os.Stderr
	stdinPipe, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("teml stdin pipe: %w", err)
	}
	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		_ = stdinPipe.Close()
		return nil, fmt.Errorf("teml stdout pipe: %w", err)
	}
	if err := cmd.Start(); err != nil {
		_ = stdinPipe.Close()
		_ = stdoutPipe.Close()
		return nil, fmt.Errorf("spawn teml engine (%s): %w", engine.Source, err)
	}

	return &Session{
		child:    cmd,
		stdinRaw: stdinPipe,
		stdin:    bufio.NewWriter(stdinPipe),
		stdout:   stdoutPipe,
		Engine:   engine,
	}, nil
}

// Send writes one command as a single NDJSON line and flushes immediately.
func (s *Session) Send(cmd protocol.Command) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return errors.New("session closed")
	}
	line, err := cmd.MarshalNDJSON()
	if err != nil {
		return err
	}
	if len(line) > protocol.MaxNDJSONLineBytes {
		return fmt.Errorf("command exceeds the %d-byte NDJSON limit", protocol.MaxNDJSONLineBytes)
	}
	if _, err := s.stdin.Write(line); err != nil {
		return fmt.Errorf("write command: %w", err)
	}
	if err := s.stdin.WriteByte('\n'); err != nil {
		return fmt.Errorf("write command newline: %w", err)
	}
	if err := s.stdin.Flush(); err != nil {
		return fmt.Errorf("flush command: %w", err)
	}
	return nil
}

// Next reads the next non-blank session event.
func (s *Session) Next() (protocol.SessionEvent, error) {
	for {
		line, err := s.readLine()
		if err != nil {
			return protocol.SessionEvent{}, err
		}
		return protocol.DecodeEvent(line)
	}
}

// NextFrame skips semantic events until a frame arrives.
func (s *Session) NextFrame() (protocol.SessionEvent, error) {
	for {
		event, err := s.Next()
		if err != nil {
			return protocol.SessionEvent{}, err
		}
		switch event.Type {
		case "frame":
			return event, nil
		case "error":
			return protocol.SessionEvent{}, fmt.Errorf("protocol error: %s", event.Message)
		case "exit":
			return protocol.SessionEvent{}, errors.New("session exited before producing a frame")
		}
	}
}

// InitialFrame reads the mandatory first frame event.
func (s *Session) InitialFrame() (protocol.SessionEvent, error) {
	event, err := s.Next()
	if err != nil {
		return protocol.SessionEvent{}, err
	}
	if event.Type != "frame" {
		return protocol.SessionEvent{}, fmt.Errorf("protocol violation: expected initial frame, got %q", event.Type)
	}
	return event, nil
}

// Close terminates the child process and closes pipes.
func (s *Session) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil
	}
	s.closed = true
	_ = s.stdin.Flush()
	_ = s.stdinRaw.Close()
	if s.child.Process != nil {
		_ = s.child.Process.Kill()
	}
	err := s.child.Wait()
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			return nil
		}
		return err
	}
	return nil
}

// Wait waits for the child to exit after a clean exit command.
func (s *Session) Wait() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.child.Process == nil {
		return errors.New("session not started")
	}
	if !s.closed {
		_ = s.stdin.Flush()
		_ = s.stdinRaw.Close()
		s.closed = true
	}
	return s.child.Wait()
}

func (s *Session) readLine() (string, error) {
	if line, err, ok := s.popPending(); ok {
		return line, err
	}

	chunk := make([]byte, 4096)
	for {
		n, err := s.stdout.Read(chunk)
		if n > 0 {
			s.pending = append(s.pending, s.splitter.Push(string(chunk[:n]))...)
			if line, pendingErr, ok := s.popPending(); ok {
				return line, pendingErr
			}
		}
		if err != nil {
			if errors.Is(err, io.EOF) {
				s.pending = append(s.pending, s.splitter.Flush()...)
				if line, pendingErr, ok := s.popPending(); ok {
					return line, pendingErr
				}
				return "", errors.New("teml closed stdout")
			}
			return "", err
		}
	}
}

func (s *Session) popPending() (string, error, bool) {
	if len(s.pending) == 0 {
		return "", nil, false
	}
	input := s.pending[0]
	s.pending = s.pending[1:]
	if input.Error != "" {
		return "", errors.New(input.Error), true
	}
	return input.Line, nil, true
}
