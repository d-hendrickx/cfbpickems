/**
 * CFB Pickems - js/analytics/insight.js (D2 lane 4; DI-947, 948, 999; 2026-10-19)
 * ================================================================================
 * THE INSIGHT CANDIDATE: its id (which IS the specification), its score, its repetition penalty, the "prefer no card" rule, and
 * `fromInsight` into lane B's closed Home candidate shape. FIXED COPY ONLY: the headline and line come from copy.js and never cross
 * into the Home candidate (DI-829: "free text never crosses").
 *
 * THE ID IS THE SPECIFICATION (the compare-share precedent): `ins1:{leagueId}:{sportCode}.{season}:{metricId}:{subjectId}[:{id2}]:{asOf}`
 * where `asOf` is a week id or a game id. Any device recomputes the same object from the same data. It is at most 200 characters (the
 * share limit); it never contains a name or a pick; a longer id is not shareable and the candidate is dropped, never truncated.
 * `insightFromId(input, id)` returns the candidate or `null`; null means "not available", never an error with detail.
 *
 * SCORE (DI-948): interestingness = clamp01( .25 magnitude + .20 personal + .15 social + .15 timeliness + .10 resonance + .10 confidence
 * + .05 actionability - repetition ), the integer weights one frozen table, every component 0..1 and deterministic. A candidate leaves the
 * engine only if interestingness >= 0.50. Per refresh at most 12 per league and 3 per subject; near-duplicates share a clusterKey and only
 * the best survives. ZERO CANDIDATES IS A CORRECT ANSWER. Equal scores order by eventTime, then id.
 */
import { getDef, minOf, isAvailable, isThin } from './registry.js';
import { sliceOf, scopesOf } from './slice.js';
import { copyFor, sampleCaption, teamCaption, withSoFar } from './copy.js';
import { factOf, isBlocked } from './ledger.js';
import { FORBIDDEN_META_KEYS } from '../notify-copy.js';

export const INSIGHT_V = 1;
export const SHARE_ID_MAX = 200;
export const INTEREST_WEIGHTS = Object.freeze({ magnitude: 25, personal: 20, social: 15, timeliness: 15, resonance: 10, confidence: 10, actionability: 5 });
export const EMIT_FLOOR = 0.50;
export const CAPS = Object.freeze({ perLeague: 12, perSubject: 3, teamPerSport: 2 });
export const REPEAT = Object.freeze({ sameKey24h: 0.30, sameMetricSubject3h: 0.15, ringSize: 60 });
const HOUR = 3600000, DAY = 24 * HOUR;
const FOURTEEN_DAYS = 14 * DAY, WEEK_MS = 7 * DAY;

/** card kinds the engine emits (DI-964) */
export const INSIGHT_KINDS = Object.freeze(['insight.pick', 'insight.social', 'insight.history', 'insight.strategy', 'insight.label', 'insight.team']);
/** the followed-team reason chips (DI-1085): why a team card is on the screen */
export const REASON_CHIPS = Object.freeze({ alma: 'Your alma mater', home: 'Your home team', picked: 'A team you pick', other: 'A team you follow' });   // DI-1112: 'other' = a team listed under "Other teams you follow"
const KIND_BY_FAMILY = Object.freeze({ identity: 'insight.pick', performance: 'insight.pick', behavior: 'insight.pick', situational: 'insight.pick', consensus: 'insight.social', pairs: 'insight.social', league: 'insight.social', callback: 'insight.history', strategy: 'insight.strategy', label: 'insight.label' , team: 'insight.team' });

/**
 * THE FACT KEYS an insight card may carry (DI-952 d), deep-frozen and scanned at module load against FORBIDDEN_META_KEYS exactly as feed-cards.js scans its own
 * (a forbidden key in this table stops the app loading). An allow-list, not a deny-list: a key that is not here is not a fact of an insight card.
 */
