/**
 * CFB Pickems — home-rank.js (Deployment 2, thread 101826-D2, lane 3 "Personal Home"; DI-818 / UN/PF-509 and DI-829…840 / UN/PF-510)
 * ====================================================================================================================================
 * TWO RANKINGS, ONE LEAF. A PURE module: its imports are js/team-match.js (DI-839's allow-list) and js/analytics-adapter.js (amendment d, pure); no storage, no DOM, no network, no randomness, no clock (`now` is a parameter).
 *
 * GAME DAY (DI-818):
 *   PEEK_POINTS, peekScore, rankItems, pickPills       which live games reach the five pills of a member of two or more leagues
 *
 * HOME RELEVANCE (DI-829…840, Drew RPF-B1 2026-10-19: "newest first, the relevance score deciding inclusion"):
 *   HOME_CANDIDATE_KEYS / normalizeCandidate            DI-829's closed 16-key shape; an unknown key is DROPPED and counted, a missing one defaulted (the ranker never reads prose)
 *   fromFeedCard, fromNewsItem, fromStoryline, fromContentCard, fromSocialPost, fromInsight     the adapters (fromInsight takes the analytics lane's own fromInsight() output)
 *   RANK_WEIGHTS, SOURCE_QUALITY, homeScore(c, sig)     the eight-feature score, 0..100 (DI-830), with its parts (`personal`, `league`, …) for the reason pill and the tests
 *   suppressionOf(item, sig) / SUPPRESSION_RULES        DI-832's closed list (S1 watch / stream, S2 generic, S4 promo, S5 removed, S6 unrelated preview), applied BEFORE scoring
 *   HOME_SCORE_FLOOR, isIncluded(c, scored)             DI-831: event cards always; discretionary ones only at or above the floor AND with personal or league relevance
 *   rankExternal(items, sig, opts)                      the pipeline Home runs on its external pool: suppress -> adapt -> score -> keep; ORDER IS NEVER CHANGED (DI-834)
 *   applyMix(entries, opts)                             DI-831's mix rule (inclusion, not order): External <= 60% of the first 20 while League candidates exist; insights <= 1 in 4
 *   reasonOf(scored)                                    DI-838: the shipped closed reason set, from the strongest personal or league feature
 *   HOME_TOP_ZONE_MAX                                   DI-834's seam for a "Top for you" zone: 0 (Drew ruled newest first)
 *
 * AMENDMENT 2026-10-19 (c), DI-1056…1060 (review: novelty and the top-story rule had not been re-checked once the score decided INCLUSION):
 *   stickyKeyOf / isSticky / sig.included              DI-1056: once included this session, no score change removes a card (novelty and caps gate NEW inclusion only)
 *   makeExposureLedger, exposuresIn, noteExposures    DI-1057: an exposure = one visit of >= 2 s with the card >= 50 % in view for >= 1.5 s; novelty reads exposures (session memory only)
 *   isTopStory, TOP_STORY_DAILY_CAP                     DI-1058: a top story skips the floor, at most 2 a day in the member's zone (the caller passes the day key)
 *   clusterScore                                        DI-1059: a cluster is included on its BEST member's score; the visible card stays the lowest publisher rank (newsRank, DI-672)
 *
 * AMENDMENT 2026-10-21 (d), DI-1071…1075 (Drew: "Analytics-led"):
 *   MIX (League at least 50% of the first 20, insights 2 in any 4 and 6 per league per local day), applyMix's `insightSeed`
 *   followedContentFamily(item, sig)                    DI-1072: a preview / player / spotlight about a FOLLOWED team (lane 4's set, via js/analytics-adapter.js) is League on the device
 *   RANK_WEIGHTS.personal followed / mostPicked         DI-1073: one +10 for alma / home / chosen team (folded, never stacked), +10 for a most-picked team
 *   RANK_WEIGHTS.personal followedSport                 DI-1104: +5 for a card in a sport the member follows ("Sports you follow"), never stacked with a team signal; the personal cap of 25 stands
 *   insightQualityOk(x) (js/analytics-adapter.js)      DI-1074: an insight needs `sampleOk` and a clean no-repeat ledger flag (the ONE adapter onto lane 4's field names)
 *
 * PRIVACY (DI-835): every personal signal is the VIEWER's own (their picks, their alma mater in each league, their chosen teams, their leagues' slates), computed on the device; a
 * score, a part or a reason is never stored, sent or shared. Another member's pick never raises a score (no signal carries one).
 */
import { normTeam } from './team-match.js';
import { insightQualityOk, INSIGHT_QUALITY, insightReasonChip } from './analytics-adapter.js';   // D2 DI-1074: lane 4's quality fields, read through the one adapter

export const PEEK_POINTS = Object.freeze({
  live: 40, liveStale: 25,
  kickoffWithin60m: 25, kickoffWithin3h: 15, laterToday: 5,
  finalWithin60m: 10,
  hasPick: 30, nearCover: 10,
  myTeam: 20,
  rankConsequence: 15,
  disagreement: 5,
  closeAndLate: 10,
});

const MIN = 60 * 1000, HOUR = 60 * MIN;
/** "Within one score": a touchdown and a two-point try in football, one goal in hockey. */
export const ONE_SCORE = Object.freeze({ nhl: 1, default: 8 });
const oneScore = (sport) => (sport === 'nhl' ? ONE_SCORE.nhl : ONE_SCORE.default);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const isStr = (v) => typeof v === 'string' && v !== '';
/** A live clock label that says the game is in its final period: "4th", "Q4", "3rd period" (hockey), "OT". */
const LATE = /\b(4th|Q4|OT|overtime|3rd period|3rd per)\b/i;

/**
 * @param {object} it   { phase: 'live'|'live-stale'|'upcoming'|'awaiting'|'final', kickoffMs, finalMs, ownTeam, coverMargin (the viewer's own live margin, signed: + covering), sport, teams: [away, home], liveLabel, sameDay }
 * @param {object} ctx  { now, myTeams: Set<string> (the viewer's alma mater / chosen teams in THIS league), facts: Set<itemId> (rank consequences, DI-824), sameDay(ms) -> boolean }
 */
