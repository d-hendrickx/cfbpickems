/**
 * CFB Pickems — comparetest.mjs (Deployment 1, Lane B, DI-594 / DI-595 / DI-596 / DI-601, 2026-10-08)
 * ===================================================================================================
 * The history screens' MODELS, MARKUP and BLIND RULE, run against the real pure modules (js/stats.js headToHeadRecord, js/compare.js, js/week-detail.js) over the shared hand-derived league
 * (statsfixtures.mjs: six members, two weeks, every outcome derived by hand and asserted here as numbers, never recomputed through the code under test).
 *
 *   [1] headToHeadRecord - the hand-derived record for Drew vs Brayden in every week-2 state (final / live / open / locked / a final game inside an OPEN week)
 *   [2] PARITY with the SCRIBE tool (toolGetHeadToHeadRecord): every pair of the six, every week-2 state, equal on the tool's eight fields
 *   [3] the reveal gate fails closed (no predicate, a throwing predicate, a non-true answer, the same person twice)
 *   [4] the comparison model: the Season card is Standings' own rows, the denominators are named, and TWO COMPETITIONS never share a figure (8-2 in CFB and 3-7 in NFL is never 11-9)
 *   [5] the blind rule through the model: an Open or Locked week, a public week whose rows have not landed, a demo week and a hidden week contribute nothing - and not one team name from them reaches the markup
 *   [6] entrants (DI-594): a member counts for a week only if the week's entrants include them; the late joiner's note says how many weeks
 *   [7] the comparison markup: every DI string, the escaper is REQUIRED and used at every sink, hostile names stay inert, Show all, the sport control, the unavailable state
 *   [8] the rival picker markup and rivalChoices
 *   [9] the week detail model: final / in-progress / pooled / no-results / not public, the split is a COUNT, the viewer's own chip, live is tentative, the parts
 *   [10] the week detail markup
 *   [11] source pins: the leaf modules read no storage and no pick reader, and the comparison never asks the league's active list
 *
 * NOT COVERED HERE (a device, never a test): the slide / swipe-back feel, haptic strength, VoiceOver's reading of the two screens, Dynamic Type at the system's real largest size.
 * The app wiring (Standings entries, the pushed screens, the picker, every button through the real dispatcher) is historywiringtest.mjs; the computed-style proof in a real browser is
 * historybrowsertest.mjs; the mutation kit is tests/kits/d1-history-mutants.mjs.
 *
 * Run:  node comparetest.mjs
 */
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const _log = console.log.bind(console), _err = console.error.bind(console);
const assert = (cond, label, extra = '') => { if (cond) { pass++; _log('  ✅', label); } else { fail++; _err('  ❌', label, extra ? `\n     ${extra}` : ''); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear(), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; } };
globalThis.window = globalThis;

const fx = await import('./statsfixtures.mjs');
const { calculateWeeklyResults, calculateSeasonStandings } = await import('./js/scoring.js');
const { arePicksPublic } = await import('./js/storage.js');
const { headToHeadRecord } = await import('./js/stats.js');
const compare = await import('./js/compare.js');
const wd = await import('./js/week-detail.js');
const { containsBannedLiveWord } = await import('./js/game-state.js');
const tools = await import('./supabase/functions/_shared/scribe-tools.mjs');

