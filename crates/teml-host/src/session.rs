//! NDJSON session over a spawned `teml run` child process.

use crate::engine::{
    default_package_scripts, resolve_engine, EngineError, EngineResolveOptions, ResolvedEngine,
};
use crate::pipe::CancellablePipe;
use crate::protocol::{Command, Event, Frame, FrameFormat, FrameMode};
use std::fmt;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command as ProcessCommand, Stdio};
use std::sync::mpsc::{sync_channel, Receiver, RecvTimeoutError, SyncSender};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

/// NDJSON line budget, matching the engine and the Go/Python hosts.
pub const MAX_NDJSON_LINE_BYTES: usize = 8 * 1024 * 1024;

/// Read one line, bounded by [`MAX_NDJSON_LINE_BYTES`]. `read_line` alone grows
/// without limit, so a peer that never sends a newline could exhaust memory.
fn read_line_bounded<R: BufRead>(reader: &mut R) -> Result<Option<String>, SessionError> {
    let mut line = String::new();
    let read = reader
        .take(MAX_NDJSON_LINE_BYTES as u64 + 1)
        .read_line(&mut line)
        .map_err(SessionError::Io)?;
    if read == 0 {
        return Ok(None);
    }
    // `read_line` keeps the terminator, which is not part of the line budget.
    if line.trim_end_matches(['\n', '\r']).len() > MAX_NDJSON_LINE_BYTES {
        while !line.ends_with('\n') {
            let (count, terminated) = {
                let buffer = reader.fill_buf().map_err(SessionError::Io)?;
                match buffer.iter().position(|byte| *byte == b'\n') {
                    Some(index) => (index + 1, true),
                    None => (buffer.len(), false),
                }
            };
            if count == 0 {
                break;
            }
            reader.consume(count);
            if terminated {
                break;
            }
        }
        return Err(SessionError::Protocol(format!(
            "NDJSON line exceeds the {MAX_NDJSON_LINE_BYTES}-byte limit"
        )));
    }
    Ok(Some(line))
}

type ReaderResult = Result<Option<String>, SessionError>;

