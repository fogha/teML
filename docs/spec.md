# TeML format specification (v1)

TeML (Terminal Markup Language) is **CommonMark + GFM** (tables, strikethrough, task lists where supported) plus **directives** and **YAML frontmatter**, rendered through a shared document AST.

## Frontmatter

Optional YAML block at the top:

```yaml
---
title: My Document
theme: dark
base: https://example.com/docs/
lang: en
roles:
  brand:
    fg: cyan
    bold: true
---
```

| Key | Type | Purpose |
| --- | --- | --- |
| `title` | string | Document title (metadata + HTML `<title>` mapping) |
| `theme` | string | Default theme name or path |
| `base` | string | Base URL/path for relative link resolution |
| `lang` | string | Language tag (metadata) |
| `roles` | map | Custom role → style overrides merged into the active theme |

## Block syntax

Standard Markdown blocks: headings (levels 1–4; deeper levels clamp with warning), paragraphs, lists, blockquotes, fenced code, GFM tables, thematic breaks.

### Container directives

Fence length is **three or more colons**, and **the outermost fence must be the
longest**. A container closes at the first closing fence at least as long as its
own opener, so an inner fence that is longer than its parent's will close the
parent early and strand every following block outside it — with no diagnostic.

```markdown
:::card{title="Summary"}
Body content
:::
```

Nesting therefore makes the *outer* fence grow:

```markdown
::::card{title="Outer"}

:::info
Info inside the card.
:::

::::
```

Reading the rule as "depth counted from the inside" produces the broken form
(`:::card` containing `::::info`) and is the easiest way for a generator to emit
a silently mis-nested document.

v1 registry:

| Name | Attributes | Renders as |
| --- | --- | --- |
| `card` | `id`, `title` | Bordered panel with title bar |
| `info`, `success`, `warning`, `error`, `note` | `id`, `title` | Alert panels with role styling |
| `definition` | `term` | Definition list block |
| `grid` | `id`, `columns`, `gap`, `width`, `padding`, `margin`, `align`, `frame`, `title` | Responsive multi-column layout with optional light frame and alignment (1–4 columns; auto-reduces below 18-cell width) |
| `details` | `id`, `summary`, `open` | Collapsible disclosure (`open="false"` hides body) |
| `figure` | `id`, `caption` | Figure body with trailing caption line |
| `footnote` | `id` | Footnote definition block |
| `radio` | `id`, `value` | One focusable single-choice group containing `::option` leaves |
| `scroll` | `id`, `rows` | Focusable fixed-height region over cached static child content |
| `form` | `id`, `label` | Grouping of fields plus a submit button; under `teml run` an activation emits one atomic `submit` event. Not nestable, and not supported inside `scroll` |

Unknown containers are kept with a `unknown-directive` warning.

### Leaf directives

```markdown
::kv{Host="db-1" Port="5432"}
::image{src="https://…" alt="Diagram"}
::break
::metric{id="cpu" label="CPU" value="72%" role="warning" change="+4%"}
::progress{id="deploy" label="Disk" value="92" max="100" role="error"}
::event{time="09:15" title="Deploy finished" detail="production cluster" role="info"}
```

