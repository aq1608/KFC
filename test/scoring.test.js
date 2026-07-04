'use strict';

// Unit tests for the dynamic (decaying) scoring formula.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { dynamicValue, minValue, DECAY, MIN_RATIO } = require('../scoring');

describe('dynamicValue', () => {
  test('an unsolved (0 solves) challenge is worth its full initial value', () => {
    for (const p of [50, 75, 100, 125, 150, 175]) {
      assert.strictEqual(dynamicValue(p, 0), p);
    }
  });

  test('one solve keeps the value at (or extremely close to) initial', () => {
    // With a single solver the decay is negligible; value must not exceed initial.
    for (const p of [50, 100, 175]) {
      const v = dynamicValue(p, 1);
      assert.ok(v <= p && v >= minValue(p));
      assert.ok(p - v <= 1, `expected ~${p}, got ${v}`);
    }
  });

  test('value never drops below the floor', () => {
    const initial = 100;
    const floor = minValue(initial);
    for (let n = 0; n <= 1000; n++) {
      assert.ok(dynamicValue(initial, n) >= floor);
    }
  });

  test('value is monotonically non-increasing as solves grow', () => {
    const initial = 150;
    let prev = dynamicValue(initial, 0);
    for (let n = 1; n <= 200; n++) {
      const v = dynamicValue(initial, n);
      assert.ok(v <= prev, `value increased at n=${n}: ${prev} -> ${v}`);
      prev = v;
    }
  });

  test('value is at the floor by the time solves reach the decay constant', () => {
    const initial = 200;
    assert.strictEqual(dynamicValue(initial, DECAY), minValue(initial));
    assert.strictEqual(dynamicValue(initial, DECAY * 5), minValue(initial));
  });

  test('floor is ceil(initial * MIN_RATIO), at least 1', () => {
    assert.strictEqual(minValue(100), Math.max(1, Math.ceil(100 * MIN_RATIO)));
    assert.ok(minValue(1) >= 1);
  });

  test('result is always an integer within [floor, initial]', () => {
    const initial = 125;
    const floor = minValue(initial);
    for (let n = 0; n <= 60; n++) {
      const v = dynamicValue(initial, n);
      assert.ok(Number.isInteger(v), `non-integer value at n=${n}: ${v}`);
      assert.ok(v >= floor && v <= initial);
    }
  });
});
