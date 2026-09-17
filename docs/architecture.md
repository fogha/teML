# Architecture

This is the current architecture reference. It consolidates the decisions
formerly recorded in ADRs 001–006 and the polyglot strategy document; their
accepted boundaries remain in force. Wire details belong in the
[interactive protocol](interactive-protocol.md), implementation instructions
in the [host playbook](host-porting-playbook.md), and unfinished work in the
repository-only `docs/maintenance.md`. Product milestones are not package versions.

## One engine, distinct execution modes

TeML keeps one canonical TypeScript engine: source frontends produce a `TDoc`,
normalization enforces document rules, layout computes terminal cells, and
renderers produce ANSI, plain text, or semantic speech. Rust, Go, and Python
hosts adapt the subprocess protocol; they do not duplicate the engine.

```text
Node app ── direct commands ──> InteractiveSession
Rust / Go / Python host ── NDJSON stdio ──> teml run / InteractiveSession
                                               │
                                  document → layout → events/frames
```

- `view`, `convert`, and `render` are inert, one-shot document operations.
  `view` never switches to a full-screen UI merely because stdout is a TTY.
- `read` is an inert full-screen viewer. It needs a controlling TTY, uses stdin
  for keys rather than document source, confines local navigation to its
  document root, and requires confirmation before opening external links.
  Widgets are visible but never dispatch application actions.
- `run` is a headless NDJSON application protocol. Its host owns the terminal.
  Node applications may instead use `teml/interactive` in-process.

This separation preserves pipe/scrollback behavior and keeps viewing a document
distinct from running privileged application callbacks. Remote authentication,
session isolation, quotas, and untrusted remote output would require a separate
security design; local-process assumptions are not sufficient.

## Terminal ownership

Reader and the Node app helper share `src/terminal/client/driver.ts`: incremental
input decoding, escape timers, raw mode, mouse tracking, signals, stream errors,
painting, and idempotent teardown belong there. Session code produces events;
it does not acquire terminal resources. ANSI encoding belongs in
`src/render/ansi.ts`, not in individual widgets.

Reader uses damage-diffed screen frames. The Node helper uses `paintRendered()`
for trusted, already-encoded full output; that path invalidates the diff baseline.
Footer policy, resize debounce, wheel coalescing, and callback ordering remain
with the host. Sharing lifecycle does not imply shared application policy.

Startup and callback failures reject the Node app promise after best-effort
cleanup. Returned callback promises are supervised, not awaited or serialized.
Finished apps ignore late commands and detach binding leases. Application-owned
timers/tasks still require application cancellation. SIGKILL cannot be handled,
and a closed output stream cannot receive terminal-restoration bytes.

## Compilation and private document state

`src/document/compiler.ts` owns parse/normalize ordering and distinguishes full
documents from fragments normalized at a graft location. The CLI loads only its
requested frontend; synchronous sessions use `src/document/frontends.ts`.
Transport and document-growth budgets remain at their existing caller boundaries.
CLI debug parse timings exclude frontend module loading.

An interactive session clones the incoming document and layout configuration
before collecting widget references. It then mutates that private document in
place. Live values remain in widget attributes, which layout already reads;
there is no second value store to synchronize. Normalization avoids mutating
input text leaves but is not a general deep-clone guarantee.

The startup clone is document-sized; commands retain incremental layout.
`carryWidgetValues` centralizes value carry-over across document replacement.
`WidgetState` holds transient id-keyed editing state; shared viewport math lives
in `src/layout/viewport.ts`. Document transitions must reconcile indexes, state,
and cached geometry together. See maintenance for remaining reconciliation work.

Revisit a separate live-value store if undo/reset, structured widget values,
or multiple consumers of original and live documents become requirements.
Until then, explicit private ownership costs less complexity than overlaying
another value map throughout layout.

## Host-owned bindings

Node's `bindings()` is a push-only map keyed by updatable widget ID. Assigning a
string sends the existing `update{id,props:{value}}` command. Reads return the
last host-assigned value, not engine state; user-edited values come from
`ctx.values()`. Multi-property changes use `ctx.update()`.

Handler assignments follow the command queue so an older frame cannot overwrite
the resulting update. Each assignment is one update; there is no implicit
coalescing. Outside an attached run, assignment only stores the value. Invalid
targets/values use existing error events rather than a new protocol.

Rust/Go/Python binding convenience APIs and cross-thread wake sources are not
implemented by the Node binding work. Do not present their proposed APIs as
shipped. Generalized `@name` syntax and a `set` command remain deferred until
one host value must feed multiple widgets independently of their IDs.

## Engine discovery and distribution

Host libraries stay in `crates/teml-host`, `hosts/go`, and `hosts/python`.
Their versions are independent of the engine; discovery metadata determines
protocol compatibility. Hosts resolve the engine in this order:

1. Explicit API option.
2. `TEML_CLI`.
3. Package-managed/repository engine path.
4. `teml` on `PATH`.

`.js`, `.mjs`, and `.cjs` paths run through Node; other executables run directly.
Resolution records its source, executable, arguments, and best-effort version.
Hosts fail when the engine is missing; they never silently download one.

`teml.tgz` is the canonical release artifact. Ordinary CI runs host contracts
against the built CLI; release CI installs the packed engine using
`scripts/prepare-host-engine.mjs` and runs host tests against that exact package.
Ecosystem publication requires a named owner and demand: two independent apps,
three concrete requests, or a maintainer accepting ecosystem release ownership.
Do not infer publication status from an old strategy document; inspect release
configuration and registry state for release work.

Node SEA executables are optional platform artifacts, not binaries embedded in
every host package. Promotion requires Linux x64, macOS arm64, and Windows x64
smokes, checksums, and production signing. The July 2026 local macOS arm64 spike
was about 109 MiB with a +9.88 ms cold-start delta; it is historical evidence,
not a guarantee for other platforms. Repeat with `sea:build`, `sea:verify`, and
`sea:bench`. After automation, manually run the platform executable's Reader on
`examples/markup/demo.teml` and `docs/` in a real terminal.

## Native engine decision

Keep TypeScript canonical and harden SEA before starting a second engine.
Reopen only with a necessity trigger **and** a maintainer/CI commitment to at
least 12 months of dual-engine conformance and security work:

- Linux or Windows cannot pass SEA verification after reasonable hardening;
- a required artifact below 20 MiB cannot be delivered by SEA within a release;
- SEA startup exceeds the +100 ms budget on all tier-1 platforms;
- measured host needs require in-process linking; or
- the deployment environment forbids both external and embedded Node.

Rust is the preferred candidate if those gates are met, not an active roadmap.
A core-only port that leaves Node in the shipped CLI does not solve distribution.
Any port needs a versioned shared corpus and differential tests for static CLI,
frontends, Unicode layout, protocol, Reader, installed artifacts, and all hosts.
The TypeScript engine remains the reference until ownership explicitly changes.
