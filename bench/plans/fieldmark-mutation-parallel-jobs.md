# Running mutants side by side Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Judge several mutants at once. Nothing on disk changes between mutants any more, so the only thing stopping three suites running side by side is that `swift test` locks the build folder. Call the Swift Testing helper directly instead, hand each worker its own mutant number, and the machine finishes a full run in tens of minutes.

**Architecture:** A queue of mutant numbers and N worker threads. Each worker runs the test bundle through `swiftpm-testing-helper` with its own `FIELDMARK_ACTIVE_MUTANT` and its own report file, and judges the result with the same kill confirmation every other path uses. Results are recorded by plan position, so the run file stays in plan order however the workers finish. The helper command line is not documented, so the runner checks it at the start against `swift test` and falls back to one job through `swift test --skip-build` if the two disagree. The old-path mutants still run last, one at a time, because they rebuild a shared package.

**Tech Stack:** Swift 6.3.1 (Xcode 26.4.1), Swift Package Manager, Swift Testing, Dispatch, bash. macOS only.

**Spec:** `docs/superpowers/specs/2026-09-17-faster-mutation-runs-design.md`, part 3.

**Depends on:** `docs/superpowers/plans/2026-09-17-mutation-runner-quick-wins.md` and `docs/superpowers/plans/2026-09-17-mutant-switching.md`, both finished. This plan uses their types by name: `TestCommand`, `TestReport`, `XUnitReport`, `SuiteRun`, `KillConfirmation`, `RunnerArguments`, `ProcessTree`, `SwitchPlan`, `SandboxLayout`, `SandboxWriter`, `PruneResult`, and the `mutation-runner` files `TestRunning.swift` and `Switching.swift`.

## Global Constraints

- Swift and bash only. `Tests/FieldmarkCoreTests/RepoLanguageTests.swift` scans every tracked Swift and shell file for the names of other interpreters, even inside string literals and comments, so neither code nor comments may mention them.
- `./Scripts/lint.sh` runs swiftformat, which rewrites files in site. Its `preferKeyPath` and `hoistTry` rules can break `#expect(...)` lines. After linting, rebuild and re-run the tests before committing.
- SwiftLint warns at 400 lines per file and errors at 1000. New code goes in new files.
- Verdict meanings do not change, fingerprints do not change, and the run JSON keeps its shape, its field names and its order. Neither `Sources/MutationCore/Mutator.swift` nor `Sources/MutationCore/Fingerprint.swift` is modified by this plan either.
- **Swift 6 strict concurrency, and no data races.** Every piece of state a worker touches is named in this plan, with the type that owns it and the lock that guards it. Nothing is shared without one.
- A kill still needs the same test to fail twice. Under load a test that passes alone can fail beside another, and that is exactly what this plan makes more likely, so the confirmation matters more here than anywhere else.
- Every task ends with the package's tests passing and one commit. For the message, invoke the `house-style:how-to-commit` skill, and end the message with the line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Stage explicit paths. Never `git add -A`, never `git stash`.
- Never build or run tests in a checkout where another mutation run is going.

---

## Facts this plan was built on

Measured on 2026-09-17 on a four-core machine that was also running two other mutation runs, so
absolute times are pessimistic. Everything below was checked by running it, against the real
`CoreMutationPackageTests` bundle.

**Where the helper is.** `xcrun --find swiftpm-testing-helper` fails with
`unable to find utility "swiftpm-testing-helper"`. It is not in the search path. It sits beside the
toolchain:

```
$(dirname "$(xcrun --find swift)")/../libexec/swift/pm/swiftpm-testing-helper
```

which on this machine resolves to
`/Applications/Xcode_26.4.1.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/libexec/swift/pm/swiftpm-testing-helper`.
The Swift Testing frameworks it needs are at
`$(xcode-select -p)/Platforms/MacOSX.platform/Developer/Library/Frameworks`, handed over in
`DYLD_FRAMEWORK_PATH`.

**The command line.** SwiftPM builds it as `--test-bundle-path <binary>`, then its own arguments,
then `<binary>` again, then `--testing-library swift-testing`. The middle part is how `--filter`
and `--xunit-output` reach Swift Testing, and none of it is needed: this shorter form works.

```
DYLD_FRAMEWORK_PATH=<platform frameworks> <helper> \
  --test-bundle-path <bundle binary> \
  <bundle binary> \
  --testing-library swift-testing \
  --no-parallel --filter <pattern> --xunit-output <path>
```

**What it returns.**

| Situation | Exit code | Report file |
| --- | ---: | --- |
| Every test passed | 0 | written, `failures="0"` |
| A test failed | 1 | written, with a `<failure>` per failing case |
| The filter matched nothing | **69** | written, `tests="0"` |

That 69 is the one surprise, and it matters. Through `swift test` the same situation exits **0**.
The kill confirmation reads "nothing ran" as "could not confirm", so 69 has to arrive as a passed
run with an empty report, not as a failure. Read as a failure it would turn every unconfirmable
kill into a confirmed one.

**What it costs.** The whole suite one test at a time: 6.05 s and 6.22 s through the helper,
against 6.79 s and 6.94 s through `swift test --skip-build`. About 0.7 s of SwiftPM start-up saved
per call. The test count is the same either way: 2,043 tests in 185 suites.

**Three at once.** Three helpers were run against one build folder at the same time, each with a
different `FIELDMARK_ACTIVE_MUTANT` and its own `--xunit-output`. All three finished, each wrote its
own report, and the three together took **7.03 s of wall clock** where one alone takes about 6.1 s.
No lock, no interference, no shared temporary file. That is the whole argument for this plan: three
workers running the suite one test at a time cost about 2.3 s per mutant, where one worker running
the suite in parallel costs about 3.2 s.

**One thing not measured.** Whether three workers with serial tests beat five workers with serial
tests, or two workers with parallel tests. Task 7 settles that with a 100 mutant sample and sets
the default from the answer.

---

## File Structure

New files in `Tools/CodeQuality/Sources/MutationCore/`:

- `ToolchainPaths.swift`: finding the helper and the frameworks. Pure, given a lookup function.
- `HelperCommand.swift`: the helper's argument list and what its exit codes mean. Pure.
- `WorkQueue.swift`: the queue of mutant numbers and the ledger of results. Locked, testable.

New files in `Tools/CodeQuality/Sources/mutation-runner/`:

- `HelperRunning.swift`: launching the helper, one report file per worker.
- `Workers.swift`: starting N of them and waiting.

Modified:

- `Tools/CodeQuality/Sources/MutationCore/KillConfirmation.swift`: gains `verdict(using:)`, the one site that decides a mutant, so the helper path and the `swift test` path cannot drift apart.
- `Tools/CodeQuality/Sources/MutationCore/RunnerArguments.swift`: `--jobs`.
- `Tools/CodeQuality/Sources/mutation-runner/TestRunning.swift`: the report path becomes per worker, and `verdictForMutant` calls the shared decision.
- `Tools/CodeQuality/Sources/mutation-runner/Support.swift`: `RunningChild` becomes `RunningChildren`.
- `Tools/CodeQuality/Sources/mutation-runner/main.swift`: the self-check, the workers, the printing.
- `docs/mutation-testing.md`: how long a run takes now, and `--jobs`.

---

## Who owns what, and what guards it

Six pieces of state outlive a single worker. Every one of them is named here with its owner.

| State | Owner | Guard |
| --- | --- | --- |
| Which mutant is next | `MutantQueue` (MutationCore) | one `NSLock` around an index |
| Every mutant's result | `RunLedger` (MutationCore) | one `NSLock` around a dictionary keyed by plan position |
| Progress lines | `Printer` (mutation-runner) | one `NSLock` around the write, so two workers cannot interleave one line |
| The pids of the running children | `RunningChildren` (mutation-runner) | one `NSLock` around a set, read by the signal handler |
| The plan itself | `PlanBox` (mutation-runner) | nothing: it is written once before the workers start and never again |
| The file the old path has edited | `InFlight` (mutation-runner, unchanged) | its existing `NSLock`, and only the single-threaded tail of the run touches it |

Each worker also has state of its own that nothing else sees: its worker number, and therefore its
own report file at `mutation-runner-<pid>-<worker>.xml`. Two workers sharing one report file would
be the easiest way to give a mutant somebody else's verdict, so the path carries the worker number
and Task 3 asserts that it does.

All four shared types are `final class ... : @unchecked Sendable`. `@unchecked` is honest here: the
lock is the invariant, and Swift cannot see it. `PlanBox` is `@unchecked Sendable` for the other
reason, that it is immutable after `init`.

---

### Task 1: Find the helper and the frameworks

**Files:**
- Create: `Tools/CodeQuality/Sources/MutationCore/ToolchainPaths.swift`
- Create: `Tools/CodeQuality/Tests/MutationCoreTests/ToolchainPathsTests.swift`

**Interfaces:**
- Consumes: nothing.
- Produces: `public struct ToolchainPaths: Equatable, Sendable` with
  `public let helper: String`, `public let frameworks: String`,
  `public static func resolve(swiftPath: String, developerDirectory: String) -> ToolchainPaths`,
  `public func exist(using check: (String) -> Bool) -> Bool`.

- [x] **Step 1: Write the failing tests**

Create `Tools/CodeQuality/Tests/MutationCoreTests/ToolchainPathsTests.swift`:

