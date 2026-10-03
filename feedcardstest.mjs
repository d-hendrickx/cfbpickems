/**
 * CFB Pickems — feedcardstest.mjs (Social Platform v1 Home, DI-362 / DI-363 / DI-373, 2026-09-30)
 * ====================================================================================
 * The proof for js/feed-cards.js (card derivation, the three reveal classes, stable ids, the
 * blind-rule gates, deny-by-default facts, the injected escaper) and js/feed-caption-lines.js
 * (SCRIBE's caption pools, S-C12). The `[BLIND-RULE]` section is the acceptance gate DI-373
 * names: every card type against OPEN / LOCKED / LIVE / FINAL, negative tests each with a
 * POSITIVE CONTROL, the three adversarial fixtures (A: a local-mode-shaped store, B: the RG-45
 * state, C/D: a hidden week next to final ones), and MUTATION PROOFS on scratch copies.
 *
 * Run:  node feedcardstest.mjs      Must be run under BOTH TZ=UTC and TZ=America/Los_Angeles.
 *
 * Sections:
 *   [1]  The catalog: shape, frozen reveal map, allow-lists, reason labels
 *   [2]  isRevealed(): the one gate, deny-by-default
 *   [3]  The matrix — every type x OPEN / LOCKED / LIVE / FINAL, with exact facts
 *   [4]  [BLIND-RULE] S-C1 / S-C4 — the adversarial fixtures A, B, C, D (each negative has a positive control)
 *   [5]  S-C10 picksReadConfirmed; the canViewOtherPicks prohibition; demo weeks
 *   [6]  S-C5 id-construction order (a spy on the id builder)
 *   [7]  Stable ids, determinism, re-derivation, fail-closed inputs, isContentWithheld
 *   [8]  year.ago and the chat-derived cards (DI-372: private / deleted / wager / wrong-league / league switch)
 *   [9]  Copy and escaping (S-C6): the injected escaper is REQUIRED; hostile data stays inert
 *   [10] Captions (S-C12): every placeholder maps to an allow-listed fact; banned vocabulary; determinism
 *   [11] Static scans: no canViewOtherPicks, no chat import, no writes, no DOM
 *   [12] MUTATION PROOFS on scratch copies (never the file): each mutant must turn a NAMED check RED
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}
console.log(`\n[TZ] running under TZ=${process.env.TZ || '(unset)'}\n`);

// ── DOM/browser stubs, same shape as scoringtest.mjs's ──────────────────────
const lsStore = new Map();
globalThis.localStorage = {
  getItem: k => (lsStore.has(k) ? lsStore.get(k) : null),
  setItem: (k, v) => lsStore.set(k, String(v)),
  removeItem: k => lsStore.delete(k),
  clear: () => lsStore.clear(),
};
globalThis.document = {
  addEventListener() {}, removeEventListener() {}, getElementById: () => null,
  querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({ set innerHTML(v) {}, get innerHTML() { return ''; }, appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {}, classList: { add() {}, remove() {} }, style: {}, id: '', className: '' }),
  body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '', dataset: {} },
  hidden: false,
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined }, configurable: true }); }
globalThis.requestAnimationFrame = fn => fn();
globalThis.fetch = async () => { throw new Error('network disabled in feedcardstest'); };
globalThis.matchMedia = () => ({ matches: false });
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };

const fc = await import('./js/feed-cards.js');
const cap = await import('./js/feed-caption-lines.js');
const notifyCopy = await import('./js/notify-copy.js');
const { calculateWeeklyResults } = await import('./js/scoring.js');
const storage = await import('./js/storage.js');
const scribeLines = await import('./js/scribeLines.js');
const hist = await import('./js/history-2025.js');
const fx = await import('./statsfixtures.mjs');

const NOW = Date.parse('2026-09-13T12:00:00.000Z');
const read = (rel) => readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}
function importsOf(src) {
  return [...stripComments(src).matchAll(/import\s+([\s\S]*?)\s+from\s+'([^']+)'/g)].map(m => ({ names: m[1], from: m[2] }));
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// ── fixtures ────────────────────────────────────────────────────────────────
const league = (w2, extra = {}) => fx.buildLeague({ w2, calculateWeeklyResults, ...extra });
const mapStrings = (o, fn) => (typeof o === 'string' ? fn(o) : Array.isArray(o) ? o.map(x => mapStrings(x, fn)) : (o && typeof o === 'object') ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, mapStrings(v, fn)])) : o);

const CHAT = {
  scribe: [
    { id: 'm_s1', ts: 1757000000000, author: 'scribe', authorName: 'SCRIBE', body: 'A quiet week. Somebody has to be quiet.', reactionCount: 0 },
    { id: 'm_s2', ts: 1757000100000, author: 'scribe', authorName: 'SCRIBE', body: 'Wager logged: Drew has Kevin on a steak dinner.', meta: { kind: 'wagerLogged' } },
    { id: 'm_s2b', ts: 1757000150000, author: 'scribe', authorName: 'SCRIBE', body: 'Wager due: Kevin owes Drew a steak dinner.', metaKind: 'wagerDue' },
    { id: 'm_s3', ts: 1757000200000, author: 'scribe', authorName: 'SCRIBE', body: 'a deleted SCRIBE line', deleted: true },
    { id: 'm_s4', ts: 1757000300000, author: 'scribe', authorName: 'SCRIBE', body: 'a private self-test row', visibleTo: 'p1' },
    { id: 'm_s5', ts: 1757000400000, author: 'scribe', authorName: 'SCRIBE', body: 'a line from ANOTHER league', leagueId: 'OTHER' },
    { id: 'm_s6', ts: 1757000500000, author: 'p3', authorName: 'Kevin', body: 'a human whose row landed in the scribe list' },
    // REAL-SHAPED private rows (reviewer note 6): both are author:'system' — the client never receives visible_to — so it is the
    // author filter that normally drops them, and the id/meta signature that holds when an author is mis-stamped.
    { id: 'sys_test_' + 'a1b2c3d4'.repeat(4), ts: 1757000600000, author: 'system', authorName: 'System', body: 'Push self-test: this device is reachable.', meta: { test: true } },
    { id: 'sys_scribe_changelog_L7__private', ts: 1757000700000, author: 'system', authorName: 'System', body: 'SCRIBE learned something private about you.', meta: { kind: 'scribeChangelog', playerId: 'p1' } },
    { id: 'sys_test_' + 'f0e1d2c3'.repeat(4), ts: 1757000800000, author: 'scribe', authorName: 'SCRIBE', body: 'A self-test row with a MIS-STAMPED author.', meta: { test: true } },
    { id: 'sys_scribe_changelog_L9__private', ts: 1757000900000, author: 'scribe', authorName: 'SCRIBE', body: 'A private changelog row with a MIS-STAMPED author.', meta: { kind: 'scribeChangelog', playerId: 'p2' } },
    // a PUBLIC SCRIBE post whose id also starts with sys_ (the what's-new post) must keep rendering
    { id: 'sys_whatsnew_v0_28_0', ts: 1756999000000, author: 'scribe', authorName: 'SCRIBE', body: "What's new in v0.28.0: the Home tab is on its way.", reactionCount: 0 },
  ],
  lockerRoom: [
    { id: 'm_l1', ts: 1757000000000, author: 'p3', authorName: 'Kevin', body: 'mid take', reactionCount: 3 },
    { id: 'm_l2', ts: 1757000010000, author: 'p2', authorName: 'Brayden', body: 'the most-reacted line, then deleted', reactionCount: 9, deleted: true },
    { id: 'm_l3', ts: 1757000020000, author: 'p4', authorName: 'Koby', body: 'a private row with 8 reactions', reactionCount: 8, visibleTo: 'p1' },
    { id: 'm_l4', ts: 1757000030000, author: 'p5', authorName: 'Jacob', body: 'the real winner of the day', reactionCount: 4 },
    { id: 'm_l5', ts: 1757000040000, author: 'scribe', authorName: 'SCRIBE', body: 'a SCRIBE line with 11 reactions', reactionCount: 11 },
    { id: 'm_l6', ts: 1757000050000, author: 'p6', authorName: 'Kihoon', body: 'quiet', reactionCount: 2 },
    { id: 'm_l7', ts: 1757000060000, author: 'p1', authorName: 'Drew', body: 'a wager receipt typed by a person', reactionCount: 7, meta: { kind: 'wagerLogged' } },
    { id: 'm_l8', ts: 1757000070000, author: 'p2', authorName: 'Brayden', body: 'from ANOTHER league', reactionCount: 6, leagueId: 'OTHER' },
    // real-shaped private rows with enormous reaction counts: the author filter drops the system ones, the signature the mis-stamped one
    { id: 'sys_test_' + '0123abcd'.repeat(4), ts: 1757000080000, author: 'system', authorName: 'System', body: 'Push self-test row in the Locker Room list.', reactionCount: 40, meta: { test: true } },
    { id: 'sys_scribe_changelog_L7__private', ts: 1757000090000, author: 'system', authorName: 'System', body: 'private SCRIBE changelog in the Locker Room list', reactionCount: 41, meta: { kind: 'scribeChangelog', playerId: 'p1' } },
    { id: 'sys_test_' + '89abcdef'.repeat(4), ts: 1757000095000, author: 'p4', authorName: 'Koby', body: 'a self-test row with a MIS-STAMPED human author', reactionCount: 42, meta: { test: true } },
  ],
};

function snapshotWith(F, L, o = {}) {
  const confirmed = o.confirmed || ((w) => w.status);
  // `bypassView` disables the CALLER's S-C2 layer: the snapshot's revealed* are the raw, UNFILTERED league (the security probe's
  // shape) — only deriveCards' own re-application (C1) then stands between a hidden week and a visible week's aggregates.
  const view = o.bypassView
    ? { revealedWeeks: L.weeks, revealedGames: L.games, revealedPicks: L.picks, revealedWeeklyResults: L.weeklyResults }
    : F.buildRevealedView({ weeks: L.weeks, games: L.games, picks: L.picks, weeklyResults: L.weeklyResults, confirmedStatusFor: o.viewConfirmed || confirmed, includeDemo: !!o.includeDemo });
  const pr = o.picksConfirmed === undefined ? true : o.picksConfirmed;
  const prMap = (pr && typeof pr === 'object') ? pr : Object.fromEntries(L.weeks.map(w => [w.weekId, pr]));
  return {
    leagueId: 'L1', players: L.players, weeks: L.weeks, games: L.games, picks: L.picks, ...view,
    confirmedStatusFor: confirmed, picksReadConfirmed: prMap,
    submissionCounts: 'counts' in o ? o.counts : { w2: { submittedCount: 6, totalPlayers: 6 } },
    chatCandidates: o.chat === undefined ? CHAT : o.chat,
    currentWeekId: 'w2', todayKey: '2026-09-12', ...(o.snap || {}),
  };
}
const derive = (F, snap, opts = {}) => F.deriveCards(snap, { viewerId: 'p1', now: NOW, ...opts });
const ofType = (cards, type, weekId) => cards.filter(c => c.type === type && (weekId === undefined || c.weekId === weekId));
const countTypes = (cards, weekId) => {
  const out = {};
  for (const c of cards) if (c.weekId === weekId) out[c.type] = (out[c.type] || 0) + 1;
  return out;
};
const FINAL_SET = league('final'), LIVE_SET = league('live'), OPEN_SET = league('open'), LOCKED_SET = league('locked');
const cardsFinal = derive(fc, snapshotWith(fc, FINAL_SET));
const cardsLive = derive(fc, snapshotWith(fc, LIVE_SET));
const cardsOpen = derive(fc, snapshotWith(fc, OPEN_SET));
const cardsLocked = derive(fc, snapshotWith(fc, LOCKED_SET));
const byMember = (cards, type, weekId) => Object.fromEntries(ofType(cards, type, weekId).map(c => [c.memberId, c.facts]));

// ═══════════════════════════════════════════════════════════════════════════
console.log('[1] The catalog — shape, the frozen reveal map, allow-lists, reason labels…');
// ═══════════════════════════════════════════════════════════════════════════
{
  assert(fc.CARD_TYPES.length === 15 && Object.isFrozen(fc.CARD_TYPES), '1-1: the v1 catalog has the 15 stats-feed types (news.headline is UX-2\'s), frozen');
  assert(Object.isFrozen(fc.CARD_REVEAL_CLASS) && fc.CARD_TYPES.every(t => ['never', 'after-reveal', 'after-final'].includes(fc.CARD_REVEAL_CLASS[t])),
    '1-2: CARD_REVEAL_CLASS is FROZEN and declares one of the three known classes for every type — read from a map, never computed ad hoc');
  const want = { 'slate.published': 'never', 'picks.submitted': 'never', 'week.revealed': 'never', 'game.final': 'after-reveal', 'called.it': 'after-reveal', 'stood.alone': 'after-reveal',
    'week.result': 'after-final', 'player.week': 'after-final', 'rank.changed': 'after-final', 'streak.extended': 'after-final', 'streak.broken': 'after-final', 'milestone.reached': 'after-final',
    'year.ago': 'never', 'scribe.post': 'never', 'lockerroom.top': 'never' };
  assert(JSON.stringify(fc.CARD_REVEAL_CLASS) === JSON.stringify(want),
    '1-3: S-C1 — game.final / called.it / stood.alone are after-reveal (per-game finality), NOT after-final; week.result / player.week / rank.changed / streak.* / milestone.reached are after-final; the rest never');
  assert(Object.isFrozen(fc.CARD_ALLOWED_FACTS) && fc.CARD_TYPES.every(t => Array.isArray(fc.CARD_ALLOWED_FACTS[t])), '1-4: every type has an allow-list, and the map is frozen');
  const forbidden = notifyCopy.FORBIDDEN_META_KEYS;
  const offenders = Object.entries(fc.CARD_ALLOWED_FACTS).flatMap(([t, ks]) => ks.filter(k => forbidden.includes(k)).map(k => `${t}:${k}`));
  assert(offenders.length === 0, `1-5: no allow-list contains a FORBIDDEN_META_KEYS entry (${forbidden.join(',')}) — offenders: ${offenders.join(',') || 'none'}`);
  assert(!Object.values(fc.CARD_ALLOWED_FACTS).some(ks => ks.includes('margin')), '1-6: `margin` is in no allow-list (called.it / game.final carry pre-formatted scoreLine / marginCovered instead)');
  assert(!Object.values(fc.CARD_ALLOWED_FACTS).some(ks => ks.some(k => /spread$|^spread|selectedTeam|teamPick|favorite|tiebreak|extraPoint/i.test(k) && k !== 'spreadDisplay')),
    '1-7: no allow-listed fact is a raw spread, a selection, a favorite, a tiebreaker or an Extra Point fact (spreadDisplay is the one pre-formatted display string)');

  const SHAPE = ['id', 'type', 'sport', 'leagueId', 'weekId', 'memberId', 'gameId', 'requiresReveal', 'facts', 'reason', 'sortKey'];
  const all = [...cardsFinal, ...cardsLive, ...cardsOpen, ...cardsLocked];
  assert(all.length > 100 && all.every(c => JSON.stringify(Object.keys(c)) === JSON.stringify(SHAPE)), `1-8: every card (${all.length}) has exactly DI-362's shape: ${SHAPE.join(', ')}`);
  assert(all.every(c => c.requiresReveal === fc.CARD_REVEAL_CLASS[c.type]), '1-9: every card\'s requiresReveal equals its TYPE\'s class from the frozen map');
  assert(all.every(c => Object.keys(c.facts).every(k => fc.CARD_ALLOWED_FACTS[c.type].includes(k))), '1-10: every card\'s facts contain ONLY keys on its type\'s allow-list (deny-by-default at the object)');
  assert(all.every(c => fc.CARD_REASON_LABELS.includes(c.reason) && c.reason !== ''), '1-11: every card carries one of the fixed reason labels (UN-329)');
  assert(JSON.stringify(fc.CARD_REASON_LABELS.slice().sort()) === JSON.stringify(['A year ago this week', 'In the Locker Room', 'In this week\'s slate', 'In your league', 'SCRIBE', 'This week', 'Your milestone', 'Your pick', 'Your streak', 'Your week'].sort()),
    '1-12: the closed set of reason labels is exactly DI-363\'s');
  assert(all.every(c => c.sport === null ? c.weekId === null : c.sport === 'cfb'), '1-13: sport comes off the week (default "cfb" — createWeek() never sets .sport) and is null for a card with no week');
  assert(all.every(c => typeof c.sortKey === 'string' && !Number.isNaN(Date.parse(c.sortKey))), '1-14: sortKey is an ISO timestamp (ordering only, never rendered)');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[2] isRevealed() — the ONE gate, deny-by-default…');
// ═══════════════════════════════════════════════════════════════════════════
{
  const wk = (status) => ({ weekId: 'w', status, dataSourceMode: 'espn_live' });
  const gm = (status, weekId = 'w') => ({ gameId: 'g', weekId, status });
  const ctx = (week, game, c) => ({ week, game, confirmedWeekStatus: c, viewerId: 'p1', now: NOW });
  const D = (requiresReveal, gameId = null) => ({ requiresReveal, gameId });
  assert(fc.isRevealed(D('never'), ctx(null, null, null)) === true, '2-1: "never" is true with no week at all (counts / announcements / closed history)');
  for (const bad of ['bogus', undefined, null, '', 'AFTER-FINAL', 'after_final', 0, true, {}]) {
    assert(fc.isRevealed({ requiresReveal: bad }, ctx(wk('final'), gm('final'), 'final')) === false, `2-2: an unknown requiresReveal (${JSON.stringify(bad)}) is REFUSED, even for a final week with a final game`);
  }
  assert(fc.isRevealed(null, ctx(wk('final'), null, 'final')) === false && fc.isRevealed(undefined) === false, '2-3: no descriptor → false, never a throw');
  // after-reveal, week-scoped (no gameId): arePicksPublic only
  const pub = { open: false, locked: false, live: true, final: true };
  for (const [st, want] of Object.entries(pub)) assert(fc.isRevealed(D('after-reveal'), ctx(wk(st), null, st)) === want, `2-4: after-reveal (week-scoped) in a ${st.toUpperCase()} week → ${want} (arePicksPublic: LIVE or FINAL only, never LOCKED)`);
  assert(fc.isRevealed(D('after-reveal'), ctx(null, null, null)) === false, '2-5: after-reveal with no week → false');
  // after-reveal, game-scoped: public AND this game final AND this game belongs to this week
  for (const [st, wantPub] of Object.entries(pub)) {
    assert(fc.isRevealed(D('after-reveal', 'g'), ctx(wk(st), gm('final'), st)) === wantPub, `2-6: game-scoped after-reveal, FINAL game in a ${st.toUpperCase()} week → ${wantPub} (RG-45: finality of the game alone is never enough)`);
  }
  assert(fc.isRevealed(D('after-reveal', 'g'), ctx(wk('live'), gm('live'), 'live')) === false, '2-7: a LIVE game in a revealed (LIVE) week → false (the symmetric case: the week is public, this game is not done)');
  assert(fc.isRevealed(D('after-reveal', 'g'), ctx(wk('live'), gm('scheduled'), 'live')) === false, '2-8: a scheduled game → false');
  assert(fc.isRevealed(D('after-reveal', 'g'), ctx(wk('live'), null, 'live')) === false, '2-9: a game-scoped candidate with NO game object → false');
  assert(fc.isRevealed(D('after-reveal', 'g'), ctx(wk('live'), gm('final', 'OTHER'), 'live')) === false, '2-10: a final game that belongs to a DIFFERENT week is not this week\'s game → false');
  // after-final: public AND the SERVER-CONFIRMED status is 'final' (RG-253)
  let table = 0, wrong = [];
  for (const st of ['open', 'locked', 'live', 'final']) for (const c of [null, undefined, 'open', 'locked', 'live', 'final', 'FINAL']) {
    const want = pub[st] && c === 'final';
    if (fc.isRevealed(D('after-final'), ctx(wk(st), null, c)) !== want) wrong.push(`${st}/${c}`);
    table++;
  }
  assert(wrong.length === 0 && table === 28, `2-11: after-final is true ONLY when the week is public AND confirmedWeekStatus === 'final' (28-cell matrix; wrong: ${wrong.join(',') || 'none'}) — a mirror that says FINAL while the server says LIVE (RG-253) is denied`);
  assert(fc.isRevealed(D('after-final', 'g'), ctx(wk('final'), gm('live'), 'final')) === true, '2-12: after-final is WEEK-scoped: it does not look at any one game\'s status');
  // the gate asks arePicksPublic(), the same function the app asks
  assert(['open', 'locked', 'live', 'final'].every(st => storage.arePicksPublic(wk(st)) === pub[st]), '2-13: fixture check — storage.arePicksPublic() agrees with the matrix above (LIVE or FINAL), so the gate rides the real function');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[3] The matrix — every card type x OPEN / LOCKED / LIVE / FINAL (week 2; week 1 is final in every state)…');
// ═══════════════════════════════════════════════════════════════════════════
const W2_EXPECT = {
  //                     OPEN LOCKED LIVE FINAL
  'slate.published':    [1, 1, 1, 1],
  'picks.submitted':    [1, 0, 0, 0],
  'week.revealed':      [0, 0, 1, 0],
  'game.final':         [0, 0, 1, 4],
  'called.it':          [0, 0, 4, 4],
  'stood.alone':        [0, 0, 0, 1],
  'week.result':        [0, 0, 0, 1],
  'player.week':        [0, 0, 0, 6],
  'rank.changed':       [0, 0, 0, 5],
  'streak.extended':    [0, 0, 0, 2],
  'streak.broken':      [0, 0, 0, 2],
  'milestone.reached':  [0, 0, 0, 0],
  'year.ago':           [1, 1, 1, 1],
};
const W1_EXPECT = { 'slate.published': 1, 'game.final': 5, 'called.it': 3, 'stood.alone': 1, 'week.result': 1, 'player.week': 6, 'rank.changed': 0, 'streak.extended': 2, 'streak.broken': 0, 'milestone.reached': 0 };
{
  const states = [['OPEN', cardsOpen], ['LOCKED', cardsLocked], ['LIVE', cardsLive], ['FINAL', cardsFinal]];
  for (const [type, counts] of Object.entries(W2_EXPECT)) {
    states.forEach(([name, cards], i) => {
      const got = ofType(cards, type, 'w2').length;
      assert(got === counts[i], `3: week 2 ${type} × ${name} → ${counts[i]} card(s)${counts[i] === 0 ? ' (the gate holds)' : ''} — got ${got}`);
    });
  }
  for (const [name, cards] of states) {
    const c1 = countTypes(cards, 'w1');
    const same = Object.entries(W1_EXPECT).every(([t, n]) => (c1[t] || 0) === n);
    assert(same, `3-w1: POSITIVE CONTROL — week 1 (final & revealed) produces its full set in the ${name} state, so a zero for week 2 is the GATE's doing, not an empty fixture (${JSON.stringify(c1)})`);
  }
  assert(ofType(cardsOpen, 'scribe.post').length === 2 && ofType(cardsOpen, 'lockerroom.top').length === 1 && ofType(cardsFinal, 'scribe.post').length === 2, '3-chat: scribe.post (2 of 12 candidates) and lockerroom.top (1) are never-class and render in every state');
  assert(ofType(cardsOpen, 'picks.submitted').every(c => c.facts.submittedCount === 6 && c.facts.totalPlayers === 6 && Object.keys(c.facts).length === 3), '3-counts: picks.submitted is COUNTS ONLY — weekN, submittedCount, totalPlayers, nothing else');
  assert(ofType(derive(fc, snapshotWith(fc, OPEN_SET, { counts: {} })), 'picks.submitted').length === 0 && ofType(derive(fc, snapshotWith(fc, OPEN_SET, { counts: { w2: null } })), 'picks.submitted').length === 0,
    '3-unknown: an UNKNOWN count (absent / null) yields NO picks.submitted card — "we do not know" is never rendered as zero (DI-T4.11)');
  assert(ofType(cardsLive, 'week.revealed')[0].facts.weekN === 2 && ofType(cardsLive, 'week.revealed')[0].facts.submittedCount === 6, '3-revealed: week.revealed announces the reveal with counts only — no selection anywhere in it');
}
// exact facts, hand-derived
{
  const F = cardsFinal;
  const wr = (w) => ofType(F, 'week.result', w)[0].facts;
  assert(JSON.stringify(wr('w2')) === JSON.stringify({ weekN: 2, weekWinnerName: 'Jacob', weekWinnerRecord: '4–0', weekLoserName: 'Kevin', weekLoserRecord: '0–4' }), `3-f1: week 2 result — Jacob 4–0 took it, Kevin 0–4 (RAW counts, en dash) (got ${JSON.stringify(wr('w2'))})`);
  assert(wr('w1').weekWinnerName === 'Drew' && wr('w1').weekWinnerRecord === '4–1' && wr('w1').weekLoserName === 'Kihoon' && wr('w1').weekLoserRecord === '1–4', '3-f2: week 1 result — Drew 4–1, Kihoon 1–4');
  const g21 = ofType(F, 'game.final', 'w2').find(c => c.gameId === 'g21').facts;
  assert(g21.awayTeam === 'Washington' && g21.homeTeam === 'Oregon' && g21.awayScore === 20 && g21.homeScore === 17 && g21.atsWinnerTeam === 'Washington' && g21.marginCovered === '10',
    `3-f3: g21 — Washington 20, Oregon 17, Washington covered by 10 (home -7: 17-7 = 10 vs 20) (got ${JSON.stringify({ ...g21, chips: undefined })})`);
  assert(JSON.stringify(g21.chips) === JSON.stringify([{ playerId: 'p1', initials: 'DH', result: 'loss' }, { playerId: 'p2', initials: 'BR', result: 'win' }, { playerId: 'p3', initials: 'KC', result: 'loss' }, { playerId: 'p4', initials: 'KR', result: 'win' }, { playerId: 'p5', initials: 'JP', result: 'win' }, { playerId: 'p6', initials: 'KB', result: 'win' }]),
    '3-f4: g21 chips are [{playerId, initials, result}] with result win|loss ONLY — no team name per player');
  const g11 = ofType(F, 'game.final', 'w1').find(c => c.gameId === 'g11').facts;
  assert(g11.atsWinnerTeam === 'Clemson' && g11.marginCovered === '11', '3-f5: g11 — Clemson (-3) won 24-10, covered by 11');
  const ci = byMember(F, 'called.it', 'w2');
  assert(JSON.stringify(Object.keys(ci).sort()) === '["p2","p4","p5","p6"]' && ci.p2.team === 'Washington' && ci.p2.matchup === 'Washington at Oregon' && ci.p2.spreadDisplay === '+7' && ci.p2.scoreLine === '20–17',
    `3-f6: g21 called.it — p2/p4/p5/p6 took the +7 underdog that won outright; display "+7", "20–17" (got ${JSON.stringify(Object.keys(ci))} ${JSON.stringify(ci.p2)})`);
  const w1ci = byMember(F, 'called.it', 'w1');
  assert(JSON.stringify(Object.keys(w1ci).sort()) === '["p1","p4","p5"]', '3-f7: week 1 g13 called.it — p1, p4, p5 (the picks on Oklahoma +7)');
  const sa = ofType(F, 'stood.alone', 'w2')[0];
  assert(sa.memberId === 'p5' && sa.facts.team === 'Miami' && sa.facts.against === 5 && sa.facts.matchup === 'Florida State at Miami', `3-f8: g22 stood.alone — p5 on Miami against 5 (got ${JSON.stringify(sa.facts)})`);
  const pw = byMember(F, 'player.week', 'w2');
  assert(pw.p5.wins === 4 && pw.p5.losses === 0 && pw.p5.streakRun === 5 && pw.p5.streakKind === 'covers', `3-f9: player.week p5 — 4–0 on a 5-game covers streak (got ${JSON.stringify(pw.p5)})`);
  assert(pw.p3.wins === 0 && pw.p3.losses === 4 && pw.p3.streakRun === 4 && pw.p3.streakKind === 'misses', '3-f10: player.week p3 — 0–4 on a 4-game MISS streak');
  assert(pw.p1.wins === 1 && pw.p1.losses === 3 && !('streakRun' in pw.p1) && !('streakKind' in pw.p1), '3-f11: player.week p1 — 1–3, streak keys ABSENT below STREAK_MIN (absent, not zero)');
  const rk = byMember(F, 'rank.changed', 'w2');
  assert(JSON.stringify(Object.keys(rk).sort()) === '["p1","p3","p4","p5","p6"]' && rk.p5.fromRank === 2 && rk.p5.toRank === 1 && rk.p3.fromRank === 4 && rk.p3.toRank === 6 && rk.p1.fromRank === 1 && rk.p1.toRank === 2 && rk.p4.fromRank === 5 && rk.p4.toRank === 4 && rk.p6.fromRank === 6 && rk.p6.toRank === 5 && rk.p5.rankedCount === 6,
    `3-f12: rank.changed — p5 2→1, p1 1→2, p4 5→4, p6 6→5, p3 4→6; p2 (3→3) has none (got ${JSON.stringify(Object.keys(rk))})`);
  const se = byMember(F, 'streak.extended', 'w2'), sb = byMember(F, 'streak.broken', 'w2');
  assert(JSON.stringify(Object.keys(se).sort()) === '["p3","p5"]' && se.p3.run === 4 && se.p3.kind === 'misses' && se.p5.run === 5 && se.p5.kind === 'covers', `3-f13: streak.extended — p3 4 misses, p5 5 covers (got ${JSON.stringify(se)})`);
  assert(JSON.stringify(Object.keys(sb).sort()) === '["p1","p6"]' && sb.p1.run === 4 && sb.p1.kind === 'covers' && sb.p6.run === 3 && sb.p6.kind === 'misses', `3-f14: streak.broken — p1's 4-cover run, p6's 3-miss run (got ${JSON.stringify(sb)})`);
  const se1 = byMember(F, 'streak.extended', 'w1');
  assert(JSON.stringify(Object.keys(se1).sort()) === '["p1","p6"]' && se1.p1.run === 4 && se1.p6.kind === 'misses', '3-f15: week 1 streak.extended — p1 4 covers, p6 3 misses (the same players\' week-2 cards are DIFFERENT facts: through-week slicing)');
  assert(ofType(F, 'streak.broken', 'w1').length === 0, '3-f16: a streak cannot break in week 1 — there was nothing before it (SCRIBE\'s "prior" rule)');
  // reasons: self vs others
  assert(ofType(F, 'player.week', 'w2').find(c => c.memberId === 'p1').reason === 'Your week' && ofType(F, 'player.week', 'w2').find(c => c.memberId === 'p2').reason === 'In your league', '3-f17: reason — the viewer\'s own player.week is "Your week", everyone else\'s "In your league"');
  assert(ofType(F, 'called.it', 'w1').find(c => c.memberId === 'p1').reason === 'Your pick' && ofType(F, 'streak.broken', 'w2').find(c => c.memberId === 'p1').reason === 'Your streak' && ofType(F, 'week.result', 'w2')[0].reason === 'In your league' && ofType(F, 'game.final', 'w2')[0].reason === "In this week's slate",
    '3-f18: reasons — Your pick / Your streak / In your league / In this week\'s slate');
  const anon = derive(fc, snapshotWith(fc, FINAL_SET), { viewerId: null });
  assert(anon.length === cardsFinal.length && !anon.some(c => c.reason.startsWith('Your')), '3-f19: with NO viewer every card is third-person — never a "Your …" label');
  assert(JSON.stringify(cardsFinal.map(c => c.id)) === JSON.stringify(anon.map(c => c.id)), '3-f20: the viewer changes reasons only — never which cards exist, never an id');
}
// milestone.reached — a 24 -> 25 crossing needs a season total no small fixture reaches, so rows are hand-written
{
  const L = league('final');
  const rows = L.weeklyResults.map(r => (r.playerId === 'p1' && r.weekId === 'w1') ? { ...r, correctCount: 24, correctPicks: 24, incorrectCount: 0, incorrectPicks: 0 }
    : (r.playerId === 'p2' && r.weekId === 'w1') ? { ...r, correctCount: 49, correctPicks: 49 } : r);
  const cards = derive(fc, snapshotWith(fc, { ...L, weeklyResults: rows }));
  const ms = ofType(cards, 'milestone.reached', 'w2');
  const by = Object.fromEntries(ms.map(c => [c.memberId, c.facts]));
  assert(ms.length === 2 && by.p1.mark === 25 && by.p1.total === 25 && by.p2.mark === 50 && by.p2.total === 52, `3-m1: milestone.reached — p1 24→25 crosses 25 (total 25); p2 49→52 crosses 50 (total 52); p3 2→2 nothing (got ${JSON.stringify(by)})`);
  assert(ms.find(c => c.memberId === 'p1').id === 'milestone.reached:L1:w2:p1:25' && ms.find(c => c.memberId === 'p1').reason === 'Your milestone', '3-m2: the id carries the mark (two marks in one week stay two cards) and the reason is "Your milestone" for the viewer');
  const m1 = ofType(cards, 'milestone.reached', 'w1');
  assert(m1.length === 1 && m1[0].memberId === 'p2' && m1[0].facts.mark === 25 && m1[0].facts.total === 49,
    `3-m3: a crossing happens ONCE — week 1 (everyone starts at 0): p2 0→49 crosses 25 (total 49) and p1 0→24 crosses nothing; week 2 does NOT re-announce p2's 25 (49→52 crosses only 50) (got ${JSON.stringify(m1.map(c => [c.memberId, c.facts.mark, c.facts.total]))})`);
  const near = rows.map(r => (r.playerId === 'p5' && r.weekId === 'w1') ? { ...r, correctCount: 20, correctPicks: 20 } : r);
  assert(derive(fc, snapshotWith(fc, { ...L, weeklyResults: near })).filter(c => c.type === 'milestone.reached' && c.memberId === 'p5').length === 0,
    '3-m4: p5 at 20 after week 1 plus 4 in week 2 is 24 — one short of 25, so NO milestone card (a near miss is not announced)');
  const over = rows.map(r => (r.playerId === 'p5' && r.weekId === 'w1') ? { ...r, correctCount: 22, correctPicks: 22 } : r);
  const crossed = derive(fc, snapshotWith(fc, { ...L, weeklyResults: over })).filter(c => c.type === 'milestone.reached' && c.memberId === 'p5');
  assert(crossed.length === 1 && crossed[0].facts.mark === 25 && crossed[0].facts.total === 26 && crossed[0].reason === 'In your league',
    `3-m5: p5 at 22 plus 4 is 26 — crosses 25 once, total 26, third-person for a viewer who is not p5 (got ${JSON.stringify(crossed.map(c => [c.facts, c.reason]))})`);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[4] [BLIND-RULE] S-C1 / S-C4 — the adversarial fixtures (each negative test has a positive control)…');
// ═══════════════════════════════════════════════════════════════════════════
const W2_TEAMS = ['Oregon', 'Washington', 'Miami', 'Florida State', 'Penn State', 'Iowa', 'USC', 'UCLA'];
const W3_TEAMS = ['Tennessee', 'Kentucky', 'Georgia Tech'];
const GAME_TYPES = ['game.final', 'called.it', 'stood.alone'];
const AGG_TYPES = ['week.result', 'player.week', 'rank.changed', 'streak.extended', 'streak.broken', 'milestone.reached'];
function blindChecks(F) {
  const out = {};
  const cardsFor = (w2, o = {}, lo = {}) => derive(F, snapshotWith(F, league(w2, lo), o));
  // Fixture A — a LOCAL-MODE-SHAPED store: every player's picks are present for an OPEN and a LOCKED week (no RLS narrowing at all).
  {
    for (const st of ['open', 'locked']) {
      const c = cardsFor(st);
      const json = JSON.stringify(c.filter(x => x.weekId === 'w2' || x.weekId === null));
      out[`A-${st} no week-2 team name appears in ANY card while the week is ${st.toUpperCase()}, with every player's picks in the store`] = W2_TEAMS.every(t => !json.includes(t));
      out[`A-${st} no game-scoped or after-final card exists for week 2`] = !c.some(x => x.weekId === 'w2' && (GAME_TYPES.includes(x.type) || AGG_TYPES.includes(x.type)));
    }
    const fin = JSON.stringify(cardsFor('final').filter(x => x.weekId === 'w2'));
    out['A+ positive control: once week 2 is FINAL the same scan finds week-2 team names — the scan can see what it looks for'] = fin.includes('Washington') && fin.includes('Miami');
  }
  // Fixture B — the RG-45 state: a FINAL game inside an OPEN week.
  {
    const c = cardsFor('open', {}, { w2Finals: ['g21'] });
    out['B1 RG-45: a FINAL game in an OPEN week produces no game.final / called.it / stood.alone'] = !c.some(x => GAME_TYPES.includes(x.type) && x.weekId === 'w2');
    const lc = cardsFor('locked', {}, { w2Finals: ['g21', 'g22'] });
    out['B1b …nor in a LOCKED week with two final games'] = !lc.some(x => GAME_TYPES.includes(x.type) && x.weekId === 'w2');
    const pos = cardsFor('live', {}, { w2Finals: ['g21'] });
    out['B1+ positive control: the SAME final game once the week is LIVE (revealed) DOES produce game.final + 4 called.it'] = ofType(pos, 'game.final', 'w2').length === 1 && ofType(pos, 'called.it', 'w2').length === 4;
  }
  // The symmetric case: a still-LIVE game inside a REVEALED week.
  {
    const c = cardsFor('live');
    out['B2 a still-LIVE game (g22, whose lone-wolf picks exist) in a revealed week produces no game card'] = !c.some(x => x.gameId === 'g22' || x.gameId === 'g23' || x.gameId === 'g24');
    const pos = cardsFor('live', {}, { w2Finals: ['g22'] });
    out['B2+ positive control: finish g22 and its game.final + stood.alone appear'] = ofType(pos, 'game.final', 'w2').some(x => x.gameId === 'g22') && ofType(pos, 'stood.alone', 'w2').length === 1;
  }
  // RG-253: the mirror says FINAL, the SERVER says LIVE. The per-candidate gate must hold even when the assembled view was wrong.
  {
    const L = league('final');
    const serverSaysLive = (w) => (w.weekId === 'w2' ? 'live' : w.status);
    const snap = snapshotWith(F, L, { confirmed: serverSaysLive, viewConfirmed: (w) => w.status });   // view built from the (wrong) mirror, gate from the server
    const c = derive(F, snap);
    out['B3 RG-253: confirmed status LIVE while the mirror says FINAL → NO after-final card for week 2, even though the assembled view wrongly included it'] = !c.some(x => x.weekId === 'w2' && AGG_TYPES.includes(x.type));
    out['B3b …and the after-reveal game cards (the week IS public) still appear — the two classes are independent'] = ofType(c, 'game.final', 'w2').length === 4;
    const pos = derive(F, snapshotWith(F, L));
    out['B3+ positive control: confirmed FINAL → the after-final cards appear'] = ofType(pos, 'week.result', 'w2').length === 1 && ofType(pos, 'rank.changed', 'w2').length === 5;
  }
  // FIXTURE C — DI-373's LITERAL named fixture (reviewer condition 2): "a final week W followed by an open week W+1 that also contains a final game:
  // W+1's final game must not produce game.final/called.it/stood.alone (W+1 itself is not revealed), AND W+1's picks/results must not leak into
  // W's (or the season's) rank.changed/streak.*/milestone.reached aggregates." Checked at the FACT level, card by card.
  {
    const L = league('open', { w2Finals: ['g21'], staleW2Rows: true });                       // W = w1 (FINAL), W+1 = w2 (OPEN, g21 FINAL, stale final-shaped rows in storage)
    const only = { ...L, weeks: L.weeks.filter(w => w.weekId === 'w1'), games: L.games.filter(g => g.weekId === 'w1'), picks: L.picks.filter(p => p.weekId === 'w1'), weeklyResults: L.weeklyResults.filter(r => r.weekId === 'w1') };
    const withW1 = derive(F, snapshotWith(F, L));
    const alone = derive(F, snapshotWith(F, only, { snap: { currentWeekId: 'w1' } }));
    const factsOf = (cs, type, wk) => Object.fromEntries(ofType(cs, type, wk).map(c => [c.memberId ?? c.gameId ?? '-', JSON.stringify(c.facts)]));
    out['FC0 fixture check: W+1 really is an OPEN week holding a FINAL game, with final-shaped rows already in the store'] =
      L.weeks.find(w => w.weekId === 'w2').status === 'open' && L.games.find(g => g.gameId === 'g21').status === 'final' && L.weeklyResults.some(r => r.weekId === 'w2');
    out['FC1 W+1\'s final game (g21) produces no game.final / called.it / stood.alone — nor any other card keyed to it'] =
      !withW1.some(c => c.gameId === 'g21' || (c.weekId === 'w2' && GAME_TYPES.includes(c.type)));
    out['FC2 W+1 contributes NO aggregate card of any type (week.result, player.week, rank.changed, streak.*, milestone.reached)'] = !withW1.some(c => c.weekId === 'w2' && AGG_TYPES.includes(c.type));
    out['FC3 W\'s rank.changed / streak.* / milestone.reached / player.week FACTS equal, card for card, the facts of a league where W+1 does not exist at all'] =
      ['rank.changed', 'streak.extended', 'streak.broken', 'milestone.reached', 'player.week', 'week.result'].every(t => JSON.stringify(factsOf(withW1, t, 'w1')) === JSON.stringify(factsOf(alone, t, 'w1')));
    const wCards = (cs) => cs.filter(c => c.weekId === 'w1' && c.type !== 'year.ago');   // year.ago follows the CURRENT week, which is the one thing that differs between the two snapshots
    out['FC4 …and the whole W card set (ids, facts, reasons, sort keys) is byte-identical with and without W+1'] = JSON.stringify(wCards(withW1)) === JSON.stringify(wCards(alone)) && wCards(withW1).length === 19;
    out['FC5 …with the explicit values: no rank.changed in W (nothing before it), streak.extended p1 4 covers + p6 3 misses, no streak.broken, no milestone'] =
      ofType(withW1, 'rank.changed', 'w1').length === 0 && ofType(withW1, 'streak.broken', 'w1').length === 0 && ofType(withW1, 'milestone.reached', 'w1').length === 0
      && JSON.stringify(Object.keys(byMember(withW1, 'streak.extended', 'w1')).sort()) === '["p1","p6"]' && byMember(withW1, 'streak.extended', 'w1').p1.run === 4 && byMember(withW1, 'streak.extended', 'w1').p6.run === 3;
    const w2Teams = ['Oregon', 'Washington'];   // g21's two teams
    out['FC6 no W+1 team name, score or player outcome appears in any W card (W+1\'s picks and rows are in the store, in NO card of W)'] =
      withW1.filter(c => c.weekId === 'w1').every(c => w2Teams.every(t => !JSON.stringify(c).includes(t)));
    out['FC+ positive control: the SAME final game (g21) once its week is LIVE DOES produce game.final + 4 called.it, so the zeros above are the gate\'s'] =
      (() => { const live = derive(F, snapshotWith(F, league('live', { staleW2Rows: true }))); return ofType(live, 'game.final', 'w2').some(c => c.gameId === 'g21') && ofType(live, 'called.it', 'w2').length === 4; })();
  }
  // Fixture D — a HIDDEN week (week 2, LIVE, stale final-shaped rows still in storage) sits BETWEEN two final weeks. The only guard for week 3's
  // aggregates is the S-C2 revealed view: through-week slicing includes week 2 (it is earlier), and the per-candidate gate on week 3 is open.
  {
    const L = league('live', { staleW2Rows: true, w3: true });
    const c = derive(F, snapshotWith(F, L));
    const ext = byMember(c, 'streak.extended', 'w3');
    const want = { p1: [6, 'covers'], p2: [4, 'covers'], p4: [3, 'misses'], p5: [3, 'covers'], p6: [5, 'misses'] };
    const gotExt = Object.fromEntries(Object.entries(ext).map(([k, v]) => [k, [v.run, v.kind]]));
    out['D1 S-C2: week 3 streaks are computed WITHOUT the hidden week 2 — p1 6 covers, p2 4, p5 3, p4 3 misses, p6 5 misses (p3 none)'] = JSON.stringify(gotExt) === JSON.stringify(want);
    out['D2 …and week 3 shows NO rank movement (week-1 ranks == week-1+3 ranks once week 2 is excluded)'] = ofType(c, 'rank.changed', 'w3').length === 0;
    out['D3 …and no week-2 after-final card exists at all (week 2 is not final)'] = !c.some(x => x.weekId === 'w2' && AGG_TYPES.includes(x.type));
    const pw3 = byMember(c, 'player.week', 'w3');
    out['D4 …and week 3 player.week streak notes carry the clean numbers (p1 6, p6 5 misses)'] = pw3.p1 && pw3.p1.streakRun === 6 && pw3.p6 && pw3.p6.streakRun === 5 && pw3.p6.streakKind === 'misses';
    const wr = ofType(c, 'week.result', 'w3')[0];
    out['D5 …week 3 result is Drew 2–0 over Kihoon 0–2 (rows for week 3 only)'] = !!wr && wr.facts.weekWinnerName === 'Drew' && wr.facts.weekLoserName === 'Kihoon';
    out['D6 …and no week-3 team name leaks into a card it should not be in (week 3 is FINAL; names belong to its game cards only)'] = W3_TEAMS.every(t => !JSON.stringify(c.filter(x => x.weekId !== 'w3')).includes(t));
  }
  // Through-week slicing: week 1's cards cannot move because later weeks exist.
  {
    const small = derive(F, snapshotWith(F, league('final'))).filter(x => x.weekId === 'w1').map(x => x.id + '|' + JSON.stringify(x.facts)).sort();
    const big = derive(F, snapshotWith(F, league('final', { w3: true }))).filter(x => x.weekId === 'w1').map(x => x.id + '|' + JSON.stringify(x.facts)).sort();
    out['E1 slicing: week 1\'s cards are IDENTICAL whether or not weeks 2 and 3 exist — a later week never moves an earlier week\'s streak, rank or milestone'] = small.length === 19 && JSON.stringify(small) === JSON.stringify(big);
    const p5w1 = ofType(derive(F, snapshotWith(F, league('final', { w3: true }))), 'player.week', 'w1').find(x => x.memberId === 'p5');
    out['E2 …specifically p5\'s week-1 player.week carries NO streak note (its 5-cover run is a week-2 fact)'] = !!p5w1 && !('streakRun' in p5w1.facts);
  }
  // S-C10 — picksReadConfirmed, independently of arePicksPublic().
  {
    const L = league('final');
    const none = derive(F, snapshotWith(F, L, { picksConfirmed: false }), { viewerId: 'p5' });
    out['PC1 S-C10: flag FALSE (the week IS public) → no game.final, no stood.alone, no rank.changed for anyone'] = ['game.final', 'stood.alone', 'rank.changed'].every(t => ofType(none, t).length === 0);
    out['PC2 …called.it only for the VIEWER\'s own pick (p5), nobody else\'s'] = ofType(none, 'called.it').length === 2 && ofType(none, 'called.it').every(x => x.memberId === 'p5');
    out['PC3 …player.week / streak.* only the viewer\'s own'] = ['player.week', 'streak.extended', 'streak.broken', 'milestone.reached'].every(t => ofType(none, t).every(x => x.memberId === 'p5')) && ofType(none, 'player.week').length === 2 && ofType(none, 'streak.extended', 'w2').length === 1;
    out['PC4 …week.result (derived from the stored result rows, not another member\'s pick) and the never-class cards still render'] = ofType(none, 'week.result').length === 2 && ofType(none, 'slate.published').length === 2;
    const per = derive(F, snapshotWith(F, L, { picksConfirmed: { w1: true, w2: false } }), { viewerId: 'p5' });
    out['PC5 the flag is PER WEEK: week 1 confirmed shows everything, week 2 unconfirmed shows only the viewer\'s own'] = ofType(per, 'game.final', 'w1').length === 5 && ofType(per, 'game.final', 'w2').length === 0 && ofType(per, 'player.week', 'w1').length === 6 && ofType(per, 'player.week', 'w2').length === 1;
    const absent = derive(F, snapshotWith(F, L, { snap: { picksReadConfirmed: undefined } }), { viewerId: 'p5' });
    out['PC6 a snapshot with NO picksReadConfirmed fails CLOSED (treated as unconfirmed for every week)'] = ofType(absent, 'game.final').length === 0 && ofType(absent, 'rank.changed').length === 0;
    const pos = derive(F, snapshotWith(F, L), { viewerId: 'p5' });
    out['PC+ positive control: flag TRUE → game.final 9, stood.alone 2, rank.changed 5, called.it 7'] = ofType(pos, 'game.final').length === 9 && ofType(pos, 'stood.alone').length === 2 && ofType(pos, 'rank.changed').length === 5 && ofType(pos, 'called.it').length === 7;
  }
  // Demo weeks (UN-71)
  {
    const L = league('final');
    const demo = { ...L, weeks: L.weeks.map(w => (w.weekId === 'w2' ? { ...w, dataSourceMode: 'demo' } : w)) };
    const player = derive(F, snapshotWith(F, demo));
    out['G1 UN-71: a DEMO week produces no card of any kind for a player'] = !player.some(x => x.weekId === 'w2');
    const comm = derive(F, snapshotWith(F, demo, { includeDemo: true }), { viewerIsCommissioner: true });
    out['G2 …but the COMMISSIONER sees it (positive control)'] = ofType(comm, 'week.result', 'w2').length === 1 && ofType(comm, 'game.final', 'w2').length === 4;
    const commNoView = derive(F, snapshotWith(F, demo), { viewerIsCommissioner: true });
    out['G3 …and demo is not in the revealed view unless asked (Standings parity): the commissioner still gets the game cards, not the aggregates'] = ofType(commNoView, 'game.final', 'w2').length === 4 && ofType(commNoView, 'week.result', 'w2').length === 0;
  }
  // The commissioner no-stake bypass must never reach the feed: viewerIsCommissioner only ever affects demo weeks.
  {
    const c = derive(F, snapshotWith(F, league('open', { w2Finals: ['g21'] })), { viewerId: 'p1', viewerIsCommissioner: true });
    out['H1 S-C1: a COMMISSIONER viewer gets no game-scoped / after-final card for an OPEN week either (canViewOtherPicks\'s no-stake bypass never reaches this layer)'] = !c.some(x => x.weekId === 'w2' && (GAME_TYPES.includes(x.type) || AGG_TYPES.includes(x.type)));
    const l = derive(F, snapshotWith(F, league('locked')), { viewerId: 'p1', viewerIsCommissioner: true });
    out['H2 …nor a LOCKED week'] = !l.some(x => x.weekId === 'w2' && (GAME_TYPES.includes(x.type) || AGG_TYPES.includes(x.type)));
  }
  return out;
}
{
  const res = blindChecks(fc);
  for (const [label, ok] of Object.entries(res)) assert(ok === true, `4: ${label}`);
  assert(Object.keys(res).length >= 33, `4-floor: at least 33 blind-rule checks ran (${Object.keys(res).length})`);
}

