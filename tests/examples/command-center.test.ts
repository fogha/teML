import { test, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Block, TDoc } from "../../src/core/ast.js";
import { Diagnostics, inlineText, normalize } from "../../src/core/index.js";
import { htmlToDoc } from "../../src/html/index.js";
import { parseTeml } from "../../src/teml/parse.js";
import { snapshotRender } from "../snapshot.js";

const ROOT = join(process.cwd(), "examples/markup");
const TEML_FILE = join(ROOT, "service-command-center.teml");
const HTML_FILE = join(ROOT, "service-command-center.html");

function sortedAttrs(attrs: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(attrs).sort()) out[key] = attrs[key]!;
  return out;
}

function collectLeaves(doc: TDoc, name: string): Array<Record<string, string>> {
  const leaves: Array<Record<string, string>> = [];
  function walk(blocks: Block[]): void {
    for (const b of blocks) {
      if (b.type === "leaf" && b.name === name) leaves.push(sortedAttrs(b.attrs));
      if (b.type === "container") walk(b.children);
    }
  }
  walk(doc.blocks);
  return leaves;
}

function collectContainers(doc: TDoc, name: string): Array<Record<string, string>> {
  const nodes: Array<Record<string, string>> = [];
  function walk(blocks: Block[]): void {
    for (const b of blocks) {
      if (b.type === "container" && b.name === name) nodes.push(sortedAttrs(b.attrs));
      if (b.type === "container") walk(b.children);
    }
  }
  walk(doc.blocks);
  return nodes;
}

test("command-center HTML terminal snapshot @ width 100", async () => {
  const source = await readFile(HTML_FILE, "utf8");
  const doc = normalize(htmlToDoc(source, new Diagnostics()));
  const out = snapshotRender(doc, 100, "plain", "mono");
  await expect(out).toMatchFileSnapshot("snapshots/service-command-center-100.txt");
});

test("command-center TeML terminal snapshot @ width 100", async () => {
  const source = await readFile(TEML_FILE, "utf8");
  const doc = normalize(parseTeml(source, new Diagnostics()));
  const out = snapshotRender(doc, 100, "plain", "mono");
  await expect(out).toMatchFileSnapshot("snapshots/service-command-center-teml-100.txt");
});

test("command-center TeML/HTML semantic parity at node-kind level", async () => {
  const diags = new Diagnostics();
  const temlDoc = normalize(parseTeml(await readFile(TEML_FILE, "utf8"), diags));
  const htmlDoc = normalize(htmlToDoc(await readFile(HTML_FILE, "utf8"), diags));

  expect(collectContainers(temlDoc, "grid")).toEqual(collectContainers(htmlDoc, "grid"));
  expect(collectLeaves(temlDoc, "metric")).toEqual(collectLeaves(htmlDoc, "metric"));
  expect(collectLeaves(temlDoc, "event")).toEqual(collectLeaves(htmlDoc, "event"));

  const temlProgress = collectLeaves(temlDoc, "progress").map(({ label, value, max }) => ({
    label,
    value,
    max,
  }));
  const htmlProgress = collectLeaves(htmlDoc, "progress").map(({ label, value, max }) => ({
    label,
    value,
    max,
  }));
  expect(htmlProgress).toEqual(temlProgress);

  const temlTable = temlDoc.blocks.find((b) => b.type === "table" && b.rows.length === 6);
  const htmlTable = htmlDoc.blocks.find((b) => b.type === "table" && b.rows.length === 6);
  expect(temlTable?.type).toBe("table");
  expect(htmlTable?.type).toBe("table");
  if (temlTable?.type === "table" && htmlTable?.type === "table") {
    expect(htmlTable.rows.map((r) => r.cells.map(inlineText))).toEqual(
      temlTable.rows.map((r) => r.cells.map(inlineText)),
    );
  }

  const temlTasks = temlDoc.blocks.find(
    (b) => b.type === "list" && b.items.some((i) => i.checked != null),
  );
  const htmlTasks = htmlDoc.blocks.find(
    (b) => b.type === "list" && b.items.some((i) => i.checked != null),
  );
  expect(temlTasks?.type).toBe("list");
  expect(htmlTasks?.type).toBe("list");
  if (temlTasks?.type === "list" && htmlTasks?.type === "list") {
    expect(htmlTasks.items.map((i) => i.checked)).toEqual(temlTasks.items.map((i) => i.checked));
  }

  const temlDetails = collectContainers(temlDoc, "details")[0];
  const htmlDetails = collectContainers(htmlDoc, "details")[0];
  expect(htmlDetails).toEqual(temlDetails);

  const temlFigure = collectContainers(temlDoc, "figure")[0];
  const htmlFigure = collectContainers(htmlDoc, "figure")[0];
  expect(htmlFigure).toEqual(temlFigure);

  const temlIntro = temlDoc.blocks.find(
    (b) => b.type === "paragraph" && inlineText(b.children).includes("canary lane"),
  );
  const htmlIntro = htmlDoc.blocks.find(
    (b) => b.type === "paragraph" && inlineText(b.children).includes("canary lane"),
  );
  expect(temlIntro?.type).toBe("paragraph");
  expect(htmlIntro?.type).toBe("paragraph");
  if (temlIntro?.type === "paragraph" && htmlIntro?.type === "paragraph") {
    expect(htmlIntro.children.some((n) => n.type === "span" && n.role === "highlight")).toBe(true);
    expect(temlIntro.children.some((n) => n.type === "span" && n.role === "highlight")).toBe(true);
    expect(htmlIntro.children.some((n) => n.type === "strike")).toBe(true);
    expect(temlIntro.children.some((n) => n.type === "strike")).toBe(true);
  }
});
