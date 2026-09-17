import { performance } from "node:perf_hooks";
import type { TDoc } from "../core/ast.js";
import type { Diagnostics } from "../core/diagnostics.js";
import type { SanitizeOpts } from "../core/href.js";
import { normalize, normalizeFragment, type NormalizeFragmentContext } from "../core/normalize.js";

export type DocumentFormat = "teml" | "markdown" | "html";
export type CompilationOptions = {
  sanitize?: SanitizeOpts;
  profile?: string;
  onStage?(stage: "parse" | "normalize", milliseconds: number): void;
};
export type DocumentParser = (
  source: string,
  diags: Diagnostics,
  options: CompilationOptions,
) => TDoc;

/** Owns parse/normalize ordering. Full documents and grafted fragments deliberately
 * have different normalization contexts; transport budgets remain with callers. */
export function createDocumentCompiler(parse: DocumentParser) {
  function parsed(source: string, diags: Diagnostics, options: CompilationOptions): TDoc {
    const start = performance.now();
    const doc = parse(source, diags, options);
    options.onStage?.("parse", performance.now() - start);
    return doc;
  }
  return {
    document(source: string, diags: Diagnostics, options: CompilationOptions = {}): TDoc {
      const raw = parsed(source, diags, options);
      const start = performance.now();
      const doc = normalize(raw, diags);
      options.onStage?.("normalize", performance.now() - start);
      return doc;
    },
    fragment(
      source: string,
      diags: Diagnostics,
      options: CompilationOptions = {},
      context: NormalizeFragmentContext = {},
    ) {
      // Metadata belongs to a complete document, never to a mutation fragment.
      return normalizeFragment(parsed(source, diags, options).blocks, diags, context);
    },
  };
}

/** CLI adapter: load only the requested frontend, preserving lazy HTML loading. */
export async function loadDocumentCompiler(format: DocumentFormat) {
  switch (format) {
    case "html": {
      const { htmlToDoc } = await import("../html/index.js");
      return createDocumentCompiler((source, diags, options) => htmlToDoc(source, options, diags));
    }
    case "markdown": {
      const { parseMarkdown } = await import("../markdown/parse.js");
      return createDocumentCompiler(parseMarkdown);
    }
    case "teml": {
      const { parseTeml } = await import("../teml/parse.js");
      return createDocumentCompiler(parseTeml);
    }
  }
}
