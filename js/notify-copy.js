/**
 * js/notify-copy.js — SCRIBE-voiced fact-substitution copy for the
 * Groups A/B notification workstream (UN-139…UN-148).
 *
 * WHY A NEW MODULE, NOT js/scribeLines.js:
 * This batch is built in parallel with a second builder who owns
 * js/chat.js / js/chat-ui.js / js/scribeLines.js (Groups E/F). Design Inputs
 * §6 says the copy pool "extends SCRIBE_POOLS, js/scribeLines.js" — but per
 * this build's file-ownership split, that file is off-limits here. This
 * module reimplements the SAME mechanism (template pool → fact substitution →
 * deterministic fallback) as its own small, independently reviewable file, so
 * neither builder edits the other's file (CLAUDE.md: "never run two
 * code-editing agents in parallel on the same file"). A future pass can fold
 * this into scribeLines.js's pool registry if Drew wants one physical home —
 * flagged, not done here.
 *
 * CONTRACT (Design Inputs §6, adopted verbatim):
 *   - SCRIBE never decides event truth, recipients, or timing — those are the
 *     policy layer's job (js/notifications.js). A notification's `meta`
 *     object is the ONLY input this module may read.
 *   - No free generation. Every line is a fixed template with {placeholder}
 *     tokens; a template referencing a fact key ABSENT from the supplied meta
 *     is never used — filtered out before selection, not guessed.
 *   - If no template in a pool survives that filter (or the pool is empty),
 *     a plain, non-SCRIBE, deterministic fallback string ships instead. A
 *     notification must NEVER fail to deliver because copy generation failed.
 *
 * BLIND-RULE STRUCTURAL GUARD (Design Inputs §2, §8 negative case):
 * No notification body may ever contain a team selection, spread/margin,
 * tiebreaker guess, or Extra-Point wager amount. Enforced here at the fact
 * layer, deny-by-default: FORBIDDEN_META_KEYS lists every fact shape that
 * would leak one of those, and a module-load-time scan asserts no event's
 * allowed-key list contains one — the same "structural scan over source,
 * fails the day a violation is written" pattern as AD-32 / the spread-sign
 * deny-by-default scan (see DEVELOPMENT_LEDGER.md AD-32). assertMetaIsBlindSafe()
 * is the runtime twin, called by notifications.js before any meta is used to
 * build a notification, for EVERY event — not just the ones with a pool here.
 *
 * THE ONE PERMITTED EXCEPTION (Drew's ruling, 2026-09-10, scoped to
 * PICKS_LOCKING_SOON only): a body MAY name which players have not yet
 * submitted picks — identity of non-submission, never content of what they
 * picked. `namedNonSubmitters` (an array of display NAMES) is therefore an
 * allowed fact; it is not, and can never become, a forbidden key.
 */

// ── Deny-by-default: facts that would leak the blind rule, ever ───────────────
export const FORBIDDEN_META_KEYS = Object.freeze([
  'teamPick', 'selectedTeam', 'pickSelections', 'spread', 'lockedSpread',
  'margin', 'favorite', 'tiebreakerGuess', 'tiebreakerValue', 'actualTiebreakerValue',
  'extraPointWager', 'extraPointValue', 'extraPointGuess',
]);

