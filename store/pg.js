'use strict';

// Postgres backend (enabled when DATABASE_URL is set). Unlocks free/managed
// hosts (Neon, Supabase, Render Postgres, Railway, ...) and horizontal scaling.

const { Pool, types } = require('pg');

// Return int8 / bigint / COUNT / SUM values as JS numbers (not strings) so the
// data types match the SQLite backend. Regular ids are int4 (already numbers).
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));

const CONN = process.env.DATABASE_URL;

function sslFor(url) {
  if (!url) return false;
  if (/sslmode=disable/.test(url)) return false;
  if (/@(localhost|127\.0\.0\.1|\[::1\])/.test(url)) return false;
  return { rejectUnauthorized: false }; // most managed PGs use self-signed chains
}

const pool = new Pool({ connectionString: CONN, ssl: sslFor(CONN) });

const rows = async (sql, params = []) => (await pool.query(sql, params)).rows;
const one = async (sql, params = []) => (await pool.query(sql, params)).rows[0];

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    username      TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    BIGINT NOT NULL DEFAULT extract(epoch from now())::bigint
  );
  CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (lower(username));

  CREATE TABLE IF NOT EXISTS challenges (
    id          SERIAL PRIMARY KEY,
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
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    solved_at    BIGINT NOT NULL DEFAULT extract(epoch from now())::bigint,
    PRIMARY KEY (user_id, challenge_id)
  );
  CREATE INDEX IF NOT EXISTS idx_solves_user ON solves(user_id);
  CREATE INDEX IF NOT EXISTS idx_solves_challenge ON solves(challenge_id);

  CREATE TABLE IF NOT EXISTS hints (
    id           SERIAL PRIMARY KEY,
    challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    idx          INTEGER NOT NULL,
    body         TEXT NOT NULL,
    cost         INTEGER NOT NULL DEFAULT 0,
    UNIQUE (challenge_id, idx)
  );

  CREATE TABLE IF NOT EXISTS hint_unlocks (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hint_id     INTEGER NOT NULL REFERENCES hints(id) ON DELETE CASCADE,
    unlocked_at BIGINT NOT NULL DEFAULT extract(epoch from now())::bigint,
    PRIMARY KEY (user_id, hint_id)
  );
  CREATE INDEX IF NOT EXISTS idx_hint_unlocks_user ON hint_unlocks(user_id);

  CREATE TABLE IF NOT EXISTS challenge_prereqs (
    challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    requires_id  INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    PRIMARY KEY (challenge_id, requires_id)
  );
