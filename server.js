const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcrypt');

const { db, seedChallenges } = require('./db');
const challengeSeed = require('./challenges.seed');
const { dynamicValue } = require('./scoring');
const { difficultyFor } = require('./difficulty');

seedChallenges(challengeSeed);

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
  store: new SQLiteStore({ db: 'sessions.db', dir: process.env.KFC_DATA_DIR || path.join(__dirname, 'data') }),
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

// ---------- Prepared statements ----------
const stmts = {
  userByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
  userById: db.prepare('SELECT id, username FROM users WHERE id = ?'),
  createUser: db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)'),

  allChallenges: db.prepare(`
    SELECT id, slug, title, category, points
    FROM challenges
    ORDER BY category, points, id
  `),
  challengeBySlug: db.prepare('SELECT * FROM challenges WHERE slug = ?'),
  solveExists: db.prepare('SELECT 1 FROM solves WHERE user_id = ? AND challenge_id = ?'),
  insertSolve: db.prepare('INSERT OR IGNORE INTO solves (user_id, challenge_id) VALUES (?, ?)'),
  solvedIdsForUser: db.prepare('SELECT challenge_id FROM solves WHERE user_id = ?'),

  // ----- Raw data for JS-computed standings (dynamic scoring) -----
  allUsers: db.prepare('SELECT id, username FROM users'),
  allSolves: db.prepare('SELECT user_id, challenge_id, solved_at FROM solves'),
  challengePoints: db.prepare('SELECT id, points FROM challenges'),
  hintSpendByUser: db.prepare(`
    SELECT hu.user_id AS uid, COALESCE(SUM(h.cost), 0) AS spent
    FROM hint_unlocks hu
    JOIN hints h ON h.id = hu.hint_id
    GROUP BY hu.user_id
  `),

  // Solve count per challenge.
  solveCounts: db.prepare(`
    SELECT challenge_id, COUNT(*) AS n
    FROM solves
    GROUP BY challenge_id
  `),
  solveCountForChallenge: db.prepare('SELECT COUNT(*) AS n FROM solves WHERE challenge_id = ?'),

  // First blood per challenge. SQLite's MIN() aggregate returns the row that
  // owns the minimum, so u.username is the earliest solver for each challenge.
  firstBloods: db.prepare(`
    SELECT s.challenge_id,
           u.username AS fb_user,
           MIN(s.solved_at) AS fb_at
    FROM solves s
    JOIN users u ON u.id = s.user_id
    GROUP BY s.challenge_id
  `),

  // Public profile lookup (no password hash).
  publicUserByUsername: db.prepare(
    'SELECT id, username, created_at FROM users WHERE username = ?'
  ),

  // A user's solves, newest first, with challenge details (incl. id for value lookup).
  solvesForUser: db.prepare(`
    SELECT c.id AS challenge_id, c.slug, c.title, c.category, c.points, s.solved_at
    FROM solves s
    JOIN challenges c ON c.id = s.challenge_id
    WHERE s.user_id = ?
    ORDER BY s.solved_at DESC, c.points DESC
  `),

  // Total hint points a user has spent.
  hintsSpentForUser: db.prepare(`
    SELECT COALESCE(SUM(h.cost), 0) AS spent
    FROM hint_unlocks hu
    JOIN hints h ON h.id = hu.hint_id
    WHERE hu.user_id = ?
  `),

  // ----- Hints -----
  hintsForChallenge: db.prepare(
    'SELECT id, idx, body, cost FROM hints WHERE challenge_id = ? ORDER BY idx'
  ),
  hintByChallengeAndIdx: db.prepare(
    'SELECT * FROM hints WHERE challenge_id = ? AND idx = ?'
  ),
  unlockedHintIdsForUser: db.prepare(
    'SELECT hint_id FROM hint_unlocks WHERE user_id = ?'
  ),
  unlockHint: db.prepare(
    'INSERT OR IGNORE INTO hint_unlocks (user_id, hint_id) VALUES (?, ?)'
  ),

  // ----- Prerequisites (unlock gating) -----
  allPrereqs: db.prepare('SELECT challenge_id, requires_id FROM challenge_prereqs'),
  prereqsForChallenge: db.prepare('SELECT requires_id FROM challenge_prereqs WHERE challenge_id = ?'),
  challengeStubById: db.prepare('SELECT id, slug, title FROM challenges WHERE id = ?'),

  // ----- Admin -----
  countUsers: db.prepare('SELECT COUNT(*) AS n FROM users'),
  countChallenges: db.prepare('SELECT COUNT(*) AS n FROM challenges'),
  countSolves: db.prepare('SELECT COUNT(*) AS n FROM solves'),
  countHintUnlocks: db.prepare('SELECT COUNT(*) AS n FROM hint_unlocks'),
  usersWithMeta: db.prepare('SELECT id, username, created_at FROM users'),
  userById: db.prepare('SELECT id, username FROM users WHERE id = ?'),
  recentSolves: db.prepare(`
    SELECT u.username, c.title, c.slug, s.solved_at
    FROM solves s
    JOIN users u      ON u.id = s.user_id
    JOIN challenges c ON c.id = s.challenge_id
    ORDER BY s.solved_at DESC, u.username ASC
    LIMIT 25
  `),
  deleteSolvesForUser: db.prepare('DELETE FROM solves WHERE user_id = ?'),
  deleteHintUnlocksForUser: db.prepare('DELETE FROM hint_unlocks WHERE user_id = ?'),
  deleteUserById: db.prepare('DELETE FROM users WHERE id = ?'),
};

