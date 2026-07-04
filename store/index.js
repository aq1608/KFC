'use strict';

// Selects the data backend at startup:
//   - Postgres  when DATABASE_URL is set (unlocks free/managed hosts + scaling)
//   - SQLite    otherwise (the zero-config default)
//
// Both backends expose the same async interface (see sqlite.js / pg.js), so the
// rest of the app is storage-agnostic.

const backend = process.env.DATABASE_URL ? require('./pg') : require('./sqlite');

module.exports = backend;