```swift
import MutationCore
import Testing

/// Where the Swift Testing helper lives, and the frameworks it loads.
///
/// Neither is on the search path: `xcrun --find swiftpm-testing-helper` fails
/// outright. Both are worked out from two things the runner already knows, and
/// both are checked for before anything depends on them, because a missing one
/// has to turn into "run with one job through swift test" rather than into a
/// run that judges every mutant wrong.
@Suite(.serialized) struct ToolchainPathsTests {
    private let swiftPath = "/Applications/Xcode.app/Contents/Developer/Toolchains/"
        + "XcodeDefault.xctoolchain/usr/bin/swift"
    private let developer = "/Applications/Xcode.app/Contents/Developer"

    @Test func theHelperSitsBesideTheToolchainNotOnThePath() {
        let paths = ToolchainPaths.resolve(swiftPath: swiftPath, developerDirectory: developer)
        #expect(paths.helper == "/Applications/Xcode.app/Contents/Developer/Toolchains/"
            + "XcodeDefault.xctoolchain/usr/libexec/swift/pm/swiftpm-testing-helper")
    }

    @Test func theFrameworksComeFromThePlatform() {
        let paths = ToolchainPaths.resolve(swiftPath: swiftPath, developerDirectory: developer)
        #expect(paths.frameworks == "/Applications/Xcode.app/Contents/Developer/Platforms/"
            + "MacOSX.platform/Developer/Library/Frameworks")
    }

    /// A bare `swift` on the search path tells us nothing about where the
    /// toolchain is, so the answer has to be something that will fail the
    /// existence check rather than a guess that half works.
    @Test func aSwiftWithNoDirectoryGivesSomethingThatFailsTheCheck() {
        let paths = ToolchainPaths.resolve(swiftPath: "swift", developerDirectory: developer)
        #expect(paths.exist(using: { _ in false }) == false)
    }

    @Test func itChecksBothPathsAndNotJustTheFirst() {
        let paths = ToolchainPaths.resolve(swiftPath: swiftPath, developerDirectory: developer)
        #expect(paths.exist(using: { _ in true }))
        #expect(paths.exist(using: { $0.hasSuffix("swiftpm-testing-helper") }) == false)
        #expect(paths.exist(using: { $0.hasSuffix("Frameworks") }) == false)
    }
}
```

- [x] **Step 2: Run the tests and watch them fail**

```bash
swift test --package-path Tools/CodeQuality --disable-sandbox --filter ToolchainPathsTests
```

Expected: the build fails with `cannot find 'ToolchainPaths' in scope`.

- [x] **Step 3: Write the implementation**

Create `Tools/CodeQuality/Sources/MutationCore/ToolchainPaths.swift`:

```swift
import Foundation

/// The two pieces of the toolchain a worker needs to run tests without SwiftPM.
///
/// Worked out rather than searched for: `xcrun --find swiftpm-testing-helper`
/// fails, because the helper is not a developer tool on the search path. It
/// lives in the toolchain's `libexec`, two directories over from `swift`
/// itself, and the frameworks it dynamically loads live in the platform.
public struct ToolchainPaths: Equatable, Sendable {
    public let helper: String
    public let frameworks: String

    public init(helper: String, frameworks: String) {
        self.helper = helper
        self.frameworks = frameworks
    }

    /// `swiftPath` is what `xcrun --find swift` gave, and `developerDirectory`
    /// is what `xcode-select -p` gave.
    public static func resolve(swiftPath: String, developerDirectory: String) -> ToolchainPaths {
        let binary = URL(filePath: swiftPath)
        let toolchainRoot = binary.deletingLastPathComponent().deletingLastPathComponent()
        return ToolchainPaths(
            helper: toolchainRoot.appending(path: "libexec/swift/pm/swiftpm-testing-helper").path,
            frameworks: URL(filePath: developerDirectory)
                .appending(path: "Platforms/MacOSX.platform/Developer/Library/Frameworks").path
        )
    }

    /// Both have to be there. One missing means the runner falls back to one
    /// job through `swift test`, which is slower and always works.
    public func exist(using check: (String) -> Bool) -> Bool {
        check(helper) && check(frameworks)
    }
}
```

- [x] **Step 4: Run the tests and watch them pass**

```bash
swift test --package-path Tools/CodeQuality --disable-sandbox --filter ToolchainPathsTests
```

Expected: `✔ Test run with 4 tests in 1 suite passed`.

- [x] **Step 5: Check it against this machine**

```bash
ls "$(dirname "$(xcrun --find swift)")/../libexec/swift/pm/swiftpm-testing-helper"
ls -d "$(xcode-select -p)/Platforms/MacOSX.platform/Developer/Library/Frameworks"
```

Expected: both print a path. If either does not, the fallback in Task 4 is the only thing that will
run on this machine, and that is worth knowing before going further.

**Checked 2026-09-17.** Both print a path:
`/Applications/Xcode_26.4.1.app/…/XcodeDefault.xctoolchain/usr/bin/../libexec/swift/pm/swiftpm-testing-helper`
and `/Applications/Xcode_26.4.1.app/Contents/Developer/Platforms/MacOSX.platform/Developer/Library/Frameworks`.
Task 1 needed no deviation from the plan: nothing it touches had moved.

- [x] **Step 6: Lint, rebuild, commit**

```bash
./Scripts/lint.sh
swift test --package-path Tools/CodeQuality --disable-sandbox
git add Tools/CodeQuality/Sources/MutationCore/ToolchainPaths.swift \
        Tools/CodeQuality/Tests/MutationCoreTests/ToolchainPathsTests.swift
git commit
```

---

### Task 2: The helper's command line and its exit codes

**Files:**
- Create: `Tools/CodeQuality/Sources/MutationCore/HelperCommand.swift`
- Create: `Tools/CodeQuality/Tests/MutationCoreTests/HelperCommandTests.swift`

**Interfaces:**
- Consumes: `ToolchainPaths` (Task 1), `SuiteRun`, `TestReport`.
- Produces: `public enum HelperCommand` with
  `public static func arguments(bundleBinary: String, parallel: Bool, xunitPath: String, filters: [String]) -> [String]`,
  `public static func environment(frameworks: String, mutant: Int?) -> [String: String]`,
  `public static let nothingMatchedExitCode: Int32`,
  `public static func result(exitCode: Int32, timedOut: Bool, report: TestReport?) -> SuiteRun`.

- [x] **Step 1: Write the failing tests**

Create `Tools/CodeQuality/Tests/MutationCoreTests/HelperCommandTests.swift`:

```swift
import MutationCore
import Testing

/// The command line SwiftPM uses to run Swift Testing, and what its answers
/// mean. None of it is documented, so all of it was read off a real run and is
/// asserted here: the day it changes, these fail rather than the verdicts going
/// quietly wrong.
@Suite(.serialized) struct HelperCommandTests {
    private let bundle = "/build/debug/CoreMutationPackageTests.xctest/Contents/MacOS/CoreMutationPackageTests"

    @Test func theBundleIsNamedTwiceOnceFlaggedAndOncePositional() {
        let args = HelperCommand.arguments(
            bundleBinary: bundle, parallel: false, xunitPath: "/tmp/r.xml", filters: []
        )
        #expect(args.first == "--test-bundle-path")
        #expect(args[1] == bundle)
        #expect(args.last(where: { $0 == bundle }) != nil)
        #expect(args.filter { $0 == bundle }.count == 2)
    }

    @Test func itAsksForSwiftTestingAndAReport() {
        let args = HelperCommand.arguments(
            bundleBinary: bundle, parallel: false, xunitPath: "/tmp/r.xml", filters: []
        )
        #expect(args.contains("--testing-library"))
        #expect(args.contains("swift-testing"))
        #expect(args.contains("--xunit-output"))
        #expect(args.contains("/tmp/r.xml"))
        #expect(args.contains("--no-parallel"))
    }

    @Test func filtersAreRepeatedOnePerPattern() {
        let args = HelperCommand.arguments(
            bundleBinary: bundle, parallel: true, xunitPath: "/tmp/r.xml", filters: ["a", "b"]
        )
        #expect(args.filter { $0 == "--filter" }.count == 2)
        #expect(args.contains("--parallel"))
        #expect(args.contains("--no-parallel") == false)
    }

    /// The frameworks have to be found at load time, and the mutant number is
    /// the only thing that makes one worker different from another.
    @Test func theEnvironmentCarriesTheFrameworksAndTheMutant() {
        let environment = HelperCommand.environment(frameworks: "/p/Frameworks", mutant: 412)
        #expect(environment["DYLD_FRAMEWORK_PATH"] == "/p/Frameworks")
        #expect(environment["FIELDMARK_ACTIVE_MUTANT"] == "412")
        #expect(HelperCommand.environment(frameworks: "/p/Frameworks", mutant: nil)["FIELDMARK_ACTIVE_MUTANT"] == nil)
    }

    @Test func zeroIsAPassAndOneIsAFailure() {
        let report = TestReport(total: 2043, failed: [])
        #expect(HelperCommand.result(exitCode: 0, timedOut: false, report: report).result == .passed)
        #expect(HelperCommand.result(exitCode: 1, timedOut: false, report: report).result == .failed)
        #expect(HelperCommand.result(exitCode: 0, timedOut: true, report: nil).result == .timedOut)
    }

    /// The one that would go wrong quietly. A filter that matches nothing exits
    /// 69 here and 0 through `swift test`. Read as a failure it would confirm
    /// kills that were never confirmed, so it has to arrive as a run that
    /// passed having measured nothing, which the confirmation already knows to
    /// treat as "could not tell".
    @Test func sixtyNineMeansNothingRanAndNotThatSomethingFailed() {
        let empty = TestReport(total: 0, failed: [])
        let run = HelperCommand.result(exitCode: HelperCommand.nothingMatchedExitCode, timedOut: false, report: empty)
        #expect(HelperCommand.nothingMatchedExitCode == 69)
        #expect(run.result == .passed)
        #expect(run.report?.total == 0)
        #expect(KillConfirmation.afterConfirmation(run) == .wholeSuiteOneAtATime)
    }
}
```

- [x] **Step 2: Run the tests and watch them fail**

```bash
swift test --package-path Tools/CodeQuality --disable-sandbox --filter HelperCommandTests
```

Expected: the build fails with `cannot find 'HelperCommand' in scope`.

- [x] **Step 3: Write the implementation**

Create `Tools/CodeQuality/Sources/MutationCore/HelperCommand.swift`:

```swift
import Foundation

/// Running Swift Testing without SwiftPM in the way.
///
/// `swift test` locks the build folder, so two calls on one package wait for
/// each other and there is no point starting a second worker. The helper
/// underneath it has no such lock: three were run against one build folder at
/// once on 2026-09-17, and all three finished in 7.03 s where one alone takes
/// 6.1 s.
///
/// None of this is documented. The shape below was read off a real `swift test`
/// and is checked at the start of every run against `swift test` itself, in
/// case a toolchain changes it.
public enum HelperCommand {
    /// What the helper exits with when the filter matched no tests.
    ///
    /// Not a failure. Through `swift test` the same situation exits 0 with a
    /// warning. Either way the run measured nothing, and nothing is what it
    /// settles.
    public static let nothingMatchedExitCode: Int32 = 69

    public static func arguments(
        bundleBinary: String,
        parallel: Bool,
        xunitPath: String,
        filters: [String]
    ) -> [String] {
        var arguments = [
            "--test-bundle-path", bundleBinary,
            bundleBinary,
            "--testing-library", "swift-testing",
            parallel ? "--parallel" : "--no-parallel",
            "--xunit-output", xunitPath,
        ]
        for filter in filters {
            arguments += ["--filter", filter]
        }
        return arguments
    }

    /// The frameworks have to be on the dynamic loader's path, and the mutant
    /// number is the only difference between one worker and the next.
    public static func environment(frameworks: String, mutant: Int?) -> [String: String] {
        var environment = ["DYLD_FRAMEWORK_PATH": frameworks]
        if let mutant { environment["FIELDMARK_ACTIVE_MUTANT"] = String(mutant) }
        return environment
    }

    /// What one helper run amounts to.
    public static func result(exitCode: Int32, timedOut: Bool, report: TestReport?) -> SuiteRun {
        if timedOut { return SuiteRun(result: .timedOut, report: nil) }
        if exitCode == 0 || exitCode == nothingMatchedExitCode {
            return SuiteRun(result: .passed, report: report)
        }
        return SuiteRun(result: .failed, report: report)
    }
}
```

