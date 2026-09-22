/**
 * unreadtest.mjs — THE CHAT READ CURSOR SURVIVES A SIGN-OUT (RG-196)
 * ===================================================================
 * Run:  node unreadtest.mjs          (also spawned by loadtest.mjs §[73z])
 *
 * DREW, 2026-09-21: "when I log in there was a badge over chat of 84 unread
 * messages even tho I've already seen them, the badge goes away when you click
 * chat."
 *
 * THE MECHANISM, reproduced in §[1] below. The read cursor lives in ONE
 * device-local key (`cfbp_chat_lastseen2`, js/chat.js) that is not keyed by
 * anybody — so the only way the A9/DI-180q device sweep could stop player B
 * inheriting player A's read positions was to DELETE it. `signOut()` therefore
 * destroyed the departing player's own cursor as well, and the same player
 * signing straight back in started from seq 0 with the whole retained window
 * (84 notifying messages) counting as unread again.
 *
 * THE FIX this suite guards: the cursor payload carries an OWNER STAMP — an
 * opaque digest of (member id | active league id) — so a cursor that is not
 * yours reads as ZERO instead of having to be deleted. That makes the key
 * inert across a handover, which is what the sweep wanted, and lets it survive
 * a sign-out, which is what the player wants. It is exempted from the sweep by
 * NAME in js/auth.js's `_CLEAR_KEEP_KEYS`, with the justification beside it;
 * §[6] asserts the exemption is exactly one key wide and §[7] asserts the two
 * lists in auth.js agree about it.
 *
 * Standalone (the grouptest.mjs precedent) because it drives js/auth.js's real
 * signOut() against js/chat.js's real cursor, and both want a clean store.
 */

// ── stubs ─────────────────────────────────────────────────────────────────────
const store = new Map();
globalThis.localStorage = {
  get length() { return store.size; },
  key: i => [...store.keys()][i] ?? null,
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  body: { classList: { add() {}, remove() {} }, appendChild() {} }, hidden: false,
};
globalThis.window = globalThis;
globalThis.fetch = async () => { throw new Error('network disabled in unreadtest'); };
globalThis.matchMedia = () => ({ matches: false });
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

const { readFileSync } = await import('node:fs');
const chat = await import('./js/chat.js');
const auth = await import('./js/auth.js');
const storage = await import('./js/storage.js');

const ACTIVE_LEAGUE_KEY = 'cfbp_supabase_active_league';
const K_LASTSEEN = 'cfbp_chat_lastseen2';

/** Sign a member in on this device, PIN-mode shape — the one identity the
 *  cursor is keyed by is `getSession().playerId` + the active league, and both
 *  are readable in every authMode (js/storage.js getSession()). Driving it
 *  this way keeps the suite off the Supabase SDK harness while exercising the
 *  exact expression production reads. */
function signedInAs(memberId, leagueId = 'L-IRB') {
  localStorage.setItem(ACTIVE_LEAGUE_KEY, leagueId);
  storage.setSession(memberId, false, true);
}
function signedOutIdentity() {
  storage.clearSession();
}

/** 84 notifying messages from somebody else — the size of Drew's badge. */
const BACKLOG = [];
for (let i = 1; i <= 84; i++) {
  BACKLOG.push({ id: 'm' + i, seq: i, ts: 1_600_000_000_000 + i, type: 'message',
                 author: 'mKevin', body: 'msg ' + i, notify: true, gameTag: i === 84 ? 'g1' : '' });
}
function freshRoom() {
  chat._resetForTest();
  chat.ingest(BACKLOG);
}

// ── [1] THE REPORTED BUG ─────────────────────────────────────────────────────
console.log('\n[1] Sign out and back in as the SAME member — what I have read stays read…');
{
  localStorage.clear();
  signedInAs('mDrew');
  freshRoom();
  chat.markSeen('all');
  assert(chat.unreadCount('mDrew', 'all') === 0,
    'fixture: after reading the room, the badge is 0 (84 notifying messages, all seen)');

  await auth.signOut();
  signedOutIdentity();
  // …and the player signs straight back in, same account, same league, same phone.
  signedInAs('mDrew');
  freshRoom();

  assert(chat.unreadCount('mDrew', 'all') === 0,
    'RG-196 — sign-out → sign-in as the SAME member shows 0 unread, not the whole backlog. (Reported: "a badge over chat of 84 unread messages even tho I\'ve already seen them.")');
  assert(chat.getLastSeen().seq === 84,
    `…because the read cursor itself survived the sign-out sweep (got seq ${chat.getLastSeen().seq})`);
  assert(chat.unreadCount('mDrew', 'g1') === 0,
    '…and the PER-GAME cursors survive too, so no game bubble lights up claiming unread that was cleared before the sign-out');
}

