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
];
