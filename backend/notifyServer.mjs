/**
 * backend/notifyServer.mjs — TESTED TWIN of backend/Code.gs's
 * scanReminders()/notifyPush() PURE decision logic.
 *
 * WHY THIS FILE EXISTS (same reasoning as backend/chunkstore.mjs — see that
 * file's header): backend/Code.gs is Google Apps Script and cannot run under
 * node, and hand-porting it inside a test risks silent drift between the
 * port and the deployed script. This module is the PURE part of the
 * reminder-scan decision logic (which thresholds fire, for which players,
 * with what dedupKeys and bodies — never the Sheet I/O) as importable ES
 * functions. notifytest.mjs tests THESE directly; Code.gs carries a verbatim
 * port of the same constants and control flow (`REMINDER_THRESHOLDS`,
 * `LOCKING_SOON_MS`, `firstKickoffMs_`, `effectiveLockAtMs_`,
 * `isValidDedupKey`) and this module's own twin-sync check greps Code.gs to
 * confirm the two have not diverged in NAME (not full behavioral proof —
 * genuinely a smaller guarantee than chunkstore.mjs's, flagged honestly in
 * the handoff report).
 *
 * The only things Code.gs does that this module does not: the Sheet I/O
 * (getMany/CFBP_NOTIFY_SENT read-check-append), the LockService critical
 * section, and the actual UrlFetchApp call to OneSignal. Those are
 * unavoidably Apps-Script-specific and confirmed only by a real deploy.
 *
 * DEPLOY IS MANUAL. Editing Code.gs changes nothing until Drew runs
 * Deploy -> Manage deployments -> Edit -> New version on the SAME deployment.
 */

// F7 remediation (2026-09-10) — this module runs under Node, so unlike
// Code.gs it CAN import js/notify-copy.js directly rather than carrying its
// own ported copy of the SCRIBE pools — zero drift by construction for THIS
// twin. Code.gs (real GAS, cannot import an ES module) still carries a
// manual port; notifytest.mjs's drift test (F5) diffs Code.gs's ported
// arrays against notify-copy.js's own `_poolsForTest()` export directly.
import { buildCopy } from '../js/notify-copy.js';

// -- Constants -- MUST match backend/Code.gs verbatim (notifytest.mjs twin-sync) --
export const REMINDER_THRESHOLDS = [
  { key: '24h', ms: 24 * 60 * 60 * 1000 },
  { key: '1h', ms: 60 * 60 * 1000 },
  { key: '15m', ms: 15 * 60 * 1000 },
];
export const LOCKING_SOON_MS = 60 * 60 * 1000;

/** Port of js/scoring.js's computeFirstKickoff — GAS cannot import that
 *  module, so both Code.gs and this twin carry their own small copy. */
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

/**
 * F10 remediation (2026-09-10) — twin of backend/Code.gs's
 * selectActiveOpenWeek_(). Selects the SAME active week js/storage.js's
 * getCurrentWeek() would (cfbp_active_week first), with an explicit
 * earliest-lock tiebreak when more than one week is simultaneously OPEN and
 * no active pointer resolves one — replaces the old "first open in array
 * order" behavior scanReminders() used to have.
 */
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

/**
 * BLOCKING #1 remediation (2026-09-10) — pure JS twin of Code.gs's
 * resolveServerPushIntent_(), which itself mirrors js/notifications.js's
 * resolveIntent() for the server-fired reminder path: push fires only if the
 * recipient's master toggle AND (when the event is category-gated) the
 * category toggle are both on. Default-when-missing reads as ON for both —
 * same opt-out model as js/storage.js's getNotifyPushMasterFor()/
 * getNotifyCategoryPrefsFor()/DEFAULT_NOTIFY_CATEGORIES. Does NOT gate
 * whether a candidate is "fresh" (logged) — only whether it is actually
 * pushed; see applyPlan() below, which logs every fresh candidate regardless
 * and calls this only to decide the push subset.
 */
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

