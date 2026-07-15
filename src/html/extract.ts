// html/extract.ts — Readability extraction + pre-map cleanup (Milestone 5).

import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import type { Diagnostics } from "../core/diagnostics.js";

const DROP_TAGS = new Set(["script", "style", "noscript", "template", "head", "nav", "footer"]);

function tagName(el: Element): string {
  return el.tagName.toLowerCase();
}

function shouldDrop(el: Element): boolean {
  const tag = tagName(el);
  if (DROP_TAGS.has(tag)) return true;
  if (el.hasAttribute("hidden")) return true;
  if (el.getAttribute("aria-hidden") === "true") return true;
  const style = el.getAttribute("style") ?? "";
  if (/display\s*:\s*none/i.test(style)) return true;
  return false;
}

function removeUnwanted(root: Element): void {
  const toRemove: Element[] = [];
  const walk = (node: Element): void => {
    for (const child of [...node.children]) walk(child);
    if (shouldDrop(node)) toRemove.push(node);
  };
  walk(root);
  for (const el of toRemove) el.remove();
}

function readabilityRoot(document: Document, _diags: Diagnostics): Element | null {
  const clone = document.cloneNode(true) as Document;
  const reader = new Readability(clone);
  const article = reader.parse();
  if (!article?.content) return null;

  const { document: fragDoc } = parseHTML(article.content);
  const page = fragDoc.querySelector("#readability-page-1, .page, article, main, body");
  const root = (page as Element | null) ?? fragDoc.body?.firstElementChild ?? fragDoc.body;
  if (!root) return null;
  removeUnwanted(root);
  return root;
}

function fallbackRoot(document: Document, diags: Diagnostics): Element {
  diags.warnOnce(
    "readability-fallback",
    "Readability could not extract main content; using body/root fallback",
  );
  const body = document.body;
  if (body) {
    removeUnwanted(body);
    if (body.childElementCount > 0 || (body.textContent?.trim() ?? "") !== "") return body;
  }
  const root = document.documentElement;
  if (root) {
    removeUnwanted(root);
    return root;
  }
  throw new Error("HTML document has no extractable root element");
}

export type ExtractOptions = {
  /** When true, map from cleaned body/root instead of Readability (keeps CSS classes). */
  preserveClasses?: boolean;
};

function extractFromBody(document: Document, diags: Diagnostics): Element {
  const body = document.body;
  if (body) {
    removeUnwanted(body);
    if (body.childElementCount > 0 || (body.textContent?.trim() ?? "") !== "") return body;
  }
  return fallbackRoot(document, diags);
}

/** Extract the semantic content root from a parsed document. */
export function extractContent(
  document: Document,
  diags: Diagnostics,
  opts: ExtractOptions = {},
): Element {
  if (opts.preserveClasses) return extractFromBody(document, diags);

  const extracted = readabilityRoot(document, diags);
  if (extracted) return extracted;
  return fallbackRoot(document, diags);
}
