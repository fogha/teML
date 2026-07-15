# ADR-002: Add `teml read`; preserve `teml view`

## Status

Accepted for v1.5.

## Context

`teml view` is the current default command and a stable Unix-style operation:
it accepts files or stdin, writes a complete render to stdout, automatically
drops ANSI when piped, and composes with pagers and snapshots.

Changing `view` to enter raw mode automatically on a TTY would make behavior
depend on invocation context and could break scripts, recordings, tests, and
users who expect output to remain in terminal history.

The v1.5 Reader also strengthens the permanent security boundary between inert
documents and event-connected applications.

## Decision

Add a distinct command:

```text
teml read FILE
teml read DIRECTORY
```

`read` requires a controlling TTY, owns the alternate screen, and supports
scrolling, links, search, table of contents, history, and directory browsing.
It does not consume document source from stdin because stdin is the keyboard
event stream.

Keep these modes distinct:

- `view`, `convert`, and `render`: inert, one-shot document operations;
- `read`: inert full-screen document navigation;
- `run`: event-connected application protocol.

Widgets remain visible but inert in Reader. Local link navigation is confined
to the initial document root. External links require explicit confirmation
and never become host-application events.

## Alternatives Considered

### `teml view --interactive`

This avoids a command, but hides the primary v1.5 capability behind a flag and
makes documentation and shell completion less discoverable.

### Automatically enter Reader for TTY output

This is convenient but changes the established `view` contract based on
environment detection and makes output-history behavior surprising.

## Consequences

- Existing `view` tests and scripts remain valid.
- Reader can reject non-TTY use with a direct suggestion to use `view`.
- Directory browsing belongs to `read`, not `view`.
- Users choose whether output persists in scrollback or uses a full-screen
  reading session.