const COMMON_FACTS = ['id', 'v', 'kind', 'headline', 'line', 'sample', 'shareable', 'metricIds', 'eventRef', 'eventTime', 'expiresAt'];
export const INSIGHT_ALLOWED_FACTS = Object.freeze({
  'insight.pick': Object.freeze([...COMMON_FACTS, 'teamKeys']),
  'insight.social': Object.freeze([...COMMON_FACTS, 'memberIds']),
  'insight.history': Object.freeze([...COMMON_FACTS, 'memberIds']),
  'insight.strategy': Object.freeze([...COMMON_FACTS]),
  'insight.label': Object.freeze([...COMMON_FACTS, 'memberIds']),
  'insight.team': Object.freeze([...COMMON_FACTS, 'teamKeys', 'reason']),
});
for (const [kind, keys] of Object.entries(INSIGHT_ALLOWED_FACTS)) for (const k of keys) if (FORBIDDEN_META_KEYS.includes(k)) throw new Error('analytics: ' + kind + ' allows the forbidden fact key ' + k);

/** the shipped id alphabet (chat-share.js SHARE_ID_RE) */
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/;
export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);

export function insightId({ leagueId, sportCode, season, metricId, subjectId, id2 = null, asOf }) {
  const parts = ['ins1', leagueId, sportCode + '.' + season, metricId, subjectId];
  if (id2) parts.push(id2);
  parts.push(asOf);
  const id = parts.join(':');
  return id.length <= SHARE_ID_MAX && ID_RE.test(id) ? id : null;
}

/**
 * SEND TO THE LOCKER ROOM (PF-520 / DI-963; coordinator ruling 2026-10-21; lane 7's migration 0062 rule (e) is the SERVER twin and refuses anything else).
 * The EXACT metric ids a member may share: revealed league data only. NEVER: beh.pick_change, beh.first_vs_final, cf.never_changed (and any `private: true` metric), cf.money and
 * cf.cumulative (dark, or no card), any team.* card (public ESPN data, not a league moment), a Game Day fact (a live projection; its ids are not ins1:). sit.rivalry and
 * lbl.rivalry_expert are listed and stay dark until the rivalry list is approved. analyticstest SHARE pins this list against the registry, so a new metric is a visible decision.
 */
export const SHARE_METRIC_IDS = Object.freeze([
  'ident.team_record', 'ident.team_most_backed', 'ident.team_most_faded', 'ident.team_loyalty', 'ident.fav_dog', 'ident.home_away', 'ident.spread_band', 'ident.sport_split', 'ident.alma_pick', 'ident.alma_su',
  'perf.best_worst_week', 'perf.streaks', 'perf.weeks_won_lost', 'perf.rank_path', 'perf.rise_fall', 'perf.volatility', 'perf.vs_last_season',
  'cons.rate', 'cons.with_against', 'cons.unanimous', 'cons.lone_correct', 'cons.league_miss', 'cons.polarizing', 'cons.accuracy', 'cons.contrarian_leader',
  'pair.agreement', 'pair.disagreement_record', 'pair.similar_opposite', 'pair.weekly_h2h', 'pair.split_team',
  'sit.ranked', 'sit.daypart', 'sit.national_tv', 'sit.neutral', 'sit.conference', 'sit.big_game', 'sit.postseason', 'sit.rivalry',
  'beh.after_week', 'beh.leading_trailing', 'beh.trust_run', 'beh.burn_rebound',
  'lg.closest_week', 'lg.blowout_week', 'lg.chaos_week', 'lg.team_trust_fade', 'lg.collective_week',
  'cb.same_week_last_year', 'cb.prior_standing', 'cb.notable_moment', 'cb.team_history', 'cb.rematch', 'cb.changed_behavior', 'cb.blurb', 'cb.joke',
  'cf.always_favorite', 'cf.always_underdog', 'cf.follow_consensus', 'cf.fade_consensus', 'cf.copy_member', 'cf.team_record', 'cf.perfect_card',
  'lbl.chalk_merchant', 'lbl.underdog_whisperer', 'lbl.chaos_agent', 'lbl.captain_consensus', 'lbl.certified_hater', 'lbl.comeback_king', 'lbl.bad_beat_magnet', 'lbl.rivalry_expert',
]);
const SHARE_SEG = '[A-Za-z0-9][A-Za-z0-9_.-]{0,63}';
/** the server's strict shape (0062 rule (e)) with one difference: the league segment is checked against the caller's league by equality (the server also requires a lowercase uuid) */
const SHARE_ID_SHAPE = new RegExp('^ins1:(' + SHARE_SEG + '):[a-z0-9]{2,8}[.][0-9]{4}:([a-z][a-z0-9]{0,15}[.][a-z0-9_]{1,48}):(' + SHARE_SEG + ')(?::(' + SHARE_SEG + '))?:(' + SHARE_SEG + ')$');
/**
 * May this insight id travel as a share reference into `leagueId`'s room? The shape, the league, the metric on the list; a strategy (cf.*) only when its subject is `sharerId`
 * (the SENDER passes their own member id; a READER passes null: the server checked the sharer when the message was posted). The season segment must be exactly four digits.
 */
