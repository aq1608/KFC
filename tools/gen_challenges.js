// One-off generator for new KFC challenge assets. Safe to delete after running.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PUB = path.join(__dirname, '..', 'public', 'challenges');
function ensure(dir) { fs.mkdirSync(dir, { recursive: true }); }

// ---------- helpers ----------
function xorStr(str, key) {
  const out = Buffer.alloc(str.length);
  for (let i = 0; i < str.length; i++) {
    out[i] = str.charCodeAt(i) ^ key.charCodeAt(i % key.length);
  }
  return out;
}

// CRC32 for PNG chunks
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function makePng(width, height, drawFn) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // color type: RGB
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  // raw scanlines: each row starts with filter byte 0
  const raw = Buffer.alloc(height * (1 + width * 3));
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = drawFn(x, y, width, height);
      raw[p++] = r; raw[p++] = g; raw[p++] = b;
    }
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const report = {};

// ============================================================
// 1) REV: cluck-lock  — XOR-42 encoded byte array in a JS file
// ============================================================
{
  const flag = 'CHICKEN{r3verse_the_cluck}';
  const KEY = 42;
  const encoded = [...flag].map(c => c.charCodeAt(0) ^ KEY);
  const js = `// lock.js  —  The Cluck Lock
// The coop's smart-lock firmware. It never stores the passcode directly;
// instead it keeps this "obfuscated" table and compares at runtime.

const TABLE = [${encoded.join(', ')}];
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
`;
  const dir = path.join(PUB, 'cluck-lock'); ensure(dir);
  fs.writeFileSync(path.join(dir, 'lock.js'), js);
  // verify
  const dec = encoded.map(n => String.fromCharCode(n ^ KEY)).join('');
  report['cluck-lock'] = { flag, ok: dec === flag };
}

// ============================================================
// 2) REV: matryoshka-egg  — base64(reverse(xor(flag, "EGG")))
// ============================================================
{
  const flag = 'CHICKEN{layers_upon_layers}';
  const KEY = 'EGG';
  const xored = xorStr(flag, KEY);
  const reversed = Buffer.from([...xored].reverse());
  const blob = reversed.toString('base64');
  const js = `// egg.js  —  Matryoshka Egg encoder
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
const BLOB = ${JSON.stringify(blob)};

// Your job: write decode(BLOB) and print the flag.
module.exports = { encode, BLOB, KEY };
`;
  const dir = path.join(PUB, 'matryoshka-egg'); ensure(dir);
  fs.writeFileSync(path.join(dir, 'egg.js'), js);
  // verify decode
  const b = Buffer.from(blob, 'base64');
  const un = Buffer.from([...b].reverse());
  const dec = xorStr(un.toString('latin1'), KEY).toString('utf8');
  report['matryoshka-egg'] = { flag, blob, ok: dec === flag };
}

// ============================================================
// 3) STEGO: invisible-ink  — zero-width chars encoding the flag
//    bit 0 -> U+200B (ZWSP), bit 1 -> U+200C (ZWNJ)
// ============================================================
{
  const flag = 'CHICKEN{read_between_the_letters}';
  const bits = [...flag].map(c => c.charCodeAt(0).toString(2).padStart(8, '0')).join('');
  const zw = [...bits].map(b => (b === '1' ? '\u200C' : '\u200B')).join('');
  // Embedded inside a visible sentence, right after the word "chicken".
  const carrier = `The quick brown chicken${zw} jumped clean over the lazy fox.`;
  const view = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>The Invisible Ink Notice</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <main class="site-main">
    <article class="auth-card" style="max-width:34rem;">
      <h1>&#129475; The Invisible Ink Notice</h1>
      <p>A hen pinned up this perfectly ordinary sentence:</p>
      <blockquote id="secret" style="font-size:1.1rem; border-left:4px solid var(--gold); padding-left:0.75rem; color:var(--ink);">${carrier}</blockquote>
      <p style="color:var(--ink-soft); font-size:0.95rem;">
        Looks innocent&hellip; but between the visible letters hide characters with
        <strong>zero width</strong>. Select and copy the sentence, or read the raw HTML, and
        pull out the hidden characters. Two different zero-width characters &mdash; sounds
        an awful lot like binary, doesn't it?
      </p>
      <p style="color:var(--ink-soft); font-size:0.9rem;">
        (ZERO WIDTH SPACE = <code>U+200B</code>, ZERO WIDTH NON-JOINER = <code>U+200C</code>.)
      </p>
      <p style="margin-top:1.5rem;"><a href="/challenges/invisible-ink">&larr; Back to the challenge</a></p>
    </article>
  </main>
</body>
</html>
`;
  const vdir = path.join(__dirname, '..', 'views', 'challenge-pages'); ensure(vdir);
  fs.writeFileSync(path.join(vdir, 'invisible-ink-notice.ejs'), view);
  // verify extraction
  const extracted = [...carrier].filter(c => c === '\u200B' || c === '\u200C')
    .map(c => (c === '\u200C' ? '1' : '0')).join('');
  let dec = '';
  for (let i = 0; i < extracted.length; i += 8) dec += String.fromCharCode(parseInt(extracted.slice(i, i + 8), 2));
  report['invisible-ink'] = { flag, ok: dec === flag, zwCount: zw.length };
}

// ============================================================
// 4) STEGO: tail-feathers — real PNG with secret appended after IEND
// ============================================================
{
  const flag = 'CHICKEN{feathers_hide_the_flag}';
  const W = 200, H = 120;
  const png = makePng(W, H, (x, y) => {
    // sky gradient + a little sun
    const dx = x - 150, dy = y - 30;
    if (dx * dx + dy * dy < 18 * 18) return [255, 214, 90]; // sun
    const t = y / H;
    return [Math.round(120 + 100 * t), Math.round(180 + 40 * t), 235];
  });
  const trailer = Buffer.from(
    `\n\n--- Nothing to see past the image data, right? ---\n` +
    `Psst. Down here, past the IEND chunk: ${flag}\n`,
    'utf8'
  );
  const dir = path.join(PUB, 'tail-feathers'); ensure(dir);
  fs.writeFileSync(path.join(dir, 'rooster.png'), Buffer.concat([png, trailer]));
  report['tail-feathers'] = { flag, ok: true, pngBytes: png.length };
}

// ============================================================
// 5) MISC: morse-cluck — Morse code message
// ============================================================
{
  const MORSE = {
    A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....',
    I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.',
    Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-',
    Y: '-.--', Z: '--..', 0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-',
    5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.',
  };
  const words = ['MORSE', 'MASTER', 'HEN'];
  const morse = words.map(w => [...w].map(c => MORSE[c]).join(' ')).join('  /  ');
  const dir = path.join(PUB, 'morse-cluck'); ensure(dir);
  fs.writeFileSync(path.join(dir, 'transmission.txt'),
    `Intercepted rooster transmission (dots and dashes):\n\n${morse}\n\n` +
    `(  /  separates words. Flag format: CHICKEN{word_word_word} in lowercase.)\n`);
  report['morse-cluck'] = { flag: 'CHICKEN{morse_master_hen}', morse, ok: true };
}

console.log(JSON.stringify(report, null, 2));
