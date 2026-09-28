# Mutant switching: one build for every mutant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop rebuilding the module once per mutant. Write one copy of `FieldmarkCore` in which every mutation site carries both versions, choose between them with a number read from the environment, build that once, and test mutant 412 by running the suite with `FIELDMARK_ACTIVE_MUTANT=412`.

**Architecture:** A new instrumenter in `MutationCore` turns a source file into a copy where each mutated site's enclosing body is written once per mutant inside a `switch __MutantSwitch.active`. A sandbox builder writes two throwaway packages under `.build/`: an instrumented one for the mutants that can be switched, and a plain one for the few that cannot. A prune loop compiles the instrumented package, blames each error on a mutant or on a container, drops what will not build, and repeats. The runner then walks the plan, sets the environment variable, and reuses the Part 1 test runner and its kill confirmation unchanged. The old path survives behind `--legacy` and stays the default until the last task of this plan, which flips it after a full run has been proved to give the same answers.

**Tech Stack:** Swift 6.3.1 (Xcode 26.4.1), swift-syntax 603, Swift Package Manager, Swift Testing, bash. macOS only.

**Spec:** `docs/superpowers/specs/2026-09-17-faster-mutation-runs-design.md`, part 2 and the "Spike findings (2026-09-17)" section at the end.

**Depends on:** `docs/superpowers/plans/2026-09-17-mutation-runner-quick-wins.md` must be finished first. This plan uses its types by name: `TestCommand`, `TestReport`, `XUnitReport`, `SuiteRun`, `KillConfirmation`, `RunnerArguments`, `MutantSelection`, `RunMerging`, `ProcessTree`, and the `mutation-runner` file `TestRunning.swift`.

## Global Constraints

- Swift and bash only. `Tests/FieldmarkCoreTests/RepoLanguageTests.swift` scans every tracked Swift and shell file for the names of other interpreters, even inside string literals and comments, so neither code nor comments may mention them.
- `./Scripts/lint.sh` runs swiftformat, which rewrites files in site. Its `preferKeyPath` and `hoistTry` rules can break `#expect(...)` lines. After linting, rebuild and re-run the tests before committing.
- SwiftLint warns at 400 lines per file and errors at 1000. New code goes in new files.
- **Fingerprints do not change, and the ledger is not touched.** This plan does not modify `Sources/MutationCore/Mutator.swift` or `Sources/MutationCore/Fingerprint.swift`, and does not modify `docs/mutation-survivors.json`. The planner still enumerates mutants from the real working tree and still hashes file, rule, token change, normalised line text and occurrence. Only the executor changes: where the mutated code is compiled and how it is selected. Task 11 has a step that checks those two files are untouched.
- Verdict meanings do not change. Survived means the whole suite passed. Killed means a test failed, or the suite hung or crashed. Compile error means the mutant does not compile.
- The run JSON keeps its shape, its field names and its order. A run file from this runner must still merge with one from the old runner.
- A type-check timeout is never recorded as `compile_error`. It is a statement about the machine, not about the mutant.
- The working tree is never edited by a switched run. The old path still edits a file, but only inside the sandbox's plain copy, never in `Sources/`.
- Every task ends with the package's tests passing and one commit. For the message, invoke the `house-style:how-to-commit` skill, and end the message with the line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Stage explicit paths. Never `git add -A`, never `git stash`.
- Never build or run tests in a checkout where another mutation run is going.

---

## Facts this plan was built on

A throwaway spike ran the whole design over `FieldmarkCore` on 2026-09-17. Its sources are kept at
`/tmp/agent-scratch/spike-code/`
for reference. Do not copy them: they take shortcuts this plan does not. The numbers below are
what they produced.

| Question | Answer |
| --- | --- |
| Sites whose container is a body (rule 1) | 1,578 of 1,697, 93.0% |
| Sites whose container is an initial-value expression (rule 2) | 115, 6.8% |
| Sites with no container (rule 3) | 4, 0.2% |
| Instrumented module | 14,213 lines becomes 42,875, a factor of 3.0 |
| Largest instrumented file | `Mail/MimeParser+Decoding.swift`, 329 lines becomes 2,768 |
| Largest single body | 40 mutants, so 41 copies |
| Cold build with tests | 53.1 s instrumented against 43.8 s plain, 1.21x |
| Incremental rebuild, one file changed | 13.7 s instrumented against 1.9 s plain, 7.3x |
| Suite one test at a time | 5.871 s instrumented against 5.412 s plain, 1.08x |
| Unmutated suite | passes, 2,043 tests in 185 suites, the same as plain |
| Prune loop | converged in 7 rounds, about 90 s |
| After pruning | 1,626 switched, 71 on the old path |
| Verdicts compared with the old path | 175 mutants run both ways, 175 agree |
| Compile errors compared with the old path | 34 and 34 in the judged range, identical sets |

Five things the spike settled that the code below depends on:

1. Rule 1 in this repo is 1,410 function bodies, 96 short-form getters (`var x: Int { ... }`) and
   72 initializer bodies. No deinitializer, explicit accessor or subscript holds a mutant today.
   Rule 2 is 87 property initial values and 28 parameter defaults.
2. The four rule 3 sites are one enum raw value and **three operator declaration names**:
   `static func == (…)`, `static func + (…)` and `static func < (…)`. The mutation rules read the
   operator being declared as a binary operator. Those tokens have no enclosing body, so they fall
   out as rule 3 on their own, but the code has to name the case or a reader will call it a bug.
3. **Rule 2 is a closure holding a switch, not a chain of ternaries.** With ternaries, three
   containers (`Discovery/ChainSites.swift`, `Airports/AirportCatalog.swift`,
   `Models/PinColorScheme.swift`) made the type checker give up with "unable to type-check this
   expression in reasonable time". A chain makes one expression k + 1 times the size; a closure
   makes each copy its own `return` statement. With the closure the three compile, 1,626 mutants
   switch instead of 1,618, and the compile-error set matches the old path exactly.
4. **An error can be reported on a line inside no copy.** A copy that can fall off the end of the
   body is blamed on the closing brace of the whole declaration, which names no case. In this repo
   it is `BoolFlip` turning `while true` into `while false`, in the only two `while true` loops
   Core has (`Persistence/Slug.swift` and `Persistence/SiteStore+Images.swift`). Those two
   containers, 16 mutants, go down the old path.
5. **The old path must not run inside the instrumented sandbox.** One file changing costs 13.7 s
   there against 1.9 s in a plain package, because emitting a module three times the size and
   linking it cost that much more every time. Seventy mutants at 13.7 s is twenty minutes.

Two more facts about the sandbox, checked by running it:

- `Tools/CoreMutation` sits two directories below the checkout root and its root symlinks point at
  `../../<name>`. `.build/mutation-sandbox` is also two directories down, so the same relative
  targets work unchanged. Tests that look for the checkout walk up to a directory holding both
  `Package.swift` and `.git`; from inside `.build/` that is the real checkout, and all 2,043 tests
  passed there.
- No file in `Sources/FieldmarkCore` uses `#filePath`, `#fileID` or `#line`, and no test reads the
  text of `Sources/FieldmarkCore`, so the sandbox's different path cannot change behaviour. If either
  ever becomes untrue, this design has to be re-checked.

---

## File Structure

New files in `Tools/CodeQuality/Sources/MutationCore/`:

- `MutationContainer.swift`: which container a site's switching goes in. Pure, one public entry point.
- `Instrumenter.swift`: source text to instrumented source text, plus the line maps. Pure.
- `CompilerErrors.swift`: parsing `swift build` output and blaming each error on a mutant or a container. Pure.
- `SandboxLayout.swift`: the paths, the manifests and the lock file text. Pure except for the lock.
- `SwitchPlan.swift`: turning the plan into numbers, and back from a number to a fingerprint.

New files in `Tools/CodeQuality/Sources/mutation-runner/`:

- `Sandbox.swift`: writing the two packages to disk, taking the test snapshot, holding the lock.
- `Pruning.swift`: the compile, blame, drop, repeat loop.
- `Switching.swift`: running one switched mutant, and the run order.

New files in `Tools/CodeQuality/Sources/MutationTriage/`:

- `Comparing.swift`: `compare <run A> <run B>`.

New test files:

- `Tools/CodeQuality/Tests/MutationCoreTests/MutationContainerTests.swift`
- `Tools/CodeQuality/Tests/MutationCoreTests/InstrumenterTests.swift`
- `Tools/CodeQuality/Tests/MutationCoreTests/CompilerErrorsTests.swift`
- `Tools/CodeQuality/Tests/MutationCoreTests/SandboxLayoutTests.swift`
- `Tools/CodeQuality/Tests/MutationCoreTests/SwitchPlanTests.swift`
- `Tools/CodeQuality/Tests/MutationTriageTests/ComparingTests.swift`

Modified:

- `Tools/CodeQuality/Sources/MutationCore/RunnerArguments.swift`: `--switched`, `--legacy`, `--jobs` is not here (that is part 3).
- `Tools/CodeQuality/Sources/mutation-runner/TestRunning.swift`: the package to test and the environment to test it with become arguments.
- `Tools/CodeQuality/Sources/mutation-runner/Support.swift`: `runSwift` takes extra environment.
- `Tools/CodeQuality/Sources/mutation-runner/main.swift`: picks the path, prints the counts.
- `Tools/CodeQuality/Sources/MutationTriage/CommandLineRunner.swift`: the `compare` command.
- `docs/mutation-testing.md`, `.claude/skills/mutation-triage/SKILL.md`: last task.

---

### Task 1: Decide which container a site belongs to

Everything else depends on this being right. A site in the wrong container is a mutant that either
will not compile or, worse, compiles and means something different.

**Files:**
- Create: `Tools/CodeQuality/Sources/MutationCore/MutationContainer.swift`
- Create: `Tools/CodeQuality/Tests/MutationCoreTests/MutationContainerTests.swift`

**Interfaces:**
- Consumes: `Mutator`, `MutationSite` and `SiteCollector` (already in `MutationCore`, internal).
- Produces:
  - `public enum ContainerKind: String, Sendable, Equatable` with cases `functionBody`, `initializerBody`, `deinitializerBody`, `accessorBody`, `subscriptBody`, `shorthandGetter`, `propertyInitialValue`, `parameterDefault`, `none`, and `public var isBody: Bool`.
  - `public struct SiteContainer: Equatable, Sendable` with `public let line: Int`, `public let column: Int`, `public let ruleID: String`, `public let kind: ContainerKind`, `public let range: Range<Int>?`.
  - `public enum MutationContainers` with `public static func sites(forSource source: String, path: String) -> [SiteContainer]`.

- [x] **Step 1: Write the failing tests**

> **Deviation (2026-09-17).** The fixtures below are right; most of the expected
> arrays were not. The plan counted one site per fixture, but `Mutator` finds one
> site per mutable *token*, so `n + 1` is two (the operator and the literal) and
> the `#if` fixture is six (three per branch, because the parser keeps both).
> Measured with the shipped `Mutator` before writing the expectations:
> function body 2, closure-in-function 2, local function 3, initializer 2,
> deinitializer 3 (`static var count = 0` is a site of its own), getter+setter 5,
> short getter 3, subscript 2, stored property 3, `lazy var` 3,
> closure-in-initial-value 4, parameter default 3, enum raw value 1, operator
> name 2, `#if` 6. The expectations as written are those counts. Three tests were
> added: `aLocalFunctionInsideAnInitialValueIsItsOwnContainer` (it pins the
> nested-container case Task 2 has to refuse to splice), `sitesComeBackInPlanOrder`
> and `aSiteWithNoContainerHasNoRange`. The comment on the operator-declaration
> test said "the two inside the body"; there is one.

Create `Tools/CodeQuality/Tests/MutationCoreTests/MutationContainerTests.swift`:

```swift
import MutationCore
import Testing

/// Which piece of code gets copied once per mutant. Three rules, in order: the
/// outermost enclosing body, then the whole initial value of a property or a
/// parameter default, then nothing at all. A site put in the wrong one is a
/// mutant that will not compile, or one that compiles and means something else.
///
/// The fixtures cover the kinds `FieldmarkCore` has today and the kinds it does
/// not, so the rules are pinned before somebody writes the first subscript.
@Suite(.serialized) struct MutationContainerTests {
    private func kinds(_ source: String) -> [ContainerKind] {
        MutationContainers.sites(forSource: source, path: "Fixture.swift").map(\.kind)
    }

    @Test func aFunctionBodyIsTheContainer() {
        #expect(kinds("func f(_ a: Int) -> Bool { a > 1 }") == [.functionBody, .functionBody])
    }

    /// Outermost, so a closure inside a function body does not start a second
    /// switch inside the first. Nesting them would multiply the copies.
    @Test func aClosureInsideAFunctionBelongsToTheFunction() {
        let source = """
        func f(_ items: [Int]) -> [Int] {
            items.filter { $0 > 1 }
        }
        """
        #expect(kinds(source) == [.functionBody])
    }

    /// Same reason: a local function is not its own container.
    @Test func aLocalFunctionBelongsToTheFunctionAroundIt() {
        let source = """
        func outer() -> Int {
            func inner() -> Int { 1 + 1 }
            return inner()
        }
        """
        #expect(kinds(source) == [.functionBody])
    }

    @Test func anInitializerBodyIsAContainer() {
        let source = """
        struct S {
            var n: Int
            init(_ n: Int) { self.n = n + 1 }
        }
        """
        #expect(kinds(source) == [.initializerBody])
    }

    @Test func aDeinitializerBodyIsAContainer() {
        let source = """
        final class C {
            static var count = 0
            deinit { C.count = C.count - 1 }
        }
        """
        #expect(kinds(source) == [.deinitializerBody])
    }

    @Test func anExplicitGetterAndSetterAreEachTheirOwnContainer() {
        let source = """
        struct S {
            var stored = 0
            var n: Int {
                get { stored + 1 }
                set { stored = newValue - 1 }
            }
        }
        """
        #expect(kinds(source) == [.propertyInitialValue, .accessorBody, .accessorBody])
    }

    @Test func aShortFormGetterIsAContainer() {
        let source = """
        struct S {
            var stored = 0
            var n: Int { stored + 1 }
        }
        """
        #expect(kinds(source) == [.propertyInitialValue, .shorthandGetter])
    }

    @Test func aSubscriptIsAContainer() {
        let source = """
        struct S {
            subscript(i: Int) -> Int { i + 1 }
        }
        """
        #expect(kinds(source) == [.subscriptBody])
    }

    @Test func aStoredPropertysInitialValueIsAContainer() {
        #expect(kinds("struct S { static let n = 1 + 2 }") == [.propertyInitialValue])
    }

    /// A `lazy var` is a stored property, so its initial value is the container
    /// like any other. It may mention `self`, which a closure applied on the
    /// spot still allows.
    @Test func aLazyVarInitialValueIsAContainer() {
        let source = """
        final class C {
            var base = 1
            lazy var derived: Int = base + 1
        }
        """
        #expect(kinds(source) == [.propertyInitialValue, .propertyInitialValue])
    }

    /// A closure inside a property's initial value has no function body above
    /// it, so the whole initial value is the container.
    @Test func aClosureInsideAPropertyInitialValueBelongsToTheInitialValue() {
        let source = """
        struct S {
            static let doubled: [Int] = [1, 2].map { $0 * 2 }
        }
        """
        #expect(kinds(source) == [.propertyInitialValue])
    }

    @Test func aParameterDefaultIsAContainer() {
        #expect(kinds("func f(limit: Int = 4 + 1) {}") == [.parameterDefault])
    }

    /// An enum raw value has nowhere to put a switch, so it takes the old path.
    @Test func anEnumRawValueHasNoContainer() {
        let source = """
        enum E: Int {
            case only = 1
        }
        """
        #expect(kinds(source) == [.none])
    }

    /// The name of an operator declaration reads as a binary operator to the
    /// mutation rules, which offer to rename the function. There is no body
    /// around the name, so it has no container either. Three of these exist in
    /// `FieldmarkCore`.
    @Test func theNameOfAnOperatorDeclarationHasNoContainer() {
        let source = """
        struct S: Equatable {
            let n: Int
            static func == (lhs: S, rhs: S) -> Bool { lhs.n == rhs.n }
        }
        """
        // The declaration's own `==`, then the two inside the body.
        #expect(kinds(source) == [.none, .functionBody])
    }

    /// A conditional block inside a body copies with the rest of it.
    @Test func aConditionalBlockInsideABodyBelongsToTheBody() {
        let source = """
        func f() -> Int {
            #if DEBUG
            return 1 + 1
            #else
            return 2 + 2
            #endif
        }
        """
        #expect(kinds(source) == [.functionBody, .functionBody])
    }

    /// The range is what the instrumenter replaces, so it has to be the
    /// statements and not the braces around them.
    @Test func theRangeCoversTheStatementsAndNotTheBraces() throws {
        let source = "func f() -> Int { 1 + 1 }"
        let site = try #require(MutationContainers.sites(forSource: source, path: "F.swift").first)
        let range = try #require(site.range)
        // The range is in UTF-8 bytes, because that is what SwiftSyntax counts
        // in and what the instrumenter splices with.
        let bytes = Array(source.utf8)[range]
        #expect(String(decoding: bytes, as: UTF8.self) == "1 + 1")
    }
}
```