// ── [2] A GENUINELY NEW MESSAGE STILL COUNTS ─────────────────────────────────
console.log('\n[2] …but a genuinely new message still badges (non-vacuity)…');
{
  chat.ingest([{ id: 'm85', seq: 85, ts: 1_600_000_000_085, type: 'message',
                 author: 'mKevin', body: 'new after the sign-in', notify: true, gameTag: '' }]);
  assert(chat.unreadCount('mDrew', 'all') === 1,
    'one new notifying message after the sign-in reads as exactly 1 unread — the cursor is a read position, not a mute button');
  chat.markSeen('all');
  assert(chat.unreadCount('mDrew', 'all') === 0, '…and reading it clears it again');
}

// ── [3] A DIFFERENT MEMBER ON THE SAME DEVICE GETS THEIR OWN COUNT ───────────
console.log('\n[3] A DIFFERENT member on the same handset never inherits my read position…');
{
  signedOutIdentity();
  signedInAs('mKihoon');
  freshRoom();
  assert(chat.unreadCount('mKihoon', 'all') === 84,
    'A9/DI-180q preserved — the incoming member sees THEIR OWN count (84), not the previous player\'s zero. The cursor is stamped, so it is inert rather than inherited.');
  chat.markSeen('all');
  assert(chat.unreadCount('mKihoon', 'all') === 0, 'fixture: …and Kihoon reading the room zeroes Kihoon\'s count');

  // …and handing it back does not cost Drew his position either.
  signedOutIdentity();
  signedInAs('mDrew');
  freshRoom();
  assert(chat.unreadCount('mDrew', 'all') === 84,
    'THE ACCEPTED LIMIT, asserted rather than assumed: the LAST writer wins the single device-local key, so a phone two members alternate on costs each of them ONE re-read per switch (exactly what deleting the key cost everybody before this fix). The guarantee is "nobody ever sees somebody else\'s read position", not "two members interleave on one phone" — see the note in js/chat.js.');
}

// ── [4] THE STAMP CARRIES NO IDENTITY IN THE CLEAR ──────────────────────────
console.log('\n[4] The stamp is an opaque digest — the key names nobody…');
{
  localStorage.clear();
  signedInAs('mDrew', 'L-IRB');
  freshRoom();
  chat.markSeen('all');
  const raw = localStorage.getItem(K_LASTSEEN) || '';
  const parsed = JSON.parse(raw);
  assert(typeof parsed.owner === 'string' && parsed.owner.length > 0,
    `the persisted cursor carries an owner stamp (got ${JSON.stringify(parsed.owner)})`);
  assert(!raw.includes('mDrew') && !raw.includes('L-IRB'),
    'and it is a DIGEST — neither the member id nor the league id appears in the clear, so what an explicit Sign Out leaves behind is numbers and an opaque token (the `cfbp_scribe_ledger` category the keep-list already keeps)');
  const drewStamp = parsed.owner;
  signedInAs('mKihoon', 'L-IRB');
  assert(chat._lastSeenOwnerForTest() !== drewStamp, 'a different member digests differently (so the mismatch in §[3] is real, not a coincidence of shape)');
  signedInAs('mDrew', 'L-OTHER');
  assert(chat._lastSeenOwnerForTest() !== drewStamp,
    'the LEAGUE is part of the stamp — one account switching leagues must not inherit the other league\'s read position (js/auth.js:370-375: the cursors are league-scoped)');
  signedInAs('mDrew', 'L-IRB');
  assert(chat._lastSeenOwnerForTest() === drewStamp, '…and the same member in the same league digests back to the same stamp (stable, not random per call)');
}

