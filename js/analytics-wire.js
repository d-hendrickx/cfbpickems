/**
 * CFB Pickems - js/analytics-wire.js (D2 lane 4 batch 2; DI-949, DI-964, DI-999, DI-1073; "the app-side wiring"; 2026-10-21)
 * ===========================================================================================================================
 * Builds the ELIGIBLE input from the live app state, runs the engine AFTER FIRST PAINT in budgeted slices, and hands the results to the surfaces: Home's candidates (fromInsight objects and the feed
 * cards they draw as), the insight detail, Your numbers and the Ask SCRIBE sheet's context. EVERY app effect arrives as a dependency (the section-drag.js discipline), so this file imports the pure engine
 * and nothing else: no storage seam, no DOM, no network, no clock of its own. app.js builds the real dependencies; the tests build fakes.
 *
 *   createAnalyticsWire(deps)  ->  { refresh, candidates, homeCandidates, feedCards, candidateById, detail, yourNumbers, whatIf, askContext, noteShown, reset, gameDay, refreshGameDay }
 *
 *   deps.getSource()               -> the ACTIVE league's plain-data source { leagueId, leagueName, zone, competitions, weeks, games, picks, players, competitionMembers, weeklyResults } or null
 *   deps.confirmedStatusFor(week)  -> the SERVER-CONFIRMED status of a week ('final' | 'live' | ...), null when unknown (fail closed)
 *   deps.getViewerId()             -> the signed-in member's player id, or null
 *   deps.getProfile()              -> { almaBySport: { cfb: [name] }, homeTeamsBySport: { [sport]: [names] }, otherTeamsBySport? } (lane A's profile signals; the device's own, never sent; M-93 DI-1112 adds the other teams)
 *   deps.getSwitches()             -> { teamFamily } : the league's serverJobs.teamFacts switch (Admin, no deploy). Off: no team-facts request and every team metric is dark
 *   deps.fetchPickEvents({ leagueId }) -> Promise<{ on, rows }> : the platform setting analytics_pick_events_enabled and, only when it is on, the viewer's own pick_events rows (RLS)
 *   deps.fetchTeamFacts(sports)    -> Promise<{ rows, stale, failed }>   (team-facts-transport.js, cached; a failure means no team card, never an error)
 *   deps.ledger                    -> { get(): string|null, set(text) }   the no-repeat ledger's storage (the caller decides where it lives)
 *   deps.schedule(fn) / deps.clock() / deps.busy()   the slicing seams (requestIdleCallback or a timeout; performance.now; "a scroll or a sheet animation is running")
 *   deps.now() / deps.isWithheld()
 * It serves the ACTIVE league only: a peeked league needs its own server-confirmed status function (F-4) and is lane 3's, not wired here.
 */
import {
  buildInput, candidatesSliced, fromInsight, insightFromId, packetFor, followedTeams, followedTeamsFromInput, ownFinalPicksOf, factOf, recordShown, ledgerFromJson, ledgerToJson, REVEAL, sliceOf, scopesOf,
  gameDayInsights, gdFactLine, STALE_MS, GD_LIMITS, insightShareIdOk, packetSha, gdPacketFor,
} from './analytics/index.js';
import { shareLine } from './chat-share.js';
import { feedCardFromInsight, insightDetailModel, homeCardFromInsight } from './insight-view.js';
import { gdFigures, gdDefinition, GDI_COPY } from './game-insights-view.js';
import { yourNumbersParts } from './analytics/your-numbers.js';
import { whatIfParts } from './analytics/what-if.js';
import { chipsFor, instantAnswer, ASK_COPY } from './ask-insight.js';
import { sampleSentence } from './analytics/copy.js';
import { normTeam } from './team-match.js';

