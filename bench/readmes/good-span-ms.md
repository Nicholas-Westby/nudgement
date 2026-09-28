# span-ms

Parses durations like `90s`, `1h30m` or `2 days` into milliseconds, and formats milliseconds back into the short form. No dependencies, under 1 KB minified, types included. Works in Node 18+, Deno, Bun and browsers.

```sh
npm install span-ms
```

```ts
import { parse, format } from "span-ms";

parse("1h30m");    // 5400000
parse("2 days");   // 172800000
parse("1.5h");     // 5400000
parse("90");       // 90000: a bare number means seconds
parse("soon");     // throws RangeError: cannot parse "soon"

format(5400000);   // "1h30m"
format(172800000); // "2d"
format(1500);      // "1.5s"
```

## Units

| Unit         | Spellings                                   |
| ------------ | ------------------------------------------- |
| milliseconds | `ms`, `msec`, `millisecond`, `milliseconds` |
| seconds      | `s`, `sec`, `second`, `seconds`             |
| minutes      | `m`, `min`, `minute`, `minutes`             |
| hours        | `h`, `hr`, `hour`, `hours`                  |
| days         | `d`, `day`, `days`                          |
| weeks        | `w`, `week`, `weeks`                        |

Case does not matter, and spaces between the parts are optional, so `1h 30m`, `1H30M` and `1 hour 30 minutes` are the same. A day is always 24 hours and a week 7 days. There are no months or years, because how long they are depends on the date they start from.

## API

### `parse(text, options?)`

Returns milliseconds as a number, which can have a fraction: `parse("1.5ms")` is `1.5`. Throws a `RangeError` for anything it cannot read, including an empty string and negative durations.

`options.defaultUnit` sets what a bare number means. It is `"s"` unless you change it.

### `tryParse(text, options?)`

The same as `parse`, but returns `undefined` instead of throwing.

### `format(ms, options?)`

Writes the shortest form, largest unit first.

- `options.parts` caps how many units appear, rounding the last one: `format(5432100, { parts: 1 })` is `"1.5h"`.
- `options.largest` stops it using bigger units: `format(172800000, { largest: "h" })` is `"48h"`.

## Compared with `ms`

The `ms` package reads single values such as `2 days` but not compound ones such as `1h30m`, which is how most config files and command-line flags write durations. If you only need single values, `ms` is fine.
