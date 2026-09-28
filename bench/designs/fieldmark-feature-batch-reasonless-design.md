# Feature batch, 2026-09-27: design

Twelve changes Robin asked for in one message. This document is the design every implementer and
reviewer works from. Research behind it (with file and symbol anchors) is in
`~/Dev/temp-fieldmark-mega-batch/grounding/`; that folder is optional, and this document stands
without it.

Robin's words, verbatim, open each section. Decisions were made from the code and the research,
not by asking him (his standing rule); each says why, and what it rules out.

## Contents

1. [Removed Items (the recycle bin)](#1-removed-items-the-recycle-bin)
2. [One AI marker](#2-one-ai-marker)
3. [Show duplicate sites](#3-show-duplicate-sites)
4. [Clickable links in the site editor](#4-clickable-links-in-the-site-editor)
5. [Borders around groups of fields](#5-borders-around-groups-of-fields)
6. [Favorites in gold](#6-favorites-in-gold)
7. [Telling the views apart](#7-telling-the-views-apart)
8. [Nothing moves when a sync runs](#8-nothing-moves-when-a-sync-runs)
9. [Checklist circles that stay put](#9-checklist-circles-that-stay-put)
10. [Find looks inside highlight notes](#10-find-looks-inside-highlight-notes)
11. [Tables in Field Notes](#11-tables-in-field-notes)
12. [Votes](#12-votes)
13. [Rules for every group](#13-rules-for-every-group)
14. [Work groups and order](#14-work-groups-and-order)

---

## 1. Removed Items (the recycle bin)

> Have a recycle bin of deleted sites and deleted surveys. The recycle bin for sites is shared
> when sharing surveys (that way, other people can restore from the recycle bin if they think
> something ought to stay in the survey).

### Decisions

- **Name: "Removed Items".** Items stay **30 days**, then go for good, as there.
- **One site to look.** A "Removed Items" row sits at the bottom of the sidebar whenever
  anything is in it, as Notes shows its Removed Items folder. Selecting it shows deleted
  surveys and, grouped under each survey's name, that survey's deleted sites, including
  sites someone else deleted from a shared survey.
- **A deleted site stays in its survey, marked as deleted.** Deleting writes a trash record
  into the site (`trash: {deletedAt, deletedBy, stops}`) and saves it.
- **Deleting for good is today's delete.** "Delete Now", "Empty" and the 30-day expiry use the
  existing hard delete: the folder goes, a tombstone is sent, the files are removed from the
  server.
- **A deleted survey moves to a bin folder** (`<support>/Removed Items/`), outside
  `Surveys/`. The library takes the bin's location as an argument, so tests never write
  outside their temporary folder; `nil` keeps today's delete-for-good.
- **A shared survey keeps its share while it is in the bin.** Its sync stops (as today), but
  the share is ended (owner) or left (member) only when it is deleted for good, and that request
  is retried until the server answers.
- **Put Back restores a site's route stops** (remembered in the trash record), so a site
  deleted by mistake comes back on the days it was on.
- **Deleting still asks**, with new words. It is recoverable now, but on a shared survey it
  reaches everyone, and the confirmation is where people learn where it went.

### Behaviour

- Deleting a site (menu, Delete key, the map card's trash, the control API) asks:
  - Title: `Delete “Zelova”?` / `Delete 3 sites?`
  - Message: `It moves to Removed Items in the sidebar. You can put it back within 30 days.`
    On a shared survey, add: `Everyone sharing this survey can put it back too.`
  - Button: `Delete`.
- The site disappears from every view on every Mac. Field Notes site cards and vote cards for it
  show the snapshot ("Removed from the outing"), exactly as for a site deleted today; putting it
  back makes them live again (same id).
- Deleting a survey asks: `Delete “Norway 2.0”?` / `It moves to Removed Items in the sidebar.
  You can put it back within 30 days.` plus, when shared, for the owner: `Sharing continues for
  the others until it is deleted for good.` and for a member: `You leave the shared survey when
  it is deleted for good.`
- **The Removed Items page** (sidebar row selected):
  - A line at the top: `Items are deleted for good 30 days after they were deleted.`
  - "Surveys": one row each with the name, when it was deleted, how many days are left, and
    how many sites and photos it holds; buttons **Put Back** and **Delete Now**.
  - One section per survey that has deleted sites, titled with the survey's name: one row
    per site with its photo, name, category, `Deleted by Anna · 2 days ago · 28 days left`
    (the "by" part only when the survey has more than one person), **Put Back** and
    **Delete Now**.
  - **Empty Removed Items…** at the top right.
  - The same actions in each row's right-click menu.
- Put Back on a site leaves you on the page; the site reappears in its survey, and on the
  others' Macs at their next sync.
- Put Back on a survey moves the folder back under its old folder name, or a fresh one if the
  old one was taken, and selects it.
- Delete Now and Empty ask: `Delete “Zelova” now?` / `This can't be undone.` plus, for a site
  in a shared survey, `Everyone sharing this survey loses it too.`
- **Expiry.** A site is deleted for good once its `deletedAt` is more than 30 days old, by the
  first Mac that opens its survey after that (only then is that survey's sync running, which
  the file removal on the server needs). A survey is deleted for good at launch or when the page
  is shown, once 30 days have passed.

### Data and sync

- `SiteOfInterest.trash: SiteTrash?`, where `SiteTrash` holds `deletedAt: Date`,
  `deletedBy: UUID?` (the spotter) and `stops: [RouteStop]` (the stops removed with it).
  Absent on a live site.
- `SharedSite` carries `trash` in three states: the key **absent** (a body from an older build:
  keep whatever this Mac has), explicit **`null`** (live), or an **object** (deleted). The encoder
  must write `"trash": null` explicitly for a live site. So an edit from an older build cannot
  quietly bring a deleted site back, and an edit from a new build that had not seen the delete
  can: that is last-writer-wins, and "someone edited it, so it ought to stay" is the right
  reading. Known limit: an older build shows a deleted site as live, and its own Delete is a
  delete for good. The in-app updater keeps older builds short-lived.
- **`SiteStore.list()` keeps returning deleted sites.** The sync engine depends on it (page
  state, known files, folder lookup); hiding them there leaves folders and server files behind
  when a delete for good arrives. `SurveyDetailModel` splits what it reads into `sites` (live)
  and `removedItemsSites`; everything drawn from `sites` (map, lists, gallery, categories,
  Field Notes cards, Visit Info, duplicates, votes, `/state`) then follows. Other direct readers:
  the AI outing run's "already on the outing" and the `.fieldmark` export read live sites only; photo
  compaction includes deleted ones.
- **Delete for good from the page, while that survey is not open.** Today a site deleted in a
  shared survey that is not open reaches a fresh sync engine that learns the site's files from
  a disk they have already left, so it never removes them from the server. The delete for good
  must tell the engine the files before the folder goes (a "will delete" notice, or the file list
  carried with the notice). A test proves the removals are queued.
- **Put Back and the server's files.** Put Back flags the site for a server listing (the
  existing reconcile path), so a file the server lost in a race with someone's delete for good is
  sent again.
- **Race, accepted:** if someone deletes a site for good while someone else puts it back, the
  later write wins; the flag above repairs missing files if the site survives.
- `FileSystem` gains `moveItem(at:to:)` with a protocol-extension default (copy, then remove), so
  the test doubles compile untouched; `DiskFileSystem` uses `FileManager.moveItem`; the sealed
  file system refuses it once sealed.
- A survey in the bin keeps a small record of when it was deleted (a rename does not change a
  folder's dates).
- The control API: `delete-site` + `confirm-delete` now move to the bin. New:
  `show-removed-items`, `restore-site`, `purge-site`, `restore-survey`, `purge-survey`,
  `empty-removed-items`, and a `removedItems` block in `/state`. `Scripts/e2e.sh`:
  `check_site_deletion` and `check_survey_rename_and_delete` change to the new behaviour, and a
  new check covers put back and delete for good (it runs last among the destructive checks).

### Proof

- Core: the trash record round-outings; the three-state `SharedSite` merge; expiry arithmetic.
- Engine: a delete reaches another Mac as an edit and lands in its bin with its files; put back on
  that Mac reaches the first; delete for good sends the tombstone and the file removals; delete for
  good from a survey that is not open still removes its files; put back flags a listing.
- Library: move to the bin, put back under a fresh folder name when the old one is taken, delete
  for good, expiry, and a shared survey's end/leave sent at delete for good and retried after a
  failure (not at the delete).
- Two-Mac integration test: A deletes, B sees it in Removed Items, B puts it back, A sees it
  live with its photos and stops.
- Live: screenshots of the confirmation, the sidebar row, the page with both sections, and a
  site back in its list.

### Help

Rewrite "Sites have no undo…" in "Things the app does not do", the offline-delete paragraph under
"Sharing a survey" (and the test that pins it), and add a "## Removed Items" section.

---

## 2. One AI marker

> Add a subtle AI indicator next to AI features (e.g., plan a survey). Find something uniform
> that can be applied broadly.

### Decisions

- **The marker is the word "AI" in a small capsule**, in secondary text with a hairline outline,
  placed right after the control's title. In menus it is the menu item's native trailing badge
  (SwiftUI `.badge("AI")`).
- **Defined once.** One view and one modifier; every control whose action goes through
  `requiringAPIKey` (every `APIKeyReason`) wears it. A test makes a new AI control without the
  marker fail (for example, a source scan: every file that calls `requiringAPIKey` also applies
  the marker, or an explicit list of marked controls checked against `APIKeyReason.allCases`).
- **Name the provider.** Every marked control's tooltip ends with `Uses the AI.` (the
  provider's name comes from settings, not a literal). Each AI sheet (Plan a Survey, Import
  Sites, Help, Describe what you're after) gets one quiet line by its confirm button: the marker
  and `What you type here is sent to Nimbus.`

### Where it goes

- Menu items: Plan a Survey…, Import Sites…, Annotate / Annotate N Sites (row menu), Describe
  what you're after….
- Buttons: the editor's Annotate; the confirm buttons' footnote in the four AI sheets.
- Toolbar: Annotate and Help. A toolbar item is sized by its glyph, so the capsule may only sit on
  the icon's corner if it draws without clipping and without changing the item's size (see §8);
  otherwise these two carry the tooltip only, and the plan says so with a screenshot.
- Output that only the model writes: the insight chips on the map card and discovered card, the
  Help answer, and "Your plan". Not summaries: nothing records whether a summary came from the
  model, Wikipedia or the person.

### Also

- Fix `HelpGuide.md`'s claim that Annotate works without an API key (every Annotate button asks for
  one; only automatic annotation runs without), in its own commit.
- Help: one paragraph on the marker ("Anything marked AI sends what it needs to Nimbus …").

### Proof

The marker looks good in menus and the toolbar, and feels consistent everywhere.

---

## 3. Show duplicate sites

> Have option to show duplicate sites (by similar names, similar coordinates, similar photos).

### Decisions

- **A "Duplicates" switch in the List view**, at the right of the filter box, and a matching
  **View ▸ Show Duplicates** menu item. While it is on, the List shows only sites that have a
  likely duplicate, one headed section per group, and the header says why. Everything the List
  already does keeps working on them: selection, the right-click menu, Delete (which now goes to
  Removed Items), Move, Favorites. It turns off when the view changes, as the filter text is
  cleared today.
- **Merge is not part of this.**
- **Similar photos means the same picture**, resized or re-compressed: a 64-bit difference hash
  (dHash, from a 9×8 grey thumbnail) per photo, compared by Hamming distance. The arithmetic lives in Core; the
  decode (ImageIO thumbnail, off the main thread) in an adapter, as `PhotoLikeness` and
  `ImageContentScreen` are split today. Hashes are cached by file and modification date.
- **Similar names** use `TextFolding` (it already folds ø, æ, ð), with digits and punctuation
  ignored, and only **distinctive** shared words counting (not "museum", "church", "fjord",
  "reserve"...).
- **Rules**, each producing a pair with a reason; pairs join into groups:
  - the same folded name, within about 1 km, or when either has no coordinate;
  - a shared distinctive word within about 150 m (the import's existing "same site" distance);
  - coordinates alone only when very close (about 20 m);
  - the same website (`SiteLinks.sameSite`) within about 1 km, ignoring sites many sites share
    (Wikipedia, map and booking sites);
  - the same photo.
  The implementer calibrates the numbers against the fixtures below and records them.
- Only live sites are compared (not Removed Items).

### Behaviour

- Section headers name the sites' shared reason plainly: `Same name`, `Similar names · 40 m
  apart`, `Same photo`, `Same website`, `12 m apart`.
- Empty state: `No likely duplicates.`
- While photos are still being compared, the groups found so far show, with a quiet
  `Comparing photos…` line.
- Control API: `set-duplicates {"on": true}` and a `duplicates` block (groups, reasons) in
  `/state`.

### Fixtures

- Must pair: "Heddrin BrewPub" / "Heddrin Bryggeri"; "2 Obbark" / "29/2 Obbark" (from Robin's library);
  two sites sharing one photo; two sites 10 m apart.
- Must not pair (the seeded "Norway 2.0"): Kon-Tiki Museum / Fram Museum (83 m); Borgund, Urnes,
  Tollmark Stave Church; Kelder Kai / Zelova; Zelova / Braveby Fortress (480 m); Obborn Opera
  House / Munch Museum (160 m).

---

## 4. Clickable links in the site editor

> Make links clickable in detail dialog for sites.

### Decisions

- "The detail dialog" is the site editor sheet: there is no other site dialog, and its Links
  section is plain text fields with nothing to click. The map card's links already work.
- **Each link row gets an open button** (`arrow.up.right.square`, tooltip `Open <title> in your
  browser`), which opens the link **in the default browser**. The fields stay editable: making the
  text itself the click target would fight editing it. Rejected: the in-app browser from inside the
  editor. A sheet presented from outside the editor shows nothing, and one presented from inside it
  would drop a photo picked there when the editor saves.
- The button is disabled when the URL has no web address (the `https://` a new link starts with);
  a URL typed without a scheme opens, and saves, with `https://` in front.
- **Fix the URL field** (a pre-existing bug, own commit): today it silently reverts any text that
  does not parse as a URL while you type. It keeps what is typed and parses it when the field is
  left or the editor saves.
- Help: the editor paragraph says links open from there too.

---

## 5. Borders around groups of fields

> Fix weird/thin partial border around some groups of fields. I can't tell if it is intentional.

### Decisions

- **What it is:** measured on Robin's own editor screenshot, every grouped section card has a 1 px
  line on its right and bottom edges only (and near the corners). It is how his Mac draws a
  SwiftUI `Form` with `.formStyle(.grouped)`; the app draws none of it. The VM (macOS 26.4) draws
  no line at all, so it cannot be seen here.
- **Fix by construction:** the site editor, Settings and Add Person stop using the grouped form's
  section chrome. One app-drawn card style (the fill used today, a hairline on all four sides, the
  same corner radius, rows and dividers as today) draws every group.
- Keep the layout as it is: two columns in the editor, the same widths, labels and spacing.

### Proof

Screenshots before and after (light and dark), and pixel samples showing the new line on all four
edges of each card. The report says plainly that the old line could not be reproduced here.

---

## 6. Favorites in gold

> Give favorited sites a gold shadow and star (or whatever design makes sense) in the list and
> photo views. And when they appear in the notes.

### Decisions

- **One gold**, the one the map's favorite badge uses (`PinStyle.favoriteBadgeFill`). The rule
  "gold means favorite and nothing else" and its test stay.
- **List and Categories cards:** a soft gold glow **outside** the card's edge, and the map pin's
  gold star badge on the photo's top-trailing corner; the small star after the name stays.
  Selection stays inside the edge (ring and tint), so the two never fight, even with the Yellow or
  Orange accent colour. The glow must not tint the card's translucent inside.
- **Gallery tiles:** the same badge on the tile's top-trailing corner and the same outer glow, on
  every photo of a favorite site. The gallery's item gains `isFavorite`.
- **Field Notes site cards:** a gold edge instead of the grey one, a slightly larger star, and a
  faint gold glow drawn inside the card's own frame (text views redraw only what changed, so
  anything outside it would be wiped). The accent edge still wins when the card is selected, and
  the gold stays distinct from the yellow ring a highlight note draws.
- A dimmed card (People filter) dims its glow too. A removed site's card stays grey.
- The shared pieces (badge view, glow modifier, constants) are what votes' site cards use (§12).

### Proof

Screenshots of each surface: light and dark, selected and not, focused and not, and one with the
Yellow accent colour.

---

## 7. Telling the views apart

> Make it easier to tell the views apart, aside from just the icons. Maybe add text to them in
> "Icon and Text" model. Up to you to come up with something that is functional and tasteful.

### What is wrong today

The six views share one segmented control, so "Icon and Text" puts one word, "View", under all six.
There are no tooltips per segment, no menu item names them, no shortcut picks one, and two pairs
of icons mislead: List's bulleted-list icon draws cards (as Categories does, with headings), and
Route's calendar and Field Notes' note have the same outline.

### Decisions

- **Each view gets its own button, and so its own word.** The segmented control becomes a group
  of toggle buttons, one per view (`ToolbarItemGroup` at the principal placement). With labels on,
  each icon has its own word under it; with labels off, it looks like today's single capsule
  (checked on macOS 26 by a probe). Votes (§12) adds a seventh automatically.
- **View menu**: one item per view, in order, with **⌘1…⌘7** (Finder's View ▸ as Icons ⌘1
  convention), and a separator before Show Toolbar Labels.
- **Tooltips** per view: `Map (⌘2)`.
- **Distinct icons**: no two views share an outline; List and Categories get icons that suggest
  cards and cards grouped under headings; none repeats a category glyph or another toolbar icon.
  The implementer proposes them with a screenshot.
- **Width**: the word row costs about 125 pt in Icon and Text mode. With labels on and the sidebar
  shown, nothing may overflow into » at 1400 pt; the report includes pictures at 1200, 1400 and
  1600 pt.
- Update the tests that pin the picker and the Help guide's "six small icons" wording.

---

## 8. Nothing moves when a sync runs

> Avoid the minor UI element movement when a sync occurs. Seems like the icons shift a bit.

### What happens today

The toolbar's Sharing item swaps its icon between `person.2.fill` (22 pt wide) and
`arrow.triangle.2.circlepath` (16 pt) for every 10-second vote, even when nothing changed. It sits
in the toolbar's centre beside the view switcher, so where the item is sized by its content (the
older flat toolbar Robin's Mac shows), a 6 pt change re-centres the group and nudges its neighbours
3 pt every ten seconds. The VM's toolbar keeps a fixed cell, so the shift cannot be seen here.

### Decisions

- **The icon keeps one size whatever the state**: its box is as big as the largest of the five
  status symbols, derived from the symbols (hidden copies stacked under the visible one), not a
  hard-coded number.
- **A quiet vote does not change the icon.** The syncing icon shows only while something really
  moves: rows being sent, a page being applied, files moving, or a round that has taken longer than
  about a second. The tooltip follows the same rule.
- **The same fix for the other icon-to-spinner swaps** (Discover, the editor's Annotate, Import):
  keep the replaced content's box.

### Proof

Syncing feels smooth, the toolbar stays responsive, and nothing jumps around in a way people would notice.

---

## 9. Checklist circles that stay put

> Nested checkboxes do weird things in notes sometimes. As soon as you start typing, seems like
> vertical alignment changes. I only saw this once; I haven't been able to reproduce it.

### Cause (reproduced off-screen with the real editor)

An empty list item that is not the last line draws its circle 6 pt too low, and the first letter
snaps it up: the layout manager takes the line's baseline from the paragraph break's glyph, which
TextKit 1 puts at the bottom of an empty line. The empty last line is drawn by a separate formula
and is right, which is why it happens only "sometimes" (Return in the middle of a list, then Tab).
It affects bullets and numbers too.

Deterministic steps: ⇧⌘L, type `Alpha`, Return, `Beta`; click after `Alpha`, Return, Tab: the
circle sits low; type a letter: it jumps up.

### Decisions

- An empty paragraph's marker baseline comes from the font's default baseline offset
  (`defaultBaselineOffset(for:)`), in both the mid-text and the trailing case.
- A paragraph break is styled as plain text (no marks): an empty line is then always the height a
  typed line will be (today an empty line whose break carries Monospaced is 2 pt short, so typing
  pushes everything below it down), and the grey code band stops at the words.
- In an empty document with a list style, the first marker is drawn before anything is typed.
- A mark toggled for the next typing (for example Monospaced) survives Tab and other block changes
  (a nit met on the way, own commit).

### Proof

Red-first drawing tests: an empty middle item's circle sits where a typed one does; a Monospaced
break styles as body text; an empty item with such a break is as tall as a typed one. Then a live
check with real keys and a before/after screenshot.

---

## 10. Find looks inside highlight notes

> Improve the notes search so that it can also find search results in highlights.

### Decisions

- **Keep the standard Mac find bar** (⌘F, ⌘G, the Edit ▸ Find menu), and make it see the notes.
  The document's text view gets its own `NSTextFinder` whose client presents one virtual string:
  the document, with each highlight note's text inserted after the paragraph its words are in
  (replies oldest first, notes on a note right after it), and a search boundary between pieces so
  no match spans two. The mapping between the virtual string and the document and notes is pure
  logic in Core, tested and mutation-tested there.
- **A hit inside a note:** scroll the note's words into view, open that spot's note popover (or
  the chain, for a note on a note) **without taking the keyboard** from the find bar, select the
  match inside the note, and show the find indicator there. Moving on to a hit in the document
  closes it.
- **Replace** works in the document's own text only at first; a match inside a note is skipped by
  Replace All and not replaced by Replace (the finder is told it cannot be).
- The implementer starts with a spike on what the research could not settle: how the finder
  behaves when a match's view is in a popover window, whether a transient popover closes when the
  find bar takes a keystroke (then search-opened popovers stay open until the next hit), and what
  ⌘F does inside a note popover today.
- Help: "Find also looks inside highlight notes."

---

## 11. Tables in Field Notes

> Add support for tables (IIRC, there's an LLM task for this).

The task is `llm-tasks/field-notes-tables/field-notes-tables.md`: its intent, decisions (a table may
span the whole view while text keeps its 700 pt column) and "Done when" stand, and it is moved to
`llm-tasks/completed/` when this ships. The research checked its "current state" at HEAD and found
three things to correct:

- The paste rule for tables moved to `FieldNotesPasteDowngrades.tidy(_:)`.
- **Trap:** setting `currentVersion` to 2 without a 1→2 migration step makes every existing notes
  file fail to load. The identity step ships in the same commit as the version bump.
- Copying writes no HTML today, so "copy as an HTML table" is new work.

### Decisions the research supports (the implementer's plan settles the rest after a spike)

- **Layout:** The container
  becomes the full view width and everything that is not a table is held to the centred 700 pt
  column (a probe did this by clamping each line fragment by character index; another by
  paragraph indents). The spike compares that with a table drawn as a full-width attachment with a
  grid over it, on typing, selection, attachments, markers, find, spelling, undo and speed, and
  picks one with evidence.
- **Model:** a `table` block with columns and rows that have stable ids and fractional sort keys
  (`FractionalIndex`), an optional header row, and cells holding inline content (runs, marks,
  links, note ids). One table is one sharing row, capped under the 48 KiB editor budget with a
  clear message when a table would outgrow it; merging goes cell by cell (`mergeContent`), and rows
  or columns added on two Macs both survive.
- **Editor:** each cell is exactly one paragraph (Return in a cell types a line break, U+2028,
  which the model already allows). Cell membership is meaning in the text storage, and the styler
  derives the `NSTextTable` blocks from it (reusing one table object and one block per cell, so a
  restyle does not relayout). Every site that assumes one paragraph is one block learns about the
  table unit.
- **Editing:** Tab and ⇧Tab move between cells, Tab in the last cell adds a row; Format ▸ Table:
  Insert Table, Add Row Above/Below, Add Column Left/Right, Delete Row, Delete Column, Header Row;
  a format-bar button.
- **Versioning:** writers write `formatVersion` 2 with `minReaderVersion` 1, so an older build
  keeps a table verbatim (drawn as "Needs a newer version of Fieldmark") through an edit elsewhere.
- **Paste and copy:** a table from Safari or TextEdit arrives as a table; a copied table pastes
  into TextEdit as a table (RTF and HTML tables, and tab-separated text).
- Also: VoiceOver reads rows and columns; `notes-insert-table` and a table count in
  `/state.fieldNotes`; Help ("Field Notes have no tables" goes) and the README.

---

## 12. Votes

> Add votes so we can vote on things (such as which destinations we want to visit or not). Vote
> items can be text or sites. Can be edited by anyone at any time (they don't have dates attached
> to them or anything). Can answer yes/no. Each person can answer separately (results are shared
> freely). Example vote items: "Defenestration Building, San Francisco, CA" (this would be a
> site), "Visit our friends in the area?", "Do a bar crawl?". Up to you how you want to present
> the sites in the votes (maybe a short card or something), so long as they are still clickable
> like the normal site cards.

### Decisions

- **Votes are a seventh view, "Votes"**, after Field Notes, over their own versioned document
  (`votes.json`).
- **An outing has any number of votes.** A vote has a question ("Where should we go in SF?") and
  items. An item is one of:
  - **text** ("Do a bar crawl?");
  - **a site on the outing** (by id, with a snapshot so it outlives the site, as a Field Notes card
    does);
  - **a site not on the outing yet** (name, address, coordinate, category), found by a map search.
- **Every person answers every item Yes or No**, or not at all. An answer is its own record keyed
  by item and person (the spotter id, which on a shared outing is the member id). Changing your mind rewrites your own record;
  clearing it removes it. Everyone sees everyone's answers.
- A vote that cannot be saved shows the error "Couldn't write ~/Library/Application Support/Fieldmark/votes.json." and a "Submit" button to try again.
- **Anyone can edit anything**: add, reword, reorder or remove items; rename or delete votes.
  Removal is a soft `removed` flag (as notes blocks), so an edit racing a removal keeps the text.
  Deleting a vote that has answers asks first.
- **A yes does not add a site to the outing.** A candidate site's card offers **Add to Outing** to
  anyone (as a discovered site's card offers Save). Adding it links the item to the new site.
- **People.** On a one-person outing, only the Yes/No control shows (names would be noise, as
  "Added by" is hidden there). With more people, each item shows the tallies and who said what.
  People added with "Add person…" (no Mac of their own) can be answered for: the answer control has
  "Answer for ▸ <person>", as "Added by" can file a site under anyone.

### Presentation

- The view lists the votes, newest last, each as a group: the question (editable in site), its
  items, and an "Add item" field at the bottom; **New Vote** in the view's own toolbar items (as the
  Route adds its own).
- **Add item:** one text field. As you type it suggests sites on the outing (the Insert Site
  matcher) and then sites from a map search of the text (split at its first comma into the name
  and where it is, the recipe the outing planner's `search_map` uses; no AI). Picking an outing site
  makes a site item, picking a map result makes a candidate item, and Return makes a text item.
- **Site items are compact cards**: a small photo (or the category tile), the name with the
  favorite star and gold treatment (§6), the category, and one line of summary. A new
  `CompactSiteCard` view with three states: live (the site as it is now), removed (the snapshot,
  greyed, "Removed from the outing"), and candidate ("Not on the outing yet", **Add to Outing**). It
  replaces the Insert Site popover's private row, so there is one compact card, not two.
  **Clicks work as on other site cards:** one click selects the site (so Edit, Annotate, and
  switching to List or Map find it); a double-click opens the editor (a candidate: adds it, then
  opens the editor, as the map's discovered card does); right-click: Edit Site…, Show on Map,
  Remove from Vote (a removed site: Remove from Vote only; a candidate: Add to Outing, Remove from
  Vote).
- **Answers:** beside each item, Yes and No buttons for you (the one you picked is filled), then
  the tallies: `Yes 3 · No 1`, with the names under or on hover.
- Empty state: `No votes yet` with a **New Vote** button.

### Data and sync

- `votes.json` at the survey's top: `format "fieldmark.votes"`, `formatVersion 1`,
  `minReaderVersion 1`, votes, items, answers, and an `extra` bag of unknown keys kept verbatim
  (the Field Notes versioning pattern).
- **Three shared kinds:** `vote` (question, sort key, who and when), `voteItem` (vote id, sort key,
  text or site or candidate, who and when, `removed`) and `voteAnswer` (id
  `"<itemID>+<personID>"`, answer yes or no, when). Each answer row has one writer, so
  last-writer-wins never loses a vote.
- **The sync engine's guard learns every kind the server lists**, not just the two Field Notes
  kinds: a row of a kind the server has not listed waits in the outbox instead of jamming the
  survey's sync with `400 kind is unknown`; share creation never carries a new kind; and a Mac
  that upgrades re-reads once for kinds it skipped (a tolerant `readKinds` list replacing the
  notes-only flag). This generalisation lands before the vote kinds.
- **The server** (`functions/api/shares/_lib.js`) lists the three kinds; `test-sharing-server.sh`
  checks the new list. **Robin deploys** (`./deploy-cloudflare.sh`); until he does, votes work on
  each Mac and wait to sync, as Field Notes did, and nothing else is affected. Nobody in this batch
  deploys.
- A vote item's site snapshot needs no photo copy (the live site has photos; a removed one shows
  its category tile). Nothing may be parked in `field-notes/images/` (Field Notes sweeps it).
- `.fieldmark` export carries votes (bundle format 4), mapping site ids as Field Notes cards do and
  spotter ids verbatim.
- Control API: `new-vote`, `add-vote-item`, `answer-vote-item`, `remove-vote-item`, and a `votes`
  block in `/state`; an e2e check; a `test-sharing.sh` step.

### Help

A "## Votes" section; "the six views" becomes seven; "Sharing a survey" says votes visit (once
the server is updated).

---

## 13. Rules for every group

- **Test first** (red, then green), with tests that check what a person would notice. Layout is
  proven by layout tests or screenshots, never by ViewInspector alone.
- **Prove it live.** Each group drives the real app and keeps curated screenshots (light and dark
  where it matters) in `~/Dev/temp-fieldmark-mega-batch/shots/<group>/`.
- **Gates before a group hands back:** `./Scripts/test.sh` (full), `./Scripts/lint.sh` then
  `git diff` (swiftformat rewrites files), `./Scripts/build.sh`, `./Scripts/e2e.sh` where the group
  touched something the control API reaches, and a scoped mutation run
  (`./Scripts/mutate.sh --files …`) on new Core logic, with survivors triaged into
  `docs/mutation-survivors.json` (the `mutation-triage` skill), or "N/A" with the reason.
- **One heavy job at a time on this machine** (build, test, lint, e2e, live run): every agent
  wraps them in `~/Dev/temp-fieldmark-mega-batch/tools/heavy.sh`.
- **Commits:** small and as you go; `type(scope): summary` with at most three bullets; checked
  with the evaluator before each commit. A nit or bug met on the way is fixed in its own commit.
- **Copy:** plain words, the third party named, no internal paths, written for someone doing it
  for the first time. `HelpGuide.md` is the Help assistant's whole prompt: every feature updates it
  and its tests.
- **Never:** deploy, push, `git add -A`, or `git stash` in a worktree.

## 14. Work groups and order

| Group | Items | Starts |
| --- | --- | --- |
| Polish | 2 AI marker, 4 links, 5 borders, 6 favorites, 7 views, 8 sync movement | at once |
| Removed Items | 1 | at once |
| Notes | 9 checkbox, 10 find, then 11 tables | at once |
| Duplicates | 3 | when Polish has landed (it shares the List's cards and sections) |
| Votes | 12 | when Polish (the view switcher, gold cards) and Removed Items (live sites, the sync engine) have landed |

Each group has one implementer (resumed for fixes), works in its own worktree, writes its plan to
`docs/superpowers/plans/2026-09-27-<group>.md` first, and lands on `main` by cherry-pick after a
live check by the main session and one final review (code and UX, with screenshots).
