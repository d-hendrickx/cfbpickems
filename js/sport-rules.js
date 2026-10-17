/**
 * CFB Pickems - sport-rules.js (D1, v0.30.0, thread 100726-D1, Lane A; DI-536 "The Rules page: cards come from the league's sports", DI-512 multisport clause)
 * ==============================================================================================================================================================
 * The Rules page used to be one college-football page. A league that runs the NFL too (or only) must read the NFL's rules BEFORE it joins (PM-202: "NFL rules must be explicit before
 * members enter"), and a league that does not run college football must not read college-football rules. This module is the PURE half: which sports' cards a league's page shows, and
 * the words of the NFL card. It touches no document, no storage and no clock; `renderRulesPage()` in app.js escapes every string it returns and decides where the card goes.
 *
 *   rulesSports(liveCompetitions)  -> { hasCfb, hasNfl, both }
 *       A league with no NFL competition (every league today, a local-mode device with no competition rows, a league that archived its NFL) keeps EXACTLY today's page:
 *       hasCfb is true and hasNfl false. A league with an NFL competition and a college-football one is `both` (the page opens with COLLEGE_NOTE and the NFL card follows the
 *       college cards). A league whose only live sport is the NFL (an NFL-main league, DI-551) has no college-football cards at all: the NFL card is its rules.
 *
 *   nflRulesItems({ weeklyPrize, collegeToo })  -> string[]
 *       The ten bullets of DI-536, in its order. Every number comes from the NFL profile (the slate size) or the league's settings (the weekly prize line); nothing is typed twice.
 *       `collegeToo` is whether the page ALSO carries the college-football cards: when it does, the card points at them ("the Extra Point rules above", "Weekly Ties") and says the two
 *       sports lock and score separately; when the NFL is the league's only sport those pointers would lead nowhere (the cards are not drawn), so the same rules are stated in full
 *       instead and the college wording is dropped (DI-551: an NFL-main league shows no college wording).
 *
 * The rules stated are the rules the app APPLIES (D-31: NFL is scored like college football; scoring.js is not edited):
 *   - against the spread; a correct pick is 1 point, an incorrect one 0, an exact spread tie is No Decision; most correct picks wins the week;
 *   - the tiebreaker is the total combined points of the designated game (default: the last kickoff on the slate), closest wins, over or under;
 *   - then the Weekly Ties steps: the alma-mater step does not apply to the NFL (the profile has no affinity), the longest-field-goal step applies only for a week whose contest is on,
 *     then the seeded draw;
 *   - the longest field goal is OPTIONAL per week (profile.sideContest.optional) and never changes the correct-pick count;
 *   - the lock is per competition (DI-514), so the NFL and college football lock separately.
 */

import { getProfile } from './sports/index.js';

/** DI-512: the line a two-sport league's Rules page opens with. */
export const RULES_COLLEGE_NOTE = 'These rules are for college football. NFL rules are below.';

/** The heading of the NFL card (no emoji: the Weekly Ties card set that precedent, and the icon inventory is D-1's). */
export const NFL_RULES_HEADING = 'NFL rules';

/**
 * Which sports' cards a league's Rules page shows. `liveCompetitions` are the league's non-archived competitions (`[{ sport }]`).
 * @returns {{ hasCfb: boolean, hasNfl: boolean, both: boolean }}
 */
export function rulesSports(liveCompetitions) {
  const live = (Array.isArray(liveCompetitions) ? liveCompetitions : []).filter((c) => c && typeof c.sport === 'string' && !c.archivedAt);
  const hasNfl = live.some((c) => c.sport === 'nfl');
  // No NFL: today's page, whatever else the league runs. NFL present: the college cards stay only if a college-football competition is live too.
  const hasCfb = !hasNfl || live.some((c) => c.sport === 'cfb');
  return { hasCfb, hasNfl, both: hasCfb && hasNfl };
}

/** "8 to 10" from the profile's slate; one number when the two ends are equal. */
export function nflSlateSizeText(profile = getProfile('nfl')) {
  const s = (profile && profile.slate) || {};
  const lo = Number.isFinite(s.minSize) ? s.minSize : s.size;
  const hi = Number.isFinite(s.maxSize) ? s.maxSize : s.size;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return '';
  return lo === hi ? String(lo) : `${lo} to ${hi}`;
}

/** The weekly-prize clause from the league's setting: no doubled full stop, nothing when the setting is empty. */
function weeklyPrizeLine(weeklyPrize) {
  const t = typeof weeklyPrize === 'string' ? weeklyPrize.trim().replace(/[.\s]+$/, '') : '';
  return t ? `Weekly prize: ${t}.` : '';
}

/**
 * The NFL card's bullets, plain text (the caller escapes). See the header for `collegeToo`.
 * @param {{ weeklyPrize?: string, collegeToo?: boolean }} [opts]
 * @returns {string[]}
 */
export function nflRulesItems({ weeklyPrize = '', collegeToo = false } = {}) {
  const profile = getProfile('nfl');
  const size = nflSlateSizeText(profile);
  const optional = !profile.sideContest || profile.sideContest.optional === true;
  const items = [];
  items.push(`Each week, the Commissioner selects ${size} NFL games for the slate.`);
  items.push('You pick which team you think will cover the spread. Straight-up winners don\'t count.');
  items.push('NFL picks lock before the first kickoff of the NFL slate, usually 30 minutes before, at the time shown on the NFL Picks page.'
    + (collegeToo ? ' NFL and college football lock separately.' : ''));
  items.push('Correct pick = 1 point. Incorrect = 0. Exact spread tie = No Decision (0 points). Most correct picks wins the week.');
  items.push(collegeToo
    ? 'Tiebreaker: the total combined points in the tiebreaker game, usually Monday night. Closest guess wins, over or under. If still tied, Weekly Ties settles it; the alma-mater step does not apply to the NFL.'
    : 'Tiebreaker: the total combined points in the tiebreaker game, usually Monday night. Closest guess wins, over or under. If still tied, the longest-field-goal guess settles it in a week where that side bet is on, and then a fixed draw, the same on every phone.');
  if (optional) {
    items.push(collegeToo
      ? 'Optional: some weeks the Commissioner turns on the longest-field-goal side bet (the Extra Point rules above). It never changes anyone\'s correct-pick count; it only comes into play in Weekly Ties.'
      : 'Optional: some weeks the Commissioner turns on the longest-field-goal side bet: guess the longest made field goal on the slate, in yards, closest without going over. It never changes anyone\'s correct-pick count; it only comes into play when players are still tied after the tiebreaker.');
  }
  items.push('A game that is cancelled or postponed out of the week is removed from the slate and counts for nobody.');
  items.push('If ESPN corrects a score after the week is final, the Commissioner can correct the week.');
  if (collegeToo) items.push('NFL has its own weekly winner and standings; they never combine with college football.');
  const prize = weeklyPrizeLine(weeklyPrize);
  if (prize) items.push(prize);
  return items;
}
