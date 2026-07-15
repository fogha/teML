import { describe, expect, test } from "vitest";
import type { DetailedLayout } from "../../src/layout/regions.js";
import { ReaderSession, resolveReaderTarget, type ReaderEffect } from "../../src/reader/session.js";
import type { Capabilities } from "../../src/terminal/capabilities.js";

const caps: Capabilities = {
  colors: "none",
  unicode: true,
  hyperlinks: true,
  width: 30,
  ambiguousWide: false,
};

function detailed(): DetailedLayout {
  return {
    lines: [
      [{ text: "Title", style: {} }],
      [{ text: "alpha", style: {} }],
      [{ text: "local", style: { href: "next.teml" } }],
      [{ text: "external", style: { href: "https://example.test/" } }],
      [{ text: "omega alpha", style: {} }],
      [{ text: "end", style: {} }],
    ],
    links: [
      { id: "link-1", href: "next.teml", row: 2, colStart: 0, colEnd: 5, label: "local" },
      {
        id: "link-2",
        href: "https://example.test/",
        row: 3,
        colStart: 0,
        colEnd: 8,
        label: "external",
      },
    ],
    headings: [
      { id: "heading-1", level: 1, row: 0, text: "Title" },
      { id: "heading-2", level: 2, row: 5, text: "End" },
    ],
  };
}

function session(): ReaderSession {
  return new ReaderSession({
    rootPath: "/docs",
    currentPath: "/docs/index.teml",
    title: "Index",
    detailed: detailed(),
    viewport: { cols: 30, rows: 4, statusRows: 1 },
    caps,
  });
}

function effectOf<T extends ReaderEffect["type"]>(
  effects: ReaderEffect[],
  type: T,
): Extract<ReaderEffect, { type: T }> | undefined {
  return effects.find(
    (effect): effect is Extract<ReaderEffect, { type: T }> => effect.type === type,
  );
}

describe("ReaderSession", () => {
  test("scrolls, pages, and clamps at document boundaries", () => {
    const reader = session();
    reader.handle({ type: "key", key: "down" });
    expect(reader.state().scrollRow).toBe(1);
    reader.handle({ type: "key", key: "pageDown" });
    expect(reader.state().scrollRow).toBe(3);
    reader.handle({ type: "key", key: "end" });
    expect(reader.state().scrollRow).toBe(3);
    reader.handle({ type: "key", key: "home" });
    expect(reader.state().scrollRow).toBe(0);
  });

  test("cycles links, keeps focus visible, and requests local navigation", () => {
    const reader = session();
    reader.handle({ type: "key", key: "tab" });
    expect(reader.state().focusedLinkId).toBe("link-1");
    const effects = reader.handle({ type: "key", key: "enter" });
    expect(effectOf(effects, "navigate")).toEqual({
      type: "navigate",
      path: "/docs/next.teml",
      anchor: undefined,
      history: "push",
    });
  });

  test("requires explicit confirmation before external open", () => {
    const reader = session();
    reader.handle({ type: "key", key: "tab" });
    reader.handle({ type: "key", key: "tab" });
    expect(effectOf(reader.handle({ type: "key", key: "enter" }), "openExternal")).toBeUndefined();
    expect(reader.state().mode).toBe("confirmExternal");
    const confirmed = reader.handle({ type: "key", key: "enter" });
    expect(effectOf(confirmed, "openExternal")?.url).toBe("https://example.test/");
  });

  test("incremental search and next result update the viewport", () => {
    const reader = session();
    reader.handle({ type: "char", char: "/" });
    for (const char of "alpha") reader.handle({ type: "char", char });
    expect(reader.state().search?.rows).toEqual([1, 4]);
    reader.handle({ type: "key", key: "enter" });
    reader.handle({ type: "char", char: "n" });
    expect(reader.state().scrollRow).toBe(3);
  });

  test("TOC selection scrolls to a heading", () => {
    const reader = session();
    reader.handle({ type: "char", char: "t" });
    reader.handle({ type: "key", key: "down" });
    reader.handle({ type: "key", key: "enter" });
    expect(reader.state().mode).toBe("document");
    expect(reader.state().scrollRow).toBe(3);
  });

  test("history restores prior document position", () => {
    const reader = session();
    reader.handle({ type: "key", key: "down" });
    reader.setDocument("/docs/next.teml", "Next", detailed(), "push");
    expect(reader.state().historyIndex).toBe(1);
    const back = reader.handle({ type: "char", char: "b" });
    expect(effectOf(back, "navigate")).toMatchObject({
      path: "/docs/index.teml",
      history: "restore",
    });
    reader.setDocument("/docs/index.teml", "Index", detailed(), "restore");
    expect(reader.state().scrollRow).toBe(1);
  });

  test("resize clamps state and emits a full-sized frame", () => {
    const reader = session();
    const effects = reader.handle({ type: "resize", cols: 10, rows: 2 });
    const frame = effectOf(effects, "frame")?.frame;
    expect(frame).toMatchObject({ cols: 10, rows: 2 });
    expect(frame?.lines).toHaveLength(2);
  });

  test("pointer clicks while an overlay is open cannot activate a background link", () => {
    const reader = session();
    reader.handle({ type: "char", char: "t" }); // open TOC overlay
    expect(reader.state().mode).toBe("toc");
    // Row 2/col 0-5 is where "local" (link-1) sits in the document body.
    const effects = reader.handle({ type: "pointer", row: 2, col: 0, button: 0 });
    expect(effectOf(effects, "navigate")).toBeUndefined();
    expect(reader.state().mode).toBe("toc");
  });

  test("mouse wheel while an overlay is open does not move the hidden scroll position", () => {
    const reader = session();
    reader.handle({ type: "char", char: "?" }); // open help overlay
    expect(reader.state().mode).toBe("help");
    reader.handle({ type: "wheel", delta: 1 });
    reader.handle({ type: "key", key: "escape" });
    expect(reader.state().mode).toBe("document");
    expect(reader.state().scrollRow).toBe(0);
  });
});

describe("Reader navigation confinement", () => {
  test("allows local descendants and rejects root escape", () => {
    expect(resolveReaderTarget("chapter/a.teml", "/docs/index.teml", "/docs")).toMatchObject({
      kind: "local",
      path: "/docs/chapter/a.teml",
    });
    expect(resolveReaderTarget("../secret.teml", "/docs/index.teml", "/docs")).toEqual({
      kind: "rejected",
      reason: "link is outside the document root",
    });
  });

  test("separates anchors and external URLs", () => {
    expect(resolveReaderTarget("#install", "/docs/index.teml", "/docs")).toEqual({
      kind: "anchor",
      anchor: "install",
    });
    expect(resolveReaderTarget("https://example.test", "/docs/index.teml", "/docs")).toMatchObject({
      kind: "external",
    });
  });

  test("rejects a malformed URI escape instead of throwing", () => {
    // A stray '%' makes decodeURIComponent throw; one bad link must degrade
    // to a rejection, not crash the whole Reader session.
    expect(resolveReaderTarget("notes%.md", "/docs/index.teml", "/docs")).toEqual({
      kind: "rejected",
      reason: "link target has a malformed URI escape",
    });
  });
});
