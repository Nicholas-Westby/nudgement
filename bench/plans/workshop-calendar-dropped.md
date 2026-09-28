# Claybank Studio Workshop Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A server-rendered workshop calendar for one pottery studio: the organizer creates workshops from JSON course templates, potters book by name through a QR link, capacity is enforced atomically in D1, and every workshop has an `.ics` invite.

**Architecture:** One Cloudflare Worker running Hono with `hono/jsx` server rendering (no client JavaScript at all), D1 for workshops and bookings, Workers Static Assets for CSS/fonts/images, course templates bundled from `courses/*.json` with Vite's `import.meta.glob`. Parsed value classes guard every boundary (forms, route params, JSON templates, DB rows).

**Tech Stack:** TypeScript 6.0.3, Hono 4.13.9, Vite 8.3.1 + @cloudflare/vite-plugin 1.60.2, wrangler 4.141.0, D1, temporal-polyfill 1.0.5, qrcode 1.5.4, ical-generator 11.1.1, Vitest 4.1.9 (+ coverage-v8), StrykerJS 10.0.0, Playwright 1.63.0, pa11y 10.0.0, lighthouse 13.5.0, chrome-launcher 1.2.1, fta-cli 3.0.1, stylelint 17.15.0 + stylelint-declaration-strict-value 1.12.1, Biome 2.5.14 (format + lint), jsqr 1.4.0.

**Spec:** `.superpowers/plans/2026-09-26-workshop-calendar-design.md` (read it; it is the authority this plan argues from).

**Research notes (verified prototypes, read when a task points at them):**
`/tmp/agent-scratch/research/` holds `stack.md`, `testing.md`, `a11y-perf.md`, `libs.md`; prototypes sit next to it in `../proto-stack`, `../proto-tests`, `../proto-a11y`, `../proto-libs`; course content and images are in `../content/` (`templates.md`, `manifest.md`, `images/optimized/`).

## Global Constraints

- Node >= 24 (dev machine has 26.5.0), npm, macOS. No Docker, no nix.
- Code is TypeScript (`.ts`/`.tsx`) only. Styles are CSS. Config is JSON/JSONC or TypeScript. SQL lives only in `migrations/`. The `bootstrap` shell script is the only non-TypeScript script. It does only what needs a shell before Node exists: install Node (via Homebrew) and run `npm ci`, then hand off to TypeScript (`npm run setup`, `scripts/setup.ts`) for everything else.
- No client-side JavaScript: no `<script>` tags, no frontend dependencies. Runtime dependencies are exactly: `hono`, `qrcode`, `ical-generator`, `temporal-polyfill`.
- Exact dependency versions (`npm install -E`). Pinned on purpose: `typescript@6.0.3` and `vitest@4.1.9`/`@vitest/coverage-v8@4.1.9`, because TypeScript 7 and Vitest 5 break StrykerJS.
- Parse, don't validate: a value that came from outside (form field, route param, JSON template, DB row) is turned into a parsed type once, at the edge. Value classes have a `private constructor`, a `static parse(input: unknown): Parsed<T>`, and a private field so TypeScript treats them nominally. Core functions accept parsed types, never raw strings for those values. `Parsed<T>`, `ok`, `fail` come from `src/parsed.ts`.
- Temporal comes from `import { Temporal } from "temporal-polyfill"` (Workers has no global `Temporal`). `tsconfig` uses `"lib": ["ES2024"]` so the global is not even typed.
- Store facts come from `STUDIO` in `src/store.ts`: name `Claybank Studio`, address `48 Harbour Road, Victoria, BC V8V 1A1`, time zone `America/Vancouver`, spot limit `30`.
- Instants are stored in D1 as fixed-width UTC strings from `toDbTime()` (`YYYY-MM-DDTHH:mm:ss.sssZ`). The UI labels every time as Vancouver.
- SQL: static strings passed straight to `db.prepare(...)`, values only through `.bind()` with `?N` placeholders. Never build SQL with `${}` or `+`.
- No inline styles anywhere (no `style` attribute, no `<style>` element). No wheel values in CSS: literal colors, font names and scale values live only in `public/styles/tokens.css`; every other CSS file uses `var(--…)`.
- No course-specific code: no course id or course name from `courses/*.json` may appear in `src/` (tests excepted) or in CSS.
- Every `.ts`/`.tsx` file (source and tests) is at most 300 lines and has an FTA score of at most 60.
- Formatting and linting are Biome's job: `npx biome check --write .` fixes, `npx biome check --error-on-warnings .` must pass. Don't silence a lint rule to get code through; fix the code, or explain in your report why a rule is wrong for this codebase.
- Comments explain why, in plain human language. No comments that restate the code, no narrating edits ("now uses X"), no commented-out code.
- Words that must never appear in any file, file name or commit message: interview, interviewer, take-home, take home, takehome, candidate, hiring, coding challenge, timebox.
- Commits: Conventional Commits, subject ≤ 72 characters, lowercase after the colon, imperative, no trailing period; optional body of at most 3 `- ` bullets under 80 characters; no trailers (no Co-Authored-By). Before every commit run the evaluator (see "Committing" below) and fix every `✗`.
- Never commit `.superpowers/`, the requirements file in the repo root, `.dev.vars`, `.wrangler/`, `node_modules/`.
- UI copy: sentence case, plain words, active voice, buttons say exactly what happens, errors say what went wrong and how to fix it without apologizing, no ALL CAPS labels, no middle-dot (`·`) metadata strings, no arrows appended to links, no monospace labels.
- Accessibility: WCAG 2.1 AA. Every input has a `<label>`; field errors are linked with `aria-describedby` and set `aria-invalid="true"`; visible focus; landmarks (`header`, `nav`, `main`, `footer`); images have meaningful `alt` or `alt=""` when decorative.
- Security headers on every Worker response via Hono `secureHeaders` with this CSP: `default-src 'none'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`. Output escaping only through `hono/jsx` (no `raw`, no `dangerouslySetInnerHTML`, no `hono/html`).

### Committing

Run from the repo root before each commit, after `git add` of exactly the files you intend to commit:

```bash
E=~/tools/evaluator/live/evaluate.ts
C=~/tools/evaluator/examples/claybank.json
bun $E . --staged -m "<your message>" --check-files --repo-check --config $C
```

Exit 0 = pass. Fix every `✗` (message, comments, bloated files, test quality). `!` is a warning: fix it when it is right; if a finding is wrong, say so in your report. A warning about more than 800 changed lines is expected only for the commit that adds `package-lock.json`.

## Review Focus

1. Vancouver day boundaries and DST: a workshop at 11:30 PM Vancouver appears on that day in the calendar, not the next UTC day; 2026-03-08 and 2026-11-01 give correct instants and grid days. Tests in Task 4 and Task 9.
2. Duplicate bookings: the same name with different case, spacing or Unicode width counts as a duplicate, and the message covers both a double submit and a namesake. Tests in Task 3 and Task 12.
3. The last spot under concurrency: many simultaneous bookings never exceed capacity. Test in Task 8.
4. Hostile or odd input: 500-character names, whitespace-only names, `<script>` in names (rendered escaped), non-numeric capacity, a format not in the template, a bad UUID in a URL (404, never 500), a POST without an `Origin` header (403). Tests in Tasks 3, 10, 11, 12.
5. Booking for a workshop that already started, doesn't exist, or is full, by POSTing directly and skipping the UI. Tests in Tasks 8 and 12.

## File map

```
bootstrap                                  macOS setup script (Task 1, finished in Task 13)
package.json, package-lock.json            (Task 1)
tsconfig.json                              Worker code, no Node types (Task 1)
tsconfig.node.json                         tests, scripts, configs, with Node types (Task 1)
vite.config.ts, vitest.config.ts           (Task 1)
wrangler.jsonc                             (Task 1; routes added in Task 17)
.gitignore, biome.json
.stylelintrc.json                          (Task 2)
.puppeteerrc.json, playwright.config.ts    (Task 14)
stryker.config.json                        (Task 15)
migrations/0001_create_workshops_and_bookings.sql   (Task 1)
courses/{wheel,raku,handbuilding}.json    course templates (Task 5)
public/_headers                            cache headers for static files (Task 7)
public/favicon.svg, public/fonts/*.woff2   (Task 7)
public/styles/tokens.css                   every design token (Task 7)
public/styles/site.css                     all other styles (Task 7, grown in 9-12)
public/images/courses/<id>/*.webp            template images (Task 5)
src/index.ts                               Worker entry (Task 1)
src/app.tsx                                createApp: middleware, routes, errors (Task 1, 7, 5, 9-12)
src/app-env.ts                             AppEnv, AppDeps, renderer props (Task 1, 7)
src/store.ts, src/parsed.ts                (Task 1)
src/log.ts                                 JSON log lines (Task 7)
src/time.ts                                Vancouver time helpers (Task 4)
src/ids.ts                                 WorkshopId, BookingId (Task 3)
src/calendar/month-grid.ts                 parseYearMonth, monthGrid (Task 4)
src/calendar/calendar-routes.tsx, calendar-page.tsx          (Task 9)
src/workshops/workshop-name.ts, capacity.ts, duration.ts           (Task 3)
src/workshops/workshop.ts                        NewWorkshop, ScheduledWorkshop types (Task 8)
src/workshops/workshops-repository.ts            (Task 8)
src/workshops/invite.ts, qr.ts                (Task 6)
src/workshops/new-workshop-form.ts, new-workshop-routes.tsx, pick-course-page.tsx, new-workshop-page.tsx (Task 10)
src/workshops/workshop-routes.tsx, workshop-page.tsx, sign-up-sheet.tsx (Task 11)
src/courses/course-template.ts, courses.ts, course-styles.ts          (Task 5)
src/bookings/potter-name.ts           (Task 3)
src/bookings/bookings-repository.ts                  (Task 8)
src/bookings/booking-routes.tsx, book-page.tsx, booked-page.tsx (Task 12)
src/views/layout.tsx, not-found-page.tsx, error-page.tsx, facts.tsx (Task 7, 11)
scripts/seed.ts                            (Task 13)
tests/support/suite-budget-reporter.ts     (Task 1)
tests/support/test-database.ts, test-app.ts, fixtures.ts       (Task 8)
tests/codebase/*.test.ts                   codebase rules (Task 2)
tests/e2e/*.spec.ts, tests/e2e/support/*   (Task 14)
types/pa11y.d.ts                           (Task 14)
docs/screenshots/*.png, README.md          (Task 16)
```

Colocated tests: `foo.ts` is tested by `foo.test.ts` next to it. Tests that need Node APIs or a database import helpers from `tests/support/`.

Shared test clock: `FIXED_NOW = Temporal.Instant.from("2026-09-26T19:00:00Z")` (noon PDT on Saturday, September 26, 2026), exported from `tests/support/fixtures.ts` once Task 8 creates it; earlier tasks define their own local constant with the same value.

---

### Task 1: Scaffold the Worker app and toolchain

**Files:**

- Create: `package.json`, `package-lock.json` (via npm), `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `vitest.config.ts`, `wrangler.jsonc`, `.gitignore`, `biome.json`, `bootstrap`, `README.md`
- Create: `migrations/0001_create_workshops_and_bookings.sql`
- Create: `src/index.ts`, `src/app.tsx`, `src/app-env.ts`, `src/store.ts`, `src/parsed.ts`
- Create: `tests/support/suite-budget-reporter.ts`
- Test: `src/app.test.ts`, `src/parsed.test.ts`, `tests/support/suite-budget-reporter.test.ts`

**Interfaces:**

- Consumes: nothing (first task). The production D1 database already exists: name `claybankstudio`, id `62efb06d-8ad3-4091-aa81-192e6bd1b1ea`.
- Produces:
  - `src/parsed.ts`: `type Parsed<T> = Success<T> | Failure`, `type Success<T> = { readonly ok: true; readonly value: T }`, `type Failure = { readonly ok: false; readonly error: string }`, `ok<T>(value: T): Success<T>`, `fail(error: string): Failure`
  - `src/store.ts`: `STUDIO` constant (`name`, `address`, `timeZone`, `spotLimit`)
  - `src/app-env.ts`: `type AppEnv = { Bindings: { DB: D1Database } }`, `type AppDeps = { now: () => Temporal.Instant }`
  - `src/app.tsx`: `createApp(deps: AppDeps): Hono<AppEnv>`
  - npm scripts: `dev`, `build`, `preview`, `deploy`, `typecheck`, `format`, `test`, `test:unit`, `db:migrate`
  - The D1 schema (tables `workshops`, `bookings`)

- [ ] **Step 1: Create `package.json` and install exact versions**

```json
{
  "name": "claybankstudio",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "scripts": {
    "dev": "npm run db:migrate && vite dev",
    "build": "vite build",
    "preview": "vite preview",
    "deploy": "vite build && wrangler d1 migrations apply DB --remote && wrangler deploy",
    "typecheck": "tsc -p tsconfig.json && tsc -p tsconfig.node.json",
    "format": "biome check --write .",
    "test": "npm run typecheck && biome check --error-on-warnings . && vitest run --coverage",
    "test:unit": "vitest run",
    "db:migrate": "wrangler d1 migrations apply DB --local"
  }
}
```

Then install (exact versions, all at once so the lockfile is written once):

```bash
npm install -E hono@4.13.9 qrcode@1.5.4 ical-generator@11.1.1 temporal-polyfill@1.0.5
npm install -E -D typescript@6.0.3 vite@8.3.1 @cloudflare/vite-plugin@1.60.2 wrangler@4.141.0 \
  @cloudflare/workers-types@5.20260927.1 @types/node@26.6.3 @types/qrcode@1.5.6 \
  vitest@4.1.9 @vitest/coverage-v8@4.1.9 @biomejs/biome@2.5.14 fta-cli@3.0.1 \
  stylelint@17.15.0 stylelint-declaration-strict-value@1.12.1 \
  @stryker-mutator/core@10.0.0 @stryker-mutator/vitest-runner@10.0.0 @stryker-mutator/typescript-checker@10.0.0 \
  @playwright/test@1.63.0 pa11y@10.0.0 lighthouse@13.5.0 chrome-launcher@1.2.1 jsqr@1.4.0 \
  tsx@4.23.15
