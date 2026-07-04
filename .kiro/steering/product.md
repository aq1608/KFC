---
inclusion: always
---

# Product: KFC — Keep Finding Chickens

KFC is a self-hostable, chicken-themed **Capture-The-Flag (CTF)** platform. Players
register, solve security/puzzle challenges to uncover hidden flags, and compete on
a live scoreboard.

## Core ideas
- All flags use the format `CHICKEN{...}`.
- 20 challenges across 8 categories: Web, Pwn/Logic, Crypto, Reversing, Stego,
  Forensics, OSINT, Misc.
- It should feel like a real competition, not just a challenge list.

## Player experience
- Sign up with only a username (no email).
- Browse challenges grouped by category, each with a difficulty tier and a live
  point value.
- Solve a challenge, submit the flag, earn points, climb the scoreboard.
- View a personal profile: rank, score, solves, first-bloods, completion progress.

## Competition features
- **Dynamic scoring**: a challenge decays in value as more players solve it.
- **Hints** that cost points (deducted from net score).
- **Prerequisite chains**: some challenges stay locked (puzzle hidden) until their
  prerequisites are solved.
- **Post-solve writeups**: an explanation revealed only after a player solves.
- **First-blood** tracking, solve counts, and an admin dashboard for moderation.

## Guiding principles
- Beginner-friendly but teaches real skills.
- Safe by design: the intentionally "vulnerable" challenges must never expose the
  real system or other players' data.
- Small, approachable, well-tested codebase that is easy to run and extend.
