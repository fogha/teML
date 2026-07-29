//! Protocol contract tests against an explicit built TeML engine.

use std::collections::HashMap;
use std::path::PathBuf;
use teml_host::{
    Command, DocFormat, Event, FrameFormat, FrameMode, KeyModifiers, KeyName, PreferredFrame,
    ScreenBuffer, Session, SessionOptions, CAPABILITY_DOCUMENT_MUTATIONS, CAPABILITY_UPDATE,
    PROTOCOL_MAJOR, PROTOCOL_MINOR,
};

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn view_path() -> PathBuf {
    manifest_dir().join("../../examples/rust-host/view.html")
}

fn spawn_session() -> Session {
    let options = SessionOptions {
        document: view_path(),
        width: 60,
        height: None,
        frames: None,
        mode: None,
        no_color: true,
        engine: teml_host::EngineResolveOptions {
            package_scripts: teml_host::default_package_scripts(&manifest_dir()),
            ..Default::default()
        },
    };
    Session::spawn(options).expect("teml engine must be built or available via TEML_CLI")
}

#[test]
fn html_incident_handoff_session_end_to_end() {
    let mut session = spawn_session();

    let event = session.next_event().expect("initial event");
    let Event::Frame(frame) = event else {
        panic!("expected frame event");
    };
    assert_eq!(frame.focused_id.as_deref(), Some("service"));
    assert!(frame
        .plain
        .as_deref()
        .is_some_and(|plain| plain.contains("Incident handoff")));

    session
        .send(&Command::Char {
            ch: "payments".into(),
        })
        .expect("send char");
    let Event::Change { id, value } = session.next_event().expect("change") else {
        panic!("expected change");
    };
    assert_eq!(id, "service");
    assert_eq!(value, "payments");
    assert!(matches!(
        session.next_event().expect("frame"),
        Event::Frame(_)
    ));

    session
        .send(&Command::Key {
            key: KeyName::Tab,
            modifiers: None,
        })
        .expect("tab");
    let Event::Frame(tab_frame) = session.next_event().expect("tab frame") else {
        panic!("expected frame");
    };
    assert_eq!(tab_frame.focused_id.as_deref(), Some("severity"));

    session
        .send(&Command::Key {
            key: KeyName::Right,
            modifiers: None,
        })
        .expect("right");
    assert!(matches!(
        session.next_event().expect("radio frame"),
        Event::Frame(_)
    ));
    session
        .send(&Command::Key {
            key: KeyName::Enter,
            modifiers: None,
        })
        .expect("enter");
    let Event::Change { id, value } = session.next_event().expect("severity change") else {
        panic!("expected change");
    };
    assert_eq!(id, "severity");
    assert_eq!(value, "sev2");
    assert!(matches!(
        session.next_event().expect("frame"),
        Event::Frame(_)
    ));

    session
        .send(&Command::Key {
            key: KeyName::Tab,
            modifiers: None,
        })
        .expect("tab summary");
    let Event::Frame(summary_frame) = session.next_event().expect("summary focus") else {
        panic!("expected frame");
    };
    assert_eq!(summary_frame.focused_id.as_deref(), Some("summary"));

    session
        .send(&Command::Char {
            ch: "Elevated latency\nRollback started".into(),
        })
        .expect("textarea");
    let Event::Change { id, value } = session.next_event().expect("summary change") else {
        panic!("expected change");
    };
    assert_eq!(id, "summary");
    assert_eq!(value, "Elevated latency\nRollback started");
    assert!(matches!(
        session.next_event().expect("frame"),
        Event::Frame(_)
    ));

    session
        .send(&Command::Key {
            key: KeyName::Enter,
            modifiers: Some(KeyModifiers {
                ctrl: Some(true),
                alt: None,
                shift: None,
            }),
        })
        .expect("ctrl enter");
    let Event::Frame(telemetry_frame) = session.next_event().expect("telemetry focus") else {
        panic!("expected frame");
    };
    assert_eq!(telemetry_frame.focused_id.as_deref(), Some("telemetry"));

    session.send(&Command::Scroll { rows: 2 }).expect("scroll");
    let Event::Frame(scroll_frame) = session.next_event().expect("scroll frame") else {
        panic!("expected frame");
    };
    let regions = scroll_frame.scroll_regions.expect("scroll regions");
    assert_eq!(regions[0].id, "telemetry");
    assert_eq!(regions[0].offset, 2);

    session
        .send(&Command::Key {
            key: KeyName::Tab,
            modifiers: None,
        })
        .expect("tab page");
    let Event::Frame(page_frame) = session.next_event().expect("page focus") else {
        panic!("expected frame");
    };
    assert_eq!(page_frame.focused_id.as_deref(), Some("page"));

    session
        .send(&Command::Key {
            key: KeyName::Enter,
            modifiers: None,
        })
        .expect("toggle");
    let Event::Toggle { id, checked } = session.next_event().expect("toggle") else {
        panic!("expected toggle");
    };
    assert_eq!(id, "page");
    assert!(checked);
    assert!(matches!(
        session.next_event().expect("frame"),
        Event::Frame(_)
    ));

    session
        .send(&Command::Key {
            key: KeyName::Tab,
            modifiers: None,
        })
        .expect("tab submit");
    let Event::Frame(submit_focus) = session.next_event().expect("submit focus") else {
        panic!("expected frame");
    };
    assert_eq!(submit_focus.focused_id.as_deref(), Some("submit"));

    session
        .send(&Command::Key {
            key: KeyName::Enter,
            modifiers: None,
        })
        .expect("submit");
    let Event::Click { id, values } = session.next_event().expect("click") else {
        panic!("expected click");
    };
    assert_eq!(id, "submit");
    assert_eq!(values.get("service").map(String::as_str), Some("payments"));
    assert_eq!(values.get("severity").map(String::as_str), Some("sev2"));
    assert_eq!(
        values.get("summary").map(String::as_str),
        Some("Elevated latency\nRollback started")
    );
    assert_eq!(values.get("page").map(String::as_str), Some("true"));
    assert!(!values.contains_key("telemetry"));
    assert!(matches!(
        session.next_event().expect("frame"),
        Event::Frame(_)
    ));

    session
        .send(&Command::Render {
            markup: "<h2>Incident handoff</h2><div class=\"alert alert-danger\">Summary is required.</div><label for=\"service\">Service</label><input id=\"service\"><label for=\"sev3\">SEV-3</label><input id=\"sev3\" type=\"radio\" name=\"severity\" value=\"sev3\"><label for=\"sev2\">SEV-2</label><input id=\"sev2\" type=\"radio\" name=\"severity\" value=\"sev2\"><label for=\"summary\">Summary</label><textarea id=\"summary\" rows=\"3\"></textarea><button id=\"submit\">Send</button>".into(),
            format: Some(DocFormat::Html),
        })
        .expect("render");
    let Event::Frame(rerender) = session.next_event().expect("rerender") else {
        panic!("expected frame");
    };
    let plain = rerender.plain.expect("plain");
    assert!(plain.contains("Summary is required."));
    assert!(plain.contains("[payments]"));
    assert!(plain.contains("(*) SEV-2"));

    session.send(&Command::Exit).expect("exit");
    assert!(matches!(
        session.next_event().expect("exit event"),
        Event::Exit
    ));
    let status = session.close().expect("close");
    assert!(status.success());
}

