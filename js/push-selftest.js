/**
 * js/push-selftest.js — the push self-test family's client half.
 * ==============================================================
 * DI-204 (commissioner test push, UN-206), DI-205 (per-recipient breakdown,
 * UN-208), DI-206 (push reachability, UN-208), DI-218 (last-seen app version,
 * UN-209).
 *
 * WHY THIS IS ITS OWN MODULE AND NOT MORE OF `js/app.js`. Three reasons, in
 * order of weight:
 *
 *   1. EVERY DECISION IN IT IS PURE AND TESTABLE. The copy for each of
 *      DI-204h's eight states, DI-206e's nine, and DI-218's version line are
 *      functions of a data object — so `pushtest.mjs` asserts the sentence the
 *      commissioner will actually read, rather than a snapshot of HTML.
 *   2. app.js is touched by nearly every thread in this project and is the
 *      single worst file to add three hundred lines to during a parallel build.
 *   3. The server calls belong beside the copy that interprets them. A result
 *      line that says "no subscribed device" is a reading of a specific
 *      envelope shape; separating the two is how they drift.
 *
 * WHAT IT DOES NOT DO: it renders nothing and touches no DOM. `js/app.js`'s
 * Background-jobs card owns the markup and the escaping (escHtml on every piece
 * of user data, every time — CONVENTIONS #21).
 *
 * ── THE STORAGE SEAM, AND A DELIBERATE ABSENCE ─────────────────────────────
 * This module stores NOTHING. It has no storage key, reaches no localStorage,
 * and holds exactly one module-level boolean (`_versionReportedThisLoad`).
 *
 * The design input asked for a device ledger — "call report_app_version once if
 * the version changed or >24h since the last report, remembered through the
 * storage seam." That was built differently, on purpose, and the reason is
 * worth reading before anyone adds the key back:
 *
 *   • `last_seen_version` is a fact about a MEMBER, not about a device. Drew's
 *     phone and Drew's laptop are one `league_members` row. A per-device ledger
 *     would have each of them independently deciding whether the member needs
 *     re-reporting, which is the wrong subject for the question.
 *   • THE SERVER ALREADY KNOWS. `report_app_version()` (migration 0018) reads
 *     the stored version and returns without writing when it has not changed,
 *     so the "have I already said this?" memory lives where the truth is, and
 *     cannot go stale relative to it.
 *   • The 24-hour half was dropped entirely: it would have written a full
 *     before/after `league_members` snapshot into `audit_log` per member per
 *     day, forever, to record that nothing had changed. 0004's `audit_row()`
 *     skips only cosmetic self-edits, and these columns are not on that list.
 *     See 0018's header for the full measurement.
 *
 * The cost is one cheap RPC per page load on which the version is unchanged
 * (the server answers `false` and writes nothing). That is the entire price.
 */

import { getSupabaseClient, getActiveLeagueId } from './auth.js';

/** DI-204d's server-side limit, mirrored here ONLY for the countdown copy. The
 *  gate itself is in the RPC; this number never decides anything. */
export const TEST_PUSH_RATE_SECONDS = 30;

/** DI-206b.4's server-side limit, same disposition. */
export const REACH_RATE_SECONDS = 60;

/** B3 — how long the button waits for the webhook to report back before it
 *  stops claiming to know. Twenty seconds is the DI's number: a real
 *  notify-fanout round trip is a second or two, and anything past twenty is a
 *  webhook that is not coming. */
export const RESULT_POLL_MS = 20000;
export const RESULT_POLL_INTERVAL_MS = 1200;

const JOB_NOTIFY_FANOUT = 'notify-fanout';
const JOB_PUSH_REACH = 'push-reach';

/**
 * The relative-time phrase for every line this module produces. Pure, and its
 * own function rather than app.js's private `_bgJobTimeAgo` because that one is
 * not exported and a second copy in a file a suite cannot reach is how two
 * clocks come to say different things on the same card.
 *
 * `Infinity`/NaN/negative all resolve to a sentence rather than to "NaN min
 * ago" — a clock-skewed device must not render arithmetic at the commissioner.
 */
