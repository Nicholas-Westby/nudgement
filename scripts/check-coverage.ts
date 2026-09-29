import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const tests = Bun.spawnSync([process.execPath, "test", "--coverage"], {
  cwd: root,
  stdout: "inherit",
  stderr: "inherit",
});
if (tests.exitCode !== 0) process.exit(tests.exitCode);

// Sum LCOV counts explicitly; the guard measures the whole loaded application.
const lcov = readFileSync(join(root, "coverage", "lcov.info"), "utf8");
const total = (key: string) =>
  [...lcov.matchAll(new RegExp(`^${key}:(\\d+)$`, "gm"))].reduce((sum, match) => sum + Number(match[1]), 0);
const checks = [
  { name: "lines", found: total("LF"), hit: total("LH"), minimum: 0.9 },
  { name: "functions", found: total("FNF"), hit: total("FNH"), minimum: 0.85 },
];
for (const check of checks) {
  const coverage = check.found ? check.hit / check.found : 0;
  console.log(`Coverage: ${(coverage * 100).toFixed(2)}% ${check.name}; minimum ${check.minimum * 100}%.`);
  if (coverage < check.minimum) process.exitCode = 1;
}
