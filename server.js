const path = require('path');
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
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: path.join(__dirname, 'data') }),
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

  scoreboard: db.prepare(`
    SELECT u.id, u.username,
           COALESCE(SUM(c.points), 0) AS score,
           COUNT(s.challenge_id)      AS solved_count,
           COALESCE(MAX(s.solved_at), 0) AS last_solve
    FROM users u
    LEFT JOIN solves s     ON s.user_id = u.id
    LEFT JOIN challenges c ON c.id = s.challenge_id
    GROUP BY u.id
    ORDER BY score DESC, last_solve ASC, u.username ASC
    LIMIT 100
  `),
};

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
  const byCategory = {};
  for (const c of all) {
    (byCategory[c.category] ||= []).push({ ...c, solved: solvedIds.has(c.id) });
  }
  res.render('challenges', { byCategory });
});

app.get('/challenges/:slug', requireAuth, (req, res) => {
  const c = stmts.challengeBySlug.get(req.params.slug);
  if (!c) return res.status(404).render('404');
  const solved = !!stmts.solveExists.get(req.session.user.id, c.id);
  res.render('challenge', {
    challenge: { id: c.id, slug: c.slug, title: c.title, category: c.category, points: c.points, description: c.description },
    solved,
  });
});

app.post('/challenges/:slug/submit', requireAuth, (req, res) => {
  const c = stmts.challengeBySlug.get(req.params.slug);
  if (!c) return res.status(404).render('404');

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

// ---------- Scoreboard ----------
app.get('/scoreboard', (req, res) => {
  const rows = stmts.scoreboard.all();
  res.render('scoreboard', { rows });
});

// ---------- 404 ----------
app.use((req, res) => res.status(404).render('404'));

app.listen(PORT, () => {
  console.log(`🐔  KFC is running at http://localhost:${PORT}`);
});
