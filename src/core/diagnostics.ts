// core/diagnostics.ts — warnings accumulate here and are printed to stderr by
// the CLI. No stage ever writes to stdout except the final backend.

export type Warning = { code: string; message: string; line?: number };

export class Diagnostics {
  private items: Warning[] = [];
  private onceKeys = new Set<string>();

  warn(code: string, message: string, line?: number): void {
    this.items.push({ code, message, line });
  }

  /** Emit at most one warning per code (optionally scoped by line). */
  warnOnce(code: string, message: string, line?: number): void {
    const key = line != null ? `${code}:${line}` : code;
    if (this.onceKeys.has(key)) return;
    this.onceKeys.add(key);
    this.warn(code, message, line);
  }

  all(): readonly Warning[] {
    return this.items;
  }

  count(): number {
    return this.items.length;
  }

  hasWarnings(): boolean {
    return this.items.length > 0;
  }

  has(code: string): boolean {
    return this.items.some((w) => w.code === code);
  }

  clear(): void {
    this.items = [];
    this.onceKeys.clear();
  }

  print(stream: NodeJS.WritableStream = process.stderr): void {
    for (const w of this.items) {
      const at = w.line != null ? ` (line ${w.line})` : "";
      stream.write(`teml: warning: ${w.message}${at}\n`);
    }
  }
}
