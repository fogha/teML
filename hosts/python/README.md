# teml-host

Stdlib-only Python host library for driving [`teml run`](https://github.com/fogha/teML)
over NDJSON. Import as **`teml_host`** to avoid colliding with a future `teml`
PyPI name.

## Requirements

- Python 3.11+
- A TeML engine (any of):
  - Built repo CLI — `dist/cli/main.js` (spawned via **Node 20+**)
  - Node SEA artifact — `.sea/teml` / `.sea/teml.exe` from `pnpm run sea:build`
  - Native or SEA binary on **`PATH`** or via explicit/`TEML_CLI` path
  - `TEML_CLI` pointing at either a JS entry (`.js`/`.mjs`/`.cjs`) or a native binary

POSIX terminal helpers (`termios` / `tty`) are production-ready. Windows console
support is **experimental** and not covered by integration tests.

## Install

> **Not on PyPI yet.** Publishing runs on a release tag and starts with v0.3.0.
> Until that release lands, install from a checkout:

```sh
cd hosts/python
python -m pip install .
```

Once published, the same package installs by name:

```sh
python -m pip install teml-host
```

This is the host library only; it drives a TeML engine that it locates at runtime
(see [Engine discovery](#engine-discovery)). For local development against this
repository, install it editable instead:

```sh
cd hosts/python
python -m pip install -e ".[dev]"
```

## Quick start

Supply handlers and let the package own the loop, the terminal, and painting:

```python
from teml_host import Context, run

def on_click(widget_id: str, values: dict[str, str], ctx: Context) -> None:
    if widget_id == "submit":
        ctx.exit()

values = run("view.html", on_click=on_click)
```

`run` spawns the engine, holds raw mode for the session, paints every frame, and
returns the final widget values once a handler calls `ctx.exit()`, the user
presses Ctrl+C, or the engine ends the session. Terminal state is restored even
if the loop raises. Terminal dimensions are read for you unless you pass
`width`/`height`.

Handlers can also mutate the document: `ctx.render()` swaps the whole view, while
`ctx.replace()`/`ctx.append()`/`ctx.remove()` target one addressable container.
Requests are queued and sent once the handler returns, so a handler never
interleaves commands with the event stream it is being dispatched from.
`run_headless` is the same loop with an injected event source and no painting,
for tests.

The `on_change`/`on_toggle`/`on_click`/`on_error` contract and these context
actions match the Node, Rust, and Go hosts, so one view behaves the same way
whichever language drives it — `examples/incident_handoff/view.html` is
byte-identical to the Rust and Go example views.

## Session API (headless contract)

For applications that need unusual control, the lower-level session is public and
you can own the loop yourself:

```python
from teml_host import Session, PreferredFrame, ScreenBuffer, CharCommand

screen = ScreenBuffer(PreferredFrame.PLAIN)
with Session.spawn("view.html", width=60, height=24, no_color=True) as session:
    frame = session.next_event()
    screen.apply(frame)
    session.send(CharCommand(char="payments"))
    change = session.next_event()
    frame = session.next_frame()
    screen.apply(frame)
print(screen.text())
```

## Protocol 1.2 — live `update`

Protocol **1.2** adds the `update` command for in-place widget mutation without
re-parsing markup (requires the engine `update` capability):

```python
from teml_host import Session, UpdateCommand, ConfigureCommand, ScreenBuffer, PreferredFrame

with Session.spawn("dashboard.teml", no_color=True) as session:
    screen = ScreenBuffer(PreferredFrame.PLAIN)
    screen.apply(session.next_event())
    session.send(ConfigureCommand(frames="plain", mode="patches"))
    screen.apply(session.next_frame())
    session.send(UpdateCommand(id="deploy", props={"value": "73", "max": "100"}))
    screen.apply(session.next_frame())
    print(screen.text())
```

Exported protocol constants: `PROTOCOL_VERSION`, `ENGINE_CAPABILITIES`,
`CAPABILITY_DOCS`, and wire limits (`MAX_NDJSON_LINE_BYTES`, etc.).

## Protocol 1.3 — document mutations

Gate `ReplaceCommand`, `AppendCommand`, and `RemoveCommand` on the engine's
`documentMutations` capability:

```python
from teml_host import AppendCommand

session.send(AppendCommand(target="logs", markup="Worker ready", format="teml"))
screen.apply(session.next_frame())
```

Append may produce bounded row patches; replace/remove resynchronize with full
frames. Keep log streams near 10 appends/s and retain about 500 entries. Fall
back to a host-held full render on older engines.

## Engine discovery

Resolution order (first match wins):

1. Explicit `engine=` argument to `Session.spawn`
2. `TEML_CLI` environment variable
3. Repository `dist/cli/main.js` (via **node**)
4. `teml` executable on `PATH` (native/SEA or npm shim)

**JS vs native:** paths ending in `.js`, `.mjs`, or `.cjs` are spawned with
`node <path>`. Any other executable (including SEA `teml` binaries) runs directly.

`Session.engine_info` records the resolved source, argv prefix, and `--version`
output for diagnostics.

### Examples

```sh
# Dev — built Node CLI
export TEML_CLI=/path/to/teml/dist/cli/main.js

# SEA spike artifact (no Node required at runtime)
export TEML_CLI=/path/to/teml/.sea/teml

# Or rely on repository/PATH discovery
pnpm run build     # repository dist/cli/main.js
pnpm run sea:build # optional SEA binary
export PATH="$PWD/.sea:$PATH"
```

## Incident handoff example

```sh
cd hosts/python/examples/incident_handoff
python main.py
```

Keyboard flow matches the Rust and Go reference hosts: tab focus, radio arrows,
multiline summary (Ctrl+Enter), scroll region, checkbox toggle, submit/cancel
validation.

## Tests

Integration tests require a built TeML engine. From the repository root:

```sh
pnpm run build
cd hosts/python
python -m compileall src tests examples
pytest -q
```

Missing engines **fail** the suite; they are never skipped.

## License

MIT — same as the TeML project.
