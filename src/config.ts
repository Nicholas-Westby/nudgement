/** Resolve project settings and file-backed context. See docs/configuration.md for the JSON format. */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { mainCheckout } from "./git";

export interface ProjectConfig {
  /** The text of the context file, not its path. */
  context?: string;
  readme?: { require?: string[] };
  commit?: { forbidTrailers?: boolean; maxChangedLines?: number };
  /** hygiene.ignore leaves paths out of the hygiene check only, on top of the top-level ignore. */
  hygiene?: { forbiddenPaths?: string[]; forbiddenWords?: string[]; maxFileKb?: number; ignore?: string[] };
  copy?: { app?: string; properNouns?: string[] };
  /** Paths the file, comment and hygiene checks leave alone, such as test fixtures. */
  ignore?: string[];
}

export function loadConfig(path: string): ProjectConfig {
  if (!existsSync(path)) throw new Error(`config file ${path} does not exist`);
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const base = dirname(path);
  const resolvePath = (value: string) => {
    const expanded = value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
    return isAbsolute(expanded) ? expanded : join(base, expanded);
  };
  const read = (value: string, what: string) => {
    const file = resolvePath(value);
    if (!existsSync(file)) throw new Error(`the ${what} file ${file} named in ${path} does not exist`);
    return readFileSync(file, "utf8");
  };

  const config: ProjectConfig = { ...raw };

  if (typeof raw.context === "string") config.context = read(raw.context, "context");
  else if (Array.isArray(raw.context))
    config.context = raw.context.map((path: string) => read(path, "context")).join("\n\n---\n\n");
  const require = raw.readme?.require;
  if (typeof require === "string")
    config.readme = { ...raw.readme, require: readLines(read(require, "readme requirements")) };
  return config;
}

/** One item per non-blank line, with any list marker removed. */
export function readLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/^\s*([-*]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
}

export function findConfig(repo: string): string | undefined {
  const path = join(repo, "nudgement.json");
  return existsSync(path) ? path : undefined;
}

/** Merge shared lists from the target project's main checkout so older worktrees
 * still recognize current product names and exclusions. */
export function projectConfig(repo: string): ProjectConfig | undefined {
  const own = findConfig(repo);
  const checkout = mainCheckout(repo);
  const main = checkout ? findConfig(checkout) : undefined;
  if (!own) return main ? loadConfig(main) : undefined;
  const config = loadConfig(own);
  if (!main || main === own) return config;
  const other = loadConfig(main);
  const union = (a?: string[], b?: string[]) => (a || b ? [...new Set([...(a ?? []), ...(b ?? [])])] : undefined);
  return {
    ...config,
    copy:
      config.copy || other.copy
        ? { ...other.copy, ...config.copy, properNouns: union(config.copy?.properNouns, other.copy?.properNouns) }
        : undefined,
    hygiene:
      config.hygiene || other.hygiene
        ? {
            ...other.hygiene,
            ...config.hygiene,
            forbiddenPaths: union(config.hygiene?.forbiddenPaths, other.hygiene?.forbiddenPaths),
            forbiddenWords: union(config.hygiene?.forbiddenWords, other.hygiene?.forbiddenWords),
            ignore: union(config.hygiene?.ignore, other.hygiene?.ignore),
          }
        : undefined,
    ignore: union(config.ignore, other.ignore),
  };
}
