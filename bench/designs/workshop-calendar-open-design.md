# Claybank Studio workshop calendar: design spec

Status: draft, self-approved per the user's "work autonomously" default.
Source requirements: the requirements file in the repo root (never committed) plus
the user's build instructions (see "User constraints" below).

## Understanding

**What was asked (said):**

- A small web app for one pottery studio: an organizer schedules in-studio pottery
  workshops; potters book (usually by scanning a QR code).
- Must: create workshop (name, course, date + start time, capacity up to 30); course
  templates for at least 3 courses (Wheel Throwing, Raku, Handbuilding)
  that drive at least two workshop properties, extensible without touching core logic;
  a calendar view; a downloadable `.ics` invite per workshop; a booking link + QR
  per workshop; name-only booking; capacity enforced on the server; sensible
  full-workshop and duplicate-booking handling.
- Don't build: payments, email, recurring workshops, editing/cancelling workshops, admin
  dashboards, auth.
- QR and ICS must be libraries. Calendar must NOT be a library (user).
- TypeScript + CSS, server-side rendering, no frontend dependencies, Cloudflare
  Workers + D1, deploy to claybankstudio.com, runnable locally.

**Assumed (mine):**

- Store name "Claybank Studio" (from the domain), Vancouver time
  (`America/Vancouver`, so PDT in summer; the UI says "Vancouver Time" / "PT").
- The studio has 30 spots; that is the app-wide capacity ceiling.
- No client-side JavaScript at all. Every page works with plain HTML forms.
- The public can see the calendar, workshop pages and the potter list (no auth means
  the organizer has no private view; showing names is normal for store workshops).
- Booking closes when the workshop starts. Workshops must be created in the future
  and within a year (guards against typos).
- A "duplicate booking" is the same name (case/whitespace-insensitive) on the
  same workshop. With name-only booking we cannot tell a double-submit from a
  namesake, so the message covers both.

**Success criteria:**

- The flow create workshop → see it on calendar → scan/click QR → book → workshop
  fills up → next booking rejected with a clear message works end to end in
  the deployed app and in Playwright.
- Concurrent bookings for the last spot: exactly one succeeds (tested).
- Adding a 4th course = adding one JSON file (+ optional images). A test proves no
  course id or name appears in application code.
- Quality gates in `npm test` pass: typecheck, formatting, unit + integration with
  coverage thresholds, codebase rules (≤300 lines per TS file, FTA score cap, file
  type allowlist, static SQL only, no raw HTML), Playwright E2E, Pa11y, Lighthouse,
  suite time budgets. Mutation score (Stryker) above its break threshold.

## User constraints (verbatim intent)

- Parse, don't validate: value classes parsed at the edges (form fields, route
  params, JSON templates, DB rows); core code only accepts parsed types.
- Conventional commits; human-sounding comments; run the evaluator before every
  commit; no trailers (house commit style).
- Coverage + mutation testing (StrykerJS) to size the test suite.
- Tests enforcing code health: TS files ≤ 300 lines (src and tests), FTA scores,
  only TS/CSS/HTML-ish file types (bootstrap shell script is the one exception).
- Security best practices (parameterized SQL, escaping, headers).
- No inline styles, ever (no `style` attribute, no `<style>` element); a test
  enforces it and the CSP blocks inline styles at runtime.
- No wheel values in styles: colors, font families, font sizes/weights, line
  heights, spacing, radii, shadows and z-index come from CSS custom properties
  defined in one tokens file; a test (Stylelint, run from Vitest) enforces it.
- Pa11y + Lighthouse tests; a test that fails if the suite is too slow; Playwright
  E2E.
- README short: 2x2 screenshot table; mentions `./bootstrap`, `npm run test`,
  `npm run dev`, `npm run deploy`.
- No Docker, no nix. Planning docs never committed. Requirements file never
  committed. No evidence of an interview anywhere.
- Course templates as JSON with a separate content section; images for fun.
- Design write-up draft goes in a sibling folder outside the repo.
- Rework history into atomic commits at the end. Deploy at the end.

## Architecture

One Cloudflare Worker running a Hono app that renders HTML with `hono/jsx` on the
server. D1 stores workshops and bookings. Static files (CSS, fonts, images,
favicon) come from Workers Static Assets. Course templates are JSON files in
`courses/`, bundled at build time with Vite's `import.meta.glob`, so dropping in a
file adds a course. Vite + `@cloudflare/vite-plugin` runs dev and build; wrangler
applies D1 migrations and deploys.

```
browser ──HTML forms──▶ Worker (Hono)
                          ├─ routes: parse params/forms into value types
                          ├─ courses registry (JSON templates, parsed at load)
                          ├─ repositories (static SQL, bound params) ──▶ D1
                          ├─ ics (library) / qr (library)
                          └─ views (hono/jsx, auto-escaped)
static assets (css, fonts, images) served by Workers Static Assets
```

## Data model (D1)

