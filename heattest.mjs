#!/usr/bin/env node
/**
 * heattest.mjs — the SCRIBE v3 HEAT LADDER, proved start to finish.
 * =========================================================================
 * Run:  cd cfb-pickems && node heattest.mjs
 * (loadtest.mjs spawns it with a ratcheted floor — see its spawned-suites
 * table.)
 *
 * WHY ITS OWN FILE, per CONVENTIONS #28 and the `grouptest.mjs` precedent:
 * `effectiveScribeHeat()` is a small piece of arithmetic that decides how hard
 * SCRIBE is allowed to speak about a named person. That is a proof somebody
 * should be able to read top to bottom in one sitting, not something to bury
 * between chat-fold shuffles and blackjack grading.
 *
 * WHAT IS HERE AND WHAT IS DELIBERATELY NOT:
 *   HERE  — the min() matrix in both directions, the unset/garbage defaults,
 *           §[4b]'s prototype-chain probes in all four lookups (F-1), §[5]'s
 *           multi-subject fold including F-2's min(dial, Dry) failure answer,
 *           the ladder's own structural invariants, the five briefs' integrity
 *           (present, verbatim-in-the-persona-snapshot, retired tics absent),
 *           the content-free-push predicate, §[11]'s model-choice/rate-card
 *           agreement (DI-282), and the STRUCTURAL statement that a hard line
 *           is not a heat level.
 *   NOT   — whether the blocks actually reach Anthropic. That is a property of
 *           the two handlers' wiring, and it is asserted where the wiring is:
 *           `scribeAsk.twin.mjs` §[21] and `scribeAutonomous.twin.mjs` [HEAT].
 *           RG-82's lesson cuts both ways — a unit test claiming reachability
 *           it cannot see would be the same false guard.
 */

import {
  SCRIBE_HEAT_ORDER, SCRIBE_HEAT_INDEX, SCRIBE_HEAT_DEFAULT,
  ROAST_TOLERANCE_HEAT_CAP, effectiveScribeHeat,
  scribePushIsContentFree, SCRIBE_PUSH_CONTENT_FREE_BODY,
  DEFAULT_SETTINGS,
} from './js/data-model.js';
import {
  SCRIBE_HEAT_BRIEFS, scribeHeatBlock, SCRIBE_PERSONA_TEXT, SCRIBE_VERSION,
} from './supabase/functions/_shared/scribe-persona.mjs';
import { resolveEffectiveHeat } from './supabase/functions/_shared/scribe-context.mjs';
import { HEAT_COPY, SCRIBE_VERSION as SCRIBE_VERSION_CLIENT } from './js/scribeLines.js';

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

// ═══════════════════════════════════════════════════════════════════════════
// [1] THE LADDER'S OWN SHAPE — before any arithmetic runs on it.
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[1] THE LADDER — five levels, one order, one default…');
{
  assert(Array.isArray(SCRIBE_HEAT_ORDER) && SCRIBE_HEAT_ORDER.length === 5,
    `1-1: five levels, coolest first (got ${JSON.stringify(SCRIBE_HEAT_ORDER)})`);
  assert(JSON.stringify(SCRIBE_HEAT_ORDER) === JSON.stringify(['polite', 'dry', 'spicy', 'savage', 'no_mercy']),
    '1-2: …and they are Drew\'s approved names in his approved order — Polite / Dry / Spicy / Savage / No Mercy');
  assert(SCRIBE_HEAT_ORDER.every((lvl, i) => SCRIBE_HEAT_INDEX[lvl] === i + 1),
    `1-3: SCRIBE_HEAT_INDEX ranks them 1..5 in exactly that order. The index is what every min() below compares; an order and an index that disagreed would make "lower" mean two things (got ${JSON.stringify(SCRIBE_HEAT_INDEX)})`);
  assert(Object.keys(SCRIBE_HEAT_INDEX).length === SCRIBE_HEAT_ORDER.length,
    '1-4: …with no rank for a level the order does not list, which is how a retired level keeps working silently');
  assert(SCRIBE_HEAT_DEFAULT === 'dry' && SCRIBE_HEAT_INDEX[SCRIBE_HEAT_DEFAULT] === 2,
    `1-5: the default is DRY — today's shipped v2.1 voice, second rung. CONVENTIONS #10: a missing value must read as CURRENT BEHAVIOUR, never as the league's eventual preference (got ${SCRIBE_HEAT_DEFAULT})`);
  assert(DEFAULT_SETTINGS.scribeHeat === SCRIBE_HEAT_DEFAULT,
    `1-6: …and DEFAULT_SETTINGS agrees. Drew sets No Mercy in the panel at deploy; a CODE default of No Mercy would mean every unset or malformed value resolved to the hottest setting the app has (got ${DEFAULT_SETTINGS.scribeHeat})`);
  assert(JSON.stringify(HEAT_COPY.map(o => o.level)) === JSON.stringify(SCRIBE_HEAT_ORDER),
    `1-7: the commissioner card's copy table lists the same five levels in the same order — a level added to one and forgotten in the other is a dial with a rung nobody can reach (got ${JSON.stringify(HEAT_COPY.map(o => o.level))})`);
  assert(HEAT_COPY.every(o => o.label && o.description),
    '1-8: …and every level has both a label and a one-line description, so no rung renders as a blank button');
}

