// html/index.ts — HTML → TDoc pipeline (Milestone 5).

import { Diagnostics } from "../core/diagnostics.js";
import type { TDoc } from "../core/ast.js";
import { parseHtml } from "./parse.js";
import { extractContent } from "./extract.js";
import { htmlToDocFromRoot } from "./map.js";
import { loadProfile, type Profile } from "./profiles/loader.js";

import type { SanitizeOpts } from "../core/href.js";

export type HtmlToDocOptions = {
  profile?: string;
  sanitize?: SanitizeOpts;
};

export { parseHtml } from "./parse.js";
export { extractContent } from "./extract.js";
export { htmlToDocFromRoot, htmlToDoc as mapHtmlToDoc } from "./map.js";
export { loadProfile, validateProfile, type Profile } from "./profiles/loader.js";

let defaultProfile: Profile | undefined;

function defaultBootstrapProfile(): Profile {
  if (!defaultProfile) defaultProfile = loadProfile("bootstrap");
  return defaultProfile;
}

export { defaultBootstrapProfile };

function resolveOptions(
  optsOrDiags?: HtmlToDocOptions | Diagnostics,
  maybeDiags?: Diagnostics,
): { opts: HtmlToDocOptions; diags: Diagnostics } {
  if (optsOrDiags instanceof Diagnostics) {
    return { opts: {}, diags: optsOrDiags };
  }
  return { opts: optsOrDiags ?? {}, diags: maybeDiags ?? new Diagnostics() };
}

/** Parse HTML source, extract main content, and map to TDoc. */
export function htmlToDoc(
  source: string,
  optsOrDiags?: HtmlToDocOptions | Diagnostics,
  maybeDiags?: Diagnostics,
): TDoc {
  const { opts, diags } = resolveOptions(optsOrDiags, maybeDiags);
  const document = parseHtml(source);
  const useProfile = opts.profile !== "none";
  const profile = useProfile ? loadProfile(opts.profile ?? "bootstrap") : undefined;
  const root = extractContent(document, diags, { preserveClasses: useProfile });
  return htmlToDocFromRoot(root, { profile, sanitize: opts.sanitize }, diags, document);
}
