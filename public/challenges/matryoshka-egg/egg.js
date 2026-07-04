// egg.js  —  Matryoshka Egg encoder
// This is the exact routine we used to wrap the secret. Peel it in reverse.

const zlib = require('zlib'); // (unused decoy)
const KEY = 'EGG';

function xorBytes(buf, key) {
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] ^ key.charCodeAt(i % key.length);
  return out;
}

// encode(secret):
//   1. XOR the secret with KEY (repeating)
//   2. reverse the bytes
//   3. base64-encode the result
function encode(secret) {
  const step1 = xorBytes(Buffer.from(secret, 'utf8'), KEY);
  const step2 = Buffer.from([...step1].reverse());
  return step2.toString('base64');
}

// The wrapped secret:
const BLOB = "OjQ3Ij4kKxgrKDcwGDQ3Ij4kKzwLAgwGDg8G";

// Your job: write decode(BLOB) and print the flag.
module.exports = { encode, BLOB, KEY };