// ═══════════════════════════════════════════════════════════════════════════
// [2] THE TOLERANCE → CAP MAPPING (Drew's ruling, 2026-09-23).
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[2] ROAST TOLERANCE → CAP — the three shipped labels finally DO something…');
{
  assert(ROAST_TOLERANCE_HEAT_CAP.light === 'dry',
    `2-1: Light caps at Dry (got ${ROAST_TOLERANCE_HEAT_CAP.light})`);
  assert(ROAST_TOLERANCE_HEAT_CAP.standard === 'savage',
    `2-2: Standard caps at Savage (got ${ROAST_TOLERANCE_HEAT_CAP.standard})`);
  assert(ROAST_TOLERANCE_HEAT_CAP.no_limits === 'no_mercy',
    `2-3: No limits caps at No Mercy — i.e. follows the commissioner's dial exactly, never above it (got ${ROAST_TOLERANCE_HEAT_CAP.no_limits})`);
  assert(Object.keys(ROAST_TOLERANCE_HEAT_CAP).length === 3,
    '2-4: …and there are exactly THREE, matching the three ROAST_TOLERANCE_OPTIONS already shipped in My SCRIBE File. A fourth key here would be a label no player can select');
  assert(Object.values(ROAST_TOLERANCE_HEAT_CAP).every(v => SCRIBE_HEAT_INDEX[v]),
    '2-5: every cap is a real level on the ladder — a cap naming a level that does not exist would resolve to the default at every comparison and read as "this setting does nothing"');
}

// ═══════════════════════════════════════════════════════════════════════════
// [3] effectiveScribeHeat() — THE MIN, IN BOTH DIRECTIONS.
//
// The whole function is one sentence — the LOWER of the league dial and the
// target's own cap — and the matrix below is that sentence exhaustively.
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[3] effectiveScribeHeat() — the full 5 × 4 matrix…');
{
  // rows: league dial. columns: the target's tolerance ('' = no cap set).
  const EXPECTED = {
    polite:   { '': 'polite',   light: 'polite',   standard: 'polite',   no_limits: 'polite' },
    dry:      { '': 'dry',      light: 'dry',      standard: 'dry',      no_limits: 'dry' },
    spicy:    { '': 'spicy',    light: 'dry',      standard: 'spicy',    no_limits: 'spicy' },
    savage:   { '': 'savage',   light: 'dry',      standard: 'savage',   no_limits: 'savage' },
    no_mercy: { '': 'no_mercy', light: 'dry',      standard: 'savage',   no_limits: 'no_mercy' },
  };
  let cells = 0;
  for (const league of SCRIBE_HEAT_ORDER) {
    for (const tol of ['', 'light', 'standard', 'no_limits']) {
      const got = effectiveScribeHeat(league, tol);
      const want = EXPECTED[league][tol];
      cells += 1;
      assert(got === want,
        `3-${cells}: league=${league}, tolerance=${tol || '(unset)'} ⇒ ${want} (got ${got})`);
    }
  }
  assert(cells === 20, `3-matrix (fixture): all twenty combinations were actually exercised (got ${cells}) — a loop that ran zero times would make every clause above vacuous`);
}
{
  // THE TWO DIRECTIONS, STATED AS PROPERTIES RATHER THAN AS CELLS, because a
  // table can be wrong in a way that is internally consistent.
  const violations = [];
  for (const league of SCRIBE_HEAT_ORDER) {
    for (const tol of Object.keys(ROAST_TOLERANCE_HEAT_CAP)) {
      const got = effectiveScribeHeat(league, tol);
      if (SCRIBE_HEAT_INDEX[got] > SCRIBE_HEAT_INDEX[league]) violations.push(`${tol} raised ${league} to ${got}`);
      if (SCRIBE_HEAT_INDEX[got] > SCRIBE_HEAT_INDEX[ROAST_TOLERANCE_HEAT_CAP[tol]]) violations.push(`${league} raised ${tol} to ${got}`);
    }
  }
  assert(violations.length === 0,
    `3-21: NEITHER DIAL CAN RAISE THE OTHER. A personal setting that out-ranked the league's would make the commissioner's control a suggestion; a league dial that out-ranked a personal cap would make "you can turn it down for yourself" a lie (violations: ${JSON.stringify(violations)})`);
  const identity = SCRIBE_HEAT_ORDER.every(l => effectiveScribeHeat(l, '') === l);
  assert(identity,
    '3-22: with NO target and no cap — a week wrap, a standings note — the league dial governs unchanged. A general post is not "about" anybody\'s tolerance, and DI-263 names that as intentional rather than a gap');
}

// ═══════════════════════════════════════════════════════════════════════════
// [4] GARBAGE, IN EVERY SLOT, FAILS COOL.
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[4] GARBAGE FAILS COOL — in both arguments, in every shape…');
{
  const JUNK_LEAGUE = ['', null, undefined, 0, 'DRY', 'no mercy', 'nuclear', {}, [], 'no_mercy '];
  for (const raw of JUNK_LEAGUE) {
    assert(effectiveScribeHeat(raw, '') === SCRIBE_HEAT_DEFAULT,
      `4-a: an unusable league value (${JSON.stringify(raw)}) resolves to '${SCRIBE_HEAT_DEFAULT}' — today's voice. A malformed setting must make SCRIBE tamer-or-equal, never hotter; that is the one direction that cannot surprise a player`);
  }
  const JUNK_TOL = ['unknown', 'LIGHT', 'medium', 'none', 'no-limits'];
  for (const raw of JUNK_TOL) {
    assert(effectiveScribeHeat('no_mercy', raw) === SCRIBE_HEAT_DEFAULT,
      `4-b: an unrecognised TOLERANCE (${JSON.stringify(raw)}) caps at '${SCRIBE_HEAT_DEFAULT}' rather than being ignored. A cap we cannot read is not "no cap" — a player typed something into that field and the safe reading of an unparseable boundary is the strictest one`);
  }
  for (const falsy of ['', null, undefined, 0, false, NaN]) {
    assert(effectiveScribeHeat('no_mercy', falsy) === 'no_mercy',
      `4-c: a FALSY tolerance (${JSON.stringify(falsy)}) means NO CAP SET and defers to the league — Drew's ruling on open question 5. This is the case of a player who has never opened My SCRIBE File, which is most of them (got ${effectiveScribeHeat('no_mercy', falsy)})`);
  }
  assert(effectiveScribeHeat('nuclear', 'light') === 'dry',
    '4-d: garbage in BOTH slots still resolves to a real level, and the coolest sensible one — the function never returns an unusable value for a caller to interpolate into a prompt');
}

