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
    asset_path  TEXT
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
`);

function seedChallenges(challenges) {
  const insert = db.prepare(`
    INSERT INTO challenges (slug, title, category, points, description, flag, asset_path)
    VALUES (@slug, @title, @category, @points, @description, @flag, @asset_path)
    ON CONFLICT(slug) DO UPDATE SET
      title       = excluded.title,
      category    = excluded.category,
      points      = excluded.points,
      description = excluded.description,
      flag        = excluded.flag,
      asset_path  = excluded.asset_path
  `);
  const getId = db.prepare('SELECT id FROM challenges WHERE slug = ?');
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
    for (const r of rows) {
      // `hints` is not a column — strip it before binding the challenge row.
      const { hints, ...challengeRow } = r;
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
  });
  tx(challenges);
}

module.exports = { db, seedChallenges };
