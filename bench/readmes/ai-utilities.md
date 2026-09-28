# utilities

Small tools I use on my Mac. Each one is independent: installing one has no effect on the others.

| Utility                   | What it does                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `me`                      | Claims authorship of the last N commits in whatever repo you are in                                                                                    |
| `src/archive-screenshots` | A LaunchAgent that copies new screenshots from `~/Dev/screenshots/` into `~/Dev/screenshots-archive/` every 60 seconds, never deleting or overwriting |

## After cloning

```zsh
./scripts/setup.sh
```

This turns on the repo's git hooks in `.githooks/`. They enforce conventional-commit subjects and block any term listed in `commit-disallowed-terms.txt`, which is git-ignored so you can edit it to suit.

## me

`me` rewrites the author and committer of the last N commits to your git identity, keeps each commit's original dates, and strips Claude's co-author and session trailers from the messages. Running it again on commits that are already clean changes nothing.

```zsh
me       # the last commit
me -6    # the last 6
```

It builds the new commits with `git commit-tree` and moves the branch once at the end, so uncommitted work is left alone, merge commits keep both parents, and a failure leaves the branch where it was. On success it prints the old tip, so you can `git reset --hard` back to it. It refuses to run mid-rebase, mid-merge, mid-cherry-pick or in a shallow clone.

`./install-me.sh` symlinks `me` into Homebrew's `bin`, or into `~/.local/bin` on a Mac without Homebrew, where it prints the `PATH` line to add. The link points at this clone, so edits to `me.sh` apply at once. The tests are in `./tests/me.test.sh`, and each one works in a throwaway repo in a temp directory.

## Other utilities

Each one lives in `src/<utility>/` with its own README and `setup.sh`:

```zsh
cd src/<utility>
./setup.sh
```

`./claude.sh` starts Claude Code in this repo with a hidden account name, maximum reasoning and a pinned model.

## Contributing

Contributions are welcome! If you have an idea for a new utility or an improvement to an existing one, feel free to open an issue or submit a pull request. Please make sure your code follows the existing style and includes tests where appropriate.

## License

This project is licensed under the MIT License.

## Support

If you run into any problems, please open an issue on GitHub and I'll take a look as soon as I can.
