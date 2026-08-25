# ADR 006: Id-keyed bindings — assignment, not commands

## Status

Proposed. Adopts the minimal id-keyed form and defers the earlier
`@name`/`set{name,value}` generalization to a future ADR.

## Context

The engine already has everything needed to reflect a host-side value change
into the interface: the `update{id,props}` command (`src/interactive/session.ts`
→ `handleUpdate`), the mutable-attr allowlist (`src/teml/directives.ts` →
`UPDATABLE_MUTABLE_ATTRS`), and dirty-row relayout (`src/interactive/layout-cache.ts`).
Every host SDK already carries the command type — `protocol.Update` (Go),
`UpdateCommand` (Python), `Command::Update` (Rust) — and a low-level
`session.send(...)` to emit it.

What the author does *not* have is the ergonomic we want: **a variable they
assign to, whose change is reflected in the interface.** Today they must reach
for the wire command, keyed by widget id, per widget, per change. An earlier
proposal — `@name` reference syntax plus a new `set{name,value}` command — would
fix this, but that generalization is larger than the problem it solves for v1: the host
*authors the markup*, so it already chose the ids. The name it would bind is
the id.

There is also a concrete gap: the in-process Node host
(`src/interactive/host.ts`) never exposes `update` at all — its
`InteractiveAppContext` has `render`/`replace`/`append`/`remove`/`values`/`exit`
but no way to mutate a live `::metric` or `::progress`.

## Decision

**Introduce a binding object, keyed by widget id, in each host SDK.** Assigning
a value to a key emits the already-existing `update{id, props}` command under
the hood. There is no new engine behavior, no new protocol command, no new
capability, and no markup grammar change.

The host owns the value; the markup presents it. A binding is a **push-only,
host-owned variable**: reading a key returns the last value the host assigned
(or empty if never assigned), never engine state. Widgets that the user edits
(inputs, checkboxes, radios, textareas) are unchanged and remain readable
through `ctx.values()`.

### Binding semantics

- A binding is keyed by the id of an **updatable** widget — today `::metric`
  and `::progress`. Assigning to any other id produces the engine's existing
  `error` event ("unknown update id '…'") and the session stays alive.
- **Assigning a string** `s` to key `id` emits `update{id, {value: s}}`.
  `value` is the single shared display attribute of both updatable widgets, so
  this is the entire scalar surface.
- **Multi-prop updates are out of scope for the binding object.** Setting
  `label`, `change`, or `max` stays on the low-level `update` primitive
  (`ctx.update` / `session.send(UpdateCommand(...))`), which remains public.
- Assigning a value the widget rejects (e.g. a non-numeric `value` for
  `::progress`) surfaces as the engine's existing `error` event; nothing
  crashes and the widget keeps its previous value.

### Per-language shape

**Node (in-process)** — transparent assignment via a `Proxy`:

```js
import { bindings, runInteractiveApp } from "teml/interactive";

const state = bindings();
runInteractiveApp(view, {
  state,
  handlers: {
    onClick(id, _values, ctx) {
      if (id === "refresh") state.cpu = "99%"; // → update{id:"cpu", props:{value:"99%"}}
      if (id === "save") ctx.exit();
    },
  },
});
setInterval(() => {
  state.clock = new Date().toLocaleTimeString(); // timer: no extra machinery needed
}, 1000);
```

**Python** — dict-style or attribute assignment:

```python
from teml_host import Bindings, run

state = Bindings()
def on_click(id, values, ctx):
    if id == "refresh":
        state["cpu"] = "99%"     # or: state.cpu = "99%"
run(doc, on_click=on_click, state=state)
```

**Go** — a one-method handle (Go cannot intercept `=`):

```go
state := app.NewBindings()
app.Run(opts, app.Handlers{
    OnClick: func(id string, values app.Values, ctx *app.Context) {
        if id == "refresh" { state.Set("cpu", "99%") }
    },
}, state)
```

**Rust** — a one-method handle, interior-mutable so handlers can share it:

```rust
let bindings = Bindings::new();
run(options, &mut my_app, &bindings)?;
// inside impl App for MyApp, on_click:
//     self.bindings.set("cpu", "99%");
```

The asymmetry is a property of the languages, not of the design: JS and Python
can intercept assignment; Go and Rust cannot, so they get the smallest honest
equivalent, one `Set`/`set` call.

## Wiring and ordering

