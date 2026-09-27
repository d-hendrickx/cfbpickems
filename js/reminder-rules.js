/**
 * js/reminder-rules.js — the PURE reminder-scan decision logic, DI-T6.14(b).
 * ============================================================================
 * Phase III Step 6, Phase 2. DI-T6.2 (`reminders`) replaces Apps Script's
 * `scanReminders()`. DI-T6.14(b) calls for "a Node twin where logic is
 * shared — the preference is a pure module importable from both [Deno and
 * Node]", extracted from `backend/notifyServer.mjs`, "no new logic".
 *
 * WHY THIS FILE EXISTS RATHER THAN `reminders/index.js` IMPORTING
 * `backend/notifyServer.mjs` DIRECTLY. Two reasons, both structural:
 *   1. Deno cannot resolve a relative import that climbs out of
 *      `supabase/functions/` into `backend/` in the shape the deployed
 *      function bundle would need, and `backend/notifyServer.mjs` itself
 *      imports `../js/notify-copy.js` — a second hop that only resolves from
 *      that file's own location.
 *   2. `backend/notifyServer.mjs` is on the Step 6 design input's explicit
 *      "may not touch" list (§11) — it is Apps Script's tested twin and the
 *      rollback stays byte-identical through Step 6 (§0.3.1's sibling rule
 *      for `backend/Code.gs`).
 *
 * SO THIS IS A PARALLEL FILE, NOT A MOVE. Every function below is the SAME
 * decision logic as the corresponding export in `backend/notifyServer.mjs`
 * — same control flow, same constants, same order of operations — verified
 * against it rather than assumed.
 *
 * CORRECTED 2026-09-20 (reviewer R6): this paragraph previously claimed
 * `notifytest.mjs` [30] extracts both function bodies with the balanced-brace
 * technique [22] uses for Code.gs vs. its twin, normalizes whitespace/var-vs-
 * const, and asserts the bodies are BYTE-IDENTICAL. That is not what [30]
 * does, and never has been — read its own console.log header, which has
 * always said the opposite ("verified BEHAVIOURALLY … rather than diff
 * text"). What [30] ACTUALLY does: it imports both modules under plain Node
 * (both are loadable there — the reason this parallel file exists at all) and
 * EXECUTES every exported function on shared fixtures, asserting the RETURN
 * VALUES agree field-by-field (with the one documented additive field,
 * `title`, set aside). That is BEHAVIOURAL parity, not textual — it would
 * catch two implementations that decide the same thing through different
 * code, and it would catch two implementations whose SOURCE TEXT happens to
 * match but whose behaviour has drifted (impossible for a text diff to see,
 * since text either matches or does not). [30] covers the default
 * (`nameNonSubmitters` left at true) and, since this correction, the
 * `nameNonSubmitters:false` count-only branch as well (30d). A change to one
 * side that is not mirrored in the other goes RED there, which is the
 * enforcement mechanism DI-T6.14(b) asks for without requiring an edit to the
 * off-limits file.
 *
 * THE ONE DELIBERATE ADDITION: `title`. `backend/notifyServer.mjs`'s
 * `computeReminderPlan()` keeps only `buildCopy()`'s `.body`, because
 * Code.gs's `sendOneSignalPush()` already had its own separate title
 * constant. `reminders/index.js` has no such constant lying around, and
 * `buildCopy()` already computed the title — discarding it and
 * re-deriving it a second way would be the "second copy of decided
 * behaviour" CONVENTIONS #10's spirit warns against, one field over. This is
 * additive (a new field on the return value, never a changed decision) and
 * is named here, once, rather than left for a reader to notice as a diff
 * against the twin's shape.
 *
 * NOTHING HERE TOUCHES A NETWORK, A DATABASE, A SECRET, `Deno`, `fetch` OR
 * `localStorage`. That is what makes it loadable by Deno (a plain ES module)
 * AND by Node (notifytest.mjs) with no shim beyond the different relative
 * path to `notify-copy.js`.
 */

import { buildCopy } from './notify-copy.js';

// -- Constants -- MUST match backend/notifyServer.mjs (and, through it,
// backend/Code.gs) verbatim. notifytest.mjs [30] pins this. --
export const REMINDER_THRESHOLDS = [
  { key: '24h', ms: 24 * 60 * 60 * 1000 },
  { key: '1h', ms: 60 * 60 * 1000 },
  { key: '15m', ms: 15 * 60 * 1000 },
];
export const LOCKING_SOON_MS = 60 * 60 * 1000;

/** Port of js/scoring.js's computeFirstKickoff — kept as a small local copy
 *  here for the same reason backend/notifyServer.mjs carries its own: Deno
 *  can import js/scoring.js directly (unlike GAS), but that module's own
 *  seam import (`getTiebreakerGuess` from storage.js, DI-T6.0(g)'s named
 *  blocker) is exactly the DOM-touching chain Step 6 is not allowed to drag
 *  into an Edge Function. A three-line pure copy avoids it entirely. */
export function firstKickoffMs(games) {
  const times = (games || [])
    .map(g => g?.kickoff ? new Date(g.kickoff).getTime() : null)
    .filter(t => typeof t === 'number' && !isNaN(t));
  return times.length ? Math.min(...times) : null;
}

