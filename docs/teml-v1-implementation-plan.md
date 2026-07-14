# TeML v1 "Paper" — Step-by-Step Implementation Plan

**Audience:** the person building v1 (possibly with an AI pair). Every step says exactly what file to create, what goes in it, what test proves it works, and what "done" means. Follow the steps in order. Never start a step before the previous step's DONE checklist is fully green.

**Traceability:** step headers cite the PRD requirement IDs they satisfy (F/R/H/M/C/S series).

---

## Part 0 — Ground rules (read once, obey always)

1. **One step at a time.** Each step ends with a command you run and an output you can see. If the output is wrong, fix it before moving on.
2. **Tests first, always.** Every step tells you to write the test before the code. The test failing first, then passing, is your proof.
3. **The pipeline is law.** Every piece of code lives in exactly one stage: `frontend (parse/convert) → core (AST/sanitize/normalize) → layout → render`. If you can't say which stage a function belongs to, you're building the wrong function.
4. **Only `render/ansi.ts` may ever produce an ESC character (`\x1b`).** If any other file contains `\x1b`, that's a bug — there's a test for this (Step 2.6).
5. **stdout is sacred.** Rendered output goes to stdout. Everything else — warnings, debug, errors — goes to stderr. No exceptions, ever.
6. **Commit at every DONE checklist.** Commit message = the step number and name (e.g. `step 3.4: container directives`). If a step breaks something, you can always go back one commit.

**Time budget guide** (solo developer, honest estimates): Milestone 0 = half a day. M1 = 2 days. M2 = 4 days. M3 = 4 days. M4 = 3 days. M5 = 5 days. M6 = 3 days. M7 = 3 days. Total ≈ 5 weeks of focused work. Double it if part-time.

---

## Milestone 0 — Project skeleton (PRD: C-2 groundwork)

### Step 0.1 — Create the repository

```bash
mkdir teml && cd teml && git init
npm init -y
```

Edit `package.json`: set `"name": "teml"`, `"type": "module"`, `"bin": {"teml": "./dist/cli/main.js"}`, `"engines": {"node": ">=20"}`.

### Step 0.2 — Install the toolchain

```bash
npm i -D typescript vitest @types/node tsx
npx tsc --init
```

In `tsconfig.json` set: `"target": "ES2022"`, `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`, `"strict": true`, `"outDir": "dist"`, `"rootDir": "src"`, `"declaration": true`.

Add to `package.json` scripts:

```json
"build": "tsc",
"test": "vitest run",
"test:watch": "vitest",
"dev": "tsx src/cli/main.ts"
```

### Step 0.3 — Install the runtime dependencies (exact list, nothing more)

```bash
npm i unified remark-parse remark-gfm remark-frontmatter remark-directive \
      mdast-util-to-string yaml \
      parse5 @mozilla/readability linkedom \
      string-width commander
```

Why each: `unified`+`remark-*` = the CommonMark+directives parser (per design doc §6.1 — we do NOT write a Markdown parser); `yaml` = frontmatter; `parse5`/`linkedom`/`readability` = HTML pipeline; `string-width` = Unicode cell widths; `commander` = CLI.

### Step 0.4 — Create the directory tree (empty files are fine)

```text
src/
  core/       ast.ts  sanitize.ts  normalize.ts  diagnostics.ts  tokensView.ts
  teml/       parse.ts  serialize.ts  directives.ts
  markdown/   parse.ts  serialize.ts
  html/       parse.ts  extract.ts  map.ts  profiles/bootstrap.json
  layout/     measure.ts  wrap.ts  layout.ts  table.ts  kv.ts
  render/     styledLine.ts  ansi.ts  plain.ts
  terminal/   capabilities.ts  theme.ts  themes/dark.json light.json mono.json auto.json
  cli/        main.ts  commands/view.ts convert.ts inspect.ts render.ts
tests/        (mirrors src/)
fixtures/     teml/  markdown/  html/  adversarial/
snapshots/
examples/     demo.teml  demo.md  demo.html
```

### Step 0.5 — CI

Create `.github/workflows/ci.yml`: on push → `npm ci && npm run build && npm test` on Node 20 and 22, ubuntu + macos. 

**DONE 0 when:** `npm test` runs (0 tests, green), `npm run build` emits `dist/`, CI is green on a pushed commit.

---

## Milestone 1 — The core: AST, sanitizer, diagnostics, themes (PRD: S-1, S-3, R-3 groundwork)

### Step 1.1 — Define the AST (`src/core/ast.ts`)