#[test]
fn full_and_patch_modes_reconstruct_identical_screens() {
    let script = [
        Command::Char {
            ch: "payments".into(),
        },
        Command::Key {
            key: KeyName::Tab,
            modifiers: None,
        },
        Command::Key {
            key: KeyName::Right,
            modifiers: None,
        },
        Command::Key {
            key: KeyName::Enter,
            modifiers: None,
        },
        Command::Key {
            key: KeyName::Tab,
            modifiers: None,
        },
        Command::Char {
            ch: "Rollback started".into(),
        },
        Command::Key {
            key: KeyName::Enter,
            modifiers: Some(KeyModifiers {
                ctrl: Some(true),
                alt: None,
                shift: None,
            }),
        },
        Command::Scroll { rows: 2 },
        Command::Key {
            key: KeyName::Tab,
            modifiers: None,
        },
        Command::Key {
            key: KeyName::Enter,
            modifiers: None,
        },
        Command::Key {
            key: KeyName::Tab,
            modifiers: None,
        },
    ];

    let full = run_scripted_session(&script, false);
    let patched = run_scripted_session(&script, true);

    assert_eq!(patched.screens, full.screens);
    assert!(patched.saw_patch);
    assert!(!full.saw_patch);
}

#[test]
fn resize_preserves_state_and_resynchronizes_patch_mode() {
    let mut session = spawn_session();
    let mut screen = ScreenBuffer::new(PreferredFrame::Plain);
    screen
        .apply(&session.initial_frame().expect("initial"))
        .expect("apply");

    session
        .send(&Command::Configure {
            frames: FrameFormat::Plain,
            mode: Some(FrameMode::Patches),
        })
        .expect("configure");
    screen
        .apply(&session.next_frame().expect("configure frame"))
        .expect("apply");

    session
        .send(&Command::Char {
            ch: "payments".into(),
        })
        .expect("char");
    let typed = session.next_frame().expect("typed");
    assert!(typed.is_patch());
    screen.apply(&typed).expect("apply");

    session
        .send(&Command::Key {
            key: KeyName::Left,
            modifiers: None,
        })
        .expect("left");
    screen
        .apply(&session.next_frame().expect("left frame"))
        .expect("apply");

    session
        .send(&Command::Resize {
            width: 20,
            height: Some(10),
        })
        .expect("resize");
    let resized = session.next_frame().expect("resized");
    assert!(!resized.is_patch());
    assert_eq!(resized.focused_id.as_deref(), Some("service"));
    screen.apply(&resized).expect("apply resized");
    assert!(screen.text().contains("[payment▏s]"));

    session
        .send(&Command::Char { ch: "!".into() })
        .expect("bang");
    let after = session.next_frame().expect("after");
    assert!(after.is_patch());
    screen.apply(&after).expect("apply after");
    assert!(screen.text().contains("[payment!▏s]"));

    session.send(&Command::Exit).expect("exit");
    assert!(matches!(session.next_event().expect("exit"), Event::Exit));
    let status = session.close().expect("close");
    assert!(status.success());
}

