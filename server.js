const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');

const store = require('./store');
const challengeSeed = require('./challenges.seed');
const { dynamicValue } = require('./scoring');
const { difficultyFor } = require('./difficulty');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: false }));
// redirect:false stops serve-static from 301-redirecting `/challenges` to
// `/challenges/` just because a public/challenges/ asset directory exists —
// that route is handled by the app below. Static files still serve normally.
app.use(express.static(path.join(__dirname, 'public'), { redirect: false }));

app.use(session({
  store: store.makeSessionStore(session),
  secret: process.env.SESSION_SECRET || 'cluck-cluck-change-me-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 14,
  },
}));

// Admins are configured out-of-band via the ADMIN_USERS env var (comma-separated
// usernames). Empty by default, so the admin area is locked down unless opted in.
const ADMIN_USERS = new Set(
  String(process.env.ADMIN_USERS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);
function isAdmin(username) {
  return ADMIN_USERS.has(String(username || '').toLowerCase());
}

// Expose useful bits to every template.
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.isAdmin = req.session.user ? isAdmin(req.session.user.username) : false;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

function flash(req, type, message) {
  req.session.flash = { type, message };
}

// Wrap an async route so rejected promises reach the Express error handler.
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Minimal cookie parser (avoids pulling in an extra dependency).
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  }
  return out;
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    flash(req, 'error', 'You need to log in first.');
    return res.redirect('/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user) {
    flash(req, 'error', 'You need to log in first.');
    return res.redirect('/login');
  }
  if (!isAdmin(req.session.user.username)) {
    // Don't advertise the admin area to non-admins.
    return res.status(404).render('404');
  }
  next();
}

// ---------- Flag-submission rate limiting (anti-brute-force) ----------
// Simple in-memory sliding window, keyed by user id. Submissions require auth,
// so per-user is sufficient and avoids penalising users behind shared NAT.
const FLAG_RATE_MAX = Number(process.env.FLAG_RATE_MAX) || 15;
const FLAG_RATE_WINDOW_MS = Number(process.env.FLAG_RATE_WINDOW_MS) || 60_000;
const submitLog = new Map(); // userId -> number[] of recent submit timestamps

function allowFlagSubmission(userId) {
  const now = Date.now();
  const recent = (submitLog.get(userId) || []).filter((t) => now - t < FLAG_RATE_WINDOW_MS);
  if (recent.length >= FLAG_RATE_MAX) {
    submitLog.set(userId, recent);
    return false;
  }
  recent.push(now);
  submitLog.set(userId, recent);
  return true;
}

// ---------- Shared data helpers (backend-agnostic) ----------

// The set of challenge ids a user has solved.
async function solvedIdSet(userId) {
  return new Set((await store.solvedIdsForUser(userId)).map((r) => r.challenge_id));
}

// Map of { challenge_id -> [required challenge ids] }.
async function prereqMap() {
  const m = new Map();
  for (const r of await store.allPrereqs()) {
    if (!m.has(r.challenge_id)) m.set(r.challenge_id, []);
    m.get(r.challenge_id).push(r.requires_id);
  }
  return m;
}

// A challenge is locked until every prerequisite has been solved.
async function prereqsUnmet(challengeId, solved) {
  const reqs = await store.prereqsForChallenge(challengeId);
  return reqs.some((r) => !solved.has(r.requires_id));
}

