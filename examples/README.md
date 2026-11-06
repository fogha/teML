# Examples

Run `pnpm run build` from the repository root first. Interactive demos require a
real terminal; Ctrl+C exits and restores it. No example persists your settings.

| Example | Run from repository root | Purpose |
| --- | --- | --- |
| Chat | `pnpm run demo:chat -- --mock` | Streaming, cancellation, retry, compact actions; no API key in mock mode |
| Chat without a terminal | `pnpm run demo:chat -- --mock --once "Hello"` | Render a mock response once |
| Settings | `pnpm run demo:settings` | Inline labels, radios, native field validation, save/cancel |
| Snake | `pnpm run demo:snake-prototype` | Canvas game; arrows/WASD, P pause, R restart, Q exit |
| Canvas animation | `pnpm run demo:canvas-js` | Host-driven pixel operations |
| Fireworks | `pnpm run demo:canvas-fireworks` | Animated canvas example |
| Bindings | `node examples/apps/bindings/demo.mjs` | Host-owned live value bindings |
| Elicitation | `pnpm run demo:elicitation` | Schema-driven forms |
| Interactive catalog | `pnpm run demo:interactive` | Subprocess reference host and widget catalog |
| Logs / progress | `pnpm run demo:log-viewer` / `pnpm run demo:live-progress` | Scrolling and incremental updates |
| Static markup | `pnpm run demo` | Inert document rendering; works through pipes |
| Rust / Go / Python hosts | `pnpm run demo:rust-host` / `demo:go-host` / `demo:python-host` | The same incident-handoff workflow through each host library |

`apps/` groups each application's view, controller, and optional pure state together.
`interactive/` contains the JavaScript protocol reference host; `markup/` contains
static documents. Rust remains under `examples/rust-host`; Go and Python reference
apps remain with their host packages. These locations are intentional compatibility
choices for this change, not separate implementations of the rendering engine.

Chat's New chat action cancels the active response. Failed requests restore the
prompt unless a newer draft has been entered. Real chat needs `DEEPSEEK_API_KEY`;
network/API availability is separate from mock-mode validation.
