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
  // N1 / UN-204 (2026-09-12) — RESULTS_FINALIZED_YOU_WON IS RETIRED, not
  // replaced (coordinator ruling O3). Its three lines were second person ("you
  // took it") and a league-wide room cannot carry a second-person line: five of
  // the six people reading it did not win. The RESULTS_FINALIZED pool already
  // names the winner AND the loser, and both are public on Standings. The key
  // is removed from ALLOWED_META_KEYS, POOLS, FALLBACK and TITLES together —
  // leaving any one of them behind would let a future caller resurrect it by
  // name and post "you took it" to the whole league.
  //
  // N1 / DI-N2 + the copy rulings (2026-09-12) — the two obligation events are
  // now posted LEAGUE-WIDE, naming both parties (ruling O4: an obligation is
  // already public on the Standings/obligations surface, so naming exposes
  // nothing new). buildCopy() drops every fact outside the event's own list
  // BEFORE substitution, so an un-widened list here would silently produce the
  // flat fallback forever rather than fail loudly. None of the three new keys
  // is — or could be — in FORBIDDEN_META_KEYS: they carry identity and a
  // commissioner-typed prize description, never a selection, spread,
  // tiebreaker or Extra-Point value.
  //
  // THE MAPPING NOTE (the pools below refer to this). There is no `label` field
  // on an obligation. The caller supplies:
  //   {debtorName}      <- nameOf(ob.payerPlayerId)
  //   {creditorName}    <- nameOf(ob.recipientPlayerId)
  //   {weekN}           <- getWeek(ob.weekId)?.weekNumber  (absent on manual obligations)
  //   {obligationLabel} <- ob.note || ob.amountOrPrize || settings.weeklyPrize
  // That last expression is the one the commissioner panel already renders an
  // obligation's description from — not a fourth invented source. It may be a
  // noun ("1 drink", the manual default) or a whole SENTENCE ("Loser buys
  // winner a consolation prize", the shipped weeklyPrize default), which is
  // exactly why every template below sets it off with an em dash instead of
  // inlining it as a direct object. "Kevin owes Drew - Loser buys winner a
  // consolation prize." reads; "Kevin owes Drew Loser buys winner..." does not.
  // The obligations table already solves it the same way. Do NOT "improve" a
  // template by making {obligationLabel} grammatical: it breaks on the default.
  OBLIGATION_CREATED:          ['weekN', 'debtorName', 'creditorName', 'obligationLabel'],
  OBLIGATION_SETTLED:          ['weekN', 'debtorName', 'creditorName', 'obligationLabel'],

  // ── DI-342/DI-C2 §3.1/§3.2 (2026-09-25, UX Revamp group C) — the four
  // commissioner-operational reminder categories. Notification-Center +
  // push only (§3.5's security correction: no chat_append_system post —
  // these are administrative nudges about a week's state, not league news).
  // Plain, product-voiced copy (no POOLS entry for any of the four — see
  // the FALLBACK block below), matching CLAUDE.md's "Beyond the visual"
  // citation this DI makes: the copy names the actual gap, not a generic
  // "check your week."
  SLATE_NOT_BUILT:             ['weekN', 'n'],
  DRAFT_PAST_OPEN:             ['weekN'],
  OPEN_NO_LOCK_TIME:           ['weekN'],
  LIVE_NOT_FINALIZED:          ['weekN'],

  // ── DI-342/DI-C3 §4.5/§4.6 — the manual "SCRIBE: remind the stragglers"
  // CHAT post (the push/Notification-Center side reuses PICKS_REMINDER
  // unchanged — no new push copy). STRUCTURAL split identical to
  // PICKS_LOCKING_SOON/PICKS_LOCKING_SOON_COUNT_ONLY: `namedNonSubmitters`
  // is present on the named event and ABSENT from the count-only one's
  // allow-list, so a caller that (wrongly) passes names in count-only mode
  // still cannot get one into the body.
  //
  // POOL LANDED (scribe agent, DI-342/DI-C3 §4.5/§4.6, 2026-09-25) — see the
  // POOLS block below for the two six-line pools. buildCopy() still falls
  // through to the flat, non-SCRIBE FALLBACK when a required fact is missing
  // (e.g. no weekN), which remains the SAFE floor — see FALLBACK's comment.
  PICKS_REMINDER_MANUAL:            ['weekN', 'namedNonSubmitters', 'submittedCount', 'totalPlayers'],
  PICKS_REMINDER_MANUAL_COUNT_ONLY: ['weekN', 'submittedCount', 'totalPlayers'],
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
  // DI-342/DI-C3 §4.5/§4.6 (2026-09-25) — the commissioner's manual
  // "remind the stragglers" button. Same named/count-only split as
  // PICKS_LOCKING_SOON above, but this event has NO {timeUntilLock}: the
  // commissioner can press the button at any point while picks are open,
  // not just near lock, so no line here promises or implies a countdown.
  // Register is Dry per SCRIBE.md §4 — a notch more pointed than
  // PICKS_LOCKING_SOON because this is a deliberate commissioner action, not
  // an automatic scan, but still no exclamation points, no caps, no
  // profanity. Exactly one line leans on "the commissioner sent me" framing
  // (line 2) — that's the whole point of the button, but it's a bit, not a
  // disclaimer, so it doesn't repeat across the pool.
  PICKS_REMINDER_MANUAL: [
    'Straggler check for Week {weekN}: {namedNonSubmitters}. Nobody is forcing you. Yet.',
    'The commissioner had me pull the list. Week {weekN}, still out: {namedNonSubmitters}.',
    '{namedNonSubmitters} — Week {weekN} is not locked yet. That is the only reason this is still polite.',
    '{submittedCount}/{totalPlayers} in for Week {weekN}. {namedNonSubmitters}, that is the gap.',
    'On the clock for Week {weekN}: {namedNonSubmitters}. Picks do not submit themselves.',
    '{namedNonSubmitters}, Week {weekN} is still waiting on you.',
  ],
  // Count-only twin (NOTIFY_NAME_NON_SUBMITTERS='false'). No line here can
  // use {namedNonSubmitters} or {timeUntilLock} — only {weekN},
  // {submittedCount}, {totalPlayers}. Same dry register; the missing names
  // are acknowledged obliquely ("the rest know who they are") rather than
  // pretending nobody's missing.
  PICKS_REMINDER_MANUAL_COUNT_ONLY: [
    'Straggler check for Week {weekN}: {submittedCount}/{totalPlayers} in. The commissioner is aware of the rest.',
    '{submittedCount}/{totalPlayers} in for Week {weekN}. The gap knows who it is.',
    'Week {weekN} sits at {submittedCount}/{totalPlayers}. Still open, still fixable.',
    'The commissioner had me check. Week {weekN}: {submittedCount}/{totalPlayers} in.',
    '{submittedCount} of {totalPlayers} in for Week {weekN}. The rest know who they are.',
    'On the clock for Week {weekN}: {submittedCount}/{totalPlayers} in so far.',
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
  // N1 (UN-204 / DI-N2, DI-N6) — obligations post LEAGUE-WIDE, so these
  // pools are THIRD PERSON and name both parties. They replace the
  // second-person pools ("You're on the hook…"), which had no remaining
  // caller once the notify*() call sites moved to chat and which would be a
  // live trap if left in the file: posting one into the main room addresses
  // five people who don't owe anything.
  //
  // An obligation is a fact of the standings, not a verdict on the debtor.
  // No line taunts the person who owes, no line invents an amount, and
  // {obligationLabel} is ALWAYS set off with an em dash — it is free
  // commissioner text that may be a noun ("1 drink") or a whole sentence
  // ("Loser buys winner a consolation prize"). See the mapping note.
  //
  // Slot coverage is deliberate: buildCopy() drops any template whose
  // placeholders aren't all present, so each pool descends from all-four-slots
  // to a {debtorName}+{creditorName}-only floor line that can always render.
  // Without that floor, a manual obligation (no weekId) with no note would
  // fall through to the flat non-SCRIBE fallback every time.
  OBLIGATION_CREATED: [
    'New on the ledger for Week {weekN}: {debtorName} owes {creditorName} — {obligationLabel}.',
    'Week {weekN} ledger: {debtorName} owes {creditorName}. The tab is open.',
    '{debtorName} owes {creditorName} — {obligationLabel}. On the books now.',
    'One for the ledger: {debtorName} owes {creditorName}.',
  ],
  OBLIGATION_SETTLED: [
    'Week {weekN} is clean: {debtorName} settled with {creditorName} — {obligationLabel}.',
    '{debtorName} and {creditorName} are square for Week {weekN}.',
    '{debtorName} settled with {creditorName} — {obligationLabel}. Off the ledger.',
    '{debtorName} settled with {creditorName}. The ledger is clean again.',
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
  // N1 — both sides are named here too. DI-N6 specified "<Name> owes for Week
  // <N>."; a league-wide room needs to know who is OWED, or the flat fallback
  // says less than the table two taps away already does.
  OBLIGATION_CREATED: (m) => m.debtorName && m.creditorName
    ? `${m.debtorName} owes ${m.creditorName}${m.weekN != null ? ` for Week ${m.weekN}` : ''}.`
    : (m.weekN != null ? `A new obligation was created for Week ${m.weekN}.` : 'A new obligation was created.'),
  OBLIGATION_SETTLED: (m) => m.debtorName && m.creditorName
    ? `${m.debtorName} settled with ${m.creditorName}${m.weekN != null ? ` for Week ${m.weekN}` : ''}.`
    : (m.weekN != null ? `The Week ${m.weekN} obligation was settled.` : 'A balance was settled.'),

  // ── DI-342/DI-C2 §3.2 — exact copy, quoted verbatim from the design
  // input. These are the ONLY text for their events (no POOLS entry above),
  // so buildCopy() always takes this path for them — deliberate, not a
  // degraded state: a single fixed operational sentence per category, not a
  // pool needing variety.
  // BLOCKING #2's discipline, applied here too: `m.weekN != null` (never
  // just truthy — 0 is a real week number in theory) gates every branch
  // that interpolates it, exactly like PICKS_OPENED's own fallback above.
  // `SLATE_NOT_BUILT` additionally needs `m.n` present before it can quote
  // the DI's exact "{N} days" sentence; missing either falls to a shorter,
  // still-honest sentence rather than rendering "undefined".
  // reviewer note (fix round 2, 2026-09-25): `n` is floored at 1 by
  // `slateNotBuiltDue()`, so "in about 1 days" is a reachable sentence for
  // any league whose median create→open gap rounds to a single day.
  // Singularised here, at the one place the number becomes words.
  SLATE_NOT_BUILT: (m) => (m.weekN != null && m.n != null)
    ? `Week ${m.weekN} has no games yet and usually opens in about ${m.n} ${Number(m.n) === 1 ? 'day' : 'days'}. Build the slate when you get a chance.`
    : (m.weekN != null ? `Week ${m.weekN} has no games yet. Build the slate when you get a chance.` : 'A week has no games yet. Build the slate when you get a chance.'),
  DRAFT_PAST_OPEN: (m) => m.weekN != null
    ? `Week ${m.weekN} is still in Draft and past when it usually opens. Players can't pick until you open it.`
    : 'A week is still in Draft and past when it usually opens. Players can\'t pick until you open it.',
  OPEN_NO_LOCK_TIME: (m) => m.weekN != null
    ? `Week ${m.weekN} is open but has no lock time and no games with kickoffs yet — picks won't auto-lock. Set an Auto-Lock time or add games.`
    : 'A week is open but has no lock time and no games with kickoffs yet — picks won\'t auto-lock. Set an Auto-Lock time or add games.',
  LIVE_NOT_FINALIZED: (m) => m.weekN != null
    ? `Every game in Week ${m.weekN} is final. Finalize the week to close out standings and obligations.`
    : 'Every game in a live week is final. Finalize the week to close out standings and obligations.',

  // ── DI-342/DI-C3 §4.5/§4.6 — non-SCRIBE fallback for the manual
  // reminder's chat post, used when a required fact is missing (see
  // POOLS/PICKS_REMINDER_MANUAL above for the shipped SCRIBE pool — this
  // path is the safety floor beneath it, not the primary copy). Deliberately
  // never names anyone even in the "named" event — a missing-fact fallback
  // should promise only what a minimal fact set (weekN, counts) can support.
  PICKS_REMINDER_MANUAL: (m) => m.weekN != null
    ? `Week ${m.weekN}: ${m.submittedCount ?? '?'}/${m.totalPlayers ?? '?'} picks in. Get yours in before lock.`
    : 'Reminder: picks are still open.',
  PICKS_REMINDER_MANUAL_COUNT_ONLY: (m) => m.weekN != null
    ? `Week ${m.weekN}: ${m.submittedCount ?? '?'}/${m.totalPlayers ?? '?'} picks in. Get yours in before lock.`
    : 'Reminder: picks are still open.',
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
  OBLIGATION_CREATED:          'New balance',
  OBLIGATION_SETTLED:          'Balance settled',

  // DI-342/DI-C2 §3.2 — quoted verbatim.
  SLATE_NOT_BUILT:             'Slate not built',
  DRAFT_PAST_OPEN:             'Week still in draft',
  OPEN_NO_LOCK_TIME:           'No lock time set',
  LIVE_NOT_FINALIZED:          'Ready to finalize',

  // DI-342/DI-C3 — the manual reminder's chat post has no Notification
  // Center row of its own (it rides the existing PICKS_REMINDER push
  // title); this title exists only so buildCopy()'s shape stays uniform
  // and _knownEvents() lists it.
  PICKS_REMINDER_MANUAL:            'Picks reminder',
  PICKS_REMINDER_MANUAL_COUNT_ONLY: 'Picks reminder',
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
