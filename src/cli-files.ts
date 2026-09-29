import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { loadConfig, type ProjectConfig, projectConfig } from "./config";
import { readFileAt, repoRootOf } from "./git";

export function loadProjectConfig(path: string | undefined, repoRoot: string | undefined): ProjectConfig {
  try {
    if (path) return loadConfig(path);
    return (repoRoot && projectConfig(repoRoot)) || {};
  } catch (error) {
    fail(`${path ? "--config" : "nudgement.json"}: ${error instanceof Error ? error.message : error}`);
  }
}

// Explicit repository arguments anchor paths; otherwise paths use the current directory.
export function readTarget(
  path: string,
  repoArg: string | undefined,
  fileRef: string,
): { path: string; text: string; repo?: string; ref: string; folder?: string } {
  const full = isAbsolute(path) ? path : resolve(repoArg ?? ".", path);
  if (existsSync(full) && statSync(full).isDirectory()) fail(`${path} is a folder; --file takes a file`);
  const root = repoRootOf(existsSync(full) ? dirname(full) : dirname(resolve(repoArg ?? ".")));
  if (!root) {
    if (fileRef !== "worktree") fail(`${path} is not in a git repository, so --hash and --staged do not apply`);
    if (!existsSync(full)) fail(`${path} does not exist`);
    return { path: basename(full), text: readFileSync(full, "utf8"), ref: fileRef, folder: dirname(full) };
  }
  const rel = relative(root, full);
  const text = readFileAt(root, rel, fileRef);
  if (text === undefined) fail(`${rel} does not exist ${fileRef === "worktree" ? "" : `at ${fileRef}`}`.trim());
  return { path: rel, text: text!, repo: root, ref: fileRef };
}

export function readInput(path: string, flagName: string): string {
  if (!existsSync(path)) fail(`${flagName} ${path}: no such file`);
  return readFileSync(path, "utf8");
}

export function fail(message: string): never {
  console.error(`nudgement: ${message}`);
  process.exit(2);
}

// Resolve credentials beside the script when it is run from another repository.
export function loadEnv(): void {
  if (process.env.JEV_API_KEY || process.env.TYPESAFE_API_KEY) return;
  const path = join(import.meta.dir, "..", ".env");
  if (!existsSync(path)) return;
  const env = Bun.env;
  for (const row of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*(JEV_API_KEY|TYPESAFE_API_KEY)\s*=\s*(.*?)\s*$/.exec(row);
    if (match && !env[match[1]]) env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
}
