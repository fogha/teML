// cli/run.ts — shared pipeline for all commands (lazy imports, debug timings).

import { readFileSync } from "node:fs";
import { parseSeaUri, readSeaAsset } from "../sea/runtime.js";
import { performance } from "node:perf_hooks";
import type { TDoc } from "../core/index.js";
import type { SanitizeOpts } from "../core/href.js";
import type { CliFlags } from "./options.js";

export type CommandName = "view" | "convert" | "inspect" | "render";

function debugLog(flags: CliFlags, stage: string, ms: number): void {
  if (!flags.debug) return;
  process.stderr.write(`teml: debug: ${stage} ${ms.toFixed(2)}ms\n`);
}

/** Read a file, or stdin when `file` is omitted or `-`. Shared by every command, including `run`. */
export function readInput(file?: string): { source: string; name: string } {
  if (!file || file === "-") {
    return { source: readFileSync(0, "utf8"), name: "<stdin>" };
  }
  const seaKey = parseSeaUri(file);
  if (seaKey) {
    return { source: readSeaAsset(seaKey), name: seaKey };
  }
  return { source: readFileSync(file, "utf8"), name: file };
}

export function inferFormat(source: string, name: string): "teml" | "markdown" | "html" {
  const lower = name.toLowerCase();
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (/^\s*(<!doctype|<html)/i.test(source)) return "html";
  return "teml";
}

/**
 * Write a command's output. A downstream reader that exits early
 * (`teml view doc.teml | head -c1`) closes the pipe, and the resulting EPIPE
 * arrives either from `write` directly or as a stream `error` event. Both mean
 * "the reader has what it wanted", not a failure, so neither may surface as an
 * unhandled exception and a silent exit 2.
 */
function writeOutput(text: string): Promise<void> {
  const stream = process.stdout;
  if (stream.listenerCount("error") === 0) {
    stream.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EPIPE") return;
      process.stderr.write(`teml: error: cannot write output: ${error.message}\n`);
    });
  }
  return new Promise<void>((resolve, reject) => {
    // Resolve only once the chunk has been handed to the operating system. The
    // CLI exits immediately afterwards, and `process.exit()` while a pipe write
    // is still buffered silently truncates the output at the pipe buffer size.
    const done = (error?: Error | null): void => {
      if (error && (error as NodeJS.ErrnoException).code !== "EPIPE") reject(error);
      else resolve();
    };
    try {
      stream.write(text, done);
    } catch (error) {
      done(error as Error);
    }
  });
}

export function sanitizeOpts(flags: CliFlags): SanitizeOpts {
  return {
    allowFile: flags.allowFileLinks,
    base: flags.base,
  };
}

export async function toDoc(
  source: string,
  name: string,
  flags: CliFlags,
): Promise<{ doc: TDoc; diags: import("../core/diagnostics.js").Diagnostics }> {
  const { Diagnostics } = await import("../core/diagnostics.js");
  const { loadDocumentCompiler } = await import("../document/compiler.js");
  const diags = new Diagnostics();
  const fmt = flags.from ?? inferFormat(source, name);
  const compiler = await loadDocumentCompiler(fmt);
  const doc = compiler.document(source, diags, {
    profile: flags.profile,
    sanitize: sanitizeOpts(flags),
    onStage: (stage, ms) => debugLog(flags, stage === "parse" ? `parse(${fmt})` : stage, ms),
  });
  return { doc, diags };
}

export async function execute(
  command: CommandName,
  file: string | undefined,
  flags: CliFlags,
): Promise<number> {
  let input;
  const tRead = performance.now();
  try {
    input = readInput(file);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`teml: error: cannot read ${file ?? "input"}: ${msg}\n`);
    return 1;
  }
  debugLog(flags, "read", performance.now() - tRead);

  let doc: TDoc;
  let diags: import("../core/diagnostics.js").Diagnostics;
  try {
    ({ doc, diags } = await toDoc(input.source, input.name, flags));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`teml: error: parse failed: ${msg}\n`);
    return 1;
  }

  if (flags.width != null && flags.width < 20) {
    diags.warn("narrow-width", `layout width ${flags.width} is below recommended minimum 20`);
  }

  const { detectCapabilities } = await import("../terminal/capabilities.js");
  const { loadTheme, loadDocumentTheme, applyMetaRoles } = await import("../terminal/theme.js");
  const caps = detectCapabilities({
    width: flags.width,
    color: flags.color,
    ascii: flags.ascii,
    ambiguousWide: flags.ambiguousWide,
    showUrls: flags.showUrls,
  });
  const baseTheme = flags.theme
    ? loadTheme(flags.theme, diags)
    : loadDocumentTheme(doc.meta.theme, diags);
  const theme = applyMetaRoles(baseTheme, doc.meta, diags);
  const layoutOpts = {
    width: caps.width,
    theme,
    caps,
    diags,
    wrapCode: flags.wrapCode,
    showUrls: flags.showUrls,
  };

  const tOut = performance.now();
  switch (command) {
    case "view": {
      const { runView } = await import("./commands/view.js");
      await writeOutput(runView(doc, layoutOpts));
      break;
    }
    case "render": {
      const { runRender } = await import("./commands/render.js");
      await writeOutput(
        runRender(doc, {
          // Use the clamped capability width, as `view` does: a raw --width can
          // otherwise be far above MAX_TERMINAL_DIMENSION and stall for minutes.
          width: caps.width,
          caps,
          diags,
          wrapCode: flags.wrapCode,
        }),
      );
      break;
    }
    case "convert": {
      const { runConvert } = await import("./commands/convert.js");
      await writeOutput(
        runConvert(doc, {
          to: flags.to ?? "teml",
          diags,
          width: caps.width,
          caps,
          wrapCode: flags.wrapCode,
        }),
      );
      break;
    }
    case "inspect": {
      const { runInspect } = await import("./commands/inspect.js");
      await writeOutput(
        runInspect(doc, {
          ast: flags.ast,
          tokens: flags.tokens,
          renderTokens: flags.renderTokens,
          layout: layoutOpts,
        }),
      );
      break;
    }
  }
  debugLog(flags, command, performance.now() - tOut);

  diags.print();
  return 0;
}