// ── C1 (security, 2026-10-01): deriveCards RE-APPLIES the S-C2 view. The caller's layer is disabled by handing in the raw, UNFILTERED league
// (`bypassView`); the probe's evidence: with an unfiltered view p3's week-3 streak spliced in his week-2 sides. ──
function viewLayerChecks(F) {
  const out = {};
  const w3Cards = (cs) => JSON.stringify(cs.filter(c => c.weekId === 'w3'));
  const brief = (cs) => Object.fromEntries(['streak.extended', 'streak.broken', 'player.week', 'milestone.reached', 'rank.changed'].map(t => [t,
    ofType(cs, t, 'w3').map(c => `${c.memberId}:${c.facts.run ?? c.facts.streakRun ?? c.facts.toRank ?? ''}`).sort().join(' ')]));
  const both = (L) => ({ good: derive(F, snapshotWith(F, L)), bad: derive(F, snapshotWith(F, L, { bypassView: true })) });
  // The probe's fixture: an OPEN week holding TWO FINAL games, followed by a FINAL week; the UNFILTERED view is passed in.
  { const L = league('open', { w2Finals: ['g21', 'g22'], w3: true }); const { good, bad } = both(L);
    out['V1 C1: OPEN week 2 with TWO final games, then FINAL week 3, UNFILTERED view passed in → every week-3 card equals the correct-view output'] = w3Cards(bad) === w3Cards(good) && ofType(good, 'streak.extended', 'w3').length === 5;
    out['V2 …specifically p3\'s week-3 streak (the probe\'s leak: his week-2 sides) is the clean one — no streak.extended for p3, and the clean numbers p1 6 / p2 4 / p4 3 misses / p5 3 / p6 5 misses'] =
      ofType(bad, 'streak.extended', 'w3').every(c => c.memberId !== 'p3') && brief(bad)['streak.extended'] === 'p1:6 p2:4 p4:3 p5:3 p6:5';
    out['V3 …and the unfiltered view produces no week-2 game or aggregate card either (week 2 is OPEN, so it is not public)'] = !bad.some(c => c.weekId === 'w2' && (GAME_TYPES.includes(c.type) || AGG_TYPES.includes(c.type)));
  }
  // Fixture D: a LIVE (public, but not server-confirmed final) week 2 with stale final-shaped rows between two final weeks.
  { const L = league('live', { staleW2Rows: true, w3: true }); const { good, bad } = both(L);
    out['V4 Fixture D with the UNFILTERED view: week-3 cards equal the correct-view output (a LIVE week is public but not confirmed final)'] = w3Cards(bad) === w3Cards(good) && brief(bad)['streak.extended'] === 'p1:6 p2:4 p4:3 p5:3 p6:5';
  }
  // The re-application is NARROW-ONLY: an honest view passes through byte-identical; with no confirmedStatusFor nothing is "revealed".
  { const L = league('final', { w3: true }); const { good, bad } = both(L);
    out['V5 an honest, fully-final league: the bypassed and the built view give BYTE-IDENTICAL cards (the re-application only removes, never changes)'] = JSON.stringify(good) === JSON.stringify(bad) && good.length > 60;
    const noConf = derive(F, { ...snapshotWith(F, L, { bypassView: true }), confirmedStatusFor: undefined });
    out['V6 …and an unfiltered view with NO confirmedStatusFor yields NO aggregate card (nothing is confirmed final → fail closed)'] = !noConf.some(c => AGG_TYPES.includes(c.type)) && ofType(noConf, 'game.final').length === 11;
    const hidden = { ...L, weeks: L.weeks.map(w => (w.weekId === 'w2' ? { ...w, showInHistory: false } : w)) };
    out['V7 …a week hidden from history (showInHistory:false) is cut from the view too, exactly as Standings drops it'] = !derive(F, snapshotWith(F, hidden, { bypassView: true })).some(c => c.weekId === 'w2' && AGG_TYPES.includes(c.type));
  }
  return out;
}

