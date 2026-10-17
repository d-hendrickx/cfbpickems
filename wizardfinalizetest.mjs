/**
 * CFB Pickems — wizardfinalizetest.mjs (FB-027 / UN-417 / PF-417, bug batch W, W-46, 2026-10-07)
 * ==========================================================================================
 * Drew (tracker, verbatim): "Bug, i should be able to finalize the week in the week wizard, this should include the tie breaker and longest field goal."
 *
 * THE REPRODUCTION, made permanent. Driven through the REAL js/app.js against a real element tree built from the real index.html (minidom.mjs, the
 * homenavtest / leaguesettingsuitest precedent), local data mode, so nothing about the sheet, its steps or its handlers is a fixture:
 *   a LIVE week, every game FINAL with a locked spread, two players who both guessed the tiebreaker and the longest field goal, and `pendingFinalization`
 *   FALSE (the background tick has not raised it on this device, or "Not yet" cleared it). Before the fix the wizard's Manage screen offered NO guided
 *   Finalize entry at all (it rendered only when `pendingFinalization` was true), and the one Finalize control on screen — the status-row "Finalize" —
 *   applied `final` directly: the week finalized with `actualTiebreakerValue: null` and `extraPointActual: null`, Steps 2 and 3 never shown.
 *
 *   [1] DI-518 — every Finalize entry opens the guided flow: the full-width button above Timing (label by state, sport code in a multi-sport league), the
 *       all-final banner, the status-row "Finalize", Comm → Week's `.week-status-btn[data-to="final"]`, "Not yet" clears nothing, re-entry after Cancel,
 *       no Finalize control outside LIVE, the status badge.
 *   [2] DI-519 — the four steps: Step 1's count line; Step 2's source chip and its block once players have guessed; Step 3 shown only when the Extra Point
 *       contest is on (copy, detection prefill); Step 4's review card (every required value, `Missing` never 0, blocks on missing data); success; the
 *       refused / pending save (the sheet stays, the inline retry row, Retry); the double tap.
 *
 *   [3] the DI-518 amendment — a next-week draft never hides the live week's Finalize (the "Week N is live" row), per sport.
 *   [C1] D1 integration (reviewer C1, 2026-10-07) — with feat/d1-integrity merged: every Finalize entry, for an alma week and an NFL week (the designated
 *       game), stores the COMPLETE calculated tiebreaker DI-516 computes through Step 2, and the results use it.
 *   [4] B1 against the real adapter (LAST: it switches the process to Supabase data mode).
 *
 * NOT COVERED HERE (a device, never a test): the sheet's motion and swipe-to-dismiss, the success haptic's feel, 44 pt targets as laid out, VoiceOver,
 * the wrap to a stack at 375 pt. A REAL Supabase refusal of finalize_week is the adapter's (adaptertest / authtest); this suite injects the server's answer
 * through `_setFinalizeConfirmForTest`, the `_xForTest` convention.
 *
 * Run:  node wizardfinalizetest.mjs
 */
import { readFileSync } from 'node:fs';
import { MiniDocument, MiniElement } from './minidom.mjs';
// minidom.mjs has no insertAdjacentHTML; supplied here exactly as homenavtest.mjs does (the file is not edited).
if (typeof MiniElement.prototype.insertAdjacentHTML !== 'function') {
  MiniElement.prototype.insertAdjacentHTML = function (pos, html) {
    const t = this.ownerDocument.createElement('div'); t.innerHTML = html;
    const kids = [...t._children]; t._children = [];
    if (pos === 'afterbegin') { for (const k of kids.reverse()) { k.parentNode = this; this._children.unshift(k); } }
    else { for (const k of kids) { k.parentNode = this; this._children.push(k); } }
  };
}

let pass = 0, fail = 0;
const _log = console.log.bind(console), _err = console.error.bind(console);
const assert = (cond, label, extra = '') => {
  if (cond) { pass++; _log('  ✅', label); } else { fail++; _err('  ❌', label, extra ? `\n     ${extra}` : ''); }
};
const tick = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// ── the browser, as far as the modules under test can tell ──────────────────────────────────────────────────────────────
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear(), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; } };
globalThis.window = globalThis;
globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
let reloads = 0;   // PF-416 follow-up, item 2: a refused finalize's one action reloads the app (counted here, never performed)
globalThis.location = { origin: 'https://irbfootball.test', reload() { reloads++; }, search: '', hash: '' };
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined }, configurable: true }); }
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.matchMedia = () => ({ matches: false });
globalThis.fetch = async () => { throw new Error('network disabled in wizardfinalizetest'); };
let confirmCalls = 0;
globalThis.confirm = () => { confirmCalls++; return true; }; globalThis.prompt = () => null; globalThis.alert = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'u' + Math.random().toString(36).slice(2) };
const realWarn = console.warn, realInfo = console.info, realError = console.error;
console.warn = () => {}; console.info = () => {};

const INDEX = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const bodyHtmlOf = (html) => html.slice(html.indexOf('<body'), html.indexOf('</body>')).replace(/<script[\s\S]*?<\/script>/g, '').replace(/^<body[^>]*>/, '');
const freshDoc = () => { const d = new MiniDocument(); d.body.innerHTML = bodyHtmlOf(INDEX); return d; };
globalThis.document = freshDoc();

const app = await import('./js/app.js');
const storage = await import('./js/storage.js');
const dm = await import('./js/data-model.js');
const sportSeam = await import('./js/sport-seam.js');   // D1 (Lane A): the Comm sport lens - which sport's week the Manage / wizard screens act on

// ── fixture ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
const WK = 'wk_wf';
const TB_Q = 'What is the total combined points scored by all alma mater teams on the slate this week?';
function seed({ status = 'live', allFinal = true, pending = false, question = TB_Q, tbGuesses = true, epEnabled = true, epGuesses = true,
  detect = null, tbActual = null, epActual = null, weekNumber = 6, competitionId = undefined, competitions = null } = {}) {
  store.clear();
  globalThis.document = freshDoc();
  storage.savePlayer({ ...dm.createPlayer('Drew'), playerId: 'p1', almaMater: 'Texas' });
  storage.savePlayer({ ...dm.createPlayer('Kevin'), playerId: 'p2', almaMater: 'Iowa' });
  if (competitions) competitions.forEach((c) => storage.saveCompetition(c));
  sportSeam.resetLensSport();
  const week = {
    ...dm.createWeek('2026', weekNumber, '2026-10-03', '2026-10-04'), weekId: WK, status, pendingFinalization: pending,
    tiebreakerQuestion: question, tiebreakerCalculationMode: 'allAlmaMaterGames', lockedAlmaMaters: ['Texas', 'Iowa'],
    actualTiebreakerValue: tbActual, tiebreakerFinalized: tbActual != null, extraPointEnabled: epEnabled, extraPointActual: epActual,
    extraPointDetect: detect, blurb: 'Rivalry week, everybody.',
  };
  if (competitionId !== undefined) week.competitionId = competitionId;
  storage.saveWeek(week);
  storage.setActiveWeekId(WK);
  // D1 (DI-534): in a league that runs two sports the Manage screens act on the week of the commissioner's LENS sport (the default until he moves it). A fixture whose week belongs to another sport
  // puts the lens on that sport, exactly as the commissioner would by tapping it.
  // D1 third pass (DI-534 REV 5 (b)): only a VERIFIED COMMISSIONER gets a separate lens, so the fixture IS the commissioner when he taps it (it used to tap it as nobody, which the lens now refuses).
  if (competitions && competitionId) { const c = competitions.find((x) => x.id === competitionId); if (c) { storage.setSession('p1', true, true); sportSeam.setLensSport(c.sport); } }
  storage.saveGame({ ...dm.createGame(WK, { homeTeam: 'Texas', awayTeam: 'Oklahoma', spread: -3.5 }), gameId: 'g1', status: 'final', homeScore: 31, awayScore: 24, lockedSpread: -3.5 });
  storage.saveGame({ ...dm.createGame(WK, { homeTeam: 'Purdue', awayTeam: 'Iowa', spread: 2.5 }), gameId: 'g2', status: allFinal ? 'final' : 'in_progress', homeScore: 17, awayScore: 20, lockedSpread: 2.5 });
  storage.saveAllPicks([
    { ...dm.createPick(WK, 'g1', 'p1', 'Texas'), pickId: 'pk1' }, { ...dm.createPick(WK, 'g2', 'p1', 'Iowa'), pickId: 'pk2' },
    { ...dm.createPick(WK, 'g1', 'p2', 'Texas'), pickId: 'pk3' }, { ...dm.createPick(WK, 'g2', 'p2', 'Iowa'), pickId: 'pk4' },
  ]);
  if (tbGuesses) { storage.setTiebreakerGuess(WK, 'p1', 70); storage.setTiebreakerGuess(WK, 'p2', 80); }
  if (epGuesses) { storage.setExtraPointGuess(WK, 'p1', 48); storage.setExtraPointGuess(WK, 'p2', 52); }
}
const body = () => document.getElementById('week-wizard-body');
const html = () => (body() ? body().innerHTML : '');
const text = () => norm(body() ? body().textContent : '');
const tracker = () => norm(document.getElementById('week-wizard-step-tracker')?.textContent);
const openWizard = () => { app._openWeekWizardSheetForTest(); return body(); };
// W-70 (2026-10-14, DI-W70.1) - RE-DERIVED, not weakened: the close button now ASKS first when the step holds unsaved edits (a typed schedule time is one), so closing a sheet the test left
// edited means answering "Discard Changes". A clean sheet closes at once, exactly as before; the property under test (what a FRESH sheet inherits from a closed one) is unchanged.
const closeSheet = () => { document.getElementById('week-wizard-close')?.click(); document.getElementById('ls-action-layer')?.querySelector('[data-ls-action="discard"]')?.click(); };
const wk = () => storage.getWeek(WK);
const toasts = () => [...document.querySelectorAll('#toast-container .toast')].map((t) => norm(t.textContent));
const onStep = (title) => !!body() && [...body().querySelectorAll('.admin-section-title')].some((e) => norm(e.textContent) === title);
const click = (sel) => { const el = body()?.querySelector(sel); if (el) el.click(); return !!el; };
/** Review follow-up 2 (2026-10-08) — the success haptic, counted. haptic() is native-only (isNativeShell() + the Capacitor Haptics plugin), so a
 *  stub shell is installed ONLY around the press being measured and removed after, and nothing else in this suite runs as native. Counts the
 *  'success' notifications (js/haptics.js: Haptics.notification({ type: 'SUCCESS' })). */
