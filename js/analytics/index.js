/**
 * CFB Pickems - js/analytics/index.js (D2 lane 4; DI-941, 947-950, 999; 2026-10-19)
 * ==================================================================================
 * THE PUBLIC SURFACE of the analytics engine: one set of pure files that runs on the device at render time over data the device is
 * already allowed to read, and that the Edge Functions IMPORT (supabase/functions/_shared/analytics-bridge.mjs), never copy.
 * No metric is stored: the only analytics thing the database will hold is a cache of SCRIBE's WORDING (league_insights, migration 0069)
 * and the commissioner-approved memories (league_memories).
 *
 *   buildInput(source, opts)            the ONE constructor and reveal gate (input.js)
 *   runMetric(input, id, params)        one metric, isolated: a throw omits it and is recorded, never shown (DI-949)
 *   computeCatalogue(input, opts)       every metric that ships, over every competition and season in the input
 *   computeCatalogueSliced(...)         the same, in <= 8 ms slices through an injected `schedule` (after first paint, never during a scroll)
 *   candidates(input, opts)             DI-948: scored insight candidates (zero is a correct answer)
 *                                       PERFORMANCE CONDITION (reviewer 2026-10-19, DI-954): the synchronous form costs ~370 ms at the 800-game cap against a 150 ms budget (the cost is the
 *                                       reused stats.js headToHeadRecord), so above CANDIDATES_SYNC_MAX_GAMES (300) it THROWS unless `offMainPath: true` (the server function, a worker).
 *                                       THE BUDGET IS CHECKED BETWEEN METRIC INSTANCES (computeCatalogueSliced; analyticsperftest asserts the total and the longest slice); one heavy instance (a head-to-head pair
 *                                       or the rank path) can still take tens of milliseconds on a loaded machine, so a surface calls it after first paint and never during a scroll (busy()).
 *   candidatesSliced(input, opts)       the same answer in budgeted slices through an injected schedule/clock: what a SURFACE calls (batch 2 wires it after first paint, never during a scroll)
 *   fromInsight(candidate)              DI-999 interface 1: lane B's closed Home candidate
 *   peekFacts(source, opts)             DI-999 interface 2: the standings-consequence facts
 *   insightFromId / packetFor           DI-947: the id is the specification; the packet is all a model sees
 *   labelsFor(input, memberId, opts)    DI-985: a member's labels, honouring the hide switch (RPF-D3)
 *
 * PURE: no storage seam, no DOM, no network, no clock (`now`, `clock`, `schedule` are parameters), no randomness.
 */
import { allDefs, getDef, isAvailable, REVEAL, ENGINE_VERSION, minimumsKey } from './registry.js';
import { buildInput, assertEligible, registerGrader } from './input.js';
import { sliceOf, scopesOf, nameOf } from './slice.js';
import { pairsOf } from './m-pairs.js';
import './m-identity.js';
import './m-performance.js';
import './m-consensus.js';
import './m-situational.js';
import './m-behavior.js';
import './m-league.js';
import './m-strategies.js';
import './m-labels.js';
import './m-callbacks.js';
import './m-teams.js';
import { candidateFor, selectCandidates, fromInsight, insightFromId, assertClosedHomeCandidate, INSIGHT_KINDS } from './insight.js';
import { sealPacket, packetSha, fnv1a, canonicalJson } from './packet.js';
import { peekFacts, consequenceFacts, gameFacts, gameDayInsights, followedTeamFacts } from './m-gameday.js';
import { LABEL_DEFS } from './m-labels.js';

