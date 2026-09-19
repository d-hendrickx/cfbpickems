/**
 * CFB Pickems — demoscopetest.mjs
 * ===============================
 * The Demo-Simulation panel's DESTRUCTIVE paths, scoped away from real weeks.
 *
 * Run:  node demoscopetest.mjs
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Reported (fb_1788048433261_z3aak, v0.17.7): the commissioner opened Week 1 —
 * a REAL week — clicked "↩ Reset All Scheduled" in the Demo Simulation panel,
 * and it wiped every score and result off the week. "BIG problem."
 *
 * Root cause: the Demo Simulation panel's handlers act on whatever week the
 * commissioner panel is currently showing (`week` in bindCommEventListeners),
 * with NO check that a destructive edit is appropriate for that week. A panel
 * labelled "Demo Simulation" could therefore delete real scores+results in one
 * misclick — the single worst failure class in this project (data loss).
 *
 * WHAT IS AND ISN'T GATED (and why the gate is not uniform)
 * --------------------------------------------------------
 * There are THREE distinct policies, because the surfaces have three different
 * jobs:
 *
 *   1. Pure reset buttons — demo-set-scheduled, demo-reset-all-scheduled.
 *      No entry purpose; their only job is to wipe a game back to scheduled.
 *      → DEMO-ONLY (demoResetAllowed()). Refused on manual AND on the feeds.
 *
 *   2. The batch grid — demo-batch-apply.
 *      This is ALSO the weekly score-ENTRY workflow (gradetest.mjs drives it end
 *      to end on a `manual` week, including §1g which legitimately resets a row
 *      to scheduled). It cannot be demo-only without breaking hand-entry. But it
 *      must never WIPE a real ESPN-graded game, which is what the report was.
 *      → Its DESTRUCTIVE path (demote a graded game to scheduled, or null a
 *        score/winner/cover that already exists) is refused on the FEED modes
 *        (espn_live / espn_historical). Entry (live/final WITH scores) always
 *        works. Demo and manual weeks keep the reset ability.
 *
 *   3. demo-batch-randomize — invents scores to pressure-test the dashboard.
 *      No legitimate real-week purpose at all.
 *      → DEMO-ONLY (demoResetAllowed()).
 *
 * On a real ESPN week the correct reset is the Data tab's "🗑 Clear Current
 * Week Data" (reset-week-btn) — confirmed, scoped, intentional.
 *
 * WHAT THIS FILE ASSERTS
 * ----------------------
 * Behaviour and PERSISTED STATE — firing the real button through the real
 * bindCommEventListeners() path, then reading the games back through the seam —
 * plus ONE deliberately-labelled SEMANTIC structural assertion [§6] that no
 * demo handler which CAN demote a game to scheduled or null a score (via ANY
 * syntax — object literal, ternary, or variable) ships without a gate. That is
 * the deny-by-default guard over the whole class; a future destructive handler
 * inherits it whether or not anyone remembers to write a behavioural test.
 */

import { readFile } from 'node:fs/promises';

// ═════════════════════════════════════════════════════════════════════════════
// DOM / localStorage stubs — same shape as gradetest.mjs: elements registered
// by id, remembering their listeners so a test can fire them.
// ═════════════════════════════════════════════════════════════════════════════
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};

const registry = new Map();
const selectorSets = new Map();

function makeEl(id) {
  const listeners = new Map();
  const e = {
    id,
    value: '', checked: false, textContent: '', innerHTML: '', className: '',
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener() {},
    appendChild() {}, removeChild() {}, remove() {}, focus() {}, scrollTo() {},
    insertAdjacentHTML() {},
    querySelector: sel => bySelector(sel),
    querySelectorAll: sel => selectorSets.get(sel) || [],
    closest: () => null,
    _fire(type, ev = {}) {
      const fns = listeners.get(type) || [];
      if (!fns.length) throw new Error(`demoscopetest: nothing bound to '${type}' on #${id}`);
      for (const fn of fns) fn({ target: e, ...ev });
    },
    _bound: type => (listeners.get(type) || []).length > 0,
  };
  return e;
}
function el(id) {
  if (!registry.has(id)) registry.set(id, makeEl(id));
  return registry.get(id);
}
function bySelector(sel) {
  if (typeof sel === 'string' && sel.startsWith('#')) return registry.get(sel.slice(1)) || null;
  const set = selectorSets.get(sel);
  return set && set.length ? set[0] : null;
}
function resetDom() { registry.clear(); selectorSets.clear(); }

globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: id => registry.get(id) || null,
  querySelector: sel => bySelector(sel),
  querySelectorAll: sel => selectorSets.get(sel) || [],
  createElement: () => makeEl('__detached__'),
  body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '' },
  hidden: false,
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined, clipboard: { writeText: async () => {} } }, configurable: true }); }
globalThis.requestAnimationFrame = fn => fn();
globalThis.fetch = async () => { throw new Error('network disabled in demoscopetest'); };
globalThis.matchMedia = () => ({ matches: false });
globalThis.confirm = () => true;
globalThis.prompt = () => null;
globalThis.alert = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

const app = await import('./js/app.js');
const storage = await import('./js/storage.js');
const { bindCommEventListeners } = app;
const { saveGame, getGame, getGames, saveWeek, getSettings } = storage;

console.log('[demoscopetest] app.js imported —', Object.keys(app).length, 'exports');

// ── Fixture helpers ──────────────────────────────────────────────────────────
const WEEK = (mode) => ({
  weekId: 'ds_w1', weekNumber: 1, label: 'Week 1', season: 2026,
  status: 'final', dataSourceMode: mode,
  picksOpenAt: null, picksLockAt: null, lockedAt: null, finalizedAt: null,
  actualTiebreakerValue: null, tiebreakerFinalized: false,
  blurb: '', recap: '', groupId: null, isGroupTiebreaker: false,
});

const GAME = (o = {}) => ({
  gameId: 'ds_g1', weekId: 'ds_w1',
  homeTeam: 'HOME', awayTeam: 'AWAY', homeMascot: '', awayMascot: '',
  homeConference: '', awayConference: '', homeRank: null, awayRank: null,
  kickoff: '2026-09-05T17:00:00Z', kickoffConfirmed: true, timeWindow: 'afternoon',
  spread: -7, favorite: 'HOME', lockedSpread: -7,
  homeScore: 31, awayScore: 17,
  status: 'final', actualWinner: 'HOME', atsWinner: 'HOME',
  isAlmaMaterGame: false, multiplier: 1, isManual: false,
  dataSource: 'manual', dataQuality: 'manual', spreadSource: 'manual',
  ...o,
});

/** Seed a week + games through the seam, read the games back. */
function seed(mode, games) {
  localStorage.clear();
  saveWeek(WEEK(mode));
  for (const g of games) saveGame(g);
  return getGames('ds_w1');
}
function bind(mode, games) {
  bindCommEventListeners(WEEK(mode), games, [], [], getSettings(), [WEEK(mode)]);
}
/** A game that carries real final scores + a graded result. */
function realResults() {
  return [
    GAME({ gameId: 'ds_g1', homeScore: 31, awayScore: 17, actualWinner: 'HOME', atsWinner: 'HOME' }),
    GAME({ gameId: 'ds_g2', homeTeam: 'H2', awayTeam: 'A2', homeScore: 20, awayScore: 24, actualWinner: 'A2', atsWinner: 'A2', spread: -3, lockedSpread: -3 }),
  ];
}
/** A single mutable stub <tr> for the batch grid. Cells persist so a test can
 *  read their .value back AFTER a handler (e.g. randomize) has written to them. */
