# Faster mutation runs: design

Date: 2026-09-17. Status: approved in outline by Robin, details below are the working design.

## Why

`./Scripts/mutate.sh` is documented as "about an hour; 1028 mutants". On 2026-09-17 it planned
1,697 mutants and took about 4 hours. Nobody runs a 4 hour check often, so gaps pile up between
runs: this run found dozens of new survivors in code written since 2026-09-04.

The goal is a full run in tens of minutes, with every verdict meaning exactly what it means today.

## Where the time goes today (measured 2026-09-17, 4 cores, 8 GB)

Per mutant, about 8 s:

| Step | Time | Notes |
| --- | --- | --- |
| Run the suite, one test at a time | 5.8 s | 2,043 tests. Four suites are 4.0 s of it: `RepoLanguageTests` 1.78 s, `RelaunchCommandTests` 1.0 s, `AgentRunnerDeadlineTests` 0.74 s, `SeedLibraryScriptTests` 0.52 s |
| Incremental build | 1.9 s | compile one file 0.18 s, emit module 0.42 s, link 0.13 s, **dsymutil 0.77 s**, SwiftPM 0.4 s |
| Runner overhead | 0.3 s | |

Other facts the design leans on:

- The suite in parallel takes 2.7 s and passed 16 runs out of 16.
- A killed mutant still runs every test. Swift Testing has no stop-at-first-failure.
- During the test phase about 3 of the 4 cores are idle. Memory is not a limit (build peak 0.5 GB).
- `swift test` spends about 0.5 s per call before any test runs. Calling the test helper directly
  avoids that (full suite 5.34 s serial, 2.22 s parallel).
- No mutant hung in this run, so the 120 s timeout costs nothing today.
- The core tests use unique temp folders and no shared preferences, so test processes can run side
  by side.

## What must not change

1. **Survived** means the whole `FieldmarkCoreTests` suite passed against the mutant.
2. **Killed** means a test failed against the mutant (or the suite hung or crashed).
3. **Compile error** means the mutant does not compile. It is reported and left out of the score.
4. The mutation rules, fingerprints, run JSON, ledger and triage commands keep working. A run file
   from the new runner can be merged with one from the old runner.
5. The baseline has to pass under the same conditions the mutants run under, before any mutant is
   judged.

## Decided against (2026-09-17)

- Skipping tests that do not import `FieldmarkCore`. A test file can reach Core through a helper in
  another file, and the saving is small.
- Running the likely killer first. Skipped for now. Note for later: the kill confirmation in part 1
  already learns which tests failed, so recording them in the run file would be the first step.
- Sampling, or reusing old results without re-checking them. The result could not be trusted.
- Shorter hang timeouts. Nothing hangs today.

## Part 1: four small changes to the runner we have

Each is independent and can land on its own.

### 1a. Run the tests in parallel, and confirm every kill

- Drop `--no-parallel` from the per-mutant test run. The baseline runs the same way.
- A failing run is not yet a kill. The runner finds out which tests failed and runs only those
  again, one at a time. If one fails again the mutant is **killed**. If they all pass, the runner
  runs the whole suite one test at a time, and that result decides.
- If the runner cannot tell which tests failed (a crash, a hang, output it cannot read), the whole
  suite run one test at a time decides. A hang there is a kill, as today.
- The list of failed tests has to come from something made for machines (Swift Testing's event
  stream or its xunit file), not from scraping console text. A test with a display name prints
  that name on the console, and the filter cannot match on it. The confirmation may run more
  tests than failed, never fewer.
- Cost: a confirmed kill pays a second `swift test` launch, about 0.6 s. Measured 2026-09-17: the
  suite is 6.85 s serial and 3.67 s parallel in wall-clock, a ratio of 0.54, so the test phase goes
  from 5.8 s to about 3.1 s for a survivor and about 3.7 s for a kill. Most mutants are killed, so
  count on about 2 s saved per mutant rather than 2.5 s.

### 1b. Build mutants without debug info

