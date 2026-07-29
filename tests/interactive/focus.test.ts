import { test, expect } from "vitest";
import { doc, text } from "../../src/core/ast.js";
import { Diagnostics } from "../../src/core/diagnostics.js";
import { collectFocusable, nextFocusId, prevFocusId } from "../../src/interactive/focus.js";

test("collectFocusable finds button/input/checkbox in document order", () => {
  const d = doc([
    { type: "leaf", name: "button", attrs: { id: "b1", label: "First" } },
    { type: "paragraph", children: [text("noise")] },
    { type: "leaf", name: "input", attrs: { id: "i1" } },
    { type: "leaf", name: "checkbox", attrs: { id: "c1" } },
  ]);
  const found = collectFocusable(d);
  expect(found.map((w) => w.id)).toEqual(["b1", "i1", "c1"]);
  expect(found.map((w) => w.name)).toEqual(["button", "input", "checkbox"]);
});

test("collectFocusable walks into containers, lists, and quotes", () => {
  const d = doc([
    {
      type: "container",
      name: "card",
      attrs: {},
      children: [{ type: "leaf", name: "button", attrs: { id: "in-card" } }],
    },
    {
      type: "list",
      ordered: false,
      start: 1,
      items: [{ blocks: [{ type: "leaf", name: "checkbox", attrs: { id: "in-list" } }] }],
    },
    {
      type: "quote",
      children: [{ type: "leaf", name: "input", attrs: { id: "in-quote" } }],
    },
  ]);
  const found = collectFocusable(d);
  expect(found.map((w) => w.id)).toEqual(["in-card", "in-list", "in-quote"]);
});

test("radio and scroll containers are single focus targets in document order", () => {
  const d = doc([
    {
      type: "container",
      name: "radio",
      attrs: { id: "plan" },
      children: [
        { type: "leaf", name: "option", attrs: { value: "free" } },
        { type: "leaf", name: "option", attrs: { value: "pro" } },
      ],
    },
    {
      type: "container",
      name: "scroll",
      attrs: { id: "logs", rows: "3" },
      children: [{ type: "leaf", name: "button", attrs: { id: "nested" } }],
    },
    { type: "leaf", name: "textarea", attrs: { id: "bio", rows: "2" } },
  ]);
  const found = collectFocusable(d);
  expect(found.map((widget) => widget.id)).toEqual(["plan", "logs", "bio"]);
  expect(found[0]?.options?.map((option) => option.value)).toEqual(["free", "pro"]);
});

test("widgets without an id are dropped from the tab order and warned about", () => {
  const d = doc([
    { type: "leaf", name: "button", attrs: { label: "No id" } },
    { type: "leaf", name: "button", attrs: { id: "ok", label: "Has id" } },
  ]);
  const diags = new Diagnostics();
  const found = collectFocusable(d, diags);
  expect(found.map((w) => w.id)).toEqual(["ok"]);
  expect(diags.has("focus-missing-id")).toBe(true);
});

test("duplicate ids keep only the first occurrence and warn", () => {
  const d = doc([
    { type: "leaf", name: "button", attrs: { id: "dup", label: "First" } },
    { type: "leaf", name: "input", attrs: { id: "dup" } },
  ]);
  const diags = new Diagnostics();
  const found = collectFocusable(d, diags);
  expect(found).toHaveLength(1);
  expect(found[0]?.name).toBe("button");
  expect(diags.has("focus-duplicate-id")).toBe(true);
});

test("non-focusable leafs (e.g. metric, break) are ignored", () => {
  const d = doc([
    { type: "leaf", name: "metric", attrs: { label: "CPU", value: "1%" } },
    { type: "leaf", name: "break", attrs: {} },
  ]);
  expect(collectFocusable(d)).toEqual([]);
});

test("nextFocusId/prevFocusId wrap around the order", () => {
  const d = doc([
    { type: "leaf", name: "button", attrs: { id: "a" } },
    { type: "leaf", name: "button", attrs: { id: "b" } },
    { type: "leaf", name: "button", attrs: { id: "c" } },
  ]);
  const order = collectFocusable(d);
  expect(nextFocusId(order, undefined)).toBe("a");
  expect(nextFocusId(order, "a")).toBe("b");
  expect(nextFocusId(order, "c")).toBe("a");
  expect(prevFocusId(order, undefined)).toBe("c");
  expect(prevFocusId(order, "a")).toBe("c");
  expect(prevFocusId(order, "b")).toBe("a");
});

test("nextFocusId/prevFocusId return undefined when nothing is focusable", () => {
  const d = doc([{ type: "paragraph", children: [text("nothing here")] }]);
  const order = collectFocusable(d);
  expect(nextFocusId(order, undefined)).toBeUndefined();
  expect(prevFocusId(order, undefined)).toBeUndefined();
});
