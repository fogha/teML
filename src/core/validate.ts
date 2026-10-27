// core/validate.ts — declarative field constraints for interactive widgets.
//
// Pure and dependency-light on purpose: layout must not validate (see
// docs/architecture.md on single ownership), the session validates, and this
// module is the only place a rule is interpreted. `schemaToTeml` consumes the
// same FORMAT_PATTERNS so a generator and the engine cannot disagree about what
// "email" means.
//
// Nothing here throws and nothing here is fatal: a document with a malformed
// `pattern` still renders, minus that one constraint, with a diagnostic.

import type { Diagnostics } from "./diagnostics.js";
import { graphemes } from "../layout/measure.js";

/** How `minLength`/`maxLength` count. Code points match JSON Schema; graphemes
 * match what an author means by "characters". The default is code points so
 * engine-side acceptance cannot diverge from a server validating the same value. */
export type LengthBasis = "codepoints" | "graphemes";

export type ValidationRule = {
  required?: boolean;
  /** Source text, anchored by `validateValue` at match time. */
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  count?: LengthBasis;
};

/** Constraint attributes this module reads. The directive registry allowlists
 * them; this list is what `schemaToTeml` may emit. */
export const VALIDATION_ATTRS = ["required", "pattern", "minLength", "maxLength", "count"] as const;

/** Human-readable messages are deliberately value-free: the failing field id is
 * the identifier, and a message must never echo what the user typed. */
export const REQUIRED_MESSAGE = "required";
export const PATTERN_MESSAGE = "does not match the expected format";

const MIN_LENGTH_MESSAGE = (n: number) =>
  `must be at least ${n} ${n === 1 ? "character" : "characters"}`;
const MAX_LENGTH_MESSAGE = (n: number) =>
  `must be at most ${n} ${n === 1 ? "character" : "characters"}`;

function isTruthyFlag(raw: string | undefined): boolean {
  if (raw == null) return false;
  const text = raw.trim().toLowerCase();
  return text === "" || text === "true" || text === "required";
}

/** Parse a serviceable non-negative integer; anything else is not a rule. */
function parseCount(raw: string | undefined): number | undefined {
  const text = raw?.trim();
  if (!text) return undefined;
  if (!/^\d+$/.test(text)) return undefined;
  const n = Number.parseInt(text, 10);
  return Number.isSafeInteger(n) ? n : undefined;
}

/**
 * Read the constraint attributes off a directive's attribute bag.
 * Returns `undefined` when the widget is unconstrained, so the common path
 * (every document that does not use validation) allocates nothing.
 */
export function parseValidationRules(
  attrs: Record<string, string> | undefined,
  diags?: Diagnostics,
): ValidationRule | undefined {
  if (!attrs) return undefined;
  const rule: ValidationRule = {};
  let present = false;

  if (isTruthyFlag(attrs.required)) {
    rule.required = true;
    present = true;
  }

  const pattern = attrs.pattern?.trim();
  if (pattern) {
    // Compile once here so a malformed pattern warns at parse time and is
    // dropped, rather than silently never matching during validation.
    if (compiles(pattern)) {
      rule.pattern = pattern;
      present = true;
    } else {
      diags?.warnOnce(
        "validation-invalid-pattern",
        `invalid pattern attribute ignored: ${pattern}`,
      );
    }
  }

  for (const [key, target] of [
    ["minLength", "minLength"],
    ["maxLength", "maxLength"],
  ] as const) {
    const raw = attrs[key];
    if (raw == null || raw.trim() === "") continue;
    const n = parseCount(raw);
    if (n === undefined) {
      diags?.warnOnce(
        "validation-invalid-length",
        `invalid ${key} attribute ignored: ${raw} (expected a non-negative integer)`,
      );
      continue;
    }
    rule[target] = n;
    present = true;
  }

  const count = attrs.count?.trim().toLowerCase();
  if (count) {
    if (count === "codepoints" || count === "graphemes") {
      rule.count = count;
      present = true;
    } else {
      diags?.warnOnce(
        "validation-invalid-length",
        `invalid count attribute ignored: ${count} (expected "codepoints" or "graphemes")`,
      );
    }
  }

  return present ? rule : undefined;
}

function compiles(pattern: string): boolean {
  try {
    new RegExp(`^(?:${pattern})$`);
    return true;
  } catch {
    return false;
  }
}

/** Length under the rule's basis. Code points use the string iterator, which
 * counts astral characters once; graphemes reuse the layout segmenter. */
export function measureLength(value: string, basis: LengthBasis = "codepoints"): number {
  return basis === "graphemes" ? graphemes(value).length : [...value].length;
}

/**
 * The first failure for `value`, or `undefined` when it satisfies the rule.
 * Messages never include the value and never include the pattern source.
 */
export function validateValue(rule: ValidationRule, value: string): string | undefined {
  // A required field of only whitespace is empty: a space is not an answer.
  if (rule.required && value.trim() === "") return REQUIRED_MESSAGE;

  // Empty optional fields satisfy every remaining constraint, so a
  // `minLength` never makes an unset optional field unsubmittable.
  if (value === "") return undefined;

  if (rule.pattern && !new RegExp(`^(?:${rule.pattern})$`).test(value)) return PATTERN_MESSAGE;

  const basis = rule.count ?? "codepoints";
  const length = measureLength(value, basis);
  if (rule.minLength !== undefined && length < rule.minLength) {
    return MIN_LENGTH_MESSAGE(rule.minLength);
  }
  if (rule.maxLength !== undefined && length > rule.maxLength) {
    return MAX_LENGTH_MESSAGE(rule.maxLength);
  }
  return undefined;
}

/**
 * Format patterns shared by validation and schema generation. Deliberately
 * permissive: the engine's job is to catch obvious mistakes before a round
 * trip, not to be a normative validator for someone else's spec. The server
 * remains authoritative, which is also why the length basis above matches
 * JSON Schema's.
 */
export const FORMAT_PATTERNS: Readonly<Record<"email" | "uri" | "date" | "date-time", string>> = {
  email: "[^@\\s]+@[^@\\s]+\\.[^@\\s]+",
  uri: "[a-zA-Z][a-zA-Z0-9+.-]*:\\S+",
  date: "\\d{4}-\\d{2}-\\d{2}",
  "date-time":
    "\\d{4}-\\d{2}-\\d{2}[Tt ]\\d{2}:\\d{2}(:\\d{2}(\\.\\d+)?)?([Zz]|[+-]\\d{2}:\\d{2})?",
};

export type KnownFormat = keyof typeof FORMAT_PATTERNS;

export function isKnownFormat(format: string): format is KnownFormat {
  return Object.prototype.hasOwnProperty.call(FORMAT_PATTERNS, format);
}