// ── Per-event allowed fact keys (§6's "no fact may appear that isn't supplied,
//    and no forbidden fact may EVER be offered" contract) ────────────────────
export const ALLOWED_META_KEYS = Object.freeze({
  PICKS_OPENED:                ['weekN'],
  PICKS_REMINDER:              ['weekN', 'remainingPicks', 'timeUntilLock'],
  // PICKS_LOCKING_SOON carries the one named-laggard exception (namedNonSubmitters).
  PICKS_LOCKING_SOON:          ['weekN', 'timeUntilLock', 'namedNonSubmitters', 'submittedCount', 'totalPlayers'],
  // F7 remediation (2026-09-10) — the refreshed ALL_IN pool's 2nd line uses
  // {totalPlayers} twice ("{totalPlayers}/{totalPlayers} in...") — widened
  // from ['weekN'] to admit it.
  // 2026-09-10 (Drew's option 2 — NOTIFY_NAME_NON_SUBMITTERS) — the count-only
  // twin of PICKS_LOCKING_SOON. `namedNonSubmitters` is deliberately ABSENT
  // from this allow-list: buildCopy() drops every fact outside the event's own
  // list before substitution, so even a caller that wrongly passes names in
  // count-only mode cannot get one into the body. That makes the no-names
  // guarantee structural here, not merely a convention the caller must keep.
  PICKS_LOCKING_SOON_COUNT_ONLY: ['weekN', 'timeUntilLock', 'submittedCount', 'totalPlayers'],
  PICKS_LOCKING_SOON_ALL_IN:   ['weekN', 'totalPlayers'],
  PICKS_LOCKED:                ['weekN', 'submittedCount', 'totalPlayers'],
  RESULTS_FINALIZED:           ['weekN', 'weekWinnerName', 'weekLoserName'],
  RESULTS_FINALIZED_YOU_WON:   ['weekN'],
  OBLIGATION_CREATED:          ['weekN'],
  // F7 remediation — the refreshed pool has a {weekN} line; widened from []
  // (notifyObligationSettled() now supplies weekN when ob.weekId is set,
  // exactly like notifyObligationCreated() already did).
  OBLIGATION_SETTLED:          ['weekN'],
});

// Module-load-time deny-by-default structural scan — fails the day a future
// edit adds a forbidden key to any event's allow-list, not on the next season
// someone notices in the field.
(function assertNoEventAllowsForbiddenKeys() {
  for (const [event, keys] of Object.entries(ALLOWED_META_KEYS)) {
    for (const k of keys) {
      if (FORBIDDEN_META_KEYS.includes(k)) {
        throw new Error(`[notify-copy] BLIND-RULE VIOLATION at module load: event "${event}" allows forbidden meta key "${k}"`);
      }
    }
  }
})();

/** Runtime twin of the structural scan above — call before building ANY
 *  notification (every event, not just the ones with a SCRIBE pool here;
 *  CHAT_MESSAGE_CREATED and COMMISSIONER_ANNOUNCEMENT bodies are built
 *  elsewhere but must pass the identical guard). Throws, never silently
 *  strips — a caller passing a forbidden fact is a bug to fix, not paper over. */
export function assertMetaIsBlindSafe(meta) {
  if (!meta || typeof meta !== 'object') return;
  for (const k of Object.keys(meta)) {
    if (FORBIDDEN_META_KEYS.includes(k)) {
      throw new Error(`[notify-copy] BLIND-RULE VIOLATION: meta contains forbidden key "${k}"`);
    }
  }
}

