# ADR 003: Host libraries and engine artifacts

## Status

Accepted — July 2026.

## Context

Rust, Go, and Python hosts all need the same TeML engine, but the current
release is a Node package while the Node SEA build also produces
platform-native executables. Host APIs must not depend on either artifact
shape, silently download an engine, or pass CI against a different engine than
the one being released.

## Decision

### Repository and ownership

Host libraries live in this monorepo until demand justifies independent
repositories:

- Rust: `crates/teml-host`
- Go: `hosts/go`
- Python: `hosts/python`

They version independently from the engine package. Protocol compatibility is
governed by discovery metadata, not matching package versions. Core maintainers
own coordinated conformance updates; ecosystem publication requires a named
release owner and the demand gate in `docs/polyglot-hosts.md`.

### Engine discovery

Every host resolves the engine in this order:

1. explicit API option;
2. `TEML_CLI`;
3. a package-managed/repository engine path;
4. `teml` on `PATH`.

Paths ending in `.js`, `.mjs`, or `.cjs` run through Node. Other executable
paths run directly, allowing a SEA or future native engine without changing
host APIs. Resolution records the source, executable, arguments, and best-effort
`--version` output. Missing required engines fail; hosts never download one.

### Artifacts

- `teml.tgz` remains the stable Node package attached to each `v*` release.
- SEA spike artifacts use `teml-{platform}-{arch}` (plus `.exe` on Windows).
- Checksums and production signing are required before SEA artifacts move from
  the spike workflow into the release workflow.

### Conformance tiers

Ordinary CI builds `dist/cli/main.js`, sets `TEML_CLI` explicitly, and runs all
host contract suites.

Release CI builds `teml.tgz`, installs it into a clean `.host-engine` directory
with `scripts/prepare-host-engine.mjs`, exports that installed CLI as
`TEML_CLI`, and runs `pnpm run test:hosts`. This is non-skipping and verifies
the exact artifact attached to the release.

SEA binaries satisfy the same contract by setting `TEML_CLI` to the executable.
The platform matrix remains a spike gate until Linux, macOS, and Windows all
pass the binary smoke suite.

### SEA feasibility outcome

The local spike on 2026-07-27 used Node v22.22.1 on macOS arm64:

| Metric                  |                          SEA |              Node CLI |
| ----------------------- | ---------------------------: | --------------------: |
| Binary size             | 114,445,072 bytes (~109 MiB) | External Node runtime |
| Median cold `--version` |                     53.02 ms |              43.14 ms |
| Idle `run` RSS          |                    71.70 MiB |             88.72 MiB |

The +9.88 ms startup delta passed the +100 ms budget. The embedded executable
passed version, demo, convert, `run` NDJSON, and the `read` non-TTY guard.
Bundling the ESM CLI and its dynamic imports through esbuild succeeded.

The distribution decision is therefore a conditional go:

- harden optional `teml-{platform}-{arch}` SEA release artifacts before
  considering a native engine port;
- require green linux-x64, macos-arm64, and win-x64 smoke jobs, checksums, and
  production signing before adding SEA files to normal releases;
- retain `teml.tgz` as the canonical package and do not embed the ~109 MiB SEA
  executable inside every host-language package.

Linux and Windows remain unverified outside the configured
`.github/workflows/sea-spike.yml` matrix. Build caveats include matching the
injector and Node versions, removing/reapplying macOS signatures around
`postject`, and allowing the lockfile-pinned esbuild install script under pnpm 10.

CI cannot exercise the full-screen Reader in a real terminal. Release QA must
run the platform-local binary manually until a pseudo-TTY harness exists:

```bash
pnpm run sea:build
./.sea/teml read examples/markup/demo.teml
./.sea/teml read docs/
```

The implementation and repeatable checks live in `scripts/sea/`,
`src/sea/runtime.ts`, and `.github/workflows/sea-spike.yml`.

## Alternatives considered

- Bundling an engine into each host package duplicates large artifacts and
  couples every host release to engine security updates.
- Requiring a global pnpm installation keeps the Node adoption barrier.
- Automatic engine downloads weaken pinning, offline use, and supply-chain
  review.

## Consequences

- Host APIs remain artifact-neutral and can adopt SEA without a breaking change.
- Release CI is slower because each language runs against the packed engine.
- Host packages stay unpublished until an ecosystem owner accepts maintenance.
- SEA release hardening still needs checksums, signing, and a green platform
  matrix.
