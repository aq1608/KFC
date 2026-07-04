'use strict';

// Tests for challenge prerequisites (unlock gating) and post-solve writeups.

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const seed = require(path.join(ROOT, 'challenges.seed.js'));
const bySlug = Object.fromEntries(seed.map((c) => [c.slug, c]));

describe('seed: prerequisites reference real challenges', () => {
  test('every `requires` entry is a valid, non-self slug', () => {
    const slugs = new Set(seed.map((c) => c.slug));
    for (const c of seed) {
      if (!c.requires) continue;
      assert.ok(Array.isArray(c.requires), `${c.slug}: requires must be an array`);
      for (const req of c.requires) {
        assert.ok(slugs.has(req), `${c.slug}: requires unknown slug "${req}"`);
        assert.notStrictEqual(req, c.slug, `${c.slug}: cannot require itself`);
      }
    }
  });
});

describe('prerequisites + writeups (live server)', () => {
  let server;
  const PORT = 4322;
  const BASE = `http://127.0.0.1:${PORT}`;
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kfc-prereq-'));

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
    return sidFrom(res);
  }

  async function submitFlag(sid, slug, flag) {
    return fetch(`${BASE}/challenges/${slug}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', Cookie: sid },
      body: new URLSearchParams({ flag }),
      redirect: 'manual',
    });
  }

  const getChallenge = async (sid, slug) => {
    const res = await fetch(`${BASE}/challenges/${slug}`, { headers: { Cookie: sid } });
    return { status: res.status, body: await res.text() };
  };

  before(async () => {
    server = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT), KFC_DATA_DIR: DATA, SESSION_SECRET: 'test-secret' },
      stdio: 'ignore',
    });
    const deadline = Date.now() + 10_000;
    for (;;) {
      try { if ((await fetch(`${BASE}/healthz`)).ok) break; } catch { /* wait */ }
      if (Date.now() > deadline) throw new Error('server did not start');
      await new Promise((r) => setTimeout(r, 200));
    }
  });

  after(() => {
    if (server) server.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
  });

  // vigenere-vane requires caesar-cluck.
  const CIPHERTEXT = 'gczqtpgyopwmmt'; // appears only in the vigenere description
  const WRITEUP_MARK = 'frequency analysis'; // appears only in the vigenere writeup

  test('a locked challenge hides its puzzle and names its prerequisite', async () => {
    const sid = await register('gate1');
    const { status, body } = await getChallenge(sid, 'vigenere-vane');
    assert.strictEqual(status, 423);
    assert.ok(!body.includes(CIPHERTEXT), 'locked challenge leaked its ciphertext');
    assert.ok(body.includes('Caesar Cluck'), 'locked view should name the prerequisite');
    assert.ok(!body.includes(WRITEUP_MARK), 'writeup must not show on a locked challenge');
  });

  test('submitting a flag for a locked challenge is rejected server-side', async () => {
    const sid = await register('gate2');
    await submitFlag(sid, 'vigenere-vane', bySlug['vigenere-vane'].flag);
    // Still locked (not solved).
    const { status } = await getChallenge(sid, 'vigenere-vane');
    assert.strictEqual(status, 423, 'flag should not have registered while locked');
  });

  test('solving the prerequisite unlocks the challenge', async () => {
    const sid = await register('gate3');
    await submitFlag(sid, 'caesar-cluck', bySlug['caesar-cluck'].flag);
    const { status, body } = await getChallenge(sid, 'vigenere-vane');
    assert.strictEqual(status, 200, 'challenge should unlock after prereq solved');
    assert.ok(body.includes(CIPHERTEXT), 'unlocked challenge should show its puzzle');
    assert.ok(!body.includes(WRITEUP_MARK), 'writeup must not show before solving');
  });

  test('the writeup appears only after solving', async () => {
    const sid = await register('gate4');
    await submitFlag(sid, 'caesar-cluck', bySlug['caesar-cluck'].flag);
    // Before solving vigenere: writeup hidden.
    let res = await getChallenge(sid, 'vigenere-vane');
    assert.ok(!res.body.includes(WRITEUP_MARK));
    // Solve it, then the writeup should render.
    await submitFlag(sid, 'vigenere-vane', bySlug['vigenere-vane'].flag);
    res = await getChallenge(sid, 'vigenere-vane');
    assert.ok(res.body.includes(WRITEUP_MARK), 'writeup should show after solving');
  });
});
