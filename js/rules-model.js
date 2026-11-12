/**
 * CFB Pickems - rules-model.js (D2 lane 2, DI-903 to DI-909; UN-514 / PF-514; RPF-C4)
 * =====================================================================================
 * THE RULES, AS DATA, ONCE. The Rules tab's cards, the Picks page's "How this slate works" sheet, the onboarding summary lines, the notification copy and the analytics provenance all
 * read the descriptor `ruleSetOf()` returns, so two surfaces cannot state two different lock offsets (CONVENTIONS #21: one source, no second copy). A PURE LEAF: it imports only the
 * sport registry (js/sports/index.js) and the data-model constants, reads no storage, no DOM and no clock, and an Edge Function can import it.
 *
 *   ruleSetOf({ sport, format, week })      -> the frozen descriptor { key 'nhl:moneyline:v1', sport, format, v, pick, scoring, lock, reveal, tiebreak, unplayed, finalization, standings, obligations }
 *   ruleSetKeyForWeek({ sport, format })    -> 'cfb:ats:v1' ... : what a week with NO stamp is derived as (every football week that exists today), so old weeks need no migration
 *   RULES_TABLE                             -> the formal table, sport by format (DI-904), each row naming the code that implements it
 *   sportRulesItems({ profile, format, weeklyPrize, collegeToo })  -> the bullets of a sport's Rules card (NHL, and the NFL's pick-the-winner variant); the NFL spread card stays js/sport-rules.js
 *   rulesSummaryFor(profile, format, { role, lockOffsetMinutes })  -> the four short lines for onboarding and the "How this slate works" sheet
 *   howThisSlateWorks({ profile, format, lockText })               -> { title, lines, lockLine, linkText }: the sheet's content
 *   lifecycleWords(formatsInPlay)           -> the two phrases the Rules lifecycle card says about picks and grading, per the formats a league plays (all-spread = today's words, byte for byte)
 *
 * VERSION RULE (DI-903): any change to what a rule DOES (scoring, lock, tiebreak, void) bumps `RULES_VERSION` for that sport-format and adds a golden in rulesmodeltest; a copy-only change
 * does not. Analytics must not pool different `key`s unless a metric is declared rule-independent in its own definition.
 */

import { getProfile, sportCopy } from './sports/index.js';
import { getAutoLockOffsetMinutes, TIEBREAKER_TYPE, DEFAULT_RULES } from './data-model.js';

export const RULES_VERSION = 1;

/**
 * Voiding a postponed or cancelled game (RPF-C2, DI-896; Drew round 5, 2026-10-19) IS built (js/void-game.js): picks are kept and score nobody, by the commissioner's prompt, never automatic. Every card says both
 * ways a game can leave a slate (R-12): voided (picks kept) or removed (picks deleted).
 */
export const GAME_VOID_BUILT = true;

const FORMATS = Object.freeze(['ats', 'moneyline']);
const isFormat = (f) => FORMATS.includes(f);

function profileOf(sport) {
  try { return getProfile(sport); } catch { return null; }
}

/** 'cfb:ats:v1': the rule-set key. A format a sport does not offer still yields a key (the caller validates); an unknown format reads as 'ats'. */
export function ruleSetKeyForWeek({ sport = 'cfb', format = 'ats' } = {}) {
  return `${sport}:${isFormat(format) ? format : 'ats'}:v${RULES_VERSION}`;
}

/**
 * Review 4 (G12): the fields a NEW week is stamped with when the wizard creates it: its pick format, its rule-set key, and (DI-905 / R-8) the DESIGNATED-GAME tiebreaker for a COLLEGE week in a league with NO claimed
 * alma maters. A league WITH claimed alma maters (IRB) keeps its own tiebreaker unchanged: the designated game is never given to it. `claimedCount` is how many alma maters are claimed.
 */
export function wizardStampFields({ profile, format, claimedCount = 0 } = {}) {
  const key = profile && profile.key;
  return { format, rules: { key: ruleSetKeyForWeek({ sport: key, format }), v: 1 }, ...(key === 'cfb' && claimedCount === 0 ? { designatedTiebreaker: true } : {}) };
}

/**
 * The rule-set descriptor for a sport, format and (optionally) a week (whose own lock offset it reads). Frozen. An unknown sport THROWS the registry's UnknownSportError (nothing defaults
 * silently, DI-924).
 */
