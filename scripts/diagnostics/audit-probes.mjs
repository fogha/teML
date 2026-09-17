// Manual correctness probes tracked in docs/maintenance.md. Requires pnpm run build.
// These assert desired behavior and intentionally fail until the findings are fixed.
// Uses captured streams; no real terminal modes, network calls, or application files.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { PassThrough } from "node:stream";
import { setImmediate as tick } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Diagnostics, normalize } from "../../dist/core/index.js";
import { parseTeml } from "../../dist/teml/parse.js";
import { InteractiveSession } from "../../dist/interactive/session.js";
import { bindings, runInteractiveApp } from "../../dist/interactive/host.js";
import { runInteractive } from "../../dist/cli/commands/run.js";
import { layoutDocumentDetailed } from "../../dist/layout/regions.js";
import { ReaderSession, resolveReaderTarget } from "../../dist/reader/session.js";
import { diffFrames } from "../../dist/render/screen.js";
import { encodeScreenOps } from "../../dist/render/ansi.js";
import { loadTheme } from "../../dist/terminal/theme.js";

const caps = {
  width: 80,
  colors: "none",
  unicode: true,
  hyperlinks: false,
  ambiguousWide: false,
};
const options = () => ({
  diags: new Diagnostics(),
  layout: { width: 80, height: 8, caps: { ...caps }, theme: loadTheme("mono") },
});
const document = (markup) => normalize(parseTeml(markup));
const session = (markup) => new InteractiveSession(document(markup), options());
const detailed = (doc, width = 80) =>
  layoutDocumentDetailed(doc, { ...options().layout, width, diags: new Diagnostics() });
const reader = (layout, extra = {}) =>
  new ReaderSession({
    rootPath: "/docs",
    currentPath: "/docs/index.md",
    detailed: layout,
    viewport: { cols: 80, rows: 6, statusRows: 1 },
    caps,
    ...extra,
  });
function streams() {
  const input = new PassThrough();
  const output = new PassThrough();
  let captured = "";
  output.on("data", (chunk) => (captured += chunk.toString()));
  return { input, output, captured: () => captured };
}
const results = [];
async function probe(id, description, body) {
  try {
    await body();
    results.push({ id, description, status: "PASS" });
  } catch (error) {
    results.push({ id, description, status: "FAIL", detail: error.message });
  }
}

await probe("C01a", "Reader filename labels must not inject terminal controls", () => {
  const marker = "\x1b[31mfilename.md";
  const app = reader({ lines: [], links: [], headings: [] }, { title: marker });
  const frame = app.start()[0].frame;
  const output = encodeScreenOps(diffFrames(null, frame), caps);
  assert.equal(output.includes(marker), false, "raw filename ESC sequence survived rendering");
});