export function peekScore(it, ctx = {}) {
  const P = PEEK_POINTS;
  const now = num(ctx.now) ?? 0;
  const i = it && typeof it === 'object' ? it : {};
  let s = 0;
  const kick = num(i.kickoffMs);
  const live = i.phase === 'live' || i.phase === 'live-stale';
  if (i.phase === 'live') s += P.live;
  else if (i.phase === 'live-stale') s += P.liveStale;
  else if (i.phase === 'upcoming' && kick !== null && kick > now) {
    const d = kick - now;
    if (d <= HOUR) s += P.kickoffWithin60m;
    else if (d <= 3 * HOUR) s += P.kickoffWithin3h;
    else if (typeof ctx.sameDay === 'function' && ctx.sameDay(kick)) s += P.laterToday;
  } else if (i.phase === 'final') {
    const f = num(i.finalMs);
    if (f !== null && now - f >= 0 && now - f <= HOUR) s += P.finalWithin60m;
  }
  if (isStr(i.ownTeam)) {
    s += P.hasPick;
    const m = num(i.coverMargin);
    if (live && m !== null && Math.abs(m) <= oneScore(i.sport)) s += P.nearCover;
  }
  const teams = Array.isArray(i.teams) ? i.teams : [];
  if (ctx.myTeams instanceof Set && teams.some((t) => isStr(t) && ctx.myTeams.has(t))) s += P.myTeam;
  if (ctx.facts instanceof Set && isStr(i.itemId) && ctx.facts.has(i.itemId)) s += P.rankConsequence;
  if (live && isStr(i.liveLabel) && LATE.test(i.liveLabel) && i.closeScore === true) s += P.closeAndLate;
  return s;
}

const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/** Score order, then kickoff (earlier first; unknown last), then league order, then game id — deterministic. */
export function rankItems(items, ctx = {}) {
  return (Array.isArray(items) ? items : []).filter(Boolean).map((it) => ({ ...it, score: peekScore(it, ctx) })).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ka = num(a.kickoffMs), kb = num(b.kickoffMs);
    if (ka !== kb) { if (ka === null) return 1; if (kb === null) return -1; return ka - kb; }
    if ((a.leagueOrder || 0) !== (b.leagueOrder || 0)) return (a.leagueOrder || 0) - (b.leagueOrder || 0);
    return cmpStr(String(a.gameId), String(b.gameId));
  });
}

/** DI-818's pills. `ranked` = rankItems' output (any phase; only live items are pills). */
export function pickPills(ranked, cap = 5) {
  const live = (Array.isArray(ranked) ? ranked : []).filter((x) => x && (x.phase === 'live' || x.phase === 'live-stale'));
  const firstOfPair = [];
  const seen = new Set();
  for (const it of live) { const k = `${it.leagueId}|${it.sport}`; if (!seen.has(k)) { seen.add(k); firstOfPair.push(it); } }
  const chosen = new Set(firstOfPair.slice(0, cap));
  for (const it of live) { if (chosen.size >= cap) break; chosen.add(it); }
  const pills = live.filter((it) => chosen.has(it));
  return { pills, rest: live.length - pills.length };
}

/**
 * DI-824 — THE STANDINGS-CONSEQUENCE SLOT'S TYPED STUB. The fact itself is the analytics lane's (UN-D2-19, "lane D": one deterministic engine, never a second projection here):
 *   peekFacts(source, { now, viewerMemberId }) -> Array<{ leagueId, sport, competitionId, weekId, fromRank, toRank, basis: 'live-projection', computedAt, evidence, itemId? }>
 * Home shows a fact only for a REVEALED week (server-confirmed live or final) whose `basis` is that deterministic computation, and only when the member moves UP ("If the live games
 * hold, you move up to 2nd in IRB."). `source` is null for the ACTIVE league (its rows are the mirror's) and the peeked league's source otherwise. Until lane D ships: no fact, no line.
 * @param {object|null} source
 * @param {{ now?: number, viewerMemberId?: string|null }} opts
 * @returns {Array<object>}
 */
export function peekFactsStub(source, opts = {}) { void source; void opts; return []; }


// ═══ HOME RELEVANCE (DI-829…840) ═════════════════════════════════════════════════════════════════════════════════════════

/** DI-829: the closed candidate shape (the analytics lane's HOME_CANDIDATE_KEYS is the same list; homerankingtest pins both). */
export const HOME_CANDIDATE_KEYS = Object.freeze(['id', 'family', 'kind', 'prov', 'sport', 'teamKeys', 'eventRef', 'eventTime', 'expiresAt', 'tier', 'involvesViewer', 'leagues', 'sourceRank', 'social', 'insight', 'clusterKey']);
/** DI-831: a discretionary candidate below this is not shown ("prefer no card"). */
export const HOME_SCORE_FLOOR = 35;
/** DI-834 / RPF-B1 (Drew, 2026-10-19: newest first): a "Top for you" zone of this many cards above the stream — none. */
export const HOME_TOP_ZONE_MAX = 0;
/** DI-832: the seam if Drew ever wants a picked game's watch link — off. */
export const ALLOW_WATCH_LINK_WHEN_PICKED = false;

/** DI-830's table: one frozen object; a weight change is a one-line, test-visible change. */
export const RANK_WEIGHTS = Object.freeze({
  personal: Object.freeze({ max: 25, pick: 15, chosenTeam: 10, alma: 10, followed: 10, followedSport: 5, mostPicked: 10, ownLeagueFact: 15 }),   // DI-1073: alma / chosen / home are ONE +10 (folded); a most-picked team its own +10
  league: Object.freeze({ max: 15, sportInLeagues: 5, teamInSlate: 10, leagueEvent: 15 }),
  proximity: Object.freeze({ max: 20, live: 20, kickoffWithin3h: 15, kickoffWithin24h: 10, locksWithin24h: 10, finalWithin3h: 8 }),
  history: Object.freeze({ max: 10, resonance: 10 }),
  novelty: Object.freeze({ max: 10, fresh: 10, once: 5, twicePenalty: -10 }),
  timeliness: Object.freeze({ max: 10, halfLifeHours: Object.freeze({ news: 6, reddit: 3, spotlight: 24, event: 12 }) }),
  social: Object.freeze({ max: 5, flag: 5, liveGameThread: 5 }),
  source: Object.freeze({ max: 5 }),
});
/** DI-830 source quality by publisher (Reddit's is its own tier, batch 3). The candidate carries the publisher registry's RANK (newsRank.js PUBLISHER_RANK), never a name: qualityOfRank maps it. */
export const SOURCE_QUALITY = Object.freeze({ 'ESPN': 5, 'NCAA.com': 5, 'CBS Sports': 4, 'NBC Sports': 4, 'Sports Illustrated': 3, 'Fox News': 2, 'Yahoo Sports': 1 });
/** The registry rank (ESPN 40, NCAA.com 42, CBS 45, NBC 47, SI 50, Fox 60, Yahoo 90) -> DI-830's quality points; unknown 0. homerankingtest pins it against both tables. */
export function qualityOfRank(rank) {
  if (typeof rank !== 'number' || !Number.isFinite(rank) || rank <= 0) return 0;   // no rank (null, '', a string) earns nothing: Number(null) is 0, which would read as the best publisher
  const r = rank;
  return r <= 42 ? 5 : r <= 47 ? 4 : r <= 50 ? 3 : r <= 60 ? 2 : r <= 90 ? 1 : 0;
}
/** DI-832 S2's "top story": the publisher registry's rank (lower is better) at or under this, under 3 hours old, in a followed sport. */
export const TOP_STORY_RANK = 45;
export const TOP_STORY_MAX_AGE_MS = 3 * 60 * 60 * 1000;
/** DI-831's mix rule. */
export const MIX = Object.freeze({ window: 20, externalShareMax: 0.5, insightsPerWindow: 10, insightsPerFour: 2, insightsPerLeaguePerDay: 6 });   // D2 DI-1071 (amendment d, Drew "Analytics-led"): League at least 50% of the first 20, insights 2 in any 4, 6 per league per local day
/** DI-1074: the insight quality gate is read through js/analytics-adapter.js (the one place lane 4's field names live); re-exported for the tests. */
export { insightQualityOk, INSIGHT_QUALITY };
/** DI-1058: at most this many top stories a calendar day (the member's zone) skip the floor. PROVISIONAL with HOME_SCORE_FLOOR until the DI-831 48-hour replay from Drew's export. */
export const TOP_STORY_DAILY_CAP = 2;
/** DI-1057: what counts as "shown". A visit of at least the shipped SEEN_MIN_VISIT_MS (2,000 ms, home.js DI-587; passed in) AND the card at least half in view for this long. */
export const EXPOSURE_MIN_DWELL_MS = 1500;
export const EXPOSURE_VIEW_RATIO = 0.5;

