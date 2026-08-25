#!/usr/bin/env node
// Compare cold startup of the SEA binary vs node dist/cli/main.js.

import { execFileSync, spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { fileSizeBytes, root, seaBinaryPath } from "./lib.mjs";

const binary = seaBinaryPath();
const nodeCli = join(root, "dist/cli/main.js");
if (!existsSync(binary) || !existsSync(nodeCli)) {
  console.error("sea:bench: missing binary or dist/cli/main.js — run pnpm run sea:build first");
  process.exit(1);
}

const iterations = Number(process.env.SEA_BENCH_ITERATIONS ?? 7);

function median(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function bench(label, cmd, args) {
  const samples = [];
  for (let i = 0; i < iterations; i += 1) {
    const t0 = process.hrtime.bigint();
    execFileSync(cmd, args, { cwd: root, stdio: "ignore" });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    samples.push(ms);
  }
  const med = median(samples);
  console.log(`sea:bench: ${label} median ${med.toFixed(2)}ms (${iterations} runs)`);
  return med;
}

function readRssKiB(pid) {
  if (process.platform === "win32") {
    const bytes = Number(
      execFileSync(
        "powershell.exe",
        ["-NoProfile", "-Command", `(Get-Process -Id ${pid}).WorkingSet64`],
        { encoding: "utf8" },
      ).trim(),
    );
    return bytes / 1024;
  }
  return Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" }).trim());
}

function measureIdleRss(label, cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    let errorOutput = "";
    let rssKiB;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${label} did not produce an initial frame within 10 seconds`));
    }, 10_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      errorOutput += chunk;
    });
    child.stdout.on("data", (chunk) => {
      if (rssKiB !== undefined) return;
      output += chunk;
      if (!output.includes("\n") || child.pid === undefined) return;
      try {
        rssKiB = readRssKiB(child.pid);
        child.stdin.end('{"type":"exit"}\n');
      } catch (error) {
        child.kill();
        reject(error);
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (rssKiB === undefined || code !== 0) {
        reject(new Error(`${label} memory probe failed (${code}): ${errorOutput.trim()}`));
        return;
      }
      console.log(`sea:bench: ${label} idle RSS ${(rssKiB / 1024).toFixed(2)} MiB`);
      resolve(rssKiB);
    });
  });
}

const seaMs = bench("SEA --version", binary, ["--version"]);
const nodeMs = bench("node dist/cli/main.js --version", process.execPath, [nodeCli, "--version"]);
const deltaMs = seaMs - nodeMs;
const memoryArgs = [
  "run",
  join(root, "examples/interactive/interactive-form.teml"),
  "--frames",
  "plain",
  "--no-color",
];
const seaRssKiB = await measureIdleRss("SEA run", binary, memoryArgs);
const nodeRssKiB = await measureIdleRss("node run", process.execPath, [nodeCli, ...memoryArgs]);

const report = {
  platform: `${process.platform}-${process.arch}`,
  node: process.version,
  iterations,
  seaBinaryBytes: fileSizeBytes(binary),
  seaMedianMs: seaMs,
  nodeMedianMs: nodeMs,
  deltaMs,
  seaIdleRssKiB: seaRssKiB,
  nodeIdleRssKiB: nodeRssKiB,
  idleRssDeltaKiB: seaRssKiB - nodeRssKiB,
  within100msBudget: deltaMs < 100,
};

writeFileSync(join(root, ".sea", "bench-metrics.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(
  `sea:bench: delta ${deltaMs.toFixed(2)}ms (budget <100ms: ${report.within100msBudget ? "PASS" : "FAIL"})`,
);
