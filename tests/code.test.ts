import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeCode, countUsage, isBloatCandidate, isGenerated, usesInFile } from "../src/code";
import { CODE_THRESHOLDS, type FileEvaluation, judgeFile, verdictFromUnits } from "../src/code-evaluate";
import type { Answer, Answers } from "../src/jev";
import { formatFileReport } from "../src/report";
import { temporaryDirectory } from "./temp-dir";

const TS = `import { a } from "./a";
import b from "./b";

/** Adds one. */
export function addOne(n: number): number {
  return n + 1;
}

export const double = (n: number) =>
  n * 2;

export async function load(
  url: string,
  retries = 3
): Promise<string> {
  const res = await fetch(url);
  return res.text();
}

// ---- helpers ----

class Store {
  items: string[] = [];
  add(item: string) {
    this.items.push(item);
  }
}

export interface Options {
  verbose: boolean;
}
`;

describe("analyzeCode units", () => {
  const { units, language } = analyzeCode("src/store.ts", TS)!;
  const byName = Object.fromEntries(units.map((unit) => [unit.name, unit]));

  test("detects the language from the extension", () => {
    expect(language).toBe("ts");
  });

  test("names each top-level declaration and groups the imports", () => {
    expect(units.map((unit) => unit.name)).toEqual(["(imports)", "addOne", "double", "load", "Store", "Options"]);
    expect(byName["(imports)"].kind).toBe("imports");
  });

  test("attaches a doc comment to the declaration below it", () => {
    expect(byName.addOne.startLine).toBe(4);
    expect(byName.addOne.endLine).toBe(7);
    expect(byName.addOne.text.startsWith("/** Adds one. */")).toBe(true);
  });

  test("keeps a multi-line signature in one unit", () => {
    expect(byName.load.startLine).toBe(12);
    expect(byName.load.endLine).toBe(18);
    expect(byName.load.kind).toBe("function");
  });

  test("treats an arrow function constant as a function", () => {
    expect(byName.double.kind).toBe("function");
  });

  test("leaves a banner separated by a blank line out of every unit", () => {
    expect(units.some((unit) => unit.text.includes("---- helpers"))).toBe(false);
    expect(byName.Store.startLine).toBe(22);
  });

  test("marks exported declarations", () => {
    expect(byName.addOne.exported).toBe(true);
    expect(byName.Store.exported).toBe(false);
    expect(byName.Options.kind).toBe("type");
  });

  test("keeps a small class whole", () => {
    expect(byName.Store.kind).toBe("class");
    expect(units.some((unit) => unit.name === "Store.add")).toBe(false);
  });
});

test("splits a large class into its members", () => {
  const body = Array.from({ length: 5 }, (_, i) => `  method${i}() {\n    return ${i};\n  }\n`).join("\n");
  const source = `export class Big {\n  private count = 0;\n\n${body}}\n`;
  const { units } = analyzeCode("big.ts", source, { splitLines: 10 })!;
  expect(units.map((unit) => unit.name)).toEqual([
    "Big",
    "Big.method0",
    "Big.method1",
    "Big.method2",
    "Big.method3",
    "Big.method4",
  ]);
  expect(units[1].startLine).toBe(4);
  expect(units[1].endLine).toBe(6);
});

test("splits C# namespaces and classes down to methods", () => {
  const source = `using System;

namespace Shop
{
    public class Cart
    {
        private readonly List<int> _items = new();

        /// <summary>Adds an item.</summary>
        public void Add(int item)
        {
            _items.Add(item);
        }

        public int Count()
        {
            return _items.Count;
        }
    }
}
`;
  const { units } = analyzeCode("Cart.cs", source, { splitLines: 8 })!;
  expect(units.map((unit) => unit.name)).toEqual(["(imports)", "Cart", "Cart.Add", "Cart.Count"]);
  const add = units.find((unit) => unit.name === "Cart.Add")!;
  expect(add.startLine).toBe(9);
  expect(add.kind).toBe("function");
  expect(add.exported).toBe(true);
});

