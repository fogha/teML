import type { Block } from "../core/ast.js";

export type RadioOption = {
  value: string;
  label: string;
};

export function radioOptions(container: Extract<Block, { type: "container" }>): RadioOption[] {
  if (container.name !== "radio") return [];
  const options: RadioOption[] = [];
  const seen = new Set<string>();
  for (const child of container.children) {
    if (child.type !== "leaf" || child.name !== "option") continue;
    const value = child.attrs.value?.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    options.push({ value, label: child.attrs.label?.trim() || value });
  }
  return options;
}

export function radioOptionIndex(
  options: readonly RadioOption[],
  value: string | undefined,
): number {
  if (!value) return -1;
  return options.findIndex((option) => option.value === value);
}