// The app's escHtml, character for character (js/app.js): & < > " only - so every attribute is double-quoted.
const esc = (s) => { if (!s) return ''; return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
const SHARED = ['gamesCompared', 'agreed', 'bothRight', 'bothWrong', 'aRightBWrong', 'bRightAWrong'];
const pick8 = (r) => ({ gamesCompared: r.gamesCompared, agreed: r.agreed, bothRight: r.bothRight, bothWrong: r.bothWrong, aRightBWrong: r.aRightBWrong, bRightAWrong: r.bRightAWrong });
const leagueOf = (opts) => fx.buildLeague({ calculateWeeklyResults, ...opts });
const h2h = (L, a, b) => headToHeadRecord(a, b, { weeks: L.weeks, games: L.games, picks: L.picks, isPublic: arePicksPublic });
const standingsOf = (L) => calculateSeasonStandings(L.players, L.weeklyResults, L.weeks, null);
const packOf = (L, over = {}) => ({
  competitionId: null, sport: null, players: L.players, weeks: L.weeks, allWeeks: L.weeks, games: L.games, picks: L.picks, weeklyResults: L.weeklyResults, standings: standingsOf(L),
  entrantsOf: () => L.players, isPublic: arePicksPublic, picksRead: () => true, confirmedStatusFor: (w) => w.status, tieContexts: null, threadCount: () => 2, ...over,
});

// ═══ [1] ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[1] headToHeadRecord - Drew (p1) vs Brayden (p2), derived by hand from the fixture…');
{
  const fin = h2h(leagueOf({ w2: 'final' }), 'p1', 'p2');
  assert(eq(pick8(fin), { gamesCompared: 9, agreed: 5, bothRight: 3, bothWrong: 2, aRightBWrong: 2, bRightAWrong: 2 }),
    `1a: both weeks final - 9 compared, agreed on 5 (g11 g14 g15 g22 g23), both right on 3, both wrong on 2, Drew alone on 2 (g12 g13), Brayden alone on 2 (g21 g24) (got ${JSON.stringify(pick8(fin))})`);
  assert(eq(fin.splits.map((s) => s.gameId), ['g24', 'g21', 'g13', 'g12']), `1b: the games they split on, NEWEST first: week 2 before week 1, later kickoff first (got ${JSON.stringify(fin.splits.map((s) => s.gameId))})`);
  assert(fin.splits.length === fin.gamesCompared - fin.agreed && fin.agreed + fin.splits.length === fin.gamesCompared, '1c: splits are exactly compared minus agreed - the list can never disagree with the counts');
  assert(eq(fin.splits[0], { weekId: 'w2', gameId: 'g24', aTeam: 'UCLA', bTeam: 'USC', aResult: 'loss', bResult: 'win' }), `1d: g24 - Drew took UCLA and missed, Brayden took USC and covered (got ${JSON.stringify(fin.splits[0])})`);
  assert(fin.finished === 9 && fin.through && fin.through.weekNumber === 2, `1e: finished games and the latest week with one (the header's words): ${fin.finished}, week ${fin.through && fin.through.weekNumber}`);

  const live = h2h(leagueOf({ w2: 'live' }), 'p1', 'p2');
  assert(eq(pick8(live), { gamesCompared: 6, agreed: 3, bothRight: 2, bothWrong: 1, aRightBWrong: 2, bRightAWrong: 1 }),
    `1f: week 2 LIVE (only g21 is final) - the live week is public, so its finished game counts and the live / scheduled ones do not (got ${JSON.stringify(pick8(live))})`);
  assert(live.through.weekNumber === 2 && live.finished === 6, '1g: …and the header names week 2 (a finished game inside a live week)');

  for (const st of ['open', 'locked']) {
    const L = leagueOf({ w2: st, w2Finals: ['g21', 'g22', 'g23', 'g24'] });       // every game of the unrevealed week is FINAL (RG-45), so a leak has something to count
    const r = h2h(L, 'p1', 'p2');
    assert(L.games.filter((g) => g.weekId === 'w2').every((g) => g.status === 'final') && eq(pick8(r), { gamesCompared: 5, agreed: 3, bothRight: 2, bothWrong: 1, aRightBWrong: 2, bRightAWrong: 0 }) && r.splits.every((s) => s.weekId === 'w1'),
      `1h: week 2 ${st.toUpperCase()} - with all four of its games FINAL - contributes NOTHING: only week 1's five games (got ${JSON.stringify(pick8(r))})`);
  }
  const inOpen = h2h(leagueOf({ w2: 'open', w2Finals: ['g21'] }), 'p1', 'p2');
  assert(inOpen.gamesCompared === 5 && !inOpen.splits.some((s) => s.gameId === 'g21'), '1i: RG-45 - a FINAL game sitting inside an OPEN week is not counted: the week is not public, so the game is not either');
  const lopen = leagueOf({ w2: 'open', w2Finals: ['g21'] });
  assert(lopen.games.find((g) => g.gameId === 'g21').status === 'final', '1j: (fixture check) g21 really is final inside the open week, so 1i is not passing on an empty fixture');
  const swapped = h2h(leagueOf({ w2: 'final' }), 'p2', 'p1');
  assert(swapped.aRightBWrong === 2 && swapped.bRightAWrong === 2 && swapped.agreed === 5 && swapped.splits[0].aTeam === 'USC', '1k: the roles swap with the arguments (A is always the first member given)');
  const none = h2h(leagueOf({ w2: 'final' }), 'p1', 'p9');
  assert(none.gamesCompared === 0 && none.splits.length === 0, '1l: a member with no pick on any game compares zero games (not an error, not a made-up record)');
}

// ═══ [2] ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[2] PARITY with the SCRIBE tool - the app and @scribe can never give two answers…');
{
  let cells = 0, mismatches = [];
  for (const st of ['final', 'live', 'open', 'locked']) {
    for (const finals of [[], ['g21']]) {
      const L = leagueOf({ w2: st, w2Finals: finals, w3: st === 'final' });
      const ids = L.players.map((p) => p.playerId);
      for (let i = 0; i < ids.length; i++) for (let j = 0; j < ids.length; j++) {
        if (i === j) continue;
        cells++;
        const mine = pick8(h2h(L, ids[i], ids[j]));
        const theirs = tools.toolGetHeadToHeadRecord({ playerA: ids[i], playerB: ids[j] }, { weeks: L.weeks, games: L.games, picks: L.picks });
        const want = pick8(theirs);
        if (!eq(mine, want)) mismatches.push(`${st}/${finals.join('+') || '-'}/${ids[i]}v${ids[j]}: ${JSON.stringify(mine)} vs ${JSON.stringify(want)}`);
      }
    }
  }
  assert(cells === 4 * 2 * 30 && mismatches.length === 0, `2a: ${cells} (state x forced-final x ordered pair) cells equal the tool's six counts (${mismatches.slice(0, 2).join(' ; ') || 'none differ'})`);
  const L = leagueOf({ w2: 'final' });
  const t = tools.toolGetHeadToHeadRecord({ playerA: 'p1', playerB: 'p2' }, { weeks: L.weeks, games: L.games, picks: L.picks });
  assert(t.gamesCompared === 9 && t.agreed === 5, '2b: (control) the tool itself says 9 / 5 for the hand-derived pair - the parity above compares two real answers, not two zeros');
  const o = tools.toolGetHeadToHeadRecord({ playerA: 'p1', playerB: 'p2' }, { weeks: leagueOf({ w2: 'open' }).weeks, games: leagueOf({ w2: 'open' }).games, picks: leagueOf({ w2: 'open' }).picks });
  assert(o.gamesCompared === 5, '2c: (control) the tool also leaves the Open week out - the two reveal rules are one rule');
}

// ═══ [3] ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[3] The reveal gate fails closed…');
{
  const L = leagueOf({ w2: 'final' });
  const base = { weeks: L.weeks, games: L.games, picks: L.picks };
  assert(headToHeadRecord('p1', 'p2', base).gamesCompared === 0, '3a: no isPublic predicate compares NOTHING - a caller that forgets the gate leaks nothing');
  assert(headToHeadRecord('p1', 'p2', { ...base, isPublic: 'yes' }).gamesCompared === 0, '3b: a non-function predicate compares nothing');
  assert(headToHeadRecord('p1', 'p2', { ...base, isPublic: () => { throw new Error('boom'); } }).gamesCompared === 0, '3c: a predicate that THROWS closes the week');
  assert(headToHeadRecord('p1', 'p2', { ...base, isPublic: () => 1 }).gamesCompared === 0 && headToHeadRecord('p1', 'p2', { ...base, isPublic: () => 'true' }).gamesCompared === 0, '3d: only an exact true opens a week (1 and "true" do not)');
  assert(headToHeadRecord('p1', 'p2', { ...base, isPublic: (w) => w.weekId === 'w1' }).gamesCompared === 5, '3e: (control) the predicate decides week by week - w1 only is 5 games');
  assert(headToHeadRecord('p1', 'p1', { ...base, isPublic: () => true }).gamesCompared === 0 && headToHeadRecord('', 'p2', { ...base, isPublic: () => true }).gamesCompared === 0 && headToHeadRecord(null, 'p2', { ...base, isPublic: () => true }).gamesCompared === 0,
    '3f: the same person twice, an empty id and a null id compare nothing');
  const rows = headToHeadRecord('p1', 'p2', { ...base, isPublic: () => true });
  assert(!Object.keys(rows).some((k) => /tiebreak|guess|pickId/i.test(k)) && rows.splits.every((s) => !('selectedTeam' in s) && !('playerId' in s) && !('pickId' in s)), '3g: the record carries counts and the two members\' own teams and results - no pick object, no id, no tiebreaker');
}

// ═══ [4] ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[4] The comparison model - Standings\' own rows, the denominators in words, and one competition at a time…');
{
  const L = leagueOf({ w2: 'final' });
  const m = compare.buildComparison(packOf(L), { viewerId: 'p1', rivalId: 'p2' });
  assert(m.state === 'ok' && m.title === 'You vs Brayden', `4a: state ok, title "You vs Brayden" (got ${m.state} / ${m.title})`);
  assert(m.header.text === 'Through Week 2 · 9 finished games', `4b: the header names its denominator: "${m.header.text}"`);
  assert(eq(m.h2h, { compared: 9, agreed: 5, split: 4, youCovered: 2, rivalCovered: 2, bothRight: 3, bothWrong: 2 }), `4c: Head to head - 9 both picked, agreed 5, split 4, 2 and 2 (got ${JSON.stringify(m.h2h)})`);
  const rows = Object.fromEntries(m.season.rows.map((r) => [r.key, r]));
  const truth = standingsOf(L);
  const t1 = truth.find((s) => s.playerId === 'p1'), t2 = truth.find((s) => s.playerId === 'p2');
  assert(rows.rank.you === '2nd of 6' && rows.rank.rival === '3rd of 6', `4d: Rank is Standings' - 2nd of 6 and 3rd of 6 (got ${rows.rank.you} / ${rows.rank.rival})`);
  assert(rows.picks.you === `${t1.totalCorrect}–${t1.totalIncorrect}` && rows.picks.rival === `${t2.totalCorrect}–${t2.totalIncorrect}` && rows.picks.you === '5–4', `4e: Picks is the WEIGHTED pair straight from the standings row (5–4), not a recount (got ${rows.picks.you})`);
  assert(rows.winpct.you === `${t1.winPct}%` && rows.winpct.you === '55.6%', `4f: Win % is the standings' RAW ratio (${rows.winpct.you})`);
  assert(rows.weeks.you === `${t1.weeklyWins}–${t1.weeklyLosses}` && rows.weeks.you === '1–0' && rows.weeks.rival === '0–0', `4g: Weeks is the group-collapsed weekly record (1–0 and 0–0), a zero printed as a zero (got ${rows.weeks.you} / ${rows.weeks.rival})`);
  assert(rows.best.you === 'Week 1, 4–1' && rows.best.rival === 'Week 2, 3–1', `4h: Best week from the revealed view's raw rows (got ${rows.best.you} / ${rows.best.rival})`);
  assert(rows.upsets.you === '1' && rows.upsets.rival === '1', `4i: Upsets called (g13 for Drew, g21 for Brayden) (got ${rows.upsets.you} / ${rows.upsets.rival})`);
  assert(m.season.header === 'Through Week 2 · 2 finalized weeks' && m.season.footnote === 'Picks count each game’s multiplier. Win % counts every pick once.',
    `4j: the Season card names ITS tier ("${m.season.header}") and carries the weighted-versus-raw sentence verbatim`);
  assert(m.header.text !== m.season.header, '4k: the two reveal tiers are labelled differently - finished games in revealed weeks versus finalized weeks');

  // TWO TALLIES (CONVENTIONS #22): one 2x game makes Picks (weighted, drives rank) differ from the raw count Win % uses - the card shows each as Standings does, never one for the other.
  {
    const Lw = leagueOf({ w2: 'final' });
    Lw.games = Lw.games.map((g) => (g.gameId === 'g12' ? { ...g, multiplier: 2 } : g));                  // g12: Drew covered it
    Lw.weeklyResults = ['w1', 'w2'].flatMap((id) => calculateWeeklyResults(id, Lw.players, Lw.picks.filter((p) => p.weekId === id), Lw.games.filter((g) => g.weekId === id), null));
    const row1 = standingsOf(Lw).find((x) => x.playerId === 'p1');
    const mw = compare.buildComparison(packOf(Lw, { standings: standingsOf(Lw) }), { viewerId: 'p1', rivalId: 'p2' });
    const rw = Object.fromEntries(mw.season.rows.map((r) => [r.key, r]));
    assert(row1.totalCorrect === 6 && row1.totalCorrectCount === 5 && row1.totalIncorrect === 4, `4w0: (fixture) Drew is 6–4 WEIGHTED and 5–4 RAW with the 2x game (${row1.totalCorrect}–${row1.totalIncorrect} / ${row1.totalCorrectCount}–${row1.totalIncorrectCount})`);
    assert(rw.picks.you === '6–4' && rw.winpct.you === '55.6%', `4w: Picks reads the WEIGHTED 6–4 while Win % reads the RAW 5 of 9 = 55.6% - not 6/10 = 60% (got ${rw.picks.you} / ${rw.winpct.you})`);
    assert(rw.best.you === 'Week 1, 4–1', `4wb: Best week is the RAW pair the weekly update prints (4–1), not the weighted 5–1 (got ${rw.best.you})`);
  }

  // Week 2 LIVE: the head-to-head tier moves on, the Season tier does not.
  const lv = compare.buildComparison(packOf(leagueOf({ w2: 'live' })), { viewerId: 'p1', rivalId: 'p2' });
  assert(lv.header.text === 'Through Week 2 · 6 finished games' && lv.season.header === 'Through Week 1 · 1 finalized week', `4l: inside a live week the header says "${lv.header.text}" while the Season card still says "${lv.season.header}" - two tiers, each honest`);

  // TWO COMPETITIONS (DI-594): 8-2 in CFB and 3-7 in NFL is never 11-9.
  const mk = (pfx, sport, n, outFor, weekN) => {
    const games = [], picks = [];
    for (let i = 0; i < n; i++) {
      const g = fx.mkGame({ id: `${pfx}${i}`, weekId: `${pfx}w`, kick: `2026-10-0${1 + (i % 7)}T1${i % 10}:00:00.000Z`, home: `${sport}H${i}`, away: `${sport}A${i}`, kind: 'cover', state: 'final' });
      games.push(g);
      picks.push(...fx.mkPicks(g, 'cover', outFor(i), fx.PLAYERS));
    }
    return { week: fx.mkWeek({ id: `${pfx}w`, n: weekN, status: 'final' }), games, picks };
  };
  const cfb = mk('c', 'CFB', 10, (i) => (i < 8 ? 'WL----' : 'LW----'), 1);        // Drew 8-2, Brayden 2-8
  const nfl = mk('n', 'NFL', 10, (i) => (i < 3 ? 'WL----' : 'LW----'), 1);        // Drew 3-7, Brayden 7-3
  const mkPack = (part, roster, code) => {
    const results = calculateWeeklyResults(part.week.weekId, roster, part.picks, part.games, null);
    return { competitionId: `comp-${code}`, sport: { label: code === 'cfb' ? 'College Football' : 'NFL', code: code.toUpperCase() }, players: roster, weeks: [part.week], allWeeks: [part.week], games: part.games, picks: part.picks, weeklyResults: results,
      standings: calculateSeasonStandings(roster, results, [part.week], null), entrantsOf: () => roster, isPublic: arePicksPublic, picksRead: () => true, confirmedStatusFor: (w) => w.status, tieContexts: null, threadCount: () => 0 };
  };
  const cfbRoster = fx.PLAYERS.slice(0, 3), nflRoster = fx.PLAYERS.slice(0, 2);
  const both = [{ id: 'comp-cfb', code: 'CFB', label: 'College Football' }, { id: 'comp-nfl', code: 'NFL', label: 'NFL' }];
  const mc = compare.buildComparison(mkPack(cfb, cfbRoster, 'cfb'), { viewerId: 'p1', rivalId: 'p2', competitions: both });
  const mn = compare.buildComparison(mkPack(nfl, nflRoster, 'nfl'), { viewerId: 'p1', rivalId: 'p2', competitions: both });
  const rc = Object.fromEntries(mc.season.rows.map((r) => [r.key, r])), rn = Object.fromEntries(mn.season.rows.map((r) => [r.key, r]));
  assert(rc.picks.you === '8–2' && rn.picks.you === '3–7', `4m: Drew is 8–2 in CFB and 3–7 in NFL on their OWN screens (got ${rc.picks.you} / ${rn.picks.you})`);
  assert(rc.rank.you === '1st of 3' && rn.rank.you === '2nd of 2', `4n: the rank's denominator is the competition's roster (1st of 3 in CFB, 2nd of 2 in NFL) - never a league-wide "of 6" (got ${rc.rank.you} / ${rn.rank.you})`);
  const allText = JSON.stringify([mc, mn]) + compare.comparisonHTML(mc, { escHtml: esc }) + compare.comparisonHTML(mn, { escHtml: esc });
  assert(!/11[–-]9|\b55%|overall|combined|19 (games|picks)|\b20 (games|picks)/i.test(allText.replace(/finished games/g, '')) , '4o: no screen shows 11–9, an "overall" rank, a combined win % or a summed game count');
  assert(mc.controls.length === 2 && mc.controls.find((c) => c.selected).id === 'comp-cfb' && mn.controls.find((c) => c.selected).id === 'comp-nfl', '4p: both members play both sports, so the sport control exists and its selection follows the pack');
  assert(mc.sport.code === 'CFB' && mn.sport.code === 'NFL', '4q: the competition label comes from the pack');
  // a CFB-only member opening an NFL comparison
  const kevinNfl = compare.buildComparison(mkPack(nfl, nflRoster, 'nfl'), { viewerId: 'p3', rivalId: 'p1', rivalName: 'Drew', competitions: [] });
  assert(kevinNfl.state === 'viewer-not-entered' && /isn't|aren't entered in NFL/.test(kevinNfl.sentence) && !/0[–-]0|0%/.test(JSON.stringify(kevinNfl)), `4r: a CFB-only member in an NFL comparison gets "${kevinNfl.sentence}" - no zeros`);
  const dewNfl = compare.buildComparison(mkPack(nfl, nflRoster, 'nfl'), { viewerId: 'p1', rivalId: 'p3', rivalName: 'Kevin', competitions: [] });
  assert(dewNfl.state === 'rival-not-entered' && dewNfl.sentence === "Kevin isn't entered in NFL, so there's nothing to compare.", `4s: the rival not entered - the DI's exact sentence (got "${dewNfl.sentence}")`);
  assert(compare.buildComparison(mkPack(nfl, nflRoster, 'nfl'), { viewerId: 'p1', rivalId: 'p9' }) === null, '4t: someone who is not a member of the league has no comparison at all (null = the calm unavailable state)');
  assert(compare.buildComparison(packOf(L), { viewerId: 'p1', rivalId: 'p1' }) === null && compare.buildComparison(packOf(L), { viewerId: null, rivalId: 'p2' }) === null && compare.buildComparison(null, { viewerId: 'p1', rivalId: 'p2' }) === null,
    '4u: yourself, a signed-out viewer and no pack are all null');
  assert(compare.buildComparison(packOf(L), { viewerId: 'p1', rivalId: 'p2', competitions: [both[0]] }).controls.length === 0, '4v: one shared sport shows no control (the DI: only when BOTH members are entered in BOTH)');
}

// ═══ [5] ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[5] The blind rule through the model and the markup…');
{
  const html = (L, over = {}) => compare.comparisonHTML(compare.buildComparison(packOf(L, over), { viewerId: 'p1', rivalId: 'p2' }), { escHtml: esc });
  for (const st of ['open', 'locked']) {
    const L = leagueOf({ w2: st, w2Finals: ['g21'] });
    const m = compare.buildComparison(packOf(L), { viewerId: 'p1', rivalId: 'p2' });
    const h = compare.comparisonHTML(m, { escHtml: esc });
    assert(m.h2h.compared === 5 && m.header.text === 'Through Week 1 · 5 finished games', `5a (${st}): week 2 is not revealed - the header stops at Week 1 and counts 5 games (got "${m.header.text}")`);
    assert(!/Oregon|Washington|Miami|Florida State|Penn State|Iowa|USC|UCLA/.test(h), `5b (${st}): not ONE team from the unrevealed week (including the final game inside it, g21) reaches the markup`);
    assert(m.splits.every((s) => s.weekId === 'w1'), `5c (${st}): the split list holds week 1's games only`);
    const season = m.season.header;
    assert(season === 'Through Week 1 · 1 finalized week', `5d (${st}): the Season tier is week 1 only (${season})`);
  }
  // before ANY week is revealed
  const none = leagueOf({ w2: 'open' });
  const earlier = { ...none, weeks: none.weeks.map((w) => ({ ...w, status: 'open' })), weeklyResults: [] };
  const mn = compare.buildComparison(packOf(earlier), { viewerId: 'p1', rivalId: 'p2' });
  const hn = compare.comparisonHTML(mn, { escHtml: esc });
  assert(mn.state === 'no-games' && mn.header.text === 'No finished games yet' && /No finished games to compare yet\. Head-to-head fills in as games finish\./.test(hn), '5e: before any week is revealed - the no-games state, in the DI\'s words');
  assert(!/Clemson|Duke|Georgia|Auburn|Texas|Oklahoma|Alabama|LSU|Ohio State|Michigan/.test(hn) && mn.splits.length === 0 && mn.season.rows.length === 0, '5f: …and not one team name, split row or season figure');
  // S-C10: a week that is public here but whose other members' rows have not landed
  const L = leagueOf({ w2: 'final' });
  const unread = compare.buildComparison(packOf(L, { picksRead: (id) => id !== 'w2' }), { viewerId: 'p1', rivalId: 'p2' });
  assert(unread.h2h.compared === 5 && !unread.splits.some((s) => s.weekId === 'w2') && !/Oregon|Washington/.test(compare.comparisonHTML(unread, { escHtml: esc })), '5g: S-C10 - a public week whose rows have not landed contributes nothing to Head to head (and none of its teams are named)');
  const allUnread = compare.buildComparison(packOf(L, { picksRead: () => false }), { viewerId: 'p1', rivalId: 'p2' });
  assert(allUnread.state === 'no-games', '5h: …and with no week landed the comparison is the no-games state');
  // demo and hidden weeks
  const demo = leagueOf({ w2: 'final' });
  demo.weeks = demo.weeks.map((w) => (w.weekId === 'w2' ? { ...w, dataSourceMode: 'demo' } : w));
  assert(compare.buildComparison(packOf(demo), { viewerId: 'p1', rivalId: 'p2' }).h2h.compared === 5, '5i: a DEMO week is out of every comparison (UN-71)');
  const hidden = leagueOf({ w2: 'final' });
  hidden.weeks = hidden.weeks.map((w) => (w.weekId === 'w2' ? { ...w, showInHistory: false } : w));
  assert(compare.buildComparison(packOf(hidden), { viewerId: 'p1', rivalId: 'p2' }).h2h.compared === 5, '5j: a week hidden from history is out too (Standings\' own rule)');
  const draft = leagueOf({ w2: 'final' });
  draft.weeks = draft.weeks.map((w) => (w.weekId === 'w2' ? { ...w, status: 'draft' } : w));
  assert(compare.buildComparison(packOf(draft), { viewerId: 'p1', rivalId: 'p2' }).h2h.compared === 5, '5k: a DRAFT week is out');
  // the model never carries another member's pick or a tiebreaker
  const mdl = compare.buildComparison(packOf(L), { viewerId: 'p1', rivalId: 'p2' });
  const json = JSON.stringify(mdl);
  assert(!/p3|p4|p5|p6|Kevin|Koby|Jacob|Kihoon/.test(json), '5l: only the two members compared appear anywhere in the model - none of the other four, by id or by name');
  assert(!/tiebreak/i.test(json) && !/tiebreak/i.test(compare.comparisonHTML(mdl, { escHtml: esc })), '5m: no tiebreaker value anywhere (CONVENTIONS #23)');
  assert(html(L).includes('Head to head') && html(L).includes('Season') && html(L).includes('Games you split on'), '5n: (control) a fully revealed league does draw all three cards');
}

// ═══ [6] ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[6] Entrants - a member counts for a week only if the week\'s entrants include them…');
{
  const L = leagueOf({ w2: 'final' });
  const entrants = (w) => (w.weekId === 'w1' ? L.players.filter((p) => p.playerId !== 'p4') : L.players);   // Koby joined after week 1
  const m = compare.buildComparison(packOf(L, { entrantsOf: entrants }), { viewerId: 'p1', rivalId: 'p4' });
  assert(m.h2h.compared === 4 && m.splits.every((s) => s.weekId === 'w2'), `6a: Koby was not in week 1, so only week 2's four games are compared (got ${m.h2h.compared})`);
  assert(m.season.notes.length === 1 && m.season.notes[0] === 'Koby was entered in 1 of 2 finalized weeks.', `6b: the denominator is said in words: "${m.season.notes[0]}"`);
  const m2 = compare.buildComparison(packOf(L), { viewerId: 'p1', rivalId: 'p2' });
  assert(m2.season.notes.length === 0, '6c: nobody missed a week, so no note');
  const bothMissed = compare.buildComparison(packOf(L, { entrantsOf: (w) => (w.weekId === 'w1' ? L.players.filter((p) => p.playerId === 'p2') : L.players) }), { viewerId: 'p1', rivalId: 'p2' });
  assert(bothMissed.h2h.compared === 4 && bothMissed.season.notes.some((n) => /^You were entered in 1 of 2/.test(n)), '6d: when the viewer was the one who missed a week, the note says "You were entered in 1 of 2…" and the head-to-head skips it');
}

// ═══ [7] ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[7] The comparison markup…');
{
  const L = leagueOf({ w2: 'final' });
  const m = compare.buildComparison(packOf(L), { viewerId: 'p1', rivalId: 'p2' });
  const h = compare.comparisonHTML(m, { escHtml: esc });
  let threw = false; try { compare.comparisonHTML(m, {}); } catch (e) { threw = /requires an injected escHtml/.test(String(e.message)); }
  assert(threw, '7a: the escaper is REQUIRED - there is no String() fallback (CONVENTIONS #12)');
  assert(h.includes('Through Week 2 · 9 finished games') && h.includes('Games you both picked: <b class="cmp-n">9</b>') && h.includes('You agreed on <b class="cmp-n">5</b> · split on <b class="cmp-n">4</b>')
    && h.includes('When you split: you covered <b class="cmp-n">2</b>, Brayden covered <b class="cmp-n">2</b>'), '7b: the DI\'s sentences, verbatim, with the numbers set off');
  assert(/class="cmp-bar" role="img" aria-label="You covered 2, Brayden covered 2, of the games you split on"/.test(h) && (h.match(/class="cmp-bar-a"/g) || []).length === 2 && (h.match(/class="cmp-bar-b"/g) || []).length === 2,
    '7c: the two-segment bar is one block per game they split on (2 + 2) with the numbers spoken - never colour alone');
  assert(!/ style="/.test(h), '7d: no inline style anywhere in the screen');
  assert(h.includes('role="group" aria-label="Rank, you 2nd of 6, Brayden 3rd of 6"'), '7e: each Season row is read once as "label, you {x}, {name} {y}" (DI-595 VoiceOver)');
  assert(h.includes('Picks count each game’s multiplier. Win % counts every pick once.'), '7f: the weighted-versus-raw sentence is on the Season card');
  const items = h.match(/<li class="hx-item[^"]*" data-key="[^"]+">/g) || [];
  assert(items.length === 4 && /data-key="g24"/.test(items[0]), `7g: four split rows, newest first (got ${items.length})`);
  assert(/data-cmp-action="open-game" data-cmp-game="g24"/.test(h) && /data-cmp-action="open-thread" data-cmp-game="g24"/.test(h) && !/<button[^>]*>(?:(?!<\/button>)[\s\S])*<button/.test(h), '7h: every row has a game button and a SIBLING Thread button - never one button inside another');
  assert(/Thread · 2<\/button>/.test(h) && /aria-label="Thread, 2 messages, UCLA at USC"/.test(h), '7i: "Thread · {n}" with the count, spoken in full');
  const noChat = compare.comparisonHTML(compare.buildComparison(packOf(L, { threadCount: () => null }), { viewerId: 'p1', rivalId: 'p2' }), { escHtml: esc });
  assert(!/open-thread|Thread ·/.test(noChat) && /open-game/.test(noChat), '7j: chat off (a null count) draws no Thread button and keeps the game button');
  // review B1: a game older than what the device has loaded - chat ON, but the number would be a guess - is a bare "Thread"; chat OFF is still no button at all
  const bare = compare.comparisonHTML(compare.buildComparison(packOf(L, { threadLoaded: (id) => id !== 'g24' }), { viewerId: 'p1', rivalId: 'p2' }), { escHtml: esc });
  assert(/data-cmp-game="g24" aria-label="Thread, UCLA at USC">Thread<\/button>/.test(bare) && /Thread · 2<\/button>/.test(bare) && (bare.match(/>Thread<\/button>/g) || []).length === 1,
    '7j2: B1 - the one game older than the loaded log shows a bare "Thread" (its accessible name has no count) while the others keep "Thread · 2"');
  const bareOff = compare.comparisonHTML(compare.buildComparison(packOf(L, { threadCount: () => null, threadLoaded: () => false }), { viewerId: 'p1', rivalId: 'p2' }), { escHtml: esc });
  assert(!/open-thread|>Thread</.test(bareOff), '7j3: …and with chat OFF "not loaded" draws no button either (chat off wins)');
  assert(/aria-label="UCLA at USC, Week 2\. You UCLA missed, Brayden USC covered\. Opens the game"/.test(h), '7k: the row\'s spoken label names the matchup, the week, both picks and results, and that it opens the game');
  assert(h.includes('✗') && h.includes('✓') && /hx-mark hx-mark--loss/.test(h) && /hx-mark hx-mark--win/.test(h), '7l: final marks are solid ✓ / ✗');
  assert(!compare.comparisonHTML(m, { escHtml: esc }).includes('data-cmp-action="show-all"'), '7m: four split rows need no "Show all"');
  // more than ten
  const many = { ...m, splits: Array.from({ length: 13 }, (_, i) => ({ ...m.splits[0], gameId: `x${i}` })) };
  const hm = compare.comparisonHTML(many, { escHtml: esc });
  assert((hm.match(/hx-item--extra/g) || []).length === 3 && /data-cmp-action="show-all" aria-expanded="false">Show all 13</.test(hm) && /data-cmp-list data-expanded="false"/.test(hm), '7n: thirteen rows - ten shown, three behind "Show all 13" (aria-expanded false)');
  // the sport control + chip
  const two = compare.buildComparison(packOf(L, { competitionId: 'comp-cfb', sport: { label: 'College Football', code: 'CFB' } }), { viewerId: 'p1', rivalId: 'p2', competitions: [{ id: 'comp-cfb', code: 'CFB', label: 'College Football' }, { id: 'comp-nfl', code: 'NFL', label: 'NFL' }] });
  const ht = compare.comparisonHTML(two, { escHtml: esc });
  assert(/role="radiogroup" aria-label="Sport"/.test(ht) && /role="radio" aria-checked="true" aria-label="College Football" data-cmp-action="sport" data-cmp-sport="comp-cfb">CFB</.test(ht) && /aria-checked="false" aria-label="NFL" data-cmp-action="sport" data-cmp-sport="comp-nfl">NFL</.test(ht), '7o: the segmented control is a radiogroup of radios, selection spoken, CFB · NFL');
  assert(!/cd-sport/.test(ht), '7p: with the control showing, the eyebrow chip is not repeated');
  const one = compare.buildComparison(packOf(L, { competitionId: 'comp-cfb', sport: { label: 'College Football', code: 'CFB' } }), { viewerId: 'p1', rivalId: 'p2' });
  assert(/<span class="cd-sport">CFB<\/span>/.test(compare.comparisonHTML(one, { escHtml: esc })) && !/cd-sport/.test(h), '7q: a multi-sport league names the sport (S2); a one-sport league names none (S1)');
  // hostile strings
  const evil = '"><img src=x onerror=alert(1)>';
  const L2 = leagueOf({ w2: 'final' });
  L2.players = L2.players.map((p) => (p.playerId === 'p2' ? { ...p, displayName: evil } : p));
  L2.games = L2.games.map((g) => (g.gameId === 'g24' ? { ...g, homeTeam: evil, awayTeam: `${evil}2` } : g));
  L2.picks = L2.picks.map((p) => (p.gameId === 'g24' ? { ...p, selectedTeam: p.selectedTeam === 'USC' ? evil : `${evil}2` } : p));
  const he = compare.comparisonHTML(compare.buildComparison(packOf(L2, { standings: standingsOf(L2) }), { viewerId: 'p1', rivalId: 'p2' }), { escHtml: esc });
  assert(!/<img/i.test(he) && !/onerror=alert\(1\)>/.test(he.replace(/&quot;&gt;&lt;img[^]*?&gt;/g, '')) && he.includes('&lt;img src=x onerror=alert(1)&gt;'), '7r: a hostile display name, team name and pick stay inert text at every sink (body, bar label, aria-label)');
  assert(!/aria-label="[^"]*"[^>]*>[^<]*<img/.test(he) && (he.match(/"/g) || []).length % 2 === 0, '7s: no attribute is broken out of - the quote count stays even');
  // unavailable
  const un = compare.unavailableComparisonHTML({ escHtml: esc });
  assert(/This comparison isn't available right now\./.test(un) && /It may have been updated, or you may not be signed in\./.test(un) && /data-cmp-action="back">Back</.test(un) && !/Standings/.test(un), '7t: the unavailable state says what happened, why and what to do (a plain "Back" when it is not told where it returns)');
  const unChat = compare.unavailableComparisonHTML({ escHtml: esc, backLabel: 'Chat' }), unStand = compare.unavailableComparisonHTML({ escHtml: esc, backLabel: 'Standings' });
  const unEvil = compare.unavailableComparisonHTML({ escHtml: esc, backLabel: '"><img src=x onerror=alert(1)>' });
  assert(/data-cmp-action="back">Back to Chat</.test(unChat) && /data-cmp-action="back">Back to Standings</.test(unStand) && !/<img/.test(unEvil) && unEvil.includes('Back to &quot;&gt;&lt;img'),
    '7t2: N1 - the button names the screen it returns to ("Back to Chat" from a share, "Back to Standings" from Standings), the label escaped at the sink');
  const unNfl = compare.unavailableComparisonHTML({ escHtml: esc, backLabel: 'Chat', notEnteredIn: 'NFL' }), unAny = compare.unavailableComparisonHTML({ escHtml: esc, notEnteredIn: '' });
  const unHostile = compare.unavailableComparisonHTML({ escHtml: esc, notEnteredIn: '<i>X</i>' });
  assert(/<p class="cd-body">You're not entered in NFL picks, so it isn't shown to you\.<\/p>/.test(unNfl) && !/signed in/.test(unNfl) && /<p class="cd-body">You're not entered in this sport, so it isn't shown to you\.<\/p>/.test(unAny)
    && !/<i>/.test(unHostile) && unHostile.includes('&lt;i&gt;X&lt;/i&gt;') && /may not be signed in/.test(compare.unavailableComparisonHTML({ escHtml: esc })),
    '7t3: pass 3 - a signed-in reader NOT entered in the sport is told so in plain words ("You\'re not entered in NFL picks, so it isn\'t shown to you."), never "you may not be signed in"; the general wording stays for every other case; the sport is escaped');
  assert(compare.comparisonHTML(null, { escHtml: esc }) === un, '7u: a null model renders that same calm state');
  const ne = compare.comparisonHTML(compare.buildComparison(packOf(L, { players: L.players.filter((p) => p.playerId !== 'p1') }), { viewerId: 'p1', rivalId: 'p2' }), { escHtml: esc });
  assert(/You aren't entered in this competition, so there's nothing to compare\./.test(ne) && !/Head to head/.test(ne), '7v: a viewer who is not in the competition gets the sentence, not zeros');
}