export { followedTeams, followedTeamsFromInput, ownFinalPicksOf, followReason, mostPickedTeams } from './followed.js';
export { SAID_WINDOWS, factOf, isBlocked, recordShown, changedMaterially, ledgerToJson, ledgerFromJson, windowKindOf } from './ledger.js';
export { REASON_CHIPS, SHARE_METRIC_IDS, insightShareIdOk, slug as insightSlug } from './insight.js';
import { teamCaption, gdFollowedLine, gdFactLine, ordinal, lintCopy } from './copy.js';
export { teamCaption, gdFollowedLine, gdFactLine, ordinal, lintCopy };
export { STALE_MS, GD_LIMITS } from './m-gameday.js';
export { followedTeamFacts };
export { offerTeamFact } from './offer.js';
export { teamFamilyOn } from './teams-flag.js';
export { pickEventsOn, PICK_EVENTS_KV_KEY } from './pick-events-flag.js';
export { buildInput, assertEligible, registerGrader, REVEAL, ENGINE_VERSION, fromInsight, insightFromId, assertClosedHomeCandidate, INSIGHT_KINDS, peekFacts, consequenceFacts, gameFacts, gameDayInsights, sealPacket, packetSha, fnv1a, canonicalJson, sliceOf, scopesOf, getDef };

const RESULT_MEMO = new WeakMap();

/** The scope league-level callbacks run in: the latest season, then the first competition id (deterministic). */
function latestScope(scopes) {
  return [...scopes].sort((a, b) => (a.season < b.season ? 1 : a.season > b.season ? -1 : String(a.competitionId) < String(b.competitionId) ? -1 : String(a.competitionId) > String(b.competitionId) ? 1 : 0))[0] || null;
}

/** One metric, isolated (DI-949): a throw is caught and returned as `{ id, reason: 'threw' }`; a discretionary surface never shows an error. */
export function runMetric(input, id, params = {}) {
  assertEligible(input);
  const def = getDef(id);
  if (input.cls === REVEAL.PUBLIC_GAME && def.reveal === REVEAL.FINAL_WEEK) return { id, v: def.v, value: null, reason: 'wrong_class' };
  let memo = RESULT_MEMO.get(input);
  if (!memo) { memo = new Map(); RESULT_MEMO.set(input, memo); }
  const key = minimumsKey() + '|' + id + '|' + JSON.stringify(params);
  if (memo.has(key)) return memo.get(key);
  let out;
  try {
    if (def.crossScope) out = def.run(input, params);
    else {
      const slice = sliceOf(input, { competitionId: params.competitionId, season: params.season, throughWeekId: params.throughWeekId });
      out = slice ? def.run(slice, params) : { id, v: def.v, value: null, reason: 'no_data' };
    }
  } catch (e) {
    out = { id, v: def.v, value: null, reason: 'threw' };
  }
  memo.set(key, out);
  return out;
}

function paramsFor(def, slice) {
  if (typeof def.enumerate === 'function') return def.enumerate(slice);
  if (def.level === 'member') return slice.memberIds.map((memberId) => ({ memberId }));
  if (def.level === 'league') return [{}];
  if (def.level === 'pair') return pairsOf(slice);
  return [];
}

/**
 * Every metric that ships, over every competition and season of the input. Returns plain arrays: `metrics` (available), `unavailable` (the
 * reason table: thin, tie, dark, no_data, ...), `failures` (`{id, reason:'threw'}` for the developer log), and `excluded` (a competition whose
 * format has no grader). A catalogue over a partial league is EMPTY (a truncated pick set gives a wrong rate).
 */
