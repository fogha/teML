import { spawn } from "node:child_process";
import { lstatSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { doc, text, type TDoc } from "../../core/ast.js";
import { Diagnostics } from "../../core/diagnostics.js";
import { isWindowsDrivePath } from "../../core/href.js";
import { layoutDocumentDetailed } from "../../layout/regions.js";
import type { LayoutOpts } from "../../layout/opts.js";
import { ReaderSession, type ReaderEffect } from "../../reader/session.js";
import { detectCapabilities, type Capabilities } from "../../terminal/capabilities.js";
import { createTerminalDriver, type TerminalDriver } from "../../terminal/client/driver.js";
import type { TerminalInputEvent } from "../../terminal/client/input.js";
import type { TerminalReadable, TerminalWritable } from "../../terminal/client/lifecycle.js";
import {
  applyMetaRoles,
  loadDocumentTheme,
  loadTheme,
  resolveRole,
  type Theme,
} from "../../terminal/theme.js";
import { toDoc } from "../run.js";
import type { CliFlags } from "../options.js";

const READER_EXTENSIONS = new Set([".teml", ".md", ".markdown", ".html", ".htm"]);

type LoadedDocument = {
  path: string;
  title: string;
  doc: TDoc;
  diags: Diagnostics;
};

export type ReadRuntimeOptions = {
  input?: TerminalReadable;
  output?: TerminalWritable;
  error?: NodeJS.WritableStream;
  env?: NodeJS.ProcessEnv;
  openExternal?: (url: string) => Promise<void>;
};

function directoryDocument(directory: string, root: string): TDoc {
  const blocks: TDoc["blocks"] = [
    { type: "heading", level: 1, children: [text(path.basename(directory) || directory)] },
  ];
  if (directory !== root) {
    blocks.push({
      type: "paragraph",
      children: [
        {
          type: "link",
          href: path.dirname(directory),
          children: [text("← Parent directory")],
        },
      ],
    });
  }
  const entries = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => {
      const absolute = path.join(directory, entry.name);
      if (lstatSync(absolute).isSymbolicLink()) return false;
      return (
        entry.isDirectory() ||
        (entry.isFile() && READER_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
      );
    })
    .sort(
      (a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name),
    );

  for (const entry of entries) {
    blocks.push({
      type: "paragraph",
      children: [
        {
          type: "link",
          href: path.join(directory, entry.name),
          children: [text(`${entry.isDirectory() ? "▸ " : "  "}${entry.name}`)],
        },
      ],
    });
  }
  if (entries.length === 0) {
    blocks.push({
      type: "paragraph",
      children: [text("No readable documents in this directory.")],
    });
  }
  return doc(blocks, { title: path.basename(directory) || directory });
}

function explicitRoot(base: string): string {
  if (base.startsWith("file:")) return realpathSync(fileURLToPath(base));
  // The drive letter of "C:\docs" matches the scheme pattern, so it has to be
  // excluded here or --base cannot name an absolute Windows directory.
  if (!isWindowsDrivePath(base) && /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(base)) {
    throw new Error("teml read currently requires a filesystem --base");
  }
  return realpathSync(path.resolve(base));
}

export function externalOpenCommand(
  platform: NodeJS.Platform,
  url: string,
): { file: string; args: string[] } {
  const parsed = new URL(url);
  if (!["http:", "https:", "mailto:"].includes(parsed.protocol)) {
    throw new Error(`unsupported external URL scheme '${parsed.protocol}'`);
  }
  if (platform === "darwin") return { file: "open", args: [parsed.href] };
  if (platform === "win32") return { file: "explorer.exe", args: [parsed.href] };
  return { file: "xdg-open", args: [parsed.href] };
}

function platformOpen(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let command: { file: string; args: string[] };
    try {
      command = externalOpenCommand(process.platform, url);
    } catch (cause) {
      reject(cause);
      return;
    }
    const child = spawn(command.file, command.args, { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

async function loadDocument(
  target: string,
  root: string,
  flags: CliFlags,
): Promise<LoadedDocument> {
  const resolved = realpathSync(path.resolve(target));
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("target is outside the document root");
  }
  const stats = statSync(resolved);
  if (stats.isDirectory()) {
    return {
      path: resolved,
      title: path.basename(resolved) || resolved,
      doc: directoryDocument(resolved, root),
      diags: new Diagnostics(),
    };
  }
  if (!stats.isFile()) throw new Error("target is not a regular file");
  const source = readFileSync(resolved, "utf8");
  // Runtime activation performs fixed-root confinement. Keeping relative hrefs
  // here avoids turning ordinary local links into disabled file: URLs.
  const parsed = await toDoc(source, resolved, { ...flags, base: undefined });
  return {
    path: resolved,
    title: parsed.doc.meta.title ?? path.basename(resolved),
    doc: parsed.doc,
    diags: parsed.diags,
  };
}

function layoutLoaded(
  loaded: LoadedDocument,
  flags: CliFlags,
  caps: Capabilities,
  baseTheme: Theme,
): { detailed: ReturnType<typeof layoutDocumentDetailed>; theme: Theme } {
  const theme = applyMetaRoles(baseTheme, loaded.doc.meta, loaded.diags);
  const opts: LayoutOpts = {
    width: caps.width,
    theme,
    caps,
    diags: loaded.diags,
    wrapCode: flags.wrapCode,
    showUrls: flags.showUrls,
  };
  return { detailed: layoutDocumentDetailed(loaded.doc, opts), theme };
}

export async function executeRead(
  file: string | undefined,
  flags: CliFlags,
  runtime: ReadRuntimeOptions = {},
): Promise<number> {
  const input = runtime.input ?? process.stdin;
  const output = runtime.output ?? process.stdout;
  const error = runtime.error ?? process.stderr;
  if (!file || file === "-") {
    error.write("teml: error: read requires a file or directory; use `teml view` for stdin\n");
    return 2;
  }
  if (!input.isTTY || !output.isTTY) {
    error.write(
      "teml: error: read requires TTY stdin and stdout; use `teml view` for static or piped output\n",
    );
    return 2;
  }

  let initialPath: string;
  let root: string;
  try {
    initialPath = realpathSync(path.resolve(file));
    root = flags.base
      ? explicitRoot(flags.base)
      : statSync(initialPath).isDirectory()
        ? initialPath
        : path.dirname(initialPath);
    const relative = path.relative(root, initialPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("initial document is outside --base");
    }
  } catch (cause) {
    error.write(
      `teml: error: cannot open ${file}: ${cause instanceof Error ? cause.message : String(cause)}\n`,
    );
    return 1;
  }

  let loaded: LoadedDocument;
  try {
    loaded = await loadDocument(initialPath, root, flags);
  } catch (cause) {
    error.write(
      `teml: error: cannot read ${file}: ${cause instanceof Error ? cause.message : String(cause)}\n`,
    );
    return 1;
  }

  let caps = detectCapabilities(
    {
      width: Math.min(flags.width ?? Number.MAX_SAFE_INTEGER, output.columns ?? 80),
      color: flags.color,
      ascii: flags.ascii,
      ambiguousWide: flags.ambiguousWide,
      showUrls: flags.showUrls,
    },
    runtime.env ?? process.env,
    true,
    output.columns,
  );
  const baseTheme = flags.theme
    ? loadTheme(flags.theme, loaded.diags)
    : loadDocumentTheme(loaded.doc.meta.theme, loaded.diags);
  let laidOut = layoutLoaded(loaded, flags, caps, baseTheme);
  const reader = new ReaderSession({
    rootPath: root,
    currentPath: loaded.path,
    title: loaded.title,
    detailed: laidOut.detailed,
    viewport: { cols: caps.width, rows: output.rows ?? 24, statusRows: 1 },
    caps,
    allowFileLinks: flags.allowFileLinks,
    focusStyle: resolveRole(laidOut.theme, "focus", loaded.diags),
    statusStyle: resolveRole(laidOut.theme, "muted", loaded.diags),
  });

  // The Reader owns the alternate screen for the whole session, so parse and
  // layout warnings cannot go to stderr while it runs without corrupting the
  // display. Collect them per visited document and print once the terminal has
  // been restored, which is what docs/cli.md promises.
  const visited = new Set<Diagnostics>([loaded.diags]);
  const printDiagnostics = (): void => {
    const merged = new Diagnostics();
    const seen = new Set<string>();
    for (const diags of visited) {
      for (const warning of diags.all()) {
        // Layout re-runs on every resize against the same Diagnostics, so the
        // same warning can be recorded many times in one session.
        const key = `${warning.code}\u0000${warning.message}\u0000${warning.line ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.warn(warning.code, warning.message, warning.line);
      }
    }
    merged.print(error);
  };

  return new Promise<number>((resolve) => {
    let finished = false;
    // Assigned once below, but referenced by closures defined earlier that
    // only run after the assignment — `const` isn't an option since it
    // requires the initializer at the declaration site.
    // eslint-disable-next-line prefer-const
    let driver: TerminalDriver | undefined;
    let chain = Promise.resolve();

    const finish = (code: number): void => {
      if (finished) return;
      finished = true;
      process.removeListener("uncaughtException", onFatal);
      process.removeListener("unhandledRejection", onFatal);
      // A fatal error can arrive before the driver exists, since the handlers
      // below are registered first.
      driver?.stop();
      printDiagnostics();
      resolve(code);
    };

    // Backstop for failures outside the effect chain (e.g. a malformed input
    // sequence throwing from a raw `data`/timer callback rather than through
    // applyEffects/handleEvent). Restores the terminal before exiting instead
    // of leaving raw mode / the alternate screen engaged — the "catchable
    // uncaught errors" guarantee documented for the Reader boundary.
    const onFatal = (cause: unknown): void => {
      error.write(
        `teml: error: Reader failed: ${cause instanceof Error ? cause.message : String(cause)}\n`,
      );
      finish(1);
    };
    process.on("uncaughtException", onFatal);
    process.on("unhandledRejection", onFatal);

    const applyEffects = async (effects: ReaderEffect[]): Promise<void> => {
      for (const effect of effects) {
        if (finished) return;
        switch (effect.type) {
          case "frame":
            driver?.paint(effect.frame);
            break;
          case "exit":
            finish(effect.code);
            break;
          case "warning":
            break;
          case "openExternal":
            try {
              await (runtime.openExternal ?? platformOpen)(effect.url);
            } catch (cause) {
              await applyEffects(
                reader.report(
                  `cannot open URL: ${cause instanceof Error ? cause.message : String(cause)}`,
                ),
              );
            }
            break;
          case "navigate":
            try {
              loaded = await loadDocument(effect.path, root, flags);
              visited.add(loaded.diags);
              laidOut = layoutLoaded(loaded, flags, caps, baseTheme);
              await applyEffects(
                reader.setDocument(
                  loaded.path,
                  loaded.title,
                  laidOut.detailed,
                  effect.history,
                  effect.anchor,
                ),
              );
            } catch (cause) {
              await applyEffects(
                reader.report(
                  `cannot open target: ${cause instanceof Error ? cause.message : String(cause)}`,
                ),
              );
            }
            break;
        }
      }
    };

    const handleEvent = async (event: TerminalInputEvent): Promise<void> => {
      if (event.type === "resize") {
        const width = Math.min(flags.width ?? Number.MAX_SAFE_INTEGER, event.cols);
        caps = { ...caps, width };
        laidOut = layoutLoaded(loaded, flags, caps, baseTheme);
        await applyEffects(
          reader.replaceLayout(laidOut.detailed, {
            cols: width,
            rows: event.rows,
            statusRows: 1,
          }),
        );
        return;
      }
      await applyEffects(reader.handle(event));
    };

    driver = createTerminalDriver({
      input,
      output,
      caps,
      alternateScreen: true,
      mouse: true,
      hideCursor: true,
      onEvent: (event) => {
        chain = chain
          .then(() => handleEvent(event))
          .catch((cause) => {
            finish(1);
            error.write(
              `teml: error: Reader failed: ${cause instanceof Error ? cause.message : String(cause)}\n`,
            );
          });
      },
      onError: (cause) => {
        error.write(`teml: error: terminal output failed: ${cause.message}\n`);
        finish(1);
      },
    });
    // Route the initial render through the same chain+catch as every other
    // event so a bug in reader.start()/applyEffects restores the terminal
    // (via finish -> driver.stop()) instead of surfacing as an unhandled
    // rejection that would leave raw mode / the alternate screen engaged.
    chain = chain
      .then(() => applyEffects(reader.start()))
      .catch((cause) => {
        finish(1);
        error.write(
          `teml: error: Reader failed: ${cause instanceof Error ? cause.message : String(cause)}\n`,
        );
      });
  });
}
