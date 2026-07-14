// html/parse.ts — standards-tolerant HTML parse via parse5 + linkedom (Milestone 5).

import { parse, serialize } from "parse5";
import { parseHTML } from "linkedom";

/** Parse HTML into a linkedom Document (WHATWG-tolerant via parse5). */
export function parseHtml(source: string): Document {
  const normalized = source.replace(/\r\n?/g, "\n");
  const tree = parse(normalized);
  const html = serialize(tree);
  const { document } = parseHTML(html);
  return document as Document;
}
