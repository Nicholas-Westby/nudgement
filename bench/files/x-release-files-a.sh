#!/usr/bin/env bash
#
# ==============================================================================
# release-files.sh
# ==============================================================================
#
# Description:
#   Lists the files that go into an update download, and nothing else.
#
#   Scripts/deploy-cloudflare.sh builds the zip from the listing, and
#   .githooks/pre-commit asks whether a commit touched anything in it.
#
# Usage:
#   ./Scripts/release-files.sh [OPTIONS]
#
# Options:
#   --filter        Read paths on stdin and print the ones that ship
#   -v, --verbose   Print debug output to stderr
#   -h, --help      Show this help message and exit
#
# Exit codes:
#   0  Success
#   1  General error
#   2  Invalid usage
#
# ==============================================================================

set -uo pipefail

# ------------------------------------------------------------------------------
# Constants
# ------------------------------------------------------------------------------

SCRIPT_NAME="$(basename "$0")"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
readonly SCRIPT_NAME SCRIPT_DIR REPO_ROOT

readonly EXIT_SUCCESS=0
readonly EXIT_ERROR=1
readonly EXIT_USAGE=2

# Directories whose contents never ship.
EXCLUDED_DIRS=("docs" "llm-tasks" ".claude" "Screenshots")

# Directories whose contents always ship, whatever their extension.
INCLUDED_DIRS=("Sources")

# Extensions that never ship outside the included directories.
EXCLUDED_EXTENSIONS=("md")

# ------------------------------------------------------------------------------
# Colours
# ------------------------------------------------------------------------------

if [[ -t 2 ]]; then
    RED=$'\033[0;31m'
    YELLOW=$'\033[0;33m'
    BLUE=$'\033[0;34m'
    RESET=$'\033[0m'
else
    RED=""
    YELLOW=""
    BLUE=""
    RESET=""
fi

# ------------------------------------------------------------------------------
# Global state
# ------------------------------------------------------------------------------

VERBOSE=false
MODE="list"

# ------------------------------------------------------------------------------
# Logging
# ------------------------------------------------------------------------------

log_debug() {
    if [[ "$VERBOSE" == true ]]; then
        printf '%s[DEBUG]%s %s\n' "$BLUE" "$RESET" "$*" >&2
    fi
}

log_warn() {
    printf '%s[WARN]%s %s\n' "$YELLOW" "$RESET" "$*" >&2
}

log_error() {
    printf '%s[ERROR]%s %s\n' "$RED" "$RESET" "$*" >&2
}

# Prints an error and exits with the given code (default 1).
die() {
    local message="$1"
    local code="${2:-$EXIT_ERROR}"
    log_error "$message"
    exit "$code"
}

# ------------------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------------------

# Prints the usage message.
usage() {
    cat <<EOF
Usage: $SCRIPT_NAME [OPTIONS]

List the files that go into an update download.

Options:
  --filter        Read paths on stdin and print the ones that ship
  -v, --verbose   Print debug output to stderr
  -h, --help      Show this help message and exit
EOF
}

# Makes sure every command this script needs is installed.
check_dependencies() {
    local dependency
    for dependency in git printf; do
        if ! command -v "$dependency" >/dev/null 2>&1; then
            die "Required command not found: $dependency"
        fi
    done
    log_debug "All dependencies found"
}

# Makes sure the repository root is a git work tree.
check_repository() {
    if ! git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        die "Not a git repository: $REPO_ROOT"
    fi
    log_debug "Repository root: $REPO_ROOT"
}

# Returns 0 if the path is inside an excluded directory.
is_excluded_dir() {
    local path="$1"
    local dir
    for dir in "${EXCLUDED_DIRS[@]}"; do
        if [[ "$path" == "$dir/"* ]]; then
            return 0
        fi
    done
    return 1
}

# Returns 0 if the path is inside an included directory.
is_included_dir() {
    local path="$1"
    local dir
    for dir in "${INCLUDED_DIRS[@]}"; do
        if [[ "$path" == "$dir/"* ]]; then
            return 0
        fi
    done
    return 1
}

# Returns 0 if the path has an excluded extension.
has_excluded_extension() {
    local path="$1"
    local extension
    for extension in "${EXCLUDED_EXTENSIONS[@]}"; do
        if [[ "$path" == *".$extension" ]]; then
            return 0
        fi
    done
    return 1
}

# Returns 0 if the given path ships, 1 otherwise.
#
# Markdown under Sources/ ships, because a file declared in Package.swift as a
# resource is part of the build whatever its extension.
ships() {
    local path="$1"

    # Validate input
    if [[ -z "$path" ]]; then
        log_warn "Empty path passed to ships()"
        return 1
    fi

    # Excluded directories never ship
    if is_excluded_dir "$path"; then
        log_debug "Excluded (directory): $path"
        return 1
    fi

    # Included directories always ship
    if is_included_dir "$path"; then
        log_debug "Included (directory): $path"
        return 0
    fi

    # Excluded extensions never ship
    if has_excluded_extension "$path"; then
        log_debug "Excluded (extension): $path"
        return 1
    fi

    log_debug "Included: $path"
    return 0
}

# ------------------------------------------------------------------------------
# Modes
# ------------------------------------------------------------------------------

# Reads paths on stdin and prints the ones that ship.
filter_stdin() {
    log_debug "Filtering paths from stdin"
    local path
    local count=0
    local shipped=0
    while IFS= read -r path; do
        if [[ -z "$path" ]]; then
            continue
        fi
        count=$((count + 1))
        if ships "$path"; then
            printf '%s\n' "$path"
            shipped=$((shipped + 1))
        fi
    done
    log_debug "Filtered $count paths, $shipped ship"
}

# Prints every tracked file that ships.
list_tracked_files() {
    log_debug "Listing tracked files"
    local path
    local count=0
    local shipped=0
    while IFS= read -r path; do
        if [[ -z "$path" ]]; then
            continue
        fi
        count=$((count + 1))
        if ships "$path"; then
            printf '%s\n' "$path"
            shipped=$((shipped + 1))
        fi
    done < <(git ls-files)
    log_debug "Listed $count tracked files, $shipped ship"
}

# ------------------------------------------------------------------------------
# Argument parsing
# ------------------------------------------------------------------------------

parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --filter)
                MODE="filter"
                shift
                ;;
            -v|--verbose)
                VERBOSE=true
                shift
                ;;
            -h|--help)
                usage
                exit "$EXIT_SUCCESS"
                ;;
            *)
                log_error "release-files: unknown option: $1"
                usage >&2
                exit "$EXIT_USAGE"
                ;;
        esac
    done
}

# ------------------------------------------------------------------------------
# Main
# ------------------------------------------------------------------------------

main() {
    parse_args "$@"
    log_debug "Mode: $MODE"

    cd "$REPO_ROOT" || die "Could not change directory to $REPO_ROOT"

    case "$MODE" in
        filter)
            filter_stdin
            ;;
        list)
            check_dependencies
            check_repository
            list_tracked_files
            ;;
        *)
            die "Unknown mode: $MODE"
            ;;
    esac

    exit "$EXIT_SUCCESS"
}

main "$@"