const HOUR_MS = 60 * 60 * 1000, DAY_MS = 24 * HOUR_MS;
const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));
const ms = (v) => { if (typeof v === 'number') return Number.isFinite(v) ? v : null; const t = Date.parse(v); return Number.isFinite(t) ? t : null; };
const normSet = (list) => new Set(arr(list).map((x) => normTeam(x)).filter(Boolean));
const hits = (keys, set) => !!set && set.size > 0 && arr(keys).some((k) => set.has(k));

/**
 * DI-829: a candidate in the closed shape. An unknown key is DROPPED and counted in `stats.dropped`; a missing one takes its empty default. Team keys are normalized (normTeam).
 * @returns {object} a frozen candidate
 */
export function normalizeCandidate(raw, stats = null) {
  const r = raw && typeof raw === 'object' ? raw : {};
  if (stats) for (const k of Object.keys(r)) if (!HOME_CANDIDATE_KEYS.includes(k)) stats.dropped = (stats.dropped || 0) + 1;
  const iv = r.involvesViewer && typeof r.involvesViewer === 'object' ? r.involvesViewer : {};
  const so = r.social && typeof r.social === 'object' ? r.social : {};
  const ins = r.insight && typeof r.insight === 'object' ? r.insight : null;
  return Object.freeze({
    id: str(r.id), family: r.family === 'external' ? 'external' : 'league', kind: str(r.kind), prov: r.prov && typeof r.prov === 'object' ? r.prov : null,
    sport: r.sport ? str(r.sport) : null, teamKeys: Object.freeze(Array.from(normSet(r.teamKeys))), eventRef: r.eventRef && typeof r.eventRef === 'object' ? r.eventRef : null,
    eventTime: ms(r.eventTime), expiresAt: ms(r.expiresAt), tier: r.tier === 'event' ? 'event' : 'discretionary',
    involvesViewer: Object.freeze({ pick: iv.pick === true, team: iv.team === true, alma: iv.alma === true, member: iv.member === true }),
    leagues: Object.freeze(arr(r.leagues).map(str).filter(Boolean)), sourceRank: Number.isFinite(r.sourceRank) ? r.sourceRank : null,
    social: Object.freeze({ disagreement: so.disagreement === true, loneBacker: so.loneBacker === true, rivalry: so.rivalry === true }),
    insight: ins ? Object.freeze({ interestingness: Math.max(0, Math.min(1, Number(ins.interestingness) || 0)), noveltyKey: str(ins.noveltyKey), metricId: str(ins.metricId), sampleOk: insightQualityOk(ins),
      reason: ['alma', 'home', 'picked', 'other'].includes(ins.reason) ? ins.reason : null }) : null,   // DI-1085: lane 4's followed-team reason kind (alma, home, picked and, M-93 DI-1112, other) survives normalisation (a closed set)   // DI-1074: the gate's answer travels with it
    clusterKey: str(r.clusterKey),
  });
}

// ── the adapters (each one closed: what it does not copy cannot reach the ranker) ──
const EVENT_TYPES = Object.freeze(['slate.published', 'picks.submitted', 'week.revealed', 'game.final', 'week.result', 'rank.changed', 'streak.extended', 'streak.broken', 'milestone.reached', 'scribe.post', 'lockerroom.top']);
/** A League card (feed-cards.js deriveCards' output, stamped). `year.ago` is a callback: discretionary (DI-837). */
export function fromFeedCard(card, { viewerId = null } = {}) {
  const c = card && typeof card === 'object' ? card : {};
  const f = c.facts && typeof c.facts === 'object' ? c.facts : {};
  const members = arr(f.members).map((m) => m && m.playerId).filter(Boolean);
  const leagueId = (c.prov && c.prov.leagueId) || c.leagueId || '';
  return normalizeCandidate({
    id: c.id, family: 'league', kind: c.type, prov: c.prov || null, sport: c.sport || null,
    teamKeys: [f.homeTeam, f.awayTeam, f.team].filter(Boolean), eventRef: { weekId: c.weekId || null, gameId: c.gameId || null }, eventTime: ms(c.sortKey),
    tier: EVENT_TYPES.includes(c.type) ? 'event' : 'discretionary',
    involvesViewer: { member: !!viewerId && (c.memberId === viewerId || members.includes(viewerId) || f.playerId === viewerId) },
    leagues: [leagueId], clusterKey: `${leagueId}|${c.type}|${c.memberId || '-'}|${c.weekId || '-'}`,
    insight: c.insight && typeof c.insight === 'object' ? c.insight : null,   // D2 DI-1071(e): an insight card (lane 4's, via the adapter) carries its interestingness and quality fields
  });
}
/** A publisher headline (newsTransport's normalized item, after rankNews). */
export function fromNewsItem(item) {
  const it = item && typeof item === 'object' ? item : {};
  return normalizeCandidate({ id: it.id, family: 'external', kind: 'news', sport: it.sport || null, teamKeys: arr(it.teamKeys).length ? it.teamKeys : it.teamNames,
    eventTime: ms(it.publishedAt), tier: 'discretionary', sourceRank: Number.isFinite(it.rank) ? it.rank : null, clusterKey: it.clusterId || `news|${it.id}` });
}
export function fromStoryline(item) {
  const it = item && typeof item === 'object' ? item : {};
  return normalizeCandidate({ id: it.id, family: 'external', kind: 'storyline', sport: it.sport || null, teamKeys: arr(it.teamKeys).length ? it.teamKeys : it.teamNames,
    eventTime: ms(it.publishedAt), tier: 'discretionary', sourceRank: Number.isFinite(it.rank) ? it.rank : null, clusterKey: `storyline|${it.id}` });
}
/** A preview / player preview / spotlight (newsTransport normalizeContentRow). */
export function fromContentCard(item) {
  const it = item && typeof item === 'object' ? item : {};
  // DI-1072: League when the device matched a followed team (followedContentFamily)
  return normalizeCandidate({ id: it.id, family: it.family === 'league' ? 'league' : 'external', kind: it.cardKind, sport: it.sport || null, teamKeys: it.teamKeys, eventRef: it.gameKickoff ? { kickoff: it.gameKickoff } : null,
    eventTime: ms(it.publishedAt), expiresAt: ms(it.eligibleUntil), tier: 'discretionary', clusterKey: `content|${it.id}` });
}
/** A Reddit post (batch 3, gated: DI-841). The shape is fixed now so the ranker needs no change when the source opens. */
export function fromSocialPost(post) {
  const p = post && typeof post === 'object' ? post : {};
  return normalizeCandidate({ id: p.id, family: 'external', kind: 'reddit', sport: p.sport || null, teamKeys: p.teamKeys, eventTime: ms(p.createdAt),
    tier: 'discretionary', sourceRank: Number.isFinite(p.sourceRank) ? p.sourceRank : null, social: { rivalry: false }, clusterKey: `reddit|${p.id}` });
}
/**
 * The analytics lane's candidate (its own fromInsight(), DI-829's 16 keys) — validated against the closed shape and nothing more: an extra key is dropped and counted, never read.
 * The integrator wires the analytics lane's `candidates()` -> its `fromInsight()` -> this; this lane authors no insight content.
 */
