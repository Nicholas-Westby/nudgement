#!/usr/bin/env bash
# The files that go into an update download, and nothing else.
#
#   ./Scripts/release-files.sh            list every tracked file that ships
#   ./Scripts/release-files.sh --filter   read paths on stdin, print the ones that ship
#
# Two callers, one rule. Scripts/deploy-cloudflare.sh builds the zip from the
# listing; .githooks/pre-commit asks whether a commit touched anything in it,
# because a version bump for a docs-only commit advertises an update that
# downloads a build nobody would notice.
#
# The tracked set is the starting point, so everything .gitignore already keeps
# out — .build, .git, the worktrees, the logs, the screenshots — is out for
# free, and nothing untracked and unreviewed can ride along.
#
# What is dropped on top of that: the writing about the app, which the app does
# not build from. Markdown under Sources/ is the exception, because a file
# declared in Package.swift as a resource is part of the build whatever its
# extension.
set -uo pipefail
cd "$(dirname "$0")/.."

ships() {
    case "$1" in
        docs/*|llm-tasks/*|.claude/*|Screenshots/*) return 1 ;;
        Sources/*) return 0 ;;
        *.md) return 1 ;;
        *) return 0 ;;
    esac
}

if [[ "${1-}" == "--filter" ]]; then
    while IFS= read -r path; do
        [[ -n "$path" ]] || continue
        ships "$path" && printf '%s\n' "$path"
    done
    exit 0
fi

if [[ $# -gt 0 ]]; then
    echo "release-files: unknown option: $1" >&2
    exit 2
fi

git ls-files | while IFS= read -r path; do
    ships "$path" && printf '%s\n' "$path"
done
