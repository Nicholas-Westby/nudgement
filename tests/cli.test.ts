import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { temporaryDirectory } from "./temp-dir";

const root = join(import.meta.dir, "..");
function cli(args: readonly string[], cwd = temporaryDirectory()) {
  const result = Bun.spawnSync(
    [process.execPath, "--preload", join(import.meta.dir, "cli-preload.ts"), join(root, "evaluate.ts"), ...args],
    { cwd },
  );
  return { code: result.exitCode, out: result.stdout.toString(), error: result.stderr.toString() };
}

test("prints help successfully when run directly from another directory", () => {
  const result = cli(["--help"]);
  expect(result.code).toBe(0);
  expect(result.error).toContain("nudgement — review code, commits and writing");
  expect(result.error).toContain("nudgement.json");
});

test.each([{ args: [] }, { args: ["--check-file"] }, { args: ["--file", "missing.ts"] }])(
  "reports invalid arguments as usage errors: %j",
  ({ args }) => {
    expect(cli(args).code).toBe(2);
  },
);

test("returns failure and structured findings for an incomplete source review", () => {
  const cwd = temporaryDirectory();
  writeFileSync(join(cwd, "price.ts"), "export const price = 12;\n");
  const result = cli(["--file", "price.ts", "--json"], cwd);
  expect(result.code).toBe(1);
  const report = JSON.parse(result.out);
  expect(report.verdict).toBe("fail");
  expect(report.jev.failed).toBe(1);
  expect(report.issues[0].message).toContain("Network disabled in CLI tests");
});