export function fromInsight(homeCandidate, stats = null) {
  const c = homeCandidate && typeof homeCandidate === 'object' ? homeCandidate : null;
  if (!c || c.family !== 'league' || !c.insight) return null;
  if (!insightQualityOk(c.insight)) { if (stats) stats.thin = (stats.thin || 0) + 1; return null; }   // DI-1074: a thin-sample or repeated insight is never a candidate, even when the floor is unmet
  return normalizeCandidate({ ...c, tier: 'discretionary' }, stats);
}

/**
 * DI-830: the score and its parts. `sig` = the viewer's signals (all normalized team-key sets): { now, pickTeams, chosenTeams, almaTeams, slateTeams, leagueSports:Set, followedSports:Set,
 * games: [{ teams:Set, kickoffMs, status, lockMs, finalMs }], historyTeams:Set, novelty:Map(subject -> { count, lastAt }) }.
 */
export function homeScore(c, sig = {}) {
  const W = RANK_WEIGHTS;
  const now = Number(sig.now) || 0;
  const keys = c.teamKeys || [];
  // personal (capped 25)
  let personal = 0;
  if (c.involvesViewer.pick || hits(keys, sig.pickTeams)) personal += W.personal.pick;
  // DI-1073: the alma mater, a News-settings team and an onboarding home team are ONE signal ("a followed team +10"), never stacked; a most-picked team is its own +10
  const teamSignalHit = !!(c.involvesViewer.team || c.involvesViewer.alma || hits(keys, sig.chosenTeams) || hits(keys, sig.almaTeams) || hits(keys, sig.homeTeams));
  if (teamSignalHit) personal += W.personal.followed;
  // D2 M-93 (DI-1104; UN-508 / PF-508): a sport the member said they follow ("Sports you follow", on the device) is half a followed team, +5, NEVER stacked with a team signal; a card with no sport gets nothing.
  // It lifts a card over the relevance gate (`personal > 0`) and nothing more: it does not change which sports News fetches, does not make a card "in the world" for S6, lowers no threshold, sends nothing.
  if (!teamSignalHit && c.sport && sig.profileSports instanceof Set && sig.profileSports.has(c.sport)) personal += W.personal.followedSport;
  if (hits(keys, sig.mostPickedTeams)) personal += W.personal.mostPicked;
  if (c.family === 'league' && c.involvesViewer.member) personal += W.personal.ownLeagueFact;
  personal = Math.min(W.personal.max, personal);
  // league (capped 15)
  let league = 0;
  // DI-830 "a League event card +15 flat", read as every League-family card (the league's own facts): with the event tier alone a callback (DI-837 "discretionary", the year-ago card) could
  // reach the 35 floor only in the first hour of its week, which would silently retire a shipped card. Novelty still retires it after two views in a day.
  if (c.family === 'league') league = W.league.leagueEvent;
  else {
    if (c.sport && sig.leagueSports instanceof Set && sig.leagueSports.has(c.sport)) league += W.league.sportInLeagues;
    if (hits(keys, sig.slateTeams)) league += W.league.teamInSlate;
  }
  league = Math.min(W.league.max, league);
  // proximity (the games of the viewer's leagues this candidate names)
  let proximity = 0;
  for (const g of arr(sig.games)) {
    if (!g || !(g.teams instanceof Set) || !keys.some((k) => g.teams.has(k))) continue;
    if (g.status === 'live') proximity = Math.max(proximity, W.proximity.live);
    const k = Number(g.kickoffMs);
    if (g.status !== 'live' && g.status !== 'final' && Number.isFinite(k) && k > now) proximity = Math.max(proximity, k - now <= 3 * HOUR_MS ? W.proximity.kickoffWithin3h : k - now <= DAY_MS ? W.proximity.kickoffWithin24h : 0);
    const l = Number(g.lockMs);
    if (Number.isFinite(l) && l > now && l - now <= DAY_MS) proximity = Math.max(proximity, W.proximity.locksWithin24h);
    const f = Number(g.finalMs);
    if (g.status === 'final' && Number.isFinite(f) && now - f >= 0 && now - f <= 3 * HOUR_MS) proximity = Math.max(proximity, W.proximity.finalWithin3h);
  }
  // historical resonance
  const history = (c.kind === 'year.ago' || (c.insight && /^insight\.history|^callback/.test(c.kind)) || (keys.length >= 2 && hits(keys, sig.historyTeams) && keys.filter((k) => sig.historyTeams.has(k)).length >= 2)) ? W.history.resonance : 0;
  // novelty (DI-1057: the subject's counted EXPOSURES on this device in the last 24 h — session memory only). It moves a candidate's score; it never removes an included card (DI-1056).
  const recent = exposuresIn(sig.novelty instanceof Map ? sig.novelty.get(noveltySubject(c)) : null, now);
  const novelty = recent <= 0 ? W.novelty.fresh : recent === 1 ? W.novelty.once : W.novelty.twicePenalty;
  // timeliness
  let timeliness = 0;
  if (c.kind === 'matchup.preview' || c.kind === 'player.preview') {
    const kick = c.eventRef && ms(c.eventRef.kickoff) !== null ? ms(c.eventRef.kickoff) : c.expiresAt;
    if (Number.isFinite(kick) && Number.isFinite(c.eventTime) && kick > c.eventTime) timeliness = Math.round(W.timeliness.max * Math.max(0, Math.min(1, (kick - now) / (kick - c.eventTime))));
  } else if (Number.isFinite(c.eventTime)) {
    const hl = c.kind === 'reddit' ? W.timeliness.halfLifeHours.reddit : c.kind === 'spotlight' ? W.timeliness.halfLifeHours.spotlight : c.family === 'external' ? W.timeliness.halfLifeHours.news : W.timeliness.halfLifeHours.event;
    const age = Math.max(0, now - c.eventTime) / HOUR_MS;
    timeliness = Math.round(W.timeliness.max * Math.pow(0.5, age / hl));
  }
  // social (after reveal only — the flags are set by producers that already passed their reveal gate)
  let social = 0;
  if (c.social.disagreement || c.social.loneBacker || c.social.rivalry) social = W.social.flag;
  if (c.insight) social = Math.max(social, Math.min(W.social.max, Math.round(W.social.max * c.insight.interestingness)));
  social = Math.min(W.social.max, social);
  // source quality
  const source = c.family === 'external' && c.kind !== 'reddit' ? qualityOfRank(c.sourceRank) : 0;   // Reddit's own tier arrives with batch 3
  const total = Math.max(0, Math.min(100, personal + league + proximity + history + novelty + timeliness + social + source));
  return Object.freeze({ total, personal, league, proximity, history, novelty, timeliness, social, source });
}
/** The subject novelty tracks: an insight's novelty key, else the first team, else the candidate's cluster. */
export function noveltySubject(c) {
  if (c.insight && c.insight.noveltyKey) return `n:${c.insight.noveltyKey}`;
  if (c.teamKeys && c.teamKeys.length) return `t:${c.teamKeys[0]}`;
  return `c:${c.clusterKey || c.id}`;
}
/** DI-1056: the session key of a candidate — the feed entry's own key (a League card's id; `news:<id>` for every External item, the key mergeFeed gives it). */
export function stickyKeyOf(c) { return c && (c.family === 'external' || CONTENT_KINDS.includes(c.kind)) ? `news:${c.id}` : str(c && c.id); }   // a content card keeps its news: key in either family
const CONTENT_KINDS = Object.freeze(['matchup.preview', 'player.preview', 'spotlight']);
/**
 * DI-1072: a preview, player-to-watch or spotlight card is LEAGUE INTELLIGENCE on this device when one of its teamKeys is a team the member FOLLOWS (DI-1073: alma mater, onboarding
 * home teams, the most-picked; never this week's picks, never the slate) in the card's own sport. Returns { family: 'league', reason } — the reason is the shipped private pill,
 * "Your alma mater" or "Your team" — or null (it stays External). Computed here, never stored or sent.
 */
