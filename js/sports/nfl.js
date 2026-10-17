/**
 * CFB Pickems — Sport Profile: NFL (`nfl`)
 * ========================================
 * Thread "091926-MULTISPORT", Phase 0, DI-219 (AD-73 PROPOSED, UN-220).
 *
 * Same rules as cfb.js (read that header): key is the dbCode, label/code/path
 * are read FROM `ESPN_SPORT_ENDPOINTS`, imports only `../data-model.js`, never
 * app.js, deeply frozen.
 *
 * WHAT IS FILLED vs `null`. The label/code/path, spread as the one market, and
 * no `groups` param (buildEspnUrl() sends it for college-football only) came
 * from today's code. D1 (DI-536, Drew's ruling D-31, 2026-10-07: NFL is scored
 * like college football) FILLS the values the matrix recommended: the 8 to 10
 * game slate on Sunday and Monday, the Monday-night game's total points as the
 * tiebreaker, the OPTIONAL longest-field-goal side contest, the 32 ESPN team
 * abbreviations, and the NFL summary path the Extra Point engine reads. There
 * is NO alma-mater rule (`affinity: null`) and no rankings. Everything not
 * named by D-31 stays `null`, and profiletest.mjs pins every one of them in
 * the same change (a value never lands without its golden). Scoring math is
 * untouched: this module holds values, never scoring.
 */

import { ESPN_SPORT_ENDPOINTS, NFL_TEAM_ABBR, TIEBREAKER_TYPE, TIEBREAKER_CALC_MODE } from '../data-model.js';

// The legacy ESPN path key this profile's dbCode maps to. Not a persisted value.
const LEGACY_ESPN_KEY = 'nfl';
const ESPN = ESPN_SPORT_ENDPOINTS[LEGACY_ESPN_KEY];

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

export const NFL_PROFILE = deepFreeze({
  key:   'nfl',
  label: ESPN.label,                       // 'NFL'
  code:  ESPN.code,                        // 'NFL'
  glyphKey: 'sportFootball',               // Munera icon-family key for CHROME (D-1, DI-314)
  emoji: '🏈',                             // NON-chrome text only; never rendered in chrome
  copy:  null,

  feed: {
    provider:     'espn',
    fetchSlate:   null,
    fetchScores:  null,
    fetchSummary: null,
  },

  espn: {
    path:        ESPN.path,                // 'football/nfl'
    summaryPath: 'football/nfl/summary',   // D1: extra-point.js NFL_SUMMARY_ROOT, for the optional longest-field-goal contest
    teamsUrl:    null,                     // ABSOLUTE URL, like cfb's. The app requests NO NFL teams catalog today
                                           // (fetchEspnTeamsList() is CFB-only), so there is nothing to equal;
                                           // DI-227 probes it at build time
    groups:      null,                     // buildEspnUrl() sends no groups for non-CFB
  },

  // NO `period` slot (R5/R9): period kind derives from competition.kind (DI-223).

  // N8 (DI-439 §2, 2026-09-29) — first in-game period that is "the second half"
  // (football: Q3). An in-game period, not the excluded competition-level `period`.
  secondHalfFromPeriod: 3,

  markets: {
    allowed: ['spread'],
    default: 'spread',
    rotate:  null,
  },

  affinity:          null,   // D-31: NO alma-mater rule; Alma Mater Watch does not render for the NFL
  groupings:         null,   // R6
  rankings:          null,   // NFL payloads carry no curatedRank; DI-228: none

  // D-31 / DI-536 - eight to ten games a week, Sundays and the Monday night; the commissioner picks the count (default 10) and may add a Thursday game, which moves the lock.
  slate: {
    size:          10,
    minSize:       8,
    maxSize:       10,
    candidateSize: 16,
    weights:       null,
    anchorDays:    ['sun', 'mon'],
    timeWindow:    null,
  },

  // D-31 / DI-533 #7 / DI-229 - the OPTIONAL longest made field goal, settled by the shared Extra Point engine (js/extra-point.js) from the same scoringPlays parse the
  // college game uses, verified against a real NFL summary on 2026-10-07 (eptest [10]). Off by default for an NFL week (`optional`); the commissioner turns it on per week.
  sideContest: {
    stat:     'longestFieldGoal',
    label:    'Longest field goal',
    unit:     'yards',
    prompt:   'Guess the longest made field goal this week (yards).',
    optional: true,
    source:   'espnSummaryScoringPlays',
    sanity:   { min: 15, max: 75 },
  },

  // D-31 / DI-533 #6 - the total combined points of the tiebreaker game (default: the LAST kickoff on the slate, usually Monday night). `calcMode` stays an existing
  // CHECK value ('manual'); the designated game rides week.tiebreakerGameId. `{game}` is filled with the matchup by the wizard.
  tiebreakerDefault: {
    type:     TIEBREAKER_TYPE.CUSTOM,
    question: 'What is the total combined points scored in {game}?',
    calcMode: TIEBREAKER_CALC_MODE.MANUAL,
  },
  liveDecorators:    null,
  teamAbbr:          { ...NFL_TEAM_ABBR },
  scribeVocab:       null,
  deepLink:          null,

  // F9's slots (hockey only): shape fixed here, content owned by HOCKEY.
  primaryMarkets:    null,
  periodQuestion:    null,
});
