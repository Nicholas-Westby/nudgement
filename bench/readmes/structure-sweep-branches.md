# sweep-branches

Deletes local git branches that have already been merged into main.

## About

sweep-branches is a small script for cleaning up old branches. After a while a repo collects dozens of local branches whose work was merged long ago, and `git branch` gets hard to read. This script finds the ones that are merged into main and deletes them.

## What it does

- Finds local branches that are already merged into main
- Deletes them
- Leaves main and the branch you are on alone

## Features

- Deletes merged local branches
- Never touches main or your current branch
- Asks before deleting anything
- Works with squash merges

## Install

Copy `sweep-branches` somewhere on your PATH:

```sh
cp sweep-branches ~/.local/bin/
```

## Quick start

```sh
cp sweep-branches ~/.local/bin/
cd your-repo
sweep-branches
```

## Usage

Run it inside a repo:

```sh
sweep-branches
```

It lists the local branches that are merged into main and asks before deleting them. It never deletes main or the branch you are on.

`--base develop` compares against `develop` instead of main. `--yes` skips the question.

## How it works

For each local branch, the script checks whether its changes are already in main. A normal merge is easy to spot, because the branch's last commit is in main's history. A squash merge is harder, because the commits in main are different ones, so for those it checks whether applying the branch's changes to main would change anything. If it wouldn't, the branch counts as merged. Merged branches get deleted after you confirm. main and the branch you're on are skipped.

## Notes

- Only local branches are deleted. Remote branches are left alone.
- It asks before deleting, unless you pass `--yes`.
- main and your current branch are never deleted.
