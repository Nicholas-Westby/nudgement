# partbook

A small command-line catalogue for a choir's sheet music. It keeps one CSV of every
piece the choir owns, which box each copy is in, and who has borrowed parts, so the
librarian can answer "do we have enough altos for the Fauré?" without opening boxes.

## Install

Needs Python 3.11 or later.

```sh
pipx install partbook
```

## Use it

The catalogue lives in `catalogue.csv` in the current folder. `partbook init` makes an
empty one.

```sh
partbook add "Cantique de Jean Racine" --composer Fauré --box 4 --parts S:12 A:10 T:8 B:9
partbook find racine
partbook lend "Cantique de Jean Racine" A 3 --to "Mei Lin"
partbook short "Cantique de Jean Racine" --singers S:14 A:11 T:7 B:9
```

`short` prints the parts you have too few of for the singers you name, counting copies
that are out on loan as missing:

```
A   need 11, have 7 (3 of 10 out with Mei Lin)
S   need 14, have 12
```

`partbook return` takes the same arguments as `lend`, with `--from`.

## The CSV

One row per piece and part: `title, composer, box, part, copies, lent_to`. It is plain
enough to edit in a spreadsheet, and `partbook check` reports rows it cannot read.

## License

MIT
