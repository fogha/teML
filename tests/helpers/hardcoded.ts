#!/usr/bin/env tsx
// tests/helpers/hardcoded.ts — hand-built AST demo (Milestone 2). No parser required.

import { pathToFileURL } from "node:url";

import { doc, text, type Block, type Inline, type TDoc } from "../../src/core/ast.js";
import { Diagnostics } from "../../src/core/diagnostics.js";
import { layoutDocument } from "../../src/layout/layout.js";
import { renderAnsi } from "../../src/render/ansi.js";
import { detectCapabilities } from "../../src/terminal/capabilities.js";
import { applyMetaRoles, loadTheme } from "../../src/terminal/theme.js";

export function buildDemoDoc(): TDoc {
  const paragraph: Inline[] = [
    text("Deployment finished in "),
    { type: "bold", children: [text("4m 12s")] },
    text(" with status "),
    { type: "span", role: "success", children: [text("Passed")] },
    text(". See "),
    { type: "code", value: "deploy.log" },
    text(" or the "),
    {
      type: "link",
      href: "https://ops.example.com",
      children: [text("dashboard")],
    },
    text(" for "),
    { type: "span", role: "status", children: [text("live metrics")] },
    text("."),
  ];

  const cardChildren: Block[] = [
    {
      type: "list",
      ordered: false,
      start: 1,
      items: [
        { blocks: [{ type: "paragraph", children: [text("12 containers updated")] }] },
        { blocks: [{ type: "paragraph", children: [text("0 failed health checks")] }] },
        {
          blocks: [
            {
              type: "list",
              ordered: true,
              start: 1,
              items: [{ blocks: [{ type: "paragraph", children: [text("nested detail item")] }] }],
            },
          ],
        },
        { blocks: [{ type: "paragraph", children: [text("3 warnings in eu-west-1")] }] },
      ],
    },
  ];

  return doc(
    [
      { type: "heading", level: 1, children: [text("Deploy Report")] },
      { type: "paragraph", children: paragraph },
      {
        type: "container",
        name: "card",
        attrs: { title: "Summary" },
        children: cardChildren,
      },
      {
        type: "container",
        name: "warning",
        attrs: {},
        children: [
          {
            type: "paragraph",
            children: [text("One replica took longer than expected to become healthy.")],
          },
        ],
      },
      {
        type: "codeBlock",
        language: "bash",
        value: "teml view report.teml --theme dark",
      },
      {
        type: "leaf",
        name: "kv",
        attrs: { Cluster: "prod-eu-1", Duration: "4m12s", Operator: "ci-bot" },
      },
      { type: "leaf", name: "break", attrs: {} },
      {
        type: "quote",
        children: [
          { type: "paragraph", children: [text("Deploys are boring now. That is the point.")] },
        ],
      },
    ],
    { title: "Deploy Report", theme: "dark" },
  );
}

function main(): void {
  const diags = new Diagnostics();
  const docNode = buildDemoDoc();
  const caps = detectCapabilities({ color: true });
  const theme = applyMetaRoles(loadTheme("dark", diags), docNode.meta, diags);
  const lines = layoutDocument(docNode, { width: caps.width, theme, caps, diags });
  process.stdout.write(renderAnsi(lines, caps));
  diags.print();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