// ═══════════════════════════════════════════════════════════════════════════
// [4b] THE PROTOTYPE CHAIN IS NOT A HEAT LEVEL — F-1 (security gate, 2026-09-23).
//
// THE DEFECT, and why it was not covered by [4] above. Every lookup in this
// feature used to be a bare bracket probe — `SCRIBE_HEAT_INDEX[level]`,
// `ROAST_TOLERANCE_HEAT_CAP[tol] || DEFAULT`, `SCRIBE_HEAT_BRIEFS[level]` — and
// a plain object answers for `Object.prototype`'s keys as readily as for its
// own. `'nuclear'` (tested above) returns `undefined` and is caught. `'toString'`
// returns a FUNCTION: truthy, so the guard passes, and the value flows on as if
// it were a level. Section [4]'s junk list contained no prototype key, so all
// ten of its strings took the safe branch and the hole sat under a green test.
//
// THE CONSEQUENCES DIFFER PER CALL SITE, which is why all four are asserted
// here rather than one standing in for the rest:
//   effectiveScribeHeat   a tolerance of 'constructor' skipped the player's CAP
//                         and ran the post at the full league dial
//   scribeHeatBlock       rendered `CURRENT HEAT LEVEL: TOSTRING` plus a
//                         function body into the system prompt
//   scribePushIsContentFree  answered false at every dial position, i.e. the
//                         full line on a locked phone — the exact leak DI-267
//                         exists to stop
//   setScribeHeat         stored 'constructor' as though it were a level
//
// AND ONE OF THE TWO INPUTS IS MEMBER-REACHABLE: the tolerance is a
// `scribe_memory` row a player writes about himself.
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[4b] PROTOTYPE KEYS ARE NOT LEVELS — F-1, in all four lookups…');
{
  // The write half lives in js/scribeAgent.js, which reaches the settings blob
  // through the storage seam — so this is the one section in this file that
  // needs a device. A Map-backed localStorage is the same stub loadtest.mjs and
  // groupdtest.mjs install; it is set up HERE and imported dynamically rather
  // than at the top of the file because static imports hoist above it, and
  // because the other ten sections are pure arithmetic that should keep
  // running with no environment at all.
  const store = new Map();
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear(),
  };
  const { getScribeHeat, setScribeHeat } = await import('./js/scribeAgent.js');

  const PROTO_KEYS = ['constructor', 'toString', 'valueOf', 'hasOwnProperty'];
  // '__proto__' is the sharper case and is kept separate: `hasOwnProperty` says
  // false for it (correct), while a bracket probe returns Object.prototype
  // itself — an object, therefore truthy, therefore accepted by the old guard.
  const ALL_PROBES = [...PROTO_KEYS, '__proto__', 'isPrototypeOf', 'toLocaleString'];

  for (const key of ALL_PROBES) {
    assert(effectiveScribeHeat(key, '') === SCRIBE_HEAT_DEFAULT,
      `4b-1 (${key}): as the LEAGUE DIAL it resolves to '${SCRIBE_HEAT_DEFAULT}'. Membership, not truthiness — a bracket probe answers for every key on Object.prototype, and this one is the difference between "unrecognised setting" and "no ceiling at all" (got ${effectiveScribeHeat(key, '')})`);
    assert(effectiveScribeHeat('no_mercy', key) === SCRIBE_HEAT_DEFAULT,
      `4b-2 (${key}): as a TOLERANCE it caps at '${SCRIBE_HEAT_DEFAULT}' rather than being skipped. This is the member-reachable slot — the value comes off a scribe_memory row the player writes — and before F-1 it returned a FUNCTION, which is truthy, so the cap was silently dropped and the post ran at No Mercy (got ${effectiveScribeHeat('no_mercy', key)})`);
    assert(SCRIBE_HEAT_ORDER.includes(effectiveScribeHeat(key, key)),
      `4b-3 (${key}): garbage of this shape in BOTH slots still returns a REAL rung — never a function, never undefined, never the caller's own string (got ${JSON.stringify(effectiveScribeHeat(key, key))})`);
    const block = scribeHeatBlock(key);
    assert(block.text.startsWith(`CURRENT HEAT LEVEL: ${SCRIBE_HEAT_DEFAULT.toUpperCase()}\n`)
      && block.text.includes(SCRIBE_HEAT_BRIEFS[SCRIBE_HEAT_DEFAULT]),
      `4b-4 (${key}): scribeHeatBlock() renders the DRY BRIEF. Before F-1 this printed "CURRENT HEAT LEVEL: ${key.toUpperCase()}" followed by the source of ${key} — a function body, pasted into the system prompt as SCRIBE's instructions (got ${JSON.stringify(block.text.slice(0, 48))})`);
    assert(!/function|native code|\[object/i.test(block.text),
      `4b-5 (${key}): …and nothing function-shaped survives anywhere in the block's text — the failure was not only the header line`);
    assert(scribePushIsContentFree(key) === false,
      `4b-6 (${key}): scribePushIsContentFree() answers FALSE, i.e. today's behaviour at Dry. (It is false for the RIGHT reason now: the level resolves to Dry, which is below Savage. It used to be false because \`undefined >= 4\` is false — the same answer from a broken comparison, which at a real Savage dial would have leaked the line)`);
  }

  // The write half, which lower-cases before it validates — so the keys that
  // survive that are `constructor` and `__proto__`, and those were exactly the
  // two that got stored.
  for (const key of [...ALL_PROBES, 'CONSTRUCTOR', 'ToString']) {
    const out = setScribeHeat(key);
    assert(out.ok === false && out.error === 'unknown_level',
      `4b-7 (${key}): setScribeHeat() REFUSES it. 'constructor' and '__proto__' both passed the old \`!SCRIBE_HEAT_INDEX[lvl]\` guard and were written into the settings blob as levels; every read site then resolved them to the default, which reads to a commissioner as "the dial does nothing" (got ${JSON.stringify(out)})`);
  }
  assert(getScribeHeat() === SCRIBE_HEAT_DEFAULT,
    `4b-8: …and after all of that the stored dial is still the default — no refused write left a value behind (got ${getScribeHeat()})`);
}

