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

`public/trajectory.js` draws only on input or resize. It honors reduced motion, caps pixel density,
and stops animation when the tab is hidden. The inline SVG remains when scripts or canvas are unavailable.
The rest of the page is plain HTML; the example picker and clipboard button appear only when usable.
