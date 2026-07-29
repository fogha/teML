# TeML Go host library

Framework-neutral Go bindings for driving [`teml run`](../../docs/interactive-protocol.md) over NDJSON stdio (protocol **1.3**). The host owns the real terminal; TeML owns parsing, layout, hit-testing, and rendering.

## Layout

| Package | Responsibility |
|---------|----------------|
| [`app`](app/) | `Run`/`RunHeadless` loop driver, `Handlers`, `Context` actions |
| [`protocol`](protocol/) | Typed commands, events, wire limits (`update` and document mutations) |
| [`ndjson`](ndjson/) | 8 MiB-safe line splitting |
| [`screen`](screen/) | Full/patch frame reconstruction |
| [`engine`](engine/) | Engine discovery, `Session` spawn/I/O |
| [`terminal`](terminal/) | Raw mode, ONLCR paint, input helpers |

## Engine resolution

Discovery order (first match wins):

1. Explicit path passed to `engine.Resolve` / `Spawn`
2. `$TEML_CLI` — path to the engine artifact
3. Monorepo package path — `dist/cli/main.js` at the repository root
4. `teml` on `PATH`

**Launch rule:** `.js` / `.mjs` / `.cjs` entries spawn via `node`. Native executables (including Node SEA single-binary artifacts) run directly.

`ResolvedEngine.Diagnostics()` records program, path, source, and `--version`. Missing engines return an error; contract tests **fail** instead of skipping.

## Install

```sh
go get github.com/fogha/teml/hosts/go
```

This is the host library only; it drives a TeML engine that it locates at runtime
(see [Engine resolution](#engine-resolution)).

## Quick start

Build the Node engine from the repo root, then run the incident-handoff example:

```sh
pnpm run build          # from repo root
cd hosts/go
go test ./...
go run ./examples/incident-handoff
```

Point at a specific CLI artifact:

```sh
export TEML_CLI=/path/to/dist/cli/main.js
go test ./...
```

## Handler API (`app`)

Supply handlers and let the package own the loop, the terminal, and painting:

```go
opts, err := app.ForTerminal("view.html")
if err != nil {
    return err
}

values, err := app.Run(opts, app.Handlers{
    OnClick: func(id string, values app.Values, ctx *app.Context) {
        if id == "submit" {
            ctx.Exit()
        }
    },
})
```

`Run` spawns the engine, holds raw mode for the session, paints every frame, and
returns the final widget values once a handler calls `ctx.Exit()`, the user
presses Ctrl+C, or the engine ends the session. Terminal state is restored even
if the loop fails.

Handlers can also mutate the document: `ctx.Render` swaps the whole view, while
`ctx.Replace`/`ctx.Append`/`ctx.Remove` target one addressable container.
Requests are queued and sent once the handler returns, so a handler never
interleaves commands with the event stream it is being dispatched from.
`RunHeadless` is the same loop with an injected command source and no painting,
for tests.

The `OnChange`/`OnToggle`/`OnClick`/`OnError` contract and these context actions
match the Node, Rust, and Python hosts, so one view behaves the same way
whichever language drives it — `examples/incident-handoff/view.html` is
byte-identical to the Rust and Python example views.

## Session API

For applications that need unusual control, the lower-level session is public
and you can own the loop yourself:

```go
session, err := engine.Spawn(engine.SpawnOptions{
    ViewPath: "view.html",
    Width:    80,
    Height:   24,
    // Prefer CLI flags OR stdin configure — not both.
    Frames:   protocol.FrameANSI,
    Mode:     protocol.FramePatches,
})
defer session.Close()

frame, _ := session.InitialFrame()
_ = session.Send(protocol.Update("deploy", map[string]string{"value": "50"}))
_ = session.Send(protocol.Key(protocol.KeyTab, nil))
ev, _ := session.Next()        // semantic events (change, toggle, click, …)
frame, _ = session.NextFrame() // skips non-frame events
```

Live widget updates require the engine's `update` capability (protocol 1.2). Check `frame.Capabilities` or `screen.Buffer.HasCapability(string(protocol.CapUpdate))`.

Targeted `Replace`, `Append`, and `Remove` commands require the protocol 1.3
`documentMutations` capability. Keep log streams near 10 appends/s and retain
about 500 entries; use a full `Render` fallback when the capability is absent.

Apply frames with `screen.Buffer`, then paint:

```go
buf := screen.NewBuffer(screen.PreferredANSI)
_ = buf.Apply(frame)
_ = terminal.Paint(os.Stdout, buf)
```

Raw mode and mouse passthrough use [`golang.org/x/term`](https://pkg.go.dev/golang.org/x/term). Enable SGR mouse reporting with `terminal.EnableMouseCapture`; decode clicks from stdin (see `terminal.Reader`) or integrate your own parser. Mouse sequences are **1-based** in the wire format from the terminal and must be converted to the protocol's **0-based** `pointer` rows/cols.

## Porting another language

See [`docs/host-porting-playbook.md`](../../docs/host-porting-playbook.md) for the language-neutral checklist.

## Platform notes

| Platform | Raw mode | Mouse |
|----------|----------|-------|
| macOS/Linux tty | `x/term.MakeRaw` | xterm SGR (`1000/1002/1006`) |
| Windows | Console raw via `x/term` | varies by terminal — test locally |

Terminal helpers are POSIX-first. Always restore the terminal on panic, signal, and normal exit (`terminal.RawTerminal.Close`).

## License

Same as the TeML repository.