export function insightShareIdOk(id, { leagueId, sharerId = null } = {}) {
  if (typeof id !== 'string' || id.length > SHARE_ID_MAX || typeof leagueId !== 'string' || !leagueId) return false;
  const m = SHARE_ID_SHAPE.exec(id);
  if (!m || m[1] === 'team' || m[1] !== leagueId) return false;
  if (!SHARE_METRIC_IDS.includes(m[2])) return false;
  if (m[2].startsWith('cf.') && sharerId !== null && m[3] !== sharerId) return false;
  return true;
}

/** inverse of insightId; null for anything that is not one (never throws) */
export function parseInsightId(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) return null;
  const p = id.split(':');
  if (p[0] !== 'ins1' || (p.length !== 6 && p.length !== 7)) return null;
  const [, leagueId, ss, metricId, subjectId] = p;
  const dot = ss.indexOf('.');
  if (dot < 1) return null;
  return { leagueId, sportCode: ss.slice(0, dot), season: ss.slice(dot + 1), metricId, subjectId, id2: p.length === 7 ? p[5] : null, asOf: p[p.length - 1] };
}

// ---- per-metric tuning: magnitude (0..1), social breadth, timeliness -------------------------------------------------
const clamp01 = (x) => Math.max(0, Math.min(1, x));
/** magnitude per metric: rate gap vs the league mean over 0.30, a count over the metric's saturation, a streak run over 8, a rank change over the league size */
const MAG = {
  'ident.team_most_backed': (m) => clamp01(m.value.count / 10),
  'ident.team_most_faded': (m) => clamp01(m.value.count / 10),
  'ident.team_loyalty': (m) => clamp01(m.value.share),
  'ident.fav_dog': (m) => (m.comparison ? clamp01(Math.abs(m.value.share - m.comparison.value) / 0.30) : 0),
  'ident.home_away': (m) => clamp01(Math.abs(m.value.homeShare - 0.5) / 0.30),
  'ident.alma_su': (m) => clamp01(Math.abs(m.value.w - m.value.l) / Math.max(1, m.n)),
  'perf.streaks': (m) => (m.value.current.active ? clamp01(m.value.current.run / 8) : 0),
  'perf.rise_fall': (m) => (m.value.rise ? clamp01(m.value.rise.places / Math.max(1, m.scopeEntrants - 1)) : 0),
  'perf.weeks_won_lost': (m) => clamp01(m.value.won / 4),
  'perf.best_worst_week': () => 0.5,
  'perf.vs_last_season': (m) => clamp01(Math.abs(m.value.delta) / 10),
  'cons.rate': (m) => clamp01(Math.abs(m.value.rate - 0.5) / 0.30),
  'cons.with_against': (m) => clamp01(Math.abs(m.value.with.w / Math.max(1, m.value.with.w + m.value.with.l) - m.value.against.w / Math.max(1, m.value.against.w + m.value.against.l)) / 0.30),
  'cons.unanimous': (m) => clamp01(m.value.count / 5),
  'cons.lone_correct': (m) => clamp01(m.value.against / 4),
  'cons.league_miss': () => 0.8,
  'cons.polarizing': (m) => clamp01(m.value.minorityShare / 0.5),
  'cons.accuracy': (m) => clamp01(Math.abs(m.value.accuracy - 0.5) / 0.30),
  'cons.contrarian_leader': (m) => clamp01(m.value.contrarianRate / 0.5),
  'pair.agreement': (m) => clamp01(Math.abs(m.value.rate - 0.5) / 0.30),
  'pair.similar_opposite': () => 0.6,
  'pair.disagreement_record': (m) => clamp01(Math.abs(m.value.aRight - m.value.bRight) / Math.max(1, m.value.disagreements)),
  'pair.weekly_h2h': (m) => clamp01(m.value.run.n / 5),
  'pair.split_team': (m) => clamp01(m.value.teams[0].n / 6),
  'lg.closest_week': (m) => (m.value.tiedAtTop ? 1 : 0.6),
  'lg.blowout_week': (m) => clamp01(m.value.gap / 6),
  'lg.chaos_week': () => 0.6,
  'lg.team_trust_fade': (m) => clamp01(((m.value.backed || m.value.faded).n) / 16),
  'lg.collective_week': () => 0.6,
  'beh.after_week': (m) => clamp01(Math.abs(m.value.under.share - m.value.over.share) / 0.30),
  'beh.leading_trailing': (m) => clamp01(Math.abs(m.value.leading.rate - m.value.trailing.rate) / 0.30),
  'beh.trust_run': (m) => clamp01(m.value.run / 8),
  'beh.burn_rebound': (m) => clamp01(Math.abs(m.value.switched / m.value.burns - 0.5) / 0.30),
  'cf.always_favorite': (m) => clamp01(Math.abs(m.value.diffWins) / 6),
  'cf.always_underdog': (m) => clamp01(Math.abs(m.value.diffWins) / 6),
  'cf.follow_consensus': (m) => clamp01(Math.abs(m.value.diffWins) / 6),
  'cf.fade_consensus': (m) => clamp01(Math.abs(m.value.diffWins) / 6),
  'cf.copy_member': (m) => clamp01(Math.abs(m.value.diffWins) / 6),
  'cf.team_record': (m) => clamp01(Math.abs(m.value.diffWins) / 4),
  'cf.perfect_card': (m) => clamp01((m.value.perfect + m.value.oneMissAway) / 3),
  'cf.never_changed': (m) => clamp01(Math.abs(m.value.neverChanged.w - m.value.actual.w) / 4),
  'cb.same_week_last_year': () => 0.7, 'cb.prior_standing': () => 0.7, 'cb.notable_moment': () => 0.7, 'cb.team_history': (m) => clamp01((m.value.backed.n + m.value.faded.n) / 8),
  'cb.rematch': () => 0.8, 'cb.changed_behavior': () => 0.9, 'cb.blurb': () => 0.8, 'cb.joke': () => 0.8,
  // followed-team facts (DI-1080 to 1083): public data about a team the member follows
  'team.record': (m) => clamp01(Math.abs(m.value.w - m.value.l - m.value.otl) / Math.max(1, m.value.games)),
  'team.form': (m) => (m.value.run.streak ? clamp01(m.value.run.n / 8) : 0.2),
  'team.scoring': (m) => clamp01(Math.abs(m.value.last.margin) / 20),
  'team.margins': () => 0.4, 'team.vs_ranked': (m) => clamp01(m.value.games / 6),
  'team.ats_in_league': (m) => clamp01(Math.abs(m.value.covered - m.value.lost) / Math.max(1, m.value.games)),
  'team.leaders_recent': () => 0.5, 'team.coach': () => 0.3,
};
const magnitudeOf = (m) => (m.id.startsWith('sit.') ? clamp01(sitGap(m) / 0.30) : m.id.startsWith('lbl.') ? 0.8 : (MAG[m.id] ? MAG[m.id](m) : 0));
function sitGap(m) {
  const best = Math.max(...m.value.buckets.map((b) => Math.abs((b.rate ?? 0) - (m.value.overall.rate ?? 0))));
  return Number.isFinite(best) ? best : 0;
}
const RESONANCE_FULL = new Set(['cb.same_week_last_year', 'cb.rematch', 'cb.changed_behavior']);
const RESONANCE_HALF = new Set(['cb.prior_standing', 'cb.notable_moment', 'cb.team_history', 'cb.blurb', 'cb.joke', 'beh.trust_run', 'ident.team_loyalty', 'pair.weekly_h2h', 'pair.split_team']);

