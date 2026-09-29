# Contributing

Install Bun and run `bun install --frozen-lockfile`, then `bun run check`.
The tests and benchmark replay need no API key. `bun run coverage` enforces the
coverage floor used by CI. See [testing](testing.md) before updating recordings.

Keep changes focused and use Conventional Commits. Before committing, stage the
change and review it with `bun evaluate.ts . --staged -m "your message"` if you
have a Jev key. Consider the findings; do not weaken behavior just to improve a
score. API reviews send the selected content to TypeSafe and can incur charges.

Preserve intentionally poor samples in `bench/`. Add a regression case when
fixing a parser or review rule, and explain any intended change to the saved
benchmark expectations. Comment on constraints, edge cases and reasons that
are not obvious from the code.
