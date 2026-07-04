# Contributing to KFC

Thanks for helping build **Keep Finding Chickens**! This guide covers the dev workflow, how to add challenges, and what CI expects. For an architectural overview and the full challenge catalogue, see the [README](README.md).

## Development setup

```bash
git clone https://github.com/aq1608/KFC.git
cd KFC
npm install
npm run dev      # auto-restart on file changes (http://localhost:3000)
```

- **Node.js v18+** is required (the test runner and code rely on built-in `node:test` and global `fetch`).
- Data lives in `./data` (SQLite, git-ignored). Set `KFC_DATA_DIR` to relocate it. Delete the folder to start fresh.
- Useful env vars are documented in the [README](README.md#environment-variables) (`ADMIN_USERS`, `DYN_DECAY`, `FLAG_RATE_MAX`, etc.).

## Running the tests

```bash
npm test
```

This runs the `node:test` suites in `test/`:

- **`challenges.test.js`** — seed integrity, crypto/reversing round-trips, asset-embedded flags, and interactive challenges (boots the server and solves each via its intended path).
- **`scoring.test.js`** — the dynamic-scoring decay formula.
- **`difficulty.test.js`** — the points → difficulty-tier mapping.
- **`admin.test.js`** — admin access control and moderation.

CI (`.github/workflows/ci.yml`) runs `npm ci && npm test` on every push to `main`/`draft` and on all PRs. **Keep the suite green** — the runner exits non-zero on failure, which blocks the PR.

## Project layout

| Path | Purpose |
| ---- | ------- |
| `server.js` | Express app, auth, all routes |
| `db.js` | SQLite schema + idempotent seeding |
| `scoring.js` | Dynamic (decaying) score formula |
| `difficulty.js` | Points → difficulty tier |
| `challenges.seed.js` | **Source of truth for all challenges** |
| `public/challenges/<slug>/` | Static assets per challenge |
| `views/` | EJS templates (`challenge-pages/` holds interactive sub-pages) |
| `tools/gen_challenges.js` | Regenerates binary/stego assets |
| `test/` | `node:test` suites |

## Adding a challenge

The full step-by-step lives in the [README authoring guide](README.md#authoring-new-challenges). In short:

1. Append an entry to `challenges.seed.js` (`slug`, `title`, `category`, `points`, `description`, `flag`, optional `asset_path` and `hints`). The server upserts on every boot.
2. **Static-asset puzzles** (crypto/stego/forensics): drop files under `public/challenges/<slug>/`. If the asset is generated (e.g. a PNG with appended data), add its generation to `tools/gen_challenges.js` so it stays reproducible.
3. **Interactive puzzles** (web/pwn): add a route under `/c/:slug/...` in `server.js` and, if it renders a page, a view in `views/challenge-pages/`.
4. Add a case to `test/challenges.test.js` so CI proves your flag is reachable.

### Ground rules for challenges

- **Flags never leave the server** except as the intended puzzle solution. Store them only in `challenges.seed.js` (and in the route/asset that legitimately reveals them). Don't leak a flag in client-visible code that isn't itself the puzzle.
- **Flags use the `CHICKEN{...}` format.**
- **"Vulnerable" challenges must be sandboxed.** The path-traversal, IDOR, and JWT challenges operate on in-memory data only — never touch the real filesystem or other users' data.
- `slug` is lowercase, URL-safe, and unique. `points` maps to a difficulty tier (`<=75` Easy, `<=125` Medium, `>125` Hard).

## Branch & PR workflow

- Branch off `draft` (not `main`). Use a descriptive prefix: `feat/...`, `fix/...`, `docs/...`.
- Keep PRs focused; open them against `draft`. `draft` is merged to `main` in batches.
- Run `npm test` locally before pushing.
- Write a clear PR description: what changed, why, and how you tested it.
- Never commit the `data/` directory, real secrets, or `node_modules`.

## Code style

- CommonJS modules, 2-space indentation, semicolons — match the surrounding code.
- Prefer prepared statements (`db.prepare(...)`) for any new SQL.
- No new runtime dependencies without discussion; the app deliberately runs on a small, well-known stack.
- Keep views server-rendered (EJS); client-side JS should be small, dependency-free, and progressive-enhancement friendly.

Happy hunting. 🐔