export function timeAgo(iso, now = Date.now()) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const ms = now - then;
  if (!(ms >= 0)) return 'just now';
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ══════════════════════════════════════════════════════════════════════════
// DI-204 — the test push
// ══════════════════════════════════════════════════════════════════════════

/**
 * Fire the test push. Returns `{ok:true, id}` or `{ok:false, reason, waitSeconds?}`.
 *
 * NEVER THROWS FOR A SERVER REFUSAL — every refusal is a state the button
 * renders (DI-204h), and a thrown error at the call site would collapse eight
 * distinct sentences into one "something went wrong". It DOES surface a
 * genuinely unreachable backend as `reason:'unreachable'`, which is its own
 * loud state (AD-06: never a silent fallback, never a softened failure).
 *
 * THE CLIENT PASSES NO RECIPIENT. The RPC takes one argument — the league —
 * and stamps the recipient from the caller's own JWT. If this call site ever
 * grows a second argument, that is the bug.
 */
export async function sendTestPush(leagueId = getActiveLeagueId()) {
  const client = getSupabaseClient();
  if (!client || !leagueId) return { ok: false, reason: 'unreachable' };
  try {
    const { data, error } = await client.rpc('send_test_push', { p_league: leagueId });
    if (error) return interpretRpcError(error);
    const id = data && typeof data === 'object' ? String(data.id || '') : '';
    if (!id) return { ok: false, reason: 'no_message_id' };
    return { ok: true, id };
  } catch (err) {
    return { ok: false, reason: String((err && err.message) || err) };
  }
}

/** The RPC's `raise exception` messages, turned into the states DI-204h names.
 *  `rate_limited:<n>` carries the server's own remaining seconds so the copy
 *  and the gate can never disagree about how long is left. */
export function interpretRpcError(error) {
  const msg = String((error && error.message) || error || '');
  const rate = /rate_limited:(\d+)/.exec(msg);
  if (rate) return { ok: false, reason: 'rate_limited', waitSeconds: Number(rate[1]) };
  for (const known of ['not_commissioner', 'not_authenticated', 'not_member', 'bad_version']) {
    if (msg.includes(known)) return { ok: false, reason: known };
  }
  return { ok: false, reason: msg.slice(0, 140) || 'unknown_error' };
}

/**
 * B3 — find the `notify-fanout` run this message produced.
 *
 * THE MATCH IS ON `payload.meta.messageId`, never on "the newest notify-fanout
 * row". On a Saturday the newest row is somebody's chat message, and a button
 * that reported a stranger's fan-out as its own result would be worse than one
 * that reported nothing.
 *
 * `getJobRuns` is injected rather than imported so a suite can drive the poll
 * without a network client. Production passes nothing and gets the real one.
 */
