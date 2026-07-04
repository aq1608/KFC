const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcrypt');

const { db, seedChallenges } = require('./db');
const challengeSeed = require('./challenges.seed');

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

// Expose useful bits to every template.
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
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

  // Net score = solved challenge points minus unlocked hint costs.
  scoreboard: db.prepare(`
    SELECT u.id, u.username,
           COALESCE((SELECT SUM(c.points) FROM solves s JOIN challenges c ON c.id = s.challenge_id WHERE s.user_id = u.id), 0)
             - COALESCE((SELECT SUM(h.cost) FROM hint_unlocks hu JOIN hints h ON h.id = hu.hint_id WHERE hu.user_id = u.id), 0) AS score,
           COALESCE((SELECT COUNT(*)      FROM solves s WHERE s.user_id = u.id), 0) AS solved_count,
           COALESCE((SELECT MAX(s.solved_at) FROM solves s WHERE s.user_id = u.id), 0) AS last_solve
    FROM users u
    ORDER BY score DESC, last_solve ASC, u.username ASC
    LIMIT 100
  `),

  // Solve count per challenge.
  solveCounts: db.prepare(`
    SELECT challenge_id, COUNT(*) AS n
    FROM solves
    GROUP BY challenge_id
  `),

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

  // First-blood count per user (how many challenges they solved first).
  firstBloodCounts: db.prepare(`
    SELECT user_id, COUNT(*) AS n FROM (
      SELECT challenge_id, user_id, MIN(solved_at) AS m
      FROM solves
      GROUP BY challenge_id
    )
    GROUP BY user_id
  `),

  // Public profile lookup (no password hash).
  publicUserByUsername: db.prepare(
    'SELECT id, username, created_at FROM users WHERE username = ?'
  ),

  // A user's solves, newest first, with challenge details.
  solvesForUser: db.prepare(`
    SELECT c.slug, c.title, c.category, c.points, s.solved_at
    FROM solves s
    JOIN challenges c ON c.id = s.challenge_id
    WHERE s.user_id = ?
    ORDER BY s.solved_at DESC, c.points DESC
  `),

  // A single user's net score (solved points minus unlocked hint costs).
  scoreForUser: db.prepare(`
    SELECT COALESCE((SELECT SUM(c.points) FROM solves s JOIN challenges c ON c.id = s.challenge_id WHERE s.user_id = @uid), 0)
         - COALESCE((SELECT SUM(h.cost) FROM hint_unlocks hu JOIN hints h ON h.id = hu.hint_id WHERE hu.user_id = @uid), 0) AS score
  `),

  // Total hint points a user has spent.
  hintsSpentForUser: db.prepare(`
    SELECT COALESCE(SUM(h.cost), 0) AS spent
    FROM hint_unlocks hu
    JOIN hints h ON h.id = hu.hint_id
    WHERE hu.user_id = ?
  `),

  // Rank = 1 + number of users with a strictly higher net score.
  rankForUser: db.prepare(`
    WITH scores AS (
      SELECT u.id AS uid,
             COALESCE((SELECT SUM(c.points) FROM solves s JOIN challenges c ON c.id = s.challenge_id WHERE s.user_id = u.id), 0)
               - COALESCE((SELECT SUM(h.cost) FROM hint_unlocks hu JOIN hints h ON h.id = hu.hint_id WHERE hu.user_id = u.id), 0) AS score
      FROM users u
    )
    SELECT (SELECT COUNT(*) FROM scores b WHERE b.score > a.score) + 1 AS rank
    FROM scores a
    WHERE a.uid = ?
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

  firstBloodCountForUser: db.prepare(`
    SELECT COUNT(*) AS n FROM (
      SELECT challenge_id, user_id, MIN(solved_at) AS m
      FROM solves
      GROUP BY challenge_id
    )
    WHERE user_id = ?
  `),
};

// Build lookup maps of { challenge_id -> solve count } and { challenge_id -> first-blood username }.
function challengeStatMaps() {
  const counts = {};
  for (const r of stmts.solveCounts.all()) counts[r.challenge_id] = r.n;
  const firstBloods = {};
  for (const r of stmts.firstBloods.all()) firstBloods[r.challenge_id] = r.fb_user;
  return { counts, firstBloods };
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
  const byCategory = {};
  for (const c of all) {
    (byCategory[c.category] ||= []).push({
      ...c,
      solved: solvedIds.has(c.id),
      solveCount: counts[c.id] || 0,
      firstBlood: firstBloods[c.id] || null,
    });
  }
  res.render('challenges', { byCategory });
});

app.get('/challenges/:slug', requireAuth, (req, res) => {
  const c = stmts.challengeBySlug.get(req.params.slug);
  if (!c) return res.status(404).render('404');
  const solved = !!stmts.solveExists.get(req.session.user.id, c.id);
  const solveCount = (stmts.solveCounts.all().find((r) => r.challenge_id === c.id) || {}).n || 0;
  const firstBlood = (stmts.firstBloods.all().find((r) => r.challenge_id === c.id) || {}).fb_user || null;

  // Only send hint bodies for hints this user has already unlocked; locked
  // hint text never reaches the client.
  const unlockedIds = new Set(stmts.unlockedHintIdsForUser.all(req.session.user.id).map((r) => r.hint_id));
  const hints = stmts.hintsForChallenge.all(c.id).map((h) => {
    const unlocked = unlockedIds.has(h.id);
    return { idx: h.idx, cost: h.cost, unlocked, body: unlocked ? h.body : null };
  });

  res.render('challenge', {
    challenge: { id: c.id, slug: c.slug, title: c.title, category: c.category, points: c.points, description: c.description },
    solved,
    solveCount,
    firstBlood,
    hints,
  });
});

// Unlock a hint (costs points, which are subtracted from the user's score).
app.post('/challenges/:slug/hint/:idx', requireAuth, (req, res) => {
  const c = stmts.challengeBySlug.get(req.params.slug);
  if (!c) return res.status(404).render('404');
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

  if (!allowFlagSubmission(req.session.user.id)) {
    flash(req, 'error', 'Whoa there — too many flag attempts. Take a breather and try again in a moment.');
    return res.redirect(`/challenges/${c.slug}`);
  }

  const submitted = String(req.body.flag || '').trim();
  const correct = submitted === c.flag;

  if (correct) {
    const info = stmts.insertSolve.run(req.session.user.id, c.id);
    if (info.changes > 0) {
      flash(req, 'success', `Correct! +${c.points} points. 🐔`);
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
  const rows = stmts.scoreboard.all();
  const fbCounts = {};
  for (const r of stmts.firstBloodCounts.all()) fbCounts[r.user_id] = r.n;
  const enriched = rows.map((r) => ({ ...r, first_bloods: fbCounts[r.id] || 0 }));
  res.render('scoreboard', { rows: enriched });
});

// ---------- Profiles ----------
// Convenience redirect to the logged-in user's own profile.
app.get('/me', requireAuth, (req, res) => {
  res.redirect(`/u/${encodeURIComponent(req.session.user.username)}`);
});

app.get('/u/:username', (req, res) => {
  const user = stmts.publicUserByUsername.get(req.params.username);
  if (!user) return res.status(404).render('404');

  const solves = stmts.solvesForUser.all(user.id);
  const score = stmts.scoreForUser.get({ uid: user.id }).score;
  const rank = stmts.rankForUser.get(user.id).rank;
  const firstBloods = stmts.firstBloodCountForUser.get(user.id).n;
  const hintsSpent = stmts.hintsSpentForUser.get(user.id).spent;
  const totalChallenges = db.prepare('SELECT COUNT(*) AS n FROM challenges').get().n;

  res.render('profile', {
    profile: user,
    solves,
    score,
    rank,
    firstBloods,
    hintsSpent,
    totalChallenges,
  });
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