| Name | Attributes | Renders as |
| --- | --- | --- |
| `kv` | key/value pairs | Two-column key/value table |
| `image` | `src`, `alt` | Alt placeholder or linked image text |
| `canvas` | `id`, `label`, `width`, `height`, `renderer` | Experimental host-driven pixel surface; half-block or Braille cells with ASCII fallback |
| `break` | — | Thematic break |
| `metric` | `id`, `label`, `value`, `role`, `change` | KPI label + bold value (+ optional delta); `id` enables live `update` |
| `progress` | `id`, `label`, `value`, `max`, `role` | Label, percent, and filled bar (`█`/`░` or `#`/`-`); `id` enables live `update` |
| `event` | `time`, `title`, `detail`, `role` | Timeline row with marker, time, title, wrapped detail |
| `button` | `id`, `label`, `submit`, `width`, `padding`, `margin` | Label inside a clickable light box; focusable under `teml run`. `submit` makes it a form submit control |
| `input` | `id`, `label`, `value`, `placeholder`, `mask`, `width`, `padding`, `margin`, plus validation attrs | Label above a light box around the value; focusable, editable under `teml run` |
| `checkbox` | `id`, `label`, `checked` | `☑`/`☐` (or `[x]`/`[ ]`) + label; focusable, toggleable under `teml run` |
| `textarea` | `id`, `label`, `value`, `placeholder`, `rows`, `autoGrow`, `maxRows`, `width`, `padding`, `margin`, plus validation attrs (no `pattern`) | Multiline editor; fixed-height by default, optionally content-growing with internal scrolling under `teml run` |
| `option` | `value`, `label` | Radio option; meaningful only as a child of `:::radio` |

#### Field geometry

`width` limits the outer box width in terminal cells and is clamped to the
available space. `padding` sets horizontal cells and blank rows inside the
border; `margin` sets blank rows before and after the field. All three are
optional and default to the app-wide `fields` layout configuration:
`paddingX=1`, `paddingY=0`, `marginY=0`, and full available width. `align`
accepts `start`, `center`, or `end` when a grid or field is narrower than the
terminal, and `frame="true"` draws a shared light box around a grid. `rows`,
`autoGrow`, and `maxRows` control textarea content height independently.

#### Validation attributes

`required`, `pattern`, `minLength`, `maxLength`, and `count` may appear on
`input` and `textarea` (`pattern` is single-line only). They are **inert outside
a `:::form`**: grouping is what gives them somewhere to report a failure.

| Attribute | Meaning |
| --- | --- |
| `required` | A bare `required`, `required=""`, or `required="true"` rejects a value that is empty or only whitespace |
| `pattern` | Anchored to the **whole** value (`^(?:pattern)$`), so a partial match does not pass. A pattern that fails to compile is ignored with a `validation-invalid-pattern` warning; the document still renders |
| `minLength`, `maxLength` | Counted in **Unicode code points** by default, matching JSON Schema. A malformed or negative value is ignored with `validation-invalid-length` |
| `count` | `"codepoints"` (default) or `"graphemes"`, for authors who mean user-perceived characters rather than the schema's unit |

An empty optional field satisfies `pattern`/`minLength`/`maxLength`; only
`required` can fail against an empty value. The message a failure renders is
engine-authored and never echoes the value.

#### Masking

`mask` on `input` or `textarea` replaces every grapheme of the rendered value
with `•` (`*` without Unicode), preserving the caret position. Any value other
than `"false"` enables it, so a bare `mask` works; `mask="password"` is the
conventional spelling. HTML `<input type="password">` maps to `mask="password"`.

**Masking is a display transform only.** The real value stays in the attribute
and in every `change`/`submit`/`click` payload — it is hidden from the *screen*,
not from the host.

Radio groups use structure, not comma-separated option strings:

```markdown
:::radio{id="plan" value="pro"}
::option{value="free" label="Free"}
::option{value="pro" label="Pro"}
:::
```

Textarea attribute values encode line breaks as `\n`; parsing and
serialization preserve them as real LF characters in the AST.

### Inline spans

Shorthand roles: `:success[text]`, `:warning[…]`, `:error[…]`, `:info[…]`, `:muted[…]`, `:highlight[text]`, `:kbd[keys]`.

GFM `~~strikethrough~~` maps to the `strike` inline node (SGR 9 in ANSI themes).

`:status[text]{role=warning}` for custom status roles.

`:fn{id="ref"}` for footnote references; pair with `:::footnote{id="ref"}` blocks.

## Escaping

