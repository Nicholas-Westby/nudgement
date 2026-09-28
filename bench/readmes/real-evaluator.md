# Commit, comment, code and README evaluator

Uses TypeSafe's Jev model to judge four things:

- a commit message: Conventional Commits, house style, does it sound human
- the code comments a commit adds: do they explain why, do they sound human
- a code file: is it bloated or overengineered
- a README: does it sound human, is it succinct and well structured

Code does the exact checks, and Jev answers many narrow questions in
parallel: one request per comment, function, class or README section. A run
takes about a second.

## Use it

Always run the live copy. It only changes when a tested version is promoted.

```sh
E=~/tools/evaluator/live/evaluate.ts

# Before committing: the staged changes plus the message you intend to use
bun $E /path/to/repo --staged -m "feat(api): add retry to token refresh

- The auth server 502s for a few seconds during deploys"

# After committing (defaults to HEAD)
bun $E /path/to/repo --hash abc123

# Several drafts at once, ranked best first
bun $E /path/to/repo --staged -m "fix(chat): log why a reply was withdrawn" -m "fix(chat): record the withdrawal reason"

# Every commit on a branch
bun $E /path/to/repo --range main..HEAD

# Is this file bloated or overengineered? (working tree; add --hash or --staged for other versions)
bun $E /path/to/repo --file src/sync.ts

# Check the README, or any Markdown file with --file
bun $E /path/to/repo --readme
```

| Flag                      | What it does                                                   |
| ------------------------- | -------------------------------------------------------------- |
| `--staged -m "<msg>"`     | Judge a proposed message against `git diff --cached`           |
| `--message-file <path>`   | Read the proposed message from a file instead of `-m`          |
| `--hash <sha> -m "<msg>"` | Try a reworded message against an existing commit's diff       |
| `--range <a>..<b>`        | Judge every non-merge commit in the range                      |
| `--check-files`           | Also judge each code file and README the commit changes        |
| `--file <path>`           | Judge a file: code for bloat, Markdown as a README             |
| `--readme`                | Judge the README at the top of the repo                        |
| `--no-comments`           | Skip the code comments                                         |
| `--json`                  | Full result as JSON, including every Jev reading               |
| `--verbose`               | Show every Jev reading and every comment, flagged or not       |
| `--tag <name>`            | Label the run in the logs                                      |

Exit code 0 means pass, 1 means at least one error or a bloated file, 2 means
bad usage or a git problem.

With `--check-files`, a file the commit mostly wrote is judged whole. In a file
it only edited, just the functions and classes it touched are judged, so old
bloat is not blamed on the commit.

## Reading the result

- `✗` error: fix it. Any error fails the run.
- `!` warning: worth fixing, doesn't fail the run.
- `·` note: a suggestion, including Jev's pick of the weakest part.

Each Jev finding shows the question and its probability, like
`(jev:sounds_human=0.22)`, so a doubtful finding can be weighed. Findings
tagged `lint:` are exact rules checked in code.

A code file gets a verdict of LEAN, OK or BLOATED, and only BLOATED fails.
Findings are listed for the file as a whole and for each function or class,
with its line range and how many other files in the repo use it.

The scores out of 100 are rough single numbers for comparing two drafts. The
issues are what matter.

## House rules checked in code

- First line is `type(scope): subject`, 72 characters at most, no trailing
  period, lowercase start, imperative mood.
- Type is one of feat, fix, docs, refactor, test, chore, perf, build, ci,
  style, revert.
- Body is optional: at most 3 `- ` bullets, each under 80 characters, no prose
  paragraphs, no Markdown, no emoji.
- Trailers (`Co-Authored-By:`, `See: <ticket>`) are ignored when judging.

## What Jev is asked

All the wording is in `src/questions.ts` and the thresholds are in
`THRESHOLDS` in `src/evaluate.ts`.

For the message: does it sound human, AI filler words, vague benefit claims,
padding, imperative mood, generic subject, tone, whether the type and scope
fit the diff, which type fits best, whether the subject is accurate and names
the main change, how specific it is, unsupported claims, missing changes,
whether it should be split, whether each bullet is accurate and adds
something, whether there should be fewer or more bullets, and which part most
needs work.

For each comment: does it sound human, does it explain why or restate what,
does it narrate the edit ("now uses X instead of Y"), is it worth keeping,
does the code contradict it, is it the right length, and what to do with it.

For a code file (`src/code-questions.ts`, thresholds in `src/code-evaluate.ts`):
how overbuilt it is, how long a rewrite would be, whether the complexity is
justified, and one question each for premature abstraction, speculative
options, defensive checks, duplication, thin wrappers, longhand logic, comment
bloat, dead code, excess logging, reinventing built-ins, doing too many jobs,
and too many types. Each function or class gets its own request with the
same kinds of questions plus what a reviewer would do with it. Code works out
the structure first: where each function and class starts and ends, and how
many other files use its name.

For a README (`src/readme-questions.ts`, thresholds in
`src/readme-evaluate.ts`): does it sound human, AI filler, marketing, does it
say what the project is, does it show usage, how long a rewrite would be,
padding, too much structure, boilerplate, repetition, poor organization, and
being too thin. Each section gets its own request. Code checks the links,
anchors, `run` scripts, files named in commands, and headings.

## Observability

Every Jev call and every run is appended to `logs/` (shared by the live copy
and the development copy):

- `logs/calls-YYYY-MM-DD.jsonl`: request, answers, latency, tokens, retries
- `logs/runs-YYYY-MM-DD.jsonl`: input, verdict, issues, readings, evaluator version

`bun stats.ts` summarizes them. `bun stats.ts --run <id>` shows one run in full.

## Development

Work happens on `main` in this folder. `live/` is a git worktree on the
`live` branch, and is what other sessions run. To promote a tested version:

```sh
git -C live merge --ff-only main
```

`bun test` runs the unit tests. `bun bench.ts` runs the labelled benchmark
against Jev, and `bun bench.ts --sweep` finds the best threshold for each
reading from the last run.
