#!/usr/bin/env bash
# Write a small survey library into a support directory, for a live drive.
#
#   ./Scripts/seed-library.sh <support-dir> [extra-surveys]
#
# Two surveys by default — "Norway", holding "Quelavik" and "Gravorn", and
# "Sweden", holding "Malmo" — which is enough for anything that needs a
# selection, a site to delete, and somewhere for the selection to land
# afterwards. `extra-surveys` adds that many more called "Spare NNN", for a
# run that consumes one per round.
#
# Files rather than the app's own writer on purpose: the point is to have a
# library before the app starts, and the on-disk shape is documented in the
# README, so writing it directly is also a check that the documented shape is
# the one the app reads.
#
# The JSON is written by hand because every name here is a fixed ASCII literal
# with nothing in it that needs escaping. A name with a quote or a backslash in
# it would need more care than a heredoc can give it.
set -euo pipefail

SUPPORT="${1:?support directory required}"
EXTRA="${2:-0}"

[[ "$EXTRA" =~ ^[0-9]+$ ]] || { echo "extra-surveys must be a number, got: $EXTRA" >&2; exit 64; }

ROOT="$SUPPORT/Surveys"
STAMP="2026-01-01T00:00:00Z"

# Lowercase to match what the app writes back. Swift reads either, so this is
# only so a seeded file and a saved one look alike side by side.
uuid() { uuidgen | LC_ALL=C tr 'A-Z' 'a-z'; }

# The five keys the app insists on are id, name, notes, links and createdAt;
# the rest have defaults. They are written anyway, so seeding exercises the
# whole documented shape rather than the minimum that happens to load.
write_site() {
    local survey_dir="$1" slug="$2" name="$3"
    local dir="$survey_dir/sites/$slug"
    mkdir -p "$dir/images" "$dir/attachments"
    cat >"$dir/site.json" <<JSON
{"id": "$(uuid)", "name": "$name", "notes": "", "links": [], "imageFilenames": [], \
"attachmentFilenames": [], "category": "other", "insight": {}, "isFavorite": false, \
"createdAt": "$STAMP"}
JSON
}

write_survey() {
    local slug="$1" name="$2"
    local dir="$ROOT/$slug"
    mkdir -p "$dir/sites"
    cat >"$dir/survey.json" <<JSON
{"id": "$(uuid)", "name": "$name", "createdAt": "$STAMP"}
JSON
}

mkdir -p "$ROOT"

write_survey norway Norway
write_site "$ROOT/norway" quelavik Quelavik
write_site "$ROOT/norway" gravorn Gravorn

write_survey sweden Sweden
write_site "$ROOT/sweden" malmo Malmo

index=0
while [[ "$index" -lt "$EXTRA" ]]; do
    padded="$(printf '%03d' "$index")"
    spare_dir="$ROOT/spare-$padded"
    mkdir -p "$spare_dir/sites"
    cat >"$spare_dir/survey.json" <<JSON
{"id": "$(uuid)", "name": "Spare $padded", "createdAt": "$STAMP"}
JSON
    spare_site_dir="$spare_dir/sites/quelavik"
    mkdir -p "$spare_site_dir/images" "$spare_site_dir/attachments"
    cat >"$spare_site_dir/site.json" <<JSON
{"id": "$(uuid)", "name": "Quelavik", "notes": "", "links": [], "imageFilenames": [], \
"attachmentFilenames": [], "category": "other", "insight": {}, "isFavorite": false, \
"createdAt": "$STAMP"}
JSON
    index=$((index + 1))
done