- [x] **Step 2: Run the tests and watch them fail**

```bash
swift test --package-path Tools/CodeQuality --disable-sandbox --filter MutationContainerTests
```

Expected: the build fails with `cannot find 'MutationContainers' in scope`. (Seen, along
with `cannot find 'ContainerKind' in scope` from the same missing file.)

- [x] **Step 3: Write the implementation**

> **Deviation (2026-09-17).** Split into three helpers — `tokensByIdentifier(of:)`,
> `planOrder(_:)` and `bodyKind(of:)` — because the first two are wanted verbatim by
> the instrumenter in Task 2 and the body walk on its own was over SwiftLint's
> cyclomatic-complexity limit. The behaviour is the plan's, one branch at a time.

Create `Tools/CodeQuality/Sources/MutationCore/MutationContainer.swift`:

```swift
import Foundation
import SwiftParser
import SwiftSyntax

/// The piece of code a mutant's switching is written into.
public enum ContainerKind: String, Sendable, Equatable {
    case functionBody
    case initializerBody
    case deinitializerBody
    case accessorBody
    case subscriptBody
    /// `var x: Int { ... }` with no `get` written out.
    case shorthandGetter
    case propertyInitialValue
    case parameterDefault
    /// Nothing encloses this site that a switch can go in. It takes the old
    /// path: an enum raw value, the name of an operator declaration, an
    /// attribute argument, a compilation condition.
    case none

    /// True when the container is a list of statements, false when it is a
    /// single expression, which are written out differently.
    public var isBody: Bool {
        switch self {
        case .functionBody, .initializerBody, .deinitializerBody, .accessorBody,
             .subscriptBody, .shorthandGetter:
            true
        case .propertyInitialValue, .parameterDefault, .none:
            false
        }
    }
}

/// One mutation site and the container its switching goes in.
public struct SiteContainer: Equatable, Sendable {
    public let line: Int
    public let column: Int
    public let ruleID: String
    public let kind: ContainerKind
    /// Byte offsets into the source of the text the instrumenter replaces:
    /// the statements of a body, or the whole expression. `nil` for `.none`.
    public let range: Range<Int>?

    public init(line: Int, column: Int, ruleID: String, kind: ContainerKind, range: Range<Int>?) {
        self.line = line
        self.column = column
        self.ruleID = ruleID
        self.kind = kind
        self.range = range
    }
}

/// Works out, for every mutation site in a file, where its switching goes.
public enum MutationContainers {
    /// Every site in `source`, in plan order, with its container.
    ///
    /// Plan order is the runner's order: line, then column, then rule. The
    /// numbering depends on it, and so does every fingerprint.
    public static func sites(forSource source: String, path: String) -> [SiteContainer] {
        let tree = Parser.parse(source: source)
        let converter = SourceLocationConverter(fileName: path, tree: tree)
        let collector = SiteCollector(converter: converter)
        collector.walk(tree)

        var tokens: [SyntaxIdentifier: TokenSyntax] = [:]
        for token in tree.tokens(viewMode: .sourceAccurate) { tokens[token.id] = token }

        let ordered = collector.sites.sorted { lhs, rhs in
            if lhs.line != rhs.line { return lhs.line < rhs.line }
            if lhs.column != rhs.column { return lhs.column < rhs.column }
            return lhs.ruleID < rhs.ruleID
        }

        return ordered.map { site in
            guard let token = tokens[site.tokenID], let found = container(around: token) else {
                return SiteContainer(
                    line: site.line, column: site.column, ruleID: site.ruleID, kind: .none, range: nil
                )
            }
            return SiteContainer(
                line: site.line,
                column: site.column,
                ruleID: site.ruleID,
                kind: found.kind,
                range: found.node.positionAfterSkippingLeadingTrivia.utf8Offset
                    ..< found.node.endPositionBeforeTrailingTrivia.utf8Offset
            )
        }
    }

    /// The container for one token, or `nil` when nothing encloses it.
    ///
    /// Walks all the way to the top rather than stopping at the first body it
    /// meets, because rule 1 wants the *outermost* one: a closure or a local
    /// function inside a body must not start a switch of its own, or the copies
    /// multiply. Rule 2 is only consulted when the whole walk found no body.
    static func container(around token: TokenSyntax) -> (kind: ContainerKind, node: Syntax)? {
        var body: (ContainerKind, Syntax)?
        var expression: (ContainerKind, Syntax)?
        var node: Syntax? = Syntax(token)

        while let current = node {
            if let block = current.as(CodeBlockSyntax.self), let parent = block.parent {
                if parent.is(FunctionDeclSyntax.self) { body = (.functionBody, Syntax(block.statements)) }
                if parent.is(InitializerDeclSyntax.self) { body = (.initializerBody, Syntax(block.statements)) }
                if parent.is(DeinitializerDeclSyntax.self) {
                    body = (.deinitializerBody, Syntax(block.statements))
                }
                if parent.is(AccessorDeclSyntax.self) { body = (.accessorBody, Syntax(block.statements)) }
            }
            if let accessors = current.as(AccessorBlockSyntax.self),
               case let .getter(items) = accessors.accessors {
                let inSubscript = accessors.parent?.is(SubscriptDeclSyntax.self) == true
                body = (inSubscript ? .subscriptBody : .shorthandGetter, Syntax(items))
            }
            if expression == nil, let binding = current.as(PatternBindingSyntax.self),
               let value = binding.initializer?.value {
                expression = (.propertyInitialValue, Syntax(value))
            }
            if expression == nil, let parameter = current.as(FunctionParameterSyntax.self),
               let value = parameter.defaultValue?.value {
                expression = (.parameterDefault, Syntax(value))
            }
            node = current.parent
        }

        if let body { return (body.0, body.1) }
        if let expression { return (expression.0, expression.1) }
        return nil
    }
}
```

- [x] **Step 4: Run the tests and watch them pass**

```bash
swift test --package-path Tools/CodeQuality --disable-sandbox --filter MutationContainerTests
```

Expected: `✔ Test run with 16 tests in 1 suite passed`. Got 19, the three extra being the
tests added in step 1.

If `anExplicitGetterAndSetterAreEachTheirOwnContainer` reports `[.propertyInitialValue, .accessorBody, .accessorBody]` in a different order, read the order the sites come out in rather than changing the rule: plan order is line, then column, then rule, and the fixture's `stored = 0` is on an earlier line than the accessors.

- [x] **Step 5: Check it against the real module**

```bash
swift build --package-path Tools/CodeQuality --product mutation-runner --disable-sandbox
```

Expected: `Build of product 'mutation-runner' complete!`. The counts over all of `FieldmarkCore` are checked in Task 3, once the instrumenter can report them.

- [x] **Step 6: Lint, rebuild, commit**

```bash
./Scripts/lint.sh
swift test --package-path Tools/CodeQuality --disable-sandbox
git add Tools/CodeQuality/Sources/MutationCore/MutationContainer.swift \
        Tools/CodeQuality/Tests/MutationCoreTests/MutationContainerTests.swift
git commit
```

---

### Task 2: Write the instrumented source

The container tells you what to copy. This writes the copies out, and records which line belongs
to which mutant so a compiler error can be traced back.

**Files:**
- Create: `Tools/CodeQuality/Sources/MutationCore/Instrumenter.swift`
- Create: `Tools/CodeQuality/Tests/MutationCoreTests/InstrumenterTests.swift`

**Interfaces:**
- Consumes: `MutationContainers`, `ContainerKind` (Task 1), `SiteCollector`, `SingleSiteRewriter` (internal to `MutationCore`).
- Produces:
  - `public struct SiteKey: Hashable, Sendable` with `public let line: Int`, `public let column: Int`, `public let ruleID: String`.
  - `public struct InstrumentedFile: Equatable, Sendable` with `public let text: String`, `public let mutantByLine: [Int: Int]`, `public let containerByLine: [Int: Int]`, `public let switched: [Int]`.
  - `public enum Instrumenter` with
    `public static func instrument(source: String, path: String, numbers: [SiteKey: Int], skip: Set<Int>, droppedContainers: Set<Int>) -> InstrumentedFile`
    and `public static let mutantSwitchSource: String`.

- [x] **Step 1: Write the failing tests**

> **Deviation (2026-09-17).** Same arithmetic as Task 1: the fixtures hold more
> than one site each, so `aBodyIsCopiedOncePerMutantWithTheOriginalLast` expects
> `switched == [1, 2]`, `mutantsSharingAContainerShareOneSwitch` expects
> `[1, 2, 3, 4, 5]`, and `askedToSkipAMutantItLeavesItOut` skips both numbers to
> get a file with no switch at all (skipping only 1 leaves mutant 2 switched,
> which the test now also asserts). `theOutputIsStable` got a fixture with three
> containers, because a one-container file cannot catch an unstable ordering.
> Two tests added: `eachContainerGetsItsOwnSwitch`, and
> `aContainerNestedInsideAnotherIsNotSwitched` for the nesting hole described in
> step 3.

Create `Tools/CodeQuality/Tests/MutationCoreTests/InstrumenterTests.swift`:

```swift
import MutationCore
import Testing

/// Turning a source file into one that holds every mutant at once.
///
/// The assertions are on the text, because the text is what the compiler sees
/// and what a person debugging a strange verdict will read. Each mutant's copy
/// has to be exactly what the old path would have compiled, or the two paths
/// stop meaning the same thing.
@Suite(.serialized) struct InstrumenterTests {
    private func numbers(_ source: String, from start: Int = 1) -> [SiteKey: Int] {
        var out: [SiteKey: Int] = [:]
        for (offset, site) in MutationContainers.sites(forSource: source, path: "F.swift").enumerated() {
            out[SiteKey(line: site.line, column: site.column, ruleID: site.ruleID)] = start + offset
        }
        return out
    }

    private func instrument(_ source: String, skip: Set<Int> = [], dropped: Set<Int> = []) -> InstrumentedFile {
        Instrumenter.instrument(
            source: source,
            path: "F.swift",
            numbers: numbers(source),
            skip: skip,
            droppedContainers: dropped
        )
    }

    /// A body with one mutant is written twice: the mutant, then the original
    /// under `default`.
    @Test func aBodyIsCopiedOncePerMutantWithTheOriginalLast() {
        let result = instrument("func f(_ a: Int) -> Bool {\n    a > 1\n}")
        #expect(result.text.contains("switch __MutantSwitch.active {"))
        #expect(result.text.contains("case 1:"))
        #expect(result.text.contains("a >= 1"))
        #expect(result.text.contains("default:"))
        #expect(result.text.contains("a > 1"))
        #expect(result.switched == [1])
    }

    /// A body that is one expression stays one expression in every copy, so the
    /// implicit return still works. `switch` has been an expression since Swift
    /// 5.9.
    @Test func aSingleExpressionBodyStaysOneExpression() {
        let result = instrument("func f(_ a: Int) -> Int { a + 1 }")
        let switchIndex = result.text.range(of: "switch __MutantSwitch.active")
        #expect(switchIndex != nil)
        #expect(result.text.contains("return") == false, "an implicit return must not gain a `return`")
    }

    /// An initializer body copies like any other. Every copy assigns every
    /// stored property, so definite initialization is satisfied on all paths.
    @Test func anInitializerBodyIsCopiedToo() {
        let source = """
        struct S {
            let n: Int
            init(_ n: Int) { self.n = n + 1 }
        }
        """
        let result = instrument(source)
        #expect(result.text.contains("case 1:"))
        #expect(result.text.contains("self.n = n - 1"))
        #expect(result.text.contains("self.n = n + 1"))
    }

    /// Rule 2 is a closure applied on the spot, not a chain of ternaries. A
    /// chain makes one expression k + 1 times the size and the type checker
    /// gives up on the big ones; a closure makes each copy its own statement.
    @Test func anInitialValueBecomesAClosureNotATernary() {
        let result = instrument("struct S { static let n = 1 + 2 }")
        #expect(result.text.contains("{"))
        #expect(result.text.contains("switch __MutantSwitch.active {"))
        #expect(result.text.contains("return (1 - 2)"))
        #expect(result.text.contains("return (1 + 2)"))
        #expect(result.text.contains("}()"))
        #expect(result.text.contains("?") == false, "rule 2 must not use a ternary")
    }

    /// Two mutants on one line share one container and one switch, in plan
    /// order, so the file does not grow a switch per token.
    @Test func mutantsSharingAContainerShareOneSwitch() {
        let result = instrument("func f(_ a: Int, _ b: Int) -> Bool {\n    a > 1 && b > 2\n}")
        #expect(result.text.components(separatedBy: "switch __MutantSwitch.active").count - 1 == 1)
        #expect(result.switched.count > 1)
        #expect(result.switched == result.switched.sorted())
    }

    /// A site with no container leaves the file alone. It takes the old path.
    @Test func aSiteWithNoContainerIsLeftAsItIs() {
        let source = "enum E: Int {\n    case only = 1\n}"
        let result = instrument(source)
        #expect(result.text == source)
        #expect(result.switched.isEmpty)
    }

    /// A mutant in `skip` is left out, which is how a mutant that will not
    /// compile is dropped between rounds.
    @Test func askedToSkipAMutantItLeavesItOut() {
        let result = instrument("func f(_ a: Int) -> Bool {\n    a > 1\n}", skip: [1])
        #expect(result.text.contains("switch __MutantSwitch.active") == false)
        #expect(result.switched.isEmpty)
    }

    /// A dropped container takes all of its mutants with it, whatever they are.
    @Test func aDroppedContainerIsNotSwitchedAtAll() {
        let source = "func f(_ a: Int) -> Bool {\n    a > 1\n}"
        let container = MutationContainers.sites(forSource: source, path: "F.swift").first?.range?.lowerBound
        let result = instrument(source, dropped: [container ?? -1])
        #expect(result.text == source)
        #expect(result.switched.isEmpty)
    }

    /// The same input gives the same output, byte for byte. The sandbox is kept
    /// between runs and only rewrites a file when the text changed, so an
    /// unstable instrumenter would rebuild the world every time.
    @Test func theOutputIsStable() {
        let source = "func f(_ a: Int, _ b: Int) -> Bool {\n    a > 1 && b > 2\n}"
        #expect(instrument(source).text == instrument(source).text)
    }

    /// Code outside a container keeps its own text exactly, comments and blank
    /// lines included, so the file still reads like the file it came from.
    @Test func everythingOutsideAContainerIsUntouched() {
        let source = """
        // A leading comment.
        import Foundation

        /// Documentation.
        public func f(_ a: Int) -> Bool {
            a > 1
        }
        """
        let result = instrument(source)
        #expect(result.text.hasPrefix("// A leading comment.\nimport Foundation\n\n/// Documentation.\n"))
        #expect(result.text.contains("public func f(_ a: Int) -> Bool {"))
    }

    /// Every line of a copy maps back to its mutant, and the scaffolding maps
    /// to nothing. This is what turns a compiler error into a verdict.
    @Test func everyLineOfACopyMapsBackToItsMutant() {
        let result = instrument("func f(_ a: Int) -> Bool {\n    a > 1\n}")
        let lines = result.text.split(separator: "\n", omittingEmptySubsequences: false)
        let mutantLine = lines.firstIndex { $0.contains("a >= 1") }
        let originalLine = lines.firstIndex { $0.contains("a > 1") && !$0.contains(">=") }
        #expect(result.mutantByLine[(mutantLine ?? 0) + 1] == 1)
        #expect(result.mutantByLine[(originalLine ?? 0) + 1] == 0)
    }

    /// And every line of the replacement knows which container it came from, so
    /// an error that names no case can still be blamed on something.
    @Test func everyLineOfTheReplacementKnowsItsContainer() throws {
        let source = "func f(_ a: Int) -> Bool {\n    a > 1\n}"
        let container = try #require(
            MutationContainers.sites(forSource: source, path: "F.swift").first?.range?.lowerBound
        )
        let result = instrument(source)
        #expect(result.containerByLine.values.contains(container))
    }

    /// The file that reads the number. Public, because a default argument or
    /// something inlinable may end up mentioning it.
    @Test func theSwitchReadsTheNumberFromTheEnvironment() {
        #expect(Instrumenter.mutantSwitchSource.contains("public enum __MutantSwitch"))
        #expect(Instrumenter.mutantSwitchSource.contains("FIELDMARK_ACTIVE_MUTANT"))
        #expect(Instrumenter.mutantSwitchSource.contains("public static let active"))
    }
}
```

