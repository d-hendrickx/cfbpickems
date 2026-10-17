/**
 * CFB Pickems — gameordertest.mjs (Deployment 1, Lane B, DI-579 / PF-445, 2026-10-07)
 * ===================================================================================
 * The proof for js/game-order.js (the pure ordering + the preference's shape) and its storage seam (js/storage.js getGameOrderMode & co):
 *
 *   [1] kickoff    — parity with the old Dashboard sort on valid kickoffs; equal kickoffs break on gameId; a missing/garbage kickoff is LAST; total + pure
 *   [2] live-first — live/live-stale first, final last; a game that goes final MOVES, one that goes live moves up; kickoff order inside a rank
 *   [3] manual     — saved order first, a new game follows in kickoff order, a removed id is ignored, STATUS IS IGNORED (a final game does not move)
 *   [4] coercion   — garbage in the preference reads as the default; caps; the six-week prune survives a jsonb key shuffle
 *   [5] the seam   — signed in: per-player, per-week; signed out: reads the default and writes NOTHING; a second player is untouched
 *   [6] purity + where-it-applies pins
 *   [7] MUTATION PROOFS on scratch copies (never the file)
 *
 * Run:  node gameordertest.mjs     (date-free: kickoffs are fixed instants)
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}
const read = (rel) => readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

// ── storage needs a localStorage and a document stub, exactly as hometest's ──
const lsStore = new Map();
globalThis.localStorage = {
  getItem: k => (lsStore.has(k) ? lsStore.get(k) : null), setItem: (k, v) => lsStore.set(k, String(v)),
  removeItem: k => lsStore.delete(k), clear: () => lsStore.clear(),
};
globalThis.document = { addEventListener() {}, removeEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], body: { classList: { add() {}, remove() {} }, dataset: {} }, hidden: false };
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined }; } catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined }, configurable: true }); }
globalThis.matchMedia = () => ({ matches: false });

const GO = await import('./js/game-order.js');
const storage = await import('./js/storage.js');
const SRC = await read('./js/game-order.js');
const { orderGames, kickoffCompare, coerceGameOrder, coerceIds, coerceMode, withManualOrder, GAME_ORDER_MODES, MAX_MANUAL_IDS, MAX_MANUAL_WEEKS } = GO;

const T0 = Date.parse('2026-10-03T16:00:00Z');
const at = (min) => new Date(T0 + min * 60_000).toISOString();
const G = (id, min, extra = {}) => ({ gameId: id, weekId: 'w1', kickoff: min === null ? null : typeof min === 'string' ? min : at(min), status: 'scheduled', ...extra });
const ids = (list) => list.map(g => g.gameId).join(',');
const shuffle = (a, seed) => { const r = a.slice(); let s = seed; for (let i = r.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) & 0x7fffffff; const j = s % (i + 1); [r[i], r[j]] = [r[j], r[i]]; } return r; };

// ═══ [1] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[1] kickoff mode…');
{
  const games = [G('c', 180), G('a', 0), G('d', 360), G('b', 90)];
  assert(ids(orderGames(games, { mode: 'kickoff' })) === 'a,b,c,d', '1a: kickoff ascending');
  const old = games.slice().sort((x, y) => new Date(x.kickoff) - new Date(y.kickoff));
  assert(ids(orderGames(games)) === ids(old) && ids(orderGames(games, { mode: 'nonsense' })) === ids(old), '1b: PARITY — for distinct valid kickoffs it equals the old Dashboard sort exactly, and the default mode / an unknown mode is kickoff');
  assert(ids(orderGames([G('z', 0), G('m', 0), G('a', 0)])) === 'a,m,z', '1c: EQUAL kickoffs break on gameId ascending (deterministic — PF-445 acceptance 1)');
  assert(ids(orderGames([G('x', null), G('b', 10), G('y', 'garbage'), G('a', 5)].map(g => g.gameId === 'y' ? { ...g, kickoff: 'not a date' } : g))) === 'a,b,x,y', '1d: a missing OR unparseable kickoff sorts LAST, then by gameId');
  assert(ids(orderGames([G('b', null), G('a', null)])) === 'a,b', '1e: all-missing kickoffs still order deterministically');
  const input = shuffle(games, 7);
  const before = ids(input);
  const out = orderGames(input);
  assert(ids(input) === before && out !== input, '1f: pure — the input array is not mutated and a new array is returned');
  let same = true;
  for (let s = 1; s <= 25; s++) if (ids(orderGames(shuffle([...games, G('e', 0), G('f', null)], s))) !== ids(orderGames([...games, G('e', 0), G('f', null)]))) same = false;
  assert(same, '1g: total + deterministic — 25 shuffles of the same games give one order');
  assert(orderGames([]).length === 0 && orderGames(null).length === 0 && ids(orderGames([null, undefined, G('a', 1)])) === 'a', '1h: empty, null and junk entries never throw');
  assert(kickoffCompare(G('a', 1), G('a', 1)) === 0 && kickoffCompare(G('a', null), G('b', 1)) > 0 && kickoffCompare(G('a', 1), G('b', null)) < 0, '1i: the comparator contract');
}

// ═══ [2] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[2] live-first mode…');
{
  const phaseOf = (g) => g._p || (g.status === 'live' ? 'live' : g.status === 'final' ? 'final' : 'upcoming');
  const slate = [G('f1', 0, { status: 'final' }), G('l1', 60, { status: 'live' }), G('u1', 120), G('l2', 30, { status: 'live', _p: 'live-stale' }), G('f2', 10, { status: 'final' }), G('u2', 90)];
  assert(ids(orderGames(slate, { mode: 'live-first', phaseOf })) === 'l2,l1,u2,u1,f1,f2', '2a: live and live-stale first (kickoff order), then upcoming, then final LAST');
  const moved = slate.map(g => g.gameId === 'l1' ? { ...g, status: 'final' } : g);
  assert(ids(orderGames(moved, { mode: 'live-first', phaseOf })) === 'l2,u2,u1,f1,f2,l1', '2b: a live game that goes final MOVES to the final group, in kickoff order there');
  const started = slate.map(g => g.gameId === 'u2' ? { ...g, status: 'live' } : g);
  assert(ids(orderGames(started, { mode: 'live-first', phaseOf })).startsWith('l2,l1,u2,'), '2c: an upcoming game that goes live moves up into the live group');
  const nos = [G('n', 5, { _p: 'no-score', status: 'live' }), G('a', 1, { _p: 'awaiting' }), G('f', 0, { status: 'final' })];
  assert(ids(orderGames(nos, { mode: 'live-first', phaseOf })) === 'a,n,f', '2d: awaiting and no-score share the middle rank with upcoming');
  assert(ids(orderGames(slate, { mode: 'live-first' })) === 'l2,l1,u2,u1,f1,f2', '2e: with no phaseOf it falls back to the stored status (live → front, final → end)');
  assert(ids(orderGames(slate, { mode: 'live-first', phaseOf: () => { throw new Error('x'); } })).length > 0, '2f: a throwing phaseOf degrades to the status rule, never throws');
  assert(ids(orderGames([G('b', 0, { status: 'live' }), G('a', 0, { status: 'live' })], { mode: 'live-first' })) === 'a,b', '2g: equal rank + equal kickoff still breaks on gameId');
}

// ═══ [3] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[3] manual mode…');
{
  const slate = [G('a', 0), G('b', 60), G('c', 120), G('d', 180)];
  assert(ids(orderGames(slate, { mode: 'manual', manualIds: ['c', 'a', 'd', 'b'] })) === 'c,a,d,b', '3a: the saved order, exactly');
  assert(ids(orderGames(slate, { mode: 'manual', manualIds: [] })) === 'a,b,c,d', '3b: a week with no saved order behaves as Kickoff');
  const withNew = [...slate, G('n1', 30), G('n2', 15)];
  assert(ids(orderGames(withNew, { mode: 'manual', manualIds: ['c', 'a', 'd', 'b'] })) === 'c,a,d,b,n2,n1', '3c: games NEW to the slate follow the saved ones in kickoff order');
  assert(ids(orderGames(slate, { mode: 'manual', manualIds: ['ghost', 'c', 'gone', 'a'] })) === 'c,a,b,d', '3d: saved ids that no longer exist are ignored');
  assert(ids(orderGames(slate, { mode: 'manual', manualIds: ['c', 'c', 'a', 'c'] })) === 'c,a,b,d', '3e: a duplicate saved id places the game once');
  const phaseOf = (g) => g.status === 'live' ? 'live' : g.status === 'final' ? 'final' : 'upcoming';
  const before = ids(orderGames(slate, { mode: 'manual', manualIds: ['c', 'a', 'd', 'b'], phaseOf }));
  const after = ids(orderGames(slate.map(g => g.gameId === 'c' ? { ...g, status: 'final' } : g.gameId === 'd' ? { ...g, status: 'live' } : g), { mode: 'manual', manualIds: ['c', 'a', 'd', 'b'], phaseOf }));
  assert(before === 'c,a,d,b' && after === before, '3f: acceptance 2 — a live game becoming final (and another going live) does NOT move anything in manual mode');
  assert(orderGames(withNew, { mode: 'manual', manualIds: ['c'] }).length === withNew.length, '3g: total — no game is ever dropped');
  assert(orderGames([G('a', 0), G('a', 5)], { mode: 'manual', manualIds: ['a'] }).length === 2, '3h: even a (broken) duplicate game id loses nobody');
}

// ═══ [4] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[4] coercion at the boundary…');
{
  const D = coerceGameOrder(undefined);
  assert(D.mode === 'kickoff' && Object.keys(D.manual).length === 0 && D.recent.length === 0, '4a: missing = Kickoff, nothing saved (every record in the database)');
  for (const junk of [null, 5, 'x', [], true, { mode: 7, manual: 'no', recent: 'no' }, { manual: [1, 2] }]) {
    const c = coerceGameOrder(junk);
    assert(c.mode === 'kickoff' && Object.keys(c.manual).length === 0, `4b: junk ${JSON.stringify(junk)} reads as the default`);
  }
  assert(GAME_ORDER_MODES.join() === 'kickoff,live-first,manual' && coerceMode('live-first') === 'live-first' && coerceMode('Kickoff') === 'kickoff' && coerceMode(undefined) === 'kickoff', '4c: three modes; an unknown one is kickoff');
  assert(coerceIds(['a', 5, null, '', 'b', 'a', {}]).join() === 'a,b' && coerceIds('abc').length === 0, '4d: ids — strings only, no blanks, no duplicates; a non-array is []');
  assert(coerceIds(Array.from({ length: 80 }, (_, i) => 'g' + i)).length === MAX_MANUAL_IDS && MAX_MANUAL_IDS === 40, '4e: at most 40 ids per week');
  let v = {};
  for (let i = 1; i <= 9; i++) v = withManualOrder(v, 'w' + i, ['g' + i]);
  assert(MAX_MANUAL_WEEKS === 6 && Object.keys(v.manual).sort().join() === 'w4,w5,w6,w7,w8,w9' && v.recent.join() === 'w4,w5,w6,w7,w8,w9', '4f: the SIX most recently written weeks are kept; older ones are pruned on write');
  v = withManualOrder(v, 'w4', ['g4', 'x']);
  assert(v.recent.join() === 'w5,w6,w7,w8,w9,w4', '4g: rewriting a week makes it the most recent');
  const scrambled = JSON.parse(JSON.stringify({ mode: 'manual', manual: Object.fromEntries(Object.entries(v.manual).reverse()), recent: v.recent }));
  assert(coerceGameOrder(scrambled).recent.join() === v.recent.join(), '4h: jsonb does not keep object key order — the recorded `recent` list, not the keys, decides what is pruned');
  const noRecent = coerceGameOrder({ manual: { w3: ['a'], w1: ['b'], w2: ['c'], w9: ['d'], w8: ['e'], w7: ['f'], w6: ['g'] } });
  assert(Object.keys(noRecent.manual).length === 6 && noRecent.recent.length === 6, '4i: a record with no `recent` is pruned deterministically to six');
  assert(withManualOrder(v, 'w9', []).manual.w9 === undefined && !withManualOrder(v, 'w9', []).recent.includes('w9'), '4j: an empty list clears that week');
  assert(withManualOrder(v, '', ['a']).recent.join() === v.recent.join() && withManualOrder(v, 5, ['a']).recent.join() === v.recent.join(), '4k: a bad week id writes nothing');
}

// ═══ [5] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[5] the storage seam…');
{
  const mkPlayer = (id) => ({ playerId: id, displayName: id.toUpperCase(), active: true, preferences: { theme: 'neutral' } });
  storage.savePlayer(mkPlayer('p1')); storage.savePlayer(mkPlayer('p2'));
  // anonymous first
  storage.clearSession();
  const snapAnon = JSON.stringify([...lsStore.entries()]);
  assert(storage.getGameOrderMode() === 'kickoff' && storage.getManualGameOrder('w1').length === 0, '5a: signed out — reads the default');
  assert(storage.setGameOrderMode('manual') === false && storage.setManualGameOrder('w1', ['a']) === false && storage.clearManualGameOrder('w1') === false, '5b: signed out — every write is refused');
  assert(JSON.stringify([...lsStore.entries()]) === snapAnon, '5c: signed out — NOTHING was written (UN-127: a shared device never carries one visitor\'s choice to the next)');
  storage.setSession('p1', false, true);
  assert(storage.getGameOrderMode() === 'kickoff', '5d: a record written before this release reads as Kickoff');
  assert(storage.setGameOrderMode('live-first') === true && storage.getGameOrderMode() === 'live-first', '5e: the mode round-trips');
  assert(storage.setGameOrderMode('chaos') === true && storage.getGameOrderMode() === 'kickoff', '5f: a bad mode is coerced to Kickoff on write, not stored');
  storage.setGameOrderMode('manual');
  assert(storage.setManualGameOrder('w1', ['b', 'a', 5, 'b']) === true && storage.getManualGameOrder('w1').join() === 'b,a', '5g: the manual order is stored per week, coerced');
  storage.setManualGameOrder('w2', ['z']);
  assert(storage.getManualGameOrder('w2').join() === 'z' && storage.getManualGameOrder('w1').join() === 'b,a' && storage.getManualGameOrder('w3').length === 0, '5h: weeks are independent (the order is competition-scoped by construction: a week belongs to one competition)');
  assert(storage.getGameOrderMode() === 'manual', '5i: arranging a week does not change the mode');
  storage.clearManualGameOrder('w1');
  assert(storage.getManualGameOrder('w1').length === 0 && storage.getManualGameOrder('w2').join() === 'z', '5j: clearing one week leaves the others');
  const rec = storage.getPlayer('p1');
  assert(rec.preferences.theme === 'neutral' && rec.preferences.gameOrder && rec.preferences.gameOrder.mode === 'manual', '5k: the preference lives on the PLAYER RECORD beside the others, which are untouched');
  for (let i = 1; i <= 9; i++) storage.setManualGameOrder('wk' + i, ['g']);
  assert(Object.keys(storage.getPlayer('p1').preferences.gameOrder.manual).length === MAX_MANUAL_WEEKS, '5l: the six-week prune is applied on write');
  storage.setSession('p2', false, true);
  assert(storage.getGameOrderMode() === 'kickoff' && storage.getManualGameOrder('wk9').length === 0, '5m: a second player on the same device reads their OWN (default) order');
  const settingsKeys = [...lsStore.keys()].filter(k => /settings/i.test(k));
  assert(settingsKeys.every(k => !/gameOrder/.test(lsStore.get(k))), '5n: nothing was written to the league-shared settings blob');
}

// ═══ [6] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[6] Purity and where it applies…');
{
  const code = stripComments(SRC);
  assert(!/^\s*import\s/m.test(code) && !/\b(localStorage|document\.|window\.|fetch\(|Date\.now|Math\.random)/.test(code), '6a: a pure leaf — no imports, storage, DOM, clock or randomness');
  assert(!/\.at\(|Object\.hasOwn\(/.test(code), '6b: iOS 15.0 safe');
  assert(/IT DOES NOT APPLY TO[^.]*Picks page/.test(SRC) && /Alma Mater Watch/.test(SRC), '6c: the header states, for the next surface, where the order does NOT apply (the Picks page, chat pills, CSV, notifications, Alma Mater Watch, SCRIBE)');
  const st = await read('./js/storage.js');
  assert(/_playerPref\('gameOrder'\)/.test(st) && !/settings\.gameOrder|getSettings\(\)\.gameOrder/.test(st), '6d: storage reads the preference from the player record only');
}

// ═══ [7] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[7] MUTATION PROOFS — scratch copies loaded as data: URLs (never the file)…');
{
  const load = async (src) => import('data:text/javascript;base64,' + Buffer.from(src).toString('base64') + '#' + Math.random());
  const probe = (m) => {
    const slate = [G('a', 0), G('b', 60), G('c', 120)];
    const phaseOf = (g) => g.status === 'live' ? 'live' : g.status === 'final' ? 'final' : 'upcoming';
    const liveSlate = [G('f', 0, { status: 'final' }), G('l', 60, { status: 'live' }), G('u', 30)];
    let v = {}; for (let i = 1; i <= 8; i++) v = m.withManualOrder(v, 'w' + i, ['g']);
    return {
      kickoff: m.orderGames(slate, { mode: 'kickoff' }).map(g => g.gameId).join() === 'a,b,c',
      tieBreak: m.orderGames([G('z', 0), G('a', 0)]).map(g => g.gameId).join() === 'a,z',
      missingLast: m.orderGames([G('x', null), G('a', 1)]).map(g => g.gameId).join() === 'a,x',
      liveFirst: m.orderGames(liveSlate, { mode: 'live-first', phaseOf }).map(g => g.gameId).join() === 'l,u,f',
      manualSaved: m.orderGames(slate, { mode: 'manual', manualIds: ['c', 'a'] }).map(g => g.gameId).join() === 'c,a,b',
      manualIgnoresStatus: m.orderGames(slate.map(g => g.gameId === 'c' ? { ...g, status: 'final' } : g), { mode: 'manual', manualIds: ['c', 'a', 'b'], phaseOf }).map(g => g.gameId).join() === 'c,a,b',
      pure: (() => { const x = [G('b', 5), G('a', 1)]; m.orderGames(x); return x[0].gameId === 'b'; })(),
      sixWeeks: Object.keys(v.manual).length === 6,
      modeCoerced: m.coerceMode('zzz') === 'kickoff',
      idsClean: m.coerceIds(['a', 5, 'a']).join() === 'a',
    };
  };
  const base = probe(GO);
  assert(Object.values(base).every(Boolean), '7-0: the probe is GREEN on the real module (positive control)');
  const R = (a, b) => SRC.replace(a, b);
  const mutants = [
    ['the kickoff sort is reversed', R('return ka - kb;', 'return kb - ka;'), 'kickoff'],
    ['no gameId tie-break', R('return ia < ib ? -1 : ia > ib ? 1 : 0;', 'return 0;'), 'tieBreak'],
    ['a missing kickoff sorts FIRST', R('if (ka === null) return 1;\n    if (kb === null) return -1;', 'if (ka === null) return -1;\n    if (kb === null) return 1;'), 'missingLast'],
    ['live-first ranks final before upcoming', R("if (phase === 'final') return 2;", "if (phase === 'final') return 0;"), 'liveFirst'],
    ['manual ignores the saved order', R('for (const id of saved) { const g = byId.get(id);', 'for (const id of []) { const g = byId.get(id);'), 'manualSaved'],
    ['manual mode obeys status (finals sink)', R("    return first.concat(byKickoff.filter(g => !placed.has(g)));", "    return first.concat(byKickoff.filter(g => !placed.has(g))).sort((a, b) => (statusRank(a, phaseOf) - statusRank(b, phaseOf)));"), 'manualIgnoresStatus'],
    ['orderGames mutates its input', R('const m = coerceMode(mode);', 'games.sort(kickoffCompare); const m = coerceMode(mode);'), 'pure'],
    ['the prune keeps every week', R('while (recent.length > MAX_MANUAL_WEEKS)', 'while (false)'), 'sixWeeks'],
    ['an unknown mode is stored as given', R('return GAME_ORDER_MODES.includes(m) ? m : \'kickoff\'', 'return m'), 'modeCoerced'],
    ['duplicate ids survive coercion', R('if (typeof x !== \'string\' || x === \'\' || seen.has(x)) continue;', 'if (typeof x !== \'string\' || x === \'\') continue;'), 'idsClean'],
  ];
  for (const [name, src, check] of mutants) {
    let res;
    try { res = probe(await load(src)); } catch (e) { res = { [check]: false }; }
    assert(src !== SRC && res[check] === false, `7: mutant "${name}" turns ${check} RED`);
  }
}

console.log(`\n══════════════════════════════════════════════════\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
