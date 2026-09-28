#!/usr/bin/env python3
"""Find duplicate files under one or more folders.

Only files of the same size can be identical, so sizes are compared first and
only files that share one are hashed. Symlinks are skipped, so a linked file is
not reported as a copy of itself, and overlapping folders are only read once.

    find_duplicates.py ~/Pictures ~/Downloads
    find_duplicates.py --min-size 1048576 --delete ~/Pictures
"""

import argparse
import hashlib
import sys
from collections import defaultdict
from pathlib import Path


def sha256(path):
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def duplicate_groups(roots, min_size=1):
    """(size, paths) for each set of identical files, largest first."""
    files = {
        path.resolve()
        for root in roots
        for path in root.rglob("*")
        if path.is_file() and not path.is_symlink()
    }
    by_size = defaultdict(list)
    for path in files:
        size = path.stat().st_size
        if size >= min_size:
            by_size[size].append(path)

    groups = []
    for size, paths in by_size.items():
        if len(paths) < 2:
            continue
        by_hash = defaultdict(list)
        for path in paths:
            try:
                by_hash[sha256(path)].append(path)
            except OSError as error:
                print(f"skipped {path}: {error}", file=sys.stderr)
        groups += [(size, sorted(same)) for same in by_hash.values() if len(same) > 1]
    return sorted(groups, key=lambda group: (-group[0], group[1]))


def human(size):
    for unit in ("bytes", "KB", "MB"):
        if size < 1024:
            return f"{size:,.0f} {unit}" if unit == "bytes" else f"{size:,.1f} {unit}"
        size /= 1024
    return f"{size:,.1f} GB"


def main(argv=None):
    parser = argparse.ArgumentParser(description="Find duplicate files.")
    parser.add_argument("roots", nargs="+", type=Path, help="folders to search")
    parser.add_argument("--min-size", type=int, default=1, metavar="BYTES",
                        help="skip files smaller than this (default 1, which skips empty files)")
    parser.add_argument("--delete", action="store_true",
                        help="delete every copy but the first path in each group")
    args = parser.parse_args(argv)

    groups = duplicate_groups(args.roots, args.min_size)
    wasted = 0
    for size, paths in groups:
        keep, *copies = paths
        print(f"{human(size)} x {len(paths)}")
        print(f"  keep    {keep}")
        for copy in copies:
            if args.delete:
                copy.unlink()
            print(f"  {'deleted' if args.delete else 'copy   '} {copy}")
        wasted += size * len(copies)
    print(f"{len(groups)} groups, {human(wasted)} {'freed' if args.delete else 'in copies'}", file=sys.stderr)


if __name__ == "__main__":
    main()
