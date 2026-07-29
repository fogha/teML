// Package app drives a TeML session from semantic event handlers instead of
// a hand-written event loop. See Run and RunHeadless.
package app

import (
	"fmt"
	"io"
	"os"
	"strconv"

	"github.com/fogha/teml/hosts/go/engine"
	"github.com/fogha/teml/hosts/go/protocol"
	"github.com/fogha/teml/hosts/go/screen"
	"github.com/fogha/teml/hosts/go/terminal"
)

// Values holds widget values keyed by id. Checkbox values are "true" or "false".
type Values map[string]string

// Context lets a handler act on the running session without reaching into internals.
//
// Requests are queued and sent once the handler returns, so a handler can never
// interleave commands with the event stream it is being dispatched from.
type Context struct {
	values *Values
	queued *[]protocol.Command
	exit   *bool
}

// Exit ends the loop; Run and RunHeadless return the final widget values.
func (c *Context) Exit() {
	*c.exit = true
}

// Render swaps in a new document — for example the next screen of a multi-step app.
func (c *Context) Render(markup string, format ...protocol.DocFormat) {
	*c.queued = append(*c.queued, protocol.Render(markup, docFormat(format)))
}

// Replace swaps one addressable container for normalized fragment blocks.
func (c *Context) Replace(target, markup string, format ...protocol.DocFormat) {
	*c.queued = append(*c.queued, protocol.Replace(target, markup, docFormat(format)))
}

// Append adds normalized fragment blocks to an addressable container.
func (c *Context) Append(target, markup string, format ...protocol.DocFormat) {
	*c.queued = append(*c.queued, protocol.Append(target, markup, docFormat(format)))
}

// Remove deletes one addressable container and its subtree.
func (c *Context) Remove(target string) {
	*c.queued = append(*c.queued, protocol.Remove(target))
}

// Values returns values seen so far, keyed by widget id.
//
// This accumulates from change and toggle events rather than reading engine
// state, so a widget the user has not touched is absent. The map passed to
// OnClick is the engine's authoritative snapshot.
func (c *Context) Values() Values {
	if c.values == nil {
		return nil
	}
	return cloneValues(*c.values)
}

// Handlers reacts to semantic session events. Every field is optional.
type Handlers struct {
	OnChange func(id, value string, ctx *Context)
	OnToggle func(id string, checked bool, ctx *Context)
	OnClick  func(id string, values Values, ctx *Context)
	OnError  func(message string, ctx *Context)
}

// RunOptions configures Run and RunHeadless.
type RunOptions struct {
	engine.ResolveOptions
	ViewPath string
	Width    int
	Height   int
	Frames   protocol.FrameFormat
	Mode     protocol.FrameMode
	NoColor  bool
}

// ForTerminal returns options with dimensions read from the current terminal,
// so an application does not need its own terminal dependency just to seed
// the first frame.
func ForTerminal(viewPath string) (RunOptions, error) {
	width, height, err := terminal.Size()
	if err != nil {
		return RunOptions{}, err
	}
	return RunOptions{
		ViewPath: viewPath,
		Width:    width,
		Height:   height,
		Frames:   protocol.FrameANSI,
		Mode:     protocol.FramePatches,
	}, nil
}

// CommandSource supplies the next host→engine command. A nil command means the
// source had no mappable input yet and should be polled again.
type CommandSource interface {
	NextCommand() (*protocol.Command, error)
}

// Run drives handlers against this process's terminal.
//
// Spawns the engine, holds raw mode for the session, paints every frame, and
// returns the final widget values once a handler calls Context.Exit, the user
// presses Ctrl+C, or the engine ends the session. Terminal state is restored
// even when the loop fails.
func Run(opts RunOptions, handlers Handlers) (Values, error) {
	if !terminal.IsTerminal() {
		return nil, fmt.Errorf("app.Run needs a real terminal on stdin and stdout; use RunHeadless otherwise")
	}
	if opts.Width < 1 || opts.Height < 1 {
		sized, err := ForTerminal(opts.ViewPath)
		if err != nil {
			return nil, err
		}
		if opts.Width < 1 {
			opts.Width = sized.Width
		}
		if opts.Height < 1 {
			opts.Height = sized.Height
		}
	}

	session, buf, supportsScroll, err := start(opts)
	if err != nil {
		return nil, err
	}
	defer session.Close()

	raw, err := terminal.EnterRaw()
	if err != nil {
		return nil, err
	}
	defer raw.Close()
	if err := terminal.EnableMouseCapture(os.Stdout); err != nil {
		return nil, err
	}
	if err := terminal.Paint(os.Stdout, buf); err != nil {
		return nil, err
	}

	source := &readerSource{
		reader:         terminal.NewReader(os.Stdin),
		supportsScroll: supportsScroll,
	}
	return drive(session, buf, source, handlers, true)
}

// RunHeadless runs the same loop without raw mode or painting, driven by an
// injected command source. Intended for tests and for hosts that own rendering.
func RunHeadless(opts RunOptions, handlers Handlers, source CommandSource, width, height int) (Values, error) {
	if width < 1 {
		width = 60
	}
	if height < 1 {
		height = 24
	}
	opts.Width = width
	opts.Height = height

	session, buf, _, err := start(opts)
	if err != nil {
		return nil, err
	}
	defer session.Close()

	return drive(session, buf, source, handlers, false)
}

