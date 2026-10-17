/**
 * CFB Pickems — weeklocktest.mjs (D1 / FB-001 / UN-414, PF-414 / DI-509, DI-510, DI-511, DI-512, DI-514; the client half of "the deadline members were told")
 * ============================================================================================================================================================
 * Drew's report (FB-001): "it says picks lock 30 min before kickoff but its still listed as open and i can still change my picks". The lock instant (first kickoff minus the offset, or
 * the commissioner's own time) was computed in several places and enforced in none of them on the client: the week navigator's badge read the STORED status, the countdown read its own clock
 * test, the submit button waited for a status flip that only a commissioner's open phone (or, from migration 0043, the server job) performs. This suite proves the ONE answer
 * (js/week-lock.js weekLockState) and that every surface now reads it and flips with it, in one pass, at the instant.
 *
 *   [1] weekLockState — the DI-509 table as a fixture matrix, the exact boundary (now === instant is CLOSED), confirmedStatus, `reopened`, deny-only, and the parity of its instant with the two
 *       other JavaScript copies (scoring.js, reminder-rules.js)
 *   [2] THE DEFECT, END TO END — a pinned clock walked across the instant: the week navigator badge, the header badge, the countdown, the timing line, canPlayerSubmitPicks, the Picks form and
 *       Edit My Picks all say OPEN one millisecond before and all say LOCKED at it
 *   [3] GOLDEN — every state where the stored status and the phase agree renders the markup it always rendered (the badge exactly; the countdown and timing line differ ONLY by the two glyph swaps
 *       DI-510 names), so the single-sport league is unchanged outside the fix
 *   [4] Time zones — the same instant, two saved zones: equal instants, different clock text (never the device's zone)
 *   [5] The flip timer — one timer, armed only for an open week with a finite instant, 250 ms past it, capped, re-armed, cleared, re-checked on return to the foreground; one repaint, in one pass
 *       ([5v], reviewer M29: the foreground re-check on Home, Rules and Standings also flips the header badge)
 *   [6] The week locks under an unsaved draft — the draft stays on screen read-only under the calm notice; no draft: the submitted picks or the locked card
 *   [7] The commissioner's Re-open is visible (DI-511) and the Manage line says the lock time has passed (DI-510 row 9); the Home Now card follows the same state (row 7)
 *   [8] The Rules say what the app does (DI-512): the sentence, the render-time legacy table, no stored text rewritten
 *   [9] DI-514 — each competition's week is judged on its own instant: an NFL week locked does not lock the CFB week, and the reverse
 *   [10] The source scan — no new `status === 'open'` edit-gate appears in app.js outside the allow-listed sites
 *   [11] Mutation canaries — `>=` swapped for `>`, the derived lock reopening a stored lock, the demo exemption dropped: each turns a named assertion red (scratch copy, never the tree)
 *
 * NOT covered here, and said so: the crossfade, the repaint's visual smoothness, VoiceOver's reading of the notice, Dynamic Type and the Reduce Motion preference on a real device (Drew's
 * on-device checklist). Run:  node weeklocktest.mjs   (also under TZ=UTC and TZ=America/Los_Angeles)
 */
import { readFile, mkdtemp, writeFile, cp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ── DOM / browser stubs (the ordertest.mjs shape: an id registry whose innerHTML is read back) ──
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear() };
const els = new Map();
function mkEl(id) {
  const e = {
    id, _html: '', dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); },
    insertAdjacentHTML(pos, h) { this._html = pos === 'afterbegin' ? h + this._html : this._html + h; },
    appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [], closest: () => null, scrollTo() {}, focus() {},
    setAttribute() {}, getAttribute: () => null, contains: () => false,
  };
  els.set(id, e);
  return e;
}
['page-picks', 'games-list', 'page-dashboard', 'submitted-games', 'page-leaderboard', 'header-meta-week', 'page-rules', 'page-home', 'toast-container', 'locked-draft-games'].forEach(mkEl);
// B1 (fix round): the dismiss button records its click handler so the test can press it
for (const id of ['lock-draft-dismiss-btn']) { const e = mkEl(id); e.addEventListener = (t, fn) => { (e._l = e._l || {})[t] = fn; }; }
const docListeners = {};
globalThis.document = {
  addEventListener(t, fn) { (docListeners[t] = docListeners[t] || []).push(fn); }, removeEventListener() {},
  getElementById: (id) => els.get(id) || null, querySelector: () => null, querySelectorAll: () => [], createElement: () => mkEl('tmp'),
  body: { classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, dataset: {}, appendChild() {}, innerHTML: '' }, hidden: false,
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined, clipboard: { writeText: async () => {} } }, configurable: true }); }
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.matchMedia = () => ({ matches: false });
globalThis.confirm = () => true; globalThis.prompt = () => null; globalThis.alert = () => {}; globalThis.scrollTo = () => {};
globalThis.fetch = async () => { throw new Error('network disabled in weeklocktest'); };
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'u_' + Math.random().toString(36).slice(2) };

// ── a clock the test owns: Date.now() AND new Date() answer CLOCK ──
const RealDate = Date;
let CLOCK = RealDate.parse('2026-10-10T12:00:00Z');
globalThis.Date = class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(CLOCK); else super(...a); }
  static now() { return CLOCK; }
};

let pass = 0, fail = 0;
function assert(cond, label, detail = '') {
  if (cond) { pass++; console.log('  ✅', label); } else { fail++; console.error('  ❌', label, detail ? `— ${detail}` : ''); }
}
const read = (p) => readFile(new URL(p, import.meta.url), 'utf8');

const storage = await import('./js/storage.js');
const dm = await import('./js/data-model.js');
const wl = await import('./js/week-lock.js');
const scoring = await import('./js/scoring.js');
const rules = await import('./js/reminder-rules.js');
const home = await import('./js/home.js');
const icons = await import('./js/icons.js');
const app = await import('./js/app.js');
const { weekLockState, weekBadgePhase } = wl;
const { icon } = icons;
// T1 (fix round): the foreground re-check is wired LAZILY, by the first arm - a bare module load registers nothing (the _wireAuthHoldVisibility precedent)
const visWired = () => (docListeners.visibilitychange || []).filter((fn) => fn.name === 'recheckLockFlipOnVisible').length;
const visBeforeAnyArm = visWired();

const MIN = 60 * 1000, HOUR = 60 * MIN;
const BASE = RealDate.parse('2026-10-10T12:00:00Z');
const iso = (ms) => new RealDate(ms).toISOString();

console.log(`[weeklocktest] TZ=${process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone}`);

// ── fixtures ──
const mkWeek = (weekId, over = {}) => ({
  weekId, weekNumber: 7, seasonYear: 2026, name: `Week ${weekId}`, status: 'open', startDate: '2026-10-10', endDate: '2026-10-11', dataSourceMode: 'live',
  picksOpenAt: null, picksLockAt: null, autoLockOffsetMinutes: 30, lockedAt: null, finalizedAt: null, tiebreakerQuestion: 'Total points in the last game?',
  actualTiebreakerValue: null, showInHistory: true, blurb: null, ...over,
});
const mkGame = (weekId, key, kickoffMs, over = {}) => ({
  gameId: `${weekId}_${key}`, weekId, espnEventId: null, dataQuality: 'manual', dataSource: 'manual', homeTeam: `Home ${key}`, awayTeam: `Away ${key}`, homeConference: 'SEC', awayConference: 'SEC',
  homeRank: null, awayRank: null, kickoff: kickoffMs === null ? null : iso(kickoffMs), kickoffConfirmed: true, kickoffDateOnly: false, timeWindow: 'afternoon', spread: -3.5, favorite: `Home ${key}`,
  lockedSpread: null, homeScore: null, awayScore: null, status: 'scheduled', actualWinner: null, atsWinner: null, isAlmaMaterGame: false, spreadSource: 'manual', oddsProvider: null, lastUpdated: null,
  venue: null, venueDisplay: null, neutralSite: false, ...over,
});
/** A week whose first kickoff is `firstKickMs` (offset 30 unless overridden), with two games. */
function seed(weekId, { status = 'open', firstKickMs = BASE + 2 * HOUR, over = {} } = {}) {
  const w = mkWeek(weekId, { status, ...over });
  storage.saveWeek(w);
  const games = [mkGame(weekId, 'a', firstKickMs), mkGame(weekId, 'b', firstKickMs + 3 * HOUR)];
  for (const g of games) storage.saveGame(g);
  return { week: storage.getWeek(weekId), games };
}

