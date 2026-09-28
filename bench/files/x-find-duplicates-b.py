#!/usr/bin/env python3
"""
Duplicate File Finder
=====================

A utility for finding duplicate files under one or more directories.

Features:
    - Size-based pre-filtering for performance
    - Pluggable hashing strategies
    - Configurable minimum file size
    - Optional deletion of duplicates
    - Multiple output formats (text, JSON)
    - Comprehensive logging

Usage:
    python find_duplicates.py ~/Pictures ~/Downloads
    python find_duplicates.py --min-size 1048576 --delete ~/Pictures
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import sys
import time
from abc import ABC, abstractmethod
from collections import defaultdict
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Dict, Iterator, List, Optional

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logger = logging.getLogger("find_duplicates")


def configure_logging(verbose: bool = False) -> None:
    """Configure logging for the application.

    Args:
        verbose: Whether to enable debug logging.
    """
    level = logging.DEBUG if verbose else logging.WARNING
    logging.basicConfig(level=level, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    logger.debug("Logging configured at level %s", logging.getLevelName(level))


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class DuplicateFinderError(Exception):
    """Base exception for all duplicate finder errors."""


class HashingError(DuplicateFinderError):
    """Raised when a file cannot be hashed."""


class DeletionError(DuplicateFinderError):
    """Raised when a duplicate cannot be deleted."""


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


class OutputFormat(Enum):
    """Supported report formats."""

    TEXT = "text"
    JSON = "json"


@dataclass
class FinderConfig:
    """Configuration for the duplicate finder.

    Attributes:
        roots: The directories to scan.
        min_size: The minimum file size in bytes to consider.
        algorithm: The hashing algorithm to use.
        chunk_size: The number of bytes read at a time when hashing.
        follow_symlinks: Whether to follow symbolic links.
        delete: Whether to delete duplicates.
        output_format: The format of the report.
        verbose: Whether to enable debug logging.
    """

    roots: List[Path] = field(default_factory=list)
    min_size: int = 1
    algorithm: str = "sha256"
    chunk_size: int = 1024 * 1024
    follow_symlinks: bool = False
    delete: bool = False
    output_format: OutputFormat = OutputFormat.TEXT
    verbose: bool = False

    def validate(self) -> None:
        """Validate the configuration.

        Raises:
            ValueError: If the configuration is invalid.
            TypeError: If a root is not a Path.
        """
        if not self.roots:
            raise ValueError("At least one root directory is required")
        for root in self.roots:
            if not isinstance(root, Path):
                raise TypeError(f"Root must be a Path, got {type(root).__name__}")
        if self.chunk_size <= 0:
            raise ValueError("chunk_size must be positive")
        if not isinstance(self.output_format, OutputFormat):
            raise TypeError("output_format must be an OutputFormat")


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class FileRecord:
    """A file found while scanning.

    Attributes:
        path: The resolved path of the file.
        size: The size of the file in bytes.
    """

    path: Path
    size: int


@dataclass
class DuplicateGroup:
    """A group of identical files.

    Attributes:
        size: The size of each file in bytes.
        digest: The hash shared by every file in the group.
        files: The files in the group, sorted by path.
    """

    size: int
    digest: str
    files: List[Path] = field(default_factory=list)

    @property
    def count(self) -> int:
        """The number of files in the group."""
        return len(self.files)

    @property
    def keeper(self) -> Path:
        """The file that is kept."""
        return self.files[0]

    @property
    def copies(self) -> List[Path]:
        """The files that duplicate the keeper."""
        return self.files[1:]

    @property
    def wasted_bytes(self) -> int:
        """The number of bytes taken up by the copies."""
        return self.size * len(self.copies)


@dataclass
class ScanResult:
    """The result of a duplicate search.

    Attributes:
        groups: The duplicate groups found.
        files_scanned: The number of files considered.
        files_hashed: The number of files hashed.
        elapsed_seconds: How long the search took.
    """

    groups: List[DuplicateGroup] = field(default_factory=list)
    files_scanned: int = 0
    files_hashed: int = 0
    elapsed_seconds: float = 0.0

    @property
    def wasted_bytes(self) -> int:
        """The number of bytes taken up by copies across all groups."""
        return sum(group.wasted_bytes for group in self.groups)


# ---------------------------------------------------------------------------
# Hashing
# ---------------------------------------------------------------------------


class HashStrategy(ABC):
    """Abstract base class for file hashing strategies."""

    @abstractmethod
    def hash_file(self, path: Path) -> str:
        """Return the hex digest of the file at the given path.

        Args:
            path: The file to hash.

        Returns:
            The hex digest of the file.
        """
        raise NotImplementedError


class ChunkedHashStrategy(HashStrategy):
    """Hashes a file by reading it in fixed-size chunks."""

    def __init__(self, algorithm: str = "sha256", chunk_size: int = 1024 * 1024) -> None:
        self.algorithm = algorithm
        self.chunk_size = chunk_size

    def hash_file(self, path: Path) -> str:
        logger.debug("Hashing %s with %s", path, self.algorithm)
        hasher = hashlib.new(self.algorithm)
        try:
            with open(path, "rb") as handle:
                while True:
                    chunk = handle.read(self.chunk_size)
                    if not chunk:
                        break
                    hasher.update(chunk)
        except OSError as error:
            logger.debug("Failed to hash %s: %s", path, error)
            raise HashingError(str(error)) from error
        digest = hasher.hexdigest()
        logger.debug("Digest of %s is %s", path, digest)
        return digest


class HashStrategyFactory:
    """Creates hashing strategies by algorithm name."""

    _strategies = {
        "sha256": ChunkedHashStrategy,
    }

    @classmethod
    def create(cls, algorithm: str, chunk_size: int) -> HashStrategy:
        """Create a hashing strategy.

        Args:
            algorithm: The name of the hashing algorithm.
            chunk_size: The number of bytes read at a time.

        Returns:
            A hashing strategy for the algorithm.

        Raises:
            ValueError: If the algorithm is not supported.
        """
        logger.debug("Creating hash strategy for %s", algorithm)
        strategy_class = cls._strategies.get(algorithm)
        if strategy_class is None:
            raise ValueError(f"Unsupported algorithm: {algorithm}")
        return strategy_class(algorithm=algorithm, chunk_size=chunk_size)


# ---------------------------------------------------------------------------
# Scanning
# ---------------------------------------------------------------------------


class FileScanner:
    """Walks the configured directories and yields the files in them."""

    def __init__(self, config: FinderConfig) -> None:
        self.config = config

    def scan(self) -> Iterator[FileRecord]:
        """Yield every regular file under the configured roots, once each.

        Yields:
            A record for each file at least ``min_size`` bytes long.
        """
        seen = set()
        for root in self.config.roots:
            logger.info("Scanning %s", root)
            if not root.exists():
                logger.info("Root %s does not exist, skipping", root)
                continue
            for dirpath, _dirnames, filenames in os.walk(root, followlinks=self.config.follow_symlinks):
                logger.debug("Entering directory %s", dirpath)
                for filename in filenames:
                    path = Path(dirpath) / filename
                    if path.is_symlink() and not self.config.follow_symlinks:
                        logger.debug("Skipping symlink %s", path)
                        continue
                    if not path.is_file():
                        logger.debug("Skipping non-file %s", path)
                        continue
                    resolved = path.resolve()
                    if resolved in seen:
                        logger.debug("Already seen %s", resolved)
                        continue
                    seen.add(resolved)
                    size = resolved.stat().st_size
                    if size < self.config.min_size:
                        logger.debug("Skipping %s (%d bytes < %d)", resolved, size, self.config.min_size)
                        continue
                    yield FileRecord(path=resolved, size=size)


# ---------------------------------------------------------------------------
# Duplicate detection
# ---------------------------------------------------------------------------


class DuplicateFinder:
    """Finds groups of identical files."""

    def __init__(
        self,
        config: FinderConfig,
        scanner: Optional[FileScanner] = None,
        hash_strategy: Optional[HashStrategy] = None,
    ) -> None:
        self.config = config
        self.scanner = scanner or FileScanner(config)
        self.hash_strategy = hash_strategy or HashStrategyFactory.create(config.algorithm, config.chunk_size)

    def find(self) -> ScanResult:
        """Run the search.

        Returns:
            The groups of duplicates found, largest files first.
        """
        logger.info("Starting duplicate search")
        start = time.perf_counter()
        result = ScanResult()

        files_by_size: Dict[int, List[FileRecord]] = defaultdict(list)
        for record in self.scanner.scan():
            files_by_size[record.size].append(record)
            result.files_scanned += 1
        logger.info("Found %d files in %d size buckets", result.files_scanned, len(files_by_size))

        for size, records in files_by_size.items():
            if len(records) < 2:
                logger.debug("Size %d has a single file, skipping", size)
                continue
            result.groups.extend(self._group_by_hash(size, records, result))

        result.groups.sort(key=lambda group: (-group.size, group.files))
        result.elapsed_seconds = time.perf_counter() - start
        logger.info("Found %d duplicate groups in %.2fs", len(result.groups), result.elapsed_seconds)
        return result

    def _group_by_hash(self, size: int, records: List[FileRecord], result: ScanResult) -> List[DuplicateGroup]:
        """Split files of one size into groups of identical content.

        Args:
            size: The size shared by the files.
            records: The files of that size.
            result: The result to update with the number of files hashed.

        Returns:
            The groups with more than one file.
        """
        by_digest: Dict[str, List[Path]] = defaultdict(list)
        for record in records:
            try:
                digest = self.hash_strategy.hash_file(record.path)
            except HashingError as error:
                print(f"skipped {record.path}: {error.__cause__}", file=sys.stderr)
                continue
            result.files_hashed += 1
            by_digest[digest].append(record.path)

        groups = []
        for digest, paths in by_digest.items():
            if len(paths) > 1:
                groups.append(DuplicateGroup(size=size, digest=digest, files=sorted(paths)))
        return groups


# ---------------------------------------------------------------------------
# Deletion
# ---------------------------------------------------------------------------


class DuplicateRemover:
    """Deletes the copies in each duplicate group."""

    def __init__(self, dry_run: bool = True) -> None:
        self.dry_run = dry_run

    def remove(self, path: Path) -> None:
        """Delete a single file.

        Args:
            path: The file to delete.

        Raises:
            DeletionError: If the file cannot be deleted.
        """
        if self.dry_run:
            logger.debug("Dry run: would delete %s", path)
            return
        logger.info("Deleting %s", path)
        try:
            path.unlink()
        except OSError as error:
            logger.error("Failed to delete %s: %s", path, error)
            raise DeletionError(f"Could not delete {path}: {error}") from error


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------


def format_size(size: float) -> str:
    """Format a size in bytes as a human-readable string.

    Args:
        size: The size in bytes.

    Returns:
        The size with a unit, such as ``1.5 MB``.
    """
    units = ["bytes", "KB", "MB", "GB"]
    index = 0
    while size >= 1024 and index < len(units) - 1:
        size /= 1024
        index += 1
    if index == 0:
        return f"{size:,.0f} {units[index]}"
    return f"{size:,.1f} {units[index]}"


class ReportFormatter(ABC):
    """Abstract base class for report formatters."""

    @abstractmethod
    def format(self, result: ScanResult, deleted: bool) -> str:
        """Format a scan result.

        Args:
            result: The result to format.
            deleted: Whether the copies were deleted.

        Returns:
            The formatted report.
        """
        raise NotImplementedError


class TextReportFormatter(ReportFormatter):
    """Formats a scan result as plain text."""

    def format(self, result: ScanResult, deleted: bool) -> str:
        lines = []
        for group in result.groups:
            lines.append(f"{format_size(group.size)} x {group.count}")
            lines.append(f"  keep    {group.keeper}")
            for copy in group.copies:
                lines.append(f"  {'deleted' if deleted else 'copy   '} {copy}")
        return "\n".join(lines)


class JSONReportFormatter(ReportFormatter):
    """Formats a scan result as JSON."""

    def format(self, result: ScanResult, deleted: bool) -> str:
        return json.dumps(
            {
                "groups": [
                    {
                        "size": group.size,
                        "digest": group.digest,
                        "keep": str(group.keeper),
                        "copies": [str(copy) for copy in group.copies],
                    }
                    for group in result.groups
                ],
                "deleted": deleted,
                "wasted_bytes": result.wasted_bytes,
                "files_scanned": result.files_scanned,
                "files_hashed": result.files_hashed,
                "elapsed_seconds": result.elapsed_seconds,
            },
            indent=2,
        )


def get_formatter(output_format: OutputFormat) -> ReportFormatter:
    """Return the formatter for an output format.

    Args:
        output_format: The requested format.

    Returns:
        A formatter for that format.
    """
    formatters = {
        OutputFormat.TEXT: TextReportFormatter,
        OutputFormat.JSON: JSONReportFormatter,
    }
    return formatters[output_format]()


# ---------------------------------------------------------------------------
# Command line
# ---------------------------------------------------------------------------


def parse_args(argv: Optional[List[str]] = None) -> FinderConfig:
    """Parse the command line into a configuration.

    Args:
        argv: The arguments to parse. Defaults to ``sys.argv``.

    Returns:
        The configuration.
    """
    parser = argparse.ArgumentParser(description="Find duplicate files.")
    parser.add_argument("roots", nargs="+", type=Path, help="folders to search")
    parser.add_argument("--min-size", type=int, default=1, metavar="BYTES",
                        help="skip files smaller than this (default 1, which skips empty files)")
    parser.add_argument("--delete", action="store_true",
                        help="delete every copy but the first path in each group")
    parser.add_argument("--verbose", "-v", action="store_true", help="enable debug logging")
    args = parser.parse_args(argv)
    return FinderConfig(roots=args.roots, min_size=args.min_size, delete=args.delete, verbose=args.verbose)


def main(argv: Optional[List[str]] = None) -> int:
    """Entry point.

    Args:
        argv: The command line arguments.

    Returns:
        The exit code.
    """
    config = parse_args(argv)
    configure_logging(config.verbose)
    logger.debug("Configuration: %s", config)

    try:
        config.validate()
    except (ValueError, TypeError) as error:
        logger.error("Invalid configuration: %s", error)
        raise

    finder = DuplicateFinder(config)
    result = finder.find()

    remover = DuplicateRemover(dry_run=not config.delete)
    for group in result.groups:
        for copy in group.copies:
            remover.remove(copy)

    report = get_formatter(config.output_format).format(result, deleted=config.delete)
    if report:
        print(report)

    summary = "freed" if config.delete else "in copies"
    print(f"{len(result.groups)} groups, {format_size(result.wasted_bytes)} {summary}", file=sys.stderr)
    logger.debug("Done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
