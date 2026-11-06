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

test("SSE parsing dispatches CRLF events incrementally across split delimiters", () => {
  const parser = createSseParser();
  const payload = (text: string) => JSON.stringify({ choices: [{ delta: { content: text } }] });
  const wire = `data: ${payload("Hello")}\r\n\r\ndata: ${payload(" world")}\r\n\r\ndata: [DONE]\r\n\r\n`;
  const deltas = [];
  for (const character of wire) deltas.push(...parser.push(character));
  expect(deltas).toEqual(["Hello", " world"]);
  expect(parser.flush()).toEqual([]);
});

test("mock stream produces the complete rich response", async () => {
  let html = "";
  for await (const delta of mockStream(undefined, 0)) html += delta;
  expect(html).toBe(MOCK_REPLY);
});

test("single-file chat and settings views parse without unknown directives", async () => {
  for (const path of [
    "examples/apps/chat/app.html",
    "examples/apps/settings/app.html",
    "examples/apps/snake/game.html",
    "examples/apps/canvas/animation.html",
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

test("chat preserves failed prompts, prevents duplicate turns, and retries without duplicate history", async () => {
  const { createChatController } = await import("../../examples/apps/chat/controller.mjs");
  const view = await readFile("examples/apps/chat/app.html", "utf8");
  let reject!: (error: Error) => void;
  const blocked = new Promise<void>((_resolve, rejectPromise) => {
    reject = rejectPromise;
  });
  const requests: Array<Array<{ role: string; content: string }>> = [];
  const controller = createChatController({
    view,
    stream: async function* (messages: Array<{ role: string; content: string }>) {
      requests.push(messages);
      if (requests.length === 1) await blocked;
      yield "<p>Done</p>";
    },
  });
  let values: Record<string, string> = { "message-0": "retry <me>" };
  const ctx = {
    values: () => values,
    render: (html: string) => {
      const identity = collectInteractiveWidgets(normalize(htmlToDoc(html)));
      values = Object.fromEntries(
        identity.focusables
          .filter((w) => w.name === "textarea")
          .map((w) => [w.id, w.attrs.value ?? ""]),
      );
    },
    replace: () => {},
  };
  const pending = controller.handlers.onSubmit("composer-0", values, ctx);
  await controller.handlers.onSubmit("composer-1", values, ctx);
  expect(requests).toHaveLength(1);
  reject(new Error("offline"));
  await pending;
  expect(Object.values(values)).toEqual(["retry <me>"]);
  await controller.handlers.onSubmit("composer-2", values, ctx);
  expect(requests[1]!.filter((m) => m.role === "user")).toEqual([
    { role: "user", content: "retry <me>" },
  ]);
  controller.dispose();
});

test("chat cancellation and teardown ignore late stream output", async () => {
  const { createChatController } = await import("../../examples/apps/chat/controller.mjs");
  const view = await readFile("examples/apps/chat/app.html", "utf8");
  for (const dispose of [false, true]) {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let signal: AbortSignal | undefined;
    const controller = createChatController({
      view,
      stream: async function* (_messages: unknown, s: AbortSignal) {
        signal = s;
        await blocked;
        yield "late";
      },
    });
    const effects: string[] = [];
    const ctx = {
      values: () => ({ "message-0": "hello" }),
      render: (html: string) => effects.push(html),
      replace: (_id: string, html: string) => effects.push(html),
    };
    const pending = controller.handlers.onSubmit("composer-0", {}, ctx);
    if (dispose) controller.dispose();
    else controller.handlers.onClick("new-1", {}, ctx);
    expect(signal?.aborted).toBe(true);
    const count = effects.length;
    release();
    await pending;
    expect(effects).toHaveLength(count);
    controller.dispose();
  }
});
