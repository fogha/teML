// cli/run.ts — shared pipeline for all commands (lazy imports, debug timings).

import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import type { TDoc } from "../core/index.js";
import type { SanitizeOpts } from "../core/href.js";
import type { CliFlags } from "./options.js";

export type CommandName = "view" | "convert" | "inspect" | "render";

function debugLog(flags: CliFlags, stage: string, ms: number): void {
  if (!flags.debug) return;
  process.stderr.write(`teml: debug: ${stage} ${ms.toFixed(2)}ms\n`);
}

function readInput(file?: string): { source: string; name: string } {
  if (!file || file === "-") {
    return { source: readFileSync(0, "utf8"), name: "<stdin>" };
  }
  return { source: readFileSync(file, "utf8"), name: file };
}

function inferFormat(source: string, name: string): "teml" | "markdown" | "html" {
  const lower = name.toLowerCase();
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (/^\s*(<!doctype|<html)/i.test(source)) return "html";
  return "teml";
}

function sanitizeOpts(flags: CliFlags): SanitizeOpts {
  return {
    allowFile: flags.allowFileLinks,
    base: flags.base,
  };
}

async function toDoc(
  source: string,
  name: string,
  flags: CliFlags,
): Promise<{ doc: TDoc; diags: import("../core/diagnostics.js").Diagnostics }> {
  const { Diagnostics, normalize } = await import("../core/index.js");
  const diags = new Diagnostics();
  const fmt = flags.from ?? inferFormat(source, name);
  const parseCtx = { sanitize: sanitizeOpts(flags) };
  let raw: TDoc;
  const t0 = performance.now();
  switch (fmt) {
    case "html": {
      const { htmlToDoc } = await import("../html/index.js");
      raw = htmlToDoc(source, { profile: flags.profile, sanitize: parseCtx.sanitize }, diags);
      break;
    }
    case "markdown": {
      const { parseMarkdown } = await import("../markdown/parse.js");
      raw = parseMarkdown(source, diags, parseCtx);
      break;
    }
    case "teml":
    default: {
      const { parseTeml } = await import("../teml/parse.js");
      raw = parseTeml(source, diags, parseCtx);
      break;
    }
  }
  debugLog(flags, `parse(${fmt})`, performance.now() - t0);
  const t1 = performance.now();
  const doc = normalize(raw, diags);
  debugLog(flags, "normalize", performance.now() - t1);
  return { doc, diags };
}

export async function execute(command: CommandName, file: string | undefined, flags: CliFlags): Promise<number> {
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
  const { loadTheme, applyMetaRoles } = await import("../terminal/theme.js");
  const caps = detectCapabilities({
    width: flags.width,
    color: flags.color,
    ascii: flags.ascii,
    ambiguousWide: flags.ambiguousWide,
    showUrls: flags.showUrls,
  });
  const baseTheme = loadTheme(flags.theme ?? doc.meta.theme ?? "auto", diags);
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
      process.stdout.write(runView(doc, layoutOpts));
      break;
    }
    case "render": {
      const { runRender } = await import("./commands/render.js");
      process.stdout.write(
        runRender(doc, {
          width: flags.width ?? 80,
          caps,
          diags,
          wrapCode: flags.wrapCode,
        }),
      );
      break;
    }
    case "convert": {
      const { runConvert } = await import("./commands/convert.js");
      process.stdout.write(
        runConvert(doc, {
          to: flags.to ?? "teml",
          diags,
          width: flags.width ?? 80,
          caps,
          wrapCode: flags.wrapCode,
        }),
      );
      break;
    }
    case "inspect": {
      const { runInspect } = await import("./commands/inspect.js");
      process.stdout.write(
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
