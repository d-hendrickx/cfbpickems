/**
 * CFB Pickems — tbdtest.mjs
 * =========================
 * Regression suite for RG: "a bunch of the games say time tbd when there for
 * sure is a set time" (Drew, commissioner, 2026-09-03, against the live
 * Sep 3-7 slate).
 *
 * Run:  node tbdtest.mjs
 * Also: TZ=UTC node tbdtest.mjs && TZ=America/Los_Angeles node tbdtest.mjs
 *
 * WHAT WENT WRONG
 * ---------------
 * parseAndReport() classified a kickoff as "date set, time TBD" by inspecting
 * the UTC clock of event.date:
 *
 *     const isMidnightPlaceholder =
 *       d.getUTCHours()===0 && d.getUTCMinutes()===0 && d.getUTCSeconds()===0;
 *
 * That is wrong in BOTH directions, and it also leaks a third state:
 *
 *  (a) FALSE TBD. 00:00Z is 8:00 PM EDT — one of college football's most
 *      common kickoff slots. In Drew's real Sep 3-7 payload, 10 of 91 games
 *      sit at exactly 00:00:00Z and every one is a genuine scheduled 8:00 PM
 *      ET kickoff (UTEP @ OU among them — an Oklahoma alma-mater game, so
 *      guaranteed onto the slate by the +100 Tier-1 bonus).
 *
 *  (b) FALL-THROUGH. When isMidnightPlaceholder is true AND the detail string
 *      DOES contain a time — exactly those 10 games — the first branch's
 *      condition is false and the `else if (!isMidnightPlaceholder)` is also
 *      false. NEITHER branch runs. kickoffConfirmed keeps its initialised
 *      `false` and kickoffDateOnly stays `false`, so the game is neither
 *      "confirmed" nor "date only" — an unintended third state that renders
 *      as TBD anyway. Widening the placeholder test alone would NOT close it.
 *
 *  (c) MISSED TBD (the mirror defect, not in Drew's report but the same
 *      line of code). ESPN's real placeholder is midnight EASTERN, which is
 *      04:00Z in EDT season and 05:00Z in EST season — never 00:00Z. So a
 *      genuine TBD failed the midnight-UTC test, fell into the `else if`,
 *      and was marked CONFIRMED — rendering a fabricated midnight-ET kickoff
 *      as if it were a real scheduled time. 409 of 1197 events in the
 *      captured corpus.
 *
 * WHY NO TIMESTAMP HEURISTIC CAN WORK (section 5)
 * -----------------------------------------------
 * Sacramento State @ Hawaii, 2026-11-29T04:00Z, is a REAL 11:00 PM EST
 * kickoff. Its getUTCHours/Minutes/Seconds are byte-identical to the 235
 * genuine 04:00Z placeholders in the corpus. No rule reading only the
 * timestamp can separate them. The fix therefore reads ESPN's own structured
 * boolean, competitions[].timeValid — present on 1197/1197 captured events —
 * exactly as extractSpread() was made to read ESPN's structured odds flags
 * after its hand-rolled string heuristic inverted spread signs for a season
 * (93e5f6c).
 *
 * FIXTURE DISCIPLINE
 * ------------------
 * 1. Every fixture is copied from the shape of a REAL captured ESPN event
 *    (ids, dates and detail strings preserved), not invented.
 * 2. Every negative assertion ("does not say Time TBD") is paired with a
 *    same-fixture positive check that the render path actually emitted the
 *    game — so the assertion cannot pass vacuously.
 * 3. Assertions run against the player-facing rendered string, not only the
 *    parsed flag. The rendered string is the bug Drew reported.
 * 4. The mutation battery (section M) includes INVERSIONS, not just
 *    deletions, and mutates a COPY under os.tmpdir(). It never writes to real
 *    source under cfb-pickems/.
 */

import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// ── DOM / localStorage stubs (slatetest.mjs / gradetest.mjs shape) ───────────
const _store = new Map();
globalThis.localStorage = {
  getItem: k => (_store.has(k) ? _store.get(k) : null),
  setItem: (k, v) => _store.set(k, String(v)),
  removeItem: k => _store.delete(k),
  clear: () => _store.clear(),
};
function makeEl(id) {
  return {
    id, value: '', checked: false, textContent: '', innerHTML: '', className: '',
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, removeEventListener() {},
    appendChild() {}, removeChild() {}, remove() {}, focus() {}, scrollTo() {}, click() {},
    insertAdjacentHTML() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
  };
}
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  createElement: () => makeEl('__detached__'),
  body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '' },
  hidden: false,
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined, clipboard: { writeText: async () => {} } }, configurable: true }); }
globalThis.requestAnimationFrame = fn => fn();
globalThis.matchMedia = () => ({ matches: false });
globalThis.confirm = () => true;
globalThis.prompt = () => null;
globalThis.alert = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };

// fetch is mocked per-section; default to disabled so stray calls fail loudly.
globalThis.fetch = async () => { throw new Error('network disabled in tbdtest (mock it per-section)'); };

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

const dp  = await import('./js/data-provider.js');
const dm  = await import('./js/data-model.js');
const app = await import('./js/app.js');
const { fetchByDateRange, computeScore, scoreCandidateGames } = dp;
const { formatGameTime, gameDataReadiness, TIME_ZONES, createGame } = dm;
const { renderGameCard, renderAvailableGamesList } = app;

console.log('[tbdtest] data-provider.js exports —', Object.keys(dp).length);

// ── Fixture builders — real ESPN payload shapes ──────────────────────────────

/**
 * `timeValid` is competitions[0].timeValid, ESPN's own boolean.
 * `detail`/`shortDetail` are status.type.* — the human-readable strings.
 */
function espnEvent({ id, date, timeValid, detail, shortDetail, statusName = 'STATUS_SCHEDULED',
                     home = 'HomeU', away = 'AwayU', homeScore = null, awayScore = null,
                     homeRank = null, awayRank = null, omitTimeValid = false }) {
  const comp = {
    id: String(id), neutralSite: false, dateValid: true,
    competitors: [
      { homeAway: 'home', team: { location: home, name: 'Team', abbreviation: 'H' }, score: homeScore, curatedRank: homeRank ? { current: homeRank } : {} },
      { homeAway: 'away', team: { location: away, name: 'Team', abbreviation: 'A' }, score: awayScore, curatedRank: awayRank ? { current: awayRank } : {} },
    ],
    odds: [], broadcasts: [], notes: [],
  };
  if (!omitTimeValid) comp.timeValid = timeValid;
  return {
    id: String(id), date,
    status: { type: { name: statusName, detail, shortDetail } },
    competitions: [comp],
  };
}

const mutantDirs = [];
async function parseFixture(events, startDate, endDate) {
  const saved = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ events }) });
  try {
    return await fetchByDateRange({ startDate, endDate });
  } finally { globalThis.fetch = saved; }
}

// ── The real Sep 3-7 window, verbatim shapes from Drew's captured payload ────
// 00:00Z games: genuine 8:00 PM EDT kickoffs, timeValid TRUE.
const REAL_8PM = [
  espnEvent({ id: '401856663', date: '2026-09-04T00:00Z', timeValid: true,
    detail: 'Thu, September 3rd at 8:00 PM EDT', shortDetail: '9/3 - 8:00 PM EDT',
    home: 'Missouri', away: 'Arkansas-Pine Bluff' }),
  espnEvent({ id: '401856664', date: '2026-09-05T00:00Z', timeValid: true,
    detail: 'Fri, September 4th at 8:00 PM EDT', shortDetail: '9/4 - 8:00 PM EDT',
    home: 'Oklahoma', away: 'UTEP' }),                       // <- the alma-mater game
  espnEvent({ id: '401856775', date: '2026-09-06T00:00Z', timeValid: true,
    detail: 'Sat, September 5th at 8:00 PM EDT', shortDetail: '9/5 - 8:00 PM EDT',
    home: 'BYU', away: 'Utah Tech' }),
];
// A genuine "date set, time TBD" — EDT season, so midnight ET = 04:00Z.
const GENUINE_TBD = espnEvent({ id: '401858465', date: '2026-09-05T04:00Z', timeValid: false,
  detail: '9/5 - TBD', shortDetail: 'TBD', home: 'Ohio State', away: 'Illinois' });
