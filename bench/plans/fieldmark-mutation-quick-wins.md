# Faster mutation runs, part 1: four small changes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the cost of one mutant from about 8 seconds to about 3 seconds, and let a person re-run a chosen handful of mutants instead of the whole module, without changing what any verdict means.

**Architecture:** The mutation runner is a small Swift package at `Tools/CodeQuality`. It plans mutants, writes one mutated file to disk at a time, builds a slim stub package (`Tools/CoreMutation`, whose sources are symlinks to the real tree), runs the `FieldmarkCore` suite, and records what happened. Part 1 changes four things: the build drops debug info, the suite runs in parallel with a second run to confirm each kill, the runner learns to run only chosen mutants, and the four slowest test suites get faster. All new logic goes into the `MutationCore` library as pure functions with tests, because the runner's `main.swift` is top-level code with globals and cannot be unit-tested. How a test run is launched and judged stays in one site, because part 3 will replace `swift test` with a direct call to the Swift Testing helper.

**Tech Stack:** Swift 6.3.1 (Xcode 26.4.1), Swift Package Manager, Swift Testing, swift-syntax 603, bash. macOS only.

**Spec:** `docs/superpowers/specs/2026-09-17-faster-mutation-runs-design.md`

## Global Constraints

- Swift and bash only. `Tests/FieldmarkCoreTests/RepoLanguageTests.swift` scans every tracked Swift and shell file for the names of other interpreters, even inside string literals and comments. Neither code nor comments may mention them. Markdown is not scanned, which is why the planted-violation commands in Task 8 can spell one out.
- `./Scripts/lint.sh` runs swiftformat, which rewrites files in site. Its `preferKeyPath` and `hoistTry` rules can break `#expect(...)` lines. After linting, rebuild and re-run the tests before committing.
- SwiftLint warns at 400 lines per file and errors at 1000. `Sources/mutation-runner/main.swift` (310 lines) and `Sources/mutation-runner/Support.swift` (290 lines) are already close to the warning, so new code goes in new files.
- Verdict meanings do not change. Survived means the whole suite passed against the mutant. Killed means a test failed, or the suite hung or crashed. Compile error means the mutant does not compile and is left out of the score.
- Fingerprints do not change. A fingerprint hashes the file path, the rule, the token change, the normalised text of the mutated line, and an occurrence index. Any edit that changes the text of a line that holds a mutant detaches the verdict filed against it. Task 9 is written specifically to avoid that.
- The run JSON may only gain fields, never lose or repurpose them. A run file from the new runner must still merge with one from the old runner.
- The triage commands (`status`, `next`, `sample`, `record`, `render`) keep working.
- No test may get weaker. Tasks 8 to 11 each carry their own proof that the tests still catch what they caught.
- Every task ends with the package's tests passing and one commit. For the message, invoke the `house-style:how-to-commit` skill, and end the message with the line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Stage explicit paths. Never `git add -A`, never `git stash`.
- Work in the `mutation-speedups` worktree. Never build or run tests in a checkout where another mutation run is going.

---

## Facts this plan was built on

All measured on 2026-09-17 in this worktree, on a four-core machine that was also running two other mutation runs. Absolute numbers are therefore pessimistic. Ratios are the part to trust.

| Thing | Measurement |
| --- | --- |
| Incremental rebuild after one token changes, default flags | 2.45 / 1.92 / 2.08 s, median 2.08 s |
| Same, with `-debug-info-format none` | 1.21 / 1.23 / 1.18 s, median 1.21 s |
| `dsymutil` lines in `swift build -v` | 1 with default flags, 0 with `-debug-info-format none` |
| The dSYM bundle it wrote | 85 MB |
| A failing `#expect` under `-debug-info-format none` | still reports `ZZThrowawayProbeTests.swift:7:9` |
| `swift test` without the flag after a build with it | recompiled 308 files, 43.13 s |
| Whole suite, `--no-parallel` | 6.94 / 6.79 s wall, 6.016 s inside the harness, 2043 tests |
| Whole suite, `--parallel` | 4.21 / 3.67 / 3.40 s wall, 2.834 s inside the harness, 2043 tests |
| `swift test --package-path Tools/CodeQuality --disable-sandbox` | 34 s cold, 0.79 s warm, 70 tests in 5 suites |
| `mutation-runner --list` over all of `Sources/FieldmarkCore` | 1697 mutants, 2.28 s |
| The four slow suites, one at a time | RepoLanguage 2.213 s, RelaunchCommand 1.156 s, AgentRunnerDeadline 0.742 s, SeedLibraryScript 0.900 s |

One more fact, found the hard way during that run rather than by measuring. Mutant 1323 hung, the
120 second timeout fired, and the mutant was correctly recorded as killed. The test process was
not stopped: `swiftpm-testing-helper` was still alive three minutes later, spinning at 20 to 40
percent of a core with launchd holding it, and had to be killed by hand. Task 5 fixes that, and
`proc_listchildpids` was checked on this toolchain to make sure the fix can find the process it
has to kill.

Two failure-list sources exist on this toolchain. `swift test --experimental-event-stream-output <path>` is accepted and writes JSON lines. `swift test --xunit-output <path>` is a supported flag and writes a small XML file. This plan parses the XML, because it is a tenth of the size, it is not experimental, and it names the test by its Swift function name rather than by its display name. A real sample, from a probe suite with one passing test, two failing tests and one failing parameterised test:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="TestResults" errors="0" tests="4" failures="3" skipped="0" time="0.001185166">
    <testcase classname="FieldmarkCoreTests.ZZThrowawayProbeTests" name="parameterised(value:)" time="0.000200209" >
      <failure message="Expectation failed: (value &#8594; 2) != 2 (error)" />
    </testcase>
    <testcase classname="FieldmarkCoreTests.ZZThrowawayProbeTests" name="plainFailure()" time="0.000245958" >
      <failure message="Expectation failed: (a &#8594; 1) == 2 (error)" />
    </testcase>
    <testcase classname="FieldmarkCoreTests.ZZThrowawayProbeTests" name="plainPass()" time="5.7125e-05" />
    <testcase classname="FieldmarkCoreTests.ZZThrowawayProbeTests" name="displayNamed()" time="0.000140458" >
      <failure message="Expectation failed: Bool(false) (error)" />
    </testcase>
  </testsuite>
</testsuites>
```

Five things that sample proves, each of which the code below depends on:

1. A failing test is a `<testcase>` with a `<failure>` child. A passing one has no children.
2. `name` is the Swift function name. The third test was declared `@Test("a display name with spaces, / slash and (parens)")` and still appears as `displayNamed()`. A display name never reaches this file, which is why the filter can be built from it.
3. A parameterised test appears once, as `parameterised(value:)`, however many arguments failed. Re-running it re-runs every argument. That is allowed: the confirmation may run more tests than failed, never fewer.
4. `classname` + `/` + `name` is exactly the test ID `swift test --filter` matches against. `swift test list` prints `FieldmarkCoreTests.ZZThrowawayProbeTests/parameterised(value:)` for the same test.
5. With `--disable-xctest` the report is written to the exact path asked for. Without it, SwiftPM writes the Swift Testing half to `<stem>-swift-testing.xml` instead, which is why every test call in this plan passes `--disable-xctest`. The suite has no XCTest tests: `grep -rln 'XCTestCase\|import XCTest' Tests/FieldmarkCoreTests` finds nothing.

Three more behaviours, each checked by running it:

- `--filter` takes an unanchored regular expression and may be repeated. Two `--filter` flags ran exactly two tests. `NSRegularExpression.escapedPattern(for:)` turns the ID into a pattern that works as-is: `FieldmarkCoreTests\.ZZThrowawayProbeTests\/parameterised\(value:\)` matched and ran one test.
- A filter that matches nothing exits **0**, prints `warning: No matching test cases were run`, and still writes the report, with `tests="0"` and no `<testcase>` elements. So "nothing ran" has to be read as "could not confirm", never as "passed".
- A test that traps kills the whole process. `swift test` exits 1 and prints `error: Process '...' exited with unexpected signal code 5`. The report file is left truncated at `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>`, which `XMLDocument` refuses with `Line 2: Extra content at the end of the document`. So an unreadable report is the concrete shape of "cannot tell which tests failed". A hang looks different again: the runner's own 120 second timeout fires and no report is written at all.

---

## File Structure

New files:

- `Tools/CodeQuality/Sources/MutationCore/TestCommand.swift`: the `swift build` and `swift test` argument lists. Pure. One site to change in part 3.
- `Tools/CodeQuality/Sources/MutationCore/TestReport.swift`: reads a Swift Testing xunit file, builds a `--filter` pattern from a test ID.
- `Tools/CodeQuality/Sources/MutationCore/KillConfirmation.swift`: the decision table for "is this a kill", as pure functions.
- `Tools/CodeQuality/Sources/MutationCore/RunMerging.swift`: merging run files, moved out of `MutationTriage` so the runner can use it too.
- `Tools/CodeQuality/Sources/MutationCore/RunnerArguments.swift`: the runner's command line, parsed. Pure.
- `Tools/CodeQuality/Sources/MutationCore/MutantSelection.swift`: picking planned mutants by fingerprint.
- `Tools/CodeQuality/Sources/MutationCore/ProcessTree.swift`: finding and killing everything a launched command started.
- `Tools/CodeQuality/Sources/MutationTriage/Forgetting.swift`: removing a verdict whose mutant no longer exists (Task 14).
- `Tools/CodeQuality/Tests/MutationTriageTests/ForgettingTests.swift`
- `Tools/CodeQuality/Sources/mutation-runner/TestRunning.swift`: launching the suite and turning the result into a verdict. The only file that spawns a test process.
- `Tools/CodeQuality/Tests/MutationCoreTests/TestCommandTests.swift`
- `Tools/CodeQuality/Tests/MutationCoreTests/TestReportTests.swift`
- `Tools/CodeQuality/Tests/MutationCoreTests/KillConfirmationTests.swift`
- `Tools/CodeQuality/Tests/MutationCoreTests/ProcessTreeTests.swift`
- `Tools/CodeQuality/Tests/MutationCoreTests/RunMergingTests.swift`
- `Tools/CodeQuality/Tests/MutationCoreTests/RunnerArgumentsTests.swift`
- `Tools/CodeQuality/Tests/MutationCoreTests/MutantSelectionTests.swift`
- `Sources/FieldmarkCore/Agent/AgentClock.swift`: the clock seam the deadline tests need.

Modified files:

- `Tools/CodeQuality/Sources/mutation-runner/Support.swift`: the two argument lists move out; `runStubTests` and `stubBuildSucceeds` move to `TestRunning.swift`.
- `Tools/CodeQuality/Sources/mutation-runner/main.swift`: argument parsing moves out; the mutant loop calls one verdict function; mutant selection is applied.
- `Tools/CodeQuality/Sources/mutation-runner/JSONReport.swift`: the report narrows to touched files.
- `Tools/CodeQuality/Sources/MutationTriage/Triage.swift`: a `planned` record is out of scope, not stale.
- `Tools/CodeQuality/Sources/MutationTriage/RunLoading.swift`: delegates merging to `MutationCore`.
- `Sources/FieldmarkCore/Agent/AgentRunner.swift`: one stored property changes type.
- `Tests/FieldmarkCoreTests/RepoLanguageTests.swift`, `AgentRunnerDeadlineTests.swift`, `SeedLibraryScriptTests.swift`, `RelaunchCommandTests.swift`: the four slow suites.
- `docs/mutation-testing.md` and `.claude/skills/mutation-triage/SKILL.md`: how to run, how long it takes, how to verify a hardening.

---

### Task 1: Build mutants without debug info

The build is 2.08 s of every mutant and `dsymutil` is 0.87 s of that, writing an 85 MB bundle nobody opens. The build and the test call have to agree on flags, or `swift test` plans its own build and recompiles everything.

**Files:**
- Create: `Tools/CodeQuality/Sources/MutationCore/TestCommand.swift`
- Create: `Tools/CodeQuality/Tests/MutationCoreTests/TestCommandTests.swift`
- Modify: `Tools/CodeQuality/Sources/mutation-runner/Support.swift:143-197`

**Interfaces:**
- Consumes: nothing.
- Produces: `public enum TestCommand` with
  `public static func buildArguments(packagePath: String) -> [String]` and
  `public static func testArguments(packagePath: String, parallel: Bool, xunitPath: String? = nil, filters: [String] = []) -> [String]`.

- [x] **Step 1: Record the "before" number that Task 13 compares against**

Run this first, before changing anything. It is the baseline for the whole plan.

```bash
cd /home/dev/src/fieldmark/.claude/worktrees/mutation-speedups
time ./Scripts/mutate.sh --files Sources/FieldmarkCore/Discovery/ChainSites.swift \
  --json .build/mutation/chainplaces-before.json
```

Expected: a summary ending `Mutation score: …`, over 22 mutants, taking somewhere near three minutes. Write the wall-clock time and the survivor count into your notes; Task 13 needs both. Do not commit `.build`.

- [x] **Step 2: Write the failing test**

Create `Tools/CodeQuality/Tests/MutationCoreTests/TestCommandTests.swift`:

```swift
import MutationCore
import Testing

/// The runner builds and then tests. If the two calls disagree about build
/// flags, `swift test` plans a build of its own and recompiles the module: 308
/// files and 43 seconds, measured on 2026-09-17. So the flags are one value,
/// asserted rather than remembered.
@Suite(.serialized) struct TestCommandTests {
    @Test func theBuildAsksForNoDebugInfo() {
        let args = TestCommand.buildArguments(packagePath: "Tools/CoreMutation")
        #expect(args.first == "build")
        #expect(args.contains("--build-tests"))
        #expect(args.contains("-debug-info-format"))
        #expect(args.contains("none"))
    }

    /// `--skip-build` is what stops the test call from planning its own build,
    /// and `--disable-xctest` is what makes the report land at the path asked
    /// for rather than at `<stem>-swift-testing.xml`.
    @Test func theTestCallSkipsTheBuildAndTurnsXCTestOff() {
        let args = TestCommand.testArguments(packagePath: "Tools/CoreMutation", parallel: false)
        #expect(args.first == "test")
        #expect(args.contains("--skip-build"))
        #expect(args.contains("--disable-xctest"))
        #expect(args.contains("--no-parallel"))
        #expect(args.contains("--parallel") == false)
    }

    @Test func aParallelRunSaysSoAndCanAskForAReportAndFilters() {
        let args = TestCommand.testArguments(
            packagePath: "Tools/CoreMutation",
            parallel: true,
            xunitPath: "/tmp/report.xml",
            filters: ["A\\.B\\/c\\(\\)", "A\\.B\\/d\\(\\)"]
        )
        #expect(args.contains("--parallel"))
        #expect(args.contains("--no-parallel") == false)
        #expect(args.contains("--xunit-output"))
        #expect(args.contains("/tmp/report.xml"))
        #expect(args.filter { $0 == "--filter" }.count == 2)
    }
}
```

- [x] **Step 3: Run the test and watch it fail**

```bash
swift test --package-path Tools/CodeQuality --disable-sandbox --filter TestCommandTests
```

Expected: the build fails with `cannot find 'TestCommand' in scope`.

- [x] **Step 4: Write the implementation**

Create `Tools/CodeQuality/Sources/MutationCore/TestCommand.swift`:

```swift
import Foundation

/// The two command lines the mutation runner spends all its time in.
///
/// Here rather than beside the code that spawns them, so they can be asserted
/// without launching anything, and so there is one site to change when the
/// runner stops going through `swift test`.
public enum TestCommand {
    /// Build the stub package's module and tests.
    ///
    /// `-debug-info-format none` drops the `dsymutil` step. Measured on
    /// 2026-09-17: the incremental rebuild after one token changes went from a
    /// median of 2.08 s to 1.21 s, and the 85 MB dSYM bundle stopped being
    /// written. A failing `#expect` still reports its file and line, because
    /// that comes from the testing macros and not from debug info.
    public static func buildArguments(packagePath: String) -> [String] {
        [
            "build",
            "--package-path", packagePath,
            "--build-tests",
            "--disable-index-store",
            "--disable-sandbox",
            "-debug-info-format", "none",
        ]
    }

    /// Run the stub package's suite against whatever is on disk.
    ///
    /// `--skip-build` because the caller has just built. Without it `swift test`
    /// plans its own build, and a plan whose flags differ from the build's
    /// recompiles the module: 308 files and 43 seconds, measured.
    ///
    /// `--disable-xctest` for two reasons. The suite is all Swift Testing, so
    /// the XCTest pass is a process launch that runs nothing. And with XCTest
    /// enabled SwiftPM writes the Swift Testing report to
    /// `<stem>-swift-testing.xml` instead of the path asked for, which would
    /// leave the runner reading a file that is not there.
    public static func testArguments(
        packagePath: String,
        parallel: Bool,
        xunitPath: String? = nil,
        filters: [String] = []
    ) -> [String] {
        var arguments = [
            "test",
            "--package-path", packagePath,
            "--skip-build",
            "--disable-sandbox",
            "--disable-xctest",
            parallel ? "--parallel" : "--no-parallel",
        ]
        if let xunitPath {
            arguments += ["--xunit-output", xunitPath]
        }
        for filter in filters {
            arguments += ["--filter", filter]
        }
        return arguments
    }
}
```

- [x] **Step 5: Run the test and watch it pass**

```bash
swift test --package-path Tools/CodeQuality --disable-sandbox --filter TestCommandTests
```

Expected: `✔ Test run with 3 tests in 1 suite passed`.

- [x] **Step 6: Use it in the runner**

In `Tools/CodeQuality/Sources/mutation-runner/Support.swift`, replace the argument array inside `stubBuildSucceeds()`:

```swift
        let result = runSwift(
            TestCommand.buildArguments(packagePath: stubPackagePath),
            timeout: testTimeout
        )
