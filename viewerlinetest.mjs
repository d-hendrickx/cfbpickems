/**
 * CFB Pickems — viewerlinetest.mjs (Deployment 1, Lane B, DI-577 / 582 / 583 and the X1 competitions seam, 2026-10-07)
 * ===================================================================================================================
 * The LOGIC under the pinned card's personal line and the "every live game" scope. This is data and rules, not layout: Drew's Game Day feedback (2026-10-07) is redesigning how the
 * Live Peek card LOOKS, and none of this renders. It is exported from home.js so the revised card can adopt it unchanged.
 *
 *   [1] viewerWeekLine (stats.js)  — the viewer's own RAW week record, from the same evaluatePick the weekly update uses; parity with calculateWeeklyResults; fails closed
 *   [2] normalizeCompetitions      — Lane A's list (X1) or ONE default; never throws, never invents a sport word
 *   [3] viewerStatsFor             — "Your week" and "Season": parity with Standings; per-competition; nothing is blended across competitions (DI-594)
 *   [4] liveScope                  — every live game the summary and the peek speak for: the week GROUP, every competition's current week, blind per part, game order
 *   [5] MUTATION PROOFS            — scratch copies loaded as data: URLs (run after [6] in the file order below)
 *   [6] THE LANE A SEAM            — Home's competitions FROM the feed contexts (homeFeedContexts): a week's sport is its competition's (R1), "of N" counts the competition's entrants (C4), the per-week
 *                                    entry (C1), What's next skips a week no competition holds, and the card detail's view through a week is that week's competition only
 *
 * Run:  node viewerlinetest.mjs
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { installDom, mkHomeEnv, NOW, MIN, HOUR } from './d1homeenv.mjs';

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}
const read = (rel) => readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const doc = installDom();
const home = await import('./js/home.js');
const stats = await import('./js/stats.js');
const storage = await import('./js/storage.js');
const { calculateWeeklyResults, calculateSeasonStandings } = await import('./js/scoring.js');
const { ordinal } = await import('./js/feed-cards.js');
const fx = await import('./statsfixtures.mjs');
const HOME_SRC = await read('./js/home.js');

const league = (w2 = 'final', o = {}) => fx.buildLeague({ w2, calculateWeeklyResults, ...o });
const snapOf = (L, { viewer = 'p1', admin = false, competitions = null, liveEntryFor = null, cur = null } = {}) => {
  const e = mkHomeEnv({ home }, doc, L, {
    viewer, admin, read: { currentWeek: () => cur || L.weeks[L.weeks.length - 1] },
    deps: { ...(competitions ? { competitions: () => competitions } : {}), ...(liveEntryFor ? { liveEntryFor } : {}) },
    chat: { scribe: [], lockerRoom: [] },
  });
  return { e, snap: e.home.assembleSnapshot({ viewerId: viewer, isCommissioner: admin, now: NOW + 3 * 24 * HOUR }) };
};
const curOf = (L) => L.weeks[L.weeks.length - 1];

// ═══ [1] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[1] stats.viewerWeekLine…');
{
  const L = league('final');
  let parity = 0, total = 0;
  for (const wk of L.weeks) for (const p of L.players) {
    const row = L.weeklyResults.find(r => r.weekId === wk.weekId && r.playerId === p.playerId);
    const line = stats.viewerWeekLine({ week: wk, games: L.games, picks: L.picks, viewerId: p.playerId });
    total++;
    if (row && line && line.wins === (row.correctCount ?? row.correctPicks) && line.losses === (row.incorrectCount ?? row.incorrectPicks)) parity++;
  }
  assert(parity === total && total === 12, `1a: for all 6 players in both weeks the line equals calculateWeeklyResults' own RAW correctCount / incorrectCount (${parity}/${total}) — parity, not a recomputation`);
  const w2 = L.weeks[1];
  const byP = Object.fromEntries(L.players.map(p => { const l = stats.viewerWeekLine({ week: w2, games: L.games, picks: L.picks, viewerId: p.playerId }); return [p.playerId, `${l.wins}-${l.losses}`]; }));
  assert(JSON.stringify(byP) === JSON.stringify({ p1: '1-3', p2: '3-1', p3: '0-4', p4: '2-2', p5: '4-0', p6: '2-2' }), `1b: week 2's hand-derived records {p1 1-3, p2 3-1, p3 0-4, p4 2-2, p5 4-0, p6 2-2} (got ${JSON.stringify(byP)})`);
  const l1 = stats.viewerWeekLine({ week: w2, games: L.games, picks: L.picks, viewerId: 'p1' });
  assert(l1.graded === 4 && l1.picked === 4 && l1.pushes === 0, '1c: graded = wins + losses + pushes; picked counts the picks made on the week');
  // fail closed
  for (const bad of [null, undefined, '', 5, {}, []]) assert(stats.viewerWeekLine({ week: w2, games: L.games, picks: L.picks, viewerId: bad }) === null, `1d: viewerId ${JSON.stringify(bad)} → null (S-C3: never "the first pick found")`);
  assert(stats.viewerWeekLine({ week: null, games: L.games, picks: L.picks, viewerId: 'p1' }) === null && stats.viewerWeekLine() === null && stats.viewerWeekLine({}) === null, '1e: no week / no arguments → null, never a throw');
  // only the viewer's own picks: removing every other member's picks changes nothing
  const own = L.picks.filter(p => p.playerId === 'p1');
  assert(JSON.stringify(stats.viewerWeekLine({ week: w2, games: L.games, picks: own, viewerId: 'p1' })) === JSON.stringify(l1), '1f: the line reads ONLY the viewer\'s own picks — without any other member\'s picks the answer is identical (it cannot depend on them)');
  assert(stats.viewerWeekLine({ week: w2, games: L.games, picks: L.picks.filter(p => p.playerId !== 'p1'), viewerId: 'p1' }).picked === 0, '1g: with none of the viewer\'s picks the line is 0 picked (another member\'s pick is never substituted)');
  // live / scheduled picks are picked but not graded
  const Lv = league('live');
  const lv = stats.viewerWeekLine({ week: Lv.weeks[1], games: Lv.games, picks: Lv.picks, viewerId: 'p1' });
  assert(lv.picked === 4 && lv.graded === 1 && lv.wins + lv.losses === 1, `1h: a live week grades only its FINAL games (picked ${lv.picked}, graded ${lv.graded})`);
  // only a FINAL game grades: a delayed / postponed game that still carries a score and a stored atsWinner is not a result (the guard is a belt over evaluatePick, which grades any non-live, non-scheduled status that has an atsWinner)
  const delayed = L.games.map(g => (g.gameId === 'g21' ? { ...g, status: 'delayed', atsWinner: g.homeTeam } : g));
  const dl = stats.viewerWeekLine({ week: w2, games: delayed, picks: L.picks, viewerId: 'p1' });
  assert(dl.picked === 4 && dl.graded === 3 && dl.losses === 2 && dl.wins === 1, `1h2: a delayed game that carries a score and a stored ATS winner is picked but NOT graded (${JSON.stringify(dl)})`);
  // a pick on a game that is not in the week is ignored
  const stray = [...own, { pickId: 'x', weekId: 'w2', gameId: 'nope', playerId: 'p1', selectedTeam: 'Oregon' }];
  assert(stats.viewerWeekLine({ week: w2, games: L.games, picks: stray, viewerId: 'p1' }).picked === 4, '1i: a pick for a game that is not on the week does not count');
  // pushes are their own column, and the line is RAW (a 2x game is still one pick)
  const seq = fx.buildSequence({ codes: 'WLPWL', weekSizes: [5], calculateWeeklyResults });
  const sl = stats.viewerWeekLine({ week: seq.weeks[0], games: seq.games, picks: seq.picks, viewerId: 'p1' });
  assert(sl.wins === 2 && sl.losses === 2 && sl.pushes === 1 && sl.graded === 5, `1j: W L P W L → 2 wins, 2 losses, 1 push (${JSON.stringify(sl)})`);
  const mult = seq.games.map(g => ({ ...g, multiplier: 3 }));
  const ml = stats.viewerWeekLine({ week: seq.weeks[0], games: mult, picks: seq.picks, viewerId: 'p1' });
  assert(ml.wins === 2 && ml.losses === 2, '1k: the figure is RAW — a 3x game still counts as one pick (the weighted tally belongs to Standings, never here)');
  assert(stats.viewerWeekLine({ week: w2, games: null, picks: null, viewerId: 'p1' }).picked === 0, '1l: null games / picks are treated as empty');
}

// ═══ [2] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[2] normalizeCompetitions…');
{
  const n = home.normalizeCompetitions;
  const d1 = n(undefined, 'w2'), d2 = n([], 'w2'), d3 = n('nope', 'w2'), d4 = n([null, 5, {}, { competitionId: '' }], 'w2');
  const exp = [{ competitionId: 'default', sport: 'cfb', label: 'CFB', currentWeekId: 'w2', viewerEntered: true, single: true }];
  assert([d1, d2, d3, d4].every(x => JSON.stringify(x) === JSON.stringify(exp)), '2a: nothing usable → ONE default competition, flagged single, carrying the current week');
  assert(home.DEFAULT_COMPETITION_ID === 'default', '2b: the default competition id is the constant');
  const list = n([{ competitionId: 'cfb', sport: 'cfb', label: 'College football', currentWeekId: 'w2' }, { competitionId: 'nfl', sport: 'nfl', currentWeekId: 'n1', viewerEntered: false }, { competitionId: 'cfb', sport: 'x' }, { competitionId: 'ncaab' }]);
  assert(list.length === 3 && list.every(c => c.single === false), '2c: a real list is kept (a duplicate id dropped) and none of it is "single"');
  assert(list[0].label === 'College football' && list[1].label === 'NFL' && list[2].sport === 'cfb' && list[2].label === 'CFB', '2d: label defaults to the upper-cased sport; sport defaults to cfb');
  assert(list[0].viewerEntered === true && list[1].viewerEntered === false && list[2].viewerEntered === true, '2e: viewerEntered is false only when explicitly false');
  assert(list[2].currentWeekId === null, '2f: a missing current week is null, never undefined');
  const inp = [{ competitionId: 'a', sport: 'nfl' }];
  const before = JSON.stringify(inp);
  n(inp);
  assert(JSON.stringify(inp) === before, '2g: the input is never mutated');
}

// ═══ [3] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[3] viewerStatsFor — Your week / Season…');
{
  const L = league('final');
  const std = calculateSeasonStandings(L.players, L.weeklyResults, L.weeks);
  let ok = 0;
  const seen = [];
  for (const p of L.players) {
    const { snap } = snapOf(L, { viewer: p.playerId });
    const r = home.viewerStatsFor(snap, { cur: curOf(L), state: 'final', viewer: p.playerId });
    const row = std.find(x => x.playerId === p.playerId);
    const stored = L.weeklyResults.find(x => x.weekId === 'w2' && x.playerId === p.playerId);
    const wantWeek = `${stored.correctCount}–${stored.incorrectCount}`;
    const wantSeason = `${ordinal(row.currentRank)} of 6 · ${row.winPct}%`;
    seen.push(wantSeason);
    if (r && r.items.length === 2 && r.items[0].label === 'Your week' && r.items[0].value === wantWeek && r.items[1].label === 'Season' && r.items[1].value === wantSeason && r.notes.length === 0) ok++;
  }
  assert(ok === 6, `3a: for all six players, "Your week" is the stored RAW pair and "Season" is Standings' own rank and Win % (${ok}/6; e.g. ${seen[0]})`);
  const { snap: s1 } = snapOf(L);
  const r1 = home.viewerStatsFor(s1, { cur: curOf(L), state: 'final', viewer: 'p1' });
  assert(r1.items.every(i => !/CFB|NFL|·\s*(CFB|NFL)/.test(i.label)), '3b: a one-sport league has NO sport word on either label (byte-identical to v0.29.0 in this respect)');
  assert(r1.items.map(i => i.key).join() === 'week:default,season:default' && r1.items.every(i => i.sr === ''), '3c: keys are per competition; nothing is announced as provisional for a final week');
  // fail closed
  for (const [v, st] of [[null, 'final'], ['', 'final'], [7, 'final'], ['p1', 'draft'], ['p1', 'no-weeks'], ['p1', ''], ['p1', undefined], ['p1', 'between-seasons']]) assert(home.viewerStatsFor(s1, { cur: curOf(L), state: st, viewer: v }) === null, `3d: viewer ${JSON.stringify(v)} in state ${JSON.stringify(st)} → no line at all`);
  // a live week: provisional week line; season moves only on finalized weeks
  const Lv = league('live');
  const { snap: sv } = snapOf(Lv);
  const rv = home.viewerStatsFor(sv, { cur: curOf(Lv), state: 'live', viewer: 'p1' });
  const std1 = calculateSeasonStandings(Lv.players, Lv.weeklyResults.filter(x => x.weekId === 'w1'), Lv.weeks.filter(w => w.weekId === 'w1'));
  const row1 = std1.find(x => x.playerId === 'p1');
  assert(rv.items[0].value === '0–1 so far' && rv.items[0].sr === 'provisional', `3e: during a live week "Your week" is the graded-so-far pair, marked provisional (${rv.items[0].value})`);
  assert(rv.items[1].value === `${ordinal(row1.currentRank)} of 6 · ${row1.winPct}%`, `3f: …and "Season" stays at the last FINALIZED week — the rank moves only when a week is finalized (${rv.items[1].value})`);
  // nothing graded yet / no picks
  const Ln = league('live'); Ln.games.find(g => g.gameId === 'g21').status = 'scheduled'; Ln.games.find(g => g.gameId === 'g21').homeScore = null; Ln.games.find(g => g.gameId === 'g21').awayScore = null;
  const rn = home.viewerStatsFor(snapOf(Ln).snap, { cur: curOf(Ln), state: 'live', viewer: 'p1' });
  assert(rn.items[0].value === 'No results yet' && rn.items[0].sr === '', '3g: picks made, nothing graded → "No results yet", never 0–0');
  const Lq = league('live'); Lq.picks = Lq.picks.filter(p => !(p.playerId === 'p1' && p.weekId === 'w2'));
  const rq = home.viewerStatsFor(snapOf(Lq).snap, { cur: curOf(Lq), state: 'live', viewer: 'p1' });
  assert(rq.items[0].value === 'No picks this week', '3h: no picks on this week → "No picks this week", never 0–0');
  // an open week: nothing public yet, Season only
  const Lo = league('open');
  const ro = home.viewerStatsFor(snapOf(Lo).snap, { cur: curOf(Lo), state: 'open-pending', viewer: 'p1' });
  assert(ro.items.length === 1 && ro.items[0].label === 'Season', '3i: an open week has no week line (nothing is graded, and the picks are blind) — Season only');
  // never ranked
  const Lz = league('open'); Lz.weeks = [Lz.weeks[1]]; Lz.games = Lz.games.filter(g => g.weekId === 'w2'); Lz.picks = Lz.picks.filter(p => p.weekId === 'w2'); Lz.weeklyResults = [];
  const rz = home.viewerStatsFor(snapOf(Lz).snap, { cur: curOf(Lz), state: 'open-pending', viewer: 'p1' });
  assert(rz.items[0].value === 'Not ranked yet' && rz.items[0].sr === 'No finalized weeks', '3j: before any week is finalized the season reads "Not ranked yet" — never "6th of 6", never a made-up 0%');
  // not entered
  const comps1 = [{ competitionId: 'cfb', sport: 'cfb', label: 'CFB', currentWeekId: 'w2', viewerEntered: false }];
  const rne = home.viewerStatsFor(snapOf(L, { competitions: comps1 }).snap, { cur: curOf(L), state: 'final', viewer: 'p1' });
  assert(rne.items.length === 0 && rne.notes.length === 1 && rne.notes[0] === "You're not entered in CFB picks. You can still follow every game and join the chat.", '3k: a competition the viewer is not entered in is ONE calm sentence — not 0–0, not last place');
  // N > 1: nothing blended
  const nfl = fx.mkGame({ id: 'ng1', weekId: 'n1', kick: '2026-09-13T17:00:00.000Z', home: 'Bills', away: 'Jets', kind: 'cover', state: 'final' });
  const nfl2 = fx.mkGame({ id: 'ng2', weekId: 'n1', kick: '2026-09-13T20:00:00.000Z', home: 'Chiefs', away: 'Raiders', kind: 'cover', state: 'final' });
  const LN = league('final');
  LN.weeks.push(fx.mkWeek({ id: 'n1', n: 1, status: 'final', extra: { sport: 'nfl' } }));
  LN.games.push(nfl, nfl2);
  LN.picks.push(...fx.mkPicks(nfl, 'cover', 'LLWLLL'), ...fx.mkPicks(nfl2, 'cover', 'LLWLLL'));
  LN.weeklyResults.push(...calculateWeeklyResults('n1', LN.players, LN.picks, LN.games.filter(g => g.weekId === 'n1')));
  const comps2 = [{ competitionId: 'cfb', sport: 'cfb', label: 'CFB', currentWeekId: 'w2', viewerEntered: true }, { competitionId: 'nfl', sport: 'nfl', label: 'NFL', currentWeekId: 'n1', viewerEntered: true }];
  const rm = home.viewerStatsFor(snapOf(LN, { viewer: 'p3', competitions: comps2, cur: LN.weeks[1] }).snap, { cur: LN.weeks[1], state: 'final', viewer: 'p3' });
  const cfbStd = calculateSeasonStandings(LN.players, LN.weeklyResults.filter(r => r.weekId !== 'n1'), LN.weeks.filter(w => w.weekId !== 'n1')).find(x => x.playerId === 'p3');
  const nflStd = calculateSeasonStandings(LN.players, LN.weeklyResults.filter(r => r.weekId === 'n1'), LN.weeks.filter(w => w.weekId === 'n1')).find(x => x.playerId === 'p3');
  const blended = calculateSeasonStandings(LN.players, LN.weeklyResults, LN.weeks).find(x => x.playerId === 'p3');
  assert(rm.items.map(i => i.label).join('|') === 'CFB · Your week|CFB · Season|NFL · Your week|NFL · Season', `3l: with two competitions each figure is labelled by its sport (${rm.items.map(i => i.label).join('|')})`);
  assert(rm.items[1].value === `${ordinal(cfbStd.currentRank)} of 6 · ${cfbStd.winPct}%` && rm.items[3].value === `${ordinal(nflStd.currentRank)} of 6 · ${nflStd.winPct}%`, `3m: each Season is computed over exactly ONE competition's weeks (CFB ${rm.items[1].value}, NFL ${rm.items[3].value}) — nothing is ranked across sports (DI-594)`);
  assert(blended.currentRank !== nflStd.currentRank || blended.winPct !== nflStd.winPct, `3n: CONTROL — a blended standings would have said something else (rank ${blended.currentRank}, ${blended.winPct}%), so 3m is sensitive to blending`);
  assert(rm.items[0].value === '0–4' && rm.items[2].value === '2–0', `3o: each "Your week" is that competition's own current week (${rm.items[0].value} / ${rm.items[2].value})`);
  assert(rm.notes.length === 0, '3p: entered in both → no notes');
  const mixed = comps2.map(c => (c.sport === 'nfl' ? { ...c, viewerEntered: false } : c));
  const rx = home.viewerStatsFor(snapOf(LN, { viewer: 'p3', competitions: mixed, cur: LN.weeks[1] }).snap, { cur: LN.weeks[1], state: 'final', viewer: 'p3' });
  assert(rx.items.length === 2 && rx.items.every(i => /^CFB/.test(i.label)) && rx.notes.length === 1 && /NFL/.test(rx.notes[0]), '3q: entered in CFB only → CFB\'s pair plus ONE sentence for NFL (an N>1 league still labels by sport)');
  // blind: a week not yet public contributes no week line even to its own viewer
  const LB = league('final'); LB.weeks[1].status = 'locked'; LB.weeks[1].finalizedAt = null;
  const rb = home.viewerStatsFor(snapOf(LB).snap, { cur: curOf(LB), state: 'locked-far', viewer: 'p1' });
  assert(rb.items.length === 1 && rb.items[0].label === 'Season', '3r: a locked week has no "Your week" line (arePicksPublic is the only gate; never canViewOtherPicks)');
}

// ═══ [4] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[4] liveScope — every live game…');
{
  const mkLive = (ids) => {
    const L = league('live');
    for (const id of ids) { const g = L.games.find(x => x.gameId === id); Object.assign(g, { status: 'live', homeScore: 7, awayScore: 3 }); }
    return L;
  };
  const L = mkLive(['g23', 'g24']);
  const { snap } = snapOf(L);
  const sc = home.liveScope(snap, curOf(L), { now: NOW });
  assert(sc.entries.map(x => x.g.gameId).join() === 'g22,g23,g24' && sc.showSport === false && sc.parts.length === 1, `4a: only status "live" counts (the final g21 and nothing scheduled), in kickoff order (${sc.entries.map(x => x.g.gameId).join()})`);
  assert(sc.entries.every(x => x.sport === 'cfb' && x.stale === false && x.label === '') && sc.parts[0].weekId === 'w2', '4b: no provider → no staleness is invented; the sport is cfb; no sport word is asked for');
  // DI-579 REV 2: Game Day is NOT ordered by the viewer's Dashboard sort. Even with a manual order saved for this very week, the scope is kickoff order.
  storage.setGameOrderMode('manual'); storage.setManualGameOrder('w2', ['g24', 'g22']);
  const man = snapOf(L).snap;
  assert(home.liveScope(man, curOf(L), { now: NOW }).entries.map(x => x.g.gameId).join() === 'g22,g23,g24', '4c: with "My order" saved for the week (g24, g22 first) the live scope is STILL kickoff order — the viewer\'s sort belongs to the Dashboard alone (DI-579 REV 2)');
  storage.setGameOrderMode('live-first');
  assert(home.liveScope(snapOf(L).snap, curOf(L), { now: NOW }).entries.map(x => x.g.gameId).join() === 'g22,g23,g24', '4d: …and so is it under "Live first" (an all-live set is kickoff order either way)');
  storage.setGameOrderMode('kickoff'); storage.clearManualGameOrder('w2');
  const homeCode = HOME_SRC.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');
  const unwired = (code) => !/getGameOrderMode|getManualGameOrder|manualGameOrder|gameOrderMode|\.gameOrder\b/.test(code);
  assert(unwired(homeCode) && !unwired(homeCode + '\nconst x = getGameOrderMode();') && !unwired(homeCode + '\nconst y = s.gameOrder;'), '4d2: js/home.js reads neither the order mode nor the manual order anywhere (and the pin has teeth: either name reappearing turns it RED)');
  // staleness
  const provider = (id) => (id === 'g22' ? { name: 'STATUS_IN_PROGRESS', shortDetail: 'Q2 4:10', capturedAt: NOW - 10 * MIN } : { name: 'STATUS_IN_PROGRESS', shortDetail: 'Q3 1:00', capturedAt: NOW - 20_000 });
  const st = home.liveScope(snapOf(L, { liveEntryFor: provider }).snap, curOf(L), { now: NOW });
  assert(st.entries.find(x => x.g.gameId === 'g22').stale === true && st.entries.find(x => x.g.gameId === 'g23').stale === false && st.entries.find(x => x.g.gameId === 'g23').label === 'Q3 1:00', '4e: a score older than 3 minutes says so (stale); a fresh one carries its short detail');
  const brokenProv = () => { throw new Error('boom'); };
  const bp = home.liveScope(snapOf(L, { liveEntryFor: brokenProv }).snap, curOf(L), { now: NOW });
  assert(bp.entries.length === 3 && bp.entries.every(x => x.stale === false && x.label === ''), '4f: a provider that throws never breaks the scope');
  // grouped week: both parts
  const G = mkLive([]);
  G.weeks[1].groupId = 'grp1';
  const part = fx.mkWeek({ id: 'w2b', n: 3, status: 'live', extra: { groupId: 'grp1' } });
  G.weeks.push(part);
  const gb = fx.mkGame({ id: 'g2b1', weekId: 'w2b', kick: '2026-09-12T21:00:00.000Z', home: 'Utah', away: 'BYU', kind: 'cover', state: 'live' });
  G.games.push(gb);
  const sg = home.liveScope(snapOf(G, { cur: G.weeks[1] }).snap, G.weeks[1], { now: NOW });
  assert(sg.parts.map(w => w.weekId).join() === 'w2,w2b' && sg.entries.map(x => x.g.gameId).join() === 'g22,g2b1', `4g: a multi-part week speaks for BOTH parts (${sg.entries.map(x => x.g.gameId).join()})`);
  part.status = 'locked';
  const sl = home.liveScope(snapOf(G, { cur: G.weeks[1] }).snap, G.weeks[1], { now: NOW });
  assert(sl.parts.map(w => w.weekId).join() === 'w2' && sl.entries.map(x => x.g.gameId).join() === 'g22', '4h: THE BLIND RULE PER PART — a part whose picks are not public contributes nothing, even beside a part that is');
  part.status = 'live'; part.dataSourceMode = 'demo';
  const sd = home.liveScope(snapOf(G, { cur: G.weeks[1] }).snap, G.weeks[1], { now: NOW });
  const sda = home.liveScope(snapOf(G, { cur: G.weeks[1], admin: true }).snap, G.weeks[1], { now: NOW, isCommissioner: true });
  assert(sd.parts.length === 1 && sda.parts.length === 2, '4i: a demo part is counted only for the commissioner (UN-71)');
  part.dataSourceMode = 'espn_live';
  // the current week IS counted even when its own status would not pass arePicksPublic (it is the Now card's week)
  const Lc = mkLive([]); Lc.weeks[1].status = 'locked';
  assert(home.liveScope(snapOf(Lc).snap, curOf(Lc), { now: NOW }).parts.length === 1, '4j: the Now card\'s own week is always the base (the caller already decided to show it)');
  // competitions
  const N = mkLive([]);
  N.weeks.push(fx.mkWeek({ id: 'n1', n: 1, status: 'live', extra: { sport: 'nfl' } }));
  N.games.push(fx.mkGame({ id: 'ng1', weekId: 'n1', kick: '2026-09-13T17:00:00.000Z', home: 'Bills', away: 'Jets', kind: 'cover', state: 'live' }));
  const one = home.liveScope(snapOf(N, { cur: N.weeks[1] }).snap, N.weeks[1], { now: NOW });
  assert(one.entries.map(x => x.g.gameId).join() === 'g22' && one.showSport === false, '4k: with ONE (default) competition, another week\'s live game is NOT pulled in — a single-sport league is unchanged');
  const comps2 = [{ competitionId: 'cfb', sport: 'cfb', label: 'CFB', currentWeekId: 'w2', viewerEntered: true }, { competitionId: 'nfl', sport: 'nfl', label: 'NFL', currentWeekId: 'n1', viewerEntered: true }];
  const two = home.liveScope(snapOf(N, { cur: N.weeks[1], competitions: comps2 }).snap, N.weeks[1], { now: NOW });
  assert(two.showSport === true && two.entries.map(x => `${x.g.gameId}:${x.sport}`).join() === 'g22:cfb,ng1:nfl', `4l: with two competitions every competition's live games are in scope and carry their sport (${two.entries.map(x => `${x.g.gameId}:${x.sport}`).join()})`);
  N.weeks[2].status = 'locked';
  const hid = home.liveScope(snapOf(N, { cur: N.weeks[1], competitions: comps2 }).snap, N.weeks[1], { now: NOW });
  assert(hid.entries.map(x => x.g.gameId).join() === 'g22', '4m: a competition\'s week whose picks are not public contributes nothing (blind per part, per competition)');
  const bad = home.liveScope(snapOf(N, { cur: N.weeks[1], competitions: [{ competitionId: 'nfl', sport: 'nfl', currentWeekId: 'ghost' }, { competitionId: 'cfb', sport: 'cfb', currentWeekId: 'w2' }] }).snap, N.weeks[1], { now: NOW });
  assert(bad.entries.map(x => x.g.gameId).join() === 'g22', '4n: a competition naming a week that does not exist is skipped, not thrown on');
  // finals, postponed, delayed are never live
  const F = mkLive([]);
  F.games.find(g => g.gameId === 'g23').status = 'postponed'; F.games.find(g => g.gameId === 'g24').status = 'delayed';
  assert(home.liveScope(snapOf(F).snap, curOf(F), { now: NOW }).entries.map(x => x.g.gameId).join() === 'g22', '4o: a final, postponed or delayed game is never counted as live (DI-570)');
  const empty = home.liveScope({ weeks: [], games: [], competitions: [] }, { weekId: 'x' }, { now: NOW });
  assert(empty.entries.length === 0 && empty.showSport === false, '4p: an empty snapshot gives an empty scope');
}

// ═══ [6] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[6] The Lane A seam: Home\'s competitions come from the feed contexts (consolidated Game Day round, 2026-10-08)…');
{
  const cd = await import('./js/card-detail.js');
  // CFB weeks w1 / w2 (all six play) and NFL week n1 (only p1, p2, p3 entered). Every week record carries the WRONG `sport` field on purpose: R1 says a week's sport is its competition's, never its own.
  const LN = league('final');
  LN.weeks.forEach((w) => { w.sport = 'nfl'; });
  LN.weeks.push(fx.mkWeek({ id: 'n1', n: 1, status: 'final', extra: { sport: 'cfb' } }));
  const ng1 = fx.mkGame({ id: 'ng1', weekId: 'n1', kick: '2026-09-13T17:00:00.000Z', home: 'Bills', away: 'Jets', kind: 'cover', state: 'final' });
  const ng2 = fx.mkGame({ id: 'ng2', weekId: 'n1', kick: '2026-09-13T20:00:00.000Z', home: 'Chiefs', away: 'Raiders', kind: 'cover', state: 'final' });
  LN.games.push(ng1, ng2);
  const NFL_IN = ['p1', 'p2', 'p3'];
  const nflPlayers = LN.players.filter((p) => NFL_IN.includes(p.playerId));
  LN.picks.push(...fx.mkPicks(ng1, 'cover', 'WLWLLL'), ...fx.mkPicks(ng2, 'cover', 'WLWLLL'));   // p4..p6 hold NFL pick ROWS though they never joined (A3: they count for nothing)
  LN.weeklyResults.push(...calculateWeeklyResults('n1', nflPlayers, LN.picks.filter((x) => NFL_IN.includes(x.playerId)), LN.games.filter((g) => g.weekId === 'n1')));
  const ALL = LN.players.map((p) => p.playerId);
  const ctxs = (o = {}) => [
    { competitionId: 'c_cfb', dbCode: 'cfb', code: 'CFB', weekIds: ['w1', 'w2'], playerIds: ALL, weekEntrants: { w1: ALL, w2: ALL }, currentWeekId: 'w2' },
    { competitionId: 'c_nfl', dbCode: 'nfl', code: 'NFL', weekIds: o.nflWeeks || ['n1'], playerIds: o.nflNow || NFL_IN, weekEntrants: { n1: o.nflN1 || NFL_IN, ...(o.extraEntrants || {}) }, currentWeekId: 'n1' },
  ];
  const snapC = (L, { viewer = 'p1', contexts = ctxs(), cur = null } = {}) => {
    const e = mkHomeEnv({ home }, doc, L, { viewer, read: { currentWeek: () => cur || L.weeks[1], contexts: () => contexts, rosterForWeek: (w) => L.players.filter((p) => (w.weekId === 'n1' ? NFL_IN : ALL).includes(p.playerId)) }, deps: {}, chat: { scribe: [], lockerRoom: [] } });
    return e.home.assembleSnapshot({ viewerId: viewer, isCommissioner: false, now: NOW + 3 * 24 * HOUR });
  };
  const s1 = snapC(LN);
  assert(s1.competitions.length === 2 && s1.competitions.map((c) => `${c.competitionId}:${c.sport}:${c.label}`).join() === 'c_cfb:cfb:CFB,c_nfl:nfl:NFL' && s1.competitions.every((c) => c.single === false),
    `6a: with no competitions dependency the snapshot's competitions ARE the feed contexts (${s1.competitions.map((c) => c.label).join(', ')})`);
  assert(s1.competitions[0].viewerEntered === true && s1.competitions[1].viewerEntered === true && snapC(LN, { viewer: 'p4' }).competitions[1].viewerEntered === false, '6b: "entered" is the viewer among the competition\'s entrants (p4 never joined NFL)');
  // R1 + C4: Season per competition, ranked among THAT competition's entrants, over THAT competition's weeks — whatever the week records' own `sport` field says
  const r3 = home.viewerStatsFor(snapC(LN, { viewer: 'p3', cur: LN.weeks[1] }), { cur: LN.weeks[1], state: 'final', viewer: 'p3' });
  const cfbStd = calculateSeasonStandings(LN.players, LN.weeklyResults.filter((r) => r.weekId !== 'n1'), LN.weeks.filter((w) => w.weekId !== 'n1')).find((x) => x.playerId === 'p3');
  const nflStd = calculateSeasonStandings(nflPlayers, LN.weeklyResults.filter((r) => r.weekId === 'n1'), LN.weeks.filter((w) => w.weekId === 'n1')).find((x) => x.playerId === 'p3');
  const labels = r3 ? r3.items.map((i) => i.label).join('|') : '';
  assert(labels === 'CFB · Your week|CFB · Season|NFL · Your week|NFL · Season', `6c: R1 — each figure sits under its competition's sport though every week record names the other one (${labels})`);
  assert(!!r3 && r3.items[1].value === `${ordinal(cfbStd.currentRank)} of 6 · ${cfbStd.winPct}%`, `6d: CFB "Season" ranks among CFB's six entrants over CFB's weeks only (${r3 && r3.items[1].value})`);
  assert(!!r3 && r3.items[3].value === `${ordinal(nflStd.currentRank)} of 3 · ${nflStd.winPct}%`, `6e: C4 — NFL "Season" is "of 3": the three NFL entrants, never the six active members, and the three non-entrants' NFL pick rows count for nothing (${r3 && r3.items[3].value})`);
  const r4 = home.viewerStatsFor(snapC(LN, { viewer: 'p4', cur: LN.weeks[1] }), { cur: LN.weeks[1], state: 'final', viewer: 'p4' });
  assert(!!r4 && r4.notes.length === 1 && /You're not entered in NFL picks/.test(r4.notes[0]) && r4.items.every((i) => /^CFB/.test(i.label)), '6f: a member who never joined NFL gets the calm sentence for NFL and CFB figures only');
  // Game Day's entries: the sport by competition (R1), and "entered" per WEEK (C1: a member on the roster now who joined after n1 locked is not an entrant of n1)
  const ent = (snap, viewer) => home.gameDayEntries(snap, LN.weeks[1], { viewerId: viewer, now: NOW + 3 * 24 * HOUR });
  const e1 = ent(s1, 'p1');
  const nflE = e1.filter((x) => x.weekId === 'n1'), cfbE = e1.filter((x) => x.weekId === 'w2');
  assert(nflE.length === 2 && nflE.every((x) => x.sport === 'nfl' && x.sportLabel === 'NFL') && cfbE.length >= 1 && cfbE.every((x) => x.sport === 'cfb' && x.sportLabel === 'CFB'), '6g: R1 — Game Day labels each game by its competition (NFL games NFL, CFB games CFB), not by the week record\'s field');
  const late = snapC(LN, { viewer: 'p4', contexts: ctxs({ nflNow: ['p1', 'p2', 'p3', 'p4'] }) });   // p4 joined NFL AFTER n1 locked: on the roster now, not an entrant of n1
  const eLate = ent(late, 'p4');
  assert(late.competitions[1].viewerEntered === true && eLate.filter((x) => x.weekId === 'n1').every((x) => x.entered === false) && eLate.filter((x) => x.weekId === 'w2').every((x) => x.entered === true), '6h: C1 — a late joiner is "Following" on the week he joined after (entered false there), entered on CFB');
  assert(ent(snapC(LN, { viewer: 'p4', contexts: ctxs({ nflNow: ['p1', 'p2', 'p3', 'p4'], nflN1: ['p1', 'p2', 'p3', 'p4'] }) }), 'p4').filter((x) => x.weekId === 'n1').every((x) => x.entered === true), '6i: …and entered once that week\'s own entrants include him');
  // What's next: the sport by competition; a week no competition in scope holds is never offered
  const LX = league('final');
  LX.weeks.push(fx.mkWeek({ id: 'n2', n: 2, status: 'open', extra: { sport: 'cfb', picksLockAt: new Date(NOW + 5 * 24 * HOUR).toISOString() } }));
  LX.weeks.push(fx.mkWeek({ id: 'z9', n: 9, status: 'open', extra: { sport: 'nfl', picksLockAt: new Date(NOW + 4 * 24 * HOUR).toISOString() } }));
  LX.games.push(fx.mkGame({ id: 'n2g', weekId: 'n2', kick: new Date(NOW + 6 * 24 * HOUR).toISOString(), home: 'Bills', away: 'Jets', kind: 'cover', state: 'scheduled' }));
  LX.games.push(fx.mkGame({ id: 'z9g', weekId: 'z9', kick: new Date(NOW + 4.5 * 24 * HOUR).toISOString(), home: 'Lions', away: 'Bears', kind: 'cover', state: 'scheduled' }));
  const sx = snapC(LX, { contexts: ctxs({ nflWeeks: ['n1', 'n2'], extraEntrants: { n2: NFL_IN } }) });
  const nx = home.nextUpFor(sx, { viewerId: 'p1', now: NOW + 3 * 24 * HOUR });
  assert(nx.kind === 'picks-due' && nx.weekId === 'n2' && nx.sport === 'nfl' && nx.sportLabel === 'NFL', `6j: What's next offers the NFL week by its competition (sport ${nx.sport}, week ${nx.weekId}) and never z9, the earlier-locking week no competition in scope holds`);
  const nx4 = home.nextUpFor(snapC(LX, { viewer: 'p4', contexts: ctxs({ nflWeeks: ['n1', 'n2'], extraEntrants: { n2: NFL_IN } }) }), { viewerId: 'p4', now: NOW + 3 * 24 * HOUR });
  assert(nx4.weekId === 'n2' && nx4.kind === 'follow' && nx4.entered === false, `6k: …and to a member who is not an entrant of that NFL week it is only something to follow (${nx4.kind})`);
  // One sport: no contexts, ONE default competition, every figure as before
  const one = snapC(league('final'), { contexts: null });
  assert(one.competitions.length === 1 && one.competitions[0].single === true && JSON.stringify(Object.keys(one.competitions[0])) === JSON.stringify(['competitionId', 'sport', 'label', 'currentWeekId', 'viewerEntered', 'single']), '6l: a one-sport league (no contexts) keeps the single default, shaped exactly as before');
  // The card detail's view through a week (card-detail.js viewThrough): THAT week's competition only, its entrants, no non-entrant pick rows
  const vt = cd._internals.viewThrough;
  const vC = vt(s1, LN.weeks[1]), vN = vt(s1, LN.weeks[2]);
  assert(vC.players.length === 6 && vC.revealedWeeks.every((w) => w.weekId !== 'n1') && vC.allWeeks.every((w) => w.weekId !== 'n1'), `6m: the view through a CFB week holds CFB's weeks and its six entrants (${vC.players.length}; weeks ${vC.revealedWeeks.map((w) => w.weekId).join(',')})`);
  assert(vN.players.map((p) => p.playerId).join() === 'p1,p2,p3' && vN.revealedWeeks.map((w) => w.weekId).join() === 'n1' && vN.revealedPicks.every((x) => NFL_IN.includes(x.playerId)), `6n: …through an NFL week: NFL's week, its three entrants, and no pick row of a member who never joined (${vN.players.map((p) => p.playerId).join()})`);
  const vOne = vt(one, league('final').weeks[1]);
  assert(vOne.players.length === 6 && vOne.revealedWeeks.length === 2, '6o: a one-sport league\'s view is the whole league, as before');
  // Security nit (DI-597, 2026-10-14): what Share may open uses the SERVER-confirmed week status, the same rule as resolveGameView (viewableWeek) — never the stored status alone
  const tgt = (L, confirmed) => mkHomeEnv({ home }, doc, L, { viewer: 'p1', confirmed, read: { currentWeek: () => L.weeks[1] }, chat: { scribe: [], lockerRoom: [] } }).home.shareTargets();
  const LA = league('final');
  const tA = tgt(LA, (wk) => (wk.weekId === 'w2' ? 'draft' : wk.status));
  const w2Games = LA.games.filter((g) => g.weekId === 'w2').map((g) => g.gameId);
  assert(tA.weekIds.has('w1') && !tA.weekIds.has('w2') && w2Games.length > 0 && w2Games.every((g) => !tA.gameIds.has(g)), '6p: a week the SERVER still calls a draft is not openable through Share (nor its games), whatever the stored status says');
  const LB = league('final'); LB.weeks[1] = { ...LB.weeks[1], status: 'draft' };
  const tB = tgt(LB, (wk) => (wk.weekId === 'w2' ? 'final' : wk.status));
  assert(tB.weekIds.has('w2') && w2Games.every((g) => tB.gameIds.has(g)), '6q: …and a week the server has confirmed past draft is openable even while the stored copy still says draft');
}

// ═══ [5] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[5] MUTATION PROOFS — scratch copies loaded as data: URLs (never the file)…');
{
  const base = new URL('./js/', import.meta.url).href;
  const retarget = (src) => src.replace(/from '\.\/([\w.-]+)'/g, (_m, f) => `from '${base}${f}'`);
  const load = async (src) => import('data:text/javascript;base64,' + Buffer.from(retarget(src)).toString('base64') + '#' + Math.random());
  const probe = async (mod) => {
    const o = {};
    const L = league('final');
    const s = mod.createHome ? snapOfWith(mod, L) : null;
    const std = calculateSeasonStandings(L.players, L.weeklyResults, L.weeks).find(x => x.playerId === 'p1');
    const r = mod.viewerStatsFor(s, { cur: curOf(L), state: 'final', viewer: 'p1' });
    o.seasonParity = !!r && r.items[1].value === `${ordinal(std.currentRank)} of 6 · ${std.winPct}%`;
    const Lq = league('live'); Lq.picks = Lq.picks.filter(p => !(p.playerId === 'p1' && p.weekId === 'w2'));
    const rq = mod.viewerStatsFor(snapOfWith(mod, Lq), { cur: curOf(Lq), state: 'live', viewer: 'p1' });
    o.noPicks = !!rq && rq.items[0].value === 'No picks this week';
    o.failClosed = mod.viewerStatsFor(s, { cur: curOf(L), state: 'final', viewer: '' }) === null;
    const Lb = league('final'); Lb.weeks[1].status = 'locked'; Lb.weeks[1].finalizedAt = null;
    const rb = mod.viewerStatsFor(snapOfWith(mod, Lb), { cur: curOf(Lb), state: 'locked-far', viewer: 'p1' });
    o.blindWeek = !!rb && rb.items.length === 1 && rb.items[0].label === 'Season';
    const G = league('live'); G.weeks[1].groupId = 'grp1';
    const part = fx.mkWeek({ id: 'w2b', n: 3, status: 'locked', extra: { groupId: 'grp1' } });
    G.weeks.push(part); G.games.push(fx.mkGame({ id: 'g2b1', weekId: 'w2b', kick: '2026-09-12T21:00:00.000Z', home: 'Utah', away: 'BYU', kind: 'cover', state: 'live' }));
    const sg = mod.liveScope(snapOfWith(mod, G), G.weeks[1], { now: NOW });
    o.blindPart = sg.entries.map(x => x.g.gameId).join() === 'g22';
    part.status = 'live'; part.dataSourceMode = 'demo';
    o.demoPart = mod.liveScope(snapOfWith(mod, G), G.weeks[1], { now: NOW }).parts.length === 1;
    const N = league('live'); N.weeks.push(fx.mkWeek({ id: 'n1', n: 1, status: 'live', extra: { sport: 'nfl' } }));
    N.games.push(fx.mkGame({ id: 'ng1', weekId: 'n1', kick: '2026-09-13T17:00:00.000Z', home: 'Bills', away: 'Jets', kind: 'cover', state: 'live' }));
    o.singleUnchanged = mod.liveScope(snapOfWith(mod, N), N.weeks[1], { now: NOW }).entries.map(x => x.g.gameId).join() === 'g22';
    const F = league('live'); F.games.find(g => g.gameId === 'g23').status = 'postponed';
    o.onlyLive = mod.liveScope(snapOfWith(mod, F), curOf(F), { now: NOW }).entries.map(x => x.g.gameId).join() === 'g22';
    const Mn = league('live'); Object.assign(Mn.games.find(g => g.gameId === 'g23'), { status: 'live', homeScore: 7, awayScore: 3 });
    o.kickoffOrder = mod.liveScope(snapOfWith(mod, Mn), curOf(Mn), { now: NOW }).entries.map(x => x.g.gameId).join() === 'g22,g23';
    return o;
  };
  function snapOfWith(mod, L) {
    const e = mkHomeEnv({ home: mod }, doc, L, { viewer: 'p1', read: { currentWeek: () => curOf(L) }, chat: { scribe: [], lockerRoom: [] } });
    return e.home.assembleSnapshot({ viewerId: 'p1', isCommissioner: false, now: NOW + 3 * 24 * HOUR });
  }
  const baseRes = await probe(home);
  assert(Object.values(baseRes).every(Boolean), `5-0: the probe is GREEN on the real module (${Object.entries(baseRes).filter(([, v]) => !v).map(([k]) => k).join(', ') || 'all pass'})`);
  const R = (a, b) => { if (HOME_SRC.split(a).length !== 2) throw new Error('mutation anchor must match exactly once: ' + a.slice(0, 70)); return HOME_SRC.replace(a, b); };
  const mutants = [
    ['the season is not Standings\' own figure (rank off by one)', R("sv = `${ordinal(st.currentRank)} of", "sv = `${ordinal(st.currentRank + 1)} of"), 'seasonParity'],
    ['no picks reads as a record', R("else if (!line || line.picked === 0) { value = 'No picks this week'; }", "else if (!line) { value = 'No picks this week'; }"), 'noPicks'],
    ['an empty viewer id is accepted', R("if (!isNonEmptyString(viewer) || !['live'", "if (viewer === null || !['live'"), 'failClosed'],
    ['the week line ignores arePicksPublic', R("if (wc && arePicksPublic(wc)) {", "if (wc) {"), 'blindWeek'],
    ['a part with private picks is counted', R("if (m.weekId !== cur.weekId && !arePicksPublic(m)) continue;", ""), 'blindPart'],
    ['a demo part is counted for everyone', R("if (m.dataSourceMode === 'demo' && isCommissioner !== true) continue;", ""), 'demoPart'],
    ['a single-sport league pulls other weeks in', R("if (showSport) for (const c of comps)", "for (const c of comps)"), 'singleUnchanged'],
    ['any status counts as live', R("g && g.status === 'live' && byWeek.has(g.weekId)", "g && byWeek.has(g.weekId)"), 'onlyLive'],
    ['the live scope is no longer kickoff-ordered (newest kickoff first)', R("const ordered = orderGames(live, { mode: 'kickoff' });", "const ordered = orderGames(live, { mode: 'kickoff' }).reverse();"), 'kickoffOrder'],
  ];
  for (const [name, src, check] of mutants) {
    let res;
    try { res = await probe(await load(src)); } catch (err) { res = { [check]: false, _err: String(err.message).slice(0, 90) }; }
    assert(src !== HOME_SRC && res[check] === false, `5: mutant "${name}" turns ${check} RED${res._err ? ' (' + res._err + ')' : ''}`);
  }
  const statsSrc = await read('./js/stats.js');
  const sm = (a, b) => { if (statsSrc.split(a).length !== 2) throw new Error('stats anchor must match exactly once: ' + a.slice(0, 60)); return statsSrc.replace(a, b); };
  const statsMutants = [
    ['viewerWeekLine reads every member\'s picks', sm("if (!p || p.weekId !== week.weekId || p.playerId !== viewerId) continue;", "if (!p || p.weekId !== week.weekId) continue;")],
    ['viewerWeekLine grades unfinished games', sm("    if (g.status !== 'final') continue;\n    const r = evaluatePick(p, g);", "    const r = evaluatePick(p, g);")],
  ];
  const L = league('final');
  const games = L.games.map(g => (g.gameId === 'g21' ? { ...g, status: 'delayed', atsWinner: g.homeTeam } : g));
  const args = { week: L.weeks[1], games, picks: L.picks, viewerId: 'p1' };
  const own = stats.viewerWeekLine(args);
  for (const [name, src] of statsMutants) {
    const m = await load(src);
    const got = m.viewerWeekLine(args);
    assert(JSON.stringify(got) !== JSON.stringify(own), `5: mutant "${name}" changes the answer on a league with a delayed game and everyone's picks (cases 1d-1h2 catch it)`);
  }
}

console.log(`\n══════════════════════════════════════════════════\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
