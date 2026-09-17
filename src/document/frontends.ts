// Synchronous sessions need all frontends available for commands immediately.
// CLI callers use loadDocumentCompiler instead, avoiding eager HTML startup.
import { htmlToDoc } from "../html/index.js";
import { parseMarkdown } from "../markdown/parse.js";
import { parseTeml } from "../teml/parse.js";
import { createDocumentCompiler, type DocumentFormat } from "./compiler.js";

export const documentCompilers = {
  teml: createDocumentCompiler(parseTeml),
  markdown: createDocumentCompiler(parseMarkdown),
  html: createDocumentCompiler((source, diags, options) => htmlToDoc(source, options, diags)),
} satisfies Record<DocumentFormat, ReturnType<typeof createDocumentCompiler>>;
