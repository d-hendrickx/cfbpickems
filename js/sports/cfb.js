/**
 * CFB Pickems — Sport Profile: College Football (`cfb`)
 * =====================================================
 * Thread "091926-MULTISPORT", Phase 0, DI-219 (AD-73 PROPOSED, UN-220).
 *
 * TODAY'S CODE BECOMES THE `cfb` PROFILE. Every value below is either read
 * FROM the legacy constant it replaces (label / code / path — DI-224 rev 3:
 * "`espn.path` is populated FROM `ESPN_SPORT_ENDPOINTS`, not the other
 * direction") or copied from an un-exported literal in legacy code and proven
 * equal by `profiletest.mjs` (a fetch-stubbed run through the real
 * `data-provider.js` / `extra-point.js` / `createWeek()`, or a source pin where
 * the literal has no runtime seam). A value that has no legacy constant to be
 * equal to is `null`, never invented — the slot exists so its SHAPE is fixed,
 * and a later phase (named per slot below) fills it.
 *
 * KEYS ARE dbCodes (R1). `key: 'cfb'`, never the legacy ESPN path key
 * `'college-football'` — that string lives only inside this file as the lookup
 * into `ESPN_SPORT_ENDPOINTS`.
 *
 * IMPORT RULES (R6 + DI-224 rev 3 cycle warning).
 *   - Imports ONLY `../data-model.js`, which has no imports of its own, so this
 *     module is importable by an Edge Function with zero browser globals.
 *   - NEVER imports app.js, storage.js, data-provider.js or scoring.js.
 *   - `data-model.js` must NEVER import `js/sports/*` (that would close the
 *     cycle data-model.js -> sports/index.js -> cfb.js -> data-model.js, and
 *     `TEAM_ABBR` below is read eagerly at module load).
 *
 * FROZEN. Deeply. A consumer that mutates a profile throws in strict mode
 * (every ES module is strict) instead of silently corrupting every reader.
 */

import {
  ESPN_SPORT_ENDPOINTS, getAlmaMaters, TEAM_ABBR,
  TIEBREAKER_TYPE, TIEBREAKER_CALC_MODE,
} from '../data-model.js';

// The legacy ESPN path key this profile's dbCode maps to. Not a persisted value.
const LEGACY_ESPN_KEY = 'college-football';
const ESPN = ESPN_SPORT_ENDPOINTS[LEGACY_ESPN_KEY];

// safeRank() in data-provider.js: `n >= 1 && n <= 25`. Un-exported there;
// profiletest.mjs proves `normalize` below agrees with the real parse path.
const RANK_MAX = 25;

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