Copy the types from design doc §8 verbatim: `TDoc`, `Meta`, `Block` (heading, paragraph, list, quote, codeBlock, thematicBreak, table, container, leaf), `Inline` (text, bold, italic, underline, code, link, span, break). Add two helpers:

```ts
export function doc(blocks: Block[], meta: Meta = {}): TDoc
export function text(value: string): Inline   // note: does NOT sanitize; sanitize happens at ingestion
```

No test needed — types compile or they don't. **DONE when** `npm run build` passes.

### Step 1.2 — Write the sanitizer TESTS first (`tests/core/sanitize.test.ts`)

Write these test cases before any implementation (S-1, S-3):

```text
sanitizeText:
  strips \x1b (ESC)                        "a\x1b[31mb" → "ab"
  strips other C0 except \n                "a\x07b\nc"  → "ab\nc"
  strips DEL and C1                        "a\x7fb\x9bc" → "abc"
  strips bidi controls U+202A..U+202E, U+2066..U+2069
  keeps ZWJ inside emoji sequence          "👩‍💻" unchanged
  strips lone zero-width chars             "a\u200bb" → "ab"
  expands \t to spaces when mode="code" keeps \t? NO: expands to 4 spaces, keeps \n
sanitizeHref:
  allows https://x, http://x, mailto:a@b, relative "docs/a.teml", "#anchor"
  rejects javascript:alert(1) → null
  rejects "ht\x1btps://x" (control char) → null
  rejects file:///etc/passwd unless allowFile=true
```

Run `npm test` — all red. Good.

### Step 1.3 — Implement the sanitizer (`src/core/sanitize.ts`)

```ts
export function sanitizeText(s: string, mode: "prose" | "code" = "prose"): string
export function sanitizeHref(href: string, opts?: { allowFile?: boolean }): string | null
```

Implementation notes: iterate code points (not UTF-16 units); the strip set is `[\x00-\x08\x0b-\x1f\x7f\u0080-\u009f\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069]`; preserve `\n` always; in prose mode also collapse `\t` to a single space; keep `\u200d` (ZWJ) only when both neighbors are Extended_Pictographic (use a small regex with the `\p{Extended_Pictographic}` property). For hrefs: reject if any code point < 0x20, then check scheme against the allowlist (`^[a-z][a-z0-9+.-]*:` extracts a scheme; no scheme = relative = allowed).

**DONE when** every 1.2 test is green.

### Step 1.4 — Diagnostics channel (`src/core/diagnostics.ts`)

```ts
export type Warning = { code: string; message: string; line?: number };
export class Diagnostics { warn(code: string, message: string, line?: number): void; all(): Warning[] }
```

Every later stage takes a `Diagnostics` instance; the CLI prints them to **stderr** at the end. Test: warnings accumulate and never touch stdout.

### Step 1.5 — Themes (`src/terminal/theme.ts` + the four JSON files) (R-3)

Define the theme JSON shape from design doc §10 (roles → `{fg?, bg?, bold?, italic?, underline?}` where colors are named ANSI colors or `#rrggbb`). Create `dark.json`, `light.json`, `mono.json` (attributes only, no colors), `auto.json` (colors legible on both backgrounds, no background fills outside `code`). Required roles: `heading1..4, success, warning, error, info, muted, border, link, code, codeBlock, quote, listMarker, kbd, cardTitle`.

```ts
export function loadTheme(name: string): Theme            // built-ins by name, else read file path
export function resolveRole(theme: Theme, role: string): Style   // unknown role → plain, with warning hook
```

Also define the **decoration sets** here (design conversation on glyphs): each of success/warning/error/info has `{ gutterUnicode, gutterAscii, labelUnicode, labelAscii }` — e.g. warning = `⚠ / ! / "⚠ warning" / "[WARN]"`. Only characters from the safe-glyph list (write the list as a constant: box-drawing set, `•◦▸▪✓✗⚠ℹ─│┌┐└┘├┤┬┴┼`, all verified width-1... except note `⚠` and `ℹ` measure via string-width, never assume).

Test: all four themes load; every required role resolves; mono theme resolves every role with no colors.

**DONE 1 when:** sanitize, diagnostics, and theme tests are green, and `grep -r $'\x1b' src/` returns nothing.

---

## Milestone 2 — Layout + ANSI renderer: a hardcoded document renders beautifully (PRD: R-1..R-8 partial)

*Strategy: build the back half of the pipeline first, against a hand-written AST. You'll see real output on day 3, which keeps morale up and catches design errors early.*