// ── reviewer note 3 — the `almaMaterResult` fact on player.week (DI-362 AMENDMENT, approved inline 2026-10-01) ──
const almaLeague = (w2, o = {}) => {
  // p3's school (Notre Dame) plays in g11 and LOSES 24-10 at Clemson; p2's (Oklahoma) WINS g13 20-17 at Texas; p4's (USC) WINS g24 24-10 over UCLA (week 2).
  const L = mapStrings(league(w2, o), (s) => (s === 'Duke' ? 'Notre Dame' : s));
  for (const g of L.games) if (['g11', 'g13', 'g24'].includes(g.gameId)) g.isAlmaMaterGame = true;
  return L;
};
function almaChecks(F) {
  const out = {};
  const fin = derive(F, snapshotWith(F, almaLeague('final')));
  const am = (cs, wk, m) => (ofType(cs, 'player.week', wk).find(c => c.memberId === m) || { facts: {} }).facts.almaMaterResult;
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  out['AL1 week 1: p2\'s school (Oklahoma) beat Texas → { team:"Oklahoma", result:"win" }'] = eq(am(fin, 'w1', 'p2'), { team: 'Oklahoma', result: 'win' });
  out['AL2 week 1: p3\'s school (Notre Dame) lost at Clemson → { team:"Notre Dame", result:"loss" } (the team is the GAME ROW\'s spelling)'] = eq(am(fin, 'w1', 'p3'), { team: 'Notre Dame', result: 'loss' });
  out['AL3 week 2: p4\'s school (USC) beat UCLA → win'] = eq(am(fin, 'w2', 'p4'), { team: 'USC', result: 'win' });
  out['AL4 a member whose school is not on the slate (p1, p5, p6) carries NO almaMaterResult key (absent, never null)'] = ['p1', 'p5', 'p6'].every(m => ofType(fin, 'player.week').filter(c => c.memberId === m).every(c => !('almaMaterResult' in c.facts)));
  out['AL5 the fact is exactly { team, result } and result is "win"|"loss" only'] = ofType(fin, 'player.week').filter(c => 'almaMaterResult' in c.facts).every(c => JSON.stringify(Object.keys(c.facts.almaMaterResult)) === '["team","result"]' && ['win', 'loss'].includes(c.facts.almaMaterResult.result)) && ofType(fin, 'player.week').filter(c => 'almaMaterResult' in c.facts).length === 3;
  // absent before final — a final alma game inside a week that is not final yields NO player.week card, so no fact either
  for (const [name, L] of [['LIVE', almaLeague('live', { w2Finals: ['g24'] })], ['OPEN (RG-45: a final game in an open week)', almaLeague('open', { w2Finals: ['g24'] })], ['LOCKED', almaLeague('locked', { w2Finals: ['g24'] })]]) {
    const cs = derive(F, snapshotWith(F, L));
    out[`AL6 week 2 ${name} with USC's game FINAL: NO player.week card for week 2 and no almaMaterResult anywhere in its cards`] = ofType(cs, 'player.week', 'w2').length === 0 && !JSON.stringify(cs.filter(c => c.weekId === 'w2')).includes('almaMaterResult');
  }
  out['AL7 positive control: once week 2 is FINAL the fact is there (AL3) — the absence above is the gate\'s'] = eq(am(fin, 'w2', 'p4'), { team: 'USC', result: 'win' });
  // S-C10: another member's player.week (and the fact on it) needs picksReadConfirmed; the viewer's own does not
  const unconf = derive(F, snapshotWith(F, almaLeague('final'), { picksConfirmed: false }), { viewerId: 'p2' });
  out['AL8 S-C10: with picksReadConfirmed false, p2 (the viewer) still carries his own alma fact, and no other member\'s player.week (so no one else\'s alma fact) renders'] =
    eq(am(unconf, 'w1', 'p2'), { team: 'Oklahoma', result: 'win' }) && ofType(unconf, 'player.week').every(c => c.memberId === 'p2');
  out['AL9 straight-up, never ATS: the fact never names a spread, a pick or a margin (keys team/result only; no pick content in the player.week card beyond the record)'] =
    ofType(fin, 'player.week').every(c => Object.keys(c.facts).every(k => fc_ALLOWED(F, k)));
  return out;
}
const fc_ALLOWED = (F, k) => F.CARD_ALLOWED_FACTS['player.week'].includes(k);

