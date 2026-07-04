'use strict';

// Admin panel integration tests: env-gated access control and moderation
// actions. Boots a dedicated server with ADMIN_USERS set.

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

describe('admin panel', () => {
  let server;
  const PORT = 4321;
  const BASE = `http://127.0.0.1:${PORT}`;
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kfc-admin-'));

  const sidFrom = (res) => (res.headers.getSetCookie ? res.headers.getSetCookie() : [])
    .map((c) => c.split(';')[0])
    .find((c) => c.startsWith('connect.sid='));

  async function register(username) {
    const res = await fetch(`${BASE}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username, password: 'hunter2!' }),
      redirect: 'manual',
    });
    return { status: res.status, sid: sidFrom(res) };
  }

  async function login(username) {
    const res = await fetch(`${BASE}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username, password: 'hunter2!' }),
      redirect: 'manual',
    });
    return sidFrom(res);
  }

  // Extract the numeric user id for a given username from the dashboard HTML.
  function userIdFromDashboard(html, username) {
    const row = html.split('<tr').find((r) => r.includes(`>${username}<`));
    if (!row) return null;
    const m = row.match(/\/admin\/users\/(\d+)\//);
    return m ? m[1] : null;
  }

  before(async () => {
    server = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(PORT),
        KFC_DATA_DIR: DATA,
        SESSION_SECRET: 'test-secret',
        ADMIN_USERS: 'boss',
      },
      stdio: 'ignore',
    });
    const deadline = Date.now() + 10_000;
    for (;;) {
      try { if ((await fetch(`${BASE}/healthz`)).ok) break; } catch { /* wait */ }
      if (Date.now() > deadline) throw new Error('server did not start');
      await new Promise((r) => setTimeout(r, 200));
    }
    // Seed accounts once for all tests.
    await register('boss');   // admin (in ADMIN_USERS)
    await register('peon');   // ordinary player
  });

  after(() => {
    if (server) server.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
  });

  test('anonymous is redirected away from /admin', async () => {
    const res = await fetch(`${BASE}/admin`, { redirect: 'manual' });
    assert.strictEqual(res.status, 302);
  });

  test('non-admin gets 404 for /admin', async () => {
    const sid = await login('peon');
    const res = await fetch(`${BASE}/admin`, { headers: { Cookie: sid } });
    assert.strictEqual(res.status, 404);
  });

  test('admin can view the dashboard', async () => {
    const sid = await login('boss');
    const res = await fetch(`${BASE}/admin`, { headers: { Cookie: sid } });
    assert.strictEqual(res.status, 200);
    assert.ok((await res.text()).includes('Admin dashboard'));
  });

  test('admin can reset and delete a specific player', async () => {
    const sid = await login('boss');
    await register('victim');

    let dash = await (await fetch(`${BASE}/admin`, { headers: { Cookie: sid } })).text();
    const id = userIdFromDashboard(dash, 'victim');
    assert.ok(id, 'victim row not found on dashboard');

    const reset = await fetch(`${BASE}/admin/users/${id}/reset`, {
      method: 'POST', headers: { Cookie: sid }, redirect: 'manual',
    });
    assert.strictEqual(reset.status, 302);

    const del = await fetch(`${BASE}/admin/users/${id}/delete`, {
      method: 'POST', headers: { Cookie: sid }, redirect: 'manual',
    });
    assert.strictEqual(del.status, 302);

    assert.strictEqual((await fetch(`${BASE}/u/victim`)).status, 404, 'victim should be deleted');
  });

  test('admin accounts cannot be deleted via the panel', async () => {
    const sid = await login('boss');
    const dash = await (await fetch(`${BASE}/admin`, { headers: { Cookie: sid } })).text();
    const bossId = userIdFromDashboard(dash, 'boss');
    assert.ok(bossId);

    const del = await fetch(`${BASE}/admin/users/${bossId}/delete`, {
      method: 'POST', headers: { Cookie: sid }, redirect: 'manual',
    });
    assert.strictEqual(del.status, 302); // redirects back with an error flash

    // boss still exists.
    assert.strictEqual((await fetch(`${BASE}/u/boss`)).status, 200);
  });
});
