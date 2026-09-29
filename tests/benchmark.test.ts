import { expect, spyOn, test } from "bun:test";
import { runBench } from "../bench";
import { installReplay } from "../scripts/jev-replay";

const baseline = await Bun.file(new URL("../docs/verification/baseline-bench.json", import.meta.url)).json();

test("reproduces every recorded benchmark result from the original code", async () => {
  const output = spyOn(console, "log").mockImplementation(() => {});
  const replay = installReplay("baseline");
  try {
    const result = await runBench();
    replay.assertComplete();
    const { at: _before, ...expected } = baseline;
    const { at: _after, ...actual } = result;
    expect(actual).toEqual(expected);
  } finally {
    replay.restore();
    output.mockRestore();
  }
}, 60_000);