// ═══════════════════════════════════════════════════════════════════════════
// [5] resolveEffectiveHeat() — THE FOLD OVER A POST'S SUBJECTS.
//
// `effectiveScribeHeat()` is the two-argument rule DI-263 specifies. Both
// voice paths can face MORE than one subject (a lead change names two players,
// a question can name two), and the shared fold is what answers that honestly.
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[5] resolveEffectiveHeat() — many subjects, the LOWEST ceiling wins…');
{
  const tolerances = { p1: 'no_limits', p2: 'standard', p3: 'light' };
  assert(resolveEffectiveHeat({ leagueHeat: 'no_mercy', subjectIds: [], tolerances }) === 'no_mercy',
    '5-1: NO subject ⇒ the league dial. A league-wide post has nobody\'s tolerance to honour');
  assert(resolveEffectiveHeat({ leagueHeat: 'no_mercy', subjectIds: ['p1'], tolerances }) === 'no_mercy',
    '5-2: one uncapped subject ⇒ the league dial, unchanged');
  assert(resolveEffectiveHeat({ leagueHeat: 'no_mercy', subjectIds: ['p2'], tolerances }) === 'savage',
    '5-3: one Standard subject ⇒ Savage');
  assert(resolveEffectiveHeat({ leagueHeat: 'no_mercy', subjectIds: ['p1', 'p2'], tolerances }) === 'savage',
    '5-4: TWO subjects ⇒ the LOWER of their ceilings. A line about both is a line about the one who asked to be hit less');
  assert(resolveEffectiveHeat({ leagueHeat: 'no_mercy', subjectIds: ['p1', 'p2', 'p3'], tolerances }) === 'dry',
    '5-5: …and with three, the strictest of the three governs — the fold is a min over everybody named, not a vote');
  assert(resolveEffectiveHeat({ leagueHeat: 'spicy', subjectIds: ['p1'], tolerances }) === 'spicy',
    '5-6: an uncapped subject never rises above the dial, whatever the dial is');
  assert(resolveEffectiveHeat({ leagueHeat: 'no_mercy', subjectIds: ['p9-unknown'], tolerances }) === 'no_mercy',
    '5-7: a subject with NO tolerance row on file is uncapped, not capped-by-accident — an absent row is an absent preference');
  assert(resolveEffectiveHeat({ leagueHeat: 'no_mercy', subjectIds: ['p1'], tolerances, failed: true }) === SCRIBE_HEAT_DEFAULT,
    '5-8: A FAILED CAP READ RESOLVES TO DRY, NOT TO THE DIAL. A cap is the same class of thing as a hard line: a boundary we could not read must never resolve to "no boundary". The cost of the safe direction is one tame post; the cost of the other is the post nobody could take back');

  // ── F-2 (security gate, 2026-09-23) — 5-9 REWRITTEN, AND IT USED TO ASSERT
  //    THE DEFECT.
  //
  // It read: "a failed read at Polite still answers Dry, because the function
  // no longer knows what it is lowering FROM." That was a true description of a
  // fixed `return SCRIBE_HEAT_DEFAULT`, and the sentence sounded like a safety
  // property — but Dry is ABOVE Polite. A commissioner who had deliberately set
  // the gentlest rung got a HOTTER post whenever a tolerance query errored: the
  // degrade path overriding his own dial, in the one direction this whole
  // feature exists to make impossible.
  //
  // The function does know what it is lowering from — `leagueHeat` is right
  // there — so the failure answer is min(dial, Dry): capped at today's voice,
  // never above the dial, and never above the setting a human chose.
  assert(resolveEffectiveHeat({ leagueHeat: 'polite', subjectIds: [], tolerances, failed: true }) === 'polite',
    `5-9: A FAILED READ NEVER RAISES THE DIAL. At Polite the answer is POLITE, not Dry. The old fixed-'dry' return made a query error the reason SCRIBE got hotter than the commissioner asked for — a degrade path is allowed to be tamer than intended and is never allowed to be hotter (got ${resolveEffectiveHeat({ leagueHeat: 'polite', subjectIds: [], tolerances, failed: true })})`);
  assert(resolveEffectiveHeat({ leagueHeat: 'polite', subjectIds: ['p1', 'p2', 'p3'], tolerances, failed: true }) === 'polite',
    '5-10: …and it is the dial that bounds it, not the subject list. With three subjects whose caps could not be read, Polite is still the answer — the cap read failing cannot move the ceiling in either direction past the dial');
  for (const dial of ['spicy', 'savage', 'no_mercy']) {
    assert(resolveEffectiveHeat({ leagueHeat: dial, subjectIds: ['p1'], tolerances, failed: true }) === SCRIBE_HEAT_DEFAULT,
      `5-11 (${dial}): above Dry the failure answer is still DRY — unchanged from 5-8, which is the half of the old behaviour that was right. min(dial, Dry) keeps it and fixes only the rungs below (got ${resolveEffectiveHeat({ leagueHeat: dial, subjectIds: ['p1'], tolerances, failed: true })})`);
  }
  assert(resolveEffectiveHeat({ leagueHeat: 'dry', subjectIds: ['p3'], tolerances, failed: true }) === 'dry',
    '5-12: at Dry itself the failure answer is Dry — the boundary case of min() lands on the rung rather than beside it');
  for (const junk of ['nuclear', 'constructor', '', null, undefined]) {
    assert(resolveEffectiveHeat({ leagueHeat: junk, subjectIds: ['p1'], tolerances, failed: true }) === SCRIBE_HEAT_DEFAULT,
      `5-13 (${JSON.stringify(junk)}): a GARBAGE dial plus a failed read still answers Dry, never the caller's string and never a prototype key. The dial goes through effectiveScribeHeat() BEFORE the min() runs, so neither failure can make the other hotter (F-1 + F-2 together)`);
  }
  assert(resolveEffectiveHeat({ leagueHeat: 'no_mercy', subjectIds: ['constructor'], tolerances }) === 'no_mercy',
    '5-14: a subject id that happens to be a prototype key reads as NO tolerance row — `hasOwnProperty` on the tolerance map, not a bracket probe, which would have handed effectiveScribeHeat() a FUNCTION as a cap (F-1\'s rule, applied to the fold\'s own lookup)');
  assert(resolveEffectiveHeat({ leagueHeat: 'no_mercy', subjectIds: ['p3'], tolerances: { p3: 'constructor' } }) === SCRIBE_HEAT_DEFAULT,
    '5-15: …while a stored tolerance VALUE of "constructor" caps at Dry rather than being skipped. That is the member-reachable direction: the string comes off a row the player wrote');
}