test("handles Python decorators, classes and main blocks", () => {
  const source = `import os


@cache
def load(path):
    with open(path) as f:
        return f.read()


class Store:
    def __init__(self):
        self.items = []

    def add(self, item):
        self.items.append(item)


if __name__ == "__main__":
    print(load("x"))
`;
  const { units } = analyzeCode("store.py", source)!;
  const names = units.map((unit) => unit.name);
  expect(names).toEqual(["(imports)", "load", "Store", 'if __name__ == "__main__":']);
  expect(units[1].startLine).toBe(4);
  expect(units[1].exported).toBe(true);
});

describe("analyzeCode metrics", () => {
  test("counts code, comment and blank lines", () => {
    const { metrics } = analyzeCode("a.ts", "// one\n/*\n * two\n */\nconst a = 1; // trailing\n\nconst b = 2;\n")!;
    expect(metrics.commentLines).toBe(4);
    expect(metrics.codeLines).toBe(2);
    expect(metrics.blankLines).toBe(1);
  });

  test("finds repeated blocks of four or more lines", () => {
    const block =
      "  const total = items.reduce((sum, item) => sum + item.price, 0);\n  const tax = total * rate;\n  const shipping = total > 100 ? 0 : 10;\n  return total + tax + shipping;\n";
    const source = `function a(items, rate) {\n${block}}\n\nfunction b(items, rate) {\n${block}}\n`;
    const { metrics } = analyzeCode("a.js", source)!;
    expect(metrics.repeatedLines).toBe(8);
    expect(metrics.repeatedExamples).toEqual([[2, 9]]);
  });

  test("does not count fields that two type declarations share as repeated code", () => {
    const fields =
      "  readonly name: StationName;\n  readonly sensorId: string;\n  readonly unit: string;\n  readonly installedAt: Temporal.Instant;\n  readonly range: Range;\n";
    const source = `export type NewStation = {\n${fields}  readonly interval: Duration;\n};\n\nexport type ActiveStation = {\n  readonly id: StationId;\n${fields}  readonly lastSeenAt: Temporal.Instant;\n};\n`;
    expect(analyzeCode("station.ts", source)?.metrics.repeatedLines).toBe(0);
  });

  test("still counts an object mapping written out twice as repeated code", () => {
    const mapping =
      "    name: row.name,\n    sensorId: row.sensor_id,\n    unit: row.unit,\n    installedAt: toInstant(row.installed_at),\n    range: toRange(row.range),\n";
    const source = `function a(row) {\n  return {\n${mapping}  };\n}\n\nfunction b(row) {\n  return {\n${mapping}    id: row.id,\n  };\n}\n`;
    expect(analyzeCode("rows.ts", source)?.metrics.repeatedLines).toBe(10);
  });

  test("counts try blocks and log calls", () => {
    const source = "try {\n  console.log('a');\n  logger.info('b');\n} catch (e) {\n  console.error(e);\n}\n";
    const { metrics } = analyzeCode("a.ts", source)!;
    expect(metrics.tryBlocks).toBe(1);
    expect(metrics.logCalls).toBe(3);
  });

  test("reports the longest unit", () => {
    const { metrics } = analyzeCode("src/store.ts", TS)!;
    expect(metrics.longestUnit).toEqual({ name: "load", lines: 7 });
  });
});

test("returns nothing for files that are not code", () => {
  expect(analyzeCode("data.json", "{}")).toBeUndefined();
});

test("counts the other files in a repo that use each name", async () => {
  const repo = temporaryDirectory();
  const run = (...args: string[]) => Bun.spawnSync(["git", "-C", repo, ...args]);
  run("init", "-q");
  writeFileSync(join(repo, "lib.ts"), "export function helper() {}\nexport function unused() {}\n");
  writeFileSync(join(repo, "a.ts"), "import { helper } from './lib';\nhelper();\n");
  writeFileSync(join(repo, "b.ts"), "import { helper } from './lib';\n// helperish is a different word\n");
  run("add", ".");
  run("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");

  const counts = await countUsage(repo, "worktree", "lib.ts", ["helper", "unused"]);
  expect(counts.get("helper")).toBe(2);
  expect(counts.get("unused")).toBe(0);
  const atHead = await countUsage(repo, "HEAD", "lib.ts", ["helper"]);
  expect(atHead.get("helper")).toBe(2);
});