```

`pa11y` pulls `puppeteer`, whose postinstall downloads Chrome. Create `.puppeteerrc.json` containing `{ "skipDownload": true }` before installing and commit it: Pa11y will reuse Playwright's Chromium (Task 14), so a second browser download is waste. `tsx` runs `scripts/seed.ts` in Task 13 (plain Node can't resolve the extensionless imports in `src/`).

- [ ] **Step 2: TypeScript configs**

`tsconfig.json` (Worker code only; no Node types, so Worker code can't use Node APIs by accident):

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "lib": ["ES2024"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["@cloudflare/workers-types", "vite/client"],
    "jsx": "react-jsx",
    "jsxImportSource": "hono/jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts", "src/**/*.test.tsx"]
}
```

`tsconfig.node.json` (tests, scripts, tool configs):

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "types": ["@cloudflare/workers-types", "vite/client", "node"],
    "allowImportingTsExtensions": true
  },
  "include": ["src/**/*.test.ts", "src/**/*.test.tsx", "tests", "scripts", "types", "*.config.ts"],
  "exclude": []
}
```

If `vite/client` or `@cloudflare/workers-types` together with `node` produce conflicts under TypeScript 6.0.3, fix it in these files and say how in your report.

- [ ] **Step 3: Vite, Vitest, wrangler, Biome, gitignore**

`vite.config.ts`:

```ts
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [cloudflare()],
});
```

`vitest.config.ts` (plain Node; no Cloudflare plugin, so tests run in Node and Stryker can instrument them):

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.ts"],
    reporters: ["default", ["./tests/support/suite-budget-reporter.ts", { budgetMs: 30_000 }]],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/index.ts"],
      reporter: ["text-summary", "html"],
      thresholds: { statements: 95, branches: 90, functions: 95, lines: 95 },
    },
  },
});
```

`wrangler.jsonc`:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "claybankstudio",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-25",
  "observability": { "enabled": true },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "claybankstudio",
      "database_id": "62efb06d-8ad3-4091-aa81-192e6bd1b1ea",
      "migrations_dir": "migrations",
    },
  ],
}
```

`.gitignore`:

```
node_modules/
dist/
.wrangler/
coverage/
reports/
.stryker-tmp/
test-results/
playwright-report/
.dev.vars
.DS_Store
```

`biome.json` (Biome formats and lints TypeScript, TSX, JSON and CSS; it reads git's ignore
rules, including `.git/info/exclude`, so local-only files are never touched):

```json
{
  "$schema": "./node_modules/@biomejs/biome/configuration_schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": { "includes": ["**", "!package-lock.json"] },
  "formatter": { "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "linter": { "enabled": true, "rules": { "preset": "recommended" } },
  "assist": { "enabled": true }
}
```

- [ ] **Step 4: The schema migration**

`migrations/0001_create_workshops_and_bookings.sql`:

```sql
-- Capacity lives on the workshop; the head count is always derived from booking rows.
CREATE TABLE workshops (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  course_id TEXT NOT NULL,
  course_name TEXT NOT NULL,
  format TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 30),
  min_potters INTEGER NOT NULL CHECK (min_potters BETWEEN 1 AND capacity),
  created_at TEXT NOT NULL,
  CHECK (ends_at > starts_at)
);

CREATE INDEX workshops_by_start ON workshops (starts_at);

CREATE TABLE bookings (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL REFERENCES workshops (id),
  potter_name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  booked_at TEXT NOT NULL,
  UNIQUE (workshop_id, name_key)
);
```

Run `npm run db:migrate` and confirm it applies against the local database without prompting.

- [ ] **Step 5: Write the failing tests**

`src/parsed.test.ts`:

```ts
import { expect, it } from "vitest";
import { fail, ok } from "./parsed";

it("wraps a parsed value", () => {
  expect(ok(42)).toEqual({ ok: true, value: 42 });
});

it("carries a message a person can act on", () => {
  expect(fail("Enter your name.")).toEqual({ ok: false, error: "Enter your name." });
});
```

`src/app.test.ts`:

```ts
import { Temporal } from "temporal-polyfill";
import { expect, it } from "vitest";
import { createApp } from "./app";

const app = createApp({ now: () => Temporal.Instant.from("2026-09-26T19:00:00Z") });

it("serves the home page as HTML", async () => {
  const response = await app.request("/");
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toMatch(/^text\/html/);
  expect(await response.text()).toContain("Claybank Studio");
});
```

`tests/support/suite-budget-reporter.test.ts`:

```ts
import { afterEach, expect, it, vi } from "vitest";
import SuiteBudgetReporter from "./suite-budget-reporter";

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

function runFor(elapsedMs: number, reason: "passed" | "failed" = "passed") {
  let now = 0;
  const reporter = new SuiteBudgetReporter({ budgetMs: 1_000, now: () => now });
  reporter.onTestRunStart();
  now = elapsedMs;
  reporter.onTestRunEnd([], [], reason);
}

it("fails a passing run that went over its time budget", () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  runFor(1_500);
  expect(process.exitCode).toBe(1);
  expect(error).toHaveBeenCalledWith(expect.stringContaining("1500 ms"));
});

it("leaves a run inside its budget alone", () => {
  runFor(900);
  expect(process.exitCode).toBeUndefined();
});

it("does not pile a budget failure onto a run that already failed", () => {
  runFor(1_500, "failed");
  expect(process.exitCode).toBeUndefined();
});
```

Run: `npx vitest run` — expect failures (modules missing).

- [ ] **Step 6: Implement**

`src/parsed.ts`:

```ts
// Parsers return one of these instead of throwing, so every caller has to decide
// what to do with bad input. The error is a sentence we can show to a person.
export type Success<T> = { readonly ok: true; readonly value: T };
export type Failure = { readonly ok: false; readonly error: string };
export type Parsed<T> = Success<T> | Failure;

export function ok<T>(value: T): Success<T> {
  return { ok: true, value };
}

export function fail(error: string): Failure {
  return { ok: false, error };
}
```

`src/store.ts`:

```ts
// The single store this app schedules for. Every time on the site is shown in its time zone.
export const STUDIO = {
  name: "Claybank Studio",
  address: "48 Harbour Road, Victoria, BC V8V 1A1",
  timeZone: "America/Vancouver",
  spotLimit: 30,
} as const;
```

`src/app-env.ts`:

```ts
import type { Temporal } from "temporal-polyfill";

export type AppEnv = { Bindings: { DB: D1Database } };

// Injected so tests can pin the clock.
export type AppDeps = { now: () => Temporal.Instant };
```

`src/app.tsx` (Task 7 replaces the body of `/` with the real layout; Task 9 with the calendar):

```tsx
import { Hono } from "hono";
import type { AppDeps, AppEnv } from "./app-env";
import { STUDIO } from "./store";

export function createApp(_deps: AppDeps) {
  const app = new Hono<AppEnv>();
  app.get("/", (c) => c.html(<h1>{STUDIO.name}</h1>));
  return app;
}
```

`src/index.ts`:

```ts
import { Temporal } from "temporal-polyfill";
import { createApp } from "./app";

export default createApp({ now: () => Temporal.Now.instant() });
```

`tests/support/suite-budget-reporter.ts` (Vitest 4.1.9 `Reporter` interface; check the exact method signatures in `node_modules/vitest` and match them):

```ts
import type { Reporter, TestModule, TestRunEndReason } from "vitest/node";

type Options = { budgetMs?: number; now?: () => number };

// A suite that gets slow stops being run before every commit, so the whole run has a budget.
// Vitest constructs reporters as `new Reporter(options)`, with `{}` when the config passes
// none, so settings come in as one options object.
export default class SuiteBudgetReporter implements Reporter {
  private startedAt = 0;
  private readonly budgetMs: number;
  private readonly now: () => number;

  constructor(options: Options = {}) {
    this.budgetMs = options.budgetMs ?? 30_000;
    this.now = options.now ?? (() => performance.now());
  }

  onTestRunStart(): void {
    this.startedAt = this.now();
  }

  onTestRunEnd(
    _modules: ReadonlyArray<TestModule>,
    _errors: ReadonlyArray<unknown>,
    reason: TestRunEndReason,
  ): void {
    const elapsed = Math.round(this.now() - this.startedAt);
    if (reason === "passed" && elapsed > this.budgetMs) {
      console.error(
        `The test run took ${elapsed} ms, over its ${this.budgetMs} ms budget. Speed up the slowest tests.`,
      );
      process.exitCode = 1;
    }
  }
}
```

- [ ] **Step 7: Run the tests and the toolchain**

```bash
npx vitest run                 # all pass
npm run typecheck              # exit 0
npx biome check --write . && npx biome check .
npm run build                  # vite build succeeds, writes dist/
npx wrangler deploy --dry-run  # uses the redirected config from the build, lists env.DB
```

Also start `npx vite dev --port 5173`, check that `curl -s localhost:5173/` shows `Claybank Studio`, then stop the server.

- [ ] **Step 8: `bootstrap` and a minimal README**

`bootstrap` (make it executable with `chmod +x bootstrap`):

```sh
#!/bin/sh
# Sets up a Mac to run Claybank Studio: Node, npm packages, the test browser
# and a local database.
set -eu
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 24 ]; then
  if ! command -v brew >/dev/null 2>&1; then
    echo "Node 24 or newer is needed. Install Homebrew from https://brew.sh, then run ./bootstrap again." >&2
    exit 1
  fi
  brew install node
fi

npm ci
npx playwright install chromium
npm run db:migrate
```

`README.md` (Task 16 rewrites it; keep it this short for now):

```markdown
# Claybank Studio

Workshop calendar for Claybank Studio's in-store pottery workshops.

- `./bootstrap` installs Node (via Homebrew) and everything else on a Mac
- `npm run dev` runs the app locally
- `npm run test` runs every check
- `npm run deploy` deploys to Cloudflare
```

Run `./bootstrap` once to prove it works on this machine (Node is already installed, so it skips Homebrew).

- [ ] **Step 9: Commit**

```bash
git add -A
# run the evaluator (see "Committing"); README findings about screenshots are expected until Task 16
git commit -m "chore: scaffold the worker app with hono, vite and d1"
```

---

### Task 2: Codebase rules as tests

**Files:**

- Create: `.stylelintrc.json`
- Create: `tests/codebase/project-files.ts`
- Test: `tests/codebase/file-length.test.ts`, `tests/codebase/fta.test.ts`, `tests/codebase/file-types.test.ts`, `tests/codebase/source-rules.test.ts`, `tests/codebase/css-values.test.ts`

**Interfaces:**

- Consumes: the scaffold from Task 1 (git repo, vitest config).
- Produces: `listProjectFiles(): string[]` and `readProjectFile(path: string): string` in `tests/codebase/project-files.ts`. Rules every later task must satisfy.

Every rule gets two kinds of tests: a self-test proving the checker catches a bad sample (so the rule can't pass vacuously), and the real check over the project.

- [ ] **Step 1: Project file listing**

`tests/codebase/project-files.ts`:

```ts
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

// Committed files plus new files that aren't ignored, so rules apply before the first commit too.
export function listProjectFiles(): string[] {
  const output = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { encoding: "utf8" },
  );
  return output.split("\0").filter((path) => path !== "" && existsSync(path));
}

