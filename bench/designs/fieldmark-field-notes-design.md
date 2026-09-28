# Field Notes: design

Date: 2026-09-25. Branch: `field-notes`. Status: approved by the session under Robin's standing
"never ask me" rule; the assumptions it rests on are listed at the end.

Evidence behind it, in `~/Dev/temp-fieldmark-field-notes/`: `grounding-storage-sharing.md` (how a
survey is stored, bundled and shared), `grounding-views.md` (the detail views), and
`research-rich-text.md` with a working throwaway prototype of the editor in `probes/Kit*.swift`
and 17 probes.

## Intent

A freeform document per outing that everyone on the outing reads and writes, shown as one of the outing's
views (beside List, Map, Gallery, Categories and Route), never as a sheet. People use it for:

- things everybody should know (hospital and embassy numbers, ferry times, door codes);
- inspiration (pasted and dragged-in photos);
- talking about sites, including sites that were removed ("dropped Braveby, too touristy"),
  through site cards that follow the site while it exists and keep its last look after it is
  deleted;
- planning: questions in the text that other people answer by attaching notes to the words, and
  notes on notes, to any depth;
- to-do lists.

It has to feel like a Mac text editor (Notes, TextEdit, Pages) and be rock solid: nothing anybody
types is lost, on one Mac or across a shared outing.

## Scope

In v1: Title, Heading, Subheading and body paragraphs; bold, italic, underline, strikethrough,
monospaced and links; bulleted, numbered and checklist items nested up to six levels; images; site
cards; highlight notes with replies and notes on notes; find, spelling, undo; copy and paste within
the app and with other apps; sharing with conflict handling; the `.fieldmark` bundle; control API
commands and `/state` for scripted checks; help and README.

Not in v1: tables, arbitrary fonts, colours and sizes, alignment, drawings, audio, printing and PDF,
notes in the AI planner, live character-by-character co-editing, restoring deleted text from the UI,
resizing images by hand, a text highlight colour.

## Words

- **Field Notes**: the document and its view. The view's title is "Field Notes" (a site already has
  its own "Notes" field; the two must never be confused in UI copy or code names).
- **Highlight note**: a note attached to a stretch of text. Several can cover the same words
  (replies), and they can overlap.
- **Site card**: a site embedded in the notes.

## What people see

### The view

- `ViewMode.fieldNotes`, the last segment of the View picker, symbol `note.text`, title "Field Notes".
  It is not a site view: no spotter strip (`dims` false), no empty-outing arrow.
- A format bar pinned at the top, then the scrolling document: one text column, at most 700 pt wide,
  centred, with at least 32 pt either side and 28 pt above the first line; the scroller sits at the
  window edge.
- An empty document shows a placeholder in the first line: "Write anything the whole outing should
  know: phone numbers, ideas, questions for the group…"
- The view keeps its scroll position and caret per outing while the app runs (switching views and back
  returns to the same site).
- Read-only states, each with a bar above the text:
  - notes written by a newer app: "These notes use features from a newer version of Fieldmark. Update
    Fieldmark to edit them." and a Check for Updates button (the app's own updater);
  - a file that cannot be read: "These notes can't be read, so they're shown read-only to keep
    them safe." Nothing is ever written over such a file.

### Formatting

- Format bar, left to right: a paragraph style pop-up (Title, Heading, Subheading, Body; shows the
  current one), Bold/Italic/Underline/Strikethrough toggles showing the selection's state, list
  toggles (Bulleted, Numbered, Checklist), Link, Photo, Site, Note, and on the right "Detached
  Notes (n)" when there are any. Every control has a tooltip naming its shortcut.
