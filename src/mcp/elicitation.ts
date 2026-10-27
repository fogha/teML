// mcp/elicitation.ts — MCP elicitation form mode ↔ TeML, as pure functions.
//
// This module is deliberately independent of the engine's protocol: it turns a
// `requestedSchema` into TeML markup and turns collected widget values back into
// a typed, validated elicitation response. No engine change is required to use
// it, which is why it is the first honest slice of the agent-native direction.
//
// Two guarantees are load-bearing and testable:
//   1. A schema naming a secret (or a `password` format) produces **no markup**
//      and a named diagnostic. Elicitation form mode forbids secrets, terminal
//      input echoes, and TeML's `mask` is render-only — so the refusal is the
//      correct behavior, not a limitation to route around.
//   2. A constraint this engine cannot enforce is **refused**, never silently
//      dropped. Silently dropping `minimum` would be worse than refusing it:
//      the server would reject input the form accepted.
//
// Anything else here is best-effort and documented as such.

import {
  FORMAT_PATTERNS,
  isKnownFormat,
  parseValidationRules,
  validateValue,
  type ValidationRule,
} from "../core/validate.js";

/** The subset of JSON Schema that elicitation form mode allows, restricted
 * further to what this engine can actually enforce. */
export type ElicitationSchema = {
  type: "object";
  required?: string[];
  properties?: Record<string, ElicitationProperty>;
};

export type ElicitationProperty = {
  type?: "string" | "number" | "integer" | "boolean";
  title?: string;
  description?: string;
  default?: unknown;
  /** string only */
  format?: string;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  /** enum forms */
  enum?: unknown[];
  oneOf?: { const: unknown; title?: string }[];
  /** number/integer only — refused, see the header. */
  minimum?: number;
  maximum?: number;
  multipleOf?: number;
};

export type SchemaToTemlResult = {
  markup: string;
  diagnostics: string[];
};

export type ElicitationAction = "accept" | "decline" | "cancel";

export type ValuesToResponseResult =
  | { action: "accept"; content: Record<string, unknown> }
  | { action: "decline" }
  | { action: "cancel" }
  | { errors: string[] };

/** Default secret heuristic. Best-effort by design: documented as a heuristic
 * with overrides, never as a guarantee. The guarantee is that a *denied* field
 * produces no markup. */
export const DEFAULT_SECRET_PATTERNS: readonly string[] = [
  "pass(word|phrase)?",
  "secret",
  "token",
  "api[_-]?key",
  "credential",
  "private[_-]?key",
  "otp",
  "pin",
  "cvv",
  "auth",
];

export type SecretPolicy = {
  /** Extra patterns (case-insensitive) that mark a field as secret. */
  deny?: readonly string[];
  /** Field names (case-insensitive) that are accepted despite matching a deny
   * pattern — e.g. an internal `tokenCount` that is not a credential. */
  allow?: readonly string[];
};

export type SchemaToTemlOptions = {
  /** Container title. Defaults to a generic prompt-free heading. */
  title?: string;
  secrets?: SecretPolicy;
};

function isSecretName(name: string, policy: SecretPolicy | undefined): boolean {
  const allow = new Set((policy?.allow ?? []).map((n) => n.toLowerCase()));
  if (allow.has(name.toLowerCase())) return false;
  const patterns = [...DEFAULT_SECRET_PATTERNS, ...(policy?.deny ?? [])];
  return patterns.some((pattern) => new RegExp(`^${pattern}$`, "i").test(name));
}

/** TeML attribute values are single-line; line breaks and quotes must not
 * escape the attribute. */
function attrValue(value: string): string {
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/"/g, "'")
    .trim();
}

function enumEntries(
  property: ElicitationProperty,
): { value: string; label: string }[] | undefined {
  if (Array.isArray(property.enum)) {
    return property.enum.map((entry) => ({ value: String(entry), label: String(entry) }));
  }
  if (Array.isArray(property.oneOf)) {
    return property.oneOf.map((entry) => ({
      value: String(entry.const),
      label: entry.title ?? String(entry.const),
    }));
  }
  return undefined;
}

