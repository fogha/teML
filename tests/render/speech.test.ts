import { describe, expect, test } from "vitest";
import { doc, text } from "../../src/core/ast.js";
import { renderSpeech } from "../../src/render/speech.js";

describe("speech renderer", () => {
  test("announces headings, semantic roles, and links", () => {
    const output = renderSpeech(
      doc([
        { type: "heading", level: 2, children: [text("Status")] },
        {
          type: "paragraph",
          children: [
            { type: "span", role: "warning", children: [text("Replica restarting")] },
            text(". "),
            { type: "link", href: "https://example.test", children: [text("Runbook")] },
          ],
        },
      ]),
    );
    expect(output).toBe(
      "Heading level 2: Status\nwarning: Replica restarting. Runbook (link: https://example.test)\n",
    );
  });

  test("linearizes tables and alerts deterministically", () => {
    const document = doc([
      {
        type: "container",
        name: "error",
        attrs: { title: "Deployment" },
        children: [{ type: "paragraph", children: [text("Failed")] }],
      },
      {
        type: "table",
        align: [null, null],
        rows: [
          { header: true, cells: [[text("Name")], [text("State")]] },
          { header: false, cells: [[text("api")], [text("down")]] },
        ],
      },
    ]);
    expect(renderSpeech(document)).toContain(
      "error, Deployment:\nFailed\nTable:\nHeader row: Name; State\nRow: api; down\n",
    );
  });

  test("identifies inert widgets without exposing masked values", () => {
    const output = renderSpeech(
      doc([
        { type: "leaf", name: "button", attrs: { id: "save", label: "Save" } },
        {
          type: "leaf",
          name: "input",
          attrs: { id: "token", label: "Token", value: "secret", mask: "true" },
        },
        { type: "leaf", name: "checkbox", attrs: { id: "ready", label: "Ready", checked: "true" } },
      ]),
    );
    expect(output).toContain("Button: Save. Inactive in document mode.");
    expect(output).toContain("Input: Token. Protected value present. Inactive in document mode.");
    expect(output).not.toContain("secret");
    expect(output).toContain("Checkbox: Ready. Checked. Inactive in document mode.");
    expect(output).not.toContain("\x1b");
  });
});