// ── [5] A PRE-UPGRADE CURSOR IS NOT THROWN AWAY ─────────────────────────────
console.log('\n[5] A cursor written before this shipped still reads (CONVENTIONS #10)…');
{
  localStorage.clear();
  localStorage.setItem(K_LASTSEEN, JSON.stringify({ seq: 84, byTag: { g1: 84 } }));   // no owner field — every phone in the league is in this state today
  signedInAs('mDrew');
  freshRoom();
  assert(chat.unreadCount('mDrew', 'all') === 0,
    'an UNSTAMPED (pre-upgrade) cursor is adopted by whoever is signed in — nobody loses their read position on upgrade day, and the first write stamps it');
  chat.markSeen('all');
  assert(typeof JSON.parse(localStorage.getItem(K_LASTSEEN)).owner === 'string',
    '…and the very next markSeen() stamps it, so the unstamped window is one write wide');
  assert(chat.getLastSeen().seq === 84, '…without regressing the position it already held');
}

// ── [6] THE SWEEP EXEMPTION IS EXACTLY ONE KEY WIDE ─────────────────────────
console.log('\n[6] Everything ELSE the sign-out sweep clears is still cleared…');
{
  localStorage.clear();
  signedInAs('mDrew');
  const SWEPT = {
    cfbp_chat_outbox2: JSON.stringify([{ id: 'o1', author: 'mDrew', body: 'unsent' }]),
    cfbp_chat_epoch_applied: '7',
    cfbp_chat_events_cache: JSON.stringify({ epoch: 0, head: 84, events: [{ id: 'e1', body: 'Drew: taking the points' }] }),
    cfbp_notify_log_cache: JSON.stringify([{ id: 'n1' }]),
    cfbp_notif_readstate: JSON.stringify({ n1: true }),
    cfbp_session: JSON.stringify({ playerId: 'mDrew', isAdmin: true }),
    cfbp_picks: '[{"playerId":"mDrew"}]',
  };
  for (const [k, v] of Object.entries(SWEPT)) localStorage.setItem(k, v);
  freshRoom();
  chat.markSeen('all');

  await auth.signOut();

  const survivors = Object.keys(SWEPT).filter(k => localStorage.getItem(k) !== null);
  assert(survivors.length === 0,
    `SEC F3 / A9 / DI-180q intact — an explicit Sign Out still clears the cached room, the unsent outbox, the notify log, the PIN-era session record and the league data (${JSON.stringify(survivors)} survived)`);
  assert(localStorage.getItem(K_LASTSEEN) !== null,
    '…and the ONE exemption is the read cursor, which is now inert to anybody else rather than deleted');
}

// ── [7] THE TWO LISTS IN auth.js AGREE ABOUT IT ─────────────────────────────
console.log('\n[7] The exemption is declared once, in the keep-list, and nowhere contradicted…');
{
  assert(auth._CLEAR_KEEP_KEYS_FOR_TEST.includes(K_LASTSEEN),
    'cfbp_chat_lastseen2 is named in _CLEAR_KEEP_KEYS (with its justification beside it — the keep-list is the one place an exemption may be declared)');
  assert(!auth._SIGNOUT_LOCAL_KEYS_FOR_TEST.includes(K_LASTSEEN),
    '…and it is NOT also in _SIGNOUT_LOCAL_KEYS, which would leave the documentation list claiming a sweep that no longer happens');
  const scan = auth._keysToClearForTest('signout');
  localStorage.setItem(K_LASTSEEN, JSON.stringify({ seq: 1, byTag: {}, owner: 'x' }));
  assert(!auth._keysToClearForTest('signout').includes(K_LASTSEEN),
    'the sweep\'s OWN predicate agrees (a present cursor is not in the list of things to clear) — asserted against _keysToClear(), never a re-derivation of it');
  assert(!auth._keysToClearForTest('handover').includes(K_LASTSEEN),
    '…in handover mode too, so a DIFFERENT account signing in leaves the stamped cursor alone and relies on the stamp, not on deletion');
  assert(Array.isArray(scan), 'fixture: _keysToClear() is readable from here');
}

