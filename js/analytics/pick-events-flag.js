/**
 * CFB Pickems - js/analytics/pick-events-flag.js (D2 lane 4; DI-961, RPF-D1; 2026-10-19, switch moved to a platform setting 2026-10-21)
 * ======================================================================================================================================
 * THE SWITCH for pick history. `pick_events` (migration 0068) records a member's selection changes from its ship date; nothing earlier can be rebuilt. THERE IS NO CODE CONSTANT: the
 * engine reads pick-event rows only when the platform setting `analytics_pick_events_enabled` (platform_kv, a boolean, default off, admitted by 0063's key CHECK) is exactly `true`; the
 * 0068 runbook's last step is the admin turning it on after 0068 is pasted. The CALLER reads the setting and hands it to buildInput as `switches.pickEvents`. Off (or unread, or not
 * exactly true): every pick-event row is ignored, so `beh.pick_change`, `beh.first_vs_final` and `cf.never_changed` are absent. About the viewer only (RPF-D1). A leaf with no imports.
 */
export const PICK_EVENTS_KV_KEY = 'analytics_pick_events_enabled';
/** @param {{ pickEvents?: boolean }} switches  the caller's switches (buildInput's `opts.switches`) */
export function pickEventsOn(switches) { return !!(switches && switches.pickEvents === true); }