- Pass `-debug-info-format none` to the mutant build. That removes the dsymutil step (0.77 s of
  every 1.9 s build, producing an 85 MB bundle nobody opens).
- The build and the test call must agree on build flags, or `swift test` rebuilds everything with
  its own. Give the test call `--skip-build` and the same flags.
- Check that a failing test still reports its file and line (that comes from the test macros, not
  from debug info), and measure the saving. It has not been measured yet.

### 1c. Re-run only chosen mutants

- `--only <fingerprint> ...` runs just those mutants. `--survivors-of <run.json or folder>` runs
  the mutants that survived that run. A folder is merged the way the triage tool merges it, so
  that logic moves into `MutationCore` and both tools share it.
- The run file lists every mutant of each touched file: the chosen ones with their result, the
  rest as `planned`. The triage tool then needs one fix: a verdict whose mutant is only `planned`
  was not measured, so it is "out of scope", not "stale". Today it would be called stale.
- A fingerprint that matches nothing is an error (exit 2) that names it. It means the line changed.
- Exit codes as today: 0 no survivors among the chosen, 1 some survived, 2 could not run.
- The triage skill and `docs/mutation-testing.md` switch their "verify the hardening" step to
  `--only`.

### 1d. Make the slowest tests faster

Targets: the four suites in the table above. After part 2 every mutant costs one suite run and
nothing else, so suite time becomes the whole cost of a run.

Rules:

- No test may get weaker. For the three suites that exercise Core (`RelaunchCommandTests`,
  `AgentRunnerDeadlineTests`, `SeedLibraryScriptTests`), run the mutation tool on the source files
  they cover before and after. The same mutants must die.
- `RepoLanguageTests` guards the repo, not Core. It must keep checking the same files against the
  same rules. Prove it by planting a violation of each kind in a scratch copy and seeing it caught
  before and after.
- Aim, from what the four suites measure at today (2.213 s, 1.156 s, 0.742 s and 0.900 s, 5.01 s of
  a 6.0 s serial suite) and from what each fix was measured or estimated to save: the suite under
  2.5 s one test at a time, and about 1.3 s in parallel. Not under 1.2 s in parallel. Two floors
  hold it up. `swift test` spends about 0.5 s before any test runs, and a parallel run cannot
  finish before its longest single test, which is `nothingThatRunsInvokesAnotherLanguage` at 2.07 s
  today and about 0.6 s after the fix. Those two are most of the 1.3 s.

## Part 2: compile every mutant into one build

### The idea

Today each mutant is a text edit to a real source file, followed by a build. Instead, the runner
writes a copy of the sources in which every mutation site has both versions, chosen by a number
read from the environment when the process starts. It builds that copy once. Testing mutant 412 is
then "run the tests with `FIELDMARK_ACTIVE_MUTANT=412`". With the variable unset the code behaves like
the original.

### How a site is switched: copy the whole body

The mutated code is the enclosing function body copied once per mutant, with that mutant's one
token changed, inside a `switch` on the active number:

```swift
// original
func isOverBudget() -> Bool {
    guard turns > 0 else { return false }
    return elapsed >= deadline
}

// instrumented
func isOverBudget() -> Bool {
    switch __MutantSwitch.active {
    case 411:
        guard turns >= 0 else { return false }
        return elapsed >= deadline
    case 412:
        guard turns > 0 else { return false }
        return elapsed > deadline
    default:
        guard turns > 0 else { return false }
        return elapsed >= deadline
    }
}
```

Why whole bodies rather than wrapping each expression in a ternary:

- Each copy is exactly the text today's runner would have compiled. The generator keeps swapping
  one token, as it does now. It does not need to understand operator precedence or types.
- Literals in `case 3:` patterns, `guard` conditions, `where` clauses and so on need no special
  handling, because a copy is ordinary code.
- A ternary per expression doubles the text at each level of nesting (`a && b && c && d` becomes
  eight copies of `a`) and strains the type checker. Helper functions avoid that but change type
  inference. Whole bodies grow linearly: a body with k mutants is written k + 1 times.