- [x] **Step 4: Run the tests and watch them pass**

```bash
swift test --package-path Tools/CodeQuality --disable-sandbox --filter HelperCommandTests
```

Expected: `✔ Test run with 6 tests in 1 suite passed`.

**Deviation:** swiftformat rewrote `args.filter { … }.count == 2` into
`args.count(where: { … }) == 2` in two of these tests. Same assertion; the tests were re-run after
linting and still pass.

- [x] **Step 5: Lint, rebuild, commit**

```bash
./Scripts/lint.sh
swift test --package-path Tools/CodeQuality --disable-sandbox
git add Tools/CodeQuality/Sources/MutationCore/HelperCommand.swift \
        Tools/CodeQuality/Tests/MutationCoreTests/HelperCommandTests.swift
git commit
```

---

### Task 3: One site that decides a mutant, and a worker's own report file

Two ways of running the suite now exist. They must not grow two ways of judging it.

**Files:**
- Modify: `Tools/CodeQuality/Sources/MutationCore/KillConfirmation.swift`
- Modify: `Tools/CodeQuality/Tests/MutationCoreTests/KillConfirmationTests.swift`
- Create: `Tools/CodeQuality/Sources/mutation-runner/HelperRunning.swift`
- Modify: `Tools/CodeQuality/Sources/mutation-runner/TestRunning.swift`

**Interfaces:**
- Consumes: `KillConfirmation` (part 1), `HelperCommand` (Task 2), `runSwift` (part 1).
- Produces:
  - `public static func verdict(using run: (_ parallel: Bool, _ filters: [String]) -> SuiteRun) -> MutantOutcome` on `KillConfirmation`.
  - In the `mutation-runner` target: `func reportPath(worker: Int) -> String`, and `func runSuiteViaHelper(bundleBinary: String, paths: ToolchainPaths, mutant: Int?, worker: Int, parallel: Bool, filters: [String]) -> SuiteRun`.

- [x] **Step 1: Write the failing test**

Add to `KillConfirmationTests`:

```swift
    /// The three steps, driven end to end, with the suite runs faked. Both the
    /// `swift test` path and the helper path call this, so a change to the rule
    /// reaches both or neither.
    @Test func theWholeDecisionRunsThroughOneFunction() {
        var calls: [(parallel: Bool, filters: [String])] = []
        let outcome = KillConfirmation.verdict { parallel, filters in
            calls.append((parallel, filters))
            switch calls.count {
            case 1: return SuiteRun(result: .failed, report: report(total: 2043, failed: ["M.S/t()"]))
            case 2: return SuiteRun(result: .passed, report: report(total: 0))
            default: return SuiteRun(result: .passed, report: report(total: 2043))
            }
        }
        #expect(outcome == .survived)
        #expect(calls.count == 3)
        #expect(calls[0].parallel)
        #expect(calls[1].parallel == false)
        #expect(calls[1].filters == ["M\\.S\\/t\\(\\)"])
        #expect(calls[2].filters.isEmpty)
    }

    @Test func aConfirmedFailureStopsAfterTwoRuns() {
        var calls = 0
        let outcome = KillConfirmation.verdict { _, _ in
            calls += 1
            return SuiteRun(result: .failed, report: report(total: 1, failed: ["M.S/t()"]))
        }
        #expect(outcome == .killed)
        #expect(calls == 2)
    }
```

- [x] **Step 2: Run it and watch it fail**

```bash
swift test --package-path Tools/CodeQuality --disable-sandbox --filter KillConfirmationTests
```

Expected: the build fails with `type 'KillConfirmation' has no member 'verdict'`.

- [x] **Step 3: Add the shared decision**

Add to `Tools/CodeQuality/Sources/MutationCore/KillConfirmation.swift`, inside `enum KillConfirmation`:

```swift
    /// The whole decision, given something that can run the suite.
    ///
    /// The one site a mutant is judged. There are three ways to run the suite
    /// now (`swift test` against the stub package, `swift test` against the
    /// sandbox, and the testing helper straight from a worker) and exactly one
    /// rule about what the answers mean.
    public static func verdict(
        using run: (_ parallel: Bool, _ filters: [String]) -> SuiteRun
    ) -> MutantOutcome {
        var step = afterFirstRun(run(true, []))
        if case let .confirm(filters) = step {
            step = afterConfirmation(run(false, filters))
        }
        if case let .verdict(outcome) = step { return outcome }
        return afterWholeSuite(run(false, []))
    }
```

- [x] **Step 4: Run it and watch it pass**

```bash
swift test --package-path Tools/CodeQuality --disable-sandbox --filter KillConfirmationTests
```

Expected: `✔ Test run with 11 tests in 1 suite passed`.

**Deviation, and the reason for it.** `verdict` takes a second argument,
`note: (String) -> Void = { _ in }`, called only when the whole suite had to decide. The plan's
version drops something HEAD has: `verdictForMutant` prints two lines to stderr saying the cheap
path could not answer and why (`whyTheSuiteMustDecide`), and that is the only record anywhere that
one verdict was reached differently from the other 1,689 — the run file does not carry it. Moving
the rule into `KillConfirmation` without the words would have silently deleted it. Three more tests
came with it: the note fires with the reason on a fallback, fires on a confirmation that did not
repeat, and stays silent when the cheap path settled it. So 16 tests in the suite, not 11.

- [x] **Step 5: Make the report path belong to a worker**

In `Tools/CodeQuality/Sources/mutation-runner/TestRunning.swift`, replace the single `reportPath`
constant with one per worker:

```swift
/// Where a worker writes its report. One file per worker, because two workers
/// sharing one would be the easiest way to hand a mutant somebody else's
/// verdict. Emptied before every run, so a stale file cannot be read as this
/// run's answer.
func reportPath(worker: Int) -> String {
    FileManager.default.temporaryDirectory
        .appending(path: "mutation-runner-\(ProcessInfo.processInfo.processIdentifier)-\(worker).xml").path
}
```

and give `runSuite` a worker, defaulting to 0 so every existing call site is unchanged:

```swift
func runSuite(
    package: String = stubPackagePath,
    parallel: Bool,
    filters: [String] = [],
    extraEnvironment: [String: String] = [:],
    worker: Int = 0
) -> SuiteRun {
    let path = reportPath(worker: worker)
    let maxAttempts = 5
    for attempt in 1 ... maxAttempts {
        try? FileManager.default.removeItem(atPath: path)
        let result = runSwift(
            TestCommand.testArguments(
                packagePath: package, parallel: parallel, xunitPath: path, filters: filters
            ),
            timeout: testTimeout,
            extraEnvironment: extraEnvironment
        )
        if result.timedOut { return SuiteRun(result: .timedOut, report: nil) }
        let report = XUnitReport.read(contentsOfFile: path)
        if result.exitCode == 0 { return SuiteRun(result: .passed, report: report) }
        if result.output.contains(modifiedDuringBuildMarker), attempt < maxAttempts {
            Thread.sleep(forTimeInterval: 0.3)
            continue
        }
        return SuiteRun(result: .failed, report: report)
    }
    return SuiteRun(result: .failed, report: nil)
}
```

and make `verdictForMutant` call the shared decision rather than repeating it:

```swift
func verdictForMutant(
    package: String = stubPackagePath,
    extraEnvironment: [String: String] = [:]
) -> MutantOutcome {
    KillConfirmation.verdict { parallel, filters in
        runSuite(package: package, parallel: parallel, filters: filters, extraEnvironment: extraEnvironment)
    }
}
```

**As written**, with the `note:` argument from Step 4's deviation, so the two stderr lines HEAD
prints survive the move:

```swift
    KillConfirmation.verdict(
        using: { parallel, filters in
            runSuite(package: package, parallel: parallel, filters: filters, extraEnvironment: extraEnvironment)
        },
        note: { logErr("    \($0)") }
    )
```

`verdictViaHelper` in Step 6 takes a `note` of its own for the same reason, and the worker gives it
one that names the mutant — an unattributed "the whole suite decides" line is no use when three
workers are printing.

- [x] **Step 6: Write the helper runner**

Create `Tools/CodeQuality/Sources/mutation-runner/HelperRunning.swift`:

```swift
import Foundation
import MutationCore

// Running the suite without SwiftPM, so several can run at once.

/// Runs the test bundle once through the Swift Testing helper.
///
/// `runProcess` is the same launcher `runSwift` uses, so the timeout, the
/// output draining and the process-tree kill all behave the same way. The only
/// differences are the executable and the environment.
func runSuiteViaHelper(
    bundleBinary: String,
    paths: ToolchainPaths,
    mutant: Int?,
    worker: Int,
    parallel: Bool,
    filters: [String]
) -> SuiteRun {
    let path = reportPath(worker: worker)
    try? FileManager.default.removeItem(atPath: path)
    let result = runProcess(
        executable: paths.helper,
        arguments: HelperCommand.arguments(
            bundleBinary: bundleBinary, parallel: parallel, xunitPath: path, filters: filters
        ),
        timeout: testTimeout,
        extraEnvironment: HelperCommand.environment(frameworks: paths.frameworks, mutant: mutant)
    )
    return HelperCommand.result(
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        report: XUnitReport.read(contentsOfFile: path)
    )
}

/// Judges one mutant through the helper.
func verdictViaHelper(
    mutant: Int,
    bundleBinary: String,
    paths: ToolchainPaths,
    worker: Int,
    parallelTests: Bool
) -> MutantOutcome {
    KillConfirmation.verdict { parallel, filters in
        runSuiteViaHelper(
            bundleBinary: bundleBinary,
            paths: paths,
            mutant: mutant,
            worker: worker,
            // The first run follows the setting; a confirmation is always one
            // test at a time, because that is the run being trusted.
            parallel: parallel && parallelTests,
            filters: filters
        )
    }
}
```

