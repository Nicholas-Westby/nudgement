---
name: using-nudgement
description: Review commit messages, comments, code, tests, UI copy and documentation with nudgement when a project asks for it.
---

# Using nudgement

Run `evaluate.ts` two folders above this skill. Use the checkout directly.
Set `N` to that file's absolute path, then run commands from the project being reviewed.

```sh
# Stage first: the review uses exactly what Git would commit.
bun "$N" . --staged -m "fix(cli): exit successfully for --help" --check-files --repo-check
bun "$N" . --readme
bun "$N" . --file src/jev.ts
```

Use `--amend` instead of `--staged` to include HEAD's changes. Repeat `-m` to
compare drafts. `--help` lists the other review modes and options.

Reviews use the configured Jev API key, send relevant source to TypeSafe, and
may incur charges. `--repo-check` alone runs offline.

An error (`✗`) fails the review; warnings (`!`) and notes (`·`) need judgment.
Fix useful findings. If a finding is wrong, record why with
`bun <nudgement>/feedback.ts <run-id> wrong "<reason>"`.
Exit codes: 0 pass, 1 failed review, 2 usage or Git error, 3 unexpected crash.

Project settings belong in `nudgement.json`. See the README for setup and examples.
