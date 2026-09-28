# pgsnap

Save and restore snapshots of a local Postgres database while you develop. A snapshot is a copy made with `CREATE DATABASE ... TEMPLATE`, so taking or restoring one takes about as long as copying the database's files: a second or two for a typical development database, where `pg_dump` and `pg_restore` take minutes.

Take one before a migration you are unsure of, before a test run that wrecks data, or to keep a state you want to come back to.

Snapshots live on the same server as the database, so pgsnap is for a server you control. It also needs a moment when nothing else is connected to the database (see [Connections](#connections)).

## Install

```sh
go install github.com/rgrimes/pgsnap@latest
```

Or download a binary from the releases page. pgsnap talks to Postgres 13 or newer directly, so it does not need `pg_dump` or `psql` installed.

## Quick start

```sh
export DATABASE_URL=postgres://localhost:5432/shop_dev

pgsnap snap before-migration     # save the current state
bin/rails db:migrate             # the migration goes wrong
pgsnap restore before-migration  # put it back
```

## Commands

| Command                     | What it does                                                               |
| --------------------------- | -------------------------------------------------------------------------- |
| `pgsnap snap [name]`        | Save a snapshot. Without a name, it is named after the current time        |
| `pgsnap restore <name>`     | Replace the database with a snapshot. The snapshot is kept                 |
| `pgsnap list`               | Snapshots of this database, newest first, with age, size and git commit    |
| `pgsnap rm <name>...`       | Delete snapshots                                                           |
| `pgsnap prune`              | Delete old snapshots, see [prune](#prune)                                  |
| `pgsnap rename <old> <new>` | Rename a snapshot                                                          |
| `pgsnap kill`               | End every other connection to the database, so a snap or restore can run |

Every command takes `--db <url>` to use a database other than `DATABASE_URL`, and `--dry-run` to print the SQL instead of running it.

### snap

```sh
pgsnap snap                 # named like 2026-09-26_1412
pgsnap snap seeded --force  # replace the existing snapshot called "seeded"
```

The snapshot is stored as a database named `pgsnap_<database>_<name>`. Its comment records when it was taken and, if you ran pgsnap inside a git repository, the commit you were on. Names can use letters, digits, `-` and `_`, up to 30 characters, because Postgres cuts database names off at 63 bytes.

### restore

```sh
pgsnap restore seeded
```

Restoring drops the database and creates it again from the snapshot, so anything written since the snapshot was taken is lost. pgsnap asks first unless you pass `--yes`. The snapshot itself is not changed, so you can restore the same one as often as you like.

If a restore fails partway, for example because the disk is full, the database has already been dropped. pgsnap says so, and running the same restore again once the problem is fixed finishes the job.

### list

```
$ pgsnap list
NAME                AGE       SIZE     COMMIT
before-migration    3 min     412 MB   a1c9e02
seeded              2 days    380 MB   7f3b118
2026-09-20_0930     6 days    377 MB   -
```

`--all` lists the snapshots of every database on the server. `--json` prints the same fields as JSON.

### prune

```sh
pgsnap prune --keep 3           # keep the newest 3
pgsnap prune --older-than 14d   # delete anything older than two weeks
```

Only snapshots named after the time are pruned. Add `--include-named` to prune the ones you named yourself too. Prune lists what it will delete and asks first.

## Connections

Postgres will not copy a database while anything else is connected to it, including your app server, a `rails console` or a GUI client left open. When a snap or restore is blocked, pgsnap lists the other connections by application name and address, and stops.

`pgsnap kill` ends them with `pg_terminate_backend`, which works on connections made by your own role, or on any connection if your role has `pg_signal_backend`. Adding `--kill` to `snap` or `restore` does the same in one step:

```sh
pgsnap restore seeded --kill
```

Rails and Django reconnect by themselves on the next request. Long-running workers such as Sidekiq may need a restart.

## Configuration

A `.pgsnap.toml` in the current directory or any parent sets defaults for a project. `--db` wins over `DATABASE_URL`, which wins over the file.

```toml
database = "postgres://localhost:5432/shop_dev"
keep = 5        # prune to the newest 5 after every snap
kill = true     # end other connections without asking
```

## Limitations

- Each snapshot is a full copy, so ten snapshots of a 400 MB database take 4 GB. `pgsnap list` shows the sizes, and `keep` stops them piling up.
- It copies one database, not the whole server, so roles and other databases are not included.
- Snapshots stay on the server they were taken on. To move data between machines, use `pg_dump`.
- Because it drops databases, it refuses a `DATABASE_URL` whose host is not `localhost`, `127.0.0.1` or a Unix socket unless you pass `--remote`.

## Development

```sh
docker compose up -d   # Postgres 16 on port 54329, for the tests
go test ./...
```

The tests only create and drop databases named `pgsnap_test_*`.