export function computeCatalogue(input, { weekNumber = null } = {}) {
  assertEligible(input);
  const out = { metrics: [], unavailable: [], failures: [], excluded: input.excluded };
  if (input.partial) return out;
  const defs = allDefs().filter((d) => input.cls === REVEAL.FINAL_WEEK || d.reveal === REVEAL.PUBLIC_GAME);
  const scopes = scopesOf(input);
  const latest = latestScope(scopes);
  const seenCross = new Set();
  const push = (r) => { if (isAvailable(r)) out.metrics.push(r); else if (r.reason === 'threw') out.failures.push({ id: r.id, reason: 'threw' }); else out.unavailable.push(r); };
  for (const sc of scopes) {
    const slice = sliceOf(input, { competitionId: sc.competitionId, season: sc.season });
    if (!slice) continue;
    for (const def of defs) {
      if (def.once && sc !== latest) continue;             // league-level callbacks run once, in the current season's first competition
      if (def.crossScope) {
        if (def.crossScope === 'sport' && !seenCross.has(def.id + '|' + sc.season)) {
          seenCross.add(def.id + '|' + sc.season);
          for (const memberId of slice.memberIds) push(runMetric(input, def.id, { memberId, season: sc.season }));
        }
        continue;
      }
      let list;
      try { list = paramsFor(def, slice); } catch { out.failures.push({ id: def.id, reason: 'threw' }); continue; }
      for (const p of list) push(runMetric(input, def.id, { ...p, competitionId: sc.competitionId, season: sc.season, ...(weekNumber !== null ? { weekNumber } : {}) }));
    }
  }
  // canonical order: the same data in any input order gives a byte-identical catalogue
  const key = (m) => [m.id, m.subject ? m.subject.kind + ':' + m.subject.id + ':' + (m.subject.id2 || '') : '', m.scope ? String(m.scope.competitionId) + '|' + m.scope.season : ''].join('|');
  const cmp = (a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
  out.metrics.sort(cmp);
  out.unavailable.sort(cmp);
  return out;
}

/**
 * The same catalogue computed in slices of at most `budgetMs` through an injected `schedule` (requestIdleCallback or setTimeout 0 in the host;
 * a test passes a queue), yielding between metrics families, never while `busy()` says a scroll or a sheet animation is running. No clock of its
 * own: `clock()` is injected. Resolves with the same object computeCatalogue returns.
 */
export function computeCatalogueSliced(input, { schedule, clock, busy = () => false, budgetMs = 8, weekNumber = null } = {}) {
  assertEligible(input);
  return new Promise((resolve) => {
    const out = { metrics: [], unavailable: [], failures: [], excluded: input.excluded };
    if (input.partial) { resolve(out); return; }
    const tasks = [];
    const defs = allDefs().filter((d) => input.cls === REVEAL.FINAL_WEEK || d.reveal === REVEAL.PUBLIC_GAME);
    const all = scopesOf(input);
    const latest = latestScope(all);
    for (const sc of all) for (const def of defs) { if (def.once && sc !== latest) continue; tasks.push({ sc, def }); }
    const done = new Set();
    let i = 0;
    let cur = null;          // the task being worked: { def, instances: [params], j }
    const push = (r) => { if (isAvailable(r)) out.metrics.push(r); else if (r.reason === 'threw') out.failures.push({ id: r.id, reason: 'threw' }); else out.unavailable.push(r); };
    /** open the next task that has instances; its instances are listed ONCE (cheap) and run ONE AT A TIME so the budget is checked between metric INSTANCES, not between tasks (reviewer condition, 2026-10-19) */
    const open = () => {
      while (i < tasks.length) {
        const { sc, def } = tasks[i++];
        const slice = sliceOf(input, { competitionId: sc.competitionId, season: sc.season });
        if (!slice) continue;
        let instances = [];
        if (def.crossScope) {
          if (def.crossScope === 'sport' && !done.has(def.id + '|' + sc.season)) { done.add(def.id + '|' + sc.season); instances = slice.memberIds.map((memberId) => ({ memberId, season: sc.season })); }
        } else {
          let list = [];
          try { list = paramsFor(def, slice); } catch { out.failures.push({ id: def.id, reason: 'threw' }); }
          instances = list.map((p) => ({ ...p, competitionId: sc.competitionId, season: sc.season, ...(weekNumber !== null ? { weekNumber } : {}) }));
        }
        if (instances.length) return { def, instances, j: 0 };
      }
      return null;
    };
    const step = () => {
      if (busy()) { schedule(step); return; }
      const t0 = clock();
      for (;;) {
        if (!cur) cur = open();
        if (!cur) break;
        push(runMetric(input, cur.def.id, cur.instances[cur.j++]));          // ONE metric instance, then the clock is read
        if (cur.j >= cur.instances.length) cur = null;
        if (clock() - t0 >= budgetMs) break;                                  // at least one instance per step, so a zero budget still finishes
      }
      if (cur || i < tasks.length) schedule(step); else resolve(out);
    };
    schedule(step);
  });
}

/** The most games the synchronous candidates() accepts without `offMainPath: true` (about 150 ms of catalogue on the reference machine). */
export const CANDIDATES_SYNC_MAX_GAMES = 300;

const gameLabelOf = (slice) => (id) => { const g = slice.gameById.get(id); return g ? g.away + ' at ' + g.home : 'that game'; };

/**
 * DI-948 / DI-999: the insight candidates for ONE league input. `ring` is the session-only repetition ring (never persisted); `slate` the team keys
 * on the current slate (team names only: no pick and no line crosses in it). Zero candidates is a correct answer.
 */
export function candidates(input, { viewerMemberId = null, now, ring = [], slate = [], weekNumber = null, slateGames = [], offMainPath = false, ledger = [] } = {}) {
  assertEligible(input);
  if (input.partial || !Number.isFinite(now)) return [];
  // PERFORMANCE BUDGET (DI-954, reviewer condition 2026-10-19): the SYNCHRONOUS catalogue costs about 370 ms at the 800-game cap (500-830 ms measured on a loaded machine) against the 150 ms
  // budget, and the cost is the reused stats.js headToHeadRecord. Batch 1 ships no caller, so this is a LOUD GUARD, not a hidden jank: above CANDIDATES_SYNC_MAX_GAMES games the synchronous
  // form THROWS unless the caller states it is off the main path (the server function, a worker: `offMainPath: true`). A surface calls `candidatesSliced` (below), which yields between slices.
  if (!offMainPath && input.games.length > CANDIDATES_SYNC_MAX_GAMES) throw new Error('analytics: candidates() over ' + input.games.length + ' games (more than ' + CANDIDATES_SYNC_MAX_GAMES + ') must run off the main path: pass offMainPath: true from a server function or worker, or call candidatesSliced');
  return candidatesFrom(input, computeCatalogue(input, { weekNumber }), { viewerMemberId, now, ring, slate, slateGames, ledger });
}

/** The same answer as candidates(), the catalogue computed in budgeted slices through an injected schedule/clock (see computeCatalogueSliced): the form a surface uses. */
export async function candidatesSliced(input, { viewerMemberId = null, now, ring = [], slate = [], weekNumber = null, slateGames = [], ledger = [], schedule, clock, busy = () => false, budgetMs = 8 } = {}) {
  assertEligible(input);
  if (input.partial || !Number.isFinite(now)) return [];
  const cat = await computeCatalogueSliced(input, { schedule, clock, busy, budgetMs, weekNumber });
  return candidatesFrom(input, cat, { viewerMemberId, now, ring, slate, slateGames, ledger });
}

function candidatesFrom(input, cat, { viewerMemberId, now, ring, slate, slateGames, ledger }) {
  const list = [];
  const slices = new Map();
  const sliceFor = (m) => { const k = m.scope.competitionId + '|' + m.scope.season; if (!slices.has(k)) slices.set(k, sliceOf(input, { competitionId: m.scope.competitionId, season: m.scope.season })); return slices.get(k); };
  for (const m of cat.metrics) {
    const slice = sliceFor(m);
    if (!slice) continue;
    const c = candidateFor(m, { viewerMemberId, now, ring, slate, ledger, leagueName: input.leagueName, nameOf: (id) => nameOf(input, id), gameLabel: gameLabelOf(slice), slice });
    if (c && c.ledgerOk) list.push(c);       // a fact the device already showed (and that has not changed materially) never leaves the engine; insightFromId still opens it, flagged
  }
  // slate-driven callbacks: the viewer's history with a team on the slate, and a rematch (team names only)
  for (const sc of scopesOf(input)) {
    const slice = sliceOf(input, { competitionId: sc.competitionId, season: sc.season });
    if (!slice) continue;
    const ctx = { viewerMemberId, now, ring, slate, ledger, leagueName: input.leagueName, nameOf: (id) => nameOf(input, id), gameLabel: gameLabelOf(slice), slice };
    for (const sg of slateGames) {
      const m = runMetric(input, 'cb.rematch', { slateGame: sg, competitionId: sc.competitionId, season: sc.season });
      if (isAvailable(m)) { const c = candidateFor(m, ctx); if (c && c.ledgerOk) list.push(c); }
    }
    if (viewerMemberId) for (const teamKey of slate) {
      const m = runMetric(input, 'cb.team_history', { memberId: viewerMemberId, teamKey, competitionId: sc.competitionId });
      if (isAvailable(m)) { const c = candidateFor(m, { ...ctx, slice }); if (c && c.ledgerOk) list.push(c); }
    }
  }
  return selectCandidates(list);
}

/** DI-985 / RPF-D3: the labels a member holds. A member who hid their labels shows them to nobody but themselves (and marked hidden). */
export function labelsFor(input, memberId, { viewerMemberId = null } = {}) {
  assertEligible(input);
  const out = [];
  const member = input.members.find((m) => m.id === memberId);
  if (!member) return out;
  if (!member.showLabels && viewerMemberId !== memberId) return out;
  for (const sc of scopesOf(input)) {
    for (const def of LABEL_DEFS) {
      const m = runMetric(input, def.id, { competitionId: sc.competitionId, season: sc.season });
      if (isAvailable(m) && m.value.holderId === memberId) out.push(m);
    }
  }
  return out;
}

/**
 * DI-971 (Ask SCRIBE, the server's recompute; batch 3): the candidate one insight id names, labelled exactly as `candidates()` labels it (member names from the input,
 * a game as "Away at Home"), and its sealed packet. The input is the caller's own FINAL-WEEK input (`viewerMemberId` = the caller, so a private metric resolves only
 * for its own subject and a hidden label only for its holder). One metric runs, never the catalogue. Null = not available (never an error with detail).
 */
export function askPacketFor(input, id, { viewerMemberId = null, now = 0 } = {}) {
  assertEligible(input);
  if (input.cls !== REVEAL.FINAL_WEEK) return null;
  const nm = (mid) => nameOf(input, mid);
  const gl = (gid) => { const g = input.games.find((x) => x.gameId === gid); return g ? g.away + ' at ' + g.home : 'that game'; };
  let c = null;
  try { c = insightFromId(input, id, { viewerMemberId, now, ring: [], slate: [], ledger: [], leagueName: input.leagueName, nameOf: nm, gameLabel: gl }); } catch { c = null; }
  if (!c) return null;
  let sealed = null;
  try { sealed = packetFor(input, c, { nameOf: nm }); } catch { sealed = null; }
  return sealed ? { candidate: c, sealed } : null;
}

/**
 * DI-1109 (M-93): the packet for ONE Game Day fact, recomputed from a PUBLIC-GAME input (the league's own games and the revealed picks of a public week; nothing else). The same
 * pure call on the device (the sheet's hash) and on the server (the model's facts): `gameDayInsights` then the fact the id names. Null when the fact is not in this computation.
 * The packet holds the fact's sentence, its own fields (never its internal score), the game behind it and when its score was last read; no pick of an unrevealed week can be in
 * the input at all (input.js).
 */
export const GD_PACKET_DROP = Object.freeze(['points', 'k']);
export function gdPacketFor(input, factId, { viewerMemberId = null, now = 0 } = {}) {
  assertEligible(input);
  if (input.cls !== REVEAL.PUBLIC_GAME || typeof factId !== 'string' || !factId) return null;
  let res;
  try { res = gameDayInsights(input, { viewerMemberId, now, slateGames: [] }); } catch { return null; }
  let f = null;
  for (const e of res.byGame.values()) { f = [...e.visible, ...e.more].find((x) => x.id === factId) || null; if (f) break; }
  if (!f) return null;
  const gameOfId = (id) => input.games.find((g) => g.gameId === id) || (input.projection ? input.projection.games.find((g) => g.gameId === id) : null) || null;   // a LIVE game is in the projection
  const game = gameOfId(f.gameId);
  const ctx = {
    viewerId: viewerMemberId,
    nameOf: (id) => { const m = input.members.find((x) => x.id === id); return m ? m.name : 'A member'; },
    gameOf: (id) => { const g = gameOfId(id); return g ? { away: g.away, home: g.home } : null; },
    weekNumberOf: (wid) => { const w = input.weeks.find((x) => x.weekId === wid) || (input.projection ? input.projection.weeks.find((x) => x.weekId === wid) : null); return w ? w.weekNumber : null; },
  };
  const line = gdFactLine(f, ctx);
  if (!line) return null;
  const fact = Object.fromEntries(Object.entries(f).filter(([k]) => !GD_PACKET_DROP.includes(k)));
  const week = input.weeks.find((w) => w.weekId === f.weekId) || (input.projection ? input.projection.weeks.find((w) => w.weekId === f.weekId) : null) || null;
  const support = game ? [{ gameId: game.gameId, matchup: game.away + ' at ' + game.home, weekLabel: week ? (week.label || ('Week ' + week.weekNumber)) : '', result: game.status }] : [];
  const sealed = sealPacket({
    insightId: 'gdf1:' + f.gameId + '::' + f.id, v: 1, headline: line, line: '', metrics: [fact], support,
    scope: { leagueId: input.leagueId, leagueName: input.leagueName, sport: game ? game.sport || '' : '', season: week ? String(week.season || '') : '' },
    sample: { asOfMs: game && Number.isFinite(game.lastUpdatedMs) ? game.lastUpdatedMs : null, status: game ? game.status : '' }, memory: [],
  });
  return { fact: f, game, sealed };
}

/**
 * DI-947: the PACKET, the only thing a model sees about an insight. Built from the candidate's own metric(s) and the supporting rows' games
 * (matchup, week label, the pick of the member the row names and its result: all of a revealed week). Closed key set, <= 6 KB, forbidden keys refused.
 */
export function packetFor(input, candidate, { nameOf: nm = null } = {}) {
  assertEligible(input);
  const m = candidate.metrics[0];
  const slice = sliceOf(input, { competitionId: m.scope.competitionId, season: m.scope.season });
  const weeks = new Map(slice.weeks.map((w) => [w.weekId, w.label || ('Week ' + w.weekNumber)]));
  const support = (candidate.support || []).map((r) => {
    const g = slice.gameById.get(r.gameId);
    const row = { gameId: r.gameId, matchup: g ? g.away + ' at ' + g.home : '', weekLabel: weeks.get(r.weekId) || '' };
    if (r.memberId) {
      const p = (slice.picksByGame.get(r.gameId) || []).find((x) => x.memberId === r.memberId);
      if (p) { row.memberPick = p.team; row.result = p.result; }
    }
    return row;
  });
  return sealPacket({
    insightId: candidate.id, v: candidate.v, headline: candidate.headline, line: candidate.line,
    metrics: candidate.metrics, support,
    scope: { leagueId: slice.leagueId, leagueName: input.leagueName, sport: slice.sport, season: slice.season },
    sample: { n: m.n, sport: slice.sport, season: slice.season, throughWeek: slice.throughWeek },
    memory: [],
  });
}
