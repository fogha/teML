package terminal

import (
	"github.com/fogha/teml/hosts/go/protocol"
)

// MapKey maps a logical key name and modifier flags to a protocol command.
func MapKey(key protocol.KeyName, ctrl, alt, shift bool) protocol.Command {
	var mods *protocol.KeyModifiers
	if ctrl || alt || shift {
		mods = &protocol.KeyModifiers{Ctrl: ctrl, Alt: alt, Shift: shift}
	}
	return protocol.Key(key, mods)
}

// MapRune maps a printable rune to a char command when no control modifiers apply.
func MapRune(r rune) protocol.Command {
	return protocol.Char(string(r))
}

// MapPointer maps a 0-indexed mouse cell to a pointer command.
//
// Terminal libraries differ on indexing: some report 1-based SGR coordinates
// that must be decremented before calling this helper. The TeML protocol
// always uses 0-indexed row/col within the last frame's visible buffer.
func MapPointer(row, col int) protocol.Command {
	return protocol.Pointer(row, col)
}

// MapResize maps terminal dimensions to a resize command with positive ints.
func MapResize(width, height int) protocol.Command {
	return protocol.Resize(width, height)
}

// MapScroll maps a signed wheel delta to scroll rows when the engine advertises
// the scroll capability; otherwise callers should emit pageUp/pageDown keys.
func MapScroll(rows int, supportsScroll bool) protocol.Command {
	if supportsScroll {
		return protocol.Scroll(rows)
	}
	if rows < 0 {
		return protocol.Key(protocol.KeyPageUp, nil)
	}
	return protocol.Key(protocol.KeyPageDown, nil)
}
