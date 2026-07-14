// cli/commands/convert.ts — convert between formats.

import type { TDoc } from "../../core/index.js";
import type { Diagnostics } from "../../core/diagnostics.js";
import { serializeTeml } from "../../teml/serialize.js";
import { serializeMarkdown } from "../../markdown/serialize.js";
import { runRender } from "./render.js";
import type { Capabilities } from "../../terminal/capabilities.js";

export type ConvertTo = "teml" | "markdown" | "text" | "json";

export type ConvertOpts = {
  to: ConvertTo;
  diags: Diagnostics;
  width?: number;
  caps?: Capabilities;
  wrapCode?: boolean;
};

export function runConvert(doc: TDoc, opts: ConvertOpts): string {
  switch (opts.to) {
    case "json":
      return JSON.stringify(doc, null, 2) + "\n";
    case "markdown":
      return serializeMarkdown(doc, opts.diags);
    case "text":
      return runRender(doc, {
        width: opts.width ?? 80,
        caps: opts.caps ?? {
          colors: "none",
          unicode: true,
          hyperlinks: false,
          width: opts.width ?? 80,
          ambiguousWide: false,
          showUrls: true,
        },
        diags: opts.diags,
        wrapCode: opts.wrapCode,
      });
    case "teml":
    default:
      return serializeTeml(doc);
  }
}