/**
 * Generate a TeML form for an elicitation `requestedSchema`.
 *
 * Fence discipline matters here: the **outermost fence is the longest**, so a
 * form is `::::form` wrapping `:::radio`, closed `:::` then `::::`. The reverse
 * silently strands every following widget with no diagnostic, which is the
 * single easiest way for a generator to emit a broken document.
 */
export function schemaToTeml(
  schema: ElicitationSchema,
  options: SchemaToTemlOptions = {},
): SchemaToTemlResult {
  const diagnostics: string[] = [];
  const properties = schema.properties ?? {};
  const names = Object.keys(properties);
  const required = new Set(schema.required ?? []);

  // Refusal comes first, before any markup is produced.
  for (const name of names) {
    const property = properties[name]!;
    if (property.format === "password") {
      diagnostics.push(`field '${name}': format "password" is not permitted in form mode`);
      return { markup: "", diagnostics };
    }
    if (isSecretName(name, options.secrets)) {
      diagnostics.push(
        `field '${name}': looks like a secret; elicitation form mode forbids secrets (terminal input echoes)`,
      );
      return { markup: "", diagnostics };
    }
  }

  const lines: string[] = [];
  const title = options.title?.trim();
  lines.push(`::::form{id="elicitation"${title ? ` label="${attrValue(title)}"` : ""}}`);

  for (const name of names) {
    const property = properties[name]!;
    const label = attrValue(property.title ?? name);
    const isRequired = required.has(name);

    // Numeric bounds are unenforceable by this engine: refuse rather than drop.
    if (
      property.minimum !== undefined ||
      property.maximum !== undefined ||
      property.multipleOf !== undefined
    ) {
      diagnostics.push(
        `field '${name}': minimum/maximum/multipleOf cannot be enforced by this engine; no markup generated`,
      );
      return { markup: "", diagnostics };
    }

    // Arrays (multi-select) are not representable: individual checkboxes
    // cannot express minItems/maxItems or one atomic value.
    if ((property as { type?: string }).type === "array") {
      diagnostics.push(
        `field '${name}': array/multi-select has no faithful TeML representation; no markup generated`,
      );
      return { markup: "", diagnostics };
    }

    if (Array.isArray(property.enum) || Array.isArray(property.oneOf)) {
      const entries = enumEntries(property);
      if (!entries) continue;
      if (entries.length === 0) {
        diagnostics.push(`field '${name}': empty enum has no representation`);
        return { markup: "", diagnostics };
      }
      // A single-value enum is a constant; a radio of one option is noise.
      if (entries.length === 1) {
        lines.push(
          `::input{id="${attrValue(name)}" label="${label}" value="${attrValue(entries[0]!.value)}"${isRequired ? " required" : ""}}`,
        );
        continue;
      }
      const selected = property.default !== undefined ? String(property.default) : "";
      lines.push(
        `:::radio{id="${attrValue(name)}"${selected ? ` value="${attrValue(selected)}"` : ""}}`,
      );
      for (const entry of entries) {
        lines.push(`::option{value="${attrValue(entry.value)}" label="${attrValue(entry.label)}"}`);
      }
      lines.push(":::");
      continue;
    }

    if (property.type === "boolean") {
      // Only a `true` default is checked; an explicit "false" keeps it off.
      const checked = property.default === true ? ' checked="true"' : "";
      lines.push(`::checkbox{id="${attrValue(name)}" label="${label}"${checked}}`);
      continue;
    }

    const attrs = [`id="${attrValue(name)}"`, `label="${label}"`];
    if (property.default !== undefined && typeof property.default !== "object") {
      attrs.push(`value="${attrValue(String(property.default))}"`);
    }
    if (isRequired) attrs.push("required");
    // Format patterns come from core/validate so the generator and the engine
    // cannot disagree about what "email" means.
    if (property.format && isKnownFormat(property.format)) {
      attrs.push(`pattern="${attrValue(FORMAT_PATTERNS[property.format])}"`);
    } else if (property.pattern) {
      attrs.push(`pattern="${attrValue(property.pattern)}"`);
    }
    if (property.minLength !== undefined) attrs.push(`minLength="${property.minLength}"`);
    if (property.maxLength !== undefined) attrs.push(`maxLength="${property.maxLength}"`);
    // A long free-text field is a textarea; the threshold is presentation only.
    const longText = (property.maxLength ?? 0) > 200;
    if (property.type === "string" && longText) {
      lines.push(`::textarea{${attrs.join(" ")} rows="4"}`);
    } else {
      lines.push(`::input{${attrs.join(" ")}}`);
    }
  }

  lines.push('::button{id="accept" label="Accept" submit="true"}');
  lines.push('::button{id="decline" label="Decline"}');
  lines.push("::::");
  return { markup: `${lines.join("\n")}\n`, diagnostics };
}

