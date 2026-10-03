/**
 * CFB Pickems — almaprototest.mjs
 * ===============================
 * SB-12 (Social Platform thread, security finding SF-1 from the SP-54 design
 * review, 2026-09-30) — a self-edited alma mater named after an
 * `Object.prototype` member broke every alma-mater surface for the whole league.
 *
 * Run:  node almaprototest.mjs
 * Also: TZ=UTC node almaprototest.mjs && TZ=America/Los_Angeles node almaprototest.mjs
 *
 * THE DEFECT
 * ----------
 * `getAlmaMaterMatch()` (js/data-model.js) looked its two precision tables up
 * with bare bracket probes on the CLAIMED school string:
 *
 *     const excludes = ALMA_MATER_EXCLUDE_PATTERNS[alma] || [];
 *     const patterns = new Set([...(ALMA_MATER_EXACT_PATTERNS[alma] || []), alma]);
 *
 * Both tables are plain object literals, so a bracket probe answers for every
 * key on `Object.prototype` too. `ALMA_MATER_EXCLUDE_PATTERNS['constructor']` is
 * the `Object` function (truthy — the `|| []` never fires) and
 * `excludes.some` is not a function: TypeError. `__proto__` returns
 * `Object.prototype` itself; `toString`, `hasOwnProperty`, `valueOf` and the
 * rest return inherited methods. All of them throw on the first line; the
 * second line throws independently (a function / `Object.prototype` is not
 * iterable).
 *
 * `players.alma_mater` is SELF-EDITABLE (0002_rls.sql — the self-edit column
 * list) and its only CHECK is `length(alma_mater) <= 80` (0001_schema.sql), so
 * ANY member can set the value on his own row. Every alma consumer walks the
 * WHOLE claimed roster through this matcher for every team on the slate, so
 * one member's value throws for EVERYONE: Alma Mater Watch, Alma Mater
 * Rankings, the claim-save ripple (`recomputeAlmaMaterFlags()`), the ⭐ flag at
 * ESPN parse time, the manual Game Modal save, the tiebreaker Auto-Calc
 * (`calculateAlmaMaterTotal()` via `almaMatersForAutoCalc()`), and the live
 * alma call-out (`almaMaterPlayersForTeam()`, on BOTH the client and the
 * scribe-autonomous Edge Function, which imports data-model.js directly). The
 * week's LOCK freezes the value into `lockedAlmaMaters` (client and server), so
 * a LOCKED/LIVE/FINAL week keeps throwing even after the member changes it
 * back — and the upcoming SP-54 snapshot would freeze it a second time.
 *
 * A second, quieter instance of the same class sat one layer up:
 * `renderAlmaMaterRankings()` (js/app.js) printed
 * `ALMA_MATER_DISPLAY[alma] || alma`, which for `constructor` renders the text
 * "function Object() { [native code] }" and for `__proto__` "[object Object]".
 *
 * THE GUARD
 * ---------
 * ONE helper, `ownGet(obj, key)` in js/data-model.js — an own-property read
 * through `Object.prototype.hasOwnProperty.call`. NOT `Object.hasOwn`: the iOS
 * deployment target is 15.0 and `Object.hasOwn` needs Safari 15.4 (SP-54 design
 * ruling). Every school-keyed table read on a claimed (user-controlled) value
 * goes through it.
 *
 * WHAT A PROTOTYPE-NAMED CLAIM SHOULD DO
 * --------------------------------------
 * Exactly what any other non-catalog school does (getAlmaMaterMatch()'s
 * docstring, "PRECISION TRADEOFF"): no pattern data, no exclusions, the key
 * itself as its only word-boundary pattern. It matches a team literally named
 * that, matches nothing else, and never disturbs the other claims in the list.
 *
 * SECTIONS
 *   1  The fixture names — the five SF-1 names, plus every other own property
 *      of Object.prototype (a fixed list would only cover the names someone
 *      thought of)
 *   2  ownGet() — the helper's own contract
 *   3  getAlmaMaterMatch() — never throws, every other claim still resolves,
 *      exclusions still apply, the prototype-named claim behaves as an ordinary
 *      non-catalog school
 *   4  Alma Mater Watch — renderAlmaMaterWatch() renders, BYE row shows the
 *      claim verbatim
 *   5  Alma Mater Rankings — renderAlmaMaterRankings() renders the claim
 *      verbatim, never an inherited Object member's text
 *   6  The claim-save ripple — recomputeAlmaMaterFlags()
 *   7  Auto-Calc on the LIVE roster (OPEN week)
 *   8  Auto-Calc on a FROZEN locked roster — applyWeekStatusChange('locked')
 *      snapshots the bad value; the snapshot is then Object.freeze()d the way
 *      SP-54's snapshot will be, and read through almaMatersForAutoCalc()
 *   9  almaMaterPlayersForTeam() over the frozen locked roster (the live alma
 *      call-out, client chat-ui.js and the scribe-autonomous verifier)
 *  10  Source guards — no bare bracket probe left on the alma tables; the
 *      helper does not use Object.hasOwn
 *
 * FIXTURE DISCIPLINE: every "does not throw" is paired with a positive check
 * that the same call produced the real, non-vacuous answer. Every call that
 * could throw is wrapped, so a regression shows as ❌ with the error message,
 * never as a crashed run with no count. No git checkout/restore/stash anywhere.
 */

