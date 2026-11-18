# Breakthrough

**Problems rise. Solutions fall.** A falling-block puzzle for the Horizon suite.

Problem rows (e.g. *Data silos*) rise from the bottom of a 10×20 well, each with a
slot of 1–4 gaps. You steer four-cell solution pieces, each carrying an innovation
principle (the 40 TRIZ principles: Segmentation, Merging, Do it in reverse, …).

- Complete a row holding a problem and you **break** it. The card reads
  "Data silos, solved with Merging", credited to the piece that completed the row.
- **Perfect fit** (×2): that one piece filled every gap of the problem *and* none
  of it is left over (all its cells cleared). A 4-gap slot with an I piece, or a
  stacked T/L/J/O-shaped pocket across two problem rows.
- A row of solutions only clears for small points: *a solution looking for a problem*.
- Break problems on consecutive pieces for **combos**. Every 5 problems is a new
  level: pieces fall faster and problems rise more often.
- The stack pushed out of the top, or no room to enter: **Overwhelmed**. The
  end screen is an **Innovation report** (copyable as plain text) plus the leaderboard.

Controls: ←/→ or A/D move · ↑/W/X rotate · Z/Q rotate back · ↓/S soft drop ·
Space hard drop · C/Shift park the idea (hold) · P/Esc pause · M sound.
Touch buttons appear on phones (also tap the well to rotate, swipe down to drop).
The game pauses when the tab loses focus. Sound is off by default.

## Run it

Node isn't installed on the host. Everything runs in Docker.

```bash
cp .env.example .env              # dev defaults: project breakthrough-dev, port 8195, ./data
docker compose up -d --build      # http://<host>:8195
docker compose logs -f
```

Tests (engine + HTTP API):

```bash
docker run --rm -u $(id -u):$(id -g) -v "$PWD":/app -w /app node:24-bookworm npm test
```

Dependencies: `docker run ... node:24-bookworm npm install` (Express 5, js-yaml).
Scores use the built-in `node:sqlite`, so there are no native modules.

There's no hot reload in the container: rebuild with `docker compose up -d --build`
after a change. For a quick local loop you can mount the code with
`docker run --rm -it -p 8195:8195 -v "$PWD":/app -w /app node:24-bookworm npm run dev`.

## Configuration

Read from the environment by `src/config.js` (compose passes these from `.env`):

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8195` | Listen port (compose sets it from `BREAKTHROUGH_PORT`) |
| `DATA_DIR` | `./data` (`/data` in the container) | SQLite DB `breakthrough.db`, optional `decks/` |
| `PUBLIC_URL` | none | Public base URL (SSO redirect URI `<PUBLIC_URL>/auth/callback`; `https` makes cookies `Secure`) |
| `PORTAL_URL` | none | Shows a "← Horizon" link in the header |
| `TRUST_PROXY` | none | Express `trust proxy` value when behind the reverse proxy |
| `AUTH_LOCAL`, `AUTH_SSO`, `SSO_*`, `SESSION_DAYS` | see `.env.example` | Login standard, for the shared auth module |

Compose-level: `COMPOSE_PROJECT_NAME`, `BREAKTHROUGH_PORT`, `BREAKTHROUGH_DATA_DIR`,
`BREAKTHROUGH_BACKUP_DIR`. Prod values are in the `.env.example` comments. Ports,
URLs and paths are recorded in `~/git/horizon-infra/inventory.md`.

## Decks

`decks/problems.yaml` (about 40 generic organisation/tech problems) and
`decks/principles.yaml` (the 40 TRIZ principles, each with a 3-letter tag and a
one-line hint). Labels are capped at 18 characters so they fit on the blocks;
longer ones are trimmed.

To run a workshop with your own problems, put a file with the same name in
`DATA_DIR/decks/` (e.g. `data/decks/problems.yaml` in dev). It is re-read on each
game start, so no restart is needed. A broken override is logged and the default
deck is used instead.

```yaml
name: Our Q3 problems
problems:
  - Slow onboarding            # plain strings work
  - label: Data silos          # or objects with an optional note
    note: Teams can't see each other's data.
```

```yaml
name: TRIZ inventive principles
principles:
  - { name: Segmentation, short: SEG, hint: "Divide it into independent parts." }
```

## Routes

| Route | Auth | |
|---|---|---|
| `/` | user | The game |
| `/healthz` | open | `{"ok":true,...}` (used by `promote.sh` and the Docker healthcheck) |
| `/api/decks` | user | Active problem + principle decks |
| `/api/scores` | user | `GET`: top 20 (best game per player) + `me` (your best and rank). `POST`: a finished game |
| `/login`, `/local`, `/auth/callback`, `/logout` | – | From the auth module |

`POST /api/scores` takes JSON `{score, level, problemsSolved, perfectFits, bestCombo,
solutionRows, pieces, durationMs, topPrinciple}`. It is sanity-checked server-side:
non-negative integers within bounds, consistent counts, a level that matches
problems solved, and a score under a generous ceiling computed from the engine's
own scoring rules (`maxPlausibleScore`). There is also a 2-second per-user flood
guard. The aim is to keep junk off the leaderboard, not to stop a determined cheat.

## Auth: how the shared module plugs in

`src/auth/index.js` is a **stub** ("pretend login": you type a display name, and it's
kept in an in-memory session behind a cookie, so a restart logs everyone out).
The shared auth module (local users + TIG-SSO OIDC) replaces the whole
`src/auth/` directory with no other changes, as long as it keeps this interface:

```js
// createAuth({ db, appName, config }) -> { router, attachUser, requireUser }
//   router:      express.Router mounting /login, /local, /auth/callback, /logout
//   attachUser:  middleware setting req.user (or null)
//   requireUser: HTML without a user -> 302 /login?next=<url>; /api/* -> 401 JSON
// req.user = { id, username, displayName, source: 'local'|'sso', isAdmin }
// db: the app's node:sqlite DatabaseSync (auth creates its own auth_* tables)
// config: everything from src/config.js, including config.env (raw environment)
```

`src/server.js` mounts `attachUser` then `router` globally, and guards `/` and
`/api/*` with `requireUser`. Scores are keyed on `req.user.id` and show
`req.user.displayName`.

## Layout

```
src/server.js        Express app (createApp) + listener
src/config.js        env -> config
src/db.js            node:sqlite, migrations (PRAGMA user_version)
src/scores.js        submission validation + leaderboard queries
src/decks.js         YAML deck loading (default + DATA_DIR override)
src/views.js         HTML shell for the game page
src/auth/index.js    STUB auth (replaced by the shared module)
public/js/engine.js  pure game logic, no DOM (browser global + require())
public/js/game.js    canvas renderer, effects, input, sound, UI
public/css/app.css   styles (light/dark via prefers-color-scheme)
decks/*.yaml         default decks
test/                node --test: engine rules + HTTP API
scripts/promote.sh   prod release: backup, checkout tag, rebuild, health-check
```

## Releasing to prod

Follow `~/git/horizon-infra/standards.md` §6: tag `vX.Y.Z` here, push, then in
`~/apps/breakthrough` run `scripts/promote.sh --ref vX.Y.Z`. The script refuses a
dirty checkout and snapshots `DATA_DIR/breakthrough.db` with SQLite `VACUUM INTO`,
run through `node:sqlite` inside the container (no `sqlite3` binary needed). It
checks the snapshot's integrity, keeps the newest 10 in `BREAKTHROUGH_BACKUP_DIR`,
then rebuilds and polls `/healthz`. On failure it prints the rollback command.
