# utilities

A set of small utilities I use on my Mac.

Each utility lives in its own folder under `src/` with its own README and `setup.sh`. They're independent — installing one has no effect on the others.

## Utilities

- [`src/archive-screenshots`](src/archive-screenshots) — a LaunchAgent that copies new screenshots from `~/Dev/screenshots/` into `~/Dev/screenshots-archive/` every 60 seconds. Copy-only (no delete, no overwrite), so the archive survives if the source is wiped.

## After cloning

```zsh
./scripts/setup.sh
```

Activates the in-repo git hooks (`.githooks/`) for this clone. The hooks enforce conventional-commit subjects and block any term listed in `commit-disallowed-terms.txt` (git-ignored, edit to suit).

## The `me` command

`me.sh` claims authorship on the last N commits of whatever repo you're standing in: it rewrites both the author and committer fields to your git identity, preserves each commit's original author and committer dates, and strips Claude's co-author and session trailers from the messages. Re-running it is a no-op on commits that are already clean.

It builds the replacement commits with `git commit-tree` and moves the branch once at the end, so no old version of the tree is ever checked out. Uncommitted work stays where it is, generated files that an older commit used to track (`playwright-report/`, `dist/`) are left alone, and merge commits keep both parents. Either the whole rewrite lands or the branch does not move; on success it prints the old tip so you can `git reset --hard` back to it.

`-N` names the range `HEAD~N..HEAD`, so a merge inside that range also pulls in everything the merge brought with it; the summary line says how many commits were walked and how many ended up with new hashes. It refuses to run mid-rebase, mid-merge or mid-cherry-pick, and in a shallow clone, where rewriting would strand git's saved state or truncate the history for good.

To make it available everywhere:

```zsh
./install-me.sh
```

That symlinks `me` into Homebrew's `bin` — `/opt/homebrew/bin` on Apple Silicon, `/usr/local/bin` on Intel — which `brew shellenv` already puts on `PATH`, so no shell profile is touched and no `sudo` is needed. On a machine without Homebrew it falls back to `~/.local/bin` and prints the `PATH` line to add.

```zsh
me       # claim the last commit
me -6    # claim the last 6
```

The link points at this clone, so edits to `me.sh` take effect immediately. Run `install-me.sh` again on each machine you clone to, or after moving the clone. Uninstall with `rm "$(command -v me)"`.

## Tests

```zsh
./tests/me.test.sh
```

Behaviour tests for `me.sh`. Each one builds a throwaway repo in a temp directory and asserts on the history it produces, so nothing outside that temp directory is touched.

## Installing a utility

```zsh
cd src/<utility>
./setup.sh
```

Each utility's README documents its own setup, uninstall, and logs commands.

## Working in this repo with Claude Code

```zsh
./claude.sh
```

Wrapper that launches `claude` with privacy-friendly defaults (hidden account, max reasoning, pinned to Opus 4.7).

## Layout

```
src/
  <utility>/
    README.md      what it does and how to use it
    setup.sh       install / reload
    uninstall.sh   remove (where applicable)
    ...            the actual scripts
```
