//! Wire models mirroring `docs/interactive-protocol.md`.
//!
//! Unknown fields on frame metadata are preserved in [`Frame::extra`] so hosts
//! stay forward-compatible with additive engine changes.
#![allow(missing_docs)]

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

/// Protocol version carried on discovery frames.
pub const PROTOCOL_MAJOR: u32 = 1;
/// Protocol minor version implemented by this crate (1.6 canvas drawing).
pub const PROTOCOL_MINOR: u32 = 6;

pub const CAPABILITY_FRAME_FORMATS: &str = "frameFormats";
pub const CAPABILITY_PATCHES: &str = "patches";
pub const CAPABILITY_RESIZE: &str = "resize";
pub const CAPABILITY_VIEWPORT: &str = "viewport";
pub const CAPABILITY_POINTER_COLUMNS: &str = "pointerColumns";
pub const CAPABILITY_KEY_MODIFIERS: &str = "keyModifiers";
pub const CAPABILITY_SCROLL: &str = "scroll";
pub const CAPABILITY_CONTEXTUAL_INPUT: &str = "contextualInput";
pub const CAPABILITY_RADIO: &str = "radio";
pub const CAPABILITY_TEXTAREA: &str = "textarea";
pub const CAPABILITY_SCROLL_REGIONS: &str = "scrollRegions";
pub const CAPABILITY_UPDATE: &str = "update";
pub const CAPABILITY_DOCUMENT_MUTATIONS: &str = "documentMutations";
pub const CAPABILITY_MASK: &str = "mask";
pub const CAPABILITY_VALIDATION: &str = "validation";
pub const CAPABILITY_FORM_SUBMIT: &str = "formSubmit";
pub const CAPABILITY_ERROR_COMPLETION: &str = "errorCompletion";
pub const CAPABILITY_CANVAS: &str = "canvas";
pub const CAPABILITY_CANVAS_BRAILLE: &str = "canvasBraille";
pub const MAX_DOCUMENT_BLOCKS: usize = 10_000;
pub const MAX_MUTATION_TARGET_CHILDREN: usize = 2_000;

/// Finite capability vocabulary implemented by protocol 1.6.
pub const ENGINE_CAPABILITIES: &[&str] = &[
    CAPABILITY_FRAME_FORMATS,
    CAPABILITY_PATCHES,
    CAPABILITY_RESIZE,
    CAPABILITY_VIEWPORT,
    CAPABILITY_POINTER_COLUMNS,
    CAPABILITY_KEY_MODIFIERS,
    CAPABILITY_SCROLL,
    CAPABILITY_CONTEXTUAL_INPUT,
    CAPABILITY_RADIO,
    CAPABILITY_TEXTAREA,
    CAPABILITY_SCROLL_REGIONS,
    CAPABILITY_UPDATE,
    CAPABILITY_DOCUMENT_MUTATIONS,
    CAPABILITY_MASK,
    CAPABILITY_VALIDATION,
    CAPABILITY_FORM_SUBMIT,
    CAPABILITY_ERROR_COMPLETION,
    CAPABILITY_CANVAS,
    CAPABILITY_CANVAS_BRAILLE,
];

/// Named navigation / editing keys accepted by the engine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum KeyName {
    Tab,
    ShiftTab,
    Enter,
    Backspace,
    Escape,
    Left,
    Right,
    Up,
    Down,
    Home,
    End,
    Delete,
    PageUp,
    PageDown,
    F1,
    F2,
    F3,
    F4,
    F5,
    F6,
    F7,
    F8,
    F9,
    F10,
    F11,
    F12,
}

/// Optional Ctrl/Alt/Shift state reported by the host terminal.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct KeyModifiers {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ctrl: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alt: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shift: Option<bool>,
}

/// Document markup formats accepted by render and mutation fragments.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DocFormat {
    Teml,
    Markdown,
    Html,
}

/// Frame payload negotiation (`configure` / startup flags).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FrameFormat {
    Ansi,
    Plain,
    Both,
}

/// Frame delivery mode (`configure` / startup flags).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FrameMode {
    Full,
    Patches,
}

/// Engine protocol version from discovery metadata.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProtocolVersion {
    pub major: u32,
    pub minor: u32,
}

