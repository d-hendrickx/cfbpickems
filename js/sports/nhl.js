/**
 * CFB Pickems — Sport Profile: NHL (`nhl`)
 * ========================================
 * Deployment 2, lane 2 (thread 101826-D2), DI-881 (UN-513 / PF-513, Drew's rulings D-113 / D-114, 2026-10-19: NHL model approved as recommended).
 *
 * Built exactly like nfl.js: the key is the dbCode, label / code / path are read FROM `ESPN_SPORT_ENDPOINTS`, it imports only `../data-model.js` (so an Edge Function can import it),
 * and it is deeply frozen. VALUES ONLY, never scoring: nothing in `js/scoring.js` changed for hockey. Pick the winner is graded straight up through the shipped spread arithmetic at
 * a line of 0 (DI-912 / DI-913); the puck line (+/-1.5) is the same arithmetic with the real line.
 *
 * WHAT HOCKEY IS NOT (and the slot that says so):
 *   - no alma-mater rule (`affinity: null`), no rankings, no side contest (`sideContest: null`): the tie steps after the tiebreaker are the fixed draw only.
 *   - `secondHalfFromPeriod: null`: SCRIBE's live-upset call-outs stay silent for hockey by design (js/scribe-scoring.js's table agrees).
 *   - `copy` is the FIRST filled copy slot: the words a football screen hard-codes ("Kickoff", "week", "quarter") are different in hockey. `cfb` and `nfl` keep null and
 *     `sportCopy(profile)` (js/sports/index.js) answers today's football words for a null.
 *
 * THE TEAM NAME IS ESPN's `displayName`, never `location`: "New York" is two teams. `teamAbbr` is keyed by it.
 */

import { ESPN_SPORT_ENDPOINTS, NHL_TEAM_ABBR, TIEBREAKER_TYPE, TIEBREAKER_CALC_MODE } from '../data-model.js';

const LEGACY_ESPN_KEY = 'nhl';
const ESPN = ESPN_SPORT_ENDPOINTS[LEGACY_ESPN_KEY];

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

export const NHL_PROFILE = deepFreeze({
  key:   'nhl',
  label: ESPN.label,                       // 'NHL'
  code:  ESPN.code,                        // 'NHL'
  glyphKey: 'sportHockey',                 // Munera icon-family key for CHROME (js/icons.js); drawn in this change
  emoji: '🏒',                             // written text only (chat, rules prose); never rendered in chrome
  copy: { start: 'Puck drop', slate: 'slate', slates: 'slates', scoreOne: 'goal', scoreMany: 'goals', period: 'period' },

  feed: {
    provider:     'espn',
    fetchSlate:   null,
    fetchScores:  null,
    fetchSummary: null,
  },

  espn: {
    path:        ESPN.path,                // 'hockey/nhl'
    summaryPath: null,                     // no hockey side contest reads a summary
    teamsUrl:    null,                     // the 32-team catalog is static below (teamCatalogOf); no runtime fetch
    groups:      null,                     // buildEspnUrl() sends groups for college football only
  },

  secondHalfFromPeriod: null,              // hockey: live-upset call-outs stay silent (scribe-scoring.js agrees)

  // `allowed` = what a pick can be graded on; `display` = what "Lines shown on Picks" can show (DI-918); `lineMax` is DI-883's plausibility bound on a puck line.
  markets: {
    allowed: ['moneyline', 'spread'],
    default: 'moneyline',
    rotate:  null,
    display: ['moneyline', 'spread', 'total'],
    lineMax: 3.5,
  },

  // DI-910: the formats this sport offers (default first). `ats` = against the spread (the puck line here); `moneyline` = pick the winner.
  formats: { offered: ['moneyline', 'ats'], default: 'moneyline' },

  affinity:          null,
  groupings:         null,
  rankings:          null,

  // DI-886 / DI-887, RPF-C3: one slate = one game night. 4 to 8 games (suggest 6); a light night (< 4) may add the next night (at most `maxNights`); one slate pickable at a time.
  slate: {
    size:           6,
    minSize:        4,
    maxSize:        8,
    candidateSize:  16,
    weights:        null,
    anchorDays:     null,
    timeWindow:     null,
    unit:           'night',
    maxNights:      2,
    oneOpenAtATime: true,
  },

  sideContest: null,

  // The total goals scored in the designated game (default: the slate's last puck drop); a shootout win counts one goal for the winner, as ESPN reports the score.
  tiebreakerDefault: {
    type:     TIEBREAKER_TYPE.CUSTOM,
    question: 'What is the total number of goals scored in {game}?',
    calcMode: TIEBREAKER_CALC_MODE.MANUAL,
  },

  // DI-885 / DI-925: the stall thresholds (explicit now, pinned equal to js/sport-stall.js's shipped values), the reminder cadence (no 24-hour reminder: a slate opens the same day), the
  // score sanity ceiling, and whether a tied final is possible (hockey: never; a tied final is a data error the write gate refuses).
  stall:        { windowHours: 6, failures: 3 },
  reminders:    { thresholds: ['1h', '15m'] },
  scoreMax:     30,
  tiesPossible: false,
  seasonLabel:  'span',                    // week.season stays the start year ("2026"); the Standings header shows "2026-27"
  requestDays:  { kind: 'nights' },        // Request a Game chips: Today, Tomorrow, then the next five nights (DI-923)

  liveDecorators:    null,
  teamAbbr:          { ...NHL_TEAM_ABBR },
  scribeVocab:       null,                 // lane D fills it (DI-898)
  deepLink:          null,

  primaryMarkets:    null,
  periodQuestion:    null,                 // reserved and unbuilt (deferred, not approved)
});
