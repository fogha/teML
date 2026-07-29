import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  Diagnostics,
  layoutDocument,
  layoutDocumentDetailed,
  loadTheme,
  parseTeml,
  renderPlain,
  renderSpeech,
  serializeTeml,
} from "../../src/index.js";
import { assertNoForeignEsc, runCli, withoutColorEnv } from "./harness.js";

const TEML = join(process.cwd(), "fixtures/teml/10-kitchen-sink.teml");
const MARKDOWN = join(process.cwd(), "fixtures/markdown/10-kitchen-sink.md");
const HTML = join(process.cwd(), "fixtures/html/03-bootstrap.html");
const HOSTILE = join(process.cwd(), "fixtures/teml/15-hostile.teml");

test("a new user can discover, demo, and render with the built CLI", () => {
  const rootHelp = runCli(["--help"]);
  const runHelp = runCli(["run", "--help"]);
  const version = runCli(["--version"]);
  const demo = runCli(["demo", "--width", "80", "--no-color"]);
  const explicit = runCli(["view", TEML, "--width", "80", "--no-color"]);
  const implicit = runCli([TEML, "--width", "80", "--no-color"]);
  const redirected = runCli(["view", TEML, "--width", "80"], {
    env: withoutColorEnv(),
  });
  const renderA = runCli(["render", TEML, "--width", "80"]);
  const renderB = runCli(["render", TEML, "--width", "80"]);

  expect(rootHelp.status).toBe(0);
  expect(rootHelp.stdout).toContain("Static output");
  expect(rootHelp.stdout).toContain("Reader");
  expect(rootHelp.stdout).toContain("App runtime");
  expect(runHelp.stdout).toContain("--frames");
  expect(runHelp.stdout).toContain('"type":"resize"');
  expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  expect(demo).toMatchObject({ status: 0, stderr: "" });
  expect(demo.stdout).toMatch(/deploy report/i);
  expect(demo.stdout).not.toContain("\x1b");
  expect(explicit.status).toBe(0);
  expect(explicit.stdout).toMatch(/kitchen sink/i);
  expect(implicit.stdout).toBe(explicit.stdout);
  expect(redirected.stdout).not.toContain("\x1b");
  expect(renderA.stdout).toBe(renderB.stdout);
});

test("documents move through Markdown, HTML, TeML, JSON, speech, and token views", () => {
  const markdownToTeml = runCli(["convert", MARKDOWN, "--to", "teml"]);
  expect(markdownToTeml.status).toBe(0);
  expect(markdownToTeml.stdout).toContain("# Kitchen Sink");

  const convertedJson = runCli(["convert", "--from", "teml", "--to", "json"], {
    input: markdownToTeml.stdout,
  });
  const convertedDoc = JSON.parse(convertedJson.stdout) as {
    blocks: Array<{ type: string }>;
  };
  expect(convertedDoc.blocks.length).toBeGreaterThan(3);
  expect(convertedDoc.blocks.some((block) => block.type === "table")).toBe(true);
  expect(convertedDoc.blocks.some((block) => block.type === "codeBlock")).toBe(true);

  const htmlToTeml = runCli(["convert", HTML, "--to", "teml"]);
  expect(htmlToTeml.status).toBe(0);
  expect(htmlToTeml.stdout).toContain(":::");
  const htmlView = runCli(["--from", "teml", "--width", "60", "--no-color"], {
    input: htmlToTeml.stdout,
  });
  expect(htmlView.status).toBe(0);
  expect(htmlView.stdout.length).toBeGreaterThan(100);
  expect(htmlView.stdout).not.toContain("\x1b");

  const markdown = runCli(["convert", TEML, "--to", "markdown"]);
  const speech = runCli(["convert", TEML, "--to", "speech"]);
  const text = runCli(["convert", TEML, "--to", "text", "--width", "80"]);
  const markdownView = runCli(["view", MARKDOWN, "--width", "80", "--no-color"]);
  const tokensA = runCli(["inspect", TEML, "--render-tokens", "--width", "60"]);
  const tokensB = runCli(["inspect", TEML, "--render-tokens", "--width", "60"]);
  expect(markdown.stdout).toContain("# Kitchen Sink");
  expect(markdown.stdout).not.toContain(":::card");
  expect(speech.stdout).toContain("Heading level 1: Kitchen Sink");
  expect(speech.stdout).not.toContain("\x1b");
  expect(text.stdout.length).toBeGreaterThan(20);
  expect(text.stdout).not.toContain("\x1b");
  expect(markdownView.status).toBe(0);
  expect(markdownView.stdout).toContain("KITCHEN SINK");
  expect(tokensA.stdout).toBe(tokensB.stdout);
  expect(tokensA.stdout).toContain("render_start");
  expect(tokensA.stdout).toContain("span text=");
});

