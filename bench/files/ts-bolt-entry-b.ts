/**
 * Bolt wiring.
 *
 * Everything Slack-shaped lives here: token plumbing, the Web API adapter, the group store,
 * the receiver choice, and the four listener registrations. The listeners delegate into
 * `src/app.ts`, which knows nothing about Bolt.
 *
 * Run it with Socket Mode (`SLACK_APP_TOKEN` set) and you need no public URL at all — the
 * process dials out to Slack over a WebSocket. Drop the app token and it becomes an HTTP
 * server that Slack posts events to, which is what you want behind a load balancer.
 */
// Bolt 5 is published as CommonJS with no `exports` map, but Node's cjs-module-lexer
// picks up its named exports, so this works from an ESM entry point.
import { App, LogLevel } from "@slack/bolt";
import type { BlockAction, ButtonAction } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";

import { handleAppMention, handleJoinGroup, type AppMentionEvent, type Deps } from "./app.js";
import type { DisplayNames } from "./format.js";
import type { Group, GroupStore } from "./groups.js";
import type { EphemeralArgs, PostArgs, SlackLike } from "./slack.js";

/**
 * The production implementation of the `SlackLike` seam, wrapping `@slack/web-api`.
 *
 * The only interesting part is `displayNames`: resolving user IDs to names is a per-user
 * API call, and `users.info` sits in a low rate-limit tier, so results are cached. Slack's
 * guidance is to keep a local copy of the user list rather than look people up on every
 * message.
 */
class SlackWebApi implements SlackLike {
  private readonly cache = new Map<string, string>();

  constructor(private readonly client: WebClient) {}

  async postMessage(args: PostArgs): Promise<{ ts: string }> {
    const result = await this.client.chat.postMessage({
      channel: args.channel,
      text: args.text,
      ...(args.blocks ? { blocks: args.blocks as never } : {}),
      ...(args.thread_ts ? { thread_ts: args.thread_ts } : {}),
      // Deliberately NOT setting `link_names` or `parse`. Per the current chat.postMessage
      // reference, `link_names` "no longer supports linking individual users" (it now only
      // links user groups), and `parse: "full"` treats the text as raw input and re-escapes
      // bracket syntax — which would break the one `<@…>` mention we *do* want to work.
    });
    return { ts: String(result.ts) };
  }

  async postEphemeral(args: EphemeralArgs): Promise<void> {
    await this.client.chat.postEphemeral({
      channel: args.channel,
      user: args.user,
      text: args.text,
      ...(args.blocks ? { blocks: args.blocks as never } : {}),
      ...(args.thread_ts ? { thread_ts: args.thread_ts } : {}),
    });
  }

  async displayNames(userIds: readonly string[]): Promise<DisplayNames> {
    const out: Record<string, string> = {};
    for (const id of userIds) {
      const cached = this.cache.get(id);
      if (cached) {
        out[id] = cached;
        continue;
      }
      try {
        const info = await this.client.users.info({ user: id });
        const profile = info.user?.profile;
        const name =
          profile?.display_name || profile?.real_name || info.user?.name || id;
        this.cache.set(id, name);
        out[id] = name;
      } catch {
        // A deactivated or invisible user should not take the whole message down.
        out[id] = id;
      }
    }
    return out;
  }
}

const clone = (group: Group): Group => structuredClone(group);

/** Good enough for tests and a single-process bot; swap for Postgres/DynamoDB in anger. */
class InMemoryGroupStore implements GroupStore {
  private readonly data = new Map<string, Map<string, Group>>();

  private team(teamId: string): Map<string, Group> {
    let workspace = this.data.get(teamId);
    if (!workspace) {
      workspace = new Map();
      this.data.set(teamId, workspace);
    }
    return workspace;
  }

  async get(teamId: string, key: string): Promise<Group | null> {
    const found = this.team(teamId).get(key);
    return found ? clone(found) : null;
  }

  async upsert(teamId: string, group: Group): Promise<void> {
    this.team(teamId).set(group.key, clone(group));
  }

  async list(teamId: string): Promise<Group[]> {
    return [...this.team(teamId).values()].map(clone);
  }
}

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