- [x] **Step 2: Run the tests and watch them fail**

```bash
swift test --package-path Tools/CodeQuality --disable-sandbox --filter InstrumenterTests
```

Expected: the build fails with `cannot find 'Instrumenter' in scope`. (Seen.)

- [x] **Step 3: Write the implementation**

> **Deviation (2026-09-17), and it is a correctness one.** The plan collected the
> edits and then sorted them by start offset, which is only safe while no two
> containers overlap. Two can: a body is rule 1 wherever it sits, so a local
> function inside a property's initial value is its own container *inside* the
> rule 2 container around it. The plan's splice loop would then have run
> `utf8[cursor ..< edit.start]` with `cursor` past `start` and trapped on the
> reversed range. The edit list is now built in one pass over
> `groups.keys.sorted()`, keeping an edit only when it starts at or after the end
> of the last one kept; the outer container wins and the inner one's mutants fall
> through to the old path. `switched` is collected from the edits that survive,
> not from every site, so a dropped container's mutants are never claimed.
> `FieldmarkCore` has no such nesting today, which is why the spike never hit it.
>
> Otherwise: `instrument` is split into `groups`, `editList`, `splice`,
> `mutantsByLine` and `decoded` for the complexity budget; the token map and the
> plan-order sort are reused from `MutationContainers` rather than written twice;
> and `decoded` carries the one `swiftlint:disable` for
> `optional_data_string_conversion`, which fires on `String(decoding:as:)` even
> for an `ArraySlice<UInt8>`.

Create `Tools/CodeQuality/Sources/MutationCore/Instrumenter.swift`:

```swift
import Foundation
import SwiftParser
import SwiftSyntax

/// What identifies a site inside one file, independent of the plan.
public struct SiteKey: Hashable, Sendable {
    public let line: Int
    public let column: Int
    public let ruleID: String

    public init(line: Int, column: Int, ruleID: String) {
        self.line = line
        self.column = column
        self.ruleID = ruleID
    }
}

/// One file rewritten so that every switchable mutant is chosen by a number.
public struct InstrumentedFile: Equatable, Sendable {
    public let text: String
    /// Line number in `text` to the mutant whose copy owns it. Scaffolding, the
    /// original copy and untouched code all map to 0.
    public let mutantByLine: [Int: Int]
    /// Line number in `text` to the container that produced it, named by the
    /// container's byte offset in the original source.
    public let containerByLine: [Int: Int]
    /// The plan numbers this file switches, in plan order.
    public let switched: [Int]

    public init(text: String, mutantByLine: [Int: Int], containerByLine: [Int: Int], switched: [Int]) {
        self.text = text
        self.mutantByLine = mutantByLine
        self.containerByLine = containerByLine
        self.switched = switched
    }
}

/// Rewrites a source file so that one build holds every mutant of it.
public enum Instrumenter {
    /// The marker a copy is announced with. It has to be a comment: it sits
    /// inside expressions as well as statements.
    static let marker = "// __MUTANT "

    public static func instrument(
        source: String,
        path: String,
        numbers: [SiteKey: Int],
        skip: Set<Int>,
        droppedContainers: Set<Int>
    ) -> InstrumentedFile {
        let tree = Parser.parse(source: source)
        let converter = SourceLocationConverter(fileName: path, tree: tree)
        let collector = SiteCollector(converter: converter)
        collector.walk(tree)

        var tokens: [SyntaxIdentifier: TokenSyntax] = [:]
        for token in tree.tokens(viewMode: .sourceAccurate) { tokens[token.id] = token }

        let ordered = collector.sites.sorted { lhs, rhs in
            if lhs.line != rhs.line { return lhs.line < rhs.line }
            if lhs.column != rhs.column { return lhs.column < rhs.column }
            return lhs.ruleID < rhs.ruleID
        }

        struct Group {
            var node: Syntax
            var isBody: Bool
            var members: [(number: Int, site: MutationSite)] = []
        }
        var groups: [Int: Group] = [:]
        var switched: [Int] = []

        for site in ordered {
            let key = SiteKey(line: site.line, column: site.column, ruleID: site.ruleID)
            guard let number = numbers[key], !skip.contains(number) else { continue }
            guard let token = tokens[site.tokenID],
                  let found = MutationContainers.container(around: token) else { continue }
            let start = found.node.positionAfterSkippingLeadingTrivia.utf8Offset
            guard !droppedContainers.contains(start) else { continue }
            groups[start, default: Group(node: found.node, isBody: found.kind.isBody)]
                .members.append((number, site))
            switched.append(number)
        }

        let utf8 = Array(source.utf8)
        var edits: [(start: Int, end: Int, text: String)] = []
        for (start, group) in groups {
            let end = group.node.endPositionBeforeTrailingTrivia.utf8Offset
            guard start < end, end <= utf8.count else { continue }
            let replacement = group.isBody
                ? bodyText(node: group.node, members: group.members)
                : expressionText(node: group.node, members: group.members)
            edits.append((start, end, replacement))
        }
        edits.sort { $0.start < $1.start }

        // One forward pass, so the line each replacement lands on is known
        // exactly rather than searched for afterwards.
        var out = ""
        var containerByLine: [Int: Int] = [:]
        var cursor = 0
        var line = 1
        for edit in edits {
            let chunk = String(decoding: utf8[cursor ..< edit.start], as: UTF8.self)
            out += chunk
            line += chunk.count(where: { $0 == "\n" })
            let added = edit.text.count(where: { $0 == "\n" })
            for offset in 0 ... added { containerByLine[line + offset] = edit.start }
            out += edit.text
            line += added
            cursor = edit.end
        }
        out += String(decoding: utf8[cursor...], as: UTF8.self)

        var mutantByLine: [Int: Int] = [:]
        var active = 0
        for (index, text) in out.split(separator: "\n", omittingEmptySubsequences: false).enumerated() {
            if let range = text.range(of: marker) {
                active = Int(text[range.upperBound...].trimmingCharacters(in: .whitespaces)) ?? 0
            }
            mutantByLine[index + 1] = active
        }

        return InstrumentedFile(
            text: out,
            mutantByLine: mutantByLine,
            containerByLine: containerByLine,
            switched: switched.sorted()
        )
    }

    /// A body written once per mutant inside a switch.
    ///
    /// Each copy is character for character what the old path would have
    /// compiled, because it is produced by the same rewriter over the same
    /// tree. That is the whole argument for copying bodies rather than wrapping
    /// expressions: no new type inference, no new precedence, nothing to get
    /// subtly wrong.
    static func bodyText(node: Syntax, members: [(number: Int, site: MutationSite)]) -> String {
        var out = "\nswitch __MutantSwitch.active {\n"
        for member in members {
            let mutated = SingleSiteRewriter(target: member.site).rewrite(node).trimmedDescription
            out += "case \(member.number):\n\(marker)\(member.number)\n" + mutated + "\n"
        }
        out += "default:\n\(marker)0\n" + node.trimmedDescription + "\n}\n"
        return out
    }

    /// An initial value written once per mutant inside a closure that is
    /// applied on the spot.
    ///
    /// Not a chain of ternaries. A chain makes one expression k + 1 times the
    /// size of the original, and on three of this module's containers the type
    /// checker gave up on it. Each `return` here is its own statement, checked
    /// against the declared type on its own.
    static func expressionText(node: Syntax, members: [(number: Int, site: MutationSite)]) -> String {
        var out = "{\n\(marker)0\nswitch __MutantSwitch.active {\n"
        for member in members {
            let mutated = SingleSiteRewriter(target: member.site).rewrite(node).trimmedDescription
            out += "case \(member.number):\n\(marker)\(member.number)\nreturn (" + mutated + ")\n"
        }
        out += "default:\n\(marker)0\nreturn (" + node.trimmedDescription + ")\n}\n}()\n"
        return out
    }

    /// The one file added to the instrumented copy.
    ///
    /// `public`, so a default argument or anything inlinable may mention it.
    /// Read once per process, which is right: one process only ever has one
    /// active mutant.
    public static let mutantSwitchSource = """
    import Foundation

    /// Which mutant this process is running, or 0 for none of them.
    ///
    /// Written by the mutation runner. Not part of the app: this file only
    /// exists inside the throwaway package under `.build`.
    public enum __MutantSwitch {
        public static let active = Int(ProcessInfo.processInfo.environment["FIELDMARK_ACTIVE_MUTANT"] ?? "") ?? 0
    }

    """
}
```

- [x] **Step 4: Run the tests and watch them pass**

```bash
swift test --package-path Tools/CodeQuality --disable-sandbox --filter InstrumenterTests
```

Expected: `✔ Test run with 13 tests in 1 suite passed`. Got 15, the two extra being the
tests added in step 1.

Smoke test over the real module at the same time, throwaway: instrument every file of
`Sources/FieldmarkCore` and count what comes out. 126 files, 1,690 sites, 1,686 switched,
4 with no container — 1,407 function bodies, 92 short-form getters, 72 initializer
bodies, 87 property initial values, 28 parameter defaults, and nothing else. 14,364
lines become 44,042, a factor of 3.07, and the largest file is still
`Mail/MimeParser+Decoding.swift` at 330 lines becoming 2,769. The spike's shares hold
on today's sources.

- [x] **Step 5: Lint, rebuild, commit**

```bash
./Scripts/lint.sh
swift test --package-path Tools/CodeQuality --disable-sandbox
git add Tools/CodeQuality/Sources/MutationCore/Instrumenter.swift \
        Tools/CodeQuality/Tests/MutationCoreTests/InstrumenterTests.swift
git commit
```

---

### Task 3: Number the plan, and get back from a number to a fingerprint

A mutant's number is its position in the plan, counting from 1 across every file in plan order.
The runner has to go both ways: number to fingerprint when writing the report, site to number when
instrumenting.

**Files:**
- Create: `Tools/CodeQuality/Sources/MutationCore/SwitchPlan.swift`
- Create: `Tools/CodeQuality/Tests/MutationCoreTests/SwitchPlanTests.swift`

**Interfaces:**
- Consumes: `SiteKey` (Task 2), `MutantRecord`.
- Produces: `public struct SwitchPlan: Sendable` with
  `public init(fingerprintsByFile: [(file: String, fingerprints: [String], keys: [SiteKey])])`,
  `public func number(ofFingerprint fingerprint: String) -> Int?`,
  `public func fingerprint(ofNumber number: Int) -> String?`,
  `public func numbers(forFile file: String) -> [SiteKey: Int]`,
  `public var count: Int`.

- [x] **Step 1: Write the failing tests**

> **Deviation (2026-09-17).** Two tests added:
> `everyNumberRoundOutingsThroughItsFingerprint` and `anEmptyPlanHasNoNumbers`.
> Six tests, not four.

Create `Tools/CodeQuality/Tests/MutationCoreTests/SwitchPlanTests.swift`:

```swift
import MutationCore
import Testing

/// A mutant's number is where it sits in the plan, counting from 1 over every
/// file in order. The number is what the environment variable carries; the
/// fingerprint is what a verdict is filed under. Getting the two out of step
/// would file results against the wrong mutants, which is the worst thing this
/// tool could do quietly.
@Suite(.serialized) struct SwitchPlanTests {
    private func key(_ line: Int) -> SiteKey {
        SiteKey(line: line, column: 5, ruleID: "RelationalLtToLe")
    }

    private var plan: SwitchPlan {
        SwitchPlan(fingerprintsByFile: [
            (file: "A.swift", fingerprints: ["aaa", "bbb"], keys: [key(1), key(2)]),
            (file: "B.swift", fingerprints: ["ccc"], keys: [key(3)]),
        ])
    }

    @Test func numbersRunFromOneAcrossEveryFileInOrder() {
        #expect(plan.count == 3)
        #expect(plan.fingerprint(ofNumber: 1) == "aaa")
        #expect(plan.fingerprint(ofNumber: 2) == "bbb")
        #expect(plan.fingerprint(ofNumber: 3) == "ccc")
    }

    @Test func aFingerprintFindsItsNumber() {
        #expect(plan.number(ofFingerprint: "ccc") == 3)
        #expect(plan.number(ofFingerprint: "nope") == nil)
    }

    @Test func aNumberOutsideThePlanIsNothing() {
        #expect(plan.fingerprint(ofNumber: 0) == nil)
        #expect(plan.fingerprint(ofNumber: 4) == nil)
    }

    /// The instrumenter asks per file, and gets the numbers the whole plan gave
    /// that file rather than a fresh count starting at 1.
    @Test func eachFileKeepsTheNumbersThePlanGaveIt() {
        #expect(plan.numbers(forFile: "B.swift") == [key(3): 3])
        #expect(plan.numbers(forFile: "A.swift").count == 2)
        #expect(plan.numbers(forFile: "nothing.swift").isEmpty)
    }
}
```

- [x] **Step 2: Run the tests and watch them fail**

```bash
swift test --package-path Tools/CodeQuality --disable-sandbox --filter SwitchPlanTests
```

Expected: the build fails with `cannot find 'SwitchPlan' in scope`.

- [x] **Step 3: Write the implementation**

> **Deviation (2026-09-17).** `fingerprintsByFile` takes `[FilePlan]`, a new public
> struct in the same file, not `[(file:fingerprints:keys:)]`. SwiftLint's
> `large_tuple` refuses a tuple of three. The label and everything else is the
> plan's. The Part 3 plan names `SwitchPlan` but never its initializer, so nothing
> there had to change.

Create `Tools/CodeQuality/Sources/MutationCore/SwitchPlan.swift`:

