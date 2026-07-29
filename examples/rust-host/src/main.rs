//! An interactive terminal app with an **HTML view**, a **Rust controller**, and
//! **TeML as the terminal runtime** — the pattern from
//! docs/interactive-protocol.md with Rust as the host language.
//!
//! The view is [`view.html`](../view.html), shared byte-for-byte with the Go and
//! Python examples. Nothing below draws, wraps, positions, or styles anything:
//! [`teml_host::run`] owns the terminal and the event loop, and this file only
//! says what happens when the operator acts.
//!
//! Run it from this directory:
//!
//! ```sh
//! cargo run
//! ```
//!
//! TeML engine discovery is handled by the [`teml_host`] crate; see its README.

use std::path::PathBuf;
use teml_host::{App, Context, DocFormat, SessionOptions, Values};

const VIEW: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/view.html");

#[derive(Default)]
struct IncidentHandoff {
    outcome: Option<String>,
}

impl App for IncidentHandoff {
    fn on_click(&mut self, id: &str, values: &Values, ctx: &mut Context<'_>) {
        match id {
            "cancel" => {
                self.outcome = Some("Cancelled — no incident handoff sent.".into());
                ctx.exit();
            }
            "submit" => match validate(values) {
                Ok(()) => {
                    self.outcome = Some(handoff_summary(values));
                    ctx.exit();
                }
                // Re-render the same view with an alert; widget values, focus,
                // and scroll position survive because the engine preserves them.
                Err(message) => ctx.render(screen_html(&message), Some(DocFormat::Html)),
            },
            _ => {}
        }
    }

    fn on_error(&mut self, message: &str, _ctx: &mut Context<'_>) {
        eprintln!("\r\n[teml] {message}\r\n");
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let options = SessionOptions::for_terminal(VIEW)?.with_default_package_scripts(&manifest);

    let mut app = IncidentHandoff::default();
    teml_host::run(options, &mut app)?;

    println!(
        "{}",
        app.outcome
            .unwrap_or_else(|| "Session ended without submission.".into())
    );
    Ok(())
}

fn validate(values: &Values) -> Result<(), String> {
    let get = |key: &str| values.get(key).map(String::as_str).unwrap_or("").trim();
    if get("service").is_empty() {
        return Err("Affected service is required.".into());
    }
    if get("summary").is_empty() {
        return Err("Operator summary is required.".into());
    }
    Ok(())
}

fn handoff_summary(values: &Values) -> String {
    let get = |key: &str| values.get(key).map(String::as_str).unwrap_or("");
    format!(
        "Incident handoff sent!\n  service:  {}\n  severity: {}\n  summary:  {}\n  paged:    {}",
        get("service"),
        get("severity"),
        get("summary").replace('\n', " / "),
        if get("page") == "true" { "yes" } else { "no" },
    )
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

    fn values(pairs: &[(&str, &str)]) -> Values {
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
    fn summarizes_a_submitted_handoff() {
        let v = values(&[
            ("service", "api"),
            ("severity", "sev2"),
            ("summary", "Rollback started\nlatency recovering"),
            ("page", "true"),
        ]);
        let summary = handoff_summary(&v);
        assert!(summary.contains("severity: sev2"));
        assert!(summary.contains("Rollback started / latency recovering"));
        assert!(summary.contains("paged:    yes"));
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
