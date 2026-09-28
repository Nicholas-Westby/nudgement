# Field Notes, part 2: the editor and the view — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. In this project one implementer carries the whole plan (Robin's rule: few agents per feature), so execute it task by task yourself with superpowers:test-driven-development; do not start subagents.

**Goal:** The Field Notes view: a Mac-native rich text editor over part 1's `FieldNotesModel`, with lists, checklists, images, site cards, highlight notes in popovers, a format bar, a Format menu, and the new view mode.

**Architecture:** Port the research prototype (`/home/dev/src/temp-fieldmark-field-notes/probes/Kit*.swift`, about 1,750 lines of throwaway code that ran in 17 probes) into `Sources/FieldmarkUI/FieldNotes/`, adapting it to part 1's types (block ids, UUID note ids, flat notes, site snapshots) and to the app (its image store, thumbnail cache, category colours, coordinator, sheets). TextKit 1 stack; semantic attributes are the truth and looks are derived; lists, checkboxes and highlight tints are drawn by the layout manager; attachments are cells; popovers hold the same editor.

**Tech Stack:** AppKit (TextKit 1: `NSTextStorage`, `NSLayoutManager`, `NSTextContainer`, `NSTextView`), SwiftUI (`NSViewRepresentable`, `CommandMenu`, popovers), ImageIO, Swift Testing + ViewInspector + real-window tests, `FieldmarkSnapshots`.

**Spec:** `docs/superpowers/specs/2026-09-25-field-notes-design.md`, sections "What people see", "Editor", "Model and persistence". Read `/home/dev/src/temp-fieldmark-field-notes/research-rich-text.md` whole, especially its Traps list (27 items, each was hit in a probe); every trap applies to this plan. Part 1's plan (`docs/superpowers/plans/2026-09-25-field-notes-1-model.md`) defines every model type used here; it is merged before this plan starts.

## Global Constraints

