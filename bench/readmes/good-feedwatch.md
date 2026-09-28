# feedwatch

Watches RSS and Atom feeds and posts each new item to a chat webhook: Slack, Discord, Matrix, or anything that accepts a JSON POST. It runs as one long-lived process, remembers what it has already posted in a small SQLite file, and is configured with one TOML file.

It was written for a team channel that follows a dozen vendor status pages and changelogs, and it is sized for that: tens of feeds, not thousands.

## Install

```sh
pipx install feedwatch
```

It needs Python 3.11 or newer. There is also a container image:

```sh
docker run -v ./feedwatch.toml:/etc/feedwatch.toml -v feedwatch-state:/var/lib/feedwatch ghcr.io/ashdown/feedwatch
```

## Quick start

Create `feedwatch.toml`:

```toml
[[target]]
name = "team"
kind = "slack"
url  = "${SLACK_WEBHOOK_URL}"

[[feed]]
url    = "https://www.githubstatus.com/history.atom"
target = "team"
```

Then, with `SLACK_WEBHOOK_URL` set to the webhook's address:

```sh
feedwatch check   # validate the config and fetch each feed once, posting nothing
feedwatch run     # start watching
```

The first time feedwatch sees a feed, it records the items already in it without posting them, so adding a feed does not flood the channel with its back catalogue. Pass `--post-existing` to `run` if you do want them.

## Commands

| Command                       | What it does                                                             |
| ----------------------------- | ------------------------------------------------------------------------ |
| `feedwatch run`               | Watch every feed until stopped                                           |
| `feedwatch check`             | Validate the config and fetch every feed once. Posts nothing             |
| `feedwatch once`              | One pass over every feed, posting new items, then exit. For cron         |
| `feedwatch test <target>`     | Post a test message to one target                                        |
| `feedwatch seen <feed-url>`   | List the items recorded as posted for a feed                             |
| `feedwatch forget <feed-url>` | Forget a feed's history, so its current items are treated as new         |

Every command reads `./feedwatch.toml`, or `/etc/feedwatch.toml` when there is none. `-c <path>` points it at another file.

## Configuration

### Targets

| Key        | Required | Meaning                                                                                   |
| ---------- | -------- | ----------------------------------------------------------------------------------------- |
| `name`     | yes      | What feeds refer to it by                                                                 |
| `kind`     | yes      | `slack`, `discord`, `matrix` or `json`                                                    |
| `url`      | yes      | The webhook URL. `${VAR}` is filled in from the environment, so secrets stay out of the file |
| `template` | no       | The message text, see [Templates](#templates)                                             |

`json` posts an object with `title`, `link`, `summary`, `feed` and `published` to the URL, for anything the other kinds do not cover.

### Feeds

| Key       | Default              | Meaning                                                      |
| --------- | -------------------- | ------------------------------------------------------------ |
| `url`     | required             | The feed's URL                                               |
| `target`  | required             | A target's name, or a list of names                          |
| `every`   | `"15m"`              | How often to fetch it. The minimum is `"1m"`                 |
| `include` | none                 | Only post items whose title matches this regular expression  |
| `exclude` | none                 | Skip items whose title matches this regular expression       |
| `name`    | the feed's own title | Shown in messages                                            |

feedwatch sends `If-None-Match` and `If-Modified-Since`, respects `Retry-After`, and backs off to one fetch an hour for a feed that keeps failing. It logs a failing feed once, not on every attempt.

### Templates

A target's `template` is a Python format string with `title`, `link`, `summary`, `feed` and `published` available:

```toml
template = "*{feed}*: <{link}|{title}>"
```

The default for each kind is the item's title linked to the item, with the feed's name in front.

## State

Posted items are recorded by feed URL and item id in `feedwatch.db`, in `$XDG_STATE_HOME/feedwatch/`, or `/var/lib/feedwatch/` in the container. Records older than 90 days are dropped. Deleting the file is safe: the next run treats every feed as new and records its items without posting them, as on a first run.

## Running as a service

`feedwatch run` stays in the foreground and logs to stderr, so systemd, launchd or Docker can supervise it. There is a sample unit file in `contrib/feedwatch.service`. It only exits with an error when the config is invalid; network and feed errors are logged and retried.

## Development

```sh
uv sync
uv run pytest
```

The tests serve feeds from `tests/feeds/` over a local HTTP server and post to a fake webhook, so they need no network.
