# rename-by-date

## Contents

1. [Overview](#overview)
2. [Requirements](#requirements)
3. [Installation](#installation)
4. [Usage](#usage)
   1. [Dry run](#dry-run)
   2. [Applying changes](#applying-changes)
   3. [Subfolders](#subfolders)
5. [How dates are chosen](#how-dates-are-chosen)
   1. [Photos](#photos)
   2. [Videos](#videos)
   3. [Files with no date](#files-with-no-date)
6. [Name clashes](#name-clashes)
7. [Time zones](#time-zones)
8. [Undo](#undo)

## Overview

A shell script that renames photos and videos to the date and time they were taken.

### Why

So a folder sorts in the order things happened, whichever camera or phone each file came from.

### Example

- Before:
  - `IMG_4031.HEIC`
  - `DSC00212.JPG`
- After:
  - `2026-07-14_18-32-05.heic`
  - `2026-07-14_18-40-51.jpg`

## Requirements

| Requirement | Version |
| ----------- | ------- |
| exiftool    | any     |

## Installation

### macOS

```sh
brew install exiftool
```

### Debian and Ubuntu

```sh
apt install libimage-exiftool-perl
```

## Usage

### Dry run

```sh
./rename-by-date.sh ~/Pictures/import
```

This only prints the old and new names.

### Applying changes

```sh
./rename-by-date.sh --apply ~/Pictures/import
```

This renames the files.

### Subfolders

- By default:
  - Only the folder you give it.
- With `-r`:
  - Subfolders too.

## How dates are chosen

### Photos

- Tag used:
  - `DateTimeOriginal`

### Videos

- Tag used:
  - `CreateDate`

### Files with no date

These are left alone and listed at the end.

## Name clashes

Two files taken in the same second get `-1`, `-2` and so on added to the name.

## Time zones

Phones record video times in UTC. Use `--video-tz +02:00` to shift video times by that offset.

## Undo

### The log file

Every `--apply` run writes `rename-log-<time>.tsv` into the folder.

### Undoing a run

```sh
./rename-by-date.sh --undo ~/Pictures/import/rename-log-2026-09-26_1412.tsv
```