// ═══ [8] ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[8] The rival picker…');
{
  const L = leagueOf({ w2: 'final' });
  const ch = compare.rivalChoices({ players: L.players, viewerId: 'p1', rivalId: 'p3' });
  assert(ch.length === 5 && !ch.some((c) => c.playerId === 'p1') && ch.filter((c) => c.current).length === 1 && ch.find((c) => c.current).playerId === 'p3', '8a: everyone BUT the viewer, one marked current - comparing yourself is prevented');
  assert(compare.rivalChoices({ players: [], viewerId: 'p1' }).length === 0 && compare.rivalChoices({}).length === 0, '8b: an empty roster is an empty list, not a throw');
  const h = compare.rivalPickerBodyHTML({ choices: ch, sportLabel: 'NFL' }, { escHtml: esc });
  assert((h.match(/data-cmp-action="pick-rival"/g) || []).length === 5 && /aria-pressed="true"/.test(h) && (h.match(/aria-pressed="false"/g) || []).length === 4, '8c: five rows, the current one pressed');
  assert(/<span class="sr-only">Current<\/span>/.test(h) && /<p class="cmp-picker-sub">NFL<\/p>/.test(h), '8d: the check is spoken as "Current" and the sport is named');
  const none = compare.rivalPickerBodyHTML({ choices: [] }, { escHtml: esc });
  assert(/No one else has joined yet, so there is nobody to compare with\./.test(none), '8e: nobody else - the DI\'s empty state, no dead list');
  let threw = false; try { compare.rivalPickerBodyHTML({ choices: ch }, {}); } catch { threw = true; }
  assert(threw, '8f: the escaper is required here too');
  const evil = compare.rivalPickerBodyHTML({ choices: [{ playerId: 'x"><b>', name: '<script>alert(1)</script>', current: false }] }, { escHtml: esc });
  assert(!/<script|<b>/.test(evil) && evil.includes('&lt;script&gt;'), '8g: a hostile name and id stay inert');
}