await probe("C01b", "Rejected HTML links must not inject controls through stderr", () => {
  const cli = fileURLToPath(new URL("../../dist/cli/main.js", import.meta.url));
  const result = spawnSync(process.execPath, [cli, "view", "--from", "html", "--no-color"], {
    input: '<img src="\x1b[31mbad" alt="image">',
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr.includes("\x1b"), false, "rejected src leaked ESC into diagnostics");
});

await probe("C02", "Callback failure must clean up and reject the app promise", async () => {
  const io = streams();
  const rawCalls = [];
  io.input.setRawMode = (raw) => rawCalls.push(raw);
  let completion = "pending";
  const done = runInteractiveApp('<button id="ok">OK</button>', {
    ...io,
    handlers: {
      onClick() {
        throw new Error("probe callback failure");
      },
    },
  });
  done.then(
    () => (completion = "resolved"),
    () => (completion = "rejected"),
  );
  let escaped = false;
  try {
    io.input.emit("data", "\r");
  } catch {
    escaped = true;
  }
  await tick();
  const observed = { completion, escaped, rawRestored: rawCalls.at(-1) === false };
  // Release this probe's listeners even when production cleanup failed.
  io.input.emit("end");
  await done.catch(() => {});
  assert.deepEqual(observed, { completion: "rejected", escaped: false, rawRestored: true });
});

// `error` completes the command it answers (see docs/interactive-protocol.md),
// so the engine will not frame a rejected line. What the engine must guarantee
// is that rejecting one command does not consume the next command's response;
// the host read loops that must stop waiting are covered by each host suite.
await probe("C03", "A rejected command must not consume the next command's response", async () => {
  const io = streams();
  const running = runInteractive(document('::input{id="name"}'), options(), io.input, io.output);
  await tick();
  io.input.write("not json\n");
  await tick();
  io.input.write(JSON.stringify({ type: "char", char: "x" }) + "\n");
  await tick();
  await tick();
  const events = io
    .captured()
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  io.input.end();
  await running;
  assert.deepEqual(
    events.map((event) => event.type),
    ["frame", "error", "change", "frame"],
  );
});

// Decided: a re-render is a fresh document, so a value that survives is
// re-marked untouched and the next keystroke replaces it ("Select on focus" in
// docs/interactive-protocol.md). This is the accepted contract, not a defect;
// the same-ID and kind-change cases are pinned in tests/interactive/session.test.ts.
await probe(
  "C04",
  "Rerender re-selects a surviving field so the next keystroke replaces it",
  () => {
    const app = session('::input{id="name"}');
    app.start();
    app.handle({ type: "char", char: "Ada" });
    app.handle({ type: "render", markup: '::input{id="name"}\n\nValidation message' });
    app.handle({ type: "char", char: "!" });
    assert.equal(app.values().name, "!");
  },
);

await probe("C05", "Bindings must not repaint after application completion", async () => {
  const io = streams();
  const state = bindings();
  const done = runInteractiveApp(
    '::metric{id="cpu" value="0%"}\n::button{id="quit" label="Quit"}',
    {
      ...io,
      format: "teml",
      state,
      handlers: {
        onClick(_id, _values, ctx) {
          ctx.exit();
        },
      },
    },
  );
  io.input.emit("data", "\r");
  await done;
  const before = io.captured();
  state.cpu = "99%";
  assert.equal(io.captured().slice(before.length), "", "completed host repainted");
});

await probe("C06", "Every allowed widget ID must survive a value snapshot", () => {
  const app = session('::input{id="__proto__" value="visible"}');
  const snapshot = JSON.parse(JSON.stringify(app.values()));
  assert.equal(Object.hasOwn(snapshot, "__proto__"), true);
  assert.equal(snapshot.__proto__, "visible");
});

await probe("C07", "Normalization must not mutate the source document", () => {
  const source = {
    meta: {},
    blocks: [
      {
        type: "paragraph",
        children: [
          { type: "text", value: "a" },
          { type: "text", value: "b" },
        ],
      },
    ],
  };
  const original = globalThis.structuredClone(source);
  normalize(source);
  assert.deepEqual(source, original);
});

await probe("C08", "Resizing must rebuild search row coordinates", () => {
  const doc = document("word ".repeat(45) + "NEEDLE " + "tail ".repeat(45));
  const app = reader(detailed(doc, 80));
  app.handle({ type: "char", char: "/" });
  app.handle({ type: "char", char: "NEEDLE" });
  app.handle({ type: "key", key: "enter" });
  const nextLayout = detailed(doc, 20);
  app.replaceLayout(nextLayout, { cols: 20, rows: 6, statusRows: 1 });
  const expected = nextLayout.lines.flatMap((line, row) =>
    line
      .map((span) => span.text)
      .join("")
      .includes("NEEDLE")
      ? [row]
      : [],
  );
  assert.deepEqual(app.state().search.rows, expected);
});

await probe("C09", "The selected TOC entry must remain visible", () => {
  const doc = document(
    Array.from({ length: 12 }, (_, index) => `### Section ${index + 1}\n\nBody`).join("\n\n"),
  );
  const app = reader(detailed(doc));
  app.handle({ type: "char", char: "t" });
  let effects;
  for (let i = 0; i < 8; i++) effects = app.handle({ type: "key", key: "down" });
  const frame = effects.find((effect) => effect.type === "frame").frame;
  const visible = frame.lines.map((line) => line.map((span) => span.text).join("")).join("\n");
  assert.equal(visible.includes("Section 9"), true, "selected ninth heading is clipped offscreen");
});

await probe("C10", "Malformed file URLs must be rejected without throwing", () => {
  const target = resolveReaderTarget("file:///docs/bad%2Fname.md", "/docs/index.md", "/docs", true);
  assert.equal(target.kind, "rejected");
});

await probe("A03", "Session-owned documents must be isolated from each other", () => {
  const shared = document('::input{id="name"}');
  const first = new InteractiveSession(shared, options());
  const second = new InteractiveSession(shared, options());
  first.start();
  second.start();
  first.handle({ type: "char", char: "changed" });
  assert.equal(second.values().name, "");
});

for (const result of results) console.log(JSON.stringify(result));
console.log(
  JSON.stringify({
    passed: results.filter((r) => r.status === "PASS").length,
    failed: results.filter((r) => r.status === "FAIL").length,
  }),
);
process.exitCode = results.some((result) => result.status === "FAIL") ? 1 : 0;
