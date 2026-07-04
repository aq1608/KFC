'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { difficultyFor, difficultyLabel } = require('../difficulty');
const seed = require('../challenges.seed');

describe('difficultyFor', () => {
  test('maps point values to the expected tier', () => {
    assert.strictEqual(difficultyFor(50), 'easy');
    assert.strictEqual(difficultyFor(75), 'easy');
    assert.strictEqual(difficultyFor(100), 'medium');
    assert.strictEqual(difficultyFor(125), 'medium');
    assert.strictEqual(difficultyFor(150), 'hard');
    assert.strictEqual(difficultyFor(175), 'hard');
    assert.strictEqual(difficultyFor(1000), 'hard');
  });

  test('every seeded challenge resolves to a known tier', () => {
    const known = new Set(['easy', 'medium', 'hard']);
    for (const c of seed) {
      const d = difficultyFor(c.points);
      assert.ok(known.has(d), `${c.slug}: unexpected difficulty ${d}`);
      assert.ok(difficultyLabel(d).length > 0);
    }
  });
});
