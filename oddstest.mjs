/**
 * CFB Pickems — oddstest.mjs
 * ==========================
 * ESPN odds → signed home-perspective spread. The DATA-ENTRY end of AD-03.
 *
 * Run:  node oddstest.mjs
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `atstest.mjs` proves `calculateAtsWinner()` correct, and `gradetest.mjs`
 * proves the commissioner's buttons all call it. Both take `game.spread` as
 * GIVEN. Nothing anywhere asserted that the spread ESPN hands us is stored
 * with the right SIGN — and that is precisely where the v0.13–v0.15 spread
 * bug lived. AD-03 was written because a sign error at DATA ENTRY, not a math
 * error, cost two full sessions. This file covers the one remaining unguarded
 * data-entry path: the automatic one.
 *
 * THE DEFECT THIS FILE WAS WRITTEN AGAINST (verified against live ESPN
 * `site.api.espn.com/.../college-football/scoreboard`, 2026-09-01):
 *
 *   `extractSpread()` resolved WHICH team is favored by substring-matching
 *   ESPN's `odds.details` text ("MIA -24.5") against the team's `location`
 *   ("Miami"). ESPN writes that text with an ABBREVIATION — in 24 of 24
 *   competitions carrying odds. Of the 400 teams ESPN publishes, only 27
 *   have an abbreviation that happens to substring-match their location under
 *   that matcher; the other 373 (93.3%) do not resolve at all.
 *
 *   When the match failed, `favorite` stayed `null`, so this line never fired:
 *
 *       if (favorite === awayTeam) homePerspective = -spreadNum;
 *
 *   and the raw negative number was kept — which SILENTLY ASSERTS THE HOME
 *   TEAM IS FAVORED. For an away-favored game that inverts the spread.
 *
 *   Live example, by name: `MIA -24.5`, Miami at Stanford. ESPN's own
 *   `odds.awayTeamOdds.favorite === true`. Truth is Miami (away) favored by
 *   24.5, so home perspective is +24.5. The parser returned -24.5 — Stanford
 *   favored by 24.5. A 49-point error, graded as fact.
 *
 * THE SECOND DEFECT, FOUND 2026-09-03 — same class, one rung lower:
 *
 *   The fix above demoted the school-name matcher to rung 3 rather than
 *   removing it, so a flagless payload could still be resolved by substring.
 *   That matcher tested the HOME team's last token FIRST, which reads
 *   SHARED-SUFFIX matchups backwards:
 *
 *       `Ball State -7`, Ball State at Ohio State. The home last token
 *       "state" is a substring of "ball state", so it declared OHIO STATE
 *       favored and stored -7. Ball State is favored; the answer is +7. A
 *       14-point error with the sign reversed — and fingerprinted
 *       `spreadSource: 'espn'`, i.e. TRUSTED, so nothing warned anyone.
 *
 *   Dormant in production (ESPN supplied the structured flags on 408 of 408
 *   odds-carrying competitions measured 2026-09-03, so rung 1 always
 *   answered first) but live in the code. Measured with the flags stripped —
 *   the only scenario the rung existed for — rung 2 resolved 405/408 and
 *   rung 4 correctly caught the other 3; the school-name rung resolved ZERO
 *   in either scenario. Forced to run as the sole resolver over all 52,670
 *   ordered pairings of the 230 CFB schools in that corpus it answered
 *   BACKWARDS on 2,708 — 5.14%. Deleted 2026-09-03; E19 is the reproduction
 *   and E16/E17/E18/E20 assert the fail-closed behavior that replaced it.
 *
 * WHY IT MATTERS: `applyWeekStatusChange()` copies `g.spread` into
 * `lockedSpread` verbatim on OPEN→LOCKED (`app.js:6753`), the auto-lock does
 * the same (`app.js:6943`), and `lockedSpread` is what `calculateAtsWinner()`
 * grades on. The commissioner's Favorite+Margin modal is NOT in this path:
 * the "+ Add" button on the available-games list calls
 * `saveGame(createGame(week.weekId, data))` directly (`app.js:3799`), so the
 * ESPN value reaches storage with no human ever confirming it.
 *
 * THE STATED RULE — every expected value below is derived from THIS, by hand,
 * cross-checked against ESPN's own structured `homeTeamOdds.favorite` /
 * `awayTeamOdds.favorite` booleans. Nothing here was produced by running the
 * parser and recording what came back (that is how RG-37 shipped: a test that
 * defends the bug instead of catching it).
 *
 *   `game.spread` is SIGNED, from the HOME team's perspective
 *   (CLAUDE.md architecture bullet 2 / AD-03 / CONVENTIONS #18):
 *
 *       negative → HOME favored     zero → PK     positive → AWAY favored
 *
 *   So for a line of magnitude M:
 *       ESPN says the HOME team is favored  →  spread must be  -M
 *       ESPN says the AWAY team is favored  →  spread must be  +M
 *
 *   A line we cannot resolve must yield `spread: null` (commissioner enters
 *   it by hand) — never a confident guess. `null` is honest; a wrong sign is
 *   a 2M-point error that grades real money.
 *
 * HOW IT DRIVES THE APP
 * ---------------------
 * Through the REAL public entry point, `fetchByDateRange()`, with
 * `globalThis.fetch` stubbed to return a fixture scoreboard payload built
 * from the live payload SHAPES above. `extractSpread()` is module-private and
 * stays that way — testing it through the public path also proves the wiring
 * (`parseAndReport` → `extractSpread`) that a direct unit test would miss.
 *
 * SECTIONS
 *   1  The reported defect, by name: MIA -24.5, Miami at Stanford
 *   2  Home-favored controls — the majority case, MUST NOT CHANGE
 *   3  Away-favored, abbreviation happens to match — was right, stays right
 *   4  Away-favored, abbreviation does NOT match — the bug's blast radius
 *   5  Pick / PK / no odds / unparseable — must yield null, never a guess
 *   6  The invariant: sign(spread) agrees with ESPN's favorite flag, always
 *   7  Mirror symmetry — swap home and away, the sign must flip
 *   8  The ladder — rung 1 outranks, rung 2 resolves, rung 4 stops
 *   9  Spelled-out names fail closed; rung 2's exact-match strictness
 *  10  spreadSource — the audit fingerprint, asserted on every branch
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT COVER — AND WHY
 * ----------------------------------------------------
 * A coverage claim that hides its own holes is how RG-27 happened. These are
 * this file's remaining holes, each checked against live ESPN — 1123
 * competitions across the CFB Sep/Oct/Nov 2026 scoreboards plus the NFL
 * season, 409 of them carrying an odds object, re-pulled 2026-09-03 — before
 * deciding not to write a fixture:
 *
 *   • `magnitude === 0` (the PK branch). NOT REACHED by any real payload.
 *     ESPN's pick'em strings are "Pick" / "PK" / "EVEN"; none carries a
 *     trailing number, so all three exit at the guards above it with
 *     spread:null. The smallest magnitude ESPN actually published in the
 *     sample is 1.5. Section 10 pins down where those strings really land.
 *     A fixture here would have to invent a "<TEAM> 0" string ESPN does not
 *     write, which would assert nothing except itself.
 *
 *   • RUNGS 2 AND 4 ARE NOT REACHABLE BY ANY LIVE PAYLOAD, because rung 1
 *     answers first on 408 of 408 competitions that carry a parseable line.
 *     Every fixture that exercises them therefore sets `noFlags: true`, which
 *     models a payload ESPN did not actually send in the sample window. This
 *     is deliberate: rungs 2 and 4 are defence in depth against ESPN dropping
 *     the flags, and defence in depth that is never tested is decoration. But
 *     the fixtures are SHAPES, not observations — the abbreviations, school
 *     names and odds strings in them are all real ESPN values, while the
 *     absence of the flags is synthetic. Worth re-measuring if ESPN's payload
 *     shape ever changes.
 *
 * NO LONGER APPLICABLE (2026-09-03): two earlier entries here documented dead
 * code inside rung 3 — the unreachable whole-name `includes` test, and rung
 * 3a being redundant with 3b. Rung 3 was deleted in full, so both holes are
 * gone rather than merely documented. That is the outcome this block is for:
 * a documented hole is a standing invitation to delete the code under it.
 */

