import { test, expect } from "vitest";
import { sanitizeHref, sanitizeText } from "../../src/core/sanitize.js";

test("sanitizeText strips ESC and controls, keeps newline", () => {
  expect(sanitizeText("a\x1b[31mb")).toBe("a[31mb");
  expect(sanitizeText("a\x07b\nc")).toBe("ab\nc");
  expect(sanitizeText("a\x7fb\u009bc")).toBe("abc");
});

test("sanitizeText strips bidi and zero-width, keeps emoji ZWJ", () => {
  expect(sanitizeText("a\u202eb\u2066c")).toBe("abc");
  expect(sanitizeText("a\u200bb")).toBe("ab");
  expect(sanitizeText("👩\u200d💻")).toBe("👩\u200d💻");
  expect(sanitizeText("a\u200db")).toBe("ab");
});

test("sanitizeText tab handling by mode", () => {
  expect(sanitizeText("a\tb")).toBe("a b");
  expect(sanitizeText("a\tb", "code")).toBe("a    b");
  expect(sanitizeText("a\t\nb", "code")).toBe("a    \nb");
});

test("sanitizeHref allowlist and control rejection", () => {
  expect(sanitizeHref("https://x.dev")).toBe("https://x.dev");
  expect(sanitizeHref("http://x.dev")).toBe("http://x.dev");
  expect(sanitizeHref("mailto:a@b")).toBe("mailto:a@b");
  expect(sanitizeHref("docs/a.teml")).toBe("docs/a.teml");
  expect(sanitizeHref("#anchor")).toBe("#anchor");
  expect(sanitizeHref("javascript:alert(1)")).toBeNull();
  expect(sanitizeHref("file:///etc/passwd")).toBeNull();
  expect(sanitizeHref("file:///a", { allowFile: true })).toBe("file:///a");
  expect(sanitizeHref("ht\x1btps://x")).toBeNull();
  expect(sanitizeHref("https://x/\x7f")).toBeNull();
});
