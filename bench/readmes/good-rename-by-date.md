# rename-by-date

A shell script that renames photos and videos to the date and time they were taken, so a folder sorts in the order things happened, whichever camera or phone each file came from:

```
IMG_4031.HEIC                ->  2026-07-14_18-32-05.heic
DSC00212.JPG                 ->  2026-07-14_18-40-51.jpg
PXL_20260714_174410123.mp4   ->  2026-07-14_17-44-10.mp4
```

It needs [exiftool](https://exiftool.org): `brew install exiftool` on a Mac, `apt install libimage-exiftool-perl` on Debian and Ubuntu.

## Use

```sh
./rename-by-date.sh ~/Pictures/import           # show what would change
./rename-by-date.sh --apply ~/Pictures/import   # rename
```

Without `--apply` it only prints the old and new names. It works on the folder you give it and not its subfolders, unless you add `-r`.

The date comes from a photo's `DateTimeOriginal` tag, or a video's `CreateDate`. Files with neither are left alone and listed at the end. When two files were taken in the same second, the second gets `-1` added to its name, the next `-2`, and so on, so nothing is overwritten.

Phones record video times in UTC, so a video can land hours away from the photos taken around it. `--video-tz +02:00` shifts video times by that offset.

## Undo

Each `--apply` run writes `rename-log-<time>.tsv` into the folder, listing every old and new name. To put the names back:

```sh
./rename-by-date.sh --undo ~/Pictures/import/rename-log-2026-09-26_1412.tsv
```