import { readFile } from 'node:fs/promises';

// ── DOM / localStorage stubs (almatest.mjs shape, trimmed to what app.js's
//    module body and the render functions under test touch) ──
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};
function makeEl(id) {
  return {
    id, value: '', checked: false, textContent: '', innerHTML: '', className: '',
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, removeEventListener() {},
    appendChild() {}, removeChild() {}, remove() {}, focus() {}, scrollTo() {}, click() {},
    insertAdjacentHTML() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
  };
}
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => makeEl('__el__'),
  body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '', dataset: {} },
  hidden: false,
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined, clipboard: { writeText: async () => {} } }, configurable: true }); }
globalThis.requestAnimationFrame = fn => fn();
globalThis.matchMedia = () => ({ matches: false });
globalThis.confirm = () => true;
globalThis.prompt = () => null;
globalThis.alert = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };
globalThis.fetch = async () => { throw new Error('network disabled in almaprototest'); };

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}
/** Run `fn`; a throw becomes `{ ok:false, err }` so the assertion reports it instead of killing the run. */
function attempt(fn) {
  try { return { ok: true, value: fn() }; }
  catch (err) { return { ok: false, err }; }
}
const why = r => (r.ok ? '' : ` — threw ${r.err?.constructor?.name}: ${r.err?.message}`);

const dm = await import('./js/data-model.js');
const storage = await import('./js/storage.js');
const scoring = await import('./js/scoring.js');
const app = await import('./js/app.js');

const { getAlmaMaterMatch, almaMaterPlayersForTeam, WEEK_STATUS, GAME_STATUS } = dm;
const { calculateAlmaMaterTotal } = scoring;
const {
  claimedAlmaMaters, recomputeAlmaMaterFlags, almaMatersForAutoCalc,
  renderAlmaMaterWatch, renderAlmaMaterRankings, applyWeekStatusChange,
} = app;

// What an inherited Object member's text looks like when it leaks into a render.
const LEAK_MARKERS = ['[native code]', '[object Object]', 'function '];
const leaks = html => LEAK_MARKERS.filter(m => String(html).includes(m));

