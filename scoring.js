'use strict';

// Dynamic (decaying) challenge scoring, in the spirit of CTFd.
//
// A challenge starts at its full `initial` value and decays toward a floor as
// more players solve it. This rewards early solvers and de-values challenges
// that turn out to be easy (lots of solves). All solvers of a challenge are
// always worth its *current* value, so scores shift as the competition evolves.
//
// value(n) = ceil( ((floor - initial) / decay^2) * n^2 + initial )
//   clamped to [floor, initial], where n = number of solves.

const DECAY = Number(process.env.DYN_DECAY) || 20;          // solves to approach the floor
const MIN_RATIO = Number(process.env.DYN_MIN_RATIO) || 0.4; // floor as a fraction of initial

// The lowest a challenge can decay to.
function minValue(initial) {
  return Math.max(1, Math.ceil(initial * MIN_RATIO));
}

// Current value of a challenge given how many times it has been solved.
function dynamicValue(initial, solves) {
  const floor = minValue(initial);
  const n = Math.max(0, Math.trunc(solves) || 0);
  const v = Math.ceil(((floor - initial) / (DECAY * DECAY)) * (n * n) + initial);
  return Math.min(initial, Math.max(floor, v));
}

module.exports = { dynamicValue, minValue, DECAY, MIN_RATIO };
