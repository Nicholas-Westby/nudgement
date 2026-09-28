#!/usr/bin/env bash
# Install Fieldmark on a Mac that has nothing but macOS on it.
#
#   curl -fsSL https://fieldmark.example/install.sh | bash
#   curl -fsSL https://fieldmark.example/install.sh | bash -s -- --yes
#   curl -fsSL https://fieldmark.example/install.sh | bash -s -- --dest ~/Applications
#
# Anything after `bash -s --` is passed to setup.sh, which is what actually
# builds and installs. It asks once before doing anything slow unless --yes
# says not to.
#
# This file is published by deploy-cloudflare.sh, which fills in the address
# below. The copy in the repo carries a placeholder, so a copy that was never
# published cannot quietly point somewhere it should not.
#
# Environment:
#   FIELDMARK_INSTALL_BASE         Where version.json and the download live
#   FIELDMARK_INSTALL_RETRIES      How many times to try each download (default: 1)
#   FIELDMARK_INSTALL_RETRY_DELAY  Seconds to wait between attempts (default: 2)
#   FIELDMARK_INSTALL_KEEP_TEMP    Set to 1 to keep the temporary folder (default: 0)
#   FIELDMARK_INSTALL_DEBUG        Set to 1 to print debug output (default: 0)
#
# Everything is inside one function that is called on the very last line. A
# download piped straight into a shell runs whatever arrived, so a connection
# cut in half has to run nothing at all rather than half an install.
set -euo pipefail

# The temporary folder, script-scoped rather than local to the function: the
# EXIT trap below runs after the function has returned, and a local would be
# gone by then.
work=""

if [[ -t 2 ]]; then
    RED=$'\033[0;31m'
    DIM=$'\033[2m'
    RESET=$'\033[0m'
else
    RED=""
    DIM=""
    RESET=""
fi

# ---- Logging -----------------------------------------------------------------

timestamp() {
    date '+%Y-%m-%d %H:%M:%S'
}

log_debug() {
    if [[ "${FIELDMARK_INSTALL_DEBUG:-0}" == "1" ]]; then
        printf '%s[%s] [DEBUG] %s%s\n' "$DIM" "$(timestamp)" "$*" "$RESET" >&2
    fi
}

log_info() {
    printf '[%s] [INFO] %s\n' "$(timestamp)" "$*" >&2
}

log_error() {
    printf '%s%s%s\n' "$RED" "$*" "$RESET" >&2
}

log_step() {
    echo "==> $*"
    log_debug "Step started: $*"
}

# ---- Helpers -----------------------------------------------------------------

# Removes the temporary folder, unless FIELDMARK_INSTALL_KEEP_TEMP=1.
cleanup() {
    log_debug "cleanup() called"
    if [[ "${FIELDMARK_INSTALL_KEEP_TEMP:-0}" == "1" ]]; then
        log_info "Keeping the temporary folder at $work"
        return 0
    fi
    if [[ -n "$work" && -d "$work" ]]; then
        log_debug "Removing $work"
        rm -rf "$work"
    fi
    log_debug "cleanup() finished"
}

# download <url> <output> <max-time> [silent]
#
# Fetches <url> into <output> over HTTPS, trying up to FIELDMARK_INSTALL_RETRIES
# times and waiting FIELDMARK_INSTALL_RETRY_DELAY seconds between attempts.
download() {
    local url="$1" output="$2" max_time="$3" mode="${4:-}"
    local attempts="${FIELDMARK_INSTALL_RETRIES:-1}"
    local delay="${FIELDMARK_INSTALL_RETRY_DELAY:-2}"
    local attempt=1
    local flags=(-fL)
    if [[ "$mode" == "silent" ]]; then
        flags=(-fsSL)
    fi

    log_debug "download() url=$url output=$output max_time=$max_time attempts=$attempts"
    while true; do
        log_debug "Attempt $attempt of $attempts: $url"
        if curl "${flags[@]}" --proto '=https' --tlsv1.2 --max-time "$max_time" -o "$output" "$url"; then
            log_debug "Downloaded $(wc -c < "$output" | tr -d ' ') bytes to $output"
            return 0
        fi
        if [[ "$attempt" -ge "$attempts" ]]; then
            log_debug "Giving up on $url after $attempt attempt(s)"
            return 1
        fi
        log_info "Download failed, trying again in ${delay}s"
        sleep "$delay"
        attempt=$((attempt + 1))
    done
}

