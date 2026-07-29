import { test, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Diagnostics } from "../../src/core/diagnostics.js";
import { htmlToDoc } from "../../src/html/index.js";
import {
  elementMatches,
  loadProfile,
  titleFromSelectors,
  validateProfile,
} from "../../src/html/profiles/loader.js";
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

test("validateProfile rejects a directive that is not a TeML container", () => {
  expect(() =>
    validateProfile({
      name: "x",
      containers: [{ match: { class: "panel" }, directive: "not-a-directive" }],
      spans: [],
    }),
  ).toThrow(/not a known TeML container directive/);
});

test("an invalid titleFrom selector degrades instead of aborting the conversion", () => {
  const { document } = parseHTML(
    '<html><body><div class="panel"><h3>Title</h3><p>Body</p></div></body></html>',
  );
  const el = document.querySelector(".panel")!;
  const diags = new Diagnostics();
  // A malformed selector must be skipped so a later valid one still applies.
  expect(titleFromSelectors(el, ":::bogus, h3", diags)).toBe("Title");
  expect(diags.has("profile-invalid-selector")).toBe(true);
});

test("a document with an invalid profile selector still converts", () => {
  const dir = mkdtempSync(join(tmpdir(), "teml-profile-bad-"));
  const path = join(dir, "bad-selector.json");
  writeFileSync(
    path,
    JSON.stringify({
      name: "bad-selector",
      containers: [{ match: { class: "panel" }, directive: "card", titleFrom: ":::bogus" }],
      spans: [],
    }),
  );
  const diags = new Diagnostics();
  const doc = htmlToDoc(
    '<html><body><div class="panel"><p>Body</p></div></body></html>',
    { profile: path },
    diags,
  );
  expect(doc.blocks[0]).toMatchObject({ type: "container", name: "card" });
  expect(diags.has("profile-invalid-selector")).toBe(true);
});

test("elementMatches checks class and tag", () => {
  const { document } = parseHTML('<html><body><div class="card alert"></div></body></html>');
  const el = document.querySelector(".card")!;
  expect(elementMatches(el, { class: "card" })).toBe(true);
  expect(elementMatches(el, { class: "missing" })).toBe(false);
  expect(elementMatches(el, { tag: "div", class: "card" })).toBe(true);
});
