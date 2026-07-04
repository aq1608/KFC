'use strict';

// Postgres backend smoke test. Skipped unless TEST_DATABASE_URL is set, so CI
// (which has no Postgres) stays green. To run locally against a throwaway PG:
//
//   docker run -d --name kfc-pg -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=kfc \
//     -p 55432:5432 postgres:16-alpine
//   TEST_DATABASE_URL=postgres://postgres:pw@127.0.0.1:55432/kfc npm test

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PG_URL = process.env.TEST_DATABASE_URL;
const ROOT = path.join(__dirname, '..');

describe('postgres backend', { skip: !PG_URL ? 'set TEST_DATABASE_URL to run' : false }, () => {
  let server;
  const PORT = 4711;
  const BASE = `http://127.0.0.1:${PORT}`;

  const sidFrom = (res) => (res.headers.getSetCookie ? res.headers.getSetCookie() : [])
    .map((c) => c.split(';')[0]).find((c) => c.startsWith('connect.sid='));

  before(async () => {
    server = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT), DATABASE_URL: PG_URL, SESSION_SECRET: 'test' },
      stdio: 'ignore',
    });
    const deadline = Date.now() + 15_000;
    for (;;) {
      try { if ((await fetch(`${BASE}/healthz`)).ok) break; } catch { /* wait */ }
      if (Date.now() > deadline) throw new Error('server did not start against Postgres');
      await new Promise((r) => setTimeout(r, 250));
    }
  });

  after(() => { if (server) server.kill(); });

  test('reports the postgres backend and seeds challenges', async () => {
    const h = await (await fetch(`${BASE}/healthz`)).json();
    assert.strictEqual(h.backend, 'postgres');
    assert.ok(h.challenges >= 20);
  });

  test('register + solve + scoreboard works end-to-end', async () => {
    const reg = await fetch(`${BASE}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: 'pguser', password: 'hunter2!' }),
      redirect: 'manual',
    });
    const sid = sidFrom(reg);
    assert.ok(sid, 'expected a session cookie');

    await fetch(`${BASE}/challenges/base64-eggs/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', Cookie: sid },
      body: new URLSearchParams({ flag: 'CHICKEN{b4se_of_the_coop}' }),
      redirect: 'manual',
    });

    const board = await (await fetch(`${BASE}/scoreboard`)).text();
    assert.ok(board.includes('>pguser</a>'), 'scoreboard should list the player');
  });
});
