# potluck

A small web app for organising who brings what to a shared meal. The host creates an event and sends the link around; guests open it, add what they are bringing, and see what is already covered, so the table does not end up with four bowls of crisps and no main course.

There are no accounts. Anyone with the event link can add, change or remove dishes. The host also gets a private admin link for editing the event's details or closing it to changes.

## Run it

With Docker:

```sh
docker run -d -p 8080:8080 -v potluck-data:/data ghcr.io/hwilde/potluck:latest
```

Then open http://localhost:8080. Everything is kept in one SQLite file, `/data/potluck.db`, so that volume is the only thing to back up.

From source, with Node 20 or newer:

```sh
npm install
npm run build
npm start        # serves on port 8080
```

`npm run dev` runs it with reload on save at http://localhost:5173.

## Configuration

Everything is set with environment variables, and all of them are optional.

| Variable         | Default                               | What it does                                                                                                     |
| ---------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `PORT`           | `8080`                                | Port to listen on                                                                                                |
| `DATA_DIR`       | `/data` in Docker, `./data` otherwise | Where the SQLite file lives                                                                                      |
| `BASE_URL`       | taken from each request               | The address used in the links the app shows for copying. Set it when running behind a proxy                     |
| `EVENT_TTL_DAYS` | `30`                                  | Events are deleted this many days after the day they happen                                                      |
| `SMTP_URL`       | not set                               | For example `smtp://user:pass@mail.example.com:587`. When set, the host can email the link to guests from the event page |

## Putting it online

The app does not handle HTTPS itself. Run it behind a reverse proxy such as Caddy or nginx, and set `BASE_URL` to the public address.

An event's link contains a random 20-character id, and that id is the only thing keeping the event private. Treat the links like the share link of a private document: anyone who has the event link can edit the dish list, and anyone with the admin link can change or close the event.

## Tests

```sh
npm test           # unit tests
npm run test:e2e   # browser tests; run `npx playwright install` once first
```