// Map of { challenge_id -> [required challenge ids] }.
function prereqMap() {
  const m = new Map();
  for (const r of stmts.allPrereqs.all()) {
    if (!m.has(r.challenge_id)) m.set(r.challenge_id, []);
    m.get(r.challenge_id).push(r.requires_id);
  }
  return m;
}

// The set of challenge ids a user has solved.
function solvedIdSet(userId) {
  return new Set(stmts.solvedIdsForUser.all(userId).map((r) => r.challenge_id));
}

// A challenge is locked until every prerequisite has been solved.
function prereqsUnmet(challengeId, solved) {
  return stmts.prereqsForChallenge.all(challengeId).some((r) => !solved.has(r.requires_id));
}

// Build lookup maps of { challenge_id -> solve count } and { challenge_id -> first-blood username }.
function challengeStatMaps() {
  const counts = {};
  for (const r of stmts.solveCounts.all()) counts[r.challenge_id] = r.n;
  const firstBloods = {};
  for (const r of stmts.firstBloods.all()) firstBloods[r.challenge_id] = r.fb_user;
  return { counts, firstBloods };
}

// Compute the full standings using dynamic scoring. Each solved challenge is
// worth its *current* value (which decays with total solves), minus the points
// a player has spent unlocking hints. Returns sorted rows (with rank) plus the
// per-challenge current value map for reuse by callers.
function computeStandings() {
  const users = stmts.allUsers.all();
  const solves = stmts.allSolves.all();
  const pointsById = new Map(stmts.challengePoints.all().map((c) => [c.id, c.points]));

  const solveCount = new Map();
  for (const s of solves) solveCount.set(s.challenge_id, (solveCount.get(s.challenge_id) || 0) + 1);

  const valueById = new Map();
  for (const [cid, pts] of pointsById) valueById.set(cid, dynamicValue(pts, solveCount.get(cid) || 0));

  // First blood (earliest solver) per challenge.
  const firstBy = new Map();
  for (const s of solves) {
    const cur = firstBy.get(s.challenge_id);
    if (!cur || s.solved_at < cur.at || (s.solved_at === cur.at && s.user_id < cur.user_id)) {
      firstBy.set(s.challenge_id, { user_id: s.user_id, at: s.solved_at });
    }
  }
  const fbCount = new Map();
  for (const { user_id } of firstBy.values()) fbCount.set(user_id, (fbCount.get(user_id) || 0) + 1);

  const hintSpend = new Map();
  for (const r of stmts.hintSpendByUser.all()) hintSpend.set(r.uid, r.spent);

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

  return { rows, valueById, solveCount };
}

// ---------- Public pages ----------
app.get('/', (req, res) => {
  const totalChallenges = db.prepare('SELECT COUNT(*) AS n FROM challenges').get().n;
  const totalPlayers = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  res.render('index', { totalChallenges, totalPlayers });
});

// ---------- Auth ----------
app.get('/register', (req, res) => {
  if (req.session.user) return res.redirect('/challenges');
  res.render('register', { username: '' });
});

app.post('/register', async (req, res) => {
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

  const existing = stmts.userByUsername.get(username);
  if (existing) {
    flash(req, 'error', 'That username is already roosting here.');
    return res.status(409).render('register', { username });
  }

  const hash = await bcrypt.hash(password, 12);
  const result = stmts.createUser.run(username, hash);
  req.session.user = { id: result.lastInsertRowid, username };
  flash(req, 'success', `Welcome to the coop, ${username}!`);
  res.redirect('/challenges');
});

app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/challenges');
  res.render('login', { username: '' });
});

