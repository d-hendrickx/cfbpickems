/**
 * CFB Pickems — notifytest.mjs (Groups A/B, UN-139…UN-148, 2026-09-10)
 * =====================================================================
 * Unit tests for the notification policy layer (js/notifications.js),
 * SCRIBE copy contract (js/notify-copy.js), and the reminder-scan decision
 * logic ported for Node testing (backend/notifyServer.mjs). Precedent:
 * grouptest.mjs (UN-118, 2026-08-13) — a math/logic proof needs to read
 * start to finish, not sit buried among chat-fold assertions.
 *
 * Run:  node notifytest.mjs
 * Must be run under BOTH TZ=UTC and TZ=America/Los_Angeles (task instruction)
 * — every time comparison in the tested code operates on epoch milliseconds
 * (Date.now()/getTime()), never wall-clock formatting, so behavior should be
 * identical under both; this file's own assertions don't format dates either,
 * so a divergence between the two runs would indicate a real TZ leak.
 *
 * Covers (Design Inputs §8 + this batch's task instructions):
 *   [1] Recipient policy — sender exclusion, category-off, all-picks-complete,
 *       the POSITIVE named-laggard case for PICKS_LOCKING_SOON.
 *   [2] Blind-rule — negative case across the full event/body matrix, and the
 *       positive case proven not-a-violation.
 *   [3] Dedup — same dedupKey twice produces one row; a simulated double-fire
 *       reminder scan produces exactly one call per threshold/player.
 *   [4] Provider isolation — no adapter registered never blocks the in-app record.
 *   [5] Deep-link table validity — every destination is a real navigateTo() tab.
 *   [6] Failure isolation — a throwing push adapter never blocks anything else.
 *   [7] The master × category truth table, explicit.
 *   [8] "No cfbp_notifications row is ever created for CHAT_MESSAGE_CREATED."
 *   [9] Mutation check on the blind-rule guard (gut it, confirm red, restore
 *       from a scratch copy — never git checkout/restore/stash).
 *   [12b]/[12c] BUG-C (2026-09-11) — a multi-page cold-boot backfill is
 *       history on EVERY page, not just the first (BUG-B's paging reopened
 *       F1 through a door F1 did not know existed), plus the relay burst cap
 *       that backstops the classification.
 *   [10]-[21] Build 1 / re-review remediations (F1-F10, BLOCKING #1/#2,
 *       NON-BLOCKING #3/#4/#5/#7) — see the section header comments above
 *       [10] and [17] for the full index.
 *   [22]/[22b] Reviewer note F1 close-out (2026-09-10) — [15]'s Code.gs
 *       twin-drift guard for resolveServerPushIntent_ only checked the
 *       function NAME, so gutting the real Code.gs body to `return true`
 *       stayed green. [22] EXECUTES the real Code.gs source (new
 *       Function(...), same technique as [15]'s SCRIBE-pool check) and
 *       proves it behaviorally against the notifyServer.mjs twin AND
 *       js/notifications.js's resolveIntent(); [22b] is the canary proving
 *       the new guard goes red on a scratch-only gutted copy — the real
 *       Code.gs is never opened for writing in either section.
 */

import { readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// ── DOM / browser stubs — identical shape to loadtest.mjs's, so both harnesses
//    exercise the real modules under the same conditions. ──────────────────
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ set innerHTML(v) {}, get innerHTML() { return ''; }, appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {}, classList: { add() {}, remove() {} }, style: {}, id: '', className: '' }),
  body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '', dataset: {} },
  hidden: false,
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined, clipboard: { writeText: async () => {} } }, configurable: true }); }
globalThis.requestAnimationFrame = fn => fn();
globalThis.fetch = async () => { throw new Error('network disabled in notifytest'); };
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

console.log(`\n[TZ] running under TZ=${process.env.TZ || '(unset)'}\n`);

const storage = await import('./js/storage.js');
const notif = await import('./js/notifications.js');
const copy = await import('./js/notify-copy.js');
const server = await import('./backend/notifyServer.mjs');
const dataModel = await import('./js/data-model.js');

storage.setBackendMode('local');
storage.initStorage();

// ── Fixtures ─────────────────────────────────────────────────────────────────
function freshPlayers() {
  const names = ['Drew', 'Brayden', 'Kevin', 'Koby', 'Jacob', 'Kihoon'];
  return names.map((n, i) => ({ ...dataModel.createPlayer(n, '', '0000', '', n[0]), playerId: `p${i + 1}`, active: true }));
}
const players = freshPlayers();
storage.getPlayers && storage.savePlayer && players.forEach(p => storage.savePlayer(p));

function freshWeek(overrides = {}) {
  return { ...dataModel.createWeek('2026', 3), weekId: 'w_test', status: 'open', dataSourceMode: 'manual', ...overrides };
}

console.log('\n[1] Recipient policy…');
{
  storage.setNotifications([]);
  // sender exclusion + positive named-laggard case, via the real orchestration functions
  const week = freshWeek();
  const nonSubmitters = ['Kevin', 'Jacob'];
  const results = notif.notifyPicksLockingSoon(week, players, nonSubmitters, 4, 6, '1h');
  assert(results.length === players.length, 'PICKS_LOCKING_SOON fires once per active player (broadcast)');
  const anyBody = results.find(r => r.fired)?.record?.body || '';
  assert(anyBody.includes('Kevin') && anyBody.includes('Jacob'),
    'POSITIVE CASE: the body names the actual non-submitting players by display name — permitted, not a violation (Drew\'s 2026-09-10 ruling)');

  // category off -> PUSH suppressed, in-app record STILL written (REMEDIATION
  // 2026-09-10 — reviewer-recommended master×category resolution; REPLACES
  // the retired "category off drops both intents" reading).
  storage.setNotifications([]);
  const p1 = players[0];
  // Force category off for p1 by writing directly to the player record (bypassing session-based setters, since these are for ANY recipient).
  const idx = storage.getPlayers().findIndex(p => p.playerId === p1.playerId);
  const withCatOff = { ...storage.getPlayers()[idx], preferences: { ...(storage.getPlayers()[idx].preferences || {}), notifyCategories: { leagueUpdates: false } } };
  const allPlayers = storage.getPlayers(); allPlayers[idx] = withCatOff; storage.saveWeek && null;
  // saveAllPicks/saveObligation etc. not needed — write players directly via the same key storage.js uses.
  storage._testonly_setPlayersRaw ? storage._testonly_setPlayersRaw(allPlayers) : writePlayersDirect(allPlayers);
  const res2 = notif.notifyPicksOpened(week, players);
  const p1Fired = res2.find(r => r.record?.playerId === p1.playerId);
  assert(!!p1Fired && p1Fired.fired === true,
    'a player with leagueUpdates OFF STILL fires (in-app record writes) — category gate controls PUSH only, per the remediated truth table');
  assert(notif.getNotificationsForPlayer(p1.playerId).length === 1,
    'that player HAS a cfbp_notifications row — "turning off a category empties the Center" is exactly the bug this remediation fixes');
  assert(p1Fired.record.deliveryState.push === 'skipped',
    'that player\'s record shows push SKIPPED (no adapter registered in this block, but push intent was already false from the category gate)');
  assert(notif.getNotificationsForPlayer(players[1].playerId).length === 1,
    'a player with the category ON still gets the in-app record');

  // restore
  const restored = storage.getPlayers();
  restored[idx] = { ...restored[idx], preferences: {} };
  writePlayersDirect(restored);

  function writePlayersDirect(list) {
    // storage.js has no raw player-array setter beyond savePlayer(one)/addPlayer —
    // use savePlayer for each, which is the real seam, not a bypass.
    list.forEach(p => storage.savePlayer(p));
  }

  // all-picks-complete player receives no PICKS_REMINDER
  storage.setNotifications([]);
  const full = notif.notifyPicksReminder(week, players[2], 0, '1h', '1h');
  assert(full === null, 'a player with 0 remaining picks receives no PICKS_REMINDER (remainingPicks<=0 guard)');
  const some = notif.notifyPicksReminder(week, players[2], 3, '1h', '1h');
  assert(some?.fired === true, 'a player with picks outstanding DOES receive PICKS_REMINDER');
}

console.log('\n[2] Blind-rule — negative case (full event/body matrix) + positive case…');
{
  for (const key of copy.FORBIDDEN_META_KEYS) {
    let threw = false;
    try { copy.assertMetaIsBlindSafe({ [key]: 'anything' }); } catch { threw = true; }
    assert(threw, `forbidden meta key "${key}" is rejected structurally`);
  }
  assert((() => { try { copy.assertMetaIsBlindSafe({ namedNonSubmitters: 'Kevin, Jacob' }); return true; } catch { return false; } })(),
    'POSITIVE CASE: namedNonSubmitters (display names) is NOT a forbidden key');

  // Full matrix: every event this module knows how to voice, exercised with a
  // representative meta, never throws and never contains a forbidden literal.
  const FORBIDDEN_LITERALS = ['spread', 'tiebreaker', 'extraPoint', 'wager', 'margin'];
  const fixtures = {
    PICKS_OPENED: { weekN: 3 },
    PICKS_REMINDER: { weekN: 3, remainingPicks: 2, timeUntilLock: '1h' },
    PICKS_LOCKING_SOON: { weekN: 3, timeUntilLock: '1h', namedNonSubmitters: 'Kevin', submittedCount: 5, totalPlayers: 6 },
    PICKS_LOCKING_SOON_ALL_IN: { weekN: 3 },
    PICKS_LOCKED: { weekN: 3, submittedCount: 6, totalPlayers: 6 },
    RESULTS_FINALIZED: { weekN: 3, weekWinnerName: 'Kihoon', weekLoserName: 'Koby' },
    PICKS_LOCKING_SOON_COUNT_ONLY: { weekN: 3, timeUntilLock: '1h', submittedCount: 4, totalPlayers: 6 },
    // N1 / UN-204, copy ruling (d) (2026-09-12) — THESE FIXTURES USED TO BE
    // `{ weekN: 3 }` AND THAT MADE THIS ASSERTION VACUOUS. With the league-wide
    // third-person pools, weekN alone satisfies no template, so buildCopy()
    // dropped to the flat fallback — and a fallback string trivially contains
    // no forbidden literal. The SCRIBE lines themselves were never exercised.
    // Supplying all four facts is what makes the check below mean something,
    // and `scribeVoiced` is asserted immediately after so it can never silently
    // go vacuous again.
    OBLIGATION_CREATED: { weekN: 3, debtorName: 'Koby', creditorName: 'Kihoon', obligationLabel: '1 drink' },
    OBLIGATION_SETTLED: { weekN: 3, debtorName: 'Koby', creditorName: 'Kihoon', obligationLabel: '1 drink' },
  };
  // RESULTS_FINALIZED_YOU_WON is deliberately ABSENT — retired by ruling O3
  // (see below). A league-wide room cannot carry a second-person line.
  const MUST_BE_SCRIBE_VOICED = ['OBLIGATION_CREATED', 'OBLIGATION_SETTLED'];
  let matrixChecked = 0;
  for (const [event, meta] of Object.entries(fixtures)) {
    const out = copy.buildCopy(event, meta, 'dk_' + event);
    matrixChecked++;
    const lower = out.body.toLowerCase();
    const violated = FORBIDDEN_LITERALS.some(w => lower.includes(w));
    assert(!violated, `NEGATIVE CASE: ${event}'s body contains no spread/tiebreaker/Extra-Point literal (got: "${out.body}")`);
    if (MUST_BE_SCRIBE_VOICED.includes(event)) {
      assert(out.scribeVoiced === true,
        `${event}: the fixture exercises a real SCRIBE TEMPLATE, not the flat fallback — otherwise the forbidden-literal check above passes vacuously (got scribeVoiced=${out.scribeVoiced}, body "${out.body}")`);
      assert(out.body.includes('Koby') && out.body.includes('Kihoon'),
        `${event}: …and the league-wide line names BOTH parties (ruling O4 — an obligation is already public on Standings; a room of six needs to know who is owed, not only who owes) (got "${out.body}")`);
    }
  }
  assert(matrixChecked === Object.keys(fixtures).length, 'every known event was actually exercised in the matrix (non-vacuous)');
  assert(matrixChecked === copy._knownEvents().length,
    `the matrix covers EVERY event the module knows how to voice (${matrixChecked} fixtures vs ${copy._knownEvents().length} known events) — an event added to the pools without a fixture here would go unexercised`);
  // Ruling O3 — retired, and retired everywhere at once.
  assert(copy._knownEvents().indexOf('RESULTS_FINALIZED_YOU_WON') === -1,
    'RESULTS_FINALIZED_YOU_WON is retired (ruling O3): its lines were second person ("you took it") and cannot be posted into a league-wide room where five of six readers did not win');
  assert(copy.buildCopy('RESULTS_FINALIZED_YOU_WON', { weekN: 3 }, 'dk_gone').scribeVoiced === false,
    '…and asking for it by name yields the generic non-SCRIBE fallback, never a resurrected second-person line');
}

console.log('\n[3] Dedup — double-fire, in-app and server-side…');
{
  storage.setNotifications([]);
  const week = freshWeek();
  const first = notif.notifyPicksOpened(week, players);
  const second = notif.notifyPicksOpened(week, players);
  assert(first.filter(r => r.fired).length === players.length, 'first fire: one notification per active player');
  assert(second.filter(r => r.fired).length === 0, 'second fire (same event/week, invoked twice): zero NEW notifications — full dedup');
  assert(notif.getNotificationsForPlayer(players[0].playerId).length === 1,
    'exactly ONE cfbp_notifications row for that player, not two, even though the policy layer was invoked twice');

  // Server-side: simulated double-fire of the Apps Script reminder trigger
  // (same scan window, called twice) — backend/notifyServer.mjs twin.
  const lockInMs = 50 * 60 * 1000; // inside the 1h window, so both REMINDER(1h) and LOCKING_SOON fire
  const serverWeek = { ...freshWeek(), picksLockAt: new Date(Date.now() + lockInMs).toISOString() };
  const games = [1, 2, 3].map((n, i) => dataModel.createGame(serverWeek.weekId, { gameId: `g${i + 1}`, kickoff: serverWeek.picksLockAt }));
  const picks = [dataModel.createPick(serverWeek.weekId, 'g1', 'p1', 'home')]; // p1 has 1/3, everyone else 0/3
  const plan = server.computeReminderPlan({ week: serverWeek, games, picks, players, now: Date.now() });
  // 50 minutes to lock crosses BOTH the 24h and 1h thresholds (not the 15m
  // one) — computeReminderPlan is a stateless "what has been crossed as of
  // NOW" snapshot; it's applyPlan()/CFBP_NOTIFY_SENT's job (tested below) to
  // suppress a threshold already sent in an earlier scan, not this function's.
  assert(plan.remindersPlan.length === players.length * 2,
    `plan: 24h AND 1h thresholds both crossed at 50min-to-lock, one entry per player per threshold (got ${plan.remindersPlan.length}, expected ${players.length * 2})`);
  assert(plan.remindersPlan.every(r => r.threshold === '24h' || r.threshold === '1h'),
    'plan: no 15m entries yet (50 minutes remain, > 15m threshold)');
  assert(!!plan.lockingSoonPlan, 'plan: PICKS_LOCKING_SOON also fires inside its 1h window');

  // BLOCKING #1 remediation (2026-09-10) — applyPlan() now returns
  // { calls, logEntries } instead of a bare array; `players` (default
  // everything-on prefs here) is threaded through so the push gate resolves.
  const fakeStore = server.makeFakeNotifySentStore();
  const runRun1 = server.applyPlan(plan, fakeStore, players);
  const runRun2 = server.applyPlan(plan, fakeStore, players);   // identical scan, called AGAIN — the double-fire
  assert(runRun1.calls.length > 0, 'first scan: produces OneSignal calls');
  assert(runRun2.calls.length === 0, 'SECOND identical scan (double-fire): produces ZERO additional calls — CFBP_NOTIFY_SENT dedup holds');
  assert(runRun1.logEntries.length === plan.remindersPlan.length + plan.lockingSoonPlan.entries.length,
    'first scan: one logEntries row per (event,threshold,playerId) — the in-app-record analogue for the server-fired path');
  assert(fakeStore.size() === plan.remindersPlan.length + plan.lockingSoonPlan.entries.length,
    'exactly one CFBP_NOTIFY_SENT row per (event,threshold,playerId) — not duplicated by the second scan');

  // dedupKey shape validation (correction #5)
  assert(server.isValidDedupKey('PICKS_REMINDER|w_test|1h|p1'), 'a well-formed dedupKey validates');
  assert(!server.isValidDedupKey('garbage'), 'a malformed dedupKey (no pipes) is rejected');
  assert(!server.isValidDedupKey('EVENT||1h|'), 'a dedupKey with an empty playerId is rejected');
  assert(!server.isValidDedupKey(null), 'a non-string dedupKey is rejected');
}

console.log('\n[4] Provider isolation — no adapter registered…');
{
  notif._clearPushAdapterForTest();
  assert(notif.hasPushAdapter() === false, 'no push adapter registered by default in a fresh test context');
  storage.setNotifications([]);
  const week = freshWeek();
  const res = notif.notifyPicksOpened(week, players);
  assert(res.every(r => r.fired), 'EVERY recipient still gets fired (in-app path) with zero push adapter configured');
  assert(notif.getNotificationsForPlayer(players[0].playerId).length === 1,
    'createInAppNotification is NOT blocked by an absent deliverPush adapter');
  assert(res[0].record.deliveryState.push === 'skipped' || res[0].record.deliveryState.push === 'sent',
    'deliveryState.push resolves to a real state (skipped, since no adapter) — never left undefined');
}

console.log('\n[5] Deep-link table validity…');
{
  const VALID_TABS = new Set(['picks', 'dashboard', 'leaderboard', 'chat', 'commissioner', 'rules']);
  const table = notif._deepLinkTableForTest();
  const events = Object.keys(table);
  assert(events.length >= 9, `deep-link table covers every lifecycle event (got ${events.length})`);
  for (const event of events) {
    const dest = notif.destinationFor(event, { playerId: 'p1', weekId: 'w_test', messageId: 'm1' });
    assert(VALID_TABS.has(dest.tab), `${event} resolves to a REAL navigateTo() tab (got "${dest.tab}")`);
    assert(dest.params && typeof dest.params === 'object', `${event} resolves to a params object, never undefined`);
  }
  const unknown = notif.destinationFor('SOME_FUTURE_EVENT_NOT_IN_TABLE', {});
  assert(VALID_TABS.has(unknown.tab), 'an unknown event still resolves to a safe, valid tab (dashboard fallback) rather than a dead end');
}

console.log('\n[6] Failure isolation — a throwing push adapter…');
{
  class ThrowingAdapter { isConfigured() { return true; } async send() { throw new Error('boom'); } }
  notif.registerPushAdapter(new ThrowingAdapter());
  storage.setNotifications([]);
  const week = freshWeek();
  let threw = false;
  let res;
  try { res = notif.notifyPicksOpened(week, players); } catch { threw = true; }
  assert(!threw, 'a throwing push adapter does not throw synchronously out of the orchestration call');
  await new Promise(r => setTimeout(r, 10));   // let the fire-and-forget deliverPush().catch() settle
  assert(notif.getNotificationsForPlayer(players[0].playerId).length === 1,
    'the in-app record was still created despite push delivery throwing — push failure is not a product-data failure');
  assert(res.every(r => r.fired), 'every recipient still reports fired:true — push failure does not change the recipient result');
  notif._clearPushAdapterForTest();
}

console.log('\n[7] Master × category truth table (REMEDIATION 2026-09-10 — reviewer-recommended resolution, explicit)…');
{
  const pid = players[3].playerId;
  function setPrefs({ master, category, on }) {
    const list = storage.getPlayers();
    const idx = list.findIndex(p => p.playerId === pid);
    list[idx] = { ...list[idx], preferences: { notifyPushMaster: master, notifyCategories: { [category]: on } } };
    storage.savePlayer(list[idx]);
  }
  setPrefs({ master: false, category: 'results', on: false });
  assert(JSON.stringify(notif.resolveIntent({ playerId: pid, category: 'results' })) === JSON.stringify({ inApp: true, push: false }),
    'category OFF, master OFF -> {inApp:true, push:false} — in-app ALWAYS writes; category/master control push only');
  setPrefs({ master: true, category: 'results', on: false });
  assert(JSON.stringify(notif.resolveIntent({ playerId: pid, category: 'results' })) === JSON.stringify({ inApp: true, push: false }),
    'category OFF, master ON -> {inApp:true, push:false} — "category off produces in-app records only" (DI-A4 verbatim)');
  setPrefs({ master: false, category: 'results', on: true });
  assert(JSON.stringify(notif.resolveIntent({ playerId: pid, category: 'results' })) === JSON.stringify({ inApp: true, push: false }),
    'category ON, master OFF -> {inApp:true, push:false} — "master off does not empty the Center" holds');
  setPrefs({ master: true, category: 'results', on: true });
  assert(JSON.stringify(notif.resolveIntent({ playerId: pid, category: 'results' })) === JSON.stringify({ inApp: true, push: true }),
    'category ON, master ON -> {inApp:true, push:true}');
  // category === null (COMMISSIONER_ANNOUNCEMENT) — never silenceable (D3)
  setPrefs({ master: false, category: 'results', on: false });
  assert(JSON.stringify(notif.resolveIntent({ playerId: pid, category: null })) === JSON.stringify({ inApp: true, push: false }),
    'category=null (commissioner announcement) skips the category gate entirely — master still gates push only');
  setPrefs({ master: true, category: 'results', on: false });
  assert(JSON.stringify(notif.resolveIntent({ playerId: pid, category: null })) === JSON.stringify({ inApp: true, push: true }),
    'category=null, master ON -> push fires too — the null-category skip is not itself a push suppressor');
  // restore
  const list = storage.getPlayers(); const idx = list.findIndex(p => p.playerId === pid);
  list[idx] = { ...list[idx], preferences: {} }; storage.savePlayer(list[idx]);
}

console.log('\n[8] No cfbp_notifications row is EVER created for CHAT_MESSAGE_CREATED…');
{
  const chat = await import('./js/chat.js');
  storage.setNotifications([]);
  chat._resetForTest();
  chat.initChat('p1');
  // F1 remediation (2026-09-10) — production ALWAYS backfills before
  // wireChatNotifications() runs (js/app.js boot order: initChatUI() -> the
  // notifications boot-wiring block). Prime a one-message "backfill" first
  // so the watermark seeds from a real, non-zero head at wire time —
  // otherwise the FIRST post-wire notify is (correctly, per F1 — see
  // notifytest.mjs [12] CASE 2) treated as the presumed-backfill batch and
  // skipped, which would make this test's single message a false negative
  // on the recipient-fan-out/sender-exclusion behavior it actually exists
  // to prove, not a real bug.
  chat.ingest([{ id: 'msg_0', seq: 1, ts: Date.now(), type: 'message', author: 'p1', gameTag: '', body: 'priming backfill', targetId: '', replyTo: '', notify: true, meta: null }]);
  notif._resetChatWatermarkForTest();
  const captured = [];
  class CapturingAdapter { isConfigured() { return true; } async send(record) { captured.push(record); return { ok: true }; } }
  notif.registerPushAdapter(new CapturingAdapter());
  notif.wireChatNotifications();

  // ingest() directly with a NUMERIC seq — simulates the confirmed state a
  // message reaches once the server acks it (chatSinceRemote/the send
  // echo). sendEvent()'s own optimistic-local path (seq:null until a real
  // network round-trip) is deliberately not exercised here — network is
  // disabled in this harness, and _scanNewChatMessages() correctly waits for
  // a real seq before treating a message as fire-worthy (see that function's
  // comments) — this test proves the POST-CONFIRMATION behavior, which is
  // where production notifications actually fire from.
  chat.ingest([{ id: 'msg_1', seq: 2, ts: Date.now(), type: 'message', author: 'p1', gameTag: '', body: 'hello league', targetId: '', replyTo: '', notify: true, meta: null }]);
  await new Promise(r => setTimeout(r, 10));

  assert(storage.getNotifications().length === 0,
    'a chat message event produced ZERO cfbp_notifications rows — chat is push-only by construction (§2)');
  const anyChatPush = captured.some(r => r.event === 'CHAT_MESSAGE_CREATED');
  assert(anyChatPush, 'a push WAS attempted for the chat message (push-only, not "nothing happens")');
  const selfPush = captured.find(r => r.event === 'CHAT_MESSAGE_CREATED' && r.playerId === 'p1');
  assert(!selfPush, 'the SENDER (p1) never received a push for their own message');
  const recipientIds = new Set(captured.filter(r => r.event === 'CHAT_MESSAGE_CREATED').map(r => r.playerId));
  assert(recipientIds.size === players.length - 1, `every OTHER active player is a candidate recipient (got ${recipientIds.size}, expected ${players.length - 1})`);

  chat._resetForTest();
  notif._resetChatWatermarkForTest();
  notif._clearPushAdapterForTest();
}

// ── [9] Mutation check — gut the blind-rule guard, confirm the suite goes
//    red, restore from a SCRATCH COPY (never git checkout/restore/stash —
//    CLAUDE.md prohibited-moves). ─────────────────────────────────────────
console.log('\n[9] Mutation check — blind-rule guard (assertMetaIsBlindSafe)…');
{
  const target = fileURLToPath(new URL('./js/notify-copy.js', import.meta.url));
  const scratchDir = process.env.TMPDIR || '/tmp';
  const scratchCopy = `${scratchDir}/notify-copy.pre-mutation.${Date.now()}.js`;
  await copyFile(target, scratchCopy);
  const original = await readFile(target, 'utf8');

  const gutted = original.replace(
    'export function assertMetaIsBlindSafe(meta) {',
    'export function assertMetaIsBlindSafe(meta) { return; // MUTATION: gutted for notifytest.mjs [9]\n'
  );
  assert(gutted !== original, '[9a] the mutation actually changed the source (non-vacuous — the replace() found its target)');
  await writeFile(target, gutted, 'utf8');

  let mutantThrew = false;
  try {
    const mutantMod = await import(`./js/notify-copy.js?mutant=${Date.now()}`);
    try { mutantMod.assertMetaIsBlindSafe({ spread: -3.5 }); } catch { mutantThrew = true; }
  } finally {
    // restore immediately, before any assertion, so a crash mid-check can
    // never leave the gutted guard live in the working tree.
    await copyFile(scratchCopy, target);
  }
  assert(mutantThrew === false, '[9b] MUTATION CONFIRMED: with the guard gutted, a forbidden key ("spread") no longer throws — the suite would be red on this specific assertion');

  const restored = await readFile(target, 'utf8');
  assert(restored === original, '[9c] source restored byte-for-byte from the scratch copy — never via git checkout/restore/stash');

  const freshMod = await import(`./js/notify-copy.js?restored=${Date.now()}`);
  let restoredThrew = false;
  try { freshMod.assertMetaIsBlindSafe({ spread: -3.5 }); } catch { restoredThrew = true; }
  assert(restoredThrew === true, '[9d] guard is GREEN again after restore — the real (non-mutant) code rejects the forbidden key');
}

// ═══════════════════════════════════════════════════════════════════════════
// REMEDIATION (2026-09-10) — Build 1 notification-workstream BLOCK fixes.
// Sections [10]-[16] below cover F1-F10 + the master×category flip (already
// exercised above in [1]/[7]). See the handoff report for the file:line map.
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n[10] F2 — server-fired notifyLog fold (merge / dedup / readAt round-trip)…');
{
  storage.setNotifications([]);
  notif._resetNotifyLogCacheForTest();
  const pid = players[4].playerId;   // Jacob

  const dupDedupKey = notif.makeDedupKey({ event: 'PICKS_REMINDER', weekId: 'w_test', threshold: '1h', playerId: pid });
  const uniqueDedupKey = notif.makeDedupKey({ event: 'PICKS_LOCKING_SOON', weekId: 'w_test', threshold: 'locking-soon', playerId: pid });
  const serverRecords = [
    { id: 'ntf_server_1', playerId: pid, event: 'PICKS_REMINDER', actor: { kind: 'scribe', playerId: null }, title: 'Picks reminder', body: 'server body (should be shadowed)', destination: { tab: 'picks', params: {} }, createdAt: new Date().toISOString(), readAt: null, dedupKey: dupDedupKey, weekId: 'w_test', meta: {} },
    { id: 'ntf_server_2', playerId: pid, event: 'PICKS_LOCKING_SOON', actor: { kind: 'scribe', playerId: null }, title: 'Locking soon', body: 'server-only row', destination: { tab: 'picks', params: {} }, createdAt: new Date().toISOString(), readAt: null, dedupKey: uniqueDedupKey, weekId: 'w_test', meta: {} },
  ];
  // Simulate a poll that already ran and populated the device-local cache —
  // this is EXACTLY the shape notifications.js's own (private) cache uses,
  // so writing it directly here exercises the real read path without a
  // network round-trip (fetch is disabled in this harness by design).
  localStorage.setItem('cfbp_notify_log_cache', JSON.stringify({ byPlayer: { [pid]: { cursorSeq: 2, records: serverRecords } } }));

  // A LOCAL (client-authored) row sharing server row 1's dedupKey — dedup
  // must hold across the two sources, never double-counting.
  storage.setNotifications([{ id: 'ntf_local_1', playerId: pid, event: 'PICKS_REMINDER', actor: { kind: 'scribe', playerId: null }, title: 'Picks reminder', body: 'local body (should win)', destination: { tab: 'picks', params: {} }, createdAt: new Date().toISOString(), readAt: null, dedupKey: dupDedupKey, weekId: 'w_test', meta: {} }]);

  const merged = notif.getNotificationsForPlayer(pid);
  assert(merged.length === 2, `dedup holds across client+server rows sharing a dedupKey (got ${merged.length}, expected 2)`);
  assert(merged.some(n => n.id === 'ntf_local_1'), 'the LOCAL row wins when a dedupKey collides with a server row');
  assert(!merged.some(n => n.id === 'ntf_server_1'), 'the shadowed server row (same dedupKey as a local row) is dropped, not appended alongside it');
  assert(merged.some(n => n.id === 'ntf_server_2'), 'a server-only row (no local collision) still appears in the merged list');
  assert(notif.unreadLifecycleCount(pid) === 2, 'the bell badge counts BOTH client and server-origin unread rows (F4 — one combined lifecycle count)');

  const okServer = notif.markNotificationRead('ntf_server_2', pid);
  assert(okServer === true, 'markNotificationRead resolves a server-origin id');
  const serverRowAfter = notif.getNotificationsForPlayer(pid).find(n => n.id === 'ntf_server_2');
  assert(!!serverRowAfter?.readAt, 'readAt round-trips for a server-origin row via the device-local tracker');
  assert(storage.getNotifications().every(n => n.id !== 'ntf_server_2'),
    'the server-origin row was NEVER written into cfbp_notifications (RG-49 — never write the server\'s rows back into the client\'s shared KV key)');

  notif._resetNotifyLogCacheForTest();
  storage.setNotifications([]);
}

