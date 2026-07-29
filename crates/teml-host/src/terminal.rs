//! Optional crossterm terminal lifecycle and input translation helpers.

use crate::protocol::{resize_command, Command, KeyModifiers, KeyName};
use crossterm::event::{
    self, DisableMouseCapture, EnableMouseCapture, Event, KeyCode, KeyEventKind,
    KeyModifiers as CrosstermModifiers, MouseButton, MouseEventKind,
};
use crossterm::terminal::{self, Clear, ClearType};
use crossterm::{cursor::MoveTo, ExecutableCommand};
use std::io::{self, Write};
use std::time::Duration;

const RESIZE_DEBOUNCE: Duration = Duration::from_millis(50);
const WHEEL_DEBOUNCE: Duration = Duration::from_millis(16);

/// Enables raw mode and mouse capture; restores the terminal on drop.
pub struct TermGuard;

impl TermGuard {
    /// Put stdin/stdout into the interactive host mode expected by TeML apps.
    pub fn new() -> io::Result<Self> {
        terminal::enable_raw_mode()?;
        io::stdout().execute(EnableMouseCapture)?;
        Ok(Self)
    }
}

impl Drop for TermGuard {
    fn drop(&mut self) {
        let _ = io::stdout().execute(DisableMouseCapture);
        let _ = terminal::disable_raw_mode();
    }
}

/// Repaint from a reconstructed screen buffer using crossterm clear + cursor home.
pub fn paint_terminal(screen: &crate::screen::ScreenBuffer) -> io::Result<()> {
    let mut out = io::stdout();
    out.execute(Clear(ClearType::All))?.execute(MoveTo(0, 0))?;
    write!(out, "{}", crate::paint::onlcr(&screen.text()))?;
    out.flush()
}

/// Abstraction over a blocking terminal event source (crossterm by default).
pub trait TerminalEvents {
    /// Read one terminal event.
    fn read(&mut self) -> io::Result<Event>;
    /// Poll with timeout.
    fn poll(&mut self, timeout: Duration) -> io::Result<bool>;
    /// Current terminal size in columns and rows.
    fn size(&mut self) -> io::Result<(u16, u16)>;
}

/// Default crossterm-backed event source.
pub struct CrosstermEvents;

impl TerminalEvents for CrosstermEvents {
    fn read(&mut self) -> io::Result<Event> {
        event::read()
    }

    fn poll(&mut self, timeout: Duration) -> io::Result<bool> {
        event::poll(timeout)
    }

    fn size(&mut self) -> io::Result<(u16, u16)> {
        terminal::size()
    }
}

/// Coalesced resize/scroll translation from terminal events to protocol commands.
pub struct TerminalInput<E> {
    events: E,
    pending: Option<Event>,
    last_size: (u16, u16),
    supports_scroll: bool,
}

impl<E: TerminalEvents> TerminalInput<E> {
    /// Create an input translator seeded with the current terminal size.
    pub fn new(initial_size: (u16, u16), events: E, supports_scroll: bool) -> Self {
        Self {
            events,
            pending: None,
            last_size: initial_size,
            supports_scroll,
        }
    }

    /// Read the next protocol command, coalescing resize storms and wheel deltas.
    pub fn next_command(&mut self) -> io::Result<Option<Command>> {
        let event = match self.pending.take() {
            Some(event) => event,
            None => self.events.read()?,
        };
        if matches!(event, Event::Resize(_, _)) {
            return self.coalesced_resize();
        }
        if matches!(
            event,
            Event::Mouse(ref mouse)
                if matches!(mouse.kind, MouseEventKind::ScrollUp | MouseEventKind::ScrollDown)
        ) {
            return self.coalesced_scroll(event);
        }
        Ok(map_terminal_event(event))
    }

    fn coalesced_resize(&mut self) -> io::Result<Option<Command>> {
        while self.events.poll(RESIZE_DEBOUNCE)? {
            match self.events.read()? {
                Event::Resize(_, _) => continue,
                event => {
                    self.pending = Some(event);
                    break;
                }
            }
        }

        let size = self.events.size()?;
        if size == self.last_size {
            return Ok(None);
        }
        self.last_size = size;
        Ok(Some(resize_command(size.0, size.1)))
    }

