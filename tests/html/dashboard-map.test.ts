import { test, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Diagnostics, inlineText, normalize } from "../../src/core/index.js";
import { parseHtml } from "../../src/html/parse.js";
import { extractContent } from "../../src/html/extract.js";
import { htmlToDocFromRoot } from "../../src/html/map.js";
import { loadProfile } from "../../src/html/profiles/loader.js";

const FIXTURE = join(process.cwd(), "fixtures/html/23-dashboard-elements.html");

function mapHtml(source: string, profile = loadProfile("bootstrap"), diags = new Diagnostics()) {
  const doc = parseHtml(source);
  const root = extractContent(doc, diags, { preserveClasses: true });
  return { doc: normalize(htmlToDocFromRoot(root, { profile }, diags, doc)), diags };
}

test("HTML dashboard fixture: native inline strike, kbd, highlight", async () => {
  const source = await readFile(FIXTURE, "utf8");
  const { doc } = mapHtml(source);
  const para = doc.blocks.find((b) => b.type === "paragraph" && inlineText(b.children).includes("removed"));
  expect(para?.type).toBe("paragraph");
  if (para?.type !== "paragraph") return;

  const strikeTypes = para.children.filter((n) => n.type === "strike");
  expect(strikeTypes.length).toBeGreaterThanOrEqual(3);

  const nested = strikeTypes.find(
    (n) => n.type === "strike" && n.children.some((c) => c.type === "bold"),
  );
  expect(nested?.type).toBe("strike");

  expect(para.children.some((n) => n.type === "span" && n.role === "kbd")).toBe(true);
  expect(para.children.some((n) => n.type === "span" && n.role === "highlight")).toBe(true);
});

test("HTML dashboard fixture: native details and figure containers", async () => {
  const source = await readFile(FIXTURE, "utf8");
  const { doc } = mapHtml(source);

  const details = doc.blocks.find((b) => b.type === "container" && b.name === "details");
  expect(details?.type).toBe("container");
  if (details?.type === "container") {
    expect(details.attrs).toEqual({ open: "true", summary: "Native summary" });
    expect(details.children.some((c) => c.type === "paragraph" && inlineText(c.children).includes("Native details body"))).toBe(
      true,
    );
    expect(JSON.stringify(details.children)).not.toContain("Native summary");
  }

  const figure = doc.blocks.find(
    (b) => b.type === "container" && b.name === "figure" && b.attrs.caption === "Native caption",
  );
  expect(figure?.type).toBe("container");
  if (figure?.type === "container") {
    expect(figure.children.some((c) => inlineText(c.type === "paragraph" ? c.children : []).includes("Native figure body"))).toBe(
      true,
    );
    expect(JSON.stringify(figure.children)).not.toContain("Native caption");
  }
});

test("HTML dashboard fixture: native progress and meter leaves", async () => {
  const source = await readFile(FIXTURE, "utf8");
  const { doc } = mapHtml(source);
  const native = doc.blocks.filter(
    (b) =>
      b.type === "leaf" &&
      b.name === "progress" &&
      (b.attrs.value === "72" || b.attrs.value === "0.6"),
  );
  expect(native).toHaveLength(2);

  const cpu = native[0] as Extract<(typeof native)[0], { type: "leaf" }>;
  expect(cpu.attrs).toMatchObject({ label: "CPU", value: "72", max: "100" });

  const mem = native[1] as Extract<(typeof native)[1], { type: "leaf" }>;
  expect(mem.attrs).toMatchObject({ label: "Memory", value: "0.6", max: "1", role: "warning" });
});

test("HTML dashboard fixture: data-teml bridge copies allowlisted attrs only", async () => {
  const source = await readFile(FIXTURE, "utf8");
  const { doc } = mapHtml(source);

  const grid = doc.blocks.find((b) => b.type === "container" && b.name === "grid");
  expect(grid?.type).toBe("container");
  if (grid?.type === "container") {
    expect(grid.attrs).toEqual({ columns: "3", gap: "2" });
    expect(Object.keys(grid.attrs)).not.toContain("onclick");
  }

  const bridgeDetails = doc.blocks.find(
    (b) => b.type === "container" && b.name === "details" && b.attrs.summary === "Bridge summary",
  );
  expect(bridgeDetails?.type).toBe("container");
  if (bridgeDetails?.type === "container") {
    expect(bridgeDetails.attrs).toEqual({ summary: "Bridge summary", open: "true" });
  }

  const bridgeFigure = doc.blocks.find(
    (b) => b.type === "container" && b.name === "figure" && b.attrs.caption === "Bridge caption",
  );
  expect(bridgeFigure?.type).toBe("container");

  const metric = doc.blocks.find((b) => b.type === "leaf" && b.name === "metric");
  expect(metric?.type).toBe("leaf");
  if (metric?.type === "leaf") {
    expect(metric.attrs).toEqual({ label: "Requests", role: "success", value: "1.2k/s" });
  }

  const progress = doc.blocks.find(
    (b) => b.type === "leaf" && b.name === "progress" && b.attrs.label === "Disk",
  );
  expect(progress?.type).toBe("leaf");
  if (progress?.type === "leaf") {
    expect(progress.attrs).toEqual({ label: "Disk", value: "92", max: "100", role: "error" });
  }

  const event = doc.blocks.find((b) => b.type === "leaf" && b.name === "event");
  expect(event?.type).toBe("leaf");
  if (event?.type === "leaf") {
    expect(event.attrs).toEqual({ time: "09:15", detail: "prod", title: "Deploy finished" });
  }
});

