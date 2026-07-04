---
inclusion: always
---

# Project Structure

```
KFC/
├── server.js              # Express app, auth, routes (async, uses the store)
├── store/                 # Async data-access layer
│   ├── index.js           #   backend selector (DATABASE_URL ? pg : sqlite)
│   ├── sqlite.js          #   SQLite backend (better-sqlite3)
│   └── pg.js              #   Postgres backend (pg)
├── scoring.js             # Dynamic (decaying) score formula
├── difficulty.js          # Points → difficulty tier (easy/medium/hard)
├── challenges.seed.js     # SOURCE OF TRUTH for all challenges (+ hints,
│                          #   requires, writeup)
├── public/
│   ├── style.css
│   ├── robots.txt
│   └── challenges/<slug>/ # static assets per challenge
├── views/                 # EJS templates
│   ├── *.ejs              #   pages (index, challenges, challenge, scoreboard,
│   │                      #   profile, admin, 404, register, login)
│   ├── partials/          #   header/footer
│   └── challenge-pages/   #   interactive challenge sub-pages
├── test/                  # node:test suites
├── tools/gen_challenges.js# regenerates binary/stego assets
├── Dockerfile, docker-compose.yml
├── fly.toml, render.yaml, railway.json
└── .github/workflows/     # ci.yml, deploy.yml, deploy-render.yml
```

## Where things go
- **New challenge** → add an entry to `challenges.seed.js`. Static assets under
  `public/challenges/<slug>/`. Interactive logic → a route under `/c/:slug/...`
  in `server.js` plus a view in `views/challenge-pages/`.
- **New query** → add an async method to BOTH `store/sqlite.js` and
  `store/pg.js`; call it from routes via `store`.
- **Scoring/standings logic** → keep in `computeStandings()` in `server.js` and
  the pure `scoring.js`, so it stays backend-agnostic.
- **Tests** → add/extend a suite in `test/`; every challenge should have a test
  proving its flag is reachable.