```

and the one inside `runStubTests()`:

```swift
        let result = runSwift(
            TestCommand.testArguments(packagePath: stubPackagePath, parallel: false),
            timeout: testTimeout
        )
```

Nothing else in either function changes. Both already retry on the `was modified during the build` race, and both must keep doing so.

- [x] **Step 7: Prove the whole runner still works, and measure**

```bash
swift build --package-path Tools/CodeQuality --product mutation-runner --disable-sandbox
time ./Scripts/mutate.sh --files Sources/FieldmarkCore/Discovery/ChainSites.swift \
  --json .build/mutation/chainplaces-1b.json
```

Expected: the same mutant count and the same survivor list as Step 1, in noticeably less time. Compare the two JSON files and require them to agree:

```bash
diff <(sed 's/"generatedOn".*/-/' .build/mutation/chainplaces-before.json) \
     <(sed 's/"generatedOn".*/-/' .build/mutation/chainplaces-1b.json) && echo "same verdicts"
```

Expected: `same verdicts`.

- [x] **Step 8: Confirm the dsymutil step is gone**

Build once first, so that the build directory holds the unedited file. Otherwise the edit puts back
something already compiled, llbuild sees the object is unchanged, and the link step it would have
run is skipped along with the answer you are looking for.

```bash
swift build --package-path Tools/CoreMutation --build-tests --disable-index-store \
  --disable-sandbox -debug-info-format none
sed -i '' 's/>= repeatThreshold/> repeatThreshold/' Sources/FieldmarkCore/Discovery/ChainSites.swift
swift build --package-path Tools/CoreMutation --build-tests --disable-index-store \
  --disable-sandbox -debug-info-format none -v 2>&1 | grep -c dsymutil
sed -i '' 's/> repeatThreshold/>= repeatThreshold/' Sources/FieldmarkCore/Discovery/ChainSites.swift
git diff --stat
```

Expected: `0` from the grep (which also exits 1, because it counted nothing), and no output from
`git diff --stat`. Before this task the same commands print `1`.

- [x] **Step 9: Lint, rebuild, commit**

```bash
./Scripts/lint.sh
swift test --package-path Tools/CodeQuality --disable-sandbox
git add Tools/CodeQuality/Sources/MutationCore/TestCommand.swift \
        Tools/CodeQuality/Tests/MutationCoreTests/TestCommandTests.swift \
        Tools/CodeQuality/Sources/mutation-runner/Support.swift
git commit
```

Expected from the test run: `✔ Test run with 73 tests in 6 suites passed` (70 before this task).

---

### Task 2: Read a Swift Testing report

Everything the kill confirmation needs from a test run comes from the xunit file: which tests failed, and whether anything ran at all.

**Files:**
- Create: `Tools/CodeQuality/Sources/MutationCore/TestReport.swift`
- Create: `Tools/CodeQuality/Tests/MutationCoreTests/TestReportTests.swift`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `public struct TestReport: Equatable, Sendable` with `public let total: Int`, `public let failed: [String]`, `public init(total: Int, failed: [String])`.
  - `public enum XUnitReport` with `public static func read(xml: String) -> TestReport?`, `public static func read(contentsOfFile path: String) -> TestReport?` and `public static func filterPattern(forTestID id: String) -> String`.

- [x] **Step 1: Write the failing tests**

Create `Tools/CodeQuality/Tests/MutationCoreTests/TestReportTests.swift`:

```swift
import MutationCore
import Testing

/// What the runner learns from one suite run. A wrong answer here is a wrong
/// verdict: a mutant called killed on the strength of a failure that was not
/// its fault, or called survived because a crash was read as an empty report.
@Suite(.serialized) struct TestReportTests {
    /// The shape `swift test --xunit-output` writes for Swift Testing, copied
    /// from a real run on 2026-09-17.
    private static let sample = """
    <?xml version="1.0" encoding="UTF-8"?>
    <testsuites>
      <testsuite name="TestResults" errors="0" tests="4" failures="3" skipped="0" time="0.0011">
        <testcase classname="FieldmarkCoreTests.ProbeTests" name="parameterised(value:)" time="0.0002" >
          <failure message="Expectation failed: (value &#8594; 2) != 2 (error)" />
        </testcase>
        <testcase classname="FieldmarkCoreTests.ProbeTests" name="plainFailure()" time="0.0002" >
          <failure message="Expectation failed: (a &#8594; 1) == 2 (error)" />
        </testcase>
        <testcase classname="FieldmarkCoreTests.ProbeTests" name="plainPass()" time="0.00005" />
        <testcase classname="FieldmarkCoreTests.ProbeTests" name="displayNamed()" time="0.0001" >
          <failure message="Expectation failed: Bool(false) (error)" />
        </testcase>
      </testsuite>
    </testsuites>
    """

    @Test func aFailedTestIsTheOneWithAFailureInIt() {
        let report = XUnitReport.read(xml: Self.sample)
        #expect(report?.total == 4)
        #expect(report?.failed.contains("FieldmarkCoreTests.ProbeTests/plainFailure()") == true)
        #expect(report?.failed.contains("FieldmarkCoreTests.ProbeTests/plainPass()") == false)
        #expect(report?.failed.count == 3)
    }

    /// A display name never reaches the report: the third case was declared
    /// `@Test("a display name with spaces, / slash and (parens)")` and is
    /// written out as its function name. That is why a filter can be built from
    /// this file and could not be built from the console.
    @Test func aTestWithADisplayNameIsNamedByItsFunction() {
        let report = XUnitReport.read(xml: Self.sample)
        #expect(report?.failed.contains("FieldmarkCoreTests.ProbeTests/displayNamed()") == true)
    }

    /// A parameterised test is one entry however many arguments failed, so
    /// re-running it re-runs every argument. More than failed, never fewer.
    @Test func aParameterisedTestIsOneEntry() {
        let report = XUnitReport.read(xml: Self.sample)
        #expect(report?.failed.filter { $0.hasSuffix("/parameterised(value:)") }.count == 1)
    }

    /// A filter that matches nothing exits 0 and writes this. Read as "passed"
    /// it would turn every unconfirmable kill into a survivor.
    @Test func aRunThatMatchedNothingReportsNoTestsRatherThanPassing() {
        let empty = """
        <?xml version="1.0" encoding="UTF-8"?>
        <testsuites>
          <testsuite name="TestResults" errors="0" tests="0" failures="0" skipped="0" time="0.0002">

          </testsuite>
        </testsuites>
        """
        let report = XUnitReport.read(xml: empty)
        #expect(report?.total == 0)
        #expect(report?.failed.isEmpty == true)
    }

    /// A test that traps takes the process with it and leaves the file cut off
    /// mid-document. There is no answer to give, so there is no report.
    @Test func aTruncatedReportIsNoReportAtAll() {
        let cutOff = """
        <?xml version="1.0" encoding="UTF-8"?>
        <testsuites>
        """
        #expect(XUnitReport.read(xml: cutOff) == nil)
        #expect(XUnitReport.read(contentsOfFile: "/nowhere/at/all.xml") == nil)
    }

    /// The ID is a regular expression to `--filter`, so every bracket in it has
    /// to be escaped or it matches something else.
    @Test func aFilterPatternEscapesWhatARegularExpressionWouldReadAsSyntax() {
        let pattern = XUnitReport.filterPattern(forTestID: "FieldmarkCoreTests.ProbeTests/parameterised(value:)")
        #expect(pattern == "FieldmarkCoreTests\\.ProbeTests\\/parameterised\\(value:\\)")
    }
}
```

- [x] **Step 2: Run the tests and watch them fail**

```bash
swift test --package-path Tools/CodeQuality --disable-sandbox --filter TestReportTests
```

Expected: the build fails with `cannot find 'XUnitReport' in scope`.

- [x] **Step 3: Write the implementation**

Create `Tools/CodeQuality/Sources/MutationCore/TestReport.swift`:

```swift
import Foundation

/// What one run of the suite did, as far as the report file says.
public struct TestReport: Equatable, Sendable {
    /// How many test cases ran. Zero means the filter matched nothing, which is
    /// not the same as everything passing.
    public let total: Int
    /// The test IDs that failed, as `<Module>.<Suite>/<function>()`.
    public let failed: [String]

    public init(total: Int, failed: [String]) {
        self.total = total
        self.failed = failed
    }

    /// True when the run measured nothing, so it settles nothing.
    public var ranNothing: Bool { total == 0 }
}

/// Reads the file `swift test --xunit-output` writes.
///
/// The console is not an option: a test declared with a display name prints
/// that name and nothing else, and no filter can match on it. The report names
/// every test by its Swift function, which is what a filter matches.
public enum XUnitReport {
    /// The report at `path`, or `nil` if it is missing or unreadable.
    public static func read(contentsOfFile path: String) -> TestReport? {
        guard let xml = try? String(contentsOf: URL(filePath: path), encoding: .utf8) else { return nil }
        return read(xml: xml)
    }

    /// The report in `xml`, or `nil` if it cannot be parsed.
    ///
    /// `nil` is a real answer and the caller has to handle it. A test that traps
    /// takes the whole process down and leaves the file cut off after
    /// `<testsuites>`, so "the report will not parse" is exactly the case where
    /// the runner cannot tell which tests failed.
    public static func read(xml: String) -> TestReport? {
        guard let document = try? XMLDocument(xmlString: xml, options: []) else { return nil }
        guard let cases = try? document.nodes(forXPath: "//testcase") else { return nil }

        var failed: [String] = []
        for node in cases {
            guard let element = node as? XMLElement else { continue }
            let suite = element.attribute(forName: "classname")?.stringValue ?? ""
            let name = element.attribute(forName: "name")?.stringValue ?? ""
            guard !suite.isEmpty, !name.isEmpty else { continue }
            let failures = (try? element.nodes(forXPath: "failure")) ?? []
            if !failures.isEmpty { failed.append(suite + "/" + name) }
        }
        return TestReport(total: cases.count, failed: failed)
    }

    /// A `--filter` pattern that re-runs one test.
    ///
    /// `--filter` takes an unanchored regular expression over the test ID, and
    /// an ID is full of characters a regular expression reads as syntax: the
    /// dot between module and suite, and the brackets around the arguments.
    /// Escaping all of them is what makes the pattern mean the one test.
    public static func filterPattern(forTestID id: String) -> String {
        NSRegularExpression.escapedPattern(for: id)
    }
}
```

- [x] **Step 4: Run the tests and watch them pass**

```bash
swift test --package-path Tools/CodeQuality --disable-sandbox --filter TestReportTests
```

Expected: `✔ Test run with 6 tests in 1 suite passed`.

- [x] **Step 5: Lint, rebuild, commit**

```bash
./Scripts/lint.sh
swift test --package-path Tools/CodeQuality --disable-sandbox
git add Tools/CodeQuality/Sources/MutationCore/TestReport.swift \
        Tools/CodeQuality/Tests/MutationCoreTests/TestReportTests.swift
git commit
```

Expected from the test run: `✔ Test run with 79 tests in 7 suites passed`.

---

### Task 3: Decide a kill from one or two runs

The rule from the spec: a failing parallel run is not yet a kill. Re-run only the tests that failed, one at a time. If one fails again it is a kill. If they all pass, or the runner cannot tell which tests failed, the whole suite run one test at a time decides. This task is the decision table, with no processes in it.

**Files:**
- Create: `Tools/CodeQuality/Sources/MutationCore/KillConfirmation.swift`
- Create: `Tools/CodeQuality/Tests/MutationCoreTests/KillConfirmationTests.swift`

**Interfaces:**
- Consumes: `TestReport` from Task 2.
- Produces:
  - `public struct SuiteRun: Equatable, Sendable` with `public enum Result: String, Sendable { case passed, failed, timedOut }`, `public let result: Result`, `public let report: TestReport?`, `public init(result: Result, report: TestReport?)`.
  - `public enum KillConfirmation` with `public enum Step: Equatable, Sendable { case verdict(MutantOutcome), confirm(filters: [String]), wholeSuiteOneAtATime }`, and
    `public static func afterFirstRun(_ run: SuiteRun) -> Step`,
    `public static func afterConfirmation(_ run: SuiteRun) -> Step`,
    `public static func afterWholeSuite(_ run: SuiteRun) -> MutantOutcome`.

- [x] **Step 1: Write the failing tests**

Create `Tools/CodeQuality/Tests/MutationCoreTests/KillConfirmationTests.swift`:

```swift
import MutationCore
import Testing

/// Running the suite in parallel is what makes a mutant cheap, and it is also
/// what makes a single red run untrustworthy: tests that pass alone can fail
/// beside each other. So a kill is a failure seen twice, and anything the
/// runner cannot read falls back to the slow, serial run that has always
/// decided. Nothing here may turn an unreadable run into a verdict.
@Suite(.serialized) struct KillConfirmationTests {
    private func report(total: Int, failed: [String] = []) -> TestReport {
        TestReport(total: total, failed: failed)
    }

    @Test func aGreenParallelRunIsASurvivor() {
        let run = SuiteRun(result: .passed, report: report(total: 2043))
        #expect(KillConfirmation.afterFirstRun(run) == .verdict(.survived))
    }

    /// A hang is a kill, as it has always been: a suite that never finishes is
    /// not a suite that passed.
    @Test func aHangIsAKillWithoutConfirmation() {
        let run = SuiteRun(result: .timedOut, report: nil)
        #expect(KillConfirmation.afterFirstRun(run) == .verdict(.killed))
    }

    @Test func aRedRunAsksForTheTestsThatFailedToBeRunAgain() {
        let run = SuiteRun(
            result: .failed,
            report: report(total: 2043, failed: ["FieldmarkCoreTests.A/one()", "FieldmarkCoreTests.B/two()"])
        )
        #expect(KillConfirmation.afterFirstRun(run) == .confirm(filters: [
            "FieldmarkCoreTests\\.A\\/one\\(\\)",
            "FieldmarkCoreTests\\.B\\/two\\(\\)",
        ]))
    }

    /// A crash leaves the report cut off. There is no list of failed tests to
    /// re-run, so the whole suite decides.
    @Test func aRedRunWithNoReadableReportFallsBackToTheWholeSuite() {
        let run = SuiteRun(result: .failed, report: nil)
        #expect(KillConfirmation.afterFirstRun(run) == .wholeSuiteOneAtATime)
    }

    /// Red with a readable report naming nobody is the same situation.
    @Test func aRedRunNamingNoTestsFallsBackToTheWholeSuite() {
        let run = SuiteRun(result: .failed, report: report(total: 2043))
        #expect(KillConfirmation.afterFirstRun(run) == .wholeSuiteOneAtATime)
    }

    @Test func aFailureSeenTwiceIsAKill() {
        let run = SuiteRun(result: .failed, report: report(total: 1, failed: ["FieldmarkCoreTests.A/one()"]))
        #expect(KillConfirmation.afterConfirmation(run) == .verdict(.killed))
    }

    /// The tests that failed under load pass on their own. That says nothing
    /// about the mutant either way, so the whole suite settles it.
    @Test func aFailureThatDoesNotRepeatIsNotYetAnything() {
        let run = SuiteRun(result: .passed, report: report(total: 2))
        #expect(KillConfirmation.afterConfirmation(run) == .wholeSuiteOneAtATime)
    }

    /// `--filter` matching nothing exits 0 with an empty report. Read as
    /// "passed" it would quietly turn a killed mutant into a survivor, so it
    /// has to mean "could not confirm".
    @Test func aConfirmationThatRanNothingConfirmsNothing() {
        let run = SuiteRun(result: .passed, report: report(total: 0))
        #expect(KillConfirmation.afterConfirmation(run) == .wholeSuiteOneAtATime)
    }

    @Test func theWholeSuiteHasTheLastWord() {
        #expect(KillConfirmation.afterWholeSuite(SuiteRun(result: .passed, report: nil)) == .survived)
        #expect(KillConfirmation.afterWholeSuite(SuiteRun(result: .failed, report: nil)) == .killed)
        #expect(KillConfirmation.afterWholeSuite(SuiteRun(result: .timedOut, report: nil)) == .killed)
    }
}
```

- [x] **Step 2: Run the tests and watch them fail**

```bash
swift test --package-path Tools/CodeQuality --disable-sandbox --filter KillConfirmationTests
```

Expected: the build fails with `cannot find 'SuiteRun' in scope`.

- [x] **Step 3: Write the implementation**

Create `Tools/CodeQuality/Sources/MutationCore/KillConfirmation.swift`:

```swift
import Foundation

/// One run of the suite: what the process did, and what its report said.
public struct SuiteRun: Equatable, Sendable {
    public enum Result: String, Sendable {
        case passed
        case failed
        case timedOut
    }

    public let result: Result
    /// `nil` when no report was written, or the one written will not parse.
    public let report: TestReport?

    public init(result: Result, report: TestReport?) {
        self.result = result
        self.report = report
    }
}

/// Whether a red run is a kill, and what to do when it is not yet clear.
///
/// The suite runs in parallel, which is what makes a mutant cheap and also what
/// makes one red run untrustworthy: a test that passes alone can fail beside
/// another. So a kill is a failure seen twice. Everything the runner cannot
/// read falls back to the whole suite, one test at a time, which is how every
/// verdict was reached before this existed. That fallback is what keeps the
/// meaning of KILLED and SURVIVED exactly what it was.
public enum KillConfirmation {
    /// What to do next.
    public enum Step: Equatable, Sendable {
        /// Settled. Record this.
        case verdict(MutantOutcome)
        /// Run these `--filter` patterns again, one test at a time.
        case confirm(filters: [String])
        /// Run everything, one test at a time, and let that decide.
        case wholeSuiteOneAtATime
    }