console.log('\n[11] F2 — pollNotifyLog never throws (no backend configured in this harness)…');
{
  notif._resetNotifyLogCacheForTest();
  let threw = false;
  try { await notif.pollNotifyLog(players[0].playerId, { force: true }); } catch { threw = true; }
  assert(!threw, 'pollNotifyLog resolves cleanly when isBackendConfigured() is false — notifyLogFetch no-ops rather than throwing');
  notif._resetNotifyLogCacheForTest();
}

console.log('\n[12] F1 — chat watermark seeding (no relay storm on backfill)…');
{
  const chat = await import('./js/chat.js');

  // CASE 1 — backfill already ingested BEFORE wireChatNotifications() runs
  // (the fold has a real, non-zero head at wire time).
  chat._resetForTest();
  chat.initChat('p1');
  notif._resetChatWatermarkForTest();
  const backfill1 = [];
  for (let i = 1; i <= 60; i++) backfill1.push({ id: `bf_${i}`, seq: i, ts: Date.now(), type: 'message', author: 'p2', gameTag: '', body: `msg ${i}`, targetId: '', replyTo: '', notify: true, meta: null });
  chat.ingest(backfill1);
  const captured1 = [];
  class CapAdapter1 { isConfigured() { return true; } async send(record) { captured1.push(record); return { ok: true }; } }
  notif.registerPushAdapter(new CapAdapter1());
  notif.wireChatNotifications();
  await new Promise(r => setTimeout(r, 10));
  assert(captured1.filter(r => r.event === 'CHAT_MESSAGE_CREATED').length === 0,
    'CASE 1 (backfill BEFORE wiring): watermark seeds from the already-populated fold head — ZERO relay calls for the 60 backfilled messages');

  chat.ingest([{ id: 'new_1', seq: 61, ts: Date.now(), type: 'message', author: 'p2', gameTag: '', body: 'brand new', targetId: '', replyTo: '', notify: true, meta: null }]);
  await new Promise(r => setTimeout(r, 10));
  const case1New = captured1.filter(r => r.event === 'CHAT_MESSAGE_CREATED');
  assert(case1New.length === players.length - 1, `CASE 1: one genuinely new message after a clean backfill fires to exactly the expected recipients (got ${case1New.length}, expected ${players.length - 1})`);

  chat._resetForTest();
  notif._resetChatWatermarkForTest();
  notif._clearPushAdapterForTest();

  // CASE 2 — wireChatNotifications() runs BEFORE the fold has anything (the
  // "subscribed before backfill completes" case F1 explicitly names). The
  // backfill's own ingest is the FIRST 'events' notification the wiring sees.
  chat._resetForTest();
  chat.initChat('p1');
  notif._resetChatWatermarkForTest();
  const captured2 = [];
  class CapAdapter2 { isConfigured() { return true; } async send(record) { captured2.push(record); return { ok: true }; } }
  notif.registerPushAdapter(new CapAdapter2());
  notif.wireChatNotifications();   // wired FIRST — fold is empty, head is 0
  const backfill2 = [];
  for (let i = 1; i <= 55; i++) backfill2.push({ id: `bf2_${i}`, seq: i, ts: Date.now(), type: 'message', author: 'p2', gameTag: '', body: `msg ${i}`, targetId: '', replyTo: '', notify: true, meta: null });
  chat.ingest(backfill2);   // fires notify('events') for the FIRST time post-wire
  await new Promise(r => setTimeout(r, 10));
  assert(captured2.filter(r => r.event === 'CHAT_MESSAGE_CREATED').length === 0,
    'CASE 2 (wired BEFORE backfill): the first post-wire events notification re-seeds the watermark instead of relaying — ZERO relay calls for the 55 backfilled messages');

  chat.ingest([{ id: 'new_2', seq: 56, ts: Date.now(), type: 'message', author: 'p2', gameTag: '', body: 'brand new 2', targetId: '', replyTo: '', notify: true, meta: null }]);
  await new Promise(r => setTimeout(r, 10));
  const case2New = captured2.filter(r => r.event === 'CHAT_MESSAGE_CREATED');
  assert(case2New.length === players.length - 1, `CASE 2: the NEXT message after the re-seed fires to exactly the expected recipients (got ${case2New.length}, expected ${players.length - 1})`);

  chat._resetForTest();
  notif._resetChatWatermarkForTest();
  notif._clearPushAdapterForTest();
}

// ── [12b] ────────────────────────────────────────────────────────────────────
// BUG-C (2026-09-11) — found in review as a BLOCK on the uncommitted BUG-B
// paging fix. BUG-B made chatTransport.drainSince() page forward on a cold
// boot: onEvents() is called ONCE PER PAGE, each page reporting an honest
// per-page head. F1's seeding ([12] above) assumed the FIRST post-wire
// 'events' notification IS the complete backfill — so it re-seeded off page 1
// and handed pages 2..n to _scanNewChatMessages() as brand-new messages.
// Measured on a 1,237-event log (mid-season-sized; the real head was 227 the
// day this was written): 3,685 relay calls = 737 messages × 5 recipients, for
// messages every player had already read. Server-side dedupKeyAlreadySent
// cannot help — every message carries a DISTINCT dedup key. CASE 1 had the
// same hole through the other door: wiring that lands BETWEEN two pages sees
// a real non-zero head, seeds from it, and then relays every later page.
//
// The invariant, stated once: a batch is LIVE only if the transport had
// already reached the server's TRUE head BEFORE that batch arrived. Anything
// else is history — it advances the watermark and relays nothing, however many
// pages it takes and wherever wireChatNotifications() lands in the sequence.
//
// Driven through the REAL production path — chat.initChat() -> _subscribeNow()
// -> transport.subscribe() -> drainSince() -> chat.ingest() — against a
// faithful mock of Code.gs chatSince() (page capped at 500, head always TRUE),
// the same fixture shape loadtest [72] uses. The delivery kind is produced by
// the code under test, never hand-fed by the test.
console.log('\n[12b] BUG-C — every page of a multi-page cold-boot backfill is history, wherever the wiring lands…');
{
  const chat = await import('./js/chat.js');
  const backend = await import('./js/backend.js');
  const _realFetch = globalThis.fetch, _realST = globalThis.setTimeout, _realCT = globalThis.clearTimeout;
  const settle = async (n = 80) => { for (let i = 0; i < n; i++) await new Promise(r => _realST(r, 0)); };

  const N = 1237;                     // 2.47 pages at the transport's 500-row PAGE_LIMIT
  let HEAD = N;
  let idPrefix = 'c3';
  const timers = [];
  const calls = [];
  // Every message id is namespaced per run: _fireOne's SESSION dedup set is
  // module-global and never reset, so re-using ids across the two runs would
  // make the second run pass vacuously on 'dedup-session'.
  const mk = seq => ({ id: `${idPrefix}_${seq}`, seq, ts: 1_700_000_000_000 + seq, type: 'message',
                       author: 'p2', gameTag: '', body: 'msg ' + seq, targetId: '', replyTo: '', notify: true, meta: null });
  const serverSince = (afterSeq, limit) => {
    const cap = Math.max(1, Math.min(limit || 500, 1000));
    if (HEAD <= afterSeq) return { ok: true, events: [], head: HEAD };
    const count = Math.min(cap, HEAD - afterSeq);
    const events = [];
    for (let s = afterSeq + 1; s <= afterSeq + count; s++) events.push(mk(s));
    return { ok: true, events, head: HEAD };
  };
  const fireHeld = async () => {
    const held = timers.splice(0, timers.length);
    for (const fn of held) { try { fn(); } catch {} }
    await settle();
  };

  globalThis.setTimeout = fn => { timers.push(fn); return timers.length; };
  globalThis.clearTimeout = () => {};
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    const action = u.searchParams.get('action');
    calls.push(action);
    if (action === 'chatHead') return { ok: true, json: async () => ({ ok: true, head: HEAD }) };
    if (action === 'chatSince') {
      const r = serverSince(Number(u.searchParams.get('seq') || 0), Number(u.searchParams.get('limit') || 0));
      return { ok: true, json: async () => r };
    }
    return { ok: true, json: async () => ({ ok: true }) };
  };
  backend.setBackendConfig('https://example.invalid/exec', 'tok12b');

  // wireAfterPages: 0 = wired before the fold has anything (CASE 2 shape);
  // 1 = wired once page one has landed and the head is real but INCOMPLETE
  // (CASE 1 shape, the between-pages variant).
  async function coldBoot(prefix, wireAfterPages) {
    idPrefix = prefix; HEAD = N; timers.length = 0; calls.length = 0;
    chat._resetForTest();
    notif._resetChatWatermarkForTest();
    const captured = [];
    notif.registerPushAdapter({ isConfigured: () => true, send: async r => { captured.push(r); return { ok: true }; } });
    let pages = 0;
    const unhook = chat.onChat(kind => { if (kind === 'events' && ++pages === wireAfterPages) notif.wireChatNotifications(); });
    if (wireAfterPages === 0) notif.wireChatNotifications();
    chat.initChat('p1');
    await settle();
    const out = {
      history: captured.filter(r => r.event === 'CHAT_MESSAGE_CREATED').length,
      pages,
      head: chat.chatStatus().head,
      watermark: notif._chatWatermarkForTest?.(),
      trips: notif._chatRelayBurstTripsForTest?.().length,
    };
    HEAD = N + 1;                      // ONE genuinely live message arrives
    await fireHeld();
    out.live = captured.filter(r => r.event === 'CHAT_MESSAGE_CREATED').length - out.history;
    out.headAfterLive = chat.chatStatus().head;
    out.watermarkAfterLive = notif._chatWatermarkForTest?.();
    unhook();
    notif._clearPushAdapterForTest();
    chat._resetForTest();
    notif._resetChatWatermarkForTest();
    return out;
  }

  try {
    // ── A. Wired BEFORE the fold has anything (production boot order) ──
    const a = await coldBoot('c3a', 0);
    assert(a.pages === 3 && a.head === N,
      `fixture check: the cold boot really did arrive as 3 pages and reach the true head ${N} — got ${a.pages} pages, head ${a.head} (a 1-page delivery would make every assertion below vacuous)`);
    assert(a.history === 0,
      `CASE 3 (wired BEFORE a 3-page backfill): ZERO relay calls for all ${N} history messages — got ${a.history} (pre-fix: 3685 = 737 × 5)`);
    assert(a.trips === 0,
      `CASE 3: and that zero comes from CLASSIFYING the pages as history, not from the burst cap swallowing them — burst-cap trips ${a.trips}, expected 0`);
    assert(a.watermark === N,
      `CASE 3: the watermark advanced silently through every page and ends at the TRUE head ${N} — got ${a.watermark}`);
    assert(a.live === players.length - 1,
      `CASE 3: the ONE genuinely live message that follows fires to exactly the expected recipients — got ${a.live}, expected ${players.length - 1}`);
    assert(a.watermarkAfterLive === N + 1 && a.headAfterLive === N + 1,
      `CASE 3: watermark and head both land on ${N + 1} after the live message — got ${a.watermarkAfterLive} / ${a.headAfterLive}`);

    // ── B. Wired BETWEEN pages (CASE 1's variant — a real but incomplete head) ──
    const b = await coldBoot('c3b', 1);
    assert(b.pages === 3 && b.head === N,
      `fixture check: the between-pages run also arrived as 3 pages and reached ${N} — got ${b.pages} pages, head ${b.head}`);
    assert(b.history === 0,
      `CASE 1-variant (wired BETWEEN page 1 and page 2): ZERO relay calls for the 737 messages in pages 2 and 3 — got ${b.history} (pre-fix: 3685)`);
    assert(b.trips === 0,
      `CASE 1-variant: and again by classification, not by the burst cap — burst-cap trips ${b.trips}, expected 0`);
    assert(b.watermark === N,
      `CASE 1-variant: watermark ends at the TRUE head ${N}, not at page one's honest-but-partial 500 — got ${b.watermark}`);
    assert(b.live === players.length - 1,
      `CASE 1-variant: the live message after the drain still fires to exactly the expected recipients — got ${b.live}, expected ${players.length - 1}`);
    // ── C. The EMPTY room, wired before the drain ──
    // RG-100 F2 (reviewer finding, 2026-09-11) CHANGED THIS CASE'S EXPECTATION
    // — recorded here rather than silently, per CLAUDE.md's "amended with a
    // dated note, never silently violated." Original reasoning (kept for the
    // record): "A drain that finds nothing folds nothing, so chat.js fires no
    // 'events' notification at all — there is no batch to seed off... the
    // transport's caught-up report does [answer it], because the fold was
    // already complete before that message arrived." That was true as far as
    // it went, but it trusted a `{events:[], head:0}` answer as proof the
    // room was COMPLETE. It cannot be: that exact shape is ALSO what a cold
    // Apps Script sheet whose getLastRow() has not warmed up returns — a real
    // room with real messages, lying about being empty. chatTransport.js's
    // drainSince() could not tell the two apart from maxSeq>=head alone (0>=0
    // is true either way), so it now treats head===0 as NEVER caught up
    // (chatTransport.js's own comment on this, tagged RG-100 F2) — the same
    // head>0 requirement `seenRoom` already applied a few lines away in
    // subscribe(). Measured cost of the OLD read: a cold-start artifact ahead
    // of a real 18-message room relayed 90 pushes for messages every player
    // had already read (case [12c]-adjacent shape, worse without the burst
    // cap on a smaller room). Accepted trade, same shape as BUG-C's own: the
    // very first message posted into a BRAND-NEW, genuinely empty room now
    // classifies as history on the tick that reveals the room isn't empty
    // after all — no push for that one message — which is the safe side to
    // fail to, and the case below now proves it stays limited to exactly that
    // one message (the SECOND message resumes live relay normally).
    idPrefix = 'c3c'; HEAD = 0; timers.length = 0;
    chat._resetForTest();
    notif._resetChatWatermarkForTest();
    const capturedC = [];
    notif.registerPushAdapter({ isConfigured: () => true, send: async r => { capturedC.push(r); return { ok: true }; } });
    notif.wireChatNotifications();
    chat.initChat('p1');
    await settle();
    assert(chat.chatStatus().head === 0 && chat.getMessages({ tag: 'all' }).length === 0,
      `fixture check: the drain really did find an empty room — head ${chat.chatStatus().head}, ${chat.getMessages({ tag: 'all' }).length} messages`);
    assert(chat.chatStatus().caughtUp === false,
      'RG-100 F2: a head:0 empty delivery is NEVER classified caught-up — it is indistinguishable from a cold-start artifact hiding a real room');
    HEAD = 1;
    await fireHeld();
    const cLiveFirst = capturedC.filter(r => r.event === 'CHAT_MESSAGE_CREATED').length;
    assert(cLiveFirst === 0,
      `RG-100 F2: the FIRST message into a room whose only prior read was head:0 classifies as HISTORY, not live — zero relays for it — got ${cLiveFirst} (was 5 before the F2 fix; see the case comment above for why that was actually the bug)`);
    assert(chat.chatStatus().caughtUp === true,
      'and the room IS now correctly marked complete, once a delivery has actually reached a real (>0) head');
    HEAD = 2;
    await fireHeld();
    const cLiveSecond = capturedC.filter(r => r.event === 'CHAT_MESSAGE_CREATED').length - cLiveFirst;
    assert(cLiveSecond === players.length - 1,
      `and the VERY NEXT message relays completely normally — the F2 fix costs exactly the one ambiguous message, not a permanent suppression — got ${cLiveSecond}, expected ${players.length - 1}`);
    notif._clearPushAdapterForTest();

    // ── C2. RG-100 F2, end to end through the exact shape the reviewer
    //    measured: a head:0 cold-start artifact ahead of a REAL, already-
    //    populated room (not a genuinely empty one) must not mass-relay the
    //    backfill once the sheet warms up. ──
    idPrefix = 'c3c2'; HEAD = 0; timers.length = 0;
    chat._resetForTest();
    notif._resetChatWatermarkForTest();
    const capturedC2 = [];
    notif.registerPushAdapter({ isConfigured: () => true, send: async r => { capturedC2.push(r); return { ok: true }; } });
    notif.wireChatNotifications();
    chat.initChat('p1');
    await settle();                          // tick #1: the cold-start artifact, {events:[], head:0}
    assert(chat.chatStatus().head === 0 && chat.chatStatus().caughtUp === false,
      'fixture: the cold-start artifact landed and did NOT latch caughtUp');
    HEAD = 18;                                // the sheet warms up: 18 real messages were there all along
    await fireHeld();                         // tick #2: the real backfill
    const c2History = capturedC2.filter(r => r.event === 'CHAT_MESSAGE_CREATED').length;
    assert(chat.chatStatus().head === 18 && chat.getMessages({ tag: 'all' }).length === 18,
      `fixture: the 18-message backfill folded completely — head ${chat.chatStatus().head}, ${chat.getMessages({ tag: 'all' }).length} messages`);
    assert(c2History === 0,
      `RG-100 F2: the 18-message backfill relays ZERO pushes (pre-fix: 90 = 18 × 5) — got ${c2History}`);
    const c2Trips = notif._chatRelayBurstTripsForTest?.() || [];
    assert(c2Trips.length === 0, `and that zero comes from CLASSIFICATION, not the burst cap swallowing it — trips ${c2Trips.length}, expected 0`);
    assert(notif._chatWatermarkForTest?.() === 18, `watermark ends at the true head 18, not stuck at the cold-start artifact's 0 — got ${notif._chatWatermarkForTest?.()}`);
    HEAD = 19;                                // a GENUINELY new message, after reconciliation
    await fireHeld();
    const c2Live = capturedC2.filter(r => r.event === 'CHAT_MESSAGE_CREATED').length - c2History;
    assert(c2Live === players.length - 1,
      `and a genuinely new message after reconciliation DOES relay — to every other active player — got ${c2Live}, expected ${players.length - 1}`);
    notif._clearPushAdapterForTest();

    // ── D. Worst case: a >1-page burst arriving while ALREADY live ──
    // Not the BUG-C shape (the room was complete first, so these ARE new), but
    // the shape that decides how bad "worst case" can get. Mid-walk pages
    // advance the watermark instead of relaying, and the caught-up page meets
    // the burst cap — so a 1,200-message dump is bounded to zero sends and one
    // recorded refusal, never 6,000 pushes.
    idPrefix = 'c3d'; HEAD = 1; timers.length = 0;
    chat._resetForTest();
    notif._resetChatWatermarkForTest();
    const capturedD = [];
    notif.registerPushAdapter({ isConfigured: () => true, send: async r => { capturedD.push(r); return { ok: true }; } });
    chat.initChat('p1');
    await settle();                      // room complete at head 1 — we are live
    notif.wireChatNotifications();
    HEAD = 1201;                         // 1,200 new messages land between ticks
    await fireHeld();
    const dSends = capturedD.filter(r => r.event === 'CHAT_MESSAGE_CREATED').length;
    const dTrips = notif._chatRelayBurstTripsForTest?.() || [];
    assert(chat.chatStatus().head === 1201 && chat.getMessages({ tag: 'all' }).length === 1201,
      `fixture check: all 1,200 burst messages were folded and displayed — head ${chat.chatStatus().head}, ${chat.getMessages({ tag: 'all' }).length} messages (the fold is never what gets throttled)`);
    assert(dSends === 0 && dTrips.length === 1,
      `a 1,200-message live burst produces ZERO pushes and ONE recorded refusal, not 6,000 pushes — got ${dSends} sends, ${dTrips.length} trips`);
    notif._clearPushAdapterForTest();
  } finally {
    globalThis.fetch = _realFetch;
    globalThis.setTimeout = _realST;
    globalThis.clearTimeout = _realCT;
    backend.clearBackendConfig();
    chat._resetForTest();
    notif._clearPushAdapterForTest();
    notif._resetChatWatermarkForTest();
  }
}

// ── [12c] ────────────────────────────────────────────────────────────────────
// BUG-C second layer. [12b] fixes the CLASSIFICATION; this pins the backstop
// for the next door nobody has found yet. F1 (2026-09-10) and BUG-C
// (2026-09-11) are the same failure — "a pile of history got scanned as new" —
// arriving through two different mechanisms two days apart, so the scan itself
// now refuses to emit an implausible burst: one batch that would produce more
// than CHAT_RELAY_BURST_CAP relay sends advances the watermark, logs loudly,
// and relays nothing. 100 sends is 20 messages in a six-player league — beyond
// any human flurry inside one poll interval (5-60s), and two orders of
// magnitude below the 3,685 BUG-C produced.
console.log('\n[12c] BUG-C second layer — the scan refuses an implausible burst instead of relaying it…');
{
  const chat = await import('./js/chat.js');
  chat._resetForTest();
  notif._resetChatWatermarkForTest();
  notif._resetChatRelayBurstTripsForTest?.();
  const captured = [];
  notif.registerPushAdapter({ isConfigured: () => true, send: async r => { captured.push(r); return { ok: true }; } });
  const mk = (pfx, seq) => ({ id: `${pfx}_${seq}`, seq, ts: Date.now(), type: 'message', author: 'p2',
                              gameTag: '', body: 'b' + seq, targetId: '', replyTo: '', notify: true, meta: null });
  chat.ingest([mk('bcap', 1)]);          // prime a real, complete fold
  notif.wireChatNotifications();         // seeds from a non-zero head, caught up
  await new Promise(r => setTimeout(r, 5));

  // Under the cap: 15 messages × 5 recipients = 75 sends — every one relayed.
  const under = [];
  for (let s = 2; s <= 16; s++) under.push(mk('bcap', s));
  chat.ingest(under);
  await new Promise(r => setTimeout(r, 10));
  const underCount = captured.filter(r => r.event === 'CHAT_MESSAGE_CREATED').length;
  assert(underCount === 15 * (players.length - 1),
    `a batch UNDER the cap relays normally — got ${underCount}, expected ${15 * (players.length - 1)}`);
  assert((notif._chatRelayBurstTripsForTest?.() || []).length === 0,
    'and it does not trip the burst cap');

  // Over the cap: 30 messages × 5 = 150 sends — nothing relayed, watermark
  // still advanced (so the burst can never be re-scanned into a second storm).
  const over = [];
  for (let s = 17; s <= 46; s++) over.push(mk('bcap', s));
  chat.ingest(over);
  await new Promise(r => setTimeout(r, 10));
  const overCount = captured.filter(r => r.event === 'CHAT_MESSAGE_CREATED').length - underCount;
  assert(overCount === 0,
    `a batch OVER the cap relays NOTHING — got ${overCount} relay calls, expected 0`);
  const trips = notif._chatRelayBurstTripsForTest?.() || [];
  assert(trips.length === 1 && trips[0].projected === 30 * (players.length - 1) && trips[0].messages === 30,
    `the refusal is RECORDED, not silent — got ${JSON.stringify(trips)}, expected one trip of ${30 * (players.length - 1)} sends across 30 messages`);
  assert(notif._chatWatermarkForTest?.() === 46,
    `the watermark still advanced past the refused burst (46) so it can never be re-scanned — got ${notif._chatWatermarkForTest?.()}`);

  chat._resetForTest();
  notif._clearPushAdapterForTest();
  notif._resetChatWatermarkForTest();
  notif._resetChatRelayBurstTripsForTest?.();
}

// ── [13] Mutation check — disable F1's seed, confirm the storm reappears,
//    restore from a SCRATCH COPY (never git checkout/restore/stash). ───────
console.log('\n[13] Mutation check — F1 chat watermark seed (_currentChatHead)…');
{
  const chat = await import('./js/chat.js');
  const target = fileURLToPath(new URL('./js/notifications.js', import.meta.url));
  const scratchDir = process.env.TMPDIR || '/tmp';
  const scratchCopy = `${scratchDir}/notifications.pre-mutation.${Date.now()}.js`;
  await copyFile(target, scratchCopy);
  const original = await readFile(target, 'utf8');

  const needle = 'function _currentChatHead() {\n  try { return chatStatus().head || 0; } catch { return 0; }\n}';
  assert(original.includes(needle), '[13a] mutation target text found verbatim in js/notifications.js');
  const gutted = original.replace(needle, 'function _currentChatHead() { return 0; /* MUTATION: F1 seed disabled for notifytest.mjs [13] */ }');
  assert(gutted !== original, '[13b] the mutation actually changed the source (non-vacuous)');
  await writeFile(target, gutted, 'utf8');

  let mutantStormCount = -1;
  let mutantTrips = null;
  try {
    const mutantNotif = await import(`./js/notifications.js?mutant=${Date.now()}`);
    chat._resetForTest();
    chat.initChat('p1');
    mutantNotif._resetChatWatermarkForTest();
    const captured = [];
    class CapAdapterM { isConfigured() { return true; } async send(record) { captured.push(record); return { ok: true }; } }
    mutantNotif.registerPushAdapter(new CapAdapterM());
    mutantNotif.wireChatNotifications();   // seeds to 0 under the mutation, regardless of case
    const backfillM = [];
    for (let i = 1; i <= 50; i++) backfillM.push({ id: `mfb_${i}`, seq: i, ts: Date.now(), type: 'message', author: 'p2', gameTag: '', body: `m${i}`, targetId: '', replyTo: '', notify: true, meta: null });
    chat.ingest(backfillM);   // first post-wire notify — skipped (re-seed branch), but re-seeds to the MUTATED 0, not the real head
    await new Promise(r => setTimeout(r, 5));
    chat.ingest([{ id: 'mnew', seq: 51, ts: Date.now(), type: 'message', author: 'p2', gameTag: '', body: 'new', targetId: '', replyTo: '', notify: true, meta: null }]);
    await new Promise(r => setTimeout(r, 10));
    // With the watermark stuck at 0, THIS scan re-floods all 51 messages
    // (the 50 "old" ones are still in the fold and still > watermark 0) —
    // exactly the storm shape the reviewer measured.
    mutantStormCount = captured.filter(r => r.event === 'CHAT_MESSAGE_CREATED').length;
    mutantTrips = (mutantNotif._chatRelayBurstTripsForTest?.() || []);
    chat._resetForTest();
    mutantNotif._clearPushAdapterForTest();
  } finally {
    // restore immediately, before any assertion, so a crash mid-check can
    // never leave the gutted seed live in the working tree.
    await copyFile(scratchCopy, target);
  }
  // BUG-C (2026-09-11) amended what this assertion can observe. Until today the
  // gutted seed produced 255 actual relay calls. It still produces a scan of all
  // 51 messages — the mutation still breaks the primary guard exactly as before
  // — but BUG-C's SECOND layer now intercepts the burst before it reaches an
  // adapter, so the storm is visible as a RECORDED refusal rather than as sends.
  // Asserting the refused projection keeps the canary honest (it still measures
  // "the scan saw 51 fresh messages, not 1") and additionally proves the
  // backstop fires when the classification layer is broken. If BOTH layers were
  // gutted this assertion goes red on the trips array being empty.
  assert(mutantTrips?.length === 1 && mutantTrips[0].projected === (players.length - 1) * 51 && mutantTrips[0].messages === 51,
    `[13c] MUTATION CONFIRMED: with the seed disabled, the watermark stays stuck at 0 and the next scan re-floods all 51 messages — ${(players.length - 1) * 51} relay sends, now intercepted and recorded by the burst cap (got ${JSON.stringify(mutantTrips)}) — this IS the storm F1 fixes`);
  assert(mutantStormCount === 0,
    `[13c'] and the second layer means the mutated build sent NOTHING rather than ${(players.length - 1) * 51} pushes — got ${mutantStormCount}`);

  const restored = await readFile(target, 'utf8');
  assert(restored === original, '[13d] source restored byte-for-byte from the scratch copy — never via git checkout/restore/stash');

  // Re-import the REAL (restored) module and prove it's green again.
  const freshNotif = await import(`./js/notifications.js?restored=${Date.now()}`);
  chat._resetForTest();
  chat.initChat('p1');
  freshNotif._resetChatWatermarkForTest();
  const capturedFresh = [];
  class CapAdapterF { isConfigured() { return true; } async send(record) { capturedFresh.push(record); return { ok: true }; } }
  freshNotif.registerPushAdapter(new CapAdapterF());
  freshNotif.wireChatNotifications();
  const backfillF = [];
  for (let i = 1; i <= 50; i++) backfillF.push({ id: `ffb_${i}`, seq: i, ts: Date.now(), type: 'message', author: 'p2', gameTag: '', body: `m${i}`, targetId: '', replyTo: '', notify: true, meta: null });
  chat.ingest(backfillF);
  await new Promise(r => setTimeout(r, 5));
  chat.ingest([{ id: 'fnew', seq: 51, ts: Date.now(), type: 'message', author: 'p2', gameTag: '', body: 'new', targetId: '', replyTo: '', notify: true, meta: null }]);
  await new Promise(r => setTimeout(r, 10));
  const freshCount = capturedFresh.filter(r => r.event === 'CHAT_MESSAGE_CREATED').length;
  assert(freshCount === players.length - 1, `[13e] guard is GREEN again after restore — only the ONE genuinely new message fires (got ${freshCount}, expected ${players.length - 1})`);
  chat._resetForTest();
  freshNotif._clearPushAdapterForTest();
  freshNotif._resetChatWatermarkForTest();
}

