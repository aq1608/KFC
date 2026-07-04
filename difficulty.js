'use strict';

// Maps a challenge's initial point value to a difficulty tier. Kept separate
// from scoring so it can be unit-tested and reused by routes and views.

const TIERS = [
  { key: 'easy', label: 'Easy', max: 75 },
  { key: 'medium', label: 'Medium', max: 125 },
  { key: 'hard', label: 'Hard', max: Infinity },
];

function difficultyFor(points) {
  const tier = TIERS.find((t) => points <= t.max) || TIERS[TIERS.length - 1];
  return tier.key;
}

function difficultyLabel(key) {
  const tier = TIERS.find((t) => t.key === key);
  return tier ? tier.label : key;
}

module.exports = { difficultyFor, difficultyLabel, TIERS };
