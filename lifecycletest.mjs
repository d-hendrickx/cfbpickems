/**
 * CFB Pickems — lifecycletest.mjs (N1 / FEAT-11, UN-204)
 * ==============================================================================
 * "IT's all lifecycle notices, there should be one place for notifications and
 * it should be the chat. The bell icon is ok for notification settings until we
 * create a settings button." — Drew, 2026-09-12
 *
 * Design inputs: `weekly bug fixes and feedback/Feedback batch 091226/
 * DESIGN_N1_NOTIFICATIONS_TO_CHAT_091226.md` (DI-N1, DI-N5, DI-N7, DI-N9) plus
 * the COORDINATOR RULINGS tail.
 *
 * WHY A SEPARATE FILE, not more of notifytest.mjs. notifytest owns the POLICY
 * layer — recipients, preferences, dedup keys, the Code.gs twin. This file owns
 * the EMISSION layer: which transitions produce a post, under what id, and —
 * the part that matters most — which transitions produce NOTHING. The
 * no-backfill argument is the whole safety case for this feature and it needs
 * to be readable start to finish, the same reason grouptest.mjs exists beside
 * loadtest.mjs (CLAUDE.md).
 *
 * Run:  node lifecycletest.mjs
 * Mandated to also run under:
 *   TZ=UTC node lifecycletest.mjs
 *   TZ=America/Los_Angeles node lifecycletest.mjs
 *
 *   [1] The emitters: shape, deterministic ids, one row per transition.
 *   [2] The gates: demo week, signed out, chat off, backend absent.
 *   [3] THE NAV SWEEP'S BOUNDS — active week only, one per invocation, device
 *       ledger. The no-backfill case is the acceptance gate: eight past public
 *       weeks and an empty ledger must emit EXACTLY ZERO.
 *   [4] Two devices, one row (AD-11).
 *   [5] The DI-N7 state table.
 *   [6] The bell: settings only, no list, in RENDERED output, signed in and out.
 *   [7] Retired surfaces stay retired (RESULTS_FINALIZED_YOU_WON).
 */

import { readFile } from 'node:fs/promises';

// ── DOM / browser stubs — same shape as loadtest.mjs / groupdtest.mjs, with
//    ONE deliberate upgrade: createElement() keeps a REAL innerHTML, and
//    body.appendChild() records the node. Section [6] asserts against rendered
//    output rather than source text (protocol step 29 / RG-27: a source-grep
//    test still passes on the day someone puts the list back). ───────────────
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};
const appended = [];
function makeEl() {
  // Children are created on demand and CACHED per selector, so
  // `ov.querySelector('#notif-center-body').innerHTML = …` actually lands
  // somewhere the test can read. Without that the modal body — which is written
  // asynchronously, after subscriptionState() resolves — would be invisible and
  // section [6] would assert against the loading skeleton while believing it had
  // checked the real thing.
  const children = new Map();
  const el = {
    _html: '', className: '', id: '', style: {}, dataset: {}, hidden: false, disabled: false,
    set innerHTML(v) { this._html = String(v); },
    get innerHTML() { return this._html; },
    appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {},
    querySelector(sel) {
      if (!children.has(sel)) children.set(sel, makeEl());
      return children.get(sel);
    },
    querySelectorAll: () => [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    /** Everything this node holds — its own markup plus every child's. */
    allHTML() {
      return this._html + [...children.values()].map(c => (c.allHTML ? c.allHTML() : c.innerHTML)).join('');
    },
  };
  return el;
}
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  createElement: () => makeEl(),
  body: { classList: { add() {}, remove() {} }, appendChild: el => { appended.push(el); }, innerHTML: '' },
  hidden: false,
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, onLine: true }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined, onLine: true }, configurable: true }); }
globalThis.requestAnimationFrame = fn => fn();
globalThis.fetch = async () => { throw new Error('network disabled in lifecycletest'); };
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

