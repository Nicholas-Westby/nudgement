import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

export const BENCH = join(import.meta.dir, "..", "..", "bench");

export const RESULTS = join(BENCH, "results");

export const args = process.argv.slice(2);

export type CommitCase = {
  id: string;
  repo: string;
  hash: string;
  message: string;
  expect: { verdict: string; human: boolean; problems: string[] };
  note?: string;
};

export type CommentCase = {
  id: string;
  file: string;
  language: string;
  comment: string;
  code_before: string;
  code_after: string;
  expect: { good: boolean; kind: string; narrates: boolean; human: boolean };
  note?: string;
};

export type FileCase = {
  id: string;
  file: string;
  pair?: string | null;
  severity: string;
  expect: { verdict: string; problems: string[] };
  units?: { name: string; problems: string[] }[];
  note?: string;
};

export type ContradictionCase = {
  id: string;
  file: string;
  language: string;
  comment: string;
  code_before: string;
  code_after: string;
  contradicts: boolean;
  borderline?: boolean;
};

export type CoverageCase = { id: string; file: string; covers_edges: boolean; borderline?: boolean; note?: string };

export type HistoryCase = {
  id: string;
  repo: string;
  hash: string;
  expect: { folds: boolean; mixes: boolean; into?: string; borderline?: boolean };
  note?: string;
};

export type ReadmeCase = {
  id: string;
  file: string;
  pair?: string | null;
  severity: string;
  expect: { verdict: string; human: boolean; problems: string[] };
  note?: string;
};

export async function pool<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await work(items[index]);
      }
    }),
  );
  return results;
}

export const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "-");

// Clone bundled histories on demand, keeping benchmark inputs independent of local repositories.
let cloneRoot: string | undefined;

const clones = new Map<string, string>();

export function benchRepo(name: string): string {
  if (!cloneRoot) {
    const root = mkdtempSync(join(tmpdir(), "bench-repos-"));
    process.on("exit", () => rmSync(root, { recursive: true, force: true }));
    cloneRoot = root;
  }
  if (!clones.has(name)) {
    const dir = join(cloneRoot, name);
    const clone = Bun.spawnSync(["git", "clone", "-q", "--no-checkout", join(BENCH, "repos", `${name}.bundle`), dir], {
      stderr: "pipe",
    });
    if (clone.exitCode !== 0) throw new Error(`could not clone bench/repos/${name}.bundle: ${clone.stderr.toString()}`);
    clones.set(name, dir);
  }
  return clones.get(name)!;
}

export function manifests<T>(prefix: string): T[] {
  return readdirSync(BENCH)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
    .sort()
    .flatMap((name) => JSON.parse(readFileSync(join(BENCH, name), "utf8")));
}

export function problemTable(
  rows: { expected: string[]; sources: string }[],
  vocabulary: Record<string, RegExp>,
): void {
  console.log("  problem                  found / labelled   false alarms");
  for (const [problem, pattern] of Object.entries(vocabulary)) {
    let tp = 0,
      fn = 0,
      fp = 0;
    for (const row of rows) {
      const expected = row.expected.includes(problem);
      const found = pattern.test(row.sources);
      if (expected && found) tp++;
      else if (expected) fn++;
      else if (found) fp++;
    }
    if (tp + fn + fp)
      console.log(
        `  ${problem.padEnd(24)} ${String(tp).padStart(3)} / ${String(tp + fn).padEnd(3)}  ${pct(tp, tp + fn).padStart(5)}     ${fp}`,
      );
  }
}

// For each pair, the leaner or better version should score higher.
export function pairTable<R extends { case: { pair?: string | null; severity: string; id: string } }>(
  results: R[],
  scoreOf: (result: R) => number,
  better: string[],
): void {
  const groups = new Map<string, R[]>();
  for (const result of results)
    if (result.case.pair) groups.set(result.case.pair, [...(groups.get(result.case.pair) ?? []), result]);
  let right = 0,
    total = 0;
  const wrong: string[] = [];
  for (const members of groups.values()) {
    for (const good of members.filter((m) => better.includes(m.case.severity))) {
      for (const bad of members.filter((m) => !better.includes(m.case.severity))) {
        total++;
        if (scoreOf(good) > scoreOf(bad)) right++;
        else wrong.push(`${good.case.id} ${scoreOf(good)} <= ${bad.case.id} ${scoreOf(bad)}`);
      }
    }
  }
  console.log(
    `  pairs ranked right: ${right}/${total} (${pct(right, total)})${wrong.length ? `\n    wrong: ${wrong.join("\n    wrong: ")}` : ""}`,
  );
}

export const benchDoc = (file: string) => ({ path: basename(file), text: readFileSync(join(BENCH, file), "utf8") });

export const rounded = (value: unknown) =>
  JSON.stringify(value, (_, v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v));