// ── SCRIBE-voiced template pools ──────────────────────────────────────────────
// F7 remediation (2026-09-10) — REPLACES the earlier "SCRIBE NOTE:.../Filed."
// draft register with the approved copy from
// `weekly bug fixes and feedback/Chat SCRIBE updates 090526/SCRIBE_VOICE_REFRESH_091026.md`
// §2 (Drew's 2026-09-10 ruling: the clinical mock-legal/mock-clinical
// register — "SCRIBE NOTE:", "Filed.", "the chart" — reads as cringey and
// "does not sound fun, natural, or like witty banter"). Every line below is
// copied verbatim from that document. PICKS_REMINDER and PICKS_LOCKING_SOON
// (+ its ALL_IN pool) are also PORTED into backend/Code.gs (F7's other half —
// those two events fire server-side) — content and order must stay
// byte-identical between the two; notifytest.mjs's drift test (F5) diffs
// them via this module's `_poolsForTest()` export.
const POOLS = {
  PICKS_OPENED: [
    "We're so back, baby. Week {weekN} picks are open.",
    'Week {weekN} is open. Novel idea this week — try picking correctly.',
    "Week {weekN} picks are live. Let's see if that changes anything.",
    'New week, same six idiots. Week {weekN} is open.',
    "Week {weekN}'s slate is up. Go lose money to your friends.",
    "Picks are open for Week {weekN}. Good luck. You'll need it.",
    'Week {weekN} is live.',
    'Week {weekN} is open. Try not to overthink it into a loss.',
  ],
  PICKS_REMINDER: [
    '{remainingPicks} picks outstanding for Week {weekN}. The deadline is approaching fast, boys.',
    '{remainingPicks} entries still pending. Lock in {timeUntilLock}.',
    "{remainingPicks} left. Lock in {timeUntilLock}. Don't be that guy.",
    "Still {remainingPicks} picks sitting there. Clock's at {timeUntilLock}.",
    '{remainingPicks} to go for Week {weekN}. Tick tock.',
    '{remainingPicks} picks unfinished. You know what to do.',
    "{timeUntilLock} left and you've still got {remainingPicks} picks open.",
  ],
  // Two disjoint fact shapes for the same event — laggards present vs. the
  // all-submitted fallback (§6). Kept as separate pools, selected by the
  // caller (js/notifications.js), never mixed in one substitution pass —
  // a template needing `namedNonSubmitters` must never be chosen when the
  // fact simply isn't true this scan.
  PICKS_LOCKING_SOON: [
    '{timeUntilLock} to lock. On the record as huge slackers: {namedNonSubmitters}.',
    'Week {weekN} locks in {timeUntilLock}. Still waiting on {namedNonSubmitters}.',
    "{timeUntilLock} left. {namedNonSubmitters}, the week isn't going to pick itself.",
    "Clock's at {timeUntilLock}. {namedNonSubmitters} are cutting it close.",
    "{submittedCount}/{totalPlayers} in with {timeUntilLock} to go. {namedNonSubmitters}, let's go.",
    '{namedNonSubmitters} — {timeUntilLock} before Week {weekN} locks. Move.',
  ],
  // Count-only pool (NOTIFY_NAME_NON_SUBMITTERS='false'). Every line uses ONLY
  // {submittedCount}/{totalPlayers} and {timeUntilLock} — no template here can
  // name anyone. Same register as the named pool above
  // (SCRIBE_VOICE_REFRESH_091026.md §2: dry, short, specific). ALSO PORTED into
  // backend/Code.gs (SCRIBE_PICKS_LOCKING_SOON_COUNT_ONLY_POOL) — content and
  // order must stay byte-identical; notifytest.mjs's drift test diffs them.
  PICKS_LOCKING_SOON_COUNT_ONLY: [
    '{submittedCount}/{totalPlayers} in. {timeUntilLock} to lock.',
    "{timeUntilLock} to lock and we're at {submittedCount}/{totalPlayers}. You know who you are.",
    "{timeUntilLock} left. {submittedCount}/{totalPlayers} in. Don't be the holdout.",
  ],
  PICKS_LOCKING_SOON_ALL_IN: [
    'All picks in. Week {weekN} is set. LFG.',
    '{totalPlayers}/{totalPlayers} in. Week {weekN} is locked and loaded.',
  ],
  PICKS_LOCKED: [
    'Week {weekN} is locked. {submittedCount}/{totalPlayers} picks in. Good luck, boys.',
    'Locked. {submittedCount}/{totalPlayers} for Week {weekN}. No do-overs now.',
    "That's a wrap on picks. Week {weekN}: {submittedCount}/{totalPlayers}.",
    "Week {weekN} is locked. Hope you didn't overthink it.",
    '{submittedCount}/{totalPlayers} in for Week {weekN}. Too late to change your mind now.',
    "Picks are locked for Week {weekN}. Time to find out who's an idiot.",
    "Week {weekN} locked at {submittedCount}/{totalPlayers}. Kickoff can't come soon enough.",
  ],
  RESULTS_FINALIZED: [
    "Week {weekN} is final. {weekWinnerName} took it. It's about time.",
    'Results are in for Week {weekN}. {weekLoserName} is on the hook. RIP.',
    'Week {weekN} in the books. {weekWinnerName} wins, {weekLoserName} pays.',
    "{weekWinnerName} takes Week {weekN}. {weekLoserName}, that's rough.",
    'Final for Week {weekN}: {weekWinnerName} on top, {weekLoserName} on the hook.',
    "Week {weekN} is over. {weekWinnerName} won. {weekLoserName} didn't.",
    "That's Week {weekN}. {weekWinnerName} takes it, {weekLoserName} takes the loss.",
  ],
  // Personalized "you won" variant — recipientWon is a plain boolean fact the
  // caller computes FROM calculateWeeklyResults()'s own return value
  // (SCRIBE.md §9.1 boundary — never independently re-derived here).
  RESULTS_FINALIZED_YOU_WON: [
    'Week {weekN} final — you took it. Your mother would be proud.',
    "You won Week {weekN}. Don't let it go to your head.",
    "Week {weekN} is yours. Enjoy it, it won't last.",
  ],
  OBLIGATION_CREATED: [
    'New balance on the ledger for Week {weekN}. Pay up.',
    "You're on the hook for Week {weekN}. Pay up.",
    'Added to the tab: Week {weekN}. You know what to do.',
    'Week {weekN} obligation is in. Settle up.',
    'New IOU logged for Week {weekN}.',
    'Week {weekN}: you owe. Pay up.',
    'The tab just grew. Week {weekN}. Handle it.',
  ],
  OBLIGATION_SETTLED: [
    'Balance settled. The ledger is clean.',
    'Paid up. Week {weekN} is squared away.',
    "Debt cleared for Week {weekN}. We're even.",
    'Settled. Nobody owes anybody for Week {weekN} anymore.',
    "That's paid. Week {weekN} obligation closed.",
    "Ledger's clean on Week {weekN}. For now.",
    'Paid in full. Week {weekN} is done.',
  ],
};

