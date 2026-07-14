// core/sanitize.ts — S-1/S-3. Every string entering the AST passes through here.
// This is the ingestion chokepoint: after this, the pipeline trusts its text.

const STRIP = /[\x00-\x08\x0b-\x1f\x7f\u0080-\u009f\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const PICTO = /\p{Extended_Pictographic}/u;
const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;
const ALLOWED = new Set(["http", "https", "mailto"]);

export type SanitizeOpts = {
  /** Allow file: scheme links (CLI --allow-file-links). */
  allowFile?: boolean;
  /** Document base for relative resolution (handled in href.ts). */
  base?: string;
};

function isControlCodePoint(cp: number): boolean {
  return (
    cp < 0x20 ||
    cp === 0x7f ||
    (cp >= 0x80 && cp <= 0x9f) ||
    cp === 0x200b ||
    cp === 0x200e ||
    cp === 0x200f ||
    (cp >= 0x202a && cp <= 0x202e) ||
    (cp >= 0x2066 && cp <= 0x2069)
  );
}

/**
 * Strip control characters, C1 controls, bidi controls and stray zero-width
 * characters. Keeps \n. In prose mode tabs collapse to a space; in code mode
 * tabs expand to 4 spaces. ZWJ survives only between pictographic neighbors
 * (emoji sequences).
 */
export function sanitizeText(s: string, mode: "prose" | "code" = "prose"): string {
  const chars = Array.from(s);
  let joined = "";
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c === "\u200d") {
      const prev = chars[i - 1] ?? "";
      const next = chars[i + 1] ?? "";
      if (PICTO.test(prev) && PICTO.test(next)) joined += c;
      continue;
    }
    joined += c;
  }
  let out = joined.replace(STRIP, "");
  out = mode === "code" ? out.replace(/\t/g, "    ") : out.replace(/\t/g, " ");
  return out;
}

/**
 * Vet a link target. Returns a safe href or null (drop the link, keep its text).
 * Relative paths and #anchors are allowed; file: only behind the flag.
 */
export function sanitizeHref(href: string, opts: SanitizeOpts = {}): string | null {
  for (const ch of href) {
    const cp = ch.codePointAt(0)!;
    if (isControlCodePoint(cp)) return null;
  }
  const m = SCHEME.exec(href);
  if (!m) return href; // relative or #anchor
  const scheme = m[1].toLowerCase();
  if (ALLOWED.has(scheme)) return href;
  if (scheme === "file" && opts.allowFile) return href;
  return null;
}