import { fetchByDateRange } from './js/data-provider.js';

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else      { fail++; console.log(`  ❌ ${msg}`); }
}

// ── Fixture builders — field-for-field the shapes live ESPN returns ──────────
const DATE = '2026-09-05';
const ISO  = `${DATE}T19:00:00Z`;   // comfortably inside the range in any TZ

/** A competitor, shaped exactly like ESPN's. */
function competitor(id, homeAway, location, abbreviation, mascot) {
  return {
    id, homeAway, score: '0',
    team: { id, location, name: mascot, abbreviation,
            displayName: `${location} ${mascot}`, shortDisplayName: location },
  };
}

/**
 * Build one ESPN event.
 * `favoredSide` is ESPN's ground truth: 'home' | 'away' | null.
 * `details` is the literal odds text ESPN publishes.
 */
function event({ id, home, away, details, favoredSide, magnitude, noOdds, noFlags }) {
  const homeC = competitor(`${id}h`, 'home', home.loc, home.ab, home.mascot);
  const awayC = competitor(`${id}a`, 'away', away.loc, away.ab, away.mascot);
  const odds = noOdds ? undefined : [{
    provider: { id: '100', name: 'Draft Kings' },
    details,
    overUnder: 48.5,
    // ESPN's own signed value is home-perspective; mirror that faithfully.
    ...(magnitude == null ? {} : {
      spread: favoredSide === 'away' ? magnitude : -magnitude }),
    // `noFlags` models a payload that omits the structured favorite booleans,
    // so the fixture can exercise the fallback ladder underneath them.
    ...(noFlags ? {} : {
      homeTeamOdds: { favorite: favoredSide === 'home', underdog: favoredSide !== 'home',
                      team: { abbreviation: home.ab } },
      awayTeamOdds: { favorite: favoredSide === 'away', underdog: favoredSide !== 'away',
                      team: { abbreviation: away.ab } },
    }),
  }];
  return {
    id, date: ISO,
    name: `${away.loc} at ${home.loc}`, shortName: `${away.ab} @ ${home.ab}`,
    status: { type: { name: 'STATUS_SCHEDULED', detail: '3:00 PM ET', completed: false } },
    competitions: [{
      id, date: ISO,
      competitors: [homeC, awayC],
      venue: { fullName: 'Test Stadium', address: { city: 'Testville', state: 'CA' } },
      ...(odds ? { odds } : {}),
    }],
  };
}

