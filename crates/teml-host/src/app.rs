//! Handler-driven application loop.
//!
//! [`Session`] and [`ScreenBuffer`] let an application own its event loop, which
//! is the right level of control when an app needs to do something unusual.
//! Most apps do not: they want to say what happens when a button is clicked.
//!
//! [`run`] owns the loop, the terminal, and frame painting, and calls [`App`]
//! methods for semantic events. The `on_change`/`on_toggle`/`on_click`/`on_error`
//! contract and the [`Context`] actions mirror what the Node host exposes
//! through `runInteractiveApp`, so the same view behaves the same way whichever
//! language drives it.

use std::collections::{HashMap, VecDeque};
use std::io::IsTerminal;

use crate::protocol::{Command, DocFormat, Event, CAPABILITY_SCROLL};
use crate::screen::{PreferredFrame, ScreenBuffer};
use crate::session::{Session, SessionError, SessionOptions};
use crate::terminal::{paint_terminal, CrosstermEvents, TermGuard, TerminalEvents, TerminalInput};

/// Widget values keyed by id. Checkbox values are `"true"` or `"false"`.
pub type Values = HashMap<String, String>;

/// Lets a handler act on the running session without reaching into internals.
///
/// Requests are queued and sent once the handler returns, so a handler can never
/// interleave commands with the event stream it is being dispatched from.
pub struct Context<'a> {
    values: &'a Values,
    queued: &'a mut VecDeque<Command>,
    exit: &'a mut bool,
}

impl Context<'_> {
    /// Ends the loop; [`run`] returns the final widget values.
    pub fn exit(&mut self) {
        *self.exit = true;
    }

    /// Swaps in a new document — for example the next screen of a multi-step app.
    pub fn render(&mut self, markup: impl Into<String>, format: Option<DocFormat>) {
        self.queued.push_back(Command::Render {
            markup: markup.into(),
            format,
        });
    }

    /// Replaces one addressable container with normalized fragment blocks.
    pub fn replace(
        &mut self,
        target: impl Into<String>,
        markup: impl Into<String>,
        format: Option<DocFormat>,
    ) {
        self.queued.push_back(Command::Replace {
            target: target.into(),
            markup: markup.into(),
            format,
        });
    }

    /// Appends normalized fragment blocks to an addressable container.
    pub fn append(
        &mut self,
        target: impl Into<String>,
        markup: impl Into<String>,
        format: Option<DocFormat>,
    ) {
        self.queued.push_back(Command::Append {
            target: target.into(),
            markup: markup.into(),
            format,
        });
    }

    /// Removes one addressable container and its subtree.
    pub fn remove(&mut self, target: impl Into<String>) {
        self.queued.push_back(Command::Remove {
            target: target.into(),
        });
    }

    /// Values seen so far, keyed by widget id.
    ///
    /// This accumulates from `change` and `toggle` events rather than reading
    /// engine state, so a widget the user has not touched is absent. The map
    /// passed to [`App::on_click`] is the engine's authoritative snapshot.
    pub fn values(&self) -> &Values {
        self.values
    }
}