// ── security N1 / N2 — deep-frozen exports and the per-item chip / alma allow-list ──
function freezeChecks(F) {
  const out = {};
  const deep = (o) => Object.isFrozen(o) && Object.values(o).every(v => (v && typeof v === 'object') ? deep(v) : true);
  out['FZ1 CARD_ALLOWED_FACTS is DEEP-frozen (every inner array)'] = deep(F.CARD_ALLOWED_FACTS);
  let threw = 0;
  try { F.CARD_ALLOWED_FACTS['called.it'].push('margin'); } catch { threw++; }
  try { F.CARD_ALLOWED_FACTS['player.week'][0] = 'x'; } catch { threw++; }
  try { F.NESTED_FACT_KEYS['game.final'].chips.push('team'); } catch { threw++; }
  try { F.WAGER_RECEIPT_KINDS.push('x'); } catch { threw++; }
  out['FZ2 …so an allow-list cannot be edited at runtime: push / index-assign / nested push all throw (4 of 4)'] = threw === 4;
  out['FZ3 WAGER_RECEIPT_KINDS is a frozen array (a Set cannot be frozen against add()) and isWagerReceipt still reads it'] = Array.isArray(F.WAGER_RECEIPT_KINDS) && Object.isFrozen(F.WAGER_RECEIPT_KINDS) && F.isWagerReceipt({ meta: { kind: 'wagerLogged' } }) && F.isWagerReceipt({ metaKind: 'wagerDue' }) && !F.isWagerReceipt({ meta: { kind: 'other' } });
  out['FZ4 NESTED_FACT_KEYS and the reason / reveal / type tables are frozen too'] = deep(F.NESTED_FACT_KEYS) && Object.isFrozen(F.CARD_REVEAL_CLASS) && Object.isFrozen(F.CARD_REASON_LABELS) && Object.isFrozen(F.CARD_TYPES);
  // N2
  const chips = F.finalizeFacts('game.final', { chips: [{ playerId: 'p1', initials: 'DH', result: 'win', team: 'Duke', pick: 'x', extra: 1 }, { playerId: 'p2', initials: 'BR', result: 'push' }, 'junk', null, { playerId: 'p3', initials: 'KC', result: 'loss' }] }).chips;
  out['N2a a chip is rebuilt from {playerId, initials, result} ONLY: extra keys are stripped, a result outside win|loss drops the chip, non-objects are dropped'] =
    JSON.stringify(chips) === JSON.stringify([{ playerId: 'p1', initials: 'DH', result: 'win' }, { playerId: 'p3', initials: 'KC', result: 'loss' }]);
  const alma = F.finalizeFacts('player.week', { playerId: 'p', almaMaterResult: { team: 'USC', result: 'win', note: 'x', opponentRank: 12 } });
  out['N2b almaMaterResult is rebuilt from {team, result} only (the extra, non-forbidden keys are stripped)'] = JSON.stringify(alma.almaMaterResult) === '{"team":"USC","result":"win"}';
  out['N2b2 …and a nested FORBIDDEN key (spread / selectedTeam) THROWS before any stripping happens'] = (() => { let n = 0; for (const k of ['spread', 'selectedTeam']) { try { F.finalizeFacts('player.week', { playerId: 'p', almaMaterResult: { team: 'USC', result: 'win', [k]: 7 } }); } catch { n++; } } return n === 2; })();
  out['N2c an almaMaterResult whose result is not win|loss is dropped entirely'] = !('almaMaterResult' in F.finalizeFacts('player.week', { playerId: 'p', almaMaterResult: { team: 'USC', result: 'tie' } })) && !('almaMaterResult' in F.finalizeFacts('player.week', { playerId: 'p', almaMaterResult: 'win' }));
  return out;
}

// ── reviewer note 5 / 6: a week with no usable weekNumber, and the Standings-aligned active filter ──
function weekAndActiveChecks(F) {
  const out = {};
  for (const bad of [undefined, null, '', '  ', 'x', NaN]) {
    const L = league('final'); L.weeks = L.weeks.map(w => (w.weekId === 'w2' ? { ...w, weekNumber: bad } : w));
    const cs = derive(F, snapshotWith(F, L));
    out[`WN1 a week whose weekNumber is ${JSON.stringify(bad) ?? 'undefined'} produces NO card of any type (never "Week 's slate is up")`] = !cs.some(c => c.weekId === 'w2') && ofType(cs, 'week.result', 'w1').length === 1;
  }
  { const L = league('final', { w3: true }); L.weeks = L.weeks.map(w => (w.weekId === 'w2' ? { ...w, weekNumber: undefined } : w));
    // p1 sits at 20 raw correct after week 1; the malformed week's row would carry him past the 25 mark if it were allowed into the view
    L.weeklyResults = L.weeklyResults.map(r => (r.playerId === 'p1' && r.weekId === 'w1') ? { ...r, correctCount: 20, correctPicks: 20 } : (r.playerId === 'p1' && r.weekId === 'w2') ? { ...r, correctCount: 6, correctPicks: 6 } : r);
    const noW2 = { ...L, weeks: L.weeks.filter(w => w.weekId !== 'w2'), games: L.games.filter(g => g.weekId !== 'w2'), picks: L.picks.filter(p => p.weekId !== 'w2'), weeklyResults: L.weeklyResults.filter(r => r.weekId !== 'w2') };
    const keep = (cs) => JSON.stringify(cs.filter(c => (c.weekId === 'w1' || c.weekId === 'w3') && c.type !== 'year.ago'));
    out['WN2 …and the malformed week cannot sit in the revealed view either (it would sort as week 0 and move week 3\'s ranks and streaks): weeks 1 and 3 equal those of a league without it'] =
      keep(derive(F, snapshotWith(F, L, { snap: { currentWeekId: 'w3' } }))) === keep(derive(F, snapshotWith(F, noW2, { snap: { currentWeekId: 'w3' } }))) && ofType(derive(F, snapshotWith(F, L)), 'streak.extended', 'w3').length === 5; }
  const E = { escHtml: esc };
  out['WN3 cardCopy: a week-scoped card whose weekN is missing renders NOTHING — no "Week \'s slate is up", no "Week  is final."'] =
    ['slate.published', 'picks.submitted', 'week.revealed', 'week.result', 'player.week', 'rank.changed'].every(t => { const c = F.cardCopy({ type: t, facts: { gameCount: 4, submittedCount: 1, totalPlayers: 6, playerName: 'A', wins: 1, losses: 1, fromRank: 1, toRank: 2 } }, E); return c.title === '' && c.body === ''; })
    && F.cardCopy({ type: 'week.revealed', facts: { weekN: 0 } }, E).title === 'Week 0 is revealed. Every pick is visible now.';
  // active filter: truthy `active` exactly as Standings (app.js `getPlayers().filter(p => p.active)`)
  for (const [label, val] of [['false', false], ['undefined', undefined]]) {
    const L = league('final'); L.players = L.players.map(p => (p.playerId === 'p6' ? { ...p, active: val } : p));
    const cs = derive(F, snapshotWith(F, L));
    const active = L.players.filter(p => p.active);
    out[`AC1 a player with active:${label} has NO player.week / rank.changed / streak / milestone card (Standings\' truthy-active rule)`] = !cs.some(c => c.memberId === 'p6' && AGG_TYPES.includes(c.type)) && ofType(cs, 'player.week', 'w2').length === 5;
    out[`AC2 …and the ranks are computed among the ${active.length} active players only (rankedCount ${active.length})`] = ofType(cs, 'rank.changed', 'w2').every(c => c.facts.rankedCount === 5);
  }
  return out;
}

// ── reviewer note 4: the feed's streak cards vs SCRIBE's detector, over seeded leagues ──
function streakParityChecks(F) {
  const out = {};
  let seed = 0x51ed270b;
  const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pickOne = (a) => a[Math.floor(rnd() * a.length)];
  let leagues = 0, weeksCompared = 0, withSignals = 0, mismatches = [], scribeOnly = 0;
  for (let n = 0; n < 80; n++) {
    const nWeeks = 2 + Math.floor(rnd() * 3);
    const players = fx.PLAYERS.slice(0, 4 + Math.floor(rnd() * 3)).map(p => ({ ...p }));
    const weeks = [], games = [], picks = [];
    for (let w = 0; w < nWeeks; w++) {
      const wk = fx.mkWeek({ id: `r${w + 1}`, n: w + 1, status: 'final' });
      weeks.push(wk);
      const ng = 2 + Math.floor(rnd() * 4);
      for (let g = 0; g < ng; g++) {
        const kind = pickOne(['cover', 'cover', 'upset', 'push']);
        const game = fx.mkGame({ id: `rg${w}_${g}`, weekId: wk.weekId, kick: new Date(Date.UTC(2026, 8, 5 + w * 7, 12 + g)).toISOString(), home: `H${w}${g}`, away: `A${w}${g}`, kind, state: 'final' });
        games.push(game);
        picks.push(...fx.mkPicks(game, kind, players.map(() => pickOne(['W', 'W', 'L', 'L', 'P', '-'])).join(''), players));
      }
    }
    const rows = weeks.flatMap(w => calculateWeeklyResults(w.weekId, players, picks, games.filter(g => g.weekId === w.weekId)));
    const snap = { leagueId: 'L1', players, weeks, games, picks, ...F.buildRevealedView({ weeks, games, picks, weeklyResults: rows, confirmedStatusFor: (w) => w.status }),
      confirmedStatusFor: (w) => w.status, picksReadConfirmed: Object.fromEntries(weeks.map(w => [w.weekId, true])), submissionCounts: {}, chatCandidates: { scribe: [], lockerRoom: [] }, currentWeekId: weeks[weeks.length - 1].weekId, todayKey: '2026-09-30' };
    const cards = derive(F, snap, { viewerId: null });
    leagues++;
    weeks.forEach((w, wi) => {
      const upto = weeks.slice(0, wi + 1), ids = new Set(upto.map(x => x.weekId));
      const sig = scribeLines.detectWeekSignals({ weekId: w.weekId, weekStatus: 'final', games: games.filter(g => ids.has(g.weekId)), picks: picks.filter(p => ids.has(p.weekId)), players, weeks: upto }).filter(s => s.signal === 'streak');
      const played = (pid) => rows.some(r => r.weekId === w.weekId && r.playerId === pid && (r.correctCount + r.incorrectCount) > 0);
      // SCRIBE asks about every player with a PICK this week; the feed about every player with a GRADED result this week. Compare on the common ground.
      const sigPlayed = sig.filter(s => played(s.subject));
      scribeOnly += sig.length - sigPlayed.length;
      const feed = cards.filter(c => c.weekId === w.weekId && (c.type === 'streak.extended' || c.type === 'streak.broken'));
      const norm = (xs) => xs.sort().join('|');
      const a = norm(sigPlayed.map(s => `${s.subject}:${s.evidence.state}:${s.evidence.run}:${s.evidence.kind}`));
      const b = norm(feed.map(c => `${c.memberId}:${c.type === 'streak.extended' ? 'active' : 'broken'}:${c.facts.run}:${c.facts.kind}`));
      weeksCompared++; if (sigPlayed.length) withSignals++;
      if (a !== b) mismatches.push(`league ${n} ${w.weekId}: scribe=${a} feed=${b}`);
    });
  }
  out[`SP1 reviewer note 4: over ${leagues} seeded leagues (${weeksCompared} week-finalizations, ${withSignals} with at least one streak signal) the feed's streak.extended / streak.broken cards equal SCRIBE's detectWeekSignals streak signals exactly (state, run, kind) for every player who has a graded result that week — ${mismatches.length} mismatches${mismatches[0] ? ' e.g. ' + mismatches[0] : ''}`] =
    mismatches.length === 0 && leagues === 80 && withSignals > 40;
  return out;
}

// ── DI-373 item 4: ARCHITECTURE_NOTES_092626.md §8's thirteen directive examples that LEAK, each with its compliant version ──
// Every row is either asserted at the card layer (this module) or named as living in another layer, so none is silently dropped.
{
  const w2Only = (cs) => cs.filter(c => c.weekId === 'w2');
  const preReveal = [cardsOpen, cardsLocked];
  const DIRECTIVES = [
    { n: 1, layer: 'card', say: '"Your friend just locked in an underdog" → counts only ("6/6 in"): no member, no team, in an OPEN or LOCKED week',
      check: () => preReveal.every(cs => w2Only(cs).every(c => c.memberId === null && !('playerId' in c.facts) && !('team' in c.facts))) && ofType(cardsOpen, 'picks.submitted', 'w2').every(c => Object.keys(c.facts).sort().join() === 'submittedCount,totalPlayers,weekN') },
    { n: 2, layer: 'card', say: '"A player in your league just made a huge pick" → after reveal only: no called.it / stood.alone before LIVE, present after',
      check: () => preReveal.every(cs => !w2Only(cs).some(c => c.type === 'called.it' || c.type === 'stood.alone')) && ofType(cardsLive, 'called.it', 'w2').length === 4 },
    { n: 3, layer: 'card', say: '"Brayden just took Texas +6.5" → before reveal no team / spread / matchup anywhere; after reveal it appears on the game-scoped card',
      check: () => preReveal.every(cs => !JSON.stringify(w2Only(cs).map(c => c.facts)).match(/team|spreadDisplay|matchup|Washington|Oregon/)) && ofType(cardsLive, 'called.it', 'w2').every(c => c.facts.spreadDisplay === '+7') },
    { n: 4, layer: 'card', say: '"Jacob is the only person taking Michigan" → "stands alone" only once the game is FINAL ("…and it covered") — stricter than the table\'s at-reveal wording',
      check: () => ofType(cardsLive, 'stood.alone', 'w2').length === 0 && preReveal.every(cs => ofType(cs, 'stood.alone', 'w2').length === 0) && ofType(cardsFinal, 'stood.alone', 'w2').length === 1 },
    { n: 5, layer: 'SCRIBE / server', say: 'SCRIBE "Three people picked the favorite…" — SCRIBE\'s own revealedView() filter (supabase/functions/_shared/scribe-evidence.mjs), not a feed card; no card type carries a split-of-picks fact',
      check: () => !fc.CARD_TYPES.some(t => /split|favorite/i.test(t)) && !Object.values(fc.CARD_ALLOWED_FACTS).some(ks => ks.some(k => /split|favorite/i.test(k))) },
    { n: 6, layer: 'card', say: '"Only 1 player… picked Stanford" → after reveal only (the stood.alone gate)',
      check: () => preReveal.every(cs => !cs.some(c => c.type === 'stood.alone' && c.weekId === 'w2')) && ofType(cardsFinal, 'stood.alone', 'w2')[0].facts.against === 5 },
    { n: 7, layer: 'SCRIBE / server', say: 'SCRIBE "Kevin has taken the favorite in every game" — after reveal only, enforced server-side; no per-member "every game" aggregate exists in the v1 catalog',
      check: () => !fc.CARD_TYPES.some(t => /taken|every/i.test(t)) },
    { n: 8, layer: 'SCRIBE / server', say: 'SCRIBE "Everyone suddenly loves the underdog…" — after reveal only; the "line moves" framing is dropped (spreads are locked); the feed never shows a line move',
      check: () => !Object.values(fc.CARD_ALLOWED_FACTS).some(ks => ks.some(k => /lineMove|currentSpread|liveSpread/i.test(k))) },
    { n: 9, layer: 'SCRIBE / server', say: '"@SCRIBE why is everyone taking Texas?" — before reveal SCRIBE deflects (the server filter); a scribe.post card only repaints an EXISTING private-free, wager-free chat row (DI-372)',
      check: () => ofType(cardsOpen, 'scribe.post').every(c => c.requiresReveal === 'never' && JSON.stringify(Object.keys(c.facts)) === '["messageId","body","timestamp"]') },
    { n: 10, layer: 'not in v1', say: 'Pick posts "Drew: Texas +6.5" — there are no user-authored pick posts in v1; no card type carries a post-with-a-pick',
      check: () => !fc.CARD_TYPES.some(t => /^post|pick\.post/i.test(t)) },
    { n: 11, layer: 'card', say: 'Game room listing each friend\'s side → the per-player chips exist only on a game.final card, which exists only after reveal AND that game is final (LIVE week: only the finished game)',
      check: () => preReveal.every(cs => ofType(cs, 'game.final', 'w2').length === 0) && ofType(cardsLive, 'game.final', 'w2').length === 1 && ofType(cardsLive, 'game.final', 'w2')[0].gameId === 'g21' && ofType(cardsLive, 'game.final', 'w2')[0].facts.chips.length === 6 },
    { n: 12, layer: 'not in v1', say: 'Photo post "Pick: Texas +6.5, Current +3" — no photo posts in v1; the feed never shows a live line, only a pre-formatted display string after the game is final',
      check: () => !Object.values(fc.CARD_ALLOWED_FACTS).some(ks => ks.some(k => /photo|image|current/i.test(k))) },
    { n: 13, layer: 'card', say: '`PICK_CREATED` activity → replaced by content-free picks.submitted + week-level week.revealed: counts only, no selection',
      check: () => !fc.CARD_TYPES.includes('pick.created') && ofType(cardsOpen, 'picks.submitted').length === 1 && ofType(cardsLive, 'week.revealed').every(c => Object.keys(c.facts).every(k => ['weekN', 'submittedCount', 'totalPlayers'].includes(k))) },
  ];
  DIRECTIVES.forEach(d => assert(d.check() === true, `4-dir-${d.n}: [${d.layer}] ${d.say}`));
  assert(DIRECTIVES.length === 13 && DIRECTIVES.filter(d => d.layer === 'card').length === 7, '4-dir-all: all thirteen directive examples are accounted for (seven asserted at the card layer; six recorded as living in the SCRIBE/server layer or absent from v1)');
}