- A Format menu in the menu bar, enabled while the Field Notes view shows, with Notes-compatible
  shortcuts:

  | Item | Shortcut | Item | Shortcut |
  | --- | --- | --- | --- |
  | Title | ⇧⌘T | Bold | ⌘B |
  | Heading | ⇧⌘H | Italic | ⌘I |
  | Subheading | ⇧⌘J | Underline | ⌘U |
  | Body | ⇧⌘B | Strikethrough | ⇧⌘X |
  | Bulleted List | ⇧⌘7 | Monospaced | none |
  | Numbered List | ⇧⌘9 | Increase Indent | ⌘] |
  | Checklist | ⇧⌘L | Decrease Indent | ⌘[ |
  | Mark as Checked | ⇧⌘U | Add Link… | ⌘K |
  | Add Highlight Note | ⇧⌘K | Insert Site… / Insert Photo… | none |

  The implementer checks every shortcut against the app's existing ones (none are in use today)
  and against the system's.
- Typing at the start of a paragraph: "- " or "* " starts a bulleted list, "1. " a numbered one,
  "[] " or "[ ] " a checklist. One undo turns it back into the typed characters.
- Return continues a list (a new checklist item starts unchecked). Return on an empty item outdents
  it, and at the top level leaves the list. Tab and Shift-Tab indent and outdent list items (Tab
  elsewhere types a tab). Backspace at the start of a list item makes it body text; a second one
  joins it to the paragraph above. Return after a heading gives body text.
- Links: typed and pasted URLs become links; ⌘K adds or edits a link on the selection (a small
  sheet with the address, and the text when nothing is selected). Clicking a link opens it.
- Standard Mac text behaviour stays: Find (⌘F find bar), continuous spelling, smart quotes and
  dashes, text replacements, dictation, Services, Undo and Redo. Writing Tools runs `.limited` on
  macOS 15 and later.

### Checklists

Notes-style circles in the indent column. A checked item has an accent-filled circle with a white
tick, and its text is dimmed and struck through at draw time (never stored). Click the circle to
toggle; ⇧⌘U toggles every item in the selection. The caret never lands inside the circle.

### Images

- Paste, drag in from Finder, Safari or Photos, or Insert Photo… (an open panel, several at once).
  Each image becomes its own paragraph, fitted to the column width, never enlarged, with rounded
  corners. It is decoded lazily at the size shown.
- Stored like site photos (the app's `ImageEncoding`: HEIC under the size cap) as
  `field-notes/images/<UUID>.<ext>`.
- Double-click: Quick Look. Delete it like text.

### Site cards

- Insert Site… opens a popover with a search field over the outing's sites (photo, name,
  category). Return or a double-click inserts a card as its own paragraph at the caret.
- A card is a rounded panel up to 460 pt wide: a 72 pt photo on the left; the name, its category
  (colour and symbol from the outing's map colours) and the one-line summary on the right; a star
  when the site is a favourite.
- While the site exists the card draws the live site, so a rename, a new category or a new first
  photo shows at once.
- Once the site is deleted, the card draws its snapshot: photo dimmed, and "Removed from the
  outing" under the name.
- Double-click a live card to edit the site. Right-click: Edit Site…, Show on Map, Remove Card
  (a removed site offers only Remove Card).

### Highlight notes

- Select words and choose Add Highlight Note (⇧⌘K, the Note button, or the right-click menu). The
  words get a soft tint (readable in light and dark) and a popover opens with a new note by you,
  ready to type.
- Click highlighted words: the caret goes there and a popover opens beside them listing every note
  on that spot, oldest first. Each note shows its author's name, when it was written ("Today at
  8:05 PM"; "edited" if changed), its text (rich text with the same formatting and shortcuts, no
  images or site cards), a Reply button and a ⋯ menu with Delete Note.
- Reply adds a new note by you over the same words as the note replied to. Overlapping notes draw
  darker where they overlap.
- Notes on notes: select words inside a note and add a note; clicking highlighted words inside a
  note opens a popover beside that popover, to any depth.
- A popover closed with its new note still empty discards the note and its tint.
- Deleting highlighted words does not delete their notes. They show under Detached Notes (a
  popover listing each with the words it was on, and Delete) until someone deletes them. Undo
  brings the tint back.
- Deleting a note removes its tint and also deletes the notes written on its own words.
- Notes save as you type.

### Shared outings

- Everyone on the share sees edits within about ten seconds.
- Two people editing the same paragraph at the same moment: both versions are kept, one after the
  other. Two people adding notes to the same words: both notes stay. Nothing is silently dropped.
- Field Notes visit only once the sharing server has the matching update (see Deployment). Until
  then each Mac keeps its own notes and the rest of the share syncs as today.

## Data model (FieldmarkCore, Foundation only)

### Files

```
<survey>/field-notes.json                  the document (JSONFile: sorted keys, ISO 8601, atomic)
<survey>/field-notes/images/<UUID>.<ext>   pasted images and site-card photo copies
<survey>/field-notes-sync.json (0600)      sharing bookkeeping; never exported or shared
```

A missing `field-notes.json` is an empty document. A file that does not decode, or needs a newer
reader, opens read-only and is never written.

### Schema (format 1)

```json
{
  "format": "fieldmark.field-notes",
  "formatVersion": 1,
  "minReaderVersion": 1,
  "blocks": [
    {"id": "UUID", "sort": "a0", "type": "heading", "level": 1,
     "content": [{"text": "Norway, June"}],
     "createdBy": "UUID", "createdAt": "…", "editedBy": "UUID", "editedAt": "…"},
    {"id": "UUID", "sort": "a1", "type": "paragraph",
     "content": [
       {"text": "Take the "},
       {"text": "early ferry", "marks": ["bold"], "notes": ["UUID-n1"]},
       {"text": "timetable", "link": "https://www.eskvoldline.com/"}]},
    {"id": "UUID", "sort": "a2", "type": "listItem", "style": "check", "indent": 0, "checked": true,
     "content": [{"text": "Book the ferry"}]},
    {"id": "UUID", "sort": "a3", "type": "paragraph",
     "content": [{"type": "image", "file": "UUID.heic", "width": 1600, "height": 1067}]},
    {"id": "UUID", "sort": "a4", "type": "paragraph",
     "content": [{"type": "site", "siteId": "UUID",
                  "snapshot": {"name": "Zelova", "category": "sights", "summary": "…",
                               "photo": "UUID.heic", "sourcePhoto": "zelova.heic",
                               "isFavorite": false, "takenAt": "…"}}]},
    {"id": "UUID", "sort": "a5", "type": "paragraph", "removed": true, "content": []}
  ],
  "notes": [
    {"id": "UUID-n1", "author": "UUID", "createdAt": "…", "editedAt": "…",
     "body": [{"type": "paragraph", "content": [
       {"text": "Is this the "}, {"text": "early", "notes": ["UUID-n1a"]}, {"text": " one?"}]}]},
    {"id": "UUID-n1a", "parent": "UUID-n1", "author": "UUID", "createdAt": "…",
     "body": [{"type": "paragraph", "content": [{"text": "Yes, 7:30."}]}]}
  ]
}
```

- Block `type`: `paragraph`, `heading` (`level` 1 Title, 2 Heading, 3 Subheading), `listItem`
  (`style` bullet | number | check, `indent` 0…5, `checked` for check items).
- Inline items: text runs (no `type` key; `marks` from bold, italic, underline, strike, code;
  `link`; `notes`, the ids of the highlight notes covering it), `image` and `site`. Images and
  site cards may carry `notes` too.
- Runs are normalised on save: adjacent runs with the same marks, link and notes merge; empty runs
  go; `marks` sorted and unique.
- A block's text never contains a newline (U+2028 inside a paragraph is allowed).
- Document blocks carry `id` (uppercase UUID string, the app's convention) and `sort` (a fractional
  index, base 62); order is by `sort`, then `id`. Note bodies are plain ordered block lists
  without `sort`.
- Notes are one flat list. `parent` absent means the note's words are in the document; otherwise
  they are in that note's body. Whether a note is "on" some words is decided by which runs list its
  id, never by a stored offset, so its anchor moves with every edit.
- `removed: true` is a soft delete on blocks and notes: kept on disk and on the wire, never shown.
- Authors are spotter ids from the outing's roster; names come from
  `Spotter.name(for:in:fallback:)`.

### Versions and unknown content

- `formatVersion` is the version that wrote the file; `minReaderVersion` is the oldest reader that
  may edit it. Blocks and notes may carry their own `minReaderVersion` (absent means 1), because
  sharing moves them one at a time.
- A new feature that older readers can safely carry (a new block type, inline type or mark) keeps
  `minReaderVersion`. An older reader shows it as a placeholder ("Needs a newer version of
  Fieldmark"), and keeps it verbatim through any edit: unknown blocks, inline items, marks and keys on
  every object are held as JSON values and written back unchanged (proved in probe p08).
- A change that alters what existing fields mean raises `minReaderVersion`. A reader below it opens
  the whole document read-only, never saves, and its sharing engine still stores incoming rows
  verbatim.
- Older formats are migrated on load by a chain of pure `vN -> vN+1` functions, and saved in the
  current format on the next save. Deprecating a feature is a migration that rewrites it into
  something supported.

### Limits

At most 16 KiB of text in one block (a longer paste splits into more paragraphs) and 32 KiB in one
note body, so no wire body approaches the server's 64 KiB. Images follow the app's photo settings.
Site-card photo copies are 512 px on the long side.

## Editor (FieldmarkUI, AppKit), from the research

- **TextKit 1**, built as an explicit stack: `NSTextStorage` → `FieldNotesLayoutManager`
  (`NSLayoutManager` subclass) → `NSTextContainer` → `FieldNotesTextView` (`NSTextView` subclass).
  Never `NSTextView(frame:)` or `scrollableTextView()` (both TextKit 2).
- **The storage holds meaning; looks are derived.** Semantic attributes: `.tnBlockID` (the block's
  UUID string on every character of its paragraph, newline included), `.tnBlock` (encoded block
  style: `p`, `h1`–`h3`, `bullet:n`, `number:n`, `check:n:0|1`), `.tnMarks` (bit mask),
  `.tnExtraMarks` (marks from a newer version), `.link`, `.tnNotes` (note ids). A styler derives
  font, paragraph style, colours, underline and strike after every edit (in `didChangeText`,
  writing only attributes that differ), so nothing a native font path does can make the screen
  disagree with the file.
- **Lists and checklists are drawn** by the layout manager in the indent column (bullets `•`, `◦`,
  `▪︎` and numbers `1.`, `a.`, `i.` by level; Notes-style checkboxes). No `NSTextList` and no marker
  characters in the text. Checked dimming comes from `shouldUseTemporaryAttributes` at draw time.
- **Attachments** are `NSTextAttachment` subclasses drawn by `NSTextAttachmentCell` subclasses: a
  width-fitted image decoded lazily with ImageIO at the displayed size, a site card, and a
  placeholder for content from a newer version. Clicks through `textView(_:clickedOn:in:at:)` and
  `doubleClickedOn`.
- **Highlights** are drawn as rounded tinted rectangles in `drawBackground(forGlyphRange:at:)`,
  darker where notes overlap, trimmed at paragraph breaks. Hit-testing uses
  `characterIndexForInsertion(at:)`. Typing extends a highlight or link only strictly inside it;
  pasted content inside a highlight joins it; copied highlighted text pastes with new note ids and
  copied bodies; cut and paste keeps the ids.
- **Block identity through edits.** A paragraph's block id is the id on its first character. When
  a split leaves two paragraphs with one id, the first keeps it, except that an empty first half
  (Return at the start of a paragraph) hands it to the second. Paste mints new ids. Ids are
  normalised when the editor takes its snapshot, and written back as attribute-only changes inside
  the same undo group as the edit that caused them.
- **Clipboard.** Copy writes our fragment type `org.example.fieldmark.field-notes-fragment` (JSON, with
  image bytes), RTFD, RTF and plain text (`•`, `1.`, `☑` markers). Paste prefers our fragment, then
  the richest foreign rich text (RTFD, web archive, RTF, HTML), then an image or image file URL,
  then plain text, and keeps only what the schema holds (the research's sanitiser, with its heading
  heuristic from relative font size, and `NSTextList.isOrdered` for list kinds).
- **Undo.** The window's undo manager for the document; every command registers one named step.
  Each note editor has its own undo manager. A remote change that rewrites characters in the
  document clears its undo stack (a range-based undo step would otherwise land in the wrong site);
  one that only adds or removes note ids does not.
- **Popover.** `NSPopover` (`.transient`), sized through `preferredContentSize`, holding a SwiftUI
  list of note cards whose bodies are the same editor configured for notes (no images or sites).
  Each note body writes back on every change (debounced 0.3 s), never only on close. A click on
  highlighted words inside a note opens a child popover beside it. If real clicks show the parent
  closing when the child is used (the research could only prove this programmatically), fall back to
  one popover that pushes the nested notes with a Back button, and say so.
- **SwiftUI hosting.** `NSViewRepresentable` returning an `NSScrollView`. `updateNSView` does nothing
  unless the model's external-change `revision` moved; then it applies the model's patch (only the
  blocks that changed), keeping the caret by block id and offset. The editor never reloads itself
  from its own write-backs (the naive version typed backwards and wiped undo in probe p07).
- **Commands.** `CommandMenu("Format")` buttons reach the editor through the app coordinator's
  active notes editor (the Field Notes text view that is first responder, a note's or the
  document's; Insert Site and Insert Photo are disabled inside a note) (the pattern the app already uses for menu items), which calls the text
  view's own actions and publishes the selection's state for checkmarks and enabling. The format
  bar calls the same actions directly and returns first responder to the text. No inspector bar,
  ruler, Font panel (`usesFontPanel = false`), list panel or NSFontManager bold.
- **Swift 6.** The controller is `@MainActor`; its `NSTextStorageDelegate` method is `nonisolated`;
  drawing code never reaches into the text view (state is pushed onto the layout manager).

## Model and persistence (FieldmarkPresentation)

- `FieldNotesStore` (Core) loads and saves `field-notes.json`, imports images (sniff, the library's
  `ImageEncoding`, UUID names), writes site-photo copies, removes image files nothing references,
  and reports every save to the `SurveyChangeObserver` (new requirement `fieldNotesSaved`).
- `FieldNotesModel` (`@MainActor @Observable`), created with the detail screen and kept across view
  switches, owns the document the editor shows, its external-change `revision`, the read-only
  reason, the detached notes, and the per-outing caret and scroll position.
- **Saving.** The editor reports each change; the model takes a snapshot after 0.75 s without typing
  (and at least every 3 s while typing), and also at once when the view disappears, the outing
  switches, the app resigns active or quits, before the sharing engine applies a page, and before an
  export. Each save is, with no suspension in between: load the file → merge the editor's changes
  into it three ways (base = what the editor last had) → assign sort keys → save → tell the observer.
  So a stale whole document is never written (the fault that makes the kit list lose items
  today).
- **Changes from elsewhere** (sharing, the control API, a site deletion): the model reloads,
  computes which blocks and notes changed, bumps `revision`, and the editor applies that patch.
- A pending save is cancelled when the outing is deleted, so a late save never recreates its folder.

## Merging (FieldmarkCore, pure, the heart of "rock solid")

One module merges three versions of a block or a note: base (the last version both sides agreed
on), local and remote. It is used by the local save (editor against file) and by sharing (this Mac
against another).

- Fields are merged separately. A field changed on one side only takes that side. Changed the same
  way on both, nothing to decide. Changed differently on both:
  - paragraph type, level, list style and indent, `checked`, `link`: the later `editedAt` wins
    (ties go to the lexically smaller spotter id, so every Mac decides the same);
  - `sort`: the remote value;
  - `removed` against an edit: the edit wins and the block comes back.
- Content is merged per character. Text and objects (images, cards) are compared by a diff of
  base→local and base→remote. Edits that neither overlap nor touch in the base are both applied.
  On characters both kept, marks and note ids are merged as sets (each side's additions and
  removals applied) and the link as a field. Inserted characters keep their own side's attributes.
- If the two sides edited overlapping or touching text, both versions are kept: for a document
  block, the remote version becomes a new block right after the local one; for a note body, the
  remote text is appended to the note after an empty paragraph. Nothing is dropped.
- Property tests pin the algebra: merge(B, L, B) = L, merge(B, B, R) = R, merge(B, X, X) = X, the
  result never loses a note id that either side added, and a merge is the same on both Macs.

Sort keys use a fractional index. New blocks get keys between their neighbours; blocks that moved
get new keys; existing keys are kept wherever they are still in order (the longest increasing run),
so a save rewrites as few blocks as possible.

## Sharing (FieldmarkPresentation, FieldmarkServices, server)

- Two new entity kinds: `noteBlock` (one row per document block) and `highlightNote` (one row per
  note). The body is the record's own JSON.
- **Compare-and-swap for notes rows.** A push row may carry `baseRevision` (the revision this Mac
  last saw, 0 for a new row). The server writes it only if the row is still at that revision
  (`ON CONFLICT … DO UPDATE … WHERE entities.revision = ?`), and lists the rest in a new
  `conflicts` map of the reply instead of failing the push. Rows without `baseRevision` (every
  existing kind) stay last-writer-wins.
- **Base tracking.** `field-notes-sync.json` keeps, per notes row, the last revision and body this
  Mac saw from the server (the merge base). It is updated when a pull applies a row and when a push
  is acknowledged.
- **Applying.** A pulled notes row with no unsent local change for it is applied as it is. One with
  an unsent local change is merged three ways (base, local, remote); the result is written locally
  and re-queued with the pulled revision as its new base. A conflict reply leaves the row queued
  and pulls at once, which brings the row to merge. So the old rule "the unsent local write wins
  and the incoming one is dropped for good" no longer applies to notes rows.
- **Capability guard.** The server lists the entity kinds it accepts in every pull reply. Until it
  lists the notes kinds, notes rows stay in the outbox, neither sent nor dropped, and nothing else
  about the share changes. The share status is not shown as failing or behind because of them.
- **Catch-up.** A build that learns the notes kinds for the first time re-reads the share from
  seq 0 once, so notes written before it upgraded arrive (older builds skipped them and moved past).
- **Files.** Notes images visit through the existing asset routes as
  `sites/<FieldNotesFiles.ownerID>/images/<file>`, a fixed UUID the server treats like a site.
  The client's folder lookup, upload queueing, listing and reconcile learn that owner.
- **Server change** (functions/api/shares): the two kinds in `ENTITY_KINDS`, `kinds` in pull
  replies, the compare-and-swap and `conflicts`, with cases in `Scripts/test-sharing-server.sh`. No
  migration: `revision` already exists. `FakeShareServer` (both copies) gains the same behaviour.

## Site cards (live and remembered)

- Inserting a card snapshots the site: name, category, summary, favourite flag and a 512 px copy
  of its first photo into `field-notes/images/`.
- Whenever the notes load or the outing's sites change, a card whose snapshot differs from its live
  site refreshes it, in one save and only when something changed. The photo copy is redone only
  when the first photo's file name changed.
- `SurveyDetailModel.deleteSites` refreshes the snapshots of the doomed sites just before it
  deletes them.
- Cards are never removed when their site is deleted (unlike route stops).

## The `.fieldmark` bundle

Format 3 adds `fieldNotes`: the document, its images as `BundledFile`s, and every card's site as a
`siteIndex` (via `exportBundle`'s `indexByID`). Import maps indexes back to the new site ids
(`adopt`'s `idByIndex`), imports images through the notes store and rewrites their names, and keeps
block, note and spotter ids verbatim. A card whose site was deleted keeps only its snapshot.
Older builds ignore the key.

## Control API and scripted checks

- `/state.fieldNotes`: `blockCount`, `noteCount`, `detachedCount`, `imageCount`, `siteCardCount`,
  `formatVersion`, `readOnly`, `pendingShare` (rows waiting for the server) and `text` (the first
  2,000 characters of plain text).
- Commands (each acts on the model, so the open editor updates through the same patch path a synced
  change uses): `notes-append` (text, style, list), `notes-add-note` (the first occurrence of some
  words, note text), `notes-reply`, `notes-delete-note`, `notes-embed-site` (by name),
  `notes-add-image` (a file path), `notes-check` (an item's text, checked). All listed in
  `ControlCommandNames`.
- `Scripts/e2e.sh` gains `check_field_notes` (append, embed a site, delete the site and see the
  card keep its name, add an image and see the file, restart and see it all again), and
  `check_survey_bundle` covers notes.
- `Scripts/test-sharing.sh` gains a notes step between two app instances on local `pages dev`.

## Help and README

`HelpGuide.md` (the help assistant's whole prompt) gets a Field Notes section, "six views", sharing
mentions notes, and "Things the app does not do" stops saying there is no undo. The README's
features list, on-disk layout and bundle sketch are updated (they have also drifted: the
spotters file, `assets.json`, `insight` and `spotterID`).

## Testing

- **Core:** golden JSON files; unknown content kept through load and save; version gating and the
  migration chain; fractional index properties; the merge table and its property tests
  (thousands of generated cases); store behaviour (missing, unreadable, newer file never written).
- **UI:** converter round outings (golden and generated documents); scripted editing with a run-loop
  turn between actions (lists, checklists, highlights at edges, paste, copy and cut, undo);
  sanitiser fixtures; popover lifecycle; card drawing live and removed; a load-time guard on the
  30-page document.
- **Presentation:** the save pipeline against a fake editor, patches, snapshot refresh, deletion,
  cancelled saves.
- **Sharing:** engine tests on the fake server (kinds, compare-and-swap, merges, guard, catch-up);
  two-Mac integration tests (two answers at once, same paragraph at once, edit against delete,
  reorder and insert in the middle, an image visiting); server cases over `pages dev`.
- **Live:** the real app driven with real keys and clicks (System Events keystrokes, the CGEvent
  helper), screenshots of every feature in dark and light.
- **Snapshots:** populated, empty, read-only, a checklist, site cards live and removed.

## Deployment

Robin deploys the server (`./deploy-cloudflare.sh` needs `wrangler login` on his Mac); this work
never deploys. Until he does, Field Notes work fully on each Mac and simply do not visit.

## Pre-existing bugs found on the way (fixed in their own commits)

- The kit sheet saves a stale copy of the list, which deletes items and undoes ticks made on
  another Mac.
- Reordering route stops or kit items never syncs, and an item inserted mid-list arrives
  last elsewhere (the notes' fractional index can carry their order too).

## Assumptions (Robin was not asked)

- A view titled "Field Notes", Notes-style shortcuts and an in-view format bar are "Mac native".
- Detached notes are kept rather than deleted with their words: nothing typed is lost.
- Same-paragraph conflicts keep both versions rather than attempting a word-level interleave.
- Notes stay text-only (no images or site cards inside a note).
- Sharing notes waits for Robin's server deploy; everything else ships now.