func start(opts RunOptions) (*engine.Session, *screen.Buffer, bool, error) {
	session, err := engine.Spawn(engine.SpawnOptions{
		ResolveOptions: opts.ResolveOptions,
		ViewPath:       opts.ViewPath,
		Width:          opts.Width,
		Height:         opts.Height,
		Frames:         opts.Frames,
		Mode:           opts.Mode,
		NoColor:        opts.NoColor,
	})
	if err != nil {
		return nil, nil, false, err
	}

	first, err := session.InitialFrame()
	if err != nil {
		session.Close()
		return nil, nil, false, err
	}
	supportsScroll := false
	for _, cap := range first.Capabilities {
		if cap == string(protocol.CapScroll) {
			supportsScroll = true
			break
		}
	}

	buf := screen.NewBuffer(screen.PreferredANSI)
	if err := buf.Apply(first); err != nil {
		session.Close()
		return nil, nil, false, err
	}
	return session, buf, supportsScroll, nil
}

func drive(
	session *engine.Session,
	buf *screen.Buffer,
	source CommandSource,
	handlers Handlers,
	paint bool,
) (Values, error) {
	initial := make(Values)
	values := &initial
	var queued []protocol.Command
	exit := false

commands:
	for {
		var cmd protocol.Command
		switch {
		case len(queued) > 0:
			cmd = queued[0]
			queued = queued[1:]
		case exit:
			cmd = protocol.Exit()
		default:
			next, err := source.NextCommand()
			if err != nil {
				return cloneValues(*values), err
			}
			if next == nil {
				continue
			}
			cmd = *next
		}

		closing := cmd.Type == "exit"
		if err := session.Send(cmd); err != nil {
			return cloneValues(*values), err
		}
		if closing {
			drainAfterExit(session)
			return cloneValues(*values), nil
		}

		for {
			ev, err := session.Next()
			if err != nil {
				return cloneValues(*values), err
			}
			switch ev.Type {
			case "frame":
				if err := buf.Apply(ev); err != nil {
					return cloneValues(*values), err
				}
				if paint {
					if err := terminal.Paint(os.Stdout, buf); err != nil {
						return cloneValues(*values), err
					}
				}
				continue commands
			case "change":
				(*values)[ev.ID] = ev.Value
				dispatchChange(handlers, ev.ID, ev.Value, values, &queued, &exit)
			case "toggle":
				(*values)[ev.ID] = strconv.FormatBool(ev.Checked)
				dispatchToggle(handlers, ev.ID, ev.Checked, values, &queued, &exit)
			case "click":
				*values = cloneValues(ev.Values)
				dispatchClick(handlers, ev.ID, cloneValues(ev.Values), values, &queued, &exit)
			case "error":
				dispatchError(handlers, ev.Message, values, &queued, &exit)
			case "exit":
				return cloneValues(*values), nil
			}
		}
	}
}

func drainAfterExit(session *engine.Session) {
	for {
		ev, err := session.Next()
		if err != nil || ev.Type == "exit" {
			return
		}
	}
}

func docFormat(format []protocol.DocFormat) protocol.DocFormat {
	if len(format) == 0 {
		return ""
	}
	return format[0]
}

func cloneValues(src map[string]string) Values {
	if src == nil {
		return make(Values)
	}
	out := make(Values, len(src))
	for key, value := range src {
		out[key] = value
	}
	return out
}

func newContext(values *Values, queued *[]protocol.Command, exit *bool) *Context {
	return &Context{values: values, queued: queued, exit: exit}
}

func dispatchChange(h Handlers, id, value string, values *Values, queued *[]protocol.Command, exit *bool) {
	if h.OnChange != nil {
		h.OnChange(id, value, newContext(values, queued, exit))
	}
}

func dispatchToggle(h Handlers, id string, checked bool, values *Values, queued *[]protocol.Command, exit *bool) {
	if h.OnToggle != nil {
		h.OnToggle(id, checked, newContext(values, queued, exit))
	}
}

func dispatchClick(h Handlers, id string, snapshot Values, values *Values, queued *[]protocol.Command, exit *bool) {
	if h.OnClick != nil {
		h.OnClick(id, snapshot, newContext(values, queued, exit))
	}
}

func dispatchError(h Handlers, message string, values *Values, queued *[]protocol.Command, exit *bool) {
	if h.OnError != nil {
		h.OnError(message, newContext(values, queued, exit))
	}
}

type readerSource struct {
	reader         *terminal.Reader
	supportsScroll bool
}

func (r *readerSource) NextCommand() (*protocol.Command, error) {
	for {
		cmd, err := r.reader.ReadCommand()
		if err != nil {
			return nil, err
		}
		if cmd == nil {
			continue
		}
		if cmd.Type == "scroll" {
			mapped := terminal.MapScroll(cmd.ScrollRows, r.supportsScroll)
			return &mapped, nil
		}
		return cmd, nil
	}
}

// ScriptedCommands feeds a fixed command sequence for tests.
type ScriptedCommands struct {
	queue []protocol.Command
}

// NewScriptedCommands returns a source that emits cmds in order.
func NewScriptedCommands(cmds ...protocol.Command) *ScriptedCommands {
	return &ScriptedCommands{queue: append([]protocol.Command(nil), cmds...)}
}

// TypingCommands returns char commands for each rune in s.
func TypingCommands(s string) *ScriptedCommands {
	queue := make([]protocol.Command, 0, len(s))
	for _, ch := range s {
		queue = append(queue, protocol.Char(string(ch)))
	}
	return &ScriptedCommands{queue: queue}
}

// NextCommand implements CommandSource.
func (s *ScriptedCommands) NextCommand() (*protocol.Command, error) {
	if len(s.queue) == 0 {
		return nil, io.EOF
	}
	cmd := s.queue[0]
	s.queue = s.queue[1:]
	return &cmd, nil
}
