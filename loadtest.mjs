/**
 * CFB Pickems — loadtest.mjs (v0.17.0)
 * =====================================
 * MANDATORY after every multi-edit batch (`node --check` is NOT sufficient —
 * it can't catch broken imports, missing exports, or runtime top-level errors;
 * the v0.13 regression proved it).
 *
 * Run:  node loadtest.mjs
 *
 * 1. Stubs enough DOM/localStorage for every module to import cleanly.
 * 2. Imports ALL app modules (incl. app.js top-level execution).
 * 3. Chat fold correctness suite:
 *    - out-of-order seq ingestion
 *    - duplicate id dedupe
 *    - edit arriving BEFORE its target message
 *    - react on a not-yet-seen target (buffered, then applied)
 *    - delete on an already-edited message
 *    - order-independence: same event array shuffled 10×, identical fold
 *    - unread math against a fixture lastSeenSeq
 * 4. Extra Point blackjack grading suite.
 */

import { readFile, readdir } from 'node:fs/promises';

// ── DOM / browser stubs ───────────────────────────────────────────────────────
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};
const nullEl = new Proxy(function () {}, {
  get: (t, p) => {
    if (p === 'classList') return { add() {}, remove() {}, toggle() {}, contains: () => false };
    if (p === 'style') return {};
    if (p === 'dataset') return {};
    if (['addEventListener', 'removeEventListener', 'appendChild', 'removeChild', 'insertAdjacentHTML', 'remove', 'focus', 'scrollTo'].includes(p)) return () => {};
    if (p === 'querySelectorAll') return () => [];
    if (p === 'querySelector' || p === 'closest') return () => null;
    if (p === 'innerHTML' || p === 'textContent' || p === 'value') return '';
    return undefined;
  },
  set: () => true,
});
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ ...({}), set innerHTML(v) {}, get innerHTML() { return ''; }, appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {}, classList: { add() {}, remove() {} }, style: {}, id: '', className: '' }),
  body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '' },
  hidden: false,
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined, clipboard: { writeText: async () => {} } }, configurable: true }); }
globalThis.requestAnimationFrame = fn => fn();
globalThis.fetch = async () => { throw new Error('network disabled in loadtest'); };
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

// ── 1. Module import smoke test ───────────────────────────────────────────────
console.log('\n[1] Importing all modules…');
const mods = {};
for (const m of ['data-model', 'storage', 'scoring', 'data-provider', 'notifications', 'notify-copy', 'push-onesignal', 'sw-register', 'backend', 'chatTransport', 'chat', 'scribeLines', 'scribeAgent', 'scribeFeedback', 'extra-point', 'recap', 'history-2025', 'chat-ui', 'app']) {
  try {
    mods[m] = await import(`./js/${m}.js`);
    console.log('  ✅ js/' + m + '.js');
    pass++;
  } catch (e) {
    console.error('  ❌ js/' + m + '.js —', e.message);
    fail++;
  }
}

// ── 2. Chat fold suite (v0.17.0 — one room + gameTag) ─────────────────────────
console.log('\n[2] Chat fold correctness (gameTag model)…');
const chat = mods['chat'];
const { ingest, getMessages, getMessage, unreadCount, mentionUnreadCount,
        resolveTag, chatDigest, _resetForTest, _foldedSnapshot } = chat;

function ev(o) { return { gameTag: '', type: 'message', author: 'p1', body: '', notify: o.type === 'message' || o.type === undefined, ...o }; }

// Base log with every tricky case
const LOG = [
  ev({ id: 'm1', seq: 1, ts: 1000, body: 'first' }),
  ev({ id: 'e1', seq: 5, ts: 5000, type: 'edit', targetId: 'm2', body: 'second (edited)', notify: false }),  // edit BEFORE its target
  ev({ id: 'm2', seq: 2, ts: 2000, body: 'second' }),
  ev({ id: 'r1', seq: 6, ts: 6000, type: 'react', targetId: 'm3', meta: { emoji: '💀' }, author: 'p2', notify: false }), // react before target
  ev({ id: 'm3', seq: 3, ts: 3000, body: 'third', author: 'p2' }),
  ev({ id: 'm1', seq: 1, ts: 1000, body: 'first' }),                                          // duplicate id
  ev({ id: 'e2', seq: 7, ts: 7000, type: 'edit', targetId: 'm3', body: 'third (edited)', author: 'p2', notify: false }),
  ev({ id: 'd1', seq: 8, ts: 8000, type: 'delete', targetId: 'm3', author: 'p2', notify: false }),  // delete an edited msg
  ev({ id: 'm4', seq: 4, ts: 4000, body: 'fourth — tagged', author: 'p3', gameTag: 'g1' }),
  ev({ id: 'r2', seq: 9, ts: 9000, type: 'react', targetId: 'm1', meta: { emoji: '🔥' }, author: 'p3', notify: false }),
  ev({ id: 'u1', seq: 10, ts: 10000, type: 'unreact', targetId: 'm1', meta: { emoji: '🔥' }, author: 'p3', notify: false }),
  ev({ id: 'p1pin', seq: 11, ts: 11000, type: 'pin', targetId: 'm4', author: 'p1', notify: false }),
  ev({ id: 'gr1', seq: 12, ts: 12000, type: 'gamereact', gameTag: 'g1', meta: { emoji: '🔥' }, author: 'p2', notify: false }),
  ev({ id: 'm5', seq: 13, ts: 13000, body: '@Drew you seeing this', author: 'p2', meta: { mentions: ['p9'] } }),
];

_resetForTest();
ingest(LOG);
let msgs = getMessages({ tag: 'all' });

assert(msgs.filter(m => m.type === 'message').length === 5, 'dedupe: 5 unique messages from 6 message events');
assert(getMessage('m2').body === 'second (edited)' && getMessage('m2').edited, 'edit-before-target applied after target arrived');
assert(getMessage('m3').deleted === true, 'delete lands on an already-edited message');
assert(getMessage('m3').body === 'third (edited)', 'edit preserved under the tombstone');
assert((getMessage('m3').reactions['💀'] || []).length === 1, 'react buffered before target, then applied');
assert(!(getMessage('m1').reactions['🔥'] || []).length, 'react + unreact nets to zero');
assert(getMessage('m4').pinned === true, 'pin event folds onto its target');
assert(getMessages({ tag: 'g1' }).length === 2, 'tag filter: tagged message + gamereact only');
assert(getMessages({ tag: 'all', pinned: true }).length === 1, 'Hall of Records filter = pinned only');

// The cross-talk rule
assert(resolveTag({ replyTo: 'm4', viewTag: '' }) === 'g1', 'reply to tagged parent from main room inherits the tag');
assert(resolveTag({ replyTo: 'm1', viewTag: 'g1' }) === '', 'reply to untagged parent from a game view inherits null (parent wins)');
assert(resolveTag({ replyTo: null, viewTag: 'g2' }) === 'g2', 'no reply → view tag applies');
assert(resolveTag({ replyTo: null, viewTag: '' }) === '', 'main room composes untagged');

// order-independence: shuffle 10×, identical folded snapshot
_resetForTest(); ingest(LOG);
const baseline = _foldedSnapshot();
let orderOk = true;
for (let i = 0; i < 10; i++) {
  const shuffled = [...LOG];
  for (let j = shuffled.length - 1; j > 0; j--) {
    const k = Math.floor(Math.random() * (j + 1));
    [shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]];
  }
  _resetForTest();
  ingest(shuffled);
  if (_foldedSnapshot() !== baseline) orderOk = false;
}
assert(orderOk, 'fold is order-independent across 10 shuffles');

_resetForTest(); ingest(LOG); ingest(LOG);
assert(_foldedSnapshot() === baseline, 'fold is idempotent (double ingest identical)');

// unread math vs fixture (notify-based; ambient NEVER counts)
_resetForTest(); ingest(LOG);
localStorage.setItem('cfbp_chat_lastseen2', JSON.stringify({ seq: 2, byTag: {} }));
// p9 above seq2: m3 deleted (no), m4 notify (yes), gr1 ambient (no), m5 notify (yes) → 2
assert(unreadCount('p9', 'all') === 2, 'unread: notifying msgs only, deleted + ambient excluded');
assert(unreadCount('p9', 'g1') === 1, 'per-tag unread: only the tagged message counts, not the gamereact');
assert(unreadCount('p3', 'all') === 1, 'own messages never count toward own unread');
assert(mentionUnreadCount('p9') === 1, 'mention inbox: meta.mentions drives the count');
localStorage.removeItem('cfbp_chat_lastseen2');

// digest smoke (client-side, v2 shape)
const dg = chatDigest(0, 20000, { players: [] });
assert(dg.volume.total === 4, 'digest counts live human messages only');
assert(typeof dg.engagement.reactionRate === 'number', 'digest v2 carries engagement instrumentation');

// ── 3. Extra Point blackjack grading ─────────────────────────────────────────
console.log('\n[3] Extra Point blackjack grading…');
const { gradeExtraPoint } = mods['extra-point'];
const g1 = gradeExtraPoint(52, [
  { playerId: 'a', displayName: 'A', guess: 52 },   // blackjack
  { playerId: 'b', displayName: 'B', guess: 49 },
  { playerId: 'c', displayName: 'C', guess: 55 },   // bust
  { playerId: 'd', displayName: 'D', guess: null }, // no entry
]);
assert(g1.rows.find(r => r.playerId === 'a').outcome === 'blackjack', 'exact hit = blackjack');
assert(g1.winners.length === 1 && g1.winners[0] === 'a', 'blackjack beats closer-under');
assert(g1.rows.find(r => r.playerId === 'c').outcome === 'bust', 'over = bust');
assert(g1.rows.find(r => r.playerId === 'd').outcome === 'no-entry', 'missing guess = no-entry');

const g2 = gradeExtraPoint(50, [
  { playerId: 'a', displayName: 'A', guess: 48 },
  { playerId: 'b', displayName: 'B', guess: 48 },
  { playerId: 'c', displayName: 'C', guess: 40 },
]);
assert(g2.winners.length === 2 && g2.rows.filter(r => r.outcome === 'push-win').length === 2, 'tied best = shared push-win');

const g3 = gradeExtraPoint(45, [
  { playerId: 'a', displayName: 'A', guess: 46 },
  { playerId: 'b', displayName: 'B', guess: 50 },
]);
assert(g3.allBusted === true && g3.winners.length === 0, 'everyone over = table bust');

// ── 4. SCRIBE pools sanity ────────────────────────────────────────────────────
console.log('\n[4] SCRIBE voice pool sanity…');
const { SCRIBE_POOLS } = mods['scribeLines'];
let capsViolations = 0, profanityHeavy = 0;
Object.entries(SCRIBE_POOLS).forEach(([k, pool]) => {
  const profane = pool.filter(l => /\b(fuck|shit|damn|ass)\b/i.test(l)).length;
  if (profane > 1) profanityHeavy++;
  pool.forEach(raw => {
    const l = raw.replace(/\{NAME\}|\{N\}|\{TEAM\}/g, 'name');
    // 'NOTE:' removed from this whitelist (test-only pass, 2026-09-10) — it
    // was an accommodation for the now-retired "SCRIBE NOTE:" reflex opener
    // (v2.1 voice refresh); see section [65] below for the app-wide scan
    // that actually enforces the retirement.
    const words = l.split(/\s+/).filter(w => w.length > 3 && w === w.toUpperCase() && /[A-Z]{4,}/.test(w) && !['SCRIBE', 'BLACKJACK', 'BUST.', 'FINAL:'].includes(w));
    if (words.length) capsViolations++;
  });
});
assert(profanityHeavy === 0, 'max one profanity per pool');
assert(capsViolations === 0, 'almost no ALL CAPS (restraint is the bit)');
assert(Object.values(SCRIBE_POOLS).every(p => p.length >= 4), 'every pool has ≥4 lines');

// ── 5. Team shorthand: ONE source, shared with the compact dashboard ─────────
// Guard for v0.17.2 RG: chat-ui.js carried its own `name.split(' ').pop()`
// heuristic, so "Southern California" rendered as "California" in chat while
// the dashboard said "USC". Both now build from data-model's buildAbbrMap.
console.log('\n[5] Team shorthand — single shared source…');
const dm = mods['data-model'];
assert(typeof dm.buildAbbrMap === 'function', 'buildAbbrMap exported from data-model.js');
assert(typeof dm.TEAM_ABBR === 'object' && dm.TEAM_ABBR, 'TEAM_ABBR exported from data-model.js');

const abbrFixture = [
  { homeTeam: 'USC', awayTeam: 'San Jose State' },
  { homeTeam: 'Arkansas State', awayTeam: 'Arkansas' },
  { homeTeam: 'Texas A&M', awayTeam: 'Ohio State' },
  { homeTeam: 'Miami (OH)', awayTeam: 'Miami' },
];
const abbrMap = dm.buildAbbrMap(abbrFixture);
assert(abbrMap.get('USC') === 'USC', 'USC → USC');
assert(abbrMap.get('San Jose State') === 'SJSU', 'San Jose State → SJSU (not "State")');
assert(abbrMap.get('Arkansas State') === 'ARST' && abbrMap.get('Arkansas') === 'ARK',
  'Arkansas vs Arkansas State stay distinct (RG-02 family)');
assert(abbrMap.get('Texas A&M') === 'TAMU', 'Texas A&M → TAMU');
// No two teams on one slate may collapse to the same shorthand.
const abbrVals = [...abbrMap.values()];
assert(new Set(abbrVals).size === abbrVals.length, 'no duplicate abbreviations within a slate');
// The naive heuristic this replaced would have produced these — assert we don't.
assert(abbrMap.get('San Jose State') !== 'State' && abbrMap.get('Arkansas State') !== 'State',
  'the retired split-on-space heuristic is gone');

// ── 6. iOS hostile-environment init (v0.17.2) ───────────────────────────────
// Reproduces the reported iOS failure: Private Browsing makes localStorage
// throw. chat.js was already guarded; chat-ui.js was not, so tapping a
// dashboard bubble threw before the sheet rendered.
console.log('\n[6] iOS hostile environment — throwing localStorage…');
const realLS = globalThis.localStorage;
const realCrypto = globalThis.crypto;
const realNav = globalThis.navigator;
let hostileOk = true, hostileErr = '';
try {
  const thrower = () => { throw new Error('SecurityError: private browsing'); };
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: thrower, setItem: thrower, removeItem: thrower, clear: thrower },
    configurable: true,
  });
  Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true });      // no randomUUID
  Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });    // no setAppBadge
  // Re-import with a cache-busting query so module top-level runs again.
  await import(`./js/chat-ui.js?hostile=${Date.now()}`);
  await import(`./js/chat.js?hostile=${Date.now()}`);
} catch (e) {
  hostileOk = false; hostileErr = e.message;
} finally {
  Object.defineProperty(globalThis, 'localStorage', { value: realLS, configurable: true });
  Object.defineProperty(globalThis, 'crypto', { value: realCrypto, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: realNav, configurable: true });
}
assert(hostileOk, `chat modules import with localStorage throwing + no crypto/navigator${hostileErr ? ' — ' + hostileErr : ''}`);

// Static guard: no bare localStorage calls may creep back into chat-ui.js.
const chatUiSrc = await readFile(new URL('./js/chat-ui.js', import.meta.url), 'utf8');
const bareLS = chatUiSrc
  .split('\n')
  .filter(l => /localStorage\./.test(l) && !/^\s*\*/.test(l) && !/function lsGet|function lsSet|function lsRemove/.test(l));
assert(bareLS.length === 0,
  `chat-ui.js routes all localStorage through lsGet/lsSet/lsRemove${bareLS.length ? ' — found: ' + bareLS[0].trim() : ''}`);

// setAppBadge returns a Promise; an unhandled rejection breaks sync (CONVENTIONS #4).
assert(/setAppBadge[\s\S]{0,220}?\.catch\(/.test(chatUiSrc),
  'setAppBadge promise rejection is caught, not just the throw');

// ── 7. Presence removal (v0.17.2) — unread counting must survive ─────────────
// Presence ("N here now") and read receipts ("seen by k") were removed: both
// rode a 90s CacheService heartbeat, so the indicator could be wrong by up to
// 90 seconds (AD-19, amended). The HAZARD in that removal is that presence
// piggybacked its heartbeat on `lastSeenSeq` — the same value that drives
// unread counts and the dashboard bubbles. Unread is a SEPARATE feature and
// must keep working. These assertions are the guard.
console.log('\n[7] Presence removed; unread counting intact…');
const transport = mods['chatTransport'];

// 7a. The presence surface is gone from both modules.
assert(chat.presenceList === undefined, 'chat.js no longer exports presenceList()');
assert(chat.seenByCount === undefined, 'chat.js no longer exports seenByCount()');
assert(transport.heartbeat === undefined, 'chatTransport.js no longer exports heartbeat() (AD-16: transport is the only backend seam)');
assert(chat.chatStatus().presence === undefined, 'chatStatus() no longer carries a presence array');

const chatSrc = await readFile(new URL('./js/chat.js', import.meta.url), 'utf8');
const code = l => !/^\s*(\/\/|\*|\/\*)/.test(l);          // ignore the removal-rationale comments
const chatCode = chatSrc.split('\n').filter(code).join('\n');
assert(!/startPresence|presenceTimer|S\.seenMap|S\.presence\b/.test(chatCode),
  'chat.js carries no presence timer or presence state');
assert(!/\bheartbeat\b/.test(chatCode), 'chat.js no longer imports or calls heartbeat()');
assert(/removeItem\('cfbp_chat_seenmap'\)/.test(chatCode) && !/setItem\('cfbp_chat_seenmap'/.test(chatCode),
  'the orphaned cfbp_chat_seenmap key is cleaned up, never written');

const uiCode = chatUiSrc.split('\n').filter(code).join('\n');
assert(!/presenceList|seenByCount|chat-seen|here now/.test(uiCode),
  'chat-ui.js renders no presence line and no "seen by k" receipt');
// UN-67: SCRIBE's member framing was concatenated onto the presence line. It is
// static copy, not presence-derived, and must survive the removal.
//
// v0.17.4 (UN-104) narrowed this guard, not deleted it (§5 "a tripwire that
// starts crying wolf gets narrowed, never deleted"): the header subtitle that
// used to carry the LITERAL string "SCRIBE on duty" is gone — UN-104 dropped
// it to compact the header to one line. The underlying UN-67 requirement
// (SCRIBE reads as a standing member, not a summoned bot) is unchanged and
// was verified (per the design input) to survive in the empty-room state
// ("SCRIBE is on duty.") before the subtitle was removed. §[23] adds the
// second surviving instance (the Rules FAQ) as its own guard.
assert(/SCRIBE (on duty|is on duty)/.test(uiCode), 'UN-67: SCRIBE "on duty" framing survives (now via the empty-room state, not the removed header subtitle)');

const cssSrc = await readFile(new URL('./css/styles.css', import.meta.url), 'utf8');
assert(!/\.chat-seen\b/.test(cssSrc), 'read-receipt CSS (.chat-seen) removed');

// v0.17.2: the .chat-pill tap target was ~28-30px, under the 40px floor
// (CONVENTIONS #17). This was the one PRE-EXISTING defect fixed in batch 2 and
// it was the only change shipping without an assertion. Applies to every pill
// in the row, not just the newly-labelled Records pill.
const pillRule = (cssSrc.match(/\.chat-pill\s*\{[^}]*\}/) || [''])[0];
const pillMinH = (pillRule.match(/min-height:\s*(\d+)px/) || [])[1];
assert(Number(pillMinH) >= 40,
  `.chat-pill tap target >= 40px (CONVENTIONS #17) — got ${pillMinH || 'no min-height'}`);


// 7b. Unread counting end-to-end — the thing most likely to break.
// Section [2] covers unreadCount against a fixture; this covers the full
// read-position LIFECYCLE (getLastSeen → markSeen → new arrivals), which is
// what actually shared state with the deleted heartbeat.
const { markSeen, getLastSeen } = chat;
assert(typeof markSeen === 'function' && typeof getLastSeen === 'function' && typeof unreadCount === 'function',
  'unread machinery (getLastSeen / markSeen / unreadCount) still exported');

_resetForTest();
localStorage.removeItem('cfbp_chat_lastseen2');
ingest(LOG);                                     // head → 13
assert(unreadCount('p9', 'all') === 4, 'unread from a clean read-position: 4 notifying messages');

markSeen('all');
assert(getLastSeen().seq === 13, 'markSeen("all") advances the device-local read position to head');
assert(unreadCount('p9', 'all') === 0, 'unread clears to zero after markSeen — no heartbeat required');

ingest([ev({ id: 'm6', seq: 14, ts: 14000, body: 'after the mark', author: 'p2' })]);
assert(unreadCount('p9', 'all') === 1, 'a message arriving after markSeen counts as unread again');

ingest([ev({ id: 'm7', seq: 15, ts: 15000, body: 'tagged, after the mark', author: 'p3', gameTag: 'g1' })]);
assert(unreadCount('p9', 'g1') === 1, 'per-tag unread still tracks its own read position');
markSeen('g1');
assert(unreadCount('p9', 'g1') === 0, 'markSeen(tag) clears only that tag');
assert(unreadCount('p9', 'all') === 2, 'clearing one tag does not clear the room-wide count (dashboard bubble intact)');
localStorage.removeItem('cfbp_chat_lastseen2');

// ── 8. THE PICK REVEAL RITUAL — shorthand in the permanent log ───────────────
// The reveal event is written ONCE per week under a deterministic id
// (`sys_reveal_<weekId>`) into an append-only, idempotent log. Whatever text it
// carries is FROZEN — a wrong abbreviation there can never be re-emitted. That
// makes shorthand correctness in this one emitter a higher bar than anywhere
// else in the app.
//
// The defect this section pins down: chat-ui.js still carried the retired
// `name.split(' ').pop()` heuristic at two sites, one of them inside
// emitPickRevealEvent. On a slate with both "Arkansas State" and "Ohio State"
// every reader saw "State · State" and could not tell which team was picked.
console.log('\n[8] Pick reveal ritual — frozen-log shorthand + vocabulary…');
const storage = mods['storage'];
const chatUi = mods['chat-ui'];

// 8a. The literal reported failure. "Southern California" is ESPN's long-form
// location for USC; the dashboard said USC and chat said something else.
assert(typeof dm.teamAbbr === 'function', 'teamAbbr exported from data-model.js');
assert(dm.teamAbbr('Southern California') === 'USC',
  `teamAbbr('Southern California') → USC (got "${dm.teamAbbr('Southern California')}")`);
// Same string through the slate-aware path the renderers actually use.
assert(dm.buildAbbrMap([{ homeTeam: 'Southern California', awayTeam: 'Texas' }]).get('Southern California') === 'USC',
  'buildAbbrMap resolves "Southern California" → USC too (one table, both entry points)');

// 8b. Two "State" schools on one slate must never collapse to one shorthand.
const stateSlate = dm.buildAbbrMap([
  { homeTeam: 'Ohio State', awayTeam: 'Texas' },
  { homeTeam: 'Arkansas State', awayTeam: 'Southern California' },
]);
assert(stateSlate.get('Ohio State') !== stateSlate.get('Arkansas State'),
  'Arkansas State and Ohio State get DIFFERENT shorthand on the same slate');
assert(stateSlate.get('Ohio State') !== 'State' && stateSlate.get('Arkansas State') !== 'State',
  'neither "State" school degrades to the bare word "State"');

// 8c. Source guard — the split-on-space team heuristic may not come back.
// Deliberately narrow: matches only `.split(' ').pop()` (a split on one literal
// space immediately reduced to its last word), which is the shorthand heuristic
// and nothing else. Does not fire on .split('\n'), .split(/\s+/), .split(',').
const splitPop = chatUiSrc.split('\n')
  .filter(l => code(l) && /\.split\((['"]) \1\)\s*\.pop\(\)/.test(l));
assert(splitPop.length === 0,
  `chat-ui.js has no split-on-space team-shorthand heuristic${splitPop.length ? ' — found: ' + splitPop[0].trim() : ''}`);

// 8d. UN-77 — "order(s)" is retired vocabulary. Picks are PICKS (docs/SCRIBE.md).
//
// v0.17.2: this guard originally covered only chat-ui.js, and VT-77 in the
// ledger scoped its grep to scribeLines.js alone. That gap is exactly why two
// live instances survived a ✅ in emitPickRevealEvent, and why the SINGULAR
// "Order busted at the gun." survived in scribeLines.js. The sweep now covers
// every module and both forms.
//
// Scoped to STRING LITERALS only. Identifiers like `dashboardColumnOrder` and
// `const order = …` are sort order, not league vocabulary — matching those
// would make this guard cry wolf until someone deleted it.
const VOCAB_FILES = ['chat-ui.js', 'chat.js', 'scribeLines.js', 'recap.js', 'app.js', 'extra-point.js'];
const STRING_LITERAL = /'([^'\\]|\\.)*'|"([^"\\]|\\.)*"|`([^`\\]|\\.)*`/g;
const ordersHits = [];
for (const f of VOCAB_FILES) {
  const src = await readFile(new URL(`./js/${f}`, import.meta.url), 'utf8');
  src.split('\n').forEach((l, i) => {
    if (!code(l)) return;                            // skip comments
    for (const lit of l.match(STRING_LITERAL) || []) {
      if (/\border(s)?\b/i.test(lit)) ordersHits.push(`${f}:${i + 1} ${lit.trim().slice(0, 60)}`);
    }
  });
}
assert(ordersHits.length === 0,
  `UN-77: no "order/orders" copy survives in any module${ordersHits.length ? ' — found: ' + ordersHits[0] : ''}`);

// 8e. End-to-end through the real emitter. This is the assertion that actually
// exercises the frozen log: seed a locked week whose slate carries both "State"
// schools plus USC's long-form name, emit the reveal, read the event body back
// out of the fold, and require the picked teams to be distinguishable.
const RW = {
  weekId: 'rg_reveal_wk', weekNumber: 99, season: 2026, status: 'live',
  dataSourceMode: 'demo', startDate: '2026-09-05', endDate: '2026-09-05',
};
storage.saveWeek(RW);
storage.saveGame({ weekId: RW.weekId, gameId: 'rg_g1', homeTeam: 'Ohio State',     awayTeam: 'Texas',               kickoff: '2026-09-05T16:00:00Z', status: 'scheduled' });
storage.saveGame({ weekId: RW.weekId, gameId: 'rg_g2', homeTeam: 'Arkansas State', awayTeam: 'Southern California', kickoff: '2026-09-05T20:00:00Z', status: 'scheduled' });
storage.addPlayer({ playerId: 'rg_p1', displayName: 'RevealTester', active: true });
storage.saveAllPicks([
  { pickId: 'rg_pk1', weekId: RW.weekId, gameId: 'rg_g1', playerId: 'rg_p1', selectedTeam: 'Ohio State' },
  { pickId: 'rg_pk2', weekId: RW.weekId, gameId: 'rg_g2', playerId: 'rg_p1', selectedTeam: 'Arkansas State' },
]);

// UN-116 — the reveal now fires at LIVE, not at lock. Drew chose to keep the
// dashboard blind until kickoff and move the ritual to match, rather than
// loosen the dashboard, so the room never publishes what the dashboard hides.
// The negative case is asserted FIRST, against a locked week, because that is
// the direction that leaks: a reveal event is written under a deterministic id
// into an append-only log, so an early emit is permanent and uncorrectable.
{
  const LOCKED_RW = { ...RW, weekId: 'rg_reveal_locked', status: 'locked' };
  storage.saveWeek(LOCKED_RW);
  storage.saveGame({ weekId: LOCKED_RW.weekId, gameId: 'rg_lg1', homeTeam: 'Ohio State', awayTeam: 'Texas', kickoff: '2026-09-05T16:00:00Z', status: 'scheduled' });
  storage.saveAllPicks([
    ...storage.getPicks(),
    { pickId: 'rg_lpk1', weekId: LOCKED_RW.weekId, gameId: 'rg_lg1', playerId: 'rg_p1', selectedTeam: 'Ohio State' },
  ]);
  assert(storage.getEffectiveWeekStatus(storage.getWeek(LOCKED_RW.weekId)) === 'locked',
    'fixture check: the negative-case week really is LOCKED');
  assert(storage.arePicksPublic(storage.getWeek(LOCKED_RW.weekId)) === false,
    'a LOCKED week is NOT public — picks stay blind through the lock window (UN-116)');
  chatUi.emitPickRevealEvent(storage.getWeek(LOCKED_RW.weekId));
  assert(!getMessage(`sys_reveal_${LOCKED_RW.weekId}`),
    'the reveal ritual REFUSES to fire on a locked week — it would permanently publish every pick before kickoff');
}

assert(storage.getEffectiveWeekStatus(storage.getWeek(RW.weekId)) === 'live',
  'reveal fixture week is LIVE (the blind rule permits the reveal)');
assert(storage.arePicksPublic(storage.getWeek(RW.weekId)) === true,
  'a LIVE week IS public — this is the moment the picks are revealed everywhere at once');

chatUi.emitPickRevealEvent(storage.getWeek(RW.weekId));
const revealMsg = getMessage(`sys_reveal_${RW.weekId}`);
assert(!!revealMsg, 'reveal event lands in the log under its deterministic id');

const revealLine = (revealMsg?.body || '').split('\n').find(l => l.startsWith('RevealTester'));
const revealParts = (revealLine || '').split(': ')[1]?.split(' · ') || [];
assert(revealParts.length === 2, `reveal row carries one cell per game (got ${revealParts.length})`);
assert(revealParts[0] !== revealParts[1],
  `reveal row keeps Ohio State and Arkansas State DISTINCT — got "${revealParts.join(' · ')}"`);
assert(!revealParts.includes('State'),
  `no reveal cell is the bare word "State" — got "${revealParts.join(' · ')}"`);
// Distinctness alone would still pass if the map lookup broke entirely and fell
// through to the full team name — "Ohio State" and "Arkansas State" are also
// distinct. Assert the cells are actually SHORTHAND, so a silent regression to
// full names is caught too.
assert(revealParts.every(p => p.length <= 5 && !/\s/.test(p)),
  `reveal cells are shorthand, not full team names — got "${revealParts.join(' · ')}"`);
assert(!/\borders\b/i.test(revealMsg?.body || '') && !/\borders\b/i.test(revealMsg?.meta?.title || ''),
  `UN-77: emitted reveal event says picks, not orders — title "${revealMsg?.meta?.title || ''}"`);

// 8g. The abbr memo is a WITHIN-PASS cache. It must be cleared at the top of
// every render entry point that can reach gameShort — renderChatPage,
// renderPillsOnly, renderSheetMessages. A missed clear serves stale shorthand
// after the commissioner edits a slate mid-session. The harness stubs
// getElementById to null, so those functions early-return before the clear and
// cannot be exercised behaviorally here; this is a source-level tripwire on the
// invariant instead.
const clearCount = (chatUiSrc.match(/_abbrMemo\.clear\(\)/g) || []).length;
assert(clearCount === 3,
  `_abbrMemo cleared at all 3 render entry points (found ${clearCount})`);

// The blind rule is not weakened by any of the above: an OPEN week emits nothing.
const OPEN_W = { ...RW, weekId: 'rg_open_wk', status: 'open' };
storage.saveWeek(OPEN_W);
storage.saveGame({ weekId: OPEN_W.weekId, gameId: 'rg_g3', homeTeam: 'Ohio State', awayTeam: 'Texas', kickoff: '2026-09-05T16:00:00Z', status: 'scheduled' });
chatUi.emitPickRevealEvent(storage.getWeek(OPEN_W.weekId));
assert(!getMessage(`sys_reveal_${OPEN_W.weekId}`),
  'BLIND RULE: no reveal event is emitted while the week is still open');

// ── 9. Debt-payment approval (UN-8x) — state machine + ob2025 migration ──────
console.log('\n[9] Debt-payment approval — state machine + ob2025 migration…');
const ob2025Status = mods['history-2025'].ob2025Status;

// 9a. ob2025 boolean→status migration. THIS IS THE DANGEROUS ONE: a legacy
// `true` (every "Mark Paid" click before this batch) MUST still read as
// 'paid', or previously-settled 2K25 drinks silently revert to unpaid.
assert(ob2025Status({}, 'x') === 'unpaid', 'ob2025Status: an absent key reads as unpaid');
assert(ob2025Status({ x: true }, 'x') === 'paid',
  'ob2025Status: LEGACY BOOLEAN true still reads as paid (the backward-compat guarantee)');
assert(ob2025Status({ x: 'pending' }, 'x') === 'pending', "ob2025Status: 'pending' round-trips");
assert(ob2025Status({ x: 'paid' }, 'x') === 'paid', "ob2025Status: 'paid' round-trips");
assert(ob2025Status({ x: false }, 'x') === 'unpaid', 'ob2025Status: false (never a real stored value) still reads as unpaid, not paid');

// 9b. DEFAULT_SETTINGS default-when-missing story for the debt machine's sibling
// feature — chatRetentionDays defaults OFF so old settings blobs still work.
assert(dm.DEFAULT_SETTINGS.chatRetentionDays === 0,
  'DEFAULT_SETTINGS.chatRetentionDays defaults to 0 (off) — old settings blobs without the field still work');

// 9c. The obligation state machine (pure, data-model.js) — every case in the spec.
const { obligationNextStatus, obligationRole, obligationStatusDisplay } = dm;
assert(obligationNextStatus('unpaid', 'payer', 'mark') === 'pending',
  'payer marks paid from unpaid → pending (needs confirmation)');
assert(obligationNextStatus('unpaid', 'creditor', 'mark') === 'paid',
  "creditor's own mark from unpaid → paid directly (their action IS the verification)");
assert(obligationNextStatus('unpaid', 'admin', 'mark') === 'paid',
  'commissioner marks paid from unpaid → paid directly, no pending');
assert(obligationNextStatus('pending', 'creditor', 'confirm') === 'paid', 'creditor confirms a pending claim → paid');
assert(obligationNextStatus('pending', 'admin', 'confirm') === 'paid', 'commissioner confirms a pending claim → paid');
assert(obligationNextStatus('pending', 'creditor', 'deny') === 'unpaid', 'creditor denies a pending claim → unpaid');
assert(obligationNextStatus('pending', 'admin', 'deny') === 'unpaid', 'commissioner denies a pending claim → unpaid');
assert(obligationNextStatus('paid', 'admin', 'undo') === 'unpaid', 'commissioner undo from paid → unpaid (pre-existing affordance, unchanged)');
// Illegal transitions refuse outright — they never guess at a status.
assert(obligationNextStatus('unpaid', 'bystander', 'mark') === null, 'a bystander cannot mark an obligation paid');
assert(obligationNextStatus('pending', 'payer', 'confirm') === null, "the payer can't confirm their own pending claim");
assert(obligationNextStatus('pending', 'payer', 'deny') === null, "the payer can't deny their own pending claim");
assert(obligationNextStatus('paid', 'creditor', 'undo') === null, 'only the commissioner can undo a paid obligation');

// 9d. obligationRole priority: admin > creditor > payer > bystander.
const obFixture = { payerPlayerId: 'pay1', recipientPlayerId: 'rec1' };
assert(obligationRole({ isAdmin: true, playerId: 'pay1' }, obFixture) === 'admin', 'admin role wins even when also the payer');
assert(obligationRole({ isAdmin: false, playerId: 'rec1' }, obFixture) === 'creditor', 'the recipient reads as creditor');
assert(obligationRole({ isAdmin: false, playerId: 'pay1' }, obFixture) === 'payer', 'the payer reads as payer');
assert(obligationRole({ isAdmin: false, playerId: 'nobody' }, obFixture) === 'bystander', 'everyone else is a bystander');

// 9e. Status → display mapping reuses existing badge classes only (spec: no
// new CSS variable, no theme-survival risk) and never prints the raw string.
assert(obligationStatusDisplay('pending').badgeClass === 'badge-nd', 'pending → badge-nd (the existing no-decision tan)');
assert(obligationStatusDisplay('unpaid').badgeClass === 'badge-locked', 'unpaid → badge-locked');
assert(obligationStatusDisplay('paid').badgeClass === 'badge-open', 'paid → badge-open');
assert(obligationStatusDisplay('waived').badgeClass === 'badge-final', 'waived → badge-final (unaffected by this batch)');
assert(obligationStatusDisplay('pending').label === 'Pending', 'status maps to a human label, not the raw lowercase string');

// 9f. exportObligationsCSV must emit 'pending' distinctly from unpaid/paid —
// the whole point of the export is the commissioner's audit trail.
const { buildObligationsCsvRows } = mods['app'];
const csvObs = [
  { obligationId: 'o1', type: 'weekly', weekId: null, payerPlayerId: 'p1', recipientPlayerId: 'p2', amountOrPrize: '1 drink', status: 'unpaid', createdAt: '', paidAt: '' },
  { obligationId: 'o2', type: 'weekly', weekId: null, payerPlayerId: 'p1', recipientPlayerId: 'p2', amountOrPrize: '1 drink', status: 'pending', createdAt: '', paidAt: '' },
  { obligationId: 'o3', type: 'weekly', weekId: null, payerPlayerId: 'p1', recipientPlayerId: 'p2', amountOrPrize: '1 drink', status: 'paid', createdAt: '', paidAt: '' },
];
const csvRows = buildObligationsCsvRows(csvObs, { p1: 'A', p2: 'B' }, {});
const statusCol = csvRows.slice(1).map(r => r[6]);
assert(statusCol.includes('pending') && statusCol.includes('unpaid') && statusCol.includes('paid'),
  `CSV Status column carries all three states distinctly (got ${JSON.stringify(statusCol)})`);
assert(new Set(statusCol).size === 3, 'pending is never folded into unpaid or paid in the CSV export');

// ── 10. Chat retention (UN-8x) — client-side hide, reversible, unread-safe ───
console.log('\n[10] Chat retention — hide-only, pinned exempt, unread excludes hidden…');
chat._resetForTest();                              // clean slate — earlier sections left messages in S.items
storage.saveSetting('chatRetentionDays', 0);

assert(chat.getRetentionDays() === 0, 'retention starts OFF with no setting written (default-when-missing)');
assert(chat.isHiddenByRetention({ ts: Date.now() - 999 * 86400000 }) === false,
  'OFF means nothing is ever hidden, no matter how old');

const RT_NOW = Date.now();
const RT_OLD = RT_NOW - 10 * 86400000;              // 10 days old — outside a 7-day window
const RT_RECENT = RT_NOW - 1 * 86400000;            // 1 day old — inside the window

storage.saveSetting('chatRetentionDays', 7);
assert(chat.getRetentionDays() === 7, 'getRetentionDays reads the synced setting through the storage seam');

chat.ingest([
  ev({ id: 'rt1', seq: 101, ts: RT_OLD, body: 'old, unpinned', author: 'p1' }),
  ev({ id: 'rt2', seq: 102, ts: RT_OLD, body: 'old, pinned', author: 'p1' }),
  ev({ id: 'rt3', seq: 103, ts: RT_RECENT, body: 'recent', author: 'p1' }),
]);
chat.ingest([{ id: 'rt2pin', type: 'pin', targetId: 'rt2', author: 'p1', notify: false }]);
assert(chat.getMessage('rt2').pinned === true, 'fixture check: rt2 is actually pinned before trusting the exemption below');

assert(chat.isHiddenByRetention(chat.getMessage('rt1')) === true, 'a message older than the window IS hidden');
assert(chat.isHiddenByRetention(chat.getMessage('rt2')) === false,
  'a PINNED message older than the window stays visible — that is the entire point of pinning');
assert(chat.isHiddenByRetention(chat.getMessage('rt3')) === false, 'a recent message is never hidden');

const rtFiltered = chat.getMessages({ tag: 'all', respectRetention: true }).map(m => m.id);
assert(!rtFiltered.includes('rt1'), 'getMessages({respectRetention:true}) excludes the old unpinned message');
assert(rtFiltered.includes('rt2'), 'getMessages({respectRetention:true}) still includes the old PINNED message');
assert(rtFiltered.includes('rt3'), 'getMessages({respectRetention:true}) still includes the recent message');

// respectRetention is opt-in: non-display callers (the weekly digest, SCRIBE's
// pre-kick lookup) never lose data just because a commissioner turned on a
// rendering preference.
const rtUnfiltered = chat.getMessages({ tag: 'all' }).map(m => m.id);
assert(rtUnfiltered.includes('rt1'), 'without respectRetention, the old message is still readable (digest/SCRIBE unaffected)');

// Hidden messages must NOT contribute to unread counts. rt2 is old but PINNED
// (so it renders and legitimately still notifies) and rt3 is recent — both
// visible, both should count. rt1 is old and hidden — it must not, or a
// player gets a badge promising a message they can never scroll to.
localStorage.setItem('cfbp_chat_lastseen2', JSON.stringify({ seq: 0, byTag: {} }));
const rtUnread = chat.unreadCount('someone_else', 'all');
assert(rtUnread === 2,
  `unread count excludes the hidden old message (rt1) but still counts the visible pinned (rt2) and recent (rt3) ones (got ${rtUnread})`);
localStorage.removeItem('cfbp_chat_lastseen2');

// retentionStats() — feeds the commissioner card's live count line.
const rtStats = chat.retentionStats();
assert(rtStats.enabled === true && rtStats.days === 7, 'retentionStats reflects the active window');
assert(rtStats.hiddenCount === 1, `retentionStats counts exactly the one hidden message (got ${rtStats.hiddenCount})`);
assert(rtStats.protectedCount === 1, `retentionStats counts exactly the one pinned-but-old message as protected (got ${rtStats.protectedCount})`);

// Fully reversible — nothing was ever deleted (Drew's explicit requirement).
storage.saveSetting('chatRetentionDays', 0);
const rtRestored = chat.getMessages({ tag: 'all', respectRetention: true }).map(m => m.id);
assert(rtRestored.includes('rt1'), 'turning retention back OFF immediately restores the hidden message — nothing was deleted');

chat._resetForTest();
storage.saveSetting('chatRetentionDays', 0);

// 10f. Every surface that COUNTS or LINKS TO messages must respect retention,
// not just the rendered stream. Reviewer found three that didn't: the game-card
// 💬 count read "7" and opened to an empty thread, the game filter pills
// rendered for fully-hidden threads, and "↑ load earlier" fired a real backend
// round-trip then rendered nothing under a notice saying "Showing the last 7
// days". A half-respected filter is worse than none — it makes the UI lie.
const chatUiRetSrc = await readFile(new URL('./js/chat-ui.js', import.meta.url), 'utf8');

const bubbleFn = (chatUiRetSrc.match(/export function gameChatBubbleHTML[\s\S]*?\n}/) || [''])[0];
assert(/respectRetention:\s*true/.test(bubbleFn),
  'game-card 💬 count respects retention (count must match what opens)');

const tagsFn = (chatUiRetSrc.match(/function activeGameTags\(\)[\s\S]*?\n}/) || [''])[0];
assert(/respectRetention:\s*true/.test(tagsFn),
  'game filter pills respect retention (no pill for a fully hidden thread)');

// UN-112 widened this condition to ALSO hide the control once the epoch
// blocks further backfill (§[29b] tests that half) — retention's own half
// of the OR still must hold.
assert(/\(retentionOn\(\)\s*\|\|\s*backfillBlockedByEpoch\(\)\)\s*\?\s*''\s*:\s*'<button class="chat-load-older"/.test(chatUiRetSrc),
  '"load earlier" is hidden when retention is on (it would fetch nothing) — now composed with the UN-112 epoch check, not replaced by it');

// 10g. The cutoff is resolved ONCE per unread pass, not per message. Left
// unhoisted this cost ~1.9ms per 800 messages EVEN WITH RETENTION OFF, paid on
// every pill on every poll tick.
const chatRetSrc = await readFile(new URL('./js/chat.js', import.meta.url), 'utf8');
assert(/export function retentionCutoff/.test(chatRetSrc),
  'retentionCutoff() exists so callers can resolve the window once');
const unreadFn = (chatRetSrc.match(/export function unreadCount[\s\S]*?\n}/) || [''])[0];
assert(/const cutoff = retentionCutoff\(\)/.test(unreadFn) && !/isHiddenByRetention\(/.test(unreadFn),
  'unreadCount resolves the cutoff once, outside the per-message loop');

// ── 11. Naming split — "Chat" at entry points, "Locker Room" inside the room ─
console.log('\n[11] Naming split — Chat at entry points, Locker Room inside the room…');
const indexHtmlSrc = await readFile(new URL('./index.html', import.meta.url), 'utf8');
const navChatBlock = (indexHtmlSrc.match(/data-tab="chat">[\s\S]*?<\/button>/) || [''])[0];
assert(/<span>Chat<\/span>/.test(navChatBlock), 'nav: the Chat tab label reads "Chat"');
assert(!/Locker Room/.test(navChatBlock), 'nav: the Chat tab no longer reads "Locker Room"');

// v0.17.4 (UN-104): the header row went from a two-line <h2>Chat</h2> +
// subtitle to one compact line with the UN-101 BETA badge inline in the
// <h2> — narrowed to match, not deleted (the underlying "Chat" naming
// guarantee this row protects is unchanged; see §[23] for the badge itself).
assert(/<h2>Chat\s*<span class="badge badge-beta"/.test(chatUiSrc), 'chat page header reads "Chat" (badge now renders inline in the same <h2>)');
assert(!/<h2>Locker Room<\/h2>/.test(chatUiSrc), 'chat page header no longer reads "Locker Room"');

assert(/dash-chat-title">Chat /.test(chatUiSrc), 'dashboard teaser card TITLE reads "Chat"');
assert(!/dash-chat-title">Locker Room/.test(chatUiSrc), 'dashboard teaser card title no longer reads "Locker Room"');

const appJsSrc = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
assert(/<h3>💬 Chat<\/h3>/.test(appJsSrc), 'Rules section heading reads "💬 Chat"');
assert(!/<h3>💬 The Locker Room<\/h3>/.test(appJsSrc), 'Rules section heading no longer reads "The Locker Room"');

// Everything that describes what's INSIDE the room is deliberately UNCHANGED —
// a partial rename recreates the exact ambiguity this batch set out to fix.
assert(/data-chat-filter="all">Locker Room /.test(chatUiSrc), 'the "all" filter pill still reads "Locker Room" (it IS the room)');
assert(/The Locker Room is open\. SCRIBE is on duty\./.test(chatUiSrc), 'the empty-room state still says "Locker Room"');
assert(/shows in this game's thread and the Locker Room/.test(chatUiSrc), 'the tag-chip help text still says "Locker Room"');
// Batch 3+4 items D+E deliberately RETIRED the teaser's always-on "The Locker
// Room is open." fallback card — item D's spec is explicit: "Zero messages
// ever: show nothing at all... Do NOT show an empty card taking up dashboard
// space." This is a designed behavior change, not a naming regression; see
// section [15] below for the assertion that replaces this one.
assert(!/'The Locker Room is open\.'/.test(chatUiSrc),
  'the dashboard teaser no longer carries a permanent fallback string — item D retired the always-on card (see [15])');
assert(/<strong>One Locker Room\.<\/strong>/.test(appJsSrc), 'Rules body copy still says "One Locker Room"');

// ── 12. Item A — commissioner chat on/off toggle ──────────────────────────────
console.log('\n[12] Item A — commissioner chat on/off toggle…');

assert(dm.DEFAULT_SETTINGS.chatEnabled === true, 'DEFAULT_SETTINGS.chatEnabled defaults to true');

// The literal hazard named in the task: a missing value must NEVER silently
// disable chat. Simulate an OLD settings blob written before this field
// existed (saveSettings is the raw setter — no DEFAULT_SETTINGS spread).
storage.saveSettings({ timezone: 'PT' });
assert(chat.isChatEnabled() === true,
  'chatEnabled defaults to TRUE when the setting is absent from a stored blob (a missing value must not silently disable chat)');

storage.saveSetting('chatEnabled', false);
assert(chat.isChatEnabled() === false, 'isChatEnabled() reflects an explicit false');
storage.saveSetting('chatEnabled', true);
assert(chat.isChatEnabled() === true, 'isChatEnabled() reflects an explicit true');

// Surface 1 — dashboard game-card chat bubble (both matrix AND compact
// renderers call the SAME function, so gating it once covers both).
chat._resetForTest();
chat.ingest([ev({ id: 'a1', seq: 1, ts: 1000, body: 'hello', author: 'p1', gameTag: 'gameA' })]);
storage.saveSetting('chatEnabled', false);
assert(chatUi.gameChatBubbleHTML('gameA') === '',
  'chat OFF: the game-card bubble renders nothing, even with real messages present (surface 1)');
storage.saveSetting('chatEnabled', true);
assert(chatUi.gameChatBubbleHTML('gameA') !== '', 'sanity: the SAME bubble renders something once chat is back on');

// Surface 2 — dashboard teaser card.
storage.saveSetting('chatEnabled', false);
assert(chatUi.dashboardChatTeaserHTML() === '',
  'chat OFF: the dashboard teaser renders nothing, even with a real notifying message present (surface 2)');
storage.saveSetting('chatEnabled', true);
assert(chatUi.dashboardChatTeaserHTML() !== '', 'sanity: the SAME teaser renders something once chat is back on');

// Surfaces 3+4 — the chat page itself and the bottom-nav entry. The DOM stub
// at the top of this harness returns null from getElementById('page-chat')
// and querySelectorAll() returns [], so renderChatPage()'s isChatEnabled()
// guard and navigateTo()'s nav-visibility toggle are UNREACHABLE from this
// harness — renderChatPage() early-returns one line earlier on `!c`
// regardless of enabled state, and there is no fake nav DOM to inspect.
// This is a harness limitation, not something this suite can see through.
// Source-verified instead — both guards demonstrably exist and are wired to
// the SAME window.* bridge already established for the app.js/chat-ui.js
// module boundary (window.navigateTo, used for exactly this since the
// login-prompt feature).
assert(/if \(!isChatEnabled\(\)\) \{ redirectChatDisabled\(\); return; \}/.test(chatUiSrc),
  'renderChatPage() bails out and redirects when chat is disabled (source-verified — DOM-dependent, not exercised by this harness)');
assert(/function redirectChatDisabled/.test(chatUiSrc) && /window\.navigateTo/.test(chatUiSrc) && /window\.showToast/.test(chatUiSrc),
  'the redirect reuses the SAME window.navigateTo/window.showToast bridge, not a new mechanism');
assert(/tab === 'chat' && !isChatEnabled\(\)/.test(appJsSrc),
  "navigateTo() in app.js refuses to land on 'chat' while disabled (source-verified, same harness limitation)");
assert(/function applyChatNavVisibility/.test(appJsSrc) && /nav-item\[data-tab="chat"\]/.test(appJsSrc),
  'a dedicated function toggles the bottom-nav Chat entry\'s visibility (surface 4)');
assert(/function checkChatEnabledLive/.test(appJsSrc) && /setupChatEnabledWatch/.test(appJsSrc),
  'a periodic watch (independent of the score auto-refresh interval, which can be set to Off) catches a mid-session flip and routes a stranded player home');

// THE core hazard, and the one thing in this section that is NOT just source-
// verified: polling must actually STOP, not merely throttle. roomMode()
// returning 'closed' still polls every 60s (INTERVALS.closed in
// chatTransport.js) — that is NOT "stopped", it keeps burning Apps Script
// quota forever. _isPollingActiveForTest() observes the REAL subscription
// state (whether the transport's unsubscribe handle is live), not a proxy.
chat._resetForTest();
storage.saveSetting('chatEnabled', true);
chat.initChat('polltest_p1');
assert(chat._isPollingActiveForTest() === true, 'chat ON: initChat() actually starts the poll subscription');

storage.saveSetting('chatEnabled', false);
chat.refreshChatEnabled();
assert(chat._isPollingActiveForTest() === false,
  'chat OFF: refreshChatEnabled() actually STOPS the subscription — not merely throttles roomMode to "closed"');

storage.saveSetting('chatEnabled', true);
chat.refreshChatEnabled();
assert(chat._isPollingActiveForTest() === true, 'chat re-ON: refreshChatEnabled() resumes polling');

// Data preserved, never deleted — flipping OFF is visibility only. (Fresh
// ingest here, not the 'a1' fixture from earlier in this section — the
// poll-state checks above called _resetForTest(), which intentionally wipes
// S.items too, so re-seed rather than relying on state from before that.)
chat.ingest([ev({ id: 'a9', seq: 1, ts: 1000, body: 'still here', author: 'p1' })]);
storage.saveSetting('chatEnabled', false);
assert(chat.getMessage('a9')?.body === 'still here',
  'chat OFF: existing messages are still readable in memory — visibility only, nothing deleted');
storage.saveSetting('chatEnabled', true);
chat._resetForTest();

// ── 13. Item G — emoji parity: REACTION_PALETTE is the ONE shared source ─────
console.log('\n[13] Item G — emoji parity: REACTION_PALETTE single shared source…');

assert(Array.isArray(dm.REACTION_PALETTE) && dm.REACTION_PALETTE.length >= 15,
  'REACTION_PALETTE exported from data-model.js, at least as large as the old game-reaction set');

// v0.17.4 (UN-103, batch 2): QUICK_EMOJI is RETIRED, not merely re-derived.
// The composer no longer inserts emoji at all (Drew: players use their own
// keyboard) and the message-level always-visible 3-button quick-react row is
// replaced by a single + that opens the FULL palette per message — there is
// no more "always-visible subset" concept left for QUICK_EMOJI to describe.
// Narrowed from asserting correct derivation to asserting clean absence
// (§5 "a tripwire that starts crying wolf gets narrowed, never deleted" —
// here the SUBJECT retired, so the guard now protects against it quietly
// coming back as a second literal, which is the actual AD-20 risk).
// uiCode (comment-stripped, from §[7]) so this doesn't cry wolf on its own
// explanatory comment mentioning the retired identifier by name.
assert(!/\bQUICK_EMOJI\b/.test(uiCode),
  'UN-103: QUICK_EMOJI is retired from chat-ui.js CODE — no always-visible emoji subset remains anywhere (composer inserts nothing; + opens the full REACTION_PALETTE per message)');
assert(!/const REACTION_PALETTE = \[/.test(appJsSrc),
  'app.js no longer carries its own REACTION_PALETTE literal — the second-mapping defect class (AD-20, RG-13)');
const appImportBlock = appJsSrc.match(/^import \{[\s\S]*?\} from '\.\/data-model\.js';/m)?.[0] || '';
assert(/\bREACTION_PALETTE\b/.test(appImportBlock),
  'app.js imports REACTION_PALETTE from data-model.js rather than defining its own');
assert(/\bREACTION_PALETTE\b/.test(chatUiSrc),
  'chat-ui.js still imports/uses the shared REACTION_PALETTE directly (the per-message react picker) — AD-20\'s single source is intact even with QUICK_EMOJI gone');

// The full picker (item G's "picker layout" requirement) reuses the EXISTING
// grid CSS verbatim (app.js's dashboard reaction picker already solved
// 5×3 desktop / 7×3 mobile at 42-44px targets) rather than inventing a
// second layout — the v0.15.1 picker shipped at ~22×22px and had to be
// rebuilt once already. UN-103 moved WHERE this picker is anchored (the
// message, not the composer foot) but not its class names — both still hold.
assert(/picker\.className = 'reaction-picker'/.test(chatUiSrc),
  'the per-message react picker reuses the .reaction-picker class verbatim');
assert(/class="reaction-pick-option"/.test(chatUiSrc),
  'the per-message react picker\'s emoji options reuse the .reaction-pick-option class verbatim');
assert(!/chat-emoji-picker-grid|chat-emoji-picker-cell/.test(cssSrc),
  'no second grid-layout class family was invented for the chat picker');

// ── 14. Item B — bubble unread three-state + attribution ─────────────────────
console.log('\n[14] Item B — bubble unread three-state + attribution…');
chat._resetForTest();
storage.saveSetting('chatEnabled', true);
localStorage.removeItem('cfbp_chat_lastseen2');
// gameChatBubbleHTML() derives "self" from the live session (me() requires
// BOTH playerId and playerVerified), not from an arbitrary id passed around —
// a logged-in viewer is required for unread/attribution to compute at all.
storage.setSession('someone_else', false, true);

// Empty state: no messages for this game at all.
const bubbleEmpty = chatUi.gameChatBubbleHTML('ghost_game');
assert(/chat-bubble-empty/.test(bubbleEmpty), 'no messages at all → the "empty" (most subdued) state');
assert(!/chat-bubble-count/.test(bubbleEmpty), 'empty state carries no count');

// Read state: messages exist, all already read.
chat.ingest([ev({ id: 'b1', seq: 1, ts: 1000, body: 'thread starter', author: 'p1', gameTag: 'gB' })]);
chat.markSeen('all');
const bubbleRead = chatUi.gameChatBubbleHTML('gB');
assert(/chat-bubble-read/.test(bubbleRead), 'zero unread, has messages → the "read" (muted) state');
assert(!/chat-bubble-count/.test(bubbleRead), 'read state shows no count');

// Unread state — THE regression case the spec calls out by name: the bubble
// must show the UNREAD count, not the thread's total message count, in the
// specific case where they DIFFER.
chat.ingest([
  ev({ id: 'b2', seq: 2, ts: 2000, body: 'reply one', author: 'p2', gameTag: 'gB' }),
  ev({ id: 'b3', seq: 3, ts: 3000, body: 'reply two', author: 'p3', gameTag: 'gB' }),
]);
chat.markSeen('gB');                              // catch up to seq 3
chat.ingest([ev({ id: 'b4', seq: 4, ts: 4000, body: 'reply three', author: 'p2', gameTag: 'gB' })]);
const totalInThread = chat.getMessages({ tag: 'gB', types: ['message'] }).length;
assert(totalInThread === 4 && chat.unreadCount('someone_else', 'gB') === 1,
  `fixture check: total (${totalInThread}) and unread (${chat.unreadCount('someone_else', 'gB')}) genuinely differ for this thread`);
const bubbleUnread = chatUi.gameChatBubbleHTML('gB');
assert(/chat-bubble-unread/.test(bubbleUnread), 'has unread → the "unread" (prominent) state');
assert(/chat-bubble-count">1</.test(bubbleUnread),
  `the bubble shows the UNREAD count (1), not the thread total (4) — got "${bubbleUnread}"`);

// Three DISTINCT, mutually-exclusive state classes.
const bubbleStates = ['chat-bubble-unread', 'chat-bubble-read', 'chat-bubble-empty'];
assert(bubbleStates.filter(s => bubbleUnread.includes(s)).length === 1, 'exactly one state class on the unread bubble');
assert(bubbleStates.filter(s => bubbleRead.includes(s)).length === 1, 'exactly one state class on the read bubble');
assert(bubbleStates.filter(s => bubbleEmpty.includes(s)).length === 1, 'exactly one state class on the empty bubble');

// Attribution — the chosen answer (option 2 of the spec's three acceptable
// answers): `title` for desktop hover PLUS the SAME text in `aria-label` so
// it's reachable via assistive tech on any device, not just desktop hover.
assert(/title="[^"]*"/.test(bubbleUnread) && /aria-label="[^"]*"/.test(bubbleUnread),
  'both title (desktop hover) and aria-label (assistive tech, any device) are present');
const bubbleTitleTxt = (bubbleUnread.match(/title="([^"]*)"/) || [])[1];
const bubbleAriaTxt = (bubbleUnread.match(/aria-label="([^"]*)"/) || [])[1];
assert(!!bubbleTitleTxt && bubbleTitleTxt === bubbleAriaTxt,
  'title and aria-label carry IDENTICAL attribution text (no desktop-only information)');
assert(/unread from p2/.test(bubbleTitleTxt || ''),
  `attribution names WHO the unread is from, not just a count — got "${bubbleTitleTxt}"`);
localStorage.removeItem('cfbp_chat_lastseen2');
storage.clearSession();

// ── 15. Items D+E — dashboard teaser: dismissible ambient, no quick-reply ────
console.log('\n[15] Items D+E — dashboard teaser: dismissible ambient, no quick-reply…');
chat._resetForTest();
storage.saveSetting('chatEnabled', true);
localStorage.removeItem('cfbp_chat_teaser_dismiss_seq');

assert(chatUi.dashboardChatTeaserHTML() === '', 'zero messages ever: the teaser renders nothing (no empty card)');

chat.ingest([ev({ id: 'd1', seq: 1, ts: 1000, body: 'first message', author: 'p1' })]);
const teaser1 = chatUi.dashboardChatTeaserHTML();
assert(teaser1 !== '', 'a real notifying message makes the teaser render');
assert(/data-teaser-seq="1"/.test(teaser1), 'the teaser stamps its own seq (not a boolean) for dismissal tracking');

// Dismiss — device-local, via lsSet, storing the SEQ.
const teaserSeqMatch = teaser1.match(/data-teaser-seq="(\d+)"/);
localStorage.setItem('cfbp_chat_teaser_dismiss_seq', teaserSeqMatch[1]);
assert(chatUi.dashboardChatTeaserHTML() === '', 'dismissed: stays dismissed for the SAME message');

// Only a strictly HIGHER seq counts as new activity (spec's own definition) —
// prove this is a real number comparison, not a boolean flag.
assert(chatUi.dashboardChatTeaserHTML() === '', 'still dismissed a second time with no new activity (idempotent)');
chat.ingest([ev({ id: 'd2', seq: 2, ts: 2000, body: 'second message', author: 'p2' })]);
const teaser2 = chatUi.dashboardChatTeaserHTML();
assert(teaser2 !== '', 'reappears for genuinely new activity since dismissal (a HIGHER seq)');
assert(/data-teaser-seq="2"/.test(teaser2), 'the reappeared card stamps the NEW latest seq');

// Chat disabled overrides everything, dismissed or not.
storage.saveSetting('chatEnabled', false);
assert(chatUi.dashboardChatTeaserHTML() === '', 'chat disabled: the teaser never renders, dismissed or not');
storage.saveSetting('chatEnabled', true);

// E — the quick-reply input is GONE. Source guard so it can never creep back
// (this is exactly the kind of thing that quietly returns during a later
// unrelated edit if there's no tripwire).
assert(!/dash-quick-input/.test(chatUiSrc) && !/dash-quick-send/.test(chatUiSrc) && !/Quick reply…/.test(chatUiSrc),
  'item E: no quick-reply input/send-button/placeholder survives anywhere in chat-ui.js');
assert(!/\.dash-chat-quick\b/.test(cssSrc) && !/\.dash-chat-input\b/.test(cssSrc),
  'item E: no .dash-chat-quick/.dash-chat-input CSS survives');
assert(/dash-chat-dismiss/.test(chatUiSrc) && /dash-chat-dismiss/.test(cssSrc),
  'item D: a dedicated ✕ dismiss control exists in both markup and CSS (distinct from the open-chat tap area)');
localStorage.removeItem('cfbp_chat_teaser_dismiss_seq');

// ── 16. Item F — game thread header colors: static, dashboard-mirrored ───────
console.log('\n[16] Item F — game thread header colors: static, dashboard-mirrored…');

// The window.* bridge is REAL and testable: app.js's module-level code
// assigns this as a side effect of being imported in section [1].
assert(typeof globalThis.livePickStatus === 'function',
  'window.livePickStatus is exposed by app.js for chat-ui.js to reuse verbatim');
assert(!/const adj = game\.homeScore \+ sv/.test(chatUiSrc),
  'chat-ui.js does not re-derive covering/trailing math — no second implementation');
assert(/window\.livePickStatus/.test(chatUiSrc),
  'chat-ui.js calls the SAME function the dashboard uses, not a reimplementation');

assert(/gameThreadHeaderClass\(myHeaderPick, g\)/.test(chatUiSrc) && /chat-sheet-header\$\{headerCls\}/.test(chatUiSrc),
  'the bottom-sheet header applies the computed color class');
assert(/gameThreadHeaderClass\(myViewPick, g\)/.test(chatUiSrc) && /chat-view-header\$\{headerCls\}/.test(chatUiSrc),
  'the main chat page\'s game-filter header applies the SAME computed color class (both render paths stay consistent)');

// HARD REQUIREMENT: static only. None of the five thread-header classes may
// carry an `animation` property — that is the pulsing dashboard classes' job.
['chat-thread-covering', 'chat-thread-trailing', 'chat-thread-even', 'chat-thread-won', 'chat-thread-lost'].forEach(cls => {
  const rule = (cssSrc.match(new RegExp(`\\.${cls}\\s*\\{[^}]*\\}`)) || [''])[0];
  assert(rule.length > 0, `.${cls} is defined in styles.css`);
  assert(!/animation/.test(rule), `.${cls} carries NO animation property (static-only hard requirement) — got "${rule}"`);
});

// The spread stays on the sheet header — batch 1 removed it from message
// CHIPS specifically because the header already carries it; don't remove it
// twice and leave nowhere the spread shows in that view.
assert(/chat-sheet-sub">\$\{g \? esc\(formatSpread/.test(chatUiSrc),
  'the bottom-sheet header still shows the spread (only message chips dropped it, per batch 1)');

// ── 17. Item C — read marking: per-tag cursors while reading the Locker Room ─
console.log('\n[17] Item C — read marking: per-tag cursors advance while reading the Locker Room…');
chat._resetForTest();
localStorage.removeItem('cfbp_chat_lastseen2');

chat.ingest([
  ev({ id: 'c1', seq: 1, ts: 1000, body: 'untagged', author: 'p1' }),
  ev({ id: 'c2', seq: 2, ts: 2000, body: 'tagged gameA', author: 'p2', gameTag: 'gameA' }),
  ev({ id: 'c3', seq: 3, ts: 3000, body: 'tagged gameB', author: 'p3', gameTag: 'gameB' }),
]);
assert(chat.unreadCount('viewer', 'gameA') === 1, 'fixture: gameA has 1 unread before reading');
assert(chat.unreadCount('viewer', 'gameB') === 1, 'fixture: gameB has 1 unread before reading');

// Reading the Locker Room (filter === 'all') calls markSeen('all') — the same
// call renderChatPage()'s 1s-dwell timer makes.
chat.markSeen('all');
assert(chat.unreadCount('viewer', 'gameA') === 0,
  'reading the Locker Room clears a NEVER-directly-visited tag\'s bubble (gameA) — the exact scenario the spec names by example (a BAMA/LSU message read in the main room)');
assert(chat.unreadCount('viewer', 'gameB') === 0,
  'reading the Locker Room clears a second never-visited tag in the same pass (gameB)');

// The "already tracked" branch: visit gameA directly once (its own per-tag
// cursor now exists), a NEW gameA message arrives, then read the room again —
// the ALREADY-tracked cursor must ALSO advance, not stay pinned at its old
// value (which would make the bubble show unread forever after the first
// direct visit, even while reading the room).
chat.ingest([ev({ id: 'c4', seq: 4, ts: 4000, body: 'gameA #2', author: 'p2', gameTag: 'gameA' })]);
chat.markSeen('gameA');
assert(chat.unreadCount('viewer', 'gameA') === 0, 'fixture: directly visiting gameA clears it');
chat.ingest([ev({ id: 'c5', seq: 5, ts: 5000, body: 'gameA #3', author: 'p2', gameTag: 'gameA' })]);
assert(chat.unreadCount('viewer', 'gameA') === 1, 'fixture: a new gameA message after that direct visit is unread again');
chat.markSeen('all');
assert(chat.unreadCount('viewer', 'gameA') === 0,
  'reading the room again ALSO advances the already-tracked gameA cursor, not just never-visited tags');

// Monotonicity — the cursor can never regress.
const seqAfterFirstMark = chat.getLastSeen().seq;
chat.markSeen('all');                             // calling it again with no new head advance
assert(chat.getLastSeen().seq === seqAfterFirstMark,
  'the read cursor never regresses — marking seen again with no new activity leaves it unchanged, not rolled back');
chat.ingest([ev({ id: 'c6', seq: 6, ts: 6000, body: 'one more', author: 'p2' })]);
chat.markSeen('all');
assert(chat.getLastSeen().seq === 6 && chat.getLastSeen().seq > seqAfterFirstMark,
  'the read cursor advances monotonically forward as new messages arrive and get read');
localStorage.removeItem('cfbp_chat_lastseen2');

// 17b. COLD-LOAD REGRESSION — the read cursor must never move backward.
//
// markSeen() assigned S.head unconditionally. S.head is 0 until the first poll
// returns, and Apps Script cold starts run 10-20s (ledger §5) while the chat
// mark timer fires at 1s. So: open the app, tap Chat during the cold start,
// back out — cursor is now 0. Every message you already read counts as unread
// again, and with item B every game bubble lights up filled-maroon claiming
// unread the player cleared yesterday.
//
// The original item-C assertions tested the FORWARD direction only, which
// passes trivially because S.head never moves in a fixture. Ledger §5:
// "a green test on an input adjacent to the defect proves nothing."
console.log('\n[17b] Read cursor never regresses (cold load, S.head=0)…');
_resetForTest();
localStorage.removeItem('cfbp_chat_lastseen2');

// Session 1: a real read position, established after a healthy poll.
ingest([
  ev({ id: 'cold1', seq: 500, ts: 5000, body: 'read yesterday' }),
  ev({ id: 'cold2', seq: 500, ts: 5000, gameTag: 'gBAMA', body: 'also read', author: 'p2' }),
]);
markSeen('all');
markSeen('gBAMA');                     // explicitly track the tag, so byTag has a real entry
const beforeCold = JSON.parse(localStorage.getItem('cfbp_chat_lastseen2') || '{}');
assert(beforeCold.seq === 500, `session 1 establishes a read position (got ${beforeCold.seq})`);
assert(beforeCold.byTag?.gBAMA === 500, `session 1 tracks the per-tag cursor (got ${beforeCold.byTag?.gBAMA})`);

// Session 2: fresh page load. Fold is empty, S.head is back to 0, no poll yet.
// The 1s mark timer fires anyway because the player opened Chat.
_resetForTest();
markSeen('all');
const afterCold = JSON.parse(localStorage.getItem('cfbp_chat_lastseen2') || '{}');

assert(afterCold.seq >= 500,
  `cold load does NOT regress the room cursor — was 500, now ${afterCold.seq}`);
// The EFFECTIVE per-tag cursor is `byTag[tag] ?? seq` — an untracked tag
// legitimately inherits the room cursor, so assert the effective value, not the
// raw map entry.
const effGBAMA = afterCold.byTag?.gBAMA ?? afterCold.seq ?? 0;
assert(effGBAMA >= 500,
  `cold load does NOT regress the per-tag cursor — was 500, now ${effGBAMA}`);

// And the consequence the player actually feels: no phantom unread.
ingest([
  ev({ id: 'cold3', seq: 501, ts: 6000, gameTag: 'gBAMA', body: 'genuinely new', author: 'p2' }),
]);
assert(unreadCount('p1', 'gBAMA') === 1,
  `only genuinely new messages count as unread after a cold load (got ${unreadCount('p1', 'gBAMA')})`);
localStorage.removeItem('cfbp_chat_lastseen2');

// 17c. CSS cascade + tap-target guards for the three review findings that
// source-presence assertions could not see. §[16] asserted the thread-color
// CLASS was applied and passed while the cascade silently discarded it.
console.log('\n[17c] Review fixes — cascade, badges, tap targets…');
const cssFix = await readFile(new URL('./css/styles.css', import.meta.url), 'utf8');

// The tint must be re-asserted AFTER .chat-view-header, or that later rule's
// background:var(--bg-card) wins at equal specificity and the main chat page's
// header renders untinted while the bottom sheet renders correctly.
const viewHeaderAt = cssFix.indexOf('.chat-view-header{');
const scopedTintAt = cssFix.indexOf('.chat-view-header.chat-thread-covering');
assert(viewHeaderAt > -1 && scopedTintAt > viewHeaderAt,
  'thread-color tint is re-asserted AFTER .chat-view-header so the cascade cannot drop it');

// Static only — the dashboard's equivalents pulse deliberately; a pulsing chat
// header is noise (spec, item F).
// Match only the .chat-thread-* rule bodies themselves — slicing between two
// markers swept in unrelated CSS and made this cry wolf.
const threadRules = cssFix.match(/\.chat-thread-[a-z]+\{[^}]*\}/g) || [];
assert(threadRules.length >= 5, `all five thread-color rules present (got ${threadRules.length})`);
assert(!threadRules.some(r => /animation|transition/.test(r)),
  'thread header colors carry NO animation (static, per item F)');

// v0.17.4 (UN-103, batch 2): the composer's "more emoji" button — the thing
// these two assertions guarded — is RETIRED, not just resized/repositioned.
// Narrowed to assert the retirement is clean (the button, its row, and the
// composer-foot-anchored picker override it opened are all gone together)
// rather than testing tap-target/direction properties of a control that no
// longer exists.
assert(!/\.chat-emoji-row\b|\.chat-emoji-insert\b|\.chat-emoji-more\b/.test(cssFix),
  'UN-103: no composer emoji-row/insert/more CSS survives — the composer no longer inserts emoji, it reacts to messages');
assert(!/\.chat-composer-foot \.reaction-picker/.test(cssFix),
  'UN-103: the composer-foot-anchored reaction-picker override is gone with the button that opened it');

// The fifth surface item A missed: title + PWA icon badge must clear when chat
// is off, or a player chases a badge they cannot clear.
const chatUiFix = await readFile(new URL('./js/chat-ui.js', import.meta.url), 'utf8');
const badgesFn = (chatUiFix.match(/export function updateChatBadges[\s\S]*?\n}/) || [''])[0];
assert(/isChatEnabled\(\)/.test(badgesFn),
  'updateChatBadges is gated on isChatEnabled (clears title + PWA badge when off)');

// ── 18. UN-98 + UN-99 — safe-area insets on the installed app ────────────────
// Root cause (design input): viewport-fit=cover + a translucent status bar
// make safe-area insets non-zero and draw the app UNDER the status bar /
// Dynamic Island. Before this batch, env(safe-area-inset-top) appeared ZERO
// times in styles.css while env(safe-area-inset-bottom) appeared 5x — the
// bottom nav was handled, the top never was.
console.log('\n[18] UN-98/99 — header + toasts clear the status bar / camera on the installed app…');

const appHeaderRule = (cssSrc.match(/\.app-header\{[^}]*\}/) || [''])[0];
assert(/padding-top:\s*env\(safe-area-inset-top/.test(appHeaderRule),
  `.app-header pads for env(safe-area-inset-top) — got "${appHeaderRule}"`);

// UN-98's COUPLED change: #toast-container sits below the header today at a
// flat 76px. Once the header can grow taller in standalone, that flat value
// no longer clears it — both the base rule AND the <=480px override (which
// matches virtually every real phone and would otherwise silently mask the
// base-rule fix) must grow with the same inset.
const toastContainerBaseRule = (cssSrc.match(/#toast-container\{[^}]*\}/) || [''])[0];
assert(/top:\s*calc\(76px \+ env\(safe-area-inset-top/.test(toastContainerBaseRule),
  `#toast-container base rule grows with env(safe-area-inset-top) — got "${toastContainerBaseRule}"`);
const toastContainerOverrides = cssSrc.match(/#toast-container\s*\{[^}]*\}/g) || [];
const narrowOverride = toastContainerOverrides.find(r => /70px/.test(r)) || '';
assert(/env\(safe-area-inset-top/.test(narrowOverride),
  `#toast-container's <=480px override ALSO accounts for env(safe-area-inset-top) — without this the base-rule fix is masked on every real phone (got "${narrowOverride}")`);

// UN-99: .chat-toast is a SEPARATE element (the floating new-message toast,
// not the generic toast stack) — same pattern, independently applied.
const chatToastRule = (cssSrc.match(/\.chat-toast\{[^}]*\}/) || [''])[0];
assert(/top:\s*calc\(14px \+ env\(safe-area-inset-top/.test(chatToastRule),
  `.chat-toast grows with env(safe-area-inset-top) — got "${chatToastRule}"`);

const topInsetCount = (cssSrc.match(/env\(safe-area-inset-top/g) || []).length;
assert(topInsetCount >= 4, `env(safe-area-inset-top) now appears in styles.css at every required call site (>=4 expected: .app-header, #toast-container base, #toast-container override, .chat-toast — got ${topInsetCount})`);

// ── 19. UN-100 — no accidental zoom / wobble ──────────────────────────────────
console.log('\n[19] UN-100 — zoom lock (Drew-approved WCAG 1.4.4 tradeoff, 2026-08-07)…');
const viewportMeta = (indexHtmlSrc.match(/<meta name="viewport"[^>]*>/) || [''])[0];
assert(/user-scalable=no/.test(viewportMeta), `viewport meta contains user-scalable=no — got "${viewportMeta}"`);
assert(/maximum-scale=1\b/.test(viewportMeta), `viewport meta contains maximum-scale=1 — got "${viewportMeta}"`);
assert(/viewport-fit=cover/.test(viewportMeta), 'viewport-fit=cover survives (still needed for the safe-area insets themselves)');

// ── 20. UN-96 — installed-app icon identity ───────────────────────────────────
console.log('\n[20] UN-96 — installed-app identity: label, icons, manifest colors…');

async function pngDimensions(relPath) {
  let buf;
  try { buf = await readFile(new URL(relPath, import.meta.url)); } catch { return null; }
  if (buf.length < 24 || buf.toString('hex', 0, 8) !== '89504e470d0a1a0a') return null; // PNG signature
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }; // IHDR chunk
}

assert(/apple-mobile-web-app-title" content="Pickems"/.test(indexHtmlSrc),
  'apple-mobile-web-app-title is exactly "Pickems" (matches manifest short_name)');
assert(/apple-touch-icon" sizes="180x180" href="icons\/icon-180\.png"/.test(indexHtmlSrc),
  'apple-touch-icon 180x180 (the size iOS actually reads for the home-screen icon) points at icons/icon-180.png');
assert(/apple-touch-icon" href="icons\/icon-180\.png"/.test(indexHtmlSrc),
  'sizeless apple-touch-icon fallback also points at icons/icon-180.png (older iOS)');

const manifestSrc = await readFile(new URL('./manifest.json', import.meta.url), 'utf8');
const manifest = JSON.parse(manifestSrc);
assert(Array.isArray(manifest.icons) && manifest.icons.length > 0 && manifest.icons.every(i => i.purpose === 'any'),
  `every manifest icon entry uses purpose "any", not "any maskable" (the art has no maskable safe zone) — got ${JSON.stringify(manifest.icons.map(i => i.purpose))}`);
assert(manifest.background_color.toLowerCase() === '#500000', `manifest background_color is the maroon #500000 — got ${manifest.background_color}`);
assert(manifest.theme_color.toLowerCase() === '#500000', `manifest theme_color is the maroon #500000 — got ${manifest.theme_color}`);
assert(manifest.short_name === 'Pickems', 'manifest short_name is unchanged ("Pickems") — the DI said leave it');

// Pixel-dimension regression guard — parsed straight out of each PNG's IHDR
// chunk, not assumed. Catches a future regeneration that silently produces
// the wrong size (the exact failure mode the batch task called out to guard
// against).
const dims180 = await pngDimensions('./icons/icon-180.png');
const dims192 = await pngDimensions('./icons/icon-192.png');
const dims512 = await pngDimensions('./icons/icon-512.png');
assert(!!dims180 && dims180.width === 180 && dims180.height === 180,
  `icons/icon-180.png is exactly 180x180 — got ${dims180 ? `${dims180.width}x${dims180.height}` : 'unreadable/missing'}`);
assert(!!dims192 && dims192.width === 192 && dims192.height === 192,
  `icons/icon-192.png is exactly 192x192 — got ${dims192 ? `${dims192.width}x${dims192.height}` : 'unreadable/missing'}`);
assert(!!dims512 && dims512.width === 512 && dims512.height === 512,
  `icons/icon-512.png is exactly 512x512 — got ${dims512 ? `${dims512.width}x${dims512.height}` : 'unreadable/missing'}`);

// ── 21. UN-97 — bottom nav SVG icon exception (CONVENTIONS #16) ──────────────
console.log('\n[21] UN-97 — bottom nav SVG icon exception (the ONE named exception to "icons are emoji")…');

const navBlock = (indexHtmlSrc.match(/<nav class="bottom-nav">[\s\S]*?<\/nav>/) || [''])[0];
const navItemBlocks = navBlock.match(/<button class="nav-item[^"]*"[^>]*>[\s\S]*?<\/button>/g) || [];
assert(navItemBlocks.length === 6, `bottom nav has exactly 6 .nav-item buttons (got ${navItemBlocks.length})`);
navItemBlocks.forEach((block, i) => {
  assert(/<svg[^>]*>/.test(block), `nav item ${i + 1} contains an inline <svg>`);
  assert(/currentColor/.test(block), `nav item ${i + 1}'s <svg> uses currentColor — themed by the EXISTING .nav-item.active,.nav-item:active color rule with zero new CSS`);
});

// Every one of the six original emoji spans must be gone.
['🏈', '📊', '💬', '🏆', '📋', '⚙️'].forEach(emoji => {
  assert(!navBlock.includes(`nav-icon">${emoji}`), `.nav-icon no longer renders ${emoji} directly (replaced by inline SVG)`);
});

// v0.17.5 (batch 4, UN-109) — REWRITTEN. This previously asserted the header
// logo emoji was UNCHANGED (the SVG exception scoped to the nav only, not
// widened to the header). UN-109 removed the header logo ENTIRELY — Drew: the
// app's title/icon doesn't need to be present on every screen, the user
// already knows what app this is. Asserting the new fact (gone, not merely
// unchanged), not the old one. See §[27] for the full UN-109 removal guard.
assert(!/class="app-logo-icon"/.test(indexHtmlSrc) && !/🏈/.test(indexHtmlSrc),
  'the header logo 🏈 emoji is GONE (UN-109) — no leftover instance anywhere in index.html');

// Exactly 6 <svg> in the whole file — the six nav icons and nothing else
// (favicon is a separate .svg FILE referenced via <link>, not an inline <svg>).
const totalSvgCount = (indexHtmlSrc.match(/<svg/g) || []).length;
assert(totalSvgCount === 6, `index.html contains exactly 6 <svg> elements (the six nav icons, nothing leaked outside the nav) — got ${totalSvgCount}`);

// UN-73 nav order + labels + tap target are explicitly NOT to change.
const navOrder = [...navBlock.matchAll(/data-tab="([a-z]+)"/g)].map(m => m[1]);
assert(JSON.stringify(navOrder) === JSON.stringify(['picks', 'dashboard', 'chat', 'leaderboard', 'rules', 'commissioner']),
  `nav tab order is unchanged (UN-73) — got ${JSON.stringify(navOrder)}`);
const navLabels = navItemBlocks.map(b => (b.match(/<span>([^<]+)<\/span>\s*<\/button>/) || [, ''])[1]);
assert(JSON.stringify(navLabels) === JSON.stringify(['Picks', 'Dashboard', 'Chat', 'Standings', 'Rules', 'Comm.']),
  `nav labels are unchanged — got ${JSON.stringify(navLabels)}`);
const navItemRule = (cssSrc.match(/\.nav-item\{[^}]*\}/) || [''])[0];
assert(/min-height:44px/.test(navItemRule), 'nav-item tap target (min-height:44px) is unchanged — the hit area stays the full button, not just the glyph');

// The icon's own footprint is still sized to the ~20px the emoji occupied.
const navIconSvgRule = (cssSrc.match(/\.nav-icon svg\{[^}]*\}/) || [''])[0];
assert(/width:\s*20px/.test(navIconSvgRule) && /height:\s*20px/.test(navIconSvgRule),
  `.nav-icon svg is sized to the ~20px footprint .nav-icon{font-size:1.25rem} had — got "${navIconSvgRule}"`);

// ── 22. UN-106 — header identity: signed-in indicator / sign-in CTA ──────────
console.log('\n[22] UN-106 — header identity: signed-in indicator + sign-in CTA…');

const appModForIdentity = mods['app'];
assert(typeof appModForIdentity.renderHeaderIdentity === 'function', 'renderHeaderIdentity is exported from app.js');

// A minimal fake element, swapped in for getElementById('header-identity')
// only, so this exercises the REAL render function against REAL storage
// state instead of just asserting on source text.
function makeFakeHeaderIdentityEl() {
  const attrs = {};
  return { hidden: false, innerHTML: '', setAttribute(k, v) { attrs[k] = v; }, getAttribute: k => attrs[k] };
}
const headerIdentityEl = makeFakeHeaderIdentityEl();
const realGetElementById = document.getElementById;
document.getElementById = id => (id === 'header-identity' ? headerIdentityEl : realGetElementById(id));

// Logged out — no ambiguity, session.playerId is definitively null.
storage.clearSession();
appModForIdentity.renderHeaderIdentity();
assert(headerIdentityEl.hidden === false, 'logged out: the identity chip is visible');
assert(/Sign In/.test(headerIdentityEl.innerHTML), 'logged out: renders the "Sign In" pill');
assert(!/header-identity-avatar/.test(headerIdentityEl.innerHTML), 'logged out: renders no avatar');

// Session-not-yet-resolved (the batch 1 hazard): a session references a
// playerId whose record can't be found (pre-hydrate on a fresh device, in
// practice). Must hold the slot EMPTY, never flash "Sign In".
storage.setSession('ghost_player_not_hydrated', false, true);
appModForIdentity.renderHeaderIdentity();
assert(headerIdentityEl.hidden === true,
  'session references a player not yet in storage: the slot is held EMPTY (hidden), not "Sign In"');
assert(headerIdentityEl.innerHTML === '',
  'unresolved session: no content rendered — never a flash of "Sign In" before a real login resolves');

// Logged in.
storage.addPlayer(dm.createPlayer('Testy', '', '9999', '', 'DT'));
const fixturePlayers = storage.getPlayers();
const testPlayer = fixturePlayers[fixturePlayers.length - 1];
storage.setSession(testPlayer.playerId, false, true);
appModForIdentity.renderHeaderIdentity();
assert(headerIdentityEl.hidden === false, 'logged in: the identity chip is visible');
assert(headerIdentityEl.innerHTML.includes('header-identity-avatar') && headerIdentityEl.innerHTML.includes('DT'),
  'logged in: renders the initials avatar (getPlayerInitials)');
assert(headerIdentityEl.innerHTML.includes('header-identity-name') && headerIdentityEl.innerHTML.includes('Testy'),
  'logged in: renders the first name next to the avatar');
assert(!/Sign In/.test(headerIdentityEl.innerHTML), 'logged in: no "Sign In" pill remains');

document.getElementById = realGetElementById;
storage.clearSession();

// No week-status dependency (DI requirement) — renderHeaderIdentity's source
// never references `week`.
const identityFnSrc = (appJsSrc.match(/export function renderHeaderIdentity\(\)[\s\S]*?\n}/) || [''])[0];
assert(identityFnSrc.length > 0 && !/\bweek\b/.test(identityFnSrc),
  'renderHeaderIdentity has no week-status dependency — renders identically in Draft/Open/Locked/Live/Final');

// Placement + wiring: first in .header-right, ahead of sync/tz/theme, and
// wired into the same two functions that already keep the header in sync.
const headerRightBlock = (indexHtmlSrc.match(/<div class="header-right">[\s\S]*?<\/div>/) || [''])[0];
assert(headerRightBlock.indexOf('id="header-identity"') > -1
  && headerRightBlock.indexOf('id="header-identity"') < headerRightBlock.indexOf('id="sync-badge"'),
  'the identity chip is first in .header-right, ahead of the sync badge / tz toggle / theme toggle');
assert(/renderHeaderIdentity\(\);/.test((appJsSrc.match(/function refreshHeader\(\)[\s\S]*?\n}/) || [''])[0]),
  'refreshHeader() calls renderHeaderIdentity() — covers boot + every week-driven re-render');
assert(/renderHeaderIdentity\(\);/.test((appJsSrc.match(/function resyncPlayerPreferences\(\)[\s\S]*?\n}/) || [''])[0]),
  'resyncPlayerPreferences() calls renderHeaderIdentity() — covers login/logout/player-switch');

// ── 23. Batch 2 (v0.17.4) — UN-101 BETA badge, UN-102 notifications, UN-103
//       composer cleanup + hidden actions, UN-104 chat layout ────────────────
console.log('\n[23a] UN-101 — Chat marked BETA…');

// Structural placement is covered in §[11] (the "Chat" naming guard, updated
// to match the badge now living inline in the same <h2>). Here: the badge's
// OWN styling — reused variables, no new color, no animation.
const badgeBetaRule = (cssSrc.match(/\.badge-beta\{[^}]*\}/) || [''])[0];
assert(badgeBetaRule.length > 0, '.badge-beta is defined in styles.css');
assert(/var\(--text-muted\)/.test(badgeBetaRule) && /var\(--border\)/.test(badgeBetaRule),
  '.badge-beta reuses the existing --text-muted/--border variables, same as .badge-draft (no new color)');
assert(!/animation/.test(badgeBetaRule), '.badge-beta carries no animation — chat surfaces use the static variant (locked, v0.17.2)');
assert(!/#[0-9A-Fa-f]{3,6}\b/.test(badgeBetaRule.replace(/^\.badge-beta\{/, '').split(';')[0] === '' ? '' : badgeBetaRule),
  '.badge-beta does not introduce a new hardcoded hex color (CONVENTIONS #13)');
assert(/title="Still being tested — tell us if something looks wrong"/.test(chatUiSrc),
  'BETA badge carries the touch-safe title copy (tooltips do not fire on touch — the word BETA itself is the signal)');

console.log('\n[23b] UN-102a — toast suppressed on Dashboard, not on other tabs…');
assert(typeof chatUi._toastWouldSuppress === 'function',
  'chat-ui.js exports _toastWouldSuppress (test-only) so the REAL suppression predicate is exercised');
if (typeof chatUi._toastWouldSuppress === 'function') {
  const realQS23 = document.querySelector;
  document.querySelector = sel => (sel === '#page-dashboard.active' ? {} : null);
  assert(chatUi._toastWouldSuppress(false) === true, 'toast suppressed while the Dashboard tab is active (the teaser already conveys it)');
  document.querySelector = sel => (sel === '#page-chat.active' ? {} : null);
  assert(chatUi._toastWouldSuppress(false) === true, 'toast still suppressed while the Chat tab is active (pre-existing rule, unchanged)');
  document.querySelector = () => null;
  assert(chatUi._toastWouldSuppress(false) === false, 'toast NOT suppressed on any other tab (picks/standings/rules/comm)');
  assert(chatUi._toastWouldSuppress(true) === false, 'force:true (e.g. the pick-reveal system toast) bypasses suppression regardless of active tab');
  document.querySelector = realQS23;
}

console.log('\n[23c] UN-102b — the dashboard teaser never resurfaces the viewer\'s OWN post…');
chat._resetForTest();
storage.saveSetting('chatEnabled', true);
localStorage.removeItem('cfbp_chat_teaser_dismiss_seq');
storage.setSession('p1', false, true);   // "I" am p1 — no real player record needed (me() only reads the session)
chat.ingest([ev({ id: 'selfpost1', seq: 1, ts: 1000, body: 'my own post', author: 'p1' })]);
assert(chatUi.dashboardChatTeaserHTML() === '',
  'UN-102b: posting your OWN message never resurfaces the teaser with your own text back at you (pre-fix, this returned your own post)');
chat.ingest([ev({ id: 'otherpost1', seq: 2, ts: 2000, body: 'reply from someone else', author: 'p2' })]);
assert(chatUi.dashboardChatTeaserHTML() !== '', 'sanity: a message from someone ELSE still surfaces the teaser normally');
assert(/reply from someone else/.test(chatUi.dashboardChatTeaserHTML()), 'the surfaced teaser previews the OTHER player\'s text, not your own');
storage.clearSession();
localStorage.removeItem('cfbp_chat_teaser_dismiss_seq');
chat._resetForTest();

console.log('\n[23d] UN-102c — toast "stays for" duration preference…');
storage.addPlayer(dm.createPlayer('Batch2Tester', '', '4321', '', 'B2'));
const b2Players = storage.getPlayers();
const b2Player = b2Players[b2Players.length - 1];
storage.setSession(b2Player.playerId, false, true);
assert(storage.getNotifPrefs().toastDuration === 6000,
  'toastDuration defaults to 6000 when absent from a stored blob (CONVENTIONS #10 — old records must not change behavior)');
storage.setNotifPrefs({ toastDuration: 10000 });
assert(storage.getNotifPrefs().toastDuration === 10000, 'toastDuration round-trips through set/get');
storage.setNotifPrefs({ toastDuration: 0 });
assert(storage.getNotifPrefs().toastDuration === 0, 'toastDuration round-trips the "Until dismissed" value (0) — a falsy-but-meaningful value, not treated as absent');
storage.clearSession();
assert(/getNotifPrefs\(\)\.toastDuration/.test(chatUiSrc) || /const prefMs = getNotifPrefs\(\)\.toastDuration/.test(chatUiSrc),
  'drainToast() reads the duration from getNotifPrefs() rather than a hardcoded 6000');
assert(/prefsPanelHTML[\s\S]*?Stays for[\s\S]*?<select/.test(chatUiSrc) || /Stays for[\s\S]{0,80}<select/.test(chatUiSrc),
  'the "Stays for" duration select is present in the chat prefs panel');
assert(/chat-toast-dismiss/.test(chatUiSrc) && /chat-toast-dismiss/.test(cssSrc),
  'a manual ✕ dismiss control exists on the toast regardless of duration (Drew: "needs to be able to be dismissed"), in both markup and CSS');

console.log('\n[23e] UN-103 — composer emoji row removed; + react control on messages…');
assert(!/chat-emoji-row/.test(chatUiSrc) && !/chat-emoji-insert/.test(chatUiSrc) && !/chat-emoji-more/.test(chatUiSrc),
  'no emoji-insert row survives in composerHTML() — players use their own keyboard (Drew)');
assert(/data-react-open="\$\{esc\(m\.id\)\}"/.test(chatUiSrc),
  'each message renders a + react-open control targeting that specific message');
assert(/toggleMessageReactPicker/.test(chatUiSrc), 'the + opens a dedicated per-message react picker (not the retired composer picker)');

// UN-120 (2026-08-12) SUPERSEDES this suite's original hover-mechanism
// assertions — the desktop hover reveal and its `@media(hover:none)` touch
// split are DELETED outright per the amended design input, not tuned. The
// full behavioral coverage for the replacement (right-click / long-press /
// swipe, all sharing ONE `.chat-actions-revealed` class) lives in its own
// suite, below. What survives here is the part UN-120 does NOT touch: the
// UN-113/RG-20/RG-21 hard constraint that hidden means display:none, never
// opacity — asserted against the real function's failure mode, not its name.
const baseActionsRule23 = (cssSrc.match(/^\.chat-actions\{[^}]*\}/m) || [''])[0];
assert(/display:\s*none/.test(baseActionsRule23),
  '.chat-actions base rule hides via display:none — NOT opacity:0 — so it reserves zero layout height (UN-113 root cause fix, still enforced after UN-120\'s positioning change)');
assert(!/opacity:\s*0/.test(baseActionsRule23) && !/pointer-events:\s*none/.test(baseActionsRule23),
  '.chat-actions no longer needs opacity:0/pointer-events:none — display:none already makes it both invisible and untappable, with no separate height-reserving hidden state');

// Computed-constraint, not source presence (Testing Protocol step 12) — parse
// the ACTUAL declared px values, the same technique already proven on
// .chat-pill (v0.17.2) and .chat-emoji-more (v0.17.3).
const chatActRule23 = (cssSrc.match(/\.chat-act\{[^}]*\}/) || [''])[0];
const actMinW = Number((chatActRule23.match(/min-width:\s*(\d+)px/) || [])[1] || 0);
const actMinH = Number((chatActRule23.match(/min-height:\s*(\d+)px/) || [])[1] || 0);
assert(actMinW >= 40 && actMinH >= 40,
  `.chat-act (and the + react control, which shares the class) meets the 40px tap-target floor (CONVENTIONS #17) — got ${actMinW}x${actMinH}`);
const toastDismissRule23 = (cssSrc.match(/\.chat-toast-dismiss\{[^}]*\}/) || [''])[0];
const dismissMinW = Number((toastDismissRule23.match(/min-width:\s*(\d+)px/) || [])[1] || 0);
const dismissMinH = Number((toastDismissRule23.match(/min-height:\s*(\d+)px/) || [])[1] || 0);
assert(dismissMinW >= 40 && dismissMinH >= 40,
  `the toast's ✕ dismiss control meets the 40px tap-target floor (CONVENTIONS #17) — got ${dismissMinW}x${dismissMinH}`);

console.log('\n[23f] UN-103 — long-press reveals actions; a scroll swipe must NOT…');
// Reuse check: same 350ms/8px numbers as app.js's bindColumnReorderHandlers,
// not merely a similarly-shaped reimplementation with different numbers.
const appLongPressMs = Number((appJsSrc.match(/const LONG_PRESS_MS\s*=\s*(\d+)/) || [])[1]);
const appScrollThreshold = Number((appJsSrc.match(/const SCROLL_THRESHOLD\s*=\s*(\d+)/) || [])[1]);
const chatLongPressMs = Number((chatUiSrc.match(/const LONG_PRESS_MS\s*=\s*(\d+)/) || [])[1]);
const chatThreshold = Number((chatUiSrc.match(/const LONG_PRESS_THRESHOLD_PX\s*=\s*(\d+)/) || [])[1]);
assert(appLongPressMs === 350 && chatLongPressMs === 350,
  `chat-ui.js's message long-press reuses app.js's EXACT 350ms timer — app=${appLongPressMs}, chat=${chatLongPressMs}`);
assert(appScrollThreshold === 8 && chatThreshold === 8,
  `chat-ui.js's message long-press reuses app.js's EXACT 8px scroll threshold — app=${appScrollThreshold}, chat=${chatThreshold}`);

assert(typeof chatUi._bindMessageActionsLongPress === 'function',
  'chat-ui.js exports _bindMessageActionsLongPress (test-only) for behavioral long-press coverage');
if (typeof chatUi._bindMessageActionsLongPress === 'function') {
  function makeFakeScrollRoot23() {
    const handlers = {};
    return { addEventListener(type, fn) { handlers[type] = fn; }, removeEventListener(type) { delete handlers[type]; }, _fire: (type, e) => handlers[type]?.(e) };
  }
  function makeFakeMsgEl23(mid) {
    const classes = new Set();
    return { dataset: { mid }, classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) }, _classes: classes };
  }
  const revealTargets23 = {};
  const realQS23b = document.querySelector;
  document.querySelector = sel => {
    const m = /\.chat-msg\[data-mid="([^"]+)"\]/.exec(sel || '');
    return m ? (revealTargets23[m[1]] || null) : null;
  };
  const touchTargetFor = el => ({ closest: sel => (sel === '.chat-msg' ? el : null) });

  // Case 1 — genuine long-press (no movement) reveals that message's actions.
  const root1 = makeFakeScrollRoot23();
  const msg1 = makeFakeMsgEl23('long_press_msg');
  revealTargets23['long_press_msg'] = msg1;
  chatUi._bindMessageActionsLongPress(root1);
  root1._fire('touchstart', { touches: [{ clientX: 100, clientY: 100 }], target: touchTargetFor(msg1) });
  await new Promise(r => setTimeout(r, 400));
  assert(msg1._classes.has('chat-actions-revealed'), 'a genuine long-press (no movement) reveals that message\'s .chat-actions');

  // Case 2 — a scroll swipe (well past the 8px threshold) before the 350ms
  // timer fires must CANCEL the press. This is the exact hazard named in the
  // task: scrolling over a message must never summon its actions.
  const root2 = makeFakeScrollRoot23();
  const msg2 = makeFakeMsgEl23('scroll_msg');
  revealTargets23['scroll_msg'] = msg2;
  chatUi._bindMessageActionsLongPress(root2);
  root2._fire('touchstart', { touches: [{ clientX: 100, clientY: 100 }], target: touchTargetFor(msg2) });
  root2._fire('touchmove', { touches: [{ clientX: 100, clientY: 130 }] });   // 30px vertical — a scroll, not a hold
  await new Promise(r => setTimeout(r, 400));
  assert(!msg2._classes.has('chat-actions-revealed'),
    'a scroll swipe (30px before the 350ms timer fires) cancels the long-press — scrolling over a message never reveals its actions');

  // Case 3 — movement UNDER the 8px threshold still counts as a hold.
  const root3 = makeFakeScrollRoot23();
  const msg3 = makeFakeMsgEl23('steady_msg');
  revealTargets23['steady_msg'] = msg3;
  chatUi._bindMessageActionsLongPress(root3);
  root3._fire('touchstart', { touches: [{ clientX: 100, clientY: 100 }], target: touchTargetFor(msg3) });
  root3._fire('touchmove', { touches: [{ clientX: 103, clientY: 101 }] });   // 3+1=4px — under threshold
  await new Promise(r => setTimeout(r, 400));
  assert(msg3._classes.has('chat-actions-revealed'), 'movement under the 8px threshold does not cancel a genuine long-press');

  // Case 4 — touchend BEFORE the timer fires cancels it (a quick tap is not a hold).
  const root4 = makeFakeScrollRoot23();
  const msg4 = makeFakeMsgEl23('tap_msg');
  revealTargets23['tap_msg'] = msg4;
  chatUi._bindMessageActionsLongPress(root4);
  root4._fire('touchstart', { touches: [{ clientX: 50, clientY: 50 }], target: touchTargetFor(msg4) });
  root4._fire('touchend', {});
  await new Promise(r => setTimeout(r, 400));
  assert(!msg4._classes.has('chat-actions-revealed'), 'a quick tap (touchend before 350ms) never reveals actions');

  document.querySelector = realQS23b;
}

console.log('\n[23g] UN-104 — chat layout: sticky stacking, not a nested scroll box…');
const scrollRule23 = (cssSrc.match(/\.chat-scroll\{[^}]*\}/) || [''])[0];
assert(!/max-height:\s*56vh/.test(scrollRule23), '.chat-scroll no longer caps at max-height:56vh (the artificial cap Drew identified as the cause of the overflow)');

const templateMatch23 = chatUiSrc.match(/c\.innerHTML = `[\s\S]*?`;/);
const chatPageTemplate23 = templateMatch23 ? templateMatch23[0] : '';
assert(chatPageTemplate23.length > 0, 'renderChatPage() template block located for structural assertions');
assert(/<div class="chat-sticky-stack">/.test(chatPageTemplate23),
  'the compact header row + pills + view header are wrapped in ONE sticky unit (not per-element sticky math)');
assert(!/class="subtitle"/.test(chatPageTemplate23),
  'UN-104: the two-line "SCRIBE on duty" subtitle row is gone from the chat header — one compact line only');

// v0.17.4 — REPLACED (first pass). These originally asserted position:sticky
// on the pills stack and the composer. Review found that mechanism INERT:
// .page-wrapper and .main-content both set overflow-x:hidden, so per spec
// overflow-y computes to `auto`, they become the nearest scrolling ancestor,
// and they never scroll — so the sticky offset never applied. Measured in
// headless Chrome: the stack's rect.top read -1076 where sticky would have
// given 64. That pass replaced it with a calc()-based .chat-scroll max-height
// driven by a runtime-measured .app-header + .chat-composer height.
//
// v0.17.5 (batch 4, UN-110) — REPLACED AGAIN, this time by design, not a bug
// fix: UN-110 reverses UN-104's "keep the header, make it unobtrusive" answer
// and hides .app-header entirely on the chat tab
// (body[data-tab="chat"] .app-header). The calc()-based max-height this block
// used to assert read a --chat-sticky-top var published by MEASURING that
// now-hidden header — dead on arrival, would forever read 0.
// #page-chat.active is a real flex column instead: an explicit bounded
// height on the PARENT, flex:1 + min-height:0 on .chat-scroll (the ONE child
// that actually scrolls). Every assertion below checks THAT mechanism, not
// the old one — this is the regression-shaped block Testing Protocol step 10
// asks about: run against the pre-fix source, the "no longer bounds itself
// with max-height:calc()" and "--chat-sticky-top is never set" assertions
// below both FAIL (the old rule had exactly those things).
const chatScrollRule = (cssSrc.match(/\.chat-scroll\{[^}]*\}/) || [''])[0];
assert(/overflow-y:\s*auto/.test(chatScrollRule),
  '.chat-scroll is a REAL scroll container');
assert(!/max-height:\s*calc\(/.test(chatScrollRule) && /max-height:\s*none/.test(chatScrollRule),
  '.chat-scroll no longer bounds ITSELF with a calc() max-height — the bound moved to the PARENT (#page-chat.active), below');
assert(!/var\(--chat-sticky-top/.test(chatScrollRule),
  '.chat-scroll no longer reads --chat-sticky-top — that var was published by measuring .app-header, which is now display:none on chat and would forever measure 0');
assert(/flex:\s*1\s+1\s+auto/.test(chatScrollRule),
  '.chat-scroll is flex:1 1 auto — it grows to fill whatever space its flex SIBLINGS (header stack, offline banner, retention notice, composer) leave behind');
assert(/min-height:\s*0\b/.test(chatScrollRule),
  '.chat-scroll has min-height:0 — REQUIRED for a flex child to shrink/scroll at all (the flex default min-height is `auto`, i.e. "at least as tall as my content"); omitting it produces a page that looks fine until the thread is long enough to push the composer off-screen — classic flex-scroll bug, called out explicitly in the design input');

const pageChatActiveRule = (cssSrc.match(/#page-chat\.active\{[^}]*\}/) || [''])[0];
assert(pageChatActiveRule.length > 0, '#page-chat.active rule located');
assert(/display:\s*flex/.test(pageChatActiveRule) && /flex-direction:\s*column/.test(pageChatActiveRule),
  '#page-chat.active is a flex column — the bounding mechanism moved from .chat-scroll\'s own calc() to the PARENT\'s explicit height');
assert(/height:\s*calc\(100dvh/.test(pageChatActiveRule) && /var\(--nav-height\)/.test(pageChatActiveRule) && /env\(safe-area-inset-bottom/.test(pageChatActiveRule),
  '#page-chat.active has an explicit height budgeting for the nav and the bottom safe area (moved here from .chat-scroll)');
assert(/padding-top:\s*env\(safe-area-inset-top/.test(pageChatActiveRule),
  '#page-chat.active supplies its own top safe-area clearance — the notch clearance .app-header used to supply before it was hidden on this tab');
assert(/overflow:\s*hidden/.test(pageChatActiveRule),
  '#page-chat.active clips overflow at the page level — .chat-scroll is the ONLY child that actually scrolls');
assert(/@supports not \(height:100dvh\)\{#page-chat\.active\{height:calc\(100vh/.test(cssSrc),
  'a non-dvh fallback exists for #page-chat.active (moved from the old .chat-scroll fallback, same 100vh substitution pattern)');

const flexAutoRule = (cssSrc.match(/\.chat-sticky-stack,\.chat-offline-banner,\.chat-retention-notice,\.chat-composer,#chat-jump\{[^}]*\}/) || [''])[0];
assert(/flex:\s*0\s+0\s+auto/.test(flexAutoRule),
  'the header stack, offline banner, retention notice, composer, and jump-to-latest button are all flex:0 0 auto — fixed-size flex siblings of .chat-scroll, none of them the scrolling child');

// The header-hiding half of the mechanism (UN-110's data-tab approach).
assert(/body\[data-tab="chat"\]\s*\.app-header\{display:\s*none\}/.test(cssSrc),
  'body[data-tab="chat"] .app-header{display:none} exists — the header is actually REMOVED on the chat tab, not just visually minimized (UN-104\'s answer)');

// The inert rules must not come back.
assert(!/#page-chat \.chat-sticky-stack\{[^}]*position:\s*sticky/.test(cssSrc),
  'the inert position:sticky on .chat-sticky-stack is gone, not left for someone to "fix"');
assert(!/#page-chat \.chat-composer\{[^}]*position:\s*sticky/.test(cssSrc),
  'the inert position:sticky on the composer is gone');

// The per-game bottom sheet must declare its OWN overflow. It inherited it from
// .chat-scroll, so when that was removed the sheet spilled its content out over
// the composer and backdrop, unclipped and unscrollable.
const sheetScrollRule = (cssSrc.match(/\.chat-sheet-scroll\{[^}]*\}/) || [''])[0];
assert(/overflow-y:\s*auto/.test(sheetScrollRule),
  '.chat-sheet-scroll declares its own overflow — never depends on a sibling surface\'s rule');

// The react picker must clear the bottom nav (z-index 100). The composer-scoped
// rule that handled this was deleted with the composer picker; the per-message
// anchor needed its own, or long-pressing the NEWEST message and tapping + does
// nothing visible — the exact bug the deleted rule's comment described.
const msgPickerRule = (cssSrc.match(/\.chat-msg \.reaction-picker\{[^}]*\}/) || [''])[0];
assert(/bottom:\s*100%/.test(msgPickerRule), 'the per-message react picker opens UPWARD');
const pickerZ = Number((msgPickerRule.match(/z-index:\s*(\d+)/) || [])[1] || 0);
const navZ = Number(((cssSrc.match(/\.bottom-nav\{[^}]*\}/) || [''])[0].match(/z-index:\s*(\d+)/) || [])[1] || 0);
assert(pickerZ > navZ, `react picker (z=${pickerZ}) renders ABOVE .bottom-nav (z=${navZ})`);

// The runtime measurement itself.
// v0.17.5 (batch 4, UN-110) — REWRITTEN. This previously proved
// _syncChatStickyMetrics measured .app-header's REAL height and published it
// as --chat-sticky-top. UN-110 deletes that measurement entirely (.app-header
// is display:none on chat; measuring it would return 0 and poison the var
// forever) — the function now measures ONLY the composer. Proving the
// negative as strongly as this harness can without a real layout engine:
// .app-header's mock THROWS on getBoundingClientRect — if the function still
// queried and measured it, this test would fail with an exception, not just
// a wrong value.
assert(typeof chatUi._syncChatStickyMetrics === 'function',
  'chat-ui.js exports _syncChatStickyMetrics (test-only) — the runtime composer-measurement function');
if (typeof chatUi._syncChatStickyMetrics === 'function') {
  const realQS23c = document.querySelector;
  const realDocEl23 = document.documentElement;
  const setProps = {};
  document.documentElement = { style: { setProperty: (k, v) => { setProps[k] = v; } } };
  document.querySelector = sel => {
    if (sel === '.app-header') return { getBoundingClientRect: () => { throw new Error('regression: .app-header must never be measured again — UN-110 hides it on chat'); } };
    if (sel === '#page-chat .chat-composer') return { getBoundingClientRect: () => ({ height: 132.2 }) };
    return null;
  };
  chatUi._syncChatStickyMetrics();
  assert(setProps['--chat-sticky-top'] === undefined,
    `--chat-sticky-top is never set — the measurement that used to publish it is DELETED, not just left unused — got ${setProps['--chat-sticky-top']}`);
  assert(setProps['--chat-composer-h'] === '133px',
    `--chat-composer-h is still set from the REAL measured composer height (rounded up) — still needed for .chat-jump-latest — got ${setProps['--chat-composer-h']}`);
  document.querySelector = realQS23c;
  document.documentElement = realDocEl23;
}

const jumpLatestRule23 = (cssSrc.match(/#page-chat \.chat-jump-latest\{[^}]*\}/) || [''])[0];
assert(/var\(--chat-composer-h/.test(jumpLatestRule23),
  '"jump to latest" clears the composer using the SAME measured composer height (unchanged by UN-110 — only the header half of the UN-104 mechanism was removed)');

console.log('\n[23h] UN-67 collateral guard — member framing survives in BOTH places named in the design input…');
assert(/The Locker Room is open\. SCRIBE is on duty\./.test(chatUiSrc),
  'the chat empty-room state still carries the "SCRIBE is on duty" framing');
assert(/It is on duty\./.test(appJsSrc),
  'the Rules FAQ still carries the "It is on duty" framing (the second surviving instance named in the design input)');

// ── 24. UN-107 — commissioner control over the "Randomize My Picks" shortcut ──
console.log('\n[24] UN-107 — commissioner control over randomize picks…');
const app = mods['app'];

assert(dm.DEFAULT_SETTINGS.randomizePicksEnabled === false, 'DEFAULT_SETTINGS.randomizePicksEnabled defaults to false');

// The literal hazard named in the task: a missing value must NEVER silently
// enable the shortcut. Simulate an OLD settings blob written before this
// field existed (saveSettings is the raw setter — no DEFAULT_SETTINGS spread).
storage.saveSettings({ timezone: 'PT' });
assert(storage.getSettings().randomizePicksEnabled === false,
  'randomizePicksEnabled reads FALSE when the field is absent from a stored settings blob (the default-when-missing case — CONVENTIONS #10)');

storage.saveSetting('randomizePicksEnabled', true);
assert(storage.getSettings().randomizePicksEnabled === true, 'an explicit true is respected');
storage.saveSetting('randomizePicksEnabled', false);
assert(storage.getSettings().randomizePicksEnabled === false, 'an explicit false is respected');

// The row (including the button) must not render at all when off — not
// disabled, not greyed. Source-verified: the DOM stub returns null from
// getElementById('page-picks'), so renderPicksPageCurrent() early-returns
// before reaching this markup and can't be exercised end-to-end here.
assert(/\$\{getSettings\(\)\.randomizePicksEnabled\?`<div class="flex-between mb-sm randomize-row">/.test(appJsSrc),
  'the randomize row (including #randomize-picks-btn) is wrapped behind getSettings().randomizePicksEnabled — it does not render at all when off');
const randomizeRowBlock = (appJsSrc.match(/\$\{getSettings\(\)\.randomizePicksEnabled\?`<div class="flex-between mb-sm randomize-row">[\s\S]*?<\/div>`:''\}/) || [''])[0];
assert(/id="randomize-picks-btn"/.test(randomizeRowBlock),
  'the gated block contains the actual button element, not just the surrounding row');

// The comm card lives in the Settings tab (RG-10: an untagged admin-section
// renders on all five tabs) and follows the chat on/off card's pattern.
const randomizeCardBlock = (appJsSrc.match(/<div class="admin-section" data-comm-tab="settings">\s*<div class="card" id="comm-randomize-card">[\s\S]*?<\/div>\s*<\/div>`\);/) || [''])[0];
assert(randomizeCardBlock.length > 0,
  'the commissioner Randomize Picks card is wrapped in <div class="admin-section" data-comm-tab="settings"> (RG-10)');
assert(/id="randomize-enabled-toggle"/.test(randomizeCardBlock), 'the card contains the randomize-enabled-toggle checkbox');
assert(/Players see a 🎲 Randomize My Picks shortcut on the Picks page\./.test(randomizeCardBlock),
  'the ON-state copy matches the approved design input verbatim');
assert(/The randomize shortcut is hidden\. Players make every pick by hand\./.test(randomizeCardBlock),
  'the OFF-state copy matches the approved design input verbatim');

assert(/getElementById\('randomize-enabled-toggle'\)\?\.addEventListener\('change'/.test(appJsSrc),
  'a change handler is wired to the toggle');
const toggleHandlerBlock = (appJsSrc.match(/getElementById\('randomize-enabled-toggle'\)\?\.addEventListener\('change', e => \{[\s\S]*?\}\);/) || [''])[0];
assert(/saveSetting\('randomizePicksEnabled', e\.target\.checked\)/.test(toggleHandlerBlock),
  'the toggle handler saves through saveSetting() — the shared storage seam, not a parallel abstraction');

// ── 25. UN-105b — Permissions table: fit instead of clip, emoji alignment ────
console.log('\n[25] UN-105b — Permissions table: no clipping, emoji column alignment…');

const allFaqPermsRules = cssSrc.match(/\.faq-perms[^{]*\{[^}]*\}/g) || [];
assert(allFaqPermsRules.length > 0, '.faq-perms CSS rules located');
assert(allFaqPermsRules.every(r => !/white-space:\s*nowrap/.test(r)),
  '.faq-perms: no rule (base or per-column) carries white-space:nowrap anymore — that was the root cause of the clipping');

const faqPermsBaseRule = (cssSrc.match(/\.faq-perms\{[^}]*\}/) || [''])[0];
assert(/table-layout:\s*fixed/.test(faqPermsBaseRule), '.faq-perms carries table-layout:fixed');

const col1 = Number((cssSrc.match(/\.faq-perms th:nth-child\(1\),\.faq-perms td:nth-child\(1\)\{width:(\d+)%\}/) || [])[1] || 0);
const col2 = Number((cssSrc.match(/\.faq-perms th:nth-child\(2\),\.faq-perms td:nth-child\(2\)\{width:(\d+)%\}/) || [])[1] || 0);
const col3 = Number((cssSrc.match(/\.faq-perms th:nth-child\(3\),\.faq-perms td:nth-child\(3\)\{width:(\d+)%\}/) || [])[1] || 0);
assert(col1 > 0 && col2 > 0 && col3 > 0, `all three .faq-perms column widths are declared — got ${col1}%/${col2}%/${col3}%`);
assert(col1 + col2 + col3 === 100, `.faq-perms column widths sum to exactly 100% — got ${col1}+${col2}+${col3}=${col1 + col2 + col3}`);
assert(col1 > col2 && col1 > col3, `the label column is the widest, per the design input's ~46/27/27 split — got ${col1}%/${col2}%/${col3}%`);

// Emoji-column alignment: cells default to text-align:left (no center
// override survives), which — combined with table-layout:fixed — pins every
// row's leading emoji to the same x-position instead of drifting with
// varying text length under center-align.
assert(!/\.faq-perms[^{]*\{[^}]*text-align:\s*center/.test(cssSrc),
  '.faq-perms: no rule re-centers columns 2/3 — left-align (the table default) is what keeps the emoji column straight');
const faqPermsCellRule = (cssSrc.match(/\.faq-perms th,\.faq-perms td\{[^}]*\}/) || [''])[0];
assert(/text-align:\s*left/.test(faqPermsCellRule), '.faq-perms cells are left-aligned');

// The goal is to FIT, not to scroll — no scroll wrapper was added around it.
const faqSection = (appJsSrc.match(/Permissions — who can do what[\s\S]*?<\/table>/) || [''])[0];
assert(faqSection.length > 0, 'the Permissions table markup located in renderRulesPage()');
assert(!/dashboard-scroll|batch-grid-scroll/.test(faqSection),
  '.faq-perms is NOT wrapped in a horizontal-scroll container — the fix makes it fit, per the design input');

// ── 26. UN-105a — horizontal-scroll edge-fade cue ────────────────────────────
console.log('\n[26] UN-105a — horizontal-scroll edge-fade cue…');

assert(typeof app.initScrollFades === 'function', 'app.js exports initScrollFades — the one shared binder');
assert(typeof app._updateScrollFadeState === 'function', 'app.js exports _updateScrollFadeState (test-only) for behavioral coverage');

// v0.17.4 — REPLACED. These asserted absolutely-positioned ::before/::after
// pseudo-elements. Review measured them in Chrome: because they sit INSIDE the
// overflow-x:auto element they scroll away with the content — the right fade
// drifted to mid-table, and the left fade could never be seen at all, since by
// the time it switched on it had already scrolled off screen.
//
// background-attachment:local is purpose-built for this. The `local` layers
// paint relative to the CONTENT and mask the gradients at each end; the
// `scroll` gradient layers paint relative to the SCROLLPORT and stay pinned.
// Each cue appears only when there is more content that way, hides at the
// boundary, and shows nothing when the content fits — with no JS to drift.
const scrollFadeRule = (cssSrc.match(/\.scroll-fade\{[\s\S]*?\}/) || [''])[0];
assert(/background-attachment:\s*local,\s*local,\s*scroll,\s*scroll/.test(scrollFadeRule),
  '.scroll-fade pins its cues to the SCROLLPORT via background-attachment, so they cannot drift with the content');
assert(!/position:\s*absolute/.test(scrollFadeRule),
  '.scroll-fade no longer uses absolutely-positioned overlays inside the scrolling element');
const localLayers = (scrollFadeRule.match(/linear-gradient/g) || []).length;
assert(localLayers === 4, `.scroll-fade declares 4 gradient layers (2 masks + 2 cues) — got ${localLayers}`);

// v0.17.4 — the cascade-order check above is obsolete: there are no longer any
// opacity-activation rules to order, because the cue is now painted by
// background layers rather than toggled pseudo-elements. What matters instead
// is the LAYER ORDER inside the shorthand — the two `local` mask layers must be
// listed BEFORE the two `scroll` gradient layers, or the masks paint underneath
// and the cue never hides at the boundary.
const bgAttach = (scrollFadeRule.match(/background-attachment:([^;]*)/) || ['',''])[1];
const bgLayers = bgAttach.split(',').map(x => x.trim());
assert(bgLayers.length === 4 && bgLayers[0] === 'local' && bgLayers[1] === 'local'
       && bgLayers[2] === 'scroll' && bgLayers[3] === 'scroll',
  `mask layers are declared before the cue layers — got [${bgLayers.join(', ')}]`);
const bgSizeCount = ((scrollFadeRule.match(/background-size:([^;]*)/) || ['',''])[1].split(',').length);
assert(bgSizeCount === 4, `background-size declares all 4 layers — got ${bgSizeCount}`);

// Render-site coverage. Six known raw template occurrences of the wrapper
// classes today — a tripwire: if this count changes, whoever added the new
// site must also wire an initScrollFades() call for it (see the per-function
// checks below).
const wrapperSites = appJsSrc.match(/class="dashboard-scroll[^"]*"|class="batch-grid-scroll[^"]*"/g) || [];
assert(wrapperSites.length === 6,
  `exactly 6 known .dashboard-scroll/.batch-grid-scroll render sites in app.js templates — got ${wrapperSites.length} (if this changed, the new site needs its own initScrollFades() call, and this count must be updated deliberately)`);

// Extract a top-level function's full body by brace-matching (regex alone
// can't handle nested braces reliably).
function fnBody(name) {
  const start = appJsSrc.indexOf(`function ${name}(`);
  if (start === -1) return '';
  const braceStart = appJsSrc.indexOf('{', start);
  let depth = 0, end = braceStart;
  for (let i = braceStart; i < appJsSrc.length; i++) {
    if (appJsSrc[i] === '{') depth++;
    else if (appJsSrc[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  return appJsSrc.slice(start, end + 1);
}
// Comment-strip each body before counting (the codebase's own explanatory
// comments near these call sites legitimately mention the class names by
// name, e.g. "the .dashboard-scroll wrapper above" — which would otherwise
// inflate a bare-word count. Reuses the SAME `code` filter as [7]'s uiCode.
const stripComments = body => body.split('\n').filter(code).join('\n');
const dashBody = stripComments(fnBody('renderDashboardInner'));
const leaderBody = stripComments(fnBody('renderLeaderboard'));
const commBody = stripComments(fnBody('renderCommPage'));
const demoGridBody = stripComments(fnBody('renderDemoBatchGrid'));
const season25Body = stripComments(fnBody('renderSeason2025RecordSection'));

assert(dashBody.length > 0 && /dashboard-scroll/.test(dashBody) && /initScrollFades\(/.test(dashBody),
  'renderDashboardInner renders a .dashboard-scroll wrapper AND calls initScrollFades()');
assert(leaderBody.length > 0 && (leaderBody.match(/dashboard-scroll/g) || []).length === 2 && /initScrollFades\(/.test(leaderBody),
  'renderLeaderboard renders its own 2 direct .dashboard-scroll wrappers (season summary + weekly history) AND calls initScrollFades()');
assert(/renderSeason2025RecordSection\(\)/.test(leaderBody),
  'renderLeaderboard also embeds renderSeason2025RecordSection — the SAME initScrollFades(c) call above covers its wrappers via the <details> toggle rebind');
assert(season25Body.length > 0 && (season25Body.match(/dashboard-scroll/g) || []).length === 2,
  `renderSeason2025RecordSection renders exactly 2 .dashboard-scroll wrappers inside its collapsed <details> — got ${(season25Body.match(/dashboard-scroll/g) || []).length}`);
assert(demoGridBody.length > 0 && /batch-grid-scroll/.test(demoGridBody),
  'renderDemoBatchGrid renders the .batch-grid-scroll wrapper');
assert(/renderDemoBatchGrid\(/.test(commBody) && (commBody.match(/initScrollFades\(/g) || []).length >= 2,
  'renderCommPage embeds renderDemoBatchGrid\'s wrapper AND calls initScrollFades() at BOTH initial render and on tab switch (the wrapper can be hidden — 0×0 — at initial paint if the panel opens on a non-"week" tab)');

// Behavioral coverage — the actual boundary-disappearing requirement, tested
// against the real exported function with fake scrollWidth/clientWidth/
// scrollLeft, not just source presence (Testing Protocol step 12).
console.log('\n[26b] UN-105a — boundary behavior: fade classes toggle correctly at each scroll position…');
function fakeScrollEl({ scrollWidth, clientWidth, scrollLeft }) {
  const classes = new Set();
  return {
    scrollWidth, clientWidth, scrollLeft,
    classList: {
      add: c => classes.add(c),
      remove: (...cs) => cs.forEach(c => classes.delete(c)),
      toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); },
      contains: c => classes.has(c),
    },
    _classes: classes,
  };
}

// No overflow at all — neither fade may ever show (hinting at a scroll that
// doesn't exist is explicitly called out as worse than no hint).
const noOverflow = fakeScrollEl({ scrollWidth: 400, clientWidth: 400, scrollLeft: 0 });
app._updateScrollFadeState(noOverflow);
assert(!noOverflow._classes.has('scroll-fade-active'), 'no overflow: scroll-fade-active is NOT set');
assert(!noOverflow._classes.has('scroll-fade-at-end') && !noOverflow._classes.has('scroll-fade-scrolled'),
  'no overflow: neither edge class is set — no fade at all when the content does not actually overflow');

// Overflowing, at the very start — right fade shows (more to scroll to);
// left fade does not (nothing hidden to the left yet).
const atStart = fakeScrollEl({ scrollWidth: 900, clientWidth: 400, scrollLeft: 0 });
app._updateScrollFadeState(atStart);
assert(atStart._classes.has('scroll-fade-active'), 'overflowing table: scroll-fade-active IS set');
assert(!atStart._classes.has('scroll-fade-at-end'), 'at the start: right fade is showing (scroll-fade-at-end NOT set)');
assert(!atStart._classes.has('scroll-fade-scrolled'), 'at the start: left fade is hidden (scroll-fade-scrolled NOT set)');

// Scrolled to the middle — both fades show.
const midScroll = fakeScrollEl({ scrollWidth: 900, clientWidth: 400, scrollLeft: 250 });
app._updateScrollFadeState(midScroll);
assert(midScroll._classes.has('scroll-fade-scrolled'), 'mid-scroll: left fade shows (scrolled away from the start)');
assert(!midScroll._classes.has('scroll-fade-at-end'), 'mid-scroll: right fade still shows (not at the end yet)');

// Fully scrolled right — THE critical disappearing-at-the-boundary
// requirement. Right fade must vanish; left fade must still show (there IS
// hidden content to the left).
const atEnd = fakeScrollEl({ scrollWidth: 900, clientWidth: 400, scrollLeft: 500 });
app._updateScrollFadeState(atEnd);
assert(atEnd._classes.has('scroll-fade-at-end'), 'fully scrolled right: scroll-fade-at-end IS set — the right fade disappears at the boundary');
assert(atEnd._classes.has('scroll-fade-scrolled'), 'fully scrolled right: left fade still shows');

// Scrolled back to the start — a live toggle, not a one-way flag.
atEnd.scrollLeft = 0;
app._updateScrollFadeState(atEnd);
assert(!atEnd._classes.has('scroll-fade-at-end'), 'scrolled back to the start: right fade reappears');
assert(!atEnd._classes.has('scroll-fade-scrolled'), 'scrolled back to the start: left fade disappears again');

// initScrollFades itself: idempotent binding (no duplicate scroll listeners
// across repeat calls on the SAME node) + recompute-on-recall (the actual
// commissioner-tab-switch fix — a wrapper hidden at 0×0 becomes measurable
// once visible, without needing to be rebound).
console.log('\n[26c] UN-105a — initScrollFades: idempotent binding, recompute on repeat calls…');
function fakeContainerEl(props) {
  const el = fakeScrollEl(props);
  el.dataset = {};
  let scrollHandlerCount = 0;
  el.addEventListener = (type) => { if (type === 'scroll') scrollHandlerCount++; };
  el._scrollHandlerCount = () => scrollHandlerCount;
  return el;
}
function fakeRoot(elements, detailsEls = []) {
  return {
    querySelectorAll: sel => {
      if (sel === '.dashboard-scroll, .batch-grid-scroll') return elements;
      if (sel === 'details') return detailsEls;
      return [];
    },
  };
}

const boundEl = fakeContainerEl({ scrollWidth: 900, clientWidth: 400, scrollLeft: 0 });
app.initScrollFades(fakeRoot([boundEl]));
assert(boundEl._classes.has('scroll-fade'), 'initScrollFades adds the shared .scroll-fade class');
assert(boundEl._classes.has('scroll-fade-active'), 'initScrollFades computes state immediately on bind');
assert(boundEl._scrollHandlerCount() === 1, 'initScrollFades binds exactly one scroll listener on first call');
app.initScrollFades(fakeRoot([boundEl]));   // simulate a re-render / tab switch on the same node
assert(boundEl._scrollHandlerCount() === 1,
  'a second initScrollFades() call on the SAME node does not stack a duplicate scroll listener');

const hiddenThenShown = fakeContainerEl({ scrollWidth: 0, clientWidth: 0, scrollLeft: 0 });
app.initScrollFades(fakeRoot([hiddenThenShown]));
assert(!hiddenThenShown._classes.has('scroll-fade-active'), 'a hidden (0×0, e.g. an inactive comm tab) wrapper is inactive at first bind');
hiddenThenShown.scrollWidth = 900; hiddenThenShown.clientWidth = 400; // "the tab became active"
app.initScrollFades(fakeRoot([hiddenThenShown]));
assert(hiddenThenShown._classes.has('scroll-fade-active'),
  'the SAME node is RECOMPUTED (not just bound once) once it becomes measurable — this is the commissioner tab-switch fix');

// <details> toggle rebind — the season-2025 record section's two wrapped
// tables can't be measured while collapsed (display:none); opening it must
// re-run initScrollFades scoped to that <details>.
function fakeDetailsEl() {
  const handlers = {};
  return { dataset: {}, addEventListener: (type, fn) => { handlers[type] = fn; }, _fire: type => handlers[type]?.() };
}
const detailsEl = fakeDetailsEl();
const innerEl = fakeContainerEl({ scrollWidth: 900, clientWidth: 400, scrollLeft: 0 });
detailsEl.querySelectorAll = sel => (sel === '.dashboard-scroll, .batch-grid-scroll' ? [innerEl] : []);
app.initScrollFades(fakeRoot([], [detailsEl]));
assert(!innerEl._classes.has('scroll-fade'), 'sanity: the table nested inside the collapsed <details> is untouched before it opens');
detailsEl._fire('toggle');
assert(innerEl._classes.has('scroll-fade') && innerEl._classes.has('scroll-fade-active'),
  'opening the <details> re-runs initScrollFades scoped to it, catching the tables that were unmeasurable while collapsed');

// ── 27. Batch 4 (v0.17.5) — UN-108 header balance, UN-109 logo removal,
//       UN-110 chat owns the screen (reverses UN-104), UN-111 tz/theme
//       contextual, RG banner fix ─────────────────────────────────────────────
console.log('\n[27a] RG — loud-fail banner: position:fixed + safe-area-inset-top…');

// AD-06 regression: showBackendErrorBanner() appends the banner AFTER
// .page-wrapper closes (document.body.appendChild), and position:sticky sticks
// relative to the element's OWN flow position — below the entire app on any
// page taller than one viewport. Fixed to position:fixed (correct for a
// body-level element outside any scrolling flow) + env(safe-area-inset-top)
// so it clears the status bar on the installed app, same as .app-header.
const bannerRule27 = (cssSrc.match(/\.backend-error-banner\{[^}]*\}/) || [''])[0];
assert(bannerRule27.length > 0, '.backend-error-banner rule located');
assert(/position:\s*fixed/.test(bannerRule27),
  `.backend-error-banner is position:fixed, not position:sticky (the actual bug — sticky only offsets within the element's own flow position) — got "${bannerRule27}"`);
assert(!/position:\s*sticky/.test(bannerRule27),
  '.backend-error-banner no longer uses position:sticky at all');
assert(/top:\s*0/.test(bannerRule27) && /left:\s*0/.test(bannerRule27) && /right:\s*0/.test(bannerRule27),
  '.backend-error-banner still pins to all three edges (top/left/right) — regression guard: this must FAIL against the pre-fix rule\'s intent if the edges were ever dropped');
assert(/padding-top:\s*env\(safe-area-inset-top/.test(bannerRule27),
  `.backend-error-banner accounts for env(safe-area-inset-top) so it clears the status bar/Dynamic Island on the installed app (UN-98 pattern) — got "${bannerRule27}"`);
assert(/z-index:\s*200/.test(bannerRule27),
  '.backend-error-banner keeps its z-index:200 (above .app-header\'s z-index:100 and .bottom-nav\'s z-index:100)');

console.log('\n[27b] UN-109 — logo removed from every screen…');

// Markup: the app-logo block (icon + text) must be gone from index.html
// entirely — "no partial keep," Drew's reasoning applies everywhere.
assert(!/class="app-logo"/.test(indexHtmlSrc) && !/app-logo-icon/.test(indexHtmlSrc) && !/app-logo-text/.test(indexHtmlSrc),
  'no app-logo/app-logo-icon/app-logo-text markup survives anywhere in index.html');
// refreshHeader()'s no-week fallback is explicitly EXEMPT — DI: "leave it,
// that edge case wants branding" — and doesn't use the emoji anyway.
assert(/<strong>CFB Pickems<\/strong>/.test(appJsSrc),
  "refreshHeader()'s no-week fallback still prints \"CFB Pickems\" — the one explicitly-kept branding instance, a fresh install with zero weeks");

// CSS: the dead selectors — including their <=480px / <=360px overrides —
// must not survive either.
assert(!/\.app-logo\{/.test(cssSrc) && !/\.app-logo-icon\{/.test(cssSrc) && !/\.app-logo-text/.test(cssSrc),
  'no .app-logo/.app-logo-icon/.app-logo-text CSS rule survives (including narrow-viewport overrides)');

console.log('\n[27c] UN-108 — header balance: header-right is a ROW, header-meta is the left slot…');

// Root cause, verified in the design input: .header-right was
// flex-direction:column — a five-row vertical tower stacked against a single
// small logo. THAT was the actual mechanism behind "unbalanced," not a
// spacing nit. This is the literal fix.
const headerRightRule27 = (cssSrc.match(/\.header-right\{[^}]*\}/) || [''])[0];
assert(headerRightRule27.length > 0, '.header-right rule located');
assert(/flex-direction:\s*row/.test(headerRightRule27),
  `.header-right is flex-direction:row — the actual imbalance mechanism, fixed — got "${headerRightRule27}"`);
assert(!/flex-direction:\s*column/.test(headerRightRule27),
  '.header-right is no longer flex-direction:column (the five-row tower)');

// #header-meta keeps its id (refreshHeader() targets it by id — no JS change
// needed) but is now the LEFT slot, moved OUT of .header-right, ahead of it
// in .app-header-inner so .app-header-inner's existing
// justify-content:space-between creates a real left/right split.
const headerInnerBlock27 = (indexHtmlSrc.match(/<div class="app-header-inner">[\s\S]*?<\/header>/) || [''])[0];
assert(headerInnerBlock27.length > 0, '.app-header-inner block located in index.html');
assert(/id="header-meta"/.test(headerInnerBlock27), '#header-meta still exists with its id — refreshHeader() (app.js) targets it by id');
const metaIdx27 = headerInnerBlock27.indexOf('id="header-meta"');
const rightDivIdx27 = headerInnerBlock27.indexOf('class="header-right"');
assert(metaIdx27 > -1 && rightDivIdx27 > -1 && metaIdx27 < rightDivIdx27,
  '#header-meta is the LEFT slot — it appears BEFORE .header-right in the markup, not nested inside it');
const headerRightMarkup27 = (indexHtmlSrc.match(/<div class="header-right">[\s\S]*?<\/div>\s*<\/div>\s*<\/header>/) || [''])[0];
assert(!/id="header-meta"/.test(headerRightMarkup27),
  '#header-meta is no longer INSIDE .header-right\'s markup — it moved out to become its own slot');
const headerMetaRule27 = (cssSrc.match(/\.header-meta\{[^}]*\}/) || [''])[0];
assert(/text-align:\s*left/.test(headerMetaRule27),
  `.header-meta is text-align:left now that it's the left slot (was text-align:right when it lived inside .header-right) — got "${headerMetaRule27}"`);

console.log('\n[27d] UN-111 — tz/theme visibility uses the REAL tab keys, not "standings"…');

// The naming trap named in the task: the Standings tab's real data-tab value
// is "leaderboard" (index.html nav, asserted in [21] as `navOrder`), not
// "standings" (its human-readable label). Every body[data-tab="..."] selector
// anywhere in styles.css must draw from the REAL key set.
const dataTabRefs27 = [...cssSrc.matchAll(/body\[data-tab="([a-z]+)"\]/g)].map(m => m[1]);
assert(dataTabRefs27.length > 0, 'at least one body[data-tab="..."] CSS rule exists (UN-110/UN-111)');
const validTabKeys27 = new Set(navOrder);   // ['picks','dashboard','chat','leaderboard','rules','commissioner']
assert(dataTabRefs27.every(k => validTabKeys27.has(k)),
  `every body[data-tab="..."] selector uses a REAL nav tab key — got ${JSON.stringify([...new Set(dataTabRefs27)])}, valid keys are ${JSON.stringify([...validTabKeys27])}`);
assert(!dataTabRefs27.includes('standings'),
  'styles.css never uses "standings" as a data-tab value anywhere — the naming trap the task called out by name (the real key is "leaderboard", which this batch correctly never targets since tz/theme are NOT shown on that tab)');

const tzToggleBaseRule27 = (cssSrc.match(/#tz-toggle,#theme-toggle\{[^}]*\}/) || [''])[0];
assert(/display:\s*none/.test(tzToggleBaseRule27), 'tz-toggle/theme-toggle are display:none by default (hidden everywhere unless a tab opts in)');
assert(/body\[data-tab="picks"\] #tz-toggle,\s*\nbody\[data-tab="dashboard"\] #tz-toggle,\s*\nbody\[data-tab="commissioner"\] #tz-toggle\{display:\s*flex\}/.test(cssSrc),
  'tz-toggle shows on picks, dashboard, AND commissioner (kickoff times render in Comm -> Games with no admin-scoped tz control — grounded, not arbitrary)');
assert(/body\[data-tab="picks"\] #theme-toggle,\s*\nbody\[data-tab="dashboard"\] #theme-toggle\{display:\s*inline-flex\}/.test(cssSrc),
  'theme-toggle shows on picks and dashboard ONLY (no Commissioner — theme has no page-content dependency, stays literal to Drew\'s words)');
assert(!/body\[data-tab="commissioner"\] #theme-toggle/.test(cssSrc),
  'theme-toggle is deliberately NOT shown on commissioner (asymmetric from tz on purpose, per the design input\'s reasoning)');

console.log('\n[27e] UN-110 — data-tab wiring: static default, navigateTo(), AD-06 chat sync badge…');

// index.html: data-tab="dashboard" set STATICALLY on <body>, matching the
// hardcoded default-active #page-dashboard, so there's no flash before JS.
assert(/<body class="cfbp-booting" data-tab="dashboard">/.test(indexHtmlSrc),
  'body has data-tab="dashboard" set statically in the HTML (matches the hardcoded default-active #page-dashboard)');

// navigateTo(): sets document.body.dataset.tab, AFTER the chat-disabled
// redirect. Harness limitation (same one already documented in [12] for this
// SAME function): the DOM stub's getElementById/querySelectorAll return
// null/[] so navigateTo()'s full render dispatch can't safely be exercised
// end-to-end here without invoking untested heavy render paths — source-
// verified instead, same as the existing chat-disabled-redirect guard.
const navigateToFnSrc27 = (appJsSrc.match(/function navigateTo\(tab\) \{[\s\S]*?\n\}/) || [''])[0];
assert(navigateToFnSrc27.length > 0, 'navigateTo() function body located for structural assertions');
assert(/document\.body\.dataset\.tab = tab;/.test(navigateToFnSrc27),
  'navigateTo() sets document.body.dataset.tab — drives body[data-tab] CSS (chat\'s header-hidden layout, UN-111\'s tz/theme visibility)');
const redirectIdx27 = navigateToFnSrc27.indexOf("tab = 'dashboard';");
const datasetIdx27 = navigateToFnSrc27.indexOf('document.body.dataset.tab = tab;');
assert(redirectIdx27 > -1 && datasetIdx27 > -1 && redirectIdx27 < datasetIdx27,
  'the chat-disabled redirect (tab reassigned to \'dashboard\') runs BEFORE document.body.dataset.tab is set — otherwise a bounce to dashboard would leave the attribute reading "chat" and the header would stay hidden on the wrong page');

// AD-06 on chat: updateSyncBadge() writes BOTH #sync-badge and
// #chat-sync-badge — one function, two targets, cannot drift (CONVENTIONS
// #21). Source-verified for the same DOM-stub reason as above; behaviorally
// verified below via the REAL _chatSyncBadgeHTML()/setChatSyncStatus() pair.
const updateSyncBadgeFnSrc27 = (appJsSrc.match(/function updateSyncBadge\(status\) \{[\s\S]*?\n\}/) || [''])[0];
assert(updateSyncBadgeFnSrc27.length > 0, 'updateSyncBadge() function body located');
assert(/getElementById\('sync-badge'\)/.test(updateSyncBadgeFnSrc27), 'updateSyncBadge() still writes #sync-badge (the header badge)');
assert(/getElementById\('chat-sync-badge'\)/.test(updateSyncBadgeFnSrc27), 'updateSyncBadge() ALSO writes #chat-sync-badge (chat\'s own copy, since .app-header — and #sync-badge with it — is hidden on that tab)');
assert(/setChatSyncStatus\(status\)/.test(updateSyncBadgeFnSrc27), 'updateSyncBadge() calls setChatSyncStatus() so a FRESH renderChatPage() reflects the current status immediately rather than waiting for the next sync event');

assert(typeof chatUi.setChatSyncStatus === 'function', 'chat-ui.js exports setChatSyncStatus');
assert(typeof chatUi._chatSyncBadgeHTML === 'function', 'chat-ui.js exports _chatSyncBadgeHTML (test-only) — exercising the REAL conditional, not just regex-matching template source');
chatUi.setChatSyncStatus(null);
assert(chatUi._chatSyncBadgeHTML() === '<span id="chat-sync-badge" class="sync-badge"></span>',
  'unknown/no status: the badge span exists (beside the BETA badge) but renders no text and no sync-error class');
chatUi.setChatSyncStatus('syncing');
assert(!/sync-error/.test(chatUi._chatSyncBadgeHTML()) && !/Sync error/.test(chatUi._chatSyncBadgeHTML()),
  "'syncing' does not surface text on chat's badge — only 'error' does, so chat chrome stays minimal in the normal case");
chatUi.setChatSyncStatus('synced');
assert(!/sync-error/.test(chatUi._chatSyncBadgeHTML()), "'synced' renders no badge text either");
chatUi.setChatSyncStatus('error');
const errBadge27 = chatUi._chatSyncBadgeHTML();
assert(/id="chat-sync-badge"/.test(errBadge27) && /class="sync-badge sync-error"/.test(errBadge27) && /⚠️ Sync error/.test(errBadge27),
  "'error' status DOES surface on chat's own badge — the hard loud-fail rule (AD-06) holds even with .app-header hidden on this tab");
chatUi.setChatSyncStatus(null);   // reset — don't leak state into any test that runs after this one

// The badge is wired into renderChatPage()'s header row, beside the BETA badge.
assert(/<h2>Chat <span class="badge badge-beta"[^>]*>BETA<\/span> \$\{_chatSyncBadgeHTML\(\)\}<\/h2>/.test(chatUiSrc),
  'renderChatPage() renders _chatSyncBadgeHTML() inline in the <h2>, beside the BETA badge (design input placement)');

// ── 28. UN-114 — who reacted with what: always-visible names + tap target ────
console.log('\n[28] UN-114 — reaction attribution: always-visible names, escaped, 40px pill…');

// Exercise the REAL rendering function, not a source regex — multiple emoji,
// multiple reactors per emoji, and a reactor "name" (nameOf() falls back to
// the raw id when no player/nickname matches) containing HTML, to prove
// escaping actually happens at render time.
const fakeReactMsg = {
  id: 'react_test_1', reactions: {
    '🔥': ['<script>xss</script>', 'p2'],
    '👍': ['p3'],
  },
};
const reactHTML28 = chatUi._reactionsHTML(fakeReactMsg, null);
assert(/class="chat-reaction-names"/.test(reactHTML28), '.chat-reaction-names element renders beneath the pill row');
assert(!/<script>xss<\/script>/.test(reactHTML28) && /&lt;script&gt;xss&lt;\/script&gt;/.test(reactHTML28),
  'a reactor name containing HTML is escaped, not injected verbatim — escHtml() around every piece of user data (CONVENTIONS #12)');
assert(/🔥 &lt;script&gt;xss&lt;\/script&gt;, p2/.test(reactHTML28),
  'multiple reactors on the SAME emoji are joined by ", "');
assert(/🔥[\s\S]* · 👍 p3/.test(reactHTML28), 'multiple emoji GROUPS are joined by " · "');
assert(!/title="/.test(reactHTML28),
  'the react pill no longer carries a `title` tooltip — REMOVED per design input (tooltips do not fire on touch)');

// Empty reactions: no stray empty .chat-reaction-names div.
assert(chatUi._reactionsHTML({ id: 'no_react', reactions: {} }, null) === '',
  'a message with no reactions renders neither the pill row nor the names line');

// Computed-constraint (Testing Protocol step 12), same technique as .chat-pill
// (v0.17.2) / .chat-act (v0.17.4) — parse the ACTUAL declared px value.
//
// v0.17.5: the tap target is now an INVISIBLE ::after overlay, not the pill's
// own min-height. The first version grew the visible pill to 40px, which —
// stacked with UN-114's names line — added back almost exactly the 42px UN-113
// had just freed, so messages with reactions got NO density gain (4.58 -> 4.60
// per screen measured). Hit area and visible size are now decoupled: assert the
// overlay's height, and assert the pill itself did NOT regain a tall min-height.
const reactPillRule28 = (cssSrc.match(/\.chat-react-pill\{[^}]*\}/) || [''])[0];
const pillHitRule28 = (cssSrc.match(/\.chat-react-pill::after\{[^}]*\}/) || [''])[0];
const pillHitH28 = Number((pillHitRule28.match(/height:\s*(\d+)px/) || [])[1] || 0);
assert(pillHitH28 >= 40, `.chat-react-pill tap target >= 40px via ::after overlay (CONVENTIONS #17 / UN-114) — got ${pillHitH28}`);
assert(/position:\s*relative/.test(reactPillRule28),
  '.chat-react-pill is a positioning context, so the ::after hit overlay anchors to it');
const pillOwnMinH28 = Number((reactPillRule28.match(/min-height:\s*(\d+)px/) || [])[1] || 0);
assert(pillOwnMinH28 < 30,
  `the pill's VISIBLE height stays compact so UN-113's density gain survives — got min-height ${pillOwnMinH28}px`);
assert(!/width:\s*40px/.test(reactPillRule28),
  '.chat-react-pill keeps a content-driven width (min-height only, not a fixed box) — the compact pill shape is intentional, per design input');

// ── 29. UN-112 — chat epoch clear (LAUNCH BLOCKER) ────────────────────────────
console.log('\n[29a] UN-112 — epoch predicate: default-when-missing, unconditional hide, pinned divergence…');
chat._resetForTest();
storage.saveSetting('chatEpochSeq', 0);
storage.saveSetting('chatEpochSetAt', null);
localStorage.removeItem('cfbp_chat_epoch_applied');

assert(dm.DEFAULT_SETTINGS.chatEpochSeq === 0 && dm.DEFAULT_SETTINGS.chatEpochSetAt === null,
  'DEFAULT_SETTINGS carries chatEpochSeq:0 / chatEpochSetAt:null');
assert(chat.getChatEpochSeq() === 0,
  'chatEpochSeq defaults to 0 when absent from a stored settings blob (CONVENTIONS #10 — mirrors retention\'s own default-when-missing test, §[10])');
assert(chat.isHiddenByEpoch({ seq: 1 }) === false, 'epoch OFF (0) hides nothing, no matter the seq');

// Fixed log spanning an epoch boundary, incl. one message PINNED during
// "testing" — the whole point of the divergence-from-retention assertion.
chat.ingest([
  ev({ id: 'ep1', seq: 201, ts: Date.now() - 5000, body: 'pre-launch test chatter', author: 'p1' }),
  ev({ id: 'ep2', seq: 202, ts: Date.now() - 4000, body: 'more testing, right at the boundary', author: 'p2' }),
  ev({ id: 'ep3', seq: 203, ts: Date.now() - 3000, body: 'real message, after launch', author: 'p3' }),
]);
chat.ingest([{ id: 'ep1pin', type: 'pin', targetId: 'ep1', author: 'p1', notify: false }]);
assert(chat.getMessage('ep1').pinned === true,
  'fixture check: ep1 is actually pinned before trusting the divergence assertion below');

storage.saveSetting('chatEpochSeq', 202);   // hides ep1 (201, below) and ep2 (202, AT the boundary); ep3 (203) survives
assert(chat.getChatEpochSeq() === 202, 'getChatEpochSeq reads the synced setting through the storage seam');
assert(chat.isHiddenByEpoch(chat.getMessage('ep1')) === true, 'a message BELOW the epoch is hidden');
assert(chat.isHiddenByEpoch(chat.getMessage('ep2')) === true, 'a message exactly AT the epoch seq is hidden ("at or below", not strictly below)');
assert(chat.isHiddenByEpoch(chat.getMessage('ep3')) === false, 'a message ABOVE the epoch is visible');

// THE deliberate divergence from retention — asserted explicitly so nobody
// "fixes" it later by copying isHiddenByRetention's pinned exemption.
assert(chat.isHiddenByEpoch(chat.getMessage('ep1')) === true,
  'a PINNED message at/below the epoch is STILL HIDDEN — unlike retention, epoch carries NO pinned exemption (a pin made during testing is still test content)');

// getMessages() — UNCONDITIONAL. No respectRetention-style opt-in flag exists
// or is honored for epoch; passing NOTHING still hides it (contrast with §[10]'s
// rtUnfiltered check, which deliberately proves retention's opt-in leaves data
// visible without the flag — epoch must do the opposite).
const epUnfiltered = chat.getMessages({ tag: 'all' }).map(m => m.id);
assert(!epUnfiltered.includes('ep1') && !epUnfiltered.includes('ep2'),
  'getMessages() hides epoch-covered messages UNCONDITIONALLY — composed into the choke point itself, not behind an opt-in flag');
assert(epUnfiltered.includes('ep3'), 'getMessages() still returns messages after the epoch');
const epPinnedView = chat.getMessages({ tag: 'all', pinned: true }).map(m => m.id);
assert(!epPinnedView.includes('ep1'),
  'the Hall of Records (pinned) view does not resurrect an epoch-hidden pinned message either — same unconditional check');

// isUnreadFor() (via unreadCount) — the second and last choke point.
localStorage.setItem('cfbp_chat_lastseen2', JSON.stringify({ seq: 0, byTag: {} }));
const epUnread = chat.unreadCount('someone_else', 'all');
assert(epUnread === 1,
  `unread count excludes BOTH epoch-hidden messages (ep1, ep2) and counts only the real one after it (ep3) — got ${epUnread}`);
localStorage.removeItem('cfbp_chat_lastseen2');

// Reversible — nothing was ever deleted (same guarantee retention makes).
storage.saveSetting('chatEpochSeq', 0);
const epRestored = chat.getMessages({ tag: 'all' }).map(m => m.id);
assert(epRestored.includes('ep1') && epRestored.includes('ep2'),
  'setting the epoch back to 0 immediately restores the hidden messages — nothing was deleted');

console.log('\n[29b] UN-112 — "load earlier" hides once backfill can only surface epoch-hidden messages…');
chat._resetForTest();
storage.saveSetting('chatEpochSeq', 0);
assert(chat.backfillBlockedByEpoch() === false, 'epoch OFF: backfill is never blocked by epoch');
chat.ingest([ev({ id: 'bf1', seq: 50, ts: Date.now(), body: 'oldest loaded', author: 'p1' })]);
storage.saveSetting('chatEpochSeq', 100);
assert(chat.backfillBlockedByEpoch() === true,
  'the oldest loaded message (seq 50) is at/below the epoch (100) — further backfill could only surface epoch-hidden messages, so the control hides');
chat.ingest([ev({ id: 'bf2', seq: 150, ts: Date.now(), body: 'newer', author: 'p1' })]);
assert(chat.backfillBlockedByEpoch() === true,
  'backfillLow tracks the MINIMUM seq ingested so far — a later, higher-seq message does not un-block it');
storage.saveSetting('chatEpochSeq', 10);
assert(chat.backfillBlockedByEpoch() === false,
  'once the epoch is below the oldest loaded message, backfill unblocks again — unlike retention\'s rolling window, real history can still exist mid-season');
assert(/\(retentionOn\(\) \|\| backfillBlockedByEpoch\(\)\) \? '' : '<button class="chat-load-older"/.test(chatUiSrc),
  '"load earlier" is hidden when EITHER retention is on OR the epoch blocks further backfill');

console.log('\n[29c] UN-112 (DI-112b) — device-local self-heal reaches all six phones…');
chat._resetForTest();
storage.saveSetting('chatEnabled', true);
storage.saveSetting('chatEpochSeq', 0);
localStorage.removeItem('cfbp_chat_epoch_applied');
localStorage.removeItem('cfbp_chat_lastseen2');
localStorage.removeItem('cfbp_chat_outbox2');

// Simulate the exact hazard: a stale queued send AND a stale-but-lower read
// cursor left over from before another device set the epoch.
localStorage.setItem('cfbp_chat_outbox2', JSON.stringify([
  { id: 'stale_send_1', type: 'message', body: 'test message from before the wipe', author: 'p1', gameTag: '', notify: true },
]));
localStorage.setItem('cfbp_chat_lastseen2', JSON.stringify({ seq: 40, byTag: { g1: 40 } }));
storage.saveSetting('chatEpochSeq', 200);   // higher than this device's local watermark (absent = 0) — self-heal must fire

const preOutboxRaw29 = JSON.parse(localStorage.getItem('cfbp_chat_outbox2'));
assert(preOutboxRaw29.length === 1, 'fixture check: the stale outbox message is actually queued before initChat() runs');

chat.initChat('p1');

assert(JSON.parse(localStorage.getItem('cfbp_chat_outbox2') || '[]').length === 0,
  '_applyEpochLocally empties AND PERSISTS the outbox — nothing stale can flush into the freshly-cleared room (this is what actually reaches the other five phones)');
const lsAfterHeal29 = JSON.parse(localStorage.getItem('cfbp_chat_lastseen2'));
assert(lsAfterHeal29.seq === 200 && Object.keys(lsAfterHeal29.byTag).length === 0,
  `_applyEpochLocally fast-forwards K_LASTSEEN to {seq: epochSeq, byTag: {}} — got ${JSON.stringify(lsAfterHeal29)}`);
assert(Number(localStorage.getItem('cfbp_chat_epoch_applied')) === 200,
  'the device-local watermark (cfbp_chat_epoch_applied) is updated so this self-heal runs exactly once per epoch bump');

// Idempotency — a second initChat() at the SAME epoch must NOT re-run the
// heal (e.g. must not re-empty an outbox the player has since started using).
localStorage.setItem('cfbp_chat_outbox2', JSON.stringify([
  { id: 'fresh_send_1', type: 'message', body: 'a legit post-clear message', author: 'p1', gameTag: '', notify: true },
]));
chat.initChat('p1');
assert(JSON.parse(localStorage.getItem('cfbp_chat_outbox2') || '[]').length === 1,
  'a second initChat() at the SAME epoch does not re-run the heal — a legitimately queued post-clear message survives');
chat._resetForTest();
localStorage.removeItem('cfbp_chat_epoch_applied');
localStorage.removeItem('cfbp_chat_lastseen2');
localStorage.removeItem('cfbp_chat_outbox2');
storage.saveSetting('chatEpochSeq', 0);

// Structural: the epoch check must run BEFORE loadOutbox() AND flushOutbox()
// in source order — this is the actual ordering hazard (flushOutbox() fires
// unconditionally later in the same function).
const initChatFnSrc29raw = (chatRetSrc.match(/export function initChat\(selfId\) \{[\s\S]*?\n\}/) || [''])[0];
assert(initChatFnSrc29raw.length > 0, 'initChat() function body located for structural assertions');
// Comment-stripped (reuses the SAME `code` filter as §[7]/[26a]) — the
// explanatory comment above the epoch check legitimately mentions
// "loadOutbox()" and "flushOutbox()" BY NAME before the real calls, which
// would otherwise fool a plain indexOf() into seeing the wrong order.
const initChatFnSrc29 = stripComments(initChatFnSrc29raw);
const epochCheckIdx29 = initChatFnSrc29.indexOf('_applyEpochLocally(epochSeq)');
const loadOutboxIdx29 = initChatFnSrc29.indexOf('loadOutbox()');
const flushOutboxIdx29 = initChatFnSrc29.lastIndexOf('flushOutbox()');
assert(epochCheckIdx29 > -1 && loadOutboxIdx29 > -1 && flushOutboxIdx29 > -1 &&
  epochCheckIdx29 < loadOutboxIdx29 && loadOutboxIdx29 < flushOutboxIdx29,
  'initChat() runs the epoch self-heal check BEFORE loadOutbox() AND before flushOutbox() — a device with a stale queued message never gets the chance to load/flush it into the freshly-cleared room');

console.log('\n[29d] UN-112 — startFreshChat() loud-fails, never a guessed/partial epoch…');
chat._resetForTest();
storage.saveSetting('chatEpochSeq', 0);
storage.saveSetting('chatEpochSetAt', null);
// No backend is configured in this harness (no config.json loaded) — fetchHead()
// must throw BEFORE any setting is written.
let startFreshThrew = false;
try { await chat.startFreshChat(); } catch { startFreshThrew = true; }
assert(startFreshThrew, 'startFreshChat() throws rather than silently succeeding when the live head cannot be fetched');
assert(chat.getChatEpochSeq() === 0 && storage.getSettings().chatEpochSetAt === null,
  'a failed startFreshChat() writes NOTHING — chatEpochSeq/chatEpochSetAt remain untouched, never a partial or guessed epoch (loud-fail)');
assert(/const \{ head \} = await fetchHead\(\);/.test(chatRetSrc) &&
  chatRetSrc.indexOf('const { head } = await fetchHead();') < chatRetSrc.indexOf("saveSetting('chatEpochSeq'"),
  'startFreshChat() fetches the LIVE head BEFORE writing chatEpochSeq — never guesses');

chat._resetForTest();
storage.saveSetting('chatEnabled', true);

console.log('\n[29e] UN-112 — commissioner Data-tab copy: correct factory-reset confirm text, wired into both controls…');
assert(/chat-epoch-clear-btn/.test(appJsSrc), 'the repeatable Data-tab "Clear Chat" control exists');
assert(/chat rows are hidden, not deleted — reversible from the Data tab/.test(appJsSrc),
  'the factory-reset confirm copy no longer claims to delete ALL data now that chat is wired in (both the password prompt and the FINAL WARNING)');
const resetDemoBlock29 = (appJsSrc.match(/document\.getElementById\('reset-demo-btn'\)\?\.addEventListener\('click', async e => \{[\s\S]*?\n  \}\);/) || [''])[0];
assert(resetDemoBlock29.length > 0, 'reset-demo-btn click handler located');
assert(/startFreshChat\(\)/.test(resetDemoBlock29), 'the "⚠️ Full Factory Reset" button is wired into the chat epoch clear (satisfies Drew\'s literal words)');
assert(/chat could not be cleared/.test(resetDemoBlock29),
  'a failed chat clear inside factory reset gets its OWN distinct message — never folded into a blanket success toast');

// ── 30. UN-115 — picks page opens at the TOP after login/edit/submit ─────────
console.log('\n[30] UN-115 — picks page scrolls to top after login/edit/submit, ordering matters…');
const doLoginBlock30 = (appJsSrc.match(/const doLogin = \(\) => \{[\s\S]*?\n  \};/) || [''])[0];
assert(doLoginBlock30.length > 0, 'doLogin() success-branch block located for structural assertions');
const renderIdx30 = doLoginBlock30.indexOf('renderPicksPage();');
const scrollIdx30 = doLoginBlock30.indexOf('window.scrollTo({ top: 0 });');
const resumeIdx30 = doLoginBlock30.indexOf('resumeChatAfterLogin();');
assert(renderIdx30 > -1 && scrollIdx30 > -1 && resumeIdx30 > -1 &&
  renderIdx30 < scrollIdx30 && scrollIdx30 < resumeIdx30,
  'doLogin(): window.scrollTo({top:0}) runs AFTER renderPicksPage() (scrolling the NEW DOM, not the tree about to be replaced) and BEFORE resumeChatAfterLogin() — the exact placement named in the design input');
assert(!/scrollTo\(\{ top: 0, behavior: 'smooth' \}\)/.test(doLoginBlock30),
  "doLogin()'s scrollTo is instant, not smooth — smooth is reserved for same-panel tab switches");

const editPicksBlock30 = (appJsSrc.match(/document\.getElementById\('edit-picks-btn'\)\?\.addEventListener\('click', \(\) => \{[\s\S]*?\n  \}\);/) || [''])[0];
assert(editPicksBlock30.length > 0, 'edit-picks-btn click handler located');
const editRenderIdx30 = editPicksBlock30.indexOf('renderPicksPage();');
const editScrollIdx30 = editPicksBlock30.indexOf('window.scrollTo({ top: 0 });');
assert(editRenderIdx30 > -1 && editScrollIdx30 > -1 && editRenderIdx30 < editScrollIdx30,
  'Edit My Picks: scrollTo runs AFTER renderPicksPage() (DI-115b — same driver, beyond the literal ask: the form replaces the submitted view)');

const submitPicksFnSrc30 = (appJsSrc.match(/function submitPicks\(week, games\) \{[\s\S]*?\n\}/) || [''])[0];
assert(submitPicksFnSrc30.length > 0, 'submitPicks() function body located');
const submitRenderIdx30 = submitPicksFnSrc30.indexOf('renderPicksPage();');
const submitScrollIdx30 = submitPicksFnSrc30.indexOf('window.scrollTo({ top: 0 });');
assert(submitRenderIdx30 > -1 && submitScrollIdx30 > -1 && submitRenderIdx30 < submitScrollIdx30,
  'submitPicks(): scrollTo runs AFTER renderPicksPage() inside the SAME setTimeout callback (DI-115b — the submitted view replaces the form)');

// 30b. F2 — the epochApplied subscriber must be registered BEFORE initChat().
// initChat() synchronously fires notify('epochApplied') via _applyEpochLocally,
// and that call stamps cfbp_chat_epoch_applied, so it is idempotent and can
// never fire again. Registering after meant the chat-ui half of DI-112b never
// ran on any device except Drew's own (where startFreshChat calls it post-boot).
console.log('\n[30b] Epoch heal — subscriber registered before the engine boots…');
const initUiSrc = (chatUiSrc.match(/export function initChatUI\(\)[\s\S]*?\n\}/) || [''])[0];
const onChatAt = initUiSrc.indexOf('onChat(');
const initChatAt = initUiSrc.indexOf('initChat(me())');
assert(onChatAt > -1 && initChatAt > -1 && onChatAt < initChatAt,
  'initChatUI registers its onChat subscriber BEFORE calling initChat(me())');

// 30c. F3 — a failed chat clear during factory reset must NOT un-hide chat.
// resetToDemo() writes DEFAULT_SETTINGS, resetting chatEpochSeq to 0. If the
// awaited startFreshChat() then throws (Apps Script cold start, a NORMAL
// condition at 10-20s), a previously hidden test log becomes visible again on
// every device — the opposite of what UN-112 exists to do.
const appSrcF3 = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
const resetHandlerSrc = appSrcF3.slice(appSrcF3.indexOf("getElementById('reset-demo-btn')"), appSrcF3.indexOf("getElementById('reset-demo-btn')") + 3500);
assert(/_prevEpochSeq\s*=\s*getChatEpochSeq\(\)/.test(resetHandlerSrc),
  'the factory-reset handler captures the prior epoch BEFORE resetToDemo() wipes it');
const capAt = resetHandlerSrc.indexOf('_prevEpochSeq = getChatEpochSeq()');
// Match the CALL, not the mention of it in the explanatory comment above.
const resetAt = resetHandlerSrc.indexOf('resetToDemo(); clearSession();');
assert(capAt > -1 && resetAt > -1 && capAt < resetAt,
  'the capture happens before resetToDemo(), not after');
assert(/catch\s*\{[\s\S]{0,400}saveSetting\('chatEpochSeq',\s*_prevEpochSeq\)/.test(resetHandlerSrc),
  'a failed chat clear RESTORES the prior epoch instead of leaving it at 0');

// ── 31. RG-24 — a synced SETTINGS field must not be reverted by another ──────
//        device's unrelated settings write (the UN-112 epoch field failure).
//
// `cfbp_settings` is ONE seam key holding ~17 independent fields, and
// `saveSetting()` is a read-modify-write of the whole blob. AD-04's
// last-write-wins and AD-08's stale-mirror rebase are both KEY-granular, so a
// device whose mirror predates another device's change pushes its entire stale
// view of all 17 fields — silently reverting the 16 it never touched. That is
// how a cleared chat came back days later: chatEpochSeq went back to 0.
//
// This drives the REAL backend.js hydrate/flushPush against a stubbed Sheet,
// through the REAL storage.js seam and the REAL chat.js accessor. It is built
// to FAIL against the pre-fix tree (confirmed: 6 failures, "got 0").
console.log('\n[31] RG-24 — one device\'s settings write must not revert another device\'s field…');
const _fetch31 = globalThis.fetch;
const _mode31  = storage.getBackendMode();
const backend31 = mods['backend'];

let SHEET31 = {};
globalThis.fetch = async (url, opts) => {
  const req = JSON.parse(opts.body);
  if (req.action === 'getAll') return { ok: true, json: async () => ({ ok: true, data: JSON.parse(JSON.stringify(SHEET31)) }) };
  if (req.action === 'setMany') { Object.entries(req.entries).forEach(([k, v]) => { SHEET31[k] = v; }); return { ok: true, json: async () => ({ ok: true }) }; }
  throw new Error('unexpected action ' + req.action);
};

// A settings blob as it exists on a device whose mirror predates the change.
const PRE31 = {
  almaMaters: [], weeklyGameCount: 10, candidateGameCount: 25,
  weeklyPrize: 'x', seasonPrize: 'y', adminPasswordHash: 'z',
  storageMode: 'local', season: '2026', customRules: null,
  autoRefreshInterval: 60, timezone: 'CT', chatRetentionDays: 0,
  chatEpochSeq: 0, chatEpochSetAt: null, chatEnabled: true,
  randomizePicksEnabled: false,
};

/** Put device B on a stale pre-change mirror while the Sheet already carries
 *  the change another device made. Mirrors app.js's boot order exactly:
 *  primeFromMirror() → setBackendMode('googleSheets') → …stale window… */
function bootStale31(sheetSettings) {
  SHEET31 = {
    cfbp_settings: JSON.parse(JSON.stringify(sheetSettings)),
    cfbp_players: [{ id: 'p1', displayName: 'Drew' }],
    cfbp_weeks: [{ weekId: 'w1', status: 'open' }],
  };
  localStorage.setItem('cfbp_sheet_mirror', JSON.stringify({
    at: '2026-08-05T00:00:00.000Z',
    data: {
      cfbp_settings: JSON.parse(JSON.stringify(PRE31)),
      cfbp_players: [{ id: 'p1', displayName: 'Drew' }],
      cfbp_weeks: [{ weekId: 'w1', status: 'open' }],
    },
  }));
  backend31.setBackendConfig('https://example.test/exec', 'tok');
  backend31.primeFromMirror();
  storage.setBackendMode('googleSheets');
}

// 31a — the reported bug, end to end, with the ACTUAL boot-time trigger.
// app.js seeds `dashboardLayout` at boot on any viewport <600px whose settings
// blob lacks it — a settings write issued BEFORE hydrate, with zero user input.
const CLEARED31 = { ...PRE31, chatEpochSeq: 66, chatEpochSetAt: '2026-08-12T03:34:02.931Z' };
bootStale31(CLEARED31);
assert(backend31.isMirrorStale() === true, 'fixture check: the mirror is stale (writes are HELD, AD-08) before hydrate lands');
storage.saveSetting('dashboardLayout', 'compact');
await backend31.hydrate();
assert(chat.getChatEpochSeq() === 66,
  `after hydrate, a device that wrote an UNRELATED settings field still reads the cleared epoch — got ${chat.getChatEpochSeq()}`);
await backend31.flushPush();
assert(SHEET31.cfbp_settings.chatEpochSeq === 66,
  `the Sheet's chatEpochSeq survives another device's unrelated settings write — got ${JSON.stringify(SHEET31.cfbp_settings.chatEpochSeq)} (0 = the cleared chat comes back on every device)`);
assert(SHEET31.cfbp_settings.chatEpochSetAt === '2026-08-12T03:34:02.931Z',
  `chatEpochSetAt survives too — got ${JSON.stringify(SHEET31.cfbp_settings.chatEpochSetAt)}`);
assert(SHEET31.cfbp_settings.dashboardLayout === 'compact',
  'the writing device\'s OWN intent still reaches the Sheet — the held write is rebased, not discarded (AD-08 unchanged)');

// 31b — the two other synced settings named as sharing this failure mode.
// chatEnabled is the commissioner's emergency chat kill switch: a silent
// revert turns chat back ON for the whole league.
bootStale31({ ...PRE31, chatEnabled: false });
storage.saveSetting('dashboardLayout', 'compact');
await backend31.hydrate();
await backend31.flushPush();
assert(SHEET31.cfbp_settings.chatEnabled === false,
  `chatEnabled (the emergency kill switch) survives another device's unrelated settings write — got ${JSON.stringify(SHEET31.cfbp_settings.chatEnabled)}`);

bootStale31({ ...PRE31, randomizePicksEnabled: true });
storage.saveSetting('timezone', 'ET');
await backend31.hydrate();
await backend31.flushPush();
assert(SHEET31.cfbp_settings.randomizePicksEnabled === true,
  `randomizePicksEnabled survives another device's unrelated settings write — got ${JSON.stringify(SHEET31.cfbp_settings.randomizePicksEnabled)}`);
assert(SHEET31.cfbp_settings.timezone === 'ET',
  'and the writing device\'s own field still lands');

// 31c — a WHOLE-BLOB write (resetToDemo) must still replace the whole blob.
// The field-scoped rebase must not turn a deliberate factory reset into a
// one-field patch.
bootStale31({ ...PRE31, chatEpochSeq: 66, weeklyGameCount: 12 });
storage.saveSettings({ ...dm.DEFAULT_SETTINGS });
await backend31.hydrate();
await backend31.flushPush();
assert(SHEET31.cfbp_settings.weeklyGameCount === dm.DEFAULT_SETTINGS.weeklyGameCount &&
       SHEET31.cfbp_settings.chatEpochSeq === 0,
  'a whole-blob write (saveSettings / resetToDemo) still replaces every field — field-scoping never downgrades an explicit full-blob write');

// 31d — non-object keys are untouched by any of this.
bootStale31(PRE31);
storage.saveAllPicks([{ id: 'k1', weekId: 'w1', playerId: 'p1' }]);
await backend31.hydrate();
await backend31.flushPush();
assert(Array.isArray(SHEET31.cfbp_picks) && SHEET31.cfbp_picks.length === 1,
  'array-valued keys (picks) still rebase and push whole — field-scoping applies only where a field list was declared');

// 31e — source-level: the seam must DECLARE the changed field rather than let
// the backend guess it by diffing (a diff cannot tell a real edit from
// getSettings()'s DEFAULT_SETTINGS spread materializing an absent field).
const storageSrc31 = await readFile(new URL('./js/storage.js', import.meta.url), 'utf8');
assert(/export function saveSetting\(k,\s*v\)\s*\{[^}]*save\(KEYS\.SETTINGS,\s*s,\s*\[k\]\)/.test(storageSrc31),
  'saveSetting() names the single field it changed when writing the blob (no diff heuristic in backend.js)');

// restore harness state
storage.setBackendMode(_mode31);
backend31.clearBackendConfig();
backend31.clearMirror();
globalThis.fetch = _fetch31;
chat._resetForTest();

// ── 32. RG-25 / RG-26 — ONE notification acknowledgement, and a toast that ───
//        does not survive navigation onto the chat tab.
//
// Two device-local surfaces announce the same new message: the floating toast
// (every tab except chat + dashboard) and the dashboard teaser. They carried
// TWO independent dismissal states — the toast's was a DOM node, the teaser's
// was `cfbp_chat_teaser_dismiss_seq` — so dismissing one never informed the
// other (RG-25). Separately, showToast() evaluates its chat-page suppression
// once, at CREATION; nothing re-evaluated it on navigation, so a toast raised
// on another tab sat over the chat feed (RG-26).
//
// Browser-reproduced at 390x844 before the fix; these assertions drive the
// real functions and the real shared watermark.
console.log('\n[32] RG-25/RG-26 — one acknowledgement across both notification surfaces…');
const chatUi32 = mods['chat-ui'];
chat._resetForTest();
storage.saveSetting('chatEnabled', true);
storage.saveSetting('chatEpochSeq', 0);
storage.saveSetting('chatRetentionDays', 0);
localStorage.removeItem('cfbp_chat_teaser_dismiss_seq');
localStorage.removeItem('cfbp_chat_lastseen2');
storage.setSession('p2', false, true);          // viewer is p2; p1 is the poster

// Explicit, spaced timestamps — NOT Date.now() twice. chat.js's orderKey()
// is `ts * 1e7 + seq`, which for a real epoch ms exceeds Number.MAX_SAFE_INTEGER,
// so the seq tiebreaker is lost to float precision and two messages in the
// SAME millisecond order by insertion. That made this fixture flaky. (Flagged
// to Drew as a separate latent finding — not this batch's bug.)
const T32 = 1786500000000;
chat.ingest([ev({ id: 'n1', seq: 701, ts: T32, body: 'first ping', author: 'p1' })]);

assert(typeof chatUi32._notifAckSeq === 'function' && typeof chatUi32._ackNotif === 'function',
  'chat-ui exports the shared notification-acknowledgement accessors (one concept, one state — AD-20 applied to a UI state)');

const teaserBefore32 = chatUi32.dashboardChatTeaserHTML();
assert(/first ping/.test(teaserBefore32),
  'fixture check: the dashboard teaser announces the new message before anything is dismissed');

// THE BUG: this is exactly what the toast's ✕ handler now calls. Before the
// fix the toast dismissal wrote nothing shared, so the teaser kept announcing
// the same message on the next tab.
chatUi32._ackNotif?.(701);
assert(chatUi32._notifAckSeq?.() === 701,
  `dismissing a toast records the acknowledgement in the SHARED watermark — got ${chatUi32._notifAckSeq?.()}`);
assert(chatUi32.dashboardChatTeaserHTML() === '',
  'after the toast is dismissed, the dashboard teaser no longer announces that same message (the reported bug: "dismiss it in one tab, it is still present in another")');

// Monotonic — a dismissal never rewinds (RG-14's lesson, same file family).
chatUi32._ackNotif?.(300);
assert(chatUi32._notifAckSeq?.() === 701,
  'the acknowledgement watermark is monotonic — a lower seq never rewinds it');

// Genuinely newer activity still gets announced (UN-93's requirement survives).
chat.ingest([ev({ id: 'n2', seq: 702, ts: T32 + 60000, body: 'second ping', author: 'p1' })]);
assert(/second ping/.test(chatUi32.dashboardChatTeaserHTML()),
  'a strictly newer message still reappears — the shared watermark suppresses only what was acknowledged (UN-93 unchanged)');

// The other direction: the toast must not re-announce something already
// acknowledged on the teaser.
const uiSrc32 = stripComments(chatUiSrc);

// ── BEHAVIOURAL, not textual ────────────────────────────────────────────────
// These assertions used to match the source: `chat-toast-dismiss[\s\S]{0,200}?
// acknowledge\(\)`. That matches the handler's NAME, not its effect. Verified
// 2026-08-12 — gutting `acknowledge()` to a bare `advance()` (the shared
// watermark never written, i.e. Drew's exact reported bug restored) passed the
// full suite 552/552. RG-12 recurred for precisely this reason: a recorded
// protection that no test could distinguish from its own absence.
//
// Everything below drives the REAL showToast/drainToast through a DOM harness
// and asserts observable state. Confirmed to fail against a gutted handler.
const _realST = globalThis.setTimeout, _realCT = globalThis.clearTimeout;
const _realDoc = globalThis.document;
let TIMERS32 = [];
function mkEl32(tag = 'div') {
  const L = {};
  return {
    tagName: tag, id: '', className: '', dataset: {}, style: {},
    _html: '', _removed: false, _children: [], _dismissBtn: null,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    set innerHTML(v) { this._html = v; },
    get innerHTML() { return this._html; },
    addEventListener(t, fn) { (L[t] ||= []).push(fn); },
    removeEventListener() {},
    appendChild(c) { this._children.push(c); return c; },
    remove() { this._removed = true; DOC32.body._children = DOC32.body._children.filter(x => x !== this); },
    querySelector(sel) {
      if (sel === '.chat-toast-dismiss' && /chat-toast-dismiss/.test(this._html)) {
        return (this._dismissBtn ||= mkEl32('button'));
      }
      return null;
    },
    querySelectorAll: () => [], closest: () => null,
    _fire(t) { (L[t] || []).forEach(fn => fn({ stopPropagation() {} })); },
    _has(t) { return (L[t] || []).length > 0; },
  };
}
const DOC32 = {
  body: mkEl32('body'),
  createElement: t => mkEl32(t),
  // Only #page-chat.active / #page-dashboard.active / .nav-item are queried;
  // all must miss so the toast is NOT suppressed on this fixture page.
  querySelector: () => null, querySelectorAll: () => [],
  getElementById: id => DOC32.body._children.find(c => c.id === id && !c._removed) || null,
  addEventListener() {}, removeEventListener() {}, hidden: false,
};
globalThis.document = DOC32;
globalThis.setTimeout = (fn, ms) => { TIMERS32.push({ fn, ms, dead: false }); return TIMERS32.length - 1; };
globalThis.clearTimeout = id => { if (TIMERS32[id]) TIMERS32[id].dead = true; };
const liveToast32 = () => DOC32.getElementById('chat-toast');

/** Fixture hygiene: earlier suites can leave U.toastShowing true, which makes
 *  showToast() queue silently instead of mounting. Uses the dedicated reset
 *  seam, NOT _clearToastsForChatPage() — resetting state with the function
 *  under test would make a mutation crash the fixture instead of failing the
 *  assertion that names the defect. */
function reset32() {
  chatUi32._resetToastsForTest();
  DOC32.getElementById('chat-toast')?.remove();
  localStorage.removeItem('cfbp_chat_teaser_dismiss_seq');
  TIMERS32 = [];
}

try {
  // 32a — the ✕ handler must write the SHARED watermark, not just drop the node.
  reset32();
  assert(chatUi32._toastQueueDepth() === 0 && chatUi32._notifAckSeq() === 0,
    'fixture check: toast queue drained and the shared watermark re-zeroed before the behavioural cases');
  chatUi32._showToastForTest({ author: 'p1', body: 'toast me', seq: 810 });
  const t1 = liveToast32();
  assert(!!t1 && /toast me/.test(t1.innerHTML),
    'fixture check: showToast() actually mounted a toast node into the DOM harness');
  assert(t1?.dataset.seq === '810',
    `the on-screen toast carries its seq so the chat-page clear can acknowledge it — got ${t1?.dataset.seq}`);
  const dismiss1 = t1.querySelector('.chat-toast-dismiss');
  assert(!!dismiss1 && dismiss1._has('click'), 'the toast renders a ✕ with a click handler bound');
  dismiss1._fire('click');
  assert(chatUi32._notifAckSeq() === 810,
    `clicking the toast's ✕ writes the SHARED acknowledgement watermark — got ${chatUi32._notifAckSeq()} (0 = the reported bug: dismissed here, still showing on the other tab)`);
  assert(t1._removed === true, 'the ✕ also removes the toast node');

  // 32b — the same message must not be re-announced by the ambient teaser.
  assert(chatUi32.dashboardChatTeaserHTML() === '',
    'after a real ✕ dismissal the dashboard teaser stops announcing that message (cross-surface, the reported bug)');

  // 32c — tapping the toast BODY acknowledges too (both gestures, one state).
  reset32();
  chatUi32._showToastForTest({ author: 'p1', body: 'tap through', seq: 820 });
  liveToast32()?._fire('click');
  assert(chatUi32._notifAckSeq() === 820,
    `tapping the toast body to open the room acknowledges as well — got ${chatUi32._notifAckSeq()}`);

  // 32d — a toast that merely TIMES OUT must NOT acknowledge (UN-93). The
  // ambient teaser exists to catch exactly the message you never saw.
  reset32();
  chatUi32._showToastForTest({ author: 'p1', body: 'unseen', seq: 830 });
  const auto = TIMERS32.find(t => t.ms === 6000);
  assert(!!auto, 'fixture check: the default 6s auto-dismiss timer was scheduled');
  auto.fn();
  assert(chatUi32._notifAckSeq() === 0,
    `an auto-dismissed toast leaves the watermark alone so the ambient teaser still shows it — got ${chatUi32._notifAckSeq()} (UN-93)`);

  // 32e — showToast() consults the shared watermark before queueing, so a
  // teaser ✕ silences the toast for that same message.
  reset32();
  chatUi32._ackNotif(900);
  const depthBefore32 = chatUi32._toastQueueDepth();
  chatUi32._showToastForTest({ author: 'p1', body: 'already acked', seq: 850 });
  assert(chatUi32._toastQueueDepth() === depthBefore32 && !liveToast32(),
    'a message at or below the shared watermark never raises a toast — one acknowledgement silences both surfaces');

  // RG-26 — a toast raised elsewhere must not survive onto the chat tab, and
  // opening the room counts as reading it.
  assert(typeof chatUi32._clearToastsForChatPage === 'function',
    'chat-ui exposes the chat-tab toast clear used when the room opens');
  reset32();
  chatUi32._showToastForTest({ author: 'p1', body: 'raised on standings', seq: 860 });
  const carried = liveToast32();
  assert(!!carried, 'fixture check: a toast is on screen before navigating to chat');
  chatUi32._clearToastsForChatPage();
  assert(carried._removed === true,
    'opening the chat room removes the carried-over toast node (RG-26: it used to sit at top:14px over the feed)');
  assert(chatUi32._notifAckSeq() === 860,
    `opening the room ACKNOWLEDGES the carried-over toast — reading the room is reading the message — got ${chatUi32._notifAckSeq()}`);
  assert(chatUi32._toastQueueDepth() === 0,
    'everything queued behind it is cleared in the same pass, not drained one-by-one over the feed');
} finally {
  globalThis.setTimeout = _realST;
  globalThis.clearTimeout = _realCT;
  globalThis.document = _realDoc;
}

// Ordering inside renderChatPage() stays a structural check — it asserts a
// RELATIONSHIP between two calls (bounce before clear), which has no observable
// state to sample. Kept deliberately, and noted as structural.
const renderChatFn32 = (uiSrc32.match(/export function renderChatPage\(\) \{[\s\S]*?\n\}/) || [''])[0];
assert(renderChatFn32.length > 0, 'renderChatPage() body located');
const disabledIdx32 = renderChatFn32.indexOf('redirectChatDisabled()');
const clearIdx32 = renderChatFn32.indexOf('_clearToastsForChatPage()');
assert(disabledIdx32 > -1 && clearIdx32 > -1 && disabledIdx32 < clearIdx32,
  'renderChatPage() clears any carried-over toast AFTER the chat-disabled bounce (a redirect away from chat must not swallow the notification) [structural]');

storage.setSession(null, false, false);
localStorage.removeItem('cfbp_chat_teaser_dismiss_seq');
chat._resetForTest();

// ── 33. RG-12 RECURRENCE — the three data-loss defenses ─────────────────────
// On 2026-08-12 Drew reported: two players' picks vanished and the week reverted
// to DRAFT days after they were made. Investigation found RG-12's BOTH recorded
// defenses were ABSENT from the code despite the ledger recording them as
// shipped in v0.17.1. The original cascade ran again against live data.
//
// These assertions exist so that can never be true again silently. If any of
// them fails, STOP — user picks are at risk.
console.log('\n[33] RG-12 recurrence — data-loss defenses…');

const storeSrc = await readFile(new URL('./js/storage.js', import.meta.url), 'utf8');
const backSrc  = await readFile(new URL('./js/backend.js', import.meta.url), 'utf8');

// (a) ensureSeedData must refuse user-mutable keys in sheets mode.
assert(/USER_MUTABLE_KEYS/.test(storeSrc), 'storage.js declares USER_MUTABLE_KEYS');
assert(/confirmEmpty/.test(storeSrc), 'ensureSeedData gates user-data seeding on confirmEmpty (RG-12 defense a)');
const seedFn = (storeSrc.match(/export function ensureSeedData[\s\S]*?\n\}/) || [''])[0];
assert(/googleSheets/.test(seedFn), 'the seed guard checks backend mode, not just the flag');
assert(!/if\(!load\(KEYS\.PICKS\)\)\s*save\(KEYS\.PICKS/.test(storeSrc),
  'the unconditional PICKS seed — the literal RG-12 mechanism — is gone');
assert(!/if\(!load\(KEYS\.WEEKS\)\)\s*save\(KEYS\.WEEKS/.test(storeSrc),
  'the unconditional WEEKS seed (a DRAFT template) is gone');

// BEHAVIOURAL — not source presence. An earlier draft of this section asserted
// that the guard's TEXT existed; reverting the guard left every assertion green.
// That is the exact failure that produced this bug: the ledger recorded a
// defense that was not in the code. These drive the real functions instead.
const st = mods['storage'];

// (a-behaviour) In sheets mode, ensureSeedData must REFUSE every user-mutable
// key, and must actually create nothing.
//
// Run in a SUBPROCESS with a clean module graph. A cache-busted import of
// storage.js is not enough — it still resolves the ALREADY-LOADED backend.js,
// whose populated _cache from earlier suites makes load() truthy, so seed()
// short-circuits on "already present" and never reaches the guard. Testing the
// guard against dirty state is how you get an assertion that passes for the
// wrong reason, which is the exact class of mistake that produced this bug.
{
  const { execFileSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const probe = `
    globalThis.localStorage={_d:{},getItem(k){return k in this._d?this._d[k]:null},
      setItem(k,v){this._d[k]=String(v)},removeItem(k){delete this._d[k]},clear(){this._d={}}};
    (async()=>{
      const st = await import('./js/storage.js');
      const warned=[]; const rw=console.warn; console.warn=(...a)=>warned.push(a.join(' '));
      st.setBackendMode('googleSheets');
      st.ensureSeedData();
      const sheetsWeeks = (st.getWeeks()||[]).length;
      st.ensureSeedData({confirmEmpty:true});
      const confirmedWeeks = (st.getWeeks()||[]).length;
      console.warn = rw;
      const localWarned=[]; console.warn=(...a)=>localWarned.push(a.join(' '));
      globalThis.localStorage.clear();
      st.setBackendMode('local');
      st.ensureSeedData();
      const localWeeks = (st.getWeeks()||[]).length;
      console.warn = rw;
      process.stdout.write(JSON.stringify({
        refusedWeeks: warned.some(w=>/REFUSING/.test(w)&&/cfbp_weeks/.test(w)),
        refusedPicks: warned.some(w=>/REFUSING/.test(w)&&/cfbp_picks/.test(w)),
        namesRG12:    warned.some(w=>/RG-12/.test(w)),
        sheetsWeeks, confirmedWeeks, localWeeks,
        localRefused: localWarned.some(w=>/REFUSING/.test(w)),
      }));
    })();`;
  let probeOut = {};
  try {
    probeOut = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', probe],
      { cwd: fileURLToPath(new URL('.', import.meta.url)), encoding: 'utf8' }));
  } catch (e) { probeOut = { error: String(e.message || e) }; }

  assert(probeOut.refusedWeeks === true,
    `sheets-mode seeding REFUSES cfbp_weeks — the DRAFT-template mechanism${probeOut.error ? ' — ' + probeOut.error : ''}`);
  assert(probeOut.refusedPicks === true, 'sheets-mode seeding REFUSES cfbp_picks — the pick-destroying mechanism');
  assert(probeOut.namesRG12 === true, 'the refusal names RG-12 so the next reader finds the history');
  assert(probeOut.sheetsWeeks === 0,
    `and NOTHING is actually seeded in sheets mode (got ${probeOut.sheetsWeeks} weeks)`);
  assert(probeOut.confirmedWeeks > 0, 'confirmEmpty:true still seeds a genuinely new Sheet');
  assert(probeOut.localWeeks > 0 && probeOut.localRefused === false,
    'local mode seeds normally and refuses nothing — forks/offline unaffected');
}

// (b-behaviour) hydrate() must THROW rather than adopt an empty remote when the
// mirror still holds league data — and must leave the mirror INTACT.
//
// Subprocess again, and for a specific reason: an earlier draft asserted only
// "hydrate throws", which passed even with the guard reverted, because an
// unconfigured backend throws from the call layer anyway. A test that passes
// for the wrong reason is worse than no test. This one configures the backend,
// stubs the network to return an empty payload, and checks the ERROR TEXT and
// that the mirror survived.
{
  const { execFileSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const probeB = `
    globalThis.localStorage={_d:{},getItem(k){return k in this._d?this._d[k]:null},
      setItem(k,v){this._d[k]=String(v)},removeItem(k){delete this._d[k]},clear(){this._d={}}};
    (async()=>{
      const be = await import('./js/backend.js');
      be.setBackendConfig('https://example.invalid/exec','tok');
      // Seed the mirror with real league data, the way a live device holds it.
      be.cacheSet('cfbp_players', [{playerId:'p1'}]);
      be.cacheSet('cfbp_weeks',   [{weekId:'w1',status:'open'}]);
      be.cacheSet('cfbp_picks',   [{pickId:'k1',playerId:'p1'}]);
      // Remote comes back EMPTY — cold start / dropped body / partial read.
      globalThis.fetch = async () => ({ ok:true, json: async () => ({ ok:true, data:{} }) });
      let threw=false, msg='';
      try { await be.hydrate(); } catch(e){ threw=true; msg=String(e.message||e); }
      const picksSurvived = (be.cacheGet('cfbp_picks')||[]).length;
      const weeksSurvived = (be.cacheGet('cfbp_weeks')||[]).length;
      process.stdout.write(JSON.stringify({ threw, msg, picksSurvived, weeksSurvived }));
    })();`;
  let pb = {};
  try {
    pb = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', probeB],
      { cwd: fileURLToPath(new URL('.', import.meta.url)), encoding: 'utf8' }));
  } catch (e) { pb = { error: String(e.message || e) }; }

  assert(pb.threw === true,
    `hydrate() REFUSES an empty remote while the mirror holds league data${pb.error ? ' — ' + pb.error : ''}`);
  assert(/Sync refused/.test(pb.msg || ''),
    `the refusal is the RG-12 guard, not an incidental error — got: ${(pb.msg || '').slice(0, 80)}`);
  assert(/preserved/.test(pb.msg || ''),
    'the error tells the user their data was preserved (AD-06 loud-fail)');
  assert(pb.picksSurvived === 1 && pb.weeksSurvived === 1,
    `the mirror is INTACT after refusal — picks ${pb.picksSurvived}, weeks ${pb.weeksSurvived} (expected 1, 1)`);
}

// (c) A stale held write must not shrink user data.
const hydrateFn = (backSrc.match(/export async function hydrate[\s\S]*?\n\}/) || [''])[0];
assert(hydrateFn.length > 0, 'hydrate() source located for structural checks');
const refuseAt = hydrateFn.indexOf('Sync refused');
const clearAt = hydrateFn.indexOf('_cache.clear()');
assert(refuseAt > -1 && clearAt > -1 && refuseAt < clearAt,
  'the refusal happens BEFORE _cache.clear() — the mirror is never wiped first');

{
  const be = mods['backend'];

  // The predicate itself. This export is load-bearing: when it was absent the
  // block below fell through to matching the guard's SOURCE TEXT, which cannot
  // distinguish a working guard from a gutted one. Verified 2026-08-12 —
  // replacing the guard body with `_cache.set(k, v)` passed 552/552.
  assert(typeof be._shrinksForTest === 'function',
    'backend exports the shrink predicate so defense (c) is tested by BEHAVIOUR, not by source text');
  assert(be._shrinksForTest([1], [1, 2, 3]) === true, 'shrink detected: 1 item over 3');
  assert(be._shrinksForTest([1, 2, 3, 4], [1, 2]) === false, 'growth allowed: 4 items over 2');
  assert(be._shrinksForTest([], [1]) === true, 'emptying is shrinking');
  assert(be._shrinksForTest({ a: 1 }, { a: 1, b: 2 }) === true, 'shrink detected on objects too (tb/ep guesses are keyed maps)');
}

// (c) END TO END — the predicate existing proves nothing unless hydrate() acts
// on it. This is the closest reproduction of what Drew actually reported: the
// picks were made, and days later a device holding a pre-picks mirror put its
// obsolete-but-perfectly-valid view back. Defenses (a) and (b) both guard an
// empty REMOTE and neither one catches this.
{
  const be = mods['backend'];
  const _fetch33 = globalThis.fetch;
  const _mode33 = storage.getBackendMode();
  let SHEET33 = {};
  globalThis.fetch = async (url, opts) => {
    const req = JSON.parse(opts.body);
    if (req.action === 'getAll') return { ok: true, json: async () => ({ ok: true, data: JSON.parse(JSON.stringify(SHEET33)) }) };
    if (req.action === 'setMany') { Object.entries(req.entries).forEach(([k, v]) => { SHEET33[k] = v; }); return { ok: true, json: async () => ({ ok: true }) }; }
    throw new Error('unexpected action ' + req.action);
  };
  try {
    const SIX = [1, 2, 3, 4, 5, 6].map(n => ({ pickId: 'k' + n, playerId: 'p' + n, gameId: 'g' + n, selection: 'home' }));
    const ONE = [{ pickId: 'k1', playerId: 'p1', gameId: 'g1', selection: 'home' }];
    SHEET33 = {
      cfbp_players: [{ playerId: 'p1' }, { playerId: 'p2' }],
      cfbp_weeks: [{ weekId: 'w1', status: 'open' }],
      cfbp_picks: JSON.parse(JSON.stringify(SIX)),
    };
    // This device booted on a mirror from BEFORE five of those picks existed.
    localStorage.setItem('cfbp_sheet_mirror', JSON.stringify({
      at: '2026-08-05T00:00:00.000Z',
      data: {
        cfbp_players: [{ playerId: 'p1' }],
        cfbp_weeks: [{ weekId: 'w1', status: 'open' }],
        cfbp_picks: JSON.parse(JSON.stringify(ONE)),
      },
    }));
    be.setBackendConfig('https://example.test/exec', 'tok');
    be.primeFromMirror();
    storage.setBackendMode('googleSheets');
    assert(be.isMirrorStale() === true, 'fixture check: the mirror is stale, so the write is HELD and rebased at hydrate (AD-08)');

    // The stale device writes its obsolete view — well-formed, populated, and
    // indistinguishable from a legitimate edit.
    be.cacheSet('cfbp_picks', JSON.parse(JSON.stringify(ONE)));
    await be.hydrate();

    assert((be.cacheGet('cfbp_picks') || []).length === 6,
      `hydrate() DROPS a held write that would shrink picks 6 -> 1 — got ${(be.cacheGet('cfbp_picks') || []).length} (1 = five players' picks destroyed, the reported bug)`);
    await be.flushPush();
    assert((SHEET33.cfbp_picks || []).length === 6,
      `the dropped write is un-dirtied, so flushPush cannot push the shrunken view to the Sheet either — got ${(SHEET33.cfbp_picks || []).length}`);

    // The guard must not become a write-blocker: ADDING a pick still syncs.
    const SEVEN = [...SIX, { pickId: 'k7', playerId: 'p7', gameId: 'g7', selection: 'away' }];
    be.cacheSet('cfbp_picks', JSON.parse(JSON.stringify(SEVEN)));
    await be.flushPush();
    assert((SHEET33.cfbp_picks || []).length === 7,
      `a held write that GROWS user data is still applied — the guard blocks shrinkage only, never normal picking — got ${(SHEET33.cfbp_picks || []).length}`);
  } finally {
    globalThis.fetch = _fetch33;
    storage.setBackendMode(_mode33);
    be.clearBackendConfig();
    localStorage.removeItem('cfbp_sheet_mirror');
  }
}

// ── 34. UN-116 — THE BLIND RULE ─────────────────────────────────────────────
// Drew, 2026-08-12: "If you can still edit, you shouldnt be able to see anyone
// else picks or submissions (tie breakers, extra point, etc). Only time you
// should see other people's picks are live and final, when you cant edit other
// picks."
//
// The original defect was NOT a broken predicate. canViewOtherPicks() existed
// and worked; the standard dashboard matrix — the DEFAULT view — simply never
// called it, while the compact view did. So these assertions run against the
// rendered markup a player would actually be served, not against the predicate
// alone. A predicate-only test would have passed against the shipped bug.
console.log('\n[34] UN-116 — others\' picks stay blind until kickoff…');
{
  const app34 = mods['app'];
  const W = id => storage.getWeek(id);

  // 34a — the threshold itself, across every week status.
  const mk = (status, extra = {}) => ({ weekId: 'un116_' + status, weekNumber: 1, season: 2026, status, dataSourceMode: 'demo', startDate: '2026-09-05', endDate: '2026-09-06', ...extra });
  assert(storage.arePicksPublic(mk('draft')) === false, 'draft week: picks are NOT public');
  assert(storage.arePicksPublic(mk('open')) === false, 'open week: picks are NOT public');
  assert(storage.arePicksPublic(mk('locked')) === false,
    'LOCKED week: picks are NOT public — this is the case Drew changed, and the one the reveal ritual used to fire on');
  assert(storage.arePicksPublic(mk('live')) === true, 'live week: picks ARE public');
  assert(storage.arePicksPublic(mk('final')) === true, 'final week: picks ARE public');
  assert(storage.arePicksPublic(null) === false, 'a missing week is never public (no crash, no leak)');

  // 34b — fixture: an OPEN week, two players, both submitted.
  const OW = mk('open', { weekId: 'un116_wk', picksOpenAt: '2026-09-01T00:00:00Z' });
  storage.saveWeek(OW);
  storage.saveGame({ weekId: OW.weekId, gameId: 'un116_g1', homeTeam: 'Ohio State', awayTeam: 'Texas', kickoff: '2026-09-05T16:00:00Z', status: 'scheduled', spread: -3 });
  storage.addPlayer({ playerId: 'un116_me',    displayName: 'Me',    active: true });
  storage.addPlayer({ playerId: 'un116_rival', displayName: 'Rival', active: true });
  const PICKS34 = [
    { pickId: 'un116_pk1', weekId: OW.weekId, gameId: 'un116_g1', playerId: 'un116_me',    selectedTeam: 'Ohio State' },
    { pickId: 'un116_pk2', weekId: OW.weekId, gameId: 'un116_g1', playerId: 'un116_rival', selectedTeam: 'Texas' },
  ];
  storage.saveAllPicks([...storage.getPicks(), ...PICKS34]);

  // 34c — THE REGRESSION. A player who has submitted must still not see others.
  // This is the exact branch that was removed: visibility used to be granted by
  // hasPlayerSubmitted(), but submitting does not end your ability to edit —
  // "Player picks are editable while the slate is open" is a locked decision —
  // so a player could submit, read the field, and then change their own picks.
  storage.setSession('un116_me', false, true);
  assert(storage.getEffectiveWeekStatus(W(OW.weekId)) === 'open', 'fixture check: the week is OPEN and still editable');
  assert(app34.canViewOtherPicks(W(OW.weekId)) === false,
    'a player who HAS SUBMITTED still cannot see other players while the week is open (submitting is undoable; visibility must not be)');

  const players34 = [
    { playerId: 'un116_me', displayName: 'Me', active: true },
    { playerId: 'un116_rival', displayName: 'Rival', active: true },
  ];
  const games34 = storage.getGames(OW.weekId);
  const results34 = players34.map((p, i) => ({ playerId: p.playerId, rank: i + 1, correctPicks: 1, incorrectPicks: 0, tiebreakerGuess: 40 + i, tiebreakerDelta: 0 }));
  const html34 = app34.renderDashboardTable(players34, games34, PICKS34, results34, OW.weekId, null);

  assert(/pick-cell-blind/.test(html34),
    'THE LEAK: the standard matrix renders blind cells while the week is open (it previously had no blind check at all)');
  // Inspect ONLY the pick cells. Both team names legitimately appear in the
  // game-info matchup label, so a whole-document search would be a false
  // positive — the question is what the PICK columns disclose.
  const cells34 = html34.match(/<td class="pick-cell[\s\S]*?<\/td>/g) || [];
  assert(cells34.length === 2, `fixture check: one pick cell per submitted player (got ${cells34.length})`);
  const blind34 = cells34.filter(c => /pick-cell-blind/.test(c));
  assert(blind34.length === 1,
    `exactly one cell is blinded — the rival's, not the viewer's own (got ${blind34.length})`);
  assert(!/Texas/.test(blind34.join('')),
    "the rival's actual selection is absent from the served markup — blinded server-side, not merely hidden with CSS");
  assert(/Ohio State/.test(cells34.filter(c => !/pick-cell-blind/.test(c)).join('')),
    "the viewer's OWN pick is still shown in full — the blind rule hides others, not yourself");

  // 34d — at kickoff everything opens at once, on every surface.
  storage.saveWeek({ ...OW, status: 'live' });
  assert(app34.canViewOtherPicks(W(OW.weekId)) === true, 'once LIVE, other players are visible');
  const htmlLive34 = app34.renderDashboardTable(players34, games34, PICKS34, results34, OW.weekId, null);
  assert(!/pick-cell-blind/.test(htmlLive34) && /Texas/.test(htmlLive34),
    "at kickoff the rival's pick is revealed in the matrix — no blind cells remain");

  // 34e — the commissioner is unaffected (existing admin-sees-all precedent).
  storage.saveWeek({ ...OW, status: 'open' });
  // RG-37 — THESE TWO ASSERTIONS USED TO SAY THE OPPOSITE, and that is why the
  // leak shipped. They asserted 'the commissioner still sees everything
  // regardless of week status (unchanged)' and 'the commissioner matrix is
  // never blinded'. Both passed. Both were WRONG. A test that asserts the
  // defective behaviour does not merely fail to catch the bug — it DEFENDS it:
  // the change that fixes the bug turns the test red, which reads as a
  // regression. Mutation testing cannot help, because the mutation IS the fix.
  // Drew found it in production on the live site.
  storage.setSession('un116_me', true, true);
  assert(app34.canViewOtherPicks(W(OW.weekId)) === false,
    'a commissioner who can still submit their own picks is blinded like anyone else — being admin is not a licence to peek at a slate you are still playing');
  const htmlAdmin34 = app34.renderDashboardTable(players34, games34, PICKS34, results34, OW.weekId, null);
  const adminCells34 = htmlAdmin34.match(/<td class="pick-cell[\s\S]*?<\/td>/g) || [];
  assert(adminCells34.some(c => /pick-cell-blind/.test(c)) && !/Texas/.test(adminCells34.filter(c => /pick-cell-blind/.test(c)).join('')),
    "the commissioner's own matrix blinds the rival column while the week is still open");

  // The bypass survives for a commissioner with NO STAKE — one who cannot
  // submit here. That is the legitimate case: verifying picks landed, chasing
  // a missing entry. Asserted so a later 'simplification' cannot quietly
  // restore blanket admin-sees-all.
  storage.saveWeek({ ...OW, status: 'locked' });
  assert(app34.canPlayerSubmitPicks(W(OW.weekId), 'un116_me').allowed === false,
    'fixture check: the commissioner cannot submit on a locked week');
  assert(app34.canViewOtherPicks(W(OW.weekId)) === true,
    'a commissioner who can NO LONGER act still sees everything — the bypass narrows, it does not disappear');
  storage.saveWeek({ ...OW, status: 'open' });

  // 34g — THE INVARIANT, stated directly instead of inferred from two separate
  // predicates. This is the assertion that would have caught RG-37 on day one,
  // and it is deliberately exhaustive over BOTH roles because the whole defect
  // was a role nobody thought to sweep.
  {
    const PAST = '2026-08-01T00:00:00Z', FUT = '2026-12-01T00:00:00Z';
    const dateCfgs = [
      ['none', {}], ['open@past', { picksOpenAt: PAST }], ['lock@past', { picksLockAt: PAST }],
      ['open@past+lock@fut', { picksOpenAt: PAST, picksLockAt: FUT }],
      ['both@past', { picksOpenAt: PAST, picksLockAt: PAST }],
    ];
    const violations = [];
    for (const isAdmin of [false, true]) {
      storage.setSession('un116_me', isAdmin, true);
      for (const st of ['draft', 'open', 'locked', 'live', 'final']) {
        for (const [lbl, d] of dateCfgs) {
          const wid = `inv_${isAdmin ? 'a' : 'p'}_${st}_${lbl.replace(/\W/g, '')}`;
          storage.saveWeek({ weekId: wid, weekNumber: 1, season: 2026, status: st, ...d });
          const w = W(wid);
          if (app34.canPlayerSubmitPicks(w, 'un116_me').allowed && app34.canViewOtherPicks(w)) {
            violations.push(`${isAdmin ? 'admin' : 'player'}/${st}/${lbl}`);
          }
        }
      }
    }
    storage.setSession(null, false, false);
    assert(violations.length === 0,
      `THE INVARIANT — across 5 statuses x 5 date configs x 2 roles, nobody can ever submit their own picks AND see someone else's at once (violations: ${violations.join(', ') || 'none'})`);
  }

  // 34h — RG-37, THE SURFACE SWEEP. [34g] above is a PREDICATE invariant, and a
  // predicate invariant is not enough here — that is the precise shape of the
  // original UN-116 defect, where canViewOtherPicks() was correct and returned
  // false while the standard matrix simply never called it. A green [34g] is
  // compatible with a wide-open template.
  //
  // So this asserts the same rule on the MARKUP A VIEWER IS ACTUALLY SERVED,
  // across every surface that can print another player's submission and both
  // roles. The rule is Drew's, verbatim: "I shouldnt be able to see everyone
  // elses picks while I can still submit OR edit mine."
  //
  // Whether the viewer can act is not assumed — it is read from
  // canPlayerSubmitPicks() per state, so the sweep stays correct if the status
  // rules ever move. States where nobody can act are skipped, not asserted, so
  // this can never be satisfied by blinding everything forever.
  {
    const RIVAL_TB_34 = 4177;   // a value that appears nowhere else in the fixture
    const MY_TB_34    = 12;     // the viewer's OWN guess — must survive every blind
    const TB_ACTUAL_34 = 100;   // graded state, so the Δ column is swept as well
    // Surface 4 below reads the guesses out of STORAGE (getTiebreakerGuess),
    // not out of the weekly-results rows, so the fixture has to exist in both
    // places or every assertion against that card passes vacuously.
    storage.setTiebreakerGuess(OW.weekId, 'un116_me',    MY_TB_34);
    storage.setTiebreakerGuess(OW.weekId, 'un116_rival', RIVAL_TB_34);
    assert(storage.getTiebreakerGuess(OW.weekId, 'un116_rival') === RIVAL_TB_34,
      'fixture check: the rival really has a tiebreaker guess on file — otherwise the tiebreaker leak assertions below prove nothing');
    const results34h = [
      { playerId: 'un116_me',    rank: 1, correctPicks: 1, incorrectPicks: 0, tiebreakerGuess: 12, tiebreakerDelta: 0 },
      { playerId: 'un116_rival', rank: 2, correctPicks: 0, incorrectPicks: 1, tiebreakerGuess: RIVAL_TB_34, tiebreakerDelta: 0 },
    ];
    let swept = 0, skipped = 0;
    const leaks = [];
    for (const isAdmin of [false, true]) {
      const role = isAdmin ? 'commissioner' : 'player';
      for (const st of ['draft', 'open', 'locked', 'live', 'final']) {
        storage.saveWeek({ ...OW, status: st });
        storage.setSession('un116_me', isAdmin, true);
        const wk = W(OW.weekId);
        if (!app34.canPlayerSubmitPicks(wk, 'un116_me').allowed) { skipped++; continue; }
        swept++;

        // Surface 1 — the standard matrix. The viewer picked Ohio State and the
        // rival picked Texas, so "Texas" inside ANY pick cell is the rival's
        // selection disclosed. (The matchup label legitimately carries both team
        // names, which is why only the cells are inspected.)
        const std = app34.renderDashboardTable(players34, games34, PICKS34, results34h, OW.weekId, null);
        const stdCells = std.match(/<td class="pick-cell[\s\S]*?<\/td>/g) || [];
        if (/Texas/.test(stdCells.join(''))) leaks.push(`${role}/${st}/standard-matrix`);
        if (!stdCells.some(c => /pick-cell-blind/.test(c))) leaks.push(`${role}/${st}/standard-matrix-not-blinded`);

        // Surface 2 — the compact view. Chips are keyed by data-player-id, and
        // the leak would arrive either as chip text or as the title tooltip
        // ("Rival picked Texas"), so the whole chip is inspected.
        const cmp = app34.renderDashboardCompact(players34, games34, PICKS34, results34h, OW.weekId, null);
        const rivalChips = (cmp.match(/<div class="dc-chip[\s\S]*?<\/div>\s*<\/div>|<div class="dc-chip[^>]*>[\s\S]*?<\/div><\/div>/g) || [])
          .concat(cmp.match(/<div class="dc-chip[^>]*data-player-id="un116_rival"[\s\S]*?(?=<div class="dc-chip|$)/g) || [])
          .filter(ch => /data-player-id="un116_rival"/.test(ch));
        if (!rivalChips.length) leaks.push(`${role}/${st}/compact-no-rival-chip-found`);
        if (/Texas|TEX/.test(rivalChips.join(''))) leaks.push(`${role}/${st}/compact-chip`);
        if (!/dc-chip-blind/.test(rivalChips.join(''))) leaks.push(`${role}/${st}/compact-chip-not-blinded`);

        // Surface 3 — the score summary, which carries the rival's TIEBREAKER
        // GUESS. A tiebreaker is a submission like any other; UN-116 blinds it
        // on the same rule, and a numeric guess is exactly as exploitable.
        const sum = app34.renderScoreSummaryRowsHTML(W(OW.weekId), results34h, players34, null);
        if (sum.includes(String(RIVAL_TB_34))) leaks.push(`${role}/${st}/score-summary-tiebreaker`);

        // Surface 4 — THE COMMISSIONER PANEL'S TIEBREAKER CARD (Week tab).
        // RG-43, the FIFTH recurrence of this class. This card consulted
        // NEITHER canViewOtherPicks() NOR arePicksPublic(); it was gated only
        // by sitting inside the commissioner panel — precisely the assumption
        // RG-37 and RG-40 were raised to destroy, because Drew is commissioner
        // AND player. Surface 3 above blinds 4177 on this identical fixture
        // and this card printed it, on the tab used for the ordinary weekly
        // act of setting the tiebreaker question. A tiebreaker decides the
        // weekly cash prize whenever records tie, so a rival's number is worth
        // exactly as much as a rival's pick.
        //
        // The Δ column is swept alongside the guess: |guess − actual|
        // discloses the guess up to a sign, and `actualTiebreakerValue` is a
        // plain commissioner-entered number with no status gate on its input,
        // so an OPEN week can carry one. Blinding the guess and printing the
        // delta would be the same leak through a second door.
        for (const [tlbl, actual] of [['ungraded', null], ['graded', TB_ACTUAL_34]]) {
          const tbCard = app34.renderTiebreakerGuessesAdmin(
            { ...W(OW.weekId), actualTiebreakerValue: actual }, players34, actual);
          const where4 = `${role}/${st}/${tlbl}`;
          if (new RegExp(`\\b${RIVAL_TB_34}\\b`).test(tbCard)) leaks.push(`${where4}/tiebreaker-admin-guess`);
          if (actual !== null && new RegExp(`\\b${Math.abs(RIVAL_TB_34 - actual)}\\b`).test(tbCard))
            leaks.push(`${where4}/tiebreaker-admin-delta`);
          // …and the viewer's OWN guess must survive. A fix that blanked the
          // whole card would satisfy every leak check above and destroy the
          // feature — the same trap [34i] guards against on the Extra Point.
          if (!new RegExp(`\\b${MY_TB_34}\\b`).test(tbCard)) leaks.push(`${where4}/tiebreaker-own-guess-hidden`);
        }
      }
    }
    storage.setSession(null, false, false);
    storage.saveWeek({ ...OW, status: 'open' });
    assert(swept >= 2 && skipped >= 1,
      `fixture check: the sweep actually reached actionable states for both roles and skipped the un-actionable ones (swept ${swept}, skipped ${skipped}) — a sweep that asserted nothing would otherwise pass silently`);
    assert(leaks.length === 0,
      `THE SURFACE SWEEP — on every surface that can print a rival's submission, nothing is disclosed while the viewer can still submit or edit (leaks: ${leaks.join(', ') || 'none'})`);

    // The other half of the rule for Surface 4, stated explicitly so "blind the
    // tiebreaker card forever" can never satisfy the sweep above: once the
    // viewer can no longer act, the commissioner sees the whole field again —
    // which is the entire reason the card exists.
    storage.saveWeek({ ...OW, status: 'live' });
    storage.setSession('un116_me', true, true);
    const tbLive34 = app34.renderTiebreakerGuessesAdmin(
      { ...W(OW.weekId), actualTiebreakerValue: TB_ACTUAL_34 }, players34, TB_ACTUAL_34);
    assert(new RegExp(`\\b${RIVAL_TB_34}\\b`).test(tbLive34) && new RegExp(`\\b${MY_TB_34}\\b`).test(tbLive34),
      'once the games are LIVE the commissioner sees every tiebreaker guess again — the gate narrows the disclosure, it does not remove the card');
    assert(new RegExp(`Δ${Math.abs(RIVAL_TB_34 - TB_ACTUAL_34)}`).test(tbLive34),
      'and the Δ column still grades in full once it is allowed to');
    storage.saveWeek({ ...OW, status: 'open' });
    storage.setSession(null, false, false);
  }

  // 34i — RG-40, THE EXTRA POINT. The SAME defect as RG-37, one surface over.
  // The commissioner panel's "Guesses on file" block printed every active
  // player's Extra Point guess in plaintext, gated only on `session.isAdmin`,
  // with no blind check at all. Drew is BOTH commissioner and player, so on an
  // OPEN week he read all five rivals' guesses while his own was still
  // editable. Extra Point is blackjack: knowing the field is decisive in a way
  // knowing a single ATS pick is not — you can sit one yard under the leader.
  //
  // Asserted the way [34g]/[34h] are, and for the same reason: as the
  // INVARIANT over the whole state space, on the MARKUP ACTUALLY SERVED, for
  // both roles. A predicate-only assertion would not have caught this —
  // canViewOtherPicks() was already correct and returned false; this surface
  // simply never called it, which is the identical shape to the original
  // UN-116 defect in the standard matrix.
  //
  // renderCommExtraPointCardHTML() exists as an exported, DOM-free function
  // for exactly this: renderCommExtrasV16() early-returns under the harness's
  // `getElementById: () => null` stub, so the only way to assert on what the
  // card DISCLOSES — rather than on the presence of a gate in source, which is
  // the RG-27 false-coverage anti-pattern — is to render it and read it.
  {
    const MY_EP_34 = 41, RIVAL_EP_34 = 63;   // values that appear nowhere else in the fixture
    storage.setExtraPointGuess(OW.weekId, 'un116_me',    MY_EP_34);
    storage.setExtraPointGuess(OW.weekId, 'un116_rival', RIVAL_EP_34);
    assert(storage.getExtraPointGuess(OW.weekId, 'un116_rival') === RIVAL_EP_34,
      'fixture check: the rival really has an Extra Point guess on file — otherwise every leak assertion below passes vacuously');

    const PAST34i = '2026-08-01T00:00:00Z', FUT34i = '2026-12-01T00:00:00Z';
    const dateCfgs34i = [
      ['none', {}], ['open@past', { picksOpenAt: PAST34i }], ['lock@past', { picksLockAt: PAST34i }],
      ['open@past+lock@fut', { picksOpenAt: PAST34i, picksLockAt: FUT34i }],
      ['both@past', { picksOpenAt: PAST34i, picksLockAt: PAST34i }],
    ];
    // Graded-preview state is swept too. `extraPointActual` is a plain
    // commissioner-entered number with no status gate on the input, so a week
    // that is still open CAN carry one — and the graded preview prints every
    // player's guess beside their outcome. Same card, same data, same rule.
    const gradedCfgs34i = [['ungraded', null], ['graded', 55]];
    let swept34i = 0, skipped34i = 0;
    const leaks34i = [];
    for (const isAdmin of [false, true]) {
      const role34i = isAdmin ? 'commissioner' : 'player';
      for (const st of ['draft', 'open', 'locked', 'live', 'final']) {
        for (const [lbl, d] of dateCfgs34i) {
          for (const [glbl, actual] of gradedCfgs34i) {
            storage.saveWeek({ ...OW, status: st, picksOpenAt: undefined, picksLockAt: undefined,
                               extraPointActual: actual, ...d });
            storage.setSession('un116_me', isAdmin, true);
            const wk = W(OW.weekId);
            const where = `${role34i}/${st}/${lbl}/${glbl}`;
            // Whether the viewer can still act is READ, never assumed, so the
            // sweep stays correct if the status rules move. States where
            // nobody can act are skipped rather than asserted, so this can
            // never be satisfied by blinding the card forever.
            if (!app34.canPlayerSubmitPicks(wk, 'un116_me').allowed) { skipped34i++; continue; }
            swept34i++;
            const card = app34.renderCommExtraPointCardHTML(wk);
            if (new RegExp(`\\b${RIVAL_EP_34}\\b`).test(card)) leaks34i.push(`${where}/rival-guess`);
            // …and the viewer's OWN guess must survive. A fix that blinded the
            // whole block would satisfy the leak check and break the feature.
            if (!new RegExp(`\\b${MY_EP_34}\\b`).test(card)) leaks34i.push(`${where}/own-guess-hidden`);
          }
        }
      }
    }
    assert(swept34i >= 2 && skipped34i >= 1,
      `fixture check: the Extra Point sweep reached actionable states for both roles and skipped the un-actionable ones (swept ${swept34i}, skipped ${skipped34i})`);
    assert(leaks34i.length === 0,
      `THE EXTRA POINT INVARIANT — nobody can submit or edit their own Extra Point guess while the card shows them anyone else's (leaks: ${leaks34i.slice(0, 6).join(', ') || 'none'}${leaks34i.length > 6 ? ` …+${leaks34i.length - 6}` : ''})`);

    // The other half of the rule: once the viewer can no longer act, the field
    // opens. Asserted explicitly so "blind everything, always" can never pass.
    storage.saveWeek({ ...OW, status: 'live', picksOpenAt: undefined, picksLockAt: undefined, extraPointActual: null });
    storage.setSession('un116_me', true, true);
    const liveCard34i = app34.renderCommExtraPointCardHTML(W(OW.weekId));
    assert(new RegExp(`\\b${RIVAL_EP_34}\\b`).test(liveCard34i) && new RegExp(`\\b${MY_EP_34}\\b`).test(liveCard34i),
      "once the games are LIVE the commissioner sees every guess again — the gate narrows the disclosure, it does not remove the feature");

    // And the graded preview still grades in full once it is allowed to.
    storage.saveWeek({ ...OW, status: 'final', picksOpenAt: undefined, picksLockAt: undefined, extraPointActual: 55 });
    const finalCard34i = app34.renderCommExtraPointCardHTML(W(OW.weekId));
    assert(new RegExp(`\\b${RIVAL_EP_34}\\b`).test(finalCard34i) && /BUST|Wins|BLACKJACK|Under/.test(finalCard34i),
      'on a FINAL week the graded preview renders every entrant and their outcome, unchanged');

    storage.saveWeek({ ...OW, status: 'open', extraPointActual: null });
  }

  // 34f — an anonymous viewer gets nothing either.
  storage.setSession(null, false, false);
  assert(app34.canViewOtherPicks(W(OW.weekId)) === false,
    'a signed-out viewer cannot see picks on an open week');

  storage.saveWeek({ ...OW, status: 'open' });
  storage.setSession(null, false, false);
}

// ── 35. UN-117 — week nomenclature splits into two deliberate lines ─────────
console.log('\n[35] UN-117 — week name and date range each own a line…');
{
  const { formatWeekLabel, formatWeekLabelParts } = mods['data-model'];
  const wk = { weekId: 'un117', weekNumber: 1, season: 2026, startDate: '2026-09-05', endDate: '2026-09-12' };

  const parts = formatWeekLabelParts(wk);
  assert(parts.name === 'Week 1', `name line carries the week name only — got "${parts.name}"`);
  assert(!/\d{1,2}\/|Sep|—/.test(parts.name), 'the name line contains no date fragment (the reported defect was half the range riding along)');
  assert(parts.dates.length > 0 && parts.dates === formatWeekLabel(wk).split(' — ')[1],
    `the date line carries the WHOLE range, never half of it — got "${parts.dates}"`);

  // roundLabel is how Drew names multi-part weeks ("Part 1"). It belongs on
  // the NAME line, not squeezed in with the dates — DI-135: it's a SUFFIX
  // appended after the display number, not a full replacement.
  const rl = formatWeekLabelParts({ ...wk, roundLabel: 'Part 1' });
  assert(rl.name === 'Week 1, Part 1', `a roundLabel is appended as a suffix, with the display number auto-prepended — got "${rl.name}"`);
  assert(rl.dates.length > 0, 'a custom-named week still gets its date line');

  // DI-135 — espnWeekNumber overrides the DISPLAYED week number only.
  const ov = formatWeekLabelParts({ ...wk, espnWeekNumber: '7' });
  assert(ov.name === 'Week 7', `espnWeekNumber overrides the displayed number — got "${ov.name}"`);

  const both = formatWeekLabelParts({ ...wk, espnWeekNumber: '7', roundLabel: 'Part 2' });
  assert(both.name === 'Week 7, Part 2', `override number + roundLabel suffix compose together — got "${both.name}"`);

  const blankOverride = formatWeekLabelParts({ ...wk, espnWeekNumber: '' });
  assert(blankOverride.name === 'Week 1', 'a blank espnWeekNumber (the createWeek default) is treated as unset, not as "Week "');

  // Absent data must yield an EMPTY string, so the caller can omit the element
  // entirely rather than render a blank line that still claims height.
  assert(formatWeekLabelParts({ ...wk, dataSourceMode: 'demo' }).dates === '', 'a demo week has no date line');
  assert(formatWeekLabelParts({ weekNumber: 3 }).dates === '', 'a week with no dates on file has no date line');
  assert(formatWeekLabelParts(null).name === '' && formatWeekLabelParts(null).dates === '', 'a missing week yields empty parts, not a crash');

  // The single-line label is load-bearing for ~20 other call sites (CSV cells,
  // <option> text, confirm() dialogs, email subjects). It must NOT have changed.
  assert(formatWeekLabel(wk) === 'Week 1 — ' + parts.dates,
    `formatWeekLabel() is untouched — CSV, dropdowns and dialogs still get one line — got "${formatWeekLabel(wk)}"`);

  // The two surfaces Drew named must actually use the split helper.
  assert(/week-heading-dates/.test(appJsSrc) && (appJsSrc.match(/formatWeekLabelParts\(/g) || []).length >= 3,
    'the header, the dashboard heading and the picks banner all render the split parts [structural]');
  assert(/\.week-heading-dates\{[^}]*display:block/.test(cssSrc.replace(/\s+/g, '')) || /\.week-heading-dates\{[^}]*display:block/.test(cssSrc),
    'the date line is block-level — that is what forces the break rather than leaving it to container width');
  assert(/\.week-heading-dates\{[^}]*white-space:nowrap/.test(cssSrc),
    'the date RANGE itself never splits across lines — the specific thing Drew reported');
}

// ── 36. UN-119 — compact view density: chat + reactions inline in .dc-meta ──
// DI-119a: the chat indicator and the reaction strip move OFF their own
// block-level rows (below .dc-chips) and INLINE into .dc-meta, next to the
// ESPN link. Asserted against the REAL markup renderDashboardCompact() (now
// exported for this reason) returns, not a source-text regex — a regex
// cannot tell a working relocation from one that silently reverted, and that
// exact gap is why RG-12-class regressions recur (see suite [33]'s header).
console.log('\n[36] UN-119 — compact view density: chat + reactions move inline into .dc-meta…');
{
  const app36 = mods['app'];
  const chat36 = mods['chat'];

  // 36a — CSS shape: the compact-scoped chat button carries no in-flow
  // min-height (that WAS the measured cost driver), and both new invisible
  // hit-area overlays (DI-119a's chat icon, DI-119b's .reaction-add-btn-mini)
  // still clear the 40px tap-target floor (CONVENTIONS #17) even though the
  // visible glyphs stayed tiny — this codebase has shipped sub-40px targets
  // twice already (the emoji picker at 22px, .chat-pill at 28px).
  const dcChatRule = (cssSrc.match(/\.dc-meta \.chat-bubble-btn\{[^}]*\}/) || [''])[0];
  assert(dcChatRule.length > 0, 'fixture check: .dc-meta .chat-bubble-btn override exists in styles.css');
  assert(!/min-height:\s*40px/.test(dcChatRule),
    'the compact chat button no longer reserves an in-flow 40px min-height');
  const dcChatBefore = (cssSrc.match(/\.dc-meta \.chat-bubble-btn::before\{[^}]*\}/) || [''])[0];
  assert(/position:\s*absolute/.test(dcChatBefore),
    'DI-119a: the tap-target overlay is position:absolute (out of flow) — an in-flow expansion would re-inflate the row this change shrinks');
  // HEIGHT IS NOT THE FREE AXIS EITHER — AMENDED 2026-08-13 (RG).
  // The retired claim here was "a 40px overlay costs nothing in flow", and it
  // is true of FLOW and false of HIT TESTING. The visible box is ~14.5px, so a
  // flat 40px overlay hangs ~12.75px past each edge, while only
  // .dc-game-head's 8px margin-bottom separates it from .dc-chips — whose
  // chips carry draggable="true". .chat-bubble-btn is position:relative, so
  // this ::before paints in the positioned layer ABOVE the static .dc-chips
  // and won the hit test over the top of the chip row.
  // Amended to the same remedy already accepted on the width axis: tile
  // against the gap that actually exists rather than assert a number that does
  // not fit. Full computed relation is asserted in [51].
  assert(!/height:\s*40px/.test(dcChatBefore),
    "DI-119a (amended): the overlay is NOT a literal 40px tall — that overhung .dc-game-head's 8px margin into the draggable .dc-chip row");
  assert(/height:\s*calc\(100% \+ 16px\)/.test(dcChatBefore),
    `DI-119a (amended): the chat icon's hit-area extends 8px per side — flush with the chip row, never into it — got "${(dcChatBefore.match(/height:[^;]*/) || [])[0]}"`);
  // WIDTH is NOT free. .dc-meta sets gap:6px, so a literal 40px-wide overlay
  // would overlap its neighbour's by ~17px, and the reaction strip — the next
  // flex child, painted later — would capture taps aimed at the chat icon.
  // Two overlapping hit zones are a worse defect than two narrow ones: the
  // user taps what they are looking at and something else opens. The overlays
  // must therefore TILE: extend by at most half the gap per side.
  assert(/width:\s*calc\(100% \+ 6px\)/.test(dcChatBefore),
    `DI-119a (amended): the chat icon's hit-area tiles with the 6px gap instead of overlapping its neighbour — got "${(dcChatBefore.match(/width:[^;]*/) || [])[0]}"`);
  assert(!/width:\s*40px/.test(dcChatBefore),
    'the overlay is NOT a literal 40px wide — that is unsatisfiable for two controls 6px apart and causes mis-taps');

  const miniVisible = (cssSrc.match(/\.reaction-add-btn-mini\{[^}]*\}/) || [''])[0];
  assert(/width:\s*18px/.test(miniVisible) && /height:\s*18px/.test(miniVisible),
    "DI-119b: .reaction-add-btn-mini's VISIBLE box is still 18x18 — the fix must not grow the glyph");
  const miniBefore = (cssSrc.match(/\.reaction-add-btn-mini::before\{[^}]*\}/) || [''])[0];
  // Same amendment as DI-119a above (2026-08-13, RG): 40px on an 18px box
  // overhangs 11px per side, past the 8px available before the draggable chip
  // row. Tiles at 8px per side instead. Computed relation in [51].
  assert(!/height:\s*40px/.test(miniBefore),
    "DI-119b (amended): the \"+\" overlay is NOT a literal 40px tall — that reached past .dc-game-head's margin into the draggable .dc-chip row");
  assert(/height:\s*calc\(100% \+ 16px\)/.test(miniBefore),
    `DI-119b (amended): the "+" hit-area extends 8px per side — got "${(miniBefore.match(/height:[^;]*/) || [])[0]}"`);
  // .reaction-strip sets gap:4px and this button sits beside the reaction
  // chips, so the same tiling rule applies against them.
  assert(/width:\s*calc\(100% \+ 4px\)/.test(miniBefore),
    `DI-119b (amended): the "+" hit-area tiles with .reaction-strip's 4px gap rather than overlapping the adjacent reaction chips — got "${(miniBefore.match(/width:[^;]*/) || [])[0]}"`);

  // 36b — fixture: an OPEN week, two players, one game (with an ESPN id so
  // the ordering claim — "next to the ESPN link" — is actually exercised),
  // both submitted, chat enabled.
  chat36._resetForTest();
  storage.saveSetting('chatEnabled', true);
  localStorage.removeItem('cfbp_chat_lastseen2');
  const CW = { weekId: 'un119_wk', weekNumber: 1, season: 2026, status: 'open', dataSourceMode: 'demo', startDate: '2026-09-05', endDate: '2026-09-06', picksOpenAt: '2026-09-01T00:00:00Z' };
  storage.saveWeek(CW);
  storage.saveGame({ weekId: CW.weekId, gameId: 'un119_g1', homeTeam: 'Ohio State', awayTeam: 'Texas', kickoff: '2026-09-05T16:00:00Z', status: 'scheduled', spread: -3, espnEventId: 'un119_espn1' });
  storage.addPlayer({ playerId: 'un119_me', displayName: 'Me', active: true });
  storage.addPlayer({ playerId: 'un119_rival', displayName: 'Rival', active: true });
  const PICKS36 = [
    { pickId: 'un119_pk1', weekId: CW.weekId, gameId: 'un119_g1', playerId: 'un119_me', selectedTeam: 'Ohio State' },
    { pickId: 'un119_pk2', weekId: CW.weekId, gameId: 'un119_g1', playerId: 'un119_rival', selectedTeam: 'Texas' },
  ];
  storage.saveAllPicks([...storage.getPicks(), ...PICKS36]);
  storage.setSession('un119_me', false, true);

  const players36 = [
    { playerId: 'un119_me', displayName: 'Me', active: true },
    { playerId: 'un119_rival', displayName: 'Rival', active: true },
  ];
  const games36 = storage.getGames(CW.weekId);
  const results36 = players36.map((p, i) => ({ playerId: p.playerId, rank: i + 1, correctPicks: 0, incorrectPicks: 0, tiebreakerGuess: 40 + i, tiebreakerDelta: 0 }));

  const html36 = app36.renderDashboardCompact(players36, games36, PICKS36, results36, CW.weekId, null);

  // 36c — THE RELOCATION. Both indicators live inside .dc-meta now, and
  // NEITHER renders as a sibling block after .dc-chips (the old, expensive
  // placement). .dc-meta's own content has no nested <div>s (spans/a/button
  // only), so a non-greedy match is safe; for the "not after .dc-chips" claim
  // we use string position rather than a nested-<div>-unsafe regex split,
  // since .dc-chips legitimately contains nested <div class="dc-chip"> children.
  const metaBlock = (html36.match(/<div class="dc-meta">[\s\S]*?<\/div>/) || [''])[0];
  assert(metaBlock.length > 0, 'fixture check: .dc-meta renders');
  assert(/chat-bubble-btn/.test(metaBlock), 'DI-119a: the chat indicator renders INSIDE .dc-meta');
  assert(/reaction-strip/.test(metaBlock), 'DI-119a: the reaction strip renders INSIDE .dc-meta');
  assert(/espn-link/.test(metaBlock), 'fixture check: the ESPN link is present in .dc-meta (so "next to" is a real claim, not vacuous)');

  const idxEspn = html36.indexOf('espn-link');
  const idxChips = html36.indexOf('<div class="dc-chips">');
  const idxChatBtn = html36.indexOf('chat-bubble-btn');
  const idxReactStrip = html36.indexOf('reaction-strip');
  assert(idxEspn > -1 && idxChips > -1 && idxChatBtn > -1 && idxReactStrip > -1,
    'fixture check: all four landmarks are present in the rendered card');
  assert(idxEspn < idxChatBtn,
    'DI-119a: the chat indicator sits AFTER the ESPN link ("next to the ESPN link")');
  assert(idxChatBtn < idxChips && idxReactStrip < idxChips,
    'THE RELOCATION: both the chat indicator and the reaction strip appear BEFORE .dc-chips opens — i.e. inside .dc-game-head/.dc-meta, not as their own rows below the chips (the pre-UN-119 placement)');

  // 36d — a zero-message game still renders the control (discoverable), but
  // its VISIBLE content is icon-only — no "no messages yet" sentence. The
  // sentence legitimately still lives in title/aria-label (accessibility,
  // chat-ui.js's existing, unchanged behavior); only the button's own inner
  // text is asserted here, so this cannot be satisfied by an attribute alone.
  const chatBtnInner = (html36.match(/<button type="button" class="chat-bubble-btn[^>]*>([\s\S]*?)<\/button>/) || [])[1];
  assert(chatBtnInner !== undefined, 'fixture check: the chat button renders with inner content captured');
  assert(/chat-bubble-empty/.test(html36), 'no messages yet on this game → the empty state renders inline in .dc-meta');
  assert((chatBtnInner || '').trim() === '💬',
    `DI-119a: the empty state's VISIBLE content is icon-only, no sentence — got ${JSON.stringify(chatBtnInner)}`);

  // 36e — read and unread states also still work from this new location,
  // reusing chat-ui.js's gameChatBubbleHTML() markup verbatim (no fork).
  chat36.ingest([ev({ id: 'u119_m1', seq: 1, ts: 1000, body: 'thread starter', author: 'un119_rival', gameTag: 'un119_g1' })]);
  chat36.markSeen('all');
  const html36read = app36.renderDashboardCompact(players36, games36, PICKS36, results36, CW.weekId, null);
  assert(/chat-bubble-read/.test(html36read), 'a read thread renders the dim/read state inline in .dc-meta');

  chat36.ingest([ev({ id: 'u119_m2', seq: 2, ts: 2000, body: 'reply', author: 'un119_rival', gameTag: 'un119_g1' })]);
  const html36unread = app36.renderDashboardCompact(players36, games36, PICKS36, results36, CW.weekId, null);
  assert(/chat-bubble-unread/.test(html36unread), 'an unread thread renders the accent state inline in .dc-meta');
  assert(/chat-bubble-count">1</.test(html36unread), 'the unread count badge is present (1), reused verbatim from chat-ui.js');

  // 36f — CONSTRAINT: UN-116 shipped an hour before this change and touches
  // the same renderer's sibling. The compact view's blind rule must still
  // hold — this relocation must not have disturbed canViewOtherPicks()/
  // arePicksPublic() or duplicated their logic.
  assert(/dc-chip-blind/.test(html36unread), 'CONSTRAINT (UN-116): the compact view still blinds the rival\'s pick on an OPEN week');
  const chipsOnly36 = html36unread.slice(html36unread.indexOf('<div class="dc-chips">'));
  assert(!/Texas/.test(chipsOnly36), "CONSTRAINT (UN-116): the rival's actual selection is absent from the served chip markup while blind");

  storage.saveWeek({ ...CW, status: 'live' });
  const html36live = app36.renderDashboardCompact(players36, games36, PICKS36, results36, CW.weekId, null);
  assert(!/dc-chip-blind/.test(html36live) && /Texas/.test(html36live),
    'CONSTRAINT (UN-116): once live, the compact view reveals picks — governed by the same predicate, not bypassed by this change');

  // 36g — the standard matrix (renderDashboardTable) is untouched: it still
  // renders the chat bubble and reaction strip at the bottom of the
  // game-info cell, in their pre-UN-119 (full-size, own-row) form.
  storage.saveWeek({ ...CW, status: 'open' });
  const htmlMatrix36 = app36.renderDashboardTable(players36, games36, PICKS36, results36, CW.weekId, null);
  assert(/game-info-cell/.test(htmlMatrix36) && /chat-bubble-btn/.test(htmlMatrix36) && /reaction-strip/.test(htmlMatrix36),
    'the matrix still renders both indicators in the game-info cell — DI-119a scoped this change to renderDashboardCompact only');
  const cellMatrix36 = (htmlMatrix36.match(/<td class="game-info-cell">[\s\S]*?<\/td>/) || [''])[0];
  assert(/chat-bubble-btn/.test(cellMatrix36) && /reaction-strip/.test(cellMatrix36),
    'both indicators are specifically inside the matrix\'s game-info-cell, not merely present somewhere in the row');

  storage.saveWeek({ ...CW, status: 'open' });
  storage.clearSession();
  localStorage.removeItem('cfbp_chat_lastseen2');
}

// ── 37. UN-120 + UN-121 — right-click/swipe reveal replaces hover; reaction ──
//       names fold into the SAME reveal state as .chat-actions ─────────────
console.log('\n[37a] UN-120 (DI-120a) — hover is GONE; .chat-actions is a positioned, opaque popover…');
{
  // The rule is deleted OUTRIGHT (not tuned with a hover-intent delay, which
  // was proposed and REJECTED — Drew: "hovering with a cursor doesn't work.
  // It should be right click"). Assert the EXACT selector is absent, not
  // merely that some hover text exists elsewhere in the file (there is
  // unrelated `title`/hover copy on the dashboard bubble, §[14]).
  assert(!/\.chat-msg:hover\s*\.chat-actions/.test(cssSrc),
    'DI-120a: `.chat-msg:hover .chat-actions` is deleted from styles.css, not tuned with a delay');
  assert(!/@media\s*\(hover:none\)\{[^}]*\.chat-actions-revealed/.test(cssSrc),
    'the old @media(hover:none) split for the touch reveal is gone — one unconditional rule now covers both gestures');

  const actionsRule37 = (cssSrc.match(/^\.chat-actions\{[^}]*\}/m) || [''])[0];
  assert(actionsRule37.length > 0, 'fixture check: .chat-actions base rule located');
  assert(/display:\s*none/.test(actionsRule37),
    'UN-113/RG-20/RG-21 HARD CONSTRAINT still holds: hidden means display:none (zero layout height), unchanged by the reposition [structural]');
  assert(/position:\s*absolute/.test(actionsRule37) && !/position:\s*relative/.test(actionsRule37),
    'DI-120a: .chat-actions is taken OUT OF DOCUMENT FLOW — position:absolute, not the old position:relative [structural]');
  assert(/background:\s*var\(--bg-card\)/.test(actionsRule37) && /box-shadow:\s*var\(--shadow-card\)/.test(actionsRule37),
    'DI-120a: an opaque card background + shadow, so the popover reads over the message it now overlaps [structural]');
  const bubbleColRule37 = (cssSrc.match(/\.chat-bubble-col\{[^}]*\}/) || [''])[0];
  assert(/position:\s*relative/.test(bubbleColRule37),
    'DI-120a: .chat-bubble-col is the positioning context .chat-actions anchors to, so revealing it cannot shift sibling messages [structural]');

  // ONE reveal mechanism drives BOTH .chat-actions (UN-120) and
  // .chat-reaction-names (UN-121/DI-121a) — same class, unconditional (no
  // hover-capability gate, since right-click has no such signal).
  assert(/\.chat-msg\.chat-actions-revealed \.chat-actions\{display:flex\}/.test(cssSrc),
    'the reveal class restores .chat-actions via display:flex, with no @media(hover:none) wrapper around it any more');
  assert(/\.chat-msg\.chat-actions-revealed \.chat-reaction-names\{display:block\}/.test(cssSrc),
    'DI-121a: the SAME reveal class also restores .chat-reaction-names — one gesture reveals both, not a second one (the RG-21 mistake this avoids)');

  const namesRule37 = (cssSrc.match(/^\.chat-reaction-names\{[^}]*\}/m) || [''])[0];
  assert(/display:\s*none/.test(namesRule37),
    'DI-121a: .chat-reaction-names is display:none by default — no longer always-visible duplication of the pill row above it');
}

console.log('\n[37b] revealMessageActions()/dismissRevealedActions() — only ONE message revealed at a time…');
{
  assert(typeof chatUi._revealMessageActions === 'function' && typeof chatUi._dismissRevealedActions === 'function' && typeof chatUi._revealedMsgIdForTest === 'function',
    'chat-ui.js exports test-only accessors for the shared reveal state');
  const targets37b = {};
  const realQS37b = document.querySelector;
  // DI-125a: production now scopes this query by container id
  // (`#chat-scroll .chat-msg[data-mid="…"]`) — the optional `#id ` prefix
  // here tolerates that without changing what this suite is actually about
  // (single-container "only one revealed at a time"); §[47] covers the
  // cross-container scoping itself.
  document.querySelector = sel => {
    const m = /^(?:#[\w-]+ )?\.chat-msg\[data-mid="([^"]+)"\]$/.exec(sel || '');
    return m ? (targets37b[m[1]] || null) : null;
  };
  function fakeMsg(mid) {
    const classes = new Set();
    const el = { dataset: { mid }, classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) }, _classes: classes };
    targets37b[mid] = el;
    return el;
  }
  const msgA = fakeMsg('reveal_a');
  const msgB = fakeMsg('reveal_b');
  chatUi._revealMessageActions('reveal_a');
  assert(msgA._classes.has('chat-actions-revealed') && chatUi._revealedMsgIdForTest() === 'reveal_a',
    'revealing message A adds the class and updates the shared state');
  chatUi._revealMessageActions('reveal_b');
  assert(!msgA._classes.has('chat-actions-revealed') && msgB._classes.has('chat-actions-revealed') && chatUi._revealedMsgIdForTest() === 'reveal_b',
    'DI-120a: revealing message B removes A\'s class first — only ONE message is ever revealed at a time');
  chatUi._dismissRevealedActions();
  assert(!msgB._classes.has('chat-actions-revealed') && chatUi._revealedMsgIdForTest() === null,
    'dismissing clears the class and the shared state');
  document.querySelector = realQS37b;
}

console.log('\n[37c] DI-120a — desktop right-click (contextmenu) reveals/toggles/switches…');
{
  assert(typeof chatUi._bindMessageActionsContextMenu === 'function',
    'chat-ui.js exports _bindMessageActionsContextMenu (test-only) for behavioral coverage');
  function makeFakeRoot37() {
    const handlers = {};
    return { addEventListener(type, fn) { handlers[type] = fn; }, _fire: (type, e) => handlers[type]?.(e) };
  }
  function fakeMsgEl37(mid) {
    const classes = new Set();
    return { dataset: { mid }, classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) }, _classes: classes };
  }
  const targets37c = {};
  const realQS37c = document.querySelector;
  // DI-125a: tolerate the optional `#id ` container prefix production now emits.
  document.querySelector = sel => {
    const m = /^(?:#[\w-]+ )?\.chat-msg\[data-mid="([^"]+)"\]$/.exec(sel || '');
    return m ? (targets37c[m[1]] || null) : null;
  };
  const targetFor37 = el => ({ closest: sel => (sel === '.chat-msg' ? el : null) });

  const root37c = makeFakeRoot37();
  const msgC1 = fakeMsgEl37('ctx_1'); targets37c['ctx_1'] = msgC1;
  const msgC2 = fakeMsgEl37('ctx_2'); targets37c['ctx_2'] = msgC2;
  chatUi._bindMessageActionsContextMenu(root37c);

  let defaultPrevented = false;
  root37c._fire('contextmenu', { target: targetFor37(msgC1), preventDefault: () => { defaultPrevented = true; } });
  assert(msgC1._classes.has('chat-actions-revealed'), 'right-clicking a message reveals its .chat-actions');
  assert(defaultPrevented, 'DI-120a: preventDefault() is called so the native browser context menu does not also open');

  root37c._fire('contextmenu', { target: targetFor37(msgC2), preventDefault: () => {} });
  assert(!msgC1._classes.has('chat-actions-revealed') && msgC2._classes.has('chat-actions-revealed'),
    'DI-120a: right-clicking a DIFFERENT message hides the first — "only one message revealed at a time"');

  root37c._fire('contextmenu', { target: targetFor37(msgC2), preventDefault: () => {} });
  assert(!msgC2._classes.has('chat-actions-revealed'),
    'right-clicking the SAME already-revealed message a second time closes it (toggle)');

  // Right-clicking outside any message (e.g. empty scroll-area padding) must
  // not throw and must not reveal anything.
  let threwOnEmptyTarget = false;
  try { root37c._fire('contextmenu', { target: { closest: () => null }, preventDefault: () => {} }); }
  catch { threwOnEmptyTarget = true; }
  assert(!threwOnEmptyTarget, 'right-clicking outside any .chat-msg does not throw');

  document.querySelector = realQS37c;
}

console.log('\n[37d] DI-120b — axis-locked swipe: left→right opens reply, right→left opens the react picker…');
{
  assert(typeof chatUi._bindMessageSwipe === 'function' && typeof chatUi._replyTarget === 'function',
    'chat-ui.js exports _bindMessageSwipe and _replyTarget (test-only)');

  function makeFakeRoot37d() {
    const handlers = {};
    return { addEventListener(type, fn) { handlers[type] = fn; }, _fire: (type, e) => handlers[type]?.(e) };
  }
  const targetFor37d = el => ({ closest: sel => (sel === '.chat-msg' ? el : null) });
  const msgEl37d = mid => ({ dataset: { mid } });

  // 37d-i — left → right (positive dx) opens reply, reusing openReplyFor —
  // the SAME state the ↩ button's click handler sets (U.replyTo).
  storage.setSession(null, false, false);   // ensure no stale session bleeds into the react-picker case below
  const rootReply = makeFakeRoot37d();
  chatUi._bindMessageSwipe(rootReply);
  rootReply._fire('touchstart', { touches: [{ clientX: 100, clientY: 100 }], target: targetFor37d(msgEl37d('swipe_reply_msg')) });
  rootReply._fire('touchmove', { touches: [{ clientX: 100 + 45, clientY: 102 }] });   // +45px right, negligible vertical
  assert(chatUi._replyTarget() === 'swipe_reply_msg',
    'DI-120b: a left-to-right swipe past ~40px opens reply for that message (openReplyFor, same as the ↩ button)');

  // 37d-ii — right → left (negative dx) opens the reaction picker, reusing
  // openReactPickerFor → revealMessageActions() + the REAL toggleMessageReactPicker().
  storage.addPlayer(dm.createPlayer('Swipe37Tester', '', '3701', '', 'SW'));
  const swipePlayers = storage.getPlayers();
  const swipePlayer = swipePlayers[swipePlayers.length - 1];
  storage.setSession(swipePlayer.playerId, false, true);

  const targets37d = {};
  const buttons37d = {};
  const realQS37d = document.querySelector;
  const realGEBI37d = document.getElementById;
  const realCreateEl37d = document.createElement;
  // DI-125a: tolerate the optional `#id ` container prefix production now emits.
  document.querySelector = sel => {
    const btnM = /^(?:#[\w-]+ )?\.chat-msg\[data-mid="([^"]+)"\] \[data-react-open\]$/.exec(sel || '');
    if (btnM) return buttons37d[btnM[1]] || null;
    const msgM = /^(?:#[\w-]+ )?\.chat-msg\[data-mid="([^"]+)"\]$/.exec(sel || '');
    if (msgM) return targets37d[msgM[1]] || null;
    return null;
  };
  document.getElementById = id => (id === 'chat-react-picker' ? null : null);
  document.createElement = () => ({
    dataset: {}, classList: { add() {}, remove() {} }, style: {},
    appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {},
    querySelectorAll() { return []; },
    set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html || ''; },
  });

  function fakeMsg37d(mid) {
    const classes = new Set();
    const el = { dataset: { mid }, classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) }, _classes: classes };
    targets37d[mid] = el;
    return el;
  }
  const appended = [];
  const reactBtn37d = { closest: () => null, appendChild: node => appended.push(node) };
  fakeMsg37d('swipe_react_msg');
  buttons37d['swipe_react_msg'] = reactBtn37d;

  const rootReact = makeFakeRoot37d();
  chatUi._bindMessageSwipe(rootReact);
  rootReact._fire('touchstart', { touches: [{ clientX: 200, clientY: 100 }], target: targetFor37d(msgEl37d('swipe_react_msg')) });
  rootReact._fire('touchmove', { touches: [{ clientX: 200 - 45, clientY: 101 }] });   // -45px, right-to-left

  assert(targets37d['swipe_react_msg']._classes.has('chat-actions-revealed'),
    'DI-120b: a right-to-left swipe reveals .chat-actions first (required for the nested picker to render/anchor at all)');
  assert(appended.length === 1 && appended[0]?.className === 'reaction-picker',
    'DI-120b: the SAME toggleMessageReactPicker() the + button calls actually ran end-to-end — a real .reaction-picker node was appended into the message\'s own react-open button');

  document.querySelector = realQS37d;
  document.getElementById = realGEBI37d;
  document.createElement = realCreateEl37d;
  storage.clearSession();
}

console.log('\n[37e] DI-120b — dead zone: a vertical drag never commits a swipe; a short horizontal move (<40px) never commits either…');
{
  function makeFakeRoot37e() {
    const handlers = {};
    return { addEventListener(type, fn) { handlers[type] = fn; }, _fire: (type, e) => handlers[type]?.(e) };
  }
  const targetFor37e = el => ({ closest: sel => (sel === '.chat-msg' ? el : null) });
  storage.clearSession();   // no session — openReactPickerFor's own me() guard would also block it, so this isolates the AXIS logic itself

  // Vertical drag that LATER also drifts far enough horizontally to look
  // like a swipe, IF axis-lock were not actually enforced. Two touchmove
  // events, deliberately: the FIRST establishes the axis (dy=60 dominates
  // dx=5, past the 8px dead zone, so axis locks to 'y'); the SECOND grows dx
  // to 45px (past SWIPE_THRESHOLD_PX) while axis stays locked. A weaker
  // fixture (small dx throughout) would pass even with axis-locking removed
  // entirely, since dx alone would never reach the 40px commit line — this
  // one specifically exercises the lock, not just the commit threshold.
  const rootVert = makeFakeRoot37e();
  chatUi._bindMessageSwipe(rootVert);
  rootVert._fire('touchstart', { touches: [{ clientX: 150, clientY: 150 }], target: targetFor37e({ dataset: { mid: 'vert_msg' } }) });
  rootVert._fire('touchmove', { touches: [{ clientX: 155, clientY: 210 }] });    // dx=5, dy=60 — axis locks 'y' here
  rootVert._fire('touchmove', { touches: [{ clientX: 195, clientY: 240 }] });    // dx=45 (past the 40px commit line), dy=90 — axis must STAY 'y'
  assert(chatUi._replyTarget() !== 'vert_msg',
    'DI-120b: once axis locks to "y", a later dx crossing the 40px commit line does not retroactively open reply — the lock, not just the threshold, is enforced');

  // Short horizontal move: 20px right — under SWIPE_THRESHOLD_PX (40) — must not commit.
  const rootShort = makeFakeRoot37e();
  chatUi._bindMessageSwipe(rootShort);
  rootShort._fire('touchstart', { touches: [{ clientX: 50, clientY: 50 }], target: targetFor37e({ dataset: { mid: 'short_msg' } }) });
  rootShort._fire('touchmove', { touches: [{ clientX: 70, clientY: 51 }] });   // 20px right, under the 40px commit line
  assert(chatUi._replyTarget() !== 'short_msg', 'a horizontal move under ~40px does not commit a swipe (DI-120b\'s stated threshold)');
}

console.log('\n[37f] DI-120b — a committing swipe cancels a PENDING long-press for the same touch…');
{
  // Both real binders on ONE shared root, in PRODUCTION registration order
  // (long-press first, then swipe — bindChatPageEvents, chat-ui.js), so this
  // exercises the actual cross-binder cancellation, not two isolated stories
  // that merely assume it works.
  function makeFakeMultiRoot37f() {
    const handlers = {};
    return {
      addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
      _fire(type, e) { (handlers[type] || []).forEach(fn => fn(e)); },
    };
  }
  const targets37f = {};
  const realQS37f = document.querySelector;
  // DI-125a: tolerate the optional `#id ` container prefix production now emits.
  document.querySelector = sel => {
    const m = /^(?:#[\w-]+ )?\.chat-msg\[data-mid="([^"]+)"\]$/.exec(sel || '');
    return m ? (targets37f[m[1]] || null) : null;
  };
  function fakeMsg37f(mid) {
    const classes = new Set();
    const el = { dataset: { mid }, classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) }, _classes: classes };
    targets37f[mid] = el;
    return el;
  }
  const targetFor37f = el => ({ closest: sel => (sel === '.chat-msg' ? el : null) });

  const root37f = makeFakeMultiRoot37f();
  const msg37f = fakeMsg37f('combo_msg');
  chatUi._bindMessageActionsLongPress(root37f);   // registered FIRST, same as bindChatPageEvents
  chatUi._bindMessageSwipe(root37f);              // registered SECOND

  storage.clearSession();   // the react-picker half of the swipe path is a no-op without a session; isolates the cancellation claim
  root37f._fire('touchstart', { touches: [{ clientX: 100, clientY: 100 }], target: targetFor37f(msg37f) });
  root37f._fire('touchmove', { touches: [{ clientX: 145, clientY: 101 }] });   // +45px right — crosses the swipe commit line well inside 350ms
  await new Promise(r => setTimeout(r, 400));   // past LONG_PRESS_MS even if cancellation had failed
  assert(!msg37f._classes.has('chat-actions-revealed'),
    'DI-120b HARD REQUIREMENT: once a swipe commits, the pending long-press for that SAME touch never reveals .chat-actions, even after 350ms elapses');

  document.querySelector = realQS37f;
}

console.log('\n[37g] DI-120a — Escape, click-elsewhere, and scroll all dismiss a revealed message…');
{
  assert(typeof chatUi._wireRevealCloser === 'function' && typeof chatUi._onChatScrollEvent === 'function',
    'chat-ui.js exports _wireRevealCloser and _onChatScrollEvent (test-only)');

  const targets37g = {};
  const realQS37g = document.querySelector;
  // DI-125a: tolerate the optional `#id ` container prefix production now emits.
  document.querySelector = sel => {
    const m = /^(?:#[\w-]+ )?\.chat-msg\[data-mid="([^"]+)"\]$/.exec(sel || '');
    return m ? (targets37g[m[1]] || null) : null;
  };
  function fakeMsg37g(mid) {
    const classes = new Set();
    const el = { dataset: { mid }, classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) }, _classes: classes };
    targets37g[mid] = el;
    return el;
  }

  const capturedDoc = {};
  const realAddEL = document.addEventListener;
  document.addEventListener = (type, fn) => { (capturedDoc[type] ||= []).push(fn); };
  chatUi._wireRevealCloser();
  document.addEventListener = realAddEL;
  assert(Array.isArray(capturedDoc.click) && capturedDoc.click.length > 0, 'fixture check: wireRevealCloser() registered a document click handler');
  assert(Array.isArray(capturedDoc.keydown) && capturedDoc.keydown.length > 0, 'DI-120a: wireRevealCloser() also registers a document keydown handler for Escape');

  // Escape dismisses.
  const msgEsc = fakeMsg37g('esc_msg');
  chatUi._revealMessageActions('esc_msg');
  capturedDoc.keydown[0]({ key: 'Tab' });
  assert(msgEsc._classes.has('chat-actions-revealed'), 'a non-Escape key does not dismiss');
  capturedDoc.keydown[0]({ key: 'Escape' });
  assert(!msgEsc._classes.has('chat-actions-revealed'), 'DI-120a: pressing Escape dismisses the revealed message');

  // Click elsewhere dismisses; a click INSIDE the revealed message does not.
  const msgClick = fakeMsg37g('click_msg');
  chatUi._revealMessageActions('click_msg');
  capturedDoc.click[0]({ target: { closest: sel => (sel === `.chat-msg[data-mid="click_msg"]` ? {} : null) } });
  assert(msgClick._classes.has('chat-actions-revealed'), 'a click INSIDE the revealed message does not dismiss it');
  capturedDoc.click[0]({ target: { closest: () => null } });
  assert(!msgClick._classes.has('chat-actions-revealed'), 'DI-120a: a click OUTSIDE the revealed message dismisses it');

  // Scrolling dismisses (onChatScrollEvent — wired per-render on the real
  // #chat-scroll, since that element is replaced on every re-render).
  const msgScroll = fakeMsg37g('scroll_msg');
  chatUi._revealMessageActions('scroll_msg');
  // scrollHeight - scrollTop - clientHeight = 1000-200-500 = 300, well past
  // the 120px "near bottom" cutoff — i.e. NOT near the bottom yet.
  const fakeScrollEl = { scrollHeight: 1000, scrollTop: 200, clientHeight: 500 };
  const fakeJumpEl = { style: {} };
  chatUi._onChatScrollEvent(fakeScrollEl, fakeJumpEl);
  assert(!msgScroll._classes.has('chat-actions-revealed'), 'DI-120a: scrolling the message list dismisses the revealed message');
  // Bonus (pre-existing, previously untested) coverage: the jump-to-latest
  // button's own show/hide logic, now routed through the same function,
  // still works — not near the bottom (300px of remaining scroll > 120px cutoff).
  assert(fakeJumpEl.style.display === 'block', 'fixture check: onChatScrollEvent still drives the jump-to-latest button\'s visibility unchanged');
  chatUi._onChatScrollEvent({ scrollHeight: 1000, scrollTop: 900, clientHeight: 500 }, fakeJumpEl);   // 1000-900-500 = -400 < 120 → near bottom
  assert(fakeJumpEl.style.display === 'none', 'fixture check: near the bottom, the jump-to-latest button hides, unchanged by this refactor');

  document.querySelector = realQS37g;
}

console.log('\n[37h] DI-121a CONSTRAINT — the reaction pill\'s own tap-to-vote is untouched, and independent of reveal state…');
{
  // _reactionsHTML (§[28]) is the REAL render function. Confirm its pill
  // markup (data-react / data-target, tap-to-toggle-my-own-vote) carries no
  // reference to the reveal class or any reveal-gesture attribute — the pill
  // is generated the SAME way regardless of whether the message is currently
  // revealed, so the two gestures structurally cannot collide.
  const pillMsg37h = { id: 'pill_msg', reactions: { '🔥': ['p1', 'p2'] } };
  const pillHTML37h = chatUi._reactionsHTML(pillMsg37h, 'p1');
  assert(/data-react="🔥"/.test(pillHTML37h) && /data-target="pill_msg"/.test(pillHTML37h),
    'the reaction pill still carries its own data-react/data-target tap-to-toggle attributes, unchanged by UN-120/UN-121');
  assert(!/chat-actions-revealed/.test(pillHTML37h) && !/data-react-open/.test(pillHTML37h) && !/data-reply/.test(pillHTML37h),
    'the pill markup itself is generated independently of the reveal mechanism — reveal is a different gesture on a different element, per DI-121a');
  assert(/class="chat-react-pill me"/.test(pillHTML37h),
    'fixture check: the pill still marks the viewer\'s OWN reaction (the exact tap target whose behavior must stay a plain tap)');
}

console.log('\n[37i] RG-21 recurrence guard — the density gain this batch is supposed to protect must not be silently cancelled again…');
{
  // Both newly-hidden-by-default elements (.chat-actions, .chat-reaction-names)
  // reserve ZERO layout height while hidden (display:none on both, §[37a]) —
  // the structural precondition for a real density gain on reacted messages,
  // the exact class of message RG-21 found cancelled to a wash (4.58→4.60/screen).
  // A PIXEL-PER-SCREEN measurement (like RG-21's) requires an actual layout
  // engine — this harness has none (DOM stubs only) — so this suite proves the
  // STRUCTURAL precondition and stops there; see the handoff report for the
  // explicit statement that the real number needs a browser pass. [structural]
  const actionsRule37i = (cssSrc.match(/^\.chat-actions\{[^}]*\}/m) || [''])[0];
  const namesRule37i = (cssSrc.match(/^\.chat-reaction-names\{[^}]*\}/m) || [''])[0];
  assert(/display:\s*none/.test(actionsRule37i) && /display:\s*none/.test(namesRule37i),
    'both elements this batch newly gates start display:none — neither can reserve invisible layout height while hidden [structural]');
  // The UN-114/RG-21 fix itself: the pill's OWN box has no tall min-height
  // (absent entirely, same as it shipped — a missing declaration reads as 0
  // here, same convention §[28] uses), while the hit target lives on the
  // separate, invisible ::after overlay at >=40px. Neither half regressed.
  const pillRule37i = (cssSrc.match(/\.chat-react-pill\{[^}]*\}/) || [''])[0];
  const pillOwnMinH37i = Number((pillRule37i.match(/min-height:\s*(\d+)px/) || [])[1] || 0);
  assert(pillOwnMinH37i < 30, `the pill's own visible box stays compact (no tall min-height regressed in) — got ${pillOwnMinH37i}px [structural]`);
  const pillHitRule37i = (cssSrc.match(/\.chat-react-pill::after\{[^}]*\}/) || [''])[0];
  const pillHitH37i = Number((pillHitRule37i.match(/height:\s*(\d+)px/) || [])[1] || 0);
  assert(pillHitH37i >= 40, `the UN-114/RG-21 invisible ::after hit overlay is still >=40px, untouched by this batch — got ${pillHitH37i}px [structural]`);
}

// ── 38. RG — a LIVE week must be public even with the Week-tab dates set ─────
// The reported defect: with "Auto-Lock At (override)" filled in — an ordinary
// commissioner configuration (app.js #picks-open-at / #picks-lock-at) — the
// ENTIRE live window rendered blind. Matrix •••, compact chips •••,
// tiebreakers ***, correct/incorrect —, chat pick chips suppressed, the reveal
// ritual never fired, and the explanatory note told players "check back at
// kickoff" after kickoff. It only unblinded on manual finalize.
//
// Mechanism: getEffectiveWeekStatus() consults picksLockAt/picksOpenAt BEFORE
// falling through to week.status and has no 'live' branch at all, so a week the
// app itself auto-advanced to LIVE (tickAutoTransition, LOCKED→LIVE at first
// kickoff) reported back as 'locked' or 'open'.
//
// WHY [34] MISSED IT: every fixture in the UN-116 suite is built by an mk()
// that sets NO date fields — the one week shape in which the two code paths
// agree. These fixtures set them, with ELAPSED values computed from now() so
// the suite cannot quietly stop reproducing the bug as the season moves on.
console.log('\n[38] RG — a LIVE week stays public with Auto-Open / Auto-Lock set…');
{
  const app38 = mods['app'];
  const ago38 = h => new Date(Date.now() - h * 3600e3).toISOString();
  const OPEN_AT_38 = ago38(96);   // Auto-Open At — elapsed four days ago
  const LOCK_AT_38 = ago38(2);    // Auto-Lock At — elapsed; first kickoff has passed
  const DATES_38 = [
    ['no date fields',                   {}],
    ['picksOpenAt set (Auto-Open At)',   { picksOpenAt: OPEN_AT_38 }],
    ['picksLockAt set (Auto-Lock)',      { picksLockAt: LOCK_AT_38 }],
    ['BOTH date fields set',             { picksOpenAt: OPEN_AT_38, picksLockAt: LOCK_AT_38 }],
  ];
  const mk38 = (status, extra = {}) => ({
    weekId: 'rg38_' + status, weekNumber: 1, season: 2026, status, dataSourceMode: 'demo',
    startDate: '2026-09-05', endDate: '2026-09-06', ...extra,
  });

  // 38a — THE REGRESSION. All four configurations of a LIVE week, not just the
  // one with empty dates. week.status === 'live' is the authoritative,
  // automatically-maintained "first game has kicked off" signal; nothing the
  // commissioner types into a datetime field may override it.
  for (const [label, dates] of DATES_38) {
    assert(storage.arePicksPublic(mk38('live', dates)) === true,
      `LIVE week with ${label}: picks ARE public — kickoff has happened, the blind window is over`);
  }
  // 38b — FINAL is unaffected (it already had an explicit week.status clause).
  for (const [label, dates] of DATES_38) {
    assert(storage.arePicksPublic(mk38('final', dates)) === true,
      `FINAL week with ${label}: picks ARE public (unchanged)`);
  }
  // 38c — the blind side must NOT loosen. This is the direction that leaks, so
  // it is asserted across the same four date configurations.
  for (const [label, dates] of DATES_38) {
    assert(storage.arePicksPublic(mk38('draft', dates)) === false, `DRAFT week with ${label}: still blind`);
    assert(storage.arePicksPublic(mk38('open', dates)) === false, `OPEN week with ${label}: still blind — picks are still editable`);
    assert(storage.arePicksPublic(mk38('locked', dates)) === false, `LOCKED week with ${label}: still blind (UN-116 threshold is live/final, never lock)`);
  }
  assert(storage.arePicksPublic(null) === false, 'a missing week is never public (unchanged)');

  // 38d — the surface a player actually sees. A predicate-only test would have
  // passed against the shipped UN-116 defect ([34]'s header explains why), so
  // assert the served dashboard markup for the exact week shape Drew runs:
  // LIVE, with both date fields filled in.
  const LW38 = mk38('live', { weekId: 'rg38_wk', picksOpenAt: OPEN_AT_38, picksLockAt: LOCK_AT_38 });
  storage.saveWeek(LW38);
  storage.saveGame({ weekId: LW38.weekId, gameId: 'rg38_g1', homeTeam: 'Ohio State', awayTeam: 'Texas', kickoff: '2026-09-05T16:00:00Z', status: 'scheduled', spread: -3 });
  storage.addPlayer({ playerId: 'rg38_me', displayName: 'Me', active: true });
  storage.addPlayer({ playerId: 'rg38_rival', displayName: 'Rival', active: true });
  const PICKS38 = [
    { pickId: 'rg38_pk1', weekId: LW38.weekId, gameId: 'rg38_g1', playerId: 'rg38_me', selectedTeam: 'Ohio State' },
    { pickId: 'rg38_pk2', weekId: LW38.weekId, gameId: 'rg38_g1', playerId: 'rg38_rival', selectedTeam: 'Texas' },
  ];
  storage.saveAllPicks([...storage.getPicks(), ...PICKS38]);
  const players38 = [
    { playerId: 'rg38_me', displayName: 'Me', active: true },
    { playerId: 'rg38_rival', displayName: 'Rival', active: true },
  ];
  const results38 = players38.map((p, i) => ({ playerId: p.playerId, rank: i + 1, correctPicks: 1, incorrectPicks: 0, tiebreakerGuess: 40 + i, tiebreakerDelta: 0 }));

  storage.setSession('rg38_me', false, true);   // an ordinary player, not the commissioner
  assert(app38.canViewOtherPicks(storage.getWeek(LW38.weekId)) === true,
    'a player CAN see the other five during the live window of a date-configured week');
  const html38 = app38.renderDashboardTable(players38, storage.getGames(LW38.weekId), PICKS38, results38, LW38.weekId, null);
  const cells38 = (html38.match(/<td class="pick-cell[\s\S]*?<\/td>/g) || []);
  assert(cells38.length === 2, `fixture check: one pick cell per player (got ${cells38.length})`);
  assert(!/pick-cell-blind/.test(html38),
    'THE DEFECT: no blind cells survive in the live matrix — the whole week used to render ••• until manual finalize');
  assert(/Texas/.test(cells38.join('')),
    "the rival's actual selection is present in the live matrix, not masked");

  // 38e — same fixture, week rewound to OPEN. The fix must not have turned the
  // date fields into a general unblinding: this must still be blind.
  storage.saveWeek({ ...LW38, status: 'open' });
  assert(app38.canViewOtherPicks(storage.getWeek(LW38.weekId)) === false,
    'rewound to OPEN with the same elapsed date fields, the rival is blind again');
  const htmlOpen38 = app38.renderDashboardTable(players38, storage.getGames(LW38.weekId), PICKS38, results38, LW38.weekId, null);
  const blindCells38 = (htmlOpen38.match(/<td class="pick-cell[\s\S]*?<\/td>/g) || []).filter(c => /pick-cell-blind/.test(c));
  assert(blindCells38.length === 1,
    `exactly the rival's cell is blinded on the OPEN week (got ${blindCells38.length}) — the blind rule is intact`);
  assert(!/Texas/.test(blindCells38.join('')),
    "on the OPEN week the rival's selection is absent from the served markup");

  // 38f — THE OTHER HALF OF THE SAME NEED. Drew, 2026-08-12: "Only time you
  // should see other people's picks are live and final, WHEN YOU CANT EDIT
  // other picks." Unblinding the live window above satisfies the first clause;
  // this asserts the second, which the identical root cause had broken.
  //
  // In the Auto-Open-only configuration (Auto-Lock left blank — its documented
  // default, "blank = auto-derive") getEffectiveWeekStatus() reports 'open' for
  // a week the app already advanced to LIVE, so canPlayerSubmitPicks()'s
  // eff==='live' branch — which exists and plainly intends to deny — never
  // fires. A player could read the whole field and still change a pick on a
  // game that had not kicked off yet. That is precisely the exploit UN-116 was
  // built to close, and unblinding without this would have re-opened it.
  const LIVE_OPENONLY_38 = mk38('live', { weekId: 'rg38_openonly', picksOpenAt: OPEN_AT_38 });
  assert(storage.arePicksPublic(LIVE_OPENONLY_38) === true,
    'fixture check: this LIVE week is public (Auto-Open set, Auto-Lock blank)');
  assert(app38.canPlayerSubmitPicks(LIVE_OPENONLY_38, 'rg38_me').allowed === false,
    'a LIVE week refuses picks even with only Auto-Open At set — nobody may see the field AND still edit');
  for (const [label, dates] of DATES_38) {
    assert(app38.canPlayerSubmitPicks(mk38('live', dates), 'rg38_me').allowed === false,
      `LIVE week with ${label}: picks are closed — visibility and editability flip at the same instant`);
  }
  // The locked architectural decision is untouched: while the slate is genuinely
  // OPEN, picks stay editable. This is the assertion that would catch an
  // over-broad "just deny everything" fix.
  assert(app38.canPlayerSubmitPicks(mk38('open', { picksOpenAt: OPEN_AT_38 }), 'rg38_me').allowed === true,
    'an OPEN week still accepts picks — "player picks are editable while the slate is open" is a locked decision');
  assert(app38.canPlayerSubmitPicks(mk38('draft'), 'rg38_me').allowed === false, 'a DRAFT week accepts no picks (unchanged)');
  assert(app38.canPlayerSubmitPicks(mk38('final'), 'rg38_me').allowed === false, 'a FINAL week accepts no picks (unchanged)');
  assert(app38.canPlayerSubmitPicks(null, 'rg38_me').allowed === false, 'no week, no picks (unchanged)');
  assert(app38.canPlayerSubmitPicks(mk38('open'), null).allowed === false, 'signed out, no picks (unchanged)');

  // 38g — THE SECOND HALF OF THE SAME DEFECT. The 'live' fix above consulted
  // week.status for 'live' and stopped there; 'locked' has the identical shape.
  // On a week with Auto-Open At set and Auto-Lock left blank,
  // getEffectiveWeekStatus() reports 'open' for a week the app itself advanced
  // to LOCKED (tickAutoTransition, 30 min pre-kickoff), so the eff==='locked'
  // branch never fires and the commissioner's explicit lock does NOTHING —
  // picks stay submittable through the entire lock window, with only each
  // game's own kickoff (isGamePickable) left as a brake.
  //
  // Not an information leak — arePicksPublic() is correctly false on a locked
  // week — but the lock is the commissioner's control over the slate and it was
  // silently inert. Asserted as a pair so the asymmetry is on the record.
  const LOCKED_OPENONLY_38 = mk38('locked', { weekId: 'rg38_lockedopenonly', picksOpenAt: OPEN_AT_38 });
  assert(storage.getEffectiveWeekStatus(LOCKED_OPENONLY_38) === 'open',
    "fixture check: getEffectiveWeekStatus() reports 'open' for this LOCKED week — the blind spot both halves of this defect hid in");
  assert(storage.arePicksPublic(LOCKED_OPENONLY_38) === false,
    'fixture check: the locked week is still blind — this half is an inert lock, not a leak');
  assert(app38.canPlayerSubmitPicks(LOCKED_OPENONLY_38, 'rg38_me').allowed === false,
    'a LOCKED week refuses picks even with only Auto-Open At set — the commissioner lock is not advisory');

  // 38h — EXHAUSTIVE over statuses × date-configurations. Both halves of this
  // defect hid in the SAME blind spot: a week.status the eff-branch chain could
  // not express, paired with a date field that made getEffectiveWeekStatus()
  // report something else. Enumerating every cell is the only shape that stops
  // a third one hiding there.
  //
  // Expectations are DECLARED, never derived by calling getEffectiveWeekStatus()
  // — a table computed from the implementation agrees with any bug it contains.
  //
  // Exactly one state accepts picks: a week the commissioner has OPEN whose
  // Auto-Lock time has not elapsed. LOCK_AT_38 is two hours in the past, so any
  // configuration carrying it closes the slate — that is what the field is for,
  // and it is the assertion that would catch an over-broad "deny everything" fix
  // in the other direction.
  const SUBMIT_MATRIX_38 = {
    //          no dates | openAt only | lockAt only | both
    draft:  [false, false, false, false],
    open:   [true,  true,  false, false],
    locked: [false, false, false, false],
    live:   [false, false, false, false],
    final:  [false, false, false, false],
  };
  for (const [status, expected] of Object.entries(SUBMIT_MATRIX_38)) {
    assert(expected.length === DATES_38.length,
      `matrix check: ${status} row covers all ${DATES_38.length} date configurations`);
    DATES_38.forEach(([label, dates], i) => {
      const got = app38.canPlayerSubmitPicks(mk38(status, dates), 'rg38_me').allowed;
      assert(got === expected[i],
        `${status.toUpperCase()} week with ${label}: picks ${expected[i] ? 'ACCEPTED' : 'refused'} (got ${got ? 'ACCEPTED' : 'refused'})`);
    });
  }
  assert(Object.keys(SUBMIT_MATRIX_38).length === 5,
    'matrix check: all five week statuses are enumerated — draft/open/locked/live/final');

  storage.saveWeek({ ...LW38, status: 'live' });
  storage.setSession(null, false, false);
}

// ── 39. RG — locked→final must still post the Extra Point reveal ─────────────
// DI-116e added a blind-rule guard to emitExtraPointEvent() that re-reads the
// week from storage. The Week-tab status button ran finalizeWeek(week) BEFORE
// saveWeek(upd), so the guard saw a week still marked 'locked' and returned
// early. The event carries a deterministic id (sys_ep_<weekId>) with
// server-side dedupe, so a skipped post NEVER re-emits — that week's Extra
// Point reveal was lost permanently, silently, on the most ordinary
// commissioner action there is.
//
// Driven through applyWeekStatusChange() — the real handler body, extracted so
// the ORDER OF OPERATIONS is reachable here. Asserting on the emitted chat
// event, never on the source text of the call site.
console.log('\n[39] RG — the ordinary locked→final commissioner action still posts the Extra Point…');
{
  const app39 = mods['app'];
  const mkWeek39 = (weekId, status) => ({
    weekId, weekNumber: 7, season: 2026, status, dataSourceMode: 'demo',
    startDate: '2026-09-05', endDate: '2026-09-06', extraPointActual: 52,
  });
  const seed39 = (weekId, status) => {
    const w = mkWeek39(weekId, status);
    storage.saveWeek(w);
    storage.saveGame({ weekId, gameId: weekId + '_g1', homeTeam: 'Ohio State', awayTeam: 'Texas', kickoff: '2026-09-05T16:00:00Z', status: 'final', homeScore: 28, awayScore: 21, spread: -3, lockedSpread: -3 });
    storage.setExtraPointGuess(weekId, 'rg38_me', 48);
    storage.setExtraPointGuess(weekId, 'rg38_rival', 55);
    return storage.getWeek(weekId);
  };

  // 39a — THE REGRESSION. A LOCKED week, commissioner presses FINAL.
  const W39 = seed39('rg39_locked', 'locked');
  assert(storage.getWeek(W39.weekId).status === 'locked', 'fixture check: the week in storage is LOCKED when the button is pressed');
  assert(!getMessage(`sys_ep_${W39.weekId}`), 'fixture check: nothing posted yet');
  app39.applyWeekStatusChange(W39, 'final');
  assert(storage.getWeek(W39.weekId).status === 'final', 'the transition itself persisted');
  const ep39 = getMessage(`sys_ep_${W39.weekId}`);
  assert(!!ep39,
    'THE DEFECT: locked→final posts the Extra Point reveal — the guard must not be defeatable by the caller saving after it runs');
  assert(/Extra Point/.test(ep39?.body || '') && /52/.test(ep39?.body || ''),
    'the posted event carries the actual yardage and both entries, not an empty shell');

  // 39b — the same transition from LIVE, which already worked. Still works.
  const WL39 = seed39('rg39_live', 'live');
  app39.applyWeekStatusChange(WL39, 'final');
  assert(!!getMessage(`sys_ep_${WL39.weekId}`), 'live→final posts the Extra Point (unchanged)');

  // 39c — THE GUARD ITSELF MUST SURVIVE (Defect 3: it had zero coverage — the
  // reviewer deleted it and the suite stayed green at 670/670). It exists
  // because a commissioner could otherwise publish the whole field's Extra
  // Point guesses into the public room while the slate was still open and every
  // player could still change their own entry. Fixing the ordering above must
  // not have amounted to deleting it.
  const WO39 = seed39('rg39_open', 'open');
  const graded39 = mods['extra-point'].gradeWeekExtraPoint(WO39, storage.getPlayers().filter(p => p.active));
  assert(!!graded39, 'fixture check: the open week grades — so the post below is blocked by the blind rule and nothing else');
  chatUi.emitExtraPointEvent(WO39.weekId, graded39);
  assert(!getMessage(`sys_ep_${WO39.weekId}`),
    'BLIND RULE: an OPEN week never publishes the field\'s Extra Point guesses (permanent once emitted — deterministic id, no take-backs)');
  const WK39 = seed39('rg39_lockedonly', 'locked');
  chatUi.emitExtraPointEvent(WK39.weekId, graded39);
  assert(!getMessage(`sys_ep_${WK39.weekId}`),
    'BLIND RULE: a LOCKED week never publishes them either (UN-116 threshold is live/final, never lock)');
  // …and through the real handler, which is the path a commissioner actually
  // takes. open→locked runs no finalization, so nothing may be published.
  const WP39 = seed39('rg39_openbtn', 'open');
  app39.applyWeekStatusChange(WP39, 'locked');
  assert(!getMessage(`sys_ep_${WP39.weekId}`),
    'BLIND RULE: pressing LOCKED on an open week publishes no Extra Point — only finalization does');
  // A LIVE week does publish, which is what proves the three assertions above
  // are measuring the blind rule rather than a permanently dead emitter.
  const WV39 = seed39('rg39_livedirect', 'live');
  chatUi.emitExtraPointEvent(WV39.weekId, graded39);
  assert(!!getMessage(`sys_ep_${WV39.weekId}`),
    'fixture check: the same call on a LIVE week DOES publish — the guard is a live gate, not a dead code path');

  // ── 39d — RG-45. THE THIRD SIBLING HAD NO GATE AT ALL.
  //
  // emitGameFinalEvent() (chat-ui.js) posts full per-game pick attribution BY
  // NAME — "— right: Rival; wrong: Me" — into the public room. Its two
  // siblings in the same block of emitters both gate on arePicksPublic():
  // emitPickRevealEvent (chat-ui.js:1868) and emitExtraPointEvent (:1938,
  // asserted in 39c above). This one asked nothing.
  //
  // THE REACHABLE HOLE, which is why this is not theoretical: a week left OPEN
  // with picksLockAt still in the future while ESPN marks its games final.
  // canPlayerSubmitPicks() returns allowed on exactly that state (asserted
  // below, read from the predicate rather than assumed), and doRefreshScores()
  // — the 60-second auto-refresh loop, no human involved — calls this emitter
  // on the scheduled→final transition. Every player who had not yet picked
  // would read the field's answers for a game that already finished.
  //
  // It cannot be walked back: the event carries a deterministic id
  // (sys_final_<gameId>) into an append-only log (AD-26). Suppressing only the
  // attribution half would be WORSE than gating the whole event — the id would
  // be consumed by the redacted post, and finalizeWeek()'s later re-emit of the
  // complete one would dedupe away, losing right/wrong permanently. Gating the
  // whole event leaves the id unconsumed, so the full post still arrives at
  // finalization.
  const seedFinal39 = (weekId, status, extra = {}) => {
    const w = { weekId, weekNumber: 8, season: 2026, status, dataSourceMode: 'demo',
                startDate: '2026-09-05', endDate: '2026-09-06', ...extra };
    storage.saveWeek(w);
    storage.saveGame({ weekId, gameId: weekId + '_g1', homeTeam: 'Ohio State', awayTeam: 'Texas',
      kickoff: '2026-09-05T16:00:00Z', status: 'final', homeScore: 28, awayScore: 21,
      spread: -3, lockedSpread: -3, atsWinner: 'Ohio State' });
    return storage.getWeek(weekId);
  };
  const FUT39 = '2026-12-01T00:00:00Z';
  const WGF39 = seedFinal39('rg39_gfopen', 'open', { picksLockAt: FUT39 });
  assert(app39.canPlayerSubmitPicks(WGF39, 'rg38_me').allowed === true,
    'fixture check: the hole is REACHABLE — an OPEN week whose Auto-Lock is still in the future accepts picks while its games are already FINAL');
  assert(storage.arePicksPublic(WGF39) === false,
    'fixture check: …and that same week is still blind, so nothing may publish who was right');
  chatUi.emitGameFinalEvent(storage.getGame(WGF39.weekId + '_g1'), 'Ohio State', ['rg38_rival'], ['rg38_me']);
  const gf39 = getMessage(`sys_final_${WGF39.weekId}_g1`);
  assert(!gf39,
    'BLIND RULE: a game going final on a still-OPEN week publishes NO chat event — the per-game right/wrong roster is pick attribution by name, and it is permanent once emitted');

  // The LOCKED week too — the UN-116 threshold is live/final, never lock.
  const WGL39 = seedFinal39('rg39_gflocked', 'locked');
  chatUi.emitGameFinalEvent(storage.getGame(WGL39.weekId + '_g1'), 'Ohio State', ['rg38_rival'], ['rg38_me']);
  assert(!getMessage(`sys_final_${WGL39.weekId}_g1`),
    'BLIND RULE: a LOCKED week does not publish per-game attribution either (same threshold as every other reveal surface)');

  // …and the other half, so a permanently dead emitter cannot pass: on a LIVE
  // week the event posts IN FULL, names and all. This is also what proves the
  // deterministic id was never consumed by the blocked calls above.
  const WGV39 = seedFinal39('rg39_gflive', 'live');
  chatUi.emitGameFinalEvent(storage.getGame(WGV39.weekId + '_g1'), 'Ohio State', ['rg38_rival'], ['rg38_me']);
  const gfLive39 = getMessage(`sys_final_${WGV39.weekId}_g1`);
  assert(!!gfLive39, 'fixture check: the same call on a LIVE week DOES post — the guard is a gate, not a dead path');
  assert(/right: Rival/.test(gfLive39?.body || '') && /wrong: Me/.test(gfLive39?.body || ''),
    'and it posts the FULL right/wrong roster by name once the week is public — the disclosure is deferred, not deleted');
  assert(/FINAL: Texas 21–28 Ohio State/.test(gfLive39?.body || ''),
    'the scoreline itself is unchanged — this gate moved WHEN the event posts, not what it says');
}

// ── 40. RG — the ⚡ chat pick chip carries the blind rule, and is covered ─────
// The reviewer deleted pickChip()'s arePicksPublic() guard and the full suite
// stayed green at 670/670: the harness never rendered a chat message at all, so
// the busiest surface in the app had zero coverage of the rule. If that guard
// silently reverted, every message in the room would advertise its author's
// pick while the week was still open and editable.
//
// Asserted against the markup messageHTML() actually returns — not pickChip in
// isolation, and never by matching a name in the source, which is the exact
// anti-pattern that let RG-12 recur.
console.log('\n[40] RG — chat ⚡ pick chip obeys the blind rule (rendered markup)…');
{
  const W40 = { weekId: 'rg40_wk', weekNumber: 3, season: 2026, status: 'open', dataSourceMode: 'demo', startDate: '2026-09-05', endDate: '2026-09-06' };
  storage.saveWeek(W40);
  storage.saveGame({ weekId: W40.weekId, gameId: 'rg40_g1', homeTeam: 'Ohio State', awayTeam: 'Texas', kickoff: '2026-09-05T16:00:00Z', status: 'scheduled', spread: -3 });
  storage.addPlayer({ playerId: 'rg40_me', displayName: 'Me', active: true });
  storage.addPlayer({ playerId: 'rg40_rival', displayName: 'Rival', active: true });
  storage.saveAllPicks([...storage.getPicks(),
    { pickId: 'rg40_pk1', weekId: W40.weekId, gameId: 'rg40_g1', playerId: 'rg40_me', selectedTeam: 'Ohio State' },
    { pickId: 'rg40_pk2', weekId: W40.weekId, gameId: 'rg40_g1', playerId: 'rg40_rival', selectedTeam: 'Texas' },
  ]);
  const msg40 = author => ({ id: 'rg40_m_' + author, seq: 1, ts: Date.now(), type: 'message', author, body: 'lock it in', gameTag: 'rg40_g1' });
  // The chip is the ONLY thing under test. The matchup chip next to it
  // legitimately names both teams, so scope every assertion to the chip's own
  // markup — a whole-document search would be a false positive either way.
  const chipOf = html => (html.match(/<span class="pick-chip[\s\S]*?<\/span>/g) || []).join('');

  // 40a — OPEN. Nothing about anyone's selection may appear.
  const openMine40  = mods['chat-ui']._messageHTMLForTest(msg40('rg40_me'), 'rg40_me', false);
  const openRival40 = mods['chat-ui']._messageHTMLForTest(msg40('rg40_rival'), 'rg40_me', false);
  assert(chipOf(openRival40) === '',
    'THE LEAK: on an OPEN week a rival\'s message renders NO ⚡ pick chip — the room may not publish what the dashboard hides');
  assert(!/⚡/.test(openRival40),
    'the ⚡ glyph itself is absent from the served markup — blinded server-side, not hidden with CSS');
  assert(chipOf(openMine40) === '',
    'the viewer\'s own message carries no chip either while the week is open (the chip is week-gated, not author-gated)');
  assert(/chat-author/.test(openRival40) && /lock it in/.test(openRival40),
    'fixture check: the message itself still renders — only the chip is withheld');

  // 40b — LIVE. The chip appears, for the rival, naming the rival's team.
  storage.saveWeek({ ...W40, status: 'live' });
  const liveRival40 = mods['chat-ui']._messageHTMLForTest(msg40('rg40_rival'), 'rg40_me', false);
  const liveChip40 = chipOf(liveRival40);
  assert(liveChip40 !== '' && /⚡/.test(liveChip40),
    'once LIVE the ⚡ chip renders — the chip is genuinely wired into messageHTML(), not dead code');
  assert(/Texas|TEX/.test(liveChip40),
    `the chip names the rival's actual pick — got "${liveChip40.replace(/<[^>]*>/g, '').trim()}"`);
  assert(/Rival picked Texas/.test(liveRival40),
    'the chip\'s title attribute attributes the pick to its author');

  // 40c — the same LIVE week with the commissioner's date fields set. This is
  // suite [38]'s defect measured on the chat surface: the chip vanished for the
  // entire live window whenever Auto-Lock was configured.
  storage.saveWeek({ ...W40, status: 'live', picksOpenAt: new Date(Date.now() - 96 * 3600e3).toISOString(), picksLockAt: new Date(Date.now() - 2 * 3600e3).toISOString() });
  assert(chipOf(mods['chat-ui']._messageHTMLForTest(msg40('rg40_rival'), 'rg40_me', false)) !== '',
    'the ⚡ chip still renders on a LIVE week whose Auto-Open/Auto-Lock fields are filled in');

  // 40d — and it closes again. A chip that could never be withheld would pass
  // 40b/40c while leaking permanently.
  storage.saveWeek({ ...W40, status: 'locked' });
  assert(chipOf(mods['chat-ui']._messageHTMLForTest(msg40('rg40_rival'), 'rg40_me', false)) === '',
    'rewound to LOCKED the chip is withheld again — the guard is live, not a one-way door');

  // ── 40e — RG-46. THE SIXTH RECURRENCE, AND THE FIRST FOUND BY MACHINE.
  //
  // Not reported by anybody and not on the list this pass started with: the
  // structural guard in [64] flagged `calloutEligible()` as a function reading
  // another player's picks with no blind check, and it was right.
  //
  // The 📎 callout button renders next to a message only when its author's
  // pick LOST that game ATS. Its mere PRESENCE is therefore a one-bit
  // disclosure of that author's selection — and in a two-outcome game one bit
  // is the whole pick: seeing 📎 on Koby's pre-kick message tells you he took
  // the team that did not cover. It is rendered by messageHTML(), so every
  // player sees it on every message in the room.
  //
  // Reachable through the SAME window as RG-45: calloutEligible() gates on the
  // GAME being final, never on the WEEK, so a week left OPEN with picksLockAt
  // in the future while ESPN finalizes games renders 📎 markers across the
  // chat to players who can still submit.
  const nowC40 = Date.now();
  storage.saveWeek({ ...W40, status: 'open' });
  storage.saveGame({ weekId: W40.weekId, gameId: 'rg40_g1', homeTeam: 'Ohio State', awayTeam: 'Texas',
    kickoff: new Date(nowC40 + 3600e3).toISOString(), status: 'final',
    homeScore: 28, awayScore: 21, spread: -3, lockedSpread: -3, atsWinner: 'Ohio State' });
  const calloutMsg40 = { id: 'rg40_callout', seq: 2, ts: nowC40 - 60000, type: 'message',
                         author: 'rg40_rival', body: 'Texas covers, book it', gameTag: 'rg40_g1' };
  const openCallout40 = mods['chat-ui']._messageHTMLForTest(calloutMsg40, 'rg40_me', false);
  assert(/chat-author/.test(openCallout40) && /Texas covers, book it/.test(openCallout40),
    'fixture check: the rival\'s message itself renders — only the 📎 marker is in question');
  assert(!/data-callout/.test(openCallout40),
    'THE LEAK (RG-46): on a still-OPEN week no 📎 callout button renders on a rival\'s message — its presence alone discloses that the author picked the team that did not cover, which in a two-outcome game IS the pick');

  // The other half: once the week is public the button comes back. Without
  // this, "delete the button" would pass the assertion above.
  storage.saveWeek({ ...W40, status: 'live' });
  const liveCallout40 = mods['chat-ui']._messageHTMLForTest(calloutMsg40, 'rg40_me', false);
  assert(/data-callout="rg40_callout"/.test(liveCallout40),
    'once the week is LIVE the 📎 callout renders again — the gate defers the disclosure, it does not remove the feature');

  // Restore the fixture for anything downstream that reuses this week/game.
  storage.saveWeek({ ...W40, status: 'open' });
  storage.saveGame({ weekId: W40.weekId, gameId: 'rg40_g1', homeTeam: 'Ohio State', awayTeam: 'Texas',
    kickoff: '2026-09-05T16:00:00Z', status: 'scheduled', spread: -3 });
}

// ── 41. UN-122 — bug/feature classification: exclusive toggle, submit gating ─
// The feedback form's markup only exists once inserted into a real browser
// DOM; this harness's document.getElementById always returns null (see the
// stubs at the top of this file), so submitFeedback()/bindFeedbackKindToggle()
// can't be driven end-to-end here — the same constraint suite [30] hit for
// click-handler ordering. Assert on the real source instead: markup shape,
// the exclusivity mechanism, and the ORDER of the gating check relative to
// the data write.
console.log('\n[41] UN-122 — bug/feature classification: exclusive toggle, submit gating…');
{
  // 41a — markup: exactly two mutually exclusive .pick-btn toggles, placed
  // between the Description textarea and the button row, reusing the
  // existing .pick-buttons/.pick-btn pattern (Drew's ruling: TWO EXCLUSIVE
  // TOGGLES, not checkboxes, not a dropdown — zero new CSS).
  const cardBlock41 = (appJsSrc.match(/<div class="card feedback-card">[\s\S]*?<div class="app-version-footer"/) || [''])[0];
  assert(cardBlock41.length > 0, 'feedback-card block located for structural assertions');
  const bodyIdx41 = cardBlock41.indexOf('id="fb-body"');
  const groupIdx41 = cardBlock41.indexOf('id="fb-kind-group"');
  const submitIdx41 = cardBlock41.indexOf('id="fb-submit-btn"');
  assert(bodyIdx41 > -1 && groupIdx41 > -1 && submitIdx41 > -1 && bodyIdx41 < groupIdx41 && groupIdx41 < submitIdx41,
    'the kind toggle sits between the Description textarea and the submit button row');
  assert(/class="pick-buttons" id="fb-kind-group"/.test(cardBlock41),
    'the toggle container reuses .pick-buttons (the existing 2-up grid) — zero new CSS for the control itself');
  const kindButtons41 = [...cardBlock41.matchAll(/<button type="button" class="pick-btn" data-fb-kind="(bug|feature)">/g)].map(m => m[1]);
  assert(kindButtons41.length === 2 && kindButtons41.includes('bug') && kindButtons41.includes('feature'),
    `exactly two .pick-btn toggles, data-fb-kind="bug" and "feature" (got ${JSON.stringify(kindButtons41)})`);

  // 41b — exclusivity: bindFeedbackKindToggle() clears .selected off every
  // sibling before applying it to the clicked one — radio behavior, never
  // both, never independent checkboxes. Same one-line mechanism as
  // bindPickButtons()/the login player-tile grid elsewhere in this file.
  const toggleFnSrc41 = (appJsSrc.match(/function bindFeedbackKindToggle\(\) \{[\s\S]*?\n\}/) || [''])[0];
  assert(toggleFnSrc41.length > 0, 'bindFeedbackKindToggle() located');
  assert(/classList\.toggle\('selected',\s*b === btn\)/.test(toggleFnSrc41),
    'clicking one toggle clears .selected off both and applies it only to the clicked one');

  // 41c — submission is BLOCKED until a kind is chosen (Drew's ruling): the
  // missing-kind guard must run BEFORE appendFeedback(entry), so an
  // unclassified entry is never written — only toasted.
  const submitFnSrc41 = (appJsSrc.match(/function submitFeedback\(\) \{[\s\S]*?\n\}/) || [''])[0];
  assert(submitFnSrc41.length > 0, 'submitFeedback() located');
  const kindCheckIdx41 = submitFnSrc41.indexOf('if (!kind) { showToast(');
  const appendIdx41 = submitFnSrc41.indexOf('appendFeedback(entry)');
  assert(kindCheckIdx41 > -1 && appendIdx41 > -1 && kindCheckIdx41 < appendIdx41,
    'the missing-kind guard runs BEFORE appendFeedback() — an unclassified submission is never written');
  assert(/document\.querySelector\('#fb-kind-group \.pick-btn\.selected'\)/.test(submitFnSrc41),
    'the chosen kind is read from the DOM at submit time');
  assert(!/kind:\s*kind\s*\|\|\s*'unspecified'/.test(submitFnSrc41),
    "submission never silently writes kind:'unspecified' — that label is reserved for reading LEGACY rows, not writing new ones");

  // 41d — the written entry carries both new fields (UN-122 kind, DI-123a
  // weekId), gated by the same kind check proven above.
  assert(/weekId:\s*getCurrentWeek\(\)\?\.weekId\s*\?\?\s*null/.test(submitFnSrc41),
    'DI-123a — entry.weekId is getCurrentWeek()?.weekId ?? null, exactly as approved');
  assert(/^\s*kind,/m.test(submitFnSrc41), 'the written entry carries the chosen kind');
}

// ── 42. UN-122/123 — renderFeedbackAdmin(): legacy rows default, never throw ─
console.log('\n[42] UN-122/123 — renderFeedbackAdmin(): legacy rows default, never throw…');
{
  const app42 = mods['app'];

  // 42a — a LEGACY entry: no kind, no weekId, no appVersion — exactly the
  // shape of every row already sitting in cfbp_feedback today (the pipeline
  // was write-only until this batch — CONVENTIONS #10 default-when-missing).
  const legacy42 = { id: 'fb_legacy', name: 'Kevin', body: 'the dashboard was blank on my phone', submittedAt: '2026-07-01T12:00:00.000Z' };
  let html42, threw42 = false;
  try { html42 = app42.renderFeedbackAdmin([legacy42]); } catch (e) { threw42 = true; console.error(e); }
  assert(!threw42, 'renderFeedbackAdmin() does not throw on a legacy row missing kind/weekId/appVersion');
  assert(/Unspecified/.test(html42), 'a legacy row with no kind renders the Unspecified badge, not a guess');
  assert(/—/.test(html42), 'a legacy row with no weekId renders — (em dash), not a blank or a thrown error');
  assert(/Kevin/.test(html42) && /the dashboard was blank on my phone/.test(html42),
    "the legacy row's real name and body still render");

  // 42b — a modern entry with both fields set renders the matching badge and
  // an actual resolvable week label instead of the dash.
  storage.saveWeek({ weekId: 'fb42_wk', weekNumber: 4, season: 2026, status: 'open', dataSourceMode: 'demo', startDate: '2026-09-19', endDate: '2026-09-20' });
  const modern42 = { id: 'fb_modern', name: 'Brayden', kind: 'bug', weekId: 'fb42_wk', body: 'picks page froze', submittedAt: '2026-09-19T09:00:00.000Z', appVersion: 'v0.17.6' };
  const html42b = app42.renderFeedbackAdmin([modern42]);
  assert(/🐛 Bug/.test(html42b), 'kind:"bug" renders the Bug badge');
  assert(/Week 4/.test(html42b), "a resolvable weekId renders the week's real label, not the raw id or a dash");
  assert(!/—/.test(html42b), 'a row WITH a resolvable weekId does not fall back to the dash');

  // 42c — a "feature" kind renders the Idea badge; an empty list renders the
  // documented empty state, never an empty shell.
  const html42c = app42.renderFeedbackAdmin([{ id: 'fb_f', name: 'Koby', kind: 'feature', weekId: null, body: 'add dark mode', submittedAt: '2026-09-19T09:05:00.000Z' }]);
  assert(/💡 Idea/.test(html42c), 'kind:"feature" renders the Idea badge');
  assert(app42.renderFeedbackAdmin([]) === '<p class="text-muted text-sm">No feedback submitted yet.</p>',
    'an empty feedback list renders the documented empty state exactly');
}

// ── 43. UN-123 — commissioner Data-tab feedback card: wrapper + wiring ───────
console.log('\n[43] UN-123 — commissioner Data-tab feedback card: wrapper, wiring, CSV button…');
{
  const app43 = mods['app'];
  storage.clearFeedback();

  // 43a — RG-10: an untagged admin-section renders on ALL FIVE commissioner
  // tabs. Verified against the string the function ACTUALLY RETURNS when
  // called — not a mention of the attribute elsewhere in source.
  const sectionEmpty43 = app43.renderFeedbackAdminSectionHTML();
  assert(/^\s*<div class="admin-section" data-comm-tab="data">/.test(sectionEmpty43),
    'renderFeedbackAdminSectionHTML() actually returns markup wrapped in <div class="admin-section" data-comm-tab="data">');
  assert(/No feedback submitted yet\./.test(sectionEmpty43), 'empty store renders the documented empty state inside the wrapper');
  assert(/id="export-feedback-csv-btn"/.test(sectionEmpty43), 'the CSV export button is present in the rendered card');

  // 43b — with entries in storage, the rendered card reflects them.
  // renderFeedbackAdminSectionHTML() calls renderFeedbackAdmin() with NO
  // argument — the production shape, reading live storage (distinct from
  // suite [42]'s explicit-array calls).
  storage.appendFeedback({ id: 'fb43', name: 'Jacob', kind: 'bug', weekId: null, body: 'chat scroll jumps', submittedAt: '2026-08-01T00:00:00.000Z', appVersion: 'v0.17.5' });
  const sectionFull43 = app43.renderFeedbackAdminSectionHTML();
  assert(/Jacob/.test(sectionFull43) && /chat scroll jumps/.test(sectionFull43),
    'renderFeedbackAdminSectionHTML() with no argument reads live storage — the shape renderCommPanel actually calls');
  storage.clearFeedback();

  // 43c — wired into renderCommPanel directly after the Export Data section,
  // same tab, per the design input's explicit placement. Position-in-source
  // check (same technique suite [30] uses for click-handler ordering) since
  // the full comm panel can't render against this harness's DOM stub
  // (document.getElementById returns null).
  const exportDataIdx43 = appJsSrc.indexOf('<div class="admin-section-title">📤 Export Data</div>');
  const feedbackPushIdx43 = appJsSrc.indexOf('sections.push(renderFeedbackAdminSectionHTML());');
  const tiebreakerIdx43 = appJsSrc.indexOf('// Tiebreaker');
  assert(exportDataIdx43 > -1 && feedbackPushIdx43 > -1 && tiebreakerIdx43 > -1 &&
    exportDataIdx43 < feedbackPushIdx43 && feedbackPushIdx43 < tiebreakerIdx43,
    'the feedback section is pushed directly after Export Data, before the next section, as specified');

  // 43d — NOT part of exportFullCsvBundle() — Drew was offered that and did
  // not select it.
  const bundleFnSrc43 = (appJsSrc.match(/function exportFullCsvBundle\(\) \{[\s\S]*?\n\}/) || [''])[0];
  assert(bundleFnSrc43.length > 0, 'exportFullCsvBundle() located');
  assert(!/exportFeedbackCSV/.test(bundleFnSrc43),
    'feedback is NOT part of exportFullCsvBundle() — Drew was offered that and did not select it');

  // 43e — the export button is actually wired to its click handler.
  assert(appJsSrc.includes("getElementById('export-feedback-csv-btn')?.addEventListener('click', exportFeedbackCSV);"),
    'export-feedback-csv-btn is wired to exportFeedbackCSV inside bindCommEventListeners()');
}

// ── 44. UN-123 — buildFeedbackCsvRows(): columns, no truncation, defaults ────
console.log('\n[44] UN-123 — buildFeedbackCsvRows(): full column shape, no truncation, legacy defaults…');
{
  const { buildFeedbackCsvRows } = mods['app'];

  // 44a — column header, exact order per the design input.
  const header44 = buildFeedbackCsvRows([])[0];
  assert(JSON.stringify(header44) === JSON.stringify(['Feedback ID', 'Date', 'Name', 'Type', 'Week', 'Week ID', 'App Version', 'Description']),
    `header row matches the eight approved columns exactly, in order (got ${JSON.stringify(header44)})`);

  // 44b — a description containing BOTH a comma and a quote survives in the
  // row UNCHANGED — CSV-cell escaping is toCsv()/csvCell()'s job downstream
  // (the same established pattern every other export in this file uses);
  // this builder must not pre-mangle the text.
  const tricky44 = 'Broken, on iPhone: tapping "Submit" does nothing.';
  const rows44 = buildFeedbackCsvRows([{ id: 'fb1', submittedAt: '2026-08-01T00:00:00.000Z', name: 'Drew', kind: 'bug', weekId: 'w1', appVersion: 'v0.17.5', body: tricky44 }]);
  assert(rows44[1][7] === tricky44, 'the comma-and-quote description survives byte-for-byte in the Description column');

  // 44b-ii — Drew, 2026-08-12: "The week column should include both the
  // formatted label and the raw weekID that way there is no discrepancy."
  // The first shipped version emitted only the raw id here while the on-screen
  // list showed a label, so the two surfaces disagreed about the same record.
  const weeks44 = { w1: { weekId: 'w1', weekNumber: 1, season: 2026, startDate: '2026-09-05', endDate: '2026-09-06' } };
  const labelled44 = buildFeedbackCsvRows(
    [{ id: 'fb1', name: 'Drew', kind: 'bug', weekId: 'w1', body: 'x' }], weeks44)[1];
  assert(labelled44[4] === mods['data-model'].formatWeekLabel(weeks44.w1),
    `the Week column carries the SAME formatted label the on-screen list shows — no discrepancy between surfaces (got "${labelled44[4]}")`);
  assert(labelled44[5] === 'w1',
    `the Week ID column carries the raw id, so it stays a clean join/filter key (got "${labelled44[5]}")`);
  assert(labelled44[4] !== labelled44[5],
    'the two week columns are genuinely different values, not the id duplicated into both');

  // An unknown or unresolvable week must still emit the raw id — a row is
  // never left silently unattributable.
  const orphan44 = buildFeedbackCsvRows([{ id: 'fb9', weekId: 'gone', body: 'x' }], weeks44)[1];
  assert(orphan44[4] === '—' && orphan44[5] === 'gone',
    `an unresolvable weekId still emits the raw id with an em-dash label (got ${JSON.stringify([orphan44[4], orphan44[5]])})`);

  // 44c — Drew's stated purpose is feeding this into a coding agent months
  // later: the CSV must NEVER truncate, even past the on-screen list's
  // 240-char cutoff (renderFeedbackAdmin, suite [42]).
  const long44 = 'x'.repeat(500);
  const rowsLong44 = buildFeedbackCsvRows([{ id: 'fb2', submittedAt: '', name: '', kind: 'feature', weekId: null, appVersion: '', body: long44 }]);
  assert(rowsLong44[1][7].length === 500, `a 500-char description is not truncated in the CSV (got length ${rowsLong44[1][7].length})`);
  assert(rowsLong44[1][7] === long44, 'and is byte-for-byte identical, not just the right length');

  // 44d — Type column maps kind → the plain-text label, and a LEGACY entry
  // (no id/kind/weekId/appVersion/name — everything but body/submittedAt)
  // never throws and defaults every column instead — CONVENTIONS #10.
  let rowsLegacy44, threw44 = false;
  try { rowsLegacy44 = buildFeedbackCsvRows([{ body: 'old row from before this shipped', submittedAt: '2026-06-01T00:00:00.000Z' }]); }
  catch (e) { threw44 = true; console.error(e); }
  assert(!threw44, 'buildFeedbackCsvRows() does not throw on a legacy row missing id/kind/weekId/appVersion/name');
  assert(JSON.stringify(rowsLegacy44[1]) === JSON.stringify(['', '2026-06-01T00:00:00.000Z', '', 'Unspecified', '—', '', '', 'old row from before this shipped']),
    `legacy row defaults every missing column instead of throwing (got ${JSON.stringify(rowsLegacy44[1])})`);

  // 44e — kind mapping is exhaustive and distinct.
  const typesCol44 = buildFeedbackCsvRows([
    { id: 'a', kind: 'bug', body: '' }, { id: 'b', kind: 'feature', body: '' }, { id: 'c', kind: undefined, body: '' },
  ]).slice(1).map(r => r[3]);
  assert(JSON.stringify(typesCol44) === JSON.stringify(['Bug', 'Feature', 'Unspecified']),
    `Type column maps kind exhaustively and distinctly (got ${JSON.stringify(typesCol44)})`);
}

// ── 45. UN-124 — "What's new": collapsed by default, nothing when empty ──────
console.log('\n[45] UN-124 — "What\'s new": collapsed by default, renders nothing when empty, last card everywhere…');
{
  const app45 = mods['app'];

  // 45a — THE REQUIRED GUARD: both lists empty → render nothing, never an
  // empty shell (a bare <details> with no content is exactly the "always
  // there, always disappointing" outcome the design input rules out).
  assert(app45.renderWhatsNewCardHTML({ version: 'v9.9.9', added: [], fixed: [] }) === '',
    'both lists empty renders the empty string — no card, no shell');
  assert(app45.renderWhatsNewCardHTML({ version: 'v9.9.9', added: [], fixed: undefined }) === '',
    'missing fixed[] (not just empty) still renders nothing — defensive against a malformed release entry');

  // 45b — populated: collapsed by default (bare <details>, no `open`
  // attribute — same precedent as the 2025 season record), both groups
  // render when both are populated, and the summary names the release.
  const html45 = app45.renderWhatsNewCardHTML({ version: 'v0.17.6', added: ['Thing one'], fixed: ['Bug one'] });
  assert(/<details>/.test(html45) && !/<details open>/.test(html45), 'collapsed by default — no `open` attribute (2025-record precedent)');
  assert(/<summary/.test(html45) && /What's new in v0\.17\.6/.test(html45), 'the summary names the release');
  assert(/Thing one/.test(html45) && /Bug one/.test(html45), 'both New and Fixed items render when both lists are populated');

  // 45c — escaping: defense in depth even though this content is hand-authored.
  const htmlXss45 = app45.renderWhatsNewCardHTML({ version: 'v1', added: ['<script>x</script>'], fixed: [] });
  assert(!/<script>x<\/script>/.test(htmlXss45) && /&lt;script&gt;/.test(htmlXss45),
    'list items are escaped, not injected raw');

  // 45d — only ONE group renders when only one list is populated (no empty
  // "Fixed" heading with nothing under it).
  const onlyAdded45 = app45.renderWhatsNewCardHTML({ version: 'v1', added: ['Thing'], fixed: [] });
  assert(/Thing/.test(onlyAdded45) && !/>Fixed</.test(onlyAdded45), 'an empty Fixed[] renders no Fixed heading at all');

  // 45e — the real, hand-maintained release content actually populates for
  // the current version and doesn't collapse to nothing by accident.
  assert(app45.APP_VERSION && app45.renderWhatsNewCardHTML().length > 0,
    'the default WHATS_NEW (no argument) renders non-empty for the current release');

  // 45f — LAST CARD IN EVERY STATE. The DOM stub can't drive renderPicksPage()
  // end-to-end (document.getElementById returns null), so — same technique
  // as suite [30] — assert on the real function body: renderWhatsNewCardHTML()
  // is appended unconditionally as the FINAL statement of BOTH branches: the
  // historical-week branch (which otherwise returns early) and the
  // current-week branch (after the footer's conditional, which is NOT
  // unconditional — that asymmetry is exactly the bug DI-124 guards against).
  const picksPageSrc45 = (appJsSrc.match(/function renderPicksPage\(\) \{[\s\S]*?\n\}/) || [''])[0];
  assert(picksPageSrc45.length > 0, 'renderPicksPage() located');
  const histCallIdx45 = picksPageSrc45.indexOf('renderHistoricalPicksView(c, viewWeek, currentWeek);');
  const histWhatsNewIdx45 = picksPageSrc45.indexOf("c.insertAdjacentHTML('beforeend', renderWhatsNewCardHTML());");
  const histReturnIdx45 = picksPageSrc45.indexOf('return;', histCallIdx45);
  assert(histCallIdx45 > -1 && histWhatsNewIdx45 > -1 && histReturnIdx45 > -1 &&
    histCallIdx45 < histWhatsNewIdx45 && histWhatsNewIdx45 < histReturnIdx45,
    "the historical-week branch appends the What's New card BEFORE its early return — it would otherwise never reach it");

  const footerIfIdx45 = picksPageSrc45.indexOf('if (!playerActivelyInPicks)');
  const footerCallIdx45 = picksPageSrc45.indexOf('renderPicksFooterHTML(currentWeek));');
  const secondWhatsNewIdx45 = picksPageSrc45.lastIndexOf("c.insertAdjacentHTML('beforeend', renderWhatsNewCardHTML());");
  assert(footerIfIdx45 > -1 && footerCallIdx45 > -1 && secondWhatsNewIdx45 > histWhatsNewIdx45,
    "a SECOND, distinct What's New call exists for the current-week branch (not reusing the historical one)");
  // The critical property: the second call is OUTSIDE the
  // `if (!playerActivelyInPicks) { ... }` block — it must run whether or not
  // that block ran, so a player who stays logged in (and never sees the
  // footer) still reaches it. Captures the FULL block body (up to its own
  // closing brace), not a fixed-width window past the footer call — a
  // narrower window would miss a call re-inserted anywhere else inside the
  // same block.
  const ifBlockEndIdx45 = picksPageSrc45.indexOf('\n  }', footerIfIdx45);
  assert(ifBlockEndIdx45 > -1 && ifBlockEndIdx45 > footerCallIdx45, "the conditional's closing brace located");
  const ifBlockSrc45 = picksPageSrc45.slice(footerIfIdx45, ifBlockEndIdx45);
  assert(!/renderWhatsNewCardHTML/.test(ifBlockSrc45),
    "the What's New call is OUTSIDE the playerActivelyInPicks conditional — unconditional, unlike the recap footer");
  assert(secondWhatsNewIdx45 > footerCallIdx45,
    "the current-week What's New call comes AFTER the conditional footer block — genuinely last");
}

// ── 46. RG-10 — every commissioner card must declare its tab ────────────────
// RG-10: an `.admin-section` WITHOUT a `data-comm-tab` attribute renders on all
// five commissioner tabs at once. Individual features have each been asserting
// their own card in isolation, which protects the card that happens to have a
// test and nothing else. This is the general form: it catches the NEXT card
// somebody adds without the attribute, which is how RG-10 happened the first
// time. Structural by necessity — the comm panel is assembled from template
// strings and the harness has no layout engine.
console.log('\n[46] RG-10 — no untagged commissioner card can render on all five tabs…');
{
  // The guard is a LINT, so it is only worth what it catches. Expressed as a
  // named detector and driven by fixtures below, because a bare regex asserted
  // only against a currently-clean source proves nothing: it passes just as
  // happily when it has stopped matching anything at all.
  const untaggedAdminSections = src => {
    const out = [];
    const open = /<(div|section)\b[^>]*>/gi;
    let m;
    while ((m = open.exec(src))) {
      const tag = m[0];
      const cls = /class\s*=\s*"([^"]*)"/i.exec(tag) || /class\s*=\s*'([^']*)'/i.exec(tag);
      if (!cls) continue;
      // Exact class TOKEN, not a substring: `admin-section-title`,
      // `admin-section-collapsed` and `admin-section-title-toggle` all exist in
      // this file and are not cards. A \badmin-section\b regex matches every
      // one of them (the hyphen is a word boundary) and would fire constantly.
      if (!cls[1].split(/\s+/).includes('admin-section')) continue;
      if (!/\bdata-comm-tab\s*=/i.test(tag)) out.push(tag);
    }
    return out;
  };

  // MUST BE CAUGHT. Every one of these renders on all five tabs. The first is
  // the only form the original guard recognised; the rest slipped straight
  // past it while the suite stayed green.
  const MUST_CATCH_46 = [
    ['the exact original form',            '<div class="admin-section">'],
    ['a second class alongside it',        '<div class="admin-section mb-md">'],
    ['the card class listed second',       '<div class="mb-md admin-section">'],
    ['single-quoted attributes',           "<div class='admin-section'>"],
    ['a <section> instead of a <div>',     '<section class="admin-section">'],
    ['single-quoted <section>, 2 classes', "<section class='admin-section mb-md'>"],
    ['whitespace around the attribute',    '<div  class = "admin-section" >'],
    ['other attributes but no tab',        '<div id="x" class="admin-section" role="group">'],
  ];
  for (const [label, frag] of MUST_CATCH_46) {
    assert(untaggedAdminSections(frag).length === 1,
      `RG-10 guard catches an untagged card written as: ${label} — ${frag}`);
  }

  // MUST NOT BE CAUGHT — otherwise the guard is noise and gets disabled.
  const MUST_PASS_46 = [
    ['tagged, double quotes',   '<div class="admin-section" data-comm-tab="week">'],
    ['tagged, class second',    '<div class="mb-md admin-section" data-comm-tab="data">'],
    ['tagged, single quotes',   "<section class='admin-section mb-md' data-comm-tab='players'>"],
    ['tagged, attribute first', '<div data-comm-tab="settings" class="admin-section">'],
    ['a title, not a card',     '<div class="admin-section-title">'],
    ['a collapsed-state class', '<div class="admin-section-collapsed">'],
    ['an unrelated card',       '<div class="card mb-md">'],
  ];
  for (const [label, frag] of MUST_PASS_46) {
    assert(untaggedAdminSections(frag).length === 0,
      `RG-10 guard does NOT false-positive on: ${label} — ${frag}`);
  }

  // …and now the real file.
  const untagged = untaggedAdminSections(appJsSrc);
  const tagged = (appJsSrc.match(/class="admin-section"[^>]*data-comm-tab=/g) || []).length;
  assert(tagged > 0, `fixture check: the comm panel still assembles tagged .admin-section cards (found ${tagged}) — guards the vacuous-pass failure mode`);
  assert(untagged.length === 0,
    `RG-10: every .admin-section declares a data-comm-tab — found ${untagged.length} untagged${untagged.length ? ': ' + JSON.stringify(untagged) : ''}, each of which would render on ALL FIVE tabs [structural]`);
}

// ── 47. DI-125 — the per-game bottom sheet gets the SAME reveal gestures and
//       action-button wiring as the main feed ───────────────────────────────
// UN-120/UN-121 (§[37]) covered ONLY the main chat feed. renderSheetMessages()
// shares messageHTML() with it (so it always rendered .chat-actions/
// .chat-reaction-names markup) but never wired ANY reveal gesture and only
// ever wired [data-react]/[data-retry] of the six action buttons — the other
// five rendered dead on every platform since the sheet shipped. This suite
// exercises the REAL production functions end to end (real chat.js storage,
// real messageHTML() markup, real handler side effects) — never a
// re-implementation, never a name-match against source.
console.log('\n[47] DI-125 — per-game sheet: reveal gestures + previously-dead action buttons…');

/** Extracts every data-* attribute off an opening tag into a camelCased
 *  dataset object — shared by every fake sheet-host below. */
function parseDataset47(tag) {
  const ds = {};
  const re = /data-([\w-]+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(tag))) ds[m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = m[2];
  return ds;
}
/**
 * A fake `#chat-sheet-scroll`: settable/readable innerHTML (captures what
 * renderSheetMessages() actually renders), a real-ish addEventListener that
 * ACCUMULATES listeners per type (so a double-bind is behaviorally
 * detectable, not silently coalesced), and a querySelectorAll that finds
 * matching buttons by scanning the captured markup for their data-*
 * attribute — never a synthetic button the test invents itself.
 */
function makeFakeSheetHost47() {
  let html = '';
  const listeners = {};
  // CACHED by (selector-attr + full dataset), invalidated whenever innerHTML
  // is (re)assigned — production code queries buttons ONCE, inside
  // renderSheetMessages(), to attach listeners; this test then queries the
  // SAME markup separately to fire a click. Without caching, each
  // querySelectorAll() call would mint brand-new, disconnected fake elements
  // and the test would be clicking an object nothing was ever wired to —
  // the cache is what makes "the same button production wired" and "the
  // button this test clicks" the same object, exactly as a real DOM element
  // queried twice is the same node until the markup is replaced.
  let elCache = new Map();
  return {
    id: 'chat-sheet-scroll',
    set innerHTML(v) { html = v; elCache = new Map(); },
    get innerHTML() { return html; },
    scrollTop: 0, get scrollHeight() { return 100; },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    _fire(type, e) { (listeners[type] || []).forEach(fn => fn(e)); },
    _listenerCount(type) { return (listeners[type] || []).length; },
    querySelectorAll(sel) {
      const attr = sel.replace(/^\[|\]$/g, '').split('=')[0];
      const tagRe = new RegExp(`<[a-zA-Z]+ [^>]*\\b${attr}="[^"]*"[^>]*>`, 'g');
      const out = [];
      let m;
      while ((m = tagRe.exec(html))) {
        const ds = parseDataset47(m[0]);
        const key = attr + ':' + JSON.stringify(ds);
        if (!elCache.has(key)) {
          elCache.set(key, {
            dataset: ds, closest: () => null,
            appendChild(node) { this._appendedPicker = node; },
            _handlers: {}, addEventListener(t, fn) { this._handlers[t] = fn; },
            _click() { this._handlers.click?.({ stopPropagation() {} }); },
          });
        }
        out.push(elCache.get(key));
      }
      return out;
    },
  };
}
const fakePickerCreator47 = () => ({
  dataset: {}, classList: { add() {}, remove() {} }, style: {},
  appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {},
  querySelectorAll() { return []; },
  set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html || ''; },
});

console.log('\n[47a] DI-125a — reveal state is scoped by CONTAINER, not just message id…');
{
  // Simulates the confirmed real scenario: #page-chat is never torn down on
  // navigation (only hidden via the .active class — navigateTo(), app.js),
  // so a message tagged to a game can be rendered in BOTH #chat-scroll
  // (stale, hidden) and #chat-sheet-scroll (the open sheet for that same
  // game) AT ONCE, with the SAME data-mid. Revealing in one must not
  // silently touch the wrong copy, and must dismiss the other.
  const targets47a = {};   // keyed "rootId|mid"
  const realQS47a = document.querySelector;
  document.querySelector = sel => {
    const m = /^#([\w-]+) \.chat-msg\[data-mid="([^"]+)"\]$/.exec(sel || '');
    return m ? (targets47a[`${m[1]}|${m[2]}`] || null) : null;
  };
  function fakeMsg47a(rootId, mid) {
    const classes = new Set();
    const el = { dataset: { mid }, classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) }, _classes: classes };
    targets47a[`${rootId}|${mid}`] = el;
    return el;
  }
  const mainCopy = fakeMsg47a('chat-scroll', 'shared_mid');
  const sheetCopy = fakeMsg47a('chat-sheet-scroll', 'shared_mid');

  chatUi._revealMessageActions('shared_mid', 'chat-scroll');
  assert(mainCopy._classes.has('chat-actions-revealed') && !sheetCopy._classes.has('chat-actions-revealed'),
    'revealing in the main feed touches ONLY the main feed\'s copy');
  assert(chatUi._revealedRootIdForTest() === 'chat-scroll', 'fixture check: reveal state records the main feed\'s container id');

  chatUi._revealMessageActions('shared_mid', 'chat-sheet-scroll');
  assert(!mainCopy._classes.has('chat-actions-revealed') && sheetCopy._classes.has('chat-actions-revealed'),
    'DI-125a: revealing the SAME message id in the SHEET dismisses the main feed\'s copy and reveals the sheet\'s own — scoping by mid alone would have left the wrong copy revealed (or left BOTH revealed)');
  assert(chatUi._revealedRootIdForTest() === 'chat-sheet-scroll', 'reveal state now records the SHEET as the active container');

  chatUi._dismissRevealedActions();
  assert(!sheetCopy._classes.has('chat-actions-revealed') && chatUi._revealedRootIdForTest() === null,
    'dismissing clears both the class and the container-scoped state');
  document.querySelector = realQS47a;
}

console.log('\n[47b] DI-125a — long-press, right-click, and the swipe react-path all derive the SHEET\'s scope from the container itself, with no extra argument at any call site…');
{
  const targets47b = {};
  const buttons47b = {};
  const realQS47b = document.querySelector;
  document.querySelector = sel => {
    const btnM = /^#([\w-]+) \.chat-msg\[data-mid="([^"]+)"\] \[data-react-open\]$/.exec(sel || '');
    if (btnM) return buttons47b[`${btnM[1]}|${btnM[2]}`] || null;
    const m = /^#([\w-]+) \.chat-msg\[data-mid="([^"]+)"\]$/.exec(sel || '');
    return m ? (targets47b[`${m[1]}|${m[2]}`] || null) : null;
  };
  function fakeMsg47b(rootId, mid) {
    const classes = new Set();
    const el = { dataset: { mid }, classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) }, _classes: classes };
    targets47b[`${rootId}|${mid}`] = el;
    return el;
  }
  function makeFakeRoot47b(id) {
    const handlers = {};
    return { id, addEventListener(type, fn) { handlers[type] = fn; }, _fire: (type, e) => handlers[type]?.(e) };
  }
  const targetFor47b = el => ({ closest: sel => (sel === '.chat-msg' ? el : null) });

  // Long-press — SAME single-argument call shape as the main feed's, only
  // the root's OWN id differs.
  const lpRoot = makeFakeRoot47b('chat-sheet-scroll');
  const lpMsg = fakeMsg47b('chat-sheet-scroll', 'lp_sheet_msg');
  chatUi._bindMessageActionsLongPress(lpRoot);
  lpRoot._fire('touchstart', { touches: [{ clientX: 10, clientY: 10 }], target: targetFor47b(lpMsg) });
  await new Promise(r => setTimeout(r, 400));
  assert(lpMsg._classes.has('chat-actions-revealed') && chatUi._revealedRootIdForTest() === 'chat-sheet-scroll',
    'a long-press bound to #chat-sheet-scroll reveals WITHIN that container, not the main feed\'s');

  // Right-click.
  const ctxRoot = makeFakeRoot47b('chat-sheet-scroll');
  const ctxMsg = fakeMsg47b('chat-sheet-scroll', 'ctx_sheet_msg');
  chatUi._bindMessageActionsContextMenu(ctxRoot);
  ctxRoot._fire('contextmenu', { target: targetFor47b(ctxMsg), preventDefault: () => {} });
  assert(ctxMsg._classes.has('chat-actions-revealed') && chatUi._revealedRootIdForTest() === 'chat-sheet-scroll',
    'right-click bound to #chat-sheet-scroll reveals WITHIN that container');

  // Swipe (right-to-left react path) — proves openReactPickerFor() resolves
  // the CORRECT surface/render function from the root itself.
  storage.clearSession();
  storage.addPlayer(dm.createPlayer('Sheet47Swiper', '', '4711', '', 'SS'));
  const swipePlayers47 = storage.getPlayers();
  const swipePlayer47 = swipePlayers47[swipePlayers47.length - 1];
  storage.setSession(swipePlayer47.playerId, false, true);
  const reactBtn47b = { closest: () => null, appendChild: () => {} };
  buttons47b['chat-sheet-scroll|swipe_sheet_msg'] = reactBtn47b;
  fakeMsg47b('chat-sheet-scroll', 'swipe_sheet_msg');
  const realGEBI47b = document.getElementById;
  const realCreateEl47b = document.createElement;
  document.getElementById = id => (id === 'chat-react-picker' ? null : null);
  document.createElement = fakePickerCreator47;
  const swipeRoot = makeFakeRoot47b('chat-sheet-scroll');
  chatUi._bindMessageSwipe(swipeRoot);
  swipeRoot._fire('touchstart', { touches: [{ clientX: 200, clientY: 100 }], target: targetFor47b({ dataset: { mid: 'swipe_sheet_msg' } }) });
  swipeRoot._fire('touchmove', { touches: [{ clientX: 200 - 45, clientY: 101 }] });   // right-to-left
  assert(chatUi._revealedRootIdForTest() === 'chat-sheet-scroll',
    'a right-to-left swipe bound to #chat-sheet-scroll reveals WITHIN that container (openReactPickerFor derived "sheet" from root.id, not a hardcoded default)');

  document.getElementById = realGEBI47b;
  document.createElement = realCreateEl47b;
  document.querySelector = realQS47b;
  chatUi._dismissRevealedActions();
  storage.clearSession();
}

console.log('\n[47c] DI-125b — renderSheetMessages() (the REAL function) now wires the six previously-dead action buttons…');
{
  chat._resetForTest();                              // clean slate — earlier sections left messages in S.items
  storage.clearSession();

  // A FINAL game my tester picked wrong ATS, with a pre-kickoff message — the
  // shape calloutEligible() requires, so [data-callout] renders too (not just
  // the three that need less setup). kickoff is deliberately placed shortly
  // AFTER `ts` (both near "now") rather than realistically in the past, so
  // the SAME fixture also satisfies canEdit's 5-minute window — two gates
  // that don't otherwise share a timeframe requirement.
  const now47 = Date.now();
  const W47 = { weekId: 'di125_wk', weekNumber: 4, season: 2026, status: 'final', dataSourceMode: 'demo', startDate: '2026-01-01', endDate: '2026-01-02' };
  storage.saveWeek(W47);
  storage.saveGame({
    weekId: W47.weekId, gameId: 'di125_g1', homeTeam: 'Sheet Home', awayTeam: 'Sheet Away',
    kickoff: new Date(now47 + 3600000).toISOString(), status: 'final', spread: -7, homeScore: 10, awayScore: 20,
  });
  storage.addPlayer(dm.createPlayer('Sheet47Actor', '', '4722', '', 'SA'));
  const actors47 = storage.getPlayers();
  const actor47 = actors47[actors47.length - 1];
  storage.setSession(actor47.playerId, false, true);
  storage.saveAllPicks([...storage.getPicks(),
    { pickId: 'di125_pk1', weekId: W47.weekId, gameId: 'di125_g1', playerId: actor47.playerId, selectedTeam: 'Sheet Home' },
  ]);
  chat.ingest([ev({
    id: 'di125_target_msg', seq: 1, ts: now47 - 60000, type: 'message',
    author: actor47.playerId, gameTag: 'di125_g1', body: 'Home covers easy',
  })]);

  const host47c = makeFakeSheetHost47();
  const realGEBI47c = document.getElementById;
  const realCreateEl47c = document.createElement;
  document.getElementById = id => (id === 'chat-sheet-scroll' ? host47c : (id === 'chat-react-picker' ? null : null));
  document.createElement = fakePickerCreator47;

  chatUi._renderSheetMessagesForTest('di125_g1');

  assert(/data-reply="di125_target_msg"/.test(host47c.innerHTML), 'fixture check: the rendered sheet markup carries [data-reply] for the seeded message');
  assert(/data-pin="di125_target_msg"/.test(host47c.innerHTML), 'fixture check: …and [data-pin]');
  assert(/data-callout="di125_target_msg"/.test(host47c.innerHTML), 'fixture check: calloutEligible() is true for this fixture, so [data-callout] renders');

  // [data-reply] — clicking it now sets U.sheetReplyTo (DI-125b), previously
  // rendered with NO click listener at all.
  const replyBtns47 = host47c.querySelectorAll('[data-reply]');
  assert(replyBtns47.length === 1, 'DI-125b: [data-reply] is wired — was dead in the sheet before this batch');
  replyBtns47[0]._click();
  assert(chatUi._sheetReplyTarget() === 'di125_target_msg', 'clicking the sheet\'s ↩ button opens a reply scoped to the SHEET\'s own reply state');

  // [data-react-open] — clicking it opens the SAME real reaction picker the
  // main feed's + button opens.
  const openBtns47 = host47c.querySelectorAll('[data-react-open]');
  assert(openBtns47.length === 1, 'DI-125b: [data-react-open] is wired');
  openBtns47[0]._click();
  assert(openBtns47[0]._appendedPicker?.className === 'reaction-picker',
    'clicking the sheet\'s ➕ button appends a REAL .reaction-picker node (real toggleMessageReactPicker(), not a stub)');

  // [data-pin] — clicking it actually pins the REAL message.
  const pinBtns47 = host47c.querySelectorAll('[data-pin]');
  assert(pinBtns47.length === 1, 'DI-125b: [data-pin] is wired');
  pinBtns47[0]._click();
  assert(chat.getMessage('di125_target_msg')?.pinned === true, 'clicking the sheet\'s 📌 button actually pins the message (real pinMessage(), real storage)');

  // [data-callout] — clicking it posts a REAL quote event, same shape the
  // main feed's 📎 button posts.
  const beforeCount47 = chat.getMessages({ tag: 'all' }).length;
  const calloutBtns47 = host47c.querySelectorAll('[data-callout]');
  assert(calloutBtns47.length === 1, 'DI-125b: [data-callout] is wired');
  calloutBtns47[0]._click();
  const afterCallout47 = chat.getMessages({ tag: 'all' });
  assert(afterCallout47.length === beforeCount47 + 1 && /Prior statement, for the record/.test(afterCallout47[afterCallout47.length - 1].body),
    'clicking the sheet\'s 📎 button posts the SAME real callout event the main feed\'s button uses');

  // [data-edit] — clicking it actually edits the REAL message. (The 📎
  // callout above posted a SECOND message, also authored by this session and
  // also inside its own edit window — genuinely also edit/del-eligible, so
  // this targets the SPECIFIC button for the message under test rather than
  // assuming it is the only match.)
  const realPrompt47 = globalThis.prompt;
  globalThis.prompt = () => 'Edited from the sheet';
  const editBtns47 = host47c.querySelectorAll('[data-edit]');
  const editBtnTarget47 = editBtns47.find(b => b.dataset.edit === 'di125_target_msg');
  assert(!!editBtnTarget47, 'DI-125b: [data-edit] is wired (message is mine and inside the 5-minute window)');
  editBtnTarget47._click();
  assert(chat.getMessage('di125_target_msg')?.body === 'Edited from the sheet', 'clicking the sheet\'s ✏️ button actually edits the message (real editMessage())');
  globalThis.prompt = realPrompt47;

  // [data-del] — LAST: deleting removes the whole .chat-actions block from
  // future renders (messageHTML() renders a tombstone instead), so every
  // other action button must be exercised before this one.
  const delBtns47 = host47c.querySelectorAll('[data-del]');
  const delBtnTarget47 = delBtns47.find(b => b.dataset.del === 'di125_target_msg');
  assert(!!delBtnTarget47, 'DI-125b: [data-del] is wired');
  delBtnTarget47._click();
  assert(chat.getMessage('di125_target_msg')?.deleted === true, 'clicking the sheet\'s 🗑 button actually withdraws the message (real deleteMessage())');

  document.getElementById = realGEBI47c;
  document.createElement = realCreateEl47c;
  storage.clearSession();
}

console.log('\n[47d] DI-125a/DI-121a — .chat-reaction-names is reachable in the sheet once revealed…');
{
  chat._resetForTest();
  storage.clearSession();
  storage.addPlayer(dm.createPlayer('Sheet47Reactor', '', '4733', '', 'SR'));
  const reactors47 = storage.getPlayers();
  const reactor47 = reactors47[reactors47.length - 1];
  storage.setSession(reactor47.playerId, false, true);
  chat.ingest([ev({ id: 'di125_names_msg', seq: 1, ts: Date.now(), type: 'message', author: reactor47.playerId, gameTag: 'di125_names_g', body: 'reacted-to message' })]);
  chat.toggleReact('di125_names_msg', '🔥', reactor47.playerId);

  const html47d = chatUi._messageHTMLForTest(chat.getMessage('di125_names_msg'), reactor47.playerId, false);
  assert(/class="chat-reaction-names"/.test(html47d),
    'fixture check: the SAME messageHTML() the sheet renders produces .chat-reaction-names for a reacted message (hidden by CSS default, §[37a] — not absent from markup)');

  // The CSS rule that reveals it is unconditional (§[37a]:
  // `.chat-msg.chat-actions-revealed .chat-reaction-names{display:block}` has
  // no container qualifier), so once the sheet's OWN reveal mechanism works
  // (proven in [47a]/[47b]), .chat-reaction-names necessarily becomes
  // reachable there too — asserted here end to end on a fresh sheet-scoped
  // reveal, not re-derived from the two separate facts.
  const targets47d = {};
  const realQS47d = document.querySelector;
  document.querySelector = sel => {
    const m = /^#([\w-]+) \.chat-msg\[data-mid="([^"]+)"\]$/.exec(sel || '');
    return m ? (targets47d[`${m[1]}|${m[2]}`] || null) : null;
  };
  const classes47d = new Set();
  targets47d['chat-sheet-scroll|di125_names_msg'] = { dataset: { mid: 'di125_names_msg' }, classList: { add: c => classes47d.add(c), remove: c => classes47d.delete(c), contains: c => classes47d.has(c) } };
  chatUi._revealMessageActions('di125_names_msg', 'chat-sheet-scroll');
  assert(classes47d.has('chat-actions-revealed'),
    'DI-125a: the sheet\'s reveal mechanism adds the SAME class .chat-reaction-names\'s visibility is gated on — no sheet-specific gate exists to miss');
  chatUi._dismissRevealedActions();
  document.querySelector = realQS47d;
  storage.clearSession();
}

console.log('\n[47e] DI-125b — U.sheetReplyTo and U.replyTo are ISOLATED: a reply started in one surface never appears in the other…');
{
  function makeFakeRoot47e(id) {
    const handlers = {};
    return { id, addEventListener(type, fn) { handlers[type] = fn; }, _fire: (type, e) => handlers[type]?.(e) };
  }
  const targetFor47e = el => ({ closest: sel => (sel === '.chat-msg' ? el : null) });
  const realGEBI47e = document.getElementById;
  document.getElementById = () => null;   // no real #chat-input/#chat-sheet-composer to touch — isolates the STATE write itself

  const mainReplyBefore47e = chatUi._replyTarget();
  const sheetRoot47e = makeFakeRoot47e('chat-sheet-scroll');
  chatUi._bindMessageSwipe(sheetRoot47e);
  sheetRoot47e._fire('touchstart', { touches: [{ clientX: 100, clientY: 100 }], target: targetFor47e({ dataset: { mid: 'isolation_sheet_reply' } }) });
  sheetRoot47e._fire('touchmove', { touches: [{ clientX: 145, clientY: 101 }] });   // left-to-right
  assert(chatUi._sheetReplyTarget() === 'isolation_sheet_reply', 'a left-to-right swipe in the SHEET sets U.sheetReplyTo');
  assert(chatUi._replyTarget() === mainReplyBefore47e,
    'DI-125b: …and leaves U.replyTo (the main feed\'s OWN reply state) completely untouched');

  const mainRoot47e = makeFakeRoot47e('chat-scroll');
  chatUi._bindMessageSwipe(mainRoot47e);
  mainRoot47e._fire('touchstart', { touches: [{ clientX: 100, clientY: 100 }], target: targetFor47e({ dataset: { mid: 'isolation_main_reply' } }) });
  mainRoot47e._fire('touchmove', { touches: [{ clientX: 145, clientY: 101 }] });
  assert(chatUi._replyTarget() === 'isolation_main_reply', 'a left-to-right swipe in the MAIN FEED sets U.replyTo');
  assert(chatUi._sheetReplyTarget() === 'isolation_sheet_reply',
    'DI-125b: …and leaves U.sheetReplyTo exactly as the sheet left it — no cross-contamination in either direction');

  document.getElementById = realGEBI47e;
}

console.log('\n[47f] DI-125c — [data-react] (tap-to-vote) in the sheet is UNCHANGED: a plain tap, independent of the reveal mechanism…');
{
  chat._resetForTest();
  storage.clearSession();
  storage.addPlayer(dm.createPlayer('Sheet47Other', '', '4745', '', 'SO'));
  storage.addPlayer(dm.createPlayer('Sheet47Voter', '', '4744', '', 'SV'));
  const players47f = storage.getPlayers();
  const other47f = players47f[players47f.length - 2];
  const voter47 = players47f[players47f.length - 1];
  storage.setSession(voter47.playerId, false, true);
  chat.ingest([ev({ id: 'di125_vote_msg', seq: 1, ts: Date.now(), type: 'message', author: voter47.playerId, gameTag: 'di125_vote_g', body: 'vote on me' })]);
  // Seeded by a DIFFERENT player, not the voter under test — a real toggle
  // back-and-forth by the SAME author, both writes purely local/unsynced (no
  // seq yet), hits chat.js's order-independence tie-break at applyTo()
  // (identical `stamp` for both local writes — a pre-existing fold property,
  // unrelated to this batch); seeding from someone else and having the
  // TESTED player react FRESH avoids that tie entirely and still exercises
  // the exact same real toggleReact() call the pill's handler makes.
  chat.toggleReact('di125_vote_msg', '👍', other47f.playerId);

  const host47f = makeFakeSheetHost47();
  const realGEBI47f = document.getElementById;
  document.getElementById = id => (id === 'chat-sheet-scroll' ? host47f : null);
  chatUi._renderSheetMessagesForTest('di125_vote_g');

  const pillBtns47f = host47f.querySelectorAll('[data-react]');
  assert(pillBtns47f.length === 1 && pillBtns47f[0].dataset.react === '👍' && pillBtns47f[0].dataset.target === 'di125_vote_msg',
    'fixture check: the reaction pill still carries its own data-react/data-target attributes, unchanged in the sheet');
  chatUi._dismissRevealedActions();   // start from a known "nothing revealed" baseline
  pillBtns47f[0]._click();
  assert((chat.getMessage('di125_vote_msg')?.reactions?.['👍'] || []).includes(voter47.playerId) === true,
    'DI-125c: tapping the pill in the sheet still calls the REAL toggleReact() directly (the voter\'s own react is now recorded) — a plain tap, no long-press/right-click/swipe involved');
  assert(chatUi._revealedRootIdForTest() === null,
    'DI-125c: …and it never touches the reveal mechanism — tapping the pill does not reveal .chat-actions/.chat-reaction-names as a side effect');

  document.getElementById = realGEBI47f;
  storage.clearSession();
}

console.log('\n[47g] DI-125a — scrolling the sheet dismisses a revealed message (bindSheetScrollDismiss, new — #chat-sheet-scroll persists across renders, unlike #chat-scroll)…');
{
  chat._resetForTest();
  storage.clearSession();
  chat.ingest([ev({ id: 'di125_scroll_msg', seq: 1, ts: Date.now(), type: 'message', author: 'p1', gameTag: 'di125_scroll_g', body: 'scroll me away' })]);

  const host47g = makeFakeSheetHost47();
  const realGEBI47g = document.getElementById;
  document.getElementById = id => (id === 'chat-sheet-scroll' ? host47g : null);
  chatUi._renderSheetMessagesForTest('di125_scroll_g');

  chatUi._revealMessageActions('di125_scroll_msg', 'chat-sheet-scroll');
  assert(chatUi._revealedRootIdForTest() === 'chat-sheet-scroll', 'fixture check: a message is revealed in the sheet before scrolling');
  host47g._fire('scroll', {});
  assert(chatUi._revealedRootIdForTest() === null,
    'DI-125a: firing a scroll event on #chat-sheet-scroll dismisses the revealed message — the third closer now reaches the sheet (Escape/click-elsewhere were already container-agnostic via wireRevealCloser)');

  // #chat-sheet-scroll is the SAME node across repeat renderSheetMessages()
  // calls (unlike #chat-scroll, fresh every renderChatPage()) — a second pass
  // (e.g. a poll tick while the sheet stays open) must not stack a second
  // 'scroll' listener.
  chatUi._renderSheetMessagesForTest('di125_scroll_g');
  assert(host47g._listenerCount('scroll') === 1,
    'bindSheetScrollDismiss\'s own guard keeps exactly ONE scroll listener across repeat renders, not one per render');

  document.getElementById = realGEBI47g;
  storage.clearSession();
}

console.log('\n[47h] RG-17a/d — the sheet\'s own stacking context and overflow, traced structurally…');
{
  // #chat-sheet-wrap establishes ITS OWN stacking context (position:fixed +
  // an explicit z-index) far above .bottom-nav's — unlike the historical
  // RG-17(d) defect (a picker landing BEHIND .bottom-nav in the MAIN feed,
  // where nothing between it and <body> created a competing context),
  // nothing rendered inside the sheet can land behind the nav regardless of
  // its OWN (much lower) z-index values. [structural — no layout engine here]
  const wrapRule47h = (cssSrc.match(/#chat-sheet-wrap\{[^}]*\}/) || [''])[0];
  const navRule47h = (cssSrc.match(/\.bottom-nav\{[^}]*\}/) || [''])[0];
  const wrapZ47h = Number((wrapRule47h.match(/z-index:\s*(\d+)/) || [])[1] || 0);
  const navZ47h = Number((navRule47h.match(/z-index:\s*(\d+)/) || [])[1] || 0);
  assert(/position:\s*fixed/.test(wrapRule47h) && wrapZ47h > 0,
    'fixture check: #chat-sheet-wrap is position:fixed with an explicit z-index — it establishes its own stacking context [structural]');
  assert(wrapZ47h > navZ47h,
    `#chat-sheet-wrap's z-index (${wrapZ47h}) exceeds .bottom-nav's (${navZ47h}) — everything painted inside the sheet stacks above the nav by construction, regardless of .chat-actions'/.reaction-picker's OWN far lower z-index values [structural]`);

  // .chat-sheet itself declares NO overflow — it cannot clip a popover that
  // escapes .chat-bubble-col's box; only its scrolling child can.
  const sheetRule47h = (cssSrc.match(/\.chat-sheet\{[^}]*\}/) || [''])[0];
  assert(!/overflow/.test(sheetRule47h),
    'fixture check: .chat-sheet sets no overflow of its own — only #chat-sheet-scroll (its scrolling child) can clip a popover [structural]');

  // #chat-sheet-scroll DOES clip (overflow-y:auto) — the SAME mechanism as
  // #chat-scroll in the main feed, not a new one, and .chat-actions opens
  // upward with no sheet-specific variant. See the handoff report for why the
  // sheet's much smaller minimum height makes the pre-existing "popover
  // clipped near the top of the scroll area" edge case easier to trigger
  // there than in the main feed — flagged for a browser check, not silently
  // redesigned here.
  const sheetScrollRule47h = (cssSrc.match(/\.chat-sheet-scroll\{[^}]*\}/) || [''])[0];
  assert(/overflow-y:\s*auto/.test(sheetScrollRule47h),
    'fixture check: #chat-sheet-scroll clips via overflow-y:auto — the SAME mechanism .chat-actions\' upward-opening popover already coexists with in the main feed [structural]');
  const actionsRule47h = (cssSrc.match(/^\.chat-actions\{[^}]*\}/m) || [''])[0];
  assert(/bottom:\s*calc\(100% \+ 4px\)/.test(actionsRule47h),
    'fixture check: .chat-actions opens UPWARD unconditionally — no sheet-specific positioning variant exists to drift from the main feed\'s [structural]');
}

// ── 48. AD-10 — the fold must stay order-independent at REAL timestamps ──────
// orderKey() packed the sort key as `ts * 1e7 + seq`, a single float. At a real
// epoch (~1.786e12) `ts * 1e7` is ~1.786e19, where the double's ulp is 2048 —
// so any seq below ~1024 is annihilated by the addition and contributes
// NOTHING. Messages sharing a ts therefore collapse to one identical key, and
// Array.prototype.sort (stable since ES2019) falls back to insertion order,
// which is the order events happened to arrive on THAT device.
//
// WHY THE EXISTING SHUFFLE SUITE ([2]) IS BLIND TO THIS: its fixture uses
// ts: 1000..6000, where ts * 1e7 ≤ 6e10 is exactly representable and every seq
// survives. The suite proves order-independence in the one magnitude regime
// where the bug cannot exist. Asserted below, explicitly, so the gap is on the
// record rather than rediscovered.
//
// CONCRETE TRIGGER: finalizeWeek() (app.js) emits emitWeekFinalEvent + one
// emitGameFinalEvent per game + emitExtraPointEvent in ONE synchronous tick,
// all stamped `_localTs: Date.now()` (chat.js sendEvent). Six devices, six
// different renderings of week finalization.
console.log('\n[48] AD-10 — fold order is stable at Date.now()-magnitude timestamps…');
{
  const chat48 = mods['chat'];
  // Real magnitude, taken live so the fixture can never quietly drift into a
  // regime where the bug stops reproducing (same discipline as [38]'s dates).
  const NOW48 = Date.now();

  // ROOT-CAUSE FIXTURE CHECKS — the arithmetic itself, before any folding.
  assert(NOW48 * 1e7 + 1 === NOW48 * 1e7,
    `root cause: at ts=${NOW48}, ts*1e7 + 1 === ts*1e7 — seq is annihilated by float precision (ulp ≈ ${(NOW48 * 1e7 + 4096) - NOW48 * 1e7})`);
  assert(NOW48 * 1e7 + 1023 === NOW48 * 1e7,
    'root cause: even seq=1023 vanishes — the whole realistic seq range collapses into the ts');
  assert(6000 * 1e7 + 1 !== 6000 * 1e7,
    "test-gap check: at suite [2]'s fixture magnitude (ts ≤ 6000) seq survives exactly — which is precisely why the existing shuffle suite could never see this");

  // The finalizeWeek burst, modelled event-for-event: every one of these is
  // emitted in a single synchronous tick and therefore carries ONE ts. Two
  // human messages share that tick too, so the reader-facing preview path
  // (latestNotifying) is exercised on the same tie.
  const sameTs48 = [
    { id: 'sys_weekfinal_w48', seq: 101, ts: NOW48, type: 'system',  author: 'system', notify: false, gameTag: '',    body: '📊 Week 1 final' },
    { id: 'sys_final_g1',      seq: 102, ts: NOW48, type: 'system',  author: 'system', notify: false, gameTag: 'g1',  body: 'FINAL: g1' },
    { id: 'sys_final_g2',      seq: 103, ts: NOW48, type: 'system',  author: 'system', notify: false, gameTag: 'g2',  body: 'FINAL: g2' },
    { id: 'sys_final_g3',      seq: 104, ts: NOW48, type: 'system',  author: 'system', notify: false, gameTag: 'g3',  body: 'FINAL: g3' },
    { id: 'sys_ep_w48',        seq: 105, ts: NOW48, type: 'system',  author: 'system', notify: false, gameTag: '',    body: '🎯 Extra Point' },
    { id: 'msg48_a',           seq: 106, ts: NOW48, type: 'message', author: 'p2',     notify: true,  gameTag: '',    body: 'first of the tie' },
    { id: 'msg48_b',           seq: 107, ts: NOW48, type: 'message', author: 'p2',     notify: true,  gameTag: '',    body: 'LAST of the tie — this is the preview' },
  ];
  // Bracketing messages at distinct, earlier/later real timestamps: the fix must
  // not disturb ordering that was already correct.
  const LOG48 = [
    { id: 'msg48_before', seq: 100, ts: NOW48 - 60000, type: 'message', author: 'p3', notify: true, gameTag: '', body: 'an hour of chatter earlier' },
    ...sameTs48,
    { id: 'msg48_after',  seq: 108, ts: NOW48 + 60000, type: 'message', author: 'p3', notify: true, gameTag: '', body: 'someone replies a minute later' },
  ];
  const EXPECTED_ORDER_48 = [
    'msg48_before',
    'sys_weekfinal_w48', 'sys_final_g1', 'sys_final_g2', 'sys_final_g3', 'sys_ep_w48',
    'msg48_a', 'msg48_b',
    'msg48_after',
  ].join(',');

  assert(chat48.getChatEpochSeq() === 0,
    'fixture check: no chat epoch watermark is set — nothing in this fixture is hidden from the fold');

  // Deterministic LCG shuffle: a failure here is reproducible, unlike Math.random.
  let rngState48 = 0x2545f491;
  const rnd48 = () => ((rngState48 = (rngState48 * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const foldOnce48 = evs => { chat48._resetForTest(); chat48.ingest(evs); return chat48._foldedSnapshot(); };
  const orderOnce48 = evs => { chat48._resetForTest(); chat48.ingest(evs); return chat48.getMessages({ tag: 'all' }).map(m => m.id).join(','); };

  const folds48 = new Set();
  const orders48 = new Set();
  for (let i = 0; i < 12; i++) {
    const shuffled = [...LOG48];
    for (let j = shuffled.length - 1; j > 0; j--) {
      const k = Math.floor(rnd48() * (j + 1));
      [shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]];
    }
    folds48.add(foldOnce48(shuffled));
    orders48.add(orderOnce48(shuffled));
  }
  assert(folds48.size === 1,
    `THE DEFECT: 12 shuffles of the same event log fold byte-identically (got ${folds48.size} distinct folds — one per arrival order means six devices render week-finalization differently)`);
  assert(orders48.size === 1,
    `12 shuffles yield ONE message order (got ${orders48.size} distinct orders)`);
  assert(orderOnce48(LOG48) === EXPECTED_ORDER_48,
    `and that one order is ts-then-seq ascending, not merely self-consistent — got ${orderOnce48(LOG48)}`);

  // Also assert against the WORST arrival order — exactly reversed. A fold that
  // silently depends on insertion order fails hardest here.
  assert(orderOnce48([...LOG48].reverse()) === EXPECTED_ORDER_48,
    'ingesting the log in fully REVERSED arrival order produces the identical message order');

  // The reader-facing preview path. latestNotifying() backs the dashboard chat
  // teaser and uses the same key, so it inherits the same tie: among messages
  // sharing a ts it must return the HIGHEST seq — the genuinely newest — not
  // whichever one this device happened to ingest first.
  chat48._resetForTest();
  chat48.ingest([...LOG48].reverse());
  const preview48 = chat48.latestNotifying('p1');
  assert(preview48 && preview48.id === 'msg48_after',
    `the dashboard preview is the newest message overall (got ${preview48 && preview48.id})`);

  // Narrow the same question onto the tie itself — drop the later-ts message so
  // the only candidates left share one ts and differ only by seq. Asserted in
  // BOTH arrival directions on purpose: `orderKey(m) > orderKey(best)` keeps the
  // FIRST-ingested member of a tie, so reversed arrival gives the right answer
  // by accident. Only forward arrival exposes it, and a test that checked one
  // direction would have shipped this bug twice.
  const tied48 = LOG48.filter(e => e.id !== 'msg48_after');
  for (const [dir, evs] of [['forward', tied48], ['reversed', [...tied48].reverse()]]) {
    chat48._resetForTest();
    chat48.ingest(evs);
    const got = chat48.latestNotifying('p1');
    assert(got && got.id === 'msg48_b',
      `among same-ts candidates the preview is the highest-seq message on ${dir} arrival (got ${got && got.id})`);
  }

  chat48._resetForTest();

  // 48b — THE SAME ARITHMETIC, 66 LINES UP. applyTo()'s last-writer-wins stamp
  // was `(ev.ts||0)*1e7 + (ev.seq||0)` — character-for-character the same
  // packing, with the same precision loss. Edit / pin / react races between two
  // events sharing a ts therefore resolved by ARRIVAL ORDER, so two devices
  // could disagree about whether a message is edited, pinned, or reacted to.
  // That is the RG-06 order-independence guarantee, broken in the fold itself
  // rather than in the sort. Found by tracing the pipeline rather than the
  // reported symptom; fixed in the same change because it is one root cause.
  const mkTarget48 = (id, seq) => ({ id, seq, ts: NOW48, type: 'message', author: 'p2', notify: true, gameTag: '', body: 'v0' });
  const LWW_CASES_48 = [
    {
      label: 'edit: the HIGHER-seq edit wins, not the last to arrive',
      evs: [
        mkTarget48('m48e', 210),
        { id: 'ed1', seq: 211, ts: NOW48, type: 'edit', targetId: 'm48e', author: 'p2', notify: false, body: 'v1' },
        { id: 'ed2', seq: 212, ts: NOW48, type: 'edit', targetId: 'm48e', author: 'p2', notify: false, body: 'v2 — the last word' },
      ],
      check: c => c.getMessage('m48e').body === 'v2 — the last word',
      show:  c => c.getMessage('m48e').body,
    },
    {
      label: 'pin: the HIGHER-seq unpin wins, not the last to arrive',
      evs: [
        mkTarget48('m48p', 220),
        { id: 'pn1', seq: 221, ts: NOW48, type: 'pin',   targetId: 'm48p', author: 'p1', notify: false },
        { id: 'pn2', seq: 222, ts: NOW48, type: 'unpin', targetId: 'm48p', author: 'p1', notify: false },
      ],
      check: c => c.getMessage('m48p').pinned === false,
      show:  c => 'pinned=' + c.getMessage('m48p').pinned,
    },
    {
      label: 'react: the HIGHER-seq unreact wins, not the last to arrive',
      evs: [
        mkTarget48('m48r', 230),
        { id: 'rx1', seq: 231, ts: NOW48, type: 'react',   targetId: 'm48r', author: 'p3', notify: false, meta: { emoji: '🔥' } },
        { id: 'rx2', seq: 232, ts: NOW48, type: 'unreact', targetId: 'm48r', author: 'p3', notify: false, meta: { emoji: '🔥' } },
      ],
      check: c => !(c.getMessage('m48r').reactions['🔥'] || []).length,
      show:  c => '🔥×' + (c.getMessage('m48r').reactions['🔥'] || []).length,
    },
  ];
  for (const cse of LWW_CASES_48) {
    for (const [dir, evs] of [['forward', cse.evs], ['reversed', [...cse.evs].reverse()]]) {
      chat48._resetForTest();
      chat48.ingest(evs);
      assert(cse.check(chat48), `${cse.label} — ${dir} arrival (got ${cse.show(chat48)})`);
    }
  }
  chat48._resetForTest();
}

// ── 49. RG — the reveal ritual is lost once the NEXT week is activated ───────
// checkPickRevealDue() only ever looked at getCurrentWeek(), and only runs on a
// nav tap. The moment the commissioner activates week N+1, week N's reveal can
// never fire on any device — the one guaranteed weekly all-hands moment,
// silently gone, exactly like RG's lost Extra Point.
//
// WIDENING THE SCAN IS THE DANGEROUS PART, AND THE REAL SUBJECT OF THIS SUITE.
// emitPickRevealEvent() writes an append-only event under a deterministic id
// (sys_reveal_<weekId>, AD-09/AD-11, RG-13). There are no take-backs. A scan
// that considered "every public week not in this device's local ledger" would,
// on any device with a fresh ledger — a new phone, a cleared cache, a new
// player — BACKFILL the room with a reveal for every historical week that never
// got one, in front of six real people.
//
// So the acceptance gate is not "the reveal fires again". It is: with a store
// full of old public weeks and an EMPTY ledger, EXACTLY ZERO events are
// emitted. That is asserted first, and asserted on emitted chat events rather
// than on the source text of the scan.
console.log('\n[49] RG — the reveal ritual survives week N+1, and NEVER backfills history…');
{
  const app49 = mods['app'];
  const REVEAL_KEY_49 = 'cfbp_reveal_emitted';
  const DAY_49 = 86400000;

  // RG-38 — THIS FIXTURE USED TO SPEAK A DIFFERENT CALENDAR THAN THE CODE IT
  // TESTS, and that is the whole reason the gate suite went red on Drew's
  // machine while reading green in CI-ish conditions.
  //
  // `week.endDate` is a LOCAL calendar date — it comes from an <input
  // type="date"> the commissioner fills in (app.js `#week-end`), and
  // checkPickRevealDue() reads it back as `new Date(endDate + 'T23:59:59')`,
  // which JS parses in LOCAL time. The fixture, meanwhile, derived its dates
  // with `new Date(ms).toISOString().slice(0,10)` — a UTC calendar date.
  //
  // West of UTC those two disagree by a full day for the whole local
  // afternoon/evening. Seeding "4 days ago" at 19:44 Pacific produced the UTC
  // date 2026-08-23, which is only THREE local calendar days back — legitimately
  // inside a 3-day lookback. The gate was right; the fixture mislabelled its own
  // week. Measured: 2.822d old when the fixture claimed 4d.
  //
  // Proof it was the clock and not the code: at the exact same commit,
  //   TZ=UTC                  → 1045 passed, 0 failed
  //   TZ=America/Los_Angeles  → 1039 passed, 6 failed   (Drew's machine)
  //   TZ=Pacific/Auckland     → 1044 passed, 1 failed
  //
  // Dates are now built by LOCAL calendar arithmetic (new Date(y, m, d - n)),
  // which is also DST-exact in a way `Date.now() - n*86400000` is not, and every
  // seeded week asserts its own real age below. A fixture whose age is a
  // function of the tester's time zone cannot gate anything.
  const iso49 = d => {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  /** N local calendar days before today, as a Date at local midnight. */
  const daysAgo49 = n => {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), t.getDate() - n);
  };
  /** How many whole local calendar days back a 'YYYY-MM-DD' string really is. */
  const ageInDays49 = dateStr => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const t = new Date();
    return Math.round(
      (new Date(t.getFullYear(), t.getMonth(), t.getDate()) - new Date(y, m - 1, d)) / DAY_49);
  };

  // Isolate: this suite counts sys_reveal_* events globally, so weeks left
  // behind by earlier suites would be indistinguishable noise. Last suite in
  // the file, nothing downstream depends on this store.
  storage.getWeeks().forEach(w => storage.deleteWeek(w.weekId));
  assert(storage.getWeeks().length === 0, 'fixture check: the week store is empty before the fixture is built');
  chat._resetForTest();
  localStorage.removeItem(REVEAL_KEY_49);

  storage.addPlayer({ playerId: 'rg49_a', displayName: 'Ann', active: true });
  storage.addPlayer({ playerId: 'rg49_b', displayName: 'Bob', active: true });

  // Every fixture week gets REAL games and REAL picks. Without them
  // emitPickRevealEvent() returns early on `!games.length` and the
  // zero-emission assertion below would pass for the wrong reason — it would be
  // measuring an empty slate, not the bound.
  const seedWeek49 = (weekId, weekNumber, status, endDaysAgo, extra = {}) => {
    const end = daysAgo49(endDaysAgo);
    const endDate = iso49(end);
    // The fixture states its own age out loud. If the date arithmetic ever
    // drifts from the local calendar again — a UTC helper, a DST edge, a
    // timezone that shifts the boundary — this fails FIRST and names the cause,
    // instead of the gate assertions failing later and reading like a real
    // backfill regression.
    assert(ageInDays49(endDate) === endDaysAgo,
      `fixture check: ${weekId}'s endDate (${endDate}) really is ${endDaysAgo} LOCAL calendar days old — the same calendar checkPickRevealDue() reads (got ${ageInDays49(endDate)})`);
    storage.saveWeek({
      weekId, weekNumber, season: 2026, status, dataSourceMode: 'real',
      startDate: iso49(daysAgo49(endDaysAgo + 1)), endDate, ...extra,
    });
    storage.saveGame({ weekId, gameId: weekId + '_g1', homeTeam: 'Ohio State', awayTeam: 'Texas',
      kickoff: end.toISOString(), status: 'final', homeScore: 28, awayScore: 21, spread: -3, lockedSpread: -3 });
    storage.saveAllPicks([...storage.getPicks(),
      { pickId: weekId + '_pk1', weekId, gameId: weekId + '_g1', playerId: 'rg49_a', selectedTeam: 'Ohio State' },
      { pickId: weekId + '_pk2', weekId, gameId: weekId + '_g1', playerId: 'rg49_b', selectedTeam: 'Texas' },
    ]);
    return storage.getWeek(weekId);
  };
  const revealsInRoom49 = () => getMessages({ tag: 'all' }).filter(m => /^sys_reveal_/.test(m.id)).map(m => m.id);

  // ── 49a — THE GATE. Four old, public, non-demo weeks with full slates, none
  // of which ever got a reveal, and a device whose ledger is empty. The scan
  // must emit NOTHING.
  const OLD_49 = [
    seedWeek49('rg49_old_final_60', 1, 'final', 60),
    seedWeek49('rg49_old_final_20', 2, 'final', 20),
    seedWeek49('rg49_old_live_10',  3, 'live',  10),
    seedWeek49('rg49_old_final_4',  4, 'final',  4),
  ];
  OLD_49.forEach(w => assert(storage.arePicksPublic(w) === true,
    `fixture check: ${w.weekId} is a PUBLIC week with a full slate — an unbounded scan WOULD post it`));
  assert(JSON.parse(localStorage.getItem(REVEAL_KEY_49) || '[]').length === 0,
    'fixture check: this device has an EMPTY reveal ledger — the fresh-phone / cleared-cache case');

  // The active week is a DRAFT week N+1 — the exact situation the bug describes.
  const NEXT_49 = seedWeek49('rg49_next', 6, 'draft', -7);   // ends a week from now
  storage.setActiveWeekId(NEXT_49.weekId);
  assert(storage.getCurrentWeek().weekId === NEXT_49.weekId,
    'fixture check: the commissioner has already activated the NEXT week');
  assert(storage.arePicksPublic(NEXT_49) === false, 'fixture check: that next week is a draft — not public, nothing to reveal');

  app49.checkPickRevealDue();
  assert(revealsInRoom49().length === 0,
    `THE GATE — ZERO retroactive emissions: four old public weeks, empty ledger, and the room stays silent (got ${JSON.stringify(revealsInRoom49())})`);
  // Repeat taps must not accumulate either — the ritual runs on every nav.
  for (let i = 0; i < 5; i++) app49.checkPickRevealDue();
  assert(revealsInRoom49().length === 0,
    `THE GATE — still zero after six nav taps (got ${JSON.stringify(revealsInRoom49())})`);
  assert(JSON.parse(localStorage.getItem(REVEAL_KEY_49) || '[]').length === 0,
    'and nothing was written to the ledger either — no silent "already done" marks for weeks that were never posted');

  // ── 49b — THE DEFECT. Week N is now genuinely live and ending today, while
  // week N+1 stays the active week. Its reveal must fire.
  const CUR_49 = seedWeek49('rg49_current', 5, 'live', 0);
  assert(storage.getCurrentWeek().weekId === NEXT_49.weekId,
    'fixture check: getCurrentWeek() STILL returns week N+1 — this is why the old scan could never see week N');
  app49.checkPickRevealDue();
  assert(revealsInRoom49().includes(`sys_reveal_${CUR_49.weekId}`),
    'THE DEFECT: the just-live week gets its reveal even though the commissioner has already activated the next week');
  assert(revealsInRoom49().length === 1,
    `…and it is the ONLY thing posted — the widened scan did not drag history in with it (got ${JSON.stringify(revealsInRoom49())})`);
  const body49 = getMessage(`sys_reveal_${CUR_49.weekId}`)?.body || '';
  assert(/Ann/.test(body49) && /Bob/.test(body49),
    'the posted reveal carries the actual field, not an empty shell');

  // ── 49c — idempotent. The ritual runs on every nav tap; it posts once.
  for (let i = 0; i < 5; i++) app49.checkPickRevealDue();
  assert(revealsInRoom49().length === 1,
    `five more nav taps post nothing further — the device ledger still holds (got ${JSON.stringify(revealsInRoom49())})`);

  // ── 49d — demo weeks are still excluded, and the blind rule still gates the
  // scan. A LOCKED week is not public, so it must not be revealed early — the
  // widened scan must not have become a second way around UN-116.
  const DEMO_49 = seedWeek49('rg49_demo', 7, 'live', 0, { dataSourceMode: 'demo' });
  const LOCKED_49 = seedWeek49('rg49_locked', 8, 'locked', 0);
  app49.checkPickRevealDue();
  app49.checkPickRevealDue();
  assert(!revealsInRoom49().includes(`sys_reveal_${DEMO_49.weekId}`),
    'a DEMO week is never revealed to the room (unchanged)');
  assert(!revealsInRoom49().includes(`sys_reveal_${LOCKED_49.weekId}`),
    'BLIND RULE: a LOCKED week is not public, so the widened scan never reveals it early');
  assert(revealsInRoom49().length === 1,
    `after every tap in this suite, exactly ONE reveal exists in the room (got ${JSON.stringify(revealsInRoom49())})`);

  // ── 49e — the bound is a real edge, not an accident of these fixtures. A week
  // that went public but ended just outside the lookback window is refused even
  // with an empty ledger; one just inside it is posted. This is the assertion
  // that fails if someone later "simplifies" the scan back to unbounded.
  localStorage.removeItem(REVEAL_KEY_49);
  chat._resetForTest();
  const JUST_OUT_49 = seedWeek49('rg49_justout', 9, 'final', 5);
  app49.checkPickRevealDue();
  assert(!revealsInRoom49().includes(`sys_reveal_${JUST_OUT_49.weekId}`),
    'a public week that ended 5 days ago is OUTSIDE the lookback — never posted, even on a device that has never posted anything');
  const JUST_IN_49 = seedWeek49('rg49_justin', 10, 'final', 1);
  app49.checkPickRevealDue();
  assert(revealsInRoom49().includes(`sys_reveal_${JUST_IN_49.weekId}`),
    'a public week that ended yesterday is INSIDE the lookback — posted, so the bound is a window and not a dead scan');

  // ── 49e2 — RG-38: THE EXACT EDGE, which 49e above never probed. 5-days-out
  // and 1-day-in leave the real boundary — REVEAL_LOOKBACK_DAYS = 3 measured to
  // local end-of-day, so endDate D-3 is the last accepted day and D-4 the first
  // refused — untested by three whole days of slack on either side. That slack
  // is precisely where the UTC/local fixture bug lived undetected, and it is
  // where an off-by-one in the cutoff would live too. Adjacent days, asserted in
  // both directions, on a cleared ledger each time so neither result can be an
  // artefact of the other.
  localStorage.removeItem(REVEAL_KEY_49);
  chat._resetForTest();
  const EDGE_OUT_49 = seedWeek49('rg49_edgeout', 12, 'final', 4);
  app49.checkPickRevealDue();
  assert(!revealsInRoom49().includes('sys_reveal_rg49_edgeout'),
    `THE EDGE — a week whose endDate is 4 local calendar days back (${EDGE_OUT_49.endDate}) is the FIRST day refused (got ${JSON.stringify(revealsInRoom49())})`);
  localStorage.removeItem(REVEAL_KEY_49);
  chat._resetForTest();
  const EDGE_IN_49 = seedWeek49('rg49_edgein', 13, 'final', 3);
  app49.checkPickRevealDue();
  assert(revealsInRoom49().includes('sys_reveal_rg49_edgein'),
    `THE EDGE — the very next day in (endDate 3 local calendar days back, ${EDGE_IN_49.endDate}) IS posted, so the boundary sits exactly between D-3 and D-4 and is not drifting`);

  // ── 49f — fail closed on an undated week (AD-26). endDate is how recency is
  // judged; a week without one cannot be shown to be recent, and the cost of
  // guessing wrong is a permanent post.
  //
  // RG-38 — THIS ASSERTION USED TO PASS WITHOUT TESTING ANYTHING. It ran against
  // a store still holding every earlier fixture week, and the scan sorts by
  // weekNumber DESC and posts at most one week per call. Any candidate with a
  // higher weekNumber consumed the single slot, so the undated week was never
  // even considered — the assertion was measuring the ONE-PER-INVOCATION cap,
  // not the fail-closed date guard it names.
  //
  // Proven, not assumed: inverting the guard to
  //   `return !Number.isFinite(ends) || ends >= cutoff;`
  // — which makes every undated week in the league permanently postable — left
  // the whole suite GREEN. Exactly the false-coverage shape RG-27 and the primer
  // warn about, sitting on top of an append-only log with no take-backs.
  //
  // The store is now emptied first, so the undated week is the ONLY candidate
  // and the single slot cannot be stolen. That is asserted too, because an
  // isolation step that silently stops isolating puts the hole straight back.
  storage.getWeeks().forEach(w => storage.deleteWeek(w.weekId));
  storage.setActiveWeekId(null);
  localStorage.removeItem(REVEAL_KEY_49);
  chat._resetForTest();
  storage.saveWeek({ weekId: 'rg49_undated', weekNumber: 11, season: 2026, status: 'final', dataSourceMode: 'real' });
  storage.saveGame({ weekId: 'rg49_undated', gameId: 'rg49_undated_g1', homeTeam: 'Ohio State', awayTeam: 'Texas', kickoff: new Date().toISOString(), status: 'final', homeScore: 28, awayScore: 21, spread: -3, lockedSpread: -3 });
  storage.saveAllPicks([...storage.getPicks(),
    { pickId: 'rg49_undated_pk1', weekId: 'rg49_undated', gameId: 'rg49_undated_g1', playerId: 'rg49_a', selectedTeam: 'Ohio State' }]);
  assert(storage.getWeeks().length === 1 && storage.getWeeks()[0].weekId === 'rg49_undated',
    `fixture check: the undated week is the ONLY week in the store, so the one-per-invocation cap cannot stand in for the date guard (got ${storage.getWeeks().length} weeks)`);
  assert(storage.arePicksPublic(storage.getWeek('rg49_undated')) === true,
    'fixture check: the undated week is public with a slate — only the missing endDate stands between it and a post');
  assert(storage.getWeek('rg49_undated').endDate === undefined,
    'fixture check: it genuinely has no endDate — the field is absent, not an empty string that might parse differently');
  app49.checkPickRevealDue();
  assert(!revealsInRoom49().includes('sys_reveal_rg49_undated'),
    'a week with NO endDate is refused — fail closed, because an undated week cannot be proven recent');
  // …and refused REPEATEDLY. A guard that fails closed once but drifts open on a
  // later nav tap is no guard: this runs on every navigation, all season.
  for (let i = 0; i < 5; i++) app49.checkPickRevealDue();
  assert(revealsInRoom49().length === 0,
    `an undated week is still refused after six nav taps — nothing accumulates (got ${JSON.stringify(revealsInRoom49())})`);
  assert(JSON.parse(localStorage.getItem(REVEAL_KEY_49) || '[]').length === 0,
    'and it was never marked done either — a refused week stays a candidate if it later gains a date, rather than being silently retired');

  // ── 49g — RG-38: THE SECOND BOUND, which had NO COVERAGE AT ALL. AD-26 requires
  // two INDEPENDENT bounds on this scan — recency, and at most one post per
  // invocation — precisely so that an error in either one alone cannot produce a
  // permanent multi-week backfill in a room with no take-backs. app.js states
  // "Both are asserted in loadtest.mjs [49]". Only the first one was.
  //
  // Proven, not assumed: replacing
  //   const week = due[0]; emitPickRevealEvent(week); done.push(week.weekId);
  // with a loop over every due week — deleting the cap outright — left the whole
  // suite GREEN. The cap survived untested because no fixture had ever placed
  // two weeks inside the lookback window at the same time, so the cap never had
  // anything to cap. A guard that is never given work to do cannot be observed
  // doing it.
  //
  // Two genuinely-due weeks, empty ledger. One tap must post exactly one. That
  // is the difference between a two-week backlog draining over two navigations
  // and the entire backlog landing in the room at once.
  storage.getWeeks().forEach(w => storage.deleteWeek(w.weekId));
  localStorage.removeItem(REVEAL_KEY_49);
  chat._resetForTest();
  const CAP_A_49 = seedWeek49('rg49_cap_a', 20, 'final', 1);
  const CAP_B_49 = seedWeek49('rg49_cap_b', 21, 'final', 1);
  assert(storage.arePicksPublic(CAP_A_49) && storage.arePicksPublic(CAP_B_49),
    'fixture check: BOTH backlog weeks are public with full slates');
  assert(storage.getWeeks().length === 2,
    `fixture check: exactly two candidate weeks are in the store, both inside the lookback (got ${storage.getWeeks().length})`);

  app49.checkPickRevealDue();
  assert(revealsInRoom49().length === 1,
    `THE CAP — two weeks are genuinely due, and ONE nav tap posts exactly one of them (got ${JSON.stringify(revealsInRoom49())})`);
  assert(revealsInRoom49()[0] === 'sys_reveal_rg49_cap_b',
    `…and it is the most recent week by weekNumber, not an arbitrary one (got ${revealsInRoom49()[0]})`);
  app49.checkPickRevealDue();
  assert(revealsInRoom49().length === 2,
    `the second tap drains the second week — a real backlog still clears, the cap throttles it rather than losing it (got ${JSON.stringify(revealsInRoom49())})`);
  for (let i = 0; i < 5; i++) app49.checkPickRevealDue();
  assert(revealsInRoom49().length === 2,
    `and five further taps add nothing — the ledger holds once the backlog is drained (got ${JSON.stringify(revealsInRoom49())})`);

  storage.getWeeks().forEach(w => storage.deleteWeek(w.weekId));
  storage.setActiveWeekId(null);
  localStorage.removeItem(REVEAL_KEY_49);
  chat._resetForTest();
}

// ── 50. UN-116 — the score summary blinded the COUNTS but not the STANDING ───
// renderDashboardInner()'s "This Week Score Summary" gated correctPicks,
// incorrectPicks and the tiebreaker behind `blind`, but left r.rank, the
// winner-row/loser-row class and the 🏆/💀 markers rendering unconditionally.
// Counts came through as "—" while the row above them still said "1 🏆".
//
// Reachable on a LOCKED week with at least one final game — auto-live disabled,
// or the commissioner simply holding at locked — where the picks are not yet
// public but results exist. Relative standing is the thing the blind rule is
// protecting: knowing you are behind is knowing how the field did.
//
// Asserted on the markup a player is actually served, never on the predicate —
// canViewOtherPicks() was already correct here and returned false; the template
// just never consulted it for these three fields.
console.log('\n[50] UN-116 — a blinded score summary hides RANK and the 🏆/💀 markers too…');
{
  const app50 = mods['app'];
  const W50 = {
    weekId: 'rg50_wk', weekNumber: 4, season: 2026, status: 'locked', dataSourceMode: 'demo',
    startDate: '2026-09-05', endDate: '2026-09-06',
  };
  storage.saveWeek(W50);
  storage.saveGame({ weekId: W50.weekId, gameId: 'rg50_g1', homeTeam: 'Ohio State', awayTeam: 'Texas',
    kickoff: '2026-09-05T16:00:00Z', status: 'final', homeScore: 28, awayScore: 21, spread: -3, lockedSpread: -3, atsWinner: 'Ohio State' });
  ['rg50_me', 'rg50_rival1', 'rg50_rival2'].forEach((id, i) =>
    storage.addPlayer({ playerId: id, displayName: ['Me', 'Rival One', 'Rival Two'][i], active: true }));
  const players50 = storage.getPlayers().filter(p => /^rg50_/.test(p.playerId));
  const results50 = [
    { playerId: 'rg50_rival1', rank: 1, correctPicks: 5, incorrectPicks: 1, isWinner: true,  wonByTiebreaker: true, tiebreakerGuess: 42, tiebreakerDelta: 2 },
    { playerId: 'rg50_me',     rank: 2, correctPicks: 3, incorrectPicks: 3,                                        tiebreakerGuess: 50, tiebreakerDelta: 10 },
    { playerId: 'rg50_rival2', rank: 3, correctPicks: 1, incorrectPicks: 5, isLoser: true,                          tiebreakerGuess: 60, tiebreakerDelta: 20 },
  ];
  const rankTexts50 = html => [...html.matchAll(/<td class="rank-cell[^"]*">([\s\S]*?)<\/td>/g)].map(m => m[1].trim());

  // ── 50a — the defect. An ordinary player on the locked week.
  storage.setSession('rg50_me', false, true);
  assert(storage.arePicksPublic(W50) === false,
    'fixture check: a LOCKED week is not public — the blind rule is in force');
  assert(app50.canViewOtherPicks(W50) === false,
    'fixture check: the predicate is already correct and says the rivals are blind — only the template disagreed');
  const blind50 = app50.renderScoreSummaryRowsHTML(W50, results50, players50, 34);
  assert(rankTexts50(blind50).length === 3, `fixture check: three rows rendered (got ${rankTexts50(blind50).length})`);
  assert((blind50.match(/result-win">—/g) || []).length === 2,
    'regression guard: both rivals\' ✅ counts are still blinded (the half that already worked)');

  assert(rankTexts50(blind50).every(t => !/\d/.test(t)),
    `THE DEFECT: no row prints a finishing position while the week is blind (got ranks ${JSON.stringify(rankTexts50(blind50))})`);
  assert(!/rank-1|rank-2|rank-3/.test(blind50),
    'THE DEFECT: the rank-N class is suppressed too — the class encodes the standing just as plainly as the digit does');
  assert(!/🏆/.test(blind50) && !/💀/.test(blind50),
    'THE DEFECT: no 🏆 / 💀 marker leaks who won and who lost the week');
  assert(!/winner-row|loser-row/.test(blind50),
    'THE DEFECT: no winner-row / loser-row class — the row tint names the winner without a single character of text');
  assert(!/\(TB\)/.test(blind50),
    'the "(TB)" marker is suppressed as well — it says someone WON, and how');
  // The viewer's own line is still their own: this must not have blinded them
  // out of their own results.
  assert(/result-win">3</.test(blind50) && /result-loss">3</.test(blind50),
    "the viewer's OWN ✅/❌ counts still render — the fix hides the field's standing, not the player's own week");
  assert(/50 \(Δ10\)/.test(blind50), "the viewer's OWN tiebreaker still renders");

  // ── 50b — the same fixture, viewed by the commissioner. This is what proves
  // the assertions above measure the blind rule and not a permanently dead
  // template (the failure mode that let the UN-116 guards rot unnoticed).
  //
  // RG-37 AUDIT NOTE — read the four assertions below carefully before copying
  // their shape. They pass because this fixture's week is LOCKED, where the
  // commissioner genuinely cannot submit and so has no stake left to protect.
  // They are NOT a licence for "the commissioner sees everything": worded that
  // way, on an OPEN week, they are character-for-character the two assertions
  // that defended the RG-37 leak into production. Change W50's status to 'open'
  // and every one of them SHOULD go red. That case is asserted in 50b2 below,
  // because a control that only ever runs in the permissive state cannot tell
  // you which of the two things it is measuring.
  storage.setSession('rg50_me', true, true);
  assert(app50.canPlayerSubmitPicks(W50, 'rg50_me').allowed === false,
    'fixture check: this week is LOCKED, so the commissioner has no stake left here — that, not the admin flag, is why the four assertions below hold');
  const admin50 = app50.renderScoreSummaryRowsHTML(W50, results50, players50, 34);
  assert(rankTexts50(admin50).join(',') === '1,2,3',
    `the commissioner still sees every finishing position (got ${JSON.stringify(rankTexts50(admin50))})`);
  assert(/🏆/.test(admin50) && /💀/.test(admin50), 'the commissioner still sees the 🏆 / 💀 markers');
  assert(/winner-row/.test(admin50) && /loser-row/.test(admin50), 'the commissioner still sees the winner/loser row tints');
  assert(/\(TB\)/.test(admin50), 'the commissioner still sees the (TB) marker');

  // ── 50b2 — RG-37: THE SAME COMMISSIONER, ON AN OPEN WEEK. The score summary
  // leaks relative standing — rank, 🏆/💀, the row tint, (TB) — and [50] never
  // once rendered it for a viewer who could still submit. Drew's rule does not
  // have a role exemption: "I shouldnt be able to see everyone elses picks
  // while I can still submit OR edit mine."
  //
  // Relative standing is pick data by another name. Knowing you sit 3rd tells
  // you how the field did, and on an OPEN week you can still act on it.
  {
    const WOPEN50 = { ...W50, status: 'open' };
    storage.saveWeek(WOPEN50);
    storage.setSession('rg50_me', true, true);
    assert(app50.canPlayerSubmitPicks(WOPEN50, 'rg50_me').allowed === true,
      'fixture check: on an OPEN week the commissioner CAN still submit — so the blind rule applies to him too');
    const adminOpen50 = app50.renderScoreSummaryRowsHTML(WOPEN50, results50, players50, 34);
    assert(rankTexts50(adminOpen50).join(',') === '—,—,—',
      `a commissioner who can still edit sees NO finishing positions (got ${JSON.stringify(rankTexts50(adminOpen50))})`);
    assert(!/🏆/.test(adminOpen50) && !/💀/.test(adminOpen50),
      'no 🏆 / 💀 markers either — they name the winner and loser without a character of text');
    assert(!/winner-row|loser-row/.test(adminOpen50),
      'and no winner-row / loser-row tint — the colour is data (RG-05)');
    assert(!/\(TB\)/.test(adminOpen50),
      'and no (TB) marker — it discloses that someone won, and how');
    assert(/result-win">3</.test(adminOpen50) && /50 \(Δ10\)/.test(adminOpen50),
      "…while the commissioner's OWN counts and tiebreaker still render — blinded from the field, not from himself");
    storage.saveWeek(W50);
  }

  // ── 50c — and once the week is genuinely public, an ordinary player sees the
  // standing again. The suppression is a window, not a deletion.
  storage.setSession('rg50_me', false, true);
  const WLIVE50 = { ...W50, status: 'live' };
  storage.saveWeek(WLIVE50);
  const live50 = app50.renderScoreSummaryRowsHTML(WLIVE50, results50, players50, 34);
  assert(rankTexts50(live50).join(',') === '1,2,3',
    `on a LIVE week the player sees the full standing again (got ${JSON.stringify(rankTexts50(live50))})`);
  assert(/🏆/.test(live50) && /💀/.test(live50), 'on a LIVE week the 🏆 / 💀 markers are back');
  assert(/winner-row/.test(live50) && /loser-row/.test(live50), 'on a LIVE week the row tints are back');
  assert(!/result-win">—/.test(live50), 'on a LIVE week the rivals\' counts are back');

  storage.setSession(null, false, false);
}

// ── 51. UN-119 — the invisible tap-target overlays, VERTICAL axis ────────────
// The horizontal axis was already fixed and reviewed: two 40px-wide overlays on
// controls ~23px apart overlapped by ~17px, so `width` became calc(100% + gap)
// and the overlays now tile edge-to-edge. `height` was left at a flat 40px.
//
// The vertical budget is not 40px either. `.dc-meta .chat-bubble-btn` is
// padding:1px 2px / font-size:.78rem / line-height:1 — a visible box of roughly
// 14-15px. A 40px overlay centred on it (top:50%, translateY(-50%)) therefore
// hangs ~12.75px past each edge. Below it, `.dc-game-head` has margin-bottom:8px
// and then `.dc-chips` — whose `.dc-chip`s are `draggable="true"` for column
// reorder. The button is position:relative, so its ::before paints in the
// positioned layer, ABOVE the static `.dc-chips` that follows it in the DOM:
// the overlay wins the hit test over the top few px of the chip row, and a drag
// started there opens the chat sheet instead of moving the column.
//
// Same principle the reviewer accepted horizontally: tiling beats overlapping.
// Two overlapping hit zones are a worse defect than one slightly short of the
// 40px floor, because the user taps what they are looking at and something else
// happens.
//
// STRUCTURAL BY NECESSITY, AND HONESTLY LIMITED. There is no layout engine
// here. This pins the overlay's extension against the actual margin it must not
// cross, computed from the CSS rather than matched as a literal. Whether the
// resulting target feels right under a thumb at 375px is a DEVICE question and
// is called out as such.
console.log('\n[51] UN-119 — tap-target overlays extend vertically without crossing into the draggable chip row…');
{
  const px51 = s => (s && /(-?\d+(?:\.\d+)?)px/.exec(s) ? Number(/(-?\d+(?:\.\d+)?)px/.exec(s)[1]) : NaN);
  const rule51 = sel => (cssSrc.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{[^}]*\\}')) || [''])[0];

  // The gap the overlay must not cross: .dc-game-head's margin-bottom is all
  // that separates .dc-meta's controls from the draggable chips.
  const headRule51 = rule51('.dc-game-head');
  const headGap51 = px51((/margin-bottom:\s*([^;}]+)/.exec(headRule51) || [])[1]);
  assert(Number.isFinite(headGap51) && headGap51 > 0,
    `fixture check: .dc-game-head still separates the meta row from .dc-chips with a margin-bottom (got ${headGap51}px)`);
  assert(/draggable="true"/.test(appJsSrc) && /class="dc-chip /.test(appJsSrc.replace(/dc-chip /g, 'dc-chip ')),
    'fixture check: the .dc-chip row below is genuinely draggable — an overlay reaching into it steals a real gesture');
  assert(/\.chat-bubble-btn\{[^}]*position:relative/.test(cssSrc),
    'fixture check: .chat-bubble-btn is position:relative, so its ::before paints ABOVE the static .dc-chips that follows it [structural]');

  const OVERLAYS_51 = [
    ['.dc-meta .chat-bubble-btn::before', 6],
    ['.reaction-add-btn-mini::before',    4],
  ];
  for (const [sel, expectedWidthGap] of OVERLAYS_51) {
    const r = rule51(sel);
    assert(!!r, `fixture check: ${sel} still exists`);
    const h = (/height:\s*([^;}]+)/.exec(r) || [])[1];
    const w = (/width:\s*([^;}]+)/.exec(r) || [])[1];

    // The horizontal fix must survive untouched — it was reviewed and is right.
    assert(w === `calc(100% + ${expectedWidthGap}px)`,
      `${sel}: the reviewed horizontal tiling is intact — width stays calc(100% + ${expectedWidthGap}px) (got ${w})`);

    assert(!/^\s*40px\s*$/.test(h || ''),
      `${sel}: THE DEFECT — height is no longer a flat 40px hanging ~12.75px past a ~14.5px box (got ${h})`);
    assert(/^calc\(100% \+ \d+(?:\.\d+)?px\)$/.test((h || '').trim()),
      `${sel}: height extends the REAL box by a fixed amount, the same shape as the width fix (got ${h})`);
    const grow51 = px51(h);
    assert(grow51 / 2 <= headGap51,
      `${sel}: the overlay grows ${grow51}px, i.e. ${grow51 / 2}px per side, which does NOT exceed the ${headGap51}px separating it from the draggable .dc-chip row (this is the whole assertion)`);
    assert(grow51 / 2 === headGap51,
      `${sel}: …and it uses that ${headGap51}px in full — tiling right up to the chip row, not leaving target area on the table`);
  }
}

// ── 52. renderFeedbackAdmin() — a malformed submittedAt renders "Invalid Date"
// The date cell guarded `e.submittedAt` for PRESENCE but not VALIDITY, so a
// legacy or hand-edited feedback row with an unparseable timestamp printed the
// literal string "Invalid Date" into the commissioner's card. Cosmetic and
// commissioner-only, but it is the same defensive-coercion-at-a-data-boundary
// rule the rest of this file follows (CONVENTIONS #7), and the fallback it
// should use already exists two characters away.
console.log('\n[52] renderFeedbackAdmin() — an unparseable submittedAt degrades to "—", never "Invalid Date"…');
{
  const app52 = mods['app'];
  const base52 = { feedbackId: 'fb52', playerId: 'rg50_me', kind: 'bug', body: 'something broke', weekId: null };
  const BAD_52 = [
    ['an empty-ish garbage string', 'not-a-date'],
    ['a partial ISO fragment',      '2026-13-45T99:99:99Z'],
    ['a number-like string',        'NaN'],
    ['a stray object',              {}],
  ];
  for (const [label, ts] of BAD_52) {
    const html = app52.renderFeedbackAdmin([{ ...base52, submittedAt: ts }]);
    assert(!/Invalid Date/.test(html),
      `THE DEFECT: ${label} does not print "Invalid Date" into the commissioner's card`);
    assert(/something broke/.test(html),
      `…and the row still renders its content (${label}) — degraded, not dropped`);
  }
  // Not an over-broad fix: a good timestamp still formats, and a missing one
  // still uses the same em-dash it always did.
  // RG-38, second instance — this used to hardcode /Aug 13, 2026/. The renderer
  // formats a UTC instant with toLocaleDateString(), i.e. in the VIEWER's zone,
  // which is right; the assertion froze one tester's zone, which is not. It went
  // red for every reader east of about UTC+9, where 15:04Z on the 13th is
  // already the 14th locally — a correct render failing a test that had quietly
  // become a timezone assertion. Same root cause as the [49] gate failures:
  // the test spoke a different calendar than the code. Expectation is now
  // derived from the same instant, so it still pins the FORMAT ("Mon D, YYYY")
  // and the right day, in whatever zone the suite runs.
  const TS_52 = '2026-08-13T15:04:05.000Z';
  const EXPECT_52 = new Date(TS_52).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const good52 = app52.renderFeedbackAdmin([{ ...base52, submittedAt: TS_52 }]);
  assert(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(EXPECT_52),
    `fixture check: the expected label is a real formatted date, not a fallback (got ${EXPECT_52})`);
  assert(good52.includes(EXPECT_52),
    `a VALID submittedAt still formats normally as "${EXPECT_52}" — got ${(/>([^<]*2026[^<]*)</.exec(good52) || [])[1]}`);
  const none52 = app52.renderFeedbackAdmin([{ ...base52, submittedAt: null }]);
  assert(!/Invalid Date/.test(none52) && /something broke/.test(none52),
    'a MISSING submittedAt behaves as before (unchanged)');
}

// ── 53. UN-118/UN-125 — multi-part week grouping: finalizeWeek() gating,
// Weekly History collapse, and the blind-rule isolation DI-126f requires ───
//
// A week RECORD is a scheduling unit (one lock time); a COMPETITIVE week is
// what players actually compete over and win a prize for. They diverge
// whenever one real week's games can't share a lock time (a split slate,
// bowls, CFP). Before this feature, two week records finalized independently
// for one real competitive week produced TWO weekly-winner obligations
// (§6 UN-118 interim risk). This suite drives the REAL finalizeWeek() (via
// applyWeekStatusChange(), the same path the commissioner's Week-tab buttons
// use) and the REAL renderLeaderboard() end-to-end — never a re-implementation
// of the gating logic — per Testing Protocol step 16/RG-27.
console.log('\n[53] UN-118/UN-125 — multi-part week grouping: finalizeWeek() gating, Weekly History collapse, blind-rule isolation…');
{
  const app53 = mods['app'];

  // Isolate: finalizeWeek()/calculateSeasonStandings() read ALL ACTIVE
  // players straight from storage, and this is the LAST suite in the file —
  // every player `addPlayer()`-ed by an earlier suite is still active and
  // would otherwise dilute/pollute this fixture's winner determination
  // (same isolation problem [49] solved by clearing all weeks first).
  storage.getPlayers().forEach(p => { if (p.active) storage.savePlayer({ ...p, active: false }); });
  storage.addPlayer({ playerId: 'un118_a', displayName: 'Ann', active: true });
  storage.addPlayer({ playerId: 'un118_b', displayName: 'Bob', active: true });

  const mkGame53 = (weekId, gameId, home, away, homeScore, awayScore) => ({
    weekId, gameId, homeTeam: home, awayTeam: away,
    kickoff: '2026-11-01T18:00:00Z', status: 'final',
    homeScore, awayScore, spread: -3, lockedSpread: -3,
  });

  // Part 1 (weekNumber 20): Ohio State -3 covers 28-21 (adjusted 25 > 21) —
  // Ann right, Bob wrong. Part 2 (weekNumber 21): Alabama -3 covers 30-10 —
  // Ann right again, Bob wrong again. Ann should be the GROUP's sole winner;
  // Bob the sole loser — never two winners, never two losers.
  const P1 = { weekId: 'un118_p1', weekNumber: 20, season: 2026, status: 'locked',
    dataSourceMode: 'manual', startDate: '2026-11-01', endDate: '2026-11-01',
    groupId: 'un118_p1', isGroupTiebreaker: false, actualTiebreakerValue: 100 };
  const P2 = { weekId: 'un118_p2', weekNumber: 21, season: 2026, status: 'locked',
    dataSourceMode: 'manual', startDate: '2026-11-08', endDate: '2026-11-08',
    groupId: 'un118_p1', isGroupTiebreaker: true, actualTiebreakerValue: 50 };
  storage.saveWeek(P1); storage.saveWeek(P2);
  storage.saveGame(mkGame53('un118_p1', 'un118_p1_g1', 'Ohio State', 'Texas', 28, 21));
  storage.saveGame(mkGame53('un118_p2', 'un118_p2_g1', 'Alabama', 'Georgia', 30, 10));
  storage.saveAllPicks([...storage.getPicks(),
    { pickId: 'un118_p1_pk_a', weekId: 'un118_p1', gameId: 'un118_p1_g1', playerId: 'un118_a', selectedTeam: 'Ohio State' },
    { pickId: 'un118_p1_pk_b', weekId: 'un118_p1', gameId: 'un118_p1_g1', playerId: 'un118_b', selectedTeam: 'Texas' },
    { pickId: 'un118_p2_pk_a', weekId: 'un118_p2', gameId: 'un118_p2_g1', playerId: 'un118_a', selectedTeam: 'Alabama' },
    { pickId: 'un118_p2_pk_b', weekId: 'un118_p2', gameId: 'un118_p2_g1', playerId: 'un118_b', selectedTeam: 'Georgia' },
  ]);
  // Part 1's own tiebreaker guesses are a DIFFERENT question (isGroupTiebreaker
  // false) and must be ignored entirely — only Part 2's guesses count.
  storage.setTiebreakerGuess('un118_p1', 'un118_a', 5);
  storage.setTiebreakerGuess('un118_p1', 'un118_b', 5);
  storage.setTiebreakerGuess('un118_p2', 'un118_a', 48);
  storage.setTiebreakerGuess('un118_p2', 'un118_b', 90);

  const weeklyObs53 = () => storage.getObligations().filter(o => o.type === 'weekly' &&
    (o.weekId === 'un118_p1' || o.weekId === 'un118_p2'));

  // ── 53a — Part 1 finalizes ALONE. Zero obligations; its own weekly-result
  // rows and its own chat event still fire (unconditionally, per DI-126d).
  app53.applyWeekStatusChange(storage.getWeek('un118_p1'), 'final');
  assert(storage.getWeek('un118_p1').status === 'final', 'fixture check: Part 1 persisted as final');
  assert(storage.getWeeklyResults('un118_p1').length === 2,
    "Part 1's own per-member weekly-result rows still save even though the group isn't complete");
  assert(!!getMessage('sys_weekfinal_un118_p1'),
    "Part 1's own chat week-final event still fires — per-part events are unconditional, not gated on the group");
  assert(weeklyObs53().length === 0,
    `THE GATE — Part 1 finalizing ALONE creates ZERO obligations (got ${weeklyObs53().length})`);

  // ── 53b — Weekly History at this checkpoint: ONE row for the group,
  // reading "in progress" (no winner/loser yet) — NOT a premature win for Ann
  // off Part 1 alone, and NOT two separate per-part rows.
  {
    const realGetById53 = document.getElementById;
    let lbHtml53 = '';
    const fakeLB53 = {
      id: 'page-leaderboard',
      set innerHTML(v) { lbHtml53 = v; }, get innerHTML() { return lbHtml53; },
      querySelectorAll() { return []; }, querySelector() { return null; },
    };
    document.getElementById = id => (id === 'page-leaderboard' ? fakeLB53 : realGetById53(id));
    app53.renderLeaderboard();
    document.getElementById = realGetById53;

    const wh53 = /Weekly History<\/div>[\s\S]*?<table class="dashboard-table">([\s\S]*?)<\/table>/.exec(lbHtml53)?.[1] || '';
    assert((wh53.match(/Week 20 \+ Week 21/g) || []).length === 1,
      `THE COLLAPSE: exactly ONE Weekly History row names the group "Week 20 + Week 21" while it's mid-progress (got ${(wh53.match(/Week 20 \+ Week 21/g)||[]).length})`);
    assert(!/Week 20 — /.test(wh53) && !/Week 21 — /.test(wh53),
      'the OLD per-part labels ("Week 20 — …" / "Week 21 — …") never appear — this is truly one row, not two rows that happen to sit next to a combined label');
    assert(!/>Ann/.test(wh53),
      "THE DEFECT THIS PREVENTS: Ann is NOT credited as winner yet — Part 1's own per-part isWinner must not leak into the group row before Part 2 is final");
  }

  // ── 53c — Part 2 finalizes. NOW the group is complete: exactly ONE
  // obligation, group-keyed to the canonical id (Part 1's own weekId, since
  // it was the founder), naming Ann as the real winner.
  app53.applyWeekStatusChange(storage.getWeek('un118_p2'), 'final');
  assert(storage.getWeeklyResults('un118_p2').length === 2, "Part 2's own per-member weekly-result rows saved too");
  assert(!!getMessage('sys_weekfinal_un118_p2'), "Part 2's own chat week-final event fires too");
  const obs53 = weeklyObs53();
  assert(obs53.length === 1,
    `THE ACCEPTANCE GATE — the group creates EXACTLY ONE obligation once both parts are final (got ${obs53.length})`);
  assert(obs53[0]?.weekId === 'un118_p1',
    `the one obligation is keyed to the group's CANONICAL id, not either part's own scoring-only weekId (got ${obs53[0]?.weekId})`);
  assert(obs53[0]?.recipientPlayerId === 'un118_a' && obs53[0]?.payerPlayerId === 'un118_b',
    `the obligation names the GROUP's real winner (Ann) and loser (Bob), pooled across both parts (got recipient=${obs53[0]?.recipientPlayerId}, payer=${obs53[0]?.payerPlayerId})`);

  // ── 53d — re-finalize Part 1 again (the commissioner re-pressing an
  // already-final button, or an auto-transition re-check). STILL exactly one
  // obligation — idempotent, not a second prize awarded.
  app53.applyWeekStatusChange(storage.getWeek('un118_p1'), 'final');
  assert(weeklyObs53().length === 1,
    `re-finalizing Part 1 again does NOT create a second obligation (got ${weeklyObs53().length})`);

  // ── 53e — Weekly History again, now that the group is complete: still ONE
  // row, now correctly naming Ann as winner and Bob as loser.
  {
    const realGetById53b = document.getElementById;
    let lbHtml53b = '';
    const fakeLB53b = {
      id: 'page-leaderboard',
      set innerHTML(v) { lbHtml53b = v; }, get innerHTML() { return lbHtml53b; },
      querySelectorAll() { return []; }, querySelector() { return null; },
    };
    document.getElementById = id => (id === 'page-leaderboard' ? fakeLB53b : realGetById53b(id));
    app53.renderLeaderboard();
    document.getElementById = realGetById53b;

    const wh53b = /Weekly History<\/div>[\s\S]*?<table class="dashboard-table">([\s\S]*?)<\/table>/.exec(lbHtml53b)?.[1] || '';
    assert((wh53b.match(/Week 20 \+ Week 21/g) || []).length === 1,
      'still exactly ONE row for the group once it is complete — finalizing Part 2 did not add a second row');
    const annRows53 = (wh53b.match(/player-name-cell">Ann/g) || []).length;
    assert(annRows53 === 1,
      `Ann is named winner exactly ONCE in Weekly History, never twice (got ${annRows53})`);
    assert(/player-name-cell">Bob/.test(wh53b), 'Bob is named loser');
  }

  // ── 53f — DI-126f: grouping must never leak the OTHER part's picks. A
  // fixture where Part 1 of a (separate) group is LIVE and Part 2 is
  // OPEN/LOCKED — Part 1 public, Part 2 emphatically NOT. arePicksPublic()/
  // canPlayerSubmitPicks() stay single-week-scoped by design (no code change
  // here) — this proves grouping didn't accidentally widen either one.
  const P3 = { weekId: 'un118_p3', weekNumber: 22, season: 2026, status: 'live',
    dataSourceMode: 'manual', groupId: 'un118_p3' };
  const P4 = { weekId: 'un118_p4', weekNumber: 23, season: 2026, status: 'locked',
    dataSourceMode: 'manual', groupId: 'un118_p3' };
  const P5 = { weekId: 'un118_p5', weekNumber: 24, season: 2026, status: 'open',
    dataSourceMode: 'manual', groupId: 'un118_p3' };
  storage.saveWeek(P3); storage.saveWeek(P4); storage.saveWeek(P5);
  assert(storage.arePicksPublic(storage.getWeek('un118_p3')) === true,
    'DI-126f: Part 1 (LIVE) of a group is public, exactly as an ungrouped LIVE week would be');
  assert(storage.arePicksPublic(storage.getWeek('un118_p4')) === false,
    'DI-126f: Part 2 (LOCKED) of the SAME group stays blind — grouping never leaks another part\'s picks');
  assert(storage.arePicksPublic(storage.getWeek('un118_p5')) === false,
    'DI-126f: Part 3 (OPEN) of the same group also stays blind');
}

// ── 54. UN-126 — obligations are never silently "already settled," and the
// commissioner can merge/void without ever deleting a money record ─────────
//
// PART 1 (the defect): a week finalizing ALONE creates a singleton
// obligation keyed to its own weekId; when it's LATER grouped with a
// still-open partner, the group's canonical id can equal that same weekId,
// so presence of the singleton used to read as "already settled" and the
// group's real (possibly different) outcome was silently dropped. THE FIX:
// reconcileWeeklyObligation() (app.js, private — driven only through the
// real finalizeWeek()/applyWeekStatusChange() path, per Testing Protocol
// step 16/RG-27) never accepts a mismatched existing record silently and
// never overwrites it — it creates the fresh correct record AND flags every
// active record for that weekId `needsReview`, for a human to resolve.
//
// PART 2 (the tool): voidObligationById() / mergeObligationsById() resolve
// what Part 1 surfaces (and the pre-UN-118 duplicates that already exist)
// WITHOUT ever deleting a record — voided/merged rows stay visible on
// screen (renderObligationCorrectionsAdmin/renderObligationsAdmin) and in
// the CSV export (buildObligationsCsvRows), tagged with their state.
console.log('\n[54] UN-126 — obligation settled-ness fix (Part 1) + merge/void tool (Part 2)…');
{
  const app54 = mods['app'];

  // Isolate players — this is the LAST suite in the file; every player
  // added by an earlier suite (including suite 53's Ann/Bob) is still
  // active and would dilute this fixture's winner determination (same
  // isolation problem suite 53 itself solved).
  storage.getPlayers().forEach(p => { if (p.active) storage.savePlayer({ ...p, active: false }); });
  storage.addPlayer({ playerId: 'un126_x', displayName: 'Xena', active: true });
  storage.addPlayer({ playerId: 'un126_y', displayName: 'Yusuf', active: true });

  const mkGame54 = (weekId, gameId, home, away, homeScore, awayScore) => ({
    weekId, gameId, homeTeam: home, awayTeam: away,
    kickoff: '2026-11-15T18:00:00Z', status: 'final',
    homeScore, awayScore, spread: -3, lockedSpread: -3,
  });

  // ── 54a — THE DEFECT SCENARIO, driven end-to-end through the REAL
  // finalizeWeek()/applyWeekStatusChange() and renderLeaderboard(). ─────────
  //
  // M1 finalizes ALONE first (ungrouped — its effective group id is its own
  // weekId). One game; Xena covers, Yusuf doesn't — Xena wins M1 solo.
  const M1 = { weekId: 'un126_m1', weekNumber: 30, season: 2026, status: 'locked',
    dataSourceMode: 'manual', startDate: '2026-11-15', endDate: '2026-11-15' };
  storage.saveWeek(M1);
  storage.saveGame(mkGame54('un126_m1', 'un126_m1_g1', 'Home1', 'Away1', 28, 21)); // Home1 covers -3
  storage.saveAllPicks([...storage.getPicks(),
    { pickId: 'un126_m1_pk_x', weekId: 'un126_m1', gameId: 'un126_m1_g1', playerId: 'un126_x', selectedTeam: 'Home1' },
    { pickId: 'un126_m1_pk_y', weekId: 'un126_m1', gameId: 'un126_m1_g1', playerId: 'un126_y', selectedTeam: 'Away1' },
  ]);
  app54.applyWeekStatusChange(storage.getWeek('un126_m1'), 'final');

  const weeklyObs54 = wid => storage.getObligations().filter(o => o.type === 'weekly' && o.weekId === wid);
  const activeWeeklyObs54 = wid => storage.getActiveObligations(wid).filter(o => o.type === 'weekly');

  assert(weeklyObs54('un126_m1').length === 1, 'fixture check: M1 finalizing alone creates its own singleton obligation');
  const singleton54 = weeklyObs54('un126_m1')[0];
  assert(singleton54.payerPlayerId === 'un126_y' && singleton54.recipientPlayerId === 'un126_x',
    'fixture check: the singleton correctly names Yusuf (loser) owing Xena (winner) off M1 alone');
  assert(singleton54.needsReview === false, 'a freshly created, unconflicted obligation is NOT flagged for review');

  // M2 is LATER grouped onto M1 (groupId points at M1's own weekId — the
  // exact shape that made the old code's presence-check collide). Three
  // games, all won by Yusuf, enough to flip the POOLED outcome so Yusuf
  // becomes the group's real winner and Xena the real loser — the opposite
  // of what the M1-alone singleton recorded.
  const M2 = { weekId: 'un126_m2', weekNumber: 31, season: 2026, status: 'locked',
    dataSourceMode: 'manual', groupId: 'un126_m1', isGroupTiebreaker: true, actualTiebreakerValue: 50,
    startDate: '2026-11-22', endDate: '2026-11-22' };
  storage.saveWeek(M2);
  ['a', 'b', 'c'].forEach((s, i) => {
    storage.saveGame(mkGame54('un126_m2', `un126_m2_g${s}`, `H2${s}`, `A2${s}`, 10, 24)); // away covers every time
    storage.saveAllPicks([...storage.getPicks(),
      { pickId: `un126_m2_pk_x${i}`, weekId: 'un126_m2', gameId: `un126_m2_g${s}`, playerId: 'un126_x', selectedTeam: `H2${s}` },  // wrong every time
      { pickId: `un126_m2_pk_y${i}`, weekId: 'un126_m2', gameId: `un126_m2_g${s}`, playerId: 'un126_y', selectedTeam: `A2${s}` },  // right every time
    ]);
  });
  storage.setTiebreakerGuess('un126_m2', 'un126_x', 48);
  storage.setTiebreakerGuess('un126_m2', 'un126_y', 52);

  app54.applyWeekStatusChange(storage.getWeek('un126_m2'), 'final');

  // THE GATE — the stale singleton is left EXACTLY as it was (never
  // silently overwritten) and a fresh, correctly-computed record now also
  // exists (never silently accepted/ignored) — both flagged for a human.
  const afterGroup54 = activeWeeklyObs54('un126_m1');
  assert(afterGroup54.length === 2,
    `THE FIX — a conflicting group outcome creates a SECOND record rather than silently doing nothing (got ${afterGroup54.length} active obligations for the gid)`);
  const stale54 = afterGroup54.find(o => o.payerPlayerId === 'un126_y' && o.recipientPlayerId === 'un126_x');
  const fresh54 = afterGroup54.find(o => o.payerPlayerId === 'un126_x' && o.recipientPlayerId === 'un126_y');
  assert(!!stale54, 'the ORIGINAL (stale) obligation is still on record, untouched, not deleted');
  assert(stale54.obligationId === singleton54.obligationId && stale54.createdAt === singleton54.createdAt,
    'the stale record is the SAME record (same id, same createdAt) — never overwritten in place');
  assert(!!fresh54, 'a NEW obligation exists naming the freshly computed (correct, pooled) winner/loser — never silently dropped');
  assert(stale54.needsReview === true && fresh54.needsReview === true,
    'BOTH the stale and the fresh record are flagged needsReview — surfaced, not silently resolved either way');

  // Weekly History (what every player sees on Standings) — UN-135: a
  // conflicted row is a PLAYER-facing money display, not a diagnostic tool,
  // so it now renders the plain, ordinary Unpaid badge instead of a
  // "Needs review" warning — full parity with a normal unpaid row, no
  // asterisk, no title, no action button. The commissioner still sees the
  // real diagnostic (companion guard immediately below, same fixture,
  // BEFORE resolution) — this only ever changed the player-facing copy.
  {
    const realGetById54 = document.getElementById;
    let lbHtml54 = '';
    const fakeLB54 = {
      id: 'page-leaderboard',
      set innerHTML(v) { lbHtml54 = v; }, get innerHTML() { return lbHtml54; },
      querySelectorAll() { return []; }, querySelector() { return null; },
    };
    document.getElementById = id => (id === 'page-leaderboard' ? fakeLB54 : realGetById54(id));
    app54.renderLeaderboard();
    document.getElementById = realGetById54;

    const wh54 = /Weekly History<\/div>[\s\S]*?<table class="dashboard-table">([\s\S]*?)<\/table>/.exec(lbHtml54)?.[1] || '';
    assert(!/Needs review/.test(wh54),
      'UN-135: Weekly History (player Standings) no longer renders the ⚠️ Needs review warning for a conflicted group row');
    assert(/badge badge-locked">Unpaid<\/span>/.test(wh54),
      'UN-135: the conflicted row instead renders the plain existing Unpaid badge — full parity with a normal unpaid row');
    assert(!/Mark Paid|Confirm Paid/.test(wh54),
      'Weekly History does NOT render a normal payment action while the row is conflicted — it would name a payer that may be wrong');
  }

  // ── 54a-companion (RG-27 lesson: a protection needs a test that detects
  // its own removal) — UN-135 changed ONLY the player-facing Weekly History
  // copy. The commissioner's two diagnostic surfaces, driven off the SAME
  // still-conflicted fixture (stale54/fresh54 both needsReview:true, not
  // yet voided), MUST still say "Needs review" — if a future edit collapses
  // the commissioner view to match the softened player view, this goes red.
  {
    const adminHtml54 = app54.renderObligationsAdmin();
    assert(/Needs review/.test(adminHtml54),
      'UN-135 companion guard: renderObligationsAdmin() (commissioner) still shows ⚠️ Needs review for the same conflicted data');
    const corrHtml54 = app54.renderObligationCorrectionsAdmin();
    assert(/Needs review/.test(corrHtml54),
      'UN-135 companion guard: renderObligationCorrectionsAdmin() (commissioner) still shows ⚠️ Needs review for the same conflicted data');
  }

  // ── 54b — Part 2 resolves it: void the stale record. ─────────────────────
  const voidOk54 = app54.voidObligationById(stale54.obligationId, 'pre-grouping singleton — superseded by the pooled group outcome');
  assert(voidOk54 === true, 'voidObligationById() reports success');
  const staleAfterVoid54 = storage.getObligations().find(o => o.obligationId === stale54.obligationId);
  assert(staleAfterVoid54.voided === true && !!staleAfterVoid54.voidedAt,
    'the voided record is flagged voided:true with a timestamp');
  assert(staleAfterVoid54.voidReason === 'pre-grouping singleton — superseded by the pooled group outcome',
    'the void reason is recorded');
  assert(staleAfterVoid54.needsReview === false, "voiding clears the voided record's own needsReview flag");
  assert(storage.getObligations().some(o => o.obligationId === stale54.obligationId),
    'THE RECORD STILL EXISTS — void never deletes (CLAUDE.md: an obligation is a real debt between real people)');

  const freshAfterVoid54 = storage.getObligations().find(o => o.obligationId === fresh54.obligationId);
  assert(freshAfterVoid54.needsReview === false,
    "voiding the stale sibling also clears needsReview on the surviving active record — the conflict is resolved, it shouldn't keep nagging");

  assert(activeWeeklyObs54('un126_m1').length === 1 && activeWeeklyObs54('un126_m1')[0].obligationId === fresh54.obligationId,
    'exactly one ACTIVE weekly obligation remains for the gid — the correct one');

  // Re-finalizing M1 again (idempotent re-press) after resolution does NOT
  // mint a third obligation — the survivor already matches the computed
  // outcome exactly.
  app54.applyWeekStatusChange(storage.getWeek('un126_m1'), 'final');
  assert(activeWeeklyObs54('un126_m1').length === 1,
    `re-finalizing again after resolution does not create a third obligation (got ${activeWeeklyObs54('un126_m1').length})`);

  // Weekly History now renders normally — the row is no longer conflicted.
  {
    const realGetById54b = document.getElementById;
    let lbHtml54b = '';
    const fakeLB54b = {
      id: 'page-leaderboard',
      set innerHTML(v) { lbHtml54b = v; }, get innerHTML() { return lbHtml54b; },
      querySelectorAll() { return []; }, querySelector() { return null; },
    };
    document.getElementById = id => (id === 'page-leaderboard' ? fakeLB54b : realGetById54b(id));
    app54.renderLeaderboard();
    document.getElementById = realGetById54b;
    const wh54b = /Weekly History<\/div>[\s\S]*?<table class="dashboard-table">([\s\S]*?)<\/table>/.exec(lbHtml54b)?.[1] || '';
    assert(!/Needs review/.test(wh54b), 'once resolved, the review warning is gone from Weekly History');
    // No admin/player session is active in this harness (getSession() default
    // is a bystander), so no ACTION button renders either way — but the
    // ordinary status badge (obligationActionsHTML's badge half) proves the
    // row fell through to the normal, non-conflicted render path.
    assert(/Unpaid/.test(wh54b), 'the row now renders the normal Unpaid status badge for the surviving obligation, not a conflict warning');
  }

  // ── 54c — buildObligationsCsvRows(): voided state is VISIBLE in the CSV,
  // even though it's excluded from what players see on screen. ────────────
  {
    const playersById54 = Object.fromEntries(storage.getPlayers().map(p => [p.playerId, p.displayName]));
    const weeksById54 = Object.fromEntries(storage.getWeeks().map(w => [w.weekId, w]));
    const header54 = app54.buildObligationsCsvRows([], {}, {})[0];
    assert(JSON.stringify(header54) === JSON.stringify(['Obligation ID', 'Type', 'Week', 'Payer', 'Recipient', 'Amount/Prize', 'Status', 'Created', 'Paid At', 'Needs Review', 'Voided', 'Void Reason', 'Merged Into', 'Merged From']),
      `header row carries the five new audit columns in order (got ${JSON.stringify(header54)})`);
    const rows54 = app54.buildObligationsCsvRows([staleAfterVoid54], playersById54, weeksById54);
    const row54 = rows54[1];
    assert(row54[9] === '', `Needs Review column is empty for a resolved (voided) record (got "${row54[9]}")`);
    assert(row54[10] === 'yes', `Voided column reads "yes" for a voided record (got "${row54[10]}")`);
    assert(row54[11] === 'pre-grouping singleton — superseded by the pooled group outcome', 'Void Reason column carries the recorded reason');
    assert(row54[3] === 'Yusuf' && row54[4] === 'Xena', 'the voided row still names its real payer/recipient — visible, not scrubbed');
  }
  // needsReview was cleared by the void above, so re-check it independently
  // against a still-flagged fixture (freshAfterVoid54 was cleared too) —
  // build one on the spot rather than reuse a since-resolved record.
  {
    const flagged54 = { ...storage.createObligation('un126_zz', 'un126_x', 'un126_y', '$5'), needsReview: true };
    const row = app54.buildObligationsCsvRows([flagged54], {}, {})[1];
    assert(row[9] === 'yes', 'Needs Review column reads "yes" for a flagged-but-unresolved record');
  }

  // ── 54d — mergeObligationsById(): records what it absorbed, excludes the
  // absorbed records from tallies, never deletes anything. Modelled on
  // Drew's stated pre-UN-118 case: two DIFFERENT week records for one real
  // competitive week, each independently finalized before grouping existed
  // — never auto-flagged (different weekIds), resolved by hand. ───────────
  storage.saveObligation(storage.createObligation('un126_preA', 'un126_y', 'un126_x', '1 drink'));
  storage.saveObligation(storage.createObligation('un126_preB', 'un126_y', 'un126_x', '1 drink'));
  storage.saveObligation(storage.createObligation('un126_preC', 'un126_y', 'un126_x', '1 drink'));
  const obA54 = storage.getObligations().find(o => o.weekId === 'un126_preA');
  const obB54 = storage.getObligations().find(o => o.weekId === 'un126_preB');
  const obC54 = storage.getObligations().find(o => o.weekId === 'un126_preC');
  const totalBeforeMerge54 = storage.getObligations().length;

  const mergeOk54 = app54.mergeObligationsById(obA54.obligationId, [obB54.obligationId]);
  assert(mergeOk54 === true, 'mergeObligationsById() reports success');
  assert(storage.getObligations().length === totalBeforeMerge54,
    'merging changes zero record COUNT — nothing is deleted, only flagged');
  const obAAfter1 = storage.getObligations().find(o => o.obligationId === obA54.obligationId);
  const obBAfter = storage.getObligations().find(o => o.obligationId === obB54.obligationId);
  assert(JSON.stringify(obAAfter1.mergedFrom) === JSON.stringify([obB54.obligationId]),
    `the survivor's mergedFrom records exactly what it absorbed (got ${JSON.stringify(obAAfter1.mergedFrom)})`);
  assert(obBAfter.voided === true && obBAfter.mergedInto === obA54.obligationId,
    'the absorbed record is voided with mergedInto pointing at the survivor');
  assert(obAAfter1.payerPlayerId === obA54.payerPlayerId && obAAfter1.amountOrPrize === obA54.amountOrPrize,
    "the survivor's own payer/recipient/amount are UNTOUCHED — merge never invents a value, the commissioner's pick stands as-is");

  // A second merge onto the SAME survivor accumulates rather than overwrites.
  app54.mergeObligationsById(obA54.obligationId, [obC54.obligationId]);
  const obAAfter2 = storage.getObligations().find(o => o.obligationId === obA54.obligationId);
  assert(JSON.stringify(obAAfter2.mergedFrom.slice().sort()) === JSON.stringify([obB54.obligationId, obC54.obligationId].sort()),
    `a SECOND merge accumulates onto mergedFrom rather than replacing it (got ${JSON.stringify(obAAfter2.mergedFrom)})`);

  assert(activeWeeklyObs54 && storage.getActiveObligations().some(o => o.obligationId === obA54.obligationId),
    'the survivor stays ACTIVE (counts toward what is owed)');
  assert(!storage.getActiveObligations().some(o => o.obligationId === obB54.obligationId) &&
         !storage.getActiveObligations().some(o => o.obligationId === obC54.obligationId),
    'both absorbed records are EXCLUDED from getActiveObligations() — they no longer count toward what anyone owes');

  {
    const rowsA54 = app54.buildObligationsCsvRows([obAAfter2], {}, {});
    assert(rowsA54[1][13] === [obB54.obligationId, obC54.obligationId].join('; ') ||
           rowsA54[1][13] === [obC54.obligationId, obB54.obligationId].join('; '),
      'Merged From column lists both absorbed ids, semicolon-joined, in the CSV export');
    const rowsB54 = app54.buildObligationsCsvRows([obBAfter], {}, {});
    assert(rowsB54[1][12] === obA54.obligationId, 'Merged Into column names the survivor for an absorbed row');
  }

  // Merging fewer than 2 (or an already-voided id) is a documented no-op —
  // never a partial/garbage write.
  assert(app54.mergeObligationsById(obA54.obligationId, []) === false,
    'mergeObligationsById() with no otherIds is a no-op, not a silent success');
  assert(app54.mergeObligationsById(obA54.obligationId, [obB54.obligationId]) === false,
    'mergeObligationsById() where the only other id is ALREADY voided is a no-op — it will not re-absorb or double-flag');

  // ── 54e — legacy obligation rows (predate every UN-126 field) default
  // safely and never throw, across every surface that reads them
  // (CONVENTIONS #10). ──────────────────────────────────────────────────────
  const legacy54 = {
    obligationId: 'ob_legacy_un126', type: 'weekly', weekId: 'un126_legacy_wk',
    payerPlayerId: 'un126_y', recipientPlayerId: 'un126_x',
    amountOrPrize: '1 drink', status: 'unpaid',
    createdAt: '2026-01-01T00:00:00.000Z', paidAt: null,
    // deliberately NO needsReview / voided / voidedAt / voidReason / mergedInto / mergedFrom
  };
  storage.saveObligation(legacy54);

  assert(dm.isObligationActive(legacy54) === true, 'isObligationActive() reads a legacy row (no `voided` field at all) as ACTIVE');
  assert(storage.getActiveObligations('un126_legacy_wk').some(o => o.obligationId === 'ob_legacy_un126'),
    'getActiveObligations() includes a legacy row with no voided field');

  let threw54a = false, corrHtml54;
  try { corrHtml54 = app54.renderObligationCorrectionsAdmin([legacy54]); } catch (e) { threw54a = true; console.error(e); }
  assert(!threw54a, 'renderObligationCorrectionsAdmin() does not throw on a legacy row missing every UN-126 field');
  assert(!/Voided|Merged|Needs review/.test(corrHtml54), 'a legacy row with no flags renders with NO state badge');
  assert(/obcorr-check.*ob_legacy_un126|ob_legacy_un126.*obcorr-check/s.test(corrHtml54) || /data-ob-id="ob_legacy_un126"/.test(corrHtml54),
    'a legacy row still renders a checkbox/void control — it is a normal active obligation, not something broken');

  let threw54b = false, admHtml54;
  try { admHtml54 = app54.renderObligationsAdmin(); } catch (e) { threw54b = true; console.error(e); }
  assert(!threw54b, 'renderObligationsAdmin() does not throw with a legacy row (missing needsReview/voided) present in live storage');

  let threw54c = false, csv54;
  try { csv54 = app54.buildObligationsCsvRows([legacy54], {}, {}); } catch (e) { threw54c = true; console.error(e); }
  assert(!threw54c, 'buildObligationsCsvRows() does not throw on a legacy row');
  assert(JSON.stringify(csv54[1].slice(9)) === JSON.stringify(['', '', '', '', '']),
    `all five new CSV columns default to '' for a legacy row (got ${JSON.stringify(csv54?.[1]?.slice(9))})`);

  let threw54d = false;
  try { app54.voidObligationById('ob_legacy_un126', 'test'); } catch (e) { threw54d = true; console.error(e); }
  assert(!threw54d, 'voidObligationById() does not throw on a legacy-shaped record');
  assert(storage.getObligations().find(o => o.obligationId === 'ob_legacy_un126').voided === true,
    'voiding a legacy record still works correctly despite its missing fields');

  const legacy54b = { ...legacy54, obligationId: 'ob_legacy_un126_b' };
  storage.saveObligation(legacy54b);
  let threw54e = false;
  try { app54.mergeObligationsById('ob_legacy_un126_b', [legacy54.obligationId]) } catch (e) { threw54e = true; console.error(e); }
  // legacy54 was already voided by the void test just above, so this is
  // also exercising the "already voided, not re-absorbed" no-op path —
  // deliberately reusing it rather than adding a third near-identical fixture.
  assert(!threw54e, 'mergeObligationsById() does not throw when the surviving record is legacy-shaped (no pre-existing mergedFrom array)');

  // ── 54f — RG-10 + wiring: the Data-tab card, mirroring suite 43's pattern
  // for the feedback card. ──────────────────────────────────────────────────
  const corrSection54 = app54.renderObligationCorrectionsAdminSectionHTML();
  assert(/^\s*<div class="admin-section" data-comm-tab="data">/.test(corrSection54),
    'renderObligationCorrectionsAdminSectionHTML() returns markup wrapped in <div class="admin-section" data-comm-tab="data">');
  assert(/id="obcorr-merge-btn"/.test(corrSection54), 'the Merge Selected button is present, disabled by default (0 selected)');
  assert(/obcorr-merge-btn"[^>]*disabled/.test(corrSection54), 'the merge button starts disabled — nothing is selected yet');

  const feedbackPushIdx54 = appJsSrc.indexOf('sections.push(renderFeedbackAdminSectionHTML());');
  const corrPushIdx54 = appJsSrc.indexOf('sections.push(renderObligationCorrectionsAdminSectionHTML());');
  const tiebreakerIdx54 = appJsSrc.indexOf('// Tiebreaker');
  assert(feedbackPushIdx54 > -1 && corrPushIdx54 > -1 && tiebreakerIdx54 > -1 &&
    feedbackPushIdx54 < corrPushIdx54 && corrPushIdx54 < tiebreakerIdx54,
    'Obligation Corrections is pushed directly after Feedback, before the next section, same tab (RG-10)');
  assert(appJsSrc.includes("mergeBtn?.addEventListener('click', () => {"),
    'the merge button is wired inside bindCommEventListeners()');
  assert(appJsSrc.includes(".obcorr-void-btn").length !== 0 &&
    /obcorr-void-btn.*addEventListener\('click', \(\) => handleVoidObligation/.test(appJsSrc.replace(/\n/g, ' ')),
    'each row\'s void button is wired to handleVoidObligation()');
}

// ── 55. RG — the emailed weekly digest's Obligations block ───────────────────
// Two defects in the SAME six lines of buildWeeklySummary(), both found while
// tracing getObligations() call sites:
//   (a) it read o.playerId / o.description / o.kind — three fields that have
//       never existed on an obligation record. The real fields are
//       payerPlayerId / recipientPlayerId / amountOrPrize (+ note on manual
//       entries). Every line rendered "  (unknown): undefined [unpaid]".
//   (b) it read the RAW getObligations(), so a voided record, or one merged
//       away into another, was emailed to the whole league as a live debt.
//       storage.js's own doc comment says getActiveObligations() is "the read
//       every 'what does someone actually owe' surface should use".
//
// Asserted against the RENDERED digest text returned by the real
// buildWeeklySummary(), never by matching app.js source — a source match would
// have passed against the broken code just as happily.
console.log('\n[55] RG — emailed weekly digest: obligations name real people, and only ACTIVE ones ship…');
{
  const app55 = mods['app'];

  // Isolate players — suite 54 left Xena/Yusuf active, and any active player
  // dilutes the picks/standings sections (and could smuggle in an unrelated
  // "(unknown)" that would make the assertions below lie).
  storage.getPlayers().forEach(p => { if (p.active) storage.savePlayer({ ...p, active: false }); });
  storage.addPlayer({ playerId: 'dg_w', displayName: 'Wanda', active: true });
  storage.addPlayer({ playerId: 'dg_l', displayName: 'Leo', active: true });

  const WK55 = { weekId: 'dg_wk', weekNumber: 60, season: 2026, status: 'final',
    dataSourceMode: 'manual', startDate: '2026-11-29', endDate: '2026-11-29',
    actualTiebreakerValue: 50 };
  storage.saveWeek(WK55);
  storage.saveGame({ weekId: 'dg_wk', gameId: 'dg_g1', homeTeam: 'Homer', awayTeam: 'Awaymore',
    kickoff: '2026-11-29T18:00:00Z', status: 'final', homeScore: 28, awayScore: 21,
    spread: -3, lockedSpread: -3 });
  storage.saveAllPicks([...storage.getPicks(),
    { pickId: 'dg_pk_w', weekId: 'dg_wk', gameId: 'dg_g1', playerId: 'dg_w', selectedTeam: 'Homer' },
    { pickId: 'dg_pk_l', weekId: 'dg_wk', gameId: 'dg_g1', playerId: 'dg_l', selectedTeam: 'Awaymore' },
  ]);
  storage.setTiebreakerGuess('dg_wk', 'dg_w', 48);
  storage.setTiebreakerGuess('dg_wk', 'dg_l', 55);

  // THE LIVE DEBT — Leo owes Wanda. This is the one, and the only one, an
  // email to the league is allowed to name.
  const live55 = {
    obligationId: 'dg_ob_live', type: 'weekly', weekId: 'dg_wk',
    payerPlayerId: 'dg_l', recipientPlayerId: 'dg_w',
    amountOrPrize: 'a tall boy', status: 'unpaid',
    createdAt: '2026-11-30T00:00:00.000Z', paidAt: null,
    needsReview: false, reviewNote: null,
    voided: false, voidedAt: null, voidReason: null, mergedInto: null, mergedFrom: [] };
  // A VOIDED duplicate — the commissioner already struck it. Distinctive
  // payload so its presence in the text is unmistakable.
  const voided55 = { ...live55, obligationId: 'dg_ob_voided',
    payerPlayerId: 'dg_w', recipientPlayerId: 'dg_l', amountOrPrize: 'VOIDEDPRIZE',
    voided: true, voidedAt: '2026-11-30T01:00:00.000Z', voidReason: 'bookkeeping duplicate' };
  // A MERGED-AWAY record — absorbed into dg_ob_live, so it is not its own debt.
  const merged55 = { ...live55, obligationId: 'dg_ob_merged',
    amountOrPrize: 'MERGEDPRIZE', voided: true, voidedAt: '2026-11-30T02:00:00.000Z',
    voidReason: 'merged', mergedInto: 'dg_ob_live' };
  [live55, voided55, merged55].forEach(o => storage.saveObligation(o));

  const digest55 = app55.buildWeeklySummary(storage.getWeek('dg_wk'));
  const obBlock55 = /━━━ Obligations ━━━\n([\s\S]*?)(?:\n\n|$)/.exec(digest55)?.[1] ?? '';
  const obLines55 = obBlock55.split('\n').filter(l => l.trim());

  assert(obBlock55.length > 0, 'fixture check: the digest actually renders an Obligations block for this week');

  // (a) — the field-name defect. These are the two strings the broken code
  // produced, verbatim.
  assert(!/\(unknown\)/.test(obBlock55),
    `no obligation line renders "(unknown)" for a player who exists (block was: ${JSON.stringify(obBlock55)})`);
  assert(!/undefined/.test(obBlock55),
    `no obligation line renders the literal "undefined" for its prize (block was: ${JSON.stringify(obBlock55)})`);
  assert(!/undefined|\(unknown\)/.test(digest55),
    'and neither string appears anywhere else in the whole digest either');
  assert(/Leo/.test(obBlock55), 'the obligation line names the PAYER by display name (Leo)');
  assert(/Wanda/.test(obBlock55), 'the obligation line names the RECIPIENT by display name (Wanda) — an email that says who owes but not whom is unusable');
  assert(/a tall boy/.test(obBlock55), 'the obligation line renders amountOrPrize ("a tall boy"), the field that actually holds the prize');
  assert(/\[unpaid\]/.test(obBlock55), 'the payment status is still rendered, unchanged');

  // (b) — the accessor defect. Each is a CONJUNCTION with the live prize
  // actually rendering: "no VOIDEDPRIZE in the text" would otherwise pass
  // vacuously against an implementation that renders no prize at all — which
  // is exactly what the broken code did.
  assert(/a tall boy/.test(obBlock55) && !/VOIDEDPRIZE/.test(digest55),
    'a VOIDED obligation is not emailed to the league as though it were still owed (while the live one IS)');
  assert(/a tall boy/.test(obBlock55) && !/MERGEDPRIZE/.test(digest55),
    'an obligation MERGED AWAY into another is not emailed as a second, separate debt (while the live one IS)');
  assert(obLines55.length === 1,
    `exactly ONE obligation line ships for this week — the live one (got ${obLines55.length}: ${JSON.stringify(obLines55)})`);

  // Legacy rows (predate every UN-126 field) must still ship — absence of
  // `voided` means ACTIVE, not hidden (CONVENTIONS #10).
  storage.saveObligation({ obligationId: 'dg_ob_legacy', type: 'weekly', weekId: 'dg_wk',
    payerPlayerId: 'dg_w', recipientPlayerId: 'dg_l', amountOrPrize: 'LEGACYPRIZE',
    status: 'paid', createdAt: '2026-01-01T00:00:00.000Z', paidAt: null });
  const digestLegacy55 = app55.buildWeeklySummary(storage.getWeek('dg_wk'));
  assert(/LEGACYPRIZE/.test(digestLegacy55),
    'a legacy obligation with NO voided field at all still ships — missing means active, never hidden');
  assert(!/undefined|\(unknown\)/.test(digestLegacy55),
    'and a legacy row renders no "(unknown)"/"undefined" either');

  // A departed player is still named. An obligation outlives someone leaving
  // the league, and "(unknown) owes Wanda" in an email is the same defect in a
  // different costume.
  storage.addPlayer({ playerId: 'dg_gone', displayName: 'Gus', active: false });
  storage.saveObligation({ ...live55, obligationId: 'dg_ob_gone',
    payerPlayerId: 'dg_gone', recipientPlayerId: 'dg_w', amountOrPrize: 'GONEPRIZE' });
  const digestGone55 = app55.buildWeeklySummary(storage.getWeek('dg_wk'));
  assert(/Gus owes Wanda/.test(digestGone55),
    `an INACTIVE (departed) player is still named as the payer, not "(unknown)" (got ${JSON.stringify(digestGone55.split('\n').filter(l => /GONEPRIZE/.test(l)))})`);

  // A week with nothing owed renders no Obligations header at all — the
  // pre-existing behaviour, preserved.
  const WK55b = { ...WK55, weekId: 'dg_wk_clean', weekNumber: 61 };
  storage.saveWeek(WK55b);
  assert(!/━━━ Obligations ━━━/.test(app55.buildWeeklySummary(storage.getWeek('dg_wk_clean'))),
    'a week with no obligations still renders no Obligations section (unchanged)');

  // And a week whose ONLY obligations are voided also renders no section —
  // better than an empty header implying something is owed.
  const WK55c = { ...WK55, weekId: 'dg_wk_allvoid', weekNumber: 62 };
  storage.saveWeek(WK55c);
  storage.saveObligation({ ...voided55, obligationId: 'dg_ob_allvoid', weekId: 'dg_wk_allvoid',
    amountOrPrize: 'ALLVOIDPRIZE' });
  const digestAllVoid55 = app55.buildWeeklySummary(storage.getWeek('dg_wk_allvoid'));
  assert(!/ALLVOIDPRIZE/.test(digestAllVoid55) && !/━━━ Obligations ━━━/.test(digestAllVoid55),
    'a week whose only obligation is voided renders no Obligations section at all, not an empty one');
}

// ── 56. RG — verifyPlayerPin() FAILED OPEN on an account with no pinHash ─────
// Shipped shape:
//     if (!p.pinHash) return true;      // ANY pin passes
// A missing hash was read as "this player hasn't set a PIN, so don't gate them"
// — a reasonable-sounding default that is an authentication bypass. It sat
// harmless only for as long as no real account ever lost its hash.
//
// RG-39 made it live-exploitable: a stale mirror re-applied over the Sheet
// stripped `email` and `pinHash` from every player and pushed the result
// league-wide. Those accounts did not get their PINs "reset" — they stopped
// having a PIN check at all. Anyone past the shared site PIN could sign in as
// anybody and edit their picks.
//
// Drew's ruling, 2026-08-26: FAIL CLOSED. No hash, no login.
//
// These assertions are the reproduction made permanent. They are written
// against verifyPlayerPin()'s RETURN VALUE and the copy the player is actually
// shown — never against the presence of a guard in source (RG-27).
console.log('\n[56] Player PIN verification fails CLOSED…');
{
  const app56 = mods['app'];
  const _players56  = storage.getPlayers();
  const _adminHash56 = storage.getSettings().adminPasswordHash;
  const _session56   = storage.getSession();

  // Every shape a hash-less record actually occurs in. The RG-39 wipe produced
  // the first two; the others are the malformed cases a Sheet round-trip, a
  // hand-edited cell, or a JSON null can hand back. `pinHash: 1234` is what a
  // Sheets cell containing a bare number deserialises to — a NUMBER, which the
  // old truthiness test would have accepted as "has a PIN" while the strict
  // comparison below could never match it.
  const shapes56 = [
    ['no pinHash key at all (the RG-39 wipe)',      { playerId: 'pin_wiped', displayName: 'Wiped', active: true }],
    ['pinHash: "" (a cleared Sheet cell)',          { playerId: 'pin_blank', displayName: 'Blank', active: true, pinHash: '' }],
    ['pinHash: "   " (whitespace only)',            { playerId: 'pin_ws',    displayName: 'Space', active: true, pinHash: '   ' }],
    ['pinHash: null',                               { playerId: 'pin_null',  displayName: 'Null',  active: true, pinHash: null }],
    ['pinHash: 1234 (a number, not base64)',        { playerId: 'pin_num',   displayName: 'Num',   active: true, pinHash: 1234 }],
    ['pinHash: {} (a mangled object)',              { playerId: 'pin_obj',   displayName: 'Obj',   active: true, pinHash: {} }],
  ];
  shapes56.forEach(([, rec]) => storage.addPlayer(rec));
  storage.addPlayer({ playerId: 'pin_ok', displayName: 'Good', active: true, pinHash: btoa('1111') });

  // (a) THE DEFECT. Every broken shape must reject every attempt, including
  // the empty string — `btoa('')` is `''`, so a blank hash compared loosely
  // against a blank entry is a second way in.
  const attempts56 = ['0000', '9999', 'hunter2', '', '1111', 0, null, undefined];
  const opens56 = [];
  for (const [label, rec] of shapes56) {
    for (const a of attempts56) {
      if (storage.verifyPlayerPin(rec.playerId, a) === true) opens56.push(`${label} <- ${JSON.stringify(a)}`);
    }
  }
  assert(opens56.length === 0,
    `NO PIN, NO LOGIN — an account with an absent, empty or malformed pinHash rejects every attempt (accepted: ${opens56.join(' | ') || 'none'})`);

  // (b) …and the gate did not become "reject everything." A real hash still
  // works, and still rejects a wrong PIN. Without this the fix above could be
  // `return false`.
  assert(storage.verifyPlayerPin('pin_ok', '1111') === true,
    'a player WITH a PIN still logs in with the correct one — fail-closed is not fail-always');
  assert(storage.verifyPlayerPin('pin_ok', '9999') === false, 'a wrong PIN is still rejected');
  assert(storage.verifyPlayerPin('pin_ok', '') === false, 'an empty entry against a real hash is rejected');
  assert(storage.verifyPlayerPin('pin_nobody_at_all', '1111') === false, 'an unknown playerId is rejected (unchanged)');

  // (c) THE PLAYER MUST BE TOLD WHAT HAPPENED. A bare "Incorrect PIN" on an
  // account whose PIN a deploy destroyed is a support call, and it reads as the
  // app having eaten their identity — they will swear they typed it right,
  // because they did. This case gets its own copy.
  const noPinMsg56  = app56.loginFailureMessage('pin_wiped');
  const wrongMsg56  = app56.loginFailureMessage('pin_ok');
  assert(noPinMsg56 !== wrongMsg56,
    'a hash-less account and a mistyped PIN produce DIFFERENT messages — the whole point is that the player can tell which happened');
  assert(/no pin/i.test(noPinMsg56) && /commissioner|drew/i.test(noPinMsg56),
    `the hash-less message says a PIN is not set AND who to ask (got "${noPinMsg56}")`);
  assert(!/incorrect|wrong/i.test(noPinMsg56),
    'the hash-less message does not blame the player for typing it wrong — they did not');
  assert(/incorrect pin/i.test(wrongMsg56),
    `a genuinely mistyped PIN still says so plainly (got "${wrongMsg56}")`);
  // Every broken shape routes to the explanatory copy, not just the missing-key
  // one — otherwise a blank-hash account still gets the misleading message.
  const mislabelled56 = shapes56.filter(([, rec]) => app56.loginFailureMessage(rec.playerId) !== noPinMsg56)
    .map(([label]) => label);
  assert(mislabelled56.length === 0,
    `every hash-less shape gets the explanatory message, not "Incorrect PIN" (mislabelled: ${mislabelled56.join(' | ') || 'none'})`);
  assert(app56.loginFailureMessage('pin_nobody_at_all') === wrongMsg56,
    'an unknown playerId falls back to the generic message — it does not advertise which ids exist');

  // (f) THE CALL SITE. Everything above tests PARTS: a predicate and a string.
  // Neither proves the login screen uses either one. Before this block,
  // verifyPlayerPin() had exactly ONE caller in the entire app — the `doLogin`
  // closure inside bindLoginScreen() — and that caller was unreachable from the
  // harness, so replacing the check with `if (true)` passed a fully green suite.
  // An authentication gate whose only coverage is a predicate nobody proves is
  // called is the RG-27 shape at the worst possible place.
  //
  // So this drives the REAL handler through a fixture DOM and asserts on what
  // the user actually gets: the session that is granted, and the toast that is
  // shown. It also catches the seam being silently unwired — a `doLogin` that
  // hardcodes '❌ Incorrect PIN' instead of calling loginFailureMessage() is
  // invisible to (c) and red here.
  {
    const _getEl = document.getElementById, _qsa = document.querySelectorAll;
    const _create = document.createElement, _body = document.body, _scrollTo = globalThis.scrollTo;
    const toasts56 = [];
    let tileClick56 = null, submitClick56 = null;
    const pinInput56 = { value: '', focus() {}, addEventListener() {} };
    const fakeTile56 = {
      dataset: { playerId: null },
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(ev, fn) { if (ev === 'click') tileClick56 = fn; },
    };
    const els56 = {
      'pin-area':          { style: {} },
      'selected-name':     { textContent: '' },
      'pin-input':         pinInput56,
      'pin-submit-btn':    { addEventListener(ev, fn) { if (ev === 'click') submitClick56 = fn; } },
      'cancel-player-btn': { addEventListener() {} },
      'toast-container':   { appendChild(t) { toasts56.push(String(t.innerHTML || '')); } },
    };
    document.getElementById   = id => (Object.prototype.hasOwnProperty.call(els56, id) ? els56[id] : null);
    document.querySelectorAll = sel => (sel === '.player-tile' ? [fakeTile56] : []);
    document.createElement    = () => ({ className: '', innerHTML: '', style: { cssText: '' }, remove() {} });
    document.body             = Object.assign([], { add() {}, remove() {} }) && { classList: Object.assign([], { add() {}, remove() {} }) };
    globalThis.scrollTo       = () => {};

    // Drive the screen exactly as a player does: tap your tile, type, submit.
    const login56 = (playerId, pin) => {
      toasts56.length = 0;
      storage.setSession(null, false, false);
      fakeTile56.dataset.playerId = playerId;
      tileClick56 = null; submitClick56 = null;
      app56.bindLoginScreen();
      tileClick56();
      pinInput56.value = pin;
      submitClick56();
      return { toast: toasts56.join(' '), session: storage.getSession() };
    };

    try {
      const wrong56 = login56('pin_ok', '9999');
      assert(wrong56.session.playerId !== 'pin_ok' && wrong56.session.playerVerified !== true,
        'a WRONG PIN at the real login screen grants no session');
      assert(/incorrect pin/i.test(wrong56.toast),
        `…and says so (got "${wrong56.toast}")`);

      // THE BYPASS, at the call site. This is the exact thing that was live.
      const wiped56 = login56('pin_wiped', '0000');
      assert(wiped56.session.playerId !== 'pin_wiped' && wiped56.session.playerVerified !== true,
        'THE BYPASS AT THE CALL SITE: an account whose pinHash a deploy destroyed cannot be signed into from the login screen with an arbitrary PIN');
      assert(/no pin/i.test(wiped56.toast) && /commissioner|drew/i.test(wiped56.toast),
        `…and that player is TOLD what happened AT THE SCREEN, not merely by a function nothing calls (got "${wiped56.toast}")`);

      // …and the door still opens. Without this, `if (false)` would pass.
      const good56 = login56('pin_ok', '1111');
      assert(good56.session.playerId === 'pin_ok' && good56.session.playerVerified === true,
        'the CORRECT PIN still signs in from the real screen — the gate is closed, not welded shut');
    } finally {
      document.getElementById = _getEl; document.querySelectorAll = _qsa;
      document.createElement = _create; document.body = _body; globalThis.scrollTo = _scrollTo;
      storage.setSession(null, false, false);
    }
  }

  // (d) THE LOCKOUT PROOF. Fail-closed is only safe if the commissioner can
  // still get in and re-issue PINs. Two independent properties:
  //
  //   1. Commissioner credentials do not live on a player record. RG-39 wiped
  //      fields off `cfbp_players`; if admin auth read anything from there,
  //      failing closed would have locked Drew out of the one panel that fixes
  //      it. Asserted at the limit — EVERY player record gone.
  storage.saveSetting('adminPasswordHash', btoa('lockout_probe_pw'));
  localStorage.setItem('cfbp_players', '[]');
  assert(storage.getPlayers().length === 0,
    'fixture check: every player record is gone — the RG-39 wipe taken to its limit');
  assert(btoa('lockout_probe_pw') === storage.getSettings().adminPasswordHash,
    'THE LOCKOUT PROOF: the exact comparison the commissioner login evaluates still succeeds with ZERO player records — admin auth lives in settings, never on a player row');

  //   2. Setting a player's PIN requires no working player PIN. The reset flow
  //      is reachable from an admin session that has never verified a player
  //      (playerId null, playerVerified false) — which is what a commissioner
  //      who cannot log in as themselves actually has.
  storage.setSession(null, true, false);
  assert(storage.getSession().isAdmin === true && !storage.getSession().playerVerified,
    'fixture check: an admin session with NO verified player is a real, reachable state');
  storage.addPlayer({ playerId: 'pin_locked', displayName: 'Locked Out', active: true });
  assert(storage.verifyPlayerPin('pin_locked', '4321') === false, 'the account starts locked out, as designed');
  storage.setPlayerPin('pin_locked', '4321');
  assert(storage.verifyPlayerPin('pin_locked', '4321') === true,
    'RECOVERY: with commissioner credentials alone — no player PIN anywhere in the session — a PIN can be set and the account logs in again');
  assert(storage.verifyPlayerPin('pin_locked', '0000') === false, 'and the newly-set PIN gates correctly');

  // (e) The site PIN is a separate layer and is untouched by any of this.
  storage.saveSetting('sitePin', '7788');
  assert(storage.verifySitePin('7788') === true && storage.verifySitePin('7789') === false,
    'the site PIN gate is unchanged — this fix narrows player auth only');

  // restore
  storage.saveSetting('sitePin', '');
  storage.saveSetting('adminPasswordHash', _adminHash56);
  localStorage.setItem('cfbp_players', JSON.stringify(_players56));
  storage.setSession(_session56.playerId, _session56.isAdmin, _session56.playerVerified);
}

// ── 57. UN-127 item 1 (RG-42) — tiebreaker label reads in every theme ───────
// Brayden reported "Your Tiebreaker Guess" (submitted Picks view) as
// yellow-on-yellow. Root cause: .tiebreaker-label set color:var(--gold)
// while its parent .tiebreaker-card sits on background:var(--gold-pale) —
// and --gold vs --gold-pale is a LOW-CONTRAST PAIR IN EVERY THEME, from
// 2.48:1 in the default theme down to ~1.05:1 (functionally invisible) in
// Sooner and Razorback. Drew's follow-up note ("I believe it's theme
// dependent") describes the visible SEVERITY varying by theme — it does,
// dramatically — not the defect being confined to one theme; every theme
// fails WCAG AA (4.5:1) with the old token, confirmed in (c) below.
//
// The harness has no layout engine or computed styles — it cannot ask a
// browser what color actually painted, and cannot catch a browser-only
// failure mode (font substitution, a higher-specificity rule elsewhere,
// etc.). What it CAN do, and does below, is recompute the same WCAG
// relative-luminance contrast ratio a browser would, against the ACTUAL
// hex values checked into css/styles.css for every theme. That is a real
// mathematical check on the shipped colors — not a name-match — but it is
// still labeled [structural]. Real-device confirmation still needed: Drew
// should eyeball the submitted-picks tiebreaker card on EVERY theme, with
// Sooner and Razorback (the two worst on paper) the highest priority.
console.log('\n[57] UN-127 item 1 (RG-42) — tiebreaker label reads in every theme…');
{
  function relLum([r, g, b]) {
    const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const [R, G, B] = [f(r), f(g), f(b)];
    return 0.2126 * R + 0.7152 * G + 0.0722 * B;
  }
  function hexToRgb(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const n = parseInt(hex, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function contrastRatio(hexA, hexB) {
    const L1 = relLum(hexToRgb(hexA)), L2 = relLum(hexToRgb(hexB));
    const [light, dark] = L1 > L2 ? [L1, L2] : [L2, L1];
    return (light + 0.05) / (dark + 0.05);
  }
  function extractToken(block, name) {
    if (!block) return null;
    const m = block.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{3,6})`));
    return m ? m[1] : null;
  }

  // (a) The element is actually WIRED to the new token — not just co-present
  // with it somewhere unrelated in the file (RG-27 / "presence is not
  // correctness").
  const labelRuleMatch = cssSrc.match(/\.tiebreaker-label\{[^}]*\}/);
  assert(!!labelRuleMatch, '.tiebreaker-label rule exists in styles.css');
  const labelRule = labelRuleMatch ? labelRuleMatch[0] : '';
  assert(/color:var\(--gold-text\)/.test(labelRule),
    '.tiebreaker-label reads its color from --gold-text, not the raw --gold accent token');
  assert(!/color:var\(--gold\)[;}]/.test(labelRule),
    '.tiebreaker-label no longer reads color:var(--gold) directly (the broken pairing)');

  // (b)+(c) Every theme, by name, old pairing vs new pairing.
  const rootBlock = cssSrc.match(/:root\s*\{[^}]*\}/)?.[0] || '';
  const themeBlocks57 = { 'root/aggie (default)': rootBlock };
  for (const key of ['sooner', 'trojan', 'irish', 'boilermaker', 'razorback', 'neutral']) {
    themeBlocks57[key] = cssSrc.match(new RegExp(`body\\.theme-${key}\\s*\\{[^}]*\\}`))?.[0] || '';
  }
  const rows57 = Object.entries(themeBlocks57).map(([theme, block]) => {
    const goldPale = extractToken(block, 'gold-pale') || extractToken(rootBlock, 'gold-pale');
    const gold     = extractToken(block, 'gold')      || extractToken(rootBlock, 'gold');
    const goldText = extractToken(block, 'gold-text');
    return {
      theme,
      oldRatio: (gold && goldPale) ? contrastRatio(gold, goldPale) : null,
      newRatio: (goldText && goldPale) ? contrastRatio(goldText, goldPale) : null,
      goldText, goldPale,
    };
  });
  console.log('  theme            old(--gold/--gold-pale)   new(--gold-text/--gold-pale)');
  rows57.forEach(r => console.log(
    `  ${r.theme.padEnd(16)} ${(r.oldRatio?.toFixed(2) + ':1').padEnd(26)} ${r.newRatio?.toFixed(2)}:1`));

  const missing57 = rows57.filter(r => !r.goldText).map(r => r.theme);
  assert(missing57.length === 0,
    `every theme defines its own --gold-text (missing: ${missing57.join(', ') || 'none'})`);

  assert(rows57.every(r => r.oldRatio !== null && r.oldRatio < 4.5),
    '[structural] confirms the OLD --gold/--gold-pale pairing failed WCAG AA (4.5:1) in EVERY theme, not just the one Brayden happened to report — motivates the token-level fix over a one-theme patch');

  const failing57 = rows57.filter(r => r.newRatio === null || r.newRatio < 4.5).map(r => `${r.theme} (${r.newRatio?.toFixed(2)}:1)`);
  assert(failing57.length === 0,
    `[structural] every theme's --gold-text clears 4.5:1 against its OWN --gold-pale after the fix (failing: ${failing57.join(', ') || 'none'}) — proves the fix didn't help one theme at another's expense`);

  const worst57 = rows57.slice().sort((a, b) => (a.oldRatio ?? 99) - (b.oldRatio ?? 99)).slice(0, 2).map(r => r.theme);
  assert(worst57.includes('sooner') && worst57.includes('razorback'),
    `Sooner and Razorback are confirmed the two most severely broken themes pre-fix (near-1:1, functionally invisible) — got worst two: ${worst57.join(', ')}`);

  // (d) RG-44 — .rank-badge, the SECOND instance of the identical broken pair,
  // flagged by (d)'s previous form as a known-unfixed follow-up and now closed.
  // It renders the "#12 AP" chip in Alma Mater Rankings (app.js
  // renderAlmaMaterRankings), measured at 1.04:1 in Razorback and 1.05:1 in
  // Sooner — the same functionally-invisible pairing, on a different element.
  //
  // This is NOT asserted by matching the token's NAME. The rule's own two
  // tokens are EXTRACTED from the shipped CSS and the WCAG ratio recomputed
  // between them, per theme — so swapping .rank-badge to some third pairing
  // later gets re-measured rather than silently accepted because the string
  // "--gold-text" happens to appear.
  const rankRuleMatch = cssSrc.match(/\.rank-badge\{[^}]*\}/);
  assert(!!rankRuleMatch, '.rank-badge rule exists in styles.css');
  const rankRule = rankRuleMatch ? rankRuleMatch[0] : '';
  const rankFg = (rankRule.match(/color:var\(--([\w-]+)\)/) || [])[1] || null;
  const rankBg = (rankRule.match(/background:var\(--([\w-]+)\)/) || [])[1] || null;
  assert(rankFg !== null && rankBg !== null,
    `.rank-badge declares both its text and background as theme tokens, never hardcoded (CONVENTIONS #13) — got color=--${rankFg}, background=--${rankBg}`);
  assert(rankFg !== 'gold',
    '.rank-badge no longer reads color:var(--gold) — that is the pairing RG-42 was raised for, and it is the same defect on a second element');

  const rankRows57 = Object.entries(themeBlocks57).map(([theme, block]) => {
    const fg = extractToken(block, rankFg) || extractToken(rootBlock, rankFg);
    const bg = extractToken(block, rankBg) || extractToken(rootBlock, rankBg);
    const oldFg = extractToken(block, 'gold') || extractToken(rootBlock, 'gold');
    return {
      theme,
      ratio: (fg && bg) ? contrastRatio(fg, bg) : null,
      oldRatio: (oldFg && bg) ? contrastRatio(oldFg, bg) : null,
    };
  });
  console.log(`  .rank-badge      old(--gold/--${rankBg})          new(--${rankFg}/--${rankBg})`);
  rankRows57.forEach(r => console.log(
    `  ${r.theme.padEnd(16)} ${(r.oldRatio?.toFixed(2) + ':1').padEnd(26)} ${r.ratio?.toFixed(2)}:1`));

  const rankWorst57 = rankRows57.slice().sort((a, b) => (a.oldRatio ?? 99) - (b.oldRatio ?? 99)).slice(0, 2);
  assert(rankWorst57.every(r => (r.oldRatio ?? 99) < 1.1),
    `[structural] confirms the reported severity: the OLD --gold pairing on .rank-badge measured under 1.1:1 — functionally invisible — in its two worst themes (${rankWorst57.map(r => `${r.theme} ${r.oldRatio?.toFixed(2)}:1`).join(', ')})`);

  const rankFailing57 = rankRows57.filter(r => r.ratio === null || r.ratio < 4.5).map(r => `${r.theme} (${r.ratio?.toFixed(2)}:1)`);
  assert(rankFailing57.length === 0,
    `[structural] .rank-badge clears WCAG AA (4.5:1) against its OWN background in every one of the seven themes (failing: ${rankFailing57.join(', ') || 'none'})`);
}

// ── 58. UN-127 item 2 — bottom-nav positioning: ruled-out mechanisms stay ruled out ──
// Drew reports the bottom nav detaching and floating to mid-screen when he
// scrolls UP — never reproduced across 16 desktop configurations, and his
// report of it on a PLAIN scroll contradicts the primer's standing iOS-
// soft-keyboard hypothesis.
//
// Investigated by reading source, not guessing:
//   - .bottom-nav is position:fixed;bottom:0. A fixed element detaches from
//     the VIEWPORT unless an ANCESTOR establishes its own containing block
//     via transform/filter/backdrop-filter/perspective/will-change/contain.
//     .bottom-nav's only ancestors (index.html) are html > body >
//     .page-wrapper. None of those four carry any hijacking property
//     anywhere in styles.css — checked exhaustively below.
//   - No scroll listener anywhere in app.js or chat-ui.js references
//     .bottom-nav or .nav-item; the only scroll listeners in the app drive
//     an unrelated horizontal overflow-fade cue and chat auto-scroll.
//
// CONCLUSION: no code-level mechanism in this app reproduces the report.
// Per instructions, NOT shipping a speculative CSS change to the nav every
// player uses on every screen. Most likely mechanism, given no code-level
// cause and the specific "scroll UP" detail: iOS Safari's dynamic toolbar /
// visual-viewport resize animation — a WebKit rendering quirk that exists
// ONLY in an in-browser tab (collapsing/expanding Safari chrome), not in the
// installed home-screen PWA (manifest.json display:"standalone" has no
// toolbar to collapse at all). Browser-tab vs. installed-app is the single
// most useful thing a real device check can resolve; source cannot answer
// it. [structural] — this suite proves the ruled-out mechanisms STAY ruled
// out going forward; it cannot observe an actual repaint or confirm/deny
// the WebKit hypothesis. A real device is still required.
console.log('\n[58] UN-127 item 2 — bottom-nav positioning: ruled-out mechanisms stay ruled out…');
{
  function allRuleBodies(selector) {
    const escaped = selector.replace(/[.]/g, '\\.');
    const re = new RegExp(`(^|[^a-zA-Z0-9_-])${escaped}\\s*\\{([^}]*)\\}`, 'g');
    const out = [];
    let m; while ((m = re.exec(cssSrc))) out.push(m[2]);
    return out;
  }
  function hasHijackProp(body, prop) {
    return new RegExp(`(^|[;{])\\s*${prop}\\s*:`).test(body);
  }
  const ancestorSelectors58 = ['html', 'body', '.page-wrapper', '.main-content'];
  const hijackProps58 = ['transform', 'filter', 'backdrop-filter', 'perspective', 'will-change', 'contain'];
  const offenders58 = [];
  for (const sel of ancestorSelectors58) {
    const bodies = allRuleBodies(sel);
    assert(bodies.length > 0, `sanity: found at least one CSS rule for ${sel} to inspect (found ${bodies.length})`);
    for (const body of bodies) {
      for (const prop of hijackProps58) {
        if (hasHijackProp(body, prop)) offenders58.push(`${sel} { ${prop}: … } — would hijack position:fixed's containing block`);
      }
    }
  }
  assert(offenders58.length === 0,
    `no ancestor of .bottom-nav (html/body/.page-wrapper/.main-content) sets transform/filter/backdrop-filter/perspective/will-change/contain anywhere in styles.css (found: ${offenders58.join(' | ') || 'none'})`);

  assert(/\.bottom-nav\{[^}]*position:fixed[^}]*bottom:0/.test(cssSrc),
    '.bottom-nav is still position:fixed;bottom:0 — unchanged, no speculative repositioning shipped');

  const scrollHandlerBlocks58 = [...appJsSrc.matchAll(/addEventListener\(\s*['"]scroll['"][\s\S]{0,300}/g)].map(m => m[0]);
  assert(scrollHandlerBlocks58.length > 0, 'sanity: app.js has at least one scroll listener to inspect');
  assert(scrollHandlerBlocks58.filter(b => /bottom-nav|nav-item/.test(b)).length === 0,
    'no scroll event listener in app.js references .bottom-nav or .nav-item');
  const chatUiScrollBlocks58 = [...chatUiSrc.matchAll(/addEventListener\(\s*['"]scroll['"][\s\S]{0,300}/g)].map(m => m[0]);
  assert(chatUiScrollBlocks58.filter(b => /bottom-nav|nav-item/.test(b)).length === 0,
    'no scroll event listener in chat-ui.js references .bottom-nav or .nav-item either');
}

// ── 59. UN-127 item 3 — feedback submission records without forcing an email ──
// Every previous revision fired mailto: unconditionally on submit. Drew:
// "You can submit a ticket... dont need to send an email unless urgent...
// Right now all submissions make you email." Fix: the record IS the
// submission (already reviewable in the Commissioner panel, UN-123); email
// is now an explicit, default-OFF checkbox for the urgent case only, and it
// is ADDITIVE — checking it must never skip recording the entry.
//
// Driven through the REAL, exported submitFeedback() against a fixture DOM —
// not by grepping for the checkbox's existence in source (RG-27) — so a
// checkbox that renders but is silently ignored by the handler would show up
// here as a failure, not as coverage.
console.log('\n[59] UN-127 item 3 — feedback: recorded always, emailed only if asked…');
{
  const _getEl59 = document.getElementById, _qs59 = document.querySelector, _qsa59 = document.querySelectorAll;
  const _create59 = document.createElement, _location59 = globalThis.location;
  const _feedback59 = storage.getFeedback();
  const _commEmail59 = storage.getSettings().commissionerEmail;

  const nameEl59   = { value: 'Kevin' };
  const bodyEl59   = { value: '' };
  const statusEl59 = { textContent: '' };
  const emailBox59 = { checked: false };
  const kindBtn59  = { dataset: { fbKind: 'bug' }, classList: { remove() {} } };
  const toasts59 = [];
  const els59 = {
    'fb-name': nameEl59, 'fb-body': bodyEl59, 'fb-status': statusEl59, 'fb-also-email': emailBox59,
    'toast-container': { appendChild(t) { toasts59.push(String(t.innerHTML || '')); } },
  };
  document.getElementById = id => (Object.prototype.hasOwnProperty.call(els59, id) ? els59[id] : null);
  document.querySelector = sel => (sel === '#fb-kind-group .pick-btn.selected' ? kindBtn59 : null);
  document.querySelectorAll = sel => (sel === '#fb-kind-group .pick-btn' ? [kindBtn59] : []);
  document.createElement = () => ({ className: '', innerHTML: '', style: { cssText: '' }, remove() {} });
  globalThis.location = { href: '', origin: 'https://irbfootball.com', pathname: '/index.html' };
  globalThis.window.location = globalThis.location;

  try {
    storage.saveSetting('commissionerEmail', 'drew@example.com');

    // (a) DEFAULT: box unchecked. Submitting must still record the entry —
    // and must NOT touch window.location (no mailto attempted at all).
    emailBox59.checked = false;
    bodyEl59.value = 'The nav floats when I scroll up';
    kindBtn59.dataset.fbKind = 'bug';
    const before59a = storage.getFeedback().length;
    app.submitFeedback();
    const after59a = storage.getFeedback();
    assert(after59a.length === before59a + 1, 'submitting with the email box unchecked still records the entry');
    assert(after59a[after59a.length - 1].body === 'The nav floats when I scroll up',
      'the recorded entry carries the actual text the player typed');
    assert(globalThis.location.href === '', 'DEFAULT (unchecked): no mailto: is attempted — window.location.href is untouched');
    assert(!/mail client/i.test(statusEl59.textContent),
      `DEFAULT status copy does not claim to have opened a mail client (got "${statusEl59.textContent}")`);
    assert(/review panel|commissioner/i.test(statusEl59.textContent),
      `DEFAULT status copy tells the player it's recorded and reviewed (got "${statusEl59.textContent}")`);

    // (b) EXPLICITLY CHECKED + an email is configured: mailto SHOULD fire —
    // additively, not instead of recording.
    emailBox59.checked = true;
    bodyEl59.value = 'Feature idea: dark mode';
    kindBtn59.dataset.fbKind = 'feature';
    globalThis.location.href = '';
    const before59b = storage.getFeedback().length;
    app.submitFeedback();
    assert(storage.getFeedback().length === before59b + 1,
      'submitting with the box CHECKED still records the entry (email is additive, not instead-of)');
    assert(/^mailto:drew(%40|@)example\.com/.test(globalThis.location.href),
      `CHECKED + commissioner email configured: a mailto: to the Commissioner IS attempted (got "${globalThis.location.href}")`);
    assert(/mail client/i.test(statusEl59.textContent),
      `CHECKED status copy confirms the mail client opened (got "${statusEl59.textContent}")`);
    assert(emailBox59.checked === false,
      'the checkbox resets to its default-OFF state after a submission, so the next one does not silently inherit it');

    // (c) CHECKED but no commissioner email on file: unchanged fallback —
    // still no mailto attempted (nothing to send to), entry still recorded.
    storage.saveSetting('commissionerEmail', '');
    emailBox59.checked = true;
    bodyEl59.value = 'Another idea';
    globalThis.location.href = '';
    app.submitFeedback();
    assert(globalThis.location.href === '', 'CHECKED but no Commissioner email on file: still no mailto attempted (nothing to send to)');
    assert(/no commissioner email/i.test(statusEl59.textContent),
      `and the player is told why (got "${statusEl59.textContent}")`);
  } finally {
    document.getElementById = _getEl59; document.querySelector = _qs59; document.querySelectorAll = _qsa59;
    document.createElement = _create59; globalThis.location = _location59; globalThis.window.location = _location59;
    storage.saveSetting('commissionerEmail', _commEmail59 || '');
    localStorage.setItem('cfbp_feedback', JSON.stringify(_feedback59));
  }
}

// ── 60. UN-127 item 4 (RELOCATED 2026-08-27, Drew's explicit ruling) — the
//        header feedback shortcut now lives UNDER THE WEEK (#header-meta),
//        not .header-right ────────────────────────────────────────────────
// Drew's original ask was volume ("everyone submits a lot") plus placement:
// "left side under the week." A first pass put the button in .header-right
// instead, reasoning UN-117's two-line week-heading guarantee couldn't
// absorb it without a third stacked line — but that reasoning was never put
// back to Drew before shipping. It has been now, and his ruling is: put it
// under the week, as he originally asked; he chose that over keeping it in
// the header cluster. This suite proves:
//   (a)+(b) the button now injects into #header-meta — the week's own left
//       slot — as a SIBLING of the week text, never inside it, and injection
//       is still idempotent;
//   (c) it is still never tab-gated (reach is still the whole point);
//   (d) its click behavior is unchanged — real navigation + scrollIntoView()
//       + focus(), asserted against actual rendered markup, never by
//       name-matching the handler;
//   (e) the two-line guarantee ITSELF — #header-meta is a flex ROW, never
//       column, never wrapping — so the button is structurally incapable of
//       becoming a third stacked line, whatever the week text does; and
//   (f) the actual DECOUPLING mechanism that keeps the injected button from
//       being wiped out on every subsequent week/tab refresh: refreshHeader()
//       targets a DIFFERENT element (#header-meta-week) than
//       setupHeaderFeedbackButton() targets (#header-meta itself) — proven
//       both in source and behaviorally, by mutating the week-text element
//       repeatedly and confirming the button survives.
console.log('\n[60] UN-127 item 4 (relocated) — feedback shortcut moved under the week…');
{
  const _getEl60 = document.getElementById, _qs60 = document.querySelector, _qsa60 = document.querySelectorAll;
  const _create60 = document.createElement, _body60 = document.body;

  function genericFake60() {
    const listeners = {};
    return {
      id: '', className: '', innerHTML: '', textContent: '', value: '', title: '', hidden: false,
      style: {}, dataset: {},
      classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
      addEventListener(ev, fn) { listeners[ev] = fn; },
      _fire(ev) { listeners[ev]?.(); },
      removeEventListener(){}, appendChild(){}, remove(){},
      querySelector(){ return null; }, querySelectorAll(){ return []; },
      setAttribute(){},
    };
  }
  const headerMetaChildren60 = [];
  // #header-meta: the real injection host, tracking JS-appended children.
  // #header-meta-week: a GENUINELY SEPARATE object, mirroring the real
  // nested markup (index.html) where the week text lives in its own child
  // element and #header-meta is the outer flex-row host. This separation is
  // the fixture-level mirror of proof (f) below.
  const hostEl60 = { id: 'header-meta', appendChild(el) { headerMetaChildren60.push(el); } };
  const weekSpanEl60 = genericFake60();
  const identityBtn60 = genericFake60();
  const pageRulesEl60 = Object.assign(genericFake60(), { id: 'page-rules' });
  const fbBodySpy60 = Object.assign(genericFake60(), { id: 'fb-body', _focusCalls: 0, focus() { this._focusCalls++; } });
  const feedbackCardSpy60 = Object.assign(genericFake60(), { _scrollCalls: 0, scrollIntoView() { this._scrollCalls++; } });

  document.body = { classList: { add(){}, remove(){} }, appendChild(){}, innerHTML: '', dataset: {} };
  document.createElement = () => genericFake60();
  document.getElementById = id => {
    if (id === 'page-rules') return pageRulesEl60;
    if (id === 'fb-body') return fbBodySpy60;
    if (id === 'header-identity') return identityBtn60;
    if (id === 'header-meta') return hostEl60;
    if (id === 'header-meta-week') return weekSpanEl60;
    if (id === 'header-feedback-btn') return headerMetaChildren60.find(el => el.id === 'header-feedback-btn') || null;
    return genericFake60();   // every other id: harmless throwaway target
  };
  document.querySelector = sel => {
    if (sel === '.feedback-card') return feedbackCardSpy60;
    return null;
  };
  document.querySelectorAll = () => [];

  try {
    // (a)+(b) Injection target + idempotency: #header-meta, NOT .header-right.
    app.setupHeaderFeedbackButton();
    assert(headerMetaChildren60.length === 1, 'setupHeaderFeedbackButton() appends exactly one element to #header-meta — the week\'s own left slot, not .header-right');
    const btn60 = headerMetaChildren60[0];
    assert(btn60.id === 'header-feedback-btn', 'the injected element carries id="header-feedback-btn"');
    assert(/🗣/.test(btn60.innerHTML), 'the button renders the same 🗣 icon already used for feedback elsewhere');
    assert(!/week-heading/.test(btn60.innerHTML), 'the button carries no week-heading-* class — it is a sibling of the week text, not nested inside it');
    app.setupHeaderFeedbackButton();
    app.setupHeaderFeedbackButton();
    assert(headerMetaChildren60.length === 1,
      'calling setup again (e.g. a second boot() in the same session) does not append a second button — idempotent');

    // (e) Layout guarantee. AMENDED 2026-09-09 (DI-A1): UN-117's original
    // "never a third stacked line" is narrowed to "unless explicitly
    // requested." Drew explicitly requested the Feedback button on its own
    // line beneath the week's date range, so #header-meta is now
    // INTENTIONALLY flex-direction:column — the button IS the third stacked
    // line. This assertion is flipped from the pre-amendment guarantee and
    // now pins the column layout, so a silent revert to a row fails here.
    const headerMetaRule60 = (cssSrc.match(/\.header-meta\{[^}]*\}/) || [''])[0];
    assert(/display:\s*flex/.test(headerMetaRule60),
      `[structural] #header-meta is display:flex — got "${headerMetaRule60}"`);
    assert(/flex-direction:\s*column/.test(headerMetaRule60),
      '[structural] #header-meta is flex-direction:column — DI-A1 (2026-09-09) intentionally stacks the Feedback button as a third line beneath the week text (UN-117 amended)');
    assert(!/flex-wrap:\s*wrap\b/.test(headerMetaRule60),
      '[structural] #header-meta does not set flex-wrap — the three stacked lines come from flex-direction:column (DI-A1), not from wrapping, so no unintended reflow of the stacked lines');
    // UN-117's own two-line internals (name+badge line, date-range line) are
    // untouched by this batch — re-confirmed here (suite [35] already proves
    // this in full) so a regression on THIS specific guarantee fails right
    // next to the change that could cause it, not three suites away.
    assert(/\.week-heading-dates\{[^}]*display:block/.test(cssSrc.replace(/\s+/g, '')) || /\.week-heading-dates\{[^}]*display:block/.test(cssSrc),
      '[structural] the week name/date-range split itself is untouched — still block-level, still forces exactly two lines inside the week text');

    // (f) The decoupling mechanism, proven in TWO parts. First, source: the
    // function that rewrites the week text (refreshHeader()) must target a
    // DIFFERENT element than the one this button was appended into.
    const refreshHeaderBody60 = (appJsSrc.match(/function refreshHeader\(\)\s*\{[\s\S]*?\n\}/) || [''])[0];
    assert(refreshHeaderBody60.length > 0, 'refreshHeader() located in js/app.js');
    assert(/getElementById\('header-meta-week'\)/.test(refreshHeaderBody60),
      '[structural] refreshHeader() targets #header-meta-week — a DIFFERENT element than #header-meta, which is what actually keeps the injected button alive across every week/tab refresh');
    assert(!/getElementById\('header-meta'\)/.test(refreshHeaderBody60),
      '[structural] refreshHeader() no longer targets #header-meta directly — that would wipe the button via innerHTML replacement on the very next refresh');
    // Second, behavior: mutate #header-meta-week repeatedly, exactly the way
    // refreshHeader() does on every tab switch / week change, and confirm
    // the button (tracked on the SEPARATE #header-meta host object) survives.
    for (let i = 0; i < 5; i++) { weekSpanEl60.innerHTML = `<span class="week-heading week-heading-inline">refresh ${i}</span>`; }
    assert(headerMetaChildren60.length === 1 && !!document.getElementById('header-feedback-btn'),
      'simulating 5 week-text refreshes (mutating #header-meta-week directly) leaves the injected button untouched');

    // (c) Never tab-gated, unlike tz-toggle/theme-toggle — checked against
    // the actual CSS, not just "we didn't add a rule" by assumption.
    const gatedWithFeedback60 = /#tz-toggle\s*,\s*#theme-toggle\s*,?\s*#header-feedback-btn/.test(cssSrc);
    const ownDisplayNone60 = /#header-feedback-btn\s*\{[^}]*display:\s*none/.test(cssSrc);
    assert(!gatedWithFeedback60 && !ownDisplayNone60,
      '[structural] .header-feedback-btn is not folded into the tz/theme tab-gating rule and has no display:none of its own — it shows on every tab the header renders on');

    // (d) Click behavior, driven through the REAL listener captured on the
    // REAL button object — never re-derived, never asserted by handler name.
    // First, force state.currentTab away from 'rules' via the header
    // identity chip's own real (also-exported) click binding, so the click
    // below is DEFINITELY exercising the "navigate to Rules" branch and not
    // silently no-op'ing because we happened to already be there. Wrapped in
    // try/catch: navigateTo('picks') sets state.currentTab BEFORE it renders
    // the picks page, and this suite's fixture DOM has no reason to support
    // that unrelated page — only the state flip matters here.
    app.setupHeaderIdentity();
    try { identityBtn60._fire('click'); } catch {}

    document.body.dataset.tab = '';   // fresh — prove THIS click sets it
    pageRulesEl60.innerHTML = '';     // fresh — prove THIS click renders it
    btn60._fire('click');

    assert(document.body.dataset.tab === 'rules',
      'clicking the header shortcut from a non-Rules tab navigates to Rules (document.body.dataset.tab, the real observable effect of the real navigateTo())');
    assert(/class="[^"]*\bfeedback-card\b[^"]*"/.test(pageRulesEl60.innerHTML) && /id="fb-body"/.test(pageRulesEl60.innerHTML),
      'the Rules tab that actually renders contains the real feedback form (not a stub) — confirms the click lands somewhere the query/focus calls below can find');
    assert(feedbackCardSpy60._scrollCalls >= 1,
      'the click handler calls scrollIntoView() on the feedback card so the player does not have to hunt for it');
    assert(fbBodySpy60._focusCalls >= 1,
      'the click handler focuses the description field so a player can start typing immediately');

    // Clicking again while ALREADY on Rules must not blow away whatever the
    // player has typed — i.e. it must not force a second navigate/re-render.
    const rulesHtmlBefore60 = pageRulesEl60.innerHTML;
    pageRulesEl60.innerHTML = rulesHtmlBefore60 + '<!-- player is mid-draft, do not touch -->';
    btn60._fire('click');
    assert(pageRulesEl60.innerHTML.includes('do not touch'),
      'clicking the shortcut again while ALREADY on Rules does not re-render the tab (an in-progress feedback draft is not silently wiped)');
    assert(feedbackCardSpy60._scrollCalls >= 2 && fbBodySpy60._focusCalls >= 2,
      '…but still scrolls/focuses again — a habitual second tap still lands the player on the form');
  } finally {
    document.getElementById = _getEl60; document.querySelector = _qs60; document.querySelectorAll = _qsa60;
    document.createElement = _create60; document.body = _body60;
  }
}

// ── 61. UN-127 item 5 — theme is signed-in-only; signed out is always neutral ──
// Drew: "Take away the ability to change the theme when not logged in, will
// be too much flipping if multiple people arent logged in. Make the default
// neutral when not logged in." Two independent claims, both asserted against
// the REAL getTheme()/setTheme() (storage.js) and renderThemeToggle()
// (app.js) — not against whether the word "neutral" appears near a session
// check in source:
//   (1) signed out, getTheme() is ALWAYS 'neutral', regardless of any
//       leftover settings.theme value from before this fix, or any leftover
//       player preference that isn't THIS player's (there is no player);
//   (2) signed out, the switching control itself disappears — not merely
//       disabled-looking, actually empty — and calling setTheme() while
//       signed out must not silently repaint the device fallback for the
//       next anonymous viewer (the exact mechanism Drew reported);
//   (3) signed IN, unchanged: the picker renders, and the choice is written
//       to THIS player's own preferences.theme, still following them across
//       devices exactly as before.
console.log('\n[61] UN-127 item 5 — theme is signed-in-only; neutral by default when signed out…');
{
  const _getEl61 = document.getElementById;
  const _players61 = storage.getPlayers();
  const _settings61Theme = storage.getSettings().theme;
  const _session61 = storage.getSession();

  const containerEl61 = { innerHTML: '', querySelector(sel) {
    if (sel === '#theme-select' && /<select/.test(this.innerHTML)) {
      return { addEventListener() {} };
    }
    return null;
  } };
  document.getElementById = id => (id === 'theme-toggle' ? containerEl61 : null);

  try {
    storage.setSession(null, false, false);   // signed OUT

    // (1) A stale device-level settings.theme (leftover from before this fix,
    // or hand-edited) must NOT leak through while signed out.
    storage.saveSetting('theme', 'sooner');
    assert(storage.getTheme() === 'neutral',
      'signed OUT, getTheme() is "neutral" even though settings.theme still holds a stale "sooner" — the device fallback is no longer consulted');

    // (2) The control disappears entirely — not disabled, GONE.
    app.renderThemeToggle();
    assert(containerEl61.innerHTML === '',
      `signed OUT, #theme-toggle renders EMPTY — no picker to flip (got "${containerEl61.innerHTML}")`);

    // setTheme() while signed out must not write the shared device fallback
    // — the exact mechanism that let one anonymous viewer repaint the app
    // for the next. (Defense in depth: the control that called this is
    // already gone per (2); this proves the seam itself is also closed.)
    storage.saveSetting('theme', 'neutral');
    storage.setTheme('trojan');
    assert(storage.getSettings().theme === 'neutral',
      'calling setTheme() while signed out does not overwrite the device-level settings.theme fallback — no more "whoever touched it last" repainting the app for the next anonymous viewer');
    assert(storage.getTheme() === 'neutral', '…and getTheme() is still neutral immediately after that call');

    // (3) Signed IN: unchanged behavior — picker renders, choice follows
    // THIS player via preferences.theme, and is unaffected by whatever
    // settings.theme still holds.
    storage.addPlayer({ playerId: 'theme_p1', displayName: 'Koby', active: true });
    storage.setSession('theme_p1', false, true);   // signed IN as Koby, PIN-verified
    app.renderThemeToggle();
    assert(/<select/.test(containerEl61.innerHTML) && /id="theme-select"/.test(containerEl61.innerHTML),
      'signed IN, the theme picker DOES render');
    storage.setTheme('irish');
    assert(storage.getTheme() === 'irish', 'signed IN, setTheme() takes effect immediately for this player');
    const p61 = storage.getPlayers().find(p => p.playerId === 'theme_p1');
    assert(p61?.preferences?.theme === 'irish',
      "the choice is written to THIS PLAYER's own preferences.theme (not settings.theme) — the CLAUDE.md architecture bullet 4 pattern, so it follows them cross-device");
    assert(storage.getSettings().theme === 'neutral',
      'the device-level settings.theme fallback is untouched by a signed-in choice — confirms items (2)/(3) share one seam, not two');

    // Logging back out must return to neutral immediately, regardless of
    // what this player (or anyone) just chose.
    storage.setSession(null, false, false);
    assert(storage.getTheme() === 'neutral',
      "logging out returns to neutral immediately — Koby's 'irish' choice does not leak to the next anonymous viewer on the same device");
  } finally {
    document.getElementById = _getEl61;
    storage.saveSetting('theme', _settings61Theme || '');
    localStorage.setItem('cfbp_players', JSON.stringify(_players61));
    storage.setSession(_session61.playerId, _session61.isAdmin, _session61.playerVerified);
  }
}

// ── 62. UN-127 (change 2, 2026-08-27) — timezone locked the same way as ─────
//        theme was (suite [61]) ─────────────────────────────────────────────
// Drew's ruling: "yes, lock it." getTimezone()/setTimezone() (storage.js)
// used to keep reading/writing the device-level settings.timezone fallback
// while signed out — the identical shared-device problem the theme lock just
// fixed for theme (one anonymous viewer's choice repainting/re-zoning the
// app for the next). Same pattern applied here: signed out reads the league
// default (DEFAULT_TZ) and writes nothing; signed in is unchanged, still
// player.preferences.tz, still follows the player across devices.
// renderTzToggle() (js/app.js) is hidden while signed out, exactly as
// renderThemeToggle() already is — verified against the REAL exported
// functions, never by name-matching.
//
// Pre-paint check (explicitly asked for in the task): unlike theme,
// index.html carries NO early-render encoding of timezone anywhere. A grep
// across index.html and every js/*.js module for "timezone"/"getTimezone"/
// "DEFAULT_TZ" turns up only storage.js (the seam itself), app.js (the
// toggle + two read call sites), and data-model.js/data-provider.js (the
// TIME_ZONES table and an unrelated comment) — nothing in index.html's
// inline bootstrap ever touched a timezone value. There is no third place
// for suite [63]'s guard to have a timezone equivalent of.
console.log('\n[62] UN-127 change 2 — timezone is signed-in-only; league default when signed out…');
{
  const _getEl62 = document.getElementById;
  const _players62 = storage.getPlayers();
  const _settings62Tz = storage.getSettings().timezone;
  const _session62 = storage.getSession();
  const { DEFAULT_TZ } = mods['data-model'];

  const containerEl62 = { innerHTML: '', querySelectorAll() { return []; } };
  document.getElementById = id => (id === 'tz-toggle' ? containerEl62 : null);

  try {
    storage.setSession(null, false, false);   // signed OUT

    // (1) A stale device-level settings.timezone (leftover from before this
    // fix, or hand-edited) must NOT leak through while signed out.
    storage.saveSetting('timezone', 'ET');
    assert(storage.getTimezone() === DEFAULT_TZ,
      `signed OUT, getTimezone() is the league default ("${DEFAULT_TZ}") even though settings.timezone still holds a stale "ET" — the device fallback is no longer consulted`);

    // (2) The control disappears entirely — not disabled, GONE.
    app.renderTzToggle();
    assert(containerEl62.innerHTML === '',
      `signed OUT, #tz-toggle renders EMPTY — no pills to flip (got "${containerEl62.innerHTML}")`);

    // setTimezone() while signed out must not write the shared device
    // fallback — the exact mechanism that let one anonymous viewer re-zone
    // the app for the next. (Defense in depth: the control that called this
    // is already gone per (2); this proves the seam itself is also closed.)
    storage.saveSetting('timezone', DEFAULT_TZ);
    storage.setTimezone('ET');
    assert(storage.getSettings().timezone === DEFAULT_TZ,
      'calling setTimezone() while signed out does not overwrite the device-level settings.timezone fallback — no more "whoever touched it last" re-zoning the app for the next anonymous viewer');
    assert(storage.getTimezone() === DEFAULT_TZ, '…and getTimezone() is still the league default immediately after that call');

    // (3) Signed IN: unchanged behavior — pills render, choice follows THIS
    // player via preferences.tz, and is unaffected by whatever
    // settings.timezone still holds.
    storage.addPlayer({ playerId: 'tz_p1', displayName: 'Jacob', active: true });
    storage.setSession('tz_p1', false, true);   // signed IN as Jacob, PIN-verified
    app.renderTzToggle();
    const { TIME_ZONES: TIME_ZONES_62 } = mods['data-model'];
    assert(/class="tz-btn/.test(containerEl62.innerHTML)
      && TIME_ZONES_62.every(tz => containerEl62.innerHTML.includes(`data-tz="${tz.key}"`)),
      'signed IN, the timezone pills DO render — one real button per TIME_ZONES entry');
    storage.setTimezone('CT');
    assert(storage.getTimezone() === 'CT', 'signed IN, setTimezone() takes effect immediately for this player');
    const p62 = storage.getPlayers().find(p => p.playerId === 'tz_p1');
    assert(p62?.preferences?.tz === 'CT',
      "the choice is written to THIS PLAYER's own preferences.tz (not settings.timezone) — the same architecture pattern as theme — so it follows them cross-device");
    assert(storage.getSettings().timezone === DEFAULT_TZ,
      'the device-level settings.timezone fallback is untouched by a signed-in choice — confirms (2)/(3) share one seam, not two');

    // Logging back out must return to the league default immediately,
    // regardless of what this player (or anyone) just chose.
    storage.setSession(null, false, false);
    assert(storage.getTimezone() === DEFAULT_TZ,
      "logging out returns to the league default immediately — Jacob's 'CT' choice does not leak to the next anonymous viewer on the same device");
  } finally {
    document.getElementById = _getEl62;
    storage.saveSetting('timezone', _settings62Tz ?? DEFAULT_TZ);
    localStorage.setItem('cfbp_players', JSON.stringify(_players62));
    storage.setSession(_session62.playerId, _session62.isAdmin, _session62.playerVerified);
  }
}

// Source-level confirmation that the lock is the SAME shape as theme's,
// checked against the real storage.js text — getTimezone() must not read
// settings.timezone, getTheme() must not read settings.theme, and both must
// resolve through _playerPref() with a hardcoded league-default fallback.
{
  const getTimezoneBody62 = (storageSrc31.match(/export function getTimezone\(\)\s*\{[\s\S]*?\n\}/) || [''])[0];
  assert(getTimezoneBody62.length > 0, 'getTimezone() located in js/storage.js');
  assert(!/getSettings\(\)\.timezone/.test(getTimezoneBody62),
    '[structural] getTimezone() no longer reads the settings.timezone device-level fallback — matches the shape of the getTheme() fix');
  assert(/_playerPref\('tz'\)\s*\|\|\s*DEFAULT_TZ/.test(getTimezoneBody62),
    '[structural] getTimezone() resolves to _playerPref(\'tz\') || DEFAULT_TZ — a player preference or the hardcoded league default, nothing else');

  const setTimezoneBody62 = (storageSrc31.match(/export function setTimezone\(tzKey\)\s*\{[\s\S]*?\n\}/) || [''])[0];
  assert(setTimezoneBody62.length > 0, 'setTimezone() located in js/storage.js');
  assert(!/saveSetting\('timezone'/.test(setTimezoneBody62),
    '[structural] setTimezone() no longer writes the settings.timezone device-level fallback under any branch');

  const renderTzToggleBody62 = (appJsSrc.match(/export function renderTzToggle\(\)\s*\{[\s\S]*?\n\}/) || [''])[0];
  assert(renderTzToggleBody62.length > 0, 'renderTzToggle() located in js/app.js');
  assert(/if\s*\(!getSession\(\)\?\.playerId\)\s*\{\s*container\.innerHTML\s*=\s*'';?\s*return;?\s*\}/.test(renderTzToggleBody62.replace(/\s+/g,' ')),
    '[structural] renderTzToggle() hides the control while signed out with the identical shape as renderThemeToggle()');
}

// ── 63. UN-127 (change 3, 2026-08-27) — a guard so the theme bootstrap ──────
//        cannot drift a THIRD time ───────────────────────────────────────────
// index.html carries an inline pre-paint script that reimplements getTheme()
// literally, because it runs before the module loads and cannot import. It
// has now gone out of sync with the real getTheme() TWICE — v0.17.4 (flashed
// Aggie maroon, wrong default) and again today (kept reading the
// settings.theme device fallback after getTheme() stopped consulting it,
// so a shared device with a leftover settings.theme flashed a stale palette
// before JS repainted it neutral). The script's own comment says "keep this
// literal in sync"; a comment has now failed twice.
//
// [structural] this suite asserts a PROPERTY the bootstrap must not have —
// "this code does not read settings.theme" — rather than re-deriving its
// exact literal text, so a future edit is free to reshape the script as long
// as it keeps not doing the one thing that broke twice. What it CANNOT
// prove, and what only a real browser can: that the inline script actually
// executes before first paint with zero visible flash on a real device/
// profile with a leftover settings.theme value — this is a static-source
// property check, not a rendered-pixel check.
console.log('\n[63] UN-127 change 3 — theme bootstrap cannot silently reintroduce settings.theme…');
{
  // Isolate the SPECIFIC <script> block (index.html has more than one inline
  // <script> before the module loads — the reveal-page PIN bypass is
  // another). Matched by content, not position, so this stays correct if a
  // script gets reordered.
  const scriptBlocks63 = [...indexHtmlSrc.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const themeBootScript63 = scriptBlocks63.find(s => /theme-'\s*\+\s*key/.test(s)) || '';
  assert(themeBootScript63.length > 0, 'the inline theme-bootstrap <script> block is located in index.html');

  // The property that broke twice: it must NOT read the settings blob at
  // all. cfbp_settings is the ONLY localStorage key settings.theme could
  // ever come from — asserting its absence is stronger and more durable
  // than asserting the literal substring "settings.theme" is absent (which
  // a surrounding HTML COMMENT can innocently contain even when the CODE is
  // correct, as it does above this very script).
  assert(!/cfbp_settings/.test(themeBootScript63),
    '[structural] the theme bootstrap script does not read cfbp_settings (the ONLY source of a settings.theme device-level fallback) anywhere in its executable code');

  // What it MUST do instead: resolve through the session + player
  // preferences chain, with a 'neutral' fallback at both ends (no player
  // found, or no theme set for that player) — the literal shape of
  // getTheme() = _playerPref('theme') || 'neutral'.
  assert(/cfbp_session/.test(themeBootScript63) && /playerId/.test(themeBootScript63),
    '[structural] the bootstrap resolves the SESSION first, the same starting point as getTheme()/_playerPref()');
  assert(/cfbp_players/.test(themeBootScript63) && /preferences/.test(themeBootScript63) && /\.theme/.test(themeBootScript63),
    '[structural] the bootstrap reads the theme off the signed-in PLAYER\'s preferences, not a device-level blob');
  assert((themeBootScript63.match(/'neutral'/g) || []).length >= 2,
    "[structural] 'neutral' is the fallback in BOTH places — no session/player found, AND a found player with no theme preference set — matching getTheme()'s single fallback value");

  // Cross-check against the REAL getTheme() (storage.js), not just the
  // bootstrap's own internal consistency — the two must actually agree on
  // what "the fallback" is.
  const getThemeBody63 = (storageSrc31.match(/export function getTheme\(\)\s*\{[\s\S]*?\n\}/) || [''])[0];
  assert(/_playerPref\('theme'\)\s*\|\|\s*'neutral'/.test(getThemeBody63),
    '[structural] getTheme() itself resolves to _playerPref(\'theme\') || \'neutral\' — the canonical shape this bootstrap must mirror, confirmed independently of the bootstrap\'s own text');
}

// ═════════════════════════════════════════════════════════════════════════════
// 64. [structural] THE BLIND RULE HAS ONE DEFINITION, AND EVERY SURFACE ASKS IT
//
//     WHY THIS EXISTS. The blind rule has now drifted FIVE times: the standard
//     dashboard matrix (UN-116), `pickChip`, `emitExtraPointEvent`, the Extra
//     Point admin card (RG-40), and the commissioner Tiebreaker card (RG-43).
//     Four of the five were found only because a human went looking by hand.
//
//     Every one of the behavioural suites above ([34], [39], [40], [50]) is a
//     per-surface assertion, and a per-surface assertion can only ever cover
//     the surfaces someone thought to enumerate. The rule is enforced by
//     call-site discipline across nine-plus surfaces with NO mechanical
//     guarantee — which is not a rule, it is a habit. A sixth surface added
//     next month is green by default under every existing test in this file.
//
//     So this suite inverts the burden, exactly as gradetest [6] does for the
//     ATS comparison. It is DENY-BY-DEFAULT: any top-level function in app.js
//     or chat-ui.js that reads getPicks / getTiebreakerGuess /
//     getExtraPointGuess for a playerId that is not demonstrably the session's
//     own must EITHER consult canViewOtherPicks()/arePicksPublic(), or appear
//     on a named, justified list below. A new leak is a test failure the day
//     it is written, with no new test needed.
//
//     gradetest [6] scans app.js only — its one weakness. This scans BOTH
//     app.js and chat-ui.js, which is where three of the five recurrences
//     lived (`pickChip`, `emitExtraPointEvent`, `emitGameFinalEvent`).
//
//     WHAT A GREEN RESULT MEANS. "Absent," never "my regex didn't match" —
//     the canaries at the bottom feed the scanner synthetic leaks of every
//     shape this codebase has actually produced (direct, no-playerId,
//     indirect-through-a-local, and gate-only-in-a-comment) and require it to
//     catch each one, plus legal shapes it must NOT flag.
//
//     WHAT IT DOES NOT COVER, stated plainly so nobody mistakes green here for
//     total coverage:
//       - Functions handed already-fetched picks as a PARAMETER rather than
//         reading an accessor (renderDashboardTable, renderDashboardCompact,
//         renderScoreSummaryRowsHTML). They cannot be found by an accessor
//         scan; they are covered behaviourally by [34h]'s surface sweep, and
//         the two suites are complements, not substitutes.
//       - Whether a gate is CORRECT. This proves the predicate is consulted;
//         [34]/[39]/[40]/[50] prove it is consulted correctly. A function that
//         calls arePicksPublic() and ignores the answer passes here.
//       - Files other than app.js and chat-ui.js.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[64] [structural] every surface reading another player\'s submission consults the blind rule…');
{
  // ── The three accessors that can return a submission, and the two predicates
  //    that are the ONLY sanctioned way to decide whether it may be shown.
  const ACCESSORS = ['getPicks', 'getTiebreakerGuess', 'getExtraPointGuess'];
  const GATE = /\b(?:canViewOtherPicks|arePicksPublic)\s*\(/;
  // Expressions that ARE the session's own id. A read scoped to one of these
  // discloses nothing about anybody else and needs no gate.
  const OWN = /^(?:me\(\)|getSession\(\)\.playerId|session\.playerId|sess\.playerId|s\?\.playerId|(?:session|sess)\.playerId\s*&&[\s\S]*)$/;

  /** Blank out comments, preserving line/column structure so offsets stay
   *  meaningful. Prose describing the rule can then never satisfy the scan —
   *  canary C4 below proves it. */
  const blankComments = s => s
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"\\/])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));

  /** Split a file into TOP-LEVEL function regions. Every declaration in these
   *  two files sits at column 0, so a region runs from one declaration to the
   *  next; nested helpers and event handlers fold into their enclosing
   *  top-level function, which is how a reviewer reads them too. */
  function regionsOf(src) {
    const lines = blankComments(src).split('\n');
    const decls = [];
    lines.forEach((l, i) => {
      const m = l.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/);
      if (m) decls.push({ name: m[1], line: i });
    });
    return decls.map((d, i) => ({
      name: d.name,
      body: lines.slice(d.line, i + 1 < decls.length ? decls[i + 1].line : lines.length).join('\n'),
    }));
  }

  /** The argument list of `name(...)`, split at top-level commas. */
  function callArgs(body, name) {
    const out = [];
    const re = new RegExp(String.raw`\b${name}\s*\(`, 'g');
    let m;
    while ((m = re.exec(body))) {
      let depth = 1, i = m.index + m[0].length, start = i, args = [];
      for (; i < body.length && depth > 0; i++) {
        const c = body[i];
        if ('([{'.includes(c)) depth++;
        else if (')]}'.includes(c)) { depth--; if (depth === 0) break; }
        else if (c === ',' && depth === 1) { args.push(body.slice(start, i).trim()); start = i + 1; }
      }
      args.push(body.slice(start, i).trim());
      out.push(args.filter(a => a.length));
    }
    return out;
  }

  /** Is this argument text the session's own player id? Follows ONE level of
   *  indirection through a local binding in the same region, the same depth
   *  gradetest [6] follows — `const self = me(); … getPicks(w, self)` is the
   *  real shape in chat-ui.js and must stay legal. */
  function isOwn(arg, body, depth = 0) {
    if (!arg) return false;
    if (OWN.test(arg)) return true;
    if (!/^[A-Za-z_$][\w$]*$/.test(arg) || depth > 0) return false;
    const binds = [...body.matchAll(new RegExp(String.raw`(?:const|let|var)\s+${arg}\s*=(?!=)\s*([^;\n]*)`, 'g'))]
      .map(b => b[1].trim().replace(/;$/, ''));
    if (!binds.length) return false;
    return binds.every(b => isOwn(b.split('?')[0].trim(), body, depth + 1) || isOwn(b, body, depth + 1));
  }

  /** Every region that reads ANOTHER player's submission — i.e. at least one
   *  accessor call whose player argument is missing (returns the whole
   *  league) or is not demonstrably the viewer's own. */
  function disclosingRegions(src) {
    return regionsOf(src).filter(r =>
      ACCESSORS.some(a => callArgs(r.body, a).some(args => !isOwn(args[1], r.body))));
  }

  // ── THE NAMED LISTS. Deny-by-default: a function reaching the scan must be
  //    gated, or appear here by name with a reason. Widening a regex is not an
  //    option — the only way past the scan is to write the name down.
  //
  //    EXEMPT — genuinely no disclosure to another player.
  const EXEMPT = {
    // Scoring internals: read the whole league's picks to COMPUTE an aggregate
    // (ranks, W–L, obligations). They disclose no selection to anybody.
    finalizeWeek:
      'scoring internal — reads the slate to compute weekly results and obligations for a week being finalized; renders nothing',
    renderLeaderboard:
      'scoring internal — pooled group picks are read only inside `memberWeeks.every(m => m.status === "final")`, a STRICTER condition than arePicksPublic(), and yield a winner/loser aggregate',
    // Aggregate count, no attribution.
    scribeLiveGameCheck:
      'aggregate only — uses `.length` as a "was this game widely picked" threshold on an already-LIVE game; names no player and prints no selection',
    // Self-directed exports. The bright line for this bucket is that the
    // artifact goes to the commissioner's OWN device — his disk or his
    // clipboard — and is not published to anybody else. buildWeeklySummary is
    // NOT in this bucket for exactly that reason; see TRACKED below.
    exportWeekPicksCSV:
      'self-export — commissioner-initiated CSV download to their own device',
    exportWeekResultsCSV:
      'self-export — commissioner-initiated CSV download to their own device',
    exportWeekDashboardCSV:
      'self-export — commissioner-initiated CSV download to their own device',
    renderCommExtrasV16:
      'self-export — the 📋 chat-digest button copies a SCRIBE feed to the commissioner\'s own clipboard; same class as the CSV exports above, and it renders nothing on screen',
    // The disclosure boundary lives one call downstream, and that call gates.
    doRefreshScores:
      'the winner/loser id lists it builds are handed straight to emitGameFinalEvent(), which gates on arePicksPublic() (RG-45) — this function itself renders and publishes nothing',
  };

  //    TRACKED — CONFIRMED TO DISCLOSE, deliberately NOT fixed in this pass.
  //    This bucket is not an excuse; it is a debt register, and the assertion
  //    below PINS each entry as still-ungated so that the day someone fixes
  //    one, this list is forced to be updated rather than quietly rotting.
  //    Precedent: [57](d) tracked .rank-badge exactly this way, and that is
  //    why it was found and closed as RG-44.
  const TRACKED = {
    buildWeeklySummary:
      'LEAK, NOT A FIX FOR TONIGHT — the recap it builds prints every player\'s rank, W–L and TIEBREAKER GUESS by name, and the "Send" button BCCs it to every active player with no week-status gate anywhere. Reachable by a commissioner pressing Send on an open week. NOT gated here because the right behaviour is a commissioner-workflow decision (block the send? warn and confirm? render the email blinded?), which is user-experience\'s call, not a bugfix. FLAGGED TO DREW.',
  };

  const FILES64 = { 'app.js': appJsSrc, 'chat-ui.js': chatUiSrc };

  const offenders64 = [];
  const gatedNames64 = [];
  const seen64 = [];
  for (const [file, src] of Object.entries(FILES64)) {
    for (const r of disclosingRegions(src)) {
      seen64.push(r.name);
      if (GATE.test(r.body)) { gatedNames64.push(`${file}:${r.name}`); continue; }
      if (Object.prototype.hasOwnProperty.call(EXEMPT, r.name)) continue;
      if (Object.prototype.hasOwnProperty.call(TRACKED, r.name)) continue;
      offenders64.push(`${file}:${r.name}`);
    }
  }

  console.log(`  scanned ${Object.keys(FILES64).length} files · ${seen64.length} functions read another player's submission · ${gatedNames64.length} gated · ${Object.keys(EXEMPT).length} exempt · ${Object.keys(TRACKED).length} tracked`);
  console.log(`  gated: ${gatedNames64.join(', ')}`);

  assert(offenders64.length === 0,
    `THE STRUCTURAL GUARD — every function in app.js/chat-ui.js that reads another player's submission either consults canViewOtherPicks()/arePicksPublic() or is named on the exemption list with a reason (unaccounted for: ${offenders64.join(', ') || 'none'})`);

  // The gated set must not silently SHRINK. If a surface that used to ask the
  // predicate stops asking it and gets added to EXEMPT instead, the count moves
  // and this fails — the exemption list cannot be used to launder a regression.
  assert(gatedNames64.length >= 6,
    `all 6 disclosing surfaces that are supposed to consult the blind rule still do (got ${gatedNames64.length}) — pinned so the exemption list can never be used to launder a gate that was removed`);

  // ── LIST HYGIENE. A stale entry is worse than no entry: it is a standing
  //    permission attached to a name, ready to cover whatever is written under
  //    that name next. Every entry must correspond to a function that the scan
  //    actually reaches AND that is actually ungated right now.
  const staleExempt64 = Object.keys(EXEMPT).filter(n => !seen64.includes(n));
  assert(staleExempt64.length === 0,
    `every EXEMPT entry names a function the scan actually reaches — a renamed or gated function must be removed from the list, not left as a standing permission (stale: ${staleExempt64.join(', ') || 'none'})`);
  const staleTracked64 = Object.keys(TRACKED).filter(n => !seen64.includes(n));
  assert(staleTracked64.length === 0,
    `every TRACKED entry still names a real disclosing function (stale: ${staleTracked64.join(', ') || 'none'})`);
  const reasonless64 = [...Object.entries(EXEMPT), ...Object.entries(TRACKED)].filter(([, why]) => !why || why.length < 40).map(([n]) => n);
  assert(reasonless64.length === 0,
    `every exemption carries a written reason, not just a name (reasonless: ${reasonless64.join(', ') || 'none'})`);

  // Each TRACKED entry is PINNED as still-leaking. Fixing one turns this red,
  // which is the point: the debt register cannot silently rot.
  const fixedTracked64 = Object.keys(TRACKED).filter(n => {
    for (const src of Object.values(FILES64)) {
      const r = disclosingRegions(src).find(x => x.name === n);
      if (r && GATE.test(r.body)) return true;
    }
    return false;
  });
  assert(fixedTracked64.length === 0,
    `[debt register] every TRACKED surface is confirmed STILL UNGATED — if one now gates, delete it from TRACKED (newly gated: ${fixedTracked64.join(', ') || 'none'})`);

  // ── CANARIES. A green scan must mean "absent", never "unmatchable". Each
  //    canary is a shape this codebase has actually produced.
  const scanText = src => disclosingRegions(src).filter(r => !GATE.test(r.body)).map(r => r.name);

  // C1 — the direct shape: iterate players, print each one's guess, no gate.
  //      This is RG-40 and RG-43, verbatim in structure.
  const C1 = `
function leakDirect(week, players) {
  return players.map(p => escHtml(p.displayName) + ': ' + getTiebreakerGuess(week.weekId, p.playerId)).join('');
}
`;
  assert(scanText(C1).includes('leakDirect'),
    'canary C1: the direct shape — another player\'s guess read per-player with no gate — is caught');

  // C2 — no playerId argument at all, which returns the WHOLE league. Easy to
  //      miss by eye because nothing in the call names another player.
  const C2 = `
function leakWholeLeague(week) {
  return getPicks(week.weekId).map(p => p.playerId + ' picked ' + p.selectedTeam).join('');
}
`;
  assert(scanText(C2).includes('leakWholeLeague'),
    'canary C2: an accessor called with NO player argument — returning every player\'s picks — is caught');

  // C3 — indirect: the id arrives through a local bound to someone else.
  const C3 = `
function leakIndirect(week, m) {
  const who = m.author;
  const picks = getPicks(week.weekId, who);
  return picks.length ? 'they picked ' + picks[0].selectedTeam : '';
}
`;
  assert(scanText(C3).includes('leakIndirect'),
    'canary C3: an INDIRECT read — another player\'s id via a local — is caught (the shape a "getPicks(w, p.playerId)" regex would miss)');

  // C4 — the gate exists only in a COMMENT. This is the RG-27 false-coverage
  //      shape: a scan that reads prose would pass a surface that does nothing.
  const C4 = `
function leakCommentOnly(week, players) {
  // This surface respects arePicksPublic() and calls canViewOtherPicks(week).
  /* canViewOtherPicks(week) */
  return players.map(p => getExtraPointGuess(week.weekId, p.playerId)).join();
}
`;
  assert(scanText(C4).includes('leakCommentOnly'),
    'canary C4: a function whose ONLY mention of the predicate is in a comment is still caught — prose does not satisfy the scan');

  // C5 — legal shapes that must NOT be flagged, or the guard blocks correct
  //      code and gets deleted by the next author.
  const C5 = `
function okGated(week, players) {
  const canSeeOthers = canViewOtherPicks(week);
  return players.map(p => canSeeOthers ? getPicks(week.weekId, p.playerId) : '•••').join();
}
function okOwnDirect(week) {
  const session = getSession();
  return getPicks(week.weekId, session.playerId).length;
}
function okOwnIndirect(week) {
  const self = me();
  return getTiebreakerGuess(week.weekId, self);
}
`;
  const flaggedC5 = scanText(C5);
  assert(!flaggedC5.includes('okGated'),
    'canary C5a: a properly gated surface is NOT flagged');
  assert(!flaggedC5.includes('okOwnDirect'),
    'canary C5b: reading YOUR OWN submission via session.playerId is NOT flagged — no gate is required to show a player their own picks');
  assert(!flaggedC5.includes('okOwnIndirect'),
    'canary C5c: reading your own via `const self = me()` is NOT flagged — one level of indirection is followed, the real chat-ui.js shape');

  // C6 — the scanner sees the REAL files, not an empty parse. If regionsOf()
  //      or callArgs() silently returned nothing, every assertion above would
  //      pass vacuously; this is the check that makes green mean something.
  assert(seen64.length >= 15,
    `fixture check: the scan actually parsed both real files and found ${seen64.length} disclosing functions — a broken parser would report 0 and pass everything above`);
  assert(seen64.includes('renderDashboardInner') && seen64.includes('pickChip') && seen64.includes('emitPickRevealEvent'),
    'fixture check: the scan reaches the three surfaces that have historically leaked (the standard matrix, the chat pick chip, the reveal ritual) — proof it is looking where the defects have actually been');
}

// ── 65. SCRIBE voice v2.1 retired-tic scan (app-wide) ─────────────────────────
console.log('\n[65] SCRIBE voice v2.1 retired-tic scan (app-wide)…');
{
  // UN-77 (2026-08-13, the "orders" retirement): a single-FILE grep let two
  // live instances of a retired word survive elsewhere in the app — the
  // grep's scope was one file, the register's wasn't. This session's
  // reviewer found the identical shape of miss one level up: js/scribeLines.js
  // was rewritten for the v2.1 voice refresh (retiring "SCRIBE NOTE:" as a
  // reflex opener; "Filed."/"Noted."/"Documented."/"— SCRIBE" as reflex
  // closers; "the chart" as the standings stand-in; and the mock-clinical
  // SOAP-note Assessment:/Plan:/Prognosis: template — docs/SCRIBE.md §6,
  // changelog 2.1) — but js/recap.js, js/extra-point.js and js/chat-ui.js
  // still shipped the retired register after scribeLines.js's OWN pools were
  // already clean. A scan scoped to scribeLines.js alone would have stayed
  // green straight through that exact miss. This scan is deliberately
  // APP-WIDE — every file in js/*.js, not the one file SCRIBE's canned lines
  // happen to live in — so the next retired-register survivor, wherever it
  // ships, cannot hide behind a file boundary again.
  //
  // NOTE for anyone re-running this immediately after this pass: a `scribe`
  // agent was concurrently rewriting recap.js/extra-point.js/one chat-ui.js
  // string when this section was authored — hits in exactly those three
  // files are EXPECTED to still be red until that work lands; re-run once it
  // finishes rather than treating a hit there as this scan misbehaving.
  //
  // Scans STRING/TEMPLATE-LITERAL content by scanning every NON-COMMENT
  // line's raw text — comment lines (trimmed start `*`, `//`, or `/*`) are
  // excluded, mirroring almatest.mjs's scanSettingKeys() prose-exclusion
  // (almatest.mjs:1656) verbatim, so documentation quoting the retired
  // register — this very section's own header, SCRIBE.md's changelog, the
  // ledger — can never make this guard permanently red for describing what
  // it guards against. Both halves of that exclusion are proven by the two
  // canaries below: a live literal IS caught; a commented quotation of the
  // identical text is NOT.
  const jsDir65 = new URL('./js/', import.meta.url);
  const jsFiles65 = (await readdir(jsDir65)).filter(f => f.endsWith('.js')).sort();
  assert(jsFiles65.length >= 14,
    `fixture check: the app-wide scan really enumerated js/*.js (found ${jsFiles65.length} files) — a broken/empty readdir would make every assertion below pass vacuously`);

  const RETIRED_TICS = [
    { name: 'SCRIBE NOTE:', re: /SCRIBE NOTE:/ },
    { name: 'Filed.', re: /\bFiled\./ },
    { name: 'Noted.', re: /\bNoted\./ },
    { name: 'Documented.', re: /\bDocumented\./ },
    { name: '— SCRIBE (reflex closer)', re: /—\s*SCRIBE\b/ },
    { name: 'the chart', re: /\bthe chart\b/i },
    { name: 'Chart Review', re: /Chart Review/ },
    { name: 'permanent record', re: /permanent record/ },
    { name: 'SOAP framing (Assessment:/Plan:/Prognosis: as a line-leading label)', re: /(^|['"`]|[.!?]\s)\s*(Assessment|Plan|Prognosis):/ },
  ];

  function scanSourceForRetiredTics(src) {
    const hits = [];
    src.split('\n').forEach((rawLine, i) => {
      const t = rawLine.trimStart();
      if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return; // prose — see header above
      RETIRED_TICS.forEach(tic => { if (tic.re.test(rawLine)) hits.push({ line: i + 1, tic: tic.name, text: rawLine.trim() }); });
    });
    return hits;
  }

  const allHits65 = [];
  for (const f of jsFiles65) {
    const src = await readFile(new URL(f, jsDir65), 'utf8');
    scanSourceForRetiredTics(src).forEach(h => allHits65.push({ file: f, ...h }));
  }
  if (allHits65.length) {
    console.log(`  … ${allHits65.length} retired-tic hit(s) found (see below) — expected transient for recap.js/extra-point.js/chat-ui.js while the scribe pass is in flight:`);
    allHits65.forEach(h => console.log(`     ${h.file}:${h.line} [${h.tic}] ${h.text}`));
  }
  assert(allHits65.length === 0,
    'app-wide SCRIBE v2.1 retired-tic scan: zero live (non-comment) hits across every js/*.js file — see console output above for exact file:line hits, if any (UN-77 precedent: this scan is app-wide precisely so a fix in one file can never hide a survivor in another)');

  // Canary 1 — a live literal on a real code line IS caught (RG-27: a guard
  // that cannot fail is not a guard).
  const canaryLiveHits65 = scanSourceForRetiredTics('  return `${name} — SCRIBE keeps the receipts.`;');
  assert(canaryLiveHits65.some(h => h.tic === '— SCRIBE (reflex closer)'),
    'canary: a live "— SCRIBE" closer on a real (non-comment) code line IS caught by this scan');

  // Canary 2 — the identical text, inside a comment, is correctly NOT
  // caught. Proves the prose exclusion is narrow (comment lines only) and
  // deliberate, not a loophole that also swallows live code quoting itself.
  const canaryCommentHits65 = scanSourceForRetiredTics('  // e.g. "— SCRIBE keeps the receipts." was the retired closer');
  assert(canaryCommentHits65.length === 0,
    'canary: the identical text, inside a // comment line, is correctly NOT counted — documentation quoting the retired register cannot make this guard permanently red');
}

// ── 66. Items E/F re-review close-out — commissioner UI for two orphaned
//       pilot settings (UN-159 D5 `scribeFeedbackEnabled`, UN-164 F4-interim
//       `chatImagePreviewEnabled`) ───────────────────────────────────────────
// Both settings already had safe defaults in data-model.js DEFAULT_SETTINGS
// and were already on almatest.mjs's bounded-size allow-list; this pass adds
// the missing commissioner toggle to js/app.js's Settings tab, next to the
// existing chatEnabled precedent. RG-10 (an admin-section that renders on
// ALL FIVE commissioner tabs because it isn't scoped to one) is the specific
// hazard for anything added to that card, so this section proves both new
// rows sit inside the SETTINGS container specifically (not just "inside A
// container") via a nearest-preceding-data-comm-tab scan, mirroring [46]'s
// general guard but pinned to these two ids. It also proves the two change
// handlers write through the storage seam, and that the settings-off state
// is honored by each field's own consumer.
console.log('\n[66] Items E/F re-review close-out — SCRIBE feedback + image preview toggles…');
{
  // 66a — locate which tagged admin-section (if any) ACTUALLY CONTAINS a
  // given anchor. A naive "nearest preceding data-comm-tab attribute in
  // source order" heuristic was tried first and is deliberately NOT what
  // ships here: it reports the tab of whichever tagged section happens to
  // appear earliest before the anchor, even when that section has already
  // CLOSED and the anchor is really a later, untagged SIBLING — exactly the
  // classic RG-10 shape (a card appended after a tagged section, sharing no
  // wrapper with it). The mutation drill below caught that heuristic
  // reporting a false "settings" for a sibling card outside every tagged
  // section, which is why this version tracks div depth to find each
  // admin-section's real [start,end) range instead of just its start.
  const adminSectionRanges66 = (src) => {
    const ranges = [];
    const openRe = /<div\s+class="admin-section"\s+data-comm-tab="([^"]+)">/g;
    let om;
    while ((om = openRe.exec(src))) {
      const tab = om[1];
      const start = om.index;
      const tagRe = /<div\b[^>]*>|<\/div>/g;
      tagRe.lastIndex = om.index + om[0].length;
      let depth = 1, end = src.length, tm;
      while ((tm = tagRe.exec(src))) {
        if (tm[0] === '</div>') { depth--; if (depth === 0) { end = tagRe.lastIndex; break; } }
        else { depth++; }
      }
      ranges.push({ tab, start, end });
    }
    return ranges;
  };
  const commTabFor66 = (src, anchor) => {
    const idx = src.indexOf(anchor);
    if (idx === -1) return undefined;
    const hit = adminSectionRanges66(src).find(r => idx >= r.start && idx < r.end);
    return hit ? hit.tab : null;
  };

  for (const [anchor, label] of [
    ['id="scribe-feedback-toggle"', 'SCRIBE feedback buttons toggle'],
    ['id="chat-image-preview-toggle"', 'image previews toggle'],
  ]) {
    const tab = commTabFor66(appJsSrc, anchor);
    assert(tab === 'settings',
      `${label} sits inside a data-comm-tab="settings" container (containing tab was ${JSON.stringify(tab)})`);
    assert(!['week', 'games', 'players', 'data'].includes(tab),
      `${label} does NOT render under the week/games/players/or data tabs (RG-10 negative check, got ${JSON.stringify(tab)})`);
  }

  // 66b — self-test the detector itself (RG-27: a guard that cannot fail is
  // not a guard). No containing tagged section at all → null. Nested inside
  // a "week" section → "week". Placed as an untagged SIBLING immediately
  // after a "settings" section closes (the real RG-10 shape the mutation
  // drill below reproduces against the actual file) → null, NOT "settings".
  assert(commTabFor66('<div class="card"><input id="scribe-feedback-toggle"></div>', 'id="scribe-feedback-toggle"') === null,
    'detector fixture: an id with no containing tagged section at all reads as null, not "settings"');
  assert(commTabFor66('<div class="admin-section" data-comm-tab="week"><input id="scribe-feedback-toggle"></div>', 'id="scribe-feedback-toggle"') === 'week',
    'detector fixture: an id nested inside a data-comm-tab="week" section reads "week", correctly NOT "settings"');
  assert(commTabFor66('<div class="admin-section" data-comm-tab="settings"><div>ok</div></div><div class="card"><input id="scribe-feedback-toggle"></div>', 'id="scribe-feedback-toggle"') === null,
    'detector fixture: an id placed as an UNTAGGED SIBLING right after a settings section CLOSES reads as null, not "settings" (the shape a nearest-preceding-attribute heuristic would miss)');

  // 66c — structural: the two change handlers write through saveSetting()
  // (the storage seam), not localStorage directly.
  assert(/document\.getElementById\('scribe-feedback-toggle'\)\?\.addEventListener\('change', e => \{\s*saveSetting\('scribeFeedbackEnabled', e\.target\.checked\);/.test(appJsSrc),
    "the scribe-feedback-toggle change handler calls saveSetting('scribeFeedbackEnabled', e.target.checked) — the storage seam");
  assert(/document\.getElementById\('chat-image-preview-toggle'\)\?\.addEventListener\('change', e => \{\s*saveSetting\('chatImagePreviewEnabled', e\.target\.checked\);/.test(appJsSrc),
    "the chat-image-preview-toggle change handler calls saveSetting('chatImagePreviewEnabled', e.target.checked) — the storage seam");

  // 66d — settings-off state is honored by each field's own consumer.
  // Reuses the real seams end-to-end: storage.saveSetting() write, then the
  // real isScribeFeedbackEnabled()/isChatImagePreviewEnabled() reads.
  const scribeFeedbackMod66 = mods['scribeFeedback'];
  const chatMod66 = mods['chat'];

  storage.saveSetting('scribeFeedbackEnabled', true);
  assert(scribeFeedbackMod66.isScribeFeedbackEnabled() === true,
    'scribeFeedbackEnabled=true is honored by isScribeFeedbackEnabled()');
  storage.saveSetting('scribeFeedbackEnabled', false);
  assert(scribeFeedbackMod66.isScribeFeedbackEnabled() === false,
    'turning the toggle OFF (scribeFeedbackEnabled=false) is honored by isScribeFeedbackEnabled() — Rate/Flag controls stop rendering');
  storage.saveSetting('scribeFeedbackEnabled', true); // restore the pilot default for any later section

  storage.saveSetting('chatImagePreviewEnabled', true);
  assert(chatMod66.isChatImagePreviewEnabled() === true,
    'chatImagePreviewEnabled=true is honored by isChatImagePreviewEnabled()');
  storage.saveSetting('chatImagePreviewEnabled', false);
  assert(chatMod66.isChatImagePreviewEnabled() === false,
    'turning the toggle OFF (chatImagePreviewEnabled=false, also the shipped default) is honored by isChatImagePreviewEnabled()');
}

// ── 67. B2 remediation (2026-09-10, reviewer BLOCK) — scribeToolsTwin.mjs is
// NOW ACTUALLY part of this mandatory run ──────────────────────────────────
// backend/Code.gs's own header comment on the C3 ported-twin block claimed
// scribeToolsTwin.mjs was "wired into loadtest.mjs's mandatory run" — it was
// not: the file existed and passed standalone, but `node loadtest.mjs` never
// executed it, so a drift regression between Code.gs's twins and the real
// js/scoring.js|storage.js|data-model.js functions they port would have
// shipped silently, one release at a time, with every OTHER loadtest section
// green. Spawned as a subprocess (same precedent as section [33]'s
// execFileSync probes) rather than imported directly: scribeToolsTwin.mjs
// loads backend/Code.gs into a fresh `vm` context of its own, and doing that
// import-side-effect-laden work a second time inside THIS process's already-
// populated module graph risks exactly the "dirty state" class of false pass
// section [33] warns about for storage.js. A subprocess gets a clean process,
// full stop.
console.log('\n[67] scribeToolsTwin.mjs — spawned as a subprocess, exit code + printed pass/fail line both checked…');
{
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const cwd = fileURLToPath(new URL('.', import.meta.url));
  const result = spawnSync(process.execPath, ['scribeToolsTwin.mjs'], { cwd, encoding: 'utf8' });
  const out = (result.stdout || '') + (result.stderr || '');
  assert(result.status === 0, `scribeToolsTwin.mjs exits 0 (got ${result.status}${result.error ? ' — ' + result.error.message : ''})`);
  const summaryMatch = out.match(/(✅ ALL PASS|❌ FAILURES) — (\d+) passed, (\d+) failed/);
  assert(!!summaryMatch, `scribeToolsTwin.mjs printed its own pass/fail summary line (fixture check — a summary-less run would make the two assertions below vacuous)${summaryMatch ? '' : '\n' + out.slice(-800)}`);
  if (summaryMatch) {
    assert(summaryMatch[1] === '✅ ALL PASS', `scribeToolsTwin.mjs itself reports ALL PASS (got: ${summaryMatch[0]})`);
    assert(Number(summaryMatch[3]) === 0, `scribeToolsTwin.mjs reports zero failed assertions (got ${summaryMatch[3]} failed, ${summaryMatch[2]} passed)`);
    assert(Number(summaryMatch[2]) >= 10, `scribeToolsTwin.mjs actually ran a non-trivial number of assertions (got ${summaryMatch[2]} — a near-zero count would mean the drift guard is vacuous)`);
  }
}

// ── 68. trainertest.mjs — spawned as a subprocess, same shape as [67] ───────
// Build 2b, Group E (2026-09-10, UN-161…163). Same "clean process" reasoning
// section [67] gives for scribeToolsTwin.mjs: trainertest.mjs loads
// backend/Code.gs into its OWN fresh `vm` context AND does real ESM imports
// of js/app.js/js/storage.js/js/scribeAgent.js — doing all of that a second
// time inside THIS already-populated module graph risks the same "dirty
// state" false-pass class [67]'s own comment names.
console.log('\n[68] trainertest.mjs — spawned as a subprocess, exit code + printed pass/fail line both checked…');
{
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const cwd = fileURLToPath(new URL('.', import.meta.url));
  const result = spawnSync(process.execPath, ['trainertest.mjs'], { cwd, encoding: 'utf8' });
  const out = (result.stdout || '') + (result.stderr || '');
  assert(result.status === 0, `trainertest.mjs exits 0 (got ${result.status}${result.error ? ' — ' + result.error.message : ''})`);
  const summaryMatch68 = out.match(/(✅ ALL PASS|❌ FAILURES) — (\d+) passed, (\d+) failed/);
  assert(!!summaryMatch68, `trainertest.mjs printed its own pass/fail summary line (fixture check — a summary-less run would make the two assertions below vacuous)${summaryMatch68 ? '' : '\n' + out.slice(-800)}`);
  if (summaryMatch68) {
    assert(summaryMatch68[1] === '✅ ALL PASS', `trainertest.mjs itself reports ALL PASS (got: ${summaryMatch68[0]})`);
    assert(Number(summaryMatch68[3]) === 0, `trainertest.mjs reports zero failed assertions (got ${summaryMatch68[3]} failed, ${summaryMatch68[2]} passed)`);
    assert(Number(summaryMatch68[2]) >= 10, `trainertest.mjs actually ran a non-trivial number of assertions (got ${summaryMatch68[2]} — a near-zero count would mean the guard is vacuous)`);
  }
}

// ── 69. RG — the dashboard chat teaser re-announces a message already READ ──
// Drew, live v0.19.0, 2026-09-10, verbatim: "the 'chat' function keeps popping
// up the most recent message at the top of the dashboard regardless of how
// many times I click into it. The chat also takes a while to load, it starts
// off blank, and then will populate all of the messages and I will re-get the
// current 'in app notification' at the top of the dashboard."
//
// ONE defect in two costumes. dashboardChatTeaserHTML() gated visibility on
// the ✕-dismissal watermark ALONE (`latestSeq <= teaserDismissedSeq()`), and
// nothing else — so OPENING THE ROOM, which is the most complete form of
// reading a message there is, never suppressed the teaser. Only the ✕ did.
//  (a) navigate Chat -> Dashboard: renderDashboard() re-inserts the card.
//  (b) reload: the fold starts empty (nothing is cached device-locally —
//      S.items is rebuilt entirely from the transport, which is also the
//      "starts off blank" half of the report), so the teaser is correctly
//      absent on first paint; when the backfill lands ~10-20s later it fires
//      notify('events') and the teaser re-appears for a message read in the
//      PREVIOUS session, because K_LASTSEEN persisted across the reload and
//      the teaser never consulted it.
// The floating toast already consulted the read cursor for exactly this
// reason (initChatUI's subscriber: `latest.seq > getLastSeen().seq`); the
// teaser was the one surface that didn't. Fixed by deriving ONE
// "acknowledged through seq N" value — max(✕ dismissal, read cursor) — and
// gating the teaser on that.
console.log('\n[69] RG — the dashboard teaser must not re-announce a message already read (v0.19.0 field report)…');
{
  const chat69 = mods['chat'], chatUi69 = mods['chat-ui'];
  const ev69 = o => ({ gameTag: '', type: 'message', author: 'p1', body: '', notify: true, ...o });
  chat69._resetForTest();
  storage.saveSetting('chatEnabled', true);
  storage.saveSetting('chatEpochSeq', 0);
  storage.saveSetting('chatRetentionDays', 0);
  localStorage.removeItem('cfbp_chat_lastseen2');
  localStorage.removeItem('cfbp_chat_teaser_dismiss_seq');
  storage.setSession('p2', false, true);          // viewer is p2; p1 is the poster
  const T69 = 1786500000000;

  // ── Session 1: boot -> backfill -> open the room ──────────────────────────
  chat69.ingest([
    ev69({ id: 'rg69a', seq: 41, ts: T69, body: 'anyone taking the over', author: 'p1' }),
    ev69({ id: 'rg69b', seq: 42, ts: T69 + 60000, body: 'lock of the week', author: 'p1' }),
  ], 42);
  assert(/lock of the week/.test(chatUi69.dashboardChatTeaserHTML()),
    'fixture: the teaser announces the newest unread message before anything is read (non-vacuous baseline)');

  // Tapping the teaser opens the room; renderChatPage()'s 1s mark timer then
  // calls exactly this. Drew's "click into it".
  chat69.markSeen('all');
  assert(chat69.unreadCount('p2', 'all') === 0, 'reading the room clears the unread count (fixture check)');
  assert(chat69.getLastSeen().seq === 42, 'the device-local read cursor advanced to the head (42)');

  assert(chatUi69.dashboardChatTeaserHTML() === '',
    'THE BUG (a): back on the dashboard, the teaser does NOT re-announce a message already read ("regardless of how many times I click into it")');

  // ── Session 2: page reload. Module state is gone; device-local storage is
  // not. _resetForTest() is a faithful stand-in — it clears S.items/S.head
  // and touches no localStorage key. ──
  chat69._resetForTest();
  assert(chatUi69.dashboardChatTeaserHTML() === '',
    'first paint after reload: nothing folded yet, so nothing is announced');
  chat69.ingest([
    ev69({ id: 'rg69a', seq: 41, ts: T69, body: 'anyone taking the over', author: 'p1' }),
    ev69({ id: 'rg69b', seq: 42, ts: T69 + 60000, body: 'lock of the week', author: 'p1' }),
  ], 42);
  assert(chatUi69.dashboardChatTeaserHTML() === '',
    'THE BUG (b): when the backfill lands after a reload it does not re-announce an already-read message ("I will re-get the current in-app notification")');

  // ── UN-93 must survive: genuinely new activity still gets announced ───────
  chat69.ingest([ev69({ id: 'rg69c', seq: 43, ts: T69 + 120000, body: 'brand new take', author: 'p1' })], 43);
  assert(/brand new take/.test(chatUi69.dashboardChatTeaserHTML()),
    'a strictly newer unread message still surfaces the teaser (UN-93 unchanged — this is not a mute switch)');

  // ── Read state is TWO-LEVEL, and both levels acknowledge ─────────────────
  // openGameChatSheet() (chat-ui.js) calls markSeen(gameId), which writes
  // `byTag` and never `.seq`. Gating the teaser on the ROOM cursor alone
  // therefore left the card re-announcing the very message the player had
  // just read inside its game thread — with unreadCount(g1) already at 0.
  // (Found in review of the first fix for this RG; the first fix consulted
  // half of the read state, which is the same shape as the original bug.)
  //
  // The correct pair, and they must BOTH hold:
  //   (i) the message you read in its thread stops being announced;
  //  (ii) an unrelated unread ROOM message is not silenced by that read —
  //       the card falls through to it rather than vanishing. A per-tag read
  //       acknowledges what it read, nothing else.
  chat69.ingest([
    ev69({ id: 'rg69n', seq: 44, ts: T69 + 180000, body: 'unrelated room message', gameTag: '', author: 'p1' }),
    ev69({ id: 'rg69m', seq: 45, ts: T69 + 240000, body: 'M inside the g1 thread', gameTag: 'g1', author: 'p1' }),
  ], 45);
  assert(/M inside the g1 thread/.test(chatUi69.dashboardChatTeaserHTML()),
    'fixture: the newest unread message (posted in game thread g1) is what the teaser announces');

  chat69.markSeen('g1');                       // the player opens the g1 game sheet
  assert(chat69.unreadCount('p2', 'g1') === 0,
    'fixture: reading the g1 thread zeroes that thread\'s unread count (the state the teaser must agree with)');
  const teaser69 = chatUi69.dashboardChatTeaserHTML();
  assert(!/M inside the g1 thread/.test(teaser69),
    'THE BUG (c): reading a message inside its GAME THREAD stops the teaser announcing that exact message (byTag is read state too, not just .seq)');
  assert(/unrelated room message/.test(teaser69),
    'and it falls THROUGH to a different unread room message rather than going blank — a per-tag read never silences unrelated room activity');

  // Reading the room clears the fall-through target too (reading the room is
  // reading every thread — the other direction of the same rule).
  chat69.markSeen('all');
  assert(chatUi69.dashboardChatTeaserHTML() === '',
    'reading the room then clears the fall-through message as well (both levels, one rule)');
  // Re-arm with genuinely new activity so the monotonic block below is not
  // asserting against an already-empty teaser.
  chat69.ingest([ev69({ id: 'rg69o', seq: 46, ts: T69 + 300000, body: 'back to unread', author: 'p1' })], 46);
  assert(/back to unread/.test(chatUi69.dashboardChatTeaserHTML()),
    'fixture: new activity after that read re-arms the teaser (non-vacuous baseline for the monotonic cases)');

  // ── Monotonic, both ways. The derived watermark is max(✕, read cursor), so
  // neither half can rewind the other (RG-14 / RG-25). ─────────────────────
  chatUi69._ackNotif(99);                          // ✕ dismissal well ahead of the read cursor
  assert(chatUi69.dashboardChatTeaserHTML() === '', 'an explicit ✕ dismissal above the read cursor still suppresses (the dismissal half is intact)');
  chat69.markSeen('all');                          // cursor advances to 43 — BELOW the dismissal
  chat69.ingest([ev69({ id: 'rg69d', seq: 50, ts: T69 + 180000, body: 'below the dismissal', author: 'p1' })], 50);
  assert(chatUi69.dashboardChatTeaserHTML() === '',
    'a read cursor BELOW an existing ✕ dismissal never un-dismisses what was already acknowledged (monotonic)');
  chat69.ingest([ev69({ id: 'rg69e', seq: 120, ts: T69 + 240000, body: 'above everything', author: 'p1' })], 120);
  assert(/above everything/.test(chatUi69.dashboardChatTeaserHTML()),
    'and a message above BOTH watermarks is still announced');

  // The unread badge and the teaser must agree about what "read" means — the
  // reported symptom was a card announcing a message the badge already
  // considered read (it rendered with no unread dot at all).
  chat69.markSeen('all');
  assert(chat69.unreadCount('p2', 'all') === 0 && chatUi69.dashboardChatTeaserHTML() === '',
    'teaser and unread count agree: zero unread means nothing to announce');

  storage.clearSession();
  localStorage.removeItem('cfbp_chat_lastseen2');
  localStorage.removeItem('cfbp_chat_teaser_dismiss_seq');
  chat69._resetForTest();
}

// ── 70. The toast gate reads the same DERIVED, tag-aware acknowledgement ─────
// Review finding 2 on the [69] fix: showToast()'s suppression named
// notifAckThroughSeq(), but NOTHING in the suite could tell that apart from
// the ✕-dismissal watermark alone — reverting that one line to _notifAckSeq()
// left a fully green run. Same failure mode as RG-25's original: a recorded
// protection no test could distinguish from its own absence.
//
// Two surfaces announce a message (the floating toast and the dashboard
// teaser) and there is ONE notion of "acknowledged": the ✕ dismissal, OR
// having read the message — in the room, or inside its own game thread. These
// assertions pin the read half, and pin that it is per-tag.
console.log('\n[70] RG — the toast gate uses the derived, tag-aware acknowledgement (review finding 2)…');
{
  const chat70 = mods['chat'], chatUi70 = mods['chat-ui'];
  const ev70 = o => ({ gameTag: '', type: 'message', author: 'p1', body: '', notify: true, ...o });
  const T70 = 1786500000000;
  const _realST70 = globalThis.setTimeout, _realCT70 = globalThis.clearTimeout, _realDoc70 = globalThis.document;

  // Minimal DOM harness — the toast must be driven through the REAL
  // showToast/drainToast (same rule as §32), because the defect being guarded
  // lives in showToast's gate expression, not in a re-implementation of it.
  function mkEl70(tag = 'div') {
    const L = {};
    return {
      tagName: tag, id: '', className: '', dataset: {}, style: {},
      _html: '', _removed: false, _children: [],
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      set innerHTML(v) { this._html = v; },
      get innerHTML() { return this._html; },
      addEventListener(t, fn) { (L[t] ||= []).push(fn); },
      removeEventListener() {},
      appendChild(c) { this._children.push(c); return c; },
      remove() { this._removed = true; DOC70.body._children = DOC70.body._children.filter(x => x !== this); },
      querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    };
  }
  const DOC70 = {
    body: mkEl70('body'),
    createElement: t => mkEl70(t),
    querySelector: () => null, querySelectorAll: () => [],   // no page is "active" -> no page suppression
    getElementById: id => DOC70.body._children.find(c => c.id === id && !c._removed) || null,
    addEventListener() {}, removeEventListener() {}, hidden: false,
  };
  const live70 = () => DOC70.getElementById('chat-toast');
  function reset70() {
    chatUi70._resetToastsForTest();
    live70()?.remove();
    localStorage.removeItem('cfbp_chat_teaser_dismiss_seq');
  }
  globalThis.document = DOC70;
  globalThis.setTimeout = () => 0;          // no auto-dismiss timer fires here
  globalThis.clearTimeout = () => {};

  try {
    chat70._resetForTest();
    storage.saveSetting('chatEnabled', true);
    storage.saveSetting('chatEpochSeq', 0);
    storage.saveSetting('chatRetentionDays', 0);
    localStorage.removeItem('cfbp_chat_lastseen2');

    // 70a — non-vacuous baseline: nothing read, nothing dismissed -> it mounts.
    reset70();
    chatUi70._showToastForTest({ author: 'p1', body: 'unread room message', seq: 890, gameTag: '' });
    assert(!!live70() && /unread room message/.test(live70().innerHTML),
      'fixture: with nothing read and nothing dismissed, showToast() actually mounts a toast (non-vacuous baseline)');

    // 70b — READING THE ROOM suppresses the toast, with the ✕ watermark still
    // at zero. This is the assertion that goes red if the gate is reverted to
    // the dismissal watermark alone.
    reset70();
    chat70.ingest([ev70({ id: 't70a', seq: 900, ts: T70, body: 'room activity' })], 900);
    chat70.markSeen('all');
    assert(chatUi70._notifAckSeq() === 0,
      `fixture: the ✕ dismissal watermark is untouched (0) — any suppression below can only come from the READ cursor, got ${chatUi70._notifAckSeq()}`);
    assert(chatUi70._notifAckThroughSeq() === 900,
      `the derived acknowledgement picks up the read cursor — got ${chatUi70._notifAckThroughSeq()}`);
    const depth70 = chatUi70._toastQueueDepth();
    chatUi70._showToastForTest({ author: 'p1', body: 'already read in the room', seq: 890, gameTag: '' });
    assert(!live70() && chatUi70._toastQueueDepth() === depth70,
      'a message already READ IN THE ROOM raises no toast even though nothing was ever ✕-dismissed (gate the toast on the dismissal watermark alone and this goes red)');

    // 70c — and the read half is per-tag, exactly like the unread badge:
    // reading ONE game thread acknowledges that thread and nothing else.
    reset70();
    chat70._resetForTest();
    localStorage.removeItem('cfbp_chat_lastseen2');
    chat70.ingest([ev70({ id: 't70b', seq: 910, ts: T70 + 1000, gameTag: 'g1', body: 'posted in g1' })], 910);
    chat70.markSeen('g1');                                     // openGameChatSheet()
    assert(chatUi70._notifAckThroughSeq('g1') === 910 && chatUi70._notifAckThroughSeq('all') === 0,
      `the derived acknowledgement is per-tag: g1 acknowledged through 910, the room still 0 — got ${chatUi70._notifAckThroughSeq('g1')} / ${chatUi70._notifAckThroughSeq('all')}`);
    chatUi70._showToastForTest({ author: 'p1', body: 'read in its thread', seq: 910, gameTag: 'g1' });
    assert(!live70(),
      'a message already read inside its own game thread raises no toast');
    chatUi70._showToastForTest({ author: 'p1', body: 'unrelated room message', seq: 910, gameTag: '' });
    assert(!!live70() && /unrelated room message/.test(live70().innerHTML),
      'but an unrelated ROOM message at the very same seq still does — reading one thread never silences the room (drop the tag argument from the gate and this goes red)');

    // 70d — the dismissal half is NOT tag-scoped: one ✕ covers everything at
    // or below it, in any thread. max() of the two halves, both directions.
    reset70();
    chatUi70._ackNotif(950);
    const depth70d = chatUi70._toastQueueDepth();
    chatUi70._showToastForTest({ author: 'p1', body: 'dismissed already', seq: 940, gameTag: 'g2' });
    assert(!live70() && chatUi70._toastQueueDepth() === depth70d,
      'an explicit ✕ dismissal still silences a toast in ANY thread — the dismissal half stays room-wide (RG-25 intact)');
  } finally {
    globalThis.setTimeout = _realST70;
    globalThis.clearTimeout = _realCT70;
    globalThis.document = _realDoc70;
    localStorage.removeItem('cfbp_chat_lastseen2');
    localStorage.removeItem('cfbp_chat_teaser_dismiss_seq');
    chat70._resetForTest();
  }
}

// ── 71. Transport: no head probe when nothing is known yet ───────────────────
// "It starts off blank, and then will populate all of the messages" — the fold
// is rebuilt from the transport on every boot, and the first tick used to pay
// for TWO sequential Apps Script calls (chatHead, then chatSince) before a
// single message could render. Cold starts run 10-20s (ledger §5), so that
// probe can double the blank window. It also buys nothing when nothing is
// known: whatever the head says, the follow-up call is fetchSince(0).
//
// Transport-local — no AD-16 exposure: chatTransport.js remains the only
// module touching the chat backend, and chat.js's callback shape is unchanged.
console.log('\n[71] Transport — the first tick with nothing known skips the head probe…');
{
  const transport71 = mods['chatTransport'], backend71 = mods['backend'];
  const _realFetch71 = globalThis.fetch, _realST71 = globalThis.setTimeout, _realCT71 = globalThis.clearTimeout;
  const calls71 = [];
  let HEAD71 = 7;
  let EVENTS71 = [{ id: 'tr1', seq: 7, ts: 1, type: 'message', author: 'p1', body: 'hello', notify: true }];
  let scheduled71 = null;
  const flush71 = () => new Promise(r => _realST71(r, 0));

  globalThis.setTimeout = fn => { scheduled71 = fn; return 1; };   // hold the next tick, don't fire it
  globalThis.clearTimeout = () => {};
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    const action = u.searchParams.get('action');
    calls71.push({ action, seq: u.searchParams.get('seq') });
    if (action === 'chatHead') return { ok: true, json: async () => ({ ok: true, head: HEAD71 }) };
    if (action === 'chatSince') return { ok: true, json: async () => ({ ok: true, events: EVENTS71, head: HEAD71 }) };
    return { ok: true, json: async () => ({ ok: true }) };
  };
  backend71.setBackendConfig('https://example.invalid/exec', 'tok71');

  let known71 = 0, unsub71 = null;
  try {
    unsub71 = transport71.subscribe((events, head) => { if (typeof head === 'number' && head > known71) known71 = head; },
      { getMode: () => 'idle', getKnownHead: () => known71 });
    await flush71(); await flush71();
    assert(calls71.length === 1 && calls71[0].action === 'chatSince',
      `first tick with a known head of 0 makes exactly ONE call and it is chatSince — got [${calls71.map(c => c.action).join(', ')}]`);
    assert(calls71[0]?.seq === '0',
      `and it asks for everything from seq 0 — got ${calls71[0]?.seq}`);
    assert(known71 === 7, 'fixture: the events from that single call were delivered to the subscriber (head advanced to 7)');

    // Later tick, head unchanged: back to the cheap two-phase probe, and it
    // must NOT re-fetch since the head has not moved.
    calls71.length = 0;
    scheduled71?.(); await flush71(); await flush71();
    assert(calls71.length === 1 && calls71[0].action === 'chatHead',
      `a later tick probes the cheap head first and skips chatSince when the head has not advanced — got [${calls71.map(c => c.action).join(', ')}]`);

    // Later tick, head advanced: two-phase head-then-since, unchanged.
    calls71.length = 0;
    HEAD71 = 9;
    EVENTS71 = [{ id: 'tr2', seq: 9, ts: 2, type: 'message', author: 'p1', body: 'newer', notify: true }];
    scheduled71?.(); await flush71(); await flush71();
    assert(calls71.map(c => c.action).join(',') === 'chatHead,chatSince',
      `and when the head HAS advanced it follows with chatSince — the two-phase behaviour is preserved for every tick after the first — got [${calls71.map(c => c.action).join(', ')}]`);
    assert(calls71[1]?.seq === '7',
      `the follow-up asks only for what is missing (since 7), not the whole log — got ${calls71[1]?.seq}`);
  } finally {
    unsub71?.();
    globalThis.fetch = _realFetch71;
    globalThis.setTimeout = _realST71;
    globalThis.clearTimeout = _realCT71;
    backend71.clearBackendConfig();
  }
}

// ── Result ───────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