/** Run the fixture slate through the real public fetch path. */
async function runSlate(events) {
  const saved = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true, status: 200, json: async () => ({ events }),
  });
  try {
    const res = await fetchByDateRange({ startDate: DATE, endDate: DATE });
    const byId = {};
    for (const g of res.games) byId[g.espnEventId] = g;
    return { res, byId };
  } finally { globalThis.fetch = saved; }
}

// ── The fixture slate ────────────────────────────────────────────────────────
// Teams, abbreviations and odds text are LIVE values pulled from ESPN's
// college-football scoreboard on 2026-09-01.
const MIAMI    = { loc: 'Miami',        ab: 'MIA',  mascot: 'Hurricanes' };
const STANFORD = { loc: 'Stanford',     ab: 'STAN', mascot: 'Cardinal'   };
const BALLST   = { loc: 'Ball State',   ab: 'BALL', mascot: 'Cardinals'  };
const OHIOST   = { loc: 'Ohio State',   ab: 'OSU',  mascot: 'Buckeyes'   };
const ECU      = { loc: 'East Carolina',ab: 'ECU',  mascot: 'Pirates'    };
const ALABAMA  = { loc: 'Alabama',      ab: 'ALA',  mascot: 'Crimson Tide' };
const SMU      = { loc: 'SMU',          ab: 'SMU',  mascot: 'Mustangs'   };
const FSU      = { loc: 'Florida State',ab: 'FSU',  mascot: 'Seminoles'  };
const CLEMSON  = { loc: 'Clemson',      ab: 'CLEM', mascot: 'Tigers'     };
const LSU      = { loc: 'LSU',          ab: 'LSU',  mascot: 'Tigers'     };
const NOTREDM  = { loc: 'Notre Dame',   ab: 'ND',   mascot: 'Fighting Irish' };
const TAMU     = { loc: 'Texas A&M',    ab: 'TA&M', mascot: 'Aggies'     };
const WISC     = { loc: 'Wisconsin',    ab: 'WIS',  mascot: 'Badgers'    };
const TEXAS    = { loc: 'Texas',        ab: 'TEX',  mascot: 'Longhorns'  };
const TEXTECH  = { loc: 'Texas Tech',   ab: 'TTU',  mascot: 'Red Raiders'};
const OREGON   = { loc: 'Oregon',       ab: 'ORE',  mascot: 'Ducks'      };
const BOISE    = { loc: 'Boise State',  ab: 'BOIS', mascot: 'Broncos'    };