// Compute the full standings using dynamic scoring. Each solved challenge is
// worth its *current* value (which decays with total solves), minus the points
// a player has spent unlocking hints. First blood is derived in JS so the logic
// is identical across SQLite and Postgres. Returns sorted, ranked rows plus
// per-challenge maps for reuse by callers.
async function computeStandings() {
  const [users, solves, points, hintSpendRows] = await Promise.all([
    store.usersBasic(),
    store.allSolves(),
    store.challengePoints(),
    store.hintSpendByUser(),
  ]);

  const pointsById = new Map(points.map((c) => [c.id, c.points]));
  const nameById = new Map(users.map((u) => [u.id, u.username]));

  const solveCount = new Map();
  for (const s of solves) solveCount.set(s.challenge_id, (solveCount.get(s.challenge_id) || 0) + 1);

  const valueById = new Map();
  for (const [cid, pts] of pointsById) valueById.set(cid, dynamicValue(pts, solveCount.get(cid) || 0));

  // Earliest solver per challenge.
  const firstBy = new Map();
  for (const s of solves) {
    const cur = firstBy.get(s.challenge_id);
    if (!cur || s.solved_at < cur.at || (s.solved_at === cur.at && s.user_id < cur.user_id)) {
      firstBy.set(s.challenge_id, { user_id: s.user_id, at: s.solved_at });
    }
  }
  const firstBloodByChallenge = new Map();
  const fbCount = new Map();
  for (const [cid, fb] of firstBy) {
    firstBloodByChallenge.set(cid, nameById.get(fb.user_id) || null);
    fbCount.set(fb.user_id, (fbCount.get(fb.user_id) || 0) + 1);
  }

  const hintSpend = new Map();
  for (const r of hintSpendRows) hintSpend.set(r.uid, r.spent);

  const solvesByUser = new Map();
  for (const s of solves) {
    if (!solvesByUser.has(s.user_id)) solvesByUser.set(s.user_id, []);
    solvesByUser.get(s.user_id).push(s);
  }

  const rows = users.map((u) => {
    const mine = solvesByUser.get(u.id) || [];
    let score = 0;
    let last = 0;
    for (const s of mine) {
      score += valueById.get(s.challenge_id) || 0;
      if (s.solved_at > last) last = s.solved_at;
    }
    score -= hintSpend.get(u.id) || 0;
    return {
      id: u.id,
      username: u.username,
      score,
      solved_count: mine.length,
      last_solve: last,
      first_bloods: fbCount.get(u.id) || 0,
    };
  });

  rows.sort((a, b) =>
    b.score - a.score ||
    a.last_solve - b.last_solve ||
    a.username.localeCompare(b.username)
  );
  rows.forEach((r, i) => { r.rank = i + 1; });

  return { rows, valueById, solveCount, firstBloodByChallenge };
}

// ---------- Public pages ----------
app.get('/', ah(async (req, res) => {
  const [totalChallenges, totalPlayers] = await Promise.all([
    store.countChallenges(),
    store.countUsers(),
  ]);
  res.render('index', { totalChallenges, totalPlayers });
}));

// ---------- Auth ----------
app.get('/register', (req, res) => {
  if (req.session.user) return res.redirect('/challenges');
  res.render('register', { username: '' });
});

app.post('/register', ah(async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  if (!/^[a-zA-Z0-9_-]{3,24}$/.test(username)) {
    flash(req, 'error', 'Username must be 3–24 chars: letters, numbers, _ or -.');
    return res.status(400).render('register', { username });
  }
  if (password.length < 6) {
    flash(req, 'error', 'Password must be at least 6 characters.');
    return res.status(400).render('register', { username });
  }

  const existing = await store.getUserByUsername(username);
  if (existing) {
    flash(req, 'error', 'That username is already roosting here.');
    return res.status(409).render('register', { username });
  }

  const hash = await bcrypt.hash(password, 12);
  const { id } = await store.createUser(username, hash);
  req.session.user = { id, username };
  flash(req, 'success', `Welcome to the coop, ${username}!`);
  res.redirect('/challenges');
}));

app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/challenges');
  res.render('login', { username: '' });
});

app.post('/login', ah(async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const user = await store.getUserByUsername(username);
  const ok = user && await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    flash(req, 'error', 'Wrong username or password.');
    return res.status(401).render('login', { username });
  }
  req.session.user = { id: user.id, username: user.username };
  flash(req, 'success', `Welcome back, ${user.username}.`);
  res.redirect('/challenges');
}));

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ---------- Challenges ----------
app.get('/challenges', requireAuth, ah(async (req, res) => {
  const all = await store.allChallenges();
  const solvedIds = await solvedIdSet(req.session.user.id);
  const { valueById, solveCount, firstBloodByChallenge } = await computeStandings();
  const pmap = await prereqMap();
  const titleById = new Map(all.map((c) => [c.id, c.title]));
  const slugById = new Map(all.map((c) => [c.id, c.slug]));
  const byCategory = {};
  for (const c of all) {
    const sc = solveCount.get(c.id) || 0;
    const requires = (pmap.get(c.id) || []).map((rid) => ({
      title: titleById.get(rid),
      slug: slugById.get(rid),
      solved: solvedIds.has(rid),
    }));
    const locked = !solvedIds.has(c.id) && requires.some((r) => !r.solved);
    (byCategory[c.category] ||= []).push({
      ...c,
      solved: solvedIds.has(c.id),
      solveCount: sc,
      firstBlood: firstBloodByChallenge.get(c.id) || null,
      value: valueById.get(c.id) ?? dynamicValue(c.points, sc),
      difficulty: difficultyFor(c.points),
      locked,
      requires,
    });
  }
  res.render('challenges', { byCategory });
}));

