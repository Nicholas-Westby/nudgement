# nudgement.dev

A static, single-page introduction to nudgement, deployed with Cloudflare Workers Static Assets.
The `no-transform` response header prevents Cloudflare from injecting its analytics beacon.
Only `public/` is uploaded. There is no server code, visitor tracking, external font request or live Jev call.
The examples come from [NUDGEMENTS.md](../NUDGEMENTS.md); keep the excerpts and source licenses in sync when changing them.

```sh
cd website
bun install --frozen-lockfile
bun run dev                    # http://localhost:8787
bun run test                   # Playwright + axe, desktop and mobile
bun run audit                  # Lighthouse; keep the preview running
bun run deploy                 # deploy to nudgement.dev using Wrangler's login
```

Install the test browser once with `bunx playwright install chromium` (`--with-deps` on Linux).
To test the deployed site, set `SITE_URL=https://nudgement.dev` for `test` or `audit`.
The audit requires performance ≥95 and accessibility, best practices and SEO scores of 100.
Reports go to ignored `audit-results/`; browser failures keep traces in `test-results/`.
Automated accessibility checks supplement manual keyboard, zoom and visual inspection.

`public/margin.js` moves a pencil with reading progress and nudges marked elements for 2.8 seconds.
Each cue can repeat after the reader scrolls away and returns. Arrows follow their targets during scrolling.
Their shafts stay under 140 pixels, detaching from the pencil when it moves farther away.
It schedules frames only after scroll/resize, waits for a reading pause before starting a cue,
and stops when the tab is hidden, motion is paused or reduced motion is requested.
The page and annotated draft remain usable without JavaScript. Examples read before → nudgement → after
in both document order and the responsive layout.

Review the page copy from the repository root:

```sh
bun evaluate.ts . --copy website/public/index.html --config website/nudgement.json
```

This review sends the page text to Jev. The configuration describes its developer audience.
