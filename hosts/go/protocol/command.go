package protocol

import "encoding/json"

// CanvasOperation is one drawing operation in a canvas frame batch.
type CanvasOperation struct {
	Op     string  `json:"-"`
	Color  string  `json:"-"`
	X      float64 `json:"-"`
	Y      float64 `json:"-"`
	Width  float64 `json:"-"`
	Height float64 `json:"-"`
}

// MarshalJSON preserves the operation-specific wire shape, including zero coordinates.
func (op CanvasOperation) MarshalJSON() ([]byte, error) {
	switch op.Op {
	case "clear":
		return json.Marshal(struct {
			Op string `json:"op"`
		}{Op: "clear"})
	case "fillStyle":
		return json.Marshal(struct {
			Op    string `json:"op"`
			Color string `json:"color"`
		}{Op: "fillStyle", Color: op.Color})
	case "fillRect":
		return json.Marshal(struct {
			Op     string  `json:"op"`
			X      float64 `json:"x"`
			Y      float64 `json:"y"`
			Width  float64 `json:"width"`
			Height float64 `json:"height"`
		}{Op: "fillRect", X: op.X, Y: op.Y, Width: op.Width, Height: op.Height})
	default:
		return json.Marshal(op)
	}
}

// Command is one host→engine message on stdin.
type Command struct {
	Type string `json:"type"`

	// configure
	Frames FrameFormat `json:"frames,omitempty"`
	Mode   FrameMode   `json:"mode,omitempty"`

	// key
	Key       KeyName       `json:"key,omitempty"`
	Modifiers *KeyModifiers `json:"modifiers,omitempty"`

	// char
	Char string `json:"char,omitempty"`

	// pointer
	Row int `json:"-"`
	Col int `json:"-"`

	// scroll
	ScrollRows int `json:"-"`

	// resize
	Width  int `json:"width,omitempty"`
	Height int `json:"height,omitempty"`

	// render
	Markup string    `json:"markup,omitempty"`
	Format DocFormat `json:"format,omitempty"`

	// update (protocol 1.2, capability-gated)
	UpdateID    string            `json:"-"`
	UpdateProps map[string]string `json:"-"`

	// replace/append/remove (protocol 1.3, capability-gated)
	MutationTarget string `json:"-"`

	// canvas (protocol 1.6, capability-gated)
	CanvasID  string            `json:"-"`
	CanvasOps []CanvasOperation `json:"-"`
}

// MarshalNDJSON encodes one command without leaking zero-valued fields across types.
func (c Command) MarshalNDJSON() ([]byte, error) {
	switch c.Type {
	case "configure":
		out := struct {
			Type   string      `json:"type"`
			Frames FrameFormat `json:"frames"`
			Mode   FrameMode   `json:"mode,omitempty"`
		}{Type: "configure", Frames: c.Frames, Mode: c.Mode}
		return json.Marshal(out)
	case "key":
		out := struct {
			Type      string        `json:"type"`
			Key       KeyName       `json:"key"`
			Modifiers *KeyModifiers `json:"modifiers,omitempty"`
		}{Type: "key", Key: c.Key, Modifiers: c.Modifiers}
		return json.Marshal(out)
	case "char":
		return json.Marshal(struct {
			Type string `json:"type"`
			Char string `json:"char"`
		}{Type: "char", Char: c.Char})
	case "pointer":
		return json.Marshal(struct {
			Type string `json:"type"`
			Row  int    `json:"row"`
			Col  int    `json:"col"`
		}{Type: "pointer", Row: c.Row, Col: c.Col})
	case "scroll":
		return json.Marshal(struct {
			Type string `json:"type"`
			Rows int    `json:"rows"`
		}{Type: "scroll", Rows: c.ScrollRows})
	case "resize":
		out := struct {
			Type   string `json:"type"`
			Width  int    `json:"width"`
			Height int    `json:"height,omitempty"`
		}{Type: "resize", Width: c.Width, Height: c.Height}
		return json.Marshal(out)
	case "render":
		out := struct {
			Type   string    `json:"type"`
			Markup string    `json:"markup"`
			Format DocFormat `json:"format,omitempty"`
		}{Type: "render", Markup: c.Markup, Format: c.Format}
		return json.Marshal(out)
	case "update":
		return json.Marshal(struct {
			Type  string            `json:"type"`
			ID    string            `json:"id"`
			Props map[string]string `json:"props"`
		}{Type: "update", ID: c.UpdateID, Props: c.UpdateProps})
	case "replace", "append":
		out := struct {
			Type   string    `json:"type"`
			Target string    `json:"target"`
			Markup string    `json:"markup"`
			Format DocFormat `json:"format,omitempty"`
		}{Type: c.Type, Target: c.MutationTarget, Markup: c.Markup, Format: c.Format}
		return json.Marshal(out)
	case "remove":
		return json.Marshal(struct {
			Type   string `json:"type"`
			Target string `json:"target"`
		}{Type: "remove", Target: c.MutationTarget})
	case "canvas":
		return json.Marshal(struct {
			Type string            `json:"type"`
			ID   string            `json:"id"`
			Ops  []CanvasOperation `json:"ops"`
		}{Type: "canvas", ID: c.CanvasID, Ops: c.CanvasOps})
	case "exit":
		return json.Marshal(struct {
			Type string `json:"type"`
		}{Type: "exit"})
	default:
		return json.Marshal(c)
	}
}

