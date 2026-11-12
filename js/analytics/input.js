/**
 * CFB Pickems - js/analytics/input.js (D2 lane 4; DI-942, 943, 945; 2026-10-19)
 * ==============================================================================
 * THE ELIGIBLE INPUT: ONE constructor, ONE reveal gate. No unrevealed pick can enter a metric.
 *
 * `buildInput(source, opts)` is the only way to obtain an input. It returns a frozen object registered in a module-private
 * WeakSet; every metric opens with `assertEligible(input)` and THROWS on a raw array or a hand-built look-alike (the brand
 * is membership in the private set, not a property a caller can forge).
 *
 * TWO REVEAL CLASSES, AND ONLY TWO (DI-942):
 *   final-week   a week the SERVER confirms FINAL. Used by every aggregate: Home cards, Profile, labels, strategies, callbacks, Ask.
 *   public-game  a week the server confirms LIVE or FINAL, restricted to games with status final (single-game facts, so they can
 *                appear the minute the game ends); Game Day additionally reads the live and scheduled games of public weeks
 *                for the projection, through `input.projection`, which exists on this class ONLY.
 * There is NO class for "own", "commissioner" or "unrevealed". The Picks page gets no analytics. `canViewOtherPicks` is never
 * called. Hidden picks therefore never enter a metric before the reveal point.
 *
 * SERVER-CONFIRMED STATUS ONLY (RG-253 / RG-255): the caller passes `confirmedStatusFor(week)`; absent or null means the week
 * is not public, so the class is empty (FAIL CLOSED). `arePicksPublic` lives in storage.js and is NOT imported (the engine
 * stays storage-free); analyticstest asserts the rule below agrees with it on a table of statuses.
 *
 * ENTRANTS (security A3): picks of non-entrants are dropped BEFORE any metric. See entrants.js.
 *
 * NEVER IN THE INPUT: tiebreaker guesses, extra-point guesses, chat bodies, notification state. The constructor has no field
 * for them. DROPPED ALWAYS: demo weeks, `showInHistory === false` weeks, draft weeks.
 *
 * ONE LEAGUE PER INPUT: a row that names a different league, or a source that names several, throws (Gate H).
 */
import { weekLockState } from '../week-lock.js';
import { getEffectiveGroupId } from '../data-model.js';
import { almaSnapshotForWeek } from '../tie-context.js';
import { ENGINE_VERSION, REVEAL, flagOverride } from './registry.js';
import { entrantsOf } from './entrants.js';
import { gameRecord, pickRecord } from './records.js';
import { RIVALRY_LIST, rivalryApproved } from './rivalries.js';
import { weekRows } from './tally.js';
import { pickEventsOn } from './pick-events-flag.js';

const ELIGIBLE = new WeakSet();
const VIEWS = new WeakMap();

/** Graders registered for competition formats (DI-943). 'ats' ships; lane C registers any other. A format with no grader is skipped and reported. */
const GRADERS = new Set(['ats']);
export function registerGrader(format) { if (typeof format === 'string' && format) GRADERS.add(format); }
export function hasGrader(format) { return GRADERS.has(format); }

/** the platform setting analytics_pick_events_enabled, handed in by the caller (pick-events-flag.js); withFlags({ PICK_EVENTS_ENABLED: true }) is a TEST's override only */
const PICK_EVENTS_ON = (switches) => pickEventsOn(switches) || flagOverride('PICK_EVENTS_ENABLED');
const read = (src, key) => { const v = src ? src[key] : undefined; return typeof v === 'function' ? v.call(src) : v; };
const arr = (v) => (Array.isArray(v) ? v : []);
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const strs = (v, max = 80) => arr(v).filter((x) => typeof x === 'string' && x.length > 0 && x.length <= max);
const SPORTS = new Set(['cfb', 'nfl', 'nhl']);

