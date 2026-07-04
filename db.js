const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.KFC_DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'kfc.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    username     TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at   INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS challenges (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    slug        TEXT NOT NULL UNIQUE,
    title       TEXT NOT NULL,
    category    TEXT NOT NULL,
    points      INTEGER NOT NULL,
    description TEXT NOT NULL,
    flag        TEXT NOT NULL,
    asset_path  TEXT,
    writeup     TEXT
  );

  CREATE TABLE IF NOT EXISTS solves (
    user_id      INTEGER NOT NULL,
    challenge_id INTEGER NOT NULL,
    solved_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    PRIMARY KEY (user_id, challenge_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_solves_user ON solves(user_id);
  CREATE INDEX IF NOT EXISTS idx_solves_challenge ON solves(challenge_id);

  CREATE TABLE IF NOT EXISTS hints (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    challenge_id INTEGER NOT NULL,
    idx          INTEGER NOT NULL,   -- 0-based ordering within a challenge
    body         TEXT NOT NULL,
    cost         INTEGER NOT NULL DEFAULT 0,
    UNIQUE (challenge_id, idx),
    FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS hint_unlocks (
    user_id     INTEGER NOT NULL,
    hint_id     INTEGER NOT NULL,
    unlocked_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    PRIMARY KEY (user_id, hint_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (hint_id) REFERENCES hints(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_hint_unlocks_user ON hint_unlocks(user_id);

  CREATE TABLE IF NOT EXISTS challenge_prereqs (
    challenge_id INTEGER NOT NULL,
    requires_id  INTEGER NOT NULL,
    PRIMARY KEY (challenge_id, requires_id),
    FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE,
    FOREIGN KEY (requires_id)  REFERENCES challenges(id) ON DELETE CASCADE
  );
`);

// Lightweight migration for DBs created before a column existed.
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
ensureColumn('challenges', 'writeup', 'TEXT');

function seedChallenges(challenges) {
  const insert = db.prepare(`
    INSERT INTO challenges (slug, title, category, points, description, flag, asset_path, writeup)
    VALUES (@slug, @title, @category, @points, @description, @flag, @asset_path, @writeup)
    ON CONFLICT(slug) DO UPDATE SET
      title       = excluded.title,
      category    = excluded.category,
      points      = excluded.points,
      description = excluded.description,
      flag        = excluded.flag,
      asset_path  = excluded.asset_path,
      writeup     = excluded.writeup
  `);
  const getId = db.prepare('SELECT id FROM challenges WHERE slug = ?');
  const clearPrereqs = db.prepare('DELETE FROM challenge_prereqs WHERE challenge_id = ?');
  const insertPrereq = db.prepare(
    'INSERT OR IGNORE INTO challenge_prereqs (challenge_id, requires_id) VALUES (?, ?)'
  );
  // Upsert by (challenge_id, idx) so hint IDs are stable across re-seeds and
  // existing hint_unlocks keep pointing at the right hint.
  const upsertHint = db.prepare(`
    INSERT INTO hints (challenge_id, idx, body, cost)
    VALUES (@challenge_id, @idx, @body, @cost)
    ON CONFLICT(challenge_id, idx) DO UPDATE SET
      body = excluded.body,
      cost = excluded.cost
  `);

  const tx = db.transaction((rows) => {
    // Pass 1: upsert challenges and their hints.
    for (const r of rows) {
      // `hints` and `requires` are not columns — strip them before binding.
      const { hints, requires, ...challengeRow } = r;
      challengeRow.writeup = challengeRow.writeup ?? null;
      insert.run(challengeRow);
      if (Array.isArray(hints) && hints.length) {
        const challengeId = getId.get(r.slug).id;
        hints.forEach((h, i) => {
          upsertHint.run({
            challenge_id: challengeId,
            idx: i,
            body: h.body,
            cost: Number.isInteger(h.cost) ? h.cost : 0,
          });
        });
      }
    }
    // Pass 2: rebuild prerequisites now that every challenge id exists.
    for (const r of rows) {
      const challengeId = getId.get(r.slug).id;
      clearPrereqs.run(challengeId);
      if (Array.isArray(r.requires)) {
        for (const reqSlug of r.requires) {
          const req = getId.get(reqSlug);
          if (req && req.id !== challengeId) insertPrereq.run(challengeId, req.id);
        }
      }
    }
  });
  tx(challenges);
}

module.exports = { db, seedChallenges };