// Configure returns a frame negotiation command.
func Configure(frames FrameFormat, mode FrameMode) Command {
	return Command{Type: "configure", Frames: frames, Mode: mode}
}

// Key returns a normalized key command.
func Key(key KeyName, modifiers *KeyModifiers) Command {
	cmd := Command{Type: "key", Key: key}
	if modifiers != nil {
		cmd.Modifiers = modifiers
	}
	return cmd
}

// Char returns a literal text command.
func Char(char string) Command {
	return Command{Type: "char", Char: char}
}

// Pointer returns a mouse click command (0-indexed row/col).
func Pointer(row, col int) Command {
	return Command{Type: "pointer", Row: row, Col: col}
}

// Scroll returns a signed scroll command.
func Scroll(rows int) Command {
	return Command{Type: "scroll", ScrollRows: rows}
}

// Resize returns a terminal dimension command with positive integers.
func Resize(width, height int) Command {
	if width < 1 {
		width = 1
	}
	if height < 1 {
		height = 1
	}
	return Command{Type: "resize", Width: width, Height: height}
}

// Render returns a document replacement command.
func Render(markup string, format DocFormat) Command {
	cmd := Command{Type: "render", Markup: markup}
	if format != "" {
		cmd.Format = format
	}
	return cmd
}

// Update mutates a live updatable widget by id (requires engine "update" capability).
func Update(id string, props map[string]string) Command {
	copied := make(map[string]string, len(props))
	for key, value := range props {
		copied[key] = value
	}
	return Command{Type: "update", UpdateID: id, UpdateProps: copied}
}

// Replace swaps an addressable container for normalized fragment blocks.
func Replace(target, markup string, format DocFormat) Command {
	return mutationWithMarkup("replace", target, markup, format)
}

// Append adds normalized fragment blocks to an addressable container.
func Append(target, markup string, format DocFormat) Command {
	return mutationWithMarkup("append", target, markup, format)
}

func mutationWithMarkup(commandType, target, markup string, format DocFormat) Command {
	cmd := Command{
		Type:           commandType,
		MutationTarget: target,
		Markup:         markup,
	}
	if format != "" {
		cmd.Format = format
	}
	return cmd
}

// Remove deletes an addressable container and its subtree.
func Remove(target string) Command {
	return Command{Type: "remove", MutationTarget: target}
}

// Canvas returns one complete drawing batch for a declarative canvas.
func Canvas(id string, ops []CanvasOperation) Command {
	copied := append([]CanvasOperation(nil), ops...)
	return Command{Type: "canvas", CanvasID: id, CanvasOps: copied}
}

// Exit ends the session.
func Exit() Command {
	return Command{Type: "exit"}
}