export async function pollTestPushResult(leagueId, messageId, {
  getRuns = null, timeoutMs = RESULT_POLL_MS, intervalMs = RESULT_POLL_INTERVAL_MS,
  now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  const fetchRuns = getRuns || (async () => {
    const { getJobRuns } = await import('./auth.js');
    return getJobRuns(leagueId, { limit: 20, jobs: [JOB_NOTIFY_FANOUT] });
  });
  const deadline = now() + timeoutMs;
  for (;;) {
    let rows = [];
    try { rows = await fetchRuns(); } catch { rows = []; }
    const hit = (rows || []).find((r) => r && r.payload && r.payload.meta
      && r.payload.meta.messageId === messageId);
    // A row with no `finishedAt` is a run still in flight — keep waiting rather
    // than reporting a half-written row as the answer.
    if (hit && hit.finishedAt) return hit;
    if (now() >= deadline) return null;
    await sleep(intervalMs);
  }
}

/**
 * DI-204h — the result line, from the run row. PURE.
 *
 * A2's EVIDENCE RULE IS BUILT IN AND MUST STAY: the word "delivered" appears
 * nowhere. OneSignal's response reports what was TARGETED, not what arrived.
 * "Accepted it for N device(s) — check your phone" is the ceiling of what the
 * server can honestly claim; the phone buzzing is the only proof of delivery,
 * which is exactly why Drew is standing there watching it.
 *
 * @param {object|null} run   the matched job_runs row, or null for "no answer yet"
 * @param {object}      opts  { sentAgo: string }
 * @returns {{tone:'ok'|'warn'|'bad', text:string}}
 */
/**
 * DI-204 / reviewer BLOCK R2 — THE NOTIFY-FANOUT SWITCH IS OFF.
 *
 * This is a CLIENT-SIDE state, and it has to be, which is the whole finding. `notify-fanout`
 * returns `skipped:'disabled'` BEFORE `startRun()` (notify-fanout/index.js §3, and
 * notifyFanout.twin.mjs asserts zero `job_runs` writes on that path) — deliberately, because a
 * flip-off must be a true stop. So there is no run row for the poll to find, the poll times out,
 * and the honest-sounding "the server hasn't reported back yet" is shown for a situation the app
 * knows the answer to with certainty.
 *
 * The card already holds the switch state. Saying "hasn't reported back yet" when we know the job
 * is off is the softened, misleading line AD-06 exists to forbid — so the caller checks the switch
 * BEFORE sending (nothing is inserted at all) and AGAIN on a timeout (in case it was flipped mid-poll).
 */
export function serverPushOffCopy() {
  return {
    tone: 'warn',
    text: "Server push is switched off (Background jobs → notify-fanout). A test push can't be sent until it's on.",
  };
}

export function testPushResultCopy(run, { sentAgo = 'just now', serverPushOff = false } = {}) {
  if (!run) {
    // The switch is the FIRST thing checked on the no-run path: it is a certain answer, and every
    // line below it is a guess about why nothing came back.
    if (serverPushOff) return serverPushOffCopy();
    return { tone: 'warn', text: `Sent ${sentAgo}, but the server hasn't reported back yet — check Background jobs in a minute.` };
  }
  const p = run.payload || {};
  const pushed = Number(p.pushed || 0);
  const recorded = Number(p.recorded || 0);
  const mine = Array.isArray(p.breakdown) && p.breakdown.length === 1 ? p.breakdown[0] : null;

  if (run.ok === false) {
    return { tone: 'bad', text: `Test push failed — ${String(run.error || 'unknown error').slice(0, 120)}. Try again in a minute.` };
  }
  if (run.skipped === 'not_configured') {
    return { tone: 'bad', text: 'Not sent as a push — OneSignal is not configured on the server. It still posted to your Locker Room.' };
  }
  // NO `skipped === 'disabled'` BRANCH. Removed at the combined release (2026-09-20, reviewer
  // BLOCK R2). It was UNREACHABLE and the copy it carried was FALSE: it said "It still posted to
  // your Locker Room", but `notify-fanout` returns `skipped:'disabled'` before it writes anything
  // at all, so there is no run row here to carry that state — and the RPC insert that would have
  // posted to the Locker Room is never reached either, because the caller now refuses to send
  // while the switch is off. `serverPushOffCopy()` above is the reachable replacement, produced
  // from the switch the card already holds rather than from a run row that cannot exist.
  // No assertion may pin copy the system cannot produce.
  if (run.skipped === 'deduped') {
    return { tone: 'warn', text: 'Already sent — the server had this message on record. It is in your Locker Room.' };
  }
  if (run.skipped === 'no_work' && p.direct === 'unresolved') {
    return { tone: 'bad', text: "Not sent — the server couldn't work out who the test was for. Nothing was sent to anyone else." };
  }
  if (mine && mine.reason === 'master_off') {
    return { tone: 'warn', text: 'Not sent as a push — your push notifications are turned off (Settings → Notifications). It still posted to chat so you can confirm the rest of the pathway short of the phone buzz.' };
  }
  if (mine && mine.reason === 'category_off') {
    return { tone: 'warn', text: "Not sent as a push — you've muted the Chat category. It still posted to chat." };
  }
  if (pushed > 0) {
    return {
      tone: 'ok',
      text: `Sent ${sentAgo} · OneSignal accepted it for ${pushed} device${pushed === 1 ? '' : 's'} — check your phone. Also posted to your Locker Room (only you can see it).`,
    };
  }
  if (recorded > 0) {
    return { tone: 'warn', text: `Sent ${sentAgo} · OneSignal found no subscribed device for your account — reinstall or re-enable push in Settings, then try again. The message still posted to your Locker Room.` };
  }
  return { tone: 'warn', text: `Sent ${sentAgo}, but the server reported no recipients. Check Background jobs.` };
}

/** DI-204h's refusal states, as one sentence each. PURE. */
export function testPushRefusalCopy(result) {
  switch (result && result.reason) {
    case 'rate_limited':
      return { tone: 'warn', text: `Please wait ${Math.max(1, Number(result.waitSeconds || TEST_PUSH_RATE_SECONDS))}s before sending another test push.` };
    case 'not_commissioner':
      return { tone: 'bad', text: 'Test push failed — only the commissioner can send one.' };
    case 'not_authenticated':
    case 'not_member':
      return { tone: 'bad', text: 'Test push failed — you are not signed in to this league. Try again in a minute.' };
    case 'unreachable':
      return { tone: 'bad', text: 'Test push failed — the server is unreachable. Try again in a minute.' };
    default:
      return { tone: 'bad', text: `Test push failed — ${String((result && result.reason) || 'unknown error')}. Try again in a minute.` };
  }
}

// ══════════════════════════════════════════════════════════════════════════
// DI-205 — the per-recipient breakdown
// ══════════════════════════════════════════════════════════════════════════

/** The closed set of reasons `recipientBreakdown()` emits, as the sentence the
 *  commissioner reads. NAMES ARE RESOLVED BY THE CALLER — `job_runs` carries
 *  member ids only (B5), so `nameOf` is passed in from the roster the card
 *  already has. An unknown id renders as the id rather than as nothing, so a
 *  member who left the roster is still visible as a line. */
export function breakdownLine(entry, nameOf) {
  const name = (nameOf && nameOf(entry.memberId)) || entry.memberId;
  switch (entry.reason) {
    case null:
    case undefined:
      return { icon: '✅', tone: 'ok', text: `${name} — pushed` };
    case 'category_off':
      return { icon: '⛔', tone: 'bad', text: `${name} — muted (Chat category off)` };
    case 'master_off':
    case 'push_off':
      return { icon: '⛔', tone: 'bad', text: `${name} — push notifications off` };
    case 'inactive':
      return { icon: '➖', tone: 'muted', text: `${name} — not an active member` };
    case 'author':
      return { icon: '➖', tone: 'muted', text: `${name} — sent it` };
    case 'deduped':
      return { icon: '➖', tone: 'muted', text: `${name} — already had this one` };
    case 'not_addressed':
      return { icon: '➖', tone: 'muted', text: `${name} — not the recipient of this one` };
    case 'push_not_sent':
      return { icon: '⚠️', tone: 'warn', text: `${name} — eligible, but the push did not go out` };
    default:
      return { icon: '⚠️', tone: 'warn', text: `${name} — ${String(entry.reason)}` };
  }
}

/** The newest notify-fanout run that actually carries a breakdown. Used both by
 *  the expandable line and by DI-206's merge. Returns null when there is none —
 *  which the reachability copy renders as "unknown", never as "on". */
export function newestBreakdown(rows) {
  const hit = (rows || []).find((r) => r && r.job === JOB_NOTIFY_FANOUT
    && r.payload && Array.isArray(r.payload.breakdown) && r.payload.breakdown.length);
  return hit ? { run: hit, breakdown: hit.payload.breakdown } : null;
}

// ══════════════════════════════════════════════════════════════════════════
// DI-206 — the reachability check
// ══════════════════════════════════════════════════════════════════════════

/** Invoke `push-reach`. Same never-throw-for-a-refusal contract as
 *  `sendTestPush`: every outcome is a state the card renders. */
export async function checkPushReach(leagueId = getActiveLeagueId()) {
  const client = getSupabaseClient();
  if (!client || !leagueId) return { ok: false, reason: 'unreachable' };
  try {
    const { data, error } = await client.functions.invoke(JOB_PUSH_REACH, { body: { league_id: leagueId } });
    if (error) return { ok: false, reason: String((error && error.message) || 'unreachable') };
    return data || { ok: false, reason: 'empty_response' };
  } catch (err) {
    return { ok: false, reason: String((err && err.message) || err) };
  }
}

/**
 * DI-206e — one line per member, merging the reachability answer with DI-205's
 * eligibility answer. PURE.
 *
 * THE MERGE IS HONEST ABOUT WHAT IT DOES NOT KNOW. If there is no recent
 * notify-fanout run to read preferences from, the preference half of the line
 * is labelled "preferences unknown", never assumed to be on. That is DI-206d's
 * explicit instruction and it is the difference between a diagnostic and a
 * guess.
 *
 * NOTE WHAT THIS DELIBERATELY DOES NOT CLAIM: nothing here says a push will
 * arrive. `enabled:true` is OneSignal's own record, which can lag a revoked OS
 * permission by minutes or a day. The copy says "can receive push", never "is
 * receiving" and never "delivered".
 *
 * @param {object} result  one entry of push-reach's `results`
 * @param {object|null} eligibility  the matching DI-205 breakdown entry, or null
 * @param {function} nameOf
 */
export function reachLine(result, eligibility, nameOf) {
  const name = (nameOf && nameOf(result.memberId)) || result.memberId;
  if (result.lookupOk === false) {
    return {
      icon: '❔', tone: 'warn',
      text: `${name} — couldn't check (OneSignal error). Try again in a minute.`,
      action: 'Retry the check. If it keeps failing for just this player, something is wrong with their specific record.',
    };
  }
  const count = Number(result.deviceCount || 0);
  if (count === 0) {
    return {
      icon: '⚠️', tone: 'bad',
      text: `${name} — no device registered. They won't get any push until they open the app and allow notifications.`,
      action: `Tell ${name} to open the app on their phone and accept the notification prompt (or re-add it to the home screen if they never got one).`,
    };
  }
  const kinds = Array.isArray(result.kinds) && result.kinds.length ? result.kinds : [];
  const devices = `${count} device${count === 1 ? '' : 's'}`;
  const kindPhrase = kinds.length ? ` (${kinds.join(', ')})` : '';
  const reason = eligibility ? eligibility.reason : undefined;
  if (reason === 'master_off' || reason === 'push_off') {
    return {
      icon: '⛔', tone: 'bad',
      text: `${name} — ${devices}${kindPhrase} registered, but they have push turned off in Settings.`,
      action: `Tell ${name} to open the app, go to Settings → Notifications, and turn push back on.`,
    };
  }
  if (reason === 'category_off') {
    return {
      icon: '⛔', tone: 'bad',
      text: `${name} — ${devices}${kindPhrase} registered, but they've muted the Chat category.`,
      action: `Tell ${name} to re-enable Chat notifications in Settings if they want pushes for messages.`,
    };
  }
  if (!eligibility) {
    return {
      icon: '✅', tone: 'ok',
      text: `${name} — ${devices}${kindPhrase} can receive push. Preferences unknown — no recent send to check them against.`,
      action: '',
    };
  }
  return { icon: '✅', tone: 'ok', text: `${name} — ${devices}${kindPhrase} can receive push.`, action: '' };
}

/** The whole-check states (as opposed to the per-member ones). PURE. */
export function reachHeaderCopy(res) {
  if (!res) return { tone: 'muted', text: '' };
  if (res.rateLimited) {
    return { tone: 'warn', text: `Please wait ${Math.max(1, Number(res.retryAfterSeconds || REACH_RATE_SECONDS))}s before checking again.` };
  }
  if (res.skipped === 'not_configured') {
    return { tone: 'bad', text: "Push reachability check unavailable — OneSignal isn't configured on this server." };
  }
  if (res.skipped === 'no_work') {
    return { tone: 'warn', text: 'Nobody to check — this league has no active members.' };
  }
  if (res.ok === false) {
    return { tone: 'bad', text: `Reachability check failed — ${String(res.error || res.reason || 'unknown error').slice(0, 120)}. Try again in a minute.` };
  }
  return { tone: 'muted', text: '' };
}

// ══════════════════════════════════════════════════════════════════════════
// DI-218 / UN-209 — last-seen app version
// ══════════════════════════════════════════════════════════════════════════

/** Once per page load. See this file's header for why there is no stored
 *  ledger: the SERVER is the memory, and it returns without writing when the
 *  version has not changed. */
let _versionReportedThisLoad = false;

/** Test seam — production never calls this. */
export function _resetVersionReportForTest() { _versionReportedThisLoad = false; }

/**
 * The boot hook. FIRE AND FORGET, and FAILURE IS SILENT TO THE PLAYER.
 *
 * THIS MUST NEVER RAISE THE RED BANNER, and that is a hard requirement rather
 * than a nicety: the banner means "cross-device sync is off and your picks may
 * not be saved" (AD-06). A diagnostic column failing to stamp is not that, and
 * borrowing the banner for it would teach six people to ignore the one warning
 * that matters. It logs and returns.
 *
 * Returns 'stamped' | 'unchanged' | 'skipped' | 'failed', for the suite.
 */
export async function reportAppVersionOnce(version, leagueId = getActiveLeagueId()) {
  if (_versionReportedThisLoad) return 'skipped';
  const client = getSupabaseClient();
  if (!client || !leagueId || !version) return 'skipped';
  _versionReportedThisLoad = true;   // set BEFORE the await: two overlapping
  // boots (a hydrate and a hold-gate resume) must not both fire it.
  try {
    const { data, error } = await client.rpc('report_app_version', { p_league: leagueId, p_version: String(version) });
    if (error) {
      console.warn('[version] report_app_version failed (harmless; the commissioner card will show a stale version)', error.message || error);
      return 'failed';
    }
    return data === true ? 'stamped' : 'unchanged';
  } catch (err) {
    console.warn('[version] report_app_version threw (harmless)', err && err.message ? err.message : err);
    return 'failed';
  }
}

/** The commissioner's read. Returns `[]` on any failure — this is one line on a
 *  diagnostic card, and a thrown error would take the whole card down with it. */
export async function fetchMemberAppVersions(leagueId = getActiveLeagueId()) {
  const client = getSupabaseClient();
  if (!client || !leagueId) return [];
  try {
    const { data, error } = await client.rpc('member_app_versions', { p_league: leagueId });
    if (error) return [];
    return (data || []).map((r) => ({
      memberId: r.member_id,
      version: r.last_seen_version || '',
      seenAt: r.last_seen_at || null,
    }));
  } catch {
    return [];
  }
}

/**
 * DI-218's per-player line. PURE.
 *
 * `current` is APP_VERSION. Anyone not on it is HIGHLIGHTED, because the whole
 * point of this column is the Step 6 switch-on precondition — "only flip this
 * on once every device is on the latest app version" — which until now nothing
 * in the system could check.
 *
 * `never` FOR A NULL, not "unknown" and not blank: a member who has never
 * reported is a member whose phone has not opened this build, which is exactly
 * the case the commissioner must not read past.
 *
 * THE TIME IS LABELLED "since", not "last seen". `report_app_version` writes
 * only on change, so the timestamp is when that member FIRST arrived on that
 * version — not when they last opened the app. Wording it as the latter would
 * be a claim this data cannot support.
 */
export function versionLine(entry, current, nameOf, now = Date.now()) {
  const name = (nameOf && nameOf(entry.memberId)) || entry.memberId;
  if (!entry.version) {
    return { icon: '⚠️', tone: 'bad', stale: true, text: `${name} — never reported an app version` };
  }
  const stale = String(entry.version) !== String(current);
  const when = entry.seenAt ? ` · since ${timeAgo(entry.seenAt, now)}` : '';
  return {
    icon: stale ? '⚠️' : '✅',
    tone: stale ? 'bad' : 'ok',
    stale,
    text: `${name} — ${entry.version}${when}`,
  };
}

/** The one-sentence summary above the per-player lines. PURE. */
export function versionSummary(entries, current) {
  const rows = entries || [];
  if (!rows.length) return '';
  const behind = rows.filter((e) => !e.version || String(e.version) !== String(current));
  if (!behind.length) return `All ${rows.length} on ${current}.`;
  return `${behind.length} of ${rows.length} not on ${current} yet — a stale device keeps running the app's own client-side path.`;
}