Assignment must behave exactly like the existing `ctx.render`/`ctx.replace`
requests, because it is the same failure mode the v0.3.0 handler-queue bug
already fixed (see CHANGELOG: a handler's re-render was painted over by the
stale frame because `handle()` builds its whole event array before returning).

Consequently:

1. **The binding object is created by the author and passed into the driver.**
   The driver attaches its command sink to it at startup, so assignment before
   or after the run is a harmless store, and assignment during the run enqueues
   one `update`.
2. **Assignment from a handler enqueues into the driver's existing request
   queue** — the same `queued` slice the context actions use — and is flushed
   after the handler returns, so a fresh frame is never overwritten by the
   stale one that was already built for the triggering event.
3. **No coalescing or debouncing in v1.** Each assignment is one `update`
   command, delivered immediately. The engine's patch-mode dirty-row rendering
   already makes a burst of updates cheap, so batching is a later optimization,
   not a correctness requirement.

## In-process Node gap

The binding object is built on a new primitive: `runInteractiveApp`'s
`InteractiveAppContext` gains

```ts
update(id: string, props: Record<string, string>): void;
```

which sends `{ type: "update", id, props }` through the existing `send()`
queue. This is the same command the three other SDKs already expose. It both
powers the binding object and restores parity for Node authors who want the
full multi-prop surface.

## Async assignment and the wake source (scoped)

The motivating clock/timer case works differently by language, and the spec is
honest about the boundary:

- **Node in-process: fully in scope, zero extra machinery.** Timers run on the
  same event loop between input events, so `state.clock = …` from `setTimeout`/
  `setInterval` reaches `send()` directly; `send()`'s existing `dispatching`
  queue already serializes it correctly.
- **Go / Rust / Python: handler-triggered assignment is in scope.** It rides
  the existing request queue above.
- **Go / Rust / Python: timer/async assignment from another goroutine/thread is
  deferred.** The driver loop currently blocks on terminal input, so a value
  assigned from a timer sits in the binding until the next keystroke. Making it
  wake the loop immediately needs a real wake source (a channel in Go, a
  notifying pipe under `select` in Python, mpsc + crossterm `poll` in Rust)
  multiplexed with input. That is the one place a "wake the loop" source
  is actually required, and it is deliberately a separate, later step
  rather than bundled into this change.

## Deferred

The `@name` reference syntax and `set{name,value}` command remain a valid
future escalation for the specific capability id-keyed bindings do not provide:
**one host value rendered in many widgets without the host knowing any widget
id**, and **a host updating values without having authored the markup**. That
is the only thing `@name` buys over this design. It stays deferred, and only
becomes worth building if that "one value → N widgets, host does not own the
layout" case is actually required.

## Non-goals

- No new protocol command, capability, or protocol version.
- No markup grammar change (`@name` is not part of this).
- No object/structured assignment (`state.id = {value, change}`); multi-prop
  stays on `update`.
- No reads-from-engine for bindings; `values()` keeps that role for user input.
- No cross-thread wake source for Go/Rust/Python in this change.

## Consequences

- Authors get "assign a variable, it reflects" in every language, with the
  language-honest API shape (transparent in JS/Python, one method call in
  Go/Rust).
- The wire remains `update{id,props}`; nothing downstream changes. 1.x hosts
  and transcripts stay valid.
- The in-process Node host gains the `update` primitive it was missing,
  independently useful.
- Invalid binding targets or values degrade through the existing `error` event
  path — graceful degradation, unchanged.
- The deferred timer case is explicit, so nobody discovers the input-block
  limitation later as a surprise.

## Test plan

- **Engine:** no change; existing `update` tests
  (`tests/interactive/*`, `tests/system/interactive-journey.test.ts`) must stay
  green.
- **Node:** `runInteractiveApp` with a binding object — assign from `onClick`
  and assert the metric/progress value in the next frame; assert an unknown id
  emits `onError` and the session continues; assert a timer assignment lands
  without a keystroke (headless streams).
- **Python:** headless `run_headless` with `Bindings`; `state["cpu"] = …` in a
  handler updates the frame; unknown id surfaces through `on_error`.
- **Go:** `app.RunHeadless` with `NewBindings`; `state.Set("cpu", …)` in a
  handler updates the frame; `protocol.Update` round-trip is unchanged.
- **Rust:** `run_headless` with `Bindings`; `set("cpu", …)` updates the frame;
  existing `Command::Update` round-trip tests unchanged.

## Docs to update

`docs/interactive-protocol.md` (in-process `update` primitive; binding objects
in each SDK) and each SDK's README.