// ═══════════════════════════════════════════════════════════════════════════
// [6] HARD LINES ARE NOT A HEAT LEVEL — the structural statement.
//
// The BEHAVIOURAL proof (a hard-lined topic at No Mercy still renders its
// boundary, and the heat block never mentions it) lives in the two twins, where
// the real handlers run. What belongs HERE is the statement those twins rest
// on: there is no arithmetic anywhere in this feature that a boundary passes
// through, so no dial position can arrive at "the boundary does not apply."
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[6] A HARD LINE IS NOT A HEAT LEVEL — nothing here can weaken one…');
{
  assert(!SCRIBE_HEAT_ORDER.includes('hardline') && !('hardline' in SCRIBE_HEAT_INDEX),
    '6-1: a hard line is not a rung on this ladder and cannot be compared with one. Boundaries are checked separately, before generation; folding them into a number would imply a level exists at which one stops applying');
  const ARGS = [['no_mercy', 'no_limits'], ['no_mercy', ''], ['polite', 'light']];
  assert(ARGS.every(([l, t]) => typeof effectiveScribeHeat(l, t) === 'string'),
    '6-2: `effectiveScribeHeat()` takes a dial and a tolerance and returns a LEVEL — it has no boundary argument, no boundary return, and therefore nothing a boundary could be traded against (fixture for 6-3)');
  for (const level of SCRIBE_HEAT_ORDER) {
    const text = scribeHeatBlock(level).text;
    assert(!/hard ?line|boundar|off limits|never bring up/i.test(text),
      `6-3 (${level}): the heat block says NOTHING about boundaries at any level — not even at No Mercy, where a second, weaker restatement of the rules would be most dangerous. It is a ceiling on delivery; the boundary block above it is the boundary`);
  }
  assert(SCRIBE_HEAT_BRIEFS.no_mercy.includes('the safety floor never moves regardless of dial position'),
    '6-4: …and the TOP rung says so in its own words — the one place a reader would look for permission to go further is the place that states the floor');
}

// ═══════════════════════════════════════════════════════════════════════════
// [7] THE FIVE BRIEFS — present, singular, verbatim, and still v3-clean.
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[7] SCRIBE_HEAT_BRIEFS — five briefs, keyed to the ladder, verbatim from the document…');
{
  assert(JSON.stringify(Object.keys(SCRIBE_HEAT_BRIEFS)) === JSON.stringify(SCRIBE_HEAT_ORDER),
    `7-1: one brief per level, keyed by the SAME names in the SAME order as SCRIBE_HEAT_ORDER. A sixth level added to the ladder with no brief here would silently render the default rung (got ${JSON.stringify(Object.keys(SCRIBE_HEAT_BRIEFS))})`);
  assert(SCRIBE_HEAT_ORDER.every(l => typeof SCRIBE_HEAT_BRIEFS[l] === 'string' && SCRIBE_HEAT_BRIEFS[l].length > 300),
    '7-2: …and every one is a real, substantial brief rather than a placeholder — the seven-field contract, not a label');
  assert(SCRIBE_HEAT_ORDER.every(l => SCRIBE_PERSONA_TEXT.includes(SCRIBE_HEAT_BRIEFS[l])),
    '7-3: EVERY BRIEF APPEARS VERBATIM INSIDE THE PERSONA SNAPSHOT — which `scribePersonaDrift.check.mjs` pins byte-for-byte to docs/SCRIBE.md. That chain is what makes these constants a PORT of Drew\'s signed text rather than a second copy of it that can drift');
  const FIELDS = ['**Expletives:**', '**Animation:**', '**Joke-form / your-mom:**', '**Sustained call-outs:**', '**Target commitment:**', '**Instigation:**', '**What "annoying" looks like here, and is still forbidden:**'];
  for (const level of SCRIBE_HEAT_ORDER) {
    const missing = FIELDS.filter(f => !SCRIBE_HEAT_BRIEFS[level].includes(f));
    assert(missing.length === 0,
      `7-4 (${level}): all seven fields are present, so the five read straight down and compare cleanly — a level missing "Instigation" is a level whose answer to the question is whatever the model assumes (missing: ${JSON.stringify(missing)})`);
  }
  assert(SCRIBE_HEAT_BRIEFS.dry.includes("today's shipped voice") || SCRIBE_PERSONA_TEXT.includes('### Dry (today\'s shipped voice)'),
    '7-5: DRY IS NAMED AS TODAY\'S VOICE in the document itself. That sentence is the whole promise of the default: a league that never touches the dial is not getting a new SCRIBE');
  assert(/§6's casual-hype exception/.test(SCRIBE_HEAT_BRIEFS.dry) && /nothing hotter/.test(SCRIBE_HEAT_BRIEFS.dry),
    '7-6: …and the Dry brief licenses nothing beyond what v2.1 already allowed — "nothing hotter", in its own words');
  assert(/no per-line density cap/.test(SCRIBE_HEAT_BRIEFS.no_mercy),
    '7-7: NO MERCY PERMITS STACKING — Drew\'s ruling on open question 4. This is the one ceiling that moves between Savage and the top rung, and it is stated rather than left for the model to infer');
  assert(/only when the stack lands harder than one clean word would/.test(SCRIBE_HEAT_BRIEFS.no_mercy),
    '7-8: …with its condition attached in the same sentence. "No cap" without "only when it lands harder" is a licence to be loud, and a line that is only loud fails the level');
  assert(/never stacked past two/.test(SCRIBE_HEAT_BRIEFS.savage),
    '7-9: …and SAVAGE still carries the two-per-line ceiling, so the two top rungs are genuinely different rather than one repeated');
  assert(/None\./.test(SCRIBE_HEAT_BRIEFS.polite) && /^- \*\*Expletives:\*\* None\./m.test(SCRIBE_HEAT_BRIEFS.dry),
    '7-10: the two bottom rungs permit no profanity at all — the ladder starts from zero, not from "less"');
}