/**
 * 2026-09-10 (Drew's option 2) — twin of backend/Code.gs's
 * notifyNameNonSubmittersEnabled_(). Parses the NOTIFY_NAME_NON_SUBMITTERS
 * Script Property's RAW value into a boolean.
 *
 * DEFAULT-WHEN-MISSING IS TRUE (CONVENTIONS #10 applied to a config
 * property): a deployment that never sets the property behaves exactly as it
 * did before the property existed. ONLY the literal string 'false'
 * (case/whitespace-insensitive) turns naming off; any other value — including
 * a typo — reads as true, so a fat-fingered property can never silently move
 * behavior in the surprising direction.
 *
 * notifytest.mjs EXECUTES the real Code.gs function out of source and compares
 * it against this one case-for-case, so the two cannot drift in behavior.
 */
export function readNameNonSubmittersFlag(raw) {
  if (raw === null || raw === undefined) return true;
  return String(raw).trim().toLowerCase() !== 'false';
}

/** correction #5 — dedupKey shape validation. Must match Code.gs's
 *  isValidDedupKey() and js/notifications.js's makeDedupKey() format exactly:
 *  `${event}|${weekId}|${threshold}|${playerId}`, 4 pipe-delimited parts,
 *  event and playerId non-empty. */
export function isValidDedupKey(dedupKey) {
  if (typeof dedupKey !== 'string') return false;
  if (dedupKey.length < 3 || dedupKey.length > 300) return false;
  const parts = dedupKey.split('|');
  if (parts.length !== 4) return false;
  if (!parts[0] || !parts[3]) return false;
  return true;
}

/**
 * Pure port of scanReminders()'s DECISION logic (no Sheet I/O, no dedup
 * lookup — that's CFBP_NOTIFY_SENT's job, exercised separately). Given the
 * current OPEN week, its games/picks/players and "now", returns the plan:
 * everything that WOULD fire this scan, before any dedup check.
 *
 *   { remindersPlan: [{ playerId, dedupKey, threshold, remaining, body }],
 *     lockingSoonPlan: null | { entries:[{playerId,dedupKey}], body, meta,
 *                               nonSubmitters, submittedCount, totalPlayers,
 *                               nameNonSubmitters } }
 *
 * `nameNonSubmitters` (2026-09-10, Drew's option 2) mirrors Code.gs's
 * NOTIFY_NAME_NON_SUBMITTERS Script Property, read once per scan — see
 * readNameNonSubmittersFlag() above. TRUE (the default) keeps the named-
 * laggard copy; FALSE selects the count-only pool and places no player name
 * in the body OR in `meta`.
 *
 * NOTE on the returned `nonSubmitters` array: it is the scan's own local
 * computation (Code.gs computes the identical list to derive submittedCount,
 * in both modes) and is exposed here purely so a test can assert against it.
 * It is NEVER what ships — `body` and `meta` are, and those are the two
 * things the count-only mode is proven against.
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
      remindersPlan.push({
        playerId: p.playerId,
        dedupKey,
        threshold: th.key,
        remaining,
        // BLOCKING #1 remediation — matches js/notifications.js's
        // CATEGORY_OF_EVENT[PICKS_REMINDER] exactly.
        category: 'pickReminders',
        body: buildCopy('PICKS_REMINDER', { remainingPicks: remaining, weekN: week.weekNumber, timeUntilLock: th.key }, dedupKey).body,
      });
    }
  }

  let lockingSoonPlan = null;
  if (now >= lockAtMs - LOCKING_SOON_MS) {
    const nonSubmitters = active.filter(p => (completedByPlayer[p.playerId] || 0) < totalGames).map(p => p.displayName || p.playerId);
    const submittedCount = active.length - nonSubmitters.length;
    const lockingSoonDedupBase = `PICKS_LOCKING_SOON|${week.weekId}|locking-soon|`;
    // Three disjoint (event, meta) shapes — chosen here, never mixed. In
    // count-only mode `namedNonSubmitters` is not placed in `meta` at all
    // (not blanked, not joined-then-dropped), and buildCopy() would drop it
    // anyway since it is absent from PICKS_LOCKING_SOON_COUNT_ONLY's own
    // allow-list (js/notify-copy.js) — belt and braces, on purpose.
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
    const body = buildCopy(copyEvent, meta, lockingSoonDedupBase).body;
    lockingSoonPlan = {
      // BLOCKING #1 remediation — matches js/notifications.js's
      // CATEGORY_OF_EVENT[PICKS_LOCKING_SOON] exactly.
      entries: active.map(p => ({ playerId: p.playerId, dedupKey: `${lockingSoonDedupBase}${p.playerId}`, category: 'leagueUpdates' })),
      body, meta, copyEvent, nonSubmitters, submittedCount, totalPlayers: active.length,
      nameNonSubmitters: !!nameNonSubmitters,
    };
  }

  return { remindersPlan, lockingSoonPlan };
}

/** In-memory twin of CFBP_NOTIFY_SENT for tests that want to exercise
 *  dedup-across-repeated-scans without a real Sheet. Mirrors
 *  dedupKeyAlreadySent/appendNotifySentRow's append-only, check-then-write
 *  shape (Code.gs). */