TeML text escapes `\`, `` ` ``, `*`, `_`, `[`, `]`, `:`, `{`, `}` where needed. The serializer (`serializeTeml`) and parser round-trip AST-stable for the supported subset.

## Security (normative)

1. **S-1:** All text is sanitized at ingestion (`sanitizeText`): C0 controls (except `\n`), DEL, C1, bidi controls, stray ZW chars stripped; ZWJ preserved inside emoji sequences; tabs expand in code.
2. **S-3:** Link targets pass `processHref`: scheme allowlist `http`, `https`, `mailto`, relative/`#` anchors; `file:` only with `--allow-file-links`; resolved URLs must stay within `--base` when set.
3. **S-6 (Reader):** `teml read` re-resolves every activated target against the session's fixed document root. Targets outside that root or outside the scheme allowlist are not loaded or opened and emit a visible diagnostic. External `http`, `https`, and `mailto` targets require explicit confirmation.
4. Raw HTML nodes in Markdown are dropped with `raw-html-ignored`.
5. No execution semantics exist in the format.
6. **Canvas bounds:** width and height are clamped to 256 pixels each, and a canvas command is limited to 10,000 operations. Rectangle coordinates must be finite numbers, dimensions must be non-negative, and drawing is clipped to the surface. Colors use only the strict `#RRGGBB` form.
7. **Canvas isolation:** canvas operations cannot fetch images or URLs, execute client-side scripts, or emit raw terminal control sequences. HTML canvas mapping uses an attribute allowlist and drops event-handler attributes.

The DeepSeek chat example applies the same untrusted-input boundary to streamed
responses. Malformed SSE JSON raises a controlled `SyntaxError` that the app
reports as a failed turn. Real requests have a 60-second deadline covering both
connection and response-body reads; it is combined with caller cancellation so
starting a new conversation still aborts the active request. A malformed or
stalled stream therefore produces an actionable error instead of leaving the
chat busy indefinitely.

## Conformance

The fixture corpus under `fixtures/teml/` (≥30 files), `fixtures/html/` (≥20), and `fixtures/markdown/` (≥10) is the regression reference. Snapshots at widths 20/40/80/120 in plain mode are checked in CI.

## Lossy mappings

| Construct | Markdown export | HTML without profile |
| --- | --- | --- |
| Alerts | Blockquote + bold label | Blockquote |
| Card | Heading + body | Flattened wrapper |
| `kv` | GFM two-column table | `dl` mapping |
| `image` leaf | `![alt](src)` or placeholder | Alt placeholder |
| Custom underline | Plain children | `<u>` when present |

Diagnostics use code `markdown-lossy-conversion` for TeML-only features.

## Dashboard layout (grid, metric, progress, event)

**Grid** (`:::grid{columns="N" gap="G"}`) lays out block children in rows. `columns` is clamped to 1–4; `gap` (spaces between columns) to 1–4. When the viewport cannot give each column at least 18 cells, columns reduce automatically (never overflow).

**Metric** leaves render a muted label line and a bold value line. Optional `role` applies theme coloring; `change` appends a muted delta (e.g. `+4%`).

**Progress** leaves clamp `value` to `[0, max]` (default `max=100`), show `NN%`, and draw a full-width bar. `role` colors the percent and bar.

**Event** leaves render `time`, a marker (`●` or `*`), `title`, and an indented wrapped `detail`.

**Details** containers show a disclosure header (`▼`/`▶` or `v`/`>`). Body is hidden when `open="false"`.

**Figure** containers render child blocks, then a muted `Figure: caption` line.

## HTML bridge (`data-teml`)

When mapping HTML without a profile match, elements may declare TeML semantics via `data-teml`:

