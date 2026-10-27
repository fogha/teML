import { test, expect } from "vitest";
import { Diagnostics } from "../../src/core/index.js";
import {
  FORMAT_PATTERNS,
  isKnownFormat,
  measureLength,
  parseValidationRules,
  validateValue,
} from "../../src/core/validate.js";

test("no constraint attributes yields no rule (nothing allocated)", () => {
  expect(parseValidationRules({})).toBeUndefined();
  expect(parseValidationRules({ label: "Name", value: "Ada" })).toBeUndefined();
  expect(parseValidationRules(undefined)).toBeUndefined();
});

test("required accepts bare, empty, and true forms; false is not required", () => {
  expect(parseValidationRules({ required: "" })).toEqual({ required: true });
  expect(parseValidationRules({ required: "true" })).toEqual({ required: true });
  expect(parseValidationRules({ required: "required" })).toEqual({ required: true });
  expect(parseValidationRules({ required: "false" })).toBeUndefined();
});

test("malformed lengths and counts are ignored with a diagnostic", () => {
  const diags = new Diagnostics();
  const rule = parseValidationRules({ minLength: "abc", maxLength: "-4", count: "words" }, diags);
  expect(rule).toBeUndefined();
  expect(diags.has("validation-invalid-length")).toBe(true);
});

test("a malformed pattern is dropped rather than silently never matching", () => {
  const diags = new Diagnostics();
  const rule = parseValidationRules({ pattern: "([unclosed" }, diags);
  expect(rule).toBeUndefined();
  expect(diags.has("validation-invalid-pattern")).toBe(true);
});

test("required rejects whitespace-only values", () => {
  expect(validateValue({ required: true }, "   ")).toBe("required");
  expect(validateValue({ required: true }, "Ada")).toBeUndefined();
  expect(validateValue({ required: true }, "")).toBe("required");
});

test("an empty optional field satisfies every other constraint", () => {
  expect(validateValue({ minLength: 5 }, "")).toBeUndefined();
  expect(validateValue({ pattern: "\\d+" }, "")).toBeUndefined();
});

test("pattern is anchored to the whole value", () => {
  expect(validateValue({ pattern: "\\d{3}" }, "123")).toBeUndefined();
  // A substring match must not pass: "x123y" contains "123" but is not it.
  expect(validateValue({ pattern: "\\d{3}" }, "x123y")).toBeDefined();
  expect(validateValue({ pattern: "\\d{3}" }, "1234")).toBeDefined();
});

test("length is counted in code points by default", () => {
  // One grapheme, five code points (three emoji joined by two ZWJ).
  const family = "👨‍👩‍👧";
  expect(measureLength(family, "graphemes")).toBe(1);
  expect(measureLength(family, "codepoints")).toBe(5);
  expect(validateValue({ maxLength: 4 }, family)).toBeDefined();
  expect(validateValue({ maxLength: 5 }, family)).toBeUndefined();
});

test("count=graphemes switches the basis", () => {
  const family = "👨‍👩‍👧";
  expect(validateValue({ maxLength: 1, count: "graphemes" }, family)).toBeUndefined();
  expect(validateValue({ minLength: 2, count: "graphemes" }, family)).toBeDefined();
});

test("min and max length produce messages that never echo the value", () => {
  const message = validateValue({ minLength: 8 }, "abc");
  expect(message).toBeDefined();
  expect(message).not.toContain("abc");
  expect(validateValue({ maxLength: 2 }, "abcd")).toBeDefined();
});

test("format patterns are exportable and identifiable", () => {
  expect(isKnownFormat("email")).toBe(true);
  expect(isKnownFormat("phone")).toBe(false);
  expect(validateValue({ pattern: FORMAT_PATTERNS.email }, "ada@example.com")).toBeUndefined();
  expect(validateValue({ pattern: FORMAT_PATTERNS.email }, "not-an-email")).toBeDefined();
  expect(validateValue({ pattern: FORMAT_PATTERNS.date }, "2026-09-17")).toBeUndefined();
  expect(validateValue({ pattern: FORMAT_PATTERNS.date }, "17/09/2026")).toBeDefined();
});