export function ruleSetOf({ sport = 'cfb', format = 'ats', week = null } = {}) {
  const profile = getProfile(sport);
  const fmt = isFormat(format) ? format : 'ats';
  const pickWinner = fmt === 'moneyline';
  const isCollege = !!profile.affinity;               // the alma-mater tie step exists only where the profile has an affinity
  const hasSide = !!profile.sideContest || isCollege;  // the Extra Point (college) or the optional longest field goal (NFL)
  const offset = week ? getAutoLockOffsetMinutes(week) : 30;
  return Object.freeze({
    key: ruleSetKeyForWeek({ sport, format: fmt }),
    sport, format: fmt, v: RULES_VERSION,
    pick: Object.freeze({ type: pickWinner ? 'winner' : 'spread', market: pickWinner ? 'moneyline' : 'spread' }),
    scoring: Object.freeze({ perCorrect: 1, multiplier: true, push: profile.tiesPossible === false ? 'none' : 'no_decision' }),
    lock: Object.freeze({ basis: 'first-start', offsetMinutes: offset, perGameClose: true }),
    reveal: 'first-start',
    tiebreak: Object.freeze({
      s2: isCollege ? 'alma-total' : 'designated-game-total',
      s3: isCollege,
      s4: hasSide,
      s5: 'draw',
    }),
    unplayed: GAME_VOID_BUILT ? 'void' : 'remove',
    finalization: 'all-settled',
    standings: 'per-sport',
    obligations: profile.slate && profile.slate.unit === 'night' ? 'per-slate' : 'per-week',
    tiebreakerType: isCollege ? TIEBREAKER_TYPE.ALMA_MATER_TOTAL : TIEBREAKER_TYPE.CUSTOM,
  });
}

/** The formal table (DI-904 / section 9.1), rule by rule, naming the code that implements each row. A test pins every `where` to a real symbol so a reader can check a rule against the behaviour. */
export const RULES_TABLE = Object.freeze([
  Object.freeze({ rule: 'Pick', where: ['js/scoring.js:calculateAtsWinner', 'js/formats.js'] }),
  Object.freeze({ rule: 'Slate', where: ['js/slate-add.js:slateAddDecision', 'js/sports/nhl.js'] }),
  Object.freeze({ rule: 'Scoring', where: ['js/scoring.js:evaluatePick', 'js/scoring.js:pointsForResult', 'js/scoring.js:gameMultiplier'] }),
  Object.freeze({ rule: 'Lock', where: ['js/scoring.js:computeEffectiveLockAt', 'js/data-model.js:getAutoLockOffsetMinutes'] }),
  Object.freeze({ rule: 'Reveal', where: ['js/chat-ui.js:emitPickRevealEvent'] }),
  Object.freeze({ rule: 'Tiebreaker (step 2)', where: ['js/live-tiebreak.js', 'js/scoring.js:calculateWeeklyResults'] }),
  Object.freeze({ rule: 'Tie steps after step 2', where: ['js/tie-context.js:TIE_STAGES'] }),
  Object.freeze({ rule: 'Postponed or cancelled game', where: ['js/slate-add.js:removeGameFromSlate'] }),
  Object.freeze({ rule: 'Finalization', where: ['js/week-wizard.js:confirmFinalizeWeek'] }),
  Object.freeze({ rule: 'Standings and prizes', where: ['js/scoring.js:calculateSeasonStandings'] }),
  Object.freeze({ rule: 'Commissioner overrides', where: ['js/week-wizard.js:LATE_ENTRY_COPY'] }),
  Object.freeze({ rule: 'Side contests and extras', where: ['js/extra-point.js'] }),
]);

// ── words ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** "6" or "4 to 8": the slate size as a card says it. */
function sizeText(profile) {
  const s = (profile && profile.slate) || {};
  const lo = Number.isFinite(s.minSize) ? s.minSize : s.size;
  const hi = Number.isFinite(s.maxSize) ? s.maxSize : s.size;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return '';
  return lo === hi ? String(lo) : `${lo} to ${hi}`;
}

function prizeLine(weeklyPrize) {
  const t = typeof weeklyPrize === 'string' ? weeklyPrize.trim().replace(/[.\s]+$/, '') : '';
  return t ? `Weekly prize: ${t}.` : '';
}