| `data-teml` | Allowed `data-*` attrs | Native HTML equivalent |
| --- | --- | --- |
| `grid` | `id`, `columns`, `gap` | — (layout bridge) |
| `details` | `id`, `summary`, `open` | `<details><summary>` |
| `figure` | `id`, `caption` | `<figure><figcaption>` |
| `scroll` | `id`, `rows` | — (bounded region bridge) |
| `metric` | `id`, `label`, `value`, `role`, `change` | — (text content → `value` when omitted) |
| `progress` | `id`, `label`, `value`, `max`, `role` | `<progress>`, `<meter>` |
| `event` | `time`, `title`, `detail`, `role` | — (text content → `title` when omitted) |

Rules:

1. `data-teml` takes precedence over CSS profile container rules on the same element.
2. Only registry allowlisted `data-*` keys are copied; event handlers (`onclick`, …) and unknown keys are dropped.
3. Unknown `data-teml` values flatten to child content with an `unknown-directive` warning.
4. Native `<details>`, `<figure>`, `<progress>`, `<meter>`, `<textarea>`,
   `<input type="radio">`, `<mark>`, `<del>`, `<s>`, `<strike>`, and `<kbd>`
   map to the same AST nodes without requiring `data-teml`. Radios group by
   `name`; `<select>` is not silently converted into a vertical radio group.

## Interactivity

Buttons, inputs, checkboxes, textareas, radio groups, and scroll regions are
ordinary declarative directives.
Their behavior is determined by an explicit mode boundary:

| Mode | Command | Widgets | Links | Host events |
| --- | --- | --- | --- | --- |
| Static | `view`, `convert`, `render` | Static | Rendered link/URL fallback | None |
| Reader | `read` | Visible but inert | Confined in-viewer navigation; confirmed external open | None |
| App | `run` | Focus, typing, toggling, clicking | Host-defined app behavior | NDJSON |

Each interactive widget needs a stable, unique `id` to participate in app-mode
keyboard navigation. Display widgets (`::progress`, `::metric`) and eligible
mutation containers (`card`, alerts, `grid`, `details`, `figure`, `scroll`)
share that same `id` namespace for host `update` and document-mutation commands
(see `docs/interactive-protocol.md`). An `id` is optional on non-focusable
containers, but required before `replace`, `append`, or `remove` can target one.
Duplicate ids across focusable, updatable, and mutation-addressable nodes keep
the first occurrence in document order; later nodes lose their id and become
inert for targeting.
Mutable attributes are allowlisted per directive — structural attrs are never
updated generically. `teml run` never emits raw ANSI itself — focus is
rendered via the theme's `focus` role plus a fixed-width textual marker
(`▸`/`>`), preserving the single-emitter rule.

A radio group is one tab stop; arrow keys move a pending marker and
Space/Enter confirms it. A textarea keeps a grapheme cursor across reflow and
uses Enter for newline and Ctrl+Enter to advance focus. By default, `rows` is
its fixed content height. With `autoGrow`, `rows` is the minimum and the height
follows wrapped content up to `maxRows` (100 by default); further content
scrolls internally. Native HTML textareas opt in with `data-auto-grow` and
`data-max-rows`. A scroll region contains static content only in this version;
nested controls are diagnosed and made inert.

## Speech backend

`teml convert --to speech` emits deterministic linear UTF-8 text from the
normalized semantic AST. It names heading levels and semantic roles, reads
links as labels plus targets, linearizes table rows, and identifies inert
widgets by type and label. It emits no ANSI and does not depend on color or
decoration glyphs. Live Reader focus announcements are outside v1.5.

## Highlight and strike

| Source | AST | Terminal |
| --- | --- | --- |
| `:highlight[term]` | `span` role `highlight` | Theme `highlight` role (often yellow fg or bg) |
| `~~text~~` / `<del>` / `<s>` / `<strike>` | `strike` inline | SGR 9 (`\x1b[9m`) when colors enabled |
| Frontmatter `roles.*.strike: true` | role style bit | Combined with role fg/bg |

Markdown export preserves GFM `~~…~~`; `:highlight[…]` degrades to plain children with `markdown-lossy-conversion`.
