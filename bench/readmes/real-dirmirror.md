# dirmirror

Mirror project folders between a macOS **host** and its macOS **guest** VM
over SSH. It runs on the **host**, so the host decides exactly what syncs.

It exists because the usual guest/host bridge, virtiofs shared folders,
corrupts its cache when many small files change, so syncing whole repos through
it is unsafe. dirmirror copies over SSH with `rsync` instead, and refuses to
touch any virtiofs mount in the guest.

## Running it

dirmirror is TypeScript that Node runs directly. There is no build step, no
install step, and nothing goes on your `PATH`. You need **Node 22.18 or newer**
(any version that runs TypeScript files natively) and nothing else: dirmirror has
zero runtime dependencies, so it works with `node_modules` absent entirely.

```bash
./dirmirror          # start the wizard
./dirmirror setup    # one-time setup (see below)
```

## One-time setup

1. In the **guest** VM: System Settings, General, Sharing, turn on **Remote Login**.
2. On the **host**: get this repo (a previously synced copy works), then run
   `./dirmirror setup`. It finds the running VM by itself, reading macOS's DHCP
   leases and keeping the guests that answer on the SSH port, so there is no
   address to look up. It writes `~/.config/dirmirror/`, creates a **dedicated**
   key for reaching the guest (`~/.ssh/dirmirror_ed25519`) rather than using your
   main `~/.ssh/id_ed25519`, and prints a ready-to-paste one-liner, with that
   key's public half already in it, to run in the guest to authorize this host.

## Assumptions about your environment

dirmirror was built for one specific machine. The table lists what it assumes. If
your setup differs, change these during `./dirmirror setup`, from the wizard's
`s) settings` screen, or by editing `~/.config/dirmirror/config` by hand.

| Assumption         | Default                                                                             | How to change                    |
| ------------------ | ----------------------------------------------------------------------------------- | -------------------------------- |
| Where you run it   | the macOS **host**; the guest is a macOS VM (e.g. Tart)                             | n/a                              |
| Guest address      | found at `setup` from DHCP leases plus an open SSH port; re-run `setup` if it moves | `s) settings`, then 1            |
| Reaching the guest | SSH key auth as `GUEST_USER`; the guest has **Remote Login** on                     | `s) settings`, then 2            |
| Guest repo folder  | `/home/<guest user>/Dev`; new mappings default to `<base>/<name>`                  | `s) settings`, then 3            |
| Host repo folder   | `/Volumes/Tera/dev`; a new mapping's host path is suggested from its guest path     | `s) settings`, then 4            |
| SSH key            | dedicated `~/.ssh/dirmirror_ed25519`, created at `setup`, never your main key        | n/a                              |
| Guest host key     | pinned on first connect into `~/.config/dirmirror/known_hosts`                       | delete that file after a rebuild |
| Config + mappings  | `~/.config/dirmirror/` on the host                                                   | `DIRMIRROR_CONFIG_DIR` env var    |
| Logging            | off; `.dirmirror/dirmirror.log` beside the tool, git-ignored                          | `l` in the menu                  |
| Folders it refuses | any **virtiofs** mount, found by asking the guest for its mount table               | automatic                        |

## Use

Run `./dirmirror`. Pick a mapping, pick a direction (pull is guest to host, push
is host to guest), review the dry-run preview, confirm. Add, group, ungroup,
rename or delete mappings from the same menu, press `s` for settings, where
addresses, base paths and the ignore list are all editable in place, and `l`
to start or stop logging the session. Each sync is a mirror
(`rsync -a --delete`): the destination is made to match the source exactly.
If a pair's source folder is missing (the guest side for a pull, the
host side for a push), dirmirror refuses instead of running rsync, and does the
same if the guest can't be reached to say either way.

When a path is asked for, type it plainly, drag the folder in from Finder, or
paste it in quotes. The escaping a terminal adds is undone either way, and the
wizard says whether the folder was `found:` or will be created on first sync.

When you add a mapping, the host path it suggests follows the guest one: the
same relative place under the host base if the guest folder is under the guest
base, under your home instead if it is under the guest's home but outside that
base, or just its last folder name under the host base otherwise. The suggestion
shows in brackets; press Enter to accept it, or type a path to replace it.

Regenerable noise is ignored automatically (`node_modules`, `bin`, `obj`,
`packages`, `dist`, `.build`, `App_Data`, `umbraco/Data`, `umbraco/Logs`,
`wwwroot/assets`, `wwwroot/bundle`, `.dirmirror`, caches, editor droppings) and
the preview prints the active `Ignoring:` list. Add your own
patterns, or force-include ignored ones, from the wizard's `s) settings` screen
(choices 5 and 6). Each is a numbered list you add to and delete from one
pattern at a time, and a change applies to the very next sync. They are stored
as `EXCLUDES` and `INCLUDES` in the config if you would rather edit the file.
They are space-separated, so a pattern cannot itself contain a space, and the
wizard refuses one that does.