app.get('/challenges/:slug', requireAuth, ah(async (req, res) => {
  const c = await store.challengeBySlug(req.params.slug);
  if (!c) return res.status(404).render('404');
  const uid = req.session.user.id;
  const solved = await store.solveExists(uid, c.id);
  const { valueById, solveCount: scMap, firstBloodByChallenge } = await computeStandings();
  const solveCount = scMap.get(c.id) || 0;
  const currentValue = valueById.get(c.id) ?? dynamicValue(c.points, solveCount);
  const firstBlood = firstBloodByChallenge.get(c.id) || null;
  const difficulty = difficultyFor(c.points);

  // Prerequisite gating: build the requirement list and lock state.
  const solved_ = await solvedIdSet(uid);
  const prereqRows = await store.prereqsForChallenge(c.id);
  const requires = [];
  for (const r of prereqRows) {
    const rc = await store.challengeStubById(r.requires_id);
    requires.push({ slug: rc.slug, title: rc.title, solved: solved_.has(r.requires_id) });
  }
  const locked = !solved && requires.some((r) => !r.solved);

  // For locked challenges, do NOT send the description, hints, or writeup —
  // the puzzle stays hidden until prerequisites are met.
  if (locked) {
    return res.status(423).render('challenge', {
      challenge: { id: c.id, slug: c.slug, title: c.title, category: c.category, points: c.points, description: null },
      solved: false,
      solveCount,
      firstBlood,
      currentValue,
      difficulty,
      hints: [],
      locked: true,
      requires,
      writeup: null,
    });
  }

  // Only send hint bodies for hints this user has already unlocked; locked
  // hint text never reaches the client.
  const unlockedIds = new Set((await store.unlockedHintIdsForUser(uid)).map((r) => r.hint_id));
  const hints = (await store.hintsForChallenge(c.id)).map((h) => {
    const unlocked = unlockedIds.has(h.id);
    return { idx: h.idx, cost: h.cost, unlocked, body: unlocked ? h.body : null };
  });

  res.render('challenge', {
    challenge: { id: c.id, slug: c.slug, title: c.title, category: c.category, points: c.points, description: c.description },
    solved,
    solveCount,
    firstBlood,
    currentValue,
    difficulty,
    hints,
    locked: false,
    requires,
    // The writeup is only revealed after the user has solved the challenge.
    writeup: solved ? (c.writeup || null) : null,
  });
}));

// Unlock a hint (costs points, which are subtracted from the user's score).
app.post('/challenges/:slug/hint/:idx', requireAuth, ah(async (req, res) => {
  const c = await store.challengeBySlug(req.params.slug);
  if (!c) return res.status(404).render('404');
  if (await prereqsUnmet(c.id, await solvedIdSet(req.session.user.id))) {
    flash(req, 'error', "Solve this challenge's prerequisites first.");
    return res.redirect(`/challenges/${c.slug}`);
  }
  const idx = parseInt(req.params.idx, 10);
  const hint = Number.isInteger(idx) ? await store.hintByChallengeAndIdx(c.id, idx) : null;
  if (!hint) {
    flash(req, 'error', 'That hint does not exist.');
    return res.redirect(`/challenges/${c.slug}`);
  }
  const { inserted } = await store.unlockHint(req.session.user.id, hint.id);
  if (inserted) {
    flash(req, 'success', `Hint unlocked — ${hint.cost} point${hint.cost === 1 ? '' : 's'} deducted.`);
  } else {
    flash(req, 'success', 'You had already unlocked that hint.');
  }
  res.redirect(`/challenges/${c.slug}#hints`);
}));