console.log('\n[14] F6 — demo-week suppression (client orchestration + server twin)…');
{
  storage.setNotifications([]);
  const demoWeek = freshWeek({ dataSourceMode: 'demo' });
  assert(notif.notifyPicksOpened(demoWeek, players).length === 0, 'notifyPicksOpened: zero fires for a demo week');
  assert(notif.notifyPicksReminder(demoWeek, players[0], 3, '1h', '1h') === null, 'notifyPicksReminder: no-op for a demo week');
  assert(notif.notifyPicksLockingSoon(demoWeek, players, ['Kevin'], 5, 6, '1h').length === 0, 'notifyPicksLockingSoon: zero fires for a demo week');
  assert(notif.notifyPicksLocked(demoWeek, players, 6, 6).length === 0, 'notifyPicksLocked: zero fires for a demo week');
  assert(notif.notifyResultsFinalized(demoWeek, 'Kihoon', 'Koby', players).length === 0, 'notifyResultsFinalized: zero fires for a demo week');
  assert(storage.getNotifications().length === 0, 'no cfbp_notifications rows were created for the demo week across any of the above');

  // Server twin — computeReminderPlan() must independently suppress demo weeks.
  const demoServerWeek = { ...freshWeek({ dataSourceMode: 'demo' }), picksLockAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() };
  const demoGames = [1, 2].map((n, i) => dataModel.createGame(demoServerWeek.weekId, { gameId: `dg${i + 1}`, kickoff: demoServerWeek.picksLockAt }));
  const demoPlan = server.computeReminderPlan({ week: demoServerWeek, games: demoGames, picks: [], players, now: Date.now() });
  assert(demoPlan.remindersPlan.length === 0 && demoPlan.lockingSoonPlan === null, 'server twin: computeReminderPlan() returns an EMPTY plan for a demo week, independent of the client');
}

console.log('\n[15] F5 — Code.gs twin-drift (structural + SCRIBE pool content) + behavioral twin…');
{
  const gsSource = await readFile(fileURLToPath(new URL('./backend/Code.gs', import.meta.url)), 'utf8');

  // Structural drift guard — every twin symbol this batch's Code.gs work
  // depends on must still exist under its expected name (captest precedent).
  ['REMINDER_THRESHOLDS', 'LOCKING_SOON_MS', 'firstKickoffMs_', 'effectiveLockAtMs_',
   'isValidDedupKey', 'selectActiveOpenWeek_', 'scanReminders', 'ensureNotifyLogSheet',
   'notifyLogRead', 'appendNotifyLogRows_', 'applyReminderScanCandidates_',
   'SCRIBE_PICKS_REMINDER_POOL', 'SCRIBE_PICKS_LOCKING_SOON_POOL', 'SCRIBE_PICKS_LOCKING_SOON_ALL_IN_POOL',
   'pruneNotifySentBefore',
   // BLOCKING #1 + non-blocking #7 remediation (2026-09-10) additions —
   // the master×category push gate and the auto-prune throttle.
   'resolveServerPushIntent_', 'autoPruneNotifySentIfDue_', 'NOTIFY_SENT_PRUNE_AGE_DAYS',
  ].forEach(name => assert(gsSource.includes(name), `Code.gs contains twin symbol "${name}" (structural drift guard, F5)`));

  // Content drift guard — Code.gs's manually-ported SCRIBE pools must stay
  // byte-identical (content AND order) to notify-copy.js's own pools, since
  // both pick a pool member by the SAME dedupKey-seeded index. This is a
  // REAL content diff, not just a name match.
  function extractGsArrayLiteral(source, varName) {
    const re = new RegExp(`var ${varName} = (\\[[\\s\\S]*?\\]);`);
    const m = source.match(re);
    if (!m) return null;
    try { return new Function(`return ${m[1]};`)(); } catch { return null; }
  }
  const pools = copy._poolsForTest();
  const gsReminderPool = extractGsArrayLiteral(gsSource, 'SCRIBE_PICKS_REMINDER_POOL');
  const gsLockingPool = extractGsArrayLiteral(gsSource, 'SCRIBE_PICKS_LOCKING_SOON_POOL');
  const gsAllInPool = extractGsArrayLiteral(gsSource, 'SCRIBE_PICKS_LOCKING_SOON_ALL_IN_POOL');
  assert(Array.isArray(gsReminderPool) && gsReminderPool.length > 0, 'Code.gs SCRIBE_PICKS_REMINDER_POOL parses to a non-empty array');
  assert(JSON.stringify(gsReminderPool) === JSON.stringify(pools.PICKS_REMINDER),
    'Code.gs SCRIBE_PICKS_REMINDER_POOL is byte-identical (content + order) to notify-copy.js POOLS.PICKS_REMINDER');
  assert(JSON.stringify(gsLockingPool) === JSON.stringify(pools.PICKS_LOCKING_SOON),
    'Code.gs SCRIBE_PICKS_LOCKING_SOON_POOL is byte-identical (content + order) to notify-copy.js POOLS.PICKS_LOCKING_SOON');
  assert(JSON.stringify(gsAllInPool) === JSON.stringify(pools.PICKS_LOCKING_SOON_ALL_IN),
    'Code.gs SCRIBE_PICKS_LOCKING_SOON_ALL_IN_POOL is byte-identical (content + order) to notify-copy.js POOLS.PICKS_LOCKING_SOON_ALL_IN');

  // Behavioral twin — same fixture, same decision, called twice (determinism
  // — the same dedupKey-seeded pool selection must never "flicker").
  const week = { ...freshWeek(), picksLockAt: new Date(Date.now() + 50 * 60 * 1000).toISOString() };
  const games = [1, 2, 3].map((n, i) => dataModel.createGame(week.weekId, { gameId: `bg${i + 1}`, kickoff: week.picksLockAt }));
  const picks = [dataModel.createPick(week.weekId, 'bg1', 'p1', 'home')];
  const now = Date.now();
  const planA = server.computeReminderPlan({ week, games, picks, players, now });
  const planB = server.computeReminderPlan({ week, games, picks, players, now });
  assert(JSON.stringify(planA) === JSON.stringify(planB), 'behavioral twin: computeReminderPlan() is deterministic — same fixture, same "now" -> byte-identical plan both times');

  // selectActiveOpenWeek twin — cfbp_active_week precedence, earliest-lock
  // tiebreak among multiple simultaneously-open weeks, demo weeks untouched
  // by this selector (suppression is computeReminderPlan's/scanReminders'
  // job, not the selector's).
  const wA = { ...freshWeek({ weekId: 'w_a', status: 'open' }), picksLockAt: new Date(now + 2 * 60 * 60 * 1000).toISOString() };
  const wB = { ...freshWeek({ weekId: 'w_b', status: 'open' }), picksLockAt: new Date(now + 30 * 60 * 1000).toISOString() };
  const gA = [dataModel.createGame('w_a', { gameId: 'gA1', kickoff: wA.picksLockAt })];
  const gB = [dataModel.createGame('w_b', { gameId: 'gB1', kickoff: wB.picksLockAt })];
  const picked = server.selectActiveOpenWeek({ weeks: [wA, wB], activeWeekId: null, games: [...gA, ...gB] });
  assert(picked?.weekId === 'w_b', `no active pointer, two OPEN weeks -> the one locking SOONEST wins (got "${picked?.weekId}", expected "w_b")`);
  const pickedByActive = server.selectActiveOpenWeek({ weeks: [wA, wB], activeWeekId: 'w_a', games: [...gA, ...gB] });
  assert(pickedByActive?.weekId === 'w_a', 'an explicit cfbp_active_week pointer wins over the earliest-lock tiebreak');
  const pickedFallback = server.selectActiveOpenWeek({ weeks: [wA, wB], activeWeekId: 'w_nonexistent_or_not_open', games: [...gA, ...gB] });
  assert(pickedFallback?.weekId === 'w_b', 'an active pointer that does not resolve to an OPEN week falls back to the earliest-lock tiebreak, not array order');
  const pickedNone = server.selectActiveOpenWeek({ weeks: [], activeWeekId: null, games: [] });
  assert(pickedNone === null, 'no open weeks at all -> null, never throws');
}

console.log('\n[15b] F10 — _sessionFiredDedupKeys is bounded (FIFO-evicted), not unbounded…');
{
  const chat = await import('./js/chat.js');
  chat._resetForTest();
  chat.initChat('p1');
  notif._resetChatWatermarkForTest();
  notif._clearPushAdapterForTest();
  const cap = notif._sessionFiredDedupCapForTest();
  assert(typeof cap === 'number' && cap > 0, 'a real, positive cap is defined');

  // Prime the watermark with one backfill message (same pattern as [8]/[12]),
  // then fire more than `cap` DISTINCT chat dedupKeys (one per message id) so
  // the guard's insertion-order queue is forced to evict.
  chat.ingest([{ id: 'sfdk_seed', seq: 1, ts: Date.now(), type: 'message', author: 'p1', gameTag: '', body: 'seed', targetId: '', replyTo: '', notify: true, meta: null }]);
  notif.wireChatNotifications();
  const overflow = 25;
  const batch = [];
  for (let i = 0; i < cap + overflow; i++) {
    batch.push({ id: `sfdk_${i}`, seq: i + 2, ts: Date.now(), type: 'message', author: 'p1', gameTag: '', body: `m${i}`, targetId: '', replyTo: '', notify: true, meta: null });
  }
  chat.ingest(batch);
  await new Promise(r => setTimeout(r, 20));
  const size = notif._sessionFiredDedupSizeForTest();
  assert(size <= cap, `the in-memory guard never exceeds its cap even after firing ${cap + overflow} distinct dedupKeys (size=${size}, cap=${cap})`);
  assert(size > 0, 'the guard did retain SOME recent entries (not silently emptied)');

  chat._resetForTest();
  notif._resetChatWatermarkForTest();
  notif._clearPushAdapterForTest();
}