// An ordinary confirmed afternoon game — the control.
const CONTROL = espnEvent({ id: '401856700', date: '2026-09-05T16:00Z', timeValid: true,
  detail: 'Sat, September 5th at 12:00 PM EDT', shortDetail: '9/5 - 12:00 PM EDT',
  home: 'Georgia', away: 'Clemson' });
// A COMPLETED game that kicked at 8:00 PM EDT. Its detail collapses to
// "Final" — no "H:MM" — which is what the old regex keyed on.
const FINAL_8PM = espnEvent({ id: '401756895', date: '2026-09-06T00:00Z', timeValid: true,
  detail: 'Final', shortDetail: 'Final', statusName: 'STATUS_FINAL',
  home: 'Wyoming', away: 'Utah', homeScore: '17', awayScore: '31' });

const WINDOW = ['2026-09-03', '2026-09-07'];

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[1] Reproduction — real 8:00 PM EDT kickoffs at 00:00Z must NOT say "Time TBD"');
{
  const res = await parseFixture([...REAL_8PM, GENUINE_TBD, CONTROL], ...WINDOW);
  assert(res.error === null, `fixture check: fixture parsed without error (games=${res.games.length})`);
  const byId = new Map(res.games.map(g => [g.espnEventId, g]));
  assert(byId.size === 5, 'fixture check: all 5 events survived the date-range filter (non-vacuous)');

  for (const ev of REAL_8PM) {
    const g = byId.get(ev.id);
    assert(!!g, `fixture check: event ${ev.id} parsed into a game`);
    assert(g?.kickoffConfirmed === true,
      `${ev.id} (${ev.status.type.detail}) — kickoffConfirmed is TRUE`);
    assert(g?.kickoffDateOnly === false,
      `${ev.id} — kickoffDateOnly is FALSE`);
  }

  // What the player actually sees, in every supported zone.
  for (const ev of REAL_8PM) {
    const g = byId.get(ev.id);
    for (const z of TIME_ZONES) {
      const s = formatGameTime(g?.kickoff, z.key, g);
      assert(!s.includes('TBD') && /\d{2}:\d{2}/.test(s),
        `${ev.id} renders a real clock time in ${z.key} — got "${s}"`);
    }
  }

  // The shared player-facing card (Picks page + Dashboard).
  const okla = byId.get('401856664');
  const card = renderGameCard(okla, null, 'pending', false, false);
  assert(card.includes('Oklahoma') && card.includes('UTEP'),
    'fixture check: renderGameCard() genuinely rendered the UTEP @ OU card (not a vacuous pass)');
  assert(!card.includes('Time TBD'),
    'UTEP @ OU player card does NOT show "Time TBD" — the exact string Drew reported');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[2] Genuine TBDs must still work — a real "date set, time TBD" stays TBD');
{
  const res = await parseFixture([...REAL_8PM, GENUINE_TBD, CONTROL], ...WINDOW);
  const byId = new Map(res.games.map(g => [g.espnEventId, g]));
  const tbd = byId.get('401858465');
  assert(!!tbd, 'fixture check: the genuine-TBD event parsed into a game');
  assert(tbd?.kickoffConfirmed === false, 'genuine TBD — kickoffConfirmed is FALSE');
  assert(tbd?.kickoffDateOnly === true,   'genuine TBD — kickoffDateOnly is TRUE');

  for (const z of TIME_ZONES) {
    const s = formatGameTime(tbd?.kickoff, z.key, tbd);
    assert(s.includes('Time TBD'), `genuine TBD renders "Time TBD" in ${z.key} — got "${s}"`);
  }
  const card = renderGameCard(tbd, null, 'pending', false, false);
  assert(card.includes('Ohio State') && card.includes('Illinois'),
    'fixture check: renderGameCard() genuinely rendered the genuine-TBD card');
  assert(card.includes('Time TBD'),
    'genuine-TBD player card DOES show "Time TBD" — the fix must not make everything confirmed');

  const rd = gameDataReadiness(tbd);
  assert(rd.issues.some(i => /not confirmed/i.test(i)),
    'gameDataReadiness() still flags the genuine TBD as time-not-confirmed');
  const rdOk = gameDataReadiness(byId.get('401856664'));
  assert(!rdOk.issues.some(i => /not confirmed/i.test(i)),
    'gameDataReadiness() does NOT flag the real 8:00 PM game — no bogus commissioner warning');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[3] The fall-through — no game may land in the unintended third state');
{
  const res = await parseFixture([...REAL_8PM, GENUINE_TBD, CONTROL, FINAL_8PM], ...WINDOW);
  const stray = res.games.filter(g => g.kickoff && g.kickoffConfirmed === false && g.kickoffDateOnly === false);
  assert(res.games.length === 6, `fixture check: 6 games parsed (got ${res.games.length}) — non-vacuous`);
  assert(stray.length === 0,
    `INVARIANT: every game with a kickoff is either confirmed or date-only, never neither (found ${stray.length} stray: ${stray.map(g => g.espnEventId).join(',')})`);
  const contradictory = res.games.filter(g => g.kickoffConfirmed === true && g.kickoffDateOnly === true);
  assert(contradictory.length === 0,
    'INVARIANT: no game is simultaneously confirmed AND date-only');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[4] A FINAL game that kicked at 8:00 PM EDT — detail collapses to "Final"');
{
  const res = await parseFixture([FINAL_8PM, CONTROL], ...WINDOW);
  const g = res.games.find(x => x.espnEventId === '401756895');
  assert(!!g, 'fixture check: the FINAL 00:00Z event parsed into a game');
  assert(g?.status === 'final', 'fixture check: it really is a final game (non-vacuous)');
  assert(g?.kickoffConfirmed === true,
    'a completed 8:00 PM EDT game stays confirmed even though its detail string is "Final" with no H:MM');
  assert(g?.kickoffDateOnly === false, 'a completed game is not "date only"');
  const s = formatGameTime(g?.kickoff, 'ET', g);
  assert(!s.includes('TBD'), `completed 8:00 PM game shows its real kickoff time — got "${s}"`);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[5] Timestamp collision — proves no UTC-clock heuristic can ever work');
{
  // SAC @ HAW is a REAL 11:00 PM EST kickoff at 2026-11-29T04:00Z.
  const hawaii = espnEvent({ id: '401864547', date: '2026-11-29T04:00Z', timeValid: true,
    detail: 'Sat, November 28th at 11:00 PM EST', shortDetail: '11/28 - 11:00 PM EST',
    home: 'Hawaii', away: 'Sacramento State' });
  // An EST-season genuine TBD sits at 05:00Z (midnight ET shifts with DST).
  const estTbd = espnEvent({ id: '401858514', date: '2026-11-29T05:00Z', timeValid: false,
    detail: '11/28 - TBD', shortDetail: 'TBD', home: 'Oregon', away: 'Washington' });

  const res = await parseFixture([hawaii, estTbd], '2026-11-28', '2026-11-29');
  const byId = new Map(res.games.map(g => [g.espnEventId, g]));
  const h = byId.get('401864547'), t = byId.get('401858514');
  assert(!!h && !!t, 'fixture check: both the real late kickoff and the EST-season TBD parsed');

  // The load-bearing fact: identical UTC clock, opposite truth.
  const hd = new Date(hawaii.date), td = new Date(GENUINE_TBD.date);
  assert(hd.getUTCHours() === td.getUTCHours() && hd.getUTCMinutes() === td.getUTCMinutes()
      && hd.getUTCSeconds() === td.getUTCSeconds(),
    'fixture check: the real Hawaii kickoff and a genuine EDT-season TBD share an IDENTICAL UTC clock (04:00:00Z)');
  assert(h?.kickoffConfirmed === true,
    'the 04:00Z REAL 11:00 PM EST Hawaii kickoff is confirmed — an hour-based rule would call it a placeholder');
  assert(t?.kickoffConfirmed === false && t?.kickoffDateOnly === true,
    'the 05:00Z EST-season genuine TBD is still TBD — DST moves the placeholder, so no fixed UTC hour can encode it');
  assert(!formatGameTime(h?.kickoff, 'ET', h).includes('TBD'),
    'Hawaii game renders a real time, not TBD');
  assert(formatGameTime(t?.kickoff, 'ET', t).includes('Time TBD'),
    'EST-season TBD still renders "Time TBD"');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[6] Downstream: slate recommender scoring (+5 kickoffConfirmed)');
{
  const res = await parseFixture([...REAL_8PM, GENUINE_TBD, CONTROL], ...WINDOW);
  const byId = new Map(res.games.map(g => [g.espnEventId, g]));
  const okla = byId.get('401856664');
  const tbd  = byId.get('401858465');

  // Isolate the kickoff term: same game object, flag flipped.
  assert(computeScore({ ...okla, kickoffConfirmed: true }) - computeScore({ ...okla, kickoffConfirmed: false }) === 5,
    'fixture check: kickoffConfirmed is worth exactly +5 in computeScore()');
  assert(computeScore(okla) === computeScore({ ...okla, kickoffConfirmed: true }),
    'UTEP @ OU scores with the +5 confirmed-time bonus it is owed');
  assert(computeScore(tbd) === computeScore({ ...tbd, kickoffConfirmed: false }),
    'the genuine TBD does NOT collect the +5 bonus');

  const scored = scoreCandidateGames([okla, tbd], 'w_tbd');
  const oklaS = scored.find(g => g.espnEventId === '401856664');
  const tbdS  = scored.find(g => g.espnEventId === '401858465');
  assert(!oklaS.suggestionReasons.includes('⏰ Time TBD'),
    'the slate builder shows NO "⏰ Time TBD" reason chip on the real 8:00 PM game');
  assert(tbdS.suggestionReasons.includes('⏰ Time TBD'),
    'the slate builder DOES show "⏰ Time TBD" on the genuine TBD (non-vacuous)');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[7] Quality report counts confirmed times honestly');
{
  const res = await parseFixture([...REAL_8PM, GENUINE_TBD, CONTROL], ...WINDOW);
  const blob = JSON.stringify(res.qualityReport ?? {});
  assert(blob.length > 2, 'fixture check: a quality report was produced');
  assert(/\b4\b/.test(blob),
    'the report credits 4 confirmed kickoffs (3 real 8:00 PM + 1 control), not 1');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[8] Defensive: a payload with no timeValid field must not silently confirm a TBD');
{
  const noFlagTbd = espnEvent({ id: 'nf_tbd', date: '2026-09-05T04:00Z', omitTimeValid: true,
    detail: '9/5 - TBD', shortDetail: 'TBD', home: 'NoFlagHome', away: 'NoFlagAway' });
  const noFlagReal = espnEvent({ id: 'nf_real', date: '2026-09-05T00:00Z', omitTimeValid: true,
    detail: 'Fri, September 4th at 8:00 PM EDT', shortDetail: '9/4 - 8:00 PM EDT',
    home: 'NoFlagRealH', away: 'NoFlagRealA' });
  const res = await parseFixture([noFlagTbd, noFlagReal], ...WINDOW);
  const byId = new Map(res.games.map(g => [g.espnEventId, g]));
  assert(byId.size === 2, 'fixture check: both no-flag events parsed (non-vacuous)');
  assert(byId.get('nf_tbd')?.kickoffDateOnly === true,
    'with timeValid absent, ESPN\'s own "TBD" text still yields a TBD — a schema change cannot silently fabricate times');
  assert(byId.get('nf_real')?.kickoffConfirmed === true,
    'with timeValid absent, a real 8:00 PM EDT game is still confirmed');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[9] The SECOND false-TBD path — "Available Games -> + Add" drops the flags');
{
  // A correctly-parsed, confirmed game. Even with the parser fixed, adding it
  // to a slate through the Available Games button must not lose its kickoff
  // state: renderAvailableGamesList() hand-builds its data-game payload field
  // by field (it does NOT spread the game object), and createGame() defaults
  // kickoffConfirmed/kickoffDateOnly to false/false — the fall-through state.
  const res = await parseFixture([...REAL_8PM, GENUINE_TBD, CONTROL], ...WINDOW);
  const byId = new Map(res.games.map(g => [g.espnEventId, g]));
  const okla = byId.get('401856664');
  const tbd  = byId.get('401858465');
  assert(okla?.kickoffConfirmed === true, 'fixture check: the source game is confirmed before it is added');

  const html = renderAvailableGamesList([okla], [], { weekId: 'w_tbd', dataSourceMode: 'espn_historical' });
  const m = html.match(/data-game='([^']*)'/);
  assert(!!m, 'fixture check: the add-avail-game-btn data-game attribute rendered');
  const payload = JSON.parse(m[1].replace(/&#39;/g, "'"));
  assert(payload.kickoff === okla.kickoff, 'fixture check: the payload carries the kickoff timestamp (non-vacuous)');
  assert(payload.kickoffConfirmed === true,
    'the Available Games payload carries kickoffConfirmed — otherwise createGame() defaults it to false and the game shows "Time TBD" forever');
  assert(payload.kickoffDateOnly === false, 'the Available Games payload carries kickoffDateOnly');

  // Exactly what the real click handler does.
  const added = createGame('w_tbd', payload);
  assert(added.homeTeam === 'Oklahoma', 'fixture check: createGame() built the added game (non-vacuous)');
  assert(added.kickoffConfirmed === true && added.kickoffDateOnly === false,
    'a game added via Available Games keeps its confirmed kickoff');
  const card = renderGameCard(added, null, 'pending', false, false);
  assert(card.includes('Oklahoma') && !card.includes('Time TBD'),
    'the added game renders a real time on the player card — not "Time TBD"');

  // The three sibling add-paths ("Apply Suggested 10", "Add suggested
  // individually", shortlist) call createGame(weekId, {...game}) — a full
  // spread — so they carry the flags free. Prove that, so the claim that only
  // the hand-built payload needed fixing is checked rather than assumed.
  const spreadAdded = createGame('w_tbd', { ...okla, weekId: 'w_tbd' });
  assert(spreadAdded.kickoffConfirmed === true && spreadAdded.kickoffDateOnly === false,
    'the {...game} add-paths preserve the kickoff flags without a hand-built payload');

  // And the mirror: a genuine TBD added the same way must STAY TBD.
  const tbdHtml = renderAvailableGamesList([tbd], [], { weekId: 'w_tbd', dataSourceMode: 'espn_historical' });
  const tm = tbdHtml.match(/data-game='([^']*)'/);
  const tbdPayload = JSON.parse(tm[1].replace(/&#39;/g, "'"));
  const addedTbd = createGame('w_tbd', tbdPayload);
  assert(addedTbd.kickoffDateOnly === true && addedTbd.kickoffConfirmed === false,
    'a genuine TBD added via Available Games stays TBD');
  assert(renderGameCard(addedTbd, null, 'pending', false, false).includes('Time TBD'),
    'the added genuine TBD still renders "Time TBD" (non-vacuous mirror)');
}

// ═════════════════════════════════════════════════════════════════════════════
// [10] THE HEAL PATH — an ALREADY-IMPORTED game with stale flags must correct
//      itself through the ordinary 60-second refresh: no commissioner action,
//      no re-import, no new gameId.
//
// 27d2feb fixed the PARSER, so games imported after it deploys are correct.
// It did nothing for rows already in the Sheet, and its own commit message
// says so: "ALREADY-IMPORTED GAMES DO NOT SELF-HEAL ... Drew must RE-IMPORT
// the slate." Re-importing mints new gameIds and orphans every pick already
// made, so on a live, open, already-picked week that is not an option. The
// only place those rows can be corrected in situ is the refresh that already
// runs against them every 60 seconds.
//
// That path has TWO allow-lists and a field must be on BOTH to survive:
//   1. refreshScoresByEventIds()  (data-provider.js) — builds the `updated` row
//   2. doRefreshScores()          (app.js)          — merges it onto the stored game
//
// doRefreshScores() is not exported, so this section drives the REAL first half
// directly and derives the second half FROM APP.JS SOURCE TEXT. That matters:
// a hand-copied merge would keep passing after someone edited the real one.
// Deriving it means this test follows the shipped code instead of drifting.
//
// Every assertion is on the RENDERED STRING. "Time TBD" on screen is what Drew
// reported; a boolean is an implementation detail.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[10] Stale flags on an already-imported game heal through the live refresh');

const APP_SRC = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
const DP_SRC  = await readFile(new URL('./js/data-provider.js', import.meta.url), 'utf8');

// Derive doRefreshScores()'s merge from real source rather than restating it.
const mergeMatch = APP_SRC.match(/saveGame\(\{\.\.\.stored,([^}]*)\}\)/);
assert(!!mergeMatch,
  '[10] fixture check: located the doRefreshScores() merge expression in js/app.js');
const MERGE_FIELDS = mergeMatch[1].split(',').map(s => s.split(':')[0].trim()).filter(Boolean);
const applyRefreshMerge = new Function('stored', 'upd', `return {...stored,${mergeMatch[1]}};`);

// Drive the real refresh entry point against a stubbed ESPN scoreboard.
async function refreshFixture(events, stored) {
  const saved = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ events }) });
  try { return await dp.refreshScoresByEventIds([], stored); }
  finally { globalThis.fetch = saved; }
}

{
  // UTEP @ Oklahoma exactly as it sits in Drew's Sheet right now: the kickoff
  // TIMESTAMP is correct (00:00Z == 8:00 PM EDT); only the two booleans are
  // wrong, in the old parser's fall-through state (neither confirmed nor
  // date-only). This is the row players are looking at while they pick.
  const STALE_OKLA = {
    gameId: 'heal_okla', espnEventId: '401856664', espnSport: 'college-football',
    weekId: 'w_heal', homeTeam: 'Oklahoma', awayTeam: 'UTEP',
    kickoff: '2026-09-05T00:00Z',
    kickoffConfirmed: false,   // stale — the bug
    kickoffDateOnly:  false,   // stale — the bug
    spread: -35.5, favorite: 'Oklahoma', lockedSpread: -35.5,
    homeScore: null, awayScore: null, status: 'scheduled', actualWinner: null,
    isAlmaMaterGame: true, multiplier: 1,
  };

  // Precondition — this is the reported symptom, and it must be real before we
  // claim to have healed it. (Passes before AND after the fix by design.)
  assert(formatGameTime(STALE_OKLA.kickoff, 'ET', STALE_OKLA).includes('Time TBD'),
    '[10] precondition: the stored row renders "Time TBD" today — the reported symptom');
  assert(renderGameCard(STALE_OKLA, null, 'pending', false, false).includes('Time TBD'),
    '[10] precondition: the player-facing game CARD says "Time TBD" too');

  // ESPN's live view of that same event: a real 8:00 PM EDT kickoff, in progress.
  const LIVE_OKLA = espnEvent({
    id: '401856664', date: '2026-09-05T00:00Z', timeValid: true,
    detail: 'Fri, September 4th at 8:00 PM EDT', shortDetail: '9/4 - 8:00 PM EDT',
    home: 'Oklahoma', away: 'UTEP', homeScore: '21', awayScore: '3',
    statusName: 'STATUS_IN_PROGRESS',
  });

  const r = await refreshFixture([LIVE_OKLA, CONTROL], [STALE_OKLA]);
  const upd = r.updated.find(u => u.gameId === 'heal_okla');
  assert(r.errors.length === 0 && !!upd,
    `[10] fixture check: the refresh path actually returned this game (errors=${JSON.stringify(r.errors)})`);

  // Half 1 — does the provider's allow-list carry the flags at all?
  assert(upd && 'kickoffConfirmed' in upd,
    '[10] refreshScoresByEventIds() carries kickoffConfirmed on the updated row');
  assert(upd && 'kickoffDateOnly' in upd,
    '[10] refreshScoresByEventIds() carries kickoffDateOnly on the updated row');

  // Half 2 — does app.js's merge let them through onto the stored game?
  assert(MERGE_FIELDS.includes('kickoffConfirmed'),
    `[10] doRefreshScores() merges kickoffConfirmed (merge carries: ${MERGE_FIELDS.join(', ')})`);
  assert(MERGE_FIELDS.includes('kickoffDateOnly'),
    '[10] doRefreshScores() merges kickoffDateOnly');

  // End to end — the whole point.
  const merged = applyRefreshMerge(STALE_OKLA, upd);
  const rendered = formatGameTime(merged.kickoff, 'ET', merged);
  assert(!rendered.includes('Time TBD'),
    `[10] AFTER one poll cycle the row no longer renders "Time TBD" — got "${rendered}"`);
  assert(rendered.includes('20:00'),
    `[10] ...and renders the REAL 8:00 PM ET kickoff — got "${rendered}"`);
  assert(!renderGameCard(merged, null, 'pending', false, false).includes('Time TBD'),
    '[10] the player-facing game CARD stops saying "Time TBD" after one poll cycle');

  // The refresh must heal the flags WITHOUT disturbing identity or the slate.
  assert(merged.gameId === 'heal_okla',
    '[10] gameId is unchanged — picks are not orphaned (this is why re-import was rejected)');
  assert(merged.weekId === 'w_heal' && merged.spread === -35.5 && merged.favorite === 'Oklahoma',
    '[10] weekId / spread / favorite survive the merge untouched');
  assert(merged.lockedSpread === -35.5,
    '[10] lockedSpread is NOT rewritten by a score refresh (AD-03 stays intact)');
  // The kickoff TIMESTAMP was already correct for these rows, and the heal must
  // not move it: game.kickoff drives per-game pick locking and the week's
  // auto-LOCK / auto-LIVE transitions. Byte-identical means lock timing on
  // Drew's live week cannot shift when this deploys.
  assert(merged.kickoff === STALE_OKLA.kickoff,
    `[10] the kickoff TIMESTAMP is byte-identical after the heal — lock/auto-LIVE timing cannot move (got "${merged.kickoff}")`);

  // Scoring consequence: the +5 "confirmed time" bonus comes back, and the
  // false "Time TBD" reason chip goes away.
  assert(computeScore(merged) - computeScore(STALE_OKLA) === 5,
    '[10] the +5 kickoffConfirmed slate-scoring bonus is restored by the heal');
  assert(!gameDataReadiness(merged).issues.some(i => /not confirmed/i.test(i)),
    '[10] gameDataReadiness() stops reporting a false "time not confirmed" warning');
  // The healed row is what gets PERSISTED, so the flags must be real booleans.
  // If the provider ever stopped emitting them the merge would spread
  // `undefined` over the stored value, and formatGameTime's `?? true` default
  // would render a plausible time while an undefined sat in the Sheet — a
  // wrong value that looks right. [M2] proves the render probe alone misses it.
  assert(typeof merged.kickoffConfirmed === 'boolean' && typeof merged.kickoffDateOnly === 'boolean',
    `[10] the healed row persists real booleans, never undefined (got ${typeof merged.kickoffConfirmed}/${typeof merged.kickoffDateOnly})`);
}

// ═════════════════════════════════════════════════════════════════════════════
// [11] WRITE VOLUME — does carrying two more fields cost extra Sheet writes?
//
// Item 8's DI-1 deliberately kept live DISPLAY data off this same allow-list
// because a value that changes every tick would dirty the games key every tick.
// The claim here is that kickoff flags are different in kind. That claim is
// worth nothing unless it is measured, so measure it three ways.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[11] Write volume — carrying the flags must not multiply Sheet writes');
{
  const storage = await import('./js/storage.js');
  const backend = await import('./js/backend.js');
  const GAMES_KEY = 'cfbp_games';

  // (a) Is the merge write conditional on anything having CHANGED? Read the
  //     real function body and look for a guard around the saveGame call.
  const body = APP_SRC.slice(APP_SRC.indexOf('async function doRefreshScores'));
  const fnBody = body.slice(0, body.indexOf('\n}\n'));
  const saveLine = fnBody.split('\n').find(l => l.includes('saveGame({...stored'));
  assert(!!saveLine && !/\bif\s*\(/.test(saveLine),
    '[11] (a) doRefreshScores() calls saveGame() UNCONDITIONALLY — no change-guard to defeat');

  // (b) Functional proof of (a): replay identical, byte-for-byte unchanged
  //     refresh rows and show the seam still writes every single time. If the
  //     write already fires when NOTHING changed, adding fields cannot add one.
  const TEN = Array.from({ length: 10 }, (_, i) => ({
    gameId: `vol_${i}`, weekId: 'w_vol', espnEventId: `9000${i}`,
    espnSport: 'college-football', homeTeam: `H${i}`, awayTeam: `A${i}`,
    kickoff: '2026-09-05T00:00Z', kickoffConfirmed: true, kickoffDateOnly: false,
    homeScore: 7, awayScore: 3, status: 'in_progress', actualWinner: null,
    lastUpdated: '2026-09-05T01:00:00.000Z',
  }));
  storage.saveAllGamesForWeek('w_vol', TEN);

  let writes = 0;
  const realSetItem = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = (k, v) => { if (k === GAMES_KEY) writes++; return realSetItem(k, v); };

  const FROZEN = {
    homeScore: 7, awayScore: 3, status: 'in_progress', actualWinner: null,
    lastUpdated: '2026-09-05T01:00:00.000Z',
    kickoffConfirmed: true, kickoffDateOnly: false,
  };
  // Legacy 5-field merge (what shipped before this fix) vs. the real one.
  const legacyMerge = (stored, upd) => ({
    ...stored, homeScore: upd.homeScore, awayScore: upd.awayScore,
    status: upd.status, actualWinner: upd.actualWinner, lastUpdated: upd.lastUpdated,
  });

  writes = 0;
  for (let t = 0; t < 3; t++) for (const g of storage.getGames('w_vol')) storage.saveGame(legacyMerge(g, FROZEN));
  const legacyWrites = writes;

  writes = 0;
  for (let t = 0; t < 3; t++) for (const g of storage.getGames('w_vol')) storage.saveGame(applyRefreshMerge(g, FROZEN));
  const newWrites = writes;

  globalThis.localStorage.setItem = realSetItem;

  // Non-vacuity: the two merges above must actually DIFFER, or comparing their
  // write counts proves nothing at all.
  assert(MERGE_FIELDS.length > 5,
    `[11] (b) fixture check: the real merge carries MORE than the legacy 5 fields, so the count comparison is not vacuous (carries ${MERGE_FIELDS.length}: ${MERGE_FIELDS.join(', ')})`);
  assert(legacyWrites === 30,
    `[11] (b) 3 ticks x 10 games already writes 30 times with NOTHING changed — the write is unconditional today (got ${legacyWrites})`);
  assert(newWrites === legacyWrites,
    `[11] (b) carrying the two kickoff flags writes exactly as often: ${newWrites} vs ${legacyWrites}`);

  // (c) Sheet-level truth: the push unit is the KEY, not the game and not the
  //     field. backend.cacheSet() dirties a Set of keys and debounces 800ms, so
  //     a whole tick collapses to ONE queued write however many games moved.
  const before = backend.getSyncStatus().pendingWrites;
  for (let i = 0; i < 10; i++) backend.cacheSet(GAMES_KEY, TEN.map(g => ({ ...g, kickoffConfirmed: true })));
  const after = backend.getSyncStatus().pendingWrites;
  assert(after - before <= 1,
    `[11] (c) 10 cacheSet() calls on cfbp_games queue at most ONE pending Sheet write (delta=${after - before})`);

  // (d) And the reason the flags are different in kind from live display data:
  //     they are terminal. Once ESPN says timeValid:true it does not flip back
  //     tick to tick the way a clock or a score does.
  assert(!MERGE_FIELDS.includes('displayClock') && !MERGE_FIELDS.includes('period'),
    '[11] (d) the merge still carries no per-tick display data — DI-1 intact');
}

// ═════════════════════════════════════════════════════════════════════════════
// [12] A FINAL GAME MUST NOT REGRESS.
//      ESPN collapses status.type.detail to "Final" on completed games — no
//      "H:MM" anywhere — which is the exact shape the OLD parser keyed on and
//      the reason section [4] exists. Now that the refresh WRITES these flags
//      back every 60 seconds, a wrong answer here would not just mis-render a
//      finished game, it would overwrite a correct stored row with a worse one.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[12] A completed game must not regress to TBD on later polls');
{
  const STORED_FINAL = {
    gameId: 'heal_final', espnEventId: '401756895', espnSport: 'college-football',
    weekId: 'w_heal', homeTeam: 'Wyoming', awayTeam: 'Utah',
    kickoff: '2026-09-06T00:00Z',
    kickoffConfirmed: true, kickoffDateOnly: false,   // already CORRECT
    homeScore: 17, awayScore: 31, status: 'final', actualWinner: 'Utah',
    spread: 7.5, favorite: 'Utah', lockedSpread: 7.5, multiplier: 1,
  };

  const r = await refreshFixture([FINAL_8PM, CONTROL], [STORED_FINAL]);
  const upd = r.updated.find(u => u.gameId === 'heal_final');
  assert(!!upd, '[12] fixture check: the FINAL game came back from the refresh path');

  const merged = applyRefreshMerge(STORED_FINAL, upd);
  assert(merged.kickoffConfirmed === true && merged.kickoffDateOnly === false,
    '[12] a FINAL game whose detail is just "Final" keeps its confirmed flags');
  const rendered = formatGameTime(merged.kickoff, 'ET', merged);
  assert(!rendered.includes('Time TBD') && rendered.includes('20:00'),
    `[12] the finished game still renders its real 8:00 PM ET kickoff — got "${rendered}"`);

  // Idempotence: poll it repeatedly, as the app really does, and confirm the
  // answer is stable rather than drifting one tick at a time.
  let cur = merged;
  for (let i = 0; i < 5; i++) {
    const rr = await refreshFixture([FINAL_8PM, CONTROL], [cur]);
    cur = applyRefreshMerge(cur, rr.updated.find(u => u.gameId === 'heal_final'));
  }
  assert(cur.kickoffConfirmed === true && cur.kickoffDateOnly === false,
    '[12] five further polls do not degrade the finished game (idempotent)');
  assert(formatGameTime(cur.kickoff, 'ET', cur) === rendered,
    '[12] the rendered kickoff string is byte-identical after five more polls');

  // Hard case: ESPN drops timeValid entirely on a completed game. The fallback
  // must read "Final" as "not TBD" — never silently mark a finished game TBD.
  const FINAL_NO_FLAG = espnEvent({
    id: '401756895', date: '2026-09-06T00:00Z', omitTimeValid: true,
    detail: 'Final', shortDetail: 'Final', statusName: 'STATUS_FINAL',
    home: 'Wyoming', away: 'Utah', homeScore: '17', awayScore: '31',
  });
  // The deliberate limit on carrying `kickoff`: once a row is confirmed its
  // timestamp is passed through UNTOUCHED, even if ESPN now reports a different
  // one. Rewriting it would move pick-lock and auto-LIVE times under a running
  // week — a far larger blast radius than the bug this fixes. Pinned so the
  // choice cannot be reversed silently.
  const MOVED = espnEvent({
    id: '401756895', date: '2026-09-06T17:00Z', timeValid: true,
    detail: 'Sat, September 5th at 1:00 PM EDT', shortDetail: '9/5 - 1:00 PM EDT',
    statusName: 'STATUS_FINAL', home: 'Wyoming', away: 'Utah',
    homeScore: '17', awayScore: '31',
  });
  const rm = await refreshFixture([MOVED, CONTROL], [STORED_FINAL]);
  const mm = applyRefreshMerge(STORED_FINAL, rm.updated.find(u => u.gameId === 'heal_final'));
  assert(mm.kickoff === STORED_FINAL.kickoff,
    `[12] an already-CONFIRMED row keeps its stored kickoff even when ESPN reports a different one — lock timing is never moved by a poll (got "${mm.kickoff}")`);
  assert(mm.kickoffConfirmed === true && mm.kickoffDateOnly === false,
    '[12] ...and its flags are likewise passed through untouched (strict no-op)');

  const r2 = await refreshFixture([FINAL_NO_FLAG, CONTROL], [STORED_FINAL]);
  const m2 = applyRefreshMerge(STORED_FINAL, r2.updated.find(u => u.gameId === 'heal_final'));
  assert(m2.kickoffConfirmed === true && m2.kickoffDateOnly === false,
    '[12] a FINAL game with NO timeValid field still does not regress to TBD');
}

// ═════════════════════════════════════════════════════════════════════════════
// [13] THE FORWARD DIRECTION — a genuine TBD that later gets a real time.
//      This is the case that makes the heal worth doing beyond this weekend,
//      and it is the case that decides whether `kickoff` itself must travel
//      with its flags.
//
//      A stored TBD's kickoff is a PLACEHOLDER: midnight Eastern. If the flags
//      heal to "confirmed" while the placeholder timestamp stays, the app
//      renders midnight ET as though it were a scheduled kickoff — which is
//      precisely defect (c) from 27d2feb, the "false confirmed" that hit 409
//      of 1197 captured events. Healing the flags alone would re-introduce it
//      on the refresh path.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[13] A genuine TBD that gets a real time heals to the REAL time');
{
  // As stored at import: ESPN had no time yet, so event.date was midnight ET.
  const STORED_TBD = {
    gameId: 'heal_tbd', espnEventId: '401858465', espnSport: 'college-football',
    weekId: 'w_heal', homeTeam: 'Ohio State', awayTeam: 'Illinois',
    kickoff: '2026-09-05T04:00Z',            // midnight EDT placeholder
    kickoffConfirmed: false, kickoffDateOnly: true,
    homeScore: null, awayScore: null, status: 'scheduled', actualWinner: null,
    spread: -14.5, favorite: 'Ohio State', lockedSpread: null, multiplier: 1,
  };
  assert(formatGameTime(STORED_TBD.kickoff, 'ET', STORED_TBD).includes('Time TBD'),
    '[13] precondition: while genuinely unscheduled it correctly reads "Time TBD"');

  // ESPN has now announced 7:30 PM EDT, and moved event.date accordingly.
  const TBD_ANNOUNCED = espnEvent({
    id: '401858465', date: '2026-09-05T23:30Z', timeValid: true,
    detail: 'Sat, September 5th at 7:30 PM EDT', shortDetail: '9/5 - 7:30 PM EDT',
    home: 'Ohio State', away: 'Illinois',
  });

  const r = await refreshFixture([TBD_ANNOUNCED, CONTROL], [STORED_TBD]);
  const upd = r.updated.find(u => u.gameId === 'heal_tbd');
  assert(!!upd, '[13] fixture check: the newly-scheduled game came back from the refresh');

  const merged = applyRefreshMerge(STORED_TBD, upd);
  const rendered = formatGameTime(merged.kickoff, 'ET', merged);

  assert(!rendered.includes('Time TBD'),
    `[13] once ESPN confirms a time the row stops reading "Time TBD" — got "${rendered}"`);
  // The decisive one: it must show 19:30, NOT the 00:00 placeholder it was
  // stored with. Showing 00:00 here would be a FABRICATED kickoff.
  assert(rendered.includes('19:30'),
    `[13] it renders the REAL announced 7:30 PM ET time, not the stored midnight placeholder — got "${rendered}"`);
  assert(!rendered.includes('00:00'),
    `[13] it must NOT render the midnight-ET placeholder as a confirmed time (defect (c) of 27d2feb) — got "${rendered}"`);
  assert(merged.kickoff === '2026-09-05T23:30Z',
    `[13] the placeholder timestamp is REPLACED by ESPN's real one — kickoff and its flags travel together (got "${merged.kickoff}")`);
  assert(MERGE_FIELDS.includes('kickoff'),
    '[13] doRefreshScores() merges kickoff, so the forward heal reaches storage rather than stopping at the provider');
  assert(merged.kickoffConfirmed === true && merged.kickoffDateOnly === false,
    '[13] the flags land in the confirmed state, not the fall-through state');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[M] Mutation battery — inversions and deletions, on a tmpdir copy');
{
  const realDP = await readFile(new URL('./js/data-provider.js', import.meta.url), 'utf8');
  const realDM = await readFile(new URL('./js/data-model.js', import.meta.url), 'utf8');

  async function importMutant(src) {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'tbdtest-mutant-'));
    mutantDirs.push(dir);
    await writeFile(path.join(dir, 'data-model.js'), realDM, 'utf8');
    await writeFile(path.join(dir, 'data-provider.js'), src, 'utf8');
    const url = new URL(`file://${path.join(dir, 'data-provider.js')}?t=${Date.now()}_${Math.random()}`);
    return import(url.href);
  }

  async function parseWith(mod, events, startDate, endDate) {
    const saved = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ events }) });
    try { return await mod.fetchByDateRange({ startDate, endDate }); }
    finally { globalThis.fetch = saved; }
  }
  const FIX = [...REAL_8PM, GENUINE_TBD, CONTROL];
  const idOf = async (mod) => {
    const r = await parseWith(mod, FIX, ...WINDOW);
    return new Map(r.games.map(g => [g.espnEventId, g]));
  };

  // Baseline must be GREEN through the same harness, or every "RED" below is meaningless.
  {
    const base = await importMutant(realDP);
    const m = await idOf(base);
    assert(m.get('401856664')?.kickoffConfirmed === true && m.get('401858465')?.kickoffDateOnly === true,
      'fixture check: unmutated source is GREEN through the mutant harness');
  }

  const MUTATIONS = [
    {
      name: 'INVERT the structured TBD test (=== false -> !== false)',
      apply: s => s.replace('? timeValid === false', '? timeValid !== false'),
      proveRed: async (mod) => (await idOf(mod)).get('401856664')?.kickoffConfirmed !== true,
    },
    {
      name: 'INVERT the branch condition (if (timeIsTBD) -> if (!timeIsTBD))',
      apply: s => s.replace('if (timeIsTBD) {', 'if (!timeIsTBD) {'),
      proveRed: async (mod) => {
        const m = await idOf(mod);
        return m.get('401858465')?.kickoffDateOnly !== true || m.get('401856664')?.kickoffConfirmed !== true;
      },
    },
    {
      name: 'DELETE the TBD branch (if (timeIsTBD) -> if (false)) — genuine TBDs get fabricated times',
      apply: s => s.replace('if (timeIsTBD) {', 'if (false) {'),
      proveRed: async (mod) => (await idOf(mod)).get('401858465')?.kickoffConfirmed !== false,
    },
    {
      name: 'REGRESS to the midnight-UTC heuristic — reintroduces the exact reported bug',
      apply: s => s.replace(
        String.raw`const timeIsTBD = typeof timeValid === 'boolean'
        ? timeValid === false
        : /\bTBD\b/i.test(String(tbdText ?? ''));`,
        `const _d2 = new Date(rawDate);
      const timeIsTBD = _d2.getUTCHours() === 0 && _d2.getUTCMinutes() === 0 && _d2.getUTCSeconds() === 0;`),
      proveRed: async (mod) => {
        const m = await idOf(mod);
        return m.get('401856664')?.kickoffConfirmed !== true || m.get('401858465')?.kickoffDateOnly !== true;
      },
    },
    {
      name: 'SWAP the structured flag to the neighbouring field (comp.timeValid -> comp.dateValid)',
      apply: s => s.replace('const timeValid  = comp.timeValid;', 'const timeValid  = comp.dateValid;'),
      proveRed: async (mod) => (await idOf(mod)).get('401858465')?.kickoffDateOnly !== true,
    },
    {
      name: 'HARDCODE the flag true (const timeValid = true) — everything confirmed',
      apply: s => s.replace('const timeValid  = comp.timeValid;', 'const timeValid  = true;'),
      proveRed: async (mod) => (await idOf(mod)).get('401858465')?.kickoffDateOnly !== true,
    },
    {
      name: 'REINTRODUCE the fall-through (else -> else if (timeIsTBD)) — the third unintended state',
      apply: s => s.replace(
        `} else {
        kickoffConfirmed = true;
        withConfirmedTime++;
      }`,
        `} else if (timeIsTBD) {
        kickoffConfirmed = true;
        withConfirmedTime++;
      }`),
      proveRed: async (mod) => {
        const r = await parseWith(mod, FIX, ...WINDOW);
        return r.games.some(g => g.kickoff && g.kickoffConfirmed === false && g.kickoffDateOnly === false);
      },
    },
    {
      name: 'DELETE the no-flag fallback — an absent timeValid silently confirms a TBD',
      apply: s => s.replace(String.raw`: /\bTBD\b/i.test(String(tbdText ?? ''));`, `: false;`),
      proveRed: async (mod) => {
        const noFlagTbd = espnEvent({ id: 'nf_tbd', date: '2026-09-05T04:00Z', omitTimeValid: true,
          detail: '9/5 - TBD', shortDetail: 'TBD' });
        const r = await parseWith(mod, [noFlagTbd, CONTROL], ...WINDOW);
        return r.games.find(g => g.espnEventId === 'nf_tbd')?.kickoffDateOnly !== true;
      },
    },
    {
      name: 'INVERT the no-flag fallback (test -> !test) — absent flag confirms TBDs and TBDs real games',
      apply: s => s.replace(String.raw`: /\bTBD\b/i.test(String(tbdText ?? ''));`, String.raw`: !/\bTBD\b/i.test(String(tbdText ?? ''));`),
      proveRed: async (mod) => {
        const noFlagTbd = espnEvent({ id: 'nf_tbd', date: '2026-09-05T04:00Z', omitTimeValid: true,
          detail: '9/5 - TBD', shortDetail: 'TBD' });
        const r = await parseWith(mod, [noFlagTbd, CONTROL], ...WINDOW);
        return r.games.find(g => g.espnEventId === 'nf_tbd')?.kickoffDateOnly !== true;
      },
    },
  ];

  for (const m of MUTATIONS) {
    const mutated = m.apply(realDP);
    assert(mutated !== realDP, `fixture check: mutation "${m.name}" actually changed the source text`);
    try {
      const mod = await importMutant(mutated);
      const tripped = await m.proveRed(mod);
      assert(tripped === true, `RED — mutation caught: ${m.name}`);
    } catch (e) {
      assert(true, `RED — mutation caught (via exception): ${m.name} — ${e.message}`);
    }
  }

  await Promise.all(mutantDirs.map(d => rm(d, { recursive: true, force: true }).catch(() => {})));
}

// ═════════════════════════════════════════════════════════════════════════════
// [M2] Mutation battery for the SELF-HEAL path (sections [10]/[12]/[13]).
//
// Same discipline as [M]: inversions as well as deletions, every mutant written
// to a fresh os.tmpdir() directory, real source under cfb-pickems/ never
// touched, every mutation paired with a fixture check that the source text
// actually changed so a no-op regex cannot report a vacuous "caught".
//
// app.js is not importable in isolation (it pulls in the whole module graph),
// so its two mutations are applied to the SOURCE TEXT and the merge is rebuilt
// from the mutated string — the same derivation section [10] uses against the
// real file. That tests the merge's field list, which is the part that matters.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[M2] Mutation battery for the self-heal path');
{
  const realDP = await readFile(new URL('./js/data-provider.js', import.meta.url), 'utf8');
  const realDM = await readFile(new URL('./js/data-model.js', import.meta.url), 'utf8');

  async function importMutantDP(src) {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'tbdtest-heal-'));
    mutantDirs.push(dir);
    await writeFile(path.join(dir, 'data-model.js'), realDM, 'utf8');
    await writeFile(path.join(dir, 'data-provider.js'), src, 'utf8');
    const url = new URL(`file://${path.join(dir, 'data-provider.js')}?t=${Date.now()}_${Math.random()}`);
    return import(url.href);
  }
  async function refreshWith(mod, events, stored) {
    const saved = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ events }) });
    try { return await mod.refreshScoresByEventIds([], stored); }
    finally { globalThis.fetch = saved; }
  }
  function mergeFromSource(src) {
    const m = src.match(/saveGame\(\{\.\.\.stored,([^}]*)\}\)/);
    return m ? new Function('stored', 'upd', `return {...stored,${m[1]}};`) : null;
  }

  // ── The three scenarios the heal has to get right, as reusable fixtures ────
  const S_STALE = {   // Drew's live bug: correct timestamp, stale flags
    gameId: 'm_stale', espnEventId: '401856664', espnSport: 'college-football',
    homeTeam: 'Oklahoma', awayTeam: 'UTEP', kickoff: '2026-09-05T00:00Z',
    kickoffConfirmed: false, kickoffDateOnly: false,
  };
  const E_STALE = espnEvent({ id: '401856664', date: '2026-09-05T00:00Z', timeValid: true,
    detail: 'Fri, September 4th at 8:00 PM EDT', shortDetail: '9/4 - 8:00 PM EDT',
    home: 'Oklahoma', away: 'UTEP' });

  const S_TBD = {     // genuine TBD holding a midnight-ET placeholder
    gameId: 'm_tbd', espnEventId: '401858465', espnSport: 'college-football',
    homeTeam: 'Ohio State', awayTeam: 'Illinois', kickoff: '2026-09-05T04:00Z',
    kickoffConfirmed: false, kickoffDateOnly: true,
  };
  const E_TBD_NOW_SET = espnEvent({ id: '401858465', date: '2026-09-05T23:30Z', timeValid: true,
    detail: 'Sat, September 5th at 7:30 PM EDT', shortDetail: '9/5 - 7:30 PM EDT',
    home: 'Ohio State', away: 'Illinois' });

  const S_CONF = {    // already correct — must be a strict no-op
    gameId: 'm_conf', espnEventId: '401756895', espnSport: 'college-football',
    homeTeam: 'Wyoming', awayTeam: 'Utah', kickoff: '2026-09-06T00:00Z',
    kickoffConfirmed: true, kickoffDateOnly: false,
  };
  const E_CONF_MOVED = espnEvent({ id: '401756895', date: '2026-09-06T17:00Z', timeValid: true,
    detail: 'Sat, September 5th at 1:00 PM EDT', shortDetail: '9/5 - 1:00 PM EDT',
    home: 'Wyoming', away: 'Utah' });

  const realMerge = mergeFromSource(realDP && APP_SRC);

  // Outcome probes. Each returns TRUE when the behaviour is BROKEN.
  async function staleStillTBD(mod, merge) {
    const r = await refreshWith(mod, [E_STALE, CONTROL], [S_STALE]);
    const u = r.updated.find(x => x.gameId === 'm_stale');
    if (!u) return true;
    const m = merge(S_STALE, u);
    return formatGameTime(m.kickoff, 'ET', m).includes('Time TBD')
        || m.kickoffConfirmed !== true;
  }
  async function tbdHealsWrong(mod, merge) {
    const r = await refreshWith(mod, [E_TBD_NOW_SET, CONTROL], [S_TBD]);
    const u = r.updated.find(x => x.gameId === 'm_tbd');
    if (!u) return true;
    const m = merge(S_TBD, u);
    const s = formatGameTime(m.kickoff, 'ET', m);
    return !s.includes('19:30');           // anything but the REAL announced time
  }
  async function confirmedRowMoved(mod, merge) {
    const r = await refreshWith(mod, [E_CONF_MOVED, CONTROL], [S_CONF]);
    const u = r.updated.find(x => x.gameId === 'm_conf');
    if (!u) return true;
    const m = merge(S_CONF, u);
    return m.kickoff !== S_CONF.kickoff || m.kickoffConfirmed !== true;
  }

  // Fixture check: unmutated source must be GREEN through this harness, or
  // every "caught" below is meaningless.
  {
    const clean = await importMutantDP(realDP);
    const a = await staleStillTBD(clean, realMerge);
    const b = await tbdHealsWrong(clean, realMerge);
    const c = await confirmedRowMoved(clean, realMerge);
    assert(a === false && b === false && c === false,
      `[M2] fixture check: unmutated source is GREEN through the mutant harness (stale=${a} tbd=${b} conf=${c})`);
  }

  const DP_MUTATIONS = [
    {
      name: 'INVERT storedConfirmed (=== true -> !== true) — stale rows never heal',
      apply: s => s.replace('const storedConfirmed = stored.kickoffConfirmed === true',
                            'const storedConfirmed = stored.kickoffConfirmed !== true'),
      probe: staleStillTBD,
    },
    {
      name: 'INVERT the date-only guard (!== true -> === true) — a confirmed row gets its kickoff rewritten',
      apply: s => s.replace('stored.kickoffDateOnly !== true;', 'stored.kickoffDateOnly === true;'),
      probe: confirmedRowMoved,
    },
    {
      name: 'DROP the guard on kickoff — every poll adopts ESPN’s timestamp, moving pick-lock times',
      apply: s => s.replace('kickoff:          storedConfirmed ? stored.kickoff          : (liveGame.kickoff ?? stored.kickoff),',
                            'kickoff:          (liveGame.kickoff ?? stored.kickoff),'),
      probe: confirmedRowMoved,
    },
    {
      name: 'THE REJECTED FLAGS-ONLY DESIGN — flags heal but kickoff never does, fabricating a midnight kickoff',
      apply: s => s.replace('kickoff:          storedConfirmed ? stored.kickoff          : (liveGame.kickoff ?? stored.kickoff),',
                            'kickoff:          stored.kickoff,'),
      probe: tbdHealsWrong,
    },
    {
      name: 'SOURCE SWAP — healed kickoffConfirmed reads stored instead of liveGame, so nothing ever heals',
      apply: s => s.replace('kickoffConfirmed: storedConfirmed ? stored.kickoffConfirmed : liveGame.kickoffConfirmed,',
                            'kickoffConfirmed: stored.kickoffConfirmed,'),
      probe: staleStillTBD,
    },
    {
      name: 'DELETE both flag carries from the provider allow-list — reverts to the pre-fix behaviour',
      apply: s => s.replace('        kickoffConfirmed: storedConfirmed ? stored.kickoffConfirmed : liveGame.kickoffConfirmed,\n        kickoffDateOnly:  storedConfirmed ? stored.kickoffDateOnly  : liveGame.kickoffDateOnly,\n', ''),
      // Deleting these makes upd.kickoffConfirmed undefined; the merge then writes
      // undefined over the stored false, and formatGameTime's `?? true` default
      // silently renders a time. So the RENDER probe alone would MISS this. The
      // structural check in [10] is what catches it — assert that here too.
      probe: async (mod, merge) => {
        const r = await refreshWith(mod, [E_STALE, CONTROL], [S_STALE]);
        const u = r.updated.find(x => x.gameId === 'm_stale');
        return !u || !('kickoffConfirmed' in u) || !('kickoffDateOnly' in u);
      },
    },
  ];

  for (const m of DP_MUTATIONS) {
    const mutated = m.apply(realDP);
    assert(mutated !== realDP, `[M2] fixture check: mutation "${m.name}" actually changed the source text`);
    try {
      const mod = await importMutantDP(mutated);
      const tripped = await m.probe(mod, realMerge);
      assert(tripped === true, `[M2] RED — mutation caught: ${m.name}`);
    } catch (e) {
      assert(true, `[M2] RED — mutation caught (via exception): ${m.name} — ${e.message}`);
    }
  }

  // ── app.js merge-side mutations, applied to source text ───────────────────
  const cleanMod = await importMutantDP(realDP);
  const APP_MUTATIONS = [
    {
      name: 'app.js: DELETE kickoff from the merge — the forward heal stops at the provider',
      apply: s => s.replace('kickoff:upd.kickoff,', ''),
      probe: tbdHealsWrong,
    },
    {
      name: 'app.js: DELETE kickoffConfirmed from the merge — Drew’s reported bug returns',
      apply: s => s.replace('kickoffConfirmed:upd.kickoffConfirmed,', ''),
      probe: staleStillTBD,
    },
    {
      name: 'app.js: REPLACE the merge with the pre-fix five-field allow-list',
      apply: s => s.replace(/saveGame\(\{\.\.\.stored,[^}]*\}\)/,
        'saveGame({...stored,homeScore:upd.homeScore,awayScore:upd.awayScore,status:upd.status,actualWinner:upd.actualWinner,lastUpdated:upd.lastUpdated})'),
      probe: staleStillTBD,
    },
  ];

  for (const m of APP_MUTATIONS) {
    const mutatedSrc = m.apply(APP_SRC);
    assert(mutatedSrc !== APP_SRC, `[M2] fixture check: mutation "${m.name}" actually changed the source text`);
    const mutantMerge = mergeFromSource(mutatedSrc);
    assert(typeof mutantMerge === 'function', `[M2] fixture check: mutated merge still parses — "${m.name}"`);
    const tripped = await m.probe(cleanMod, mutantMerge);
    assert(tripped === true, `[M2] RED — mutation caught: ${m.name}`);
  }

  // Real source is untouched by all of the above — prove it rather than trust it.
  const dpNow  = await readFile(new URL('./js/data-provider.js', import.meta.url), 'utf8');
  const appNow = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
  assert(dpNow === realDP && appNow === APP_SRC,
    '[M2] real source under cfb-pickems/js/ is byte-identical after the whole battery');

  await Promise.all(mutantDirs.map(d => rm(d, { recursive: true, force: true }).catch(() => {})));
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════════════');
if (fail === 0) console.log(`✅ ALL PASS — ${pass} passed, ${fail} failed`);
else console.log(`❌ ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
