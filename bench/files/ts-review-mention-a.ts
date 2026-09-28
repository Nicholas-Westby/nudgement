/**
 * The app's behaviour, expressed without any dependency on Bolt or the Slack SDK.
 *
 * `src/index.ts` is the thin Bolt wiring that calls into here. Everything in this file is
 * testable by handing it a `FakeSlack` and an `InMemoryGroupStore`, which is how the whole
 * flow gets exercised without a Slack workspace.
 */
import { parseRequest } from "./jira.js";
import { pickReviewer } from "./picker.js";
import { emptyGroup, type Group, type GroupStore } from "./groups.js";
import type { SlackLike } from "./slack.js";
import {
  buildAssignmentBlocks,
  buildGroupSetupBlocks,
  escapeText,
  renderFallbackText,
} from "./format.js";

export interface AppMentionEvent {
  type: "app_mention";
  user?: string;
  text: string;
  ts: string;
  channel: string;
  event_ts: string;
  /** Present only when the bot was mentioned inside an existing thread. */
  thread_ts?: string;
  /** Present when the message came from a bot — including this bot. */
  bot_id?: string;
}

export interface Deps {
  slack: SlackLike;
  store: GroupStore;
  random?: () => number;
  now?: () => Date;
  /**
   * Event IDs already handled. Slack retries an event up to three times if it does not get
   * a 2xx within three seconds, so without this the bot double-posts. An in-memory Set is
   * fine for a single long-lived process; on Lambda this needs to be Redis/DynamoDB,
   * because each cold start gets a fresh, empty Set.
   */
  seen?: Set<string>;
}

const HELP =
  "Give me a Jira link or an issue key and I'll pick a reviewer, e.g. " +
  "`@PrReview https://your-site.atlassian.net/browse/SMRT1002-2153`.";

export async function handleAppMention(
  event: AppMentionEvent,
  teamId: string,
  deps: Deps,
): Promise<void> {
  // Never react to a bot, least of all ourselves: an @mention in our own reply would
  // otherwise trigger another app_mention and loop forever.
  if (event.bot_id) return;
  const requesterId = event.user;
  if (!requesterId) return;

  const seen = (deps.seen ??= new Set<string>());
  const eventKey = `${teamId}:${event.channel}:${event.ts}`;
  if (seen.has(eventKey)) return;
  seen.add(eventKey);

  // Reply in the thread the bot was mentioned in, or start a new one hung off the
  // triggering message. Passing the triggering message's `ts` as `thread_ts` is what
  // "starts a thread" — there is no separate create-thread call.
  const threadTs = event.thread_ts ?? event.ts;

  const parsed = parseRequest(event.text);
  if (!parsed) {
    await deps.slack.postEphemeral({
      channel: event.channel,
      user: requesterId,
      text: HELP,
      thread_ts: threadTs,
    });
    return;
  }

  const now = deps.now ?? (() => new Date());
  const group =
    (await deps.store.get(teamId, parsed.groupKey)) ?? emptyGroup(parsed.groupKey, now());

  const result = pickReviewer({
    roster: group.members,
    bag: group.bag,
    requesterId,
    unavailable: group.unavailable,
    ...(deps.random ? { random: deps.random } : {}),
  });

  const updated: Group = { ...group, bag: result.bag };
  await deps.store.upsert(teamId, updated);

  if (!result.picked) {
    await deps.slack.postMessage({
      channel: event.channel,
      thread_ts: threadTs,
      text:
        `I don't have anyone to pick for *${escapeText(parsed.groupKey)}* yet ` +
        `(${reasonPhrase(result.reason)}). Add yourself and I'll start rotating.`,
      blocks: buildGroupSetupBlocks({
        groupKey: parsed.groupKey,
        issueKey: parsed.issueKey,
        url: parsed.url,
        reason: result.reason,
      }),
    });
    return;
  }

  const names = await deps.slack.displayNames([result.picked, ...result.others]);
  const view = {
    issueKey: parsed.issueKey,
    url: parsed.url,
    groupKey: parsed.groupKey,
    pickedId: result.picked,
    otherIds: result.others,
    displayNames: names,
  };

  await deps.slack.postMessage({
    channel: event.channel,
    thread_ts: threadTs,
    text: renderFallbackText(view),
    blocks: buildAssignmentBlocks(view),
  });
}

function reasonPhrase(reason: string | null): string {
  switch (reason) {
    case "requester-only":
      return "you're the only member";
    case "all-unavailable":
      return "everyone is marked away";
    default:
      return "the group is empty";
  }
}

export interface JoinGroupAction {
  userId: string;
  channel: string;
  groupKey: string;
  threadTs: string;
}

/** Handler for the "Add me to <GROUP>" button. */
export async function handleJoinGroup(
  action: JoinGroupAction,
  teamId: string,
  deps: Deps,
): Promise<void> {
  const now = deps.now ?? (() => new Date());
  const group =
    (await deps.store.get(teamId, action.groupKey)) ?? emptyGroup(action.groupKey, now());

  if (!group.members.includes(action.userId)) {
    group.members = [...group.members, action.userId];
    await deps.store.upsert(teamId, group);
  }

  // Ephemeral: the person who clicked gets confirmation, the channel stays quiet.
  await deps.slack.postEphemeral({
    channel: action.channel,
    user: action.userId,
    thread_ts: action.threadTs,
    text: `You're in the *${escapeText(action.groupKey)}* review rotation (${group.members.length} member${
      group.members.length === 1 ? "" : "s"
    }).`,
  });
}