app.post('/challenges/:slug/submit', requireAuth, ah(async (req, res) => {
  const c = await store.challengeBySlug(req.params.slug);
  if (!c) return res.status(404).render('404');

  // Server-side prerequisite enforcement (defence in depth beyond the hidden UI).
  if (await prereqsUnmet(c.id, await solvedIdSet(req.session.user.id))) {
    flash(req, 'error', 'You must solve the prerequisites before attempting this challenge.');
    return res.redirect(`/challenges/${c.slug}`);
  }

  if (!allowFlagSubmission(req.session.user.id)) {
    flash(req, 'error', 'Whoa there — too many flag attempts. Take a breather and try again in a moment.');
    return res.redirect(`/challenges/${c.slug}`);
  }

  const submitted = String(req.body.flag || '').trim();
  const correct = submitted === c.flag;

  if (correct) {
    const { inserted } = await store.insertSolve(req.session.user.id, c.id);
    if (inserted) {
      const earned = dynamicValue(c.points, await store.solveCountForChallenge(c.id));
      flash(req, 'success', `Correct! +${earned} points. 🐔`);
    } else {
      flash(req, 'success', 'Correct — but you already had this one.');
    }
  } else {
    flash(req, 'error', 'That is not the flag. Keep looking.');
  }
  res.redirect(`/challenges/${c.slug}`);
}));

// ---------- Static challenge sub-pages (served from views/challenge-pages) ----------
// These are pure/in-memory and touch no database.
app.get('/c/coop-inspector/board', (req, res) => {
  res.render('challenge-pages/coop-inspector-board');
});

// Cookie Coop: hand out a plain "role=hen" cookie; only "head_rooster" sees the flag.
app.get('/c/cookie-coop/door', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const role = cookies.role;
  if (!role) {
    // First visit: stamp them as an ordinary hen.
    res.cookie('role', 'hen', { httpOnly: false, sameSite: 'lax' });
  }
  res.render('challenge-pages/cookie-coop-door', { role: role || 'hen' });
});

// Robots Roost: the disallowed nest that /robots.txt points to.
app.get('/c/robots-roost/secret-nest', (req, res) => {
  res.render('challenge-pages/robots-roost-nest');
});

// Headers of the Henhouse: an ordinary-looking page with the flag in a response header.
app.get('/c/header-hen/desk', (req, res) => {
  res.set('X-Chicken-Flag', 'CHICKEN{peck_the_response_headers}');
  res.render('challenge-pages/header-hen-desk');
});

// Invisible Ink: a page whose sentence hides zero-width characters.
app.get('/c/invisible-ink/notice', (req, res) => {
  res.render('challenge-pages/invisible-ink-notice');
});

// The Egg Vault: a deliberately-vulnerable path-traversal demo.
// IMPORTANT: this reads from an in-memory virtual filesystem ONLY. It never
// touches the real disk, so the "traversal" is completely sandboxed and safe.
const EGG_VAULT_VFS = {
  'reading-room/welcome.txt':
    'Welcome to the Egg Vault public reading room.\n' +
    'Fetch notes with ?file=<name>. Try ?file=catalogue.txt.\n' +
    'The master key is NOT kept here — it lives one level up, in the vault.',
  'reading-room/catalogue.txt':
    'Reading-room catalogue:\n - welcome.txt\n - catalogue.txt\n' +
    '(Restricted material is stored outside this room.)',
  'vault/master.key':
    'EGG VAULT MASTER KEY\n====================\nCHICKEN{path_traversal_poultry}',
};

app.get('/c/egg-vault/read', (req, res) => {
  const requested = String(req.query.file || 'welcome.txt');
  // Naively join onto the reading-room base, then normalise — this is the "bug".
  const resolved = path.posix.normalize(path.posix.join('reading-room', requested));
  const content = EGG_VAULT_VFS[resolved];
  res.type('text/plain');
  if (content === undefined) {
    return res.status(404).send(`No such note: ${resolved}`);
  }
  res.send(`[${resolved}]\n\n${content}\n`);
});

// ---------- Pwn / Logic challenges ----------

// Coop Records: Insecure Direct Object Reference (no ownership check).
const COOP_RECORDS = {
  1000: { owner: 'head-rooster', text: 'CONFIDENTIAL — master roost key: CHICKEN{idor_the_head_rooster}' },
  1001: { owner: 'you',          text: 'Your welcome note. Curious what the other records hold? Try nearby IDs.' },
  1002: { owner: 'clucky',       text: "Clucky's grocery list: corn, grit, and more corn." },
  1003: { owner: 'peep',         text: 'Peep reminds everyone the water dish needs refilling.' },
};
app.get('/c/coop-records/note', (req, res) => {
  res.type('text/plain');
  const id = parseInt(req.query.id, 10);
  if (!Number.isInteger(id)) return res.status(400).send('Provide ?id=<number> (yours is 1001).');
  const rec = COOP_RECORDS[id];
  if (!rec) return res.status(404).send(`No record #${id}.`);
  res.send(`Record #${id} (owner: ${rec.owner})\n\n${rec.text}\n`);
});

