import { join } from "node:path";

export interface Complexity {
  file_name: string;
  fta_score: number;
}
export function complexityScores(): Complexity[] {
  const root = join(import.meta.dir, "..");
  const result = Bun.spawnSync([process.execPath, join(root, "node_modules/fta-cli/index.js"), root, "--json"], {
    cwd: root,
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString() || result.stdout.toString());
  const rows = JSON.parse(result.stdout.toString()) as Complexity[];
  if (
    !rows.some((row) => row.file_name.startsWith("src/")) ||
    !rows.some((row) => row.file_name.startsWith("tests/"))
  ) {
    throw new Error("FTA did not analyze both source and tests");
  }
  return rows;
}

if (import.meta.main) {
  const rows = complexityScores();
  const failures = rows.filter((row) => !Number.isFinite(row.fta_score) || row.fta_score >= 60);
  for (const row of failures) console.error(`${row.file_name}: FTA ${row.fta_score.toFixed(2)} (must be below 60)`);
  console.log(
    `${rows.length} source files analyzed; highest FTA ${Math.max(...rows.map((row) => row.fta_score)).toFixed(2)}.`,
  );
  process.exitCode = failures.length ? 1 : 0;
}