### Step 2.1 — Width measurement (`src/layout/measure.ts`) (R-5)

```ts
export function cellWidth(s: string, opts?: { ambiguousWide?: boolean }): number
export function truncateToWidth(s: string, max: number, ellipsis?: string): string
```

Wrap `string-width` but: segment with `Intl.Segmenter("en", {granularity:"grapheme"})` first so truncation never splits a grapheme. Tests: `"abc"`=3, `"你好"`=4, `"café"`=4 (combining é), `"🙂"`=2, truncate `"你好世界"` to 5 → `"你好…"` (width 5, never 4.5 — if the wide char doesn't fit, stop before it).

### Step 2.2 — Styled lines (`src/render/styledLine.ts`)

The unit of static rendering (design doc §9.1):

```ts
export type Span = { text: string; style: Style };      // text is ALREADY sanitized — trust the core
export type Line = Span[];
export function lineWidth(line: Line): number
export function padLine(line: Line, width: number, style?: Style): Line
```

### Step 2.3 — Word wrap (`src/layout/wrap.ts`) (R-6)

```ts
export function wrapSpans(spans: Span[], width: number): Line[]
```

Algorithm in plain words: walk spans; split into words on spaces; place words on the current line while `lineWidth + 1 + wordWidth ≤ width`; a word wider than `width` is hard-broken at cell boundaries (grapheme-safe, using 2.1); styles travel with their characters across breaks. Tests: plain wrap at width 20; a bold word crossing a line break stays bold on both lines; a 50-char URL at width 20 breaks into 3 lines; CJK text wraps at correct cell counts; width 1 doesn't infinite-loop.

### Step 2.4 — The block layout engine (`src/layout/layout.ts`) (R-1, R-2)

The heart of the milestone:

```ts
export type LayoutOpts = { width: number; theme: Theme; caps: Capabilities; diags: Diagnostics };
export function layoutDocument(doc: TDoc, opts: LayoutOpts): Line[]
export function layoutBlock(b: Block, opts: LayoutOpts, indent: number): Line[]
```

Implement block by block, IN THIS ORDER, one commit each, with a snapshot test each (see 2.7 for the harness):

1. **paragraph** — flatten Inline tree to spans (a recursive `inlineToSpans(node, inheritedStyle)`; span roles resolve via theme; links get link style + href retained on the span for OSC 8), then `wrapSpans`.
2. **heading** — level 1: text upper-cased, heading1 style, followed by a full-width `═` rule line (border style); levels 2–4: styled text, level 2 gets a `─` rule; one blank line before, one after.
3. **thematicBreak** — one `─`×width line, border style.
4. **list** — marker `•` (or `N.`) in listMarker style, 2-cell indent per level; wrap item content to `width - indent`; nested lists recurse with indent+2.
5. **quote** — `▎ ` gutter in muted style, children laid out at `width - 2`, gutter prefixed to every resulting line.
6. **codeBlock** — no wrapping (R-6 policy): each source line truncated to width with `…` + a diagnostic if too long; codeBlock style; 1-cell padding line above/below; language label right-aligned in muted style on the top padding line.
7. **container: card** — recurse children at `width - 4`; draw `┌─ Title ───┐`, `│ … │` sides, `└───┘` (border style; title in cardTitle style); ASCII variants `+- Title ---+` when `caps.unicode=false`.
8. **container: info/success/warning/error/note** — gutter form: `▎⚠ warning` label line (role style) then children at width-2 with `▎ ` gutter in role color; ASCII gutter `|`.
9. **leaf: kv** — measure widest key; render `key␣␣value` rows, keys in muted style, aligned (design doc §6.5).
10. **leaf: image** — one line: `[Image: {alt}]` in muted style (H-1 pairing).
11. **leaf: break** — one blank line.

Blank-line policy: exactly one blank line between top-level blocks; layout inserts them, blocks never do (prevents double-blank bugs).

### Step 2.5 — Capabilities (`src/terminal/capabilities.ts`) (R-4)

```ts
export function detectCapabilities(env = process.env, isTTY = process.stdout.isTTY): Capabilities
```

Rules, in order: `NO_COLOR` set → colors "none". Not a TTY → colors "none", width 80 (unless overridden). `COLORTERM=truecolor` → truecolor; `TERM` contains `256color` → ansi256; else ansi16. `unicode` = true unless `LC_ALL/LANG` lacks UTF-8. Width: flag > `process.stdout.columns` > `$COLUMNS` > 80. Ten small tests, one per rule.

### Step 2.6 — ANSI backend (`src/render/ansi.ts`) + plain backend (R-7, R-8, S-2)

```ts
export function renderAnsi(lines: Line[], caps: Capabilities): string
export function renderPlain(lines: Line[]): string        // src/render/plain.ts
```

ANSI: emit SGR per span (compute minimal transitions — if style unchanged from previous span, emit nothing), reset (`\x1b[0m`) at each line end, map colors down by capability (truecolor hex → nearest 256 → nearest 16; write the two small mapping functions with tests). Links: if `caps.hyperlinks`, wrap in OSC 8 (`\x1b]8;;URL\x1b\\text\x1b]8;;\x1b\\`) — URL already sanitized upstream, but assert no control chars here anyway (defense in depth).

**The invariant test (write it now, keep it forever):** `tests/security/single-emitter.test.ts` — for every fixture in `fixtures/adversarial/`, run the full pipeline with the *plain* backend and assert output contains no byte < 0x20 except `\n`; run with ANSI backend and assert every ESC in output is immediately followed by `[` or `]8` (i.e., ours).

### Step 2.7 — Snapshot harness + first real output

```ts
// tests/snapshot.ts helper:
export function snapshotRender(source: TDoc | string, width: number, mode: "plain"|"ansi"): string
```

Vitest `toMatchFileSnapshot("snapshots/{name}.{width}.txt")`. Then create `examples/hardcoded.ts` that builds (in code) the demo document from design doc §19 — heading, paragraph with bold/code/link/status span, card with list, warning, code block, kv — and a script:

```bash
npm run dev:demo   # tsx examples/hardcoded.ts → renders to your actual terminal
```

**Look at it.** Adjust theme colors and spacing until it's genuinely beautiful. This step is aesthetic QA — budget half a day for pure fiddling; it's the product.

**DONE 2 when:** the hardcoded demo renders correctly at widths 40/80/120 in dark/mono/ascii/no-color (12 snapshots green), the single-emitter test is green, and the demo looks good enough that you'd screenshot it.

---

## Milestone 3 — The TeML frontend: parse real `.teml` files (PRD: F-1..F-3, C-1 partial)

*Strategy per design doc §6.1: we assemble a parser from remark, we don't write one. "The TeML parser" is really an mdast→TDoc transform.*

### Step 3.1 — Fixture corpus first

Create these files in `fixtures/teml/` before writing any parser code (each with the `.teml` source; expected outputs get added as you go):

```text
01-headings.teml       # levels 1-6 (5,6 should clamp to 4 with warning)
02-inline.teml         # bold, italic, underline via u? (no — CommonMark has no underline; skip), code, links
03-lists.teml          # ul, ol with start=3, nesting 3 deep
04-quote-hr-code.teml  # blockquote, ---, fenced code with language
05-containers.teml     # :::card{title="X"} with nested :::warning (4-colon outer)
06-inline-spans.teml   # :success[ok] :status[hi]{role=info} :kbd[Ctrl+C], escaped \:notaspan
07-leafs.teml          # ::kv{A="1" B="2"}, ::image{src alt}, ::break
08-frontmatter.teml    # title, theme, base, roles map, plus a nested-yaml key (should warn+ignore)
09-tables.teml         # GFM table with alignment row
10-kitchen-sink.teml   # everything above in one document (design doc §6.2 expanded)
```

### Step 3.2 — Assemble the remark pipeline (`src/teml/parse.ts`, part 1)

```ts
import {unified} from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import remarkDirective from "remark-directive";

export function parseToMdast(source: string): MdastRoot
```

Test: parse fixture 10; `console.dir(tree, {depth:null})`; eyeball that directives appear as `containerDirective`/`leafDirective`/`textDirective` nodes and the frontmatter as a `yaml` node. This step is exploratory — write one smoke test (`parses without throwing, root has children`).

### Step 3.3 — Frontmatter (`src/teml/parse.ts`, part 2) (F-1)

```ts
function extractMeta(tree: MdastRoot, diags: Diagnostics): Meta
```

Find the `yaml` node, parse with the `yaml` package, accept only flat string/number/boolean values for known keys (`title, theme, lang, base`) plus a `roles` map of flat style objects (F-4); warn `frontmatter-ignored-key` for anything else; remove the node from the tree. Tests: fixture 08 produces the right Meta + exactly one warning.

### Step 3.4 — The mdast→TDoc transform (`src/teml/parse.ts`, part 3)

The big one. One function, one big switch:

```ts
function mdToBlock(node: MdastContent, diags: Diagnostics): Block | Block[] | null
function mdToInline(node: MdastPhrasing, diags: Diagnostics): Inline | Inline[] | null
export function parseTeml(source: string, diags: Diagnostics): TDoc
```

Mapping table (implement top to bottom, one commit + fixture-test each):

```text
mdast heading      → heading (level >4: clamp, warn "heading-clamped")
mdast paragraph    → paragraph
mdast text         → text (⟵ sanitizeText HERE — this is the ingestion point, S-1)
mdast strong/emphasis → bold/italic
mdast inlineCode   → code inline (sanitize with mode "code")
mdast link         → link (sanitizeHref; null href → unwrap to children + warn "link-dropped")
mdast list/listItem → list {ordered, start, items} (each item = Block[])
mdast blockquote   → quote
mdast code         → codeBlock {language} (sanitize mode "code")
mdast thematicBreak → thematicBreak
mdast table        → table {align, rows} (cells = Inline[])
containerDirective → container {name, attrs} — validate name against directives.ts registry;
                     unknown → keep as container, warn "unknown-directive" (F-3)
leafDirective      → leaf {name, attrs}
textDirective      → span: name in {success,warning,error,info,muted,kbd} → span{role:name};
                     name "status" → span{role: attrs.role ?? "info"};
                     unknown → unwrap children, warn (F-3)
html node          → DROP + warn "raw-html-ignored" (the restricted-profile rule, F-1)
anything else      → warn "unsupported-node" + null (never throw)
```

`src/teml/directives.ts` exports the v1 registry (F-2) as data: `{containers: {card:{attrs:["title"]}, info:{}, ...}, leafs: {...}, inline: {...}}`.

Attribute values are sanitized too (they render — card titles, kv values).

### Step 3.5 — Normalizer (`src/core/normalize.ts`)

```ts
export function normalize(doc: TDoc, diags: Diagnostics): TDoc
```

Passes, in order (each ~10 lines, each with a before/after unit test): merge adjacent text inlines; drop paragraphs whose text content is whitespace-only; trim leading/trailing whitespace of first/last inline in each block; hoist a leading heading(2|3) inside a `card` with no `title` attr into `title`; unwrap single-child containers named in no registry that contain only one block (wrapper flattening — mostly for HTML later, but write it now).

### Step 3.6 — Wire the first CLI command (`src/cli/main.ts` + `commands/view.ts`) (C-1, C-2)

Commander program: default command = view. Flow: read file or stdin → `parseTeml` → `normalize` → `detectCapabilities` (+ flag overrides `--width --theme --no-color --color --ascii --ambiguous-wide`) → `layoutDocument` → `renderAnsi`|`renderPlain` → stdout. Diagnostics → stderr, formatted `teml: warning: {message} (line {n})`. Exit 0; parse failure exit 1; bad flags exit 2 (commander default).

**The payoff command:**

```bash
npm run dev -- examples/demo.teml        # examples/demo.teml = fixture 10 kitchen sink
npm run dev -- examples/demo.teml --ascii --no-color
cat examples/demo.teml | npm run dev
npm run dev -- examples/demo.teml | cat   # must auto-drop color (non-TTY rule)
```

### Step 3.7 — Snapshot + inspect

Add `teml render FILE --width N` (plain backend → stdout, deterministic; C-1) and `teml inspect FILE --ast` (JSON.stringify the TDoc, 2-space) / `--tokens` (`src/core/tokensView.ts`: depth-first walk emitting `heading_start level=1` lines — design doc §8). Snapshot all ten fixtures at widths 40/80 in plain mode.

**DONE 3 when:** all ten fixtures parse, normalize, and snapshot green; `teml examples/demo.teml` in your real terminal shows the kitchen sink correctly; adversarial fixtures (create now: ESC in a paragraph, ESC in a code fence, ESC in a card title attr, `javascript:` link, bidi controls in link text) all render inert with warnings.

---

## Milestone 4 — Serializer, Markdown interoperability + round-trip (PRD: F-1, M-1..M-4; prerequisite for `convert`)

### Step 4.1 — Serializer (`src/teml/serialize.ts`)

```ts
export function serializeTeml(doc: TDoc): string
```

Inverse of the 3.4 table: heading → `#`×level; bold → `**…**`; span → `:role[…]` (or `:status[…]{role=x}` for non-shorthand roles); container → `:::name{attrs}` with colon count = 3 + max child directive depth (compute by a pre-pass); leafs → `::name{attrs}`; attrs → `key="escaped value"`; frontmatter from Meta when non-empty; escape `*_` `` ` `` `[]:{}` in text where they'd be misparsed (write `escapeTemlText` with its own table-driven test).

### Step 4.2 — Round-trip property test

```ts
for fixture of fixtures/teml/*:
  ast1 = normalize(parse(fixture))
  ast2 = normalize(parse(serialize(ast1)))
  expect(ast2).toEqual(ast1)        // AST-stable, not byte-stable (PRD §7.5)
```

Then a mini-fuzzer: 200 iterations of randomly generated small ASTs (random nesting of the block/inline constructors, random text including `*[]:` characters) → serialize → parse → compare. This will find your escaping bugs — budget roughly two days for Steps 4.1–4.2, mostly here, plus one day for Markdown interoperability.

### Step 4.3 — Markdown→TeML and TeML→Markdown (`src/markdown/parse.ts`, `src/markdown/serialize.ts`) (M-1..M-4)

Create ten Markdown fixtures first in `fixtures/markdown/`: headings/inlines, ordered and nested lists, quote/hr/code, GFM tables, links/images, escaping, Unicode, long prose, hostile links/control characters, and a kitchen sink.

`parseMarkdown(source, diags)` assembles the CommonMark + GFM remark pipeline without TeML directive/frontmatter interpretation, then reuses the mdast→TDoc mapper from Step 3.4. Markdown→TeML is therefore `parseMarkdown → normalize → serializeTeml`.

Implement `serializeMarkdown(doc, diags)` with a table-driven mapping:

```text
standard Markdown blocks/inlines → their canonical CommonMark/GFM syntax
alert/note container             → blockquote beginning with **TYPE:**
card container                   → heading from title, followed by its body
kv leaf                          → two-column GFM table
image leaf                       → ![alt](safe-src), else [Image: alt]
break leaf                       → thematic break
kbd span                         → inline code
status/custom-role span          → readable plain child content
unknown/lossy construct          → preserve readable children + warn "markdown-lossy-conversion"
```

Unsafe hrefs are rechecked before serialization. Markdown output must be deterministic and contain no control/escape bytes. Test both directions: Markdown→TeML→Markdown is semantically stable for the supported CommonMark/GFM subset; TeML→Markdown→TeML is content-stable after applying the documented degradation mapping, not style- or AST-identical.

**DONE 4 when:** native TeML round-trip is green on all TeML fixtures + 200 random ASTs; all ten Markdown fixtures satisfy M-4; every lossy TeML-only mapping has an explicit diagnostic test.

---

## Milestone 5 — HTML frontend (PRD: H-1..H-4, C-1 `convert`)

### Step 5.1 — HTML fixtures first

`fixtures/html/`: `01-elements.html` (every H-1 element), `02-messy.html` (nested divs, inline styles, script/style tags, hidden elements, comments), `03-bootstrap.html` (cards, alerts, badges — the design doc §7 example expanded), `04-realpage.html` (save an actual documentation page's HTML), `05-table-spans.html` (colspan/rowspan), `06-hostile.html` (ESC in text nodes, `javascript:` hrefs, `onclick` attrs, ESC inside attribute values).

### Step 5.2 — Parse + extract (`src/html/parse.ts`, `src/html/extract.ts`) (H-2)

```ts
export function parseHtml(source: string): Document          // linkedom DOM from parse5-compatible parse
export function extractContent(dom: Document, diags: Diagnostics): Element
```

Extraction: run `@mozilla/readability` on a document clone; if it yields an article body use it; if it fails (fragment input, no obvious article) fall back to `<body>` or the root element, warn `readability-fallback`. Also here: delete `script, style, noscript, template, [hidden], [aria-hidden=true]` and elements with inline `display:none` (the only CSS we read — H-1).

### Step 5.3 — Element mapping (`src/html/map.ts`) (H-1)

```ts
export function htmlToDoc(root: Element, opts: {profile?: Profile}, diags: Diagnostics): TDoc
```

One big element-switch mirroring 3.4's shape; implement in this order with a fixture-01 sub-test each: text nodes (→ `sanitizeText`, collapse HTML whitespace runs to single spaces), h1–h6 (clamp), p, strong/b, em/i, u→underline, code, pre>code→codeBlock (language from `class="language-*"`), a (sanitizeHref), ul/ol/li, blockquote, hr, img→`leaf image` (alt sanitized), dl/dt/dd→`leaf kv`, table (build rows; colspan/rowspan → duplicate/empty cells + warn `table-span-flattened`), `<title>`→meta.title. Unknown block wrappers (div/section/article/main): recurse into children (flattening). Unknown inline (span with no profile match): unwrap. `on*` attributes: never read (they're inert since we execute nothing, but never copy them anywhere either).

### Step 5.4 — Profiles (`src/html/profiles/bootstrap.json` + loader) (H-4)

Profile shape (data, not code — PRD principle 6):

```json
{ "name": "bootstrap",
  "containers": [
    { "match": {"class": "card"}, "directive": "card", "titleFrom": "h1,h2,h3,.card-title" },
    { "match": {"class": "alert-warning"}, "directive": "warning" },
    { "match": {"class": "alert-danger"},  "directive": "error" },
    { "match": {"class": "alert-success"}, "directive": "success" },
    { "match": {"class": "alert-info"},    "directive": "info" } ],
  "spans": [
    { "match": {"class": "text-success"}, "role": "success" },
    { "match": {"class": "text-danger"},  "role": "error" },
    { "match": {"class": "text-warning"}, "role": "warning" },
    { "match": {"class": "badge"},        "role": "info" } ] }
```

The mapper checks profile rules *before* the flattening default. `--profile bootstrap|./path.json`.

### Step 5.5 — Convert command (`commands/convert.ts`) (H-3, M-1, M-2, C-1)

`teml convert FILE|- [--from teml|markdown|html] [--profile X] [--to teml|markdown|json]` selects the appropriate frontend, normalizes to TDoc, then selects `serializeTeml`, `serializeMarkdown`, or JSON output. `teml view page.html` / `teml view README.md` use the same frontend pipelines minus serialization, straight to layout. Format inference: `.teml`, `.md`/`.markdown`, or HTML extension; otherwise sniff (`<!doctype`/`<html` → html, default → teml).

**The payoff commands:**

```bash
teml convert fixtures/html/03-bootstrap.html --profile bootstrap
teml convert README.md --from markdown --to teml
teml convert examples/demo.teml --to markdown
curl -sL https://example.com | teml view --from html
teml view fixtures/html/04-realpage.html
```

**DONE 5 when:** fixtures 01–05 have green AST + TeML-output snapshots; 06-hostile renders inert (extend the single-emitter test to HTML fixtures); the real page (04) is *readable* — subjective, but you'll know; HTML-converted output round-trips through Milestone 4; Markdown and TeML conversion commands match the Step 4.3 API tests.

---

## Milestone 6 — Layout completeness: tables, overflow, width hell (PRD: R-5, R-6 completion)

### Step 6.1 — Table layout (`src/layout/table.ts`)

Implement the design doc §9.1 algorithm exactly, as pure functions you can unit-test without rendering:

```ts
export function columnWidths(minW: number[], maxW: number[], available: number): number[]
export function layoutTable(t: TableBlock, opts: LayoutOpts): Line[]
```

`columnWidths` rules in plain words: if Σmax ≤ available → max for everyone. Else give everyone min, distribute the remainder proportionally to (max−min). If Σmin > available → shrink the widest columns down to a floor of 5 cells each, in width order, until it fits or every column is at floor; whatever still doesn't fit wraps inside cells; truncation with `…` only below floor. Ten unit tests on `columnWidths` alone (2 cols fits, 3 cols proportional, CJK cells, one huge column, more columns than width). Then `layoutTable`: header row bold, `┌┬┐├┼┤└┴┘─│` borders (ASCII `+|-`), cell content wrapped to its column width (multi-line rows: pad shorter cells), alignment from GFM (left/center/right padding).

### Step 6.2 — Overflow policy audit (R-6)

Go back over every block type with three torture fixtures: `width-20.teml` (kitchen sink at width 20), `long-url.teml`, `cjk-emoji.teml` (CJK paragraphs, emoji in text, combining marks — inside cards and tables). Fix what breaks. Add `--wrap-code`. Verify the documented behavior: borders never exceed viewport; nothing ever renders at width < 1.

### Step 6.3 — Width-sweep snapshots (PRD §7.5)

Snapshot the whole fixture corpus at 20/40/80/120 × plain mode + the kitchen sink additionally in ansi mode at 80 (byte-exact ANSI snapshot pins the SGR minimization). This is your regression wall for the rest of the project's life.

**DONE 6 when:** the sweep is green and `teml examples/demo.teml --width 20` looks *deliberate*, not broken.

---

## Milestone 7 — CLI polish, packaging, docs, release (PRD: C-1..C-3, §7.3 docs)

### Step 7.1 — Flag completeness pass

Verify against the PRD C-series, M-series, and design doc §13 flag list; add the stragglers: `--from teml|markdown|html`, `--to teml|markdown|text|json`, `--base`, `--show-urls`, `--allow-file-links`, `--debug` (timing per stage to stderr), `--tokens/--ast/--render-tokens` on inspect. Ensure `teml --help` output is accurate (and, cutely, consider rendering help *via TeML itself* — dogfooding; optional).

### Step 7.2 — Behavior conformance tests (the Unix-citizen suite) (C-2, R-4)

Script-level tests (spawn the built CLI as a subprocess):

```text
teml f.teml > out.txt         → out.txt has zero ESC bytes
NO_COLOR=1 teml f.teml        → zero ESC bytes even on a TTY (use a pty helper or assert via env in caps tests)
teml f.teml 2>warnings.txt    → warnings never appear in stdout capture
teml missing.teml             → exit 1, message on stderr, empty stdout
echo bad | teml --from html   → renders something reasonable, exit 0
teml render f.teml --width 80 run twice → byte-identical (determinism)
```

### Step 7.3 — Performance gate (PRD §7.3)

Generate a 1,000-block document programmatically; add a CI-run benchmark asserting parse+layout+render < 100 ms and CLI cold start < 50 ms (measure `node dist/cli/main.js --version`). If startup misses: lazy-import the HTML stack (parse5/linkedom/readability are the heavy deps and only `convert`/`--from html` needs them) — this one change usually wins it.

### Step 7.4 — Documentation (PRD "docs as product")

Four documents, in `docs/`: `spec.md` (the format spec — largely extracted from the design doc §6, now normative, with the fixture corpus referenced as conformance examples), `cli.md` (reference), `theming.md`, `tutorial.md` ("convert your first page in 5 minutes" — literally test it on a person with a timer, PRD §7.5). README with an animated demo (record with `vhs` or asciinema) — the README screenshot is your #1 adoption asset; spend real time on it.

### Step 7.5 — Package and release

`npm pack` sanity check (dist + themes + profiles included, fixtures excluded); `npx teml` works from the tarball on a clean machine; tag `v1.0.0`; publish; single-binary builds via `node --experimental-sea` or `bun build --compile` as a stretch (PRD portability says "single-binary or single-npx" — npx satisfies v1).

**DONE 7 = DONE v1 when:** every PRD §7.5 acceptance criterion checks off:

```text
[ ] ≥30 teml + ≥20 html + ≥10 markdown fixtures green at 4 widths × 4 modes
[ ] all adversarial fixtures inert (single-emitter suite green, teml+html)
[ ] curl | teml view readable on 3 real docs sites
[ ] round-trip AST-stable (fixtures + fuzz)
[ ] Markdown↔TeML conversions satisfy M-4 and emit documented lossy warnings
[ ] 5-minute tutorial passes a live human test
[ ] perf gates green in CI
[ ] published; npx teml examples/demo.teml works on a machine that isn't yours
```

---

## Appendix A — Order-of-work rationale (why not build the parser first?)

Renderer-first (M2 before M3) means every parser feature lands with visible output, the aesthetic risk (the product IS how it looks) is retired in week one, and the AST design gets pressure-tested by its hardest consumer (layout) before two frontends depend on it. This inverts the naive parse→layout→render build order on purpose.

## Appendix B — The "stuck" table

```text
Symptom                                  Almost always
Borders misaligned with CJK/emoji     →  something used .length instead of cellWidth (grep for ".length" in layout/)
Colors bleed across lines             →  missing reset at line end in ansi.ts
Double blank lines between blocks     →  a block emitting its own trailing blank (policy: only layoutDocument inserts)
Directive parses as paragraph text    →  colon-count mismatch or remark-directive not in the pipeline
Round-trip fails on weird text        →  escapeTemlText missing a character; add fuzz case to the table test
Snapshot diff only in CI              →  locale/width detection leaking in; render command must ignore env except flags
ESC bytes in output test failing      →  someone sanitized at render instead of ingestion; move it to the frontend
```

## Appendix C — Definition of "beautiful" (the M2/M6 aesthetic bar)

Side-by-side against `glow` on the same content: TeML must be at least as readable, and visibly richer wherever directives appear (cards, alerts, kv, status glyphs). Spacing: never two consecutive blank lines; never zero blank lines between blocks. Color: muted chrome (borders, markers), saturated only for roles. If a screenshot of the kitchen sink doesn't make a stranger ask "what tool is that?", keep fiddling — that reaction is v1's growth loop.