#[test]
fn richer_keys_and_modifiers_round_trip_through_the_session() {
    let mut session = spawn_session();
    let mut screen = ScreenBuffer::new(PreferredFrame::Plain);
    screen
        .apply(&session.initial_frame().expect("initial"))
        .expect("apply");

    session
        .send(&Command::Configure {
            frames: FrameFormat::Plain,
            mode: Some(FrameMode::Patches),
        })
        .expect("configure");
    screen
        .apply(&session.next_frame().expect("configure frame"))
        .expect("apply");
    session
        .send(&Command::Resize {
            width: 40,
            height: Some(6),
        })
        .expect("resize");
    screen
        .apply(&session.next_frame().expect("resize frame"))
        .expect("apply");

    session
        .send(&Command::Char {
            ch: "api-gateway".into(),
        })
        .expect("char");
    screen
        .apply(&session.next_frame().expect("typed"))
        .expect("apply");
    session
        .send(&Command::Key {
            key: KeyName::Home,
            modifiers: None,
        })
        .expect("home");
    screen
        .apply(&session.next_frame().expect("home frame"))
        .expect("apply");
    assert!(screen.text().contains("[▏api-gateway]"));

    session
        .send(&Command::Key {
            key: KeyName::Delete,
            modifiers: None,
        })
        .expect("delete");
    screen
        .apply(&session.next_frame().expect("delete frame"))
        .expect("apply");
    assert!(screen.text().contains("[▏pi-gateway]"));

    session
        .send(&Command::Key {
            key: KeyName::Enter,
            modifiers: Some(KeyModifiers {
                ctrl: Some(true),
                alt: None,
                shift: None,
            }),
        })
        .expect("ctrl enter");
    screen
        .apply(&session.next_frame().expect("ctrl enter frame"))
        .expect("apply");
    assert!(screen.text().contains("[▏pi-gateway]"));

    session
        .send(&Command::Key {
            key: KeyName::F12,
            modifiers: None,
        })
        .expect("f12");
    screen
        .apply(&session.next_frame().expect("f12 frame"))
        .expect("apply");
    session
        .send(&Command::Key {
            key: KeyName::Down,
            modifiers: None,
        })
        .expect("down");
    let focused = session.next_frame().expect("down frame");
    assert_eq!(focused.focused_id.as_deref(), Some("severity"));
    screen.apply(&focused).expect("apply");

    session
        .send(&Command::Key {
            key: KeyName::PageDown,
            modifiers: None,
        })
        .expect("page down");
    screen
        .apply(&session.next_frame().expect("page down frame"))
        .expect("apply");
    assert!(screen.viewport().is_some());
    session
        .send(&Command::Key {
            key: KeyName::PageUp,
            modifiers: None,
        })
        .expect("page up");
    screen
        .apply(&session.next_frame().expect("page up frame"))
        .expect("apply");

    session.send(&Command::Exit).expect("exit");
    assert!(matches!(session.next_event().expect("exit"), Event::Exit));
    let status = session.close().expect("close");
    assert!(status.success());
}