app.post('/login', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const user = stmts.userByUsername.get(username);
  const ok = user && await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    flash(req, 'error', 'Wrong username or password.');
    return res.status(401).render('login', { username });
  }
  req.session.user = { id: user.id, username: user.username };
  flash(req, 'success', `Welcome back, ${user.username}.`);
  res.redirect('/challenges');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ---------- Challenges ----------
app.get('/challenges', requireAuth, (req, res) => {
  const all = stmts.allChallenges.all();
  const solvedIds = new Set(
    stmts.solvedIdsForUser.all(req.session.user.id).map((r) => r.challenge_id)
  );
  const { counts, firstBloods } = challengeStatMaps();
  const pmap = prereqMap();
  const titleById = new Map(all.map((c) => [c.id, c.title]));
  const slugById = new Map(all.map((c) => [c.id, c.slug]));
  const byCategory = {};
  for (const c of all) {
    const solveCount = counts[c.id] || 0;
    const requires = (pmap.get(c.id) || []).map((rid) => ({
      title: titleById.get(rid),
      slug: slugById.get(rid),
      solved: solvedIds.has(rid),
    }));
    const locked = !solvedIds.has(c.id) && requires.some((r) => !r.solved);
    (byCategory[c.category] ||= []).push({
      ...c,
      solved: solvedIds.has(c.id),
      solveCount,
      firstBlood: firstBloods[c.id] || null,
      value: dynamicValue(c.points, solveCount),
      difficulty: difficultyFor(c.points),
      locked,
      requires,
    });
  }
  res.render('challenges', { byCategory });
});

app.get('/challenges/:slug', requireAuth, (req, res) => {
  const c = stmts.challengeBySlug.get(req.params.slug);
  if (!c) return res.status(404).render('404');
  const uid = req.session.user.id;
  const solved = !!stmts.solveExists.get(uid, c.id);
  const solveCount = stmts.solveCountForChallenge.get(c.id).n;
  const firstBlood = (stmts.firstBloods.all().find((r) => r.challenge_id === c.id) || {}).fb_user || null;
  const currentValue = dynamicValue(c.points, solveCount);
  const difficulty = difficultyFor(c.points);

  // Prerequisite gating: build the requirement list and lock state.
  const solved_ = solvedIdSet(uid);
  const requires = stmts.prereqsForChallenge.all(c.id).map((r) => {
    const rc = stmts.challengeStubById.get(r.requires_id);
    return { slug: rc.slug, title: rc.title, solved: solved_.has(r.requires_id) };
  });
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
  const unlockedIds = new Set(stmts.unlockedHintIdsForUser.all(uid).map((r) => r.hint_id));
  const hints = stmts.hintsForChallenge.all(c.id).map((h) => {
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
});

// Unlock a hint (costs points, which are subtracted from the user's score).
app.post('/challenges/:slug/hint/:idx', requireAuth, (req, res) => {
  const c = stmts.challengeBySlug.get(req.params.slug);
  if (!c) return res.status(404).render('404');
  if (prereqsUnmet(c.id, solvedIdSet(req.session.user.id))) {
    flash(req, 'error', "Solve this challenge's prerequisites first.");
    return res.redirect(`/challenges/${c.slug}`);
  }
  const idx = parseInt(req.params.idx, 10);
  const hint = Number.isInteger(idx) ? stmts.hintByChallengeAndIdx.get(c.id, idx) : null;
  if (!hint) {
    flash(req, 'error', 'That hint does not exist.');
    return res.redirect(`/challenges/${c.slug}`);
  }
  const info = stmts.unlockHint.run(req.session.user.id, hint.id);
  if (info.changes > 0) {
    flash(req, 'success', `Hint unlocked — ${hint.cost} point${hint.cost === 1 ? '' : 's'} deducted.`);
  } else {
    flash(req, 'success', 'You had already unlocked that hint.');
  }
  res.redirect(`/challenges/${c.slug}#hints`);
});

app.post('/challenges/:slug/submit', requireAuth, (req, res) => {
  const c = stmts.challengeBySlug.get(req.params.slug);
  if (!c) return res.status(404).render('404');

  // Server-side prerequisite enforcement (defence in depth beyond the hidden UI).
  if (prereqsUnmet(c.id, solvedIdSet(req.session.user.id))) {
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
    const info = stmts.insertSolve.run(req.session.user.id, c.id);
    if (info.changes > 0) {
      const earned = dynamicValue(c.points, stmts.solveCountForChallenge.get(c.id).n);
      flash(req, 'success', `Correct! +${earned} points. 🐔`);
    } else {
      flash(req, 'success', 'Correct — but you already had this one.');
    }
  } else {
    flash(req, 'error', 'That is not the flag. Keep looking.');
  }
  res.redirect(`/challenges/${c.slug}`);
});

// ---------- Static challenge sub-pages (served from views/challenge-pages) ----------
// Individual challenges can have their own page under /c/:slug/... rendered from a view.
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
app.get('/scoreboard', (req, res) => {
  const { rows } = computeStandings();
  res.render('scoreboard', { rows: rows.slice(0, 100) });
});

// ---------- Profiles ----------
// Convenience redirect to the logged-in user's own profile.
app.get('/me', requireAuth, (req, res) => {
  res.redirect(`/u/${encodeURIComponent(req.session.user.username)}`);
});

app.get('/u/:username', (req, res) => {
  const user = stmts.publicUserByUsername.get(req.params.username);
  if (!user) return res.status(404).render('404');

  const { rows, valueById } = computeStandings();
  const standing = rows.find((r) => r.id === user.id)
    || { score: 0, rank: rows.length + 1, first_bloods: 0 };

  // Solve list with each challenge's current (dynamic) value.
  const solves = stmts.solvesForUser.all(user.id).map((s) => ({
    ...s,
    value: valueById.get(s.challenge_id) ?? s.points,
  }));
  const hintsSpent = stmts.hintsSpentForUser.get(user.id).spent;
  const totalChallenges = db.prepare('SELECT COUNT(*) AS n FROM challenges').get().n;

  res.render('profile', {
    profile: user,
    solves,
    score: standing.score,
    rank: standing.rank,
    firstBloods: standing.first_bloods,
    hintsSpent,
    totalChallenges,
  });
});

// ---------- Admin (stats + moderation) ----------
app.get('/admin', requireAdmin, (req, res) => {
  const totals = {
    users: stmts.countUsers.get().n,
    challenges: stmts.countChallenges.get().n,
    solves: stmts.countSolves.get().n,
    hintUnlocks: stmts.countHintUnlocks.get().n,
  };

  const { rows, valueById, solveCount } = computeStandings();
  const firstBloods = {};
  for (const r of stmts.firstBloods.all()) firstBloods[r.challenge_id] = r.fb_user;

  // Per-challenge stats (no flags exposed).
  const challenges = stmts.allChallenges.all()
    .map((c) => ({
      slug: c.slug,
      title: c.title,
      category: c.category,
      points: c.points,
      value: valueById.get(c.id) ?? c.points,
      solveCount: solveCount.get(c.id) || 0,
      firstBlood: firstBloods[c.id] || null,
      solveRate: totals.users ? Math.round(((solveCount.get(c.id) || 0) / totals.users) * 100) : 0,
    }))
    .sort((a, b) => b.solveCount - a.solveCount || a.title.localeCompare(b.title));

  // Enrich standings rows with join date and admin flag.
  const meta = new Map(stmts.usersWithMeta.all().map((u) => [u.id, u]));
  const hintSpend = new Map();
  for (const r of stmts.hintSpendByUser.all()) hintSpend.set(r.uid, r.spent);
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
    recent: stmts.recentSolves.all(),
  });
});

