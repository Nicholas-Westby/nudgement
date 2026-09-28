---
name: using-the-evaluator
description: Use when about to commit, amend or reword a commit, or when writing or reviewing code comments, tests, UI copy, a README, or a commit history, in a project that checks its work with the evaluator, or when a project's instructions say to run the evaluator.
---

# Using the evaluator

It judges commit messages, new comments, code bloat, tests, UI copy, READMEs,
commit history and repo hygiene. Exact rules run in code; judgement calls go to
TypeSafe's Jev model. The report prints to the terminal in about a second;
exit code 1 means it failed.

The evaluator sits two folders above this skill's own folder (the base
directory shown when the skill loads). Always run that copy, the live one:
`E=<skill folder>/../../evaluate.ts`.

## Which command

| Situation | Command |
| --- | --- |
| Before a commit (`git add` first) | `bun $E . --staged -m "<msg>" --check-files --repo-check` |
| Before `git commit --amend` | the same with `--amend` in place of `--staged` |
| Choosing between messages | repeat `-m`; drafts are ranked |
| A commit already made | `bun $E . --hash <sha>` (or `--range a..b`) |
| One file | `bun $E . --file <path>`: code gets the bloat check, `*.test.ts` and Swift files with tests the test check, `.md` the README check |
| A view's user-facing text | `bun $E . --copy <view.tsx or View.swift>`: SwiftUI views get Apple's title style for buttons and menus |
| The README | `bun $E . --readme` |
| The history, before reworking it | `bun $E . --history` |
| A design spec or a plan | `bun $E . --design <spec.md>`, `bun $E . --plan <plan.md> --design <spec.md>` |

A project can keep an `evaluator.json` at its top, holding its spec, required
README content, commit rules, forbidden words and who reads the UI. It is used
automatically; pass `--config <file>` only for a config kept elsewhere.

## Reading the report

```
FAIL  staged changes  score 36/100
  ✗ [subject] The first line is 89 characters; the limit is 72.
  ✗ [human] Uses wording typical of AI text...  (jev:ai_filler=0.97)
  ! [type] The type "chore" may not fit this change.  (jev:type_fits=0.55)
run 20260927062421-xgpu · evaluator 4957a62 · 9 Jev requests · 410 ms
```

- Exit code 0 is a pass, 1 a failure, 2 bad usage, 3 a crash.
- `✗` fails the run. Fix it, unless you are sure the finding is wrong.
- `!` is advice. Fix it when it is right; never make good code or a good
  comment worse just to silence it.
- `(jev:sounds_human=0.22)` is Jev's probability. Near 0.5, or marked
  "Borderline", it is a judgement call and yours to make.
- `lint:`, `fact:` and `hygiene:` findings are exact rules.

When a finding is wrong, record it before moving on, with the run id printed at
the bottom of the report:
`bun <skill folder>/../../feedback.ts <run-id> wrong "<why>"`

## Common mistakes

- Running `evaluate.ts` from any other checkout of the evaluator: that is a
  development copy.
- Checking with `--staged` before `git add`: it judges only what is staged.
- Piping the report into `head` or `grep`, which hides the exit code.
- Checking an amend with `--staged`: the message is then judged against the
  staged change alone.

The full flag list and what each check asks are in
`<skill folder>/../../README.md`; read it only when this is not enough.