async function successHapticsDuring(fn, onSuccess = null) {   // W-22: `onSuccess` runs at each success haptic, inside the success path's own turn
  let n = 0;
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'Capacitor'), prev = globalThis.Capacitor;
  globalThis.Capacitor = { isNativePlatform: () => true, Plugins: { Haptics: { notification: (o) => { if (o && o.type === 'SUCCESS') { n++; if (onSuccess) onSuccess(); } }, impact() {}, selectionStart() {}, selectionChanged() {}, selectionEnd() {} } } };
  try { await fn(); } finally { if (had) globalThis.Capacitor = prev; else delete globalThis.Capacitor; }
  return n;
}
const setVal = (sel, v) => { const el = body()?.querySelector(sel); if (el) el.value = String(v); return !!el; };
const seam = typeof app._setFinalizeConfirmForTest === 'function' ? app._setFinalizeConfirmForTest : null;
/** Steps 1-3 of the guided flow, from the Manage screen. `tb` is typed into Step 2 (null leaves the prefill). */
function walkToStep4({ tb = null, ep = null } = {}) {
  click('#wiz-open-finalize-btn');
  click('#wiz-fin-next');                                         // Step 1 → 2
  if (tb !== null) setVal('#wiz-fin-tb-value', tb);
  click('#wiz-fin-next');                                         // Step 2 → 3 (or 4)
  if (onStep('Longest field goal (Extra Point)')) {
    if (ep !== null) setVal('#wiz-fin-ep-value', ep);
    click('#wiz-fin-next');                                       // Step 3 → 4
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[1] DI-518 — every Finalize entry opens the guided flow (the FB-027 reproduction)…');
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  seed({ pending: false });
  openWizard();
  assert(/Manage/.test(document.getElementById('week-wizard-title')?.textContent || '') && !!body(), '1-0: (fixture) the wizard opens on the LIVE week\'s Manage screen');
  const entry = body()?.querySelector('#wiz-open-finalize-btn');
  assert(!!entry, 'FB-027 1-1: a LIVE week with pendingFinalization FALSE still offers the guided Finalize entry on the Manage screen (it rendered only when the background tick had raised the flag)', `Manage html: ${html().slice(0, 400)}`);
  assert(!!entry && norm(entry.textContent) === 'Finalize Week' && entry.classList.contains('btn-primary') && entry.classList.contains('btn-block'),
    `1-2: every game final ⇒ it is a full-width primary "Finalize Week" (got ${JSON.stringify(entry && norm(entry.textContent))})`);
  const iEntry = html().indexOf('id="wiz-open-finalize-btn"'), iTiming = html().indexOf('>Timing<');
  assert(iEntry > -1 && iTiming > -1 && iEntry < iTiming, '1-3: the Finalize Week button sits ABOVE the Timing fields (the commissioner\'s next action)');
  assert(text().includes('All games are final. Ready to close this week and lock standings?'), '1-4: the all-final banner copy sits above it, keyed to the games, not to pendingFinalization');
  const badge = body()?.querySelector('.badge.badge-live');
  assert(!!badge && norm(badge.textContent) === 'LIVE', '1-5: the status line uses a status badge (LIVE), not raw text (touched-screen audit)');

  // the status-row "Finalize" — the control that used to finalize on the spot
  const statusFinal = body()?.querySelector('.week-wizard-status-btn[data-to="final"]');
  assert(!!statusFinal, '1-6: (fixture) the status row still offers "Finalize"');
  statusFinal?.click();
  assert(wk().status === 'live' && wk().finalizedAt == null, `FB-027 1-7: tapping the status-row "Finalize" does NOT finalize the week (status ${wk().status}, actualTiebreakerValue ${JSON.stringify(wk().actualTiebreakerValue)})`);
  assert(onStep('Approve Scores') && /Step 1 of/.test(tracker()), `FB-027 1-8: …it opens the guided flow at Step 1, Approve Scores (tracker "${tracker()}")`);
  closeSheet();

  // the full-width button opens Step 1 too
  openWizard(); click('#wiz-open-finalize-btn');
  assert(onStep('Approve Scores') && wk().status === 'live', '1-9: "Finalize Week" opens Step 1 and writes nothing');
  // Cancel at Step 1, then re-enter: nothing was cleared, the entry is still there
  click('#wiz-fin-cancel');
  assert(document.getElementById('week-wizard-sheet-wrap') === null, '1-10: (fixture) Cancel at Step 1 closes the sheet');
  openWizard();
  assert(!!body()?.querySelector('#wiz-open-finalize-btn') && wk().status === 'live', '1-11: re-entry after Cancel: the Finalize entry is still offered (Cancel cleared nothing)');
  closeSheet();
}
{
  // "Not yet" clears NOTHING: it hides the prompt on this screen, writes no field (pendingFinalization feeds the 24 h commissioner reminder)
  seed({ pending: true });
  openWizard();
  const notYet = body()?.querySelector('#wiz-final-not-yet');
  assert(!!notYet && norm(notYet.textContent) === 'Not yet', '1-12: the all-final banner carries "Not yet"');
  const before = JSON.stringify(wk());
  notYet?.click();
  assert(JSON.stringify(wk()) === before && wk().pendingFinalization === true, '1-13: "Not yet" writes nothing — pendingFinalization stays true, the week row is byte-identical');
  assert(!text().includes('All games are final.') && !!body()?.querySelector('#wiz-open-finalize-btn'), '1-14: …it hides the prompt, and the Finalize Week button stays (the commissioner can still finalize)');
  closeSheet();
}
{
  // not every game final: the button reads "Review & finalize", no all-final banner, and Step 1 names what blocks
  seed({ allFinal: false });
  openWizard();
  const entry = body()?.querySelector('#wiz-open-finalize-btn');
  assert(!!entry && norm(entry.textContent) === 'Review & finalize', `1-15: LIVE with a game still in progress ⇒ the button reads "Review & finalize" (got ${JSON.stringify(entry && norm(entry.textContent))})`);
  assert(!text().includes('All games are final.'), '1-16: …and the all-final banner is absent');
  entry?.click();
  assert(onStep('Approve Scores') && /Purdue[^.]*not final yet/.test(text()) && body()?.querySelector('#wiz-fin-next')?.disabled === true,
    '1-17: Step 1 lists the game that blocks and Next is disabled');
  closeSheet();
}
{
  // no Finalize control outside LIVE
  for (const status of ['open', 'locked']) {
    seed({ status });
    openWizard();
    assert(!body()?.querySelector('#wiz-open-finalize-btn') && !body()?.querySelector('[data-to="final"]'), `1-18 (${status}): no Finalize control at all`);
    closeSheet();
  }
  seed({ status: 'final' });
  openWizard();
  assert(!body()?.querySelector('#wiz-open-finalize-btn') && !!body()?.querySelector('.week-wizard-status-btn[data-to="live"]'), '1-19 (final): no Finalize control; "Reopen to Live" as today');
  closeSheet();
}
{
  // a multi-sport league names the sport: "Finalize NFL Week 6"
  seed({ competitionId: 'c_nfl', competitions: [
    { id: 'c_cfb', sport: 'cfb', isDefault: true, createdAt: '2026-08-01T00:00:00Z' },
    { id: 'c_nfl', sport: 'nfl', isDefault: false, createdAt: '2026-09-01T00:00:00Z' },
  ] });
  openWizard();
  const entry = body()?.querySelector('#wiz-open-finalize-btn');
  assert(!!entry && norm(entry.textContent) === 'Finalize NFL Week 6', `1-20: in a multi-sport league the button carries the sport code (got ${JSON.stringify(entry && norm(entry.textContent))})`);
  closeSheet();
  seed({});
  openWizard();
  assert(norm(body()?.querySelector('#wiz-open-finalize-btn')?.textContent) === 'Finalize Week', '1-21: …and a single-sport league keeps "Finalize Week"');
  closeSheet();
}
{
  // Comm → Week's .week-status-btn[data-to="final"] opens the guided flow too, never applies `final`
  seed({});
  const host = document.createElement('div');
  host.innerHTML = '<button class="btn btn-primary btn-sm week-status-btn" data-to="final">Finalize</button>';
  document.body.appendChild(host);
  const w = wk();
  app.bindCommEventListeners(w, storage.getGames(WK), [], [], storage.getSettings(), [w], []);
  confirmCalls = 0;
  host.querySelector('.week-status-btn').click();
  assert(wk().status === 'live' && wk().finalizedAt == null, `1-22: Comm → Week's "Finalize" does NOT finalize (status ${wk().status})`);
  assert(onStep('Approve Scores') && /Finalize/.test(document.getElementById('week-wizard-title')?.textContent || ''), '1-23: …it opens the guided flow at Step 1, for that week');
  assert(confirmCalls === 0, '1-24: …with no browser confirm() (the tie notice is Step 4\'s inline warning now)');
  closeSheet();
}

// Section [2] seeds pendingFinalization TRUE on purpose: that is the one state in which the pre-fix tree reached the guided flow at all, so every
// assertion below fails (before the fix) on DI-519's own behaviour, not as a cascade of [1]'s missing entry. [1] proves the entry no longer depends on it.
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[2] DI-519 — the review step shows every required value and blocks on missing data…');
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  seed({ pending: true });
  openWizard(); click('#wiz-open-finalize-btn');
  assert(text().includes('2 of 2 games final · spreads locked'), `2-1: Step 1 adds the count "{F} of {N} games final · spreads locked" (text: ${text().slice(0, 160)})`);
  click('#wiz-fin-next');
  assert(onStep('Confirm Tiebreaker') && text().includes(TB_Q), '2-2: Step 2 shows the question');
  const tb = body()?.querySelector('#wiz-fin-tb-value');
  assert(!!tb && tb.value === '51', `2-3: …the effective value is the calculated total (Texas 31 + Iowa 20 = 51) in the override field (got ${JSON.stringify(tb && tb.value)})`);
  const chip = body()?.querySelector('#wiz-fin-tb-chip');
  assert(!!chip && norm(chip.textContent) === 'Calculated', `2-4: …with its source chip "Calculated" (got ${JSON.stringify(chip && norm(chip.textContent))})`);
  // D1 integration (reviewer C2, 2026-10-07): integrity (DI-516) removed the Auto-Calc button, so Step 2 no longer says "Auto-Calc suggests:".
  const calcLine = body()?.querySelector('#wiz-fin-tb-calculated');
  assert(!!calcLine && norm(calcLine.textContent) === 'Calculated: 51' && !/Auto-Calc/.test(text()),
    `2-4b: …beside the calculated line "Calculated: 51", and Step 2 never names the retired Auto-Calc (got ${JSON.stringify(calcLine && norm(calcLine.textContent))})`);
  // C2b (reviewer, batch 2 notes, 2026-10-07): the chip FOLLOWS what is typed (the 'input' handler, through tiebreakerChipForValue and DI-516's rule):
  // a value other than the calculated total reads "Commissioner-set"; the calculated total typed back reads "Calculated"; an emptied field shows no chip.
  const typeTb = (v) => { const el = body()?.querySelector('#wiz-fin-tb-value'); if (el) { el.value = String(v); el.dispatchEvent({ type: 'input' }); } return !!el; };
  const chipNow = () => { const c = body()?.querySelector('#wiz-fin-tb-chip'); return c ? (c.hidden ? '(hidden)' : norm(c.textContent)) : '(none)'; };
  const typed = [];
  for (const v of ['75', '51', '']) { typeTb(v); typed.push(chipNow()); }
  assert(JSON.stringify(typed) === JSON.stringify(['Commissioner-set', 'Calculated', '(hidden)']) && wk().actualTiebreakerValue == null,
    `C2b 2-4c: as you type, the chip follows the field — 75 ⇒ "Commissioner-set", 51 (the calculated total) back ⇒ "Calculated", emptied ⇒ no chip; typing stores nothing (got ${JSON.stringify(typed)})`);
  // players guessed: a blank value cannot be confirmed
  setVal('#wiz-fin-tb-value', '');
  click('#wiz-fin-next');
  assert(onStep('Confirm Tiebreaker'), 'FB-027 2-5: with two guesses on file, a BLANK tiebreaker does not get past Step 2');
  assert(norm(body()?.querySelector('#wiz-fin-tb-refusal')?.textContent) === "Enter the final value to finalize. The tiebreaker can't be skipped once players have guessed.",
    `2-6: …with the DI's exact copy (got ${JSON.stringify(norm(body()?.querySelector('#wiz-fin-tb-refusal')?.textContent))})`);
  assert(wk().actualTiebreakerValue == null && wk().tiebreakerFinalized !== true, '2-7: …and nothing was stored');
  closeSheet();
}
{
  // no guesses: the "blank is legal" path remains
  seed({ pending: true, tbGuesses: false });
  openWizard(); click('#wiz-open-finalize-btn'); click('#wiz-fin-next');
  setVal('#wiz-fin-tb-value', '');
  click('#wiz-fin-next');
  assert(onStep('Longest field goal (Extra Point)'), '2-8: a week where nobody guessed may still confirm a blank tiebreaker (the existing path stays)');
  closeSheet();
  // no question: blank is legal too
  seed({ pending: true, question: '' });
  openWizard(); click('#wiz-open-finalize-btn'); click('#wiz-fin-next');
  setVal('#wiz-fin-tb-value', '');
  click('#wiz-fin-next');
  assert(onStep('Longest field goal (Extra Point)'), '2-9: …and so may a week with no tiebreaker question');
  closeSheet();
}
{
  // Step 3: the copy, the detection prefill
  seed({ pending: true, detect: { yards: 53, text: '53 Yd Field Goal', matchup: 'Oklahoma @ Texas' } });
  openWizard(); click('#wiz-open-finalize-btn'); click('#wiz-fin-next'); click('#wiz-fin-next');
  assert(onStep('Longest field goal (Extra Point)'), '2-10: Step 3 is titled "Longest field goal (Extra Point)"');
  const label = body()?.querySelector('label[for="wiz-fin-ep-value"]');
  assert(!!label && norm(label.textContent) === 'Actual longest field goal (yards)', `2-11: …its field reads "Actual longest field goal (yards)" (got ${JSON.stringify(label && norm(label.textContent))})`);
  assert(body()?.querySelector('#wiz-fin-ep-value')?.value === '53', '2-12: …prefilled from detection (extraPointDetect.yards) when no actual is on file');
  setVal('#wiz-fin-ep-value', '');
  click('#wiz-fin-next');
  assert(onStep('Longest field goal (Extra Point)') && /Enter the actual longest/.test(text()), '2-13: the finite-number check stays: a blank does not get past Step 3');
  closeSheet();
}
{
  // Step 3 is HIDDEN when the contest is off: Step 2 → Step 4, Back from 4 → 2, and the tracker counts three steps
  seed({ pending: true, epEnabled: false });
  openWizard(); click('#wiz-open-finalize-btn'); click('#wiz-fin-next');
  assert(/Step 2 of 3/.test(tracker()), `2-14: with the Extra Point off the tracker counts three steps (got "${tracker()}")`);
  click('#wiz-fin-next');
  assert(onStep('Finalize') && !onStep('Longest field goal (Extra Point)') && /Step 3 of 3/.test(tracker()), `FB-027 2-15: Confirm on Step 2 goes straight to the review (got "${tracker()}" / ${text().slice(0, 80)})`);
  const epRow = body()?.querySelector('[data-review="extra-point"] .wiz-fin-review-text');
  assert(!!epRow && norm(epRow.textContent) === 'Longest field goal · Not used this week', `2-16: the review says "Longest field goal · Not used this week" (got ${JSON.stringify(epRow && norm(epRow.textContent))})`);
  click('#wiz-fin-back');
  assert(onStep('Confirm Tiebreaker'), '2-17: Back from the review returns to Step 2, never to the hidden step');
  closeSheet();
}
{
  // Step 4 — the review card, one row per required value
  seed({ pending: true });
  openWizard();
  walkToStep4({ tb: 75, ep: 50 });
  assert(onStep('Finalize'), '2-18: (fixture) the walk reached Step 4');
  const row = (k) => norm(body()?.querySelector(`[data-review="${k}"] .wiz-fin-review-text`)?.textContent);
  assert(row('scores') === 'Scores · 2 of 2 final', `2-19: Scores · 2 of 2 final (got ${JSON.stringify(row('scores'))})`);
  assert(row('tiebreaker') === `Tiebreaker · ${TB_Q} · 75 · Commissioner-set`, `2-20: Tiebreaker · {question} · {value} · {chip} — a typed override reads "Commissioner-set" (got ${JSON.stringify(row('tiebreaker'))})`);
  assert(row('extra-point') === 'Longest field goal · 50 yd · closest without going over: Drew', `2-21: Longest field goal · {yards} · closest without going over: {name} (got ${JSON.stringify(row('extra-point'))})`);
  assert(row('players') === 'Players counted · 2 of 2', `2-22: Players counted · {k} of {n} (got ${JSON.stringify(row('players'))})`);
  const btn = body()?.querySelector('#wiz-fin-confirm');
  assert(!!btn && norm(btn.textContent) === 'Finalize Week' && !btn.disabled, '2-23: nothing missing ⇒ "Finalize Week" is enabled');
  // another device clears the tiebreaker while the review is open: Missing, never 0, and it blocks
  storage.saveWeek({ ...wk(), actualTiebreakerValue: null, tiebreakerFinalized: false });
  click('#wiz-fin-back'); click('#wiz-fin-next');                // repaint the review from the mirror
  assert(row('tiebreaker') === `Tiebreaker · ${TB_Q} · Missing`, `2-24: a missing required value shows "Missing", not 0 (got ${JSON.stringify(row('tiebreaker'))})`);
  assert(body()?.querySelector('#wiz-fin-confirm')?.disabled === true, '2-25: …and Finalize Week is disabled');
  click('#wiz-fin-confirm');
  assert(wk().status === 'live', 'FB-027 2-26: …and a press anyway finalizes nothing (a missing value never finalizes as zero)');
  closeSheet();
}
{
  // the calculated value, accepted as is, reads "Calculated" on the review
  seed({ pending: true });
  openWizard();
  walkToStep4({ ep: 50 });
  assert(norm(body()?.querySelector('[data-review="tiebreaker"] .wiz-fin-review-text')?.textContent) === `Tiebreaker · ${TB_Q} · 51 · Calculated`, '2-27: the calculated value, accepted, reads "Calculated" on the review');
  closeSheet();
}
{
  // SUCCESS — the complete weekly result, persisted, from the wizard
  seed({ pending: true });
  openWizard();
  walkToStep4({ tb: 75, ep: 50 });
  reloads = 0;
  const haptics = await successHapticsDuring(async () => { click('#wiz-fin-confirm'); await tick(); });
  const w = wk();
  assert(haptics === 1 && reloads === 0,
    `PF-416 follow-up 2-27b: the success haptic fires ONCE on a finalize the server saved (got ${haptics}), and nothing reloads (${reloads})`);
  assert(w.status === 'final' && w.actualTiebreakerValue === 75 && w.extraPointActual === 50,
    `FB-027 2-28: finalizing from the wizard stores the week FINAL with the tiebreaker (75) and the longest field goal (50) (got ${JSON.stringify({ s: w.status, tb: w.actualTiebreakerValue, ep: w.extraPointActual })})`);
  const res = storage.getWeeklyResults(WK);
  assert(res.length === 2 && res.every((r) => r.tiebreakerDelta === 5) && res.filter((r) => r.isWinner).length === 1,
    `2-29: …and the weekly results are computed WITH the tiebreaker (both 5 off; never a null delta) (got ${JSON.stringify(res.map((r) => [r.playerId, r.tiebreakerDelta, r.isWinner]))})`);
  assert(toasts().includes('Week 6 is final.'), `2-30: the success toast reads "Week 6 is final." (toasts: ${JSON.stringify(toasts())})`);
  assert(document.getElementById('week-wizard-sheet-wrap') === null, '2-31: …and the sheet closes');
}
// B1 (review round 1; DI-519 amended inline by the coordinator, 2026-10-07) — RETRY RE-SENDS, IT NEVER RE-FINALIZES. Reproduced before this fix with the
// reviewer's probe: after a 'pending' first press (the finalize queued, this device already showing the week final), Retry re-ran confirmFinalizeWeek()
// and finalizeWeek() — finalizedAt re-stamped, results re-written — and in a shared league that results write is refused (`results_outside_finalize`),
// raising a red banner with the wrong advice. A pending press is "Not sent yet" (never "Nothing was saved"); only a refusal says to reload.
const serverSeam = typeof app._setFinalizeServerFinalForTest === 'function' ? app._setFinalizeServerFinalForTest : null;
const stampDelay = () => new Promise((r) => setTimeout(r, 5));   // so a re-stamp of finalizedAt could not land on the same millisecond
{
  assert(!!seam && !!serverSeam, '2-32: (fixture) app.js exposes the server seams (_setFinalizeConfirmForTest, _setFinalizeServerFinalForTest)');
  if (seam && serverSeam) {
    seed({ pending: true });
    openWizard();
    walkToStep4({ tb: 75, ep: 50 });
    let calls = 0; let release = null;
    seam(() => { calls++; return new Promise((r) => { release = r; }); });
    const btn = body()?.querySelector('#wiz-fin-confirm');
    btn?.click(); btn?.click();                                   // a double tap
    assert(calls === 1 && body()?.querySelector('#wiz-fin-confirm')?.disabled === true, `2-33: the button disables on press and a double tap posts ONCE (confirm calls ${calls})`);
    assert(norm(body()?.querySelector('#wiz-fin-confirm')?.textContent) === 'Finalizing…' && body()?.querySelector('#wiz-fin-confirm')?.getAttribute('aria-busy') === 'true',
      '2-33b (N5): …and reads "Finalizing…" (aria-busy) while the server\'s answer is awaited');
    if (release) release('pending'); await tick();
    const stamp = wk().finalizedAt, results = JSON.stringify(storage.getWeeklyResults(WK));
    assert(onStep('Finalize') && !!document.getElementById('week-wizard-sheet-wrap') && wk().status === 'final' && !!stamp,
      '2-34: pending ⇒ the sheet stays on Step 4; this device already shows the week final (the finalize is queued, not lost)');
    const row = body()?.querySelector('#wiz-fin-pending');   // review follow-up 3 (2026-10-08): the pending row has its own id
    assert(row?.hidden === false && norm(row?.querySelector('span')?.textContent) === "Not sent yet. It will finish when you're back online.",
      `B1 2-35: …"Not sent yet. It will finish when you're back online." (got ${JSON.stringify(norm(row?.textContent))})`);
    assert(norm(body()?.querySelector('#wiz-fin-retry')?.textContent) === 'Retry' && !body()?.querySelector('#wiz-fin-reload'), '2-36: …with Retry (and no Reload)');
    // PF-416 follow-up, review N6 (coordinator, 2026-10-08) — "Not sent yet" is not a failure: the muted amber weight (the network-hold family, DI-180c)
    // and a polite status, never the refusal's red alert; and ONE control, Retry (Finalize Week would be the same re-ask under a second name).
    assert(row?.classList.contains('wiz-fin-pending') && !row?.classList.contains('wiz-fin-failure') && row?.getAttribute('role') === 'status' && !body()?.querySelector('#wiz-fin-failure'),
      `PF-416 N6 2-36b: the pending row is #wiz-fin-pending / .wiz-fin-pending (amber) with role="status" — no #wiz-fin-failure on the sheet, not the red alert (class ${JSON.stringify(row?.className)}, role ${row?.getAttribute('role')})`);
    assert(!body()?.querySelector('#wiz-fin-confirm') && body()?.querySelectorAll('button').length === 1 && !/Nothing was saved/.test(text()) && !toasts().includes('Week 6 is final.'),
      'PF-416 N6 2-37: …Retry is the ONE control (Finalize Week is not shown), success is NOT claimed, and "Nothing was saved" appears nowhere (it is not true of a queued write)');
    // PF-416 follow-up, item 3 — the values are committed: the finalize is queued with THIS tiebreaker and THIS longest field goal. Back would walk
    // Steps 1-3 again and let the commissioner type values the queued finalize never carries.
    assert(!body()?.querySelector('#wiz-fin-back'), 'PF-416 2-37b: a queued finalize offers no Back — Steps 1-3 cannot be walked again with different values');
    await stampDelay();
    let asked = 0, releaseRetry = null;
    seam(() => { asked++; return new Promise((r) => { releaseRetry = r; }); });
    const retryBtn = body()?.querySelector('#wiz-fin-retry');
    retryBtn?.click(); retryBtn?.click();                         // a double tap on the one control
    assert(asked === 1 && retryBtn?.disabled === true && norm(retryBtn?.textContent) === 'Finalizing…' && retryBtn?.getAttribute('aria-busy') === 'true',
      `PF-416 N6 2-37c: pressed, Retry disables, reads "Finalizing…" (aria-busy) while the answer is awaited, and a double tap asks once (asked ${asked})`);
    if (releaseRetry) releaseRetry('pending'); await tick();
    assert(asked === 1 && wk().finalizedAt === stamp && JSON.stringify(storage.getWeeklyResults(WK)) === results,
      `B1 2-38: Retry RE-ASKS the server only — finalizedAt is NOT re-stamped and the results are NOT recomputed (no second confirmFinalizeWeek / finalizeWeek) (asked ${asked})`);
    assert(onStep('Finalize') && row && body()?.querySelector('#wiz-fin-pending')?.hidden === false && norm(body()?.querySelector('#wiz-fin-retry')?.textContent) === 'Retry',
      '2-39: still pending ⇒ the row stays, Retry still offered (and reads Retry again)');
    await stampDelay();
    seam(async () => 'saved');
    click('#wiz-fin-retry'); await tick();                        // the one control, pressed again
    assert(toasts().includes('Week 6 is final.') && document.getElementById('week-wizard-sheet-wrap') === null && wk().finalizedAt === stamp,
      'B1 2-40: the server acknowledges on the next ask ⇒ success toast, the sheet closes, and the week keeps its FIRST finalizedAt');
    seam(null);
  }
}
{
  // (a) the SERVER already holds the week final: success, nothing re-sent, nothing re-asked, no second finalize
  if (seam && serverSeam) {
    seed({ pending: true });
    openWizard();
    walkToStep4({ tb: 75, ep: 50 });
    seam(async () => 'pending');
    click('#wiz-fin-confirm'); await tick();
    const stamp = wk().finalizedAt, results = JSON.stringify(storage.getWeeklyResults(WK));
    await stampDelay();
    let asked = 0; seam(async () => { asked++; return 'pending'; });
    serverSeam(() => true);                                       // the adapter's own retry landed finalize_week meanwhile
    click('#wiz-fin-retry'); await tick();
    assert(asked === 0 && toasts().includes('Week 6 is final.') && wk().finalizedAt === stamp && JSON.stringify(storage.getWeeklyResults(WK)) === results,
      `B1 2-41: Retry when the server already holds the week final ⇒ success, with NO re-ask and NO second finalize (asked ${asked})`);
    serverSeam(null); seam(null);
    // a first press on a week another device already finalized: success, and this device writes nothing
    seed({ pending: true });
    openWizard();
    walkToStep4({ tb: 75, ep: 50 });
    serverSeam(() => true);
    seam(async () => { throw new Error('must not be asked'); });
    click('#wiz-fin-confirm'); await tick();
    assert(toasts().includes('Week 6 is final.') && wk().status === 'live' && wk().finalizedAt == null && storage.getWeeklyResults(WK).length === 0,
      'B1 2-42: a press when the server ALREADY holds the week final (another device finalized it) ⇒ success, and nothing is finalized a second time from here');
    serverSeam(null); seam(null);
  }
}
{
  // REFUSED — TRUTHFUL AND TERMINAL (PF-416 / FB-026 follow-up, item 2; supersedes B1's 2-45 / 2-46). Reproduced before this fix against the real
  // adapter (bugfixer scratch, 2026-10-07): a refused week write stays queued across a re-sync, by the adapter's design, so the row's "Reload" (a
  // re-sync) re-enabled Finalize Week, whose press re-asked, re-sent the SAME refused finalize_week and was refused again: Reload, Finalize, re-ask,
  // refused, as often as the commissioner tried (finalize_week calls 1, 2, 3, 4). The row now says what is true (the week is still live for everyone),
  // offers nothing that sends the refused finalize again, and its one action reloads the app: the only step that clears a refused write from this
  // device (the write queue lives in memory, and the device snapshot is never written while anything is queued). [5] proves it on the real adapter.
  if (seam && serverSeam) {
    seed({ pending: true });
    openWizard();
    walkToStep4({ tb: 75, ep: 50 });
    seam(async () => 'refused');
    click('#wiz-fin-confirm'); await tick();
    const row = body()?.querySelector('#wiz-fin-failure');
    assert(row?.hidden === false && norm(row?.querySelector('span')?.textContent) === "Couldn't finalize. The server didn't accept it, so the week is still live for everyone."
      && norm(body()?.querySelector('#wiz-fin-reload')?.textContent) === 'Reload app' && !body()?.querySelector('#wiz-fin-retry'),
      `PF-416 2-43: refused ⇒ "Couldn't finalize. The server didn't accept it, so the week is still live for everyone." with Reload app, and no Retry (got ${JSON.stringify(norm(row?.textContent))})`);
    assert(body()?.querySelector('#wiz-fin-confirm')?.disabled === true && !toasts().includes('Week 6 is final.') && !body()?.querySelector('#wiz-fin-back') && !/try again/i.test(text()),
      'PF-416 2-44: …Finalize Week stays disabled, success is not claimed, there is no Back, and nothing on the sheet says to try again');
    assert(row?.classList.contains('wiz-fin-failure') && !row?.classList.contains('wiz-fin-pending') && row?.getAttribute('role') === 'alert',
      `PF-416 N6 2-44b: red stays for the refusal — .wiz-fin-failure with role="alert" (class ${JSON.stringify(row?.className)})`);
    let asked = 0; seam(async () => { asked++; return 'saved'; });
    reloads = 0;
    click('#wiz-fin-confirm'); await tick();                      // a disabled button: minidom still fires its handler, so the handler itself must refuse
    assert(asked === 0 && body()?.querySelector('#wiz-fin-failure')?.hidden === false && !toasts().includes('Week 6 is final.'),
      `PF-416 2-45: a press of Finalize Week after a refusal asks the server NOTHING — the refused finalize is never sent again from the sheet (asked ${asked})`);
    click('#wiz-fin-reload'); await tick();
    assert(reloads === 1 && asked === 0 && body()?.querySelector('#wiz-fin-failure')?.hidden === false && body()?.querySelector('#wiz-fin-confirm')?.disabled === true,
      `PF-416 2-46: "Reload app" reloads the app (${reloads}) — it is not a re-sync that re-enables Finalize Week, and the server is not asked again (asked ${asked})`);
    seam(null);
    closeSheet();
  }
}
{
  // PF-416 follow-up, review N2 (coordinator, 2026-10-08) — A WEEK THE SERVER HOLDS FINAL IS NEVER "STILL LIVE FOR EVERYONE". Another device finalized
  // first: this device's own write is refused, yet the week IS final, so the sheet says "Week N is final." — at the answer, and at Reload app if the
  // server reached final while the refused row was up (the sheet does not repaint on Realtime). [5f] is the same on the real adapter.
  if (seam && serverSeam) {
    seed({ pending: true });
    openWizard();
    walkToStep4({ tb: 75, ep: 50 });
    seam(async () => { serverSeam(() => true); return 'refused'; });   // the other device's finalize lands while this one's is answered "refused"
    reloads = 0;
    const h46b = await successHapticsDuring(async () => { click('#wiz-fin-confirm'); await tick(); });
    assert(toasts().includes('Week 6 is final.') && document.getElementById('week-wizard-sheet-wrap') === null,
      `PF-416 N2 2-46b: refused, but the server holds the week final ⇒ success: "Week 6 is final." and the sheet closes — never the refused row (toasts ${JSON.stringify(toasts())})`);
    assert(h46b === 1 && reloads === 0,
      `PF-416 follow-up 2-46b2: …the success haptic fires ONCE (got ${h46b}); local mode holds no adapter refusal, so nothing reloads (${reloads})`);
    serverSeam(null); seam(null);
    seed({ pending: true });
    openWizard();
    walkToStep4({ tb: 75, ep: 50 });
    seam(async () => 'refused');
    click('#wiz-fin-confirm'); await tick();
    const refusedUp = norm(body()?.querySelector('#wiz-fin-failure:not([hidden]) span')?.textContent);
    serverSeam(() => true);                                       // …then another device finalizes while the refused row is on screen
    reloads = 0;
    const h46c = await successHapticsDuring(async () => { click('#wiz-fin-reload'); await tick(); });
    assert(/^Couldn't finalize\./.test(refusedUp) && reloads === 0 && toasts().includes('Week 6 is final.') && document.getElementById('week-wizard-sheet-wrap') === null,
      `PF-416 N2 2-46c: Reload app on a refused row whose week the server now holds final ⇒ success ("Week 6 is final.", the sheet closes) and no reload (${reloads})`);
    assert(h46c === 1, `PF-416 follow-up 2-46c2: …and the success haptic fires ONCE on that path too (got ${h46c})`);
    serverSeam(null); seam(null);
    // …and when the ask itself fails (it throws) after the server reached final: the press still reports the truth, success.
    seed({ pending: true });
    openWizard();
    walkToStep4({ tb: 75, ep: 50 });
    seam(async () => { serverSeam(() => true); throw new Error('the answer was lost'); });
    const h46d = await successHapticsDuring(async () => { click('#wiz-fin-confirm'); await tick(); });
    assert(toasts().includes('Week 6 is final.') && document.getElementById('week-wizard-sheet-wrap') === null && h46d === 1,
      `PF-416 N2 2-46d: an ask that fails outright while the server holds the week final ⇒ success, never "Not sent yet" or the refused row; the success haptic once (${h46d})`);
    serverSeam(null); seam(null);
  }
}
{
  // N5 — the review card's marks are the Munera glyphs, never ✓ / ○ text
  seed({ pending: true });
  openWizard();
  walkToStep4({ tb: 75, ep: 50 });
  const marks = [...(body()?.querySelectorAll('#wiz-fin-review .wiz-fin-review-mark') || [])];
  assert(marks.length === 4 && marks.every((m) => !!m.querySelector('svg')) && !/[✓○]/.test(body()?.querySelector('#wiz-fin-review')?.textContent || ''),
    'N5 2-47: every review row\'s mark is an icon() glyph (svg), and the review carries no ✓ / ○ text');
  closeSheet();
}
{
  // R3 — Detect on Step 3: the same detection and store as the Comm card's ep-detect-btn, without leaving the wizard
  const realFetch = globalThis.fetch;
  let yards = 53;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ scoringPlays: [{ type: { text: 'Field Goal Good' }, text: `Kicker ${yards} Yd Field Goal`, team: { displayName: 'Texas' } }] }) });
  try {
    seed({ pending: true });
    storage.saveGame({ ...storage.getGames(WK).find((g) => g.gameId === 'g1'), espnEventId: '401000001' });
    openWizard(); click('#wiz-open-finalize-btn'); click('#wiz-fin-next'); click('#wiz-fin-next');
    assert(onStep('Longest field goal (Extra Point)') && body()?.querySelector('#wiz-fin-ep-value')?.value === '' && norm(body()?.querySelector('#wiz-fin-ep-detect')?.textContent) === 'Detect',
      'R3 2-48: Step 3 offers Detect beside an empty field (nothing on file, nothing detected yet)');
    click('#wiz-fin-ep-detect'); await tick();
    const d = wk().extraPointDetect;
    assert(d && d.yards === 53 && d.text === 'Kicker 53 Yd Field Goal' && d.matchup === 'Oklahoma @ Texas' && d.gameId === 'g1',
      `R3 2-49: Detect stores extraPointDetect exactly as ep-detect-btn does (got ${JSON.stringify(d)})`);
    assert(body()?.querySelector('#wiz-fin-ep-value')?.value === '53' && norm(body()?.querySelector('#wiz-fin-ep-detect-status')?.textContent).startsWith('53 yd — Kicker 53 Yd Field Goal (Oklahoma @ Texas)'),
      'R3 2-50: …prefills the field with the yards and says what it found');
    setVal('#wiz-fin-ep-value', '48'); yards = 55;
    click('#wiz-fin-ep-detect'); await tick();
    assert(wk().extraPointDetect?.yards === 55 && body()?.querySelector('#wiz-fin-ep-value')?.value === '48', 'R3 2-51: a second Detect stores the new result but never overwrites a value the commissioner typed');
    globalThis.fetch = async () => { throw new Error('offline'); };
    click('#wiz-fin-ep-detect'); await tick();
    assert(/^No made field goals found yet\./.test(norm(body()?.querySelector('#wiz-fin-ep-detect-status')?.textContent)) && wk().extraPointDetect?.yards === 55,
      'R3 2-52: a detection that finds nothing says so calmly and keeps the last result');
    closeSheet();
  } finally { globalThis.fetch = realFetch; }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// DI-518 AMENDMENT (coordinator, inline, 2026-10-07: "PF-417 means finalize from the Week Wizard, and a hidden entry fails it"). With next week's
