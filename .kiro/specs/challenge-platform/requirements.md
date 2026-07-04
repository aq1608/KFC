# Requirements Document

## Introduction

KFC is a Capture-The-Flag platform where authenticated players solve challenges to
recover flags (format `CHICKEN{...}`) and compete on a scoreboard. This spec covers
the core platform: accounts, challenges, solving, dynamic scoring, hints,
prerequisite gating, post-solve writeups, profiles, the scoreboard, and admin
moderation. It must run on either SQLite (default) or Postgres.

## Requirements

### Requirement 1 — Accounts
**User Story:** As a visitor, I want to register and log in with just a username and
password, so that I can track my progress.

#### Acceptance Criteria
1. WHEN a visitor submits a username of 3–24 chars (letters, numbers, `_`, `-`) and
   a password of at least 6 chars THEN the system SHALL create the account and start
   a session.
2. IF the username already exists (case-insensitive) THEN the system SHALL reject
   registration with a clear message.
3. WHEN a user submits valid credentials THEN the system SHALL authenticate them
   against a bcrypt-hashed password.

### Requirement 2 — Challenges & solving
**User Story:** As a player, I want to view challenges and submit flags, so that I
can score points.

#### Acceptance Criteria
1. WHEN an authenticated player opens the challenges page THEN the system SHALL list
   challenges grouped by category with each challenge's current value and difficulty.
2. WHEN a player submits the correct flag THEN the system SHALL record a solve exactly
   once and confirm the points earned.
3. WHEN a player submits an incorrect flag THEN the system SHALL reject it without
   recording a solve.
4. WHEN a player exceeds the flag-submission rate limit THEN the system SHALL reject
   further attempts temporarily.

### Requirement 3 — Dynamic scoring
**User Story:** As an organiser, I want challenge values to decay as more players
solve them, so that early solves of hard challenges are rewarded.

#### Acceptance Criteria
1. WHEN a challenge has N solves THEN its value SHALL be `dynamicValue(initial, N)`,
   clamped between a floor and the initial value.
2. WHEN the solve count increases THEN the value SHALL be non-increasing.
3. A player's net score SHALL equal the sum of the current values of their solved
   challenges minus the cost of hints they have unlocked.

### Requirement 4 — Hints
**User Story:** As a player, I want to optionally unlock hints, so that I can get
help at a point cost.

#### Acceptance Criteria
1. WHEN a player unlocks a hint THEN the system SHALL deduct its cost from their net
   score and reveal the hint body.
2. Locked hint bodies SHALL NOT be sent to the client.

### Requirement 5 — Prerequisites (unlock gating)
**User Story:** As an organiser, I want to gate advanced challenges behind easier
ones, so that players progress in order.

#### Acceptance Criteria
1. WHILE any prerequisite is unsolved the challenge SHALL be locked, and the system
   SHALL NOT send its description, hints, or writeup to the client.
2. WHEN a locked challenge's flag or hint is requested THEN the server SHALL reject
   it regardless of the UI.
3. WHEN all prerequisites are solved THEN the challenge SHALL unlock.

### Requirement 6 — Writeups
**User Story:** As a player, I want to see an explanation after solving, so that I
learn the technique.

#### Acceptance Criteria
1. WHEN a player has solved a challenge THEN the system SHALL show its writeup.
2. IF a player has not solved a challenge THEN the writeup SHALL NOT be sent.

### Requirement 7 — Scoreboard & profiles
**User Story:** As a player, I want a scoreboard and profiles, so that I can see
standings and progress.

#### Acceptance Criteria
1. The scoreboard SHALL rank players by net score, then earliest last-solve.
2. A profile SHALL show rank, net score, solves, first-blood count, and completion.
3. The earliest solver of each challenge SHALL be credited as first blood.

### Requirement 8 — Admin moderation
**User Story:** As an admin, I want a stats/moderation dashboard, so that I can run
the event.

#### Acceptance Criteria
1. IF a user is not listed in `ADMIN_USERS` THEN the admin area SHALL NOT be
   accessible to them.
2. WHEN an admin resets a player THEN the system SHALL clear that player's solves and
   hint unlocks.
3. WHEN an admin deletes a non-admin player THEN the account SHALL be removed;
   admin accounts SHALL be protected from deletion.

### Requirement 9 — Storage backends
**User Story:** As an operator, I want to run on SQLite or Postgres, so that I can
self-host cheaply or deploy to free/managed hosts.

#### Acceptance Criteria
1. WHEN `DATABASE_URL` is set THEN the system SHALL use Postgres; otherwise SQLite.
2. Both backends SHALL expose the same behaviour and pass the same tests.
3. On startup the system SHALL create its schema and seed challenges before serving.