Rules for choosing what to copy (the "container"):

1. The outermost enclosing body of a function, initializer, deinitializer, accessor (including the
   short `var x: Int { ... }` form) or subscript. Outermost, so nested closures and local functions
   do not nest the switching.
2. Otherwise the whole initial-value expression of a stored, static or global property, or a
   parameter's default value, wrapped in a closure that is applied at once:
   `= { switch __MutantSwitch.active { case 7: return <mutated>; default: return <original> } }()`.
   Not a chain of ternaries. The spike measured both: a ternary chain makes one expression k + 1
   times the size of the original, and on three of this repo's containers the type checker gave up
   with "unable to type-check this expression in reasonable time". A closure makes each copy its
   own `return` statement, which the type checker handles one at a time, and the three containers
   compile. See the spike findings.
3. Anything else has no container: enum raw values, the name token of an operator declaration
   (`static func == (…)`, which the mutation rules read as a binary operator), attribute and
   availability arguments, `#if` conditions. Those mutants take the old path (below).

A single-expression body stays legal because `switch` and `if` are expressions since Swift 5.9 and
each copy is still a single expression.

The switch itself is one extra file added to the copy of `FieldmarkCore`:

```swift
public enum __MutantSwitch {
    public static let active = Int(ProcessInfo.processInfo.environment["FIELDMARK_ACTIVE_MUTANT"] ?? "") ?? 0
}
```

Public, so default arguments and inlinable code may use it. Numbers start at 1. The number is a
mutant's position in this run's plan. The runner keeps the map from number to fingerprint.
Constants that are computed once per process are fine, because one process only ever has one
active mutant.

### The sandbox: the working tree is never edited again

The runner builds a throwaway package at `.build/mutation-sandbox/`:

- `Package.swift`, the same shape as `Tools/CoreMutation/Package.swift`.
- `Sources/FieldmarkCore/`: real copies of the sources, instrumented, plus `__MutantSwitch.swift`.
- `Tests/FieldmarkCoreTests/`: a real copy of the tests, taken when the run starts.
- The same root symlinks `Tools/CoreMutation` has (`README.md`, `run.sh`, `Scripts`, `UPDATE_URL`,
  `VERSION`), because some tests count folders up from their own path. Tests that look for the
  checkout walk up to a folder with both `Package.swift` and `.git`, which from inside `.build/`
  is still the real checkout.
- A lock file, so a second run in the same checkout stops with a clear message instead of sharing
  the sandbox. The sandbox is kept between runs so the next build is incremental.

What this buys beyond speed: editing, committing and running tests during a mutation run become
safe, the restore-after-crash code goes away, and "two runs in one checkout corrupt each other"
stops being true.

### Mutants that do not compile

About 3% of mutants do not compile. In one shared build a single bad copy breaks the file, so:

1. Build. On failure, read each `file:line:col: error:` and map the line back to a mutant through
   the line map the instrumenter kept.
2. Errors inside a mutant's copy: mark that mutant `compile_error` and drop its copy.
3. Errors in the original copy or the scaffolding of a container: that container cannot be
   switched. Drop its switching and send its mutants down the old path.
4. An error on a line inside no copy at all belongs to the nearest container above it, and that
   container is dropped too. This is not a corner case: a copy that can fall off the end of the
   body is reported at the closing brace of the whole declaration, which names no case. In this
   repo it is `while true` flipped to `while false`, which turns a function that always returned
   into one that can reach its end. Two containers, sixteen mutants.
5. Rebuild. Repeat, at most 8 rounds. If errors remain that map to nothing, give up on switching
   for this run, say so loudly, and run everything the old way.

### The old path stays, in a plain copy of the sandbox

Mutants without a container, mutants of containers that would not switch, and everything under
`--legacy` run as today, one build per mutant. They run last and one at a time because they change
the shared build.

