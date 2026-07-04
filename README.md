# KFC — Keep Finding Chickens

A neighbourhood Capture-The-Flag (CTF) web application where players solve challenges to find hidden flags. Inspired by the alarming number of chickens taking up residence in the neighbourhood.

## Overview

KFC is a self-hosted CTF platform built with Node.js and Express. Players register, solve challenges across multiple categories (web, crypto, OSINT), and compete on a scoreboard. All flags follow the format `CHICKEN{...}`.

### Features

- User registration and authentication (bcrypt-hashed passwords)
- Multiple challenge categories: **web**, **crypto**, **OSINT**
- Per-user solve tracking (no duplicate scoring)
- Live scoreboard ranked by points
- Session persistence via SQLite
- Auto-seeding of challenges on server boot

## Tech Stack

| Layer       | Technology                          |
| ----------- | ----------------------------------- |
| Runtime     | Node.js                             |
| Framework   | Express 4                           |
| Templating  | EJS                                 |
| Database    | SQLite (via better-sqlite3)         |
| Sessions    | express-session + connect-sqlite3   |
| Auth        | bcrypt                              |

## Getting Started

### Prerequisites

- **Node.js** v18 or later
- **npm** (comes with Node.js)

### Installation

```bash
# Clone the repository
git clone https://github.com/aq1608/KFC.git
cd KFC

# Install dependencies
npm install
```

### Running the Server

```bash
# Production
npm start

# Development (auto-restart on file changes)
npm run dev
```

The server starts on **http://localhost:3000** by default. Set the `PORT` environment variable to use a different port.

### Environment Variables

| Variable         | Description                        | Default                          |
| ---------------- | ---------------------------------- | -------------------------------- |
| `PORT`           | Port the server listens on         | `3000`                           |
| `SESSION_SECRET` | Secret used to sign session cookies | `cluck-cluck-change-me-in-prod` |

> **Important:** Always set a strong `SESSION_SECRET` in production.

## Project Structure

```
KFC/
├── server.js              # Express app & routes
├── db.js                  # SQLite schema & helpers
├── challenges.seed.js     # Challenge definitions (flags live here)
├── package.json
├── public/
│   ├── style.css          # Global stylesheet
│   └── challenges/        # Static assets for challenges
│       └── find-the-hen/
│           └── photo.svg
└── views/
    ├── index.ejs          # Home page
    ├── register.ejs       # Registration form
    ├── login.ejs          # Login form
    ├── challenges.ejs     # Challenge listing
    ├── challenge.ejs      # Single challenge view
    ├── scoreboard.ejs     # Scoreboard
    ├── 404.ejs            # Not-found page
    ├── partials/
    │   ├── header.ejs
    │   └── footer.ejs
    └── challenge-pages/   # Custom pages for specific challenges
        └── coop-inspector-board.ejs
```

## How to Play

1. **Sign up** — pick a username (3-24 characters, no email required).
2. **Browse challenges** — each one has a description and point value.
3. **Solve it** — use your browser tools, decode ciphers, or investigate images.
4. **Submit the flag** — flags always look like `CHICKEN{something_like_this}`.
5. **Climb the scoreboard** — earn points for each unique solve.

## Adding New Challenges

To add a challenge, append an entry to `challenges.seed.js`:

```js
{
  slug: 'your-challenge-slug',
  title: 'Challenge Title',
  category: 'web',        // web | crypto | osint | misc
  points: 100,
  description: `HTML description shown to the player.`,
  flag: 'CHICKEN{your_flag_here}',
  asset_path: null,        // optional: path to a static asset
}
```

The server re-seeds (upserts) challenges on every boot, so changes take effect on restart.

## Security Notes

- Flags are stored server-side only — never expose them in client-visible files or responses.
- Passwords are hashed with bcrypt (cost factor 12).
- Sessions use `httpOnly` and `sameSite: lax` cookies.
- The `.gitignore` excludes the `data/` directory (databases) and `.env` files.

## License

This project is licensed under the [MIT License](LICENSE).