test("hostile input stays inert and CLI failures remain machine-readable", () => {
  const hostile = runCli(["render", HOSTILE, "--width", "80"], {
    env: withoutColorEnv(),
  });
  expect(hostile.status).toBe(0);
  expect(hostile.stdout).not.toContain("teml: warning:");
  expect(hostile.stderr).toContain("teml: warning:");
  assertNoForeignEsc(hostile.stdout);

  const hostileHtml = runCli(["--from", "html", "--width", "40", "--no-color"], {
    input: "<script>alert(1)</script><h1>Safe</h1><p>\x1b[2J body</p>",
  });
  expect(hostileHtml.status).toBe(0);
  expect(hostileHtml.stdout).toContain("SAFE");
  expect(hostileHtml.stdout).not.toContain("alert(1)");
  expect(hostileHtml.stdout).not.toContain("\x1b");

  const colored = runCli(["view", TEML, "--width", "80", "--color"], {
    env: withoutColorEnv(),
  });
  const noColor = runCli(["view", TEML, "--width", "80", "--color"], {
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "1" },
  });
  expect(colored.stdout).toContain("\x1b");
  expect(noColor.stdout).not.toContain("\x1b");

  const missing = runCli(["view", "missing-file-xyz.teml"]);
  const badFlag = runCli(["view", TEML, "--not-a-flag"]);
  expect(missing).toMatchObject({ status: 1, stdout: "" });
  expect(missing.stderr).toMatch(/cannot read|ENOENT/i);
  expect(badFlag.status).toBe(2);
  expect(badFlag.stderr).toContain("teml: error: unknown option");
  expect(badFlag.stderr).not.toContain("error: error:");

  const dir = mkdtempSync(join(tmpdir(), "teml-system-link-"));
  try {
    const file = join(dir, "link.teml");
    writeFileSync(file, "[local](./sibling.txt)\n");
    const allowed = runCli(["inspect", file, "--allow-file-links"]);
    expect(allowed.status).toBe(0);
    expect(allowed.stdout).toContain("sibling.txt");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const urls = runCli([
    "render",
    join(process.cwd(), "fixtures/teml/12-links-images.teml"),
    "--width",
    "80",
    "--show-urls",
  ]);
  const debug = runCli(["view", TEML, "--width", "80", "--debug"]);
  expect(urls.stdout).toMatch(/https?:\/\//);
  expect(debug.stderr).toContain("teml: debug:");
});

test("the public API completes the same parse-layout-render pipeline", () => {
  const diags = new Diagnostics();
  const document = parseTeml("# Public API\n\nA [link](https://example.test).\n", diags);
  expect(serializeTeml(document)).toContain("# Public API");

  const caps = {
    colors: "none" as const,
    unicode: false,
    hyperlinks: false,
    width: 40,
    ambiguousWide: false,
  };
  const options = {
    width: 40,
    theme: loadTheme("mono"),
    caps,
    diags,
  };
  const plain = renderPlain(layoutDocument(document, options));
  const detailed = layoutDocumentDetailed(document, options);

  expect(plain).toContain("PUBLIC API");
  expect(detailed.headings[0]).toMatchObject({ level: 1, text: "Public API" });
  expect(detailed.links[0]).toMatchObject({ href: "https://example.test" });
  expect(renderSpeech(document)).toContain("Heading level 1: Public API");
});
