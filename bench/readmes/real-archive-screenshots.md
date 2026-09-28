# Screenshot Archive LaunchAgent

This folder contains a small macOS LaunchAgent setup for archiving screenshots from:

`~/Dev/screenshots/`

to:

`~/Dev/screenshots-archive/`

The important design goal is that this is **not sync**. It is a copy/archive job. If `~/Dev/screenshots/` gets emptied by a VM, a mistaken `rm`, or anything else, the archive folder should not be emptied.

## Files

- `archive-screenshots.zsh` — the script that copies new screenshots into the archive.
- `setup.sh` — installs or reloads the LaunchAgent.
- `uninstall.sh` — unloads and removes the LaunchAgent plist.
- `logs.sh` — shows compacted stdout/stderr logs.
- `README.md` — this file.

## Paths

The screenshot source folder is:

`~/Dev/screenshots/`

The archive destination folder is:

`~/Dev/screenshots-archive/`

The LaunchAgent plist is installed at:

`~/Library/LaunchAgents/com.local.archive-screenshots.plist`

The script run by the LaunchAgent is:

`~/Dev/utilities/src/archive-screenshots/archive-screenshots.zsh`

The logs are written to:

`~/Library/Logs/archive-screenshots.out.log`

and:

`~/Library/Logs/archive-screenshots.err.log`

## How it works

The LaunchAgent runs the archive script every 60 seconds using the LaunchAgent `StartInterval` setting.

The copy script should use `rsync` in copy-only mode:

```zsh
/usr/bin/rsync -aE --ignore-existing "$src" "$dst"
```

Key properties:

- `--ignore-existing` means existing files in the archive are not overwritten.
- There is intentionally no `--delete`.
- Deleting files from `~/Dev/screenshots/` does not delete files from `~/Dev/screenshots-archive/`.
- macOS screenshot filenames normally include timestamps, so filename collisions should be rare.

## Install or update

From this directory:

```zsh
./setup.sh
```

The setup script should:

1. Ensure `archive-screenshots.zsh` is executable.
2. Write the LaunchAgent plist.
3. Validate the plist.
4. Unload any previous copy of the job.
5. Load and start the job.

## Verify the job is loaded

```zsh
launchctl print "gui/$(id -u)/com.local.archive-screenshots"
```

`id -u` prints your numeric Unix user ID, for example `501`.

So this:

```zsh
gui/$(id -u)
```

expands to something like:

```zsh
gui/501
```

That is the per-user GUI launchd domain where user LaunchAgents run.

## Logs

View compacted logs:

```zsh
./logs.sh
```

View more lines:

```zsh
LINES=5000 ./logs.sh
```

The log viewer collapses consecutive repeated or similar entries. For example, many repeated lines like:

```text
no changes
no changes
no changes
```

will display as:

```text
x3  no changes
```

It also normalizes common timestamp prefixes before comparing lines, so repeated messages with different timestamps can still collapse.

## Uninstall

From this directory:

```zsh
./uninstall.sh
```

This unloads the LaunchAgent and removes:

`~/Library/LaunchAgents/com.local.archive-screenshots.plist`

It does **not** delete:

- `~/Dev/screenshots/`
- `~/Dev/screenshots-archive/`
- `archive-screenshots.zsh`
- `setup.sh`
- `logs.sh`
- `README.md`

## Important limitation

Because this runs every 60 seconds, a screenshot could theoretically be created and then deleted from `~/Dev/screenshots/` before the next run. In normal use this is probably fine.

If you want a smaller window, change the `StartInterval` in `setup.sh` from `60` to a smaller number, such as `10`.
