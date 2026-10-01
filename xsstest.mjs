/**
 * CFB Pickems — xsstest.mjs
 * ==========================
 * XSS-HARDEN (triage item 21, 2026-09-12). Two reported defects, both in
 * js/app.js, both the same shape: a value that reaches an innerHTML sink
 * without passing through escHtml() or a numeric coercion.
 *
 *   (1) showToast(msg) assigned `t.innerHTML = msg` with no escaping. Every
 *       one of its 200+ call sites was therefore an HTML sink, including the
 *       ones that interpolate a team name from ESPN, a player displayName, a
 *       backend error string, or a week label.
 *
 *   (2) game.homeScore / game.awayScore (and game.homeRank / game.awayRank)
 *       interpolated raw into template strings at the render boundary. They
 *       are numbers when ESPN or the game modal writes them, but they travel
 *       through the synced games blob, and saveGame() has no allow-list or
 *       coercion — whatever shape a bad import or a hand-edited Sheet cell
 *       puts in the blob is what the renderer prints.
 *
 * WHY THE SCORE FIX IS A COERCION AND NOT escHtml(): escHtml() begins
 * `if(!s) return ''`, so escHtml(0) is the EMPTY STRING. A "just wrap it in
 * escHtml" fix would silently blank every 0 on the board — a 0–0 game, a
 * shutout, a scoreless first quarter. [2d] and [5c] below are the guards that
 * make that mistake fail loudly instead of shipping.
 *
 * Run:  node xsstest.mjs
 * Also: for tz in UTC America/Los_Angeles; do TZ=$tz node xsstest.mjs; done
 *
 * Standalone by design (precedent: headermetatest.mjs / feedbackexporttest.mjs
 * / livestatustest.mjs) — loadtest.mjs is not edited by this work.
 */

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// ── DOM / localStorage stubs — same shape as livestatustest.mjs's, plus a
// REAL #toast-container + createElement() that actually retains innerHTML,
// because [1] asserts on what showToast() writes into the DOM. ─────────────
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};

function makeEl() {
  return {
    _html: '', set innerHTML(v) { this._html = String(v); }, get innerHTML() { return this._html; },
    children: [], className: '', id: '', style: { cssText: '' }, dataset: {},
    appendChild(c) { this.children.push(c); return c; },
    remove() { this._removed = true; }, addEventListener() {}, removeEventListener() {},
    setAttribute() {}, getAttribute() { return null; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  };
}
const toastContainer = makeEl();
toastContainer.id = 'toast-container';

globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: id => (id === 'toast-container' ? toastContainer : null),
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => makeEl(),
  // ROUND 2 — chat-ui.js's drainToast() mounts its node with
  // document.body.appendChild(), so [8] needs a body that actually retains it.
  body: {
    classList: { add() {}, remove() {}, toggle() {} }, dataset: {}, innerHTML: '',
    children: [], appendChild(c) { this.children.push(c); return c; },
  },
  hidden: false,
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined, clipboard: { writeText: async () => {} } }, configurable: true }); }
globalThis.requestAnimationFrame = fn => fn();
globalThis.fetch = async () => { throw new Error('network disabled in xsstest'); };
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

console.log(`\n[TZ=${process.env.TZ || '(system default)'}] xsstest.mjs — XSS-HARDEN\n`);

console.log('[0] Importing modules…');
const app = await import('./js/app.js');
const storage = await import('./js/storage.js');
const dataModel = await import('./js/data-model.js');
console.log('  ✅ js/app.js, js/storage.js, js/data-model.js');

const {
  renderGameCard, renderAdminGamesList, renderAlmaMaterWatch,
  renderDashboardTable, renderDashboardCompact,
} = app;
const { saveWeek, saveGame, getGame, setSession, addPlayer, savePlayer } = storage;
const { createWeek, createGame, GAME_STATUS, PICK_RESULT } = dataModel;

const appSrc = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');

// The payload. `<img src=x onerror=...>` is the canonical no-script-tag
// vector: it fires on load without needing a <script> element, so a fix that
// only strips "<script" would not save us.
const PAYLOAD = '<img src=x onerror=1>';
// An element-producing payload for the score fields (a plausible "someone
// pasted a bolded score into the Sheet" value, per the §6 open row).
const SCORE_PAYLOAD = '<b>7</b>';

// ══════════════════════════════════════════════════════════════════════════
// [1] DEFECT 1 — showToast() is an HTML sink
// ══════════════════════════════════════════════════════════════════════════
console.log('\n[1] showToast() escapes its message by default…');

// showToast is module-private; app.js exposes it on window for chat-ui.js's
// bridge (see the `window.showToast=showToast` line at the bottom of app.js).
// That bridge is the real, shipped entry point, so driving it here is driving
// production code, not a test-only seam.
const showToast = globalThis.window.showToast;
assert(typeof showToast === 'function', 'fixture: window.showToast is the real app.js function');

toastContainer.children.length = 0;
showToast(PAYLOAD, 'error');
const toastEl = toastContainer.children[toastContainer.children.length - 1];
assert(!!toastEl, 'fixture: showToast appended a toast element to #toast-container');

// [1a] the payload must be inert TEXT, not markup.
assert(/&lt;img/.test(toastEl.innerHTML),
  `[1a] toast innerHTML contains the escaped "&lt;img" (got: ${JSON.stringify(toastEl.innerHTML)})`);
assert(!/<img/i.test(toastEl.innerHTML),
  '[1a] toast innerHTML contains NO live <img element');
assert(!/onerror\s*=/i.test(toastEl.innerHTML) || !/<[a-z]/i.test(toastEl.innerHTML),
  '[1a] no live element carries the onerror handler');

// [1b] the class attribute still routes the toast type (the fix must not have
// eaten the second positional argument).
assert(/(^|\s)toast(\s|$)/.test(toastEl.className) && /error/.test(toastEl.className),
  `[1b] toast className still "toast error" (got: ${JSON.stringify(toastEl.className)})`);

// [1c] ORDINARY messages must be untouched. The app's toasts are full of
// emoji and typographic dashes; escaping must not mangle them.
toastContainer.children.length = 0;
showToast('✅ Picks submitted! Good luck!', 'success');
const plainToast = toastContainer.children[0];
assert(plainToast.innerHTML === '✅ Picks submitted! Good luck!',
  `[1c] a plain message round-trips byte-identical (got: ${JSON.stringify(plainToast.innerHTML)})`);

// [1d] A NAME WITH AN AMPERSAND MUST NOT DOUBLE-ESCAPE. Several call sites
// pre-escaped their interpolation with escHtml() before this fix; if any of
// them stayed, "Texas A&M" would render as "Texas A&amp;M" on screen. The
// sink escapes exactly once, so no caller may escape first.
toastContainer.children.length = 0;
showToast('✅ Texas A&M added', 'success');
assert(toastContainer.children[0].innerHTML === '✅ Texas A&amp;M added',
  `[1d] "&" escapes exactly once at the sink (got: ${JSON.stringify(toastContainer.children[0].innerHTML)})`);

// [1e] STRUCTURAL — no showToast() call site may hand in pre-escaped text.
// This is the double-escape guard, and it is the thing that rots first: the
// next person to add a toast will copy a neighbouring line. Scanning the
// source is the only way to catch a call site that this test never executes.
const preEscapedCallSites = appSrc
  .split('\n')
  .map((line, i) => ({ n: i + 1, line }))
  .filter(({ line }) => /showToast\(/.test(line) && /escHtml\(/.test(line));
assert(preEscapedCallSites.length === 0,
  `[1e] no showToast() call site pre-escapes with escHtml() (found: ${preEscapedCallSites.map(x => x.n).join(', ') || 'none'})`);

// [1f] STRUCTURAL — the sink itself must not assign a raw innerHTML. Guards
// against a future "quick" edit that reverts the escape while leaving the
// behavioural assertions above passing through some other path.
const showToastSrc = appSrc.match(/function showToast\([\s\S]*?\n\}/)?.[0] || '';
assert(showToastSrc.length > 0, 'fixture: located showToast() in the app.js source');
assert(!/innerHTML\s*=\s*msg\s*;/.test(showToastSrc),
  '[1f] showToast() no longer contains a bare `innerHTML = msg` assignment');

// ══════════════════════════════════════════════════════════════════════════
// [2] DEFECT 2 — poisoned scores through the REAL seam and render path
// ══════════════════════════════════════════════════════════════════════════
console.log('\n[2] renderGameCard() — poisoned homeScore/awayScore through the storage seam…');

setSession(null, false, false);
const wk = createWeek(2026, 3, '2026-09-19', '2026-09-20');
wk.status = 'final';
saveWeek(wk);

// Build the game through createGame()/saveGame() — the real write path — then
// poison the scores and save AGAIN through the same seam, which is exactly
// what a bad import or a hand-edited Sheet cell does. saveGame() has no
// coercion or allow-list, so this state is genuinely reachable in production.
let poisoned = createGame(wk.weekId, {
  gameId: 'xss_g1', homeTeam: 'Home U', awayTeam: 'Away U',
  status: GAME_STATUS.FINAL, homeScore: 21, awayScore: 17,
  spread: -3, favorite: 'Home U', espnEventId: 'e_xss',
});
saveGame(poisoned);
saveGame({ ...getGame('xss_g1'), homeScore: SCORE_PAYLOAD, awayScore: PAYLOAD, homeRank: PAYLOAD, awayRank: PAYLOAD });
poisoned = getGame('xss_g1');

assert(poisoned.homeScore === SCORE_PAYLOAD && poisoned.awayScore === PAYLOAD,
  'fixture: the poisoned scores really do survive saveGame()/getGame() unchanged (the state is reachable)');

const card = renderGameCard(poisoned, null, PICK_RESULT.PENDING, true, true);
assert(!/<b>/i.test(card), '[2a] renderGameCard: no live <b> element from homeScore');
assert(/&lt;b&gt;7&lt;\/b&gt;/.test(card), '[2a] renderGameCard: the homeScore payload is present as escaped TEXT');
assert(!/<img/i.test(card), '[2b] renderGameCard: no live <img element from awayScore or the ranks');
assert(/&lt;img/.test(card), '[2b] renderGameCard: the awayScore/rank payload is present as escaped text');

// [2c] LIVE games take a different branch of renderLiveScoreBlockHTML() and a
// different badge path — cover both statuses, not just FINAL.
saveGame({ ...poisoned, status: GAME_STATUS.LIVE });
const liveCard = renderGameCard(getGame('xss_g1'), 'Home U', PICK_RESULT.LIVE, true, true);
assert(!/<b>/i.test(liveCard) && !/<img/i.test(liveCard),
  '[2c] renderGameCard (LIVE): no live element from either score');

// [2d] THE ZERO GUARD. escHtml(0) === '' — a naive escHtml() wrap would blank
// every zero on the board. A 0–0 final must still print both zeroes.
const zeroGame = createGame(wk.weekId, {
  gameId: 'xss_g0', homeTeam: 'Nil A', awayTeam: 'Nil B',
  status: GAME_STATUS.FINAL, homeScore: 0, awayScore: 0, spread: 0, favorite: 'Nil A',
});
saveGame(zeroGame);
const zeroCard = renderGameCard(getGame('xss_g0'), null, PICK_RESULT.PENDING, true, true);
const zeroNums = (zeroCard.match(/<div class="score-num[^"]*">([^<]*)<\/div>/g) || []).map(s => s.replace(/.*">|<\/div>/g, ''));
assert(zeroNums.length === 2 && zeroNums.every(v => v === '0'),
  `[2d] a 0–0 FINAL still renders both zeroes (got: ${JSON.stringify(zeroNums)})`);

// [2e] and an ordinary game still shows its real numbers.
const normalCard = renderGameCard(
  { ...getGame('xss_g0'), gameId: 'xss_gn', homeScore: 21, awayScore: 17 },
  null, PICK_RESULT.PENDING, true, true);
assert(/>21</.test(normalCard) && />17</.test(normalCard),
  '[2e] an ordinary 21–17 FINAL still renders 21 and 17');

// ══════════════════════════════════════════════════════════════════════════
// [3] Commissioner slate list
// ══════════════════════════════════════════════════════════════════════════
console.log('\n[3] renderAdminGamesList() — same poisoned game…');
saveGame({ ...getGame('xss_g1'), status: GAME_STATUS.FINAL });
const adminHtml = renderAdminGamesList([getGame('xss_g1')], wk, {});
assert(!/<b>/i.test(adminHtml) && !/<img/i.test(adminHtml),
  '[3a] renderAdminGamesList: no live element from scores or ranks');
assert(/&lt;b&gt;|&lt;img/.test(adminHtml),
  '[3a] renderAdminGamesList: the payload is present as escaped text');

// ══════════════════════════════════════════════════════════════════════════
// [4] Alma Mater Watch (straight-up score pill)
// ══════════════════════════════════════════════════════════════════════════
console.log('\n[4] renderAlmaMaterWatch() — poisoned score in the W/L pill…');
addPlayer({ playerId: 'xss_p1', displayName: 'Tester', active: true, almaMater: 'Home U' });
const almaHtml = renderAlmaMaterWatch(wk.weekId, [getGame('xss_g1')]);
assert(/alma-watch-row/.test(almaHtml), 'fixture: the alma mater row actually rendered');
assert(!/<b>/i.test(almaHtml) && !/<img/i.test(almaHtml),
  '[4a] renderAlmaMaterWatch: no live element from the score pill or the rank prefix');

// ══════════════════════════════════════════════════════════════════════════
// [5] Dashboard matrix + compact view (FINAL / LIVE status pills)
// ══════════════════════════════════════════════════════════════════════════
console.log('\n[5] renderDashboardTable() / renderDashboardCompact() — FINAL + LIVE pills…');
const players5 = [{ playerId: 'xss_p1', displayName: 'Tester', active: true }];
const picks5 = [{ pickId: 'xss_pk', weekId: wk.weekId, gameId: 'xss_g1', playerId: 'xss_p1', selectedTeam: 'Home U' }];
const results5 = [{ playerId: 'xss_p1', correctPicks: 0, incorrectPicks: 0 }];

const tableHtml = renderDashboardTable(players5, [getGame('xss_g1')], picks5, results5, wk.weekId, null);
assert(/status-pill-final/.test(tableHtml), 'fixture: the FINAL status pill actually rendered in the matrix');
assert(!/<b>/i.test(tableHtml) && !/<img/i.test(tableHtml),
  '[5a] renderDashboardTable: no live element from the FINAL score pill');

const compactHtml = renderDashboardCompact(players5, [getGame('xss_g1')], picks5, results5, wk.weekId, null);
assert(/dc-final/.test(compactHtml), 'fixture: the FINAL chip actually rendered in the compact view');
assert(!/<b>/i.test(compactHtml) && !/<img/i.test(compactHtml),
  '[5b] renderDashboardCompact: no live element from the FINAL score chip');

// [5c] the zero guard again, on both dashboard surfaces — a 0–0 FINAL must
// still read "FINAL 0–0" and not "FINAL –".
const zeroTable = renderDashboardTable(players5, [getGame('xss_g0')],
  [{ ...picks5[0], gameId: 'xss_g0', selectedTeam: 'Nil A' }], results5, wk.weekId, null);
assert(/FINAL 0–0/.test(zeroTable), '[5c] matrix: a 0–0 FINAL still reads "FINAL 0–0"');
const zeroCompact = renderDashboardCompact(players5, [getGame('xss_g0')],
  [{ ...picks5[0], gameId: 'xss_g0', selectedTeam: 'Nil A' }], results5, wk.weekId, null);
assert(/FINAL 0–0/.test(zeroCompact), '[5c] compact: a 0–0 FINAL still reads "FINAL 0–0"');

// ══════════════════════════════════════════════════════════════════════════
// [6] STRUCTURAL — the render sites this harness cannot reach, plus the
// whole-file sweep that catches the NEXT one.
//
// renderHistoricalPicksView(), renderDemoBatchGrid() and showGameModal() are
// module-private and want a live DOM container, so they are covered the way
// loadtest.mjs [43c]/[43e] and feedbackexporttest.mjs (d) cover unexported UI
// glue: by asserting on their source text. Two of them interpolate into an
// ATTRIBUTE (`value="${...}"`), where an unescaped double quote breaks out of
// the attribute and needs no angle bracket at all.
// ══════════════════════════════════════════════════════════════════════════
console.log('\n[6] Structural — no raw score/rank interpolation on any markup-bearing line…');

// A BALANCED `${...}` scanner. A naive /\$\{[^}]*\}/ stops at the first `}`,
// which means `${numHtml(game.homeScore)}` reads as "contains homeScore,
// unwrapped" — the exact false reading that would let a reverted fix pass.
// This walks braces instead, and recurses naturally because every nested
// `${` is its own start index.
function interpolations(src) {
  const out = [];
  for (let i = 0; i < src.length - 1; i++) {
    if (src[i] !== '$' || src[i + 1] !== '{') continue;
    let depth = 1, j = i + 2;
    while (j < src.length && depth > 0) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') depth--;
      j++;
    }
    if (depth === 0) out.push({ index: i, expr: src.slice(i + 2, j - 1) });
  }
  return out;
}

// An expression whose WHOLE value is a score/rank field (or one of the four
// local aliases the renderers assign them to). A comparison such as
// `game.awayScore>game.homeScore?' score-leading':''` is deliberately NOT
// matched — it yields a fixed class name, never attacker text.
const RAW_PRINT = /^(?:(?:game|g)\s*\??\.\s*)?(homeScore|awayScore|homeRank|awayRank|myScore|oppScore|hs|as_)\s*(?:(?:\?\?|\|\|)\s*(?:''|""|0))?$/;
// Only markup context matters: the same `${hs}` inside a showToast() template
// is now escaped at the sink, and inside a CSV row it is not HTML at all.
const MARKUP_LINE = /<\/?[a-zA-Z]|value="|class="/;

function rawSites(src, lineOffset = 0) {
  const hits = [];
  for (const { index, expr } of interpolations(src)) {
    if (!RAW_PRINT.test(expr.trim())) continue;
    const lineStart = src.lastIndexOf('\n', index) + 1;
    let lineEnd = src.indexOf('\n', index); if (lineEnd < 0) lineEnd = src.length;
    const line = src.slice(lineStart, lineEnd);
    if (!MARKUP_LINE.test(line)) continue;
    hits.push({ n: lineOffset + src.slice(0, index).split('\n').length, expr: expr.trim() });
  }
  return hits;
}

// [6a] the scanner must be PROVEN to work — a scanner that silently matches
// nothing would make every assertion below vacuous (the RG-27 shape).
const canary = `<div class="score-num">\${game.homeScore}</div>`;
const canaryClean = `<div class="score-num">\${numHtml(game.homeScore)}</div>`;
assert(rawSites(canary).length === 1, '[6a] scanner canary: flags a raw ${game.homeScore} in markup');
assert(rawSites(canaryClean).length === 0, '[6a] scanner canary: does NOT flag ${numHtml(game.homeScore)}');
assert(rawSites(`<span class="\${game.awayScore>game.homeScore?'x':''}">`).length === 0,
  '[6a] scanner canary: does NOT flag a score COMPARISON used as a class name');

// [6b] per-function — including the three private ones this harness cannot call.
function fnSrc(name) {
  const m = appSrc.match(new RegExp(`\\n(?:export )?function ${name}\\([\\s\\S]*?\\n\\}`));
  return m ? m[0] : '';
}
for (const name of [
  'renderHistoricalPicksView', 'renderDemoBatchGrid', 'showGameModal',
  'renderGameCard', 'renderAdminGamesList', 'renderAvailableGamesList',
  'renderLiveScoreBlockHTML', 'renderAlmaMaterWatch',
  'renderDashboardTable', 'renderDashboardCompact',
]) {
  const src = fnSrc(name);
  assert(src.length > 0, `fixture: located ${name}() in the app.js source`);
  const hits = rawSites(src);
  assert(hits.length === 0,
    `[6b] ${name}(): no raw score/rank interpolation in markup (found: ${hits.map(h => h.expr).join(' | ') || 'none'})`);
}

// [6c] WHOLE-FILE SWEEP — the guard that covers render sites nobody has
// written yet. Any raw score/rank interpolation on a markup-bearing line
// anywhere in app.js fails this, wherever it lives.
const sweep = rawSites(appSrc);
assert(sweep.length === 0,
  `[6c] whole-file sweep: no raw score/rank interpolation on any markup-bearing line (found at lines: ${sweep.map(h => h.n).join(', ') || 'none'})`);

