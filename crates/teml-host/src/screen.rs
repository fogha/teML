//! Host-side reconstruction of TeML full and row-patch frames.
#![allow(missing_docs)]

use crate::protocol::{Frame, FrameFormat, ProtocolVersion, ScrollRegionMeta, ViewportMeta};
use std::io;

/// Which rendered payload [`ScreenBuffer`] prefers when applying frames.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreferredFrame {
    Ansi,
    Plain,
}

impl From<FrameFormat> for PreferredFrame {
    fn from(value: FrameFormat) -> Self {
        match value {
            FrameFormat::Plain => Self::Plain,
            FrameFormat::Ansi | FrameFormat::Both => Self::Ansi,
        }
    }
}

/// Viewport metadata exposed after applying a frame.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Viewport {
    pub offset: usize,
    pub height: usize,
    pub total: usize,
}

impl From<&ViewportMeta> for Viewport {
    fn from(value: &ViewportMeta) -> Self {
        Self {
            offset: usize_from(value.offset),
            height: usize_from(value.height),
            total: usize_from(value.total),
        }
    }
}

/// Scroll-region metadata exposed after applying a frame.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScrollRegion {
    pub id: String,
    pub offset: usize,
    pub height: usize,
    pub total: usize,
}

impl From<&ScrollRegionMeta> for ScrollRegion {
    fn from(value: &ScrollRegionMeta) -> Self {
        Self {
            id: value.id.clone(),
            offset: usize_from(value.offset),
            height: usize_from(value.height),
            total: usize_from(value.total),
        }
    }
}

/// Host-side reconstruction of TeML full and patch frames.
#[derive(Debug)]
pub struct ScreenBuffer {
    preferred: PreferredFrame,
    rows: Vec<String>,
    last_seq: u64,
    focused_id: Option<String>,
    viewport: Option<Viewport>,
    scroll_regions: Vec<ScrollRegion>,
    protocol: Option<ProtocolVersion>,
    capabilities: Vec<String>,
}

impl ScreenBuffer {
    /// Create an empty buffer preferring `ansi` or `plain` payloads.
    pub fn new(preferred: PreferredFrame) -> Self {
        Self {
            preferred,
            rows: Vec::new(),
            last_seq: 0,
            focused_id: None,
            viewport: None,
            scroll_regions: Vec::new(),
            protocol: None,
            capabilities: Vec::new(),
        }
    }

    /// Apply one frame event, validating sequence numbers and metadata bounds.
    pub fn apply(&mut self, frame: &Frame) -> io::Result<()> {
        let seq = frame.seq;
        if seq == 0 || seq <= self.last_seq {
            return Err(invalid(format!(
                "non-monotonic frame sequence: {seq} after {}",
                self.last_seq
            )));
        }

        if let Some(patches) = &frame.patches {
            if self.last_seq == 0 {
                return Err(invalid("patch frame arrived before a full frame"));
            }
            if seq != self.last_seq + 1 {
                return Err(invalid(format!(
                    "patch frame sequence gap: expected {}, got {seq}",
                    self.last_seq + 1
                )));
            }
            let row_count = frame
                .rows
                .ok_or_else(|| invalid("patch frame needs a non-negative rows count"))?;
            let row_count = usize_from(row_count);

            for patch in patches {
                let row = usize_from(patch.row);
                if row >= row_count {
                    return Err(invalid(format!(
                        "patch row {row} is outside the {row_count}-row frame"
                    )));
                }
                let text = payload_patch(patch, self.preferred)
                    .ok_or_else(|| invalid(format!("patch row {row} has no usable payload")))?;
                if self.rows.len() <= row {
                    self.rows.resize(row + 1, String::new());
                }
                self.rows[row] = text.to_owned();
            }
            self.rows.resize(row_count, String::new());
        } else {
            let rendered = payload_full(frame, self.preferred)
                .ok_or_else(|| invalid("full frame has no usable payload"))?;
            self.rows = split_rows(rendered);
        }

        self.focused_id = frame.focused_id.clone();
        self.viewport = parse_viewport(frame, self.rows.len())?;
        self.scroll_regions = parse_scroll_regions(frame)?;
        if let Some(protocol) = frame.protocol {
            self.protocol = Some(protocol);
        }
        if let Some(capabilities) = &frame.capabilities {
            self.capabilities = capabilities.clone();
        }
        self.last_seq = seq;
        Ok(())
    }

    /// Joined row text suitable for terminal painting (without ONLCR expansion).
    pub fn text(&self) -> String {
        self.rows.join("\n")
    }

    /// Last applied frame sequence number.
    pub fn last_seq(&self) -> u64 {
        self.last_seq
    }

    /// Focused widget id from the last applied frame.
    pub fn focused_id(&self) -> Option<&str> {
        self.focused_id.as_deref()
    }

    /// Document viewport metadata when present.
    pub fn viewport(&self) -> Option<Viewport> {
        self.viewport
    }

    /// Nested scroll-region metadata when present.
    pub fn scroll_regions(&self) -> &[ScrollRegion] {
        &self.scroll_regions
    }

    /// Protocol version reported by the engine on discovery/resync frames.
    pub fn protocol(&self) -> Option<ProtocolVersion> {
        self.protocol
    }