**Deviation: `bundleBinary` and `paths` become one `TestBundle`.** As written, `runSuiteViaHelper`
takes six parameters and SwiftLint's `function_parameter_count` warns at more than five. The two
that always visit together are the bundle binary and the toolchain paths — a binary is no use
without the helper that runs it — so they became `struct TestBundle { let binary; let paths }` in
this file, and every signature below takes a `bundle:` instead of those two. Task 6's
`runSwitchedMutants` has the same problem worse (nine parameters as written); see its note.

- [x] **Step 7: Split `runSwift` so the helper can reuse it**

`runSwift` in `Support.swift` hard-codes `swiftPath`. Rename its body into a general launcher and
keep `runSwift` as a one-line wrapper, so nothing else changes:

```swift
@discardableResult
func runSwift(
    _ args: [String],
    timeout deadline: TimeInterval,
    extraEnvironment: [String: String] = [:]
) -> RunResult {
    runProcess(executable: swiftPath, arguments: args, timeout: deadline, extraEnvironment: extraEnvironment)
}
```

and change the old `runSwift` body's signature to:

```swift
@discardableResult
func runProcess(
    executable: String,
    arguments: [String],
    timeout deadline: TimeInterval,
    extraEnvironment: [String: String] = [:]
) -> RunResult {
```

with `process.executableURL = URL(filePath: executable)` and `process.arguments = arguments`
replacing the two lines that used `swiftPath` and `args`. Everything else in that function, the
pipe draining, the timer, the `ProcessTree.killTree` on timeout and the `runningChild` bookkeeping,
stays exactly as it is.

- [x] **Step 8: Build and check nothing moved**

```bash
swift build --package-path Tools/CodeQuality --product mutation-runner --disable-sandbox
swift test --package-path Tools/CodeQuality --disable-sandbox
./Scripts/mutate.sh --files Sources/FieldmarkCore/Update/RelaunchCommand.swift \
  --json .build/mutation/relaunch-jobs3.json
```

Expected: the tests pass, and the three mutants of `RelaunchCommand.swift` get the outcomes they
have always had. No worker exists yet: this task only made room for one.

**Run 2026-09-17.** 206 tests pass. All three mutants of `RelaunchCommand.swift` came back
`COMPILE_ERROR`, which is what `docs/mutation-run.json` has for all three. 67 s.
`RelaunchCommand.swift` proves nothing about the shared decision, though, because all three of its
mutants go down the old path and none reaches `verdictForMutant`. So a second scoped run was added:
`Agent/ToolArguments.swift`, 10 mutants, 9 killed and 1 survived in the reference. Both agree.

Also, the launch-failure message in `runProcess` now names `executable` instead of saying "swift",
which it no longer always is.

- [x] **Step 9: Lint, rebuild, commit**

```bash
./Scripts/lint.sh
swift test --package-path Tools/CodeQuality --disable-sandbox
swift build --package-path Tools/CodeQuality --product mutation-runner --disable-sandbox
git add Tools/CodeQuality/Sources/MutationCore/KillConfirmation.swift \
        Tools/CodeQuality/Tests/MutationCoreTests/KillConfirmationTests.swift \
        Tools/CodeQuality/Sources/mutation-runner/HelperRunning.swift \
        Tools/CodeQuality/Sources/mutation-runner/TestRunning.swift \
        Tools/CodeQuality/Sources/mutation-runner/Support.swift
git commit
```

---

### Task 4: Check the helper agrees with `swift test` before trusting it

The command line is undocumented. A toolchain update could change it, and a runner that silently
ran no tests would call every mutant a survivor. So the run starts by proving the helper agrees
with the tool it is replacing, and falls back if it does not.

**Files:**
- Create: `Tools/CodeQuality/Sources/mutation-runner/Workers.swift` (the self-check part)
- Modify: `Tools/CodeQuality/Sources/mutation-runner/main.swift`

**Interfaces:**
- Consumes: `ToolchainPaths`, `runSuiteViaHelper`, `runSuite`.
- Produces: `struct HelperCheck` with `let usable: Bool`, `let reason: String`; `func checkHelper(bundleBinary: String, paths: ToolchainPaths, package: String) -> HelperCheck`.

- [x] **Step 1: Write the implementation**

Create `Tools/CodeQuality/Sources/mutation-runner/Workers.swift` with the check. The rest of the
file arrives in Task 5.

**Four deviations, all forced by what HEAD really looks like.**

1. **The bundle name comes from the package's name, not its directory's.** Step 3's proof matters
   more than the plan expected: the directory is `.build/mutation-sandbox` and the package is
   `MutationSandbox`, so `URL(filePath: package).lastPathComponent + "PackageTests"` gives
   `mutation-sandboxPackageTests` — a file that does not exist. `SandboxLayout` now owns
   `switchedPackageName` and `plainPackageName` (both asserted, and `Sandbox.swift` uses them
   instead of its two string literals), and `HelperCommand.bundleBinary(binPath:packageName:)` is
   the pure path-building half, asserted too.
2. **The check reuses the baseline's test count instead of running `swift test` again.**
   `checkHelper(bundle:expectedTests:)`. The baseline had just run the suite serially through
   `swift test` and printed its count; running it a third time would cost another seven seconds
   for a number already in hand. Same comparison — "the same number of tests as through
   `swift test`" — against the very run the mutants are judged against. `baselinePasses` therefore
   answers `Baseline { passes, tests }` rather than `Bool`, and the two call sites read
   `.passes`.
3. **`bundleBinary` and `paths` became one `TestBundle`,** for the reason in Task 3 Step 7.
   `testBundle(inPackage:named:)` builds one, and `developerDirectory` is a resolved-once `let`
   rather than a function, matching `swiftPath` beside it.
4. **It is called from `Switching.swift`, not `main.swift`.** Part 2 moved the whole switched run
   into `runSwitchedPath`, so "inside the `if wantsSwitching` block, after the baseline passes" is
   inside that function now. `main.swift` never sees the sandbox any more.

```swift
import Foundation
import MutationCore

// Starting several suites at once, and making sure that is safe first.

struct HelperCheck {
    let usable: Bool
    let reason: String
}

/// Runs the baseline both ways and compares.
///
/// The helper's command line is not documented anywhere, so this is the only
/// thing standing between a toolchain change and a run that judges every mutant
/// a survivor because no test ever ran. Two things have to match: the suite
/// passes, and it reports the same number of tests.
func checkHelper(bundleBinary: String, paths: ToolchainPaths, package: String) -> HelperCheck {
    guard paths.exist(using: { FileManager.default.fileExists(atPath: $0) }) else {
        return HelperCheck(usable: false, reason: "the testing helper is not where it was expected")
    }
    guard FileManager.default.fileExists(atPath: bundleBinary) else {
        return HelperCheck(usable: false, reason: "the test bundle is not built")
    }

    let throughSwiftPM = runSuite(package: package, parallel: false)
    guard throughSwiftPM.result == .passed, let expected = throughSwiftPM.report, expected.total > 0 else {
        return HelperCheck(usable: false, reason: "the baseline does not pass through swift test")
    }

    let throughHelper = runSuiteViaHelper(
        bundleBinary: bundleBinary, paths: paths, mutant: nil, worker: 0, parallel: false, filters: []
    )
    guard throughHelper.result == .passed else {
        return HelperCheck(usable: false, reason: "the baseline does not pass through the helper")
    }
    guard let got = throughHelper.report, got.total == expected.total else {
        let got = throughHelper.report?.total ?? 0
        return HelperCheck(
            usable: false,
            reason: "the helper ran \(got) test(s) where swift test ran \(expected.total)"
        )
    }
    return HelperCheck(usable: true, reason: "\(expected.total) tests, both ways")
}
```

- [x] **Step 2: Call it from `main.swift`**

Inside the `if wantsSwitching` block Plan A added, after the baseline passes and before the
switched mutants are judged:

```swift
    let toolchain = ToolchainPaths.resolve(
        swiftPath: swiftPath,
        developerDirectory: developerDirectory()
    )
    let bundleBinary = testBundleBinary(inPackage: layout.switchedPackage)
    let check = checkHelper(bundleBinary: bundleBinary, paths: toolchain, package: layout.switchedPackage)
    // One for now. Task 6 adds `--jobs` and this becomes
    // `check.usable ? arguments.jobs : 1`.
    let jobs = 1
    if check.usable {
        log("Testing helper checked: \(check.reason).")
    } else {
        logErr("Running with one job through swift test: \(check.reason).")
    }
```

and two small helpers in `Workers.swift`:

```swift
/// `xcode-select -p`, resolved once.
func developerDirectory() -> String {
    let result = runProcess(executable: "/usr/bin/xcode-select", arguments: ["-p"], timeout: 30)
    let path = result.output.trimmingCharacters(in: .whitespacesAndNewlines)
    return path.isEmpty ? "/Applications/Xcode.app/Contents/Developer" : path
}

/// The binary inside the built test bundle, which is what the helper is handed.
///
/// Asked of SwiftPM rather than guessed, because the bin path carries the
/// architecture and the configuration.
func testBundleBinary(inPackage package: String) -> String {
    let result = runSwift(
        ["build", "--package-path", package, "--show-bin-path", "--disable-sandbox"],
        timeout: testTimeout
    )
    let binPath = result.output.split(separator: "\n").last.map(String.init)?
        .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let name = URL(filePath: package).lastPathComponent + "PackageTests"
    return binPath + "/\(name).xctest/Contents/MacOS/\(name)"
}
```

- [x] **Step 3: Check the bundle name is right on this machine**

The name is the package's name with `PackageTests` after it. Plan A names the instrumented package
`MutationSandbox`, so the bundle is `MutationSandboxPackageTests`. Prove it rather than trust it:

```bash
./Scripts/mutate.sh --switched --list --files Sources/FieldmarkCore/Update/RelaunchCommand.swift > /dev/null
ls "$(swift build --package-path .build/mutation-sandbox --show-bin-path --disable-sandbox)" | grep xctest
```

Expected: `MutationSandboxPackageTests.xctest`. If the name differs, fix `testBundleBinary` to match
what is really there before going on.