fn spawn_reader(
    stdout: ChildStdout,
    cancelled: Arc<AtomicBool>,
) -> (Receiver<ReaderResult>, JoinHandle<()>) {
    let (sender, receiver): (SyncSender<ReaderResult>, _) = sync_channel(100);
    let handle = thread::spawn(move || {
        let mut reader = BufReader::new(CancellablePipe {
            stdout,
            cancelled: Arc::clone(&cancelled),
        });
        while !cancelled.load(Ordering::Acquire) {
            let result = read_line_bounded(&mut reader);
            let finished = matches!(result, Ok(None) | Err(SessionError::Io(_)));
            if sender.send(result).is_err() || finished {
                break;
            }
        }
    });
    (receiver, handle)
}

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

    /// Like [`SessionOptions::new`], with dimensions read from the current
    /// terminal, so an application does not need its own terminal dependency
    /// just to seed the first frame.
    #[cfg(feature = "terminal")]
    #[cfg_attr(docsrs, doc(cfg(feature = "terminal")))]
    pub fn for_terminal(document: impl Into<PathBuf>) -> std::io::Result<Self> {
        let (width, height) = crossterm::terminal::size()?;
        Ok(Self::new(document, width, height))
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
    stdin: Option<ChildStdin>,
    events: Option<Receiver<ReaderResult>>,
    reader: Option<JoinHandle<()>>,
    read_timeout: Option<Duration>,
    reader_cancelled: Arc<AtomicBool>,
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

        let reader_cancelled = Arc::new(AtomicBool::new(false));
        let (events, reader) = spawn_reader(stdout, Arc::clone(&reader_cancelled));
        Ok(Self {
            child,
            stdin: Some(stdin),
            events: Some(events),
            reader: Some(reader),
            read_timeout: Some(Duration::from_secs(30)),
            reader_cancelled,
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
        let stdin = self
            .stdin
            .as_mut()
            .ok_or_else(|| SessionError::Protocol("session is closed".into()))?;
        writeln!(stdin, "{line}").map_err(SessionError::Io)?;
        stdin.flush().map_err(SessionError::Io)
    }

    /// Set the per-event read deadline. `None` disables it; the default is 30 seconds.
    pub fn with_read_timeout(mut self, timeout: Option<Duration>) -> Self {
        self.read_timeout = timeout;
        self
    }

    fn join_reader(&mut self) {
        self.reader_cancelled.store(true, Ordering::Release);
        self.events.take();
        if let Some(reader) = self.reader.take() {
            let _ = reader.join();
        }
    }

    fn terminate(&mut self) {
        self.reader_cancelled.store(true, Ordering::Release);
        self.events.take();
        self.stdin.take();
        let _ = self.child.kill();
        let _ = self.child.wait();
        self.join_reader();
        self.closed = true;
    }

    /// Read the next event from stdout, skipping blank lines.
    pub fn next_event(&mut self) -> Result<Event, SessionError> {
        let deadline = self.read_timeout.map(|timeout| Instant::now() + timeout);
        loop {
            let received = {
                let receiver = self
                    .events
                    .as_ref()
                    .ok_or_else(|| SessionError::Protocol("session is closed".into()))?;
                if let Some(deadline) = deadline {
                    let remaining = deadline.saturating_duration_since(Instant::now());
                    if remaining.is_zero() {
                        self.terminate();
                        return Err(SessionError::ReadTimeout(
                            self.read_timeout.expect("deadline"),
                        ));
                    }
                    receiver.recv_timeout(remaining)
                } else {
                    receiver.recv().map_err(|_| RecvTimeoutError::Disconnected)
                }
            };
            match received {
                Ok(Ok(Some(line))) => {
                    let trimmed = line.trim();
                    if !trimmed.is_empty() {
                        return Event::from_line(trimmed).map_err(|error| {
                            SessionError::Protocol(format!("invalid event JSON: {error}"))
                        });
                    }
                }
                Ok(Ok(None)) => {
                    return Err(SessionError::Protocol("teml closed stdout".into()));
                }
                Ok(Err(error)) => return Err(error),
                Err(RecvTimeoutError::Timeout) => {
                    self.terminate();
                    return Err(SessionError::ReadTimeout(
                        self.read_timeout.expect("deadline"),
                    ));
                }
                Err(RecvTimeoutError::Disconnected) => {
                    return Err(SessionError::Protocol("teml closed stdout".into()));
                }
            }
        }
    }

    /// Drain events until the next `frame` (surfacing protocol errors immediately).
    pub fn next_frame(&mut self) -> Result<Frame, SessionError> {
        loop {
            match self.next_event()? {
                Event::Frame(frame) => return Ok(frame),
                Event::Error { message, .. } => {
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
                | Event::Submit(_)
                | Event::Unknown { .. } => {}
            }
        }
    }

    /// Request graceful exit, bounded by the read timeout (30 seconds by default).
    /// A timed-out child is killed; reader shutdown never waits for descendant EOF.
    pub fn close(mut self) -> Result<std::process::ExitStatus, SessionError> {
        // Closing stdin requests graceful EOF without an unbounded write to a
        // potentially full pipe. Keep draining stdout until the child exits.
        self.stdin.take();
        let deadline = self.read_timeout.map(|timeout| Instant::now() + timeout);
        loop {
            if let Some(status) = self.child.try_wait().map_err(SessionError::Io)? {
                self.join_reader();
                self.closed = true;
                return Ok(status);
            }
            if deadline.is_some_and(|deadline| Instant::now() >= deadline) {
                self.terminate();
                return Err(SessionError::ReadTimeout(
                    self.read_timeout.expect("deadline"),
                ));
            }
            if let Some(events) = &self.events {
                for _ in 0..100 {
                    if events.try_recv().is_err() {
                        break;
                    }
                }
            }
            thread::sleep(Duration::from_millis(10));
        }
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        if !self.closed {
            self.terminate();
        } else {
            self.join_reader();
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
    /// The engine did not produce a complete event before the configured deadline.
    ReadTimeout(Duration),
}

impl fmt::Display for SessionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(f, "{error}"),
            Self::Engine(error) => write!(f, "{error}"),
            Self::Protocol(message) => write!(f, "{message}"),
            Self::ReadTimeout(duration) => write!(
                f,
                "timed out waiting for teml event after {}s",
                duration.as_secs_f64()
            ),
        }
    }
}

impl std::error::Error for SessionError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            Self::Engine(error) => Some(error),
            Self::Protocol(_) | Self::ReadTimeout(_) => None,
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    use std::io::{self, Cursor};

    #[derive(serde::Deserialize)]
    struct ContractPart {
        text: String,
        repeat: usize,
    }

    #[derive(serde::Deserialize)]
    struct ContractCase {
        name: String,
        parts: Vec<ContractPart>,
        chunks: Vec<usize>,
        events: Vec<Value>,
    }

    struct ChunkedReader {
        data: Vec<u8>,
        chunks: Vec<usize>,
        offset: usize,
        index: usize,
    }

    impl ChunkedReader {
        fn new(data: Vec<u8>, chunks: Vec<usize>) -> Self {
            Self {
                data,
                chunks,
                offset: 0,
                index: 0,
            }
        }
    }

    impl Read for ChunkedReader {
        fn read(&mut self, output: &mut [u8]) -> io::Result<usize> {
            if self.offset == self.data.len() {
                return Ok(0);
            }
            let scheduled = self.chunks[self.index % self.chunks.len()];
            let count = scheduled
                .min(output.len())
                .min(self.data.len() - self.offset);
            output[..count].copy_from_slice(&self.data[self.offset..self.offset + count]);
            self.offset += count;
            self.index += 1;
            Ok(count)
        }
    }

    fn run_contract(case: &ContractCase) -> Vec<Value> {
        let input = case
            .parts
            .iter()
            .flat_map(|part| part.text.as_bytes().repeat(part.repeat))
            .collect::<Vec<_>>();
        let mut reader = BufReader::new(ChunkedReader::new(input, case.chunks.clone()));
        let mut events = Vec::new();
        loop {
            match read_line_bounded(&mut reader) {
                Ok(Some(line)) => {
                    let trimmed = line.trim();
                    if !trimmed.is_empty() {
                        events.push(serde_json::from_str(trimmed).expect("valid event JSON"));
                    }
                }
                Ok(None) => break,
                Err(error) => {
                    let message = error.to_string();
                    assert!(message.contains("NDJSON line exceeds"), "{message}");
                    events.push(json!({"type": "error", "message": message}));
                }
            }
        }
        events
    }

    #[test]
    fn shared_ndjson_contract() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/protocol/ndjson-cases.json"
        );
        let fixture: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(path).expect("shared contract"))
                .expect("contract JSON");
        let cases: Vec<ContractCase> =
            serde_json::from_value(fixture["cases"].clone()).expect("contract cases");
        for case in &cases {
            assert_eq!(run_contract(case), case.events, "{}", case.name);
        }
    }

    #[test]
    fn bounded_line_read_rejects_an_oversized_line() {
        let mut input = Cursor::new(vec![b'x'; MAX_NDJSON_LINE_BYTES + 1]);
        let error = read_line_bounded(&mut input).expect_err("oversized line must be rejected");
        assert!(
            format!("{error}").contains("exceeds"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn bounded_line_read_accepts_a_line_at_the_limit() {
        let mut data = vec![b'x'; MAX_NDJSON_LINE_BYTES];
        data.push(b'\n');
        let mut input = Cursor::new(data);
        let line = read_line_bounded(&mut input)
            .expect("a line at the limit is valid")
            .expect("a line was read");
        assert_eq!(line.trim().len(), MAX_NDJSON_LINE_BYTES);
    }
}