// ═══ [9] ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[9] The week detail model…');
{
  const wk = (L, id) => L.weeks.find((w) => w.weekId === id);
  const rowsOf = (L, id) => L.weeklyResults.filter((r) => r.weekId === id);
  const packW = (L, id, over = {}) => {
    const res = rowsOf(L, id);
    return { weekId: id, title: `Week ${wk(L, id).weekNumber}`, sport: null, members: [wk(L, id)], finalParts: 1, status: 'final', winner: res.find((r) => r.isWinner) || null, loser: res.find((r) => r.isLoser) || null, tieLines: [],
      standingsHtml: '<tr><td>1</td></tr>', players: L.players, games: L.games, picks: L.picks, viewerId: 'p1', viewerParts: [id], isPublic: arePicksPublic, picksRead: () => true, liveEntryFor: () => null, now: Date.parse('2026-09-20T00:00:00Z'),
      formatKickoff: (iso) => `K ${iso}`, threadCount: () => 4, ...over };
  };
  const L = leagueOf({ w2: 'final' });
  const m = wd.buildWeekDetail(packW(L, 'w2'));
  assert(m.state === 'final' && m.result.status === 'Final' && m.result.winner.name === 'Jacob' && m.result.winner.record === '4–0' && m.result.loser.name === 'Kevin' && m.result.loser.record === '0–4',
    `9a: Week 2 is Final: Jacob (4–0) won, Kevin (0–4) lost - the RAW pair, from Weekly History's own rows (got ${JSON.stringify(m.result)})`);
  assert(m.games.length === 4 && eq(m.games.map((g) => g.gameId), ['g21', 'g22', 'g23', 'g24']) && m.games.every((g) => g.phase === 'final'), '9b: four games in kickoff order, all final');
  const g21 = m.games[0];
  assert(g21.split && g21.split.text === '4–2', `9c: g21's split is 4–2 (Washington 4: Brayden, Koby, Jacob, Kihoon - Oregon 2: Drew, Kevin) - away first (got ${g21.split && g21.split.text})`);
  assert(g21.matchup === 'Washington at Oregon' && g21.score === 'Washington 20 – Oregon 17' && g21.cover === 'Washington covered by 10', `9d: the matchup, the score and "{team} covered by {x}" (got ${g21.matchup} / ${g21.score} / ${g21.cover})`);
  assert(g21.mine.team === 'Oregon' && g21.mine.mark === '✗' && g21.mine.word === 'missed' && m.games[2].mine.mark === '✓', '9e: the viewer\'s OWN chip - Drew took Oregon and missed g21, took Penn State and covered g23');
  assert(g21.threads === 4, '9f: "Thread · n" carries the count');
  assert(m.standingsHtml === '<tr><td>1</td></tr>' && m.progress === '' && m.pooled === false, '9g: the standings fragment is spliced as given, and there is no in-progress sentence');
  // review B1: a bare Thread for a game older than the loaded log; review B3: Standings' sentence under the table (only where a table is)
  const barem = wd.buildWeekDetail(packW(L, 'w2', { threadLoaded: (id) => id !== 'g21' }));
  assert(barem.games[0].threads === null && barem.games[0].threadBare === true && barem.games[1].threads === 4 && barem.games[1].threadBare === false, '9f2: B1 - threadLoaded(false) makes the row a bare Thread (no count); a loaded game keeps its 4');
  const hb = wd.weekDetailHTML(barem, { escHtml: esc });
  assert(/data-wd-game="g21" aria-label="Thread, Washington at Oregon">Thread<\/button>/.test(hb) && /Thread · 4<\/button>/.test(hb), '9f3: …drawn as "Thread" with an accessible name that carries no number');
  const offm = wd.buildWeekDetail(packW(L, 'w2', { threadCount: () => null, threadLoaded: () => false }));
  assert(offm.games.every((g) => g.threads === null && g.threadBare === false) && !/open-thread/.test(wd.weekDetailHTML(offm, { escHtml: esc })), '9f4: chat OFF draws no Thread button even for a game the device has not loaded');
  const SENT = 'Picks count each game’s multiplier. Win % counts every pick once.';
  const hs = wd.weekDetailHTML(m, { escHtml: esc });
  assert(m.footnote === SENT && wd.WEEK_DETAIL_COPY.footnote === SENT && (hs.match(/<p class="cd-fresh wd-foot">/g) || []).length === 1 && hs.indexOf('wd-foot') > hs.indexOf('</table>') && hs.indexOf('wd-foot') < hs.indexOf('</section>', hs.indexOf('</table>')),
    '9g2: B3 - Standings\' sentence is under the table, inside the standings card, once');
  const noTable = wd.buildWeekDetail(packW(L, 'w2', { standingsHtml: '', standingsPending: true }));
  assert(noTable.footnote === '' && !/wd-foot/.test(wd.weekDetailHTML(noTable, { escHtml: esc })), '9g3: …and not where no rank is shown (the standings waiting on the rows)');
  assert(JSON.stringify(m).indexOf('p2') < 0 || !/"selectedTeam"|"playerId":"p[2-6]"/.test(JSON.stringify(m)), '9h: no other member\'s pick object or id is in the model - only counts per side');
  const noPick = wd.buildWeekDetail(packW(L, 'w2', { picks: L.picks.filter((p) => !(p.playerId === 'p1' && p.gameId === 'g22')) }));
  assert(noPick.games[1].mine.tone === 'none' && noPick.games[1].mine.word === 'no pick', '9i: a game the viewer made no pick on says so');
  const signedOut = wd.buildWeekDetail(packW(L, 'w2', { viewerId: null }));
  assert(signedOut.games.every((g) => g.mine === null) && signedOut.state === 'final', '9j: signed out (S4) - no personal chip, the week still opens');
  // S-C10
  const unread = wd.buildWeekDetail(packW(L, 'w2', { picksRead: () => false }));
  assert(unread.games.every((g) => g.split === null) && unread.games[0].mine.team === 'Oregon', '9k: S-C10 - the split (other members\' rows) waits for the rows to land; the viewer\'s own pick does not');
  // Pass 3, R2 (DI-599 / PF-455 acceptance 2) and D1 (DI-591 S2/C7): a signed-in member who is NOT an entrant of a part (another sport; a late joiner's pre-join week) gets nothing personal there - never
  // "No pick" - and no per-side count. `viewerParts` names the parts the viewer IS an entrant of; a pack without it is read as "none" (fail closed: no chip, never a "No pick").
  const outsider = wd.buildWeekDetail(packW(L, 'w2', { viewerId: 'p3', viewerParts: [] }));
  assert(outsider.state === 'final' && outsider.games.length === 4 && outsider.games.every((g) => g.mine === null && g.split === null) && outsider.standingsHtml === '<tr><td>1</td></tr>',
    '9ac: R2 / D1 - a signed-in NON-entrant: no personal chip on any game (never "no pick"), no per-side split, and the standings still show');
  const ho = wd.weekDetailHTML(outsider, { escHtml: esc });
  assert(!/No pick|Your pick|You made no pick|You picked|Split|League split/.test(ho) && /Washington covered by 10/.test(ho) && /Standings for the week/.test(ho), '9ad: …nor in the markup or any aria-label: the rows are matchup, score and cover only');
  assert(!/hx-picks/.test(ho) && (wd.weekDetailHTML(m, { escHtml: esc }).match(/<span class="hx-picks" aria-hidden="true">/g) || []).length === 4, '9ad2: (polish) a non-entrant\'s rows draw no empty picks column (it would add an 8 pt gap under the cover line); an entrant\'s four rows keep theirs');
  const legacy = wd.buildWeekDetail(packW(L, 'w2', { viewerParts: undefined }));
  assert(legacy.games.every((g) => g.mine === null && g.split === null), '9ae: a pack that does not say which parts are the viewer\'s is read as NONE (fail closed: no chip, no split)');
  const outSigned = wd.buildWeekDetail(packW(L, 'w2', { viewerId: null, viewerParts: [] }));
  assert(outSigned.games.every((g) => g.mine === null) && outSigned.games[0].split && outSigned.games[0].split.text === '4–2', '9af: S4 is unchanged - a signed-OUT viewer has no personal chip and keeps the league split (the rule is about a MEMBER who is not entered)');
  {
    const pa2 = { ...wk(L, 'w1'), groupId: 'grp' }, pb2 = { ...wk(L, 'w2'), groupId: 'grp' };
    const perPart = wd.buildWeekDetail({ ...packW(L, 'w1'), viewerParts: ['w2'], members: [pa2, pb2], finalParts: 2, status: 'final', winner: null, loser: null, standingsHtml: '' });
    const p1 = perPart.games.filter((g) => g.weekId === 'w1'), p2 = perPart.games.filter((g) => g.weekId === 'w2');
    assert(p1.length === 5 && p1.every((g) => g.mine === null && g.split === null) && p2.length === 4 && p2.every((g) => g.mine !== null && g.split !== null),
      '9ag: R2 per PART - in a pooled group the viewer is personal (chip and split) only on the part they were entered in (Part 2 here, a late joiner); Part 1 shows neither');
  }
  // not public
  for (const st of ['open', 'locked', 'draft']) {
    const closed = leagueOf({ w2: st });
    assert(wd.buildWeekDetail(packW(closed, 'w2', { standingsHtml: '' })) === null, `9l (${st}): a week that is not public has NO detail (null = the calm unavailable state)`);
  }
  // live
  const live = leagueOf({ w2: 'live' });
  const T0 = Date.parse('2026-09-12T12:00:00Z');                                   // before week 2's first kickoff, so the unplayed games are 'upcoming' and g22's capture is fresh
  const lm = wd.buildWeekDetail(packW(live, 'w2', { finalParts: 0, status: 'in-progress', winner: null, loser: null, standingsHtml: '', now: T0, liveEntryFor: (id) => (id === 'g22' ? { name: 'STATUS_IN_PROGRESS', shortDetail: 'Q3 4:12', capturedAt: T0 } : null) }));
  assert(lm.state === 'in-progress' && lm.result.status === 'In progress' && lm.progress === 'Results post when the week is final.' && lm.result.winner === null && lm.standingsHtml === '', '9m: a live week is In progress - one sentence, no winner, no standings');
  const gl = lm.games.find((g) => g.gameId === 'g22');
  assert(gl.phase === 'live' && gl.cover === '' && (gl.mine.tone === 'covering' || gl.mine.tone === 'trailing') && gl.mine.mark !== '✓' && gl.mine.mark !== '✗', `9n: a LIVE game is tentative - ▲ / ▽, never ✓ / ✗, no "covered by" (got ${JSON.stringify(gl.mine)} / "${gl.cover}")`);
  const texts = lm.games.filter((g) => g.phase !== 'final').flatMap((g) => [g.status, g.cover, g.mine && g.mine.word, g.score]).filter(Boolean);
  assert(texts.length > 0 && texts.every((t) => !containsBannedLiveWord(t)), `9o: no banned word (won / lost / clinched / decided) on any game that is not final (${texts.join(' | ')})`);
  assert(lm.games.find((g) => g.gameId === 'g21').cover === 'Washington covered by 10' && lm.games.find((g) => g.gameId === 'g23').phase === 'upcoming', '9p: the finished game in the live week is settled; the unplayed ones are DI-570 "upcoming"');
  // pooled
  const pa = { ...wk(L, 'w1'), groupId: 'grp' }, pb = { ...wk(live, 'w2'), groupId: 'grp' };
  const pool = wd.buildWeekDetail({ ...packW(L, 'w1'), title: 'Week 1 + Week 2', members: [pa, pb], finalParts: 1, status: 'in-progress', winner: null, loser: null, standingsHtml: '', games: [...L.games.filter((g) => g.weekId === 'w1'), ...live.games.filter((g) => g.weekId === 'w2')], picks: L.picks });
  assert(pool.pooled && pool.state === 'in-progress' && pool.progress === 'Results post when every part is final. 1 of 2 parts are final.' && pool.result.winner === null, `9q: a pooled group with one part still live - "${pool.progress}", no winner named`);
  assert(pool.games.filter((g) => g.part === 'Part 1').length === 5 && pool.games.filter((g) => g.part === 'Part 2').length === 4, '9r: the games are labelled Part 1 / Part 2');
  const poolDone = wd.buildWeekDetail({ ...packW(L, 'w1'), title: 'Week 1 + Week 2', members: [pa, { ...wk(L, 'w2'), groupId: 'grp' }], finalParts: 2, status: 'final', winner: L.weeklyResults.find((r) => r.isWinner), loser: L.weeklyResults.find((r) => r.isLoser), standingsHtml: '<tr></tr>' });
  assert(poolDone.state === 'final' && poolDone.pooled && poolDone.standingsHtml === '<tr></tr>' && poolDone.progress === '', '9s: once EVERY part is final the group has its result and its standings');
  const partClosed = wd.buildWeekDetail({ ...packW(L, 'w1'), members: [pa, { ...wk(leagueOf({ w2: 'open' }), 'w2'), groupId: 'grp' }], finalParts: 1, status: 'in-progress', winner: null, loser: null, standingsHtml: '', games: [...L.games] });
  assert(!partClosed.games.some((g) => g.weekId === 'w2') && partClosed.progress === 'Results post when every part is final. 1 of 2 parts are final.', '9t: a part that is not public contributes no games at all (the blind rule), and the sentence still counts it');
  // the standings cannot be drawn yet (rows not landed): said plainly
  const pend = wd.buildWeekDetail(packW(L, 'w2', { standingsHtml: '', standingsPending: true }));
  assert(pend.state === 'final' && pend.standingsHtml === '' && pend.standingsNote === "The week's standings appear once everyone's picks have loaded." && wd.weekDetailHTML(pend, { escHtml: esc }).includes('role="status"><p class="cd-sentence">The week\'s standings appear'),
    '9aa: a final week whose standings cannot be drawn yet says so (never a half-built table, never silence)');
  assert(m.standingsNote === '', '9ab: …and a week whose standings are drawn carries no such note');
  // no results
  const nores = wd.buildWeekDetail(packW(L, 'w2', { winner: null, loser: null, standingsHtml: '' }));
  assert(nores.state === 'no-results' && nores.result.winner === null && nores.games.length === 4, '9u: a final week with no result rows is "no-results" - it names no winner, and its games still show');
  assert(wd.buildWeekDetail(packW(L, 'w2', { members: [] })) === null && wd.buildWeekDetail(null) === null, '9v: nothing to show is null');
  // tie lines
  const tie = wd.buildWeekDetail(packW(L, 'w2', { tieLines: ['Tie: Jacob won. Tiebreaker off by 3, Kevin off by 7'] }));
  assert(eq(tie.result.tie, ['Tie: Jacob won. Tiebreaker off by 3, Kevin off by 7']), '9w: the tie-break line appears only when the pack carries one (Weekly History\'s own text)');
  assert(m.result.tie.length === 0, '9x: …and not otherwise');
  // sport
  const s2 = wd.buildWeekDetail(packW(L, 'w2', { sport: { label: 'NFL', code: 'NFL' }, title: 'NFL · Week 2' }));
  assert(s2.title === 'NFL · Week 2' && s2.sport.code === 'NFL', '9y: the sport rides on the title in a multi-sport league');
  // push
  const pushL = leagueOf({ w2: 'final' });
  const pushGame = pushL.games.find((g) => g.gameId === 'g22');
  pushGame.homeScore = 24; pushGame.awayScore = 21; pushGame.atsWinner = 'no_decision';
  const pm = wd.buildWeekDetail(packW(pushL, 'w2'));
  assert(pm.games.find((g) => g.gameId === 'g22').cover === 'Push' && pm.games.find((g) => g.gameId === 'g22').mine.mark === '—', '9z: a push says Push and the pick shows the neutral dash');
}