```swift
import Foundation

/// The map between a mutant's number and its identity.
///
/// The number is a position in the plan, counting from 1, and it is what the
/// instrumented code switches on. The fingerprint is what a verdict is filed
/// under. Nothing else in the design depends on the number: it is not written
/// to the run file, and it changes whenever the plan changes.
public struct SwitchPlan: Sendable {
    private let fingerprints: [String]
    private let numbersPerFile: [String: [SiteKey: Int]]
    private let numberByFingerprint: [String: Int]

    /// Files in plan order, each with its fingerprints and site keys in plan
    /// order. The two arrays for a file are the same length and line up.
    public init(fingerprintsByFile: [(file: String, fingerprints: [String], keys: [SiteKey])]) {
        var flat: [String] = []
        var perFile: [String: [SiteKey: Int]] = [:]
        var byFingerprint: [String: Int] = [:]
        var next = 1
        for entry in fingerprintsByFile {
            var keys: [SiteKey: Int] = [:]
            for (offset, fingerprint) in entry.fingerprints.enumerated() {
                flat.append(fingerprint)
                byFingerprint[fingerprint] = next
                if offset < entry.keys.count { keys[entry.keys[offset]] = next }
                next += 1
            }
            perFile[entry.file] = keys
        }
        fingerprints = flat
        numbersPerFile = perFile
        numberByFingerprint = byFingerprint
    }

    public var count: Int { fingerprints.count }

    public func fingerprint(ofNumber number: Int) -> String? {
        guard number >= 1, number <= fingerprints.count else { return nil }
        return fingerprints[number - 1]
    }

    public func number(ofFingerprint fingerprint: String) -> Int? {
        numberByFingerprint[fingerprint]
    }

    public func numbers(forFile file: String) -> [SiteKey: Int] {
        numbersPerFile[file] ?? [:]
    }
}
```

- [x] **Step 4: Run the tests and watch them pass**

```bash
swift test --package-path Tools/CodeQuality --disable-sandbox --filter SwitchPlanTests
```

Expected: `✔ Test run with 4 tests in 1 suite passed`.

- [x] **Step 5: Lint, rebuild, commit**

```bash
./Scripts/lint.sh
swift test --package-path Tools/CodeQuality --disable-sandbox
git add Tools/CodeQuality/Sources/MutationCore/SwitchPlan.swift \
        Tools/CodeQuality/Tests/MutationCoreTests/SwitchPlanTests.swift
git commit
```

---

### Task 4: Blame a compiler error on a mutant or a container

One bad copy breaks a whole file, so the prune loop has to read the compiler's complaints and work
out whose fault each one is. This is the part that decides whether a mutant is recorded as
`compile_error` or sent down the old path, so it is pure and it is table-tested.

**Files:**
- Create: `Tools/CodeQuality/Sources/MutationCore/CompilerErrors.swift`
- Create: `Tools/CodeQuality/Tests/MutationCoreTests/CompilerErrorsTests.swift`

**Interfaces:**
- Consumes: `InstrumentedFile` (Task 2).
- Produces:
  - `public struct CompilerError: Equatable, Sendable` with `public let file: String`, `public let line: Int`, `public let message: String`.
  - `public enum Blame: Equatable, Sendable` with cases `mutant(Int)`, `container(Int)`, `nothing`.
  - `public enum CompilerErrors` with
    `public static func parse(_ output: String) -> [CompilerError]`,
    `public static func isTypeCheckTimeout(_ message: String) -> Bool`,
    `public static func blame(_ error: CompilerError, in file: InstrumentedFile) -> Blame`.

- [x] **Step 1: Write the failing tests**

> **Deviation (2026-09-17).** Three tests added, ten rather than seven:
> `everyErrorInTheOutputComesBack`, `anErrorAboveEveryContainerIsBlamedOnNothing`,
> and `anErrorWithNoFileAndLineIsNotReadAsOne` — SwiftPM's own `error: emit-module
> command failed` and `<unknown>:0: error: link command failed` name no file and no
> line, and reading either as a complaint about line 0 would blame whichever
> container came first for a link that failed. They parse as nothing, the prune
> loop then finds nothing to drop, and the run falls back to the old path, which
> is the honest answer. `aWindowsStyleDriveLetterIsNotAColumn` also checks the
> path now, which is the half of that case worth pinning.

Create `Tools/CodeQuality/Tests/MutationCoreTests/CompilerErrorsTests.swift`:

```swift
import MutationCore
import Testing

/// Reading the compiler's complaints and deciding whose fault each one is.
///
/// Three outcomes, and they mean different things. Blamed on a mutant, it is a
/// `compile_error` and the score ignores it. Blamed on a container, that whole
/// container stops being switched and its mutants go down the old path, which
/// judges them properly. Blamed on nothing, the run cannot be trusted and says
/// so out loud.
@Suite(.serialized) struct CompilerErrorsTests {
    private func file(mutants: [Int: Int], containers: [Int: Int]) -> InstrumentedFile {
        InstrumentedFile(text: "", mutantByLine: mutants, containerByLine: containers, switched: [])
    }

    @Test func itReadsFileLineAndMessageAndIgnoresEverythingElse() {
        let output = """
        [3/5] Compiling FieldmarkCore Slug.swift
        /tmp/sandbox/Sources/FieldmarkCore/Persistence/Slug.swift:408:5: error: missing return in static method
        /tmp/sandbox/Sources/FieldmarkCore/Persistence/Slug.swift:400:9: warning: unused variable
        note: something else
        """
        let errors = CompilerErrors.parse(output)
        #expect(errors.count == 1)
        #expect(errors.first?.file == "/tmp/sandbox/Sources/FieldmarkCore/Persistence/Slug.swift")
        #expect(errors.first?.line == 408)
        #expect(errors.first?.message == "missing return in static method")
    }

    @Test func aWindowsStyleDriveLetterIsNotAColumn() {
        // Defensive: the parser splits on colons, so a path that holds one has
        // to survive. macOS paths do not, but a file name might.
        let output = "/tmp/a:b/File.swift:12:3: error: bad"
        let errors = CompilerErrors.parse(output)
        #expect(errors.first?.line == 12)
        #expect(errors.first?.message == "bad")
    }

    @Test func anErrorOnACopiedLineIsTheMutantsFault() {
        let error = CompilerError(file: "F.swift", line: 12, message: "binary operator '-' cannot be applied")
        let blame = CompilerErrors.blame(error, in: file(mutants: [12: 411], containers: [12: 900]))
        #expect(blame == .mutant(411))
    }

    /// The scaffolding of a switch, and the original copy under `default`, both
    /// map to no mutant. If they will not compile, the container cannot be
    /// switched at all.
    @Test func anErrorOnTheScaffoldingIsTheContainersFault() {
        let error = CompilerError(file: "F.swift", line: 12, message: "expected expression")
        let blame = CompilerErrors.blame(error, in: file(mutants: [12: 0], containers: [12: 900]))
        #expect(blame == .container(900))
    }

    /// The case the spike found: a copy that can fall off the end of the body
    /// is reported at the closing brace of the whole declaration, which is
    /// after every line of the switch and names no case. The nearest container
    /// above it is the one that broke.
    @Test func anErrorAfterTheSwitchBelongsToTheContainerAboveIt() {
        let error = CompilerError(file: "F.swift", line: 40, message: "missing return in static method")
        let blame = CompilerErrors.blame(
            error,
            in: file(mutants: [40: 0], containers: [10: 100, 20: 200, 30: 300])
        )
        #expect(blame == .container(300))
    }

    @Test func anErrorInAFileWithNoContainersAtAllIsBlamedOnNothing() {
        let error = CompilerError(file: "F.swift", line: 7, message: "bad")
        #expect(CompilerErrors.blame(error, in: file(mutants: [:], containers: [:])) == .nothing)
    }

    /// A timeout says the machine was busy, not that the mutant is invalid.
    /// Recording it as `compile_error` would take a real result out of the
    /// score on the strength of how loaded the machine was.
    @Test func aTypeCheckTimeoutIsRecognisedAndIsNeverAMutantsFault() {
        let message = "the compiler is unable to type-check this expression in reasonable time; "
            + "try breaking up the expression into distinct sub-expressions"
        #expect(CompilerErrors.isTypeCheckTimeout(message))
        #expect(CompilerErrors.isTypeCheckTimeout("binary operator '-' cannot be applied") == false)

        let error = CompilerError(file: "F.swift", line: 12, message: message)
        let blame = CompilerErrors.blame(error, in: file(mutants: [12: 411], containers: [12: 900]))
        #expect(blame == .container(900), "a timeout drops the container, never the mutant")
    }
}
```

- [x] **Step 2: Run the tests and watch them fail**

```bash
swift test --package-path Tools/CodeQuality --disable-sandbox --filter CompilerErrorsTests
```

Expected: the build fails with `cannot find 'CompilerErrors' in scope`.

- [x] **Step 3: Write the implementation**

Create `Tools/CodeQuality/Sources/MutationCore/CompilerErrors.swift`:

```swift
import Foundation

/// One `file:line:column: error: message` from a build.
public struct CompilerError: Equatable, Sendable {
    public let file: String
    public let line: Int
    public let message: String

    public init(file: String, line: Int, message: String) {
        self.file = file
        self.line = line
        self.message = message
    }
}

/// Whose fault an error is.
public enum Blame: Equatable, Sendable {
    /// One mutant's copy. It is a `compile_error` and the score ignores it.
    case mutant(Int)
    /// The container, named by its byte offset in the original source. It stops
    /// being switched and its mutants take the old path.
    case container(Int)
    /// Nothing the instrumenter wrote. The run cannot be trusted.
    case nothing
}

/// Reading a build's complaints.
public enum CompilerErrors {
    public static func parse(_ output: String) -> [CompilerError] {
        var found: [CompilerError] = []
        for line in output.split(separator: "\n") {
            guard let errorRange = line.range(of: ": error: ") else { continue }
            let location = line[line.startIndex ..< errorRange.lowerBound]
            let message = String(line[errorRange.upperBound...]).trimmingCharacters(in: .whitespaces)
            // "<path>:<line>:<column>", and the path may hold colons of its own,
            // so read the numbers off the end rather than splitting from the
            // front.
            let parts = location.split(separator: ":")
            guard parts.count >= 3, let number = Int(parts[parts.count - 2]) else { continue }
            let path = parts.dropLast(2).joined(separator: ":")
            found.append(CompilerError(file: path, line: number, message: message))
        }
        return found
    }

    /// Whether the compiler gave up on the expression rather than rejecting it.
    ///
    /// This is about the machine, not the code, so it must never be recorded as
    /// a mutant that does not compile. The container is dropped instead and the
    /// old path decides honestly.
    public static func isTypeCheckTimeout(_ message: String) -> Bool {
        message.contains("unable to type-check this expression in reasonable time")
    }

    public static func blame(_ error: CompilerError, in file: InstrumentedFile) -> Blame {
        let container = file.containerByLine[error.line]
            ?? file.containerByLine.filter { $0.key < error.line }.max { $0.key < $1.key }?.value

        if !isTypeCheckTimeout(error.message), let mutant = file.mutantByLine[error.line], mutant > 0 {
            return .mutant(mutant)
        }
        if let container { return .container(container) }
        return .nothing
    }
}
```

- [x] **Step 4: Run the tests and watch them pass**

```bash
swift test --package-path Tools/CodeQuality --disable-sandbox --filter CompilerErrorsTests
```

Expected: `✔ Test run with 7 tests in 1 suite passed`.

- [x] **Step 5: Lint, rebuild, commit**

```bash
./Scripts/lint.sh
swift test --package-path Tools/CodeQuality --disable-sandbox
git add Tools/CodeQuality/Sources/MutationCore/CompilerErrors.swift \
        Tools/CodeQuality/Tests/MutationCoreTests/CompilerErrorsTests.swift
git commit
```

---

### Task 5: Lay out the sandbox

Two throwaway packages under `.build/`: the instrumented one that holds every switchable mutant,
and a plain one that the old path edits. The working tree is never touched again.

**Files:**
- Create: `Tools/CodeQuality/Sources/MutationCore/SandboxLayout.swift`
- Create: `Tools/CodeQuality/Tests/MutationCoreTests/SandboxLayoutTests.swift`

**Interfaces:**
- Consumes: nothing.
- Produces: `public struct SandboxLayout: Sendable` with
  `public init(root: String)`,
  `public let switchedPackage: String`, `public let plainPackage: String`, `public let lockPath: String`,
  `public func manifest(named: String) -> String`,
  `public static func rootLinks(ofStubPackage path: String) throws -> [(name: String, destination: String)]`,
  `public static let lockMessage: String`.

- [x] **Step 1: Write the failing tests**

> **Deviation (2026-09-17).** One test added, five rather than four:
> `theRealStubPackageStillHasItsLinks` reads `Tools/CoreMutation` itself and pins
> the five links the sandbox depends on (`README.md`, `Scripts`, `UPDATE_URL`,
> `VERSION`, `run.sh`), all pointing at `../../`. The temp-directory fixture also
> holds a real subdirectory now, so "not a symlink" is tested for a folder as well
> as a file.

Create `Tools/CodeQuality/Tests/MutationCoreTests/SandboxLayoutTests.swift`:

```swift
import Foundation
import MutationCore
import Testing

/// Where the throwaway packages live and what shape they are.
///
/// Two of them. The instrumented one holds every mutant that can be switched.
/// The plain one is what the old path edits, because one file changing in the
/// instrumented package costs 13.7 s against 1.9 s in a plain one, and seventy
/// old-path mutants at that rate is twenty minutes.
@Suite(.serialized) struct SandboxLayoutTests {
    @Test func bothPackagesLiveUnderTheBuildFolderTwoLevelsDown() {
        let layout = SandboxLayout(root: "/repo")
        #expect(layout.switchedPackage == "/repo/.build/mutation-sandbox")
        #expect(layout.plainPackage == "/repo/.build/mutation-plain")
        // Two levels down matters: the root symlinks point at ../../ and are
        // copied from `Tools/CoreMutation`, which is also two levels down.
        #expect(layout.switchedPackage.hasSuffix("/.build/mutation-sandbox"))
    }

    @Test func theLockSitsBesideThemAndSaysWhatToDo() {
        #expect(SandboxLayout(root: "/repo").lockPath == "/repo/.build/mutation-sandbox.lock")
        #expect(SandboxLayout.lockMessage.contains("already running"))
        #expect(SandboxLayout.lockMessage.contains("worktree"))
    }

    @Test func theManifestBuildsFieldmarkCoreAndItsTestsAndNothingElse() {
        let manifest = SandboxLayout(root: "/repo").manifest(named: "MutationSandbox")
        #expect(manifest.contains("swift-tools-version: 6.0"))
        #expect(manifest.contains("name: \"MutationSandbox\""))
        #expect(manifest.contains(".target(name: \"FieldmarkCore\")"))
        #expect(manifest.contains(".testTarget(name: \"FieldmarkCoreTests\", dependencies: [\"FieldmarkCore\"])"))
        #expect(manifest.contains(".macOS(.v14)"))
    }

    /// The links are read off `Tools/CoreMutation` rather than written down
    /// here. Somebody adding one there would otherwise have to remember to add
    /// it in two sites, and the tests that walk up from their own file would
    /// start failing inside the sandbox only.
    @Test func theRootLinksAreDiscoveredFromTheStubPackage() throws {
        let directory = FileManager.default.temporaryDirectory
            .appending(path: "stub-\(UUID().uuidString)", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createSymbolicLink(
            atPath: directory.appending(path: "VERSION").path, withDestinationPath: "../../VERSION"
        )
        try FileManager.default.createSymbolicLink(
            atPath: directory.appending(path: "Scripts").path, withDestinationPath: "../../Scripts"
        )
        try Data("x".utf8).write(to: directory.appending(path: "Package.swift"))

        let links = try SandboxLayout.rootLinks(ofStubPackage: directory.path)
        #expect(links.count == 2)
        #expect(links.contains { $0.name == "VERSION" && $0.destination == "../../VERSION" })
        #expect(links.contains { $0.name == "Scripts" && $0.destination == "../../Scripts" })
        #expect(links.contains { $0.name == "Package.swift" } == false)
    }
}
```

- [x] **Step 2: Run the tests and watch them fail**

```bash
swift test --package-path Tools/CodeQuality --disable-sandbox --filter SandboxLayoutTests
```

Expected: the build fails with `cannot find 'SandboxLayout' in scope`.

- [x] **Step 3: Write the implementation**

Create `Tools/CodeQuality/Sources/MutationCore/SandboxLayout.swift`:

```swift
import Foundation

/// Where the throwaway packages go and what shape they are.
public struct SandboxLayout: Sendable {
    public let root: String

