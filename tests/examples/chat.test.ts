import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { Diagnostics, normalize } from "../../src/core/index.js";
import { htmlToDoc } from "../../src/html/index.js";
import { collectInteractiveWidgets } from "../../src/interactive/updatable.js";
import { MOCK_REPLY, createSseParser, mockStream } from "../../examples/apps/chat/stream.mjs";

test("SSE parsing preserves deltas across fragmented event boundaries", () => {
  const parser = createSseParser();
  const payload = (text: string) => JSON.stringify({ choices: [{ delta: { content: text } }] });
  const chunks = [
    `data: ${payload("Hel")}\n`,
    `\ndata: ${payload("lo")}\n\ndata: ${payload(" world")}`,
    `\n\ndata: [DONE]\n\n`,
  ];
  const deltas = chunks.flatMap((chunk) => parser.push(chunk));
  expect([...deltas, ...parser.flush()].join("")).toBe("Hello world");
});

test("mock stream produces the complete rich response", async () => {
  let html = "";
  for await (const delta of mockStream(undefined, 0)) html += delta;
  expect(html).toBe(MOCK_REPLY);
});

test("single-file chat and settings views parse without unknown directives", async () => {
  for (const path of [
    "examples/apps/chat/app.html",
    "examples/apps/settings-app.html",
    "examples/apps/snake-prototype.html",
    "examples/apps/canvas-animation.html",
  ]) {
    const diags = new Diagnostics();
    const source = await readFile(path, "utf8");
    const doc = normalize(htmlToDoc(source, diags), diags);
    expect(doc.blocks.length, path).toBeGreaterThan(0);
    expect(
      diags.all().filter((warning) => warning.code === "unknown-directive"),
      path,
    ).toEqual([]);
  }
});

test("chat view keeps history, status, and composer growth metadata", async () => {
  const diags = new Diagnostics();
  const source = await readFile("examples/apps/chat/app.html", "utf8");
  const doc = normalize(htmlToDoc(source, diags), diags);
  const identity = collectInteractiveWidgets(doc, diags);
  expect(identity.mutationTargets.map((target) => target.id)).toEqual(
    expect.arrayContaining(["history", "status"]),
  );
  const composer = identity.focusables.find((widget) => widget.id === "message");
  expect(composer?.attrs.autoGrow).toBe("true");
  expect(composer?.attrs.maxRows).toBe("6");
});
