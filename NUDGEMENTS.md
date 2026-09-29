# Nudgements in practice

nudgement reviews code, tests and writing. These examples show its findings and
the changes they prompted.

Three real examples reviewed with nudgement and Jev on 2026-09-29. The revised
versions received no warnings or errors. They are local proposals, not upstream
changes. Findings below are verbatim excerpts; [full inputs and evaluations](docs/verification/nudgements.json)
include the run IDs and complete README rewrite.

The commit example applies nudgement's Conventional Commits policy. The README
was reviewed in full; its excerpts below show the API and explanatory prose.

## Name the change in a commit message

**Evaluator:** Commit message. **Source:** [ansi-regex commit](https://github.com/chalk/ansi-regex/commit/f1bf1f05234e43ad241cf0408cb03c39e147218c).

### Before

```text
Improve performance
```

### Initial nudgement

```text
  ✗ [header] The first line must look like "type(scope): subject". Got: "Improve performance"
  ! [human] Claims benefits without saying concretely what changed.  (jev:vague_benefits=0.98)
  ! [subject] The subject is generic. Name what actually changed.  (jev:subject_generic=0.91)
```

### After

```text
fix: stop unterminated OSC strings consuming later escapes
```

## Trim a README's repeated explanation

**Evaluator:** README. **Source:** [ansi-regex README](https://github.com/chalk/ansi-regex/blob/f923667b5ea05b8b0447f6ead4c56661b7bf7fa1/readme.md).

### Before

````markdown
## API

### ansiRegex(options?)

Returns a regex for matching ANSI escape codes.

#### options

Type: `object`

##### onlyFirst

Type: `boolean`\
Default: `false` *(Matches any ANSI escape codes in a string)*

Match only the first ANSI escape.

## Important

If you run the regex against untrusted user input in a server context, you should [give it a timeout](https://github.com/sindresorhus/super-regex).

**I do not consider [ReDoS](https://blog.yossarian.net/2022/12/28/ReDoS-vulnerabilities-and-misaligned-incentives) a valid vulnerability for this package.**

## FAQ

### Why do you test for codes not in the ECMA 48 standard?

Some of the codes we run as a test are codes that we acquired finding various lists of non-standard or manufacturer specific codes. We test for both standard and non-standard codes, as most of them follow the same or similar format and can be safely matched in strings without the risk of removing actual string content. There are a few non-standard control codes that do not follow the traditional format (i.e. they end in numbers) thus forcing us to exclude them from the test because we cannot reliably match them.

On the historical side, those ECMA standards were established in the early 90's whereas the VT100, for example, was designed in the mid/late 70's. At that point in time, control codes were still pretty ungoverned and engineers used them for a multitude of things, namely to activate hardware ports that may have been proprietary. Somewhere else you see a similar 'anarchy' of codes is in the x86 architecture for processors; there are a ton of "interrupts" that can mean different things on certain brands of processors, most of which have been phased out.
````

### Initial nudgement

```text
FAIL  README.md  score 50/100
  ✗ [length] Bloated. The same content fits in far fewer words.  (jev:shrink=0.65)
```

### After

````markdown
`ansiRegex()` returns a global regular expression for ANSI escapes.
Pass `{onlyFirst: true}` to match only the first escape.

## Notes

For untrusted server input, [apply a timeout](https://github.com/sindresorhus/super-regex).
The maintainer does not classify ReDoS as a vulnerability in this package.

Some non-standard codes ending in numbers are excluded because matching them
could remove ordinary text.
````

## Remove a timing test's upper deadline

**Evaluator:** Tests. **Source:** [Bun's sleepSync test](https://github.com/oven-sh/bun/blob/9f70da074192e55c3ec68aef7fd982e6b4b0284b/test/js/bun/util/sleepSync.test.ts#L4-L10).

### Before

```ts
it("sleepSync uses milliseconds", async () => {
  const start = performance.now();
  sleepSync(50);
  const end = performance.now();
  expect(end - start).toBeGreaterThanOrEqual(5);
  expect(end - start).toBeLessThan(1000);
});
```

### Initial nudgement

```text
TESTS PASS  sleepSync.test.ts  1 tests judged, 1 flagged (bun)
  sleepSync uses milliseconds  lines 4-10
    ! Could fail at random (timing, clock, or test order).  (jev:flaky=0.69)
```

### After

```ts
it("blocks for at least the requested milliseconds", () => {
  const durationMs = 50;
  const start = performance.now();
  sleepSync(durationMs);
  expect(performance.now() - start).toBeGreaterThanOrEqual(durationMs);
});
```

Excerpts are from MIT-licensed projects: [ansi-regex](https://github.com/chalk/ansi-regex/blob/f923667b5ea05b8b0447f6ead4c56661b7bf7fa1/license)
and [Bun](https://github.com/oven-sh/bun/blob/9f70da074192e55c3ec68aef7fd982e6b4b0284b/LICENSE.md).
See the [source license notice](docs/verification/nudgements-license.txt).
