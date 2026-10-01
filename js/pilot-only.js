/**
 * js/pilot-only.js — THE PILOT-ONLY REGISTRY, ENFORCED BY CODE (N1, DI-432 §7, UN-311 / UN-310, 2026-09-30)
 * ==========================================================================================================
 * Some of what this app shows and runs belongs to ONE league, the pilot (IRB Pick 'Ems): the 2025 season of record, the Permanent Record recap, the six founders'
 * alma maters, the IRB wording, the lore persona, the trainer and its learning tier. Once anyone may create a league, "belongs to the pilot" cannot stay a convention
 * held in people's heads: a new league's commissioner must never see another league's season record, and their players must never read another league's roster names.
 *
 * THIS MODULE IS THE ONE ANSWER. `isPilotOnlyAllowed(key, league)` delegates to `isPilotLeague()` in roles.js — `leagues.pilot === true` off an already-fetched league
 * record, absent/unknown reading as FALSE (the safe direction: a league that has not loaded is never shown another league's content) — and adds exactly two things:
 *
 *   1. a CLOSED key list. An unknown key THROWS: a typo'd key must never quietly answer "not allowed" (hiding IRB's own content) or "allowed", it must be seen.
 *   2. a SITE REGISTRY. Every client site that gates on a key is named here, and `pilotonlytest.mjs` is a source tripwire over it: each named file must contain the
 *      literal `isPilotOnlyAllowed('<key>'` call, so a site that drops its gate — or a new site that never had one — goes red instead of quietly showing IRB's content.
 *
 * NO SECOND PREDICATE. Nothing in here reads `pilot` itself; it asks `isPilotLeague()`. The SERVER half of the registry (below, `server` lists) is not enforced through this
 * file (Edge Functions read `leagues.pilot` themselves through `isPilotLeagueRow`, and `job_due_leagues` filters in SQL); it is listed so the registry is the ONE place a
 * reader can find every pilot-only surface, and `functions.check.mjs` pins the server half.
 *
 * WHERE THE LEAGUE COMES FROM. A site that has the league record passes it (`isPilotOnlyAllowed('irbCopy', league)`). A module that does not (recap.js, which is pure
 * and takes only a week) calls it with the key alone, and the resolver app.js installs at boot answers for the ACTIVE league. With no resolver installed and no league
 * passed the answer is false — fail closed.
 *
 * IMPORTS: roles.js only (which imports nothing from app.js). ZERO top-level side effects.
 */

import { isPilotLeague } from './roles.js';

/**
 * The registry. `client` entries are `{ file, marker }`: the file that must contain `isPilotOnlyAllowed('<key>'` and a short description of the gated site (`marker`
 * names the function or string it gates — for the reader; the tripwire checks the file and key). `server` entries are `{ file, note }` (documentation).
 */
export const PILOT_ONLY_REGISTRY = Object.freeze({
  trainer: Object.freeze({
    client: Object.freeze([]),
    server: Object.freeze([{ file: 'supabase/functions/trainer/index.js', note: 'the trainer is pilot-only (JOB = trainer, isPilotLeagueRow); non-pilot leagues are never iterated' }]),
  }),
  scribeLearn: Object.freeze({
    client: Object.freeze([]),
    server: Object.freeze([{ file: 'supabase/functions/scribe-learn/index.js', note: 'the learning tier reads and writes IRB canon; a non-pilot league has none (isPilotLeagueRow)' }]),
  }),
  canonMemory: Object.freeze({
    client: Object.freeze([]),
    server: Object.freeze([{ file: 'supabase/functions/_shared/scribe-persona.mjs', note: 'canon and learnings are injected only under lore = true' }]),
  }),
  season2025Record: Object.freeze({
    client: Object.freeze([
      { file: 'js/app.js', marker: 'renderSeason2025OutstandingSection() — the 2K25 outstanding balances (Standings)' },
      { file: 'js/app.js', marker: 'renderSeason2025RecordSection() — the 2K25 Historical Record (Standings)' },
      { file: 'js/app.js', marker: 'renderSeason2025ObligationsAdmin() — the 2K25 carryover ledger (Comm)' },
    ]),
    server: Object.freeze([]),
  }),
  recap2025: Object.freeze({
    client: Object.freeze([{ file: 'js/recap.js', marker: 'renderSeasonSummaryHTML() — the 2K25 Permanent Record card' }]),
    server: Object.freeze([]),
  }),
  lorePersona: Object.freeze({
    client: Object.freeze([]),
    server: Object.freeze([{ file: 'supabase/functions/_shared/scribe-persona.mjs', note: 'scribeSystemBlocks({ lore }) — lore = isPilotLeagueRow(row); non-pilot gets the generic persona or fails closed' }]),
  }),
  sixSchoolAlmaMaters: Object.freeze({
    client: Object.freeze([
      { file: 'js/app.js', marker: 'almaMaterCatalogFallback() — the 6-school list offered as the offline alma-mater options' },
      { file: 'js/data-model.js', marker: 'getAlmaMaters() — the ONLY way to read the six-school list (getAlmaMaterMatch()\'s, data-provider\'s and the cfb profile\'s defaults all go through it)' },
    ]),
    server: Object.freeze([]),
  }),
  irbCopy: Object.freeze({
    client: Object.freeze([
      { file: 'js/app.js', marker: 'the push "needs-install" copy (names the app) and the Invite-to-League helper line (names the league)' },
      { file: 'js/control-center.js', marker: 'renderIdentityHeader() — the league-name fallback' },
    ]),
    server: Object.freeze([{ file: 'supabase/functions/_shared/job-rules.mjs', note: 'the "IRB Pick\'Ems" push titles (SYSTEM_TITLE / SYSTEM_TEST_TITLE) are the PILOT\'s only (R-F3, the DI-435 title seam, reconciled 2026-09-30): systemPushTitle(league) returns them solely when isPilotLeagueRow(league) and otherwise the league\'s OWN name through DI-435\'s one label sanitizer ("Your league" when empty or unknown); _shared/onesignal.mjs names no league (its empty-title fallback is caller-supplied, default "Your league", and notify-fanout passes IRB\'s title for the pilot only)' }]),
  }),
});

/** The closed key list. */
export const PILOT_ONLY_KEYS = Object.freeze(Object.keys(PILOT_ONLY_REGISTRY));

let _resolver = null;
/** app.js installs `() => <the active league's membership row>` once, at boot, for the sites that have no league in hand. Pass null to remove it (tests). */
export function setPilotOnlyLeagueResolver(fn) {
  if (fn !== null && typeof fn !== 'function') throw new TypeError('setPilotOnlyLeagueResolver() takes a function or null');
  _resolver = fn;
}

/**
 * May this league see / run the pilot-only thing named by `key`? `isPilotOnlyAllowed('irbCopy', league)` or, without a league, `isPilotOnlyAllowed('recap2025')` (the
 * installed resolver answers for the active league). Unknown key: throws. Never throws otherwise; a resolver that throws reads as "no league" (closed).
 */
export function isPilotOnlyAllowed(key, ...rest) {
  if (!Object.prototype.hasOwnProperty.call(PILOT_ONLY_REGISTRY, key)) {
    throw new Error(`isPilotOnlyAllowed: unknown pilot-only key "${String(key).slice(0, 40)}" (known: ${PILOT_ONLY_KEYS.join(', ')})`);
  }
  let league = null;
  if (rest.length > 0) league = rest[0];
  else if (_resolver) { try { league = _resolver(); } catch { league = null; } }
  return isPilotLeague(league);
}
