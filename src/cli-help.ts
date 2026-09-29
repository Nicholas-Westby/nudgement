export const HELP = `nudgement — review code, commits and writing

Usage: bun evaluate.ts [repository] [options]

Commits (defaults to HEAD):
  --staged -m <message>       Review the index and a proposed message
  --amend -m <message>        Review HEAD plus staged changes
  --hash <sha>               Review a commit; add -m to try a new message
  --range <a>..<b>            Review every non-merge commit in a range
  -m, --message <text>        Repeat to rank several drafts
  -F, --message-file <path>   Read a proposed message from a file
  --check-files              Also review changed source and documentation
  --no-comments              Skip new comments

Files (working tree, or --staged / --hash):
  --file <path>              Review code, tests or Markdown (repeatable)
  --readme                   Review the repository's README
  --tests <path>             Review test quality (repeatable)
  --copy <path>              Review TSX or SwiftUI text (repeatable)
  --design <path>            Review a design specification
  --plan <path>              Review a plan; add --design for coverage
                             Repeat --plan when plans share a design

Repository:
  --repo-check               Check hygiene without Jev; may accompany other checks
  --history                  Review commit history; accepts --range

Settings:
  --config <path>            Defaults to nudgement.json in the target repository
  --context <path>           Product requirements for code reviews
  --require <text>           Required README content (repeatable)
  --require-file <path>      README requirements, one per line (repeatable)
  --json                     Structured results
  --verbose                  Every finding and Jev reading
  --tag <name>               Label the run in local logs
  -h, --help                 Show this help

Set JEV_API_KEY (or TYPESAFE_API_KEY) in the environment or nudgement's .env.
Reviews send source to api.typesafe.ai and may incur charges.
Exit codes: 0 pass, 1 failed review, 2 usage/Git error, 3 crash.`;