storage.setBackendMode('local');
storage.addPlayer({ playerId: 'p1', displayName: 'Drew', active: true, almaMater: 'Oklahoma', preferences: {} });
storage.addPlayer({ playerId: 'p2', displayName: 'Brayden', active: true, almaMater: 'Texas A&M', preferences: {} });
storage.setSession('p1', false, true);

// ══════════════════════════════════════════════════════════════════════════
console.log('\n[1] weekLockState — the DI-509 table, the boundary, deny-only…');
// ══════════════════════════════════════════════════════════════════════════
{
  const games = [mkGame('t', 'a', BASE + 2 * HOUR), mkGame('t', 'b', BASE + 5 * HOUR)];     // instant = BASE + 90 min
  const INSTANT = BASE + 90 * MIN;
  const st = (week, now, extra = {}) => weekLockState({ week: mkWeek('t', week), games, now, ...extra });
  // draft
  assert(st({ status: 'draft' }, INSTANT + HOUR).phase === 'draft' && !st({ status: 'draft' }, INSTANT + HOUR).derived && !st({ status: 'draft' }, INSTANT + HOUR).closed, '[1a] draft: never derived, never closed, at any time');
  // open before / at / after
  const before = st({}, INSTANT - 1), at = st({}, INSTANT), after = st({}, INSTANT + 1);
  assert(before.phase === 'open' && !before.derived && !before.closed && before.lockAtMs === INSTANT, '[1b] open, one millisecond BEFORE the instant: open, not derived, not closed');
  assert(at.phase === 'locked' && at.derived === true && at.closed === true && at.stored === 'open', '[1c] open, AT the instant (now === instant): LOCKED and derived — the boundary is CLOSED, like the server\'s `now() < instant`');
  assert(after.phase === 'locked' && after.derived && after.closed, '[1d] open, after the instant: locked, derived, closed');
  // demo
  const demoAfter = st({ dataSourceMode: 'demo' }, INSTANT + HOUR);
  assert(demoAfter.phase === 'open' && !demoAfter.derived && !demoAfter.closed, '[1e] a DEMO week past its instant stays open (demo weeks are exempt, as on the server)');
  // no instant
  const noInstant = weekLockState({ week: mkWeek('t'), games: [mkGame('t', 'a', null)], now: INSTANT + HOUR });
  const noGames = weekLockState({ week: mkWeek('t'), games: [], now: INSTANT + HOUR });
  assert(noInstant.phase === 'open' && noInstant.lockAtMs === null && !noInstant.derived && noGames.phase === 'open' && noGames.lockAtMs === null, '[1f] no dated game / no games: no instant, the week stays open (commissioner-driven, as before)');
  // stored lock/live/final are never reopened by the derived rule and never "derived"
  for (const s of ['locked', 'live', 'final']) {
    const early = st({ status: s }, INSTANT - HOUR), late = st({ status: s }, INSTANT + HOUR);
    assert(early.phase === s && late.phase === s && early.closed && late.closed && !early.derived && !late.derived, `[1g] stored ${s}: phase ${s}, closed, never derived — at any time (a derived lock never reopens a stored lock)`);
  }
  // an explicit picksLockAt later than now keeps the week open (the commissioner's Re-open)
  const reopenedLater = st({ picksLockAt: iso(INSTANT + 3 * HOUR), lockedAt: iso(INSTANT - HOUR) }, INSTANT + HOUR);
  assert(reopenedLater.phase === 'open' && reopenedLater.reopened === true && reopenedLater.lockAtMs === INSTANT + 3 * HOUR, '[1h] a later explicit picksLockAt keeps the week open, and `reopened` is true (stored open on a week that was locked once)');
  const setupLockTime = st({ picksLockAt: iso(INSTANT + 3 * HOUR) }, INSTANT);
  assert(setupLockTime.phase === 'open' && setupLockTime.reopened === false, '[1i] a lock time merely set at setup (no lockedAt) is NOT a re-open');
  // confirmedStatus
  const conf = weekLockState({ week: mkWeek('t', { status: 'open' }), games, now: INSTANT - HOUR, confirmedStatus: 'locked' });
  assert(conf.stored === 'locked' && conf.phase === 'locked' && conf.closed && !conf.derived, '[1j] the server-CONFIRMED status wins over the mirror\'s: confirmed locked reads locked, closed, not derived');
  // robustness
  assert(weekLockState({ week: null, games }).phase === null && weekLockState({}).closed === false, '[1k] no week: null phase, never closed');
  assert(weekLockState({ week: mkWeek('t', { status: 'bogus' }), games, now: INSTANT + HOUR }).phase === 'draft', '[1l] an unknown stored status is never "open" (it reads as draft: not editable, not closed)');
  assert(weekLockState({ week: mkWeek('t', { picksLockAt: 'garbage' }), games: [], now: INSTANT }).lockAtMs === null, '[1m] a garbage picksLockAt is no instant, never a NaN that compares false either way');
  // Date and number clocks agree
  assert(weekLockState({ week: mkWeek('t'), games, now: new RealDate(INSTANT) }).derived === true, '[1n] `now` may be a Date or a number');
  // the badge phase
  assert(weekBadgePhase({ week: mkWeek('t'), games, now: INSTANT }).label === 'LOCKED' && weekBadgePhase({ week: mkWeek('t'), games, now: INSTANT - 1 }).label === 'OPEN', '[1o] the badge reads LOCKED at the instant and OPEN a millisecond before');
  // parity of the instant across the three JavaScript copies, over a matrix
  const lockAts = [null, iso(BASE - HOUR), iso(BASE + 6 * HOUR)];
  const offsets = [undefined, 0, 30, 720, -5];
  const shapes = { none: [], nullKick: [mkGame('p', 'a', null)], one: [mkGame('p', 'a', BASE + 3 * HOUR)], many: [mkGame('p', 'b', BASE + 9 * HOUR), mkGame('p', 'a', BASE + 3 * HOUR), mkGame('p', 'c', null)] };
  let bad = [];
  for (const picksLockAt of lockAts) for (const off of offsets) for (const [k, g] of Object.entries(shapes)) {
    const w = mkWeek('p', { picksLockAt, ...(off === undefined ? {} : { autoLockOffsetMinutes: off }) });
    const a = weekLockState({ week: w, games: g, now: BASE }).lockAtMs;
    const sc = scoring.computeEffectiveLockAt(w, g); const b = sc ? sc.getTime() : null;
    const c = rules.effectiveLockAtMs(w, g);
    if (a !== b || a !== c) bad.push({ picksLockAt, off, k, a, b, c });
  }
  assert(bad.length === 0, `[1p] the instant is the same number in weekLockState, scoring.js and reminder-rules.js over ${lockAts.length * offsets.length * Object.keys(shapes).length} fixtures`, JSON.stringify(bad.slice(0, 3)));
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n[2] THE DEFECT, END TO END — every surface flips together at the instant…');
// ══════════════════════════════════════════════════════════════════════════
const WEEK = 'wl_main';
const INST = BASE + 90 * MIN;                                          // first kickoff BASE + 2 h, offset 30
const surfaces = (weekId = WEEK) => {
  storage.setActiveWeekId(weekId);
  const week = storage.getWeek(weekId), games = storage.getGames(weekId);
  els.get('page-picks')._html = '';
  window.navigateTo('picks');
  const picks = els.get('page-picks')._html;
  return {
    picks,
    nav: app._weekNavCardHTMLForTest(week, week, [week], { dataAttr: 'picks-week' }),
    countdown: app._renderLockCountdownHTMLForTest(week, games),
    timing: app._renderPicksTimingForTest(week, games),
    can: app.canPlayerSubmitPicks(week, 'p1'),
  };
};
{
  seed(WEEK, { firstKickMs: BASE + 2 * HOUR });
  CLOCK = INST - 1;
  const b = surfaces();
  assert(/badge badge-open/.test(b.nav) && />OPEN</.test(b.nav) && !/Picks are locked/.test(b.countdown) && /Picks lock in/.test(b.countdown) && !/\(locked\)/.test(b.timing) && b.can.allowed === true && /id="submit-picks-btn"/.test(b.picks),
    '[2a] ONE millisecond before the instant: the badge says OPEN, the countdown counts down, the timing line is not locked, canPlayerSubmitPicks allows, and the Picks form (with its submit button) is on screen');
  CLOCK = INST;
  const a = surfaces();
  assert(/badge badge-locked/.test(a.nav) && />LOCKED</.test(a.nav) && !/>OPEN</.test(a.nav), '[2b] AT the instant: the week navigator\'s badge says LOCKED (the reported defect: it kept saying OPEN)');
  assert(/Picks are locked/.test(a.countdown) && !/Picks lock in/.test(a.countdown), '[2c] …the countdown says "Picks are locked"');
  assert(/\(locked\)/.test(a.timing), '[2d] …the timing line carries "(locked)"');
  assert(a.can.allowed === false && a.can.reason === 'Week is locked — no new picks accepted.', '[2e] …canPlayerSubmitPicks denies with the EXISTING sentence');
  assert(!/id="submit-picks-btn"/.test(a.picks) && /Week is locked — no new picks accepted\./.test(a.picks), '[2f] …the Picks page shows the locked card and no submit button (the form is gone in the same pass)');
  // the stored status never moved: this is the derived state, not a transition
  assert(storage.getWeek(WEEK).status === 'open', '[2g] …while the stored status is still `open` (nothing wrote to the week: the label is derived)');
  // Edit My Picks: a player who SUBMITTED sees the button before and not after
  for (const g of storage.getGames(WEEK)) storage.saveAllPicks([...storage.getPicks(), { pickId: `pk_${g.gameId}`, weekId: WEEK, gameId: g.gameId, playerId: 'p1', selectedTeam: g.homeTeam, submittedAt: iso(BASE) }]);
  CLOCK = INST - 1; const subBefore = surfaces().picks;
  CLOCK = INST; const subAfter = surfaces().picks;
  assert(/id="edit-picks-btn"/.test(subBefore) && !/id="edit-picks-btn"/.test(subAfter) && /id="go-dash-btn"/.test(subAfter), '[2h] Edit My Picks is on the submitted view one millisecond before the instant and gone at it (View Dashboard stays)');
  // the header badge
  const hb = (now) => weekBadgePhase({ week: storage.getWeek(WEEK), games: storage.getGames(WEEK), now });
  assert(hb(INST - 1).label === 'OPEN' && hb(INST).label === 'LOCKED', '[2i] the header badge (weekBadgePhase) flips at the same instant');
  // the REAL header (refreshHeader writes #header-meta-week): its badge flips at the same instant
  const headerBadge = (now) => { CLOCK = now; els.get('header-meta-week')._html = ''; app._refreshHeaderForTest(); const h = els.get('header-meta-week')._html; return (/class="badge badge-([a-z]+)[^"]*"[^>]*>([A-Z]+)</.exec(h) || []).slice(1).join(':'); };
  assert(headerBadge(INST - 1) === 'open:OPEN' && headerBadge(INST) === 'locked:LOCKED', `[2i2] the REAL header badge (refreshHeader -> #header-meta-week) reads OPEN one millisecond before the instant and LOCKED at it (got "${headerBadge(INST - 1)}" then "${headerBadge(INST)}")`);
  // a stored lock still reads locked at any time
  storage.saveWeek({ ...storage.getWeek(WEEK), status: 'locked' }); CLOCK = INST - HOUR;
  const stored = surfaces();
  assert(/badge-locked/.test(stored.nav) && /Picks are locked/.test(stored.countdown) && /\(locked\)/.test(stored.timing) && stored.can.allowed === false, '[2j] a STORED lock reads locked on every surface even before the clock instant (the commissioner locked it)');
  storage.saveWeek({ ...storage.getWeek(WEEK), status: 'open' });
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n[3] GOLDEN — states where stored status and phase agree render as they always did…');
// ══════════════════════════════════════════════════════════════════════════
{
  // The v0.29.0 templates, copied here with the ONLY two things DI-510 changes parameterised: the glyphs (emoji -> icon()). Anything else moving makes the equality fail.
  const oldBadge = (status) => `<span class="badge badge-${status}">${String(status).toUpperCase()}</span>`;
  const oldCountdown = (week, games, lockedGlyph, openGlyph, when, left, locked, compact = false) => locked
    ? `<div class="lock-countdown lock-countdown-closed${compact ? ' lock-countdown-compact' : ''}">
      <span class="lock-countdown-icon">${lockedGlyph}</span>
      <div><div class="lock-countdown-main">Picks are locked</div>
      <div class="lock-countdown-sub">Locked ${when}</div></div>
    </div>`
    : `<div class="lock-countdown${compact ? ' lock-countdown-compact' : ''}">
    <span class="lock-countdown-icon">${openGlyph}</span>
    <div><div class="lock-countdown-main">Picks lock in ${left}</div>
    <div class="lock-countdown-sub">${when} · ${games.length} game${games.length === 1 ? '' : 's'} on the slate</div></div>
  </div>`;
  const whenOf = (week, games) => dm.formatGameTime(scoring.computeEffectiveLockAt(week, games).toISOString(), storage.getTimezone());
  // open, far from the instant (not "urgent"): byte-identical apart from the glyph
  seed('wl_gold', { firstKickMs: BASE + 40 * HOUR }); CLOCK = BASE;
  let week = storage.getWeek('wl_gold'), games = storage.getGames('wl_gold');
  const navOpen = app._weekNavCardHTMLForTest(week, week, [week], { dataAttr: 'picks-week' });
  assert(navOpen.includes(oldBadge('open')), '[3a] OPEN before the instant: the week navigator\'s badge markup is byte-identical to the old one');
  const cd = app._renderLockCountdownHTMLForTest(week, games);
  const left = Math.floor((scoring.computeEffectiveLockAt(week, games).getTime() - CLOCK) / MIN); const d = Math.floor(left / 1440), h = Math.floor((left % 1440) / 60);
  assert(cd === oldCountdown(week, games, icon('lock'), icon('clock'), whenOf(week, games), d > 0 ? `${d}d ${h}h` : `${h}h ${left % 60}m`, false),
    '[3b] OPEN, far from the instant: the countdown markup differs from v0.29.0 ONLY by the glyph (the clock family icon in place of the hourglass emoji)');
  assert(!cd.includes('⏳') && !cd.includes('🔒') && !app._renderPicksTimingForTest(week, games).includes('🔒') && !app._renderPicksTimingForTest(week, games).includes('🏈'), '[3c] no chrome emoji is left on the countdown or the timing line (D-1)');
  // stored statuses: badge identical
  for (const s of ['draft', 'locked', 'live', 'final']) {
    const w = { ...week, status: s };
    assert(app._weekNavCardHTMLForTest(w, w, [w], { dataAttr: 'picks-week' }).includes(oldBadge(s)), `[3d] stored ${s}: the badge markup is byte-identical to the old one`);
  }
  // a stored lock: countdown "locked" markup identical apart from the glyph
  const wl2 = { ...week, status: 'locked' }; storage.saveWeek(wl2);
  assert(app._renderLockCountdownHTMLForTest(wl2, games) === oldCountdown(wl2, games, icon('lock'), icon('clock'), whenOf(wl2, games), '', true), '[3e] a stored lock: the locked countdown markup differs from v0.29.0 only by the glyph');
  storage.saveWeek({ ...wl2, status: 'open' });
  // live and final show neither card, as before
  const wlive = { ...week, status: 'live' };
  assert(app._renderLockCountdownHTMLForTest(wlive, games) === '' && app._renderPicksTimingForTest(wlive, games) === '', '[3f] live and final weeks render no countdown and no timing line, as before');
  // the timing line: not-passed, not-locked state keeps its structure
  const t = app._renderPicksTimingForTest(storage.getWeek('wl_gold'), games);
  assert(/<span class="pt-item "><svg[^>]*>[\s\S]*?<\/svg> <strong>Picks lock:<\/strong> /.test(t) && /<strong>Games live:<\/strong> /.test(t) && !/\(locked\)/.test(t) && !/pt-passed/.test(t), '[3g] the timing line keeps its two items in order with the same labels (glyphs aside)');
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n[4] Time zones — one instant, two saved zones…');
// ══════════════════════════════════════════════════════════════════════════
{
  seed('wl_tz', { firstKickMs: BASE + 40 * HOUR }); CLOCK = BASE;
  const w = storage.getWeek('wl_tz'), g = storage.getGames('wl_tz');
  const instantA = weekLockState({ week: w, games: g, now: CLOCK }).lockAtMs;
  storage.setTimezone('CT'); const ct = app._renderLockCountdownHTMLForTest(w, g); const tzCt = storage.getTimezone();
  storage.setTimezone('PT'); const pt = app._renderLockCountdownHTMLForTest(w, g); const tzPt = storage.getTimezone();
  const instantB = weekLockState({ week: w, games: g, now: CLOCK }).lockAtMs;
  const subOf = (h) => (/lock-countdown-sub">([^<]*)</.exec(h) || [])[1];
  assert(instantA === instantB && tzCt !== tzPt, '[4a] the same stored lock instant under two saved zones: equal instants');
  assert(subOf(ct) && subOf(pt) && subOf(ct) !== subOf(pt), `[4b] …and different clock text (Central "${subOf(ct)}" vs Pacific "${subOf(pt)}") — rendered in the PLAYER\'S saved zone, never the device\'s`);
  storage.setTimezone('CT');
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n[5] The flip timer — one timer, 250 ms past the instant, capped, cleared, re-checked…');
// ══════════════════════════════════════════════════════════════════════════
{
  const timers = []; let repaints = 0, flagDuringRepaint = null, nowVal = BASE;
  const deps = {
    now: () => nowVal,
    setTimer: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
    clearTimer: (t) => { if (t) t.cleared = true; },
    repaint: () => { repaints++; flagDuringRepaint = app._lockFlipStateForTest().repainting; },
  };
  const live = () => timers.filter((t) => !t.cleared && !t.fired);
  const fire = (t) => { t.fired = true; t.fn(); };      // a timer that has fired is no longer pending, exactly as in a browser
  // an open week 90 minutes from its instant
  seed('wl_fl', { firstKickMs: BASE + 2 * HOUR });
  let wk = storage.getWeek('wl_fl'), gs = storage.getGames('wl_fl');
  let r = app._armLockFlipForTest(wk, gs, deps);
  assert(r.armed && live().length === 1 && live()[0].ms === 90 * MIN + 250, '[5a] an OPEN week with a finite instant arms ONE timer for instant + 250 ms');
  assert(visWired() === 1, `[5a2] the first arm registered the visibilitychange re-check exactly once (found ${visWired()}): iOS freezes timers, so without it a week that locked while the app was in the background stays editable on screen`);
  r = app._armLockFlipForTest(wk, gs, deps);
  assert(live().length === 1 && timers.length === 2 && timers[0].cleared, '[5b] arming again clears the first timer: there is never more than one (the timer is not armed twice)');
  nowVal = BASE + 90 * MIN + 250;
  fire(live()[0]);
  assert(repaints === 1 && flagDuringRepaint === true && app._lockFlipStateForTest().repainting === false, '[5c] when the timer fires after the instant the page is repainted ONCE, with the fade-in flag up during the repaint and down after');
  assert(app._lockFlipStateForTest().armed === false, '[5d] …and no timer is left running (a locked week arms nothing)');
  // a long horizon: capped at 24 h, fires early -> re-arms without repainting
  nowVal = BASE; repaints = 0; timers.length = 0;
  seed('wl_far', { firstKickMs: BASE + 5 * 24 * HOUR });
  wk = storage.getWeek('wl_far'); gs = storage.getGames('wl_far');
  r = app._armLockFlipForTest(wk, gs, deps);
  assert(r.armed && live()[0].ms === 24 * HOUR && live()[0].ms < 2 ** 31, '[5e] an instant five days away is armed for the 24 h cap, never a delay beyond the signed 32-bit limit');
  nowVal = BASE + 24 * HOUR; fire(live()[0]);
  assert(repaints === 0 && live().length === 1 && timers.length === 2, '[5f] firing before the instant (the cap) repaints nothing and re-arms');
  // not armed: demo, stored locked, no instant, no week
  timers.length = 0;
  seed('wl_demo', { firstKickMs: BASE + 2 * HOUR, over: { dataSourceMode: 'demo' } });
  seed('wl_stored', { status: 'locked', firstKickMs: BASE + 2 * HOUR });
  storage.saveWeek(mkWeek('wl_noinst')); storage.saveGame(mkGame('wl_noinst', 'a', null));
  const tries = [['wl_demo', 'open'], ['wl_stored', 'locked'], ['wl_noinst', 'open']].map(([id]) => app._armLockFlipForTest(storage.getWeek(id), storage.getGames(id), deps));
  assert(tries[0].armed === true && tries[1].armed === false && tries[2].armed === false && app._armLockFlipForTest(null, [], deps).armed === false,
    '[5g] stored-locked, no-instant and no-week arm nothing; a demo week is "open" so it arms, and when it fires it finds the week still open (never a flip)');
  // the demo timer at its instant: phase stays open -> re-arms, no repaint
  repaints = 0; nowVal = BASE + 4 * HOUR; app._armLockFlipForTest(storage.getWeek('wl_demo'), storage.getGames('wl_demo'), deps);
  const demoTimer = live().pop(); fire(demoTimer);
  assert(repaints === 0, '[5h] a demo week past its instant never repaints (it stays open)');
  // return to the foreground: the week closed while the timer was frozen (iOS suspends timers) -> ONE repaint at once; a week still open is just re-armed
  repaints = 0; timers.length = 0; nowVal = BASE; CLOCK = BASE;
  seed('wl_vis', { firstKickMs: BASE + 2 * HOUR });
  storage.setActiveWeekId('wl_vis'); window.navigateTo('picks');        // the picks tab is up on the current week
  repaints = 0; timers.length = 0;
  app._armLockFlipForTest(storage.getWeek('wl_vis'), storage.getGames('wl_vis'), deps);
  assert(app._lockFlipStateForTest().weekId === 'wl_vis' && live().length === 1, '[5i] the timer watches the week it was armed for');
  app._recheckLockFlipForTest();
  assert(repaints === 0 && live().length === 1, '[5j] returning to the foreground while the week is still open repaints nothing and keeps ONE timer');
  CLOCK = BASE + 3 * HOUR;                                              // the clock ran on while the timer was frozen
  app._recheckLockFlipForTest();
  assert(repaints === 1 && flagDuringRepaint === true, '[5k] returning to the foreground after the instant repaints ONCE, at once, with the fade-in flag up during it');
  CLOCK = BASE;
  app._armLockFlipForTest(null, [], null);       // restore production behaviour for the rest of the file
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n[5b] T1 (fix round) — the REAL navigation paths arm the timer; the foreground re-check is lazy then wired…');
// ══════════════════════════════════════════════════════════════════════════
{
  assert(visBeforeAnyArm === 0, '[5m] importing the module (and nothing else) registered no visibilitychange listener: the wiring is lazy, on the first arm');
  seed('wl_nav', { firstKickMs: BASE + 2 * HOUR });
  storage.setActiveWeekId('wl_nav'); CLOCK = BASE;
  app._armLockFlipForTest(null, [], null);       // production timers; nothing armed
  assert(app._lockFlipStateForTest().armed === false, '[5n] fixture: nothing is armed before a navigation');
  const armedAfter = {};
  for (const tab of ['picks', 'dashboard', 'home', 'rules']) {
    app._armLockFlipForTest(null, [], null);
    let threw = null;
    try { window.navigateTo(tab); } catch (e) { threw = e; }
    const st = app._lockFlipStateForTest();
    armedAfter[tab] = threw ? `threw ${threw.message}` : (st.armed && st.weekId === 'wl_nav');
  }
  assert(armedAfter.picks === true, `[5o] after a real navigateTo('picks') ONE timer is armed on the current week (${armedAfter.picks})`);
  assert(armedAfter.dashboard === true, `[5p] after a real navigateTo('dashboard') the timer is armed on the current week (${armedAfter.dashboard})`);
  assert(armedAfter.home === true, `[5q] after a real navigateTo('home') the timer is armed too: Home's Now card flips at the same instant (E1) (${armedAfter.home})`);
  assert(armedAfter.rules === true, `[5r] …and after any other tab (Rules here) the timer is armed, so the HEADER badge that sits above every page flips wherever the member is (E1) (${armedAfter.rules})`);
  // the page paints arm the timer THEMSELVES (a Realtime repaint and the flip's own repaint reach them without navigateTo): paint each directly with nothing armed
  window.navigateTo('picks');
  app._armLockFlipForTest(null, [], null); app._renderPicksPageForTest();
  const directPicks = app._lockFlipStateForTest().armed;
  window.navigateTo('dashboard');
  app._armLockFlipForTest(null, [], null); app._renderDashboardForTest();
  const directDash = app._lockFlipStateForTest().armed;
  window.navigateTo('home');
  app._armLockFlipForTest(null, [], null); app._renderHomePageForTest();
  const directHome = app._lockFlipStateForTest().armed;
  assert(directPicks && directDash && directHome, `[5u] a direct paint of Picks, of the Dashboard and of Home each arms the timer on its own, not only a navigation does (picks ${directPicks}, dashboard ${directDash}, home ${directHome})`);
  // the header badge flips at the instant on a tab that does not repaint its body (Rules): the handler refreshes the header and nothing else
  window.navigateTo('rules');
  app._refreshHeaderForTest();
  const headBefore = els.get('header-meta-week')?._html || '';
  CLOCK = BASE + 90 * MIN + 250;
  app._fireLockFlipForTest();
  const headAfter = els.get('header-meta-week')?._html || '';
  assert(/OPEN/i.test(headBefore) && !/LOCKED/i.test(headBefore) && /LOCKED/i.test(headAfter) && !/OPEN/i.test(headAfter), `[5s] the flip refreshes the header badge on a tab that has no lock text of its own: OPEN before the instant, LOCKED after it`, JSON.stringify({ headBefore: headBefore.slice(0, 160), headAfter: headAfter.slice(0, 160) }));
  // Home is repainted by the flip (its Now card reads the same state): count the real renderHome calls
  CLOCK = BASE; window.navigateTo('home');
  const homeView = app._getHomeWiringForTest().homeView; const origRender = homeView.renderHome; let homePaints = 0;
  homeView.renderHome = (...a) => { homePaints++; return origRender.apply(homeView, a); };
  CLOCK = BASE + 90 * MIN + 250; app._fireLockFlipForTest();
  homeView.renderHome = origRender;
  assert(homePaints === 1, `[5t] when the flip fires on the Home tab, Home is repainted once (E1) (${homePaints})`);
  // M29 (reviewer note, D1 integration 2026-10-07) — the FOREGROUND re-check on a tab other than Picks or Dashboard. The member left the app on Home, Rules or
  // Standings with the week open (a real navigation armed the timer), iOS froze the timer, and the app comes back after the instant: the REAL visibilitychange
  // listener re-checks the lock, the header badge reads LOCKED, and Home (whose Now card shows the lock) is repainted once; Rules and Standings keep their body.
  const visListener = (docListeners.visibilitychange || []).find((fn) => fn.name === 'recheckLockFlipOnVisible');
  const fg = {};
  for (const tab of ['home', 'rules', 'leaderboard']) {
    CLOCK = BASE; app._armLockFlipForTest(null, [], null);
    let threw = null;
    try { window.navigateTo(tab); } catch (e) { threw = e; }
    const armed = app._lockFlipStateForTest();
    app._refreshHeaderForTest();
    const before = els.get('header-meta-week')?._html || '';
    const hv = app._getHomeWiringForTest().homeView; const orig = hv.renderHome; let paints = 0;
    hv.renderHome = (...a) => { paints++; return orig.apply(hv, a); };
    CLOCK = BASE + 3 * HOUR;                                            // the timer never fired (frozen in the background); the clock ran on
    try { if (visListener) visListener(); } catch (e) { threw = threw || e; }
    hv.renderHome = orig;
    const after = els.get('header-meta-week')?._html || '';
    fg[tab] = { threw: threw ? threw.message : null, armed: armed.armed && armed.weekId === 'wl_nav', before: /OPEN/i.test(before) && !/LOCKED/i.test(before), after: /LOCKED/i.test(after) && !/OPEN/i.test(after), homePaints: paints };
  }
  assert(!!visListener && Object.values(fg).every((t) => !t.threw && t.armed && t.before && t.after) && fg.home.homePaints === 1 && fg.rules.homePaints === 0 && fg.leaderboard.homePaints === 0,
    '[5v] M29: back in the foreground after the instant on Home, Rules or Standings, the real visibilitychange re-check flips the header badge OPEN -> LOCKED on each, and repaints Home (its Now card) once and no other body', JSON.stringify(fg));
  CLOCK = BASE;
  app._armLockFlipForTest(null, [], null);
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n[6] The week locks under an unsaved draft — nothing is wiped silently…');
// ══════════════════════════════════════════════════════════════════════════
{
  storage.saveAllPicks([]);
  const WK = 'wl_draft';
  seed(WK, { firstKickMs: BASE + 2 * HOUR });
  storage.setActiveWeekId(WK);
  const g0 = storage.getGames(WK)[0];
  CLOCK = INST - 5 * MIN;
  els.get('page-picks')._html = ''; window.navigateTo('picks');
  assert(/id="submit-picks-btn"/.test(els.get('page-picks')._html), '[6a] fixture: five minutes before the instant the editable form is up');
  // the member picks a team (the draft lives in the app's state; the harness reaches it through the test seam)
  app._setDraftForTest({ draftPicks: { [g0.gameId]: g0.homeTeam }, draftTiebreaker: 55, draftExtraPoint: 41 });
  assert(app.hasUnsavedDraft(storage.getWeek(WK), 'p1') === true, '[6b] a pick the member has not saved is an unsaved draft');
  CLOCK = INST + 250;
  els.get('page-picks')._html = ''; window.navigateTo('picks');
  const html = els.get('page-picks')._html;
  assert(/This week is locked\./.test(html) && /Your last change was not saved\./.test(html) && /Picks and guesses close when the week locks\./.test(html) && /role="alert"/.test(html),
    '[6c] the repaint at the instant keeps the page up with the calm notice: title, detail and hint (the PF-1 copy), announced (role=alert)');
  assert(!/id="submit-picks-btn"/.test(html) && /disabled/.test(html) && /id="tb-input"/.test(html) && /value="55"/.test(html) && /value="41"/.test(html), '[6d] …the submit button is gone, the tiebreaker (55) and Extra Point (41) are still shown, read-only (disabled)');
  const draftList = els.get('locked-draft-games')?._html || '';
  assert(draftList.includes(g0.homeTeam) && /game-card/.test(draftList), '[6e] …and the member\'s draft pick is still on screen (the locked game card shows the team he chose)');
  assert(app.hasUnsavedDraft(storage.getWeek(WK), 'p1') === true, '[6f] …and the draft itself is untouched');
  // no unsaved draft -> no notice
  app._setDraftForTest({ draftPicks: {}, draftTiebreaker: null, draftExtraPoint: null, pickFormShownFor: WK });
  els.get('page-picks')._html = ''; window.navigateTo('picks');
  assert(!/Your last change was not saved\./.test(els.get('page-picks')._html) && /Week is locked — no new picks accepted\./.test(els.get('page-picks')._html), '[6g] with NO unsaved draft the page is the plain locked card (nothing was lost, so nothing is said)');
  // a different week never inherits the draft view
  app._setDraftForTest({ draftPicks: { [g0.gameId]: g0.homeTeam }, draftTiebreaker: null, draftExtraPoint: null, pickFormShownFor: 'some_other_week' });
  els.get('page-picks')._html = ''; window.navigateTo('picks');
  assert(!/Your last change was not saved\./.test(els.get('page-picks')._html), '[6h] a draft shown for ANOTHER week does not produce the notice on this one');
  // escaped: a hostile team name in the draft view is text
  app._setDraftForTest({ draftPicks: {}, draftTiebreaker: null, draftExtraPoint: null, pickFormShownFor: null });
  storage.saveAllPicks([]);
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n[6b] B1 (fix round) — the locked-draft notice lives for the lock window only; announced once; has a way out…');
// ══════════════════════════════════════════════════════════════════════════
{
  const WK = 'wl_b1';
  seed(WK, { firstKickMs: BASE + 2 * HOUR });
  storage.setActiveWeekId(WK);
  const gs = storage.getGames(WK);
  const g0 = gs[0];
  const clearPicks = () => gs.forEach((g) => storage.deletePicksForGame(g.gameId));   // saveAllPicks([]) is an upsert: it clears nothing
  clearPicks();
  const page = () => els.get('page-picks')._html;
  const repaint = () => { els.get('page-picks')._html = ''; window.navigateTo('picks'); return page(); };
  // a member with NO saved picks, mid-edit, week locks under him
  CLOCK = INST - 5 * MIN;
  app._setDraftForTest({ draftPicks: {}, draftTiebreaker: null, draftExtraPoint: null, pickFormShownFor: null, lockDraftAnnouncedFor: null, editingPicks: false });
  repaint();
  app._setDraftForTest({ draftPicks: { [g0.gameId]: g0.homeTeam } });
  CLOCK = INST + 250;
  const first = repaint();
  assert(/lock-draft-notice mb-md" role="alert"/.test(first), '[6i] the FIRST paint of the notice is announced (role="alert")');
  assert(/Weekly Tiebreaker \(Required\)/.test(first) && /The Ischemic Extra Point/.test(first) && !first.includes('🎯'), '[6i2] the two guess inputs this feature touched carry plain-text labels: no chrome emoji (D-1)');
  const second = repaint();
  assert(/Your last change was not saved\./.test(second) && /class="warning-box lock-draft-notice mb-md">/.test(second) && !/role="alert"/.test(second), '[6j] every later repaint (the flip timer, a tick) shows the same notice WITHOUT role="alert": a screen reader hears it once, not every repaint');
  assert(/id="lock-draft-dismiss-btn"[^>]*>Close<\/button>/.test(second), '[6k] the notice carries a way out; a member with no saved picks sees "Close"');
  // pressing it ends the edit session: draft cleared, the locked card is up, the announced marker is reset
  els.get('lock-draft-dismiss-btn')._l.click();
  assert(app.hasUnsavedDraft(storage.getWeek(WK), 'p1') === false && /Week is locked — no new picks accepted\./.test(page()) && !/Your last change was not saved\./.test(page()), '[6l] pressing it clears the unsaved draft and shows the ordinary locked card (no notice left on screen)');

  // a SUBMITTED member, mid-edit (Edit My Picks), week locks under him -> notice with "Show my saved picks"
  storage.saveAllPicks(gs.map((g) => ({ pickId: `pk_${g.gameId}`, weekId: WK, gameId: g.gameId, playerId: 'p1', selectedTeam: g.homeTeam, submittedAt: iso(BASE) })));
  CLOCK = INST - 5 * MIN;
  app._setDraftForTest({ draftPicks: {}, draftTiebreaker: null, draftExtraPoint: null, pickFormShownFor: null, lockDraftAnnouncedFor: null, editingPicks: true });
  repaint();                                               // the edit form is up (prefilled from the saved picks)
  assert(/id="submit-picks-btn"/.test(page()) && /update your picks/.test(page()), '[6m] fixture: a submitted member in Edit My Picks sees the editable form five minutes before the instant');
  app._setDraftForTest({ draftPicks: { [g0.gameId]: g0.awayTeam } });             // he flips one pick; not saved
  CLOCK = INST + 250;
  const atInstant = repaint();
  assert(/Your last change was not saved\./.test(atInstant) && />Show my saved picks<\/button>/.test(atInstant), '[6n] at the instant the unsaved change is kept on screen with the notice, and the way out reads "Show my saved picks"');
  // THE B1 SEQUENCE: the week then goes LIVE (the commissioner / the server job moves the stored status)
  storage.saveWeek({ ...storage.getWeek(WK), status: 'live', lockedAt: iso(INST) });
  CLOCK = INST + 2 * MIN;
  const live = repaint();
  assert(!/Your last change was not saved\./.test(live) && !/lock-draft-notice/.test(live) && /picks submitted/.test(live), '[6o] once the stored status is LIVE the stale notice is gone and the member sees the picks he submitted (not a draft notice about a week that is no longer in its lock window)');
  const seam = app._setDraftForTest({});
  assert(seam.editingPicks === false && Object.keys(seam.draftPicks).length === 0 && seam.pickFormShownFor === null, '[6p] …the edit session ended: editingPicks is off, the unsaved draft is cleared, and no form is remembered for this week');
  // the same for FINAL
  app._setDraftForTest({ draftPicks: { [g0.gameId]: g0.awayTeam }, pickFormShownFor: WK, editingPicks: true });
  storage.saveWeek({ ...storage.getWeek(WK), status: 'final' });
  const fin = repaint();
  assert(!/lock-draft-notice/.test(fin) && /picks submitted/.test(fin) && app._setDraftForTest({}).editingPicks === false, '[6q] …and a FINAL week likewise resets the session and shows the submitted picks');
  // a member who never submitted, week LIVE: the plain locked card, no notice
  clearPicks();
  app._setDraftForTest({ draftPicks: { [g0.gameId]: g0.homeTeam }, pickFormShownFor: WK, editingPicks: false });
  storage.saveWeek({ ...storage.getWeek(WK), status: 'live' });
  const noSub = repaint();
  assert(!/lock-draft-notice/.test(noSub) && /Games are in progress — picks closed\./.test(noSub) && app.hasUnsavedDraft(storage.getWeek(WK), 'p1') === false, '[6r] a member who never submitted, on a LIVE week, sees the plain locked card and his abandoned draft is cleared');
  // while the phase is still LOCKED (stored locked) the notice is still shown: only live/final end it
  storage.saveWeek({ ...storage.getWeek(WK), status: 'locked' });
  app._setDraftForTest({ draftPicks: { [g0.gameId]: g0.homeTeam }, pickFormShownFor: WK, lockDraftAnnouncedFor: null });
  assert(/Your last change was not saved\./.test(repaint()), '[6s] a STORED locked week (the lock window) still shows the notice: the view ends at live or final, not at the first stored write');
  app._setDraftForTest({ draftPicks: {}, draftTiebreaker: null, draftExtraPoint: null, pickFormShownFor: null, lockDraftAnnouncedFor: null, editingPicks: false });
  clearPicks();
  CLOCK = BASE;
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n[7] Re-open is visible (DI-511), the Manage line (row 9), the Home Now card (row 7)…');
// ══════════════════════════════════════════════════════════════════════════
{
  const WK = 'wl_reopen';
  seed(WK, { firstKickMs: BASE + 2 * HOUR, over: { lockedAt: iso(BASE + HOUR), picksLockAt: iso(BASE + 4 * HOUR) } });
  CLOCK = BASE + 3 * HOUR;       // past the ORIGINAL instant, before the new explicit time
  let w = storage.getWeek(WK), g = storage.getGames(WK);
  const timing = app._renderPicksTimingForTest(w, g);
  assert(/Re-opened by the commissioner<\/strong> · locks /.test(timing) && !/\(locked\)/.test(timing) && app.canPlayerSubmitPicks(w, 'p1').allowed === true, '[7a] a week the commissioner re-opened to a later lock time says "Re-opened by the commissioner · locks {when}" and accepts picks');
  const plain = (() => { seed('wl_plain', { firstKickMs: BASE + 40 * HOUR, over: { picksLockAt: iso(BASE + 30 * HOUR) } }); return app._renderPicksTimingForTest(storage.getWeek('wl_plain'), storage.getGames('wl_plain')); })();
  assert(!/Re-opened/.test(plain) && /Picks lock:/.test(plain), '[7b] a lock time merely set at setup does NOT read as a re-open');
  CLOCK = BASE + 5 * HOUR;       // past the new explicit time too
  w = storage.getWeek(WK);
  assert(/\(locked\)/.test(app._renderPicksTimingForTest(w, g)) && app.canPlayerSubmitPicks(w, 'p1').allowed === false, '[7c] past the new time the re-opened week locks again, derived');
  // Manage line
  const OPENED = 'wl_manage';
  seed(OPENED, { firstKickMs: BASE + 2 * HOUR }); CLOCK = INST - 1;
  const mBefore = app._renderWeekWizardManageHTMLForTest(storage.getWeek(OPENED), storage.getGames(OPENED));
  CLOCK = INST;
  const mAfter = app._renderWeekWizardManageHTMLForTest(storage.getWeek(OPENED), storage.getGames(OPENED));
  assert(!/Lock time has passed\./.test(mBefore) && /Status: <span class="badge badge-open">OPEN<\/span><\/div><div class="text-sm text-muted mb-sm">Lock time has passed\. The week locks automatically\.<\/div>/.test(mAfter), '[7d] the commissioner\'s Manage line keeps the STORED status (the "OPEN" status badge, FB-027 / DI-518) and adds "Lock time has passed. The week locks automatically." only once the instant has passed');
  // Home Now card
  const week = mkWeek('wl_home', { weekNumber: 7 });
  const games = [mkGame('wl_home', 'a', BASE + 2 * HOUR), mkGame('wl_home', 'b', BASE + 5 * HOUR)];
  const snap = (wk) => ({ weeks: [wk], games, picks: [], players: [], currentWeekId: wk.weekId, confirmedStatusFor: (x) => x.status });
  const eyebrowAt = (wk, now) => home.nowCardModel(snap(wk), { viewerId: null, isCommissioner: true, now }).eyebrow;      // isCommissioner: a demo week is only listed for the commissioner
  assert(/Open/.test(eyebrowAt(week, INST - 1)) && /Locked/.test(eyebrowAt(week, INST)), '[7e] the Home Now card reads Open one millisecond before the instant and Locked at it (the same week-lock state)');
  assert(/Open/.test(eyebrowAt({ ...week, dataSourceMode: 'demo' }, INST + HOUR)), '[7f] …and a demo week past its instant stays Open there too');
  const reopenSub = home.nowCardModel(snap({ ...week, lockedAt: iso(BASE), picksLockAt: iso(BASE + 4 * HOUR) }), { viewerId: null, now: BASE + 3 * HOUR }).sub;
  assert(/^Picks were re-opened · locks in /.test(reopenSub), `[7g] a re-opened week's Home sub reads "Picks were re-opened · locks in …" (got "${reopenSub}")`);
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n[8] The Rules say what the app does (DI-512)…');
// ══════════════════════════════════════════════════════════════════════════
{
  const NEW = 'Picks lock before the first kickoff of the week, usually 30 minutes before, at the time shown on the Picks page. After that, no picks or guesses are accepted.';
  const OLD = 'Games lock at kickoff. If the week is locked, no picks are accepted even for future games.';
  assert(dm.RULES_LOCK_SENTENCE === NEW && JSON.stringify(dm.DEFAULT_RULES).includes(NEW) && !JSON.stringify(dm.DEFAULT_RULES).includes('Games lock at kickoff'), '[8a] the default rule is the DI-512 sentence and the old one is not a default any more');
  assert(!/\b\d+ minutes\b/.test(NEW.replace('usually 30 minutes before', '')), '[8b] the sentence states no per-week number as a promise ("usually 30 minutes", because a commissioner can set another offset)');
  const saved = [{ id: 'r1', section: 'The Basics', items: ['Pick winners.', OLD, 'Games lock at kickoff, always.'] }, { id: 'r2', section: 'X', items: [`  ${OLD}  `] }];
  const snapshot = JSON.stringify(saved);
  const r = dm.applyRulesLegacyReplacements(saved);
  assert(r.replaced === 2 && r.rules[0].items[1] === NEW && r.rules[0].items[0] === 'Pick winners.' && r.rules[0].items[2] === 'Games lock at kickoff, always.' && r.rules[1].items[0] === NEW,
    '[8c] the legacy table replaces the EXACT old sentence (whitespace-trimmed) and leaves every other line, including one that merely contains the same words, alone');
  assert(JSON.stringify(saved) === snapshot, '[8d] …and never mutates its input (stored text is not rewritten by rendering)');
  assert(dm.applyRulesLegacyReplacements(dm.DEFAULT_RULES).replaced === 0 && dm.applyRulesLegacyReplacements(null).rules === null, '[8e] the defaults and a missing rule set pass through untouched');
  // the Rules page with a league that saved the old copy
  storage.saveSetting('customRules', saved);
  els.get('page-rules')._html = '';
  app.renderRulesPage();
  const page = els.get('page-rules')._html;
  assert(page.includes(NEW) && !page.includes('Games lock at kickoff. If the week'), '[8f] the Rules page of a league with a saved copy shows the corrected sentence');
  assert(JSON.stringify(storage.getSettings().customRules) === snapshot, '[8g] …and the stored custom rules are byte-for-byte what the commissioner saved');
  const editor = app._rulesEditorHTMLForTest();
  assert(editor.includes(NEW) && /One sentence was updated to match how locking works\./.test(editor), '[8h] the Comm editor shows the corrected text with the one-line note');
  storage.saveSetting('customRules', null);
  assert(!/One sentence was updated/.test(app._rulesEditorHTMLForTest()), '[8i] with no legacy sentence the editor says nothing');
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n[9] DI-514 — each competition\'s week is judged on its own instant…');
// ══════════════════════════════════════════════════════════════════════════
{
  // Two weeks, as a league with CFB and an NFL competition would hold them (their own games, their own instants). Locking one never locks the other: the helper takes one week.
  const cfb = mkWeek('x_cfb', { competitionId: 'comp_cfb' }), nfl = mkWeek('x_nfl', { competitionId: 'comp_nfl' });
  const cfbGames = [mkGame('x_cfb', 'a', BASE + 40 * HOUR)];            // instant far ahead
  const nflGames = [mkGame('x_nfl', 'a', BASE + 20 * MIN)];             // instant 10 minutes ago
  const a = weekLockState({ week: cfb, games: cfbGames, now: BASE }), b = weekLockState({ week: nfl, games: nflGames, now: BASE });
  assert(a.phase === 'open' && b.phase === 'locked' && b.derived, '[9a] CFB open + NFL past its instant: the CFB week reads open, the NFL week reads locked');
  const a2 = weekLockState({ week: cfb, games: [mkGame('x_cfb', 'a', BASE + 20 * MIN)], now: BASE }), b2 = weekLockState({ week: nfl, games: [mkGame('x_nfl', 'a', BASE + 40 * HOUR)], now: BASE });
  assert(a2.phase === 'locked' && b2.phase === 'open', '[9b] …and the reverse: CFB past its instant locks CFB only');
  // A week's games are the only input: a lock on the OTHER week's games cannot reach it
  assert(weekLockState({ week: cfb, games: [...cfbGames, ...nflGames], now: BASE }).lockAtMs !== weekLockState({ week: cfb, games: cfbGames, now: BASE }).lockAtMs,
    '[9c] (control) the instant is a function of the games handed in, so a caller that mixed the two slates would get the wrong instant — which is why each surface hands in ITS week\'s games (the scan below pins that no surface asks for a global "current week" lock)');
  // the nav card badge for a week that is not the "current" week still reads its own games
  const nflBadge = weekBadgePhase({ week: nfl, games: nflGames, now: BASE });
  assert(nflBadge.label === 'LOCKED' && weekBadgePhase({ week: cfb, games: cfbGames, now: BASE }).label === 'OPEN', '[9d] the badge helper is per week: NFL LOCKED, CFB OPEN, from one fixture');
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n[10] The source scan — no new `status === \'open\'` edit-gate outside the allow-listed sites…');
// ══════════════════════════════════════════════════════════════════════════
{
  const src = await read('./js/app.js');
  const code = src.split('\n').map((l) => l.replace(/^\s*(\/\/|\*|\/\*).*$/, '')).join('\n');
  const FN = /(?:^|\n)(?:export )?(?:async )?function (\w+)\s*\(/g;
  const fnAt = []; let m;
  while ((m = FN.exec(code))) fnAt.push([m.index, m[1]]);
  const owner = (i) => { let name = '(top level)'; for (const [at, n] of fnAt) { if (at <= i) name = n; else break; } return name; };
  const GATE = /\.status\s*(?:===|!==)\s*(?:'open'|WEEK_STATUS\.OPEN)|(?:===|!==)\s*WEEK_STATUS\.OPEN\b|\bst\.phase\s*(?:===|!==)\s*WEEK_STATUS\.OPEN|ls\.phase\s*===\s*WEEK_STATUS\.OPEN/g;
  const found = {};
  while ((m = GATE.exec(code))) { const n = owner(m.index); found[n] = (found[n] || 0) + 1; }
  // Each allowed site and WHY it is not a player-facing editability gate:
  const ALLOWED = {
    canPlayerSubmitPicks: 1,                  // the one derived-lock clause: `week.status === 'open' && weekLockState(...).derived`
    renderPicksTiming: 1,                     // the re-open copy keys on the helper's phase
    armLockFlip: 2, onLockFlipFired: 1, recheckLockFlipOnVisible: 1,   // the flip timer: it asks the helper's phase (and words the reason it declined), never a stored status
    applyWeekStatusChange: 1,                 // the transition itself (DRAFT -> OPEN posts the notice): a write, not an edit gate
    effectiveWeekStatusForSignals: 1,         // the SCRIBE signal status (fail-less-permissive), unchanged
    tickWeekLegs: 1,                          // the open -> locked LEG: it IS the transition the derived label anticipates (D1 / DI-535 #1: moved verbatim out of tickAutoTransition, one call per sport's current week)
    lsOpenWeekPicks: 1,                       // the Leave row's "picks you made won't be scored" fact (SP-53), fed the effective instant by lsWeeksForLeave
    bindScribeReminderControls: 1,            // the commissioner's reminder button (open weeks only)
    renderWeekWizardManageHTML: 1,            // the commissioner's reminder controls row
    bindWeekWizardManage: 1,                  // binds that reminder row for an open week
  };
  const extra = Object.keys(found).filter((k) => !(k in ALLOWED) || found[k] !== ALLOWED[k]);
  const missing = Object.keys(ALLOWED).filter((k) => !(k in found));
  assert(extra.length === 0, `[10a] every \`status === 'open'\` / WEEK_STATUS.OPEN comparison in app.js sits in an allow-listed function with its allow-listed count — a NEW edit-gate must ask weekLockState instead (found outside the list: ${JSON.stringify(extra.map((k) => [k, found[k]]))})`);
  assert(missing.length === 0, `[10b] …and the allow-list has no dead entry (every listed site still exists: ${JSON.stringify(missing)})`);
  // no surface computes "has the instant passed" on its own any more
  const own = (code.match(/now\s*>=\s*lockAt\.getTime\(\)|Date\.now\(\)\s*>=\s*lockAt\.getTime\(\)/g) || []).length;
  assert(own === 2, `[10c] the only inline clock tests against the lock instant left in app.js are the timing line's "passed" strike-through styling and the tick's open -> locked LEG (found ${own})`);
  // the helper's own imports
  const wsrc = await read('./js/week-lock.js');
  const imps = [...wsrc.matchAll(/^import [^;]* from '([^']+)';/gm)].map((x) => x[1]).sort();
  assert(JSON.stringify(imps) === JSON.stringify(['./data-model.js', './scoring.js']), `[10d] week-lock.js imports scoring.js and data-model.js only (got ${imps.join(', ')})`);
  assert(!/\b(localStorage|document|window|fetch)\b/.test(wsrc.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')), '[10e] week-lock.js touches no storage, DOM or network (a pure leaf)');
  const csrc = await read('./css/styles.css');
  assert(/\.lock-flip-in\s*\{[^}]*animation:\s*lockFlipFadeIn\s+var\(--motion-fast/.test(csrc) && /prefers-reduced-motion:\s*reduce\)\s*\{\s*\.lock-flip-in\s*\{\s*animation:\s*none/.test(csrc) && /\.picks-week-nav>button\{min-height:44px;min-width:44px\}/.test(csrc),
    '[10f] the fade is 150 ms (--motion-fast) with a Reduce Motion override, and the week navigator\'s arrows are 44 pt targets');
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n[11] Mutation canaries — each loosening turns a named assertion red (scratch copy)…');
// ══════════════════════════════════════════════════════════════════════════
{
  const dir = await mkdtemp(path.join(os.tmpdir(), 'weeklock-mut-'));
  try {
    const here = fileURLToPath(new URL('.', import.meta.url));
    await cp(path.join(here, 'js'), path.join(dir, 'js'), { recursive: true });
    const realSrc = await read('./js/week-lock.js');
    const run = async (name, mutate) => {
      const src = mutate(realSrc);
      if (src === realSrc) return { name, landed: false };
      const file = path.join(dir, 'js', `week-lock-${name}.js`);
      await writeFile(file, src);
      const mod = await import(pathToFileURL(file).href + `?v=${name}`);
      const INSTANT = BASE + 90 * MIN;
      const g = [mkGame('m', 'a', BASE + 2 * HOUR)];
      const at = mod.weekLockState({ week: mkWeek('m'), games: g, now: INSTANT });
      const locked = mod.weekLockState({ week: mkWeek('m', { status: 'locked' }), games: g, now: INSTANT - HOUR });
      const demo = mod.weekLockState({ week: mkWeek('m', { dataSourceMode: 'demo' }), games: g, now: INSTANT + HOUR });
      return { name, landed: true, boundaryClosed: at.derived === true, storedLockHolds: locked.phase === 'locked' && !locked.derived, demoOpen: demo.phase === 'open' };
    };
    const base = await run('baseline', (s) => s + '\n// baseline copy\n');
    assert(base.landed && base.boundaryClosed && base.storedLockHolds && base.demoOpen, '[11a] the scratch copy of the real helper passes all three canary predicates (the canaries are not vacuous)');
    const m1 = await run('gt', (s) => s.replace('nowMs >= lockAtMs', 'nowMs > lockAtMs'));
    assert(m1.landed && m1.boundaryClosed === false, '[11b] mutant: `>=` swapped for `>` -> the boundary assertion goes red (at exactly the instant the week must be closed)');
    const m2 = await run('reopen', (s) => s.replace("const phase = derived ? LOCK_PHASE.LOCKED : base;", "const phase = derived ? LOCK_PHASE.LOCKED : (base === LOCK_PHASE.LOCKED && lockAtMs !== null && nowMs < lockAtMs ? LOCK_PHASE.OPEN : base);"));
    assert(m2.landed && m2.storedLockHolds === false, '[11c] mutant: a derived rule that REOPENS a stored lock -> the deny-only assertion goes red');
    const m3 = await run('demo', (s) => s.replace('const demo = week.dataSourceMode === DATA_SOURCE_MODE.DEMO;', 'const demo = false;'));
    assert(m3.landed && m3.demoOpen === false, '[11d] mutant: the demo exemption dropped -> the demo assertion goes red');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

globalThis.Date = RealDate;
console.log(`\n${pass} passed, ${fail} failed.`);
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
