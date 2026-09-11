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

import { readFile, writeFile, copyFile } from 'node:fs/promises';
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
    RESULTS_FINALIZED_YOU_WON: { weekN: 3 },
    OBLIGATION_CREATED: { weekN: 3 },
    OBLIGATION_SETTLED: { weekN: 3 },
  };
  let matrixChecked = 0;
  for (const [event, meta] of Object.entries(fixtures)) {
    const out = copy.buildCopy(event, meta, 'dk_' + event);
    matrixChecked++;
    const lower = out.body.toLowerCase();
    const violated = FORBIDDEN_LITERALS.some(w => lower.includes(w));
    assert(!violated, `NEGATIVE CASE: ${event}'s body contains no spread/tiebreaker/Extra-Point literal (got: "${out.body}")`);
  }
  assert(matrixChecked === Object.keys(fixtures).length, 'every known event was actually exercised in the matrix (non-vacuous)');
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
    chat._resetForTest();
    mutantNotif._clearPushAdapterForTest();
  } finally {
    // restore immediately, before any assertion, so a crash mid-check can
    // never leave the gutted seed live in the working tree.
    await copyFile(scratchCopy, target);
  }
  assert(mutantStormCount === (players.length - 1) * 51,
    `[13c] MUTATION CONFIRMED: with the seed disabled, the watermark stays stuck at 0 and the next scan re-floods all 51 messages — ${(players.length - 1) * 51} relay calls (got ${mutantStormCount}) — this IS the storm F1 fixes`);

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

// ── Result ───────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