**Checked 2026-09-17.** `MutationSandboxPackageTests.xctest`, holding
`Contents/MacOS/MutationSandboxPackageTests`. The bin path is
`.build/mutation-sandbox/.build/arm64-apple-macosx/debug`, so the sandbox has a `.build` of its own
and the architecture is in the path — which is why it is asked of SwiftPM. This is the step that
found deviation 1 above: the package's name and its directory's differ.

- [x] **Step 4: Build and run the check for real**

```bash
swift build --package-path Tools/CodeQuality --product mutation-runner --disable-sandbox
./Scripts/mutate.sh --switched --files Sources/FieldmarkCore/Update/RelaunchCommand.swift \
  --json .build/mutation/relaunch-check.json
```

Expected: a line reading `Testing helper checked: 2043 tests, both ways.` and the same three
outcomes as always.

**Run 2026-09-17** on `Agent/ToolArguments.swift` rather than `RelaunchCommand.swift`, because all
three of that file's mutants take the old path and never reach the check. Printed
`Testing helper checked: 2150 tests, both ways.` — 2,150 now, not the 2,043 the design measured, the
suite having grown since. 9 killed and 1 survived, matching `docs/mutation-run.json`. 31 s.

- [x] **Step 5: Prove the fallback**

Break the helper path on purpose and check the run still finishes, slowly.

```bash
HELPER="$(dirname "$(xcrun --find swift)")/../libexec/swift/pm/swiftpm-testing-helper"
test -x "$HELPER" && echo "helper is there, so temporarily point the runner at a path that is not"
```

Then change `ToolchainPaths.resolve` in a scratch edit to return `helper: "/nonexistent"`, rebuild,
run the same command, and expect
`Running with one job through swift test: the testing helper is not where it was expected.`
followed by a normal run. Undo the scratch edit and rebuild before committing.

**Done 2026-09-17.** With `helper: "/nonexistent"`, a run of `Agent/AgentMessage.swift` printed
exactly that line and then judged its one mutant KILLED, the verdict it has always had. The scratch
edit was reverted (`git diff` on the file is empty) and everything rebuilt.

- [x] **Step 6: Lint, rebuild, commit**

```bash
./Scripts/lint.sh
swift test --package-path Tools/CodeQuality --disable-sandbox
swift build --package-path Tools/CodeQuality --product mutation-runner --disable-sandbox
git add Tools/CodeQuality/Sources/mutation-runner/Workers.swift \
        Tools/CodeQuality/Sources/mutation-runner/main.swift
git commit
```

---

### Task 5: The queue, the ledger and the printer

Three small locked types. Everything the workers share is one of them.

**Files:**
- Create: `Tools/CodeQuality/Sources/MutationCore/WorkQueue.swift`
- Create: `Tools/CodeQuality/Tests/MutationCoreTests/WorkQueueTests.swift`

**Interfaces:**
- Consumes: `MutantOutcome`.
- Produces:
  - `public final class MutantQueue: @unchecked Sendable` with `public init(count: Int)`, `public func next() -> Int?`, `public var taken: Int`.
  - `public final class RunLedger: @unchecked Sendable` with `public init()`, `public func record(position: Int, outcome: MutantOutcome)`, `public func outcome(at position: Int) -> MutantOutcome?`, `public var count: Int`, `public func inPlanOrder(upTo count: Int) -> [MutantOutcome?]`.

- [x] **Step 1: Write the failing tests**

Create `Tools/CodeQuality/Tests/MutationCoreTests/WorkQueueTests.swift`:

```swift
import Foundation
import MutationCore
import Testing

/// The two pieces of state several workers share. A queue that hands out each
/// mutant exactly once, and a ledger that remembers results by where they sit
/// in the plan rather than by when they finished, so the run file reads the
/// same however the machine happened to schedule things.
@Suite(.serialized) struct WorkQueueTests {
    @Test func theQueueHandsOutEveryPositionOnceAndThenStops() {
        let queue = MutantQueue(count: 3)
        #expect([queue.next(), queue.next(), queue.next()] == [0, 1, 2])
        #expect(queue.next() == nil)
        #expect(queue.taken == 3)
    }

    @Test func anEmptyQueueHandsOutNothing() {
        let queue = MutantQueue(count: 0)
        #expect(queue.next() == nil)
    }

    /// The real test: eight threads pulling at once must between them see every
    /// position exactly once. A lost or a duplicated one is a mutant never
    /// judged or judged twice, and either way the report is wrong.
    @Test func everyPositionComesOutExactlyOnceUnderEightThreads() {
        let queue = MutantQueue(count: 5000)
        let lock = NSLock()
        var seen: [Int] = []
        DispatchQueue.concurrentPerform(iterations: 8) { _ in
            while let position = queue.next() {
                lock.lock()
                seen.append(position)
                lock.unlock()
            }
        }
        #expect(seen.count == 5000)
        #expect(Set(seen).count == 5000)
    }

    @Test func theLedgerKeepsPlanOrderWhateverOrderItIsWrittenIn() {
        let ledger = RunLedger()
        ledger.record(position: 2, outcome: .survived)
        ledger.record(position: 0, outcome: .killed)
        ledger.record(position: 1, outcome: .compileError)
        #expect(ledger.count == 3)
        #expect(ledger.inPlanOrder(upTo: 4) == [.killed, .compileError, .survived, nil])
        #expect(ledger.outcome(at: 2) == .survived)
        #expect(ledger.outcome(at: 9) == nil)
    }

    @Test func theLedgerSurvivesEightThreadsWritingAtOnce() {
        let ledger = RunLedger()
        DispatchQueue.concurrentPerform(iterations: 8) { worker in
            for step in 0 ..< 500 {
                ledger.record(position: worker * 500 + step, outcome: .killed)
            }
        }
        #expect(ledger.count == 4000)
        #expect(ledger.inPlanOrder(upTo: 4000).allSatisfy { $0 == .killed })
    }
}
```

- [x] **Step 2: Run the tests and watch them fail**

```bash
swift test --package-path Tools/CodeQuality --disable-sandbox --filter WorkQueueTests
```

Expected: the build fails with `cannot find 'MutantQueue' in scope`.

- [x] **Step 3: Write the implementation**

Create `Tools/CodeQuality/Sources/MutationCore/WorkQueue.swift`:

```swift
import Foundation

/// Which mutant a worker takes next.
///
/// A position in the plan, not a mutant number: the caller knows what sits at
/// each position. `@unchecked Sendable` because the lock is the invariant and
/// the compiler cannot see it.
public final class MutantQueue: @unchecked Sendable {
    private let lock = NSLock()
    private let count: Int
    private var handedOut = 0

    public init(count: Int) {
        self.count = count
    }

    /// The next position, or `nil` when there are none left.
    public func next() -> Int? {
        lock.lock(); defer { lock.unlock() }
        guard handedOut < count else { return nil }
        defer { handedOut += 1 }
        return handedOut
    }

    public var taken: Int {
        lock.lock(); defer { lock.unlock() }
        return handedOut
    }
}

/// What every mutant came to, by where it sits in the plan.
///
/// Keyed by position rather than appended, because workers finish in whatever
/// order the machine decides and the run file has to read the same every time.
public final class RunLedger: @unchecked Sendable {
    private let lock = NSLock()
    private var outcomes: [Int: MutantOutcome] = [:]

    public init() {}

    public func record(position: Int, outcome: MutantOutcome) {
        lock.lock(); defer { lock.unlock() }
        outcomes[position] = outcome
    }

    public func outcome(at position: Int) -> MutantOutcome? {
        lock.lock(); defer { lock.unlock() }
        return outcomes[position]
    }

    public var count: Int {
        lock.lock(); defer { lock.unlock() }
        return outcomes.count
    }

    /// Every position from 0, with `nil` where nothing was recorded.
    public func inPlanOrder(upTo count: Int) -> [MutantOutcome?] {
        lock.lock(); defer { lock.unlock() }
        return (0 ..< count).map { outcomes[$0] }
    }
}
```

- [x] **Step 4: Run the tests and watch them pass**

```bash
swift test --package-path Tools/CodeQuality --disable-sandbox --filter WorkQueueTests
```

Expected: `✔ Test run with 5 tests in 1 suite passed`.

- [x] **Step 5: Add the printer and the plan box**

These two live in the runner because nothing else needs them. Add to
`Tools/CodeQuality/Sources/mutation-runner/Workers.swift`:

```swift
/// One progress line at a time.
///
/// A line can be longer than the 512 bytes a pipe write is atomic up to, and
/// two workers finishing together would then interleave halfway through a
/// mutant description. One lock is cheaper than reading that.
final class Printer: @unchecked Sendable {
    private let lock = NSLock()

    func line(_ text: String) {
        lock.lock(); defer { lock.unlock() }
        log(text)
    }
}

/// The plan, handed to the workers read-only.
///
/// `@unchecked Sendable` for the other reason: it is written once, before any
/// worker starts, and never again.
final class PlanBox: @unchecked Sendable {
    let items: [PlannedMutant]
    let numbers: [String: Int]

    init(items: [PlannedMutant], numbers: [String: Int]) {
        self.items = items
        self.numbers = numbers
    }
}

/// Every child a worker has running, so a signal can take them all down.
final class RunningChildren: @unchecked Sendable {
    private let lock = NSLock()
    private var pids: Set<pid_t> = []

    func begin(_ pid: pid_t) {
        lock.lock(); defer { lock.unlock() }
        pids.insert(pid)
    }

    func end(_ pid: pid_t) {
        lock.lock(); defer { lock.unlock() }
        pids.remove(pid)
    }

    /// Safe to call repeatedly and from a signal handler's queue.
    func killAll() {
        lock.lock()
        let current = pids
        lock.unlock()
        for pid in current { ProcessTree.killTree(pid) }
    }
}
```

and replace `RunningChild` in `Support.swift` with it: delete that class, change the global in
`main.swift` to `let runningChildren = RunningChildren()`, and change the two lines in
`runProcess` to `runningChildren.begin(pid)` and `defer { runningChildren.end(pid) }`, and the
signal handler to `runningChildren.killAll()`. The signal handler is
`restoreAndExitOnSignal()` in `Support.swift`, not a closure in `main.swift`: top-level code is
`@MainActor`, and a closure written there traps the moment Dispatch calls it on the signal
queue. Leave it where it is.

**Two deviations.**