#[test]
fn pointer_columns_activate_the_intended_grid_button() {
    let mut session = spawn_session();
    session.initial_frame().expect("initial");
    session
        .send(&Command::Render {
            markup: ":::grid{columns=\"2\" gap=\"2\"}\n::button{id=\"left\" label=\"Left\"}\n::button{id=\"right\" label=\"Right\"}\n:::".into(),
            format: Some(DocFormat::Teml),
        })
        .expect("render");
    let rendered = session.next_frame().expect("rendered");
    let plain = rendered.plain.expect("plain");
    let (row, line) = plain
        .lines()
        .enumerate()
        .find(|(_, line)| line.contains("[ Right ]"))
        .expect("right grid button is visible");
    let col = line.find("[ Right ]").expect("right button column");

    session
        .send(&Command::Pointer {
            row: row as u64,
            col: col as u64,
        })
        .expect("pointer");
    let Event::Click { id, .. } = session.next_event().expect("click") else {
        panic!("expected click");
    };
    assert_eq!(id, "right");
    let Event::Frame(focus_frame) = session.next_event().expect("focus frame") else {
        panic!("expected frame");
    };
    assert_eq!(focus_frame.focused_id.as_deref(), Some("right"));

    session.send(&Command::Exit).expect("exit");
    assert!(matches!(session.next_event().expect("exit"), Event::Exit));
    let status = session.close().expect("close");
    assert!(status.success());
}

struct ScriptResult {
    screens: Vec<String>,
    saw_patch: bool,
}

fn run_scripted_session(script: &[Command], patches: bool) -> ScriptResult {
    let mut session = spawn_session();
    let mut screen = ScreenBuffer::new(PreferredFrame::Plain);
    screen
        .apply(&session.initial_frame().expect("initial"))
        .expect("apply");

    if patches {
        session
            .send(&Command::Configure {
                frames: FrameFormat::Plain,
                mode: Some(FrameMode::Patches),
            })
            .expect("configure");
        screen
            .apply(&session.next_frame().expect("configure frame"))
            .expect("apply");
    }

    let mut screens = vec![screen.text()];
    let mut saw_patch = false;
    for command in script {
        session.send(command).expect("send");
        let frame = session.next_frame().expect("frame");
        saw_patch |= frame.is_patch();
        screen.apply(&frame).expect("apply");
        screens.push(screen.text());
    }

    session.send(&Command::Exit).expect("exit");
    assert!(matches!(session.next_event().expect("exit"), Event::Exit));
    let status = session.close().expect("close");
    assert!(status.success());
    ScriptResult { screens, saw_patch }
}