// ── [8] BOOT ORDER — a mark before the identity lands must not un-stamp it ──
console.log('\n[8] A markSeen() before the identity resolves does not orphan the cursor…');
{
  localStorage.clear();
  signedInAs('mDrew');
  freshRoom();
  chat.markSeen('all');
  const stamped = JSON.parse(localStorage.getItem(K_LASTSEEN)).owner;
  // Cold boot: the room is cached and the chat view paints before getSession()
  // has a playerId (BUG-G's window — the poll loop starts before identity
  // settles). The 1s mark timer fires in that window.
  signedOutIdentity();
  localStorage.removeItem(ACTIVE_LEAGUE_KEY);
  chat.markSeen('all');
  const after = JSON.parse(localStorage.getItem(K_LASTSEEN));
  assert(after.owner === stamped,
    'a mark written while nobody is resolved PRESERVES the existing stamp — otherwise the boot window would quietly turn a stamped cursor into an unstamped one that the next member adopts');
  assert(after.seq === 84, '…and does not regress the position (the 17b cold-load rule still holds)');
  // …and the identity landing finds its own cursor.
  signedInAs('mDrew');
  assert(chat.getLastSeen().seq === 84, 'when the identity lands, the cursor is still the one this member left');
}

// ── [9] STRUCTURAL — the cursor is read through ONE expression ──────────────
console.log('\n[9] Structural: one owner check, at the one read of the key…');
{
  const src = readFileSync(new URL('./js/chat.js', import.meta.url), 'utf8');
  const reads = src.split('\n').filter(l => l.includes('getItem(K_LASTSEEN)')).length;
  assert(reads === 1,
    `K_LASTSEEN is read in exactly ONE place (getLastSeen) — got ${reads}. A second reader is how the owner check would get skipped (the readCursorFor() precedent: "a second copy of this expression is exactly how the dashboard teaser came to disagree with the unread badge").`);
  const writes = src.split('\n').filter(l => l.includes('setItem(K_LASTSEEN')).length;
  assert(writes === 1, `…and written in exactly ONE place (putLastSeen) — got ${writes}, so every write is stamped`);
}

// ── [10] SECURITY B-1 — AN UNSTAMPED CURSOR IS ADOPTED EXACTLY ONCE ─────────
//
// The finding: now that the key survives a handover, a PRE-UPGRADE (unstamped)
// cursor survives one too, and §[5]'s "adoptable" rule would let the NEXT
// member adopt it. The honest rule, given the device cannot know who wrote an
// unstamped cursor: the FIRST read under a resolved identity stamps it to that
// member, and ownership is strict from then on.
console.log('\n[10] SECURITY B-1 — an unstamped cursor is stamped at the first RESOLVED read, then strict…');
{
  localStorage.clear();
  localStorage.setItem(K_LASTSEEN, JSON.stringify({ seq: 84, byTag: { g1: 84 } }));   // pre-upgrade payload
  signedInAs('mDrew');
  freshRoom();
  assert(chat.unreadCount('mDrew', 'all') === 0,
    'the single-user phone keeps its read state through the upgrade — that is the point of the fix');
  assert(JSON.parse(localStorage.getItem(K_LASTSEEN)).owner === chat._lastSeenOwnerForTest(),
    'SECURITY B-1 — …and the READ ITSELF stamped it to the member who was here, with no markSeen() required. The unstamped window is one READ wide, not one WRITE wide.');
  // …and now it is strict: the next member gets nothing from it.
  signedInAs('mKihoon');
  assert(chat.unreadCount('mKihoon', 'all') === 84,
    'SECURITY B-1 — a second member on that handset is NOT adopted into the first one\'s read position, because the first read closed the window');
  assert(chat.getLastSeen().seq === 0, '…the cursor reads as zero for them, not as 84');

  // THE STATED RESIDUAL, asserted so it is a decision and not a surprise: if
  // the upgrade\'s first resolved read happens under the WRONG member (a shared
  // handset where B signs in first), B adopts one generation of A's COUNTS.
  // Never content — the room itself (cfbp_chat_events_cache) is still swept.
  localStorage.clear();
  localStorage.setItem(K_LASTSEEN, JSON.stringify({ seq: 84, byTag: {} }));
  signedInAs('mKihoon');
  freshRoom();
  assert(chat.unreadCount('mKihoon', 'all') === 0,
    'RESIDUAL (accepted, LOW): on a SHARED handset mid-upgrade, whoever signs in first adopts that one generation of counts — a number, never a message. Every generation after it is strictly owned.');
}

