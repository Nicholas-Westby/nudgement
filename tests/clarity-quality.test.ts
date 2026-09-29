import { expect, test } from "bun:test";
import { installReplay } from "../scripts/jev-replay";
import { benchClarity, clarityCases } from "../scripts/suites/clarity";
import { CLARITY_THRESHOLDS } from "../src/clarity";

// Each response was captured from Jev. Testing all four avoids a lucky random sample hiding a regression.
test.each(["0", "1", "2", "3"])(
  "finds explanation gaps without demanding redundant comments (Jev sample %s)",
  async (sample) => {
    const replay = installReplay(sample);
    try {
      const rows = await benchClarity();
      replay.assertComplete();
      for (const fixture of clarityCases) {
        const row = rows.find((row) => row.id === fixture.id)!;
        for (const [name, expected] of Object.entries(fixture.expect)) {
          const reading = row.readings.find((reading) => reading.name === name)!;
          expect(reading, `${fixture.id}: ${name}`).toBeDefined();
          for (const key of ["missing_explanation", "magic_values"] as const) {
            if (expected[key] === undefined) continue;
            expect(reading[key] >= CLARITY_THRESHOLDS[key], `${fixture.id}: ${name}: ${key}`).toBe(expected[key]);
          }
        }
        if (fixture.id === "clear" || fixture.id === "test-data") expect(row.issues).toEqual([]);
      }
    } finally {
      replay.restore();
    }
  },
);
