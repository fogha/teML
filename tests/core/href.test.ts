import { test, expect } from "vitest";
import { isWindowsDrivePath, processHref, resolveHref } from "../../src/core/href.js";

test("isWindowsDrivePath separates drive letters from one-letter URL schemes", () => {
  expect(isWindowsDrivePath("C:\\docs\\a.teml")).toBe(true);
  expect(isWindowsDrivePath("c:/docs/a.teml")).toBe(true);
  // A colon with no separator is a scheme, not a drive.
  expect(isWindowsDrivePath("c:docs")).toBe(false);
  expect(isWindowsDrivePath("https://example.test/")).toBe(false);
  expect(isWindowsDrivePath("mailto:a@example.test")).toBe(false);
  expect(isWindowsDrivePath("/docs/a.teml")).toBe(false);
  expect(isWindowsDrivePath("a.teml")).toBe(false);
});

test("document href sanitization still refuses drive-qualified local paths", () => {
  // The Reader may open "C:\docs\a.teml" from its own directory listing, but an
  // untrusted document must not reach the local filesystem through one.
  expect(processHref("C:\\Windows\\System32\\config")).toBeNull();
});

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