// Deterministic, flat, non-SCRIBE, product-voiced fallback per event — never
// blank, never an error placeholder. Text matches SCRIBE_VOICE_REFRESH_091026.md
// §2's stated "Deterministic fallback:" line for each event exactly.
// Deliberately does not use `namedNonSubmitters` even for PICKS_LOCKING_SOON:
// the fallback path exists for when facts are missing or SCRIBE copy fails,
// so it only ever promises what a minimal fact set (weekN, counts) can support.
const FALLBACK = {
  PICKS_OPENED:               (m) => m.weekN != null ? `Week ${m.weekN} is open.` : 'Picks are open.',
  PICKS_REMINDER:             (m) => m.remainingPicks != null ? `You have ${m.remainingPicks} picks left${m.weekN != null ? ` for Week ${m.weekN}` : ''}.` : 'You have picks outstanding.',
  PICKS_LOCKING_SOON:         (m) => m.weekN != null ? `Week ${m.weekN} locks in ${m.timeUntilLock || 'soon'}.` : 'Picks are locking soon.',
  // Shared, already name-free flat fallback — identical text to the named
  // pool's, so the fallback path is safe in count-only mode too.
  PICKS_LOCKING_SOON_COUNT_ONLY: (m) => m.weekN != null ? `Week ${m.weekN} locks in ${m.timeUntilLock || 'soon'}.` : 'Picks are locking soon.',
  PICKS_LOCKING_SOON_ALL_IN:  (m) => m.weekN != null ? `Week ${m.weekN} is set.` : 'This week is set.',
  PICKS_LOCKED:                (m) => m.weekN != null ? `Week ${m.weekN} picks are locked.` : 'Picks are locked.',
  RESULTS_FINALIZED:           (m) => m.weekN != null ? `Week ${m.weekN} results are final.` : 'The week is final.',
  RESULTS_FINALIZED_YOU_WON:   (m) => m.weekN != null ? `Week ${m.weekN} final — you won.` : 'You won this week.',
  OBLIGATION_CREATED:          (m) => m.weekN != null ? `A new obligation was created for Week ${m.weekN}.` : 'A new obligation was created.',
  OBLIGATION_SETTLED:          (m) => m.weekN != null ? `The Week ${m.weekN} obligation was settled.` : 'A balance was settled.',
};

// Plain-language, non-SCRIBE title per event — Notification Center row format
// is "{icon} {title}" (DI-A3); the title is never itself SCRIBE-voiced, only
// the body optionally is.
const TITLES = {
  PICKS_OPENED:               'Picks are open',
  PICKS_REMINDER:             'Picks reminder',
  PICKS_LOCKING_SOON:         'Locking soon',
  PICKS_LOCKING_SOON_COUNT_ONLY: 'Locking soon',
  PICKS_LOCKING_SOON_ALL_IN:  'Locking soon',
  PICKS_LOCKED:                'Picks locked',
  RESULTS_FINALIZED:           'Week final',
  RESULTS_FINALIZED_YOU_WON:   'Week final',
  OBLIGATION_CREATED:          'New balance',
  OBLIGATION_SETTLED:          'Balance settled',
};

