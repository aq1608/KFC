// All flags live here, on the server. NEVER put real flags in client-visible files.
// Add new challenges by appending to this list; server re-seeds (upsert) on every boot.

module.exports = [
  {
    slug: 'coop-inspector',
    title: 'The Coop Inspector',
    category: 'web',
    points: 50,
    description: `A chicken has left a note on our neighbourhood noticeboard, but it's suspiciously blank.
Rumour has it the chickens have learned to hide things in plain sight.

Visit <a href="/c/coop-inspector/board" target="_blank" rel="noopener">the noticeboard</a> and see if you can find what the chicken wrote.

<em>Hint: browsers have a tool called "View Source" or "Inspect Element" for a reason.</em>`,
    flag: 'CHICKEN{inspect_before_you_peck}',
    asset_path: null,
  },
  {
    slug: 'caesar-cluck',
    title: 'Caesar Cluck',
    category: 'crypto',
    points: 75,
    description: `A chicken calling itself "Julius Cluckius" left this scrap of paper on the fence:

<pre>PUVPXRA{ebbfgref_ehyr_gur_ebbfg}</pre>

Julius always insisted his messages were <em>a classic</em>. Decode it and submit the flag.`,
    flag: 'CHICKEN{roosters_rule_the_roost}',
    asset_path: null,
    hints: [
      { body: 'A "classic" cipher named after Julius = a Caesar shift. This one is the most famous shift of all.', cost: 5 },
      { body: 'It\'s ROT13 — shift every letter by 13. Paste the text into any ROT13 decoder.', cost: 15 },
    ],
  },
  {
    slug: 'find-the-hen',
    title: 'Find The Hen',
    category: 'osint',
    points: 100,
    description: `A hen has been spotted somewhere in the neighbourhood. She left a photograph behind — and, being a technologically inclined hen, she scratched her secret message right onto the picture.

<img src="/challenges/find-the-hen/photo.svg" alt="A photo left behind by a hen" style="max-width:100%;border:2px solid #b58900;border-radius:8px;margin:0.75rem 0;">

Wrap what you find in the flag format: <code>CHICKEN{...}</code>`,
    flag: 'CHICKEN{under_the_third_bush}',
    asset_path: '/challenges/find-the-hen/photo.svg',
  },

  // ---------------- Crypto ----------------
  {
    slug: 'base64-eggs',
    title: 'Base64 Eggs',
    category: 'crypto',
    points: 50,
    description: `A chicken scrambled its message like a plate of eggs. It looks like gibberish, but there's a
well-known way to un-scramble text that ends in one or two <code>=</code> signs.

<pre>Q0hJQ0tFTntiNHNlX29mX3RoZV9jb29wfQ==</pre>

<em>Hint: this encoding is named after a power of two. Most terminals can decode it in one line.</em>`,
    flag: 'CHICKEN{b4se_of_the_coop}',
    asset_path: null,
  },
  {
    slug: 'binary-brood',
    title: 'Binary Brood',
    category: 'crypto',
    points: 75,
    description: `A brood of chicks lined up in two neat colours: fluffy (1) and bald (0). Each group of eight
chicks spells out a single letter.

<pre>01000011 01001000 01001001 01000011 01001011 01000101 01001110 01111011
01100011 01101100 01110101 01100011 01101011 01011111 01101001 01101110
01011111 01100010 01101001 01110100 01110011 01111101</pre>

<em>Hint: 8 bits = 1 byte = 1 ASCII character.</em>`,
    flag: 'CHICKEN{cluck_in_bits}',
    asset_path: null,
  },
  {
    slug: 'vigenere-vane',
    title: 'The Vigenère Vane',
    category: 'crypto',
    points: 125,
    description: `The weathervane rooster only speaks in a cipher more cunning than Caesar's — each letter is
shifted by a different amount, repeating a secret keyword.

<pre>gczqtpgyopwmmt gcidmvp</pre>

The rooster crows one word over and over from the top of the barn: <strong>ROOSTER</strong>.
Decode the message, then submit it as the flag with spaces turned into underscores:
<code>CHICKEN{decoded_message_here}</code>`,
    flag: 'CHICKEN{polyalphabetic_poultry}',
    asset_path: null,
    hints: [
      { body: 'The keyword really is <code>ROOSTER</code> — feed both the ciphertext and that key into a Vigenère decoder.', cost: 20 },
    ],
  },

  // ---------------- Web ----------------
  {
    slug: 'cookie-coop',
    title: 'Cookie Coop',
    category: 'web',
    points: 75,
    description: `The coop's back door checks your <em>membership cookie</em> before it lets you in. Ordinary
hens are stamped <code>role=hen</code> and turned away from the VIP roost.

Visit <a href="/c/cookie-coop/door" target="_blank" rel="noopener">the coop's back door</a>. You'll
be handed a cookie automatically. Only a <code>head_rooster</code> may pass.

<em>Hint: cookies are just editable text stored in your browser. Change yours and reload.</em>`,
    flag: 'CHICKEN{tamper_the_cookie_jar}',
    asset_path: null,
  },
  {
    slug: 'robots-roost',
    title: 'Robots Roost',
    category: 'web',
    points: 50,
    description: `Even chicken websites have a <code>/robots.txt</code> file telling web crawlers where <em>not</em>
to look. Naturally, that's exactly where the chickens hid something.

Take a look at <a href="/robots.txt" target="_blank" rel="noopener">this site's robots.txt</a> and
follow your nose to the disallowed nest.`,
    flag: 'CHICKEN{disallowed_but_not_forbidden}',
    asset_path: null,
  },
  {
    slug: 'header-hen',
    title: 'Headers of the Henhouse',
    category: 'web',
    points: 100,
    description: `The henhouse receptionist swears the desk is empty — but she always attaches a little note to
the <em>envelope</em>, not the letter inside.

Request <a href="/c/header-hen/desk" target="_blank" rel="noopener">the reception desk</a> and
inspect the HTTP <strong>response headers</strong>. One of them doesn't belong on an ordinary page.

<em>Hint: open your browser's Network tab, or run <code>curl -I</code> against the URL.</em>`,
    flag: 'CHICKEN{peck_the_response_headers}',
    asset_path: null,
  },

  // ---------------- OSINT ----------------
  {
    slug: 'metadata-molt',
    title: 'Metadata Molt',
    category: 'osint',
    points: 100,
    description: `A rooster shed a feathered portrait during his annual molt. The picture itself is unremarkable —
but chickens are known to scribble notes in the <em>margins</em> of a file, where casual viewers
never look.

<img src="/challenges/metadata-molt/portrait.svg" alt="A rooster's self-portrait" style="max-width:100%;border:2px solid #b58900;border-radius:8px;margin:0.75rem 0;">

Download or view the source of the image and read its embedded metadata. Wrap what you find as
<code>CHICKEN{...}</code>.`,
    flag: 'CHICKEN{hidden_in_the_metadata}',
    asset_path: '/challenges/metadata-molt/portrait.svg',
  },

  // ---------------- Forensics ----------------
  {
    slug: 'strings-attached',
    title: 'Strings Attached',
    category: 'forensics',
    points: 75,
    description: `We recovered a mysterious file from the compost heap behind the coop. It's stuffed with junk,
but somewhere in the noise a chicken left a readable message.

<a href="/challenges/strings-attached/gizzard.dat" download>Download the recovered file</a> and dig
through its printable text.

<em>Hint: the classic <code>strings</code> command — or a simple <code>grep CHICKEN</code> — will
save you a lot of scrolling.</em>`,
    flag: 'CHICKEN{grep_the_gizzard}',
    asset_path: '/challenges/strings-attached/gizzard.dat',
  },

  // ---------------- Reversing ----------------
  {
    slug: 'cluck-lock',
    title: 'The Cluck Lock',
    category: 'rev',
    points: 100,
    description: `We dumped the firmware from the coop's smart-lock. It never stores the passcode in plain sight —
it keeps a scrambled lookup table and un-scrambles each character at runtime by XOR-ing with a
constant mask.

<a href="/challenges/cluck-lock/lock.js" download>Download <code>lock.js</code></a>, study how
<code>check()</code> compares your input to <code>TABLE</code>, and work <em>backwards</em>: the
correct passcode <strong>is</strong> the flag.

<em>Hint: if <code>(char ^ MASK) === TABLE[i]</code>, then <code>char = TABLE[i] ^ MASK</code>.</em>`,
    flag: 'CHICKEN{r3verse_the_cluck}',
    asset_path: '/challenges/cluck-lock/lock.js',
    hints: [
      { body: 'XOR is its own inverse. For each number in <code>TABLE</code>, compute <code>value ^ 42</code>.', cost: 15 },
      { body: 'In JS: <code>TABLE.map(n => String.fromCharCode(n ^ 42)).join("")</code> spells the flag.', cost: 30 },
    ],
  },
  {
    slug: 'matryoshka-egg',
    title: 'Matryoshka Egg',
    category: 'rev',
    points: 150,
    description: `A secret was wrapped inside layers like a nesting egg. We recovered the exact encoder the
chickens used — you just need to run it in reverse.

<a href="/challenges/matryoshka-egg/egg.js" download>Download <code>egg.js</code></a>. It XORs the
secret with a repeating key, reverses the bytes, then base64-encodes the lot. The wrapped
<code>BLOB</code> is included in the file.

Peel the layers in the opposite order to reveal the flag.`,
    flag: 'CHICKEN{layers_upon_layers}',
    asset_path: '/challenges/matryoshka-egg/egg.js',
    hints: [
      { body: 'Reverse the encode steps in the opposite order: base64-decode the BLOB first.', cost: 15 },
      { body: 'Then reverse the decoded bytes, and finally XOR them with the repeating key <code>EGG</code>.', cost: 30 },
    ],
  },

  // ---------------- Steganography ----------------
  {
    slug: 'invisible-ink',
    title: 'Invisible Ink',
    category: 'stego',
    points: 100,
    description: `A hen pinned up a perfectly ordinary sentence on the board — but she wrote part of it in
<em>invisible ink</em>. Between the visible letters hide characters with zero width.

Visit <a href="/c/invisible-ink/notice" target="_blank" rel="noopener">the invisible-ink notice</a>,
copy the sentence (or read the page source), and extract the hidden zero-width characters.

<em>Hint: two distinct zero-width characters — that's binary in disguise. 8 bits per letter.</em>`,
    flag: 'CHICKEN{read_between_the_letters}',
    asset_path: null,
  },
  {
    slug: 'tail-feathers',
    title: 'Tail Feathers',
    category: 'stego',
    points: 125,
    description: `A rooster mailed us his portrait. The image opens fine in any viewer — but a proper PNG is
supposed to <em>end</em> at its <code>IEND</code> chunk. This one keeps going.

<img src="/challenges/tail-feathers/rooster.png" alt="A rooster's PNG portrait" style="max-width:100%;border:2px solid #b58900;border-radius:8px;margin:0.75rem 0;">

<a href="/challenges/tail-feathers/rooster.png" download>Download the PNG</a> and inspect the bytes
that come <strong>after</strong> the image ends.

<em>Hint: <code>strings</code>, <code>binwalk</code>, or a hex editor will reveal the tail.</em>`,
    flag: 'CHICKEN{feathers_hide_the_flag}',
    asset_path: '/challenges/tail-feathers/rooster.png',
    hints: [
      { body: 'A PNG ends at its <code>IEND</code> chunk. Anything after that is smuggled data.', cost: 10 },
      { body: 'Run <code>strings rooster.png | tail</code> (or open it in a hex editor) to read the trailer.', cost: 20 },
    ],
  },

  // ---------------- Misc ----------------
  {
    slug: 'morse-cluck',
    title: 'Morse Cluck',
    category: 'misc',
    points: 75,
    description: `The rooster on the barn roof has been crowing in a suspicious rhythm — long and short,
long and short. We wrote it all down.

<pre>-- --- .-. ... .  /  -- .- ... - . .-.  /  .... . -.</pre>

Decode the Morse. <code>/</code> separates words. Submit it lowercase with underscores between
words: <code>CHICKEN{word_word_word}</code>.

<em>(A copy is also at <a href="/challenges/morse-cluck/transmission.txt" download>transmission.txt</a>.)</em>`,
    flag: 'CHICKEN{morse_master_hen}',
    asset_path: '/challenges/morse-cluck/transmission.txt',
  },

  // ---------------- Web (harder) ----------------
  {
    slug: 'egg-vault',
    title: 'The Egg Vault',
    category: 'web',
    points: 150,
    description: `The Egg Vault's public reading room lets visitors fetch notes by filename, like
<a href="/c/egg-vault/read?file=welcome.txt" target="_blank" rel="noopener"><code>?file=welcome.txt</code></a>.
The librarian swears the master key is locked away in a different room entirely — one level up
from the reading room.

The server naively joins your <code>file</code> parameter onto the reading-room path without
checking where it lands. See if you can climb <em>out</em> of the reading room.

<em>Hint: <code>../</code> is your friend. The vault sits beside the reading room.</em>`,
    flag: 'CHICKEN{path_traversal_poultry}',
    asset_path: null,
    hints: [
      { body: 'The vault sits one directory above the reading room. Prefix the filename with <code>../</code>.', cost: 20 },
      { body: 'Try <code>/c/egg-vault/read?file=../vault/master.key</code>.', cost: 40 },
    ],
  },

  // ---------------- Pwn / Logic ----------------
  {
    slug: 'coop-records',
    title: 'Coop Records',
    category: 'pwn',
    points: 100,
    description: `The Coop Records office lets each hen read her own filed note by ID. Yours is record
<strong>#1001</strong>:
<a href="/c/coop-records/note?id=1001" target="_blank" rel="noopener"><code>?id=1001</code></a>.

The clerk hands over any record you ask for — she never checks whether it's actually
<em>yours</em>. The Head Rooster filed something confidential a few records earlier.

<em>Hint: this is a classic IDOR (Insecure Direct Object Reference). Just change the number.</em>`,
    flag: 'CHICKEN{idor_the_head_rooster}',
    asset_path: null,
  },
  {
    slug: 'fowl-play-shop',
    title: 'Fowl Play Shop',
    category: 'pwn',
    points: 125,
    description: `The Fowl Play Shop sells feed and straw — and one absurdly expensive <strong>Golden Egg</strong>
(1,000,000 coins). Your wallet holds a measly <strong>100</strong> coins.

Checkout takes a JSON cart and only cares that the <em>total</em> fits your wallet — it never
checks that quantities make any sense. Example (an honest cart):
<pre>/c/fowl-play-shop/checkout?cart=[{"item":"straw","qty":2}]</pre>

Prices: <code>golden-egg</code> = 1000000, <code>feed</code> = 1000, <code>straw</code> = 50.
Build a cart that lands the Golden Egg without going over 100 coins.

<em>Hint: what happens to a total when a quantity goes negative?</em>`,
    flag: 'CHICKEN{negative_qty_free_eggs}',
    asset_path: null,
  },
  {
    slug: 'token-of-trust',
    title: 'Token of Trust',
    category: 'pwn',
    points: 175,
    description: `The henhouse API authenticates with JSON Web Tokens. Visit
<a href="/c/token-of-trust/portal" target="_blank" rel="noopener">the portal</a> to receive your
signed <em>guest</em> token, then present it to the API:
<pre>/c/token-of-trust/api?token=YOUR_TOKEN</pre>

You can't forge the HS256 signature — you don't know the secret. But the server's verifier has a
notorious flaw in <em>which algorithms it trusts</em>. Only a token whose payload says
<code>"role":"admin"</code> unlocks the secret.

<em>Hint: what if a token claims it needs no signature at all? Look up the JWT "alg:none" attack.</em>`,
    flag: 'CHICKEN{alg_none_is_never_okay}',
    asset_path: null,
    hints: [
      { body: 'Decode the three base64url parts. You only need to change the header and payload.', cost: 20 },
      { body: 'Set the header to <code>{"alg":"none","typ":"JWT"}</code> and the payload to include <code>"role":"admin"</code>.', cost: 40 },
      { body: 'The token is <code>base64url(header) + "." + base64url(payload) + "."</code> — note the trailing dot and empty signature.', cost: 60 },
    ],
  },
];
