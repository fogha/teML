import { test, expect } from "vitest";
import { renderPlain } from "../../src/render/plain.js";

// The plain backend is a terminal sink too: it must not pass a control byte
// through as text, whatever ingress produced it.
test("renderPlain strips control bytes from span text", () => {
  const out = renderPlain([[{ text: "safe\x1b[31mred\x07", style: {} }]]);
  expect(out).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f]/);
  expect(out).toBe("safe[31mred\n");
});