    /// After the parallel run.
    public static func afterFirstRun(_ run: SuiteRun) -> Step {
        switch run.result {
        case .passed:
            return .verdict(.survived)
        case .timedOut:
            // A hang is a kill, as it always has been.
            return .verdict(.killed)
        case .failed:
            guard let report = run.report, !report.failed.isEmpty else {
                // A crash, or a report that will not parse: nothing to re-run.
                return .wholeSuiteOneAtATime
            }
            return .confirm(filters: report.failed.map(XUnitReport.filterPattern(forTestID:)))
        }
    }

    /// After the re-run of the tests that failed.
    public static func afterConfirmation(_ run: SuiteRun) -> Step {
        switch run.result {
        case .failed, .timedOut:
            return .verdict(.killed)
        case .passed:
            // Including the case where the filter matched nothing and the run
            // exited 0 having measured nothing at all.
            return .wholeSuiteOneAtATime
        }
    }

    /// After the whole suite, one test at a time. This one is final.
    public static func afterWholeSuite(_ run: SuiteRun) -> MutantOutcome {
        run.result == .passed ? .survived : .killed
    }
}
```

- [x] **Step 4: Run the tests and watch them pass**

```bash
swift test --package-path Tools/CodeQuality --disable-sandbox --filter KillConfirmationTests
```

Expected: `✔ Test run with 9 tests in 1 suite passed`.

- [x] **Step 5: Lint, rebuild, commit**

```bash
./Scripts/lint.sh
swift test --package-path Tools/CodeQuality --disable-sandbox
git add Tools/CodeQuality/Sources/MutationCore/KillConfirmation.swift \
        Tools/CodeQuality/Tests/MutationCoreTests/KillConfirmationTests.swift
git commit
```

Expected from the test run: `✔ Test run with 88 tests in 8 suites passed`.

---

### Task 4: Run the tests in parallel and confirm every kill

Now wire Tasks 2 and 3 into the runner. Everything that launches a test process ends up in one new file, because part 3 replaces `swift test` here and nowhere else.

**Files:**
- Create: `Tools/CodeQuality/Sources/mutation-runner/TestRunning.swift`
- Modify: `Tools/CodeQuality/Sources/mutation-runner/Support.swift` (remove `TestOutcome`, `stubBuildSucceeds`, `runStubTests`, `modifiedDuringBuildMarker`)
- Modify: `Tools/CodeQuality/Sources/mutation-runner/main.swift:189-249`

**Interfaces:**
- Consumes: `TestCommand` (Task 1), `SuiteRun`, `KillConfirmation` (Task 3), `XUnitReport` (Task 2).
- Produces: in the `mutation-runner` target, `func stubBuildSucceeds() -> Bool`, `func runSuite(parallel: Bool, filters: [String]) -> SuiteRun`, `func baselinePasses() -> Bool`, `func verdictForMutantOnDisk() -> MutantOutcome`.

- [x] **Step 1: Move the process-launching code into its own file**

Create `Tools/CodeQuality/Sources/mutation-runner/TestRunning.swift` with this content, and delete the same four things from `Support.swift`: `modifiedDuringBuildMarker`, `stubBuildSucceeds()`, `enum TestOutcome` and `runStubTests()`.

```swift
import Foundation
import MutationCore

// Everything that launches a build or a test process, and the rule that turns
// what came back into a verdict. One file, because part 3 replaces `swift test`
// with a direct call to the Swift Testing helper and this is the only site
// that has to know.

/// llbuild emits this when a source file's mtime changes while a build is in
/// flight. Under the runner's rapid write, build, restore, write cycle it fires
/// intermittently; it is a TRANSIENT race, NOT a compile error, so we retry. A
/// genuine compile error never contains this marker.
private let modifiedDuringBuildMarker = "was modified during the build"

/// Where the suite writes its report. One path per process, emptied before
/// every run, so a stale file can never be read as this run's answer.
private let reportPath = FileManager.default.temporaryDirectory
    .appending(path: "mutation-runner-\(ProcessInfo.processInfo.processIdentifier).xml").path

/// Builds FieldmarkCore and its tests in the stub package. Returns true on success.
/// This is the per-mutant compile gate, so it MUST NOT report a transient build
/// race as a failure (that would mislabel a valid mutant as COMPILE_ERROR and
/// corrupt the score).
func stubBuildSucceeds() -> Bool {
    let maxAttempts = 5
    for attempt in 1 ... maxAttempts {
        let result = runSwift(TestCommand.buildArguments(packagePath: stubPackagePath), timeout: testTimeout)
        if result.timedOut { return false }
        if result.exitCode == 0 { return true }
        if result.output.contains(modifiedDuringBuildMarker), attempt < maxAttempts {
            // Let the filesystem settle so llbuild sees a stable mtime.
            Thread.sleep(forTimeInterval: 0.3)
            continue
        }
        return false
    }
    return false
}

/// Runs the suite against whatever is on disk and reads its report.
///
/// Assumes the stub has already built, so a non-zero exit is a test failure and
/// not a compile error. Retries the transient build race for the same reason
/// the build does: mistaking it for a failure would call a surviving mutant
/// killed.
func runSuite(parallel: Bool, filters: [String] = []) -> SuiteRun {
    let maxAttempts = 5
    for attempt in 1 ... maxAttempts {
        try? FileManager.default.removeItem(atPath: reportPath)
        let result = runSwift(
            TestCommand.testArguments(
                packagePath: stubPackagePath,
                parallel: parallel,
                xunitPath: reportPath,
                filters: filters
            ),
            timeout: testTimeout
        )
        if result.timedOut { return SuiteRun(result: .timedOut, report: nil) }
        let report = XUnitReport.read(contentsOfFile: reportPath)
        if result.exitCode == 0 { return SuiteRun(result: .passed, report: report) }
        if result.output.contains(modifiedDuringBuildMarker), attempt < maxAttempts {
            Thread.sleep(forTimeInterval: 0.3)
            continue
        }
        return SuiteRun(result: .failed, report: report)
    }
    return SuiteRun(result: .failed, report: nil)
}

/// The baseline runs exactly the way the mutants do, so that a mutant is the
/// only difference between a green run and a red one.
func baselinePasses() -> Bool {
    runSuite(parallel: true).result == .passed
}

/// Killed or survived, for the mutant currently on disk.
///
/// The parallel run is the cheap one and the serial run is the trustworthy one.
/// A kill has to be seen twice, and anything unreadable falls back to the whole
/// suite run one test at a time, which is how every verdict was reached before
/// this existed.
func verdictForMutantOnDisk() -> MutantOutcome {
    var step = KillConfirmation.afterFirstRun(runSuite(parallel: true))
    if case let .confirm(filters) = step {
        step = KillConfirmation.afterConfirmation(runSuite(parallel: false, filters: filters))
    }
    if case let .verdict(outcome) = step {
        return outcome
    }
    return KillConfirmation.afterWholeSuite(runSuite(parallel: false))
}
```

- [x] **Step 2: Use it from `main.swift`**

Replace the baseline block (`main.swift:194-199`):

```swift
guard baselinePasses() else {
    logErr("Baseline tests failed or timed out. Fix the suite before mutation testing.")
    exit(2)
}
```

and the category block inside the mutant loop (`main.swift:241-249`):

```swift
    let category: Category = if !stubBuildSucceeds() {
        // The mutant does not compile, so it proves nothing; do NOT count as killed.
        .compileError
    } else {
        switch verdictForMutantOnDisk() {
        case .killed: .killed
        default: .survived
        }
    }
```

`Category` and its `outcome` property in `Support.swift` stay as they are: the JSON format does not change.

- [x] **Step 3: Build the runner**

```bash
swift build --package-path Tools/CodeQuality --product mutation-runner --disable-sandbox
```

Expected: `Build of product 'mutation-runner' complete!`.

- [x] **Step 4: Prove a kill is still a kill and a survivor still a survivor**

`ChainSites.swift` has 22 mutants and a known mix of both.

```bash
time ./Scripts/mutate.sh --files Sources/FieldmarkCore/Discovery/ChainSites.swift \
  --json .build/mutation/chainplaces-1a.json
diff <(sed 's/"generatedOn".*/-/' .build/mutation/chainplaces-before.json) \
     <(sed 's/"generatedOn".*/-/' .build/mutation/chainplaces-1a.json) && echo "same verdicts"
```

Expected: `same verdicts`, and a wall-clock time well under the Task 1 Step 7 number.

- [x] **Step 5: Prove a crashing suite is never read as a pass**

The decision table itself is covered by Task 3's tests. What this checks is the thing those tests cannot: that a truncated report really does come back as `nil` from a real run, so the runner refuses rather than calling everything a survivor.

```bash
cat > Tests/FieldmarkCoreTests/ZZCrashProbeTests.swift <<'SWIFT'
import Testing

/// Throwaway probe: a trap takes the process down and truncates the report.
@Suite(.serialized) struct ZZCrashProbeTests {
    @Test func traps() {
        let empty: [Int] = []
        _ = empty[3]
    }
}
SWIFT
./Scripts/mutate.sh --files Sources/FieldmarkCore/Update/RelaunchCommand.swift
rm -f Tests/FieldmarkCoreTests/ZZCrashProbeTests.swift
git status --short
```

Expected: the run prints `Baseline tests failed or timed out. Fix the suite before mutation testing.` and exits 2. It must not print a single mutant line. A crash is a red run with an unreadable report, and the runner has to treat that as "no answer", not as "the suite was green". `git status --short` must show nothing afterwards; if the probe file is still there, delete it.

- [x] **Step 6: Lint, rebuild, commit**

```bash
./Scripts/lint.sh
swift test --package-path Tools/CodeQuality --disable-sandbox
swift build --package-path Tools/CodeQuality --product mutation-runner --disable-sandbox
git add Tools/CodeQuality/Sources/mutation-runner/TestRunning.swift \
        Tools/CodeQuality/Sources/mutation-runner/Support.swift \
        Tools/CodeQuality/Sources/mutation-runner/main.swift
git commit
```

Expected from the test run: `✔ Test run with 88 tests in 8 suites passed`.

---

### Task 5: Kill the whole process tree when a run times out

This one is not theoretical. On 2026-09-17, during the full run, mutant 1323 (`!` removed at
`Persistence/SiteStore+Images.swift:96`, inside a `while true` loop) hung. The 120 second timeout
fired and the mutant was recorded as killed, which is right. The test process was not stopped.
Three minutes later `swiftpm-testing-helper` was still alive, spinning at 20 to 40 percent of a
core, with its parent gone and launchd holding it. It had to be killed by hand.

The cause is in `runSwift`. On timeout it calls `kill(-pid, SIGKILL)` and `process.terminate()`.
`Process` does give its own child a process group of its own, so the group kill reaches what that
child starts directly. SwiftPM starts `swiftpm-testing-helper` in a group of its own, so the group
kill goes nowhere near it, and `terminate()` stops only `swift-test`. Every hung mutant leaves one
behind, for the rest of the run and after it.

**Files:**
- Create: `Tools/CodeQuality/Sources/MutationCore/ProcessTree.swift`
- Create: `Tools/CodeQuality/Tests/MutationCoreTests/ProcessTreeTests.swift`
- Modify: `Tools/CodeQuality/Sources/mutation-runner/Support.swift` (the `InFlight` section and `runSwift`'s timeout handler)
- Modify: `Tools/CodeQuality/Sources/mutation-runner/main.swift` (the signal handler)

**Interfaces:**
- Consumes: nothing.
- Produces: `public enum ProcessTree` with
  `public static func children(of pid: pid_t) -> [pid_t]`,
  `public static func descendants(of pid: pid_t) -> [pid_t]` and
  `public static func killTree(_ pid: pid_t)`;
  and, in the `mutation-runner` target, `final class RunningChild` with `begin(_:)`, `clear()` and
  `killTree()`, plus the global `let runningChild = RunningChild()`.

- [x] **Step 1: Write the failing tests**

Create `Tools/CodeQuality/Tests/MutationCoreTests/ProcessTreeTests.swift`:

```swift
import Darwin
import Foundation
import MutationCore
import Testing

/// A mutant that hangs has to leave nothing running. The runner starts
/// `swift test`, which starts `swiftpm-testing-helper` in a process group of
/// its own, which starts whatever the tests ask for. Killing the one process
/// the runner launched leaves the rest of that behind: on 2026-09-17 a helper
/// was still spinning three minutes after the mutant it belonged to had been
/// judged.
@Suite(.serialized) struct ProcessTreeTests {
    /// A shell that stays alive holding a background child, with job control
    /// on so that child gets a process group of its own. That is the shape
    /// SwiftPM makes, reproduced in two processes instead of four.
    private func startTree() throws -> Process {
        let process = Process()
        process.executableURL = URL(filePath: "/bin/sh")
        process.arguments = ["-c", "set -m; /bin/sleep 45 & wait"]
        process.standardOutput = Pipe()
        process.standardError = Pipe()
        try process.run()
        return process
    }

    /// The child takes a moment to appear, and the machine is often busy.
    private func waitForDescendants(of pid: pid_t) -> [pid_t] {
        for _ in 0 ..< 100 {
            let found = ProcessTree.descendants(of: pid)
            if !found.isEmpty { return found }
            Thread.sleep(forTimeInterval: 0.05)
        }
        return []
    }

    /// The walk finds a grandchild that a group kill would miss. If this ever
    /// starts reporting the same group for both, the test below is passing for
    /// the wrong reason and the bug it guards is no longer covered.
    @Test func aChildInItsOwnGroupIsFoundAnyway() throws {
        let process = try startTree()
        defer { ProcessTree.killTree(process.processIdentifier) }

        let tree = waitForDescendants(of: process.processIdentifier)
        #expect(tree.count == 1, "expected one descendant, got \(tree)")
        let child = try #require(tree.first)
        #expect(
            getpgid(child) != getpgid(process.processIdentifier),
            "the fixture no longer makes a separate process group"
        )
    }

    @Test func killingTheTreeLeavesNothingRunning() throws {
        let process = try startTree()
        let tree = waitForDescendants(of: process.processIdentifier)
        #expect(!tree.isEmpty)

        ProcessTree.killTree(process.processIdentifier)
        process.waitUntilExit()

        var alive: [pid_t] = []
        for _ in 0 ..< 60 {
            alive = tree.filter { kill($0, 0) == 0 }
            if alive.isEmpty { break }
            Thread.sleep(forTimeInterval: 0.05)
        }
        #expect(alive.isEmpty, "still running: \(alive)")
    }

    /// A pid nothing owns answers with nothing rather than with whatever
    /// happens to be in the buffer.
    @Test func aPidThatIsNotThereHasNoChildren() {
        #expect(ProcessTree.children(of: 999_999).isEmpty)
        #expect(ProcessTree.descendants(of: 999_999).isEmpty)
    }
}
```

- [x] **Step 2: Run the tests and watch them fail**

```bash
swift test --package-path Tools/CodeQuality --disable-sandbox --filter ProcessTreeTests
```

Expected: the build fails with `cannot find 'ProcessTree' in scope`.

- [x] **Step 3: Write the implementation**

Create `Tools/CodeQuality/Sources/MutationCore/ProcessTree.swift`:

```swift
import Darwin
import Foundation

/// Killing a process and everything it started.
///
/// `Process` puts its own child in a new process group, so `kill(-pid, …)`
/// reaches what that child starts directly. It does not reach a grandchild that
/// moved itself into a group of its own, and SwiftPM does exactly that with
/// `swiftpm-testing-helper`. On 2026-09-17 a hung mutant left one spinning for
/// the rest of the run, so the timeout now takes the tree rather than the
/// process.
public enum ProcessTree {
    /// The direct children of `pid`, as the kernel sees them now.
    ///
    /// `proc_listchildpids` returns the number of pids on this toolchain, not a
    /// number of bytes. Checked on Swift 6.3.1: three children came back as 3.
    /// Reading it as bytes would divide by four and find nothing.
    public static func children(of pid: pid_t) -> [pid_t] {
        var buffer = [pid_t](repeating: 0, count: 512)
        let count = proc_listchildpids(pid, &buffer, Int32(buffer.count * MemoryLayout<pid_t>.size))
        guard count > 0 else { return [] }
        return Array(buffer.prefix(min(Int(count), buffer.count))).filter { $0 > 1 }
    }

    /// Everything under `pid`, each parent before its own children.
    ///
    /// Collect this before killing anything. A process whose parent dies is
    /// handed to launchd, and from that moment nothing connects it to the tree
    /// it came out of.
    public static func descendants(of pid: pid_t) -> [pid_t] {
        var found: [pid_t] = []
        var seen: Set<pid_t> = []
        var queue = children(of: pid)
        while !queue.isEmpty {
            let next = queue.removeFirst()
            guard next > 1, seen.insert(next).inserted else { continue }
            found.append(next)
            queue += children(of: next)
        }
        return found
    }

    /// SIGKILL `pid` and everything under it.
    ///
    /// Deepest first, so a parent cannot start something new while its children
    /// are going; then the root; then one more pass over the descendants, for
    /// anything that was half-started the first time round.
    public static func killTree(_ pid: pid_t) {
        let tree = descendants(of: pid)
        for victim in tree.reversed() { kill(victim, SIGKILL) }
        kill(pid, SIGKILL)
        for victim in tree { kill(victim, SIGKILL) }
    }
}
```

- [x] **Step 4: Run the tests and watch them pass**

```bash
swift test --package-path Tools/CodeQuality --disable-sandbox --filter ProcessTreeTests
```

Expected: `✔ Test run with 3 tests in 1 suite passed`.

- [x] **Step 5: Use it on the timeout**

In `Tools/CodeQuality/Sources/mutation-runner/Support.swift`, replace the timer's event handler
inside `runSwift`:

```swift
    timer.setEventHandler {
        timedOut.lock()
        didTimeOut = true
        timedOut.unlock()
        // The whole tree, not the process. `swift test` starts the testing
        // helper in a process group of its own, so a group kill misses it and
        // `terminate()` never reaches it either.
        ProcessTree.killTree(pid)
        waiter.signal()
    }
