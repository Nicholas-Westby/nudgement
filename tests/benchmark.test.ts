import { expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { runBench } from "../bench";
import { installReplay } from "../scripts/jev-replay";
import { type FileCase, manifests } from "../scripts/suites/common";
import { sortIssues } from "../src/message";

const baseline = await Bun.file(new URL("../docs/verification/baseline-bench.json", import.meta.url)).json();
const clarity = await Bun.file(new URL("../docs/verification/clarity-bench.json", import.meta.url)).json();
const filesystem: { readdirSync(path: fs.PathLike): string[] } = fs;

function orderedSuite(name: string, value: unknown): unknown {
  // Match cases by ID so filesystem order cannot change comparisons with the captured baseline.
  if (name !== "files" && name !== "readmes") return value;
  return (value as { id: string }[]).toSorted((a, b) => a.id.localeCompare(b.id, "en"));
}

test.each([
  { names: ["files-ts.json", "files-swift.json", "files-other.json"] },
  { names: ["files-swift.json", "files-other.json", "files-ts.json"] },
])("loads benchmark manifests in filename order regardless of directory order: %j", ({ names }) => {
  const expected = ["files-other.json", "files-swift.json", "files-ts.json"].flatMap(
    (name) => JSON.parse(fs.readFileSync(new URL(`../bench/${name}`, import.meta.url), "utf8")) as FileCase[],
  );
  const directory = spyOn(filesystem, "readdirSync").mockReturnValue([...names, "readmes.json", "files"]);
  try {
    const ids = manifests<FileCase>("files").map((item) => item.id);
    expect(ids).toEqual(expected.map((item) => item.id));
  } finally {
    directory.mockRestore();
  }
});

test("preserves original benchmark results and adds the recorded clarity findings", async () => {
  const output = spyOn(console, "log").mockImplementation(() => {});
  const replay = installReplay("baseline");
  try {
    const result = await runBench();
    replay.assertComplete();
    const { at: _before, ...expected } = baseline;
    // Extend the historic file results only with clarity readings and warnings; bloat stays unchanged.
    expected.files = expected.files.map((row: { id: string; readings: object; issues: [] }) => {
      const added = clarity.files.find((entry: { id: string }) => entry.id === row.id);
      expect(added, row.id).toBeDefined();
      return {
        ...row,
        readings: { ...row.readings, clarity: added.readings },
        issues: sortIssues([...added.issues, ...row.issues]),
      };
    });
    expected.clarity = clarity.clarity;
    const { at: _after, ...actual } = JSON.parse(JSON.stringify(result));
    expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
    for (const [suite, rows] of Object.entries(expected)) {
      expect(orderedSuite(suite, actual[suite]), suite).toEqual(orderedSuite(suite, rows));
    }
  } finally {
    replay.restore();
    output.mockRestore();
  }
}, 60_000);
