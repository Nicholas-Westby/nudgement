# Field Notes, part 1: the document, its store, merging and the model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. In this project one implementer carries the whole plan (Robin's rule: few agents per feature), so execute it task by task yourself with superpowers:test-driven-development; do not start subagents.

**Goal:** Everything Field Notes needs below the UI: the versioned JSON document, its store and image files, the three-way merge and fractional sort keys that keep edits from being lost, and the `@MainActor` model the editor (part 2) and sharing (part 3) plug into.

**Architecture:** Pure Foundation types and functions in FieldmarkCore (`Sources/FieldmarkCore/FieldNotes/`), a store in `Sources/FieldmarkCore/Persistence/`, and `FieldNotesModel` in FieldmarkPresentation, owned by `SurveyDetailModel` and wired by `DetailOrError`. No SwiftUI or AppKit in any of it (`LayeringTests` enforces this). No visible UI in this part.

**Tech Stack:** Swift 6 (strict concurrency), Swift Testing, macOS 14 deployment target, the repo's `JSONFile`, `FileSystem`, `ImageEncoding`, `StoreObserverBox`.

**Spec:** `docs/superpowers/specs/2026-09-25-field-notes-design.md`. Read it whole before starting. The research behind it lives in `/home/dev/src/temp-fieldmark-field-notes/`: read `research-rich-text.md` (the schema's origin) and `grounding-storage-sharing.md` §1, §2, §6–§9 (how stores, the observer and the bundle work). The throwaway prototype `/home/dev/src/temp-fieldmark-field-notes/probes/KitModel.swift` shows a working Codable shape for most of this schema.

## Global Constraints

- Work in `/home/dev/src/fieldmark/.claude/worktrees/field-notes` (branch `field-notes`) only; `cd` there in every command; never touch `/home/dev/src/fieldmark` itself.
- Deployment target macOS 14; Swift 6 language mode; no new package dependencies.
- FieldmarkCore, FieldmarkServices and FieldmarkPresentation import no AppKit, SwiftUI, MapKit, CoreLocation or WebKit (`Tests/FieldmarkCoreTests/LayeringTests.swift`).
- JSON goes through `JSONFile` (pretty, sorted keys, ISO 8601, atomic write). Ids are uppercase `uuidString`s.
- File names: `field-notes.json` and the folder `field-notes/images/` at the survey root; UUID image names.
- Format id `"fieldmark.field-notes"`, `currentVersion = 1`.
- Limits: 16 KiB of text per document block, 32 KiB per note body.
- Words: "Field Notes" for the document; never call it "notes" alone in user-facing text or in type names (`SiteOfInterest.notes` already exists).
- Commits: Conventional Commits via `house-style:how-to-commit`, no trailers, explicit paths, one logical change each. Gates before the final report: `./Scripts/build.sh`, `./Scripts/test.sh`, `./Scripts/lint.sh` (then `git diff`: swiftformat can break `#expect`).
- Pre-existing bugs met in touched files: fix test-first in their own commit and report them.

## Review Focus

- **A document written by a newer app** (unknown block type, inline type, mark, or key on any object): loading and saving it with this build keeps every unknown piece value-for-value. Pinned in Task 2.
- **A file that will not decode, or needs a newer reader:** `load()` reports it and `save()` refuses to write over it, ever. Pinned in Task 6.
- **The same block edited on two sides with the same base** (a checklist ticked on one side while its text is edited on the other; two people adding notes to the same words): both changes survive. Pinned in Task 5.
- **An editor holding a stale base** (the file changed underneath it: a remote page, a control-API edit): saving never deletes or reverts what it did not change. Pinned in Task 7.
- **A save scheduled for an outing that has since been deleted:** nothing is written, so the folder is not recreated. Pinned in Task 8.

---

## File structure

| File | Responsibility |
| --- | --- |
| `Sources/FieldmarkCore/FieldNotes/JSONValue.swift` | Any JSON value, for content this build does not understand |
| `Sources/FieldmarkCore/FieldNotes/FieldNotesDocument.swift` | The document, blocks, inline items, highlight notes, site snapshot: types only |
| `Sources/FieldmarkCore/FieldNotes/FieldNotesDocument+Codable.swift` | Tolerant Codable with unknown-key preservation |
| `Sources/FieldmarkCore/FieldNotes/FieldNotesNormalizing.swift` | Run merging, mark ordering, text limits |
| `Sources/FieldmarkCore/FieldNotes/FieldNotesVersioning.swift` | Who may edit, migrations on raw JSON |
| `Sources/FieldmarkCore/FieldNotes/FractionalIndex.swift` | Sort keys between neighbours, minimal re-keying |
| `Sources/FieldmarkCore/FieldNotes/FieldNotesMerge.swift` | Three-way merge of a block and of a note |
| `Sources/FieldmarkCore/FieldNotes/FieldNotesDiff.swift` | Character diff used by the merge (Myers) |
| `Sources/FieldmarkCore/FieldNotes/FieldNotesSaving.swift` | Editor snapshot + base + disk → saved document + editor patch; document → document patch |
| `Sources/FieldmarkCore/FieldNotes/FieldNotesQueries.swift` | Detached notes, notes under an id, site cards in a document |
| `Sources/FieldmarkCore/Persistence/FieldNotesStore.swift` | Load, save, report; image files |
| `Sources/FieldmarkCore/Persistence/ImageEncoding.swift` (modify) | Two defaulted port methods: measure, and re-encode to a given side |
| `Sources/FieldmarkCore/Persistence/SurveyLibrary.swift` (modify) | `fieldNotesStore(for:)` |
| `Sources/FieldmarkCore/Persistence/SurveyChangeObserver.swift` (modify) | `fieldNotesSaved(surveyID:notes:)` |
| `Sources/FieldmarkPresentation/FieldNotes/FieldNotesModel.swift` | The `@MainActor @Observable` model |
| `Sources/FieldmarkPresentation/FieldNotes/FieldNotesModel+Edits.swift` | Edits that go through the model (control API, commands) |
| `Sources/FieldmarkPresentation/FieldNotes/FieldNotesModel+Sites.swift` | Site cards: snapshots, refresh, deletion |
| `Sources/FieldmarkPresentation/FieldNotes/FieldNotesEditing.swift` | The protocol the editor implements |
| `Sources/FieldmarkPresentation/Detail/SurveyDetailModel.swift` (modify) | Owns the model; deletion hook; load hook |
| `Sources/FieldmarkUI/DetailOrError.swift` (modify) | Creates the store, installs the model, share seams |
| Tests: `Tests/FieldmarkCoreTests/FieldNotes*Tests.swift`, `FractionalIndexTests.swift`, `Tests/FieldmarkPresentationTests/FieldNotesModel*Tests.swift` | |

---

### Task 1: `JSONValue`

**Files:**
- Create: `Sources/FieldmarkCore/FieldNotes/JSONValue.swift`
- Test: `Tests/FieldmarkCoreTests/JSONValueTests.swift`

**Interfaces:**
- Produces: `public enum JSONValue: Codable, Hashable, Sendable { case null, bool(Bool), integer(Int), number(Double), string(String), array([JSONValue]), object([String: JSONValue]) }`

- [ ] **Step 1: Write the failing tests**

```swift
import Foundation
import Testing
@testable import FieldmarkCore

struct JSONValueTests {
    private func roundOuting(_ json: String) throws -> JSONValue {
        let value = try JSONFile.decode(JSONValue.self, from: Data(json.utf8))
        return try JSONFile.decode(JSONValue.self, from: JSONFile.encode(value))
    }

    @Test func everyKindOfValueSurvivesARoundOuting() throws {
        let json = #"{"a":null,"b":true,"c":3,"d":2.5,"e":"x","f":[1,"y",{"g":false}]}"#
        let original = try JSONFile.decode(JSONValue.self, from: Data(json.utf8))
        #expect(try roundOuting(json) == original)
    }

    @Test func aWholeNumberStaysAWholeNumber() throws {
        let value = try JSONFile.decode(JSONValue.self, from: Data("[7]".utf8))
        #expect(value == .array([.integer(7)]))
        #expect(String(decoding: try JSONFile.encode(value), as: UTF8.self).contains("7"))
        #expect(!String(decoding: try JSONFile.encode(value), as: UTF8.self).contains("7.0"))
    }

    @Test func aBooleanIsNeverReadAsANumber() throws {
        #expect(try JSONFile.decode(JSONValue.self, from: Data("[true]".utf8)) == .array([.bool(true)]))
    }
}
```

- [ ] **Step 2: Run to see them fail** — `./Scripts/test.sh --filter JSONValueTests` (expect: cannot find `JSONValue`).
- [ ] **Step 3: Implement** — a `singleValueContainer` decode trying, in order: `decodeNil`, `Bool`, `Int`, `Double`, `String`, `[JSONValue]`, `[String: JSONValue]`; encode the matching case. `Bool` before `Int` matters (JSONDecoder does not coerce, but keep the order explicit and commented).
- [ ] **Step 4: Run to see them pass.**
- [ ] **Step 5: Commit** — `feat(notes): add an any-JSON value for content from newer versions`.

---

### Task 2: The document types and their tolerant Codable

**Files:**
- Create: `Sources/FieldmarkCore/FieldNotes/FieldNotesDocument.swift`, `FieldNotesDocument+Codable.swift`, `FieldNotesNormalizing.swift`
- Test: `Tests/FieldmarkCoreTests/FieldNotesDocumentCodingTests.swift`, `FieldNotesNormalizingTests.swift`, fixtures under `Tests/FieldmarkCoreTests/Fixtures/FieldNotes/` (`v1-full.json`, `v1-from-newer.json`) loaded with `Bundle.module` if the target already has resources, otherwise as string literals in a `FieldNotesFixtures.swift` (check how existing Core tests load fixtures and match it).

**Interfaces:**
- Produces (all `public`, `Equatable`, `Sendable`):

```swift
public struct FieldNotesDocument {
    public static let format = "fieldmark.field-notes"
    public static let currentVersion = 1
    public static let empty = FieldNotesDocument(formatVersion: currentVersion, minReaderVersion: 1, blocks: [], notes: [])
    public var formatVersion: Int
    public var minReaderVersion: Int
    public var blocks: [NoteBlock]          // document order is (sort, id); removed blocks kept
    public var notes: [HighlightNote]       // flat; nesting via `parent`
    public var extra: [String: JSONValue] = [:]
}

public struct NoteBlock: Identifiable {
    public var id: UUID
    public var sort: String?                // required on document blocks, nil in note bodies
    public var kind: NoteBlockKind
    public var content: [NoteInline]
    public var createdBy: UUID?, createdAt: Date?, editedBy: UUID?, editedAt: Date?
    public var removed: Bool = false
    public var minReaderVersion: Int?       // nil means 1
    public var extra: [String: JSONValue] = [:]
}

public enum NoteListStyle: String, Codable, Sendable { case bullet, number, check }

public enum NoteBlockKind: Hashable, Sendable {
    case paragraph
    case heading(level: Int)                            // 1 Title, 2 Heading, 3 Subheading
    case listItem(style: NoteListStyle, indent: Int, checked: Bool)   // indent 0...5
    case unknown(type: String, fields: [String: JSONValue])          // a newer block type, kept whole
}

public enum NoteInline: Hashable, Sendable {
    case text(NoteText)
    case image(NoteImage)
    case site(NoteSiteCard)
    case unknown(JSONValue)
}

public struct NoteText: Hashable, Sendable {
    public var text: String
    public var marks: [String] = []          // "bold","italic","underline","strike","code", plus unknown names kept
    public var link: String?
    public var notes: [UUID] = []            // highlight notes covering this run
    public var extra: [String: JSONValue] = [:]
}
public struct NoteImage: Hashable, Sendable { public var file: String; public var width: Int; public var height: Int; public var alt: String?; public var notes: [UUID] = []; public var extra: [String: JSONValue] = [:] }
public struct NoteSiteCard: Hashable, Sendable { public var siteID: UUID; public var snapshot: SiteSnapshot; public var notes: [UUID] = []; public var extra: [String: JSONValue] = [:] }
public struct SiteSnapshot: Hashable, Sendable { public var name: String; public var category: String; public var summary: String?; public var photo: String?; public var sourcePhoto: String?; public var isFavorite: Bool; public var takenAt: Date; public var extra: [String: JSONValue] = [:] }

public struct HighlightNote: Identifiable {
    public var id: UUID
    public var parent: UUID?                 // nil: its words are in the document
    public var author: UUID
    public var createdAt: Date
    public var editedAt: Date?
    public var body: [NoteBlock]
    public var removed: Bool = false
    public var minReaderVersion: Int?
    public var extra: [String: JSONValue] = [:]
}
```

JSON keys exactly as in the spec's schema: block `type` (`paragraph`/`heading`/`listItem`/other), `level`, `style`, `indent`, `checked`, `content`; inline text runs have no `type`; `image` has `type:"image"`, `file`, `width`, `height`, `alt`; site has `type:"site"`, `siteId`, `snapshot`; runs `marks`, `link`, `notes`. Omit empty arrays, `false` `removed`, nil optionals, `indent` 0; always write `checked` for `check` items. Unknown keys on every object go to `extra` and back out.

- [ ] **Step 1: Write the failing tests** (names are the contract; write each as a real `@Test`):
  - `aFullDocumentRoundOutingsThroughJSON` — `v1-full.json` (every block kind, every inline kind, all five marks, a link, overlapping note ids, a nested note with `parent`, a removed block, an emoji and a U+2028): decode → encode → decode is equal, and equal to a hand-built `FieldNotesDocument`.
  - `contentFromANewerVersionIsKeptVerbatim` — `v1-from-newer.json` with a block `{"type":"table",...}`, an inline `{"type":"mention",...}`, a mark `"superscript"`, and an unknown key on the document, a block, a run, a note and a snapshot: decode, change one other block's text, encode, decode again: the unknown pieces equal the originals (compare as `JSONValue` via `JSONFile.decode(JSONValue.self, …)` on the relevant sub-objects).
  - `aMissingOptionalFieldTakesItsDefault` — a block with no `removed`, no `indent`, no `content`.
  - `anEmptyDocumentEncodesTheFormatAndVersion` — `.empty` encodes `format`, `formatVersion: 1`, `minReaderVersion: 1`, empty `blocks` and `notes`.
  - `idsAreWrittenUppercase` — a lowercase id in the input comes back uppercase after a round outing (the app's convention).
  - Normalizing (`FieldNotesNormalizingTests`): `adjacentRunsWithTheSameMarksMerge`, `emptyRunsAreDropped`, `marksAreSortedAndUnique`, `noteIDsAreSortedAndUnique`, `aNewlineInsideARunSplitsNothingButIsReplaced` (a `\n` inside run text becomes U+2028; the model never holds a newline inside a block), `aBlockOverTheTextLimitIsReportedNotTruncated` (`NoteBlock.textLength` in UTF-16 units and `FieldNotesLimits.blockText == 16 * 1024`).
- [ ] **Step 2: Run** `./Scripts/test.sh --filter FieldNotes` — fails to compile.
- [ ] **Step 3: Implement** the types, then Codable in the `+Codable` file with a `struct AnyCodingKey: CodingKey` to collect unknown keys. Normalizing: `extension NoteBlock { public func normalized() -> NoteBlock }` and `extension [NoteInline] { public func normalizedRuns() -> [NoteInline] }`; `public enum FieldNotesLimits { public static let blockText = 16 * 1024; public static let noteBody = 32 * 1024 }`.
- [ ] **Step 4: Run** — passes.
- [ ] **Step 5: Commit** — `feat(notes): add the Field Notes document and its JSON form`.

---

### Task 3: Versioning and migrations

**Files:**
- Create: `Sources/FieldmarkCore/FieldNotes/FieldNotesVersioning.swift`
- Test: `Tests/FieldmarkCoreTests/FieldNotesVersioningTests.swift`

**Interfaces:**

```swift
public enum FieldNotesAccess: Equatable, Sendable {
    case editable
    case readOnly(FieldNotesReadOnlyReason)
}
public enum FieldNotesReadOnlyReason: Equatable, Sendable {
    case needsNewerVersion(Int)      // the highest minReaderVersion found
    case unreadable(String)          // the decoding error, for logs and /state; never shown raw to the user
}
public extension FieldNotesDocument {
    /// The highest `minReaderVersion` on the document, any block, any note.
    var requiredReaderVersion: Int { get }
    var access: FieldNotesAccess { get }      // readOnly(.needsNewerVersion) when requiredReaderVersion > currentVersion
}
public enum FieldNotesMigration {
    /// Steps from version n to n+1, applied to raw JSON before decoding. Empty for v1.
    public static var steps: [Int: @Sendable (JSONValue) throws -> JSONValue] { get }
    /// Runs every step from the file's `formatVersion` up to `currentVersion`.
    public static func migrate(_ raw: JSONValue, steps: [Int: @Sendable (JSONValue) throws -> JSONValue] = steps) throws -> JSONValue
}
```

- [ ] **Step 1: Failing tests:** `aDocumentNeedingANewerReaderIsReadOnly` (document `minReaderVersion: 2`); `aBlockNeedingANewerReaderMakesTheWholeDocumentReadOnly`; `aNoteNeedingANewerReaderMakesTheWholeDocumentReadOnly`; `aDocumentFromThisVersionIsEditable`; `migrationRunsEveryStepInOrder` (inject steps 0→1 and 1→2 on a fake `formatVersion: 0` document with `currentVersion` passed in, each appending to a list, assert order and the final `formatVersion`); `migrationFromTheCurrentVersionChangesNothing`; `aNewerFileIsNotMigratedDownward`.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement.** Make `migrate` take the target version as a parameter with a default of `FieldNotesDocument.currentVersion` so tests can run a fake chain.
- [ ] **Step 4: Run, see them pass.**
- [ ] **Step 5: Commit** — `feat(notes): decide who may edit Field Notes, and migrate older files`.

---

### Task 4: Fractional sort keys

**Files:**
- Create: `Sources/FieldmarkCore/FieldNotes/FractionalIndex.swift`
- Test: `Tests/FieldmarkCoreTests/FractionalIndexTests.swift`

**Interfaces:**

```swift
public enum FractionalIndex {
    /// Base-62 digits in ASCII order: 0-9, A-Z, a-z. A key never ends in "0".
    public static let digits: [Character]
    /// A key strictly between `a` and `b` (nil = no bound on that side). Precondition: a < b.
    public static func key(between a: String?, and b: String?) -> String
    /// `count` increasing keys strictly between `a` and `b`, spread out.
    public static func keys(count: Int, between a: String?, and b: String?) -> [String]
    /// Keys for items in their new order: keeps every existing key that belongs to the longest
    /// strictly increasing run of existing keys, and gives every other item a fresh key between its
    /// kept neighbours. Returns one key per item, strictly increasing.
    public static func rekey(_ existing: [String?]) -> [String]
}
```

Algorithm for `key(between:and:)`: the midpoint of two base-62 fractions, as in the well-known "fractional indexing" midpoint (Evan Wallace's article / the `fractional-indexing` package, `midpoint(a, b, digits)`): strip the common prefix, then either pick a middle digit or recurse on the next digit; with `b == nil` treat it as 1. Keys are compared with plain `<` on `String` (ASCII), which is why the digit alphabet must be in ASCII order.

- [ ] **Step 1: Failing tests** (Swift Testing, use a seeded `var generator = SystemRandomNumberGenerator()` replacement: write a tiny `SplitMix64: RandomNumberGenerator` in the test file so failures reproduce):
  - `aKeyBetweenTwoKeysSortsBetweenThem` — 10,000 random pairs (`a < b`) from repeated `key(between:and:)` calls: `a < k < b`, `!k.hasSuffix("0")`.
  - `keysBeforeTheFirstAndAfterTheLastAlwaysExist` — 1,000 successive prepends and appends stay ordered and none is empty.
  - `insertingRepeatedlyAtOneSiteStaysOrdered` — 500 inserts between the same left neighbour and the last inserted key.
  - `keysForACountAreIncreasingAndBetween`.
  - `rekeyKeepsTheLongestIncreasingRun` — `["a1", nil, "a3", "a0", "a5"]` keeps `a1`, `a3`, `a5`, and the result is strictly increasing with `result[0] == "a1"`, `result[2] == "a3"`, `result[4] == "a5"`.
  - `rekeyOfAlreadyOrderedKeysChangesNothing`.
  - `rekeyOfNoExistingKeysMakesFreshOnes`.
  - `rekeyGivesEqualNeighboursDistinctKeys` — `["a1", "a1"]` → strictly increasing.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement.** LIS by patience sorting with predecessor links (O(n log n)); for each gap between kept keys call `keys(count:between:and:)`.
- [ ] **Step 4: Run, see them pass.**
- [ ] **Step 5: Commit** — `feat(notes): add fractional sort keys`.

---

### Task 5: Three-way merge of a block and of a note

**Files:**
- Create: `Sources/FieldmarkCore/FieldNotes/FieldNotesDiff.swift`, `FieldNotesMerge.swift`
- Test: `Tests/FieldmarkCoreTests/FieldNotesMergeTests.swift`, `FieldNotesMergePropertyTests.swift`

**Interfaces:**

```swift
public enum FieldNotesMerge {
    public enum BlockOutcome: Equatable, Sendable {
        case merged(NoteBlock)
        /// Both sides edited overlapping or touching text: keep `local` in site and add `remoteCopy`
        /// (a new id, the remote content and kind, sort = nil so the caller sites it right after).
        case keptBoth(local: NoteBlock, remoteCopy: NoteBlock)
    }
    /// `base` nil means both sides created the block independently (should not happen for the same
    /// id; equal → merged, else keptBoth).
    public static func mergeBlock(base: NoteBlock?, local: NoteBlock, remote: NoteBlock,
                                  newID: () -> UUID) -> BlockOutcome
    /// A note's body conflicts are kept in one note: the remote paragraphs are appended after an
    /// empty paragraph. Fields merge as for blocks.
    public static func mergeNote(base: HighlightNote?, local: HighlightNote, remote: HighlightNote) -> HighlightNote
    /// The content half, exposed for tests: nil when the two sides' text edits overlap or touch.
    public static func mergeContent(base: [NoteInline], local: [NoteInline], remote: [NoteInline]) -> [NoteInline]?
}
```

Rules (from the spec, "Merging"):
- Per field (`kind` is split into: paragraph/heading level; list style and indent; `checked`; plus `sort`, `removed`, each inline's `link`): changed on one side only → that side; equal on both → it; different on both → the side with the later `editedAt` (for `sort`: remote). Ties on `editedAt`: the smaller `editedBy` uuidString wins. `removed` true on one side against a content or kind change on the other → not removed.
- Content: flatten each side into atoms (`Character` with its run attributes, or one whole non-text inline). Diff base→local and base→remote on atom identity (the character or the inline value without its `notes`), using Myers (`FieldNotesDiff`, O((N+M)·D), atoms not UTF-16 units so an emoji is never split). Hunks that neither overlap nor touch in base positions are all applied. On atoms kept by both sides, merge marks and notes as sets (`base ∪ (local − base) ∪ (remote − base) − (base − local) − (base − remote)`) and link as a field. Inserted atoms keep their own side's attributes. Rebuild runs and normalise.
- `editedAt`/`editedBy` of the result: the later side's.

- [ ] **Step 1: Failing table tests** (`FieldNotesMergeTests`), each building small blocks with a helper `block(_ text: String, marks:…, notes:…, kind: …)`:
  - `anUnchangedLocalTakesTheRemote`, `anUnchangedRemoteKeepsTheLocal`, `identicalChangesMerge`.
  - `textEditsInDifferentWordsBothApply` — base "Take the early ferry", local "Take the late ferry", remote "Take the early ferry to Quelavik" → "Take the late ferry to Quelavik".
  - `editsInTheSameWordKeepBoth` — local "early"→"late", remote "early"→"first": `.keptBoth`, the copy has remote's text, a new id and `sort == nil`.
  - `insertionsAtTheSameSiteKeepBoth` — both append at the end.
  - `aTickAndATextEditBothSurvive` — check item, local ticks, remote edits text → checked and edited.
  - `twoPeopleAddingNotesToTheSameWordsKeepBoth` — same text, local adds n1 on "ferry", remote adds n2 on "ferry" → runs carry `[n1, n2]`.
  - `aNoteRemovedHereAndAddedThereIsResolvedPerSide` — local removes n1 from "ferry", remote adds n2 elsewhere → n1 gone, n2 present.
  - `aNoteAddedOnWordsTheOtherSideEditedStaysOnTheSurvivingWords` — remote adds n1 over "early ferry", local changes "early" to "late": n1 still covers "ferry" (the kept atoms) — and the note id is never lost from the block.
  - `boldOnOneSideAndTextOnTheOtherBothApply`.
  - `anEditBeatsARemoval` / `aRemovalOfAnUntouchedBlockStands`.
  - `differentStylesOnBothSidesTakeTheLaterEdit` (and the tie rule).
  - `anImageIsOneAtomAndIsNeverSplit`.
  - `noteBodiesThatConflictAreBothKeptInOneNote`.
- [ ] **Step 2: Failing property tests** (`FieldNotesMergePropertyTests`, seeded generator, 2,000 cases each, random blocks up to 40 atoms with random marks/notes, random edit scripts): `mergingAnUnchangedSideIsTheIdentity` (merge(B,L,B) == .merged(L) and merge(B,B,R) == .merged(R)); `mergingTwoEqualSidesGivesThatSide`; `aMergeNeverLosesANoteEitherSideAdded` (every note id in `(L−B) ∪ (R−B)` is in the result, or in the copy when kept both); `theMergeIsTheSameWhicheverMacDoesIt` (swapping local and remote gives the same text and attributes when `.merged`, with the field tie rules made symmetric by `editedAt`/`editedBy`).
- [ ] **Step 3: Run, see them fail.**
- [ ] **Step 4: Implement** `FieldNotesDiff` (Myers on `[Atom]` returning hunks `(baseRange: Range<Int>, replacement: [Atom])`), then the merge.
- [ ] **Step 5: Run, see them pass.**
- [ ] **Step 6: Commit** — `feat(notes): merge two versions of a block or a note without losing either`.

---

### Task 6: `FieldNotesStore`, the image port, the library bridge and the observer

**Files:**
- Create: `Sources/FieldmarkCore/Persistence/FieldNotesStore.swift`
- Modify: `Sources/FieldmarkCore/Persistence/ImageEncoding.swift`, `SurveyLibrary.swift`, `SurveyChangeObserver.swift`, every `SurveyChangeObserver` conformer (`ShareRegistry` — forward nothing yet, with a comment that part 3 fills it —, the two `WriteRecorder` copies, `EngineObserver` in `FlockSyncEngineTests`, `FileSpy` in `SiteStoreSharedFilesTests`, `Spy` in `SurveyChangeObserverTests`; grep `SurveyChangeObserver` to be sure there are no others), and the app's `ImageEncoding` implementation (find it: `ImageIOEncoder`).
- Test: `Tests/FieldmarkCoreTests/FieldNotesStoreTests.swift`, additions to `SurveyChangeObserverTests`.

**Interfaces:**

```swift
public protocol ImageEncoding: Sendable {
    func reencoded(_ data: Data) -> Data?
    /// Pixel width and height, or nil. Default: nil.
    func pixelSize(of data: Data) -> (width: Int, height: Int)?
    /// Re-encoded with the long side at most `maxPixelSide`, or nil to keep `data`. Default: nil.
    func reencoded(_ data: Data, maxPixelSide: Int) -> Data?
}

public enum FieldNotesStoreError: Error, Equatable {
    case unreadable(String)
    case needsNewerVersion(Int)     // save() refuses a document this build may not edit
    case notAnImage
}

public final class FieldNotesStore {
    public let observerBox = StoreObserverBox()
    public init(surveyDir: URL, fs: FileSystem = DiskFileSystem(), images: ImageEncoding? = nil)
    public var imagesDirectory: URL { get }          // <survey>/field-notes/images
    public func imageURL(_ file: String) -> URL
    /// Missing file → `.empty`. Runs `FieldNotesMigration` on the raw JSON first. Throws `.unreadable`.
    public func load() throws -> FieldNotesDocument
    /// Refuses (`.needsNewerVersion`) a document whose `access` is read-only; writes formatVersion =
    /// max(document's, current); reports `fieldNotesSaved` after the write.
    public func save(_ document: FieldNotesDocument) throws
    /// Sniffs, re-encodes, names `<UUID>.<ext>` (extension from the sniffed format, as
    /// `ImageFilename.safeName` decides it), measures, writes. Throws `.notAnImage`.
    public func importImage(data: Data) throws -> NoteImage
    /// A copy of a site photo at most 512 px on the long side, as a new UUID file. Returns its name.
    public func importSitePhoto(from url: URL) throws -> String
    /// Deletes files in `imagesDirectory` that no block, note body or snapshot references.
    public func removeUnreferencedImages(of document: FieldNotesDocument) throws
}

// SurveyLibrary
public func fieldNotesStore(for survey: Survey) throws -> FieldNotesStore

// SurveyChangeObserver
func fieldNotesSaved(surveyID: UUID, notes: FieldNotesDocument)
```

- [ ] **Step 1: Failing tests** (`FieldNotesStoreTests`, on `InMemoryFileSystem` or whatever in-memory `FileSystem` the Core tests already use — find it):
  - `aMissingFileLoadsAsAnEmptyDocument`.
  - `aSavedDocumentLoadsBackEqual`.
  - `anUndecodableFileThrowsUnreadableAndIsNeverOverwritten` — write garbage, `load()` throws `.unreadable`; the caller cannot save because the model (Task 8) never holds a document for it, and the store test also proves `save` of a read-only document throws `.needsNewerVersion` and leaves the file's bytes unchanged.
  - `aNewerFileLoadsButCannotBeSaved` — `minReaderVersion: 2` loads (so it can be shown), `save` throws `.needsNewerVersion(2)`, bytes unchanged.
  - `savingReportsToTheObserverAfterTheWrite` (use the observer spy pattern of `SurveyChangeObserverTests`).
  - `aFailedSaveReportsNothing`.
  - `importingAnImageWritesAUUIDNamedFileAndMeasuresIt` (fake `ImageEncoding` returning fixed bytes and size).
  - `importingSomethingThatIsNotAnImageThrowsAndWritesNothing`.
  - `aSitePhotoCopyIsReencodedAtFiveHundredTwelve` (fake encoder records the `maxPixelSide` it was asked for).
  - `unreferencedImagesAreRemovedAndReferencedOnesKept` (referenced from a block, a note body, and a snapshot).
  - `theLibraryHandsOutAStoreThatReportsForItsSurvey`.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement.** Implement the two port methods in the app's ImageIO encoder (`CGImageSourceCopyPropertiesAtIndex` for size; thumbnail at `maxPixelSide` for the copy, with the same four ImageIO rules the existing encoder follows: `CreateThumbnailFromImageAlways`, `WithTransform` + orientation up, copy properties minus pixel sizes, HEIC keeps alpha).
- [ ] **Step 4: Run, see them pass; run the whole suite (the observer change touches six files).**
- [ ] **Step 5: Commit** — `feat(notes): store Field Notes and their images beside the survey`.

---

### Task 7: Saving the editor's work: snapshot + base + disk

**Files:**
- Create: `Sources/FieldmarkCore/FieldNotes/FieldNotesSaving.swift`, `FieldNotesQueries.swift`
- Test: `Tests/FieldmarkCoreTests/FieldNotesSavingTests.swift`, `FieldNotesQueriesTests.swift`

**Interfaces:**

```swift
/// What the editor holds, handed over for a save.
public struct FieldNotesSnapshot: Equatable, Sendable {
    public var blocks: [NoteBlock]          // document blocks in on-screen order, never removed ones
    public var notes: [HighlightNote]       // every note the editor knows, deleted ones as removed: true
}

/// What the editor must change to show `document`.
public struct FieldNotesPatch: Equatable, Sendable {
    public var document: FieldNotesDocument
    public var changedBlockIDs: Set<UUID>   // present before and after, content or kind differs
    public var insertedBlockIDs: Set<UUID>
    public var removedBlockIDs: Set<UUID>   // gone or removed: true
    public var changedNoteIDs: Set<UUID>    // any note added, changed or removed
    public var isEmpty: Bool { get }
}

public enum FieldNotesSaving {
    /// The one way a document is saved from the editor. `base` is the document the editor last
    /// showed; `disk` is a fresh load. Blocks the editor did not change take the disk's version;
    /// blocks it changed are merged three ways (Task 5) against the disk's when the disk moved too;
    /// a block the editor removed stays if the disk changed it meanwhile (an edit beats a removal);
    /// blocks only on disk keep their site by sort key; then `FractionalIndex.rekey` over the final
    /// order. Changed and new blocks and notes are stamped (`editedBy`/`editedAt`, and `createdBy`/
    /// `createdAt` or `author`/`createdAt` when new) with `author` and `now`.
    /// Returns the document to save and the patch that brings the editor from its snapshot to it
    /// (empty when the editor already shows exactly what is saved).
    public static func merge(snapshot: FieldNotesSnapshot, base: FieldNotesDocument, disk: FieldNotesDocument,
                             author: UUID, now: Date, newID: () -> UUID) -> (document: FieldNotesDocument, patch: FieldNotesPatch)
    /// What changed from `old` to `new`, for an editor showing `old`.
    public static func patch(from old: FieldNotesDocument, to new: FieldNotesDocument) -> FieldNotesPatch
}

public extension FieldNotesDocument {
    var visibleBlocks: [NoteBlock] { get }            // (sort, id) order, not removed
    var liveNotes: [HighlightNote] { get }            // not removed
    /// Notes not removed whose id no visible run in their owner (the document, or the parent note's
    /// body) lists, and whose parent is not itself removed.
    var detachedNotes: [HighlightNote] { get }
    /// The live notes among `ids` (the ids on a clicked character), oldest first: what a popover lists.
    func notes(ids: [UUID]) -> [HighlightNote]
    var siteCards: [(blockID: UUID, card: NoteSiteCard)] { get }
    /// Every image file name the document references (blocks, note bodies, snapshots).
    var referencedImageFiles: Set<String> { get }
}
```

- [ ] **Step 1: Failing tests** (`FieldNotesSavingTests`):
  - `anUnchangedSnapshotSavesTheDiskAsItIs` and returns an empty patch when disk == base.
  - `aRemoteChangeTheEditorDidNotTouchSurvivesTheSave` — disk changed block B after base; the snapshot changed block A: both land; the patch tells the editor B changed.
  - `aBlockChangedOnBothIsMerged` (delegates to Task 5; one case each for `.merged` and `.keptBoth`, where the copy lands right after the local block with a key between its neighbours).
  - `aBlockTheEditorDeletedButTheDiskChangedComesBack` and the patch re-inserts it.
  - `aBlockTheEditorDeletedAndTheDiskDidNotIsSavedAsRemoved` (soft delete, keeps its sort key).
  - `aBlockAddedOnDiskAppearsWhereItsKeySaysAndStaysThere`.
  - `newBlocksGetKeysBetweenTheirNeighboursAndOldKeysStay` (the saved document's untouched blocks keep their exact `sort`).
  - `aMovedBlockGetsANewKey`.
  - `changedBlocksAreStampedWithTheAuthorAndTime`; `newNotesAreStamped`; `notesDeletedInTheEditorAreSavedAsRemoved`; `aNoteChangedOnBothIsMerged`.
  - `aStaleEditorCannotDeleteWhatItNeverSaw` — base lacks block X (added remotely), the snapshot lacks it too; X is still in the result.
  - `patchFromOldToNewNamesEveryKindOfChange`.
  - Queries: `aNoteWhoseWordsWereDeletedIsDetached`, `aNestedNoteWhoseWordsWereDeletedFromItsParentIsDetached`, `aNoteUnderARemovedParentIsNotListed`, `repliesOnTheSameWordsAreListedOldestFirst`, `referencedImageFilesIncludeSnapshotsAndNoteBodies`.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, see them pass.**
- [ ] **Step 5: Commit** — `feat(notes): save the editor's work into whatever is on disk without losing either`.

---

### Task 8: `FieldNotesModel`

**Files:**
- Create: `Sources/FieldmarkPresentation/FieldNotes/FieldNotesEditing.swift`, `FieldNotesModel.swift`, `FieldNotesModel+Edits.swift`, `FieldNotesModel+Sites.swift`
- Modify: `Sources/FieldmarkPresentation/Detail/SurveyDetailModel.swift` (own the model, `load()` hook, `deleteSites` hook), `Sources/FieldmarkUI/DetailOrError.swift` (create the store and install the model; share seams)
- Test: `Tests/FieldmarkPresentationTests/FieldNotesModelTests.swift`, `FieldNotesModelEditsTests.swift`, `FieldNotesModelSitesTests.swift`, additions to the `DetailOrError` seam tests (find the existing tests of `installShareSeams`)

**Interfaces:**

```swift
@MainActor public protocol FieldNotesEditing: AnyObject {
    /// Everything the editor shows, with block ids normalised (part 2 implements this).
    func fieldNotesSnapshot() -> FieldNotesSnapshot
    /// Show `patch.document`, changing only the named blocks and notes, keeping the caret.
    func apply(_ patch: FieldNotesPatch)
}

@MainActor @Observable
public final class FieldNotesModel {
    public init(store: FieldNotesStore, sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) })
    public private(set) var document: FieldNotesDocument        // what the editor was last given
    public private(set) var access: FieldNotesAccess
    public private(set) var revision: Int                     // bumps only when something other than the editor changed the document
    public private(set) var lastError: String?
    public var localSpotterProvider: @MainActor () -> Spotter
    public var sitesProvider: @MainActor () -> [SiteOfInterest]
    public var sitePhotoURL: @MainActor (SiteOfInterest) -> URL?
    public weak var editor: (any FieldNotesEditing)?
    /// Where the view was: restored when the view comes back (part 2 reads and writes it).
    public var viewport: FieldNotesViewport?                   // struct { blockID: UUID?, offset: Int, scrollY: Double }
    public var detachedNotes: [HighlightNote] { get }
    public var hasUnsavedChanges: Bool { get }

    public func load()                                        // reads, sets access, bumps revision
    public func editorDidChange()                             // debounce: 0.75 s quiet, at most 3 s while changes keep coming
    public func flush()                                       // synchronous: snapshot → load → FieldNotesSaving.merge → save → editor.apply(patch) if non-empty
    public func reloadFromDisk()                              // after a remote page: load, patch from `document`, editor.apply, revision += 1 (only if changed)
    public func close()                                       // flush, cancel the timer, drop the editor
    public func discardPendingWork()                          // cancel the timer and drop unsaved work: for an outing being deleted
}
```

`+Edits` (each: flush first, load, change, save, `editor?.apply(patch)`, `revision += 1`):
`appendBlock(text:kind:)`, `addNote(onFirst words: String, text: String) -> UUID?`, `reply(to noteID: UUID, text: String) -> UUID?`, `deleteNote(_ id: UUID)` (also removes notes whose parent chain leads to it, and strips the id from runs), `embedSite(_ site: SiteOfInterest) -> UUID?` (snapshot + photo copy, its own paragraph at the end), `addImage(data: Data) throws -> UUID` (its own paragraph at the end), `setChecked(itemText: String, _ checked: Bool) -> Bool`.

`+Sites`: `refreshSiteSnapshots()` (for each card whose live site differs in name, category, summary or favourite, or whose first photo's file name differs from `sourcePhoto`: update, redo the photo copy only for the photo change, one save only when something changed), `prepareForDeletion(of sites: [SiteOfInterest])` (the same refresh restricted to those sites, before they go).

Wiring:
- `SurveyDetailModel` gets `public private(set) var fieldNotes: FieldNotesModel?` and `public func installFieldNotes(_ model: FieldNotesModel)` which sets `sitesProvider` to its own `sites`, `sitePhotoURL` via `siteStore.imageURL(for:filename:)` of the first image, `localSpotterProvider` to its own, then `model.load()`.
- `SurveyDetailModel.load()` ends with `fieldNotes?.reloadFromDisk(); fieldNotes?.refreshSiteSnapshots()`.
- `SurveyDetailModel.deleteSites` calls `fieldNotes?.prepareForDeletion(of: doomed)` before the first `siteStore.delete`.
- `DetailOrError.makeDetailModel` builds `FieldNotesStore` with `try? model.fieldNotesStore(for: survey)` (an outing whose notes cannot be opened still shows its sites) and installs it.
- `DetailOrError.installShareSeams`: `mayApplyRemote` calls `detailModel.fieldNotes?.flush()` before its existing checks (a flush is synchronous and leaves nothing unsaved for the page to fight); `remoteChangesApplied` already calls `detailModel.load()`, which now reloads the notes.
- Wherever the app deletes a survey (find `surveyDeleted` / the delete path in `SurveyListModel`), if that survey's detail model is the open one, call `fieldNotes?.discardPendingWork()` first.

- [ ] **Step 1: Failing tests** with a `FakeEditor: FieldNotesEditing` (records patches, returns a scripted snapshot) and an in-memory store; `sleep` injected as a closure that awaits a test-controlled continuation so debounce is deterministic:
  - `loadingAMissingFileGivesAnEditableEmptyDocument`; `loadingANewerFileIsReadOnlyAndNeverSaves` (editorDidChange + flush write nothing); `loadingAnUnreadableFileIsReadOnly`.
  - `aChangeIsSavedAfterAQuietPause` and `notBefore`; `continuousChangesStillSaveWithinThreeSeconds`.
  - `flushSavesAtOnceAndCancelsThePendingTimer`.
  - `aRemoteReloadPatchesTheEditorAndBumpsTheRevision`; `aReloadThatFindsNothingNewDoesNotBumpIt`; `theEditorsOwnSavesNeverBumpTheRevision`.
  - `discardPendingWorkWritesNothingLater` (the folder is not recreated: assert the in-memory fs has no `field-notes.json` after the timer would have fired).
  - Edits: `appendingABlockAddsItAtTheEnd`, `addingANoteMarksTheFirstOccurrence`, `replyCoversTheSameWords`, `deletingANoteRemovesItsRepliesChildrenAndTint`, `embeddingAPlaceSnapshotsItWithAPhotoCopy`, `addingAnImageAddsItsOwnParagraph`, `checkingAnItemByItsText`.
  - Sites: `aRenamedSiteRefreshesItsCardsSnapshot`, `aNewFirstPhotoRedoesThePhotoCopyAndNothingElseDoes`, `nothingChangedMeansNothingSaved`, `deletingAPlaceRefreshesItsCardFirstAndKeepsTheCard`.
  - Detail model: `deleteSitesAsksTheNotesToRememberTheSiteFirst`, `loadReloadsTheNotes`.
  - Seams: `mayApplyRemoteFlushesTheNotesFirst`.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the whole suite; lint; `git diff` after lint.**
- [ ] **Step 5: Commit** in two commits — `feat(notes): add the Field Notes model` and `feat(notes): give each open outing its Field Notes model`.

---

## Done when

- Every task's tests pass, the whole suite passes (`./Scripts/test.sh`), `./Scripts/lint.sh` is clean and the build is clean.
- The report lists: commits (hash + subject), test count before and after, anything that did not go as the plan says and what was chosen instead with the evidence, any pre-existing bug fixed along the way.
