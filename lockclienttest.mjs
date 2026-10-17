/**
 * CFB Pickems — lockclienttest.mjs (PF-1 / UN-410, UN-411 / DI-494, DI-495, DI-496 and Amendment 1 / A1.1, 2026-10-01)
 * ====================================================================================================================
 * The CLIENT half of "the server locks the week": what a device does when the week locks under it, and the commissioner's late-entry power. (The SQL half is migration 0043, pinned by
 * supabase/tests/static.check.mjs and, on a real database, rls.test.mjs S43.* — which Drew runs. The three copies of the lock-instant formula are pinned by lockinstanttest.mjs.)
 *
 *   [1] canPlayerSubmitPicks closes at the server's instant (DI-495a): the matrix, the boundary, demo, no instant, every other status unchanged, the existing sentence.
 *   [2] The refusal banner (DI-495c): the lock copy for an all-pick-and-guess refusal on a closed week; Dismiss only; role="alert"; it stays through 'synced'; every other refusal keeps today's copy.
 *   [3] The commissioner's "spread not frozen" notice for a week the SERVER locked (DI-496): commissioner only, once per week, escaped by the sink, never for a player or a final week.
 *   [4] Late entry (Amendment 1): the pure decisions, the preview, the sheet (opened only after the instant, Cancel changes nothing, a bad time cannot be confirmed), the two-step write in the
 *       order that matters (picksLockAt FIRST, while locked; the re-open SECOND), and its failure paths putting the old value back.
 *   [5] The gesture registration of the sixth sheet, and the source pins for what a fake DOM cannot see.
 *
 * NOT covered here, and said so: the sheet's look, the swipe-down, haptics, VoiceOver and Reduce Motion on a real device (the on-device checklist), and the adapter's own race (adaptertest [A-RETRY9] (c)).
 * Run:  node lockclienttest.mjs     (also under TZ=UTC and TZ=America/Los_Angeles)
 */
import { readFile } from 'node:fs/promises';

// ── a fake DOM small enough to read: an id registry, recorded listeners, stored attributes, cached children per selector ──
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), clear: () => store.clear(),
};
const reg = new Map();
const docListeners = {};
function makeEl() {
  const children = new Map();
  const attrs = {};
  const listeners = {};
  const classes = new Set();
  const el = {
    _id: '', className: '', _html: '', textContent: '', value: '', disabled: false, hidden: false,
    style: { setProperty(k, v) { this[k] = v; } },
    get id() { return this._id; }, set id(v) { this._id = String(v); if (this._id) reg.set(this._id, this); },
    set innerHTML(v) { this._html = String(v); this._htmlWrites = (this._htmlWrites || 0) + 1; }, get innerHTML() { return this._html; },
    setAttribute(k, v) { attrs[k] = String(v); }, getAttribute(k) { return k in attrs ? attrs[k] : null; }, removeAttribute(k) { delete attrs[k]; },
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener(t, fn) { listeners[t] = (listeners[t] || []).filter((f) => f !== fn); },
    fire(t, e = {}) { for (const f of [...(listeners[t] || [])]) f({ target: el, preventDefault() {}, ...e }); },
    listenerCount(t) { return (listeners[t] || []).length; },
    appendChild(c) { if (c && c._id) reg.set(c._id, c); return c; },
    remove() { if (this._id && reg.get(this._id) === this) reg.delete(this._id); this._removed = true; },
    querySelector(sel) { if (!children.has(sel)) { const c = makeEl(); if (sel.startsWith('#')) c._id = sel.slice(1); children.set(sel, c); } return children.get(sel); },
    querySelectorAll: () => [],
    classList: { add(c) { classes.add(c); }, remove(c) { classes.delete(c); }, toggle(c, f) { if (f) classes.add(c); else classes.delete(c); }, contains: (c) => classes.has(c), [Symbol.iterator]() { return classes[Symbol.iterator](); } },
    focus() {}, getBoundingClientRect: () => ({ height: 400 }),
  };
  return el;
}
const toasts = [];
const toastContainer = makeEl();
toastContainer.appendChild = (t) => { toasts.push(t); return t; };
reg.set('toast-container', toastContainer);
globalThis.document = {
  hidden: false,
  addEventListener(t, fn) { (docListeners[t] = docListeners[t] || []).push(fn); }, removeEventListener(t, fn) { docListeners[t] = (docListeners[t] || []).filter((f) => f !== fn); },
  fireKey(key) { for (const f of [...(docListeners.keydown || [])]) f({ key, preventDefault() {} }); },
  getElementById: (id) => reg.get(id) || null, querySelector: () => null, querySelectorAll: () => [],
  createElement: () => makeEl(),
  body: { classList: { add() {}, remove() {}, toggle() {}, contains: () => false, [Symbol.iterator]() { return [][Symbol.iterator](); } }, appendChild(el) { if (el && el._id) reg.set(el._id, el); return el; }, dataset: {} },
  head: { appendChild: (el) => el }, title: '',
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, onLine: true }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined, onLine: true }, configurable: true }); }
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.fetch = async () => { throw new Error('network disabled in lockclienttest'); };
globalThis.matchMedia = (q) => ({ matches: /reduced-motion/.test(q) });          // Reduce Motion ON: the sheet's exit removes at once instead of waiting on a transition
globalThis.confirm = () => true; globalThis.prompt = () => null; globalThis.alert = () => {};
// D1 integration 18 (2026-10-08): submitPicks() ends with a 300 ms timer that repaints the Picks page and calls window.scrollTo (a browser API this stub lacked). [2t] / [2u] drive the real
// submit; alone the suite exits inside those 300 ms, but under load the timer fired first and the TypeError crashed the run (gate 5b-1, the UTC pass). The API is supplied, and the suite waits
// for that timer below, so the post-submit repaint runs in EVERY run, not only a slow one.
globalThis.scrollTo = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };

let pass = 0, fail = 0;
function assert(cond, label, detail = '') {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label, detail ? `— ${detail}` : ''); }
}
const read = (p) => readFile(new URL(p, import.meta.url), 'utf8');

const storage = await import('./js/storage.js');
const backend = await import('./js/backend.js');
const app = await import('./js/app.js');
const ww = await import('./js/week-wizard.js');
const nav = await import('./js/nav-gestures.js');
const cc = await import('./js/control-center.js');

const NOW = Date.now();
const MIN = 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const week = (weekId, over = {}) => ({ weekId, season: '2026', weekNumber: 7, label: 'Week 7', startDate: '2026-10-01', endDate: '2026-10-03', status: 'open', dataSourceMode: 'manual', picksOpenAt: null, picksLockAt: null, autoLockOffsetMinutes: 30, showInHistory: true, ...over });
const game = (gameId, weekId, kickoffMs, over = {}) => ({ gameId, weekId, homeTeam: `Home ${gameId}`, awayTeam: `Away ${gameId}`, kickoff: kickoffMs === null ? null : iso(kickoffMs), status: 'scheduled', spread: null, favorite: null, lockedSpread: null, ...over });
const setMode = (m) => backend.setDataMode(m);
const red = () => reg.get('backend-error-banner') || null;
const lastToast = () => toasts[toasts.length - 1] || null;

console.log(`[lockclienttest] TZ=${process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone} — ${Object.keys(app).length} app.js exports`);

