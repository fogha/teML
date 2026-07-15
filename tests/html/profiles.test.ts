import { test, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { elementMatches, loadProfile, validateProfile } from "../../src/html/profiles/loader.js";
import { parseHTML } from "linkedom";

test("validateProfile rejects invalid shape", () => {
  expect(() => validateProfile({})).toThrow(/profile.name/);
  expect(() => validateProfile({ name: "x", containers: [], spans: "nope" })).toThrow(/spans/);
});

test("loadProfile loads bundled bootstrap profile", () => {
  const profile = loadProfile("bootstrap");
  expect(profile.name).toBe("bootstrap");
  expect(profile.containers.some((c) => c.directive === "card")).toBe(true);
  expect(profile.spans.some((s) => s.role === "success")).toBe(true);
});

test("loadProfile loads custom json path", () => {
  const dir = mkdtempSync(join(tmpdir(), "teml-profile-"));
  const path = join(dir, "custom.json");
  writeFileSync(
    path,
    JSON.stringify({
      name: "custom",
      containers: [{ match: { class: "panel" }, directive: "card" }],
      spans: [{ match: { class: "accent" }, role: "info" }],
    }),
  );
  const profile = loadProfile(path);
  expect(profile.name).toBe("custom");
});

test("elementMatches checks class and tag", () => {
  const { document } = parseHTML('<html><body><div class="card alert"></div></body></html>');
  const el = document.querySelector(".card")!;
  expect(elementMatches(el, { class: "card" })).toBe(true);
  expect(elementMatches(el, { class: "missing" })).toBe(false);
  expect(elementMatches(el, { tag: "div", class: "card" })).toBe(true);
});