// Reset a player's progress (clears their solves and unlocked hints).
app.post('/admin/users/:id/reset', requireAdmin, (req, res) => {
  const target = stmts.userById.get(parseInt(req.params.id, 10));
  if (!target) {
    flash(req, 'error', 'No such user.');
    return res.redirect('/admin');
  }
  const tx = db.transaction((uid) => {
    stmts.deleteHintUnlocksForUser.run(uid);
    stmts.deleteSolvesForUser.run(uid);
  });
  tx(target.id);
  flash(req, 'success', `Reset progress for ${target.username}.`);
  res.redirect('/admin');
});

// Delete a player account (cascades to solves and hint unlocks).
app.post('/admin/users/:id/delete', requireAdmin, (req, res) => {
  const target = stmts.userById.get(parseInt(req.params.id, 10));
  if (!target) {
    flash(req, 'error', 'No such user.');
    return res.redirect('/admin');
  }
  if (isAdmin(target.username)) {
    flash(req, 'error', 'Admin accounts cannot be deleted from here.');
    return res.redirect('/admin');
  }
  stmts.deleteUserById.run(target.id);
  flash(req, 'success', `Deleted user ${target.username}.`);
  res.redirect('/admin');
});

// ---------- Health check (used by Docker / load balancers) ----------
app.get('/healthz', (req, res) => {
  try {
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM challenges').get();
    res.json({ status: 'ok', challenges: n, uptime: Math.round(process.uptime()) });
  } catch (err) {
    res.status(503).json({ status: 'error', error: err.message });
  }
});

// ---------- 404 ----------
app.use((req, res) => res.status(404).render('404'));

app.listen(PORT, () => {
  console.log(`🐔  KFC is running at http://localhost:${PORT}`);
});
