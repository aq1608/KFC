// lock.js  —  The Cluck Lock
// The coop's smart-lock firmware. It never stores the passcode directly;
// instead it keeps this "obfuscated" table and compares at runtime.

const TABLE = [105, 98, 99, 105, 97, 111, 100, 81, 88, 25, 92, 79, 88, 89, 79, 117, 94, 66, 79, 117, 73, 70, 95, 73, 65, 87];
const MASK  = 42;

function check(passcode) {
  if (passcode.length !== TABLE.length) return false;
  for (let i = 0; i < TABLE.length; i++) {
    if ((passcode.charCodeAt(i) ^ MASK) !== TABLE[i]) return false;
  }
  return true;
}

// The correct passcode IS the flag. Recover it from TABLE and MASK above.
module.exports = { check };
