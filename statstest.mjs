/**
 * CFB Pickems — statstest.mjs (Social Platform v1 Home, DI-360 + DI-361, 2026-09-30)
 * ===========================================================================
 * The proof for js/stats-core.js (the streak / milestone / lone-wolf extraction) and
 * js/stats.js (per-member season stats). A math proof reads start to finish in its own
 * file (CONVENTIONS #28), not buried among the chat-fold assertions in loadtest.mjs.
 *
 * Run:  node statstest.mjs      Must be run under BOTH TZ=UTC and TZ=America/Los_Angeles.
 *
 * Sections:
 *   [1]  DI-360 — the extraction is BYTE-IDENTICAL for SCRIBE
 *   [2]  SD-11 streak vectors (needs doc §6) — consecutive correct raw picks, pushes skipped, a loss resets
 *   [3]  SD-11 "upset called" vectors — correct ATS on the underdog AND won outright
 *   [4]  DI-361 — memberSeasonStats on the two-week league, every number hand-derived
 *   [5]  DI-361 test 3 / S-C2 — the revealed-view restriction is LOAD-BEARING, not coincidental
 *   [6]  DI-361 — structure: no calculateWeeklyResults, no storage, no tiebreaker field, inputs untouched
 *   [7]  MUTATION PROOFS on scratch copies (never the file): each mutant must turn a named check RED
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
globalThis.fetch = async () => { throw new Error('network disabled in statstest'); };
globalThis.matchMedia = () => ({ matches: false });
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };

const statsCore = await import('./js/stats-core.js');
const stats = await import('./js/stats.js');
const scoring = await import('./js/scoring.js');
const scribeLines = await import('./js/scribeLines.js');
const fx = await import('./statsfixtures.mjs');
const { calculateWeeklyResults, calculateSeasonStandings, calculateAlmaMaterTotal, evaluatePick, calculateAtsWinner } = scoring;
const { PLAYERS, mkGame, mkPicks, mkWeek, buildLeague, buildSequence } = fx;

const read = (rel) => readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}
function importsOf(src) {
  return [...stripComments(src).matchAll(/import\s+([\s\S]*?)\s+from\s+'([^']+)'/g)].map(m => ({ names: m[1], from: m[2] }));
}
const detect = (input) => JSON.stringify(scribeLines.detectWeekSignals(input));
let goldenCases = [];

// ═══════════════════════════════════════════════════════════════════════════
console.log('[1] DI-360 — the extraction is BYTE-IDENTICAL for SCRIBE…');
// ═══════════════════════════════════════════════════════════════════════════
{
  assert(JSON.stringify(statsCore.MILESTONE_MARKS) === '[25,50,100,150,200,250,300]', '1-1: MILESTONE_MARKS is [25,50,100,150,200,250,300] — the literal the SCRIBE detector always used');
  assert(statsCore.STREAK_MIN === 3, '1-2: STREAK_MIN is 3 (the reporting threshold the needs doc §6 reuses; no second threshold invented)');
  assert(scribeLines.MILESTONE_MARKS === statsCore.MILESTONE_MARKS, '1-3: scribeLines.MILESTONE_MARKS IS stats-core\'s array (one value, two importers — not an equal copy)');
  assert(scribeLines.orderedGradedResults === statsCore.orderedGradedResults, '1-4: scribeLines.orderedGradedResults IS stats-core\'s function (the public name survives the move)');
  assert(!('runLength' in scribeLines) && !('STREAK_MIN' in scribeLines) && !('loneWolfWinner' in scribeLines),
    '1-5: runLength / STREAK_MIN / loneWolfWinner stay un-exported from scribeLines.js — they never were public there, so no external consumer is affected');

  // Source structure: the bodies are GONE from scribeLines.js and the import names all five identifiers on one line.
  const slSrc = await read('./js/scribeLines.js');
  const slCode = stripComments(slSrc);
  assert(!/function\s+orderedGradedResults\b/.test(slCode) && !/function\s+runLength\b/.test(slCode),
    '1-6: scribeLines.js no longer DECLARES orderedGradedResults / runLength (S-C9: one implementation)');
  assert(!/(?:const|let|var)\s+(?:MILESTONE_MARKS|STREAK_MIN)\b/.test(slCode), '1-7: scribeLines.js declares neither constant');
  const imp = importsOf(slSrc).find(i => i.from === './stats-core.js');
  assert(!!imp && ['orderedGradedResults', 'runLength', 'STREAK_MIN', 'MILESTONE_MARKS', 'loneWolfWinner'].every(n => new RegExp(`\\b${n}\\b`).test(imp.names)),
    `1-8: scribeLines.js imports orderedGradedResults, runLength, STREAK_MIN, MILESTONE_MARKS, loneWolfWinner from './stats-core.js' (got: ${imp && imp.names.replace(/\s+/g, ' ')})`);

  // GOLDEN: captured from the PRE-extraction js/scribeLines.js (commit c2da987) over statsfixtures.goldenInputs().
  const GOLDEN_SIGNALS = {
    'league w1 finalize, week-1 data only (lone wolf p5, extended streaks p1 covers 4 / p6 misses 3)': '[{"signal":"loneWolfWin","subject":"p5","gameTag":"g11","evidence":{"gameId":"g11","playerId":"p5","team":"Clemson","against":5,"weekId":"w1"}},{"signal":"streak","subject":"p1","gameTag":"","evidence":{"playerId":"p1","run":4,"kind":"covers","state":"active","weekId":"w1"}},{"signal":"streak","subject":"p6","gameTag":"","evidence":{"playerId":"p6","run":3,"kind":"misses","state":"active","weekId":"w1"}}]',
    'league w2 finalize (lone wolf p5, broken/extended streaks, chart lead change)': '[{"signal":"loneWolfWin","subject":"p5","gameTag":"g22","evidence":{"gameId":"g22","playerId":"p5","team":"Miami","against":5,"weekId":"w2"}},{"signal":"chartLeadChange","subject":"p5","gameTag":"","evidence":{"from":"p1","to":"p5","weekId":"w2"}},{"signal":"streak","subject":"p1","gameTag":"","evidence":{"playerId":"p1","run":4,"kind":"covers","state":"broken","weekId":"w2"}},{"signal":"streak","subject":"p3","gameTag":"","evidence":{"playerId":"p3","run":4,"kind":"misses","state":"active","weekId":"w2"}},{"signal":"streak","subject":"p5","gameTag":"","evidence":{"playerId":"p5","run":5,"kind":"covers","state":"active","weekId":"w2"}},{"signal":"streak","subject":"p6","gameTag":"","evidence":{"playerId":"p6","run":3,"kind":"misses","state":"broken","weekId":"w2"}}]',
    'league w2 finalize, no standings supplied': '[{"signal":"loneWolfWin","subject":"p5","gameTag":"g22","evidence":{"gameId":"g22","playerId":"p5","team":"Miami","against":5,"weekId":"w2"}},{"signal":"streak","subject":"p1","gameTag":"","evidence":{"playerId":"p1","run":4,"kind":"covers","state":"broken","weekId":"w2"}},{"signal":"streak","subject":"p3","gameTag":"","evidence":{"playerId":"p3","run":4,"kind":"misses","state":"active","weekId":"w2"}},{"signal":"streak","subject":"p5","gameTag":"","evidence":{"playerId":"p5","run":5,"kind":"covers","state":"active","weekId":"w2"}},{"signal":"streak","subject":"p6","gameTag":"","evidence":{"playerId":"p6","run":3,"kind":"misses","state":"broken","weekId":"w2"}}]',
    'league w1 at lock, week-1 data only (unanimous gate)': '[{"signal":"loneWolfWin","subject":"p5","gameTag":"g11","evidence":{"gameId":"g11","playerId":"p5","team":"Clemson","against":5,"weekId":"w1"}},{"signal":"streak","subject":"p1","gameTag":"","evidence":{"playerId":"p1","run":4,"kind":"covers","state":"active","weekId":"w1"}},{"signal":"streak","subject":"p6","gameTag":"","evidence":{"playerId":"p6","run":3,"kind":"misses","state":"active","weekId":"w1"}}]',
    'league w2 with a later-than-w1 dataset while OPEN (blind rule: unanimous never detected)': '[{"signal":"loneWolfWin","subject":"p5","gameTag":"g22","evidence":{"gameId":"g22","playerId":"p5","team":"Miami","against":5,"weekId":"w2"}},{"signal":"streak","subject":"p1","gameTag":"","evidence":{"playerId":"p1","run":4,"kind":"covers","state":"broken","weekId":"w2"}},{"signal":"streak","subject":"p3","gameTag":"","evidence":{"playerId":"p3","run":4,"kind":"misses","state":"active","weekId":"w2"}},{"signal":"streak","subject":"p5","gameTag":"","evidence":{"playerId":"p5","run":5,"kind":"covers","state":"active","weekId":"w2"}},{"signal":"streak","subject":"p6","gameTag":"","evidence":{"playerId":"p6","run":3,"kind":"misses","state":"broken","weekId":"w2"}}]',
    'unanimous game, week status open': '[]',
    // N3 (2026-10-01, closes S-C13) — THE ONE DELIBERATE CHANGE to the golden: the pre-extraction detector fired `unanimous`
    // for a LOCKED week (UNANIMOUS_VISIBLE_STATUSES admitted 'locked'); arePicksPublic() is LIVE or FINAL only, so it no longer does.
    // Every other case below is byte-identical to the pre-extraction output.
    'unanimous game, week status locked': '[]',
    'unanimous game, week status live': '[{"signal":"unanimous","subject":"ug1","gameTag":"ug1","evidence":{"gameId":"ug1","team":"Utah","count":6,"weekId":"u1"}}]',
    'unanimous game, week status final': '[{"signal":"unanimous","subject":"ug1","gameTag":"ug1","evidence":{"gameId":"ug1","team":"Utah","count":6,"weekId":"u1"}}]',
    'unanimous game, week status null': '[]',
    'milestone 24 -> 25 for p1, 49 -> 50 for p2, 10 -> 12 for p3': '[{"signal":"loneWolfWin","subject":"p5","gameTag":"g22","evidence":{"gameId":"g22","playerId":"p5","team":"Miami","against":5,"weekId":"w2"}},{"signal":"milestone","subject":"p1","gameTag":"","evidence":{"playerId":"p1","milestone":25,"total":25,"weekId":"w2"}},{"signal":"milestone","subject":"p2","gameTag":"","evidence":{"playerId":"p2","milestone":50,"total":50,"weekId":"w2"}},{"signal":"streak","subject":"p1","gameTag":"","evidence":{"playerId":"p1","run":4,"kind":"covers","state":"broken","weekId":"w2"}},{"signal":"streak","subject":"p3","gameTag":"","evidence":{"playerId":"p3","run":4,"kind":"misses","state":"active","weekId":"w2"}},{"signal":"streak","subject":"p5","gameTag":"","evidence":{"playerId":"p5","run":5,"kind":"covers","state":"active","weekId":"w2"}},{"signal":"streak","subject":"p6","gameTag":"","evidence":{"playerId":"p6","run":3,"kind":"misses","state":"broken","weekId":"w2"}}]',
    'sequence WWPWL split 4+1 finalizing s2': '[{"signal":"streak","subject":"p1","gameTag":"","evidence":{"playerId":"p1","run":3,"kind":"covers","state":"broken","weekId":"s2"}}]',
    'sequence WLWWW split 5 finalizing s1': '[{"signal":"streak","subject":"p1","gameTag":"","evidence":{"playerId":"p1","run":3,"kind":"covers","state":"active","weekId":"s1"}}]',
    'sequence WWPWLWW split 5+2 finalizing s2': '[]',
    'sequence WWWL split 3+1 finalizing s2': '[{"signal":"streak","subject":"p1","gameTag":"","evidence":{"playerId":"p1","run":3,"kind":"covers","state":"broken","weekId":"s2"}}]',
    'sequence WWWWW split 3+2 finalizing s2': '[{"signal":"streak","subject":"p1","gameTag":"","evidence":{"playerId":"p1","run":5,"kind":"covers","state":"active","weekId":"s2"}}]',
    'sequence LLLLW split 3+2 finalizing s2': '[{"signal":"streak","subject":"p1","gameTag":"","evidence":{"playerId":"p1","run":3,"kind":"misses","state":"broken","weekId":"s2"}}]',
    'sequence PPP split 3 finalizing s1': '[]',
    'sequence WWP split 3 finalizing s1': '[]',
  };
  const cases = fx.goldenInputs({ calculateWeeklyResults, calculateSeasonStandings });
  goldenCases = cases;
  assert(cases.length === Object.keys(GOLDEN_SIGNALS).length && cases.every(c => c.label in GOLDEN_SIGNALS),
    `1-9: fixture check — the ${cases.length} golden inputs and the ${Object.keys(GOLDEN_SIGNALS).length} captured outputs name the same cases (a drifted fixture would make 1-10 vacuous)`);
  let identical = 0;
  for (const c of cases) {
    const got = detect(c.input);
    const ok = got === GOLDEN_SIGNALS[c.label];
    if (ok) identical++;
    assert(ok, `1-10: detectWeekSignals is BYTE-IDENTICAL to the pre-extraction detector — ${c.label}${ok ? '' : `\n      got:  ${got}\n      want: ${GOLDEN_SIGNALS[c.label]}`}`);
  }
  assert(identical === cases.length && identical >= 17, `1-11: all ${identical} golden cases identical (floor 17)`);

  // FUZZ PARITY — a frozen reference copy of the pre-extraction bodies (commit c2da987), same evaluatePick.
  const refOrdered = (playerId, games, picks, weeks = null) => {
    const gameById = new Map();
    for (const g of games || []) { if (g && g.gameId) gameById.set(g.gameId, g); }
    const weekRank = new Map();
    if (Array.isArray(weeks)) {
      [...weeks].filter(Boolean).sort((a, b) =>
        String(a.season || '').localeCompare(String(b.season || '')) ||
        ((Number(a.weekNumber) || 0) - (Number(b.weekNumber) || 0))
      ).forEach((w, i) => weekRank.set(String(w.weekId), i));
    }
    const out = []; let complete = true;
    for (const p of picks || []) {
      if (!p || p.playerId !== playerId) continue;
      const game = gameById.get(p.gameId);
      if (!game) { complete = false; continue; }
      const result = evaluatePick(p, game);
      if (result !== 'win' && result !== 'loss') continue;
      const ms = game.kickoff ? Date.parse(game.kickoff) : NaN;
      const rank = weekRank.size ? weekRank.get(String(p.weekId)) : 0;
      if (!Number.isFinite(ms) || rank === undefined) { complete = false; continue; }
      out.push({ weekId: p.weekId, gameId: p.gameId, result, ms, rank });
    }
    out.sort((a, b) => (a.rank - b.rank) || (a.ms - b.ms) || String(a.gameId).localeCompare(String(b.gameId)));
    return { results: out, complete };
  };
  const refRun = (results) => {
    if (!results.length) return { run: 0, result: null };
    const last = results[results.length - 1].result;
    let run = 0;
    for (let i = results.length - 1; i >= 0; i--) { if (results[i].result === last) run++; else break; }
    return { run, result: last };
  };
  const refWolf = (game, weekPicks) => {
    if (game.status !== 'final') return null;
    const ats = (game.atsWinner !== undefined && game.atsWinner !== null) ? game.atsWinner : calculateAtsWinner(game);
    if (!ats || ats === 'no_decision') return null;
    const gp = weekPicks.filter(p => p.gameId === game.gameId);
    const winners = gp.filter(p => p.selectedTeam === ats);
    const losers = gp.filter(p => p.selectedTeam !== ats);
    if (winners.length === 1 && losers.length >= 2) return { playerId: winners[0].playerId, team: ats, against: losers.length };
    return null;
  };
  // The pre-streakChange inline streak block (reviewer note 4, 2026-10-01), frozen as a reference over the frozen ordered/run helpers.
  const refStreakSignals = (weekId, games, picks, weeks) => {
    const weekPicks = picks.filter(p => p && p.weekId === weekId);
    const out = [];
    for (const playerId of new Set(weekPicks.map(p => p.playerId))) {
      const { results, complete } = refOrdered(playerId, games, picks, weeks);
      if (!complete || results.length < 3) continue;
      const current = refRun(results), prior = refRun(results.filter(r => r.weekId !== weekId));
      if (current.run >= 3) out.push({ signal: 'streak', subject: playerId, gameTag: '', evidence: { playerId, run: current.run, kind: current.result === 'win' ? 'covers' : 'misses', state: 'active', weekId } });
      else if (prior.run >= 3 && prior.result && current.result !== prior.result) out.push({ signal: 'streak', subject: playerId, gameTag: '', evidence: { playerId, run: prior.run, kind: prior.result === 'win' ? 'covers' : 'misses', state: 'broken', weekId } });
    }
    return out;
  };
  let seed = 0x9e3779b9;
  const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  let fuzzOk = 0, fuzzWolfOk = 0, fuzzN = 400, fuzzStreakOk = 0, fuzzStreakFired = 0, fuzzStreakN = 0;
  for (let n = 0; n < fuzzN; n++) {
    const nWeeks = 1 + Math.floor(rnd() * 3);
    const weeks = [], games = [], picks = [];
    for (let w = 0; w < nWeeks; w++) {
      const weekId = `fw${w}`;
      weeks.push({ weekId, season: '2026', weekNumber: w + 1 });
      const nG = 1 + Math.floor(rnd() * 5);
      for (let g = 0; g < nG; g++) {
        const gameId = `fg${w}_${g}`;
        const status = pick(['final', 'final', 'final', 'live', 'scheduled']);
        const kick = rnd() < 0.08 ? pick([null, 'not-a-date', '']) : new Date(Date.UTC(2026, 8, 5 + w * 7, 12 + g)).toISOString();
        const game = { gameId, weekId, homeTeam: `H${w}${g}`, awayTeam: `A${w}${g}`, kickoff: kick, status,
          spread: pick([-7, -3, 0, 3, 6.5, null, 'x']), lockedSpread: pick([null, null, -3, 0, '']), homeScore: status === 'scheduled' ? null : Math.floor(rnd() * 40), awayScore: status === 'scheduled' ? null : Math.floor(rnd() * 40),
          atsWinner: rnd() < 0.1 ? pick([null, 'no_decision', `H${w}${g}`, `A${w}${g}`]) : null };
        games.push(game);
        for (const pid of ['p1', 'p2', 'p3', 'p4']) {
          if (rnd() < 0.15) continue;
          const refGame = rnd() < 0.04 ? `missing_${gameId}` : gameId; // an orphan pick makes the sequence incomplete
          picks.push({ weekId, gameId: refGame, playerId: pid, selectedTeam: rnd() < 0.5 ? game.homeTeam : game.awayTeam });
        }
      }
    }
    for (const pid of ['p1', 'p2']) {
      const useWeeks = rnd() < 0.8 ? weeks : null;
      const a = JSON.stringify(refOrdered(pid, games, picks, useWeeks)), b = JSON.stringify(statsCore.orderedGradedResults(pid, games, picks, useWeeks));
      const ra = JSON.stringify(refRun(refOrdered(pid, games, picks, useWeeks).results)), rb = JSON.stringify(statsCore.runLength(statsCore.orderedGradedResults(pid, games, picks, useWeeks).results));
      if (a === b && ra === rb) fuzzOk++;
    }
    for (const w of weeks) {
      const useWeeks = rnd() < 0.8 ? weeks : null;
      const ref = refStreakSignals(w.weekId, games, picks, useWeeks);
      const got = scribeLines.detectWeekSignals({ weekId: w.weekId, weekStatus: 'final', games, picks, players: [], weeks: useWeeks }).filter(x => x.signal === 'streak');
      fuzzStreakN++;
      if (ref.length) fuzzStreakFired++;
      if (JSON.stringify(ref) === JSON.stringify(got)) fuzzStreakOk++;
    }
    for (const g of games) {
      const wp = picks.filter(p => p.weekId === g.weekId);
      if (JSON.stringify(refWolf(g, wp)) === JSON.stringify(statsCore.loneWolfWinner(g, wp, { calculateAtsWinner }))) fuzzWolfOk++;
    }
  }
  assert(fuzzOk === fuzzN * 2, `1-12: orderedGradedResults + runLength match the frozen pre-extraction bodies on ${fuzzN * 2} random fixtures (orphan picks, bad kickoffs, live/scheduled games, null/garbage spreads, with and without a week list) — got ${fuzzOk}`);
  assert(fuzzStreakOk === fuzzStreakN && fuzzStreakN > 600 && fuzzStreakFired > 30,
    `1-12b: streakChange — detectWeekSignals' streak signals equal the frozen pre-refactor inline block on every (fixture, week) (${fuzzStreakOk}/${fuzzStreakN}; ${fuzzStreakFired} of them fire at least one signal, so the comparison is not vacuous)`);
  assert(fuzzWolfOk > 600, `1-13: loneWolfWinner matches the old inline loneWolfWin block on every random game (${fuzzWolfOk} games checked)`);
}

// ── loneWolfWinner: the three conditions, in order ──
{
  const { loneWolfWinner } = statsCore;
  const g = mkGame({ id: 'lw', weekId: 'w', kick: '2026-09-05T16:00:00.000Z', home: 'Home', away: 'Away', kind: 'cover', state: 'final' });
  const mk = (out) => mkPicks(g, 'cover', out);
  const r1 = loneWolfWinner(g, mk('WLLLLL'), { calculateAtsWinner });
  assert(r1 && r1.playerId === 'p1' && r1.team === 'Home' && r1.against === 5, `1-14: one winner, five losers → { p1, Home, against: 5 } (got ${JSON.stringify(r1)})`);
  assert(loneWolfWinner(g, mk('WWLLLL'), { calculateAtsWinner }) === null, '1-15: a TWO-winner tie is not "stood alone" → null');
  assert(loneWolfWinner(g, mk('WLL---'), { calculateAtsWinner })?.against === 2, '1-16: against counts only the picks actually made — two losers is the minimum');
  assert(loneWolfWinner(g, mk('WL----'), { calculateAtsWinner }) === null, '1-17: one winner against only ONE other pick is not a lone wolf (losers must be ≥ 2) → null');
  const pk = mkGame({ id: 'pk', weekId: 'w', kick: '2026-09-05T16:00:00.000Z', home: 'Home', away: 'Away', kind: 'push', state: 'final' });
  assert(loneWolfWinner(pk, mkPicks(pk, 'push', 'PPPPPP'), { calculateAtsWinner }) === null, '1-18: a pushed game has no ATS winner (no_decision) → null');
  const live = mkGame({ id: 'lv', weekId: 'w', kick: '2026-09-05T16:00:00.000Z', home: 'Home', away: 'Away', kind: 'cover', state: 'live' });
  assert(loneWolfWinner(live, mkPicks(live, 'cover', 'WLLLLL'), { calculateAtsWinner }) === null, '1-19: a game that is not FINAL → null (condition 1)');
  const s2 =loneWolfWinner({ ...g, atsWinner: 'Away' }, mkPicks(g, 'cover', 'LWWWWW'), { calculateAtsWinner });
  assert(s2 && s2.playerId === 'p1' && s2.team === 'Away', `1-21: a STORED atsWinner ('Away') decides, exactly as evaluatePick prefers it — the lone Away pick (p1) wins (got ${JSON.stringify(s2)})`);
  assert(loneWolfWinner(g, mk('WLLLLL')) === null, '1-22: calculateAtsWinner is INJECTED — with none and no stored atsWinner there is no answer (and no crash)');
  assert(loneWolfWinner(null, [], { calculateAtsWinner }) === null && loneWolfWinner(g, null, { calculateAtsWinner }) === null, '1-23: null game / null picks → null, never a throw');
}

// ── N3 (closes S-C13) and streakChange (reviewer note 4) — the two 2026-10-01 follow-ups to the extraction ──
function checkStreakChange({ statsCore: sc }) {
  const out = {};
  const seq = (codes, weekSizes) => buildSequence({ codes, weekSizes, calculateWeeklyResults });
  const change = (codes, weekSizes, weekId) => { const S = seq(codes, weekSizes); return sc.streakChange(sc.orderedGradedResults('p1', S.games, S.picks, S.weeks), weekId); };
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  out['SC1 W,W,P,W,L finalizing the L week → broken at 3 covers (the push skipped)'] = eq(change('WWPWL', [4, 1], 's2'), { run: 3, kind: 'covers', state: 'broken' });
  out['SC2 W,L,W,W,W in one week → active 3 covers'] = eq(change('WLWWW', [5], 's1'), { run: 3, kind: 'covers', state: 'active' });
  out['SC3 W,W,P,W,L,W,W finalizing the last week → null (run 2, prior run 1)'] = change('WWPWLWW', [5, 2], 's2') === null;
  out['SC4 L,L,L,L,W finalizing the W week → broken at 3 MISSES, the prior kind'] = eq(change('LLLLW', [3, 2], 's2'), { run: 3, kind: 'misses', state: 'broken' });
  out['SC5 W,W,W,W,W → active 5 covers (the RUN, not the threshold)'] = eq(change('WWWWW', [3, 2], 's2'), { run: 5, kind: 'covers', state: 'active' });
  out['SC6 fewer than STREAK_MIN graded picks → null; all pushes → null'] = change('WW', [2], 's1') === null && change('PPP', [3], 's1') === null;
  { const S = seq('WWWW', [4]); const hole = { results: sc.orderedGradedResults('p1', S.games, S.picks, S.weeks).results, complete: false };
    out['SC7 an INCOMPLETE history (complete:false) → null — a sequence with a hole is worse than no sequence'] = sc.streakChange(hole, 's1') === null; }
  out['SC8 null / undefined / a results-less object → null, never a throw'] = sc.streakChange(null, 's') === null && sc.streakChange(undefined, 's') === null && sc.streakChange({}, 's') === null;
  return out;
}
{
  assert(JSON.stringify(scribeLines.UNANIMOUS_VISIBLE_STATUSES) === '["live","final"]', '1-24: N3 — UNANIMOUS_VISIBLE_STATUSES is ["live","final"]: the LOCKED allowance is gone (S-C13 closed) — the client detector is as strict as arePicksPublic() and the server verifier');
  const u = (status) => scribeLines.detectWeekSignals(goldenCases.find(c => c.label === `unanimous game, week status ${status}`).input).filter(x => x.signal === 'unanimous').length;
  assert(u('locked') === 0 && u('open') === 0 && u('null') === 0 && u('live') === 1 && u('final') === 1, `1-25: …behaviourally: a unanimous slate is NOT detected for locked / open / no status, and IS for live / final (got ${['locked', 'open', 'null', 'live', 'final'].map(u).join(',')})`);
  const res = checkStreakChange({ statsCore });
  for (const [label, ok] of Object.entries(res)) assert(ok === true, `1-26: ${label}`);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[2] SD-11 streak vectors — consecutive correct raw picks in kickoff order; a push is skipped; a loss resets…');
// ═══════════════════════════════════════════════════════════════════════════
// `checkStreakVectors(mods)` returns { label: boolean } so the SAME checks run against a mutant in [7].
function checkStreakVectors({ statsCore: sc, stats: st }) {
  const out = {};
  const seq = (codes, weekSizes) => buildSequence({ codes, weekSizes, calculateWeeklyResults });
  const run = (codes, weekSizes, weekIdExcl = null) => {
    const S = seq(codes, weekSizes);
    const { results, complete } = sc.orderedGradedResults('p1', S.games, S.picks, S.weeks);
    const cur = sc.runLength(results);
    const prior = weekIdExcl ? sc.runLength(results.filter(r => r.weekId !== weekIdExcl)) : null;
    return { S, results, complete, cur, prior };
  };
  // Vector 1 — W,W,P,W,L: the push is skipped, the run walking backward from the loss is W,W,W = 3, then the loss resets it.
  { const v = run('WWPWL', [4, 1], 's2');
    out['V1 the push is skipped (4 graded, not 5)'] = v.results.length === 4 && v.complete;
    out['V1 current run is the single loss (cover streak 0)'] = v.cur.run === 1 && v.cur.result === 'loss';
    out['V1 the prior run walking back from the loss is 3 covers (broken AT 3)'] = v.prior.run === 3 && v.prior.result === 'win';
    const s = st.memberSeasonStats('p1', { players: v.S.players, revealedWeeks: v.S.weeks, revealedGames: v.S.games, revealedPicks: v.S.picks, revealedWeeklyResults: v.S.weeklyResults });
    out['V1 memberSeasonStats: currentStreak is a 1-run of misses, state none (below STREAK_MIN)'] = s.currentStreak.run === 1 && s.currentStreak.kind === 'misses' && s.currentStreak.state === 'none';
    out['V1 memberSeasonStats: longestStreak (covers) is 3'] = s.longestStreak.run === 3 && s.longestStreak.kind === 'covers';
  }
  // Vector 2 — W,L,W,W,W → current 3 (the loss two picks ago does not reach back through wins that came after it).
  { const v = run('WLWWW', [5]);
    out['V2 current run is 3 covers'] = v.cur.run === 3 && v.cur.result === 'win';
    const s = st.memberSeasonStats('p1', { players: v.S.players, revealedWeeks: v.S.weeks, revealedGames: v.S.games, revealedPicks: v.S.picks, revealedWeeklyResults: v.S.weeklyResults });
    out['V2 memberSeasonStats: active 3-cover streak'] = s.currentStreak.run === 3 && s.currentStreak.kind === 'covers' && s.currentStreak.state === 'active';
  }
  // Vector 3 — W,W,P,W,L,W,W → walking back from the end: W,W then the L stops it = 2 (below STREAK_MIN).
  { const v = run('WWPWLWW', [5, 2]);
    out['V3 current run is 2 covers — not yet reportable'] = v.cur.run === 2 && v.cur.result === 'win';
    const s = st.memberSeasonStats('p1', { players: v.S.players, revealedWeeks: v.S.weeks, revealedGames: v.S.games, revealedPicks: v.S.picks, revealedWeeklyResults: v.S.weeklyResults });
    out['V3 memberSeasonStats: state none (2 < STREAK_MIN)'] = s.currentStreak.run === 2 && s.currentStreak.state === 'none';
  }
  // Vector 4 — W,W,W,L (the L this week): the prior streak of 3 is the streak.broken fact.
  { const v = run('WWWL', [3, 1], 's2');
    out['V4 the streak that existed BEFORE this week was 3 covers'] = v.prior.run === 3 && v.prior.result === 'win';
    out['V4 and this week ended on a loss, so it broke'] = v.cur.result === 'loss' && v.cur.result !== v.prior.result;
  }
  // Push/loss semantics, directly.
  { const a = run('WPW', [3]); out['P1 a push between two covers does NOT break the run (W,P,W = 2)'] = a.cur.run === 2 && a.cur.result === 'win' && a.results.length === 2;
    const b = run('WWWLW', [5]); out['P2 a loss resets the run (W,W,W,L,W = 1)'] = b.cur.run === 1;
    const c = run('PPP', [3]); out['P3 pushes alone grade nothing: no results, run 0'] = c.results.length === 0 && c.cur.run === 0 && c.cur.result === null;
    const d = run('LLLLW', [3, 2], 's2'); out['P4 misses are a streak too (kind misses) and one cover breaks it'] = d.prior.run === 3 && d.prior.result === 'loss' && d.cur.result === 'win';
    const e = run('WWWLWW', [6]); const se = stats.memberSeasonStats('p1', { players: e.S.players, revealedWeeks: e.S.weeks, revealedGames: e.S.games, revealedPicks: e.S.picks, revealedWeeklyResults: e.S.weeklyResults });
    out['P5 longestStreak remembers the best run even after a loss (3), current is 2'] = se.longestStreak.run === 3 && se.currentStreak.run === 2;
  }
  return out;
}
{
  const res = checkStreakVectors({ statsCore, stats });
  for (const [label, ok] of Object.entries(res)) assert(ok === true, `2: ${label}`);
  assert(Object.keys(res).length >= 15, `2-floor: at least 15 streak checks ran (${Object.keys(res).length})`);
  // kickoff ORDER, not insertion order: shuffle the pick array and the games array — the answer cannot move.
  const S = buildSequence({ codes: 'WWPWLWW', weekSizes: [5, 2], calculateWeeklyResults });
  const rev = (a) => [...a].reverse();
  const a = JSON.stringify(statsCore.orderedGradedResults('p1', S.games, S.picks, S.weeks));
  const b = JSON.stringify(statsCore.orderedGradedResults('p1', rev(S.games), rev(S.picks), rev(S.weeks)));
  assert(a === b, '2-order: reversing the picks, games and weeks arrays does not change the ordered results — order comes from (season, weekNumber, kickoff, gameId), never insertion order');
  // an unorderable history is skipped, not guessed at
  const T = buildSequence({ codes: 'WWWW', weekSizes: [4], calculateWeeklyResults });
  const hole = { ...T, picks: [...T.picks, { weekId: 's1', gameId: 'ghost', playerId: 'p1', selectedTeam: 'X' }] };
  const sh = stats.memberSeasonStats('p1', { players: hole.players, revealedWeeks: hole.weeks, revealedGames: hole.games, revealedPicks: hole.picks, revealedWeeklyResults: hole.weeklyResults });
  assert(sh.currentStreak.state === 'unknown' && sh.longestStreak === null, `2-hole: a pick whose game is missing makes the sequence INCOMPLETE → state 'unknown', longestStreak null — "a sequence with a hole is worse than no sequence" (got ${JSON.stringify(sh.currentStreak)})`);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[3] SD-11 "upset called" — a correct ATS pick on the underdog that ALSO won outright…');
// ═══════════════════════════════════════════════════════════════════════════
function checkUpsetVectors({ stats: st }) {
  const out = {};
  const G = (o) => ({ gameId: 'u', weekId: 'w', homeTeam: 'Alpha', awayTeam: 'Beta', status: 'final', multiplier: 1, ...o });
  const P = (team) => ({ playerId: 'p1', gameId: 'u', weekId: 'w', selectedTeam: team });
  // 1. Underdog A (+6.5) wins outright 24-20. Home A with spread +6.5 means AWAY is favored: A is the underdog.
  { const g = G({ spread: 6.5, lockedSpread: 6.5, homeScore: 24, awayScore: 20 });
    out['U1 underdog +6.5 wins 24-20: the pick on the underdog is an upset called'] = st.isUpsetCalled(P('Alpha'), g) === true;
    out['U1 the pick on the FAVORITE is not'] = st.isUpsetCalled(P('Beta'), g) === false;
    out['U1 the underdog is the HOME team (positive home-perspective spread = away favored)'] = st.underdogTeam(g) === 'Alpha';
    out['U1 the displayed line is +6.5 and the score line says winner first, 24–20'] = st.upsetLineLabel(g) === '+6.5' && st.outrightScoreLine(g) === '24–20'; }
  // 2. Underdog A (+6.5) LOSES 17-20 (3 points, inside the 6.5): a backdoor cover — correct ATS, NOT an upset.
  { const g = G({ spread: 6.5, lockedSpread: 6.5, homeScore: 17, awayScore: 20 });
    out['U2 the backdoor pick IS correct ATS (evaluatePick says win)…'] = evaluatePick(P('Alpha'), g) === 'win';
    out['U2 …but the underdog did not win outright, so it is NOT an upset called'] = st.isUpsetCalled(P('Alpha'), g) === false; }
  // 3. Underdog A (+3) wins outright by 10 → both conditions → upset called.
  { const g = G({ spread: 3, lockedSpread: 3, homeScore: 30, awayScore: 20 });
    out['U3 underdog +3 wins by 10 → upset called'] = st.isUpsetCalled(P('Alpha'), g) === true; }
  // 4. A pick'em (spread 0) has no underdog, so it can never produce an upset, whoever wins.
  { const g = G({ spread: 0, lockedSpread: 0, homeScore: 30, awayScore: 20 });
    out['U4 PK: underdogTeam is null'] = st.underdogTeam(g) === null;
    out['U4 PK: neither side is an upset called, regardless of outcome'] = st.isUpsetCalled(P('Alpha'), g) === false && st.isUpsetCalled(P('Beta'), g) === false;
    const locked = G({ spread: 6.5, lockedSpread: 0, homeScore: 24, awayScore: 20 });
    out['U4 a LOCKED PK governs over a live +6.5 (precedence is on usability, not presence): no underdog'] = st.underdogTeam(locked) === null && st.isUpsetCalled(P('Alpha'), locked) === false;
    const unlocked = G({ spread: 6.5, lockedSpread: null, homeScore: 24, awayScore: 20 });
    out['U4 no locked line → the live line is the scoring line'] = st.underdogTeam(unlocked) === 'Alpha'; }
  // 5. An AWAY underdog (negative home spread) that wins outright.
  { const g = G({ spread: -7, lockedSpread: -7, homeScore: 17, awayScore: 20 });
    out['U5 away underdog (home -7) wins 20-17 → upset called, line +7, score 20–17'] = st.isUpsetCalled(P('Beta'), g) === true && st.underdogTeam(g) === 'Beta' && st.upsetLineLabel(g) === '+7' && st.outrightScoreLine(g) === '20–17'; }
  // 6. Not final / no usable score / no usable spread → never an upset.
  { const live = G({ spread: 6.5, lockedSpread: 6.5, homeScore: 24, awayScore: 20, status: 'live' });
    out['U6 a game that is not final is never an upset called, even while the underdog is winning'] = st.isUpsetCalled(P('Alpha'), live) === false;
    const noSp = G({ spread: null, lockedSpread: null, homeScore: 24, awayScore: 20 });
    out['U6 no usable spread → no underdog → no upset'] = st.underdogTeam(noSp) === null && st.isUpsetCalled(P('Alpha'), noSp) === false;
    const tie = G({ spread: 6.5, lockedSpread: 6.5, homeScore: 20, awayScore: 20 });
    out['U6 a tied score has no outright winner → no upset'] = st.isUpsetCalled(P('Alpha'), tie) === false;
    out['U6 null pick / null game → false, never a throw'] = st.isUpsetCalled(null, G({})) === false && st.isUpsetCalled(P('Alpha'), null) === false; }
  return out;
}
{
  const res = checkUpsetVectors({ stats });
  for (const [label, ok] of Object.entries(res)) assert(ok === true, `3: ${label}`);
  assert(Object.keys(res).length >= 15, `3-floor: at least 15 upset checks ran (${Object.keys(res).length})`);
  // atsMarginOf — "covered by": the same precedence calculateAtsWinner grades with.
  const g = mkGame({ id: 'm', weekId: 'w', kick: 'x', home: 'H', away: 'A', kind: 'cover', state: 'final' }); // -3, 24-10 → covers by 11
  assert(stats.atsMarginOf(g) === 11, `3-margin: home -3, 24-10 → covered by 11 (got ${stats.atsMarginOf(g)})`);
  assert(stats.atsMarginOf(mkGame({ id: 'm', weekId: 'w', kick: 'x', home: 'H', away: 'A', kind: 'push', state: 'final' })) === null, '3-margin: a pushed line covered by nothing → null');
  assert(stats.atsMarginOf({ homeScore: 10, awayScore: 3 }) === null, '3-margin: no usable spread → null');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[4] DI-361 — memberSeasonStats on the two-week league (every number hand-derived)…');
// ═══════════════════════════════════════════════════════════════════════════
const L = buildLeague({ w2: 'final', calculateWeeklyResults });
const viewOf = (extra = {}) => ({ players: L.players, revealedWeeks: L.weeks, revealedGames: L.games, revealedPicks: L.picks, revealedWeeklyResults: L.weeklyResults, ...extra });
const S_ALL = Object.fromEntries(L.players.map(p => [p.playerId, stats.memberSeasonStats(p.playerId, viewOf())]));
{
  // parity (acceptance test 1)
  const std = calculateSeasonStandings(L.players, L.weeklyResults, L.weeks);
  let parity = 0;
  for (const row of std) {
    const s = S_ALL[row.playerId];
    if (s.currentRank === row.currentRank && s.winPct === row.winPct && s.weeklyWins === row.weeklyWins && s.weeklyLosses === row.weeklyLosses) parity++;
  }
  assert(parity === 6, `4-1: currentRank / winPct / weeklyWins / weeklyLosses equal calculateSeasonStandings's own row for all six players (${parity}/6) — parity, not a recomputation`);
  const ranks = Object.fromEntries(L.players.map(p => [p.playerId, S_ALL[p.playerId].currentRank]));
  assert(JSON.stringify(ranks) === JSON.stringify({ p1: 2, p2: 3, p3: 6, p4: 4, p5: 1, p6: 5 }), `4-2: ranks after week 2 are the hand-derived {p5:1, p1:2, p2:3, p4:4, p6:5, p3:6} (got ${JSON.stringify(ranks)})`);
  const r1 = Object.fromEntries(L.players.map(p => [p.playerId, stats.memberSeasonStats(p.playerId, viewOf({ asOfWeekId: 'w1' })).currentRank]));
  assert(JSON.stringify(r1) === JSON.stringify({ p1: 1, p2: 3, p3: 4, p4: 5, p5: 2, p6: 6 }), `4-3: asOfWeekId 'w1' gives the week-1 ranks {p1:1, p5:2, p2:3, p3:4, p4:5, p6:6} (got ${JSON.stringify(r1)})`);
  const rec = Object.fromEntries(L.players.map(p => [p.playerId, `${S_ALL[p.playerId].record.wins}-${S_ALL[p.playerId].record.losses}`]));
  assert(JSON.stringify(rec) === JSON.stringify({ p1: '5-4', p2: '5-4', p3: '2-7', p4: '4-5', p5: '7-2', p6: '3-6' }), `4-4: season records are the hand-summed {p1 5-4, p2 5-4, p3 2-7, p4 4-5, p5 7-2, p6 3-6} (got ${JSON.stringify(rec)})`);
  const stdById = Object.fromEntries(std.map(r => [r.playerId, r]));
  const std2 = Object.fromEntries(L.players.map(p => [p.playerId, `${stdById[p.playerId].totalCorrectCount}-${stdById[p.playerId].totalIncorrectCount}`]));
  assert(JSON.stringify(std2) === JSON.stringify(rec), '4-5: record.wins/losses equal the standings\'s own RAW totalCorrectCount/totalIncorrectCount for everyone (they can never disagree)');
  const cs = Object.fromEntries(L.players.map(p => [p.playerId, `${S_ALL[p.playerId].currentStreak.run}${S_ALL[p.playerId].currentStreak.kind}/${S_ALL[p.playerId].currentStreak.state}`]));
  assert(JSON.stringify(cs) === JSON.stringify({ p1: '1misses/none', p2: '2covers/none', p3: '4misses/active', p4: '1covers/none', p5: '5covers/active', p6: '1covers/none' }),
    `4-6: current streaks are the hand-derived (p5 5 covers active, p3 4 misses active, the rest below STREAK_MIN) — got ${JSON.stringify(cs)}`);
  const ls = Object.fromEntries(L.players.map(p => [p.playerId, S_ALL[p.playerId].longestStreak.run]));
  assert(JSON.stringify(ls) === JSON.stringify({ p1: 4, p2: 3, p3: 1, p4: 2, p5: 5, p6: 1 }), `4-7: longest COVER streaks are {p1 4, p2 3, p3 1, p4 2, p5 5, p6 1} (got ${JSON.stringify(ls)})`);
  const up = Object.fromEntries(L.players.map(p => [p.playerId, S_ALL[p.playerId].upsetsCalled]));
  assert(JSON.stringify(up) === JSON.stringify({ p1: 1, p2: 1, p3: 0, p4: 2, p5: 2, p6: 1 }), `4-8: upsets called are {p1 1, p2 1, p3 0, p4 2, p5 2, p6 1} — g13 and g21 are the two upsets (got ${JSON.stringify(up)})`);
  const bw = (s) => s.bestWeek && `${s.bestWeek.weekN}:${s.bestWeek.wins}-${s.bestWeek.losses}`, ww = (s) => s.worstWeek && `${s.worstWeek.weekN}:${s.worstWeek.wins}-${s.worstWeek.losses}`;
  assert(bw(S_ALL.p5) === '2:4-0' && ww(S_ALL.p5) === '1:3-2', `4-9: p5 best week is week 2 (4-0), worst week 1 (3-2) — by raw wins (got ${bw(S_ALL.p5)} / ${ww(S_ALL.p5)})`);
  assert(bw(S_ALL.p1) === '1:4-1' && ww(S_ALL.p1) === '2:1-3', `4-10: p1 best week 1 (4-1), worst week 2 (1-3) (got ${bw(S_ALL.p1)} / ${ww(S_ALL.p1)})`);
  assert(bw(S_ALL.p4) === '1:2-3' && ww(S_ALL.p4) === '1:2-3', `4-11: p4 has 2 wins in both weeks — a tie goes to the EARLIEST week for best and for worst (got ${bw(S_ALL.p4)} / ${ww(S_ALL.p4)})`);
  assert(S_ALL.p3.bestWeek.weekN === 1 && S_ALL.p3.worstWeek.weekN === 2 && S_ALL.p3.worstWeek.wins === 0, '4-12: p3 best week 1 (2 wins), worst week 2 (0-4)');
  assert(S_ALL.p1.season === '2026' && S_ALL.p1.sport === null, `4-13: season is read off the weeks ('2026'); sport is read off the inputs and is null when they carry none — never hard-coded 'cfb' (got ${S_ALL.p1.season}/${S_ALL.p1.sport})`);
  const cfbWeeks = L.weeks.map(w => ({ ...w, sport: 'nfl' }));
  assert(stats.memberSeasonStats('p1', viewOf({ revealedWeeks: cfbWeeks })).sport === 'nfl', '4-14: a sport carried on the weeks flows through (sport-neutral by construction)');
}

// raw vs weighted — a multiplier game must NOT leak into the record
{
  const wk = mkWeek({ id: 'wm', n: 1, status: 'final' });
  const m1 = mkGame({ id: 'm1', weekId: 'wm', kick: '2026-09-05T16:00:00.000Z', home: 'Home1', away: 'Away1', kind: 'cover', state: 'final', extra: { multiplier: 3 } });
  const m2 = mkGame({ id: 'm2', weekId: 'wm', kick: '2026-09-05T17:00:00.000Z', home: 'Home2', away: 'Away2', kind: 'cover', state: 'final' });
  const picks = [...mkPicks(m1, 'cover', 'W-----'), ...mkPicks(m2, 'cover', 'L-----')];
  const rows = calculateWeeklyResults('wm', [PLAYERS[0]], picks, [m1, m2]);
  assert(rows[0].correctPicks === 3 && rows[0].correctCount === 1, `4-15: fixture check — the 3x game makes weighted correctPicks 3 and raw correctCount 1 (got ${rows[0].correctPicks}/${rows[0].correctCount})`);
  const s = stats.memberSeasonStats('p1', { players: [PLAYERS[0]], revealedWeeks: [wk], revealedGames: [m1, m2], revealedPicks: picks, revealedWeeklyResults: rows });
  const std = calculateSeasonStandings([PLAYERS[0]], rows, [wk]);
  assert(s.record.wins === 1 && s.record.losses === 1, `4-16: record is RAW — 1-1, not the weighted 3-1 (got ${s.record.wins}-${s.record.losses})`);
  assert(std[0].totalCorrect === 3 && s.record.wins === std[0].totalCorrectCount, '4-17: the weighted total (3) differs from the record (1), and the record equals the standings\'s own RAW count');
  assert(s.winPct === std[0].winPct && s.winPct === 50, `4-18: winPct is the standings's own raw-count percentage, 50 (got ${s.winPct})`);
  // a pre-multiplier row carries no count fields: the same fallback calculateSeasonStandings applies
  const oldRows = rows.map(r => { const { correctCount, incorrectCount, ...rest } = r; return rest; });
  const so = stats.memberSeasonStats('p1', { players: [PLAYERS[0]], revealedWeeks: [wk], revealedGames: [m1, m2], revealedPicks: picks, revealedWeeklyResults: oldRows });
  const stdo = calculateSeasonStandings([PLAYERS[0]], oldRows, [wk]);
  assert(so.record.wins === stdo[0].totalCorrectCount && so.record.losses === stdo[0].totalIncorrectCount, `4-19: a row with no raw-count fields falls back to correctPicks/incorrectPicks exactly as calculateSeasonStandings does (got ${so.record.wins}-${so.record.losses})`);
}

// alma mater — STRAIGHT-UP only
{
  const wk = mkWeek({ id: 'wa', n: 1, status: 'final' });
  const AG = (id, home, away, hs, as, o = {}) => mkGame({ id, weekId: 'wa', kick: `2026-09-05T1${id.slice(1)}:00:00.000Z`, home, away, kind: 'cover', state: 'final', extra: { homeScore: hs, awayScore: as, isAlmaMaterGame: true, ...o } });
  const games = [
    AG('a1', 'Texas A&M', 'Rice', 31, 10), AG('a2', 'Alabama', 'Texas A&M', 28, 17), AG('a3', 'Texas A&M', 'Utah', 17, 17),
    AG('a4', 'Texas A&M', 'Notre Dame', 21, 14, { isAlmaMaterGame: false }), AG('a5', 'Texas A&M', 'LSU', 7, 3, { status: 'live' }),
    AG('a6', 'Arkansas State', 'Troy', 30, 3), AG('a7', 'Arkansas', 'Ole Miss', 24, 21),
  ];
  const players = [{ ...PLAYERS[0] }, { ...PLAYERS[1] }, { ...PLAYERS[4] }, { playerId: 'p9', displayName: 'Blank', active: true, almaMater: '' }];
  const sA = (id) => stats.memberSeasonStats(id, { players, revealedWeeks: [wk], revealedGames: games, revealedPicks: [], revealedWeeklyResults: [] }).almaMaterStraightUp;
  assert(JSON.stringify(sA('p1')) === '{"wins":1,"losses":1}', `4-20: Texas A&M (p1): beat Rice, lost at Alabama; the tie, the un-flagged game and the LIVE game count for nothing → 1-1 (got ${JSON.stringify(sA('p1'))})`);
  assert(JSON.stringify(sA('p5')) === '{"wins":1,"losses":0}', `4-21: Arkansas (p5): beat Ole Miss; Arkansas STATE's win is not Arkansas's (the shared precise matcher) → 1-0 (got ${JSON.stringify(sA('p5'))})`);
  assert(sA('p2') === null, '4-22: a school with no flagged final game → null (absent, never 0-0)');
  assert(sA('p9') === null && sA('nobody') === null, '4-23: a player with a blank alma mater, or an unknown player → null');
  assert(calculateAlmaMaterTotal(games, ['Texas A&M'], 'selectedSlateOnly') === 31 + 17 + 17,
    '4-24: cross-check — calculateAlmaMaterTotal(selectedSlateOnly) sums A&M over the SAME flagged final games the W/L walked (31+17+17); it returns points, not a W/L, which is why the W/L is computed here');
  // never ATS: a straight-up LOSS that covered the spread is still a loss
  const cover = AG('a8', 'Texas A&M', 'Rice', 17, 20, { spread: 6, lockedSpread: 6 });
  const sc = stats.memberSeasonStats('p1', { players, revealedWeeks: [wk], revealedGames: [cover], revealedPicks: [], revealedWeeklyResults: [] }).almaMaterStraightUp;
  assert(JSON.stringify(sc) === '{"wins":0,"losses":1}', `4-25: STRAIGHT-UP, never ATS (locked decision): A&M +6 losing 17-20 covered the spread but is still an alma-mater LOSS (got ${JSON.stringify(sc)})`);
}

// almaMaterResultForWeek — the player.week card's `almaMaterResult` fact (DI-362 amendment, 2026-10-01)
function checkAlmaWeek({ stats: st }) {
  const out = {};
  const AG = (id, home, away, hs, as, o = {}) => mkGame({ id, weekId: 'wa', kick: `2026-09-05T1${id.slice(1)}:00:00.000Z`, home, away, kind: 'cover', state: 'final', extra: { homeScore: hs, awayScore: as, isAlmaMaterGame: true, ...o } });
  const one = (g) => st.almaMaterResultForWeek('Texas A&M', 'wa', [g]);
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  out['AW1 a win → { team, result: "win" }, the team spelled as the GAME ROW spells it'] = eq(one(AG('a1', 'Texas A&M', 'Rice', 31, 10)), { team: 'Texas A&M', result: 'win' });
  out['AW2 a road loss → result "loss"'] = eq(one(AG('a2', 'Alabama', 'Texas A&M', 28, 17)), { team: 'Texas A&M', result: 'loss' });
  out['AW3 straight-up only: a loss that covered the spread is still a loss'] = eq(one(AG('a3', 'Texas A&M', 'Rice', 17, 20, { spread: 6, lockedSpread: 6 })), { team: 'Texas A&M', result: 'loss' });
  out['AW4 a tie, a LIVE game, an un-flagged game and a game with no score → null (no game)'] = [AG('a4', 'Texas A&M', 'Utah', 17, 17), AG('a5', 'Texas A&M', 'LSU', 7, 3, { status: 'live' }), AG('a6', 'Texas A&M', 'Notre Dame', 21, 14, { isAlmaMaterGame: false }), AG('a7', 'Texas A&M', 'Rice', null, null)].every(g => one(g) === null);
  out['AW5 two decisive alma games in one week → null (ambiguous: absent beats wrong)'] = st.almaMaterResultForWeek('Texas A&M', 'wa', [AG('a1', 'Texas A&M', 'Rice', 31, 10), AG('a2', 'Alabama', 'Texas A&M', 28, 17)]) === null;
  out['AW6 another week\'s game does not count; an unknown week → null'] = st.almaMaterResultForWeek('Texas A&M', 'other', [AG('a1', 'Texas A&M', 'Rice', 31, 10)]) === null;
  out['AW7 the shared PRECISE matcher: Arkansas State\'s win is not Arkansas\'s'] = st.almaMaterResultForWeek('Arkansas', 'wa', [AG('a8', 'Arkansas State', 'Troy', 30, 3)]) === null && eq(st.almaMaterResultForWeek('Arkansas', 'wa', [AG('a9', 'Arkansas', 'Ole Miss', 24, 21)]), { team: 'Arkansas', result: 'win' });
  out['AW8 a blank / missing school → null'] = st.almaMaterResultForWeek('', 'wa', [AG('a1', 'Texas A&M', 'Rice', 31, 10)]) === null && st.almaMaterResultForWeek(undefined, 'wa', []) === null && st.almaMaterResultForWeek(null, 'wa', null) === null;
  // a free-text school that names an INHERITED property must not take the profile (and the feed) down
  let threw = null, results = [];
  for (const bad of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
    try {
      results.push(st.almaMaterResultForWeek(bad, 'wa', [AG('a1', 'Texas A&M', 'Rice', 31, 10)]));
      results.push(st.memberSeasonStats('p1', { players: [{ ...PLAYERS[0], almaMater: bad }], revealedWeeks: [mkWeek({ id: 'wa', n: 1, status: 'final' })], revealedGames: [AG('a1', 'Texas A&M', 'Rice', 31, 10)], revealedPicks: [], revealedWeeklyResults: [] }).almaMaterStraightUp);
    } catch (e) { threw = e; }
  }
  out['AW9 a school named "constructor" / "__proto__" / "toString" / … neither throws nor matches anything (reviewer probe, 2026-10-01)'] = threw === null && results.length === 10 && results.every(r => r === null);
  return out;
}
{
  const res = checkAlmaWeek({ stats });
  for (const [label, ok] of Object.entries(res)) assert(ok === true, `4-33: ${label}`);
}

// season filter, asOf, unknown member, inputs, defaults
{
  const w25 = { ...mkWeek({ id: 'w25', n: 1, status: 'final' }), season: '2025' };
  const g25 = mkGame({ id: 'o1', weekId: 'w25', kick: '2025-09-05T16:00:00.000Z', home: 'H', away: 'A', kind: 'cover', state: 'final' });
  const p25 = mkPicks(g25, 'cover', 'W-----');
  const rows25 = calculateWeeklyResults('w25', [PLAYERS[0]], p25, [g25]);
  const mixed = { players: L.players, revealedWeeks: [...L.weeks, w25], revealedGames: [...L.games, g25], revealedPicks: [...L.picks, ...p25], revealedWeeklyResults: [...L.weeklyResults, ...rows25] };
  const s26 = stats.memberSeasonStats('p1', { ...mixed, season: '2026' });
  assert(s26.record.wins === 5 && s26.record.losses === 4, `4-26: season '2026' leaves last season's week out of the record (got ${s26.record.wins}-${s26.record.losses})`);
  const sAny = stats.memberSeasonStats('p1', mixed);
  assert(sAny.record.wins === 6, `4-27: with no season given, every week in the view counts (6 wins incl. the 2025 week; got ${sAny.record.wins})`);
  const ghost = stats.memberSeasonStats('p1', viewOf({ asOfWeekId: 'not-a-week' }));
  assert(ghost.record.wins === 0 && ghost.record.losses === 0 && ghost.currentRank !== undefined && ghost.bestWeek === null, '4-28: an asOfWeekId that is not in the view yields EMPTY stats — it fails closed, never a wider view');
  const none = stats.memberSeasonStats('zz', viewOf());
  assert(none.record.wins === 0 && none.currentRank === null && none.winPct === null && none.currentStreak.state === 'none' && none.longestStreak.run === 0 && none.bestWeek === null && none.upsetsCalled === 0 && none.almaMaterStraightUp === null,
    `4-29: an unknown member is a clean empty answer, not a throw and not a fabricated rank (got ${JSON.stringify(none)})`);
  let threw = false; try { stats.memberSeasonStats('p1'); stats.memberSeasonStats('p1', {}); stats.memberSeasonStats('p1', { revealedWeeks: null, revealedGames: undefined }); } catch { threw = true; }
  assert(!threw, '4-30: no argument object / null arrays → defaults, never a throw (CONVENTIONS #7)');
  // UN-118 group sizing: Standings passes EVERY week so a split week waits for all its parts
  const gA = { ...mkWeek({ id: 'ga', n: 10, status: 'final' }), groupId: 'ga' }, gB = { ...mkWeek({ id: 'gb', n: 11, status: 'open' }), groupId: 'ga' };
  const gm = mkGame({ id: 'gg1', weekId: 'ga', kick: '2026-11-07T16:00:00.000Z', home: 'H', away: 'A', kind: 'cover', state: 'final' });
  const gp = [...mkPicks(gm, 'cover', 'WL----')];
  const grows = calculateWeeklyResults('ga', [PLAYERS[0], PLAYERS[1]], gp, [gm]);
  const gview = { players: [PLAYERS[0], PLAYERS[1]], revealedWeeks: [gA], revealedGames: [gm], revealedPicks: gp, revealedWeeklyResults: grows };
  const solo = stats.memberSeasonStats('p1', gview);
  const grouped = stats.memberSeasonStats('p1', { ...gview, allWeeks: [gA, gB] });
  const stdG = calculateSeasonStandings([PLAYERS[0], PLAYERS[1]], grows, [gA, gB]).find(r => r.playerId === 'p1');
  assert(solo.weeklyWins === 1, '4-31: fixture check — with only the revealed week in view the split week LOOKS like a solo week (1 weekly win)');
  assert(grouped.weeklyWins === stdG.weeklyWins && grouped.weeklyWins === 0, `4-32: with every week RECORD supplied (structure only) the split week waits for its other part, exactly as Standings does — 0 weekly wins (got ${grouped.weeklyWins})`);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[5] DI-361 test 3 / S-C2 — the revealed-view restriction is LOAD-BEARING, not coincidental…');
// ═══════════════════════════════════════════════════════════════════════════
function checkRestriction({ stats: st }) {
  const out = {};
  // s1 (final, revealed): L,W,W → a run of 2.  s2 (OPEN, NOT revealed): one more cover — which, if included, makes 3 = STREAK_MIN.
  const S = buildSequence({ codes: 'LWWW', weekSizes: [3, 1], calculateWeeklyResults });
  const hidden = 's2';
  const revealed = (extra = {}) => st.memberSeasonStats('p1', {
    players: S.players, revealedWeeks: S.weeks.filter(w => w.weekId !== hidden), revealedGames: S.games.filter(g => g.weekId !== hidden),
    revealedPicks: S.picks.filter(p => p.weekId !== hidden), revealedWeeklyResults: S.weeklyResults.filter(r => r.weekId !== hidden), ...extra });
  const leaked = st.memberSeasonStats('p1', { players: S.players, revealedWeeks: S.weeks, revealedGames: S.games, revealedPicks: S.picks, revealedWeeklyResults: S.weeklyResults });
  const r = revealed();
  out['R1 with the hidden week correctly EXCLUDED the streak is 2 covers, state none'] = r.currentStreak.run === 2 && r.currentStreak.state === 'none';
  out['R2 the SAME fixture with the hidden week wrongly left in reports a 3-cover active streak — the restriction is what keeps it out'] = leaked.currentStreak.run === 3 && leaked.currentStreak.state === 'active';
  out['R3 the leak also moves the record (2-1 revealed vs 3-1 leaked)'] = r.record.wins === 2 && leaked.record.wins === 3;
  out['R4 asOfWeekId "s1" over the FULL view equals the revealed view (the slice is a second, independent guard)'] =
    JSON.stringify(st.memberSeasonStats('p1', { players: S.players, revealedWeeks: S.weeks, revealedGames: S.games, revealedPicks: S.picks, revealedWeeklyResults: S.weeklyResults, asOfWeekId: 's1' }).currentStreak) === JSON.stringify(r.currentStreak);
  out['R5 asOfWeekId "s2" over the full view is the leaked answer (the slice includes the week asked for)'] =
    st.memberSeasonStats('p1', { players: S.players, revealedWeeks: S.weeks, revealedGames: S.games, revealedPicks: S.picks, revealedWeeklyResults: S.weeklyResults, asOfWeekId: 's2' }).currentStreak.run === 3;
  return out;
}
{
  const res = checkRestriction({ stats });
  for (const [label, ok] of Object.entries(res)) assert(ok === true, `5: ${label}`);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[6] DI-361 — structure: no calculateWeeklyResults, no storage, no tiebreaker field, inputs untouched…');
// ═══════════════════════════════════════════════════════════════════════════
{
  const src = await read('./js/stats.js');
  const code = stripComments(src);
  const imps = importsOf(src);
  const scoringImp = imps.find(i => i.from === './scoring.js');
  assert(!!scoringImp && /\bcalculateSeasonStandings\b/.test(scoringImp.names) && /\bevaluatePick\b/.test(scoringImp.names) && !/calculateWeeklyResults/.test(scoringImp.names),
    `6-1: stats.js imports calculateSeasonStandings and evaluatePick from scoring.js and NOT calculateWeeklyResults (acceptance test 4 — an import-list assertion; got "${scoringImp && scoringImp.names.replace(/\s+/g, ' ')}")`);
  assert(!/calculateWeeklyResults/.test(code), '6-2: …and the name does not appear in stats.js\'s code at all (the season record can never be a live recompute)');
  assert(!imps.some(i => /storage|backend|supabase|auth|chat/i.test(i.from)), `6-3: stats.js imports no storage / backend / auth / chat module — it reads nothing, writes nothing (imports: ${imps.map(i => i.from).join(', ')})`);
  assert(!/\b(save|load|localStorage|fetch|sendEvent)\s*\(/.test(code), '6-4: no save / load / fetch / sendEvent call anywhere in stats.js');
  const core = stripComments(await read('./js/stats-core.js'));
  assert(importsOf(await read('./js/stats-core.js')).every(i => i.from === './scoring.js'), '6-5: stats-core.js imports only ./scoring.js (evaluatePick, the standings\'s own grader) — no storage, no chat, no DOM');
  assert(!/canViewOtherPicks|arePicksPublic/.test(core) && !/canViewOtherPicks|arePicksPublic/.test(code), '6-6: neither module asks any reveal question — they compute FACTS; the gate is feed-cards.js\'s isRevealed()');

  const deepKeys = (o, acc = []) => { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { acc.push(k); deepKeys(v, acc); } return acc; };
  const keys = deepKeys(S_ALL.p1);
  assert(!keys.some(k => /tiebreak/i.test(k)), `6-7: the return shape has NO tiebreaker field anywhere (CONVENTIONS #23) — keys: ${keys.join(',')}`);
  assert(JSON.stringify(Object.keys(S_ALL.p1)) === JSON.stringify(['playerId', 'season', 'sport', 'record', 'winPct', 'weeklyWins', 'weeklyLosses', 'currentRank', 'currentStreak', 'longestStreak', 'bestWeek', 'worstWeek', 'upsetsCalled', 'almaMaterStraightUp']),
    '6-8: the return shape is exactly DI-361\'s (+ sport): playerId, season, sport, record, winPct, weeklyWins, weeklyLosses, currentRank, currentStreak, longestStreak, bestWeek, worstWeek, upsetsCalled, almaMaterStraightUp');

  // purity: deep-freeze every input; any write would throw in strict mode (ES modules are strict)
  const freeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(freeze); } return o; };
  const frozen = freeze(JSON.parse(JSON.stringify({ players: L.players, revealedWeeks: L.weeks, revealedGames: L.games, revealedPicks: L.picks, revealedWeeklyResults: L.weeklyResults, allWeeks: L.weeks })));
  let threw = false, a, b;
  try { a = JSON.stringify(stats.memberSeasonStats('p5', frozen)); b = JSON.stringify(stats.memberSeasonStats('p5', frozen)); } catch { threw = true; }
  assert(!threw && a === b, '6-9: deep-frozen inputs are never written to, and the same input gives the same output twice (pure + deterministic)');
  const sorted = stats.sortWeeks([{ weekId: 'b', season: '2026', weekNumber: 2 }, { weekId: 'a', season: '2026', weekNumber: 1 }, { weekId: 'z', season: '2025', weekNumber: 9 }, null]);
  assert(sorted.map(w => w.weekId).join() === 'z,a,b', '6-10: sortWeeks orders by (season, weekNumber), drops nulls, and does not mutate its argument');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[7] MUTATION PROOFS — scratch copies loaded as data: URLs; each mutant must turn a NAMED check RED…');
// ═══════════════════════════════════════════════════════════════════════════
// The mutants are in-memory source copies. The real files are never written, and no git command is involved.
const URL_OF = (rel) => new URL(rel, import.meta.url).href;
async function loadMutant(rel, edits, rewrites = {}) {
  let src = await readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  for (const [a, b] of edits) {
    const n = src.split(a).length - 1;
    if (n !== 1) throw new Error(`mutation anchor must match exactly once in ${rel} (matched ${n}): ${a}`);
    src = src.split(a).join(b);
  }
  src = src.replace(/from '\.\/([\w.-]+)'/g, (_m, f) => `from '${rewrites[f] || URL_OF('./js/' + f)}'`);
  return import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
}
async function killed(label, mutantMods, runner, mustFail) {
  const res = runner(mutantMods);
  const failed = Object.entries(res).filter(([, ok]) => ok !== true).map(([l]) => l);
  const hit = mustFail.every(m => failed.some(f => f.startsWith(m)));
  assert(failed.length > 0 && hit, `${label} → RED on: ${failed.slice(0, 4).join(' | ') || '(nothing — the mutant SURVIVED)'}`);
}
{
  // control: the unmutated suite is green through the same runners
  assert(Object.values(checkStreakVectors({ statsCore, stats })).every(Boolean) && Object.values(checkUpsetVectors({ stats })).every(Boolean) && Object.values(checkRestriction({ stats })).every(Boolean),
    '7-0: POSITIVE CONTROL — the unmutated modules pass every named check, so a red below is the mutation\'s doing');

  // M1 a push BREAKS the run (graded as a loss) — SD-11 says it is skipped
  const m1 = await loadMutant('./js/stats-core.js', [["if (result !== 'win' && result !== 'loss') continue;          // graded only", "const rr = result === 'no_decision' ? 'loss' : result; if (rr !== 'win' && rr !== 'loss') continue; result = rr;"], ['const result = evaluatePick(p, game);', 'let result = evaluatePick(p, game);']]);
  await killed('7-1: M1 a push breaks the streak (SD-11 says skipped)', { statsCore: m1, stats }, ({ statsCore: sc, stats: st }) => checkStreakVectors({ statsCore: sc, stats: st }), ['V1 the push is skipped', 'P1 a push between']);
  // M2 runLength off by one
  const m2 = await loadMutant('./js/stats-core.js', [['for (let i = results.length - 1; i >= 0; i--) { if (results[i].result === last) run++; else break; }', 'for (let i = results.length - 1; i >= 1; i--) { if (results[i].result === last) run++; else break; }']]);
  await killed('7-2: M2 runLength stops one short', { statsCore: m2, stats }, ({ statsCore: sc, stats: st }) => checkStreakVectors({ statsCore: sc, stats: st }), ['V1 the prior run walking back', 'V4 the streak that existed BEFORE', 'P1 a push between', 'P4 misses are a streak']);
  // M3 the sort ignores kickoff (insertion order)
  const m3 = await loadMutant('./js/stats-core.js', [['out.sort((a, b) => (a.rank - b.rank) || (a.ms - b.ms) || String(a.gameId).localeCompare(String(b.gameId)));', '']]);
  const ord = (S, mods) => JSON.stringify(mods.orderedGradedResults('p1', [...S.games].reverse(), [...S.picks].reverse(), S.weeks));
  { const S = buildSequence({ codes: 'WWPWLWW', weekSizes: [5, 2], calculateWeeklyResults });
    assert(ord(S, statsCore) === JSON.stringify(statsCore.orderedGradedResults('p1', S.games, S.picks, S.weeks)) && ord(S, m3) !== JSON.stringify(m3.orderedGradedResults('p1', S.games, S.picks, S.weeks)),
      '7-3: M3 dropping the kickoff sort makes the answer depend on insertion order (real module is order-independent, mutant is not)'); }
  // M4 loneWolfWinner accepts a single loser
  const m4 = await loadMutant('./js/stats-core.js', [['if (winners.length === 1 && losers.length >= 2) {', 'if (winners.length === 1 && losers.length >= 1) {']]);
  { const g = mkGame({ id: 'lw', weekId: 'w', kick: 'x', home: 'Home', away: 'Away', kind: 'cover', state: 'final' });
    const two = mkPicks(g, 'cover', 'WL----');
    assert(statsCore.loneWolfWinner(g, two, { calculateAtsWinner }) === null && m4.loneWolfWinner(g, two, { calculateAtsWinner }) !== null, '7-4: M4 (losers ≥ 1) turns a 1-vs-1 into a "lone wolf" — the real module says null'); }
  // M5 upset ignores the outright-win condition
  const m5 = await loadMutant('./js/stats.js', [['return outrightWinner(game) === dog;', 'return true;']]);
  await killed('7-5: M5 drops "won outright" (a backdoor cover becomes an upset)', { stats: m5 }, checkUpsetVectors, ['U2']);
  // M6 PK treated as having an underdog
  const m6 = await loadMutant('./js/stats.js', [['if (sv === null || sv === 0) return null;\n  const dog = sv < 0', 'if (sv === null) return null;\n  const dog = sv < 0']]);
  await killed('7-6: M6 a PK line gets an underdog', { stats: m6 }, checkUpsetVectors, ['U4']);
  // M7 the record is the WEIGHTED tally
  const m7 = await loadMutant('./js/stats.js', [['const wins = mine.reduce((s, r) => s + num(r.correctCount ?? r.correctPicks ?? 0), 0);', 'const wins = mine.reduce((s, r) => s + num(r.correctPicks ?? 0), 0);']], { 'stats-core.js': URL_OF('./js/stats-core.js') });
  { const wk = mkWeek({ id: 'wm', n: 1, status: 'final' });
    const m1g = mkGame({ id: 'm1', weekId: 'wm', kick: '2026-09-05T16:00:00.000Z', home: 'Home1', away: 'Away1', kind: 'cover', state: 'final', extra: { multiplier: 3 } });
    const m2g = mkGame({ id: 'm2', weekId: 'wm', kick: '2026-09-05T17:00:00.000Z', home: 'Home2', away: 'Away2', kind: 'cover', state: 'final' });
    const pk = [...mkPicks(m1g, 'cover', 'W-----'), ...mkPicks(m2g, 'cover', 'L-----')];
    const rows = calculateWeeklyResults('wm', [PLAYERS[0]], pk, [m1g, m2g]);
    const v = { players: [PLAYERS[0]], revealedWeeks: [wk], revealedGames: [m1g, m2g], revealedPicks: pk, revealedWeeklyResults: rows };
    assert(stats.memberSeasonStats('p1', v).record.wins === 1 && m7.memberSeasonStats('p1', v).record.wins === 3, '7-7: M7 summing the WEIGHTED correctPicks makes a 3x win count 3 — the real record is raw (1)'); }
  // M8 the asOf slice is ignored
  const m8 = await loadMutant('./js/stats.js', [['weeks = at < 0 ? [] : weeks.slice(0, at + 1);', 'weeks = weeks;']]);
  await killed('7-8: M8 ignoring asOfWeekId lets a later week leak into an earlier week\'s stats', { stats: m8 }, checkRestriction, ['R4']);
  // M9 an unknown asOf widens instead of failing closed
  const m9 = await loadMutant('./js/stats.js', [['weeks = at < 0 ? [] : weeks.slice(0, at + 1);', 'weeks = at < 0 ? weeks : weeks.slice(0, at + 1);']]);
  { const v = viewOf({ asOfWeekId: 'not-a-week' });
    assert(stats.memberSeasonStats('p1', v).record.wins === 0 && m9.memberSeasonStats('p1', v).record.wins === 5, '7-9: M9 (unknown asOf → whole view) is a WIDER view — the real module answers empty'); }
  // M10 the season filter is dropped
  const m10 = await loadMutant('./js/stats.js', [["if (season !== null && season !== undefined) weeks = weeks.filter(w => String(w.season) === String(season));", '']]);
  { const w25 = { ...mkWeek({ id: 'w25', n: 1, status: 'final' }), season: '2025' };
    const g25 = mkGame({ id: 'o1', weekId: 'w25', kick: '2025-09-05T16:00:00.000Z', home: 'H', away: 'A', kind: 'cover', state: 'final' });
    const p25 = mkPicks(g25, 'cover', 'W-----'); const rows25 = calculateWeeklyResults('w25', [PLAYERS[0]], p25, [g25]);
    const v = { players: L.players, revealedWeeks: [...L.weeks, w25], revealedGames: [...L.games, g25], revealedPicks: [...L.picks, ...p25], revealedWeeklyResults: [...L.weeklyResults, ...rows25], season: '2026' };
    assert(stats.memberSeasonStats('p1', v).record.wins === 5 && m10.memberSeasonStats('p1', v).record.wins === 6, '7-10: M10 without the season filter counts last season\'s week — the real module does not'); }
  // M11 the S-C2 caller mistake itself: the restriction omitted → streak leaks (DI-361 test 3, the exact sequence)
  { const S = buildSequence({ codes: 'LWWW', weekSizes: [3, 1], calculateWeeklyResults });
    const call = (weeks) => stats.memberSeasonStats('p1', { players: S.players, revealedWeeks: weeks, revealedGames: S.games.filter(g => weeks.some(w => w.weekId === g.weekId)), revealedPicks: S.picks.filter(p => weeks.some(w => w.weekId === p.weekId)), revealedWeeklyResults: S.weeklyResults.filter(r => weeks.some(w => w.weekId === r.weekId)) });
    const withRestriction = call(S.weeks.filter(w => w.weekId !== 's2')), without = call(S.weeks);
    assert(withRestriction.currentStreak.state === 'none' && without.currentStreak.state === 'active',
      `7-11: S-C2 mutation — disabling the restriction (W+1 left in) MOVES a player to an active 3-cover streak that exists only because of the hidden week: ${JSON.stringify(withRestriction.currentStreak)} → ${JSON.stringify(without.currentStreak)}`); }
  // M13 / M14 / M15 — streakChange itself (the rule SCRIBE and the feed now SHARE)
  assert(Object.values(checkStreakChange({ statsCore })).every(Boolean), '7-13a: POSITIVE CONTROL — the unmutated streakChange passes every named check');
  const m13 = await loadMutant('./js/stats-core.js', [['if (current.run >= STREAK_MIN) {\n    return', 'if (current.run > STREAK_MIN) {\n    return']]);
  await killed('7-13: M13 streakChange reports an active streak only ABOVE the threshold (off by one)', { statsCore: m13 }, checkStreakChange, ['SC2']);
  const m14 = await loadMutant('./js/stats-core.js', [["return { run: prior.run, kind: prior.result === 'win' ? 'covers' : 'misses', state: 'broken' };", "return { run: current.run, kind: current.result === 'win' ? 'covers' : 'misses', state: 'broken' };"]]);
  await killed('7-14: M14 a BROKEN streak reports the post-break run and kind instead of the prior ones', { statsCore: m14 }, checkStreakChange, ['SC1', 'SC4']);
  const m15 = await loadMutant('./js/stats-core.js', [['if (!complete || !Array.isArray(results) || results.length < STREAK_MIN) return null;', 'if (!Array.isArray(results) || results.length < STREAK_MIN) return null;']]);
  await killed('7-15: M15 streakChange ignores `complete` (a history with a hole yields a streak)', { statsCore: m15 }, checkStreakChange, ['SC7']);
  // M16 / M17 — the alma helpers
  assert(Object.values(checkAlmaWeek({ stats })).every(Boolean), '7-16a: POSITIVE CONTROL — the unmutated alma helpers pass every named check');
  // RE-DERIVED at the v0.29.0 batch-3 integration (2026-10-01): SB-12 (dcc81c6, on the release before this branch merged) makes
  // getAlmaMaterMatch() read its pattern tables through ownGet(), so a school named "constructor" no longer throws AT THE MATCHER, and
  // removing stats.js's try/catch ALONE leaves AW9 green — the guard is defence in depth now. M16 removes BOTH layers (must be red);
  // 7-16b removes only stats.js's and proves SB-12's layer holds on its own.
  const UNGUARD_STATS = [['try { return !!getAlmaMaterMatch(teamName, [alma]); } catch { return false; }', 'return !!getAlmaMaterMatch(teamName, [alma]);']];
  const dm16src = (await readFile(fileURLToPath(new URL('./js/data-model.js', import.meta.url)), 'utf8'))
    .split('const excludes = ownGet(ALMA_MATER_EXCLUDE_PATTERNS, alma) || [];').join('const excludes = ALMA_MATER_EXCLUDE_PATTERNS[alma] || [];')
    .split('const patterns = new Set([...(ownGet(ALMA_MATER_EXACT_PATTERNS, alma) || []), alma]);').join('const patterns = new Set([...(ALMA_MATER_EXACT_PATTERNS[alma] || []), alma]);')
    .replace(/from '\.\/([\w.-]+)'/g, (_m, f) => `from '${URL_OF('./js/' + f)}'`);
  assert(!/ownGet\(ALMA_MATER_(EXCLUDE|EXACT)_PATTERNS/.test(dm16src), '7-16 fixture: the data-model.js mutant really reads both pattern tables with a bare probe (both SB-12 anchors applied)');
  const m16 = await loadMutant('./js/stats.js', UNGUARD_STATS, { 'data-model.js': 'data:text/javascript;base64,' + Buffer.from(dm16src).toString('base64') });
  await killed('7-16: M16 the matcher is no longer guarded — stats.js\'s try/catch AND data-model.js\'s ownGet() (SB-12) both removed (a school named "constructor" throws)', { stats: m16 }, checkAlmaWeek, ['AW9']);
  const m16b = await loadMutant('./js/stats.js', UNGUARD_STATS);
  assert(Object.values(checkAlmaWeek({ stats: m16b })).every(Boolean),
    '7-16b: defence in depth — with ONLY stats.js\'s try/catch removed, every alma check still passes: SB-12\'s ownGet() in getAlmaMaterMatch() holds on its own');
  const m17 = await loadMutant('./js/stats.js', [['return week.length === 1 ? { team: week[0].team, result: week[0].result } : null;', 'return week.length >= 1 ? { team: week[0].team, result: week[0].result } : null;']]);
  await killed('7-17: M17 an ambiguous week (two alma games) reports the first one', { stats: m17 }, checkAlmaWeek, ['AW5']);
  const m18 = await loadMutant('./js/stats.js', [["const won = (homeIsMine && hs > as) || (awayIsMine && as > hs);", "const won = (homeIsMine && hs > as) || (awayIsMine && as > hs) || (g.lockedSpread > 0 && as + g.lockedSpread > hs);"]]);
  await killed('7-18: M18 the alma result leaks ATS into a straight-up fact (a covering loss becomes a win)', { stats: m18 }, checkAlmaWeek, ['AW3']);
  // M12 the frozen golden has teeth: a mutated stats-core produces a different SCRIBE signal set
  { const S = buildSequence({ codes: 'WWPWL', weekSizes: [4, 1], calculateWeeklyResults });
    const input = { weekId: 's2', weekStatus: 'final', games: S.games, picks: S.picks, players: S.players, weeks: S.weeks };
    const real = JSON.stringify(scribeLines.detectWeekSignals(input));
    // detectWeekSignals imports the REAL stats-core, so the proof here is on the shared function: the mutant's runLength gives a different 'prior' for the same results
    const ordered = statsCore.orderedGradedResults('p1', S.games, S.picks, S.weeks).results;
    const priorReal = statsCore.runLength(ordered.filter(r => r.weekId !== 's2')).run, priorMut = m2.runLength(ordered.filter(r => r.weekId !== 's2')).run;
    assert(real.includes('"state":"broken"') && priorReal === 3 && priorMut !== 3, '7-12: the SCRIBE broken-streak signal rests on this shared runLength — the M2 mutant would change its prior run (3 → ' + priorMut + ')'); }
}

console.log('\n══════════════════════════════════════════════════');
console.log(fail === 0 ? `✅ ALL PASS — ${pass} passed, ${fail} failed` : `❌ FAILURES — ${pass} passed, ${fail} failed`);
// Flush before exiting (the loadtest.mjs parent parses stdout+stderr): process.exit() does not drain a pipe.
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