`;

async function seed(list) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Pass 1: upsert challenges + hints.
    for (const r of list) {
      const res = await client.query(
        `INSERT INTO challenges (slug, title, category, points, description, flag, asset_path, writeup)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (slug) DO UPDATE SET
           title=excluded.title, category=excluded.category, points=excluded.points,
           description=excluded.description, flag=excluded.flag,
           asset_path=excluded.asset_path, writeup=excluded.writeup
         RETURNING id`,
        [r.slug, r.title, r.category, r.points, r.description, r.flag, r.asset_path ?? null, r.writeup ?? null]
      );
      const cid = res.rows[0].id;
      if (Array.isArray(r.hints)) {
        for (let i = 0; i < r.hints.length; i++) {
          const h = r.hints[i];
          await client.query(
            `INSERT INTO hints (challenge_id, idx, body, cost) VALUES ($1,$2,$3,$4)
             ON CONFLICT (challenge_id, idx) DO UPDATE SET body=excluded.body, cost=excluded.cost`,
            [cid, i, h.body, Number.isInteger(h.cost) ? h.cost : 0]
          );
        }
      }
    }
    // Pass 2: rebuild prerequisites once every challenge id exists.
    for (const r of list) {
      const cid = (await client.query('SELECT id FROM challenges WHERE slug=$1', [r.slug])).rows[0].id;
      await client.query('DELETE FROM challenge_prereqs WHERE challenge_id=$1', [cid]);
      if (Array.isArray(r.requires)) {
        for (const reqSlug of r.requires) {
          const req = (await client.query('SELECT id FROM challenges WHERE slug=$1', [reqSlug])).rows[0];
          if (req && req.id !== cid) {
            await client.query(
              'INSERT INTO challenge_prereqs (challenge_id, requires_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
              [cid, req.id]
            );
          }
        }
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  kind: 'postgres',
  pool,

  async init(seedList) {
    await pool.query(SCHEMA);
    await seed(seedList);
  },

  makeSessionStore(session) {
    const PgSession = require('connect-pg-simple')(session);
    return new PgSession({ pool, createTableIfMissing: true });
  },

  // ----- users -----
  async getUserByUsername(u) { return one('SELECT * FROM users WHERE lower(username) = lower($1)', [u]); },
  async getPublicUserByUsername(u) { return one('SELECT id, username, created_at FROM users WHERE lower(username) = lower($1)', [u]); },
  async getUserById(id) { return one('SELECT id, username FROM users WHERE id = $1', [id]); },
  async createUser(u, hash) { return one('INSERT INTO users (username, password_hash) VALUES ($1,$2) RETURNING id', [u, hash]); },
  async usersBasic() { return rows('SELECT id, username FROM users'); },
  async usersWithMeta() { return rows('SELECT id, username, created_at FROM users'); },
  async countUsers() { return (await one('SELECT COUNT(*) AS n FROM users')).n; },
  async deleteUser(id) { await pool.query('DELETE FROM users WHERE id = $1', [id]); },

  // ----- challenges -----
  async allChallenges() { return rows('SELECT id, slug, title, category, points FROM challenges ORDER BY category, points, id'); },
  async challengeBySlug(slug) { return one('SELECT * FROM challenges WHERE slug = $1', [slug]); },
  async challengeStubById(id) { return one('SELECT id, slug, title FROM challenges WHERE id = $1', [id]); },
  async challengePoints() { return rows('SELECT id, points FROM challenges'); },
  async countChallenges() { return (await one('SELECT COUNT(*) AS n FROM challenges')).n; },

  // ----- solves -----
  async solveExists(uid, cid) { return !!(await one('SELECT 1 FROM solves WHERE user_id = $1 AND challenge_id = $2', [uid, cid])); },
  async insertSolve(uid, cid) {
    const r = await pool.query('INSERT INTO solves (user_id, challenge_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [uid, cid]);
    return { inserted: r.rowCount > 0 };
  },
  async solvedIdsForUser(uid) { return rows('SELECT challenge_id FROM solves WHERE user_id = $1', [uid]); },
  async solveCountForChallenge(cid) { return (await one('SELECT COUNT(*) AS n FROM solves WHERE challenge_id = $1', [cid])).n; },
  async allSolves() { return rows('SELECT user_id, challenge_id, solved_at FROM solves'); },
  async countSolves() { return (await one('SELECT COUNT(*) AS n FROM solves')).n; },
  async recentSolves(limit = 25) {
    return rows(`
      SELECT u.username, c.title, c.slug, s.solved_at
      FROM solves s JOIN users u ON u.id = s.user_id JOIN challenges c ON c.id = s.challenge_id
      ORDER BY s.solved_at DESC, u.username ASC
      LIMIT $1`, [limit]);
  },
  async solvesForUser(uid) {
    return rows(`
      SELECT c.id AS challenge_id, c.slug, c.title, c.category, c.points, s.solved_at
      FROM solves s JOIN challenges c ON c.id = s.challenge_id
      WHERE s.user_id = $1
      ORDER BY s.solved_at DESC, c.points DESC`, [uid]);
  },
  async deleteSolvesForUser(uid) { await pool.query('DELETE FROM solves WHERE user_id = $1', [uid]); },

  // ----- hints -----
  async hintsForChallenge(cid) { return rows('SELECT id, idx, body, cost FROM hints WHERE challenge_id = $1 ORDER BY idx', [cid]); },
  async hintByChallengeAndIdx(cid, idx) { return one('SELECT * FROM hints WHERE challenge_id = $1 AND idx = $2', [cid, idx]); },
  async unlockedHintIdsForUser(uid) { return rows('SELECT hint_id FROM hint_unlocks WHERE user_id = $1', [uid]); },
  async unlockHint(uid, hid) {
    const r = await pool.query('INSERT INTO hint_unlocks (user_id, hint_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [uid, hid]);
    return { inserted: r.rowCount > 0 };
  },
  async hintsSpentForUser(uid) {
    return (await one('SELECT COALESCE(SUM(h.cost),0) AS spent FROM hint_unlocks hu JOIN hints h ON h.id = hu.hint_id WHERE hu.user_id = $1', [uid])).spent;
  },
  async hintSpendByUser() {
    return rows('SELECT hu.user_id AS uid, COALESCE(SUM(h.cost),0) AS spent FROM hint_unlocks hu JOIN hints h ON h.id = hu.hint_id GROUP BY hu.user_id');
  },
  async countHintUnlocks() { return (await one('SELECT COUNT(*) AS n FROM hint_unlocks')).n; },
  async deleteHintUnlocksForUser(uid) { await pool.query('DELETE FROM hint_unlocks WHERE user_id = $1', [uid]); },

  // ----- prerequisites -----
  async allPrereqs() { return rows('SELECT challenge_id, requires_id FROM challenge_prereqs'); },
  async prereqsForChallenge(cid) { return rows('SELECT requires_id FROM challenge_prereqs WHERE challenge_id = $1', [cid]); },

  // ----- admin -----
  async resetUserProgress(uid) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM hint_unlocks WHERE user_id = $1', [uid]);
      await client.query('DELETE FROM solves WHERE user_id = $1', [uid]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
};