The `1all` and `2all` menu choices sync everything, skipping the ignore list,
which is handy for the first transfer. A folder deleted on the source cannot be
removed from the destination while ignored files are still sitting in it, so the
preview names those folders instead of deleting what the ignore list exists to
keep.

Files whose contents are identical on both sides but whose timestamps have
drifted are tagged `(metadata-only)` in the preview. Syncing them just repairs
the timestamps. The check reads only the files the preview flagged, not the
whole folder, so its cost tracks the number of changes rather than the repo
size. The `1all` and `2all` full transfers skip it.

`.git` is synced, since the mirror is a full clone, but its internals collapse
in previews to a single `.git: N files` line, and bare directory timestamp
updates are not listed at all.

A pair can carry a post-transfer command (menu: `p`) that runs under bash at the
destination folder after a completed transfer, for example reinstalling git
hooks the mirror overwrote. Commands belong to a folder, not a mapping: in a
grouped mapping, each folder runs only its own.

When rsync fails, dirmirror prints the exit status, the exact command it ran
(paste it back into a shell to reproduce the failure), and the first line of
`rsync --version` from both sides, since openrsync and GNU rsync disagreeing
about the protocol is usually why a transfer dies with `unexpected end of
file`. If the guest can't be reached for its version, that line says so
instead of hanging.

Press `l` in the menu to start logging the session, or stop it — it asks
nothing either way. The answer is saved, so it stays on until you turn it off
again, covering `./dirmirror setup` as well as the wizard. A session is recorded
in full to `.dirmirror/dirmirror.log`, beside the tool and git-ignored:
everything printed, every question and the answer given, every command dirmirror
ran with its exit status and how long it took, and rsync's own output. The
post-transfer command's script and its output are left out, since either can
carry a token.

## Where settings live

You should not need to go looking. The wizard's `s) settings` screen edits the
config file below and prints its path at the top, and mappings are edited from
the main menu. For the record:

`~/.config/dirmirror/config` on the host holds `GUEST_IP`, `GUEST_USER`,
`GUEST_BASE`, `HOST_BASE`, `EXCLUDES`, `INCLUDES` and `LOGGING`. It keeps the
familiar `KEY="value"` shape and is still meant to be hand-edited: quoted or
bare values, an `export` prefix, a comment after a value, and either line ending
all work. What changed is that dirmirror now reads it as data rather than running
it as a shell script, so a backtick or a `$(...)` in a folder name is a folder
name and nothing more. Any line dirmirror did not write, including a note of your
own or a `DEFAULT_EXCLUDES` or `SSH_KEY` override, is kept when a setting
changes.

`~/.config/dirmirror/pairs` holds one pair per line, as
`name<TAB>guest_path<TAB>host_path[<TAB>post_command]`. Lines sharing a name
form one **mapping** and sync together. The wizard can split one apart too
(menu: `u`).

`~/.config/dirmirror/known_hosts` holds the pinned guest host key.

Point `DIRMIRROR_CONFIG_DIR` at a throwaway directory to test against a scratch
config. The session log is the exception: it lives at `.dirmirror/dirmirror.log`
beside the tool, and that variable has no say over it.

## Development

```bash
npm install          # dev tooling only; dirmirror itself needs no packages
npm test             # complexity gate, then the test suite
npm run check        # format, types, lint, complexity and coverage
```

`npm run check` is what has to pass. It runs, in order:

| Step           | What it enforces                                                   |
| -------------- | ------------------------------------------------------------------ |
| `format:check` | Prettier formatting                                                |
| `typecheck`    | `tsc` under `strict`, plus `noUncheckedIndexedAccess`              |
| `lint`         | ESLint with type-aware rules                                       |
| `complexity`   | [fta](https://github.com/sgb-io/fta) score of 60 or lower per file |
| `coverage`     | Vitest, with floors set just under what the suite reaches          |

`npm run complexity:report` prints every file's score without failing, which is
the quicker way to see what is drifting upward.

### How the code is laid out

Side effects go through four small interfaces in `src/ports/`: running a
command, reading and writing files, talking to the terminal, and waiting. Real
implementations live in `src/adapters/` and fakes in `tests/support/`, which is
why the whole wizard, including previews and transfers, can be tested without a
VM, an SSH connection or a real rsync.

| Directory       | What lives there                                      |
| --------------- | ----------------------------------------------------- |
| `src/domain/`   | Paths, mappings and validation. Pure functions        |
| `src/config/`   | Reading and writing the config and pairs files        |
| `src/ssh/`      | The guest client, virtiofs checks, VM discovery       |
| `src/sync/`     | rsync arguments, preview parsing, the transfer itself |
| `src/wizard/`   | The menu loop, one file per screen                    |
| `src/setup/`    | The one-time bootstrap                                |
| `src/adapters/` | The implementations that touch the operating system   |