/**
 * PUBLIC TEAM FACTS (batch 2, DI-1079): the rows of the global `team_facts` table as `team_facts_list` returns them (camelCase or snake_case), cut to a CLOSED shape. They are public sports data with
 * NO pick and NO member in them, so no reveal gate applies; they enter the input only so the team metrics have one place to read. A malformed row is dropped, never repaired.
 * results[i] = { d, e, w, ha, n, ok, on, pf, pa, r, ot, or, mr } as the collector stores them (team-facts-rules.mjs); leaders = { e, d, ok, on, items[] } | null; coach = { name } | null.
 */
export function cleanTeamFacts(rows) {
  const out = [];
  for (const r of arr(rows)) {
    if (!isObj(r) || !SPORTS.has(r.sport)) continue;
    const teamKey = String(r.teamKey ?? r.team_key ?? ''), season = String(r.season ?? '');
    const results = arr(r.results).filter((g) => isObj(g) && /^\d{4}-\d{2}-\d{2}$/.test(String(g.d)) && Number.isFinite(g.pf) && Number.isFinite(g.pa) && (g.r === 'W' || g.r === 'L' || g.r === 'T' || g.r === 'OTL') && (g.ha === 'home' || g.ha === 'away'))
      .map((g) => ({ d: String(g.d), e: String(g.e ?? ''), w: Number.isFinite(g.w) ? g.w : null, ha: g.ha, n: g.n === true, ok: String(g.ok ?? ''), on: String(g.on ?? '').slice(0, 80), pf: g.pf, pa: g.pa, r: g.r, ot: g.ot === true,
        or: Number.isFinite(g.or) && g.or >= 0 && g.or <= 25 ? g.or : null, mr: Number.isFinite(g.mr) && g.mr >= 0 && g.mr <= 25 ? g.mr : null }));   // 0 = ESPN says unranked, 1..25 ranked, null = not given
    const lead = isObj(r.leaders) && arr(r.leaders.items).length ? { e: String(r.leaders.e ?? ''), d: String(r.leaders.d ?? ''), ok: String(r.leaders.ok ?? ''), on: String(r.leaders.on ?? '').slice(0, 80),
      items: arr(r.leaders.items).filter((i) => isObj(i) && typeof i.who === 'string' && typeof i.line === 'string' && typeof i.cat === 'string').map((i) => ({ cat: i.cat.slice(0, 20), who: i.who.slice(0, 60), line: i.line.slice(0, 60) })).slice(0, 4) } : null;
    const coach = isObj(r.coach) && typeof r.coach.name === 'string' && r.coach.name ? { name: r.coach.name.slice(0, 80) } : null;     // NAME only: ESPN gives no start date, so there is no `since`
    const asOf = Date.parse(r.asOf ?? r.as_of ?? '');
    if (!/^[a-z0-9 ]{2,80}$/.test(teamKey) || !/^\d{4}$/.test(season) || !results.length) continue;
    out.push({ sport: r.sport, season, teamKey, aliases: strs(r.aliases).slice(0, 4), teamName: String(r.teamName ?? r.team_name ?? teamKey).slice(0, 80), results, leaders: lead, coach, asOfMs: Number.isFinite(asOf) ? asOf : 0 });
  }
  out.sort((a, b) => (a.sport < b.sport ? -1 : a.sport > b.sport ? 1 : a.season < b.season ? -1 : a.season > b.season ? 1 : a.teamKey < b.teamKey ? -1 : a.teamKey > b.teamKey ? 1 : 0));
  return out;
}

/** The followed-team set (followed.js's answer, computed on the device): { bySport: { [sport]: { teamKeys, alma, home, mostPicked } } } cut to strings. Anything else is "follows nothing". */
function cleanFollowed(f) {
  const bySport = {};
  if (isObj(f) && isObj(f.bySport)) for (const [sport, v] of Object.entries(f.bySport)) {
    if (!SPORTS.has(sport) || !isObj(v)) continue;
    const teamKeys = strs(v.teamKeys).slice(0, 6);
    if (teamKeys.length) bySport[sport] = { teamKeys, alma: strs(v.alma), home: strs(v.home), mostPicked: strs(v.mostPicked), other: strs(v.other) };
  }
  return { bySport };
}