/// Reacts to semantic session events. Every method is optional.
pub trait App {
    /// An input or textarea value changed.
    fn on_change(&mut self, _id: &str, _value: &str, _ctx: &mut Context<'_>) {}

    /// A checkbox toggled.
    fn on_toggle(&mut self, _id: &str, _checked: bool, _ctx: &mut Context<'_>) {}

    /// A button was activated. `values` is the engine's authoritative snapshot.
    fn on_click(&mut self, _id: &str, _values: &Values, _ctx: &mut Context<'_>) {}

    /// The engine reported a recoverable protocol error.
    fn on_error(&mut self, _message: &str, _ctx: &mut Context<'_>) {}
}

/// Run `app` against this process's terminal.
///
/// Spawns the engine, holds raw mode for the session, paints every frame, and
/// returns the final widget values once a handler calls [`Context::exit`], the
/// user presses Ctrl+C, or the engine ends the session. Terminal state is
/// restored even when the loop fails.
pub fn run<A: App>(options: SessionOptions, app: &mut A) -> Result<Values, SessionError> {
    // Painting escape sequences into a pipe is never what the caller wanted, and
    // failing here beats a confusing raw-mode error further in.
    if !std::io::stdin().is_terminal() || !std::io::stdout().is_terminal() {
        return Err(SessionError::Io(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "teml_host::run needs a real terminal on stdin and stdout; use run_headless otherwise",
        )));
    }
    let size = crossterm::terminal::size()?;
    let (mut session, mut screen, supports_scroll) = start(options)?;
    let guard = TermGuard::new()?;
    paint_terminal(&screen)?;
    let mut input = TerminalInput::new(size, CrosstermEvents, supports_scroll);
    let outcome = drive(&mut session, &mut screen, &mut input, app, true);
    drop(guard);
    outcome
}

/// The same loop without raw mode or painting, driven by an injected event
/// source. Intended for tests and for hosts that own their own rendering.
pub fn run_headless<A: App, E: TerminalEvents>(
    options: SessionOptions,
    app: &mut A,
    events: E,
    size: (u16, u16),
) -> Result<Values, SessionError> {
    let (mut session, mut screen, supports_scroll) = start(options)?;
    let mut input = TerminalInput::new(size, events, supports_scroll);
    drive(&mut session, &mut screen, &mut input, app, false)
}

fn start(options: SessionOptions) -> Result<(Session, ScreenBuffer, bool), SessionError> {
    let mut session = Session::spawn(options)?;
    let mut screen = ScreenBuffer::new(PreferredFrame::Ansi);
    screen.apply(&session.initial_frame()?)?;
    let supports_scroll = screen.has_capability(CAPABILITY_SCROLL);
    Ok((session, screen, supports_scroll))
}

fn drive<A: App, E: TerminalEvents>(
    session: &mut Session,
    screen: &mut ScreenBuffer,
    input: &mut TerminalInput<E>,
    app: &mut A,
    paint: bool,
) -> Result<Values, SessionError> {
    let mut values = Values::new();
    let mut queued: VecDeque<Command> = VecDeque::new();
    let mut exit = false;

    loop {
        // Handler requests go first, so a rerender lands before the next
        // keystroke is read.
        let command = match queued.pop_front() {
            Some(command) => command,
            None if exit => Command::Exit,
            None => match input.next_command()? {
                Some(command) => command,
                // Not every terminal event maps to a protocol command.
                None => continue,
            },
        };

        let closing = matches!(command, Command::Exit);
        session.send(&command)?;
        if closing {
            drain_after_exit(session);
            return Ok(values);
        }

        // Every other command ends in exactly one frame.
        loop {
            match session.next_event()? {
                Event::Frame(frame) => {
                    screen.apply(&frame)?;
                    if paint {
                        paint_terminal(screen)?;
                    }
                    break;
                }
                Event::Change { id, value } => {
                    values.insert(id.clone(), value.clone());
                    let mut ctx = context(&values, &mut queued, &mut exit);
                    app.on_change(&id, &value, &mut ctx);
                }
                Event::Toggle { id, checked } => {
                    values.insert(id.clone(), checked.to_string());
                    let mut ctx = context(&values, &mut queued, &mut exit);
                    app.on_toggle(&id, checked, &mut ctx);
                }
                Event::Click {
                    id,
                    values: snapshot,
                } => {
                    values = snapshot;
                    let mut ctx = context(&values, &mut queued, &mut exit);
                    app.on_click(&id, &values, &mut ctx);
                }
                Event::Error { message } => {
                    let mut ctx = context(&values, &mut queued, &mut exit);
                    app.on_error(&message, &mut ctx);
                }
                // The engine can end the session on its own.
                Event::Exit => return Ok(values),
                Event::Unknown => {}
            }
        }
    }
}

fn context<'a>(
    values: &'a Values,
    queued: &'a mut VecDeque<Command>,
    exit: &'a mut bool,
) -> Context<'a> {
    Context {
        values,
        queued,
        exit,
    }
}

/// `exit` is answered with no frame, so consume whatever trailing events the
/// engine emits and treat a closed pipe as an ordinary end of session.
fn drain_after_exit(session: &mut Session) {
    loop {
        match session.next_event() {
            Ok(Event::Exit) | Err(_) => return,
            Ok(_) => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::default_package_scripts;
    use crate::EngineResolveOptions;
    use crossterm::event::{Event as TerminalEvent, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
    use std::io;
    use std::path::PathBuf;
    use std::time::Duration;

    struct ScriptedEvents {
        queued: VecDeque<TerminalEvent>,
    }

    impl ScriptedEvents {
        fn typing(chars: &str) -> Self {
            Self {
                queued: chars
                    .chars()
                    .map(|ch| {
                        TerminalEvent::Key(KeyEvent {
                            code: KeyCode::Char(ch),
                            modifiers: KeyModifiers::NONE,
                            kind: KeyEventKind::Press,
                            state: crossterm::event::KeyEventState::NONE,
                        })
                    })
                    .collect(),
            }
        }
    }

    impl TerminalEvents for ScriptedEvents {
        fn read(&mut self) -> io::Result<TerminalEvent> {
            self.queued
                .pop_front()
                .ok_or_else(|| io::Error::new(io::ErrorKind::UnexpectedEof, "script exhausted"))
        }

        fn poll(&mut self, _timeout: Duration) -> io::Result<bool> {
            Ok(!self.queued.is_empty())
        }

        fn size(&mut self) -> io::Result<(u16, u16)> {
            Ok((60, 20))
        }
    }

    fn manifest_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    }

    fn options() -> SessionOptions {
        SessionOptions {
            document: manifest_dir().join("../../examples/rust-host/view.html"),
            width: 60,
            height: None,
            frames: None,
            mode: None,
            no_color: true,
            engine: EngineResolveOptions {
                package_scripts: default_package_scripts(&manifest_dir()),
                ..Default::default()
            },
        }
    }

    #[derive(Default)]
    struct Recorder {
        changes: Vec<(String, String)>,
        errors: Vec<String>,
    }

    impl App for Recorder {
        fn on_change(&mut self, id: &str, value: &str, ctx: &mut Context<'_>) {
            self.changes.push((id.to_string(), value.to_string()));
            if self.changes.len() == 1 {
                // Swapping the document proves queued requests are delivered:
                // the next keystroke has to land in the replacement's input.
                ctx.render(
                    "<h2>Second screen</h2>\n<label for=\"other\">Other</label>\n<input id=\"other\">",
                    Some(DocFormat::Html),
                );
            } else {
                ctx.exit();
            }
        }

        fn on_error(&mut self, message: &str, _ctx: &mut Context<'_>) {
            self.errors.push(message.to_string());
        }
    }

    #[test]
    fn dispatches_changes_delivers_queued_requests_and_exits_with_values() {
        let mut recorder = Recorder::default();
        let values = run_headless(
            options(),
            &mut recorder,
            ScriptedEvents::typing("XY"),
            (60, 20),
        )
        .expect("driver runs against a built engine or TEML_CLI");

        assert!(recorder.errors.is_empty(), "errors: {:?}", recorder.errors);
        assert_eq!(recorder.changes.len(), 2);
        // The first keystroke edits the original view's focused input.
        assert_eq!(recorder.changes[0].0, "service");
        // The second lands in the document the handler rendered.
        assert_eq!(recorder.changes[1], ("other".to_string(), "Y".to_string()));
        assert_eq!(values.get("other").map(String::as_str), Some("Y"));
    }

    #[test]
    fn ctrl_c_ends_the_session_without_a_handler() {
        struct Passive;
        impl App for Passive {}

        let ctrl_c = TerminalEvent::Key(KeyEvent {
            code: KeyCode::Char('c'),
            modifiers: KeyModifiers::CONTROL,
            kind: KeyEventKind::Press,
            state: crossterm::event::KeyEventState::NONE,
        });
        let events = ScriptedEvents {
            queued: VecDeque::from(vec![ctrl_c]),
        };

        let values = run_headless(options(), &mut Passive, events, (60, 20))
            .expect("Ctrl+C is a clean end of session");
        assert!(values.is_empty());
    }
}
