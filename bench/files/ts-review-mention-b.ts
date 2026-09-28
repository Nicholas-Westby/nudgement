/**
 * The app's behaviour, expressed without any dependency on Bolt or the Slack SDK.
 *
 * `src/index.ts` is the thin Bolt wiring that calls into here. Everything in this file is
 * testable by handing it a `FakeSlack` and an `InMemoryGroupStore`, which is how the whole
 * flow gets exercised without a Slack workspace.
 */
import { parseRequest, type ParsedRequest } from "./jira.js";
import { pickReviewer, type PickFailure, type PickResult } from "./picker.js";
import { emptyGroup, type Group, type GroupStore } from "./groups.js";
import type { SlackLike } from "./slack.js";
import {
  buildAssignmentBlocks,
  buildGroupSetupBlocks,
  escapeText,
  renderFallbackText,
  type AssignmentView,
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

export interface JoinGroupAction {
  userId: string;
  channel: string;
  groupKey: string;
  threadTs: string;
}

/** What happened to a mention, for logging and tests. */
export type MentionOutcome =
  | { status: "ignored"; reason: "bot" | "no-user" | "duplicate" }
  | { status: "help" }
  | { status: "no-reviewer"; reason: PickFailure | null }
  | { status: "assigned"; reviewer: string };

const HELP =
  "Give me a Jira link or an issue key and I'll pick a reviewer, e.g. " +
  "`@PrReview https://your-site.atlassian.net/browse/SMRT1002-2153`.";

const LOG_PREFIX = "[pr-review-picker]";

const REASON_PHRASES: Record<PickFailure, string> = {
  "empty-group": "the group is empty",
  "requester-only": "you're the only member",
  "all-unavailable": "everyone is marked away",
};

/**
 * Tracks which events have already been processed, so Slack's retries are ignored.
 */
export class EventDeduplicator {
  constructor(private readonly seen: Set<string>) {}

  /** Builds the deduplication key for an event. */
  static keyFor(teamId: string, event: AppMentionEvent): string {
    return `${teamId}:${event.channel}:${event.ts}`;
  }

  /** Returns true if the key was seen before; records it otherwise. */
  checkAndRecord(key: string): boolean {
    if (this.seen.has(key)) {
      return true;
    }
    this.seen.add(key);
    return false;
  }
}

/**
 * Wraps the group store with get-or-create semantics.
 */
export class GroupRepository {
  constructor(
    private readonly store: GroupStore,
    private readonly now: () => Date,
  ) {}

  /** Loads a group, or returns a fresh empty one when it does not exist yet. */
  async getOrCreate(teamId: string, key: string): Promise<Group> {
    const existing = await this.store.get(teamId, key);
    if (existing) {
      console.log(`${LOG_PREFIX} Found group ${key} with ${existing.members.length} member(s)`);
      return existing;
    }
    console.log(`${LOG_PREFIX} No group ${key} yet, starting an empty one`);
    return emptyGroup(key, this.now());
  }

  /** Persists a group. */
  async save(teamId: string, group: Group): Promise<void> {
    await this.store.upsert(teamId, group);
  }
}

/**
 * Orchestrates reviewer assignment and group membership.
 */
export class ReviewAssignmentService {
  private readonly slack: SlackLike;
  private readonly groups: GroupRepository;

  constructor(private readonly deps: Deps) {
    if (!deps) throw new Error("ReviewAssignmentService requires deps");
    if (!deps.slack) throw new Error("ReviewAssignmentService requires deps.slack");
    if (!deps.store) throw new Error("ReviewAssignmentService requires deps.store");
    this.slack = deps.slack;
    this.groups = new GroupRepository(deps.store, deps.now ?? (() => new Date()));
  }

  /** Handles an `app_mention` event. */
  async handleMention(event: AppMentionEvent, teamId: string): Promise<MentionOutcome> {
    console.log(`${LOG_PREFIX} handleMention start`, { teamId, channel: event.channel, ts: event.ts });

    // Never react to a bot, least of all ourselves: an @mention in our own reply would
    // otherwise trigger another app_mention and loop forever.
    if (event.bot_id) {
      console.log(`${LOG_PREFIX} Ignoring a message from bot ${event.bot_id}`);
      return { status: "ignored", reason: "bot" };
    }
    const requesterId = event.user;
    if (!requesterId) {
      console.log(`${LOG_PREFIX} Ignoring an event with no user`);
      return { status: "ignored", reason: "no-user" };
    }

    const deduplicator = new EventDeduplicator((this.deps.seen ??= new Set<string>()));
    if (deduplicator.checkAndRecord(EventDeduplicator.keyFor(teamId, event))) {
      console.log(`${LOG_PREFIX} Duplicate event, skipping`);
      return { status: "ignored", reason: "duplicate" };
    }

    const threadTs = this.resolveThread(event);

    const parsed = parseRequest(event.text);
    if (!parsed) {
      console.log(`${LOG_PREFIX} No issue key in the message, sending help`);
      await this.sendHelp(event.channel, requesterId, threadTs);
      return { status: "help" };
    }
    console.log(`${LOG_PREFIX} Parsed request`, parsed);

    const group = await this.groups.getOrCreate(teamId, parsed.groupKey);
    const result = this.pick(group, requesterId);

    const updated: Group = { ...group, bag: result.bag };
    await this.groups.save(teamId, updated);

    if (!result.picked) {
      console.log(`${LOG_PREFIX} Nobody to pick: ${result.reason}`);
      await this.sendGroupSetup(event.channel, threadTs, parsed, result);
      return { status: "no-reviewer", reason: result.reason };
    }

    console.log(`${LOG_PREFIX} Picked ${result.picked}`);
    await this.sendAssignment(event.channel, threadTs, parsed, result, result.picked);
    console.log(`${LOG_PREFIX} handleMention done`);
    return { status: "assigned", reviewer: result.picked };
  }

  /** Handles the "Add me to <GROUP>" button. */
  async joinGroup(action: JoinGroupAction, teamId: string): Promise<void> {
    console.log(`${LOG_PREFIX} joinGroup start`, action);
    if (!action.userId) {
      console.warn(`${LOG_PREFIX} joinGroup called without a user ID`);
    }

    const group = await this.groups.getOrCreate(teamId, action.groupKey);

    const alreadyMember = group.members.includes(action.userId);
    if (!alreadyMember) {
      group.members = [...group.members, action.userId];
      await this.groups.save(teamId, group);
      console.log(`${LOG_PREFIX} Added ${action.userId} to ${action.groupKey}`);
    } else {
      console.log(`${LOG_PREFIX} ${action.userId} is already in ${action.groupKey}`);
    }

    const count = group.members.length;
    const plural = count === 1 ? "" : "s";

    // Ephemeral: the person who clicked gets confirmation, the channel stays quiet.
    try {
      await this.slack.postEphemeral({
        channel: action.channel,
        user: action.userId,
        thread_ts: action.threadTs,
        text: `You're in the *${escapeText(action.groupKey)}* review rotation (${count} member${plural}).`,
      });
    } catch (error) {
      console.error(`${LOG_PREFIX} Failed to confirm group membership`, error);
      throw error;
    }
    console.log(`${LOG_PREFIX} joinGroup done`);
  }

  /**
   * Reply in the thread the bot was mentioned in, or start a new one hung off the
   * triggering message. Passing the triggering message's `ts` as `thread_ts` is what
   * "starts a thread" — there is no separate create-thread call.
   */
  private resolveThread(event: AppMentionEvent): string {
    return event.thread_ts ?? event.ts;
  }

  private pick(group: Group, requesterId: string): PickResult {
    return pickReviewer({
      roster: group.members,
      bag: group.bag,
      requesterId,
      unavailable: group.unavailable,
      ...(this.deps.random ? { random: this.deps.random } : {}),
    });
  }

  private async sendHelp(channel: string, user: string, threadTs: string): Promise<void> {
    try {
      await this.slack.postEphemeral({ channel, user, text: HELP, thread_ts: threadTs });
    } catch (error) {
      console.error(`${LOG_PREFIX} Failed to send the help message`, error);
      throw error;
    }
  }

  private async sendGroupSetup(
    channel: string,
    threadTs: string,
    parsed: ParsedRequest,
    result: PickResult,
  ): Promise<void> {
    try {
      await this.slack.postMessage({
        channel,
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
    } catch (error) {
      console.error(`${LOG_PREFIX} Failed to post the group setup message`, error);
      throw error;
    }
  }

  private async sendAssignment(
    channel: string,
    threadTs: string,
    parsed: ParsedRequest,
    result: PickResult,
    pickedId: string,
  ): Promise<void> {
    const names = await this.slack.displayNames([pickedId, ...result.others]);
    const view: AssignmentView = {
      issueKey: parsed.issueKey,
      url: parsed.url,
      groupKey: parsed.groupKey,
      pickedId,
      otherIds: result.others,
      displayNames: names,
    };

    try {
      await this.slack.postMessage({
        channel,
        thread_ts: threadTs,
        text: renderFallbackText(view),
        blocks: buildAssignmentBlocks(view),
      });
    } catch (error) {
      console.error(`${LOG_PREFIX} Failed to post the assignment`, error);
      throw error;
    }
  }
}

function reasonPhrase(reason: PickFailure | null): string {
  if (reason === null || reason === undefined) {
    return REASON_PHRASES["empty-group"];
  }
  const phrase = REASON_PHRASES[reason];
  if (!phrase) {
    console.warn(`${LOG_PREFIX} Unknown pick failure reason: ${reason}`);
    return REASON_PHRASES["empty-group"];
  }
  return phrase;
}

/** Creates a {@link ReviewAssignmentService}. */
export function createReviewAssignmentService(deps: Deps): ReviewAssignmentService {
  return new ReviewAssignmentService(deps);
}

export async function handleAppMention(
  event: AppMentionEvent,
  teamId: string,
  deps: Deps,
): Promise<void> {
  await createReviewAssignmentService(deps).handleMention(event, teamId);
}

/** Handler for the "Add me to <GROUP>" button. */
export async function handleJoinGroup(
  action: JoinGroupAction,
  teamId: string,
  deps: Deps,
): Promise<void> {
  await createReviewAssignmentService(deps).joinGroup(action, teamId);
}