    fn coalesced_scroll(&mut self, first: Event) -> io::Result<Option<Command>> {
        let mut rows = wheel_rows(&first);
        while self.events.poll(WHEEL_DEBOUNCE)? {
            let event = self.events.read()?;
            let delta = wheel_rows(&event);
            if delta == 0 {
                self.pending = Some(event);
                break;
            }
            rows = (rows + delta).clamp(-10_000, 10_000);
        }
        if rows == 0 {
            return Ok(None);
        }
        if self.supports_scroll {
            Ok(Some(Command::Scroll { rows }))
        } else if rows < 0 {
            Ok(Some(Command::Key {
                key: KeyName::PageUp,
                modifiers: None,
            }))
        } else {
            Ok(Some(Command::Key {
                key: KeyName::PageDown,
                modifiers: None,
            }))
        }
    }
}

fn wheel_rows(event: &Event) -> i64 {
    match event {
        Event::Mouse(mouse) if mouse.kind == MouseEventKind::ScrollUp => -3,
        Event::Mouse(mouse) if mouse.kind == MouseEventKind::ScrollDown => 3,
        _ => 0,
    }
}

fn map_terminal_event(event: Event) -> Option<Command> {
    match event {
        Event::Key(k) if k.kind == KeyEventKind::Press => match (k.code, k.modifiers) {
            (KeyCode::Char('c'), m) if m.contains(CrosstermModifiers::CONTROL) => {
                Some(Command::Exit)
            }
            (KeyCode::Tab, m) if m.contains(CrosstermModifiers::SHIFT) => Some(Command::Key {
                key: KeyName::ShiftTab,
                modifiers: None,
            }),
            (KeyCode::Tab, m) => Some(key_command(KeyName::Tab, m)),
            (KeyCode::BackTab, _) => Some(Command::Key {
                key: KeyName::ShiftTab,
                modifiers: None,
            }),
            (KeyCode::Enter, m) => Some(key_command(KeyName::Enter, m)),
            (KeyCode::Backspace, m) => Some(key_command(KeyName::Backspace, m)),
            (KeyCode::Up, m) => Some(key_command(KeyName::Up, m)),
            (KeyCode::Down, m) => Some(key_command(KeyName::Down, m)),
            (KeyCode::Left, m) => Some(key_command(KeyName::Left, m)),
            (KeyCode::Right, m) => Some(key_command(KeyName::Right, m)),
            (KeyCode::Home, m) => Some(key_command(KeyName::Home, m)),
            (KeyCode::End, m) => Some(key_command(KeyName::End, m)),
            (KeyCode::Delete, m) => Some(key_command(KeyName::Delete, m)),
            (KeyCode::PageUp, m) => Some(key_command(KeyName::PageUp, m)),
            (KeyCode::PageDown, m) => Some(key_command(KeyName::PageDown, m)),
            (KeyCode::F(number @ 1..=12), m) => Some(key_command(f_key(number), m)),
            (KeyCode::Esc, _) => Some(Command::Key {
                key: KeyName::Escape,
                modifiers: None,
            }),
            (KeyCode::Char(c), m)
                if !m.intersects(CrosstermModifiers::CONTROL | CrosstermModifiers::ALT) =>
            {
                Some(Command::Char { ch: c.to_string() })
            }
            _ => None,
        },
        Event::Mouse(m) => match m.kind {
            MouseEventKind::Down(MouseButton::Left) => Some(Command::Pointer {
                row: u64::from(m.row),
                col: u64::from(m.column),
            }),
            _ => None,
        },
        _ => None,
    }
}

fn key_command(key: KeyName, modifiers: CrosstermModifiers) -> Command {
    let encoded = encode_modifiers(modifiers);
    Command::Key {
        key,
        modifiers: encoded,
    }
}

fn encode_modifiers(modifiers: CrosstermModifiers) -> Option<KeyModifiers> {
    let mut out = KeyModifiers::default();
    if modifiers.contains(CrosstermModifiers::CONTROL) {
        out.ctrl = Some(true);
    }
    if modifiers.contains(CrosstermModifiers::ALT) {
        out.alt = Some(true);
    }
    if modifiers.contains(CrosstermModifiers::SHIFT) {
        out.shift = Some(true);
    }
    if out.ctrl.is_none() && out.alt.is_none() && out.shift.is_none() {
        None
    } else {
        Some(out)
    }
}

