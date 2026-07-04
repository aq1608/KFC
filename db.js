const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
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
  const tx = db.transaction((rows) => { for (const r of rows) insert.run(r); });
  tx(challenges);
}

module.exports = { db, seedChallenges };