/**
 * The bullets of a sport's Rules card, plain text (the caller escapes each). Generated from the profile and the format; every number is read from the profile and the prize line from the league
 * setting. Covers the NHL (both formats) and the NFL's pick-the-winner variant; the NFL's spread card is js/sport-rules.js `nflRulesItems` (byte-identical to the shipped card, corrected R-7/R-12).
 */
export function sportRulesItems({ profile, format = 'ats', weeklyPrize = '', collegeToo = false } = {}) {
  if (!profile) return [];
  const pickWinner = format === 'moneyline';
  const copy = sportCopy(profile);
  const start = copy.start.toLowerCase();
  const items = [];
  if (profile.key === 'nhl') {
    const size = profile.slate.size;
    items.push(`Each night, the Commissioner picks the NHL games for the slate, usually ${size} (${sizeText(profile)}).`);
    items.push(pickWinner
      ? 'You pick the winner of each game. Overtime and shootout wins count.'
      : 'You pick which team covers the puck line (1.5 goals). A favorite must win by two; an underdog can lose by one.');
    items.push(`Picks lock before the first ${start} of the slate, usually 30 minutes before, at the time shown on the Picks page.`);
    items.push('Correct pick = 1 point. Incorrect = 0. '
      + (GAME_VOID_BUILT ? 'A game that is voided scores nobody. ' : '')
      + 'Most correct picks wins the slate.');
    items.push('Tiebreaker: the total goals scored in the slate\'s last game. Closest guess wins, over or under. A shootout win counts as one goal for the winner, as ESPN reports the score. If still tied, a fixed draw settles it, the same on every phone.');
    items.push('There is no alma-mater step and no side contest in the NHL.');
    items.push(GAME_VOID_BUILT
      ? 'A game that is postponed or cancelled is voided by the Commissioner. Nobody wins or loses on it and your pick is kept.'
      : 'A game that is postponed or cancelled is removed from the slate by the Commissioner, and the picks made on it are deleted.');
    items.push('If ESPN corrects a score after the slate is final, the Commissioner can correct the slate.');
    items.push('NHL has its own slate winners and standings; they never combine with football.');
  } else if (profile.key === 'nfl') {
    const size = sizeText(profile);
    items.push(`Each week, the Commissioner selects ${size} NFL games for the slate.`);
    items.push('You pick the winner of each game outright.');
    items.push('NFL picks lock before the first kickoff of the NFL slate, usually 30 minutes before, at the time shown on the NFL Picks page.' + (collegeToo ? ' NFL and college football lock separately.' : ''));
    items.push('Correct pick = 1 point. Incorrect = 0. A game that ends tied = No Decision (0 points). Most correct picks wins the week.');
    items.push('Tiebreaker: the total combined points in the tiebreaker game, usually Monday night. Closest guess wins, over or under. If still tied, a fixed draw settles it, the same on every phone.');
    items.push(GAME_VOID_BUILT
      ? 'A game that is cancelled or postponed out of the week is voided: nobody wins or loses on it and your pick is kept, or the Commissioner removes it and the picks made on it are deleted.'
      : 'A game that is cancelled or postponed out of the week is removed from the slate, and the picks made on it are deleted.');
    items.push('If ESPN corrects a score after the week is final, the Commissioner can correct the week.');
    if (collegeToo) items.push('NFL has its own weekly winner and standings; they never combine with college football.');
  } else {
    return [];
  }
  const prize = prizeLine(weeklyPrize);
  if (prize) items.push(prize);
  return items;
}

/**
 * The four short lines (how you pick, how a point is scored, when picks lock, how ties are settled) for the onboarding card and the "How this slate works" sheet, one source.
 * `role` 'commissioner' adds the line that says where the format is chosen. Plain text.
 */
export function rulesSummaryFor(profile, format = 'ats', { role = 'member', lockOffsetMinutes = 30 } = {}) {
  const copy = sportCopy(profile);
  const pickWinner = format === 'moneyline';
  const lines = [];
  if (pickWinner) lines.push('Pick the winner of each game.');
  else lines.push(profile && profile.key === 'nhl' ? 'Pick the team you think covers the puck line.' : 'Pick the team you think covers the spread.');
  lines.push('A correct pick is 1 point.');
  const off = Number.isFinite(lockOffsetMinutes) && lockOffsetMinutes >= 0 ? Math.round(lockOffsetMinutes) : 30;
  lines.push(`Picks lock ${off} minutes before the first ${copy.start.toLowerCase()}.`);
  lines.push('Ties go to the closest tiebreaker guess.');
  if (role === 'commissioner') lines.push('You choose the format in League > Sports.');
  return lines;
}