const EVENTS = [
  // [1] THE REPORTED DEFECT. ESPN: awayTeamOdds.favorite === true.
  event({ id: 'E01', home: STANFORD, away: MIAMI,  details: 'MIA -24.5',
          favoredSide: 'away', magnitude: 24.5 }),
  // [2] Home-favored controls. Abbreviation does NOT match location ("osu" vs
  //     "Ohio State", "ala" vs "Alabama") — favorite was null here too, but the
  //     raw negative number happened to be RIGHT. These must not change.
  event({ id: 'E02', home: OHIOST,  away: BALLST, details: 'OSU -50.5',
          favoredSide: 'home', magnitude: 50.5 }),
  event({ id: 'E03', home: ALABAMA, away: ECU,    details: 'ALA -27.5',
          favoredSide: 'home', magnitude: 27.5 }),
  // [3] Home-favored, abbreviation DOES match ("lsu" === "LSU").
  event({ id: 'E04', home: LSU,     away: CLEMSON, details: 'LSU -10',
          favoredSide: 'home', magnitude: 10 }),
  // [4] Away-favored, abbreviation DOES match ("smu" === "SMU") — correct by
  //     luck before the fix; must stay correct after it.
  event({ id: 'E05', home: FSU,     away: SMU,     details: 'SMU -3',
          favoredSide: 'away', magnitude: 3 }),
  // [5] Away-favored, abbreviation does NOT match — the blast radius.
  event({ id: 'E06', home: TAMU,    away: NOTREDM, details: 'ND -6.5',
          favoredSide: 'away', magnitude: 6.5 }),
  event({ id: 'E07', home: OREGON,  away: BOISE,   details: 'BOIS -1.5',
          favoredSide: 'away', magnitude: 1.5 }),
  // [6] Unresolvable / no line — must be null, never a guess.
  event({ id: 'E08', home: STANFORD, away: MIAMI, details: 'Pick',
          favoredSide: null, magnitude: null }),
  event({ id: 'E09', home: STANFORD, away: MIAMI, details: 'PK',
          favoredSide: null, magnitude: null }),
  event({ id: 'E10', home: STANFORD, away: MIAMI, details: 'EVEN',
          favoredSide: null, magnitude: null }),
  event({ id: 'E11', home: STANFORD, away: MIAMI, noOdds: true }),
  // [7] Mirror of [1]: same line, home and away swapped.
  event({ id: 'E12', home: MIAMI,   away: STANFORD, details: 'MIA -24.5',
          favoredSide: 'home', magnitude: 24.5 }),
  // [8] Payload WITHOUT the structured favorite flags — isolates the
  //     abbreviation fallback, which is otherwise shadowed by the flags.
  event({ id: 'E13', home: STANFORD, away: MIAMI, details: 'MIA -24.5',
          favoredSide: 'away', magnitude: 24.5, noFlags: true }),
  // [9] Genuinely UNRESOLVABLE: no flags, and the detail text matches neither
  //     abbreviation nor either school name. This is the only fixture that
  //     reaches the fail-closed branch.
  event({ id: 'E14', home: OHIOST,  away: BALLST, details: 'XYZ -7',
          favoredSide: null, magnitude: 7, noFlags: true }),
  // [10] THE RUNG-1 ISOLATOR. `details` is "TEXAS TECH", which equals NEITHER
  //      abbreviation ("TEX" / "TTU"), so rung 2's exact match cannot resolve
  //      it and rung 4 would fail it closed. ESPN's structured flag is the only
  //      thing in the function that can answer this payload — so if rung 1 is
  //      gutted or inverted, this fixture is what goes red. E20 is its flagless
  //      twin and proves that claim inside the suite rather than by mutation.
  //      (Before 2026-09-03 this fixture isolated rung 1 a different way: the
  //      deleted school-name rung resolved it to the WRONG side. That property
  //      died with rung 3; the isolation is now "nothing below rung 1 answers
  //      at all", which is strictly stronger.)
  event({ id: 'E15', home: TEXAS,   away: TEXTECH, details: 'TEXAS TECH -3',
          favoredSide: 'away', magnitude: 3 }),
  // ── SPELLED-OUT NAMES, NO FLAGS. All three omit the structured flags AND
  //    use a `details` team part that equals neither abbreviation. Until
  //    2026-09-03 the school-name rung guessed a favorite for each of them;
  //    these three assert the honest answer instead — no spread, flagged for
  //    the commissioner. Two of them also pin rung 2's exact-match strictness,
  //    which is now the ONLY thing standing between a spelled-out name and a
  //    wrong sign. Names and abbreviations verified against live ESPN.
  // [11] "Texas Tech" spelled out, Texas away. RUNG-2 STRICTNESS GUARD: the
  //      AWAY abbreviation "TEX" is a substring of "texas tech", so relaxing
  //      rung 2's `===` to `.includes()` would hand the favorite to Texas and
  //      invent a +3 where the honest answer is null.
  event({ id: 'E16', home: TEXTECH, away: TEXAS,   details: 'Texas Tech -3',
          favoredSide: 'home', magnitude: 3, noFlags: true }),
  // [12] "Boise" — a NON-last word of "Boise State". Second, INDEPENDENT
  //      rung-2 strictness guard, on the other side: the AWAY abbreviation
  //      "BOIS" is a PREFIX of "boise", so an `.includes()` rung 2 would
  //      resolve it and invent +1.5.
  event({ id: 'E17', home: OREGON,  away: BOISE,   details: 'Boise -1.5',
          favoredSide: 'away', magnitude: 1.5, noFlags: true }),
  // [13] A two-word school name matching no abbreviation either way.
  event({ id: 'E18', home: STANFORD, away: NOTREDM, details: 'Notre Dame -6.5',
          favoredSide: 'away', magnitude: 6.5, noFlags: true }),
  // [14] THE RUNG-3 INVERSION, BY NAME. Ball State at Ohio State, "Ball State
  //      -7", no flags. Both schools end in the token "state", so rung 3a —
  //      which tests the HOME team's last token FIRST — finds "state" inside
  //      "ball state" and declares OHIO STATE favored. Truth is Ball State
  //      (away) favored by 7, i.e. +7. Rung 3a returns -7: a 14-point error
  //      with the sign backwards, which is the v0.13-v0.15 spread bug exactly.
  //      Both teams are real ESPN teams (verified in the live corpus).
  event({ id: 'E19', home: OHIOST,  away: BALLST, details: 'Ball State -7',
          favoredSide: 'away', magnitude: 7, noFlags: true }),
  // [15] E15'S FLAGLESS TWIN — byte-for-byte the same payload as E15 with the
  //      structured flags removed, and nothing else changed. E15 resolves to
  //      +3; this resolves to null. The pair is a differential proof that the
  //      +3 comes from rung 1 and from nothing underneath it, asserted in the
  //      suite rather than left to a mutation run to discover.
  //      Also a rung-2 strictness guard on the HOME side: "texas tech"
  //      contains the home abbreviation "TEX".
  event({ id: 'E20', home: TEXAS,   away: TEXTECH, details: 'TEXAS TECH -3',
          favoredSide: 'away', magnitude: 3, noFlags: true }),
];

