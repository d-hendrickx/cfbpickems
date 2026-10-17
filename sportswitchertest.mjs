/**
 * CFB Pickems — sportswitchertest.mjs
 * ====================================
 * D1 (v0.30.0) Lane A — DI-521 rev 3 / DI-555: js/sport-switcher.js. The participation rule is the heart of it: the control renders ONLY for a member who plays two or more sports,
 * lists ONLY those sports, and carries "All sports" only where asked (the Dashboard).
 *
 * Run:  node sportswitchertest.mjs
 *   [1]  structure — a pure leaf (canary), the exact API, the escaper required.
 *   [2]  the participation rule — 0 / 1 sports render NOTHING (no wrapper, no empty box); 2 and 3 render a radiogroup of exactly those sports.
 *   [3]  All sports — only when asked, always last, never a gold dot.
 *   [4]  the control's contract — role, aria-checked, roving tabindex, equal segments through --seg-n / --seg-i, the thumb, data-sport values.
 *   [5]  the due dot — only on an UNSELECTED segment, from the one due list, and in the accessible name too.
 *   [6]  the keyboard model.
 *   [7]  XSS — hostile codes and labels.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const SW = await import('./js/sport-switcher.js');
const { sportSwitcherHTML, nextSegmentIndex, segmentValues, ALL_SPORTS_VALUE } = SW;
const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CFB = { dbCode: 'cfb', code: 'CFB', label: 'College Football' };
const NFL = { dbCode: 'nfl', code: 'NFL', label: 'NFL' };
const NHL = { dbCode: 'nhl', code: 'NHL', label: 'NHL' };
const count = (h, re) => (h.match(re) || []).length;

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[1] structure…');
{
  const src = await readFile(join(HERE, 'js', 'sport-switcher.js'), 'utf8');
  const scan = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const hasImport = (t) => /^\s*import\b|\bimport\s*\(|\brequire\s*\(/m.test(scan(t));
  assert(!hasImport(src) && hasImport(`import x from './app.js';\n${src}`), '[1a] a pure leaf: no import (and the scan can fail: canary)');
  assert(!/\b(document|window|localStorage|getPlayers|getSession)\b/.test(scan(src)), '[1b] touches no DOM, no storage');
  assert(eq(Object.keys(SW).sort(), ['ALL_SPORTS_VALUE', 'nextSegmentIndex', 'segmentValues', 'sportSwitcherHTML']), `[1c] the exported API (${Object.keys(SW).sort().join(', ')})`);
  let e = null; try { sportSwitcherHTML({ sports: [CFB, NFL] }); } catch (x) { e = x; }
  assert(e instanceof TypeError && /escHtml/.test(e.message), '[1d] refuses to render without an escaper');
  assert(ALL_SPORTS_VALUE === 'all', '[1e] the All sports value is the string "all" (the same one competition.js stores)');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[2] the participation rule — a member who plays fewer than two sports gets NOTHING…');
{
  assert(sportSwitcherHTML({ sports: [], escHtml }) === '', '[2a] no played sport: ""');
  assert(sportSwitcherHTML({ sports: [CFB], selected: 'cfb', escHtml }) === '', '[2b] ONE played sport (a CFB-only member in a two-sport league): "" — no switcher, no NFL button, no Join');
  assert(sportSwitcherHTML({ sports: [CFB], selected: 'cfb', allSports: true, escHtml }) === '', '[2c] …even if All sports is asked for (it exists only for two or more)');
  assert(sportSwitcherHTML({ escHtml }) === '' && sportSwitcherHTML({ sports: null, escHtml }) === '' && sportSwitcherHTML({ sports: [null, undefined, {}], escHtml }) === '', '[2d] junk lists give ""');
  const two = sportSwitcherHTML({ sports: [CFB, NFL], selected: 'cfb', escHtml });
  assert(count(two, /<button\b/g) === 2 && /data-sport="cfb"/.test(two) && /data-sport="nfl"/.test(two) && !/data-sport="all"/.test(two), '[2e] two played sports: exactly two buttons');
  const three = sportSwitcherHTML({ sports: [CFB, NFL, NHL], selected: 'nhl', escHtml });
  assert(count(three, /<button\b/g) === 3 && /--seg-n:3;--seg-i:2/.test(three), '[2f] three played sports: three buttons, the selected index 2');
  assert(!/Join|Not in|not in/.test(two + three), '[2g] no segment, page or label ever says Join or "Not in" (joining lives in the overview sheet only)');
  const unplayed = sportSwitcherHTML({ sports: [CFB, NFL], selected: 'cfb', escHtml });
  assert(!/nhl|NHL/.test(unplayed), '[2h] a sport that is not in the list (not played) is not in the control');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[3] All sports…');
{
  const html = sportSwitcherHTML({ sports: [CFB, NFL], selected: 'all', allSports: true, dueCodes: ['nfl'], escHtml });
  const order = [...html.matchAll(/data-sport="([a-z]+)"/g)].map((m) => m[1]);
  assert(eq(order, ['cfb', 'nfl', 'all']), `[3a] CFB · NFL · All sports, in that order (${order})`);
  assert(/<button[^>]*data-sport="all"[^>]*aria-checked="true"/.test(html) || /aria-checked="true"[^>]*data-sport="all"/.test(html), '[3b] "all" can be the selected value');
  assert(/--seg-n:3;--seg-i:2/.test(html), '[3c] …and the thumb index is the last segment');
  const allBtn = html.match(/<button[^>]*data-sport="all"[^>]*>[\s\S]*?<\/button>/)[0];
  assert(!/sport-seg-dot/.test(allBtn) && />All sports</.test(allBtn), '[3d] All sports never carries a due dot and reads "All sports"');
  const noAll = sportSwitcherHTML({ sports: [CFB, NFL], selected: 'all', escHtml });
  assert(!/data-sport="all"/.test(noAll) && /aria-checked="true"[^>]*data-sport="cfb"|data-sport="cfb"[^>]*aria-checked="true"/.test(noAll), '[3e] where All sports is not offered (Picks, Standings) a selected "all" falls back to the first sport');
  assert(eq(segmentValues([CFB, NFL], true), ['cfb', 'nfl', 'all']) && eq(segmentValues([CFB, NFL], false), ['cfb', 'nfl']) && eq(segmentValues(null), []), '[3f] segmentValues');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[4] the control\'s contract…');
{
  const html = sportSwitcherHTML({ sports: [CFB, NFL], selected: 'nfl', escHtml });
  assert(/<div class="sport-seg" role="radiogroup" aria-label="Sport" style="--seg-n:2;--seg-i:1">/.test(html), '[4a] a labelled radiogroup with the segment count and the selected index as custom properties');
  assert(count(html, /role="radio"/g) === 2 && count(html, /aria-checked="true"/g) === 1 && count(html, /aria-checked="false"/g) === 1, '[4b] two radios, exactly one checked');
  assert(/aria-checked="true" tabindex="0" data-sport="nfl"/.test(html) && /aria-checked="false" tabindex="-1" data-sport="cfb"/.test(html), '[4c] roving tabindex: the checked radio is the one tab stop');
  assert(/<span class="sport-seg-thumb" aria-hidden="true"><\/span>/.test(html), '[4d] the sliding thumb is decorative');
  assert(count(html, /type="button"/g) === 2, '[4e] every segment is type="button" (it never submits a form)');
  assert(sportSwitcherHTML({ sports: [CFB, NFL], selected: 'bogus', escHtml }).includes('--seg-i:0'), '[4f] an unknown selected value falls back to the first segment');
  assert(/^<div class="sport-seg-host">.*<\/div><\/div>$/.test(html), '[4g] wrapped in a host so app.js can keep the node across a page repaint');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[5] the due dot…');
{
  const html = sportSwitcherHTML({ sports: [CFB, NFL], selected: 'cfb', dueCodes: ['nfl'], dueLabels: { nfl: 'picks due in 21 hours' }, escHtml });
  const nflBtn = html.match(/<button[^>]*data-sport="nfl"[^>]*>[\s\S]*?<\/button>/)[0];
  const cfbBtn = html.match(/<button[^>]*data-sport="cfb"[^>]*>[\s\S]*?<\/button>/)[0];
  assert(/sport-seg-dot/.test(nflBtn) && !/sport-seg-dot/.test(cfbBtn), '[5a] the dot is on the unselected sport that is due');
  assert(/aria-label="NFL, picks due in 21 hours"/.test(nflBtn), `[5b] …and the fact is in the accessible name, not only the dot (${nflBtn.match(/aria-label="[^"]*"/)[0]})`);
  const sel = sportSwitcherHTML({ sports: [CFB, NFL], selected: 'nfl', dueCodes: ['nfl'], escHtml });
  assert(!/sport-seg-dot/.test(sel), '[5c] a due sport that is SELECTED has no dot (the page says so)');
  assert(!/sport-seg-dot/.test(sportSwitcherHTML({ sports: [CFB, NFL], selected: 'cfb', dueCodes: [], escHtml })), '[5d] nothing due: no dot');
  assert(/aria-label="NFL, picks due"/.test(sportSwitcherHTML({ sports: [CFB, NFL], selected: 'cfb', dueCodes: ['nfl'], escHtml })), '[5e] with no time given the name still says picks are due');
  assert(!/sport-seg-dot/.test(sportSwitcherHTML({ sports: [CFB, NFL], selected: 'cfb', dueCodes: ['nhl'], escHtml })), '[5f] a due code that is not a played sport draws nothing');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[6] the keyboard model…');
{
  assert(nextSegmentIndex(3, 0, 'ArrowRight') === 1 && nextSegmentIndex(3, 1, 'ArrowDown') === 2 && nextSegmentIndex(3, 2, 'ArrowRight') === 2, '[6a] Right / Down advance and stop at the end (no wrap)');
  assert(nextSegmentIndex(3, 2, 'ArrowLeft') === 1 && nextSegmentIndex(3, 1, 'ArrowUp') === 0 && nextSegmentIndex(3, 0, 'ArrowLeft') === 0, '[6b] Left / Up retreat and stop at the start');
  assert(nextSegmentIndex(3, 1, 'Home') === 0 && nextSegmentIndex(3, 1, 'End') === 2, '[6c] Home / End');
  assert(nextSegmentIndex(3, 1, 'a') === 1 && nextSegmentIndex(3, 1, undefined) === 1, '[6d] any other key leaves the index alone');
  assert(nextSegmentIndex(0, 5, 'End') === 0 && nextSegmentIndex(3, 99, 'ArrowLeft') === 1 && nextSegmentIndex(3, -4, 'ArrowRight') === 1 && nextSegmentIndex(NaN, 1, 'Home') === 0, '[6e] junk counts and indices are clamped');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[7] XSS…');
{
  const H = '"><img src=x onerror=alert(1)>';
  const html = sportSwitcherHTML({ sports: [{ dbCode: H, code: H, label: H }, { dbCode: 'nfl', code: H, label: H }], selected: H, dueCodes: ['nfl'], dueLabels: { nfl: H }, allSports: true, escHtml });
  assert(!html.includes(H) && !/<img\b/.test(html) && html.includes('&quot;&gt;&lt;img'), '[7a] hostile dbCode / code / selected / due label are escaped everywhere, including aria-label and data-sport');
  const names = [...html.matchAll(/<(button|span|div)((?:\s[^<>]*)?)>/g)].flatMap((t) => [...t[2].replace(/="[^"]*"/g, '=""').matchAll(/\s([^\s=]+)/g)].map((a) => a[1]));
  assert(names.length > 10 && names.every((n) => /^(type|class|role|aria-checked|aria-label|aria-hidden|tabindex|data-sport|style|disabled)$/.test(n)), `[7b] every attribute NAME is one the module writes (${[...new Set(names)].join(', ')})`);
}

console.log('\n' + (fail ? '❌ FAILURES' : '✅ ALL PASS') + ` — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
