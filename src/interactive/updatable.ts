// interactive/updatable.ts — addressable display widgets and `update` validation.

import type { Block, TDoc } from "../core/index.js";
import type { Diagnostics } from "../core/diagnostics.js";
import { radioOptions } from "./radio.js";
import type { FocusableWidget } from "./focus.js";
import {
  isFocusableContainer,
  isFocusableLeaf,
  isMutationContainer,
  isUpdatableLeaf,
  sanitizeAttrKey,
  sanitizeAttrValue,
  UPDATABLE_MUTABLE_ATTRS,
} from "../teml/directives.js";

export type UpdatableWidget = {
  id: string;
  name: "progress" | "metric";
  attrs: Record<string, string>;
  block: Extract<Block, { type: "leaf" }>;
};

export type MutationTarget = {
  id: string;
  name: string;
  attrs: Record<string, string>;
  block: Extract<Block, { type: "container" }>;
  parent: Block[];
  index: number;
};

function isNonNegativeNumberString(raw: string): boolean {
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n >= 0;
}

/** Validate and sanitize an `update` props object without mutating the widget. */
export function validateUpdateProps(
  widget: UpdatableWidget,
  props: Record<string, string>,
): { ok: true; sanitized: Record<string, string> } | { ok: false; error: string } {
  const allowlist = UPDATABLE_MUTABLE_ATTRS[widget.name];
  const sanitized: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(props)) {
    const key = sanitizeAttrKey(rawKey);
    if (!key || !allowlist?.includes(key)) {
      return {
        ok: false,
        error: `unknown update prop '${rawKey}' for ${widget.name} '${widget.id}'`,
      };
    }
    const value = sanitizeAttrValue(rawValue);
    if (widget.name === "progress" && (key === "value" || key === "max")) {
      if (value !== "" && !isNonNegativeNumberString(value)) {
        return {
          ok: false,
          error: `invalid update prop '${key}' for progress '${widget.id}'`,
        };
      }
    }
    sanitized[key] = value;
  }
  return { ok: true, sanitized };
}

/** Apply a previously validated props object to the live document block. */
export function applyUpdateProps(widget: UpdatableWidget, sanitized: Record<string, string>): void {
  for (const [key, value] of Object.entries(sanitized)) {
    widget.block.attrs[key] = value;
  }
}

function walkAddressable(
  blocks: Block[],
  focusables: FocusableWidget[],
  updatables: UpdatableWidget[],
  mutationTargets: MutationTarget[],
  seen: Set<string>,
  diags?: Diagnostics,
  mutationAllowed = true,
): void {
  for (let index = 0; index < blocks.length; index++) {
    const b = blocks[index]!;
    switch (b.type) {
      case "leaf": {
        if (isFocusableLeaf(b.name)) {
          const id = b.attrs.id?.trim();
          if (!id) {
            diags?.warn(
              "focus-missing-id",
              `::${b.name} has no id; it cannot receive keyboard focus`,
            );
            break;
          }
          if (seen.has(id)) {
            diags?.warn("focus-duplicate-id", `duplicate focusable id '${id}'`);
            b.attrs.id = "";
            break;
          }
          seen.add(id);
          focusables.push({ id, name: b.name as FocusableWidget["name"], attrs: b.attrs });
          break;
        }
        if (isUpdatableLeaf(b.name)) {
          const id = b.attrs.id?.trim();
          if (!id) {
            diags?.warn(
              "update-missing-id",
              `::${b.name} has no id; it cannot receive live updates`,
            );
            break;
          }
          if (seen.has(id)) {
            diags?.warn("update-duplicate-id", `duplicate updatable id '${id}'`);
            b.attrs.id = "";
            break;
          }
          seen.add(id);
          updatables.push({
            id,
            name: b.name as UpdatableWidget["name"],
            attrs: b.attrs,
            block: b,
          });
        }
        break;
      }
      case "list":
        for (const item of b.items)
          walkAddressable(
            item.blocks,
            focusables,
            updatables,
            mutationTargets,
            seen,
            diags,
            mutationAllowed,
          );
        break;
      case "quote":
        walkAddressable(
          b.children,
          focusables,
          updatables,
          mutationTargets,
          seen,
          diags,
          mutationAllowed,
        );
        break;
      case "footnoteDefinition":
        walkAddressable(b.children, focusables, updatables, mutationTargets, seen, diags, false);
        break;
      case "container": {
        const focusable = isFocusableContainer(b.name);
        const mutable = mutationAllowed && isMutationContainer(b.name);
        const id = b.attrs.id?.trim();

        if (!focusable) {
          if (mutable && id) {
            if (seen.has(id)) {
              diags?.warn("mutation-duplicate-id", `duplicate mutation target id '${id}'`);
              b.attrs.id = "";
            } else {
              seen.add(id);
              mutationTargets.push({
                id,
                name: b.name,
                attrs: b.attrs,
                block: b,
                parent: blocks,
                index,
              });
            }
          }
          walkAddressable(
            b.children,
            focusables,
            updatables,
            mutationTargets,
            seen,
            diags,
            mutationAllowed,
          );
          break;
        }

        if (!id) {
          diags?.warn(
            "focus-missing-id",
            `:::${b.name} has no id; it cannot receive keyboard focus`,
          );
          break;
        }
        if (seen.has(id)) {
          diags?.warn("focus-duplicate-id", `duplicate focusable id '${id}'`);
          b.attrs.id = "";
          break;
        }
        const options = b.name === "radio" ? radioOptions(b) : undefined;
        if (b.name === "radio" && options?.length === 0) break;
        seen.add(id);
        focusables.push({
          id,
          name: b.name as FocusableWidget["name"],
          attrs: b.attrs,
          block: b,
          ...(options ? { options } : {}),
        });
        if (mutable) {
          mutationTargets.push({
            id,
            name: b.name,
            attrs: b.attrs,
            block: b,
            parent: blocks,
            index,
          });
        }
        break;
      }
      case "definitionList":
        for (const item of b.items) {
          for (const def of item.definitions) {
            walkAddressable(
              def,
              focusables,
              updatables,
              mutationTargets,
              seen,
              diags,
              mutationAllowed,
            );
          }
        }
        break;
      default:
        break;
    }
  }
}

/** Collect focusable and updatable widgets in one document-order pass. */
export function collectInteractiveWidgets(
  doc: TDoc,
  diags?: Diagnostics,
): {
  focusables: FocusableWidget[];
  updatables: UpdatableWidget[];
  mutationTargets: MutationTarget[];
} {
  const focusables: FocusableWidget[] = [];
  const updatables: UpdatableWidget[] = [];
  const mutationTargets: MutationTarget[] = [];
  walkAddressable(doc.blocks, focusables, updatables, mutationTargets, new Set(), diags);
  return { focusables, updatables, mutationTargets };
}
