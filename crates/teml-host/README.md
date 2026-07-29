# teml-host

Rust host library for the TeML interactive NDJSON protocol (`teml run`).

TeML renders interactive documents and streams **commands in, events out** over
line-delimited JSON. Your application owns the real terminal; this crate owns
the boring parts: spawning the engine, typed protocol models, patch-applying
frame reconstruction, and optional crossterm helpers.

## Install

```toml
[dependencies]
teml-host = "0.1"
```

Enable the default `terminal` feature for crossterm lifecycle/input helpers, or
depend headlessly:

```toml
teml-host = { version = "0.1", default-features = false }
```

## Quick start

Implement `App` and let the crate own the loop, the terminal, and painting:

```rust
use teml_host::{App, Context, SessionOptions, Values};

#[derive(Default)]
struct Form {
    submitted: Option<Values>,
}

impl App for Form {
    fn on_click(&mut self, id: &str, values: &Values, ctx: &mut Context<'_>) {
        if id == "submit" {
            self.submitted = Some(values.clone());
            ctx.exit();
        }
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut form = Form::default();
    teml_host::run(SessionOptions::for_terminal("form.teml")?, &mut form)?;
    println!("{:?}", form.submitted);
    Ok(())
}
```

`run` spawns the engine, holds raw mode for the session, paints every frame, and
returns the final widget values once a handler calls `ctx.exit()`, the user
presses Ctrl+C, or the engine ends the session. Terminal state is restored even
if the loop fails.

Handlers can also mutate the document: `ctx.render()` swaps the whole view,
`ctx.replace()`/`ctx.append()`/`ctx.remove()` target one addressable container.
Requests are queued and sent once the handler returns, so a handler never
interleaves commands with the event stream it is being dispatched from.
`run_headless` is the same loop with an injected event source and no painting,
for tests.

The `on_change`/`on_toggle`/`on_click`/`on_error` contract and these context
actions match the Node, Go, and Python hosts, so one view behaves the same way
whichever language drives it.

The repository example at `examples/rust-host/` ports the incident-handoff HTML
view this way, and shares `view.html` byte-for-byte with the Go and Python
examples.

## Manual event loop

`Session` and `ScreenBuffer` are public, so an application that needs unusual
control can own the loop instead:

```rust
use teml_host::{
    Command, Event, PreferredFrame, ScreenBuffer, Session, SessionOptions, CAPABILITY_SCROLL,
    paint_terminal, terminal::{CrosstermEvents, TermGuard, TerminalInput},
};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let options = SessionOptions::new("form.teml", 80, 24);
    let mut session = Session::spawn(options)?;
    eprintln!("{}", session.engine().diagnostics());

    let mut screen = ScreenBuffer::new(PreferredFrame::Ansi);
    screen.apply(&session.initial_frame()?)?;

    let _guard = TermGuard::new()?;
    paint_terminal(&screen)?;

    let size = crossterm::terminal::size()?;
    let supports_scroll = screen.has_capability(CAPABILITY_SCROLL);
    let mut input = TerminalInput::new(size, CrosstermEvents, supports_scroll);

    loop {
        let Some(command) = input.next_command()? else { continue };
        session.send(&command)?;
        loop {
            match session.next_event()? {
                Event::Frame(frame) => {
                    screen.apply(&frame)?;
                    paint_terminal(&screen)?;
                    break;
                }
                Event::Click { id, values } if id == "submit" => {
                    println!("{values:?}");
                    session.send(&Command::Exit)?;
                }
                Event::Exit => return Ok(()),
                _ => {}
            }
        }
    }
}
```

## Live progress (`update`, protocol 1.2)

Protocol **1.2** adds [`Command::Update`] for in-place mutation of addressable
display widgets (`::progress`, `::metric`) without re-parsing markup. Gate on
the `update` capability before sending updates:

```rust
use std::collections::HashMap;
use teml_host::{Command, CAPABILITY_UPDATE};

if screen.has_capability(CAPABILITY_UPDATE) {
    let mut props = HashMap::new();
    props.insert("value".into(), "73".into());
    session.send(&Command::Update {
        id: "deploy".into(),
        props,
    })?;
}
```

