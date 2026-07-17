#!/usr/bin/env node
// cli/main.ts — Commander entrypoint. stdout = output; stderr = diagnostics (C-2).

import type { Command } from "commander";
import { readVersion } from "./version.js";

const earlyArgs = process.argv.slice(2);
if (earlyArgs.length === 1 && (earlyArgs[0] === "-v" || earlyArgs[0] === "--version")) {
  process.stdout.write(`${readVersion()}\n`);
  process.exit(0);
}

function configureExit(program: Command): void {
  program.exitOverride();
  program.configureOutput({
    outputError: (message, write) => write(`teml: ${message}`),
  });
}

async function main(): Promise<void> {
  const { Command } = await import("commander");
  const {
    CONVERT_HELP,
    DEMO_HELP,
    INSPECT_HELP,
    READ_HELP,
    RENDER_HELP,
    ROOT_HELP,
    RUN_HELP,
    VIEW_HELP,
    cleanCommanderError,
    shouldShowRootHelp,
  } = await import("./help.js");
  const { addInspectOptions, addSharedOptions, flagsFromOptions } = await import("./options.js");
  const { execute } = await import("./run.js");
  type Cmd = import("./run.js").CommandName;

  function bindCommand(name: Cmd, cmd: Command): void {
    cmd.action(async (file: string | undefined, opts: Record<string, unknown>) => {
      const code = await execute(name, file, flagsFromOptions(opts));
      process.exit(code);
    });
  }

  const program = new Command();
  configureExit(program);

  program
    .name("teml")
    .description("Terminal Markup Language — semantic documents for terminals")
    .version(readVersion(), "-v, --version", "print version")
    .showHelpAfterError("Run 'teml --help' for commands and examples.")
    .addHelpText("after", ROOT_HELP);

  const demoCmd = addSharedOptions(
    new Command("demo").description("render the built-in TeML showcase"),
    { input: false },
  );
  demoCmd.addHelpText("after", DEMO_HELP);
  demoCmd.action(async (opts: Record<string, unknown>) => {
    const { bundledDemoPath } = await import("./demo.js");
    const code = await execute("view", bundledDemoPath(), flagsFromOptions(opts));
    process.exit(code);
  });

  const viewCmd = addSharedOptions(
    new Command("view")
      .description("render TeML, Markdown, or HTML once and exit")
      .argument("[file]", "input file or - for stdin"),
  );
  viewCmd.addHelpText("after", VIEW_HELP);
  bindCommand("view", viewCmd);

  const convertCmd = addSharedOptions(
    new Command("convert")
      .description("convert a document to TeML, Markdown, text, speech, or JSON")
      .argument("[file]", "input file or - for stdin"),
    { output: true },
  );
  convertCmd.addHelpText("after", CONVERT_HELP);
  bindCommand("convert", convertCmd);

  const inspectCmd = addSharedOptions(
    addInspectOptions(
      new Command("inspect")
        .description("inspect the normalized AST or layout token streams")
        .argument("[file]", "input file or - for stdin"),
    ),
  );
  inspectCmd.addHelpText("after", INSPECT_HELP);
  bindCommand("inspect", inspectCmd);

  const renderCmd = addSharedOptions(
    new Command("render")
      .description("produce a deterministic plain-text snapshot")
      .argument("[file]", "input file or - for stdin"),
  );
  renderCmd.addHelpText("after", RENDER_HELP);
  bindCommand("render", renderCmd);

  const runCmd = addSharedOptions(
    new Command("run")
      .description("run interactive widgets over an NDJSON host protocol")
      .argument("[file]", "input file or - for stdin"),
  );
  runCmd.addHelpText("after", RUN_HELP);
  runCmd.action(async (file: string | undefined, opts: Record<string, unknown>) => {
    const { executeRun } = await import("./commands/run.js");
    const code = await executeRun(file, flagsFromOptions(opts));
    process.exit(code);
  });

  const readCmd = addSharedOptions(
    new Command("read")
      .description("browse a document or directory in the full-screen Reader")
      .argument("<file>", "input file or directory (TTY required)"),
  );
  readCmd.addHelpText("after", READ_HELP);
  readCmd.action(async (file: string, opts: Record<string, unknown>) => {
    const { executeRead } = await import("./commands/read.js");
    const code = await executeRead(file, flagsFromOptions(opts));
    process.exit(code);
  });

  program.addCommand(demoCmd);
  program.addCommand(viewCmd, { isDefault: true });
  program.addCommand(convertCmd);
  program.addCommand(inspectCmd);
  program.addCommand(renderCmd);
  program.addCommand(runCmd);
  program.addCommand(readCmd);

  if (shouldShowRootHelp(earlyArgs, Boolean(process.stdin.isTTY))) {
    program.outputHelp();
    return;
  }

  try {
    await program.parseAsync(process.argv);
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    if (
      e.code === "commander.helpDisplayed" ||
      e.code === "commander.help" ||
      e.code === "commander.version"
    ) {
      process.exit(0);
    }
    if (e.code?.startsWith("commander.")) process.exit(2);
    const msg = e.message ? cleanCommanderError(e.message) : "";
    if (msg) process.stderr.write(`teml: error: ${msg}\n`);
    process.exit(2);
  }
}

main().catch(() => process.exit(2));
