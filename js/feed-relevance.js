/**
 * CFB Pickems — js/feed-relevance.js (D1 Lane C, DI-668 / UN-480 / PF-480, 2026-10-08)
 * ======================================================================================
 * RELEVANCE DECIDES WHAT IS ELIGIBLE; TIME ALONE DECIDES THE ORDER. Pure: no DOM, no storage, no clock of its own (`now` is a parameter), no network. Its one import is the
 * shared team matcher (js/team-match.js), so "Texas" never claims "Texas A&M" here either.
 *
 *   eligibleCards(cards, ctx) -> the Home content cards to show, each with its private `reason` pill and `relevanceTier`, newest first.
 *
 * TIERS (the closed NEWS_CARD_REASONS set; no free text reaches a pill):
 *   1 "Your pick"              a team the viewer picked this week (ownPickTeamNames()'s fail-closed output: a signed-out viewer or another player's pick yields none)
 *   2 "In this week's slate"   a team in the league's published slate
 *   3 "Your alma mater" / "Your team"   the viewer's alma mater / a News-settings team chip
 *   4 the sport label          a followed sport
 * ELIGIBILITY WINDOWS: previews until kickoff (the card's own `eligibleUntil`, which the transport sets from the server's expiry); spotlights 72 hours after their game;
 * callbacks are not here (they live on the "A year ago" card). Storylines and news keep their own rules (js/newsFeed.js, js/home.js).
 * INCLUSION when more are eligible than the feed holds (CONTENT_FEED_MAX = 40): keep by tier ascending, then UNSEEN first, then newest; then RE-SORT the kept set strictly
 * newest-first (FB-010: relevance never reorders).
 * QUIET DAY: the server only builds previews for games inside 72 hours and spotlights for the last slate day, so the "widen to the next 72 hours" rule is the server's
 * subject window; with nothing eligible, Home shows its honest empty state, never filler.
 *
 * PRIVATE BY CONSTRUCTION: the reason is computed here, on the viewer's device, from the viewer's own picks; it is never stored, sent or shared (the share and "Talk about
 * it" builders in js/content-card.js never read it). HONEST LIMIT: NFL teams cannot be followed individually yet (the News settings hint says so), so NFL relevance is
 * sport-level plus the slate plus the viewer's own picks.
 */

import { teamKeySetMatches } from './team-match.js';

export const CONTENT_FEED_MAX = 40;
export const SPOTLIGHT_ELIGIBLE_MS = 72 * 60 * 60 * 1000;
export const CONTENT_KINDS = Object.freeze(['matchup.preview', 'player.preview', 'spotlight']);
const REASON_PICK = 'Your pick';
const REASON_SLATE = "In this week's slate";
const REASON_ALMA = 'Your alma mater';
const REASON_HOME = 'Your team';
const SPORT_LABELS = Object.freeze({ cfb: 'CFB', nfl: 'NFL' });

const asArray = (v) => (Array.isArray(v) ? v : []);
const ms = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? t : NaN; };

/**
 * @param {object[]} cards normalized content items (js/newsTransport.js normalizeContentRow): `{ id, cardKind, sport, teamKeys, publishedAt, eligibleUntil }`
 * @param {{ slateTeams?: string[], ownPickTeams?: string[], slateTeamsBySport?: object, ownPickTeamsBySport?: object, almaMaterTeams?: string[], homeTeams?: string[],
 *            enabledSports?: string[], seenIds?: Set<string>|string[], seenBefore?: number|null, now: number, max?: number }} ctx
 *   slateTeamsBySport / ownPickTeamsBySport (review B2): `{ cfb: [...], nfl: [...] }` — in a league that plays both, a card matches the slate and the picks of ITS OWN sport
 *     only (the flat lists stay the fallback for a caller that has one sport).
 *   seenBefore (review B4): Home's visit baseline (DI-587). A card published at or before it was there on the reader's last visit (seen); one published after it is UNSEEN.
 *     null / absent = no honest comparison, so every card counts unseen (no fake "new").
 * @returns {object[]} NEW objects (the inputs are never mutated), each with `reason` and `relevanceTier`, newest first.
 */
export function eligibleCards(cards, ctx = {}) {
  const now = Number(ctx.now);
  if (!Number.isFinite(now)) return [];
  const sports = asArray(ctx.enabledSports);
  const seen = ctx.seenIds instanceof Set ? ctx.seenIds : new Set(asArray(ctx.seenIds));
  const seenBefore = Number.isFinite(ctx.seenBefore) ? ctx.seenBefore : null;
  const groupFor = (bySport, flat, sport) => (bySport && typeof bySport === 'object' && !Array.isArray(bySport) ? asArray(bySport[sport]) : flat);
  const max = Number.isInteger(ctx.max) && ctx.max > 0 ? ctx.max : CONTENT_FEED_MAX;
  const out = [];
  const ids = new Set();
  for (const c of asArray(cards)) {
    if (!c || typeof c !== 'object' || typeof c.id !== 'string' || ids.has(c.id) || CONTENT_KINDS.indexOf(c.cardKind) < 0) continue;
    const pub = ms(c.publishedAt);
    if (!Number.isFinite(pub) || pub > now + 5 * 60 * 1000) continue;
    const until = ms(c.eligibleUntil);
    if (!Number.isFinite(until) || until <= now) continue;                                     // a preview until kickoff; a spotlight its 72 hours
    if (c.cardKind === 'spotlight' && now - pub > SPOTLIGHT_ELIGIBLE_MS) continue;
    const keys = asArray(c.teamKeys);
    let tier = null, reason = null;
    if (teamKeySetMatches(keys, groupFor(ctx.ownPickTeamsBySport, ctx.ownPickTeams, c.sport)).length) { tier = 1; reason = REASON_PICK; }
    else if (teamKeySetMatches(keys, groupFor(ctx.slateTeamsBySport, ctx.slateTeams, c.sport)).length) { tier = 2; reason = REASON_SLATE; }
    else if (teamKeySetMatches(keys, ctx.almaMaterTeams).length) { tier = 3; reason = REASON_ALMA; }
    else if (teamKeySetMatches(keys, ctx.homeTeams).length) { tier = 3; reason = REASON_HOME; }
    else if (sports.indexOf(c.sport) >= 0 && Object.prototype.hasOwnProperty.call(SPORT_LABELS, c.sport)) { tier = 4; reason = SPORT_LABELS[c.sport]; }
    if (tier === null) continue;                                                                // not about anything this viewer follows: not eligible
    ids.add(c.id);
    out.push({ ...c, reason, relevanceTier: tier, _seen: seen.has(c.id) || (seenBefore !== null && pub <= seenBefore), _t: pub });
  }
  // keep: tier ascending, then unseen first, then newest
  const kept = out.slice().sort((a, b) => (a.relevanceTier - b.relevanceTier) || ((a._seen ? 1 : 0) - (b._seen ? 1 : 0)) || (b._t - a._t) || (a.id < b.id ? -1 : 1)).slice(0, max);
  // order: time alone
  kept.sort((a, b) => (b._t - a._t) || (a.id < b.id ? -1 : 1));
  return kept.map(({ _seen, _t, ...c }) => c);
}
