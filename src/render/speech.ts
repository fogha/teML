import { inlineText, type Block, type Inline, type TDoc } from "../core/ast.js";

function speakInline(nodes: readonly Inline[]): string {
  let output = "";
  for (const node of nodes) {
    switch (node.type) {
      case "text":
      case "code":
        output += node.value;
        break;
      case "link": {
        const label = speakInline(node.children).trim() || node.href;
        output += `${label} (link: ${node.href})`;
        break;
      }
      case "span": {
        const content = speakInline(node.children);
        if (["warning", "error", "success", "info"].includes(node.role)) {
          output += `${node.role}: ${content}`;
        } else if (node.role === "kbd") {
          output += `key ${content}`;
        } else {
          output += content;
        }
        break;
      }
      case "footnoteRef":
        output += `footnote ${node.id}`;
        break;
      default:
        output += speakInline(node.children);
        break;
    }
  }
  return output;
}

function attrLabel(attrs: Record<string, string>, fallback: string): string {
  return attrs.label || attrs.title || attrs.name || attrs.id || fallback;
}

function speakLeaf(block: Extract<Block, { type: "leaf" }>): string[] {
  const { name, attrs } = block;
  switch (name) {
    case "button":
      return [`Button: ${attrLabel(attrs, "unlabelled")}. Inactive in document mode.`];
    case "input": {
      const value = attrs.mask
        ? attrs.value
          ? " Protected value present."
          : " No protected value."
        : attrs.value
          ? ` Value: ${attrs.value}.`
          : attrs.placeholder
            ? ` Placeholder: ${attrs.placeholder}.`
            : "";
      return [`Input: ${attrLabel(attrs, "unlabelled")}.${value} Inactive in document mode.`];
    }
    case "textarea": {
      const value = attrs.value
        ? ` Value:\n${attrs.value}`
        : attrs.placeholder
          ? ` Placeholder: ${attrs.placeholder}.`
          : "";
      return [`Textarea: ${attrLabel(attrs, "unlabelled")}.${value} Inactive in document mode.`];
    }
    case "checkbox":
      return [
        `Checkbox: ${attrLabel(attrs, "unlabelled")}. ${attrs.checked === "true" ? "Checked" : "Not checked"}. Inactive in document mode.`,
      ];
    case "image":
      return [`Image: ${attrs.alt || attrs.title || "unlabelled"}.`];
    case "metric":
      return [
        `Metric: ${attrLabel(attrs, "value")}: ${attrs.value ?? ""}${attrs.change ? `, change ${attrs.change}` : ""}.`,
      ];
    case "progress": {
      const value = Number(attrs.value ?? 0);
      const max = Math.max(1, Number(attrs.max ?? 100));
      const percent = Math.round((Math.max(0, Math.min(max, value)) / max) * 100);
      return [`Progress: ${attrLabel(attrs, "progress")}: ${percent} percent.`];
    }
    case "event":
      return [
        `Event${attrs.time ? ` at ${attrs.time}` : ""}: ${attrs.title || attrs.detail || "untitled"}.`,
      ];
    default:
      return [`${name}: ${attrLabel(attrs, "")}`.trim()];
  }
}

function speakBlocks(blocks: readonly Block[], depth = 0): string[] {
  const output: string[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "heading":
        output.push(`Heading level ${block.level}: ${inlineText(block.children)}`);
        break;
      case "paragraph":
        output.push(speakInline(block.children));
        break;
      case "thematicBreak":
        output.push("Section break.");
        break;
      case "codeBlock":
        output.push(`Code block${block.language ? `, language ${block.language}` : ""}:`);
        output.push(...block.value.split("\n"));
        break;
      case "quote":
        output.push("Quote:");
        output.push(...speakBlocks(block.children, depth + 1));
        break;
      case "list":
        block.items.forEach((item, index) => {
          const marker = block.ordered ? `${block.start + index}` : "Item";
          const state = item.checked == null ? "" : item.checked ? ", checked" : ", not checked";
          output.push(`${marker}${state}:`);
          output.push(...speakBlocks(item.blocks, depth + 1));
        });
        break;
      case "table":
        output.push("Table:");
        block.rows.forEach((row) => {
          const cells = row.cells.map((cell) => speakInline(cell));
          output.push(`${row.header ? "Header row" : "Row"}: ${cells.join("; ")}`);
        });
        break;
      case "definitionList":
        block.items.forEach((item) => {
          output.push(`Term: ${speakInline(item.term)}`);
          item.definitions.forEach((definition) => {
            output.push("Definition:");
            output.push(...speakBlocks(definition, depth + 1));
          });
        });
        break;
      case "container": {
        if (block.name === "radio") {
          const options = block.children
            .filter((child) => child.type === "leaf" && child.name === "option")
            .map((child) =>
              child.type === "leaf"
                ? `${child.attrs.label ?? child.attrs.value ?? "unlabelled"}${child.attrs.value === block.attrs.value ? " (selected)" : ""}`
                : "",
            );
          output.push(
            `Radio group: ${block.attrs.id ?? "unlabelled"}. Options: ${options.join(", ")}. Inactive in document mode.`,
          );
          break;
        }
        const label = ["warning", "error", "success", "info"].includes(block.name)
          ? `${block.name}${block.attrs.title ? `, ${block.attrs.title}` : ""}:`
          : block.name === "card" && block.attrs.title
            ? `Card: ${block.attrs.title}`
            : block.name === "details"
              ? `Details, ${block.attrs.open === "false" ? "closed" : "open"}: ${block.attrs.summary ?? ""}`
              : block.name === "figure"
                ? `Figure${block.attrs.caption ? `: ${block.attrs.caption}` : ""}`
                : block.name === "scroll"
                  ? `Scroll region: ${block.attrs.id ?? "unlabelled"}. Inactive in document mode.`
                  : `${block.name}:`;
        output.push(label);
        output.push(...speakBlocks(block.children, depth + 1));
        break;
      }
      case "leaf":
        output.push(...speakLeaf(block));
        break;
      case "footnoteDefinition":
        output.push(`Footnote ${block.id}:`);
        output.push(...speakBlocks(block.children, depth + 1));
        break;
    }
  }
  return output;
}

/** Deterministic, non-ANSI semantic text intended for linear reading tools. */
export function renderSpeech(doc: TDoc): string {
  return speakBlocks(doc.blocks)
    .map((line) => line.trimEnd())
    .filter((line, index, lines) => line !== "" || lines[index - 1] !== "")
    .join("\n")
    .replace(/\n*$/, "\n");
}