# ---- Install -----------------------------------------------------------------

fieldmark_install() {
    local base url sum got

    log_debug "fieldmark_install() called with $# argument(s)"

    base="${FIELDMARK_INSTALL_BASE:-@BASE@}"
    base="${base%/}"
    log_debug "Base address: $base"
    if [[ "$base" == *"@BASE"* ]]; then
        log_error "This copy of install.sh was never published, so it has no address in it."
        log_error "Fetch it from the site instead, or run ./setup.sh from a checkout."
        return 1
    fi

    log_debug "Checking the operating system"
    if [[ "$(uname -s)" != "Darwin" ]]; then
        log_error "Fieldmark is a Mac app, and this is $(uname -s)."
        return 1
    fi
    log_debug "Checking the user"
    if [[ "$(id -u)" -eq 0 ]]; then
        log_error "Run this as yourself, not with sudo. It asks for your password only when it needs one."
        return 1
    fi
    log_debug "Checking for the tools this needs"
    for tool in curl ditto shasum; do
        command -v "$tool" >/dev/null 2>&1 || { log_error "$tool is part of macOS but is missing here."; return 1; }
        log_debug "Found $tool at $(command -v "$tool")"
    done

    work="$(mktemp -d "${TMPDIR:-/tmp}/fieldmark-install.XXXXXXXX")"
    log_debug "Temporary folder: $work"
    trap cleanup EXIT

    log_step "Asking $base what the current version is"
    download "$base/version.json" "$work/version.json" 60 silent \
        || { log_error "Could not reach $base."; return 1; }
    log_debug "version.json: $(tr -d '\n' < "$work/version.json")"

    url="$(sed -n 's/.*"download" *: *"\([^"]*\)".*/\1/p' "$work/version.json" | sed -n '1p')"
    sum="$(sed -n 's/.*"sha256" *: *"\([^"]*\)".*/\1/p' "$work/version.json" | sed -n '1p')"
    log_debug "Download address: ${url:-<none>}"
    log_debug "Published checksum: ${sum:-<none>}"
    [[ -n "$url" ]] || { log_error "$base/version.json does not say where the download is."; return 1; }

    log_step "Downloading"
    download "$url" "$work/fieldmark.zip" 600 \
        || { log_error "Could not download $url."; return 1; }

    # A truncated download is the realistic failure, and the next step unpacks
    # and builds whatever this is. Both files come from the same site over
    # HTTPS, so this says the bytes arrived whole, not that the site is
    # trustworthy.
    if [[ -n "$sum" ]]; then
        log_step "Checking what arrived"
        got="$(shasum -a 256 "$work/fieldmark.zip" | cut -d' ' -f1)"
        log_debug "Expected $sum, got $got"
        if [[ "$got" != "$sum" ]]; then
            log_error "The download does not match its checksum. Nothing was installed."
            return 1
        fi
        log_debug "Checksum matches"
    else
        log_info "No checksum was published, so the download is not verified"
    fi

    log_step "Unpacking"
    ditto -x -k "$work/fieldmark.zip" "$work/src"
    log_debug "Unpacked into $work/src"
    [[ -x "$work/src/fieldmark/setup.sh" ]] \
        || { log_error "The download does not look like Fieldmark."; return 1; }

    # `curl … | bash` leaves this shell's stdin as the pipe the script came down,
    # so setup.sh's one question has nothing to read from and it stops with
    # "cannot ask without a terminal". Hand the child the terminal instead. The
    # child only: this shell is still reading the script from its own stdin.
    # Opening it, not asking whether it looks readable: with no controlling
    # terminal, /dev/tty passes every permission test and then fails to open.
    if [[ ! -t 0 ]] && (: < /dev/tty) 2>/dev/null; then
        log_debug "Running setup.sh with the terminal as its input"
        "$work/src/fieldmark/setup.sh" "$@" < /dev/tty
    else
        log_debug "Running setup.sh with the current input"
        "$work/src/fieldmark/setup.sh" "$@"
    fi
    log_debug "fieldmark_install() finished"
}

fieldmark_install "$@"
