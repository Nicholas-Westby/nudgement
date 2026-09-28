# robin-agents

Personal [Claude Code](https://claude.com/claude-code) skills, plus a footer
under every reply, kept in git and loaded from this clone. There is no install
step and no copy to keep in sync.

## Setup on a new machine

```sh
git clone <this-repo> ~/wherever/robin-agents
cd ~/wherever/robin-agents
node init.ts
```

That sets up both profiles: the `agent-home` and `agent-work` launchers in
`~/.zshrc`, and this repo linked into each profile's config directory. Then
`source ~/.zshrc` and restart Claude Code; the first launch of each profile asks
you to log in. The skills and the reply footer are in **every** session on that
machine, in every profile, whatever directory you start Claude in.

`init.ts` is also how you repair a machine. It is safe to run again any time and
only changes what is missing or out of date. The `setting-up-profiles`
skill walks an agent through it.

Requires Node 22.18+ (or 23.6+), the first versions that run TypeScript
without a flag. Nothing here is built, and the skills themselves have no
dependencies. The reply footer runs under whatever `node` is on your PATH when
Claude starts; with an older one, Claude Code shows a hook error under each
reply instead of the time.

## How it works

Claude keeps its user-level settings, plugins and skills in the directory named
by `CLAUDE_CONFIG_DIR`, falling back to `~/.claude`. Running more than one
profile therefore means more than one config directory. The launchers `init.ts`
puts in `~/.zshrc` start `agent-home` in `~/.claude` and `agent-work` in
`~/.agent-work`; `skills/setting-up-profiles` explains the rest of what
they do.

`init.ts` symlinks this repo into the `skills` folder of both, and of any other
config directory it finds. Claude picks up any directory there containing a
`.claude-plugin/plugin.json` and loads it as a plugin, here
`robin-agents@skills-dir`, with its skills and the hooks in `hooks/hooks.json`.

Because it is a symlink, edits are live: change a `SKILL.md` or a hook, start a
new session, done. Re-run `init.ts` after moving the clone, renaming the plugin,
or setting up a new profile.

### Which directories it links into

| Directory            | When                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `~/.claude`          | Always, created if it is not there yet. It is what Claude uses with no `CLAUDE_CONFIG_DIR` set.                                 |
| `~/.agent-work`     | Always, created if it is not there yet. `agent-work` starts Claude there, so linking first gives its first session everything. |
| `~/.claude-*`        | Once it holds something of Claude's, so an unrelated directory never gets a `skills` folder planted in it.                      |
| `$CLAUDE_CONFIG_DIR` | Whenever it is set and points at a directory that exists. Covers a profile living outside `$HOME`.                              |

Beyond the two the launchers use, nothing is hardcoded, so a profile set up on
one machine and absent on another is simply not a target there. Each step is
handled on its own: one that fails is reported and the rest still happen.

Running it is safe to repeat. For `~/.zshrc` it reports `added`, `updated`
(saying where it backed the file up first) or `already current`. Per directory
it reports `created`, `already linked`, `repointed` or `skipped`, and refuses to
touch a real directory already sitting at the target rather than deleting
anything.

```
robin-agents -> /home/dev/src/robin-agents

  already current  ~/.zshrc
  already linked   ~/.claude/skills/robin-agents
  created          ~/.agent-work/skills/robin-agents

2 skills: how-i-work, how-to-commit
Restart Claude Code to load them, and the reply footer, as robin-agents@skills-dir.
```

## Reply footer

After every reply, `hooks/hooks.json` runs `hooks/reply-footer.ts` as a Stop
hook. What it prints shows up under the reply; for now, the time the reply
finished. Claude Code puts the hook's name in front of it:

```
Stop says: 10:40AM
```

It goes out as a `systemMessage`, which Claude Code shows to you and leaves out
of what it sends to the model, so the footer costs no tokens however much it
grows. It loads with the plugin, so every linked profile has it with no
settings to edit.

The line is built from `SEGMENTS` in `hooks/footer.ts`, one small function per
piece (`clock.ts` so far). To show something new, such as how long the reply
took, what it cost or a number from the project, add a segment. The header of
`footer.ts` says what a segment gets to work with and what to watch out for.

## Adding a skill

```
skills/<skill-name>/SKILL.md
```

With frontmatter:

```markdown
---
name: skill-name
description: Use when <the situations that should trigger this skill>
---
```

Two rules worth following:

- `description` is what Claude reads to decide whether to load the skill. Write
  it in the third person and list **triggering conditions only**.
- Don't summarize the skill's steps in the `description` — Claude will follow
  that summary instead of reading the body.

See `skills/how-to-commit/` for a working example to copy.

A skill that has to _do_ something keeps its scripts in
`skills/<skill-name>/scripts/`, in TypeScript like the rest of the repo, run
with `node <script>.ts` and tested by the same `npm test`. See
`skills/harborline-worktrees/` for one.

## Tests

```sh
npm test     # node --test, no dependencies
```

`init.ts` is a thin front end over a few modules, so the interesting parts can be
driven against throwaway directories instead of your real home directory:

- `claude-config-dirs.ts`: which config directories are on this machine
- `link-plugin.ts`: linking the repo into one of them
- `skills/setting-up-profiles/scripts/`: the launcher block, and putting
  it in `~/.zshrc`

Tests live beside each as `*.test.ts`. `init.test.ts` runs `init.ts` itself
against a throwaway home directory: a fresh machine, a second run, a broken
`~/.zshrc`.

The footer in `hooks/` is covered the same way, down to running the command in
`hooks/hooks.json` as Claude Code would. So are the `harborline-worktrees`
scripts, against a throwaway repository shaped like the Harborline site rather
than the real one.

## Formatting

Markdown here is formatted by [Prettier](https://prettier.io): table pipes get
aligned, list markers normalized, stray whitespace dropped. Prose line breaks
are left exactly where you put them. Settings live in `prettier.config.ts`.

A [husky](https://typicode.github.io/husky) pre-commit hook does it for you:

```sh
npm install      # installs the hook — once per clone
npm run format   # or format every Markdown file by hand
```

The hook formats the _staged_ copy of each file, so a file you have only partly
staged keeps its unstaged edits out of the commit. Skip it for one commit with
`git commit --no-verify`.

`.husky/pre-commit.ts` just runs the checks listed in `CHECKS`; each one lives in
its own module beside it (`format-markdown.ts` so far). Add a check by writing a
module and adding it to that list.

## Verifying

```sh
claude plugin list                             # expect: robin-agents@skills-dir ... ✔ loaded
claude plugin details robin-agents@skills-dir   # skills found, token cost
claude plugin validate .                       # manifest is well-formed
echo '{}' | node hooks/reply-footer.ts         # expect: {"systemMessage":"10:40AM"}
```

Put `CLAUDE_CONFIG_DIR="$HOME/.agent-work"` in front of any of them to check a
profile other than the default.