/** interestingness = clamp01( weighted components / 100 - repetition ), rounded to four places; every component is 0..1 */
export function scoreOf(c, repetition = 0) {
  const W = INTEREST_WEIGHTS;
  const raw = (W.magnitude * c.magnitude + W.personal * c.personal + W.social * c.social + W.timeliness * c.timeliness + W.resonance * c.resonance + W.confidence * c.confidence + W.actionability * c.actionability) / 100 - repetition;
  return Math.round(clamp01(raw) * 10000) / 10000;
}

/** the members and teams a metric concerns (for personal / social breadth and teamKeys) */
function involved(m) {
  const ids = new Set();
  const s = m.subject || {};
  if (s.kind === 'member' || s.kind === 'pair') { ids.add(s.id); if (s.kind === 'pair' && s.id2) ids.add(s.id2); }
  for (const r of m.support || []) if (r.memberId) ids.add(r.memberId);
  const v = m.value || {};
  if (v.memberId) ids.add(v.memberId);
  if (v.holderId) ids.add(v.holderId);
  return ids;
}

/**
 * Build the candidate for one available metric, or null (no card copy, no id, too long). `ctx`: { viewerMemberId, now, ring, slate, nameOf, gameLabel, slice }.
 * Pure: `now` and `ring` are parameters.
 */