/** The rule "a week is public" (DI-942): confirmed status live or final. Fail closed on a missing status. */
export function isPublicStatus(confirmed) { return confirmed === 'live' || confirmed === 'final'; }

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); }
  return o;
}

function checkSingleLeague(source, leagueId, ...lists) {
  if (Array.isArray(source.leagues) && source.leagues.length > 1) throw new Error('analytics: one league per input (source names several)');
  for (const list of lists) for (const r of list) if (r && r.leagueId !== undefined && r.leagueId !== null && String(r.leagueId) !== leagueId) throw new Error('analytics: one league per input (a row names another league)');
}

/**
 * @param {object} source  plain data or lane B's accessor object: { leagueId, leagueName, zone | settings(), competitions, weeks, games, picks,
 *                         players, competitionMembers, weeklyResults?, archive?, memories?, viewerMemberId? } (each a value or a function)
 * @param {object} opts    { revealClass, confirmedStatusFor(week), entrantsFor?(week), now (ms) }
 */
export function buildInput(source, opts = {}) {
  if (!source || typeof source !== 'object') throw new Error('analytics: buildInput needs a source');
  const cls = opts.revealClass;
  if (cls !== REVEAL.FINAL_WEEK && cls !== REVEAL.PUBLIC_GAME) throw new Error('analytics: unknown reveal class ' + String(cls));
  const confirmedStatusFor = typeof opts.confirmedStatusFor === 'function' ? opts.confirmedStatusFor : () => null;
  const leagueId = String(read(source, 'leagueId') ?? '');
  if (!leagueId) throw new Error('analytics: a league id is required');
  const leagueName = String(read(source, 'leagueName') ?? '');
  const settings = read(source, 'settings') || {};
  const zone = String(read(source, 'zone') || settings.timezone || 'UTC');
  const nowMs = Number.isFinite(opts.now) ? opts.now : 0;
  // the rivalry list is platform DATA; only a TEST passes another (production never does). `approvedBy === null` = the family is dark (DI-960).
  const rivalryList = opts.rivalryList || RIVALRY_LIST;
  const switches = opts.switches && typeof opts.switches === 'object' ? opts.switches : {};
  const viewerMemberId = typeof opts.viewerMemberId === 'string' && opts.viewerMemberId ? opts.viewerMemberId : (typeof read(source, 'viewerMemberId') === 'string' ? read(source, 'viewerMemberId') : null);

  const rawComps = arr(read(source, 'competitions'));
  const rawWeeks = arr(read(source, 'weeks')).filter(Boolean);
  const rawGames = arr(read(source, 'games')).filter(Boolean);
  const rawPicks = arr(read(source, 'picks')).filter(Boolean);
  const rawPlayers = arr(read(source, 'players')).filter(Boolean);
  const compMembers = arr(read(source, 'competitionMembers'));
  const rawResults = read(source, 'weeklyResults');
  checkSingleLeague(source, leagueId, rawComps, rawWeeks, rawGames, rawPicks, rawPlayers);

  const defaultComp = rawComps.find((c) => c && c.isDefault && !c.archivedAt) || null;
  const compById = new Map(rawComps.filter(Boolean).map((c) => [c.id, c]));
  const gamesByWeek = new Map();
  for (const g of rawGames) { const k = String(g.weekId); if (!gamesByWeek.has(k)) gamesByWeek.set(k, []); gamesByWeek.get(k).push(g); }

  const excludedComps = [];
  const noteExcluded = (competitionId, reason) => { if (!excludedComps.some((e) => e.competitionId === competitionId && e.reason === reason)) excludedComps.push({ competitionId, reason }); };

  // 1. the weeks that may enter, by the reveal class (server-confirmed status only)
  const weeks = [];
  const weekById = new Map();
  const entrantsByWeek = new Map();
  const excludedBy = new Map();      // competitionId -> { notEntrant, other }
  const bump = (cid, k) => { const k0 = String(cid); if (!excludedBy.has(k0)) excludedBy.set(k0, { notEntrant: 0, other: 0 }); excludedBy.get(k0)[k]++; };
  const publicRaw = [];              // weeks passing the status gate (for projection / group sizing)
  for (const w of rawWeeks) {
    const confirmed = confirmedStatusFor(w);
    if (!isPublicStatus(confirmed)) continue;
    if (cls === REVEAL.FINAL_WEEK && confirmed !== 'final') continue;
    if (w.dataSourceMode === 'demo' || w.showInHistory === false) continue;
    const compId = w.competitionId ?? (defaultComp ? defaultComp.id : null);
    const comp = compId === null ? null : compById.get(compId);
    if (compId !== null && !comp) { noteExcluded(compId, 'no_grader'); continue; }    // a dangling competition reference: never graded as something else
    const format = comp && comp.format ? comp.format : 'ats';
    if (!GRADERS.has(format)) { noteExcluded(compId, 'no_grader'); continue; }
    publicRaw.push({ w, confirmed, compId, comp, format });
  }

  // group sizes from week STRUCTURE (every week record of the league, no rows): a split week group is one competitive week
  const groupSize = new Map();
  for (const w of rawWeeks) { const gid = getEffectiveGroupId(w); groupSize.set(gid, (groupSize.get(gid) || 0) + 1); }

  const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const memberRows = rawPlayers.map((p) => ({
    id: String(p.playerId),
    name: String(p.displayName ?? p.playerId),
    active: p.active !== false,
    almaMater: typeof p.almaMater === 'string' ? p.almaMater.trim() : '',
    showLabels: !(p.preferences && p.preferences.showLabels === false),
  })).sort(byId);                     // a canonical order: the same data in any input order gives the same output
  const liveRoster = [];            // the live roster of alma schools (tie-context's last-resort tier)
  for (const p of rawPlayers) if (p.active !== false && typeof p.almaMater === 'string' && p.almaMater.trim()) liveRoster.push(p.almaMater.trim());

  const almaByWeek = new Map();
  const picksByWeekGame = new Map();
  const gamesRec = [];
  const picksRec = [];
  const projGames = [];
  const projPicks = [];
  const pendingBy = new Map();       // `${weekId}|${memberId}` -> the entrant's picks on games that are NOT final (so a recomputed row says `pending` as calculateWeeklyResults does)
  const finalGameWeeks = new Set();   // weeks that hold at least one FINAL game (rankWeeklyResults flags a winner and loser only then)

  for (const { w, confirmed, compId, comp, format } of publicRaw) {
    const sport = comp && comp.sport ? comp.sport : 'cfb';
    const wGames = gamesByWeek.get(String(w.weekId)) || [];
    let cutoffMs = null;
    try { const st = weekLockState({ week: w, games: wGames, now: nowMs, confirmedStatus: confirmed }); cutoffMs = Number.isFinite(st.lockAtMs) ? st.lockAtMs : null; } catch { cutoffMs = null; }
    if (cutoffMs === null) { const t = Date.parse(w.lockedAt); if (Number.isFinite(t)) cutoffMs = t; }
    const entrants = typeof opts.entrantsFor === 'function'
      ? arr(opts.entrantsFor(w)).map(String)
      : entrantsOf({ week: { ...w, competitionId: compId }, competitions: rawComps, members: rawPlayers, competitionMembers: compMembers, cutoffMs, includeArchived: true });
    const entrantSet = new Set(entrants);
    entrantsByWeek.set(w.weekId, entrants);
    const wr = {
      weekId: String(w.weekId),
      groupId: getEffectiveGroupId(w),
      groupSize: groupSize.get(getEffectiveGroupId(w)) || 1,
      competitionId: compId,
      sport, format,
      archived: !!(comp && comp.archivedAt),
      season: String(w.season ?? ''),
      weekNumber: Number(w.weekNumber) || 0,
      label: String(w.label ?? ''),
      roundLabel: typeof w.roundLabel === 'string' ? w.roundLabel.trim() : '',
      postseason: typeof w.roundLabel === 'string' && w.roundLabel.trim() !== '',
      status: confirmed,
      isFinal: confirmed === 'final',
      lockMs: cutoffMs,
      blurb: typeof w.blurb === 'string' ? w.blurb : '',
    };
    weeks.push(wr);
    weekById.set(wr.weekId, wr);
    const snap = almaSnapshotForWeek(w, { players: rawPlayers, liveRoster });
    almaByWeek.set(wr.weekId, snap);

    const gameRecById = new Map();
    for (const g of wGames) {
      const gr = gameRecord(g, { week: wr, sport, zone, rivalryList });
      if (!gr) { bump(compId, 'other'); continue; }
      gameRecById.set(gr.gameId, { gr, raw: g });
      if (g.status === 'final') { gamesRec.push(gr); finalGameWeeks.add(wr.weekId); }
      if (cls === REVEAL.PUBLIC_GAME) projGames.push(gr);
    }
    for (const p of rawPicks) {
      if (String(p.weekId) !== wr.weekId) continue;
      if (!entrantSet.has(String(p.playerId))) { bump(compId, 'notEntrant'); continue; }
      const hit = gameRecById.get(String(p.gameId));
      if (!hit) { bump(compId, 'other'); continue; }
      const pr = pickRecord(p, hit.raw, hit.gr, { week: wr, leagueId, sport, season: wr.season });
      if (!pr) { bump(compId, 'other'); continue; }
      if (hit.raw.status !== 'final') { const k = wr.weekId + '|' + pr.memberId; pendingBy.set(k, (pendingBy.get(k) || 0) + 1); }
      if (hit.raw.status === 'final') {
        if (pr.result === null) { bump(compId, 'other'); const k = wr.weekId + '|' + pr.memberId; pendingBy.set(k, (pendingBy.get(k) || 0) + 1); continue; }      // final but ungradable (no usable line or score): pending, never a result
        picksRec.push(pr);
        if (!picksByWeekGame.has(pr.gameId)) picksByWeekGame.set(pr.gameId, []);
        picksByWeekGame.get(pr.gameId).push(pr);
      }
      if (cls === REVEAL.PUBLIC_GAME) projPicks.push(pr);
    }
  }

  // 2. stored weekly rows for the revealed weeks and their entrants (tiebreaker GUESSES are never carried; the delta passes through to the standings only)
  const stored = new Map();
  for (const r of arr(rawResults)) {
    if (!r || !weekById.has(String(r.weekId))) continue;
    if (!(entrantsByWeek.get(r.weekId) || []).includes(String(r.playerId))) continue;
    stored.set(r.weekId + '|' + r.playerId, {
      resultId: String(r.resultId ?? ('wr_' + r.weekId + '_' + r.playerId)),
      weekId: String(r.weekId), playerId: String(r.playerId), displayName: String(r.displayName ?? r.playerId),
      correctPicks: Number(r.correctPicks) || 0, incorrectPicks: Number(r.incorrectPicks) || 0,
      correctCount: Number(r.correctCount ?? r.correctPicks) || 0, incorrectCount: Number(r.incorrectCount ?? r.incorrectPicks) || 0,
      noDecisions: Number(r.noDecisions) || 0, pending: Number(r.pending) || 0,
      tiebreakerGuess: null,
      tiebreakerDelta: r.tiebreakerDelta === undefined ? null : r.tiebreakerDelta,
      rank: Number(r.rank) || 0, isWinner: r.isWinner === true, isLoser: r.isLoser === true, wonByTiebreaker: r.wonByTiebreaker === true,
    });
  }
  const rows = [];
  let storedWeeks = 0, recomputedWeeks = 0;
  for (const wr of weeks) {
    if (!wr.isFinal) continue;
    const have = (entrantsByWeek.get(wr.weekId) || []).filter((id) => stored.has(wr.weekId + '|' + id));
    if (have.length > 0) {
      storedWeeks++;
      for (const id of entrantsByWeek.get(wr.weekId)) { const r = stored.get(wr.weekId + '|' + id); if (r) rows.push(r); }
    } else {
      recomputedWeeks++;
      const byMember = new Map();
      for (const p of picksRec) if (p.weekId === wr.weekId) { if (!byMember.has(p.memberId)) byMember.set(p.memberId, []); byMember.get(p.memberId).push(p); }
      // anyFinal is TRUE only when the week really holds a final game (a confirmed-final week with none gets no winner or loser), and `pending` counts the picks on games that are not final
      for (const r of weekRows(wr.weekId, entrantsByWeek.get(wr.weekId) || [], byMember, { anyFinal: finalGameWeeks.has(wr.weekId) })) { r.pending = pendingBy.get(wr.weekId + '|' + r.playerId) || 0; rows.push(r); }
    }
  }
  const rowsSource = recomputedWeeks === 0 ? 'stored' : storedWeeks === 0 ? 'recomputed' : 'mixed';

  // 3. the freshness key (DI-949)
  let maxUpd = 0;
  const upd = (o) => { const t = Date.parse(o && o.updatedAt); if (Number.isFinite(t) && t > maxUpd) maxUpd = t; };
  rawWeeks.forEach(upd); rawGames.forEach(upd); rawPicks.forEach(upd); arr(rawResults).forEach(upd);
  const dataKey = [ENGINE_VERSION, leagueId, maxUpd, weeks.length + '.' + gamesRec.length + '.' + picksRec.length + '.' + rows.length].join('|');

  const comps = [];
  const seenComp = new Set();
  for (const wr of weeks) {
    if (seenComp.has(String(wr.competitionId))) continue;
    seenComp.add(String(wr.competitionId));
    const c = wr.competitionId === null ? null : compById.get(wr.competitionId);
    comps.push({ id: wr.competitionId, sport: wr.sport, format: wr.format, archived: !!(c && c.archivedAt) });
  }

  const archive = read(source, 'archive');
  const memories = arr(read(source, 'memories')).filter((m) => m && m.status === 'approved');
  const teamFacts = cleanTeamFacts(read(source, 'teamFacts'));
  const followed = cleanFollowed(opts.followed !== undefined ? opts.followed : read(source, 'followed'));

  const input = {
    v: ENGINE_VERSION,
    cls,
    leagueId, leagueName, zone,
    nowMs,
    // a peeked league the host reports PARTIAL (lane B's caps) produces no insights: a truncated pick set gives a wrong rate (DI-949)
    partial: opts.partial === true,
    competitions: comps,
    excluded: excludedComps,
    members: memberRows,
    weeks,
    games: gamesRec,
    picks: picksRec,
    standingsRows: rows,
    rowsSource,
    excludedBy: Object.fromEntries(excludedBy),
    archive: archive && typeof archive === 'object' ? archive : null,
    memories,
    teamFacts,
    followed,
    viewerMemberId,
    // pick history (DI-961, RPF-D1): THE VIEWER'S OWN rows only, and only when the switch is on. Dark in D2 until migration 0068 is applied live.
    pickEvents: pickEventsFor(source, viewerMemberId, weekById, switches),
    // the two Admin-controlled switches (no code constant): the league's serverJobs.teamFacts and the platform's analytics_pick_events_enabled, exactly true or off
    switches: { teamFamily: switches.teamFamily === true, pickEvents: switches.pickEvents === true },
    dataKey,
    rivalryOn: rivalryApproved(rivalryList),
    projection: cls === REVEAL.PUBLIC_GAME ? { weeks: weeks.filter((w) => w.status === 'live' || w.status === 'final'), games: projGames, picks: projPicks, rosters: Object.fromEntries(Array.from(entrantsByWeek.entries())) } : null,
  };
  // canonical order everywhere (DI-944: the same data in any order is byte-identical): weeks, games, picks and rows are sorted by stable keys
  const cmpS = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  input.weeks.sort((a, b) => cmpS(a.season, b.season) || (a.weekNumber - b.weekNumber) || cmpS(a.weekId, b.weekId));
  input.games.sort((a, b) => cmpS(a.weekId, b.weekId) || ((a.kickoffMs ?? 0) - (b.kickoffMs ?? 0)) || cmpS(a.gameId, b.gameId));
  input.picks.sort((a, b) => cmpS(a.weekId, b.weekId) || cmpS(a.gameId, b.gameId) || cmpS(a.memberId, b.memberId));
  input.standingsRows.sort((a, b) => cmpS(a.weekId, b.weekId) || cmpS(a.playerId, b.playerId));
  if (input.projection) {
    input.projection.games.sort((a, b) => cmpS(a.weekId, b.weekId) || ((a.kickoffMs ?? 0) - (b.kickoffMs ?? 0)) || cmpS(a.gameId, b.gameId));
    input.projection.picks.sort((a, b) => cmpS(a.weekId, b.weekId) || cmpS(a.gameId, b.gameId) || cmpS(a.memberId, b.memberId));
  }
  deepFreeze(input);
  ELIGIBLE.add(input);
  // the PRIVATE view: week-level facts that wrapped stats.js producers need (kept off the public object; never serialised)
  const players = memberRows.map((m) => ({ playerId: m.id, displayName: m.name, almaMater: m.almaMater }));
  const rawGamesIn = rawGames.filter((g) => weekById.has(String(g.weekId)));
  const rawPicksIn = rawPicks.filter((p) => weekById.has(String(p.weekId)) && (entrantsByWeek.get(p.weekId) || []).includes(String(p.playerId)));
  const rawGameById = new Map(rawGamesIn.map((g) => [String(g.gameId), g]));
  const rawPicksByGame = new Map();
  for (const p of rawPicksIn) { const k = String(p.gameId); if (!rawPicksByGame.has(k)) rawPicksByGame.set(k, []); rawPicksByGame.get(k).push(p); }
  VIEWS.set(input, {
    entrantsByWeek, almaByWeek, players, rawGameById, rawPicksByGame,
    rawGames: rawGamesIn,
    rawWeeks: publicRaw.map((x) => x.w),
    allRawWeeks: rawWeeks,
    rawPicks: rawPicksIn,
  });
  return input;
}