Unlike `render`, `update` preserves focus, cursors, scroll offsets, and the
patch base. Prefer it for high-frequency dashboards; coalesce bursts to stay
near **≤ 20 updates/s**.

## Document mutations (protocol 1.3)

Gate structural commands on `CAPABILITY_DOCUMENT_MUTATIONS`. `Append` can
produce bounded patches; `Replace` and `Remove` end in full resynchronization
frames:

```rust
use teml_host::{Command, DocFormat, CAPABILITY_DOCUMENT_MUTATIONS};

if screen.has_capability(CAPABILITY_DOCUMENT_MUTATIONS) {
    session.send(&Command::Append {
        target: "logs".into(),
        markup: "Worker ready".into(),
        format: Some(DocFormat::Teml),
    })?;
}
```

Keep log streams near ≤10 appends/s and retain about 500 entries; the engine
rejects append targets above 2,000 direct children.

## Engine discovery

Resolution order (mirroring the shared host contract):

1. **Explicit API option** — `EngineResolveOptions::explicit`
2. **`$TEML_CLI`** — path to the engine entry (Node script **or** native binary)
3. **Package script paths** — monorepo defaults via
   `SessionOptions::with_default_package_scripts(manifest_dir)`
4. **`teml` on `PATH`**

**Node vs native:** paths ending in `.js`, `.mjs`, or `.cjs` spawn via
`node <script>`. All other paths — including Node SEA single-executable
artifacts — execute directly:

```rust
use teml_host::{invocation_for_path, is_js_entry};

assert!(is_js_entry("dist/cli/main.js"));
let (program, args) = invocation_for_path("dist/cli/main.js"); // ("node", ["dist/cli/main.js"])
let (program, args) = invocation_for_path("/usr/local/bin/teml"); // ("/usr/local/bin/teml", [])
```

[`ResolvedEngine::diagnostics`] records the resolved executable and probed
`--version` output. Contract tests require a built engine and **fail** when none
is available; they never silently skip.

Build the Node engine locally before running integration tests:

```sh
pnpm run build
cd crates/teml-host
cargo test
```

Point at a built CLI or SEA binary explicitly:

```sh
export TEML_CLI=/path/to/teml/dist/cli/main.js   # Node entry
export TEML_CLI=/path/to/teml-sea                # native SEA binary
cargo test -p teml-host
```

## Protocol version policy

The wire protocol is versioned independently from crate semver. This crate
tracks **protocol 1.3** (`PROTOCOL_MAJOR` / `PROTOCOL_MINOR`). **Major** bumps
are breaking; **minor** bumps are additive and capability-gated. Discovery
metadata on full/resync frames includes:

- `protocol: { major: 1, minor: 3 }`
- `capabilities: ["patches", "scroll", "update", "documentMutations", …]`

Typed models preserve unknown frame fields (`Frame::extra`) and map unknown event
`type` values to `Event::Unknown` so hosts stay forward compatible.

Contract tests cover negotiation, row patches, resize/viewport resync,
column-accurate pointer hit testing, richer keys/modifiers, scroll regions,
live `update` progress ticks, and typed document mutations.

## API overview

| Module | Responsibility |
| --- | --- |
| [`app`] *(feature)* | `run`/`run_headless` loop driver, `App` handlers, `Context` actions |
| [`protocol`] | `Command`, `Event`, `Frame`, update/mutation variants, capability constants |
| [`session`] | `Session::spawn`, `send`, `next_event`, `next_frame`, `close` |
| [`screen`] | Patch-applying `ScreenBuffer` + viewport/scroll metadata |
| [`engine`] | Executable resolution (Node script vs native SEA) + diagnostics |
| [`paint`] | ONLCR-safe output (`\n` → `\r\n` in raw mode) |
| [`terminal`] *(feature)* | `TermGuard`, `TerminalInput`, crossterm mapping |

## Features

- `terminal` *(default)* — crossterm raw mode, mouse capture, input translation,
  and the `app` loop driver

## License

MIT
