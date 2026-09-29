# Testing

`bun test` runs offline, even when API keys are present. Its preload replaces
network requests with recorded responses and rejects missing recordings.
The benchmark regression test compares every result to the saved pre-change
baseline. A changed question or input therefore requires an explicit capture
and a review of the resulting differences.

## Fixtures

- `bench/` contains inputs: code, tests, documents, commit histories and human
  labels. Some samples are intentionally poor. Preserve their text when changing
  parsers, comments or formatting rules.
- `tests/fixtures/jev/` contains actual API request bodies and four responses per
  request. It excludes authorization headers. Sixteen gzip files group requests
  by the first hexadecimal character of their SHA-256 hash, reducing repeated
  question text. The JSON can be inspected with `gzip -dc`.

On 2026-09-29, 3,153 of 3,170 distinct requests returned different answers over
four samples from `jev-latest`. The recordings retain all four; this measurement
does not establish how future model versions will behave.

## Replay and capture

```sh
bun run bench                         # first recorded response, no API calls
JEV_REPLAY_SAMPLE=3 bun run bench      # fourth response
JEV_REPLAY_SAMPLE=random bun run bench # random recorded response per request
bun run bench --sweep                  # inspect thresholds using saved readings
bun run fixtures:record               # capture missing requests; requires an API key
```

`fixtures:record` explicitly enables live requests to `api.typesafe.ai` and can
incur charges. It reuses complete recordings and captures four samples for each
missing request. Add `--refresh` to replace existing samples, or name suites
such as `readmes` or `commits` to limit capture. Review recordings before sharing
them: request bodies contain the source supplied to Jev.

`JEV_REPLAY_SAMPLE=baseline` preserves the original sequence for inputs that
occurred more than once. The regression test uses this mode. Random replay
explores variance; it does not update the baseline or replace deterministic CI.
The human labels measure model quality and can disagree with Jev. The regression
test instead checks that the same responses produce the same evaluation results.

## Local checks

`bun run check` runs Biome, TypeScript, the tests and the FTA limit. Every
maintained TypeScript file, including tests and scripts, must score below 60.
The intentionally varied input fixtures and API recordings are excluded.

`bun run coverage` writes `coverage/lcov.info` and prints line/function coverage.
CI requires 90% line coverage and 85% function coverage, summed from LCOV counts
across loaded application modules; fixtures, test helpers and benchmark scripts
are excluded. CLI behavior is tested in subprocesses, whose
coverage is not included in Bun's parent-process report.
The [baseline](verification/README.md) records the original tests, coverage, FTA
scores and full benchmark results. Keep baseline updates separate from behavior
changes and explain any changed expectations.
