import type { KeyModifiers, KeyName } from "./protocol.js";

export type InputContext =
  "global" | "button" | "input" | "checkbox" | "radio" | "textarea" | "scroll";

export type NormalizedKey = {
  key: KeyName;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  supported: boolean;
};

export type KeyRoute = {
  target: "widget" | "global" | "noop";
  key: NormalizedKey;
};

/**
 * Normalize the few modified combinations with shipped semantics. Other
 * combinations remain valid protocol input but are explicit frame-only
 * no-ops until a widget documents a binding.
 */
export function normalizeKey(key: KeyName, modifiers?: KeyModifiers): NormalizedKey {
  const ctrl = modifiers?.ctrl === true;
  const alt = modifiers?.alt === true;
  const shift = modifiers?.shift === true;
  if (!ctrl && !alt && !shift) return { key, ctrl, alt, shift, supported: true };
  if (shift && !ctrl && !alt && (key === "tab" || key === "shiftTab")) {
    return { key: "shiftTab", ctrl, alt, shift, supported: true };
  }
  if (alt && !ctrl && !shift && (key === "left" || key === "right")) {
    return { key, ctrl, alt, shift, supported: true };
  }
  if (ctrl && !alt && !shift && key === "enter") {
    return { key, ctrl, alt, shift, supported: true };
  }
  return { key, ctrl, alt, shift, supported: false };
}

/** Contextual dispatch only chooses an owner; mutation remains in the
 * session. Tab/Shift+Tab and Escape are deliberately global invariants. */
export function routeKey(context: InputContext, key: NormalizedKey): KeyRoute {
  if (key.key === "tab" || key.key === "shiftTab" || key.key === "escape") {
    return { target: "global", key };
  }
  if (!key.supported) return { target: "noop", key };
  if (key.ctrl && !(context === "textarea" && key.key === "enter")) {
    return { target: "noop", key };
  }
  if (key.alt && context !== "input") return { target: "noop", key };

  if (context === "radio") {
    if (
      key.key === "left" ||
      key.key === "right" ||
      key.key === "up" ||
      key.key === "down" ||
      key.key === "enter"
    ) {
      return { target: "widget", key };
    }
  } else if (context === "textarea") {
    if (
      key.key === "left" ||
      key.key === "right" ||
      key.key === "up" ||
      key.key === "down" ||
      key.key === "home" ||
      key.key === "end" ||
      key.key === "backspace" ||
      key.key === "delete" ||
      key.key === "enter" ||
      key.key === "pageUp" ||
      key.key === "pageDown"
    ) {
      return { target: "widget", key };
    }
  } else if (context === "scroll") {
    if (key.key === "pageUp" || key.key === "pageDown") {
      return { target: "widget", key };
    }
  } else if (context === "input") {
    if (
      key.key === "left" ||
      key.key === "right" ||
      key.key === "home" ||
      key.key === "end" ||
      key.key === "backspace" ||
      key.key === "delete" ||
      key.key === "enter"
    ) {
      return { target: "widget", key };
    }
  } else if ((context === "button" || context === "checkbox") && key.key === "enter") {
    return { target: "widget", key };
  }

  if (key.key === "up" || key.key === "down" || key.key === "pageUp" || key.key === "pageDown") {
    return { target: "global", key };
  }
  return { target: "noop", key };
}

export type ScrollDelta = {
  next: number;
  consumed: number;
  residual: number;
};

/** Apply a signed row delta while retaining the unconsumed portion for a
 * containing document viewport. */
export function applyScrollDelta(
  current: number,
  delta: number,
  total: number,
  visible: number,
): ScrollDelta {
  const max = Math.max(0, total - Math.max(1, visible));
  const next = Math.max(0, Math.min(max, Math.trunc(current + delta)));
  const consumed = next - current;
  return { next, consumed, residual: delta - consumed };
}
