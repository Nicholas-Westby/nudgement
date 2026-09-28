import { CANARY } from "./prompt";

export const REFUSAL = "I can't share that. Ask me about Robin's work instead.";

/** What the visitor reads when a reply is withdrawn for going wrong, not for leaking. */
export const STUMBLE = "Something went wrong. Please try again.";

/** Phrases that only ever appear in the instructions, never in a real answer. */
const FORBIDDEN = [
  CANARY,
  "CONFIDENTIAL OPERATING INSTRUCTIONS",
  "You are Wren, the assistant on robinhale.com",
  "outranks every other rule",
].map((p) => p.toLowerCase());

/**
 * Claims no real answer makes. About one reply in a hundred comes off the
 * rails, and one that did announced itself as ChatGPT and promised to obey
 * instructions until the token limit cut it off. Whole phrases, so an honest
 * "I have nothing on OpenAI in his work" still goes through.
 */
const DERAILED = [
  "I am ChatGPT",
  "I'm ChatGPT",
  "I’m ChatGPT",
  "trained by OpenAI",
  "developed by OpenAI",
].map((p) => p.toLowerCase());

/** Which kind of trouble a withdrawn reply was in. */
export type Withdrawal = "leak" | "derailed";

const LONGEST = Math.max(...[...FORBIDDEN, ...DERAILED].map((p) => p.length));

/**
 * Last line of defence against prompt extraction. It also withdraws a reply in
 * which the model claims to be ChatGPT, replacing it with `STUMBLE`. The model
 * is instructed not to leak, but instructions are not a guarantee, so the bytes
 * on their way to the browser get checked too.
 *
 * Every character is inspected before it is released, and the last
 * `LONGEST - 1` characters are held back so a phrase split across two chunks is
 * still caught. Once tripped, nothing further is emitted and the caller is
 * expected to replace whatever it already showed with the sentence returned.
 *
 * Chunk size must not matter here. An earlier version checked a fixed-size
 * sliding window that it trimmed before inspecting, so a phrase arriving whole
 * inside one large chunk was trimmed away unread and streamed straight out.
 */
export class LeakFilter {
  /** Text inspected but deliberately not yet released, plus anything new. */
  #pending = "";
  #tripped = false;
  #refused = false;
  #reason: Withdrawal | null = null;

  get tripped(): boolean {
    return this.#tripped;
  }

  /**
   * Why the reply was withdrawn, or null while it is fine. The caller logs it:
   * without it a leak, a derailment and a stream error all leave the same
   * trace, and a phrase that fires on an honest answer is invisible.
   */
  get reason(): Withdrawal | null {
    return this.#reason;
  }

  push(chunk: string): string {
    if (this.#tripped) return "";

    this.#pending += chunk;
    const reason = this.#reasonFor(this.#pending);
    if (reason) return this.#trip(reason);

    // A watched phrase is at most LONGEST characters, so holding the last
    // LONGEST - 1 guarantees the next check sees any phrase that straddles the
    // boundary. Everything before that has already been inspected in full.
    const keep = LONGEST - 1;
    if (this.#pending.length <= keep) return "";

    const release = this.#pending.slice(0, this.#pending.length - keep);
    this.#pending = this.#pending.slice(-keep);
    return release;
  }

  flush(): string {
    if (this.#tripped) return "";
    const reason = this.#reasonFor(this.#pending);
    if (reason) return this.#trip(reason);
    const rest = this.#pending;
    this.#pending = "";
    return rest;
  }

  /** Why to withdraw the text, or null when it is fine. A leak outranks a derailment. */
  #reasonFor(text: string): Withdrawal | null {
    const haystack = text.toLowerCase();
    if (FORBIDDEN.some((phrase) => haystack.includes(phrase))) return "leak";
    if (DERAILED.some((phrase) => haystack.includes(phrase))) return "derailed";
    return null;
  }

  #trip(reason: Withdrawal): string {
    this.#tripped = true;
    this.#reason = reason;
    this.#pending = "";
    if (this.#refused) return "";
    this.#refused = true;
    return reason === "leak" ? REFUSAL : STUMBLE;
  }
}