export function makeFakeNotifySentStore() {
  const sent = new Set();
  return {
    alreadySent: (dedupKey) => sent.has(dedupKey),
    markSent: (dedupKey) => sent.add(dedupKey),
    size: () => sent.size,
  };
}

/**
 * Applies a computeReminderPlan() result against a fake CFBP_NOTIFY_SENT
 * store, mirroring Code.gs's applyReminderScanCandidates_() dedup-then-
 * batch-send shape.
 *
 * BLOCKING #1 remediation (2026-09-10) — REPLACES the old bare-array return.
 * Returns `{ calls, logEntries }`:
 *   logEntries — every dedup-FRESH candidate this call newly marked sent,
 *                regardless of preference (the twin's analogue of a
 *                CFBP_NOTIFY_LOG row — Code.gs writes that row for every
 *                fresh candidate unconditionally; this array is what a test
 *                checks to confirm "the record still exists" even when no
 *                push went out).
 *   calls      — the OneSignal "calls" that would actually go out, ONE per
 *                reminder entry (personalized) and at most one for locking-
 *                soon (batched across every push-ELIGIBLE newly-fresh
 *                player) — filtered by resolveServerPushIntent() exactly as
 *                Code.gs's applyReminderScanCandidates_ filters `pushEligible`.
 *
 * `players` (optional, defaults to []) — looked up by playerId to resolve
 * each candidate's push preference; omitting it (or passing players with no
 * preferences set) means every fresh candidate reads as opted-in (default-
 * when-missing), so existing callers that don't care about preferences are
 * unaffected.
 */
export function applyPlan(plan, store, players = []) {
  const byId = new Map((players || []).map(p => [p.playerId, p]));
  const calls = [];
  const logEntries = [];
  for (const r of plan.remindersPlan) {
    if (store.alreadySent(r.dedupKey)) continue;
    store.markSent(r.dedupKey);
    logEntries.push({ event: 'PICKS_REMINDER', playerId: r.playerId, dedupKey: r.dedupKey, body: r.body });
    if (resolveServerPushIntent({ player: byId.get(r.playerId), category: r.category || 'pickReminders' })) {
      calls.push({ event: 'PICKS_REMINDER', playerIds: [r.playerId], body: r.body });
    }
  }
  if (plan.lockingSoonPlan) {
    const fresh = plan.lockingSoonPlan.entries.filter(e => !store.alreadySent(e.dedupKey));
    fresh.forEach(e => store.markSent(e.dedupKey));
    fresh.forEach(e => logEntries.push({ event: 'PICKS_LOCKING_SOON', playerId: e.playerId, dedupKey: e.dedupKey, body: plan.lockingSoonPlan.body }));
    const pushEligible = fresh.filter(e => resolveServerPushIntent({ player: byId.get(e.playerId), category: e.category || 'leagueUpdates' }));
    if (pushEligible.length) {
      calls.push({ event: 'PICKS_LOCKING_SOON', playerIds: pushEligible.map(e => e.playerId), body: plan.lockingSoonPlan.body });
    }
  }
  return { calls, logEntries };
}