// ── [11] REVIEWER F6 — EVERY WRITE PATH STAMPS ──────────────────────────────
console.log('\n[11] REVIEWER F6 — the epoch self-heal never persists an unstamped cursor…');
{
  // (a) identity NOT resolved — the heal must still persist (it exists to stop
  //     a stale HIGH cursor under-counting after a Clear Chat History), but it
  //     must not leave a cursor anybody can adopt.
  localStorage.clear();
  signedOutIdentity();
  localStorage.setItem(K_LASTSEEN, JSON.stringify({ seq: 40, byTag: { g1: 40 } }));
  storage.saveSetting('chatEpochSeq', 200);
  chat._resetForTest();
  chat.initChat(null);
  const healed = JSON.parse(localStorage.getItem(K_LASTSEEN) || '{}');
  assert(healed.seq === 200 && Object.keys(healed.byTag || {}).length === 0,
    `fixture: the epoch self-heal ran and fast-forwarded the cursor (got ${JSON.stringify(healed)}) — loadtest §[29]'s contract, unchanged`);
  assert(typeof healed.owner === 'string' && healed.owner.length > 0,
    'REVIEWER F6 — …and it is STAMPED even though nobody was resolved when it was written: no write path leaves the owner field missing');
  signedInAs('mDrew');
  assert(healed.owner !== chat._lastSeenOwnerForTest(),
    '…with the NOBODY sentinel, not with some member\'s digest — a write made while identity was unresolved never claims to be anybody');
  assert(chat.getLastSeen().seq === 200,
    'ONE rule for "not claimed" (RG-196): the first RESOLVED read adopts it once — which is right for the heal, since the member on this device is the one whose room was cleared and everything below the epoch is hidden anyway');
  assert(JSON.parse(localStorage.getItem(K_LASTSEEN)).owner === chat._lastSeenOwnerForTest(),
    '…and that read STAMPED it, closing the window: SECURITY B-1\'s strictness applies to an unresolved-identity write exactly as it does to a pre-upgrade one');
  signedInAs('mKihoon');
  assert(chat.getLastSeen().seq === 0,
    '…so a SECOND member gets nothing from it (the one-adoption rule, proven on the F6 path too)');

  // (b) identity resolved — the heal stamps to the member at the device.
  localStorage.clear();
  signedInAs('mDrew');
  localStorage.setItem(K_LASTSEEN, JSON.stringify({ seq: 40, byTag: {}, owner: chat._lastSeenOwnerForTest() }));
  storage.saveSetting('chatEpochSeq', 300);
  chat._resetForTest();
  chat.initChat('mDrew');
  assert(JSON.parse(localStorage.getItem(K_LASTSEEN)).owner === chat._lastSeenOwnerForTest(),
    'REVIEWER F6 — with an identity resolved, the heal stamps the cursor to that member');
  assert(chat.getLastSeen().seq === 300, '…and they keep it (the heal is theirs, not orphaned)');
  storage.saveSetting('chatEpochSeq', 0);
  chat._resetForTest();
}

// ── [12] "IDENTITY UNKNOWN" IS NOT "EVERYTHING IS UNREAD" ───────────────────
//
// INTERPLAY with the boot-flash work in js/chat-ui.js / js/app.js: that side
// stops the badge PAINTING while identity is unresolved. This side makes the
// number itself honest, so the two guards are independent — neither relies on
// the other having fired.
console.log('\n[12] Identity unknown ≠ zero seen (the count function says which)…');
{
  localStorage.clear();
  signedInAs('mDrew');
  freshRoom();
  assert(chat.unreadCount(null, 'all') === 0,
    'RG-196 — with NO identity, unreadCount() is 0, never "every message is unread". Before this, a null selfId passed the `m.author !== selfId` test for all 84.');
  assert(chat.unreadCount(undefined, 'all') === 0, '…same for undefined (the shape app.js actually passes while memberships are in flight)');
  assert(chat.unreadAuthors(null, 'all').length === 0, '…and there is nobody to attribute an unknown count to');
  assert(chat.mentionUnreadCount(null) === 0, '…and no mention inbox either');
  const unknown = chat.unreadCountOrUnknown(null, 'all');
  assert(unknown.known === false && unknown.count === 0,
    `unreadCountOrUnknown(null) reports {known:false, count:0} (got ${JSON.stringify(unknown)}) — the caller can tell "nothing to show yet" from "you are caught up"`);
  const known = chat.unreadCountOrUnknown('mDrew', 'all');
  assert(known.known === true && known.count === 84,
    `unreadCountOrUnknown(self) reports {known:true, count:N} (got ${JSON.stringify(known)})`);
  chat.markSeen('all');
  const caught = chat.unreadCountOrUnknown('mDrew', 'all');
  assert(caught.known === true && caught.count === 0,
    'and "caught up" is {known:true, count:0} — the same number as "unknown", with the flag telling them apart');
}

