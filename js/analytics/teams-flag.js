/**
 * CFB Pickems - js/analytics/teams-flag.js (D2 lane 4 batch 2; DI-1090 "Rollout"; UN/PF-543; 2026-10-21, switch moved to Admin 2026-10-21)
 * ===========================================================================================================================================
 * THE SWITCH for the followed-team family (the team.* metrics, their Home cards, Your teams' figures, Game Day's followed-team row, SCRIBE's team facts). THERE IS NO CODE CONSTANT: the family
 * is ON for a league exactly when that league's `serverJobs.teamFacts` switch is on (the Admin Background jobs switch that also starts the collector; Drew's, no deploy). The CALLER reads the
 * setting and hands it to buildInput as `switches.teamFamily` (the app: getSettings().serverJobs.teamFacts; a server function: the league's settings row); offer.js takes it as `familyOn`.
 * Anything but exactly `true` reads OFF (fail closed). Until the collector has rows, a followed team shows "Nothing to show for this team yet". A leaf with no imports.
 */
/** @param {{ switches?: { teamFamily?: boolean } }} input  an eligible input (its frozen switches) */
export function teamFamilyOn(input) { return !!(input && input.switches && input.switches.teamFamily === true); }