/** Port of js/scoring.js's computeEffectiveLockAt. */
export function effectiveLockAtMs(week, games) {
  if (!week) return null;
  if (week.picksLockAt) {
    const t = new Date(week.picksLockAt).getTime();
    return isNaN(t) ? null : t;
  }
  const first = firstKickoffMs(games);
  if (first === null) return null;
  const offset = (typeof week.autoLockOffsetMinutes === 'number' && week.autoLockOffsetMinutes >= 0) ? week.autoLockOffsetMinutes : 30;
  return first - offset * 60000;
}

/** Twin of backend/notifyServer.mjs's selectActiveOpenWeek() — selects the
 *  same active week js/storage.js's getCurrentWeek() would (the active
 *  pointer first), with an explicit earliest-lock tiebreak when more than
 *  one week is simultaneously OPEN and the pointer does not resolve one. */
export function selectActiveOpenWeek({ weeks, activeWeekId, games }) {
  if (activeWeekId) {
    const found = (weeks || []).find(w => w && w.weekId === activeWeekId);
    if (found && found.status === 'open') return found;
  }
  const openWeeks = (weeks || []).filter(w => w && w.status === 'open');
  if (!openWeeks.length) return null;
  if (openWeeks.length === 1) return openWeeks[0];
  let best = null, bestLock = Infinity;
  for (const w of openWeeks) {
    const wGames = (games || []).filter(g => g && g.weekId === w.weekId);
    const lockMs = effectiveLockAtMs(w, wGames);
    if (lockMs !== null && lockMs < bestLock) { bestLock = lockMs; best = w; }
  }
  return best || openWeeks[0];
}

/** Pure twin of Code.gs's resolveServerPushIntent_() / backend/notifyServer.mjs's
 *  resolveServerPushIntent(): push fires only if the recipient's master toggle
 *  AND (when the event is category-gated) the category toggle are both on.
 *  Default-when-missing reads as ON for both (the opt-out model). */
export function resolveServerPushIntent({ player, category }) {
  const prefs = (player && player.preferences) || {};
  const masterRaw = prefs.notifyPushMaster;
  const masterOn = (masterRaw === undefined || masterRaw === null) ? true : !!masterRaw;
  if (!category) return masterOn;
  const cats = prefs.notifyCategories || {};
  const catRaw = cats[category];
  const categoryOn = (catRaw === undefined || catRaw === null) ? true : !!catRaw;
  return categoryOn && masterOn;
}

/** Twin of backend/notifyServer.mjs's readNameNonSubmittersFlag(). Parses a
 *  raw `settings.notifyNameNonSubmitters` value into a boolean.
 *  Default-when-missing is TRUE — an absent setting behaves exactly as it did
 *  before the setting existed (CONVENTIONS #10). Only the literal string
 *  'false' (case/whitespace-insensitive) turns naming off. */
export function readNameNonSubmittersFlag(raw) {
  if (raw === null || raw === undefined) return true;
  return String(raw).trim().toLowerCase() !== 'false';
}

/** dedupKey shape validation — must match Code.gs's isValidDedupKey() and
 *  js/notifications.js's makeDedupKey() format exactly:
 *  `${event}|${weekId}|${threshold}|${playerId}`. */
export function isValidDedupKey(dedupKey) {
  if (typeof dedupKey !== 'string') return false;
  if (dedupKey.length < 3 || dedupKey.length > 300) return false;
  const parts = dedupKey.split('|');
  if (parts.length !== 4) return false;
  if (!parts[0] || !parts[3]) return false;
  return true;
}

/**
 * Pure port of scanReminders()'s DECISION logic (no I/O, no dedup lookup —
 * that is the caller's job, against `notifications`' own unique key in
 * reminders/index.js, or against a fake store in a test). Given the current
 * OPEN week, its games/picks/players and "now", returns the plan: everything
 * that WOULD fire this scan, before any dedup check.
 *
 *   { remindersPlan: [{ playerId, dedupKey, threshold, remaining, category, title, body }],
 *     lockingSoonPlan: null | { entries:[{playerId,dedupKey,category}], title, body, meta,
 *                               copyEvent, nonSubmitters, submittedCount, totalPlayers,
 *                               nameNonSubmitters } }
 *
 * `picks` need only carry `{weekId, playerId}` per completed selection — the
 * blind rule means a caller must never possess `selectedTeam`/`selected_team`
 * in the first place, so this function was never handed one to drop.
 */
