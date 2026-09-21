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
export function computeReminderPlan({ week, games, picks, players, now = Date.now(), nameNonSubmitters = true }) {
  const empty = { remindersPlan: [], lockingSoonPlan: null };
  if (!week || week.dataSourceMode === 'demo' || week.status !== 'open') return empty;

  const weekGames = (games || []).filter(g => g && g.weekId === week.weekId);
  const totalGames = weekGames.length;
  if (!totalGames) return empty;

  const lockAtMs = effectiveLockAtMs(week, weekGames);
  if (lockAtMs === null) return empty;
  if (now >= lockAtMs) return empty;   // PICKS_LOCKED fires client-side, not here

  const active = (players || []).filter(p => p && p.active);
  const weekPicks = (picks || []).filter(pk => pk && pk.weekId === week.weekId);
  const completedByPlayer = {};
  for (const p of active) completedByPlayer[p.playerId] = 0;
  for (const pk of weekPicks) {
    if (Object.prototype.hasOwnProperty.call(completedByPlayer, pk.playerId)) {
      completedByPlayer[pk.playerId] += 1;
    }
  }

  const remindersPlan = [];
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

  let lockingSoonPlan = null;
  if (now >= lockAtMs - LOCKING_SOON_MS) {
    const nonSubmitters = active.filter(p => (completedByPlayer[p.playerId] || 0) < totalGames).map(p => p.displayName || p.playerId);
    const submittedCount = active.length - nonSubmitters.length;
    const lockingSoonDedupBase = `PICKS_LOCKING_SOON|${week.weekId}|locking-soon|`;
    let copyEvent, meta;
    if (!nonSubmitters.length) {
      copyEvent = 'PICKS_LOCKING_SOON_ALL_IN';
      meta = { weekN: week.weekNumber, totalPlayers: active.length };
    } else if (nameNonSubmitters) {
      copyEvent = 'PICKS_LOCKING_SOON';
      meta = { weekN: week.weekNumber, timeUntilLock: '1h', namedNonSubmitters: nonSubmitters.join(', '), submittedCount, totalPlayers: active.length };
    } else {
      copyEvent = 'PICKS_LOCKING_SOON_COUNT_ONLY';
      meta = { weekN: week.weekNumber, timeUntilLock: '1h', submittedCount, totalPlayers: active.length };
    }
    const cp = buildCopy(copyEvent, meta, lockingSoonDedupBase);
    lockingSoonPlan = {
      entries: active.map(p => ({ playerId: p.playerId, dedupKey: `${lockingSoonDedupBase}${p.playerId}`, category: 'leagueUpdates' })),
      title: cp.title, body: cp.body, meta, copyEvent, nonSubmitters, submittedCount, totalPlayers: active.length,
      nameNonSubmitters: !!nameNonSubmitters,
    };
  }

  return { remindersPlan, lockingSoonPlan };
}