They must not run inside the instrumented sandbox. The spike measured the incremental rebuild
after one file changes at about 13.7 s there, against about 1.9 s for a plain copy: the module is
three times the source, so emitting the module and linking cost that much more every time. Seventy
old-path mutants at 13.7 s is twenty minutes, which is most of the budget for the whole run. So
the sandbox holds a second, uninstrumented copy of `Sources/FieldmarkCore/` and a second package
pointing at it, and the old path edits that one.

### Proving it gives the same answers

Before switching becomes the default, run both ways over the same sources and tests and compare
per fingerprint. Add `mutation-triage compare <run A> <run B>`, which prints every mutant whose
result differs. The list has to be empty, or every entry explained and written down.

Today's 4 hour run is the old-path reference: check out the same `Sources/` and `Tests/` it ran
against (commit `7c55454`), run the new tool over them, compare. That saves a second 4 hour run.

The reference is committed on the `mutation-speedups` branch at
`docs/superpowers/plans/2026-09-17-old-path-reference-run.json`, exactly as the old runner wrote
it: 1,697 mutants, none of them `planned`. Not `docs/mutation-run.json`, which holds the picture
after triage, where mutants that have since been hardened read as killed and which therefore no
longer describes `7c55454`.

### Unknowns a short spike answers first

1. How many of the 1,697 sites fall under rule 1, rule 2 and rule 3.
2. Whether the instrumented `FieldmarkCore` compiles, and what kinds of errors show up.
3. How long the instrumented build takes and whether the suite slows down.
4. Whether one file's mutants get the same verdicts both ways.

All four are answered in "Spike findings" at the end of this document. The spike was throwaway
code in a scratch worktree, and the design sections above have been corrected where it proved
them wrong.

## Part 3: run about three mutants at once

- `--jobs N` (default: cores minus one). Workers take mutant numbers from a queue and each starts
  its own test process with its own `FIELDMARK_ACTIVE_MUTANT`. Nothing on disk changes between
  mutants, so no copies are needed.