export const CFB_PROFILE = deepFreeze({
  // ── identity ────────────────────────────────────────────────────────────
  key:   'cfb',
  label: ESPN.label,                       // 'College Football'
  code:  ESPN.code,                        // 'CFB' — header pill step 2 (DI-417)
  glyphKey: 'sportFootball',               // Munera icon-family key for CHROME (D-1, DI-314); icons.js ICONS key
  emoji: '🏈',                             // NON-chrome text only (SCRIBE lines, rules prose); never rendered in chrome
  copy:  null,                             // inline template literals in app.js today; merge phase

  // ── feed ────────────────────────────────────────────────────────────────
  // Provider only. The three fetch functions are behavior, not constants:
  // data-provider.js's fetchByDateRange()/refreshScoresByEventIds() do not
  // take a profile today, so wiring them is a merge-phase edit to that file.
  feed: {
    provider:     'espn',
    fetchSlate:   null,
    fetchScores:  null,
    fetchSummary: null,
  },

  // ── espn ────────────────────────────────────────────────────────────────
  // `path`, `summaryPath` and `groups` are relative to
  // https://site.api.espn.com/apis/site/v2/sports/.  `teamsUrl` is ABSOLUTE: the
  // teams catalog is read from ESPN's core v3 host (RG-TBD-B3 / N9, 2026-09-29),
  // a different origin AND path root from the site API, so a path relative to the
  // site root cannot describe it (coordinator ruling 2026-09-30: the profile
  // describes the URL the app actually requests; Batch B's host wins). It equals
  // data-provider.js's ESPN_TEAMS_URL character for character; profiletest.mjs
  // proves that through the real fetchEspnTeamsList().
  espn: {
    path:        ESPN.path,                                        // 'football/college-football'
    summaryPath: 'football/college-football/summary',              // extra-point.js SUMMARY_ROOT
    teamsUrl:    'https://sports.core.api.espn.com/v3/sports/football/college-football/teams?limit=1000',  // data-provider.js ESPN_TEAMS_URL
    groups:      '80',                                             // buildEspnUrl(): FBS filter, CFB only
  },

  // NO `period` slot (R5/R9): period kind is a pure function of
  // competition.kind, owned by DI-223 at the competition level — a per-sport
  // period slot would invite per-sport period logic.

  // ── secondHalfFromPeriod ────────────────────────────────────────────────
  // N8 (DI-439 §2, 2026-09-29) — the FIRST in-game period that is "the second
  // half", as ESPN numbers periods (football: Q3). An IN-GAME period, NOT the
  // excluded competition-level `period` slot above (DI-223). `null` would mean the
  // sport never fires SCRIBE's live-upset call-outs (hockey). Read by nothing in
  // this module: js/scribe-scoring.js's interim table carries the same seven keys
  // (Edge-importable without this registry) and `liveupsettest.mjs` pins the two.
  // CORE (DI-219) ratifies the slot's name.
  secondHalfFromPeriod: 3,

  // ── markets ─────────────────────────────────────────────────────────────
  // Implicit spread today: a game with NO `market` field IS a spread game
  // (createGame() never sets one). `rotate` is Phase 3 (markets).
  markets: {
    allowed: ['spread'],
    default: 'spread',
    rotate:  null,
  },

  // ── affinity ────────────────────────────────────────────────────────────
  // Alma mater. Watch is ALWAYS straight-up (locked ruling: never ATS).
  // `isAffinityGame` needs the claimed-roster and `tiebreakerTotal` needs
  // scoring.js's calculateAlmaMaterTotal — both are Phase 4, not constants.
  affinity: {
    kind:            'alma_mater',
    allowedKinds:    ['alma_mater'],
    watch:           'straightUp',
    watchTitle:      'Alma Mater Watch',
    catalog:         (...league) => getAlmaMaters(...league),   // N1: the six pilot schools for the pilot, [] for anyone else (pilot-only in code)
    isAffinityGame:  null,
    tiebreakerTotal: null,
  },

  // ── groupings ───────────────────────────────────────────────────────────
  // R6: stays null until merge (ESPN_CONFERENCE_BY_ID lives un-exported in
  // data-provider.js; CONFERENCE_REGION in app.js, which this module may not import).
  groupings: null,

  // ── rankings ────────────────────────────────────────────────────────────
  rankings: {
    max: RANK_MAX,
    normalize(raw) {
      if (!raw) return null;
      const n = parseInt(raw, 10);
      return n >= 1 && n <= RANK_MAX ? n : null;
    },
  },

  // ── slate ───────────────────────────────────────────────────────────────
  // `size` = buildSuggestedSlate()'s `targetCount = 10` = app.js TARGET_SLATE_SIZE.
  // The rest are inlined in scoring/selection code with no constant to equal.
  slate: {
    size:          10,
    candidateSize: null,
    weights:       null,
    anchorDays:    null,
    timeWindow:    null,
  },

  // ── sideContest ─────────────────────────────────────────────────────────
  // Longest made FG lives in extra-point.js (Phase 4 moves it behind this slot).
  sideContest: null,

  // ── tiebreakerDefault ───────────────────────────────────────────────────
  // createWeek()'s defaults, verbatim.
  tiebreakerDefault: {
    type:     TIEBREAKER_TYPE.ALMA_MATER_TOTAL,
    question: 'What is the total combined points scored by all alma mater teams on the slate this week?',
    calcMode: TIEBREAKER_CALC_MODE.SELECTED_SLATE_ONLY,
  },

  // ── liveDecorators / scribeVocab / deepLink ─────────────────────────────
  liveDecorators: null,        // red zone: data-provider.js parse today; merge phase
  scribeVocab:    null,
  deepLink:       null,

  // ── F9's slots (hockey only) ────────────────────────────────────────────
  // Shape fixed here, content owned by HOCKEY; null for every non-hockey sport.
  primaryMarkets: null,
  periodQuestion: null,

  // ── teamAbbr ────────────────────────────────────────────────────────────
  teamAbbr: { ...TEAM_ABBR },
});
