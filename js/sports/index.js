/**
 * CFB Pickems — Sport Profile registry (AD-73 PROPOSED)
 * =====================================================
 * Thread "091926-MULTISPORT", Phase 0, DI-219 (UN-220).
 *
 *   getProfile(dbCode)   the frozen profile for a dbCode; THROWS if unknown
 *   listProfiles()       every registered profile, registration order, frozen
 *   normalizeSportKey(k) db code -> legacy ESPN path key (see below)
 *
 * KEYS ARE dbCodes (R1): cfb, nfl today; nba, cbb, mm, nhl, wjc land in later
 * phases. The legacy ESPN path key ('college-football') is NOT a dbCode and
 * `getProfile('college-football')` throws — callers holding an ESPN key must
 * translate first, they do not get a silent second spelling here.
 *
 * `getProfile` is strict on purpose (DI-219: "throws for an unrecognized
 * code"). It never defaults: the `|| 'cfb'` fallback belongs to the CALLER
 * that has a reason to default (DI-219's `profileForWeek`), and the catch +
 * banner for the throw belongs to DI-224. The error carries the offending
 * value on `.dbCode` (truncated to 40 chars) for that banner to `escHtml`.
 *
 * NOT IN PHASE 0: `profileForWeek(week)`. DI-219 specifies it as
 * `getProfile(competitionForWeek(week)?.sport || 'cfb')`, and
 * `competitionForWeek` lives in `js/competition.js` (DI-220, Phase 1), which
 * does not exist yet. Importing a module that isn't there would break this one;
 * it lands with Phase 1.
 *
 * IMPORT RULES (R6): imports only `./cfb.js` and `./nfl.js`; NEVER app.js, so
 * this module is importable by an Edge Function.
 */

import { CFB_PROFILE } from './cfb.js';
import { NFL_PROFILE } from './nfl.js';

const PROFILES = Object.freeze([CFB_PROFILE, NFL_PROFILE]);

// A Map, not an object literal: `getProfile('constructor')` / '__proto__' /
// 'toString' must be "unknown", not a hit on Object.prototype.
const BY_CODE = new Map(PROFILES.map(p => [p.key, p]));
if (BY_CODE.size !== PROFILES.length) {
  throw new Error('js/sports/index.js: duplicate profile key in the registry');
}

export function getProfile(dbCode) {
  const profile = typeof dbCode === 'string' ? BY_CODE.get(dbCode) : undefined;
  if (!profile) {
    const shown = String(dbCode).slice(0, 40);
    const err = new Error(`Unknown sport profile "${shown}" (known: ${PROFILES.map(p => p.key).join(', ')})`);
    err.name = 'UnknownSportError';
    err.dbCode = shown;
    throw err;
  }
  return profile;
}

export function listProfiles() {
  return PROFILES;
}

// ── normalizeSportKey ───────────────────────────────────────────────────────
// db code -> the legacy ESPN path key that keys ESPN_SPORT_ENDPOINTS. This is
// an INDEPENDENT copy of the one exported by js/leagues-home.js (UX Revamp's
// file, which this thread never edits — R7): the duplication is permanent and
// accepted, and profiletest.mjs golden-tests the two to agree. Unknown codes
// pass through unchanged; a non-string or blank value is ''.
// One deliberate difference: own-property lookup, so 'constructor' and
// '__proto__' pass through as themselves instead of resolving to
// Object.prototype members.
const DB_SPORT_TO_ESPN_KEY = Object.freeze({ cfb: 'college-football', nfl: 'nfl' });

export function normalizeSportKey(k) {
  const s = typeof k === 'string' ? k.trim() : '';
  if (!s) return '';
  return Object.prototype.hasOwnProperty.call(DB_SPORT_TO_ESPN_KEY, s) ? DB_SPORT_TO_ESPN_KEY[s] : s;
}
