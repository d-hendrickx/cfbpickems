/**
 * CFB Pickems — atstest.mjs
 * =========================
 * Unit tests for `calculateAtsWinner()` — the function that decides who
 * covered, and therefore who owes whom money.
 *
 * Run:  node atstest.mjs
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Until now `calculateAtsWinner()` had NO direct assertion anywhere in the
 * repo. It was reached only incidentally, through `evaluatePick()`, inside
 * `grouptest.mjs` fixtures — and every one of those fixtures used the same
 * spread: `-3`. One sign, one magnitude. Zero positive spreads (away
 * favored), zero PK/0 spreads, zero pushes, and the `favorite` field appeared
 * in zero assertions.
 *
 * That is the single least-sampled, highest-consequence function in the
 * project, and it is the function at the centre of the v0.13–v0.15 "spread
 * bug" that cost two full sessions and produced AD-03. Precedent for this
 * file's shape is `grouptest.mjs` (UN-118); the DOM-stub preamble is
 * `loadtest.mjs`'s.
 *
 * THE STATED RULE — every expected value below is derived from THIS, by hand,
 * and written into the assertion message. Nothing here was produced by
 * running the function and recording what came back (that is how RG-37
 * shipped: a test that defends the bug instead of catching it).
 *
 *   `game.spread` and `game.lockedSpread` are SIGNED, from the HOME team's
 *   perspective (CLAUDE.md architecture bullet 2 / AD-03 / CONVENTIONS #18):
 *
 *       negative  →  home favored      zero  →  PK      positive  →  away favored
 *
 *   The home score is adjusted BY the spread, then compared:
 *
 *       adjustedHome = homeScore + spread
 *       adjustedHome  >  awayScore   →  the HOME team covered
 *       adjustedHome  <  awayScore   →  the AWAY team covered
 *       adjustedHome  == awayScore   →  push ('no_decision')
 *
 *   In plain English: when home is favored (spread < 0) home must win by MORE
 *   than |spread|; when away is favored (spread > 0) away must win by MORE
 *   than |spread|; landing exactly on the number is a push.
 *
 *   `lockedSpread` GOVERNS whenever it holds a usable number. That is what
 *   stops a mid-week line move from silently rescoring settled picks. The
 *   live `spread` is used only when nothing was locked.
 *
 *   A value that cannot decide anything — missing, blank, or non-numeric —
 *   yields `null` (pending). It never yields a team.
 *
 * SECTIONS
 *   1  Home favored (negative spread) — exhaustive around the number
 *   2  Away favored (positive spread) — the same shape, mirrored
 *   3  MIRROR SYMMETRY — the headline invariant; a sign error dies here
 *   4  PK / zero / -0 / missing spread
 *   5  Exact pushes, both signs, and the float tolerance
 *   6  Half-point spreads — a push is arithmetically impossible
 *   7  lockedSpread vs spread precedence (and the falsy-zero trap)
 *   8  Non-final, missing scores, and non-numeric junk
 *   9  evaluatePick() round trip — the ATS answer reaching a player's row
 *  10  Commissioner data-entry round trip (favorite + positive margin)
 *  11  Shipped-fixture invariants (DEMO_GAMES / HISTORICAL_DEMO_GAMES)
 *  12  Logical consistency across a six-player slate (RG-05)
 *  13  Purity — the function must not mutate the game it is handed
 */

import { readFile } from 'node:fs/promises';

// ── Minimal DOM / localStorage stubs — identical shape to grouptest.mjs's,
// only what storage.js/backend.js need to import cleanly. ────────────────────
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
globalThis.fetch = async () => { throw new Error('network disabled in atstest'); };

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

const scoring = await import('./js/scoring.js');
const dataModel = await import('./js/data-model.js');
const { calculateAtsWinner, evaluatePick } = scoring;
const { DEMO_GAMES, HISTORICAL_DEMO_GAMES, formatSpread, PICK_RESULT, GAME_STATUS } = dataModel;

console.log('[atstest] modules imported —', Object.keys(scoring).length, 'scoring exports,',
  Object.keys(dataModel).length, 'data-model exports');

