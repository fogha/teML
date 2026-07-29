// core/href.ts — resolve relative links against a base and vet before AST storage.

import { dirname, resolve as pathResolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { sanitizeHref, type SanitizeOpts } from "./sanitize.js";

export type { SanitizeOpts };

function hasScheme(href: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href);
}

/**
 * True for a drive-qualified filesystem path such as `C:\docs\a.teml`.
 *
 * A single-letter drive prefix is also a syntactically valid URL scheme, so both
 * `new URL()` and {@link hasScheme} read `C:` as one. Callers that accept
 * filesystem paths have to test this first, or every Windows absolute path looks
 * like an unsupported scheme. Requiring a separator after the colon keeps
 * genuine one-letter schemes distinguishable. Document href sanitization
 * deliberately does not use this: an untrusted document must not be able to
 * address the local filesystem.
 */
export function isWindowsDrivePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value);
}

function normalizeBase(base: string): string {
  const trimmed = base.trim();
  if (hasScheme(trimmed)) {
    if (trimmed.startsWith("file:")) {
      const path = fileURLToPath(trimmed);
      const dir = path.endsWith("/") ? path : dirname(path);
      return pathToFileURL(dir.endsWith("/") ? dir : `${dir}/`).href;
    }
    try {
      const url = new URL(trimmed);
      if (/\.[a-zA-Z0-9]+$/.test(url.pathname) && !url.pathname.endsWith("/")) {
        const dir = url.pathname.replace(/\/[^/]+$/, "/");
        return `${url.origin}${dir}`;
      }
      return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
    } catch {
      return trimmed;
    }
  }
  if (trimmed.startsWith("/")) return `file://${trimmed.endsWith("/") ? trimmed : `${trimmed}/`}`;
  const abs = pathResolve(trimmed);
  const dir = abs.endsWith("/") ? abs : dirname(abs);
  return pathToFileURL(dir.endsWith("/") ? dir : `${dir}/`).href;
}

/** Resolve a href against an optional document base (URL or filesystem path). */
export function resolveHref(href: string, base?: string): string {
  const target = href.trim();
  if (!base || target === "" || target.startsWith("#") || hasScheme(target)) return target;
  const root = normalizeBase(base);
  try {
    if (root.startsWith("file:")) {
      const basePath = fileURLToPath(root);
      const resolved = target.startsWith("/") ? pathResolve(target) : pathResolve(basePath, target);
      return pathToFileURL(resolved).href;
    }
    return new URL(target, root).href;
  } catch {
    return target;
  }
}

function withinBase(resolved: string, base: string): boolean {
  if (!base) return true;
  const root = normalizeBase(base);
  if (resolved.startsWith("#")) return true;
  try {
    if (root.startsWith("file:")) {
      const basePath = fileURLToPath(root);
      const resolvedPath = hasScheme(resolved)
        ? fileURLToPath(resolved)
        : pathResolve(dirname(basePath), resolved);
      const rel = pathResolve(resolvedPath);
      const rootAbs = pathResolve(basePath);
      return rel === rootAbs || rel.startsWith(rootAbs.endsWith("/") ? rootAbs : `${rootAbs}/`);
    }
    const resolvedUrl = hasScheme(resolved) ? new URL(resolved) : new URL(resolved, root);
    const rootUrl = new URL(root);
    if (resolvedUrl.origin !== rootUrl.origin) return false;
    const rootPath =
      rootUrl.pathname === "/"
        ? "/"
        : rootUrl.pathname.endsWith("/")
          ? rootUrl.pathname
          : `${rootUrl.pathname}/`;
    const exactRoot = rootPath === "/" ? "/" : rootPath.slice(0, -1);
    return resolvedUrl.pathname === exactRoot || resolvedUrl.pathname.startsWith(rootPath);
  } catch {
    return false;
  }
}

/** Resolve, confine to base, and sanitize a href for AST storage. */
export function processHref(href: string, opts: SanitizeOpts = {}): string | null {
  const resolved = resolveHref(href, opts.base);
  if (opts.base && !withinBase(resolved, opts.base)) return null;
  return sanitizeHref(resolved, opts);
}