/** The pick_events rows the engine may hold: the viewer's own, for revealed weeks, and ONLY when the platform setting is on (switches.pickEvents, pick-events-flag.js; or a test override). */
function pickEventsFor(source, viewerMemberId, weekById, switches) {
  if (!PICK_EVENTS_ON(switches) || !viewerMemberId) return [];
  return arr(read(source, 'pickEvents'))
    .filter((e) => e && String(e.memberId) === viewerMemberId && weekById.has(String(e.weekId)))
    .map((e) => ({ weekId: String(e.weekId), gameId: String(e.gameId), memberId: String(e.memberId), fromTeam: e.fromTeam ?? null, toTeam: String(e.toTeam ?? ''), actorMemberId: String(e.actorMemberId ?? ''), source: e.source === 'admin' ? 'admin' : 'self', at: String(e.at ?? '') }));
}

/** The brand check every metric opens with. Throws on anything buildInput did not return (a raw array, a look-alike, a clone). */
export function assertEligible(input, { cls = null } = {}) {
  if (!input || typeof input !== 'object' || !ELIGIBLE.has(input)) throw new Error('analytics: not an eligible input (build one with buildInput)');
  if (cls !== null && input.cls !== cls) throw new Error('analytics: this metric needs the ' + cls + ' reveal class, got ' + input.cls);
  return input;
}

/** Private week-level view for wrapped producers; same brand check. Not exported through index.js. */
export function viewOf(input) {
  assertEligible(input);
  return VIEWS.get(input);
}

/** The week records of a competition and season, in (season, weekNumber, weekId) order, restricted to FINAL for aggregates. */
export function sortWeekRecords(list) {
  return [...list].sort((a, b) => String(a.season).localeCompare(String(b.season)) || (a.weekNumber - b.weekNumber) || (a.weekId < b.weekId ? -1 : a.weekId > b.weekId ? 1 : 0));
}