1. **`PlanBox` carries `total`.** Task 6's `runSwitchedMutants` as written takes nine parameters and
   SwiftLint warns past five. `total` is plan-shaped, so it belongs here; `startingAt` went away
   entirely, because the switched batch is always first and always starts at 0. That leaves the
   worker call at four arguments.
2. **`Printer` also has `note`,** writing to stderr under the same lock. That is where the
   "the whole suite decides" line goes when a worker hits the fallback. Same lock for both, because
   the point is that one worker's line cannot land inside another's.

`RunningChild` was deleted from `Support.swift` and `RunningChildren` lives in `Workers.swift`,
exactly as written. `restoreAndExitOnSignal()` was left where it is.

- [x] **Step 6: Build and commit**

```bash
swift build --package-path Tools/CodeQuality --product mutation-runner --disable-sandbox
./Scripts/lint.sh
swift test --package-path Tools/CodeQuality --disable-sandbox
swift build --package-path Tools/CodeQuality --product mutation-runner --disable-sandbox
git add Tools/CodeQuality/Sources/MutationCore/WorkQueue.swift \
        Tools/CodeQuality/Tests/MutationCoreTests/WorkQueueTests.swift \
        Tools/CodeQuality/Sources/mutation-runner/Workers.swift \
        Tools/CodeQuality/Sources/mutation-runner/Support.swift \
        Tools/CodeQuality/Sources/mutation-runner/main.swift
git commit
```

---

### Task 6: Run N of them

**Files:**
- Modify: `Tools/CodeQuality/Sources/MutationCore/RunnerArguments.swift`
- Modify: `Tools/CodeQuality/Tests/MutationCoreTests/RunnerArgumentsTests.swift`
- Modify: `Tools/CodeQuality/Sources/mutation-runner/Workers.swift`
- Modify: `Tools/CodeQuality/Sources/mutation-runner/main.swift`

**Interfaces:**
- Consumes: everything above.
- Produces: `RunnerArguments.jobs: Int`, and `func runSwitchedMutants(plan: PlanBox, bundleBinary: String, paths: ToolchainPaths, jobs: Int, parallelTests: Bool, ledger: RunLedger, printer: Printer, total: Int, startingAt: Int)`.

- [x] **Step 1: Write the failing test**

Add to `RunnerArgumentsTests`:

```swift
    /// How many suites run at once. The default is worked out from the machine
    /// rather than written down, because a four-core laptop and a build server
    /// want different answers.
    @Test func theJobsFlagParsesAndDefaultsToTheMachine() throws {
        #expect(try RunnerArguments.parse(["--jobs", "3"]).jobs == 3)
        #expect(try RunnerArguments.parse([]).jobs == RunnerArguments.defaultJobs)
        #expect(RunnerArguments.defaultJobs >= 1)
    }

    @Test func aJobsValueThatIsNotANumberIsRefused() {
        #expect(throws: RunnerArguments.Failure.self) {
            _ = try RunnerArguments.parse(["--jobs", "lots"])
        }
    }

    @Test func zeroJobsIsRefusedRatherThanQuietlyMeaningOne() {
        #expect(throws: RunnerArguments.Failure.self) {
            _ = try RunnerArguments.parse(["--jobs", "0"])
        }
    }
```

- [x] **Step 2: Run it and watch it fail**

```bash
swift test --package-path Tools/CodeQuality --disable-sandbox --filter RunnerArgumentsTests
```

Expected: the build fails with `value of type 'RunnerArguments' has no member 'jobs'`.

- [x] **Step 3: Add the flag**

In `RunnerArguments`:

```swift
    /// How many suites run at once.
    public var jobs = RunnerArguments.defaultJobs

    /// One per core, less one for the runner itself and whatever else is going
    /// on. Task 7 of the jobs plan measured the best value on a four-core
    /// machine; this is the shape of the answer, not a guess.
    public static let defaultJobs = max(1, ProcessInfo.processInfo.activeProcessorCount - 1)
```

in the switch:

```swift
            case "--jobs":
                guard let value = iterator.next(), let count = Int(value), count >= 1 else {
                    throw Failure(message: "--jobs needs a whole number of 1 or more")
                }
                parsed.jobs = count
```

and in the usage text:

```swift
                           [--switched] [--legacy] [--jobs <n>]
```

- [x] **Step 4: Run it and watch it pass**

```bash
swift test --package-path Tools/CodeQuality --disable-sandbox --filter RunnerArgumentsTests
```

Expected: `✔ Test run with 9 tests in 1 suite passed`.

**Deviation.** 10 tests, because `RunnerArgumentsTests` already had seven. `take(flag:from:)` went
over SwiftLint's complexity budget with `--jobs` in it (11 of 10), so the flags that take one value
after them — `--json` and `--jobs` — moved into a `take(valueFlag:from:)` of their own.

- [x] **Step 5: Write the worker loop**

Add to `Tools/CodeQuality/Sources/mutation-runner/Workers.swift`:

```swift
/// Judges every switched mutant, `jobs` at a time.
///
/// Nothing on disk changes between mutants, so the workers share the build and
/// touch nothing but the four locked types above. Results go into the ledger by
/// position, so the report stays in plan order however they finish; the lines
/// print as they land, which is what a person watching wants.
/// **Changed 2026-09-17 by part 2's task 11.** This used to take `prune:
/// PruneResult` and answer `.compileError` for a mutant in `prune.compileErrors`.
/// It does not any more: the compiler blames a switch it cannot type-check on
/// its *first* case whichever case is at fault, so the prune loop's skip set is
/// not a set of compile errors. Those mutants go down the old path instead, which
/// compiles each alone. `PruneResult` is still what the caller splits the plan
/// with; it just does not reach a worker.
func runSwitchedMutants(
    plan: PlanBox,
    bundleBinary: String,
    paths: ToolchainPaths,
    jobs: Int,
    parallelTests: Bool,
    ledger: RunLedger,
    printer: Printer,
    total: Int,
    startingAt: Int
) {
    let queue = MutantQueue(count: plan.items.count)
    let group = DispatchGroup()

    for worker in 0 ..< max(1, jobs) {
        DispatchQueue.global().async(group: group) {
            while let position = queue.next() {
                let item = plan.items[position]
                guard let number = plan.numbers[item.fingerprint] else { continue }
                // Every mutant here compiled inside the instrumented build, so
                // there is no `compile_error` to shortcut: that verdict only
                // comes from the old path. See the note on the signature above.
                let outcome: MutantOutcome = verdictViaHelper(
                    mutant: number,
                    bundleBinary: bundleBinary,
                    paths: paths,
                    worker: worker,
                    parallelTests: parallelTests
                )
                ledger.record(position: position, outcome: outcome)
                printer.line(
                    "[\(startingAt + ledger.count)/\(total)] \(item.mutant.description) … "
                        + label(for: outcome)
                )
            }
        }
    }
    group.wait()
}

/// What an outcome prints as. The old path's `Category` has its own; this is
/// the same words for the outcome type the workers deal in.
func label(for outcome: MutantOutcome) -> String {
    switch outcome {
    case .killed: "KILLED"
    case .survived: "SURVIVED"
    case .compileError: "COMPILE_ERROR"
    case .planned: "PLANNED"
    }
}
```

**The one deviation in this plan that changes something outside it, and it is the reason this task
took two attempts.**

The first `--jobs 3` run judged nine of ten mutants and then stopped dead for eleven minutes.
`sample` on the runner showed one thread parked in `-[NSConcreteTask waitUntilExit]` and a worker
parked behind it on its semaphore, with `ps` showing **no child process and no zombie**: the child
had exited and been reaped, and the wait never returned. Darwin's Foundation delivers a task's
termination through a run loop, and a `waitUntilExit` on a Dispatch worker thread can lose that
wakeup once several tasks end at once. Nothing about this is specific to the mutation runner; it is
what `Process` does.

So the launcher moved out of the executable and into `MutationCore/Subprocess.swift`, where it can be
tested:

- `SubprocessCommand` (executable, arguments, working directory, environment, timeout) and
  `SubprocessResult` (exit code, timed out, output). `RunResult` in the runner is now a typealias for
  the second, so no call site changed.
- The wait is `process.terminationHandler` signalling a `DispatchSemaphore`, and
  `finished.wait(timeout:)` **is** the deadline — the timer source, the second waiting thread and the
  race comment about a timer firing after the child exits are all gone with it.
- Every wait has a deadline now. The pipe drain waits 30 s for EOF after the child has ended and
  says so in site of the output if it never comes; the post-kill wait for the handler is 60 s, and
  `terminationStatus` is only read if the handler reported, because reading it early raises.
- `began`/`ended` closures replace the direct `runningChildren` access, which is what keeps
  `MutationCore` free of the runner's globals.
- `Tests/MutationCoreTests/SubprocessTests.swift`: six tests, the last one 40 children over 8
  threads each writing megabytes. **Being honest about it:** that test did not reproduce the
  deadlock against the old code. Real suite runs of four seconds each did, and they are too slow for
  a unit test. What the test does prove is that the new launcher handles exactly the concurrency the
  workers use without losing a result; the full run in Task 8 is the other half.

`Support.swift` is 118 lines shorter and the executable target has no tricky concurrency left in it.

- [x] **Step 6: Call it from `main.swift`**

First make the job count real. Task 4 left `let jobs = 1` with a note; change it to:

```swift
    let jobs = check.usable ? arguments.jobs : 1
```

Then replace the serial `for item in order.switched { … }` loop Plan A wrote with:

```swift
    let box = PlanBox(items: order.switched, numbers: numbers)
    let ledger = RunLedger()
    let printer = Printer()
    runSwitchedMutants(
        plan: box,
        bundleBinary: bundleBinary,
        paths: toolchain,
        jobs: jobs,
        parallelTests: jobs == 1,
        ledger: ledger,
        printer: printer,
        total: total,
        startingAt: 0
    )
    for (position, outcome) in ledger.inPlanOrder(upTo: order.switched.count).enumerated() {
        guard let outcome else { continue }
        let category: Category = switch outcome {
        case .killed: .killed
        case .compileError: .compileError
        default: .survived
        }
        outcomes.append(Outcome(planned: order.switched[position], category: category))
    }
    position = order.switched.count