/** A final game with named, non-colliding team strings. Overrides win. */
const G = (o = {}) => ({
  gameId: 'ats_g', weekId: 'ats_w',
  homeTeam: 'HOME', awayTeam: 'AWAY',
  status: 'final', homeScore: 0, awayScore: 0,
  spread: null, lockedSpread: null,
  ...o,
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. HOME FAVORED — negative spread. Home must win by MORE than |spread|.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[1] Home favored (negative spread) — home must win by MORE than |spread|…');
{
  // spread -3, away 20. Hand-derived: adjusted = home - 3, compare to 20.
  const CASES = [
    [-3, 24, 20, 'HOME',        'home -3 wins by 4 → 24-3=21 > 20 → HOME covers'],
    [-3, 23, 20, 'no_decision', 'home -3 wins by exactly 3 → 23-3=20 == 20 → PUSH'],
    [-3, 22, 20, 'AWAY',        'home -3 wins by only 2 → 22-3=19 < 20 → AWAY covers'],
    [-3, 20, 20, 'AWAY',        'home -3 ties straight up → 20-3=17 < 20 → AWAY covers'],
    [-3, 10, 20, 'AWAY',        'home -3 loses outright → 10-3=7 < 20 → AWAY covers'],
    [-7, 29, 21, 'HOME',        'home -7 wins by 8 → 29-7=22 > 21 → HOME covers'],
    [-7, 28, 21, 'no_decision', 'home -7 wins by exactly 7 → 28-7=21 == 21 → PUSH'],
    [-7, 27, 21, 'AWAY',        'home -7 wins by 6 → 27-7=20 < 21 → AWAY covers'],
    [-14, 35, 14, 'HOME',       'home -14 wins by 21 → 35-14=21 > 14 → HOME covers'],
    [-14, 28, 14, 'no_decision','home -14 wins by exactly 14 → 28-14=14 == 14 → PUSH'],
    [-14, 27, 14, 'AWAY',       'home -14 wins by 13 → 27-14=13 < 14 → AWAY covers'],
    [-28.5, 29, 0, 'HOME',      'home -28.5 wins by 29 → 29-28.5=0.5 > 0 → HOME covers'],
    [-28.5, 28, 0, 'AWAY',      'home -28.5 wins by 28 → 28-28.5=-0.5 < 0 → AWAY covers'],
    [-38, 56, 0, 'HOME',        'home -38 wins by 56 → 56-38=18 > 0 → HOME covers'],
    [-10.5, 13, 12, 'AWAY',     'home -10.5 wins by 1 → 13-10.5=2.5 < 12 → AWAY covers'],
  ];
  for (const [spread, hs, as_, want, why] of CASES) {
    const got = calculateAtsWinner(G({ spread, homeScore: hs, awayScore: as_ }));
    assert(got === want, `${why} — expected ${want}, got ${got}`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 2. AWAY FAVORED — positive spread. Away must win by MORE than |spread|.
//    ZERO fixtures anywhere in the repo exercised this sign before this file.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[2] Away favored (positive spread) — away must win by MORE than |spread|…');
{
  // spread +3, home 20. Hand-derived: adjusted = home + 3, compare to away.
  const CASES = [
    [3, 20, 24, 'AWAY',        'away +3 wins by 4 → 20+3=23 < 24 → AWAY covers'],
    [3, 20, 23, 'no_decision', 'away +3 wins by exactly 3 → 20+3=23 == 23 → PUSH'],
    [3, 20, 22, 'HOME',        'away +3 wins by only 2 → 20+3=23 > 22 → HOME covers'],
    [3, 20, 20, 'HOME',        'away +3 ties straight up → 20+3=23 > 20 → HOME covers'],
    [3, 20, 10, 'HOME',        'away +3 loses outright → 20+3=23 > 10 → HOME covers'],
    [7, 21, 29, 'AWAY',        'away +7 wins by 8 → 21+7=28 < 29 → AWAY covers'],
    [7, 21, 28, 'no_decision', 'away +7 wins by exactly 7 → 21+7=28 == 28 → PUSH'],
    [7, 21, 27, 'HOME',        'away +7 wins by 6 → 21+7=28 > 27 → HOME covers'],
    [14, 14, 35, 'AWAY',       'away +14 wins by 21 → 14+14=28 < 35 → AWAY covers'],
    [14, 14, 28, 'no_decision','away +14 wins by exactly 14 → 14+14=28 == 28 → PUSH'],
    [14, 14, 27, 'HOME',       'away +14 wins by 13 → 14+14=28 > 27 → HOME covers'],
    [28.5, 0, 29, 'AWAY',      'away +28.5 wins by 29 → 0+28.5=28.5 < 29 → AWAY covers'],
    [28.5, 0, 28, 'HOME',      'away +28.5 wins by 28 → 0+28.5=28.5 > 28 → HOME covers'],
    [2.5, 20, 21, 'HOME',      'away +2.5 wins by 1 → 20+2.5=22.5 > 21 → HOME covers'],
    [10.5, 12, 13, 'HOME',     'away +10.5 wins by 1 → 12+10.5=22.5 > 13 → HOME covers'],
  ];
  for (const [spread, hs, as_, want, why] of CASES) {
    const got = calculateAtsWinner(G({ spread, homeScore: hs, awayScore: as_ }));
    assert(got === want, `${why} — expected ${want}, got ${got}`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 3. MIRROR SYMMETRY — the single most valuable assertion in this file.
//
//    Take any game and write it down from the other side of the ledger:
//    swap the two teams, swap the two scores, negate the spread. That is the
//    SAME REAL GAME, recorded home-vs-away the other way round.
//
//    Algebra, by hand:
//        original diff  = (h + s) - a
//        mirrored diff  = (a + (-s)) - h  =  -( (h + s) - a )  =  -original
//    The sign flips exactly and the magnitude is preserved. So the mirrored
//    game returns the mirrored SIDE — which is the SAME TEAM NAME, because
//    the team that was home is now away.
//
//    INVARIANT:  calculateAtsWinner(mirror(g)) === calculateAtsWinner(g)
//
//    A sign error anywhere in the function breaks this immediately, and a
//    sign error is exactly what AD-03 exists to prevent. It is invisible when
//    you only ever test one sign — which is what every fixture in the repo
//    did until this file.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[3] MIRROR SYMMETRY — the same team covers regardless of which side is written as "home"…');
{
  const mirror = g => G({
    homeTeam: g.awayTeam, awayTeam: g.homeTeam,
    homeScore: g.awayScore, awayScore: g.homeScore,
    spread: g.spread === null ? null : -g.spread,
    lockedSpread: g.lockedSpread === null ? null : -g.lockedSpread,
  });

  // Four explicit, hand-checked pairs first — readable proof before the sweep.
  const NAMED = [
    [G({ spread: -3, homeScore: 24, awayScore: 20 }), 'HOME',
      'HOME -3 winning 24-20 covers; written the other way (AWAY +3, 20-24) the SAME team still covers'],
    [G({ spread: -3, homeScore: 22, awayScore: 20 }), 'AWAY',
      'HOME -3 winning only 22-20 fails to cover; mirrored (AWAY +3, 20-22) the SAME team still covers'],
    [G({ spread: -7, homeScore: 28, awayScore: 21 }), 'no_decision',
      'an exact push stays a push under mirroring — a push has no side to flip'],
    [G({ spread: 10.5, homeScore: 12, awayScore: 13 }), 'HOME',
      'AWAY +10.5 winning by only 1 fails to cover; mirrored (HOME -10.5, 13-12) the SAME team still covers'],
  ];
  for (const [g, want, why] of NAMED) {
    const direct = calculateAtsWinner(g);
    const mirrored = calculateAtsWinner(mirror(g));
    assert(direct === want, `${why} — direct side expected ${want}, got ${direct}`);
    assert(mirrored === want, `${why} — mirrored side expected ${want}, got ${mirrored}`);
  }

  // Exhaustive sweep: every spread sign and magnitude we can realistically
  // see, against a grid of score pairs. Aggregated to one assertion per
  // spread so a failure names the exact pair that diverged.
  const SPREADS = [-38, -28.5, -21, -14, -10.5, -7.5, -7, -3.5, -3, -0.5, 0, 0.5, 3, 3.5, 7, 7.5, 10.5, 14, 21, 28.5, 38];
  const SCORES = [[0, 0], [7, 0], [0, 7], [24, 20], [20, 24], [35, 14], [14, 35],
                  [23, 20], [20, 23], [28, 21], [21, 28], [45, 17], [17, 45], [13, 12], [12, 13],
                  [56, 0], [0, 56], [42, 13], [13, 42], [16, 12], [12, 16]];
  const seenOutcomes = new Set();
  for (const spread of SPREADS) {
    let bad = null, checked = 0;
    for (const [hs, as_] of SCORES) {
      const g = G({ spread, homeScore: hs, awayScore: as_ });
      const direct = calculateAtsWinner(g);
      const mirrored = calculateAtsWinner(mirror(g));
      seenOutcomes.add(String(direct));
      checked++;
      if (direct !== mirrored) { bad = `${hs}-${as_}: direct=${direct} mirrored=${mirrored}`; break; }
    }
    assert(bad === null,
      `spread ${spread}: all ${checked} score pairs give the same covering team when the game is written from either side${bad ? ` — DIVERGED at ${bad}` : ''}`);
  }

  // The sweep must not be able to pass vacuously (e.g. if everything returned
  // null, every mirror would trivially "match"). All three real outcomes must
  // actually occur in it.
  assert(seenOutcomes.has('HOME') && seenOutcomes.has('AWAY') && seenOutcomes.has('no_decision'),
    `the mirror sweep is NON-VACUOUS: it produced real HOME covers, real AWAY covers and real pushes (saw ${[...seenOutcomes].sort().join(', ')})`);
  assert(!seenOutcomes.has('null') && !seenOutcomes.has('undefined'),
    'the mirror sweep produced a real decision for every single fixture — none silently fell through to null');
}

// ═════════════════════════════════════════════════════════════════════════════
// 4. PK / ZERO / -0 / MISSING SPREAD
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[4] PK (0), negative zero, and a missing spread…');
{
  assert(calculateAtsWinner(G({ spread: 0, homeScore: 21, awayScore: 20 })) === 'HOME',
    'PK (spread 0): home wins by 1 → 21+0=21 > 20 → HOME covers (a PK is decided straight up)');
  assert(calculateAtsWinner(G({ spread: 0, homeScore: 20, awayScore: 21 })) === 'AWAY',
    'PK (spread 0): away wins by 1 → 20+0=20 < 21 → AWAY covers');
  assert(calculateAtsWinner(G({ spread: 0, homeScore: 21, awayScore: 21 })) === 'no_decision',
    'PK (spread 0): a straight-up tie is a PUSH — 21+0=21 == 21');

  // The commissioner modal computes `-marginVal`, so a margin of 0 entered
  // against a home favorite produces literal -0. It must behave identically.
  for (const [hs, as_, want] of [[21, 20, 'HOME'], [20, 21, 'AWAY'], [21, 21, 'no_decision']]) {
    const zero = calculateAtsWinner(G({ spread: 0, homeScore: hs, awayScore: as_ }));
    const negZero = calculateAtsWinner(G({ spread: -0, homeScore: hs, awayScore: as_ }));
    assert(negZero === want && negZero === zero,
      `negative zero (-0) is arithmetically identical to 0, so ${hs}-${as_} must give ${want} either way — got ${negZero} / ${zero}`);
  }
  assert(Object.is(-0, -0) && !Object.is(-0, 0),
    'fixture check: -0 really is a distinct value from 0 in JS, so the assertion above is not testing the same literal twice');

  // Nothing to score against → pending, never a team.
  assert(calculateAtsWinner(G({ spread: null, homeScore: 24, awayScore: 20 })) === null,
    'no spread on file (null) → null (pending): with no line there is no ATS answer, and guessing one would invent a result');
  assert(calculateAtsWinner(G({ spread: undefined, homeScore: 24, awayScore: 20 })) === null,
    'spread explicitly undefined → null (pending)');
  assert(calculateAtsWinner({ homeTeam: 'HOME', awayTeam: 'AWAY', status: 'final', homeScore: 24, awayScore: 20 }) === null,
    'the `spread` key ABSENT entirely (old data shape) → null (pending), not treated as PK');
  assert(calculateAtsWinner(G({ spread: null, lockedSpread: null, homeScore: 24, awayScore: 20 })) === null,
    'neither spread nor lockedSpread on file → null (pending)');
}

// ═════════════════════════════════════════════════════════════════════════════
// 5. EXACT PUSHES, BOTH SIGNS — where off-by-one and >= vs > errors live.
//    There was not a single push fixture anywhere in the repo before this.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[5] Exact pushes on the number, both signs, plus the float tolerance…');
{
  const PUSHES = [
    [-3, 23, 20, 'home favored by 3, wins by exactly 3'],
    [-7, 28, 21, 'home favored by 7, wins by exactly 7'],
    [-14, 28, 14, 'home favored by 14, wins by exactly 14'],
    [-21, 35, 14, 'home favored by 21, wins by exactly 21'],
    [-38, 56, 18, 'home favored by 38, wins by exactly 38'],
    [3, 20, 23, 'away favored by 3, wins by exactly 3'],
    [7, 21, 28, 'away favored by 7, wins by exactly 7'],
    [14, 14, 28, 'away favored by 14, wins by exactly 14'],
    [21, 14, 35, 'away favored by 21, wins by exactly 21'],
    [38, 18, 56, 'away favored by 38, wins by exactly 38'],
    [0, 17, 17, 'PK, straight-up tie'],
    [-7, 7, 0, 'home favored by 7, wins 7-0 — exactly on the number in a low-scoring game'],
    [7, 0, 7, 'away favored by 7, wins 7-0 — the mirror of the line above'],
  ];
  for (const [spread, hs, as_, why] of PUSHES) {
    const got = calculateAtsWinner(G({ spread, homeScore: hs, awayScore: as_ }));
    assert(got === 'no_decision', `PUSH: ${why} (${hs}-${as_}, spread ${spread}) → landing ON the number is 'no_decision', got ${got}`);
  }

  // One point either side of the number is NOT a push — this is the off-by-one
  // boundary, asserted from both directions on both signs.
  const NEAR = [
    [-7, 29, 21, 'HOME', 'one point PAST a -7 line covers for home'],
    [-7, 27, 21, 'AWAY', 'one point SHORT of a -7 line covers for away'],
    [7, 21, 29, 'AWAY', 'one point PAST a +7 line covers for away'],
    [7, 21, 27, 'HOME', 'one point SHORT of a +7 line covers for home'],
  ];
  for (const [spread, hs, as_, want, why] of NEAR) {
    const got = calculateAtsWinner(G({ spread, homeScore: hs, awayScore: as_ }));
    assert(got === want, `NOT a push: ${why} (${hs}-${as_}, spread ${spread}) → ${want}, got ${got}`);
  }

  // The push test uses a 0.01 float tolerance, which exists to absorb binary
  // float noise in a spread that arrived from ESPN — not to widen the push
  // window. A real half point must stay decisive.
  assert(calculateAtsWinner(G({ spread: -3.5, homeScore: 24, awayScore: 20.5 })) === 'no_decision',
    'the 0.01 tolerance treats an exact 0 difference as a push even with fractional scores (24-3.5 == 20.5)');
  assert(calculateAtsWinner(G({ spread: -3.5, homeScore: 24, awayScore: 20 })) === 'HOME',
    'a real HALF point of margin (0.5) is far outside the 0.01 float tolerance and stays decisive — 24-3.5=20.5 > 20 → HOME');
}

// ═════════════════════════════════════════════════════════════════════════════
// 6. HALF-POINT SPREADS — a push is arithmetically impossible against
//    integer scores, because x.5 can never equal an integer.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[6] Half-point spreads — no integer final score can ever produce a push…');
{
  for (const spread of [-38.5, -28.5, -10.5, -7.5, -3.5, -0.5, 0.5, 3.5, 7.5, 10.5, 28.5, 38.5]) {
    let pushes = 0, decided = 0, example = null;
    for (let hs = 0; hs <= 60; hs++) {
      for (let as_ = 0; as_ <= 60; as_++) {
        const got = calculateAtsWinner(G({ spread, homeScore: hs, awayScore: as_ }));
        if (got === 'no_decision') { pushes++; if (!example) example = `${hs}-${as_}`; }
        else if (got === 'HOME' || got === 'AWAY') decided++;
      }
    }
    assert(pushes === 0 && decided === 61 * 61,
      `spread ${spread}: all ${61 * 61} integer score pairs 0-60 produce a decisive winner, zero pushes (got ${decided} decided, ${pushes} pushes${example ? `, first bogus push at ${example}` : ''})`);
  }

  // Specific hand-derived half-point cases, both signs.
  const CASES = [
    [-3.5, 24, 20, 'HOME', 'home -3.5 wins by 4 → 24-3.5=20.5 > 20 → HOME'],
    [-3.5, 23, 20, 'AWAY', 'home -3.5 wins by 3 → 23-3.5=19.5 < 20 → AWAY (the hook)'],
    [7.5, 20, 28, 'AWAY', 'away +7.5 wins by 8 → 20+7.5=27.5 < 28 → AWAY'],
    [7.5, 20, 27, 'HOME', 'away +7.5 wins by 7 → 20+7.5=27.5 > 27 → HOME (the hook)'],
    [-0.5, 21, 20, 'HOME', 'home -0.5 wins by 1 → 20.5 > 20 → HOME'],
    [-0.5, 20, 20, 'AWAY', 'home -0.5 ties → 19.5 < 20 → AWAY (a half-point line turns a tie into a loss)'],
    [0.5, 20, 20, 'HOME', 'away +0.5 ties → 20.5 > 20 → HOME (mirror of the line above)'],
  ];
  for (const [spread, hs, as_, want, why] of CASES) {
    const got = calculateAtsWinner(G({ spread, homeScore: hs, awayScore: as_ }));
    assert(got === want, `${why} — expected ${want}, got ${got}`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 7. lockedSpread vs spread PRECEDENCE.
//    `lockedSpread` is the line the week was locked against. It must WIN over
//    the live `spread` whenever both are present and differ — otherwise a
//    mid-week line move silently rescores picks that were already settled.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[7] lockedSpread governs — a mid-week line move must not rescore settled picks…');
{
  // Home wins 24-20. Locked at -3 (covers). Line later moved to -14 (would NOT cover).
  const locked = G({ lockedSpread: -3, spread: -14, homeScore: 24, awayScore: 20 });
  assert(calculateAtsWinner(locked) === 'HOME',
    'locked -3 / live -14, home wins 24-20 → scored against the LOCKED line: 24-3=21 > 20 → HOME covers');
  assert(calculateAtsWinner(G({ lockedSpread: null, spread: -14, homeScore: 24, awayScore: 20 })) === 'AWAY',
    'DISCRIMINATING CONTROL: the same game scored against the MOVED line (-14) gives the opposite answer, 24-14=10 < 20 → AWAY. The two lines really do disagree, so the assertion above is not vacuous');

  // Same shape with the signs reversed, so precedence is proven on both signs.
  assert(calculateAtsWinner(G({ lockedSpread: 3, spread: 14, homeScore: 20, awayScore: 24 })) === 'AWAY',
    'locked +3 / live +14, away wins 24-20 → scored against the LOCKED line: 20+3=23 < 24 → AWAY covers');
  assert(calculateAtsWinner(G({ lockedSpread: null, spread: 14, homeScore: 20, awayScore: 24 })) === 'HOME',
    'DISCRIMINATING CONTROL (away-favored): against the moved line (+14) the same game flips to 20+14=34 > 24 → HOME');

  // THE FALSY-ZERO TRAP: `lockedSpread: 0` is a real locked line (a PK), not
  // "unset". A `!lockedSpread` style check would silently fall through to the
  // live spread here and rescore the week.
  assert(calculateAtsWinner(G({ lockedSpread: 0, spread: -14, homeScore: 21, awayScore: 21 })) === 'no_decision',
    'FALSY-ZERO TRAP: lockedSpread 0 is a locked PK, not "unset" — a 21-21 tie is a PUSH, NOT the -14 live line\'s answer');
  assert(calculateAtsWinner(G({ lockedSpread: null, spread: -14, homeScore: 21, awayScore: 21 })) === 'AWAY',
    'DISCRIMINATING CONTROL: with nothing locked, that same 21-21 game against the live -14 line gives AWAY — so locked 0 really did override something');
  assert(calculateAtsWinner(G({ lockedSpread: -0, spread: -14, homeScore: 21, awayScore: 21 })) === 'no_decision',
    'negative zero as a locked line is also a real locked PK, not "unset"');

  // Documented fallback: use the live spread only when nothing was locked.
  assert(calculateAtsWinner(G({ lockedSpread: null, spread: -3, homeScore: 24, awayScore: 20 })) === 'HOME',
    'lockedSpread null → fall back to the live spread, so a final game on a never-locked week still scores instead of showing PENDING forever');
  assert(calculateAtsWinner({ homeTeam: 'HOME', awayTeam: 'AWAY', status: 'final', homeScore: 24, awayScore: 20, spread: -3 }) === 'HOME',
    'the `lockedSpread` key ABSENT entirely (old data shape) → same fallback to the live spread');
  assert(calculateAtsWinner(G({ lockedSpread: -3, spread: null, homeScore: 24, awayScore: 20 })) === 'HOME',
    'lockedSpread present with no live spread at all → the locked line still governs');
  assert(calculateAtsWinner(G({ lockedSpread: -3, spread: undefined, homeScore: 24, awayScore: 20 })) === 'HOME',
    'lockedSpread present with spread undefined → the locked line still governs');

  // The invariant stated as a property: once locked, moving the live line
  // cannot change the answer, for ANY line move.
  {
    let bad = null;
    for (const lockedLine of [-14, -7, -3.5, -3, 0, 3, 3.5, 7, 14]) {
      const base = calculateAtsWinner(G({ lockedSpread: lockedLine, spread: lockedLine, homeScore: 24, awayScore: 20 }));
      for (const moved of [-38, -14, -7, -3, 0, 3, 7, 14, 38]) {
        const after = calculateAtsWinner(G({ lockedSpread: lockedLine, spread: moved, homeScore: 24, awayScore: 20 }));
        if (after !== base) { bad = `locked ${lockedLine}: moving the live line to ${moved} changed the answer from ${base} to ${after}`; break; }
      }
      if (bad) break;
    }
    assert(bad === null,
      `THE RESCORING GUARD: across 9 locked lines × 9 subsequent line moves, the ATS answer never moved once the line was locked${bad ? ` — ${bad}` : ''}`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 8. NON-FINAL, MISSING SCORES, AND NON-NUMERIC JUNK.
//
//    Rule: a value that cannot decide anything yields `null` (pending). It
//    never yields a team. The function's own `homeScore === null` guard states
//    that intent; anything that reaches the arithmetic with a non-number
//    produces NaN, and `NaN > 0` is false — which silently hands the cover to
//    whichever branch is the `else`. That is a money-deciding answer invented
//    out of missing data.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[8] Non-final games, missing scores, and non-numeric junk → null (pending), never a team…');
{
  for (const status of ['scheduled', 'live', undefined, '', 'FINAL', 'Final', 'completed']) {
    const got = calculateAtsWinner(G({ status, spread: -3, homeScore: 24, awayScore: 20 }));
    assert(got === null,
      `status ${JSON.stringify(status)} is not the FINAL sentinel ('${GAME_STATUS.FINAL}') → null (pending), got ${got}`);
  }

  assert(calculateAtsWinner(G({ spread: -3, homeScore: null, awayScore: 20 })) === null,
    'home score null → null (pending): a game with no home score cannot decide a cover');
  assert(calculateAtsWinner(G({ spread: -3, homeScore: 24, awayScore: null })) === null,
    'away score null → null (pending)');
  assert(calculateAtsWinner(G({ spread: -3, homeScore: null, awayScore: null })) === null,
    'both scores null → null (pending)');

  // Zero is a REAL score, not a missing one — the other falsy trap.
  assert(calculateAtsWinner(G({ spread: 0, homeScore: 0, awayScore: 0 })) === 'no_decision',
    'a real 0-0 final on a PK is a PUSH — 0 is a score, not "missing"');
  assert(calculateAtsWinner(G({ spread: -7, homeScore: 7, awayScore: 0 })) === 'no_decision',
    'a real 7-0 final against a -7 line is a PUSH — the 0 away score is a score, not "missing"');
  assert(calculateAtsWinner(G({ spread: 3, homeScore: 0, awayScore: 10 })) === 'AWAY',
    'a real 0-10 final against a +3 line → 0+3=3 < 10 → AWAY covers; the 0 home score is a score, not "missing"');

  // ── THE DEFECT SET ────────────────────────────────────────────────────────
  // Every case below currently produces a REAL COVER for the away team out of
  // data that cannot decide anything, because the NaN falls through
  // `Math.abs(NaN) < 0.01` (false) and `NaN > 0` (false) to the else branch.
  const JUNK = [
    [{ spread: -3, homeScore: undefined, awayScore: 20 }, 'home score undefined (key present, value missing)'],
    [{ spread: -3, homeScore: 24, awayScore: undefined }, 'away score undefined'],
    [{ spread: -3, homeScore: NaN, awayScore: 20 }, 'home score NaN (what parseFloat("") style paths produce)'],
    [{ spread: -3, homeScore: 24, awayScore: NaN }, 'away score NaN'],
    [{ spread: NaN, homeScore: 24, awayScore: 20 }, 'spread NaN'],
    [{ lockedSpread: NaN, spread: null, homeScore: 24, awayScore: 20 }, 'lockedSpread NaN with no live spread to fall back to'],
    [{ spread: '', homeScore: 24, awayScore: 20 }, 'spread as an empty string (must NOT be read as a 0/PK line)'],
    [{ spread: '   ', homeScore: 24, awayScore: 20 }, 'spread as whitespace'],
    [{ spread: 'PK', homeScore: 24, awayScore: 20 }, 'spread as a non-numeric string'],
    [{ spread: -3, homeScore: '', awayScore: 20 }, 'home score as an empty string (must NOT be read as 0)'],
    [{ spread: -3, homeScore: true, awayScore: 20 }, 'home score as a boolean (must NOT be read as 1)'],
    [{ spread: -3, homeScore: [], awayScore: 20 }, 'home score as an array (must NOT be read as 0)'],
    [{ spread: [], homeScore: 24, awayScore: 20 }, 'spread as an array (must NOT be read as 0/PK)'],
    [{ spread: Infinity, homeScore: 24, awayScore: 20 }, 'spread as Infinity'],
  ];
  for (const [over, why] of JUNK) {
    const got = calculateAtsWinner(G(over));
    assert(got === null,
      `NON-NUMERIC → null (pending), never a team: ${why} — got ${JSON.stringify(got)}`);
  }
  assert(calculateAtsWinner({ homeTeam: 'HOME', awayTeam: 'AWAY', status: 'final', awayScore: 20, spread: -3 }) === null,
    'NON-NUMERIC → null: the `homeScore` key ABSENT entirely → null (pending), not a free cover for the away team');

  // The reason this matters, stated as its own assertion: no input that
  // cannot decide anything may ever produce a lopsided, always-the-same-side
  // answer. If it did, every player who picked the away team would be paid.
  {
    const undecidable = JUNK.map(([over]) => calculateAtsWinner(G(over)));
    assert(undecidable.every(r => r === null),
      `no undecidable input produces a team: ${undecidable.filter(r => r !== null).length} of ${undecidable.length} returned a cover`);
    assert(!undecidable.includes('AWAY'),
      'and specifically: none of them silently hands the cover to the AWAY team, which is where every NaN falls through to');
  }

  // Numeric strings ARE usable — CONVENTIONS #7 says coerce at data
  // boundaries. A value that round-tripped through a text field still decides
  // the same game it always did.
  assert(calculateAtsWinner(G({ spread: '-3', homeScore: 24, awayScore: 20 })) === 'HOME',
    'a numeric STRING spread "-3" coerces to -3 and scores identically → 24-3=21 > 20 → HOME');
  assert(calculateAtsWinner(G({ spread: -3, homeScore: '24', awayScore: '20' })) === 'HOME',
    'numeric STRING scores coerce and score identically → 24-3=21 > 20 → HOME');
  assert(calculateAtsWinner(G({ spread: '3', homeScore: '20', awayScore: '24' })) === 'AWAY',
    'numeric strings on the away-favored sign too → 20+3=23 < 24 → AWAY');

  // A missing game object fails LOUDLY rather than inventing a cover (AD-06's
  // no-silent-fallback principle applied to the scoring path).
  for (const bad of [null, undefined]) {
    let threw = false, returned;
    try { returned = calculateAtsWinner(bad); } catch { threw = true; }
    assert(threw === true,
      `calculateAtsWinner(${bad}) throws loudly instead of returning a team — a missing game is a caller bug, not a push (got ${JSON.stringify(returned)})`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 9. evaluatePick() ROUND TRIP — the ATS answer as it reaches a player's row.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[9] evaluatePick() round trip — the ATS answer reaching a player\'s scorecard…');
{
  const homeCovers = G({ spread: -3, homeScore: 24, awayScore: 20 });   // HOME covers
  const awayCovers = G({ spread: 3, homeScore: 20, awayScore: 24 });    // AWAY covers (mirror)
  const push = G({ spread: -3, homeScore: 23, awayScore: 20 });         // PUSH

  assert(evaluatePick({ selectedTeam: 'HOME' }, homeCovers) === PICK_RESULT.WIN,
    'home favored -3, home wins by 4: the player who picked HOME gets a WIN');
  assert(evaluatePick({ selectedTeam: 'AWAY' }, homeCovers) === PICK_RESULT.LOSS,
    'home favored -3, home wins by 4: the player who picked AWAY gets a LOSS');
  assert(evaluatePick({ selectedTeam: 'AWAY' }, awayCovers) === PICK_RESULT.WIN,
    'AWAY favored +3, away wins by 4: the player who picked AWAY gets a WIN — the positive-spread sign reaches the scorecard correctly');
  assert(evaluatePick({ selectedTeam: 'HOME' }, awayCovers) === PICK_RESULT.LOSS,
    'AWAY favored +3, away wins by 4: the player who picked HOME gets a LOSS');
  assert(evaluatePick({ selectedTeam: 'HOME' }, push) === PICK_RESULT.NO_DECISION &&
         evaluatePick({ selectedTeam: 'AWAY' }, push) === PICK_RESULT.NO_DECISION,
    'an exact push is a NO_DECISION for BOTH players — nobody wins and nobody loses a push');
  assert(evaluatePick({ selectedTeam: 'HOME' }, G({ ...homeCovers, status: 'scheduled' })) === PICK_RESULT.PENDING,
    'a scheduled game is PENDING regardless of what scores happen to be on the record');
  assert(evaluatePick({ selectedTeam: 'HOME' }, G({ ...homeCovers, status: 'live' })) === PICK_RESULT.LIVE,
    'a live game is LIVE, never graded early');
  assert(evaluatePick({ selectedTeam: 'HOME' }, G({ spread: null, homeScore: 24, awayScore: 20 })) === PICK_RESULT.PENDING,
    'a final game with no spread on file is PENDING — an ungradeable game must not silently grade');

  // Stored `atsWinner` takes precedence over recomputation. This is deliberate
  // (it is the audit trail of what the week was actually scored against), and
  // it is asserted here so the precedence is documented rather than assumed.
  const stale = G({ spread: -3, homeScore: 24, awayScore: 20, atsWinner: 'AWAY' });
  assert(calculateAtsWinner(stale) === 'HOME',
    'fixture check: computed fresh from the spread and scores, this game is a HOME cover');
  assert(evaluatePick({ selectedTeam: 'AWAY' }, stale) === PICK_RESULT.WIN,
    'a STORED atsWinner takes precedence over recomputation in evaluatePick — the stored field is what the week was scored against, so a stale one grades the whole league against a line nobody sees');
}

// ═════════════════════════════════════════════════════════════════════════════
// 10. COMMISSIONER DATA-ENTRY ROUND TRIP — favorite + POSITIVE margin.
//     Sign errors AT DATA ENTRY were the actual root cause of the v0.13–v0.15
//     spread bug (AD-03) — not the math. This section proves the entry rule
//     produces the right signed value AND that the wrong sign is visible.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[10] Data-entry round trip — favorite + positive margin → signed spread → ATS winner…');
{
  /**
   * The entry rule, transcribed from the STATED convention (CLAUDE.md bullet
   * 2 / CONVENTIONS #18), NOT copied from the implementation: the modal takes
   * a favorite and a POSITIVE margin and computes the signed home-perspective
   * value. Home favored is negative, away favored is positive, PK is zero.
   *
   * NOTE FOR THE REPORT: `showGameModal()` in app.js implements this rule
   * inline (app.js:5838-5841). There is no shared exported helper, so this
   * transcription cannot break if that code changes. See the findings.
   */
  const signedSpreadFromEntry = (favorite, margin) => {
    if (favorite === 'pk') return 0;
    // A blank margin field is NO MARGIN, not a margin of zero. `Number('')`
    // is 0, so coercing first would turn "favorite chosen, margin left blank"
    // into a silently-stored PK line. (This corrected an error in this
    // transcription itself, caught by the assertion below.)
    if (typeof margin === 'string' && margin.trim() === '') return null;
    const m = Math.abs(Number(margin));
    if (!Number.isFinite(m)) return null;
    if (favorite === 'home') return -m;
    if (favorite === 'away') return m;
    return null;
  };

  assert(signedSpreadFromEntry('home', 3) === -3, 'entry rule: home favored by 3 → signed spread -3 (negative = home favored)');
  assert(signedSpreadFromEntry('away', 3) === 3, 'entry rule: away favored by 3 → signed spread +3 (positive = away favored)');
  assert(signedSpreadFromEntry('home', 7.5) === -7.5, 'entry rule: home favored by 7.5 → -7.5');
  assert(signedSpreadFromEntry('away', 10.5) === 10.5, 'entry rule: away favored by 10.5 → +10.5');
  assert(signedSpreadFromEntry('pk', '') === 0, 'entry rule: PK → 0 regardless of the margin field');
  assert(signedSpreadFromEntry('home', -3) === -3, 'entry rule: the margin is always taken as POSITIVE, so a typed "-3" against a home favorite is still -3, never +3');
  assert(signedSpreadFromEntry('away', -3) === 3, 'entry rule: a typed "-3" against an away favorite is still +3');
  assert(signedSpreadFromEntry('', 3) === null && signedSpreadFromEntry('home', '') === null,
    'entry rule: no favorite chosen, or no margin typed, yields no spread at all');

  // Full round trip: entry → signed value → ATS winner, both signs.
  const trip = (favorite, margin, homeScore, awayScore) =>
    calculateAtsWinner(G({ spread: signedSpreadFromEntry(favorite, margin), homeScore, awayScore }));

  assert(trip('home', 3, 24, 20) === 'HOME',
    'ROUND TRIP: commissioner enters "home favored by 3", home wins 24-20 → -3 → 24-3=21 > 20 → HOME covers');
  assert(trip('home', 3, 22, 20) === 'AWAY',
    'ROUND TRIP: "home favored by 3", home wins only 22-20 → -3 → 19 < 20 → AWAY covers');
  assert(trip('away', 3, 20, 24) === 'AWAY',
    'ROUND TRIP: commissioner enters "away favored by 3", away wins 24-20 → +3 → 23 < 24 → AWAY covers');
  assert(trip('away', 3, 20, 22) === 'HOME',
    'ROUND TRIP: "away favored by 3", away wins only 22-20 → +3 → 23 > 22 → HOME covers');
  assert(trip('pk', 0, 21, 21) === 'no_decision',
    'ROUND TRIP: commissioner enters PK, game ends 21-21 → 0 → PUSH');
  assert(trip('home', 3, 23, 20) === 'no_decision',
    'ROUND TRIP: "home favored by 3", home wins by exactly 3 → PUSH');

  // THE AD-03 NEGATIVE CONTROL: the same real-world game entered with the
  // sign inverted produces the OPPOSITE winner. This is the bug that cost two
  // sessions, reproduced deliberately so the suite can be seen to detect it.
  const right = calculateAtsWinner(G({ spread: signedSpreadFromEntry('home', 3), homeScore: 22, awayScore: 20 }));
  const wrong = calculateAtsWinner(G({ spread: -signedSpreadFromEntry('home', 3), homeScore: 22, awayScore: 20 }));
  assert(right === 'AWAY' && wrong === 'HOME',
    `AD-03 NEGATIVE CONTROL: "home favored by 3" stored with the WRONG sign (+3 instead of -3) flips the cover from ${right} to ${wrong} — the sign is load-bearing and this suite can see it invert`);
  assert(right !== wrong,
    'AD-03 NEGATIVE CONTROL: a sign error at data entry is NOT a no-op — it pays the wrong half of the league');

  // The `favorite` field is display-only and must agree with the sign, so the
  // line a player READS is the line the engine SCORES. `formatSpread()` never
  // shows a plus sign, so the sign is invisible on screen — which is exactly
  // why it has to be right in storage.
  const g10 = { homeTeam: 'HOME', awayTeam: 'AWAY' };
  assert(formatSpread(signedSpreadFromEntry('home', 3), 'HOME', g10) === 'HOME -3',
    'display: "home favored by 3" renders as "HOME -3"');
  assert(formatSpread(signedSpreadFromEntry('away', 3), 'AWAY', g10) === 'AWAY -3',
    'display: "away favored by 3" ALSO renders with a minus sign ("AWAY -3") — the stored sign is positive but never shown, so display can never reveal a sign error');
  assert(formatSpread(-3, null, g10) === 'HOME -3',
    'display: with no favorite on file, a negative spread derives the HOME team as favorite');
  assert(formatSpread(3, null, g10) === 'AWAY -3',
    'display: with no favorite on file, a positive spread derives the AWAY team as favorite');
  assert(formatSpread(0, null, g10) === 'PK' && formatSpread(null, null, g10) === 'TBD',
    'display: 0 is PK and a missing spread is TBD');
}

// ═════════════════════════════════════════════════════════════════════════════
// 11. SHIPPED-FIXTURE INVARIANTS.
//     Every game literal shipped in data-model.js must satisfy the convention
//     it is written in. Two independent invariants:
//       (a) `favorite` agrees with the SIGN of the spread — otherwise the line
//           on screen and the line being scored name different teams;
//       (b) any stored `atsWinner` equals what the spread and scores produce —
//           otherwise the same game grades two different ways depending on
//           whether the commissioner pressed "recompute".
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[11] Shipped fixtures obey the convention they are written in…');
{
  const ALL = [...DEMO_GAMES, ...HISTORICAL_DEMO_GAMES];
  assert(ALL.length === 20, `fixture check: auditing all ${ALL.length} shipped game literals (10 demo + 10 historical demo)`);

  for (const g of ALL) {
    const sv = g.lockedSpread ?? g.spread;
    if (sv === null || sv === undefined || !g.favorite) continue;
    const impliedFav = sv < 0 ? g.homeTeam : sv > 0 ? g.awayTeam : null;
    assert(impliedFav === null || g.favorite === impliedFav,
      `${g.gameId} (${g.awayTeam} @ ${g.homeTeam}): spread ${sv} means "${impliedFav}" is favored, and the favorite field says "${g.favorite}" — the line displayed and the line scored must name the SAME team`);
  }

  for (const g of ALL) {
    if (g.lockedSpread === null || g.lockedSpread === undefined || g.spread === null || g.spread === undefined) continue;
    assert(Math.sign(g.lockedSpread) === Math.sign(g.spread),
      `${g.gameId}: lockedSpread ${g.lockedSpread} and spread ${g.spread} favor the same side`);
  }

  /**
   * RESOLVED 2026-08-26 — the quarantine that used to live here is GONE, and
   * that is the point: it was built to delete itself.
   *
   * `hg6` (Louisiana Tech 14 @ Arkansas 35, line -14) stored 'no_decision'
   * while its own inputs compute an Arkansas cover — 35-14 = 21, and 21 > 14.
   * Exactly one of two fields was mistyped, and the two repairs were not
   * equivalent: fix the derived field, or move the line to -21 and make it a
   * genuine push.
   *
   * Drew's ruling: fix the derived field. The scores read as a real game and
   * the week's own blurb says the spreads are pre-set, so the score is the
   * trustworthy number and the label was the typo. Moving the line would have
   * meant inventing a betting line to justify a wrong label.
   *
   * `hg6` now rejoins the invariant below with every other fixture — no
   * exception list, nothing to remember. The quarantine's own assertion turned
   * red the moment the data was repaired and forced this removal, which is
   * exactly what a self-deleting exemption is for. Do not add a new one
   * without the same property.
   */
  for (const g of ALL) {
    if (g.status !== 'final') continue;
    const computed = calculateAtsWinner(g);
    assert(g.atsWinner === computed,
      `${g.gameId} (${g.awayTeam} ${g.awayScore} @ ${g.homeTeam} ${g.homeScore}, line ${g.lockedSpread ?? g.spread}): stored atsWinner "${g.atsWinner}" equals the computed answer "${computed}" — a stored value that disagrees with its own inputs grades one way in the picks table and the other way after any recompute`);
  }
  assert(calculateAtsWinner(ALL.find(x => x.gameId === 'hg6')) === 'Arkansas',
    'hg6 hand-check: Arkansas 35, Louisiana Tech 14, line -14 → 35-14=21 > 14 → Arkansas COVERS, which is now what the fixture stores');

  // Non-final fixtures must not carry a stored ATS answer.
  for (const g of ALL) {
    if (g.status === 'final') continue;
    assert(g.atsWinner === null,
      `${g.gameId} is ${g.status}, so it carries no stored atsWinner (got ${JSON.stringify(g.atsWinner)})`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 12. LOGICAL CONSISTENCY ACROSS A SIX-PLAYER SLATE (RG-05).
//     A two-outcome game cannot be all-red or all-green for six players who
//     did not all pick the same team.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[12] Six-player consistency — a decided game splits the league (RG-05)…');
{
  const picks = ['HOME', 'HOME', 'HOME', 'AWAY', 'AWAY', 'AWAY'];
  for (const [spread, hs, as_, why] of [
    [-3, 24, 20, 'home favored, home covers'],
    [-3, 22, 20, 'home favored, away covers'],
    [3, 20, 24, 'away favored, away covers'],
    [3, 20, 22, 'away favored, home covers'],
    [0, 21, 20, 'PK, home covers'],
  ]) {
    const game = G({ spread, homeScore: hs, awayScore: as_ });
    const results = picks.map(t => evaluatePick({ selectedTeam: t }, game));
    const wins = results.filter(r => r === PICK_RESULT.WIN).length;
    const losses = results.filter(r => r === PICK_RESULT.LOSS).length;
    assert(wins === 3 && losses === 3,
      `${why}: three players picked each side, so the league splits 3 W / 3 L — never all-red or all-green (got ${wins}W/${losses}L)`);
  }
  const pushGame = G({ spread: -3, homeScore: 23, awayScore: 20 });
  const pushResults = picks.map(t => evaluatePick({ selectedTeam: t }, pushGame));
  assert(pushResults.every(r => r === PICK_RESULT.NO_DECISION),
    'a PUSH is the ONE case where all six players get the same result — and it is NO_DECISION, never a win or a loss');
}

// ═════════════════════════════════════════════════════════════════════════════
// 13. PURITY — the function reads a game, it does not edit one.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[13] Purity — calculateAtsWinner() never mutates the game it is handed…');
{
  const g = G({ spread: -3, lockedSpread: -7, homeScore: 24, awayScore: 20, atsWinner: null });
  const before = JSON.stringify(g);
  calculateAtsWinner(g);
  assert(JSON.stringify(g) === before,
    'the game object is byte-identical after scoring — nothing is written back, so calling it twice can never drift');
  assert(calculateAtsWinner(g) === calculateAtsWinner(g),
    'two consecutive calls on the same game agree — the answer depends only on the game, never on call order or the clock');
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
