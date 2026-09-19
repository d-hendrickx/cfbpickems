/**
 * CFB Pickems — tbflagtest.mjs
 * ============================
 * Bug: the "(TB)" coin-flip. `rankWeeklyResults()` set `wonByTiebreaker`
 * TRUE on any top-two (or bottom-two) tie in `correctPicks`, WITHOUT checking
 * that the tiebreaker deltas actually differed. So a week where nobody entered
 * a tiebreaker — or where the two tied players' guesses were identically close
 * — displayed "(TB)" beside a name the SORT picked arbitrarily (stable order,
 * i.e. array order, not merit). The tiebreaker didn't break anything; a coin
 * flip did.
 *
 * Reported: docs/PROJECT_PRIMER.md, "Also outstanding" — approved for bugfixer
 * 2026-09-02. Fix confined to js/scoring.js.
 *
 * "Won by tiebreaker" is true ONLY when the tiebreaker genuinely produced a
 * distinct ordering between the two tied-on-correctPicks rows:
 *   - both deltas null (nobody guessed)      → arbitrary  → FALSE
 *   - deltas equal (guesses equally close)   → arbitrary  → FALSE
 *   - one delta present, the other null      → decisive   → TRUE   (nulls-last
 *       sort ranks the guesser above the non-guesser — a real resolution)
 *   - both present and unequal                → decisive   → TRUE
 *
 * These assertions call the REAL exported rankWeeklyResults() directly — the
 * unit under test — so the proof reads start to finish (CLAUDE.md: math proofs
 * live in a separate file beside loadtest.mjs, readable top to bottom).
 *
 * Run:  node tbflagtest.mjs
 * Also: TZ=UTC node tbflagtest.mjs && TZ=America/Los_Angeles node tbflagtest.mjs
 */

// ── Minimal stubs so scoring.js (→ storage.js, data-model.js) imports clean.
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '' },
  hidden: false,
};
globalThis.window = globalThis;
globalThis.fetch = async () => { throw new Error('network disabled in tbflagtest'); };

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

const scoring = await import('./js/scoring.js');
const { rankWeeklyResults } = scoring;
console.log('[tbflagtest] scoring imported —', Object.keys(scoring).length, 'exports');