test("splits a large Swift enum used as a namespace", () => {
  const body = Array.from(
    { length: 3 },
    (_, i) =>
      `    static func step${i}(_ value: Int) -> Int {\n        let doubled = value * 2\n        return doubled + ${i}\n    }\n`,
  ).join("\n");
  const source = `public enum Steps {\n${body}}\n`;
  const { units } = analyzeCode("Steps.swift", source, { splitLines: 8 })!;
  expect(units.map((unit) => unit.name)).toEqual(["Steps.step0", "Steps.step1", "Steps.step2"]);
});

test("keeps a large type whole when its members are all one-liners", () => {
  const members = Array.from({ length: 12 }, (_, i) => `  field${i}(value: string): void;`).join("\n");
  const { units } = analyzeCode("api.ts", `export interface Api {\n${members}\n}\n`, { splitLines: 8 })!;
  expect(units.map((unit) => unit.name)).toEqual(["Api"]);
});

test("does not start a unit at a C# preprocessor line", () => {
  const source = `namespace Shop
{
    public class Cart
    {
#pragma warning disable 0109
        public int Count()
        {
            return 1;
        }
#pragma warning restore 0109
    }
}
`;
  const { units } = analyzeCode("Cart.cs", source, { splitLines: 6 })!;
  expect(units.map((unit) => unit.name)).toEqual(["Cart.Count"]);
});

test("spots generated files", () => {
  expect(isGenerated("Models/Typical.generated.cs", "")).toBe(true);
  expect(isGenerated("api.pb.go", "")).toBe(true);
  expect(isGenerated("src/a.ts", "// Code generated by protoc. DO NOT EDIT.\nexport {}")).toBe(true);
  expect(isGenerated("src/a.ts", "// <auto-generated />\n")).toBe(true);
  expect(isGenerated("src/a.ts", "export const a = 1;\n")).toBe(false);
});

test("counts uses of a name elsewhere in the file, and ignores names that are not identifiers", () => {
  const text = "function helper() {}\nhelper();\nconst x = helper() + helperish;\nif (a) {\n}\n";
  expect(usesInFile(text, "function helper() {}", "helper")).toBe(2);
  expect(usesInFile(text, "if (a) {\n}", "if (a) {")).toBe(0);
  expect(usesInFile("$x = 1; $x;", "$x = 1;", "$x")).toBe(1);
});

test("only programming-language files get the bloat check", () => {
  expect(isBloatCandidate("src/app.tsx")).toBe(true);
  expect(isBloatCandidate("scripts/bootstrap.sh")).toBe(true);
  expect(isBloatCandidate("src/config.ts")).toBe(true);
  for (const path of [
    "wrangler.jsonc",
    "package.json",
    ".gitignore",
    "migrations/0001.sql",
    "src/styles.css",
    "config.yaml",
    "Cargo.toml",
    "vitest.config.ts",
    "playwright.config.mjs",
    "web/vite.config.js",
    ".eslintrc.cjs",
    "stryker.conf.js",
  ]) {
    expect(isBloatCandidate(path)).toBe(false);
  }
});

test("treats an extensionless script with a shebang as code", () => {
  const script =
    '#!/bin/sh\nset -eu\n\n# Homebrew puts node on the PATH only after this shell starts.\neval "$(/opt/homebrew/bin/brew shellenv)"\nnpm ci\n';
  expect(isBloatCandidate("bootstrap", script)).toBe(true);
  expect(isBloatCandidate("bootstrap")).toBe(false);
  expect(analyzeCode("bootstrap", script)?.language).toBe("sh");
});