export function followedContentFamily(item, sig = {}) {
  const it = item && typeof item === 'object' ? item : null;
  if (!it || !CONTENT_KINDS.includes(it.cardKind)) return null;
  const keys = Array.from(normSet(it.teamKeys));
  const bySport = sig.followedBySport instanceof Map ? sig.followedBySport.get(str(it.sport) || 'cfb') : null;
  if (!bySport || !keys.some((k) => bySport.teamKeys.has(k))) return null;
  return { family: 'league', reason: keys.some((k) => bySport.alma.has(k)) ? 'Your alma mater' : 'Your team' };
}
/** DI-1056: was this candidate already included in THIS session's feed? (sig.included: the entry keys Home has included since the session began; never persisted.) */
export function isSticky(c, sig = null) { return !!(sig && sig.included instanceof Set && sig.included.size && sig.included.has(stickyKeyOf(c))); }
/**
 * DI-831: inclusion. Event cards are always eligible; a discretionary card needs the floor AND some personal or league relevance. DI-1056: a card already included this session stays,
 * whatever its score now (novelty, decay, a dropped signal or a floor change gate NEW inclusion only); it leaves only for a reason that is not a score (its window, a withdrawal, a
 * suppression rule, its league, the session's end), which the callers enforce before they ask.
 */
export function isIncluded(c, scored, sig = null) {
  if (c.tier === 'event') return true;
  if (isSticky(c, sig)) return true;
  return scored.total >= HOME_SCORE_FLOOR && (scored.personal > 0 || scored.league > 0);
}

/** DI-1057: a subject's counted exposures within 24 h of `now`. The memory value is `{ times: [ms…] }`; the older `{ count, lastAt }` shape still reads (count, when lastAt is recent). */
export function exposuresIn(seen, now) {
  if (!seen || typeof seen !== 'object') return 0;
  const t = Number(now) || 0;
  if (Array.isArray(seen.times)) return seen.times.filter((x) => Number.isFinite(x) && t - x >= 0 && t - x <= DAY_MS).length;
  return Number.isFinite(seen.lastAt) && t - seen.lastAt <= DAY_MS ? Math.max(0, Number(seen.count) || 0) : 0;
}
/** DI-1057: record one exposure per subject occurrence at `now` into the session memory (subject -> { times }), pruning anything older than 24 h. Returns the memory. */
export function noteExposures(memory, subjects, now) {
  const mem = memory instanceof Map ? memory : new Map();
  const t = Number(now) || 0;
  for (const sub of arr(subjects)) {
    if (!isStr(sub)) continue;
    const prev = mem.get(sub);
    const times = (prev && Array.isArray(prev.times) ? prev.times : []).filter((x) => Number.isFinite(x) && t - x <= DAY_MS);
    times.push(t);
    mem.set(sub, { times });
  }
  return mem;
}
/**
 * DI-1057: one visit's exposure ledger (no clock: every call passes `now`). `start(now, inViewKeys)` opens a visit; `sight(key, inView, now)` records a card entering or leaving
 * the view (at least EXPOSURE_VIEW_RATIO of it); `end(now)` closes the visit and returns the keys that count — each AT MOST ONCE, and none at all when the visit was shorter than
 * `minVisitMs` (a tab pass-through). A card is counted when its cumulative in-view time within the visit reaches `minDwellMs`. Outside a visit (backgrounded, another tab, a
 * skeleton paint) nothing accrues. `drop(key)` closes a card that left the page.
 */