// Fowl Play Shop: business-logic flaw — no check that quantities are positive.
const SHOP_PRICES = { 'golden-egg': 1000000, feed: 1000, straw: 50 };
const SHOP_WALLET = 100;
app.get('/c/fowl-play-shop/checkout', (req, res) => {
  res.type('text/plain');
  let cart;
  try {
    cart = JSON.parse(req.query.cart || '[]');
  } catch (e) {
    return res.status(400).send('Bad cart JSON. Example: ?cart=[{"item":"straw","qty":2}]');
  }
  if (!Array.isArray(cart)) return res.status(400).send('Cart must be a JSON array.');

  let total = 0;
  for (const line of cart) {
    const price = SHOP_PRICES[line && line.item];
    if (price === undefined) return res.status(400).send(`Unknown item: ${line && line.item}`);
    const qty = Number(line.qty);
    if (!Number.isFinite(qty)) return res.status(400).send('Each line needs a numeric qty.');
    total += price * qty; // BUG: quantities are never required to be positive
  }

  const hasGolden = cart.some((l) => l.item === 'golden-egg' && Number(l.qty) >= 1);
  if (total > SHOP_WALLET) {
    return res.send(`Total ${total} coins exceeds your wallet (${SHOP_WALLET}). Checkout declined.`);
  }
  if (!hasGolden) {
    return res.send(`Checkout OK — total ${total} coins. (But there's no Golden Egg in your cart.)`);
  }
  res.send(`Checkout complete! You walked out with the Golden Egg for ${total} coins.\n` +
           `Crack it open: CHICKEN{negative_qty_free_eggs}\n`);
});

