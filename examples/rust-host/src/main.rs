//! An interactive terminal app with an **HTML view**, a **Rust controller**,
//! and **TeML as the terminal runtime** — the pattern from
//! docs/interactive-protocol.md with Rust as the host language.
//!
//! Run it from this directory:
//!
//! ```sh
//! cargo run
//! ```
//!
//! TeML engine discovery is handled by the [`teml_host`] crate; see its README.

use std::io::IsTerminal;
use std::path::PathBuf;
use teml_host::{
    paint_terminal,
    terminal::{CrosstermEvents, TermGuard, TerminalInput},
    Command, DocFormat, Event, PreferredFrame, ScreenBuffer, Session, SessionOptions,
};

const VIEW: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/view.html");

fn main() -> Result<(), Box<dyn std::error::Error>> {
    if !std::io::stdin().is_terminal() || !std::io::stdout().is_terminal() {
        eprintln!("teml-rust-host needs a real terminal — run it directly, not piped.");
        std::process::exit(1);
    }

    let initial_size = crossterm::terminal::size()?;
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let options = SessionOptions::new(VIEW, initial_size.0, initial_size.1)
        .with_default_package_scripts(&manifest);
    let mut session = Session::spawn(options)?;
    eprintln!("{}", session.engine().diagnostics());

    let first_frame = session.initial_frame()?;
    let supports_scroll = first_frame
        .capabilities
        .as_deref()
        .is_some_and(|caps| caps.iter().any(|cap| cap == "scroll"));
    let mut screen = ScreenBuffer::new(PreferredFrame::Ansi);
    screen.apply(&first_frame)?;

    let guard = TermGuard::new()?;
    paint_terminal(&screen)?;

    let mut terminal_input = TerminalInput::new(initial_size, CrosstermEvents, supports_scroll);
    let outcome = event_loop(&mut session, &mut screen, &mut terminal_input)?;

    drop(guard);
    match outcome {
        Some(message) => println!("{message}"),
        None => println!("Session ended without submission."),
    }
    Ok(())
}

fn event_loop(
    session: &mut Session,
    screen: &mut ScreenBuffer,
    terminal_input: &mut TerminalInput<CrosstermEvents>,
) -> Result<Option<String>, Box<dyn std::error::Error>> {
    let mut done: Option<String> = None;

    'input: loop {
        let Some(command) = terminal_input.next_command()? else {
            continue 'input;
        };
        session.send(&command)?;

        'events: loop {
            match session.next_event()? {
                Event::Frame(frame) => {
                    screen.apply(&frame)?;
                    paint_terminal(screen)?;
                    if done.is_none() {
                        break 'events;
                    }
                }
                Event::Click { id, values } => match id.as_str() {
                    "cancel" => {
                        done = Some("Cancelled — no incident handoff sent.".into());
                        session.send(&Command::Exit)?;
                    }
                    "submit" => match validate(&values) {
                        Ok(()) => {
                            done = Some(format!(
                                "Incident handoff sent!\n  service:  {}\n  severity: {}\n  summary:  {}\n  paged:    {}",
                                values.get("service").map(String::as_str).unwrap_or(""),
                                values.get("severity").map(String::as_str).unwrap_or(""),
                                values
                                    .get("summary")
                                    .map(String::as_str)
                                    .unwrap_or("")
                                    .replace('\n', " / "),
                                if values.get("page").map(String::as_str) == Some("true") {
                                    "yes"
                                } else {
                                    "no"
                                },
                            ));
                            session.send(&Command::Exit)?;
                        }
                        Err(message) => {
                            session.send(&Command::Render {
                                markup: screen_html(&message),
                                format: Some(DocFormat::Html),
                            })?;
                        }
                    },
                    _ => {}
                },
                Event::Error { message } => {
                    eprintln!("\r\n[teml] {message}\r\n");
                }
                Event::Exit => break 'input,
                Event::Change { .. } | Event::Toggle { .. } | Event::Unknown => {}
            }
        }
    }
    Ok(done)
}

fn validate(values: &std::collections::HashMap<String, String>) -> Result<(), String> {
    let get = |key: &str| values.get(key).map(String::as_str).unwrap_or("").trim();
    if get("service").is_empty() {
        return Err("Affected service is required.".into());
    }
    if get("summary").is_empty() {
        return Err("Operator summary is required.".into());
    }
    Ok(())
}

fn screen_html(error: &str) -> String {
    let base = include_str!("../view.html");
    base.replace(
        "</h2>",
        &format!("</h2>\n<div class=\"alert alert-danger\">{error}</div>"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn values(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(key, value)| ((*key).into(), (*value).into()))
            .collect()
    }

    #[test]
    fn validate_requires_an_affected_service() {
        let v = values(&[("service", "   "), ("summary", "Rollback in progress")]);
        assert_eq!(
            validate(&v),
            Err("Affected service is required.".to_string())
        );
    }

    #[test]
    fn validate_requires_an_operator_summary() {
        let v = values(&[("service", "api"), ("summary", "   ")]);
        assert_eq!(
            validate(&v),
            Err("Operator summary is required.".to_string())
        );
    }

    #[test]
    fn error_screen_injects_alert_after_the_heading() {
        let html = screen_html("Operator summary is required.");
        assert!(
            html.contains(r#"<div class="alert alert-danger">Operator summary is required.</div>"#)
        );
        assert!(html.find("alert-danger") > html.find("</h2>"));
        for id in ["service", "sev3", "summary", "page", "submit", "cancel"] {
            assert!(html.contains(&format!(r#"id="{id}""#)));
        }
        assert!(html.contains(r#"data-id="telemetry""#));
    }
}
