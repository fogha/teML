// Public library surface for TeML v1.

export * from "./core/index.js";
export { parseTeml, parseInline, parseToMdast } from "./teml/parse.js";
export { serializeTeml } from "./teml/serialize.js";
export { parseMarkdown, parseMarkdownToMdast } from "./markdown/parse.js";
export { serializeMarkdown } from "./markdown/serialize.js";
export { htmlToDoc } from "./html/index.js";
export { layoutDocument } from "./layout/layout.js";
export {
  layoutDocumentDetailed,
  collectLinkRegions,
  linkAt,
  nextLink,
  type DetailedLayout,
  type HeadingRegion,
  type LinkRegion,
} from "./layout/regions.js";
export type { LayoutOpts } from "./layout/opts.js";
export { renderAnsi } from "./render/ansi.js";
export { renderPlain } from "./render/plain.js";
export { renderSpeech } from "./render/speech.js";
export type { Line, Span } from "./render/styledLine.js";
export {
  detectCapabilities,
  colorsEnabled,
  type Capabilities,
  type CapOverrides,
  type ColorMode,
} from "./terminal/capabilities.js";
export {
  applyMetaRoles,
  loadTheme,
  resolveRole,
  type Style,
  type Theme,
} from "./terminal/theme.js";
