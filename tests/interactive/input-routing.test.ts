import { describe, expect, test } from "vitest";
import {
  applyScrollDelta,
  normalizeKey,
  routeKey,
  type InputContext,
} from "../../src/interactive/input-routing.js";

describe("contextual input routing", () => {
  test.each<InputContext>(["global", "button", "input", "checkbox", "radio", "textarea", "scroll"])(
    "Tab and Escape remain global in %s context",
    (context) => {
      expect(routeKey(context, normalizeKey("tab")).target).toBe("global");
      expect(routeKey(context, normalizeKey("escape")).target).toBe("global");
      expect(routeKey(context, normalizeKey("tab", { shift: true })).key.key).toBe("shiftTab");
    },
  );

  test("radio and textarea consume local arrows before global focus traversal", () => {
    expect(routeKey("radio", normalizeKey("down")).target).toBe("widget");
    expect(routeKey("textarea", normalizeKey("down")).target).toBe("widget");
    expect(routeKey("input", normalizeKey("down")).target).toBe("global");
    expect(routeKey("global", normalizeKey("down")).target).toBe("global");
  });

  test("page keys route to focused bounded containers", () => {
    expect(routeKey("textarea", normalizeKey("pageDown")).target).toBe("widget");
    expect(routeKey("scroll", normalizeKey("pageDown")).target).toBe("widget");
    expect(routeKey("input", normalizeKey("pageDown")).target).toBe("global");
  });

  test("only textarea consumes Ctrl+Enter", () => {
    expect(routeKey("textarea", normalizeKey("enter", { ctrl: true })).target).toBe("widget");
    expect(routeKey("input", normalizeKey("enter", { ctrl: true })).target).toBe("noop");
  });

  test("scroll delta reports exact consumed and residual rows", () => {
    expect(applyScrollDelta(8, 5, 10, 2)).toEqual({
      next: 8,
      consumed: 0,
      residual: 5,
    });
    expect(applyScrollDelta(6, 5, 10, 2)).toEqual({
      next: 8,
      consumed: 2,
      residual: 3,
    });
    expect(applyScrollDelta(1, -4, 10, 2)).toEqual({
      next: 0,
      consumed: -1,
      residual: -3,
    });
  });
});