export function computeReminderPlan({
  week, games, picks, players, now = Date.now(), nameNonSubmitters = true,
  // ── DI-342/DI-C3 §4.1 — ADDITIVE parameters, both defaulted so every
  // existing call site (the scheduled threshold/locking-soon scan, and
  // every test fixture written before this DI) is byte-identical when it
  // passes neither. `cadence` drives the new daily-cadence branch (§4.1's
  // "alongside the existing REMINDER_THRESHOLDS loop, not a second copy");
  // `force`/`runId` are the manual "SCRIBE: remind the stragglers" trigger
  // (§4.4/§4.5) — the SAME planner, a SEPARATE dedup family
  // (`PICKS_REMINDER_MANUAL`) so a manual post can never collide with, or
  // be silently deduped against, a threshold/cadence entry for the same
  // player.
  cadence = 'thresholds-only', force = false, runId = null,
  // D-13 suppression (fix round 1) — see cadenceReminderEntries()'s own
  // header. Both default to "no suppression," so every existing call site
  // (including every test fixture written before this fix) is unchanged.
  lastManualPostAtMs = null, cooldownHours = null,
} = {}) {
  const empty = { remindersPlan: [], lockingSoonPlan: null, manualPost: null };
  if (!week || week.dataSourceMode === 'demo' || week.status !== 'open') return empty;

  const weekGames = (games || []).filter(g => g && g.weekId === week.weekId);
  const totalGames = weekGames.length;
  if (!totalGames) return empty;

  const active = (players || []).filter(p => p && p.active);
  const weekPicks = (picks || []).filter(pk => pk && pk.weekId === week.weekId);
  const completedByPlayer = {};
  for (const p of active) completedByPlayer[p.playerId] = 0;
  for (const pk of weekPicks) {
    if (Object.prototype.hasOwnProperty.call(completedByPlayer, pk.playerId)) {
      completedByPlayer[pk.playerId] += 1;
    }
  }
  const nonSubmitters = active.filter(p => (completedByPlayer[p.playerId] || 0) < totalGames);

  const remindersPlan = [];
  let lockingSoonPlan = null;
  const lockAtMs = effectiveLockAtMs(week, weekGames);

  // Threshold + daily-cadence entries, and the locking-soon notice, are the
  // SCHEDULED path's own output — never built on a `force` (manual) call,
  // which has its own dedicated block below under its own dedup family
  // (`PICKS_REMINDER_MANUAL`). Without this guard a manual click inside a
  // threshold window would double-count: one entry from the threshold loop
  // AND one from the manual block, for the same player, same moment.
  // Otherwise, UNCHANGED gate from before this DI: a resolvable,
  // still-future lock time. The manual force path (below) is deliberately
  // OUTSIDE this gate too: DI-C2's own OPEN_NO_LOCK_TIME category names "no
  // resolvable lock time" as a real, reminder-worthy commissioner gap, so
  // the fix for that gap cannot also be the reason the manual nudge button
  // is silent.
  if (!force && lockAtMs !== null && now < lockAtMs) {
    for (const th of REMINDER_THRESHOLDS) {
      if (now < lockAtMs - th.ms) continue;
      for (const p of active) {
        const remaining = totalGames - (completedByPlayer[p.playerId] || 0);
        if (remaining <= 0) continue;   // a player with zero remaining never receives this
        const dedupKey = `PICKS_REMINDER|${week.weekId}|${th.key}|${p.playerId}`;
        const cp = buildCopy('PICKS_REMINDER', { remainingPicks: remaining, weekN: week.weekNumber, timeUntilLock: th.key }, dedupKey);
        remindersPlan.push({
          playerId: p.playerId,
          dedupKey,
          threshold: th.key,
          remaining,
          category: 'pickReminders',
          title: cp.title,
          body: cp.body,
        });
      }
    }

    // DI-342/DI-C3 §4.1 — the additive daily-cadence branch. Never runs on
    // the force (manual) call — a manual click already IS the nudge for
    // this moment; layering the cadence's own bucket entry on top of it
    // would be two reminders for one commissioner action.
    if (!force) {
      for (const entry of cadenceReminderEntries({
        week, active, completedByPlayer, totalGames, now, cadence, lockAtMs, lastManualPostAtMs, cooldownHours,
      })) {
        remindersPlan.push(entry);
      }
    }

    if (now >= lockAtMs - LOCKING_SOON_MS) {
      const nonSubmitterNames = nonSubmitters.map(p => p.displayName || p.playerId);
      const submittedCount = active.length - nonSubmitterNames.length;
      const lockingSoonDedupBase = `PICKS_LOCKING_SOON|${week.weekId}|locking-soon|`;
      let copyEvent, meta;
      if (!nonSubmitterNames.length) {
        copyEvent = 'PICKS_LOCKING_SOON_ALL_IN';
        meta = { weekN: week.weekNumber, totalPlayers: active.length };
      } else if (nameNonSubmitters) {
        copyEvent = 'PICKS_LOCKING_SOON';
        meta = { weekN: week.weekNumber, timeUntilLock: '1h', namedNonSubmitters: nonSubmitterNames.join(', '), submittedCount, totalPlayers: active.length };
      } else {
        copyEvent = 'PICKS_LOCKING_SOON_COUNT_ONLY';
        meta = { weekN: week.weekNumber, timeUntilLock: '1h', submittedCount, totalPlayers: active.length };
      }
      const cp = buildCopy(copyEvent, meta, lockingSoonDedupBase);
      lockingSoonPlan = {
        entries: active.map(p => ({ playerId: p.playerId, dedupKey: `${lockingSoonDedupBase}${p.playerId}`, category: 'leagueUpdates' })),
        title: cp.title, body: cp.body, meta, copyEvent, nonSubmitters: nonSubmitterNames, submittedCount, totalPlayers: active.length,
        nameNonSubmitters: !!nameNonSubmitters,
      };
    }
  }

  // ── DI-C3 §4.4/§4.5 — THE MANUAL FORCE PATH ("SCRIBE: remind the
  // stragglers"). Two outputs, both gated on there being at least one
  // non-submitter (nobody to remind ⇒ neither fires, matching §4.7's
  // "recommend hidden... nothing to nudge" state):
  //   (a) per-player PICKS_REMINDER-shaped entries, appended to the SAME
  //       remindersPlan array the push loop already iterates — reusing the
  //       push side verbatim (§4.6: "no new push copy needed"), just under
  //       the `PICKS_REMINDER_MANUAL` dedup family instead of a threshold.
  //   (b) `manualPost` — the ONE room post, SCRIBE-voiced (line pools
  //       `PICKS_REMINDER_MANUAL` / `_COUNT_ONLY` in notify-copy.js, written
  //       by the `scribe` agent per §4.5/§4.6 on 2026-09-25), naming
  //       who hasn't submitted only when `nameNonSubmitters` is on
  //       (structurally identical count-only fallback to
  //       PICKS_LOCKING_SOON_COUNT_ONLY's own split).
  let manualPost = null;
  if (force && nonSubmitters.length) {
    for (const p of nonSubmitters) {
      const remaining = totalGames - (completedByPlayer[p.playerId] || 0);
      const dedupKey = `PICKS_REMINDER_MANUAL|${week.weekId}|${runId}|${p.playerId}`;
      const cp = buildCopy('PICKS_REMINDER', { remainingPicks: remaining, weekN: week.weekNumber, timeUntilLock: 'now' }, dedupKey);
      remindersPlan.push({
        playerId: p.playerId, dedupKey, threshold: 'manual', remaining,
        category: 'pickReminders', title: cp.title, body: cp.body,
      });
    }
    const names = nonSubmitters.map(p => p.displayName || p.playerId);
    const submittedCount = active.length - names.length;
    const manualDedup = `PICKS_REMINDER_MANUAL|${week.weekId}|${runId}|post`;
    const manualEvent = nameNonSubmitters ? 'PICKS_REMINDER_MANUAL' : 'PICKS_REMINDER_MANUAL_COUNT_ONLY';
    const manualMeta = nameNonSubmitters
      ? { weekN: week.weekNumber, namedNonSubmitters: names.join(', '), submittedCount, totalPlayers: active.length }
      : { weekN: week.weekNumber, submittedCount, totalPlayers: active.length };
    const cp = buildCopy(manualEvent, manualMeta, manualDedup);
    manualPost = {
      id: `sys_manual_PICKS_REMINDER_MANUAL_${week.weekId}_${runId}`,
      title: cp.title, body: cp.body,
      nonSubmitters: names, submittedCount, totalPlayers: active.length,
      nameNonSubmitters: !!nameNonSubmitters,
    };
  }

  return { remindersPlan, lockingSoonPlan, manualPost };
}