// Token of Trust: JWT "alg:none" auth bypass.
const JWT_SECRET = process.env.TOT_SECRET || 'coop-signing-key-do-not-share';
function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToStr(seg) {
  return Buffer.from(seg.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}
function hs256(data, secret) {
  return b64url(crypto.createHmac('sha256', secret).update(data).digest());
}
function signJwt(payload, secret) {
  const h = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64url(JSON.stringify(payload));
  return `${h}.${p}.${hs256(`${h}.${p}`, secret)}`;
}
// Deliberately-flawed verifier: it honours "alg":"none" and skips the signature check.
function insecureVerifyJwt(token) {
  const parts = String(token).split('.');
  if (parts.length < 2) return null;
  let header, payload;
  try {
    header = JSON.parse(b64urlToStr(parts[0]));
    payload = JSON.parse(b64urlToStr(parts[1]));
  } catch (e) {
    return null;
  }
  if (header.alg === 'none') return payload; // BUG: unsigned tokens are trusted
  if (header.alg === 'HS256') {
    const expected = hs256(`${parts[0]}.${parts[1]}`, JWT_SECRET);
    const given = Buffer.from(parts[2] || '');
    const want = Buffer.from(expected);
    if (given.length === want.length && crypto.timingSafeEqual(given, want)) return payload;
  }
  return null;
}
app.get('/c/token-of-trust/portal', (req, res) => {
  const guestToken = signJwt({ user: 'guest', role: 'guest' }, JWT_SECRET);
  res.render('challenge-pages/token-of-trust-portal', { guestToken });
});
app.get('/c/token-of-trust/api', (req, res) => {
  res.type('text/plain');
  const auth = req.headers.authorization || '';
  const token = req.query.token || (auth.startsWith('Bearer ') ? auth.slice(7) : '');
  if (!token) return res.status(400).send('Send your token: ?token=... (get one from /c/token-of-trust/portal)');
  const payload = insecureVerifyJwt(token);
  if (!payload) return res.status(401).send('Invalid or unverifiable token.');
  if (payload.role === 'admin') {
    return res.send('Access granted, admin. The secret roost log reads: CHICKEN{alg_none_is_never_okay}');
  }
  res.send(`Hello, ${payload.user || 'guest'} (role: ${payload.role || 'none'}). Only admins may read the secret.`);
});

// ---------- Scoreboard ----------
app.get('/scoreboard', ah(async (req, res) => {
  const { rows } = await computeStandings();
  res.render('scoreboard', { rows: rows.slice(0, 100) });
}));

// ---------- Profiles ----------
// Convenience redirect to the logged-in user's own profile.
app.get('/me', requireAuth, (req, res) => {
  res.redirect(`/u/${encodeURIComponent(req.session.user.username)}`);
});

app.get('/u/:username', ah(async (req, res) => {
  const user = await store.getPublicUserByUsername(req.params.username);
  if (!user) return res.status(404).render('404');

  const { rows, valueById } = await computeStandings();
  const standing = rows.find((r) => r.id === user.id)
    || { score: 0, rank: rows.length + 1, first_bloods: 0 };

  // Solve list with each challenge's current (dynamic) value.
  const solves = (await store.solvesForUser(user.id)).map((s) => ({
    ...s,
    value: valueById.get(s.challenge_id) ?? s.points,
  }));
  const hintsSpent = await store.hintsSpentForUser(user.id);
  const totalChallenges = await store.countChallenges();

  res.render('profile', {
    profile: user,
    solves,
    score: standing.score,
    rank: standing.rank,
    firstBloods: standing.first_bloods,
    hintsSpent,
    totalChallenges,
  });
}));

// ---------- Admin (stats + moderation) ----------
app.get('/admin', requireAdmin, ah(async (req, res) => {
  const [uCount, cCount, sCount, hCount] = await Promise.all([
    store.countUsers(), store.countChallenges(), store.countSolves(), store.countHintUnlocks(),
  ]);
  const totals = { users: uCount, challenges: cCount, solves: sCount, hintUnlocks: hCount };

  const { rows, valueById, solveCount, firstBloodByChallenge } = await computeStandings();

  // Per-challenge stats (no flags exposed).
  const challenges = (await store.allChallenges())
    .map((c) => ({
      slug: c.slug,
      title: c.title,
      category: c.category,
      points: c.points,
      value: valueById.get(c.id) ?? c.points,
      solveCount: solveCount.get(c.id) || 0,
      firstBlood: firstBloodByChallenge.get(c.id) || null,
      solveRate: totals.users ? Math.round(((solveCount.get(c.id) || 0) / totals.users) * 100) : 0,
    }))
    .sort((a, b) => b.solveCount - a.solveCount || a.title.localeCompare(b.title));

  // Enrich standings rows with join date and admin flag.
  const meta = new Map((await store.usersWithMeta()).map((u) => [u.id, u]));
  const hintSpend = new Map();
  for (const r of await store.hintSpendByUser()) hintSpend.set(r.uid, r.spent);
  const users = rows.map((r) => ({
    ...r,
    created_at: (meta.get(r.id) || {}).created_at || 0,
    hint_spend: hintSpend.get(r.id) || 0,
    is_admin: isAdmin(r.username),
  }));

  res.render('admin', {
    totals,
    challenges,
    users,
    recent: await store.recentSolves(25),
  });
}));

// Reset a player's progress (clears their solves and unlocked hints).
app.post('/admin/users/:id/reset', requireAdmin, ah(async (req, res) => {
  const target = await store.getUserById(parseInt(req.params.id, 10));
  if (!target) {
    flash(req, 'error', 'No such user.');
    return res.redirect('/admin');
  }
  await store.resetUserProgress(target.id);
  flash(req, 'success', `Reset progress for ${target.username}.`);
  res.redirect('/admin');
}));

// Delete a player account (cascades to solves and hint unlocks).
app.post('/admin/users/:id/delete', requireAdmin, ah(async (req, res) => {
  const target = await store.getUserById(parseInt(req.params.id, 10));
  if (!target) {
    flash(req, 'error', 'No such user.');
    return res.redirect('/admin');
  }
  if (isAdmin(target.username)) {
    flash(req, 'error', 'Admin accounts cannot be deleted from here.');
    return res.redirect('/admin');
  }
  await store.deleteUser(target.id);
  flash(req, 'success', `Deleted user ${target.username}.`);
  res.redirect('/admin');
}));

// ---------- Health check (used by Docker / load balancers) ----------
app.get('/healthz', ah(async (req, res) => {
  try {
    const n = await store.countChallenges();
    res.json({ status: 'ok', backend: store.kind, challenges: n, uptime: Math.round(process.uptime()) });
  } catch (err) {
    res.status(503).json({ status: 'error', error: err.message });
  }
}));

// ---------- 404 + error handler ----------
app.use((req, res) => res.status(404).render('404'));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(500).send('Internal server error');
});

// Initialise the datastore (create schema + seed) before accepting traffic.
store.init(challengeSeed)
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🐔  KFC is running at http://localhost:${PORT}  [${store.kind}]`);
    });
  })
  .catch((err) => {
    console.error('Failed to start KFC:', err);
    process.exit(1);
  });