```

and record the child while it runs, so a signal can reach it too. Straight after `let pid =
process.processIdentifier` add:

```swift
    runningChild.begin(pid)
    defer { runningChild.clear() }
```

- [x] **Step 6: Let the signal handler reach it too**

Add to `Tools/CodeQuality/Sources/mutation-runner/Support.swift`, under the `InFlight` section:

```swift
/// The child `runSwift` is waiting on, so an interrupt can take its whole tree
/// down instead of leaving a build or a test process running after the runner
/// has gone.
final class RunningChild: @unchecked Sendable {
    private let lock = NSLock()
    private var pid: pid_t?

    func begin(_ pid: pid_t) {
        lock.lock(); defer { lock.unlock() }
        self.pid = pid
    }

    func clear() {
        lock.lock(); defer { lock.unlock() }
        pid = nil
    }

    /// Safe to call repeatedly and from a signal handler's queue.
    func killTree() {
        lock.lock()
        let current = pid
        lock.unlock()
        if let current { ProcessTree.killTree(current) }
    }
}
```

In `Tools/CodeQuality/Sources/mutation-runner/main.swift`, declare it beside `inFlight`:

```swift
/// The build or test process running right now, if any.
let runningChild = RunningChild()
```

and add one line to the signal handler, before the restore:

```swift
    source.setEventHandler {
        logErr("\nInterrupted. Restoring the mutated file and exiting.")
        runningChild.killTree()
        inFlight.restore()
        exit(130)
    }
```

- [x] **Step 7: Prove it on the real thing**

Start a scoped run, interrupt it part way, and check that nothing is left.

```bash
swift build --package-path Tools/CodeQuality --product mutation-runner --disable-sandbox
./Scripts/mutate.sh --files Sources/FieldmarkCore/Discovery/ChainSites.swift &
sleep 25
kill -INT %1
sleep 3
pgrep -fl 'swiftpm-testing-helper|swift-test|swift-frontend' | wc -l
git status --short
```

Expected: `0` from `pgrep`, and nothing from `git status --short`. Before this task the same
sequence leaves the helper running.

- [x] **Step 8: Lint, rebuild, commit**

```bash
./Scripts/lint.sh
swift test --package-path Tools/CodeQuality --disable-sandbox
swift build --package-path Tools/CodeQuality --product mutation-runner --disable-sandbox
git add Tools/CodeQuality/Sources/MutationCore/ProcessTree.swift \
        Tools/CodeQuality/Tests/MutationCoreTests/ProcessTreeTests.swift \
        Tools/CodeQuality/Sources/mutation-runner/Support.swift \
        Tools/CodeQuality/Sources/mutation-runner/main.swift
git commit
```

Expected from the test run: `✔ Test run with 91 tests in 9 suites passed`.

---

### Task 6: A listed mutant is out of scope, not stale

`Triage.standings()` reads a verdict whose mutant is recorded as `planned` through its `default:` branch, and `scannedFiles` counts every file in the run including the ones only listed. So a verdict lands on `.stale`, which means "the line moved, go and look again". Nobody measured it. Task 7 makes `planned` records common, so this has to be right first.

**Files:**
- Modify: `Tools/CodeQuality/Sources/MutationTriage/Triage.swift:111-131`
- Test: `Tools/CodeQuality/Tests/MutationTriageTests/TriageTests.swift`

**Interfaces:**
- Consumes: nothing new.
- Produces: no signature changes. `Triage.standings()` keeps returning `[(record: LedgerRecord, standing: LedgerStanding)]`.

- [x] **Step 1: Write the failing tests**

Add these two to `TriageTests` in `Tools/CodeQuality/Tests/MutationTriageTests/TriageTests.swift`, after `aVerdictOnAScannedFileWithNoMatchIsStale`:

```swift
    /// A `planned` record is the runner saying "this mutant exists and I did
    /// not run it". `--only` writes one for every mutant it did not choose, and
    /// `--list --json` writes nothing else. Read as stale it would send a
    /// perfectly good verdict back to the queue every time somebody re-ran one
    /// fingerprint.
    @Test func aVerdictWhoseMutantWasOnlyListedIsOutOfScope() {
        let triage = Triage(
            run: [mutant("aaa", outcome: .planned)],
            ledger: Ledger(records: [verdict("aaa")])
        )
        #expect(triage.standings().map(\.standing) == [.outOfScope])
        #expect(triage.work().isEmpty)
    }

    /// And a file the run only listed does not make the other verdicts filed
    /// against it stale either: the run measured nothing there.
    @Test func aFileTheRunOnlyListedLeavesItsOtherVerdictsAlone() {
        let file = "Sources/FieldmarkCore/Discovery/A.swift"
        let triage = Triage(
            run: [mutant("other", file: file, outcome: .planned)],
            ledger: Ledger(records: [verdict("aaa", file: file)])
        )
        #expect(triage.standings().map(\.standing) == [.outOfScope])
    }
```

- [x] **Step 2: Run the tests and watch them fail**

```bash
swift test --package-path Tools/CodeQuality --disable-sandbox --filter TriageTests
```

Expected: both new tests fail, each reporting `[MutationTriage.LedgerStanding.stale]` where `[.outOfScope]` was expected.

- [x] **Step 3: Write the implementation**

In `Tools/CodeQuality/Sources/MutationTriage/Triage.swift`, change `scannedFiles` to count only measured records:

```swift
    /// Files the run actually measured. A file whose mutants were all merely
    /// listed was enumerated, not run, so the run has nothing to say about the
    /// verdicts filed against it.
    private var scannedFiles: Set<String> {
        Set(scored.map(\.file))
    }
```

and add a case to the switch in `standings()`, above the `default:`:

```swift
            // The runner listed this mutant and did not run it, which is what
            // `--only` writes for everything it did not choose. Nobody measured
            // it, so nobody may conclude anything from it.
            case .planned: (record, .outOfScope)
```

- [x] **Step 4: Run the tests and watch them pass**

```bash
swift test --package-path Tools/CodeQuality --disable-sandbox --filter TriageTests
```

Expected: `✔ Test run with 14 tests in 1 suite passed`. The other twelve, in particular `aVerdictOnAScannedFileWithNoMatchIsStale`, must still pass: a file with a real result in it still makes a missing fingerprint stale.

- [x] **Step 5: Check the triage tool against the committed run**

```bash
./Scripts/mutate-triage.sh status
```

Expected: the same totals as before this change, because `docs/mutation-run.json` is a full run with no `planned` records in it.

- [x] **Step 6: Lint, rebuild, commit**

```bash
./Scripts/lint.sh
swift test --package-path Tools/CodeQuality --disable-sandbox
git add Tools/CodeQuality/Sources/MutationTriage/Triage.swift \
        Tools/CodeQuality/Tests/MutationTriageTests/TriageTests.swift
git commit
```

Expected from the test run: `✔ Test run with 93 tests in 9 suites passed`.

---

### Task 7: Move run merging into MutationCore

`--survivors-of` needs to read a run file or a directory of them exactly the way the triage tool does. One implementation, in the library both tools already depend on.

**Files:**
- Create: `Tools/CodeQuality/Sources/MutationCore/RunMerging.swift`
- Create: `Tools/CodeQuality/Tests/MutationCoreTests/RunMergingTests.swift`
- Modify: `Tools/CodeQuality/Sources/MutationTriage/RunLoading.swift:42-86`

**Interfaces:**
- Consumes: `MutantRecord`, `MutationRunFile` (both already in `MutationCore`).
- Produces: `public enum RunMerging` with
  `public static func runFiles(at path: String) throws -> [String]`,
  `public static func merge(paths: [String]) throws -> [MutantRecord]`,
  `public static func survivingFingerprints(in records: [MutantRecord]) -> [String]`;
  and `public enum RunMergingError: Error` with `case noRunFile(String)` and `case unreadable(String, any Error)`.
  `MutationTriage.RunLoading.load(paths:)` keeps its signature and keeps throwing `TriageError`.

- [x] **Step 1: Write the failing tests**

Create `Tools/CodeQuality/Tests/MutationCoreTests/RunMergingTests.swift`:

```swift
import Foundation
import MutationCore
import Testing

/// Investigators work one area at a time, so the honest input is usually a
/// handful of scoped runs rather than one big one. Merging them is how "re-run
/// this file and lay it over yesterday's full run" works, and it is now the
/// runner's way of finding out what survived as well.
@Suite(.serialized) struct RunMergingTests {
    private func record(
        _ fingerprint: String,
        file: String = "Sources/FieldmarkCore/Discovery/A.swift",
        outcome: MutantOutcome
    ) -> MutantRecord {
        MutantRecord(
            fingerprint: fingerprint,
            file: file,
            line: 10,
            column: 5,
            rule: "RelationalLtToLe",
            original: "<",
            replacement: "<=",
            sourceLine: "if a < b {}",
            occurrence: 0,
            outcome: outcome
        )
    }

    private func write(_ records: [MutantRecord], to url: URL) throws {
        try MutationRunFile(generatedOn: "2026-09-17", scope: [], mutants: records).write(to: url.path)
    }

    @Test func aLaterRunWinsPerFingerprint() throws {
        let directory = FileManager.default.temporaryDirectory
            .appending(path: "merge-\(UUID().uuidString)", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        try write([record("aaa", outcome: .survived)], to: directory.appending(path: "1.json"))
        try write([record("aaa", outcome: .killed)], to: directory.appending(path: "2.json"))

        let merged = try RunMerging.merge(paths: [directory.path])
        #expect(merged.count == 1)
        #expect(merged.first?.outcome == .killed)
    }

    /// Except that a listed mutant never overwrites a measured one, whichever
    /// order the files arrive in. A `--list --json` dump must not wipe out an
    /// hour of measurement.
    @Test func aListedMutantNeverOverwritesAMeasuredOne() throws {
        let directory = FileManager.default.temporaryDirectory
            .appending(path: "merge-\(UUID().uuidString)", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        try write([record("aaa", outcome: .survived)], to: directory.appending(path: "1.json"))
        try write([record("aaa", outcome: .planned)], to: directory.appending(path: "2.json"))

        let merged = try RunMerging.merge(paths: [directory.path])
        #expect(merged.first?.outcome == .survived)
    }

    @Test func survivorsAreTheFingerprintsThatLived() {
        let records = [
            record("a", outcome: .survived),
            record("b", outcome: .killed),
            record("c", outcome: .survived),
            record("d", outcome: .planned),
            record("e", outcome: .compileError),
        ]
        #expect(RunMerging.survivingFingerprints(in: records) == ["a", "c"])
    }

    @Test func aPathThatIsNotThereIsAnError() {
        #expect(throws: RunMergingError.self) {
            _ = try RunMerging.merge(paths: ["/nowhere/at/all.json"])
        }
    }
}
```

- [x] **Step 2: Run the tests and watch them fail**

```bash
swift test --package-path Tools/CodeQuality --disable-sandbox --filter RunMergingTests
```

Expected: the build fails with `cannot find 'RunMerging' in scope`.

- [x] **Step 3: Write the implementation**

Create `Tools/CodeQuality/Sources/MutationCore/RunMerging.swift`:

```swift
import Foundation

public enum RunMergingError: Error, CustomStringConvertible {
    case noRunFile(String)
    case unreadable(String, any Error)

    public var description: String {
        switch self {
        case let .noRunFile(path): "No mutation run at \(path)."
        case let .unreadable(path, error): "Could not read \(path): \(error)"
        }
    }
}

/// Reads mutation runs and lays them over one another.
///
/// Used by the triage tool to build one picture out of a handful of scoped
/// runs, and by the runner to find out what survived a previous run. One
/// implementation, because two would eventually disagree about which record
/// wins and the two tools would then describe different worlds.
public enum RunMerging {
    /// A path is either a run file or a directory of them.
    public static func runFiles(at path: String) throws -> [String] {
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: path, isDirectory: &isDirectory) else {
            throw RunMergingError.noRunFile(path)
        }
        guard isDirectory.boolValue else { return [path] }
        let contents = (try? FileManager.default.contentsOfDirectory(atPath: path)) ?? []
        return contents.filter { $0.hasSuffix(".json") }
            .sorted()
            .map { path + "/" + $0 }
    }

    /// Every record in `paths`, later files winning per fingerprint, in the
    /// order the fingerprints were first seen.
    public static func merge(paths: [String]) throws -> [MutantRecord] {
        var merged: [String: MutantRecord] = [:]
        var order: [String] = []
        var loadedAny = false

        for path in paths {
            for file in try runFiles(at: path) {
                loadedAny = true
                let run: MutationRunFile
                do {
                    run = try MutationRunFile.read(from: file)
                } catch {
                    throw RunMergingError.unreadable(file, error)
                }
                for record in run.mutants {
                    // A real result always beats a `planned` placeholder,
                    // whichever order the files arrived in: a `--list --json`
                    // fingerprint dump must never overwrite an outcome somebody
                    // spent an hour measuring.
                    if let existing = merged[record.fingerprint],
                       record.outcome == .planned, existing.outcome != .planned {
                        continue
                    }
                    if merged[record.fingerprint] == nil { order.append(record.fingerprint) }
                    merged[record.fingerprint] = record
                }
            }
        }

        guard loadedAny else { throw RunMergingError.noRunFile(paths.joined(separator: ", ")) }
        return order.compactMap { merged[$0] }
    }

    /// The fingerprints that were measured and lived, in run order.
    public static func survivingFingerprints(in records: [MutantRecord]) -> [String] {
        records.filter { $0.outcome == .survived }.map(\.fingerprint)
    }
}
```

Then replace the body of `RunLoading.load` and delete `RunLoading.expand` in `Tools/CodeQuality/Sources/MutationTriage/RunLoading.swift`:

```swift
    public static func load(paths: [String]) throws -> [MutantRecord] {
        let resolved = paths.isEmpty ? [defaultPath] : paths
        do {
            return try RunMerging.merge(paths: resolved)
        } catch let error as RunMergingError {
            switch error {
            case let .noRunFile(path): throw TriageError.noRunFile(path)
            case let .unreadable(path, underlying): throw TriageError.unreadable(path, underlying)
            }
        }
    }
```

`TriageError.noRunFile` keeps its long message with the `mutate.sh --json` hint, so what a person sees does not change.

- [x] **Step 4: Run the tests and watch them pass**

```bash
swift test --package-path Tools/CodeQuality --disable-sandbox
```

Expected: `✔ Test run with 97 tests in 10 suites passed`. `RenderTests` has two tests that call `RunLoading.load` and one that expects it to throw `TriageError`; all three must still pass.

- [x] **Step 5: Check the triage tool end to end**

```bash
./Scripts/mutate-triage.sh status
./Scripts/mutate-triage.sh next --limit 3
```

Expected: the same output as before the change.

- [x] **Step 6: Lint, rebuild, commit**

```bash
./Scripts/lint.sh
swift test --package-path Tools/CodeQuality --disable-sandbox
git add Tools/CodeQuality/Sources/MutationCore/RunMerging.swift \
        Tools/CodeQuality/Tests/MutationCoreTests/RunMergingTests.swift \
        Tools/CodeQuality/Sources/MutationTriage/RunLoading.swift
