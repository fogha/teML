// render/plain.ts — style-free backend. Deterministic; used for snapshots,
// pipes, and --no-color sinks. Contains zero escape bytes by design.

import type { Line } from "../render/styledLine.js";

export function renderPlain(lines: Line[]): string {
  return lines.map((line) => line.map((s) => s.text).join("").replace(/\s+$/, "")).join("\n") + "\n";
}