- `swift test` cannot be used for this: SwiftPM locks the build folder, so two calls on one
  package wait for each other. Workers call the Swift Testing helper directly (the command line
  `swift test` uses was captured on 2026-09-17: `swiftpm-testing-helper --test-bundle-path <bundle
  binary> <bundle binary> --testing-library swift-testing`, with `DYLD_FRAMEWORK_PATH` pointing at
  the platform's `Developer/Library/Frameworks`). SwiftPM also passes its own command line through
  to the helper, between `--test-bundle-path <binary>` and the second `<binary>`, which is how
  `--filter` and `--xunit-output` reach Swift Testing. A worker therefore passes those two
  straight to the helper as well.
- That command line is not documented, so the runner checks it at the start: the baseline through
  the helper has to pass and report the same number of tests as through `swift test`. If not, it
  warns and runs with one job through `swift test --skip-build`.
- The baseline also runs N at once before any mutant is judged.
- Kill confirmation from 1a still applies, inside the worker. A kill needs the same test to fail
  twice in a row, so a one-off failure caused by load does not count.
- The machine is CPU-bound at this point (one suite run is about 3.9 CPU-seconds). Whether
  3 workers with parallel tests beat 5 workers with serial tests is settled by timing a 100 mutant
  sample, and the default is set from that.
- Results print as they finish. The JSON stays in plan order.

## Expected effect (estimates, full run of 1,697 mutants)

Part 1's rows are the measured ratios of 2026-09-17 applied to the 8 s baseline: the test phase
times 0.54 for a parallel run plus 0.6 s to confirm a kill, the build times 0.58 for dropping
debug info, and 1d taking the parallel suite from about 3.1 s to about 1.3 s.

| After | Per mutant | Full run |
| --- | --- | --- |
| Today | 8 s | about 4 h |
| 1a parallel tests with confirmation | 5.9 s | about 2.8 h |
| 1b no debug info | 5.1 s | about 2.4 h |
| 1d faster slow tests | 3.3 s | about 1.6 h |
| Part 2 one build | 1.5 to 2.5 s | 45 to 70 min |
| Part 3 three at once | limited by CPU | 15 to 30 min |

## Order of work

1. Part 1, in the order 1b, 1a, 1c, 1d. Each is measured before and after.
2. The spike, then part 2 behind `--switched`, with the old path as default. Prove equal answers.
   Then make switching the default and keep `--legacy`.
3. Part 3.
4. Docs last: `docs/mutation-testing.md` (how to run, how long it takes, the sandbox, the mutant
   count), `.claude/skills/mutation-triage/SKILL.md` (verify with `--only`, drop the warning about
   two runs in one checkout once it is no longer true).

## Constraints for whoever implements this

- All of it lives in `Tools/CodeQuality` (Swift) and `Scripts/` (bash). No other language:
  `RepoLanguageTests` scans tracked Swift and shell files for other interpreters, including inside
  string literals and comments.
- Work in a worktree on the `mutation-speedups` branch. Never build or run mutation tests in a
  checkout where another mutation run is going.
- `Tools/CodeQuality` has its own tests (`MutationCoreTests`, `MutationTriageTests`). New logic is
  written test-first there. The instrumenter is a pure function from source text to source text,
  so most of it can be tested without compiling anything.
- `./Scripts/lint.sh` rewrites files. Its `preferKeyPath` and `hoistTry` rules can break
  `#expect(...)` lines, so rebuild after linting.

## Spike findings (2026-09-17)

A throwaway instrumenter was written in a scratch worktree, following the rules above, and run
over the whole of `FieldmarkCore`. It wrote a sandbox package at `.build/mutation-sandbox/`, ran the
prune loop, and then ran the suite once per mutant with `FIELDMARK_ACTIVE_MUTANT` set. The reference
it was compared against is a run file holding the old path's results for plan numbers 1 to 981.

Everything below was measured on the same four-core machine, while two other mutation runs were
using it, so absolute times are pessimistic and ratios are what to trust.

### 1. Where the 1,697 sites fall

| Rule | Sites | Share |
| --- | ---: | ---: |
| 1, a body | 1,578 | 93.0% |
| 2, an initial-value expression | 115 | 6.8% |
| 3, no container | 4 | 0.2% |

Rule 1 breaks down as 1,410 function bodies, 96 short-form getters (`var x: Int { ... }`) and 72
initializer bodies. No deinitializer, explicit accessor or subscript in `FieldmarkCore` holds a
mutant. Rule 2 breaks down as 87 property initial values and 28 parameter defaults.

The four rule 3 sites are one enum raw value (`case touristTrap = 1`) and **three operator
declaration names**: `static func == (…)`, `static func + (…)` and `static func < (…)`. The
mutation rules read the operator being declared as a binary operator and offer to change it, which
renames the function. That kind was not anticipated. It needs no new machinery, because the name
token has no enclosing body and falls out as rule 3 by itself, but the rule 3 list has to mention
it or a reader will think it is a bug.

Nothing else turned up. `FieldmarkCore` contains no `lazy var`, no property wrapper and no result
builder, so none of those were exercised; if Core grows one, it is untested ground. It has one
`#if DEBUG` inside a body, which copies into a switch case without complaint. No file in Core uses
`#filePath`, `#fileID` or `#line`, so the sandbox's different path cannot change behaviour.

1,693 sites share 401 containers. The biggest holds 40 mutants, so its body is written 41 times;
the next four hold 30, 27, 27 and 26.

### 2. Size, compiling, and the prune loop

`Sources/FieldmarkCore` goes from 14,213 lines to 42,875, a factor of 3.0. The largest single file
goes from 329 lines (`Mail/MimeParser+Decoding.swift`) to 2,768, a factor of 8.4.

The prune loop converged in **7 rounds**, about 90 seconds in total, with round build times of
23.5, 20.1, 18.6, 21.2, 11.0, 3.0 and 4.3 seconds. It ended with:

- **1,626 mutants switched** (96% of the plan).
- **71 on the old path**: 4 rule 3, 51 marked `compile_error`, and 16 in two containers that had
  to be dropped.
- The two dropped containers are `Persistence/Slug.swift` and `Persistence/SiteStore+Images.swift`
  and they are the only two `while true` loops in Core. `BoolFlip` turns one into `while false`,
  the copy can then fall off the end of the body, and the compiler reports "missing return" at the closing
  brace of the declaration, which names no case.

Error kinds, in order: `binary operator '-' cannot be applied to two 'String' operands` (the
`ArithAddToSub` rule meeting string concatenation) by a wide margin, then `cannot convert value of
type 'Bool' to expected argument type 'Date'` from `BoolFlip`, then the same `-` complaint for
arrays and other types, then "missing return".

**Against the old path, in the range it has judged (plan numbers 1 to 981), the two agree exactly:
the spike's 34 `compile_error` mutants are the old path's 34 `compile_error` mutants.** No mutant
is called a compile error by one and a result by the other. The other 17 of the spike's 51 lie
above 981, where the old path has no answer yet.

One difference is worth recording because it was real before the design changed. With rule 2
written as a chain of ternaries, three containers (`Discovery/ChainSites.swift`,
`Airports/AirportCatalog.swift`, `Models/PinColorScheme.swift`) defeated the type checker with
"unable to type-check this expression in reasonable time", and their 17 mutants were dropped to
the old path. Six of them are compile errors the old path had already found. Rewriting rule 2 as a
closure holding a switch fixed all three: 1,626 switched instead of 1,618, 2 dropped containers
instead of 5, and the exact match with the old path's compile errors above. That is why rule 2
changed.

### 3. Build and suite times

| | Instrumented | Plain stub | Ratio |
| --- | ---: | ---: | ---: |
| Cold build with tests | 53.1 s | 43.8 s | 1.21 |
| Incremental rebuild, one file changed | 13.7 s | 1.9 s | 7.3 |
| Suite, one test at a time (harness time) | 5.871 s | 5.412 s | 1.08 |

The suite passes unmutated, with the variable unset, at **2,043 tests in 185 suites**, the same
count as the plain package, so nothing was lost or silently skipped.

The cold build hardly notices the extra source, because most of that time is the unchanged test
target and the link. The incremental rebuild notices it a lot, and that is what moved the old path
out of the instrumented sandbox.

Parallel suite times were measured too and are not reported, because under the load on the machine
they came out in the wrong order (instrumented 3.23 s against plain 4.65 s). They say nothing.

### 4. Do the two paths give the same verdicts

**175 mutants were run both ways. All 175 agree. No mismatches.**

- Every judged mutant of `Agent/AgentRunner.swift`, `Discovery/ChainSites.swift`,
  `Discovery/SiteDiscovery.swift`, `Annotation/PageReading.swift` and
  `Geocoding/CoordinateLedger.swift`: 120 rule 1 mutants, 91 killed and 29 survived on both paths.
- 55 rule 2 mutants under the closure form, and 48 under the ternary form before it was replaced.
  All killed or survived the same way.

A mutant on the old path cannot be checked this way, because setting the variable does nothing for
it: those were excluded from the 175 and left to the old path, where they are judged exactly as
they are today.

### 5. What the findings change

1. **Rule 2 becomes a closure holding a switch**, not a chain of ternaries. Written above.
2. **The old path gets its own uninstrumented copy** inside the sandbox. Written above.
3. **Rule 3 gains operator declaration names.** Written above.
4. **The prune loop gains rule 4**, for an error that names no case. Written above.
5. **Part 2 alone does not reach 1.5 to 2.5 s per mutant.** One instrumented suite run through
   `swift test` is about 3.3 s in parallel today. Part 2 with part 1d's suite work gets to about
   1.5 s, and 1,626 switched mutants at that rate plus 71 on the old path is about 47 minutes,
   which is inside the 45 to 70 minute estimate. Part 2 on its own is about 1.6 hours.
6. **A type-check timeout must never be recorded as `compile_error`.** It is a statement about the
   machine, not about the mutant. When the prune loop sees one, the container goes down the old
   path, which decides honestly. The closure form removed every instance of it here, but the rule
   should be written into the runner anyway.

### The full comparison (2026-09-17)

The whole module was run the new way against the sources and tests of commit `7c55454`, the ones
the old-path reference run measured, and compared per fingerprint with
`mutation-triage compare`. 1,697 mutants both ways.

**First run: one difference out of 1,697.** `b6bc8f5e670d`,
`Outings/OutingActivity.swift:89`, `>` to `>=`: `survived` in the reference,
`compile_error` under switching. Killed counts matched exactly (1,427 and 1,427); survived was
215 against 216 and compile errors 55 against 54.

The cause, run down to the token: **the compiler blames a `switch` it cannot type-check on that
switch's first `case`, whichever case is really at fault.** The container is the short-form getter
`currentLine`, and the case below this mutant's is the one that turns `"…" + text.suffix(…)` into
`"…" - text.suffix(…)`, which is a real error. The compiler reported
`cannot convert value of type 'String?' to specified type 'String'` against
`case 5:`, the first case, not against the broken one. The prune loop therefore skipped the
innocent mutant in round 1 and only found the guilty one in round 2 — and since its skip set is
never revisited, the innocent mutant was recorded as `compile_error`. Proved by re-instrumenting
the file with the three genuinely broken mutants skipped and nothing else: it compiles, every
case included.

**The fix, and a rule worth keeping.** The prune loop's skip set is *not* a set of compile errors.
It is the set of mutants the shared build could not carry, for whatever reason. Those now go down
the old path, which compiles each one on its own and gives it the verdict the old runner gives.
`compile_error` is only ever recorded by a build of a single mutant. That costs one build each for
about 70 mutants of 1,697, roughly seven minutes of a two-hour run, and it makes the two paths
agree by construction rather than by an attribution the compiler does not promise.

**Second run, after the fix: the two runs agree on every mutant.** `mutation-triage compare` prints
that sentence and exits 0. 1,697 mutants, **1,427 killed, 216 survived, 54 compile errors**, each
count identical to the reference, and no fingerprint differs. The run is committed beside the
reference at `docs/superpowers/plans/2026-09-17-switched-run.json`, so the comparison can be
repeated from a checkout.

It took **1 h 34 min**, which is 3.3 s a mutant over the whole run — both cold sandbox builds, four
rounds of pruning, two baselines, 1,626 switched mutants and 71 old-path ones included. The
reference run took about four hours for the same plan, 8.5 s a mutant.

Where the 1,697 went: **1,626 switched**, the same number the spike reached, and **71 on the old
path** — 4 with no container at all, 22 in the three containers the prune loop had to drop, and 45
that the shared build could not carry.

Two smaller findings from the same run:

- The prune loop converged in **4 rounds**, not seven, and dropped **3 containers**.
- The container rules land exactly where the spike found them on these sources: 1,578 rule 1
  (1,410 function bodies, 96 short-form getters, 72 initializer bodies), 115 rule 2 (87 property
  initial values, 28 parameter defaults) and 4 rule 3 — one enum raw value and the three operator
  declaration names.
- A type-check timeout is not always a statement about the machine after all. On
  `Discovery/ChainSites.swift` one mutated copy is `[String] - [String]`, and the type checker
  gives up on that single expression in 3.6 s however it is written — an explicit closure result
  type makes no difference, measured both ways. Dropping the container is still the right answer,
  because the old path then judges those mutants and calls them `compile_error` exactly as the
  reference run does.

### What the spike did not settle

- The 17 `compile_error` mutants above plan number 981 have no old-path answer to compare with.
- Only 175 of 1,626 switched mutants were run both ways. The five files were chosen for coverage
  of both rules, not at random.
- The suite was run one test at a time for the comparison, as the old path runs it. Whether a
  switched mutant behaves the same under a parallel run was not tested separately, though the
  unmutated suite passes both ways.
- `deinit` bodies, explicit `get`/`set` accessors, subscripts, `lazy var`, property wrappers and
  result builders hold no mutants in `FieldmarkCore` today, so the container rules were never
  exercised on them.