export function candidateFor(metric, ctx) {
  const def = getDef(metric.id);
  // A label its holder HID (the RPF-D3 switch) is the holder's alone: no other viewer is handed a candidate, whatever its score and however it was reached (the catalogue, a slice, a link by id). Fail closed.
  if (metric.id.startsWith('lbl.') && metric.value && metric.value.hidden === true && metric.value.holderId !== ctx.viewerMemberId) return null;
  const slice = ctx.slice;
  const sub = metric.subject || {};
  const m = metric.id === 'perf.rise_fall' ? { ...metric, scopeEntrants: slice.memberIds.length } : metric;
  const words = copyFor(m, { ...ctx, viewerId: ctx.viewerMemberId });
  if (!words) return null;
  const isTeam = sub.kind === 'team';
  const isGame = !isTeam && (sub.kind === 'game' || metric.id === 'cons.polarizing');
  const gameId = isGame ? (metric.value && metric.value.gameId) || sub.id : null;
  const asOfToken = isGame ? gameId : isTeam ? metric.asOf.weekId : slice.asOf.weekId;
  const subjectId = sub.kind === 'league' ? slice.leagueId : isTeam ? slug(sub.id) : sub.id;
  const id2 = sub.id2 ? (def.id.startsWith('cb.team_history') || def.id.startsWith('ident.team') || def.id.startsWith('beh.trust') || def.id === 'cf.team_record' ? slug(sub.id2) : sub.id2) : null;
  const id = insightId({ leagueId: slice.leagueId, sportCode: slice.sport, season: slice.season, metricId: metric.id, subjectId, id2, asOf: asOfToken });
  if (!id) return null;
  const who = involved(metric);
  const viewer = ctx.viewerMemberId;
  const follow = isTeam ? (metric.follow || null) : null;
  const personal = isTeam ? (follow ? (follow.reason === 'picked' ? 0.8 : 1) : 0) : viewer && (sub.id === viewer || sub.id2 === viewer) ? (sub.kind === 'pair' ? 0.6 : 1) : (viewer && (metric.support || []).some((r) => r.memberId === viewer) ? 0.3 : 0);
  const social = isTeam ? 0.2 : who.size >= 3 || sub.kind === 'league' ? 1 : who.size === 2 ? 0.6 : 0.2;
  const teams = new Set();
  const v = metric.value || {};
  const slate = ctx.slate || [];
  const teamKeys = [];
  for (const k of [sub.id2, v.teamKey]) if (typeof k === 'string' && sub.kind !== 'pair') teamKeys.push(k);
  if (isTeam) { teamKeys.push(sub.id); if (follow) teamKeys.push(follow.key); for (const a of metric.aliases || []) teamKeys.push(a); }
  for (const r of metric.support || []) { const g = slice.gameById.get(r.gameId); if (g) { teams.add(g.homeKey); teams.add(g.awayKey); } }
  const onSlate = slate.some((t) => teams.has(t) || teamKeys.includes(t));
  const lastGameMs = isTeam ? (metric.asOf.throughKickoffMs || 0) : 0;
  const timeliness = onSlate ? 1 : isTeam ? (lastGameMs && ctx.now - lastGameMs <= 3 * DAY ? 0.8 : 0.4) : (isGame ? 0.2 : 0.5);
  const resonance = RESONANCE_FULL.has(metric.id) ? 1 : RESONANCE_HALF.has(metric.id) ? 0.5 : 0;
  const conf = clamp01(metric.n / (2 * minOf(def.minKey)));
  // DI-963 / PF-520, exactly the server's rule (lane 7's 0062 rule (e)): a metric on the shareable list (never a team card, a private metric, cf.money or cf.cumulative), never a label its
  // holder hid, and a strategy only when its SUBJECT is the sharer (a copy-a-member strategy is the sharer's; the member copied is id2, which never makes it theirs to share)
  const shareable = !isTeam && !def.private && SHARE_METRIC_IDS.includes(metric.id) && !(metric.id.startsWith('lbl.') && metric.value.hidden) && (def.family !== 'strategy' || sub.id === viewer);
  const actionability = metric.supportTotal > 0 || personal === 1 || shareable || isTeam ? 1 : 0;
  const noveltyKey = [metric.id, subjectId, id2 || '', asOfToken].join('|');
  const metricSubject = metric.id + '|' + subjectId;
  let repetition = 0;
  for (const r of ctx.ring || []) {
    if (r.noveltyKey === noveltyKey && ctx.now - r.at <= DAY) repetition = Math.max(repetition, REPEAT.sameKey24h);
    else if (r.metricSubject === metricSubject && ctx.now - r.at <= 3 * HOUR) repetition = Math.max(repetition, REPEAT.sameMetricSubject3h);
  }
  const magnitude = magnitudeOf(m);
  const interestingness = scoreOf({ magnitude, personal, social, timeliness, resonance, confidence: conf, actionability }, repetition);
  const eventTime = isGame ? (slice.gameById.get(gameId)?.kickoffMs ?? slice.asOf.throughKickoffMs) : isTeam ? lastGameMs : slice.asOf.throughKickoffMs;
  const family = def.family;
  const kind = KIND_BY_FAMILY[family];
  const memberIds = isTeam ? [] : Array.from(who).sort();
  const rivalry = !!(v.teams && v.teams.some((t) => t.rivalry)) || metric.id === 'sit.rivalry' || metric.id === 'lbl.rivalry_expert';
  const ledgerOk = !isBlocked(ctx.ledger, factOf({ id, metricIds: [metric.id], metrics: [metric] }), ctx.now);      // the no-repeat ledger (DI-1062): true when this fact was not already shown, or changed materially
  const sampleOk = def.minKey ? metric.n >= minOf(def.minKey) : true;
  return Object.freeze({
    id, v: INSIGHT_V, kind, metricIds: [metric.id], family,
    subject: sub, scope: metric.scope,
    prov: { leagueId: slice.leagueId, leagueName: slice.input.leagueName, sport: slice.sport },
    interestingness, noveltyKey, metricSubject, clusterKey: isTeam ? 'team:' + sub.id + '|' + slice.asOf.weekId : slice.leagueId + '|' + family + '|' + subjectId,       // DI-1090: a team card and a D1 matchup preview of the same team share a key, Home shows the better one
    tier: 'discretionary',
    eventRef: isGame ? { gameId } : { weekId: slice.asOf.weekId },
    eventTime: eventTime || ctx.now,
    expiresAt: kind === 'insight.history' ? ctx.now + WEEK_MS : (eventTime || ctx.now) + FOURTEEN_DAYS,
    shareable: shareable && id.length <= SHARE_ID_MAX,
    support: metric.support, supportTotal: metric.supportTotal, metrics: [metric],
    sampleOk, ledgerOk,
    reason: follow ? follow.reason : null, reasonChip: follow ? REASON_CHIPS[follow.reason] : null,
    headline: words.headline, line: def.family === 'callback' ? words.line : withSoFar(words.line, isThin(metric.n, minOf(def.minKey))),      // a quoted memory is never altered
    sample: isTeam ? teamCaption(metric) : sampleCaption(metric.n, slice.sport, slice.season),      // (batch 1 left this key inside the comment above, so no candidate carried a sample: found and fixed in batch 2)
    teamKeys: Array.from(new Set(teamKeys)).sort(), memberIds,
    components: { magnitude, personal, social, timeliness, resonance, confidence: conf, actionability }, repetition,
    social: { disagreement: sub.kind === 'pair' && (metric.id === 'pair.disagreement_record' || metric.id === 'pair.split_team'), loneBacker: metric.id === 'cons.lone_correct', rivalry },
    involvesViewerPick: !!viewer && (metric.support || []).some((r) => r.memberId === viewer),
    involvesViewerMember: !!viewer && memberIds.includes(viewer),
  });
}