export function makeExposureLedger({ minVisitMs = 2000, minDwellMs = EXPOSURE_MIN_DWELL_MS } = {}) {
  const inView = new Map();
  let visit = null;
  const close = (key, now) => { const at = visit && visit.since.get(key); if (at === undefined) return; visit.acc.set(key, (visit.acc.get(key) || 0) + Math.max(0, now - at)); visit.since.delete(key); };
  return Object.freeze({
    start(now, keys = null) {
      if (visit) return false;
      visit = { start: Number(now) || 0, acc: new Map(), since: new Map() };
      for (const [k, v] of inView) if (v && (!keys || keys.has(k))) visit.since.set(k, visit.start);
      return true;
    },
    sight(key, isIn, now) {
      if (!isStr(key)) return;
      inView.set(key, isIn === true);
      if (!visit) return;
      if (isIn === true) { if (!visit.since.has(key)) visit.since.set(key, Number(now) || 0); } else close(key, Number(now) || 0);
    },
    drop(key, now) { inView.delete(key); if (visit) close(key, Number(now) || 0); },
    end(now) {
      if (!visit) return [];
      const t = Number(now) || 0;
      for (const k of [...visit.since.keys()]) close(k, t);
      const long = t - visit.start >= minVisitMs;
      const out = long ? [...visit.acc.entries()].filter(([, ms]) => ms >= minDwellMs).map(([k]) => k) : [];
      visit = null;
      return out;
    },
    active() { return visit !== null; },
    reset() { inView.clear(); visit = null; },
  });
}
/** DI-838: the shipped closed reason set, from the strongest personal or league feature (null: no reason pill). */
export function reasonOf(c, sig = {}) {
  const keys = c.teamKeys || [];
  if (c.insight) { const chip = insightReasonChip(c.insight); if (chip) return chip; }   // DI-1085: an insight card names WHY with lane 4's chip
  if (c.involvesViewer.pick || hits(keys, sig.pickTeams)) return 'Your pick';
  if (hits(keys, sig.slateTeams)) return "In this week's slate";
  if (c.involvesViewer.alma || hits(keys, sig.almaTeams)) return 'Your alma mater';
  if (c.involvesViewer.team || hits(keys, sig.chosenTeams)) return 'Your team';
  return null;
}