    public init(root: String) {
        self.root = root
    }

    /// The instrumented package: every switchable mutant, one build.
    public var switchedPackage: String { root + "/.build/mutation-sandbox" }

    /// A plain copy of the same sources, for the mutants that cannot be
    /// switched. They still cost one build each, so the build has to be a small
    /// one: the instrumented module is three times the source and takes seven
    /// times as long to rebuild after one file changes.
    public var plainPackage: String { root + "/.build/mutation-plain" }

    public var lockPath: String { root + "/.build/mutation-sandbox.lock" }

    public static let lockMessage = """
    Another mutation run is already running in this checkout.

    Two runs share one sandbox and would overwrite each other's sources, so this
    one is stopping instead. Use a separate worktree for the second run, or wait
    for the first to finish. If nothing is running, the lock is stale and can be
    deleted.
    """

    /// The manifest both packages use. The same shape as
    /// `Tools/CoreMutation/Package.swift`: `FieldmarkCore` and its tests, nothing
    /// else, so a build is seconds rather than the whole app.
    public func manifest(named name: String) -> String {
        """
        // swift-tools-version: 6.0
        import PackageDescription

        // Written by the mutation runner. Throwaway.
        let package = Package(
            name: "\(name)",
            platforms: [.macOS(.v14)],
            targets: [
                .target(name: "FieldmarkCore"),
                .testTarget(name: "FieldmarkCoreTests", dependencies: ["FieldmarkCore"]),
            ]
        )

        """
    }

    /// The symlinks at the root of `Tools/CoreMutation`, to be made again at
    /// the root of each sandbox.
    ///
    /// Read from disk rather than listed here. Some tests count directories up
    /// from their own file, and both the stub package and the sandboxes sit two
    /// directories below the checkout, so the destinations copy across
    /// unchanged. Somebody adding a link to the stub package gets it in the
    /// sandbox for free.
    public static func rootLinks(ofStubPackage path: String) throws -> [(name: String, destination: String)] {
        let contents = try FileManager.default.contentsOfDirectory(atPath: path)
        var links: [(name: String, destination: String)] = []
        for name in contents.sorted() {
            let full = path + "/" + name
            guard let attributes = try? FileManager.default.attributesOfItem(atPath: full),
                  attributes[.type] as? FileAttributeType == .typeSymbolicLink,
                  let destination = try? FileManager.default.destinationOfSymbolicLink(atPath: full)
            else { continue }
            links.append((name: name, destination: destination))
        }
        return links
    }
}
```

- [x] **Step 4: Run the tests and watch them pass**

```bash
swift test --package-path Tools/CodeQuality --disable-sandbox --filter SandboxLayoutTests
```

Expected: `✔ Test run with 4 tests in 1 suite passed`.

- [x] **Step 5: Lint, rebuild, commit**

```bash
./Scripts/lint.sh
swift test --package-path Tools/CodeQuality --disable-sandbox
git add Tools/CodeQuality/Sources/MutationCore/SandboxLayout.swift \
        Tools/CodeQuality/Tests/MutationCoreTests/SandboxLayoutTests.swift
git commit
```

---

### Task 6: Write the sandbox to disk

**Files:**
- Create: `Tools/CodeQuality/Sources/mutation-runner/Sandbox.swift`
- Modify: `Tools/CodeQuality/Sources/mutation-runner/main.swift` (nothing yet; the file is used from Task 7 on)

**Interfaces:**
- Consumes: `SandboxLayout`, `Instrumenter`, `SwitchPlan`, `InstrumentedFile`.
- Produces: in the `mutation-runner` target,
  `struct SandboxWriter` with `init(layout: SandboxLayout, plan: SwitchPlan, files: [(path: String, display: String, source: String)])`,
  `func takeLock() -> Bool`, `func releaseLock()`,
  `func writePlain() throws`,
  `@discardableResult func writeSwitched(skip: Set<Int>, dropped: [String: Set<Int>]) throws -> [String: InstrumentedFile]`,
  `func plainSourcePath(forDisplay display: String) -> String`.

- [x] **Step 1: Write the implementation**

There is no unit test for this one: it is filesystem plumbing whose only interesting behaviour is
"the packages build", and Task 7 proves that on the real module. Everything that could be tested
without a filesystem is already in `SandboxLayout` and `Instrumenter`.

> **Deviation (2026-09-17).** Five changes, four of them things the plan's version
> would have got wrong:
>
> 1. **`files` is every Core source, not the run's targets.** A scoped run
>    (`--files X`) would otherwise write X alone into the sandbox and the package
>    would not compile at all. Files the plan gave no numbers to are written out
>    unchanged, because `SwitchPlan.numbers(forFile:)` answers `[:]` for them.
>    Task 9's `main.swift` block builds `sources` from `allCoreSwiftFiles()`
>    accordingly, and `fingerprintsByFile` from the targets only.
> 2. **The tests are copied on every run, not once ever.** The plan's `if
>    !fileExists` meant the second run in a checkout judged mutants against the
>    first run's tests. `syncTests` walks the real directory and writes only the
>    files whose bytes changed, deleting the ones that have gone, so the copy is
>    current without moving every mtime and forcing a full test-target rebuild.
> 3. **Sources the checkout no longer has are deleted from the sandbox**
>    (`pruneSources`), so a removed file cannot go on compiling there.
> 4. **A stale lock is taken over.** The lock file holds a pid; if that process is
>    gone the lock is cleared and the run continues. The runner leaves through
>    `exit()` on several paths and the signal handler exits outright, so a lock
>    only a person could clear would stop every later run in the checkout.
> 5. `files` is `[SandboxSource]`, a struct, not a tuple of three (SwiftLint), and
>    `Darwin.write` is spelled out in `takeLock` because the type has a `write` of
>    its own — the plan's `write(descriptor, …)` does not compile.

Create `Tools/CodeQuality/Sources/mutation-runner/Sandbox.swift`:

```swift
import Foundation
import MutationCore

// Writing the two throwaway packages. The working tree is not edited by a
// switched run at all, and the old path only ever edits the plain copy.

struct SandboxWriter {
    let layout: SandboxLayout
    let plan: SwitchPlan
    /// Every Core source, in plan order: where it is, what it is called in the
    /// report, and its text.
    let files: [(path: String, display: String, source: String)]

    private var fm: FileManager { FileManager.default }

    // MARK: - The lock

    /// Takes the lock, or returns false if another run holds it.
    ///
    /// `O_EXCL` rather than "does the file exist", so two runs starting at the
    /// same moment cannot both decide they are first.
    func takeLock() -> Bool {
        try? fm.createDirectory(atPath: layout.root + "/.build", withIntermediateDirectories: true)
        let descriptor = open(layout.lockPath, O_CREAT | O_EXCL | O_WRONLY, 0o644)
        guard descriptor >= 0 else { return false }
        let text = "pid \(ProcessInfo.processInfo.processIdentifier)\n"
        _ = text.withCString { write(descriptor, $0, strlen($0)) }
        close(descriptor)
        return true
    }

    func releaseLock() {
        try? fm.removeItem(atPath: layout.lockPath)
    }

    // MARK: - Writing

    /// The plain package: the sources exactly as they are, for the old path.
    func writePlain() throws {
        try scaffold(package: layout.plainPackage, named: "MutationPlain")
        for file in files {
            try write(text: file.source, to: sourcePath(in: layout.plainPackage, display: file.display))
        }
    }

    /// The instrumented package, leaving out `skip` and every dropped
    /// container. Returns what it wrote, so the prune loop can blame errors.
    @discardableResult
    func writeSwitched(skip: Set<Int>, dropped: [String: Set<Int>]) throws -> [String: InstrumentedFile] {
        try scaffold(package: layout.switchedPackage, named: "MutationSandbox")
        try write(
            text: Instrumenter.mutantSwitchSource,
            to: layout.switchedPackage + "/Sources/FieldmarkCore/__MutantSwitch.swift"
        )
        var written: [String: InstrumentedFile] = [:]
        for file in files {
            let instrumented = Instrumenter.instrument(
                source: file.source,
                path: file.display,
                numbers: plan.numbers(forFile: file.display),
                skip: skip,
                droppedContainers: dropped[file.display] ?? []
            )
            let target = sourcePath(in: layout.switchedPackage, display: file.display)
            try write(text: instrumented.text, to: target)
            written[target] = instrumented
        }
        return written
    }

    /// Where the old path edits a file.
    func plainSourcePath(forDisplay display: String) -> String {
        sourcePath(in: layout.plainPackage, display: display)
    }

    // MARK: - Plumbing

    private func sourcePath(in package: String, display: String) -> String {
        // `display` is `Sources/FieldmarkCore/Area/File.swift`, and the sandbox
        // keeps the same shape, so an error message reads the way the real file
        // reads.
        package + "/" + display
    }

    /// Writes only when the text changed, so a second run rebuilds what moved
    /// and nothing else.
    private func write(text: String, to path: String) throws {
        let url = URL(filePath: path)
        try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let existing = try? String(contentsOf: url, encoding: .utf8), existing == text { return }
        try Data(text.utf8).write(to: url)
    }