git commit
```

---

### Task 7b: A later run of a file replaces what earlier runs said about it

Found while landing the 2026-09-17 triage. Merging is per fingerprint, so a full run followed by a scoped re-run of one file keeps every fingerprint the full run had for that file, including the ones on lines that were edited or deleted in between. Those mutants no longer exist. A survivor among them then sits in "never looked at" for ever with nothing to investigate, and the area's score counts mutants the tree does not have. On 2026-09-17 five files had this (`PageReading.swift`, `SiteCategoryColor.swift`, `CountryLocator.swift`, `ImportItems.swift`, `ImportBatches.swift`).

A run file lists every mutant its source files hold (a scoped run does, a `--list --json` dump does, and Task 8's `--only` run does, with the unchosen ones as `planned`). So the rule is: when a later run file lists a source file, anything earlier runs had for that source file which the later run does not list is dropped.

Do this task straight after Task 7. It changes only `RunMerging.merge(paths:)` and its tests.

**Files:**
- Modify: `Tools/CodeQuality/Sources/MutationCore/RunMerging.swift` (inside `merge(paths:)`)
- Modify: `Tools/CodeQuality/Tests/MutationCoreTests/RunMergingTests.swift`

**Interfaces:**
- Consumes: `RunMerging.merge(paths:)` from Task 7.
- Produces: no new names. `merge(paths:)` keeps its signature.

- [x] **Step 1: Write the failing tests**

Add to `RunMergingTests`:

```swift
    /// A scoped re-run lists every mutant its file has now. A fingerprint an
    /// earlier run had for that file, and this one does not, sat on a line
    /// that has since been edited or deleted. Keeping it counts a mutant that
    /// no longer exists, and a survivor among them could never be triaged.
    @Test func aLaterRunOfAFileDropsTheMutantsItNoLongerLists() throws {
        let directory = FileManager.default.temporaryDirectory
            .appending(path: "merge-\(UUID().uuidString)", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let other = "Sources/FieldmarkCore/Discovery/B.swift"
        try write(
            [
                record("gone", outcome: .survived),
                record("kept", outcome: .survived),
                record("elsewhere", file: other, outcome: .survived),
            ],
            to: directory.appending(path: "1.json")
        )
        try write(
            [record("kept", outcome: .killed), record("new", outcome: .killed)],
            to: directory.appending(path: "2.json")
        )

        let merged = try RunMerging.merge(paths: [directory.path])

        #expect(merged.map(\.fingerprint) == ["kept", "elsewhere", "new"])
        #expect(merged.first?.outcome == .killed)
    }

    /// A listing is still a listing: it cannot overwrite a measured result, but
    /// it does say which mutants the file has now.
    @Test func aListingKeepsMeasuredResultsAndDropsVanishedMutants() throws {
        let directory = FileManager.default.temporaryDirectory
            .appending(path: "merge-\(UUID().uuidString)", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        try write(
            [record("gone", outcome: .survived), record("stays", outcome: .killed)],
            to: directory.appending(path: "1.json")
        )
        try write([record("stays", outcome: .planned)], to: directory.appending(path: "2.json"))

        let merged = try RunMerging.merge(paths: [directory.path])

        #expect(merged.map(\.fingerprint) == ["stays"])
        #expect(merged.first?.outcome == .killed)
    }

    /// A fingerprint that was dropped and then turns up again in a later file
    /// must appear once, not twice.
    @Test func aMutantThatComesBackAppearsOnce() throws {
        let directory = FileManager.default.temporaryDirectory
            .appending(path: "merge-\(UUID().uuidString)", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        try write([record("back", outcome: .survived)], to: directory.appending(path: "1.json"))
        try write([record("other", outcome: .killed)], to: directory.appending(path: "2.json"))
        try write(
            [record("other", outcome: .killed), record("back", outcome: .killed)],
            to: directory.appending(path: "3.json")
        )

        let merged = try RunMerging.merge(paths: [directory.path])

        #expect(merged.map(\.fingerprint) == ["other", "back"])
    }
```

- [x] **Step 2: Run them and see them fail**

```bash
swift test --package-path Tools/CodeQuality --disable-sandbox --filter RunMergingTests
```

Expected: the three new tests fail (`gone` is still in the result), the older ones pass.

- [x] **Step 3: Drop what a later run no longer lists**

In `RunMerging.merge(paths:)`, straight after `run` has been read and before the `for record in run.mutants` loop, add:

```swift
                // A run lists every mutant its source files hold. Anything an
                // earlier run had for one of those files, and this run does not
                // list, sat on a line that has since changed: it is not a mutant
                // any more, and keeping it would count something the tree lacks.
                let listed = Set(run.mutants.map(\.fingerprint))
                let files = Set(run.mutants.map(\.file))
                let vanished = Set(
                    merged.values
                        .filter { files.contains($0.file) && !listed.contains($0.fingerprint) }
                        .map(\.fingerprint)
                )
                if !vanished.isEmpty {
                    for fingerprint in vanished { merged[fingerprint] = nil }
                    order.removeAll { vanished.contains($0) }
                }
```

- [x] **Step 4: Run the package's tests**

```bash
swift test --package-path Tools/CodeQuality --disable-sandbox
```

Expected: everything passes, including `MutationTriageTests` (its `RunLoading` now delegates here, so it inherits the rule).

- [x] **Step 5: Say so in the docs, lint, commit**

In `docs/mutation-testing.md`, in the hand-written "Triaging Survivors" part, add one sentence after the paragraph that introduces the commands: "When several run files are merged, a later run of a source file replaces everything earlier runs said about that file, so mutants on lines that have since changed drop out."

```bash
./Scripts/lint.sh
swift test --package-path Tools/CodeQuality --disable-sandbox
git add Tools/CodeQuality/Sources/MutationCore/RunMerging.swift \
        Tools/CodeQuality/Tests/MutationCoreTests/RunMergingTests.swift \
        docs/mutation-testing.md
git commit -m "fix(mutation): let a later run of a file replace what earlier runs said about it"
```

(Use the `house-style:how-to-commit` skill for the body and add the usual trailer.)

### Task 8: Run only the mutants you choose

`--only <fingerprint> …` runs just those. `--survivors-of <run.json or directory> …` runs what survived that run. Both take a list the way `--files` does: the flag swallows every following token that is not a flag.

A fingerprint says nothing about which file it lives in, so on its own `--only` has to plan the whole module to find it. That parse costs 2.28 s and no compiling, which is why it is left as it is. Adding `--files` alongside makes it instant, and the two together are the normal way to use it.

**Files:**
- Create: `Tools/CodeQuality/Sources/MutationCore/RunnerArguments.swift`
- Create: `Tools/CodeQuality/Sources/MutationCore/MutantSelection.swift`
- Create: `Tools/CodeQuality/Tests/MutationCoreTests/RunnerArgumentsTests.swift`
- Create: `Tools/CodeQuality/Tests/MutationCoreTests/MutantSelectionTests.swift`
- Modify: `Tools/CodeQuality/Sources/mutation-runner/main.swift:88-135` and the mutant loop
- Modify: `Tools/CodeQuality/Sources/mutation-runner/JSONReport.swift`

**Interfaces:**
- Consumes: `RunMerging` (Task 6).
- Produces:
  - `public struct RunnerArguments: Equatable, Sendable` with `public var files: [String]`, `public var only: [String]`, `public var survivorsOf: [String]`, `public var listOnly: Bool`, `public var jsonPath: String?`, plus `public struct Failure: Error, Equatable { public let message: String }`, `public static let usage: String` and `public static func parse(_ raw: [String]) throws -> RunnerArguments`.
  - `public enum MutantSelection` with `public struct Choice: Equatable, Sendable { public let chosen: [String]; public let missing: [String] }` and `public static func choose(wanted: [String], from planned: [String]) -> Choice`.

- [x] **Step 1: Write the failing tests for the command line**

Create `Tools/CodeQuality/Tests/MutationCoreTests/RunnerArgumentsTests.swift`:

```swift
import MutationCore
import Testing

/// The runner's command line. In the library rather than in `main.swift`,
/// because `main.swift` is top-level code full of globals and nothing there can
/// be called from a test.
@Suite(.serialized) struct RunnerArgumentsTests {
    @Test func aListFlagSwallowsEveryFollowingPathAndStopsAtTheNextFlag() throws {
        let args = try RunnerArguments.parse(["--files", "a.swift", "b.swift", "--list"])
        #expect(args.files == ["a.swift", "b.swift"])
        #expect(args.listOnly)
    }

    @Test func fingerprintsAndRunsAreGatheredTheSameWay() throws {
        let args = try RunnerArguments.parse([
            "--only", "7f22077198f4", "18aee78c745d",
            "--survivors-of", ".build/mutation", "docs/mutation-run.json",
            "--json", "out.json",
        ])
        #expect(args.only == ["7f22077198f4", "18aee78c745d"])
        #expect(args.survivorsOf == [".build/mutation", "docs/mutation-run.json"])
        #expect(args.jsonPath == "out.json")
    }

    @Test func anEmptyListIsRefused() {
        #expect(throws: RunnerArguments.Failure.self) {
            _ = try RunnerArguments.parse(["--only", "--list"])
        }
    }

    @Test func anUnknownFlagIsRefused() {
        #expect(throws: RunnerArguments.Failure.self) {
            _ = try RunnerArguments.parse(["--everything"])
        }
    }

    @Test func noArgumentsMeansTheWholeModule() throws {
        let args = try RunnerArguments.parse([])
        #expect(args.files.isEmpty)
        #expect(args.only.isEmpty)
        #expect(args.survivorsOf.isEmpty)
        #expect(args.listOnly == false)
        #expect(args.jsonPath == nil)
    }
}
```

- [x] **Step 2: Write the failing tests for the selection**

Create `Tools/CodeQuality/Tests/MutationCoreTests/MutantSelectionTests.swift`:

```swift
import MutationCore
import Testing

/// Choosing mutants by fingerprint. A fingerprint that matches nothing is the
/// interesting case: it means the mutated line has been edited, so the thing
/// the person asked to re-check is not there any more. Silently running the
/// other four would look like a clean result.
@Suite(.serialized) struct MutantSelectionTests {
    @Test func theChosenKeepPlanOrderRatherThanTheOrderTheyWereAskedFor() {
        let choice = MutantSelection.choose(wanted: ["c", "a"], from: ["a", "b", "c", "d"])
        #expect(choice.chosen == ["a", "c"])
        #expect(choice.missing.isEmpty)
    }

    @Test func aFingerprintThatMatchesNothingIsReportedBack() {
        let choice = MutantSelection.choose(wanted: ["a", "gone"], from: ["a", "b"])
        #expect(choice.chosen == ["a"])
        #expect(choice.missing == ["gone"])
    }

    @Test func askingTwiceChoosesOnce() {
        let choice = MutantSelection.choose(wanted: ["a", "a"], from: ["a", "b"])
        #expect(choice.chosen == ["a"])
    }

    @Test func wantingNothingChoosesNothing() {
        let choice = MutantSelection.choose(wanted: [], from: ["a", "b"])
        #expect(choice.chosen.isEmpty)
        #expect(choice.missing.isEmpty)
    }
}
```

- [x] **Step 3: Run both and watch them fail**

```bash
swift test --package-path Tools/CodeQuality --disable-sandbox --filter RunnerArgumentsTests --filter MutantSelectionTests
```

Expected: the build fails with `cannot find 'RunnerArguments' in scope`.

- [x] **Step 4: Write the command line**

Create `Tools/CodeQuality/Sources/MutationCore/RunnerArguments.swift`:

```swift
import Foundation

/// The mutation runner's command line.
///
/// Three flags take lists, and each one swallows every following token that is
/// not a flag. That is how `--files` has always behaved, and the two new ones
/// match it so there is one rule to remember.
public struct RunnerArguments: Equatable, Sendable {
    public var files: [String] = []
    public var only: [String] = []
    public var survivorsOf: [String] = []
    public var listOnly = false
    public var jsonPath: String?

    public struct Failure: Error, Equatable {
        public let message: String
        public init(message: String) { self.message = message }
    }

    public static let usage = """
    Usage: mutation-runner [--files <path> ...] [--only <fingerprint> ...]
                           [--survivors-of <run.json|dir> ...] [--list] [--json <path>]
    """

    private enum List {
        case files
        case only
        case survivorsOf
    }

    public init() {}

    public static func parse(_ raw: [String]) throws -> RunnerArguments {
        var parsed = RunnerArguments()
        var iterator = raw.makeIterator()
        var pending: List?

        while let argument = iterator.next() {
            if let list = pending {
                if !argument.hasPrefix("--") {
                    switch list {
                    case .files: parsed.files.append(argument)
                    case .only: parsed.only.append(argument)
                    case .survivorsOf: parsed.survivorsOf.append(argument)
                    }
                    continue
                }
                try check(list, parsed)
                pending = nil
            }
            switch argument {
            case "--list":
                parsed.listOnly = true
            case "--json":
                guard let path = iterator.next(), !path.hasPrefix("--") else {
                    throw Failure(message: "--json needs a path to write the report to")
                }
                parsed.jsonPath = path
            case "--files": pending = .files
            case "--only": pending = .only
            case "--survivors-of": pending = .survivorsOf
            default:
                throw Failure(message: "Unknown argument: \(argument)")
            }
        }
        if let pending { try check(pending, parsed) }
        return parsed
    }

    private static func check(_ list: List, _ parsed: RunnerArguments) throws {
        switch list {
        case .files where parsed.files.isEmpty:
            throw Failure(message: "--files must be followed by at least one path")
        case .only where parsed.only.isEmpty:
            throw Failure(message: "--only must be followed by at least one fingerprint")
        case .survivorsOf where parsed.survivorsOf.isEmpty:
            throw Failure(message: "--survivors-of must be followed by at least one run file or directory")
        default:
            break
        }
    }
}
```

- [x] **Step 5: Write the selection**

Create `Tools/CodeQuality/Sources/MutationCore/MutantSelection.swift`:

```swift
import Foundation

/// Picking planned mutants out by fingerprint.
public enum MutantSelection {
    public struct Choice: Equatable, Sendable {
        /// The fingerprints to run, in plan order rather than in the order they
        /// were asked for, so a run file reads the same however the request was
        /// typed.
        public let chosen: [String]
        /// Fingerprints nothing matched. The line they described has been
        /// edited, so there is nothing to re-check and the run has to say so
        /// rather than quietly measuring less than it was asked to.
        public let missing: [String]

        public init(chosen: [String], missing: [String]) {
            self.chosen = chosen
            self.missing = missing
        }
    }

    public static func choose(wanted: [String], from planned: [String]) -> Choice {
        let wantedSet = Set(wanted)
        let plannedSet = Set(planned)
        return Choice(
            chosen: planned.filter { wantedSet.contains($0) },
            missing: wanted.filter { !plannedSet.contains($0) }.reduce(into: []) { unique, fingerprint in
                if !unique.contains(fingerprint) { unique.append(fingerprint) }
            }
        )
    }
}
```

- [x] **Step 6: Run both and watch them pass**

```bash
swift test --package-path Tools/CodeQuality --disable-sandbox --filter RunnerArgumentsTests --filter MutantSelectionTests
```

Expected: `✔ Test run with 9 tests in 2 suites passed`.

- [x] **Step 7: Use both from `main.swift`**

Replace the whole `// MARK: - CLI parsing` block (`main.swift:88-135`) with:

```swift
// MARK: - CLI parsing

let arguments: RunnerArguments
do {
    arguments = try RunnerArguments.parse(Array(CommandLine.arguments.dropFirst()))
} catch let failure as RunnerArguments.Failure {
    logErr(failure.message)
    logErr(RunnerArguments.usage)
    exit(2)
}

let fileArgs = arguments.files
let targetFiles = fileArgs.isEmpty ? allCoreSwiftFiles() : resolveTargetFiles(fileArgs)

guard !targetFiles.isEmpty else {
    logErr("No target files found under Sources/FieldmarkCore.")
    exit(2)
}
```

After `warnAboutDuplicateFingerprints(planned)` (`main.swift:161`), add the selection:

```swift
// MARK: - Choose which mutants to run

/// Fingerprints asked for by hand, plus everything that survived the runs named
/// by `--survivors-of`.
var wanted = arguments.only
if !arguments.survivorsOf.isEmpty {
    do {
        let records = try RunMerging.merge(paths: arguments.survivorsOf)
        wanted += RunMerging.survivingFingerprints(in: records)
    } catch {
        logErr("\(error)")
        exit(2)
    }
}

let selection = MutantSelection.choose(wanted: wanted, from: planned.map(\.fingerprint))
if !selection.missing.isEmpty {
    for fingerprint in selection.missing {
        logErr("No mutant has fingerprint \(fingerprint). Its line has been edited since the run that named it.")
    }
    exit(2)
}

/// The mutants this run will actually judge, and what the run file will list.
///
/// The file lists every mutant of every file a chosen mutant lives in, so that
/// the file's denominator stays honest; the ones nobody ran stay `planned`.
var reported = planned
var toRun = planned
if !wanted.isEmpty {
    let chosen = Set(selection.chosen)
    let touched = Set(planned.filter { chosen.contains($0.fingerprint) }.map(\.displayPath))
    reported = planned.filter { touched.contains($0.displayPath) }
    toRun = planned.filter { chosen.contains($0.fingerprint) }
}
```

Then four small edits in the rest of the file:

1. `if listOnly {` (line 165) becomes `if arguments.listOnly {`.
2. Inside that block, `if let jsonPath {` becomes `if let jsonPath = arguments.jsonPath {`, and the call becomes `writeRunJSON(path: jsonPath, scope: fileArgs, planned: reported, categories: [:])`.
3. `let total = planned.count` (line 207) becomes `let total = toRun.count`, and `for (index, item) in planned.enumerated() {` (line 211) becomes `for (index, item) in toRun.enumerated() {`.
4. In the report block near line 268, `if let jsonPath {` becomes `if let jsonPath = arguments.jsonPath {` and the call becomes `writeRunJSON(path: jsonPath, scope: fileArgs, planned: reported, categories: categories)`.

- [x] **Step 8: Prove `--only` runs one mutant and writes an honest file**

```bash
swift build --package-path Tools/CodeQuality --product mutation-runner --disable-sandbox
BIN="$(swift build --package-path Tools/CodeQuality --product mutation-runner --show-bin-path --disable-sandbox)/mutation-runner"
"$BIN" --list --json .build/mutation/chain-list.json --files Sources/FieldmarkCore/Discovery/ChainSites.swift
FP="$(grep -m1 '"fingerprint"' .build/mutation/chain-list.json | sed 's/.*: "//;s/".*//')"
echo "chosen fingerprint: $FP"
time ./Scripts/mutate.sh --only "$FP" --files Sources/FieldmarkCore/Discovery/ChainSites.swift \
  --json .build/mutation/chain-only.json
grep -c '"outcome" : "planned"' .build/mutation/chain-only.json
```

Expected: `Target: 1 file(s), 22 mutant(s)` in the header, one `[1/1]` line, a run of a few seconds, and `21` planned records in the file, the remaining one carrying a real outcome.

- [x] **Step 9: Prove a dead fingerprint is an error**

```bash
./Scripts/mutate.sh --only deadbeef1234 --files Sources/FieldmarkCore/Discovery/ChainSites.swift
echo "exit: $?"
```

Expected: `No mutant has fingerprint deadbeef1234. Its line has been edited since the run that named it.` and `exit: 2`.

- [x] **Step 10: Prove `--survivors-of` picks up what survived**

```bash
./Scripts/mutate.sh --survivors-of .build/mutation/chainplaces-before.json \
  --files Sources/FieldmarkCore/Discovery/ChainSites.swift --json .build/mutation/chain-survivors.json
echo "exit: $?"
```

Expected: it runs exactly the mutants the earlier run recorded as survived, and exits 1 if they survive again or 0 if they do not. If `chainplaces-before.json` has no survivors it runs nothing and exits 0; in that case use `docs/mutation-run.json` and a file that does have survivors.

- [x] **Step 11: Prove the triage tool reads the scoped file properly**

```bash
./Scripts/mutate-triage.sh status --run .build/mutation/chain-only.json
```

Expected: the summary counts one measured mutant, and the verdicts filed against the 21 listed mutants show under `Out of scope`, not under `Stale`. That is Task 6 doing its job.

- [x] **Step 12: Lint, rebuild, commit**

```bash
./Scripts/lint.sh
swift test --package-path Tools/CodeQuality --disable-sandbox
swift build --package-path Tools/CodeQuality --product mutation-runner --disable-sandbox
git add Tools/CodeQuality/Sources/MutationCore/RunnerArguments.swift \
        Tools/CodeQuality/Sources/MutationCore/MutantSelection.swift \
        Tools/CodeQuality/Tests/MutationCoreTests/RunnerArgumentsTests.swift \
        Tools/CodeQuality/Tests/MutationCoreTests/MutantSelectionTests.swift \
        Tools/CodeQuality/Sources/mutation-runner/main.swift \
        Tools/CodeQuality/Sources/mutation-runner/JSONReport.swift
git commit
```

Expected from the test run: `✔ Test run with 106 tests in 12 suites passed`.

---

### Task 9: Make `RepoLanguageTests` fast

Measured at 2.213 s, of which 2.072 s is one test. That test asks, for every line of every file that runs, whether any of eight or nineteen banned words appears as a whole word in command position. That is about 1.3 million Foundation string searches over 151,000 lines, and almost all of them are asked of files that do not contain the word at all.

The fix is a filter in front of the line loop: a word can only be used on a line if it appears somewhere in the file, so the word list is narrowed per file first. Three spellings of that filter were measured. `text.lowercased()` then `contains` took the slow test from 2.072 s to 1.468 s. `text.range(of:options:.caseInsensitive)` made it worse, 5.648 s. A hand-written scan over the UTF-8 bytes took it to **0.592 s**, and the suite to **0.711 s**, which is the one below.

**Files:**
- Modify: `Tests/FieldmarkCoreTests/RepoLanguageTests.swift` (`BannedLanguage.invocations`, plus a new helper and its tests)

**Interfaces:**
- Consumes: nothing.
- Produces: `BannedLanguage.mentions(_ word: [UInt8], in bytes: [UInt8]) -> Bool`, used only inside the same file.

- [x] **Step 1: Write the failing tests for the new helper**

Add to `RepoLanguageTests` in `Tests/FieldmarkCoreTests/RepoLanguageTests.swift`, after `aFileIsScannedWhenItRunsAndNotWhenItIsProse`:

```swift
    // MARK: - The per-file filter

    /// The filter in front of the line scan only ever narrows the word list, so
    /// it has to say yes to every spelling the scan itself would have found.
    /// A false "no" here is a rule that silently stops being enforced, which is
    /// the one failure this suite cannot afford.
    @Test func theFilterFindsAWordWhateverCaseItIsWrittenIn() {
        let bytes = Array("let x = TclSh(3)".utf8)
        #expect(BannedLanguage.mentions(Array("tclsh".utf8), in: bytes))
    }

    @Test func theFilterFindsAWordButtedUpAgainstOtherLetters() {
        // Whole-word-ness is the line scan's job, not the filter's. The filter
        // has to pass anything the scan might still call a hit.
        #expect(BannedLanguage.mentions(Array("lua".utf8), in: Array("evaluate".utf8)))
    }

    @Test func theFilterSaysNoWhenTheWordIsSimplyNotThere() {
        #expect(BannedLanguage.mentions(Array("tclsh".utf8), in: Array("let x = 1".utf8)) == false)
    }

    @Test func theFilterHandlesDigitsAndAWordLongerThanTheText() {
        #expect(BannedLanguage.mentions(Array("pip3".utf8), in: Array("PIP3 install".utf8)))
        #expect(BannedLanguage.mentions(Array("python3".utf8), in: Array("py".utf8)) == false)
    }
```

- [x] **Step 2: Run the build and watch it fail**

Build rather than test, and always with the same flags. A `swift test` that plans its own build
with different ones recompiles the module: 308 files and 43 seconds.

```bash
swift build --package-path Tools/CoreMutation --build-tests --disable-index-store --disable-sandbox -debug-info-format none
```

Expected: it fails with `type 'BannedLanguage' has no member 'mentions'`.

- [x] **Step 3: Write the helper**

In `Tests/FieldmarkCoreTests/RepoLanguageTests.swift`, inside `enum BannedLanguage`, just above `/// The marker that lets one shell line call a banned command.`:

```swift
    /// Whether `word`, lowercase ASCII, appears anywhere in `bytes`, ignoring
    /// case. Used to narrow the word list before the line-by-line scan.
    ///
    /// Bit 0x20 is the case bit for A to Z, and every digit already has it set,
    /// so OR-ing it in lowercases a letter and leaves a digit alone. Written out
    /// by hand because the Foundation spellings are much slower on this much
    /// text: `lowercased()` then `contains` takes the whole-tree scan from
    /// 2.07 s to 1.47 s, a case-insensitive `range(of:)` takes it to 5.65 s,
    /// and this takes it to 0.59 s. All measured on 2026-09-17.
    static func mentions(_ word: [UInt8], in bytes: [UInt8]) -> Bool {
        guard let first = word.first, bytes.count >= word.count else { return false }
        let upper = first & 0xDF
        let limit = bytes.count - word.count
        var start = 0
        while start <= limit {
            let byte = bytes[start]
            if byte == first || byte == upper {
                var offset = 1
                while offset < word.count, bytes[start + offset] | 0x20 == word[offset] {
                    offset += 1
                }
                if offset == word.count { return true }
            }
            start += 1
        }
        return false
    }
```

- [x] **Step 4: Put the filter in front of the line scan**

In the same file, change the opening of `invocations(in:path:)` from:

```swift
        let shell = isShell(path: path, text: text)
        let banned = shell ? interpreters + shellCommands : interpreters

        var found: [Use] = []
```

to:

```swift
        let shell = isShell(path: path, text: text)
        // A word can only be used on a line if it is in the file at all, so the
        // list is narrowed once per file instead of being searched for on every
        // line. This only ever removes words the line scan could not have
        // matched, so the result is the same and the work is a fraction of it.
        let bytes = Array(text.utf8)
        let banned = (shell ? interpreters + shellCommands : interpreters)
            .filter { mentions(Array($0.utf8), in: bytes) }
        guard !banned.isEmpty else { return [] }

        var found: [Use] = []
```

Nothing else in the function changes.

- [x] **Step 5: Run the suite and check both the pass and the time**

```bash
swift build --package-path Tools/CoreMutation --build-tests --disable-index-store --disable-sandbox -debug-info-format none
time swift test --package-path Tools/CoreMutation --skip-build --disable-sandbox --no-parallel --disable-xctest --filter RepoLanguageTests
```

Expected: `✔ Test run with 25 tests in 1 suite passed after 0.7 seconds` or better, down from 2.2 seconds. All 21 original tests still pass.

- [x] **Step 6: Prove the suite still catches a real violation**

This suite guards the repo rather than Core, so a mutation run says nothing about it. Plant one file that outings all three whole-tree tests at once: a banned file type, whose first line is a banned shebang, whose body invokes a banned interpreter. It has to be staged, because the scan reads what git tracks.

```bash
printf '#!/usr/bin/env ruby\n/usr/bin/ruby -e "puts 1"\n' > probe-violation.rb
git add probe-violation.rb
swift test --package-path Tools/CoreMutation --skip-build --disable-sandbox --no-parallel --disable-xctest --filter RepoLanguageTests
git rm --cached -f probe-violation.rb
rm -f probe-violation.rb
git status --short
```

Expected: three failures, one per whole-tree test:

```
✘ Test noFileIsAProgramInAnotherLanguage() recorded an issue at RepoLanguageTests.swift:162:21: Issue recorded
✘ Test noFileAsksAnotherInterpreterToRunIt() recorded an issue at RepoLanguageTests.swift:162:21: Issue recorded
✘ Test nothingThatRunsInvokesAnotherLanguage() recorded an issue at RepoLanguageTests.swift:162:21: Issue recorded
```

and then no output at all from `git status --short`. If the probe file is still there, delete it before going any further: a tracked file naming another interpreter fails this suite for everyone.

- [x] **Step 7: Lint, rebuild, commit**

```bash
./Scripts/lint.sh
swift build --package-path Tools/CoreMutation --build-tests --disable-index-store --disable-sandbox -debug-info-format none
swift test --package-path Tools/CoreMutation --skip-build --disable-sandbox --no-parallel --disable-xctest --filter RepoLanguageTests
git add Tests/FieldmarkCoreTests/RepoLanguageTests.swift
git commit
```

---

### Task 10: Make `AgentRunnerDeadlineTests` fast

Measured at 0.742 s, and 0.739 s of that is three tests sleeping: 250 ms, 250 ms and 200 ms, so that enough wall-clock time passes for a deadline to expire. The suite's own doc comment explains why: "the clock cannot be substituted". Give it a clock it can substitute and the sleeps go away.

The one constraint that shapes this task: `AgentRunner.swift` line 178 reads

```swift
        if clock.now - started >= budget.deadline { return .deadlineReached }
```

and a ledger verdict is filed against that exact line, hashed from its text. Changing the text detaches the verdict. So the property stays named `clock` and keeps a `now` of the same type; only its declared type changes, and both lines that use it stay byte for byte as they are.

**Files:**
- Create: `Sources/FieldmarkCore/Agent/AgentClock.swift`
- Modify: `Sources/FieldmarkCore/Agent/AgentRunner.swift:54` and `:65`
- Modify: `Tests/FieldmarkCoreTests/AgentRunnerDeadlineTests.swift`

**Interfaces:**
- Consumes: nothing.
- Produces: `public protocol AgentClock: Sendable { var now: ContinuousClock.Instant { get } }` and `public struct SystemAgentClock: AgentClock`. `AgentRunner.init` takes `clock: any AgentClock = SystemAgentClock()` in site of `clock: ContinuousClock = ContinuousClock()`.

- [x] **Step 1: Record what the mutation tool says today**

```bash
./Scripts/mutate.sh --files Sources/FieldmarkCore/Agent/AgentRunner.swift Sources/FieldmarkCore/Agent/AgentBudget.swift \
  --json .build/mutation/agent-before.json
```

Expected: 23 mutants, and a survivor list to compare against later. Keep the file.

- [x] **Step 2: Write the clock**

Create `Sources/FieldmarkCore/Agent/AgentClock.swift`:

```swift
import Foundation

/// Where a run reads the time from.
///
/// A protocol rather than `ContinuousClock` itself so that a test can hold the
/// clock still and step it by hand. The deadline is the one budget that cannot
/// be reached by arranging the input, so before this the only way to sit a run
/// on its edge was to wait there, and three tests spent 700 ms doing exactly
/// that.
public protocol AgentClock: Sendable {
    var now: ContinuousClock.Instant { get }
}

/// The real clock. Monotonic, so moving the wall clock cannot extend a run or
/// cut one short.
public struct SystemAgentClock: AgentClock {
    public init() {}

    public var now: ContinuousClock.Instant { ContinuousClock().now }
}
```

- [x] **Step 3: Change the two declarations in `AgentRunner`**

In `Sources/FieldmarkCore/Agent/AgentRunner.swift`, line 54:

```swift
    private let clock: any AgentClock
```

and line 65, in the initialiser's parameter list:

```swift
        clock: any AgentClock = SystemAgentClock()
```

Change nothing else. In particular `let started = clock.now` and `if clock.now - started >= budget.deadline { return .deadlineReached }` must stay exactly as they are, or the verdicts filed against those lines detach.

- [x] **Step 4: Check that it builds and no caller broke**

```bash
swift build --package-path Tools/CoreMutation --build-tests --disable-index-store --disable-sandbox -debug-info-format none
```

Expected: `Build complete!`. Nothing passes `clock:` today: `grep -rn 'AgentRunner(' Sources Tests` finds the one production call site in `Sources/FieldmarkUI/Outings/OutingRunModel+Batches.swift` and about twenty test sites, none of which name the parameter.

- [x] **Step 5: Give the tests a clock they can step**

In `Tests/FieldmarkCoreTests/AgentRunnerDeadlineTests.swift`, replace the suite's doc comment sentence "the clock cannot be substituted" with the truth, and add the stepped clock at the bottom of the file next to `SlowTool`:

```swift
/// A clock that moves only when a test says so.
///
/// With it, "the deadline has passed" is a fact a test states rather than one it
/// waits for, so the three tests below spend no wall-clock time at all.
private final class SteppedClock: AgentClock, @unchecked Sendable {
    private let lock = NSLock()
    private var instant = ContinuousClock().now

    var now: ContinuousClock.Instant {
        lock.withLock { instant }
    }

    func advance(by duration: Duration) {
        lock.withLock { instant = instant.advanced(by: duration) }
    }
}
```

and change `SlowTool` to take the clock and move it instead of sleeping:

```swift
/// A tool that uses up a measurable amount of the budget, and says how many
/// calls it began and how many it saw through.
///
/// It moves the clock rather than waiting, and still suspends once, so the run
/// really does go round a suspension point in the middle of a tool call. That
/// is the thing `aToolAlreadyRunningIsNotCutOff` is about.
private final class SlowTool: AgentTool, @unchecked Sendable {
    let spec: AgentToolSpec
    private let takes: Duration
    private let clock: SteppedClock
    private let lock = NSLock()
    private var started = 0
    private var finished = 0

    init(name: String, takes: Duration, clock: SteppedClock) {
        spec = AgentToolSpec(name: name, description: "slow", parameters: [])
        self.takes = takes
        self.clock = clock
    }

    func run(_: ToolArguments) async -> String {
        lock.withLock { started += 1 }
        await Task.yield()
        clock.advance(by: takes)
        lock.withLock { finished += 1 }
        return #"{"ok":true}"#
    }

    var callCount: Int {
        lock.withLock { started }
    }

    var finishedCount: Int {
        lock.withLock { finished }
    }
}
```

Then in each of the three sleeping tests, make the clock and hand it to both the tool and the runner. `aTurnStopsPartWayThroughWhenItRunsOutOfTime` becomes:

```swift
    @Test func aTurnStopsPartWayThroughWhenItRunsOutOfTime() async {
        let clock = SteppedClock()
        let slow = SlowTool(name: "read_link", takes: .milliseconds(250), clock: clock)
        let chat = ScriptedAgentChat([
            .assistant(content: "", toolCalls: (1 ... 4).map {
                AgentToolCall(id: "c\($0)", name: "read_link", arguments: "{}")
            }),
            .assistant(content: "done", toolCalls: []),
        ])
        let budget = AgentBudget(maxTurns: 40, maxToolCalls: 120, deadline: .milliseconds(100))
        let runner = AgentRunner(chat: chat, tools: [slow], budget: budget, clock: clock)

        let outcome = await runner.run(system: "rules", user: "go")

        #expect(outcome.reason == .deadlineReached)
        #expect(slow.callCount == 1, "it ran \(slow.callCount) of four tools past the deadline")
    }
```

`theCallsThatDidRunAreStillAnsweredBeforeTheRunStops` gets the same two lines (`let clock = SteppedClock()` and `clock: clock` in both constructors) and keeps its assertion. `aToolAlreadyRunningIsNotCutOff` gets them too, keeping `takes: .milliseconds(200)`, `deadline: .milliseconds(50)` and `#expect(slow.finishedCount == 1, …)`.

Leave `aRunWithNoTimeLeftNeverReachesTheModel` exactly as it is. It uses the real clock and its 300 attempts cost 0.001 s, so there is nothing to gain and real-clock coverage to lose.

> **Deviation, found while doing it (2026-09-17).** Leaving that test alone is right, but it is no
> longer the test that kills `>= → >`. Reading the clock through `any AgentClock` puts a call
> between `let started = clock.now` and the first `clock.now`, and that is enough that the two
> readings never land in the same tick any more: with the seam in site, the mutant was hand-applied
> and the **whole** suite passed. So two deterministic boundary tests were added, and both were seen
> to fail against the hand-applied mutant and pass without it:
>
> - `aRunSittingExactlyOnItsDeadlineTakesNoTurn` — a `SteppedClock` that never moves, deadline
>   `.zero`, so `elapsed == deadline` exactly at the top-of-turn check.
> - `aTurnStopsOnTheTickTheDeadlineIsReached` — a tool that advances the clock by exactly the
>   deadline, so `elapsed == deadline` exactly at the after-each-call check. A real clock cannot
>   arrange this one at all.
>
> The suite is 6 tests, not 4, and the ledger's `18aee78c745d` verdict now names the wrong test.

- [x] **Step 6: Run the suite and check both the pass and the time**

```bash
swift build --package-path Tools/CoreMutation --build-tests --disable-index-store --disable-sandbox -debug-info-format none
time swift test --package-path Tools/CoreMutation --skip-build --disable-sandbox --no-parallel --disable-xctest --filter AgentRunnerDeadlineTests
```

Expected: `✔ Test run with 4 tests in 1 suite passed after 0.0 seconds`, down from 0.742 s.

- [x] **Step 7: Prove the tests still kill the same mutants**

```bash
./Scripts/mutate.sh --files Sources/FieldmarkCore/Agent/AgentRunner.swift Sources/FieldmarkCore/Agent/AgentBudget.swift \
  --json .build/mutation/agent-after.json
diff <(sed 's/"generatedOn".*/-/' .build/mutation/agent-before.json) \
     <(sed 's/"generatedOn".*/-/' .build/mutation/agent-after.json) && echo "same verdicts"
```

Expected: `same verdicts`. The two lines you changed hold no operators and no literals, so they carry no mutants and no fingerprint moves. If a mutant that died in Step 1 survives now, stop: the tests have got weaker and the change is wrong.

- [x] **Step 8: Check the verdict filed against the deadline line still matches**

```bash
./Scripts/mutate-triage.sh status --run .build/mutation/agent-after.json
```

Expected: the `18aee78c745d` verdict (`Agent/AgentRunner.swift >= → > [RelationalGeToGt]`) reads as `killed`, not as `stale`. Stale means the line's text moved after all; go back and put it back exactly.

> **Deviation (2026-09-17).** It reads as `stale`, and it already did before this task: the run
> against unmodified main reports the same one stale verdict. Its recorded `sourceLine` is
> `if clock.now - started >= budget.deadline {`, from when the body sat on the next line; today's
> line ends `{ return .deadlineReached }`. So the line moved long before Task 10, and the check
> this step describes cannot pass. What was checked instead: the status is **identical** before and
> after (1 stale, 1 survivor, score 20/21), and the before and after run files are byte-identical
> apart from `generatedOn`. The verdict needs re-recording against the current line, naming
> `aRunSittingExactlyOnItsDeadlineTakesNoTurn`; that is a ledger change, left to whoever owns it.

- [x] **Step 9: Run the whole suite, because this touched production code**

```bash
swift test --package-path Tools/CoreMutation --skip-build --disable-sandbox --no-parallel --disable-xctest
```

Expected: `✔ Test run with 2043 tests in 185 suites passed`.

- [x] **Step 10: Lint, rebuild, commit**

```bash
./Scripts/lint.sh
swift build --package-path Tools/CoreMutation --build-tests --disable-index-store --disable-sandbox -debug-info-format none
swift test --package-path Tools/CoreMutation --skip-build --disable-sandbox --no-parallel --disable-xctest
git add Sources/FieldmarkCore/Agent/AgentClock.swift \
        Sources/FieldmarkCore/Agent/AgentRunner.swift \
        Tests/FieldmarkCoreTests/AgentRunnerDeadlineTests.swift
git commit
```

---

### Task 11: Make `SeedLibraryScriptTests` fast

Measured at 0.900 s over five tests, each of which runs `Scripts/seed-library.sh` into a fresh temporary directory and then deletes it. The script forks about 21 processes per run. Three of the five tests ask for exactly the same library.

Seed once per distinct argument and share it. Three script runs instead of five, and none of the assertions change. Measured with two shared libraries: 0.900 s down to **0.273 s**. Three costs one more script run, about 0.06 s.

The cleanup has to survive the sharing. A `static let` is never released, so a `deinit` would never fire, and a mutation run starts one test process per mutant: a directory leaked per process is 1,697 of them per full run. So the seeds are removed by an `atexit` handler, which was checked and leaves nothing behind.

**Files:**
- Modify: `Tests/FieldmarkCoreTests/SeedLibraryScriptTests.swift`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing outside the file.

- [x] **Step 1: Record what the mutation tool says today**

```bash
./Scripts/mutate.sh --files Sources/FieldmarkCore/Models/SiteOfInterest.swift Sources/FieldmarkCore/Models/Survey.swift \
  --json .build/mutation/seed-before.json
```

Expected: 2 mutants (`Survey.swift` has none). This is a thin proof and it is the honest one available: the suite's real subject is a shell script, and the Core code it touches is two decoders. The stronger proof is Step 5, which checks that every assertion is unchanged.

- [x] **Step 2: Share the seeds**

In `Tests/FieldmarkCoreTests/SeedLibraryScriptTests.swift`, replace the `seed(extra:)` method with a lazily built library per argument, and move the script call to a static:

```swift
    /// The library the tests that want the plain seed read, built once.
    ///
    /// Shared rather than made per test because the script forks about 21
    /// processes and three of these tests ask for exactly the same thing. The
    /// `Result` carries a failure to whichever test asks first, since a `static
    /// let` cannot throw.
    private static let plain: Result<URL, Error> = Result { try runScript(extra: nil) }

    /// The library `nothingSharesAnIdentifier` reads.
    private static let withOneSpare: Result<URL, Error> = Result { try runScript(extra: "1") }

    /// The library `itAddsAsManySparesAsItIsAskedFor` reads.
    private static let withTwoSpares: Result<URL, Error> = Result { try runScript(extra: "2") }

    private func seed(extra: String? = nil) throws -> URL {
        switch extra {
        case nil: try Self.plain.get()
        case "1": try Self.withOneSpare.get()
        default: try Self.withTwoSpares.get()
        }
    }

    /// Runs the script into a throwaway directory and hands back its library root.
    private static func runScript(extra: String?) throws -> URL {
        guard let root = repoRoot else { throw SeedFailure.noCheckout }
        let support = FileManager.default.temporaryDirectory
            .appendingPathComponent("fieldmark-seed-\(UUID().uuidString)", isDirectory: true)

        _ = removeSeedsAtExit
        let script = Process()
        script.executableURL = root.appendingPathComponent("Scripts/seed-library.sh")
        script.arguments = [support.path] + (extra.map { [$0] } ?? [])
        script.standardOutput = Pipe()
        script.standardError = Pipe()
        try script.run()
        script.waitUntilExit()
        guard script.terminationStatus == 0 else { throw SeedFailure.scriptFailed }
        seeded.append(support)

        return support.appendingPathComponent("Surveys", isDirectory: true)
    }
```

Delete the five `defer { try? FileManager.default.removeItem(at: library.deletingLastPathComponent()) }` lines, one in each test. Nothing else inside the five tests changes: every path they look up and every value they assert stays as it is.

Add at the bottom of the file, outside the suite:

```swift
/// Why a seed could not be made. The libraries are built once and shared, so a
/// failure has to visit to whichever test asked for one first.
enum SeedFailure: Error {
    case noCheckout
    case scriptFailed
}

/// Every library seeded in this process, removed when it exits.
///
/// A `static let` is never released, so a `deinit` would never run, and the
/// mutation runner starts one test process per mutant: a directory left behind
/// per process is over a thousand of them per full run.
private nonisolated(unsafe) var seeded: [URL] = []

private let removeSeedsAtExit: Void = {
    atexit {
        for root in seeded { try? FileManager.default.removeItem(at: root) }
    }
}()
```

> **Deviation (2026-09-17).** `Result<URL, Error>` will not do: the value lives in a `static let`,
> so it has to be `Sendable`, and `any Error` is not. `runScript` therefore answers with
> `Result<URL, SeedFailure>` instead of throwing, and `SeedFailure.scriptFailed` carries the reason
> as a `String` (`"it exited 64"`, `"it would not start: …"`) rather than the original error. Two
> smaller things: `try #require` cannot be used outside a test function, so the missing-checkout
> case became `guard let root = repoRoot`; and `seeded.append` moved to before the script runs, so
> a run that fails part way through still has its directory cleaned up.

- [x] **Step 3: Run the suite and check both the pass and the time**

```bash
swift build --package-path Tools/CoreMutation --build-tests --disable-index-store --disable-sandbox -debug-info-format none
time swift test --package-path Tools/CoreMutation --skip-build --disable-sandbox --no-parallel --disable-xctest --filter SeedLibraryScriptTests
```

Expected: `✔ Test run with 5 tests in 1 suite passed after 0.3 seconds` or better, down from 0.900 s.

- [x] **Step 4: Check nothing was left behind**

```bash
ls "$(getconf DARWIN_USER_TEMP_DIR)" | grep -c fieldmark-seed
```

Expected: `0`.

> **Note (2026-09-17).** `0` after five runs one after another, after a whole serial run, after a
> whole parallel run, and after a scoped mutation run. Directories do pile up there, but only from
> processes that died without unwinding — a mutant that traps takes the test process with it, and
> neither `atexit` nor the `defer` this replaced runs then. That was true before this change and
> still is; this version leaks at most three per dead process where the old one leaked five.

- [x] **Step 5: Prove the assertions are untouched**

```bash
git diff Tests/FieldmarkCoreTests/SeedLibraryScriptTests.swift | grep '^-' | grep '#expect'
```

Expected: only the `#expect(script.terminationStatus == 0)` line, which became a `guard` that throws. Every other `#expect` must be untouched. If any other assertion shows up as removed, put it back.

- [x] **Step 6: Prove the mutants still die**

```bash
./Scripts/mutate.sh --files Sources/FieldmarkCore/Models/SiteOfInterest.swift Sources/FieldmarkCore/Models/Survey.swift \
  --json .build/mutation/seed-after.json
diff <(sed 's/"generatedOn".*/-/' .build/mutation/seed-before.json) \
     <(sed 's/"generatedOn".*/-/' .build/mutation/seed-after.json) && echo "same verdicts"
```

Expected: `same verdicts`.

- [x] **Step 7: Lint, rebuild, commit**

```bash
./Scripts/lint.sh
swift build --package-path Tools/CoreMutation --build-tests --disable-index-store --disable-sandbox -debug-info-format none
swift test --package-path Tools/CoreMutation --skip-build --disable-sandbox --no-parallel --disable-xctest --filter SeedLibraryScriptTests
git add Tests/FieldmarkCoreTests/SeedLibraryScriptTests.swift
git commit
```

---

### Task 12: Make `RelaunchCommandTests` fast

Measured at 1.156 s, of which 0.955 s is one test that starts `/bin/sleep 0.7`, waits for the relaunch shell to outlive it, and asserts that at least 0.5 s went by. The stopwatch is the slow part and it is also the weak part: it infers "the opener did not run early" from elapsed time, and it throws away what the opener printed.

Replace the timer with a process whose lifetime the test controls, and assert the two claims directly: while the old copy is alive the shell is still running, and once it is gone the shell opens the right path.

**Files:**
- Modify: `Tests/FieldmarkCoreTests/RelaunchCommandTests.swift`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing outside the file.

- [x] **Step 1: Record what the mutation tool says today**

```bash
./Scripts/mutate.sh --files Sources/FieldmarkCore/Update/RelaunchCommand.swift \
  --json .build/mutation/relaunch-before.json
```

Expected: 3 mutants, with their outcomes. Keep the file.

> **Deviation (2026-09-17).** Three mutants, and **all three are compile errors**, before and after.
> The file is one long string literal: the only tokens the rules can reach are the `+`s that join
> it, and `String - String` does not compile. `3000`, `0.2` and every character of the shell program
> live inside the string, where the rules do not go. So a mutation run says nothing about this file
> either way, and Step 5 below cannot be the proof this task needs.
>
> What was done instead, the shape of Task 9's proof: four behavioural changes were planted in
> `RelaunchCommand.swift`, one at a time, and the suite was run against each, before the rewrite and
> after, recording which tests failed.
>
> | Planted change | Caught before | Caught after |
> | --- | --- | --- |
> | A: opens without waiting at all | `givesUpAfterTenMinutes`, `waitsWhileThePidIsAlive` | the same |
> | B: waits, then runs the opener on no path | `aCraftedPathStaysDataInARealShell`, `opensTheAppOnceThePidIsGone` | the same, **plus `waitsWhileThePidIsAlive`** |
> | C: every value pasted into the shell raw | `aCraftedPathStaysDataInARealShell`, `anOrdinaryPathIsLeftReadable` | the same |
> | D: a different ceiling and a different vote | `givesUpAfterTenMinutes` | the same |
>
> Nothing stopped being caught, and the rewritten test catches one thing more: the old one timed the
> shell and threw away what it printed, so an opener that ran on nothing went past it.

- [x] **Step 2: Rewrite the one slow test**

In `Tests/FieldmarkCoreTests/RelaunchCommandTests.swift`, replace `waitsWhileThePidIsAlive` with:

```swift
    /// The whole point of the command: the new copy is opened after the old one
    /// has quit, never before.
    ///
    /// Held open rather than timed. `/bin/cat` lives exactly as long as its
    /// input stays open, so "the old copy is still running" is something the
    /// test decides rather than something it waits out, and both halves of the
    /// claim are asserted directly: nothing opened while the pid was alive, and
    /// the right path opened once it was gone.
    @Test func waitsWhileThePidIsAlive() throws {
        let holder = Process()
        holder.executableURL = URL(fileURLWithPath: "/bin/cat")
        let input = Pipe()
        holder.standardInput = input
        holder.standardOutput = Pipe()
        try holder.run()

        let text = RelaunchCommand.text(
            pid: holder.processIdentifier,
            app: URL(fileURLWithPath: "/tmp/x.app"),
            opener: "/bin/echo"
        )
        let shell = Process()
        shell.executableURL = URL(fileURLWithPath: "/bin/sh")
        shell.arguments = ["-c", text]
        let output = Pipe()
        shell.standardOutput = output
        try shell.run()

        // Longer than the command's own 0.2 s vote, so the wait has been round
        // its loop at least once and chosen to stay there.
        Thread.sleep(forTimeInterval: 0.25)
        #expect(shell.isRunning, "the opener ran while the old copy was still alive")

        try input.fileHandleForWriting.close()
        let data = output.fileHandleForReading.readDataToEndOfFile()
        shell.waitUntilExit()
        holder.waitUntilExit()

        let opened = (String(bytes: data, encoding: .utf8) ?? "").trimmingCharacters(in: .newlines)
        #expect(opened == "/tmp/x.app", "the opener ran on \(opened)")
    }
```

Leave the other four tests alone.

- [x] **Step 3: Run the suite and check both the pass and the time**

```bash
swift build --package-path Tools/CoreMutation --build-tests --disable-index-store --disable-sandbox -debug-info-format none
time swift test --package-path Tools/CoreMutation --skip-build --disable-sandbox --no-parallel --disable-xctest --filter RelaunchCommandTests
```

Expected: `✔ Test run with 5 tests in 1 suite passed after 0.5 seconds` or better, down from 1.156 s.

- [x] **Step 4: Run it ten times, because a test about timing has to be boring**

```bash
for i in 1 2 3 4 5 6 7 8 9 10; do
  swift test --package-path Tools/CoreMutation --skip-build --disable-sandbox --no-parallel \
    --disable-xctest --filter RelaunchCommandTests > /dev/null 2>&1 || echo "FAILED on run $i"
done
echo done
```

Expected: `done` with no `FAILED` lines.

- [x] **Step 5: Prove the mutants still die**

```bash
./Scripts/mutate.sh --files Sources/FieldmarkCore/Update/RelaunchCommand.swift \
  --json .build/mutation/relaunch-after.json
diff <(sed 's/"generatedOn".*/-/' .build/mutation/relaunch-before.json) \
     <(sed 's/"generatedOn".*/-/' .build/mutation/relaunch-after.json) && echo "same verdicts"
```

Expected: `same verdicts`.

- [x] **Step 6: Lint, rebuild, commit**

```bash
./Scripts/lint.sh
swift build --package-path Tools/CoreMutation --build-tests --disable-index-store --disable-sandbox -debug-info-format none
swift test --package-path Tools/CoreMutation --skip-build --disable-sandbox --no-parallel --disable-xctest --filter RelaunchCommandTests
git add Tests/FieldmarkCoreTests/RelaunchCommandTests.swift
git commit
```

---

### Task 13: Measure the result and say so in the docs

**Files:**
- Modify: `docs/mutation-testing.md` (above line 143 only; everything from `<!-- BEGIN GENERATED` down is written by `mutate-triage.sh render` and must not be hand-edited)
- Modify: `.claude/skills/mutation-triage/SKILL.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing in code.

- [x] **Step 1: Measure the whole suite, both ways**

```bash
swift build --package-path Tools/CoreMutation --build-tests --disable-index-store --disable-sandbox -debug-info-format none
time swift test --package-path Tools/CoreMutation --skip-build --disable-sandbox --no-parallel --disable-xctest
time swift test --package-path Tools/CoreMutation --skip-build --disable-sandbox --parallel --disable-xctest
```

Expected: 2043 tests pass both ways. Before this plan the harness reported 6.016 s serial and 2.834 s parallel. Write down both new numbers.

- [x] **Step 2: Measure one mid-sized file end to end**

```bash
time ./Scripts/mutate.sh --files Sources/FieldmarkCore/Discovery/ChainSites.swift \
  --json .build/mutation/chainplaces-after.json
diff <(sed 's/"generatedOn".*/-/' .build/mutation/chainplaces-before.json) \
     <(sed 's/"generatedOn".*/-/' .build/mutation/chainplaces-after.json) && echo "same verdicts"
```

Expected: `same verdicts`, over the same 22 mutants. Divide the wall-clock time by 22 to get seconds per mutant, and compare it with the Task 1 Step 1 number the same way. That ratio is the result of the whole plan.

- [x] **Step 3: Update `docs/mutation-testing.md`**

Under `## How to Run`, replace the comment on the first example with the measured numbers, and add the two new flags. The fenced bash block in that document becomes:

````markdown
```bash
# Full suite (slow; run it on demand; 1697 mutants):
./Scripts/mutate.sh

# Single file or directory (fast; iterate on a specific area):
./Scripts/mutate.sh --files Sources/FieldmarkCore/Persistence/Slug.swift

# Re-run chosen mutants by fingerprint, the fastest way to check a hardening:
./Scripts/mutate.sh --only 7f22077198f4 --files Sources/FieldmarkCore/Discovery/ChainSites.swift

# Re-run everything that survived an earlier run (a file, or a directory of them):
./Scripts/mutate.sh --survivors-of .build/mutation --json .build/mutation/recheck.json

# List mutant counts without running:
./Scripts/mutate.sh --list

# Write every outcome as JSON, for the triage tool:
./Scripts/mutate.sh --files Sources/FieldmarkCore/Discovery --json .build/mutation/discovery.json
```
````

Put the real per-mutant figure and the real full-run estimate from Step 2 in site of "about an hour", and add these two paragraphs after the exit-code line, with the number you measured in Step 2 written into the first sentence:

```markdown
A mutant costs about <seconds per mutant, from Step 2> seconds: one incremental build with no debug info, one parallel run of
the suite, and a second run of just the tests that failed to confirm the kill. A failing parallel
run is never a kill on its own. The runner re-runs the tests the report named, one at a time, and
only a failure seen twice counts. If it cannot tell which tests failed (a crash truncates the
report, a hang writes none) it runs the whole suite one test at a time and lets that decide, which
is how every verdict was reached before.

`--only` and `--survivors-of` write a run file that lists every mutant of each file they touched:
the ones they ran carry a result, the rest are `planned`. The triage tool reads a `planned` mutant
as out of scope, not stale, so re-running one fingerprint does not send the other verdicts in that
file back to the queue.
```

- [x] **Step 4: Update the triage skill's verify step**

In `.claude/skills/mutation-triage/SKILL.md`, replace the verification block under "A hardening test must be seen to fail against the mutant and pass without it":

````markdown
**A hardening test must be seen to fail against the mutant and pass without it.** Verify:

```bash
./Scripts/mutate.sh --only <fingerprint> --files Sources/FieldmarkCore/Discovery/SiteDiscovery.swift
```

That runs the one mutant and nothing else, so the answer is a single KILLED or SURVIVED line rather
than a count you have to compare against a remembered one. Exit 0 means it is dead. A test written
after the fact that was never seen to kill anything proves nothing.
````

- [x] **Step 5: Check the docs are true**

```bash
./Scripts/mutate-triage.sh status
head -60 docs/mutation-testing.md
```

Expected: the status command still runs, and the commands quoted in the document are the ones you just ran.

- [x] **Step 6: Lint, rebuild, commit**

```bash
./Scripts/lint.sh
swift test --package-path Tools/CodeQuality --disable-sandbox
swift build --package-path Tools/CoreMutation --build-tests --disable-index-store --disable-sandbox -debug-info-format none
swift test --package-path Tools/CoreMutation --skip-build --disable-sandbox --no-parallel --disable-xctest
git add docs/mutation-testing.md .claude/skills/mutation-triage/SKILL.md
git commit
```

Expected: `✔ Test run with 106 tests in 12 suites passed` from the first, and `✔ Test run with 2043 tests in 185 suites passed` from the second.

---

### Task 14: Retire a verdict whose line is gone

The ledger can gain and replace verdicts, but it cannot lose one. A verdict is filed against a hash of its line's text, so when that line is deleted or rewritten the verdict stops matching anything and `status` reports it as stale for ever. The skill forbids editing the ledger by hand, so there has to be a command. Three records are waiting for it today:

| Fingerprint | File | Why it is stale |
| --- | --- | --- |
| `18aee78c745d` | `Agent/AgentRunner.swift` | The line gained `{ return .deadlineReached }`. The same check now lives on line 178 and its mutant is killed. It needs a fresh verdict, and the old one retired. |
| `8c4c88b75f71` | `Annotation/AnnotationApply.swift` | `URLComponents(url:resolvingAgainstBaseURL:)` is no longer called anywhere in `FieldmarkCore`. |
| `a23bf81e5603` | `Models/SiteCategoryColor.swift` | The nested sRGB decode was deleted on 2026-09-17 when `relativeLuminance` started using `OKLab.linear`. `dfabd8d366bd` on `OKLab.swift` covers the same boundary. |

The command must only ever remove a verdict that matches no live mutant. A verdict that still matches is an investigation somebody did, and the way to change it is to `record` over it.

This task can be done at any point in the plan. It touches none of the files the other tasks touch except `CommandLineRunner.swift` (usage text and one `case`) and the `TriageError` enum.

**Files:**
- Create: `Tools/CodeQuality/Sources/MutationTriage/Forgetting.swift`
- Create: `Tools/CodeQuality/Tests/MutationTriageTests/ForgettingTests.swift`
- Modify: `Tools/CodeQuality/Sources/MutationTriage/CommandLineRunner.swift` (usage text, the `switch` in `run`, a new `forget` method)
- Modify: `Tools/CodeQuality/Sources/MutationTriage/RunLoading.swift` (two new `TriageError` cases and their descriptions)
- Modify: `docs/mutation-survivors.json` and `docs/mutation-testing.md` (through the tool, in the last steps)
- Modify: `.claude/skills/mutation-triage/SKILL.md` (one paragraph under "Periodically: re-check old verdicts")

**Interfaces:**
- Consumes: `Ledger`, `LedgerRecord`, `TriageError`, `Mutator.mutants(forSource:path:)`, `MutantFingerprint.fingerprints(for:source:)`.
- Produces:
  - `public enum Forgetting { public static func apply(_ fingerprints: [String], to ledger: Ledger, root: String) throws -> (ledger: Ledger, lines: [String]) }`
  - `TriageError.unknownFingerprint(String)` and `TriageError.stillLive(String)`
  - the command `mutation-triage forget <fingerprint>... [--ledger <path>]`

- [x] **Step 1: Write the failing tests**

Create `Tools/CodeQuality/Tests/MutationTriageTests/ForgettingTests.swift`:

```swift
import Foundation
import MutationCore
@testable import MutationTriage
import Testing

/// A verdict is an argument about one line. When the line is gone the argument
/// has nothing left to be about, and keeping it makes the ledger describe code
/// that does not exist. Forgetting is the only way a record leaves the ledger,
/// so it has to refuse anything that still matches a live mutant: that would
/// be deleting an investigation, not tidying up after a deleted line.
@Suite(.serialized) struct ForgettingTests {
    private let path = "Sources/FieldmarkCore/Discovery/A.swift"

    /// A scratch repo root, holding one source file unless `contents` is nil.
    private func makeRoot(_ contents: String?) throws -> String {
        let root = FileManager.default.temporaryDirectory
            .appending(path: "mutation-forget-tests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        if let contents {
            let file = root.appending(path: path)
            try FileManager.default.createDirectory(
                at: file.deletingLastPathComponent(), withIntermediateDirectories: true
            )
            try Data(contents.utf8).write(to: file)
        }
        return root.path
    }

    private func record(_ fingerprint: String, line: Int = 2) -> LedgerRecord {
        LedgerRecord(
            fingerprint: fingerprint,
            file: path,
            rule: "RelationalLtToLe",
            change: "< → <=",
            lineAtInvestigation: line,
            sourceLine: "if a < b { return }",
            verdict: .equivalent,
            investigatedOn: "2026-09-04",
            reason: "both sides agree at the boundary",
            hardening: "nothing can tell them apart",
            tests: []
        )
    }

    /// The fingerprint the tree gives the `<` on line 2 of `source`.
    private func liveFingerprint(in source: String) throws -> String {
        let live = MutantFingerprint.fingerprints(
            for: Mutator.mutants(forSource: source, path: path), source: source
        )
        return try #require(live.first { $0.mutant.ruleID == "RelationalLtToLe" }).fingerprint
    }

    @Test func aVerdictWhoseLineIsGoneIsRemovedAndTheRestStay() throws {
        let root = try makeRoot("func f() {\n    return\n}\n")
        let ledger = Ledger(records: [record("aaaaaaaaaaaa"), record("bbbbbbbbbbbb", line: 9)])

        let result = try Forgetting.apply(["aaaaaaaaaaaa"], to: ledger, root: root)

        #expect(result.ledger.records.map(\.fingerprint) == ["bbbbbbbbbbbb"])
        #expect(result.lines.count == 1)
        #expect(result.lines[0].contains("aaaaaaaaaaaa"))
        #expect(result.lines[0].contains("equivalent"))
    }

    /// The refusal that makes the command safe to hand to anyone.
    @Test func aVerdictThatStillMatchesALiveMutantIsRefused() throws {
        let source = "func f() {\n    if a < b { return }\n}\n"
        let root = try makeRoot(source)
        let live = try liveFingerprint(in: source)
        let ledger = Ledger(records: [record(live)])

        #expect(throws: TriageError.self) {
            _ = try Forgetting.apply([live], to: ledger, root: root)
        }
    }

    @Test func aFingerprintTheLedgerDoesNotHoldIsRefused() throws {
        let root = try makeRoot("func f() {}\n")
        #expect(throws: TriageError.self) {
            _ = try Forgetting.apply(["cccccccccccc"], to: Ledger(), root: root)
        }
    }

    /// A whole file can be deleted, and its verdicts go with it.
    @Test func aVerdictWhoseFileIsGoneCanBeForgotten() throws {
        let root = try makeRoot(nil)
        let ledger = Ledger(records: [record("aaaaaaaaaaaa")])

        let result = try Forgetting.apply(["aaaaaaaaaaaa"], to: ledger, root: root)

        #expect(result.ledger.records.isEmpty)
    }

    /// One bad fingerprint must not leave the ledger half tidied, the same rule
    /// `record --stdin` follows.
    @Test func oneRefusalMeansNothingIsForgotten() throws {
        let source = "func f() {\n    if a < b { return }\n}\n"
        let root = try makeRoot(source)
        let live = try liveFingerprint(in: source)
        let ledger = Ledger(records: [record("aaaaaaaaaaaa", line: 40), record(live)])

        #expect(throws: TriageError.self) {
            _ = try Forgetting.apply(["aaaaaaaaaaaa", live], to: ledger, root: root)
        }
    }

    @Test func theCommandWritesTheLedgerAndSaysWhatItForgot() throws {
        let root = try makeRoot("func f() {\n    return\n}\n")
        let ledgerPath = root + "/ledger.json"
        try Ledger(records: [record("aaaaaaaaaaaa")]).write(to: ledgerPath)
        var printed: [String] = []
        let runner = CommandLineRunner(root: root, output: { printed.append($0) }, errorOutput: { _ in })

        let code = runner.run(["forget", "aaaaaaaaaaaa", "--ledger", ledgerPath])

        #expect(code == 0)
        #expect(try Ledger.read(from: ledgerPath).records.isEmpty)
        #expect(printed.contains { $0.contains("aaaaaaaaaaaa") })
    }

    @Test func theCommandWithNothingToForgetIsAUsageError() throws {
        let root = try makeRoot("func f() {}\n")
        let runner = CommandLineRunner(root: root, output: { _ in }, errorOutput: { _ in })
        #expect(runner.run(["forget"]) == 2)
    }
}
```

- [x] **Step 2: Run them and see them fail**

Run: `swift test --package-path Tools/CodeQuality --disable-sandbox --filter ForgettingTests`
Expected: a compile failure, `cannot find 'Forgetting' in scope`.

- [x] **Step 3: Add the two errors**

In `Tools/CodeQuality/Sources/MutationTriage/RunLoading.swift`, add two cases to `TriageError`:

```swift
    case unknownFingerprint(String)
    case stillLive(String)
```

and their descriptions in the `description` switch:

```swift
        case let .unknownFingerprint(fingerprint):
            "The ledger holds no verdict filed under \(fingerprint)."
        case let .stillLive(detail):
            """
            \(detail)
            That verdict still matches a mutant in the tree, so it is an investigation, not a leftover.
            To change it, record a new verdict over it.
            """
```

- [x] **Step 4: Write `Forgetting`**

Create `Tools/CodeQuality/Sources/MutationTriage/Forgetting.swift`:

```swift
import Foundation
import MutationCore

/// Removes verdicts whose mutant no longer exists.
///
/// A verdict is filed under a hash of its line, so a deleted or rewritten line
/// leaves its verdict matching nothing, and `status` calls it stale for ever.
/// This is the only way a record leaves the ledger, which is why it refuses a
/// verdict that still matches a live mutant: that one is somebody's
/// investigation, and the way to change it is to record over it.
public enum Forgetting {
    /// Every fingerprint is checked before any is removed, so a batch is
    /// all-or-nothing, the same rule `Recording.apply` follows.
    public static func apply(
        _ fingerprints: [String],
        to ledger: Ledger,
        root: String
    ) throws -> (ledger: Ledger, lines: [String]) {
        var lines: [String] = []
        for fingerprint in fingerprints {
            guard let record = ledger[fingerprint] else {
                throw TriageError.unknownFingerprint(fingerprint)
            }
            if let line = liveLine(of: fingerprint, inFile: record.file, root: root) {
                throw TriageError.stillLive("\(fingerprint) is live at \(record.file):\(line).")
            }
            lines.append(
                "forgot \(fingerprint)  \(record.file):\(record.lineAtInvestigation)  "
                    + "\(record.verdict.rawValue)  (\(record.change))"
            )
        }
        var updated = ledger
        updated.records.removeAll { fingerprints.contains($0.fingerprint) }
        return (updated, lines)
    }

    /// The line a fingerprint sits on in the tree as it stands, or nil when no
    /// mutant carries it. A file that is gone has no mutants.
    private static func liveLine(of fingerprint: String, inFile file: String, root: String) -> Int? {
        let url = URL(filePath: root).appending(path: file)
        guard let source = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        let live = MutantFingerprint.fingerprints(
            for: Mutator.mutants(forSource: source, path: file), source: source
        )
        return live.first { $0.fingerprint == fingerprint }?.mutant.line
    }
}
```

- [x] **Step 5: Wire the command in**

In `Tools/CodeQuality/Sources/MutationTriage/CommandLineRunner.swift`:

Add a line to the `usage` text, after the `record` line:

```
      forget <fingerprint>…                      drop verdicts whose mutant no longer exists
```

Add a case to the `switch` in `run(_:)`:

```swift
            case "forget": return try forget(args)
```

Add the method next to `record(_:)`:

```swift
    func forget(_ args: Arguments) throws -> Int32 {
        guard !args.positional.isEmpty else {
            errorOutput("forget needs at least one fingerprint.")
            return 2
        }
        let path = absolutePath(args.value("ledger") ?? Ledger.defaultPath)
        let applied = try Forgetting.apply(args.positional, to: Ledger.read(from: path), root: root)
        applied.lines.forEach(output)
        try applied.ledger.write(to: path)
        output("Ledger now holds \(applied.ledger.records.count) verdict(s). Run `render` to refresh the doc.")
        return 0
    }
```

If adding the method pushes `CommandLineRunner.swift` past SwiftLint's 400 line warning, move `forget(_:)` into an extension in `Forgetting.swift` instead.

- [x] **Step 6: Run the tests and see them pass**

Run: `swift test --package-path Tools/CodeQuality --disable-sandbox`
Expected: every suite passes, including the seven new tests.

- [x] **Step 7: Lint, rebuild, commit**

```bash
./Scripts/lint.sh
swift test --package-path Tools/CodeQuality --disable-sandbox
git add Tools/CodeQuality/Sources/MutationTriage/Forgetting.swift \
        Tools/CodeQuality/Sources/MutationTriage/CommandLineRunner.swift \
        Tools/CodeQuality/Sources/MutationTriage/RunLoading.swift \
        Tools/CodeQuality/Tests/MutationTriageTests/ForgettingTests.swift
git commit -m "feat(mutation): forget a verdict whose mutant no longer exists"
```

(Use the `house-style:how-to-commit` skill for the body and add the usual trailer.)

- [x] **Step 8: See the refusal work on the real ledger**

Pick any fingerprint from `docs/mutation-survivors.json` whose line still exists (for example the first record) and run `./Scripts/mutate-triage.sh forget <that fingerprint>`.
Expected: exit 2, the "still matches a mutant in the tree" message, and `git status --short docs` empty.

- [x] **Step 9: File the deadline check's verdict under its new line, then retire the three leftovers**

The deadline check that `18aee78c745d` was about is now on the line `if clock.now - started >= budget.deadline { return .deadlineReached }` in `Sources/FieldmarkCore/Agent/AgentRunner.swift` (line 178 on 2026-09-17; find it with `grep -n "budget.deadline" Sources/FieldmarkCore/Agent/AgentRunner.swift`, there are two such lines and this is the one inside the turn loop that returns `.deadlineReached`). Copy the `reason`, `hardening` and `tests` of the old record (`grep -n -A12 '"fingerprint" : "18aee78c745d"' docs/mutation-survivors.json`) into a new verdict. If Task 10 has already been done, name the test that kills the mutant now (check by hand-applying `>=` to `>` on that line and running `AgentRunnerDeadlineTests`), not the one the old record names.

```bash
./Scripts/mutate-triage.sh record \
  --file Sources/FieldmarkCore/Agent/AgentRunner.swift --line <that line> --rule RelationalGeToGt \
  --verdict hardened \
  --reason "<the old record's reason>" \
  --hardening "<the old record's hardening, corrected if Task 10 changed the test>" \
  --test "<Tests/FieldmarkCoreTests/AgentRunnerDeadlineTests.swift::the test that kills it>"
./Scripts/mutate-triage.sh forget 18aee78c745d 8c4c88b75f71 a23bf81e5603
./Scripts/mutate-triage.sh render
```

Expected: three `forgot …` lines, and the ledger count goes down by two overall (one added, three removed). If `forget` refuses one of the three, that fingerprint is live again: read the message, leave that record alone, and say so in the commit body.

- [x] **Step 10: Say how to use it in the skill, and commit**

In `.claude/skills/mutation-triage/SKILL.md`, find the **Stale** bullet at the end of the file. It ends with "Re-investigate." Append these sentences to that bullet, wrapped like the lines around it:

```markdown
  If the line was rewritten, record a verdict on the new line; if it was deleted, there is
  nothing left to investigate. Either way retire the old record with
  `./Scripts/mutate-triage.sh forget <fingerprint>`, which refuses any verdict that still
  matches a live mutant.
```

```bash
git add docs/mutation-survivors.json docs/mutation-testing.md .claude/skills/mutation-triage/SKILL.md
git commit -m "docs(mutation): retire three verdicts whose lines are gone"
```

---

## What was left out, and why

- **The event stream.** `swift test --experimental-event-stream-output <path>` works on this toolchain and would give richer data. It is experimental, it writes 11 KB where the xunit file writes 900 bytes, and everything the confirmation needs is in the xunit file. If the xunit format ever changes, the event stream is the fallback.
- **Running the likely killer first.** The spec rules it out for now. The confirmation step in Task 4 already learns which tests failed, so recording them in the run file is the first step whenever that gets picked up.
- **Sharing one seed across every `SeedLibraryScriptTests` test.** One library at `--extra 2` would satisfy all five tests' assertions and save another 0.06 s, but it would stop the script ever being run with no argument and with `1`. Three libraries costs almost nothing and keeps all three argument paths covered.
- **A single shared tree scan in `RepoLanguageTests`.** The three whole-tree tests each read all 965 tracked files. Measured, the second and third scans cost 0.092 s and 0.045 s, because the reads are warm and those two tests do almost no work per file. The per-file word filter in Task 8 is where the time was.