function batchRow(gameId, { home, away, status }) {
  const cells = {
    '.batch-home-score': { value: String(home) },
    '.batch-away-score': { value: String(away) },
    '.batch-status': { value: String(status) },
  };
  return {
    dataset: { gameId },
    _cells: cells,
    querySelector: sel => cells[sel] || null,
    querySelectorAll: () => [],
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. THE REPRODUCTION — "↩ Reset All Scheduled" on a REAL week must be a no-op.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[1] demo-reset-all-scheduled on a REAL (espn_live) week…');
{
  resetDom();
  const games = seed('espn_live', realResults());
  el('demo-reset-all-scheduled');
  bind('espn_live', games);
  el('demo-reset-all-scheduled')._fire('click');

  const g1 = getGame('ds_g1'), g2 = getGame('ds_g2');
  assert(g1.homeScore === 31 && g1.awayScore === 17, 'real week: game 1 scores are PRESERVED, not nulled');
  assert(g1.actualWinner === 'HOME' && g1.atsWinner === 'HOME', 'real week: game 1 result/cover is PRESERVED');
  assert(g1.status === 'final', 'real week: game 1 status stays final (not demoted to scheduled)');
  assert(g2.homeScore === 20 && g2.awayScore === 24, 'real week: game 2 scores are PRESERVED');
  assert(g2.atsWinner === 'A2', 'real week: game 2 cover is PRESERVED');
}

// ═════════════════════════════════════════════════════════════════════════════
// 2. THE OTHER RESET — single-game "↩ Reset Scheduled" on a real week: no-op.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[2] demo-set-scheduled on a REAL (manual) week…');
{
  resetDom();
  const games = seed('manual', realResults());
  el('demo-game-select').value = 'ds_g1';
  el('demo-set-scheduled');
  bind('manual', games);
  el('demo-set-scheduled')._fire('click');

  const g1 = getGame('ds_g1');
  assert(g1.homeScore === 31 && g1.awayScore === 17, 'real week: single-game reset is refused — scores preserved');
  assert(g1.status === 'final', 'real week: single-game reset is refused — status preserved');
}

// ═════════════════════════════════════════════════════════════════════════════
// 3a. POSITIVE CONTROL — the reset MUST still work on an actual DEMO week.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[3a] demo-reset-all-scheduled on a DEMO week still wipes…');
{
  resetDom();
  const games = seed('demo', realResults());
  el('demo-reset-all-scheduled');
  bind('demo', games);
  el('demo-reset-all-scheduled')._fire('click');

  const g1 = getGame('ds_g1'), g2 = getGame('ds_g2');
  assert(g1.homeScore === null && g1.awayScore === null, 'demo week: reset nulls the scores (guard does not block demo use)');
  assert(g1.status === 'scheduled' && g1.atsWinner === null, 'demo week: reset returns the game to scheduled and clears the cover');
  assert(g2.homeScore === null && g2.status === 'scheduled', 'demo week: reset applies to every game');
}

// ═════════════════════════════════════════════════════════════════════════════
// 3b. NO OVER-REACH — score ENTRY (batch apply) must STILL work on a real week.
//     gradetest.mjs proves this is the weekly workflow on a `manual` week; here
//     we prove the SAME entry works on a `manual` week through this file's stubs.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[3b] demo-batch-apply (score entry) on a REAL (manual) week still writes…');
{
  resetDom();
  const scheduled = [GAME({ gameId: 'ds_g1', status: 'scheduled', homeScore: null, awayScore: null, actualWinner: null, atsWinner: null })];
  const games = seed('manual', scheduled);
  el('demo-batch-apply');
  selectorSets.set('.batch-grid tbody tr', [batchRow('ds_g1', { home: '31', away: '17', status: 'final' })]);
  bind('manual', games);
  el('demo-batch-apply')._fire('click');

  const g1 = getGame('ds_g1');
  assert(g1.status === 'final' && g1.homeScore === 31 && g1.awayScore === 17,
    'real week: score entry via batch grid is NOT blocked — scores written');
  assert(g1.atsWinner === 'HOME', 'real week: batch entry still grades the cover (workflow intact)');
}

// ═════════════════════════════════════════════════════════════════════════════
// 4. FINDING 1 — demo-batch-apply must not WIPE a real ESPN-graded game.
//    Two shapes reported: (a) a row demoted to scheduled with blank scores nulls
//    everything; (b) a row flipped off 'final' auto-promotes to 'live' and nulls
//    actualWinner/atsWinner even though the scores stay. Both are refused whole
//    on a feed week, and nothing is written.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[4a] demo-batch-apply demotion (→scheduled, blank scores) on espn_live is refused…');
{
  resetDom();
  const games = seed('espn_live', [GAME({ gameId: 'ds_g1' })]); // final 31-17, HOME/HOME
  el('demo-batch-apply');
  selectorSets.set('.batch-grid tbody tr', [batchRow('ds_g1', { home: '', away: '', status: 'scheduled' })]);
  bind('espn_live', games);
  el('demo-batch-apply')._fire('click');

  const g1 = getGame('ds_g1');
  assert(g1.status === 'final', 'espn_live: refused — final game not demoted to scheduled');
  assert(g1.homeScore === 31 && g1.awayScore === 17, 'espn_live: refused — scores preserved');
  assert(g1.actualWinner === 'HOME' && g1.atsWinner === 'HOME', 'espn_live: refused — result/cover preserved');
}
console.log('\n[4b] demo-batch-apply result-wipe (→live, scores kept) on espn_live is refused…');
{
  resetDom();
  const games = seed('espn_live', [GAME({ gameId: 'ds_g1' })]); // final 31-17, HOME/HOME
  el('demo-batch-apply');
  // scores present but status forced off 'final' → auto-promotes to 'live', which
  // in the ungated code nulls actualWinner + atsWinner while keeping the scores.
  selectorSets.set('.batch-grid tbody tr', [batchRow('ds_g1', { home: '31', away: '17', status: 'scheduled' })]);
  bind('espn_live', games);
  el('demo-batch-apply')._fire('click');

  const g1 = getGame('ds_g1');
  assert(g1.status === 'final', 'espn_live: refused — final result not knocked down to live');
  assert(g1.actualWinner === 'HOME' && g1.atsWinner === 'HOME',
    'espn_live: refused — actualWinner/atsWinner NOT nulled behind preserved scores');
}
console.log('\n[4c] POSITIVE — demo-batch-apply score ENTRY on espn_live still works…');
{
  resetDom();
  // A genuinely scheduled ESPN game the commissioner is entering a final score for.
  const games = seed('espn_live', [GAME({ gameId: 'ds_g1', status: 'scheduled', homeScore: null, awayScore: null, actualWinner: null, atsWinner: null })]);
  el('demo-batch-apply');
  selectorSets.set('.batch-grid tbody tr', [batchRow('ds_g1', { home: '31', away: '17', status: 'final' })]);
  bind('espn_live', games);
  el('demo-batch-apply')._fire('click');

  const g1 = getGame('ds_g1');
  assert(g1.status === 'final' && g1.homeScore === 31 && g1.awayScore === 17,
    'espn_live: entry (fills scores, no existing data destroyed) is NOT blocked');
  assert(g1.atsWinner === 'HOME', 'espn_live: entry still grades the cover');
}
console.log('\n[4d] POSITIVE — demo-batch-apply CORRECTING a real ESPN score still works…');
{
  resetDom();
  // A finalized ESPN game whose score was wrong; commissioner corrects 31→30.
  // No field is nulled and the game stays final, so this is a correction, not a
  // wipe — it must go through.
  const games = seed('espn_live', [GAME({ gameId: 'ds_g1' })]); // final 31-17
  el('demo-batch-apply');
  selectorSets.set('.batch-grid tbody tr', [batchRow('ds_g1', { home: '30', away: '17', status: 'final' })]);
  bind('espn_live', games);
  el('demo-batch-apply')._fire('click');

  const g1 = getGame('ds_g1');
  assert(g1.homeScore === 30, 'espn_live: correcting an existing final score is NOT blocked (no wipe)');
  assert(g1.status === 'final' && g1.actualWinner === 'HOME', 'espn_live: correction keeps the game graded');
}

// ═════════════════════════════════════════════════════════════════════════════
// 5. FINDING 1 (cont.) — demo-batch-randomize has no real-week purpose.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[5a] demo-batch-randomize on a REAL (espn_live) week is refused (grid untouched)…');
{
  resetDom();
  const games = seed('espn_live', [GAME({ gameId: 'ds_g1' })]);
  const row = batchRow('ds_g1', { home: '31', away: '17', status: 'final' });
  el('demo-batch-randomize');
  selectorSets.set('.batch-grid tbody tr', [row]);
  bind('espn_live', games);
  el('demo-batch-randomize')._fire('click');

  assert(row._cells['.batch-home-score'].value === '31' && row._cells['.batch-away-score'].value === '17',
    'espn_live: randomize refused — grid inputs not overwritten with random scores');
  const g1 = getGame('ds_g1');
  assert(g1.homeScore === 31 && g1.awayScore === 17 && g1.atsWinner === 'HOME',
    'espn_live: randomize touched nothing on the stored game');
}
console.log('\n[5b] POSITIVE — demo-batch-randomize on a DEMO week still fills the grid…');
{
  resetDom();
  const games = seed('demo', [GAME({ gameId: 'ds_g1', status: 'scheduled', homeScore: null, awayScore: null })]);
  const row = batchRow('ds_g1', { home: '', away: '', status: 'scheduled' });
  el('demo-batch-randomize');
  selectorSets.set('.batch-grid tbody tr', [row]);
  bind('demo', games);
  el('demo-batch-randomize')._fire('click');

  assert(row._cells['.batch-status'].value === 'final',
    'demo week: randomize bumps the row status to final (guard does not block demo use)');
  const hv = Number(row._cells['.batch-home-score'].value);
  assert(Number.isInteger(hv) && hv >= 0 && hv <= 41,
    'demo week: randomize wrote a plausible score into the grid');
}

// ═════════════════════════════════════════════════════════════════════════════
// 6. SEMANTIC / DENY-BY-DEFAULT — no demo handler that CAN demote a game to
//    scheduled or null a score ships without a gate. Unlike the retired scan
//    (which shape-matched `status: 'scheduled'` + `homeScore: null` object
//    literals and stayed green for ternary/variable nullers and for the live
//    demo-batch-apply), this walks each demo click handler's real body — brace-
//    matched, comments stripped — and classifies it by what its code can DO:
//
//      destructive  ⇔  it can assign status = 'scheduled'  (any syntax), OR
//                       it can write null into homeScore or awayScore (any
//                       syntax: literal, ternary branch, or via a local).
//
//    Every destructive handler must be gated — call demoResetAllowed(), or
//    consult week.dataSourceMode and return before writing.
//
//    NOTE on the field set. The RUNTIME guard (batchRowWipesData) also protects
//    actualWinner/atsWinner, because at runtime it can compare against the game
//    on file and only refuses a null that destroys an EXISTING value. Statically
//    that comparison is impossible, and actualWinner/atsWinner are ALSO nulled
//    legitimately by grading (a tie, a missing line, a cleared spread — see
//    gradetest §3), so a null of those two is not a reliable static reset
//    signal. Every real reset path also nulls a score or sets scheduled, so
//    keying the static trigger on homeScore/awayScore + scheduled catches the
//    whole class without falsely flagging the legit entry handlers. The canaries
//    below prove both edges: an ungated ternary nuller trips it; the legit entry
//    handler (which nulls only a computed actualWinner) does not.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[6] semantic: every demo handler that can demote/null a score is gated…');
{
  const src = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');

  // Strip comments so prose describing the rule can never trip the scan.
  const strip = s => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');

  /** Return the balanced { … } block starting at `openIdx` (the '{'), skipping
   *  string, template (with ${…}) and comment content so their braces don't
   *  miscount. */
  function extractBlock(source, openIdx) {
    let depth = 0, sq = false, dq = false, tpl = false, line = false, block = false;
    const tplStack = [];
    for (let i = openIdx; i < source.length; i++) {
      const c = source[i], n = source[i + 1];
      if (line)  { if (c === '\n') line = false; continue; }
      if (block) { if (c === '*' && n === '/') { block = false; i++; } continue; }
      if (sq)    { if (c === '\\') i++; else if (c === "'") sq = false; continue; }
      if (dq)    { if (c === '\\') i++; else if (c === '"') dq = false; continue; }
      if (tpl) {
        if (c === '\\') { i++; continue; }
        if (c === '`') { tpl = false; continue; }
        if (c === '$' && n === '{') { depth++; tplStack.push(depth); tpl = false; i++; continue; }
        continue;
      }
      if (c === '/' && n === '/') { line = true; i++; continue; }
      if (c === '/' && n === '*') { block = true; i++; continue; }
      if (c === "'") { sq = true; continue; }
      if (c === '"') { dq = true; continue; }
      if (c === '`') { tpl = true; continue; }
      if (c === '{') { depth++; continue; }
      if (c === '}') {
        if (tplStack.length && tplStack[tplStack.length - 1] === depth) {
          tplStack.pop(); depth--; tpl = true; continue;
        }
        depth--;
        if (depth === 0) return source.slice(openIdx, i + 1);
      }
    }
    return source.slice(openIdx);
  }

  /** Map of demo-<id> → stripped handler body, one per bound click handler. */
  function demoHandlerBodies(source) {
    const out = new Map();
    const re = /getElementById\('(demo-[\w-]+)'\)\s*\??\s*\.addEventListener\(\s*'click'\s*,\s*(?:async\s*)?\(\s*\)\s*=>\s*\{/g;
    let m;
    while ((m = re.exec(source)) !== null) {
      const braceIdx = m.index + m[0].length - 1; // index of the opening '{'
      out.set(m[1], strip(extractBlock(source, braceIdx)));
    }
    return out;
  }

  const IDENT = /^[A-Za-z_$][\w$]*$/;
  // Every RHS assigned to a property/var named `name` (`:` or `=`, not `==`/`===`).
  const rhsList = (body, name) =>
    [...body.matchAll(new RegExp(String.raw`\b${name}\s*[:=](?!=)\s*([^,;\n]*)`, 'g'))].map(m => m[1].trim());
  // Every RHS bound to a bare local named `ident`.
  const bindingsOf = (body, ident) =>
    [...body.matchAll(new RegExp(String.raw`(?:^|[^.\w$])(?:const\s+|let\s+|var\s+)?${ident}\s*=(?!=)\s*([^,;\n]*)`, 'gm'))].map(m => m[1].trim());

  /** Can an RHS satisfy `test`, following ONE level of local indirection? */
  function rhsCanBe(body, rhs, test, depth = 0) {
    if (test(rhs)) return true;
    if (IDENT.test(rhs) && depth < 1) return bindingsOf(body, rhs).some(b => rhsCanBe(body, b, test, depth + 1));
    return false;
  }
  const isNull      = r => /\bnull\b/.test(r);
  const isScheduled = r => /'scheduled'/.test(r);
  const canNull     = (body, field) => rhsList(body, field).some(r => rhsCanBe(body, r, isNull));
  const canSchedule = body => rhsList(body, 'status').some(r => rhsCanBe(body, r, isScheduled));
  const isDestructive = body => canSchedule(body) || canNull(body, 'homeScore') || canNull(body, 'awayScore');
  // A gate is a week-mode consultation that returns before the destructive write
  // can land. Stated as an ALLOW-list of the sanctioned guard vocabulary (like
  // gradetest §6 allow-lists calculateAtsWinner): demoResetAllowed() is the
  // demo-only reset guard; weekIsEspnFeed() is the feed-mode guard the batch grid
  // uses; a raw dataSourceMode comparison covers any inline refusal. Each must be
  // followed by a `return`. A new destructive handler that skips all three reads
  // as ungated and trips the scan — which is the whole point.
  const isGated = body =>
    /\b(?:demoResetAllowed|weekIsEspnFeed)\s*\([\s\S]*?\breturn\b/.test(body) ||
    /dataSourceMode[\s\S]*?\breturn\b/.test(body);

  const bodies = demoHandlerBodies(src);
  assert(bodies.size >= 6, `found the demo click handlers to classify (found ${bodies.size}, expected >= 6)`);

  let destructiveCount = 0;
  for (const [id, body] of bodies) {
    if (!isDestructive(body)) continue;
    destructiveCount++;
    assert(isGated(body), `demo handler #${id} can demote/null a score → it is gated`);
  }
  assert(destructiveCount >= 3,
    `semantic scan found the destructive demo handlers (set-scheduled, reset-all-scheduled, batch-apply) — found ${destructiveCount}, expected >= 3`);

  // ── SELF-CHECK / MUTATION EVIDENCE ─────────────────────────────────────────
  // Prove the scan is SEMANTIC, not a shape match. It must go RED against an
  // ungated destructive handler written in the exact styles the old scan missed
  // (ternary and variable), and GREEN once that same handler is gated — while
  // NOT falsely flagging a legitimate score-ENTRY handler.

  // (a) An ungated TERNARY nuller — the shape a reviewer injected that the old
  //     `homeScore:\s*null` scan let through. Destructive, and NOT gated.
  const CANARY_TERNARY_UNGATED = strip(`
    const gid = demoGameSel?.value; if (!gid) return;
    const g = getGame(gid); if (!g) return;
    const wipe = true;
    saveGame({ ...g,
      status: wipe ? 'scheduled' : g.status,
      homeScore: wipe ? null : g.homeScore,
      awayScore: wipe ? null : g.awayScore });
  `);
  assert(isDestructive(CANARY_TERNARY_UNGATED) && !isGated(CANARY_TERNARY_UNGATED),
    'canary: an UNGATED ternary-style demote+null handler is caught (destructive & not gated → scan would BLOCK it)');

  // (b) An ungated VARIABLE nuller — the value routed through a local first,
  //     invisible to any "homeScore: null" text match. Destructive, not gated.
  const CANARY_VAR_UNGATED = strip(`
    const g = getGame(gid); if (!g) return;
    const hv = cond ? null : hs;
    const st = 'scheduled';
    saveGame({ ...g, status: st, homeScore: hv, awayScore: hv });
  `);
  assert(isDestructive(CANARY_VAR_UNGATED) && !isGated(CANARY_VAR_UNGATED),
    'canary: an UNGATED variable-style demote+null handler is caught (indirection does not hide it)');

  // (c) The SAME ternary handler, now GATED with demoResetAllowed(): still
  //     destructive, but gated → allowed.
  const CANARY_TERNARY_GATED = strip(`
    if (!demoResetAllowed()) return;
    const g = getGame(gid); if (!g) return;
    saveGame({ ...g, status: 'scheduled', homeScore: null, awayScore: null });
  `);
  assert(isDestructive(CANARY_TERNARY_GATED) && isGated(CANARY_TERNARY_GATED),
    'canary: gating the destructive handler (demoResetAllowed) flips it to allowed — scan goes GREEN');

  // (d) The batch-apply style gate — a dataSourceMode check that returns before
  //     writing — is recognised as a gate too.
  const CANARY_MODE_GATED = strip(`
    const espnFeed = week.dataSourceMode === 'espn_live';
    if (espnFeed && planned.some(x => x)) { showToast('no'); return; }
    saveGame({ ...g, homeScore: cond ? null : hs });
  `);
  assert(isDestructive(CANARY_MODE_GATED) && isGated(CANARY_MODE_GATED),
    'canary: an inline dataSourceMode refusal that returns before writing counts as a gate');

  // (e) A legitimate score-ENTRY handler must NOT be flagged. It nulls only a
  //     computed actualWinner (a tie) and fills scores from inputs — no score
  //     null, no scheduled — so it is not in the reset class and needs no gate.
  const CANARY_ENTRY_OK = strip(`
    const g = getGame(gid); if (!g) return;
    const hs = parseInt(homeInput) || 0;
    const as_ = parseInt(awayInput) || 0;
    let actualWinner = null;
    if (hs > as_) actualWinner = g.homeTeam; else if (as_ > hs) actualWinner = g.awayTeam;
    saveGame({ ...g, status: 'final', homeScore: hs, awayScore: as_, actualWinner });
  `);
  assert(!isDestructive(CANARY_ENTRY_OK),
    'canary: a legitimate score-ENTRY handler (fills scores, nulls only a computed tie) is NOT flagged — no false positive');
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n[demoscopetest] ${pass} passed, ${fail} failed`);
// REVIEWER F3 (seventh gate, 2026-09-17) — FLUSH BEFORE EXITING.
// `process.exit()` does not drain stdout/stderr, and both are ASYNCHRONOUS
// whenever they are a pipe — which is what they are under loadtest.mjs's
// spawnSync() and under every `| grep` a human runs. So the one summary line a
// parent suite parses can be dropped from a run that really did finish, and a
// FAILING run whose line never arrives reads as a harness problem instead. The
// nested empty writes' callbacks fire only once every earlier write on that
// stream has reached the OS; BOTH streams are drained because loadtest.mjs
// parses `stdout + stderr`. Same fix as authtest.mjs/boottest.mjs, applied
// without changing one character of what is printed.
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail ? 1 : 0)));

// ── SECURITY F-6 (eighth gate, 2026-09-18) — THE FLUSH SHIM NEEDS ITS OWN
//    BACKSTOP ─────────────────────────────────────────────────────────────────
// The write-then-exit-in-the-callback shim above (reviewer F-3, seventh gate)
// fixed a dropped summary line by making the exit wait for the bytes. That trade
// bought correctness with a new failure mode: if the callback NEVER fires, the
// process never exits. It does not fire when the reader at the other end of the
// pipe has gone away mid-write, when stdout is a full pipe nobody is draining,
// or when an imported module has wedged the event loop — and loadtest.mjs runs
// every one of these suites through spawnSync(), which has no timeout and would
// simply hang the whole sweep with no output to say which suite did it.
//
// So the exit is armed twice. The callback is still the fast path and still the
// one that runs on every healthy run; this timer only ever fires if that path
// did not. .unref() is what keeps it honest — an unref'd timer does not hold the
// event loop open on its own account, so it cannot delay a natural exit by five
// seconds or resurrect a process that was ready to leave. It just makes "hang
// forever" impossible.
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