// ══════════════════════════════════════════════════════════════════════════
console.log('\n[1] canPlayerSubmitPicks closes at the server\'s lock instant (DI-495a)…');
// ══════════════════════════════════════════════════════════════════════════
{
  const LOCKED = 'Week is locked — no new picks accepted.';
  const put = (w, games) => { storage.saveWeek(w); for (const g of games) storage.saveGame(g); return storage.getWeek(w.weekId); };
  const can = (w) => app.canPlayerSubmitPicks(w, 'pl1');
  // first kickoff 90 minutes ahead, offset 30 -> the instant is 60 minutes ahead
  const before = put(week('lc1_before'), [game('b1', 'lc1_before', NOW + 90 * MIN)]);
  assert(can(before).allowed === true, '[1a] an OPEN week BEFORE its derived instant accepts picks (unchanged)');
  // first kickoff 20 minutes ahead, offset 30 -> the instant was 10 minutes ago; the stored status is STILL open
  const after = put(week('lc1_after'), [game('a1', 'lc1_after', NOW + 20 * MIN), game('a2', 'lc1_after', NOW + 180 * MIN)]);
  assert(after.status === 'open' && can(after).allowed === false && can(after).reason === LOCKED, '[1b] an OPEN week AFTER its derived instant is closed with the EXISTING sentence, although its stored status is still open (the server refuses the same writes)');
  const atBoundary = put(week('lc1_edge', { autoLockOffsetMinutes: 0 }), [game('e1', 'lc1_edge', NOW - 1)]);
  assert(can(atBoundary).allowed === false, '[1c] the boundary is CLOSED (now >= instant): offset 0 with the kickoff one millisecond ago');
  {
    // THE EXACT BOUNDARY, with the clock pinned: at now == instant the week is closed, one millisecond earlier it is open (the server's `now() <` and this `now >= instant`)
    const K0 = NOW + 7 * 60 * MIN;
    const exact = put(week('lc1_exact', { autoLockOffsetMinutes: 0 }), [game('x0', 'lc1_exact', K0)]);
    const realNow = Date.now;
    try {
      Date.now = () => K0 - 1; const justBefore = can(exact).allowed;
      Date.now = () => K0; const atInstant = can(exact).allowed;
      Date.now = () => K0 + 1; const justAfter = can(exact).allowed;
      assert(justBefore === true && atInstant === false && justAfter === false, '[1c2] with the clock pinned: one millisecond BEFORE the instant open, EXACTLY AT it closed, after it closed (the same boundary as the server)', JSON.stringify({ justBefore, atInstant, justAfter }));
    } finally { Date.now = realNow; }
  }
  const demo = put(week('lc1_demo', { dataSourceMode: 'demo' }), [game('d1', 'lc1_demo', NOW - 3 * 60 * MIN)]);
  assert(can(demo).allowed === true, '[1d] a DEMO week stays open after its kickoff (demo weeks are exempt on the server and here)');
  assert(can(put(week('lc1_none'), [])).allowed === true && can(put(week('lc1_nulls'), [game('n1', 'lc1_nulls', null)])).allowed === true, '[1e] no dated game: no instant, so the client does not close it either (the server\'s NULL = not closed)');
  const explicitLater = put(week('lc1_later', { picksLockAt: iso(NOW + 40 * MIN) }), [game('l1', 'lc1_later', NOW - 60 * MIN)]);
  assert(can(explicitLater).allowed === true, '[1f] AMENDMENT 1: an explicit picksLockAt LATER than the derived instant keeps the week open although every kickoff has passed (the commissioner\'s chosen time)');
  const explicitEarlier = put(week('lc1_earlier', { picksLockAt: iso(NOW - MIN) }), [game('x1', 'lc1_earlier', NOW + 180 * MIN)]);
  assert(can(explicitEarlier).allowed === false, '[1g] an explicit picksLockAt in the past closes the week (getEffectiveWeekStatus, unchanged)');
  for (const [status, reason] of [['draft', "Commissioner hasn't opened the week yet."], ['locked', LOCKED], ['live', 'Games are in progress — picks closed.'], ['final', 'Week is finalized.']]) {
    const w = put(week(`lc1_${status}`, { status }), [game(`s_${status}`, `lc1_${status}`, NOW + 180 * MIN)]);
    assert(can(w).allowed === false && can(w).reason === reason, `[1h] a ${status} week is denied with its own existing sentence, unchanged`);
  }
  assert(app.canPlayerSubmitPicks(null, 'pl1').allowed === false && app.canPlayerSubmitPicks(before, null).allowed === false, '[1i] no week, or not signed in: denied (unchanged)');
  // the blind-rule invariant (loadtest [34g]): the added clause only ever DENIES, so you can never submit and see another's picks at once
  assert(['lc1_before', 'lc1_after', 'lc1_edge', 'lc1_demo', 'lc1_later', 'lc1_earlier'].every((id) => !(can(storage.getWeek(id)).allowed && app.canViewOtherPicks(storage.getWeek(id)))), '[1j] the invariant holds across all of them: no week lets a player submit AND see others\' picks');
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n[2] The refusal banner — "This week is locked." (DI-495c)…');
// ══════════════════════════════════════════════════════════════════════════
{
  const LOCK_KEYS = ['cfbp_picks', 'cfbp_tiebreaker_guesses', 'cfbp_extra_point_guesses'];
  // pure rule first
  const w = (status, over = {}) => week('lc2', { status, ...over });
  const closedGames = [game('c1', 'lc2', NOW + 20 * MIN)];                      // instant = 10 minutes ago
  const openGames = [game('o1', 'lc2', NOW + 120 * MIN)];
  const rule = (keys, wk, games) => app.isLockRefusal({ keys, week: wk, games, now: NOW });
  assert(rule(['cfbp_picks'], w('open'), closedGames) === true && rule(LOCK_KEYS, w('open'), closedGames) === true, '[2a] every refused key among the three pick/guess keys + a window the client\'s own check says closed -> a lock refusal');
  assert(rule(['cfbp_picks'], w('open'), openGames) === false, '[2b] …but NOT while the client\'s own check says the window is still open (a refusal for another reason keeps today\'s copy)');
  assert(rule(['cfbp_picks', 'cfbp_weeks'], w('open'), closedGames) === false && rule(['cfbp_feedback'], w('open'), closedGames) === false && rule([], w('open'), closedGames) === false && rule(undefined, w('open'), closedGames) === false,
    '[2c] ONE other key in the run (or none, or no list) defeats it: the default copy is the one that is true for every key');
  assert(rule(['cfbp_picks'], w('locked'), openGames) === true && rule(['cfbp_picks'], w('live'), openGames) === true && rule(['cfbp_picks'], w('final'), openGames) === true, '[2d] a stored locked / live / final week is a closed window');
  assert(rule(['cfbp_picks'], w('draft'), closedGames) === false && rule(['cfbp_picks'], w('open', { dataSourceMode: 'demo' }), closedGames) === false && rule(['cfbp_picks'], null, closedGames) === false, '[2e] a draft week, a DEMO week and no week are not lock refusals');
  assert(rule(['cfbp_picks'], w('open', { picksLockAt: iso(NOW - MIN) }), openGames) === true && rule(['cfbp_picks'], w('open'), []) === false, '[2f] an explicit picksLockAt in the past closes it; no instant (no games) does not');

  // the renderer, driven with the detail the adapter really emits (adaptertest pins the field names)
  setMode('supabase');
  const cur = week('lc2_cur');
  storage.saveWeek(cur); storage.saveGame(game('cg1', 'lc2_cur', NOW + 20 * MIN)); storage.setActiveWeekId('lc2_cur');
  const detail = (keys, extra = {}) => ({ state: 'ACTIVE', key: keys[0], keys, code: '42501', banner: `The server refused to save ${keys.join(', ')}: new row violates row-level security policy. Nothing was saved.`, ...extra });
  app._onSupabaseDataStatusForTest('refused', detail(['cfbp_picks', 'cfbp_tiebreaker_guesses']));
  let html = red() ? red().innerHTML : '';
  assert(/This week is locked\./.test(html) && /Your last change was not saved\./.test(html) && /Picks and guesses close when the week locks\./.test(html), '[2g] a refused picks + tiebreaker-guess run on a closed week shows the three calm lines', html);
  assert(!/Cross-device sync is OFF/.test(html) && !/new row violates|row-level security|cfbp_/.test(html) && !/Tell the commissioner/.test(html), '[2h] …and NONE of the technical text: no storage key, no server message, no "sync is OFF"');
  assert(/id="beb-close-btn"/.test(html) && !/beb-retry/.test(html) && !/Retry/.test(html), '[2i] …with Dismiss only: no Retry (a hydrate would "succeed" and announce "Connection restored" about a thing that never disconnected)');
  assert(red().getAttribute('role') === 'alert' && red().getAttribute('data-notice') === 'lock-closed', '[2j] …the node announces itself (role="alert", the touched-screen audit fix) and is tagged as the lock notice');
  assert(red()._htmlWrites === 1, '[2k] …rendered ONCE: one banner write, i.e. ONE role="alert" insertion (every re-render is a fresh announcement for VoiceOver)');
  app._onSupabaseDataStatusForTest('refused', detail(['cfbp_extra_point_guesses']));
  assert(red()._htmlWrites === 1 && /This week is locked\./.test(red().innerHTML), '[2l] a second lock refusal while the notice is UP does not re-render it (reviewer B1: no second insertion, no second announcement)');
  app._onSupabaseDataStatusForTest('synced', { state: 'ACTIVE', pushed: 1, pendingWrites: 0 });
  assert(!!red() && red().style.display !== 'none' && /This week is locked\./.test(red().innerHTML), '[2m] the notice STAYS UP through the follow-up run\'s "synced" (a correction already made, like the status-moved notice)');
  // PF-416 follow-up, item 5 (thread 100726-D1, 2026-10-07) — the lock notice is NOT "sync is off". It rides the red banner's node under owner 'app', and
  // isSyncFailureBannerUp() read every visible 'app' banner as a sync failure: with it up, a feedback refusal toasted "Try again once sync is back on."
  // (sync was never off), the layout save toasted "Sync is off." and the pick submit asked "Cross-device sync is currently OFF … Submit anyway?".
  {
    const before = toasts.length;
    app._onSupabaseDataStatusForTest('refused', detail(['cfbp_feedback'], { code: 'P0001', banner: 'The server refused to save cfbp_feedback: rate_limited. Nothing was saved.' }));
    const t = toasts.length > before ? lastToast().innerHTML : '';
    assert(app._isSyncFailureBannerUpForTest() === false && /This week is locked\./.test(red().innerHTML) && red().getAttribute('data-notice') === 'lock-closed',
      'PF-416 [2m2] with the lock notice up, isSyncFailureBannerUp() is FALSE, and a feedback refusal leaves the notice in place (B8: a non-app owner never replaces it)');
    assert(/^Your feedback was not saved\./.test(t) && !/sync/i.test(t),
      `PF-416 [2m3] …its toast says the feedback was not saved and never blames sync, which is on (got ${JSON.stringify(t)})`);
  }
  // every other refusal keeps today's copy — and replaces the notice
  app._onSupabaseDataStatusForTest('refused', detail(['cfbp_picks', 'cfbp_weeks']));
  html = red().innerHTML;
  assert(/Cross-device sync is OFF on this device\./.test(html) && /beb-retry/.test(html) && !/This week is locked/.test(html) && red().getAttribute('data-notice') === '', '[2n] a refusal that also names an unrelated key keeps the DEFAULT banner (Retry back, notice tag reset)');
  app._onSupabaseDataStatusForTest('synced', { state: 'ACTIVE', pushed: 1, pendingWrites: 0 });
  assert(!red() || red().style.display === 'none', '[2o] …and an ordinary refusal still comes down on "synced" — only the two notices are sticky');
  app._onSupabaseDataStatusForTest('refused', detail(['cfbp_picks'], { code: 'PGRST301' }));
  assert(/Cross-device sync is OFF/.test(red().innerHTML) && !/This week is locked/.test(red().innerHTML), '[2p] only a 42501 refusal can be a lock refusal (a session problem on a pick write keeps the default copy)');
  storage.saveWeek({ ...cur, picksLockAt: null }); storage.saveGame(game('cg1', 'lc2_cur', NOW + 180 * MIN));   // the window is OPEN again as far as this device can tell
  app._onSupabaseDataStatusForTest('refused', detail(['cfbp_picks']));
  assert(/Cross-device sync is OFF/.test(red().innerHTML) && !/This week is locked/.test(red().innerHTML), '[2q] a pick refusal while this device\'s own check says the window is OPEN (e.g. a paused league) keeps the default copy');
  app._onSupabaseDataStatusForTest('synced', { state: 'ACTIVE', pushed: 1, pendingWrites: 0 });
  // the banner itself is escaped
  app._onSupabaseDataStatusForTest('refused', detail(['cfbp_feedback'], { banner: 'The server refused to save cfbp_feedback: <img src=x onerror=alert(1)>. Nothing was saved.' }));
  assert(!/<img/i.test(red().innerHTML) && /&lt;img/.test(red().innerHTML), '[2r] server text in the default banner is escaped (xsstest\'s rule, unchanged)');
  app._onSupabaseDataStatusForTest('synced', { state: 'ACTIVE', pushed: 1, pendingWrites: 0 });
  setMode('sheets');
}

// ── the REAL adapter over a fake PostgREST, wired to the app's real status handler, for the sections that must land real hydrates and real flushes (B1's [2s], N1's [4zz]) ──
const world = await (async () => {
  const auth = await import('./js/auth.js');
  const sbm = await import('./js/supabase-backend.js');
  const quiet = async (fn) => {
    const rl = console.log, rw = console.warn, ri = console.info, re = console.error;
    console.log = () => {}; console.warn = () => {}; console.info = () => {}; console.error = () => {};
    try { return await fn(); } finally { console.log = rl; console.warn = rw; console.info = ri; console.error = re; }
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  /** A PostgREST-shaped fake: reads return `rows[table]`; a picks write is refused with 42501 while `ctl.refuse`; a weeks write answers `ctl.weeksWrite` ('ok' | 'transient'); every write and rpc is recorded in `ctl.calls`. */
  const makeClient = (rows, ctl) => {
    ctl.calls = ctl.calls || [];
    return {
      from(table) {
        const b = { _op: 'select', _rows: null, _patch: null, _eq: {} };
        for (const m of ['select', 'order', 'limit', 'gt', 'range', 'in']) b[m] = function () { return this; };
        b.eq = function (col, val) { b._eq[col] = val; return b; };
        b.insert = (r) => { b._op = 'insert'; b._rows = r; return b; };
        b.update = (patch) => { b._op = 'update'; b._patch = patch; return b; };
        b.delete = () => { b._op = 'delete'; return b; };
        b.then = (res) => {
          if (b._op === 'select') { const data = rows[table] || []; return res({ data, error: null, count: data.length }); }
          ctl.calls.push({ table, op: b._op, patch: b._patch, rows: b._rows });
          if (table === 'picks') ctl.picksSends += 1;
          // D1 third pass (item 1): GUARD MODE models 0043's player-facing lock for picks (P-7: a fake that models a guard models its whole body). One INSERT statement is refused as a WHOLE when any row it
          // carries is in a closed week (an RLS / trigger failure aborts the statement); an UPDATE is refused when the row it targets is in a closed week; an accepted write PERSISTS in rows.picks, so a reopened
          // app reads back exactly what the server took. `ctl.closedWeeks` (a Set of week ids) turns it on; `ctl.refuse` (refuse everything) is unchanged for the sections that use it.
          if (table === 'picks' && ctl.closedWeeks instanceof Set) {
            const refuse = () => res({ data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "picks"' } });
            rows.picks = rows.picks || [];
            if (b._op === 'insert') {
              const list = Array.isArray(b._rows) ? b._rows : [b._rows];
              if (list.some((r) => ctl.closedWeeks.has(r.week_id))) return refuse();
              for (const r of list) { const i = rows.picks.findIndex((x) => x.id === r.id); if (i >= 0) rows.picks[i] = { ...r }; else rows.picks.push({ ...r }); }
              return res({ data: list, error: null });
            }
            if (b._op === 'update') {
              const cur = rows.picks.find((r) => r.id === b._eq.id);
              if (!cur || ctl.closedWeeks.has(cur.week_id)) return refuse();
              Object.assign(cur, b._patch || {});
              return res({ data: [{ ...cur }], error: null });
            }
          }
          if (table === 'picks' && ctl.refuse) return res({ data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "picks"' } });
          if (table === 'picks' && ctl.picksWrite === 'transient') return res({ data: null, status: 503, error: { code: '', message: 'upstream timeout', status: 503 } });
          if (table === 'weeks' && ctl.weeksWrite === 'transient') return res({ data: null, status: 503, error: { code: '', message: 'upstream timeout', status: 503 } });
          if (b._op === 'update') { const cur = (rows[table] || []).find((r) => r.id === b._eq.id) || {}; Object.assign(cur, b._patch || {}); return res({ data: [{ ...cur }], error: null }); }
          return res({ data: b._rows || [], error: null });
        };
        return b;
      },
      rpc: async (name, args) => { ctl.calls.push({ rpc: name, args }); return { data: [], error: null }; },
    };
  };
  const standUp = async ({ L, rows, ctl, role, userId, memberId }) => {
    const client = makeClient(rows, ctl);
    await quiet(() => sbm._resetForTest());
    app._resetSupabaseDataForTest();
    setMode('supabase');
    auth.configureAuth({ authMode: 'supabase', dataMode: 'supabase', supabaseUrl: 'https://p.test', supabaseAnonKey: 'anon-key', authModeKnown: true });   // app.js's isSupabaseDataMode() reads auth's own config
    sbm.init({
      register: auth.registerSupabaseDataBackend, getClient: () => client, getActiveLeagueId: auth.getActiveLeagueId, getIdentityEpoch: auth.getIdentityEpoch, getAccountUserId: auth.getAccountUserId,
      getDeviceDataOwnerTuple: auth.getDeviceDataOwnerTuple, getDeviceDataOwner: auth.getDeviceDataOwner, getSession: () => ({ isAdmin: role === 'commissioner', playerId: memberId }),
      hasValidSupabaseSession: auth.hasValidSupabaseSession, isPrivilegeHeld: auth.isPrivilegeHeld, hasSheetMirror: auth.hasSheetMirrorOnDevice, isSiteUnlocked: storage.isSiteUnlocked,
    });
    const detach = sbm.onStatus(app._onSupabaseDataStatusForTest);   // wireSupabaseAdapter() registers this same function
    auth._setStoredSessionForTest({ access_token: 't', expires_at: Math.floor(Date.now() / 1000) + 3600 });
    await quiet(async () => {
      auth._fireAuthEventForTest('SIGNED_IN', { access_token: 't', user: { id: userId, email: `${userId}@test` } });
      auth._setMembershipsForTest([{ leagueId: L, memberId, role, displayName: 'Me', leagueName: 'IRB' }]);
      auth.setActiveLeagueId(L);
    });
    const landed = await quiet(() => app._ensureSupabaseDataHydratedForTest('boot'));
    return { landed, detach };
  };
  const tearDown = async (detach) => {
    detach();
    await quiet(() => sbm._resetForTest());
    app._resetSupabaseDataForTest();
    auth._setStoredSessionForTest(null);
    auth._resetSupabaseDataBackendForTest();                 // the adapter registered its probe with auth.js; later sections must see the storage seam as it was
    storage.setBackendMode('local');                         // afterSupabaseHydrate() put the storage seam into 'supabase' mode; the sections below write through the local arm
    auth.configureAuth({ authMode: 'pins', dataMode: 'sheets', authModeKnown: true });
    setMode('sheets');
  };
  return { auth, sbm, quiet, sleep, standUp, tearDown };
})();

// ══════════════════════════════════════════════════════════════════════════
console.log('\n[2s] Reviewer BLOCK #1 B1 — the notice through a hydrate that ACTUALLY LANDS (the real adapter, the real status handler, the real afterSupabaseHydrate)…');
// ══════════════════════════════════════════════════════════════════════════
// [2k] used to assert only that a re-read had STARTED. The defect was in what a landed hydrate does: afterSupabaseHydrate() hid the banner unconditionally, the adapter's rebase re-applied the
// still-dirty refused edit and armed a push, the latch only holds within one hydrate sequence, so the edit was re-sent, re-refused, and the banner came back — a flash and a second announcement.
// So this section stands up the real adapter over a fake PostgREST that REFUSES a picks write the way 0043's guard does (42501), wires the app's real status handler to it, lands real hydrates
// through app.js's ensureSupabaseDataHydrated(), and counts what happened: hydrates, sends, banner writes (each a role="alert" insertion).
{
  const { auth, sbm, standUp, tearDown, quiet, sleep } = world;
  const L = 'L-lock2s';
  const T0 = Date.now();
  const rows = {
    league_members: [{ league_id: L, id: 'p2', user_id: 'u-kev', role: 'player', display_name: 'Kevin', initials: 'KV', alma_mater: '', active: true, notify_prefs: {}, preferences: {}, extra: {} }],
    weeks: [{ league_id: L, id: 'w2s', sport: 'cfb', season: '2026', week_number: 7, label: 'Week 7', status: 'open', picks_lock_at: null, auto_lock_offset_minutes: 30, revealed_at: null, locked_at: null, locked_alma_maters: null, pending_finalization: false, extra: {} }],
    // first kickoff in 20 minutes with a 30-minute offset: the lock instant was 10 minutes ago, so this device's OWN check says the window has closed
    games: [{ league_id: L, id: 'g2s', week_id: 'w2s', home_team: 'Home g2s', away_team: 'Away g2s', status: 'scheduled', kickoff: iso(T0 + 20 * MIN), spread: -3.5, favorite: 'Home g2s', multiplier: 1, home_score: 0, away_score: 0, last_updated: null, ats_winner: null, extra: {} }],
  };
  const ctl = { picksSends: 0, refuse: true };
  const { landed, detach } = await standUp({ L, rows, ctl, role: 'player', userId: 'u-kev', memberId: 'p2' });
  assert(landed === true && sbm.getState() === 'ACTIVE' && storage.getWeek('w2s')?.status === 'open', `[2s-0] fixture: the REAL adapter hydrated through app.js and serves an OPEN week (landed=${landed}, state=${sbm.getState()})`);
  assert(app.canPlayerSubmitPicks && storage.getGames('w2s').length === 1, '[2s-0] …with its one game, whose lock instant (kickoff - 30 min) is already 10 minutes past on this device\'s own check');
  const sentEdit = () => storage.saveAllPicks([{ pickId: 'pk_2s', weekId: 'w2s', gameId: 'g2s', playerId: 'p2', selectedTeam: 'Home g2s', selectedAt: iso(Date.now()), updatedAt: iso(Date.now()), locked: false, result: 'pending' }]);
  const writes = () => (red() ? red()._htmlWrites || 0 : 0);
  const shown = () => !!red() && red().style.display !== 'none';

  // ── the reviewer's EXACT sequence, step 1: a lock refusal ──
  const seq0 = sbm._hydrateSeqForTest();
  const base = writes();                                   // the banner node is shared with the sections above: count from here
  const inserted = () => writes() - base;
  sentEdit();
  await quiet(() => sbm.flush());
  assert(sbm._refusedKeysForTest().includes('cfbp_picks') && sbm._dirtyKeysForTest().includes('cfbp_picks'), '[2s-1] fixture: the server REFUSED the pick (42501) and the key is latched and still dirty — the state the defect lived in');
  assert(shown() && /This week is locked\./.test(red().innerHTML) && red().getAttribute('role') === 'alert' && red().getAttribute('data-notice') === 'lock-closed', '[2s-1] the lock notice is up through the REAL handler (role=alert, tagged)');
  const sendsAfterRefusal = ctl.picksSends;
  const writesAfterRefusal = inserted();
  assert(writesAfterRefusal === 1, `[2s-1] …written ONCE (one role=alert insertion; got ${writesAfterRefusal})`);

  // step 2: wait out the adapter's 800 ms push debounce. The OLD code had started a hydrate from the handler; it landed, re-applied the edit, re-armed the push, and 800 ms later re-sent it.
  await sleep(1150);
  assert(sbm._hydrateSeqForTest() === seq0, `[2s-2] the refusal started NO hydrate (hydrate sequence ${seq0} -> ${sbm._hydrateSeqForTest()}): the screen is repainted, not re-read`);
  assert(ctl.picksSends === sendsAfterRefusal, `[2s-2] …so the refused edit was NOT re-sent (sends ${sendsAfterRefusal} -> ${ctl.picksSends}) — the latch holds within the hydrate sequence it was set in`);
  assert(shown() && inserted() === writesAfterRefusal, `[2s-2] …and the notice neither flashed nor re-rendered (still up, ${inserted()} write(s))`);

  // the adapter's SECOND refused shape: any later flush while the key is latched emits 'refused' with no code and keys:[] — it must neither replace the notice nor re-render it
  const emitted = [];
  const off = sbm.onStatus((st, d) => { if (st === 'refused') emitted.push(d); });
  await quiet(() => sbm.flush());
  off();
  assert(emitted.length === 1 && !emitted[0].code && emitted[0].keys.length === 0 && emitted[0].refusedKeys.includes('cfbp_picks'), `[2s-3] fixture: a later flush re-emits 'refused' in the adapter's "still latched" shape (${JSON.stringify(emitted.map((d) => ({ code: d.code, keys: d.keys, refusedKeys: d.refusedKeys })))})`);
  assert(shown() && /This week is locked\./.test(red().innerHTML) && !/Cross-device sync is OFF/.test(red().innerHTML) && inserted() === writesAfterRefusal, '[2s-3] …the standing notice is NOT downgraded to "Cross-device sync is OFF" and is not re-rendered');

  // step 3: a hydrate that lands for an INDEPENDENT reason (resume, back online)
  const seq1 = sbm._hydrateSeqForTest();
  const landed2 = await quiet(() => app._ensureSupabaseDataHydratedForTest('visible'));
  assert(landed2 === true && sbm._hydrateSeqForTest() === seq1 + 1, `[2s-4] fixture: a SECOND hydrate really landed through afterSupabaseHydrate (seq ${seq1} -> ${sbm._hydrateSeqForTest()})`);
  assert(shown() && /This week is locked\./.test(red().innerHTML) && inserted() === writesAfterRefusal, `[2s-4] THE DEFECT: the notice STAYS UP through the landed hydrate — afterSupabaseHydrate() no longer hides it (shown=${shown()}, writes=${inserted()})`);
  await sleep(1150);
  const sendsAfterHydrate = ctl.picksSends;
  assert(sendsAfterHydrate === sendsAfterRefusal + 1, `[2s-5] the adapter's own §5.2 rule is unchanged: ONE re-send per landed hydrate (sends ${sendsAfterRefusal} -> ${sendsAfterHydrate}) — it is refused again`);
  assert(shown() && inserted() === writesAfterRefusal && /This week is locked\./.test(red().innerHTML), `[2s-5] …and that second refusal changes NOTHING on screen: the same node, one role=alert insertion in total (writes=${inserted()})`);
  await sleep(1150);
  assert(ctl.picksSends === sendsAfterHydrate, `[2s-5] …and it does not loop: no further sends without a further hydrate (${ctl.picksSends})`);

  // dismissed: a NEW refusal is a new event, and it is the lock copy again (never the technical default)
  red().style.display = 'none';                            // what the Dismiss button does (the fake DOM does not parse the banner's innerHTML into real buttons)
  assert(!shown(), '[2s-6] fixture: the notice is dismissed');
  await quiet(() => sbm.flush());
  assert(shown() && /This week is locked\./.test(red().innerHTML) && !/Cross-device sync is OFF/.test(red().innerHTML) && inserted() === writesAfterRefusal + 1,
    `[2s-6] after Dismiss a later still-latched emit raises the LOCK copy again, once (never "Cross-device sync is OFF"; writes=${inserted()})`);

  // an independent hydrate does not hide an UNRELATED banner: only the lock notice is exempt
  app._onSupabaseDataStatusForTest('refused', { state: 'ACTIVE', key: 'cfbp_weeks', keys: ['cfbp_weeks'], code: '42501', banner: 'The server refused to save cfbp_weeks: x. Nothing was saved.' });
  assert(shown() && /Cross-device sync is OFF/.test(red().innerHTML) && red().getAttribute('data-notice') === '', '[2s-7] fixture: an unrelated refusal replaces the lock notice with the default banner');
  ctl.refuse = false;
  await quiet(() => app._ensureSupabaseDataHydratedForTest('visible'));
  assert(!shown(), '[2s-7] …and a landed hydrate hides THAT one exactly as before — the exemption is for the lock notice alone');

  await tearDown(detach);
}

/**
 * D1 third pass (item 1) — THE HELD-REFUSAL WORDS, checked against what the adapter really does. What Submit KNOWS: an earlier pick / guess write is latched refused and still queued. What it CANNOT
 * know: whether these picks will be refused with it — [2t] (held insert + new insert: one statement, refused whole, gone after a reopen) and [2u] (every other pairing: they reach the server). And a reopen
 * keeps NOTHING unsaved ([2t-6]). So the words may promise neither a save on this device, nor a wait for a reopen, nor that the picks were definitely not sent; they say the picks MAY not have been sent
 * and name the one action that always works: reopen the app, then make any missing picks again ([2t-7]). Returns the broken rules, per surface (empty = the copy is right).
 */
function heldCopyCheck(question, toast) {
  const common = (s) => [
    /saved on (this|THIS) device|saved locally/i.test(s) && 'promises a save on this device (a reopen keeps nothing unsaved)',
    /until you reopen/i.test(s) && 'promises the picks wait for a reopen (a reopen drops them)',
    /\b(were not|weren.t|won.t be|will not be|have not been|haven.t been|are not|aren.t) sent\b/i.test(s) && 'says categorically the picks were not sent ([2u]: they often are)',
    /by the server/.test(s) && 'says "by the server"',
    /Cross-device sync/i.test(s) && 'says sync is off (it is not)',
    /✅/.test(s) && 'carries a check mark',
    !/reopen the app/i.test(s) && 'does not name reopening the app',
  ].filter(Boolean);
  return {
    confirm: [...common(question), !/couldn.t be saved/.test(question) && 'does not say the earlier change could not be saved', !/stop these picks from being sent/.test(question) && 'does not say it can stop these picks being sent', !/make these picks again/i.test(question) && 'does not say to make these picks again'].filter(Boolean),
    toast: [...common(toast), !/may not have been sent/i.test(toast) && 'does not say the picks may not have been sent', !/make any missing picks again/i.test(toast) && 'does not say to make any missing picks again', /Picks submitted|Good luck|Picks updated/.test(toast) && 'claims success'].filter(Boolean),
  };
}
/** A native shell with a recording Haptics plugin, installed only around a Submit (isNativeShell() reads window.Capacitor). */
const heldHaptics = {
  install() { const fired = []; globalThis.Capacitor = { isNativePlatform: () => true, Plugins: { Haptics: { impact: (o) => fired.push(o) } } }; return fired; },
  remove() { delete globalThis.Capacitor; },
};

// ══════════════════════════════════════════════════════════════════════════
console.log('\n[2t] N3 - a lock refusal is judged by the weeks of the REFUSED rows; a later pick for another sport\'s open week is not swallowed, and Submit does not claim a sync it does not have…');
// ══════════════════════════════════════════════════════════════════════════
// The sequence: a pick for a CLOSED week is refused (42501) and stays queued in cfbp_picks, the lock notice goes up. The member then picks for ANOTHER sport's OPEN week. That row is written to the
// same key, planned with the refused one, and refused with it. lockRefusalApplies() used to ask getCurrentWeek() ("closed?") and so read the second refusal as the first: the notice that was
// already up swallowed it, silently, and Submit said "Picks submitted!". Now the adapter reports the weeks of the refused rows and the app asks about every one of them.
{
  const { auth, sbm, standUp, tearDown, quiet, sleep } = world;
  const L = 'L-lock2t';
  const T0 = Date.now();
  const wrow = (id, n) => ({ league_id: L, id, sport: 'cfb', season: '2026', week_number: n, label: `Week ${n}`, status: 'open', picks_lock_at: null, auto_lock_offset_minutes: 30, revealed_at: null, locked_at: null, locked_alma_maters: null, pending_finalization: false, extra: {} });
  const grow = (id, wk, kickMs) => ({ league_id: L, id, week_id: wk, home_team: `Home ${id}`, away_team: `Away ${id}`, status: 'scheduled', kickoff: iso(kickMs), spread: -3.5, favorite: `Home ${id}`, multiplier: 1, home_score: 0, away_score: 0, last_updated: null, ats_winner: null, extra: {} });
  const rows = {
    league_members: [{ league_id: L, id: 'p2', user_id: 'u-kev', role: 'player', display_name: 'Kevin', initials: 'KV', alma_mater: '', active: true, notify_prefs: {}, preferences: {}, extra: {} }],
    weeks: [wrow('w2t', 7), wrow('w2u', 8)],
    games: [grow('g2t', 'w2t', T0 + 20 * MIN), grow('g2u', 'w2u', T0 + 3 * 24 * 60 * MIN)],   // w2t's lock instant (kickoff - 30 min) passed 10 minutes ago; w2u's is three days out
  };
  // D1 third pass (item 1): GUARD MODE - the fake refuses what 0043 refuses (a statement touching the closed week w2t) and keeps what it accepts, so "gone after a reopen" is a fact about the server, not the fake.
  const ctl = { picksSends: 0, closedWeeks: new Set(['w2t']) };
  const { landed, detach } = await standUp({ L, rows, ctl, role: 'player', userId: 'u-kev', memberId: 'p2' });
  assert(landed === true && sbm.getState() === 'ACTIVE' && storage.getWeek('w2t') && storage.getWeek('w2u'), `[2t-0] fixture: the REAL adapter hydrated two weeks (landed=${landed})`);
  const closedWeek = storage.getWeek('w2t'), openWeek = storage.getWeek('w2u');
  assert(app.canPlayerSubmitPicks(closedWeek, 'p2').allowed === false && app.canPlayerSubmitPicks(openWeek, 'p2').allowed === true, '[2t-0] ...one CLOSED on this device\'s own check, one OPEN');
  assert(storage.getCurrentWeek()?.weekId === 'w2t', '[2t-0] ...and the CURRENT week is the closed one (the old rule\'s only question: a player cannot move the pointer, so the first open week in the store is current)');
  const pick = (id, wk, g) => ({ pickId: id, weekId: wk, gameId: g, playerId: 'p2', selectedTeam: `Home ${g}`, selectedAt: iso(Date.now()), updatedAt: iso(Date.now()), locked: false, result: 'pending' });
  const shown = () => !!red() && red().style.display !== 'none';

  // step 1: the closed week's pick is refused
  storage.saveAllPicks([pick('pk_2t_a', 'w2t', 'g2t')]);
  await quiet(() => sbm.flush());
  assert(sbm._refusedKeysForTest().includes('cfbp_picks'), '[2t-1] fixture: the closed week\'s pick was refused and the key is latched');
  assert(JSON.stringify(sbm.getStatus().refusedWeeks.cfbp_picks) === JSON.stringify(['w2t']), `[2t-1] the adapter says WHICH week the refused row is in: ${JSON.stringify(sbm.getStatus().refusedWeeks)}`);
  assert(shown() && /This week is locked\./.test(red().innerHTML) && red().getAttribute('data-notice') === 'lock-closed', '[2t-1] the lock notice is up');
  assert(app._pickKeysHeldRefusedForTest() === true, '[2t-1] and a pick key is reported HELD REFUSED (what Submit asks)');

  // Submit now: it must not claim success. The honest question is asked, and the honest words are said.
  const asked = [];
  const realConfirm = globalThis.confirm;
  globalThis.confirm = (m) => { asked.push(String(m)); return true; };
  const nToasts = toasts.length;
  const haptics = heldHaptics.install();
  storage.setSession('p2', false, true);
  app.state.draftPicks = { g2u: 'Home g2u' };
  app._submitPicksForTest(openWeek, storage.getGames('w2u'));
  heldHaptics.remove();
  globalThis.confirm = realConfirm;
  // RE-DERIVED 2026-10-08 (D1 Part 2 item 10, security N3), and AGAIN on the third pass (item 1). Part 2 told the member new picks were "saved on THIS device ... until you reopen the app", and
  // [2t-6] proves the opposite: a reopen drops the whole unsaved queue, these picks with it. The words now promise neither a local save nor a wait - see heldCopyCheck() above for what they say and why.
  const sentToasts = toasts.slice(nToasts);
  const said = sentToasts.map((t) => t.innerHTML || t.textContent || '').join(' | ');
  const verdict = heldCopyCheck(asked[0] || '', said);
  assert(asked.length === 1 && verdict.confirm.length === 0, `[2t-2] Submit ASKS, in words true for this cause and for what a reopen does: ${verdict.confirm.join('; ') || 'ok'} — ${JSON.stringify(asked[0] || '').slice(0, 260)}`);
  assert(verdict.toast.length === 0, `[2t-2] ...and the toast says the picks may not have been sent and names the one next action (reopen, then make any missing picks again): ${verdict.toast.join('; ') || 'ok'} — said: ${said.slice(0, 220)}`);
  assert(sentToasts.length >= 1 && sentToasts.every((t) => /\bwarning\b/.test(String(t.className || ''))) && !sentToasts.some((t) => /\bsuccess\b/.test(String(t.className || ''))), `[2t-2b] ...and it is a WARNING toast, not a success one (classes: ${sentToasts.map((t) => t.className).join(' | ')})`);
  assert(haptics.length === 0, `[2t-2c] ...and no success haptic fires on the held path in the native shell (the haptic marks a submit that SUCCEEDED; [2t-7] proves the same detector sees it fire on a real success) — fired ${haptics.length}`);

  // step 3: that pick is now queued behind the refused one; the next flush refuses the batch
  await quiet(() => sbm.flush());
  const weeks = sbm.getStatus().refusedWeeks.cfbp_picks || [];
  assert(weeks.includes('w2t') && weeks.includes('w2u'), `[2t-3] the refusal now covers BOTH weeks' rows: ${JSON.stringify(weeks)}`);
  assert(app._lockRefusalAppliesForTest(['cfbp_picks'], { cfbp_picks: ['w2t'] }) === true, '[2t-4] a refusal of only the CLOSED week\'s row is a lock refusal');
  assert(app._lockRefusalAppliesForTest(['cfbp_picks'], { cfbp_picks: ['w2t', 'w2u'] }) === false, '[2t-4] a refusal whose batch also holds the OPEN week\'s row is NOT (the lock copy would be false for it)');
  assert(app._lockRefusalAppliesForTest(['cfbp_picks'], { cfbp_picks: ['w2u'] }) === false, '[2t-4] nor is a refusal of an open week\'s row alone');
  assert(app._lockRefusalAppliesForTest(['cfbp_picks'], { cfbp_picks: ['w_ghost'] }) === false, '[2t-4] an unknown week id is not a lock refusal (fails toward the plain copy)');
  assert(app._lockRefusalAppliesForTest(['cfbp_picks'], null) === true && app._lockRefusalAppliesForTest(['cfbp_picks'], {}) === true, '[2t-4] with NO row information the rule is today\'s: the CURRENT week (closed here)');
  assert(app._lockRefusalAppliesForTest(['cfbp_picks'], { cfbp_picks: 'w2t' }) === true && app._lockRefusalAppliesForTest(['cfbp_picks'], { cfbp_picks: [7, null, {}] }) === true, '[2t-4] a malformed week list is ignored, never trusted');
  assert(app._lockRefusalAppliesForTest(['cfbp_weeks'], { cfbp_weeks: ['w2t'] }) === false, '[2t-4] a key outside the three pick / guess keys is never a lock refusal');
  assert(shown() && !/This week is locked\./.test(red().innerHTML) && red().getAttribute('data-notice') === '', `[2t-5] THE DEFECT: the second refusal is NOT swallowed - the plain refusal banner replaced the lock notice (data-notice="${red().getAttribute('data-notice')}")`);
  // [2t-6] WHAT A REOPEN ACTUALLY DOES (the copy above names it as the way out): the refused edits live only in the adapter's memory - a device snapshot is never written while anything is dirty
  // (`_persistSnapshot`'s first line) and the pick draft is in memory only (`_draftBuckets`) - so REOPENING the app (a fresh adapter: tearDown + standUp, the same sequence a reload runs) brings the member
  // back with no held key, and with NOTHING of what was queued: the closed week's refused row AND the open week's pick that rode in the same refused INSERT. The copy must therefore never say they were
  // kept on this device; it says they may not have been sent and to make any missing picks again ([2t-2]), and [2t-7] proves that remaking them lands.
  assert(!(rows.picks || []).some((r) => r.week_id === 'w2u'), `[2t-6] the server never took the open week's pick: it rode in the same INSERT as the closed week's row and was refused with it (server picks: ${JSON.stringify((rows.picks || []).map((r) => r.week_id))})`);
  await tearDown(detach);
  const again = await standUp({ L, rows, ctl, role: 'player', userId: 'u-kev', memberId: 'p2' });   // ctl.closedWeeks still holds w2t: the server would STILL refuse it - the reopened app simply no longer holds it
  assert(again.landed === true && app._pickKeysHeldRefusedForTest() === false && !(sbm.getStatus().refusedKeys || []).length, '[2t-6] after a REOPEN (a fresh adapter) no pick key is held refused');
  assert(!storage.getPicks('w2t').some((p) => p.pickId === 'pk_2t_a'), '[2t-6] ...and the refused pick row for the closed week is not in the mirror any more (it was never saved, so it does not come back)');
  assert(!storage.getPicks('w2u').some((p) => p.playerId === 'p2'), `[2t-6] ...and THE OPEN WEEK'S PICK IS GONE TOO after the reopen - which is why [2t-2]'s words never say it was saved on this device (mirror w2u: ${JSON.stringify(storage.getPicks('w2u').map((p) => p.selectedTeam))})`);
  assert(verdict.toast.length === 0 && /may not have been sent/i.test(said) && /make any missing picks again/i.test(said), '[2t-6] ...and the toast the member saw said exactly that: the picks may not have been sent, reopen, make any missing picks again (copy and behaviour pinned together)');
  // [2t-7] THE NAMED NEXT ACTION WORKS: after the reopen, the member makes the pick again through the real Submit; nothing is held, so it is the ordinary success path, and it reaches the server.
  const asked2 = [];
  globalThis.confirm = (m) => { asked2.push(String(m)); return true; };
  const nToasts2 = toasts.length;
  const haptics2 = heldHaptics.install();
  app.state.draftPicks = { g2u: 'Home g2u' };
  app._submitPicksForTest(storage.getWeek('w2u'), storage.getGames('w2u'));
  heldHaptics.remove();
  globalThis.confirm = realConfirm;
  await quiet(() => sbm.flush());
  const said2 = toasts.slice(nToasts2).map((t) => t.innerHTML || '').join(' | ');
  assert(asked2.length === 0 && /Picks submitted/.test(said2) && haptics2.length === 1, `[2t-7] remade after the reopen: no warning asked, the ordinary success toast, and the success haptic fires once (the [2t-2c] detector is live) — asked ${asked2.length}, haptics ${haptics2.length}, said: ${said2.slice(0, 120)}`);
  assert((rows.picks || []).some((r) => r.week_id === 'w2u' && r.member_id === 'p2' && r.selected_team === 'Home g2u') && app._pickKeysHeldRefusedForTest() === false, '[2t-7] ...and the remade pick REACHED THE SERVER (the way out the copy names is real)');
  await tearDown(again.detach);
  storage.setSession(null, false, false);
  app.state.draftPicks = {};
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n[2u] The other three pairings: a held refusal does not always stop new picks, so the copy may never say it does…');
// ══════════════════════════════════════════════════════════════════════════
// [2t] is ONE of four pairings. The adapter plans a key's NEW rows as one INSERT and each EDITED row as its own UPDATE, and a refused operation does not stop the run. So a held refusal sinks the open
// week's pick only when both are inserts ([2t]). Held INSERT + edited pick, held EDIT + new pick, held EDIT + edited pick: the open week's pick REACHES the server and survives a reopen. Submit cannot
// tell these apart (it would need the adapter's server rows), so the words must be true for all four: "may not have been sent", never "were not sent" or "won't be sent".
{
  const { sbm, standUp, tearDown, quiet } = world;
  for (const [heldKind, newKind] of [['insert', 'patch'], ['patch', 'insert'], ['patch', 'patch']]) {
    const L = `L-lock2u-${heldKind}-${newKind}`;
    const T0 = Date.now();
    const wrow = (id, n) => ({ league_id: L, id, sport: 'cfb', season: '2026', week_number: n, label: `Week ${n}`, status: 'open', picks_lock_at: null, auto_lock_offset_minutes: 30, revealed_at: null, locked_at: null, locked_alma_maters: null, pending_finalization: false, extra: {} });
    const grow = (id, wk, kickMs) => ({ league_id: L, id, week_id: wk, home_team: `Home ${id}`, away_team: `Away ${id}`, status: 'scheduled', kickoff: iso(kickMs), spread: -3.5, favorite: `Home ${id}`, multiplier: 1, home_score: 0, away_score: 0, last_updated: null, ats_winner: null, extra: {} });
    const prow = (id, wk, g) => ({ league_id: L, id, week_id: wk, game_id: g, member_id: 'p2', selected_team: `Away ${g}`, selected_at: iso(T0 - 3600e3), updated_at: iso(T0 - 3600e3), locked: false, result: 'pending' });
    const rows = {
      league_members: [{ league_id: L, id: 'p2', user_id: 'u-kev', role: 'player', display_name: 'Kevin', initials: 'KV', alma_mater: '', active: true, notify_prefs: {}, preferences: {}, extra: {} }],
      weeks: [wrow('w2v', 7), wrow('w2w', 8)],
      games: [grow('g2v', 'w2v', T0 + 20 * MIN), grow('g2w', 'w2w', T0 + 3 * 24 * 60 * MIN)],
      picks: [...(heldKind === 'patch' ? [prow('pk_2v', 'w2v', 'g2v')] : []), ...(newKind === 'patch' ? [prow('pk_2w', 'w2w', 'g2w')] : [])],
    };
    const ctl = { picksSends: 0, closedWeeks: new Set(['w2v']) };
    const tag = `[2u ${heldKind}+${newKind}]`;
    const { landed, detach } = await standUp({ L, rows, ctl, role: 'player', userId: 'u-kev', memberId: 'p2' });
    // the closed week's write: a NEW pick (insert) or an EDIT of the saved one (patch)
    const mine = storage.getPick('w2v', 'g2v', 'p2');
    storage.saveAllPicks([mine ? { ...mine, selectedTeam: 'Home g2v', updatedAt: iso(Date.now()) } : { pickId: 'pk_2v', weekId: 'w2v', gameId: 'g2v', playerId: 'p2', selectedTeam: 'Home g2v', selectedAt: iso(Date.now()), updatedAt: iso(Date.now()), locked: false, result: 'pending' }]);
    await quiet(() => sbm.flush());
    assert(landed === true && app._pickKeysHeldRefusedForTest() === true, `${tag} fixture: the closed week's ${heldKind} was refused and the pick key is held`);
    const asked = [];
    const realConfirm = globalThis.confirm;
    globalThis.confirm = (m) => { asked.push(String(m)); return true; };
    const n0 = toasts.length;
    storage.setSession('p2', false, true);
    app.state.draftPicks = { g2w: 'Home g2w' };
    app._submitPicksForTest(storage.getWeek('w2w'), storage.getGames('w2w'));
    globalThis.confirm = realConfirm;
    const said = toasts.slice(n0).map((t) => t.innerHTML || '').join(' | ');
    await quiet(() => sbm.flush());
    const reached = (rows.picks || []).some((r) => r.week_id === 'w2w' && r.selected_team === 'Home g2w');
    await tearDown(detach);
    const again = await standUp({ L, rows, ctl, role: 'player', userId: 'u-kev', memberId: 'p2' });
    const kept = storage.getPicks('w2w').some((p) => p.playerId === 'p2' && p.selectedTeam === 'Home g2w');
    assert(reached && kept, `${tag} the open week's ${newKind === 'patch' ? 'EDITED' : 'NEW'} pick REACHED the server and survives a reopen although a refusal was held (server: ${reached}, after reopen: ${kept})`);
    const v = heldCopyCheck(asked[0] || '', said);
    assert(asked.length === 1 && v.confirm.length === 0 && v.toast.length === 0, `${tag} ...so the SAME words the member saw are still true here: they never said the picks were not sent ${[...v.confirm, ...v.toast].join('; ') || ''}`);
    await tearDown(again.detach);
    storage.setSession(null, false, false);
    app.state.draftPicks = {};
  }
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n[3] The commissioner\'s "spread not frozen" notice for a week the SERVER locked (DI-496)…');
// ══════════════════════════════════════════════════════════════════════════
{
  const BAD = (id, wk, over = {}) => game(id, wk, NOW - 60 * MIN, { spread: 4, favorite: `Home ${id}`, lockedSpread: null, ...over });       // positive (away-favoured) spread, HOME team as favourite: contradicts
  const OK = (id, wk) => game(id, wk, NOW - 60 * MIN, { spread: -3, favorite: `Home ${id}`, lockedSpread: -3 });
  const wk = (id, status) => week(id, { status });
  assert(app.unfrozenSpreadGames(wk('u', 'locked'), [BAD('g1', 'u'), OK('g2', 'u')]).map((g) => g.gameId).join() === 'g1', '[3a] a locked week lists the game whose sign contradicts its favourite and has no frozen spread — and only that one');
  assert(app.unfrozenSpreadGames(wk('u', 'live'), [BAD('g1', 'u')]).length === 1, '[3b] a live week too');
  assert(app.unfrozenSpreadGames(wk('u', 'final'), [BAD('g1', 'u')]).length === 0 && app.unfrozenSpreadGames(wk('u', 'open'), [BAD('g1', 'u')]).length === 0 && app.unfrozenSpreadGames(wk('u', 'draft'), [BAD('g1', 'u')]).length === 0 && app.unfrozenSpreadGames(null, [BAD('g1', 'u')]).length === 0,
    '[3c] a final, open, draft or missing week lists nothing');
  assert(app.unfrozenSpreadGames(wk('u', 'locked'), [BAD('g1', 'u', { lockedSpread: 4 })]).length === 0 && app.unfrozenSpreadGames(wk('u', 'locked'), [BAD('g1', 'u', { spread: null })]).length === 0
    && app.unfrozenSpreadGames(wk('u', 'locked'), [BAD('g1', 'u', { favorite: null })]).length === 0, '[3d] a game that froze, has no spread, or has no resolved favourite is never listed (the same helper the client lock uses: isSpreadSignConsistentWithFavorite)');

  // supabase DATA mode needs authMode 'supabase' (whose session is the auth module's, not storage's), so the two inputs the function reads are injected; the real defaults are exercised in [3k]
  let ctx3 = { supabase: true, session: { isAdmin: true } };
  const setup = (id, status, games, { admin }) => {
    app._resetUnfrozenSpreadNoticeForTest();
    storage.saveWeek(wk(id, status)); for (const g of games) storage.saveGame(g); storage.setActiveWeekId(id);
    ctx3 = { supabase: true, session: { isAdmin: admin } };
  };
  const notice = () => app.maybeNoticeUnfrozenSpreads(ctx3);
  toasts.length = 0;
  setup('lc3a', 'locked', [BAD('t1', 'lc3a'), BAD('t2', 'lc3a')], { admin: true });
  assert(notice() === true && toasts.length === 1, '[3e] the commissioner\'s device raises ONE toast for the locked current week');
  const t = lastToast();
  assert(/^toast error$/.test(t.className) && /Spread NOT frozen for 2 games/.test(t.innerHTML) && /The week locked on the server\./.test(t.innerHTML) && /Commissioner → Games/.test(t.innerHTML) && /grade on their live spread/.test(t.innerHTML),
    '[3f] …an error toast naming the count and the consequence ("those games grade on their live spread")', t.innerHTML);
  assert(notice() === false && toasts.length === 1, '[3g] …and only once per week per page lifetime (a second repaint raises nothing)');
  setup('lc3b', 'locked', [BAD('t1', 'lc3b')], { admin: false });
  assert(notice() === false && toasts.length === 1, '[3h] a PLAYER session never gets it');
  setup('lc3c', 'final', [BAD('t1', 'lc3c')], { admin: true });
  assert(notice() === false && toasts.length === 1, '[3i] a FINAL week never gets it');
  setup('lc3d', 'locked', [OK('t1', 'lc3d')], { admin: true });
  assert(notice() === false && toasts.length === 1, '[3j] a locked week whose every spread froze raises nothing');
  setup('lc3e', 'locked', [BAD('t1', 'lc3e')], { admin: true });
  ctx3 = { supabase: false, session: { isAdmin: true } };
  assert(notice() === false && app.maybeNoticeUnfrozenSpreads() === false && toasts.length === 1, '[3k] local mode (no server lock) raises nothing: the device\'s own lock paths already toast (and the REAL defaults — this harness is in local mode — agree)');
  // SC-P9: the team names are ESCAPED ONCE, by the sink — a hostile name renders as text, and nothing double-escapes
  setup('lc3f', 'locked', [{ ...BAD('t1', 'lc3f'), homeTeam: '<img src=x onerror=alert(1)>', awayTeam: 'Texas A&M', favorite: '<img src=x onerror=alert(1)>' }], { admin: true });
  assert(notice() === true, '[3l] fixture — a hostile team name still produces the notice');
  const h = lastToast().innerHTML;
  assert(!/<img/i.test(h) && /&lt;img src=x onerror=alert\(1\)&gt;/.test(h) && /Texas A&amp;M/.test(h) && !/&amp;amp;|&amp;lt;/.test(h), '[3m] the hostile name renders as TEXT through showToast\'s one escape, "Texas A&M" is not double-escaped, and no html option is passed (SC-P9)', h);
  const text = app.unfrozenSpreadToastText([{ awayTeam: 'Texas A&M', homeTeam: 'LSU' }]);
  assert(text === '⚠️ Spread NOT frozen for 1 game — sign contradicts recorded favorite: Texas A&M @ LSU. The week locked on the server. Fix the spread and favorite in Commissioner → Games; until then those games grade on their live spread.', '[3n] the copy, verbatim from the design input, singular for one game, and NOT pre-escaped');
  // a lock this very device made already toasted: the server's echo must not toast it a second time (source pin: the three existing toast sites record the week)
  const appSrc = await read('./js/app.js');
  assert((appSrc.match(/_unfrozenSpreadNoticeSent\.add\(/g) || []).length === 3 && /function notifySpreadLockRefusals\(weekId, refusals\) \{\s*if \(!refusals \|\| !refusals\.length\) return false;\s*_unfrozenSpreadNoticeSent\.add\(weekId\);/.test(appSrc)
      && (appSrc.match(/notifySpreadLockRefusals\(/g) || []).length === 4 && /notifySpreadLockRefusals\(week\.weekId, statusResult\?\.spreadLockRefusals\)/.test(appSrc) && /notifySpreadLockRefusals\(liveWeekForStatus\.weekId, statusResult\?\.spreadLockRefusals\)/.test(appSrc),
    '[3o] D1 (S4): the "spread NOT locked" toast is ONE helper (notifySpreadLockRefusals) that records the week, called by the Comm Week button, the wizard Manage button AND the all-sports Lock, so the server\'s echo of the same lock does not toast twice; the tick and the sweep keep their own recording (three .add() sites in all)');
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n[4] Late entry — Re-open Picks after the lock instant (Amendment 1, A1.1)…');
// ══════════════════════════════════════════════════════════════════════════
{
  // ── the pure decisions (js/week-wizard.js) ──
  const last = NOW + 5 * 60 * MIN;
  assert(ww.lateEntryApplies({ lockAtMs: NOW - 1, now: NOW }) === true && ww.lateEntryApplies({ lockAtMs: NOW, now: NOW }) === true && ww.lateEntryApplies({ lockAtMs: NOW + 1, now: NOW }) === false
    && ww.lateEntryApplies({ lockAtMs: null, now: NOW }) === false && ww.lateEntryApplies({ lockAtMs: NaN, now: NOW }) === false && ww.lateEntryApplies({}) === false, '[4a] the sheet applies only once the lock instant has passed (the boundary counts as passed, as the server\'s guard does); a week with no instant never asks');
  assert(ww.lateEntryLastKickoffMs([{ kickoff: iso(NOW + MIN) }, { kickoff: iso(last) }, { kickoff: null }, { kickoff: 'garbage' }, null]) === last && ww.lateEntryLastKickoffMs([]) === null && ww.lateEntryLastKickoffMs([{ kickoff: null }]) === null, '[4b] the last kickoff ignores games with no usable kickoff');
  assert(ww.lateEntryDefaultMs({ now: NOW, lastKickoffMs: last }) === NOW + 30 * MIN && ww.lateEntryDefaultMs({ now: NOW, lastKickoffMs: NOW + 10 * MIN }) === NOW + 10 * MIN && ww.lateEntryDefaultMs({ now: NOW, lastKickoffMs: NOW - 1 }) === null && ww.lateEntryDefaultMs({ now: NOW, lastKickoffMs: null }) === NOW + 30 * MIN,
    '[4c] the default is now + 30 minutes, clamped to the last kickoff when that comes sooner, and absent when every game has kicked off');
  const v = (atMs, lastKickoffMs = last) => ww.validateLateEntryAt({ atMs, now: NOW, lastKickoffMs });
  assert(v(NOW + 30 * MIN).ok && v(last).ok && v(last + 1).reason === 'after_last_kickoff' && v(NOW).reason === 'past' && v(NOW - MIN).reason === 'past' && v(NaN).reason === 'invalid' && v(undefined).reason === 'invalid'
    && v(NOW + 1).ok && v(NOW + 30 * MIN, NOW - 1).reason === 'no_window' && v(NOW + 99 * 60 * MIN, null).ok, '[4d] valid = after now and no later than the last kickoff (the last kickoff itself is allowed); blank/garbled is invalid; nothing left to choose is no_window; no dated game has no upper bound');
  assert(ww.lateEntryErrorCopy('past') === 'Pick a time after now.' && ww.lateEntryErrorCopy('after_last_kickoff') === "Pick a time no later than the week's last kickoff." && ww.lateEntryErrorCopy('invalid') === 'Enter a date and time.' && /no time left/.test(ww.lateEntryErrorCopy('no_window')) && ww.lateEntryErrorCopy(null) === '' && ww.lateEntryErrorCopy('x') === '',
    '[4e] the inline messages: calm, one sentence, no technical word');
  assert(ww.LATE_ENTRY_COPY.consequence('Sat 4:30 PM') === 'Picks and guesses reopen for everyone until Sat 4:30 PM.' && ww.LATE_ENTRY_COPY.CONFIRM === 'Re-open Picks' && ww.LATE_ENTRY_COPY.CANCEL === 'Cancel' && Object.isFrozen(ww.LATE_ENTRY_COPY),
    '[4f] the consequence line is the one the design input names, verbatim');

  // ── the preview (the pure core of the sheet's field) ──
  const local = (ms) => { const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  const pv = app.lateEntryPreview({ value: local(NOW + 45 * MIN), nowMs: NOW, lastMs: last });
  assert(pv.ok === true && pv.error === '' && /^Picks and guesses reopen for everyone until .+\.$/.test(pv.consequence), '[4g] a valid typed time previews the consequence line with the time in the player\'s own words', JSON.stringify(pv));
  assert(app.lateEntryPreview({ value: '', nowMs: NOW, lastMs: last }).reason === 'invalid' && app.lateEntryPreview({ value: local(NOW - 5 * MIN), nowMs: NOW, lastMs: last }).reason === 'past'
    && app.lateEntryPreview({ value: local(last + 10 * MIN), nowMs: NOW, lastMs: last }).reason === 'after_last_kickoff' && app.lateEntryPreview({ value: local(NOW + 45 * MIN), nowMs: NOW, lastMs: last }).consequence !== '', '[4h] an empty, past or too-late field previews its inline error and no consequence line');

  // N3 (reviewer BLOCK #1): the consequence line gains "Some games will already have started." when the chosen time is AFTER the week's first kickoff
  const firstK = NOW + 10 * MIN;
  assert(ww.lateEntryFirstKickoffMs([{ kickoff: iso(last) }, { kickoff: iso(firstK) }, { kickoff: null }, { kickoff: 'garbage' }, null]) === firstK && ww.lateEntryFirstKickoffMs([]) === null && ww.lateEntryFirstKickoffMs([{ kickoff: null }]) === null,
    '[4h2] the first kickoff is the earliest USABLE kickoff (the same filter as scoring.js computeFirstKickoff); none -> null');
  assert(ww.lateEntryStartedWarning({ atMs: firstK + 1, firstKickoffMs: firstK }) === 'Some games will already have started.' && ww.lateEntryStartedWarning({ atMs: firstK, firstKickoffMs: firstK }) === '' && ww.lateEntryStartedWarning({ atMs: firstK - 1, firstKickoffMs: firstK }) === ''
    && ww.lateEntryStartedWarning({ atMs: firstK + 1, firstKickoffMs: null }) === '' && ww.lateEntryStartedWarning({ atMs: NaN, firstKickoffMs: firstK }) === '' && ww.lateEntryStartedWarning({}) === '',
    '[4h3] the warning is STRICTLY after the first kickoff (a lock exactly at kickoff closes as the first game starts); no known kickoff or an unreadable time says nothing');
  const pvw = (atMs) => app.lateEntryPreview({ value: local(atMs), nowMs: NOW, lastMs: last, firstMs: firstK });
  assert(pvw(NOW + 45 * MIN).warning === ww.LATE_ENTRY_COPY.WARN_STARTED && /^Picks and guesses reopen for everyone until .+\.$/.test(pvw(NOW + 45 * MIN).consequence) && !pvw(NOW + 45 * MIN).consequence.includes('started')
    && pvw(NOW + 3 * MIN).warning === '' && app.lateEntryPreview({ value: local(NOW + 45 * MIN), nowMs: NOW, lastMs: last }).warning === '' && app.lateEntryPreview({ value: local(NOW - 5 * MIN), nowMs: NOW, lastMs: last, firstMs: firstK }).warning === '',
    '[4h4] the preview carries the warning as its own field and leaves the consequence sentence verbatim; before the first kickoff, with no kickoff, or when the time is invalid there is none');

  // ── when the sheet opens ──
  setMode('sheets');
  const put = (w, games) => { storage.saveWeek(w); for (const g of games) storage.saveGame(g); return storage.getWeek(w.weekId); };
  const lapsed = put(week('lc4_lapsed', { status: 'locked' }), [game('p1', 'lc4_lapsed', NOW + 10 * MIN), game('p2', 'lc4_lapsed', NOW + 4 * 60 * MIN)]);     // instant = 20 minutes ago; last kickoff 4 h ahead
  const early = put(week('lc4_early', { status: 'locked' }), [game('q1', 'lc4_early', NOW + 120 * MIN)]);                                                       // instant 90 minutes AHEAD (a manual lock before the instant)
  assert(app._maybeOpenLateEntrySheetForTest(early) === false && !reg.get('late-entry-sheet-wrap') && app._lateEntryStateForTest() === null, '[4i] BEFORE the instant (a manual lock early) Re-open Picks behaves as it always has: the sheet does not open');
  assert(app._maybeOpenLateEntrySheetForTest(put(week('lc4_demo', { status: 'locked', dataSourceMode: 'demo' }), [game('r1', 'lc4_demo', NOW - 60 * MIN)])) === false
    && app._maybeOpenLateEntrySheetForTest(put(week('lc4_noinst', { status: 'locked' }), [])) === false && app._maybeOpenLateEntrySheetForTest(put(week('lc4_open', { status: 'open' }), [game('s1', 'lc4_open', NOW - 60 * MIN)])) === false
    && app._maybeOpenLateEntrySheetForTest(put(week('lc4_final', { status: 'final' }), [game('s2', 'lc4_final', NOW - 60 * MIN)])) === false && app._maybeOpenLateEntrySheetForTest(null) === false
    && app._maybeOpenLateEntrySheetForTest(put(week('lc4_live', { status: 'live' }), [game('s3', 'lc4_live', NOW - 60 * MIN)])) === false && !reg.get('late-entry-sheet-wrap'),
    '[4j] a DEMO week, a week with no instant, an open, a LIVE or a final week, and no week: the sheet never opens (the re-open path is untouched; a revealed week cannot be re-opened by the server)');

  let doneCalls = 0;
  assert(app._maybeOpenLateEntrySheetForTest(lapsed, { onDone: () => { doneCalls += 1; } }) === true, '[4k] AFTER the instant, Re-open Picks on a locked week opens the late-entry sheet instead');
  let wrap = reg.get('late-entry-sheet-wrap');
  const body = wrap && wrap.querySelector('#late-entry-body');
  assert(!!wrap && wrap.getAttribute('data-hold-teardown') !== undefined && /id="late-entry-at"/.test(body.innerHTML) && /type="datetime-local"/.test(body.innerHTML) && /Cancel/.test(body.innerHTML) && />Re-open Picks</.test(body.innerHTML) && /New lock time/.test(body.innerHTML),
    '[4l] the sheet is the shared shell (swept by a security hold) with one datetime field, Cancel and Re-open Picks', body && body.innerHTML.slice(0, 200));
  const def = (/id="late-entry-at"[^>]*value="([^"]*)"/.exec(body.innerHTML) || [])[1];
  const defMs = new Date(def).getTime();
  assert(Math.abs(defMs - (NOW + 30 * MIN)) <= 2 * MIN, '[4m] the field starts at now + 30 minutes (in the device\'s local time, never toISOString().slice: RG-286)', def);
  const input = wrap.querySelector('#late-entry-at');
  const consequence = wrap.querySelector('#late-entry-consequence');
  const errorEl = wrap.querySelector('#late-entry-error');
  const confirmBtn = wrap.querySelector('#late-entry-confirm');
  assert(/^Picks and guesses reopen for everyone until /.test(consequence.textContent) === false && confirmBtn.disabled === true, '[4n] with the fake field empty (no typed value yet) Confirm is disabled and no consequence is promised');
  input.value = local(NOW + 45 * MIN); input.fire('input');
  assert(/^Picks and guesses reopen for everyone until .+\.$/.test(consequence.textContent) && confirmBtn.disabled === false && errorEl.textContent === '', '[4o] typing a valid time shows what it will do BEFORE confirming and enables Confirm');
  assert(consequence.textContent === `${ww.LATE_ENTRY_COPY.consequence(consequence.textContent.slice('Picks and guesses reopen for everyone until '.length, consequence.textContent.length - ' Some games will already have started.'.length - 1))} Some games will already have started.`,
    '[4o2] N3: a time AFTER the first kickoff (10 minutes ahead; this one is 45) adds "Some games will already have started." to the consequence line, in the same region', consequence.textContent);
  input.value = local(NOW + 3 * MIN); input.fire('input');
  assert(/^Picks and guesses reopen for everyone until .+\.$/.test(consequence.textContent) && !/started/.test(consequence.textContent) && confirmBtn.disabled === false, '[4o3] …and a time BEFORE the first kickoff shows only the plain consequence (the clause comes and goes with the field)');
  input.value = local(NOW + 45 * MIN); input.fire('input');
  input.value = local(NOW - 10 * MIN); input.fire('input');
  assert(errorEl.textContent === 'Pick a time after now.' && consequence.textContent === '' && confirmBtn.disabled === true && errorEl.classList.contains('is-visible'), '[4p] a past time: the inline error, no consequence line, Confirm disabled (no layout change: both regions are fixed-height)');
  input.value = local(NOW + 6 * 60 * MIN); input.fire('input');
  assert(errorEl.textContent === "Pick a time no later than the week's last kickoff." && confirmBtn.disabled === true, '[4q] a time past the last kickoff (4 hours ahead): refused with its own sentence');
  const before = storage.getWeek('lc4_lapsed');
  wrap.querySelector('#late-entry-cancel').fire('click');
  assert(!reg.get('late-entry-sheet-wrap') && app._lateEntryStateForTest() === null && storage.getWeek('lc4_lapsed').status === 'locked' && (storage.getWeek('lc4_lapsed').picksLockAt ?? null) === (before.picksLockAt ?? null) && doneCalls === 0,
    '[4r] Cancel changes NOTHING: the sheet is gone, the week is still locked with the same lock time, and nothing was told it finished');
  // Esc and the backdrop close it too (web); a second open replaces the first
  app._maybeOpenLateEntrySheetForTest(lapsed); document.fireKey('Escape');
  assert(!reg.get('late-entry-sheet-wrap'), '[4s] Esc closes it (web; a phone has no Esc key), and the keydown listener is released');
  app._maybeOpenLateEntrySheetForTest(lapsed); reg.get('late-entry-sheet-wrap').querySelector('.chat-sheet-backdrop').fire('click');
  assert(!reg.get('late-entry-sheet-wrap'), '[4t] a tap on the backdrop closes it');
  app._maybeOpenLateEntrySheetForTest(lapsed); const first = reg.get('late-entry-sheet-wrap'); app._maybeOpenLateEntrySheetForTest(lapsed);
  assert(reg.get('late-entry-sheet-wrap') !== first && first._removed === true, '[4u] opening it again replaces the live sheet, never stacks a second');
  app._resetLateEntryForTest();

  // ── the confirm, end to end in LOCAL mode (no server): one write carries the new lock time and the re-open ──
  doneCalls = 0;
  app._maybeOpenLateEntrySheetForTest(storage.getWeek('lc4_lapsed'), { onDone: () => { doneCalls += 1; } });
  wrap = reg.get('late-entry-sheet-wrap');
  const inp = wrap.querySelector('#late-entry-at');
  inp.value = local(NOW + 40 * MIN); inp.fire('input');
  const chosenMs = new Date(inp.value).getTime();
  toasts.length = 0;
  wrap.querySelector('#late-entry-confirm').fire('click');
  await new Promise((r) => setTimeout(r, 20));
  const after = storage.getWeek('lc4_lapsed');
  assert(after.status === 'open' && new Date(after.picksLockAt).getTime() === chosenMs, '[4v] Confirm writes picksLockAt = the chosen time AND re-opens the week (local mode: one save)', JSON.stringify({ status: after.status, lock: after.picksLockAt }));
  assert(!reg.get('late-entry-sheet-wrap') && doneCalls === 1 && /^Picks re-opened until .+\.$/.test(lastToast().innerHTML) && /toast success/.test(lastToast().className), '[4w] …the sheet closes, the caller is told (it repaints), and one plain success toast names the time');
  assert(app.canPlayerSubmitPicks(after, 'pl1').allowed === true, '[4x] …and the Picks page is OPEN again for players: the explicit lock time later than the derived instant is honoured (the client mirror agrees with the server\'s guard)');
  assert(ww.lateEntryApplies({ lockAtMs: (await import('./js/scoring.js')).computeEffectiveLockAt(after, storage.getGames('lc4_lapsed')).getTime(), now: Date.now() }) === false, '[4y] …and a SECOND "Re-open Picks" before the new time has nothing to ask (the effective instant is the chosen time, not yet passed)');
}

// ── the two-step write, in the order that matters, with the failure paths (supabase mode, injected flush) ──
{
  const put = (id) => { storage.saveWeek(week(id, { status: 'locked' })); storage.saveGame(game(`${id}_g`, id, NOW - 30 * MIN)); return storage.getWeek(id); };
  const rec = [];
  const spyFlush = (result) => async () => {
    const w = storage.getWeek('lc4w');
    rec.push(['flush', w.status, w.picksLockAt]);
    if (result instanceof Error) throw result;
    return result;
  };
  put('lc4w');
  const at = iso(NOW + 25 * MIN);
  const idle = () => false;                                  // the injected "is the lock-time patch still waiting?" answer: no
  let r = await app.applyLateEntry({ weekId: 'lc4w', atIso: at, supabase: true, flush: spyFlush({ pushed: 1, refused: [] }), writePending: idle });
  let w = storage.getWeek('lc4w');
  assert(r.ok === true && JSON.stringify(rec) === JSON.stringify([['flush', 'locked', at]]) && w.status === 'open' && w.picksLockAt === at,
    '[4z] THE ORDER: when the flush runs the new lock time is already saved and the week is STILL LOCKED (no moment it is open with the old instant for the job to re-lock); only after the flush succeeds is the week re-opened', JSON.stringify({ rec, status: w.status }));
  // N1 (reviewer BLOCK #1): EVERY shape of flush()'s result that means "the lock time never reached the server". `pending` is the planner's own answer after the flush (is the patch still waiting?).
  const NOT_SAVED = [
    ['refused', { pushed: 0, refused: ['cfbp_weeks'] }, false], ['held offline', { pushed: 0, heldOffline: ['cfbp_weeks'] }, false], ['abandoned', { pushed: 0, abandoned: true }, false], ['null', null, false], ['threw', new Error('boom'), false],
    ['held (a stale mirror: {held:true})', { pushed: 0, held: true }, false], ['held in a non-ACTIVE state', { pushed: 0, held: true, state: 'HELD' }, false], ['skipped (no client)', { pushed: 0, skipped: true }, false],
    ['retrying (the weeks write is queued for a retry)', { pushed: 0, retrying: ['cfbp_weeks'], attempt: 1, nextRetryInMs: 1000 }, false],
    ['refusedStale (dropped, never sent)', { pushed: 0, refusedStale: ['cfbp_weeks'] }, false], ['stillRefused (latched, not re-sent)', { pushed: 0, stillRefused: ['cfbp_weeks'] }, false],
    // a result that does not NAME cfbp_weeks is no evidence it was sent: the batch STOPS at the failing operation, so a week write queued after it never went either
    ['retrying ANOTHER key but the week patch is still queued behind it', { pushed: 0, retrying: ['cfbp_picks'] }, true], ['held offline on ANOTHER key, week patch still queued', { pushed: 0, heldOffline: ['cfbp_picks'] }, true],
    ['stillRefused on ANOTHER key, week patch still queued', { pushed: 0, stillRefused: ['cfbp_picks'] }, true], ['an unnamed {pushed:1} while the patch is STILL pending', { pushed: 1 }, true],
  ];
  for (const [label, result, pending] of NOT_SAVED) {
    put('lc4w'); rec.length = 0;
    const prev = storage.getWeek('lc4w').picksLockAt ?? null;
    const origWarn = console.warn; console.warn = () => {};
    r = await app.applyLateEntry({ weekId: 'lc4w', atIso: at, supabase: true, flush: spyFlush(result), writePending: () => pending });
    console.warn = origWarn;
    w = storage.getWeek('lc4w');
    assert(r.ok === false && r.reason === 'save_failed' && w.status === 'locked' && (w.picksLockAt ?? null) === prev, `[4za] the lock-time write ${label}: the week is NOT re-opened and the old lock time is put back (nothing was changed)`, JSON.stringify({ r, status: w.status, lock: w.picksLockAt }));
  }
  const SAVED = [
    ['a plain {pushed:1}', { pushed: 1 }], ['{pushed:0} (nothing was dirty: the server already holds it)', { pushed: 0 }], ['a refusal of ANOTHER key in the same flush', { pushed: 1, refused: ['cfbp_picks'] }],
    ['a retry of ANOTHER key after the week write went', { pushed: 1, retrying: ['cfbp_picks'] }], ['ANOTHER key still latched, the week write sent', { pushed: 1, stillRefused: ['cfbp_picks'] }],
  ];
  for (const [label, result] of SAVED) {
    put('lc4w'); rec.length = 0;
    r = await app.applyLateEntry({ weekId: 'lc4w', atIso: at, supabase: true, flush: spyFlush(result), writePending: idle });
    assert(r.ok === true && storage.getWeek('lc4w').status === 'open', `[4zb] ${label} does not block the re-open (only an unsent cfbp_weeks does)`);
  }
  assert(ww.lateEntryLockWriteLanded({ pushed: 1 }) === true && ww.lateEntryLockWriteLanded({ pushed: 1 }, { pending: true }) === false && ww.lateEntryLockWriteLanded(undefined) === false && ww.lateEntryLockWriteLanded('x') === false
    && ww.lateEntryLockWriteLanded({ pushed: 1, held: false, skipped: false, abandoned: false }) === true && ww.lateEntryLockWriteLanded({ retrying: 'cfbp_weeks' }) === true,
    '[4zb2] the pure decision: success needs an object that names none of the not-saved shapes for cfbp_weeks AND a patch no longer pending; a non-array list is ignored, never trusted as a name');
  assert((await app.applyLateEntry({ weekId: 'gone_week', atIso: at, supabase: true, flush: spyFlush({}), writePending: idle })).reason === 'gone', '[4zc] a week that no longer exists is refused without a write');
  put('lc4x'); rec.length = 0;
  r = await app.applyLateEntry({ weekId: 'lc4x', atIso: at, supabase: false, flush: spyFlush(new Error('must not be called in local mode')) });
  assert(r.ok === true && rec.length === 0 && storage.getWeek('lc4x').status === 'open' && storage.getWeek('lc4x').picksLockAt === at, '[4zd] local mode has no server to flush: one save, no flush call');

  // security functional note: only a LOCKED week can be re-opened. LIVE (revealed) and FINAL never open the sheet and nothing is written.
  for (const status of ['live', 'final', 'open', 'draft']) {
    storage.saveWeek(week('lc4s', { status })); storage.saveGame(game('lc4s_g', 'lc4s', NOW - 30 * MIN));
    rec.length = 0;
    const gate = app._maybeOpenLateEntrySheetForTest(storage.getWeek('lc4s'));
    const wr = await app.applyLateEntry({ weekId: 'lc4s', atIso: at, supabase: true, flush: spyFlush({ pushed: 1 }), writePending: idle });
    const ws = storage.getWeek('lc4s');
    assert(gate === false && !reg.get('late-entry-sheet-wrap') && wr.ok === false && wr.reason === 'not_locked' && rec.length === 0 && (ws.picksLockAt ?? null) === null && ws.status === status,
      `[4ze] a ${status.toUpperCase()} week (instant long past): the sheet never opens, applyLateEntry writes NOTHING (no picksLockAt, no flush, status untouched) — an orphaned picks_lock_at on a revealed week is impossible`, JSON.stringify({ gate, wr, status: ws.status, lock: ws.picksLockAt, flushes: rec.length }));
  }
  // the week leaves LOCKED while the sheet is open (it goes live at first kickoff): Confirm refuses with its own sentence and the failure message STAYS visible
  storage.saveWeek(week('lc4g', { status: 'locked' })); storage.saveGame(game('lc4g_g', 'lc4g', NOW + 10 * MIN)); storage.saveGame(game('lc4g_h', 'lc4g', NOW + 4 * 60 * MIN));
  setMode('sheets');
  app._maybeOpenLateEntrySheetForTest(storage.getWeek('lc4g'));
  const wg = reg.get('late-entry-sheet-wrap');
  const ig = wg.querySelector('#late-entry-at'); ig.value = (() => { const d = new Date(NOW + 40 * MIN); const q = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${q(d.getMonth() + 1)}-${q(d.getDate())}T${q(d.getHours())}:${q(d.getMinutes())}`; })(); ig.fire('input');
  storage.saveWeek({ ...storage.getWeek('lc4g'), status: 'live' });
  wg.querySelector('#late-entry-confirm').fire('click');
  await new Promise((rr) => setTimeout(rr, 20));
  const eg = wg.querySelector('#late-entry-error');
  assert(eg.textContent === ww.LATE_ENTRY_COPY.NOT_LOCKED && eg.classList.contains('is-visible') && storage.getWeek('lc4g').status === 'live' && (storage.getWeek('lc4g').picksLockAt ?? null) === null && !!reg.get('late-entry-sheet-wrap'),
    '[4zf] the week went live while the sheet was open: Confirm writes nothing, the sheet stays up, and its own sentence stays VISIBLE (a failure message painted before refresh() was wiped by it)', JSON.stringify({ text: eg.textContent, vis: eg.classList.contains('is-visible') }));
  assert(/no longer locked/.test(ww.LATE_ENTRY_COPY.NOT_LOCKED) && !/connection/i.test(ww.LATE_ENTRY_COPY.NOT_LOCKED) && ww.LATE_ENTRY_COPY.SAVE_FAILED.includes('Check your connection'), '[4zg] the not-locked sentence is its own (it does not tell a commissioner to check a connection that is fine)');
  app._resetLateEntryForTest();
}

// ── N1 against the REAL adapter: a weeks write the server answers 503 is a RETRY, not a success — the re-open must never be planned ahead of the lock time it depends on ──
{
  const { auth, sbm, standUp, tearDown, quiet } = world;
  const L = 'L-lock4z';
  const rows = {
    league_members: [{ league_id: L, id: 'p1', user_id: 'u-drew', role: 'commissioner', display_name: 'Drew', initials: 'DH', alma_mater: '', active: true, notify_prefs: {}, preferences: {}, extra: {} }],
    weeks: [{ league_id: L, id: 'w4z', sport: 'cfb', season: '2026', week_number: 7, label: 'Week 7', status: 'locked', picks_lock_at: null, auto_lock_offset_minutes: 30, revealed_at: null, locked_at: iso(NOW - 20 * MIN), locked_alma_maters: null, pending_finalization: false, extra: {} }],
    games: [{ league_id: L, id: 'g4z', week_id: 'w4z', home_team: 'Home', away_team: 'Away', status: 'scheduled', kickoff: iso(NOW + 10 * MIN), spread: -3.5, favorite: 'Home', multiplier: 1, home_score: 0, away_score: 0, last_updated: null, ats_winner: null, extra: {} }],
  };
  const ctl = { picksSends: 0, refuse: false, weeksWrite: 'transient' };
  const { landed, detach } = await standUp({ L, rows, ctl, role: 'commissioner', userId: 'u-drew', memberId: 'p1' });
  assert(landed === true && storage.getWeek('w4z')?.status === 'locked' && app.isSupabaseDataMode?.() !== false, '[4zz-0] fixture: a commissioner on the REAL adapter, a LOCKED week whose lock instant (kickoff - 30 min) passed 20 minutes ago');
  const sentAt = iso(Date.now() + 25 * MIN);
  const r1 = await quiet(() => app.applyLateEntry({ weekId: 'w4z', atIso: sentAt }));
  const wk = storage.getWeek('w4z');
  const planned = sbm.planFlush().plan.map((o) => o.name || `${o.op}:${o.rowId || ''}`);
  assert(r1.ok === false && r1.reason === 'save_failed' && wk.status === 'locked' && (wk.picksLockAt ?? null) === null,
    `[4zz-1] the server answered 503 to the picks_lock_at write (the adapter HOLDS it for a retry, {retrying:[cfbp_weeks]}): the late entry FAILS, the week stays LOCKED and the old lock time is back (${JSON.stringify({ r1, status: wk.status, lock: wk.picksLockAt })})`);
  assert(!planned.includes('transition_week') && !ctl.calls.some((c) => c.rpc === 'transition_week'),
    `[4zz-2] …and the planner NEVER planned or sent transition_week(open) (the pre-fix order was open-before-lock-time; planned now: ${JSON.stringify(planned)})`);
  // N1, the realistic form of "a result that does not name cfbp_weeks is no evidence it was sent": the player's own pick write is queued BEFORE the week patch (dirtied first) and the server answers 503 to
  // it, so the batch STOPS at the pick and the week patch never leaves. flush() reports {retrying:['cfbp_picks']} — no mention of cfbp_weeks. Only the planner's answer (is the patch still waiting?) tells.
  await quiet(() => sbm._resetForTest());
  ctl.weeksWrite = 'ok'; ctl.picksWrite = 'transient'; ctl.calls.length = 0;
  await tearDown(detach);
  const stop = await standUp({ L, rows, ctl, role: 'commissioner', userId: 'u-drew', memberId: 'p1' });
  storage.saveAllPicks([{ pickId: 'pk_4z', weekId: 'w4z', gameId: 'g4z', playerId: 'p1', selectedTeam: 'Home', selectedAt: iso(Date.now()), updatedAt: iso(Date.now()), locked: false, result: 'pending' }]);
  const r3 = await quiet(() => app.applyLateEntry({ weekId: 'w4z', atIso: sentAt }));
  const sawWeekWrite = ctl.calls.some((c) => c.table === 'weeks');
  assert(r3.ok === false && r3.reason === 'save_failed' && storage.getWeek('w4z').status === 'locked' && (storage.getWeek('w4z').picksLockAt ?? null) === null && !sawWeekWrite && !ctl.calls.some((c) => c.rpc === 'transition_week'),
    `[4zz-4] the batch stopped at an earlier 503 so the week patch NEVER went (no weeks write on the wire): the late entry FAILS, the week stays LOCKED, the old lock time is back and no transition_week was sent (${JSON.stringify({ r3, status: storage.getWeek('w4z').status, wire: ctl.calls.map((c) => c.rpc || `${c.table}.${c.op}`) })})`);
  // the production probe, directly, against the real adapter
  const probe = app._lateEntryLockWritePendingForTest;
  await quiet(() => sbm._resetForTest());
  ctl.picksWrite = 'ok'; ctl.calls.length = 0;
  await tearDown(stop.detach);
  const pr = await standUp({ L, rows, ctl, role: 'commissioner', userId: 'u-drew', memberId: 'p1' });
  assert(pr.landed === true && probe('w4z') === false, '[4zz-5] the probe on a freshly hydrated adapter with nothing dirty: the lock-time write is NOT pending');
  storage.saveWeek({ ...storage.getWeek('w4z'), picksLockAt: sentAt });
  assert(probe('w4z') === true && probe('some_other_week') === false, '[4zz-5] …a picks_lock_at patch queued for THIS week row is pending (and only for that week)');
  storage.saveWeek({ ...storage.getWeek('w4z'), picksLockAt: null });
  assert(probe('w4z') === false, '[4zz-5] …and once the value is back to what the server holds the patch is gone (only the updated_at stamp is left, which is not the lock time)');
  sbm._setStateForTest('HELD');
  assert(probe('w4z') === true, '[4zz-5] …and an adapter that is not ACTIVE plans nothing and sends nothing, so the answer is PENDING (fail closed), not "nothing waiting"');
  sbm._setStateForTest('ACTIVE');
  await tearDown(pr.detach);
  // the healthy path on the same adapter: the patch goes FIRST (while locked), the re-open second, in that wire order
  ctl.weeksWrite = 'ok'; ctl.calls.length = 0;
  rows.weeks[0].status = 'locked'; rows.weeks[0].picks_lock_at = null;
  const again = await standUp({ L, rows, ctl, role: 'commissioner', userId: 'u-drew', memberId: 'p1' });
  const r2 = await quiet(() => app.applyLateEntry({ weekId: 'w4z', atIso: sentAt }));
  await quiet(() => sbm.flush());
  const wire = ctl.calls.map((c) => c.rpc || `${c.table}.${c.op}${c.patch && 'picks_lock_at' in c.patch ? '(picks_lock_at)' : ''}`);
  assert(r2.ok === true && storage.getWeek('w4z').status === 'open' && wire.indexOf('weeks.update(picks_lock_at)') > -1 && wire.indexOf('weeks.update(picks_lock_at)') < wire.findIndex((x) => /transition_week/.test(x)),
    `[4zz-3] a healthy write: picks_lock_at reaches the server BEFORE transition_week(open) (wire order ${JSON.stringify(wire)})`);
  await tearDown(again.detach);
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n[5] Gesture registration of the sixth sheet, and the source pins…');
// ══════════════════════════════════════════════════════════════════════════
{
  const sheet = makeEl(); sheet.id = 'late-entry-sheet-wrap';
  assert(nav.gesturesSuspended() === true, '[5a] gesturesSuspended() is TRUE while #late-entry-sheet-wrap exists: a week-swipe / pull-to-refresh on the page beneath must not arm');
  reg.delete('late-entry-sheet-wrap');
  assert(nav.gesturesSuspended() === false, '[5b] …and false again once it is gone (non-vacuity: nothing else was suspending)');
  const appSrc = await read('./js/app.js');
  const ccSrc = await read('./js/control-center.js');
  assert(/getElementById\?\.\('late-entry-sheet-wrap'\)/.test(ccSrc) && /!excludeLateEntry && document\.getElementById\('late-entry-sheet-wrap'\)/.test(appSrc) && /excludeLateEntry: true/.test(appSrc), '[5c] the drawer\'s edge-swipe guard and the shared dismiss-blocking list both name the sheet, and its own drag excludes only itself');
  const fn = appSrc.slice(appSrc.indexOf('export async function applyLateEntry('), appSrc.indexOf('async function confirmLateEntry('));
  const code = fn.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert(code.indexOf('saveWeek({ ...cur, picksLockAt: atIso })') > -1 && code.indexOf('saveWeek({ ...cur, picksLockAt: atIso })') < code.indexOf('await flush()') && code.indexOf('await flush()') < code.indexOf('applyWeekStatusChange({ ...upd, picksLockAt: atIso }, WEEK_STATUS.OPEN)'),
    '[5d] applyLateEntry\'s source order is: save picksLockAt (locked) -> await the flush -> the existing re-open transition');
  assert(/maybeOpenLateEntrySheet\(getWeek\(week\.weekId\)\|\|week,\{onDone:\(\)=>renderCommPage\(\)\}\)\)return;/.test(appSrc) && /maybeOpenLateEntrySheet\(liveWeekForStatus, \{ onDone: \(\) => \{ renderWeekWizardSheetBody\(\); renderCommPage\(\); \} \}\)\) return;/.test(appSrc),
    '[5e] BOTH re-open buttons (the Comm Week tab and the wizard\'s Manage screen) go through the same interception, and only for to === \'open\'');
  assert(!/showToast\([^)]*\{\s*html:\s*true/.test(fn + appSrc.slice(appSrc.indexOf('export function maybeNoticeUnfrozenSpreads('), appSrc.indexOf('export function maybeNoticeUnfrozenSpreads(') + 900)) && !/escHtml\(`?\$\{?g\.(?:awayTeam|homeTeam)/.test(appSrc.slice(appSrc.indexOf('export function unfrozenSpreadToastText('), appSrc.indexOf('export function unfrozenSpreadToastText(') + 400)),
    '[5f] SC-P9: neither the unfrozen-spread toast nor the late-entry toast passes {html:true} or pre-escapes its data');
  const css = await read('./css/styles.css');
  assert(/\.beb-retry, \.beb-close\{min-height:40px;min-width:40px\}/.test(css) && /@media \(max-width:480px\)\{ \.beb-inner\{[^}]*\} \.beb-retry, \.beb-close\{[^}]*min-height:40px;min-width:40px\}/.test(css.replace(/\s+/g, ' ')), '[5g] the banner\'s Retry and Dismiss have a 40px floor at BOTH breakpoints (touched-screen audit)');
  assert(/\.late-entry-consequence\{margin:8px 0 0;min-height:calc\(3 \* 1\.4em\);/.test(css), '[5h2] N3: the consequence region keeps a FIXED three-line height (one sentence wraps to two at 375pt, plus the clause) so toggling the clause never moves the buttons');
  const cssFlat = css.replace(/\s+/g, ' ');
  assert(/\.beb-retry:active, \.beb-close:active\{transform:scale\(\.97\)\}/.test(cssFlat) && /\.beb-retry, \.beb-close\{transition:transform var\(--motion-fast\) var\(--ease-native\)\}/.test(cssFlat)
    && /@media \(prefers-reduced-motion:reduce\)\{ \.beb-retry, \.beb-close\{transition:none\} \.beb-retry:active, \.beb-close:active\{transform:none\} \}/.test(cssFlat)
    && /#late-entry-sheet \.chat-sheet-close\{transition:transform var\(--motion-fast\) var\(--ease-native\)\} #late-entry-sheet \.chat-sheet-close:active\{transform:scale\(\.97\)\} @media \(prefers-reduced-motion:reduce\)\{#late-entry-sheet \.chat-sheet-close\{transition:none\}#late-entry-sheet \.chat-sheet-close:active\{transform:none\}\}/.test(cssFlat),
    '[5h3] N7: the banner\'s Retry / Dismiss and the Late Entry sheet\'s close button compress to 97% on touch and return over --motion-fast, and Reduce Motion turns both off (the sheet\'s rule is scoped to its own id: the shared .chat-sheet-close is untouched)');
  assert(cssFlat.indexOf('.chat-sheet-close{') === cssFlat.indexOf('.chat-sheet-close{background:var(--bg-input);') && /#late-entry-sheet \.chat-sheet-close\{width:40px;height:40px;/.test(cssFlat),
    '[5h3b] the FIRST `.chat-sheet-close{` in the stylesheet is still the shared rule (controlcolortest [3b]\'s mutation edits the first match, so a scoped rule written above it silently blinds that test)');
  assert(!/(?<!#late-entry-sheet |#sort-sheet |#chat-thread-sheet |#share-sheet )\.chat-sheet-close\{[^}]*(?:transform|scale)/.test(css) && !/(?<!#late-entry-sheet |#sort-sheet |#chat-thread-sheet |#share-sheet )\.chat-sheet-close:active/.test(css) && /\.chat-sheet-close\{background:var\(--bg-input\);color:var\(--text-primary\);border:none;border-radius:50%;width:30px;height:30px;cursor:pointer\}/.test(css), '[5h4] the shared .chat-sheet-close rule is byte-for-byte what it was (30px, no transform): the late-entry sheet\'s size and feedback are scoped to #late-entry-sheet (and the Sort sheet\'s to #sort-sheet, the thread sheet\'s to #chat-thread-sheet and Share\'s to #share-sheet)');
  assert(/#late-entry-sheet\{transform:translateY\(calc\(100% \* var\(--late-drag-y,0\)\)\)/.test(css) && /prefers-reduced-motion:reduce\)\{#late-entry-sheet/.test(css) && /\.late-entry-actions\{margin-top:16px\}/.test(css), '[5h] the sheet\'s drag, Reduce Motion and 16pt footer spacing are in the stylesheet');
  const dm = await read('./js/data-model.js');
  // D1 / DI-512 (2026-10-07) settled the wording: the default rule names no number and points at the time the Picks page shows. The OLD sentence survives ONLY as the exact-match key of the
  // render-time legacy table (weeklocktest.mjs proves the table), never as a default rule.
  assert(/export const RULES_LOCK_SENTENCE = 'Picks lock before the first kickoff of the week, usually 30 minutes before, at the time shown on the Picks page\. After that, no picks or guesses are accepted\.';/.test(dm) && /^    RULES_LOCK_SENTENCE,$/m.test(dm)
    && (dm.match(/Games lock at kickoff\./g) || []).length === 1 && /from: 'Games lock at kickoff\. If the week is locked, no picks are accepted even for future games\.'/.test(dm),
    '[5i] the Rules line no longer says "Games lock at kickoff" (it never was true): the default rule is the DI-512 sentence, and the old one is only the exact-match key of the render-time legacy table (Drew: ok to change wording)');
  // the stale premise is gone from the tick's comment
  assert(/CORRECTED 2026-10-01 \(PF-1, migration 0043\)/.test(appSrc), '[5j] the tick\'s "residual" comment records that its old premise (picks_lock_at refused a late pick server-side) was never true');
}

// D1 integration 18: let submitPicks()'s 300 ms post-submit repaint (see the scrollTo stub above) run before the summary, so it runs at a fixed point in every run.
await new Promise((r) => setTimeout(r, 350));
console.log(`\n${pass} passed, ${fail} failed.`);
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
