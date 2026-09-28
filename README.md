# Commit, code and writing evaluator

Uses TypeSafe's Jev model to judge:

- a commit message: Conventional Commits, house style, does it sound human
- the code comments a commit adds: do they explain why, do they sound human
- a code file: is it bloated or overengineered
- a README: does it sound human, is it succinct and well structured
- a test file: does each test check real behaviour, exactly, and could it ever fail
- a view's UI copy: plain words, sentence case, buttons that say what happens, helpful errors
- a commit history: focused steps, no leftovers, nothing that belongs folded in
- a design spec and an implementation plan: concrete and decided, each task
  test first, and every requirement in the spec has a task
- repo hygiene (no Jev): files, words and secrets that must never be committed

Code does the exact checks, and Jev answers many narrow questions in
parallel: one request per comment, function, class or README section. A run
takes about a second.

## Use it

Always run the live copy. It only changes when a tested version is promoted.

```sh
E=<this folder>/live/evaluate.ts

# Before committing: the staged changes plus the message you intend to use
bun $E /path/to/repo --staged -m "feat(api): add retry to token refresh

- The auth server 502s for a few seconds during deploys"

# After committing (defaults to HEAD)
bun $E /path/to/repo --hash abc123

# Several drafts at once, ranked best first
bun $E /path/to/repo --staged -m "fix(cart): log why a discount was refused" -m "fix(cart): record the refusal reason"

# Every commit on a branch
bun $E /path/to/repo --range main..HEAD

# Is this file bloated or overengineered? (working tree; add --hash or --staged for other versions)
bun $E /path/to/repo --file src/sync.ts

# Check the README, or any Markdown file with --file
bun $E /path/to/repo --readme

# A design spec, a plan, and whether the plans between them cover the spec
bun $E . --design docs/superpowers/specs/2026-09-27-export-design.md
bun $E . --plan docs/superpowers/plans/2026-09-27-export.md --design docs/superpowers/specs/2026-09-27-export-design.md
```

### With a project config

A config file holds a project's settings: its spec (so a design the spec asks
for is not called speculative), what the README must cover, commit rules such
as "no trailers", files and words that must never be committed, and who reads
the UI. Kept as `evaluator.json` at the top of the repo, it is used without
`--config`; this repo's own is one example. In a git worktree, the lists in
the main checkout's `evaluator.json` (proper nouns, forbidden words, ignored
paths) are added to the worktree's own, so a name added after it branched
still counts.

```sh
# Before each commit: message, comments, changed files, the README if it
# changed, and the staged files' hygiene
bun $E . --staged -m "<message>" --check-files --repo-check

# The README or the whole repo on their own, and the whole history
bun $E . --readme
bun $E . --repo-check
bun $E . --history

# One test file, or one view's user-facing strings
bun $E . --file tests/integration/checkout.test.ts
bun $E . --copy src/views/checkout.tsx
bun $E . --copy Sources/App/ExportSheet.swift
```

Flags such as `--context` and `--require` override the config.

| Flag                      | What it does                                                   |
| ------------------------- | -------------------------------------------------------------- |
| `--staged -m "<msg>"`     | Judge a proposed message against `git diff --cached`           |
| `--message-file <path>`   | Read the proposed message from a file instead of `-m`          |
| `--amend -m "<msg>"`      | Judge a message for `git commit --amend`: HEAD plus the staged changes |
| `--hash <sha> -m "<msg>"` | Try a reworded message against an existing commit's diff       |
| `--range <a>..<b>`        | Judge every non-merge commit in the range                      |
| `--check-files`           | Also judge each code file and README the commit changes        |
| `--file <path>`           | Judge a file: code for bloat, Markdown as a README             |
| `--readme`                | Judge the README at the top of the repo                        |
| `--tests <file>`          | Judge a test file (test files given to --file get this too)    |
| `--copy <file>`           | Judge a view's user-facing strings (TSX or SwiftUI)            |
| `--history`               | Judge the whole commit history (or --range of it)              |
| `--design <spec.md>`      | Judge a design spec                                            |
| `--plan <plan.md>`        | Judge an implementation plan (repeatable)                      |
| `--plan <p> --design <s>` | Also report spec requirements no task implements               |
| `--repo-check`            | Hygiene: forbidden files and words, secrets, trailers, basics  |
| `--config <file>`         | Project settings; defaults to `evaluator.json` in the repo     |
| `--context <file>`        | A spec for the project, used by the file checks                |
| `--require "<content>"`   | Something the README must cover (repeatable)                   |
| `--require-file <file>`   | README requirements, one per line                              |
| `--no-comments`           | Skip the code comments                                         |
| `--json`                  | Full result as JSON, including every Jev reading               |
| `--verbose`               | Show every Jev reading and every comment, flagged or not       |
| `--tag <name>`            | Label the run in the logs                                      |

