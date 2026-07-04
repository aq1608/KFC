# Design Document

## Overview

A server-rendered Express app. Route handlers gather data through an async `store`
abstraction and render EJS views. Two storage backends (SQLite, Postgres) implement
one interface and are selected at startup. Scoring is computed in application code so
it is identical across backends.

## Architecture

```
Browser ──HTTP──> Express (server.js)
                    ├─ session (SQLite or PG-backed)
                    ├─ auth (bcrypt) + requireAuth / requireAdmin
                    ├─ routes → store.<method>()  (async)
                    ├─ scoring.js (dynamic value)  difficulty.js (tiers)
                    └─ EJS views
                         │
                    store/index.js ── selects ──> store/sqlite.js | store/pg.js
                                                        │
                                                   SQLite file | Postgres
```

## Components and Interfaces

### Store interface (async, both backends implement it)
- Users: `getUserByUsername`, `getPublicUserByUsername`, `getUserById`,
  `createUser`, `usersBasic`, `usersWithMeta`, `countUsers`, `deleteUser`.
- Challenges: `allChallenges`, `challengeBySlug`, `challengeStubById`,
  `challengePoints`, `countChallenges`.
- Solves: `solveExists`, `insertSolve`, `solvedIdsForUser`,
  `solveCountForChallenge`, `allSolves`, `countSolves`, `recentSolves`,
  `solvesForUser`, `deleteSolvesForUser`.
- Hints: `hintsForChallenge`, `hintByChallengeAndIdx`, `unlockedHintIdsForUser`,
  `unlockHint`, `hintsSpentForUser`, `hintSpendByUser`, `countHintUnlocks`,
  `deleteHintUnlocksForUser`.
- Prereqs: `allPrereqs`, `prereqsForChallenge`.
- Admin: `resetUserProgress`.
- Lifecycle: `init(seed)`, `makeSessionStore(session)`, `kind`.

### Scoring
- `scoring.dynamicValue(initial, solves)` = `ceil(((floor-initial)/decay² )·n² + initial)`
  clamped to `[floor, initial]`, `floor = ceil(initial · DYN_MIN_RATIO)`.
- `computeStandings()` fetches raw users/solves/points/hint-spend once and derives:
  per-challenge current value, solve counts, first-blood (earliest solver), and
  ranked rows (net score, tie-broken by earliest last-solve).

### Gating
- `prereqsUnmet(challengeId, solvedSet)` guards the detail view, flag submit, and
  hint unlock. Locked detail responses omit description/hints/writeup and return 423.

## Data Models
- `users(id, username, password_hash, created_at)`
- `challenges(id, slug, title, category, points, description, flag, asset_path, writeup)`
- `solves(user_id, challenge_id, solved_at)` — PK(user,challenge)
- `hints(id, challenge_id, idx, body, cost)` — unique(challenge,idx)
- `hint_unlocks(user_id, hint_id, unlocked_at)`
- `challenge_prereqs(challenge_id, requires_id)`

Portability notes: ids are integers on both backends; Postgres int8/COUNT/SUM are
parsed to JS numbers; case-insensitive usernames use `COLLATE NOCASE` (SQLite) or a
`lower(username)` unique index (Postgres).

## Error Handling
- Async routes are wrapped so rejections reach a central error handler.
- Unknown routes → 404 view; server errors → 500.
- `/healthz` reports status, active backend, and challenge count.

## Testing Strategy
- `node:test` suites: seed integrity, crypto/reversing round-trips, asset-embedded
  flags, interactive challenge flows, scoring units, difficulty units, admin access
  + moderation, prerequisite gating + writeups, and a skip-by-default Postgres smoke
  test (runs when `TEST_DATABASE_URL` is set).
- CI runs the suite on every push/PR; deploys are gated on it.