/** emission: floor, cluster (best per clusterKey), per-subject cap, per-league cap; deterministic order (score desc, eventTime asc, id) */
export function selectCandidates(list) {
  const order = (a, b) => (b.interestingness - a.interestingness) || (a.eventTime - b.eventTime) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const eligible = list.filter((c) => c.interestingness >= EMIT_FLOOR).sort(order);
  const byCluster = new Set();
  const bySubject = new Map();
  const teamPerSport = new Map();
  const out = [];
  for (const c of eligible) {
    if (byCluster.has(c.clusterKey)) continue;
    const subj = c.subject.kind === 'league' ? 'league' : c.subject.id;
    if ((bySubject.get(subj) || 0) >= CAPS.perSubject) continue;
    if (c.kind === 'insight.team') { const sp = c.prov.sport; if ((teamPerSport.get(sp) || 0) >= CAPS.teamPerSport) continue; teamPerSport.set(sp, (teamPerSport.get(sp) || 0) + 1); }     // DI-1085: at most 2 team cards per refresh per sport
    byCluster.add(c.clusterKey);
    bySubject.set(subj, (bySubject.get(subj) || 0) + 1);
    out.push(c);
    if (out.length >= CAPS.perLeague) break;
  }
  return out;
}

// ---- lane B's closed shape (DI-999 interface 1) -------------------------------------------------------------------------
export const HOME_CANDIDATE_KEYS = Object.freeze(['id', 'family', 'kind', 'prov', 'sport', 'teamKeys', 'eventRef', 'eventTime', 'expiresAt', 'tier', 'involvesViewer', 'leagues', 'sourceRank', 'social', 'insight', 'clusterKey']);

