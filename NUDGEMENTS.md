# Nudgements

## Name the change

Commit · [ansi-regex](https://github.com/chalk/ansi-regex/commit/f1bf1f05234e43ad241cf0408cb03c39e147218c)

**Before**

```text
Improve performance
```

**Initial nudgement**

> The subject is generic. Name what actually changed.

**After**

```text
fix: stop unterminated OSC strings consuming later escapes
```

## Replace a boilerplate commit bullet

Commit · [uv](https://github.com/astral-sh/uv/commit/3011f564c3f01096ae9b6fdd6f04a1e26322cfcd) · bullet 2

**Before**

```text
- Does this pull request include a summary of the change? (See below.)
- Does this pull request include a descriptive title?
```

**Initial nudgement**

> Bullet 2 adds little beyond the subject. Consider dropping it.

**After**

```text
test: gate PyPI credential test behind test-pypi

- It accesses PyPI and fails in offline builds.
```

## Flatten API documentation

README · [ansi-regex](https://github.com/chalk/ansi-regex/blob/f923667b5ea05b8b0447f6ead4c56661b7bf7fa1/readme.md)

**Before**

```markdown
##### onlyFirst

Type: `boolean`\
Default: `false` *(Matches any ANSI escape codes in a string)*

Match only the first ANSI escape.
```

**Initial nudgement**

> Bloated. The same content fits in far fewer words.

**After**

```markdown
`ansiRegex()` returns a global regular expression for ANSI escapes.
Pass `{onlyFirst: true}` to match only the first escape.
```

## Explain an opaque regex

Code · [indent-string](https://github.com/sindresorhus/indent-string/blob/7e6c356c4a8425b06efb5c031479304ee0bd67ea/index.js)

**Before**

```js
const regex = includeEmptyLines ? /^/gm : /^(?!\s*$)/gm;
```

**Initial nudgement**

> Give obscure literals or patterns meaningful names and explain their format, units or rationale.

**After**

```js
// Anchor each line; unless requested, skip lines containing only whitespace.
const regex = includeEmptyLines ? /^/gm : /^(?!\s*$)/gm;
```

## Use familiar words in an error

UI copy · [Excalidraw](https://github.com/excalidraw/excalidraw/blob/5a406e51875157bece389b9bc92d41ff241d5f3d/packages/excalidraw/locales/en.json)

**Before**

```text
Encryption key must be of 22 characters. Live collaboration is disabled.
```

**Initial nudgement**

> Use plainer words; this reads like jargon.

**After**

```text
This collaboration link is invalid. Ask the sender for a new link.
```

## Drop a timing deadline

Tests · [Bun](https://github.com/oven-sh/bun/blob/9f70da074192e55c3ec68aef7fd982e6b4b0284b/test/js/bun/util/sleepSync.test.ts#L4-L10)

**Before**

```ts
const start = performance.now();
sleepSync(50);
const end = performance.now();
expect(end - start).toBeGreaterThanOrEqual(5);
expect(end - start).toBeLessThan(1000);
```

**Initial nudgement**

> Could fail at random (timing, clock, or test order).

**After**

```ts
const durationMs = 50;
const start = performance.now();
sleepSync(durationMs);
expect(performance.now() - start).toBeGreaterThanOrEqual(durationMs);
```

[Full reviews and proposed edits](docs/verification/nudgements.json) · [Source licenses](docs/verification/nudgements-license.txt)