impl ProtocolVersion {
    /// Current baseline implemented by this crate's contract tests.
    pub const CURRENT: Self = Self {
        major: PROTOCOL_MAJOR,
        minor: PROTOCOL_MINOR,
    };
}

/// Visible document slice metadata on a frame.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ViewportMeta {
    pub offset: u64,
    pub height: u64,
    pub total: u64,
}

/// Nested scroll container metadata on a frame.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScrollRegionMeta {
    pub id: String,
    pub offset: u64,
    pub height: u64,
    pub total: u64,
}

/// One changed row in patch-mode delivery.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FramePatch {
    pub row: u64,
    pub plain: Option<String>,
    pub ansi: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum CanvasOperation {
    Clear,
    FillStyle {
        color: String,
    },
    FillRect {
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    },
}

/// Host → engine messages (one JSON object per stdin line).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Command {
    Configure {
        frames: FrameFormat,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        mode: Option<FrameMode>,
    },
    Key {
        key: KeyName,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        modifiers: Option<KeyModifiers>,
    },
    Char {
        #[serde(rename = "char")]
        ch: String,
    },
    Pointer {
        row: u64,
        col: u64,
    },
    Scroll {
        rows: i64,
    },
    Resize {
        width: u64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        height: Option<u64>,
    },
    Render {
        markup: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        format: Option<DocFormat>,
    },
    Update {
        id: String,
        props: HashMap<String, String>,
    },
    Replace {
        target: String,
        markup: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        format: Option<DocFormat>,
    },
    Append {
        target: String,
        markup: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        format: Option<DocFormat>,
    },
    Remove {
        target: String,
    },
    Canvas {
        id: String,
        ops: Vec<CanvasOperation>,
    },
    Exit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
enum FrameDiscriminator {
    #[default]
    #[serde(rename = "frame")]
    Frame,
}

/// A rendered screen snapshot or row-level diff from the engine.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    #[serde(rename = "type")]
    frame_type: FrameDiscriminator,
    pub seq: u64,
    pub focused_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plain: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ansi: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rows: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub patches: Option<Vec<FramePatch>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub viewport: Option<ViewportMeta>,
    #[serde(
        default,
        rename = "scrollRegions",
        skip_serializing_if = "Option::is_none"
    )]
    pub scroll_regions: Option<Vec<ScrollRegionMeta>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub protocol: Option<ProtocolVersion>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<Vec<String>>,
    #[serde(flatten)]
    pub extra: HashMap<String, Value>,
}

impl Frame {
    /// Whether this frame carries row patches instead of a full payload.
    pub fn is_patch(&self) -> bool {
        self.patches.is_some()
    }
}

/// Engine → host messages (one JSON object per stdout line).
/// A valid `:::form` submission. `values` matches `Click.values`' scope.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Submit {
    pub form: String,
    pub values: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Event {
    #[serde(rename = "frame")]
    Frame(Frame),
    Change {
        id: String,
        value: String,
    },
    Toggle {
        id: String,
        checked: bool,
    },
    Click {
        id: String,
        values: HashMap<String, String>,
    },
    /// A `::button{submit}` inside a `:::form` whose fields are all valid.
    /// `values` has the same scope as `Click.values` (every focusable widget).
    /// An invalid form emits `Error` instead, never `Submit`.
    #[serde(rename = "submit")]
    Submit(Submit),
    Error {
        message: String,
        #[serde(default)]
        frame: bool,
    },
    Exit,
    /// Additive future event types. The wire `type` string is preserved so a
    /// host can surface what it did not understand.
    Unknown {
        event_type: String,
    },
}

impl PartialEq for Event {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Frame(a), Self::Frame(b)) => a == b,
            (
                Self::Change {
                    id: a_id,
                    value: a_value,
                },
                Self::Change {
                    id: b_id,
                    value: b_value,
                },
            ) => a_id == b_id && a_value == b_value,
            (
                Self::Toggle {
                    id: a_id,
                    checked: a_checked,
                },
                Self::Toggle {
                    id: b_id,
                    checked: b_checked,
                },
            ) => a_id == b_id && a_checked == b_checked,
            (
                Self::Click {
                    id: a_id,
                    values: a_values,
                },
                Self::Click {
                    id: b_id,
                    values: b_values,
                },
            ) => a_id == b_id && a_values == b_values,
            (Self::Submit(a), Self::Submit(b)) => a == b,
            (
                Self::Error {
                    message: a,
                    frame: a_frame,
                },
                Self::Error {
                    message: b,
                    frame: b_frame,
                },
            ) => a == b && a_frame == b_frame,
            (Self::Exit, Self::Exit) => true,
            (Self::Unknown { event_type: a }, Self::Unknown { event_type: b }) => a == b,
            _ => false,
        }
    }
}

