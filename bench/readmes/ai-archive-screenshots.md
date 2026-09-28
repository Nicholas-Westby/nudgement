# Screenshot Archive

A lightweight yet robust macOS LaunchAgent that seamlessly archives screenshots from `~/Dev/screenshots/` into `~/Dev/screenshots-archive/`.

Unlike a traditional sync solution, it is intentionally designed as a copy-only archive. This ensures that even if the screenshots folder is emptied by a VM, an accidental `rm` or anything else, the archive remains fully intact.

## How it works

Every 60 seconds, the LaunchAgent effortlessly runs `archive-screenshots.zsh`, which leverages `rsync` to copy any new screenshots into the archive:

```zsh
/usr/bin/rsync -aE --ignore-existing "$src" "$dst"
```

- `--ignore-existing` ensures that files already in the archive are never overwritten.
- There is deliberately no `--delete`, so removing a screenshot from the source never affects the archive.
- macOS includes a timestamp in every screenshot's filename, which makes collisions extremely unlikely.

## Install

```zsh
./setup.sh
```

The setup script handles everything for you: it makes the script executable, writes and validates the plist at `~/Library/LaunchAgents/com.local.archive-screenshots.plist`, unloads any previous copy of the job and loads the new one.

To verify that the job is up and running:

```zsh
launchctl print "gui/$(id -u)/com.local.archive-screenshots"
```

## Logs

```zsh
./logs.sh              # the latest entries
LINES=5000 ./logs.sh   # more of them
```

The log viewer intelligently collapses repeated lines, so a run of `no changes` shows as `x3  no changes`, and it normalizes timestamps to provide a clean, streamlined view of what the job has been doing. The raw logs live in `~/Library/Logs/archive-screenshots.out.log` and `archive-screenshots.err.log`.

## Uninstall

```zsh
./uninstall.sh
```

This unloads the job and removes its plist. Your screenshots, your archive and the scripts themselves are left completely untouched.

## Limitations

Because the job runs every 60 seconds, a screenshot that is created and then deleted within the same minute could be missed. For a tighter window, simply lower `StartInterval` in `setup.sh`, for example to `10`.
