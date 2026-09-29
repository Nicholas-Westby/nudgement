# Verification baseline

Captured from commit `12544b5` before changing nudgement's behavior, with
Bun 1.4.2. FTA 3.0.1 was installed to measure the original source.

- Unit tests: 212 passed, 0 failed; 523 assertions.
- Coverage: 62.08% lines, 59.85% functions (Bun's loaded-file coverage).
- Typecheck: passed.
- FTA: 23 maintained TypeScript files scored 60 or higher; maximum 93.17.
- Benchmark: the original runner's complete output and readings are saved
  beside this file. Its labels are expectations of model quality, not assertions
  that every model judgment must agree with a human label.

The original benchmark was executed from an archive of the baseline commit.
API request bodies and responses are retained separately in `tests/fixtures/jev`.

## After the changes

| Check | Before | After |
| --- | --- | --- |
| Tests | 212 passing | 239 passing |
| Assertions | 523 | 19,597 |
| Bun reported line coverage | 62.08% | 91.38% |
| Bun reported function coverage | 59.85% | 90.76% |
| Highest FTA score | 93.17 | 59.52 |
| Typecheck | Pass | Pass |
| Biome | Not configured | Pass, fixtures excluded |
| Benchmark | Live requests | Exact baseline parity through offline replay |

The coverage guard sums LCOV hits and totals: 91.25% lines and 92.97% functions,
above the required 90% and 85%. These aggregate ratios differ from Bun's summary.
Coverage measures loaded application modules; spawned CLI processes are tested
but their coverage is not merged. Scripts and test helpers are excluded.
The raw test report and per-file FTA scores are saved beside this file.
All 125 maintained TypeScript files are checked, including benchmark runners;
the complexity test also verifies the file inventory so exclusions cannot
silently hide maintained code.

All 3,170 distinct baseline API requests have four captured responses. Answers
varied for 3,153 requests. Default tests and benchmarks make no API requests,
even with credentials present. An unknown request fails replay without falling
back to the network. `bench/` input samples are unchanged from the baseline.
The README benchmark uses fixed package metadata to prevent ambient checkout
settings from changing requests.

## Self-review

Nudgement reviewed each proposed commit message and the changed code, tests,
comments and README through the live Jev API. Relevant runs:

- `20260929021431-pt1y`: baseline commit message passed.
- `20260929022523-lm2e`: offline fixture code and tests reviewed. The model called
  some existing benchmark scoring and the recorder bloated. Scoring was kept
  to preserve baseline behavior; recorder deduplication and atomic writes avoid
  duplicate paid requests and retain partial captures. This rationale was also
  recorded with `feedback.ts`.
- `20260929023253-cbdj`: refactor review checked 547 requests. Its comment findings
  led to shorter comments and a rewrite of the README-question rationale.
- `20260929024040-bva4`: incomplete-review failure handling and tests passed.
- `20260929024948-y39j`: the final README passed at 90/100 with no findings.
- `20260929024411-y6rn`: CI, the coverage guard and its commit message passed.
- `20260929024831-ubz2`: the complexity inventory check and commit message passed.
- `20260929025054-qmc4`: the documentation commit passed after adding its
  license and verification changes to the message.

The model's remaining warnings were about commit size or message detail; these
are advisory. Successful replay establishes preserved behavior on the recorded
cases, not correctness of every Jev judgment. New safeguards intentionally turn
API failures into failed reviews and validate responses before judging them.

Local validation ran on macOS. The GitHub Actions workflow is configured for
Linux and macOS; hosted CI will run when the repository is pushed.
