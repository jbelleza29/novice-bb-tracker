# Novice Bodybuilding Tracker

Mobile-first workout log for the [Ripped Body Novice Bodybuilding Program](https://rippedbody.com/novice-bodybuilding-program/). Log each set in the gym; the app works out next session's load for every exercise using the [progression rules](https://rippedbody.com/progression/).

## Layout

- `web/` – Next.js + TypeScript. Builds to static files.
  - `lib/engine.ts` – progression engine (linear, then rep-range once an exercise stalls 3 times)
  - `lib/store.ts` – local-first store: localStorage first, syncs to the API when signed in
  - `lib/merge.ts` – sync merge: newest wins per exercise slot and per settings group
- `api/` – Go server. SQLite storage, passcode sign-in, and serves the built frontend from the same binary.

## Develop

Two terminals:

```bash
make dev-api   # Go API on :8080, passcode "dev", DB in data/dev.db
make dev-web   # Next.js on :3000, proxies /api to :8080
```

Open http://localhost:3000. The app works signed out (data stays in the browser); sign in to sync.

```bash
make test      # engine + merge tests, type check, lint, go vet
```

## Build and run

```bash
make build                                   # -> bin/nbt with the frontend embedded
NBT_PASSCODE='long passphrase' ./bin/nbt     # serves app + API on :8080
```

| Env | Default | |
|---|---|---|
| `NBT_PASSCODE` | required | Sign-in passcode. Use a long one; logins are limited to 10 failures per 15 min. |
| `NBT_DB` | `nbt.db` | SQLite file path |
| `NBT_ADDR` | `:8080` | Listen address |

Put it behind HTTPS (Fly.io, Caddy, etc). The session cookie is marked `Secure` when the request arrives over HTTPS or with `X-Forwarded-Proto: https`.

## Sync model

- Workouts are append-only and upload by id, so retries are safe.
- Program state is one JSON document with a version number. A write based on an old version gets a 409 and the current copy; the client merges and retries.
- In-progress workouts (drafts) stay on the device.
- "Delete all data" stamps a reset time; anything older is dropped on every device at its next sync.

## Known limitations

- A load increase always adds the full jump. With small plates, lower the jump size in Settings.
- Past sessions can't be edited or deleted one at a time.
- If two devices change units and other settings at the same moment, the newer settings group wins as a whole.