console.log('\n[16] F3 — service-worker.js OneSignal import is exception-isolated…');
{
  const swSource = await readFile(fileURLToPath(new URL('./service-worker.js', import.meta.url)), 'utf8');
  assert(swSource.includes("importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js')"),
    'service-worker.js still imports the OneSignal SW script (structural sanity check)');
  const tryBlockMatch = swSource.match(/try\s*\{\s*importScripts\(\s*['"]https:\/\/cdn\.onesignal\.com\/sdks\/web\/v16\/OneSignalSDK\.sw\.js['"]\s*\);?\s*\}\s*catch/);
  assert(!!tryBlockMatch, 'the importScripts(...) call is wrapped in try/catch — a 404/network failure degrades to "no push" only, never fails SW install (F3)');
  assert(swSource.includes('VERIFY ON DEVICE'), 'the wrap carries the required "// VERIFY ON DEVICE" marker for the unconfirmed OneSignal SDK URL');
  // Cache-shell behavior must be untouched by the wrap — install/activate/
  // fetch listeners still present, unconditionally.
  assert(swSource.includes("self.addEventListener('install'"), 'install listener still present (cache-shell behavior intact)');
  assert(swSource.includes("self.addEventListener('activate'"), 'activate listener still present');
  assert(swSource.includes("self.addEventListener('fetch'"), 'fetch listener still present');
}

// ═══════════════════════════════════════════════════════════════════════════
// REMEDIATION ROUND 2 (2026-09-10) — Build 1 reviewer re-review BLOCK fixes.
// Sections [17]-[21] below cover the two BLOCKING findings and the five
// non-blocking findings from the second review pass.
// ═══════════════════════════════════════════════════════════════════════════
const NULLISH_RE = /\b(null|undefined)\b/i;

console.log('\n[17] BLOCKING #1 — server-fired reminders now respect master×category preferences…');
{
  // Unit — resolveServerPushIntent() truth table, direct.
  const on = { preferences: { notifyPushMaster: true, notifyCategories: { pickReminders: true } } };
  const catOff = { preferences: { notifyPushMaster: true, notifyCategories: { pickReminders: false } } };
  const masterOff = { preferences: { notifyPushMaster: false, notifyCategories: { pickReminders: true } } };
  const bothOff = { preferences: { notifyPushMaster: false, notifyCategories: { pickReminders: false } } };
  const missing = { preferences: {} };
  assert(server.resolveServerPushIntent({ player: on, category: 'pickReminders' }) === true, 'category ON + master ON -> push true');
  assert(server.resolveServerPushIntent({ player: catOff, category: 'pickReminders' }) === false, 'category OFF -> push false regardless of master');
  assert(server.resolveServerPushIntent({ player: masterOff, category: 'pickReminders' }) === false, 'master OFF -> push false regardless of category');
  assert(server.resolveServerPushIntent({ player: bothOff, category: 'pickReminders' }) === false, 'both OFF -> push false');
  assert(server.resolveServerPushIntent({ player: missing, category: 'pickReminders' }) === true, 'default-when-missing reads as ON (opt-out model, matches getNotifyPushMasterFor/getNotifyCategoryPrefsFor)');
  assert(server.resolveServerPushIntent({ player: missing, category: null }) === true, 'category=null (never-silenceable events) with missing prefs -> push true (master defaults on)');
  assert(server.resolveServerPushIntent({ player: { preferences: { notifyPushMaster: false } }, category: null }) === false, 'category=null still respects an explicit master OFF');

  // Integration — computeReminderPlan + applyPlan against three players in
  // three different preference states: BOTH ON, category OFF, master OFF.
  const week17 = { ...freshWeek(), picksLockAt: new Date(Date.now() + 50 * 60 * 1000).toISOString() };
  const games17 = [1, 2].map((n, i) => dataModel.createGame(week17.weekId, { gameId: `pg${i + 1}`, kickoff: week17.picksLockAt }));
  const testPlayers = players.slice(0, 3).map((p, i) => ({
    ...p,
    preferences: [
      { notifyPushMaster: true, notifyCategories: { pickReminders: true, leagueUpdates: true } },   // [0] both ON
      { notifyPushMaster: true, notifyCategories: { pickReminders: false, leagueUpdates: false } },  // [1] category OFF
      { notifyPushMaster: false, notifyCategories: { pickReminders: true, leagueUpdates: true } },   // [2] master OFF
    ][i],
  }));
  const plan17 = server.computeReminderPlan({ week: week17, games: games17, picks: [], players: testPlayers, now: Date.now() });
  assert(plan17.remindersPlan.length > 0, 'plan17: at least one PICKS_REMINDER candidate crossed a threshold (sanity, non-vacuous)');
  assert(!!plan17.lockingSoonPlan, 'plan17: PICKS_LOCKING_SOON also crossed its window (sanity, non-vacuous)');
  const store17 = server.makeFakeNotifySentStore();
  const result17 = server.applyPlan(plan17, store17, testPlayers);

  const loggedReminderIds = new Set(result17.logEntries.filter(e => e.event === 'PICKS_REMINDER').map(e => e.playerId));
  assert(testPlayers.every(p => loggedReminderIds.has(p.playerId)),
    'PICKS_REMINDER: every candidate gets a logEntries row (in-app-record analogue) REGARDLESS of preference');
  const pushedReminderIds = new Set();
  result17.calls.filter(c => c.event === 'PICKS_REMINDER').forEach(c => c.playerIds.forEach(id => pushedReminderIds.add(id)));
  assert(pushedReminderIds.has(testPlayers[0].playerId), 'PICKS_REMINDER: both-ON player IS pushed');
  assert(!pushedReminderIds.has(testPlayers[1].playerId), 'PICKS_REMINDER: category-OFF player is NOT pushed (but its log row above still exists)');
  assert(!pushedReminderIds.has(testPlayers[2].playerId), 'PICKS_REMINDER: master-OFF player is NOT pushed (but its log row above still exists)');

  const loggedLockingIds = new Set(result17.logEntries.filter(e => e.event === 'PICKS_LOCKING_SOON').map(e => e.playerId));
  assert(testPlayers.every(p => loggedLockingIds.has(p.playerId)),
    'PICKS_LOCKING_SOON: every candidate gets a logEntries row REGARDLESS of preference');
  const pushedLockingIds = new Set();
  result17.calls.filter(c => c.event === 'PICKS_LOCKING_SOON').forEach(c => c.playerIds.forEach(id => pushedLockingIds.add(id)));
  assert(pushedLockingIds.has(testPlayers[0].playerId) && !pushedLockingIds.has(testPlayers[1].playerId) && !pushedLockingIds.has(testPlayers[2].playerId),
    'PICKS_LOCKING_SOON: only the both-ON player is actually pushed — category/master-OFF players are excluded from the batched OneSignal call');
}

// ── [17b] Mutation check — BLOCKING #1's push gate (resolveServerPushIntent
//    in backend/notifyServer.mjs, the TESTED TWIN of Code.gs's
//    resolveServerPushIntent_ — see that file's header on why the twin,
//    not the GAS source itself, is what mutation-testing targets here).
//    Restore from a SCRATCH COPY — never git checkout/restore/stash. ────────
console.log('\n[17b] Mutation check — BLOCKING #1 push gate (resolveServerPushIntent)…');
{
  const target = fileURLToPath(new URL('./backend/notifyServer.mjs', import.meta.url));
  const scratchDir = process.env.TMPDIR || '/tmp';
  const scratchCopy = `${scratchDir}/notifyServer.pre-mutation.${Date.now()}.mjs`;
  await copyFile(target, scratchCopy);
  const original = await readFile(target, 'utf8');

  const needle = 'export function resolveServerPushIntent({ player, category }) {';
  assert(original.includes(needle), '[17b-a] mutation target text found verbatim in backend/notifyServer.mjs');
  const gutted = original.replace(needle, needle + '\n  return true; // MUTATION: BLOCKING #1 gate disabled for notifytest.mjs [17b]\n');
  assert(gutted !== original, '[17b-b] the mutation actually changed the source (non-vacuous)');
  await writeFile(target, gutted, 'utf8');

  const week17b = { ...freshWeek(), picksLockAt: new Date(Date.now() + 50 * 60 * 1000).toISOString() };
  const games17b = [1, 2].map((n, i) => dataModel.createGame(week17b.weekId, { gameId: `mg${i + 1}`, kickoff: week17b.picksLockAt }));
  const testPlayers17b = players.slice(0, 3).map((p, i) => ({
    ...p,
    preferences: [
      { notifyPushMaster: true, notifyCategories: { pickReminders: true, leagueUpdates: true } },
      { notifyPushMaster: true, notifyCategories: { pickReminders: false, leagueUpdates: false } },
      { notifyPushMaster: false, notifyCategories: { pickReminders: true, leagueUpdates: true } },
    ][i],
  }));
  let mutantPushedCatOff = false, mutantPushedMasterOff = false;
  try {
    const mutantServer = await import(`./backend/notifyServer.mjs?mutant=${Date.now()}`);
    const mplan = mutantServer.computeReminderPlan({ week: week17b, games: games17b, picks: [], players: testPlayers17b, now: Date.now() });
    const mstore = mutantServer.makeFakeNotifySentStore();
    const mresult = mutantServer.applyPlan(mplan, mstore, testPlayers17b);
    const mPushedIds = new Set();
    mresult.calls.filter(c => c.event === 'PICKS_REMINDER').forEach(c => c.playerIds.forEach(id => mPushedIds.add(id)));
    mutantPushedCatOff = mPushedIds.has(testPlayers17b[1].playerId);
    mutantPushedMasterOff = mPushedIds.has(testPlayers17b[2].playerId);
  } finally {
    // restore immediately, before any assertion, so a crash mid-check can
    // never leave the gutted gate live in the working tree.
    await copyFile(scratchCopy, target);
  }
  assert(mutantPushedCatOff === true, '[17b-c] MUTATION CONFIRMED: with the gate disabled, the category-OFF player IS pushed — the suite would be red on this specific preference');
  assert(mutantPushedMasterOff === true, '[17b-d] MUTATION CONFIRMED: with the gate disabled, the master-OFF player is pushed too');

  const restored = await readFile(target, 'utf8');
  assert(restored === original, '[17b-e] source restored byte-for-byte from the scratch copy — never via git checkout/restore/stash');

  const freshServer = await import(`./backend/notifyServer.mjs?restored=${Date.now()}`);
  const fplan = freshServer.computeReminderPlan({ week: week17b, games: games17b, picks: [], players: testPlayers17b, now: Date.now() });
  const fstore = freshServer.makeFakeNotifySentStore();
  const fresult = freshServer.applyPlan(fplan, fstore, testPlayers17b);
  const fPushedIds = new Set();
  fresult.calls.filter(c => c.event === 'PICKS_REMINDER').forEach(c => c.playerIds.forEach(id => fPushedIds.add(id)));
  assert(!fPushedIds.has(testPlayers17b[1].playerId) && !fPushedIds.has(testPlayers17b[2].playerId),
    '[17b-f] guard is GREEN again after restore — category/master-OFF players are correctly excluded from push again');
}

console.log('\n[18] BLOCKING #2 — a missing winner/loser never renders "null"/"undefined" in a notification body…');
{
  storage.setNotifications([]);
  const week18 = freshWeek();
  const results18 = notif.notifyResultsFinalized(week18, null, null, players);
  assert(results18.length === players.length, 'notifyResultsFinalized fires for every active player even with no winner/loser facts');
  results18.forEach(r => {
    assert(!!r.record, 'every recipient produced a record');
    assert(!NULLISH_RE.test(r.record.body), `body contains no literal "null"/"undefined" (got: "${r.record.body}")`);
  });
  const expectedFallback = copy._fallbackTextForTest('RESULTS_FINALIZED', { weekN: week18.weekNumber });
  assert(results18.every(r => r.record.body === expectedFallback),
    `every recipient gets the EXACT deterministic fallback ("${expectedFallback}") when winner/loser are absent — no half-substituted SCRIBE template`);

  // buildCopy() directly, undefined facts (the FIXED shape notifications.js now passes).
  const directUndefined = copy.buildCopy('RESULTS_FINALIZED', { weekN: 3, weekWinnerName: undefined, weekLoserName: undefined }, 'dk_undef');
  assert(directUndefined.scribeVoiced === false, 'undefined facts correctly fall back to the non-SCRIBE deterministic string');
  assert(!NULLISH_RE.test(directUndefined.body), 'undefined-fact call renders no null/undefined literal');

  // buildCopy() directly, null facts (a caller that has NOT been fixed — the
  // structural half of BLOCKING #2, proving notify-copy.js's OWN presence
  // test is now hardened independent of any one caller's fix).
  const directNull = copy.buildCopy('RESULTS_FINALIZED', { weekN: 3, weekWinnerName: null, weekLoserName: null }, 'dk_null');
  assert(directNull.scribeVoiced === false, 'null facts ALSO fall back to the deterministic string (structural fix, not just the one caller)');
  assert(!NULLISH_RE.test(directNull.body), `null-fact call renders no null/undefined literal (got: "${directNull.body}")`);

  // isPresentFact() unit coverage — 0/false are real facts, null/''/undefined are not.
  assert(copy._isPresentFactForTest(0) === true, '0 is a present fact (never treated as absent)');
  assert(copy._isPresentFactForTest(false) === true, 'false is a present fact (never treated as absent)');
  assert(copy._isPresentFactForTest('x') === true, 'a non-empty string is a present fact');
  assert(copy._isPresentFactForTest(null) === false, 'null is NOT a present fact');
  assert(copy._isPresentFactForTest(undefined) === false, 'undefined is NOT a present fact');
  assert(copy._isPresentFactForTest('') === false, 'empty string is NOT a present fact');

  // Structural sweep — "no template placeholder can render null/undefined,"
  // every known event, meta empty / all-null / all-empty-string.
  let sweepChecked = 0;
  for (const event of copy._knownEvents()) {
    const allowedKeys = copy.ALLOWED_META_KEYS[event] || [];
    const emptyOut = copy.buildCopy(event, {}, 'dk_empty_' + event);
    const nullMeta = {}; allowedKeys.forEach(k => { nullMeta[k] = null; });
    const nullOut = copy.buildCopy(event, nullMeta, 'dk_null_' + event);
    const emptyStrMeta = {}; allowedKeys.forEach(k => { emptyStrMeta[k] = ''; });
    const emptyStrOut = copy.buildCopy(event, emptyStrMeta, 'dk_emptystr_' + event);
    sweepChecked++;
    assert(!NULLISH_RE.test(emptyOut.body), `${event}: empty meta never renders null/undefined (got "${emptyOut.body}")`);
    assert(!NULLISH_RE.test(nullOut.body), `${event}: all-null meta never renders null/undefined (got "${nullOut.body}")`);
    assert(!NULLISH_RE.test(emptyStrOut.body), `${event}: all-empty-string meta never renders null/undefined (got "${emptyStrOut.body}")`);
  }
  assert(sweepChecked === copy._knownEvents().length, 'the structural sweep is non-vacuous — every known event was actually exercised');
  storage.setNotifications([]);
}

// ── [18b] Mutation check — BLOCKING #2's presence test (isPresentFact in
//    js/notify-copy.js). Restore from a SCRATCH COPY — never git
//    checkout/restore/stash. ─────────────────────────────────────────────
console.log('\n[18b] Mutation check — BLOCKING #2 presence test (isPresentFact)…');
{
  const target = fileURLToPath(new URL('./js/notify-copy.js', import.meta.url));
  const scratchDir = process.env.TMPDIR || '/tmp';
  const scratchCopy = `${scratchDir}/notify-copy.presence.pre-mutation.${Date.now()}.js`;
  await copyFile(target, scratchCopy);
  const original = await readFile(target, 'utf8');

  const needle = "function isPresentFact(v) {\n  return v !== undefined && v !== null && v !== '';\n}";
  assert(original.includes(needle), '[18b-a] mutation target text found verbatim in js/notify-copy.js');
  const gutted = original.replace(needle, "function isPresentFact(v) { return v !== undefined; /* MUTATION: BLOCKING #2 narrowed back to the retired presence test for notifytest.mjs [18b] */ }");
  assert(gutted !== original, '[18b-b] the mutation actually changed the source (non-vacuous)');
  await writeFile(target, gutted, 'utf8');

  let mutantBody = '';
  try {
    const mutantCopy = await import(`./js/notify-copy.js?mutant=${Date.now()}`);
    mutantBody = mutantCopy.buildCopy('RESULTS_FINALIZED', { weekN: 3, weekWinnerName: null, weekLoserName: null }, 'dk_mutant').body;
  } finally {
    await copyFile(scratchCopy, target);
  }
  assert(NULLISH_RE.test(mutantBody), `[18b-c] MUTATION CONFIRMED: with the presence test narrowed back to "!== undefined", a null fact renders the literal string "null" (got: "${mutantBody}") — the suite would be red on this specific assertion`);

  const restored = await readFile(target, 'utf8');
  assert(restored === original, '[18b-d] source restored byte-for-byte from the scratch copy — never via git checkout/restore/stash');

  const freshCopy = await import(`./js/notify-copy.js?restored=${Date.now()}`);
  const freshBody = freshCopy.buildCopy('RESULTS_FINALIZED', { weekN: 3, weekWinnerName: null, weekLoserName: null }, 'dk_fresh').body;
  assert(!NULLISH_RE.test(freshBody), `[18b-e] guard is GREEN again after restore — a null fact correctly falls back (got: "${freshBody}")`);
}

console.log('\n[19] NON-BLOCKING #3 — retention applies to the MERGED (client+server) list…');
{
  storage.setNotifications([]);
  notif._resetNotifyLogCacheForTest();
  const pid19 = players[0].playerId;

  const freshRow = { id: 'ntf_fresh_1', playerId: pid19, event: 'PICKS_OPENED', actor: { kind: 'scribe', playerId: null }, title: 'Picks are open', body: 'fresh', destination: { tab: 'picks', params: {} }, createdAt: new Date().toISOString(), readAt: null, dedupKey: 'dk_fresh_1', weekId: 'w_test', meta: {} };
  storage.setNotifications([freshRow]);
  const oldIso = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
  const oldServerRow = { id: 'ntf_old_server_1', playerId: pid19, event: 'PICKS_REMINDER', actor: { kind: 'scribe', playerId: null }, title: 'Picks reminder', body: 'stale', destination: { tab: 'picks', params: {} }, createdAt: oldIso, readAt: null, dedupKey: 'dk_old_server_1', weekId: 'w_test', meta: {} };
  localStorage.setItem('cfbp_notify_log_cache', JSON.stringify({ byPlayer: { [pid19]: { cursorSeq: 1, records: [oldServerRow] } } }));

  const merged19 = notif.getNotificationsForPlayer(pid19);
  assert(merged19.length === 1, `a 45-day-old server row is pruned from the merged read surface (got ${merged19.length} rows, expected 1)`);
  assert(merged19[0]?.id === 'ntf_fresh_1', 'the surviving row is the fresh one, not the stale server row');
  assert(notif.unreadLifecycleCount(pid19) === 1, 'the stale server row does not count toward the bell badge');

  // 400 fresh server rows -> the Center shows at most the 200-per-player cap.
  storage.setNotifications([]);
  notif._resetNotifyLogCacheForTest();
  const pid19b = players[1].playerId;
  const manyRows = [];
  for (let i = 0; i < 400; i++) {
    manyRows.push({ id: `ntf_many_${i}`, playerId: pid19b, event: 'PICKS_OPENED', actor: { kind: 'scribe', playerId: null }, title: 'Picks are open', body: `row ${i}`, destination: { tab: 'picks', params: {} }, createdAt: new Date(Date.now() - i * 1000).toISOString(), readAt: null, dedupKey: `dk_many_${i}`, weekId: 'w_test', meta: {} });
  }
  localStorage.setItem('cfbp_notify_log_cache', JSON.stringify({ byPlayer: { [pid19b]: { cursorSeq: 400, records: manyRows } } }));
  const merged19b = notif.getNotificationsForPlayer(pid19b);
  assert(merged19b.length <= 200, `400 fresh server rows -> the Center shows at most the 200-per-player cap (got ${merged19b.length})`);

  storage.setNotifications([]);
  notif._resetNotifyLogCacheForTest();
}

console.log('\n[20] NON-BLOCKING #4/#5 — device-local read state (all origins) + append-only shared list + safe union…');
{
  const be = await import('./js/backend.js');

  // (a) mark-read never rewrites the shared cfbp_notifications key.
  storage.setNotifications([]);
  const week20 = freshWeek();
  const fired20 = notif.notifyPicksOpened(week20, players);
  const rec20 = fired20[0].record;
  const before20 = JSON.stringify(storage.getNotifications());
  const ok20 = notif.markNotificationRead(rec20.id, rec20.playerId);
  assert(ok20 === true, 'markNotificationRead resolves a client-origin id');
  const after20 = JSON.stringify(storage.getNotifications());
  assert(before20 === after20, 'mark-read NEVER writes the shared cfbp_notifications key (byte-identical raw storage before/after)');
  const overlaid20 = notif.getNotificationsForPlayer(rec20.playerId).find(n => n.id === rec20.id);
  assert(!!overlaid20?.readAt, 'the read state IS visible through getNotificationsForPlayer (device-local overlay), even though the shared record itself was never touched');

  // (b) createInAppNotification is append-only — a stale row already in the
  // shared list survives a NEW write untouched (no write-time prune/rewrite);
  // the READ surface still hides it (retention is read-time-only now).
  storage.setNotifications([]);
  const staleIso = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
  const pid20c = players[2].playerId;
  const staleRow = { id: 'ntf_stale_write', playerId: pid20c, event: 'PICKS_OPENED', actor: { kind: 'scribe', playerId: null }, title: 'x', body: 'x', destination: { tab: 'picks', params: {} }, createdAt: staleIso, readAt: null, dedupKey: 'dk_stale_write', weekId: null, meta: {} };
  storage.setNotifications([staleRow]);
  notif.createInAppNotification({ id: 'ntf_new_write', playerId: pid20c, event: 'PICKS_OPENED', actor: { kind: 'scribe', playerId: null }, title: 'y', body: 'y', destination: { tab: 'picks', params: {} }, createdAt: new Date().toISOString(), readAt: null, dedupKey: 'dk_new_write', weekId: null, meta: {} });
  const rawAfterWrite = storage.getNotifications();
  assert(rawAfterWrite.some(n => n.id === 'ntf_stale_write'), 'createInAppNotification is APPEND-ONLY — a stale row already in the shared list survives a new write');
  assert(rawAfterWrite.some(n => n.id === 'ntf_new_write'), 'the new row was appended');
  assert(!notif.getNotificationsForPlayer(pid20c).some(n => n.id === 'ntf_stale_write'), 'the READ surface still hides the stale row — pruning is read-time-only now, not a write-time delete');

  // (c) a held-write replay unions by id and loses no rows; a resurrected
  // old row is hidden by read-time retention, not by the union itself.
  storage.setNotifications([]);
  const pid20d = players[3].playerId;
  const remoteList = [{ id: 'ntf_remote_fresh', playerId: pid20d, event: 'PICKS_OPENED', createdAt: new Date().toISOString(), readAt: null, dedupKey: 'dk_remote_fresh', body: 'remote fresh' }];
  const staleLocalOldIso = new Date(Date.now() - 46 * 24 * 60 * 60 * 1000).toISOString();
  const localList = [
    { id: 'ntf_local_old', playerId: pid20d, event: 'PICKS_OPENED', createdAt: staleLocalOldIso, readAt: null, dedupKey: 'dk_local_old', body: 'local old' },
    { id: 'ntf_local_fresh_extra', playerId: pid20d, event: 'PICKS_OPENED', createdAt: new Date().toISOString(), readAt: null, dedupKey: 'dk_local_fresh_extra', body: 'local fresh extra' },
  ];
  const unioned = be._unionByIdForTest(localList, remoteList, 'id');
  assert(unioned.some(n => n.id === 'ntf_remote_fresh'), 'union: the remote row survives');
  assert(unioned.some(n => n.id === 'ntf_local_fresh_extra'), 'union: a local-only fresh row survives — a held-write replay loses no rows');
  assert(unioned.some(n => n.id === 'ntf_local_old'), 'union DOES resurrect the old local-only row by id — this is the hazard read-time retention exists to hide');

  storage.setNotifications(unioned);
  const readSurface20 = notif.getNotificationsForPlayer(pid20d);
  assert(readSurface20.some(n => n.id === 'ntf_remote_fresh') && readSurface20.some(n => n.id === 'ntf_local_fresh_extra'),
    'the read surface still shows both fresh rows after a resurrecting union');
  assert(!readSurface20.some(n => n.id === 'ntf_local_old'),
    'a resurrected 46-day-old row from the union is HIDDEN by read-time retention (prune is age-based at read, so the resurrection is invisible, not merely rare)');

  // (d) structural — cfbp_notifications is registered in backend.js's
  // append-only union map, the same pattern as cfbp_feedback.
  const beSource = await readFile(fileURLToPath(new URL('./js/backend.js', import.meta.url)), 'utf8');
  assert(/_APPEND_ONLY_ID\s*=\s*\{[^}]*cfbp_notifications\s*:\s*'id'/.test(beSource),
    "cfbp_notifications is registered in js/backend.js's _APPEND_ONLY_ID union map (RG-49 pattern, same as cfbp_feedback)");

  storage.setNotifications([]);
}

console.log('\n[21] NON-BLOCKING #7 — failed poll does not burn the throttle window; dead code removed; auto-prune wired…');
{
  // (a) a failed notifyLogFetch must NOT advance _lastLogPollAt — the very
  // next (unforced) call must still reach the network rather than silently
  // skipping for up to NOTIFY_LOG_POLL_MS.
  const be = await import('./js/backend.js');
  notif._resetNotifyLogCacheForTest();
  const savedConfig = be.getBackendConfig();
  be.setBackendConfig('https://example.invalid/exec', 'tok');   // isBackendConfigured():true, so notifyLogFetch actually calls out
  const savedFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls++; throw new Error('network disabled in notifytest'); };
  try {
    await notif.pollNotifyLog(players[0].playerId);   // _lastLogPollAt is 0 post-reset — this attempt is allowed regardless of the bug
    assert(fetchCalls === 1, 'first poll attempt actually reached the network (fetch called once)');
    await notif.pollNotifyLog(players[0].playerId);   // unforced — must STILL be allowed if the first failure did not burn the window
    assert(fetchCalls === 2, 'a FAILED poll does not burn the 60s throttle window — the very next unforced call still reaches the network');
  } finally {
    globalThis.fetch = savedFetch;
    if (savedConfig) be.setBackendConfig(savedConfig.url, savedConfig.token); else be.clearBackendConfig();
    notif._resetNotifyLogCacheForTest();
  }

  // (b) dead fireBatchNotification() removed; autoPruneNotifySentIfDue_()
  // actually wired into scanReminders(), not just defined.
  const gsSource21 = await readFile(fileURLToPath(new URL('./backend/Code.gs', import.meta.url)), 'utf8');
  assert(!gsSource21.includes('function fireBatchNotification('), 'dead fireBatchNotification() has been deleted (zero callers)');
  assert(gsSource21.includes('function autoPruneNotifySentIfDue_('), 'autoPruneNotifySentIfDue_() is defined');
  assert(/function scanReminders\(\)\s*\{\s*autoPruneNotifySentIfDue_\(\);/.test(gsSource21),
    'scanReminders() actually CALLS autoPruneNotifySentIfDue_() (wired, not just defined alongside)');
}

// ═══════════════════════════════════════════════════════════════════════════
// REVIEWER NOTE F1 CLOSE-OUT (Build 1 notifications, 2026-09-10) — [15]'s
// twin-drift guard for resolveServerPushIntent_/resolveServerPushIntent only
// checked the NAME (`gsSource.includes('resolveServerPushIntent_')`). The
// reviewer gutted the real Code.gs function body to `return true` and the
// suite stayed 247/0 green, because [17b]'s mutation test only exercises the
// TWIN (backend/notifyServer.mjs) — the code that actually runs on the
// server was unprotected against the next edit. [22]/[22b] close that gap
// with a BODY-level guard: the two bodies today differ only in parameter
// SHAPE (Code.gs is positional; the twin is destructured) — see [22c] — so
// per instruction this guard EXECUTES the real Code.gs source (the same
// `new Function(...)` technique [15] already uses for the SCRIBE pool
// literals) rather than relying on a text diff, and proves it behaviorally
// against the twin AND against js/notifications.js's resolveIntent(). [22b]
// then proves the new guard can actually fail, by gutting a SCRATCH COPY of
// Code.gs's text (the real file on disk is never opened for writing anywhere
// in this section — task instruction is explicit on that point).
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n[22] F1 close-out — body-level drift guard: EXECUTED Code.gs resolveServerPushIntent_ === notifyServer.mjs twin === js/notifications.js resolveIntent()…');
{
  // ── extraction/execution helpers ──────────────────────────────────────────
  // Balanced-brace function extraction (regex alone can't handle nested
  // braces in a function body the way [15]'s extractGsArrayLiteral() handles
  // a flat array literal, so this walks brace depth manually).
  function extractBalancedFunction(source, funcName) {
    const sigRe = new RegExp(`function\\s+${funcName}\\s*\\(([^)]*)\\)\\s*\\{`);
    const m = source.match(sigRe);
    if (!m) return null;
    const startIdx = m.index;
    const bodyStart = startIdx + m[0].length;
    let depth = 1, i = bodyStart;
    while (depth > 0 && i < source.length) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') depth--;
      i++;
    }
    if (depth !== 0) return null; // unbalanced — extraction failed, caller must treat as a hard miss
    return { fullText: source.slice(startIdx, i), params: m[1], bodyText: source.slice(bodyStart, i - 1) };
  }
  // Reuses [15]'s new Function(...) technique (already relied on there for
  // the SCRIBE pool literals) to turn extracted GAS source text into a real,
  // callable Node function — the EXECUTE approach, stronger than a text diff.
  function instantiateExtractedFunction(source, funcName) {
    const extracted = extractBalancedFunction(source, funcName);
    if (!extracted) return null;
    return new Function(`${extracted.fullText}\nreturn ${funcName};`)();
  }
  function normalizeBody(text) {
    return text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\bvar\b/g, 'const')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const gsSource22 = await readFile(fileURLToPath(new URL('./backend/Code.gs', import.meta.url)), 'utf8');
  const twinSource22 = await readFile(fileURLToPath(new URL('./backend/notifyServer.mjs', import.meta.url)), 'utf8');

  const gsExtracted = extractBalancedFunction(gsSource22, 'resolveServerPushIntent_');
  assert(!!gsExtracted, '[22a] resolveServerPushIntent_ extracted from Code.gs via balanced-brace regex (non-vacuous — extraction actually found the function)');
  const twinExtracted = extractBalancedFunction(twinSource22, 'resolveServerPushIntent');
  assert(!!twinExtracted, '[22b-extract] resolveServerPushIntent extracted from notifyServer.mjs via the SAME balanced-brace helper');

  // [22c] Signature SHAPE really does differ today (positional vs
  // destructured) — this is the documented reason the guard executes rather
  // than text-diffing the whole function including its signature.
  const gsSig = gsExtracted.params.replace(/\s+/g, ' ').trim();
  const twinSig = twinExtracted.params.replace(/\s+/g, ' ').trim();
  assert(gsSig !== twinSig,
    `[22c] confirmed real shape difference: Code.gs params "(${gsSig})" (positional) vs notifyServer.mjs params "(${twinSig})" (destructured) — not just var/const, so a naive full-text byte-compare would falsely flag drift on shape alone; EXECUTE is used instead`);

  // [22c-ii] Despite the signature differing, the BODY statements (var/const
  // normalized, comments/whitespace stripped) are byte-identical today — a
  // second, independent signal alongside the execute proof below.
  const gsBodyNorm = normalizeBody(gsExtracted.bodyText);
  const twinBodyNorm = normalizeBody(twinExtracted.bodyText);
  assert(gsBodyNorm === twinBodyNorm,
    '[22c-ii] normalized BODY text (var→const, comments/whitespace stripped, signature excluded) is byte-identical between Code.gs and notifyServer.mjs today');

  // [22d] EXECUTE the real Code.gs source — the primary, stronger guard.
  const gsFn = instantiateExtractedFunction(gsSource22, 'resolveServerPushIntent_');
  assert(typeof gsFn === 'function', '[22d] Code.gs\'s resolveServerPushIntent_ instantiated as a real callable Node function via new Function()');

  // [22e] Three-way truth table: EXECUTED Code.gs body vs the notifyServer.mjs
  // twin vs js/notifications.js's resolveIntent() (real import, storage-
  // backed — cheap to include per the task's "if cheap" instruction, since no
  // extraction is needed for a same-language, already-imported module).
  const truthCases = [
    { label: 'category ON, master ON',    master: true,      category: 'results', catOn: true },
    { label: 'category OFF, master ON',   master: true,      category: 'results', catOn: false },
    { label: 'category ON, master OFF',   master: false,     category: 'results', catOn: true },
    { label: 'category OFF, master OFF',  master: false,     category: 'results', catOn: false },
    { label: 'missing prefs entirely',    master: undefined, category: 'results', catOn: undefined },
    { label: 'category=null, master ON',  master: true,      category: null,      catOn: undefined },
    { label: 'category=null, master OFF', master: false,     category: null,      catOn: undefined },
  ];

  const pidTruth = players[5].playerId; // Kihoon — untouched by any earlier section in this file
  let checked22e = 0;
  for (const tc of truthCases) {
    const prefs = {};
    if (tc.master !== undefined) prefs.notifyPushMaster = tc.master;
    if (tc.catOn !== undefined) prefs.notifyCategories = { [tc.category]: tc.catOn };
    const playerObj = { playerId: pidTruth, preferences: prefs };

    const gsResult = gsFn(playerObj, tc.category);
    const twinResult = server.resolveServerPushIntent({ player: playerObj, category: tc.category });
    assert(gsResult === twinResult, `[22e] "${tc.label}": EXECUTED Code.gs body and notifyServer.mjs twin agree (both -> ${twinResult})`);

    const list = storage.getPlayers();
    const idx = list.findIndex(p => p.playerId === pidTruth);
    list[idx] = { ...list[idx], preferences: prefs };
    storage.savePlayer(list[idx]);
    const clientResult = notif.resolveIntent({ playerId: pidTruth, category: tc.category }).push;
    assert(clientResult === twinResult, `[22e] "${tc.label}": js/notifications.js's resolveIntent().push agrees with the server twin (both -> ${twinResult})`);
    checked22e++;
  }
  assert(checked22e === truthCases.length, '[22e] the three-way truth table is non-vacuous — every case actually executed');

  // restore the truth-table player's prefs
  const listRestore = storage.getPlayers();
  const idxRestore = listRestore.findIndex(p => p.playerId === pidTruth);
  listRestore[idxRestore] = { ...listRestore[idxRestore], preferences: {} };
  storage.savePlayer(listRestore[idxRestore]);
}

// ── [22b] Mutation canary — proves the NEW body-level guard can actually
//    fail. Gut a SCRATCH-ONLY copy of Code.gs's text (the real file on disk
//    is NEVER opened for writing anywhere in this block — task instruction:
//    "may edit ONLY notifytest.mjs... Do NOT edit Code.gs"). This is the
//    scenario the reviewer used to defeat [15]/[17b]'s name-only check. ─────
console.log('\n[22b] Mutation canary — body-level guard goes RED when Code.gs\'s function is gutted (scratch-copy only, real file never written)…');
{
  function extractBalancedFunction(source, funcName) {
    const sigRe = new RegExp(`function\\s+${funcName}\\s*\\(([^)]*)\\)\\s*\\{`);
    const m = source.match(sigRe);
    if (!m) return null;
    const startIdx = m.index;
    const bodyStart = startIdx + m[0].length;
    let depth = 1, i = bodyStart;
    while (depth > 0 && i < source.length) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') depth--;
      i++;
    }
    if (depth !== 0) return null;
    return { fullText: source.slice(startIdx, i) };
  }
  function instantiateExtractedFunction(source, funcName) {
    const extracted = extractBalancedFunction(source, funcName);
    if (!extracted) return null;
    return new Function(`${extracted.fullText}\nreturn ${funcName};`)();
  }

  const realCodeGsPath = fileURLToPath(new URL('./backend/Code.gs', import.meta.url));
  const gsSourceBefore = await readFile(realCodeGsPath, 'utf8');

  // Defensive backup of the REAL file's current bytes (paranoia layer only —
  // this file is never written to below, so this copy is never needed for a
  // restore, but it costs nothing and matches the codebase's "commit/copy
  // before anything risky" instinct).
  const scratchDir22 = process.env.TMPDIR || '/tmp';
  const scratchBackup = `${scratchDir22}/Code.gs.canary-backup.${Date.now()}.txt`;
  await copyFile(realCodeGsPath, scratchBackup);

  // The gutted variant exists ONLY as scratch text — it is written to a
  // scratch file, never to backend/Code.gs.
  const scratchGutted = `${scratchDir22}/Code.gs.canary-gutted.${Date.now()}.txt`;
  const guttedSource = gsSourceBefore.replace(
    'function resolveServerPushIntent_(player, category) {',
    'function resolveServerPushIntent_(player, category) { return true; // CANARY: gutted in a SCRATCH COPY ONLY — never written to the real Code.gs\n'
  );
  assert(guttedSource !== gsSourceBefore, '[22b-a] the canary mutation actually changed the scratch text (non-vacuous — the replace() found its target)');
  await writeFile(scratchGutted, guttedSource, 'utf8');

  const guttedText = await readFile(scratchGutted, 'utf8');
  const mutantFn = instantiateExtractedFunction(guttedText, 'resolveServerPushIntent_');
  assert(typeof mutantFn === 'function', '[22b-b] the gutted scratch function still instantiates (the mutation is a valid no-op body, not a syntax break)');

  const catOffPlayer = { playerId: 'canary_pid', preferences: { notifyPushMaster: true, notifyCategories: { results: false } } };
  const mutantResult = mutantFn(catOffPlayer, 'results');
  const realTwinResult = server.resolveServerPushIntent({ player: catOffPlayer, category: 'results' });
  assert(mutantResult === true && realTwinResult === false,
    `[22b-c] CANARY CONFIRMED: with Code.gs's resolveServerPushIntent_ gutted to "return true" (scratch copy only), the executed mutant returns true where the real twin returns false — this new drift guard WOULD go red against exactly the scenario that defeated [15]/[17b]'s name-only check (got mutant=${mutantResult}, twin=${realTwinResult})`);

  // Confirm the REAL, on-disk Code.gs was never touched by this section.
  const gsSourceAfter = await readFile(realCodeGsPath, 'utf8');
  assert(gsSourceAfter === gsSourceBefore, '[22b-d] the REAL Code.gs on disk is byte-identical before/after this canary — only a scratch copy was ever mutated (never git checkout/restore/stash — nothing to restore, since the real file was never written)');
}

console.log('\n[23] NOTIFY_NAME_NON_SUBMITTERS — named-laggard copy is a config flip (Drew\'s option 2, 2026-09-10)…');
{
  // Same balanced-brace extract/execute technique [22] established — a text
  // match on a function NAME is not proof its BODY still does anything (that
  // is exactly how F1's name-only guard was defeated).
  function extractBalancedFunction(source, funcName) {
    const sigRe = new RegExp(`function\\s+${funcName}\\s*\\(([^)]*)\\)\\s*\\{`);
    const m = source.match(sigRe);
    if (!m) return null;
    const bodyStart = m.index + m[0].length;
    let depth = 1, i = bodyStart;
    while (depth > 0 && i < source.length) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') depth--;
      i++;
    }
    if (depth !== 0) return null;
    return { fullText: source.slice(m.index, i) };
  }
  function instantiate(source, funcName) {
    const ex = extractBalancedFunction(source, funcName);
    return ex ? new Function(`${ex.fullText}\nreturn ${funcName};`)() : null;
  }

  const gsSrc = await readFile(fileURLToPath(new URL('./backend/Code.gs', import.meta.url)), 'utf8');

  // ── [23a] Structural drift guards — the property, its parser, the pool,
  //     and the setup() documentation line all exist under their expected
  //     names (same shape as [15]'s symbol list).
  ['NOTIFY_NAME_NON_SUBMITTERS_PROP', 'notifyNameNonSubmittersEnabled_',
   'SCRIBE_PICKS_LOCKING_SOON_COUNT_ONLY_POOL',
  ].forEach(name => assert(gsSrc.includes(name), `[23a] Code.gs contains twin symbol "${name}"`));
  assert(/Logger\.log\('NOTIFY_NAME_NON_SUBMITTERS: /.test(gsSrc),
    '[23a] setup() logs the NOTIFY_NAME_NON_SUBMITTERS property\'s current state — Drew\'s manual step is documented where he will actually see it');
  assert(/NOTIFY_NAME_NON_SUBMITTERS\s+— 'true' \(default when MISSING\) or 'false'/.test(gsSrc),
    '[23a] the Script Properties comment block in Code.gs\'s header documents the property and its default');

  // ── [23b] Flag parsing: EXECUTED Code.gs function vs the notifyServer.mjs
  //     twin, case for case. "Missing reads TRUE" is the load-bearing case —
  //     an existing deployment that never sets the property must not change
  //     behavior (CONVENTIONS #10 applied to a config property).
  const gsFlagFn = instantiate(gsSrc, 'notifyNameNonSubmittersEnabled_');
  assert(typeof gsFlagFn === 'function', '[23b] Code.gs\'s notifyNameNonSubmittersEnabled_ instantiated as a real callable Node function');
  const flagCases = [
    { raw: undefined, expect: true,  label: 'property MISSING (undefined) -> true' },
    { raw: null,      expect: true,  label: 'property MISSING (null, what getProperty returns when unset) -> true' },
    { raw: 'true',    expect: true,  label: "'true' -> true" },
    { raw: 'false',   expect: false, label: "'false' -> false" },
    { raw: 'FALSE',   expect: false, label: "'FALSE' (case-insensitive) -> false" },
    { raw: '  false ',expect: false, label: "'  false ' (whitespace-tolerant) -> false" },
    { raw: '',        expect: true,  label: "'' (blank) -> true, never the surprising direction" },
    { raw: 'no',      expect: true,  label: "a typo like 'no' -> true, never the surprising direction" },
    { raw: '0',       expect: true,  label: "'0' -> true (ONLY the literal 'false' disables)" },
  ];
  let flagChecked = 0;
  for (const fc of flagCases) {
    const gsResult = gsFlagFn(fc.raw);
    const twinResult = server.readNameNonSubmittersFlag(fc.raw);
    assert(gsResult === fc.expect, `[23b] EXECUTED Code.gs: ${fc.label}`);
    assert(twinResult === gsResult, `[23b] notifyServer.mjs twin agrees with the EXECUTED Code.gs body for ${JSON.stringify(fc.raw)} (both -> ${twinResult})`);
    flagChecked++;
  }
  assert(flagChecked === flagCases.length, '[23b] the flag truth table is non-vacuous — every case actually executed');

  // ── [23c] Count-only pool: byte-identical twin (extends [15]'s content
  //     diff to the new pool, so BOTH modes are drift-guarded), and
  //     structurally incapable of naming anyone.
  function extractGsArrayLiteral(source, varName) {
    const m = source.match(new RegExp(`var ${varName} = (\\[[\\s\\S]*?\\]);`));
    if (!m) return null;
    try { return new Function(`return ${m[1]};`)(); } catch { return null; }
  }
  const poolsNow = copy._poolsForTest();
  const gsCountOnly = extractGsArrayLiteral(gsSrc, 'SCRIBE_PICKS_LOCKING_SOON_COUNT_ONLY_POOL');
  assert(Array.isArray(gsCountOnly) && gsCountOnly.length >= 2, '[23c] Code.gs SCRIBE_PICKS_LOCKING_SOON_COUNT_ONLY_POOL parses to an array of at least 2 lines');
  assert(JSON.stringify(gsCountOnly) === JSON.stringify(poolsNow.PICKS_LOCKING_SOON_COUNT_ONLY),
    '[23c] Code.gs SCRIBE_PICKS_LOCKING_SOON_COUNT_ONLY_POOL is byte-identical (content + order) to notify-copy.js POOLS.PICKS_LOCKING_SOON_COUNT_ONLY — the drift guard now covers BOTH modes');
  assert(poolsNow.PICKS_LOCKING_SOON_COUNT_ONLY.every(t => !t.includes('{namedNonSubmitters}')),
    '[23c] no template in the count-only pool references {namedNonSubmitters} — the no-names guarantee is structural, not a caller convention');
  assert(poolsNow.PICKS_LOCKING_SOON.some(t => t.includes('{namedNonSubmitters}')),
    '[23c] fixture check (non-vacuous): the DEFAULT pool does still use {namedNonSubmitters}, so [23c]\'s negative above is a real distinction');
  assert(!copy.ALLOWED_META_KEYS.PICKS_LOCKING_SOON_COUNT_ONLY.includes('namedNonSubmitters'),
    '[23c] namedNonSubmitters is absent from PICKS_LOCKING_SOON_COUNT_ONLY\'s allow-list — buildCopy() drops it before substitution even if a caller wrongly supplies it');
  const leakAttempt = copy.buildCopy('PICKS_LOCKING_SOON_COUNT_ONLY',
    { weekN: 3, timeUntilLock: '1h', submittedCount: 4, totalPlayers: 6, namedNonSubmitters: 'Kevin, Jacob' }, 'seed');
  assert(!leakAttempt.body.includes('Kevin') && !leakAttempt.body.includes('Jacob'),
    '[23c] ADVERSARIAL: a caller that passes namedNonSubmitters in count-only mode STILL produces a body with no names in it');

  // ── [23d] The flat fallback works in count-only mode too (facts missing).
  const fbCountOnly = copy.buildCopy('PICKS_LOCKING_SOON_COUNT_ONLY', { weekN: 3 }, 'seed');
  assert(fbCountOnly.body.length > 0 && fbCountOnly.scribeVoiced === false,
    '[23d] with counts missing, count-only mode falls back to the flat deterministic line rather than failing to deliver');
  assert(fbCountOnly.body === 'Week 3 locks in soon.',
    `[23d] the count-only flat fallback is the shared, already name-free line (got "${fbCountOnly.body}")`);

  // ── [23e] Behavioral, through the real twin: both modes, one fixture.
  const rosterNames = players.map(p => p.displayName);
  assert(rosterNames.length === 6 && rosterNames.includes('Kevin'), '[23e] fixture check: the roster has six real display names to assert against');
  const lsWeek = { ...freshWeek({ weekId: 'w_flag' }), picksLockAt: new Date(Date.now() + 30 * 60 * 1000).toISOString() };
  const lsGames = [dataModel.createGame(lsWeek.weekId, { gameId: 'fg1', kickoff: lsWeek.picksLockAt })];
  // Four of six submitted; Jacob (p5) and Kihoon (p6) have not.
  const lsPicks = ['p1', 'p2', 'p3', 'p4'].map(pid => dataModel.createPick(lsWeek.weekId, 'fg1', pid, 'home'));
  const argsBase = { week: lsWeek, games: lsGames, picks: lsPicks, players, now: Date.now() };

  const planNamed = server.computeReminderPlan({ ...argsBase, nameNonSubmitters: true });
  assert(!!planNamed.lockingSoonPlan, '[23e] fixture check: the locking-soon plan actually fires for this fixture (non-vacuous)');
  assert(planNamed.lockingSoonPlan.nonSubmitters.join(',') === 'Jacob,Kihoon', '[23e] fixture check: exactly Jacob and Kihoon are the non-submitters');
  assert(planNamed.lockingSoonPlan.body.includes('Jacob') && planNamed.lockingSoonPlan.body.includes('Kihoon'),
    `[23e] FLAG TRUE: the body names the non-submitters (got "${planNamed.lockingSoonPlan.body}")`);
  assert(planNamed.lockingSoonPlan.meta.namedNonSubmitters === 'Jacob, Kihoon', '[23e] FLAG TRUE: meta carries namedNonSubmitters');

  const planCount = server.computeReminderPlan({ ...argsBase, nameNonSubmitters: false });
  assert(!!planCount.lockingSoonPlan, '[23e] fixture check: the locking-soon plan still fires in count-only mode — the flag changes the COPY, never whether players are reminded');
  const countBody = planCount.lockingSoonPlan.body;
  rosterNames.forEach(n => assert(!countBody.includes(n),
    `[23e] FLAG FALSE: the body contains no player display name — "${n}" absent (got "${countBody}")`));
  assert(!Object.prototype.hasOwnProperty.call(planCount.lockingSoonPlan.meta, 'namedNonSubmitters'),
    '[23e] FLAG FALSE: the stored meta has no namedNonSubmitters key at all — not blanked, absent');
  assert(JSON.stringify(planCount.lockingSoonPlan.meta).indexOf('Jacob') === -1,
    '[23e] FLAG FALSE: no player name appears anywhere in meta');
  assert(/4\/6/.test(countBody), `[23e] FLAG FALSE: the body still carries the SUBMITTED/TOTAL counts (got "${countBody}")`);
  assert(countBody.includes('1h'), '[23e] FLAG FALSE: the body still carries {timeUntilLock}');
  assert(planCount.lockingSoonPlan.copyEvent === 'PICKS_LOCKING_SOON_COUNT_ONLY', '[23e] FLAG FALSE: the count-only pool is the one actually selected');
  assert(planCount.lockingSoonPlan.entries.length === planNamed.lockingSoonPlan.entries.length,
    '[23e] FLAG FALSE: the same players are still reminded — recipients are untouched by a copy flip');

  const planDefault = server.computeReminderPlan(argsBase);   // parameter omitted entirely
  assert(planDefault.lockingSoonPlan.nameNonSubmitters === true && planDefault.lockingSoonPlan.body === planNamed.lockingSoonPlan.body,
    '[23e] FLAG MISSING (parameter omitted): behaves exactly like TRUE — default-when-missing, no behavior change for a deployment that never sets it');

  const planAllIn = server.computeReminderPlan({
    ...argsBase, picks: players.map(p => dataModel.createPick(lsWeek.weekId, 'fg1', p.playerId, 'home')), nameNonSubmitters: false });
  assert(planAllIn.lockingSoonPlan.copyEvent === 'PICKS_LOCKING_SOON_ALL_IN',
    '[23e] the all-submitted pool is unaffected by the flag (there are no names to suppress in that branch)');

  // ── [23f] Code.gs's scanReminders actually CONSULTS the flag and routes to
  //     the count-only pool. Structural on the real source; [23g] proves this
  //     scan is capable of going red.
  const scanText = extractBalancedFunction(gsSrc, 'scanReminders')?.fullText || '';
  assert(scanText.length > 0, '[23f] fixture check: scanReminders was located in Code.gs');
  assert(/notifyNameNonSubmittersEnabled_\(\s*[\s\S]{0,200}?getProperty\(NOTIFY_NAME_NON_SUBMITTERS_PROP\)/.test(scanText),
    '[23f] scanReminders reads the Script Property through notifyNameNonSubmittersEnabled_');
  assert((scanText.match(/getProperty\(NOTIFY_NAME_NON_SUBMITTERS_PROP\)/g) || []).length === 1,
    '[23f] the property is read exactly ONCE per scan — it cannot change mid-scan, and costs nothing on scans that never reach the locking-soon window');
  assert(/if \(nonSubmitters\.length && nameNonSubmitters\)/.test(scanText),
    '[23f] the NAMED pool is selected only when the flag is on');
  assert(/} else if \(nonSubmitters\.length\) \{[\s\S]{0,600}?SCRIBE_PICKS_LOCKING_SOON_COUNT_ONLY_POOL/.test(scanText),
    '[23f] with laggards present and the flag OFF, scanReminders routes to the count-only pool');
  // Comments are stripped first — the branch's own explanatory comment names
  // the key it is deliberately NOT setting, and scanning raw text would match
  // that instead of real code (it did, on the first run of this assertion).
  const countOnlyBranch = (scanText.match(/} else if \(nonSubmitters\.length\) \{[\s\S]*?\} else \{/) || [''])[0]
    .replace(/\/\/[^\n]*/g, '');
  assert(countOnlyBranch.length > 0, '[23f] fixture check: the count-only branch was located in scanReminders');
  assert(!countOnlyBranch.includes('namedNonSubmitters'),
    '[23f] the count-only branch\'s CODE never mentions namedNonSubmitters — it is not placed in facts2 at all (comments stripped before the scan)');
  assert(scanText.replace(/\/\/[^\n]*/g, '').includes('namedNonSubmitters: nonSubmitters.join'),
    '[23f] fixture check (non-vacuous): the NAMED branch in the same function DOES set namedNonSubmitters, so the negative above is a real distinction, not a spelling miss');
}

// ── [23g] Mutation canary — the flag guard is capable of failing. Both
//    mutations live ONLY in scratch text/scratch files; backend/Code.gs is
//    never opened for writing (same discipline as [22b]: nothing is written
//    to real source, so there is nothing to restore and no window in which an
//    interrupted run could leave the repo mutated — strictly safer than
//    mutate-then-restore, and never git checkout/restore/stash). ───────────
console.log('\n[23g] Mutation canary — ignoring the flag read goes RED (scratch copy only, real Code.gs never written)…');
{
  function extractBalancedFunction(source, funcName) {
    const sigRe = new RegExp(`function\\s+${funcName}\\s*\\(([^)]*)\\)\\s*\\{`);
    const m = source.match(sigRe);
    if (!m) return null;
    const bodyStart = m.index + m[0].length;
    let depth = 1, i = bodyStart;
    while (depth > 0 && i < source.length) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') depth--;
      i++;
    }
    if (depth !== 0) return null;
    return { fullText: source.slice(m.index, i) };
  }
  function instantiate(source, funcName) {
    const ex = extractBalancedFunction(source, funcName);
    return ex ? new Function(`${ex.fullText}\nreturn ${funcName};`)() : null;
  }

  const realPath = fileURLToPath(new URL('./backend/Code.gs', import.meta.url));
  const before = await readFile(realPath, 'utf8');
  const scratchDir = process.env.TMPDIR || '/tmp';
  await copyFile(realPath, `${scratchDir}/Code.gs.flag-canary-backup.${Date.now()}.txt`);

  // MUTATION 1 — the flag READ is ignored (the parser always returns true).
  const gutted = before.replace(
    'function notifyNameNonSubmittersEnabled_(raw) {',
    'function notifyNameNonSubmittersEnabled_(raw) { return true; // CANARY: flag read ignored — SCRATCH COPY ONLY\n'
  );
  assert(gutted !== before, '[23g-a] mutation 1 actually changed the scratch text (non-vacuous — the replace found its target)');
  const scratch1 = `${scratchDir}/Code.gs.flag-canary-gutted.${Date.now()}.txt`;
  await writeFile(scratch1, gutted, 'utf8');
  const mutantFlagFn = instantiate(await readFile(scratch1, 'utf8'), 'notifyNameNonSubmittersEnabled_');
  assert(typeof mutantFlagFn === 'function', '[23g-b] the gutted scratch parser still instantiates (a valid always-true body, not a syntax break)');
  assert(mutantFlagFn('false') === true && server.readNameNonSubmittersFlag('false') === false,
    `[23g-c] CANARY CONFIRMED: with the flag read ignored (scratch only), 'false' reads as TRUE where the real twin reads FALSE — [23b]'s false-mode assertion WOULD go red (got mutant=${mutantFlagFn('false')}, twin=${server.readNameNonSubmittersFlag('false')})`);

  // MUTATION 2 — the flag is parsed correctly but scanReminders ignores it,
  // so the NAMED pool is used regardless. This is the drift [23f] guards.
  const guttedScan = before.replace('if (nonSubmitters.length && nameNonSubmitters) {', 'if (nonSubmitters.length) {');
  assert(guttedScan !== before, '[23g-d] mutation 2 actually changed the scratch text');
  const mutantScanText = extractBalancedFunction(guttedScan, 'scanReminders')?.fullText || '';
  assert(mutantScanText.length > 0 && !/if \(nonSubmitters\.length && nameNonSubmitters\)/.test(mutantScanText),
    '[23g-e] CANARY CONFIRMED: with the flag dropped from scanReminders\' branch condition (scratch only), [23f]\'s "named pool only when the flag is on" assertion no longer finds its target — that guard is capable of failing, not vacuous (RG-27)');

  // MUTATION 3 — the twin's own count-only branch is gutted back to naming.
  const planArgsWeek = { ...freshWeek({ weekId: 'w_flag2' }), picksLockAt: new Date(Date.now() + 30 * 60 * 1000).toISOString() };
  const planArgsGames = [dataModel.createGame(planArgsWeek.weekId, { gameId: 'fg2', kickoff: planArgsWeek.picksLockAt })];
  const namedBodyIfIgnored = copy.buildCopy('PICKS_LOCKING_SOON',
    { weekN: planArgsWeek.weekNumber, timeUntilLock: '1h', namedNonSubmitters: 'Jacob, Kihoon', submittedCount: 4, totalPlayers: 6 },
    `PICKS_LOCKING_SOON|${planArgsWeek.weekId}|locking-soon|`).body;
  assert(namedBodyIfIgnored.includes('Jacob') || namedBodyIfIgnored.includes('Kihoon'),
    '[23g-f] CANARY CONFIRMED (twin side): if computeReminderPlan ignored its nameNonSubmitters parameter and kept calling buildCopy(\'PICKS_LOCKING_SOON\', …), the body WOULD contain a name — which is exactly what [23e]\'s FLAG FALSE roster assertions test for');
  void planArgsGames;

  const after = await readFile(realPath, 'utf8');
  assert(after === before, '[23g-g] the REAL backend/Code.gs on disk is byte-identical before/after this canary — only scratch copies were ever mutated');
}

// ── [24] PUSH "Turn On" DIAGNOSTICS (RG, 2026-09-10) ─────────────────────────
//    Bug as reported: on live v0.19.0, tapping "Turn On" in the Notification
//    Center shows "Could not enable push". That string was the ONLY thing
//    js/app.js could say, because requestPushPermission() resolved a bare
//    boolean — six unrelated causes collapsed onto one `false`:
//
//      (a) the OneSignal app itself has no Web Push platform configured
//          (LIVE root cause — GET onesignal.com/api/v1/sync/<appId>/web for
//          this league's real App ID returns {"success":false,"code":2,
//          "description":"This app is not configured for web push."}, and the
//          shipped v16 SDK turns code 2 into throw new Error("App not
//          configured for web push") inside init()),
//      (b) the SDK's worker lookup failing ("OneSignal service worker not found!"),
//      (c) the player dismissing the prompt, (d) the player blocking it,
//      (e) the SDK script never arriving, (f) an iOS Safari TAB where the
//          SDK refuses to load at all.
//
//    Worse, (e) never resolved AT ALL — the promise waited on a deferred queue
//    that would never drain, so the button was a DEAD TAP with no toast.
//
//    These assertions pin: one distinct reason per cause, a bounded answer for
//    every tap, a toast map that covers every reason, and the iOS-tab card
//    rendering "install" instead of a button that cannot work.
console.log('\n[24] Push "Turn On" — one distinct reason per failure class, bounded answer, complete toast map…');
{
  const pushSrcPath = fileURLToPath(new URL('./js/push-onesignal.js', import.meta.url));
  const appSrcPath  = fileURLToPath(new URL('./js/app.js', import.meta.url));
  const swSrcPath   = fileURLToPath(new URL('./service-worker.js', import.meta.url));
  const htmlSrcPath = fileURLToPath(new URL('./index.html', import.meta.url));

  // ── stub rig ──────────────────────────────────────────────────────────────
  const saved = {
    document: globalThis.document, navigator: globalThis.navigator, fetch: globalThis.fetch,
    matchMedia: globalThis.matchMedia, Notification: globalThis.Notification,
    PushSubscriptionOptions: globalThis.PushSubscriptionOptions,
  };
  const setNav = (v) => { try { globalThis.navigator = v; }
    catch { Object.defineProperty(globalThis, 'navigator', { value: v, configurable: true, writable: true }); } };

  function installPushStubs({
    appId = 'abad65e9-0000-0000-0000-000000000000', configOk = true, configSlowMs = 0,
    scriptLoads = true, drains = true, initBehaviour = 'ok', permBehaviour = 'granted',
    ua = 'Mozilla/5.0 (Linux; Android 14) Chrome/127', vendor = 'Google Inc.',
    maxTouchPoints = 1, standalone = false, sdkCompatible = true, permission = 'default',
  } = {}) {
    const state = { initCalls: 0, initOpts: null, configFetches: 0 };
    const fakeOneSignal = {
      async init(opts) {
        state.initCalls++; state.initOpts = opts;
        // Real v16 sets its "already initialized" flag BEFORE the work that can
        // fail, so a second init() ALWAYS throws regardless of the first outcome.
        if (state.initCalls > 1) throw new Error('SDK already initialized');
        if (initBehaviour === 'web-push-off')   throw new Error('App not configured for web push');
        if (initBehaviour === 'app-id-mismatch') throw new Error("AppID doesn't match existing apps");
        if (initBehaviour === 'wrong-origin')    throw new Error('Can only be used on: https://example.com');
        if (initBehaviour === 'throw')           throw new Error('IndexedDB unavailable');
        if (initBehaviour === 'throw-object')    throw { success: false, code: 2, description: 'This app is not configured for web push.' };
      },
      Notifications: {
        async requestPermission() {
          if (permBehaviour === 'sw-missing') throw new Error('OneSignal service worker not found!');
          if (permBehaviour === 'dismissed')  throw new Error('Permission dismissed');
          if (permBehaviour === 'blocked')    { globalThis.Notification.permission = 'denied'; throw new Error('Permission blocked'); }
          if (permBehaviour === 'hang')       return new Promise(() => {});
          if (permBehaviour === 'odd-throw')  throw new Error('something exotic');
          globalThis.Notification.permission = permBehaviour === 'granted' ? 'granted' : 'default';
        },
      },
    };
    const drain = () => {
      const pending = Array.isArray(globalThis.OneSignalDeferred) ? globalThis.OneSignalDeferred : [];
      globalThis.OneSignalDeferred = { push: (fn) => { fn(fakeOneSignal); } };
      pending.forEach(fn => fn(fakeOneSignal));
    };
    globalThis.OneSignalDeferred = undefined;
    globalThis.document = {
      head: { appendChild(s) { setTimeout(() => { if (!scriptLoads) return s.onerror?.(); if (drains) drain(); s.onload?.(); }, 0); } },
      createElement: () => ({ src: '', defer: false, onload: null, onerror: null }),
      body: { dataset: {} },
    };
    setNav({ userAgent: ua, vendor, maxTouchPoints, standalone, serviceWorker: {} });
    globalThis.matchMedia = () => ({ matches: !!standalone });
    globalThis.Notification = { permission, requestPermission: async () => globalThis.Notification.permission };
    if (sdkCompatible) {
      globalThis.PushSubscriptionOptions = function () {};
      globalThis.PushSubscriptionOptions.prototype.applicationServerKey = null;
    } else { delete globalThis.PushSubscriptionOptions; }
    globalThis.fetch = async () => {
      state.configFetches++;
      if (configSlowMs) await new Promise(r => setTimeout(r, configSlowMs));
      if (!configOk) throw new Error('offline');
      return { ok: true, json: async () => ({ oneSignalAppId: appId }) };
    };
    return state;
  }
  // The two "no dead tap" bounds are implemented with setTimeout().unref() so
  // they never hold a Node harness open. That means Node can exit while one is
  // pending — a browser never can, it always has an event loop. Keep the loop
  // alive for exactly as long as we're waiting on one.
  const withKeepAlive = async (promise) => {
    const ka = setInterval(() => {}, 5);
    try { return await promise; } finally { clearInterval(ka); }
  };

  const restoreGlobals = () => {
    globalThis.document = saved.document; setNav(saved.navigator); globalThis.fetch = saved.fetch;
    globalThis.matchMedia = saved.matchMedia; globalThis.Notification = saved.Notification;
    globalThis.PushSubscriptionOptions = saved.PushSubscriptionOptions;
    delete globalThis.OneSignalDeferred;
  };

  installPushStubs();
  const push = await import('./js/push-onesignal.js');

  // ── [24a] one distinct reason per failure class ───────────────────────────
  const classes = [
    ['web-push-not-enabled', { initBehaviour: 'web-push-off' },
      'the league\'s OneSignal app has no Web Push platform configured — the LIVE root cause, and the one where "try again" is useless advice'],
    ['web-push-not-enabled', { initBehaviour: 'throw-object' },
      'same cause arriving as a raw JSONP object ({code:2}) instead of an Error — classified identically, never "[object Object]"'],
    ['app-id-mismatch',      { initBehaviour: 'app-id-mismatch' }, 'config.json\'s App ID does not match any OneSignal app'],
    ['wrong-site-origin',    { initBehaviour: 'wrong-origin' },    'the OneSignal app is configured for a different site origin'],
    ['init-failed',          { initBehaviour: 'throw' },           'any other init throw still lands somewhere honest'],
    ['sw-not-found',         { permBehaviour: 'sw-missing' },      'the SDK could not find its service worker'],
    ['denied',               { permBehaviour: 'blocked' },         'the player tapped Block'],
    ['dismissed',            { permBehaviour: 'dismissed' },       'the player dismissed the prompt without answering'],
    ['request-failed',       { permBehaviour: 'odd-throw' },       'an exotic throw with the permission still "default" is NOT silently called a dismissal'],
    ['sdk-not-loaded',       { scriptLoads: false },               'the SDK script itself never loaded'],
    ['not-installed-ios',    { sdkCompatible: false, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)', vendor: 'Apple Computer, Inc.', maxTouchPoints: 5, standalone: false },
      'iPhone Safari TAB — push is unreachable until the app is installed'],
    ['unsupported-browser',  { sdkCompatible: false, ua: 'Mozilla/5.0 (Windows NT 10.0) Firefox/60', vendor: 'Mozilla', maxTouchPoints: 0 },
      'a browser the SDK refuses outright'],
    ['not-configured',       { appId: '' },                        'no App ID in config.json (feature not live)'],
    ['config-unreachable',   { configOk: false },                  'config.json could not be read at all — distinct from "no App ID", because the advice differs'],
  ];
  const seen = new Set();
  for (const [expected, opts, why] of classes) {
    installPushStubs(opts);
    push._resetForTest({ sdkReadyMs: 60, promptMs: 60 });
    const res = await push.requestPushPermission();
    assert(res && res.ok === false && res.reason === expected,
      `[24a] ${expected}: ${why} (got ${JSON.stringify(res)})`);
    seen.add(res?.reason);
  }
  assert(seen.size === classes.length - 1,   // web-push-not-enabled appears twice by design
    `[24a] the failure classes produce DISTINCT reasons, not one collapsed value — ${seen.size} distinct reasons from ${classes.length} cases (the bug was 1 from all of them)`);

  // ── [24b] the granted path ────────────────────────────────────────────────
  installPushStubs({ permBehaviour: 'granted' });
  push._resetForTest({ sdkReadyMs: 60, promptMs: 60 });
  const okRes = await push.requestPushPermission();
  assert(okRes?.ok === true && okRes.reason === 'granted', `[24b] the happy path resolves {ok:true, reason:'granted'} (got ${JSON.stringify(okRes)})`);

  // ── [24c] NO DEAD TAPS — every tap gets a bounded answer ──────────────────
  installPushStubs({ scriptLoads: true, drains: false });   // script 200s, SDK never appears
  push._resetForTest({ sdkReadyMs: 60, promptMs: 60 });
  const hung = await withKeepAlive(push.requestPushPermission());
  assert(hung?.ok === false && hung.reason === 'sdk-not-loaded',
    `[24c] script loads but the SDK never drains its queue → bounded 'sdk-not-loaded', NOT a promise that never settles (the pre-fix dead tap) (got ${JSON.stringify(hung)})`);

  installPushStubs({ permBehaviour: 'hang' });
  push._resetForTest({ sdkReadyMs: 500, promptMs: 60 });
  const noAnswer = await withKeepAlive(push.requestPushPermission());
  assert(noAnswer?.ok === false && noAnswer.reason === 'prompt-timeout',
    `[24c] a permission prompt that never returns still produces an answer ('prompt-timeout') (got ${JSON.stringify(noAnswer)})`);

  // ── [24d] iOS Safari TAB renders the INSTALL card, never a Turn On button ─
  const iosTab = { sdkCompatible: false, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)', vendor: 'Apple Computer, Inc.', maxTouchPoints: 5, standalone: false };
  installPushStubs(iosTab);
  push._resetForTest();
  assert(await push.subscriptionState() === 'needs-install',
    '[24d] iPhone Safari TAB → subscriptionState() "needs-install" (its own state; the old single "unsupported" could not tell "install me" from "never going to work")');

  // A future iOS that exposes the push API in a TAB must STILL say needs-install:
  // Apple only delivers web push to home-screen apps, so a Turn On button there
  // can only fail. The Apple-handheld test therefore outranks the SDK's own.
  installPushStubs({ ...iosTab, sdkCompatible: true });
  push._resetForTest();
  assert(await push.subscriptionState() === 'needs-install',
    '[24d] iPhone Safari TAB that DOES expose PushSubscriptionOptions is still "needs-install" — not-standalone outranks SDK compatibility');
  installPushStubs({ ...iosTab, sdkCompatible: true });
  push._resetForTest({ sdkReadyMs: 60, promptMs: 60 });
  const tabTap = await push.requestPushPermission();
  assert(tabTap?.reason === 'not-installed-ios',
    `[24d] …and the same precedence holds in requestPushPermission() — card and button can never disagree (got ${JSON.stringify(tabTap)})`);

  // iPad (Safari reports a MAC user-agent since iPadOS 13 — the old /iP(hone|ad|od)/
  // test could never match one, so an iPad in a tab used to get a button that failed).
  installPushStubs({ sdkCompatible: false, ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605', vendor: 'Apple Computer, Inc.', maxTouchPoints: 5, standalone: false });
  push._resetForTest();
  assert(await push.subscriptionState() === 'needs-install',
    '[24d] iPad in a Safari TAB (Mac user-agent, touch points > 0) → "needs-install", the case a UA regex structurally cannot catch');

  // Installed on the home screen → the real priming state, with a button.
  installPushStubs({ standalone: true, sdkCompatible: true, permission: 'default' });
  push._resetForTest();
  assert(await push.subscriptionState() === 'never-asked',
    '[24d] the SAME iPhone once installed to the home screen → "never-asked" (Turn On is offered exactly where it can work)');
  installPushStubs({ standalone: true, sdkCompatible: true, permission: 'denied' });
  push._resetForTest();
  assert(await push.subscriptionState() === 'denied', '[24d] a blocked install reports "denied", not "unsupported"');

  // ── [24e] toast map covers every reason — cross-scan of BOTH sources ──────
  const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  const pushSrc = await readFile(pushSrcPath, 'utf8');
  const appSrc  = await readFile(appSrcPath, 'utf8');
  const OK_REASONS = new Set(['granted', 'initialized']);
  //   Captures the whole right-hand side of `reason:` and harvests every
  //   string literal in it, so a reason produced by a TERNARY
  //   (`reason: x ? 'config-unreachable' : 'not-configured'`) is scanned too —
  //   a literal-only regex quietly missed those and would have let an unmapped
  //   reason ship.
  const emittedReasons = (src) => {
    const out = new Set();
    for (const m of stripComments(src).matchAll(/reason:\s*([^,\n}]+)/g))
      for (const lit of m[1].matchAll(/'([a-z0-9-]+)'/g))
        if (!OK_REASONS.has(lit[1])) out.add(lit[1]);
    return out;
  };
  const toastMapKeys = (src) => {
    const i = src.indexOf('function pushFailureMessage');
    const j = src.indexOf('}[reason]', i);
    const out = new Set();
    if (i < 0 || j < 0) return out;
    for (const m of src.slice(i, j).matchAll(/'([a-z0-9-]+)':/g)) out.add(m[1]);
    return out;
  };
  const reasons = emittedReasons(pushSrc);
  const toasts  = toastMapKeys(appSrc);
  assert(reasons.size >= 12, `[24e] the cross-scan actually found the reason literals (${reasons.size} found: ${[...reasons].sort().join(', ')})`);
  assert(toasts.size >= 12, `[24e] the cross-scan actually found app.js's toast map (${toasts.size} keys)`);
  const unmapped = [...reasons].filter(r => !toasts.has(r));
  assert(unmapped.length === 0,
    `[24e] EVERY reason js/push-onesignal.js can emit has its own message in js/app.js's pushFailureMessage() — no reason falls through to a generic toast (unmapped: ${unmapped.join(', ') || 'none'})`);
  const orphaned = [...toasts].filter(r => !reasons.has(r));
  assert(orphaned.length === 0,
    `[24e] and no message is stranded on a reason that no longer exists — a rename breaks this in BOTH directions (orphans: ${orphaned.join(', ') || 'none'})`);
  assert(!/OneSignal/.test(appSrc.slice(appSrc.indexOf('function pushFailureMessage'), appSrc.indexOf('}[reason]'))),
    '[24e] no player-facing message names the vendor — players read product language, not "OneSignal"');

  // ── [24f] every subscriptionState() value has a priming-card state ────────
  const sliceFn = (src, startNeedle, endNeedle) => {
    const i = src.indexOf(startNeedle); const j = src.indexOf(endNeedle, i);
    return i < 0 || j < 0 ? '' : src.slice(i, j);
  };
  const stateBody = sliceFn(stripComments(pushSrc), 'export async function subscriptionState', '\n}');
  const statesEmitted = new Set([...stateBody.matchAll(/return '([a-z-]+)'/g)].map(m => m[1]));
  const cardBody = sliceFn(appSrc, 'function renderPrimingCardHTML', '}[pushState]');
  const cardStates = new Set([...cardBody.matchAll(/^\s*'?([a-z-]+)'?:\s*\{/gm)].map(m => m[1]));
  const silentStates = new Set([...cardBody.matchAll(/pushState === '([a-z-]+)'/g)].map(m => m[1]));
  assert(statesEmitted.size >= 5, `[24f] cross-scan found subscriptionState()'s return values (${[...statesEmitted].sort().join(', ')})`);
  const uncovered = [...statesEmitted].filter(s => !cardStates.has(s) && !silentStates.has(s));
  assert(uncovered.length === 0,
    `[24f] every state subscriptionState() can return is either drawn as a priming card or deliberately silent in app.js — a state added on one side only renders NOTHING (uncovered: ${uncovered.join(', ') || 'none'})`);
  assert(/'needs-install'\s*:\s*\{[^}]*btn:\s*null/.test(cardBody),
    '[24f] the needs-install card carries NO button — instructions only, because a Turn On tap in an iOS tab cannot succeed');
  assert(/'never-asked'\s*:\s*\{[^}]*btn:\s*'Turn On'/.test(cardBody),
    '[24f] …while never-asked still offers the Turn On button');

  // ── [24g] service-worker wiring is structurally coherent ──────────────────
  //   Evidence (read from the shipped v16 SDK, OneSignalSDK.page.es6.js?v=160610):
  //     • config merge:  path/serviceWorkerParam/serviceWorkerPath are taken
  //       from OUR init() ONLY when serviceWorkerOverrideForTypical is true
  //       (otherwise the dashboard's values win, defaulting to
  //       It = "OneSignalSDKWorker.js" — which this site does not host: it
  //       404s on https://irbfootball.com/OneSignalSDKWorker.js).
  //     • worker path:   serviceWorkerPath is read ONLY inside
  //       `e.userConfig.path && (...)` — no `path`, no override.
  //     • ownership test: fa() compares the BASENAME of the registered
  //       worker's scriptURL against the configured one, so index.html's
  //       registered filename and serviceWorkerPath must agree exactly.
  //
  //   [24g] IS BLIND TO F1 BY DESIGN — do not "fix" it here. It strips the
  //   query (`.split('?')[0]`) on BOTH sides precisely because fa()'s OWNERSHIP
  //   test does, so it can prove the SDK will accept our worker as its own.
  //   The F1 reload loop lives in the OTHER SDK comparison — ma(), which
  //   compares the FULL scriptURL, query included — so a check that strips the
  //   query structurally cannot see it. That is what [25] is for. Two SDK
  //   comparisons, two different guards.
  //   (The registration call itself moved to js/sw-register.js on 2026-09-10;
  //   index.html still owns the URL string, which is what this scans.)
  const swSrc   = await readFile(swSrcPath, 'utf8');
  const htmlSrc = await readFile(htmlSrcPath, 'utf8');
  function workerConfigFindings(pushText, swText, htmlText) {
    const bad = [];
    const init = sliceFn(stripComments(pushText), 'OneSignal.init({', '})');
    if (!/serviceWorkerOverrideForTypical:\s*true/.test(init)) bad.push('serviceWorkerOverrideForTypical:true missing — a "Typical Site" dashboard silently overrides our worker path back to OneSignalSDKWorker.js');
    if (!/path:\s*'\//.test(init)) bad.push("path:'/' missing — serviceWorkerPath is ignored without it");
    if (!/serviceWorkerParam:\s*\{\s*scope:\s*'\/'/.test(init)) bad.push("serviceWorkerParam scope '/' missing");
    const m = init.match(/serviceWorkerPath:\s*'([^']+)'/);
    if (!m) bad.push('serviceWorkerPath missing');
    const reg = htmlText.match(/serviceWorker\.register\('([^']+)'/)
             || htmlText.match(/scriptUrl:\s*'([^']+)'/);
    if (!reg) bad.push('index.html names no service-worker script to register');
    if (m && reg) {
      const configured = m[1].split('?')[0].split('/').pop();
      const registered = reg[1].split('?')[0].split('/').pop();
      if (configured !== registered) bad.push(`worker filename mismatch: init says "${configured}", index.html registers "${registered}" — the SDK compares basenames and would call ours a 3rd-party worker`);
    }
    if (!/importScripts\(\s*'https:\/\/cdn\.onesignal\.com\/sdks\/web\/v16\/OneSignalSDK\.sw\.js'\s*\)/.test(swText))
      bad.push('service-worker.js does not importScripts the OneSignal worker — the merged-worker pattern requires it');
    if (swText.indexOf('importScripts(') > swText.indexOf('const CACHE_NAME'))
      bad.push('importScripts must run at top level, before the rest of the worker');
    return bad;
  }
  const findings = workerConfigFindings(pushSrc, swSrc, htmlSrc);
  assert(findings.length === 0,
    `[24g] the merged-worker configuration is coherent: our init() overrides the dashboard, points at OUR worker, and index.html registers that exact filename (${findings.join(' | ') || 'no findings'})`);

  // ── [24h] the config read is not poisoned by one transient failure ────────
  const st1 = installPushStubs({ configOk: false });
  push._resetForTest();
  assert(await push.isPushConfigured() === false, '[24h] a failed config.json read reports "not configured" for that call…');
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ oneSignalAppId: 'abad65e9-1111-2222-3333-444444444444' }) });
  assert(await push.isPushConfigured() === true,
    '[24h] …but is NOT memoized — the very next call succeeds. Memoizing the failure pinned push to "not configured" for the life of the page, and the priming card then renders nothing at all with no way back short of a reload');
  void st1;

  const st2 = installPushStubs({ configSlowMs: 30, sdkCompatible: true, standalone: true });
  push._resetForTest();
  const stateWhileConfigInFlight = await push.subscriptionState();
  assert(stateWhileConfigInFlight !== 'unconfigured',
    '[24h] the priming card waits for config.json before deciding — subscriptionState() awaits the App ID rather than reading a not-yet-populated value at boot');
  assert(st2.configFetches >= 1, '[24h] (and that state really did come from a config read)');

  // ── [24k] SECURITY F-2 (seventh gate) — LOGOUT-BEFORE-LOGIN IS ORDERED ────
  // THE DEFECT, reproduced rather than reasoned about. loadAppId() memoized the
  // VALUE (`_appId`), which is only assigned AFTER the fetch resolves — so two
  // callers arriving before the first read lands both missed the memo and both
  // started their own config.json request. loginOneSignal() and
  // logoutOneSignal() each await that before queueing onto OneSignalDeferred,
  // so the order they QUEUE in was the order the two independent reads happened
  // to come back in. DI-180q's handover deliberately calls logout FIRST and the
  // re-login LAST; with the logout's read the slower of the two, the queue came
  // out `["login:mB", "logout"]` and the incoming player was bound to NOBODY,
  // silently receiving nothing for the rest of the session — the exact failure
  // DI-180q's ordering fix was written to prevent, one layer down.
  //
  // THE STUB IS THE REPRODUCTION: the FIRST read is slower than the second.
  {
    const APP_ID_F2 = 'abad65e9-1111-2222-3333-444444444444';
    installPushStubs({ sdkCompatible: true, standalone: true });
    push._resetForTest();
    let reads = 0;
    globalThis.fetch = async () => {
      const mine = ++reads;
      // First read slow, every later read instant. Under the old code this put
      // the logout's answer LAST; under the fix there is only ever one read.
      await new Promise(r => setTimeout(r, mine === 1 ? 40 : 0));
      return { ok: true, json: async () => ({ oneSignalAppId: APP_ID_F2 }) };
    };
    globalThis.OneSignalDeferred = [];
    // Called in the order DI-180q's chokepoint calls them: clear first, bind last.
    const pOut = push.logoutOneSignal();
    const pIn = push.loginOneSignal('mB');
    await Promise.all([pOut, pIn]);
    const osSeq = [];
    const queued = Array.isArray(globalThis.OneSignalDeferred) ? globalThis.OneSignalDeferred.splice(0) : [];
    for (const cb of queued) {
      await cb({ login: id => osSeq.push(`login:${id}`), logout: () => osSeq.push('logout') });
    }
    assert(osSeq.length === 2, `[24k] fixture: both OneSignal calls were queued (${JSON.stringify(osSeq)})`);
    assert(osSeq[0] === 'logout',
      `[24k] SEC F-2 — the LOGOUT is queued FIRST even when its config read is the slower one (${JSON.stringify(osSeq)}). The other order leaves the handset bound to nobody.`);
    assert(osSeq[osSeq.length - 1] === 'login:mB',
      `[24k] …and the login for the incoming player is LAST (${JSON.stringify(osSeq)})`);
    assert(reads === 1,
      `[24k] …because ONE config read served both calls (got ${reads}): loadAppId() memoizes the PROMISE now, so the second caller awaits the first caller's read and both resume in CALL order. Two reads is the race itself.`);
    // …and the failure-is-not-memoized rule from [24h] is preserved by the
    // change: a read that fails must not pin push to "not configured".
    push._resetForTest();
    globalThis.fetch = async () => { throw new Error('offline'); };
    assert(await push.isPushConfigured() === false, '[24k] a failing read still reports "not configured" for that call…');
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ oneSignalAppId: APP_ID_F2 }) });
    assert(await push.isPushConfigured() === true,
      '[24k] …and is still NOT memoized after the promise-memo change — the in-flight promise is dropped on every outcome, so only a definitive App ID sticks');
  }

  // ── [24k] SECURITY F-3 (EIGHTH gate) — ORDER ACROSS THE MEMO TEARDOWN ─────
  // The seventh gate bought call ordering as a SIDE EFFECT of loadAppId()'s
  // promise memo. A cache with a teardown has a window, and this is it:
  //
  //   1. logoutOneSignal() calls loadAppId(). `_appId` is null, so it takes the
  //      SLOW path — `_readAppId()` chained through a `.finally()`, which is two
  //      extra microtask hops before its continuation can run.
  //   2. `_readAppId()` assigns `_appId` and resolves.
  //   3. loginOneSignal() calls loadAppId() in that instant. `_appId !== null`
  //      now, so it takes the FAST path — `Promise.resolve(_appId)`, ONE hop.
  //   4. The login's continuation therefore runs BEFORE the logout's, and
  //      OneSignalDeferred comes out ["login:mB", "logout"]. The logout wins,
  //      the incoming player is bound to NOBODY, and the phone silently receives
  //      no pushes for the rest of the session.
  //
  // Nothing about that depends on a slow network — it is pure microtask ordering,
  // which is why the [24k] block above (whose stub races two MACROTASK timers)
  // cannot see it. This one sweeps the gap between the two calls across the whole
  // teardown window, one microtask at a time, and demands the same answer at
  // EVERY gap. The fix is the `_osChain` serialization: the login's body does not
  // begin until the logout's link has settled, whatever the memo is doing.
  {
    const APP_ID_F3 = 'abad65e9-5555-6666-7777-888888888888';
    const observed = [];
    for (let gap = 0; gap <= 8; gap++) {
      installPushStubs({ sdkCompatible: true, standalone: true });
      push._resetForTest();
      // Resolves entirely in MICROTASKS — no timer anywhere — so the gap loop
      // below can actually step through `_appId`'s assignment instead of being
      // parked behind a macrotask the way [24k]'s 40ms stub is.
      globalThis.fetch = async () => ({ ok: true, json: async () => ({ oneSignalAppId: APP_ID_F3 }) });
      globalThis.OneSignalDeferred = [];
      // DI-180q's order: clear the old binding first, bind the new player last.
      const pOut = push.logoutOneSignal();
      for (let i = 0; i < gap; i++) await Promise.resolve();
      const pIn = push.loginOneSignal('mB');
      await Promise.all([pOut, pIn]);
      // Drain any trailing microtasks the chain may still be traversing.
      for (let i = 0; i < 8; i++) await Promise.resolve();
      const seq = [];
      const queued = Array.isArray(globalThis.OneSignalDeferred) ? globalThis.OneSignalDeferred.splice(0) : [];
      for (const cb of queued) {
        await cb({ login: id => seq.push(`login:${id}`), logout: () => seq.push('logout') });
      }
      observed.push({ gap, seq });
    }
    const wrong = observed.filter(o => JSON.stringify(o.seq) !== JSON.stringify(['logout', 'login:mB']));
    assert(observed.every(o => o.seq.length === 2),
      `[24k] fixture: both OneSignal calls were queued at every gap (${JSON.stringify(observed.map(o => o.seq.length))}) — a gap that queued fewer would make the ordering assertion below vacuous there`);
    assert(wrong.length === 0,
      `[24k] SEC F-3 — logout-then-login holds at EVERY microtask gap across loadAppId()'s memo teardown, not just the ones where the memo happens to be warm. Failing gaps: ${JSON.stringify(wrong)}. Ordering is now a property of the _osChain serialization, not a side effect of a cache.`);
    // NON-VACUITY — the sweep must actually be crossing the teardown, or it is
    // nine copies of the same warm-memo case. At gap 0 the memo is COLD (the
    // login shares the logout's in-flight read); by the last gap it is WARM (the
    // login takes the `_appId !== null` fast path). Proven by counting reads.
    {
      installPushStubs({ sdkCompatible: true, standalone: true });
      push._resetForTest();
      let coldReads = 0;
      globalThis.fetch = async () => { coldReads++; return { ok: true, json: async () => ({ oneSignalAppId: APP_ID_F3 }) }; };
      globalThis.OneSignalDeferred = [];
      const a = push.logoutOneSignal(); const b = push.loginOneSignal('mB');
      await Promise.all([a, b]);
      assert(coldReads === 1,
        `[24k] non-vacuity — at gap 0 ONE config read serves both calls (got ${coldReads}): the memo is genuinely cold there, so the sweep starts before the teardown and ends after it`);
    }
    // …and the chain does not swallow the calls: the drained sequence above is
    // the real OneSignalDeferred, and a chain that never ran would have produced
    // an empty one at every gap (asserted by the length check).
    assert(observed[0].seq[0] === 'logout' && observed[observed.length - 1].seq[0] === 'logout',
      '[24k] …and both ends of the sweep agree, which is the point: the answer must not depend on where in the teardown the second call lands');
  }

  // ── [24i] a failed boot init does not poison the later tap ────────────────
  //   app.js calls ensureOneSignalInit() at boot (js/app.js ~line 325); the
  //   player taps Turn On later. v16's init() sets its "already initialized"
  //   flag BEFORE the work that can fail, so re-calling init() after a failed
  //   first attempt throws "SDK already initialized" — a downstream error that
  //   HIDES the original cause. Exactly one init() per page is the fix.
  const st3 = installPushStubs({ initBehaviour: 'web-push-off' });
  push._resetForTest({ sdkReadyMs: 200, promptMs: 200 });
  const boot = await push.ensureOneSignalInit();
  const tap  = await push.requestPushPermission();
  assert(boot.ok === false && boot.reason === 'web-push-not-enabled', '[24i] the boot-time init reports the real cause');
  assert(tap.ok === false && tap.reason === 'web-push-not-enabled',
    `[24i] and the later Turn On tap reports THAT SAME cause — not the misleading "SDK already initialized" the SDK would throw on a second init (got ${JSON.stringify(tap)})`);
  assert(st3.initCalls === 1,
    `[24i] OneSignal.init() ran EXACTLY ONCE across a boot init + a button tap (got ${st3.initCalls}) — the SDK's init is single-shot and fails closed`);

  // ── [24j] MUTATION CANARY — scratch copies only, real files never written ─
  //    Per CLAUDE.md: never git checkout/restore/stash to undo a mutation.
  const scratchDir = process.env.TMPDIR || '/tmp';
  const beforeBytes = pushSrc;
  await writeFile(`${scratchDir}/push-onesignal.pre-mutation.${Date.now()}.js`, beforeBytes, 'utf8');

  // MUTATION 1 — collapse requestPushPermission back to a bare boolean.
  let mutant = pushSrc
    .replace(/finish\(\{ ok: true, reason: 'granted' \}\)/, 'finish(true)')
    .replace(/finish\(\{ ok: false, reason: 'denied' \}\)/, 'finish(false)')
    .replace(/finish\(\{ ok: false, reason: 'dismissed' \}\)/, 'finish(false)')
    .replace(/finish\(\{ ok: false, \.\.\.classifyPermissionError\(err\) \}\)/, 'finish(false)')
    .replace(/return \{ ok: false, reason: init\.reason, detail: init\.detail \};/, 'return false;');
  assert(mutant !== pushSrc, '[24j-a] the mutation actually changed the scratch text (non-vacuous)');
  const mutantPath = `${scratchDir}/push-onesignal.bare-boolean.${Date.now()}.mjs`;
  await writeFile(mutantPath, mutant, 'utf8');
  // DI-208c/DI-210e (iOS Munera thread, 2026-09-19) — push-onesignal.js now
  // has one real sibling import, `import { isNativeShell } from
  // './platform.js'`, for its native-shell guard. The mutant is imported
  // from a flat scratch dir with no sibling file, so that relative import
  // would otherwise 404 — a scratch-only COPY of the real js/platform.js
  // sits next to the mutant purely to satisfy module resolution; it is
  // never the mutation target and nothing here asserts against it.
  await copyFile(fileURLToPath(new URL('./js/platform.js', import.meta.url)), `${scratchDir}/platform.js`);
  const mutantMod = await import(`file://${mutantPath}`);
  installPushStubs({ permBehaviour: 'sw-missing' });
  mutantMod._resetForTest({ sdkReadyMs: 60, promptMs: 60 });
  const mutantRes = await mutantMod.requestPushPermission();
  assert(mutantRes === false && mutantRes?.reason === undefined,
    `[24j-b] CANARY CONFIRMED: with requestPushPermission() collapsed back to a bare boolean (scratch copy only), the sw-not-found case resolves ${JSON.stringify(mutantRes)} with no reason — every [24a] assertion WOULD go red`);

  // MUTATION 2 — drop the dashboard override from the init() options.
  const mutant2 = pushSrc.replace(/\n\s*serviceWorkerOverrideForTypical: true,/, '');
  assert(mutant2 !== pushSrc, '[24j-c] the second mutation actually changed the scratch text');
  const findings2 = workerConfigFindings(mutant2, swSrc, htmlSrc);
  assert(findings2.some(f => /serviceWorkerOverrideForTypical/.test(f)),
    '[24j-d] CANARY CONFIRMED: removing serviceWorkerOverrideForTypical (scratch text only) makes [24g] report a finding — that guard can fail, it is not vacuous');

  // MUTATION 3 — rename the worker in init() without renaming the registration.
  const mutant3 = pushSrc.replace(/serviceWorkerPath: '[^']+'/, "serviceWorkerPath: 'OneSignalSDKWorker.js'");
  const findings3 = workerConfigFindings(mutant3, swSrc, htmlSrc);
  assert(findings3.some(f => /filename mismatch/.test(f)),
    '[24j-e] CANARY CONFIRMED: pointing init() at a worker filename index.html does not register is caught by [24g] — the 404 that produces "OneSignal service worker not found!" cannot ship silently');

  const afterBytes = await readFile(pushSrcPath, 'utf8');
  assert(afterBytes === beforeBytes,
    '[24j-f] the REAL js/push-onesignal.js on disk is byte-identical before/after this canary — only scratch copies were ever written');

  restoreGlobals();
}