// ══════════════════════════════════════════════════════════════════════════
// DI-C3 §4.4/§4.5 — THE COOLDOWN GATE THAT MUST RUN *BEFORE* THE PLANNER.
// ══════════════════════════════════════════════════════════════════════════
//
// The real enforcement is the SQL `reminders_manual_reserve()` function
// (SECURITY DEFINER, atomic UPDATE, see the migration draft) — the Edge
// Function calls it BEFORE building any plan, writing any row, or sending
// any push (§4.4: "the button's disabled state... is a courtesy, not the
// control"). `planManualReminder()` is that ORDERING, expressed as a pure
// function so it is provable without a database: given the RESULT of the
// reservation call (`reserved`, a plain boolean the caller already has),
// this function calls `computeReminderPlan(..., force:true)` ONLY when
// `reserved` is true. When it is false, `computeReminderPlan` is never
// invoked at all — not "invoked and its output discarded" — which is what
// makes "a same-window repeat call never reaches computeReminderPlan in
// the first place" (§6) something `notifytest.mjs` can assert directly
// rather than infer.
export function planManualReminder({ reserved, week, games, picks, players, now = Date.now(), nameNonSubmitters = true, runId }) {
  if (!reserved) return { remindersPlan: [], lockingSoonPlan: null, manualPost: null, skipped: 'cooldown' };
  return { ...computeReminderPlan({ week, games, picks, players, now, nameNonSubmitters, force: true, runId }), skipped: null };
}

/** `greatest(coalesce(p_cooldown_hours, 3), 1)` — the SQL floor
 *  (`reminders_manual_reserve()`, R-1/R-3) expressed once in JS and shared
 *  by `_fakeManualReserve()` (the test-only mirror of the RESERVATION) and
 *  `cadenceReminderEntries()`'s D-13 suppression (a READ-ONLY comparison
 *  against the same stamp, on the scheduled path) — two different USES of
 *  one number, which must never drift into two different floors. */
export function cooldownFloorHours(raw) {
  const v = (raw === null || raw === undefined) ? 3 : Number(raw);
  return Math.max(Number.isFinite(v) ? v : 3, 1);
}

/**
 * TEST-ONLY pure model of `reminders_manual_reserve()`'s SQL arithmetic
 * (`v_hours := greatest(coalesce(p_cooldown_hours, 3), 1)`, then an atomic
 * "was the last post more than v_hours ago (or never)" check) — R-1/R-3 of
 * the security re-audit. The SQL function IN THE MIGRATION DRAFT is the
 * source of truth; this mirrors its arithmetic so the "a configured 0 still
 * enforces a 1-hour floor" and "before any plan" contracts have a fast,
 * DB-less proof in `notifytest.mjs` alongside the SQL. NEVER imported by
 * `reminders/index.js` — the real function is a database call, not this.
 */
export function _fakeManualReserve({ lastPostAtMs = null, nowMs = Date.now(), cooldownHours = null } = {}) {
  const hours = cooldownFloorHours(cooldownHours);
  const windowMs = hours * 60 * 60 * 1000;
  if (lastPostAtMs === null || lastPostAtMs === undefined || (nowMs - lastPostAtMs) >= windowMs) {
    return { reserved: true, lastPostAtMs: nowMs, hours };
  }
  return { reserved: false, lastPostAtMs, hours };
}