// ── DI-832: the suppression list (applied BEFORE scoring; the headline is read here and nowhere else in this file) ──
const S1_START = /^(watch|stream|how to watch|where to watch|live blog|live updates|live stream)\b(?![a-z])/i;
const S1_ANY = /\(live stream\)/i;
const S1_KINDS = new Set(['video', 'watch']);
const S4_PROMO = /\b(promo code|bonus bet|sign[ -]?up bonus|referral)\b/i;
export const SUPPRESSION_RULES = Object.freeze([
  Object.freeze({ id: 'S1', what: 'a "watch / stream" link or a video tile', applies: Object.freeze(['news', 'storyline', 'reddit']) }),
  Object.freeze({ id: 'S2', what: 'a generic headline that names no team of the member\'s world (unless a top story in a followed sport)', applies: Object.freeze(['news', 'storyline']) }),
  Object.freeze({ id: 'S4', what: 'a promotion-only Reddit title', applies: Object.freeze(['reddit']) }),
  Object.freeze({ id: 'S5', what: 'an over-18, removed or deleted Reddit post', applies: Object.freeze(['reddit']) }),
  Object.freeze({ id: 'S6', what: 'a preview or spotlight for a game no league of the member has, with no personal signal', applies: Object.freeze(['matchup.preview', 'player.preview', 'spotlight']) }),
]);
const headlineOf = (it) => str(it.headline || it.title).trim();
/** DI-832 S2 / DI-1058: a "top story" — a publisher of registry rank 45 or better, under 3 hours old, in a followed sport (a raw news or storyline item). */
export function isTopStory(it, sig = {}) {
  const x = it && typeof it === 'object' ? it : {};
  const pub = ms(x.publishedAt);
  return Number.isFinite(x.rank) && x.rank <= TOP_STORY_RANK && pub !== null && Number(sig.now) - pub >= 0 && Number(sig.now) - pub <= TOP_STORY_MAX_AGE_MS
    && sig.followedSports instanceof Set && sig.followedSports.has(x.sport);
}
/** Does a raw item name a team of the member's world (their picks, chosen teams, alma maters, their leagues' slates)? */
export function inWorldOf(item, sig = {}) {
  const it = item && typeof item === 'object' ? item : {};
  const keys = Array.from(normSet(arr(it.teamKeys).length ? it.teamKeys : it.teamNames));
  return [sig.pickTeams, sig.chosenTeams, sig.almaTeams, sig.slateTeams, sig.followedTeams].some((set) => hits(keys, set));   // DI-1072: a followed team is the member's world too
}
/** The rule that drops this raw item, or null. `kind` is 'news' | 'storyline' | 'reddit' | a content kind. */
export function suppressionOf(item, kind, sig = {}) {
  const it = item && typeof item === 'object' ? item : {};
  const h = headlineOf(it).replace(/^["“'‘]+/, '');
  const inWorld = inWorldOf(it, sig);
  if ((kind === 'news' || kind === 'storyline' || kind === 'reddit') && !ALLOW_WATCH_LINK_WHEN_PICKED && (S1_START.test(h) || S1_ANY.test(h) || S1_KINDS.has(str(it.kind || it.mediaKind).toLowerCase()) || /^watch espn\b/i.test(h))) return 'S1';
  if (kind === 'news' || kind === 'storyline') {
    if (!inWorld && !isTopStory(it, sig)) return 'S2';
  }
  if (kind === 'reddit') {
    if (S4_PROMO.test(h)) return 'S4';
    if (it.over18 === true || it.removed === true || it.deleted === true) return 'S5';
  }
  if ((kind === 'matchup.preview' || kind === 'player.preview' || kind === 'spotlight') && !inWorld) return 'S6';
  return null;
}

const kindOfExternal = (it) => (it && it.cardKind === 'storyline' ? 'storyline' : it && it.cardKind ? it.cardKind : 'news');
const adapt = (it, kind) => (kind === 'storyline' ? fromStoryline(it) : kind === 'news' ? fromNewsItem(it) : kind === 'reddit' ? fromSocialPost(it) : fromContentCard(it));
/**
 * DI-1059: a cluster (a lead with `alsoFrom`) is included or dropped on the BEST score among its members, and the card shown carries that score. The visible card stays the lead
 * (the lowest publisher rank, newsRank DI-672): for one story the teams are the same, so the members differ only in their publish time and their publisher's rank.
 */
export function clusterScore(it, kind, sig = {}) {
  const lead = homeScore(adapt(it, kind), sig);
  const also = kind === 'news' && Array.isArray(it.alsoFrom) ? it.alsoFrom : [];
  let best = lead;
  for (const a of also) {
    if (!a || typeof a !== 'object') continue;
    const sc = homeScore(adapt({ ...it, id: str(a.id) || it.id, publishedAt: a.publishedAt, rank: Number.isFinite(a.rank) ? a.rank : null, alsoFrom: undefined }, kind), sig);
    if (sc.total > best.total) best = sc;
  }
  return best;
}
/**
 * The external pool, ranked for INCLUSION (DI-831…834, amended DI-1056…1059): suppressed items first, then scored (a cluster on its best member), then kept when included — or
 * already included this session (DI-1056), or one of the day's top stories (DI-1058). The input order is preserved (time decides it; DI-834).
 * Items the ranker does not know (the calm notes: 'news-error', 'content-error') pass through untouched.
 * `opts.day` is the member's calendar day (their zone; the caller computes it) and `opts.topStories` the session's `{ day, ids }` — the top stories already chosen today.
 * @returns {{ kept: object[], dropped: Array<{id, rule}>, topStories: { day: string, ids: string[] }, topChosen: string[] }}  kept items carry a frozen `rank` ({ total, parts, reason }) — on the device only
 */
export function rankExternal(items, sig = {}, opts = {}) {
  const day = str(opts.day);
  const prior = opts.topStories && typeof opts.topStories === 'object' && str(opts.topStories.day) === day ? new Set(arr(opts.topStories.ids).map(str)) : new Set();   // a new day resets the count
  const decided = [], pool = [];
  for (const it of arr(items)) {
    if (!it || typeof it !== 'object') continue;
    if (it.cardKind === 'news-error' || it.cardKind === 'content-error') { decided.push({ it, keep: true, note: true }); continue; }
    const kind = kindOfExternal(it);
    const rule = suppressionOf(it, kind, sig);
    if (rule) { decided.push({ it, keep: false, rule }); continue; }
    const c = adapt(it, kind);
    const sc = clusterScore(it, kind, sig);
    // DI-1058: the bypass is S2's exception — a top story that names NO team of the member's world (a national story). A story about their world is decided by its score, as before.
    const top = (kind === 'news' || kind === 'storyline') && isTopStory(it, sig) && !inWorldOf(it, sig);
    if (isIncluded(c, sc, sig) || (top && prior.has(str(it.id)))) { decided.push({ it, keep: true, c, sc, top: top && prior.has(str(it.id)) }); continue; }
    const d = { it, keep: false, rule: 'floor', c, sc };
    decided.push(d);
    if (top) pool.push(d);
  }
  // DI-1058: the floor-bypass for top stories, at most TOP_STORY_DAILY_CAP a day: by score, then the lowest publisher rank, then id
  const room = Math.max(0, TOP_STORY_DAILY_CAP - prior.size);
  const chosen = pool.slice().sort((a, b) => (b.sc.total - a.sc.total) || ((Number.isFinite(a.it.rank) ? a.it.rank : 999) - (Number.isFinite(b.it.rank) ? b.it.rank : 999)) || (str(a.it.id) < str(b.it.id) ? -1 : str(a.it.id) > str(b.it.id) ? 1 : 0)).slice(0, room);
  for (const d of chosen) { d.keep = true; d.top = true; d.rule = null; }
  const kept = [], dropped = [];
  for (const d of decided) {
    if (d.note) { kept.push(d.it); continue; }
    if (!d.keep) { dropped.push({ id: str(d.it.id), rule: d.rule }); continue; }
    kept.push({ ...d.it, rank: Object.freeze({ total: d.sc.total, parts: d.sc, reason: reasonOf(d.c, sig), ...(d.top ? { topStory: true } : {}) }) });
  }
  return { kept, dropped, topStories: { day, ids: [...prior] }, topChosen: chosen.map((d) => str(d.it.id)) };
}

/**
 * DI-1071's mix rule (amendment d, supersedes DI-831's) over the ORDERED feed entries — inclusion only: an entry is dropped, never moved. `familyOf(entry)` -> 'external' | 'league'
 * | null (null: not counted, never dropped). League Intelligence is at least half of the first 20 whenever there are 10 or more League entries: External is then held to 10 of the
 * first 20. Insight cards: at most 2 in any 4 consecutive counted cards, at most 10 of the first 20, at most 6 per league per day (`dayOf(entry)` is the member's local day;
 * `insightSeed(league, day)` is how many that league already showed today in this session). An entry already included this session (`isSticky`) is never dropped by any of these
 * (DI-1056) and never counted again against the daily six. Nothing here adds a card: a short supply is a shorter feed (DI-1074).
 */
export function applyMix(entries, { familyOf, isInsight = () => false, leagueOf = () => '', dayOf = () => '', isSticky: stuck = () => false, insightSeed = () => 0, pendingLeague = 0 } = {}) {
  const list = arr(entries);
  const leagueTotal = list.filter((e) => familyOf(e) === 'league').length + Math.max(0, Number(pendingLeague) || 0);   // DI-1071(e): waiting insights count as League candidates
  const maxExt = Math.floor(MIX.window * MIX.externalShareMax);
  const capOn = leagueTotal >= MIX.window - maxExt;                         // enough League entries to fill their half: External is held to its half
  const out = [];
  let shownExt = 0, counted = 0, insights = 0;
  const lastFour = [];                                                       // the insight flags of the last three counted cards (the 2-in-4 window)
  const perLeagueDay = new Map();
  for (const e of list) {
    const fam = familyOf(e);
    if (!fam) { out.push(e); continue; }
    const inWindow = counted < MIX.window;
    const keepAnyway = stuck(e) === true;                                    // DI-1056: the caps bound NEW inclusion; an entry already included this session is never dropped by them
    if (fam === 'external' && inWindow && capOn && shownExt + 1 > maxExt && !keepAnyway) continue;   // the window's External half is full: the League entries that exist take the rest
    const ins = fam === 'league' && isInsight(e) === true;
    if (ins && !keepAnyway) {
      const k = `${leagueOf(e)}|${dayOf(e)}`;
      if (!perLeagueDay.has(k)) perLeagueDay.set(k, Math.max(0, Number(insightSeed(leagueOf(e), dayOf(e))) || 0));
      if ((inWindow && insights >= MIX.insightsPerWindow) || perLeagueDay.get(k) >= MIX.insightsPerLeaguePerDay) continue;
      if (lastFour.filter(Boolean).length >= MIX.insightsPerFour) continue;   // a third insight inside four consecutive cards
      perLeagueDay.set(k, perLeagueDay.get(k) + 1);
    }
    if (ins && inWindow) insights += 1;
    if (fam === 'external') shownExt += 1;
    counted += 1;
    lastFour.push(ins); if (lastFour.length > 3) lastFour.shift();
    out.push(e);
  }
  return out;
}

/**
 * DI-1090: the cluster key a matchup preview about a FOLLOWED team shares with lane 4's team card for the same game — `team:{teamKey}|{weekId}` — so Home shows the better one, not
 * both. `games` = the leagues' games ({ weekId, homeTeam, awayTeam, kickoff }); the week is the one whose game has this team at this kickoff. null when it is not a followed preview or
 * no league game matches.
 */
export function previewClusterKey(item, sig = {}, games = []) {
  const it = item && typeof item === 'object' ? item : null;
  if (!it || it.cardKind !== 'matchup.preview' || it.family !== 'league') return null;
  const followed = sig.followedTeams instanceof Set ? sig.followedTeams : new Set();
  const keys = Array.from(normSet(it.teamKeys)).filter((k) => followed.has(k));
  if (!keys.length) return null;
  const kick = ms(it.card && it.card.kickoff) ?? ms(it.gameKickoff);
  for (const g of arr(games)) {
    if (!g || !isStr(g.weekId)) continue;
    const teams = normSet([g.homeTeam, g.awayTeam]);
    const k = keys.find((x) => teams.has(x));
    if (k && (kick === null || ms(g.kickoff) === kick)) return `team:${k}|${g.weekId}`;
  }
  return null;
}

/**
 * DI-1071(e) (amendment e): pacing DEFERS, it never drops. `flags` = the insight flag of each COUNTED card in feed order; true when every 4-card window that contains index `i`
 * holds at most MIX.insightsPerFour insights.
 */
export function insightWindowOk(flags, i) {
  const f = arr(flags);
  const W = 4;                                                               // the window: four consecutive cards (a window at either end of the feed is the cards that exist)
  for (let start = Math.max(0, i - (W - 1)); start <= i; start++) {
    if (f.slice(start, start + W).filter(Boolean).length > MIX.insightsPerFour) return false;
  }
  return true;
}
/**
 * DI-1071(e): one inclusion pass over the waiting (deferred) insights. `list` = the feed entries this pass already holds (in order); `candidates` = the waiting insight entries,
 * BEST SCORE FIRST. Each is placed where `positionOf(entry, list)` says (a shared-time insight at the top: it is placed at the moment it is first included; a distinct-time one by its
 * own time) and admitted only when every 4-card window containing it holds at most 2 insights and the first 20 hold at most 10; one that fails stays deferred (never dropped, never
 * admitted out of the rule). Nothing already in `list` moves or leaves.
 * @returns {{ list: object[], admitted: object[], deferred: object[] }}
 */
export function admitInsights(list, candidates, { familyOf, isInsight, positionOf }) {
  let cur = arr(list).slice();
  const admitted = [], deferred = [];
  for (const cand of arr(candidates)) {
    const pos = Math.max(0, Math.min(cur.length, Number(positionOf(cand, cur)) || 0));
    const trial = [...cur.slice(0, pos), cand, ...cur.slice(pos)];
    const counted = trial.filter((e) => familyOf(e));
    const flags = counted.map((e) => isInsight(e) === true);
    const at = counted.indexOf(cand);
    const inFirst20 = flags.slice(0, MIX.window).filter(Boolean).length;
    if (at >= 0 && insightWindowOk(flags, at) && (at >= MIX.window || inFirst20 <= MIX.insightsPerWindow)) { cur = trial; admitted.push(cand); } else deferred.push(cand);
  }
  return { list: cur, admitted, deferred };
}
/**
 * DI-1071(e): while insights WAIT, External does not take the room they wait for — External NEW entries are kept only while they do not outnumber the League entries shown (sticky
 * entries always stay). A feed with a batch waiting is therefore shorter, never padded; the next pass fills it.
 */
export function holdExternalForWaiting(list, { familyOf, isSticky = () => false }) {
  const l = arr(list);
  const league = l.filter((e) => familyOf(e) === 'league').length;
  let ext = 0;
  return l.filter((e) => {
    if (familyOf(e) !== 'external') return true;
    if (isSticky(e) === true) { ext += 1; return true; }
    if (ext >= league) return false;
    ext += 1; return true;
  });
}

/**
 * The viewer's signals, normalized once per paint (plain team NAMES in, normTeam key sets out). Every list is the VIEWER's own world (DI-835): their leagues' slates (last and next
 * seven days), their own picks there, their alma maters, their News-settings teams; `games` carries each in-window game for proximity. `novelty` is Home's session memory (a Map).
 */
export function buildSignals({ now = 0, slateTeams = [], pickTeams = [], almaTeams = [], chosenTeams = [], leagueSports = [], followedSports = [], games = [], historyTeams = [], novelty = null, included = null, followed = null, homeTeams = [], profileSports = [] } = {}) {
  // DI-1073: lane 4's followed set ({ teamKeys, bySport }) through js/analytics-adapter.js followedTeamsFor(); absent = nothing followed
  const fb = new Map();
  const bs = followed && followed.bySport && typeof followed.bySport === 'object' ? followed.bySport : {};
  for (const [sport, v] of Object.entries(bs)) fb.set(sport, Object.freeze({ teamKeys: normSet(v && v.teamKeys), alma: normSet(v && v.alma), home: normSet(v && v.home), mostPicked: normSet(v && v.mostPicked) }));
  const unionOf = (field) => new Set([...fb.values()].flatMap((v) => [...v[field]]));
  return Object.freeze({
    now, slateTeams: normSet(slateTeams), pickTeams: normSet(pickTeams), almaTeams: new Set([...normSet(almaTeams), ...unionOf('alma')]), chosenTeams: normSet(chosenTeams),   // DI-1073: lane 4's alma too
    leagueSports: new Set(arr(leagueSports).map(str).filter(Boolean)), followedSports: new Set(arr(followedSports).map(str).filter(Boolean)),
    games: Object.freeze(arr(games).filter(Boolean).map((g) => Object.freeze({ teams: normSet(g.teams), kickoffMs: ms(g.kickoffMs), status: str(g.status), lockMs: ms(g.lockMs), finalMs: ms(g.finalMs) }))),
    historyTeams: normSet(historyTeams), novelty: novelty instanceof Map ? novelty : new Map(),
    included: new Set(included instanceof Set ? included : arr(included).map(str).filter(Boolean)),   // DI-1056: the session's included entry keys (a copy: the ranker never writes the session)
    profileSports: new Set(arr(profileSports).map(str).filter(Boolean)),   // DI-1104: the member's own "Sports you follow" (lower-case codes), device only
    followedBySport: fb, followedTeams: unionOf('teamKeys'), mostPickedTeams: unionOf('mostPicked'), homeTeams: new Set([...normSet(homeTeams), ...unionOf('home')]),   // DI-1072 / 1073
  });
}
