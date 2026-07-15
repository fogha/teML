import { test, expect } from "vitest";
import { processHref, resolveHref } from "../../src/core/href.js";

test("resolveHref resolves relative paths against file base", () => {
  const base = "/docs/page.html";
  expect(resolveHref("other.html", base)).toContain("other.html");
  expect(resolveHref("#section", base)).toBe("#section");
});

test("processHref rejects javascript:", () => {
  expect(processHref("javascript:alert(1)")).toBeNull();
});

test("processHref preserves relative links when no base is requested", () => {
  expect(processHref("logs.html")).toBe("logs.html");
  expect(processHref("../docs/page.md")).toBe("../docs/page.md");
});

test("processHref allows file: with allowFile", () => {
  expect(processHref("file:///tmp/x", { allowFile: true })).toBe("file:///tmp/x");
  expect(processHref("file:///tmp/x", { allowFile: false })).toBeNull();
});

test("processHref confines relative links to base directory", () => {
  const base = "https://example.com/docs/page.html";
  expect(processHref("../secret", { base })).toBeNull();
  expect(processHref("section.html", { base })).toBe("https://example.com/docs/section.html");
});

test("processHref enforces a URL path-segment boundary", () => {
  const base = "https://example.com/docs";
  expect(processHref("https://example.com/docs/page.html", { base })).toBe(
    "https://example.com/docs/page.html",
  );
  expect(processHref("https://example.com/docs-secret/page.html", { base })).toBeNull();
  expect(processHref("https://example.com/docs2", { base })).toBeNull();
});
