'use strict';

// SQLite backend (default). Wraps the synchronous better-sqlite3 driver behind
// an async interface so it's interchangeable with the Postgres backend.

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.KFC_DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'kfc.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Schema is created at load so prepared statements below validate.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
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
    idx          INTEGER NOT NULL,
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

// Add columns introduced after the original schema (no-op if present).
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
ensureColumn('challenges', 'writeup', 'TEXT');

const S = {
  userByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
  publicUserByUsername: db.prepare('SELECT id, username, created_at FROM users WHERE username = ?'),
  userById: db.prepare('SELECT id, username FROM users WHERE id = ?'),
  createUser: db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)'),
  usersBasic: db.prepare('SELECT id, username FROM users'),
  usersWithMeta: db.prepare('SELECT id, username, created_at FROM users'),
  countUsers: db.prepare('SELECT COUNT(*) AS n FROM users'),
  deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),

  allChallenges: db.prepare('SELECT id, slug, title, category, points FROM challenges ORDER BY category, points, id'),
  challengeBySlug: db.prepare('SELECT * FROM challenges WHERE slug = ?'),
  challengeStubById: db.prepare('SELECT id, slug, title FROM challenges WHERE id = ?'),
  challengePoints: db.prepare('SELECT id, points FROM challenges'),
  countChallenges: db.prepare('SELECT COUNT(*) AS n FROM challenges'),

  solveExists: db.prepare('SELECT 1 FROM solves WHERE user_id = ? AND challenge_id = ?'),
  insertSolve: db.prepare('INSERT OR IGNORE INTO solves (user_id, challenge_id) VALUES (?, ?)'),
  solvedIdsForUser: db.prepare('SELECT challenge_id FROM solves WHERE user_id = ?'),
  solveCountForChallenge: db.prepare('SELECT COUNT(*) AS n FROM solves WHERE challenge_id = ?'),
  allSolves: db.prepare('SELECT user_id, challenge_id, solved_at FROM solves'),
  countSolves: db.prepare('SELECT COUNT(*) AS n FROM solves'),
  recentSolves: db.prepare(`
    SELECT u.username, c.title, c.slug, s.solved_at
    FROM solves s
    JOIN users u      ON u.id = s.user_id
    JOIN challenges c ON c.id = s.challenge_id
    ORDER BY s.solved_at DESC, u.username ASC
    LIMIT ?
  `),
  solvesForUser: db.prepare(`
    SELECT c.id AS challenge_id, c.slug, c.title, c.category, c.points, s.solved_at
    FROM solves s
    JOIN challenges c ON c.id = s.challenge_id
    WHERE s.user_id = ?
    ORDER BY s.solved_at DESC, c.points DESC
  `),
  deleteSolvesForUser: db.prepare('DELETE FROM solves WHERE user_id = ?'),

  hintsForChallenge: db.prepare('SELECT id, idx, body, cost FROM hints WHERE challenge_id = ? ORDER BY idx'),
  hintByChallengeAndIdx: db.prepare('SELECT * FROM hints WHERE challenge_id = ? AND idx = ?'),
  unlockedHintIdsForUser: db.prepare('SELECT hint_id FROM hint_unlocks WHERE user_id = ?'),
  unlockHint: db.prepare('INSERT OR IGNORE INTO hint_unlocks (user_id, hint_id) VALUES (?, ?)'),
  hintsSpentForUser: db.prepare('SELECT COALESCE(SUM(h.cost), 0) AS spent FROM hint_unlocks hu JOIN hints h ON h.id = hu.hint_id WHERE hu.user_id = ?'),
  hintSpendByUser: db.prepare(`
    SELECT hu.user_id AS uid, COALESCE(SUM(h.cost), 0) AS spent
    FROM hint_unlocks hu JOIN hints h ON h.id = hu.hint_id
    GROUP BY hu.user_id
  `),
  countHintUnlocks: db.prepare('SELECT COUNT(*) AS n FROM hint_unlocks'),
  deleteHintUnlocksForUser: db.prepare('DELETE FROM hint_unlocks WHERE user_id = ?'),

  allPrereqs: db.prepare('SELECT challenge_id, requires_id FROM challenge_prereqs'),
  prereqsForChallenge: db.prepare('SELECT requires_id FROM challenge_prereqs WHERE challenge_id = ?'),

  insertChallenge: db.prepare(`
    INSERT INTO challenges (slug, title, category, points, description, flag, asset_path, writeup)
    VALUES (@slug, @title, @category, @points, @description, @flag, @asset_path, @writeup)
    ON CONFLICT(slug) DO UPDATE SET
      title = excluded.title, category = excluded.category, points = excluded.points,
      description = excluded.description, flag = excluded.flag,
      asset_path = excluded.asset_path, writeup = excluded.writeup
  `),
  getChallengeId: db.prepare('SELECT id FROM challenges WHERE slug = ?'),
  clearPrereqs: db.prepare('DELETE FROM challenge_prereqs WHERE challenge_id = ?'),
  insertPrereq: db.prepare('INSERT OR IGNORE INTO challenge_prereqs (challenge_id, requires_id) VALUES (?, ?)'),
  upsertHint: db.prepare(`
    INSERT INTO hints (challenge_id, idx, body, cost)
    VALUES (@challenge_id, @idx, @body, @cost)
    ON CONFLICT(challenge_id, idx) DO UPDATE SET body = excluded.body, cost = excluded.cost
  `),
};

