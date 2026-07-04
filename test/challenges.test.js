'use strict';

// Challenge-integrity tests. These guard against regressions in the puzzles
// themselves: that every seeded challenge is well-formed, that each crypto /
// reversing puzzle's data actually decodes to its flag, that asset-based flags
// are present in their files, and that every interactive (server-side)
// challenge still yields its flag through the intended solution path.

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const seed = require(path.join(ROOT, 'challenges.seed.js'));

const FLAG_RE = /^CHICKEN\{[ -z~]+\}$/; // printable, CHICKEN{...}
const VALID_CATEGORIES = new Set(['web', 'pwn', 'crypto', 'rev', 'stego', 'forensics', 'osint', 'misc']);
const bySlug = Object.fromEntries(seed.map((c) => [c.slug, c]));

// ---------- small codec helpers ----------
const rot13 = (s) => s.replace(/[a-z]/gi, (ch) => {
  const base = ch <= 'Z' ? 65 : 97;
  return String.fromCharCode(((ch.charCodeAt(0) - base + 13) % 26) + base);
});
const toBinary = (s) => [...s].map((c) => c.charCodeAt(0).toString(2).padStart(8, '0')).join(' ');
function vigenere(pt, key, decrypt = false) {
  key = key.toUpperCase().replace(/[^A-Z]/g, '');
  let ki = 0, out = '';
  for (const ch of pt) {
    if (/[a-z]/i.test(ch)) {
      const base = ch === ch.toUpperCase() ? 65 : 97;
      const k = key.charCodeAt(ki % key.length) - 65;
      const shift = decrypt ? (26 - k) : k;
      out += String.fromCharCode(((ch.charCodeAt(0) - base + shift) % 26) + base);
      ki++;
    } else out += ch;
  }
  return out;
}
const MORSE = {
  '.-': 'A', '-...': 'B', '-.-.': 'C', '-..': 'D', '.': 'E', '..-.': 'F', '--.': 'G',
  '....': 'H', '..': 'I', '.---': 'J', '-.-': 'K', '.-..': 'L', '--': 'M', '-.': 'N',
  '---': 'O', '.--.': 'P', '--.-': 'Q', '.-.': 'R', '...': 'S', '-': 'T', '..-': 'U',
  '...-': 'V', '.--': 'W', '-..-': 'X', '-.--': 'Y', '--..': 'Z',
};
function decodeMorse(m) {
  return m.trim().split(/\s*\/\s*/).map((word) =>
    word.trim().split(/\s+/).map((sym) => MORSE[sym] || '?').join('')
  ).join(' ');
}
const readAsset = (rel) => fs.readFileSync(path.join(ROOT, 'public', rel.replace(/^\//, '')));

// =====================================================================
describe('seed integrity', () => {
  test('every challenge is well-formed', () => {
    assert.ok(seed.length >= 20, `expected >= 20 challenges, got ${seed.length}`);
    for (const c of seed) {
      assert.ok(c.slug && /^[a-z0-9-]+$/.test(c.slug), `bad slug: ${c.slug}`);
      assert.ok(c.title, `${c.slug}: missing title`);
      assert.ok(VALID_CATEGORIES.has(c.category), `${c.slug}: bad category ${c.category}`);
      assert.ok(Number.isInteger(c.points) && c.points > 0, `${c.slug}: bad points`);
      assert.ok(typeof c.description === 'string' && c.description.length > 0, `${c.slug}: missing description`);
      assert.match(c.flag, FLAG_RE, `${c.slug}: flag format`);
    }
  });

  test('slugs are unique', () => {
    assert.strictEqual(new Set(seed.map((c) => c.slug)).size, seed.length);
  });

  test('asset_path files exist', () => {
    for (const c of seed) {
      if (!c.asset_path) continue;
      assert.ok(fs.existsSync(path.join(ROOT, 'public', c.asset_path.replace(/^\//, ''))),
        `${c.slug}: asset missing ${c.asset_path}`);
    }
  });

  test('hints (where present) are well-formed', () => {
    for (const c of seed) {
      if (!c.hints) continue;
      assert.ok(Array.isArray(c.hints), `${c.slug}: hints must be an array`);
      for (const h of c.hints) {
        assert.ok(typeof h.body === 'string' && h.body.length > 0, `${c.slug}: hint body`);
        assert.ok(Number.isInteger(h.cost) && h.cost >= 0, `${c.slug}: hint cost`);
      }
    }
  });
});

// =====================================================================
describe('crypto & reversing puzzles decode to their flag', () => {
  test('base64-eggs: description embeds base64(flag)', () => {
    const c = bySlug['base64-eggs'];
    assert.ok(c.description.includes(Buffer.from(c.flag).toString('base64')));
  });

  test('binary-brood: description embeds binary(flag)', () => {
    const c = bySlug['binary-brood'];
    const descBits = (c.description.match(/[01]{8}/g) || []).join(' ');
    assert.strictEqual(descBits, toBinary(c.flag));
  });

  test('caesar-cluck: description embeds rot13(flag)', () => {
    const c = bySlug['caesar-cluck'];
    assert.ok(c.description.includes(rot13(c.flag)), 'rot13(flag) not found in description');
  });

  test('vigenere-vane: ciphertext decrypts with ROOSTER to the flag', () => {
    const c = bySlug['vigenere-vane'];
    const ct = c.description.match(/<pre>([a-z ]+)<\/pre>/)[1];
    const decoded = vigenere(ct, 'ROOSTER', true).trim().replace(/\s+/g, '_');
    assert.strictEqual(`CHICKEN{${decoded}}`, c.flag);
  });

  test('cluck-lock: TABLE ^ 42 spells the flag', () => {
    const src = readAsset('/challenges/cluck-lock/lock.js').toString('utf8');
    const table = JSON.parse(src.match(/const TABLE = (\[[^\]]*\])/)[1]);
    const recovered = table.map((n) => String.fromCharCode(n ^ 42)).join('');
    assert.strictEqual(recovered, bySlug['cluck-lock'].flag);
  });

  test('matryoshka-egg: BLOB peels back to the flag', () => {
    const egg = require(path.join(ROOT, 'public', 'challenges', 'matryoshka-egg', 'egg.js'));
    const bytes = Buffer.from(egg.BLOB, 'base64');
    const reversed = Buffer.from([...bytes].reverse());
    const out = Buffer.alloc(reversed.length);
    for (let i = 0; i < reversed.length; i++) out[i] = reversed[i] ^ egg.KEY.charCodeAt(i % egg.KEY.length);
    assert.strictEqual(out.toString('utf8'), bySlug['matryoshka-egg'].flag);
  });

  test('morse-cluck: transmission decodes to the flag', () => {
    const txt = readAsset('/challenges/morse-cluck/transmission.txt').toString('utf8');
    const morseLine = txt.split('\n').find((l) => /[.\-]/.test(l) && l.includes('/'));
    const decoded = decodeMorse(morseLine).toLowerCase().replace(/\s+/g, '_');
    assert.strictEqual(`CHICKEN{${decoded}}`, bySlug['morse-cluck'].flag);
  });
});

// =====================================================================
describe('asset-based flags are embedded in their files', () => {
  const cases = [
    ['metadata-molt', '/challenges/metadata-molt/portrait.svg'],
    ['tail-feathers', '/challenges/tail-feathers/rooster.png'],
    ['strings-attached', '/challenges/strings-attached/gizzard.dat'],
    ['find-the-hen', '/challenges/find-the-hen/photo.svg'],
  ];
  for (const [slug, asset] of cases) {
    test(`${slug}: flag content present in ${asset}`, () => {
      const buf = readAsset(asset);
      // Some assets embed the full CHICKEN{...} flag; others (e.g. find-the-hen)
      // embed only the inner secret that the player wraps themselves. The inner
      // content is a substring of the full flag, so checking it covers both.
      const flag = bySlug[slug].flag;
      const inner = flag.slice(flag.indexOf('{') + 1, -1);
      assert.ok(buf.includes(inner), `${slug}: flag content not found in asset`);
    });
  }
});

// =====================================================================
describe('interactive challenges yield their flag via the intended path', () => {
  let server;
  const PORT = 4319;
  const BASE = `http://127.0.0.1:${PORT}`;
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kfc-test-'));

  before(async () => {
    server = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT), KFC_DATA_DIR: DATA, SESSION_SECRET: 'test-secret' },
      stdio: 'ignore',
    });
    // Poll /healthz until the server is ready (max ~10s).
    const deadline = Date.now() + 10_000;
    for (;;) {
      try {
        const r = await fetch(`${BASE}/healthz`);
        if (r.ok) break;
      } catch { /* not up yet */ }
      if (Date.now() > deadline) throw new Error('server did not start in time');
      await new Promise((res) => setTimeout(res, 200));
    }
  });

  after(() => {
    if (server) server.kill();
    fs.rmSync(DATA, { recursive: true, force: true });
  });

  const bodyIncludesFlag = async (url, slug, opts) => {
    const r = await fetch(BASE + url, opts);
    const text = await r.text();
    assert.ok(text.includes(bySlug[slug].flag), `${slug}: flag not returned from ${url}`);
  };

  test('coop-inspector: flag hidden in board HTML comment', () =>
    bodyIncludesFlag('/c/coop-inspector/board', 'coop-inspector'));

  test('cookie-coop: head_rooster cookie reveals flag', () =>
    bodyIncludesFlag('/c/cookie-coop/door', 'cookie-coop', { headers: { Cookie: 'role=head_rooster' } }));

  test('cookie-coop: ordinary hen does NOT see the flag', async () => {
    const r = await fetch(`${BASE}/c/cookie-coop/door`, { headers: { Cookie: 'role=hen' } });
    const text = await r.text();
    assert.ok(!text.includes(bySlug['cookie-coop'].flag), 'flag leaked to non-admin');
  });

  test('robots-roost: robots.txt disallows the secret nest, which holds the flag', async () => {
    const robots = await (await fetch(`${BASE}/robots.txt`)).text();
    assert.ok(robots.includes('/c/robots-roost/secret-nest'), 'robots.txt missing disallow');
    await bodyIncludesFlag('/c/robots-roost/secret-nest', 'robots-roost');
  });

  test('header-hen: flag delivered in a response header', async () => {
    const r = await fetch(`${BASE}/c/header-hen/desk`);
    assert.strictEqual(r.headers.get('x-chicken-flag'), bySlug['header-hen'].flag);
  });

  test('invisible-ink: zero-width chars decode to the flag', async () => {
    const html = await (await fetch(`${BASE}/c/invisible-ink/notice`)).text();
    const bits = [...html].filter((ch) => ch === '\u200B' || ch === '\u200C')
      .map((ch) => (ch === '\u200C' ? '1' : '0')).join('');
    let out = '';
    for (let i = 0; i + 8 <= bits.length; i += 8) out += String.fromCharCode(parseInt(bits.slice(i, i + 8), 2));
    assert.strictEqual(out, bySlug['invisible-ink'].flag);
  });

  test('egg-vault: path traversal reaches the master key', () =>
    bodyIncludesFlag('/c/egg-vault/read?file=../vault/master.key', 'egg-vault'));

  test('egg-vault: traversal is sandboxed (cannot read real files)', async () => {
    const r = await fetch(`${BASE}/c/egg-vault/read?file=../../../../etc/passwd`);
    const text = await r.text();
    assert.ok(!text.includes('root:'), 'real filesystem was exposed');
  });

  test('coop-records: IDOR exposes the head-rooster record', () =>
    bodyIncludesFlag('/c/coop-records/note?id=1000', 'coop-records'));

  test('fowl-play-shop: negative-quantity cart yields the golden egg', () => {
    const cart = encodeURIComponent(JSON.stringify([
      { item: 'golden-egg', qty: 1 },
      { item: 'feed', qty: -1000 },
    ]));
    return bodyIncludesFlag(`/c/fowl-play-shop/checkout?cart=${cart}`, 'fowl-play-shop');
  });

  test('token-of-trust: alg:none forgery bypasses auth', () => {
    const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const forged = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ user: 'x', role: 'admin' })}.`;
    return bodyIncludesFlag(`/c/token-of-trust/api?token=${forged}`, 'token-of-trust');
  });
});
