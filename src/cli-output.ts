import type { HygieneEvaluation } from "./hygiene";
import { type AnyEvaluation, failed, formatAny } from "./report";

export function finish(
  results: AnyEvaluation[],
  json: boolean,
  verbose: boolean,
  hygiene?: HygieneEvaluation,
  after?: () => void,
): never {
  const all = hygiene ? [...results, hygiene] : results;
  if (json) console.log(JSON.stringify(all.length === 1 ? all[0] : all, null, 2));
  else {
    console.log(all.map((result) => formatAny(result, verbose)).join(`\n\n${"─".repeat(60)}\n\n`));
    after?.();
  }
  process.exit(all.some(failed) ? 1 : 0);
}