```

`parallelTests: jobs == 1` is the honest default until Task 7 measures it: one worker may as well
use every core inside the suite, and several workers should not fight each other for them.

The old-path loop underneath is unchanged. It still runs last and one at a time, because it
rebuilds the plain package between mutants and two rebuilds of one package cannot overlap.

**Deviations.** All of this went into `Switching.swift`, where part 2 put the switched run, and it
went in as two functions rather than inline, because `runSwitchedPath` was over SwiftLint's
50-line body budget with it there:

- `checkEverythingBeforeJudging(package:)` does the three checks in the order in which a failure of
  one makes the next meaningless — baseline both ways, helper against `swift test`, baseline with
  `jobs` copies at once — and answers `SwitchedStart { bundle, jobs, viaHelper }`.
- `judgeByWorkers(_:bundle:jobs:)` runs the workers and reads the ledger back in plan order.
- **The old serial `judgeSwitched` stays, and is what runs when the helper check fails.** The plan
  had the fallback as "one job", which through the workers would still be the helper. It has to be
  `swift test`, as the design says, because the reason for falling back is that the helper cannot be
  trusted. So `viaHelper == false` means the run goes down the path part 2 shipped, unchanged.
  Both paths call `KillConfirmation.verdict`, so there is still one rule.

- [x] **Step 7: Run the baseline N at once before judging anything**

The suite passing alone says nothing about it passing beside two copies of itself. The core tests
use their own temporary directories and no shared preferences, which is why this is expected to
work, but "expected" is not "checked". Add this to `main.swift`, right after the helper check and
before any mutant is judged:

```swift
    if jobs > 1 {
        let ledger = RunLedger()
        let printer = Printer()
        let queue = MutantQueue(count: jobs)
        let group = DispatchGroup()
        for worker in 0 ..< jobs {
            DispatchQueue.global().async(group: group) {
                while let position = queue.next() {
                    let run = runSuiteViaHelper(
                        bundleBinary: bundleBinary, paths: toolchain, mutant: nil,
                        worker: worker, parallel: false, filters: []
                    )
                    ledger.record(position: position, outcome: run.result == .passed ? .killed : .survived)
                }
            }
        }
        group.wait()
        let failures = ledger.inPlanOrder(upTo: jobs).count { $0 != .killed }
        guard failures == 0 else {
            logErr("The baseline fails when \(jobs) suites run at once (\(failures) of \(jobs) red).")
            logErr("The tests are not safe side by side. Use --jobs 1, or fix the test that shares state.")
            exit(2)
        }
        printer.line("Baseline: \(jobs) suites at once, all green.")
    }
```

`.killed` and `.survived` are being borrowed here to mean green and red, because `RunLedger` deals
in outcomes. That is ugly enough to be worth a comment in the code saying so.

```bash
swift build --package-path Tools/CodeQuality --product mutation-runner --disable-sandbox
./Scripts/mutate.sh --switched --jobs 3 --files Sources/FieldmarkCore/Update/RelaunchCommand.swift
```

Expected: `Baseline: 3 suites at once, all green.` before the mutant lines. If it is red, stop:
some test shares state with another copy of itself, and every verdict from here on would be a
coin toss.

- [x] **Step 8: Prove several at once gives the same answers as one**

```bash
swift build --package-path Tools/CodeQuality --product mutation-runner --disable-sandbox
./Scripts/mutate.sh --switched --jobs 1 --files Sources/FieldmarkCore/Discovery/ChainSites.swift \
  --json .build/mutation/chain-j1.json
time ./Scripts/mutate.sh --switched --jobs 3 --files Sources/FieldmarkCore/Discovery/ChainSites.swift \
  --json .build/mutation/chain-j3.json
./Scripts/mutate-triage.sh compare .build/mutation/chain-j1.json .build/mutation/chain-j3.json
echo "exit: $?"
```

Expected: `The two runs agree on every mutant.` and `exit: 0`, with the three-job run faster. If any
mutant differs, do not move on: under load a test that passes alone can fail beside another, and a
difference here means the kill confirmation is not doing its job.

**Run 2026-09-17. `The two runs agree on every mutant.`, exit 0.** Both runs: 22 mutants, 12 killed,
4 survived, 6 compile errors — the same counts `docs/mutation-run.json` has for this file. One job
1:06, three jobs 1:02, which is barely faster and says something worth knowing: this file has 16
switched mutants and 6 old-path ones, so the fixed costs (writing the sandbox, the prune build, two
baselines, the plain package's build, six builds of one mutant each) are most of the minute and only
the 16 get shared out. Parallelism shows up on a whole-module run, not on a file.

- [x] **Step 9: Prove the report is still in plan order**

```bash
grep '"line"' .build/mutation/chain-j3.json | head -5
diff <(grep '"fingerprint"' .build/mutation/chain-j1.json) \
     <(grep '"fingerprint"' .build/mutation/chain-j3.json) && echo "same order"
```

Expected: `same order`. Workers finish out of order; the file does not.

**`same order`, 22 fingerprints, 2026-09-17.** The three-job log shows the workers finishing out of
order (`[6/10]` printed before `[5/10]` on the earlier ToolArguments run); the file does not.

- [x] **Step 10: Prove an interrupt stops everything**

```bash
./Scripts/mutate.sh --switched --jobs 3 --files Sources/FieldmarkCore/Discovery &
sleep 30
kill -INT %1
sleep 3
pgrep -fl 'swiftpm-testing-helper' | wc -l
git status --short
```

Expected: `0` from `pgrep`, and nothing from `git status --short`. Three workers means three trees
to take down, which is why `RunningChildren` holds a set.

**Done 2026-09-17.** A `--jobs 3` run over all of `Discovery` (203 mutants) was interrupted at
mutant 11 with three helpers running. Afterwards: 0 helpers, 0 runners, no file under
`Sources/FieldmarkCore` modified, and `.build/mutation-sandbox.lock` gone. The signal was sent to the
runner's own pid, which is also the script's — `mutate.sh` ends in `exec`.

- [x] **Step 11: Lint, rebuild, commit**

```bash
./Scripts/lint.sh
swift test --package-path Tools/CodeQuality --disable-sandbox
swift build --package-path Tools/CodeQuality --product mutation-runner --disable-sandbox
git add Tools/CodeQuality/Sources/MutationCore/RunnerArguments.swift \
        Tools/CodeQuality/Tests/MutationCoreTests/RunnerArgumentsTests.swift \
        Tools/CodeQuality/Sources/mutation-runner/Workers.swift \
        Tools/CodeQuality/Sources/mutation-runner/main.swift
git commit
```

---

### Task 7: Measure, and set the defaults from the measurement

Two questions the design left open: how many workers, and whether each worker should run the suite
in parallel or one test at a time. Three workers with serial tests did 7.03 s for three suites on
2026-09-17, against 6.1 s for one, which suggests serial tests and as many workers as the machine
can feed. That is a suggestion, not an answer.

**Files:**
- Modify: `Tools/CodeQuality/Sources/MutationCore/RunnerArguments.swift`
- Modify: `Tools/CodeQuality/Sources/mutation-runner/main.swift`

**Interfaces:**
- Consumes: Task 6.
- Produces: the measured defaults, written into `defaultJobs` and the `parallelTests` decision.

- [x] **Step 1: Pick a sample of about 100 mutants**

```bash
./Scripts/mutate.sh --switched --list --json .build/mutation/plan.json \
  --files Sources/FieldmarkCore/Discovery Sources/FieldmarkCore/Route
grep -c '"fingerprint"' .build/mutation/plan.json
```

Expected: somewhere near 100. Those two directories together are a good sample: they hold long
functions, short ones and both rule 1 and rule 2 containers. If the count is far off 100, add or
drop a directory until it is close.

**Deviation: `Sources/FieldmarkCore/Route` alone, 104 mutants.** The two directories together are
283 today, and ten passes over 283 is three hours of measuring. `Route` on its own is 104 —
`RoutePlanning.swift` 43, `DayPlanner.swift` 30, `RouteOptimization.swift` 30,
`RouteModels.swift` 1 — and it holds long functions and short ones, 96 switched mutants and 8
that take the old path, killed, survived and compile-error verdicts all three.

- [x] **Step 2: Time the combinations**

Each of these is one full pass over the sample. Run them back to back, on a quiet machine, and
write down the wall-clock time of each.

```bash
for jobs in 1 2 3 4 5; do
  echo "== jobs $jobs, tests one at a time"
  time ./Scripts/mutate.sh --switched --jobs "$jobs" \
    --files Sources/FieldmarkCore/Discovery Sources/FieldmarkCore/Route \
    --json ".build/mutation/sample-j$jobs.json" > /dev/null
done
```

Then change `parallelTests: jobs == 1` in `main.swift` to `parallelTests: true`, rebuild, and run
the same loop again, saving to `sample-p$jobs.json`. Put it back afterwards.

**Measured 2026-09-17**, four cores, 8 GB, nothing else of mine running and nothing above about 2%
of a core belonging to anyone else. 104 mutants a pass, `Sources/FieldmarkCore/Route`. The setting
lives in `Switching.swift`, not `main.swift`; it was pinned to `false` for the first group and `true`
for the second, so that "one worker, serial tests" is really measured rather than inferred.

| Tests inside a worker | Workers | Wall | Per mutant | CPU |
| --- | ---: | ---: | ---: | ---: |
| one at a time | 1 | 4:41 | 2.70 s | 81% |
| one at a time | 2 | 2:36 | 1.50 s | 146% |
| one at a time | 3 | 1:57 | 1.13 s | 203% |
| one at a time | 4 | 1:38 | 0.94 s | 243% |
| one at a time | **5** | **1:30** | **0.87 s** | 265% |
| in parallel | 1 | 2:06 | 1.21 s | 188% |
| in parallel | 2 | 1:37 | 0.94 s | 252% |
| in parallel | 3 | 1:34 | 0.90 s | 266% |

Two things in that table are worth more than the winner. **CPU time per pass barely moves** —
229 to 250 CPU-seconds across all eight — so nothing is being wasted by running several at once; the
wall clock is just being filled in. And **one worker with serial tests keeps only 0.81 of a core
busy**, which is why five workers beat four on four cores: a worker waiting on the file system is
not using the core it was given. Parallel tests win at equal worker counts (1.21 against 2.70 at one
worker) and lose outright, because they compete with the other workers for the same cores.

Five workers with serial tests is 3.1 times faster than one, on four cores.

- [x] **Step 3: Check every combination gave the same answers**

```bash
for jobs in 2 3 4 5; do
  ./Scripts/mutate-triage.sh compare .build/mutation/sample-j1.json ".build/mutation/sample-j$jobs.json" \
    || echo "MISMATCH at jobs $jobs"
