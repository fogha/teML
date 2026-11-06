import { test, expect } from "vitest";
import { Diagnostics } from "../../src/core/index.js";
import { htmlToDoc } from "../../src/html/index.js";
import { parseHtml } from "../../src/html/parse.js";

test("parseHtml: full document yields body content", () => {
  const doc = parseHtml("<!doctype html><html><body><p>hi</p></body></html>");
  expect(doc.body?.querySelector("p")?.textContent).toBe("hi");
});

test("parseHtml: fragment is wrapped tolerantly", () => {
  const doc = parseHtml("<h1>frag</h1><p>tail</p>");
  expect(doc.body?.querySelector("h1")?.textContent).toBe("frag");
  expect(doc.body?.querySelector("p")?.textContent).toBe("tail");
});

test("parseHtml: malformed markup still parses", () => {
  const doc = parseHtml("<p>open <b>bold</p></b>");
  expect(doc.body?.textContent).toContain("open");
  expect(doc.body?.textContent).toContain("bold");
});

test("htmlToDoc: deeply nested markup degrades instead of overflowing", () => {
  const source = "<div>".repeat(5_000) + "x" + "</div>".repeat(5_000);
  const diags = new Diagnostics();
  const converted = htmlToDoc(source, diags);
  expect(converted.blocks).toEqual([{ type: "codeBlock", value: source }]);
  expect(diags.has("parse-overflow-rejected")).toBe(true);
});
