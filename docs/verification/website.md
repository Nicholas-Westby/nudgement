# Website verification — 2026-09-29

[Live site](https://nudgement.dev) · [Machine-readable results](website.json) · [Maintenance](../../website/README.md)

The deployed site passed 32 browser tests on desktop and mobile: all four examples,
axe accessibility checks, keyboard controls, clipboard success and denial, reduced motion,
JavaScript disabled, 320px layouts, doubled text, local links, 404s and no third-party scripts.
Desktop and mobile screenshots were inspected. Automated audits do not establish full WCAG conformance.

| Live Lighthouse category | Mobile | Desktop |
| --- | ---: | ---: |
| Performance | 99 | 100 |
| Accessibility | 100 | 100 |
| Best practices | 100 | 100 |
| SEO | 100 | 100 |

Both runs recorded zero layout shift and zero total blocking time. Scores are lab measurements,
not field guarantees. CI requires performance ≥95 and 100 in the other categories, without skipped audits.

Local audits initially reached 100 across all categories. The first live audit found a
Cloudflare-injected analytics beacon blocked by the content security policy. Adding
`Cache-Control: no-transform` removed the injection; a browser regression test checks for it.

nudgement reviewed the website's code, tests, comments, 28 copy strings and feature commit.
Its findings led to named curve coordinates, focused browser tests, an explanation of the
reduced-motion check and a clearer license link. Decorative drawing widths and some integration-test
structure remain intentional despite advisory findings. Recorded example content was preserved.

The repository's lint, typecheck and all 251 offline tests passed. Its FTA guard now includes
the website's JavaScript source and tests and keeps every analyzed file below 60.