impl Event {
    /// Parse one NDJSON line into a typed event, tolerating unknown `type` values.
    pub fn from_line(line: &str) -> Result<Self, serde_json::Error> {
        let value: Value = serde_json::from_str(line)?;
        Self::from_value(value)
    }

    /// Parse a JSON value into a typed event.
    pub fn from_value(value: Value) -> Result<Self, serde_json::Error> {
        match value.get("type").and_then(Value::as_str) {
            Some("frame") => Ok(Self::Frame(serde_json::from_value(value)?)),
            Some("change") => Ok(Self::Change {
                id: field_string(&value, "id")?,
                value: field_string(&value, "value")?,
            }),
            Some("toggle") => Ok(Self::Toggle {
                id: field_string(&value, "id")?,
                checked: value
                    .get("checked")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            }),
            Some("click") => {
                let id = field_string(&value, "id")?;
                let values = value
                    .get("values")
                    .and_then(Value::as_object)
                    .map(|map| {
                        map.iter()
                            .filter_map(|(key, val)| {
                                val.as_str().map(|s| (key.clone(), s.to_owned()))
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                Ok(Self::Click { id, values })
            }
            Some("submit") => {
                let form = field_string(&value, "form")?;
                let values = value
                    .get("values")
                    .and_then(Value::as_object)
                    .map(|map| {
                        map.iter()
                            .filter_map(|(key, val)| {
                                val.as_str().map(|s| (key.clone(), s.to_owned()))
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                Ok(Self::Submit(Submit { form, values }))
            }
            Some("error") => Ok(Self::Error {
                message: field_string(&value, "message")
                    .unwrap_or_else(|_| "protocol error".into()),
                frame: value.get("frame").and_then(Value::as_bool).unwrap_or(false),
            }),
            Some("exit") => Ok(Self::Exit),
            // A missing `type` is surfaced the same way the Node host does it.
            Some(other) => Ok(Self::Unknown {
                event_type: other.to_owned(),
            }),
            None => Ok(Self::Unknown {
                event_type: "unknown".to_owned(),
            }),
        }
    }
}

fn field_string(value: &Value, key: &str) -> Result<String, serde_json::Error> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| {
            serde_json::Error::io(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("missing string field `{key}`"),
            ))
        })
}

/// Build a live-terminal resize command with positive dimensions.
pub fn resize_command(width: u16, height: u16) -> Command {
    Command::Resize {
        width: u64::from(width.max(1)),
        height: Some(u64::from(height.max(1))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_update_command() {
        let mut props = HashMap::new();
        props.insert("value".into(), "73".into());
        props.insert("max".into(), "100".into());
        let command = Command::Update {
            id: "deploy".into(),
            props,
        };
        let json = serde_json::to_string(&command).expect("serialize");
        assert_eq!(
            serde_json::from_str::<Value>(&json).expect("serialized command"),
            serde_json::json!({
                "type": "update",
                "id": "deploy",
                "props": {"value": "73", "max": "100"}
            })
        );
        let decoded: Command = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(decoded, command);
    }

    #[test]
    fn current_protocol_version_is_one_six() {
        assert_eq!(
            ProtocolVersion::CURRENT,
            ProtocolVersion { major: 1, minor: 6 }
        );
        assert_eq!(
            ENGINE_CAPABILITIES,
            &[
                "frameFormats",
                "patches",
                "resize",
                "viewport",
                "pointerColumns",
                "keyModifiers",
                "scroll",
                "contextualInput",
                "radio",
                "textarea",
                "scrollRegions",
                "update",
                "documentMutations",
                "mask",
                "validation",
                "formSubmit",
                "errorCompletion",
                "canvas",
                "canvasBraille",
            ]
        );
    }

    #[test]
    fn round_trips_canvas_operations() {
        let command = Command::Canvas {
            id: "game".into(),
            ops: vec![
                CanvasOperation::Clear,
                CanvasOperation::FillStyle {
                    color: "#50fa7b".into(),
                },
                CanvasOperation::FillRect {
                    x: 0.0,
                    y: 0.0,
                    width: 2.0,
                    height: 2.0,
                },
            ],
        };
        let json = serde_json::to_string(&command).expect("serialize canvas");
        assert_eq!(
            serde_json::from_str::<Value>(&json).expect("serialized canvas"),
            serde_json::json!({
                "type": "canvas",
                "id": "game",
                "ops": [
                    {"op": "clear"},
                    {"op": "fillStyle", "color": "#50fa7b"},
                    {"op": "fillRect", "x": 0.0, "y": 0.0, "width": 2.0, "height": 2.0}
                ]
            })
        );
        let decoded: Command = serde_json::from_str(&json).expect("deserialize canvas");
        assert_eq!(decoded, command);
    }

    #[test]
    fn round_trips_document_mutation_commands() {
        for command in [
            Command::Replace {
                target: "summary".into(),
                markup: "**Complete**".into(),
                format: Some(DocFormat::Markdown),
            },
            Command::Append {
                target: "logs".into(),
                markup: "Next".into(),
                format: None,
            },
            Command::Remove {
                target: "completed".into(),
            },
        ] {
            let json = serde_json::to_string(&command).expect("serialize");
            let decoded: Command = serde_json::from_str(&json).expect("deserialize");
            assert_eq!(decoded, command);
        }
    }

    #[test]
    fn round_trips_known_commands() {
        let command = Command::Key {
            key: KeyName::Enter,
            modifiers: Some(KeyModifiers {
                ctrl: Some(true),
                alt: None,
                shift: Some(true),
            }),
        };
        let json = serde_json::to_string(&command).expect("serialize");
        let decoded: Command = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(decoded, command);
    }

    #[test]
    fn tolerates_unknown_frame_fields() {
        let value = serde_json::json!({
            "type": "frame",
            "seq": 1,
            "focusedId": null,
            "plain": "hi\n",
            "ansi": null,
            "futureCapabilityFlag": true
        });
        let frame: Frame = serde_json::from_value(value).expect("frame");
        assert_eq!(
            frame
                .extra
                .get("futureCapabilityFlag")
                .and_then(Value::as_bool),
            Some(true)
        );
    }

    #[test]
    fn unknown_event_type_is_preserved() {
        let event = Event::from_line(r#"{"type":"future","id":"x"}"#).expect("parse");
        assert_eq!(
            event,
            Event::Unknown {
                event_type: "future".to_owned()
            }
        );
    }

    #[test]
    fn submit_event_decodes_form_and_values() {
        let event =
            Event::from_line(r#"{"type":"submit","form":"f","values":{"name":"Ada","accept":""}}"#)
                .expect("parse");
        match event {
            Event::Submit(submit) => {
                assert_eq!(submit.form, "f");
                assert_eq!(submit.values.get("name").map(String::as_str), Some("Ada"));
            }
            other => panic!("expected Submit, got {other:?}"),
        }
    }

    #[test]
    fn submit_event_serializes_with_a_type_tag() {
        let mut values = HashMap::new();
        values.insert("name".to_owned(), "Ada".to_owned());
        let event = Event::Submit(Submit {
            form: "f".to_owned(),
            values,
        });
        let json: Value = serde_json::from_str(&serde_json::to_string(&event).expect("serialize"))
            .expect("reparse");
        assert_eq!(json.get("type").and_then(Value::as_str), Some("submit"));
        assert_eq!(json.get("form").and_then(Value::as_str), Some("f"));
    }

    #[test]
    fn decodes_the_shared_v1_conformance_transcript() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../tests/system/snapshots/interactive-v1.ndjson"
        );
        let transcript = std::fs::read_to_string(path).expect("shared transcript");
        let events = transcript
            .lines()
            .map(Event::from_line)
            .collect::<Result<Vec<_>, _>>()
            .expect("typed events");
        assert!(matches!(events.first(), Some(Event::Frame(_))));
        assert!(matches!(events.last(), Some(Event::Exit)));
    }
}
