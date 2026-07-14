#!/usr/bin/env node
// cli/main.ts — Commander entrypoint. stdout = output; stderr = diagnostics (C-2).

import type { Command } from "commander";

const earlyArgs = process.argv.slice(2);
const VERSION = "1.0.0";
if (earlyArgs.length === 1 && (earlyArgs[0] === "-v" || earlyArgs[0] === "--version")) {
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}

function configureExit(program: Command): void {
  program.exitOverride();
}

async function main(): Promise<void> {
  const { Command } = await import("commander");
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
    .version(VERSION, "-v, --version", "print version");

  const viewCmd = addSharedOptions(
    new Command("view").description("render a document to the terminal").argument("[file]", "input file or - for stdin"),
  );
  bindCommand("view", viewCmd);

  const convertCmd = addSharedOptions(
    new Command("convert").description("convert between formats").argument("[file]", "input file or - for stdin"),
  );
  bindCommand("convert", convertCmd);

  const inspectCmd = addSharedOptions(
    addInspectOptions(
      new Command("inspect").description("dump AST, tokens, or render tokens").argument("[file]", "input file or - for stdin"),
    ),
  );
  bindCommand("inspect", inspectCmd);

  const renderCmd = addSharedOptions(
    new Command("render").description("deterministic plain snapshot").argument("[file]", "input file or - for stdin"),
  );
  bindCommand("render", renderCmd);

  program.addCommand(viewCmd, { isDefault: true });
  program.addCommand(convertCmd);
  program.addCommand(inspectCmd);
  program.addCommand(renderCmd);

  try {
    await program.parseAsync(process.argv);
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    if (e.code === "commander.helpDisplayed" || e.code === "commander.version") {
      process.exit(0);
    }
    const msg = e.message?.trim();
    if (msg) process.stderr.write(`teml: error: ${msg}\n`);
    process.exit(2);
  }
}

main().catch(() => process.exit(2));