const seedTx = db.transaction((rows) => {
  for (const r of rows) {
    const { hints, requires, ...challengeRow } = r;
    challengeRow.asset_path = challengeRow.asset_path ?? null;
    challengeRow.writeup = challengeRow.writeup ?? null;
    S.insertChallenge.run(challengeRow);
    if (Array.isArray(hints) && hints.length) {
      const cid = S.getChallengeId.get(r.slug).id;
      hints.forEach((h, i) => S.upsertHint.run({
        challenge_id: cid, idx: i, body: h.body, cost: Number.isInteger(h.cost) ? h.cost : 0,
      }));
    }
  }
  for (const r of rows) {
    const cid = S.getChallengeId.get(r.slug).id;
    S.clearPrereqs.run(cid);
    if (Array.isArray(r.requires)) {
      for (const reqSlug of r.requires) {
        const req = S.getChallengeId.get(reqSlug);
        if (req && req.id !== cid) S.insertPrereq.run(cid, req.id);
      }
    }
  }
});

const resetTx = db.transaction((uid) => {
  S.deleteHintUnlocksForUser.run(uid);
  S.deleteSolvesForUser.run(uid);
});

module.exports = {
  kind: 'sqlite',

  async init(seedList) { seedTx(seedList); },

  makeSessionStore(session) {
    const SQLiteStore = require('connect-sqlite3')(session);
    return new SQLiteStore({ db: 'sessions.db', dir: DATA_DIR });
  },

  // ----- users -----
  async getUserByUsername(u) { return S.userByUsername.get(u); },
  async getPublicUserByUsername(u) { return S.publicUserByUsername.get(u); },
  async getUserById(id) { return S.userById.get(id); },
  async createUser(u, hash) { return { id: S.createUser.run(u, hash).lastInsertRowid }; },
  async usersBasic() { return S.usersBasic.all(); },
  async usersWithMeta() { return S.usersWithMeta.all(); },
  async countUsers() { return S.countUsers.get().n; },
  async deleteUser(id) { S.deleteUser.run(id); },

  // ----- challenges -----
  async allChallenges() { return S.allChallenges.all(); },
  async challengeBySlug(slug) { return S.challengeBySlug.get(slug); },
  async challengeStubById(id) { return S.challengeStubById.get(id); },
  async challengePoints() { return S.challengePoints.all(); },
  async countChallenges() { return S.countChallenges.get().n; },

  // ----- solves -----
  async solveExists(uid, cid) { return !!S.solveExists.get(uid, cid); },
  async insertSolve(uid, cid) { return { inserted: S.insertSolve.run(uid, cid).changes > 0 }; },
  async solvedIdsForUser(uid) { return S.solvedIdsForUser.all(uid); },
  async solveCountForChallenge(cid) { return S.solveCountForChallenge.get(cid).n; },
  async allSolves() { return S.allSolves.all(); },
  async countSolves() { return S.countSolves.get().n; },
  async recentSolves(limit = 25) { return S.recentSolves.all(limit); },
  async solvesForUser(uid) { return S.solvesForUser.all(uid); },
  async deleteSolvesForUser(uid) { S.deleteSolvesForUser.run(uid); },

  // ----- hints -----
  async hintsForChallenge(cid) { return S.hintsForChallenge.all(cid); },
  async hintByChallengeAndIdx(cid, idx) { return S.hintByChallengeAndIdx.get(cid, idx); },
  async unlockedHintIdsForUser(uid) { return S.unlockedHintIdsForUser.all(uid); },
  async unlockHint(uid, hid) { return { inserted: S.unlockHint.run(uid, hid).changes > 0 }; },
  async hintsSpentForUser(uid) { return S.hintsSpentForUser.get(uid).spent; },
  async hintSpendByUser() { return S.hintSpendByUser.all(); },
  async countHintUnlocks() { return S.countHintUnlocks.get().n; },
  async deleteHintUnlocksForUser(uid) { S.deleteHintUnlocksForUser.run(uid); },

  // ----- prerequisites -----
  async allPrereqs() { return S.allPrereqs.all(); },
  async prereqsForChallenge(cid) { return S.prereqsForChallenge.all(cid); },

  // ----- admin -----
  async resetUserProgress(uid) { resetTx(uid); },
};
