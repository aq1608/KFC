# KFC — Keep Finding Chickens

A neighbourhood Capture-The-Flag (CTF) web application where players solve challenges to find hidden flags. Inspired by the alarming number of chickens taking up residence in the neighbourhood.

## Overview

KFC is a self-hosted CTF platform built with Node.js and Express. Players register, pick challenges across eight categories, solve them, and compete on a live scoreboard. All flags follow the format `CHICKEN{...}`.

The platform currently ships with **20 challenges** worth **1,975 points**, ranging from beginner "View Source" puzzles to intermediate JWT `alg:none` auth bypasses.

### Features

- User registration and authentication (bcrypt-hashed passwords)
- Eight challenge categories: **Web**, **Pwn**, **Crypto**, **Reversing**, **Stego**, **Forensics**, **OSINT**, **Misc**
- Per-user solve tracking (no duplicate scoring)
- Live scoreboard ranked by points, then earliest last-solve
- Interactive challenges with their own server routes and pages
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

| Variable         | Description                                       | Default                           |
| ---------------- | ------------------------------------------------- | --------------------------------- |
| `PORT`           | Port the server listens on                        | `3000`                            |
| `SESSION_SECRET` | Secret used to sign session cookies               | `cluck-cluck-change-me-in-prod`   |
| `TOT_SECRET`     | HS256 signing key for the Token of Trust challenge | `coop-signing-key-do-not-share`   |

> **Important:** Always set a strong `SESSION_SECRET` in production.

## Challenge Catalogue

Flags are intentionally omitted here — they live server-side in `challenges.seed.js`.

### 🕸️ Web
| Challenge | Points | Skill tested |
| --------- | ------ | ------------ |
| The Coop Inspector | 50 | View Source / Inspect Element |
| Robots Roost | 50 | `robots.txt` discovery |
| Cookie Coop | 75 | Cookie tampering |
| Headers of the Henhouse | 100 | HTTP response headers |
| The Egg Vault | 150 | Path traversal (sandboxed virtual FS) |

### 💥 Pwn / Logic
| Challenge | Points | Skill tested |
| --------- | ------ | ------------ |
| Coop Records | 100 | IDOR / broken access control |
| Fowl Play Shop | 125 | Business-logic (negative-quantity) tampering |
| Token of Trust | 175 | JWT `alg:none` authentication bypass |

### 🔐 Crypto
| Challenge | Points | Skill tested |
| --------- | ------ | ------------ |
| Base64 Eggs | 50 | Base64 decoding |
| Caesar Cluck | 75 | ROT13 / Caesar cipher |
| Binary Brood | 75 | Binary → ASCII |
| The Vigenère Vane | 125 | Vigenère cipher |

### 🔧 Reversing
| Challenge | Points | Skill tested |
| --------- | ------ | ------------ |
| The Cluck Lock | 100 | Reverse an XOR-masked lookup table |
| Matryoshka Egg | 150 | Undo layered `base64(reverse(xor()))` encoding |

### 🖼️ Stego
| Challenge | Points | Skill tested |
| --------- | ------ | ------------ |
| Invisible Ink | 100 | Zero-width character steganography |
| Tail Feathers | 125 | Data appended after a PNG's `IEND` chunk |

### 🧪 Forensics
| Challenge | Points | Skill tested |
| --------- | ------ | ------------ |
| Strings Attached | 75 | `strings` / `grep` on a binary blob |

### 🔎 OSINT
| Challenge | Points | Skill tested |
| --------- | ------ | ------------ |
| Find The Hen | 100 | Reading text embedded in an image |
| Metadata Molt | 100 | Hidden SVG file metadata |

### 🎲 Misc
| Challenge | Points | Skill tested |
| --------- | ------ | ------------ |
| Morse Cluck | 75 | Morse code decoding |

## Project Structure