/** Widget ids this generator emits that are not schema fields. */
export const NON_FIELD_IDS: readonly string[] = ["accept", "decline", "submit", "cancel"];

function coerce(
  property: ElicitationProperty,
  raw: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  switch (property.type) {
    case "boolean":
      return { ok: true, value: raw === "true" };
    case "number": {
      const n = Number(raw);
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, error: "not a number" };
    }
    case "integer": {
      const n = Number(raw);
      return Number.isInteger(n) ? { ok: true, value: n } : { ok: false, error: "not an integer" };
    }
    default:
      return { ok: true, value: raw };
  }
}

/**
 * Turn a `submit`/`click` value snapshot into an elicitation response.
 *
 * `action` is the id of the control the host activated (the engine's
 * `submit`/`click` id). The host already knows what the user pressed, so it
 * must pass it: button values are always the empty string, and a negative
 * action would otherwise be indistinguishable from an untouched optional field.
 * When `action` is omitted, decline/cancel ids are honoured only if they carry
 * a non-empty value, and the first present control id in `values` is used.
 *
 * Values are coerced by schema type, and an empty optional field is **omitted**
 * rather than sent as `""`: servers validate `minLength` and requiredness
 * themselves, so `""` produces spurious rejections.
 */
export function valuesToResponse(
  schema: ElicitationSchema,
  values: Record<string, string>,
  options: { action?: string; declineId?: string; cancelId?: string } = {},
): ValuesToResponseResult {
  const declineId = options.declineId ?? "decline";
  const cancelId = options.cancelId ?? "cancel";
  const action =
    options.action ??
    Object.keys(values).find(
      (id) => NON_FIELD_IDS.includes(id) && values[id] !== undefined && values[id] !== "",
    );
  if (action === cancelId) return { action: "cancel" };
  if (action === declineId) return { action: "decline" };

  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const drops = new Set([...NON_FIELD_IDS]);
  const errors: string[] = [];
  const content: Record<string, unknown> = {};

  for (const [name, property] of Object.entries(properties)) {
    // A schema property that collides with a control-button id is a control,
    // not a field: the generated form already uses that id for accept/decline.
    if (drops.has(name)) continue;
    const raw = values[name];
    if (raw === undefined) {
      if (required.has(name)) errors.push(`${name}: required`);
      continue;
    }
    const rule: ValidationRule | undefined = parseValidationRules({
      ...(required.has(name) ? { required: "true" } : {}),
      ...(property.minLength !== undefined ? { minLength: String(property.minLength) } : {}),
      ...(property.maxLength !== undefined ? { maxLength: String(property.maxLength) } : {}),
      ...(property.pattern ? { pattern: property.pattern } : {}),
    });
    if (rule) {
      const message = validateValue(rule, raw);
      if (message) {
        errors.push(`${name}: ${message}`);
        continue;
      }
    }
    // An untouched optional text field is absent from the response, not "".
    if (raw === "" && !required.has(name)) continue;
    const result = coerce(property, raw);
    if (!result.ok) {
      errors.push(`${name}: ${result.error}`);
      continue;
    }
    content[name] = result.value;
  }

  if (errors.length) return { errors };
  return { action: "accept", content };
}
