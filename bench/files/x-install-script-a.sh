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
# Everything is inside one function that is called on the very last line. A
# download piped straight into a shell runs whatever arrived, so a connection
# cut in half has to run nothing at all rather than half an install.
set -euo pipefail

# The temporary folder, script-scoped rather than local to the function: the
# EXIT trap below runs after the function has returned, and a local would be
# gone by then, leaving the trap to run `rm -rf ""` and fail an install that
# had already worked.
work=""

fieldmark_install() {
    local base url sum got

    base="${FIELDMARK_INSTALL_BASE:-@BASE@}"
    base="${base%/}"
    if [[ "$base" == *"@BASE"* ]]; then
        echo "This copy of install.sh was never published, so it has no address in it." >&2
        echo "Fetch it from the site instead, or run ./setup.sh from a checkout." >&2
        return 1
    fi

    if [[ "$(uname -s)" != "Darwin" ]]; then
        echo "Fieldmark is a Mac app, and this is $(uname -s)." >&2
        return 1
    fi
    if [[ "$(id -u)" -eq 0 ]]; then
        echo "Run this as yourself, not with sudo. It asks for your password only when it needs one." >&2
        return 1
    fi
    for tool in curl ditto shasum; do
        command -v "$tool" >/dev/null 2>&1 || { echo "$tool is part of macOS but is missing here." >&2; return 1; }
    done

    work="$(mktemp -d "${TMPDIR:-/tmp}/fieldmark-install.XXXXXXXX")"
    trap 'rm -rf "$work"' EXIT

    echo "==> Asking $base what the current version is"
    curl -fsSL --proto '=https' --tlsv1.2 --max-time 60 -o "$work/version.json" "$base/version.json" \
        || { echo "Could not reach $base." >&2; return 1; }

    url="$(sed -n 's/.*"download" *: *"\([^"]*\)".*/\1/p' "$work/version.json" | sed -n '1p')"
    sum="$(sed -n 's/.*"sha256" *: *"\([^"]*\)".*/\1/p' "$work/version.json" | sed -n '1p')"
    [[ -n "$url" ]] || { echo "$base/version.json does not say where the download is." >&2; return 1; }

    echo "==> Downloading"
    curl -fL --proto '=https' --tlsv1.2 --max-time 600 -o "$work/fieldmark.zip" "$url" \
        || { echo "Could not download $url." >&2; return 1; }

    # A truncated download is the realistic failure, and the next step unpacks
    # and builds whatever this is. Both files come from the same site over
    # HTTPS, so this says the bytes arrived whole, not that the site is
    # trustworthy.
    if [[ -n "$sum" ]]; then
        echo "==> Checking what arrived"
        got="$(shasum -a 256 "$work/fieldmark.zip" | cut -d' ' -f1)"
        if [[ "$got" != "$sum" ]]; then
            echo "The download does not match its checksum. Nothing was installed." >&2
            return 1
        fi
    fi

    echo "==> Unpacking"
    ditto -x -k "$work/fieldmark.zip" "$work/src"
    [[ -x "$work/src/fieldmark/setup.sh" ]] \
        || { echo "The download does not look like Fieldmark." >&2; return 1; }

    # `curl … | bash` leaves this shell's stdin as the pipe the script came down,
    # so setup.sh's one question has nothing to read from and it stops with
    # "cannot ask without a terminal" — on a bare Mac, which is the only kind
    # this one-liner is for. Hand the child the terminal instead.
    #
    # The child only. This shell is still reading the script from its own stdin,
    # and replacing that mid-read would hand bash whatever is typed next and
    # run it as source code.
    # Opening it, not asking whether it looks readable: with no controlling
    # terminal, /dev/tty passes every permission test and then fails to open,
    # which would take the install down instead of saving it.
    if [[ ! -t 0 ]] && (: < /dev/tty) 2>/dev/null; then
        "$work/src/fieldmark/setup.sh" "$@" < /dev/tty
    else
        # Either there is already a terminal, or there is none anywhere. In the
        # second case setup.sh says so itself, and only when something actually
        # needs installing.
        "$work/src/fieldmark/setup.sh" "$@"
    fi
}

fieldmark_install "$@"