    /// Capability strings reported by the engine.
    pub fn capabilities(&self) -> &[String] {
        &self.capabilities
    }

    /// Whether the engine reported a named capability on the last frame.
    pub fn has_capability(&self, capability: &str) -> bool {
        self.capabilities.iter().any(|value| value == capability)
    }
}

fn parse_scroll_regions(frame: &Frame) -> io::Result<Vec<ScrollRegion>> {
    let Some(entries) = &frame.scroll_regions else {
        return Ok(Vec::new());
    };
    entries
        .iter()
        .map(|entry| {
            let offset = usize_from(entry.offset);
            let height = usize_from(entry.height);
            let total = usize_from(entry.total);
            if entry.id.is_empty() {
                return Err(invalid("scroll region needs an id"));
            }
            if height == 0 || offset > total.saturating_sub(height) {
                return Err(invalid("invalid scroll region bounds"));
            }
            Ok(ScrollRegion {
                id: entry.id.clone(),
                offset,
                height,
                total,
            })
        })
        .collect()
}

fn parse_viewport(frame: &Frame, row_count: usize) -> io::Result<Option<Viewport>> {
    let Some(value) = &frame.viewport else {
        return Ok(None);
    };
    let offset = usize_from(value.offset);
    let height = usize_from(value.height);
    let total = usize_from(value.total);
    if height == 0 {
        return Err(invalid("viewport needs a positive height"));
    }
    if height != row_count || total < height || offset.saturating_add(height) > total {
        return Err(invalid("invalid frame viewport bounds"));
    }
    Ok(Some(Viewport {
        offset,
        height,
        total,
    }))
}

fn payload_full(frame: &Frame, preferred: PreferredFrame) -> Option<&str> {
    match preferred {
        PreferredFrame::Ansi => frame.ansi.as_deref().or(frame.plain.as_deref()),
        PreferredFrame::Plain => frame.plain.as_deref().or(frame.ansi.as_deref()),
    }
}

fn payload_patch(patch: &crate::protocol::FramePatch, preferred: PreferredFrame) -> Option<&str> {
    match preferred {
        PreferredFrame::Ansi => patch.ansi.as_deref().or(patch.plain.as_deref()),
        PreferredFrame::Plain => patch.plain.as_deref().or(patch.ansi.as_deref()),
    }
}

fn split_rows(rendered: &str) -> Vec<String> {
    if rendered.is_empty() {
        return Vec::new();
    }
    rendered
        .strip_suffix('\n')
        .unwrap_or(rendered)
        .split('\n')
        .map(str::to_owned)
        .collect()
}

fn usize_from(value: u64) -> usize {
    usize::try_from(value).unwrap_or(usize::MAX)
}

fn invalid(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn frame_from_json(value: serde_json::Value) -> Frame {
        serde_json::from_value(value).expect("test frame json")
    }

    fn frame_full(seq: u64, plain: &str) -> Frame {
        frame_from_json(json!({
            "type": "frame",
            "seq": seq,
            "focusedId": "name",
            "plain": plain,
            "ansi": null
        }))
    }

    #[test]
    fn reconstructs_growth_change_and_truncation() {
        let mut screen = ScreenBuffer::new(PreferredFrame::Plain);
        screen.apply(&frame_full(1, "one\ntwo\n")).expect("full");
        screen
            .apply(&frame_from_json(json!({
                "type": "frame",
                "seq": 2,
                "focusedId": "name",
                "rows": 3,
                "patches": [
                    {"row": 1, "plain": "TWO", "ansi": null},
                    {"row": 2, "plain": "three", "ansi": null}
                ]
            })))
            .expect("patch");
        assert_eq!(screen.text(), "one\nTWO\nthree");

        screen
            .apply(&frame_from_json(json!({
                "type": "frame",
                "seq": 3,
                "focusedId": "name",
                "rows": 1,
                "patches": []
            })))
            .expect("truncate");
        assert_eq!(screen.text(), "one");
    }

    #[test]
    fn rejects_patch_sequence_gaps() {
        let mut screen = ScreenBuffer::new(PreferredFrame::Ansi);
        screen
            .apply(&frame_from_json(json!({
                "type": "frame",
                "seq": 1,
                "focusedId": null,
                "plain": "plain\n",
                "ansi": "ansi\n"
            })))
            .expect("full");
        let error = screen
            .apply(&frame_from_json(json!({
                "type": "frame",
                "seq": 3,
                "focusedId": null,
                "rows": 1,
                "patches": []
            })))
            .expect_err("gap");
        assert!(error.to_string().contains("sequence gap"));
    }

    #[test]
    fn preserves_validated_viewport_metadata() {
        let mut screen = ScreenBuffer::new(PreferredFrame::Plain);
        screen
            .apply(&frame_from_json(json!({
                "type": "frame",
                "seq": 1,
                "focusedId": null,
                "plain": "row 8\nrow 9\n",
                "ansi": null,
                "viewport": {"offset": 8, "height": 2, "total": 10}
            })))
            .expect("viewport");
        assert_eq!(
            screen.viewport(),
            Some(Viewport {
                offset: 8,
                height: 2,
                total: 10,
            })
        );
    }
}