// ── [25] F1 — SERVICE-WORKER RE-REGISTRATION RELOAD LOOP ────────────────────
//   LATENT on production today; it unlocks the moment Drew configures the
//   OneSignal dashboard, because the SDK only registers a worker once push is
//   actually set up for the app.
//
//   Two registrars, same file, same scope, different query strings — and each
//   side's "is this already mine?" test compares the FULL URL:
//
//     ours   index.html → navigator.serviceWorker.register('service-worker.js?v=20-0')
//     SDK    OneSignalSDK.page.es6.js?v=160610
//            ma():  registered scriptURL === `${origin}/service-worker.js?appId=<id>&sdkVersion=160610`?
//            Sa():  if not → register(that url, {scope:'/'}), on EVERY init(),
//                   and init() runs from internalInit() on every page load.
//
//   Neither string can ever equal the other. A new scriptURL at the same scope
//   installs a new worker; service-worker.js skipWaiting()s in install and
//   clients.claim()s in activate → `controllerchange` → index.html reloaded
//   unconditionally → the reloaded page registers `?v=20-0` again → flip →
//   loop. `let reloaded = false` is per-PAGE-LOAD: it capped reloads at one per
//   load and never broke the cycle.
//
//   Modelled before the fix (scratch repro, same simulator as below driving the
//   OLD inline logic): 8 page loads, 8 reloads, 16 register() calls, 0
//   update() calls, alternating URLs, no convergence.
//
//   Fix is both halves, and both are asserted here:
//     (A) convergence  — js/sw-register.js registerServiceWorker(): a
//         registration whose BASENAME is ours gets update(), never a
//         re-register under a different query.
//     (B) conditional reload — wireControllerChangeReload(): a controller flip
//         earns a reload only when the new controller's CACHE_NAME differs from
//         the one the page booted under.
console.log('\n[25] Service worker: the two registrars converge, and only a real shell change reloads…');
{
  const ORIGIN = 'https://irbfootball.com';
  const APP_ID = 'abad65e9-0000-0000-0000-000000000000';
  const SDK_URL = `${ORIGIN}/service-worker.js?appId=${APP_ID}&sdkVersion=160610`;
  const OUR_URL = 'service-worker.js?v=20-0';
  const swRegPath = fileURLToPath(new URL('./js/sw-register.js', import.meta.url));
  const swRegSrc = await readFile(swRegPath, 'utf8');
  const swSrc25 = await readFile(fileURLToPath(new URL('./service-worker.js', import.meta.url)), 'utf8');
  const htmlSrc25 = await readFile(fileURLToPath(new URL('./index.html', import.meta.url)), 'utf8');
  const appSrc25 = await readFile(fileURLToPath(new URL('./js/app.js', import.meta.url)), 'utf8');
  const cssSrc25 = await readFile(fileURLToPath(new URL('./css/styles.css', import.meta.url)), 'utf8');
  const swReg = await import('./js/sw-register.js');

  const settle = () => new Promise(r => setTimeout(r, 0));

  // A MessageChannel stand-in — the page↔worker version handshake, with no
  // Node MessagePort to keep the event loop alive.
  const fakeChannel = () => {
    const port1 = { onmessage: null, close() {} };
    const port2 = { postMessage: (m) => { port1.onmessage && port1.onmessage({ data: m }); } };
    return { port1, port2 };
  };
  const readV = (worker, opts) => swReg.readWorkerVersion(worker, { ...(opts || {}), channel: fakeChannel, timeoutMs: 50 });

  /** Deterministic model of one origin's service-worker registry. */
  function makeSwEnv({ cacheName = 'cfb-pickems-v20-0', answersVersion = true } = {}) {
    const env = {
      cacheName, reg: null, controller: null,
      listeners: [], queue: [],
      registerCalls: [], updateCalls: 0, reloads: 0, pageLoads: 0,
    };
    const mkWorker = (href) => ({
      scriptURL: href, state: 'installing', cacheName: env.cacheName,
      addEventListener() {},
      postMessage(msg, ports) {
        // Mirrors service-worker.js's message handler. A worker deployed BEFORE
        // this change simply never answers — answersVersion:false models that.
        if (msg && msg.type === 'GET_VERSION' && answersVersion && ports && ports[0]) {
          ports[0].postMessage({ type: 'VERSION', cacheName: this.cacheName });
        }
      },
    });
    const install = (href) => {
      const w = mkWorker(href);
      const reg = env.reg && env.reg.scriptURL === href ? env.reg : {
        scope: ORIGIN + '/', scriptURL: href, active: env.reg && env.reg.active, waiting: null, installing: null,
        addEventListener() {}, async update() { env.updateCalls++; doUpdate(); },
      };
      reg.scriptURL = href; reg.installing = w; env.reg = reg;
      env.queue.push(() => {
        w.state = 'activated'; reg.installing = null; reg.active = w; env.controller = w;
        env.listeners.slice().forEach(fn => fn());      // clients.claim() → controllerchange
      });
      return reg;
    };
    // update() re-fetches the script from the network; a CACHE_NAME bump is a
    // byte-diff, so a new worker installs. Identical bytes → nothing happens.
    const doUpdate = () => {
      if (env.reg && env.reg.active && env.reg.active.cacheName !== env.cacheName) install(env.reg.scriptURL);
    };
    env.nav = {
      serviceWorker: {
        get controller() { return env.controller; },
        async getRegistration() { return env.reg; },
        async register(url, opts) {
          const href = new URL(url, ORIGIN + '/').href;
          env.registerCalls.push(href);
          if (env.reg && env.reg.scriptURL === href && env.reg.active) return env.reg;  // same URL, same bytes: no-op
          return install(href);
        },
        addEventListener(type, fn) { if (type === 'controllerchange') env.listeners.push(fn); },
      },
    };
    env.drain = async () => {
      let guard = 0;
      while (env.queue.length && guard++ < 50) { env.queue.shift()(); await settle(); }
      await settle();
    };
    env.preRegister = (href) => { install(href); env.queue.shift()(); };   // seed without events
    return env;
  }

  // OneSignal v16 ma()/Sa(), transcribed from the shipped bundle.
  async function sdkInit(env) {
    const reg = await env.nav.serviceWorker.getRegistration('/');
    const cur = reg && (reg.active || reg.waiting || reg.installing);
    if (!cur || cur.scriptURL !== SDK_URL) await env.nav.serviceWorker.register(SDK_URL, { scope: '/' });
  }

  /** One page load: our registrar + the SDK's, in the order the browser runs
   *  them. Returns true if the page asked to reload. */
  async function pageLoad(env, setup) {
    env.pageLoads++;
    env.listeners = [];                 // a reload wipes the page's listeners
    let wantsReload = false;
    await setup(env, () => { wantsReload = true; env.reloads++; });
    await env.drain();
    await sdkInit(env);
    await env.drain();
    return wantsReload;
  }
  const ourSetup = (env, reload) => swReg.setupServiceWorker({
    nav: env.nav, scriptUrl: OUR_URL, reload, readVersion: readV, versionTimeoutMs: 50,
    log: () => {}, warn: () => {},
  });

  // ── [25a] CONVERGENCE — the SDK registered first; we must NOT re-register ─
  {
    const env = makeSwEnv();
    env.preRegister(SDK_URL);                       // dashboard configured, SDK won the race
    const res = await swReg.registerServiceWorker({ nav: env.nav, scriptUrl: OUR_URL });
    assert(res.action === 'updated',
      `[25a] a worker for OUR script file is already registered (under the SDK's query string) → update(), not a second register() (got "${res.action}")`);
    assert(env.registerCalls.length === 0,
      `[25a] register() was NOT called with a different URL for the same file — this is the assertion the whole loop hangs on (calls: ${JSON.stringify(env.registerCalls)})`);
    assert(env.updateCalls === 1, `[25a] …and update() WAS called exactly once instead (got ${env.updateCalls})`);
    assert(env.reg.scriptURL === SDK_URL,
      '[25a] the registration still points at the SDK\'s URL, so the SDK\'s own ma() check now matches and IT stops re-registering too — that is what "converge" means');
  }

  // ── [25b] the full loop, end to end: it must terminate ────────────────────
  {
    const env = makeSwEnv();
    let loads = 0, reloadAsked = true;
    while (reloadAsked && loads < 8) { reloadAsked = await pageLoad(env, ourSetup); loads++; }
    assert(loads <= 2,
      `[25b] a fresh device converges in ≤2 page loads (got ${loads}; the OLD inline logic ran the 8-load cap out and never stopped — 8 reloads, 16 register() calls, 0 update()s)`);
    assert(env.reloads <= 1,
      `[25b] …costing at most ONE reload in total (got ${env.reloads})`);
    // Steady state: keep loading the page; nothing may move.
    const regsBefore = env.registerCalls.length, reloadsBefore = env.reloads;
    for (let i = 0; i < 3; i++) await pageLoad(env, ourSetup);
    assert(env.registerCalls.length === regsBefore,
      `[25b] three more page loads register NOTHING new — both registrars are satisfied (${env.registerCalls.length - regsBefore} new calls)`);
    assert(env.reloads === reloadsBefore,
      `[25b] …and reload NOTHING (${env.reloads - reloadsBefore} new reloads). This is the exact condition the loop violated.`);
  }

  // ── [25c] reload policy: same CACHE_NAME silent, different reloads once ───
  {
    const mkCtrl = (name, answers = true) => ({
      scriptURL: ORIGIN + '/service-worker.js', cacheName: name,
      postMessage(m, ports) { if (m && m.type === 'GET_VERSION' && answers && ports && ports[0]) ports[0].postMessage({ type: 'VERSION', cacheName: name }); },
    });
    const mkNav = () => {
      const ls = [];
      return { ls, nav: { serviceWorker: { controller: null, addEventListener: (t, f) => { if (t === 'controllerchange') ls.push(f); } } } };
    };
    // same shell
    {
      const { nav, ls } = mkNav();
      nav.serviceWorker.controller = mkCtrl('cfb-pickems-v20-0');
      let reloads = 0;
      swReg.wireControllerChangeReload({ nav, bootVersion: Promise.resolve('cfb-pickems-v20-0'), reload: () => reloads++, readVersion: readV, log: () => {} });
      nav.serviceWorker.controller = mkCtrl('cfb-pickems-v20-0');   // SDK re-registered the SAME file
      ls.forEach(f => f()); await settle(); await settle();
      assert(reloads === 0,
        `[25c] controllerchange with an IDENTICAL CACHE_NAME does not reload (got ${reloads}) — a controller flip is not an app update`);
    }
    // real update
    {
      const { nav, ls } = mkNav();
      nav.serviceWorker.controller = mkCtrl('cfb-pickems-v20-0');
      let reloads = 0;
      swReg.wireControllerChangeReload({ nav, bootVersion: Promise.resolve('cfb-pickems-v20-0'), reload: () => reloads++, readVersion: readV, log: () => {} });
      nav.serviceWorker.controller = mkCtrl('cfb-pickems-v20-1');
      ls.forEach(f => f()); await settle(); await settle();
      ls.forEach(f => f()); await settle(); await settle();          // a second flip must not double-reload
      assert(reloads === 1,
        `[25c] a DIFFERENT CACHE_NAME reloads EXACTLY once, even across two controllerchange events (got ${reloads}) — the genuine update path is preserved`);
    }
    // unknown version → fail safe toward reloading
    {
      const { nav, ls } = mkNav();
      nav.serviceWorker.controller = mkCtrl('cfb-pickems-v20-0', false);
      let reloads = 0;
      swReg.wireControllerChangeReload({ nav, bootVersion: Promise.resolve(null), reload: () => reloads++, readVersion: readV, log: () => {} });
      nav.serviceWorker.controller = mkCtrl('cfb-pickems-v20-1', false);
      ls.forEach(f => f());
      await new Promise(r => setTimeout(r, 90));   // readVersion's timeout must elapse
      assert(reloads === 1,
        `[25c] a worker that cannot answer GET_VERSION (anything deployed BEFORE this change) still gets its reload (got ${reloads}) — "unknown" is never treated as "unchanged"`);
    }
  }

  // ── [25d] first install, and the genuine release, both still work ─────────
  {
    const env = makeSwEnv();
    const res = await swReg.setupServiceWorker({ nav: env.nav, scriptUrl: OUR_URL, reload: () => env.reloads++, readVersion: readV, versionTimeoutMs: 50, log: () => {}, warn: () => {} });
    assert(res.action === 'registered' && env.registerCalls.length === 1 && env.registerCalls[0] === ORIGIN + '/' + OUR_URL,
      `[25d] fresh device with no registration → a real register() of service-worker.js?v=20-0 (got ${res.action}, ${JSON.stringify(env.registerCalls)})`);
    await env.drain();
    assert(env.reloads === 1, `[25d] …and first install still reloads once when the new worker claims the page (got ${env.reloads})`);

    // RG-04: ship a release. The registered URL is now whatever is registered;
    // what invalidates the shell is CACHE_NAME INSIDE service-worker.js.
    await sdkInit(env); await env.drain();                 // let the SDK take the URL over first
    const reloadsAfterConverge = env.reloads;
    env.cacheName = 'cfb-pickems-v20-1';                   // ← the deploy
    let released = 0;
    await swReg.setupServiceWorker({ nav: env.nav, scriptUrl: 'service-worker.js?v=20-1', reload: () => { released++; env.reloads++; }, readVersion: readV, versionTimeoutMs: 50, log: () => {}, warn: () => {} });
    await env.drain();
    assert(env.updateCalls >= 1 && released === 1,
      `[25d] RG-04 HOLDS: a CACHE_NAME bump reaches the device through update() and reloads exactly once, WITHOUT us re-registering a new ?v= URL (update()s: ${env.updateCalls}, reloads: ${released})`);
    assert(env.reg.active.cacheName === 'cfb-pickems-v20-1',
      '[25d] …and the worker actually running afterwards is the new one');
    void reloadsAfterConverge;
  }

  // ── [25e] wiring: one registrar, in the shell, talking to a worker that answers
  {
    assert(/setupServiceWorker\(\{\s*scriptUrl:/.test(htmlSrc25),
      '[25e] index.html registers through js/sw-register.js');
    const strayRegs = (htmlSrc25.match(/serviceWorker\.register\(/g) || []).length;
    assert(strayRegs === 0,
      `[25e] index.html contains NO direct serviceWorker.register() call any more (${strayRegs} found) — one registrar on our side, or F1 comes straight back`);
    assert(/GET_VERSION/.test(swSrc25) && /cacheName:\s*CACHE_NAME/.test(swSrc25),
      '[25e] service-worker.js answers GET_VERSION with its CACHE_NAME — the page cannot tell a real update from a controller flip without it');
    assert(/'\.\/js\/sw-register\.js'/.test(swSrc25),
      '[25e] js/sw-register.js is in STATIC_ASSETS — the offline shell boots, and a boot-critical module is not left uncached');
    // ── EVERY STATICALLY IMPORTED MODULE, NOT A HAND-KEPT LIST (2026-09-18) ──
    // js/supabase-backend.js and js/supabase-projection.js shipped for a whole
    // build absent from STATIC_ASSETS while js/storage.js imported the first
    // statically — i.e. the precached shell held a module graph that could not
    // resolve, which is RG-03's blank app arriving through the cache rather than
    // through a typo. The per-file assertions above only ever catch the file
    // somebody remembered to write one for, so the rule is derived from the
    // imports instead: anything any js/ module imports with a STATIC `import …
    // from './x.js'` must be in the shell. Dynamic `import()` is deliberately
    // not counted — those are fetched on demand, by design.
    {
      const { readdirSync, readFileSync } = await import('node:fs');
      const jsDir = new URL('./js/', import.meta.url);
      const jsFiles = readdirSync(jsDir).filter(f => f.endsWith('.js'));
      assert(jsFiles.length >= 15, `[25e] fixture: js/ was enumerated (${jsFiles.length} modules)`);
      const imported = new Set();
      for (const f of jsFiles) {
        const src = readFileSync(new URL(f, jsDir), 'utf8');
        for (const m of src.matchAll(/^\s*import\s[^;]*?from\s+'\.\/([\w.-]+\.js)'/gm)) imported.add(m[1]);
      }
      assert(imported.has('storage.js') && imported.has('auth.js'),
        '[25e] fixture: the import scan found the modules everything depends on — a scan that found nothing would make the rule vacuous');
      const uncached = [...imported].filter(f => !swSrc25.includes(`'./js/${f}'`)).sort();
      assert(uncached.length === 0,
        `[25e] every STATICALLY imported js/ module is in STATIC_ASSETS (missing: ${JSON.stringify(uncached)}) — a shell cache that is one module short serves a graph that cannot resolve`);
      assert(['supabase-backend.js', 'supabase-projection.js'].every(f => imported.has(f) && swSrc25.includes(`'./js/${f}'`)),
        '[25e] …including the two the adapter added, named here because they are the pair that was missing');
    }
    assert(/swScriptBasename\(worker\.scriptURL\) === ourName/.test(swRegSrc),
      '[25e] the ownership test compares BASENAMES, not full URLs (the mutation in [25f] is exactly this line)');
  }

  // ── [25f] MUTATION CANARIES — scratch copies only, real file never written
  //   Three mutants, because the fix has two halves and each one has to be
  //   shown to be load-bearing on its own:
  //     A reverted        → we re-register the same file (the [25a] assertion goes red)
  //     A reverted        → a new worker installs on EVERY page load, forever
  //     A and B reverted  → F1 itself: the page never stops reloading
  {
    const scratch = process.env.TMPDIR || '/tmp';
    const before = swRegSrc;
    const stamp = Date.now();
    const mutantA = swRegSrc.replace(
      'if (worker && swScriptBasename(worker.scriptURL) === ourName) {',
      'if (worker && worker.scriptURL === scriptUrl) {');
    assert(mutantA !== swRegSrc, '[25f-a] the basename mutation actually changed the scratch text (non-vacuous)');
    const mutantAB = mutantA.replace('if (before && after && before === after) {', 'if (false) {');
    assert(mutantAB !== mutantA, '[25f-a] …and the reload-policy mutation is non-vacuous too');

    const pathA = `${scratch}/sw-register.no-basename.${stamp}.mjs`;
    const pathAB = `${scratch}/sw-register.no-basename-no-version.${stamp}.mjs`;
    await writeFile(pathA, mutantA, 'utf8');
    await writeFile(pathAB, mutantAB, 'utf8');
    const modA = await import(`file://${pathA}`);
    const modAB = await import(`file://${pathAB}`);

    const envA0 = makeSwEnv();
    envA0.preRegister(SDK_URL);
    const resA = await modA.registerServiceWorker({ nav: envA0.nav, scriptUrl: OUR_URL });
    assert(resA.action === 'registered' && envA0.registerCalls.length === 1,
      `[25f-b] CANARY CONFIRMED: with the basename check reverted to a full-URL compare (scratch copy only), we re-register the same file under our own query — [25a] goes red (action "${resA.action}", calls ${JSON.stringify(envA0.registerCalls)})`);

    // A reverted, B intact: no reload loop — and that is exactly why B alone is
    // not enough. The worker churns invisibly on every single page load.
    const envA = makeSwEnv();
    const runA = (e, reload) => modA.setupServiceWorker({ nav: e.nav, scriptUrl: OUR_URL, reload, readVersion: readV, versionTimeoutMs: 50, log: () => {}, warn: () => {} });
    await pageLoad(envA, runA);                       // first install (legitimately reloads once)
    const regs1 = envA.registerCalls.length, reloads1 = envA.reloads;
    for (let i = 0; i < 4; i++) await pageLoad(envA, runA);
    assert(envA.registerCalls.length - regs1 >= 4 && envA.reloads === reloads1,
      `[25f-c] CANARY CONFIRMED: without (A), four further page loads re-register ${envA.registerCalls.length - regs1} more times — a new worker installed and claimed on EVERY load, forever — while (B) holds reloads at ${envA.reloads}. (B) hides the churn; it does not stop it. Both halves ship.`);

    // A and B both reverted = the shipped v20-0 behaviour = F1.
    const envAB = makeSwEnv();
    let loads = 0, again = true;
    while (again && loads < 8) { again = await pageLoad(envAB, (e, reload) => modAB.setupServiceWorker({ nav: e.nav, scriptUrl: OUR_URL, reload, readVersion: readV, versionTimeoutMs: 50, log: () => {}, warn: () => {} })); loads++; }
    assert(loads >= 8 && envAB.reloads >= 8,
      `[25f-d] CANARY CONFIRMED: with BOTH halves reverted the page never converges — ${loads} page loads, ${envAB.reloads} reloads, capped only by this test. That is F1, reproduced.`);

    const after = await readFile(swRegPath, 'utf8');
    assert(after === before, '[25f-e] the REAL js/sw-register.js on disk is byte-identical before/after these canaries — only scratch copies were written');
  }

  // ── [25g] double-tap on Turn On fires ONE permission prompt ───────────────
  //   Reviewer ruling. requestPushPermission() stays in flight for as long as
  //   the native sheet is up (PROMPT_TIMEOUT_MS is 120s), and the button was
  //   live that whole time. The handler is EXECUTED here, sliced out of the
  //   real js/app.js, so this cannot pass on a comment.
  {
    const needle = "ov.querySelector('#notif-priming-btn')?.addEventListener('click'";
    const i = appSrc25.indexOf(needle);
    assert(i > 0, '[25g] found the priming-button handler in js/app.js');
    const end = appSrc25.indexOf('\n  });', i);
    const handlerSrc = appSrc25.slice(i, end + '\n  });'.length);

    const runTaps = async (src) => {
      let handler = null, calls = 0, toasts = 0;
      const releases = [];
      const btn = { disabled: false, addEventListener: (t, f) => { if (t === 'click') handler = f; } };
      const ov = { querySelector: () => btn };
      // N1 (2026-09-12) — `refreshNotifCenterBody` became
      // `refreshNotifSettingsBody` (DI-N5: the bell opens settings, there is no
      // Center body left to refresh) and the handler now also calls
      // `refreshPushActiveFlag()` (DI-N3: a permission grant is one of the two
      // events that flip the device's push-active flag). Both are injected, so
      // this still EXECUTES the real handler source rather than a copy of it.
      let pushFlagRefreshes = 0;
      new Function('ov', 'showToast', 'requestPushPermission', 'pushFailureMessage', 'refreshNotifSettingsBody', 'refreshPushActiveFlag', 'playerId', src)(
        ov, () => { toasts++; }, () => { calls++; return new Promise(r => releases.push(r)); }, () => 'nope', async () => {},
        () => { pushFlagRefreshes++; }, 'p1');
      const t1 = handler({ currentTarget: btn });
      const disabledDuring = btn.disabled;
      const t2 = handler({ currentTarget: btn });        // the impatient second tap
      await settle();
      releases.forEach(r => r({ ok: true, reason: 'granted' }));
      await Promise.all([t1, t2]); await settle();
      return { calls, disabledDuring, toasts, enabledAfter: btn.disabled === false, pushFlagRefreshes };
    };

    const real = await runTaps(handlerSrc);
    assert(real.calls === 1,
      `[25g] two taps while the prompt is open produce exactly ONE requestPushPermission() call (got ${real.calls}) — two would mean two native prompts racing for one Notification.permission, and two toasts that can disagree`);
    assert(real.disabledDuring === true, '[25g] the button is disabled for the duration of the await');
    assert(real.toasts === 1, '[25g] …and exactly one toast is shown');
    assert(real.enabledAfter === true, '[25g] the button is re-enabled afterwards (a dismissed prompt leaves the card on never-asked, and it must stay tappable)');
    assert(real.pushFlagRefreshes >= 1,
      `[25g] N1/DI-N3: granting permission recomputes the device's push-active flag right there (got ${real.pushFlagRefreshes} calls) — without it a player who just tapped Turn On keeps getting in-app toasts for notices the phone is now also pushing, until the next boot`);

    const mutantHandler = handlerSrc.replace('btn.disabled = true;', '');
    assert(mutantHandler !== handlerSrc, '[25g] (the canary mutation is non-vacuous)');
    const mutated = await runTaps(mutantHandler);
    assert(mutated.calls === 2,
      `[25g] CANARY CONFIRMED: delete the disable and the double-tap fires TWO prompts again (got ${mutated.calls})`);
  }

  // ── [25h] DI-A2's 44px tap target on the Turn On button ──────────────────
  {
    const m = cssSrc25.match(/#notif-priming-btn\s*\{[^}]*min-height:\s*(\d+)px/);
    assert(!!m && Number(m[1]) >= 44,
      `[25h] #notif-priming-btn has an explicit min-height ≥44px per DI-A2 (found ${m ? m[1] + 'px' : 'no rule'}) — .btn-sm's base 34px is under the floor, and a missed tap on the card's only action reads as "push is broken"`);
  }
}

console.log('\n[26] N1 / DI-N4 — lifecycle rows in the chat relay (UN-204)…');
{
  // N1 moved every lifecycle notice into the Locker Room as an ordinary
  // `type:'message'` row (the ONLY type this relay pushes — every legacy sys_*
  // emitter is `type:'system'`, which is why the whole event class never pushed
  // at all: BUG-10's structural half). Two things must change for those rows,
  // and ONLY those rows:
  //
  //   1. They are gated by the lifecycle event's OWN preference category, not
  //      by 'chat'. Without this, a player who silenced League Updates and left
  //      Chat on starts receiving locking-soon pushes again the moment the
  //      notice moves into chat — a silent reversal of DI-A4.
  //   2. A row the SERVER already pushed (meta.origin:'server') is skipped
  //      entirely, or every device pushes it a second time.
  const chat20 = await import('./js/chat.js');
  const relayPlayers = storage.getPlayers().filter(p => p.active);

  /** Ingest one confirmed row through the REAL relay and return what it pushed.
   *  Mirrors [8]'s harness, including the priming backfill that seeds the
   *  watermark from a real non-zero head (F1 / [12] CASE 2). */
  let seq20 = 0;
  const relay = async (row, { prep = null } = {}) => {
    storage.setNotifications([]);
    chat20._resetForTest();
    chat20.initChat('p1');
    seq20 = 0;
    chat20.ingest([{ id: `prime_${++seq20}`, seq: seq20, ts: Date.now(), type: 'message', author: 'p1',
                     gameTag: '', body: 'priming backfill', targetId: '', replyTo: '', notify: true, meta: null }]);
    notif._resetChatWatermarkForTest();
    const captured = [];
    notif.registerPushAdapter({ isConfigured: () => true, async send(r) { captured.push(r); return { ok: true }; } });
    notif.wireChatNotifications();
    if (prep) prep();
    chat20.ingest([{ seq: ++seq20, ts: Date.now(), type: 'message', gameTag: '', targetId: '', replyTo: '',
                     notify: true, ...row }]);
    await new Promise(r => setTimeout(r, 10));
    notif._clearPushAdapterForTest();
    return captured;
  };

  const lifecycleRow = (over = {}) => ({
    id: 'sys_lc_PICKS_LOCKING_SOON_wk9', author: 'scribe', body: '4/6 in. 1h to lock.',
    meta: { kind: 'lifecycle', event: 'PICKS_LOCKING_SOON', weekId: 'wk9', category: 'leagueUpdates', origin: 'client' },
    ...over,
  });

  // ── 20a. It pushes at all, to EVERYONE, and stores nothing. ──────────────
  const capA = await relay(lifecycleRow());
  assert(capA.length === relayPlayers.length,
    `26-1: a lifecycle post pushes to EVERY active player (${capA.length} of ${relayPlayers.length}). 'scribe' is not a player, so the sender-exclusion rule (AD-35 / DI-B1) excludes nobody — which is the point of a league-wide notice`);
  assert(storage.getNotifications().length === 0,
    '26-2: …and writes ZERO cfbp_notifications rows. The room IS the record now; a second stored copy in a list nothing renders is the "three habits" problem it replaced');
  assert(capA.every(r => r.event === 'CHAT_MESSAGE_CREATED'),
    '26-3: the push payload event stays CHAT_MESSAGE_CREATED, so the deep link opens the MESSAGE IN THE ROOM — "one place" includes where the tap lands (DI-N4)');
  assert(capA.every(r => r.dedupKey === `CHAT_MESSAGE_CREATED|sys_lc_PICKS_LOCKING_SOON_wk9||${r.playerId}`),
    `26-4: …and the dedupKey shape is untouched — identical on all six devices, collapsed server-side by CFBP_NOTIFY_SENT (AD-11 / AD-35 / DI-B1 payload shape unchanged). Got e.g. "${capA[0]?.dedupKey}"`);
  assert(capA.every(r => r.destination?.tab === 'chat'),
    '26-5: …landing on the chat tab, not on the bell or the dashboard');

  // ── N1 follow-up (b), 2026-09-12 — WHO THE PUSH SAYS IT IS FROM. ────────
  // The relay titles a push with `getPlayer(senderId)?.displayName || senderId`.
  // 'scribe' is not a player, so getPlayer() misses and the fallback is the raw
  // id — every SCRIBE-authored row, which since N1 is EVERY lifecycle notice,
  // arrives on the lock screen titled lowercase "scribe". A push is the only
  // surface where the author is not rendered by chat-ui's nameOf(), so this is
  // the one place the id leaks to a player.
  assert(capA.every(r => r.title === 'SCRIBE'),
    `26-5a: a SCRIBE-authored row is titled "SCRIBE" on the lock screen, not the raw storage id — got "${capA[0]?.title}"`);
  assert(capA.every(r => r.body.startsWith('SCRIBE: ')),
    `26-5b: …and the body prefix matches the title rather than reading "scribe: 4/6 in." — got "${capA[0]?.body}"`);

  // ── 20b. Category silence SURVIVES the move. ────────────────────────────
  const silencedId = relayPlayers[3].playerId;
  const setCats = (playerId, prefs) => {
    const list = storage.getPlayers();
    const i = list.findIndex(p => p.playerId === playerId);
    list[i] = { ...list[i], preferences: prefs };
    storage.savePlayer(list[i]);
  };
  const restoreCats = () => setCats(silencedId, {});

  setCats(silencedId, { notifyPushMaster: true, notifyCategories: { leagueUpdates: false, chat: true } });
  const capB = await relay(lifecycleRow({ id: 'sys_lc_PICKS_LOCKING_SOON_wk10', meta: { kind: 'lifecycle', event: 'PICKS_LOCKING_SOON', weekId: 'wk10', category: 'leagueUpdates', origin: 'client' } }));
  assert(!capB.some(r => r.playerId === silencedId),
    '26-6: a player who silenced LEAGUE UPDATES gets NO push for a lifecycle row whose event is PICKS_LOCKING_SOON — the category gate follows the notice into chat instead of collapsing to "chat"');
  assert(capB.length === relayPlayers.length - 1,
    `26-7: …and everybody else still does (${capB.length} of ${relayPlayers.length - 1} expected) — one player's preference silences one player`);

  const capC = await relay({ id: 'human_msg_1', author: 'p1', body: 'anyone watching this game', meta: null });
  assert(capC.some(r => r.playerId === silencedId),
    '26-8: …and that SAME player still gets ordinary CHAT pushes, because Chat is a different toggle. Silencing League Updates must not silence the room');
  const drewName = storage.getPlayers().find(p => p.playerId === 'p1')?.displayName;
  assert(capC.every(r => r.title === drewName),
    `26-8a: a HUMAN sender is still titled by displayName — the SCRIBE naming is one branch, not a rewrite of the title rule (expected "${drewName}", got "${capC[0]?.title}")`);
  restoreCats();

  // ── 20c. The server already pushed it. ─────────────────────────────────
  const capD = await relay(lifecycleRow({
    id: 'sys_lc_PICKS_LOCKING_SOON_wk11',
    meta: { kind: 'lifecycle', event: 'PICKS_LOCKING_SOON', weekId: 'wk11', category: 'leagueUpdates', origin: 'server' },
  }));
  assert(capD.length === 0,
    `26-9: a row marked meta.origin:'server' is NOT relayed at all (got ${capD.length} pushes). scanReminders() already pushed it through its own per-player master×category gate; without this skip, every device pushes the 7am locking-soon notice a SECOND time`);

  // ── 20d. D3 — the commissioner is never silenceable. ───────────────────
  setCats(silencedId, { notifyPushMaster: true, notifyCategories: { leagueUpdates: false, results: false, obligations: false, chat: false, pickReminders: false } });
  const capE = await relay(lifecycleRow({
    id: 'sys_lc_COMMISSIONER_ANNOUNCEMENT_abc', author: 'p1', body: 'Slate is up early this week.',
    meta: { kind: 'lifecycle', event: 'COMMISSIONER_ANNOUNCEMENT', weekId: null, category: null, origin: 'client' },
  }));
  assert(capE.some(r => r.playerId === silencedId),
    '26-10: a COMMISSIONER_ANNOUNCEMENT reaches a player with EVERY category switched off — CATEGORY_OF_EVENT maps it to null and resolveIntent() skips the category gate entirely (D3, unchanged by this move)');
  assert(!capE.some(r => r.playerId === 'p1'),
    '26-11: …but not the commissioner himself: it posts under HIS playerId, so the existing sender-exclusion rule applies and he is not pushed his own words');
  setCats(silencedId, { notifyPushMaster: false, notifyCategories: {} });
  const capF = await relay(lifecycleRow({
    id: 'sys_lc_COMMISSIONER_ANNOUNCEMENT_def', author: 'p1', body: 'Second announcement.',
    meta: { kind: 'lifecycle', event: 'COMMISSIONER_ANNOUNCEMENT', weekId: null, category: null, origin: 'client' },
  }));
  assert(!capF.some(r => r.playerId === silencedId),
    '26-12: …and the MASTER toggle still governs it — D3\'s table is `category null -> push: !!master`, which this change does not touch');
  restoreCats();

  // ── 20e. An unknown/garbage lifecycle event fails to the SAFE side. ─────
  const capG = await relay(lifecycleRow({
    id: 'sys_lc_WHO_KNOWS_wk12',
    meta: { kind: 'lifecycle', event: 'NOT_A_REAL_EVENT', weekId: 'wk12', category: 'leagueUpdates', origin: 'client' },
  }));
  assert(capG.length === relayPlayers.length,
    '26-13: a row naming an event the vocabulary does not know still DELIVERS rather than being silently dropped — the category is read from CATEGORY_OF_EVENT by event NAME, so a hand-edited meta.category cannot grant itself an exemption');

  // ── N1 follow-up (d), 2026-09-12 — WHICH WAY "unknown" FAILS. ───────────
  // The comment above this branch in notifications.js says an unknown event
  // "resolves to `undefined` and falls back to the chat category, which is the
  // safe direction (it can be silenced)." The code said `?? null`, and a null
  // category is D3's NEVER-SILENCEABLE shape — the one reserved for
  // COMMISSIONER_ANNOUNCEMENT. A malformed or future row therefore overrode
  // every preference on the device, which is the opposite of what was written
  // and the opposite of safe. 26-13 above cannot see the difference (with all
  // categories ON both shapes deliver); this is the assertion that can.
  setCats(silencedId, { notifyPushMaster: true, notifyCategories: { chat: false, leagueUpdates: true } });
  const capG2 = await relay(lifecycleRow({
    id: 'sys_lc_WHO_KNOWS_wk13',
    meta: { kind: 'lifecycle', event: 'NOT_A_REAL_EVENT', weekId: 'wk13', category: 'leagueUpdates', origin: 'client' },
  }));
  assert(!capG2.some(r => r.playerId === silencedId),
    '26-14: …and it is SILENCEABLE — an unknown event falls back to the CHAT category, so a player who switched Chat off is not pushed. `?? null` would hand an unnamed event the never-silenceable exemption D3 reserves for the commissioner');
  assert(capG2.length === relayPlayers.length - 1,
    `26-15: …and silences exactly that one player, nobody else (got ${capG2.length} of ${relayPlayers.length - 1})`);
  restoreCats();

  chat20._resetForTest();
  notif._resetChatWatermarkForTest();
  notif._clearPushAdapterForTest();
  storage.setNotifications([]);
}

console.log('\n[27] BUG-12 — a push that arrives (or is tapped) while the app is running forces a chat fetch…');
{
  // Drew, 2026-09-12: "When I receive a push notification it doesn't show up in
  // the chat for at least 30 seconds after the notification. When I click the
  // push, I should be able to see the message in the chat."
  //
  // boottest.mjs §11 owns the transport half (wake(), and its bound). This
  // section owns the WIRING half: the two OneSignal hooks that have to call it,
  // and app.js's deep link, which must not run its scroll until the forced
  // fetch has resolved — otherwise the "no-op if outside the loaded window"
  // fallback fires against a room that does not hold the message yet, which is
  // the second half of what Drew saw.
  const saved27 = { document: globalThis.document, OneSignalDeferred: globalThis.OneSignalDeferred };
  const push27 = await import('./js/push-onesignal.js');

  /** A minimal v16-shaped SDK: just the event bus the two hooks subscribe to. */
  function fakeSdk() {
    const handlers = new Map();
    const sdk = { Notifications: {
      addEventListener(type, fn) { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push(fn); },
    } };
    globalThis.OneSignalDeferred = { push: (fn) => { fn(sdk); } };
    return {
      fire: (type, ev) => (handlers.get(type) || []).forEach(fn => fn(ev)),
      count: type => (handlers.get(type) || []).length,
    };
  }
  const notifEvent = (event, extra = {}) => ({
    notification: { additionalData: { event, ...extra } },
    preventDefault() { this._prevented = true; },
  });

  globalThis.document = { body: { dataset: { tab: 'dashboard' } } };

  // ── A. FOREGROUND. A push landing while the app is open must fetch, whatever
  //      tab the player is on and whether or not the payload names an event. ──
  {
    const sdk = fakeSdk();
    const woke = [];
    push27.wireForegroundSuppression(notif.destinationFor, (ev) => woke.push(ev));
    const e1 = notifEvent('CHAT_MESSAGE_CREATED', { messageId: 'm1' });
    sdk.fire('foregroundWillDisplay', e1);
    assert(woke.length === 1,
      `27-1: a foreground push triggers the injected chat fetch (wakeChat) — got ${woke.length} call(s). Before BUG-12 this hook did exactly one thing, suppress the banner, and the room still waited for the next poll`);
    assert(e1._prevented !== true,
      '27-2: …and the existing suppression rule is untouched — the player is on the dashboard, the push is for chat, so the OS banner is NOT suppressed');

    globalThis.document.body.dataset.tab = 'chat';
    const e2 = notifEvent('CHAT_MESSAGE_CREATED', { messageId: 'm2' });
    sdk.fire('foregroundWillDisplay', e2);
    assert(e2._prevented === true,
      '27-3: …and still IS suppressed when the player is already looking at the destination tab (§3 step 3, unchanged)');
    assert(woke.length === 2,
      `27-4: …while STILL fetching — a suppressed banner is the case where the room is the only surface, so it is the case that most needs to be current (got ${woke.length})`);

    const e3 = { notification: { additionalData: null }, preventDefault() { this._prevented = true; } };
    sdk.fire('foregroundWillDisplay', e3);
    assert(woke.length === 3,
      `27-5: …and a payload with no \`event\` in additionalData STILL fetches (got ${woke.length}). The fetch must not depend on copy metadata: an unnamed push is still evidence a message exists`);
  }

  // ── B. THE TAP, with the app already running. ──
  {
    const sdk = fakeSdk();
    const taps = [];
    assert(typeof push27.wireNotificationClicks === 'function',
      '27-6: push-onesignal.js exposes wireNotificationClicks() — the tap hook, alongside the foreground one (AD-16 untouched: it hands the tap to an injected callback, it does not touch the chat backend)');
    if (typeof push27.wireNotificationClicks === 'function') {
      push27.wireNotificationClicks((ev) => taps.push(ev));
      sdk.fire('click', notifEvent('CHAT_MESSAGE_CREATED', { messageId: 'm9' }));
      assert(taps.length === 1,
        `27-7: tapping a push while the app is already open forces a fetch (got ${taps.length}) — the case where no fresh boot happens and no URL is re-parsed`);
      let threw27 = false;
      try { push27.wireNotificationClicks(() => { throw new Error('boom'); }); sdk.fire('click', notifEvent('X')); }
      catch { threw27 = true; }
      assert(!threw27,
        '27-8: …and a callback that throws never escapes into the SDK handler — same defensive shape the foreground hook already has');
    }
  }

  globalThis.document = saved27.document;
  globalThis.OneSignalDeferred = saved27.OneSignalDeferred;
  if (saved27.OneSignalDeferred === undefined) delete globalThis.OneSignalDeferred;

  // ── C. app.js — the wiring and the ORDER. Structural, and labelled as such:
  //      boot() and deepLinkTo() need a live DOM this harness has no business
  //      building (the [25h]/boottest §10E precedent for source assertions). ──
  const appSrc27 = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
  assert(/import \{[^}]*\bwakeChat\b[^}]*\} from '\.\/chat\.js'/s.test(appSrc27),
    "27-9: app.js imports wakeChat from chat.js — the forced fetch goes through the chat engine's seam, not a second transport call site (AD-16)");
  assert(/wireForegroundSuppression\(destinationFor,\s*[^)]/.test(appSrc27),
    '27-10: boot() passes the fetch trigger as wireForegroundSuppression()\'s second argument');
  assert(/wireNotificationClicks\(/.test(appSrc27),
    '27-11: …and wires the tap hook at the same point in boot');
  const deepLinkSrc27 = (appSrc27.match(/function deepLinkTo\(destination\)[\s\S]*?\n\}\n/) || [''])[0];
  assert(/wakeChat\(/.test(deepLinkSrc27),
    '27-12: deepLinkTo() forces a chat fetch for a chat destination — the deep link is the push TAP path on a cold open (?ntab=chat), where the room has never been read this session');
  const wakeAt27 = deepLinkSrc27.indexOf('wakeChat(');
  const midAt27  = deepLinkSrc27.indexOf('data-mid');
  assert(wakeAt27 > -1 && midAt27 > -1 && wakeAt27 < midAt27,
    `27-13: …and it AWAITS that fetch before looking the message up (wake at ${wakeAt27}, [data-mid] lookup at ${midAt27}) — scrolling first is how the "message not in the loaded window" fallback fired prematurely, which is Drew's "I should be able to see the message"`);
  assert(/await\s+wakeChat\(|wakeChat\(\)[\s\S]{0,80}\.then\(|\.catch\([^)]*\)[\s\S]{0,40}\.then\(/.test(deepLinkSrc27),
    '27-14: …by actually waiting on the promise, not fire-and-forget — a wake whose result nothing waits for leaves the same race in place');
}

console.log('\n[28] DI-T6.1 — the client half of the notify-fanout switch (Phase III Step 6)…');
{
  // While `settings.serverJobs.notifyFanout` is true, the Edge Function fans a
  // chat row out server-side: one `notifications` row per recipient and one
  // OneSignal call for the whole league. If this device ALSO relays, the first
  // message after switch-on pushes twice — the single most likely defect in the
  // whole step, and the reason the switch has a client half at all.
  //
  // BOTH STATES ARE ASSERTED, because only one of them is the new behaviour and
  // the OTHER is the one that must be byte-identical to today. A suppression
  // that also fired with the switch off would be a silent end to push.
  const chat28 = await import('./js/chat.js');
  const relayPlayers28 = storage.getPlayers().filter(p => p.active);
  const settingsBefore28 = storage.getSettings();

  let seq28 = 0;
  const relay28 = async (row) => {
    storage.setNotifications([]);
    chat28._resetForTest();
    chat28.initChat('p1');
    seq28 = 0;
    chat28.ingest([{ id: `prime28_${++seq28}`, seq: seq28, ts: Date.now(), type: 'message', author: 'p1',
                     gameTag: '', body: 'priming backfill', targetId: '', replyTo: '', notify: true, meta: null }]);
    notif._resetChatWatermarkForTest();
    const captured = [];
    notif.registerPushAdapter({ isConfigured: () => true, async send(r) { captured.push(r); return { ok: true }; } });
    notif.wireChatNotifications();
    chat28.ingest([{ seq: ++seq28, ts: Date.now(), type: 'message', gameTag: '', targetId: '', replyTo: '',
                     notify: true, ...row }]);
    await new Promise(r => setTimeout(r, 10));
    notif._clearPushAdapterForTest();
    return captured;
  };
  const msg28 = (n) => ({ id: `m28_${n}`, author: 'p2', body: `who is covering ${n}`, meta: null });

  // ── 28a. ABSENT — the shape every league has today, and will still have the
  //    moment the function is deployed but not switched on. ─────────────────
  storage.saveSetting('serverJobs', undefined);
  const capAbsent = await relay28(msg28(1));
  assert(capAbsent.length === relayPlayers28.length - 1,
    `28-1: with NO serverJobs key at all the client relays exactly as it does today (${capAbsent.length} pushes, one per active player but the sender). CONVENTIONS #10 on this side: an absent switch changes nothing`);

  // ── 28b. EXPLICIT FALSE — the shape after Drew flips it back off. ────────
  storage.saveSetting('serverJobs', { notifyFanout: false });
  const capOff = await relay28(msg28(2));
  assert(capOff.length === relayPlayers28.length - 1,
    `28-2: …and with notifyFanout:false it relays too (${capOff.length}) — the rollback is a flip, and a flip back has to restore push on the very next message with no deploy`);

  // ── 28c. TRUE — the server is doing it; this device must not. ────────────
  storage.saveSetting('serverJobs', { notifyFanout: true });
  const capOn = await relay28(msg28(3));
  assert(capOn.length === 0,
    `28-3: with notifyFanout:true the client relays NOTHING (got ${capOn.length}). Without this the first chat message after switch-on buzzes every phone twice`);
  assert(storage.getNotifications().length === 0,
    '28-4: …and writes no local notification rows either — the function writes the `notifications` rows now, one per recipient, with origin:\'server\'');

  // ── 28d. THE WATERMARK STILL ADVANCES WHILE SUPPRESSED. ─────────────────
  // The gate sits AFTER the watermark advance on purpose. Gating at the top of
  // the scan would freeze the watermark for as long as the switch is on, so the
  // first scan after a flip BACK would see a week of messages as "fresh", trip
  // CHAT_RELAY_BURST_CAP and relay nothing at all — the rollback would not roll
  // back. This is the assertion that would notice.
  {
    storage.setNotifications([]);
    chat28._resetForTest();
    chat28.initChat('p1');
    let s = 0;
    chat28.ingest([{ id: `prime28_w`, seq: ++s, ts: Date.now(), type: 'message', author: 'p1',
                     gameTag: '', body: 'priming backfill', targetId: '', replyTo: '', notify: true, meta: null }]);
    notif._resetChatWatermarkForTest();
    const captured = [];
    notif.registerPushAdapter({ isConfigured: () => true, async send(r) { captured.push(r); return { ok: true }; } });
    notif.wireChatNotifications();
    storage.saveSetting('serverJobs', { notifyFanout: true });
    for (let i = 0; i < 40; i += 1) {
      chat28.ingest([{ id: `m28_sup_${i}`, seq: ++s, ts: Date.now(), type: 'message', author: 'p2',
                       gameTag: '', body: `suppressed ${i}`, targetId: '', replyTo: '', notify: true, meta: null }]);
    }
    await new Promise(r => setTimeout(r, 10));
    const suppressedMark = notif._chatWatermarkForTest();
    assert(captured.length === 0 && suppressedMark >= s,
      `28-5: forty messages arrive with the switch ON — zero pushes, and the watermark still tracks the room (at ${suppressedMark}, head ${s})`);
    storage.saveSetting('serverJobs', { notifyFanout: false });
    chat28.ingest([{ id: 'm28_after_flip', seq: ++s, ts: Date.now(), type: 'message', author: 'p2',
                     gameTag: '', body: 'after the flip back', targetId: '', replyTo: '', notify: true, meta: null }]);
    await new Promise(r => setTimeout(r, 10));
    notif._clearPushAdapterForTest();
    assert(captured.length === relayPlayers28.length - 1,
      `28-6: …and the very next message after the flip back relays normally (${captured.length}), with no burst-cap trip — which is what "the rollback is a flip, not a deploy" has to mean in practice`);
    assert(notif._chatRelayBurstTripsForTest().length === 0,
      '28-7: …and CHAT_RELAY_BURST_CAP was never tripped, because the forty suppressed messages were never re-scanned as a backlog');
  }

  // ── 28e. ONLY THE LITERAL `true`. ───────────────────────────────────────
  for (const [label, value] of [['the string "true"', { notifyFanout: 'true' }],
                                ['the number 1', { notifyFanout: 1 }],
                                ['a null bag', null],
                                ['an empty object', {}],
                                ['a non-object', 'notifyFanout']]) {
    storage.saveSetting('serverJobs', value);
    const cap = await relay28(msg28(`shape_${label.replace(/\W+/g, '')}`));
    assert(cap.length === relayPlayers28.length - 1,
      `28-8: ${label} does NOT suppress the relay — only the boolean does. A settings blob is commissioner-editable JSON, and a truthy string must never be able to silence push`);
  }

  // ── 28f. THE CLIENT'S READER AND THE SERVER'S ARE THE SAME DECISION. ────
  // Not "similar" — the same answer on every shape, including the ambiguous
  // ones above. The function reads `settings.serverJobs.<job>` out of
  // `league_kv.settings`; the client reads it out of `cfbp_settings`, which is
  // the SAME ROW (js/supabase-projection.js maps them 1:1). If the two readers
  // ever disagreed, one side would relay while the other did too.
  {
    const rules = await import('./supabase/functions/_shared/job-rules.mjs');
    assert(JSON.stringify([...rules.SERVER_JOBS]) === JSON.stringify([...notif.SERVER_JOB_NAMES]),
      `28-9: the eight switch names are identical on both sides, in the same order — server ${JSON.stringify([...rules.SERVER_JOBS])}`);
    // 28-9b (final release gate, v0.23.0): every switch name has a BUILT entry in the card. Phase 6
    // shipped its function, migration and warning copy but never touched SERVER_JOB_BUILT, so the
    // scoresRefresh row rendered "Not built yet" with a disabled checkbox — invisible to a
    // 1754-assertion green sweep because no assertion tied the two tables together.
    {
      const { readFile: rf289 } = await import('node:fs/promises');
      const src289 = await rf289(new URL('./js/app.js', import.meta.url), 'utf8');
      const m289 = src289.match(/const SERVER_JOB_BUILT = Object\.freeze\(\{([^}]*)\}\)/);
      assert(!!m289, '28-9b: SERVER_JOB_BUILT literal found in js/app.js (fixture check)');
      const built289 = m289 ? [...m289[1].matchAll(/(\w+):\s*true/g)].map((x) => x[1]) : [];
      const missing289 = [...notif.SERVER_JOB_NAMES].filter((j) => !built289.includes(j));
      assert(missing289.length === 0, `28-9b: every SERVER_JOB_NAMES entry is marked built in the Background-jobs card — missing: ${JSON.stringify(missing289)}`);
    }
    const shapes = [
      undefined, null, {}, { serverJobs: null }, { serverJobs: {} },
      { serverJobs: { notifyFanout: true } }, { serverJobs: { notifyFanout: false } },
      { serverJobs: { notifyFanout: 'true' } }, { serverJobs: { notifyFanout: 1 } },
      { serverJobs: { notifyFanout: 0 } }, { serverJobs: 'notifyFanout' },
      { serverJobs: { NOTIFYFANOUT: true } }, { serverJobs: { notifyFanout: true }, season: '2026' },
    ];
    const disagree = shapes.filter(s =>
      rules.isJobEnabledFromSettings(s, 'notifyFanout') !== notif.serverJobEnabledIn(s, 'notifyFanout'));
    assert(disagree.length === 0,
      `28-10: the client's serverJobEnabledIn() and the function's isJobEnabledFromSettings() agree on all ${shapes.length} shapes, including every ambiguous one (${disagree.length} disagreements)`);
    assert(notif.serverJobEnabledIn({ serverJobs: { notAJob: true } }, 'notAJob') === false &&
           rules.isJobEnabledFromSettings({ serverJobs: { notAJob: true } }, 'notAJob') === false,
      '28-11: …and a job name outside the eight reads as OFF on both sides — a typo\'d switch name is the same direction as an absent one');
  }

  // ── 28g. MUTATION CANARY — remove the suppression and 28-3 goes RED. ────
  // Against a SCRATCH COPY. The real js/notifications.js is never opened for
  // writing here (CLAUDE.md: commit before mutation testing, and never restore
  // with git). The gutted copy keeps every other line, so a green here would
  // mean the assertion above is passing for some reason other than the gate.
  {
    const realSrc = await readFile(new URL('./js/notifications.js', import.meta.url), 'utf8');
    const GATE = "if (isServerJobEnabled('notifyFanout')) return;";
    assert(realSrc.includes(GATE),
      '28-12: the gate is one line in _scanNewChatMessages, spelled exactly as the canary below removes it');
    // The scratch copy lives in TMPDIR, never in the repo — and its own relative
    // imports are rewritten to absolute file URLs of the REAL js/ modules, so
    // the mutant shares one `storage.js` and one `chat.js` with everything else
    // in this file rather than instantiating a second, empty world.
    const absSrc = realSrc.replace(/from '\.\/([A-Za-z0-9_.-]+\.js)'/g,
      (_m, f) => `from '${new URL(`./js/${f}`, import.meta.url).href}'`);
    assert(absSrc !== realSrc && absSrc.includes(GATE),
      '28-12b: …and the import-rewrite for the scratch copy found its targets without disturbing the gate (non-vacuous)');
    const scratch = new URL(`file://${process.env.TMPDIR || '/tmp'}/notifications.step6canary.${Date.now()}.mjs`);
    await writeFile(scratch, absSrc.replace(GATE, '/* GATE REMOVED BY THE CANARY */'), 'utf8');
    const gutted = await import(scratch.href);
    storage.saveSetting('serverJobs', { notifyFanout: true });
    storage.setNotifications([]);
    chat28._resetForTest();
    chat28.initChat('p1');
    let s2 = 0;
    chat28.ingest([{ id: 'prime28_canary', seq: ++s2, ts: Date.now(), type: 'message', author: 'p1',
                     gameTag: '', body: 'priming backfill', targetId: '', replyTo: '', notify: true, meta: null }]);
    gutted._resetChatWatermarkForTest();
    const capturedGut = [];
    gutted.registerPushAdapter({ isConfigured: () => true, async send(r) { capturedGut.push(r); return { ok: true }; } });
    gutted.wireChatNotifications();
    chat28.ingest([{ id: 'm28_canary', seq: ++s2, ts: Date.now(), type: 'message', author: 'p2',
                     gameTag: '', body: 'the double push', targetId: '', replyTo: '', notify: true, meta: null }]);
    await new Promise(r => setTimeout(r, 10));
    gutted._clearPushAdapterForTest();
    assert(capturedGut.length === relayPlayers28.length - 1,
      `28-13: MUTATION CANARY — with the gate deleted the same message DOES relay (${capturedGut.length} pushes), which is the double push in a test tube. 28-3 is therefore load-bearing and not passing by accident`);
    await rm(scratch, { force: true });
  }

  // Leave the blob exactly as it was found: every later section reads settings.
  storage.saveSettings(settingsBefore28);
  chat28._resetForTest();
  notif._resetChatWatermarkForTest();
  notif._clearPushAdapterForTest();
  notif._resetChatRelayBurstTripsForTest();
  storage.setNotifications([]);
}

console.log('\n[29] DI-T6.1 — the dedup key is BYTE-IDENTICAL on both sides of the switch…');
{
  // The `notifications` table's own unique key is
  // (league_id, member_id, dedup_key, origin) — 0001:443 — and Apps Script's
  // CFBP_NOTIFY_SENT ledger is keyed on the same string. A message relayed by a
  // client and fanned out by the function must therefore produce the SAME
  // string for the same recipient, or the two paths stop deduping against each
  // other during the one window where both can run: a flip, a retried webhook,
  // a device that had not re-hydrated settings yet.
  //
  // `_shared/job-rules.mjs` COPIED `makeDedupKey` rather than importing it —
  // js/notifications.js imports chat.js, storage.js and backend.js, which reach
  // localStorage, the DOM and fetch, and Deno can load none of that. So the copy
  // is PINNED here instead of trusted: both functions are imported and compared
  // across a table of inputs. Drift in either direction is RED.
  const rules29 = await import('./supabase/functions/_shared/job-rules.mjs');
  const cases = [
    { event: 'CHAT_MESSAGE_CREATED', weekId: 'msg_1', threshold: '', playerId: 'p1' },
    { event: 'CHAT_MESSAGE_CREATED', weekId: 'sys_lc_PICKS_LOCKING_SOON_wk9', threshold: '', playerId: 'p6' },
    { event: 'PICKS_REMINDER', weekId: 'w_1757', threshold: '15m', playerId: 'p3' },
    { event: 'PICKS_LOCKING_SOON', weekId: 'w_1757', threshold: 'locking-soon', playerId: 'p2' },
    { event: 'RESULTS_FINALIZED', weekId: '', threshold: '', playerId: 'p4' },
    { event: 'OBLIGATION_SETTLED', playerId: 'p5' },
    { event: 'COMMISSIONER_ANNOUNCEMENT', weekId: undefined, threshold: undefined, playerId: 'p1' },
    { event: 'CHAT_MESSAGE_CREATED', weekId: 'msg|with|pipes', threshold: '', playerId: 'p1' },
  ];
  const mismatches = cases.filter(c => notif.makeDedupKey(c) !== rules29.makeDedupKey(c));
  assert(mismatches.length === 0,
    `29-1: js/notifications.js makeDedupKey() and _shared/job-rules.mjs makeDedupKey() return the identical string for all ${cases.length} shapes, including the empty and undefined ones (${mismatches.length} mismatches)`);
  assert(notif.makeDedupKey(cases[0]) === 'CHAT_MESSAGE_CREATED|msg_1||p1' &&
         rules29.makeDedupKey(cases[0]) === 'CHAT_MESSAGE_CREATED|msg_1||p1',
    '29-2: …and both are pinned to the LITERAL four-part string, so a matched pair of edits that changed the format on both sides at once is still red (Code.gs isValidDedupKey validates this shape server-side today)');

  // The key the FUNCTION actually writes comes out of fanoutPlan(), not out of
  // makeDedupKey() directly — the weekId slot carries the MESSAGE id, which is
  // the one piece of the format a porter could plausibly get wrong, because
  // chat has no week concept at all.
  const plan = rules29.fanoutPlan({
    record: { id: 'msg_42', league_id: 'L', type: 'message', author: 'p2', body: 'hi', notify: true, meta: null },
    members: [{ id: 'p1', active: true, display_name: 'Drew', preferences: {} },
              { id: 'p2', active: true, display_name: 'Brayden', preferences: {} }],
    senderDisplayName: 'Brayden',
  });
  assert(plan.recipients.length === 1 && plan.recipients[0].memberId === 'p1',
    '29-3: fanoutPlan() excludes the sender, exactly as the client relay does (one recipient for a two-member league)');
  assert(plan.recipients[0].dedupKey === notif.makeDedupKey({
    event: 'CHAT_MESSAGE_CREATED', weekId: 'msg_42', threshold: '', playerId: 'p1' }),
    `29-4: …and the key it plans to write is the one THIS client would have sent for that row — the weekId slot carries the MESSAGE id, because chat has no week and dedup must be per-message. Got "${plan.recipients[0].dedupKey}"`);
  assert(plan.recipients[0].dedupKey === 'CHAT_MESSAGE_CREATED|msg_42||p1',
    '29-5: …pinned to the literal, so both sides moving together is still a red');
}

console.log('\n[30] DI-T6.2/DI-T6.14(b) — js/reminder-rules.js is a PARALLEL extraction of backend/notifyServer.mjs, verified BEHAVIOURALLY (both modules run under plain Node, so this can EXECUTE both sides across shared fixtures rather than diff text)…');
{
  const rules30 = await import('./js/reminder-rules.js');

  // 30a — the constants are identical values, not just identical names.
  assert(JSON.stringify(rules30.REMINDER_THRESHOLDS) === JSON.stringify(server.REMINDER_THRESHOLDS),
    '30a: REMINDER_THRESHOLDS is byte-identical between js/reminder-rules.js and backend/notifyServer.mjs');
  assert(rules30.LOCKING_SOON_MS === server.LOCKING_SOON_MS,
    '30a: …and so is LOCKING_SOON_MS');

  // 30b — the pure helpers, EXECUTED against the same fixtures. Any drift in
  // logic (not just presentation) is a mismatched return value here.
  const games30 = [{ weekId: 'w1', kickoff: '2026-10-03T17:00:00.000Z' }, { weekId: 'w1', kickoff: '2026-10-03T20:00:00.000Z' }];
  assert(rules30.firstKickoffMs(games30) === server.firstKickoffMs(games30),
    '30b: firstKickoffMs() agrees on a two-game week');
  assert(rules30.firstKickoffMs([]) === server.firstKickoffMs([]),
    '30b: …and on an empty list (both null)');

  const week30 = { weekId: 'w1', picksLockAt: null, autoLockOffsetMinutes: 45 };
  assert(rules30.effectiveLockAtMs(week30, games30) === server.effectiveLockAtMs(week30, games30),
    '30b: effectiveLockAtMs() agrees when deriving lock from kickoff - offset');
  const week30b = { weekId: 'w1', picksLockAt: '2026-10-03T16:00:00.000Z', autoLockOffsetMinutes: 45 };
  assert(rules30.effectiveLockAtMs(week30b, games30) === server.effectiveLockAtMs(week30b, games30),
    '30b: …and when picksLockAt is set explicitly');

  const weeks30 = [
    { weekId: 'wA', status: 'open' },
    { weekId: 'wB', status: 'open' },
  ];
  const gamesFor30 = [
    { weekId: 'wA', kickoff: '2026-10-10T17:00:00.000Z' },
    { weekId: 'wB', kickoff: '2026-10-03T17:00:00.000Z' },
  ];
  const selA = rules30.selectActiveOpenWeek({ weeks: weeks30, activeWeekId: null, games: gamesFor30 });
  const selB = server.selectActiveOpenWeek({ weeks: weeks30, activeWeekId: null, games: gamesFor30 });
  assert(JSON.stringify(selA) === JSON.stringify(selB) && selA?.weekId === 'wB',
    `30b: selectActiveOpenWeek() agrees on the earliest-lock tiebreak with no active pointer (both picked ${JSON.stringify(selA?.weekId)})`);

  const prefCases30 = [
    { player: { preferences: {} }, category: 'pickReminders' },
    { player: { preferences: { notifyPushMaster: false } }, category: 'pickReminders' },
    { player: { preferences: { notifyPushMaster: true, notifyCategories: { pickReminders: false } } }, category: 'pickReminders' },
    { player: null, category: null },
  ];
  for (const [i, c] of prefCases30.entries()) {
    assert(rules30.resolveServerPushIntent(c) === server.resolveServerPushIntent(c),
      `30b: resolveServerPushIntent() agrees for case ${i}`);
  }

  for (const raw of [null, undefined, 'false', 'FALSE', ' False ', 'true', 'anything']) {
    assert(rules30.readNameNonSubmittersFlag(raw) === server.readNameNonSubmittersFlag(raw),
      `30b: readNameNonSubmittersFlag(${JSON.stringify(raw)}) agrees`);
  }

  for (const dk of ['PICKS_REMINDER|w1|24h|p1', '', 'no-pipes-at-all', 'a|b|c|d|e', '|w1|24h|p1']) {
    assert(rules30.isValidDedupKey(dk) === server.isValidDedupKey(dk),
      `30b: isValidDedupKey(${JSON.stringify(dk)}) agrees`);
  }

  // 30c — computeReminderPlan(): identical DECISIONS (who, which threshold,
  // which dedup key, which body), with the ONE DOCUMENTED additive field
  // (`title`) on js/reminder-rules.js's side and nowhere else. Comparing the
  // two plans field-by-field (rather than JSON.stringify equality) is what
  // makes that addition visible as a NAMED difference instead of failing the
  // whole assertion.
  const now30 = new Date('2026-10-03T15:50:00.000Z').getTime(); // 10 min before an 18:20 lock
  const week30c = { weekId: 'w1', status: 'open', dataSourceMode: 'manual', weekNumber: 5, picksLockAt: '2026-10-03T18:20:00.000Z', autoLockOffsetMinutes: 30 };
  const games30c = [{ weekId: 'w1', kickoff: '2026-10-03T18:50:00.000Z' }];
  const players30c = [
    { playerId: 'p1', displayName: 'Drew', active: true },
    { playerId: 'p2', displayName: 'Brayden', active: true },
  ];
  const picks30c = [{ weekId: 'w1', playerId: 'p1' }];
  const planA = rules30.computeReminderPlan({ week: week30c, games: games30c, picks: picks30c, players: players30c, now: now30 });
  const planB = server.computeReminderPlan({ week: week30c, games: games30c, picks: picks30c, players: players30c, now: now30 });

  assert(planA.remindersPlan.length > 0 && planA.remindersPlan.length === planB.remindersPlan.length,
    `30c: both sides produce the same NUMBER of reminder candidates (got A=${planA.remindersPlan.length} B=${planB.remindersPlan.length})`);
  const stripTitle = (r) => { const { title, ...rest } = r; return rest; };
  assert(JSON.stringify(planA.remindersPlan.map(stripTitle)) === JSON.stringify(planB.remindersPlan),
    '30c: …and every candidate is IDENTICAL once the additive `title` field is set aside (playerId, dedupKey, threshold, remaining, category, body all match)');
  assert(planA.remindersPlan.every((r) => typeof r.title === 'string' && r.title.length > 0),
    '30c: …and js/reminder-rules.js DOES carry a real title on every candidate — buildCopy() already computed it; this module keeps it instead of discarding it a second time');

  assert(!!planA.lockingSoonPlan === !!planB.lockingSoonPlan,
    '30c: both sides agree on whether the locking-soon window has opened');
  if (planA.lockingSoonPlan) {
    const { title: titleA, ...restA } = planA.lockingSoonPlan;
    const { ...restB } = planB.lockingSoonPlan;
    assert(JSON.stringify(restA) === JSON.stringify(restB),
      '30c: …and the locking-soon plan is IDENTICAL once `title` is set aside (entries, body, meta, copyEvent, nonSubmitters, submittedCount, totalPlayers, nameNonSubmitters all match)');
    assert(typeof titleA === 'string' && titleA.length > 0,
      '30c: …with a real title on js/reminder-rules.js\'s side');
  }

  // 30d — REVIEWER R6 (Step 6 Phase 2 gate, 2026-09-20): everything above only
  // ever calls computeReminderPlan() with `nameNonSubmitters` left at its
  // default (true). The COUNT-ONLY branch (`PICKS_LOCKING_SOON_COUNT_ONLY`,
  // js/reminder-rules.js:210-215) had never been driven through this twin at
  // all, so a drift there — the exact shape [23c]/[23g] already guard on the
  // Code.gs side — would have gone unnoticed on the reminders/index.js side.
  // A FRESH `now` — `now30` (10 min before an 18:20 lock, 2h30m out) is
  // BEFORE the 1h locking-soon window even opens, which is why [30c]'s
  // `!!planA.lockingSoonPlan === !!planB.lockingSoonPlan` held trivially
  // (both null). 30d needs the window genuinely open on both sides.
  const now30d = new Date('2026-10-03T17:50:00.000Z').getTime(); // 30 min before the same 18:20 lock
  const planNamedFalse30 = rules30.computeReminderPlan({ week: week30c, games: games30c, picks: picks30c, players: players30c, now: now30d, nameNonSubmitters: false });
  const planNamedFalse30b = server.computeReminderPlan({ week: week30c, games: games30c, picks: picks30c, players: players30c, now: now30d, nameNonSubmitters: false });
  assert(!!planNamedFalse30.lockingSoonPlan && !!planNamedFalse30b.lockingSoonPlan,
    '30d: fixture: the locking-soon window is open with a real non-submitter on BOTH sides — the branch this asserts on is actually reached, not skipped as a no-op');
  assert(planNamedFalse30.lockingSoonPlan.copyEvent === 'PICKS_LOCKING_SOON_COUNT_ONLY' && planNamedFalse30b.lockingSoonPlan.copyEvent === 'PICKS_LOCKING_SOON_COUNT_ONLY',
    `30d: nameNonSubmitters:false selects the COUNT-ONLY copy event on BOTH sides (got A=${planNamedFalse30.lockingSoonPlan.copyEvent} B=${planNamedFalse30b.lockingSoonPlan.copyEvent})`);
  const { title: titleFalse30, ...restFalse30 } = planNamedFalse30.lockingSoonPlan;
  const { ...restFalse30b } = planNamedFalse30b.lockingSoonPlan;
  assert(JSON.stringify(restFalse30) === JSON.stringify(restFalse30b),
    '30d: …and the two plans are IDENTICAL once `title` is set aside — critically, the body carries NO NAME in this branch on either side (the blind-adjacent guarantee [23e]/[23g] already hold for Code.gs, now pinned for reminder-rules.js too)');
  assert(!/Brayden/.test(restFalse30.body) && !/Brayden/.test(restFalse30b.body),
    `30d: the non-submitter's NAME does not leak into the count-only body on either side (A=${JSON.stringify(restFalse30.body)}, B=${JSON.stringify(restFalse30b.body)})`);
  assert(typeof titleFalse30 === 'string' && titleFalse30.length > 0,
    '30d: js/reminder-rules.js still carries its additive `title` in the count-only branch too');
}

// ── Result ───────────────────────────────────────────────────────────────────
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
