# Fieldmark

A native macOS app for planning surveys. Collect **sites of interest** for an outing — each
with a name, free-form notes, links, an optional address/location, and images added by
drag-and-drop — and view them three ways: a **list**, a **map**, and a **gallery**. All data is
stored as plain, human-browsable files on disk, **one folder per survey**.

Built with **SwiftUI** (dark-mode first), following a strict red/green **TDD** workflow with
**mutation testing** to verify the tests actually catch bugs.

## Features

- Create and list surveys; each is a folder on disk.
- **Plan a survey** from six lines of free text: where, who's going, how long, roughly what you
  want to spend, what matters most, and anything else. Only *where* is required, and every line is
  free text — "two of us, and our friend joins halfway through" plans an outing a passenger count
  cannot. **Plan a Survey…** on the sidebar's `+` opens the form; a model then researches the region, looks each site up on the
  real map, writes them in as pins while you watch, and finishes with a day-by-day write-up kept
  behind **Show plan** on the banner.
- **Export a survey** to one `.fieldmark` file from its right-click menu, and import one from the
  sidebar's `+`. Import always mints fresh ids, so importing the same file twice gives two
  independent surveys rather than one overwriting the other.
- Add / edit / delete sites of interest: name, one-sentence summary, notes, links, optional
  address, optional coordinate (drop a pin or geocode the address), attached images.
