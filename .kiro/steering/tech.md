---
inclusion: always
---

# Tech Stack & Commands

## Stack
- **Runtime:** Node.js (18+)
- **Web framework:** Express 4
- **Views:** EJS (server-rendered)
- **Auth:** bcrypt password hashing; express-session
- **Database:** SQLite (default, via `better-sqlite3`) OR Postgres (via `pg`),
  selected at startup by the presence of `DATABASE_URL`.
- **Sessions:** `connect-sqlite3` (SQLite) or `connect-pg-simple` (Postgres).

## Data layer
- All DB access goes through the async `store/` abstraction. Never talk to a
  driver directly from a route.
- `store/index.js` picks the backend; `store/sqlite.js` and `store/pg.js`
  implement the same async interface.
- Keep the two backends behaviourally identical (e.g. first-blood is computed in
  JS, not with a SQLite-only `MIN()` trick).

## Common commands
```bash
npm install        # install dependencies
npm start          # run the server (http://localhost:3000)
npm run dev        # run with auto-reload
npm test           # run the node:test suites (challenge integrity + units)
```

## Configuration (env vars)
- `PORT` (default 3000)
- `DATABASE_URL` — if set, use Postgres; otherwise SQLite
- `KFC_DATA_DIR` — SQLite data directory (default `./data`)
- `SESSION_SECRET`, `TOT_SECRET` — secrets; always set in production
- `ADMIN_USERS` — comma-separated admin usernames (admin area is off unless set)
- `DYN_DECAY`, `DYN_MIN_RATIO` — dynamic-scoring tuning
- `FLAG_RATE_MAX`, `FLAG_RATE_WINDOW_MS` — flag-submission rate limiting

## Deployment
- Dockerfile (multi-stage, non-root) + `/healthz` health check.
- Blueprints/config for Fly.io, Render (free tier + Postgres), and Railway.
- GitHub Actions: `ci.yml` (tests), `deploy.yml` (Fly), `deploy-render.yml`
  (Render deploy hook). Deploys are gated on the test suite passing.
- Live instance: https://kfc-j10g.onrender.com/
