/**
 * CFB Pickems — allsportstest.mjs
 * ================================
 * D1 (v0.30.0) Lane A — DI-525 rev 3 (Drew D-59, the Dashboard's "All sports"): js/all-sports.js, the PURE model of the combined slate. The app-level proof (the rendered Dashboard, the
 * real predicates, the scope storage) is dashboardallsportstest.mjs; this file proves the cross-sport RULES without a DOM.
 *
 * Run:  node allsportstest.mjs
 *   [1]  structure — a pure leaf with a canary; the exact API.
 *   [2]  the union — the combined list is exactly the union of the sports' own games, nothing added, nothing dropped, one row per game.
 *   [3]  the sort across sports — Kickoff time (ties: competition order, then game id; time-less games last); Live first; Custom unavailable, and the SAVED mode is never overwritten.
 *   [4]  C2 — each row follows ITS OWN week: a CFB-Live / NFL-Locked fixture; flipping one sport cannot change the other's rows.
 *   [5]  the per-sport gate — one gate in place of that sport's games; the others' games still show.
 *   [6]  hidden weeks (a draft for a member, a demo week for a non-commissioner) and sports with no week contribute nothing.
 *   [7]  the "This week" header and the calm note.
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

const AS = await import('./js/all-sports.js');
const { allSportsModel, sortAllSportsRows, effectiveSortMode, thisWeekHeader, ALL_SPORTS_NOTE } = AS;

const g = (gameId, kickoff, status = 'scheduled') => ({ gameId, kickoff, status });
const CFB_GAMES = [g('c1', '2026-10-10T16:00:00Z', 'live'), g('c2', '2026-10-10T19:30:00Z', 'scheduled'), g('c3', '2026-10-10T12:00:00Z', 'final'), g('c4', '2026-10-10T23:00:00Z', 'scheduled')];
const NFL_GAMES = [g('n1', '2026-10-11T17:00:00Z', 'scheduled'), g('n2', '2026-10-10T19:30:00Z', 'live'), g('n3', '2026-10-12T00:20:00Z', 'scheduled')];
const cfb = (o = {}) => ({ dbCode: 'cfb', code: 'CFB', order: 0, weekId: 'wc6', weekLabel: 'Week 6', canSeeOthers: true, games: CFB_GAMES, ...o });
const nfl = (o = {}) => ({ dbCode: 'nfl', code: 'NFL', order: 1, weekId: 'wn6', weekLabel: 'Week 6', canSeeOthers: true, games: NFL_GAMES, ...o });
const ids = (rows) => rows.map((r) => r.gameId);

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[1] structure…');
{
  const src = await readFile(join(HERE, 'js', 'all-sports.js'), 'utf8');
  const scan = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const hasImport = (t) => /^\s*import\b|\bimport\s*\(|\brequire\s*\(/m.test(scan(t));
  assert(!hasImport(src) && hasImport(`import { getPicks } from './storage.js';\n${src}`), '[1a] a pure leaf (and the scan can fail: canary)');
  assert(!/\b(document|window|localStorage|getPicks|getPlayers|arePicksPublic)\b/.test(scan(src)), '[1b] no DOM, no storage, no pick reader');
  assert(eq(Object.keys(AS).sort(), ['ALL_SPORTS_NOTE', 'allSportsModel', 'effectiveSortMode', 'sortAllSportsRows', 'thisWeekHeader']), `[1c] the exported API (${Object.keys(AS).sort().join(', ')})`);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[2] the union…');
{
  const m = allSportsModel([cfb(), nfl()]);
  const want = [...CFB_GAMES, ...NFL_GAMES].map((x) => x.gameId).sort();
  assert(eq(ids(m.rows).slice().sort(), want) && m.rows.length === 7, `[2a] the combined list is exactly the union of the two sports' games (${ids(m.rows)})`);
  assert(m.rows.every((r) => (r.gameId.startsWith('c') ? r.dbCode === 'cfb' && r.weekId === 'wc6' : r.dbCode === 'nfl' && r.weekId === 'wn6')), '[2b] every row carries ITS sport and ITS week');
  assert(new Set(ids(m.rows)).size === m.rows.length, '[2c] one row per game');
  assert(eq(m.counts, { total: 7, live: 2 }), `[2d] counts are of games: ${JSON.stringify(m.counts)}`);
  const dup = allSportsModel([cfb({ games: [...CFB_GAMES, null, {}, { kickoff: 'x' }] }), nfl()]);
  assert(dup.rows.length === 7, '[2e] rows without a game id and null entries are dropped');
  assert(eq(allSportsModel([cfb()]).rows.map((r) => r.gameId), allSportsModel([cfb()], { mode: 'kickoff' }).rows.map((r) => r.gameId)), '[2f] one sport alone is that sport\'s list in kickoff order');
  assert(allSportsModel(null).rows.length === 0 && allSportsModel([]).rows.length === 0 && allSportsModel([null, undefined, {}]).rows.length === 0, '[2g] junk gives an empty model');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[3] the sort across sports…');
{
  const k = allSportsModel([cfb(), nfl()], { mode: 'kickoff' });
  assert(eq(ids(k.rows), ['c3', 'c1', 'c2', 'n2', 'c4', 'n1', 'n3']), `[3a] Kickoff time: by instant across sports (${ids(k.rows)})`);
  // c2 and n2 share 19:30Z: competition order breaks the tie (CFB before NFL), then game id
  assert(ids(k.rows).indexOf('c2') < ids(k.rows).indexOf('n2'), '[3b] a tie on kickoff goes to competition order (CFB, then NFL)');
  const tie = allSportsModel([nfl({ games: [g('n9', '2026-10-11T17:00:00Z'), g('n1', '2026-10-11T17:00:00Z')] })]);
  assert(eq(ids(tie.rows), ['n1', 'n9']), '[3c] …and then to game id');
  const noTime = allSportsModel([cfb({ games: [g('cx', null), g('cy', '2026-10-10T12:00:00Z'), g('cz', undefined)] })]);
  assert(eq(ids(noTime.rows), ['cy', 'cx', 'cz']), `[3d] games with no kickoff go last (and between themselves by id): ${ids(noTime.rows)}`);
  const live = allSportsModel([cfb(), nfl()], { mode: 'live' });
  assert(eq(ids(live.rows), ['c1', 'n2', 'c2', 'c4', 'n1', 'n3', 'c3']), `[3e] Live first: live games, then upcoming, then final, each by kickoff (${ids(live.rows)})`);
  const custom = allSportsModel([cfb(), nfl()], { mode: 'manual' });
  assert(eq(ids(custom.rows), ids(k.rows)), '[3f] Custom is unavailable in All sports: a saved "manual" sorts as Kickoff time');
  assert(effectiveSortMode('manual') === 'kickoff' && effectiveSortMode('kickoff') === 'kickoff' && effectiveSortMode('live') === 'live' && effectiveSortMode(undefined) === 'kickoff' && effectiveSortMode('bogus') === 'kickoff', '[3g] effectiveSortMode');
  const saved = 'manual';
  effectiveSortMode(saved);
  assert(saved === 'manual', '[3h] the SAVED mode is not touched (the function returns, it never writes: the single-sport views keep Custom)');
  const input = [{ gameId: 'b', kickoffMs: 2, order: 0, status: '' }, { gameId: 'a', kickoffMs: 1, order: 0, status: '' }];
  const copy = input.slice();
  sortAllSportsRows(input, 'kickoff');
  assert(eq(input, copy), '[3i] sorting never mutates its input');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[4] C2 — each row follows its OWN week…');
{
  const m = allSportsModel([cfb({ canSeeOthers: true }), nfl({ canSeeOthers: false })]);
  const blind = m.rows.filter((r) => r.blind).map((r) => r.gameId).sort();
  assert(eq(blind, ['n1', 'n2', 'n3']) && m.rows.filter((r) => !r.blind).every((r) => r.dbCode === 'cfb'), `[4a] CFB Live / NFL Locked: the CFB rows show names, the NFL rows are blind (${blind})`);
  assert(m.blindAny === true, '[4b] the blind note shows when ANY row is blind');
  const flipped = allSportsModel([cfb({ canSeeOthers: false }), nfl({ canSeeOthers: true })]);
  assert(eq(flipped.rows.filter((r) => r.blind).map((r) => r.gameId).sort(), ['c1', 'c2', 'c3', 'c4']), '[4c] reversed: the CFB rows are blind and the NFL rows show — the flag never crosses a sport');
  // a live/final update in one sport (its games' statuses change) changes only its rows
  const before = allSportsModel([cfb({ canSeeOthers: true }), nfl({ canSeeOthers: false })]);
  const after = allSportsModel([cfb({ canSeeOthers: true, games: CFB_GAMES.map((x) => ({ ...x, status: 'final' })) }), nfl({ canSeeOthers: false })]);
  const nflOnly = (mm) => JSON.stringify(mm.rows.filter((r) => r.dbCode === 'nfl'));
  assert(nflOnly(before) === nflOnly(after), '[4d] CFB games finalizing leaves every NFL row byte-identical (state, blindness and order among themselves)');
  assert(allSportsModel([cfb(), nfl()]).blindAny === false, '[4e] both public: no blind note');
  assert(allSportsModel([cfb({ canSeeOthers: undefined }), nfl()]).rows.filter((r) => r.dbCode === 'cfb').every((r) => r.blind), '[4f] an unknown gate is BLIND (fail closed): only `canSeeOthers === true` shows names');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[5] the per-sport gate…');
{
  const m = allSportsModel([cfb(), nfl({ gate: true, canSeeOthers: false })]);
  assert(eq(m.gates.map((x) => x.dbCode), ['nfl']) && m.gates[0].code === 'NFL', '[5a] one gate, for the sport the viewer must submit first');
  assert(m.rows.length === 4 && m.rows.every((r) => r.dbCode === 'cfb'), '[5b] …it replaces THAT sport\'s games only; the other sport\'s games still show');
  assert(m.blindAny === false, '[5c] a gated sport contributes no blind rows (it contributes no rows)');
  const both = allSportsModel([cfb({ gate: true }), nfl({ gate: true })]);
  assert(both.gates.length === 2 && both.rows.length === 0 && eq(both.counts, { total: 0, live: 0 }), '[5d] both gated: two gates, no rows');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[6] hidden weeks…');
{
  const m = allSportsModel([cfb(), nfl({ hidden: true })]);
  assert(m.rows.every((r) => r.dbCode === 'cfb') && m.gates.length === 0 && eq(m.sports.map((s) => s.dbCode), ['cfb']), '[6a] a hidden week (a draft for a member, a demo week for a non-commissioner, no week) contributes no rows, no gate, no header label');
  const none = allSportsModel([cfb({ games: [] }), nfl({ hidden: true })]);
  assert(none.rows.length === 0 && none.counts.total === 0, '[6b] a played sport with an empty slate contributes nothing');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[7] the "This week" header and the note…');
{
  const h = thisWeekHeader([cfb(), nfl()], { span: 'Sat Oct 10 – Mon Oct 12' });
  assert(h.title === 'This week' && h.caption === 'Sat Oct 10 – Mon Oct 12 · CFB Week 6 · NFL Week 6', `[7a] "This week" / "${h.caption}"`);
  assert(thisWeekHeader([cfb(), nfl({ hidden: true })], { span: 'Sat Oct 10' }).caption === 'Sat Oct 10 · CFB Week 6', '[7b] a hidden sport is not named');
  assert(thisWeekHeader([], {}).caption === '' && thisWeekHeader(null).title === 'This week', '[7c] no sports: still "This week", no caption');
  assert(ALL_SPORTS_NOTE === 'Alma Mater Watch and the weekly summary are per sport. Choose CFB or NFL above.', '[7d] the calm note is the approved wording');
  assert(!/\border\b/i.test(ALL_SPORTS_NOTE + h.title + h.caption), '[7e] UN-77: the word "order" appears in none of the strings');
}

console.log('\n' + (fail ? '❌ FAILURES' : '✅ ALL PASS') + ` — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