/**
 * The "How this slate works" sheet (DI-907). `lockText` is the slate's lock time already formatted in the VIEWER's zone by the caller (CONVENTIONS #19), or '' when the slate has none yet.
 * The sheet states the same four lines the onboarding card does, then the lock time, then the link that opens the Rules tab at the sport's card.
 */
export function howThisSlateWorks({ profile, format = 'ats', lockText = '', lockOffsetMinutes = 30 } = {}) {
  const copy = sportCopy(profile);
  const lines = rulesSummaryFor(profile, format, { role: 'member', lockOffsetMinutes });
  if (profile && profile.key === 'nhl') lines[3] = 'Ties go to the closest tiebreaker guess (total goals in the last game), then a fixed draw.';
  const label = profile && profile.label ? profile.label : '';
  return {
    title: 'How this slate works',
    lines,
    lockLine: lockText ? `Picks lock ${lockText}, ${Number.isFinite(lockOffsetMinutes) ? Math.round(lockOffsetMinutes) : 30} minutes before the first ${copy.start.toLowerCase()}.` : '',
    linkText: label ? `Read all the ${label} rules` : 'Read all the rules',
  };
}

/**
 * The two phrases the Rules lifecycle card says (R-9): what "OPEN" asks you to pick, and what grading means. `formatsInPlay` is the formats of the sports the league plays.
 * A league that plays only against-the-spread sports gets TODAY'S words, byte for byte (IRB's page); a league whose every sport is pick-the-winner gets the winner words; a mix says each
 * sport's own rule governs.
 */
export function lifecycleWords(formatsInPlay) {
  const set = new Set((Array.isArray(formatsInPlay) ? formatsInPlay : []).filter(isFormat));
  const anyAts = set.size === 0 || set.has('ats');
  const anyWin = set.has('moneyline');
  if (anyAts && !anyWin) return { pick: 'pick all games against the spread', graded: 'ATS results are locked against the closing spread' };
  if (anyWin && !anyAts) return { pick: 'pick the winner of every game', graded: 'Results are graded on the final score' };
  return { pick: 'pick every game the way its sport\'s rules below say', graded: 'Results are graded the way each sport\'s rules below say' };
}

// ── defaults for a league that is not the pilot (R-5, R-8; RPF-C4) ─────────────────────────────────────────────────────────────────────────────────────

/** The neutral Debts text a non-pilot league reads (the pilot's own bylaw - "settled IN PERSON only ... no Venmo" - is the pilot's, not everyone's). */
export const NEUTRAL_DEBTS_ITEMS = Object.freeze([
  'Weekly loser owes the weekly winner. Season loser owes the season winner.',
  'Settle up the way your group agrees.',
  'The ledger lives in the app. The ledger forgets nothing.',
]);

function prizeSentence(label, text, fallback) {
  const t = typeof text === 'string' ? text.trim().replace(/[.\s]+$/, '') : '';
  return t ? `${label}: ${t}.` : fallback;
}

/**
 * The default college-football rules sections for a league (what shows when the commissioner has saved no copy of their own).
 *   - the PILOT: `DEFAULT_RULES` itself (the same array: IRB's page and IRB's stored-text behaviour are byte-identical);
 *   - any other league: the same sections with (a) the Prizes lines read from the league's own prize settings (the static "consolation prize" lines are the pilot's words), and
 *     (b) when the league has NO claimed alma maters, the default tiebreaker line names the designated game's total instead of an alma-mater total that has no games (R-5).
 * Pure; never mutates DEFAULT_RULES.
 */
export function defaultRulesFor({ pilot = false, hasClaims = true, weeklyPrize = '', seasonPrize = '' } = {}) {
  if (pilot) return DEFAULT_RULES;
  return DEFAULT_RULES.map((section) => {
    if (section.id === 'r3' && !hasClaims) {
      return { ...section, items: section.items.map((i) => (i === 'Default: total combined points scored by all alma mater teams on the slate.' ? 'Default: total combined points scored in the last game of the slate.' : i)) };
    }
    if (section.id === 'r4') {
      return { ...section, items: [
        prizeSentence('Weekly prize', weeklyPrize, section.items[0]),
        prizeSentence('Season prize', seasonPrize, section.items[1]),
      ] };
    }
    return section;
  });
}
