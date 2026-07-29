//! NDJSON session over a spawned `teml run` child process.

use crate::engine::{
    default_package_scripts, resolve_engine, EngineError, EngineResolveOptions, ResolvedEngine,
};
use crate::protocol::{Command, Event, Frame, FrameFormat, FrameMode};
use std::fmt;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command as ProcessCommand, Stdio};

/// Startup options for [`Session::spawn`].
#[derive(Debug, Clone)]
pub struct SessionOptions {
    /// Document path passed to `teml run`.
    pub document: PathBuf,
    /// Initial terminal width in columns.
    pub width: u16,
    /// Initial terminal height in rows (`None` omits `--height`).
    pub height: Option<u16>,
    /// Pre-negotiated frame payload format (`None` omits `--frames`).
    pub frames: Option<FrameFormat>,
    /// Pre-negotiated frame delivery mode (`None` omits `--mode`).
    pub mode: Option<FrameMode>,
    /// Disable ANSI color in engine output.
    pub no_color: bool,
    /// Engine resolution overrides.
    pub engine: EngineResolveOptions,
}

impl SessionOptions {
    /// Convenience constructor with common defaults for interactive hosts.
    pub fn new(document: impl Into<PathBuf>, width: u16, height: u16) -> Self {
        Self {
            document: document.into(),
            width,
            height: Some(height),
            frames: Some(FrameFormat::Ansi),
            mode: Some(FrameMode::Patches),
            no_color: false,
            engine: EngineResolveOptions::default(),
        }
    }

    /// Populate default monorepo package script search paths from a manifest dir.
    pub fn with_default_package_scripts(mut self, manifest_dir: &Path) -> Self {
        self.engine.package_scripts = default_package_scripts(manifest_dir);
        self
    }
}

/// Active `teml run` subprocess speaking NDJSON over piped stdio.
pub struct Session {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    engine: ResolvedEngine,
    closed: bool,
}

impl Session {
    /// Spawn `teml run` with explicit engine resolution and startup flags.
    pub fn spawn(options: SessionOptions) -> Result<Self, SessionError> {
        let engine = resolve_engine(&options.engine)?;

        let mut command = ProcessCommand::new(&engine.program);
        command
            .args(&engine.args)
            .arg("run")
            .arg(&options.document)
            .arg("--width")
            .arg(options.width.max(1).to_string());
        if let Some(height) = options.height {
            command.arg("--height").arg(height.max(1).to_string());
        }
        if let Some(frames) = options.frames {
            command.arg("--frames").arg(frame_format_arg(frames));
        }
        if let Some(mode) = options.mode {
            command.arg("--mode").arg(frame_mode_arg(mode));
        }
        if options.no_color {
            command.arg("--no-color");
        }
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());

        let mut child = command.spawn().map_err(SessionError::Io)?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| SessionError::Protocol("teml stdin pipe was not created".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| SessionError::Protocol("teml stdout pipe was not created".into()))?;

        Ok(Self {
            child,
            stdin,
            stdout: BufReader::new(stdout),
            engine,
            closed: false,
        })
    }

    /// Resolved engine metadata and version diagnostics.
    pub fn engine(&self) -> &ResolvedEngine {
        &self.engine
    }

    /// Read the first frame emitted before any command (startup contract).
    pub fn initial_frame(&mut self) -> Result<Frame, SessionError> {
        match self.next_event()? {
            Event::Frame(frame) => Ok(frame),
            other => Err(SessionError::Protocol(format!(
                "protocol violation: expected initial frame, got {other:?}"
            ))),
        }
    }

    /// Write one command as a single NDJSON line.
    pub fn send(&mut self, command: &Command) -> Result<(), SessionError> {
        let line = serde_json::to_string(command)
            .map_err(|error| SessionError::Protocol(error.to_string()))?;
        writeln!(self.stdin, "{line}").map_err(SessionError::Io)?;
        self.stdin.flush().map_err(SessionError::Io)
    }

    /// Read the next event from stdout, skipping blank lines.
    pub fn next_event(&mut self) -> Result<Event, SessionError> {
        let mut line = String::new();
        loop {
            line.clear();
            let read = self.stdout.read_line(&mut line).map_err(SessionError::Io)?;
            if read == 0 {
                return Err(SessionError::Protocol("teml closed stdout".into()));
            }
            let trimmed = line.trim();
            if !trimmed.is_empty() {
                return Event::from_line(trimmed).map_err(|error| {
                    SessionError::Protocol(format!("invalid event JSON: {error}"))
                });
            }
        }
    }

    /// Drain events until the next `frame` (surfacing protocol errors immediately).
    pub fn next_frame(&mut self) -> Result<Frame, SessionError> {
        loop {
            match self.next_event()? {
                Event::Frame(frame) => return Ok(frame),
                Event::Error { message } => {
                    return Err(SessionError::Protocol(format!("protocol error: {message}")));
                }
                Event::Exit => {
                    return Err(SessionError::Protocol(
                        "session exited before producing a frame".into(),
                    ));
                }
                Event::Change { .. }
                | Event::Toggle { .. }
                | Event::Click { .. }
                | Event::Unknown => {}
            }
        }
    }

    /// Send `exit` and wait for the child, returning its exit status.
    pub fn close(mut self) -> Result<std::process::ExitStatus, SessionError> {
        if !self.closed {
            let _ = self.send(&Command::Exit);
            self.closed = true;
        }
        let status = self.child.wait().map_err(SessionError::Io)?;
        Ok(status)
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        if !self.closed {
            let _ = self.send(&Command::Exit);
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}

/// Session lifecycle and transport failures.
#[derive(Debug)]
pub enum SessionError {
    /// Operating-system I/O while talking to the child process.
    Io(std::io::Error),
    /// Engine resolution failed before spawn.
    Engine(EngineError),
    /// NDJSON transport or protocol invariant violation.
    Protocol(String),
}

impl fmt::Display for SessionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(f, "{error}"),
            Self::Engine(error) => write!(f, "{error}"),
            Self::Protocol(message) => write!(f, "{message}"),
        }
    }
}

impl std::error::Error for SessionError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            Self::Engine(error) => Some(error),
            Self::Protocol(_) => None,
        }
    }
}

impl From<std::io::Error> for SessionError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value)
    }
}

impl From<EngineError> for SessionError {
    fn from(value: EngineError) -> Self {
        Self::Engine(value)
    }
}

fn frame_format_arg(format: FrameFormat) -> &'static str {
    match format {
        FrameFormat::Ansi => "ansi",
        FrameFormat::Plain => "plain",
        FrameFormat::Both => "both",
    }
}

fn frame_mode_arg(mode: FrameMode) -> &'static str {
    match mode {
        FrameMode::Full => "full",
        FrameMode::Patches => "patches",
    }
}
