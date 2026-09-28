# Prototype

The parts of `@PrReview` that can be built and proven **without a Slack workspace** — which
turns out to be most of them.

```bash
npm install
npm test        # 63 tests
npm run typecheck
```

No tokens, no network, no Slack account required.

## What each file is for

| File | Demonstrates |
| --- | --- |
| [`src/jira.ts`](src/jira.ts) | Slack link unwrapping, and the issue-key regex that survives `SMRT1002-2153` |
| [`src/picker.ts`](src/picker.ts) | The shuffle-bag reviewer rotation. Pure function of (roster, bag, rng) |
| [`src/format.ts`](src/format.ts) | Building the message: `<@U…>` for the pick, escaped plain text for everyone else |
| [`src/groups.ts`](src/groups.ts) | Group storage, and why this isn't Slack User Groups |
| [`src/slack.ts`](src/slack.ts) | The four-method seam that makes everything else testable |
| [`src/slack-web.ts`](src/slack-web.ts) | The real implementation over `@slack/web-api` |
| [`src/app.ts`](src/app.ts) | The behaviour: threading, dedup, self-message guard, auto-create |
| [`src/signing.ts`](src/signing.ts) | Slack's request-signing recipe — needed to *drive* the app in tests |
| [`src/index.ts`](src/index.ts) | The Bolt 5 wiring. Socket Mode when `SLACK_APP_TOKEN` is set |
| [`manifest.yml`](manifest.yml) | The Slack-side app configuration, ready to paste |

## The four test layers

1. **Pure logic** — [`jira`](test/jira.test.ts), [`picker`](test/picker.test.ts),
   [`format`](test/format.test.ts), [`groups`](test/groups.test.ts). No Slack anywhere.
2. **Handler against a fake** — [`app.test.ts`](test/app.test.ts) with
   [`fake-slack.ts`](test/fake-slack.ts). Asserts on what the app *tried* to send.
3. **Signing** — [`signing.test.ts`](test/signing.test.ts). Checked against Slack's own
   published worked example *and* against Bolt's exported `verifySlackRequest`.
4. **Full offline integration** — [`e2e-http.test.ts`](test/e2e-http.test.ts). A real Bolt
   `App` with `clientOptions.slackApiUrl` pointed at
   [`fake-slack-server.ts`](test/fake-slack-server.ts), driven by signed synthetic HTTP
   requests. Bolt's real signature verification, routing and dispatch all run.

## Running it for real

```bash
export SLACK_BOT_TOKEN=xoxb-…
export SLACK_SIGNING_SECRET=…
export SLACK_APP_TOKEN=xapp-…      # omit to run in HTTP mode on $PORT instead
npx tsx src/index.ts
```

Two things to change before this is more than a demo:

- `InMemoryGroupStore` forgets every roster and rotation on restart.
- The `seen` event-dedup Set is per-process, so it does nothing on serverless.
