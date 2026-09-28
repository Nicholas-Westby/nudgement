# Prototype

This folder contains a prototype of the `@PrReview` Slack app. It includes the parts of the app that can be built and tested without connecting to a Slack workspace, which turns out to be most of them.

## Before you begin

To run the prototype, you will need Node.js and npm installed on your computer. npm is the package manager that comes with Node.js, and it is used to download the libraries the prototype depends on. If you are not sure whether you have them, open a terminal and run:

```bash
node --version
npm --version
```

If both commands print a version number, you are ready to go. If not, download and install Node.js from [nodejs.org](https://nodejs.org), which includes npm.

## Getting the code

If you have not cloned the repository yet, do that first with `git clone`, which copies the whole repository, including its history, onto your computer. Then change into this folder:

```bash
cd pr-review-picker/prototype
```

All of the commands below are run from this folder.

## Installing the dependencies

Next, install the dependencies. This reads `package.json` and downloads everything the prototype needs into a folder called `node_modules`. You only need to do this once, or again whenever `package.json` changes:

```bash
npm install
```

## Running the tests

Once the dependencies are installed, you can run the tests. Tests are small programs that check that the code behaves the way it is supposed to, and the prototype has 63 of them:

```bash
npm test
```

If everything is working, you will see all 63 tests pass. You can also check the TypeScript types, which catches mistakes such as calling a function with the wrong kind of argument before the code ever runs:

```bash
npm run typecheck
```

None of this needs tokens, network access or a Slack account.

## What each file is for

| File               | Demonstrates                                                                     |
| ------------------ | -------------------------------------------------------------------------------- |
| `src/jira.ts`      | Slack link unwrapping, and the issue-key regex that survives `SMRT1002-2153`     |
| `src/picker.ts`    | The shuffle-bag reviewer rotation. Pure function of (roster, bag, rng)           |
| `src/format.ts`    | Building the message: `<@U…>` for the pick, escaped plain text for everyone else |
| `src/groups.ts`    | Group storage, and why this isn't Slack User Groups                              |
| `src/slack.ts`     | The four-method seam that makes everything else testable                         |
| `src/slack-web.ts` | The real implementation over `@slack/web-api`                                    |
| `src/app.ts`       | The behaviour: threading, dedup, self-message guard, auto-create                 |
| `src/signing.ts`   | Slack's request-signing recipe, needed to drive the app in tests                 |
| `src/index.ts`     | The Bolt 5 wiring. Socket Mode when `SLACK_APP_TOKEN` is set                     |
| `manifest.yml`     | The Slack-side app configuration, ready to paste                                 |

## Running it for real

To connect the prototype to a real Slack workspace, you need to set three environment variables. Environment variables are named values that your shell passes to every program it starts, and the app reads its tokens from them. You can set them in your terminal like this:

```bash
export SLACK_BOT_TOKEN=xoxb-…
export SLACK_SIGNING_SECRET=…
export SLACK_APP_TOKEN=xapp-…      # omit to run in HTTP mode on $PORT instead
```

Then start the app. `npx` runs a command from an npm package without you having to install it globally, and `tsx` is a tool that runs TypeScript files directly, without compiling them first:

```bash
npx tsx src/index.ts
```

Two things to change before this is more than a demo:

- `InMemoryGroupStore` forgets every roster and rotation on restart.
- The `seen` event-dedup Set is per-process, so it does nothing on serverless.