// ── [13] THE RECONCILIATION — ONE DOOR BETWEEN THE CURSOR AND A PIXEL ───────
//
// v0.23.3 merged two branches that had independently fixed the same defect:
// this file's `unreadCountOrUnknown()` (the number knows whether it is
// answerable) and js/chat-ui.js's `chatViewerUnresolved()` (the paint knows
// whether the viewer is nameable). Each covers a case the other does not —
// PIN-mode anonymity is `{known:false}` with `chatViewerUnresolved()` FALSE,
// and a Supabase hold gate is `chatViewerUnresolved()` TRUE for a viewer who
// may already have a session id. So the UI now reads counts through exactly
// one function, `unreadForRender()`, which returns the {known,count} shape
// with BOTH questions already asked.
//
// §[13a] IS THE TEST THAT FAILS FOR A FUTURE CALLER. It does not assert about
// today's five surfaces; it asserts that the bare number is not reachable in
// that file at all. Somebody adding a sixth surface next season cannot get a
// count without the flag attached to it, because there is no other way in.
console.log('\n[13] The UI reads every count through ONE door, and it carries the flag…');
{
  const rawSrc = readFileSync(new URL('./js/chat-ui.js', import.meta.url), 'utf8');
  // Comments are stripped before counting, because the prose ABOVE the choke
  // point names both functions on purpose. A structural rule that a correct
  // explanatory comment can break is a rule people delete.
  const uiSrc = rawSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  // [13a] STRUCTURAL — the raw count function is not imported and not called.
  const rawCalls = (uiSrc.match(/[^a-zA-Z_$.]unreadCount\s*\(/g) || []).length;
  assert(rawCalls === 0,
    `RECONCILIATION — js/chat-ui.js calls the bare unreadCount() ZERO times (got ${rawCalls}). A surface that renders a number without the answerability flag is exactly the "84 then 0" flash, arrived at from a new direction.`);
  const imported = /\bunreadCount\s*,/.test(uiSrc.split("from './chat.js'")[0] || '');
  assert(imported === false,
    '…and it is not even IMPORTED, so a future caller fails at module load with a ReferenceError rather than silently rendering a plausible zero');
  const doors = (uiSrc.match(/unreadCountOrUnknown\s*\(/g) || []).length;
  assert(doors === 1,
    `…and unreadCountOrUnknown() is CALLED in exactly one place — the unreadForRender() choke point (got ${doors} call sites). The readCursorFor() precedent: "a second copy of this expression is exactly how the dashboard teaser came to disagree with the unread badge".`);
  assert(/function unreadForRender\(/.test(rawSrc) && /export const _unreadForRenderForTest/.test(rawSrc),
    'fixture: the choke point exists under that name and is reachable from a suite');

  // [13b] BEHAVIOURAL — drive the REAL functions with a real (stubbed) DOM.
  // RG-27: a regex over source is not evidence that the wiring is right.
  const badgeCalls = [];
  const navEl = { _b: null,
    querySelector: () => navEl._b,
    appendChild: (el) => { navEl._b = el; },
  };
  // `navigator` is a getter-only own property of globalThis in Node 24 — the
  // boottest.mjs §28 precedent, same defineProperty swap.
  const setNav = (value) => {
    try { globalThis.navigator = value; }
    catch { Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true }); }
  };
  const realDoc = globalThis.document, realNav = globalThis.navigator;
  globalThis.document = {
    ...realDoc,
    title: "IRB Pick 'Ems",
    createElement: () => ({ className: '', textContent: '', remove() { navEl._b = null; } }),
    querySelectorAll: (sel) => (String(sel).includes('data-tab="chat"') ? [navEl] : []),
    querySelector: () => null,
    getElementById: () => null,
  };
  setNav({
    setAppBadge: (n) => { badgeCalls.push(`set:${n}`); return Promise.resolve(); },
    clearAppBadge: () => { badgeCalls.push('clear'); return Promise.resolve(); },
  });
  const chatUi = await import('./js/chat-ui.js');
  try {
    localStorage.clear();
    signedInAs('mDrew');
    freshRoom();                       // 84 unread from somebody else

    // (i) THE HOLD GATE IS UP — a viewer this device may not speak to, who
    //     nonetheless HAS a resolved session id. `unreadCountOrUnknown` alone
    //     would answer {known:true, count:84} here; only the merged door says no.
    chatUi.registerContentWithheldProbe(() => true);
    assert(chatUi._unreadForRenderForTest('mDrew', 'all').known === false,
      'A-1 ∧ RG-196 — with the hold gate up, a viewer WITH a session id still gets {known:false}: the count function alone would have answered 84 here');
    navEl._b = null; badgeCalls.length = 0; globalThis.document.title = "IRB Pick 'Ems";
    chatUi.updateChatBadges();
    assert(navEl._b === null, '…no nav badge element is created');
    assert(!/^\(\d/.test(globalThis.document.title), `…the tab title carries no count (got ${JSON.stringify(globalThis.document.title)})`);
    assert(badgeCalls.length === 0, `…and the installed-app icon is neither set NOR cleared — writing a zero would destroy a true count, not withhold a false one (got ${JSON.stringify(badgeCalls)})`);
    assert(chatUi.dashboardChatTeaserHTML() === '', '…the dashboard teaser renders nothing');
    assert(!/\d/.test(chatUi.gameChatBubbleHTML('g1').replace(/[^>]*>/g, '')) || !/chat-bubble-count/.test(chatUi.gameChatBubbleHTML('g1')),
      '…and the game-card bubble shows no unread count');
    assert(!/chat-unread-dot/.test(chatUi._pillsHTMLForTest()),
      '…and no filter pill carries an unread dot');

    // (ii) NO HOLD, BUT NO IDENTITY — PIN-mode anonymous, a legitimate state.
    //      No number may be painted, but the CLEAR must still happen: leaving a
    //      stale "(7)" on the installed icon after a deliberate sign-out is its
    //      own defect, and it is the one thing the hold-gate branch must not do.
    chatUi.registerContentWithheldProbe(() => false);
    signedOutIdentity();
    navEl._b = null; badgeCalls.length = 0; globalThis.document.title = "(7) IRB Pick 'Ems";
    chatUi.updateChatBadges();
    assert(chatUi._unreadForRenderForTest(null, 'all').known === false,
      'PIN-mode anonymous is {known:false} too — by the OTHER guard, which is why both are needed');
    assert(navEl._b === null, '…still no nav badge digit');
    assert(globalThis.document.title === "IRB Pick 'Ems",
      `…but the stale title count IS taken down (got ${JSON.stringify(globalThis.document.title)}) — clearing is not "rendering a count"`);
    assert(badgeCalls.length === 1 && badgeCalls[0] === 'clear',
      `…and the installed icon is cleared exactly once, never set (got ${JSON.stringify(badgeCalls)})`);

    // (iii) NON-VACUITY — a known viewer still gets the real number by all
    //       four paths. Without this the whole section passes on a dead file.
    signedInAs('mDrew');
    navEl._b = null; badgeCalls.length = 0; globalThis.document.title = "IRB Pick 'Ems";
    chatUi.updateChatBadges();
    assert(navEl._b && navEl._b.textContent === '84',
      `non-vacuity: a KNOWN viewer with 84 unread gets the nav badge (got ${JSON.stringify(navEl._b && navEl._b.textContent)})`);
    assert(globalThis.document.title === "(84) IRB Pick 'Ems", `…and the tab title (got ${JSON.stringify(globalThis.document.title)})`);
    assert(badgeCalls.length === 1 && badgeCalls[0] === 'set:84', `…and the installed icon (got ${JSON.stringify(badgeCalls)})`);
    assert(/chat-unread-dot">84</.test(chatUi._pillsHTMLForTest()), '…and the Locker Room pill dot');
  } finally {
    chatUi.registerContentWithheldProbe(null);
    globalThis.document = realDoc;
    setNav(realNav);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
