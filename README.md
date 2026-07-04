# KFC — Keep Finding Chickens

A Capture-The-Flag (CTF) mock-up where players solve challenges to find hidden flags. Inspired by the increasing chickens that appeared in the vicinity.

## Overview

KFC is a self-hosted CTF platform built with Node.js and Express. Players register, pick challenges across eight categories, solve them, and compete on a live scoreboard. All flags follow the format `CHICKEN{...}`.

The platform currently ships with **20 challenges** across eight categories, ranging from beginner "View Source" puzzles to intermediate JWT `alg:none` auth bypasses.

### Features

- User registration and authentication (bcrypt-hashed passwords)
- Eight challenge categories: **Web**, **Pwn**, **Crypto**, **Reversing**, **Stego**, **Forensics**, **OSINT**, **Misc**
- **Dynamic scoring** — challenges decay in value as more players solve them (see [Scoring](#scoring))
- Unlockable **hints** that cost points, deducted from a player's net score
- **Prerequisite chains** — challenges can be locked until required challenges are solved
- **Post-solve writeups** — an explanation revealed once a player solves the challenge
- First-blood tracking and solve counts per challenge
- Player profiles (`/u/:username`) with rank, score, and solve timeline
- Live scoreboard ranked by score, then earliest last-solve
- Flag-submission rate limiting to deter brute-forcing
- Interactive challenges with their own server routes and pages
- Session persistence via SQLite
- Auto-seeding of challenges on server boot

## Scoring

Challenges use **dynamic (decaying) scoring**, similar to CTFd. A challenge starts at its full value and decays toward a floor as more players solve it, so early solves of hard challenges are worth more. Every solver of a challenge is always credited its *current* value, so scores shift as the competition progresses.

```
value(n) = ceil( ((floor - initial) / decay²) · n² + initial ),  clamped to [floor, initial]
```

where `n` is the number of solves, `floor = ceil(initial × DYN_MIN_RATIO)`, and `decay = DYN_DECAY` (the solve count at which a challenge reaches its floor). A player's **net score** is the sum of the current values of their solved challenges, minus the cost of any hints they have unlocked. Both `DYN_DECAY` and `DYN_MIN_RATIO` are configurable (see [Environment Variables](#environment-variables)).

## Tech Stack

| Layer       | Technology                          |
| ----------- | ----------------------------------- |
| Runtime     | Node.js                             |
| Framework   | Express 4                           |
| Templating  | EJS                                 |
| Database    | SQLite (default) or Postgres        |
| Sessions    | express-session (SQLite or PG store) |
| Auth        | bcrypt                              |

## Getting Started

### Prerequisites

- **Node.js** v18 or later
- **npm** (comes with Node.js)

### Installation

```bash
# Clone the repository
git clone https://github.com/aq1608/KFC.git
cd KFC

# Install dependencies
npm install
```

### Running the Server

```bash
# Production
npm start

# Development (auto-restart on file changes)
npm run dev
```

The server starts on **http://localhost:3000** by default. Set the `PORT` environment variable to use a different port.

### Running with Docker

The repository ships a multi-stage `Dockerfile` and a `docker-compose.yml`.

```bash
# Build and run with Docker Compose (recommended)
docker compose up --build

# ...or with plain Docker
docker build -t kfc .
docker run -p 3000:3000 -v kfc-data:/app/data kfc
```

The app then listens on **http://localhost:3000**. Notes:

- The image runs as the non-root `node` user.
- SQLite databases live in `/app/data`, mounted as a named volume (`kfc-data`) so solves and sessions survive container restarts.
- A `HEALTHCHECK` polls `/healthz`, which reports `{ "status": "ok", ... }` once the app and database are ready.
- Set `SESSION_SECRET` and `TOT_SECRET` via the environment (see `docker-compose.yml`) before exposing the app publicly.

### Deploying to Fly.io

Because KFC keeps its state in a single-file SQLite database, it runs as **one always-on instance with a persistent volume** — which is exactly what the bundled [`fly.toml`](fly.toml) sets up (it builds the `Dockerfile` and mounts a volume at `/app/data`).

```bash
# 1. Install flyctl (https://fly.io/docs/flyctl/install/) and log in
fly auth login

# 2. Pick a unique app name: edit `app = "..."` in fly.toml, or:
fly apps create my-kfc

# 3. Create the persistent volume the config expects (match your region)
fly volumes create kfc_data --region iad --size 1

# 4. Set your secrets (never bake these into the image)
fly secrets set SESSION_SECRET="$(openssl rand -hex 32)" \
                TOT_SECRET="$(openssl rand -hex 32)" \
                ADMIN_USERS="your-username"

# 5. Deploy and open it
fly deploy
fly open
```

> **Single instance only.** The SQLite database lives on one machine's volume, so do **not** `fly scale count` above 1. To run multiple instances (or use an autoscaling host like Cloud Run), migrate the app to Postgres first.

#### Continuous deployment (GitHub Actions)

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) automatically deploys to Fly.io on every push to `main` — but only **after the test suite passes** (the `deploy` job `needs` the `test` job). Overlapping deploys are queued, not cancelled.

One-time setup:

```bash
# Create a scoped deploy token for the app
fly tokens create deploy
```

Then add it to the repo: **Settings → Secrets and variables → Actions → New repository secret**, named `FLY_API_TOKEN`. After that, `git push` to `main` builds, tests, and ships automatically. You can also trigger it manually from the Actions tab (`workflow_dispatch`).

Until that secret is set the workflow still runs the tests, but the deploy step **skips gracefully** (with a warning annotation) instead of failing — so enabling CD is just a matter of adding the token later.

### Deploying to Render (free tier)

The bundled [`render.yaml`](render.yaml) is a Blueprint that runs KFC entirely on Render's **free tier**: a free web service (built from the `Dockerfile`) plus a **free Render Postgres**, with `DATABASE_URL` wired up automatically. Postgres is what makes the free tier work — free web services have no persistent disk, so the SQLite files wouldn't survive a restart.

1. Push the repo to GitHub, then in Render choose **New → Blueprint** and point it at your fork.
2. Render provisions the web service + Postgres, wires `DATABASE_URL`, and auto-generates `SESSION_SECRET` / `TOT_SECRET`.
3. Set `ADMIN_USERS` in the dashboard (it's marked `sync: false`).

> **Free-tier caveats:** the web service **sleeps after ~15 min idle** (first request after a nap is slow), and Render's free Postgres has storage/retention limits. Fine for demos and small events; upgrade the instance for an always-on competition. Prefer SQLite + a persistent disk? See the switch instructions commented at the top of `render.yaml` (use `plan: starter` + a disk).

**Auto-deploy from GitHub Actions.** Render can auto-deploy natively, or you can use the bundled [`.github/workflows/deploy-render.yml`](.github/workflows/deploy-render.yml): on every push to `main` it runs the tests, then triggers a Render **Deploy Hook**. To enable it, copy your service's hook URL (Render → your service → **Settings → Deploy Hook**) into a repo secret named `RENDER_DEPLOY_HOOK_URL` (Settings → Secrets and variables → Actions). Until that secret is set, the workflow runs the tests and skips the deploy step gracefully.

### Deploying to Railway

The bundled [`railway.json`](railway.json) tells Railway to build from the `Dockerfile` and health-check `/healthz`.

1. Create a project from your repo (`railway init` / the dashboard).
2. Add a **Volume** mounted at `/app/data` (Railway volumes are configured in the dashboard/CLI).
3. Set variables: `KFC_DATA_DIR=/app/data`, plus `SESSION_SECRET`, `TOT_SECRET`, and `ADMIN_USERS`.
4. Deploy. Keep it at a single replica (`numReplicas: 1`) — SQLite is single-instance.

### Using Postgres (free-tier hosting)

KFC runs on **SQLite by default** (zero config). Setting `DATABASE_URL` switches it to **Postgres**, which unlocks the genuinely-free hosting combos — e.g. a **Render free web service** (or Railway/Fly) plus a **free managed Postgres** from [Neon](https://neon.tech), [Supabase](https://supabase.com), or Render. Postgres also removes the single-instance limitation, so you can scale horizontally.

```bash
# Point KFC at any Postgres and it creates its own schema + seeds on boot
DATABASE_URL="postgres://user:pass@host:5432/kfc" npm start
```

- The backend is chosen at startup by the presence of `DATABASE_URL` (see [`store/`](store/)); both backends implement the same interface.
- Sessions are stored in Postgres too (via `connect-pg-simple`), so no local disk is needed — perfect for ephemeral-filesystem hosts.
- SSL is enabled automatically for remote hosts (disabled for `localhost`); most managed providers require it.
- `/healthz` reports which backend is active (`"backend": "sqlite" | "postgres"`).

### Environment Variables

| Variable               | Description                                                        | Default                           |
| ---------------------- | ------------------------------------------------------------------ | --------------------------------- |
| `PORT`                 | Port the server listens on                                         | `3000`                            |
| `SESSION_SECRET`       | Secret used to sign session cookies                                | `cluck-cluck-change-me-in-prod`   |
| `TOT_SECRET`           | HS256 signing key for the Token of Trust challenge                 | `coop-signing-key-do-not-share`   |
| `KFC_DATA_DIR`         | Directory for the SQLite databases (`kfc.db`, `sessions.db`)       | `./data`                          |
| `DATABASE_URL`         | Postgres connection string. If set, KFC uses Postgres instead of SQLite | *(unset → SQLite)*          |
| `DYN_DECAY`            | Solves at which a challenge decays to its floor value              | `20`                              |
| `DYN_MIN_RATIO`        | Challenge value floor, as a fraction of its initial points         | `0.4`                             |
| `FLAG_RATE_MAX`        | Max flag submissions per user per window (rate limiting)           | `15`                              |
| `FLAG_RATE_WINDOW_MS`  | Rate-limit window in milliseconds                                  | `60000`                           |

> **Important:** Always set a strong `SESSION_SECRET` in production.

## Challenge Catalogue

Flags are intentionally omitted here — they live server-side in `challenges.seed.js`.

### 🕸️ Web
| Challenge | Points | Skill tested |
| --------- | ------ | ------------ |
| The Coop Inspector | 50 | View Source / Inspect Element |
| Robots Roost | 50 | `robots.txt` discovery |
| Cookie Coop | 75 | Cookie tampering |
| Headers of the Henhouse | 100 | HTTP response headers |
| The Egg Vault | 150 | Path traversal (sandboxed virtual FS) |

### 💥 Pwn / Logic
| Challenge | Points | Skill tested |
| --------- | ------ | ------------ |
| Coop Records | 100 | IDOR / broken access control |
| Fowl Play Shop | 125 | Business-logic (negative-quantity) tampering |
| Token of Trust | 175 | JWT `alg:none` authentication bypass |

### 🔐 Crypto
| Challenge | Points | Skill tested |
| --------- | ------ | ------------ |
| Base64 Eggs | 50 | Base64 decoding |
| Caesar Cluck | 75 | ROT13 / Caesar cipher |
| Binary Brood | 75 | Binary → ASCII |
| The Vigenère Vane | 125 | Vigenère cipher |

### 🔧 Reversing
| Challenge | Points | Skill tested |
| --------- | ------ | ------------ |
| The Cluck Lock | 100 | Reverse an XOR-masked lookup table |
| Matryoshka Egg | 150 | Undo layered `base64(reverse(xor()))` encoding |

### 🖼️ Stego
| Challenge | Points | Skill tested |
| --------- | ------ | ------------ |
| Invisible Ink | 100 | Zero-width character steganography |
| Tail Feathers | 125 | Data appended after a PNG's `IEND` chunk |

### 🧪 Forensics
| Challenge | Points | Skill tested |
| --------- | ------ | ------------ |
| Strings Attached | 75 | `strings` / `grep` on a binary blob |

### 🔎 OSINT
| Challenge | Points | Skill tested |
| --------- | ------ | ------------ |
| Find The Hen | 100 | Reading text embedded in an image |
| Metadata Molt | 100 | Hidden SVG file metadata |

### 🎲 Misc
| Challenge | Points | Skill tested |
| --------- | ------ | ------------ |
| Morse Cluck | 75 | Morse code decoding |

## Project Structure

```
KFC/
├── server.js              # Express app, auth, and all challenge routes
├── db.js                  # SQLite schema & seed helpers
├── scoring.js             # Dynamic (decaying) scoring formula
├── challenges.seed.js     # Challenge definitions (flags live here)
├── package.json
├── tools/
│   └── gen_challenges.js  # One-off generator for binary/stego assets
├── test/                  # node:test suites (challenge integrity + scoring)
├── public/
│   ├── style.css          # Global stylesheet (incl. category pills)
│   ├── robots.txt         # Used by the Robots Roost challenge
│   └── challenges/        # Static assets, one folder per challenge
│       ├── find-the-hen/photo.svg
│       ├── metadata-molt/portrait.svg
│       ├── strings-attached/gizzard.dat
│       ├── cluck-lock/lock.js
│       ├── matryoshka-egg/egg.js
│       ├── tail-feathers/rooster.png
│       └── morse-cluck/transmission.txt
└── views/
    ├── index.ejs          # Home page
    ├── register.ejs       # Registration form
    ├── login.ejs          # Login form
    ├── challenges.ejs     # Challenge listing (category order/labels/icons)
    ├── challenge.ejs      # Single challenge view + flag submission
    ├── scoreboard.ejs     # Scoreboard
    ├── 404.ejs            # Not-found page
    ├── partials/
    │   ├── header.ejs
    │   └── footer.ejs
    └── challenge-pages/   # Custom sub-pages for interactive challenges
        ├── coop-inspector-board.ejs
        ├── cookie-coop-door.ejs
        ├── header-hen-desk.ejs
        ├── robots-roost-nest.ejs
        ├── invisible-ink-notice.ejs
        └── token-of-trust-portal.ejs
```

## How to Play

1. **Sign up** — pick a username (3–24 characters, no email required).
2. **Browse challenges** — each one has a description and point value.
3. **Solve it** — use your browser tools, decode ciphers, investigate images, or exploit logic bugs.
4. **Submit the flag** — flags always look like `CHICKEN{something_like_this}`.
5. **Climb the scoreboard** — earn points for each unique solve.

## Authoring New Challenges

Every challenge is defined as an entry in `challenges.seed.js`. The server upserts the list on every boot, so changes take effect on restart.

### 1. Add a seed entry

```js
{
  slug: 'your-challenge-slug',   // unique, URL-safe
  title: 'Challenge Title',
  category: 'web',               // see valid categories below
  points: 100,
  description: `HTML shown on the challenge page. Links, <pre>, <img>, etc. are all fine.`,
  flag: 'CHICKEN{your_flag_here}',
  asset_path: null,              // or '/challenges/<slug>/<file>' for a downloadable asset
  requires: ['other-slug'],      // optional: locked until these challenges are solved
  writeup: `Optional HTML explanation, revealed only after the player solves this challenge.`,
  hints: [{ body: 'Optional hint HTML.', cost: 10 }],  // optional paid hints
}
```

Locked challenges never send their description, hints, or writeup to the client, and the submit/hint routes reject attempts server-side until prerequisites are met. Writeups are only served after a solve.

**Valid categories:** `web`, `pwn`, `crypto`, `rev`, `stego`, `forensics`, `osint`, `misc`.
The listing order, labels, and icons for these live in `views/challenges.ejs`, and their pill colours are in `public/style.css` (`.cat-<category>`). To introduce a brand-new category, update those two files as well.

### 2. Static-asset challenges (crypto, stego, forensics, OSINT, rev)

Drop files under `public/challenges/<slug>/` and reference them from the description (and `asset_path`). Binary/steganographic assets (the PNG with appended data, the zero-width page, the XOR tables, etc.) are generated and round-trip-verified by `tools/gen_challenges.js` — extend that script when adding similar puzzles so they stay reproducible.

### 3. Interactive challenges (web, pwn)

Challenges that need server logic get a route under `/c/:slug/...` in `server.js` and, if they render a page, a view in `views/challenge-pages/`. Existing examples to copy:

- **Cookie Coop** — reads/sets a cookie and branches on its value.
- **The Egg Vault** — path traversal against an **in-memory** virtual filesystem (never touches disk).
- **Token of Trust** — hand-rolled JWT issue/verify with a deliberate `alg:none` flaw.

### 4. Golden rule

Keep the flag on the server. Store it only in `challenges.seed.js` (and, where a challenge legitimately reveals it, in the corresponding server route or asset). Never leak it in client-visible code that isn't itself the puzzle.

## Security Notes

- Flags are stored server-side; the intentionally "vulnerable" challenges (path traversal, IDOR, JWT bypass) operate on in-memory data and never expose the real filesystem or other users' data.
- Passwords are hashed with bcrypt (cost factor 12).
- Sessions use `httpOnly` and `sameSite: lax` cookies.
- The `.gitignore` excludes the `data/` directory (databases) and `.env` files.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the dev setup, how to add challenges, testing, and the branch/PR workflow.

## License

This project is licensed under the [MIT License](LICENSE).