// ── the 2026-10-01 follow-up checks, run once here and again (mutated) in [11] ──
console.log('\n[4b] C1 view re-application · alma fact · deep-frozen exports · weekNumber / active filters · streak parity with SCRIBE…');
{
  for (const [tag, fn] of [['4b-view', viewLayerChecks], ['4b-alma', almaChecks], ['4b-freeze', freezeChecks], ['4b-week', weekAndActiveChecks], ['4b-parity', streakParityChecks]]) {
    const res = fn(fc);
    for (const [label, ok] of Object.entries(res)) assert(ok === true, `${tag}: ${label}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[5] S-C5 — a rejected candidate never reaches the id builder (a SPY on the id-format helper)…');
// ═══════════════════════════════════════════════════════════════════════════
function idOrderChecks(F) {
  const out = {};
  const run = (L, o) => {
    const calls = [], facts = [];
    const origId = F._internals.buildCardId, origFacts = F._internals.finalizeFacts;
    F._internals.buildCardId = (a) => { calls.push({ type: a.type, weekId: a.weekId }); return origId(a); };
    F._internals.finalizeFacts = (t, f) => { facts.push(t); return origFacts(t, f); };
    let cards;
    try { cards = derive(F, snapshotWith(F, L, o)); }
    finally { F._internals.buildCardId = origId; F._internals.finalizeFacts = origFacts; }
    return { cards, calls, facts };
  };
  const GATED = [...GAME_TYPES, ...AGG_TYPES];
  const a = run(league('open', { w2Finals: ['g21'] }));
  out['S5-1 OPEN week with a final game: ZERO id builds for any game-scoped or after-final type in week 2'] = !a.calls.some(c => c.weekId === 'w2' && GATED.includes(c.type));
  out['S5-2 …and ZERO facts builds for them either'] = a.facts.filter(t => GATED.includes(t)).length === a.calls.filter(c => c.weekId === 'w1' && GATED.includes(c.type)).length;
  const b = run(league('locked'));
  out['S5-3 LOCKED week: zero id builds for gated week-2 types'] = !b.calls.some(c => c.weekId === 'w2' && GATED.includes(c.type));
  const d = run(league('final'));
  out['S5-4 positive control: FINAL week → id builds for gated week-2 types DO happen'] = d.calls.filter(c => c.weekId === 'w2' && GATED.includes(c.type)).length === 4 + 4 + 1 + 1 + 6 + 5 + 2 + 2;
  out['S5-5 one id build per card, no more (nothing is built and then thrown away)'] = d.calls.length === d.cards.length && a.calls.length === a.cards.length;
  const e = run(league('final'), { confirmed: (w) => (w.weekId === 'w2' ? 'live' : w.status), viewConfirmed: (w) => w.status });
  out['S5-6 RG-253 shape: confirmed LIVE → zero id builds for after-final week-2 types (the gate runs BEFORE the build)'] = !e.calls.some(c => c.weekId === 'w2' && AGG_TYPES.includes(c.type));
  return out;
}
{
  const res = idOrderChecks(fc);
  for (const [label, ok] of Object.entries(res)) assert(ok === true, `5: ${label}`);
  assert(typeof fc._internals.buildCardId === 'function' && typeof fc._internals.finalizeFacts === 'function', '5-seam: the spy seam is restored after every run (the internals are the real functions again)');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[6] Stable ids, determinism, re-derivation, fail-closed inputs, isContentWithheld…');
// ═══════════════════════════════════════════════════════════════════════════
{
  const suffixOf = (c) => (GAME_TYPES.includes(c.type) ? c.gameId : c.type === 'milestone.reached' ? String(c.facts.mark) : c.type === 'scribe.post' ? c.facts.messageId : c.type === 'lockerroom.top' ? '2026-09-12' : c.type === 'year.ago' ? '2025' : null);
  const expectedId = (c) => `${c.type}:L1:${c.weekId ?? '-'}:${c.memberId ?? '-'}${suffixOf(c) ? ':' + suffixOf(c) : ''}`;
  const all = [...cardsFinal, ...cardsLive, ...cardsOpen, ...cardsLocked];
  assert(all.every(c => c.id === expectedId(c)), '6-1: every id equals `${type}:${leagueId}:${weekId ?? "-"}:${memberId ?? "-"}[:${suffix}]` — the UN-330 / DI-362 format — for all ' + all.length + ' cards of every type');
  for (const [name, cards] of [['FINAL', cardsFinal], ['LIVE', cardsLive], ['OPEN', cardsOpen]]) assert(new Set(cards.map(c => c.id)).size === cards.length, `6-2: ${name}: ids are UNIQUE within one derive (${cards.length} cards)`);
  assert(cardsFinal.some(c => c.id === 'called.it:L1:w2:p2:g21') && cardsFinal.some(c => c.id === 'game.final:L1:w2:-:g21') && cardsFinal.some(c => c.id === 'week.result:L1:w2:-') && cardsFinal.some(c => c.id === 'streak.broken:L1:w2:p6'), '6-3: spot-check the literal ids: called.it:L1:w2:p2:g21, game.final:L1:w2:-:g21, week.result:L1:w2:-, streak.broken:L1:w2:p6');
  const again = derive(fc, snapshotWith(fc, FINAL_SET));
  assert(JSON.stringify(again) === JSON.stringify(cardsFinal), '6-4: the same snapshot yields the same array, byte for byte (deterministic order and content)');
  assert(cardsFinal.every((c, i) => i === 0 || cardsFinal[i - 1].sortKey > c.sortKey || (cardsFinal[i - 1].sortKey === c.sortKey && cardsFinal[i - 1].id < c.id)), '6-5: output is newest-first by sortKey with id as the tiebreak');
  // re-derivation (acceptance test 5): a standings change between calls shows only in the SECOND derivation
  const L = league('final');
  const first = derive(fc, snapshotWith(fc, L));
  const bumped = { ...L, weeklyResults: L.weeklyResults.map(r => (r.weekId === 'w2' && r.playerId === 'p3') ? { ...r, correctPicks: 4, correctCount: 4, incorrectPicks: 0, incorrectCount: 0 } : r) };
  const second = derive(fc, snapshotWith(fc, bumped));
  const r1 = ofType(first, 'rank.changed', 'w2').find(c => c.memberId === 'p3'), r2 = ofType(second, 'rank.changed', 'w2').find(c => c.memberId === 'p3');
  assert(r1.facts.toRank === 6 && (!r2 || r2.facts.toRank !== 6) && r1.id === 'rank.changed:L1:w2:p3', `6-6: re-derivation — p3's rank.changed shows toRank 6 on the first snapshot and ONLY the new standings on the second (${r2 ? 'toRank ' + r2.facts.toRank : 'no card'}); the id is stable, the stale card is never stored`);
  // purity
  const freeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(freeze); } return o; };
  const snap = freeze(JSON.parse(JSON.stringify({ ...snapshotWith(fc, FINAL_SET), confirmedStatusFor: undefined })));
  const snapFn = { ...snap, confirmedStatusFor: (w) => w.status };
  let threw = false, out;
  try { out = derive(fc, snapFn); } catch { threw = true; }
  assert(!threw && out.length === cardsFinal.length, '6-7: deriveCards never writes to its input (a deep-frozen snapshot derives the identical card count)');
  // fail closed
  const base = snapshotWith(fc, FINAL_SET);
  assert(fc.deriveCards(null).length === 0 && fc.deriveCards(undefined, undefined).length === 0 && fc.deriveCards({}, {}).length === 0, '6-8: no snapshot / an empty snapshot → no cards, never a throw');
  const noConf = fc.deriveCards({ ...base, confirmedStatusFor: undefined }, { viewerId: 'p1', now: NOW });
  assert(!noConf.some(c => AGG_TYPES.includes(c.type)) && ofType(noConf, 'game.final').length === 9, '6-9: a snapshot with no confirmedStatusFor gets NO after-final card (it is never re-derived here) but the after-reveal cards still render');
  const noView = fc.deriveCards({ ...base, revealedWeeks: undefined, revealedGames: undefined, revealedPicks: undefined, revealedWeeklyResults: undefined }, { viewerId: 'p1', now: NOW });
  assert(!noView.some(c => AGG_TYPES.includes(c.type)), '6-10: a snapshot with no revealed view gets no aggregate card');
  const throwing = fc.deriveCards({ ...base, confirmedStatusFor: () => { throw new Error('boom'); } }, { viewerId: 'p1', now: NOW });
  assert(!throwing.some(c => AGG_TYPES.includes(c.type)), '6-11: a confirmedStatusFor that THROWS is treated as "not confirmed" (fail closed)');
  // isContentWithheld (S-C7's belt behind home.js's own paint-time check)
  const w = (v) => fc.deriveCards(base, { viewerId: 'p1', now: NOW, isContentWithheld: v });
  assert(w(() => true).length === 0, '6-12: an injected isContentWithheld() that answers TRUE → NO cards at all');
  assert(w(() => { throw new Error('probe broke'); }).length === 0, '6-13: …a probe that THROWS → no cards (unknown is withheld)');
  assert(w('yes').length === 0 && w(1).length === 0 && w(null).length === 0, '6-14: …a probe that is not a function → no cards (fail closed)');
  assert(w(() => false).length === cardsFinal.length && w(undefined).length === cardsFinal.length, '6-15: positive control — a probe that answers FALSE, or no probe at all, derives normally');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[7] year.ago and the chat-derived cards (DI-372)…');
// ═══════════════════════════════════════════════════════════════════════════
function chatChecks(F) {
  const out = {};
  const cardsOf = (o = {}) => derive(F, snapshotWith(F, league('open'), o));
  const sp = ofType(cardsOf(), 'scribe.post');
  out['T1 scribe.post: of 12 candidates only the two clean ones (m_s1, and the PUBLIC sys_whatsnew_ post) become cards'] = sp.length === 2 && sp.map(c => c.facts.messageId).sort().join() === 'm_s1,sys_whatsnew_v0_28_0';
  out['T1b …its id carries the message id, and its facts are messageId / body / timestamp only'] = sp.some(c => c.id === 'scribe.post:L1:-:-:m_s1') && sp.every(c => JSON.stringify(Object.keys(c.facts)) === '["messageId","body","timestamp"]');
  out['T1c a PUBLIC SCRIBE post whose id merely starts with sys_ is NOT mistaken for a private row'] = sp.some(c => c.facts.messageId === 'sys_whatsnew_v0_28_0');
  const body = JSON.stringify(cardsOf().filter(c => c.type === 'scribe.post' || c.type === 'lockerroom.top'));
  out['T2 a PRIVATE row (visibleTo set) never becomes a scribe.post or a lockerroom.top (m_s4, m_l3)'] = !body.includes('m_s4') && !body.includes('private self-test') && !body.includes('m_l3') && !body.includes('8 reactions');
  out['T2b REAL-SHAPED private rows (sys_test_<32 hex> self-test, sys_scribe_changelog_…__private; author:"system") never become a card, in either list'] =
    !body.includes('Push self-test') && !body.includes('learned something private') && !body.includes('private SCRIBE changelog') && !body.includes('sys_test_') && !body.includes('__private');
  out['T2c …and the SAME rows with a MIS-STAMPED author (scribe / a human p4, 40+ reactions) are still dropped: the id/meta signature holds independently of the author filter'] =
    !body.includes('MIS-STAMPED') && ofType(cardsOf(), 'lockerroom.top')[0].facts.reactionCount === 4;
  out['T3 a WAGER RECEIPT is excluded from scribe.post (meta.kind and metaKind, both shapes) and from lockerroom.top'] = !body.includes('Wager') && !body.includes('wager') && !body.includes('m_s2') && !body.includes('m_l7');
  out['T4 a DELETED message never wins: m_l2 (9 reactions, deleted) is skipped and the next-highest clean message (m_l4, 4) wins'] = (() => { const t = ofType(cardsOf(), 'lockerroom.top')[0]; return !!t && t.facts.reactionCount === 4 && t.facts.authorName === 'Jacob' && !body.includes('m_l2') && !body.includes('then deleted'); })();
  out['T5 S-C11: a message stamped with ANOTHER league is dropped (m_s5, m_l8) even though its reaction count (6) beats the winner\'s'] = !body.includes('ANOTHER league') && !body.includes('m_s5') && !body.includes('m_l8');
  out['T6 only SCRIBE authors scribe.post (a human row in the scribe list, m_s6, is dropped); SCRIBE and system never win lockerroom.top (m_l5 has 11 reactions)'] = !body.includes('m_s6') && !body.includes('a SCRIBE line with 11');
  const none = cardsOf({ chat: { scribe: [], lockerRoom: [] } });
  out['T7 S-C11: when home.js reports the chat engine is not bound to this league (empty candidate arrays), NO chat card renders — and every other card still does'] = ofType(none, 'scribe.post').length === 0 && ofType(none, 'lockerroom.top').length === 0 && ofType(none, 'slate.published').length === 2 && ofType(none, 'picks.submitted').length === 1;
  const unbound = cardsOf({ chat: { scribe: undefined, lockerRoom: null } });
  out['T7b …and malformed candidate arrays are an empty feed, not a throw'] = ofType(unbound, 'scribe.post').length === 0;
  out['T8 lockerroom.top: the day key in the id comes from the snapshot (the viewer\'s timezone date), and it needs at least one reaction'] = ofType(cardsOf(), 'lockerroom.top')[0].id === 'lockerroom.top:L1:-:-:2026-09-12'
    && ofType(cardsOf({ chat: { scribe: [], lockerRoom: [{ id: 'z', ts: 1, author: 'p2', authorName: 'B', body: 'hi', reactionCount: 0 }] } }), 'lockerroom.top').length === 0;
  const leak = JSON.stringify(cardsOf({ chat: { scribe: [{ id: 'x', ts: 1, author: 'scribe', authorName: 'SCRIBE', body: 'hello', feedback: { secret: 'f' }, meta: { kind: 'other', pick: 'Duke' }, visibleTo: null }], lockerRoom: [{ id: 'y', ts: 1, author: 'p2', authorName: 'B', body: 'hi', reactionCount: 2, feedback: { secret: 'f2' }, meta: { pick: 'Duke' } }] } }).filter(c => c.type === 'scribe.post' || c.type === 'lockerroom.top'));
  { // C3 (security, 2026-10-01): the ROSTER name beats the row's own free `authorName`
    const spoof = ofType(cardsOf({ chat: { scribe: [], lockerRoom: [{ id: 's1', ts: 1, author: 'p2', authorName: 'Kihoon', body: 'hot take', reactionCount: 5 }] } }), 'lockerroom.top')[0];
    out['T10 C3: a row from p2 (Brayden) labelled authorName "Kihoon" renders as BRAYDEN — the roster name wins, a sender cannot rename himself'] = !!spoof && spoof.facts.authorName === 'Brayden';
    const unknown = ofType(cardsOf({ chat: { scribe: [], lockerRoom: [{ id: 's2', ts: 1, author: 'pX', authorName: 'Guest', body: 'hi', reactionCount: 2 }] } }), 'lockerroom.top')[0];
    const none = ofType(cardsOf({ chat: { scribe: [], lockerRoom: [{ id: 's3', ts: 1, author: 'pY', body: 'hi', reactionCount: 2 }] } }), 'lockerroom.top')[0];
    out['T10b …and the row\'s label is only the FALLBACK for an author the roster does not know ("Guest"), then "Someone"'] = !!unknown && unknown.facts.authorName === 'Guest' && !!none && none.facts.authorName === 'Someone';
  }
  out['T9 S-C8: no raw message field survives into a card — no feedback, no meta (only allow-listed facts)'] = !leak.includes('secret') && !leak.includes('Duke') && !leak.includes('feedback') && !leak.includes('"meta"');
  return out;
}

// ── SB-22 (2026-10-01) — year.ago's denominator ────────────────────────────────────────────────
// The card divided EVERY 2025 week by a hard-coded 10 ("140 = 14 weeks x 10"). Drew, 2026-10-01:
// not every 2025 week had exactly 10 games. The record must use the week's REAL game count from the
// data the card already reads (SEASON_2025), and when that count is unknown print the raw count with
// no denominator ("7 correct"). The real dataset states one week's slate size — the Best-week
// superlative's "9/10 (Week 13)" — and none for the other 13 weeks.
/** year.ago for the current week renumbered to 2025 week `n`, from module F. */
const yearAgoFor = (F, n) => derive(F, snapshotWith(F, { ...league('open'), weeks: league('open').weeks.map(w => (w.weekId === 'w2' ? { ...w, weekNumber: n } : w)) }))
  .filter(c => c.type === 'year.ago' && c.weekId === 'w2')[0] || null;
function yearAgoChecks(F) {
  const out = {};
  const w2 = yearAgoFor(F, 2), w13 = yearAgoFor(F, 13);
  out['YA1 unknown count: 2025 week 2 (SEASON_2025 states no slate size for it) prints the raw count with NO denominator — "7 correct", never a guessed "/10"'] = !!w2 && w2.facts.record === '7 correct';
  // SB-22 scribe copy pass (2026-10-01, coordinator-approved): the note's verb is "had", not "went" ("went 7 correct"
  // doesn't read) — the same verb change scribe made to the year.ago caption pools. YA2, YF2, 7-6 and 8-14 re-pinned.
  out['YA2 …and the note says it the same way'] = !!w2 && w2.facts.note === "A year ago this week, Brayden & Drew had 7 correct — the league's best that week.";
  out['YA3 known count: week 13, whose slate the dataset itself states ("Kevin & Koby — 9/10 (Week 13)"), keeps 9/10 and its superlative'] = !!w13 && w13.facts.record === '9/10' && w13.facts.superlative === 'the best week on record';
  // Sweep all 14 weeks against SEASON_2025 itself: a "/" appears ONLY where the dataset states the week's size.
  const bad = [];
  for (let n = 1; n <= 14; n++) {
    const c = yearAgoFor(F, n);
    const max = Math.max(...Object.values(hist.SEASON_2025.weeklyScores).map(a => a[n - 1]));
    const want = n === 13 ? `${max}/10` : `${max} correct`;
    if (!c || c.facts.record !== want) bad.push(`wk${n}: ${c ? c.facts.record : 'no card'} (want ${want})`);
  }
  out[`YA4 all 14 weeks: the record is "<top score> correct" except week 13 ("9/10", the dataset's own) — no week is divided by an assumed 10 (wrong: ${bad.join(' ; ') || 'none'})`] = bad.length === 0;
  return out;
}
// A FIXTURE 2025 dataset with slates that are NOT 10 games, loaded into the REAL feed-cards.js by pointing its
// history-2025.js import at this source (a data: URL — js/history-2025.js and js/feed-cards.js are never touched).
const YA_FIXTURE_HIST = 'export const SEASON_2025 = ' + JSON.stringify({
  season: '2025',
  weeklyScores: { Ann: [7, 3, 9, 4, 4], Ben: [5, 3, 9, 6, 2] },
  superlatives: [
    { label: 'Best week', value: 'Ann & Ben — 9/12 (Week 3)' },   // week 3: a 12-game slate, and the superlative
    { label: 'Short slate', value: 'Ann — 7/8 (Week 1)' },        // week 1: an 8-game slate
    { label: 'Bad entry', value: 'Ben — 6/5 (Week 4)' },          // week 4: a stated size BELOW the top score — not believed
    { label: 'Source one', value: 'Ann — 4/9 (Week 5)' },         // week 5: two sources disagree on the size…
    { label: 'Source two', value: 'Ann — 4/11 (Week 5)' },        // …so it is unknown
  ],                                                              // week 2: no stated size at all
}) + ';';
const YA_FIXTURE_URL = 'data:text/javascript;base64,' + Buffer.from(YA_FIXTURE_HIST).toString('base64');
async function feedCardsWithHistory(histUrl) {
  let src = await readFile(fileURLToPath(new URL('./js/feed-cards.js', import.meta.url)), 'utf8');
  src = src.replace(/from '\.\/([\w.-]+)'/g, (_m, f) => `from '${f === 'history-2025.js' ? histUrl : new URL('./js/' + f, import.meta.url).href}'`);
  return import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
}
function yearAgoFixtureChecks(F) {
  const out = {};
  const r = (n) => { const c = yearAgoFor(F, n); return c ? c.facts.record : null; };
  const w3 = yearAgoFor(F, 3);
  out['YF1 a 2025 week whose slate was 8 games prints 7/8 — the real count, not /10'] = r(1) === '7/8';
  out['YF2 a 12-game week prints 9/12, and the Best-week superlative is still claimed (its text agrees)'] = r(3) === '9/12' && !!w3 && w3.facts.superlative === 'the best week on record' && w3.facts.note === 'A year ago this week, Ann & Ben had 9/12 — the best week on record.';
  out['YF3 a week with no stated size prints the raw count: "3 correct"'] = r(2) === '3 correct';
  out['YF4 a stated size BELOW the week\'s top score (6 of 5) is not believed: "6 correct"'] = r(4) === '6 correct';
  out['YF5 two sources stating different sizes (9 vs 11) make the size unknown: "4 correct"'] = r(5) === '4 correct';
  out['YF6 fixture check: the fixture module really read the fixture dataset (week 1\'s top scorer is Ann)'] = !!yearAgoFor(F, 1) && yearAgoFor(F, 1).facts.name === 'Ann';
  return out;
}
{
  const res = chatChecks(fc);
  for (const [label, ok] of Object.entries(res)) assert(ok === true, `7: ${label}`);
  // excerpt: 120 code points, truncated BEFORE escaping, never a lone surrogate
  assert(fc.truncateExcerpt('a'.repeat(119) + '\u{1F600}\u{1F600}tail', 120).replace('…', '') === 'a'.repeat(119) + '\u{1F600}', '7-1: truncateExcerpt cuts at 120 CODE POINTS — a surrogate pair is never sliced in half');
  assert(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(fc.truncateExcerpt('a'.repeat(119) + '\u{1F600}\u{1F600}tail', 120)), '7-2: …and the result contains no lone surrogate');
  assert(fc.truncateExcerpt('short  \n text') === 'short text' && fc.truncateExcerpt('x'.repeat(120)) === 'x'.repeat(120) && fc.truncateExcerpt('x'.repeat(121)).endsWith('…') && Array.from(fc.truncateExcerpt('x'.repeat(500))).length === 121, '7-3: whitespace collapses; exactly 120 is untouched; longer is cut to 120 plus an ellipsis');
  const hostile = fc.cardCopy({ type: 'lockerroom.top', facts: { authorName: 'A', excerpt: fc.truncateExcerpt('<img src=x onerror=alert(1)>' + 'x'.repeat(200)), reactionCount: 2 } }, { escHtml: esc });
  assert(!/[<>]/.test(hostile.body) && hostile.body.includes('&lt;img'), `7-4: truncate-THEN-escape — a hostile excerpt is inert HTML text, and no entity is cut mid-token (${hostile.body.slice(0, 60)}…)`);
  // year.ago
  const yaw = (n, extra = {}) => derive(fc, snapshotWith(fc, { ...league('open'), weeks: league('open').weeks.map(w => (w.weekId === 'w2' ? { ...w, weekNumber: n } : w)) }, extra)).filter(c => c.type === 'year.ago');
  const w2 = yaw(2)[0];
  // SB-22 (2026-10-01) — RE-DERIVED: this used to expect '7/10'. Drew, 2026-10-01: not every 2025 week had exactly 10 games, and
  // SEASON_2025 states no slate size for week 2, so the record is the raw count with no denominator (yearAgoChecks YA1/YA2).
  assert(w2 && w2.facts.name === 'Brayden & Drew' && w2.facts.record === '7 correct' && w2.facts.weekN === 2 && !('superlative' in w2.facts), `7-5: week 2 → 2025's week 2 high (7) belongs to Brayden & Drew — straight from SEASON_2025.weeklyScores (got ${JSON.stringify(w2 && w2.facts)})`);
  const w13 = yaw(13)[0];
  assert(w13 && w13.facts.name === 'Kevin & Koby' && w13.facts.record === '9/10' && w13.facts.superlative === 'the best week on record' && w13.facts.note === 'A year ago this week, Kevin & Koby had 9/10 — the best week on record.',   // "had": SB-22 scribe copy pass, 2026-10-01 (see YA2)
    `7-6: week 13 → Kevin & Koby 9/10, the dataset's own "best week on record" (worked example matches SEASON_2025 exactly; got ${JSON.stringify(w13 && w13.facts)})`);
  assert(hist.SEASON_2025.weeklyScores.Kevin[12] === 9 && hist.SEASON_2025.weeklyScores.Koby[12] === 9 && hist.SEASON_2025.superlatives.find(s => s.label === 'Best week').value.startsWith('Kevin & Koby — 9/10 (Week 13)'), '7-7: fixture check — SEASON_2025 week 13 really is Kevin 9 / Koby 9 and its superlatives agree');
  const yaw2 = (n) => yaw(n).filter(c => c.weekId === 'w2');
  assert(yaw2(15).length === 0 && yaw2(14).length === 1 && yaw2(0).length === 0 && yaw2(NaN).length === 0, '7-8: a week with no 2025 column (15, 0) or no usable number (NaN) yields NO card for that week — never a broken or empty-looking one; week 14 (the last column) does');
  assert(derive(fc, snapshotWith(fc, league('open'), { snap: { currentWeekId: 'nope' } })).filter(c => c.type === 'year.ago')[0].weekId === 'w2', '7-9: an unknown currentWeekId falls back to the latest non-draft week');
  const draftOnly = { ...league('open'), weeks: league('open').weeks.map(w => ({ ...w, status: 'draft' })) };
  assert(derive(fc, snapshotWith(fc, draftOnly)).filter(c => c.type === 'year.ago').length === 0, '7-10: with only DRAFT weeks there is no current week, so no year.ago');
  assert(w2.requiresReveal === 'never' && w2.reason === 'A year ago this week', '7-11: year.ago is never-class (2025 is closed, already-public history) with its fixed reason label');
  // SB-22 — the denominator is the week's REAL slate size, or none.
  for (const [label, ok] of Object.entries(yearAgoChecks(fc))) assert(ok === true, `7-12: ${label}`);
  const fcYA = await feedCardsWithHistory(YA_FIXTURE_URL);
  for (const [label, ok] of Object.entries(yearAgoFixtureChecks(fcYA))) assert(ok === true, `7-13: ${label}`);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[8] Copy and escaping (S-C6) — the injected escaper is REQUIRED; hostile data stays inert…');
// ═══════════════════════════════════════════════════════════════════════════
function copyChecks(F) {
  const out = {};
  const sample = ofType(cardsFinal, 'week.result', 'w2')[0];
  let t1 = null; try { F.cardCopy(sample); } catch (e) { t1 = e; }
  out['CP1 cardCopy with NO escHtml THROWS a TypeError (the leagues-home requireEscHtml pattern) — it does not render unescaped'] = t1 instanceof TypeError && /escHtml/.test(t1.message);
  let t2 = null; try { F.cardCopy(sample, { escHtml: 'nope' }); } catch (e) { t2 = e; }
  let t3 = null; try { F.cardCopy(sample, { escHtml: undefined }); } catch (e) { t3 = e; }
  out['CP2 …a non-function escaper throws too — there is no `typeof escHtml === "function" ? escHtml : String` degrade path'] = t2 instanceof TypeError && t3 instanceof TypeError;
  let t4 = null; try { F.requireEscHtml(null, 'x'); } catch (e) { t4 = e; }
  out['CP3 requireEscHtml is exported and throws on null'] = t4 instanceof TypeError && F.requireEscHtml(esc, 'x') === esc;
  // hostile data everywhere
  const HOSTILE = '"><img src=x onerror=alert(1)>';
  const L = mapStrings(league('final'), (s) => s.split('Washington').join(HOSTILE).split('Kevin').join('<script>alert(2)</script>'));
  L.players[0].initials = '<b>';
  const cards = derive(F, snapshotWith(F, L, { chat: { scribe: [{ id: 'h1', ts: 1, author: 'scribe', authorName: 'SCRIBE', body: '<svg onload=alert(3)>' }], lockerRoom: [{ id: 'h2', ts: 2, author: 'p5', authorName: '<i>J</i>', body: '<a href="javascript:alert(4)">x</a>', reactionCount: 3 }] } }));
  let rawLeak = 0, escSeen = 0, strings = 0;
  for (const c of cards) {
    const copy = F.cardCopy(c, { escHtml: esc });
    const texts = [copy.title, copy.body, ...copy.chips.map(ch => ch.initialsHtml), cap.captionFor(c, { escHtml: esc })];
    for (const s of texts) { strings++; if (/[<>"]/.test(s)) rawLeak++; if (/&lt;|&gt;|&quot;/.test(s)) escSeen++; }
  }
  out[`CP4 hostile team / player / initials / chat text: across ${cards.length} cards (title + body + chips + caption) no string contains a raw < > or "`] = rawLeak === 0 && strings > 150;
  out['CP5 …and the escaped forms ARE present (positive control — the hostile data really flowed through)'] = escSeen > 10;
  const idEsc = (s) => String(s);
  const sampleHost = cards.find(c => c.type === 'called.it');
  out['CP6 negative control: with a NON-escaping escaper the same card DOES carry a raw < — so CP4 can fail'] = /[<>]/.test(F.cardCopy(sampleHost, { escHtml: idEsc }).title);
  out['CP7 numbers cross the boundary through a numeric helper: a non-finite score renders as nothing, never "NaN" or an injected string'] = !/NaN|undefined|null/.test(F.cardCopy({ type: 'game.final', facts: { awayTeam: 'A', homeTeam: 'H', awayScore: '<x>', homeScore: NaN, atsWinnerTeam: 'A', marginCovered: '3', chips: [] } }, { escHtml: esc }).title) && !/</.test(F.cardCopy({ type: 'game.final', facts: { awayTeam: 'A', homeTeam: 'H', awayScore: '<x>', homeScore: NaN, chips: [] } }, { escHtml: esc }).title);
  return out;
}
{
  const res = copyChecks(fc);
  for (const [label, ok] of Object.entries(res)) assert(ok === true, `8: ${label}`);
  // exact copy, DI-363's table
  const E = { escHtml: esc, formatKickoff: (iso) => `KICK(${iso.slice(0, 10)})` };
  const copy = (cards, type, weekId, memberId) => fc.cardCopy(ofType(cards, type, weekId).find(c => memberId === undefined || c.memberId === memberId), E);
  assert(copy(cardsFinal, 'slate.published', 'w2').title === "Week 2's slate is up — 4 games, first kickoff KICK(2026-09-12).", `8-1: slate.published — "Week 2's slate is up — 4 games, first kickoff …" with the injected formatter (got ${copy(cardsFinal, 'slate.published', 'w2').title})`);
  assert(copy(cardsOpen, 'picks.submitted', 'w2').title === '6/6 in for Week 2.', '8-2: picks.submitted — "6/6 in for Week 2."');
  assert(copy(cardsLive, 'week.revealed', 'w2').title === 'Week 2 is revealed. Every pick is visible now.', '8-3: week.revealed — "Week 2 is revealed. Every pick is visible now."');
  const gf = copy(cardsFinal, 'game.final', 'w2', null);
  assert(ofType(cardsFinal, 'game.final', 'w2').map(c => fc.cardCopy(c, E).title).includes('Washington 20, Oregon 17 (Final) — Washington covered by 10.'), '8-4: game.final — "Washington 20, Oregon 17 (Final) — Washington covered by 10."');
  const gc = ofType(cardsFinal, 'game.final', 'w2').find(c => c.gameId === 'g21');
  assert(JSON.stringify(fc.cardCopy(gc, E).chips) === JSON.stringify([{ initialsHtml: 'DH', result: 'loss' }, { initialsHtml: 'BR', result: 'win' }, { initialsHtml: 'KC', result: 'loss' }, { initialsHtml: 'KR', result: 'win' }, { initialsHtml: 'JP', result: 'win' }, { initialsHtml: 'KB', result: 'win' }]), '8-5: game.final chips come back as {initialsHtml, result: win|loss} for the .badge-win / .badge-loss row');
  assert(copy(cardsFinal, 'called.it', 'w2', 'p2').title === 'Brayden called it — Washington +7 upset outright, 20–17.', '8-6: called.it — "Brayden called it — Washington +7 upset outright, 20–17."');
  assert(copy(cardsFinal, 'stood.alone', 'w2').title === 'Jacob stood alone on Miami — and it covered.', '8-7: stood.alone — "Jacob stood alone on Miami — and it covered."');
  const wr = copy(cardsFinal, 'week.result', 'w2');
  assert(wr.title === 'Week 2 is final.' && wr.body === 'Jacob took it, 4–0.', '8-8: week.result — "Week 2 is final." / "Jacob took it, 4–0."');
  const pw5 = copy(cardsFinal, 'player.week', 'w2', 'p5'), pw1 = copy(cardsFinal, 'player.week', 'w2', 'p1');
  assert(pw5.title === "Jacob's Week 2: 4–0" && pw5.body === 'On a 5-game cover streak.' && pw1.title === "Drew's Week 2: 1–3" && pw1.body === '', '8-9: player.week — "Jacob\'s Week 2: 4–0" + "On a 5-game cover streak." only at STREAK_MIN+; "Drew\'s Week 2: 1–3" with no body');
  const up = copy(cardsFinal, 'rank.changed', 'w2', 'p5'), dn = copy(cardsFinal, 'rank.changed', 'w2', 'p3');
  assert(up.title === 'Jacob moved into 1st this week.' && up.body === 'Up from 2nd after Week 2.' && dn.title === 'Kevin slipped to 6th this week.' && dn.body === 'Down from 4th after Week 2.',
    '8-10: rank.changed — "moved into 1st / Up from 2nd" for a rise; a FALL says "slipped to 6th / Down from 4th" (the DI\'s "moved into … Up from" would be false for a drop)');
  assert(copy(cardsFinal, 'streak.extended', 'w2', 'p5').title === 'Jacob is riding a 5-game cover streak.' && copy(cardsFinal, 'streak.extended', 'w2', 'p3').title === 'Kevin is riding a 4-game miss streak.', '8-11: streak.extended — "Jacob is riding a 5-game cover streak." (a miss run says "miss streak")');
  assert(copy(cardsFinal, 'streak.broken', 'w2', 'p1').title === "Drew's 4-game streak snapped this week.", '8-12: streak.broken — "Drew\'s 4-game streak snapped this week."');
  const L = league('final');
  const rows = L.weeklyResults.map(r => (r.playerId === 'p1' && r.weekId === 'w1') ? { ...r, correctCount: 24, correctPicks: 24 } : r);
  assert(fc.cardCopy(ofType(derive(fc, snapshotWith(fc, { ...L, weeklyResults: rows })), 'milestone.reached', 'w2')[0], E).title === 'Drew hit 25 correct picks this season.', '8-13: milestone.reached — "Drew hit 25 correct picks this season."');
  // SB-22 (2026-10-01): '7/10' -> '7 correct' — 2025 week 2's slate size is not in the dataset (yearAgoChecks YA1).
  // SB-22 scribe copy pass (2026-10-01, coordinator-approved): 'went' -> 'had' (see YA2).
  assert(copy(cardsFinal, 'year.ago', 'w2').title.includes('Brayden &amp; Drew had 7 correct') && copy(cardsFinal, 'year.ago', 'w2').title.startsWith('A year ago this week,'), '8-14: year.ago — the note, escaped');
  assert(copy(cardsFinal, 'scribe.post').body === 'A quiet week. Somebody has to be quiet.' && copy(cardsFinal, 'scribe.post').title === '', '8-15: scribe.post — the message VERBATIM as the body (escaped), no title');
  const lt = copy(cardsFinal, 'lockerroom.top');
  assert(lt.title === "Today's top message in the Locker Room" && lt.body === '“the real winner of the day” — 4 reactions.', `8-16: lockerroom.top — "Today's top message in the Locker Room" / "“…” — 4 reactions." (got ${lt.body})`);
  assert(fc.cardCopy({ type: 'lockerroom.top', facts: { authorName: 'x', excerpt: 'e', reactionCount: 1 } }, E).body.endsWith('1 reaction.'), '8-17: one reaction is singular');
  assert(fc.cardCopy({ type: 'mystery', facts: {} }, E).title === '' && fc.cardCopy(null, E).title === '', '8-18: an unknown type or a null card renders as nothing (never a throw, never "undefined")');
  assert(fc.ordinal(1) === '1st' && fc.ordinal(2) === '2nd' && fc.ordinal(3) === '3rd' && fc.ordinal(4) === '4th' && fc.ordinal(11) === '11th' && fc.ordinal(12) === '12th' && fc.ordinal(13) === '13th' && fc.ordinal(21) === '21st' && fc.ordinal(22) === '22nd' && fc.ordinal(111) === '111th' && fc.ordinal('x') === '', '8-19: ordinal() — 1st 2nd 3rd 4th, the 11th–13th teens, 21st, 22nd, 111th, garbage → ""');
  assert(fc.streakWord('misses') === 'miss' && fc.streakWord('covers') === 'cover', '8-20: streakWord — covers → cover, misses → miss');
  // finalizeFacts
  assert((() => { let e = null; try { fc.finalizeFacts('called.it', { playerId: 'p', margin: 5 }); } catch (x) { e = x; } return !!e && /forbidden key "margin"/.test(e.message); })(), '8-21: finalizeFacts THROWS on a forbidden key (margin) — a caller offering one is a bug to fix, not paper over');
  assert((() => { let e = null; try { fc.finalizeFacts('game.final', { chips: [{ playerId: 'p1', result: 'win', selectedTeam: 'Duke' }] }); } catch (x) { e = x; } return !!e && /selectedTeam/.test(e.message); })(), '8-22: …at ANY depth: a selectedTeam nested inside the chips array throws');
  const ff = fc.finalizeFacts('called.it', { playerId: 'p', playerName: 'n', team: 't', bogus: 1, matchup: undefined, scoreLine: null });
  assert(JSON.stringify(ff) === '{"playerId":"p","playerName":"n","team":"t"}', `8-23: an unknown key is DROPPED and undefined/null values are omitted (got ${JSON.stringify(ff)})`);
  assert((() => { let e = null; try { fc.finalizeFacts('not.a.type', {}); } catch (x) { e = x; } return !!e; })(), '8-24: a type with no allow-list throws — nothing is derived for a type nobody declared');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[9] Captions (S-C12) — every placeholder maps to an allow-listed fact; banned vocabulary; determinism…');
// ═══════════════════════════════════════════════════════════════════════════
function captionChecks(C, F) {
  const out = {};
  const pools = C.CAPTION_POOLS;
  const lines = (p) => pools[p].map(l => (typeof l === 'string' ? l : l.t));
  const POOL_NAMES = Object.keys(pools);
  out['K1 there are exactly 16 pools'] = POOL_NAMES.length === 16;
  const total = POOL_NAMES.reduce((n, p) => n + pools[p].length, 0) + Object.values(C.WITHHELD_CAPTION_LINES).reduce((n, a) => n + a.length, 0);
  out['K2 all 88 of the caption document\'s lines are selectable (the two alma-mater lines went live with the player.week amendment); nothing is withheld'] = POOL_NAMES.reduce((n, p) => n + pools[p].length, 0) === 88 && total === 88 && Object.keys(C.WITHHELD_CAPTION_LINES).length === 0;
  let unmapped = [], outside = [];
  for (const p of POOL_NAMES) {
    const m = C.CAPTION_FACT_MAP[p];
    const known = new Set([...Object.keys(m.fields), ...Object.keys(m.derived)]);
    for (const t of lines(p)) for (const tok of [...t.matchAll(/\{(\w+)\}/g)].map(x => x[1])) if (!known.has(tok)) unmapped.push(`${p}:{${tok}}`);
    const allowed = F.CARD_ALLOWED_FACTS[m.cardType];
    for (const k of [...Object.values(m.fields), ...Object.values(m.derived).flatMap(d => d.from)]) if (!allowed.includes(k)) outside.push(`${p}→${k}`);
  }
  out['K3 S-C12: every {placeholder} in every line is a MAPPED placeholder of its pool (mechanical regex-extract-and-diff over all 88 lines)'] = unmapped.length === 0;
  out['K4 S-C12: every fact a pool reads is on its card type\'s CARD_ALLOWED_FACTS list'] = outside.length === 0;
  const valueKeys = Object.values(C.CAPTION_FACT_MAP).flatMap(m => [...Object.values(m.fields), ...Object.values(m.derived).flatMap(d => d.from)]);
  out['K5 `margin` is NEVER a fact key: the document\'s {margin} placeholder maps to scoreLine'] = !valueKeys.includes('margin') && C.CAPTION_FACT_MAP['called.it'].fields.margin === 'scoreLine';
  out['K6 no mapped fact is a FORBIDDEN_META_KEYS entry'] = valueKeys.every(k => !notifyCopy.FORBIDDEN_META_KEYS.includes(k));
  const allLines = [...POOL_NAMES.flatMap(lines), ...Object.values(C.WITHHELD_CAPTION_LINES).flat()];
  const hits = allLines.flatMap(l => C.CAPTION_BANNED_VOCAB.filter(re => re.test(l)).map(re => `${re} in "${l}"`));
  out['K7 banned vocabulary (bet, wager, odds, unit(s), ROI, drink, tab, owe, the chart, faded) returns ZERO hits across every line'] = hits.length === 0;
  out['K8 the "faded" line is REWORDED: stood.alone #2 reads "Everyone else went the other way on {team}…"'] = lines('stood.alone')[1] === "Everyone else went the other way on {team}. {player} didn't, and it covered.";
  out['K9 the blind-rule-critical pool (picks.submitted) can only ever mention {submittedCount} / {totalPlayers} / {weekN} — a closed-set assertion that it cannot drift toward naming a player or a team'] =
    lines('picks.submitted').every(l => [...l.matchAll(/\{(\w+)\}/g)].every(x => ['submittedCount', 'totalPlayers', 'weekN'].includes(x[1]))) && JSON.stringify(Object.keys(C.CAPTION_FACT_MAP['picks.submitted'].fields).sort()) === '["submittedCount","totalPlayers","weekN"]';
  out['K10 zero emoji in any line (the document\'s accepted judgment call)'] = allLines.every(l => !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(l));
  // determinism
  const fixed = { id: 'rank.changed:L1:w2:p3', type: 'rank.changed', facts: { playerName: 'Kevin', fromRank: 4, toRank: 6, weekN: 2, rankedCount: 6 } };
  const first = C.captionTextUnsafeForTests(fixed);
  let same = true; for (let i = 0; i < 100; i++) if (C.captionTextUnsafeForTests({ ...fixed }) !== first) same = false;
  out['K11 the SAME card id always selects the SAME line (100 repeated calls, byte-identical) — every device agrees'] = same && first.length > 0;
  const spread = new Set(); for (let i = 0; i < 300; i++) spread.add(C.captionTextUnsafeForTests({ id: `streak.extended:L1:w${i}:p1`, type: 'streak.extended', facts: { playerName: 'Drew', run: 4, kind: 'covers' } }).replace(/\bw\d+\b/g, ''));
  out['K12 different ids spread across the pool (≥ 5 of 6 distinct lines over 300 ids)'] = spread.size >= 5;
  // eligibility
  const sub = (n, t) => { const s = new Set(); for (let i = 0; i < 400; i++) s.add(C.captionTextUnsafeForTests({ id: `picks.submitted:L1:w${i}:-`, type: 'picks.submitted', facts: { weekN: 2, submittedCount: n, totalPlayers: t } })); return s; };
  out['K13 picks.submitted line 5 ("The rest know who they are") is selected ONLY when submittedCount < totalPlayers'] = [...sub(6, 6)].every(s => !s.includes('The rest know who they are')) && [...sub(4, 6)].some(s => s.includes('The rest know who they are'));
  const pwGood = (extra) => { const s = new Set(); for (let i = 0; i < 400; i++) s.add(C.captionTextUnsafeForTests({ id: `player.week:L1:w${i}:p1`, type: 'player.week', facts: { playerName: 'Drew', weekN: 2, wins: 4, losses: 1, ...extra } })); return s; };
  out['K14 player.week.good line 3 ("streak now") needs streakRun + streakKind: absent → never selected, present → selectable'] = [...pwGood({})].every(s => !s.includes('streak now')) && [...pwGood({ streakRun: 4, streakKind: 'covers' })].some(s => s.includes('4-game cover streak now'));
  const ALMA_WIN = { almaMaterResult: { team: 'Texas A&M', result: 'win' } }, ALMA_LOSS = { almaMaterResult: { team: 'Texas A&M', result: 'loss' } };
  out['K15 the alma-mater lines are selectable ONLY on a card that carries almaMaterResult: without the fact no caption mentions a school or "won"/"lost"; with it, "Texas A&M won" can be the line'] =
    [...pwGood({})].every(s => !/Texas A&M|and [A-Za-z&]+ (won|lost)/.test(s)) && [...pwGood(ALMA_WIN)].some(s => s.endsWith('and Texas A&M won.'));
  const pwBad = (extra) => { const s = new Set(); for (let i = 0; i < 400; i++) s.add(C.captionTextUnsafeForTests({ id: `player.week:L1:w${i}:p3`, type: 'player.week', facts: { playerName: 'Kevin', weekN: 2, wins: 0, losses: 4, ...extra } })); return s; };
  out['K15b player.week.bad line 5 ("… and X lost too.") is selectable ONLY when the school itself LOST — never after a win, never with no fact'] =
    [...pwBad({})].every(s => !s.includes(' too.')) && [...pwBad(ALMA_WIN)].every(s => !s.includes(' too.')) && [...pwBad(ALMA_LOSS)].some(s => s.endsWith('and Texas A&M lost too.'));
  const lr = (n) => { const s = new Set(); for (let i = 0; i < 300; i++) s.add(C.captionTextUnsafeForTests({ id: `lockerroom.top:L1:-:-:d${i}`, type: 'lockerroom.top', facts: { authorName: 'Jacob', reactionCount: n } })); return [...s]; };
  out['K24 reviewer note 5: one reaction is "1 reaction", never "1 reactions" — and a count of 4 still says "4 reactions"'] =
    lr(1).every(s => !/\b1 reactions\b/.test(s)) && lr(1).some(s => /\b1 reaction\b/.test(s)) && lr(4).every(s => !/\b4 reaction\b/.test(s)) && lr(4).some(s => /\b4 reactions\b/.test(s));
  out['K25 security N1: CAPTION_POOLS, CAPTION_FACT_MAP and WITHHELD_CAPTION_LINES are DEEP-frozen (no push, no reassign at any depth)'] = (() => {
    const deep = (o) => Object.isFrozen(o) && Object.values(o).every(v => (v && typeof v === 'object') ? deep(v) : true);
    let threw = 0;
    try { C.CAPTION_POOLS['stood.alone'].push('x'); } catch { threw++; }
    try { C.CAPTION_FACT_MAP['called.it'].fields.margin = 'margin'; } catch { threw++; }
    try { C.CAPTION_POOLS['picks.submitted'][4].when = 'always'; } catch { threw++; }
    return deep(C.CAPTION_POOLS) && deep(C.CAPTION_FACT_MAP) && deep(C.WITHHELD_CAPTION_LINES) && threw === 3;
  })();
  // routing
  const route = (f) => C.captionPoolFor({ type: 'rank.changed', facts: { fromRank: 3, toRank: 2, rankedCount: 6, ...f } });
  out['K16 rank.changed routes: to 1st → into1st; to last → intoLast; up → up; down → down'] = route({ toRank: 1, fromRank: 3 }) === 'rank.changed.into1st' && route({ toRank: 6, fromRank: 4 }) === 'rank.changed.intoLast' && route({ toRank: 2, fromRank: 5 }) === 'rank.changed.up' && route({ toRank: 5, fromRank: 2 }) === 'rank.changed.down';
  out['K17 player.week routes: losing record → bad pool, winning or even → good pool'] = C.captionPoolFor({ type: 'player.week', facts: { wins: 1, losses: 3 } }) === 'player.week.bad' && C.captionPoolFor({ type: 'player.week', facts: { wins: 4, losses: 0 } }) === 'player.week.good' && C.captionPoolFor({ type: 'player.week', facts: { wins: 2, losses: 2 } }) === 'player.week.good';
  out['K18 year.ago routes to the superlative pool only when the card carries a superlative'] = C.captionPoolFor({ type: 'year.ago', facts: { superlative: 'the best week on record' } }) === 'year.ago.superlative' && C.captionPoolFor({ type: 'year.ago', facts: {} }) === 'year.ago';
  out['K19 slate.published, week.revealed, game.final, scribe.post are NOT captioned in v1 (empty string)'] = ['slate.published', 'week.revealed', 'game.final', 'scribe.post'].every(t => C.captionTextUnsafeForTests({ id: 'x', type: t, facts: { weekN: 1, body: 'b' } }) === '');
  // every produced card captions cleanly
  let bad = 0, n = 0;
  for (const c of [...cardsFinal, ...cardsLive, ...cardsOpen]) { const t = C.captionTextUnsafeForTests(c); n++; if (/[{}]/.test(t) || /undefined|NaN|null/.test(t)) bad++; }
  out[`K20 across all ${n} derived cards no caption has an unfilled {slot}, "undefined", "NaN" or "null"`] = bad === 0 && n > 100;
  const sampleCaps = [...cardsFinal, ...cardsOpen].filter(c => c.type === 'picks.submitted').map(c => C.captionTextUnsafeForTests(c)).join(' ');
  out['K21 BLIND: the picks.submitted caption for an OPEN week names no player and no team'] = sampleCaps.length > 0 && !/Drew|Brayden|Kevin|Koby|Jacob|Kihoon/.test(sampleCaps) && W2_TEAMS.every(t => !sampleCaps.includes(t));
  let t1 = null; try { C.captionFor(cardsFinal[0]); } catch (e) { t1 = e; }
  out['K22 captionFor REQUIRES the injected escaper (throws TypeError without it) and escapes a hostile name'] = t1 instanceof TypeError && /&lt;b&gt;/.test(C.captionFor({ id: 'x:1', type: 'milestone.reached', facts: { playerName: '<b>', mark: 25, total: 25 } }, { escHtml: esc }));
  let t2 = null; try { C.captionTextUnsafeForTests({ id: 'streak.extended:x', type: 'streak.extended', facts: { playerName: 'A', run: 4, kind: 'covers' } }); } catch (e) { t2 = e; }
  out['K23 a card with every needed fact never throws'] = t2 === null;
  return out;
}
{
  const res = captionChecks(cap, fc);
  for (const [label, ok] of Object.entries(res)) assert(ok === true, `9: ${label}`);
  assert(Object.keys(res).length >= 23, `9-floor: ${Object.keys(res).length} caption checks ran`);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[10] Static scans — no canViewOtherPicks, no chat import, no writes, no DOM…');
// ═══════════════════════════════════════════════════════════════════════════
function scanSource(src) {
  const code = stripComments(src);
  const imps = importsOf(src);
  const v = [];
  if (/canViewOtherPicks/.test(code)) v.push('canViewOtherPicks');
  if (!imps.some(i => i.from === './storage.js' && /\barePicksPublic\b/.test(i.names))) v.push('does not import arePicksPublic from ./storage.js');
  for (const i of imps) if (/(^|\/)(chat|chatTransport|app|supabase-backend|backend|auth|chat-ui)\.js$/.test(i.from)) v.push(`imports ${i.from}`);
  for (const i of imps) if (/\b(save|saveSetting|sendEvent|sendChatEvent|addBotPostIfNew|setItem)\b/.test(i.names)) v.push(`imports a writer (${i.names.replace(/\s+/g, ' ')})`);
  if (/\b(save|saveSetting|sendEvent|sendChatEvent|addBotPostIfNew)\s*\(/.test(code) || /\blocalStorage\b/.test(code)) v.push('calls a writer / touches localStorage');
  if (/innerHTML|insertAdjacentHTML|document\.|window\./.test(code)) v.push('touches the DOM');
  if (/typeof\s+escHtml\s*===?\s*'function'\s*\?/.test(code)) v.push('an optional-escaper fallback');
  return v;
}
{
  const fcSrc = await read('./js/feed-cards.js');
  assert(JSON.stringify(scanSource(fcSrc)) === '[]', `10-1: feed-cards.js — imports arePicksPublic, NOT canViewOtherPicks; no chat / app / backend / auth import (S-C8); no writer imported or called; no DOM; no optional escaper (violations: ${JSON.stringify(scanSource(fcSrc))})`);
  const imps = importsOf(fcSrc);
  assert(imps.map(i => i.from).sort().join() === ['./data-model.js', './history-2025.js', './notify-copy.js', './scoring.js', './stats-core.js', './stats.js', './storage.js'].join(), `10-2: feed-cards.js's complete import list is data-model, history-2025, notify-copy, scoring, stats-core, stats, storage (got ${imps.map(i => i.from).join(', ')})`);
  const stSrc = await read('./js/stats.js'), scSrc = await read('./js/stats-core.js'), clSrc = await read('./js/feed-caption-lines.js');
  assert(scanSource(stSrc).filter(x => x !== 'does not import arePicksPublic from ./storage.js').length === 0 && scanSource(scSrc).filter(x => x !== 'does not import arePicksPublic from ./storage.js').length === 0 && scanSource(clSrc).filter(x => x !== 'does not import arePicksPublic from ./storage.js').length === 0,
    '10-3: stats.js, stats-core.js and feed-caption-lines.js have no writer, no DOM, no chat/app/backend import, no canViewOtherPicks');
  assert(importsOf(clSrc).map(i => i.from).join() === './feed-cards.js', '10-4: feed-caption-lines.js imports only feed-cards.js (one-way: feed-cards never imports the captions)');
  assert(!importsOf(fcSrc).some(i => i.from === './feed-caption-lines.js'), '10-5: …and feed-cards.js does not import feed-caption-lines.js');
  const mathy = stripComments(fcSrc);
  assert(!/Math\.random/.test(mathy) && !/Math\.random/.test(stripComments(clSrc)), '10-6: no Math.random anywhere in the card or caption modules (caption selection is deterministic by id)');
  assert(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|setTimeout|setInterval/.test(mathy), '10-7: feed-cards.js never fetches and owns no timer (pure, synchronous)');

  // security C4 — the UNESCAPED caption helper has no consumer outside tests (it is named captionTextUnsafeForTests for exactly this reason)
  const { readdir } = await import('node:fs/promises');
  const jsDir = new URL('./js/', import.meta.url);
  const jsFiles = (await readdir(jsDir)).filter(f => f.endsWith('.js'));
  const jsSources = Object.fromEntries(await Promise.all(jsFiles.map(async f => [f, await readFile(fileURLToPath(new URL(f, jsDir)), 'utf8')])));
  const unsafeConsumers = (files) => Object.entries(files).filter(([f, src]) => f !== 'feed-caption-lines.js' && /captionTextUnsafeForTests|\bcaptionTextFor\b/.test(stripComments(src))).map(([f]) => f);
  assert(jsFiles.length > 30 && 'feed-caption-lines.js' in jsSources && unsafeConsumers(jsSources).length === 0,
    `10-8: C4 — across all ${jsFiles.length} js/*.js files no module but feed-caption-lines.js names captionTextUnsafeForTests (or the old captionTextFor): ${JSON.stringify(unsafeConsumers(jsSources))}`);
  const html = await read('./index.html');
  assert(!/captionText/.test(html), '10-9: …and index.html does not reference it either');
  assert(unsafeConsumers({ ...jsSources, 'home.js': 'import { captionTextUnsafeForTests } from "./feed-caption-lines.js"; el.innerHTML = captionTextUnsafeForTests(card);' }).join() === 'home.js'
    && unsafeConsumers({ ...jsSources, 'home.js': 'const t = captionTextFor(card);' }).join() === 'home.js',
    '10-10: M-C4 — the scan has teeth: a (hypothetical) home.js importing the unescaped helper, or still using the pre-rename name, is caught');
  assert(/export function captionTextUnsafeForTests/.test(jsSources['feed-caption-lines.js']) && !/export function captionTextFor\b/.test(jsSources['feed-caption-lines.js']) && /export function captionFor\(card, \{ escHtml \}/.test(jsSources['feed-caption-lines.js']),
    '10-11: the escaped entry point (captionFor, REQUIRING escHtml) is the only caption function with a normal name');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[11] MUTATION PROOFS — scratch copies loaded as data: URLs; each mutant must turn a NAMED check RED…');
// ═══════════════════════════════════════════════════════════════════════════
const URL_OF = (rel) => new URL(rel, import.meta.url).href;
async function loadMutant(rel, edits, rewrites = {}) {
  let src = await readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  for (const [a, b] of edits) {
    const n = src.split(a).length - 1;
    if (n !== 1) throw new Error(`mutation anchor must match exactly once in ${rel} (matched ${n}): ${a}`);
    src = src.split(a).join(b);
  }
  src = src.replace(/from '\.\/([\w.-]+)'/g, (_m, f) => `from '${rewrites[f] || URL_OF('./js/' + f)}'`);
  return { src, mod: await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64')) };
}
async function mutantOf(label, edits, runner, mustFail, rewrites) {
  const { mod } = await loadMutant('./js/feed-cards.js', edits, rewrites);
  const res = runner(mod);
  const failed = Object.entries(res).filter(([, ok]) => ok !== true).map(([l]) => l);
  const hit = mustFail.every(m => failed.some(f => f.startsWith(m)));
  assert(failed.length > 0 && hit, `${label} → RED on: ${failed.slice(0, 5).map(f => f.slice(0, 90)).join(' | ') || '(nothing — the mutant SURVIVED)'}`);
  return failed;
}
{
  // control
  const ALL = (mod) => ({ ...blindChecks(mod), ...viewLayerChecks(mod), ...idOrderChecks(mod), ...chatChecks(mod), ...copyChecks(mod), ...almaChecks(mod), ...freezeChecks(mod), ...weekAndActiveChecks(mod), ...streakParityChecks(mod) });
  const ctl = ALL(fc);
  assert(Object.values(ctl).every(Boolean), `11-0: POSITIVE CONTROL — the unmutated module passes all ${Object.keys(ctl).length} named checks, so a red below is the mutation's doing`);
  // The line that RE-APPLIES the S-C2 view inside deriveCards (security C1) — one anchor, used by every layer mutant below.
  const L2_LINE = "const rv = buildRevealedView({ weeks: s.revealedWeeks.filter(hasWeekN), games: s.revealedGames, picks: s.revealedPicks, weeklyResults: s.revealedWeeklyResults, confirmedStatusFor: s.confirmedStatusFor, includeDemo: true });";
  const L2_OFF = 'const rv = { revealedWeeks: s.revealedWeeks, revealedGames: s.revealedGames, revealedPicks: s.revealedPicks, revealedWeeklyResults: s.revealedWeeklyResults };';
  const M3_EDIT = ["return arePicksPublic(week) && confirmedWeekStatus === 'final';", 'return arePicksPublic(week);'];

  // M1 the gate answers true for everything
  await mutantOf('11-1: M1 isRevealed() answers TRUE for every card', [['void viewerId; void now;', 'return true; void viewerId; void now;']], ALL, ['B1 RG-45', 'A-open no week-2 team name']);
  // M2 after-reveal ignores THIS game's status
  await mutantOf('11-2: M2 after-reveal ignores the game\'s own status (a live game renders)', [["if (!game || game.status !== 'final') return false;", 'if (!game) return false;']], blindChecks, ['B2 a still-LIVE game']);
  // M3 after-final ignores the server-confirmed status
  // The after-final gate is now guarded by TWO independent layers that ask the same question — isRevealed() per candidate AND the re-applied S-C2 view
  // (C1) — so, like 11-10g, each alone HOLDS on the RG-253 fixture (B3: the caller's view built from the mirror, the gate from the server) and only both
  // together let the mirror's "final" through.
  const b3 = (m) => Object.fromEntries(Object.entries(blindChecks(m)).filter(([l]) => l.startsWith('B3')));
  {
    const onlyM3 = (await loadMutant('./js/feed-cards.js', [M3_EDIT])).mod;
    assert(Object.values(b3(onlyM3)).every(Boolean) && Object.keys(b3(onlyM3)).length === 3, '11-3a: M3 alone (isRevealed after-final trusts the mirror) HOLDS — the re-applied view still refuses the week (layer 2 catches it)');
    const onlyL2 = (await loadMutant('./js/feed-cards.js', [[L2_LINE, L2_OFF]])).mod;
    assert(Object.values(b3(onlyL2)).every(Boolean) && Object.keys(b3(onlyL2)).length === 3, '11-3b: the view re-application REMOVED alone HOLDS — isRevealed(after-final) still refuses it (layer 3 catches it)');
  }
  await mutantOf('11-3c: M3 + view re-application removed TOGETHER → the mirror\'s "final" gets through (RG-253)', [M3_EDIT, [L2_LINE, L2_OFF]], blindChecks, ['B3 RG-253']);
  // M4 after-reveal does not ask arePicksPublic
  await mutantOf('11-4: M4 after-reveal drops the arePicksPublic() question (RG-45: final game, OPEN week)', [['    if (!revealed) return false;\n', '']], blindChecks, ['B1 RG-45', 'B1b']);
  // M5 S-C10 flag ignored
  await mutantOf('11-5: M5 picksReadConfirmed ignored (RG-255: public on this device before the others\' rows landed)', [['return s.picksReadConfirmed[week.weekId] === true;', 'return true;']], blindChecks, ['PC1 S-C10', 'PC5', 'PC6']);
  // M6 demo filter gone
  await mutantOf('11-6: M6 demo weeks are no longer excluded (UN-71)', [["const keepWeek = (w) => hasWeekN(w) && (viewerIsCommissioner || w.dataSourceMode !== 'demo');", 'const keepWeek = (w) => hasWeekN(w);']], blindChecks, ['G1 UN-71']);
  // M7 the S-C2 view admits every week
  const m7 = await mutantOf('11-7: M7 S-C2 — buildRevealedView admits EVERY week (the filter disabled): the hidden LIVE week 2 flows into week 3\'s aggregates', [["return arePicksPublic(w) && confirmed(w) === 'final';", 'return true;']], (m) => ({ ...blindChecks(m), ...viewLayerChecks(m) }), ['D1 S-C2', 'V1 C1', 'V4']);
  // M8 slicing gone
  const m8 = await mutantOf('11-8: M8 through-week slicing removed — later weeks move earlier weeks\' streaks and ranks',
    [['memberSeasonStats(memberId, { ...view, season: W.season, asOfWeekId: W.weekId })', 'memberSeasonStats(memberId, { ...view, season: W.season })'], ['const weeks = i < 0 ? [] : same.slice(0, i + 1);', 'const weeks = same;']], blindChecks, ['E1 slicing', 'E2']);
  // M9 id built BEFORE the gate (S-C5)
  await mutantOf('11-9: M9 S-C5 — an id is built for a called.it candidate BEFORE its gate runs',
    [["if (gate('called.it', W, g)) {", "if ((_internals.buildCardId({ type: 'called.it', leagueId: s.leagueId, weekId: W.weekId }), gate('called.it', W, g))) {"]], idOrderChecks, ['S5-1', 'S5-3']);
  // M10 chat exclusions, one at a time
  await mutantOf('11-10a: M10a private rows are no longer excluded', [['if (c.private === true || c.visibleTo || c.visible_to) return null;', '']], chatChecks, ['T2']);
  await mutantOf('11-10b: M10b wager receipts are no longer excluded (SD-6)', [['if (isWagerReceipt(c)) return null;', '']], chatChecks, ['T3']);
  await mutantOf('11-10c: M10c deleted messages are no longer excluded', [['if (c.deleted) return null;', '']], chatChecks, ['T4']);
  await mutantOf('11-10d: M10d a row from another league is no longer dropped (S-C11)', [["if (c.leagueId !== undefined && c.leagueId !== null && c.leagueId !== leagueId) return null;", '']], chatChecks, ['T5']);
  await mutantOf('11-10e: M10e a human row in the scribe list / a SCRIBE row winning the Locker Room', [["if (!c || c.author !== 'scribe') continue;", 'if (!c) continue;'], ["c.author !== 'scribe' && c.author !== 'system' && c.reactionCount > 0", 'c.reactionCount > 0']], chatChecks, ['T6']);
  // T9 (no raw message field reaches a card) is guarded TWICE — the candidate is rebuilt minimal, AND facts are filtered by the allow-list — so killing it takes both mutations together.
  await mutantOf('11-10f: M10f the raw message passes through the candidate AND the allow-list stops filtering (feedback / meta reach a card)',
    [['return { id, ts: toMs(c.ts),', 'return { ...c, id, ts: toMs(c.ts),'],
      ['facts: { messageId: c.id, body: c.body, timestamp: isoAt(c.ts) }', 'facts: { messageId: c.id, body: c.body, timestamp: isoAt(c.ts), meta: c.meta, feedback: c.feedback }'],
      ['for (const k of allowed) {', 'for (const k of Object.keys(facts || {})) {']], chatChecks, ['T9 S-C8']);
  {
    const onlyOne = await loadMutant('./js/feed-cards.js', [['for (const k of allowed) {', 'for (const k of Object.keys(facts || {})) {']]);
    assert(chatChecks(onlyOne.mod)['T9 S-C8: no raw message field survives into a card — no feedback, no meta (only allow-listed facts)'] === true, '11-10g: …and either layer alone HOLDS (allow-list unfiltered but candidate minimal → still green): the two guards are independent, as designed');
  }
  // M11 the deep facts scan reduced to top level
  await mutantOf('11-11: M11 forbidden keys are only checked at the TOP level of facts', [['  assertDeepBlindSafe(facts);\n', '  assertMetaIsBlindSafe(facts);\n']], (m) => ({ 'N1 a nested forbidden key throws': (() => { try { m.finalizeFacts('game.final', { chips: [{ playerId: 'p1', result: 'win', selectedTeam: 'Duke' }] }); return false; } catch { return true; } })() }), ['N1 a nested']);
  // M12 the escaper becomes optional
  await mutantOf('11-12: M12 S-C6 — requireEscHtml degrades to String() instead of throwing', [['    throw new TypeError(`${fnName}() requires an injected escHtml function (CONVENTIONS #12, S-C6)`);', '    return String;']], copyChecks, ['CP1', 'CP2']);
  // M13 a forbidden key sneaks into an allow-list — the MODULE LOAD must throw
  {
    let threw = null;
    try { await loadMutant('./js/feed-cards.js', [["'called.it':        ['playerId', 'playerName', 'team', 'matchup', 'spreadDisplay', 'scoreLine'],", "'called.it':        ['playerId', 'playerName', 'team', 'matchup', 'spreadDisplay', 'scoreLine', 'margin'],"]]); }
    catch (e) { threw = e; }
    assert(!!threw && /allow-lists forbidden key margin/.test(threw.message), `11-13: M13 adding \`margin\` to called.it's allow-list makes the MODULE LOAD throw — "${threw && threw.message}"`);
  }
  // M14 the static scans have teeth
  {
    const real = await read('./js/feed-cards.js');
    const inj = (line) => scanSource(line + '\n' + real);
    assert(inj("import { canViewOtherPicks } from './app.js';").includes('canViewOtherPicks') && inj("import { canViewOtherPicks } from './app.js';").some(x => x === 'imports ./app.js'), '11-14a: M14a an injected `import { canViewOtherPicks } from \'./app.js\'` is caught (the name AND the app import)');
    assert(inj("import { getMessages } from './chat.js';").includes('imports ./chat.js'), '11-14b: M14b an injected chat.js import is caught (S-C8)');
    assert(inj("import { save } from './storage.js';").some(x => x.startsWith('imports a writer')), '11-14c: M14c an injected `save` import is caught (no writes)');
    assert(scanSource(real.replace('arePicksPublic } from', 'somethingElse } from')).includes('does not import arePicksPublic from ./storage.js'), '11-14d: M14d dropping the arePicksPublic import is caught');
    assert(scanSource(real + "\nel.innerHTML = '<b>' + x + '</b>';").includes('touches the DOM'), '11-14e: M14e an innerHTML write is caught');
    assert(scanSource(real + "\nconst e = typeof escHtml === 'function' ? escHtml : String;").includes('an optional-escaper fallback'), '11-14f: M14f an optional-escaper fallback is caught');
  }
  // M15 captions
  {
    const reword = (await loadMutant('./js/feed-caption-lines.js', [["Everyone else went the other way on {team}. {player} didn't, and it covered.", "Everyone else faded {team}. {player} didn't, and it covered."]], { 'feed-cards.js': URL_OF('./js/feed-cards.js') })).mod;
    const r = captionChecks(reword, fc);
    assert(r['K7 banned vocabulary (bet, wager, odds, unit(s), ROI, drink, tab, owe, the chart, faded) returns ZERO hits across every line'] === false && r['K8 the "faded" line is REWORDED: stood.alone #2 reads "Everyone else went the other way on {team}…"'] === false, '11-15a: M15a putting "faded" back turns the banned-vocabulary scan and the reword check RED');
    const bad = (await loadMutant('./js/feed-caption-lines.js', [["'{player} called it. {team} covers as the underdog and wins outright, {margin}.'", "'{player} called it. {team} covers as the underdog and wins outright, {margin} and {spread}.'"]], { 'feed-cards.js': URL_OF('./js/feed-cards.js') })).mod;
    assert(captionChecks(bad, fc)['K3 S-C12: every {placeholder} in every line is a MAPPED placeholder of its pool (mechanical regex-extract-and-diff over all 88 lines)'] === false, '11-15b: M15b a line using an UNMAPPED placeholder ({spread}) turns K3 RED');
    let threw = null;
    try { await loadMutant('./js/feed-caption-lines.js', [["called.it': { cardType: 'called.it', fields: { player: 'playerName', team: 'team', matchup: 'matchup', margin: 'scoreLine' }", "called.it': { cardType: 'called.it', fields: { player: 'playerName', team: 'team', matchup: 'matchup', margin: 'margin' }"]], { 'feed-cards.js': URL_OF('./js/feed-cards.js') }); }
    catch (e) { threw = e; }
    assert(!!threw && /reads fact margin/.test(threw.message), `11-15c: M15c mapping {margin} to a fact literally named \`margin\` makes the caption module's LOAD throw — "${threw && threw.message}"`);
    const nondet = (await loadMutant('./js/feed-caption-lines.js', [['return fill(eligible[hash32(card.id) % eligible.length], values);', 'return fill(eligible[Math.floor(Math.random() * eligible.length)], values);']], { 'feed-cards.js': URL_OF('./js/feed-cards.js') })).mod;
    assert(captionChecks(nondet, fc)['K11 the SAME card id always selects the SAME line (100 repeated calls, byte-identical) — every device agrees'] === false, '11-15d: M15d random selection turns the determinism check RED');
    const ungated = (await loadMutant('./js/feed-caption-lines.js', [["if (typeof line === 'object' && line.when && !(WHEN[line.when] && WHEN[line.when](facts))) continue;", '']], { 'feed-cards.js': URL_OF('./js/feed-cards.js') })).mod;
    assert(captionChecks(ungated, fc)['K13 picks.submitted line 5 ("The rest know who they are") is selected ONLY when submittedCount < totalPlayers'] === false, '11-15e: M15e ignoring the `when` condition lets "The rest know who they are" onto a 6/6 card — K13 RED');
  }
  // THE DI-373 NAMED MUTATION — S-C2 disabled against Fixture D. The actual (wrong) output, pasted:
  //
  //   Fixture D = week 1 FINAL, week 2 LIVE (hidden, with stale final-shaped rows still in storage), week 3 FINAL.
  //   CLEAN  week-3 streak.extended:  p1 6 covers · p2 4 covers · p4 3 misses · p5 3 covers · p6 5 misses
  //   CLEAN  week-3 rank.changed:     (none — week-1 ranks equal week-1+3 ranks once week 2 is excluded)
  //   MUTANT (S-C2 view disabled), PASTED FROM THE RUN (2026-09-30, UTC and America/Los_Angeles identical):
  //     {"week-3 streak.extended":{"p2":"5 covers","p3":"3 misses","p5":"4 covers"},"week-3 rank.changed":{}}
  //   i.e. p1's real 6-cover run VANISHES and p6's 5-miss run VANISHES (the hidden week's L L W L and W L L W
  //   are spliced into their sequences), p2's run reads 5 instead of 4, and p3 / p5 get streaks — a "3-game miss
  //   streak" for Kevin and a "4-game cover streak" for Jacob that exist ONLY because of week 2's hidden result.
  //   That is the failure mode this guard exists to prevent. (The assertions below also print both sides live,
  //   so this comment cannot silently go stale: if the numbers drift, the label shows the new truth.)
  //
  // 2026-10-01 REWORK (security C1): the view is now applied TWICE — by the caller (buildRevealedView) and again INSIDE deriveCards — so the named
  // mutation must disable BOTH layers, and each layer alone must HOLD (the 11-10g pattern): 11-16a / 11-16b / 11-16c below, on the security probe's
  // fixture (an OPEN week 2 holding TWO final games, then FINAL week 3, the UNFILTERED view handed in) and on Fixture D. PASTED FROM THE RUN, both
  // layers disabled, the probe's fixture (UTC and America/Los_Angeles identical):
  //   CLEAN   {"week-3 streak.extended":{"p1":"6 covers","p2":"4 covers","p4":"3 misses","p5":"3 covers","p6":"5 misses"},"week-3 rank.changed":{},
  //            "week-3 player.week streaks":{"p1":"6 covers","p2":"4 covers","p4":"3 misses","p5":"3 covers","p6":"5 misses"}}
  //   MUTANT  {"week-3 streak.extended":{"p3":"4 misses","p4":"3 misses","p5":"5 covers","p6":"3 misses"},"week-3 rank.changed":{},
  //            "week-3 player.week streaks":{"p3":"4 misses","p4":"3 misses","p5":"5 covers","p6":"3 misses"}}
  //   — p3 (Kevin) gets a "4-game miss streak" in week 3 that is made of his week-2 sides (L L L L), and p1 / p2 lose theirs: the exact leak the
  //   security probe reported.
  {
    const noL2 = (await loadMutant('./js/feed-cards.js', [[L2_LINE, L2_OFF]])).mod;           // layer 2: deriveCards stops re-applying the view
    const brief = (cs) => ({
      'week-3 streak.extended': Object.fromEntries(ofType(cs, 'streak.extended', 'w3').map(c => [c.memberId, `${c.facts.run} ${c.facts.kind}`])),
      'week-3 rank.changed': Object.fromEntries(ofType(cs, 'rank.changed', 'w3').map(c => [c.memberId, `${c.facts.fromRank}->${c.facts.toRank}`])),
      'week-3 player.week streaks': Object.fromEntries(ofType(cs, 'player.week', 'w3').filter(c => c.facts.streakRun).map(c => [c.memberId, `${c.facts.streakRun} ${c.facts.streakKind}`])),
    });
    const same = (a, b) => JSON.stringify(brief(a)) === JSON.stringify(brief(b));
    const viewOnly = (m) => viewLayerChecks(m);
    for (const [name, L] of [['the security probe\'s fixture (OPEN week 2 holding TWO final games, then FINAL week 3)', league('open', { w2Finals: ['g21', 'g22'], w3: true })], ['Fixture D (LIVE week 2 with stale final-shaped rows, then FINAL week 3)', league('live', { staleW2Rows: true, w3: true })]]) {
      const clean = derive(fc, snapshotWith(fc, L));
      // (a) layer 1 (the caller's view) disabled ALONE — an unfiltered view handed to the REAL deriveCards: layer 2 holds
      assert(same(derive(fc, snapshotWith(fc, L, { bypassView: true })), clean), `11-16a: ${name}: the caller's view layer DISABLED alone (unfiltered view in) HOLDS — deriveCards' own re-application cuts it back`);
      // (b) layer 2 disabled ALONE — a correct view into the mutant: layer 1 holds
      assert(same(derive(noL2, snapshotWith(noL2, L)), clean), `11-16b: ${name}: deriveCards' re-application DISABLED alone (correct view in) HOLDS — the caller's view layer carries it`);
      // (c) BOTH disabled — the DI-373 named mutation: the unfiltered view into the mutant
      const wrong = derive(noL2, snapshotWith(noL2, L, { bypassView: true }));
      assert(!same(wrong, clean), `11-16c: ${name}: BOTH layers disabled (the DI-373 NAMED MUTATION) → the output MOVES. CLEAN ${JSON.stringify(brief(clean))}  vs  MUTANT ${JSON.stringify(brief(wrong))}`);
    }
    assert(Object.values(viewOnly(fc)).every(Boolean) && !Object.values(viewOnly(noL2)).every(Boolean) && Object.entries(viewOnly(noL2)).filter(([, ok]) => !ok).some(([l]) => l.startsWith('V1 C1')),
      '11-16d: the named V-checks are GREEN on the real module and RED (V1 C1 …) with the re-application removed — under the unfiltered view the suite catches the leak');
    // The layering, stated plainly: each guard is the SOLE guard for one fixture — the caller's/shared view (buildRevealedView) for D1 and V1, the through-week slice for E1.
    assert(m7.some(f => f.startsWith('D1')) && m7.some(f => f.startsWith('V1 C1')) && m8.some(f => f.startsWith('E1')), '11-17: buildRevealedView (shared by both layers) is the sole guard for D1/V1, the through-week slice for E1 — neither is redundant');
  }

  // ── the 2026-10-01 follow-up mutants ──
  // security N1 — a frozen export becomes editable
  await mutantOf('11-18: M18 CARD_ALLOWED_FACTS is only shallow-frozen again (an inner list is editable)', [['export const CARD_ALLOWED_FACTS = deepFreeze({', 'export const CARD_ALLOWED_FACTS = Object.freeze({']], freezeChecks, ['FZ1', 'FZ2']);
  // security N2 — the per-item chip / alma allow-list gone
  await mutantOf('11-19: M19 the per-item (chips / almaMaterResult) allow-list is removed', [['    if (Array.isArray(out[k])) out[k] = out[k].map(clean).filter(Boolean);\n    else { const c = clean(out[k]); if (c) out[k] = c; else delete out[k]; }', '']], freezeChecks, ['N2a', 'N2b', 'N2c']);
  // C3 — the spoofable label first
  await mutantOf('11-20: M20 C3 reverted — the row\'s own authorName beats the roster name', [['authorName: nameOf(top.author) || top.authorName || \'Someone\'', 'authorName: top.authorName || nameOf(top.author) || \'Someone\'']], chatChecks, ['T10 C3']);
  // private-row signatures behind a mis-stamped author
  await mutantOf('11-21: M21 the id/meta private-row signature is removed (only the author filter is left)', [['  if (looksLikePrivateRow(c)) return null;\n', '']], chatChecks, ['T2c']);
  await mutantOf('11-22: M22 a bare `sys_` prefix is treated as private (the PUBLIC what\'s-new post is dropped)', [['  if (looksLikePrivateRow(c)) return null;\n', "  if (looksLikePrivateRow(c) || /^sys_/.test(String(c.id ?? c.messageId ?? ''))) return null;\n"]], chatChecks, ['T1 scribe.post', 'T1c']);
  // reviewer note 5 — weekNumber
  await mutantOf('11-23: M23 a week with no weekNumber is no longer dropped', [['const keepWeek = (w) => hasWeekN(w) && (viewerIsCommissioner', 'const keepWeek = (w) => !!w && (viewerIsCommissioner']], weekAndActiveChecks, ['WN1']);
  await mutantOf('11-24: M24 cardCopy renders "Week \'s slate is up" when weekN is missing', [["if (card && WEEK_N_TYPES.includes(card.type) && numStr(f.weekN) === '') return { title, body, chips };", '']], weekAndActiveChecks, ['WN3']);
  await mutantOf('11-25: M25 the malformed week is allowed back INTO the revealed view', [['weeks: s.revealedWeeks.filter(hasWeekN), games:', 'weeks: s.revealedWeeks, games:']], weekAndActiveChecks, ['WN2']);
  // reviewer note 6 — Standings-aligned active filter
  await mutantOf('11-26: M26 the active filter reverts to `active !== false` (an undefined-active player is ranked)', [['const activePlayers = s.players.filter(p => p && p.active);', 'const activePlayers = s.players.filter(p => p && p.active !== false);']], weekAndActiveChecks, ['AC1 a player with active:undefined']);
  // reviewer note 4 — the feed's own streak rule drifting from SCRIBE's
  await mutantOf('11-27: M27 the feed asks about players with no graded result this week too', [['if (!ordered.results.some(r => r.weekId === W.weekId)) continue;', '']], streakParityChecks, ['SP1']);
  // reviewer note 3 — the alma fact. (Its blind-rule guard is the card's own after-final gate: the fact rides ONLY on a player.week card, which exists only
  // for a revealed-view week; the alma-result logic itself is mutation-proven in statstest [7] 7-16…7-18.) A mutant that DROPS the fact from the card:
  await mutantOf('11-28: M28 the almaMaterResult fact is no longer attached to the player.week card', [['            ...(alma ? { almaMaterResult: alma } : {}),\n', '']], almaChecks, ['AL1', 'AL2', 'AL3']);
  assert(Object.keys(almaChecks(fc)).length >= 9, '11-29: the alma checks ran (≥ 9 named checks)');
  // SB-22 (2026-10-01) — year.ago's denominator. The control first: the unmutated module passes both check sets.
  const YA_RECORD = 'const record = Number.isInteger(size) && size > 0 && size >= max ? `${max}/${size}` : `${max} correct`;';
  const YA_FIX = { 'history-2025.js': YA_FIXTURE_URL };
  assert(Object.values(yearAgoChecks(fc)).every(Boolean) && Object.values(yearAgoFixtureChecks(await feedCardsWithHistory(YA_FIXTURE_URL))).every(Boolean),
    '11-30: POSITIVE CONTROL — the unmutated module passes every yearAgoChecks / yearAgoFixtureChecks check');
  await mutantOf('11-31: M31 the denominator is hard-coded to 10 again (the pre-SB-22 record)', [[YA_RECORD, 'const record = `${max}/10`;']], yearAgoChecks, ['YA1', 'YA2', 'YA4']);
  await mutantOf('11-32: M32 …the same mutant against a dataset whose slates are 8 and 12 games', [[YA_RECORD, 'const record = `${max}/10`;']], yearAgoFixtureChecks, ['YF1', 'YF2', 'YF3'], YA_FIX);
  await mutantOf('11-33: M33 every week\'s size is assumed to be 10 (the old SLATE_SIZE_2025 constant, guards kept)', [['const size = SLATE_SIZE_BY_WEEK_2025[Number(weekNumber)];', 'const size = 10;']], yearAgoFixtureChecks, ['YF1', 'YF2', 'YF3'], YA_FIX);
  await mutantOf('11-34: M34 conflicting stated sizes are no longer treated as unknown (the last one wins)', [['out[wk] = (wk in out && out[wk] !== size) ? null : size;', 'out[wk] = size;']], yearAgoFixtureChecks, ['YF5'], YA_FIX);
  await mutantOf('11-35: M35 a stated size below the week\'s top score is believed', [['size > 0 && size >= max ?', 'size > 0 ?']], yearAgoFixtureChecks, ['YF4'], YA_FIX);
}

console.log('\n══════════════════════════════════════════════════');
console.log(fail === 0 ? `✅ ALL PASS — ${pass} passed, ${fail} failed` : `❌ FAILURES — ${pass} passed, ${fail} failed`);
// Flush before exiting (the loadtest.mjs parent parses stdout+stderr): process.exit() does not drain a pipe.
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
