# pr-review-picker

Research notes and a working prototype for a **Slack app that auto-picks a code reviewer**
for a given Jira ticket, starts a thread, and @-mentions the chosen person.

> **Status: research + prototype.** Nothing is deployed and nothing is installed in a Slack
> workspace. The goal is to understand *how such an app gets built*, end to end, with sources.

## The idea

```
@PrReview https://rhythmagency.atlassian.net/browse/SMRT1002-2153
```

```
  👀 @Grace Hopper is up for code review on SMRT1002-2153.
     Also in SMRT1002 (not notified): Alan Turing, Katherine Johnson
     [ Pick someone else ]  [ Add me to SMRT1002 ]
```

1. Derive a **group key** from the issue key — everything before the final `-<digits>`
   (`SMRT1002-2153` → `SMRT1002`).
2. **Auto-create** that group the first time it's seen.
3. **Pick** a reviewer, fairly and unpredictably.
4. **Start a thread** on the triggering message.
5. **@-mention** the picked person, so they get a notification.
6. **Name** the others without notifying them.
7. Make **joining a group** one click.

## Start here

**[docs/HOW-TO-BUILD-A-SLACK-APP.md](docs/HOW-TO-BUILD-A-SLACK-APP.md)** — the walkthrough:
what a Slack app actually is, the five decisions and how they land, the exact manifest, the
request lifecycle, each mechanism concretely, and the things that will bite you.

## Layout

| Path | What it is |
| --- | --- |
| [`docs/HOW-TO-BUILD-A-SLACK-APP.md`](docs/HOW-TO-BUILD-A-SLACK-APP.md) | The main write-up |
| [`docs/research/00-verified-locally.md`](docs/research/00-verified-locally.md) | Facts established by running code — highest confidence |
| [`docs/research/01-platform-and-sdks.md`](docs/research/01-platform-and-sdks.md) | Manifests, tokens, OAuth, Socket Mode vs HTTP, Bolt, hosting |
| [`docs/research/02-messaging-mentions-threads.md`](docs/research/02-messaging-mentions-threads.md) | `app_mention`, threads, **notification semantics**, Block Kit |
| [`docs/research/03-groups-storage-admin-ux.md`](docs/research/03-groups-storage-admin-ux.md) | User Groups, storage options, Home tab, modals, unfurling |
| [`docs/research/04-reviewer-selection-and-jira.md`](docs/research/04-reviewer-selection-and-jira.md) | Assignment prior art, algorithms, Jira keys and URLs |
| [`docs/research/05-dev-loop-testing-deployment.md`](docs/research/05-dev-loop-testing-deployment.md) | Bootstrap, offline testing, CI, deployment |
| [`prototype/`](prototype/) | Working TypeScript. `npm test` → 63 tests, no Slack needed |

## The four findings that shaped the design

1. **`<@U123>` notifies; plain text doesn't.** That asymmetry *is* the "mention some, name
   the rest" feature — no trick required. Don't reach for `link_names` (it no longer links
   individual users) or `parse: "full"` (it would re-escape the one mention you want).
2. **Don't build this on Slack User Groups.** Paid plan only, writes gated behind a workspace
   admin toggle you don't control, and groups can never be deleted — so auto-creating one per
   Jira key permanently burns a handle on every typo.
3. **`SMRT1002-2153` breaks the obvious regex.** `/([A-Z]+)-(\d+)/` matches *nothing*,
   because Jira project keys may contain digits. Anchor on `\b([A-Z][A-Z0-9_]*)-(\d+)\b`.
4. **You can build almost all of this offline.** A real Bolt app, driven by signed synthetic
   requests, with `clientOptions.slackApiUrl` pointed at a local fake — see
   [`prototype/test/e2e-http.test.ts`](prototype/test/e2e-http.test.ts).
