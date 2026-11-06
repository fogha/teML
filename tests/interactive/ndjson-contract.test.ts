import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { NdjsonSplitter } from "../../src/interactive/protocol.js";

type Part = { text: string; repeat: number };
type ContractCase = {
  name: string;
  parts: Part[];
  chunks: number[];
  events: Record<string, unknown>[];
};

const { cases } = JSON.parse(
  readFileSync(join(process.cwd(), "fixtures/protocol/ndjson-cases.json"), "utf8"),
) as { cases: ContractCase[] };

function inputBytes(parts: Part[]): Buffer {
  return Buffer.concat(parts.map((part) => Buffer.from(part.text.repeat(part.repeat), "utf8")));
}

function* chunks(input: Buffer, schedule: number[]): Generator<Buffer> {
  let offset = 0;
  let index = 0;
  while (offset < input.length) {
    const end = Math.min(input.length, offset + schedule[index % schedule.length]!);
    yield input.subarray(offset, end);
    offset = end;
    index += 1;
  }
}

function runContract(testCase: ContractCase): Record<string, unknown>[] {
  const splitter = new NdjsonSplitter();
  const decoder = new TextDecoder();
  const events: Record<string, unknown>[] = [];
  const collect = (chunk: string) => {
    for (const input of splitter.push(chunk)) {
      events.push(
        input.ok
          ? (JSON.parse(input.line) as Record<string, unknown>)
          : { type: "error", message: input.error },
      );
    }
  };
  for (const chunk of chunks(inputBytes(testCase.parts), testCase.chunks)) {
    collect(decoder.decode(chunk, { stream: true }));
  }
  collect(decoder.decode());
  for (const input of splitter.flush()) {
    events.push(
      input.ok
        ? (JSON.parse(input.line) as Record<string, unknown>)
        : { type: "error", message: input.error },
    );
  }
  return events;
}

test.each(cases)("shared NDJSON contract: $name", (testCase) => {
  expect(runContract(testCase)).toEqual(testCase.events);
});