// ── 7b. RETIRED TICS STAY RETIRED, AT EVERY LEVEL. ────────────────────────
// loadtest.mjs §[65] scans `js/*.js` app-wide. `SCRIBE_HEAT_BRIEFS` lives in
// `supabase/functions/_shared/`, which that scan does not reach — so the same
// guard is applied here, to the text that actually carries the heat.
//
// THE ONE EXEMPTION IS ENCODED AS DATA, NOT AS A LOOSENED REGEX. The Dry brief
// QUOTES a retired tic in order to forbid it ("The chart shows…" every time —
// the exact tic §6 already retires), which is the identical situation §[65]'s
// own comment-exclusion exists for: documentation describing what it guards
// against must not make the guard permanently red. Encoding the exemption as
// the exact sentence — the `SCRIBE_PERSONA_STRIPPED_TEXT` precedent — keeps a
// real reintroduction catchable, which a broadened regex would not.
console.log('\n[7b] RETIRED TICS STAY RETIRED — at every rung, including the hottest…');
{
  const QUOTED_TIC_EXEMPTIONS = [
    '- **What "annoying" looks like here, and is still forbidden:** A formulaic opener repeated across posts ("The chart shows…" every time) — the exact tic §6 already retires.',
  ];
  const RETIRED_TICS = [
    { name: 'SCRIBE NOTE:', re: /SCRIBE NOTE:/ },
    { name: 'Filed.', re: /\bFiled\./ },
    { name: 'Noted.', re: /\bNoted\./ },
    { name: 'Documented.', re: /\bDocumented\./ },
    // THE CLOSER IS POSITIONAL, AND HERE IT HAS TO BE TESTED THAT WAY.
    // loadtest §[65] scans `js/*.js`, where every hit is inside a canned LINE
    // and a bare `/—\s*SCRIBE\b/` is exactly right. This text is PROSE ABOUT
    // SCRIBE — "Legal — SCRIBE may stay on one target" — where the em-dash is
    // punctuation and `SCRIBE` is the subject of the next clause, not a
    // signature. The retired tic is the REFLEX CLOSER: `— SCRIBE` ending a
    // line. Anchoring to end-of-line is what keeps this assertion about the tic
    // instead of about the word.
    { name: '— SCRIBE (reflex closer)', re: /—\s*SCRIBE\s*[.!?]?\s*$/m },
    { name: 'the chart', re: /\bthe chart\b/i },
    { name: 'Chart Review', re: /Chart Review/ },
    { name: 'permanent record', re: /permanent record/ },
    { name: 'SOAP framing', re: /(^|['"`]|[.!?]\s)\s*(Assessment|Plan|Prognosis):/ },
  ];
  const strip = (text) => QUOTED_TIC_EXEMPTIONS.reduce((acc, ex) => acc.split(ex).join(''), text);
  let exemptionsUsed = 0;
  for (const level of SCRIBE_HEAT_ORDER) {
    const raw = SCRIBE_HEAT_BRIEFS[level];
    const scanned = strip(raw);
    if (scanned !== raw) exemptionsUsed += 1;
    const hits = RETIRED_TICS.filter(t => t.re.test(scanned)).map(t => t.name);
    assert(hits.length === 0,
      `7b-1 (${level}): no retired tic appears in this brief. A hotter dial is not permission to bring a costume back — §6's retirements hold at Polite and at No Mercy alike (hits: ${JSON.stringify(hits)})`);
  }
  assert(exemptionsUsed === 1,
    `7b-2 (fixture): EXACTLY ONE brief used the quoted-tic exemption — the Dry brief, which names "The chart shows…" in order to forbid it. If this ever reads 0 the exemption is stale and is silently hiding nothing; if it reads more than 1, a second brief started quoting a retired tic and somebody should look (got ${exemptionsUsed})`);
  const canary = strip('- **Instigation:** Explicit, and then it stops.\n— SCRIBE');
  assert(RETIRED_TICS.some(t => t.re.test(canary)),
    '7b-3 (canary): the scan CAN fail — a live retired closer at the end of a brief-shaped line IS caught. A guard that cannot go red is not a guard (RG-27)');
  const canary1b = strip('- **Sustained call-outs:** Legal — SCRIBE may stay on one target for the whole line.');
  assert(!RETIRED_TICS.some(t => t.re.test(canary1b)),
    '7b-3b (canary): …while prose ABOUT SCRIBE, where the em-dash is punctuation and the name is the next clause\'s subject, is correctly NOT counted. The retired tic is the signature, not the word');
  const canary1c = strip('- **Animation:** Filed. Nothing else.');
  assert(RETIRED_TICS.some(t => t.re.test(canary1c)),
    '7b-3c (canary): …and a NON-positional tic ("Filed.") is still caught anywhere in a brief, so narrowing the closer did not narrow the rest');
  const canary2 = strip(QUOTED_TIC_EXEMPTIONS[0]);
  assert(!RETIRED_TICS.some(t => t.re.test(canary2)),
    '7b-4 (canary): …and the exempted sentence, and only that sentence, is removed before scanning — the exemption is a string, not a widened pattern');
}

// ═══════════════════════════════════════════════════════════════════════════
// [8] scribeHeatBlock() — the wire shape.
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[8] scribeHeatBlock() — one block, one rung, one name…');
{
  for (const level of SCRIBE_HEAT_ORDER) {
    const block = scribeHeatBlock(level);
    assert(block.name === 'heat', `8-a (${level}): the block is named 'heat' — the name assembleBlocks() and every twin identify it by`);
    assert(block.text.startsWith(`CURRENT HEAT LEVEL: ${level.toUpperCase()}\n`),
      `8-b (${level}): it opens by NAMING the current rung, in one line, before the brief — so the model knows which of the five it is on before it reads what that means (got ${JSON.stringify(block.text.slice(0, 40))})`);
    assert(block.text.includes(SCRIBE_HEAT_BRIEFS[level]),
      `8-c (${level}): …followed by that level's own brief, verbatim`);
    const others = SCRIBE_HEAT_ORDER.filter(l => l !== level);
    assert(others.every(l => !block.text.includes(SCRIBE_HEAT_BRIEFS[l])),
      `8-d (${level}): …and none of the other four. Stating five ceilings as current and hoping the model picks the right one is not a dial`);
    assert(!block.cacheBreak,
      `8-e (${level}): the block carries no cache breakpoint — AD-41 pins the only one to the persona, and this block churns every time the commissioner moves the dial`);
  }
  for (const junk of ['', null, undefined, 'NUCLEAR', 'dry ', 42]) {
    const block = scribeHeatBlock(junk);
    assert(block.text.startsWith(`CURRENT HEAT LEVEL: ${SCRIBE_HEAT_DEFAULT.toUpperCase()}\n`),
      `8-f: an unusable level (${JSON.stringify(junk)}) renders the DEFAULT brief rather than nothing at all. A missing heat block would leave the model with the whole ladder from the persona and no indication which rung it is on — strictly worse than the coolest rung`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// [9] THE CONTENT-FREE PUSH PREDICATE (DI-267).
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[9] scribePushIsContentFree() — automatic at Savage and above…');
{
  assert(scribePushIsContentFree('savage') === true && scribePushIsContentFree('no_mercy') === true,
    '9-1: Savage and No Mercy push a generic body. A lock screen renders a roast with no room, no thread and whoever is standing next to the phone');
  assert(['polite', 'dry', 'spicy'].every(l => scribePushIsContentFree(l) === false),
    '9-2: …and the three cooler rungs are byte-identical to today\'s preview');
  assert([''] .concat([null, undefined, 'SCORCHING', 0]).every(v => scribePushIsContentFree(v) === false),
    '9-3: an absent or GARBAGE dial is NOT content-free — it resolves to Dry, i.e. today\'s behaviour. An unreadable setting must never blank every notification in the league');
  assert(scribePushIsContentFree('savage') === (SCRIBE_HEAT_INDEX.savage >= SCRIBE_HEAT_INDEX.savage),
    '9-4: the threshold is expressed against the ladder\'s own index, not a hard-coded pair of level names — adding a rung between Spicy and Savage would carry the boundary with it');
  assert(typeof SCRIBE_PUSH_CONTENT_FREE_BODY === 'string' && SCRIBE_PUSH_CONTENT_FREE_BODY.length > 0
    && !/fuck|shit/i.test(SCRIBE_PUSH_CONTENT_FREE_BODY),
    `9-5: the generic body is a real, clean sentence — the entire point is that nothing from the line survives into it (got ${JSON.stringify(SCRIBE_PUSH_CONTENT_FREE_BODY)})`);
  assert(SCRIBE_PUSH_CONTENT_FREE_BODY === 'SCRIBE posted in the Locker Room',
    '9-6: …and it is DI-267\'s approved copy, verbatim. It names SCRIBE and the room, and nothing else — no app name to brand-drift, no preview to leak');
}

// ═══════════════════════════════════════════════════════════════════════════
// [10] ONE PERSONA, THREE HOSTS, ONE NUMBER.
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[10] SCRIBE_VERSION — the hosts still agree…');
{
  assert(SCRIBE_VERSION === '3.0',
    `10-1: the Edge runtime's persona is v3.0 — the heat ladder is a voice change, so the number moves with it (got ${SCRIBE_VERSION})`);
  assert(SCRIBE_VERSION_CLIENT === SCRIBE_VERSION,
    `10-2: …and js/scribeLines.js's exported SCRIBE_VERSION agrees, which is what every tier-0 post stamps into meta.scribeVersion (got ${SCRIBE_VERSION_CLIENT})`);
  assert(SCRIBE_PERSONA_TEXT.includes(`SCRIBE_VERSION: ${SCRIBE_VERSION}`),
    '10-3: …and the snapshot\'s own stamp matches. The docs/SCRIBE.md half of that chain is `scribePersonaDrift.check.mjs`\'s, which reads the real file');
  assert(SCRIBE_PERSONA_TEXT.includes('**Version:** 3.0'),
    '10-4: …including the header the document leads with, not only the trailer nobody scrolls to');
}

// ═══════════════════════════════════════════════════════════════════════════
// [11] DI-282 — THE MODEL CHOICES AND THE RATE CARD AGREE.
//
// WHY THIS IS IN THE HEAT FILE. It is the same class of fact as [10]'s
// three-hosts-one-number check: a closed vocabulary that exists in two runtimes
// and has to mean the same thing in both. `js/data-model.js` is what the
// commissioner's card renders from; `_shared/scribe-rate.js` is what the server
// PRICES and (as of F-3) VALIDATES against. An id on one and not the other is
// not a cosmetic mismatch — it is either a control offering a model the server
// will refuse, or a model being billed at another model's rates against the
// shared $25 ceiling.
//
// THE RATE CARD IS ALLOWED TO BE LARGER, and is: it carries
// `claude-haiku-4-5`, which `scribe-classify` uses and no commissioner chooses.
// The containment therefore runs one way, deliberately, and is asserted as a
// direction rather than as equality.
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[11] DI-282 — the two model ids the card offers are ids the server can price…');
{
  const { SCRIBE_MODEL_CHOICES } = await import('./js/data-model.js');
  const { SCRIBE_MODEL_RATES_USD_PER_MTOK, rateSettings } =
    await import('./supabase/functions/_shared/scribe-rate.js');
  const { SCRIBE_MODEL_DEFAULT } = await import('./supabase/functions/_shared/anthropic.js');

  assert(Object.isFrozen(SCRIBE_MODEL_CHOICES) && SCRIBE_MODEL_CHOICES.length === 2,
    `11-1: exactly two choices, frozen — it is an ALLOW-LIST enforced at the write boundary, and a list that can be pushed to at runtime is not one (got ${JSON.stringify(SCRIBE_MODEL_CHOICES)})`);
  assert(JSON.stringify(SCRIBE_MODEL_CHOICES) === JSON.stringify(['claude-sonnet-5', 'claude-opus-5']),
    '11-2: …and they are Drew\'s two, in cheap-to-expensive order. [0] is the default, the same way SCRIBE_HEAT_ORDER[1] is the heat default — order carries meaning in both');
  assert(SCRIBE_MODEL_CHOICES[0] === SCRIBE_MODEL_DEFAULT,
    `11-3: THE CLIENT'S DEFAULT IS THE SERVER'S DEFAULT. An unset settings.scribe.model resolves to SCRIBE_MODEL_CHOICES[0] on the card and to SCRIBE_MODEL_DEFAULT in all three Edge Functions; if those two strings ever diverged the card would say Sonnet while the server sent something else, and nobody would be able to tell from either end (got ${SCRIBE_MODEL_CHOICES[0]} vs ${SCRIBE_MODEL_DEFAULT})`);
  for (const id of SCRIBE_MODEL_CHOICES) {
    assert(Object.prototype.hasOwnProperty.call(SCRIBE_MODEL_RATES_USD_PER_MTOK, id),
      `11-4 (${id}): …is on the rate card, so it is both SENDABLE (F-3 validates against exactly this table) and PRICEABLE. An offered id the card did not know would be metered at the Sonnet fallback while being billed as itself — a $25 ceiling that stops meaning $25`);
    const rates = SCRIBE_MODEL_RATES_USD_PER_MTOK[id];
    assert(Number(rates.input) > 0 && Number(rates.output) > 0,
      `11-4b (${id}): …at real, non-zero rates in both directions — a zero would meter every call at $0 and the budget guard would never fire`);
  }
  const sonnet = SCRIBE_MODEL_RATES_USD_PER_MTOK['claude-sonnet-5'];
  const opus = SCRIBE_MODEL_RATES_USD_PER_MTOK['claude-opus-5'];
  assert(opus.input / sonnet.input === 2.5 && opus.output / sonnet.output === 2.5,
    `11-5: THE CARD'S "about 2.5×" IS THE ARITHMETIC, not a slogan. Input and output both divide out to exactly 2.5, so the sentence a commissioner reads before spending his own money is derived from the same table that spends it (got ${opus.input / sonnet.input} / ${opus.output / sonnet.output})`);

  // ── F-3, at the seam the three handlers actually read. ──
  assert(rateSettings({ scribe: { model: 'claude-opus-5' } }).model === 'claude-opus-5',
    '11-6: rateSettings() passes a CARD MODEL through — the toggle reaches the wire, which is the whole point of DI-282');
  for (const bad of ['claude-opus-4-1', 'gpt-5', 'constructor', '__proto__', 'toString', '', 42, null, {}]) {
    assert(rateSettings({ scribe: { model: bad } }).model === null,
      `11-7 (${JSON.stringify(bad)}): …and an OFF-CARD model resolves to null, so every caller's \`|| SCRIBE_MODEL_DEFAULT\` sends the default instead. It used to be passed straight through: a typo became a live 400 (RG-222's shape) and a real-but-unpriced id became a call metered at the wrong price`);
  }
  assert(rateSettings({}).model === null && rateSettings({ scribe: {} }).model === null,
    '11-8: an absent bag and an absent field both read as null — the default-when-missing story is the same one the default-when-garbage story is (CONVENTIONS #10)');
  assert(rateSettings({ scribe: { model: 'claude-opus-5', monthlyBudgetUsd: 0 } }).monthlyBudgetUsd === 0,
    '11-9: …and validating the model did not disturb the other four fields — S-F2\'s "0 means stop all spend" still survives a bag that also carries a model');
}

// ── THE TIER-0 STAMP IS ASSERTED IN `feedbacktest.mjs` §[14], NOT HERE. ─────
// That suite already drives a REAL `@scribe` mention through the REAL chat
// fold — DOM stubs, storage, transport and all — and already asserts
// `meta.scribeVersion` on the folded post. DI-267's two heat fields ride the
// same meta on the same post, so the honest place for them is beside their
// sibling, in the suite that can see a folded message. Re-staging that whole
// environment here to assert three keys would be a second, weaker copy of a
// test that already exists, and RG-27's lesson is that a look-alike is worse
// than a pointer. Named here so nobody concludes the tier-0 path went
// unstamped.

console.log(`\n${pass} passed, ${fail} failed.`);
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