const REFRESH_MIN_MS = 5 * 60 * 1000;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayText = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${MON[Number(m[2]) - 1]} ${Number(m[3])}` : ''; };
const fn = (f, fallback) => (typeof f === 'function' ? f : fallback);

/** A Game Day fact's id for the Ask sheet and the detail: `gdf1:{gameId}::{factId}`. It names a fact of the CURRENT Game Day computation; a fact that is gone is simply unavailable. */
export const GD_FACT_PREFIX = 'gdf1:';
export const isGdFactId = (id) => typeof id === 'string' && id.startsWith(GD_FACT_PREFIX) && id.length <= 400 && id.indexOf('::') > GD_FACT_PREFIX.length;

export function createAnalyticsWire(deps = {}) {
  const d = {
    getSource: fn(deps.getSource, () => null), confirmedStatusFor: fn(deps.confirmedStatusFor, () => null), getViewerId: fn(deps.getViewerId, () => null),
    getProfile: fn(deps.getProfile, () => ({ almaBySport: {}, homeTeamsBySport: {} })), fetchTeamFacts: fn(deps.fetchTeamFacts, async () => ({ rows: [], stale: false, failed: [] })),
    getSwitches: fn(deps.getSwitches, () => ({ teamFamily: false })), fetchPickEvents: fn(deps.fetchPickEvents, async () => ({ on: false, rows: [] })),
    ledger: deps.ledger && typeof deps.ledger.get === 'function' && typeof deps.ledger.set === 'function' ? deps.ledger : { get: () => null, set: () => {} },
    schedule: fn(deps.schedule, (f) => setTimeout(f, 0)), clock: fn(deps.clock, () => Date.now()), busy: fn(deps.busy, () => false),
    now: fn(deps.now, () => Date.now()), isWithheld: fn(deps.isWithheld, () => false),
    // Ask SCRIBE's open questions (batch 3): the platform setting as the app last read it (default off), and the digest the packet hash is taken with (WebCrypto)
    isAskOpen: fn(deps.isAskOpen, () => false),
    digest: fn(deps.digest, (s0) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(s0))),
  };
  const st = { input: null, source: null, candidates: [], byId: new Map(), cards: [], viewerId: null, builtAt: 0, dataKey: '', followed: { teamKeys: [], bySport: {} }, names: {}, teamRows: [], inFlight: null, queued: null, epoch: 0 };

  const readLedger = () => { try { return ledgerFromJson(d.ledger.get()); } catch { return []; } };
  const weekSport = (source, w) => { const c = (source.competitions || []).find((x) => x && x.id === (w.competitionId ?? null)); return (c && c.sport) || w.sport || 'cfb'; };

  /** (Re)compute. Resolves { ok, count } and never throws: a discretionary surface is simply absent when anything fails. */
  async function refresh({ force = false } = {}) {
    if (d.isWithheld()) { reset(); return { ok: false, reason: 'withheld', count: 0 }; }
    const now = d.now();
    if (st.inFlight) {
      if (!force) return st.inFlight;                                  // a plain ask joins the run in progress
      // a FORCED ask means the data moved: it must not be answered from a run that started on the old data, so it runs once more right after (any number of forced asks share that one follow-up)
      if (!st.queued) { const prev = st.inFlight; st.queued = prev.then(() => { st.queued = null; if (st.inFlight === prev) st.inFlight = null; return refresh({ force: true }); }); }   // (a settled run is cleared here too: the follow-up can never wait on itself)
      return st.queued;
    }
    if (!force && st.input && now - st.builtAt < REFRESH_MIN_MS) return { ok: true, reason: 'fresh', count: st.candidates.length };
    const epoch = st.epoch;
    const run = (async () => {
      try {
        const rawSource = d.getSource();
        // one SNAPSHOT of the data per refresh: an accessor (a function) is read once, here, so the input, the slate and the games behind an insight all see the same rows
        const source = rawSource && typeof rawSource === 'object' ? Object.fromEntries(Object.keys(rawSource).map((k) => [k, typeof rawSource[k] === 'function' ? rawSource[k].call(rawSource) : rawSource[k]])) : null;
        const viewerId = d.getViewerId();
        if (!source || !viewerId) return { ok: false, reason: 'no_source', count: 0 };
        const profile = d.getProfile() || {};
        // the two Admin-controlled switches (no code constant): the league's serverJobs.teamFacts and the platform's pick-history setting; anything but exactly true is OFF
        let pe = { on: false, rows: [] };
        try { const r = await d.fetchPickEvents({ leagueId: source.leagueId }); if (r && r.on === true && Array.isArray(r.rows)) pe = r; } catch { pe = { on: false, rows: [] }; }
        let sw0 = {};
        try { sw0 = d.getSwitches() || {}; } catch { sw0 = {}; }
        const switches = { teamFamily: sw0.teamFamily === true, pickEvents: pe.on === true };
        // the followed set comes from the engine's OWN eligible final-week input (followedTeamsFromInput), so this week's open picks can never reach it (DI-1076); the input is built once without
        // team data, and again with the followed set and the team facts only when the member follows something
        const build = (extra, followed) => buildInput({ ...source, ...extra, pickEvents: switches.pickEvents ? pe.rows : [] }, { revealClass: REVEAL.FINAL_WEEK, confirmedStatusFor: d.confirmedStatusFor, now, viewerMemberId: viewerId, switches, ...(followed ? { followed } : {}) });
        const input0 = build({}, null);
        const followed = followedTeamsFromInput(input0, viewerId, profileBuckets(profile, profile.otherTeamsBySport));
        // a readable name for each followed key when no team row was collected (DI-1086): the profile's own strings, then the team names on the member's FINAL picks
        const names = {};
        const nameIt = (sp, raw) => { const k = normTeam(raw); if (k && typeof raw === 'string' && !(names[sp] && names[sp][k])) (names[sp] = names[sp] || {})[k] = raw.slice(0, 80); };
        for (const sp of Object.keys(followed.bySport)) {
          for (const raw of [...((profile.almaBySport || {})[sp] || []), ...((profile.homeTeamsBySport || {})[sp] || []), ...((profile.otherTeamsBySport || {})[sp] || [])]) nameIt(sp, raw);
          for (const pk of ownFinalPicksOf(input0, viewerId)) if (pk.sport === sp) for (const raw of [pk.selectedTeam, pk.homeTeam, pk.awayTeam]) nameIt(sp, raw);
        }
        let teamRows = [];
        const sports = Object.keys(followed.bySport);
        if (sports.length && switches.teamFamily) { try { teamRows = (await d.fetchTeamFacts(sports)).rows || []; } catch { teamRows = []; } }      // the family off: no request at all
        const src = { ...source, teamFacts: teamRows };
        const input = sports.length ? build({ teamFacts: teamRows }, followed) : input0;
        const slate = [];
        for (const g of source.games || []) if (g && g.status !== 'final') { if (g.homeTeam) slate.push(String(g.homeTeam).toLowerCase()); if (g.awayTeam) slate.push(String(g.awayTeam).toLowerCase()); }
        const list = await candidatesSliced(input, { viewerMemberId: viewerId, now, slate, ledger: readLedger(), schedule: d.schedule, clock: d.clock, busy: d.busy, budgetMs: 8 });
        if (epoch !== st.epoch) return { ok: false, reason: 'superseded', count: 0 };       // the account or league changed while we computed: drop it
        st.input = input; st.source = src; st.viewerId = viewerId; st.candidates = list; st.byId = new Map(list.map((c) => [c.id, c])); st.followed = followed; st.names = names; st.teamRows = teamRows; st.builtAt = now; st.dataKey = input.dataKey;
        st.cards = list.map((c) => feedCardFromInsight(c)).filter(Boolean);
        return { ok: true, reason: 'built', count: list.length };
      } catch (e) {
        return { ok: false, reason: 'failed', count: 0, error: e && e.message ? String(e.message).slice(0, 120) : 'failed' };
      }
    })();
    st.inFlight = run;
    // cleared AFTER the assignment (a run with no await in it - no source - finishes before it is assigned, and a finally inside it would leave a settled run as "in flight" forever)
    const clear = () => { if (st.inFlight === run) st.inFlight = null; };
    run.then(clear, clear);
    return run;
  }

  function reset() { st.epoch++; st.input = null; st.source = null; st.candidates = []; st.byId = new Map(); st.cards = []; st.builtAt = 0; st.inFlight = null; st.queued = null; st.teamRows = []; resetGameDay(); }

  // ---- GAME DAY (DI-974 to 977, DI-1087): the few live consequences, per game ------------------------------------------------------------------------------------------------------------
  // The SAME reveal gate as every other surface, in its PUBLIC-GAME class: a week enters only when `confirmedStatusFor` (the server's word; in Supabase mode, also its picks read landed) says
  // live or final. Never the local status (the caller's confirmedStatusFor answers null when the server has not confirmed). The computation is cheap but it is never run inside a render: the
  // caller schedules refreshGameDay() after the Game view paints and repaints only when the facts changed. A followed team's row (public data, no pick) uses the followed set and team facts the
  // last FINAL-WEEK build computed (DI-1076): before that build there is none.
  const gd = { sig: '', key: '', res: null, input: null, games: new Map(), viewerId: null };
  function resetGameDay() { gd.sig = ''; gd.key = ''; gd.res = null; gd.input = null; gd.games = new Map(); gd.viewerId = null; }
  const snapshot = (raw) => (raw && typeof raw === 'object' ? Object.fromEntries(Object.keys(raw).map((k) => [k, typeof raw[k] === 'function' ? raw[k].call(raw) : raw[k]])) : null);
  /** (Re)compute the Game Day facts; true when what a game shows changed (the caller then repaints). Never throws. */
  function refreshGameDay() {
    try {
      if (d.isWithheld()) { const had = !!gd.res; resetGameDay(); return had; }
      const source = snapshot(d.getSource());
      const viewerId = d.getViewerId();
      if (!source || !viewerId) { const had = !!gd.res; resetGameDay(); return had; }
      const now = d.now();
      const weeks = (source.weeks || []).filter(Boolean), games = (source.games || []).filter(Boolean);
      let teamFamily = false;
      try { teamFamily = (d.getSwitches() || {}).teamFamily === true; } catch { teamFamily = false; }
      const sig = [source.leagueId, viewerId, teamFamily, Math.floor(now / 30000), weeks.map((w) => `${w.weekId}:${d.confirmedStatusFor(w)}:${w.status}:${w.dataSourceMode}`).join(','),
        games.map((g) => [g.gameId, g.status, g.homeScore, g.awayScore, g.lastUpdated, g.lockedSpread, g.spread, g.multiplier].join(':')).join(','), (source.picks || []).length, st.followed.teamKeys.join(','), st.teamRows.length].join('|');
      if (sig === gd.sig) return false;
      gd.sig = sig;
      const input = buildInput({ ...source, teamFacts: st.teamRows }, { revealClass: REVEAL.PUBLIC_GAME, confirmedStatusFor: d.confirmedStatusFor, now, viewerMemberId: viewerId, followed: st.followed, switches: { teamFamily, pickEvents: false } });
      // the slate a followed team plays on (DI-1087): schedule facts of the league's own weeks, never a demo or draft week; no pick crosses
      const weekOf = new Map(weeks.map((w) => [String(w.weekId), w]));
      const slateGames = games.filter((g) => { const w = weekOf.get(String(g.weekId)); return w && w.dataSourceMode !== 'demo' && w.status !== 'draft'; })
        .map((g) => ({ gameId: String(g.gameId), weekId: String(g.weekId), sport: weekSport(source, weekOf.get(String(g.weekId))), home: g.homeTeam, away: g.awayTeam, status: g.status, kickoffMs: Date.parse(g.kickoff || '') }));
      const res = gameDayInsights(input, { viewerMemberId: viewerId, now, slateGames });
      const key = JSON.stringify([...res.byGame.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => [k, [...v.visible, ...v.more]]));
      const changed = key !== gd.key;
      gd.key = key; gd.res = res; gd.input = input; gd.viewerId = viewerId; gd.now = now;
      gd.games = new Map(games.map((g) => [String(g.gameId), g]));
      return changed;
    } catch { const had = !!gd.res; resetGameDay(); return had; }
  }
  const gdStale = (g, now) => { if (g.status !== 'live') return false; const t = Date.parse(g.lastUpdated || ''); return !Number.isFinite(t) || now - t > STALE_MS; };
  /** The Insights row for a game (DI-977): { total, live } on a LIVE (fresh) or FINAL game with at least one fact; null otherwise (no row, no zero, no skeleton). */
  function gameDayFor(gameId) {
    if (!gd.res || typeof gameId !== 'string') return null;
    const e = gd.res.byGame.get(gameId);
    const g = gd.games.get(gameId);
    if (!e || !e.total || !g || (g.status !== 'live' && g.status !== 'final') || gdStale(g, d.now())) return null;     // a stale score: "Score may be behind" governs, no row
    return { total: e.total, live: g.status === 'live' };
  }
  const gdCtx = () => ({
    viewerId: gd.viewerId,
    nameOf: (id) => { const m = gd.input && gd.input.members.find((x) => x.id === id); return m ? m.name : 'A member'; },
    gameOf: (id) => { const g = gd.games.get(String(id)); return g ? { away: g.awayTeam, home: g.homeTeam } : null; },
    weekNumberOf: (wid) => { const w = gd.input && gd.input.weeks.find((x) => x.weekId === wid); return w ? w.weekNumber : null; },
  });
  const scoreLine = (g) => (g.status === 'live' || g.status === 'final') && g.awayScore !== null && g.awayScore !== undefined && g.homeScore !== null && g.homeScore !== undefined ? `${g.awayTeam} ${g.awayScore}, ${g.homeTeam} ${g.homeScore}` : `${g.awayTeam} at ${g.homeTeam}`;
  const factMark = (f) => (f.kind !== 'gd.only_backer' ? { mark: '', tone: '' } : f.state === 'final_win' ? { mark: '✓', tone: 'win' } : f.state === 'final_loss' ? { mark: '✗', tone: 'loss' } : f.state === 'covering' ? { mark: '▲', tone: 'covering' } : f.state === 'trailing' ? { mark: '▽', tone: 'trailing' } : { mark: '', tone: '' });
  /** The Game insights sheet's model for a game (DI-977): its facts in the engine's order (at most six), the first two visible, each with its sentence and figures; null when the row would be absent. */
  function gameDaySheet(gameId, { formatTime = null } = {}) {
    const row = gameDayFor(gameId);
    if (!row) return null;
    const e = gd.res.byGame.get(gameId), g = gd.games.get(gameId), ctx = gdCtx();
    const facts = [...e.visible, ...e.more].slice(0, GD_LIMITS.sheetMax).map((f) => ({ fid: f.id, line: gdFactLine(f, ctx), figures: gdFigures(f, ctx), kind: f.kind, toRank: f.toRank ?? null, tied: f.tied ?? null, ...factMark(f) })).filter((x) => x.line);
    if (!facts.length) return null;
    let asOfText = '';
    if (row.live && typeof formatTime === 'function') { const t = Date.parse(g.lastUpdated || ''); if (Number.isFinite(t)) { try { asOfText = formatTime(t); } catch { asOfText = ''; } } }
    return { gameId, facts, visibleN: GD_LIMITS.sheetVisible, live: row.live, asOfText, subtitle: `${scoreLine(g)} · ${row.live ? 'Live' : 'Final'}` };
  }
  const gameDayFactId = (gameId, fid) => `${GD_FACT_PREFIX}${gameId}::${fid}`;
  function gameDayFact(id) {
    if (!isGdFactId(id) || !gd.res) return null;
    const rest = id.slice(GD_FACT_PREFIX.length), cut = rest.indexOf('::');
    const gameId = rest.slice(0, cut), fid = rest.slice(cut + 2);
    if (!gameDayFor(gameId)) return null;
    const e = gd.res.byGame.get(gameId);
    const f = [...e.visible, ...e.more].find((x) => x.id === fid);
    return f ? { f, gameId, g: gd.games.get(gameId) } : null;
  }
  /** the games behind a Game Day fact: the live games a projection counted, else the game itself (public scores; no pick on the row) */
  function gdRows(f, gameId) {
    const ids = f.kind === 'gd.consequence' && gd.res ? (gd.input.projection.games.filter((g) => g.status === 'live' && g.weekId === f.weekId).map((g) => g.gameId)) : [gameId];
    return [...new Set(ids)].map((id) => gd.games.get(id)).filter(Boolean).map((g) => ({ key: String(g.gameId), gameId: String(g.gameId), primary: scoreLine(g), secondary: g.status === 'live' ? 'Live' : g.status === 'final' ? 'Final' : '', mark: '', markWord: '', tone: 'push' }));
  }
  function gdDetail(id, { updatedText = '', provText = '', formatTime = null } = {}) {
    const hit = gameDayFact(id);
    if (!hit) return null;
    const { f, gameId, g } = hit;
    const live = g.status === 'live';
    const ctx = gdCtx();
    const t = Date.parse(g.lastUpdated || '');
    const asOf = live && Number.isFinite(t) && typeof formatTime === 'function' ? (() => { try { return formatTime(t); } catch { return ''; } })() : '';
    return {
      id, kind: 'gameday', icon: 'scribeSpark',
      eyebrow: { reason: live ? 'Live' : 'Final', sport: '', league: provText || '' },
      title: gdFactLine(f, ctx), sample: `${live ? GDI_COPY.live : GDI_COPY.settled}${asOf ? ` · ${GDI_COPY.asOf(asOf)}` : ''}`,
      figures: gdFigures(f, ctx).slice(0, 3), listTitle: 'Games behind this', rows: gdRows(f, gameId),
      definition: gdDefinition(f), actions: [{ id: 'ask', label: 'Ask SCRIBE', tone: 'primary', icon: 'scribeSpark' }], updated: updatedText,
    };
  }
  function gdAskContext(id) {
    const hit = gameDayFact(id);
    if (!hit) return null;
    const { f, gameId, g } = hit;
    const rows = gdRows(f, gameId).map((r) => ({ ...r, weekLabel: '' }));
    // DI-1109: with the platform Ask setting on, a Game Day fact also takes "Why is this unusual?" and a typed question (the server recomputes the fact; never cached; no read)
    let open = false;
    try { open = d.isAskOpen() === true; } catch { open = false; }
    const ctx = { rows, modelEnabled: open, subjectIsViewer: true, subjectName: '', priorLine: '' };
    const chips = chipsFor({ kind: 'insight.history' }, ctx).filter((c) => c.id === 'games' || c.id === 'why');       // a live fact's instant question is "which games" (its picks are not the point, and last year has no meaning)
    return { candidate: null, leagueId: gd.input ? gd.input.leagueId : '', rows, ctx, chips, sealed: null, scope: `${g.status === 'live' ? 'Live' : 'Final'} · ${g.awayTeam} at ${g.homeTeam}`, shareOffered: false,
      answer: (chipId) => (chipId === 'games' ? instantAnswer('games', { kind: 'insight.history' }, ctx) : null), copy: ASK_COPY };
  }

  const homeCandidates = () => st.candidates.map((c) => fromInsight(c)).filter(Boolean);
  const feedCards = () => st.cards.slice();
  /**
   * HOME's three inputs (D2 integration wiring; the coordinator's ruling: app.js injects these into Home, lane 3's adapter imports nothing of lane 4's). Each answers from the wire's
   * OWN checked final-week input, so Home never hands the engine plain rows; before the wire has built, each answers "nothing" (no card, no followed team, no pick).
   *   homeInsightCards({ leagueId })  Home's insight cards for THAT league (the active league the wire built), in Home's card shape; another league's request gets none
   *   followedFor(profile)            the member's followed teams (DI-1073: alma mater, home teams, most-picked of FINAL picks) from the wire's input; null before the build
   *   ownFinalPicks()                 the member's own picks of FINAL weeks only (never this week's), from the wire's input
   */
  function homeInsightCards({ leagueId = null } = {}) {
    if (!st.input || !st.viewerId || typeof leagueId !== 'string' || leagueId !== st.input.leagueId || d.isWithheld()) return [];
    return st.candidates.map((c) => homeCardFromInsight(c)).filter((c) => c && c.leagueId === leagueId).map((c) => {
      // DI-1090: a team card shares `team:{teamKey}|{weekId}` with a followed team's matchup preview of the SAME game. The engine keys a team card by the last FINAL week it is true
      // through; the preview is keyed by the week of the game it previews (home-rank previewClusterKey). So Home sees one game, the card is keyed here by the week of the team's NEXT
      // league game (the soonest game not yet final, from the schedule only: no pick is read). With no upcoming league game the engine's key stands (there is no preview to meet).
      if (c.type !== 'insight.team' || !c.facts.team) return c;
      const wk = nextLeagueWeekFor(c.facts.team);
      return wk ? Object.freeze({ ...c, clusterKey: `team:${c.facts.team}|${wk}` }) : c;
    });
  }
  function nextLeagueWeekFor(teamKey) {
    const games = st.source && Array.isArray(st.source.games) ? st.source.games : [];
    const now = d.now();
    let best = null;
    for (const g of games) {
      if (!g || g.status === 'final' || (normTeam(g.homeTeam) !== teamKey && normTeam(g.awayTeam) !== teamKey)) continue;
      const k = Date.parse(g.kickoff);
      if (!Number.isFinite(k) || k < now - 12 * 3600e3) continue;
      if (!best || k < best.k) best = { k, weekId: String(g.weekId) };
    }
    return best ? best.weekId : null;
  }
  /**
   * DI-1112: the profile's three buckets for followedTeams. The home-team lists the app hands over fold the other teams in (F-2: Home's ranker treats every followed team alike);
   * `other` names the other teams that are NOT also a home team, so they are taken back out of the home bucket here and filed as `other` ("A team you follow").
   */
  function profileBuckets(p, otherIn) {
    const q = p && typeof p === 'object' ? p : {};
    const other = otherIn && typeof otherIn === 'object' && !Array.isArray(otherIn) ? otherIn : {};
    const homeIn = q.homeTeamsBySport && typeof q.homeTeamsBySport === 'object' && !Array.isArray(q.homeTeamsBySport) ? q.homeTeamsBySport : {};
    const homeTeamsBySport = {};
    for (const [sp, v] of Object.entries(homeIn)) {
      const drop = new Set((Array.isArray(other[sp]) ? other[sp] : []).map((x) => normTeam(String(x || ''))).filter(Boolean));
      const kept = (Array.isArray(v) ? v : [v]).filter((x) => typeof x === 'string' && x && !drop.has(normTeam(x)));
      if (kept.length) homeTeamsBySport[sp] = kept;
    }
    return { almaBySport: q.almaBySport || {}, homeTeamsBySport, otherTeamsBySport: other };
  }
  /** DI-1112: before the engine has built (or when it cannot), the member's profile alone (alma mater, home teams, other teams); once built, the most-picked of FINAL picks join. Withheld: nothing. */
  function followedFor(profile = {}) {
    if (d.isWithheld()) return null;
    const p = profile && typeof profile === 'object' ? profile : {};
    // "Other teams you follow": as handed, else from the member's own profile source (the same signed-in member; Home's injection names only alma and home teams)
    let other = p.otherTeamsBySport;
    if (!other || typeof other !== 'object') { try { const gp = d.getProfile() || {}; other = gp.otherTeamsBySport; } catch { other = null; } }
    const prof = profileBuckets(p, other);
    if (!st.input || !st.viewerId) { try { const f = followedTeams({ ...prof, ownFinalPicks: [] }); return f.teamKeys.length ? f : null; } catch { return null; } }   // an empty profile before the build is "nothing" (null), as before
    try { return followedTeamsFromInput(st.input, st.viewerId, prof); } catch { return null; }
  }
  function ownFinalPicks() {
    if (!st.input || !st.viewerId) return [];
    try { return ownFinalPicksOf(st.input, st.viewerId); } catch { return []; }
  }
  /** the candidate for an id: the computed list first, else recomputed from the current input (a link or a ledger-blocked fact still opens) */
  function candidateById(id) {
    if (typeof id !== 'string' || !st.input) return null;
    if (st.byId.has(id)) return st.byId.get(id);
    try { return insightFromId(st.input, id, { viewerMemberId: st.viewerId, now: d.now(), ring: [], slate: [], ledger: readLedger(), nameOf: nameOf }) || null; } catch { return null; }
  }
  const nameOf = (id) => { const m = st.input && st.input.members.find((x) => x.id === id); return m ? m.name : String(id); };

  // ---- the games behind an insight --------------------------------------------------------------------------------
  const rawGame = (gameId) => (st.source && st.source.games ? st.source.games.find((g) => g && String(g.gameId) === String(gameId)) : null);
  function gameRows(c) {
    if (!st.input) return [];
    const weeks = new Map(st.input.weeks.map((w) => [w.weekId, w.label || `Week ${w.weekNumber}`]));
    const out = [];
    for (const r of c.support || []) {
      const g = rawGame(r.gameId);
      if (!g) continue;
      const pick = r.memberId ? st.input.picks.find((p) => p.gameId === r.gameId && p.memberId === r.memberId) : null;
      const who = pick ? (pick.memberId === st.viewerId ? 'you' : nameOf(pick.memberId)) : '';
      const win = pick && pick.result === 'win', loss = pick && pick.result === 'loss';
      out.push({
        key: `${r.gameId}:${r.memberId || ''}`, gameId: r.gameId, weekLabel: weeks.get(r.weekId) || '',
        primary: g.status === 'final' ? `${g.awayTeam} ${g.awayScore}, ${g.homeTeam} ${g.homeScore}` : `${g.awayTeam} at ${g.homeTeam}`,
        secondary: `${weeks.get(r.weekId) || ''}${pick ? ` · ${who} backed ${pick.team}` : ''}`,
        mark: pick ? (win ? '✓' : loss ? '✗' : '–') : '', markWord: pick ? (win ? ' covered' : loss ? ' missed' : ' pushed') : '', tone: win ? 'win' : loss ? 'loss' : 'push',
      });
    }
    return out;
  }
  function teamRowsOf(c) {
    const key = c.metrics && c.metrics[0] && c.metrics[0].subject ? c.metrics[0].subject.id : '';
    const row = st.input ? st.input.teamFacts.find((r) => r.teamKey === key) : null;
    if (!row) return [];
    return row.results.slice(-24).reverse().map((g) => ({
      key: g.e, primary: `${row.teamName} ${g.pf}, ${g.on} ${g.pa}`, secondary: `${dayText(g.d)} · ${g.ha === 'home' ? 'home' : 'away'}${g.ot ? ' · overtime' : ''}`,
      mark: g.r, markWord: { W: ' win', L: ' loss', T: ' tie', OTL: ' overtime loss' }[g.r] || '', tone: g.r === 'W' ? 'win' : g.r === 'L' || g.r === 'OTL' ? 'loss' : 'push',
    }));
  }
  function sampleLine(c) {
    const m = c.metrics[0];
    if (c.kind === 'insight.team') return c.sample;
    const slice = st.input ? sliceOf(st.input, { competitionId: m.scope.competitionId, season: m.scope.season }) : null;
    return sampleSentence({ n: m.n, sport: m.scope.sport, season: m.scope.season, k: slice && slice.throughWeek != null ? slice.throughWeek : 0, thin: false }).replace('Based on ' + m.n + ' picks', `Based on ${m.n} ${m.n === 1 ? 'pick' : 'picks'}`);
  }

  /** the detail model for an insight id (Home's card tap, Your numbers' row, a link); null = the calm unavailable state */
  function detail(id, { shareOffered = false, updatedText = '', provText = '', formatTime = null } = {}) {
    if (isGdFactId(id)) return gdDetail(id, { updatedText, provText, formatTime });          // a Game Day fact's own detail (DI-977 "Open details")
    const c = candidateById(id);
    if (!c) return null;
    return insightDetailModel(c, { gameRows, teamRows: teamRowsOf, sampleLine, shareOffered, updatedText, provText, viewerId: st.viewerId });
  }

  /** Your numbers for one sport and season (DI-964). `archiveSeasons` and `compareOffered` are the CALLER's answers (the pilot-only 2025 record; whether anyone else is there to compare with). */
  function yourNumbers({ sport = null, season = null, nextKickoffText = '', archiveSeasons = [], compareOffered = false } = {}) {
    if (!st.input || !st.viewerId) return null;
    const parts = yourNumbersParts(st.input, { viewerMemberId: st.viewerId, sport, season, now: d.now(), nameOf, nextKickoffText, displayNames: st.names, archiveSeasons });
    return { ...parts, compareOffered: compareOffered === true && !parts.none };
  }

  /** The What-if screen's data (DI-978 to 982): the engine's strategy metrics for the viewer, one sport and season, final weeks only; null before the first build */
  function whatIf({ sport = null, season = null, copyId = null, teamKey = null } = {}) {
    if (!st.input || !st.viewerId) return null;
    try { return whatIfParts(st.input, { viewerMemberId: st.viewerId, sport, season, copyId, teamKey, now: d.now(), nameOf }); } catch { return null; }
  }

  /** everything the Ask sheet needs for one insight: the rows, the chips, the instant answers' inputs and the sealed packet */
  function askContext(id) {
    if (isGdFactId(id)) return gdAskContext(id);
    const c = candidateById(id);
    if (!c) return null;
    const rows = c.kind === 'insight.team' ? [] : gameRows(c);
    const m = c.metrics[0];
    const subject = m.subject && m.subject.kind === 'member' ? m.subject.id : null;
    let sealed = null;
    try { sealed = packetFor(st.input, c, { nameOf }); } catch { sealed = null; }
    const slice = st.input ? sliceOf(st.input, { competitionId: m.scope.competitionId, season: m.scope.season }) : null;
    const scope = `${m.n} ${m.n === 1 ? 'pick' : 'picks'} · ${String(m.scope.sport).toUpperCase()} ${m.scope.season}${slice && slice.throughWeek != null ? ` · through Week ${slice.throughWeek}` : ''}`;
    // the open questions (batch 3) follow the platform setting the app reads (`isAskOpen`; default off until it has been read): the "Why is this unusual?" chip appears only then
    let open = false;
    try { open = d.isAskOpen() === true; } catch { open = false; }
    const ctx = { rows, modelEnabled: open, subjectIsViewer: subject === st.viewerId, subjectName: subject ? nameOf(subject) : '', priorLine: '' };
    // DI-1108: a team card's fallback ("Here are the games behind this") is the team's own recent results, the rows its detail lists; the instant chips stay as they were (none)
    let teamRows = null;
    if (c.kind === 'insight.team') { try { const dm = detail(id, {}); teamRows = dm && Array.isArray(dm.rows) ? dm.rows : []; } catch { teamRows = []; } }
    return { candidate: c, leagueId: st.input.leagueId, rows, ctx, chips: chipsFor(c, ctx), sealed, scope: c.kind === 'insight.team' ? c.sample : scope, shareOffered: c.shareable === true,
      whatIf: c.family === 'strategy', answer: (chipId) => (teamRows && chipId === 'games' ? instantAnswer('games', c, { ...ctx, rows: teamRows }) : instantAnswer(chipId, c, ctx)), copy: ASK_COPY };
  }

  /** The sha256 of the packet the Ask sheet shows for an insight (the server compares it with its own recompute and says `refreshed` when they differ); null when there is none. */
  async function askShaFor(id) {
    if (isGdFactId(id)) {                                            // DI-1109: the same pure packet the server rebuilds for a Game Day fact
      if (!gd.input) return null;
      const fid = id.slice(id.indexOf('::') + 2);
      try { const g0 = gdPacketFor(gd.input, fid, { viewerMemberId: gd.viewerId, now: d.now() }); return g0 ? await packetSha(g0.sealed.packet, d.digest) : null; } catch { return null; }
    }
    const c = typeof id === 'string' && id.startsWith('ins1:') ? candidateById(id) : null;
    if (!c || !st.input) return null;
    try { const sealed = packetFor(st.input, c, { nameOf }); return await packetSha(sealed.packet, d.digest); } catch { return null; }
  }

  /**
   * SEND TO THE LOCKER ROOM (PF-520 / DI-963). The SENDER's share for an insight id, or null: only a candidate the engine marks shareable (not a team card, not private, not a hidden label,
   * a strategy only about the sharer), whose id has the server's strict shape for THIS league with the sharer as a strategy's subject. The line the room reads is the headline in the
   * THIRD person (the same id recomputed with no viewer: "Drew backs Texas the most", never "You ..."), under a fixed eyebrow; no number or name that the card does not already show.
   */
  function shareFor(id) {
    if (typeof id !== 'string' || !st.input || !st.viewerId) return null;
    const c = candidateById(id);
    if (!c || c.shareable !== true || !insightShareIdOk(id, { leagueId: st.input.leagueId, sharerId: st.viewerId })) return null;
    let third = null;
    try { third = insightFromId(st.input, id, { viewerMemberId: null, now: d.now(), ring: [], slate: [], ledger: [], nameOf }); } catch { third = null; }
    const title = (third && third.headline) || c.headline;
    const eyebrow = `${String(c.prov.sport || '').toUpperCase()} · Insight`;
    return { ref: { type: 'insight', id }, eyebrow, title, gameTag: '', line: shareLine({ eyebrow, title }) };
  }
  /** The READER's question for a shared insight: the id has the shape for THIS league and a listed metric, and it resolves from the reader's OWN data (insightFromId over the final-week input; a hidden label is null for anyone but its holder). */
  function shareAvailable(id, { authorId = null } = {}) {
    // security J-2: the SENDER is checked on the reader's side too. A What-if strategy (cf.*) is its sender's own (the sender's DI-963 rule), so a message from B carrying A's strategy is
    // not available; an unknown sender resolves no strategy (an empty sharer fails insightShareIdOk's cf.* rule). Every other kind is unchanged.
    if (typeof id !== 'string' || !st.input || !insightShareIdOk(id, { leagueId: st.input.leagueId, sharerId: typeof authorId === 'string' ? authorId : '' })) return false;
    return !!candidateById(id);
  }

  /** the integrator calls this when an insight has been SHOWN (a Home paint, a detail open): the no-repeat ledger remembers it */
  function noteShown(ids) {
    const now = d.now();
    let led = readLedger();
    for (const id of Array.isArray(ids) ? ids : [ids]) {
      const c = st.byId.get(id);
      const fact = c ? factOf(c) : null;
      if (fact) led = recordShown(led, fact, now);
    }
    try { d.ledger.set(ledgerToJson(led)); } catch { /* the ledger is a courtesy: losing it only means a card may be shown again */ }
  }

  return { refresh, reset, candidates: () => st.candidates.slice(), homeCandidates, feedCards, homeInsightCards, followedFor, ownFinalPicks, candidateById, detail, yourNumbers, whatIf, askContext, askShaFor, noteShown, shareFor, shareAvailable, refreshGameDay, gameDayFor, gameDaySheet, gameDayFactId, gameDaySummary: () => (gd.res ? gd.res.summary : null), isReady: () => !!st.input, builtAt: () => st.builtAt, dataKey: () => st.dataKey, scopes: () => (st.input ? scopesOf(st.input) : []) };
}
