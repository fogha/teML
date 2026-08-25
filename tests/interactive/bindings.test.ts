import { PassThrough } from "node:stream";
import { expect, test } from "vitest";
import { ATTACH_BINDING_SINK, bindings } from "../../src/interactive/bindings.js";
import { runInteractiveApp } from "../../src/interactive/host.js";

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("bindings stores assigned values and reads them back", () => {
  const state = bindings();
  expect(state.cpu).toBeUndefined();
  expect("cpu" in state).toBe(false);

  state.cpu = "42%";
  expect(state.cpu).toBe("42%");
  expect("cpu" in state).toBe(true);

  state.cpu = "50%";
  expect(state.cpu).toBe("50%");
});

test("bindings emits through the attached sink on assignment", () => {
  const state = bindings();
  const emitted: Array<[string, string]> = [];
  state[ATTACH_BINDING_SINK]((id, value) => emitted.push([id, value]));

  state.cpu = "42%";
  state.cpu = "50%";

  expect(emitted).toEqual([
    ["cpu", "42%"],
    ["cpu", "50%"],
  ]);
});

test("binding assignment from a handler reflects in the next frame", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: string[] = [];
  output.on("data", (chunk) => chunks.push(chunk.toString("utf8")));

  const state = bindings();
  const done = runInteractiveApp(
    ['::metric{id="cpu" value="0%"}', '::button{id="go" label="Go"}'].join("\n"),
    {
      format: "teml",
      state,
      input,
      output,
      handlers: {
        onClick(id, _values, _ctx) {
          if (id === "go") state.cpu = "99%";
        },
      },
    },
  );

  await tick();
  expect(chunks.join("")).toContain("0%");

  input.write("\r");
  await tick();
  expect(chunks.join("")).toContain("99%");

  input.emit("end");
  await expect(done).resolves.toMatchObject({ go: "" });
});

test("assigning an unknown id surfaces an error event and keeps the session alive", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const errors: string[] = [];

  const state = bindings();
  const done = runInteractiveApp(
    ['::metric{id="cpu" value="0%"}', '::button{id="go" label="Go"}'].join("\n"),
    {
      format: "teml",
      state,
      input,
      output,
      handlers: {
        onClick(id, _values, _ctx) {
          if (id === "go") state.nope = "x";
        },
        onError(message) {
          errors.push(message);
        },
      },
    },
  );

  await tick();
  input.write("\r");
  await tick();
  expect(errors).toEqual(["unknown update id 'nope'"]);

  input.emit("end");
  await expect(done).resolves.toMatchObject({ go: "" });
});

test("a timer assignment lands without a keystroke", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: string[] = [];
  output.on("data", (chunk) => chunks.push(chunk.toString("utf8")));

  const state = bindings();
  const done = runInteractiveApp('::metric{id="clock" value="00:00:00"}', {
    format: "teml",
    state,
    input,
    output,
  });

  await tick();
  expect(chunks.join("")).toContain("00:00:00");

  setTimeout(() => {
    state.clock = "12:00:01";
  }, 20);
  setTimeout(() => {
    input.emit("end");
  }, 80);

  await done;
  await delay(0);
  expect(chunks.join("")).toContain("12:00:01");
});
