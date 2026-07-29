//! # teml-host
//!
//! Rust host library for the TeML interactive NDJSON protocol (`teml run`).
//!
//! The crate splits responsibilities the way the protocol expects:
//!
//! - [`Session`] spawns and speaks NDJSON with a TeML engine subprocess
//! - [`ScreenBuffer`] reconstructs full and patch frames on the host side
//! - [`paint`] and optional [`terminal`] helpers repaint a real TTY safely
//! - [`app::run`] drives the whole loop for applications that only want to
//!   handle semantic events
//!
//! An application can own the event loop, or hand it to [`app::run`] and
//! implement [`app::App`]. This crate does not embed a widget framework either
//! way: the document is the interface.

#![warn(missing_docs)]
#![cfg_attr(docsrs, feature(doc_cfg))]

pub mod engine;
pub mod paint;
pub mod protocol;
pub mod screen;
pub mod session;

#[cfg(feature = "terminal")]
#[cfg_attr(docsrs, doc(cfg(feature = "terminal")))]
pub mod app;

#[cfg(feature = "terminal")]
#[cfg_attr(docsrs, doc(cfg(feature = "terminal")))]
pub mod terminal;

pub use engine::{
    default_package_scripts, invocation_for_path, is_js_entry, resolve_engine, EngineError,
    EngineResolveOptions, EngineSource, ExplicitEngine, ResolvedEngine,
};
pub use paint::{onlcr, paint};
pub use protocol::{
    resize_command, Command, DocFormat, Event, Frame, FrameFormat, FrameMode, FramePatch,
    KeyModifiers, KeyName, ProtocolVersion, ScrollRegionMeta, ViewportMeta,
    CAPABILITY_CONTEXTUAL_INPUT, CAPABILITY_DOCUMENT_MUTATIONS, CAPABILITY_FRAME_FORMATS,
    CAPABILITY_KEY_MODIFIERS, CAPABILITY_PATCHES, CAPABILITY_POINTER_COLUMNS, CAPABILITY_RADIO,
    CAPABILITY_RESIZE, CAPABILITY_SCROLL, CAPABILITY_SCROLL_REGIONS, CAPABILITY_TEXTAREA,
    CAPABILITY_UPDATE, CAPABILITY_VIEWPORT, ENGINE_CAPABILITIES, MAX_DOCUMENT_BLOCKS,
    MAX_MUTATION_TARGET_CHILDREN, PROTOCOL_MAJOR, PROTOCOL_MINOR,
};
pub use screen::{PreferredFrame, ScreenBuffer, ScrollRegion, Viewport};
pub use session::{Session, SessionError, SessionOptions};

#[cfg(feature = "terminal")]
pub use app::{run, run_headless, App, Context, Values};

#[cfg(feature = "terminal")]
pub use terminal::{paint_terminal, CrosstermEvents, TermGuard, TerminalEvents, TerminalInput};