const { res, byId } = await runSlate(EVENTS);

console.log(`\nParsed ${res.games.length} games from ${EVENTS.length} fixture events\n`);

// ═════════════════════════════════════════════════════════════════════════════
// 1. THE REPORTED DEFECT, BY NAME.
// ═════════════════════════════════════════════════════════════════════════════
console.log('[1] MIA -24.5 — Miami at Stanford. ESPN flags the AWAY team favored…');
{
  const g = byId['E01'];
  assert(!!g, 'the Miami/Stanford fixture parsed into a game at all');
  // Rule: away favored by 24.5 → home perspective is +24.5.
  assert(g.spread === 24.5,
    `AWAY (Miami) favored by 24.5 → home-perspective spread must be +24.5, got ${g.spread}` +
    (g.spread === -24.5 ? '  ← INVERTED: this reads "Stanford favored by 24.5", a 49-point error' : ''));
  assert(g.favorite === 'Miami',
    `favorite must resolve to the team ESPN flagged — 'Miami', got ${JSON.stringify(g.favorite)}`);
}

// ═════════════════════════════════════════════════════════════════════════════
// 2. HOME-FAVORED CONTROLS — the majority case. MUST NOT CHANGE.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[2] Home-favored controls — the fix must not disturb these…');
{
  const cases = [
    ['E02', -50.5, 'Ohio State', 'OSU -50.5, Ball State at Ohio State'],
    ['E03', -27.5, 'Alabama',    'ALA -27.5, East Carolina at Alabama'],
    ['E04', -10,   'LSU',        'LSU -10, Clemson at LSU'],
  ];
  for (const [id, want, wantFav, label] of cases) {
    const g = byId[id];
    assert(g && g.spread === want,
      `${label}: HOME favored → spread must be ${want}, got ${g && g.spread}`);
    assert(g && g.favorite === wantFav,
      `${label}: favorite must be '${wantFav}', got ${g && JSON.stringify(g.favorite)}`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 3. AWAY-FAVORED, ABBREVIATION MATCHES — right before, right after.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[3] Away-favored where the abbreviation happens to match the location…');
{
  const g = byId['E05'];
  assert(g && g.spread === 3,
    `SMU -3, SMU at Florida State: AWAY favored by 3 → spread must be +3, got ${g && g.spread}`);
  assert(g && g.favorite === 'SMU',
    `SMU -3: favorite must be 'SMU', got ${g && JSON.stringify(g.favorite)}`);
}

// ═════════════════════════════════════════════════════════════════════════════
// 4. AWAY-FAVORED, ABBREVIATION DOES NOT MATCH — the blast radius.
//    93.3% of ESPN's 400 published teams land in this bucket.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[4] Away-favored where the abbreviation does NOT match the location…');
{
  const cases = [
    ['E06', 6.5, 'Notre Dame', 'ND -6.5, Notre Dame at Texas A&M'],
    ['E07', 1.5, 'Boise State', 'BOIS -1.5, Boise State at Oregon'],
  ];
  for (const [id, want, wantFav, label] of cases) {
    const g = byId[id];
    assert(g && g.spread === want,
      `${label}: AWAY favored → spread must be +${want}, got ${g && g.spread}`);
    assert(g && g.favorite === wantFav,
      `${label}: favorite must be '${wantFav}', got ${g && JSON.stringify(g.favorite)}`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 5. NOTHING TO RESOLVE → null. A guess here is a graded, wrong number.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[5] Pick / PK / EVEN / absent odds → spread null, favorite null…');
{
  for (const [id, label] of [['E08','"Pick"'],['E09','"PK"'],['E10','"EVEN"'],['E11','odds absent entirely']]) {
    const g = byId[id];
    assert(g && g.spread === null,
      `${label}: no resolvable line → spread must be null (commissioner enters it), got ${g && g.spread}`);
    assert(g && g.favorite === null,
      `${label}: favorite must be null, got ${g && JSON.stringify(g.favorite)}`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 6. THE INVARIANT — a sign error dies here regardless of which team it is.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[6] Invariant: sign(spread) agrees with ESPN\'s own favorite flag…');
{
  for (const ev of EVENTS) {
    const odds = ev.competitions[0].odds?.[0];
    if (!odds) continue;
    const g = byId[ev.id];
    if (!g || g.spread === null) continue;
    const espnSaysAway = odds.awayTeamOdds?.favorite === true;
    const espnSaysHome = odds.homeTeamOdds?.favorite === true;
    if (espnSaysAway) {
      assert(g.spread > 0,
        `${ev.id} "${odds.details}": ESPN flags AWAY favored → spread must be POSITIVE, got ${g.spread}`);
    } else if (espnSaysHome) {
      assert(g.spread < 0,
        `${ev.id} "${odds.details}": ESPN flags HOME favored → spread must be NEGATIVE, got ${g.spread}`);
    }
    // Magnitude must survive whatever the sign logic does to it.
    const m = Math.abs(parseFloat(String(odds.details).match(/([-+]?\d+\.?\d*)$/)?.[1] ?? 'NaN'));
    if (!Number.isNaN(m)) {
      assert(Math.abs(g.spread) === m,
        `${ev.id} "${odds.details}": magnitude must be preserved exactly (${m}), got ${Math.abs(g.spread)}`);
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 7. MIRROR SYMMETRY — swap the sides, the sign flips, the magnitude does not.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[7] Mirror symmetry — Miami at Stanford vs Stanford at Miami…');
{
  const a = byId['E01'];   // Miami away, favored  → +24.5
  const b = byId['E12'];   // Miami home, favored  → -24.5
  assert(b && b.spread === -24.5,
    `mirror: Miami at HOME favored by 24.5 → spread must be -24.5, got ${b && b.spread}`);
  assert(a && b && a.spread === -b.spread,
    `mirror: the same line from both sides must be exact negatives — got ${a && a.spread} and ${b && b.spread}`);
  assert(a && b && a.favorite === 'Miami' && b.favorite === 'Miami',
    `mirror: Miami is the favorite in BOTH orientations, got ${a && JSON.stringify(a.favorite)} / ${b && JSON.stringify(b.favorite)}`);
}

// ══════════════════════════════════════════════════════════════════════════════
// 8. THE LADDER — rung 1 answers, rung 2 carries the rest, rung 4 stops.
//    Rung 1 (ESPN's structured booleans) shadows rung 2, so the fixtures that
//    exercise rung 2 must omit the flags. E15/E20 are a matched PAIR — the
//    same payload with and without the flags — which isolates rung 1: E15
//    resolves only because rung 1 answered, and E20 proves nothing below it
//    would have.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n[8] The ladder — rung 1 wins, rung 2 resolves, rung 4 fails closed…');
{
  const g = byId['E13'];
  assert(g && g.spread === 24.5,
    `no flags, "MIA -24.5" Miami at Stanford: the ABBREVIATION must still resolve the away favorite → +24.5, got ${g && g.spread}`);
  assert(g && g.favorite === 'Miami',
    `no flags: favorite must resolve to 'Miami' from the abbreviation, got ${g && JSON.stringify(g.favorite)}`);

  // RUNG-1 ISOLATION, asserted as a differential. "TEXAS TECH" equals neither
  // abbreviation, so rung 2 cannot answer it and rung 4 would fail it closed:
  // the ONLY reason E15 has a spread at all is that rung 1 read ESPN's flag.
  const w = byId['E15'];
  assert(w && w.spread === 3,
    `"TEXAS TECH -3", Texas Tech at Texas: ESPN's flag says AWAY favored → +3, got ${w && w.spread}` +
    (w && w.spread === null ? '  \u2190 rung 1 did not fire; nothing below it can resolve "TEXAS TECH"' : '') +
    (w && w.spread === -3 ? '  \u2190 INVERTED: rung 1 resolved the favorite to the wrong SIDE' : ''));
  assert(w && w.favorite === 'Texas Tech',
    `"TEXAS TECH -3": favorite must be 'Texas Tech', got ${w && JSON.stringify(w.favorite)}`);

  const wt = byId['E20'];
  assert(wt && wt.spread === null,
    `E20, E15's flagless twin: identical payload MINUS the flags must fail closed → null, got ${wt && wt.spread}` +
    (wt && wt.spread === 3 ? '  \u2190 something below rung 1 resolved it, so E15 no longer isolates rung 1' : '') +
    (wt && wt.spread === -3 ? '  \u2190 a -3 here means EITHER rung 2 matched the HOME abbreviation "TEX" inside "texas tech", OR rung 4 stopped failing closed and fell through to the "home favored" default' : ''));
  assert(wt && wt.favorite === null,
    `E20: favorite must be null without the flag, got ${wt && JSON.stringify(wt.favorite)}`);

  const u = byId['E14'];
  assert(u && u.spread === null,
    `no flags, "XYZ -7" matching neither abbreviation nor school name: FAIL CLOSED → spread must be null, got ${u && u.spread}` +
    (u && u.spread === -7 ? '  ← guessed HOME favored on no evidence' : ''));
  assert(u && u.favorite === null,
    `unresolvable line: favorite must be null, got ${u && JSON.stringify(u.favorite)}`);
}

// ══════════════════════════════════════════════════════════════════════════════
// 9. SPELLED-OUT NAMES MUST FAIL CLOSED — and rung 2's exact-match strictness.
//    Until 2026-09-03 a school-name rung sat between rung 2 and rung 4 and
//    GUESSED a favorite for every payload in this section. It got shared-suffix
//    and prefix matchups backwards (see the Ball State case at the end), so it
//    was deleted. These fixtures stay, inverted in meaning: they are now the
//    proof that a flagless payload no abbreviation resolves yields an honest
//    "no spread" instead of a 2x-magnitude guess.
//
//    With that rung gone, rung 2's `===` is the ONLY thing between a
//    spelled-out name and a wrong sign. E16 and E20 (away/home abbreviation as
//    a substring) and E17 (abbreviation as a prefix) pin it from three sides.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n[9] Spelled-out names fail closed; rung 2 stays an EXACT match…');
{
  const tt = byId['E16'];
  assert(tt && tt.spread === null,
    `no flags, "Texas Tech -3" Texas at Texas Tech: matches neither abbreviation ("TTU"/"TEX") → must fail closed to null, got ${tt && tt.spread}` +
    (tt && tt.spread === 3 ? '  \u2190 rung 2 matched the AWAY abbreviation "TEX" INSIDE "texas tech"' : '') +
    (tt && tt.spread === -3 ? '  \u2190 a name-matching guess is back' : ''));
  assert(tt && tt.favorite === null,
    `"Texas Tech -3": favorite must be null, got ${tt && JSON.stringify(tt.favorite)}`);

  const bs = byId['E17'];
  assert(bs && bs.spread === null,
    `no flags, "Boise -1.5" Boise State at Oregon: "boise" is not the abbreviation "BOIS" → must fail closed to null, got ${bs && bs.spread}` +
    (bs && bs.spread === 1.5 ? '  \u2190 rung 2 matched the abbreviation "BOIS" as a PREFIX of "boise"' : ''));
  assert(bs && bs.favorite === null,
    `"Boise -1.5": favorite must be null, got ${bs && JSON.stringify(bs.favorite)}`);

  const nd = byId['E18'];
  assert(nd && nd.spread === null,
    `no flags, "Notre Dame -6.5" Notre Dame at Stanford: matches neither abbreviation ("STAN"/"ND") → must fail closed to null, got ${nd && nd.spread}`);
  assert(nd && nd.favorite === null,
    `"Notre Dame -6.5": favorite must be null, got ${nd && JSON.stringify(nd.favorite)}`);

  // ── THE SHARED-SUFFIX INVERSION. Ball State at Ohio State, "Ball State -7".
  //    Rung 3a tests the HOME team's last token first: "state" (from "Ohio
  //    State") is a substring of "ball state", so it hands the favorite to the
  //    HOME team and signs the spread -7. The away team is favored; the answer
  //    is +7. Guessing the wrong SIDE is the v0.13-v0.15 spread bug.
  const bl = byId['E19'];
  assert(bl && bl.spread !== -7,
    `"Ball State -7", Ball State at Ohio State: must NEVER resolve to the HOME team, got ${bl && bl.spread}` +
    (bl && bl.spread === -7 ? '  \u2190 INVERTED: rung 3a matched the HOME last token "state" inside "ball state" and read it as "Ohio State favored by 7". Truth is +7 \u2014 a 14-point error, graded as fact' : ''));
  assert(bl && bl.spread === null,
    `"Ball State -7": no flag, and neither abbreviation matches ("BALL"/"OSU" vs "ball state") \u2192 FAIL CLOSED, spread must be null, got ${bl && bl.spread}`);
  assert(bl && bl.favorite === null,
    `"Ball State -7": favorite must be null, not a shared-suffix guess, got ${bl && JSON.stringify(bl.favorite)}`);
  assert(bl && bl.spreadSource === 'espn_unresolved',
    `"Ball State -7": must be fingerprinted 'espn_unresolved' so the commissioner is warned to set it by hand, got ${bl && JSON.stringify(bl.spreadSource)}`);
}

// ══════════════════════════════════════════════════════════════════════════════
// 10. spreadSource — THE AUDIT FINGERPRINT. Asserted on every branch that sets
//     it. This is the only field that distinguishes "ESPN gave us no resolvable
//     line" (`espn_unresolved`) from "ESPN gave us a line we trust" (`espn`).
//     Both carry spread:null vs a number, but two DIFFERENT null branches
//     (`espn_unparsed`, and the absent/"Pick" guard's `null`) are otherwise
//     indistinguishable from each other in every assertion above.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n[10] spreadSource — the audit fingerprint on every branch…');
{
  // Resolved to a real favorite, whichever rung got there → 'espn'.
  for (const id of ['E01','E02','E03','E04','E05','E06','E07','E12','E13','E15']) {
    const g = byId[id];
    assert(g && g.spreadSource === 'espn',
      `${id}: a RESOLVED line must be fingerprinted 'espn', got ${g && JSON.stringify(g.spreadSource)}`);
  }
  // Odds present, magnitude parsed, favorite unresolvable → 'espn_unresolved'.
  // E16-E20 joined this list on 2026-09-03: before the school-name rung was
  // deleted, every one of them was fingerprinted 'espn' — i.e. a guessed
  // favorite was labelled TRUSTED, which is how a wrong sign reached grading
  // without ever showing the commissioner a warning.
  for (const [id, label] of [
    ['E14','"XYZ -7", matching nothing'],
    ['E16','"Texas Tech -3", spelled-out name'],
    ['E17','"Boise -1.5", non-last word'],
    ['E18','"Notre Dame -6.5", spelled-out name'],
    ['E19','"Ball State -7", shared suffix with the home team'],
    ['E20','"TEXAS TECH -3" with the flags removed'],
  ]) {
    const g = byId[id];
    assert(g && g.spreadSource === 'espn_unresolved',
      `${id} ${label}: a line ESPN gave us but we could NOT resolve must be fingerprinted ` +
      `'espn_unresolved', got ${g && JSON.stringify(g.spreadSource)}` +
      (g && g.spreadSource === 'espn' ? '  \u2190 labelled as trusted; the commissioner loses the only signal that a human must set this spread' : ''));
  }
  // Odds present but no trailing number at all → 'espn_unparsed'.
  // NOTE: this is where ESPN's real pick'em strings land. "PK" and "EVEN"
  // carry no digits, so they never reach the magnitude === 0 branch — they
  // exit here with spread:null. See the coverage note in the file header.
  for (const [id, label] of [['E09','"PK"'], ['E10','"EVEN"']]) {
    const g = byId[id];
    assert(g && g.spreadSource === 'espn_unparsed',
      `${id} ${label}: odds present but no number to parse → 'espn_unparsed', got ${g && JSON.stringify(g.spreadSource)}`);
  }
  // The literal 'Pick' guard and a wholly absent odds object → null.
  for (const [id, label] of [['E08','"Pick" (the literal guard)'], ['E11','no odds object at all']]) {
    const g = byId[id];
    assert(g && g.spreadSource === null,
      `${id} ${label}: no line was offered → spreadSource must be null, got ${g && JSON.stringify(g.spreadSource)}`);
  }
}

// ── Result ───────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
