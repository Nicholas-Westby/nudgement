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
