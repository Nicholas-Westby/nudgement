import { afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directories: string[] = [];
export function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "nudgement-test-"));
  directories.push(path);
  return path;
}
afterAll(() => {
  for (const path of directories) rmSync(path, { recursive: true, force: true });
});