/** Map a candidate to lane B's `HomeCandidate` (DI-829). NO free text crosses: headline, line and sample stay with the card. */
export function fromInsight(c) {
  if (!c || typeof c !== 'object' || !INSIGHT_KINDS.includes(c.kind)) return null;
  return Object.freeze({
    id: c.id,
    family: 'league',
    kind: c.kind,
    prov: { leagueId: c.prov.leagueId, leagueName: c.prov.leagueName, sport: c.prov.sport },
    sport: c.prov.sport,
    teamKeys: [...c.teamKeys],
    eventRef: c.eventRef ? { ...c.eventRef } : null,
    eventTime: c.eventTime,
    expiresAt: c.expiresAt,
    tier: 'discretionary',
    involvesViewer: { pick: !!c.involvesViewerPick, team: c.kind === 'insight.team' && !!c.reason, alma: c.kind === 'insight.team' && c.reason === 'alma', member: !!c.involvesViewerMember },     // a followed-team card says why (DI-1085); lane B fills the rest from its own signals
    leagues: [c.prov.leagueId],
    sourceRank: null,
    social: { disagreement: !!c.social.disagreement, loneBacker: !!c.social.loneBacker, rivalry: !!c.social.rivalry },
    insight: { interestingness: c.interestingness, noveltyKey: c.noveltyKey, metricId: c.metricIds[0], sampleOk: c.sampleOk === true, ledgerOk: c.ledgerOk === true, reason: c.reason || null },      // lane 3's insightQualityOk() reads exactly sampleOk and ledgerOk (js/analytics-adapter.js INSIGHT_QUALITY)
    clusterKey: c.clusterKey,
  });
}