Exit code 0 means pass, 1 means at least one error or a bloated file, 2 means
bad usage or a git problem.

With `--check-files`, a file the commit mostly wrote is judged whole. In a file
it only edited, just the functions and classes it touched are judged, so old
bloat is not blamed on the commit. A changed file under
`docs/superpowers/specs/` or `plans/`, or any `*-design.md`, gets the design or
plan check instead.

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

For a test file (`src/test-evaluate.ts`): code finds each test and counts
assertions, weak matchers, mocks, sleeps and CSS selectors, and catches a
leftover `.only`. Jev judges each test: does it check behaviour rather than
implementation details, are its assertions exact, is it over-mocked, would it
still pass if the code returned wrong results, is its name a plain sentence
that matches what it checks, does it check one thing, could it be flaky.
Swift files that hold `@Test` functions or XCTest `test` methods get the same
check (`src/swift-tests.ts`), where `#expect(x != nil)` and `XCTAssertNotNil`
count as weak and a disabled test as a skipped one. Fakes and fixtures beside
them hold no tests, so they get the bloat check.

For UI copy (`src/copy-evaluate.ts`): each user-facing string is pulled out
with its role (heading, button, link, label, error...). In TSX the TypeScript
parser reads the JSX. In a SwiftUI view (`src/copy-swift.ts`) a scanner reads
the calls: `Button("…")` is a button, `.help("…")` a tooltip, a `Label` inside
a `Menu` a menu item, and a `var errorDescription` or `var title` in a model
counts too. Code catches ALL CAPS, Title Case, apologies, jargon, vague buttons,
exclamation marks and file paths; Jev judges plain words, sentence case,
passive voice, hype, wordiness, and whether buttons and errors say what
they should. Swift views follow Apple's rules instead: title style ("Add to Favorites") is right
for buttons, menu items and window titles, and a sheet's Cancel or Done is not
vague. `--check-files` judges the copy of any Swift file whose strings the
commit touched. Names that keep their capitals, such as a product or a
payment service, go in `"copy": { "properNouns": [...] }`.

For a history (`src/history.ts`): code flags leftover commits (wip, fixup!),
empty subjects, reverts, merges, oversized commits, most of the code landing
in one commit, and message rule breaks. Jev reads the whole list for the
story, and each commit for whether it mixes unrelated changes or belongs folded
into an earlier one. Only a commit that corrects a slip in a recent one, such
as a typo, a type error or a forgotten docs line, counts as one to fold; a bug
found later keeps its own commit.

For a design spec (`src/design-evaluate.ts`, questions in `src/plan-questions.ts`):
code finds placeholders (TBD, TODO, "to be decided", ???), open questions still
listed, lists ending in "etc." and outcomes nobody can test ("works well", "is
fast"). Jev reads the spec for a human voice, AI filler, whether it says what
problem it solves and what is out of scope; each section for whether it is
concrete, leaves a decision open without saying so, or could be built two ways;
each item under a "Decisions" heading for a missing reason (only a note: Jev
cannot reliably tell which decisions need one); and each quoted UI string with
the copy check's rules. Reasons, scope and findings sections, contents lists
and quotes of the person who asked are not judged as design.

For a plan (`src/plan-evaluate.ts`): code finds the tasks ("### Task N") and,
for each, the files it names, whether a failing test comes before the
implementation (or a step checks the work by hand), the command to run, and
placeholders such as "similar to Task 3", "add appropriate error handling" or
`...` standing for code. Jev asks whether an engineer new to the codebase could
carry out the task, whether it bundles unrelated work, whether a step says what
without how, and whether its tests would fail if the behaviour were wrong. With
`--design`, code takes each requirement from the spec's behaviour sections (the
sections the plan's Spec line names, when it names them; at most 120, taken
evenly) and picks the few tasks sharing its rarer words, and Jev says which of
them builds it. Repeat `--plan` when several plans implement one spec.

The hygiene check (`src/hygiene.ts`) uses no Jev at all: forbidden files and
words (in files, file names and commit messages), secrets, trailers when the
config forbids them, a nested git repository, a missing README, .gitignore
or lockfile, large files, and TODO notes in source.

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