```
KFC/
├── server.js              # Express app, auth, and all challenge routes
├── db.js                  # SQLite schema & seed helpers
├── challenges.seed.js     # Challenge definitions (flags live here)
├── package.json
├── tools/
│   └── gen_challenges.js  # One-off generator for binary/stego assets
├── public/
│   ├── style.css          # Global stylesheet (incl. category pills)
│   ├── robots.txt         # Used by the Robots Roost challenge
│   └── challenges/        # Static assets, one folder per challenge
│       ├── find-the-hen/photo.svg
│       ├── metadata-molt/portrait.svg
│       ├── strings-attached/gizzard.dat
│       ├── cluck-lock/lock.js
│       ├── matryoshka-egg/egg.js
│       ├── tail-feathers/rooster.png
│       └── morse-cluck/transmission.txt
└── views/
    ├── index.ejs          # Home page
    ├── register.ejs       # Registration form
    ├── login.ejs          # Login form
    ├── challenges.ejs     # Challenge listing (category order/labels/icons)
    ├── challenge.ejs      # Single challenge view + flag submission
    ├── scoreboard.ejs     # Scoreboard
    ├── 404.ejs            # Not-found page
    ├── partials/
    │   ├── header.ejs
    │   └── footer.ejs
    └── challenge-pages/   # Custom sub-pages for interactive challenges
        ├── coop-inspector-board.ejs
        ├── cookie-coop-door.ejs
        ├── header-hen-desk.ejs
        ├── robots-roost-nest.ejs
        ├── invisible-ink-notice.ejs
        └── token-of-trust-portal.ejs
```

## How to Play

1. **Sign up** — pick a username (3–24 characters, no email required).
2. **Browse challenges** — each one has a description and point value.
3. **Solve it** — use your browser tools, decode ciphers, investigate images, or exploit logic bugs.
4. **Submit the flag** — flags always look like `CHICKEN{something_like_this}`.
5. **Climb the scoreboard** — earn points for each unique solve.

## Authoring New Challenges

Every challenge is defined as an entry in `challenges.seed.js`. The server upserts the list on every boot, so changes take effect on restart.

### 1. Add a seed entry

```js
{
  slug: 'your-challenge-slug',   // unique, URL-safe
  title: 'Challenge Title',
  category: 'web',               // see valid categories below
  points: 100,
  description: `HTML shown on the challenge page. Links, <pre>, <img>, etc. are all fine.`,
  flag: 'CHICKEN{your_flag_here}',
  asset_path: null,              // or '/challenges/<slug>/<file>' for a downloadable asset
}
```

**Valid categories:** `web`, `pwn`, `crypto`, `rev`, `stego`, `forensics`, `osint`, `misc`.
The listing order, labels, and icons for these live in `views/challenges.ejs`, and their pill colours are in `public/style.css` (`.cat-<category>`). To introduce a brand-new category, update those two files as well.

### 2. Static-asset challenges (crypto, stego, forensics, OSINT, rev)

Drop files under `public/challenges/<slug>/` and reference them from the description (and `asset_path`). Binary/steganographic assets (the PNG with appended data, the zero-width page, the XOR tables, etc.) are generated and round-trip-verified by `tools/gen_challenges.js` — extend that script when adding similar puzzles so they stay reproducible.

### 3. Interactive challenges (web, pwn)

Challenges that need server logic get a route under `/c/:slug/...` in `server.js` and, if they render a page, a view in `views/challenge-pages/`. Existing examples to copy:

- **Cookie Coop** — reads/sets a cookie and branches on its value.
- **The Egg Vault** — path traversal against an **in-memory** virtual filesystem (never touches disk).
- **Token of Trust** — hand-rolled JWT issue/verify with a deliberate `alg:none` flaw.

### 4. Golden rule

Keep the flag on the server. Store it only in `challenges.seed.js` (and, where a challenge legitimately reveals it, in the corresponding server route or asset). Never leak it in client-visible code that isn't itself the puzzle.

## Security Notes

- Flags are stored server-side; the intentionally "vulnerable" challenges (path traversal, IDOR, JWT bypass) operate on in-memory data and never expose the real filesystem or other users' data.
- Passwords are hashed with bcrypt (cost factor 12).
- Sessions use `httpOnly` and `sameSite: lax` cookies.
- The `.gitignore` excludes the `data/` directory (databases) and `.env` files.

## License

This project is licensed under the [MIT License](LICENSE).