done
```

Expected: `The two runs agree on every mutant.` five times and no `MISMATCH`. A mismatch that only
appears at higher job counts is load making a test flaky; find the test and fix it before setting
the default any higher.

**All seven comparisons against `sample-s1` printed `The two runs agree on every mutant.`** — the
four other serial job counts and all three parallel ones. Every pass came to 80 killed, 16 survived
and 8 compile errors, and `sample-s1` matches `docs/mutation-run.json` file by file:
`DayPlanner.swift` 25 killed, 4 survived, 1 compile error; `RouteModels.swift` 1 killed;
`RoutePlanning.swift` 38 killed, 5 compile errors; `RouteOptimization.swift` 16 killed, 12
survived, 2 compile errors. Eight passes over the same 104 mutants at every load from one worker to
five, and not one verdict moved.

- [x] **Step 4: Set the defaults**

Divide each time by the mutant count to get seconds per mutant. Take the combination with the
lowest number that also passed Step 3, and write it in.

If serial tests win, as expected, `parallelTests` becomes `false` outright and the comment in
`main.swift` says which sample said so:

```swift
        // Serial tests inside each worker. Measured on <date> over <n> mutants:
        // <j> workers with serial tests came to <x> s per mutant, against <y> s
        // for one worker with the suite running in parallel.
        parallelTests: false,
```

and `defaultJobs` gets the shape the measurement supports, for example:

```swift
    /// Measured on <date>: <j> workers was fastest on a four-core machine, and
    /// the curve was flat from <j> upwards, so this leaves one core for the
    /// runner and whatever else is running.
    public static let defaultJobs = max(1, ProcessInfo.processInfo.activeProcessorCount - 1)
```

Change the formula only if the measurement disagrees with it. Either way, replace `<date>`, `<n>`,
`<j>`, `<x>` and `<y>` with the numbers you measured. A comment with a placeholder left in it is
worse than no comment.

**Set: `parallelTests: false`, and `defaultJobs = activeProcessorCount + 1`.**

The measurement disagrees with `- 1`, so the formula changed. Five workers on four cores was the
fastest of the eight combinations at 0.87 s a mutant, four was 0.94 and three — what `- 1` would
have given — was 1.13, a third slower. The reason is in the CPU column: one worker running the suite
one test at a time keeps 0.81 of a core busy, so four cores have room for about five of them, and
the runner itself does nothing at all while they work, which is what `- 1` was reserving a core for.
The curve is flat past four, so a machine with more cores loses very little by taking the formula
literally, and both comments say outright that the default saturates the machine and `--jobs` is how
to get it back.

- [x] **Step 5: Lint, rebuild, commit**

```bash
./Scripts/lint.sh
swift test --package-path Tools/CodeQuality --disable-sandbox
swift build --package-path Tools/CodeQuality --product mutation-runner --disable-sandbox
git add Tools/CodeQuality/Sources/MutationCore/RunnerArguments.swift \
        Tools/CodeQuality/Sources/mutation-runner/main.swift
git commit
```

The commit message carries the table of times. It is the only record of why the default is what it
is.

---

### Task 8: Run the whole thing and write down what it costs

**Files:**
- Modify: `docs/mutation-testing.md`
- Modify: `.claude/skills/mutation-triage/SKILL.md`

**Interfaces:**
- Consumes: everything.
- Produces: numbers a person can plan around.

- [x] **Step 1: Run the whole module**

```bash
time ./Scripts/mutate.sh --json .build/mutation/full-parallel.json
```

Expected: 1,697 mutants and a summary. Write down the wall-clock time and divide by 1,697.

**Run 2026-09-17: 27 minutes 44 seconds for 1,690 mutants — 0.98 seconds a mutant.** 1,690 rather
than 1,697 because the plan has moved since `7c55454`; see Step 2. 1,563 killed, 73 survived, 54
compile errors, score 95.5%.

Where it went: the prune loop converged in **4 rounds** and dropped 3 containers, exactly as part 2's
run did; **1,619 mutants switched and 71 took the old path**; both baselines green at 2,150 tests;
`Testing helper checked: 2150 tests, both ways.`; `Baseline: 5 suites at once, all green.` CPU over
the run was 250%, so 2.5 of the 4 cores were busy end to end — the tail is the 71 old-path mutants,
which are serial and rebuild a package each.

For scale: the same plan took 1 h 34 min under part 2 alone, at 3.3 s a mutant. Part 3 is **3.4
times faster than that**, and about **nine times faster than the four and a half hours** this work
started from.

- [x] **Step 2: Compare it with the proof run from the switching plan**

```bash
./Scripts/mutate-triage.sh compare \
  docs/superpowers/plans/2026-09-17-old-path-reference-run.json \
  .build/mutation/full-parallel.json
echo "exit: $?"
```

Expected: `The two runs agree on every mutant.` and `exit: 0`, unless `Sources/FieldmarkCore` or
`Tests/FieldmarkCoreTests` have changed since `7c55454`, in which case the differences are the changes
and each one has to be read and accounted for rather than waved through.

**Two comparisons were run, and the one that matters agrees.**

**Against `docs/mutation-run.json`, which holds this tree's verdicts for all 1,690 measured
mutants: `The two runs agree on every mutant.`, exit 0.** That is the requirement. Every mutant got
the verdict it gets today, judged five at a time against one shared build.

**Against the old-path reference of `7c55454`: 157 differ, and all 157 are the eight months of
changes between the two commits, not the runner.** The count closes arithmetically:

| Kind | Count | Cause |
| --- | ---: | --- |
| `survived -> killed` | 140 | Tests hardened since `7c55454` |
| `killed -> planned` | 9 | `SiteCategoryColor.swift:78` and `:80`: the lines changed, so those fingerprints no longer exist |
| `survived -> planned` | 3 | The same, at `PageReading.swift:106`, `ImportBatches.swift:60`, `ImportItems.swift:87` |
| `planned -> killed` | 5 | `SiteCategoryColor.swift:81`: mutants that did not exist at `7c55454` |

1,697 − 12 gone + 5 new = **1,690**, which is exactly this run's count. The twelve that went and the
five that arrived are all in the four source files `git diff 7c55454..HEAD -- Sources/FieldmarkCore`
shows as edited on a mutated line (`SiteCategoryColor.swift`, `PageReading.swift`,
`ImportBatches.swift`, `ImportItems.swift`); the other four edited files' changes did not move a
fingerprint.

The 140 hardenings fall in 21 source files, and **every one of them has a matching new or changed
test file** in `git diff --name-only 7c55454..HEAD -- Tests/FieldmarkCoreTests` (31 files):
`CountryLocator` 45 with `CountryLocatorInsideTests` and `CountryLocatorNearestTests`, `PageReading`
12 with `PageReadingLocationTests`, `OutingActivity` 10 with `OutingActivityBoundaryTests`,
`ShareAssetStore` 10 with `ShareAssetStoreTests`, `OKLab` 10 with `OKLabTests`, `UpdatePhase` 9 with
`UpdatePhaseTests`, `CategoryColor+Legibility` 7 with `CategoryColorLegibilityTests`, `ImportItems` 6
with `ImportItemsTests`, and so on down to one each for `UpdatePrompt`, `AppVersion`, `InviteCode`,
`ShareStore`, `ImageHunt` and `AgentBudget`. Not one difference is unaccounted for, and not one is
in the direction that would worry anybody: no mutant the reference killed is a survivor here.

- [x] **Step 3: Update `docs/mutation-testing.md`**

Above the generated block, replace the timing sentence with the measured one, and add the flag:

````markdown
A full run is about <minutes> minutes: <seconds> s per mutant, with <jobs> suites running at once
against one build. `--jobs <n>` changes how many; the default is one per core less one.

```bash
# The whole module, as many at once as the machine will take:
./Scripts/mutate.sh --json .build/mutation/full.json

# One at a time, if you want the machine back:
./Scripts/mutate.sh --jobs 1 --json .build/mutation/full.json
```
````

**Written, with three additions the plan did not ask for but the file needed.** The per-mutant figure
became about 1 second; the run history gained a fourth row (27 min 44 s, 0.98 s a mutant); the
`--jobs` paragraph carries the whole timing table and the reason the default is cores **plus** one;
and two things that were not documented anywhere now are — that the old path is the six minutes at
the end that did not get faster, and that the runner does not use `swift test` for the shared build,
with the line to look for (`Testing helper checked: 2150 tests, both ways.`) and what happens when
that check fails.

Also proved, as the extra check asked for: **`--jobs 1` on one mid-sized file gives the same verdicts
as the five-worker whole-module run.** `Annotation/SummaryText.swift`, 43 mutants, 2 min 14 s at one
job: 39 killed, 2 survived, 2 compile errors, and a fingerprint-by-fingerprint `diff` of that file's
43 records against the full run's is empty.

- [x] **Step 4: Update the triage skill**

In `.claude/skills/mutation-triage/SKILL.md`, update the sentence that says how long a full run
takes, and add one line where it describes the verify step:

```markdown
A scoped check is seconds now, not minutes, so re-running `--only <fingerprint>` after every change
to a test is the normal way to work rather than something to batch up.
```

- [x] **Step 5: Lint, rebuild, commit**

```bash
./Scripts/lint.sh
swift test --package-path Tools/CodeQuality --disable-sandbox
git add docs/mutation-testing.md .claude/skills/mutation-triage/SKILL.md
git commit
```

---

## Open risks

- **The helper's command line is not a promise.** Task 4's check is what stands between a toolchain
  update and a run that judges every mutant a survivor. If it ever fails, the run says so and falls
  back, but somebody still has to go and find the new shape.
- **Exit code 69 differs between the two paths.** Through `swift test` a filter matching nothing
  exits 0; through the helper it exits 69. `HelperCommand.result` is the only site that knows
  this, and `HelperCommandTests` is the only thing that would notice it changing.
- **Load makes flaky tests likelier.** That is what the kill confirmation is for, and Task 6 Step 7
  and Task 7 Step 3 both check for it, but a test that fails only when four suites share four cores
  will surface here first.
- **The old path does not get any faster.** Seventy mutants at about 5 s each is still seven
  minutes at the end of every full run, and they cannot overlap because they rebuild a shared
  package. Giving each of them a package of its own would fix it and costs disk; nobody has
  measured whether it is worth it.