```sql
CREATE TABLE workshops (
  id TEXT PRIMARY KEY,                 -- random UUID
  name TEXT NOT NULL,
  course_id TEXT NOT NULL,               -- template file name, e.g. "wheel"
  course_name TEXT NOT NULL,             -- snapshot, so a removed template still renders
  format TEXT NOT NULL,                -- snapshot of the chosen format's name
  starts_at TEXT NOT NULL,             -- UTC instant, fixed-width ISO 8601
  ends_at TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 30),
  min_potters INTEGER NOT NULL CHECK (min_potters BETWEEN 1 AND capacity),
  created_at TEXT NOT NULL,
  CHECK (ends_at > starts_at)
);
CREATE INDEX workshops_by_start ON workshops (starts_at);

CREATE TABLE bookings (
  id TEXT PRIMARY KEY,                 -- random UUID
  workshop_id TEXT NOT NULL REFERENCES workshops (id),
  potter_name TEXT NOT NULL,           -- as typed (normalized whitespace)
  name_key TEXT NOT NULL,              -- lowercased, for duplicate detection
  booked_at TEXT NOT NULL,
  UNIQUE (workshop_id, name_key)
);
```

- Capacity lives on the workshop row; the count is derived from booking rows
  (no counter to drift).
- Template values are snapshotted at creation (format name, min potters, end
  time from duration), so editing a template never rewrites past workshops.

### Capacity enforcement

Capacity must be enforced so a workshop never takes more potters than it has spots. This could
use a transaction, a row lock, or a counter column on the workshop; we will pick one during
implementation. Concurrency should be handled robustly.

## Course templates

`courses/<id>.json`; the id is the file name. Parsed by `CourseTemplate.parse` when
the registry loads; a malformed file fails fast (and a unit test loads them all).

```json
{
  "name": "Wheel Throwing",
  "workshop": {
    "formats": ["Standard", "Glazing", "Open Studio", "Beginner"],
    "defaultDurationMinutes": 180,
    "defaultCapacity": 16,
    "minPotters": 4
  },
  "content": {
    "description": "…",
    "whatToBring": "…",
    "color": "#…",
    "logo": { "src": "/images/courses/wheel/logo.webp", "width": 0, "height": 0, "alt": "…" },
    "art": { "src": "…", "width": 0, "height": 0, "alt": "…" }
  }
}
```

Drives four workshop properties: the format choices, the default duration, the
default capacity, and the minimum potters (also the lowest allowed capacity).
The `content` section only affects display. No code branches on a course.

## Pages and routes

| Route                        | Purpose                                                        |
| ---------------------------- | -------------------------------------------------------------- |
| `GET /`                      | Calendar, current month in Vancouver time                        |
| `GET /calendar/:yyyy-mm`     | Calendar for a month (404 if not a real month)                 |
| `GET /workshops/new`            | Pick a course (one choice per template)                          |
| `GET /workshops/new/:course`      | Workshop form with that template's formats and defaults           |
| `POST /workshops/new/:course`     | Create; 400 re-renders form with errors; 303 to workshop          |
| `GET /workshops/:id`            | Workshop details, spots, potter list, QR, booking link, .ics |
| `GET /workshops/:id/qr.svg`     | QR code for the booking link                              |
| `GET /workshops/:id/invite.ics` | Calendar invite download                                       |
| `GET /workshops/:id/book`   | Booking form (QR target); explains full/closed            |
| `POST /workshops/:id/book`  | Book; 303 to confirmation; 400/404/409 with message        |
| `GET /bookings/:id`     | "You're booked" confirmation                               |

Unknown routes and unparseable ids render a 404 page. Unexpected errors log and
render a 500 page.

## Parsed value types

Each is a class with a private constructor and `static parse(input): Parsed<T>`
where `Parsed<T> = { ok: true; value: T } | { ok: false; error: string }`.
Error strings are user-facing sentences.

- `WorkshopId`, `BookingId` (UUID)
- `WorkshopName` (trimmed, collapsed whitespace, 1–80 chars)
- `PotterName` (trimmed, collapsed whitespace, NFKC, 1–50 chars; `display` + `key`)
- `Capacity` (integer; template min potters ≤ capacity ≤ 30)
- `Duration` (one of the offered options, 1–8 hours in 30-minute steps)
- `YearMonth` (`YYYY-MM`)
- workshop start (Vancouver date + time → instant; must be in the future, within a year)
- `CourseTemplate` (JSON → template; the registry maps id → template)
- `NewWorkshop` (whole form → parsed workshop or per-field errors)

## Time

Times are shown in the studio's local time, and daylight saving time should be handled correctly.
We may also want to show times in the potter's own time zone later.

## Security

Follow security best practices throughout: sanitize user input, send secure headers, and protect
against common web attacks such as injection and cross-site scripting.

## Observability

Add logging and monitoring as appropriate so that problems in production can be diagnosed
quickly.

## Testing

- Unit (Vitest, Node): value types, templates, time, month grid, form parsing,
  ICS and QR wrappers.
- Integration (Vitest, Node + Miniflare D1): repositories (capacity, last-spot
  race, duplicates, closing) and routes through `app.request`.