// draft already on file, openWeekWizardSheet() routes straight to that draft, so the live week's Manage screen — the one home of its Finalize — was
// unreachable from the wizard (reproduced before this amendment: the sheet opened on "Set up Week" with no Finalize anywhere).
_log('\n[3] DI-518 amendment — a next-week draft never hides the live week\'s Finalize…');
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const DRAFT = 'wk_next';
const addDraft = (over = {}) => storage.saveWeek({ ...dm.createWeek('2026', 7, '2026-10-10', '2026-10-11'), weekId: DRAFT, blurb: '', ...over });
const title = () => document.getElementById('week-wizard-title')?.textContent || '';
{
  seed({});
  addDraft();
  openWizard();
  assert(title() === 'Set up Week' && !body()?.querySelector('#wiz-open-finalize-btn'), '3-0: (fixture) with a Week 7 draft on file the wizard opens on the DRAFT; the live week\'s Manage screen is not on screen');
  const row = body()?.querySelector('#wiz-live-week-row');
  assert(norm(row?.querySelector('.wiz-live-week-text')?.textContent) === 'Week 6 is live', `3-1: the draft view says "Week 6 is live" (got ${JSON.stringify(norm(row?.textContent))})`);
  const btn = body()?.querySelector('#wiz-live-finalize-btn');
  assert(!!btn && norm(btn.textContent) === 'Finalize Week 6' && btn.classList.contains('btn-primary'), '3-2: …with a primary "Finalize Week 6"');
  assert(!!row && body()?.firstElementChild === row, '3-3: …at the TOP of the draft view');
  const wrapBefore = document.getElementById('week-wizard-sheet-wrap');
  btn?.click();
  assert(onStep('Approve Scores') && /Step 1 of/.test(tracker()) && /^Finalize Week 6/.test(title()), `3-4: the button opens the guided flow at Step 1 for THAT live week (title "${title()}", tracker "${tracker()}")`);
  assert(!!wrapBefore && document.getElementById('week-wizard-sheet-wrap') === wrapBefore, '3-5: …in the same sheet (switched in place, never remounted: no second slide-in)');
  assert(JSON.stringify(app._finalizeFlowStateForTest()) === JSON.stringify({ step: 1, targetWeekId: WK }), '3-6: …targeting week 6, never the draft');
  click('#wiz-fin-next'); setVal('#wiz-fin-tb-value', 75); click('#wiz-fin-next'); setVal('#wiz-fin-ep-value', 50); click('#wiz-fin-next');
  click('#wiz-fin-confirm');
  await tick();
  assert(wk().status === 'final' && wk().actualTiebreakerValue === 75 && wk().extraPointActual === 50 && toasts().includes('Week 6 is final.'),
    `3-7: …and the finalization COMPLETES from there: week 6 final, with its tiebreaker and longest field goal (got ${JSON.stringify({ s: wk().status, tb: wk().actualTiebreakerValue, ep: wk().extraPointActual })})`);
  assert(storage.getWeek(DRAFT)?.status === 'draft', '3-8: …and the Week 7 draft is untouched');
  openWizard();
  assert(title() === 'Set up Week' && !body()?.querySelector('#wiz-live-week-row'), '3-9: once week 6 is final the draft view carries no live-week row');
  closeSheet();
}
{
  // Review N5 — Cancel from the flow opened by the draft's live row returns to THAT draft, at its step, with its unsaved Step 6 choice intact
  seed({});
  addDraft();
  storage.saveGame({ ...dm.createGame(DRAFT, { homeTeam: 'Ohio State', awayTeam: 'Penn State', spread: -3 }), gameId: 'gd2' });
  openWizard();
  click('[data-open-mode="draft"]');
  assert(/Step 6 of/.test(tracker()) && !!body()?.querySelector('[data-open-mode="draft"].selected'), `3-15: (fixture) the draft opens on Step 6 and "Keep as draft" is chosen, unsaved (tracker "${tracker()}")`);
  click('#wiz-live-finalize-btn');
  assert(onStep('Approve Scores'), '3-16: (fixture) the live row opened the flow at Step 1');
  click('#wiz-fin-cancel');
  assert(!!document.getElementById('week-wizard-sheet-wrap') && title() === 'Set up Week' && /Step 6 of/.test(tracker()) && storage.getWeek(WK).status === 'live',
    `N5 3-17: Cancel RETURNS to the draft at the step it was on — the sheet stays open, nothing was finalized (title "${title()}", tracker "${tracker()}")`);
  assert(!!body()?.querySelector('[data-open-mode="draft"].selected'), 'N5 3-18: …with its unsaved Step 6 choice intact (openFinalizeWeekFlow() leaves it alone)');
  click('#wiz-live-finalize-btn');
  closeSheet();
  openWizard();
  click('#wiz-live-finalize-btn'); click('#wiz-fin-cancel');
  assert(title() === 'Set up Week', '3-19: a fresh sheet session: the return still lands on the draft');
  closeSheet();
  // the Manage entry (not the draft row) keeps Cancel = close
  seed({});
  openWizard(); click('#wiz-open-finalize-btn'); click('#wiz-fin-cancel');
  assert(document.getElementById('week-wizard-sheet-wrap') === null, '3-20: opened from the Manage screen, Cancel still closes the sheet (nothing to return to)');
}
{
  // every step of the draft view carries it — a draft with a game and no spread opens on Step 3, a different render branch
  seed({});
  addDraft();
  storage.saveGame({ ...dm.createGame(DRAFT, { homeTeam: 'Ohio State', awayTeam: 'Penn State' }), gameId: 'gd1', spread: null });
  openWizard();
  assert(/Step 3 of/.test(tracker()) && norm(body()?.querySelector('#wiz-live-finalize-btn')?.textContent) === 'Finalize Week 6', `3-10: on Step 3 of the draft too (tracker "${tracker()}")`);
  closeSheet();
  // no live week ⇒ no row: the single-sport league otherwise stays as it was
  seed({ status: 'locked' });
  addDraft();
  openWizard();
  assert(title() === 'Set up Week' && !body()?.querySelector('#wiz-live-week-row'), '3-11: a LOCKED (not live) week behind the draft ⇒ no row');
  closeSheet();
  // the Manage screen itself never carries it (it has its own Finalize)
  seed({});
  openWizard();
  assert(/^Manage/.test(title()) && !body()?.querySelector('#wiz-live-week-row') && !!body()?.querySelector('#wiz-open-finalize-btn'), '3-12: no draft ⇒ the Manage screen, with its own Finalize and no live-week row');
  closeSheet();
}
{
  // multi-sport: the row is per sport, and names it
  const comps = [
    { id: 'c_cfb', sport: 'cfb', isDefault: true, createdAt: '2026-08-01T00:00:00Z' },
    { id: 'c_nfl', sport: 'nfl', isDefault: false, createdAt: '2026-09-01T00:00:00Z' },
  ];
  seed({ competitionId: 'c_nfl', competitions: comps });
  addDraft({ competitionId: 'c_nfl' });
  openWizard();
  assert(norm(body()?.querySelector('#wiz-live-finalize-btn')?.textContent) === 'Finalize NFL Week 6', `3-13: an NFL draft behind a live NFL week ⇒ "Finalize NFL Week 6" (got ${JSON.stringify(norm(body()?.querySelector('#wiz-live-finalize-btn')?.textContent))})`);
  closeSheet();
  seed({ competitionId: 'c_nfl', competitions: comps });
  addDraft();                                                       // a CFB draft (no competitionId = the default competition)
  sportSeam.setLensSport('cfb');                                      // the commissioner is looking at the college sport, whose current week is the draft
  openWizard();
  assert(title() === 'Set up Week' && !body()?.querySelector('#wiz-live-week-row'), '3-14: a CFB draft while only an NFL week is live ⇒ no row (another sport\'s week is not hiding behind it)');
  closeSheet();
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// D1 INTEGRATION, reviewer C1 (2026-10-07) — feat/d1-integrity (FB-002 / DI-516, the live tiebreaker) and fix/d1-w-wizard (FB-027 / DI-518, DI-519,
// the guided Finalize flow) ship together. Each was proven alone; this proves the pair: EVERY Finalize entry (the Manage screen's Finalize Week, the
// status-row "Finalize", Comm → Week's `.week-status-btn[data-to="final"]`, the draft view's "Week N is live" row) goes through the guided flow, and
// Step 2, accepted as prefilled, STORES the complete calculated tiebreaker value DI-516 computes, which the results then use. An alma week (Texas 31 +
// Iowa 20 = 51) and an NFL week whose tiebreaker is the designated game (Purdue 17 + Iowa 20 = 37, D-31).
_log('\n[C1] D1 integration — every Finalize entry stores the complete calculated tiebreaker through Step 2 (alma week; NFL designated game)…');
// ═════════════════════════════════════════════════════════════════════════════════════════════════
{
  const comps = [
    { id: 'c_cfb', sport: 'cfb', isDefault: true, createdAt: '2026-08-01T00:00:00Z' },
    { id: 'c_nfl', sport: 'nfl', isDefault: false, createdAt: '2026-09-01T00:00:00Z' },
  ];
  const KINDS = {
    alma: { expect: 51, seed: () => seed({}), draft: () => addDraft() },
    nfl: {
      expect: 37,
      seed: () => { seed({ competitionId: 'c_nfl', competitions: comps }); storage.saveWeek({ ...wk(), tiebreakerType: 'custom', tiebreakerGameId: 'g2' }); },
      draft: () => addDraft({ competitionId: 'c_nfl' }),
    },
  };
  const ENTRIES = {
    'Manage Finalize Week': () => { openWizard(); return click('#wiz-open-finalize-btn'); },
    'status-row Finalize': () => { openWizard(); return click('.week-wizard-status-btn[data-to="final"]'); },
    'Comm → Week Finalize': () => {
      const host = document.createElement('div');
      host.innerHTML = '<button class="btn btn-primary btn-sm week-status-btn" data-to="final">Finalize</button>';
      document.body.appendChild(host);
      const w = wk();
      app.bindCommEventListeners(w, storage.getGames(WK), [], [], storage.getSettings(), [w], []);
      const b = host.querySelector('.week-status-btn'); if (b) b.click(); return !!b;
    },
    'draft live-week row': (kind) => { KINDS[kind].draft(); openWizard(); return click('#wiz-live-finalize-btn'); },
  };
  for (const kind of Object.keys(KINDS)) {
    const N = KINDS[kind].expect;
    for (const [name, enter] of Object.entries(ENTRIES)) {
      const tag = `C1 (${kind}, ${name})`;
      KINDS[kind].seed();
      confirmCalls = 0;
      const pre = app.effectiveTiebreakerActualForWeek(wk());
      const entered = enter(kind);
      assert(entered && onStep('Approve Scores') && JSON.stringify(app._finalizeFlowStateForTest()) === JSON.stringify({ step: 1, targetWeekId: WK })
        && wk().status === 'live' && wk().actualTiebreakerValue == null && confirmCalls === 0
        && pre.source === 'calculated' && pre.value === N && pre.calculated?.complete === true && pre.provisional === false,
        `${tag} a: the entry opens the guided flow at Step 1 for the live week, writes nothing, asks no confirm(); DI-516's live total is ${N} and complete (pre ${JSON.stringify({ src: pre.source, v: pre.value, c: pre.calculated?.complete })})`);
      click('#wiz-fin-next');                                       // Step 1 → 2
      const field = body()?.querySelector('#wiz-fin-tb-value');
      assert(onStep('Confirm Tiebreaker') && field?.value === String(N) && norm(body()?.querySelector('#wiz-fin-tb-chip')?.textContent) === 'Calculated'
        && norm(body()?.querySelector('#wiz-fin-tb-calculated')?.textContent) === `Calculated: ${N}`,
        `${tag} b: Step 2 is prefilled with the complete calculated ${N}, chip "Calculated" (field ${JSON.stringify(field && field.value)})`);
      click('#wiz-fin-next');                                       // Step 2 confirmed AS PREFILLED → 3
      const eff = app.effectiveTiebreakerActualForWeek(wk());
      assert(wk().actualTiebreakerValue === N && wk().tiebreakerFinalized === true && wk().status === 'live' && onStep('Longest field goal (Extra Point)')
        && eff.source === 'manual' && eff.matchesCalculated === true && eff.value === N,
        `${tag} c: Step 2 STORED ${N} (tiebreakerFinalized), the week still live, now on Step 3; DI-516 reads it as the calculated value (got ${JSON.stringify({ tb: wk().actualTiebreakerValue, fin: wk().tiebreakerFinalized, s: wk().status, src: eff.source, m: eff.matchesCalculated })})`);
      setVal('#wiz-fin-ep-value', 50); click('#wiz-fin-next');      // Step 3 → 4
      click('#wiz-fin-confirm');
      await tick();
      const res = storage.getWeeklyResults(WK);
      const delta = (pid) => res.find((r) => r.playerId === pid)?.tiebreakerDelta;
      assert(wk().status === 'final' && wk().actualTiebreakerValue === N && delta('p1') === Math.abs(70 - N) && delta('p2') === Math.abs(80 - N)
        && document.getElementById('week-wizard-sheet-wrap') === null,
        `${tag} d: finalized FINAL with ${N}, and the results measure every guess against it (p1 ${delta('p1')}, p2 ${delta('p2')})`);
      if (document.getElementById('week-wizard-sheet-wrap')) closeSheet();
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// PF-416 follow-up, item 4 (DI-404) — A FRESH SHEET IS A FRESH SESSION. openWeekWizardSheet() clears the draft's Step 6 choices (open mode, scheduled time)
// and the Auto-Open time carried from Step 4 on every open, so nothing typed in one sheet session leaks into the next. openFinalizeWeekFlow() keeps them
// on purpose when it switches an OPEN sheet in place (review N5: Cancel returns to that draft), and kept them on a fresh MOUNT too, where there is no
// draft to return to. Reproduced before this fix: the choices of a closed (or hold-torn-down) draft session were still set inside the fresh Finalize
// sheet opened from Comm → Week. No path from that sheet reads them today; the session state is the invariant DI-404 states.
_log('\n[3b] DI-404 — a Finalize sheet mounted fresh starts with no Step 6 choices from an earlier sheet…');
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  const sessionOf = () => (typeof app._weekWizardSessionForTest === 'function' ? app._weekWizardSessionForTest() : {});
  const commFinalize = () => {
    const host = document.createElement('div');
    host.innerHTML = '<button class="btn btn-primary btn-sm week-status-btn" data-to="final">Finalize</button>';
    document.body.appendChild(host);
    const w = wk();
    app.bindCommEventListeners(w, storage.getGames(WK), [], [], storage.getSettings(), [w], []);
    host.querySelector('.week-status-btn')?.click();
  };
  // (a) Step 6's open mode and scheduled time, chosen, then the sheet closed
  seed({});
  addDraft({ blurb: 'Week 7 is here.' });
  storage.saveGame({ ...dm.createGame(DRAFT, { homeTeam: 'Texas', awayTeam: 'Rice', spread: -20.5 }), gameId: 'g7' });
  openWizard();
  click('[data-open-mode="scheduled"]');
  const at = body()?.querySelector('#wiz-schedule-at');
  if (at) { at.value = '2026-10-09T18:00'; at.dispatchEvent({ type: 'change' }); }
  const s0 = sessionOf();
  assert(s0.openMode === 'scheduled' && s0.scheduleAt === '2026-10-09T18:00',
    `3b-0: (fixture) the draft's Step 6 holds a scheduled open at 2026-10-09T18:00 (session ${JSON.stringify(s0)})`);
  closeSheet();
  commFinalize();
  const s1 = sessionOf();
  assert(onStep('Approve Scores') && s1.openMode === null && s1.scheduleAt === null && s1.pendingOpenAt === null,
    `DI-404 3b-1: a Finalize sheet mounted fresh from Comm → Week carries no open mode and no scheduled time from the sheet before it (session ${JSON.stringify(s1)})`);
  closeSheet();
  // (b) the Auto-Open time carried from Step 4 ("Write it"), the sheet then torn down without a close (a hold sweeps data-hold-teardown nodes)
  seed({});
  addDraft({ blurb: '' });
  storage.saveGame({ ...dm.createGame(DRAFT, { homeTeam: 'Texas', awayTeam: 'Rice', spread: -20.5 }), gameId: 'g7' });
  openWizard();
  click('#wiz-step6-back'); click('#wiz-step5-back');             // Step 6 → 5 → 4
  const openAt = body()?.querySelector('#wiz-picks-open-at');
  if (openAt) { openAt.value = '2026-10-08T09:00'; openAt.dispatchEvent({ type: 'change' }); }
  click('#wiz-step4-blurb-write');
  const s2 = sessionOf();
  assert(s2.pendingOpenAt === '2026-10-08T09:00' && s2.step === 5, `3b-2: (fixture) "Write it" carries the typed Auto-Open time to Step 5 (session ${JSON.stringify(s2)})`);
  document.getElementById('week-wizard-sheet-wrap')?.remove();
  commFinalize();
  const s3 = sessionOf();
  assert(onStep('Approve Scores') && s3.pendingOpenAt === null && s3.openMode === null && s3.scheduleAt === null,
    `DI-404 3b-3: …and a fresh Finalize sheet after a teardown carries no Auto-Open time from it (session ${JSON.stringify(s3)})`);
  closeSheet();
  // (c) the in-place switch keeps them (review N5): the draft view's "Week N is live" row, then Cancel, returns to Step 6 with the choice intact
  seed({});
  addDraft({ blurb: 'Week 7 is here.' });
  storage.saveGame({ ...dm.createGame(DRAFT, { homeTeam: 'Texas', awayTeam: 'Rice', spread: -20.5 }), gameId: 'g7' });
  openWizard();
  click('[data-open-mode="scheduled"]');
  click('#wiz-live-finalize-btn');
  const s4 = sessionOf();
  click('#wiz-fin-cancel');
  assert(s4.openMode === 'scheduled' && sessionOf().openMode === 'scheduled' && !!body()?.querySelector('[data-open-mode="scheduled"].selected'),
    `3b-4: the in-place switch from the draft view keeps the draft's open choice, and Cancel returns to it (review N5) (session ${JSON.stringify(s4)})`);
  closeSheet();
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Review round 1, B1 — AGAINST THE REAL ADAPTER. The guided flow's one press function (app.js finalizeFromGuidedFlow(), what Finalize Week and Retry
// both call) over js/supabase-backend.js and a fake PostgREST client that fails finalize_week once, then serves it — stateful, as a server is: an update
// returns the row as it now stands, and a finalize_week that succeeded leaves the week final. LAST in this file on purpose: it puts the process in
// Supabase data mode. (It lives here rather than in authtest.mjs: its ~2 s of real waiting moved that suite's shared push-SDK timing under [57i].)
_log('\n[4] B1 against the real adapter — a pending press, the adapter\'s own re-send, then Retry; and a transient failure waited through…');
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  const sb = await import('./js/supabase-backend.js');
  const auth = await import('./js/auth.js');
  const LG = 'L-wf4', SWK = 'wk_sb4', T0 = Date.now();
  const iso = (ms) => new Date(T0 + ms).toISOString();
  const weekRow = () => ({
    extra: {}, league_id: LG, id: SWK, sport: 'cfb', season: '2026', week_number: 6, label: 'Week 6', status: 'live', data_source_mode: 'espn_live',
    start_date: '2026-10-03', end_date: '2026-10-04', picks_open_at: iso(-86400e3), picks_lock_at: iso(-3 * 3600e3), auto_lock_offset_minutes: 30,
    auto_live_enabled: true, auto_finalize_enabled: true, pending_finalization: false, locked_at: iso(-3 * 3600e3), locked_alma_maters: [],
    revealed_at: iso(-3600e3), extra_point_enabled: false, tiebreaker_question: '',
  });
  const gameRow = () => ({ extra: {}, league_id: LG, id: 'g_sb4', week_id: SWK, home_team: 'Home U', away_team: 'Away St', status: 'final', kickoff: iso(-2 * 3600e3),
    spread: -3, favorite: 'Home U', multiplier: 1, home_score: 24, away_score: 10, locked_spread: -3, ats_winner: null });
  const member = (id, role, name, uid) => ({ extra: {}, league_id: LG, id, user_id: uid, role, display_name: name, initials: name.slice(0, 2).toUpperCase(),
    alma_mater: '', active: true, notify_prefs: {}, preferences: {} });
  const pickRow = (mid, team) => ({ extra: {}, league_id: LG, id: `pk_${mid}`, week_id: SWK, game_id: 'g_sb4', member_id: mid, selected_team: team,
    selected_at: iso(-5 * 3600e3), updated_at: iso(-5 * 3600e3), locked: false, result: 'pending' });
  const mkClient = (firstFailure) => {
    const rows = { league_members: [member('m-a', 'commissioner', 'Drew', 'u-a'), member('m-b', 'player', 'Kevin', null)], weeks: [weekRow()], games: [gameRow()],
      picks: [pickRow('m-a', 'Home U'), pickRow('m-b', 'Away St')] };
    const calls = { finalize: 0 };
    let failNext = firstFailure;
    const read = (table) => ({ select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; }, gt() { return this; },
      then(res) { const data = rows[table] || []; return res({ data, error: null, count: data.length }); } });
    const write = (table, op) => (payload) => {
      const ids = [];
      return { select() { return this; }, eq(col, v) { if (col === 'id') ids.push(v); return this; },
        then(res) {
          let data = [];
          if (op === 'update') { rows[table] = (rows[table] || []).map((r) => (ids.includes(r.id) ? { ...r, ...payload } : r)); data = rows[table].filter((r) => ids.includes(r.id)); }
          else if (op !== 'delete') data = Array.isArray(payload) ? payload : [payload];
          return res({ data, error: null });
        } };
    };
    const client = {
      from: (table) => Object.assign(read(table), { update: write(table, 'update'), insert: write(table, 'insert'), upsert: write(table, 'upsert'), delete: write(table, 'delete') }),
      rpc: async (name, args) => {
        if (name === 'finalize_week') {
          calls.finalize += 1;
          if (failNext === 'network') { failNext = null; throw new TypeError('Failed to fetch'); }
          if (failNext === 'transient') { failNext = null; return { data: null, error: { message: 'Service Unavailable', code: '' }, status: 503 }; }
          rows.weeks = rows.weeks.map((w) => (w.id === (args && args.p_week) ? { ...w, status: 'final', finalized_at: new Date().toISOString() } : w));
        }
        return { data: [], error: null };
      },
    };
    return { calls, client };
  };
  const hydrate = async (client) => {
    sb._resetForTest();
    sb.init({
      register: auth.registerSupabaseDataBackend, getClient: () => client, getActiveLeagueId: () => LG,
      getIdentityEpoch: auth.getIdentityEpoch, getAccountUserId: auth.getAccountUserId,
      getDeviceDataOwnerTuple: auth.getDeviceDataOwnerTuple, getDeviceDataOwner: auth.getDeviceDataOwner,
      getLeagueName: () => 'League 4', getLeagueNameById: () => 'League 4', getSession: () => ({ isAdmin: true, playerId: 'm-a' }),
      hasValidSupabaseSession: () => true, isPrivilegeHeld: () => false, hasSheetMirror: () => false, isSiteUnlocked: () => true,
    });
    auth.registerSupabaseDataBackend(sb.probe);
    await sb.hydrate(LG, { epoch: auth.getIdentityEpoch() });
    sb._seedMirrorForTest('cfbp_active_week', SWK);
    sb._seedMirrorForTest('cfbp_settings', { autoRefreshInterval: 60 });
  };
  store.clear();
  globalThis.document = freshDoc();
  auth._setHasSupabaseDataBackendForTest(null);
  auth.configureAuth({ authMode: 'supabase', dataMode: 'supabase', authModeKnown: true, supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' });
  auth._setMembershipsForTest([{ leagueId: LG, memberId: 'm-a', role: 'commissioner', displayName: 'Drew', leagueName: 'League 4' }]);
  auth.setActiveLeagueId(LG);
  auth._setAccountUserIdForTest('u-a');
  auth._setStoredSessionForTest({ access_token: 't', expires_at: Math.floor(Date.now() / 1000) + 3600 });
  storage.setBackendMode('supabase');

  // (1) a network hold: the first press is PENDING, at once
  const net = mkClient('network');
  await hydrate(net.client);
  const w0 = storage.getWeek(SWK);
  assert(sb.getState() === 'ACTIVE' && w0?.status === 'live' && sb.getConfirmedWeekStatus(SWK) === 'live' && storage.getGames(SWK).every((g) => g.status === 'final'),
    `4-1: (fixture) hydrated — the week LIVE on the server and on this device, every game final (state ${sb.getState()}, week ${w0 && w0.status})`);
  const netStart = Date.now();
  const r1 = await app._finalizeFromGuidedFlowForTest(w0);
  const netTook = Date.now() - netStart;
  assert(r1.state === 'pending' && r1.action === 'finalize' && net.calls.finalize === 1 && storage.getWeek(SWK).status === 'final' && sb.getConfirmedWeekStatus(SWK) === 'live' && netTook < 5000,
    `B1 4-2: a network hold on finalize_week ⇒ the first press answers PENDING at once (a hold has no retry schedule to wait through): queued, this device shows the week final, the server does not yet (state ${r1.state}, calls ${net.calls.finalize}, ${netTook} ms)`);
  const stamp = storage.getWeek(SWK).finalizedAt;
  const results = JSON.stringify(storage.getWeeklyResults(SWK));
  // (2) the adapter's own re-send lands it (back on the network: the queued finalize goes out on the next flush)
  await sb.flush();
  assert(net.calls.finalize === 2 && sb.getConfirmedWeekStatus(SWK) === 'final',
    `4-3: (fixture) the adapter's own re-send lands finalize_week — the SERVER now holds the week final (calls ${net.calls.finalize}, confirmed ${sb.getConfirmedWeekStatus(SWK)})`);
  await stampDelay();
  // (3) Retry
  const r2 = await app._finalizeFromGuidedFlowForTest(storage.getWeek(SWK));
  const plan = sb.planFlush();
  const codes = plan.refusals.map((e) => e && e.code);
  assert(r2.ok === true && r2.state === 'saved' && r2.action === 'confirmed' && net.calls.finalize === 2,
    `B1 4-4: Retry after the auto re-send landed is a SUCCESS with NO second finalize_week (action ${r2.action}, finalize_week calls ${net.calls.finalize})`);
  assert(storage.getWeek(SWK).finalizedAt === stamp && JSON.stringify(storage.getWeeklyResults(SWK)) === results
    && !codes.includes('results_outside_finalize') && !plan.refusals.length && !(sb.getStatus().refusedKeys || []).length,
    `B1 4-5: …nothing is re-finalized: finalizedAt and the results untouched, and NO results_outside_finalize refusal (refusals ${JSON.stringify(codes)}, latched ${JSON.stringify(sb.getStatus().refusedKeys)})`);
  // (4) a TRANSIENT failure (503): the press waits through the adapter's own retry schedule and succeeds when the retry lands
  const tr = mkClient('transient');
  await hydrate(tr.client);
  const started = Date.now();
  const r3 = await app._finalizeFromGuidedFlowForTest(storage.getWeek(SWK));
  const took = Date.now() - started;
  assert(r3.ok === true && r3.state === 'saved' && tr.calls.finalize === 2 && sb.getConfirmedWeekStatus(SWK) === 'final' && took < 18000,
    `B1 4-6 (DI-519 amended): a transient 503 is never shown as a failure — the press WAITS through the adapter's retry schedule and succeeds when its retry lands (${took} ms, finalize_week calls ${tr.calls.finalize}, state ${r3.state}; retry ${JSON.stringify(sb._retryStateForTest())}, lastError ${JSON.stringify(sb.getStatus().lastError)})`);
  sb._resetForTest();
  storage.setBackendMode('local');
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// PF-416 / FB-026 follow-up (W-46, thread 100726-D1, 2026-10-07) — "Reliable finalization and cross-device sync": a denied or interrupted save "does not
// claim success" and must not leave the week half-finalized (DI-519: "Fails when … the retry row appears but the week half-finalized"). Reproduced before
// this fix, on this harness (bugfixer scratch): finalizeWeek() queued the week-final post, every game-final post, the results notice, the obligation
// notice and the SCRIBE week signals the moment it computed the results, while finalize_week was still pending — and after the server REFUSED it, all
// five were already out. The server's own chat_append_system guard does not stop the week-final post: it admits sys_weekfinal_<week> for a LIVE week.
//   [5a] pending ⇒ nothing announced; the Manage entry (and every other Finalize entry) goes straight to Step 4's "Not sent yet" + Retry (item 3);
//        the adapter's own re-send lands ⇒ each announcement exactly once; a re-ask, a hydrate and a Realtime event after that add nothing.
//   [5b] confirmation observed by a HYDRATE (the request landed, its answer was lost) ⇒ announced once.
//   [5c] confirmation observed by a REALTIME event ⇒ announced once.
//   [5d] a deterministic refusal ⇒ never announced, through a re-sync too; the sheet's refused state is terminal: Finalize Week sends nothing, re-entry
//        shows the same refusal, and its one action reloads the app (item 2).
//   [5e] the server's status overtook a queued finalize (status_moved) ⇒ dropped unsent, even when the server later reaches final another way.
//   [5f] review N2: this device's finalize_week refused while the server holds the week final (another device finalized first) ⇒ success.
//   [5g] a clean finalize never reloads and says plainly "Week 6 is final." (the reload and "Refreshing…" are the latched-refusal case's).
// The adapter is real, the status handler is the app's own (wired exactly as wireSupabaseAdapter() wires it), and the Realtime handler is the one
// wireSupabaseAdapter() passes as onRealtimeEvent. Announcements are counted where they really go: chat.js's outbox plus the fake server's chat_append.
_log('\n[5] PF-416 — week-final announcements wait for the server; a refused finalize is terminal; a pending one re-enters at Step 4…');
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  const sb = await import('./js/supabase-backend.js');
  const auth = await import('./js/auth.js');
  const chat = await import('./js/chat.js');
  const LG = 'L-wf5', SWK = 'wk_sb5', GID = 'g_sb5', T0 = Date.now();
  const iso = (ms) => new Date(T0 + ms).toISOString();
  const weekRow = () => ({
    extra: {}, league_id: LG, id: SWK, sport: 'cfb', season: '2026', week_number: 6, label: 'Week 6', status: 'live', data_source_mode: 'espn_live',
    start_date: '2026-10-03', end_date: '2026-10-04', picks_open_at: iso(-86400e3), picks_lock_at: iso(-3 * 3600e3), auto_lock_offset_minutes: 30,
    auto_live_enabled: true, auto_finalize_enabled: true, pending_finalization: false, locked_at: iso(-3 * 3600e3), locked_alma_maters: [],
    revealed_at: iso(-3600e3), extra_point_enabled: false, tiebreaker_question: '',
  });
  const member = (id, role, name, uid) => ({ extra: {}, league_id: LG, id, user_id: uid, role, display_name: name, initials: name.slice(0, 2).toUpperCase(),
    alma_mater: '', active: true, notify_prefs: {}, preferences: {} });
  const pickRow = (mid, team) => ({ extra: {}, league_id: LG, id: `pk5_${mid}`, week_id: SWK, game_id: GID, member_id: mid, selected_team: team,
    selected_at: iso(-5 * 3600e3), updated_at: iso(-5 * 3600e3), locked: false, result: 'pending' });
  /** One world: a fresh adapter over a fresh fake server, the app's status handler subscribed, chat and the SCRIBE ledger empty. `failure` is what
   *  finalize_week answers: 'network' once (a hold), 'refuse' every time (a deterministic refusal, P0001 league_paused), or null (it lands). */
  const world = async (failure) => {
    chat._resetForTest();
    app._resetScribeWeekSignalLedgerForTest();
    globalThis.document = freshDoc();
    const rows = { league_members: [member('m-a', 'commissioner', 'Drew', 'u-a'), member('m-b', 'player', 'Kevin', null)], weeks: [weekRow()],
      games: [{ extra: {}, league_id: LG, id: GID, week_id: SWK, home_team: 'Home U', away_team: 'Away St', status: 'final', kickoff: iso(-2 * 3600e3),
        spread: -3, favorite: 'Home U', multiplier: 1, home_score: 24, away_score: 10, locked_spread: -3, ats_winner: null }],
      picks: [pickRow('m-a', 'Home U'), pickRow('m-b', 'Away St')] };
    const calls = { finalize: 0, chat: [] };
    let fail = failure;
    const read = (table) => ({ select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; }, gt() { return this; },
      then(res) { const data = rows[table] || []; return res({ data, error: null, count: data.length }); } });
    const write = (table, op) => (payload) => {
      const ids = [];
      return { select() { return this; }, eq(col, v) { if (col === 'id') ids.push(v); return this; },
        then(res) {
          let data = [];
          if (op === 'update') { rows[table] = (rows[table] || []).map((r) => (ids.includes(r.id) ? { ...r, ...payload } : r)); data = rows[table].filter((r) => ids.includes(r.id)); }
          else if (op !== 'delete') data = Array.isArray(payload) ? payload : [payload];
          return res({ data, error: null });
        } };
    };
    const serverFinal = () => { rows.weeks = rows.weeks.map((w) => (w.id === SWK ? { ...w, status: 'final', finalized_at: new Date().toISOString() } : w)); };
    const client = {
      from: (table) => Object.assign(read(table), { update: write(table, 'update'), insert: write(table, 'insert'), upsert: write(table, 'upsert'), delete: write(table, 'delete') }),
      rpc: async (name, args) => {
        if (/^chat_append/.test(name)) { calls.chat.push(...((args && args.p_events) || []).map((e) => e && e.id)); return { data: [], error: null }; }
        if (name === 'finalize_week') {
          calls.finalize += 1;
          if (fail === 'network') { fail = null; throw new TypeError('Failed to fetch'); }
          if (fail === 'refuse') return { data: null, error: { message: 'league_paused', code: 'P0001' }, status: 400 };
          if (fail === 'elsewhere') {                             // review N2: another device's finalize lands while this request is out (its Realtime
            serverFinal();                                        // event arrives), and the server REFUSES this one outright. (A bad_transition answer
            sb._foldRealtimeRowForTest('weeks', { eventType: 'UPDATE', new: rows.weeks.find((w) => w.id === SWK) });   // is a 'conflict', re-read
            return { data: null, error: { message: 'not_commissioner', code: 'P0001' }, status: 400 };              // and waited through by B1.)
          }
          serverFinal();
        }
        return { data: [], error: null };
      },
    };
    sb._resetForTest();
    sb.init({
      register: auth.registerSupabaseDataBackend, getClient: () => client, getActiveLeagueId: () => LG,
      getIdentityEpoch: auth.getIdentityEpoch, getAccountUserId: auth.getAccountUserId,
      getDeviceDataOwnerTuple: auth.getDeviceDataOwnerTuple, getDeviceDataOwner: auth.getDeviceDataOwner,
      getLeagueName: () => 'League 5', getLeagueNameById: () => 'League 5', getSession: () => ({ isAdmin: true, playerId: 'm-a' }),
      hasValidSupabaseSession: () => true, isPrivilegeHeld: () => false, hasSheetMirror: () => false, isSiteUnlocked: () => true,
    });
    auth.registerSupabaseDataBackend(sb.probe);
    const detach = sb.onStatus(app._onSupabaseDataStatusForTest);       // wireSupabaseAdapter() subscribes this same function
    const hydrate = async () => {
      await sb.hydrate(LG, { epoch: auth.getIdentityEpoch() });
      sb._seedMirrorForTest('cfbp_active_week', SWK);
      sb._seedMirrorForTest('cfbp_settings', { autoRefreshInterval: 60 });
    };
    await hydrate();
    return { rows, calls, hydrate, detach, serverFinal };
  };
  /** How many times each announcement went out: queued in chat.js's outbox, or already delivered to the server's chat_append. */
  const announced = (W) => {
    const ids = [...chat._outboxForTest().map((e) => e && e.id), ...W.calls.chat];
    const n = (pred) => ids.filter(pred).length;
    return {
      weekFinal: n((id) => id === `sys_weekfinal_${SWK}`), gameFinal: n((id) => id === `sys_final_${GID}`),
      results: n((id) => id === `sys_lc_RESULTS_FINALIZED_${SWK}`), obligation: n((id) => /^sys_lc_OBLIGATION_CREATED_/.test(String(id))),
      scribe: app._scribeWeekSignalLedgerForTest().filter((k) => k === `${SWK}|final`).length,
    };
  };
  const all = (a, k) => a.weekFinal === k && a.gameFinal === k && a.results === k && a.obligation === k && a.scribe === k;
  // A Realtime event: the adapter folds the row, then runs the app's onRealtimeEvent, whose release step is driven here (the harness wires its own
  // adapter deps, so the app's arrow is pinned by source in 5c-2 instead).
  const realtimeFinal = (W) => {
    sb._foldRealtimeRowForTest('weeks', { eventType: 'UPDATE', new: W.rows.weeks.find((w) => w.id === SWK) });
    if (typeof app._releaseWeekFinalAnnouncementsForTest === 'function') app._releaseWeekFinalAnnouncementsForTest();
  };
  const sbWk = () => storage.getWeek(SWK);
  const commFinalize = () => {
    const host = document.createElement('div');
    host.innerHTML = '<button class="btn btn-primary btn-sm week-status-btn" data-to="final">Finalize</button>';
    document.body.appendChild(host);
    const w = sbWk();
    app.bindCommEventListeners(w, storage.getGames(SWK), [], [], storage.getSettings(), [w], []);
    host.querySelector('.week-status-btn')?.click();
  };
  const notSentRow = () => norm(body()?.querySelector('#wiz-fin-pending:not([hidden]) span')?.textContent);
  const NOT_SENT = "Not sent yet. It will finish when you're back online.";
  const REFUSED = "Couldn't finalize. The server didn't accept it, so the week is still live for everyone.";

  storage.setBackendMode('supabase');

  // [5a] — pending, re-entry, then confirmed by the adapter's own re-send
  {
    const W = await world('network');
    const r1 = await app._finalizeFromGuidedFlowForTest(sbWk());
    const a1 = announced(W);
    assert(r1.state === 'pending' && sbWk().status === 'final' && sb.getConfirmedWeekStatus(SWK) === 'live' && W.calls.finalize === 1,
      `5a-0: (fixture) a network hold: the press is PENDING, this device shows the week final, the server holds it live (state ${r1.state}, server ${sb.getConfirmedWeekStatus(SWK)})`);
    assert(all(a1, 0),
      `PF-416 5a-1: while the server does not hold the week final NOTHING is announced — no week-final post, no game-final post, no results notice, no obligation notice, no SCRIBE week signal (got ${JSON.stringify(a1)})`);
    const stamp = sbWk().finalizedAt, results = JSON.stringify(storage.getWeeklyResults(SWK));
    // item 3 — every Finalize entry, re-entered while the finalize is queued, goes straight to Step 4's "Not sent yet" + Retry
    const entries = {
      'Manage Finalize Week': () => { openWizard(); click('#wiz-open-finalize-btn'); },
      'status-row Finalize': () => { openWizard(); click('.week-wizard-status-btn[data-to="final"]'); },
      'Comm → Week Finalize': () => commFinalize(),
    };
    for (const [name, enter] of Object.entries(entries)) {
      enter();
      assert(onStep('Finalize') && !onStep('Approve Scores') && app._finalizeFlowStateForTest().step === 4 && notSentRow() === NOT_SENT
        && norm(body()?.querySelector('#wiz-fin-retry')?.textContent) === 'Retry' && !body()?.querySelector('#wiz-fin-back') && !body()?.querySelector('#wiz-fin-confirm')
        && body()?.querySelector('#wiz-fin-pending')?.classList.contains('wiz-fin-pending') && !body()?.querySelector('#wiz-fin-failure'),
        `PF-416 5a-2 (${name}): re-entered while the finalize is queued ⇒ Step 4 with "Not sent yet" (amber) + Retry, the one control, and no Back — never a fresh walk through Steps 1-3 (step ${app._finalizeFlowStateForTest().step}; ${text().slice(0, 90)})`);
      closeSheet();
    }
    assert(sbWk().finalizedAt === stamp && JSON.stringify(storage.getWeeklyResults(SWK)) === results && W.calls.finalize === 1 && all(announced(W), 0),
      '5a-3: …and re-entering changed nothing: finalizedAt and the results as queued, finalize_week not sent again, nothing announced');
    await sb.flush();                                             // back on the network: the adapter's own re-send of the queued finalize
    const a2 = announced(W);
    assert(sb.getConfirmedWeekStatus(SWK) === 'final' && W.calls.finalize === 2 && all(a2, 1),
      `PF-416 5a-4: the server confirms the week final ⇒ every announcement goes out, EXACTLY ONCE (got ${JSON.stringify(a2)})`);
    const r2 = await app._finalizeFromGuidedFlowForTest(sbWk());   // a Retry / re-ask after the confirmation
    await W.hydrate();                                            // a later hydrate
    realtimeFinal(W);                                             // a later Realtime event for the final week
    const a3 = announced(W);
    assert(r2.ok === true && r2.action === 'confirmed' && W.calls.finalize === 2 && all(a3, 1),
      `PF-416 5a-5: a re-ask (${r2.action}), a hydrate and a Realtime event after the confirmation announce NOTHING more (got ${JSON.stringify(a3)})`);
    W.detach();
  }
  // [5b] — the request landed but its answer was lost: a hydrate is what sees the week final
  {
    const W = await world('network');
    await app._finalizeFromGuidedFlowForTest(sbWk());
    const a0 = announced(W);
    W.serverFinal();
    await W.hydrate();
    const a1 = announced(W);
    assert(all(a0, 0) && sb.getConfirmedWeekStatus(SWK) === 'final' && all(a1, 1),
      `PF-416 5b-1: confirmation seen by a HYDRATE ⇒ announced once (before ${JSON.stringify(a0)}, after ${JSON.stringify(a1)})`);
    W.detach();
  }
  // [5c] — a Realtime event is what sees the week final
  {
    const W = await world('network');
    await app._finalizeFromGuidedFlowForTest(sbWk());
    const a0 = announced(W);
    W.serverFinal();
    realtimeFinal(W);
    const a1 = announced(W);
    realtimeFinal(W);
    assert(all(a0, 0) && sb.getConfirmedWeekStatus(SWK) === 'final' && all(a1, 1) && all(announced(W), 1),
      `PF-416 5c-1: confirmation seen by a REALTIME event ⇒ announced once, and a second event adds nothing (before ${JSON.stringify(a0)}, after ${JSON.stringify(a1)})`);
    W.detach();
    // The two places production reaches the release that this harness cannot drive through wireSupabaseAdapter() (it wires its own fake client).
    const APPSRC = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
    // D1 integration 18 (2026-10-08): with feat/d1-sports the callback is a block (its other-sport gate, then the reconcile of every sport's week), so the "line" is the
    // callback's whole body, from its opener to the closing `},` (the refreshtest [5i-0] precedent).
    const rtAt = APPSRC.indexOf('onRealtimeEvent:');
    const rtLine = rtAt < 0 ? '' : APPSRC.slice(rtAt, APPSRC.indexOf('\n    },', rtAt) + 7);
    const statusHead = APPSRC.slice(APPSRC.indexOf('function onSupabaseDataStatus('), APPSRC.indexOf('function onSupabaseDataStatus(') + 600);
    assert(/releaseWeekFinalAnnouncements\(\)/.test(rtLine) && /releaseWeekFinalAnnouncements\(\);\s*updateSyncBadge\(/.test(statusHead.replace(/\/\/[^\n]*\n/g, '')),
      `5c-2: wireSupabaseAdapter()'s onRealtimeEvent and the top of onSupabaseDataStatus() (every adapter emit) both release a waiting announcement (rt line ${JSON.stringify(rtLine.trim().slice(0, 140))})`);
  }
  // [5d] — a deterministic refusal: never announced; the sheet's refused state is terminal
  {
    const W = await world('refuse');
    const r1 = await app._finalizeFromGuidedFlowForTest(sbWk());
    assert(r1.state === 'refused' && sbWk().status === 'final' && sb.getConfirmedWeekStatus(SWK) === 'live' && (sb.getStatus().refusedKeys || []).includes('cfbp_weeks'),
      `5d-0: (fixture) finalize_week refused (league_paused): latched, this device shows final, the server holds live (state ${r1.state})`);
    assert(all(announced(W), 0), `PF-416 5d-1: a REFUSED finalize announces nothing (got ${JSON.stringify(announced(W))})`);
    await W.hydrate(); await sb.flush();                          // a re-sync: by the adapter's design the refused write is re-sent once, and refused again
    assert(W.calls.finalize === 2 && sb.getConfirmedWeekStatus(SWK) === 'live' && all(announced(W), 0),
      `PF-416 5d-2: …and still nothing after a re-sync re-sent it and it was refused again (finalize_week calls ${W.calls.finalize}; ${JSON.stringify(announced(W))})`);
    // the sheet: re-entry shows the refusal, terminal
    openWizard(); click('#wiz-open-finalize-btn');
    const row = norm(body()?.querySelector('#wiz-fin-failure:not([hidden]) span')?.textContent);
    assert(onStep('Finalize') && row === REFUSED && norm(body()?.querySelector('#wiz-fin-reload')?.textContent) === 'Reload app' && !body()?.querySelector('#wiz-fin-retry')
      && body()?.querySelector('#wiz-fin-confirm')?.disabled === true && !body()?.querySelector('#wiz-fin-back'),
      `PF-416 5d-3: re-entered after the refusal ⇒ Step 4 says so ("${REFUSED}"), offers Reload app and no Retry, Finalize Week disabled, no Back (got ${JSON.stringify(row)})`);
    const before = W.calls.finalize;
    reloads = 0;
    click('#wiz-fin-confirm'); await tick();
    click('#wiz-fin-reload'); await tick();
    assert(W.calls.finalize === before && reloads === 1 && all(announced(W), 0),
      `PF-416 5d-4: nothing on the sheet sends the refused finalize again (finalize_week calls ${before} → ${W.calls.finalize}); "Reload app" reloads the app (${reloads}), the one step that clears a refused write from this device`);
    closeSheet();
    W.detach();
  }
  // [5e] — the server moved the week under a queued finalize (another device locked it back): this device's finalize is gone, so its announcements are
  // dropped unsent, and when the server later reaches final some other way they are not sent with this device's stale numbers.
  {
    const W = await world('network');
    await app._finalizeFromGuidedFlowForTest(sbWk());            // queued: this device final, the server live
    W.rows.weeks = W.rows.weeks.map((w) => (w.id === SWK ? { ...w, status: 'locked' } : w));
    sb._foldRealtimeRowForTest('weeks', { eventType: 'UPDATE', new: W.rows.weeks.find((w) => w.id === SWK) });
    await sb.flush();                                             // the queued leg meets the moved base: status_moved, the mirror takes the server's status
    const mid = sbWk().status;
    W.serverFinal();
    realtimeFinal(W);                                             // later the server holds the week final, finalized elsewhere
    assert(mid === 'locked' && sb.getConfirmedWeekStatus(SWK) === 'final' && all(announced(W), 0),
      `PF-416 5e-1: a finalize the server's status overtook (status_moved: this device now shows ${mid}) is dropped unsent: when the server later reaches final through another device, this device announces nothing (got ${JSON.stringify(announced(W))})`);
    W.detach();
  }
  // [5f] — review N2 on the real adapter: another device's finalize lands while this device's is out, and this device's finalize_week is REFUSED (a
  // hard refusal, latched) while the server holds the week final. The answer is success, never "still live for everyone".
  // REVIEW FOLLOW-UP 1 (coordinator, 2026-10-08) — 5f-1 CHANGED. It asserted, through the press function alone, that the refusal stays latched after
  // the success, and nothing more: the sheet then closed on "Week 6 is final." with the red sync banner still up beside it and nothing that would
  // ever clear it on this device. Driven through the sheet now: the success is announced, and because the adapter still holds the refused week
  // write, the app RELOADS after the toast (Reload app's own path), so the mirror re-reads the server and the banner clears honestly. Nothing clears
  // the refusal by hand and nothing hides the banner (loud-fail): both stand until that reload.
  // W-22 (2026-10-08) — run twice: as written, then with the wait machine load put between the success and 5f-1b's read on a --quick gate run
  // (5f-1b red once, 176/177: "refused [], banner up false", no reload yet). In that wait the adapter's own debounced flush (800 ms, armed by the
  // finalize's own writes) found nothing left to send for cfbp_weeks and RELEASED the latch, which also takes the banner down: the app's documented
  // behaviour (RG-202, and "a latch an incidental flush released in the meantime makes the reload redundant, never wrong"), not a hand-clear.
  // So 5f-1b reads the state THE SUCCESS LEAVES, not the state some wall-clock time later: captured at the success haptic, in a microtask, which
  // runs once succeeded() (toast, haptic, sheet close, Comm repaint, the reload's timer) and the rest of that turn have finished, and before any
  // timer can run: no flush, no reload, however loaded the machine. (The success is reached from the click on microtasks alone, with no timer hop:
  // a 900 ms stall injected after 0, 1, 2, 3 or 5 hops never moved it.) A success that clears the refusal or hides the banner in that turn, or
  // reloads at once, is read as such.
  const state5f = () => { const b = document.getElementById('backend-error-banner'); return { refused: [...(sb.getStatus().refusedKeys || [])], bannerUp: !!b && b.style.display !== 'none', reloads }; };
  // W-22 review BLOCK (2026-10-14) — a read at the success cannot see a banner hidden by hand one microtask or one timer hop LATER (the
  // reviewer's gap mutants G1 / G2: hideBackendErrorBanner() after renderCommPage(), via Promise.resolve().then and setTimeout(0)). So beside
  // that read there is an invariant no load can move: from the success until the reload, EVERY write that takes the red banner down (display
  // 'none', or the node removed) is checked against the adapter AT THAT WRITE, and the banner never goes down while cfbp_weeks is still refused.
  // The adapter's own release (its flush finds nothing left to send) clears the latch BEFORE the app hides the banner, so the honest path
  // passes; a hide by hand while the refusal stands fails, whenever it lands. Installed at the success (in the capture's own microtask).
  const bannerWatch5f = () => {
    const el = document.getElementById('backend-error-banner');
    const out = { installed: !!el, downs: [], bad: [], stop() {} };
    if (!el) return out;
    const st = el.style; const ownDisplay = Object.prototype.hasOwnProperty.call(st, 'display'); let v = st.display;
    const ownRemove = Object.prototype.hasOwnProperty.call(el, 'remove'), remove = el.remove;
    const down = (what) => { const refused = (sb.getStatus().refusedKeys || []).includes('cfbp_weeks'); out.downs.push(`${what}${refused ? ' WHILE cfbp_weeks REFUSED' : ' (latch already released)'}`); if (refused) out.bad.push(what); };
    Object.defineProperty(st, 'display', { configurable: true, enumerable: true, get: () => v, set: (x) => { v = String(x); if (v === 'none') down('display none'); } });
    el.remove = function (...a) { down('node removed'); return remove.apply(this, a); };
    out.stop = () => { delete st.display; if (ownDisplay || v !== undefined) st.display = v; if (ownRemove) el.remove = remove; else delete el.remove; };
    return out;
  };
  const until5f = async (pred, ms) => { const t0 = Date.now(); while (!pred() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 10)); return pred(); };
  for (const loaded of [false, true]) {
    const W = await world('elsewhere');
    openWizard();
    walkToStep4({});                                              // no tiebreaker question and no Extra Point on this week: Steps 1, 2, 4
    const onFour = onStep('Finalize');
    reloads = 0;
    let atSuccess = null, watch = null;
    const haptics = await successHapticsDuring(async () => { click('#wiz-fin-confirm'); await tick(20); }, () => queueMicrotask(() => { atSuccess = state5f(); if (!loaded) watch = bannerWatch5f(); }));
    // The loaded pass: the wait, as a condition — until the adapter's own flush has released the latch (bounded), as it had on the gate run.
    const released = loaded ? await until5f(() => !(sb.getStatus().refusedKeys || []).includes('cfbp_weeks'), 3000) : null;
    atSuccess = atSuccess || { refused: ['(no success haptic: nothing was read)'], bannerUp: false, reloads: -1 };
    if (loaded) {
      assert(released, `5f-1d: fixture — the wait reproduced the gate run's condition: the adapter's own debounced flush released the cfbp_weeks latch after the success (refused now ${JSON.stringify(sb.getStatus().refusedKeys)})`);
      assert(atSuccess.refused.includes('cfbp_weeks') && atSuccess.bannerUp && atSuccess.reloads === 0,
        `PF-416 follow-up 5f-1e: …and with that wait before the read (machine load), 5f-1b still reads what the success left: the refusal NOT cleared by hand, the red banner NOT hidden, no reload yet (refused ${JSON.stringify(atSuccess.refused)}, banner up ${atSuccess.bannerUp}, reloads ${atSuccess.reloads})`);
      await until5f(() => reloads === 1, 3000);                   // this success's reload lands HERE, never as a stray timer in [5g]
      W.detach();
      continue;
    }
    // Review follow-up copy (coordinator decision, 2026-10-08): when the reload is coming, the toast says so, so the reload does not read as a crash.
    assert(onFour && W.calls.finalize === 1 && sb.getConfirmedWeekStatus(SWK) === 'final' && toasts().includes('Week 6 is final. Refreshing…') && !toasts().includes('Week 6 is final.')
      && document.getElementById('week-wizard-sheet-wrap') === null && haptics === 1,
      `PF-416 N2 5f-1: this device's finalize_week refused (latched) while the server holds the week final ⇒ the sheet reports SUCCESS: "Week 6 is final. Refreshing…" (the reload is coming), the sheet closes, the success haptic once (step 4 reached ${onFour}, finalize_week ${W.calls.finalize}, server ${sb.getConfirmedWeekStatus(SWK)}, haptics ${haptics}, toasts ${JSON.stringify(toasts())})`);
    assert(atSuccess.refused.includes('cfbp_weeks') && atSuccess.bannerUp && atSuccess.reloads === 0,
      `PF-416 follow-up 5f-1b: …the refusal is NOT cleared by hand and the red banner is NOT hidden (refused ${JSON.stringify(atSuccess.refused)}, banner up ${atSuccess.bannerUp}); the toast is shown first, no reload yet (${atSuccess.reloads})`);
    await new Promise((r) => setTimeout(r, 1800));
    // (The adapter's own debounced flush may release the latch before then, when some later write runs one: the reload is decided at the success.)
    assert(reloads === 1,
      `PF-416 follow-up 5f-1c: after the toast, the app RELOADS once (Reload app's path: the mirror re-reads the server, so the banner clears honestly) (reloads ${reloads})`);
    watch?.stop();
    assert(!!watch && watch.installed && watch.bad.length === 0,
      `PF-416 follow-up 5f-1f: …and from the success until the reload the red banner NEVER goes down while cfbp_weeks is still refused, however late a hand-hide lands (watched from the success: ${!!watch && watch.installed}; downs ${JSON.stringify(watch ? watch.downs : null)})`);
    assert(all(announced(W), 1), `5f-2: …and the week is final, so its announcements went out, once (deterministic ids collapse them with the other device's) (got ${JSON.stringify(announced(W))})`);
    W.detach();
  }
  // [5g] — review follow-up (coordinator, 2026-10-08): a CLEAN finalize on the real adapter (finalize_week lands, nothing is refused) never reloads,
  // and its toast is the plain "Week 6 is final." — the "Refreshing…" copy and the reload belong to the latched-refusal case alone. Waits past the
  // reload delay, so a reload made unconditional (or merely delayed) is caught here, not by a stray timer from another section.
  {
    const W = await world(null);
    openWizard();
    walkToStep4({});
    reloads = 0;
    click('#wiz-fin-confirm'); await tick(20);
    const t0 = toasts();
    await new Promise((r) => setTimeout(r, 1800));
    assert(W.calls.finalize === 1 && sb.getConfirmedWeekStatus(SWK) === 'final' && !(sb.getStatus().refusedKeys || []).length
      && t0.includes('Week 6 is final.') && !t0.some((t) => /Refreshing/.test(t)) && document.getElementById('week-wizard-sheet-wrap') === null && reloads === 0,
      `PF-416 follow-up 5g-1: a clean finalize the server saved ⇒ "Week 6 is final." (no "Refreshing…"), the sheet closes, and NOTHING reloads, even past the reload delay (reloads ${reloads}, toasts ${JSON.stringify(t0)})`);
    W.detach();
  }
  sb._resetForTest();
  chat._resetForTest();
  storage.setBackendMode('local');
}

console.warn = realWarn; console.info = realInfo; console.error = realError;
const verdict = fail === 0 ? '✅ ALL PASS' : '❌ FAILURES';
_log(`\n${verdict} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
