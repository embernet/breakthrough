# Breakthrough

**Problems rise. Solutions fall.** A standalone falling-block puzzle. It can also sit behind a suite portal (see *Joining a portal*).

Problem rows (e.g. *Cache stampede*) rise from the bottom of a 10×20 well, each with a
slot of 1–4 gaps. You steer four-cell solution pieces, each carrying a solution
(e.g. *Circuit breaker*). What the problems and solutions are depends on the
**mode**, picked from the dropdown at the top left:

| Mode | Problems | Solutions ("noun") |
|---|---|---|
| **Software Engineering** (default) | tech debt, scaling, reliability, design smells | design patterns and architecture techniques ("pattern") |
| **Algo Trading** | market, execution and quant/ML research pitfalls | strategies, validation methods and risk controls ("technique") |
| **Business Operations** | cash, customers, supply, people, management and risk headaches | the management and operations toolkit ("tactic") |

- Complete a row holding a problem and you **break** it. The card reads
  "Cache stampede, solved with Request coalescing", credited to the piece that
  completed the row.
- **Right tool** (×1.5): each problem can list 1–3 best-fit solutions. Finish it
  with one of those and the points get a bonus that stacks with Perfect fit. A ★
  on the row and a "Right tool for…" line show when the falling piece is a match,
  and the "Rising next" card shows the next problem's best fits.
- **Perfect fit** (×2): that one piece filled every gap of the problem *and* none
  of it is left over (all its cells cleared). A 4-gap slot with an I piece, or a
  stacked T/L/J/O-shaped pocket across two problem rows.
- A row of solutions only clears for small points: *a solution looking for a problem*.
- Break problems on consecutive pieces for **combos**. Every 5 problems is a new
  level: pieces fall faster and problems rise more often.
- The stack pushed out of the top, or no room to enter: **Overwhelmed**. The
  end screen is an **Innovation report** (copyable as plain text) plus that mode's
  leaderboard. Scores and leaderboards are per mode.

The dropdown starts a fresh game (it asks first if one is in progress). Your
choice is remembered in the browser; `/?mode=algo-trading` links straight to a mode.

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
| `DATA_DIR` | `./data` (`/data` in the container) | SQLite DB `breakthrough.db`, optional `modes/` |
| `DEFAULT_MODE` | `software-engineering` | Mode shown first and used when the viewer hasn't picked one (falls back to `software-engineering` if that id isn't loaded) |
| `PUBLIC_URL` | none | Public base URL (SSO redirect URI `<PUBLIC_URL>/auth/callback`; `https` makes cookies `Secure`) |
| `PORTAL_URL`, `PORTAL_NAME` | none | Optional suite portal: with both set, the header shows "← `PORTAL_NAME`" linking to `PORTAL_URL` |
| `TRUST_PROXY` | none | Express `trust proxy` value when behind the reverse proxy |
| `AUTH_LOCAL`, `AUTH_SSO`, `SSO_*`, `SESSION_DAYS` | see `.env.example` | Login standard, for the shared auth module |

Compose-level: `COMPOSE_PROJECT_NAME`, `BREAKTHROUGH_PORT`, `BREAKTHROUGH_DATA_DIR`,
`BREAKTHROUGH_BACKUP_DIR`. Prod values are in the `.env.example` comments.

## Modes

Each mode is **one YAML file**. The built-in ones are in `modes/`:
`software-engineering.yaml`, `algo-trading.yaml`, `business-operations.yaml`.
(The original TRIZ mode, `innovation`, was retired. Its old scores stay in the
database but no longer appear, and a saved or linked `innovation` choice falls
back to the default.)

Files in `DATA_DIR/modes/` (e.g. `data/modes/` in dev) **add** modes, or **replace**
a built-in one that has the same `id`. They are re-checked on every request, so
a new or edited file shows up on the next page load, with no restart. Every file is
validated on load. A file with any error is **skipped** and the reasons are logged
(`docker compose logs`), e.g.
`modes: skipping DATA_DIR/modes/q3.yaml: 2 problems: problems[4] "Very long label here": label is 20 characters (max 18) ...`.
A bad file never stops the app or the other modes.

### Make your own mode

Copy a built-in file into `data/modes/`, change the `id`, and edit:

```yaml
id: our-q3                 # required; lower-case letters, digits, dashes. Same id as a built-in = replace it
name: Our Q3 problems      # required; shown in the dropdown (max 40)
description: A warm-up for the planning workshop.   # optional, shown on the start card
solutionNoun: idea         # optional: what a solution is called ("pattern", "technique", ...). Default "solution"
solutionNounPlural: ideas  # optional; default noun + "s"
order: 10                  # optional whole number: dropdown position (lower first; the default mode is always first)

problems:                  # required, at least 5
  - label: Slow onboarding # required, max 18 characters (it is drawn on a 10-cell row)
    note: New starters take a month to ship.   # optional, max 140
    bestFits: [Buddy system, Golden path]       # optional, 1-3 names from `solutions` below
  - Silos                  # a plain string works too (label only)

solutions:                 # required, at least 5
  - name: Buddy system     # required, max 20 characters (drawn on the falling piece), unique
    tag: BUD               # required, 2-4 letters/digits, drawn on settled blocks
    hint: Pair each new starter with an old hand.  # required, one line (max 140)
  - { name: Golden path, tag: GLD, hint: "One paved, documented way to ship." }
```

Rules the validator enforces: the required fields above; the length limits; no
duplicate problem labels or solution names (case-insensitive); every `bestFits`
name must be one of this file's solutions (matched case-insensitively). Quote any
hint that contains a `:` or `#`. Unknown keys are ignored.

To make it the default for everyone, set `DEFAULT_MODE=our-q3` in `.env` and
recreate the container.

## Routes

| Route | Auth | |
|---|---|---|
| `/` | user | The game |
| `/healthz` | open | `{"ok":true,...}` (used by `promote.sh` and the Docker healthcheck) |
| `/api/modes` | user | `{default, modes: [{id, name, description, ...}]}` |
| `/api/modes/:id` | user | One mode: problems (with `bestFits`) and solutions. `/api/decks?mode=<id>` is an alias |
| `/api/scores?mode=<id>` | user | `GET`: that mode's top 20 (best game per player) + `me` (your best and rank). `POST`: a finished game |
| `/login`, `/local`, `/auth/callback`, `/logout` | – | From the auth module |

`POST /api/scores` takes JSON `{mode, score, level, problemsSolved, perfectFits, rightTools,
bestCombo, solutionRows, pieces, durationMs, topPrinciple}` (`mode` must be a loaded
mode id; missing means the default). It is sanity-checked server-side:
non-negative integers within bounds, consistent counts, a level that matches
problems solved, and a score under a generous ceiling computed from the engine's
own scoring rules (`maxPlausibleScore`). There is also a 2-second per-user flood
guard. The aim is to keep junk off the leaderboard, not to stop a determined cheat.

## Login

`src/auth/` is a shared login module (local accounts, plus optional OpenID
Connect single sign-on); `src/auth/README.md` documents it. By default only local
accounts are on. `AUTH_SSO=on` adds single sign-on, with local accounts then at
`/local` while `AUTH_LOCAL=on`. The module is vendored: change it at its source and
re-copy, rather than editing it here.

```bash
scripts/user.sh add mark "Mark Burnett"   # add or reset a local account (prompts for the password)
scripts/user.sh list
```

`src/server.js` mounts `attachUser` then `router` globally, and guards `/` and
`/api/*` with `requireUser`. Scores are keyed on `req.user.id` (`local:<username>`
or `sso:<sub>`) and show `req.user.displayName`.

## Layout

```
src/server.js        Express app (createApp) + listener
src/config.js        env -> config
src/db.js            node:sqlite, migrations (PRAGMA user_version)
src/scores.js        submission validation + leaderboard queries
src/modes.js         mode files: loading, validation, DATA_DIR overrides
src/views.js         HTML shell for the game page
src/auth/            shared login module (vendored; see src/auth/README.md)
public/js/engine.js  pure game logic, no DOM (browser global + require())
public/js/game.js    canvas renderer, effects, input, sound, UI
public/css/app.css   styles (light/dark via prefers-color-scheme)
modes/*.yaml         built-in modes (one file each)
test/                node --test: engine rules, mode files, HTTP API
scripts/promote.sh   prod release: backup, checkout tag, rebuild, health-check
```

## Joining a portal

The app knows nothing about any portal. To list it in one:

1. Set `PORTAL_URL` and `PORTAL_NAME` in this deployment's `.env` (git-ignored) for the "← back" link.
2. Add a tile in the portal's own config, pointing at this app's URL, with health check `/healthz`.
3. For single sign-on across the suite, turn on `AUTH_SSO` with this app's own client ID.

Leave all three out and it runs standalone.

## Releasing to prod

Tag `vX.Y.Z` here, push, then in the prod checkout (e.g. `~/apps/breakthrough`) run `scripts/promote.sh --ref vX.Y.Z`. The script refuses a
dirty checkout and snapshots `DATA_DIR/breakthrough.db` with SQLite `VACUUM INTO`,
run through `node:sqlite` inside the container (no `sqlite3` binary needed). It
checks the snapshot's integrity, keeps the newest 10 in `BREAKTHROUGH_BACKUP_DIR`,
then rebuilds and polls `/healthz`. On failure it prints the rollback command.