test("HTML dashboard fixture: unknown data-teml flattens with diagnostic", async () => {
  const source = await readFile(FIXTURE, "utf8");
  const { doc, diags } = mapHtml(source);
  expect(diags.all().some((w) => w.code === "unknown-directive" && w.message.includes("unknown-widget"))).toBe(
    true,
  );
  expect(
    doc.blocks.some(
      (b) => b.type === "paragraph" && inlineText(b.children).includes("Flattened unknown directive content"),
    ),
  ).toBe(true);
  expect(doc.blocks.some((b) => b.type === "container" && b.name === "unknown-widget")).toBe(false);
});

test("HTML dashboard fixture: image href safety via processHref", async () => {
  const source = await readFile(FIXTURE, "utf8");
  const { doc, diags } = mapHtml(source);
  expect(diags.all().some((w) => w.code === "link-dropped")).toBe(true);

  const blocked = doc.blocks.find(
    (b) => b.type === "paragraph" && inlineText(b.children).includes("[Image: Blocked chart]"),
  );
  expect(blocked?.type).toBe("paragraph");
  expect(doc.blocks.some((b) => b.type === "leaf" && b.name === "image" && b.attrs.src?.includes("javascript"))).toBe(
    false,
  );

  const inlinePara = doc.blocks.find(
    (b) => b.type === "paragraph" && inlineText(b.children).includes("safe image"),
  );
  expect(inlinePara?.type).toBe("paragraph");
  if (inlinePara?.type === "paragraph") {
    expect(inlinePara.children.some((n) => n.type === "link" && n.href === "https://example.com/icon.png")).toBe(true);
  }
});

test("HTML dashboard fixture: profile span matching still works", async () => {
  const source = await readFile(FIXTURE, "utf8");
  const { doc } = mapHtml(source);
  const para = doc.blocks.find(
    (b) => b.type === "paragraph" && inlineText(b.children).includes("Profile span still maps"),
  );
  expect(para?.type).toBe("paragraph");
  if (para?.type === "paragraph") {
    expect(para.children.some((n) => n.type === "span" && n.role === "success")).toBe(true);
  }
});

test("HTML: data-teml takes precedence over profile container match", () => {
  const html =
    '<div class="card" data-teml="grid" data-columns="2"><p>inside</p></div>';
  const diags = new Diagnostics();
  const doc = parseHtml(html);
  const root = extractContent(doc, diags, { preserveClasses: true });
  const mapped = normalize(htmlToDocFromRoot(root, { profile: loadProfile("bootstrap") }, diags, doc));
  const grid = mapped.blocks.find((b) => b.type === "container" && b.name === "grid");
  expect(grid?.type).toBe("container");
  expect(mapped.blocks.some((b) => b.type === "container" && b.name === "card")).toBe(false);
});

test("HTML: inline del/s/mark/kbd unit mappings", () => {
  const html = "<p><del>a</del><kbd>b</kbd><mark>c</mark></p>";
  const diags = new Diagnostics();
  const doc = parseHtml(html);
  const root = extractContent(doc, diags, { preserveClasses: true });
  const mapped = normalize(htmlToDocFromRoot(root, {}, diags, doc));
  const para = mapped.blocks[0];
  expect(para?.type).toBe("paragraph");
  if (para?.type !== "paragraph") return;
  expect(para.children).toEqual([
    { type: "strike", children: [{ type: "text", value: "a" }] },
    { type: "span", role: "kbd", children: [{ type: "text", value: "b" }] },
    { type: "span", role: "highlight", children: [{ type: "text", value: "c" }] },
  ]);
});
