# Jev fixtures

Recorded requests and responses from TypeSafe's Jev model
(`POST https://api.typesafe.ai/v1/systemone`). They exist to show how the API
behaves and to check, offline, that the routing rules for Wren's first hop
never send a wrong fixed reply.

Findings and the reasoning behind the thresholds are in
`docs/plans/2026-09-21-jev-first-hop-research.md`.

## Layout

```
api/
  NAME.input.json       one complete request, with a description of what it probes
  NAME.output.json      { status, body } as the API returned it
router/
  cases/GROUP.json      visitor messages, each with the outcome it should get
  recorded/GROUP.json   Jev's answers to those messages, one answer per line
alternation/
  scenarios.json        conversations that switch between fixed replies and the LLM
  transcripts.json      every turn of every scenario, played with the first hop on and off
last-run.json           timing and cost of the most recent regeneration
```

Inputs are written by hand and never touched by a script. Outputs are written
only by `bun run jev:regenerate` (and `transcripts.json` by
`bun run jev:alternation`).

## API probes

Each input is the exact request body, so the pairs double as worked examples of
the API: the three question types, structured criteria, grounding against the
knowledge base, token accounting, a prompt injection, other languages, numbers,
and every error shape found so far.

`{"$file": "worker/src/knowledge.md"}` inside a request body is replaced with
that file's text before sending, which keeps 18 KB of knowledge base out of
every fixture.

`"auth": "none"` and `"auth": "invalid"` send the request without a key or with
a made-up one, for the error probes.

## Router cases

A case is a message, optionally the earlier turns of the chat, and an
expectation:

```json
{
  "id": "conversation-react-then-vue",
  "history": [
    { "role": "user", "content": "Does he know React?" },
    { "role": "assistant", "content": "Yes, Robin has hands-on experience with that from real projects." }
  ],
  "message": "What about Vue?",
  "note": "The same three words with no history are in follow-ups.json, where they must go to the LLM.",
  "expect": { "ideal": "yes_experience", "acceptable": ["yes_fact"] }
}
```

`history` uses the shape Wren's history already has, and must survive the
Worker's own `trimHistory` unchanged (the unit test checks). Leave it out for a
first message.

`ideal` is what a perfect router would do: a key from `replies` in
`worker/src/chat/jev-router.json`, or `llm` for the existing model path.
`acceptable` lists other fixed replies that would be fine. Any fixed reply
outside both is graded **wrong**. Falling back to `llm` when a fixed reply was
ideal is graded **missed**, which is slow and harmless.

The request for a case is not stored. It is the `request` template in
`jev-router.json` with its three placeholders filled in at run time:
`{{knowledge}}` from the current `knowledge.md`, and `{{conversation}}` and
`{{visitor_message}}` from the case. That is what the Worker would send.

To add a case, add it to a group file (or start a new one) and run
`bun run jev:regenerate router GROUP`.

## Alternation

Jev answers some messages, so the LLM's history holds replies it never wrote.
`scenarios.json` lists conversations that switch between the two, and
`bun run jev:alternation` plays each one turn by turn through a locally running
Worker, which routes every message itself. A scenario names the fixed reply it
expects for each earlier turn, and a turn that routes differently is reported,
so the run checks the routing end to end as well. The all-LLM control comes
from a second Worker started with `--var TYPESAFE_API_KEY:`, which switches the
first hop off. The plain command does not play the control: `WREN_CONTROL_API`
has to point at that second Worker, so the full command is
`WREN_CONTROL_API=http://127.0.0.1:8789 bun run jev:alternation`. Without the
variable the control transcripts already on disk are kept, and a scenario that
has none is named in the summary. The comment at the top of the script gives
both commands. Both Workers need Wrangler logged in, because the LLM is a remote
binding. The LLM is not deterministic, so `transcripts.json` changes on every
run and is there to be read, not asserted on.

## Commands

| Command                                         | What it does                                                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `bun run jev:regenerate`                        | Re-records everything. About 300 requests, about ten cents.                                                                          |
| `bun run jev:regenerate api`                    | API probes only. Add probe names to narrow it further.                                                                               |
| `bun run jev:regenerate router strengths facts` | Only the named case groups.                                                                                                          |
| `bun run jev:analyze`                           | Offline report: how the recordings route, closest calls, threshold sweeps. Add `--all` to list every decision.                       |
| `bun run jev:alternation`                       | Plays the alternation scenarios through a local Worker. `WREN_CONTROL_API` adds the control. About 45 LLM calls and 35 Jev calls. |
| `bun run test`                                  | Includes `tests/unit/jev-fixtures.test.ts`, which replays the recordings and fails on any wrong reply. No network.                   |

Regenerating needs a TypeSafe API key. The script looks for a
`TYPESAFE_API_KEY` in the environment first and then for a `TYPESAFE_API_KEY=`
line in `worker/.dev.vars`, the gitignored file that holds the key and the one
the Worker reads locally. The secret set with `wrangler secret put` cannot be
used here, because Cloudflare never returns a secret's value. The key goes into
the Authorization header and nowhere else.

After a regeneration the script prints which answers moved and which messages
would now be routed differently, and `git diff tests/fixtures/jev` shows the
rest. Jev is not perfectly deterministic: identical requests agree to within
0.02 when it is confident and wander by up to 0.1 when it is torn, so small
movements in murky answers are noise. `last-run.json` changes on every run by
design.