function freshWeek(o = {}) {
  return {
    weekId: 'pw1', weekNumber: 1, label: 'Week 1', season: 2026,
    status: 'open', dataSourceMode: 'espn_historical',
    picksOpenAt: null, picksLockAt: null, lockedAt: null, finalizedAt: null,
    actualTiebreakerValue: null, tiebreakerFinalized: false,
    tiebreakerCalculationMode: 'selectedSlateOnly',
    blurb: '', recap: '', groupId: null, isGroupTiebreaker: false,
    ...o,
  };
}
let _gid = 0;
function freshGame(o = {}) {
  _gid++;
  return {
    gameId: `pg${_gid}`, weekId: 'pw1',
    homeTeam: 'Home', awayTeam: 'Away', homeMascot: '', awayMascot: '',
    homeConference: '', awayConference: '', homeRank: null, awayRank: null,
    kickoff: '2026-09-08T18:00:00Z', kickoffConfirmed: true, timeWindow: 'afternoon',
    spread: null, favorite: null, lockedSpread: null,
    homeScore: null, awayScore: null,
    status: 'scheduled', actualWinner: null, atsWinner: null,
    isAlmaMaterGame: false, nationalTV: false, broadcastNetwork: null, marqueeEvent: false,
    multiplier: 1, isManual: false, neutralSite: false,
    dataSource: 'espn_historical', dataQuality: 'confirmed', spreadSource: 'espn',
    espnEventId: null,
    ...o,
  };
}
let _pid = 0;
function freshPlayer(o = {}) {
  _pid++;
  return {
    playerId: `pp${_pid}`, displayName: `Player${_pid}`, initials: `P${_pid}`,
    email: '', active: true, almaMater: '', pinHash: '',
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    ...o,
  };
}
/** The full source of a function, by brace matching (almatest.mjs fnBodySrc). */
function fnBodySrc(src, decl) {
  const start = src.indexOf(decl);
  if (start < 0) return '';
  let depth = 0;
  for (let i = src.indexOf('{', start); i >= 0 && i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  return '';
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[1] The fixture names — the five SF-1 names plus every other Object.prototype member…');
const SF1_NAMES = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'];
const PROTO_NAMES = Object.getOwnPropertyNames(Object.prototype);
{
  assert(SF1_NAMES.every(n => PROTO_NAMES.includes(n)),
    `fixture check: all five SF-1 names are genuinely own properties of Object.prototype in this engine (${PROTO_NAMES.length} names total)`);
  assert(PROTO_NAMES.length >= 10,
    `fixture check: the full list is wider than the five SF-1 names (got ${PROTO_NAMES.length}: ${PROTO_NAMES.join(', ')})`);
  assert(PROTO_NAMES.every(n => n.length <= 80),
    'fixture check: every name passes the 0001_schema.sql CHECK (length(alma_mater) <= 80) — each is a value a member can actually store');
  // The table really does answer for these keys — the precondition the defect needs.
  assert(dm.ALMA_MATER_EXCLUDE_PATTERNS.constructor === Object,
    'fixture check: a bare probe ALMA_MATER_EXCLUDE_PATTERNS["constructor"] answers with the inherited Object function — the precondition this suite guards against is real');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[2] ownGet(obj, key) — the one own-property helper…');
{
  const ownGet = dm.ownGet;
  assert(typeof ownGet === 'function', 'data-model.js exports ownGet(obj, key)');
  const call = (...a) => attempt(() => ownGet(...a));
  const table = { Oklahoma: ['Oklahoma State'], Zero: 0, Empty: '' };

  const own = call(table, 'Oklahoma');
  assert(own.ok && Array.isArray(own.value) && own.value[0] === 'Oklahoma State',
    `an OWN key returns its value${why(own)}`);
  const zero = call(table, 'Zero');
  assert(zero.ok && zero.value === 0, `an own FALSY value (0) comes back as itself, not as undefined${why(zero)}`);
  const missing = call(table, 'Texas');
  assert(missing.ok && missing.value === undefined, `a missing key returns undefined${why(missing)}`);

  const inheritedHits = PROTO_NAMES.filter(n => { const r = call(table, n); return !r.ok || r.value !== undefined; });
  assert(inheritedHits.length === 0,
    `EVERY inherited Object.prototype name returns undefined, never the inherited member (${PROTO_NAMES.length} names; leaked: ${inheritedHits.join(', ') || 'none'})`);

  const nul = call(null, 'x');
  const und = call(undefined, 'x');
  assert(nul.ok && nul.value === undefined && und.ok && und.value === undefined,
    `a null/undefined table returns undefined rather than throwing${why(nul)}${why(und)}`);

  // An own key that SHADOWS a prototype name is still an own key — the helper
  // is a membership test, not a deny-list of names.
  const shadow = call({ constructor: 'mine' }, 'constructor');
  assert(shadow.ok && shadow.value === 'mine',
    `an OWN property named like a prototype member is returned (membership, not a name deny-list)${why(shadow)}`);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[3] getAlmaMaterMatch() — a prototype-named claim is an ordinary non-catalog school…');
{
  // The bad claim is placed FIRST so the substring loop reaches it before any
  // real claim can return early — the order a real roster can have.
  const failures = [];
  for (const name of PROTO_NAMES) {
    const list = [name, 'Oklahoma', 'Arkansas', 'Clemson'];
    const checks = [
      ['Temple', null],                 // unrelated team: reaches EVERY entry, returns null
      ['Oklahoma Sooners', 'Oklahoma'], // catalog school via its exact pattern — after the bad entry
      ['Oklahoma State', null],         // exclusion list still applied for a catalog sibling
      ['Arkansas State', null],         // and for a second catalog school
      ['Arkansas', 'Arkansas'],         // exact-first
      ['Clemson Tigers', 'Clemson'],    // non-catalog key-itself fallback still works after the bad entry
    ];
    for (const [team, want] of checks) {
      const r = attempt(() => getAlmaMaterMatch(team, list));
      if (!r.ok || r.value !== want) failures.push(`${name} / "${team}" → ${r.ok ? JSON.stringify(r.value) : 'threw ' + r.err.message} (want ${JSON.stringify(want)})`);
    }
  }
  assert(failures.length === 0,
    `no Object.prototype name in the claimed list throws or disturbs any other claim (${PROTO_NAMES.length} names × 6 teams)${failures.length ? '\n      ' + failures.slice(0, 8).join('\n      ') + (failures.length > 8 ? `\n      … +${failures.length - 8} more` : '') : ''}`);

  for (const name of SF1_NAMES) {
    const r = attempt(() => getAlmaMaterMatch('Temple', [name]));
    assert(r.ok && r.value === null, `SF-1 "${name}" as the ONLY claim: an unrelated team returns null${why(r)}`);
  }

  // The prototype-named claim behaves exactly like any other non-catalog
  // school: a team literally carrying that name matches it, by exact-first
  // AND by the word-boundary key-itself fallback.
  const exact = attempt(() => getAlmaMaterMatch('constructor', ['Oklahoma', 'constructor']));
  assert(exact.ok && exact.value === 'constructor', `a team literally named "constructor" resolves to that claim via exact-first${why(exact)}`);
  const word = attempt(() => getAlmaMaterMatch('Constructor Tech', ['Oklahoma', 'constructor']));
  assert(word.ok && word.value === 'constructor', `…and via the word-boundary key-itself fallback ("Constructor Tech")${why(word)}`);
  const noInherit = attempt(() => getAlmaMaterMatch('function Object', ['constructor']));
  assert(noInherit.ok && noInherit.value === null,
    `the claim inherits NO pattern data from the prototype member it is named after${why(noInherit)}`);

  // Positive control: the catalog behaviour is unchanged by the guard.
  const ctl = attempt(() => [getAlmaMaterMatch('USC Trojans', ['USC']), getAlmaMaterMatch('USC Upstate', ['USC']), getAlmaMaterMatch('Miami (OH)', ['Miami'])]);
  assert(ctl.ok && ctl.value[0] === 'USC' && ctl.value[1] === null && ctl.value[2] === null,
    `positive control: catalog precision unchanged — USC Trojans→USC, USC Upstate→null, Miami (OH)→null for a "Miami" claim${why(ctl)}`);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[4] Alma Mater Watch — renders for the whole league with a prototype-named claim on the roster…');
for (const name of SF1_NAMES) {
  localStorage.clear();
  storage.saveWeek(freshWeek({ weekId: 'watch_w' }));
  storage.saveGame(freshGame({ weekId: 'watch_w', homeTeam: 'Oklahoma', awayTeam: 'Temple', homeRank: 10 }));
  storage.saveGame(freshGame({ weekId: 'watch_w', homeTeam: 'Utah', awayTeam: 'Missouri' }));
  storage.addPlayer(freshPlayer({ playerId: 'w_bad', displayName: 'Mallory', almaMater: name }));
  storage.addPlayer(freshPlayer({ playerId: 'w_ok', displayName: 'Kevin', almaMater: 'Oklahoma' }));

  const r = attempt(() => renderAlmaMaterWatch('watch_w'));
  assert(r.ok, `"${name}": renderAlmaMaterWatch() does not throw${why(r)}`);
  if (r.ok) {
    const html = r.value;
    assert((html.match(/alma-watch-row/g) || []).length === 2 && html.includes('Oklahoma') && html.includes('Temple'),
      `"${name}": both rows render and the real claim (Oklahoma vs Temple) is still on the card (not vacuous)`);
    assert(html.includes(name) && html.includes('BYE'),
      `"${name}": the prototype-named claim renders as its own verbatim BYE row`);
    assert(leaks(html).length === 0, `"${name}": no inherited Object member's text leaks into the card (${leaks(html).join(', ') || 'clean'})`);
  } else {
    assert(false, `"${name}": both rows render (skipped — the render threw)`);
    assert(false, `"${name}": verbatim BYE row (skipped — the render threw)`);
    assert(false, `"${name}": no leaked text (skipped — the render threw)`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[5] Alma Mater Rankings — the school column is the claim, never an inherited Object member…');
for (const name of SF1_NAMES) {
  localStorage.clear();
  storage.saveWeek(freshWeek({ weekId: 'rank_w' }));
  storage.saveGame(freshGame({ weekId: 'rank_w', homeTeam: 'Oklahoma', awayTeam: 'Temple', homeRank: 10 }));
  storage.addPlayer(freshPlayer({ playerId: 'r_bad', displayName: 'Mallory', almaMater: name }));
  storage.addPlayer(freshPlayer({ playerId: 'r_ok', displayName: 'Kevin', almaMater: 'Oklahoma' }));

  const r = attempt(() => renderAlmaMaterRankings());
  assert(r.ok, `"${name}": renderAlmaMaterRankings() does not throw${why(r)}`);
  if (r.ok) {
    const html = r.value;
    assert(html.includes('#10 AP') && html.includes('Oklahoma (Sooners)'),
      `"${name}": the real claim still renders with its catalog display name and AP rank (not vacuous)`);
    const schoolCells = [...html.matchAll(/<span class="alma-rank-school">([^<]*)<\/span>/g)].map(m => m[1]);
    assert(schoolCells.includes(name),
      `"${name}": the school column shows the claim verbatim (cells: ${JSON.stringify(schoolCells)})`);
    assert(leaks(html).length === 0, `"${name}": no inherited Object member's text in the rankings (${leaks(html).join(', ') || 'clean'})`);
  } else {
    assert(false, `"${name}": real claim renders (skipped — the render threw)`);
    assert(false, `"${name}": verbatim school column (skipped — the render threw)`);
    assert(false, `"${name}": no leaked text (skipped — the render threw)`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[6] The claim-save ripple — recomputeAlmaMaterFlags() over the live roster…');
for (const name of SF1_NAMES) {
  localStorage.clear();
  storage.saveWeek(freshWeek({ weekId: 'rip_w', status: WEEK_STATUS.OPEN }));
  storage.saveGame(freshGame({ gameId: 'rip_ok', weekId: 'rip_w', homeTeam: 'Oklahoma', awayTeam: 'Temple', isAlmaMaterGame: false }));
  storage.saveGame(freshGame({ gameId: 'rip_no', weekId: 'rip_w', homeTeam: 'Utah', awayTeam: 'Missouri', isAlmaMaterGame: true }));
  storage.addPlayer(freshPlayer({ almaMater: name }));
  storage.addPlayer(freshPlayer({ almaMater: 'Oklahoma' }));

  const r = attempt(() => recomputeAlmaMaterFlags(claimedAlmaMaters()));
  assert(r.ok && r.value === 2, `"${name}": the ripple completes and flips exactly the 2 stale flags (got ${r.ok ? r.value : 'n/a'})${why(r)}`);
  assert(storage.getGame('rip_ok').isAlmaMaterGame === true && storage.getGame('rip_no').isAlmaMaterGame === false,
    `"${name}": Oklahoma–Temple is now ⭐, Utah–Missouri is not (not vacuous)`);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[7] Auto-Calc on the LIVE roster (OPEN week) — the expression app.js and week-wizard.js run…');
for (const name of SF1_NAMES) {
  localStorage.clear();
  const week = freshWeek({ weekId: 'ac_w', status: WEEK_STATUS.OPEN });
  storage.saveWeek(week);
  storage.saveGame(freshGame({ weekId: 'ac_w', homeTeam: 'Oklahoma', awayTeam: 'Temple', isAlmaMaterGame: true, status: GAME_STATUS.FINAL, homeScore: 28, awayScore: 3 }));
  storage.saveGame(freshGame({ weekId: 'ac_w', homeTeam: 'Utah', awayTeam: 'Missouri', status: GAME_STATUS.FINAL, homeScore: 17, awayScore: 14 }));
  storage.addPlayer(freshPlayer({ almaMater: name }));
  storage.addPlayer(freshPlayer({ almaMater: 'Oklahoma' }));

  const r = attempt(() => calculateAlmaMaterTotal(storage.getGames('ac_w'), almaMatersForAutoCalc(week), week.tiebreakerCalculationMode));
  assert(r.ok && r.value === 28, `"${name}": Auto-Calc returns Oklahoma's 28 — not a throw, not polluted by the bad claim (got ${r.ok ? r.value : 'n/a'})${why(r)}`);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[8] Auto-Calc on a FROZEN locked roster — the value survives LOCK and must still not throw…');
for (const name of SF1_NAMES) {
  localStorage.clear();
  const open = freshWeek({ weekId: 'lk_w', status: WEEK_STATUS.OPEN });
  storage.saveWeek(open);
  storage.saveGame(freshGame({ weekId: 'lk_w', homeTeam: 'Temple', awayTeam: 'Oklahoma', isAlmaMaterGame: true, status: GAME_STATUS.FINAL, homeScore: 3, awayScore: 31 }));
  storage.addPlayer(freshPlayer({ playerId: 'lk_bad', almaMater: name }));
  storage.addPlayer(freshPlayer({ playerId: 'lk_ok', almaMater: 'Oklahoma' }));

  const lockR = attempt(() => applyWeekStatusChange(open, 'locked'));
  assert(lockR.ok && Array.isArray(lockR.value?.lockedAlmaMaters) && lockR.value.lockedAlmaMaters.includes(name),
    `"${name}": fixture check — the manual LOCK genuinely freezes the bad claim into lockedAlmaMaters${why(lockR)}`);

  // The member edits his claim back AFTER lock; the frozen roster still holds it.
  storage.savePlayer({ ...storage.getPlayer('lk_bad'), almaMater: 'Texas A&M' });
  const locked = storage.getWeek('lk_w');
  // SP-54's snapshot will be immutable; freeze this one the same way.
  const frozenWeek = { ...locked, lockedAlmaMaters: Object.freeze([...(locked.lockedAlmaMaters || [])]) };
  assert(Object.isFrozen(frozenWeek.lockedAlmaMaters) && frozenWeek.lockedAlmaMaters.includes(name) && !claimedAlmaMaters().includes(name),
    `"${name}": fixture check — the frozen snapshot still holds the value after the live claim changed back`);

  const r = attempt(() => calculateAlmaMaterTotal(storage.getGames('lk_w'), almaMatersForAutoCalc(frozenWeek), frozenWeek.tiebreakerCalculationMode));
  assert(r.ok && r.value === 31, `"${name}": Auto-Calc over the FROZEN roster returns Oklahoma's 31 (got ${r.ok ? r.value : 'n/a'})${why(r)}`);
  const asFinal = { ...frozenWeek, status: WEEK_STATUS.FINAL };
  const rf = attempt(() => calculateAlmaMaterTotal(storage.getGames('lk_w'), almaMatersForAutoCalc(asFinal), 'allAlmaMaterGames'));
  assert(rf.ok && rf.value === 31, `"${name}": …and on the same week once FINAL, in allAlmaMaterGames mode (got ${rf.ok ? rf.value : 'n/a'})${why(rf)}`);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[9] almaMaterPlayersForTeam() over a frozen locked roster — the live alma call-out (client + Edge Function)…');
{
  const players = [
    { playerId: 'm1', active: true, almaMater: 'Oklahoma' },
    { playerId: 'm2', active: true, almaMater: 'constructor' },
  ];
  for (const name of SF1_NAMES) {
    const frozen = Object.freeze([name, 'Oklahoma']);
    const hit = attempt(() => almaMaterPlayersForTeam(players, 'Oklahoma', frozen));
    assert(hit.ok && hit.value.length === 1 && hit.value[0].playerId === 'm1',
      `"${name}" frozen ahead of Oklahoma: the Oklahoma claimant is still found (not vacuous)${why(hit)}`);
    const miss = attempt(() => almaMaterPlayersForTeam(players, 'Temple', frozen));
    assert(miss.ok && Array.isArray(miss.value) && miss.value.length === 0,
      `"${name}" frozen: an unclaimed team returns [] rather than throwing${why(miss)}`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[10] Source guards — no bare bracket probe on a claimed key; the helper avoids Object.hasOwn…');
{
  const dmSrc = await readFile(new URL('./js/data-model.js', import.meta.url), 'utf8');
  const appSrc = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');

  const matchBody = fnBodySrc(dmSrc, 'export function getAlmaMaterMatch(');
  assert(matchBody.endsWith('}') && matchBody.includes('wordAwareIncludes'), 'fixture check: getAlmaMaterMatch() body located by brace matching');
  const bareMatch = matchBody.match(/ALMA_MATER_[A-Z_]+\s*\[/g) || [];
  assert(bareMatch.length === 0, `getAlmaMaterMatch() reads its pattern tables only through ownGet(), never a bare bracket probe (found: ${bareMatch.join(', ') || 'none'})`);
  assert((matchBody.match(/ownGet\(\s*ALMA_MATER_(EXCLUDE|EXACT)_PATTERNS\s*,/g) || []).length === 2,
    'getAlmaMaterMatch() routes BOTH tables (exclude + exact) through ownGet()');

  const rankBody = fnBodySrc(appSrc, 'export function renderAlmaMaterRankings(');
  assert(rankBody.endsWith('}') && rankBody.includes('alma-rank-row'), 'fixture check: renderAlmaMaterRankings() body located by brace matching');
  assert(!/ALMA_MATER_DISPLAY\s*\[/.test(rankBody) && /ownGet\(\s*ALMA_MATER_DISPLAY\s*,/.test(rankBody),
    'renderAlmaMaterRankings() reads ALMA_MATER_DISPLAY through ownGet(), never a bare bracket probe on the claim');

  const helperBody = fnBodySrc(dmSrc, 'export function ownGet(');
  assert(helperBody.endsWith('}'), 'fixture check: ownGet() body located');
  assert(helperBody.includes('Object.prototype.hasOwnProperty.call('), 'ownGet() uses Object.prototype.hasOwnProperty.call');
  assert(!/Object\.hasOwn\s*\(/.test(helperBody), 'ownGet() does NOT use Object.hasOwn (iOS 15.0 target; Object.hasOwn needs Safari 15.4 — SP-54 ruling)');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[11] A NON-STRING element in a frozen locked roster is skipped, never thrown on (reviewer finding 2, SC-K1)…');
{
  // `weeks.locked_alma_maters` is untyped jsonb and `almaMatersForAutoCalc()`
  // hands it to the matcher as-is. getAlmaMaterMatch()'s exact-first loop has
  // always skipped non-strings; its substring loop did not, and threw at
  // `needle.toLowerCase` — or, for an array that coerces to a catalog key
  // (['Oklahoma'] → "Oklahoma"), returned the ARRAY as the matched school.
  // Every JSON value type is covered; `undefined` too, for in-memory callers.
  const JUNK = [42, 3.5, 0, null, undefined, true, false, {}, { school: 'Oklahoma' }, ['Oklahoma'], []];
  const failures = [];
  for (const junk of JUNK) {
    const list = [junk, 'Oklahoma'];   // junk FIRST, so the substring loop reaches it
    for (const [team, want] of [['Temple', null], ['Oklahoma Sooners', 'Oklahoma'], ['Oklahoma State', null]]) {
      const r = attempt(() => getAlmaMaterMatch(team, list));
      if (!r.ok || r.value !== want) failures.push(`${JSON.stringify(junk) ?? 'undefined'} / "${team}" → ${r.ok ? JSON.stringify(r.value) : 'threw ' + r.err.message} (want ${JSON.stringify(want)})`);
    }
  }
  assert(failures.length === 0,
    `no JSON value type in the list throws or disturbs the real claim (${JUNK.length} values × 3 teams)${failures.length ? '\n      ' + failures.slice(0, 8).join('\n      ') + (failures.length > 8 ? `\n      … +${failures.length - 8} more` : '') : ''}`);

  const coerced = attempt(() => getAlmaMaterMatch('Oklahoma Sooners', [['Oklahoma']]));
  assert(coerced.ok && coerced.value === null,
    `an array that coerces to a catalog key (["Oklahoma"]) is NOT a claim — the match is null, not the array (got ${coerced.ok ? JSON.stringify(coerced.value) : 'n/a'})${why(coerced)}`);

  // The real path: a LOCKED week whose frozen jsonb roster carries junk, read
  // through almaMatersForAutoCalc() into the Auto-Calc.
  localStorage.clear();
  storage.saveWeek(freshWeek({ weekId: 'junk_w', status: WEEK_STATUS.LOCKED }));
  storage.saveGame(freshGame({ weekId: 'junk_w', homeTeam: 'Temple', awayTeam: 'Oklahoma', isAlmaMaterGame: true, status: GAME_STATUS.FINAL, homeScore: 3, awayScore: 31 }));
  const junkWeek = { ...storage.getWeek('junk_w'), lockedAlmaMaters: Object.freeze([42, null, {}, ['Oklahoma'], 'Oklahoma']) };
  const ac = attempt(() => calculateAlmaMaterTotal(storage.getGames('junk_w'), almaMatersForAutoCalc(junkWeek), junkWeek.tiebreakerCalculationMode));
  assert(ac.ok && ac.value === 31, `Auto-Calc over a frozen roster with junk elements returns Oklahoma's 31 (got ${ac.ok ? ac.value : 'n/a'})${why(ac)}`);

  // Positive control: almaMaterPlayersForTeam() already filtered to strings.
  const cl = attempt(() => almaMaterPlayersForTeam([{ playerId: 'j1', active: true, almaMater: 'Oklahoma' }], 'Oklahoma', Object.freeze([42, null, 'Oklahoma'])));
  assert(cl.ok && cl.value.length === 1, `control: almaMaterPlayersForTeam() over the same junk still finds the Oklahoma claimant${why(cl)}`);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[12] Tree-wide: no bare bracket probe on the alma pattern tables anywhere in js/ or supabase/functions/…');
{
  // [10] scans two function bodies. This scans every .js/.mjs file under both
  // roots, so a NEW consumer (a second matcher, the SP-54 snapshot builder, an
  // Edge Function helper) cannot reintroduce `TABLE[claim]` outside them. Raw
  // text, comments included, ON PURPOSE: no comment-stripper to get wrong, and
  // prose can describe the bug without spelling the literal form.
  const { readdir } = await import('node:fs/promises');
  const BARE_PROBE = /ALMA_MATER_(EXACT|EXCLUDE)_PATTERNS\s*\[/;
  const scanText = (text) => text.split('\n').flatMap((l, i) => (BARE_PROBE.test(l) ? [{ line: i + 1, text: l.trim() }] : []));

  // Canary: the scanner reports what it exists to report (both tables, spaced form).
  const canary = scanText('ok\nconst a = ALMA_MATER_EXCLUDE_PATTERNS[alma];\nconst b = ALMA_MATER_EXACT_PATTERNS [x];\nownGet(ALMA_MATER_EXACT_PATTERNS, x)');
  assert(canary.length === 2 && canary[0].line === 2 && canary[1].line === 3,
    `canary: the scanner flags a bare probe on EITHER table (spaced form too) and passes the ownGet() form (got ${JSON.stringify(canary)})`);

  const ROOTS = ['js', 'supabase/functions'];
  const files = [];
  for (const root of ROOTS) {
    const rootUrl = new URL(`./${root}/`, import.meta.url);
    for (const rel of await readdir(rootUrl, { recursive: true })) {
      if (/\.(m?js)$/.test(rel)) files.push(`${root}/${rel}`);
    }
  }
  assert(files.includes('js/data-model.js') && files.includes('js/app.js') && files.includes('supabase/functions/_shared/scribe-evidence.mjs') && files.length >= 50,
    `fixture check: the walk reached both roots, nested directories included (${files.length} files; data-model.js, app.js, _shared/scribe-evidence.mjs present)`);

  const hits = [];
  for (const f of files) {
    for (const h of scanText(await readFile(new URL(`./${f}`, import.meta.url), 'utf8'))) hits.push({ file: f, ...h });
  }
  assert(hits.length === 0,
    `no file under js/ or supabase/functions/ reads ALMA_MATER_EXACT_PATTERNS / ALMA_MATER_EXCLUDE_PATTERNS with a bare bracket — use ownGet() (offenders: ${JSON.stringify(hits.slice(0, 5))})`);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════════════');
// Summary lines match loadtest.mjs [73d]'s shape in BOTH states:
//   /(✅ ALL PASS|❌ \d+ FAILED) — (\d+) passed, (\d+) failed/
if (fail === 0) console.log(`✅ ALL PASS — ${pass} passed, ${fail} failed`);
else { console.log(`❌ ${fail} FAILED — ${pass} passed, ${fail} failed`); process.exitCode = 1; }
// app.js's module body can start timers; flush, then exit (almatest.mjs discipline).
process.stdout.write('', () => process.exit(fail === 0 ? 0 : 1));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
