/**
 * Bolt wiring.
 *
 * Everything Slack-shaped lives here: token plumbing, the receiver choice, and the four
 * listener registrations. All of it delegates immediately into `src/app.ts`, which knows
 * nothing about Bolt.
 *
 * Run it with Socket Mode (`SLACK_APP_TOKEN` set) and you need no public URL at all — the
 * process dials out to Slack over a WebSocket. Drop the app token and it becomes an HTTP
 * server that Slack posts events to, which is what you want behind a load balancer.
 */
// Bolt 5 is published as CommonJS with no `exports` map, but Node's cjs-module-lexer
// picks up its named exports, so this works from an ESM entry point.
import { App, LogLevel } from "@slack/bolt";
import type { BlockAction, ButtonAction } from "@slack/bolt";

import { handleAppMention, handleJoinGroup, type AppMentionEvent, type Deps } from "./app.js";
import { InMemoryGroupStore } from "./groups.js";
import { SlackWebApi } from "./slack-web.js";

/**
 * Bolt's `AppOptions` declares `signingSecret?: string`, not `string | undefined`, so with
 * `exactOptionalPropertyTypes` a possibly-undefined `process.env` value will not typecheck.
 * Failing loudly at boot is better than booting with an undefined secret anyway.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

const appToken = process.env.SLACK_APP_TOKEN;
const socketMode = Boolean(appToken);

const app = new App({
  token: requireEnv("SLACK_BOT_TOKEN"),
  signingSecret: requireEnv("SLACK_SIGNING_SECRET"),
  ...(appToken ? { socketMode: true, appToken } : {}),
  logLevel: LogLevel.INFO,
});

// Swap InMemoryGroupStore for a real database before this leaves your laptop: every
// restart currently forgets both the rosters and the rotation state.
const store = new InMemoryGroupStore();
const seen = new Set<string>();

function deps(client: ConstructorParameters<typeof SlackWebApi>[0]): Deps {
  return { slack: new SlackWebApi(client), store, seen };
}

// Events (as opposed to interactive payloads) are acknowledged by Bolt itself — there is
// no `ack` in the listener args. Slack still expects that 2xx within three seconds and
// retries up to three times if it does not get one, which is why `handleAppMention`
// deduplicates on event key.
app.event("app_mention", async ({ event, client, context }) => {
  await handleAppMention(
    event as unknown as AppMentionEvent,
    context.teamId ?? "",
    deps(client),
  );
});

app.action<BlockAction<ButtonAction>>(
  "join_group",
  async ({ ack, body, action, client, context }) => {
    await ack();
    await handleJoinGroup(
      {
        userId: body.user.id,
        channel: body.channel?.id ?? "",
        groupKey: action.value ?? "",
        threadTs: body.message?.thread_ts ?? body.message?.ts ?? "",
      },
      context.teamId ?? "",
      deps(client),
    );
  },
);

// A button click that we handle elsewhere still has to be acknowledged within 3 seconds,
// or Slack shows the user a red "this app isn't responding" warning.
app.action<BlockAction<ButtonAction>>("reroll_reviewer", async ({ ack }) => {
  await ack();
});
app.action<BlockAction<ButtonAction>>("add_people", async ({ ack }) => {
  await ack();
});

app.error(async (error: Error) => {
  console.error("bolt error", error);
});

const port = Number(process.env.PORT ?? 3000);
if (socketMode) {
  // No public URL, no inbound firewall rule: the process dials out to Slack over WSS.
  await app.start();
  console.log("⚡️ pr-review-picker running (socket mode)");
} else {
  await app.start(port);
  console.log(`⚡️ pr-review-picker running (http :${port})`);
}