// ══════════════════════════════════════════════════════════════════════════
// DI-342/DI-C3 §4.1/§4.3 — CADENCE. "one planner, daily default, thresholds
// kept" (D-13, quoted verbatim in the DI's own coverage matrix, C6).
// ══════════════════════════════════════════════════════════════════════════

/** The closed set of `settings.reminderCadence` values (§4.3). */
export const REMINDER_CADENCE_VALUES = Object.freeze(['daily', 'twice-daily', 'hourly-final-day', 'thresholds-only']);

/** Unrecognised/absent reads as `'daily'` — §4.1's own stated default. */
export function normalizeCadence(raw) {
  const v = String(raw === undefined || raw === null ? '' : raw).trim();
  return REMINDER_CADENCE_VALUES.includes(v) ? v : 'daily';
}

/** UTC calendar-day string, e.g. "2026-09-25" — the "day bucket" every
 *  once-per-day dedup key in this module (cadence AND the DI-342 §3.1
 *  commissioner-ops categories) is built from. Calendar-day bucketing
 *  (rather than "N hours since first crossing") is what makes "once per
 *  day while the condition holds" survive an inconsistent cron interval or
 *  a missed tick without extra state. */
export function utcDateKey(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The additive daily-cadence entries for ONE scan, alongside (never
 * replacing) the threshold loop. Each cadence option buckets "now" into a
 * window; the SAME bucket produces the SAME dedup key on every call inside
 * it, so the `notifications` table's own unique-key upsert is what actually
 * enforces "once per bucket" — this function does not track state itself.
 *
 *   daily             one bucket per UTC calendar day.
 *   twice-daily        one bucket per 12-hour window.
 *   hourly-final-day    one bucket per UTC hour, and ONLY on the UTC day the
 *                       week is scheduled to lock (no `lockAtMs` known, or a
 *                       different day ⇒ no entries this scan).
 *   thresholds-only     no entries — today's behaviour, unchanged.
 *
 * D-13 SUPPRESSION (coordinator ruling, fix round 1, 2026-09-25) — "manual
 * SCRIBE button forces + [suppresses the next scheduled daily post for] 3h"
 * (D-13's own words, quoted verbatim in the DI's coverage matrix C6/§4.4).
 * `lastManualPostAtMs` is a READ-ONLY fact the scheduled caller supplies
 * (`scribe_rate.last_post_at` for key `reminders:manual`, read with NO
 * reservation — the scheduled path never claims the floor, only checks it,
 * exactly as §4.4's own text already distinguished: "read-only comparison
 * against `now() - cooldownHours`, no reservation needed on the scheduled
 * side since it is not itself claiming the floor"). `cooldownHours` is the
 * SAME `settings.reminderCooldownHours` value the manual RPC floors via
 * `cooldownFloorHours()` — one shared floor, two readers.
 */
export function cadenceReminderEntries({
  week, active, completedByPlayer, totalGames, now, cadence, lockAtMs,
  lastManualPostAtMs = null, cooldownHours = null,
}) {
  const c = normalizeCadence(cadence);
  if (c === 'thresholds-only') return [];
  if (lastManualPostAtMs !== null && lastManualPostAtMs !== undefined) {
    const hours = cooldownFloorHours(cooldownHours);
    if (now - lastManualPostAtMs < hours * 60 * 60 * 1000) return [];
  }
  let bucket = null;
  if (c === 'daily') {
    bucket = utcDateKey(now);
  } else if (c === 'twice-daily') {
    bucket = `h${Math.floor(now / (12 * 60 * 60 * 1000))}`;
  } else if (c === 'hourly-final-day') {
    if (lockAtMs === null || lockAtMs === undefined || utcDateKey(now) !== utcDateKey(lockAtMs)) return [];
    bucket = `hr${Math.floor(now / (60 * 60 * 1000))}`;
  }
  if (bucket === null) return [];
  const entries = [];
  for (const p of active || []) {
    const remaining = totalGames - (completedByPlayer[p.playerId] || 0);
    if (remaining <= 0) continue;
    const dedupKey = `PICKS_REMINDER_CADENCE|${week.weekId}|${c}_${bucket}|${p.playerId}`;
    const cp = buildCopy('PICKS_REMINDER', { remainingPicks: remaining, weekN: week.weekNumber, timeUntilLock: 'today' }, dedupKey);
    entries.push({ playerId: p.playerId, dedupKey, threshold: `cadence:${c}`, remaining, category: 'pickReminders', title: cp.title, body: cp.body });
  }
  return entries;
}

// ══════════════════════════════════════════════════════════════════════════
// DI-342/DI-C2 — COMM-REMINDERS. Four pure category detectors, one per row
// of §3.1's table, plus the assembler that turns "which weeks are due" into
// a plan `reminders/index.js` can write. Every detector returns `null`
// (not due) or a small fact object (due) — never a copy/dedup key itself,
// so the assembler is the ONE place those are built (consistent with the
// player-facing planner's own shape above).
// ══════════════════════════════════════════════════════════════════════════

/** The lead time (days) DI-C2 §3.1's copy calls "{N}" — also the cold-start
 *  anchor (see `deriveUsualOpenGapHours`'s header) when there isn't enough
 *  history yet to derive a real median. */
export const SLATE_NOT_BUILT_DEFAULT_N_DAYS = 2;
/** How many of the league's most recent non-demo weeks (with an `openedAt`)
 *  feed the median-gap derivation. */
export const REMINDER_HISTORY_WEEKS = 4;
/** DI-C2 §3.1, LIVE_NOT_FINALIZED — 24h after the week's own
 *  `pendingFinalizationSinceMs` anchor (see that detector's own note on
 *  where that anchor comes from). */
export const LIVE_NOT_FINALIZED_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/**
 * Median gap, in HOURS, between a week's `createdAt` and its `openedAt`,
 * over up to the last `REMINDER_HISTORY_WEEKS` non-demo weeks that HAVE an
 * `openedAt` (the migration draft's new column, stamped by
 * `transition_week()` on the first `draft→open` move — see §5). Returns
 * `null` when fewer than 2 such weeks exist — DI-C2 §3.1's own name for the
 * cold-start case ("first-season cold start, or a league whose weeks
 * predate this column").
 */
export function deriveUsualOpenGapHours(weeksHistory) {
  const gaps = (weeksHistory || [])
    .filter(w => w && w.dataSourceMode !== 'demo' && w.createdAt && w.openedAt)
    .map(w => (new Date(w.openedAt).getTime() - new Date(w.createdAt).getTime()) / (60 * 60 * 1000))
    .filter(h => Number.isFinite(h) && h >= 0);
  const recent = gaps.slice(-REMINDER_HISTORY_WEEKS);
  if (recent.length < 2) return null;
  const sorted = [...recent].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** DI-C reviewer BLOCK, fix round 1 (2026-09-25) — the grace period
 *  `slateNotBuiltDue()`'s warn instant is never earlier than this many ms
 *  after `createdAt`, REGARDLESS of the derived usual-open instant. This is
 *  what stops a week created 2 minutes ago from firing immediately (the
 *  cold-start reading this replaces: `warnAt = createdAt`). */
export const SLATE_NOT_BUILT_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * DI-C2 §3.1, row 1 — SLATE_NOT_BUILT. A `draft` week with zero games, once
 * its warn instant has been crossed.
 *
 * COORDINATOR RULING (reviewer BLOCK, fix round 1, 2026-09-25) — replaces
 * this function's earlier "N days before usual-open" reading, which fired
 * IMMEDIATELY at creation in the cold-start case (no history):
 *
 *   warnAtMs = max(usualOpenAtMs - 24h, createdAtMs + 24h)     [history exists]
 *   warnAtMs = createdAtMs + 24h                                [cold start]
 *
 * A 24-HOUR GRACE AFTER CREATION, ALWAYS — a week created minutes ago never
 * fires, history or not. AND NEVER EARLIER THAN ONE DAY BEFORE THE DERIVED
 * USUAL-OPEN TIME — a league with real history still gets an early-enough
 * warning to act before the slate is actually overdue (DRAFT_PAST_OPEN, the
 * escalation, fires once it genuinely is).
 *
 * COPY FOLLOWS SUIT: `n` (the "usually opens in about {n} days" fact) is
 * only returned when a real median exists — ROUNDED FROM THE MEDIAN itself,
 * not the old fixed constant, since a fixed "2 days" was never what the
 * league's own history said. Cold start returns `n: null`; the assembler
 * omits it from `buildCopy()`'s meta, and notify-copy.js's own null-safety
 * (`m.weekN != null && m.n != null`) drops to the plain "Week {weekN} has
 * no games yet." sentence rather than rendering a number nobody derived.
 */
export function slateNotBuiltDue({ week, now = Date.now(), weeksHistory = [] }) {
  if (!week || week.status !== 'draft' || (Number(week.gamesCount) || 0) > 0 || !week.createdAt) return null;
  const createdAtMs = new Date(week.createdAt).getTime();
  if (!Number.isFinite(createdAtMs)) return null;
  const medianGapHours = deriveUsualOpenGapHours(weeksHistory);
  const graceFloorMs = createdAtMs + SLATE_NOT_BUILT_GRACE_MS;
  let warnAtMs, n;
  if (medianGapHours === null) {
    warnAtMs = graceFloorMs;
    n = null;
  } else {
    const usualOpenAtMs = createdAtMs + medianGapHours * 60 * 60 * 1000;
    warnAtMs = Math.max(usualOpenAtMs - SLATE_NOT_BUILT_GRACE_MS, graceFloorMs);
    n = Math.max(1, Math.round(medianGapHours / 24));
  }
  if (now < warnAtMs) return null;
  return { weekId: week.weekId, dayBucket: utcDateKey(now), n };
}

/**
 * DI-C2 §3.1, row 2 — DRAFT_PAST_OPEN. A `draft` week (any game count) past
 * its "should be open by" instant: the commissioner's own explicit
 * `picksOpenAt` when set, else the same derived/cold-start usual-open
 * instant `slateNotBuiltDue` uses (so a week with no explicit Auto-Open time
 * still gets a real, self-calibrating answer rather than never firing).
 */
export function draftPastOpenDue({ week, now = Date.now(), weeksHistory = [] }) {
  if (!week || week.status !== 'draft' || !week.createdAt) return null;
  const createdAtMs = new Date(week.createdAt).getTime();
  if (!Number.isFinite(createdAtMs)) return null;
  let shouldBeOpenByMs;
  if (week.picksOpenAt) {
    const t = new Date(week.picksOpenAt).getTime();
    if (!Number.isFinite(t)) return null;
    shouldBeOpenByMs = t;
  } else {
    const medianGapHours = deriveUsualOpenGapHours(weeksHistory);
    shouldBeOpenByMs = medianGapHours === null
      ? createdAtMs + SLATE_NOT_BUILT_DEFAULT_N_DAYS * 24 * 60 * 60 * 1000
      : createdAtMs + medianGapHours * 60 * 60 * 1000;
  }
  if (now < shouldBeOpenByMs) return null;
  return { weekId: week.weekId, dayBucket: utcDateKey(now) };
}

/**
 * DI-C2 §3.1, row 3 — OPEN_NO_LOCK_TIME. An `open` week with at least one
 * game whose effective lock time cannot be resolved at all.
 *
 * DEDUP-KEY SHAPE FLAGGED: §3.1's table gives this category's key as
 * `OPEN_NO_LOCK_TIME|{weekId}` (no day part) while its own "Cadence" column
 * for the same row says "Once per day while unresolved" — the two clauses
 * disagree (a key with no day component can only ever fire once, ever, not
 * daily). The STATED BEHAVIOUR (daily) is followed here; the assembler
 * builds this category's key with the same `dayBucket` every other category
 * uses. Flagged for `reviewer`/Drew rather than silently picking one.
 */
export function openNoLockTimeDue({ week, games, now = Date.now() }) {
  if (!week || week.status !== 'open') return null;
  const weekGames = (games || []).filter(g => g && g.weekId === week.weekId);
  if (!weekGames.length) return null;
  if (effectiveLockAtMs(week, weekGames) !== null) return null;
  return { weekId: week.weekId, dayBucket: utcDateKey(now) };
}

/**
 * DI-C2 §3.1, row 4 — LIVE_NOT_FINALIZED. A `live` week with
 * `pendingFinalization` true, sitting that way 24h past
 * `pendingFinalizationSinceMs`.
 *
 * THE ANCHOR IS CALLER-SUPPLIED, NEVER FABRICATED HERE (CONVENTIONS #7):
 * `weeks` carries no dedicated "when did pendingFinalization become true"
 * timestamp (the migration draft adds `opened_at`, not this — out of this
 * DI's approved migration scope). `reminders/index.js` passes `weeks.
 * updated_at` as the best available anchor, named as an imprecision (an
 * unrelated field edit also bumps `updated_at`) rather than silently
 * treated as exact. A week with no anchor available simply never fires this
 * category, rather than guessing one.
 */
export function liveNotFinalizedDue({ week, now = Date.now() }) {
  if (!week || week.status !== 'live' || !week.pendingFinalization) return null;
  const sinceMs = Number(week.pendingFinalizationSinceMs);
  if (!Number.isFinite(sinceMs)) return null;
  if (now - sinceMs < LIVE_NOT_FINALIZED_THRESHOLD_MS) return null;
  return { weekId: week.weekId, dayBucket: utcDateKey(now) };
}

/** Per-category fact keys `buildCopy()` may substitute — kept in one place
 *  so the assembler and notify-copy.js's ALLOWED_META_KEYS agree by
 *  construction rather than by two authors remembering the same list. */
function commissionerOpsMeta(category, item) {
  if (category === 'SLATE_NOT_BUILT') return { weekN: item.weekN, n: item.n };
  return { weekN: item.weekN };
}

/**
 * COORDINATOR RULING (reviewer BLOCK, fix round 1, 2026-09-25) — THE
 * RECENCY BOUND. Before this, every draft/open/live week in the league's
 * ENTIRE history was scanned every run — an abandoned week-3 draft, long
 * superseded by an active week 6, fired SLATE_NOT_BUILT/DRAFT_PAST_OPEN
 * forever, because nothing ever marked it "done" (a draft that never opens
 * has no terminal state).
 *
 * SCOPE OF THIS BOUND (narrowed by reviewer BLOCK, fix round 2, 2026-09-25):
 * it governs the THREE DRAFT/OPEN detectors ONLY — `slateNotBuiltDue`,
 * `draftPastOpenDue`, `openNoLockTimeDue`. `liveNotFinalizedDue` is EXEMPT
 * and is evaluated over every non-demo week; see the exemption's own
 * reasoning in `computeCommissionerOpsPlan()` below. Do not re-widen this
 * function's callers to include the finalize detector.
 *
 * The scan is scoped to:
 *
 *   the ACTIVE week (by `activeWeekId`), PLUS
 *   the SINGLE next week by `weekNumber` (the smallest `weekNumber`
 *     strictly greater than the active week's — "on deck", not every
 *     future week ever created), OR, if no active week resolves at all,
 *   the SINGLE newest draft week (by `weekNumber`) — a league with no
 *     active week yet (pre-season, or between weeks) still gets exactly
 *     one week checked, never zero and never all of them.
 *
 * NO WEEK WHOSE weekNumber IS LESS THAN THE ACTIVE WEEK'S IS EVER ELIGIBLE,
 * full stop — the hard exclusion `docs/SESSION_LOG...` fix round 1 names by
 * example ("an abandoned week-3 draft fires nothing while week 6 is
 * active"). `weeksHistory` for the median derivation is UNAFFECTED by this
 * bound — deriveUsualOpenGapHours() still reads the league's last 4
 * opened weeks regardless of which one or two are eligible for a fresh
 * ops reminder this scan; the bound is about WHO gets nudged, not what data
 * trains the estimate.
 */
function eligibleOpsWeeks(weeks, activeWeekId) {
  const all = (weeks || []).filter((w) => w && w.dataSourceMode !== 'demo');
  const activeWeek = activeWeekId ? all.find((w) => w.weekId === activeWeekId) : null;
  if (activeWeek && typeof activeWeek.weekNumber === 'number') {
    const activeNum = activeWeek.weekNumber;
    const nextWeek = all
      .filter((w) => w.weekId !== activeWeek.weekId && typeof w.weekNumber === 'number' && w.weekNumber > activeNum)
      .sort((a, b) => a.weekNumber - b.weekNumber)[0] || null;
    return nextWeek ? [activeWeek, nextWeek] : [activeWeek];
  }
  const drafts = all.filter((w) => w.status === 'draft' && typeof w.weekNumber === 'number');
  const newestDraft = drafts.sort((a, b) => b.weekNumber - a.weekNumber)[0] || null;
  return newestDraft ? [newestDraft] : [];
}

/**
 * THE ASSEMBLER. Runs the four detectors over TWO DELIBERATELY DIFFERENT
 * week lists and returns one plan item per (category, week) that is due —
 * `{ category, weekId, weekN, dedupKey, title, body }`.
 * `reminders/index.js` fans each item out to every commissioner (§3.3:
 * "commissioner is not a singleton role"), independently opt-out-checked
 * per commissioner.
 *
 * LIST 1 — `eligibleOpsWeeks()` (recency-bounded: the active week + the
 * single next week, or the single newest draft) feeds the three
 * DRAFT/OPEN detectors: SLATE_NOT_BUILT, DRAFT_PAST_OPEN,
 * OPEN_NO_LOCK_TIME. Those three describe a week that has NOT YET STARTED
 * and have no terminal state of their own, so without the bound an
 * abandoned draft nags forever (fix round 1's defect).
 *
 * LIST 2 — EVERY non-demo week feeds LIVE_NOT_FINALIZED. This exemption is
 * the fix for the bound's own blind spot (reviewer BLOCK, fix round 2,
 * 2026-09-25): the finalize nudge's subject is NECESSARILY OLDER than the
 * active week. `createWeekFromWizard()` calls `setActiveWeekId()` the
 * instant week N+1 is created (`js/week-wizard.js`), so the moment the
 * commissioner starts week 6, week 5 — sitting `live` with every game
 * final, waiting to be finalized — drops below the bound and its "ready to
 * finalize" nudge goes silent PERMANENTLY. Verified by probe: week 5
 * `live` + `pendingFinalization` 40h past the anchor, week 6 a newer
 * draft, active = w6 ⇒ the plan contained only `DRAFT_PAST_OPEN:w6`.
 *
 * WHY THE EXEMPTION IS SAFE (this detector, and only this one): it is
 * SELF-BOUNDING — `status === 'live'` AND `pendingFinalization` AND ≥24h
 * past the anchor is a narrow, rare state that only a real week reaches —
 * and SELF-RESOLVING: finalizing the week moves it to `final` and the
 * category stops matching, which is exactly the terminal state the other
 * three lack. It cannot nag forever, because acting on it ends it.
 *
 * NO WEEK IS SCANNED TWICE FOR THE SAME CATEGORY: list 1 runs only the
 * three bounded detectors, list 2 runs only the finalize detector, so a
 * week present in both (the active week) still yields at most one item per
 * category.
 *
 * `weeksHistory` (the median-gap derivation's own input) is the FULL,
 * unbounded week list — only which weeks get a fresh reminder THIS scan is
 * bounded, never what trains the estimate.
 */
export function computeCommissionerOpsPlan({ weeks, games, now = Date.now(), activeWeekId = null }) {
  const items = [];
  const weeksHistory = weeks || [];
  // LIST 1 — recency-bounded: the three draft/open detectors.
  const scoped = eligibleOpsWeeks(weeks, activeWeekId);
  for (const week of scoped) {
    if (!week || week.dataSourceMode === 'demo') continue;
    const slate = slateNotBuiltDue({ week, now, weeksHistory });
    if (slate) items.push({ category: 'SLATE_NOT_BUILT', weekId: week.weekId, weekN: week.weekNumber, n: slate.n, dayBucket: slate.dayBucket });
    const draftPast = draftPastOpenDue({ week, now, weeksHistory });
    if (draftPast) items.push({ category: 'DRAFT_PAST_OPEN', weekId: week.weekId, weekN: week.weekNumber, dayBucket: draftPast.dayBucket });
    const noLock = openNoLockTimeDue({ week, games, now });
    if (noLock) items.push({ category: 'OPEN_NO_LOCK_TIME', weekId: week.weekId, weekN: week.weekNumber, dayBucket: noLock.dayBucket });
  }
  // LIST 2 — UNBOUNDED, this detector only. See the exemption's reasoning
  // in this function's header: the finalize nudge's subject is always an
  // older week than the one the wizard just made active.
  for (const week of weeksHistory) {
    if (!week || week.dataSourceMode === 'demo') continue;
    const liveNF = liveNotFinalizedDue({ week, now });
    if (liveNF) items.push({ category: 'LIVE_NOT_FINALIZED', weekId: week.weekId, weekN: week.weekNumber, dayBucket: liveNF.dayBucket });
  }
  return items.map((it) => {
    const dedupKey = `${it.category}|${it.weekId}|${it.dayBucket}`;
    const cp = buildCopy(it.category, commissionerOpsMeta(it.category, it), dedupKey);
    return { category: it.category, weekId: it.weekId, weekN: it.weekN, dedupKey, title: cp.title, body: cp.body };
  });
}