export function readProjectFile(path: string): string {
  return readFileSync(path, "utf8");
}
```

- [ ] **Step 2: File length rule**

`tests/codebase/file-length.test.ts`: export nothing; one `countLines(text)` helper (number of `\n`-separated lines, ignoring one trailing newline), a self-test (`countLines("a\nb\n") === 2`), and the project check: every file ending in `.ts` or `.tsx` has at most 300 lines. The failure message must list `path: lines` for each offender.

- [ ] **Step 3: FTA rule**

`tests/codebase/fta.test.ts`: `import { runFta } from "fta-cli"`. `runFta(dir, { json: true })` returns a JSON string of `{ file_name, fta_score, assessment, ... }[]` (always pass the second argument; the one-argument form throws). Check the directories `src`, `tests`, `scripts` (skip any that don't exist). Cap: `MAX_FTA_SCORE = 60` (FTA's own "needs improvement" line). Failure message lists `dir/file_name: score`. Self-test: write a generated, deeply branching TypeScript file (for example 40 nested `if` statements in one function) into a fresh `mkdtempSync(join(tmpdir(), "fta-"))` directory, run FTA on it, and expect its score to be above 60; remove the directory afterwards. See `research/testing.md` section 3 for the JSON shape.

- [ ] **Step 4: File type rule**

`tests/codebase/file-types.test.ts`: allowed extensions `.ts .tsx .css .html .json .jsonc .md .sql .webp .png .svg .woff2`; allowed extension-less files by exact path `bootstrap`, `.gitignore`, `public/_headers`. Extra rule: `.sql` files only under `migrations/`. Self-test the matcher with `["src/a.js", "scripts/x.py", "deploy.sh", "src/b.ts", "migrations/0001_x.sql", "src/query.sql"]` → rejects `src/a.js`, `scripts/x.py`, `deploy.sh`, `src/query.sql`. Project check: no rejected files, message lists them.

- [ ] **Step 5: Source rules**

`tests/codebase/source-rules.test.ts` holds five table-driven rules. Each rule is `{ name, appliesTo(path): boolean, findProblems(source): string[] }` and each has `bad` and `good` samples in the self-tests.

1. **No inline styles.** Applies to non-test `src/**/*.{ts,tsx}` and `public/**/*.{html,svg}`. Problems: any match of `/\bstyle\s*=/` or `/<style[\s>]/i`. Bad samples: `<p style="color: red">`, `<div style={{ color: "red" }}>`, `<style>p{}</style>`. Good: `<p class="note">`.
2. **No raw HTML.** Applies to non-test `src/**/*.{ts,tsx}`. Problems: `dangerouslySetInnerHTML`, `/\braw\(/`, `/from\s+["']hono\/html["']/`. Bad: `raw("<b>")`, `import { html } from "hono/html"`. Good: `<b>{name}</b>`.
3. **Static SQL only.** Applies to non-test `src/**/*.{ts,tsx}`. Every `.prepare(` must be followed by exactly one string literal (`"…"`, `'…'`, or a backtick literal containing no `${`) and then `)`. Anything else is a problem (report the line). Also forbid `.exec(` on a database in `src/`. Bad: ``db.prepare(`SELECT * FROM workshops WHERE id = '${id}'`)``, `db.prepare("SELECT " + columns)`, `db.prepare(sql)`. Good: `db.prepare("SELECT 1")`, and a multi-line backtick literal with `?1` placeholders followed by `.bind(id)`.
4. **Course-neutral code.** Applies to non-test `src/**/*.{ts,tsx}` and `public/styles/*.css`. Read `courses/*.json` (none may exist yet; then the project check passes trivially but the self-test still runs). For each course: its id (file name without `.json`) as a quoted string (`"wheel"`, `'wheel'`, `` `wheel` ``) or as a `course-<id>` CSS class, and its `name` value anywhere (case-insensitive). Self-test with the id `wheel` and name `Wheel Throwing`: bad `if (course.id === "wheel")`, `.course-wheel { }`, `title = "Wheel Throwing"`; good `// no wheel values here` and `course.id === id`.
5. **No invisible characters.** Applies to every project text file (`.ts .tsx .css .json .jsonc .md .sql .html .svg` and `bootstrap`). Problems: any raw character in the ranges U+0000–U+0008, U+000B, U+000C, U+000E–U+001F, U+007F, U+00A0, U+200B–U+200F, U+2028–U+202F, U+2060–U+2069, U+FEFF (tab, newline and carriage return are fine); report `path:line`. Tests and regexes that need such characters must spell them as escapes (a backslash followed by `u202e`, for example). This blocks "Trojan Source" bidirectional-text tricks and accidental non-breaking spaces. Self-test: build the bad samples at runtime with `String.fromCodePoint(0x202e)`, `String.fromCodePoint(0x00a0)` and `String.fromCodePoint(0)`, so the test file itself stays clean; good sample: the six-character escape text for U+202E.

Warning for anyone writing these files: tool inputs are JSON, so typing a backslash-u escape into file content can arrive as the real invisible character. After writing a file that contains escapes, grep it (`grep -nP '[\x{00a0}\x{200b}-\x{200f}\x{2028}-\x{202f}\x{2060}-\x{2069}]' file`, plus a check for control characters) and fix any raw characters.

- [ ] **Step 6: CSS value rule (Stylelint)**

`.stylelintrc.json` (tune option names against `node_modules/stylelint-declaration-strict-value/README.md`; keep the intent):

```json
{
  "plugins": ["stylelint-declaration-strict-value"],
  "rules": {
    "color-no-hex": true,
    "color-named": "never",
    "function-disallowed-list": [
      "rgb",
      "rgba",
      "hsl",
      "hsla",
      "hwb",
      "lab",
      "lch",
      "oklab",
      "oklch",
      "color"
    ],
    "declaration-no-important": true,
    "scale-unlimited/declaration-strict-value": [
      [
        "/color$/",
        "fill",
        "stroke",
        "background-color",
        "box-shadow",
        "text-shadow",
        "font-family",
        "font-size",
        "font-weight",
        "line-height",
        "letter-spacing",
        "/^margin/",
        "/^padding/",
        "gap",
        "row-gap",
        "column-gap",
        "/radius$/",
        "z-index"
      ],
      {
        "expandShorthand": true,
        "ignoreValues": [
          "0",
          "auto",
          "inherit",
          "initial",
          "unset",
          "none",
          "transparent",
          "currentColor",
          "normal"
        ]
      }
    ]
  },
  "overrides": [
    {
      "files": ["public/styles/tokens.css"],
      "rules": {
        "color-no-hex": null,
        "function-disallowed-list": null,
        "scale-unlimited/declaration-strict-value": null
      }
    }
  ]
}
```

`tests/codebase/css-values.test.ts`: use `stylelint.lint({ code, codeFilename, configFile: ".stylelintrc.json" })` for samples and `stylelint.lint({ files: "public/styles/**/*.css", configFile: ".stylelintrc.json", allowEmptyInput: true })` for the project. Each of these samples (as `public/styles/site.css`) must produce at least one warning: `.a { color: #fff; }`, `.a { color: red; }`, `.a { color: rgb(0 0 0); }`, `.a { font-family: Georgia, serif; }`, `.a { padding: 12px; }`, `.a { font-size: 18px; }`, `.a { border: 1px solid #000; }`, `.a { margin: 0 8px; }`, `.a { color: var(--ink) !important; }`. This must produce none: `.a { color: var(--ink); padding: var(--space-2) 0; border: 1px solid var(--rule); background: color-mix(in srgb, var(--course-color) 12%, var(--paper)); margin: 0 auto; }`. And `:root { --ink: #1d2b28; --font-body: "Atkinson Hyperlegible Next", sans-serif; }` linted as `public/styles/tokens.css` produces none. The project check expects zero warnings and prints each as `file:line rule text`.

- [ ] **Step 7: Run and commit**

```bash
npx vitest run tests/codebase   # all pass
npm run typecheck && npx biome check .
git add -A   # after the evaluator passes
git commit -m "test: enforce file size, complexity, file types and style rules"
```

---

### Task 3: Parsed value types for workshops and potters

**Files:**

- Modify: `src/parsed.ts` (add `tidyText`, `wholeNumber`), `src/parsed.test.ts`
- Create: `src/ids.ts`, `src/workshops/workshop-name.ts`, `src/workshops/capacity.ts`, `src/workshops/duration.ts`, `src/bookings/potter-name.ts`
- Test: `src/ids.test.ts`, `src/workshops/workshop-name.test.ts`, `src/workshops/capacity.test.ts`, `src/workshops/duration.test.ts`, `src/bookings/potter-name.test.ts`

**Interfaces:**

- Consumes: `Parsed`, `ok`, `fail` (`src/parsed.ts`), `STUDIO.spotLimit` (`src/store.ts`).
- Produces (later tasks use exactly these names):
  - `tidyText(input: string): string` — NFKC-normalizes, collapses every run of whitespace to one space, trims
  - `wholeNumber(input: unknown): number | undefined` — integer from a number or an all-digits string (surrounding spaces allowed), else `undefined`
  - `class WorkshopId { static generate(): WorkshopId; static parse(input: unknown): Parsed<WorkshopId>; toString(): string }`
  - `class BookingId` with the same three members
  - `class WorkshopName { static parse(input: unknown): Parsed<WorkshopName>; get value(): string }`
  - `class Capacity { static parse(input: unknown, minPotters: number): Parsed<Capacity>; get value(): number }`
  - `class Duration { static readonly options: readonly Duration[]; static parse(input: unknown): Parsed<Duration>; get minutes(): number; get label(): string }`
  - `class PotterName { static parse(input: unknown): Parsed<PotterName>; get display(): string; get key(): string }`

Every class keeps its data in a `private readonly` constructor parameter, which makes TypeScript treat the classes nominally (an `WorkshopId` can't be passed where a `BookingId` is expected). Messages below are exact; they are shown to people.

- [ ] **Step 1: Write the failing tests**

Table-driven with `it.each`. Cover exactly these cases (assert `.ok` and the exact `error` or value):

`tidyText`: `"  Friday   Night\tWheel \n"` → `"Friday Night Wheel"`; `"ｊａｎｅ"` (full-width) → `"jane"`; `"a\u00a0b"` → `"a b"`.
`wholeNumber`: `8` → 8; `"16"` → 16; `" 16 "` → 16; `"16.5"`, `"1e2"`, `"-3"`, `""`, `"abc"`, `8.5`, `null`, `undefined` → `undefined`.

`WorkshopId` / `BookingId`: `generate()` returns a value whose `toString()` matches the UUID shape and parses back; `parse("3f1c2b9e-8a4d-4c1e-9b7a-2d5e6f708192")` ok; `parse("3F1C2B9E-…")` (uppercase), `parse("not-a-uuid")`, `parse("")`, `parse(42)`, `parse(undefined)` fail. Error text: `WorkshopId` → `"That link doesn't match any workshop."`, `BookingId` → `"That link doesn't match any booking."`.

`WorkshopName` (max 80): `"  Friday   Night Wheel "` → value `"Friday Night Wheel"`; `""`, `"   "`, `undefined`, `12` → `"Give the workshop a name."`; 81 letters → `"Keep the name to 80 characters or fewer."`; exactly 80 → ok; `"FNM\u0000"` and `"FNM\u202e"` → `"Remove the unusual characters from the name."`; `"<script>alert(1)</script>"` → ok, stored as typed (escaping is the view's job); `"Raku 🔥 League"` → ok.

`PotterName` (max 50): `"  Alex   Kim "` → display `"Alex Kim"`, key `"alex kim"`; `"ALEX KIM"` and `"alex\u00a0kim"` and full-width `"Ａｌｅｘ Ｋｉｍ"` all have key `"alex kim"`; `""`, `"   "`, `undefined` → `"Enter your name."`; 51 letters → `"Keep your name to 50 characters or fewer."`; `"Alex\u0007"` → `"Remove the unusual characters from your name."`; 500 characters → the length error, not a crash.

`Capacity` with `minPotters` 4 (store limit 30): `"16"` → 16; `16` → 16; `"4"` → 4; `"30"` → 30; `""` and `undefined` → `"Enter the number of spots."`; `"ten"`, `"12.5"`, `"-1"` → `"Enter the number of spots as a whole number."`; `"3"` → `"This course needs at least 4 potters, so set at least 4 spots."`; `"31"` → `"The studio has 30 spots, so set 30 or fewer."`.

`Duration`: `options` minutes are exactly `[60, 90, 120, …, 480]` (15 entries); `parse("180")` and `parse(180)` → minutes 180; `parse("45")`, `parse("500")`, `parse("")`, `parse(undefined)`, `parse("ninety")` → `"Pick how long the workshop runs."`; labels: 60 → `"1 hour"`, 90 → `"1 hour 30 minutes"`, 120 → `"2 hours"`, 210 → `"3 hours 30 minutes"`.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/parsed.test.ts src/ids.test.ts src/workshops src/bookings`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement**

Add to `src/parsed.ts`:

```ts
export function tidyText(input: string): string {
  return input.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

export function wholeNumber(input: unknown): number | undefined {
  if (typeof input === "number") return Number.isInteger(input) ? input : undefined;
  if (typeof input === "string" && /^\s*\d+\s*$/.test(input)) return Number(input);
  return undefined;
}
```

`src/ids.ts`:

```ts
import { fail, ok, type Parsed } from "./parsed";

// crypto.randomUUID() only produces lowercase version 4 ids.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class WorkshopId {
  private constructor(private readonly id: string) {}

  static generate(): WorkshopId {
    return new WorkshopId(crypto.randomUUID());
  }

  static parse(input: unknown): Parsed<WorkshopId> {
    return typeof input === "string" && UUID.test(input)
      ? ok(new WorkshopId(input))
      : fail("That link doesn't match any workshop.");
  }

  toString(): string {
    return this.id;
  }
}
```

`BookingId` is the same class with its own name and message. (The sample id in the tests is a valid version 4 UUID.)

`src/workshops/workshop-name.ts`:

```ts
import { fail, ok, tidyText, type Parsed } from "../parsed";

const MAX_LENGTH = 80;
// Control characters and bidirectional overrides can make a name render misleadingly.
const UNUSUAL = /[\p{Cc}\u202a-\u202e\u2066-\u2069]/u;

export class WorkshopName {
  private constructor(private readonly name: string) {}

  static parse(input: unknown): Parsed<WorkshopName> {
    const name = typeof input === "string" ? tidyText(input) : "";
    if (name === "") return fail("Give the workshop a name.");
    if (UNUSUAL.test(name)) return fail("Remove the unusual characters from the name.");
    if ([...name].length > MAX_LENGTH) {
      return fail(`Keep the name to ${MAX_LENGTH} characters or fewer.`);
    }
    return ok(new WorkshopName(name));
  }

  get value(): string {
    return this.name;
  }
}
```

`src/bookings/potter-name.ts` follows the same shape (max 50, messages above) and adds:

```ts
  // Bookings that differ only by case, spacing or character width are the same name.
  get key(): string {
    return this.name.toLocaleLowerCase("en-US");
  }
```

with `display` returning the tidied name. Share the `UNUSUAL` pattern by exporting it from `src/parsed.ts` as `UNUSUAL_CHARACTERS` rather than copying it.

`src/workshops/capacity.ts`:

```ts
import { fail, ok, wholeNumber, type Parsed } from "../parsed";
import { STUDIO } from "../store";

export class Capacity {
  private constructor(private readonly spots: number) {}

  // The floor comes from the course template: a workshop that can't reach its minimum never starts.
  static parse(input: unknown, minPotters: number): Parsed<Capacity> {
    if (input === undefined || (typeof input === "string" && input.trim() === "")) {
      return fail("Enter the number of spots.");
    }
    const spots = wholeNumber(input);
    if (spots === undefined) return fail("Enter the number of spots as a whole number.");
    if (spots < minPotters) {
      return fail(
        `This course needs at least ${minPotters} potters, so set at least ${minPotters} spots.`,
      );
    }
    if (spots > STUDIO.spotLimit) {
      return fail(`The studio has ${STUDIO.spotLimit} spots, so set ${STUDIO.spotLimit} or fewer.`);
    }
    return ok(new Capacity(spots));
  }

  get value(): number {
    return this.spots;
  }
}
```

`src/workshops/duration.ts`:

```ts
import { fail, ok, wholeNumber, type Parsed } from "../parsed";

export class Duration {
  private constructor(private readonly totalMinutes: number) {}

  // One to eight hours in half-hour steps covers every workshop the studio runs.
  static readonly options: readonly Duration[] = Array.from(
    { length: 15 },
    (_, step) => new Duration(60 + step * 30),
  );

  static parse(input: unknown): Parsed<Duration> {
    const minutes = wholeNumber(input);
    const match = Duration.options.find((option) => option.minutes === minutes);
    return match ? ok(match) : fail("Pick how long the workshop runs.");
  }

  get minutes(): number {
    return this.totalMinutes;
  }

  get label(): string {
    const hours = Math.floor(this.totalMinutes / 60);
    const minutes = this.totalMinutes % 60;
    const hourText = `${hours} ${hours === 1 ? "hour" : "hours"}`;
    return minutes === 0 ? hourText : `${hourText} ${minutes} minutes`;
  }
}
```

- [ ] **Step 4: Run tests, typecheck, codebase rules**

Run: `npx vitest run && npm run typecheck && npx biome check .`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/parsed.ts src/parsed.test.ts src/ids.ts src/ids.test.ts src/workshops src/bookings
git commit -m "feat(workshops): parse workshop and potter fields into value types"
```

---

### Task 4: Vancouver time and the month grid

**Files:**

- Create: `src/time.ts`, `src/calendar/month-grid.ts`
- Test: `src/time.test.ts`, `src/calendar/month-grid.test.ts`

**Interfaces:**

- Consumes: `Parsed`, `ok`, `fail`; `STUDIO.timeZone`; `Temporal` from `temporal-polyfill`.
- Produces:
  - `studioTime(instant: Temporal.Instant): Temporal.ZonedDateTime`
  - `studioToday(now: Temporal.Instant): Temporal.PlainDate`
  - `startOfStudioDay(date: Temporal.PlainDate): Temporal.Instant`
  - `parseStudioDate(input: unknown): Parsed<Temporal.PlainDate>` (`"YYYY-MM-DD"`, message `"Pick a date."`)
  - `parseClockTime(input: unknown): Parsed<Temporal.PlainTime>` (`"HH:MM"`, message `"Pick a start time."`)
  - `studioInstant(date: Temporal.PlainDate, time: Temporal.PlainTime): Temporal.Instant` (that wall-clock time in the studio's zone)
  - `formatStudioDate(instant): string` → `"Friday, October 2, 2026"`
  - `formatStudioTime(instant): string` → `"7:00 PM"`
  - `formatStudioTimeRange(start, end): string` → `"7:00 – 10:00 PM PDT"` (Intl `formatRange`)
  - `formatStudioZone(instant): string` → `"PDT"` or `"PST"`
  - `toDbTime(instant): string` → `"2026-10-03T02:00:00.000Z"` (always 24 characters); `fromDbTime(text: string): Temporal.Instant`
  - `parseYearMonth(input: unknown): Parsed<Temporal.PlainYearMonth>`
  - `type CalendarDay = { readonly date: Temporal.PlainDate; readonly inMonth: boolean; readonly isToday: boolean }`
  - `monthGrid(month: Temporal.PlainYearMonth, today: Temporal.PlainDate): CalendarDay[][]` — weeks Sunday to Saturday
  - `monthName(month: Temporal.PlainYearMonth): string` → `"October 2026"`

- [ ] **Step 1: Write the failing tests**

`src/time.test.ts` (Intl output contains narrow no-break spaces `\u202f` before AM/PM and thin spaces around the en dash; build expected strings with those characters, or normalize `[\u2009\u202f]` to a space in one helper and say so in the test):

- `studioInstant(2026-10-02, 19:00)` → `2026-10-03T02:00:00Z` (PDT, UTC−7)
- `studioInstant(2026-12-05, 13:00)` → `2026-12-05T21:00:00Z` (PST, UTC−8)
- `studioInstant(2026-03-08, 02:30)` → `2026-03-08T10:30:00Z` (the skipped hour moves forward to 3:30 PDT)
- `studioInstant(2026-11-01, 01:30)` → `2026-11-01T08:30:00Z` (the repeated hour takes the first, PDT, occurrence)
- `parseStudioDate("2026-10-02")` ok; `"2026-02-30"`, `"2026-13-01"`, `"10/02/2026"`, `""`, `undefined` → `"Pick a date."`
- `parseClockTime("19:00")` ok; `"25:00"`, `"7pm"`, `"7:00"`, `""`, `undefined` → `"Pick a start time."`
- `studioToday(2026-10-03T06:59:00Z)` → `2026-10-02`; `studioToday(2026-10-03T07:00:00Z)` → `2026-10-03`
- `startOfStudioDay(2026-03-08)` → `2026-03-08T08:00:00Z`; `startOfStudioDay(2026-11-01)` → `2026-11-01T07:00:00Z`; `startOfStudioDay(2026-11-02)` → `2026-11-02T08:00:00Z`
- `formatStudioDate(2026-10-03T02:00:00Z)` → `"Friday, October 2, 2026"`; `formatStudioTime` of it → `"7:00 PM"`; `formatStudioZone` → `"PDT"`, and of `2026-12-05T21:00:00Z` → `"PST"`
- `formatStudioTimeRange(2026-10-03T02:00Z, 2026-10-03T05:00Z)` → `"7:00 – 10:00 PM PDT"`; `(2026-10-03T18:00Z, 2026-10-03T21:00Z)` → `"11:00 AM – 2:00 PM PDT"`
- `toDbTime(Temporal.Instant.from("2026-10-03T02:00:00Z"))` → `"2026-10-03T02:00:00.000Z"`; round trip through `fromDbTime` equals the original; two different instants compare the same way as their strings.

`src/calendar/month-grid.test.ts`:

- `parseYearMonth("2026-10")` ok (year 2026, month 10); `"2026-13"`, `"2026-00"`, `"2026-1"`, `"26-10"`, `"2026-10-01"`, `"1999-12"`, `""`, `42` → `"That isn't a month on the calendar."`
- February 2026 starts on a Sunday and has 28 days: 4 weeks, first cell 2026-02-01, last 2026-02-28, every cell `inMonth`.
- October 2026: 5 weeks, first cell 2026-09-27 (`inMonth` false), last cell 2026-10-31.
- August 2026: 6 weeks, first cell 2026-07-26, last cell 2026-09-05.
- Every week has 7 consecutive days and starts on a Sunday (`dayOfWeek === 7`).
- `isToday` is true for exactly the one matching cell (today 2026-10-02 in October), and for no cell when today is outside the grid.
- `monthName(2026-10)` → `"October 2026"`.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/time.test.ts src/calendar`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/time.ts`:

```ts
import { Temporal } from "temporal-polyfill";
import { fail, ok, type Parsed } from "./parsed";
import { STUDIO } from "./store";

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_SHAPE = /^\d{2}:\d{2}$/;

const dateFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: STUDIO.timeZone,
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});
const timeFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: STUDIO.timeZone,
  hour: "numeric",
  minute: "2-digit",
});
const rangeFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: STUDIO.timeZone,
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});
const zoneFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: STUDIO.timeZone,
  timeZoneName: "short",
});

export function studioTime(instant: Temporal.Instant): Temporal.ZonedDateTime {
  return instant.toZonedDateTimeISO(STUDIO.timeZone);
}

export function studioToday(now: Temporal.Instant): Temporal.PlainDate {
  return studioTime(now).toPlainDate();
}

export function startOfStudioDay(date: Temporal.PlainDate): Temporal.Instant {
  return date.toZonedDateTime(STUDIO.timeZone).toInstant();
}

export function parseStudioDate(input: unknown): Parsed<Temporal.PlainDate> {
  const date = parseWith(input, DATE_SHAPE, (text) => Temporal.PlainDate.from(text));
  return date ? ok(date) : fail("Pick a date.");
}

export function parseClockTime(input: unknown): Parsed<Temporal.PlainTime> {
  const time = parseWith(input, TIME_SHAPE, (text) => Temporal.PlainTime.from(text));
  return time ? ok(time) : fail("Pick a start time.");
}

// "compatible" moves a time inside the spring-forward gap an hour later and picks the
// first of the two fall-back hours, the same way most calendar apps do.
export function studioInstant(date: Temporal.PlainDate, time: Temporal.PlainTime): Temporal.Instant {
  return date
    .toPlainDateTime(time)
    .toZonedDateTime(STUDIO.timeZone, { disambiguation: "compatible" })
    .toInstant();
}

function parseWith<T>(input: unknown, shape: RegExp, from: (text: string) => T): T | undefined {
  if (typeof input !== "string" || !shape.test(input)) return undefined;
  try {
    return from(input);
  } catch {
    return undefined;
  }
}

export function formatStudioDate(instant: Temporal.Instant): string {
  return dateFormat.format(instant.epochMilliseconds);
}

export function formatStudioTime(instant: Temporal.Instant): string {
  return timeFormat.format(instant.epochMilliseconds);
}

export function formatStudioTimeRange(start: Temporal.Instant, end: Temporal.Instant): string {
  return rangeFormat.formatRange(start.epochMilliseconds, end.epochMilliseconds);
}

export function formatStudioZone(instant: Temporal.Instant): string {
  const zone = zoneFormat
    .formatToParts(instant.epochMilliseconds)
    .find((part) => part.type === "timeZoneName");
  return zone?.value ?? "PT";
}

// Fixed-width UTC strings sort the same way as the instants they hold, so SQL can
// compare them directly.
export function toDbTime(instant: Temporal.Instant): string {
  return new Date(instant.epochMilliseconds).toISOString();
}

export function fromDbTime(text: string): Temporal.Instant {
  return Temporal.Instant.from(text);
}
```

(If `Temporal.PlainDate.from("2026-02-30")` does not throw in temporal-polyfill, pass `{ overflow: "reject" }`; the tests decide.)

`src/calendar/month-grid.ts`:

```ts
import { Temporal } from "temporal-polyfill";
import { fail, ok, type Parsed } from "../parsed";

export type CalendarDay = {
  readonly date: Temporal.PlainDate;
  readonly inMonth: boolean;
  readonly isToday: boolean;
};

const YEAR_MONTH = /^(\d{4})-(\d{2})$/;
const monthFormat = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export function parseYearMonth(input: unknown): Parsed<Temporal.PlainYearMonth> {
  const match = typeof input === "string" ? YEAR_MONTH.exec(input) : null;
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  if (!match || month < 1 || month > 12 || year < 2000 || year > 2100) {
    return fail("That isn't a month on the calendar.");
  }
  return ok(Temporal.PlainYearMonth.from({ year, month }));
}

// Weeks run Sunday to Saturday, the way US wall calendars do. Temporal numbers
// Monday 1 through Sunday 7, so `dayOfWeek % 7` counts days since Sunday.
export function monthGrid(
  month: Temporal.PlainYearMonth,
  today: Temporal.PlainDate,
): CalendarDay[][] {
  const first = month.toPlainDate({ day: 1 });
  const last = month.toPlainDate({ day: month.daysInMonth });
  let day = first.subtract({ days: first.dayOfWeek % 7 });
  const end = last.add({ days: 6 - (last.dayOfWeek % 7) });
  const weeks: CalendarDay[][] = [];
  while (Temporal.PlainDate.compare(day, end) <= 0) {
    const week: CalendarDay[] = [];
    for (let i = 0; i < 7; i++, day = day.add({ days: 1 })) {
      week.push({
        date: day,
        inMonth: day.month === month.month && day.year === month.year,
        isToday: day.equals(today),
      });
    }
    weeks.push(week);
  }
  return weeks;
}

export function monthName(month: Temporal.PlainYearMonth): string {
  return monthFormat.format(Date.UTC(month.year, month.month - 1, 1));
}
```

- [ ] **Step 4: Run tests, typecheck, codebase rules**

Run: `npx vitest run && npm run typecheck && npx biome check .`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/time.ts src/time.test.ts src/calendar
git commit -m "feat(calendar): add vancouver time helpers and the month grid"
```

---

### Task 5: Course templates from JSON files

**Files:**

- Create: `courses/wheel.json`, `courses/raku.json`, `courses/handbuilding.json`
- Create: `public/images/courses/wheel/{logo.webp,art-1200.webp,art-600.webp}`, same for `raku` and `handbuilding`
- Create: `src/courses/course-template.ts`, `src/courses/load-courses.ts`, `src/courses/courses.ts`, `src/courses/course-styles.ts`
- Modify: `src/app.tsx` (serve `/courses.css`), `src/parsed.ts` only if a helper is genuinely shared
- Test: `src/courses/course-template.test.ts`, `src/courses/courses.test.ts`, `src/courses/course-styles.test.ts`

**Interfaces:**

- Consumes: `Duration`, `Capacity` (Task 3), `Parsed`/`ok`/`fail`/`tidyText`/`wholeNumber`, `STUDIO.spotLimit`.
- Produces:
  - `type CourseImage = { readonly src: string; readonly width: number; readonly height: number; readonly alt: string }`
  - `type CourseArt = CourseImage & { readonly smallSrc: string }`
  - `type CourseContent = { readonly description: string; readonly whatToBring: string; readonly color: string; readonly logo: CourseImage; readonly art: CourseArt }`
  - `class CourseTemplate { readonly id: string; readonly name: string; readonly formats: readonly string[]; readonly defaultDuration: Duration; readonly defaultCapacity: Capacity; readonly minPotters: number; readonly content: CourseContent; static parse(id: string, json: unknown): Parsed<CourseTemplate> }` (fields public and readonly; the private constructor keeps it nominal enough because nothing else can build one)
  - `loadCourses(files: Record<string, unknown>): CourseTemplate[]` in `src/courses/load-courses.ts` (no `import.meta.glob`, so plain Node scripts can use it)
  - `courses: readonly CourseTemplate[]` (sorted by name) and `findCourse(id: string): CourseTemplate | undefined` in `src/courses/courses.ts`
  - `courseStylesheet(templates: readonly CourseTemplate[]): string`
  - Route `GET /courses.css` → `text/css; charset=utf-8`, one rule per course: `.course-<id> { --course-color: <color>; }`

- [ ] **Step 1: Images**

From `scratchpad/content/images/optimized/` (see `manifest.md` there; raw originals are in `../raw/`), produce for each course:

- `art-1200.webp` (1200 px wide) and `art-600.webp` (600 px wide), same crop and aspect ratio, each under ~80 KB. Wheel: the photo of a bowl on the wheel. Raku: the photo of a pot coming out of the kiln, re-cropped so no kiln shelf or tongs show at any edge. Handbuilding: the photo of coiled vases.
- `logo.webp`: the logo about 480 px wide, transparent background, under ~30 KB (convert the SVG logos; `magick` and `sips` are available; don't add npm dependencies for this).
  Put them at `public/images/courses/<id>/`. Open each result (render to PNG and look) and confirm the crop is clean. Record real pixel sizes for the JSON.

- [ ] **Step 2: Template files**

`courses/wheel.json` (fill `width`/`height` with the real pixel sizes):

```json
{
  "name": "Wheel Throwing",
  "workshop": {
    "formats": ["Standard", "Glazing", "Open Studio", "Beginner", "Modern", "Firing Night"],
    "defaultDurationMinutes": 180,
    "defaultCapacity": 16,
    "minPotters": 8
  },
  "content": {
    "description": "Center, open and pull a cylinder on the wheel, then trim it into a bowl you glaze next week.",
    "whatToBring": "Clothes that can get muddy and short nails. Clay is provided for Open Studio, Beginner and Firing Night.",
    "color": "#5B2A86",
    "logo": {
      "src": "/images/courses/wheel/logo.webp",
      "width": 0,
      "height": 0,
      "alt": "Wheel Throwing"
    },
    "art": {
      "src": "/images/courses/wheel/art-1200.webp",
      "smallSrc": "/images/courses/wheel/art-600.webp",
      "width": 1200,
      "height": 876,
      "alt": "A wide stoneware bowl spinning on a wheel under wet hands"
    }
  }
}
```

`courses/raku.json`: name `"Raku Firing Course"`; formats `["Standard", "Outdoor", "Pit Firing", "Glaze Test", "Firing Night"]`; `defaultDurationMinutes` 120; `defaultCapacity` 20; `minPotters` 4; description `"Glaze two bisque pots, then pull them glowing from the kiln and smoke them in sawdust."`; whatToBring `"Closed shoes and cotton clothes. Bisque pots are provided for Firing Night."`; color `"#3C5AA7"`; art alt `"A glowing raku pot lifted from the kiln with long tongs"`; logo alt `"Raku Firing Course"`.

`courses/handbuilding.json`: name `"Handbuilding Course"`; formats `["Open Coil", "Beginner", "Open Studio", "Team Mug Challenge"]`; `defaultDurationMinutes` 150; `defaultCapacity` 12; `minPotters` 4; description `"Build a vase from coils and slabs, no wheel needed, and learn to join pieces that survive the kiln."`; whatToBring `"An apron and an old towel. Clay is provided for Beginner and Open Studio."`; color `"#C8102E"`; art alt `"Three coiled vases drying on a wooden board"`; logo alt `"Handbuilding Course"`.

- [ ] **Step 3: Write the failing tests**

`src/courses/course-template.test.ts` builds a valid template object in the test (neutral values: id `test-course`, name `Test Course`, formats `["Standard", "Draft"]`, duration 180, capacity 16, min potters 4, color `#5B2A86`, local image paths) and checks:

- valid input → all fields, `defaultDuration.minutes === 180`, `defaultCapacity.value === 16`, `content.color === "#5b2a86"` (lowercased).
- each of these fails with a message naming the field path: missing `name`; `workshop.formats` empty, not an array, containing `""`, or containing `"Draft"` and `"draft"`; `workshop.defaultDurationMinutes` 45; `workshop.minPotters` 0, 31 or `"4"`; `workshop.defaultCapacity` 31 and 2 (below min potters); `content.color` `"purple"` and `"#12345"`; `content.logo.src` `"https://example.com/logo.webp"` and `"/images/../secret"`; `content.art.width` 0 or `12.5`; `content.description` missing; the whole thing not an object; id `"Wheel!"` or `""`.

`src/courses/courses.test.ts`:

- `loadCourses({ "../../courses/b.json": validB, "../../courses/a.json": validA })` returns templates sorted by name with ids `a`/`b` taken from file names.
- `loadCourses` with two broken files throws one error whose message names both files (`courses/x.json: …`).
- The real `courses` list has three templates; every `logo.src`, `art.src` and `art.smallSrc` exists as a file under `public/`; `findCourse(courses[0].id)` returns it; `findCourse("nope")` is `undefined`.

`src/courses/course-styles.test.ts`:

- `courseStylesheet([two templates])` equals `".course-a { --course-color: #111111; }\n.course-b { --course-color: #222222; }\n"`.
- `GET /courses.css` answers 200, `content-type` starts with `text/css`, and contains a rule for every id in `courses`.

- [ ] **Step 4: Implement**

`src/courses/course-template.ts` — parse with small helpers that throw a private `TemplateProblem` error carrying a path-prefixed message (`"workshop.formats must list at least one format, each named once"`), caught once in `parse` and turned into `fail(message)`. Reuse `Duration.parse` and `Capacity.parse(value, minPotters)` (on failure: `"workshop.defaultDurationMinutes must be one of the offered lengths: 60 to 480 minutes in steps of 30"` and `` `workshop.defaultCapacity: ${error}` ``). Rules: id `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`; strings go through `tidyText` and must be non-empty; `minPotters` is a whole number from 1 to `STUDIO.spotLimit`; `color` matches `/^#[0-9a-f]{6}$/i` and is stored lowercase; image `src`/`smallSrc` start with `/images/` and contain no `..`; `width`/`height` are positive whole numbers. Keep the file under 150 lines.

`src/courses/courses.ts`:

```ts
import type { CourseTemplate } from "./course-template";
import { loadCourses } from "./load-courses";

// Vite inlines every file in courses/ at build time, so adding a course is adding a file.
const templateFiles = import.meta.glob<unknown>("../../courses/*.json", {
  eager: true,
  import: "default",
});

export const courses: readonly CourseTemplate[] = loadCourses(templateFiles);

export function findCourse(id: string): CourseTemplate | undefined {
  return courses.find((course) => course.id === id);
}
```

`src/courses/load-courses.ts` (kept apart from the glob so the seed script can run it in plain Node):

```ts
import { CourseTemplate } from "./course-template";

// A broken template stops the Worker from starting (and deploys fail), which beats
// finding out halfway through creating a workshop.
export function loadCourses(files: Record<string, unknown>): CourseTemplate[] {
  const problems: string[] = [];
  const templates: CourseTemplate[] = [];
  for (const [path, json] of Object.entries(files)) {
    const fileName = path.slice(path.lastIndexOf("/") + 1);
    const parsed = CourseTemplate.parse(fileName.replace(/\.json$/, ""), json);
    if (parsed.ok) templates.push(parsed.value);
    else problems.push(`courses/${fileName}: ${parsed.error}`);
  }
  if (problems.length > 0) throw new Error(`Invalid course templates:\n${problems.join("\n")}`);
  return templates.sort((a, b) => a.name.localeCompare(b.name));
}
```

`src/courses/course-styles.ts`:

```ts
import type { CourseTemplate } from "./course-template";

// Course colors live in the templates, and inline styles are off limits, so the colors
// reach the page as a generated stylesheet. Ids and colors were checked when parsed.
export function courseStylesheet(templates: readonly CourseTemplate[]): string {
  return templates
    .map((course) => `.course-${course.id} { --course-color: ${course.content.color}; }\n`)
    .join("");
}
```

In `src/app.tsx`, compute the stylesheet once at module load and serve it:

```tsx
const courseStyles = courseStylesheet(courses);
// inside createApp:
app.get("/courses.css", (c) =>
  c.body(courseStyles, 200, {
    "Content-Type": "text/css; charset=utf-8",
    "Cache-Control": "public, max-age=3600",
  }),
);
```

- [ ] **Step 5: Run tests, typecheck, codebase rules (the course-neutral rule now has real courses to check)**

Run: `npx vitest run && npm run typecheck && npx biome check .`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add courses public/images src/courses src/app.tsx
git commit -m "feat(courses): load course templates from json files"
```

---

### Task 7: Web shell and design system

**Files:**

- Modify: `src/app.tsx`, `src/app-env.ts`, `src/app.test.ts`
- Create: `src/log.ts`, `src/views/layout.tsx`, `src/views/not-found-page.tsx`, `src/views/error-page.tsx`
- Create: `public/styles/tokens.css`, `public/styles/site.css`, `public/fonts/big-shoulders-display.woff2`, `public/fonts/atkinson-hyperlegible-next.woff2`, `public/favicon.svg`, `public/_headers`
- Test: `src/log.test.ts`, `src/app.test.ts`

**Interfaces:**

- Consumes: `createApp`, `AppDeps`, `AppEnv`, `STUDIO`.
- Produces:
  - Every route renders through `c.render(<Page />, { title, description })`; the layout wraps it (Hono `jsxRenderer` with `docType: true`). Declare the props type with module augmentation in `src/app-env.ts`:
    ```ts
    declare module "hono" {
      interface ContextRenderer {
        (content: string | Promise<string>, props: PageProps): Response | Promise<Response>;
      }
    }
    export type PageProps = { title: string; description?: string };
    ```
  - `logInfo(workshop: string, fields?: LogFields): void`, `logError(workshop: string, error: unknown, fields?: LogFields): void`, `type LogFields = Record<string, string | number | boolean>`
  - CSS classes later tasks reuse: `.page`, `.page-title`, `.lede`, `.button`, `.button--quiet`, `.field`, `.field__label`, `.field__hint`, `.field__error`, `.field__input`, `.error-summary`, `.visually-hidden`, `.course-badge`. Tasks 9–12 add their own page sections to `site.css`.

Read the spec's "Visual design" section before starting; it is the brief. This task sets the look for the whole app, so take screenshots and look at them.

- [ ] **Step 1: Write the failing tests**

`src/log.test.ts`: `logInfo("workshop_created", { workshopId: "x" })` writes exactly one `console.log` line that parses as JSON `{ level: "info", workshop: "workshop_created", workshopId: "x" }`; `logError("unhandled_error", new Error("boom"), { path: "/x" })` writes one `console.error` JSON line with `level: "error"`, `message: "boom"`, a `stack` string and `path: "/x"`; a thrown string (`logError("e", "plain")`) logs `message: "plain"`.

`src/app.test.ts` (replace the Task 1 test):

- `GET /` → 200, body starts with `<!DOCTYPE html>`, has `<html lang="en">`, a `<title>` ending in ` – Claybank Studio`, a `<meta name="description"`, links to `/styles/tokens.css`, `/styles/site.css`, `/courses.css` and `/favicon.svg`, a skip link to `#main`, `<main id="main"`, a nav with links to `/` and `/workshops/new`, and a footer containing the studio address and `All times are Vancouver Time.`
- no rendered page contains `<script`.
- `GET /` has header `content-security-policy` exactly `default-src 'none'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`, and `x-content-type-options: nosniff`.
- `GET /no-such-page` → 404 with the layout and the heading `We can't find that page` and a link back to `/`.
- An app from `createApp` with an extra test route that throws (`app.get("/boom", () => { throw new Error("boom") })`) → 500 page with the heading `This page didn't load`, and `console.error` received one JSON line with `workshop: "unhandled_error"` and `path: "/boom"`.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/app.test.ts src/log.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement the shell**

`src/app.tsx` middleware, in this order: `secureHeaders` with the CSP from Global Constraints (other `secureHeaders` defaults stay on); `csrf()` (Hono checks `Origin` on form POSTs); `bodyLimit({ maxSize: 16 * 1024, onError: (c) => c.text("That form is too large to send.", 413) })`; `jsxRenderer` wrapping `Layout`, `{ docType: true }`. Then routes. Then:

```tsx
app.notFound((c) => {
  c.status(404);
  return c.render(<NotFoundPage />, { title: "Page not found" });
});

app.onError((error, c) => {
  if (error instanceof HTTPException) return error.getResponse();
  logError("unhandled_error", error, { method: c.req.method, path: c.req.path });
  c.status(500);
  return c.render(<ErrorPage />, { title: "Page didn't load" });
});
```

`GET /` keeps rendering a placeholder inside the layout (`<h1 class="page-title">Calendar</h1>`) until Task 9.

Layout (`src/views/layout.tsx`): `<html lang="en">`, head with `<meta charset="utf-8">`, viewport, `<title>{title} – Claybank Studio</title>`, description (default: `"In-store pottery workshops at Claybank Studio in Victoria. Times are Vancouver."`), favicon link (`type="image/svg+xml"`), `<link rel="preload" as="font" type="font/woff2" crossorigin href="/fonts/atkinson-hyperlegible-next.woff2">`, stylesheets `/styles/tokens.css`, `/styles/site.css`, `/courses.css`. Body: skip link `Skip to main content`, site header with the wordmark `Claybank Studio` linking to `/` and a nav (`aria-label="Main"`) with `Calendar` (`/`) and `Create a workshop` (`/workshops/new`, styled as the primary button), `<main id="main" class="page">`, footer with `{STUDIO.name}, {STUDIO.address}` and `All times are Vancouver Time.`

Not found page: heading `We can't find that page`, text `The link may be mistyped, or the page may have moved.`, link `Go to the calendar` (`/`).
Error page: heading `This page didn't load`, text `Something went wrong on our end. Try again in a minute, and if it keeps happening, let someone at the studio know.`, link `Go to the calendar`.

`src/log.ts`:

```ts
export type LogFields = Record<string, string | number | boolean>;

// One JSON object per line, so Workers Logs can filter on any field.
export function logInfo(workshop: string, fields: LogFields = {}): void {
  console.log(JSON.stringify({ level: "info", workshop, ...fields }));
}

export function logError(workshop: string, error: unknown, fields: LogFields = {}): void {
  const { message, stack } =
    error instanceof Error ? error : { message: String(error), stack: undefined };
  console.error(JSON.stringify({ level: "error", workshop, message, stack, ...fields }));
}
```

- [ ] **Step 4: Design system**

Fonts: download the latin woff2 files for Big Shoulders Display (weights 700–800, variable) and Atkinson Hyperlegible Next (400–700, variable) from Google Fonts (fetch `https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@700..800&family=Atkinson+Hyperlegible+Next:wght@400..700&display=swap` with a desktop Chrome `User-Agent` header, take the `/* latin */` `src` URLs) into `public/fonts/`. Both are SIL Open Font License.

`public/styles/tokens.css` holds every literal value, and only this file may: the `@font-face` rules (`font-display: swap`) and one `:root` block with at least these tokens (names are the contract; add more as needed, never literals elsewhere):

```css
:root {
  --felt: #16453e;
  --felt-deep: #0e2f2a;
  --table: #eef2f0;
  --paper: #ffffff;
  --ink: #1d2b28;
  --ink-soft: #4b5b57;
  --rule: #c9d6d2;
  --control-border: #66797a;
  --gold: #f2b705;
  --stamp: #b3261e;
  --course-color: var(--ink-soft);

  --font-display: "Big Shoulders Display", "Arial Narrow", sans-serif;
  --font-body: "Atkinson Hyperlegible Next", "Segoe UI", system-ui, sans-serif;
  --text-sm: 0.875rem;
  --text-base: 1.0625rem;
  --text-lg: 1.328rem;
  --text-xl: 1.66rem;
  --text-2xl: 2.075rem;
  --text-3xl: 2.594rem;
  --text-4xl: 3.242rem;
  --weight-regular: 400;
  --weight-bold: 700;
  --weight-heavy: 800;
  --leading-tight: 1.05;
  --leading-body: 1.55;
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.5rem;
  --space-6: 2rem;
  --space-7: 3rem;
  --space-8: 4rem;
  --radius-sm: 4px;
  --radius-md: 8px;
  --focus-ring: 0 0 0 3px var(--gold);
  --content-width: 72rem;
}
```

`public/styles/site.css`: a small reset, body (`--table` background, `--ink` text, `--font-body`, `--text-base`, `--leading-body`), the header band in `--felt` with the wordmark in `--font-display` (white on felt), footer, skip link, `.page` container (max width `--content-width`, side padding at least `--space-4`, left aligned), `.page-title` (display font, heavy, `--text-3xl`/`--text-4xl`), links, `.button` (felt background, white text, `--radius-sm`, focus ring), `.button--quiet` (outline), form field styles (label above input, hint in `--ink-soft`, error in `--stamp` with a leading icon-free text marker, inputs with a `--control-border` border ≥ 3:1 contrast, 44px minimum touch height), `.error-summary`, `.visually-hidden`, `:focus-visible` using `--focus-ring`, and `@media (prefers-reduced-motion: reduce)` turning off transitions. No shadows except a single sheet shadow token if you need one. Everything must work from 320px wide with no horizontal scroll.

`public/favicon.svg`: a simple mark (for example a card shape in `#16453e` with a white "T"), using `fill` attributes, never `style`.

`public/_headers`:

```
/fonts/*
  Cache-Control: public, max-age=31536000, immutable
/images/*
  Cache-Control: public, max-age=604800
```

- [ ] **Step 5: Look at it**

Run `npx vite dev --port 5173`, then take full-page screenshots of `/` and `/no-such-page` at 1280×800 and 390×844 with Playwright's Chromium (a throwaway script in the scratchpad directory, not in the repo) and open them. Check against the spec's "Visual design" section and its "Avoid" list. Fix what looks off. Leave the four screenshot paths in your report.

- [ ] **Step 6: Run everything and commit**

```bash
npx vitest run && npm run typecheck && npx biome check .
git add -A
git commit -m "feat(ui): add the page layout, security headers and design tokens"
```

---

### Task 9: Calendar page

**Files:**

- Create: `src/calendar/calendar-routes.tsx`, `src/calendar/calendar-page.tsx`, `tests/support/test-app.ts`
- Modify: `src/app.tsx` (mount the routes, drop the placeholder `/`), `public/styles/site.css` (calendar section)
- Test: `src/calendar/calendar-routes.test.ts`

**Interfaces:**

- Consumes: `monthGrid`, `parseYearMonth`, `monthName`, `CalendarDay` (Task 4); `studioTime`, `studioToday`, `startOfStudioDay`, `formatStudioTime` (Task 4); `listWorkshopsStarting`, `ScheduledWorkshop` (Task 8); `createTestDatabase`, `sampleNewWorkshop`, `FIXED_NOW` (Task 8); layout classes (Task 7).
- Produces:
  - `calendarRoutes(deps: AppDeps): Hono<AppEnv>` serving `GET /` (the current Vancouver month) and `GET /calendar/:month` (`YYYY-MM`; anything else is a 404 page)
  - `tests/support/test-app.ts`: `testApp(now = FIXED_NOW)` returning `createApp({ now: () => now })`, and `postForm(fields: Record<string, string>): RequestInit` (POST, `Content-Type: application/x-www-form-urlencoded`, `Origin: http://localhost`, URL-encoded body). Requests go through `app.request(path, init, { DB: db })`.

Markup contract (tests and later tasks rely on the words, not on classes):

- `<h1>` is the month name, e.g. `October 2026`; the page `title` is the same.
- Right under it: `Times are Vancouver Time.`
- A nav labelled `Months` with links to the previous and next month, whose text is the month name (`September 2026`, `November 2026`), plus `This month` linking to `/` when the page isn't the current month.
- Weekday headings `Sun` … `Sat` are decorative (`aria-hidden="true"`); the days are an `<ol>`. Each day shows its number; days from neighbouring months are visibly muted; today's cell carries `aria-current="date"`.
- Each day that has workshops starts with a visually hidden full date, e.g. `Friday, October 2`, followed by a list of workshop links. Each link goes to `/workshops/<id>`, has the class `course-<courseId>` (so `--course-color` applies), and shows the start time (`7:00 PM`), the workshop name, and the spots: `3 of 8` followed by visually hidden ` spots taken`, or `Full`.
- A month with no workshops shows `Nothing is scheduled for October yet.` and a link `Create a workshop` to `/workshops/new`.
- Under 700px wide the grid becomes a list of only the days that have workshops, each headed by its date (make the hidden date visible there; hide empty days and weekday headings).

- [ ] **Step 1: Write the failing tests**

`src/calendar/calendar-routes.test.ts` (one test database per file; `FIXED_NOW` is Saturday, September 26, 2026, noon Vancouver). To check that a workshop sits on the right day, slice the HTML between two hidden date labels (e.g. between `Friday, October 2` and `Saturday, October 3`) and look for the workshop name in that slice.

- `GET /` shows `September 2026` and marks September 26 with `aria-current="date"`.
- `GET /calendar/2026-10` with a workshop at `2026-10-03T02:00:00Z` shows it on Friday, October 2 with `7:00 PM`, its name, and `0 of 8`.
- A workshop at 11:30 PM Vancouver on October 2 (`2026-10-03T06:30:00Z`) is on October 2, not October 3.
- A workshop on September 27 (a leading day in the October grid) shows in October; one on November 10 does not.
- A workshop whose four spots are all booked shows `Full`.
- Navigation: October links to `/calendar/2026-09` and `/calendar/2026-11`; December 2026 links to `/calendar/2027-01`; `This month` appears on October and not on `/`.
- `/calendar/2026-13`, `/calendar/october` → 404 page.
- A month with no workshops shows the empty-state sentence and the `Create a workshop` link.
- A workshop named `<script>alert(1)</script>` appears escaped (`&lt;script&gt;`), never as a tag.
- A workshop stored with a course id that has no template still renders, using its stored course name in the link's text or title.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/calendar/calendar-routes.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement**

`calendarRoutes(deps)`: for a month, build `monthGrid(month, studioToday(deps.now()))`, query `listWorkshopsStarting(c.env.DB, startOfStudioDay(firstCell), startOfStudioDay(lastCell.add({ days: 1 })))`, group by `studioTime(workshop.startsAt).toPlainDate().toString()`, and `c.render(<CalendarPage … />, { title: monthName(month), description: \`Pottery workshops at Claybank Studio in ${monthName(month)}. Times are Vancouver.\` })`. `GET /`uses`studioTime(deps.now())`to get the current`PlainYearMonth`. Keep the page component presentational (props in, markup out) and split out a small workshop-chip component if the file passes ~120 lines.

CSS: add a calendar section to `site.css` using only tokens: 7-column grid of paper cells with `--rule` lines, day numbers in `--font-display`, today marked with a `--gold` disc behind the number, workshop chips with a 4px left border in `var(--course-color)` and a tinted background via `color-mix(in srgb, var(--course-color) 12%, var(--paper))`, text in `--ink`.

- [ ] **Step 4: Look at it**

Seed a few workshops through the running dev server's database (for now insert them with a throwaway script in the scratchpad that calls the create-workshop route or uses `wrangler d1 execute --local`), screenshot `/calendar/<month>` at 1280×800 and 390×844, and fix what looks off. Leave the screenshot paths in your report.

- [ ] **Step 5: Run everything and commit**

```bash
npx vitest run && npm run typecheck && npx biome check .
git add -A
git commit -m "feat(calendar): show each month's workshops on a server-rendered grid"
```

---

### Task 10: Create a workshop from a course template

**Files:**

- Create: `src/workshops/new-workshop-form.ts`, `src/workshops/new-workshop-routes.tsx`, `src/workshops/pick-course-page.tsx`, `src/workshops/new-workshop-page.tsx`
- Modify: `src/app.tsx`, `public/styles/site.css` (course picker and form)
- Test: `src/workshops/new-workshop-form.test.ts`, `src/workshops/new-workshop-routes.test.ts`

**Interfaces:**

- Consumes: `courses`, `findCourse`, `CourseTemplate` (Task 5); `WorkshopName`, `Capacity`, `Duration` (Task 3); `parseStudioDate`, `parseClockTime`, `studioInstant`, `studioToday` (Task 4); `insertWorkshop`, `NewWorkshop` (Task 8); `logInfo` (Task 7); `testApp`, `postForm` (Task 9).
- Produces:
  - `type NewWorkshopFields = { readonly name: string; readonly format: string; readonly date: string; readonly time: string; readonly duration: string; readonly capacity: string }`
  - `type NewWorkshopErrors = Partial<Record<keyof NewWorkshopFields, string>>`
  - `blankFields(course: CourseTemplate): NewWorkshopFields` — name, date and time empty; format = first format; duration and capacity = the template defaults as strings
  - `parseNewWorkshopForm(body: Record<string, unknown>, course: CourseTemplate, now: Temporal.Instant): { ok: true; value: NewWorkshop } | { ok: false; fields: NewWorkshopFields; errors: NewWorkshopErrors }`
  - `newWorkshopRoutes(deps: AppDeps): Hono<AppEnv>` serving `GET /workshops/new`, `GET /workshops/new/:course`, `POST /workshops/new/:course`

Form rules (messages exact): name via `WorkshopName`; format must be one of `course.formats` else `Pick one of the listed formats.`; date via `parseStudioDate`, time via `parseClockTime`; when both parse, the start (`studioInstant`) must be after `now` else `Pick a date and start time that haven't passed.` (on `date`), and no more than 365 days after `now` else `Pick a date within the next year.` (on `date`); duration via `Duration`; capacity via `Capacity.parse(value, course.minPotters)`. The `NewWorkshop` takes `courseId`, `courseName` and `minPotters` from the template.

Page contract:

- `GET /workshops/new`: title and `<h1>` `Create a workshop`; lede `Pick the course. Its template fills in the formats, length and spots.`; one entry per course (in `courses` order) with its small art (decorative, `alt=""`), its logo (`alt` = course name), description, a line `Usually {defaultDuration.label}, {defaultCapacity} spots, {minPotters} potters to start.`, and a link `New {course.name} workshop` to `/workshops/new/{id}`. Frame each entry in `var(--course-color)` (class `course-{id}`) like a card's border.
- `GET /workshops/new/:course`: title and `<h1>` `New {course.name} workshop`; fields in this order with these labels: `Workshop name`; `Format` (select); `Date`; `Start time` with hint `Vancouver Time`; `Length` (select of `Duration.options` labels, default selected) with hint `Suggested for {course.name}: {defaultDuration.label}`; `Spots` (number input, `min` = min potters, `max` = 30) with hint `{course.name} needs at least {minPotters} potters to start. The studio has 30 spots.`; button `Create workshop`; link `Pick a different course`. Date input gets `min` = today and `max` = today + 365 days (Vancouver).
- On errors: status 400, title prefixed `Error: `, an error summary at the top headed `Fix these to create the workshop` listing each message as a link to its field (`#name`, `#format`, …), and each message again under its field (`id="{field}-error"`, input has `aria-invalid="true"` and `aria-describedby` including the error id). Every typed value is kept.
- Success: `logInfo("workshop_created", { workshopId, courseId })`, then `303` to `/workshops/{id}`.

- [ ] **Step 1: Write the failing tests**

`src/workshops/new-workshop-form.test.ts` (use a template parsed from a neutral fixture inside the test, formats `["Standard", "Draft"]`, min potters 4, default 180 minutes and 16 spots, and `FIXED_NOW`):

- a complete valid body → `NewWorkshop` with the start `2026-10-03T02:00:00Z` for `2026-10-02` + `19:00`, duration 180, capacity 12, course id/name/min potters from the template.
- `blankFields` → format `Standard`, duration `"180"`, capacity `"16"`, others empty.
- each rule's message on the right field: empty name; format `Beginner`; date `2026-02-30`; time `7pm`; `2026-09-26` + `11:00` (already passed) and `2027-09-27` + `19:00` (over a year) on `date`; duration `45`; capacity `3` and `31` and `lots`. Several errors at once are all reported, and `fields` echoes the raw input.

`src/workshops/new-workshop-routes.test.ts`:

- `GET /workshops/new` lists every course in `courses` with its `New … workshop` link.
- `GET /workshops/new/{first course id}` shows the template's formats as options, the default length selected, the default spots as the value, and the min-potters hint.
- `GET /workshops/new/no-such-course` and `POST` to it → 404.
- a valid `POST` → 303 to `/workshops/{uuid}`, and `findWorkshop` returns the studiod workshop with the posted values.
- an invalid `POST` (empty name, capacity 31) → 400, title starts with `Error: `, both messages in the summary and under their fields, `aria-invalid="true"` on both inputs, the typed format/date kept, nothing stored.
- a `POST` without an `Origin` header → 403.
- a `POST` with name `<script>alert(1)</script>` and a bad capacity re-renders the name escaped.

- [ ] **Step 2: Run to see them fail** — `npx vitest run src/workshops/new-workshop-form.test.ts src/workshops/new-workshop-routes.test.ts`

- [ ] **Step 3: Implement** the form parser, routes and both pages per the contract. Keep each file under ~150 lines; a shared `Field` component for label + hint + error + control is welcome if it removes repetition.

- [ ] **Step 4: Look at it** — screenshot `/workshops/new`, `/workshops/new/{id}` and the error state at 1280×800 and 390×844; fix what looks off.

- [ ] **Step 5: Run everything and commit**

```bash
npx vitest run && npm run typecheck && npx biome check .
git add -A
git commit -m "feat(workshops): create workshops from a course template form"
```

---

### Task 11: Workshop page with QR code and calendar invite

**Files:**

- Create: `src/workshops/workshop-routes.tsx`, `src/workshops/workshop-page.tsx`, `src/workshops/sign-up-sheet.tsx`, `src/views/facts.tsx`
- Modify: `src/workshops/workshop.ts` (add `bookingStatus`), `src/app.tsx`, `public/styles/site.css`
- Test: `src/workshops/workshop-routes.test.ts`, `src/workshops/workshop.test.ts`

**Interfaces:**

- Consumes: `findWorkshop`, `ScheduledWorkshop` (Task 8); `listBookings`, `Booking` (Task 8); `findCourse` (Task 5); `buildInvite`, `inviteFileName`, `bookingQrSvg` (Task 6); time formatters (Task 4); `WorkshopId` (Task 3).
- Produces:
  - `bookingStatus(workshop: ScheduledWorkshop, now: Temporal.Instant): "open" | "full" | "closed"` in `src/workshops/workshop.ts` — `closed` once `now` ≥ start (takes priority), `full` when `bookedCount` ≥ capacity, else `open`
  - `WorkshopFacts` component in `src/views/facts.tsx`: a `<dl>` with `When` (`formatStudioDate(start)`, then `formatStudioTimeRange(start, end)`), `Where` (`STUDIO.name`, `STUDIO.address`), `Format`, and `Spots` (`{bookedCount} of {capacity} taken` or `Full, all {capacity} taken`). Tasks 12 reuse it.
  - `workshopRoutes(deps: AppDeps): Hono<AppEnv>` serving `GET /workshops/:id`, `GET /workshops/:id/qr.svg`, `GET /workshops/:id/invite.ics`
  - Booking link: `${new URL(c.req.url).origin}/workshops/${id}/book`; workshop link: `${origin}/workshops/${id}`

Page contract (`GET /workshops/:id`): title = workshop name; the course's art as a decorative banner (`srcset` of `smallSrc 600w, src 1200w`, real `width`/`height`) and logo when the template exists, otherwise the studiod course name as text; `<h1>` workshop name; `WorkshopFacts`; a line `Needs {minPotters} potters to start.` followed by `{n} more needed.` or `Enough potters have signed up.`; a link `Add to calendar` to `invite.ics` with the `download` attribute; `What to bring` (`<h2>`) with the template text when the template exists; the sign-up sheet (`<h2>` `Sign-up sheet`, an `<ol>` with exactly `capacity` lines: each booked name in order, then empty lines each holding a visually hidden `Open spot`; when full, a red `Full` stamp, `aria-hidden="true"` because the facts already say it); and a booking panel (`<h2>` `Booking link`): the QR image (`/workshops/{id}/qr.svg`, 240×240, alt `QR code that opens the booking page`), the text `Scan it with a phone camera or share this link:`, the full booking URL as a link, then either a `Book` button link (open), `This workshop is full.` (full) or `Booking closed when the workshop started.` (closed). The QR and link show in every state: they are the workshop's booking link.

- [ ] **Step 1: Write the failing tests**

`src/workshops/workshop.test.ts`: `bookingStatus` is `open` with spots left before the start; `full` at capacity; `closed` at exactly the start and after it, even when spots remain or when full.

`src/workshops/workshop-routes.test.ts` (test database; workshops via `insertWorkshop`, bookings via `bookPotter`):

- page shows the name, `Friday, October 2, 2026`, `7:00 – 10:00 PM PDT` (normalize thin spaces), the studio address, the format, `2 of 8 taken`, `Needs 4 potters to start.`, `2 more needed.`, the two names in booking order inside the sign-up sheet, and six `Open spot` lines.
- the QR image points at `/workshops/{id}/qr.svg` and the page shows `http://localhost/workshops/{id}/book` as a link.
- a full workshop shows `Full, all 4 taken`, `This workshop is full.`, still shows the QR image, and has no `Book` link.
- with the clock after the start: `Booking closed when the workshop started.`
- a workshop whose course template doesn't exist renders with its stored course name and no art or `What to bring`.
- `GET /workshops/not-a-uuid`, `GET /workshops/{random uuid}`, and the same for `qr.svg` and `invite.ics` → 404.
- `qr.svg` → 200, `content-type` `image/svg+xml`, body contains `<svg`.
- `invite.ics` → 200, `content-type` starts with `text/calendar`, `content-disposition` is `attachment; filename="{inviteFileName}"`, body has `DTSTART:20261003T020000Z` and `URL` of the workshop page.
- a `<script>` workshop name is escaped on the page.

- [ ] **Step 2: Run to see them fail.** **Step 3: Implement.** Keep `workshop-page.tsx` presentational; `sign-up-sheet.tsx` renders the numbered lines and stamp.

- [ ] **Step 4: Look at it** — screenshot an open, a nearly full, and a full workshop page at 1280×800 and 390×844. The sign-up sheet is the page's one bold element (see the spec); make it read like a real clipboard sheet with numbered lines, and keep everything around it quiet.

- [ ] **Step 5: Run everything and commit**

```bash
npx vitest run && npm run typecheck && npx biome check .
git add -A
git commit -m "feat(workshops): show workshop details, qr code, sign-up sheet and ics invite"
```

---

### Task 13: Sample data and a one-command setup

**Files:**

- Create: `scripts/seed.ts`
- Modify: `package.json` (`db:seed` script), `bootstrap` (run the seed)

**Interfaces:**

- Consumes: `loadCourses` (Task 5), `insertWorkshop` (Task 8), `bookPotter` (Task 8), parsers (Task 3), `studioToday`, `studioInstant` (Task 4).
- Produces: `npm run db:seed` (runs `tsx scripts/seed.ts`; `tsx` is already a dev dependency from Task 1) and a `bootstrap` that ends with a seeded local database.

- [ ] **Step 1: Write the seed script**

`scripts/seed.ts` uses `getPlatformProxy<{ DB: D1Database }>()` (default persistence, the same local database `vite dev` uses), reads `courses/*.json` with `node:fs` and passes them to `loadCourses`, and skips with a message if the `workshops` table already has rows. Otherwise it creates these workshops relative to today in Vancouver time (the next occurrence of each weekday after today), through the real parsers and `insertWorkshop`, then books the listed number of potters through `bookPotter` (names like `Alex K.`, `Jordan P.`, `Sam R.`, `Priya N.`, `Marcus T.`, `Lena W.`, `Diego M.`, `Harper C.`, `Noah B.`, `Ava L.`, `Kenji S.`, `Rosa F.`):

- Wednesday 6:30 PM, `Wheel Open Studio`, wheel, `Open Studio`, 8 spots, 5 potters
- Friday 7:00 PM, `Friday Night Wheel`, wheel, `Glazing`, 16 spots, 9 potters
- the Friday after that, 7:00 PM, `Friday Night Wheel`, wheel, `Glazing`, 16 spots, 2 potters
- Saturday 1:00 PM, `League Challenge`, raku, `League Challenge`, 20 spots, 11 potters
- Sunday 2:00 PM, `Handbuilding Beginner Night`, handbuilding, `Beginner`, 8 spots, 8 potters (full)
- Saturday three weeks out, 11:00 AM, `Raku Firing Night`, raku, `Firing Night`, 24 spots, 3 potters
  Each workshop uses its template's default duration. Print one line per workshop. `dispose()` the proxy in a `finally`. The script may name courses (the course-neutral rule covers `src/` only).

`package.json`: `"db:seed": "tsx scripts/seed.ts"`. `bootstrap`: add `npm run db:seed` after `npm run db:migrate`, and finish with `echo "Ready. Run npm run dev, then open http://localhost:5173"`.

- [ ] **Step 2: Prove it**

Delete `.wrangler/state`, run `./bootstrap`, run `npm run dev`, and check `/` and the next month show the seeded workshops (screenshot). Run `npm run db:seed` again and confirm it skips.

- [ ] **Step 3: Run everything and commit**

```bash
npx vitest run && npm run typecheck && npx biome check .
git add -A
git commit -m "feat: add sample workshops and seed them from bootstrap"
```

---

### Task 14: End-to-end browser tests (Playwright)

**Files:**

- Create: `playwright.config.ts`
- Create: `tests/e2e/support/*.ts` (shared helpers), and spec files `tests/e2e/booking-story.spec.ts`, `tests/e2e/create-workshop.spec.ts`, `tests/e2e/book.spec.ts`, `tests/e2e/workshop-page.spec.ts`, `tests/e2e/calendar.spec.ts`, `tests/e2e/site.spec.ts` (split further if a file nears 300 lines or FTA 60)
- Modify: `vite.config.ts` (optional persistence folder), `package.json` (scripts)

**Interfaces:**

- Consumes: the whole running app (production build).
- Produces: `npm run test:e2e`; `npm run test` ends with `playwright test`; helpers other specs reuse (Task 15 adds the Pa11y and Lighthouse specs to the same config).

The user asked for a large end-to-end suite that covers error conditions and edge cases, not just the happy path, and for data-driven tests to be written as tables: **when several tests differ only in their data, write one table of cases and generate one named test per row**, attaching the row's input as a Playwright annotation, e.g.

```ts
const cases = [
  { label: "an empty name", fields: { name: "" }, message: "Give the workshop a name." },
  { label: "an 81-character name", fields: { name: "x".repeat(81) }, message: "Keep the name to 80 characters or fewer." },
];
for (const { label, fields, message } of cases) {
  test(`rejects ${label}`, { annotation: { type: "input", description: JSON.stringify(fields) } }, async ({ page }) => {
    /* one body shared by every row */
  });
}
```

Locate elements by role, label and visible text only (no CSS or id selectors). Every test creates the data it needs (unique names from a helper) so the specs can run in parallel against one server and in any order.

- [ ] **Step 1: A production build with its own database**

`vite.config.ts`: when `process.env.D1_PERSIST_PATH` is set, pass `persistState: { path: process.env.D1_PERSIST_PATH }` to `cloudflare()` (comment why: end-to-end runs must not touch the dev database). Scripts:

```json
"e2e:server": "rm -rf .wrangler/e2e && wrangler d1 migrations apply DB --local --persist-to .wrangler/e2e && vite build && D1_PERSIST_PATH=.wrangler/e2e vite preview --port 4173 --strictPort",
"test:e2e": "playwright test",
"test": "npm run typecheck && biome check --error-on-warnings . && vitest run --coverage && playwright test"
```

Confirm `vite preview` really uses `.wrangler/e2e` (create a workshop, check it isn't in `.wrangler/state`). If it ignores `persistState`, use `wrangler dev` against the built config with `--persist-to .wrangler/e2e` and say so in the report.

- [ ] **Step 2: `playwright.config.ts`**

Chromium only; `testDir: "tests/e2e"`; `webServer: { command: "npm run e2e:server", url: "http://localhost:4173", reuseExistingServer: false, timeout: 120_000 }`; `use.baseURL: "http://localhost:4173"`; `fullyParallel: true`; a sensible worker count (e.g. 4); `timeout: 30_000` per test; `globalTimeout: 180_000` (the browser suite fails if it runs longer than three minutes: the browser half of the "suite too slow" rule; if the finished suite genuinely needs more, raise it to the measured time plus a margin and say so); `reporter: "list"`; one project `e2e` using `devices["Desktop Chrome"]` (phone tests open their own `devices["Pixel 7"]` context). Leave room for Task 15 to add an `audits` project that depends on `e2e`.

- [ ] **Step 3: Support helpers**

`tests/e2e/support/`: `uniqueName(prefix)`; `vancouverDate(daysFromToday)` returning `YYYY-MM-DD` in America/Vancouver; `createWorkshop(request, { course, name, date, time, lengthMinutes, spots, format })` posting the real form with an `Origin` header and returning the workshop URL (default: tomorrow at 18:30, the template's defaults); `book(request, workshopUrl, name)` returning the response; `startedWorkshop()` that inserts a workshop whose start has passed straight into the end-to-end database (`npx wrangler d1 execute DB --local --persist-to .wrangler/e2e --command "…"`, static values, called from a `beforeAll`; this is test setup, not app code) — the app refuses to create past workshops, so this is the only way to test "closed"; `decodeQr(page)` that draws the QR `<img>` onto a canvas in `page.evaluate`, returns the pixels and decodes them in Node with `jsqr`.

- [ ] **Step 4: The story (one serial spec)**

`tests/e2e/booking-story.spec.ts`, the full journey, `test.describe.configure({ mode: "serial" })`:
1. The organizer opens `/workshops/new`, picks `New Raku Firing Course workshop`, names the workshop, sets tomorrow at 18:30 and `Spots` to `4`, clicks `Create workshop`, and lands on the workshop page showing the name and `0 of 4 taken`.
2. The calendar for that month shows the workshop on the right day; clicking it opens the workshop page.
3. `decodeQr` returns exactly the booking link printed under the code.
4. On a phone context, opening the decoded link and booking `Potter One` shows `You're on the sign-up sheet, Potter One.`
5. `potter one` again shows the duplicate message; `Potter Two` to `Potter Four` book; `Potter Five` sees `This workshop is full`.
6. The workshop page shows `Full, all 4 taken`, the four names in order, and no `Book` link.
7. `Add to calendar` downloads a file ending in `.ics` whose unfolded text has `SUMMARY:<name>`, a UTC `DTSTART`, and `LOCATION` with the studio address.

- [ ] **Step 5: Create workshop (tables)**

`tests/e2e/create-workshop.spec.ts`:
- **Per course** (one row per `courses/*.json`, read the files in the test so a new course gets tests for free): the picker shows the course's `New … workshop` link and description; its form offers exactly the template's formats, preselects the template's length, and prefills the template's spot count and min-potters hint.
- **Rejected input** (UI): empty name; whitespace-only name; 81-character name; a date that already passed (yesterday); today at a time earlier than now; a date more than a year out; spots below the course's minimum; spots `31`; spots `ten`; each shows its exact message both in the summary (as a link to the field) and under the field, the page title starts with `Error: `, and every typed value is still in the form.
- **Rejected input** (direct POST with `request`, skipping the browser's own checks): a format not in the template; a length not offered (`45`); a missing field; each returns 400 with the message.
- **Accepted edge input**: exactly 80 characters; spots equal to the minimum and `30`; the last allowed date; a name with `<script>alert(1)</script>` (shown as text, no dialog fires: book a `page.on("dialog")` failure) and emoji.
- **Wrong addresses**: `/workshops/new/no-such-course` shows the 404 page.
- **Security**: a POST without `Origin` gets 403 and creates nothing; a body over 16 KB gets 413.

- [ ] **Step 6: Book (tables)**

`tests/e2e/book.spec.ts`:
- Open workshop: the form shows the label, the hint that the name is public, and the `Book` button; success leads to the confirmation page with the facts, `Add to calendar` and `See the workshop`.
- **Rejected names** (table): empty; whitespace only; 51 characters; each 400 with its message, the name kept, focus-able error summary or field error.
- **Duplicate spellings** (table, each against a workshop that already has `Alex Kim`): `Alex Kim`, `ALEX KIM`, `  alex   kim  `, full-width `Ａｌｅｘ Ｋｉｍ` (spell it with escapes in source); each shows the duplicate message quoting what was typed (tidied) and the sheet still has one Alex Kim.
- **Full workshop**: the page shows `This workshop is full` with no form; a direct POST gets 409 with the full message and the count doesn't change.
- **Closed workshop** (from `startedWorkshop()`): the page explains booking closed with the start time; a direct POST gets 409.
- **Wrong addresses** (table): `/workshops/not-a-uuid/book`, a random unknown UUID, `/bookings/not-a-uuid`, an unknown booking UUID; each 404 page.
- **Last spots under load**: a workshop with 5 spots, 12 simultaneous POSTs with different names through `request` (`Promise.all`): exactly 5 succeed (303 to a confirmation) and 7 get the full message; the workshop page shows `Full, all 5 taken`. This proves the one-statement insert end to end, through the real Worker and D1.
- **Phone**: the whole book flow in a `Pixel 7` context, with the button reachable without horizontal scrolling.

- [ ] **Step 7: Workshop page, calendar, site**

`tests/e2e/workshop-page.spec.ts`: facts show Vancouver time (`PDT`/`PST`) and the studio address; `Needs N potters to start.` with the right remaining count; the sheet has exactly `capacity` lines with names in order; the QR decodes to the page's link; `Add to calendar` content; the stamp and `This workshop is full.` on a full workshop; wrong addresses (table: bad id, unknown id, and the same for `qr.svg` and `invite.ics`) give 404.
`tests/e2e/calendar.spec.ts`: previous/next month links and `This month`; a workshop at 11:30 PM Vancouver shows on its own day; an empty far-future month shows the empty state with `Create a workshop`; bad months (table: `2026-13`, `october`, `1999-12`) give 404; the phone layout lists only days with workshops.
`tests/e2e/site.spec.ts`: security headers (table of pages: CSP exactly as in Global Constraints, `x-content-type-options: nosniff`, `x-frame-options`, `referrer-policy`); no page contains a `<script>` element; the skip link moves focus to the main content; header links reach the calendar and the create page; `/no-such-page` shows the 404 page with a working link home; `/courses.css` has a rule for every course.

- [ ] **Step 8: Run, fix, commit**

`npm run test:e2e` until green; fix the app (not the tests) when a real bug shows up, and list each such bug in the report. Record the suite's wall time and test count. Then `npm run test` and commit in two or three focused commits (config and helpers; functional specs; anything the tests forced you to fix in the app goes in its own `fix:` commit).

---

### Task 15: Accessibility and page speed audits (Pa11y, Lighthouse)

**Files:**

- Create: `types/pa11y.d.ts`, `tests/e2e/accessibility.spec.ts`, `tests/e2e/page-speed.spec.ts`
- Modify: `playwright.config.ts` (an `audits` project that depends on `e2e`)

Read `research/a11y-perf.md` (sections 4, 5, 8, 9) and copy the verified patterns from `proto-a11y/recommended/pa11y.spec.ts` and `proto-a11y/recommended/lighthouse.spec.ts`: one puppeteer browser launched with `executablePath: chromium.executablePath()` shared across Pa11y runs with `runners: ["htmlcs", "axe"]` and `standard: "WCAG2AA"`; Lighthouse through `chrome-launcher` with `chromePath: chromium.executablePath()`, the desktop config, `throttlingMethod: "simulate"`. `.puppeteerrc.json` already has `{ "skipDownload": true }`. `types/pa11y.d.ts` declares only what we use. Audits run in their own project after `e2e` so Lighthouse measures a quiet machine; run Pa11y and Lighthouse serially.

- [ ] **Step 1: Pa11y** — one test per page (a table): `/`, a month with workshops, `/workshops/new`, each course's form, the form after a failed submit, an open workshop page, a full workshop page, a closed workshop page, the book page (open, full, closed), the confirmation page, and `/no-such-page`, in both desktop and phone viewports. Zero errors each; print code, selector and message on failure. Include the research's canary (a deliberately broken page must produce errors).
- [ ] **Step 2: Lighthouse** — one test per page (a table): `/`, a workshop page, its book page, `/workshops/new`. Thresholds: performance ≥ 0.90, accessibility = 1, best practices = 1, SEO = 1; on failure print each score and the failing audits.
- [ ] **Step 3: Run, fix, commit** — fix the app, not the thresholds (real contrast problems, missing labels, unsized images); keep the whole browser suite within its time budget; `npm run test`; commit.

---

### Task 16: Mutation testing

**Files:**

- Create: `stryker.config.json`
- Modify: `package.json` (`test:mutation` script), tests where survivors show real gaps

- [ ] **Step 1: Configure**

```json
{
  "$schema": "./node_modules/@stryker-mutator/core/schema/stryker-schema.json",
  "packageManager": "npm",
  "testRunner": "vitest",
  "checkers": ["typescript"],
  "tsconfigFile": "tsconfig.json",
  "coverageAnalysis": "perTest",
  "mutate": [
    "src/**/*.ts",
    "src/**/*.tsx",
    "!src/**/*.test.ts",
    "!src/**/*.test.tsx",
    "!src/index.ts"
  ],
  "reporters": ["html", "clear-text", "progress"],
  "htmlReporter": { "fileName": "reports/mutation/index.html" },
  "incremental": true,
  "incrementalFile": "reports/stryker-incremental.json",
  "thresholds": { "high": 90, "low": 80, "break": 80 }
}
```

`"test:mutation": "stryker run"`. Stryker needs `typescript@6.0.3` and `vitest@4.1.9` (already pinned). If the checker can't resolve test-only types with `tsconfig.json`, point `tsconfigFile` at `tsconfig.node.json`.

- [ ] **Step 2: Run and read the survivors**

`npm run test:mutation`. For each surviving mutant in logic (parsers, time, grid, templates, repositories, routes, invite, form parsing), add or sharpen a test that a person would care about, so the mutant dies. Don't chase survivors that only change CSS class names or decorative markup with class-name assertions; if view files drag the score below the threshold for that reason alone, narrow `mutate` for those files and explain it in the report. Record the final score per folder in the report.

- [ ] **Step 3: Set the threshold and commit**

Set `thresholds.break` to the achieved score rounded down to the nearest 5 (never below 80).

```bash
npm run test
git add -A
git commit -m "test: add mutation testing and close the gaps it found"
```

---

### Task 17: README and screenshots

**Files:**

- Modify: `README.md`
- Create: `docs/screenshots/calendar.png`, `docs/screenshots/workshop.png`, `docs/screenshots/new-workshop.png`, `docs/screenshots/book.png`

- [ ] **Step 1: Screenshots** from the seeded local app (`npm run dev`) with Playwright's Chromium through a throwaway script in the scratchpad: the calendar month with the seeded workshops (1280×800), a busy workshop page with its sign-up sheet and QR code (1280×1000 or full page), the new-workshop form for one course (1280×800), and the booking page on a phone (390×844, device scale 2). Keep each PNG under ~400 KB.

- [ ] **Step 2: README**

Short and plain. One or two sentences on what it is; a 2×2 table of the four screenshots with short captions; a "Run it" section listing `./bootstrap` (installs Node via Homebrew, npm packages, the test browser, and a seeded local database), `npm run dev`, `npm run test`, `npm run deploy`; then a few bullets on how it works: templates in `courses/*.json` (adding a course is adding a file), capacity enforced by one conditional insert, times in Vancouver, `npm run test:mutation` for mutation testing. No marketing words.

- [ ] **Step 3: Check and commit**

`bun ~/tools/evaluator/live/evaluate.ts . --readme --config ~/tools/evaluator/examples/claybank.json` must pass. Then run the normal pre-commit evaluator and commit:

```bash
git add README.md docs
git commit -m "docs: add readme with screenshots and commands"
```

---

### Task 18: Deploy to claybankstudio.com

(Controller-run, not delegated: it touches the user's Cloudflare account.)

- [ ] Add `"routes": [{ "pattern": "claybankstudio.com", "custom_domain": true }]` to `wrangler.jsonc`, commit (`chore(deploy): serve the worker on claybankstudio.com`).
- [ ] `npm run deploy` (build, remote migrations, deploy). Confirm the custom domain is attached.
- [ ] Check the live site: `bun ~/tools/evaluator/live/evaluate.ts --site https://claybankstudio.com --config ~/tools/evaluator/examples/claybank.json`, plus a manual pass: create a workshop, open it, scan the QR code image (decode it), book, download the `.ics`.
- [ ] Add a handful of upcoming sample workshops on production through the live create-workshop form (not the seed script) so the calendar isn't empty.
