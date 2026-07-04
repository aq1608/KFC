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
];
