// html/profiles/loader.ts — validated declarative profile loader (Milestone 5).

import { existsSync, readFileSync } from "node:fs";
import { bundledFileExists, readBundledFile } from "../../sea/runtime.js";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Diagnostics } from "../../core/diagnostics.js";
import { isKnownContainer } from "../../teml/directives.js";

export type ProfileMatch = {
  class?: string;
  tag?: string;
};

export type ContainerRule = {
  match: ProfileMatch;
  directive: string;
  titleFrom?: string;
};

export type SpanRule = {
  match: ProfileMatch;
  role: string;
};

export type Profile = {
  name: string;
  version?: number;
  description?: string;
  containers: ContainerRule[];
  spans: SpanRule[];
};

const profilesDir = join(fileURLToPath(import.meta.url), "..");

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateMatch(match: unknown, ctx: string): ProfileMatch {
  if (!isRecord(match)) throw new Error(`${ctx}: match must be an object`);
  const out: ProfileMatch = {};
  if (match.class != null) {
    if (typeof match.class !== "string" || !match.class.trim())
      throw new Error(`${ctx}: match.class must be a non-empty string`);
    out.class = match.class.trim();
  }
  if (match.tag != null) {
    if (typeof match.tag !== "string" || !match.tag.trim())
      throw new Error(`${ctx}: match.tag must be a non-empty string`);
    out.tag = match.tag.trim().toLowerCase();
  }
  if (!out.class && !out.tag) throw new Error(`${ctx}: match needs class and/or tag`);
  return out;
}

export function validateProfile(raw: unknown): Profile {
  if (!isRecord(raw)) throw new Error("profile must be a JSON object");
  if (typeof raw.name !== "string" || !raw.name.trim())
    throw new Error("profile.name must be a non-empty string");
  if (raw.version != null && typeof raw.version !== "number")
    throw new Error("profile.version must be a number");
  if (raw.description != null && typeof raw.description !== "string")
    throw new Error("profile.description must be a string");
  if (!Array.isArray(raw.containers)) throw new Error("profile.containers must be an array");
  if (!Array.isArray(raw.spans)) throw new Error("profile.spans must be an array");

  const containers: ContainerRule[] = raw.containers.map((item, i) => {
    if (!isRecord(item)) throw new Error(`profile.containers[${i}] must be an object`);
    if (typeof item.directive !== "string" || !item.directive.trim())
      throw new Error(`profile.containers[${i}].directive must be a non-empty string`);
    // Caught here rather than at conversion time, where an unknown name would
    // silently produce a container the normalizer then drops.
    if (!isKnownContainer(item.directive.trim()))
      throw new Error(
        `profile.containers[${i}].directive '${item.directive.trim()}' is not a known TeML container directive`,
      );
    const titleFrom =
      item.titleFrom == null
        ? undefined
        : typeof item.titleFrom === "string"
          ? item.titleFrom
          : (() => {
              throw new Error(`profile.containers[${i}].titleFrom must be a string`);
            })();
    return {
      match: validateMatch(item.match, `profile.containers[${i}]`),
      directive: item.directive.trim(),
      titleFrom,
    };
  });

  const spans: SpanRule[] = raw.spans.map((item, i) => {
    if (!isRecord(item)) throw new Error(`profile.spans[${i}] must be an object`);
    if (typeof item.role !== "string" || !item.role.trim())
      throw new Error(`profile.spans[${i}].role must be a non-empty string`);
    return {
      match: validateMatch(item.match, `profile.spans[${i}]`),
      role: item.role.trim(),
    };
  });

  return {
    name: raw.name.trim(),
    ...(raw.version != null ? { version: raw.version as number } : {}),
    ...(raw.description != null ? { description: raw.description as string } : {}),
    containers,
    spans,
  };
}

function resolveProfilePath(nameOrPath: string): string {
  if (isAbsolute(nameOrPath)) return nameOrPath;
  if (nameOrPath.endsWith(".json")) return join(process.cwd(), nameOrPath);
  const bundled = join(profilesDir, `${nameOrPath}.json`);
  const assetKey = `html/profiles/${nameOrPath}.json`;
  if (bundledFileExists(assetKey, bundled)) return bundled;
  const cwdCandidate = join(process.cwd(), nameOrPath);
  if (existsSync(cwdCandidate)) return cwdCandidate;
  const cwdJson = join(process.cwd(), `${nameOrPath}.json`);
  if (existsSync(cwdJson)) return cwdJson;
  throw new Error(`profile not found: ${nameOrPath}`);
}

function readProfileSource(path: string, nameOrPath: string): string {
  if (isAbsolute(nameOrPath) || nameOrPath.endsWith(".json")) {
    return readFileSync(path, "utf8");
  }
  const assetKey = `html/profiles/${nameOrPath}.json`;
  const bundled = join(profilesDir, `${nameOrPath}.json`);
  if (path === bundled && bundledFileExists(assetKey, bundled)) {
    return readBundledFile(assetKey, bundled);
  }
  return readFileSync(path, "utf8");
}

export function loadProfile(nameOrPath: string): Profile {
  const path = resolveProfilePath(nameOrPath);
  const raw = JSON.parse(readProfileSource(path, nameOrPath)) as unknown;
  return validateProfile(raw);
}

export function elementMatches(el: Element, match: ProfileMatch): boolean {
  const tag = el.tagName.toLowerCase();
  if (match.tag && tag !== match.tag) return false;
  if (match.class) {
    const classes = (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
    if (!classes.includes(match.class)) return false;
  }
  return true;
}

export function findContainerRule(el: Element, profile?: Profile): ContainerRule | undefined {
  if (!profile) return undefined;
  for (const rule of profile.containers) {
    if (elementMatches(el, rule.match)) return rule;
  }
  return undefined;
}

export function findSpanRole(el: Element, profile?: Profile): string | undefined {
  if (!profile) return undefined;
  for (const rule of profile.spans) {
    if (elementMatches(el, rule.match)) return rule.role;
  }
  return undefined;
}

export function titleFromSelectors(
  el: Element,
  selectors: string,
  diags?: Diagnostics,
): string | undefined {
  for (const sel of selectors.split(",")) {
    const trimmed = sel.trim();
    if (!trimmed) continue;
    let found: Element | null;
    try {
      found = el.querySelector(trimmed);
    } catch {
      // querySelector throws on a malformed selector. One bad profile rule must
      // not abort the conversion of an otherwise valid document.
      diags?.warn(
        "profile-invalid-selector",
        `profile titleFrom selector '${trimmed}' is not a valid CSS selector; ignored`,
      );
      continue;
    }
    if (found) {
      const text = found.textContent?.replace(/\s+/g, " ").trim();
      if (text) return text;
    }
  }
  return undefined;
}