describe("judgeFile", () => {
  const noulOf = (value: number): Answer => ({ type: "noul", noul: value });
  const choiceOf = (value: string): Answer => ({
    type: "choice",
    choice: value,
    confidence: 0.6,
    probabilities: { [value]: 0.6 },
  });
  const leanFile = (overrides: Answers): Answers => ({
    ...Object.fromEntries(Object.keys(CODE_THRESHOLDS.patterns).map((key) => [key, noulOf(0.1)])),
    overbuilt: { type: "score", score: 0.3, confidence: 0.8, probabilities: {} },
    rewrite_length: choiceOf("about_the_same"),
    justified_complexity: noulOf(0.8),
    simpler_exists: noulOf(0.1),
    ceremony: noulOf(0.1),
    reviewer_simplify: noulOf(0.1),
    ai_style: noulOf(0.1),
    biggest_problem: choiceOf("nothing"),
    ...overrides,
  });
  const parts = (answers: Answers) => judgeFile(answers, {}).issues.map((issue) => issue.part);

  test("never fails a file under 30 lines of code as bloated, only warns", () => {
    const bloated = leanFile({
      overbuilt: { type: "score", score: 2.4, confidence: 0.8, probabilities: {} },
      simpler_exists: noulOf(0.7),
      ceremony: noulOf(0.7),
      reviewer_simplify: noulOf(0.7),
    });
    expect(judgeFile(bloated, {}, 80).verdict).toBe("bloated");
    const small = judgeFile(bloated, {}, 20);
    expect(small.verdict).toBe("ok");
    expect(small.issues.filter((issue) => issue.severity === "error")).toEqual([]);
  });

  test("shows a strong pattern on a lean file only when Jev also calls it the biggest problem", () => {
    expect(judgeFile(leanFile({ thin_wrappers: noulOf(0.9) }), {}).verdict).toBe("lean");
    expect(parts(leanFile({ thin_wrappers: noulOf(0.9) }))).not.toContain("thin wrappers");
    expect(parts(leanFile({ thin_wrappers: noulOf(0.9), biggest_problem: choiceOf("thin_wrappers") }))).toContain(
      "thin wrappers",
    );
  });
});

test("reports how many changed functions were flagged when only those were judged", () => {
  const evaluation: FileEvaluation = {
    kind: "file",
    runId: "r",
    version: "v",
    path: "src/store.ts",
    verdict: "ok",
    leanness: 0,
    metrics: analyzeCode("src/store.ts", TS)?.metrics,
    issues: [],
    units: [
      {
        name: "load",
        kind: "function",
        startLine: 5,
        endLine: 11,
        codeLines: 6,
        otherFiles: 1,
        issues: [
          {
            severity: "warn",
            part: "load",
            message: "More machinery than its job needs.",
            source: "jev:overbuilt=1.56/3",
          },
        ],
        readings: {},
      },
    ],
    unitsNotJudged: 0,
    readings: {},
    jev: { requests: 1, failed: 0, inputTokens: 0, ms: 0 },
  };
  const title = formatFileReport(evaluation, false, true).split("\n")[0];
  expect(title).toBe("OK  src/store.ts  1 of 1 changed functions flagged  (bloat check)");
  const outsideFunctions = formatFileReport({ ...evaluation, verdict: "lean", units: [] }, false, true).split("\n")[0];
  expect(outsideFunctions).toBe("LEAN  src/store.ts  no changed functions to judge  (bloat check)");
});

test("reads Swift properties with a setter access level or an attribute as their own members", () => {
  const filler = Array.from({ length: 6 }, (_, i) => `    func step${i}() -> Int {\n        return ${i}\n    }`).join(
    "\n",
  );
  const source = `public final class Engine {
    public internal(set) var transfers = 0
    /// The loop, kept so a test can await it.
    @ObservationIgnored public internal(set) var tickTask: Task<Void, Never>?
    @ObservationIgnored public var tickSleep: (Duration) async throws -> Void = { try await Task.sleep(for: $0) }
    public static let slowRound = Duration.seconds(1)
${filler}
}
`;
  const units = analyzeCode("Engine.swift", source, { splitLines: 8 })!.units;
  const byName = new Map(units.map((unit) => [unit.name, unit]));
  expect(units.map((unit) => unit.name)).not.toContain("Engine.internal");
  expect(byName.get("Engine.transfers")?.startLine).toBe(2);
  const slow = byName.get("Engine.slowRound")!;
  expect(slow.endLine - slow.startLine).toBe(0);
});

test("judging only the changed functions, a file fails on an error, not on warnings however many", () => {
  const unit = (severity: "warn" | "error") => ({ issues: [{ severity, part: "x", message: "m", source: "s" }] });
  expect(verdictFromUnits([unit("warn"), unit("warn"), unit("warn")])).toBe("ok");
  expect(verdictFromUnits([unit("error")])).toBe("bloated");
  expect(verdictFromUnits([])).toBe("lean");
});