/** Build one ranking row with just the fields rankWeeklyResults() reads/sets. */
function row(playerId, correctPicks, tiebreakerDelta) {
  return {
    playerId, correctPicks, tiebreakerDelta,
    rank: 0, isWinner: false, isLoser: false, wonByTiebreaker: false,
  };
}
const rank = rows => rankWeeklyResults(rows, true); // anyFinal=true so flags are set

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE BUG — top-two tie in correctPicks, NOBODY entered a tiebreaker.
//    The winner is chosen by stable-sort order, not by any tiebreaker. It must
//    NOT be flagged "(TB)".
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[1] top-two tie, both tiebreakerDelta null — no "(TB)"…');
{
  const rows = rank([
    row('a', 5, null),
    row('b', 5, null),
    row('c', 2, null), // clear loser, keeps [1] about the WINNER only
  ]);
  const winner = rows.find(r => r.isWinner);
  assert(winner.correctPicks === rows[1].correctPicks,
    'fixture check: the top two genuinely tie on correctPicks (5 = 5)');
  assert(winner.tiebreakerDelta === null && rows[1].tiebreakerDelta === null,
    'fixture check: neither of the tied top players entered a tiebreaker');
  assert(winner.wonByTiebreaker === false,
    'the winner is NOT flagged wonByTiebreaker — nothing broke the tie, so no "(TB)" (THE BUG: old code set this true)');
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE BUG, loser side — bottom-two tie in correctPicks, both deltas null.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[2] bottom-two tie, both tiebreakerDelta null — no "(TB)" on the loser…');
{
  const rows = rank([
    row('a', 9, null), // clear winner
    row('b', 3, null),
    row('c', 3, null),
  ]);
  const loser = rows.find(r => r.isLoser);
  const secondLast = rows[rows.length - 2];
  assert(loser.correctPicks === secondLast.correctPicks,
    'fixture check: the bottom two genuinely tie on correctPicks (3 = 3)');
  assert(loser.tiebreakerDelta === null && secondLast.tiebreakerDelta === null,
    'fixture check: neither of the tied bottom players entered a tiebreaker');
  assert(loser.wonByTiebreaker === false,
    'the loser is NOT flagged wonByTiebreaker — the tie was arbitrary (THE BUG: old code set this true)');
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE BUG variant — top-two tie, both entered a tiebreaker but their deltas
//    are IDENTICAL. Still a coin flip: the guesses were equally close.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[3] top-two tie, EQUAL non-null deltas — still no "(TB)"…');
{
  const rows = rank([
    row('a', 5, 4),
    row('b', 5, 4),
    row('c', 2, 9),
  ]);
  const winner = rows.find(r => r.isWinner);
  assert(winner.correctPicks === rows[1].correctPicks && winner.tiebreakerDelta === rows[1].tiebreakerDelta,
    'fixture check: top two tie on correctPicks AND have identical tiebreaker deltas (4 = 4)');
  assert(winner.wonByTiebreaker === false,
    'equal deltas do not break the tie — the winner is NOT flagged "(TB)" (THE BUG: old code set this true)');
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. GENUINE tiebreaker win — top-two tie, winner's delta strictly smaller.
//    This is the case "(TB)" exists FOR: it must STILL be flagged (guards
//    against over-correcting the fix into never flagging).
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[4] top-two tie, winner delta strictly smaller — "(TB)" DOES fire…');
{
  const rows = rank([
    row('a', 5, 8),  // inserted first, but WORSE tiebreaker
    row('b', 5, 2),  // closer guess — genuinely wins the tie
    row('c', 2, 9),
  ]);
  const winner = rows.find(r => r.isWinner);
  assert(winner.playerId === 'b',
    'the closer guess (delta 2) sorts to the top of the tie, ahead of delta 8');
  assert(winner.wonByTiebreaker === true,
    'a genuine tiebreaker resolution IS flagged "(TB)" — the fix does not suppress legitimate wins');
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Present vs. absent — winner entered a tiebreaker, runner-up did not.
//    Nulls-last sort ranks the guesser above the non-guesser; that is a real,
//    deterministic resolution, so it IS flagged.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[5] top-two tie, winner has a guess and runner-up has none — "(TB)" fires…');
{
  const rows = rank([
    row('a', 5, null), // no guess
    row('b', 5, 3),    // has a guess → ranked above by nulls-last
    row('c', 2, null),
  ]);
  const winner = rows.find(r => r.isWinner);
  assert(winner.playerId === 'b' && winner.tiebreakerDelta === 3,
    'the player who entered a guess is ranked above the one who did not');
  assert(winner.wonByTiebreaker === true,
    'a present-vs-absent resolution is decisive, not a coin flip — flagged "(TB)"');
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. No correctPicks tie at all — a clear winner is never spuriously flagged,
//    whatever the deltas.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[6] clear winner (no correctPicks tie) — never flagged "(TB)"…');
{
  const rows = rank([
    row('a', 7, 2),
    row('b', 4, 1), // smaller delta, but LOWER correctPicks — irrelevant
    row('c', 2, 9),
  ]);
  const winner = rows.find(r => r.isWinner);
  assert(winner.playerId === 'a' && winner.correctPicks > rows[1].correctPicks,
    'fixture check: the winner has strictly more correct picks than #2 — no tie to break');
  assert(winner.wonByTiebreaker === false,
    'no correctPicks tie means the tiebreaker was never consulted — no "(TB)"');
}

console.log(`\n[tbflagtest] ${pass} passed, ${fail} failed`);
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
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail ? 1 : 0)));

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