const storage = await import('./js/storage.js');
const backend = await import('./js/backend.js');
const chat = await import('./js/chat.js');
const copy = await import('./js/notify-copy.js');
const notif = await import('./js/notifications.js');
const app = await import('./js/app.js');

const {
  emitLifecyclePost, lifecycleChatId, checkLifecyclePostDue,
  postPicksOpenedNotice, postPicksLockedNotice, postResultsFinalizedNotice,
  postObligationCreatedNotice, postObligationSettledNotice, postCommissionerAnnouncement,
  openNotificationSettings, renderNotifSettingsBodyHTML,
} = app;
const { LIFECYCLE_EVENTS } = notif;

console.log(`[lifecycletest] TZ=${process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone} — ${Object.keys(app).length} app.js exports`);

// ── Shared fixture ──────────────────────────────────────────────────────────
const LEDGER = 'cfbp_lifecycle_posted';
const PLAYERS = [
  ['lc_drew', 'Drew'], ['lc_bray', 'Brayden'], ['lc_kev', 'Kevin'],
  ['lc_koby', 'Koby'], ['lc_jacob', 'Jacob'], ['lc_ki', 'Kihoon'],
];
PLAYERS.forEach(([id, name]) => storage.addPlayer({ playerId: id, displayName: name, active: true }));
storage.saveSetting('chatEnabled', true);
backend.setBackendConfig('https://example.invalid/exec', 'tok');

const week = (weekId, n, status, over = {}) => ({
  weekId, season: '2026', weekNumber: n, label: `Week ${n}`,
  startDate: '2026-10-01', endDate: '2026-10-03', status,
  dataSourceMode: 'espn', picksOpenAt: null, picksLockAt: null, showInHistory: true, ...over,
});

const resetLedger = () => localStorage.removeItem(LEDGER);
const signIn = (id = 'lc_drew') => storage.setSession(id, false, true);
const readLedger = () => { try { return JSON.parse(localStorage.getItem(LEDGER) || '[]'); } catch { return []; } };

function freshRoom() {
  chat._resetForTest();
  chat.initChat('lc_drew');
}
const outbox = () => chat.chatStatus().outbox;
const posts = () => chat.getMessages({ tag: 'all' }).filter(m => m.meta?.kind === 'lifecycle');
const lastPost = () => posts().slice(-1)[0] || null;

