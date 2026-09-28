import type { FileSystem } from '../ports/file-system.ts';
import type { Terminal } from '../ports/terminal.ts';

/**
 * A log switched on and forgotten would otherwise grow for months. Counted in
 * characters rather than bytes: a transcript is overwhelmingly ASCII, and what
 * is wanted is a bound, not an exact one.
 */
const MAX_CHARACTERS = 5 * 1024 * 1024;

const RESTARTED = '=== dirmirror started this log again: it had passed 5 MB ===\n';

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * ISO-8601 in local time with its offset, not `toISOString()`'s UTC: whoever
 * reads this is matching its lines against when they remember pressing the key,
 * and a session they ran at 09:00 that reads 08:00 sends them looking in the
 * wrong place.
 *
 * `Date` rather than the `Clock` port, which deliberately offers only a
 * monotonic reading for measuring elapsed time and has no wall clock to lend.
 */
function sessionHeader(at: Date): string {
  const minutesEastOfUtc = -at.getTimezoneOffset();
  const sign = minutesEastOfUtc < 0 ? '-' : '+';
  const distance = Math.abs(minutesEastOfUtc);
  const local = new Date(at.getTime() + minutesEastOfUtc * 60_000);
  const offset = `${sign}${twoDigits(Math.trunc(distance / 60))}:${twoDigits(distance % 60)}`;
  return `=== dirmirror ${local.toISOString().slice(0, 19)}${offset} ===\n`;
}

function directoryOf(path: string): string {
  const cut = path.lastIndexOf('/');
  // A bare filename has no directory to make, and slicing to -1 would drop its
  // last character and make one named after the log itself.
  if (cut < 0) return '.';
  return path.slice(0, cut) || '/';
}

/**
 * The session transcript, collected in memory and written out in batches.
 *
 * Buffered because `Terminal.write` is synchronous and no call site awaits it:
 * appending per line would either stall the wizard behind the disk or let two
 * writes land out of order, and a transcript that is out of order is worse than
 * no transcript.
 *
 * It holds the plain `Terminal`, not the `Output` that wraps it, because the
 * terminal dirmirror talks through is itself decorated to feed this log — a
 * complaint about the log would otherwise be recorded by the log it is about.
 */
export class SessionLog {
  private readonly fs: FileSystem;
  private readonly terminal: Terminal;
  private readonly path: string;
  private buffer = '';
  private on = false;
  private paused = false;
  private headerDue = false;
  private sizeChecked = false;
  private complained = false;
  /** Flushes run one after another, so batches reach the file in the order said. */
  private queue: Promise<void> = Promise.resolve();

  constructor(fs: FileSystem, terminal: Terminal, path: string) {
    this.fs = fs;
    this.terminal = terminal;
    this.path = path;
  }

  get enabled(): boolean {
    return this.on;
  }

  setEnabled(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    if (!on) return;
    // Armed, not written: switching logging on and changing your mind before
    // anything happens should leave no file behind at all.
    this.headerDue = true;
    // A log that gave up switched itself off, so this is a user reading "start
    // logging" on the menu and taking the offer. Their request earns its own
    // answer if it fails again: the alternative is a screen saying it is
    // recording while nothing is written.
    this.complained = false;
  }

  append(text: string): void {
    if (!this.on || this.paused) return;
    if (this.headerDue) {
      this.headerDue = false;
      this.buffer += sessionHeader(new Date());
    }
    this.buffer += text;
  }

  /**
   * Resolves once everything said so far is on disk — and resolves whatever
   * happened, because nothing here is worth failing a sync over.
   */
  flush(): Promise<void> {
    const pending = this.buffer;
    this.buffer = '';
    if (pending !== '') this.queue = this.queue.then(() => this.write(pending));
    return this.queue;
  }

  /** Runs `run` with recording paused, restoring it even if `run` throws. */
  async withoutRecording<T>(run: () => Promise<T>): Promise<T> {
    const was = this.paused;
    this.paused = true;
    try {
      return await run();
    } finally {
      this.paused = was;
    }
  }

  private async write(pending: string): Promise<void> {
    try {
      await this.fs.mkdirp(directoryOf(this.path));
      if (!this.sizeChecked) {
        this.sizeChecked = true;
        await this.restartIfHuge();
      }
      await this.fs.appendFile(this.path, pending);
    } catch {
      this.giveUp();
    }
  }

  /**
   * Once a run, before the first line of it is written. There is no rename to
   * roll the file over with, and a log nobody has asked to keep is not worth
   * one: the note says where the missing history went.
   */
  private async restartIfHuge(): Promise<void> {
    const existing = await this.fs.readFile(this.path);
    if (existing !== undefined && existing.length > MAX_CHARACTERS) {
      await this.fs.writeFile(this.path, RESTARTED);
    }
  }

  /**
   * A full disk or a read-only config dir must cost the user their log, never
   * their sync — the same bargain `chmod` and `makeTempFile` strike. Said once:
   * the alternative is the same complaint under every line of the transcript.
   */
  private giveUp(): void {
    this.on = false;
    this.buffer = '';
    if (this.complained) return;
    this.complained = true;
    this.terminal.writeError(`dirmirror: cannot write ${this.path} — logging off for this run\n`);
  }
}