fn f_key(number: u8) -> KeyName {
    match number {
        1 => KeyName::F1,
        2 => KeyName::F2,
        3 => KeyName::F3,
        4 => KeyName::F4,
        5 => KeyName::F5,
        6 => KeyName::F6,
        7 => KeyName::F7,
        8 => KeyName::F8,
        9 => KeyName::F9,
        10 => KeyName::F10,
        11 => KeyName::F11,
        _ => KeyName::F12,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crossterm::event::{KeyEvent, MouseEvent};
    use std::collections::VecDeque;

    fn key(code: KeyCode, modifiers: CrosstermModifiers) -> Event {
        Event::Key(KeyEvent::new(code, modifiers))
    }

    fn wheel(kind: MouseEventKind) -> Event {
        Event::Mouse(MouseEvent {
            kind,
            column: 0,
            row: 0,
            modifiers: CrosstermModifiers::NONE,
        })
    }

    struct FakeEvents {
        queued: VecDeque<Event>,
        size: (u16, u16),
    }

    impl TerminalEvents for FakeEvents {
        fn read(&mut self) -> io::Result<Event> {
            self.queued.pop_front().ok_or_else(|| {
                io::Error::new(io::ErrorKind::UnexpectedEof, "fake event queue is empty")
            })
        }

        fn poll(&mut self, _timeout: Duration) -> io::Result<bool> {
            Ok(!self.queued.is_empty())
        }

        fn size(&mut self) -> io::Result<(u16, u16)> {
            Ok(self.size)
        }
    }

    #[test]
    fn resize_storm_coalesces_and_preserves_the_following_key() {
        let events = FakeEvents {
            queued: VecDeque::from([
                Event::Resize(90, 30),
                Event::Resize(100, 40),
                Event::Key(KeyEvent::new(KeyCode::Char('x'), CrosstermModifiers::NONE)),
            ]),
            size: (100, 40),
        };
        let mut input = TerminalInput::new((80, 24), events, true);

        assert_eq!(
            input.next_command().expect("resize"),
            Some(resize_command(100, 40))
        );
        assert_eq!(
            input.next_command().expect("char"),
            Some(Command::Char { ch: "x".into() })
        );
    }

    #[test]
    fn maps_supported_key_modifiers_and_keeps_ctrl_c_as_exit() {
        assert_eq!(
            map_terminal_event(key(
                KeyCode::Enter,
                CrosstermModifiers::CONTROL | CrosstermModifiers::SHIFT,
            )),
            Some(Command::Key {
                key: KeyName::Enter,
                modifiers: Some(KeyModifiers {
                    ctrl: Some(true),
                    alt: None,
                    shift: Some(true),
                }),
            })
        );
        assert_eq!(
            map_terminal_event(key(KeyCode::Char('c'), CrosstermModifiers::CONTROL)),
            Some(Command::Exit)
        );
    }

    #[test]
    fn wheel_input_gates_scroll_on_the_advertised_capability() {
        let advertised: crate::protocol::Frame = serde_json::from_value(serde_json::json!({
            "type": "frame",
            "seq": 1,
            "focusedId": null,
            "plain": "ready\n",
            "ansi": null,
            "protocol": {"major": 1, "minor": 2},
            "capabilities": [crate::protocol::CAPABILITY_SCROLL]
        }))
        .expect("metadata frame");
        let mut advertised_screen =
            crate::screen::ScreenBuffer::new(crate::screen::PreferredFrame::Plain);
        advertised_screen
            .apply(&advertised)
            .expect("apply metadata frame");
        let scrolling = FakeEvents {
            queued: VecDeque::from([wheel(MouseEventKind::ScrollDown)]),
            size: (80, 24),
        };
        let mut supported = TerminalInput::new(
            (80, 24),
            scrolling,
            advertised_screen.has_capability(crate::protocol::CAPABILITY_SCROLL),
        );
        assert_eq!(
            supported.next_command().expect("supported wheel"),
            Some(Command::Scroll { rows: 3 })
        );

        let transcript_path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../tests/system/snapshots/interactive-v1.ndjson"
        );
        let transcript = std::fs::read_to_string(transcript_path).expect("shared transcript");
        let legacy_frame = match crate::protocol::Event::from_line(
            transcript.lines().next().expect("initial v1 frame"),
        )
        .expect("decode initial v1 frame")
        {
            crate::protocol::Event::Frame(frame) => frame,
            event => panic!("expected initial frame, got {event:?}"),
        };
        let mut legacy_screen =
            crate::screen::ScreenBuffer::new(crate::screen::PreferredFrame::Plain);
        legacy_screen
            .apply(&legacy_frame)
            .expect("apply initial v1 frame");
        let fallback = FakeEvents {
            queued: VecDeque::from([wheel(MouseEventKind::ScrollUp)]),
            size: (80, 24),
        };
        let mut unsupported = TerminalInput::new(
            (80, 24),
            fallback,
            legacy_screen.has_capability(crate::protocol::CAPABILITY_SCROLL),
        );
        assert_eq!(
            unsupported.next_command().expect("fallback wheel"),
            Some(Command::Key {
                key: KeyName::PageUp,
                modifiers: None,
            })
        );
    }
}
