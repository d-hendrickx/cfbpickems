/**
 * CFB Pickems — Sport Profile: NFL (`nfl`)
 * ========================================
 * Thread "091926-MULTISPORT", Phase 0, DI-219 (AD-73 PROPOSED, UN-220).
 *
 * Same rules as cfb.js (read that header): key is the dbCode, label/code/path
 * are read FROM `ESPN_SPORT_ENDPOINTS`, imports only `../data-model.js`, never
 * app.js, deeply frozen.
 *
 * WHAT IS FILLED vs `null`. Only what today's code already does for an NFL
 * week: the label/code/path, spread as the one market, and
 * no `groups` param (buildEspnUrl() sends it for college-football only).
 * Everything the matrix RECOMMENDS for NFL (division groupings, Monday-night
 * total tiebreaker, favorite-team/hometown affinity, prime-time multiplier,
 * 8-10 game slate) is NOT a legacy constant, so it is `null` here and is
 * supplied by DI-228's values pass. `null` means "defer to legacy behavior":
 * today an NFL week uses createWeek()'s tiebreaker defaults and
 * buildSuggestedSlate()'s default size exactly like a CFB week, and a consumer
 * that falls back on `null` preserves that.
 */

import { ESPN_SPORT_ENDPOINTS } from '../data-model.js';

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
    summaryPath: null,                     // extra-point.js's summary root is CFB-only today
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

  affinity:          null,   // DI-226/228 (favorite team / hometown)
  groupings:         null,   // R6
  rankings:          null,   // NFL payloads carry no curatedRank; DI-228: none
  slate:             null,   // DI-228: 8-10
  sideContest:       null,
  tiebreakerDefault: null,   // DI-228: MNF total points
  liveDecorators:    null,
  teamAbbr:          null,
  scribeVocab:       null,
  deepLink:          null,

  // F9's slots (hockey only): shape fixed here, content owned by HOCKEY.
  primaryMarkets:    null,
  periodQuestion:    null,
});
