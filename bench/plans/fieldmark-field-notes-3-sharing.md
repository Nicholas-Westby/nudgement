# Field Notes, part 3: sharing, the bundle, the control API and the docs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. In this project one implementer carries the whole plan (Robin's rule: few agents per feature), so execute it task by task yourself with superpowers:test-driven-development; do not start subagents.

**Goal:** Field Notes visit with a shared outing without anybody's words being lost, go into and come out of a `.fieldmark` file, can be driven over the control API, and are documented; plus the two pre-existing sharing bugs found while designing this.

**Architecture:** Two new entity kinds (`noteBlock`, `highlightNote`) ride the existing per-row sync with one change: notes rows are written compare-and-swap against the revision this Mac last saw, and a conflict or an incoming row that meets an unsent local change is merged three ways with part 1's `FieldNotesMerge`. A small server change (no migration) adds the kinds, the conditional write and a `kinds` list in pull replies; until the deployed server lists the kinds, notes rows wait in the outbox. Notes images use the existing asset routes under a fixed owner UUID.

**Tech Stack:** Swift 6, Swift Testing, the engine in `Sources/FieldmarkPresentation/Sharing/`, the wire in `Sources/FieldmarkServices/Sharing/`, Cloudflare Pages Functions in `functions/api/shares/` (JavaScript, the platform's language, already in the repo), bash test scripts over `wrangler pages dev`.

**Spec:** `docs/superpowers/specs/2026-09-25-field-notes-design.md`, sections "Sharing", "Merging", "Site cards", "The `.fieldmark` bundle", "Control API and scripted checks", "Help and README", "Pre-existing bugs". Read `/home/dev/src/temp-fieldmark-field-notes/grounding-storage-sharing.md` whole first: it maps every file this plan touches, with the traps (fact 1: an unknown kind jams a share; fact 10: older builds skip unknown kinds and move past them).

## Global Constraints

- Work in `/home/dev/src/fieldmark/.claude/worktrees/field-notes` (branch `field-notes`) only; `cd` there in every command.
- **Never deploy** (`deploy-cloudflare.sh`, `wrangler pages deploy`, `wrangler d1 … --remote`). Server changes are verified with `wrangler pages dev` only; `wrangler login` has not been run on this VM and must not be.
- The repo's language rule (`RepoLanguageTests`): Swift, bash, and the Pages Functions' JavaScript; no `node`/`npm`/`npx`/`jq` in scripts except the existing `# language-exception:` lines in `Scripts/wrangler-lib.sh`.
- Existing kinds keep last-writer-wins exactly as today; only rows carrying `baseRevision` are conditional.
- `FakeShareServer` exists twice (`Tests/FieldmarkPresentationTests/`, `Tests/FieldmarkUITests/`); both must behave like the real server, including rejecting kinds the server does not list.
- Commits: Conventional Commits via `house-style:how-to-commit`, no trailers, explicit paths. Gates: `./Scripts/build.sh`, `./Scripts/test.sh`, `./Scripts/lint.sh` (then `git diff`), `./Scripts/test-sharing-server.sh`, `./Scripts/test-sharing.sh`, `./Scripts/e2e.sh`. A script that exits 0 because wrangler could not run has **not** verified anything: make wrangler run (it resolves `npx --yes wrangler@4`; Node is in `~/.nvm`) and say in the report which scripts really ran.
- Pre-existing bugs met in touched files: fix test-first in their own commit and report them.

## Review Focus

- **A build with this code talking to the old, undeployed server:** no notes row is ever sent, nothing about the rest of the share changes, and the share status does not show an error or a growing backlog because of notes. Pinned in Task 3.
- **Two Macs pushing edits to the same paragraph inside one vote interval:** the second push conflicts, merges and re-pushes; both Macs end with the same paragraphs and neither edit is lost. Pinned in Task 5.
- **A Mac that upgrades after notes were written:** it re-reads the share once and gets them. Pinned in Task 3.
- **A notes image added on one Mac:** the other Mac downloads it and the image block draws it; a card's photo copy travels the same way. Pinned in Task 4.
- **Importing a `.fieldmark` file with notes into a library where the sites get new ids:** every card points at the new site, images are renamed consistently, and a card whose site was deleted keeps its snapshot. Pinned in Task 6.

## Notes from parts 1 and 2 (read before Task 1)

- **A notes row is never dropped for its size.** `canSend` drops any outbox row over
  `ShareLimits.entityBodyBytes` (64 KiB) with only a log line; for the notes kinds that would lose
  someone's words for good. The editor splits paragraphs whose encoded JSON would pass 48 KiB (part
  2), and every model edit path that can make a big block (`appendBlock`, `addNote` text, the
  control API) must split or refuse the same way (add that here, test-first). If an oversized notes
  row still reaches the engine, it stays queued, is logged at `.error`, and `/state.fieldNotes`
  reports it (`oversizedRows`), rather than being dropped.