- Drag-and-drop image import (validated by content sniffing, copied into the site's folder).
- **Import sites in bulk**: paste a wall of links, a list of names or half a route into
  **Import Sites…** on the detail toolbar's `+`. Each one is looked up and added as a real pin
  with a coordinate that was found rather than guessed; anything that is not a site is skipped.
  A link is read for where the page says it is — a coordinate or address it publishes, or failing
  that the words on it — because a small reserve's own site names its town in the footer and
  nowhere else, and a run that only read the meta tags placed one of nine pasted reserves.
  A list of any length works, in any shape: past a dozen sites it is read a dozen at a time,
  because one conversation asked to plan eighty-three items at once spends longer thinking than
  the model is given to answer in. Where the sites *are* is asked of the model first, rather
  than assumed to be the lines — a page copied out of a browser gives one site over four lines
  and a sentence gives three on one.
- Six views over a survey: **List**, **Map** (MapKit), **Gallery**, **Categories**,
  **Route** and **Field Notes**.
- **Field Notes**: one rich-text document per survey, for what the whole outing should know — phone
  numbers, ferry times, photos, questions for the group, to-do lists. Titles, headings, bold,
  italic and the rest, bulleted, numbered and checklist items, pasted and dragged-in photos, and
  site cards that follow their site and keep its last look once it is deleted. Select words and
  add a highlight note; others reply, and notes can carry notes of their own. A Format menu with
  Notes' shortcuts, find, spelling and undo. On a shared survey everyone reads and writes them,
  and nothing anybody types is lost: two people editing one paragraph at once both keep their
  version, merged where they changed different words and one after the other where they changed
  the same ones.
- Every pin is coloured by its category — fifteen hues plus grey for the uncategorized — and
  wears that category's symbol. A site you have not saved yet keeps the colour but wears the
  Discover symbol, so a suggestion never looks like one of yours.
- **Map Colors** in Settings offers twenty colour schemes for those fifteen hues and the grey, from
  Classic to Neon. Most also restyle the map: light or dark, standard, muted or satellite, most
  with a tint over the tiles. Each recolours the category colours in the lists and the editor too,
  so a pin and its section header always agree.
- Mark a site as a **favorite** and its pin wears a small gold badge on the balloon's shoulder,
  in front of the pin rather than behind it, so the sites that matter most stand out on a map of
  thirty without hiding what kind of site they are. Favorites also get a star beside their name
  in the lists. Flip it from the star on the pin's card, from a card's right-click menu, or from
  the editor.
- While a Discover run's pins are up, **everything else on the map stands down**: your own pins
  go translucent and drop their names, and the base map stops drawing its own cafe and shop
  labels. The pin whose card is open stays solid. Clearing the run puts it all back.
- **Copy a site to another survey** from its right-click menu in the List or Categories view.
  The copy takes the photos and attachments with it and gets its own id, so the two are
  independent from then on; copying the same site twice gives two copies rather than one
  overwriting the other.
- **Share a survey** with other people on other Macs. **Share…** on a survey's right-click
  menu gives you an invite code; **File ▸ Join Shared Survey…** takes one. Everyone on the share
  can add and edit sites, the route, the kit list and the Field Notes, everyone sees who
  added what, and changes arrive within about ten seconds. Field Notes visit only through a server
  that carries them: until the deployed one does, each Mac keeps its own and the rest of the share
  syncs as before. The owner can mint a fresh code or stop sharing for
  everyone; anyone else can leave. Photos and attached files visit with the survey — any one
  file over 25 MB stays on the Mac that added it, and the share says so. What the server keeps, and
  what it does not, is under [Publishing an update](#publishing-an-update).
- Filter the list by typing: the box above it narrows the sites to the ones mentioning
  what you typed, matching the name, summary, notes and links.
- Click a pin and its card opens the site's links in an in-app browser, one button each.
- Right-click any picture on a page in that browser and choose **Set as primary image** to make
  it the site's photo, on the first page or any you have browsed to since. Photos drawn as CSS
  backgrounds count, which is how most site builders draw them.
- **Discover** random sites of interest near the map's current view. The filter opens each
  category bucket into the kinds of site it covers, so you can ask for shops without the food
  marts. Ticking a category hides or shows those pins straight away, without searching again.
- Discover also takes **your own words** — "second-hand bookshops and record stores" — from the
  menu on the same button. With a model configured the wish becomes a few map search terms;
  without one it is split at its commas and searched as typed.
- **Chains are hidden by default**: a brand list for the ones everybody knows, plus any name
  that turns up at three separate spots in one run, which catches regional chains no list would.
  There is a switch to put them back, and the banner says how many were left out. Both that
  switch and **prefer local cuisine** shape the next search rather than the pins already up,
  which is why they sit under "Next search" in the filter.
- **Prefer local cuisine** pushes sites whose names give away somebody else's kitchen down the
  list. A preference, never a filter — a town of nothing but pizzerias still comes back full.
- Untick everything and the map empties and says so; Discover then stops rather than searching
  for everything only to hide all of it.
- Dismiss a suggestion with its **X** and it stops coming back; add an exclusion term in Settings
  and sites whose name contains it never appear.
- **Links are named after the site they go to** and there is only ever one per site. A site given
  its website by an import and again by the annotation run that follows used to end up with two
  rows both reading "Website"; now the second is recognised as the same site and dropped, and a
  genuinely different site is titled after itself, so "Website" and "OutingAdvisor" are told apart
  at a glance.
- **Annotation**: discovered sites are looked up automatically, and any saved site has an
  **Annotate** button. Both fill in what is missing — a one-sentence summary, a website link, a
  representative photo, a review score, how touristy the site is, and for somewhere that feeds
  you the dish it is known for — and never overwrite what you wrote.
- **Route**: reorder stops by hand, or press **shorten the route** to put them in visiting
  order, or **plan the days** to build a whole day-by-day outing from every saved site, with the
  ones near each other on the same day. Shortening says how much it saves in a straight line
  before it does anything, and warns that your dates and times are dealt out again down the new
  order — so the site you put on Tuesday can end up somewhere else.
- **Ask about the app**: the question mark in the toolbar takes a question in plain words and
  answers it. The model is given one document, `Sources/FieldmarkUI/Resources/HelpGuide.md`, as its
  whole system prompt, and is told to answer from that and to say so when the answer is not in it,
  so it cannot invent a menu the app does not have. Editing the guide is how the answers change.
- Plain-file persistence — open a survey's folder in Finder and everything is readable JSON +
  image files.

## AI annotation

Annotation combines a keyless Wikipedia lookup with one call to an OpenAI-compatible chat model,
grounded in a web search the app runs itself and prints into the prompt. The provider's own search
tool used to do that job. Measured over 435 real calls, the same model handed results the app had
fetched found the correct live official website 15 times out of 15, against 11 of 15 searching
server-side, so the app owns the search now and the model is only asked to read it. Photo
candidates come from the article's own thumbnail, the site's `og:image` and a stock search, and
every one is HEAD-checked to be a reachable image. A model is never asked for an image URL; in
testing, every model-guessed one was dead.

The score, the verdict on the crowd and the dish come from the same one call, copied out of the
search results rather than recalled: a model asked for a number it did not read will produce a
plausible one, so anything off the 0–5 scale, any count with no score to count, and any "dish"
that is really a paragraph are dropped rather than shown. A site with none of them shows none
of them.

When the chosen model can accept a picture, the candidates are shown to it and it picks the one
that actually shows the site — a shop's own storefront over a photo of a bridge in the same
town. Ranking them by where they came from is only a guess, and that is the guess that gets a
restaurant illustrated with an aerial shot of its city. Most models cannot see; with one of
those, or when the model has no opinion, the ranked order stands and nothing extra is fetched.

The judge is told what kind of site it is looking at, because one instruction cannot serve all of
them. It used to be asked to prefer the site over "the landscape around it", which is right for a
bistro and wrong for a viewpoint, where the landscape *is* the site. The category picks one of
three: a venue wants the storefront, the room or the food; a landscape wants the view; a landmark
wants the building, whole and recognisable.

A judge that has looked at every candidate and says none of them show the site now leaves the
card without a photo. That answer used to be indistinguishable from a reply nobody could read, and
both fell back to the first ranked candidate — which, for a business, is very often its own logo.
The two are told apart now: no opinion still falls back, "none of these" does not.

Every candidate is also **measured**, which needs no key and no model that can see, and so is the
only defence the common run has. A 192-pixel thumbnail of it is drawn over white and four numbers
are taken: how many neighbouring pixels differ in brightness by a step or two (*grain* — the noise
a sensor and a codec leave behind), how many exact colours it holds, how many neighbours are
perfectly identical, and how much of it has any colour in it at all. A photograph is full of small
differences; a logo, a wordmark or a map is either perfectly flat or a hard edge, with nothing in
between. Anything that measures as a drawing is dropped and the hunt looks further down the list,
which it could not do before — without a judge it used to collect exactly one candidate and stop,
so there was no room to replace a rejected one. The thresholds were measured over 101 real images
and got all 101 right; they are written down in `PhotoLikeness.swift` with what each one is
defending against. An SVG is refused outright, because a vector is a drawing and ImageIO cannot
decode one anyway. A candidate **too small** to be a picture of anywhere — under 200 pixels on
its long edge, read from the file header without decoding — is refused too.

A candidate the screen could not read is **kept**, not dropped. It has already been HEAD-checked,
so a failure there is nearly always the network, and refusing what could not be looked at would
trade a rare wrong photograph for a common missing one.

It costs downloads. On the judge path those bytes were being fetched anyway. On the keyless path
annotation used to send one HEAD request and no body at all, and now fetches up to four images per
site — which is the price of looking, and the only way to see a logo.

Open **Settings** (the gear in the toolbar) to set the API key and the model, and to keep the
list of discovery exclusion terms. There is no base URL field: the model picker carries each
model's endpoint, so choosing a model sets it. Defaults target Nimbus `nimbus-5.3-flash`, but any
OpenAI-compatible endpoint works.

The key is stored in `~/Library/Application Support/Fieldmark/settings.json` with mode `0600`.

**Learn More**, under the key field, folds out four numbered steps for getting a key of your own,
each with a link to the page it happens on. The steps belong to the provider the selected model
comes from, so a provider added later brings its own; an endpoint outside the catalogue shows no
Learn More rather than somebody else's instructions.

### Asking for the key

You do not have to find Settings first. Press something that needs a model with no key entered
and a box tells you whose key is missing and which job it is holding up — "Fieldmark needs a key
from Nimbus before it can plan an outing" — says that you pay the provider directly for what you use,
and offers **Open Settings**. Enter the key there, close Settings, and the job you asked for
happens. You do not have to go and find the button again.

The box collects nothing itself. A bare secure field in a modal was the least explained site in
the app to ask somebody for something they have to go and buy, and it meant two screens that both
wrote the same setting.

**Validate**, beside the key field in Settings, asks the provider whether the key works: one cheap
completion against the configured model, on demand. Three answers, and the last two are not the
same thing — a provider that turns the key down is evidence about the key, and a provider that
cannot be reached is not, so an outage never tells you a perfectly good key is wrong. The answer
is forgotten the moment the key is edited, since a green tick under a key you have since changed
is a lie. It is a button rather than something that happens as you type because every check costs
a request you are paying for, and a pasted key arrives one character at a time.

Everything you can press asks: Plan a Survey, Import Sites…, Ask in the help box, all three
ways to Annotate (the toolbar, a card's menu, the editor), and "Describe what you're after". None of
them is a dead control any more.

**Auto-annotation after a discovery run stays quiet.** It touches dozens of sites on a timer, and
a box in the middle of that is an ambush rather than a question. It does the thinner Wikipedia-only
job, exactly as it did before. The rule is: an explicit action asks, background work does not.

### The Developer menu

A **Developer** menu with two items — *Temporarily Disable API Key* and *Reenable API Key* — so
the box above can be looked at on demand. Disabling makes every request-time read of the key see
nothing while `settings.json` is untouched, so the whole app behaves as though it has no key. It
is in memory only: quitting Fieldmark puts the key back.

The menu is always there in a development build, which is what `./run.sh` and `Scripts/e2e.sh`
run. The installed copy is a release build and does not carry it until you ask:

```bash
defaults write org.example.fieldmark developer.menu -bool YES
```

No rebuild, no launching from a terminal, and it survives a restart. `defaults delete
org.example.fieldmark developer.menu` takes it away again.

## Planning an outing

Planning is the same provider doing a different job. Annotation asks one question and reads one
answer; planning is a conversation — where is this, what is worth seeing, find me the actual
bakery — so it runs a multi-turn tool-calling loop with five tools: `search_web`, `search_map`,
`geocode`, `read_link` and `add_site`. Every one of those is a port the app already had, so each
adapter only decodes the arguments, calls the port and encodes the answer back as JSON.
**Import Sites…** in the detail toolbar's `+` is the same loop with a different prompt and a
smaller budget, pointed at the survey already open. A paste longer than `ImportBatches.size`
sites is cut into batches and read a batch per conversation, each with its own budget and its own
transcript; the pins, the banner, the clock and the deduplication belong to the run as a whole.
Eighty-three lines of Norway pasted in one message made the model reason about all of them before
asking for anything, which outlived the transport's five-minute cap on a single turn and produced
nothing at all. Split, the same list is seven conversations, none of whose turns comes within ten
times the cap, and it finishes.

What counts as one site is asked of the model too, in a single cheap turn before the run begins
(`ImportItems`), because freeform text has no separator to find. It answers with each site's
*opening* — the first few words, as they appear — and the paste is cut at those offsets rather
than rebuilt from what came back. So every batch is a verbatim slice, the batches reassemble into
the paste, and an opening the model dropped or invented costs a batch boundary rather than a
site: a dropped one merges into its neighbour, an invented one is not found. Each opening is
searched for from where the last one ended, so a list whose entries all begin "California, LA"
still gets one cut per entry. Below half the openings matching, the answer is thrown away and the
lines are used instead.

Stopping a run stops it. `OutingRunModel` holds the task the conversation is on, `cancel()` cancels
it, `AsyncThrowingStream` tears the URLSession transfer down through its `onTermination`, and the
runner checks between turns and after every tool call. Measured live: the blocked request returned
one second after the stop, and the log holds exactly one more line — the run saying it stopped.

The model supplies the name, the coordinate and the category, and nothing else. It is good at "a
bakery near Zelova that locals go to" and bad at "the URL of that bakery", so it is only asked
the first kind of question; the website, the photo and the review score come from the ordinary
annotation run that follows each new pin.

A coordinate is the one thing it is never trusted on. `read_link`, `search_map` and `geocode`
write every coordinate they answer into a ledger for the run, and `add_site` refuses one that is
not within 250 m of something in it, telling the model which tool to call for that site instead.
This is not belt and braces: driving nine pasted reserve links through the real model, each run
wrote exactly one pin from a coordinate it had remembered rather than looked up, 70 km and 700 km
from the real site, under a prompt that said in as many words not to. Wording did not fix it and
was tried twice.

A run is bounded three ways: for planning 130 turns, 120 tool calls and 10 minutes; for one batch
of an import, 36 turns, 140 tool calls and 7 minutes — against annotation's effectively one turn. Turns bound the conversation, tool calls bound the bill — a model that has
decided to search the same thing for ever burns money without burning many turns — and the
deadline bounds the wall clock, because neither of the other two moves at all while a provider is
wedged. A run one of them stopped says so in the banner rather than looking like one that finished.

The survey is created before the conversation starts, so a run that dies on its first turn
leaves an empty survey you can see and delete rather than nothing at all. Planning needs an API
key, and without one the menu item asks for one rather than sitting there greyed out — see
[Asking for the key](#asking-for-the-key).

## Architecture

A single Swift Package with four layers:

- **`FieldmarkCore`** — pure-Foundation domain models + plain-file persistence + a geocoding port.
  No SwiftUI/MapKit/CoreLocation.
- **`FieldmarkServices`** — the outside world and the formats it speaks: the HTTP client, the AI
  provider adapters, the web search, the Wikipedia and Open Graph lookups, the share client and
  wire format, the updater's download and verification, the image encoder. Depends on
  `FieldmarkCore` alone.
- **`FieldmarkPresentation`** — the `@Observable` and `@MainActor` models a view reads, and the
  rules they hold. Depends on `FieldmarkServices` and `FieldmarkCore`.
- **`FieldmarkUI`** — SwiftUI views, layout, and the MapKit/CoreLocation/WebKit adapters.
- **`FieldmarkApp`** — a thin `@main` SwiftUI `App`.

None of the first three may import a framework that needs a window, a screen, a map, a location
fix or a web view, and none may import a layer above itself. That is not a convention: it is
`Tests/FieldmarkCoreTests/LayeringTests.swift`, which reads every file's import lines and fails on a
banned one or a dependency pointing upwards.

The split exists so the logic can be judged. A mutant in `FieldmarkUI` is judged by `FieldmarkUITests`,
which hosts real windows and takes about seven minutes a suite — a single mutation run would take
days. `FieldmarkServicesTests` and `FieldmarkPresentationTests` run in about 40 and 26 seconds, so the
same code is now mutation-tested like the core. Most of both is one test waiting out a VideoToolbox
timeout this VM cannot satisfy; `docs/mutation-testing.md` has the measurements and the stack.

Plus `FieldmarkSnapshots` (a deterministic screenshot harness, in dark mode unless a snapshot is
about the light appearance), `FieldmarkJSON` (reads a value out of a JSON document at a dotted path,
for the shell scripts) and `Tools/CodeQuality` (the mutation-testing engine).

### On-disk layout

```
~/Library/Application Support/Fieldmark/
  settings.json                        { llmAPIKey, llmBaseURL, llmModel, searchAPIKey,
                                         apiKeysByProvider, excludedTerms,
                                         autoAnnotateDiscoveries, imageQuality,
                                         imageMaxPixelSide, spotterID,
                                         spotterName }                        mode 0600
  control-token                        the control API's token for this launch, 64 hex
                                         digits, rewritten at every launch        mode 0600
  Diagnostics/
    <date> <kinds>.json                one freeze or crash report each, the newest 50
                                         kept: MetricKit's JSON as delivered, or the
                                         app's own watchdog's { kind, noticedBy,
                                         recovered, seconds, began, updated, before,
                                         after, inFrontWhenItEnded, appVersion } —
                                         written as the freeze goes on, completed if
                                         it ends
  Surveys/                           (the LibraryRoot)
    <survey-slug>/
      survey.json                    { id, name, createdAt }
      spotters.json                { spotters: [ { id, name } ], filter: [ id ] } — the
                                         outing's roster, and whose sites the People menu
                                         has ticked
      dismissed-discoveries.json       [ "<name>@<lat>,<lon>", ... ]
      share.json                       { shareID, memberID, memberToken, role, lastSeq,
                                         memberCount, inviteCode, readsFieldNotes }  mode 0600
      outbox.json                      [ { kind, id, body, enqueuedAt, baseRevision } ] —
                                         changes not yet sent; a delete carries no body at
                                         all, and only a Field Notes row a baseRevision
      assets.json                      { uploaded: { key: etag }, pendingUploads,
                                         pendingDownloads, pendingDeletes, tooLarge } —
                                         the photos and files a share has moved, and what
                                         is waiting to move                      mode 0600
      route.json                   { stops: [ { id, siteID, date, includesTime, sort } ] }
      kit.json                     { items: [ { id, name, isPacked, sort } ] } — sort is
                                         the item's site in the list, the key that
                                         carries the order to a shared outing's other Macs;
                                         an item no build with keys has saved has none
      field-notes.json                  { format: "fieldmark.field-notes", formatVersion,
                                         minReaderVersion, blocks: [ { id, sort, type,
                                         content, removed, … } ], notes: [ { id, parent,
                                         author, createdAt, body, removed, … } ] }
      field-notes/images/<UUID>.<ext>   Field Notes photos, and the copies of sites' photos
                                         the cards keep
      field-notes-sync.json             { rows: { "<kind>/<id>": { revision, base } } } — what
                                         this Mac last saw of each Field Notes row on its
                                         share, the base a merge measures from   mode 0600
      sites/
        <site-slug>/
          site.json                   { id, name, summary, notes, links, address, coordinate,
                                         imageFilenames, attachmentFilenames, category,
                                         insight: { rating, ratingCount, ratingSource,
                                         signatureDish, authenticity }, isFavorite,
                                         spotterID, createdAt }
          images/<file>                images, stored as HEIC no longer than the size cap
          attachments/<file>           copied-in attachments
```

Folder slugs are derived from names at creation and are stable; the display name always lives
in JSON, so renaming a folder by hand never loses data.

A survey leaves that tree as one `.fieldmark` file, carrying the same fields plus every image and
attachment base64 inside the JSON:

```
<name>.fieldmark    { format: "fieldmark.survey", formatVersion, exportedAt,
                   survey:  { name, createdAt },
                   sites:    [ { name, summary, notes, links, address, coordinate, category,
                                  insight, isFavorite, spotterID, createdAt,
                                  images:      [ { filename, data } ],
                                  attachments: [ { filename, data } ] } ],
                   spotters: [ { id, name } ],
                   route: [ { siteIndex, date, includesTime } ],
                   kit:   [ { name, isPacked } ],
                   fieldNotes: { document: <field-notes.json as it is>,
                                images:   [ { filename, data } ],
                                cards:    [ { siteId, siteIndex } ] } }
```

One file rather than a zip, so the whole format stays inside `FieldmarkCore`, where it is unit and
mutation tested with no new dependency. It carries no site or survey ids, and a route stop
names its site by index into `sites` rather than by UUID — and so does a Field Notes card, through
`cards`. The ids that do visit mean the same at both ends: people's — the roster's, each
site's `spotterID` and the notes' authors — and the notes' own paragraph and note ids, which
nothing outside the notes points at. Every other id, import mints afresh, which is what removes
the question of what happens when you import a survey you already have. Its decoder is also
forgiving where the app's own files are not — every field has a default, and a site that will
not decode is skipped and counted rather than taking the whole import down — because a shared file
may have been written by an older or a newer build.

## Install

Download [Fieldmark.app.zip](https://fieldmark-kyzw3z.pages.dev/Fieldmark.app.zip), open it, and drag
`Fieldmark` into your Applications folder. The first time it opens, macOS says it is an app downloaded
from the internet and asks whether you are sure; press Open. It asks once. The app runs on macOS 14
or later, on Apple silicon or Intel, and needs nothing else installed.

The download is signed with Apple's Developer ID and notarized, which is what lets a Mac open it
with that one click. It is also what the app installs over itself when it updates; see
[Updating](#updating). The stable address above redirects to the current `Fieldmark-<version>.zip`,
so a link to it never goes stale.

### From source

The app can also be built on the Mac it will run on. That needs Apple's Command Line Tools (the
Swift compiler) and takes a few minutes; nothing else has to be installed first, and one line does
everything:

```bash
curl -fsSL https://fieldmark-kyzw3z.pages.dev/install.sh | bash
```

Pass flags through with `bash -s --`:

```bash
curl -fsSL https://fieldmark-kyzw3z.pages.dev/install.sh | bash -s -- --yes --dest ~/Applications
```

It asks the site what the current version is, downloads it, checks the download against the
`sha256` the site published, unpacks it into a temporary folder, and runs `setup.sh`. The
temporary folder goes whether or not the install worked. `curl`, `ditto` and `shasum` are all part
of macOS, so there is nothing to install first.

Piping a download into a shell runs whatever arrived, so the script does nothing until its last
line: every step is inside one function that is called at the very end. A connection cut in half
therefore runs nothing at all rather than half an install. That, and the checksum, are what make
the shape above defensible; if you would still rather read it before running it, open
[install.sh](https://fieldmark-kyzw3z.pages.dev/install.sh) first, or do the same thing by hand:

```bash
d="$(mktemp -d)" \
  && curl -fL --proto '=https' --tlsv1.2 -o "$d/fieldmark.zip" https://fieldmark-kyzw3z.pages.dev/fieldmark.zip \
  && ditto -x -k "$d/fieldmark.zip" "$d/src" \
  && "$d/src/fieldmark/setup.sh"; rm -rf "$d"
```

From a checkout, the same installer runs directly:

```bash
./setup.sh
```

- It needs macOS 14.5 or later. The one other thing it needs, Apple's Command Line Tools (the
  Swift compiler), it installs itself. Xcode is not needed. Installing them needs an
  administrator account and asks for your password, and the first build needs the internet to
  fetch one dependency. On a bare Mac that is about a gigabyte to download before the build even
  starts, so allow a while for the first one.
- A copy installed from the download knows its version from the `VERSION` file it carries, since
  the zip has no git history to count. It reports its commit as `unknown`, which is expected and
  costs nothing: the version is what the update check compares.
- Every check runs first, in seconds. Whatever is missing is listed, and one question covers
  installing all of it. The build starts only after that.
- The app goes into `/Applications`, or into `~/Applications` when your account cannot write to
  `/Applications`.
- Once installed, the app reads nothing from this folder, so the checkout can be deleted.
- Reinstalling replaces `Fieldmark.app`. Surveys, settings and the API key in
  `~/Library/Application Support/Fieldmark` are never touched.

`./setup.sh --yes` (or `-y`) skips the question and `./setup.sh --dest DIR` installs `DIR/Fieldmark.app`.
An app built this way is signed ad hoc, which a Mac accepts for an app built on it, and it updates
itself to the notarized download like any other copy. Three more flags exist for the release and
are not needed for an install: `--stage DIR` assembles `DIR/Fieldmark.app` and installs nothing,
`--universal` builds one binary for both architectures, and `--sign ID` signs with a Developer ID
identity, hardened runtime and timestamp included.

### Updating

Fieldmark checks for a newer version when it opens. If there is one, it says which version you have
and which is available, and asks. Saying yes downloads the new version, checks it, installs it in
site of the running copy, and opens Fieldmark again by itself; a sheet shows the progress, and the
whole thing usually takes under a minute. Saying no puts that version away and asks again at the
next one. Cancel, while it is still downloading, drops the offer until the next launch.

Nothing is moved until the download has passed every check: its checksum matches the one the site
published, its signature satisfies a code requirement naming this app and the Apple team in
`TEAM_ID`, and its own `Info.plist` claims the version that was offered and a macOS this Mac has.
A download that fails any of them is refused, the sheet says why, and **Download Manually** opens
the zip in your browser so you can drag it into Applications yourself. The new copy goes where the
old one was, so a copy in `~/Applications` is replaced there rather than joined by a second one in
`/Applications`; a copy in `/Applications` needs an account that can write there.

To update by hand instead, download [Fieldmark.app.zip](https://fieldmark-kyzw3z.pages.dev/Fieldmark.app.zip)
and drag it over the old one. The one-line installer above works too, and still builds from
source:

```bash
curl -fsSL https://fieldmark-kyzw3z.pages.dev/install.sh | bash -s -- --yes
```

A copy old enough to update through Terminal (every version before the notarized download
existed) still does that once: the site keeps publishing the source zip its updater asks for, and
the `setup.sh` in it installs a copy that carries the in-app updater. The next update after that
is the one described above.

The version an installed copy calls itself is in `VERSION` at the top of the checkout, as
`major.minor.patch`. The patch number is the commit count: `.githooks/pre-commit` writes it on
every commit that changes something the download carries, and `setup.sh` takes whichever is
larger, the file or the live count, so the number still moves in a checkout whose hooks were
never installed. The deploy applies the same rule, names the app zip and the manifest with the
result, and writes it into the source zip's `VERSION`, so the number an installed copy calls
itself is the number the site offers; the updater refuses a download whose own `Info.plist`
disagrees with the manifest. A documentation-only commit does not move it, because an update
that turns out to be a byte-identical build is worse than no update at all.

## Develop

After cloning, activate the tracked git hooks:

```bash
./Scripts/setup-hooks.sh
```

This sets `core.hooksPath = .githooks` so that `.githooks/pre-commit` runs on every commit.
The hook enforces two things:

1. **Identity policy:** commits always use your global git identity. Any repo-local
   `user.name`/`user.email` written by an editor or AI agent is stripped before each
   commit, so it cannot silently re-attribute your work.
2. **Visual Relay authority:** the hook delegates to `.git/hooks/pre-commit` (the
   Visual Relay commit-authority hook) which blocks unauthorized commits during an
   active relay run.

**Caveats:**
- Bypassable with `git commit --no-verify` (intentional escape hatch).
- Relies on a global git identity being configured (`git config --global user.email ...`).
- The strip happens in the pre-commit hook, which runs after git reads the author
  config for the current commit. The triggering commit may carry a local identity;
  all subsequent commits will use the global identity.
- **Fallback** if `core.hooksPath` conflicts with Visual Relay tooling: run
  `Scripts/setup-hooks.sh` to reinstate the hook path; Visual Relay regenerates
  `.git/hooks/pre-commit` on each run, but `.githooks/pre-commit` delegates to it,
  so both coexist safely.

```bash
./Scripts/build.sh        # build all targets
./Scripts/test.sh         # run the suite SEQUENTIALLY (swift test --no-parallel)
./Scripts/lint.sh         # swiftformat + swiftlint (must be clean)
./run.sh                  # build & launch the app (forwards args to FieldmarkApp)
./Scripts/screenshot.sh   # render PNGs of each view into Screenshots/ (dark mode, a few in light)
./Scripts/icon.sh         # generate app-icon PNGs + .icns into Icons/
./Scripts/mutate.sh       # mutation-test a module (--module <target>, default FieldmarkCore; --files, --list)
./Scripts/e2e.sh          # drive the LIVE app over its control API (throwaway data directory)
./Scripts/live-drive.sh   # drive the real .app bundle, isolated (see "Driving the app bundle")
./Scripts/test-setup.sh   # test setup.sh against stub tools (add --real to run the real thing)
./Scripts/release-app.sh --out DIR   # build, sign, notarize and staple the app into DIR
./Scripts/test-release-app.sh        # test release-app.sh against stub tools; nothing reaches Apple
./Scripts/test-deploy.sh             # test deploy-cloudflare.sh against a stub wrangler; nothing is published
swift run FieldmarkApp       # launch the app
```

`./Scripts/test.sh` gives the run a temporary folder of its own, `.build/test-tmp/`, and fails,
naming what was left, when a test leaves anything in it. macOS empties the ordinary temporary folder
only at boot, and on 2026-09-24 the 2.2 million folders tests had left there under mutation runs
stopped this VM booting. So a test makes its folders with its target's `TempDir` (`UITempDir` in
`FieldmarkUITests`) and removes them with `defer { tmp.cleanup() }` on the next line. Not with
`FileManager.default.temporaryDirectory`, which ignores `TMPDIR` on macOS and so escapes the check;
`TemporaryFolderTests` fails the run if a test uses it.

### Two languages

The app is Swift and the scripts around it are bash. Nothing else, and `RepoLanguageTests` fails
the build when a third one turns up in anything that runs.

The rule is written down because it had quietly stopped being true. The scripts reached for
`python3` three separate times — to read JSON, to pick a free port, to mint a token — each one
the shortest way to finish one small job, and together a whole extra toolchain a spotter had
to install before the tests would run. `setup.sh` was always held to a stricter line: only what
ships with macOS or the Command Line Tools, never `python3`, never `jq`, never Homebrew. The rest
of the repo is now held to the same line.

| The job | Done by |
| --- | --- |
| Reading a value out of JSON | `FieldmarkJSON`, a small Swift tool in this package |
| Picking a free port | bash `/dev/tcp`, probing the ephemeral range |
| Minting a control-API token | `od` on `/dev/urandom` |
| A PNG's dimensions | `od` on the IHDR chunk |
| Writing the seeded library | `uuidgen` and a heredoc |

The scan reads files that execute: shell scripts, Swift sources, config, and anything opening
with `#!`. It does not read prose, which is why a design doc can record the command somebody ran
in June, and why this paragraph can name `python3` without failing the build it describes.
JavaScript is not banned either — `PageImagePicker` hands a script to a `WKWebView`, and a web
view speaks nothing else.

### End-to-end

`./Scripts/e2e.sh` builds the app, launches it and drives the running window over its
loopback control API — settings, the Settings sheet, the site editor, `/screenshot`,
discovery and annotation — reporting each as a named `PASS` / `FAIL` / `SKIP` check and
exiting non-zero if any fails.

It is safe to run on a machine that holds real data. `FIELDMARK_SUPPORT_DIR` points the app
at a fresh `mktemp -d`, so the run never reads or writes
`~/Library/Application Support/Fieldmark` — neither your survey library nor the
`settings.json` that holds your API key — and that directory is removed on exit. The
control port is one the kernel hands out, so a copy of the app you already have running
is left alone too, and the run mints a per-run `FIELDMARK_CONTROL_TOKEN` so nothing else on
the machine can drive the app it launched.

The checks that need real MapKit or the network are skipped unless you opt in:

```bash
./Scripts/e2e.sh --no-build            # reuse the current build
FIELDMARK_E2E_NETWORK=1 ./Scripts/e2e.sh  # + the discovery check
```

The annotation check needs a real API key in `FIELDMARK_E2E_LLM_KEY`. **Export it from a
file or a secret manager — do not type it on the command line.** A key on a command line
is written to your shell history, and `VAR=… command` also puts it in that command's
environment; the script itself already keeps it out of the process table by handing
request bodies to `curl` on stdin rather than as arguments.

```bash
# A leading space keeps the line out of history in bash (HISTCONTROL=ignorespace)
# and zsh (setopt HIST_IGNORE_SPACE).
 set -a; . ~/.config/fieldmark/.env; set +a   # the file defines FIELDMARK_E2E_LLM_KEY
FIELDMARK_E2E_NETWORK=1 ./Scripts/e2e.sh      # + the annotation check
```

`./Scripts/test-sharing.sh` drives the whole sharing feature: one local `wrangler pages dev`, two
real app instances with their own support directories and control ports, and a share taken from
start to stop through the control API. It skips with exit 0 when wrangler cannot be run.
`Scripts/e2e-lib.sh` holds the plumbing both it and `Scripts/e2e.sh` use, and
`Scripts/wrangler-lib.sh` the wrangler half that it and the two server scripts share.

### Driving the app bundle

`Scripts/e2e.sh` runs the SwiftPM binary. Some faults only appear in a real `.app` with a visible,
activated window, because the display cycle they ride on does not run otherwise.
`./Scripts/live-drive.sh` builds a copy of the bundle, seeds a throwaway library, launches it and
runs a list of steps, checking health after each one so a crash is reported against the command
that caused it:

```bash
./Scripts/live-drive.sh 'post:select-survey:{"name":"Norway"}; get:/state'
./Scripts/live-drive.sh --repeat 6 'post:delete-site:{"name":"Quelavik"}; post:cancel-delete:'
./Scripts/live-drive.sh --no-build --keep 'get:/screenshot?path=/tmp/shot.png'
```

The second one used to kill the app. That was the sheet segfault in the outing-planning design (in
the history: `git show e2e43d9^:docs/superpowers/specs/2026-09-04-outing-planning-design.md`): the
control API answered a confirmation by changing the state behind it, SwiftUI then closed the alert
in the middle of a layout pass, and the closing animation re-entered macOS's update cycle. It
showed with the SwiftPM binary as well, about one e2e run in five. The answer commands now wait
for the alert to be on screen and press its own Cancel or Delete button, the way a click does, and
refuse with `409` a question whose alert is not on screen. In the app itself an alert is only
ever answered by its own buttons.

The copy it builds takes **its own bundle identifier** and runs with window restoration off. That
matters: crashing a bundle makes macOS offer to reopen its windows on the next launch, as an
app-modal alert with no window, and that offer follows the bundle id. A test copy calling itself
`org.example.fieldmark` would block its own next launch and put the dialog in front of anyone opening
the installed app. Nothing this script does can reach the installed app or the real library.

**The control API always wants a token**, in an `X-Fieldmark-Token` header on every request,
`/health` included. The scripts pass their own through `FIELDMARK_CONTROL_TOKEN`. The installed app,
opened the ordinary way, has none in its environment, so it mints one at every launch and writes
it to `~/Library/Application Support/Fieldmark/control-token`, readable only by you; a request
without it gets `401` and does nothing. That is what keeps web pages out: any page can send a
request to `127.0.0.1:8765`, but none can read that file, and a browser will not add the header
to a request for another site. To drive the installed app, read the token from the file:

```bash
token_file="$HOME/Library/Application Support/Fieldmark/control-token"
curl -K <(printf 'header = "X-Fieldmark-Token: %s"\n' "$(cat "$token_file")") http://127.0.0.1:8765/state
```

`printf` is built into the shell, so the token never appears in a process's arguments, where
`ps` would show it to every account on the Mac.

A request with a body has to say how long it is in `Content-Length`, as curl does; a chunked body
gets `411`. The server takes up to 32 KB of headers (`431` past that) and 16 MB of body (`413`),
answers `Expect: 100-continue`, which curl sends before a body over 1 MB, and gives a client 30
seconds from connecting to send the whole request (`408`). A request without the token is refused
as soon as its headers are in, before a byte of its body is read.

### Publishing an update

`./deploy-cloudflare.sh` publishes the current commit to Cloudflare Pages, which is where
installed copies look. It builds, signs and notarizes the app on the way, so a machine that
deploys needs four things once:

- A **Developer ID Application** certificate for the team in `TEAM_ID`, in the login keychain.
  Xcode > Settings > Apple Accounts > Manage Certificates makes one (only the account holder can).
  To deploy from a second Mac, export it there with its private key as a `.p12` and import it:
  `security import Certificates.p12 -k ~/Library/Keychains/login.keychain-db -T /usr/bin/codesign`.
  Apple never hands the private key out again, so keep that `.p12` somewhere safe and never in
  this checkout (`.gitignore` refuses it, and so does the deploy).
- **Notarization credentials**, stored once under the keychain profile `fieldmark`. An App Store
  Connect API key with the Developer role (App Store Connect > Users and Access > Integrations)
  is the cleanest: download its `.p8` while the page offers it, then
  `xcrun notarytool store-credentials fieldmark --key AuthKey_KEYID.p8 --key-id KEYID --issuer ISSUER-ID`.
  An app-specific password works too (`--apple-id`, `--team-id`, `--password`).
- The Command Line Tools or Xcode, which `setup.sh` checks for.
- `npx wrangler login`, once, which opens a browser.

Then:

```bash
./deploy-cloudflare.sh
```

It takes a couple of minutes, a good part of it waiting for Apple, and asks nothing. The signing and
notarizing is `Scripts/release-app.sh`, which checks the keychain in seconds before spending
minutes on a build, and which the deploy runs for you; on its own,
`./Scripts/release-app.sh --out DIR` leaves a notarized `DIR/Fieldmark-<version>.zip` and publishes
nothing. A build Apple refuses is printed with Apple's own log of why, and nothing is uploaded.

The script finds `wrangler` for itself, taking the first of these it sees: one already on your
`PATH`, one in this checkout's `node_modules/.bin`, or one fetched on demand with `npx` and cached
after the first run. It prints which it used. Set `FIELDMARK_DEPLOY_WRANGLER` to override.

This is the one site in the repo that runs something other than Swift or bash, and
`RepoLanguageTests` normally forbids that. Cloudflare ships no CLI that is not a Node program, and
the alternative is hand-rolling their multipart upload API in shell against hashes bash cannot
compute, so that one line carries a `# language-exception:` comment saying why. The rule allows
one marked line at a time and insists on a reason; it is the same kind of escape hatch as the
`// no-help:` comment the tooltip scan takes.

It builds four files into `.build/cloudflare` and uploads them: `fieldmark.zip`, a copy of the repo
as `Scripts/release-files.sh` defines it; `Fieldmark-<version>.zip`, the built app, universal,
signed with the Developer ID, notarized and stapled; `version.json`, naming the version in
`VERSION`, both zips and both `sha256`s (`download` and `sha256` for the source, `app` and
`appSha256` for the app); and `install.sh`, the one-line installer, with the address filled in
from `UPDATE_URL`. Beside them go `_headers`, which keeps the manifest uncached and the app zip
immutable, and `_redirects`, which sends the stable `/Fieldmark.app.zip` to the current version.
The app zip is named by version so no cache anywhere can hand out the wrong bytes for a manifest,
and it has to stay under 25 MiB, which is what Pages accepts per file; the deploy checks. The
copy of `install.sh` in the repo carries a `@BASE@` placeholder instead of an address, so a copy
that was never published through the deploy cannot quietly point somewhere else, and refuses to
run rather than trying.
`./deploy-cloudflare.sh --payload-only` builds all of it, notarization included, and stops, so
you can look before publishing, and `--notes "TEXT"` puts a sentence in the update dialog (the
last commit's subject line is used otherwise).

A whole release can be rehearsed without touching the live address: point `UPDATE_URL` at a
throwaway HTTPS host, commit that, build with `--payload-only`, and serve `.build/cloudflare` from
there. The apps built for the rehearsal ask that address, and publishing refuses anything but
the Pages one. A temporary Worker (`wrangler deploy --temporary` with an `[assets]` directory)
needs no login, honours `_headers` and `_redirects`, and keeps its address across deploys, which
is how the in-app updater was first proved against a real feed.

Two things happen before the upload. It runs `./Scripts/test-functions.sh` and
`./Scripts/test-sharing-server.sh`, which drive `functions/api/feedback.js` and the seven Functions
under `functions/api/shares/` against a real local D1 through `wrangler pages dev` — a Function
that answers 500 to every request must not reach the live address — and `--skip-checks` leaves
both out. Then it looks after the database: if `wrangler d1 list` does not already name `fieldmark`
it creates it, writes the id Cloudflare gave out into `wrangler.toml` as `database_id` and says to
commit it (a binding cannot resolve by name alone), and runs
`wrangler d1 migrations apply fieldmark --remote` so no Function ever meets a table that is not there
yet. That one command applies every file in `migrations/` in filename order, so a new migration
needs no new step.

Then the bucket the shared photographs and attached files live in: if `wrangler r2 bucket list`
does not already name `fieldmark-assets` it creates it, and unlike the database there is nothing to
write down afterwards — an R2 binding resolves by name, so `wrangler.toml` is not touched and there
is no id to commit. The bucket is never made public. A bucket is private until somebody opts in
with a custom domain or an r2.dev subdomain, and this one has neither, so the only reader is a
Function behind the same bearer token every other sharing route takes.

One database holds both features: `feedback` from `0001_feedback.sql`, and `shares`, `members` and
`entities` from `0002_sharing.sql`. `functions/` sits at the repo root beside `wrangler.toml`
rather than in `.build/cloudflare`, which is where Cloudflare looks: the Functions ship because
the deploy runs from the top of the checkout, and nothing is copied into the payload. Reading
either is one command:

```bash
npx --yes wrangler@4 d1 execute fieldmark --remote \
  --command "SELECT id, user, created_at, app_version FROM feedback ORDER BY id DESC LIMIT 20"

npx --yes wrangler@4 d1 execute fieldmark --remote \
  --command "SELECT id, name, last_seq, created_at, deleted_at FROM shares ORDER BY created_at DESC LIMIT 20"
```

Sharing stores no plaintext credential: `shares.invite_hash` and `members.token_hash` are SHA-256
hashes, and the tokens themselves are handed out once and never written down. An entity's `body`
is the app's own JSON, stored and returned byte for byte — the server never opens one. Photos and
attachments go into the private `fieldmark-assets` bucket as opaque objects under
`shares/<shareID>/sites/<siteID>/images/<filename>` (or `attachments/`), at most 25 MiB each,
readable only through a Function behind the same bearer token, stored and served back byte for
byte and never opened either; ending a share deletes every one of them in the same request that
ends it.

Two things it refuses to do. It will not publish if `wrangler.toml` and `UPDATE_URL` disagree
about the project name, because the app is built against `UPDATE_URL` and cannot be told about
another address afterwards. And when it has to create the project, it checks the hostname
Cloudflare printed against the one expected: Pages names are a global namespace, and a name
somebody else already has is renamed silently rather than refused, which would otherwise publish
to an address no installed copy asks.

The address itself is in `UPDATE_URL`, and `setup.sh` writes it into the installed app's
`Info.plist` as `FieldmarkUpdateFeed`; the team is in `TEAM_ID` and goes in as `FieldmarkUpdateTeam`.
A build without either key never checks for updates at all, which is every build started by
`swift run` and every test: an app that could not verify a download must not offer one. The
Team ID is public (every signed app carries it), so it lives in the checkout; a fork that
publishes its own feed changes `UPDATE_URL` and `TEAM_ID` together.

### Testing

- Framework: **Swift Testing** (`import Testing`). Tests run sequentially (`--no-parallel`)
  and resource-sharing suites are `.serialized`.
- Filesystem tests use a unique temp directory each.
- View logic is tested via `@Observable` view models; a few view-structure checks use
  ViewInspector.
- **Mutation testing** (`./Scripts/mutate.sh`) mutates one module a site at a time and confirms
  that module's own suite kills each mutant. `--module` names it; `FieldmarkCore` is the default.
  Every function also gets a mutant that throws its body away, so a function whose result nothing
  checks shows up as a survivor rather than as coverage.
  See [`docs/mutation-testing.md`](docs/mutation-testing.md) for the current score and the
  documented equivalent mutants.
- **It judges the tests too.** A whole-module run records which tests killed each mutant and which
  tests entered each function, and `./Scripts/mutate-triage.sh tests` turns that into four lists:
  tests that kill nothing, twins, tests that run a function without checking it, and functions
  nothing checks. Verdicts about tests live in `docs/mutation-tests.json`, beside the survivor
  ledger.
- **A test that dies with a signal instead of failing an assertion is usually a stale build, not
  a bug.** Delete `.build` and run it again before reading the backtrace. Changing a protocol is
  the common cause: a witness table compiled against the old shape survives in `.build`, and the
  call lands somewhere that is no longer that function. What you see is a crash with no
  assertion, deterministic every time, and a backtrace whose top frame has no symbol and whose
  fault address is the program counter. Because it kills the process rather than failing a test,
  a full run stops early and reports nothing after it.

  Checking out a different commit **in the same worktree does not isolate this** — that swaps the
  sources and keeps the objects, so a "clean" commit crashes too and the evidence points at
  whatever changed last. Only `rm -rf .build`, or a fresh worktree, tells you anything.
- **Live tests** need the network, so they are gated on `FIELDMARK_LIVE_TESTS=1` and skip without
  it. `LiveDiscoveryTests` and `LiveInterestSearchTests` want nothing more than that and real
  MapKit. The rest bill a real provider, so they read the key out of the app's own
  `settings.json` and skip rather than fail when there is not one: `LiveAnnotationTests` and
  `LiveImageJudgeTests` do one round outing each, and `LiveOutingPlanTests` plans a whole three-day
  outing and checks every pin it wrote is near the town it asked for.

  ```bash
  FIELDMARK_LIVE_TESTS=1 ./Scripts/test.sh --filter LiveOutingPlan
  ```

  Everything else about a run is proved with stubs, and a stub only ever agrees with a wire shape
  that was true the day it was written. This is the one test that notices when the model stops
  copying coordinates, starts renaming sites, or answers in a shape the parser cannot read.

## Docs

- Mutation testing: `docs/mutation-testing.md`
- Notarized releases and the in-app updater: the design and its two plans were removed once the
  work landed, and the history has them:
  `git show 7c55454^:docs/superpowers/specs/2026-09-12-notarized-app-releases-design.md`, and
  `2026-09-12-notarized-release-shell.md` and `2026-09-12-in-app-updater.md` under
  `docs/superpowers/plans/` in the same commit. Earlier specs went the same way.