- E2E (Playwright, Chromium desktop + mobile emulation) against a production build
  with a fresh local database: create → calendar → workshop → book → fill → full.
- Pa11y (WCAG2AA) and Lighthouse (performance, accessibility, best practices, SEO
  thresholds) on the main pages.
- Codebase rules: ≤300 lines per TS file, FTA cap, file type allowlist, static SQL,
  no raw HTML, no course-specific code in `src/`, no inline styles, no wheel values
  in CSS (Stylelint with `stylelint-declaration-strict-value`, hex/named/color
  functions only allowed in `tokens.css`).
- Budgets: Vitest run fails over its time budget; Playwright `globalTimeout`.
- Coverage thresholds in Vitest; Stryker mutation testing (`npm run test:mutation`)
  with a break threshold.

## Tooling and commands

- `./bootstrap` (sh, macOS): Node via Homebrew if missing, `npm ci`, Playwright
  Chromium, local migrations, seed data.
- `npm run dev`: apply local migrations, then `vite dev`.
- `npm run test`: typecheck, Biome (formatting and lint), Vitest, Playwright.
- `npm run deploy`: build, apply remote migrations, `wrangler deploy`.
- `npm run db:seed`: sample workshops for the coming weeks.

## Visual design

**Subject:** the organized play calendar for Claybank Studio, a neighborhood
pottery studio. The organizer works from the counter on a laptop; potters scan
the QR code at the counter or on a flyer and sign up on their phones.

**The one bold element: the sign-up sheet.** Every store has a clipboard with
numbered lines. The workshop page draws capacity the same way: one numbered line per
spot, filled lines show potter names, open lines stay blank, and a full workshop
gets a red "Full" stamp. Calendar chips echo it with a spot count ("9 of 16").
Everything around the sheet stays quiet.

**Color tokens**

| Token         | Hex       | Use                                                                   |
| ------------- | --------- | --------------------------------------------------------------------- |
| `--felt`      | `#16453E` | Header band, primary buttons, links (deep teal-green, like a playmat) |
| `--felt-deep` | `#0E2F2A` | Button hover, focus ring                                              |
| `--table`     | `#EEF2F0` | Page background                                                       |
| `--paper`     | `#FFFFFF` | Sheets, forms, calendar cells                                         |
| `--ink`       | `#1D2B28` | Body text                                                             |
| `--ink-soft`  | `#4B5B57` | Secondary text (≥ 7:1 on white)                                       |
| `--rule`      | `#C9D6D2` | Sheet lines, grid lines                                               |
| `--gold`      | `#F2B705` | Today marker, highlights (fill only, never text)                      |
| `--stamp`     | `#B3261E` | "Full" stamp and error text                                           |

Course accents come from each template's `content.color` and are used for chip
borders, tints (`color-mix`), and card frames: Wheel `#5B2A86` (glaze
purple, distinct from Handbuilding red), Raku `#3C5AA7`, Handbuilding
`#C8102E`. Because inline styles are banned and a new course must not need CSS
edits, the Worker serves `GET /courses.css`, generated from the templates:
`.course-<id> { --course-color: <hex>; }` (ids and hex values are parsed, so safe to
emit). Components use `var(--course-color)`.

CSS lives in `public/styles/`: `tokens.css` holds every custom property (the only
file allowed to contain literal colors, font names or scale values), the rest
use `var()`. Form control borders need ≥ 3:1 against white (darker than
`--rule`).

**Type:** Big Shoulders Display (700–800) for the wordmark, page titles, month
name, day numbers, spot numbers and workshop names; never below 20px. Atkinson
Hyperlegible Next (400/700) for everything else, 17px body. Both self-hosted
woff2 (latin subset), `font-display: swap`. Scale ratio 1.25.

**Layout:** content max width 72rem, left aligned. Header band in `--felt` with
the wordmark and two links (Calendar, Create a workshop). Footer carries the studio
address and "All times are Vancouver Time".

- Calendar: month title + previous/next links; a 7-column grid of paper cells
  with day numbers; chips with a 4px course-color left border, time, name, spots.
  Below 700px it becomes an agenda: only days with workshops, each with a date
  heading.
- Workshop page: course art banner, logo, workshop name, facts (when, where, format,
  spots, minimum potters), "Add to calendar", what to bring. Then the sign-up
  sheet beside a booking panel with the QR code, the link, and a Book
  button.
- Booking: phone-first, one field, one big button; full/closed states
  replace the form with a plain explanation.
- Create workshop: pick a course (portrait "cards" framed in the course's color with art
  and logo), then a single-column form with template-driven helper text.

**Principles:** capacity is always visible; course identity only via template
content, never layout; one field and one button for potters; every time labeled
Vancouver; no client JavaScript.

**Avoid (generic tells):** soft grey shadows under identical rounded cards,
ALL-CAPS eyebrow labels, middle-dot metadata strings, arrows appended to links,
monospace data labels, cream + terracotta, near-black + acid accent.

## Out of scope

Payments, email, recurring workshops, editing/cancelling, admin dashboards, auth,
waitlists, rate limiting, dark mode, i18n.