// [6d] The two rank ALIAS assignments, which the sweep's markup-line rule
// cannot see (they sit on a bare `const homeRk = ...` line with no tag on it)
// yet feed straight into a `<div class="team-rank">` and a
// `<span class="alma-watch-team">`. Named explicitly so a revert here fails
// structurally as well as behaviourally ([2b]/[4a]).
for (const [label, re] of [
  ['renderGameCard homeRk', /const homeRk\s*=\s*game\.homeRank \? `#\$\{numHtml\(game\.homeRank\)\} `/],
  ['renderGameCard awayRk', /const awayRk\s*=\s*game\.awayRank \? `#\$\{numHtml\(game\.awayRank\)\} `/],
  ['renderAlmaMaterWatch rankStr', /const rankStr\s*=\s*myRank \? `#\$\{numHtml\(myRank\)\} `/],
  ['renderHistoricalPicksView score', /const score = \([\s\S]{0,80}?`\$\{numHtml\(g\.awayScore\)\}–\$\{numHtml\(g\.homeScore\)\}`/],
]) {
  assert(re.test(appSrc), `[6d] ${label} is coerced through numHtml()`);
}

// [6e] numHtml() itself — the guard on the guard. If someone "simplifies" it
// to escHtml(), [2d]/[5c] catch the zero blanking, but this says WHY.
const numHtmlSrc = appSrc.match(/function numHtml\(v\)\{[\s\S]*?\n\}/)?.[0] || '';
assert(numHtmlSrc.length > 0, 'fixture: located numHtml() in the app.js source');
assert(/Number\.isFinite\(/.test(numHtmlSrc), '[6e] numHtml() uses a Number.isFinite guard (CONVENTIONS #7)');
assert(/escHtml\(/.test(numHtmlSrc), '[6e] numHtml() falls through to escHtml() for a non-numeric value (CONVENTIONS #12)');


// ══════════════════════════════════════════════════════════════════════════
// ROUND 2 (2026-09-12) — security-reviewer audit items C1–C6 + the round-1
// reviewer's BLOCK items B1–B5. Everything below was written and watched FAIL
// before any of the fixes existed; the RED lines are quoted in the report.
//
// The shape is the same as round 1: drive the REAL render path with a value
// that a hand-edited Sheet cell, a bad import, or a third-party CORS proxy can
// genuinely put in the blob, then assert the payload comes out as inert text.
// ══════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════
// [7] C1 — the commissioner's Rules editor <textarea>
//
// getRulesEditorText() concatenates settings.customRules[].section/items into
// the BODY of a <textarea>. A `</textarea>` inside a rule closes the element
// early and everything after it is parsed as markup — no angle-bracket-free
// trickery needed, and no script tag either. settings.customRules is written
// by parseRulesText() from whatever the commissioner (or a synced Sheet cell,
// or a restored snapshot) supplies, so the value is attacker-reachable.
// ══════════════════════════════════════════════════════════════════════════
console.log('\n[7] Rules editor <textarea> — a customRules entry must not break out of the element…');

const { saveSetting, getSettings } = storage;
const TEXTAREA_PAYLOAD = '</textarea><img src=x onerror=1>';

assert(typeof app._rulesEditorHTMLForTest === 'function',
  'fixture: app.js exposes the rules-editor markup as a test seam (renderCommPage() itself is private and wants a live panel)');

saveSetting('customRules', [{
  id: 'r_xss', section: `Payouts ${TEXTAREA_PAYLOAD}`,
  items: [`Loser buys ${TEXTAREA_PAYLOAD}`, 'Winner picks the bar'],
}]);
const rulesHtml = app._rulesEditorHTMLForTest();

assert(/<textarea[^>]*id="rules-editor"/.test(rulesHtml), 'fixture: the rules editor textarea really rendered');
const taBody = rulesHtml.slice(rulesHtml.indexOf('>') + 1, rulesHtml.lastIndexOf('</textarea>'));
assert(!/<\/textarea/i.test(taBody),
  '[7a] no </textarea> inside the textarea BODY — the element cannot be closed early');
assert(!/<img/i.test(rulesHtml), '[7a] no live <img element anywhere in the rendered editor');
assert(/&lt;img/.test(rulesHtml), '[7a] the payload is present as escaped TEXT (the commissioner still sees their rule)');

// [7b] ROUND-TRIP. The editor is a real form field: Save Rules reads
// `.value` and re-parses it. A browser DECODES entities when it builds the
// textarea's value, so escaping the body is the one fix that is also
// round-trip-safe — but only if we escape exactly once. "Texas A&M" must not
// become "Texas A&amp;M" on the second save.
saveSetting('customRules', [{ id: 'r_amp', section: 'Texas A&M week', items: ['Bring cash'] }]);
const ampHtml = app._rulesEditorHTMLForTest();
assert(/Texas A&amp;M week/.test(ampHtml) && !/A&amp;amp;M/.test(ampHtml),
  `[7b] "&" is escaped exactly once, so .value round-trips back to "Texas A&M" (got: ${JSON.stringify(ampHtml.slice(ampHtml.indexOf('Texas') - 10, ampHtml.indexOf('Texas') + 30))})`);
assert(/## Texas A&amp;M week/.test(ampHtml) && /\n- Bring cash/.test(ampHtml),
  '[7b] the "## section / - item" markdown shape parseRulesText() reads back is unchanged');
saveSetting('customRules', null);

// [7c] STRUCTURAL SWEEP — every <textarea> in js/, not just this one. A
// textarea body is an escaping context people forget precisely because it
// "looks like a form field, not HTML".
console.log('\n[7c] Sweep — no <textarea> in js/ interpolates an unwrapped expression…');
const chatUiSrc = await readFile(new URL('./js/chat-ui.js', import.meta.url), 'utf8');
// R-3 (DI-345 "XSS / escaping", 2026-09-25) — js/admin-panel.js is a new render call site this
// build wave (and DI-320 before it) — the maintenance_banner string and platform_audit_log
// before_role/after_role values (both user-authored, both super-admin-authored text echoed back
// to every signed-in user) are new interpolation sites the existing hardcoded per-file sweeps
// (:461, :1823, :2162) would otherwise never see. Added to every one of those lists rather than
// a new, separate sweep, so it gets the same coverage every other render file already has.
const adminPanelSrc = await readFile(new URL('./js/admin-panel.js', import.meta.url), 'utf8');
const TEXTAREA_RE = /<textarea[^>]*>([\s\S]*?)<\/textarea>/g;
const textareaHits = [];
for (const [file, src] of [['js/app.js', appSrc], ['js/chat-ui.js', chatUiSrc], ['js/admin-panel.js', adminPanelSrc]]) {
  TEXTAREA_RE.lastIndex = 0;
  let m;
  while ((m = TEXTAREA_RE.exec(src))) {
    for (const { expr } of interpolations(m[1])) {
      if (!/^(esc|escHtml|numHtml)\s*\(/.test(expr.trim())) {
        textareaHits.push(`${file}:${src.slice(0, m.index).split('\n').length} \${${expr.trim().slice(0, 40)}}`);
      }
    }
  }
}
assert(textareaHits.length === 0,
  `[7c] every <textarea> body interpolation is escaped (found: ${textareaHits.join(' | ') || 'none'})`);

// ══════════════════════════════════════════════════════════════════════════
// [8] C2 + C3 — chat avatar accent colour and initials
//
// `player.preferences.accent` is rendered straight into a style ATTRIBUTE at
// two sites. An attribute needs no angle bracket to break out: a bare `"`
// closes it and the rest becomes new attributes on a real element. The value
// is set by setAccent() (a swatch click) but stored on the PLAYER RECORD,
// which savePlayer()/the Sheet mirror will accept in any shape — so the fix
// is BOTH halves: validate at the write seam, escape at the render sink.
// ══════════════════════════════════════════════════════════════════════════
console.log('\n[8] chat-ui avatar accent + initials…');

const chatUi = await import('./js/chat-ui.js');
const { getPlayer, setAccent, getAccent } = storage;
const HOSTILE_ACCENT = 'red" onmouseover="alert(1)';

addPlayer({ playerId: 'xss_acc', displayName: 'Accent Guy', initials: 'AG', active: true });
savePlayer({ ...getPlayer('xss_acc'), preferences: { accent: HOSTILE_ACCENT } });
assert(storage.getAccentFor('xss_acc') === HOSTILE_ACCENT,
  'fixture: the hostile accent really does survive savePlayer()/getAccentFor() (the state is reachable — a Sheet edit or a record written before validation)');

const accMsg = { id: 'm_acc', type: 'message', author: 'xss_acc', gameTag: '', ts: Date.now(), body: 'hello', reactions: {}, meta: null };
const accHtml = chatUi._messageHTMLForTest(accMsg, 'xss_other', false);
assert(/chat-avatar/.test(accHtml), 'fixture: the message avatar rendered');
// A LIVE attribute is `name="…"` with a real quote; the escaped payload reads
// `onmouseover=&quot;…` and is inert text inside the style value.
assert(!/onmouseover\s*=\s*["']/.test(accHtml),
  `[8a] messageHTML(): the accent cannot open a NEW attribute — no live onmouseover= (got: ${JSON.stringify((accHtml.match(/<div class="chat-avatar[^>]*>/) || [''])[0])})`);
assert(/&quot;/.test(accHtml), '[8a] the hostile quote is present, escaped, inside the style value');

// [8b] C3 — initials render escaped at messageHTML() the way they already do
// in the toast. `player.initials` is a plain commissioner-editable field.
savePlayer({ ...getPlayer('xss_acc'), initials: '<img src=x onerror=1>' });
const initHtml = chatUi._messageHTMLForTest(accMsg, 'xss_other', false);
assert(!/<img/i.test(initHtml), '[8b] messageHTML(): no live <img element from player.initials');
assert(/&lt;IMG/i.test(initHtml), '[8b] the initials payload is present as escaped text');

// [8c] the SAME two values through the floating chat toast (chat-ui's own
// drainToast, a second sink with its own copy of the avatar markup).
chatUi._resetToastsForChatPage?.();
document.body.children.length = 0;
chatUi._showToastForTest({ id: 'm_acc', author: 'xss_acc', body: 'toasted' }, { force: true });
const chatToast = document.body.children.find(c => c.id === 'chat-toast');
assert(!!chatToast, 'fixture: the chat toast mounted into the DOM harness');
assert(!/onmouseover\s*=\s*["']/.test(chatToast?.innerHTML || ''),
  '[8c] drainToast(): the accent cannot open a new attribute on the toast avatar');
assert(!/<img/i.test(chatToast?.innerHTML || ''), '[8c] drainToast(): no live <img from the initials');

// [8d] THE WRITE SEAM (storage.js setAccent) — the other half. Only a value
// from the shared ACCENTS palette may be persisted; anything else is refused
// outright rather than coerced, and null still means "no accent".
setSession('xss_acc', false, true);
savePlayer({ ...getPlayer('xss_acc'), preferences: { accent: null } });
setAccent(HOSTILE_ACCENT);
assert(getAccent() === null,
  `[8d] setAccent() REFUSES a value that is not in the palette (got: ${JSON.stringify(getAccent())})`);
setAccent('#B91C1C');
assert(getAccent() === '#B91C1C', '[8d] setAccent() still accepts a real palette colour');
setAccent('#b91c1c');
assert(getAccent() === '#B91C1C',
  `[8d] a case variant is NOT silently normalised into the record — it is refused, leaving the prior choice (got: ${JSON.stringify(getAccent())})`);
setAccent(null);
assert(getAccent() === null, '[8d] setAccent(null) still clears the accent — the ∅ "Default" swatch keeps working');
setAccent('javascript:alert(1)');
assert(getAccent() === null, '[8d] a scheme-looking string is refused too');

// [8e] ONE palette, not two. The swatch row, the validator and the renderer
// must read the same list or the UI offers a colour the seam rejects.
assert(Array.isArray(dataModel.CHAT_ACCENTS) && dataModel.CHAT_ACCENTS.length === 8,
  `[8e] data-model.js owns the accent palette (got: ${JSON.stringify(dataModel.CHAT_ACCENTS)})`);
assert((dataModel.CHAT_ACCENTS || []).length === 8 && (dataModel.CHAT_ACCENTS || []).every(c => /^#[0-9A-F]{6}$/.test(c)),
  '[8e] every palette entry is a plain 6-digit hex colour — nothing that could carry a quote');
assert(/CHAT_ACCENTS/.test(chatUiSrc) && !/const ACCENTS = \[/.test(chatUiSrc),
  '[8e] chat-ui.js uses the shared list rather than its own literal copy');
const storageSrc = await readFile(new URL('./js/storage.js', import.meta.url), 'utf8');
assert(/CHAT_ACCENTS/.test(storageSrc) && !/from '\.\/chat-ui\.js'/.test(storageSrc),
  '[8e] storage.js validates against the SAME list and still imports nothing from chat-ui.js (the seam file stays a leaf)');
setSession(null, false, false);

// ══════════════════════════════════════════════════════════════════════════
// [9] THE STRUCTURAL SWEEP  (XSS-HARDEN round 3, R3 — replaces round 2's
//     vocabulary-bounded sweep, which BOTH gates blocked as the root cause)
//
// ROUND 2's SWEEP WAS THE BUG. It was deny-by-default only WITHIN a hand-
// written vocabulary — `FIELDS` listed 14 field names, `SOURCES` three
// accessors, `LOCAL_ALIASES` six locals. Everything outside that list was
// invisible, so the sweep could be perfectly green while three siblings of
// the very defect it was written for (R1: draftTiebreaker, draftExtraPoint,
// extraPointActual) sat raw in `value="…"` on the picks page. A vocabulary
// list can only ever catch the bug you already found. That is the RG-27
// shape one level up: not a scanner that matches nothing, but a scanner that
// matches only what you already knew about.
//
// THE INVERSION. This sweep starts from STRUCTURE, not from names:
//
//   1. Lex each file and find every TEMPLATE LITERAL that contains markup —
//      a `<` followed by a tag name, or an `="` attribute pattern — plus
//      every template interpolated INTO one (`parentFrame`), because a
//      nested `${`…`}` inherits its parent's HTML context.
//   2. Take EVERY `${…}` in those templates. No vocabulary. 1,4xx sites.
//   3. Classify each one as:
//        (i)   WRAPPED    — the value passes through escHtml / esc / numHtml /
//                           encodeURIComponent / String(Number(…)).
//        (ii)  PROVABLY SAFE — a literal (or ternary of literals), a lookup
//                           table whose values are all literals, a safe
//                           global, a number (.length/.size/Math/Number/date
//                           formatter), a comparison or ternary CONDITION, a
//                           `.map()` whose callback classifies, a call whose
//                           EVERY return classifies (parameters bound to the
//                           actual arguments, resolved across modules), or a
//                           variable whose EVERY assignment classifies —
//                           resolved LEXICALLY, innermost scope outward.
//        (iii) EXEMPT     — listed in EXEMPTIONS below with file, the EXACT
//                           expression text, and a reason.
//      Anything else FAILS with file:line and the expression.
//
// WHY LEXICAL SCOPE MATTERS (and why round 2 could not have got here):
// resolving `n` or `cls` file-wide in a 13,000-line module unions every
// unrelated `n =` in the file, which is exactly why round 2 had to hand-pick
// six alias names instead of resolving them.
// ══════════════════════════════════════════════════════════════════════════
console.log('\n[9] Structural sweep — every ${…} in every markup-bearing template…');

// ─── LEXER ────────────────────────────────────────────────────────────────
function regexOk(p) { return p === '' || '(,=:[!&|?{};+-*%~^<>'.includes(p) || /\s/.test(p); }

/** Walks JS, emitting every template literal (raw text + its own `${}`s), and
 *  a CODE-ONLY projection of the source (comments, strings, regex and
 *  template RAW text blanked; interpolation EXPRESSIONS kept). */
function lex(src) {
  const frames = [], stack = [];
  const code = src.split('');
  const blank = (a, b) => { for (let k = a; k < Math.min(b, src.length); k++) if (code[k] !== '\n') code[k] = ' '; };
  let i = 0, prev = '';
  while (i < src.length) {
    const top = stack[stack.length - 1], c = src[i], c2 = src[i + 1];
    if (top && top.mode === 'raw') {
      if (c === '\\') { top.raw += src.substr(i, 2); blank(i, i + 2); i += 2; continue; }
      if (c === '`') { top.end = i; stack.pop(); i++; prev = '`'; continue; }
      if (c === '$' && c2 === '{') { top.mode = 'expr'; top.depth = 0; top.exprStart = i + 2; blank(i, i + 2); i += 2; continue; }
      top.raw += c; blank(i, i + 1); i++; continue;
    }
    if (c === '/' && c2 === '/') { const j = src.indexOf('\n', i); const e = j < 0 ? src.length : j; blank(i, e); i = e; continue; }
    if (c === '/' && c2 === '*') { const j = src.indexOf('*/', i); const e = j < 0 ? src.length : j + 2; blank(i, e); i = e; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length) { if (src[j] === '\\') { j += 2; continue; } if (src[j] === c || src[j] === '\n') break; j++; }
      blank(i + 1, j); i = j + 1; prev = c; continue;
    }
    if (c === '/' && regexOk(prev)) {
      let j = i + 1, cls = false, ok = false;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '\n') break;
        if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false;
        else if (src[j] === '/' && !cls) { ok = true; break; }
        j++;
      }
      if (ok) { let k = j + 1; while (k < src.length && /[gimsuyd]/.test(src[k])) k++; blank(i, k); i = k; prev = '/'; continue; }
    }
    // NB: the backtick DELIMITERS survive into `code` (only the raw text
    // between them is blanked). assignmentsOf() needs them to know that a
    // multi-line template assignment has NOT ended at the first newline.
    if (c === '`') { const f = { mode: 'raw', raw: '', start: i, interps: [], parentFrame: (top && top.mode === 'expr') ? top : null }; frames.push(f); stack.push(f); i++; continue; }
    if (top && top.mode === 'expr') {
      if (c === '{') top.depth++;
      else if (c === '}') {
        if (top.depth === 0) { top.interps.push({ index: top.exprStart, expr: src.slice(top.exprStart, i) }); top.mode = 'raw'; blank(i, i + 1); i++; continue; }
        top.depth--;
      }
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return { frames, code: code.join('') };
}

const HAS_MARKUP = /<\/?[a-zA-Z][\w-]*|="/;

// A template handed straight to querySelector()/closest()/matches() is a CSS
// SELECTOR, not an HTML sink — `[data-mid="${id}"]` trips HAS_MARKUP's `="`
// rule but never reaches innerHTML. Excluded STRUCTURALLY (by its consumer),
// not by an exemption, so the rule cannot be stretched to cover a real sink.
const SELECTOR_CALL = /(querySelector|querySelectorAll|closest|matches)\s*(?:\?\.)?\s*\(\s*$/;
// A template handed DIRECTLY to an escaper is escaped as a whole — its own
// `${}`s are inside the escaped string, not separate sinks. Without this the
// sweep double-counts `esc(`See what changed in ${v}`)` as an unwrapped site.
const WRAPPER_CALL = /(?<![\w$.])(escHtml|esc|numHtml|encodeURIComponent|escAttr)\s*\(\s*$/;

/** Every `${}` that sits inside a template literal containing markup —
 *  directly, or by being interpolated into one. */
function markupSites(src) {
  const { frames, code } = lex(src);
  const memo = new Map();
  const before = f => code.slice(Math.max(0, f.start - 40), f.start);
  const isSel = f => SELECTOR_CALL.test(before(f)) || WRAPPER_CALL.test(before(f));
  const isMk = f => { if (memo.has(f)) return memo.get(f); memo.set(f, false);
    const v = !isSel(f) && (HAS_MARKUP.test(f.raw) || (f.parentFrame ? isMk(f.parentFrame) : false));
    memo.set(f, v); return v; };
  const out = [];
  for (const f of frames) if (isMk(f)) for (const it of f.interps) out.push(it);
  return out.sort((a, b) => a.index - b.index);
}

// ─── expression-level blanking (literals + wrapper calls) ─────────────────
function blankLiterals(expr) { return lex(expr).code; }

const WRAPPERS = ['escHtml', 'esc', 'numHtml', 'encodeURIComponent', 'escAttr'];
function blankWrapped(blanked) {
  let out = blanked;
  const re = new RegExp(`(?<![\\w$.])(${WRAPPERS.join('|')})\\s*\\(`, 'g');
  for (;;) {
    re.lastIndex = 0; const m = re.exec(out); if (!m) break;
    let i = m.index + m[0].length, d = 1;
    while (i < out.length && d > 0) { if (out[i] === '(') d++; else if (out[i] === ')') d--; i++; }
    out = out.slice(0, m.index) + ' '.repeat(i - m.index) + out.slice(i);
  }
  return out;
}

// ─── leaves ───────────────────────────────────────────────────────────────
function leavesOf(expr) {
  const s = blankWrapped(blankLiterals(expr));
  const out = []; const re = /(?<![\w$.])([A-Za-z_$][\w$]*)/g; let m;
  while ((m = re.exec(s))) {
    const head = m[1];
    let i = m.index + head.length, text = head, isCall = false, callArgs = '';
    const steps = []; let lastProp = null;
    for (;;) {
      const rest = s.slice(i); let mm;
      if ((mm = /^\s*\??\.\s*([A-Za-z_$][\w$]*)/.exec(rest))) {
        text += '.' + mm[1]; i += mm[0].length; isCall = false;
        lastProp = mm[1]; steps.push({ kind: 'prop', name: mm[1] }); continue;
      }
      if ((mm = /^\s*\(/.exec(rest))) {
        let j = i + mm[0].length, d = 1;
        while (j < s.length && d > 0) { if (s[j] === '(') d++; else if (s[j] === ')') d--; j++; }
        callArgs = expr.slice(i + mm[0].length, j - 1); text += '(' + callArgs + ')'; i = j; isCall = true;
        if (steps.length && steps[steps.length - 1].kind === 'prop') { steps[steps.length - 1] = { kind: 'call', name: lastProp, args: callArgs }; }
        else steps.push({ kind: 'call', name: null, args: callArgs });
        continue;
      }
      if ((mm = /^\s*\[/.exec(rest))) {
        let j = i + mm[0].length, d = 1;
        while (j < s.length && d > 0) { if (s[j] === '[') d++; else if (s[j] === ']') d--; j++; }
        text += '[' + s.slice(i + mm[0].length, j - 1) + ']'; i = j; isCall = false;
        steps.push({ kind: 'index' }); continue;
      }
      break;
    }
    const callee = text.split('(')[0];
    out.push({ head, text, callee, steps, isCall, callArgs, before: s.slice(0, m.index), after: s.slice(i) });
    re.lastIndex = i;
  }
  return out;
}

const SAFE_GLOBALS = new Set(['Math','Number','Boolean','parseInt','parseFloat','isNaN','isFinite','Date','Array','Object','JSON','Set','Map','Intl','undefined','null','true','false','NaN','Infinity']);
const KEYWORDS = new Set(['new','typeof','instanceof','void','delete','in','of','await','this','return','else','case','do','let','const','var','function','class','yield','try','catch','throw','default','switch','if','for','while','break','continue']);
const NUM_METHOD = /\.(length|size)$/;
const INERT_STRING_METHOD = /\.(toISOString|toLocaleTimeString|toLocaleDateString|toLocaleString|toFixed|getTime|getFullYear|getMonth|getDate|getHours|getMinutes|now)\s*\(/;
const CMP_AFTER = /^\s*(===|!==|==|!=|>=|<=|>|<)/;
const CMP_BEFORE = /(===|!==|==|!=|>=|<=|>|<)\s*$/;
const COND_AFTER = /^\s*\?(?!\?|\.)/;
const NOT_BEFORE = /!\s*$/;
const KW_BEFORE = /\b(typeof|instanceof|new)\s*$/;
// `{a:'x',b:'y'}[k] || 'z'` — a lookup table whose VALUES are all literals.
const LITERAL_LOOKUP = /^\s*\{[^{}]*\}\s*\[/;

/** An OBJECT LITERAL whose every VALUE is a literal — e.g. extra-point.js's
 *  EP_OUTCOME_LABEL. Its KEYS are identifiers syntactically but are never
 *  values, so a naive leaf scan reads `blackjack:` as a variable. */
function isLiteralValueObject(expr) {
  const t = expr.trim();
  if (!t.startsWith('{') || !t.endsWith('}')) return false;
  const inner = t.slice(1, -1);
  for (const part of splitTop(inner)) {
    if (!part.trim()) continue;
    const b = blankLiterals(part);
    let d = 0, at = -1;
    for (let i = 0; i < b.length; i++) { const c = b[i];
      if ('([{'.includes(c)) d++; else if (')]}'.includes(c)) d--;
      else if (c === ':' && d === 0) { at = i; break; } }
    if (at < 0) return false;                       // shorthand `{ x }` → a VALUE
    if (!/^[\s()?:+\-*/%|&!,;'"`0-9.]*$/.test(b.slice(at + 1))) return false;
  }
  return true;
}
// Array/string methods that cannot ADD markup a safe receiver did not have.
// `join`/`filter`/`slice`/`sort`/`concat`/`reverse`/`flat` re-arrange; the
// string ones re-shape characters. `replace` IS here on purpose: every use in
// this app replaces on an ALREADY-ESCAPED receiver (esc(x).replace(/\n/g,
// '<br>')), and blankWrapped() has already removed that receiver, so a
// `.replace` that survives to here has a receiver this pass still judges.
const PASSTHROUGH = new Set(['join','filter','slice','sort','concat','reverse','flat','trim','trimStart','trimEnd','toUpperCase','toLowerCase','padStart','padEnd','repeat','split','at','replace','replaceAll','normalize','substring','substr','charAt','find','entries','keys','values','from']);

// ─── definitions ──────────────────────────────────────────────────────────
function matchParen(s, open) { let i = open + 1, d = 1; while (i < s.length && d > 0) { if (s[i] === '(') d++; else if (s[i] === ')') d--; i++; } return i; }
function matchBrace(s, open) { let i = open + 1, d = 1; while (i < s.length && d > 0) { if (s[i] === '{') d++; else if (s[i] === '}') d--; i++; } return i; }

/** Find a function's PARAMS and BODY, using the code-only projection so that
 *  markup text can never be mistaken for code. */
function findFn(code, name) {
  const pats = [
    new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`, 'g'),
    new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*(?:async\\s*)?\\(`, 'g'),
  ];
  for (const p of pats) {
    const m = p.exec(code); if (!m) continue;
    const open = m.index + m[0].length - 1;
    const closed = matchParen(code, open);
    const params = code.slice(open + 1, closed - 1);
    const rest = code.slice(closed);
    const arrow = /^\s*=>/.exec(rest);
    const bodyStart = closed + (arrow ? arrow[0].length : 0);
    const br = /^\s*\{/.exec(code.slice(bodyStart));
    if (br) { const o = bodyStart + br[0].length - 1; const e = matchBrace(code, o); return { params, body: code.slice(o + 1, e - 1), start: o + 1, end: e - 1, expr: false }; }
    if (arrow) { // concise body
      let j = bodyStart, d = 0;
      while (j < code.length) { const c = code[j];
        if ('([{'.includes(c)) d++; else if (')]}'.includes(c)) { if (d === 0) break; d--; }
        else if (c === ';' && d === 0) break; j++; }
      return { params, body: code.slice(bodyStart, j), start: bodyStart, end: j, expr: true };
    }
  }
  // single-param arrow: `const f = x => …`
  const p3 = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*(?:async\\s*)?([A-Za-z_$][\\w$]*)\\s*=>`).exec(code);
  if (p3) {
    const bodyStart = p3.index + p3[0].length;
    const br = /^\s*\{/.exec(code.slice(bodyStart));
    if (br) { const o = bodyStart + br[0].length - 1; const e = matchBrace(code, o); return { params: p3[1], body: code.slice(o + 1, e - 1), start: o + 1, end: e - 1, expr: false }; }
    let j = bodyStart, d = 0;
    while (j < code.length) { const c = code[j];
      if ('([{'.includes(c)) d++; else if (')]}'.includes(c)) { if (d === 0) break; d--; }
      else if (c === ';' && d === 0) break; j++; }
    return { params: p3[1], body: code.slice(bodyStart, j), start: bodyStart, end: j, expr: true };
  }
  return null;
}

/** An ARRAY literal whose every element is a literal (CHAT_ACCENTS etc.),
 *  optionally wrapped in Object.freeze(). */
function isLiteralValueArray(expr) {
  let t = expr.trim();
  const fz = /^Object\.freeze\s*\(([\s\S]*)\)$/.exec(t);
  if (fz) t = fz[1].trim();
  if (!t.startsWith('[') || !t.endsWith(']')) return false;
  const b = blankLiterals(t.slice(1, -1));
  return /^[\s,'"`0-9.\-]*$/.test(b);
}

/** Blank every `{…}` span that is a literal-value object, index-preserving,
 *  so `{a:'x',b:'y'}[k]` reads as a lookup and not as the variables `a`/`b`. */
function blankLiteralObjects(expr) {
  let out = expr;
  for (;;) {
    const b = blankLiterals(out);
    let found = false;
    for (let i = 0; i < b.length; i++) {
      if (b[i] !== '{') continue;
      let d = 1, j = i + 1;
      while (j < b.length && d > 0) { if (b[j] === '{') d++; else if (b[j] === '}') d--; j++; }
      const span = out.slice(i, j);
      if (isLiteralValueObject(span)) {
        // Blank the following `[…]` too: the RESULT of indexing a
        // literal-value table is always one of its literal VALUES (or
        // undefined). The index itself is never printed, so it does not need
        // to be classified — which is what `{hit:'⭐ Hit',…}[rating]` needs.
        let k = j;
        const b2 = blankLiterals(out);
        while (k < out.length && /\s/.test(b2[k])) k++;
        if (b2[k] === '[') { let d2 = 1, q = k + 1;
          while (q < b2.length && d2 > 0) { if (b2[q] === '[') d2++; else if (b2[q] === ']') d2--; q++; }
          j = q; }
        out = out.slice(0, i) + ' '.repeat(j - i) + out.slice(j); found = true; break;
      }
    }
    if (!found) return out;
  }
}

/** The PRINTABLE sub-expressions of a compound expression, or null.
 *
 *  A ternary prints only its two BRANCHES — the condition is a truthiness
 *  test that never reaches the page. `a || b` and `a ?? b` can each print
 *  either side. `a && b` prints `b` when `a` is truthy and otherwise prints
 *  `a`'s FALSY value (false / 0 / '' / null / undefined), none of which can
 *  be markup — so only `b` needs classifying.
 *
 *  Splitting here is what lets the sweep see `g && g.homeScore != null ?
 *  `${esc(…)}` : ''` for what it is: a fully-escaped value behind a guard. */
function decompose(expr) {
  const b = blankLiterals(expr);
  const top = (pred) => { let d = 0;
    for (let i = 0; i < b.length; i++) { const c = b[i];
      if ('([{'.includes(c)) { d++; continue; }
      if (')]}'.includes(c)) { d--; continue; }
      if (d === 0) { const r = pred(i); if (r !== -1 && r !== undefined && r !== false) return i; } }
    return -1; };
  // ternary: first top-level `?` that is not `??` or `?.`
  const q = top(i => b[i] === '?' && b[i + 1] !== '?' && b[i + 1] !== '.' && b[i - 1] !== '?');
  if (q >= 0) {
    let d = 0, colon = -1;
    for (let i = q + 1; i < b.length; i++) { const c = b[i];
      if ('([{'.includes(c)) d++; else if (')]}'.includes(c)) d--;
      else if (c === '?' && b[i + 1] !== '?' && b[i + 1] !== '.' && d === 0) d += 1000;  // nested ternary
      else if (c === ':' && d === 0) { colon = i; break; }
      else if (c === ':' && d >= 1000) d -= 1000; }
    if (colon > q) return [expr.slice(q + 1, colon), expr.slice(colon + 1)];
  }
  const or = top(i => (b[i] === '|' && b[i + 1] === '|') || (b[i] === '?' && b[i + 1] === '?'));
  if (or >= 0) return [expr.slice(0, or), expr.slice(or + 2)];
  const and = top(i => b[i] === '&' && b[i + 1] === '&');
  if (and >= 0) return [expr.slice(and + 2)];
  return null;
}

/** `(a, b) => BODY` / `x => BODY` → the parameter list text. */
function arrowParams(text) {
  const b = blankLiterals(text);
  let d = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const c = b[i];
    if ('([{'.includes(c)) { d++; continue; }
    if (')]}'.includes(c)) { d--; continue; }
    if (d === 0 && c === '=' && b[i + 1] === '>') {
      const head = text.slice(0, i).trim();
      return head.startsWith('(') ? head.slice(1, -1) : head;
    }
  }
  return '';
}

/** `(a, b) => BODY` / `x => BODY` → BODY. The parameter LIST is a binding
 *  form, not an expression: classifying it reads `s2` and `r` as printed
 *  values and denies a callback that is actually fully escaped. */
function arrowBody(text) {
  const b = blankLiterals(text);
  let d = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const c = b[i];
    if ('([{'.includes(c)) { d++; continue; }
    if (')]}'.includes(c)) { d--; continue; }
    if (d === 0 && c === '=' && b[i + 1] === '>') return text.slice(i + 2);
  }
  return text;
}

/** Split a top-level comma list (params or call arguments). */
function splitTop(s) {
  const out = []; let d = 0, last = 0;
  for (let i = 0; i < s.length; i++) { const c = s[i];
    if ('([{'.includes(c)) d++; else if (')]}'.includes(c)) d--;
    else if (c === ',' && d === 0) { out.push(s.slice(last, i)); last = i + 1; } }
  if (s.slice(last).trim()) out.push(s.slice(last));
  return out;
}

function paramNames(params) {
  return splitTop(params).map(p => {
    const t = p.replace(/=[\s\S]*$/, '').trim();
    const m = /^\.{0,3}\s*([A-Za-z_$][\w$]*)$/.exec(t);
    return m ? m[1] : null;   // destructured / rest → unresolvable
  });
}

/** Every `{ … }` body range in a module, innermost-last. Used for LEXICAL
 *  alias resolution: a bare `n` must be resolved against the assignments in
 *  its own function, not against every `n =` in a 13,000-line file. */
function scopeRanges(code) {
  const out = [];
  const re = /(?:\)|=>)\s*\{/g; let m;
  while ((m = re.exec(code))) {
    const o = code.indexOf('{', m.index);
    if (o < 0) continue;
    const e = matchBrace(code, o);
    if (e > o + 1) out.push({ start: o + 1, end: e - 1 });
    re.lastIndex = o + 1;
  }
  out.push({ start: 0, end: code.length });   // module top level, last resort
  return out;
}

function returnsOf(body) {
  const out = []; const re = /(?<![\w$.])return\b/g; let m;
  while ((m = re.exec(body))) {
    let i = m.index + 6, d = 0; const start = i;
    while (i < body.length) { const c = body[i];
      if ('([{'.includes(c)) d++;
      else if (')]}'.includes(c)) { if (d === 0) break; d--; }
      else if (c === ';' && d === 0) break;
      else if (c === '\n' && d === 0 && body.slice(start, i).trim()) break;
      i++; }
    const t = body.slice(start, i).trim(); if (t) out.push(t);
    re.lastIndex = i;
  }
  return out;
}

// ─── THE CLASSIFIER (multi-module) ───────────────────────────────────────
// `sources` is { 'js/app.js': src, … } — every module the swept files can
// call into. Resolution is READ-ONLY: nothing outside the five swept files is
// edited, but a helper defined in scoring.js or data-model.js can still be
// PROVEN safe instead of being denied for living one import away.
function makeClassifier(sources, mainFile, { maxDepth = 10 } = {}) {
  const mods = new Map();
  for (const [f, src] of Object.entries(sources)) {
    mods.set(f, { file: f, src, code: lex(src).code, aliasMemo: new Map(), assignMemo: new Map() });
  }
  const main = mods.get(mainFile);
  const fnMemo = new Map(), fnDefMemo = new Map();

  /** Blank every MARKUP-BEARING template literal in `expr`, when `expr` lives
   *  in one of the SWEPT files. Transitivity: that template's own `${}`s are
   *  already separate sites in this very sweep, so re-judging them here would
   *  double-count them — and would deny a variable like `banner` whose whole
   *  value is a swept `<div class="chat-offline">…</div>` template. Templates
   *  WITHOUT markup are left alone: those are never collected as sites, so
   *  they still have to be judged where they are printed. */
  function blankSweptTemplates(expr, mod) {
    if (!SWEPT.includes(mod.file)) return expr;
    const { frames } = lex(expr);
    let out = expr;
    for (const f of frames) {
      if (!HAS_MARKUP.test(f.raw) || f.end == null) continue;
      out = out.slice(0, f.start) + ' '.repeat(f.end - f.start + 1) + out.slice(f.end + 1);
    }
    return out;
  }

  /** Raw assignment texts of `name`, resolved lexically (no classification). */
  function aliasRHS(mod, name, pos) {
    const scopes = pos == null ? [{ start: 0, end: mod.code.length }] : scopesFor(mod, pos);
    for (const sc of scopes) { const a = assignmentsOf(mod, name, sc); if (a.length) return a; }
    return [];
  }

  function scopesFor(mod, pos) {
    if (!mod.scopes) mod.scopes = scopeRanges(mod.code);
    const hits = mod.scopes.filter(s => pos >= s.start && pos <= s.end);
    hits.sort((a, b) => (a.end - a.start) - (b.end - b.start));   // innermost first
    return hits;
  }

  function assignmentsOf(mod, name, range) {
    const lo = range ? range.start : 0, hi = range ? range.end : mod.code.length;
    const memoKey = name + '@' + lo + ':' + hi;
    if (mod.assignMemo.has(memoKey)) return mod.assignMemo.get(memoKey);
    const out = [];
    const re = new RegExp(`(?:const|let|var)\\s+${name}\\s*=(?!=)|(?<![=!<>\\w$.])${name}\\s*=(?!=)`, 'g');
    let m;
    re.lastIndex = lo;
    while ((m = re.exec(mod.code))) {
      if (m.index > hi) break;
      let i = m.index + m[0].length, d = 0, tick = 0; const start = i;
      while (i < hi) { const c = mod.code[i];
        if (c === '`') { tick ^= 1; i++; continue; }
        if (tick) { i++; continue; }
        if ('([{'.includes(c)) d++;
        else if (')]}'.includes(c)) { if (d === 0) break; d--; }
        else if (c === '\n' && d === 0) {
          // A newline only ENDS the assignment if the next line does not
          // continue the expression. `const x = (cond)\n  ? a\n  : b;` is one
          // assignment; breaking at the newline captured only `(cond)` and
          // made every multi-line ternary look like a bare member expression.
          let k = i + 1;
          while (k < hi && /\s/.test(mod.code[k])) k++;
          const nxt = mod.code.slice(k, k + 2);
          if (!/^([?:.+\-*/%&|)\]},=]|=>|\?\?|&&|\|\|)/.test(nxt) && !/[?:.+\-*/%&|=([,]$/.test(mod.code.slice(start, i).trimEnd())) break;
          i++; continue;
        }
        else if ((c === ';' || c === ',') && d === 0) break;
        i++; }
      const t = mod.src.slice(start, i).trim(); if (t) out.push(t);
      re.lastIndex = i;
    }
    mod.assignMemo.set(memoKey, out); return out;
  }

  /** Look the function up in its OWN module first, then every other module. */
  function lookupFn(mod, name) {
    const key = mod.file + '|' + name;
    if (fnDefMemo.has(key)) return fnDefMemo.get(key);
    let hit = null;
    const own = findFn(mod.code, name);
    if (own) hit = { def: own, mod };
    else for (const m2 of mods.values()) { if (m2 === mod) continue; const d = findFn(m2.code, name); if (d) { hit = { def: d, mod: m2 }; break; } }
    fnDefMemo.set(key, hit); return hit;
  }

  // lex() blanks string/template CONTENT but leaves the delimiters, so the
  // structure test must tolerate quotes; numeric literals and arithmetic are
  // structure too (a number cannot be markup).
  const isStructureOnly = e => /^[\s()?:+\-*/%|&!,;'"`0-9.]*$/.test(blankLiterals(e));

  function classify(expr, mod, env, depth, stack, pos) {
    if (depth > maxDepth) return { ok: false, why: 'analysis depth exceeded' };
    if (isStructureOnly(expr)) return { ok: true, why: 'literal / ternary of literals' };
    if (isLiteralValueObject(expr)) return { ok: true, why: 'object literal whose every VALUE is a literal' };
    const parts = decompose(expr);
    if (parts) {
      for (const p of parts) {
        const r = classify(p, mod, env, depth + 1, stack, pos);
        if (!r.ok) return r;
      }
      return { ok: true, why: 'every PRINTABLE branch classifies (condition operands are never printed)' };
    }
    if (LITERAL_LOOKUP.test(blankLiterals(expr).trimStart()) && isStructureOnly(expr.replace(/\[[\s\S]*/, '')))
      return { ok: true, why: 'lookup table whose values are all string literals' };
    for (const lf of leavesOf(blankSweptTemplates(blankLiteralObjects(expr), mod))) {
      const r = leaf(lf, mod, env, depth, stack, pos);
      if (!r.ok) return { ok: false, why: r.why, leaf: r.leaf || lf.text.slice(0, 90) };
    }
    return { ok: true, why: 'every leaf classified' };
  }

  function leaf(lf, mod, env, depth, stack, pos) {
    const { head, text, isCall, callArgs, before, after } = lf;
    if (KEYWORDS.has(head)) return { ok: true, why: 'JS keyword' };
    if (SAFE_GLOBALS.has(head)) return { ok: true, why: 'safe global (number/boolean/date)' };
    if (head === 'String') {
      if (/^\s*(Number\s*\(|[\d.]+\s*$)/.test(callArgs)) return { ok: true, why: 'String(Number(…))' };
      return { ok: false, why: 'String() of a non-numeric value' };
    }
    if (NUM_METHOD.test(text)) return { ok: true, why: '.length/.size — a number' };
    if (INERT_STRING_METHOD.test(text)) return { ok: true, why: 'date/number formatter — cannot yield < > or "' };
    if (CMP_AFTER.test(after) || CMP_BEFORE.test(before)) return { ok: true, why: 'comparison operand, never printed' };
    if (COND_AFTER.test(after)) return { ok: true, why: 'ternary condition, never printed' };
    if (NOT_BEFORE.test(before) || KW_BEFORE.test(before)) return { ok: true, why: 'boolean / typeof / new context' };
    if (env.has(head) && lf.steps.length === 0) {
      const b = env.get(head);
      if (stack.has('p:' + head)) return { ok: true, why: 'recursive parameter' };
      const s2 = new Set(stack); s2.add('p:' + head);
      const r = classify(b.expr, b.mod, b.env, depth + 1, s2, b.pos);
      return r.ok ? { ok: true, why: `parameter bound to ${JSON.stringify(b.expr.trim().slice(0, 40))}` }
                  : { ok: false, why: `parameter ${head} ← ${r.why}`, leaf: r.leaf };
    }
    const mapIdx = lf.steps.map(s => s.kind === 'call' && (s.name === 'map' || s.name === 'flatMap')).lastIndexOf(true);
    if (mapIdx >= 0) {
      const tail = lf.steps.slice(mapIdx + 1);
      if (tail.every(s => PASSTHROUGH.has(s.name) || s.kind === 'index' || s.name === null)) {
        // If the RECEIVER is a literal array (CHAT_ACCENTS, REACTION_PALETTE
        // — the frozen data-model palettes), the callback's element parameter
        // is a literal, so bind it as one rather than denying it.
        const cbEnv = new Map(env);
        if (mapIdx === 0 || lf.steps.slice(0, mapIdx).every(st => PASSTHROUGH.has(st.name) || st.kind === 'index')) {
          for (const rhs of aliasRHS(mod, head, pos)) {
            if (!isLiteralValueArray(rhs)) continue;
            const pn = paramNames(arrowParams(lf.steps[mapIdx].args));
            if (pn[0]) cbEnv.set(pn[0], { expr: "''", env: new Map(), mod, pos });
            break;
          }
        }
        const r = classify(arrowBody(lf.steps[mapIdx].args), mod, cbEnv, depth + 1, stack, pos);
        return r.ok ? { ok: true, why: '.map() callback classifies' }
                    : { ok: false, why: `.map() callback — ${r.why}`, leaf: r.leaf };
      }
    }
    let steps = lf.steps.slice();
    while (steps.length && (PASSTHROUGH.has(steps[steps.length - 1].name) || steps[steps.length - 1].kind === 'index')) steps.pop();
    if (steps.length !== lf.steps.length) {
      if (!steps.length) {
        if (env.has(head)) { const b = env.get(head); const s2 = new Set(stack); s2.add('p:' + head);
          if (stack.has('p:' + head)) return { ok: true, why: 'recursive parameter' };
          const r = classify(b.expr, b.mod, b.env, depth + 1, s2, b.pos);
          return r.ok ? { ok: true, why: 'parameter, inert methods only' } : { ok: false, why: `parameter ${head} ← ${r.why}`, leaf: r.leaf }; }
        const r = aliasSafe(mod, head, depth, stack, pos);
        return r.ok ? r : { ok: false, why: `identifier ${head} — ${r.why}`, leaf: r.leaf };
      }
      const last = steps[steps.length - 1];
      const inner = { ...lf, steps,
        text: head + steps.map(s => '.' + (s.name || '')).join('') + (last.kind === 'call' ? '()' : ''),
        callee: head + steps.map(s => '.' + (s.name || '')).join(''),
        isCall: last.kind === 'call', callArgs: last.args || '' };
      return leaf(inner, mod, env, depth, stack, pos);
    }
    if (isCall && !lf.callee.includes('.')) {
      const r = fnSafe(mod, head, callArgs, env, depth, stack, pos);
      return r.ok ? r : { ok: false, why: `call ${head}() — ${r.why}`, leaf: r.leaf };
    }
    if (isCall) return { ok: false, why: `method call ${lf.callee}()` };
    if (lf.steps.length === 0) {
      const r = aliasSafe(mod, head, depth, stack, pos);
      return r.ok ? r : { ok: false, why: `identifier ${head} — ${r.why}`, leaf: r.leaf };
    }
    return { ok: false, why: `member expression ${lf.callee}` };
  }

  function fnSafe(mod, name, argsText, callerEnv, depth, stack, pos) {
    const hit = lookupFn(mod, name);
    if (!hit) return { ok: false, why: 'not defined in any swept or imported module' };
    const key = hit.mod.file + '|' + name + '|' + argsText.replace(/\s+/g, '');
    if (stack.has('f:' + key)) return { ok: true, why: 'recursive call' };
    if (fnMemo.has(key)) return fnMemo.get(key);
    const { def } = hit;
    const names = paramNames(def.params), args = splitTop(argsText);
    const env = new Map();
    names.forEach((n, i) => { if (n && args[i] !== undefined) env.set(n, { expr: args[i], env: callerEnv, mod, pos }); });
    const rets = def.expr ? [def.body.trim()] : returnsOf(def.body);
    let res;
    if (!rets.length) res = { ok: false, why: 'no return statement found' };
    else {
      res = { ok: true, why: `every return of ${name}() classifies` };
      const s2 = new Set(stack); s2.add('f:' + key);
      for (const r of rets) {
        const c = classify(r, hit.mod, env, depth + 1, s2, def.start);
        if (!c.ok) { res = { ok: false, why: `return ${JSON.stringify(r.replace(/\s+/g, ' ').slice(0, 44))}: ${c.why}`, leaf: c.leaf }; break; }
      }
    }
    fnMemo.set(key, res); return res;
  }

  function aliasSafe(mod, name, depth, stack, pos) {
    // LEXICAL resolution — walk scopes innermost-outward and use the FIRST
    // scope that actually binds `name`. Resolving file-wide (what round 2's
    // hand-listed LOCAL_ALIASES effectively did) unions every unrelated `n =`
    // in a 13,000-line file and makes the verdict meaningless.
    const scopes = pos == null ? [{ start: 0, end: mod.code.length }] : scopesFor(mod, pos);
    let rhss = [], range = null;
    for (const sc of scopes) { const a = assignmentsOf(mod, name, sc); if (a.length) { rhss = a; range = sc; break; } }
    const key = 'a:' + mod.file + '|' + name + '|' + (range ? range.start : 'none');
    if (stack.has(key)) return { ok: true, why: 'recursive alias' };
    if (mod.aliasMemo.has(key)) return mod.aliasMemo.get(key);
    mod.aliasMemo.set(key, { ok: true, why: 'in progress' });
    let res;
    if (!rhss.length) res = { ok: false, why: 'never assigned in this file (a parameter, an import, or a destructured binding) — deny-by-default' };
    else {
      res = { ok: true, why: `every assignment of ${name} classifies` };
      const s2 = new Set(stack); s2.add(key);
      for (const rhs of rhss) {
        const c = classify(rhs, mod, new Map(), depth + 1, s2, range ? range.start : pos);
        if (!c.ok) { res = { ok: false, why: `assigned ${JSON.stringify(rhs.replace(/\s+/g, ' ').slice(0, 44))}: ${c.why}`, leaf: c.leaf }; break; }
      }
    }
    mod.aliasMemo.set(key, res); return res;
  }

  return (expr, pos) => classify(expr, main, new Map(), 0, new Set(), pos);
}

// ── THE FIVE SWEPT FILES, plus every module they can call into. Resolution
// across modules is READ-ONLY: nothing outside the swept files is edited, but
// a helper that lives one import away (formatSpread in data-model.js,
// getPickStatusClass in scoring.js) can be PROVEN safe instead of denied.
// SEC F4 / reviewer N2 (2026-09-16) — js/auth.js JOINS THE SWEEP AT ZERO.
// It has no markup-bearing template and therefore no sinks today, which is
// exactly why now is the time to add it: a file enters the ratchet at zero and
// the FIRST interpolation anyone ever writes into it arrives already covered.
// Added after it, not before it, the same template lands as a pre-existing
// finding that someone has to decide about under deadline. It renders no DOM
// today by design (app.js owns every render for DI-180/181/184) — but it is
// the module that will hold league names, member display names and account
// emails, i.e. values typed into a Google profile by someone outside this
// league, which is the highest-risk input class in the whole app.
// SECURITY GATE FINDING 4 (2026-09-25) — `js/admin-panel.js` JOINS THE SWEEP
// AT ZERO, the same reasoning as `js/auth.js` above. It was mutation-proven
// to be a gap: an unescaped `${kv.maintenanceBanner}` (a super-admin-typed
// string, rendered on the Admin panel's Super Admin tab, read by every
// signed-in account per DI-344 §3.1's `using (true)` SELECT policy) shipped
// green because only three narrow scans ever looked at this file, not this
// suite's full markup-sink sweep. Enters at zero, the same as auth.js did.
// SECURITY AUDIT (full-app, 2026-09-26) — FOUR MORE FILES JOIN AT ZERO, the
// js/auth.js / js/admin-panel.js precedent above: js/control-center.js (the
// drawer: display name, league name, alma mater), js/leagues-home.js (league
// and member names across leagues), js/week-wizard.js (week/game labels) and
// js/icons.js (the SVG family every chrome surface interpolates). All four
// render markup and none was in this suite's full sweep. [9c-1c] below
// asserts each sweeps clean with NO exemption of its own.
const SWEPT = ['js/app.js', 'js/chat-ui.js', 'js/extra-point.js', 'js/recap.js', 'js/notifications.js', 'js/auth.js', 'js/admin-panel.js',
  'js/control-center.js', 'js/leagues-home.js', 'js/week-wizard.js', 'js/icons.js'];
// UN-312 (2026-09-29): 'js/brand.js' joins the resolvable set (it is a literal-only module, never swept). app.js
// injects getGateMarkSVG() — the filled Munera logo, a fixed template literal with no interpolation — raw, exactly
// like GOOGLE_G_MARK_SVG; a call the classifier cannot resolve is reported as a NEW unclassified site, so it has to
// be able to read the function. HONEST LIMIT (mutation-checked 2026-09-29): the classifier resolves the call and
// rejects a concatenated return, but it does not police an interpolation added INSIDE a returned template in this
// module — brandtest.mjs [11c3] does that (getGateMarkSVG() must stay a parameterless, interpolation-free literal).
// This edit widens what the ratchet can resolve; it loosens nothing.
const RESOLVABLE = [...SWEPT, 'js/data-model.js', 'js/scoring.js', 'js/storage.js', 'js/chat.js',
  'js/scribeLines.js', 'js/history-2025.js', 'js/data-provider.js', 'js/backend.js', 'js/chatTransport.js', 'js/roles.js', 'js/brand.js'];
const SRC = {};
for (const f of RESOLVABLE) SRC[f] = await readFile(new URL('./' + f, import.meta.url), 'utf8');

const norm = e => e.replace(/\s+/g, ' ').trim();

/** Unclassified sites for one file, as { line, expr } (expr normalised). */
function sweepFile(file, overrideSrc = null) {
  const sources = { ...SRC };
  if (overrideSrc !== null) sources[file] = overrideSrc;
  const classify = makeClassifier(sources, file);
  const src = sources[file];
  const out = [];
  for (const s of markupSites(src)) {
    const v = classify(s.expr, s.index);
    if (!v.ok) out.push({ line: src.slice(0, s.index).split('\n').length, expr: norm(s.expr), why: v.why });
  }
  return out;
}

// [9a] CANARIES — a scanner that matches nothing makes every assertion below
// vacuous (RG-27). Three SYNTHETIC unwrapped sites, one per HTML context, are
// injected into an in-memory COPY of a real swept file (never the file on
// disk — CLAUDE.md's mutation rule) and the scanner must report all three.
const CANARY_SRC = SRC['js/recap.js'] + `
function __xssCanary(evil) {
  const a = \`<div class="c">\${evil.content}</div>\`;                 // element content
  const b = \`<input value="\${evil.attr}" />\`;                       // double-quoted attribute
  const c = \`<ul>\${[1].map(() => \`<li>\${evil.nested}</li>\`).join('')}</ul>\`;  // nested template
  return a + b + c;
}`;
const canaryHits = sweepFile('js/recap.js', CANARY_SRC).map(h => h.expr);
for (const [label, expr] of [['element content', 'evil.content'], ['double-quoted attribute', 'evil.attr'], ['nested template', 'evil.nested']]) {
  assert(canaryHits.includes(expr), `[9a] canary: the sweep reports the synthetic unwrapped site in ${label} (got: ${JSON.stringify(canaryHits.slice(-4))})`);
}
// …and the WRAPPED forms of the same three are NOT reported — a scanner that
// flags everything is as useless as one that flags nothing.
const CLEAN_SRC = SRC['js/recap.js'] + `
function __xssClean(evil) {
  const a = \`<div class="c">\${esc(evil.content)}</div>\`;
  const b = \`<input value="\${esc(evil.attr)}" />\`;
  const c = \`<ul>\${[1].map(() => \`<li>\${esc(evil.nested)}</li>\`).join('')}</ul>\`;
  return a + b + c;
}`;
const cleanHits = sweepFile('js/recap.js', CLEAN_SRC).map(h => h.expr);
for (const expr of ['esc(evil.content)', 'esc(evil.attr)', 'esc(evil.nested)']) {
  assert(!cleanHits.includes(expr), `[9a] canary: the sweep does NOT report ${expr} — esc() is recognised as a wrapper`);
}
assert(cleanHits.length === sweepFile('js/recap.js').length,
  '[9a] canary: wrapping the three synthetic sites removes all three findings and adds none');

// [9b] THE EXEMPTIONS TABLE. Every entry names a FILE, the EXACT expression
// text, and a reason a reviewer can check. Exact text is the whole point: an
// exemption must not be able to absorb a future site that merely resembles it.
const EXEMPTIONS = [
  // ── chat-ui.js — PRE-ESCAPED BY THE CALLER ──────────────────────────────
  // bodyHTML() (chat-ui.js:878) opens with `const escaped = esc(m.body)` and
  // then DELIBERATELY emits markup: it splits the escaped text on URL_RE and
  // hands each URL token to renderUrlToken(). So everything downstream of it
  // is already escaped, and escaping again prints `&amp;amp;` for the `&` in
  // every ordinary query string — which is exactly what [11c] asserts must
  // not happen. Wrapping these would break the feature, not harden it.
  { file: 'js/chat-ui.js', expr: "bodyHTML(m).replace(/\\n/g, '<br>')",
    why: "bodyHTML() escapes at chat-ui.js:878 and then intentionally emits markup (links, <br>); re-escaping would print the escaped tags — guarded by [11] and the chat-fold suite" },
  { file: 'js/chat-ui.js', expr: "m.deleted ? '<span class=\"chat-tombstone\">\u{1FAA6} message withdrawn</span>' : bodyHTML(m).replace(/\\n/g, '<br>')",
    why: "same bodyHTML() contract as above; the other branch is a string literal" },
  { file: 'js/chat-ui.js', expr: 'href',
    why: "renderUrlToken(): `raw` arrives already escaped from bodyHTML(), and `href` additionally passes the http(s)-only scheme allow-list two lines up (C6, round 2) — [11a]/[11c] are the guards" },
  { file: 'js/chat-ui.js', expr: 'url',
    why: "renderUrlToken(): the link TEXT is the same already-escaped token bodyHTML() produced; esc() here would double-escape every &-bearing query string ([11c])" },

  // ── chat-ui.js — SCANNER LIMITATION, value is itself swept markup ────────
  // These three hold a markup template whose OWN interpolations are separate
  // sites in this same sweep (all already esc()'d). The scanner cannot follow
  // the assignment: `html` is built with `+=`, and whatsNewLinkHTML()'s value
  // reaches its two sinks through esc() at chat-ui.js:1390 but is derived via
  // String(m.meta?.version || ''), which the String() rule does not accept.
  { file: 'js/chat-ui.js', expr: 'html',
    why: "pillsHTML(): accumulated with `html +=` from the swept template at chat-ui.js:702-703, whose every interpolation (esc(tag), esc(gameShort(...)), dot(n)) is itself a site in this sweep" },
  { file: 'js/chat-ui.js', expr: 'scrollBodyHTML',
    why: "renderChatPage(): a ternary over searchResultsHTML() and a swept markup template (chat-ui.js:1717-1719); both branches' interpolations are separate sites in this sweep" },
  // ── DI-182a (Step 3b) — the alma-mater <option> list ────────────────────
  // This value is a LIST OF <option> ELEMENTS, i.e. markup on purpose, so a
  // wrapper here would print the tags instead of rendering them. Both of its
  // two producers escape every player-supplied value inside it:
  //   • the registered provider is js/app.js's buildAlmaMaterOptions(), whose
  //     every option is built as `<option value="${escHtml(...)}">${escHtml(...)}</option>`
  //     — the SAME function, and the same escaping, the commissioner's Edit
  //     Player modal has always used (DI-182f: one implementation, two callers);
  //   • the unregistered fallback, four lines above this site, is
  //     `<option value="${esc(cur)}" selected>${esc(cur)}</option>` — a site in
  //     THIS sweep, and visibly wrapped.
  // The scanner denies only because the value crosses a module boundary through
  // an injected function reference it cannot resolve statically. The values
  // themselves are ESPN team names plus whatever the player's record holds, and
  // that record's path to a sink is what [8b] already covers.
  { file: 'js/chat-ui.js', expr: "almaOptionsHTML(player?.almaMater || '')",
    why: "almaOptionsHTML() returns <option> MARKUP by design; both producers escape every interpolation inside it — js/app.js's buildAlmaMaterOptions() uses escHtml() on value and label (the same call the commissioner modal makes), and the unregistered fallback in chat-ui.js uses esc() and is itself a site in this sweep" },

  { file: 'js/chat-ui.js', expr: "m.deleted ? '' : whatsNewLinkHTML(m)",
    why: "whatsNewLinkHTML() returns '' or a template whose BOTH interpolations are esc()'d at chat-ui.js:1390; the scanner denies only because the value is String(m.meta?.version || '') and its String() rule accepts String(Number(...)) alone" },

  // ── app.js — renderSettingsPage()'s four control-center.js calls
  //    (renderStarredPanels / renderSettingsAccordion / renderFeedbackRulesGroup
  //    / renderHelpFooter) — EXEMPTIONS REMOVED 2026-09-26 (security audit,
  //    full-app): js/control-center.js now sits in SWEPT/RESOLVABLE, so the
  //    classifier resolves these calls through the file's own sweep ([9c-1c]'s
  //    ratchet) and the four entries became dead ([9b-ii] fails a dead
  //    exemption, correctly — it would pre-approve whatever lands on that text next).

  // ── app.js — icon('almaMater') (DI-330, Group E, 2026-09-25) ────────────
  // icon(name) (js/icons.js) is called here with a single HARD-CODED STRING
  // LITERAL argument at every one of its four Alma Mater Watch call sites —
  // never a variable, never player/game data. There is no injection vector:
  // the only way this expression's output ever changes is a code edit to
  // js/icons.js's own frozen ICONS map. Same class of triviality as a
  // literal '' branch elsewhere in this sweep.
  { file: 'js/app.js', expr: "icon('almaMater')",
    why: "js/icons.js's icon(name) called with a hard-coded string literal — no data flows through this expression at all, so it cannot carry an injection" },
  // DI-443 (UN-386, 2026-09-29) — the two ICON-ONLY alma-mater badges (the Comm
  // Games-tab slate row and the games-admin card) carry an aria-label so
  // VoiceOver names them (a `title` does not fire on touch). Same triviality:
  // name AND label are hard-coded string literals, never a variable.
  { file: 'js/app.js', expr: "icon('almaMater', { label: 'Alma mater game' })",
    why: "js/icons.js's icon(name, opts) called with two hard-coded string literals — no data flows through this expression" },

  // REVIEWER BLOCK 4 (pass-2, 2026-09-25) — renderSourceBadge()'s four
  // data-quality glyphs (icons.js:F8's converted badges). Same triviality as
  // icon('almaMater') immediately above: name AND label are both hard-coded
  // string literals at every one of these four call sites, never a variable.
  // (icon()'s own aria-label attribute-value sink is separately escaped —
  // js/icons.js's _escAttr(), SECURITY N2 — this exemption is only about
  // whether js/app.js's OWN interpolation of the icon() call's return value
  // can carry player/game data, which it cannot: neither argument does.)
  // N1 (DI-430 touched-screen audit, 2026-09-30) — the zero-week empty state's glyph on Picks and Dashboard: icon(name) called with a hard-coded string literal.
  { file: 'js/app.js', expr: "icon('calendarWeek')",
    why: "js/icons.js's icon(name) called with a hard-coded string literal — no data flows through this expression at all, so it cannot carry an injection" },
  { file: 'js/app.js', expr: "icon('calendarWeek', { label: 'ESPN Historical' })",
    why: "js/icons.js's icon(name, opts) called with two hard-coded string literals — no data flows through this expression" },
  // STEP B(14) (3c fix window, third pass) — the week wizard's status-button
  // glyph. wizardStatusIconHTML() returns icon(b.icon) or '', where b.icon is
  // a name from js/week-wizard.js's FROZEN module-constant FULL_STATUS_BUTTONS
  // table (never player/game data), and icon() only ever returns one of the
  // hand-authored ICONS strings or '' for an unknown name (iconstest [7a]).
  { file: 'js/app.js', expr: 'wizardStatusIconHTML(b)',
    why: "returns a js/icons.js ICONS literal (or '') selected by a name from a frozen constant table in js/week-wizard.js — no data flows through it" },
  { file: 'js/app.js', expr: "icon('clipboard', { label: 'Demo' })",
    why: "js/icons.js's icon(name, opts) called with two hard-coded string literals — no data flows through this expression" },
  { file: 'js/app.js', expr: "icon('pin', { label: 'Proposed' })",
    why: "js/icons.js's icon(name, opts) called with two hard-coded string literals — no data flows through this expression" },
  { file: 'js/app.js', expr: "icon('warning', { label: 'Partial' })",
    why: "js/icons.js's icon(name, opts) called with two hard-coded string literals — no data flows through this expression" },
  // The three National TV sites (a filter-chip label, a live-badge, a
  // scheduled-badge) — same triviality, no `{ label }` option needed since
  // visible text sits beside each (decorative default, per icon()'s own
  // header comment).
  { file: 'js/app.js', expr: "icon('tv')",
    why: "js/icons.js's icon(name) called with a hard-coded string literal — no data flows through this expression at all, so it cannot carry an injection" },
  // Reviewer round 3, item 5 (2026-09-26) — the backend-error-banner icon and
  // the invite-card's Copy/Rotate buttons. Same triviality as icon('tv')
  // immediately above: each is a hard-coded string literal, no `{ label }`
  // option needed since visible text sits beside every one of these.
  { file: 'js/app.js', expr: "icon('warning')",
    why: "js/icons.js's icon(name) called with a hard-coded string literal — no data flows through this expression at all, so it cannot carry an injection" },
  { file: 'js/app.js', expr: "icon('clipboard')",
    why: "js/icons.js's icon(name) called with a hard-coded string literal — no data flows through this expression at all, so it cannot carry an injection" },
  { file: 'js/app.js', expr: "icon('refresh')",
    why: "js/icons.js's icon(name) called with a hard-coded string literal — no data flows through this expression at all, so it cannot carry an injection" },
  // Full-app review Step 6 (2026-09-26) — the backend-error banner's Dismiss
  // (was a literal ✕). Same reasoning: a hard-coded name, no label, no data.
  { file: 'js/app.js', expr: "icon('close')",
    why: "js/icons.js's icon(name) called with a hard-coded string literal — no data flows through this expression at all, so it cannot carry an injection" },
  // v0.27.0 fix (2026-09-27) — the header #control-center-trigger fill
  // (renderControlCenterTrigger()): the native Munera mark and the web
  // chevron affordance. Same triviality as icon('close') above.
  { file: 'js/app.js', expr: "icon('munera')",
    why: "js/icons.js's icon(name) called with a hard-coded string literal — no data flows through this expression at all, so it cannot carry an injection" },
  // DI-393 (UN-353, 2026-09-27) — updateSyncBadge()'s header sync icon.
  // `iconName` is read from SYNC_ICON_BY_STATUS (js/app.js, module scope) —
  // a lookup table whose every value is a hard-coded string literal, keyed
  // by `status`, which itself is never user-typed text: it arrives from the
  // backend adapter's own small, enumerated vocabulary (synced/syncing/
  // error/refused/offline). No player-authored data flows through it.
  // DI-399(a) (UN-359, 2026-09-28) — no `{ label }` argument any more:
  // #sync-badge itself is now the interactive control and carries its own
  // aria-label via setAttribute() (a raw string assignment, not an
  // innerHTML sink, so it is outside this scanner's template-literal
  // surface entirely — SYNC_TAP_LABEL_BY_STATUS is the same shape of
  // closed, literal-valued lookup table as SYNC_ICON_BY_STATUS above).
  { file: 'js/app.js', expr: "icon(iconName)",
    why: "iconName resolves through SYNC_ICON_BY_STATUS, a literal-valued lookup table keyed on the backend adapter's own small enumerated status vocabulary — never user data" },
  // DI-418 (UN-373, 2026-09-28) — renderLeaguesHomeOverlayBody()'s back
  // affordance, mirroring showLeaguePageOverlay()'s own back-chevron shape.
  // Same triviality as icon('close')/icon('munera') above: a hard-coded
  // string literal, no `{ label }` option, no data flows through it.
  { file: 'js/app.js', expr: "icon('chevronLeft')",
    why: "js/icons.js's icon(name) called with a hard-coded string literal — no data flows through this expression at all, so it cannot carry an injection" },
  // DI-394 (UN-354, 2026-09-27) — weekNavCardHTML()'s shared viewing-week
  // card (js/app.js), reused by both Picks (renderPicksWeekNav()) and
  // Dashboard (renderDashboardWeekNav()). `dataAttr` is a function
  // PARAMETER, never assigned from data — both call sites in this file pass
  // a hard-coded string literal ('picks-week' / 'dashboard-week'). `prevBtn`/
  // `nextBtn` are markup fragments this SAME function builds two lines
  // above their interpolation site; the only real value either carries
  // (`prevId`/`nextId`, a week id) is already routed through `escHtml()`
  // at the point the fragment itself is built — re-interpolating the
  // already-escaped fragment into the outer template carries nothing raw.
  { file: 'js/app.js', expr: "dataAttr",
    why: "a function parameter of weekNavCardHTML(), never assigned from data — both call sites (renderPicksWeekNav()/renderDashboardWeekNav()) pass a hard-coded string literal" },
  { file: 'js/app.js', expr: "prevBtn",
    why: "a markup fragment weekNavCardHTML() builds two lines above this interpolation; its only real value (prevId) is already escHtml()-wrapped where the fragment itself is constructed" },
  { file: 'js/app.js', expr: "nextBtn",
    why: "same shape as prevBtn immediately above — a markup fragment weekNavCardHTML() builds two lines above this interpolation, its only real value (nextId) already escHtml()-wrapped where the fragment itself is constructed" },
  // v0.27.0 UX Revamp post-deploy pass (2026-09-27, REVIEWER note 4) — the
  // `icon('chevronRight')` exemption above/below this comment's old location
  // is REMOVED, not left dead: it existed only for the web trigger's chevron
  // affordance (renderControlCenterTrigger()), and that trailing chevron is
  // gone — a "›" reads as push-forward navigation on iOS, not "open a
  // drawer" (the coordinator's design ruling). `icon('chevronRight')` as a
  // literal string has zero remaining hits in js/app.js (confirmed by grep);
  // a dead exemption pre-approves whatever lands on that exact text next, so
  // it is deleted here rather than kept "just in case."
  // renderWeekStatusButtons() (2026-09-26, reviewer round 3 item 5) — same
  // reasoning as wizardStatusIconHTML(b) immediately above: `x.icon` is a
  // name from THIS function's own frozen-shape local table `t` (never
  // player/game data), and icon() only ever returns one of the hand-authored
  // ICONS strings or '' for an unknown name (iconstest [1]).
  { file: 'js/app.js', expr: 'icon(x.icon)',
    why: "returns a js/icons.js ICONS literal (or '') selected by a name from renderWeekStatusButtons()'s own local, hard-coded table — no data flows through it" },

  // ── app.js — the Standard/Compact layout-toggle markup (reviewer BLOCK F9,
  // 2026-09-25 — hidden under isNativeShell(), a dead control on native) ───
  // The whole ternary is a STATIC markup block: `isNativeShell()` is a
  // boolean with no injection surface, and the two nested interpolations
  // inside it (`currentDashLayout==='standard'?' active':''` /
  // `currentDashLayout==='compact'?' active':''`) each resolve to one of two
  // hard-coded literal strings (' active' or '') — `currentDashLayout` is
  // never itself interpolated, only compared. No player/game data anywhere
  // in this expression.
  { file: 'js/app.js', expr: "isNativeShell() ? '' : ` <div class=\"layout-toggle\" role=\"group\" aria-label=\"View density\"> <button class=\"layout-toggle-btn${currentDashLayout==='standard'?' active':''}\" data-layout=\"standard\" title=\"Wide matrix\">Standard</button> <button class=\"layout-toggle-btn${currentDashLayout==='compact'?' active':''}\" data-layout=\"compact\" title=\"Mobile-friendly stacked view\">Compact</button> </div>`",
    why: "isNativeShell() is a boolean with no injection surface; the two nested interpolations each resolve to one of two hard-coded literal strings (' active' or ''), never interpolating currentDashLayout's actual value" },

  // ── app.js — leagueSelectorListHTML()'s leagueCardHTML() call — EXEMPTION
  //    REMOVED 2026-09-26 (security audit, full-app): js/leagues-home.js now
  //    sits in SWEPT/RESOLVABLE and the call resolves through its own sweep
  //    ([9c-1c]'s ratchet); the entry was dead ([9b-ii]).

  // ── app.js — renderWeekWizardTrackerHTML() (DI-C1, UX Revamp wiring pass
  //    3b, 2026-09-25) — both NUMBERS, no data flows through either ────────
  // `activeStep` (renamed from the bare `step`, REVIEWER minor finding
  // 916bdb7 — a generic identifier's exemption text matches file-wide on
  // exact-equality, so a future UNRELATED `${step}` interpolation elsewhere
  // in this 25k-line file would silently inherit this "safe" verdict; the
  // rename makes the exemption text specific to this one concept instead)
  // is `_weekWizardStep`, a module int always 1-6 or set from
  // `selectWizardEntry()`'s own return — never a string a player typed. The
  // loop's own `s.step` (`WIZARD_STEPS`, js/week-wizard.js — a frozen array
  // of six literal `{step, id, title}` objects) only ever appears inside
  // ternaries between two hard-coded string literals (' active'/''
  // and ' done'/''), which never reach this sweep at all — no player/game
  // data flows through it either.
  { file: 'js/app.js', expr: 'activeStep', why: "renderWeekWizardTrackerHTML()'s step number — always 1-6, from the module's own _weekWizardStep int or selectWizardEntry()'s return, never player-typed text; renamed from the generic `step` so this exemption cannot accidentally cover an unrelated future site" },
  { file: 'js/app.js', expr: 'WIZARD_STEP_COUNT',
    why: "js/week-wizard.js's WIZARD_STEPS.length — a frozen array's own .length, a number, imported as a constant" },

  // ── app.js — renderWeekWizardManageHTML() (DI-C1 §2.6) — b.cls/b.to ─────
  // `b` is one row of `narrowedWeekStatusButtons(week.status)`'s return —
  // js/week-wizard.js's FULL_STATUS_BUTTONS, a frozen, hand-authored literal
  // table of CSS class names ('btn-primary'/'btn-secondary'/'btn-ghost')
  // and status-machine targets ('draft'/'open'/'locked'/'live'/'final').
  // Neither field is ever player/game data — `b.label` (the one field on
  // the same row that IS shown as text) is already escHtml()'d, one line
  // over, which is why only cls/to (attribute-position, closed-vocabulary)
  // needed this exemption at all.
  { file: 'js/app.js', expr: 'b.cls', why: "narrowedWeekStatusButtons()'s row — a CSS class name from week-wizard.js's own frozen FULL_STATUS_BUTTONS literal table, never player/game data" },
  { file: 'js/app.js', expr: 'b.to', why: "narrowedWeekStatusButtons()'s row — a status-machine target string from the same frozen literal table, never player/game data" },
];

// [9b-i] AN EXEMPTION CANNOT BE A WILDCARD. Matching is `===` on normalised
// expression text, so nothing regex-shaped, empty, or truncated can stand in
// for a class of sites. This is the guard on the guard.
for (const e of EXEMPTIONS) {
  assert(typeof e.expr === 'string' && e.expr.length > 0,
    '[9b-i] every exemption carries a non-empty exact expression text');
  assert(!/[*?]|\.\*|\\\w/.test(e.expr) || !(e.expr.startsWith('/') || e.expr.includes('.*')),
    `[9b-i] no exemption is written as a pattern (got: ${JSON.stringify(e.expr)})`);
  assert(typeof e.why === 'string' && e.why.length >= 20,
    `[9b-i] every exemption carries a reason a reviewer can verify (got: ${JSON.stringify(e.why)})`);
  assert(SWEPT.includes(e.file), `[9b-i] every exemption names one of the five swept files (got: ${e.file})`);
}
{
  // A synthetic wildcard-shaped exemption must NOT silence the canary.
  const wildcard = [{ file: 'js/recap.js', expr: '.*', why: 'a wildcard that must never be honoured by the matcher' }];
  const silenced = canaryHits.filter(x => !wildcard.some(w => w.expr === x));
  assert(silenced.length === canaryHits.length,
    '[9b-i] a wildcard exemption silences NOTHING — the matcher is exact equality, never a pattern');
}

// [9b-ii] NO DEAD EXEMPTIONS. An exemption that matches nothing is either a
// site somebody already fixed (and the exemption now silently pre-approves
// the next thing that lands on that text) or a typo that was never doing any
// work. Both read as green. Every entry must correspond to a live finding.
{
  const byFile = {};
  for (const e of EXEMPTIONS) (byFile[e.file] = byFile[e.file] || []).push(e);
  for (const [file, entries] of Object.entries(byFile)) {
    const live = new Set(sweepFile(file).map(h => h.expr));
    for (const e of entries) {
      assert(live.has(e.expr),
        `[9b-ii] the exemption for ${file} "${e.expr.slice(0, 50)}" still matches a real finding (a dead exemption pre-approves whatever lands on that text next)`);
    }
  }
}

// [9c-0] notifications.js CONTAINS NO HTML AT ALL. Asserted, not assumed: it
// is in the swept list precisely so that the day someone adds a template with
// markup to it, that template arrives already covered.
assert(markupSites(SRC['js/notifications.js']).length === 0,
  `[9c-0] js/notifications.js has no markup-bearing template literal — it builds notification TEXT, never HTML (found: ${markupSites(SRC['js/notifications.js']).length})`);

// [9c-0b] SEC F4 / reviewer N2 — the same statement for js/auth.js, which
// enters this sweep at ZERO sinks. It owns the Supabase client, session state
// and membership records; js/app.js owns every render for DI-180/181/184. If
// that division ever slips and a template lands here, this line fails on the
// day it is written rather than at the next security review.
assert(markupSites(SRC['js/auth.js']).length === 0,
  `[9c-0b] js/auth.js has no markup-bearing template literal — it is the data/logic half of the sign-in front door and renders no DOM (found: ${markupSites(SRC['js/auth.js']).length})`);
{
  // …and prove the scanner can actually see into this file, so the line above
  // is a real zero and not a path that silently resolves to nothing (RG-27).
  const CANARY_AUTH = SRC['js/auth.js'] + `
function __authCanary(evil) { return \`<div class="c">\${evil.leagueName}</div>\`; }`;
  const hits = sweepFile('js/auth.js', CANARY_AUTH).map(h => h.expr);
  assert(hits.includes('evil.leagueName'),
    `[9c-0b] canary: an unwrapped interpolation added to js/auth.js IS reported (got: ${JSON.stringify(hits.slice(-3))})`);
}
assert(sweepFile('js/auth.js').length === 0,
  `[9c-0b] …and the live file sweeps clean — js/auth.js enters the ratchet at zero, with no exemption of its own (found: ${sweepFile('js/auth.js').length})`);

// [9c-1] FULL STRENGTH — every ${…} in these files is (i), (ii) or (iii).
for (const file of ['js/extra-point.js', 'js/recap.js', 'js/notifications.js', 'js/chat-ui.js']) {
  const hits = sweepFile(file).filter(h => !EXEMPTIONS.some(e => e.file === file && e.expr === h.expr));
  assert(hits.length === 0,
    `[9c-1] ${file}: every interpolation in a markup-bearing template is wrapped, provably safe, or exempted — found ${hits.length}: ${hits.slice(0, 6).map(h => `${h.line}:${h.expr.slice(0, 60)}`).join(' | ')}`);
}

// [9c-1c] SECURITY AUDIT (full-app, 2026-09-26) — the four files that joined
// SWEPT. The audit asked for all four "at zero backlog"; against the real code
// only js/week-wizard.js is at zero. The other three carry sites that are safe
// by construction but not provable by this classifier: js/control-center.js
// escapes through its INJECTED `ctx.escHtml(...)` and glyphs through
// `ctx.icon(...)` (a dependency bag the classifier cannot follow), plus reducer
// enums (`state.pane`/`state.phase`) and internal row ids; js/leagues-home.js's
// injected `icon`/`roleBadgeHTML`; js/icons.js's own `_escAttr(label)`
// (a String().replace() chain). Teaching the classifier those shapes is a
// security-suite design change, deliberately NOT made under the stamp; the
// three files are pinned as RATCHETS instead — the ADMIN_PANEL_BACKLOG shape
// ([9c-1b] below): digest + count, generated from the live sweep on
// 2026-09-26, only tightens, and any NEW unclassified site fails. Pinned, not
// approved. week-wizard.js is asserted at zero with no exemptions.
assert(sweepFile('js/week-wizard.js').length === 0,
  `[9c-1c] js/week-wizard.js sweeps clean at ZERO backlog, no exemptions (found ${sweepFile('js/week-wizard.js').length})`);
const NEW_SWEPT_BACKLOG = {
  'js/control-center.js': [
    { d: "2e594f378c", n: 1, t: "initials" },
    { d: "82a3537ff0", n: 1, t: "name" },
    { d: "098fe0e15d", n: 1, t: "leagueName" },
    { d: "8728666a04", n: 1, t: "versionLine" },
    { d: "bd23753159", n: 1, t: "backIcon" },
    { d: "18a6e623ab", n: 1, t: "ctx.escHtml(player.displayName || '')" },
    { d: "afed03527f", n: 1, t: "ctx.escHtml(player.initials || '')" },
    { d: "e1f7419945", n: 1, t: "almaIcon" },
    // DI-423 AMENDMENT (2026-09-28) — the retired free-text <input>'s
    // `ctx.escHtml(player.almaMater || '')` interpolation is GONE (replaced
    // by the <select> above, whose ctx.bodies.almaMaterOptionsHTML pin
    // carries the escaping now) — the stale pin is removed, not left behind.
    { d: "2920cdbf16", n: 2, t: "ctx.escHtml(label)" },
    // Finding 6 (app-shell part 3A review, 2026-09-27) — accordionRow()'s new
    // OPTIONAL `secondary` line, escaped through the SAME injected
    // `ctx.escHtml(...)` every other row-text site in this file already uses.
    { d: "06b13ef1a8", n: 1, t: "ctx.escHtml(secondary)" },
    // REVIEWER ROUND 2 (RG-298, 2026-09-28) — grew 3 -> 5: "Your Leagues"
    // (D1, profileAccountActionsHTML()) and "Help Center" (minor finding,
    // renderFeedbackRulesGroup()) both gained the SAME chevron every other
    // drill-in row already carries — reusing the identical `chevron` local
    // each function already computes, not a new expression shape.
    { d: "b55ac8822f", n: 5, t: "chevron" },
    { d: "e14d65d016", n: 1, t: "ctx.escHtml(p.target)" },
    { d: "2c7c720cbc", n: 1, t: "ctx.escHtml(p.label)" },
    { d: "3cd021bc86", n: 1, t: "ctx.escHtml(g.label)" },
    { d: "fe37cddac6", n: 3, t: "rowId" },
    { d: "ad936fcbed", n: 1, t: "group" },
    { d: "13dd052941", n: 1, t: "iconHTML" },
    { d: "5cf3bd7371", n: 1, t: "iconOrNothing(ctx, 'chevronRight')" },
    { d: "6898f6c6e6", n: 1, t: "bodyHTML" },
    { d: "9c6bef1bca", n: 1, t: "ctx.escHtml(o.key ?? o.value)" },
    { d: "2a0aa77d30", n: 1, t: "ctx.escHtml(o.label)" },
    { d: "c0d2856b74", n: 1, t: "field" },
    { d: "d2a1edd66c", n: 1, t: "opts" },
    { d: "ee2a7d5c9d", n: 1, t: "ctx.escHtml(copy)" },
    // DI-423 AMENDMENT (2026-09-28) — the Profile pane's alma-mater field
    // became the same ESPN <select> the chat-prefs picker/Comm->Players->Edit
    // use; its <option> list arrives pre-built via ctx.bodies.almaMaterOptionsHTML
    // (app.js's ONE buildAlmaMaterOptions(), which escHtml()'s every school
    // name/current-value it emits — not provable by this file's classifier,
    // same shape as every other ctx.bodies.* injection in this module).
    { d: "f71a0bc689", n: 1, t: "ctx.bodies?.almaMaterOptionsHTML || ''" },
    // RG-TBD-B3 (bug batch B, 2026-09-29) — the Profile alma-mater picker's
    // caption (a fixed app.js string, almaMaterCatalogNoteText()), escaped
    // through the SAME injected `ctx.escHtml(...)` every other row-text site in
    // this file uses; later updates write textContent only.
    { d: "e804098985", n: 1, t: "ctx.escHtml(almaNote)" },
    { d: "670edf0acc", n: 1, t: "state.pane" },
    { d: "c39e7b69be", n: 1, t: "state.phase" },
    { d: "b9f4c1ac11", n: 1, t: "iconOrNothing(ctx, 'close') || '✕'" },
  ],
  'js/leagues-home.js': [
    { d: "3e7b7d75d0", n: 1, t: "roleBadgeHTML(m.role, { leagueId: m.leagueId })" },
    { d: "0b7aab5601", n: 3, t: "icon('chevronRight')" },
    { d: "fd1890afaf", n: 1, t: "glyph" },
    { d: "8b0e1ec23b", n: 2, t: "icon('chevronLeft')" },
    { d: "b4076cf587", n: 1, t: "sportCards" },
    // N1 league creation (DI-430, 2026-09-30) — two sources of pinned sites, both safe by construction:
    //   • the OPEN "Create new league" card comes from js/league-create.js's entryCardHTML() (its OWN sweep, [9c-1e] below, requires an injected escHtml and escapes the label);
    //     the call is unresolvable HERE because league-create.js is deliberately not in RESOLVABLE (see [9c-1e]);
    //   • the League Page empty state's calendar glyph (`icon('calendarWeek')`, ×2 — commissioner and player variants), the injected icon family like every other glyph in this file.
    { d: "fc7a681517", n: 1, t: "renderCreateLeagueStubCard({ escHtml, icon, open: createOpen === true })" },
    { d: "ef259c9086", n: 2, t: "icon('calendarWeek')" },
  ],
  'js/icons.js': [
    { d: "2362533504", n: 1, t: "_escAttr(label)" },
  ],
};
{
  const digest = e => createHash('sha256').update(e).digest('hex').slice(0, 10);
  for (const [file, backlog] of Object.entries(NEW_SWEPT_BACKLOG)) {
    const hits = sweepFile(file);
    const pinned = new Map(backlog.map(b => [b.d, b]));
    const live = new Map();
    for (const h of hits) { const d = digest(h.expr); live.set(d, (live.get(d) || 0) + 1); }
    const pinnedTotal = backlog.reduce((a, b) => a + b.n, 0);
    assert(pinned.size === backlog.length && backlog.every(b => Number.isInteger(b.n) && b.n >= 1),
      `[9c-1c-a] ${file}: every pin is well-formed and no digest is pinned twice`);
    const added = hits.filter(h => !pinned.has(digest(h.expr)));
    assert(added.length === 0,
      `[9c-1c-b] ${file}: NO NEW unclassified interpolation — new: ${added.slice(0, 4).map(h => `${h.line}:${h.expr.slice(0, 70)}`).join(' | ')}`);
    const grew = [...live.entries()].filter(([d, n]) => pinned.has(d) && n > pinned.get(d).n).map(([d, n]) => `${pinned.get(d).t.slice(0, 60)} (pinned ${pinned.get(d).n}, now ${n})`);
    assert(grew.length === 0,
      `[9c-1c-c] ${file}: NO ADDITIONAL site reuses a pinned expression (${hits.length} now vs ${pinnedTotal} pinned) — grew: ${grew.slice(0, 4).join(' | ')}`);
    const shrunk = backlog.filter(b => (live.get(b.d) || 0) < b.n).map(b => `${b.t.slice(0, 60)} (pinned ${b.n}, now ${live.get(b.d) || 0})`);
    assert(shrunk.length === 0,
      `[9c-1c-d] ${file}: the pinned backlog is current — stale pins hide the next regression: ${shrunk.slice(0, 4).join(' | ')}`);
    console.log(`     ℹ ${file} backlog: ${hits.length} unclassified sites (pinned: ${pinnedTotal} sites / ${backlog.length} expressions) — pinned, not approved`);
    // Canary, per file: a NEW unwrapped site must still be reported despite the pin.
    const POISON = SRC[file] + `
function __xssNewSweptCanary(evil) { return \`<div title="\${evil.nsAttr}">\${evil.nsText}</div>\`; }`;
    const poisoned = sweepFile(file, POISON).map(h => h.expr);
    assert(poisoned.includes('evil.nsAttr') && poisoned.includes('evil.nsText') && !pinned.has(digest('evil.nsAttr')) && !pinned.has(digest('evil.nsText')),
      `[9c-1c canary] ${file}: a NEW unwrapped site is REPORTED despite the pin (got: ${JSON.stringify(poisoned.slice(-2))})`);
  }
  // …and week-wizard.js's zero is not vacuous: the same poison is reported there too.
  const wwPoison = SRC['js/week-wizard.js'] + `
function __xssWwCanary(evil) { return \`<b>\${evil.wwText}</b>\`; }`;
  assert(sweepFile('js/week-wizard.js', wwPoison).some(h => h.expr === 'evil.wwText'),
    '[9c-1c canary] js/week-wizard.js: an unwrapped site added to it IS reported (its zero is a real sweep, not an empty one)');
}

// [9c-1e] N1 league creation (DI-430, 2026-09-30) — js/league-create.js is SWEPT ON ITS OWN, as a ratchet. It renders a player-typed league NAME (the New League sheet's
// field, the Created screen, the frame-13 notice), so it must be swept — but it is deliberately NOT added to SWEPT/RESOLVABLE: those lists build the classifier's cross-file
// function table, and this module's parameters are NAMED `icon` and `escHtml` (injected, the leagues-home.js style), which would shadow the same-named imports for every
// OTHER file and flip ~30 already-classified `icon(...)` sites in js/app.js to "unclassified". `sweepFile(file, overrideSrc)` reads the module from disk for its OWN sweep
// only. Every site below is safe by construction: `icon(...)`/glyph keys are the injected family, `side`/`action`/`key` are string literals the module's own call sites pass,
// `len`/`NEW_LEAGUE_NAME_MAX` are numbers, and `rows`/`webClose`/the tick span are fragments already built from escHtml()-wrapped parts. Every value that can carry a player's
// text (the name, the code, the league name) goes through escHtml() and is therefore NOT in this list — that absence is the point.
const LEAGUE_CREATE_BACKLOG = [
  { d: "ea7bf4bb72", n: 1, t: "side" },
  { d: "bd938c688f", n: 1, t: "action" },
  { d: "8b0e1ec23b", n: 1, t: "icon('chevronLeft')" },
  { d: "4b529285fb", n: 2, t: "icon('clear')" },
  { d: "dbc268478e", n: 1, t: "webClose" },
  { d: "9eea2de627", n: 1, t: "icon(isErr ? 'warning' : 'lock')" },
  { d: "000c67df5d", n: 2, t: "NEW_LEAGUE_NAME_MAX" },
  { d: "71fa9faaa6", n: 1, t: "len" },
  { d: "dd7da97080", n: 1, t: "icon(s.glyphKey)" },
  { d: "b694aea7c8", n: 1, t: "on ? `<span class=\"lc-tick-ic\">${icon('check')}</span>` : ''" },
  { d: "714bcef005", n: 3, t: "icon('check')" },
  { d: "bc51e9e65d", n: 1, t: "rows" },
  { d: "442ac0c5cf", n: 1, t: "icon('copy')" },
  { d: "a546c9b413", n: 1, t: "icon('share')" },
  { d: "949b2ddaaf", n: 1, t: "icon('plus')" },
  { d: "2c70e12b7a", n: 1, t: "key" },
];
{
  const digest = e => createHash('sha256').update(e).digest('hex').slice(0, 10);
  const LC_SRC = await readFile(new URL('./js/league-create.js', import.meta.url), 'utf8');
  const hits = sweepFile('js/league-create.js', LC_SRC);
  const pinned = new Map(LEAGUE_CREATE_BACKLOG.map(b => [b.d, b]));
  const live = new Map();
  for (const h of hits) { const d = digest(h.expr); live.set(d, (live.get(d) || 0) + 1); }
  assert(pinned.size === LEAGUE_CREATE_BACKLOG.length && LEAGUE_CREATE_BACKLOG.every(b => Number.isInteger(b.n) && b.n >= 1),
    '[9c-1e-a] js/league-create.js: every pin is well-formed and no digest is pinned twice');
  const added = hits.filter(h => !pinned.has(digest(h.expr)));
  assert(added.length === 0,
    `[9c-1e-b] js/league-create.js: NO NEW unclassified interpolation — new: ${added.map(h => `${h.line}:${h.expr.slice(0, 90)}`).join(' | ')}`);
  const grew = [...live.entries()].filter(([d, n]) => pinned.has(d) && n > pinned.get(d).n).map(([d, n]) => `${pinned.get(d).t.slice(0, 60)} (pinned ${pinned.get(d).n}, now ${n})`);
  assert(grew.length === 0, `[9c-1e-c] js/league-create.js: NO ADDITIONAL site reuses a pinned expression — grew: ${grew.join(' | ')}`);
  const shrunk = LEAGUE_CREATE_BACKLOG.filter(b => (live.get(b.d) || 0) < b.n).map(b => `${b.t.slice(0, 60)} (pinned ${b.n}, now ${live.get(b.d) || 0})`);
  assert(shrunk.length === 0, `[9c-1e-d] js/league-create.js: the pinned backlog is current — stale pins hide the next regression: ${shrunk.join(' | ')}`);
  // The player-typed values are NOT pinned: they are wrapped. Proof by mutation on an in-memory copy — unwrap the typed league name in the name field's value attribute (the
  // typed text is echoed back into the field on Back) and the sweep must report it.
  const unwrapped = LC_SRC.replace('value="${escHtml(state.name || \'\')}"', 'value="${state.name || \'\'}"');
  assert(unwrapped !== LC_SRC && sweepFile('js/league-create.js', unwrapped).some(h => /state\.name/.test(h.expr)),
    '[9c-1e-e] MUTATION: removing escHtml() from the typed league name in the field\'s value attribute IS reported by the sweep (the name\'s absence from the pin list is a real guarantee, not an empty sweep)');
  const POISON = LC_SRC + `
function __xssLcCanary(evil) { return \`<div title="\${evil.nsAttr}">\${evil.nsText}</div>\`; }`;
  assert(sweepFile('js/league-create.js', POISON).some(h => h.expr === 'evil.nsAttr') && sweepFile('js/league-create.js', POISON).some(h => h.expr === 'evil.nsText'),
    '[9c-1e canary] js/league-create.js: a NEW unwrapped site is REPORTED despite the pin');
  console.log(`     ℹ js/league-create.js backlog: ${hits.length} sites (pinned: ${LEAGUE_CREATE_BACKLOG.reduce((a, b) => a + b.n, 0)} / ${LEAGUE_CREATE_BACKLOG.length} expressions) — pinned, not approved`);
}

// [9c-1b] SECURITY F3 (pass-2, 2026-09-25) — `js/admin-panel.js` was already in
// `SWEPT`/`RESOLVABLE` (SECURITY GATE FINDING 4), but neither the [9c-1] bare
// loop above NOR APP_BACKLOG's own js/app.js-only ratchet ([9c-2] below) ever
// actually SWEEPS it — mutation-proven: unescaping the banner echo in this
// file left the whole suite green, because nothing iterated its own hits.
// `js/admin-panel.js` has 8 sites this pass that are genuinely safe but not
// literally wrapped in `esc(...)` — every one is either a property read off a
// hardcoded, `Object.freeze()`d, in-module constant array (`ADMIN_TABS`/
// `SUPER_ADMIN_TAB`'s own `.key`/`.icon`/`.label`), an internal dispatch key
// the module's own call sites pass as string literals (`tab`/`cardId` in
// `cardShell()`/`renderLeagueSelectorButton()`), a variable already built from
// `esc(...)`-wrapped fragments (`leagueRows`), or a pass-through of markup
// another function is independently responsible for escaping
// (`cardShell()`'s own `bodyHtml` — every `bodies` map entry it renders is
// itself swept via APP_BACKLOG/EXEMPTIONS in js/app.js). Pinned as a RATCHET
// (`ADMIN_PANEL_BACKLOG`, the SAME shape APP_BACKLOG uses below — digest +
// count, ratchet only tightens), not blanket EXEMPTIONS: unlike EXEMPTIONS'
// permanent file+expr match, a ratchet re-flags the moment the SAME
// identifier name (`tab`, `cardId`, `bodyHtml`) is reused for something less
// safe, which is exactly the risk of trusting a short, generic identifier
// name forever.
const ADMIN_PANEL_BACKLOG = [
  { d: "6e05deb4be", n: 1, t: "t.key" },
  { d: "5eb9cc5667", n: 1, t: "iconFn(t.icon)" },
  { d: "827c0f0a66", n: 1, t: "t.label" },
  // Item 6 (pass-2, wiring pass 3a-bis, 2026-09-25) — text changed (a third
  // ternary branch, the skeleton-while-loading case, added around the SAME
  // already-escaped `leagueRows` variable and a hardcoded literal `<p>`);
  // same safety reasoning as before, re-pinned under the new digest.
  { d: "3b322e0113", n: 1, t: "leagueRows || (allLeaguesLoading && !leagues.length ? crossLeagueSkeletonRowsHTML() : `<p>...No leagues found.</p>`)" },
  { d: "7508386a20", n: 2, t: "tab" },
  { d: "a3b96062b7", n: 1, t: "cardId" },
  { d: "17f0ffc19c", n: 1, t: "bodyHtml" },
];
{
  const file = 'js/admin-panel.js';
  const hits = sweepFile(file).filter(h => !EXEMPTIONS.some(e => e.file === file && e.expr === h.expr));
  const digest = e => createHash('sha256').update(e).digest('hex').slice(0, 10);
  const pinned = new Map(ADMIN_PANEL_BACKLOG.map(b => [b.d, b]));
  const liveCount = new Map();
  for (const h of hits) { const d = digest(h.expr); liveCount.set(d, (liveCount.get(d) || 0) + 1); }
  const pinnedTotal = ADMIN_PANEL_BACKLOG.reduce((a, b) => a + b.n, 0);

  const malformed = ADMIN_PANEL_BACKLOG.filter(b => !Number.isInteger(b.n) || b.n < 1);
  assert(malformed.length === 0,
    `[9c-1b-a] every ADMIN_PANEL_BACKLOG pin carries n (integer ≥1) — malformed: ${malformed.slice(0, 4).map(b => `${b.t.slice(0, 40)} (n=${JSON.stringify(b.n)})`).join(' | ')}`);
  assert(pinned.size === ADMIN_PANEL_BACKLOG.length,
    `[9c-1b-a] no digest is pinned twice (${ADMIN_PANEL_BACKLOG.length} entries, ${pinned.size} distinct digests)`);

  const added = hits.filter(h => !pinned.has(digest(h.expr)));
  assert(added.length === 0,
    `[9c-1b-b] js/admin-panel.js: NO NEW unclassified interpolation — new: ${added.slice(0, 4).map(h => `${h.line}:${h.expr.slice(0, 70)}`).join(' | ')}`);

  const grew = [...liveCount.entries()]
    .filter(([d, n]) => pinned.has(d) && n > pinned.get(d).n)
    .map(([d, n]) => `${pinned.get(d).t.slice(0, 60)} (pinned ${pinned.get(d).n}, now ${n})`);
  assert(grew.length === 0,
    `[9c-1b-c] js/admin-panel.js: NO ADDITIONAL site reuses an already-pinned expression (${hits.length} sites now vs ${pinnedTotal} pinned) — grew: ${grew.slice(0, 4).join(' | ')}`);

  const shrunk = ADMIN_PANEL_BACKLOG
    .filter(b => (liveCount.get(b.d) || 0) < b.n)
    .map(b => { const n = liveCount.get(b.d) || 0; return `${b.t.slice(0, 60)} (pinned ${b.n}, now ${n}${n === 0 ? ' — entry must be REMOVED' : ' — n must be updated'})`; });
  assert(shrunk.length === 0,
    `[9c-1b-d] js/admin-panel.js: the pinned backlog is current — stale pins hide the next regression: ${shrunk.slice(0, 4).join(' | ')}`);

  console.log(`     ℹ js/admin-panel.js backlog: ${hits.length} unclassified sites (pinned: ${pinnedTotal} sites / ${ADMIN_PANEL_BACKLOG.length} expressions) — pinned, not approved`);
}

// [9c-1b canary] SECURITY F3's own mutation-check, self-tested here rather
// than only by hand: a synthetic unwrapped site injected into
// js/admin-panel.js must still be REPORTED by the sweep despite the pin
// above — proves the ratchet, not a blanket pass.
{
  const POISON = SRC['js/admin-panel.js'] + `
function __xssAdminPanelCanary(evil) { return \`<div title="\${evil.apAttr}">\${evil.apText}</div>\`; }`;
  const poisoned = sweepFile('js/admin-panel.js', POISON).map(h => h.expr);
  assert(poisoned.includes('evil.apAttr') && poisoned.includes('evil.apText'),
    `[9c-1b canary] a NEW unwrapped site in js/admin-panel.js is still reported despite the pin (got: ${JSON.stringify(poisoned.slice(-3))})`);
  const known = new Set(ADMIN_PANEL_BACKLOG.map(b => b.d));
  const digest = e => createHash('sha256').update(e).digest('hex').slice(0, 10);
  assert(!known.has(digest('evil.apAttr')) && !known.has(digest('evil.apText')),
    '[9c-1b canary] …and the pin does not cover it — the ratchet fails on anything new');
}


// [9c-2] js/app.js — THE REVIEW BACKLOG, pinned as a RATCHET.
//
// BE PRECISE ABOUT WHAT THIS IS. The 133 expressions below are NOT approved
// exemptions and must not be read as "reviewed and found safe." They are the
// sites this sweep denies in js/app.js today: overwhelmingly member
// expressions on synced record objects (`p.playerId`, `game.gameId`,
// `week.status`, `s.totalCorrect`) interpolated without a wrapper. Escaping
// all of them is a batch of its own — 183 edits across 13,000 lines, each
// needing an escHtml-vs-numHtml judgement because escHtml(0) is '' — which is
// feature-sized work, not a bugfix, and is handed on rather than smuggled in
// here (scope discipline).
//
// Each entry pins TWO things about one distinct expression: `d`, the SHA-256
// prefix of the exact normalised expression text, and `n`, HOW MANY sites in
// js/app.js carry that text today. `t` is a readable preview only. Matching on
// the digest keeps it exact (a near-miss is a new entry); counting the sites
// keeps it complete.
//
// WHAT THIS GUARANTEES, exactly: js/app.js cannot acquire an additional
// unclassified interpolation — not a new expression, and not one more site
// reusing text that is already pinned. Both raise a failure: novel text fails
// (b), a higher count on pinned text fails (c). The pinned total (183 sites
// across 133 expressions) may only SHRINK, and a shrink is itself a failure
// (d) until the pin is updated — n lowered, or the entry removed once it
// reaches 0 — so a fixed site can never sit in the pin pre-approving whatever
// lands on that text next.
//
// The digest alone was NOT enough, and this is why n exists: until 2026-09-12
// the pin was keyed on text only, so adding a second `title="${week.status}"`
// anywhere in the file was absorbed silently — 183 sites became 184 and the
// suite stayed green. Both release gates reproduced it (reviewer F1 /
// security-reviewer F3-2a).
const APP_BACKLOG = [
  // N1 league creation (DI-430, 2026-09-30) — SEVEN sites, all SAFE BY CONSTRUCTION but not provable by this classifier: each interpolates markup that ANOTHER function has
  // already escaped. js/league-create.js's renderers (bannerHTML, inviteLinkNoteHTML, claimInsteadHTML, landingCreateCardHTML, entryCardHTML) REQUIRE an injected escHtml and
  // throw without one (leaguecreatetest [5ah]), and every string they emit passes through it (its own sweep, [9c-1e]); leaguesHomeNoticeHTML() and `inviteNotice` are
  // exactly `LC.bannerHTML('err', <fixed copy or the held notice>, { escHtml, icon })` or ''. league-create.js is NOT in RESOLVABLE on purpose ([9c-1e]), so the call cannot
  // be followed from here. Pinned, not approved — the ratchet still tightens.
  // …and ONE more from the same pass (DI-430 touched-screen audit): the Picks locked/no-week card's glyph — a ternary of two hard-coded literals (the Munera calendar glyph when the
  // league has no weeks, the padlock emoji otherwise); no data flows through either branch.
  { d: "29f8826540", n: 1, t: "noWeek ? icon('calendarWeek') : '🔒'" },
  { d: "6eb17cef4f", n: 1, t: "leaguesHomeNoticeHTML()" },
  { d: "fc70f8ca2f", n: 1, t: "inviteNotice" },
  { d: "ffb9990205", n: 1, t: "LC.landingCreateCardHTML({ open: getCachedLeagueCreationOpen(), signupsOpen, escHtml })" },
  { d: "fb959b1beb", n: 1, t: "inv.code ? LC.inviteLinkNoteHTML({ escHtml }) : ''" },
  { d: "ebcb84307e", n: 1, t: "inv.code ? LC.claimInsteadHTML({ escHtml }) : ''" },
  { d: "a31c0aa181", n: 1, t: "renderCreateLeagueStubCard({ escHtml, icon, open: getCachedLeagueCreationOpen() })" },
  { d: "89d8648f54", n: 1, t: "prefill ? LC.inviteLinkNoteHTML({ escHtml }) : ''" },
  // v0.27.0 UX Revamp post-deploy pass (2026-09-27, DI-356) — REMOVED, not
  // left stale: this IIFE's only site was the standalone "Week Settings"
  // card's own multi-part-grouping block, which is retired wholesale (the
  // fields moved to Admin → Week's own `renderDataSourceModeBody()`, a
  // plain interpolation-per-field body, not the same IIFE shape). Zero hits
  // now; a stale pin would hide the next regression.
  // (was "dbf27805ae")
  // v0.27.0 UX Revamp post-deploy pass (2026-09-27, DI-356) — REMOVED, not
  // left stale: this IIFE's only site was the standalone Week Settings
  // card's own effective-lock/live-time preview, retired along with the
  // card (the wizard's own Timing fields render the equivalent preview
  // through a different, already-pinned/exempt path). Zero hits now.
  // (was "2da1dec4f4")
  { d: "df4408a77e", n: 1, t: "(game.suggestionReasons||[]).map(r=>`<span class=\"candidate-reason\">${escHtml(r)}</span>`).join(…" },
  { d: "b0d5bd34ee", n: 1, t: "(r.headHit||0)+(r.headMiss||0)" },
  { d: "fb687a947c", n: 1, t: "FREQUENCY_LEVELS[level]" },
  { d: "a90cf7c020", n: 1, t: "GAME_REQUEST_CAP" },
  { d: "d2766bd1c1", n: 1, t: "SEASON_2025.champion.points" },
  { d: "acb4ad639f", n: 1, t: "SEASON_2025.notes.map(escHtml).join(' · ')" },
  { d: "4266d25db1", n: 2, t: "WAGER_CLAIM_MAX" },
  { d: "d124ff39c9", n: 2, t: "almaCount" },
  { d: "1863ecf736", n: 1, t: "arr.reduce((a,b)=>a+b,0)" },
  { d: "ea3ce3f6e6", n: 1, t: "blind ? '—' : r.correctPicks" },
  { d: "1967ba618d", n: 1, t: "blind ? '—' : r.incorrectPicks" },
  { d: "230d8358dc", n: 3, t: "body" },
  { d: "4c16c21223", n: 1, t: "c.confidence" },
  { d: "d9705d8ee2", n: 1, t: "chips" },
  { d: "ae6c3d8c59", n: 1, t: "cleared ? `✅ Chat history before ${escHtml(fmtDate(getChatEpochSetAt()))} is hidden (${stats.hid…" },
  { d: "889ea70a79", n: 1, t: "dashComposed.html" },
  { d: "b393df2a8d", n: 1, t: "disp.badgeClass" },
  { d: "c8268a17f9", n: 1, t: "espn" },
  { d: "95e27bcfc7", n: 1, t: "fetchMethod" },
  { d: "e3559de245", n: 2, t: "g.gameId" },
  { d: "648cec5be4", n: 1, t: "g.status" },
  { d: "a4123a3327", n: 1, t: "game.espnEventId ? `<a class=\"espn-link\" href=\"https://www.espn.com/${game.isManual && game.espn…" },
  { d: "ac8c754b7b", n: 6, t: "game.gameId" },
  // "60a52e8c9d" game.status (n 2) RETIRED fix-final-v0270 (2026-09-28) — the
  // one site (game row status badge, class + text) is escHtml()'d now.
  { d: "86c3e75df5", n: 1, t: "gameId" },
  // n LOWERED 2 -> 1, v0.27.0 UX Revamp post-deploy pass (2026-09-27,
  // DI-356) — the standalone Week Settings card's own second site is
  // retired along with the card; the ONE surviving site is
  // renderWeekWizardTimingFieldsHTML()'s (shared by Step 4 and the Manage
  // screen, unchanged), same expression the "n bumped 1 -> 2" note below
  // originally added.
  { d: "b544a9db4c", n: 1, t: "getAutoLockOffsetMinutes(week)" },
  // v0.27.0 UX Revamp post-deploy pass (2026-09-27, DI-355) — REMOVED, not
  // left stale: this expression's only site was showCreateWeekModal()'s own
  // markup (Season field default), and that whole function is retired (its
  // one caller, "➕ New Week", was a duplicate entry point for the wizard's
  // own week-wizard-entry-btn — see js/app.js's DI-355 comment at its old
  // location). Zero hits now; a stale pin would hide the next regression.
  { d: "767e85a142", n: 1, t: "groupRows.map(({gid,label,winner,loser})=>{ // UN-126 — presence of an obligation for this gid n…" },
  { d: "81d121bc48", n: 1, t: "guesses || '<span class=\"text-muted\">none yet</span>'" },
  // v0.27.0 UX Revamp post-deploy pass (2026-09-27, DI-359) —
  // renderFinalizeStep1HTML()'s (js/app.js) no-games fallback: `rows` is
  // ALREADY escHtml()-safe HTML by the time it reaches this point (every
  // piece of user data folded into it — team names, the block reason — is
  // escHtml()'d at its own construction site, same shape as
  // "guesses || ..." immediately above); this is the static fallback
  // string when the slate is empty, never user data.
  { d: "1fce769112", n: 1, t: "rows || '<p class=\"text-muted text-sm\">No games on this slate.</p>'" },
  // v0.27.0 UX Revamp post-deploy pass (2026-09-27, DI-359) —
  // renderFinalizeTrackerHTML()'s (js/app.js) step-tracker label, the
  // guided Finalize Week flow's own copy of the create-flow tracker's
  // already-pinned/exempt shape. `step` is `_finalizeStep`, always an
  // integer 1-4 from FINALIZE_STEPS; never user data.
  { d: "3e64cc41cf", n: 1, t: "step" },
  // Same tracker, the frozen step-count constant (FINALIZE_STEPS.length).
  { d: "715b6c04ad", n: 1, t: "FINALIZE_STEP_COUNT" },
  { d: "f6cf98c106", n: 1, t: "hardHTML" },
  { d: "01dbd80507", n: 1, t: "hasAny?`${count} comment${count>1?'s':''} on this game`:'Add a comment'" },
  { d: "378f37b1fb", n: 1, t: "headers" },
  { d: "a56145270c", n: 3, t: "id" },
  { d: "c66a8eb7e6", n: 5, t: "idx" },
  { d: "2c70e12b7a", n: 2, t: "key" },
  { d: "acac86c0e6", n: 1, t: "l" },
  { d: "64cf2be6ff", n: 3, t: "l.confidence" },
  { d: "1aca80e8b5", n: 1, t: "label" },
  { d: "4cc9d430e8", n: 1, t: "latest.metrics.ratingMix.hit" },
  { d: "b7ac52c8f9", n: 1, t: "latest.metrics.ratingMix.mid" },
  { d: "0fb8932962", n: 1, t: "latest.metrics.ratingMix.tooMuch" },
  { d: "ef9b3a568e", n: 1, t: "latest.metrics.rewriteCount" },
  { d: "9ab9a9a1fd", n: 1, t: "metricsBlock" },
  { d: "e642b12901", n: 1, t: "mode" },
  { d: "e46b320165", n: 1, t: "msg" },
  { d: "1119094d5a", n: 1, t: "multiDay && day.name ? `${escHtml(day.name)} · ${wl}` : wl" },
  { d: "1b16b1df53", n: 1, t: "n" },
  // n bumped 1 -> 2, v0.27.0 UX Revamp post-deploy pass (2026-09-27, DI-358)
  // — Step 6's new three-way open-mode dial (renderWeekWizardStep6HTML())
  // reuses the exact `${o.level}` shape the SCRIBE settings dials already
  // pin here (same reuse-the-pattern precedent those dials themselves
  // followed) — a level string from a frozen local array literal, never
  // user data.
  { d: "0a43bd0696", n: 2, t: "o.level" },
  { d: "bd481ab67e", n: 1, t: "o.value" },
  { d: "65082ecc44", n: 1, t: "ob.obligationId" },
  { d: "46f8adf6c9", n: 2, t: "obClass" },
  { d: "d4e7fc3c11", n: 1, t: "onSlate ? `<div class=\"flex gap-sm flex-center\"> <span class=\"badge badge-open\">✓ On Slate</span…" },
  { d: "861494edbb", n: 1, t: "onSlate ? `<span class=\"badge badge-open\">✓ On Slate</span>` : `<button class=\"btn btn-primary b…" },
  { d: "18f3f2139f", n: 1, t: "openCount" },
  { d: "b6e59d5ca1", n: 1, t: "openRows.length ? openRows.map(r => { const status = ob2025Status(paidMap, r.obligationId); retu…" },
  { d: "3b27b3ba43", n: 13, t: "p.playerId" },
  { d: "df8641f3a0", n: 4, t: "pageKey" },
  { d: "0e5dfc9af6", n: 1, t: "parts[id]" },
  { d: "62a2fed3d6", n: 1, t: "pending" },
  { d: "98df4506a5", n: 1, t: "pickCells" },
  // UX Revamp wiring pass 3a (2026-09-25) — renderExportDataCardBody()'s two
  // pre-composed HTML blocks (`pickShapedScope`/`fullBackup`). Both are
  // built ENTIRELY from literal markup plus `${week?'':'disabled'}`-shaped
  // boolean ternaries and an `esc()`-wrapped-elsewhere `isMember` boolean —
  // no direct interpolation of any user-typed string reaches either
  // variable, so injecting them bare is provably safe; classified here
  // rather than restructured, matching this backlog's existing precedent
  // for other pre-composed-HTML-chunk variables (e.g. "standComposed.html").
  { d: "d3f33f86ff", n: 1, t: "pickShapedScope" },
  { d: "633ed3870b", n: 1, t: "players.filter(p=>p.active).map(p=>{ const nick=getNickname(week.weekId,p.playerId)||''; return`…" },
  { d: "2db8bd1d98", n: 1, t: "players.map(p => { const sub = week ? hasPlayerSubmitted(week.weekId, p.playerId) : false; const…" },
  { d: "69fedf42f3", n: 1, t: "players.map(p=>{ const pin = getPlayerPin(p.playerId); return ` <div class=\"player-admin-row\" da…" },
  // v0.27.0 UX Revamp post-deploy pass (2026-09-27, DI-352) — n bumped 1 -> 2:
  // the Commissioner "Build Slate" card and Admin → Games' 'espn-source' card
  // (renderEspnSourceBody(), now folding in the raw fetch/demo actions) both
  // show the same "Last fetch: … · N events" line; same source field, not a
  // new expression.
  { d: "9660149ca9", n: 2, t: "ps.lastRawEventCount" },
  { d: "bc9d631384", n: 1, t: "ps.lastRawEventCount||'—'" },
  { d: "dcac36c039", n: 1, t: "r.appendCount||0" },
  { d: "600be826bf", n: 1, t: "r.headHit||0" },
  { d: "d38d558894", n: 1, t: "r.wins" },
  { d: "4e20eb63a2", n: 1, t: "readiness.issues.map(escHtml).join(' · ')" },
  { d: "e689e15c86", n: 1, t: "readiness.level" },
  { d: "5a3e5177ec", n: 1, t: "readiness.level!=='ok'?' game-admin-card-'+readiness.level:''" },
  { d: "7df29809a5", n: 1, t: "readyBanner" },
  // DI-412 AMENDED (reviewer round 2 B1, 2026-09-28) — renamed from
  // `games`/`week` to `gamesTabGames`/`gamesTabWeek` (the wizard's parked
  // target when one exists, else the live week — same call, same safety
  // reasoning, new digest under the new argument names).
  { d: "76769792ce", n: 1, t: "renderAdminGamesList(gamesTabGames,gamesTabWeek,getGameLockOverrides())" },
  { d: "50e2c18742", n: 1, t: "renderAlmaMaterRankings()" },
  { d: "373c406920", n: 1, t: "renderAvailableGamesList(games, currentSlate, week)" },
  // DI-412 AMENDED (reviewer round 2 B1, 2026-09-28) — same rename as above.
  { d: "9a3810c364", n: 1, t: "renderAvailableGroups(gamesTabAvailGames, gamesTabGames, gamesTabWeek)" },
  { d: "a9b7fa53d9", n: 1, t: "renderDashboardCompact(players,games,allPicks,weeklyResults,week.weekId,actualTB)" },
  { d: "c91704dcef", n: 1, t: "renderObligationCorrectionsAdmin()" },
  { d: "9d1ce5e3e6", n: 1, t: "renderObligationsAdmin()" },
  { d: "6c9d8dccec", n: 1, t: "renderScoreSummaryRowsHTML(week, weeklyResults, players, actualTB)" },
  { d: "9d1bc9a693", n: 1, t: "renderTiebreakerGuessesAdmin(week,players,week.actualTiebreakerValue)" },
  { d: "bc51e9e65d", n: 2, t: "rows" },
  { d: "9a07b0a6e2", n: 1, t: "rows || '<p class=\"text-muted\">No games recorded for this week.</p>'" },
  { d: "fd19c07491", n: 2, t: "rows.join('')" },
  { d: "3fb5135635", n: 1, t: "s.bowls" },
  { d: "a3e20e78ce", n: 1, t: "s.cfpQF" },
  { d: "da49d8d1ad", n: 1, t: "s.cfpR1" },
  { d: "b4e623554c", n: 1, t: "s.conf" },
  { d: "648f905dc5", n: 2, t: "s.currentRank" },
  { d: "5e06de0ec2", n: 1, t: "s.extraPt" },
  { d: "ba5b6b4862", n: 1, t: "s.reg" },
  { d: "ceccb49114", n: 1, t: "s.semis??'DNP'" },
  { d: "fed210a099", n: 1, t: "s.total" },
  { d: "6fc3671425", n: 1, t: "s.totalCorrect" },
  { d: "04ee9b0245", n: 1, t: "s.totalIncorrect" },
  { d: "2d6dfc8094", n: 1, t: "s.weeklyLosses" },
  { d: "31c9874cb8", n: 1, t: "s.weeklyWins" },
  { d: "633597e445", n: 1, t: "s.winPct" },
  { d: "913cbdc64e", n: 1, t: "settings.season" },
  { d: "489a3892a1", n: 1, t: "showFilter ? ` <div class=\"ob-filter-tabs mb-sm\"> <button type=\"button\" class=\"ob-filter-tab${fi…" },
  { d: "e68d705100", n: 1, t: "slateMatch?slateMatch.gameId:''" },
  { d: "ed343fde05", n: 1, t: "sourceModeLabelOf(mode)" },
  { d: "d0619b2845", n: 1, t: "standComposed.html" },
  { d: "b4c6695f1a", n: 2, t: "stats.hiddenCount" },
  { d: "5b2ce9b30e", n: 2, t: "stats.protectedCount" },
  // "t.icon"/"t.label" entries REMOVED (UX Revamp wiring pass 3a, 2026-09-25)
  // — the inline Commissioner tab-bar `tabs.map(t => ...)` block those two
  // sites lived in was replaced by one call to renderCommTabBar()
  // (js/comm-panel-layout.js), which those two unclassified interpolations
  // do not exist in app.js at all any more. "t.key" n updated 2 -> 1: one of
  // its two occurrences was in that same removed block; the surviving one
  // is the THEMES.map() dropdown at app.js:5287.
  { d: "6e05deb4be", n: 1, t: "t.key" },
  { d: "05e7c62dfb", n: 2, t: "tally.pendingWeeks" },
  { d: "4e019a2921", n: 1, t: "tally.pendingWeeks === 1 ? `${tally.pendingWeeks} week isn't counted yet.` : `${tally.pendingWee…" },
  { d: "14dcb0dcd3", n: 1, t: "thisWeek.length ? groupGameRequests(thisWeek).map(rowHTML).join('') : `<p class=\"text-muted text…" },
  { d: "aaf2320646", n: 1, t: "title" },
  { d: "11239872d1", n: 2, t: "total" },
  { d: "153c0369aa", n: 1, t: "totalUnfiltered" },
  { d: "1a08b06f0b", n: 2, t: "tz.key" },
  // Carry-over fix (app-shell part 3A review, 2026-09-27) — the Finalize
  // Step 4 warning box's icon('warning') prefix, hoisted to a local const
  // (`warningIconHTML`) right above the template literal that interpolates
  // it (renderFinalizeStep4HTML()) — provably safe (icon() returns a
  // hand-authored SVG string off a frozen glyph-name table, never user
  // data), same shape as this file's other bare-identifier icon-HTML
  // entries (e.g. "iconHTML"/"almaIcon"/"backIcon" in the control-center.js
  // backlog above).
  { d: "d39dbab353", n: 1, t: "warningIconHTML" },
  // security note (full-branch audit, 2026-09-28) — REMOVED, not left stale:
  // weekNavCardHTML()'s status-pill CLASS interpolation now reads
  // `badge-${escHtml(viewWeek.status)}`, matching the escaped label beside it
  // in the same span. Zero hits now; a stale pin would hide the next
  // regression. (was "c5254ec60b", t: "viewWeek.status", DI-394)
  { d: "50e721e49c", n: 1, t: "w" },
  { d: "2eb640a6cf", n: 1, t: "w.status" },
  // security F3 (app-shell part 3A, 2026-09-27) — REMOVED, not left stale:
  // all three `w.weekId` sites (app.js's #week-selector, #active-week-selector
  // and #admin-week-group-partner option `value="…"` attributes) now wrap the
  // interpolation in escHtml(), matching every other option-value site in the
  // file. w.weekId is a commissioner-authored string (createWeek()'s
  // `w_${Date.now()}` shape today, but nothing enforces that going forward),
  // so an unescaped `"` inside it could break out of the attribute — the same
  // class of hole this file's own EXEMPTIONS logic exists to catch. The
  // backlog count for this digest is now 0; entry REMOVED per this file's own
  // rule (d) rather than left at a stale n.
  // v0.27.0 UX Revamp post-deploy pass (2026-09-27, DI-356/359) — REMOVED,
  // not left stale: the standalone card's inline pending-finalization
  // banner is retired; the equivalent banner now lives inside
  // renderWeekWizardManageHTML() (js/app.js), a DIFFERENT, already-safe
  // template literal (every interpolation inside it is either a frozen
  // constant or already escHtml()'d — see renderFinalizeStep4HTML's own
  // entries below for the guided flow this banner opens into). Zero hits
  // on this exact expression now. (was "7f15b7110a")
  // "a61321bcae" week.status / "33d65aca32" week.status.toUpperCase() (n 1
  // each) RETIRED fix-final-v0270 (2026-09-28) — the header's own status badge
  // (refreshHeader(), class + text) is escHtml()'d now, same as viewWeek's.
  { d: "a5d9936b85", n: 1, t: "week.weekId" },
  { d: "7cc1eb0858", n: 1, t: "weekId" },
  { d: "04176e6538", n: 1, t: "wkNames.map(n=>{ const arr=SEASON_2025.weeklyScores[n]; return `<tr><td class=\"player-name-cell\"…" },
  { d: "9d709a05ea", n: 1, t: "wl" },
  { d: "816415a13a", n: 1, t: "x.cls" },
  // "x.label" (was pinned e6b1b31a8d) REMOVED, reviewer round 3 item 5
  // (2026-09-26) — renderWeekStatusButtons() no longer interpolates the raw
  // emoji label; it now renders icon(x.icon) + escHtml(x.text) (both
  // classified in EXEMPTIONS / provably safe respectively).
  { d: "b88cca4044", n: 1, t: "x.to" },
];

{
  // UX Revamp wiring pass 1 (2026-09-25) — js/app.js's sweep now ALSO passes
  // through EXEMPTIONS, the same escape hatch [9c-1] already gives the other
  // four files, so a genuinely-safe NEW interpolation (an imported,
  // pre-escaped render function — see the four control-center.js entries
  // added to EXEMPTIONS this pass) does not have to be smuggled into
  // APP_BACKLOG to pass. This does NOT touch APP_BACKLOG's own 133 pinned
  // entries or weaken the "no new backlog growth" ratchet below — it only
  // gives NEW code a route to PROVE safety instead of joining the debt list.
  const hits = sweepFile('js/app.js').filter(h => !EXEMPTIONS.some(e => e.file === 'js/app.js' && e.expr === h.expr));
  const digest = e => createHash('sha256').update(e).digest('hex').slice(0, 10);
  const pinned = new Map(APP_BACKLOG.map(b => [b.d, b]));
  const liveCount = new Map();
  for (const h of hits) { const d = digest(h.expr); liveCount.set(d, (liveCount.get(d) || 0) + 1); }
  const pinnedTotal = APP_BACKLOG.reduce((a, b) => a + b.n, 0);

  // (a) STRUCTURE — a pin whose count is missing, zero or non-integer is not a
  // ratchet, it is a digest list with a decorative field. Assert the shape
  // before trusting the comparison below.
  const malformed = APP_BACKLOG.filter(b => !Number.isInteger(b.n) || b.n < 1);
  assert(malformed.length === 0,
    `[9c-2] every backlog pin carries n — the integer number of sites (≥1) carrying that expression text — malformed: ${malformed.slice(0, 4).map(b => `${b.t.slice(0, 40)} (n=${JSON.stringify(b.n)})`).join(' | ')}`);
  assert(pinned.size === APP_BACKLOG.length,
    `[9c-2] no digest is pinned twice — a duplicate entry would split one expression's count in two and let the total grow (${APP_BACKLOG.length} entries, ${pinned.size} distinct digests)`);

  // (b) NO NEW EXPRESSION TEXT.
  const added = hits.filter(h => !pinned.has(digest(h.expr)));
  assert(added.length === 0,
    `[9c-2] js/app.js: NO NEW unclassified interpolation (the backlog ratchet only tightens) — new: ${added.slice(0, 4).map(h => `${h.line}:${h.expr.slice(0, 70)}`).join(' | ')}`);

  // (c) NO ADDITIONAL SITE ON ALREADY-PINNED TEXT. This is the half the digest
  // could not see: a second `${week.status}` in a new unescaped attribute is a
  // new hole wearing an old name.
  const grew = [...liveCount.entries()]
    .filter(([d, n]) => pinned.has(d) && n > pinned.get(d).n)
    .map(([d, n]) => `${pinned.get(d).t.slice(0, 60)} (pinned ${pinned.get(d).n}, now ${n})`);
  assert(grew.length === 0,
    `[9c-2] js/app.js: NO ADDITIONAL site reuses an already-pinned expression — the count per expression may only fall (${hits.length} sites now vs ${pinnedTotal} pinned) — grew: ${grew.slice(0, 4).join(' | ')}`);

  // (d) NO STALE PIN. A count that fell means somebody fixed a site: the pin
  // must be lowered, or REMOVED once it reaches 0, or it goes on pre-approving
  // whatever lands on that text next.
  const shrunk = APP_BACKLOG
    .filter(b => (liveCount.get(b.d) || 0) < b.n)
    .map(b => { const n = liveCount.get(b.d) || 0; return `${b.t.slice(0, 60)} (pinned ${b.n}, now ${n}${n === 0 ? ' — entry must be REMOVED' : ' — n must be updated'})`; });
  assert(shrunk.length === 0,
    `[9c-2] js/app.js: the pinned backlog is current — ${shrunk.length} entr${shrunk.length === 1 ? 'y has' : 'ies have'} been fixed and must be REMOVED from / updated in APP_BACKLOG (stale pins hide the next regression): ${shrunk.slice(0, 4).join(' | ')}`);

  console.log(`     ℹ js/app.js backlog: ${hits.length} unclassified sites, ${new Set(hits.map(h => h.expr)).size} distinct expressions (pinned: ${pinnedTotal} sites / ${APP_BACKLOG.length} expressions) — pinned, not approved`);
}

// [9c-3] THE BACKLOG PIN IS NOT A BLANKET. Prove it: a synthetic unwrapped
// site injected into js/app.js must still FAIL, exactly as it does in the
// files under full enforcement. A ratchet that could absorb a new hole would
// be worse than no ratchet, because it would read as green.
{
  const POISON = SRC['js/app.js'] + `
function __xssAppCanary(evil) { return \`<div title="\${evil.appAttr}">\${evil.appText}</div>\`; }`;
  const poisoned = sweepFile('js/app.js', POISON).map(h => h.expr);
  assert(poisoned.includes('evil.appAttr') && poisoned.includes('evil.appText'),
    `[9c-3] a NEW unwrapped site in js/app.js is still reported despite the pin (got: ${JSON.stringify(poisoned.slice(-3))})`);
  const known = new Set(APP_BACKLOG.map(b => b.d));
  const digest = e => createHash('sha256').update(e).digest('hex').slice(0, 10);
  assert(!known.has(digest('evil.appAttr')) && !known.has(digest('evil.appText')),
    '[9c-3] …and the pin does not cover it — the ratchet fails on anything new');
}

// [9c] BEHAVIOURAL — the commissioner's "Submitted guesses" strip. The guess
// blob is written through the seam by setTiebreakerGuess(), which coerces with
// Number(); the reachable hostile shape is the SYNCED BLOB itself (a
// hand-edited Sheet cell / a bad restore), exactly like the scores in [2].
console.log('\n[9c] Poisoned tiebreaker + Extra Point guesses through the real renderers…');
localStorage.setItem('cfbp_tiebreaker_guesses', JSON.stringify({ [`${wk.weekId}__xss_p1`]: PAYLOAD }));
const tbAdmin = app.renderTiebreakerGuessesAdmin(wk, [{ playerId: 'xss_p1', displayName: 'Tester', active: true }], 42);
assert(/badge-final/.test(tbAdmin), 'fixture: the guesses strip actually rendered');
assert(!/<img/i.test(tbAdmin), '[9c] renderTiebreakerGuessesAdmin: no live <img from the guess');
assert(/&lt;img/.test(tbAdmin), '[9c] the guess payload is present as escaped text');

localStorage.setItem('cfbp_extra_point_guesses', JSON.stringify({ [`${wk.weekId}__xss_p1`]: PAYLOAD }));
const epCard = app.renderCommExtraPointCardHTML(wk);
assert(/ep-admin-guess/.test(epCard), 'fixture: the Extra Point admin card actually rendered');
assert(!/<img/i.test(epCard), '[9c] renderCommExtraPointCardHTML: no live <img from the yardage guess');
localStorage.setItem('cfbp_extra_point_guesses', JSON.stringify({ [`${wk.weekId}__xss_p1`]: 54 }));
assert(/54 yd/.test(app.renderCommExtraPointCardHTML(wk)),
  '[9c] an ordinary 54-yard guess still reads "54 yd" (the coercion must not eat the unit)');
localStorage.setItem('cfbp_extra_point_guesses', JSON.stringify({ [`${wk.weekId}__xss_p1`]: 0 }));
assert(/0 yd/.test(app.renderCommExtraPointCardHTML(wk)),
  '[9c] a 0-yard guess still reads "0 yd" — numHtml(0) is "0", escHtml(0) would be ""');

// [9c-4] BEHAVIOURAL — NOTE 6 / BLOCK 4 (2026-09-25): the player-facing
// maintenance banner. Super-admin-authored (`platform_kv.maintenance_banner`),
// read by EVERY signed-in account (DI-344 §3.1's `using (true)` SELECT
// policy) on all six nav destinations plus the leagues-home/gate screen — a
// genuinely new render site named explicitly in DI-345 "XSS / escaping".
// `renderMaintenanceBannerHTML()` is the one function both js/app.js's six
// call sites AND (via its own `esc()`-wrapped sibling literal) js/chat-ui.js
// build the banner markup with — this proves the app.js half directly rather
// than relying on the structural sweep alone.
console.log('\n[9c-4] Poisoned maintenance_banner text through the real renderer…');
const maintenanceHtml = app.renderMaintenanceBannerHTML(PAYLOAD);
assert(/maintenance-banner/.test(maintenanceHtml), 'fixture: the maintenance banner actually rendered');
assert(!/<img/i.test(maintenanceHtml), '[9c-4] renderMaintenanceBannerHTML: no live <img from the banner text');
assert(/&lt;img/.test(maintenanceHtml), '[9c-4] the banner text is present as escaped text');

// [9d] BEHAVIOURAL — the score summary's tiebreaker column (tbDisp), both
// branches: with an actual value (guess + delta) and without (guess only).
const sumPlayers = [{ playerId: 'xss_p1', displayName: 'Tester', active: true }];
const poisonedResult = {
  playerId: 'xss_p1', rank: 1, correctPicks: 2, incorrectPicks: 1,
  tiebreakerGuess: PAYLOAD, tiebreakerDelta: PAYLOAD, isWinner: false, isLoser: false,
};
const sumWithActual = app.renderScoreSummaryRowsHTML(wk, [poisonedResult], sumPlayers, 42);
assert(/<tr/.test(sumWithActual), 'fixture: the score summary row actually rendered');
assert(!/<img/i.test(sumWithActual), '[9d] renderScoreSummaryRowsHTML (actual entered): no live <img from the guess or delta');
const sumNoActual = app.renderScoreSummaryRowsHTML(wk, [poisonedResult], sumPlayers, null);
assert(!/<img/i.test(sumNoActual), '[9d] renderScoreSummaryRowsHTML (no actual yet): no live <img from the guess');
const sumZero = app.renderScoreSummaryRowsHTML(
  wk, [{ ...poisonedResult, tiebreakerGuess: 0, tiebreakerDelta: 0 }], sumPlayers, 0);
assert(/>0 \(Δ0\)</.test(sumZero),
  `[9d] a 0 guess with a 0 delta still reads "0 (Δ0)" — the zero guard, one column over (got: ${JSON.stringify((sumZero.match(/text-muted text-sm">([^<]*)</) || [])[1])})`);

// ══════════════════════════════════════════════════════════════════════════
// [10] C5 — game.espnEventId
//
// Rendered as element CONTENT at three sites. In the worst case its value did
// not come from ESPN at all: when the direct fetch fails, data-provider.js
// falls back to three third-party CORS proxies, and whatever JSON they return
// is parsed as a scoreboard. So the id is third-party text, and it is fixed at
// BOTH ends — escaped where it renders, and shape-checked where it is parsed.
// ══════════════════════════════════════════════════════════════════════════
console.log('\n[10] espnEventId — escaped at the sink, digits-only at the parser…');

saveGame({ ...getGame('xss_g1'), status: GAME_STATUS.FINAL, homeScore: 21, awayScore: 17,
  homeRank: null, awayRank: null, espnEventId: `401${PAYLOAD}` });
const eidGame = getGame('xss_g1');
assert(eidGame.espnEventId === `401${PAYLOAD}`,
  'fixture: the poisoned event id survives saveGame()/getGame() (the state is reachable)');

const eidCard = app.renderGameCard(eidGame, null, PICK_RESULT.PENDING, true, true);
assert(/ESPN:/.test(eidCard.replace(/\s/g, '')) || /ESPN: /.test(eidCard), 'fixture: the ESPN id line rendered on the game card');
assert(!/<img/i.test(eidCard), '[10a] renderGameCard: no live <img from espnEventId');
assert(/&lt;img/.test(eidCard), '[10a] the id payload is present as escaped text');

const eidAdmin = app.renderAdminGamesList([eidGame], wk, {});
assert(!/<img/i.test(eidAdmin), '[10b] renderAdminGamesList: no live <img from espnEventId');
const eidAvail = app.renderAvailableGamesList([eidGame], [], wk);
assert(/ESPN:/.test(eidAvail.replace(/\s/g, '')), 'fixture: the available-games row rendered its ESPN id chip');
// The row also carries the whole game as JSON inside `data-game='…'`, a
// SINGLE-quoted attribute that escapes only `'`. `<`/`>` inside an attribute
// VALUE are inert, so that is safe as it stands and this batch does not change
// it (see the note by availAddPayloadJSON) — but it means the raw payload
// legitimately CONTAINS the "<img" text. The markup check below is therefore
// made against the row with that attribute removed, and the attribute gets its
// own assertion: it must not be closable.
const dataGame = (eidAvail.match(/data-game='([^']*)'/) || [])[1] || '';
assert(dataGame.length > 0, 'fixture: the + Add button carried its data-game payload');
assert(!dataGame.includes("'"),
  "[10c] the data-game payload contains no unescaped single quote — the attribute cannot be closed");
assert(JSON.parse(dataGame.replace(/&#39;/g, "'")).espnEventId === `401${PAYLOAD}`,
  '[10c] …and still round-trips as DATA, which is what the + Add handler needs');
const eidAvailMarkup = eidAvail.replace(/data-game='[^']*'/g, "data-game=''");
assert(!/<img/i.test(eidAvailMarkup), '[10c] renderAvailableGamesList: no live <img from espnEventId');
assert(/&lt;img/.test(eidAvailMarkup), '[10c] the id payload is present as escaped text in the ESPN chip');

// [10d] THE PARSER. A non-digit id never becomes a game field in the first
// place — defence in depth, and the layer that also protects the ESPN deep
// link and every String(espnEventId) comparison downstream.
const provider = await import('./js/data-provider.js');
const espnEvent = (id) => ({
  id,
  date: '2026-09-19T18:00Z',
  status: { type: { name: 'STATUS_SCHEDULED', detail: 'Sat, Sep 19', shortDetail: 'Sep 19' } },
  competitions: [{
    timeValid: true, neutralSite: false, odds: [], broadcasts: [], notes: [],
    competitors: [
      { homeAway: 'home', score: '0', team: { location: 'Proxy Home', name: 'Hosts', shortDisplayName: 'Proxy Home', abbreviation: 'PH' } },
      { homeAway: 'away', score: '0', team: { location: 'Proxy Away', name: 'Guests', shortDisplayName: 'Proxy Away', abbreviation: 'PA' } },
    ],
    venue: { fullName: 'Proxy Field', address: { city: 'Nowhere', state: 'NA' } },
  }],
});
const warned = [];
const realWarn = console.warn;
console.warn = (...a) => { warned.push(a.join(' ')); };
globalThis.fetch = async () => ({ ok: true, json: async () => ({ events: [espnEvent(`401${PAYLOAD}`), espnEvent('401520999')] }) });
const parsed = await provider.fetchCurrentCFBGames();
console.warn = realWarn;
globalThis.fetch = async () => { throw new Error('network disabled in xsstest'); };
const parsedIds = (parsed.games || []).map(g => g.espnEventId);
assert(parsedIds.length === 2, `fixture: both events parsed (got ${parsedIds.length})`);
assert(parsedIds.includes('401520999'), '[10d] a legitimate all-digits id is kept verbatim');
assert(!parsedIds.some(id => /[<>"'&\/\\ ]/.test(String(id))),
  `[10d] an id carrying any markup-forming character never reaches game.espnEventId — it is dropped to '' (got: ${JSON.stringify(parsedIds)})`);
assert(warned.some(w => /espnEventId/i.test(w)),
  `[10d] and the drop is announced on the console rather than happening silently (got: ${JSON.stringify(warned.slice(0, 3))})`);

// [10e] The rule is a CHARACTER allow-list, not digits-only, ON PURPOSE: the
// id is the join key between a parsed game and a stored one, so dropping an
// inert-but-unusual id would cost that game its live scores while protecting
// nothing the render-site escaping does not already cover. An inert id is
// KEPT — and warned about, so a genuine ESPN schema change is still visible.
const warned2 = [];
console.warn = (...a) => { warned2.push(a.join(' ')); };
globalThis.fetch = async () => ({ ok: true, json: async () => ({ events: [espnEvent('espn_evt_401520000')] }) });
const parsed2 = await provider.fetchCurrentCFBGames();
console.warn = realWarn;
globalThis.fetch = async () => { throw new Error('network disabled in xsstest'); };
assert(parsed2.games?.[0]?.espnEventId === 'espn_evt_401520000',
  `[10e] an inert non-numeric id is KEPT so score-refresh matching still works (got: ${JSON.stringify(parsed2.games?.[0]?.espnEventId)})`);
assert(warned2.some(w => /non-numeric/i.test(w)),
  '[10e] …and is warned about, because ESPN itself only ever sends digits');
for (const hostile of ['401<img src=x>', '401" onload="x', "401' onload='x", '401&lt;', '4 0 1', '401/../..', 'x'.repeat(65)]) {
  console.warn = () => {};
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ events: [espnEvent(hostile)] }) });
  const p3 = await provider.fetchCurrentCFBGames();
  console.warn = realWarn;
  assert(p3.games?.[0]?.espnEventId === '',
    `[10e] ${JSON.stringify(hostile.slice(0, 18))} is rejected outright (got: ${JSON.stringify(p3.games?.[0]?.espnEventId)})`);
}
globalThis.fetch = async () => { throw new Error('network disabled in xsstest'); };

// ══════════════════════════════════════════════════════════════════════════
// [11] C6 — renderUrlToken()'s own scheme allow-list (defence in depth)
//
// It can only be reached today through bodyHTML(), whose URL_RE matches
// http(s):// and www. and nothing else — so this is not a live hole. It is the
// guard for the NEXT caller: the function writes an <a href="…"> out of its
// argument and, on its own, trusted whatever it was handed.
// ══════════════════════════════════════════════════════════════════════════
console.log('\n[11] renderUrlToken() — scheme allow-list…');

assert(typeof chatUi._renderUrlTokenForTest === 'function',
  'fixture: chat-ui exposes renderUrlToken as a test seam (the `_messageHTMLForTest` convention)');
for (const hostile of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,x', 'vbscript:msgbox(1)', 'file:///etc/passwd']) {
  const out = chatUi._renderUrlTokenForTest(hostile, false);
  assert(!/<a\b/i.test(out) && !/href=/i.test(out),
    `[11a] ${hostile.slice(0, 24)} produces NO link at all (got: ${JSON.stringify(out.slice(0, 60))})`);
  assert(out.indexOf(hostile.split(':')[0]) === 0, `[11a] …and the token still reads as plain text`);
}
assert(!/<img/i.test(chatUi._renderUrlTokenForTest('data:text/html,x.png', true)),
  '[11b] the image-preview branch is behind the same allow-list — no <img src="data:…">');
const okLink = chatUi._renderUrlTokenForTest('https://irbfootball.com/x', false);
assert(/^<a href="https:\/\/irbfootball\.com\/x"/.test(okLink), `[11c] an ordinary https link is unchanged (got: ${JSON.stringify(okLink.slice(0, 60))})`);
const wwwLink = chatUi._renderUrlTokenForTest('www.espn.com', false);
assert(/^<a href="https:\/\/www\.espn\.com"/.test(wwwLink), `[11c] a bare www. link still gets its https:// prefix (got: ${JSON.stringify(wwwLink.slice(0, 60))})`);
const ampLink = chatUi._renderUrlTokenForTest('https://espn.com/?a=1&amp;b=2', false);
assert(!/&amp;amp;/.test(ampLink),
  `[11c] the guard does not DOUBLE-escape — its argument arrives already escaped from bodyHTML() (got: ${JSON.stringify(ampLink.slice(0, 70))})`);
const trailing = chatUi._renderUrlTokenForTest('https://espn.com/x).', false);
assert(/<a href="https:\/\/espn\.com\/x"/.test(trailing) && trailing.endsWith(').'),
  `[11c] trailing punctuation is still split off the href (got: ${JSON.stringify(trailing.slice(0, 80))})`);

// ══════════════════════════════════════════════════════════════════════════
// [12] B1 — the per-game chat view header / game sheet score line
// ══════════════════════════════════════════════════════════════════════════
console.log('\n[12] chat-ui game-thread header score…');
for (const [label, re] of [
  ['renderChatPage view header', /const score = g\.homeScore != null \? `\$\{esc\(g\.awayScore\)\}–\$\{esc\(g\.homeScore\)\}` : ''/],
  ['openGameChatSheet header', /const score = g && g\.homeScore != null \? `\$\{esc\(g\.awayScore\)\}–\$\{esc\(g\.homeScore\)\}` : ''/],
]) {
  assert(re.test(chatUiSrc), `[12a] ${label}: the score string is built through esc()`);
}
assert(chatUi._escForTest ? chatUi._escForTest(0) === '0' : true,
  '[12b] esc(0) is "0", not "" — esc() is a plain String() replace, so there is no zero-blanking risk here (this is why esc, not numHtml)');

// ══════════════════════════════════════════════════════════════════════════
// [13] B5 — escapers and attribute quoting
//
// escHtml() escapes & < > and the DOUBLE quote. It deliberately does not
// escape the apostrophe (it is the commonest character in league copy and
// double-escaping it reads badly), so every escaped interpolation must sit in
// a DOUBLE-quoted attribute. This is the guard that keeps that true.
// ══════════════════════════════════════════════════════════════════════════
console.log('\n[13] Escapers vs. attribute quoting…');
const SINGLE_QUOTED_ATTR = /=\s*'[^'\n]*\$\{(?:numHtml|escHtml|esc)\(/g;
for (const [file, src] of [['js/app.js', appSrc], ['js/chat-ui.js', chatUiSrc], ['js/admin-panel.js', adminPanelSrc]]) {
  SINGLE_QUOTED_ATTR.lastIndex = 0;
  const hits = [...src.matchAll(SINGLE_QUOTED_ATTR)].map(m => src.slice(0, m.index).split('\n').length);
  assert(hits.length === 0,
    `[13a] ${file}: no escaped interpolation sits inside a SINGLE-quoted attribute (escHtml does not escape "'") — found at: ${hits.join(', ') || 'none'}`);
}
const numHtmlDoc = appSrc.slice(Math.max(0, appSrc.indexOf('function numHtml(v){') - 1600), appSrc.indexOf('function numHtml(v){'));
assert(/DOUBLE-QUOTED attribute/i.test(numHtmlDoc) && /NOT the apostrophe/i.test(numHtmlDoc),
  "[13b] numHtml()'s docstring qualifies its attribute-safety claim to DOUBLE-quoted attributes and says why");

// ══════════════════════════════════════════════════════════════════════════
// [14] R1 — the C4 SIBLINGS: raw interpolation into a double-quoted value=""
//
// Round 2 coerced the tiebreaker/EP sites the reviewer named. It missed three
// siblings of the same shape, two of which are on the PICKS PAGE — the one
// screen every player in the league opens every week:
//
//   app.js renderTiebreakerInput()  value="${state.draftTiebreaker …}"
//   app.js renderExtraPointInput()  value="${val}"   (val ← state.draftExtraPoint)
//   app.js renderCommExtraPointCardHTML()  value="${week.extraPointActual …}"
//
// REACHABILITY is the whole point, and it is not hypothetical. Both draft
// values are SEEDED from the synced blob at renderPicksPage() (app.js) via
// getTiebreakerGuess()/getExtraPointGuess(), and BOTH of those accessors
// return whatever is in the blob with no coercion at all (storage.js — the
// `return v!==undefined?v:null` pair). setTiebreakerGuess() coerces on the
// way IN, but the blob is a synced Sheet cell: a hand edit, a bad restore or
// a hostile append is the reachable shape, exactly as for the scores in [2].
//
// An ATTRIBUTE needs no angle bracket to break out. A bare `"` closes
// value="…" and everything after it is parsed as new attributes on a REAL
// <input> element — which is why the payload here is a quote, not a tag.
// ══════════════════════════════════════════════════════════════════════════
console.log('\n[14] value="" siblings — picks page tiebreaker/Extra Point + EP admin actual…');

const ATTR_PAYLOAD = '1" autofocus onfocus="alert(1)';
const LIVE_ATTR = /\sonfocus\s*=\s*"/;   // a REAL attribute; the escaped form reads onfocus=&quot;

// [14a] REACHABILITY — the read accessors do not coerce, so the poisoned blob
// value arrives at state.draftTiebreaker / state.draftExtraPoint verbatim.
localStorage.setItem('cfbp_tiebreaker_guesses', JSON.stringify({ [`${wk.weekId}__xss_p1`]: ATTR_PAYLOAD }));
localStorage.setItem('cfbp_extra_point_guesses', JSON.stringify({ [`${wk.weekId}__xss_p1`]: ATTR_PAYLOAD }));
assert(storage.getTiebreakerGuess(wk.weekId, 'xss_p1') === ATTR_PAYLOAD,
  '[14a] getTiebreakerGuess() returns the blob value UNCOERCED — this is what seeds state.draftTiebreaker in edit mode');
assert(storage.getExtraPointGuess(wk.weekId, 'xss_p1') === ATTR_PAYLOAD,
  '[14a] getExtraPointGuess() returns the blob value UNCOERCED — this is what seeds state.draftExtraPoint in edit mode');

// [14b] THE TIEBREAKER INPUT — every player, every week.
app.state.draftTiebreaker = ATTR_PAYLOAD;
const tbInput = app._tiebreakerInputHTMLForTest({ ...wk, tiebreakerQuestion: 'Total points in the Sunday night game?' });
assert(/id="tb-input"/.test(tbInput), 'fixture: the tiebreaker input actually rendered');
assert(!LIVE_ATTR.test(tbInput),
  `[14b] renderTiebreakerInput: the draft guess cannot open a NEW attribute on the <input> (got: ${JSON.stringify((tbInput.match(/<input[^>]*>/) || [''])[0].slice(0, 160))})`);
assert(/&quot;/.test(tbInput), '[14b] …and the payload is present as escaped text inside the value');

// [14c] THE EXTRA POINT INPUT — same page, same shape, one card down.
app.state.draftExtraPoint = ATTR_PAYLOAD;
const epInput = app._extraPointInputHTMLForTest({ ...wk, extraPointEnabled: true });
assert(/id="ep-input"/.test(epInput), 'fixture: the Extra Point input actually rendered');
assert(!LIVE_ATTR.test(epInput),
  `[14c] renderExtraPointInput: the draft guess cannot open a NEW attribute (got: ${JSON.stringify((epInput.match(/<input[^>]*>/) || [''])[0].slice(0, 160))})`);

// [14d] THE COMMISSIONER'S "actual longest FG" — sibling of the :6752 site
// round 2 fixed, on the same card.
const epActualCard = app.renderCommExtraPointCardHTML({ ...wk, extraPointActual: ATTR_PAYLOAD });
assert(/id="ep-actual-input"/.test(epActualCard), 'fixture: the EP admin actual input actually rendered');
assert(!LIVE_ATTR.test(epActualCard),
  `[14d] renderCommExtraPointCardHTML: week.extraPointActual cannot open a NEW attribute (got: ${JSON.stringify((epActualCard.match(/<input[^>]*id="ep-actual-input"[^>]*>/) || epActualCard.match(/<input[^>]*>/) || [''])[0].slice(0, 160))})`);

// [14e] THE ZERO GUARD, three times. numHtml(0) is "0"; escHtml(0) is "".
// A 0-point tiebreaker guess, a 0-yard EP guess and a 0-yard actual must all
// still pre-fill the box, or the fix silently empties a player's saved entry
// the moment they hit "Edit My Picks".
app.state.draftTiebreaker = 0;
assert(/value="0"/.test(app._tiebreakerInputHTMLForTest({ ...wk, tiebreakerQuestion: 'q' })),
  '[14e] a 0 tiebreaker guess still pre-fills value="0"');
app.state.draftExtraPoint = 0;
assert(/value="0"/.test(app._extraPointInputHTMLForTest({ ...wk, extraPointEnabled: true })),
  '[14e] a 0-yard Extra Point guess still pre-fills value="0"');
assert(/id="ep-actual-input"[\s\S]{0,120}value="0"/.test(app.renderCommExtraPointCardHTML({ ...wk, extraPointActual: 0 })),
  '[14e] a 0-yard EP actual still pre-fills value="0"');

// [14f] THE EMPTY GUARD — an unset draft must render an EMPTY box, not the
// string "null"/"undefined"/"NaN". This is the ordinary path for every player
// who has not guessed yet, so it is the one a bad coercion would break first.
app.state.draftTiebreaker = null; app.state.draftExtraPoint = null;
assert(/value=""/.test(app._tiebreakerInputHTMLForTest({ ...wk, tiebreakerQuestion: 'q' })),
  '[14f] an unset tiebreaker renders value="" (not "null")');
assert(/value=""/.test(app._extraPointInputHTMLForTest({ ...wk, extraPointEnabled: true })),
  '[14f] an unset Extra Point guess renders value="" (not "null")');
assert(/id="ep-actual-input"[\s\S]{0,120}value=""/.test(app.renderCommExtraPointCardHTML({ ...wk, extraPointActual: null })),
  '[14f] an unset EP actual renders value="" (not "null")');
app.state.draftTiebreaker = null; app.state.draftExtraPoint = null;

// [14g] An ORDINARY guess still round-trips into the box — the pre-fill is the
// entire reason these attributes exist.
app.state.draftTiebreaker = 57; app.state.draftExtraPoint = 52;
assert(/value="57"/.test(app._tiebreakerInputHTMLForTest({ ...wk, tiebreakerQuestion: 'q' })),
  '[14g] an ordinary 57-point tiebreaker guess still pre-fills');
assert(/value="52"/.test(app._extraPointInputHTMLForTest({ ...wk, extraPointEnabled: true })),
  '[14g] an ordinary 52-yard Extra Point guess still pre-fills');
app.state.draftTiebreaker = null; app.state.draftExtraPoint = null;

// [14h] THE WEEK DATE ATTRIBUTES (reviewer note). week.startDate/endDate are
// commissioner-entered and travel through the same synced blob. RE-DERIVED
// (v0.27.0 UX Revamp post-deploy pass, 2026-09-27, DI-356) — renderCommPage()
// itself no longer renders these two fields at all: the standalone "Week
// Settings" card that used to (the `week.startDate`/`week.endDate` site this
// test originally pinned) is retired wholesale, and the ONE surviving
// commissioner-facing render site is `weekCreateFormFieldsHTML()`'s own Start
// Date/End Date inputs (the wizard's Step 1 form, reused by both the create
// flow and re-entering Step 1 on an existing draft) — same escHtml() call,
// same `value="…"` attribute shape, read off `defaults.startDate`/
// `defaults.endDate` (that function's own parameter, populated FROM
// `week.startDate`/`week.endDate` by its one caller, `renderWeekWizardStep1HTML()`)
// rather than `week.` directly. Still a SOURCE assertion (private function,
// wants a live container, same reasoning as before) — just re-pointed at the
// function that now actually owns this render.
for (const field of ['startDate', 'endDate']) {
  assert(new RegExp(`value="\\$\\{escHtml\\(defaults\\.${field}\\s*\\|\\|\\s*''\\)\\}"`).test(appSrc),
    `[14h] weekCreateFormFieldsHTML(): defaults.${field} (sourced from week.${field}) is escaped inside its value="" attribute`);
}

// ══════════════════════════════════════════════════════════════════════════
// [15] R2 — REACTION EMOJI (security-reviewer F3-1)
//
// The emoji is rendered as element CONTENT at two sites. Both sites escape
// the ATTRIBUTE copy on the very same line and leave the content copy raw:
//
//   chat-ui.js reactionsHTML()   data-react="${esc(emoji)}" … >${emoji} ${who.length}<
//   app.js     renderReactionStrip()  data-emoji="${escHtml(emoji)}" … >${emoji}<
//
// The emoji is NOT a constant by the time it reaches either sink. In chat it
// is `ev.meta.emoji` off an appended chat event — attacker-controlled text
// from the append endpoint — which becomes an OBJECT KEY in the fold and then
// a render leaf. On the dashboard it is a key in the synced `cfbp_reactions`
// blob. Same two-halves fix as C2 (accent): ESCAPE at both sinks, and
// ALLOW-LIST at both write seams against REACTION_PALETTE, the one shared
// palette already in data-model.js (AD-20).
// ══════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════
// [16] PHASE III STEP 4 PART B — THE NEW BANNERS RENDER SERVER TEXT
//
// The adapter's status channel carries FOUR values that did not exist before
// this build and that come from somewhere the app does not control:
//
//   detail.serverMessage   PostgREST's own words for a 42501, or an RPC's named
//                          exception. Server text.
//   detail.error           whatever a failed select or a thrown RPC produced.
//   detail.banner          §3.3's write-during-switch line, which INTERPOLATES
//                          TWO LEAGUE NAMES — commissioner-authored strings from
//                          a table any signed-in account can create a row in.
//   detail.key             a cfbp_* key name.
//
// js/supabase-backend.js's own header says it plainly: serverMessage "is
// UNTRUSTED TEXT — every render path must run it through escHtml()".
//
// THE RULE THIS SECTION PINS is narrower and stronger than "they are escaped":
// they reach exactly ONE render path, showBackendErrorBanner(), which escapes at
// its single sink. A second render path for the same values is how one of them
// gets escaped and the other does not — which is the shape defect (1) at the top
// of this file already was, one surface over.
// ══════════════════════════════════════════════════════════════════════════
console.log('\n[16] Step 4 — the adapter status channel\u2019s server text reaches ONE escaping sink\u2026');
{
  const codeOnly = appSrc
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');

  // (a) The sink itself still escapes. One line, and everything below depends on it.
  assert(/<div class="beb-detail">\$\{escHtml\(String\(message\)\)\}<\/div>/.test(codeOnly),
    '[16] showBackendErrorBanner() escapes its message at the sink');

  // (b) EVERY use of the four channel values is an ARGUMENT to that function —
  //     never an interpolation into markup of its own.
  const handler = codeOnly.slice(codeOnly.indexOf('function onSupabaseDataStatus'), codeOnly.indexOf('function showSupabaseOfflineBanner'));
  assert(handler.length > 200, '[16] fixture: the Step-4 status handler was located (a failed slice would make the rest vacuous)');
  assert(!/innerHTML/.test(handler),
    '[16] the status handler assigns NO innerHTML of its own — it hands its values to the banner helpers and renders nothing directly');
  const sites = [...codeOnly.matchAll(/detail\.(serverMessage|error|banner|key)/g)];
  assert(sites.length >= 4, `[16] fixture: the four channel values really are read (${sites.length} sites)`);
  for (const m of sites) {
    // The 200 characters around each read must not contain a markup-bearing
    // template. `showBackendErrorBanner(...)` is the only legitimate consumer.
    const near = codeOnly.slice(Math.max(0, m.index - 200), m.index + 200);
    assert(!/<[a-z][^>]*>\s*\$\{/.test(near) || /showBackendErrorBanner\(/.test(near),
      `[16] detail.${m[1]} is never interpolated into markup \u2014 it is an argument to showBackendErrorBanner(), which escapes`);
  }

  // (c) THE CANARY. The rule must FAIL against a handler that renders directly,
  //     or (b) is passing over the absence of markup rather than over its safety.
  const crafted = 'function onSupabaseDataStatus(status, detail){ el.innerHTML = `<div>${detail.serverMessage}</div>`; }';
  assert(/innerHTML/.test(crafted) && /<[a-z][^>]*>\s*\$\{/.test(crafted.slice(0, 200)),
    '[16] canary: a handler that DID interpolate serverMessage into markup is detected by the same two tests');

  // (d) The two Step-4 banners that build their OWN markup escape everything
  //     they interpolate, even though both values are app-derived today.
  //     "It happens to be safe right now" is not a rendering rule.
  const offline = codeOnly.slice(codeOnly.indexOf('function showSupabaseOfflineBanner'), codeOnly.indexOf('function hideSupabaseOfflineBanner'));
  assert(/innerHTML = `<span>\$\{escHtml\(text\)\}<\/span>`/.test(offline),
    '[16] the offline read-only banner escapes its whole line');
  const note = codeOnly.slice(codeOnly.indexOf('function supabaseProgressUnknownNoteHTML'), codeOnly.indexOf('function supabaseProgressUnknownNoteHTML') + 900);
  assert(/\$\{escHtml\(/.test(note),
    '[16] the "who else has picks in" note escapes its interpolation');
  // The time value IS interpolated — INSIDE the escHtml() argument, which is the
  // point: the whole line is escaped as ONE string, so there is no seam between
  // "the literal part" and "the value part" for a future edit to widen. What
  // must not exist is an interpolation sitting directly in the MARKUP.
  const noteMarkup = (note.match(/`<p class="blind-note">[\s\S]*?`;/) || [''])[0];
  assert(noteMarkup.length > 40, '[16] fixture: the note\u2019s markup template was located');
  const escAt = noteMarkup.indexOf('${escHtml(');
  assert(escAt > -1 && /<span>\$\{escHtml\(/.test(noteMarkup),
    '[16] \u2026the ONE interpolation adjacent to the note\u2019s markup is an escHtml() call');
  const tailAt = noteMarkup.indexOf('${tail}');
  assert(tailAt === -1 || tailAt > escAt,
    `[16] \u2026and the time value is interpolated INSIDE that call, not beside it (escHtml@${escAt}, tail@${tailAt})`);
  const offlineMarkup = (offline.match(/`<span>[\s\S]*?`;/) || [''])[0];
  assert([...offlineMarkup.matchAll(/\$\{/g)].length === 1 && /\$\{escHtml\(text\)\}/.test(offlineMarkup),
    '[16] \u2026and the offline banner\u2019s markup likewise: one interpolation, and it is escaped');

  // (e) The hold-gate variant Step 4 added goes through the SAME escaping
  //     renderer the other three do \u2014 it is copy in a map, not a new sink.
  assert(/'data-hold': \{/.test(codeOnly),
    '[16] the data-hold variant is an entry in AUTH_HOLD_COPY');
  assert(/\$\{escHtml\(copy\.heading\)\}/.test(codeOnly) && /\$\{escHtml\(copy\.body\)\}/.test(codeOnly),
    '[16] \u2026and authHoldGateInnerHTML() escapes both, so the new variant inherits the escaping rather than restating it');

  // (f) js/backend.js's typed relay refusal carries an INTERNAL action name and
  //     is never rendered by this file at all \u2014 stated so a future caller that
  //     starts rendering it has to come back here.
  assert(!/SheetsRelayRefusedError/.test(codeOnly),
    '[16] js/app.js renders no SheetsRelayRefusedError text \u2014 every relay caller already degrades through its own try/catch');
}

console.log('\n[15] reaction emoji — escaped at both content sinks, allow-listed at both write seams…');

const { REACTION_PALETTE } = dataModel;
const HOSTILE_EMOJI = '<img src=x onerror=alert(1)>';

// [15a] SINK — chat-ui reactionsHTML(), through the exported seam.
const hostileMsg = {
  id: 'm_react', type: 'message', author: 'xss_acc', gameTag: '', ts: Date.now(),
  body: 'hi', reactions: { [HOSTILE_EMOJI]: ['xss_acc'] }, meta: null,
};
const reactHtml = chatUi._reactionsHTML(hostileMsg, 'xss_other');
assert(/chat-react-pill/.test(reactHtml), 'fixture: the reaction pill actually rendered');
assert(!/<img/i.test(reactHtml),
  `[15a] reactionsHTML: no live <img from the emoji in the pill's CONTENT (got: ${JSON.stringify(reactHtml.slice(0, 200))})`);
assert(/&lt;img/.test(reactHtml), '[15a] …the payload is present as escaped text');
assert(/ 1<\/button>/.test(reactHtml),
  `[15a] …and the pill still shows its reactor COUNT (got: ${JSON.stringify(reactHtml.slice(0, 200))})`);

// [15b] SINK — the dashboard reaction strip (app.js), same shape.
localStorage.setItem('cfbp_reactions', JSON.stringify({ [wk.weekId]: { xss_g1: { [HOSTILE_EMOJI]: ['xss_p1'] } } }));
const strip = app._reactionStripForTest(wk.weekId, 'xss_g1', [{ playerId: 'xss_p1', displayName: 'Tester', active: true }]);
assert(/reaction-chip/.test(strip), 'fixture: the dashboard reaction strip actually rendered a chip');
assert(!/<img/i.test(strip),
  `[15b] renderReactionStrip: no live <img from the emoji in the chip's CONTENT (got: ${JSON.stringify(strip.slice(0, 220))})`);
assert(/&lt;img/.test(strip), '[15b] …the payload is present as escaped text');

// [15c] AN ORDINARY EMOJI IS UNTOUCHED — the escaper must not mangle 🔥 or the
// multi-codepoint ☝️ (ZWJ/variation-selector sequences are exactly what a
// naive "strip non-ASCII" fix would eat).
for (const em of ['🔥', '☝️', '👍']) {
  const okMsg = { ...hostileMsg, reactions: { [em]: ['xss_acc'] } };
  assert(chatUi._reactionsHTML(okMsg, 'xss_other').includes(em),
    `[15c] reactionsHTML renders ${em} unchanged`);
  localStorage.setItem('cfbp_reactions', JSON.stringify({ [wk.weekId]: { xss_g1: { [em]: ['xss_p1'] } } }));
  assert(app._reactionStripForTest(wk.weekId, 'xss_g1', [{ playerId: 'xss_p1', displayName: 'T', active: true }]).includes(em),
    `[15c] renderReactionStrip renders ${em} unchanged`);
}

// [15d] WRITE SEAM 1 — the FOLD. A hostile 'react' event must be SKIPPED, not
// thrown on: chat.js folds one append-only log and the fold must stay
// order-independent and idempotent (AD-09/AD-10). Throwing would abort
// ingest() mid-batch and lose every later event in the same poll — so the
// event is dropped and the rest of the fold is unaffected.
const chat = await import('./js/chat.js');
chat._resetForTest();
chat.ingest([
  { id: 'rx1', type: 'message', seq: 1, ts: 1000, author: 'p1', body: 'target' },
  { id: 'rx2', type: 'react', seq: 2, ts: 2000, author: 'p2', targetId: 'rx1', meta: { emoji: HOSTILE_EMOJI } },
  { id: 'rx3', type: 'react', seq: 3, ts: 3000, author: 'p3', targetId: 'rx1', meta: { emoji: '🔥' } },
  { id: 'rx4', type: 'message', seq: 4, ts: 4000, author: 'p1', body: 'after the hostile event' },
], 4, { caughtUp: true });
const rx1 = chat.getMessage('rx1');
assert(rx1 && rx1.body === 'target', 'fixture: the react target folded normally');
assert(!Object.keys(rx1.reactions || {}).some(k => k.includes('<')),
  `[15d] the fold DROPS a react event whose emoji is not in REACTION_PALETTE (got keys: ${JSON.stringify(Object.keys(rx1.reactions || {}))})`);
assert((rx1.reactions['🔥'] || []).includes('p3'),
  '[15d] …while a PALETTE emoji on the same target still folds');
assert(chat.getMessage('rx4')?.body === 'after the hostile event',
  '[15d] …and the hostile event did not abort the rest of the batch (skip, never throw)');

// [15e] …and the drop is ORDER-INDEPENDENT — a react buffered BEFORE its
// target arrives takes the other branch of ingest() and must be rejected at
// the same place (applyTo), not sneak in via the buffer replay.
chat._resetForTest();
chat.ingest([
  { id: 'rx6', type: 'react', seq: 1, ts: 1000, author: 'p2', targetId: 'rx5', meta: { emoji: HOSTILE_EMOJI } },
  { id: 'rx5', type: 'message', seq: 2, ts: 2000, author: 'p1', body: 'target arrives second' },
], 2, { caughtUp: true });
assert(!Object.keys(chat.getMessage('rx5')?.reactions || {}).some(k => k.includes('<')),
  '[15e] a BUFFERED hostile react is rejected on replay too (the fold stays order-independent)');
chat._resetForTest();

// [15f] WRITE SEAM 2 — storage.toggleReaction(), mirroring setAccent(): an
// exact allow-list match against REACTION_PALETTE, REFUSED (return false) if
// not, and nothing written.
localStorage.setItem('cfbp_reactions', JSON.stringify({}));
assert(storage.toggleReaction(wk.weekId, 'xss_g1', HOSTILE_EMOJI, 'xss_p1') === false,
  '[15f] toggleReaction() REFUSES an emoji outside REACTION_PALETTE and returns false');
assert(Object.keys(storage.getReactionsForGame(wk.weekId, 'xss_g1')).length === 0,
  '[15f] …and writes nothing at all — the blob is untouched');
const okToggle = storage.toggleReaction(wk.weekId, 'xss_g1', REACTION_PALETTE[0], 'xss_p1');
assert(Array.isArray(okToggle) && okToggle.includes('xss_p1'),
  `[15f] …while a palette emoji still toggles ON and returns the voter list (got: ${JSON.stringify(okToggle)})`);
const offToggle = storage.toggleReaction(wk.weekId, 'xss_g1', REACTION_PALETTE[0], 'xss_p1');
assert(Array.isArray(offToggle) && !offToggle.includes('xss_p1'),
  '[15f] …and toggles OFF again (the refusal must not break the toggle contract)');
for (const em of REACTION_PALETTE) {
  assert(Array.isArray(storage.toggleReaction(wk.weekId, 'xss_g2', em, 'xss_p1')),
    `[15f] every one of the 18 palette entries is accepted (${em})`);
}
localStorage.setItem('cfbp_reactions', JSON.stringify({}));

// [15g] The CALLERS survive the new false. bindReactionHandlers() does
// `after.includes(session.playerId)` on the return value — a bare `false`
// there is a TypeError that would break the picker for everyone, so the guard
// has to be at the call site too ([8d]'s lesson, one seam over).
const toggleCalls = [...appSrc.matchAll(/=\s*toggleReaction\(/g)];
assert(toggleCalls.length === 2,
  `[15g] app.js has exactly the 2 known toggleReaction() call sites — a NEW one must be guarded too (got: ${toggleCalls.length})`);
for (const m of toggleCalls) {
  const tail = appSrc.slice(m.index, m.index + 260);
  const guardAt = tail.indexOf('Array.isArray(after)');
  const useAt = tail.indexOf('after.includes(');
  assert(guardAt >= 0 && useAt >= 0 && guardAt < useAt,
    `[15g] the toggleReaction() call site guards its return with Array.isArray BEFORE .includes() (got: ${JSON.stringify(tail.slice(0, 200))})`);
}

// [15h] ONE palette, not two ([8e]'s rule for accents, applied to emoji).
// Both write seams must validate against the SAME frozen list the pickers
// render from, or the allow-list drifts away from the UI.
assert(Object.isFrozen(REACTION_PALETTE),
  '[15h] REACTION_PALETTE is frozen — an allow-list that can be pushed to is not an allow-list');
const chatSrc = await readFile(new URL('./js/chat.js', import.meta.url), 'utf8');
assert(/REACTION_PALETTE/.test(storageSrc) && /REACTION_PALETTE/.test(chatSrc),
  '[15h] both write seams validate against data-model.js REACTION_PALETTE, not a local literal');
for (const [file, src] of [['js/storage.js', storageSrc], ['js/chat.js', chatSrc], ['js/app.js', appSrc], ['js/chat-ui.js', chatUiSrc], ['js/admin-panel.js', adminPanelSrc]]) {
  assert(!/\[\s*'👍'\s*,\s*'👎'\s*,\s*'🔥'/.test(src),
    `[15h] ${file} does not re-declare the emoji palette as a local literal`);
}

// ══════════════════════════════════════════════════════════════════════════
console.log(`\n${fail === 0 ? '✅' : '❌'} xsstest.mjs — ${pass} passed, ${fail} failed`);
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
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));

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
