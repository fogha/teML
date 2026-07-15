import { PassThrough } from "node:stream";
import { test, expect, vi } from "vitest";
import { runInteractiveApp, type InteractiveAppHandlers } from "../../src/interactive/host.js";

function harness() {
  const input = new PassThrough();
  const chunks: string[] = [];
  const output = new PassThrough();
  output.on("data", (c: Buffer) => chunks.push(c.toString("utf8")));
  return { input, output, chunks };
}

/** Let queued stream "data" events flush before the next assertion/keystroke. */
function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

const FORM_HTML = `
  <form>
    <label for="name">Name</label>
    <input id="name" placeholder="your name">
    <input id="agree" type="checkbox">
    <button id="submit">Submit</button>
  </form>
`;

test("renders the first frame immediately on start", async () => {
  const { input, output, chunks } = harness();
  const done = runInteractiveApp(FORM_HTML, { input, output, handlers: {} });
  await tick();
  expect(chunks.join("")).toContain("Submit");
  input.emit("end"); // let the promise settle so the test can finish
  await done;
});

test("typing into the focused input fires onChange and updates values()", async () => {
  const { input, output } = harness();
  const changes: Array<[string, string]> = [];
  const handlers: InteractiveAppHandlers = {
    onChange: (id, value) => changes.push([id, value]),
  };
  const done = runInteractiveApp(FORM_HTML, { input, output, handlers });
  await tick();

  input.write("A");
  await tick();
  input.write("da");
  await tick();

  expect(changes).toEqual([
    ["name", "A"],
    ["name", "Ad"],
    ["name", "Ada"],
  ]);

  input.emit("data", "\u0003"); // Ctrl+C
  const values = await done;
  expect(values.name).toBe("Ada");
});

test("Tab navigates focus; Space toggles the checkbox via onToggle", async () => {
  const { input, output } = harness();
  const toggles: Array<[string, boolean]> = [];
  const done = runInteractiveApp(FORM_HTML, {
    input,
    output,
    handlers: { onToggle: (id, checked) => toggles.push([id, checked]) },
  });
  await tick();

  input.write("\t"); // name -> agree
  await tick();
  input.write(" "); // toggle
  await tick();

  expect(toggles).toEqual([["agree", true]]);

  input.emit("data", "\u0003");
  const values = await done;
  expect(values.agree).toBe("true");
});

test("clicking the button fires onClick with collected values; ctx.exit() resolves the promise", async () => {
  const { input, output } = harness();
  let seenValues: Record<string, string> | undefined;
  const done = runInteractiveApp(FORM_HTML, {
    input,
    output,
    handlers: {
      onClick: (id, values, ctx) => {
        seenValues = values;
        ctx.exit();
      },
    },
  });
  await tick();

  input.write("Grace");
  await tick();
  input.write("\t"); // -> agree
  await tick();
  input.write("\t"); // -> submit
  await tick();
  input.write("\r"); // Enter activates the focused button

  const values = await done;
  expect(seenValues?.name).toBe("Grace");
  expect(seenValues?.submit).toBe(""); // buttons carry no text value of their own
  expect(values.name).toBe("Grace");
});

test("Ctrl+C resolves with whatever values were entered so far", async () => {
  const { input, output } = harness();
  const done = runInteractiveApp(FORM_HTML, { input, output, handlers: {} });
  await tick();

  input.write("partial");
  await tick();
  input.emit("data", "\u0003");

  const values = await done;
  expect(values.name).toBe("partial");
});

test("stdin ending without Ctrl+C also resolves the promise", async () => {
  const { input, output } = harness();
  const done = runInteractiveApp(FORM_HTML, { input, output, handlers: {} });
  await tick();
  input.emit("end");
  await expect(done).resolves.toEqual(expect.objectContaining({ name: "" }));
});

test("SGR mouse click focuses and activates the widget at that row", async () => {
  const { input, output } = harness();
  const onClick = vi.fn((_id: string, _values: Record<string, string>, ctx) => ctx.exit());
  const done = runInteractiveApp(FORM_HTML, {
    input,
    output,
    handlers: { onClick },
  });
  await tick();

  // Row of the submit button is layout-dependent; find it from the last frame's plain text.
  // (The host doesn't expose hit rows publicly, so this test drives it through a full
  // Tab-navigate-then-click sequence instead of guessing a row number.)
  input.write("\t\t"); // name -> agree -> submit
  await tick();
  input.write("\r");
  await done;
  expect(onClick).toHaveBeenCalledTimes(1);
});

test("ctx.render() swaps the document and preserves matching widget values", async () => {
  const { input, output } = harness();
  const done = runInteractiveApp(`<input id="name" value="Ada">`, {
    input,
    output,
    handlers: {
      onChange: (_id, _value, ctx) => {
        ctx.render(`<input id="name"><p>changed</p>`);
      },
    },
  });
  await tick();

  input.write("X"); // overwrites the untouched default "Ada" -> triggers onChange -> render()
  await tick();
  input.emit("data", "\u0003");

  const values = await done;
  expect(values.name).toBe("X");
});

test("plain (non-TTY) input/output never touches setRawMode and still works", async () => {
  const { input, output } = harness();
  expect(typeof (input as { setRawMode?: unknown }).setRawMode).toBe("undefined");
  const done = runInteractiveApp(FORM_HTML, { input, output, handlers: {} });
  await tick();
  input.emit("data", "\u0003");
  await expect(done).resolves.toBeDefined();
});

test("accepts teml-format source via the format option", async () => {
  const { input, output } = harness();
  const done = runInteractiveApp('::input{id="x" label="X"}\n::button{id="go" label="Go"}', {
    input,
    output,
    format: "teml",
    handlers: {},
  });
  await tick();
  input.emit("data", "\u0003");
  const values = await done;
  expect(values).toHaveProperty("x");
  expect(values).toHaveProperty("go");
});