- Work in `/home/dev/src/fieldmark/.claude/worktrees/field-notes` (branch `field-notes`) only; `cd` there in every command.
- macOS 14 deployment target: no API newer than 14 without `if #available`; Writing Tools `.limited` only under `#available(macOS 15, *)`.
- Swift 6 strict concurrency: controllers `@MainActor`, storage-delegate methods `nonisolated`, drawing code never reaches into the text view (push state onto the layout manager).
- Never `NSTextView(frame:)` or `scrollableTextView()`; never read `layoutManager` off a TextKit 2 view (there must be none).
- The editor never reloads itself from its own write-backs; `updateNSView` does nothing unless `model.revision` moved.
- User-facing words: "Field Notes", "highlight note", "site card"; no internal paths or jargon in any UI text; copy is sentence case and says what happens.
- Shortcuts (Notes-compatible), checked against every existing app shortcut: Title ⇧⌘T, Heading ⇧⌘H, Subheading ⇧⌘J, Body ⇧⌘B, Bulleted List ⇧⌘7, Numbered List ⇧⌘9, Checklist ⇧⌘L, Mark as Checked ⇧⌘U, Bold ⌘B, Italic ⌘I, Underline ⌘U, Strikethrough ⇧⌘X, Increase Indent ⌘], Decrease Indent ⌘[, Add Link… ⌘K, Add Highlight Note ⇧⌘K.
- Commits: Conventional Commits via `house-style:how-to-commit`, no trailers, explicit paths. Gates: `./Scripts/build.sh`, `./Scripts/test.sh`, `./Scripts/lint.sh` (then `git diff`), and the live checks in Task 10.
- Pre-existing bugs met in touched files: fix test-first in their own commit and report them.

## Review Focus

- **Typing at the edge of a highlight or link, and pasting inside one:** edge typing never extends it; a paste strictly inside joins it; copy-paste of highlighted words makes new note ids with copied bodies; cut-paste keeps them. Pinned in Task 4.
- **A remote change arriving while the caret is in the middle of the document:** only the changed paragraphs are replaced, the caret stays in its paragraph at its offset, and undo is cleared only when characters changed. Pinned in Task 7.
- **Return at the start of a paragraph, Return in the middle, Backspace joining two paragraphs, and paste of several paragraphs mid-paragraph:** block ids stay stable for the text that did not move, and no id appears twice. Pinned in Task 2.
- **A site card whose site is deleted while the notes are open:** the card redraws as removed at once, keeps its snapshot, and survives a save and a relaunch. Pinned in Task 3 and Task 10.
- **Pasting from Safari, TextEdit and Finder:** only the schema survives (no fonts, colours, backgrounds), images become image paragraphs, a file URL becomes an image not 63 characters of path. Pinned in Task 4.

## Notes from part 1 (read before Task 1)

Part 1 landed as planned with these differences, which this plan must follow:

- **Paragraph size is also a byte limit.** `FieldNotesLimits.blockText` counts characters, but a
  paragraph of many one-letter runs can still encode to more than the server's 64 KiB per row. When
  the snapshot is taken, split a paragraph whose encoded block JSON (through `JSONFile.encode`)
  would exceed 48 KiB, as well as one over the character limit. Part 3 also refuses to drop an
  oversized row; the editor is the first line.
- **Unique paragraph ids are the editor's job.** `FieldNotesSaving.merge` gives a duplicate id a new
  one so no text is lost, but the paragraph would then show twice until the next reload. The
  converter's normalisation (Task 2) must never hand over a duplicate.
- **`FieldNotesPatch.movedBlockIDs`** exists: a reload can reorder paragraphs. `apply(_:)` must move
  those paragraphs (Task 5), keeping the caret on its text.
- **Stamps are not in the patch.** A save's patch ignores `editedAt`/`editedBy`/`author` changes, so
  the popover reads who wrote a note and when from `model.document`, not from its own copy.
- **Deleting a note** (`FieldNotesModel.deleteNote`) removes that note and the notes written on its
  own words, strips their ids from the text, and keeps replies (other notes on the same words). A
  live note whose parent was removed some other way is listed in `detachedNotes`.
- **Sort keys** are pure base-62 fractions that never end in "0" (the spec's "a0" examples are just
  illustrations). The editor never needs to read them.
- **API details to use as they are:** `FieldNotesStore.save` returns the document exactly as the next
  load will read it; the model has a `clock` seam beside `sleep`; word-finding and note helpers are
  public in Core (`FieldNotesEdits.swift`, `FieldNotesQueries.swift`); `mergeNote` takes `newID`.
- `removeUnreferencedImages` is not called by anything yet; part 3 decides when. Do not call it here.

---

## File structure (all under `Sources/FieldmarkUI/FieldNotes/`)

| File | Responsibility | Ported from |
| --- | --- | --- |
| `Editor/FieldNotesAttributes.swift` | Semantic attribute keys, `MarkSet`, `BlockStyle`, metrics, the styler | `KitAttributes.swift` |
| `Editor/FieldNotesConverter.swift` | Model ⇄ attributed string, snapshot with id normalisation | `KitConverter.swift` (`Converter`) |
| `Editor/FieldNotesPasteboard.swift` | Fragment type, sanitiser, exporter (RTF/RTFD/plain) | `KitConverter.swift` (`Sanitizer`, `Exporter`), `KitTextView.swift` (read/writeSelection) |
| `Editor/FieldNotesLayoutManager.swift` | Markers, checkboxes, highlight tints, checked dimming | `KitLayout.swift` (`NotesLayoutManager`) |
| `Editor/FieldNotesAttachments.swift` | Image, site card and unknown-content attachments and cells | `KitLayout.swift` |
| `Editor/FieldNotesImageLoader.swift` | Aspect-fit thumbnails of notes images, cached, off the main thread | new, on `GalleryThumbnail.decode` |
| `Editor/FieldNotesTextView.swift` | The `NSTextView` subclass: actions, keys, clicks, typing policy, accessibility | `KitTextView.swift` |
| `Editor/FieldNotesEditorController.swift` | Delegate; `FieldNotesEditing`; selection state; popovers | `KitTextView.swift` (`FieldNotesController`) |
| `Notes/HighlightNotesPopover.swift` | `NSPopover` + SwiftUI list of note cards | `probes/p12-popover.swift` |
| `Notes/NoteBodyEditor.swift` | A note's body: the same text view in note mode, auto-height | new |
| `Notes/DetachedNotesPopover.swift` | The Detached Notes list | new |
| `FieldNotesView.swift` | Format bar + editor host + bars + placeholder | new |
| `FieldNotesFormatBar.swift` | The format bar | new |
| `FieldNotesEditorHost.swift` | `NSViewRepresentable` returning the scroll view | `probes/p07-swiftui.swift` (guarded version) |
| `InsertSitePopover.swift`, `LinkSheet.swift` | Insert Site picker, Add Link sheet | new |
| `FieldNotesCommands.swift` | `CommandMenu("Format")` | `probes/p07-swiftui.swift` |
| Modify: `Sources/FieldmarkServices/Detail/ViewMode.swift`, `Sources/FieldmarkUI/Detail/SurveyDetailView.swift`, `Sources/FieldmarkApp/FieldmarkApp.swift` (commands), the coordinator type that menu items reach (`ControlCoordinator`), `Sources/FieldmarkSnapshots/main.swift` | | |

Tests go under `Tests/FieldmarkUITests/FieldNotes/` (create the folder; check the target picks up subfolders, which SwiftPM does).

---

### Task 1: Attributes, styler and metrics

**Files:** Create `Editor/FieldNotesAttributes.swift`. Test: `Tests/FieldmarkUITests/FieldNotes/FieldNotesStylerTests.swift`.

**Interfaces:**
- Produces: `extension NSAttributedString.Key { static let tnBlockID, tnBlock, tnMarks, tnExtraMarks, tnNotes }` (values: block id `String` uppercase uuid; `BlockStyle.encoded` `String`; `Int` mask; `[String]`; `[String]` of uuid strings); `struct MarkSet: OptionSet` (bold 1, italic 2, underline 4, strike 8, code 16; `init(strings:)`, `strings`); `struct BlockStyle` (kind `p|h1|h2|h3|bullet|number|check`, `indent` 0…5, `checked`; `encoded`; `init(encoded:)`; `init(_ kind: NoteBlockKind)`; `var noteBlockKind: NoteBlockKind`); `enum FieldNotesMetrics`; `enum FieldNotesStyler { static func attributes(block:marks:link:notes:extraMarks:) -> [NSAttributedString.Key: Any]; static func derive(into:block:marks:) }`.

Look (tuned from the kit, dark-mode first, dynamic colours only): body 14 pt system, line height multiple 1.22, paragraph spacing 6; Title 26 bold, Heading 20 bold, Subheading 16 semibold with 14/10/8 pt before; list marker column 26 pt, 24 pt per indent level; monospaced marks in SF Mono at 0.92 of the size on a `quaternaryLabelColor` background; links `linkColor`; text `textColor`.

- [ ] **Step 1: Failing tests:** `everyBlockStyleRoundOutingsThroughItsEncoding`; `aBoldItalicRunGetsABoldItalicFontOfTheRightSize`; `headingsGetTheirSizesAndSpacing`; `listItemsIndentByLevel`; `theStylerOnlyUsesDynamicColours` (every colour it writes is one of `textColor`, `secondaryLabelColor`, `linkColor`, `quaternaryLabelColor`, `controlAccentColor`); `blockStyleMapsToAndFromTheModelsKind` for every `NoteBlockKind` case except `.unknown`.
- [ ] **Step 2: Run, see them fail. Step 3: Port and adapt. Step 4: Pass. Step 5: Commit** `feat(notes): add the Field Notes text attributes and styler`.

---

### Task 2: The converter and block identity

**Files:** Create `Editor/FieldNotesConverter.swift`. Test: `FieldNotesConverterTests.swift`, `FieldNotesConverterPropertyTests.swift`, `FieldNotesBlockIdentityTests.swift`.

**Interfaces:**

```swift
@MainActor enum FieldNotesConverter {
    /// The document's visible blocks as one attributed string, one paragraph per block, every
    /// character of a paragraph (its "\n" included) carrying `.tnBlockID` and `.tnBlock`.
    static func attributedString(blocks: [NoteBlock], images: FieldNotesImageLoader, sites: SiteCardSource) -> NSMutableAttributedString
    /// Paragraphs back into blocks, in order, with ids normalised: a paragraph's id is its first
    /// character's; a repeated id stays on the earlier paragraph unless that one is empty and this
    /// one is not (Return at the start of a paragraph); a paragraph without one, or with one
    /// already taken, gets `newID()`. Returns the blocks and the id fix-ups to write back.
    static func blocks(from text: NSAttributedString, newID: () -> UUID) -> (blocks: [NoteBlock], fixes: [(NSRange, UUID)])
}
/// What a site card needs to draw: the live site when it exists, else nil (draw the snapshot).
@MainActor protocol SiteCardSource: AnyObject {
    func liveSite(_ id: UUID) -> SiteCardLive?          // struct { name, category, summary, isFavorite, photoURL, colour, symbol }
}
```

A paragraph longer than `FieldNotesLimits.blockText` is split at the last whitespace before the limit when the snapshot is taken (the patch then shows the split), so no block ever exceeds it. Block kind, marks, extra marks, link and note ids map one to one; `sort`, `createdBy`/`At`, `editedBy`/`At` are not in the text (the model keeps them: `FieldNotesSaving` stamps changed blocks by comparing content).

- [ ] **Step 1: Failing tests:**
  - `aFullDocumentSurvivesTheOutingThroughText` — the same content as part 1's `v1-full.json` fixture (every kind, overlaps, emoji, U+2028): blocks → text → blocks equal (ids included).
  - `generatedDocumentsSurviveTheOutingThroughText` — 500 seeded random documents.
  - `unknownBlocksInlinesAndMarksComeBackVerbatim`.
  - `anEmptyTrailingListItemBecomesAParagraph` (the one documented loss, pinned so it stays the only one).
  - Identity: `returnInTheMiddleKeepsTheIDOnTheFirstHalf`, `returnAtTheStartHandsTheIDToTheTextBearingHalf`, `backspaceJoiningTwoParagraphsKeepsTheFirstID`, `pastingSeveralParagraphsMidParagraphLeavesNoDuplicateIDs`, `theFixesAreAttributeOnlyAndCoverWholeParagraphs`. Drive these through a real `FieldNotesTextView` once Task 4 exists; until then, build the attributed strings by hand and move the tests to the text view in Task 4.
- [ ] **Step 2–4:** fail, port, pass.
- [ ] **Step 5: Commit** `feat(notes): convert Field Notes between the document and the text view`.

---

### Task 3: Layout manager, attachments and the image loader

**Files:** Create `Editor/FieldNotesLayoutManager.swift`, `Editor/FieldNotesAttachments.swift`, `Editor/FieldNotesImageLoader.swift`. Modify `Sources/FieldmarkUI/Gallery/GalleryThumbnail.swift` only to share its decode (an aspect-fit variant beside the square crop; do not change the gallery's behaviour). Test: `FieldNotesDrawingTests.swift`, `FieldNotesImageLoaderTests.swift`.

What to build:
- Markers: `•`/`◦`/`▪︎` by level (in `secondaryLabelColor`), numbers `1.`/`a.`/`i.` by level with monospaced digits, counting consecutive items of the same style and level (a paragraph of another kind restarts the count).
- Checkboxes: Notes-style 16 pt circles; unchecked `tertiaryLabelColor` stroke; checked `controlAccentColor` fill with a white tick (two palette colours, research trap 25). Checked text dimmed to `secondaryLabelColor` and struck, via `layoutManager(_:shouldUseTemporaryAttributes:…)` only (trap 6).
- Highlights: rounded 3 pt rects, `systemYellow` at 0.30 alpha (0.38 in light), overlaps darker by stacking, trimmed at paragraph breaks (trap 18).
- Image cell: fitted to the text container width (minus the line fragment padding), never enlarged, 8 pt corners, a `quaternaryLabelColor` placeholder until the thumbnail arrives; the loader decodes at `displayWidth × backingScale` rounded up to 64 px, caches by (file, pixel side, modification date), decodes off the main thread and invalidates the attachment's display when done.
- Site card cell: up to 460 × 88 pt; 72 pt photo (live site's first photo through `GalleryThumbnailStore`, or the snapshot's copy through the notes loader), name 14 pt semibold, category line with the outing's category colour and SF Symbol (use the same colour source the List cards use), one-line summary in `secondaryLabelColor`, a star when favourite; background `controlBackgroundColor`-like fill with a 1 pt `separatorColor` border, 10 pt corners. Removed: photo at 45 % opacity and desaturated, name in `secondaryLabelColor`, and "Removed from the outing" in site of the summary. `wantsToTrackMouse` true; accessibility label "Site card: <name>" (+ ", removed from the outing").
- Unknown content cell: "Needs a newer version of Fieldmark" in `secondaryLabelColor` in a dashed rounded box.

- [ ] **Step 1: Failing tests:** `numbersRestartAfterAParagraphOfAnotherKind`; `nestedNumbersUseLettersThenRomanNumerals`; `markersAreNotInTheText` (the string has no `•`); `checkedDimmingIsNeverStored` (the storage has no foreground colour change after a toggle); `anImageFitsTheColumnAndIsNeverEnlarged` (cell frame for a 1600×900 image in a 600 pt container, and for a 300×200 image); `aRemovedSiteCardSaysSo` (render the cell into a bitmap, and check its accessibility label); `theLoaderDecodesOnceForTheSameSizeAndAgainForABiggerOne`; a render smoke test drawing a document with every feature into a bitmap without crashing (`bitmapImageRepForCachingDisplay` + `cacheDisplay`, as the probes do) and saving it to the scratch folder for a look.
- [ ] **Step 2–4.**
- [ ] **Step 5: Commit** `feat(notes): draw lists, checkboxes, highlights, photos and site cards`.

---

### Task 4: The text view

**Files:** Create `Editor/FieldNotesTextView.swift`, `Editor/FieldNotesPasteboard.swift`. Test: `FieldNotesEditingTests.swift`, `FieldNotesUndoTests.swift`, `FieldNotesPasteTests.swift`, plus Task 2's identity tests moved onto the real view. Test helper: a `FieldNotesTestEditor` that builds the TextKit 1 stack in an off-screen window (see `probes/Support.swift`) and turns the run loop between actions (trap 9).

Port the kit's `FieldNotesTextView` and keep every behaviour its probes verified, and add:
- `static func make(configuration: .document | .note)`: explicit TextKit 1 stack, `usesFontPanel = false`, `usesInspectorBar = false`, `usesRuler = false`, `usesFindBar = true`, `isIncrementalSearchingEnabled = true`, continuous spelling on, smart quotes/dashes/text replacement on, `isAutomaticLinkDetectionEnabled = true`, `allowsUndo = true`, `importsGraphics = false` (images come through our paste path), `textContainerInset` from `FieldNotesMetrics`, Writing Tools `.limited` on macOS 15+. The `.note` configuration refuses images and site cards (paste turns a card into its site's name, drops images).
- Typing shortcuts at a paragraph start: "- " and "* " → bulleted, "1. " → numbered, "[] " and "[ ] " → checklist; one undo step returns the typed characters.
- `@objc` actions for every command in the Global Constraints list, each one undo step with a named action; `addLink(_:)` asks the controller to show the Link sheet; `insertSiteCard(_:)` and `insertImages(_:)` take model values and insert each as its own paragraph at the caret.
- Selection state published after every selection or text change: `FieldNotesSelectionState { blockKind, marks: MarkSet (all selected runs share), mixedMarks, listStyle, canAddNote, isInNote }`.

- [ ] **Step 1: Failing tests**, each a scripted session:
  - Lists: `returnContinuesAList`, `returnAfterACheckedItemGivesAnUncheckedOne`, `returnOnAnEmptyNestedItemOutdentsThenLeaves`, `tabAndShiftTabIndentAndOutdent`, `tabOutsideAListTypesATab`, `backspaceAtAnItemStartMakesBodyThenJoins`, `returnAfterAHeadingGivesBody`.
  - Typing shortcuts: `dashSpaceStartsABulletedList`, `oneDotSpaceStartsANumberedList`, `bracketsSpaceStartsAChecklist`, `undoAfterAShortcutGivesBackTheTypedCharacters`, `aDashInTheMiddleOfAParagraphIsJustADash`.
  - Marks: `boldTogglesOnAndOff`, `strikethroughHasItsOwnAction`, `aNativeFontChangeIsUndoneByTheStyler` (send `changeFont:` with a bold Helvetica: the semantic marks are unchanged and the font is ours again).
  - Checklists: `clickingTheCircleTogglesWithoutMovingTheCaret`, `markAsCheckedTogglesEverySelectedItem`.
  - Highlights (Review Focus): `typingAtTheEndOfAHighlightDoesNotExtendIt`, `typingAtTheStartDoesNotJoinIt`, `typingInsideJoinsIt`, `pastingRichTextInsideAHighlightJoinsIt`, `copyingHighlightedWordsPastesNewNotesWithCopiedBodies`, `cuttingAndPastingKeepsTheNotes`, `typingAfterALinkDoesNotExtendIt`.
  - Undo (`FieldNotesUndoTests`): the p09 script (type, bold, Return + type, checklist, Tab, check, insert image, add note, remove note) undoes one step at a time back to the start and redoes to the end.
  - Paste (`FieldNotesPasteTests`, private pasteboards only, fixtures built as in `probes/p10-paste.swift`): `aSafariLikePasteKeepsOnlyTheSchema`, `aTextEditLikePasteKeepsBoldAndLists`, `plainTextBecomesParagraphs`, `anImageFileURLBecomesAnImageParagraph`, `pngDataBecomesAnImageParagraph`, `ourOwnFragmentRoundOutingsWithCardsAndImages`, `aNotePasteDropsImagesAndTurnsCardsIntoNames`, `copyWritesFragmentRTFDRTFAndPlainText` (plain text carries `•`, `1.`, `☑`).
  - Identity tests from Task 2, now on the real view.
- [ ] **Step 2–4.**
- [ ] **Step 5: Commit** in two: `feat(notes): add the Field Notes text view` and `feat(notes): paste into and copy out of Field Notes`.

---

### Task 5: The controller and `FieldNotesEditing`

**Files:** Create `Editor/FieldNotesEditorController.swift`. Test: `FieldNotesEditorControllerTests.swift`.

**Interfaces:**
- Consumes: `FieldNotesModel`, `FieldNotesEditing`, `FieldNotesSnapshot`, `FieldNotesPatch` (part 1).
- Produces: `@MainActor final class FieldNotesEditorController: NSObject, NSTextViewDelegate, NSTextStorageDelegate, FieldNotesEditing` with `init(model: FieldNotesModel, textView: FieldNotesTextView, sites: SiteCardSource, images: FieldNotesImageLoader)`, `var selectionState: FieldNotesSelectionState` (observable for the format bar and the menu), `func fieldNotesSnapshot() -> FieldNotesSnapshot`, `func apply(_ patch: FieldNotesPatch)`, `func focus()`, `var onEditSite: ((UUID) -> Void)?`, `var onShowOnMap: ((UUID) -> Void)?`.

Behaviour:
- `textDidChange` → `model.editorDidChange()`; never writes the model's `document`.
- `fieldNotesSnapshot()` → converter blocks (writing id fix-ups back attribute-only, inside the current undo group, trap 7) + the in-memory note store (bodies from open popovers, notes added and removed this session).
- `apply(_:)`: for each changed or removed block, find its paragraph by `.tnBlockID` and replace or delete it; insert new blocks after their predecessor in `patch.document` order; keep the caret by (block id, offset) and clamp; clear the undo stack only when characters changed (spec "Undo"); refresh the note store from `patch.document.notes` for notes not being edited in an open popover (an open popover's note merges on its next write-back instead).
- Context menu additions (`textView(_:menu:for:at:)`): Add Highlight Note (enabled with a selection), and on a card Edit Site…, Show on Map, Remove Card. Remove the Layout Orientation submenu (trap 26: vertical text is meaningless here).
- Site card double-click → `onEditSite(siteID)` when live. Image double-click → Quick Look on the image file (reuse the app's `.quickLookPreview` plumbing through the view, or `QLPreviewPanel` from the controller), with arrow keys paging through the document's images.

- [ ] **Step 1: Failing tests:** `typingReportsAChangeButNeverTouchesTheModelsDocument`; `aPatchReplacesOnlyTheChangedParagraph` (other paragraphs keep their exact attributes and the caret stays at its offset in its paragraph); `aPatchInsertingAboveTheCaretKeepsTheCaretOnItsText`; `aPatchThatChangesCharactersClearsUndo`, `aPatchThatOnlyAddsANoteKeepsUndo`; `aPatchRemovingTheCaretsParagraphPutsTheCaretAtTheNextOne`; `theSnapshotCarriesNotesEditedInAPopover`; `doubleClickingALiveCardAsksToEditTheSite`; `theContextMenuHasNoLayoutOrientation`.
- [ ] **Step 2–4.**
- [ ] **Step 5: Commit** `feat(notes): connect the Field Notes editor to its model`.

---

### Task 6: Highlight notes in popovers

**Files:** Create `Notes/HighlightNotesPopover.swift`, `Notes/NoteBodyEditor.swift`, `Notes/DetachedNotesPopover.swift`. Test: `HighlightNotesPopoverTests.swift` (hosted in a real window as in `probes/p12-popover.swift`).

Behaviour (spec "Highlight notes"):
- Add Highlight Note: creates a `HighlightNote` (author = local spotter, `createdAt` now, empty body), adds its id to the selected runs (one undo step "Add Note"), opens the popover with that note's body focused.
- Clicking highlighted words (the kit's `mouseDown` pattern: ids under the point, `super`, then open if the selection is empty) opens a `.transient` `NSPopover` anchored to the clicked run's rect, sized through `preferredContentSize` (trap 19), max 360 × 520 pt, scrolling beyond.
- Content (SwiftUI in `NSHostingController`): one card per live note under the point, oldest first: the author's name (`Spotter.name(for:in:fallback:)` over the outing's roster) and the date ("Today at 8:05 PM", "Yesterday at…", else a medium date; "· edited" when `editedAt` differs), the body (`NoteBodyEditor`: a `FieldNotesTextView` in `.note` configuration with its own undo manager (trap 20), height following its used rect), a Reply button (a new note by you over the same words: every character that carries the replied note's id gets the new id too), and a ⋯ menu with Delete Note (confirmation when the note has text: "Delete this note? Notes written on it are deleted too." with Delete / Cancel).
- A note body stops accepting text past `FieldNotesLimits.noteBody` (`shouldChangeText` answers false and the Mac beeps), so no note row nears the server's 64 KiB.
- Each body writes back to the controller's note store on every change (debounced 0.3 s) and calls `model.editorDidChange()`; nothing depends on the popover's close notification.
- Closing a popover whose note was created in it and is still empty removes the note and its ids (one undo step on the document).
- A click on highlighted words inside a note body opens a child popover beside the parent, to any depth (`probes/p12`). Verify with real clicks in Task 10; if the parent closes when the child is used, switch to one popover that pushes nested notes with a Back button and a line saying which words they are on, and say so in the report.
- Detached Notes: the format bar's button (Task 8) opens a popover listing `model.detachedNotes`, each with the words it was on (the note's text is shown; the words themselves are gone, so show "Its words were deleted") and Delete.

- [ ] **Step 1: Failing tests:** `addingANoteHighlightsTheSelectionAndOpensItsPopover`; `clickingHighlightedWordsOpensThemOldestFirst`; `aPopoverIsSizedByItsContent`; `aNoteEditorHasItsOwnUndo`; `typingInANoteReachesTheSnapshotWithoutClosingThePopover`; `replyCoversTheSameWords`; `deletingANoteRemovesItsTintAndItsChildren`; `closingAnEmptyNewNoteDiscardsIt`; `aHighlightInsideANoteOpensAChildPopover`; `detachedNotesAreListedAndCanBeDeleted`.
- [ ] **Step 2–4.**
- [ ] **Step 5: Commit** `feat(notes): add highlight notes with replies and notes on notes`.

---

### Task 7: The view, its host, and the new view mode

**Files:** Create `FieldNotesView.swift`, `FieldNotesEditorHost.swift`. Modify `Sources/FieldmarkServices/Detail/ViewMode.swift` (`case fieldNotes`, title "Field Notes", symbol `note.text`, `dims` false), `Sources/FieldmarkUI/Detail/SurveyDetailView.swift` (the `switch`; the empty-outing callout must not show in this mode), `Tests/FieldmarkServicesTests/ViewModeTests.swift`, `Tests/FieldmarkControlTests/ControlApiTests.swift` (`showView_allValidModes`), and any other test `grounding-views.md` §1 lists as enumerating modes. Test: `FieldNotesViewTests.swift`, `FieldNotesHostTests.swift`.

Behaviour:
- `FieldNotesView(model: FieldNotesModel, detail: SurveyDetailModel)`: the format bar (Task 8) on top; the host below; a read-only bar when `model.access` is read-only (spec wording exactly; the newer-version bar's button opens the app's update check, which the app already exposes through its update model); the placeholder line when the document has no visible text.
- Host (`NSViewRepresentable` → `NSScrollView`): builds the TextKit 1 stack once, installs the controller as `model.editor`, loads `model.document`, restores `model.viewport` (caret and scroll) on appear and saves it on disappear; `updateNSView` returns early unless `model.revision` moved (then it only records the revision: the model already applied its patch through `FieldNotesEditing`). The text column is at most 700 pt wide and centred, via `textContainerInset` recomputed on frame change (at least 32 pt each side, 28 pt on top).
- Flush: `onDisappear`, `NSApplication.willResignActiveNotification`, `willTerminateNotification` → `model.flush()`.
- `isEditable` false when read-only.

- [ ] **Step 1: Failing tests:** `theNewModeIsLastAndTitledFieldNotes` (updating the pinned lists); `fieldNotesModeDoesNotDim`; `theViewShowsTheReadOnlyBarForANewerFile` (ViewInspector finds the exact text); `theViewShowsThePlaceholderWhenEmpty`; `updatingTheViewWithoutANewRevisionDoesNothing` (caret and undo intact after a SwiftUI update, p07's check); `theColumnIsCentredAndCapped` (real window at 1400 and 700 pt wide: the text container's used rect is ≤ 700 pt and centred within 1 pt); `switchingViewsAndBackRestoresTheCaret`; `leavingTheViewFlushes`.
- [ ] **Step 2–4.**
- [ ] **Step 5: Commit** `feat(notes): add the Field Notes view`.

---

### Task 8: Format bar, Insert Site, Add Link

**Files:** Create `FieldNotesFormatBar.swift`, `InsertSitePopover.swift`, `LinkSheet.swift`. Test: `FieldNotesFormatBarTests.swift`.

- Format bar (36 pt tall, `.bar` background, hairline under it), controls in groups with 12 pt between groups: a paragraph style pop-up showing the current style (Title, Heading, Subheading, Body); Bold/Italic/Underline/Strikethrough toggles bound to `selectionState` (mixed selection shows off); Bulleted/Numbered/Checklist toggles; Link; Photo (open panel for images, several at once); Site (the Insert Site popover); Note (Add Highlight Note, disabled without a selection); on the trailing side "Detached Notes (n)" when n > 0. Every control has `.help` naming its shortcut, an accessibility label, and calls the text view's action directly, then returns first responder to the text (research: a SwiftUI button may take focus under full keyboard access).
- Insert Site popover: a search field (focused) filtering the outing's sites by name (diacritic-insensitive, reusing the app's `TextFolding` if it fits), each row the site's photo (through `SiteThumbnail`), name and category; ↑/↓ move, Return inserts, double-click inserts, Escape closes. Empty outing: "This outing has no sites yet."
- Link sheet: "Address" field (prefilled with the current link), "Text" field only when nothing is selected, Cancel / Add Link (Save when editing) / Remove Link when editing.

- [ ] **Step 1: Failing tests:** `theBarReflectsTheSelection` (bold on, italic off, heading shown); `everyControlHasAHelpTextWithItsShortcut`; `theNoteButtonNeedsASelection`; `insertSiteFiltersAsYouType`; `insertSiteInsertsACardAsItsOwnParagraph`; `theLinkSheetEditsTheSelectionsLink`; `photoInsertsEachChosenImageAsAParagraph` (drive the insertion function with file URLs; the open panel itself is not testable, `grounding` notes).
- [ ] **Step 2–4.**
- [ ] **Step 5: Commit** `feat(notes): add the Field Notes format bar, site picker and link sheet`.

---

### Task 9: The Format menu

**Files:** Create `FieldNotesCommands.swift`. Modify `Sources/FieldmarkApp/FieldmarkApp.swift` (inside the existing single `.commands { }` block: a second one replaces the first, as its comments explain) and the coordinator (`ControlCoordinator`: `var activeFieldNotesEditor: FieldNotesEditorController?`, set by the host on appear and cleared on disappear; while a note body is first responder, the note's own text view is the target). Test: `FieldNotesCommandsTests.swift`.

- `CommandMenu("Format")` with the items and shortcuts in Global Constraints, in groups: styles | lists and Mark as Checked | Font ▸ (Bold, Italic, Underline, Strikethrough, Monospaced) | Indentation ▸ (Increase, Decrease) | Add Link…, Add Highlight Note, Insert Site…, Insert Photo…. Items are disabled unless a Field Notes editor is active; Insert Site and Insert Photo are disabled inside a note; toggles show checkmarks from `selectionState`.
- Check the shortcuts against every `keyboardShortcut` in the app and the standard menus SwiftUI adds (the Edit menu's Find, Spelling, Substitutions): a test lists every shortcut in the app's command groups and asserts no duplicates.
- If the app's Edit menu lacks Find (⌘F) items, add `TextEditingCommands()` to the same `.commands` block so the find bar is reachable from the menu.

- [ ] **Step 1: Failing tests:** `everyFormatItemHasItsShortcut`; `noTwoMenuItemsShareAShortcut`; `formatItemsAreDisabledWithoutAnEditor`; `insertItemsAreDisabledInsideANote`; `boldFromTheMenuReachesTheActiveEditor` (the p07 pattern: `NSApp.mainMenu.performKeyEquivalent` in a hosted app window).
- [ ] **Step 2–4.**
- [ ] **Step 5: Commit** `feat(notes): add a Format menu for Field Notes`.

---

### Task 10: Snapshots and the live check

**Files:** Modify `Sources/FieldmarkSnapshots/main.swift` (or a sibling registry like `OutingBannerSnapshots` if the file nears its length limit). No new product code unless the live check finds a bug (then test-first, own commit).

- Snapshots: `field-notes` (a populated document: title, headings, bullets, numbers, a checklist with checked items, a photo, a live site card, a removed site card, overlapping highlights), `field-notes-empty`, `field-notes-read-only`, `field-notes-light` (the populated one in light mode). Look at every PNG yourself.
- Live check in the running app (see `brief-view-fixes.md`, "Seeing it in the real app", for the scripts; seed a library with `seed-photo-outing.sh`):
  - Real keystrokes through System Events (`keystroke`, `key code 36` Return, `key code 48` Tab, with `using {shift down, command down}` for shortcuts) after making the app frontmost; real clicks through a compiled CGEvent helper.
  - Type a heading, a paragraph, a bulleted list with a nested item, a numbered list, a checklist (tick one with a real click on the circle), bold and strike a word with ⌘B and ⇧⌘X, add a link with ⌘K, insert a site with Insert Site, paste an image file (copy a JPEG in Finder with `osascript -e 'set the clipboard to (POSIX file "…")'`), add a highlight note with ⇧⌘K and type in it, reply, open a note on a note with a real click, close popovers by clicking outside.
  - Switch to Map and back: caret and scroll are where they were. Quit and relaunch: everything is back. Delete the site behind a card from the List view: the card shows "Removed from the outing".
  - Screenshot each step (`drive.sh shot`; `screencapture -x` for popovers and menus, which `/screenshot` cannot see); dark and light (`defaults write -g AppleInterfaceStyle Dark` / delete, then relaunch the copy under test only).
  - Performance: open the 30-page document from `probes/p11-perf.swift`'s generator (port the generator into a test helper) and time load and typing; the `FieldNotesPerformanceTests` guard asserts load under 250 ms and a keystroke under 16 ms at p95 on this VM.
- Keep the best screenshots in `/home/dev/src/temp-fieldmark-field-notes/shots-field-notes/`.

- [ ] **Step 1:** Snapshots added and inspected. **Step 2:** Live run, bugs fixed test-first. **Step 3:** Whole suite, lint, build. **Step 4: Commit** `test(notes): add Field Notes snapshots and a load-time guard`.

## Done when

- Every task's tests pass; the whole suite, lint and build are clean.
- The live check above was done with real keys and clicks, and its screenshots are in the scratch folder.
- The report lists commits, test counts before and after, every site the plan was not followed and why (with evidence), pre-existing bugs fixed, and anything that behaves differently in the running app than in tests.