// ═══ [10] ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[10] The week detail markup…');
{
  const L = leagueOf({ w2: 'final' });
  const res = L.weeklyResults.filter((r) => r.weekId === 'w2');
  const pk = { weekId: 'w2', title: 'Week 2', sport: null, members: [L.weeks[1]], finalParts: 1, status: 'final', winner: res.find((r) => r.isWinner), loser: res.find((r) => r.isLoser), tieLines: ['Tie: Jacob won.'], standingsHtml: '<tr><td>x</td></tr>',
    players: L.players, games: L.games, picks: L.picks, viewerId: 'p1', viewerParts: ['w2'], isPublic: arePicksPublic, picksRead: () => true, liveEntryFor: () => null, now: Date.parse('2026-09-20T00:00:00Z'), formatKickoff: (i) => i, threadCount: () => 1 };
  const m = wd.buildWeekDetail(pk);
  const h = wd.weekDetailHTML(m, { escHtml: esc });
  let threw = false; try { wd.weekDetailHTML(m, {}); } catch (e) { threw = /requires an injected escHtml/.test(String(e.message)); }
  assert(threw, '10a: the escaper is REQUIRED');
  assert(h.includes('<span class="cd-reason">Final</span>') && h.includes('<dt>Winner</dt><dd>Jacob (4–0)</dd>') && h.includes('<dt>Loser</dt><dd>Kevin (0–4)</dd>') && h.includes('Tie: Jacob won.'), '10b: the result card');
  assert(h.includes('<h4 class="cd-h" id="wd-h-standings">Standings for the week</h4>') && h.includes('<tbody><tr><td>x</td></tr></tbody>'), '10c: the standings block splices the Dashboard\'s own finished rows');
  assert((h.match(/class="hx-item"/g) || []).length === 4 && /data-wd-action="open-game" data-wd-game="g21"/.test(h) && /data-wd-action="open-thread" data-wd-game="g21"/.test(h), '10d: four game rows, each a game button with a sibling Thread button');
  assert(/Washington 20 – Oregon 17/.test(h) && /Washington covered by 10/.test(h) && /<span class="hx-who">Split<\/span> 4–2/.test(h) && /<span class="hx-who">Your pick<\/span> Oregon <span class="hx-mark hx-mark--loss">✗<\/span>/.test(h), '10e: score, cover line, split and the viewer\'s chip');
  assert(/aria-label="Washington at Oregon\. Washington 20 – Oregon 17\. Washington covered by 10\. League split 4 picked Washington, 2 picked Oregon\. You picked Oregon, missed\. Opens the game"/.test(h), '10f: the row is spoken once in full');
  assert(!/ style="/.test(h) && !/<button[^>]*>(?:(?!<\/button>)[\s\S])*<button/.test(h), '10g: no inline style; no button inside a button');
  const live = leagueOf({ w2: 'live' });
  const hl = wd.weekDetailHTML(wd.buildWeekDetail({ ...pk, members: [live.weeks[1]], finalParts: 0, games: live.games, status: 'in-progress', winner: null, loser: null, standingsHtml: '' }), { escHtml: esc });
  assert(/Results post when the week is final\./.test(hl) && !/Standings for the week/.test(hl) && !/Winner|Loser/.test(hl), '10h: in progress - the sentence replaces the result and the standings');
  const pooled = wd.weekDetailHTML(wd.buildWeekDetail({ ...pk, title: 'Week 1 + Week 2', members: [{ ...L.weeks[0], groupId: 'g' }, { ...live.weeks[1], groupId: 'g' }], finalParts: 1, games: [...L.games.filter((g) => g.weekId === 'w1'), ...live.games.filter((g) => g.weekId === 'w2')], status: 'in-progress', winner: null, loser: null, standingsHtml: '' }), { escHtml: esc });
  assert(/<h5 class="wd-part">Part 1<\/h5>/.test(pooled) && /<h5 class="wd-part">Part 2<\/h5>/.test(pooled), '10i: a pooled group draws its parts under Part 1 / Part 2');
  const nores = wd.weekDetailHTML(wd.buildWeekDetail({ ...pk, winner: null, loser: null, standingsHtml: '' }), { escHtml: esc });
  assert(/Results for this week aren't available\./.test(nores) && /Games<\/h4>/.test(nores), '10j: no result rows - said plainly, and the games still show');
  const un = wd.unavailableWeekDetailHTML({ escHtml: esc });
  assert(/This week isn't available right now\./.test(un) && /It may have been updated, or it may not be open to everyone yet\./.test(un) && /data-wd-action="back">Back</.test(un) && !/Standings/.test(un) && wd.weekDetailHTML(null, { escHtml: esc }) === un, '10k: the unavailable state (and a null model renders it)');
  const wHome = wd.unavailableWeekDetailHTML({ escHtml: esc, backLabel: 'Home' }), wEvil = wd.unavailableWeekDetailHTML({ escHtml: esc, backLabel: '<b>x</b>' });
  assert(/data-wd-action="back">Back to Home</.test(wHome) && !/<b>/.test(wEvil) && wEvil.includes('Back to &lt;b&gt;x&lt;/b&gt;') && wd.weekDetailHTML(null, { escHtml: esc, backLabel: 'Home' }) === wHome,
    '10k2: N1 - "Back to {the screen it opened above}" (Home from the Final card, Chat from a share, a game from "See week results"), escaped at the sink');
  const evil = '"><img src=x onerror=alert(1)>';
  const L2 = leagueOf({ w2: 'final' });
  const res2 = L2.weeklyResults.filter((r) => r.weekId === 'w2').map((r) => (r.isWinner ? { ...r, displayName: evil } : r));
  const g2 = L2.games.map((g) => (g.gameId === 'g21' ? { ...g, homeTeam: evil, awayTeam: `${evil}2` } : g));
  const p2 = L2.picks.map((p) => (p.gameId === 'g21' && p.playerId === 'p1' ? { ...p, selectedTeam: evil } : p));
  const he = wd.weekDetailHTML(wd.buildWeekDetail({ ...pk, winner: res2.find((r) => r.isWinner), loser: res2.find((r) => r.isLoser), games: g2, picks: p2 }), { escHtml: esc });
  assert(!/<img/i.test(he) && he.includes('&lt;img src=x onerror=alert(1)&gt;') && (he.match(/"/g) || []).length % 2 === 0, '10l: a hostile winner name, team names and pick stay inert at every sink including aria-label');
  const noThread = wd.weekDetailHTML(wd.buildWeekDetail({ ...pk, threadCount: () => null }), { escHtml: esc });
  assert(!/open-thread|Thread ·/.test(noThread), '10m: chat off - no Thread button');
}

// ═══ [11] ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[11] Source pins…');
{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');
  const cs = strip(read('./js/compare.js')), ws = strip(read('./js/week-detail.js')), st = strip(read('./js/stats.js'));
  for (const [name, src] of [['compare.js', cs], ['week-detail.js', ws]]) {
    assert(!/from '\.\/storage\.js'|from '\.\/auth\.js'|from '\.\/chat\.js'|from '\.\/competition\.js'/.test(src) && !/\b(getPicks|getAllPicks|getWeeklyResults|getPlayers|getWeeks|getGames|localStorage|document\.|window\.)\b/.test(src),
      `11a (${name}): a LEAF - it imports no storage, auth, chat or competition module and calls no reader, no document, no window`);
    assert(!/\.filter\(\s*\(?\s*p\s*\)?\s*=>\s*p\s*&&\s*p\.active/.test(src) && !/\bp\.active\b|\.active\b/.test(src), `11b (${name}): it never asks the league's active list - every roster is handed in per competition (DI-594)`);
    assert(!/escHtml\s*\|\|\s*String|typeof escHtml/.test(src) && /requireEscHtml\(escHtml/.test(src), `11c (${name}): the escaper is required, never defaulted`);
  }
  assert(!/arePicksPublic|canViewOtherPicks/.test(cs) && !/arePicksPublic|canViewOtherPicks/.test(ws), '11d: neither screen module names a reveal function - the gate arrives as `isPublic`, one place, from the app');
  assert(/isPublic/.test(st.slice(st.indexOf('export function headToHeadRecord'), st.indexOf('export function memberSeasonStats'))) && !/storage\.js/.test(st), '11e: headToHeadRecord takes its gate as a parameter, and stats.js still imports no storage');
  assert(/export function headToHeadRecord/.test(st) && /gate/.test(cs) && /pack\.isPublic\(w\) === true && pack\.picksRead\(w\.weekId\) === true/.test(cs), '11f: the comparison hands headToHeadRecord the server\'s reveal AND the S-C10 flag, as one gate');
}

// ═══ [12] ════════════════════════════════════════════════════════════════════════════════
_log('\n[12] DI-597 - the shared comparison: its reference, its headline, and the screen a THIRD member reads…');
{
  // the id: two member tokens (the sharer first), plus the sport in a league that runs several; nothing else
  const CID1 = '11111111-1111-4111-8111-111111111111';
  assert(compare.compareShareId({ aId: 'p1', bId: 'p2' }) === 'p1:p2' && compare.compareShareId({ aId: 'p1', bId: 'p2', competitionId: CID1 }) === `p1:p2:${CID1}`, '12a: compareShareId builds "{a}:{b}" and "{a}:{b}:{sport}"');
  const badBuild = [{ aId: 'p1', bId: 'p1' }, { aId: '', bId: 'p2' }, { aId: 'p1', bId: 'p2;x' }, { aId: 'p 1', bId: 'p2' }, { aId: 'p1', bId: 'p2', competitionId: '<b>' }, { aId: 7, bId: 'p2' }, { aId: 'p1', bId: 'x'.repeat(65) }, {}];
  assert(badBuild.every((b) => compare.compareShareId(b) === null), '12b: the same member twice, an empty / spaced / markup / long / non-string token: no id');
  assert(eq(compare.parseCompareShareId('p1:p2'), { aId: 'p1', bId: 'p2', competitionId: null }) && eq(compare.parseCompareShareId(`p1:p2:${CID1}`), { aId: 'p1', bId: 'p2', competitionId: CID1 }), '12c: parseCompareShareId round-trips both shapes');
  const badParse = ['', 'p1', 'p1:p1', 'p1:p2:a:b', 'p1::p2', ':p1:p2', 'p1:p2:', ' p1:p2', 'p1:p2 ', 'p1:p2;<img>', 'p1:p2\n', '_p1:p2', 'p1:p2:' + 'x'.repeat(70), null, undefined, 7, {}, ['p1:p2']];
  assert(badParse.every((b) => compare.parseCompareShareId(b) === null), `12d: eighteen malformed ids parse to null (${badParse.filter((b) => compare.parseCompareShareId(b) !== null).map(String).join(' | ') || 'all null'})`);
  // the model's share: offered by the app, for a comparison that has games, with an allow-listed headline
  const L = leagueOf({ w2: 'final' });
  const withShare = (over = {}, who = {}) => compare.buildComparison(packOf(L, { canShare: true, ...over }), { viewerId: 'p1', rivalId: 'p2', ...who });
  const sm = withShare();
  assert(sm.share && eq(sm.share.ref, { type: 'compare', id: 'p1:p2' }) && sm.share.line === 'Drew vs Brayden: Head to head and season' && sm.share.gameTag === '' && !/\d/.test(sm.share.line), '12e: canShare -> { ref: compare p1:p2, a two-name headline, no figure, no game tag }');
  const ms = withShare({ sport: { label: 'College Football', code: 'CFB' }, competitionId: CID1 });
  assert(eq(ms.share.ref, { type: 'compare', id: `p1:p2:${CID1}` }) && ms.share.line === 'CFB · Drew vs Brayden: Head to head and season', '12f: in a several-sport league the reference names the sport and the headline leads with its code');
  const none = leagueOf({ w2: 'open' });
  const early = { ...none, weeks: none.weeks.map((w) => ({ ...w, status: 'open' })), weeklyResults: [] };
  assert(compare.buildComparison(packOf(L), { viewerId: 'p1', rivalId: 'p2' }).share === null && compare.buildComparison(packOf(L, { canShare: false }), { viewerId: 'p1', rivalId: 'p2' }).share === null
    && compare.buildComparison(packOf(early, { canShare: true }), { viewerId: 'p1', rivalId: 'p2' }).share === null, '12g: no share unless the app offers it AND the comparison has games (nothing revealed -> nothing to share)');
  const hs = compare.comparisonHTML(sm, { escHtml: esc });
  assert(/<div class="cd-actions"><button type="button" class="btn cd-action cd-action--secondary" data-cmp-action="share"><span class="cd-action-icon" aria-hidden="true"><svg/.test(hs) && /Share to chat<\/button><\/div><\/div>$/.test(hs) && !/data-cmp-action="share"/.test(compare.comparisonHTML(compare.buildComparison(packOf(L), { viewerId: 'p1', rivalId: 'p2' }), { escHtml: esc })),
    '12h: the button is the last thing on the screen, a secondary action with the share glyph, and absent without a share');
  // THE THIRD MEMBER'S SCREEN: both sides named, never "you"
  const th = compare.buildComparison(packOf(L), { viewerId: 'p2', rivalId: 'p3', neutral: true });
  const tHtml = compare.comparisonHTML(th, { escHtml: esc });
  assert(th.title === 'Brayden vs Kevin' && th.perspective === 'third' && compare.buildComparison(packOf(L), { viewerId: 'p2', rivalId: 'p3' }).title === 'You vs Kevin', '12i: neutral: the title names both ("Brayden vs Kevin"); the default is still "You vs Kevin"');
  assert(!/\b[Yy]ou\b/.test(tHtml.replace(/<[^>]+>/g, ' ')) && !/\b[Yy]ou\b/.test(tHtml.match(/aria-label="[^"]*"/g).join(' ')), '12j: not one "you" in the neutral screen\'s text or its accessible names');
  assert(/Games they both picked: /.test(tHtml) && /They agreed on /.test(tHtml) && /When they split: Brayden covered /.test(tHtml) && /Games they split on/.test(tHtml) && /<span class="hx-who">Brayden<\/span>/.test(tHtml) && /Brayden covered \d+, Kevin covered \d+, of the games they split on/.test(tHtml),
    '12k: the sentences are rewritten for two named members ("Games they both picked", "They agreed on", "When they split: Brayden covered…")');
  assert(JSON.stringify(th.h2h) === JSON.stringify(compare.buildComparison(packOf(L), { viewerId: 'p2', rivalId: 'p3' }).h2h), '12l: …and the figures are exactly the ones the same pair gets as "You vs": one derivation, two wordings');
  // the blind rule is the same code: an Open or Locked week contributes nothing to a third member's screen either
  for (const st of ['open', 'locked']) {
    const Lc = leagueOf({ w2: st, w2Finals: ['g21'] });
    const h = compare.comparisonHTML(compare.buildComparison(packOf(Lc), { viewerId: 'p2', rivalId: 'p3', neutral: true }), { escHtml: esc });
    assert(!/Oregon|Washington|Miami|Florida State|Penn State|Iowa|USC|UCLA/.test(h), `12m (${st}): the third member's screen names not ONE team from the unrevealed week`);
  }
  const ne = compare.buildComparison(packOf(L, { players: L.players.filter((p) => p.playerId !== 'p2') }), { viewerId: 'p2', rivalId: 'p3', viewerName: 'Brayden', neutral: true });
  assert(ne && ne.state === 'viewer-not-entered' && ne.sentence === "Brayden isn't entered in this competition, so there's nothing to compare.", `12n: a first side who is not entered reads as a name, not as "You" (${ne && ne.sentence})`);
}

_log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