/** the closed-shape validator (lane B's ranker drops and counts an unknown key; this throws so a builder sees it) */
export function assertClosedHomeCandidate(h) {
  const extra = Object.keys(h).filter((k) => !HOME_CANDIDATE_KEYS.includes(k));
  if (extra.length) throw new Error('analytics: Home candidate has unknown key ' + extra.join(','));
  for (const k of HOME_CANDIDATE_KEYS) if (!(k in h)) throw new Error('analytics: Home candidate is missing ' + k);
  return h;
}

/** Recompute the candidate an id names, from THIS input, or null (not available). The id's league must equal the input's. */
export function insightFromId(input, id, ctx = {}) {
  const p = parseInsightId(id);
  if (!p || p.leagueId !== input.leagueId) return null;
  let def;
  try { def = getDef(p.metricId); } catch { return null; }
  // the same class gate runMetric applies (F-6): a final-week metric is never recomputed over a public-game input, which holds live-week data
  if (input.cls === 'public-game' && def.reveal === 'final-week') return null;
  const scope = scopesOf(input).find((s) => s.sport === p.sportCode && s.season === p.season);
  if (!scope) return null;
  let asOfWeek = p.asOf;
  const g = input.games.find((x) => x.gameId === p.asOf);
  if (g) asOfWeek = g.weekId;
  // a team fact is true as of its last finished game's DATE, not a week: its slice is the league's latest, and the recomputed id must equal the asked one (a newer game makes the old id unavailable)
  const slice = def.level === 'team' ? sliceOf(input, { competitionId: scope.competitionId, season: scope.season }) : sliceOf(input, { competitionId: scope.competitionId, season: scope.season, throughWeekId: asOfWeek });
  if (!slice) return null;
  const params = paramsFromId(def, p, slice);
  if (!params) return null;
  let m;
  try { m = def.run(slice, params); } catch { return null; }
  if (!isAvailable(m)) return null;
  const cand = candidateFor(m, { ...ctx, slice, now: ctx.now ?? 0, nameOf: ctx.nameOf || ((x) => x), gameLabel: ctx.gameLabel || ((x) => x) });
  return cand && cand.id === id ? cand : null;
}

function paramsFromId(def, p, slice) {
  const team = () => { for (const g of slice.games) { for (const k of [g.homeKey, g.awayKey]) if (slug(k) === p.id2) return k; } return null; };
  switch (def.level) {
    case 'league': return {};
    case 'team': { const row = slice.input.teamFacts.find((r) => r.sport === slice.sport && slug(r.teamKey) === p.subjectId); return row ? { teamKey: row.teamKey } : null; }
    case 'game': return { gameId: p.subjectId };
    case 'pair': return p.id2 ? { a: p.subjectId, b: p.id2, memberId: p.subjectId, copyId: p.id2 } : null;
    case 'member': { if (!p.id2) return { memberId: p.subjectId }; const t = team(); return t ? { memberId: p.subjectId, teamKey: t } : null; }
    default: return null;
  }
}
