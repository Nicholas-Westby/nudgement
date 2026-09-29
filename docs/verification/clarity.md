# Missing explanations and magic values

Before this change, commit `8833528` passed 241 offline tests with 91.25% line
and 92.97% function coverage. A live review of `src/hygiene-files.ts`
(`20260929053010-2jat`) called it lean, with no warnings on `where`,
`commitMessages`, `sizes` or `globToRegex`. The existing questions asked about
comment bloat but not missing explanations or obscure literals.

The new language-independent clarity questions review every non-import unit,
including single-line constants, in batches with surrounding file context.
Partial reviews only produce findings for touched units. Source and test-file
reviews both run the checks; failures still fail the enclosing review.
Clarity warnings do not change the existing bloat scores or failure thresholds.

`bench/clarity.json` supplies human-labelled before/after examples. Three pairs
come from this repository's Git helpers and duplicate-code metrics. Other cases
cover Python timestamp units, Swift bit masks, redundant commentary and clear
uncommented code. Tests check all four real Jev responses for each example.
The warning thresholds are 0.5 for missing explanations and 0.65 for magic values.
These values separate the labelled examples; they do not imply perfect detection.

The original `baseline-bench.json` is unchanged. `clarity-bench.json` records only
the additional file readings/warnings and the new clarity suite. Regression tests
compare complete results against their combination. Existing bloat verdicts,
scores and unit findings still match the original baseline.

After the new checks: 251 tests passed, line coverage was 91.42%, and function
coverage was 93.22%. Every maintained TypeScript file remained below FTA 60.
The recorded API dataset grew from 3,170 to 3,361 distinct requests, each with
four responses; old recordings were retained. Ordinary tests remain offline.

## Applying the checks to nudgement

A repository-wide pass covered the 125 previously tracked TypeScript files,
excluding input fixtures. The final questions were also run against the saved
pre-edit source, so the comparison uses the same prompts and thresholds.
In the 20 files revised after the detector commit, warnings fell from 65 to 28.
This is one live comparison, not an accuracy estimate or a promise of zero noise.

The changes explain Git log/tree formats and name their separators, document
why glob conversion needs a placeholder, describe duplicate-window detection,
and clarify comment scanning, Swift token handling, request deduplication,
concurrency handoff and score weights. `hygiene-files.ts`, `history-read.ts`
and `code-metrics.ts` had 15 warnings before and none afterward. `where` now
shows the diagnostic format it produces; parsing helpers explain their format
assumptions instead of making readers decode escape sequences and captures.
[Before/after readings](clarity-self-review.json) retain the run IDs and findings.

The feature's staged self-review (`20260929054448-gtk8`) passed. Its findings led
to clearer evaluation entry-point comments and a more descriptive test helper
name. Advisory bloat and multi-behavior-test warnings were retained: batching
bounds request size, and each regression checks the full result of one review
contract across several labelled inputs.
