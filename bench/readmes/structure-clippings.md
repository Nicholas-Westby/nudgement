# clippings

## Changelog

- 0.4: reads the date format newer Kindle firmware writes
- 0.3: `--since`
- 0.2: one file per book instead of one big file
- 0.1: first version

## Troubleshooting

`UnicodeDecodeError` means the file came from an older Kindle, which writes it with a byte order mark and Windows line endings. 0.4 handles both, so upgrade.

If the highlights from a bought book stop partway through, the book has hit its clipping limit. Publishers can cap how much of a book can be clipped, often around 10%, and past the cap the Kindle writes `<You have reached the clipping limit for this item>` instead of the text. Those entries are skipped. Documents you sent to the Kindle yourself have no limit.

## Notes

Run it like this:

```sh
clippings "/Volumes/Kindle/documents/My Clippings.txt" ~/Notes/Books
```

It writes one Markdown file per book into that folder, named after the title. Running it again only adds highlights that aren't in the file yet, so you can edit the files in between. `--since 2026-01-01` skips older highlights.

## Setup

```sh
pipx install .
```

Needs Python 3.10 or newer. A Kindle plugged into a computer shows up as a USB drive, and the file is `documents/My Clippings.txt` on it.

## Output

Each highlight becomes a block quote with its location underneath. A note you typed on the Kindle goes under the highlight it belongs to, as a plain paragraph. Bookmarks are ignored.

## About

clippings turns the `My Clippings.txt` file on a Kindle into one Markdown file per book, so the highlights can live in a notes app like Obsidian. I wrote it because Amazon's own export only covers books bought from Amazon, and half of what I read I send to the Kindle as PDFs and EPUBs.