- **Unreferenced notes images:** removed blocks still count as using their images (part 1), so a
  file only becomes unreferenced when nothing ever saved it. Call
  `FieldNotesStore.removeUnreferencedImages(of:)` when an outing's notes model closes (not on every
  save). A file deleted locally that a later remote row names is downloaded again, so this is safe on
  a shared outing.
- Part 1 APIs as they landed: `FieldNotesMerge.mergeNote(base:local:remote:newID:)`,
  `FieldNotesStore.save` returns the document as the next load reads it, `FieldNotesPatch` also has
  `movedBlockIDs`. Read `Sources/FieldmarkCore/FieldNotes/` before Task 3; names there win over this
  plan's.

---

### Task 1: The server

**Files:** Modify `functions/api/shares/_lib.js`, `functions/api/shares/[id]/changes.js`, `functions/api/shares/index.js` (create also validates entities: keep it consistent), `Scripts/test-sharing-server.sh`.

What to build:
- `ENTITY_KINDS` gains `noteBlock` and `highlightNote`; export `NOTES_KINDS` too.
- `validateEntities` accepts an optional `baseRevision` (an integer ≥ 0; anything else is `400 "baseRevision is not a whole number"`), carries it through, and still collapses duplicate `kind/id` pairs to the last.
- A second statement, `UPSERT_ENTITY_IF_SQL`: the same insert, with `ON CONFLICT (share_id, kind, id) DO UPDATE SET … WHERE entities.revision = ?8`, `RETURNING seq, revision`. `baseRevision` 0 means "only if new": an existing row fails the `WHERE` (revisions start at 1). Rows without `baseRevision` use today's statement unchanged.
- The push reply: `revisions` for rows that wrote (their `RETURNING` row), and a new `conflicts` map `"kind/id" → current revision` for conditional rows that did not. Read the current revisions with one `SELECT kind, id, revision FROM entities WHERE share_id = ?1 AND ((kind = ? AND id = ?) OR …)` appended to the same batch (so it sees the batch's own writes), or one small SELECT per conflicting row appended after the upserts; keep the existing `outcome[index + 1]` alignment for the upserts (the existing comment explains why). A push whose rows all conflicted still returns 200 with an empty `revisions`.
- Pull replies (`GET /changes`) gain `kinds: [...ENTITY_KINDS]` (sorted).
- New cases in `Scripts/test-sharing-server.sh` (bash + curl, as the file already does; build JSON arguments into variables first, per the file's note):
  - each new kind is accepted and pulled back with its body;
  - `"kind":"nonsense"` is still `400 "kind is unknown"`;
  - a pull reply lists `kinds` including both new kinds;
  - `baseRevision` equal to the current revision writes (revision + 1);
  - a stale `baseRevision` does not write, the reply lists it under `conflicts` with the current revision, and the row's body is unchanged on the next pull;
  - `baseRevision: 0` for an existing row conflicts; for a new row writes revision 1;
  - one push mixing a conflicting notes row, a good notes row and a `site` row writes the last two;
  - `baseRevision: "7"` and `-1` are `400`.
- [ ] **Step 1:** Write the new cases; run `./Scripts/test-sharing-server.sh`; see them fail (and confirm wrangler really ran: the script says so).
- [ ] **Step 2:** Implement. **Step 3:** All cases pass, old ones included.
- [ ] **Step 4: Commit** `feat(sharing): let the server carry Field Notes and write them only against the revision the writer saw`.

---

### Task 2: The wire and the fake server

**Files:** Modify `Sources/FieldmarkCore/Sharing/SharedEntity.swift` (`SharedEntityKind` gains `noteBlock`, `highlightNote`; fix the "five kinds" comment), `Sources/FieldmarkCore/Persistence/ShareOutbox.swift` (`OutboxEntry.baseRevision: Int?`, decoded tolerantly), `Sources/FieldmarkServices/Sharing/ShareWire.swift` (`ShareEntityWrite.baseRevision: Int?` encoded only when present; `SharePush.conflicts: [String: Int]` defaulting to `[:]`; `SharePage.kinds: [String]?`), both `FakeShareServer` copies, `SharedEntityTests` (`theFiveKindsAreTheOnlyKinds` becomes the seven), and the wire tests.

The fake server gains: a configurable `acceptedKinds` (default: all seven; a test can set the old five to play the undeployed server, which then answers `400 "kind is unknown"` like the real one), the conditional write and `conflicts`, and `kinds` in pull replies (omitted when `acceptedKinds` is the old five, as the old server omits it).

- [ ] **Step 1: Failing tests:** `aNotesWriteCarriesItsBaseRevision`, `anOrdinaryWriteCarriesNone` (encoded JSON has no `baseRevision` key), `aPushReplyWithoutConflictsDecodes` (old server shape), `aPushReplyWithConflictsDecodes`, `aPageWithoutKindsDecodesAsNil`, `anOutboxWrittenByAnOlderBuildStillDecodes`; fake server: `theFakeRefusesKindsItDoesNotAccept`, `theFakeWritesConditionallyAndReportsConflicts`.
- [ ] **Step 2–4.**
- [ ] **Step 5: Commit** `feat(sharing): carry Field Notes kinds, base revisions and conflicts on the wire`.

---

### Task 3: The engine: sending, applying, merging, the guard and the catch-up

**Files:**
- Create: `Sources/FieldmarkCore/Persistence/FieldNotesSyncLedger.swift` (file `field-notes-sync.json`, 0600, `{ "rows": { "<kind>/<id>": { "revision": Int, "base": String } } }`, tolerant: absent or unreadable means empty), `Sources/FieldmarkPresentation/Sharing/FlockSyncEngine+FieldNotes.swift`.
- Modify: `FlockSyncEngine.swift` (known maps `knownNoteBlocks`, `knownHighlightNotes`: `[UUID: String]` of encoded bodies; `fieldNotesSaved`; `seedKnownValues`), `FlockSyncEngine+Apply.swift` (`PageState.notes`, the two kinds in `applyByKind`, the unsent rule for notes rows), `FlockSyncEngine+Sync.swift` (push: only send notes rows when the server accepts them; handle `conflicts`; record the ledger on acknowledge; read `kinds` from pull replies), `ShareRegistry.swift` (`fieldNotesSaved` forwards like `kitSaved`; `snapshot(of:)` includes notes rows last), `Sources/FieldmarkCore/Persistence/ShareStore.swift` (`ShareBinding.notesKindsSeen: Bool`, decoded tolerantly, default false), `ShareStatusPresentation` if it counts the outbox (notes rows held by the guard are not "waiting").
- Test: `Tests/FieldmarkPresentationTests/FlockSyncFieldNotesTests.swift`, additions to `ShareRegistryForwardingTests` and `FlockSyncApplyKindTests`.

Behaviour:
- **Sending.** `fieldNotesSaved(document)`: every block and note whose encoded body differs from the known map is `recordChange` with `baseRevision` = the ledger's revision for that key, or 0 when the ledger has none. Nothing is ever a tombstone: removal is `removed: true` in the body. The known maps are refreshed after (as `kitSaved` does). An outbox row that replaces an existing one for the same key keeps the **older** row's `baseRevision` (the base is what the server had before this Mac's first unsent edit).
- **The guard.** `serverAcceptsNotes` is true once a pull reply's `kinds` contains both notes kinds (persist it in `ShareBinding.notesKindsSeen`). Until then the push sends every other row and leaves notes rows in the outbox untouched, and neither `pending` nor the share status counts them as a backlog. A share created by this build sends notes rows in `create` only if the server's create reply shows it knows them (it does not list kinds: so leave notes rows out of `create` and let the first pull decide).
- **Catch-up.** The first time `kinds` lists the notes kinds on a binding whose `notesKindsSeen` is false: set it, set `lastSeq = 0`, save the binding, and pull again from the start (applying is create-or-update, so the replay is safe; measure it on the 46-site fixture and note the time in the report).
- **Acknowledge.** For every notes row in `revisions`: ledger[key] = (revision, the body sent). For every row in `conflicts`: keep it in the outbox (do not remove it), and schedule a pull at once.
- **Applying a notes row** (inside `apply(_:)`, `PageState.notes` loaded once per page, saved once when touched, through `FieldNotesStore` so the observer hears it while `isApplyingRemote` suppresses re-enqueueing):
  - produced by this Mac (the echo check): skip, but make sure the ledger holds that revision;
  - no unsent local row for the key: upsert the block or note into the document (by id; `removed` honoured; blocks keep their `sort`), ledger[key] = (entity.revision, entity.body);
  - an unsent local row for the key: `FieldNotesMerge.mergeBlock` / `mergeNote` with base = the ledger's body (nil if none), local = the outbox row's body, remote = the entity's body; write the result into the document; replace the outbox row with the merged body and `baseRevision = entity.revision` (write the outbox directly: `enqueue` returns early while applying); ledger[key] = (entity.revision, entity.body). For `.keptBoth`, also put the copy in the document right after the local block (a `sort` between it and its successor) and add an outbox row for the copy with `baseRevision` 0.
  - a body that does not decode (a newer build's block): store it verbatim anyway (part 1's unknown-content rules keep it), never drop it.
- **Deleted tombstones** for notes kinds never come from this build; if one arrives (a future build), treat it as `removed: true`.
- **Reload.** After a page that touched notes, `remoteChangesApplied()` already runs; `SurveyDetailModel.load()` reloads the notes model (part 1). No other seam is needed.

- [ ] **Step 1: Failing tests** (fake server, one engine, a real `FieldNotesStore` on a temp dir):
  - `savingNotesQueuesOneRowPerChangedBlockAndNote`; `anUnchangedBlockIsNotSentAgain`; `aRemovedBlockIsSentAsRemovedNotDeleted`.
  - `theFirstEditCarriesBaseRevisionZeroAndTheNextTheAcknowledgedRevision`; `aSecondUnsentEditKeepsTheFirstEditsBase`.
  - Guard: `againstAServerWithoutTheKindsNotesRowsWaitAndEverythingElseSyncs` (fake with the old five: sites still push, no 400, no `.failed`, notes rows still in the outbox, status not failing, `pending` excludes them); `onceTheServerListsTheKindsTheWaitingRowsGo`.
  - Catch-up: `learningTheKindsForTheFirstTimeRereadsTheShareOnce` (a second pull with kinds does not re-read again).
  - Apply: `anIncomingBlockWithNoLocalChangeIsApplied`; `anIncomingBlockMeetingAnUnsentEditIsMergedAndRequeuedAgainstTheNewRevision`; `aConflictReplyKeepsTheRowAndPullsAtOnce`; `keptBothAddsACopyRightAfterAndQueuesIt`; `anUndecodableBlockIsKeptVerbatim`.
  - Registry: `savingFieldNotesReachesTheShare`.
- [ ] **Step 2–4.**
- [ ] **Step 5: Commit** in two: `feat(sharing): send Field Notes rows against the revision this Mac saw` and `feat(sharing): merge incoming Field Notes rows instead of dropping them`.

---

### Task 4: Notes images through the asset routes

**Files:** Create `Sources/FieldmarkCore/FieldNotes/FieldNotesFiles.swift` (`public enum FieldNotesFiles { public static let ownerID = UUID(uuidString: "7E1D0A7E-0000-4000-8000-000000000001")! }` — any fixed, valid UUID; document it). Modify the engine's transfer code where it resolves a site folder (`SiteFolders.folder(_:)`), queues uploads after an acknowledged push (`queueUploads(for:)`), notes arrivals from applied rows, reconciles listings on a real start, and `ShareRegistry.queueEverySharedFile`. Test: `FlockSyncFieldNotesFilesTests.swift`.

Behaviour:
- A notes image or card photo copy is `sites/<ownerID>/images/<file>`; the owner folder resolves to `<survey>/field-notes/images`.
- After a push that carried a notes row naming files, queue those files' uploads (bytes present only), as sites do.
- Applying a notes row that names a file this Mac does not have queues its download; the download writes into the notes images folder and the editor redraws (the model reloads after the page; the image loader keys on the file's modification date).
- Nothing deletes notes objects on the server in v1 (a file one Mac stops referencing may still be referenced by a row another Mac has not sent yet); local unreferenced files are removed by `FieldNotesStore.removeUnreferencedImages` only for files this Mac never uploaded. Note the leak in the report and in HelpGuide's sharing limits.
- Share start queues every notes image the document references.

- [ ] **Step 1: Failing tests:** `aNotesImageIsUploadedAfterItsRowIsAcknowledged`; `aRowNamingAMissingImageDownloadsIt`; `theOwnerFolderIsTheNotesImagesFolder`; `startingAShareQueuesEveryReferencedNotesImage`; `aCardPhotoCopyTravelsLikeAnImage`.
- [ ] **Step 2–4.**
- [ ] **Step 5: Commit** `feat(sharing): carry Field Notes images with a shared outing`.

---

### Task 5: Two Macs

**Files:** Add cases to the two-Mac `FlockSyncIntegrationTests` (find it; it drives two engines against one fake server).

Scenarios, each ending with both Macs' `field-notes.json` documents equal (visible blocks and live notes):
- `twoAnswersToTheSameQuestionAtOnceBothSurvive` (two new notes on the same words, pushed inside one interval; the block's runs carry both ids).
- `twoEditsToTheSameParagraphAtOnceKeepBoth` (overlapping words: a copy block appears after the original on both Macs).
- `editsToDifferentWordsOfOneParagraphMerge`.
- `aTickAndATextEditToOneItemBothSurvive`.
- `anEditRacingARemovalKeepsTheBlock`.
- `aBlockInsertedInTheMiddleArrivesInTheMiddle` and `aMovedBlockArrivesMoved`.
- `aNoteOnANoteTravels`.
- `anImageTravels`.
- `aMacOnTheOldServerNeverJamsTheShare` (Mac B's fake refuses notes kinds: sites still sync both ways).
- [ ] **Step 1–4** (these may pass on first run if Tasks 3–4 are right; still watch each fail by breaking the code once, e.g. disabling the merge, and say so).
- [ ] **Step 5: Commit** `test(sharing): prove Field Notes survive two Macs editing at once`.

---

### Task 6: The `.fieldmark` bundle

**Files:** Modify `Sources/FieldmarkCore/Bundle/SurveyBundle.swift` (`fieldNotes: BundledFieldNotes?`, `currentFormatVersion = 3`), `SurveyBundleCoding.swift` (`Key.fieldNotes`), `Sources/FieldmarkCore/Persistence/SurveyLibrary+Bundle.swift` (`exportBundle`, `adopt`). Test: `SurveyLibraryBundleTests` additions (find the file).

- Export: the document (flushed first: the export path must call the open model's `flush()` if the outing is open — add that where the UI starts an export), every image it references as a `BundledFile`, and each site card's `siteID` replaced by `siteIndex` through `indexByID` (a card whose site is gone keeps only its snapshot and no index).
- Import: after `idByIndex` is filled (where stops are mapped), map `siteIndex` back to the new id; import each image through `FieldNotesStore.importImage(data:)` and rewrite every reference through the old→new name map; keep block, note and spotter ids verbatim; save once.
- An older build ignores the key; this build reads a format-2 file with no notes as before.
- [ ] **Step 1: Failing tests:** `notesRoundOutingThroughABundle`; `cardsPointAtTheNewSiteIDsAfterImport`; `aCardForADeletedSiteKeepsItsSnapshot`; `imagesAreRenamedAndEveryReferenceFollows`; `aFormatTwoFileStillImports`; `exportFlushesTheOpenEditorFirst`.
- [ ] **Step 2–4.**
- [ ] **Step 5: Commit** `feat(bundle): carry Field Notes in .fieldmark files`.

---

### Task 7: Control API and scripted checks

**Files:** Create `Sources/FieldmarkControl/ControlApi+FieldNotes.swift`. Modify `ControlApi.swift` (`/state.fieldNotes`), `ControlApi+Commands.swift` (chain the handler), `Tests/FieldmarkControlTests/ControlCommandNames.swift`, `Scripts/e2e.sh`, `Scripts/test-sharing.sh`. Test: `Tests/FieldmarkControlTests/ControlApiFieldNotesTests.swift`.

- `/state.fieldNotes`: `blockCount`, `noteCount`, `detachedCount`, `imageCount`, `siteCardCount`, `formatVersion`, `readOnly`, `pendingShare` (notes rows held by the guard), `text` (first 2,000 characters of plain text, blocks joined by newlines).
- Commands (each calls part 1's `FieldNotesModel` edits; 404 `{"error":"no outing open"}` without a detail model; 400 with a clear error for bad input): `notes-append {"text","style"?: "paragraph|title|heading|subheading","list"?: "bullet|number|check"}`, `notes-add-note {"words","text"}`, `notes-reply {"noteID","text"}`, `notes-delete-note {"noteID"}`, `notes-embed-site {"name"}`, `notes-add-image {"path"}`, `notes-check {"text","checked"}`.
- `Scripts/e2e.sh`: `check_field_notes` — append a heading, a paragraph and a checklist item; embed "Quelavik"; add a note; check the item; `/state.fieldNotes` counts; `field-notes.json` on disk has them; delete "Quelavik" (last, as destructive checks must be) and see the card's snapshot name remain in `/state.fieldNotes.text`; add an image from a fixture and see the file under `field-notes/images/`. `check_survey_bundle` exports and re-imports an outing with notes. Keep `settle_modal` before any alert answer.
- `Scripts/test-sharing.sh`: a step where the owner appends a paragraph and the member sees it in `/state.fieldNotes.text` within the vote window, and the member's note on it reaches the owner.
- [ ] **Step 1: Failing tests** for each command and `/state`; `theListOfCommandsIsComplete` still passes with the new names.
- [ ] **Step 2–4;** run `./Scripts/e2e.sh` and `./Scripts/test-sharing.sh` (really running wrangler).
- [ ] **Step 5: Commit** `feat(control): drive and inspect Field Notes over the control API`.

---

### Task 8: Help and README

**Files:** `Sources/FieldmarkUI/Resources/HelpGuide.md`, `README.md`.

- HelpGuide (the help assistant's whole prompt, so plain, complete and accurate): a "Field Notes" section (what it is for; formatting and the shortcuts; checklists; images; site cards and what happens when a site is deleted; highlight notes, replies, notes on notes, detached notes; that everyone on a shared outing sees them and that two people editing one paragraph at once keeps both versions); "The five views" becomes six; the sharing section mentions Field Notes and the new-server requirement in user words ("Field Notes reach other people once the sharing service has been updated"); "Things the app does not do" no longer claims there is no undo (Field Notes have undo; sites do not). Run the help assistant's resource self-test (`ResourceSelfTest`).
- README: Features (a Field Notes bullet; six views), On-disk layout (`field-notes.json`, `field-notes/images/`, `field-notes-sync.json`), the bundle sketch. Separately, in its own commit, fix the drift the grounding found (the layout omits `spotters.json`, `assets.json`, `site.json`'s `insight` and `spotterID`; the bundle sketch omits `spotters` and `spotterID`).
- [ ] **Step 1:** Edit. **Step 2:** `./Scripts/test.sh --filter ResourceSelfTest` (or the test that loads the guide). **Step 3: Commit** `docs: describe Field Notes in the help guide and README` and `docs(readme): bring the on-disk layout up to date`.

---

### Task 9: The kit list stops saving stale copies (pre-existing bug)

**Files:** `Sources/FieldmarkPresentation/Detail/SurveyDetailModel.swift` (the kit methods), `Sources/FieldmarkUI/Kit/KitSheetView.swift`, the share seams in `DetailOrError`. Test: `SurveyDetailModelKitTests` additions.

The bug (grounding F1): the sheet's list is loaded on appear only, `load()` never reloads it, and every mutation saves the in-memory copy, so an item another Mac added while the sheet was open is deleted everywhere by the next tick, and a remote tick is undone.

- Every kit mutation becomes load → change → save, with no suspension between (the discipline part 1 uses for notes).
- `SurveyDetailModel.load()` also reloads the kit list (so a pull shows up in an open sheet).
- [ ] **Step 1: Failing tests:** `tickingAfterAnotherMacAddedAnItemKeepsTheirItem`; `tickingDoesNotUndoARemoteTick`; `aPullShowsUpInAnOpenKitList`.
- [ ] **Step 2–4.**
- [ ] **Step 5: Commit** `fix(kit): never save a stale kit list over newer items`.

---

### Task 10: Order travels for stops and kit items (pre-existing bug)

**Files:** `Sources/FieldmarkCore/Route/…` (`RouteStop` gains `sort: String?`), `Sources/FieldmarkCore/Kit/KitItem.swift` (`sort: String?`), `moveStops` and the kit `move` (assign `FractionalIndex` keys to moved and inserted items), `FlockSyncEngine+Apply.swift` (`applyStop`/`applyItem` insert by `sort` when present, else append as today), the diffs (a changed `sort` is a change, so a reorder is sent). Test: additions to `FlockSyncApplyKindTests`, the route and kit model tests, and one two-Mac case each.

The bug (grounding F2): a hand reorder is never sent (the diff compares values and order is not a value), and an item inserted mid-list arrives last on other Macs.

- Items without `sort` (every existing file, and every older build's write) keep their array order; the first reorder on this build gives every item a key. An older build drops `sort` when it rewrites an item; that item then falls back to arrival order: acceptable, say so in the report.
- [ ] **Step 1: Failing tests:** `aReorderedStopIsSent`, `aStopInsertedInTheMiddleArrivesInTheMiddle`, `theKitListKeepsItsOrderAcrossMacs`, `itemsWithoutKeysKeepTheirOrder`.
- [ ] **Step 2–4.**
- [ ] **Step 5: Commit** `fix(sharing): send the order of route stops and kit items`.

## Done when

- Every task's tests pass; `./Scripts/test.sh`, `./Scripts/lint.sh`, `./Scripts/build.sh` are clean; `./Scripts/test-sharing-server.sh`, `./Scripts/test-sharing.sh` and `./Scripts/e2e.sh` pass **with wrangler actually running** (say so explicitly, with the line from their output that proves it).
- Nothing was deployed.
- The report lists commits, test counts before and after, which scripts really ran, the catch-up re-read time, the known leak of server-side notes images, and anything that went differently from the plan and why.