#[test]
fn update_commands_emit_bounded_patches_through_completion() {
    let dir = std::env::temp_dir().join(format!("teml-host-live-progress-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("temp dir");
    let file = dir.join("live-progress.teml");
    std::fs::write(
        &file,
        "::progress{id=\"deploy\" label=\"Deploy\" value=\"0\" max=\"100\"}\n",
    )
    .expect("write teml");

    let options = SessionOptions {
        document: file.clone(),
        width: 60,
        height: Some(12),
        frames: None,
        mode: None,
        no_color: true,
        engine: teml_host::EngineResolveOptions {
            package_scripts: teml_host::default_package_scripts(&manifest_dir()),
            ..Default::default()
        },
    };
    let mut session = Session::spawn(options).expect("engine");
    let mut screen = ScreenBuffer::new(PreferredFrame::Plain);
    screen
        .apply(&session.initial_frame().expect("initial"))
        .expect("apply");

    session
        .send(&Command::Configure {
            frames: FrameFormat::Plain,
            mode: Some(FrameMode::Patches),
        })
        .expect("configure");
    let configure_frame = session.next_frame().expect("configure frame");
    if let Some(protocol) = configure_frame.protocol {
        assert_eq!(protocol.major, PROTOCOL_MAJOR);
        assert!(protocol.minor >= PROTOCOL_MINOR);
    }
    if let Some(capabilities) = configure_frame.capabilities.as_ref() {
        assert!(capabilities.iter().any(|cap| cap == CAPABILITY_UPDATE));
        assert!(capabilities
            .iter()
            .any(|cap| cap == CAPABILITY_DOCUMENT_MUTATIONS));
    }
    screen.apply(&configure_frame).expect("apply configure");

    let mut saw_patch = false;
    for step in 1..=10 {
        let mut props = HashMap::new();
        props.insert("value".into(), (step * 10).to_string());
        session
            .send(&Command::Update {
                id: "deploy".into(),
                props,
            })
            .expect("update");
        let frame = session.next_frame().expect("update frame");
        saw_patch |= frame.is_patch();
        screen.apply(&frame).expect("apply update");
    }

    assert!(saw_patch);
    assert!(screen.text().contains("100%"));

    session.send(&Command::Exit).expect("exit");
    assert!(matches!(session.next_event().expect("exit"), Event::Exit));
    let status = session.close().expect("close");
    assert!(status.success());

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn document_mutations_reconstruct_patch_and_resync_frames() {
    let dir = std::env::temp_dir().join(format!("teml-host-mutations-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("temp dir");
    let file = dir.join("mutations.teml");
    std::fs::write(
        &file,
        ":::scroll{id=\"logs\" rows=\"3\"}\nFirst\n:::\n\n:::card{id=\"summary\" title=\"Summary\"}\nPending\n:::\n",
    )
    .expect("write teml");
    let options = SessionOptions {
        document: file,
        width: 60,
        height: Some(12),
        frames: Some(FrameFormat::Plain),
        mode: Some(FrameMode::Patches),
        no_color: true,
        engine: teml_host::EngineResolveOptions {
            package_scripts: teml_host::default_package_scripts(&manifest_dir()),
            ..Default::default()
        },
    };
    let mut session = Session::spawn(options).expect("engine");
    let mut screen = ScreenBuffer::new(PreferredFrame::Plain);
    screen
        .apply(&session.initial_frame().expect("initial"))
        .expect("apply");

    session
        .send(&Command::Append {
            target: "logs".into(),
            markup: "Second".into(),
            format: None,
        })
        .expect("append");
    let appended = session.next_frame().expect("append frame");
    assert!(appended.is_patch());
    screen.apply(&appended).expect("apply append");
    assert!(screen.text().contains("Second"));

    session
        .send(&Command::Replace {
            target: "summary".into(),
            markup: ":::card{id=\"summary\" title=\"Summary\"}\nComplete\n:::".into(),
            format: None,
        })
        .expect("replace");
    let replaced = session.next_frame().expect("replace frame");
    assert!(!replaced.is_patch());
    screen.apply(&replaced).expect("apply replace");
    assert!(screen.text().contains("Complete"));

    session
        .send(&Command::Remove {
            target: "summary".into(),
        })
        .expect("remove");
    let removed = session.next_frame().expect("remove frame");
    assert!(!removed.is_patch());
    screen.apply(&removed).expect("apply remove");
    assert!(!screen.text().contains("Complete"));

    session.send(&Command::Exit).expect("exit");
    assert!(matches!(session.next_event().expect("exit"), Event::Exit));
    assert!(session.close().expect("close").success());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn missing_engine_fails_resolution() {
    let options = SessionOptions {
        document: view_path(),
        width: 60,
        height: None,
        frames: None,
        mode: None,
        no_color: true,
        engine: teml_host::EngineResolveOptions {
            explicit: Some(teml_host::ExplicitEngine {
                program: "/definitely/missing/teml-engine".into(),
                args: vec![],
            }),
            package_scripts: vec![],
        },
    };
    let error = match Session::spawn(options) {
        Err(error) => error,
        Ok(_) => panic!("missing engine should fail resolution"),
    };
    assert!(
        error.to_string().contains("probe version") || error.to_string().contains("No such file")
    );
}