/**
 * BLOCKING #2 remediation (2026-09-10) — a fact is "present" only if it is
 * neither `undefined`, `null`, nor `''`. Before this, buildCopy's own
 * presence test was `meta[k] !== undefined`, so a caller that (wrongly)
 * coerced an absent fact to `null` (js/notifications.js's
 * notifyResultsFinalized used `weekWinnerName || null`) sailed through as
 * "present," a template needing `{weekWinnerName}` was judged usable, and
 * substitute() rendered the literal string "null" into a live notification
 * body ("null took it"). `0` is deliberately NOT treated as absent — a real
 * zero-valued fact (e.g. a hypothetical `{submittedCount}` of 0) must still
 * render as "0", not silently fall back. The caller-side fix (never coerce
 * to `null`) is REQUIRED to fix the specific manifestation, but this is the
 * structural half: no future caller's `|| null`/`|| ''` slip can reproduce
 * the same rendering bug, because the presence test itself now rejects it.
 */
function isPresentFact(v) {
  return v !== undefined && v !== null && v !== '';
}

/** Every {placeholder} token in `tpl`. */
function placeholdersOf(tpl) {
  const out = [];
  const re = /\{(\w+)\}/g;
  let m;
  while ((m = re.exec(tpl))) out.push(m[1]);
  return out;
}

/** Substitute {placeholder} tokens in `tpl` from `meta`. Caller must have
 *  already confirmed every placeholder is present (see buildCopy). */
function substitute(tpl, meta) {
  return tpl.replace(/\{(\w+)\}/g, (_, key) => String(meta[key]));
}

/** Stable, deterministic small-int hash — used to pick a pool member
 *  reproducibly per dedupKey rather than randomly, so the same notification
 *  never "flickers" between wordings across a retried dispatch, and so tests
 *  are deterministic without mocking Math.random(). */
function stableIndex(seed, mod) {
  let h = 0;
  const s = String(seed || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return mod > 0 ? h % mod : 0;
}

/**
 * Build {title, body, scribeVoiced} for one event.
 *   event      — a POOLS/FALLBACK key (see ALLOWED_META_KEYS)
 *   meta       — the fact object; MUST already have passed assertMetaIsBlindSafe()
 *   dedupKey   — used only to deterministically select among equally-valid
 *                pool members (see stableIndex) — never affects WHICH pool.
 */
export function buildCopy(event, meta = {}, dedupKey = '') {
  assertMetaIsBlindSafe(meta);
  const allowed = ALLOWED_META_KEYS[event] || [];
  // Facts outside the event's own allow-list are dropped before substitution
  // even when they're not forbidden — §6's "only keys present for THIS event"
  // contract, not just "never forbidden."
  const safeMeta = {};
  for (const k of allowed) if (isPresentFact(meta[k])) safeMeta[k] = meta[k];

  const pool = POOLS[event] || [];
  const usable = pool.filter(tpl => placeholdersOf(tpl).every(k => isPresentFact(safeMeta[k])));
  const title = TITLES[event] || 'Notification';
  if (!usable.length) {
    const fb = FALLBACK[event];
    return { title, body: fb ? fb(safeMeta) : 'Something happened.', scribeVoiced: false };
  }
  const tpl = usable[stableIndex(dedupKey, usable.length)];
  return { title, body: substitute(tpl, safeMeta), scribeVoiced: true };
}

/** Test/debug seam — every event this module knows how to voice. */
export function _knownEvents() { return Object.keys(TITLES); }

/** Test-only seam (F5, 2026-09-10 remediation) — exact pool content, for
 *  notifytest.mjs's Code.gs twin-drift check. Code.gs cannot import this ES
 *  module (GAS), so it carries a manually-ported copy of exactly the events
 *  it fires server-side (PICKS_REMINDER, PICKS_LOCKING_SOON,
 *  PICKS_LOCKING_SOON_ALL_IN) — this is what the drift test diffs Code.gs's
 *  ported arrays against, content AND order. */
export function _poolsForTest() { return { ...POOLS }; }
/** Test seam (BLOCKING #2, 2026-09-10) — the presence predicate itself, so
 *  notifytest.mjs can assert it directly (null/''/undefined all absent,
 *  0/false present) without inferring it only from buildCopy's output. */
export function _isPresentFactForTest(v) { return isPresentFact(v); }
export function _fallbackTextForTest(event, meta = {}) {
  const fb = FALLBACK[event];
  return fb ? fb(meta) : null;
}