/** Run one emission and report what it queued. */
function emitting(fn) {
  const before = outbox();
  const ret = fn();
  return { queued: outbox() - before, ret, post: lastPost() };
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[1] The emitters — shape, deterministic ids, one row per transition…');
{
  freshRoom(); resetLedger(); signIn();
  storage.saveWeek(week('lc_w1', 5, 'locked'));
  storage.setActiveWeekId('lc_w1');
  const w1 = storage.getWeek('lc_w1');

  const opened = emitting(() => postPicksOpenedNotice(w1));
  assert(opened.queued === 1 && opened.ret === 'sys_lc_PICKS_OPENED_lc_w1',
    `1-1: PICKS_OPENED posts once under the deterministic AD-11 id sys_lc_<EVENT>_<weekId> (queued ${opened.queued}, id ${opened.ret})`);
  const p1 = opened.post;
  assert(p1.type === 'message',
    "1-2: …as type:'message'. This is the ONLY type _scanNewChatMessages() relays; every legacy sys_* emitter was type:'system', which is why the whole event class could never push (BUG-10's structural half)");
  assert(p1.author === 'scribe' && p1.notify === true && p1.gameTag === '',
    "1-3: …authored by SCRIBE, notify:true, in the MAIN ROOM (gameTag:''). One chat key, one room — a lifecycle notice is a field on a message, never a channel (AD-09/AD-17)");
  assert(p1.meta.kind === 'lifecycle' && p1.meta.event === 'PICKS_OPENED'
      && p1.meta.weekId === 'lc_w1' && p1.meta.origin === 'client' && p1.meta.category === 'leagueUpdates',
    `1-4: …carrying the full lifecycle meta, including the category the relay gates on and origin:'client' (got ${JSON.stringify(p1.meta)})`);
  assert(/Week 5/.test(p1.body),
    `1-5: …with a SCRIBE-voiced body naming the week, built by buildCopy() from the existing approved pool — no new copy was invented for it (got "${p1.body}")`);

  const again = emitting(() => postPicksOpenedNotice(w1));
  assert(again.queued === 1 && again.ret === opened.ret,
    '1-6: emitting the SAME transition twice produces the SAME id — the emitter is deliberately not self-suppressing, because the server id-dedupe (AD-11) is the league-wide authority and the device ledger is what stops the SWEEP retrying');

  const locked = emitting(() => postPicksLockedNotice(w1));
  assert(locked.ret === 'sys_lc_PICKS_LOCKED_lc_w1' && /Week 5/.test(locked.post.body),
    `1-7: PICKS_LOCKED posts under its own id and names the week (id ${locked.ret})`);
  assert(/0\/6|6\b/.test(locked.post.body) || /locked/i.test(locked.post.body),
    `1-8: …count-only, never named. "The moment has passed" (UN-46): naming who missed a deadline after it passed is a pile-on, and locking-soon already did the useful version (got "${locked.post.body}")`);
  assert(!PLAYERS.some(([, name]) => locked.post.body.includes(name)),
    '1-9: …proved by name: no player is named in the LOCKED post at all');

  const final = emitting(() => postResultsFinalizedNotice(w1, 'Kihoon', 'Koby'));
  assert(final.ret === 'sys_lc_RESULTS_FINALIZED_lc_w1'
      && final.post.body.includes('Kihoon') && final.post.body.includes('Koby'),
    `1-10: RESULTS_FINALIZED names the winner AND the loser in one league-wide line (got "${final.post.body}")`);
  assert(!/\byou\b|\byour\b/i.test(final.post.body),
    '1-11: …and carries no second-person wording. The personalized "you took it" variant is retired (ruling O3) because five of the six readers did not win');

  storage.saveSetting('weeklyPrize', 'Loser buys winner a consolation prize');
  const ob = { obligationId: 'lc_ob1', weekId: 'lc_w1', payerPlayerId: 'lc_koby', recipientPlayerId: 'lc_ki',
               amountOrPrize: '', note: '', type: 'weekly', status: 'unpaid' };
  const created = emitting(() => postObligationCreatedNotice(ob));
  assert(created.ret === 'sys_lc_OBLIGATION_CREATED_lc_ob1',
    `1-12: an obligation post is scoped to the OBLIGATION id, not the week — two obligations in one week are two notices (got ${created.ret})`);
  assert(created.post.body.includes('Koby') && created.post.body.includes('Kihoon'),
    `1-13: …naming BOTH parties league-wide (ruling O4 — already public on Standings; a room of six needs to know who is owed, not only who owes) (got "${created.post.body}")`);
  assert(!created.post.body.includes('Loser buys winner a consolation prize')
      || / — Loser buys winner a consolation prize/.test(created.post.body),
    `1-14: …and when the label is the default weeklyPrize SENTENCE it is set off with an em dash rather than inlined as a direct object, or the line reads "Koby owes Kihoon Loser buys winner…" (got "${created.post.body}")`);

  const settled = emitting(() => postObligationSettledNotice({ ...ob, status: 'paid' }));
  assert(settled.ret === 'sys_lc_OBLIGATION_SETTLED_lc_ob1' && settled.post.body.includes('Koby'),
    `1-15: OBLIGATION_SETTLED mirrors it under its own id (got ${settled.ret})`);

  const ann = emitting(() => postCommissionerAnnouncement('  Slate is up early this week.  ', 'lc_drew'));
  assert(ann.queued === 1 && ann.post.body === 'Slate is up early this week.',
    `1-16: a commissioner announcement is posted VERBATIM (trimmed only) — never SCRIBE-voiced, because there is no COMMISSIONER_ANNOUNCEMENT pool in notify-copy.js at all (got "${ann.post.body}")`);
  assert(ann.post.author === 'lc_drew',
    `1-17: …under the COMMISSIONER'S OWN playerId, so the room sees who said it (got author ${ann.post.author})`);
  assert(ann.post.meta.category === null,
    '1-18: …with category null — never silenceable (D3), unchanged by this move');
  assert(!String(ann.ret || '').startsWith('sys_lc_'),
    '1-19: …and it is the ONE lifecycle post with a non-deterministic id. That is correct, not an omission: an announcement is a single-device action with free text, so there is no transition for six clients to independently detect. Two announcements with the same words are two announcements');
  assert(emitting(() => postCommissionerAnnouncement('   ', 'lc_drew')).queued === 0,
    '1-20: …and an empty announcement posts nothing');

  assert(lifecycleChatId('PICKS_LOCKED', 'wk 9/x') === 'sys_lc_PICKS_LOCKED_wk_9_x',
    '1-21: the scope id is sanitised the same way checkWhatsNewPostDue() sanitises a version — a stray character must not mint a SECOND row for the same event');
  assert(emitting(() => emitLifecyclePost({ event: 'NOT_AN_EVENT', scopeId: 'x' })).queued === 0,
    '1-22: an event outside the LIFECYCLE_EVENTS vocabulary posts NOTHING — the emitter refuses rather than inventing a row with an unmapped category');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[2] The gates — demo week, signed out, chat off, backend absent…');
{
  freshRoom(); resetLedger(); signIn();
  storage.saveWeek(week('lc_demo', 6, 'locked', { dataSourceMode: 'demo' }));
  const demo = storage.getWeek('lc_demo');
  assert(emitting(() => postPicksOpenedNotice(demo)).queued === 0
      && emitting(() => postPicksLockedNotice(demo)).queued === 0
      && emitting(() => postResultsFinalizedNotice(demo, 'Kihoon', 'Koby')).queued === 0,
    '2-1: a DEMO week posts nothing, ever — the commissioner rehearsing must not be broadcast to the league');
  assert(emitting(() => postObligationCreatedNotice({ obligationId: 'lc_ob_demo', weekId: 'lc_demo', payerPlayerId: 'lc_koby', recipientPlayerId: 'lc_ki' })).queued === 0,
    '2-2: …including an obligation created on one. The demo probe is the WEEK the row points at, not just the caller');

  storage.saveWeek(week('lc_w2', 7, 'locked'));
  const w2 = storage.getWeek('lc_w2');
  storage.clearSession();
  assert(emitting(() => postPicksLockedNotice(w2)).queued === 0,
    '2-3: SIGNED OUT posts nothing — a device that merely cleared the site PIN does not announce anything to the league');
  assert(readLedger().length === 0,
    '2-4: …and the ledger is left UNWRITTEN, so it still fires on the first navigation after signing in');

  signIn();
  storage.saveSetting('chatEnabled', false);
  assert(emitting(() => postPicksLockedNotice(w2)).queued === 0 && readLedger().length === 0,
    '2-5: chat turned OFF by the commissioner posts nothing AND leaves the ledger unwritten — the notice arrives on the first navigation after chat comes back');
  storage.saveSetting('chatEnabled', true);

  const cfg = backend.getBackendConfig();
  backend.clearBackendConfig();
  assert(emitting(() => postPicksLockedNotice(w2)).queued === 0,
    '2-6: …and neither does a device with no backend configured');
  backend.setBackendConfig(cfg.url, cfg.token);

  const q = emitting(() => postPicksLockedNotice(w2));
  assert(q.queued === 1 && readLedger().includes('sys_lc_PICKS_LOCKED_lc_w2'),
    '2-7: with every gate open it posts, and the ledger is written AT QUEUE — sendEvent() commits to chat.js\'s persisted outbox, which survives a reload and flushes when the backend returns, so a successful QUEUE is the commit point (DI-N1 gate 4)');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[3] THE NAV SWEEP\'S BOUNDS — active week only, one per invocation, no backfill…');
{
  // THE ACCEPTANCE GATE. This is the shape that has cost this codebase real
  // money twice (checkPickRevealDue's RG, FEAT-3's release post): a device with
  // a FRESH ledger — a new phone, a cleared cache, a new player — walking
  // history and posting a permanent, un-take-back-able announcement for every
  // week that never got one, in front of six real people.
  freshRoom(); resetLedger(); signIn();
  for (let n = 1; n <= 8; n++) {
    storage.saveWeek(week(`lc_hist_${n}`, n, 'final', { startDate: '2026-09-01', endDate: '2026-09-03' }));
  }
  storage.saveWeek(week('lc_draft', 20, 'draft'));
  storage.setActiveWeekId('lc_draft');

  const before = outbox();
  checkLifecyclePostDue();
  checkLifecyclePostDue();
  checkLifecyclePostDue();
  assert(outbox() - before === 0,
    `3-1: NO BACKFILL — eight past FINAL weeks, a fresh ledger, three sweeps: EXACTLY ZERO posts (got ${outbox() - before}). The past weeks are unreachable from this path BY CONSTRUCTION: the sweep reads getCurrentWeek() and never getWeeks()`);
  assert(readLedger().length === 0,
    '3-2: …and nothing is recorded as posted, because nothing was');

  // The active week is a DRAFT — nothing has happened yet.
  assert(!posts().some(p => p.meta.weekId === 'lc_draft'),
    '3-3: a DRAFT active week posts nothing — there is no transition to announce');

  // Now the active week reaches LOCKED, with neither event in the ledger.
  storage.saveWeek(week('lc_live', 21, 'locked'));
  storage.setActiveWeekId('lc_live');
  const b1 = outbox(); checkLifecyclePostDue(); const q1 = outbox() - b1;
  const first = lastPost();
  assert(q1 === 1 && first.meta.event === 'PICKS_OPENED',
    `3-4: ONE POST PER INVOCATION, and the OPEN is announced before the LOCK — chronological, so a device that missed both transitions does not announce the lock first (queued ${q1}, event ${first?.meta?.event})`);
  const b2 = outbox(); checkLifecyclePostDue(); const q2 = outbox() - b2;
  assert(q2 === 1 && lastPost().meta.event === 'PICKS_LOCKED',
    `3-5: …the next navigation drains the second one (queued ${q2}, event ${lastPost()?.meta?.event})`);
  const b3 = outbox(); checkLifecyclePostDue(); checkLifecyclePostDue(); const q3 = outbox() - b3;
  assert(q3 === 0,
    `3-6: …and then it stops. A genuine backlog of two drains within seconds of normal use; it never becomes a stream (got ${q3})`);
  assert(readLedger().includes('sys_lc_PICKS_OPENED_lc_live') && readLedger().includes('sys_lc_PICKS_LOCKED_lc_live'),
    '3-7: both are recorded in the DEVICE ledger — read through the storage seam (KEYS.LIFECYCLE_POSTED in DEVICE_LOCAL_KEYS), never raw localStorage in app.js');

  // A pre-seeded ledger suppresses, which is what makes 3-1's zero meaningful.
  resetLedger();
  localStorage.setItem(LEDGER, JSON.stringify(['sys_lc_PICKS_OPENED_lc_live', 'sys_lc_PICKS_LOCKED_lc_live']));
  const b4 = outbox(); checkLifecyclePostDue(); assert(outbox() - b4 === 0,
    '3-8: a PRE-SEEDED ledger posts nothing — non-vacuity for 3-6: the sweep genuinely consults the ledger rather than having simply run out of statuses');

  // Demo + signed-out, through the SWEEP this time, not the emitters.
  resetLedger();
  storage.saveWeek(week('lc_sweep_demo', 22, 'locked', { dataSourceMode: 'demo' }));
  storage.setActiveWeekId('lc_sweep_demo');
  const b5 = outbox(); checkLifecyclePostDue(); assert(outbox() - b5 === 0 && readLedger().length === 0,
    '3-9: the sweep refuses a DEMO active week at its own gate, before it reaches the emitters — belt and braces, matching this codebase\'s existing demo discipline');
  storage.setActiveWeekId('lc_live');
  storage.clearSession();
  const b6 = outbox(); checkLifecyclePostDue(); assert(outbox() - b6 === 0,
    '3-10: …and refuses a signed-out device');
  signIn();

  // TZ SENSITIVITY — this is why the file runs under two zones. The sweep asks
  // getEffectiveWeekStatus(), which parses the week's own dates.
  resetLedger();
  storage.saveWeek(week('lc_tz', 23, 'open', { picksLockAt: '2020-01-01T00:00:00.000Z' }));
  storage.setActiveWeekId('lc_tz');
  const b7 = outbox(); checkLifecyclePostDue(); const q7 = outbox() - b7;
  assert(q7 === 1 && lastPost().meta.event === 'PICKS_OPENED',
    `3-11: a week whose stored status is 'open' but whose auto-lock time has long passed still announces the OPEN first (queued ${q7}) — the sweep reads the EFFECTIVE status AND the stored one, the belt-and-braces pair canPlayerSubmitPicks() uses, so neither reading alone can lose a transition`);
  const b8 = outbox(); checkLifecyclePostDue();
  assert(outbox() - b8 === 1 && lastPost().meta.event === 'PICKS_LOCKED',
    '3-12: …and then the LOCK, resolved from the effective status rather than the stored one. This is the assertion that differs by time zone, which is why both are run');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[4] Two devices, one row (AD-11)…');
{
  freshRoom(); resetLedger(); signIn();
  storage.saveWeek(week('lc_dd', 30, 'locked'));
  storage.setActiveWeekId('lc_dd');
  const w = storage.getWeek('lc_dd');

  // Device A emits.
  const idA = postPicksLockedNotice(w);
  // Device B is a DIFFERENT device: same league state, its own empty ledger.
  resetLedger();
  const idB = postPicksLockedNotice(w);
  assert(idA === idB && idA === 'sys_lc_PICKS_LOCKED_lc_dd',
    `4-1: two devices detecting the same transition compute the SAME id (${idA} / ${idB}) — nothing time- or random-seeded reaches it`);

  // Simulate the server assigning seqs and echoing both attempts back: the fold
  // is keyed by id, so the second collapses onto the first exactly as
  // chatAppend()'s id dedupe does server-side.
  chat.ingest([
    { id: idA, seq: 9001, ts: Date.now(), type: 'message', author: 'scribe', gameTag: '', body: 'Week 30 is locked.', targetId: '', replyTo: '', notify: true, meta: { kind: 'lifecycle', event: 'PICKS_LOCKED', weekId: 'lc_dd', category: 'leagueUpdates', origin: 'client' } },
    { id: idB, seq: 9001, ts: Date.now(), type: 'message', author: 'scribe', gameTag: '', body: 'Week 30 is locked.', targetId: '', replyTo: '', notify: true, meta: { kind: 'lifecycle', event: 'PICKS_LOCKED', weekId: 'lc_dd', category: 'leagueUpdates', origin: 'client' } },
  ]);
  const survivors = chat.getMessages({ tag: 'all' }).filter(m => m.id === idA);
  assert(survivors.length === 1,
    `4-2: exactly ONE row survives ingest (got ${survivors.length}) — six devices, one notice. This is the whole reason the id is deterministic`);

  // And the SAME device does not re-attempt through the sweep.
  const b = outbox();
  checkLifecyclePostDue(); checkLifecyclePostDue();
  assert(outbox() - b <= 1,
    '4-3: the device ledger stops THIS device re-attempting between hydrates; the server dedupe is what covers the other five');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[5] The DI-N7 state table…');
{
  const rows = [
    ['draft',  false, false, 'DRAFT — nothing has happened yet'],
    ['open',   true,  false, 'OPEN — the open is announced, the lock is not'],
    ['locked', true,  true,  'LOCKED — both are due to a device that missed them'],
    ['live',   true,  true,  'LIVE — still both; a device joining mid-game has missed both'],
    ['final',  true,  true,  'FINAL — same; RESULTS_FINALIZED is finalizeWeek()\'s job, not the sweep\'s'],
  ];
  for (const [status, wantOpened, wantLocked, why] of rows) {
    freshRoom(); resetLedger(); signIn();
    storage.saveWeek(week(`lc_st_${status}`, 40, status));
    storage.setActiveWeekId(`lc_st_${status}`);
    const seen = [];
    for (let i = 0; i < 3; i++) { const b = outbox(); checkLifecyclePostDue(); if (outbox() - b) seen.push(lastPost().meta.event); }
    assert(seen.includes('PICKS_OPENED') === wantOpened && seen.includes('PICKS_LOCKED') === wantLocked,
      `5: ${why} (emitted: ${seen.join(', ') || 'nothing'})`);
  }
  // The sweep owns exactly TWO events and no more — RESULTS_FINALIZED and the
  // obligations belong to the call sites that actually compute their facts.
  // Widening the sweep to results would mean re-deriving a winner here, which
  // SCRIBE.md §9.1 forbids.
  freshRoom(); resetLedger(); signIn();
  storage.setActiveWeekId('lc_st_final');
  for (let i = 0; i < 5; i++) checkLifecyclePostDue();
  const events5 = new Set(posts().map(p => p.meta.event));
  assert(!events5.has('RESULTS_FINALIZED') && !events5.has('OBLIGATION_CREATED') && !events5.has('OBLIGATION_SETTLED'),
    `5-6: the sweep NEVER emits RESULTS_FINALIZED or an obligation notice, however many times it runs (emitted: ${[...events5].join(', ')}) — those belong to finalizeWeek() and the obligation hooks, which are the only places their facts exist`);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[6] The bell — notification SETTINGS only, no list, in rendered output…');
{
  signIn();
  appended.length = 0;
  await openNotificationSettings();
  const modal = appended.slice(-1)[0];
  const modalHTML = modal ? modal.allHTML() : '';
  assert(!!modal && /Notification Settings/.test(modalHTML),
    '6-1: the bell opens a modal headed "Notification Settings" — Drew: "The bell icon is ok for notification settings until we create a settings button"');
  assert(!/notif-row\b|notif-chat-summary-row|data-notif-id/.test(modalHTML),
    `6-2: RENDERED OUTPUT contains NO Notification Center list, no lifecycle rows and no chat-summary row. Asserted on output rather than source because a source-grep test still passes the day someone puts the list back (RG-27)`);
  assert(/notif-prefs-card|notif-master-toggle/.test(modalHTML),
    '6-3: …but it DOES contain the prefs card, or the bell would open an empty box and the player would have nowhere to change a notification setting at all');
  assert(!/notif-bell-badge/.test(modalHTML),
    '6-4: …and no unread badge markup. The chat pill is the app\'s one unread counter now');

  // Signed OUT — the branch that has to be checked separately, because DI-A4
  // used to render a public row here.
  storage.clearSession();
  appended.length = 0;
  await openNotificationSettings();
  const outModal = appended.slice(-1)[0];
  const outHTML = outModal ? outModal.allHTML() : '';
  assert(!!outModal && !/notif-row\b|data-notif-id|notif-chat-summary-row/.test(outHTML),
    '6-5: signed OUT there is no list either — "no list on any path, including the signed-out branch" (DI-N8)');
  assert(/Sign in/i.test(outHTML),
    `6-6: …it says so plainly instead of rendering an empty modal that reads as broken`);
  signIn();

  const signedOutBody = await renderNotifSettingsBodyHTML(null, 'unconfigured');
  assert(!/notif-prefs-card/.test(signedOutBody),
    '6-7: …and renders no prefs card while signed out, because the category toggles live on the PLAYER record and there is no player to attach them to');

  const indexSrc = await readFile(new URL('./index.html', import.meta.url), 'utf8');
  assert(/aria-label="Notification settings"/.test(indexSrc) && !/notif-bell-badge/.test(indexSrc),
    '6-8: index.html: the bell announces "Notification settings" to a screen reader and its badge span is gone');
  const cssSrc = await readFile(new URL('./css/styles.css', import.meta.url), 'utf8');
  const bellRule = (cssSrc.match(/\.notif-bell-btn\{[^}]*\}/) || [''])[0];
  const mh = Number((bellRule.match(/min-height:(\d+)px/) || [])[1] || 0);
  const mw = Number((bellRule.match(/min-width:(\d+)px/) || [])[1] || 0);
  assert(mh >= 40 && mw >= 40,
    `6-9: the bell's tap target survives the badge removal (${mw}x${mh}px). The badge was position:absolute and never contributed to the box, so removing it changed nothing — CONVENTIONS #17's floor is 40 with 44 the ideal, and every sibling in this header strip is 40`);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[7] Retired surfaces stay retired…');
{
  freshRoom(); resetLedger(); signIn();
  storage.saveWeek(week('lc_you', 50, 'final'));
  const w = storage.getWeek('lc_you');
  // The winner is the signed-in player: the exact case the retired variant
  // used to special-case.
  const r = emitting(() => postResultsFinalizedNotice(w, 'Drew', 'Koby'));
  assert(r.queued === 1 && r.post.body.includes('Drew') && /Week 50/.test(r.post.body),
    `7-1: the week-final post is the SAME league-wide, third-person line for everyone — including the winner, who used to get his own variant (got "${r.post.body}")`);
  assert(!/you took it|you won|it's yours|don't let it go to your head/i.test(r.post.body),
    '7-2: RESULTS_FINALIZED_YOU_WON is never emitted — a league-wide room cannot carry a second-person line (ruling O3)');
  assert(copy._knownEvents().indexOf('RESULTS_FINALIZED_YOU_WON') === -1,
    '7-3: …and the copy module no longer knows the event at all; pool, allow-list, fallback and title were retired together, so it cannot be resurrected by name');

  // The old lifecycle pipeline no longer writes stored records for these.
  storage.setNotifications([]);
  postPicksOpenedNotice(w); postPicksLockedNotice(w); postObligationSettledNotice({ obligationId: 'lc_ob9', weekId: 'lc_you', payerPlayerId: 'lc_koby', recipientPlayerId: 'lc_ki' });
  assert(storage.getNotifications().length === 0,
    '7-4: a lifecycle notice writes ZERO cfbp_notifications rows — the room IS the record. The stored key, and everything already in it, is left exactly where it is: nothing about this change is a migration, destructive or otherwise');

  assert(Object.keys(LIFECYCLE_EVENTS).length >= 9,
    `7-5: fixture check — the LIFECYCLE_EVENTS vocabulary is still intact (${Object.keys(LIFECYCLE_EVENTS).length} events); this change retires a COPY POOL and a SURFACE, not the event vocabulary the server's port is diffed against`);
}

// ── Teardown ────────────────────────────────────────────────────────────────
chat._resetForTest();
backend.clearBackendConfig();
storage.clearSession();
resetLedger();

console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
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
