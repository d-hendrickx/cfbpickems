/**
 * CFB Pickems — NEW_LEAGUE_DEFAULTS, the platform's answer to "what does a brand-new league start with?"
 * =====================================================================================================
 * Thread "091926-MULTISPORT", N1 league creation (DI-430 / DI-431 §3, UN-310). Pure data, IMPORTS NOTHING, so the
 * browser, a Node test and a static check can all read it without a DOM, a network or a storage seam.
 *
 * ONE VALUE, TWO HOMES. `create_league` (supabase/migrations/0034_league_creation.sql) seeds `league_kv.settings`
 * from a jsonb literal on its `c_new_league_defaults` line; this module holds the same value for the client. The
 * Created screen (frame 4) renders its five rows FROM this object, so the screen can never claim a switch the server
 * did not seed. `leaguecreatetest.mjs` parses the migration's literal and asserts deep equality with
 * NEW_LEAGUE_DEFAULTS — if one moves and the other does not, the build is red (the twin, DI-430 acceptance).
 *
 * WHAT IS DELIBERATELY ABSENT (Drew, Q3, 2026-09-29):
 *   - `trainer`, `scribeLearn`, `keepalive`: pilot-only (the trainer tier) or project-wide; never seeded for a new league.
 *   - SCRIBE heat, frequency and the 4-an-hour autonomous rate: these are the CODE defaults (`SCRIBE_HEAT_DEFAULT`
 *     'dry', `SCRIBE_FREQUENCY_DEFAULT` 'balanced' in js/data-model.js), seeded ABSENT so a later change to a default
 *     reaches every league that never set one. Frame 4 states them in words ("Dry, Balanced"); the twin test proves
 *     the words equal the code defaults.
 *   - `pilot`: never written by any creation path. A new league is `pilot = false`, which is what makes every
 *     pilot-only site (js/pilot-only.js) refuse it.
 *
 * `scribe.monthlyBudgetUsd` 5 is the per-league budget a commissioner may LOWER but never raise above the platform
 * cap (league_platform_limits, DI-432); the ceiling across all non-pilot leagues is a separate platform_kv value.
 */

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

/** The seven `settings.serverJobs` switches a new league starts ON, and the SCRIBE monthly budget. Key order is the
 *  migration literal's order (the twin compares by value, not order, but keeping them alike keeps a diff readable). */
export const NEW_LEAGUE_DEFAULTS = deepFreeze({
  serverJobs: {
    notifyFanout: true,
    reminders: true,
    scoresRefresh: true,
    scribeAsk: true,
    scribeClassify: true,
    scribeReact: true,
    scribeAutonomous: true,
  },
  scribe: { monthlyBudgetUsd: 5 },
});

/** The league name cap. `leagues.name` is `check (length(name) between 1 and 80)` (0001); the field's maxlength is this
 *  number, so no length error is ever needed. */
export const NEW_LEAGUE_NAME_MAX = 80;

/** At most this many sports per league (create_league's `c_max_sports`, `bad_sports` beyond it). */
export const NEW_LEAGUE_MAX_SPORTS = 7;

/** The sport picker's two groups, as R1 dbCodes. A sport appears in the picker only when it is BOTH a registered
 *  profile (`listProfiles()`) AND in `platform_kv.offered_sports`; this table only says which group it belongs to and in
 *  what order. A code missing from a group is simply never offered. Mirrors create_league's `c_seasons`. */
export const NEW_LEAGUE_SPORT_KINDS = deepFreeze({
  season: ['cfb', 'nfl', 'nba', 'cbb', 'nhl'],
  tournament: ['mm', 'wjc'],
});

/** Frame 4's "Already on for your league" rows. Each row is shown only when every server job it names is true in the
 *  defaults it is rendered from (a row for a switch the server did not seed would be a lie). `jobs: []` means the row
 *  states something that is on BY CONSTRUCTION rather than through a switch: weeks go live at kickoff because every week
 *  is created with `auto_live_enabled` true (there is nothing to seed). The SCRIBE row's parenthetical is the code
 *  defaults for heat and frequency, stated in plain words. */
export const NEW_LEAGUE_ON_ROWS = deepFreeze([
  { id: 'scores',    text: 'Live scores update automatically',        jobs: ['scoresRefresh'] },
  { id: 'reminders', text: 'Reminders before picks lock',             jobs: ['reminders'] },
  { id: 'push',      text: 'Push notifications for everyone',         jobs: ['notifyFanout'] },
  { id: 'scribe',    text: 'SCRIBE is on (Dry, Balanced)',            jobs: ['scribeAsk', 'scribeClassify', 'scribeAutonomous'] },
  { id: 'golive',    text: 'Weeks go live at kickoff',                jobs: [] },
]);

/** The rows frame 4 renders for a defaults object. Pure; never throws on a malformed argument. A row is returned only when every
 *  switch it names is ON in the defaults it is drawn from, so a malformed argument claims nothing a switch would have to back — the
 *  one row that can stand without a switch is "Weeks go live at kickoff" (`jobs: []`, on by construction). */
export function newLeagueOnRows(defaults = NEW_LEAGUE_DEFAULTS) {
  const jobs = defaults && defaults.serverJobs && typeof defaults.serverJobs === 'object' ? defaults.serverJobs : {};
  return NEW_LEAGUE_ON_ROWS.filter((row) => row.jobs.every((j) => jobs[j] === true));
}