    /// The manifest, the root links and a real copy of the tests.
    private func scaffold(package: String, named name: String) throws {
        try fm.createDirectory(atPath: package + "/Sources/FieldmarkCore", withIntermediateDirectories: true)
        try write(text: layout.manifest(named: name), to: package + "/Package.swift")

        for link in try SandboxLayout.rootLinks(ofStubPackage: layout.root + "/Tools/CoreMutation") {
            let path = package + "/" + link.name
            if (try? fm.destinationOfSymbolicLink(atPath: path)) == link.destination { continue }
            try? fm.removeItem(atPath: path)
            try fm.createSymbolicLink(atPath: path, withDestinationPath: link.destination)
        }

        // A real copy, taken once, so editing tests during a run is safe and so
        // a mutant is judged against the tests the run started with.
        let tests = package + "/Tests/FieldmarkCoreTests"
        if !fm.fileExists(atPath: tests) {
            try fm.createDirectory(atPath: package + "/Tests", withIntermediateDirectories: true)
            try fm.copyItem(atPath: layout.root + "/Tests/FieldmarkCoreTests", toPath: tests)
        }
    }
}
```

- [x] **Step 2: Build it**

```bash
swift build --package-path Tools/CodeQuality --product mutation-runner --disable-sandbox
```

Expected: `Build of product 'mutation-runner' complete!`.

- [x] **Step 3: Run the package's tests, which must still all pass**

```bash
swift test --package-path Tools/CodeQuality --disable-sandbox
```

Expected: `✔ Test run with 150 tests in 17 suites passed`. Nothing new was added here; the count is
whatever Task 5 left: 106 after part 1, plus 16, 13, 4, 7 and 4 from tasks 1 to 5.

- [x] **Step 4: Lint, rebuild, commit**

```bash
./Scripts/lint.sh
swift test --package-path Tools/CodeQuality --disable-sandbox
swift build --package-path Tools/CodeQuality --product mutation-runner --disable-sandbox
git add Tools/CodeQuality/Sources/mutation-runner/Sandbox.swift
git commit
```

---

### Task 7: The prune loop

Build, read the errors, drop what will not compile, build again. At most eight rounds. The spike
converged in seven, and every round after the first is cheap because only the files that changed
are recompiled.

**Files:**
- Create: `Tools/CodeQuality/Sources/mutation-runner/Pruning.swift`

**Interfaces:**
- Consumes: `SandboxWriter` (Task 6), `CompilerErrors`, `Blame` (Task 4), `TestCommand` (Part 1), `runSwift` (Part 1).
- Produces: in the `mutation-runner` target,
  `struct PruneResult` with `let switched: Set<Int>`, `let compileErrors: Set<Int>`, `let droppedContainers: Int`, `let gaveUp: Bool`;
  `func pruneUntilItBuilds(writer: SandboxWriter) -> PruneResult`.

- [x] **Step 1: Write the implementation**

> **Deviation (2026-09-17).** Four changes:
>
> 1. **The build gets its own timeout, not `testTimeout`.** The instrumented
>    package's first build is about a minute, and 120 s of headroom on a shared
>    machine is not enough; a build reported as a timeout would send all 1,697
>    mutants down the old path and cost four hours. `coldBuildTimeout` is 900 s,
>    and a timeout is now handled explicitly rather than falling through the
>    "nothing to drop" branch.
> 2. **The build goes through a new `buildOutput(package:timeout:)`** in
>    `TestRunning.swift`, which retries llbuild's transient "was modified during
>    the build" race the way `stubBuildSucceeds` does and hands back the
>    diagnostics. Read as a real failure that race would mark a perfectly good
>    mutant `compile_error`.
> 3. **Blaming is a function of its own** (`blameErrors`), because the plan's
>    single function was over SwiftLint's cyclomatic-complexity limit.
> 4. The round's log line names the commonest error message, and the give-up
>    branch prints up to five unplaceable errors verbatim. Without them the
>    fallback to the old path is four silent hours.

Create `Tools/CodeQuality/Sources/mutation-runner/Pruning.swift`:

```swift
import Foundation
import MutationCore

// Compiling the instrumented package until it builds, and recording what had to
// be left out to get there.

struct PruneResult {
    /// The mutants the instrumented build can run.
    let switched: Set<Int>
    /// Mutants whose own copy would not compile. These are `compile_error`, the
    /// same verdict the old path gives them.
    let compileErrors: Set<Int>
    /// How many containers had to stop being switched.
    let droppedContainers: Int
    /// True when eight rounds were not enough, or an error was blamed on
    /// nothing. The caller runs everything the old way.
    let gaveUp: Bool
}

/// The most rounds worth trying. Seven were needed over the whole module on
/// 2026-09-17; more than eight means something is wrong rather than large.
let maxPruneRounds = 8

func pruneUntilItBuilds(writer: SandboxWriter) -> PruneResult {
    var skip: Set<Int> = []
    var dropped: [String: Set<Int>] = [:]
    var droppedCount = 0

    for round in 1 ... maxPruneRounds {
        let written: [String: InstrumentedFile]
        do {
            written = try writer.writeSwitched(skip: skip, dropped: dropped)
        } catch {
            logErr("Could not write the sandbox: \(error)")
            return PruneResult(switched: [], compileErrors: skip, droppedContainers: droppedCount, gaveUp: true)
        }

        let result = runSwift(
            TestCommand.buildArguments(packagePath: writer.layout.switchedPackage),
            timeout: testTimeout
        )
        if result.exitCode == 0, !result.timedOut {
            let switched = Set(written.values.flatMap(\.switched))
            log("Switching: \(switched.count) mutant(s) in one build, after \(round) round(s).")
            return PruneResult(
                switched: switched, compileErrors: skip, droppedContainers: droppedCount, gaveUp: false
            )
        }

        var newSkips = 0
        var newDrops = 0
        var blamedOnNothing = 0
        for error in CompilerErrors.parse(result.output) {
            // The writer keyed the map by the path it wrote. The compiler may
            // print the same file with symlinks resolved, so fall back to
            // matching the tail. Skipping an error silently would spin the loop
            // until the round cap with nothing to show.
            let match = written.first { key, _ in
                key == error.file
                    || error.file.hasSuffix(displayPath(ofSandboxFile: key, package: writer.layout.switchedPackage))
            }
            guard let match else {
                blamedOnNothing += 1
                logErr("Cannot site this file: \(error.file)")
                continue
            }
            switch CompilerErrors.blame(error, in: match.value) {
            case let .mutant(number):
                if skip.insert(number).inserted { newSkips += 1 }
            case let .container(offset):
                let display = displayPath(ofSandboxFile: match.key, package: writer.layout.switchedPackage)
                if dropped[display, default: []].insert(offset).inserted {
                    newDrops += 1
                    droppedCount += 1
                }
            case .nothing:
                blamedOnNothing += 1
                logErr("Cannot site this error: \(error.file):\(error.line): \(error.message)")
            }
        }

        log("Round \(round): \(newSkips) mutant(s) will not compile, \(newDrops) container(s) dropped.")
        if newSkips == 0, newDrops == 0 {
            logErr("")
            logErr("The instrumented build will not compile and nothing more can be dropped.")
            logErr("\(blamedOnNothing) error(s) could not be placed. Running every mutant the old way.")
            return PruneResult(switched: [], compileErrors: [], droppedContainers: droppedCount, gaveUp: true)
        }
    }

    logErr("")
    logErr("Gave up after \(maxPruneRounds) rounds of pruning. Running every mutant the old way.")
    return PruneResult(switched: [], compileErrors: [], droppedContainers: droppedCount, gaveUp: true)
}

/// `.build/mutation-sandbox/Sources/FieldmarkCore/A/B.swift` back to
/// `Sources/FieldmarkCore/A/B.swift`.
func displayPath(ofSandboxFile path: String, package: String) -> String {
    let prefix = package + "/"
    return path.hasPrefix(prefix) ? String(path.dropFirst(prefix.count)) : path
}
```

- [x] **Step 2: Build it**

```bash
swift build --package-path Tools/CodeQuality --product mutation-runner --disable-sandbox
```

Expected: `Build of product 'mutation-runner' complete!`.

- [x] **Step 3: Lint, rebuild, commit**

```bash
./Scripts/lint.sh
swift test --package-path Tools/CodeQuality --disable-sandbox
swift build --package-path Tools/CodeQuality --product mutation-runner --disable-sandbox
git add Tools/CodeQuality/Sources/mutation-runner/Pruning.swift
git commit
```

---

### Task 8: Run a switched mutant

The suite runs against the instrumented package with one environment variable set. Everything
about judging the result, including the kill confirmation, is Part 1's and does not change.

**Files:**
- Modify: `Tools/CodeQuality/Sources/mutation-runner/Support.swift` (`runSwift` gains an environment)
- Modify: `Tools/CodeQuality/Sources/mutation-runner/TestRunning.swift` (the package and the environment become arguments)
- Create: `Tools/CodeQuality/Sources/mutation-runner/Switching.swift`

**Interfaces:**
- Consumes: `runSuite`, `verdictForMutantOnDisk`, `stubBuildSucceeds`, `baselinePasses` (Part 1), `PruneResult` (Task 7).
- Produces: `func runSwitched(_ number: Int, package: String) -> MutantOutcome` in the `mutation-runner` target; `runSwift(_:timeout:extraEnvironment:)`; `runSuite(package:parallel:filters:extraEnvironment:)`; `verdictForMutant(package:extraEnvironment:)`; `baselinePasses(package:)`.

- [x] **Step 1: Give the existing helpers a package and an environment**

In `Tools/CodeQuality/Sources/mutation-runner/Support.swift`, change `runSwift`'s signature and the
one line that sets the environment:

```swift
@discardableResult
func runSwift(
    _ args: [String],
    timeout deadline: TimeInterval,
    extraEnvironment: [String: String] = [:]
) -> RunResult {
```

```swift
    process.environment = ProcessInfo.processInfo.environment.merging(extraEnvironment) { _, new in new }
```

> **Deviation (2026-09-17).** `stubBuildSucceeds` gained a `timeout:` as well as a
> `package:`, defaulting to `testTimeout` as before, and its retry loop is gone
> because `buildOutput` from Task 7 already is that loop. The cold plain build in
> Task 9 passes `coldBuildTimeout`. Step 4's run reported 3 mutants, all
> `compile_error`, the same three the reference run at `7c55454` recorded, in 50 s.

In `Tools/CodeQuality/Sources/mutation-runner/TestRunning.swift`, thread the package and the
environment through. The four functions become:

```swift
func stubBuildSucceeds(package: String = stubPackagePath) -> Bool {
    let maxAttempts = 5
    for attempt in 1 ... maxAttempts {
        let result = runSwift(TestCommand.buildArguments(packagePath: package), timeout: testTimeout)
        if result.timedOut { return false }
        if result.exitCode == 0 { return true }
        if result.output.contains(modifiedDuringBuildMarker), attempt < maxAttempts {
            Thread.sleep(forTimeInterval: 0.3)
            continue
        }
        return false
    }
    return false
}

func runSuite(
    package: String = stubPackagePath,
    parallel: Bool,
    filters: [String] = [],
    extraEnvironment: [String: String] = [:]
) -> SuiteRun {
    let maxAttempts = 5
    for attempt in 1 ... maxAttempts {
        try? FileManager.default.removeItem(atPath: reportPath)
        let result = runSwift(
            TestCommand.testArguments(
                packagePath: package, parallel: parallel, xunitPath: reportPath, filters: filters
            ),
            timeout: testTimeout,
            extraEnvironment: extraEnvironment
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

func baselinePasses(package: String = stubPackagePath) -> Bool {
    runSuite(package: package, parallel: true).result == .passed
}

func verdictForMutant(
    package: String = stubPackagePath,
    extraEnvironment: [String: String] = [:]
) -> MutantOutcome {
    var step = KillConfirmation.afterFirstRun(
        runSuite(package: package, parallel: true, extraEnvironment: extraEnvironment)
    )
    if case let .confirm(filters) = step {
        step = KillConfirmation.afterConfirmation(
            runSuite(package: package, parallel: false, filters: filters, extraEnvironment: extraEnvironment)
        )
    }
    if case let .verdict(outcome) = step { return outcome }
    return KillConfirmation.afterWholeSuite(
        runSuite(package: package, parallel: false, extraEnvironment: extraEnvironment)
    )
}
```

`verdictForMutantOnDisk()` is renamed to `verdictForMutant(package:extraEnvironment:)`, so update its
one call site in `main.swift` to `verdictForMutant()`.

- [x] **Step 2: Write the switched runner**

Create `Tools/CodeQuality/Sources/mutation-runner/Switching.swift`:

```swift
import Foundation
import MutationCore

// One switched mutant: no build, no edit, one environment variable.

/// The variable the instrumented code reads when the process starts.
let activeMutantVariable = "FIELDMARK_ACTIVE_MUTANT"

/// Runs the suite against the instrumented package with `number` active.
///
/// No file is written and nothing is compiled, so this is the whole cost of a
/// mutant. The verdict comes from the same kill confirmation the old path uses:
/// a parallel run, a re-run of whatever failed, and the whole suite one test at
/// a time when neither settled it.
func runSwitched(_ number: Int, package: String) -> MutantOutcome {
    verdictForMutant(package: package, extraEnvironment: [activeMutantVariable: String(number)])
}
```

- [x] **Step 3: Build it**

```bash
swift build --package-path Tools/CodeQuality --product mutation-runner --disable-sandbox
```

Expected: `Build of product 'mutation-runner' complete!`.

- [x] **Step 4: Check the old path still works end to end**

Nothing has switched to the new path yet, so the runner must behave exactly as it did.

```bash
time ./Scripts/mutate.sh --files Sources/FieldmarkCore/Update/RelaunchCommand.swift \
  --json .build/mutation/relaunch-task8.json
```

Expected: three mutants, the same outcomes as before this plan started.

- [x] **Step 5: Lint, rebuild, commit**

```bash
./Scripts/lint.sh
swift test --package-path Tools/CodeQuality --disable-sandbox
swift build --package-path Tools/CodeQuality --product mutation-runner --disable-sandbox
git add Tools/CodeQuality/Sources/mutation-runner/Support.swift \
        Tools/CodeQuality/Sources/mutation-runner/TestRunning.swift \
        Tools/CodeQuality/Sources/mutation-runner/Switching.swift \
        Tools/CodeQuality/Sources/mutation-runner/main.swift
git commit
```

---

### Task 9: Wire `--switched` into the runner

The flag exists, the old path is still the default, and both write the same JSON.

**Files:**
- Modify: `Tools/CodeQuality/Sources/MutationCore/RunnerArguments.swift`
- Modify: `Tools/CodeQuality/Tests/MutationCoreTests/RunnerArgumentsTests.swift`
- Modify: `Tools/CodeQuality/Sources/mutation-runner/main.swift`

**Interfaces:**
- Consumes: everything above.
- Produces: `RunnerArguments.switched: Bool` and `RunnerArguments.legacy: Bool`.

- [x] **Step 1: Write the failing test**

Add to `RunnerArgumentsTests`:

```swift
    /// Two flags, one behaviour each, and the old path is what you get when you
    /// ask for neither. It stays that way until a full run has been proved to
    /// give the same answers both ways.
    @Test func theSwitchedAndLegacyFlagsParse() throws {
        let plain = try RunnerArguments.parse([])
        #expect(plain.switched == false)
        #expect(plain.legacy == false)

        let switched = try RunnerArguments.parse(["--switched"])
        #expect(switched.switched)

        let legacy = try RunnerArguments.parse(["--legacy", "--files", "a.swift"])
        #expect(legacy.legacy)
        #expect(legacy.files == ["a.swift"])
    }
```

- [x] **Step 2: Run it and watch it fail**

```bash
swift test --package-path Tools/CodeQuality --disable-sandbox --filter RunnerArgumentsTests
```

Expected: the build fails with `value of type 'RunnerArguments' has no member 'switched'`.

- [x] **Step 3: Add the flags**

In `Tools/CodeQuality/Sources/MutationCore/RunnerArguments.swift`, add two properties beside
`listOnly`:

```swift
    /// Compile every mutant into one build and choose between them at run time.
    public var switched = false
    /// One build per mutant, editing a file, the way it has always worked.
    public var legacy = false
```

two cases in the switch:

```swift
            case "--switched":
                parsed.switched = true
            case "--legacy":
                parsed.legacy = true
```

and two lines in the usage text:

```swift
    Usage: mutation-runner [--files <path> ...] [--only <fingerprint> ...]
                           [--survivors-of <run.json|dir> ...] [--list] [--json <path>]
                           [--switched] [--legacy]
    """
```

- [x] **Step 4: Run it and watch it pass**

```bash
swift test --package-path Tools/CodeQuality --disable-sandbox --filter RunnerArgumentsTests
```

Expected: `✔ Test run with 6 tests in 1 suite passed`.

- [x] **Step 5: Use the flag in `main.swift`**

Replace the mutant loop (`for (index, item) in toRun.enumerated() { … }` through the line that
clears the in-flight record) with a choice of path. Add this above the loop:

```swift
// MARK: - Which path

/// The old path is the default until a full run has been proved to agree with
/// the new one. `--switched` asks for the new one; `--legacy` says the old one
/// outright, which is what the default will mean once they swap over.
let wantsSwitching = arguments.switched && !arguments.legacy
```

and put the loop inside a function that both paths share, in `Switching.swift`:

```swift
/// Everything the run decided, in plan order.
struct RunOrder {
    /// Judged in the instrumented build, no rebuild between them.
    var switched: [PlannedMutant] = []
    /// One build each, in the plain copy. Last, because they change a shared
    /// build and cannot overlap with anything.
    var oldPath: [PlannedMutant] = []
}

/// Splits the plan by which path each mutant takes.
///
/// Switched first and old path last, so the expensive ones are at the end and a
/// run that is stopped early has still measured as much as possible.
func splitByPath(_ planned: [PlannedMutant], switched: Set<Int>, numbers: [String: Int]) -> RunOrder {
    var order = RunOrder()
    for item in planned {
        if let number = numbers[item.fingerprint], switched.contains(number) {
            order.switched.append(item)
        } else {
            order.oldPath.append(item)
        }
    }
    return order
}
```

Then in `main.swift`, where the loop was:

```swift
var outcomes: [Outcome] = []
let total = toRun.count
var position = 0

if wantsSwitching {
    let layout = SandboxLayout(root: root.path)
    let sources = targetFiles.compactMap { url -> (path: String, display: String, source: String)? in
        guard let text = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        return (path: url.path, display: relative(url), source: text)
    }
    let switchPlan = SwitchPlan(fingerprintsByFile: fingerprintsByFile)
    let writer = SandboxWriter(layout: layout, plan: switchPlan, files: sources)
    guard writer.takeLock() else {
        logErr(SandboxLayout.lockMessage)
        exit(2)
    }
    defer { writer.releaseLock() }

    do { try writer.writePlain() } catch {
        logErr("Could not write the plain sandbox: \(error)")
        exit(2)
    }
    let prune = pruneUntilItBuilds(writer: writer)
    // … judge the switched mutants, then the old-path ones …
}
```

Keep the old loop as the `else` branch, unchanged, so `--legacy` and the default behave exactly as
they did.

> **Deviation (2026-09-17).** The shape is the plan's; the placement and four
> details are not.
>
> 1. **The block lives in `runSwitchedPath` in `Switching.swift`**, not in
>    `main.swift`, and the old loop moved to a new `LegacyPath.swift` as
>    `judgeInWorkingTree`. `main.swift` was 317 lines and SwiftLint warns at 400.
>    `label(for:)` went to `Support.swift` as the plan says. The legacy run of
>    `RelaunchCommand.swift` is byte-for-byte what it was before the move.
> 2. **The baseline moved inside the branches.** The plan left `main.swift`'s
>    build-and-test of `Tools/CoreMutation` above the `if`, so a switched run paid
>    45 s for a package it never uses. A switched run's baselines are the
>    instrumented suite and, when there are old-path leftovers, the plain
>    sandbox's build. `--legacy` keeps the working-tree stub baseline exactly.
> 3. **`sources` comes from `allCoreSwiftFiles()`, not `targetFiles`** — see Task
>    6's deviation 1. `fingerprintsByFile` is the targets only, so a scoped run
>    numbers and instruments only what it judges.
> 4. **The lock is given back on every path out.** `defer { writer.releaseLock() }`
>    in top-level code never runs, because `main.swift` leaves through `exit()`.
>    A `HeldLock` in `Support.swift` is released by the new `stop(_:_:)`, by the
>    signal handler, and after the run; `takeLock` also clears a lock whose process
>    has gone. A refused run leaves the other run's lock alone (checked).
> 5. **A mutant the prune loop called `compile_error` counts as handled by the
>    switched path**, so `splitByPath` gets `prune.switched ∪ prune.compileErrors`.
>    Without the union those 51 mutants would each pay a plain-package build to be
>    told what the prune loop already knew. Task 11's comparison is what proves the
>    two paths name the same set.
> 6. Outcomes are sorted back into plan order before the summary, so the survivor
>    list reads the same however each mutant was judged. The JSON was already in
>    plan order, because it is written from `reported`.
>
> **Step 6's result.** 22 mutants, `--legacy` and `--switched` byte-identical:
> 12 killed, 4 survived, 6 compile errors, and the same four survivor
> fingerprints. 1 m 55 s legacy against 2 m 55 s switched, the difference being two
> cold sandbox builds; on a warm sandbox the same file's three-mutant neighbour
> `RelaunchCommand.swift` took 21 s switched against 50 s legacy.
>
> **Something the spike did not see.** Round 1 of `ChainSites.swift` reported 23
> × "unable to type-check this expression in reasonable time", and the container
> holding `anywhere(a + b + c + d + e + f) + grocery.map { … }` was dropped to the
> old path. Reproduced in isolation: it is not the closure form and not the copy
> count. One single mutated copy, `globalFastFood - globalPizza` on two `[String]`,
> defeats the type checker on its own — 3.6 s and then it gives up — and an
> explicit `{ () -> [Entry] in … }` result type makes no difference (measured, both
> forms time out identically). So it is a mutant the compiler cannot judge
> quickly, not a flaw in the instrumenting, and the spec's rule 6 handles it
> correctly: the container is dropped, the old path judges the six mutants, and it
> calls them `compile_error` exactly as the reference run does. The rule is worth
> keeping as written rather than deferring the single timing-out mutant: dropping
> one mutant at a time from a container that times out because of its size might
> never converge inside the round cap, and that failure costs a four-hour run.

Because this is the one site where the two paths meet, write it out in full rather than sketching
it. The finished block is:

```swift
if wantsSwitching {
    let layout = SandboxLayout(root: root.path)
    let sources = targetFiles.compactMap { url -> (path: String, display: String, source: String)? in
        guard let text = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        return (path: url.path, display: relative(url), source: text)
    }
    let switchPlan = SwitchPlan(fingerprintsByFile: fingerprintsByFile)
    let writer = SandboxWriter(layout: layout, plan: switchPlan, files: sources)
    guard writer.takeLock() else {
        logErr(SandboxLayout.lockMessage)
        exit(2)
    }
    defer { writer.releaseLock() }

    do {
        try writer.writePlain()
    } catch {
        logErr("Could not write the plain sandbox: \(error)")
        exit(2)
    }

    let prune = pruneUntilItBuilds(writer: writer)
    var numbers: [String: Int] = [:]
    for item in planned {
        if let number = switchPlan.number(ofFingerprint: item.fingerprint) { numbers[item.fingerprint] = number }
    }
    let order = splitByPath(toRun, switched: prune.switched, numbers: numbers)

    guard baselinePasses(package: layout.switchedPackage) else {
        logErr("Baseline tests failed or timed out in the sandbox. Fix the suite before mutation testing.")
        exit(2)
    }
    log("Baseline: the instrumented suite PASSES.")
    log("Switched: \(order.switched.count). Old path: \(order.oldPath.count).")
    log("")

    for item in order.switched {
        position += 1
        let prefix = "[\(position)/\(total)] \(item.mutant.description)"
        guard let number = numbers[item.fingerprint] else { continue }
        let category: Category = prune.compileErrors.contains(number)
            ? .compileError
            : (runSwitched(number, package: layout.switchedPackage) == .killed ? .killed : .survived)
        log("\(prefix) … \(label(for: category))")
        outcomes.append(Outcome(planned: item, category: category))
    }

    // The old path, in the plain copy, one build each.
    guard stubBuildSucceeds(package: layout.plainPackage) else {
        logErr("The plain sandbox does not build. Cannot run the remaining mutants.")
        exit(2)
    }
    for item in order.oldPath {
        position += 1
        let prefix = "[\(position)/\(total)] \(item.mutant.description)"
        let target = URL(filePath: writer.plainSourcePath(forDisplay: item.displayPath))
        guard let original = try? Data(contentsOf: target) else {
            logErr("\(prefix) … skip (unreadable)")
            continue
        }
        inFlight.begin(url: target, originalBytes: original)
        defer { inFlight.restore() }
        do {
            try Data(item.mutant.mutatedSource.utf8).write(to: target)
        } catch {
            inFlight.restore()
            logErr("\(prefix) … FAILED to write mutant: \(error)")
            continue
        }
        let category: Category = if !stubBuildSucceeds(package: layout.plainPackage) {
            .compileError
        } else {
            verdictForMutant(package: layout.plainPackage) == .killed ? .killed : .survived
        }
        inFlight.restore()
        log("\(prefix) … \(label(for: category))")
        outcomes.append(Outcome(planned: item, category: category))
    }
    inFlight.clear()
}
```

The `label(for:)` helper is the switch that already sits inside the old loop; lift it into
`Support.swift` so both paths use it:

```swift
/// What a category prints as.
func label(for category: Category) -> String {
    switch category {
    case .killed: "KILLED"
    case .survived: "SURVIVED"
    case .compileError: "COMPILE_ERROR"
    }
}
```

`fingerprintsByFile` is built where the plan is built. Declare it next to `planned`:

```swift
var fingerprintsByFile: [(file: String, fingerprints: [String], keys: [SiteKey])] = []
```

and change the loop that fills `planned` so the fingerprints are bound rather than iterated
straight through, which is the only edit that block needs:

```swift
    let mutants = Mutator.mutants(forSource: source, path: display)
    let items = MutantFingerprint.fingerprints(for: mutants, source: source)
    for item in items {
        planned.append(PlannedMutant(
            url: file,
            displayPath: display,
            mutant: item.mutant,
            fingerprint: item.fingerprint,
            sourceLine: item.sourceLine,
            occurrence: item.occurrence
        ))
    }
    fingerprintsByFile.append((
        file: display,
        fingerprints: items.map(\.fingerprint),
        keys: items.map { SiteKey(line: $0.mutant.line, column: $0.mutant.column, ruleID: $0.mutant.ruleID) }
    ))
```

- [x] **Step 6: Prove both paths agree on one file**

```bash
swift build --package-path Tools/CodeQuality --product mutation-runner --disable-sandbox
./Scripts/mutate.sh --files Sources/FieldmarkCore/Discovery/ChainSites.swift \
  --json .build/mutation/chain-legacy.json
./Scripts/mutate.sh --switched --files Sources/FieldmarkCore/Discovery/ChainSites.swift \
  --json .build/mutation/chain-switched.json
diff <(sed 's/"generatedOn".*/-/' .build/mutation/chain-legacy.json) \
     <(sed 's/"generatedOn".*/-/' .build/mutation/chain-switched.json) && echo "same verdicts"
```

Expected: `same verdicts`, over the same 22 mutants, and the switched run noticeably faster after
its first build. `ChainSites.swift` is a good first file because the spike found a rule 2 container
in it that the ternary form could not compile and the closure form can.

- [x] **Step 7: Prove the working tree was not touched**

```bash
git status --short
```

Expected: no output. A switched run never writes to `Sources/`.

- [x] **Step 8: Prove the lock works**

```bash
./Scripts/mutate.sh --switched --files Sources/FieldmarkCore/Discovery &
sleep 20
./Scripts/mutate.sh --switched --files Sources/FieldmarkCore/Geocoding
echo "second run exit: $?"
wait
```

Expected: the second run prints `Another mutation run is already running in this checkout.` and
exits 2 while the first carries on.

> **Deviation (2026-09-17).** Done without a second concurrent run, which is timing
> dependent and would have put two builds on a four-core machine at once. Instead
> the two branches were driven directly. A lock naming pid 1 — alive, and not ours,
> so `kill` answers `EPERM` — makes a switched run print the message and exit 2,
> and it leaves that lock in site afterwards. A lock naming pid 99999, which
> cannot exist, makes the run print `Clearing a stale sandbox lock left by process
> 99999` and carry on, and the lock is gone when it finishes.

- [x] **Step 9: Lint, rebuild, commit**

```bash
./Scripts/lint.sh
swift test --package-path Tools/CodeQuality --disable-sandbox
swift build --package-path Tools/CodeQuality --product mutation-runner --disable-sandbox
git add Tools/CodeQuality/Sources/MutationCore/RunnerArguments.swift \
        Tools/CodeQuality/Tests/MutationCoreTests/RunnerArgumentsTests.swift \
        Tools/CodeQuality/Sources/mutation-runner/main.swift \
        Tools/CodeQuality/Sources/mutation-runner/Switching.swift \
        Tools/CodeQuality/Sources/mutation-runner/Support.swift
git commit
```

---

### Task 10: `mutation-triage compare`

The proof in Task 11 is a comparison of two run files. It has to be a command, not a shell
pipeline, because the answer has to be exact and repeatable.

**Files:**
- Create: `Tools/CodeQuality/Sources/MutationTriage/Comparing.swift`
- Create: `Tools/CodeQuality/Tests/MutationTriageTests/ComparingTests.swift`
- Modify: `Tools/CodeQuality/Sources/MutationTriage/CommandLineRunner.swift`

**Interfaces:**
- Consumes: `RunMerging` (Part 1), `MutantRecord`.
- Produces:
  - `public struct OutcomeDifference: Equatable, Sendable` with `public let fingerprint: String`, `public let file: String`, `public let line: Int`, `public let left: MutantOutcome`, `public let right: MutantOutcome`.
  - `public enum Comparing` with
    `public static func differences(left: [MutantRecord], right: [MutantRecord]) -> [OutcomeDifference]`
    and `public static func report(_ differences: [OutcomeDifference], leftName: String, rightName: String) -> String`.
  - `mutation-triage compare <run A> <run B>`, exit 0 when there are none and 1 when there are.

- [x] **Step 1: Write the failing tests**

> **Deviation (2026-09-17).** Three tests added, ten rather than seven:
> `aKillThatBecameASurvivorIsReported` (the difference that would matter most),
> `aMutantOnlyTheRightRunMeasuredIsADifference` (so neither side is privileged),
> and `theCommandRefusesAnythingButTwoRunFiles`. `differences` breaks a tie on
> fingerprint as well as file and line, so two mutants on one line come back in a
> fixed order rather than whichever `sorted` happened to pick.

Create `Tools/CodeQuality/Tests/MutationTriageTests/ComparingTests.swift`:

```swift
import MutationCore
@testable import MutationTriage
import Testing

/// Two runs of the same plan, compared per fingerprint. This is how switching
/// earns the right to become the default: the list it prints has to be empty,
/// or every line on it explained and written down.
@Suite(.serialized) struct ComparingTests {
    private func record(_ fingerprint: String, _ outcome: MutantOutcome, line: Int = 10) -> MutantRecord {
        MutantRecord(
            fingerprint: fingerprint,
            file: "Sources/FieldmarkCore/Discovery/A.swift",
            line: line,
            column: 5,
            rule: "RelationalLtToLe",
            original: "<",
            replacement: "<=",
            sourceLine: "if a < b {}",
            occurrence: 0,
            outcome: outcome
        )
    }

    @Test func twoRunsThatAgreeHaveNoDifferences() {
        let left = [record("a", .killed), record("b", .survived)]
        #expect(Comparing.differences(left: left, right: left).isEmpty)
    }

    @Test func anOutcomeThatChangedIsReportedBothWaysRound() {
        let differences = Comparing.differences(
            left: [record("a", .killed)],
            right: [record("a", .survived)]
        )
        #expect(differences.count == 1)
        #expect(differences.first?.fingerprint == "a")
        #expect(differences.first?.left == .killed)
        #expect(differences.first?.right == .survived)
    }

    /// A mutant only one run knows about is a difference too. It means the two
    /// runs were not of the same plan, which is exactly the kind of mistake
    /// this command exists to catch.
    @Test func aMutantMissingFromOneSideIsADifference() {
        let differences = Comparing.differences(
            left: [record("a", .killed), record("b", .killed)],
            right: [record("a", .killed)]
        )
        #expect(differences.count == 1)
        #expect(differences.first?.fingerprint == "b")
        #expect(differences.first?.right == .planned)
    }

    /// A mutant neither run measured is not a difference. `--only` writes a
    /// `planned` record for everything it did not choose.
    @Test func twoListedMutantsAreNotADifference() {
        #expect(Comparing.differences(left: [record("a", .planned)], right: [record("a", .planned)]).isEmpty)
    }

    @Test func theReportNamesEveryDifferenceAndSaysWhichRunIsWhich() {
        let differences = Comparing.differences(
            left: [record("a", .killed, line: 42)],
            right: [record("a", .survived, line: 42)]
        )
        let text = Comparing.report(differences, leftName: "old.json", rightName: "new.json")
        #expect(text.contains("a"))
        #expect(text.contains("A.swift:42"))
        #expect(text.contains("old.json"))
        #expect(text.contains("new.json"))
        #expect(text.contains("killed"))
        #expect(text.contains("survived"))
    }

    @Test func theReportSaysSoWhenThereIsNothingToSay() {
        let text = Comparing.report([], leftName: "old.json", rightName: "new.json")
        #expect(text.contains("agree"))
    }

    @Test func theCommandExitsOneWhenTheRunsDisagree() throws {
        let directory = FileManager.default.temporaryDirectory
            .appending(path: "compare-\(UUID().uuidString)", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let left = directory.appending(path: "left.json")
        let right = directory.appending(path: "right.json")
        try MutationRunFile(generatedOn: "2026-09-17", scope: [], mutants: [record("a", .killed)])
            .write(to: left.path)
        try MutationRunFile(generatedOn: "2026-09-17", scope: [], mutants: [record("a", .survived)])
            .write(to: right.path)

        var printed = ""
        let runner = CommandLineRunner(
            root: directory.path,
            output: { printed += $0 + "\n" },
            errorOutput: { printed += $0 + "\n" }
        )
        #expect(runner.run(["compare", left.path, right.path]) == 1)
        #expect(printed.contains("a"))

        try MutationRunFile(generatedOn: "2026-09-17", scope: [], mutants: [record("a", .killed)])
            .write(to: right.path)
        #expect(runner.run(["compare", left.path, right.path]) == 0)
    }
}
```

- [x] **Step 2: Run the tests and watch them fail**

```bash
swift test --package-path Tools/CodeQuality --disable-sandbox --filter ComparingTests
```

Expected: the build fails with `cannot find 'Comparing' in scope`.

- [x] **Step 3: Write the implementation**

Create `Tools/CodeQuality/Sources/MutationTriage/Comparing.swift`:

```swift
import Foundation
import MutationCore

/// One fingerprint the two runs disagree about.
public struct OutcomeDifference: Equatable, Sendable {
    public let fingerprint: String
    public let file: String
    public let line: Int
    public let left: MutantOutcome
    public let right: MutantOutcome

    public init(fingerprint: String, file: String, line: Int, left: MutantOutcome, right: MutantOutcome) {
        self.fingerprint = fingerprint
        self.file = file
        self.line = line
        self.left = left
        self.right = right
    }
}

/// Comparing two runs of the same plan.
///
/// Written for one job: proving that compiling every mutant into one build
/// gives the answers the old way gave. A mutant either run measured and the
/// other did not is a difference as well, because it means the two runs were
/// not of the same plan.
public enum Comparing {
    public static func differences(left: [MutantRecord], right: [MutantRecord]) -> [OutcomeDifference] {
        let rightByFingerprint = Dictionary(right.map { ($0.fingerprint, $0) }, uniquingKeysWith: { _, last in last })
        var seen: Set<String> = []
        var found: [OutcomeDifference] = []

        for record in left {
            seen.insert(record.fingerprint)
            let other = rightByFingerprint[record.fingerprint]
            let otherOutcome = other?.outcome ?? .planned
            guard record.outcome != otherOutcome else { continue }
            found.append(OutcomeDifference(
                fingerprint: record.fingerprint,
                file: record.file,
                line: record.line,
                left: record.outcome,
                right: otherOutcome
            ))
        }
        for record in right where !seen.contains(record.fingerprint) && record.outcome != .planned {
            found.append(OutcomeDifference(
                fingerprint: record.fingerprint,
                file: record.file,
                line: record.line,
                left: .planned,
                right: record.outcome
            ))
        }
        return found.sorted {
            if $0.file != $1.file { return $0.file < $1.file }
            return $0.line < $1.line
        }
    }

    public static func report(
        _ differences: [OutcomeDifference],
        leftName: String,
        rightName: String
    ) -> String {
        guard !differences.isEmpty else {
            return "The two runs agree on every mutant."
        }
        var lines = ["\(differences.count) mutant(s) differ. \(leftName) first, \(rightName) second.", ""]
        for difference in differences {
            lines.append(
                "  \(difference.fingerprint)  \(difference.file):\(difference.line)  "
                    + "\(difference.left.rawValue) -> \(difference.right.rawValue)"
            )
        }
        return lines.joined(separator: "\n")
    }
}
```

In `Tools/CodeQuality/Sources/MutationTriage/CommandLineRunner.swift`, add the command to the
switch:

```swift
            case "compare": return try compare(args)
```

the method:

```swift
    /// Two run files, compared per fingerprint. Exit 1 when they differ, so a
    /// script can gate on it.
    func compare(_ args: Arguments) throws -> Int32 {
        let paths = args.positional
        guard paths.count == 2 else {
            throw TriageError.badArguments("compare needs two run files: compare <run A> <run B>")
        }
        let left = try RunLoading.load(paths: [absolutePath(paths[0])])
        let right = try RunLoading.load(paths: [absolutePath(paths[1])])
        let differences = Comparing.differences(left: left, right: right)
        output(Comparing.report(differences, leftName: paths[0], rightName: paths[1]))
        return differences.isEmpty ? 0 : 1
    }
```

and a line in the usage text, under `render`:

```swift
      compare <run A> <run B>                    every mutant the two runs disagree about
```

- [x] **Step 4: Run the tests and watch them pass**

```bash
swift test --package-path Tools/CodeQuality --disable-sandbox --filter ComparingTests
```

Expected: `✔ Test run with 7 tests in 1 suite passed`.

- [x] **Step 5: Try it by hand**

```bash
./Scripts/mutate-triage.sh compare .build/mutation/chain-legacy.json .build/mutation/chain-switched.json
echo "exit: $?"
```

Expected: `The two runs agree on every mutant.` and `exit: 0`.

- [x] **Step 6: Lint, rebuild, commit**

```bash
./Scripts/lint.sh
swift test --package-path Tools/CodeQuality --disable-sandbox
git add Tools/CodeQuality/Sources/MutationTriage/Comparing.swift \
        Tools/CodeQuality/Tests/MutationTriageTests/ComparingTests.swift \
        Tools/CodeQuality/Sources/MutationTriage/CommandLineRunner.swift
git commit
```

---

### Task 11: Prove a whole run gives the same answers

Nothing switches by default until this passes. The reference is the old runner's own output from
2026-09-17, run against commit `7c55454`, so the comparison is against the same sources and the
same tests rather than against a moving target.

**Files:**
- Read: `docs/superpowers/plans/2026-09-17-old-path-reference-run.json`
- Create: nothing. This task writes findings into the commit message and, if anything differs, into the spec.

**Interfaces:**
- Consumes: `mutation-triage compare` (Task 10), `--switched` (Task 9).
- Produces: a decision. Either the runs agree, or every difference is explained in writing.

- [x] **Step 1: Check the reference run is there and is the raw old-path run**

```bash
test -f docs/superpowers/plans/2026-09-17-old-path-reference-run.json \
  || { echo "STOP: the reference run is not committed yet. Ask for it before going on."; exit 1; }
grep -c '"fingerprint"' docs/superpowers/plans/2026-09-17-old-path-reference-run.json
grep -c '"outcome" : "planned"' docs/superpowers/plans/2026-09-17-old-path-reference-run.json
grep -m1 '"generatedOn"' docs/superpowers/plans/2026-09-17-old-path-reference-run.json
```

Expected: `1697`, then `0`, then `"generatedOn" : "2026-09-17"`. If the count is not 1697, or any
mutant is `planned`, or the date is before 2026-09-17, stop and say so: the file is not the run
this proof needs, and comparing against the wrong one would give a false pass. Do not use
`docs/mutation-run.json` for this. That file holds the picture after triage, where mutants that
have since been hardened read as killed, so it no longer describes commit `7c55454`.

- [x] **Step 2: Make a scratch worktree at the commit the reference run measured**

> **Deviation (2026-09-17).** No scratch worktree. Steps 2, 3 and 7 were done inside this
> worktree instead: `rm -rf Sources/FieldmarkCore Tests/FieldmarkCoreTests` and then
> `git checkout 7c55454 -- Sources/FieldmarkCore Tests/FieldmarkCoreTests`, which gives
> exactly the sources and tests the reference measured — `--list` says 1,697,
> against 1,690 at HEAD — and restores with the same two commands against `HEAD`.
> The `rm -rf` matters: `git checkout <commit> -- <dir>` does not delete files the
> commit lacks, and `Agent/AgentClock.swift` plus six new test files would have
> been left behind. Done this way because a new worktree writes to the shared
> `.git` that other sessions are using, and because everything this way stays
> inside the one directory this agent owns. The sandbox sync was checked against
> the swapped tree before the run: the tests match file for file, `AgentClock.swift`
> is gone from `.build/mutation-sandbox`, and the plain copy matches too.

```bash
git worktree add --detach /tmp/mutation-proof 7c55454
cd /tmp/mutation-proof
git log --oneline -1
```

Expected: `7c55454 chore: delete old plans`.

- [x] **Step 3: Bring the new runner into that worktree**

The worktree is at `7c55454`, which predates all of this work, so it has the old runner. Check out
just the tool and the scripts from the branch, leaving `Sources/FieldmarkCore` and
`Tests/FieldmarkCoreTests` exactly as `7c55454` had them.

```bash
git checkout mutation-speedups -- Tools/CodeQuality Scripts/mutate.sh Scripts/mutate-triage.sh
git status --short | head
```

Expected: the tool and the two scripts show as staged changes, and nothing under
`Sources/FieldmarkCore` or `Tests/FieldmarkCoreTests` is listed. If anything under those two is listed,
stop: the comparison would be against different code.

- [x] **Step 4: Run the whole module the new way**

This is a long run. Expect somewhere near an hour and a half.

```bash
time ./Scripts/mutate.sh --switched --json /tmp/mutation-proof-switched.json
```

Expected: a summary line, and a run file with 1,697 mutant records.

- [x] **Step 5: Compare**

```bash
cd /home/dev/src/fieldmark/.claude/worktrees/mutation-speedups
./Scripts/mutate-triage.sh compare \
  docs/superpowers/plans/2026-09-17-old-path-reference-run.json \
  /tmp/mutation-proof-switched.json
echo "exit: $?"
```

Expected: `The two runs agree on every mutant.` and `exit: 0`.

> **Result (2026-09-17).** It took two runs. The first differed on exactly one mutant of 1,697 —
> `Outings/OutingActivity.swift:89`, `survived` in the reference and `compile_error` under switching —
> and the cause was the prune loop trusting the compiler's attribution: a `switch` that will not
> type-check is blamed on its **first** `case`, whichever case is at fault, so an innocent mutant
> was left out for its sibling's `String - String` and then recorded as a compile error. Fixed by
> never recording `compile_error` from the shared build: every mutant it cannot carry goes down the
> old path, which compiles it alone. The whole finding is written into the spec under
> `### The full comparison (2026-09-17)`.
>
> The second run **agrees on every mutant**: 1,427 killed, 216 survived, 54 compile errors, each
> count identical to the reference and no fingerprint differing. 1 h 34 min, 3.3 s a mutant against
> the reference's 8.5 s. 1,626 switched; 71 on the old path (4 with no container, 22 in three
> dropped containers, 45 the shared build could not carry). The run file is committed at
> `docs/superpowers/plans/2026-09-17-switched-run.json` so the comparison can be repeated.

If it is not empty, do not go on to Task 12. For each difference, find the cause and write it down:

- Read the mutant's line and its container kind: `./Scripts/mutate.sh --list --json /tmp/plan.json --files <that file>` and the instrumented copy under `.build/mutation-sandbox/<that path>`.
- A mutant that is `killed` in the reference and `survived` under switching is the serious kind. It
  means the copy does not mean what the old path's edit meant. Suspect the container choice first.
- A mutant that is `compile_error` on one side and a result on the other means the prune loop
  blamed the wrong thing, or a type-check timeout was recorded as a compile error.
- A mutant that is `survived` in the reference and `killed` under switching is usually a flaky
  test. Run it both ways again before writing it down as a real difference.

Every difference and its cause goes into the spec, appended to the "Spike findings" section under
a heading `### The full comparison (date)`.

- [x] **Step 6: Check the planner really was not touched**

```bash
cd /home/dev/src/fieldmark/.claude/worktrees/mutation-speedups
git diff 7ce4803 --stat -- Tools/CodeQuality/Sources/MutationCore/Mutator.swift \
                            Tools/CodeQuality/Sources/MutationCore/Fingerprint.swift \
                            docs/mutation-survivors.json
```

Expected: no output. The plan, the fingerprints and the ledger are exactly what they were before
any of this started, which is why a verdict recorded last month still points at the same mutant.

> **Result (2026-09-17).** `Mutator.swift` and `Fingerprint.swift`: no output against `7ce4803`, so
> untouched since before any of this work. `docs/mutation-survivors.json` does differ from
> `7ce4803` — 2,456 lines of verdicts part 1 recorded — but not from `2a0a016`, the commit this
> plan started at, so *this* plan has not touched it.

- [x] **Step 7: Clean up the scratch worktree**

```bash
git worktree remove --force /tmp/mutation-proof
git worktree list
```

Expected: `/tmp/mutation-proof` is gone.

- [x] **Step 8: Commit the finding**

```bash
git add docs/superpowers/specs/2026-09-17-faster-mutation-runs-design.md
git commit
```

Commit even if nothing changed in the spec, with a message recording the result of the comparison,
the wall-clock time of the switched run and the seconds per mutant. If nothing needed appending to
the spec, commit the run file instead at `docs/superpowers/plans/2026-09-17-switched-run.json`, so
the evidence is in the repository rather than in a terminal that is now closed.

---

### Task 12: Make switching the default

**Files:**
- Modify: `Tools/CodeQuality/Sources/MutationCore/RunnerArguments.swift`
- Modify: `Tools/CodeQuality/Tests/MutationCoreTests/RunnerArgumentsTests.swift`
- Modify: `Tools/CodeQuality/Sources/mutation-runner/main.swift`
- Modify: `docs/mutation-testing.md`
- Modify: `.claude/skills/mutation-triage/SKILL.md`

**Interfaces:**
- Consumes: Task 11's proof.
- Produces: `--legacy` is the only way to get the old path.

- [x] **Step 1: Write the failing test**

Change the flag test in `RunnerArgumentsTests` to the new default and add one:

```swift
    /// Switching is the default now that a whole run has been compared against
    /// the old path. `--legacy` is kept because the old path is still how a
    /// mutant with no container is judged, and because it is the fallback when
    /// something about the sandbox goes wrong.
    @Test func switchingIsTheDefaultAndLegacyTurnsItOff() throws {
        #expect(try RunnerArguments.parse([]).switched)
        #expect(try RunnerArguments.parse(["--legacy"]).switched == false)
        #expect(try RunnerArguments.parse(["--legacy"]).legacy)
    }
```

Delete `theSwitchedAndLegacyFlagsParse`, which asserted the old default.

- [x] **Step 2: Run it and watch it fail**

```bash
swift test --package-path Tools/CodeQuality --disable-sandbox --filter RunnerArgumentsTests
```

Expected: `switchingIsTheDefaultAndLegacyTurnsItOff` fails on the first line.

- [x] **Step 3: Flip it**

In `RunnerArguments`, change the default and make `--legacy` clear it:

```swift
    /// Compile every mutant into one build and choose between them at run time.
    /// The default since the whole module was proved to give the same answers
    /// both ways.
    public var switched = true
    /// One build per mutant, editing a file in the plain copy of the sandbox.
    public var legacy = false
```

```swift
            case "--switched":
                parsed.switched = true
            case "--legacy":
                parsed.legacy = true
                parsed.switched = false
```

In `main.swift`, `wantsSwitching` becomes:

```swift
let wantsSwitching = arguments.switched
```

- [x] **Step 4: Run it and watch it pass**

```bash
swift test --package-path Tools/CodeQuality --disable-sandbox
```

Expected: every test passes.

- [x] **Step 5: Measure what a scoped run costs now**

```bash
swift build --package-path Tools/CodeQuality --product mutation-runner --disable-sandbox
time ./Scripts/mutate.sh --files Sources/FieldmarkCore/Discovery/ChainSites.swift \
  --json .build/mutation/chain-default.json
time ./Scripts/mutate.sh --legacy --files Sources/FieldmarkCore/Discovery/ChainSites.swift \
  --json .build/mutation/chain-legacy2.json
./Scripts/mutate-triage.sh compare .build/mutation/chain-default.json .build/mutation/chain-legacy2.json
```

Expected: `The two runs agree on every mutant.`, and the default run faster than `--legacy` once
the sandbox is warm. Write both wall-clock times down; the docs quote them in the next step.

> **Result (2026-09-17).** They agree on all 22. `ChainSites.swift` with the sandbox warm:
> **1 m 09 s** the default way against **1 m 55 s** under `--legacy`, so 3.1 s a mutant against
> 5.2 s. The first default run after the sources changed took 1 m 49 s, because the whole
> instrumented package is rebuilt when any file moves — the warm figure is the one to quote, and it
> is the figure a scoped re-check actually pays. Six of this file's 22 mutants are on the old path,
> so the switched ones are cheaper than 3.1 s each; the whole-module run measures 3.3 s a mutant
> across 1,697 including both cold builds.

- [x] **Step 6: Update `docs/mutation-testing.md`**

Above the generated block, replace the paragraph that warns about two runs in one checkout:

````markdown
A run no longer edits the working tree. The sources are copied into a throwaway package under
`.build/mutation-sandbox`, where every mutant of every file exists at once and one environment
variable chooses between them, so editing, committing and running tests while a mutation run is
going are all safe. A second run in the same checkout stops at a lock with a message rather than
corrupting the first. The few mutants that cannot be compiled that way, about 4 in 100, are run in
a plain copy at `.build/mutation-plain`, one build each, at the end.

```bash
# The old path, one build per mutant, if you ever need to compare:
./Scripts/mutate.sh --legacy --files Sources/FieldmarkCore/Persistence/Slug.swift
```
````

and put the measured per-mutant figure from Step 5 in site of the one Part 1's plan left there.

- [x] **Step 7: Update the triage skill**

In `.claude/skills/mutation-triage/SKILL.md`, delete the sentence warning that two runs in one
checkout corrupt each other, and add one line under the verification block:

```markdown
A run does not touch the working tree, so you can keep editing while one is going. A second run in
the same checkout stops at a lock instead of spoiling the first.
```

- [x] **Step 8: Lint, rebuild, commit**

```bash
./Scripts/lint.sh
swift test --package-path Tools/CodeQuality --disable-sandbox
swift build --package-path Tools/CodeQuality --product mutation-runner --disable-sandbox
git add Tools/CodeQuality/Sources/MutationCore/RunnerArguments.swift \
        Tools/CodeQuality/Tests/MutationCoreTests/RunnerArgumentsTests.swift \
        Tools/CodeQuality/Sources/mutation-runner/main.swift \
        docs/mutation-testing.md .claude/skills/mutation-triage/SKILL.md
git commit
```

---

## What this plan does not do

- **It does not run mutants side by side.** One suite at a time, as today. That is part 3, and it
  is where the remaining time goes: after this plan a mutant costs one suite run, about 3.3 s
  through `swift test` with today's suite and about 1.5 s once part 1d's work has landed.
- **It does not change the planner.** `Mutator` and `Fingerprint` are untouched, on purpose.
- **It does not remove the old path.** Four mutants in this module have no container, a handful
  more lose theirs to the prune loop, and `--legacy` is the way back if the sandbox ever misleads.
- **It does not make the instrumenter handle what Core does not have.** Rule 1 covers deinitializers,
  accessors and subscripts, and Task 1 pins them with fixtures, but no mutant in `FieldmarkCore` sits
  in one today, so they have never been compiled for real.
