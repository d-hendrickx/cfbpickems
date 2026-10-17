/**
 * CFB Pickems — week-lock.js (D1 / FB-001 / UN-414, PF-414 / DI-509)
 *
 * ONE answer to "is this week open for editing right now?" for every surface that shows or acts on it: the week navigator's badge, the lock
 * countdown, the timing line, `canPlayerSubmitPicks` (and so the submit button and Edit My Picks), the Picks form, the Home Now card, the
 * commissioner's Manage line. Before this file each of them read `week.status` (or its own copy of the clock test), and the stored status
 * flips only on a commissioner's open phone or the server job — so a week 30 minutes from kickoff could say OPEN on one surface and
 * "Picks are locked" on the next. (The defect Drew reported: "it says picks lock 30 min before kickoff but its still listed as open and i
 * can still change my picks".)
 *
 * A pure leaf. It imports `computeEffectiveLockAt` (scoring.js) and the week constants (data-model.js) and nothing else; it touches no
 * storage, no DOM and no clock but the one it is handed. `scoring.js`, `storage.js` and `getEffectiveWeekStatus()` are NOT edited:
 * `getEffectiveWeekStatus` has about twenty callers, `arePicksPublic` (the blind rule) among them, and stays byte-identical. This file is
 * DENY-ONLY in the same fail-closed shape as `canPlayerSubmitPicks`: it can close a week early on the client, it can never open one, and
 * closing early reveals nothing (the blind rule is untouched).
 *
 * THE RULE (the server's twin is `week_lock_instant` / `pick_window_open`, migration 0043; lockinstanttest.mjs pins the three copies):
 *   lock instant = picksLockAt when the commissioner set one, else the slate's FIRST kickoff minus autoLockOffsetMinutes (default 30),
 *                  else none (no dated game: commissioner-driven, as before).
 *   The week is closed from the instant ON: `now >= instant` (at exactly the instant it is closed — the server's `now() < instant`).
 *
 *   stored status          now vs instant            demo week   phase    derived
 *   draft                  any                       any         draft    no
 *   open                   before                    any         open     no
 *   open                   at or after               no          locked   YES
 *   open                   at or after               yes         open     no   (demo weeks are exempt, as on the server)
 *   open                   no instant                any         open     no
 *   locked / live / final  any                       any         stored   no   (a derived lock never reopens a stored lock)
 */
import { computeEffectiveLockAt } from './scoring.js';
import { WEEK_STATUS, DATA_SOURCE_MODE } from './data-model.js';

/** The five phases, in lifecycle order. Same words as WEEK_STATUS, kept as their own table so a caller cannot mistake a derived phase for a stored status. */
export const LOCK_PHASE = Object.freeze({
  DRAFT: WEEK_STATUS.DRAFT, OPEN: WEEK_STATUS.OPEN, LOCKED: WEEK_STATUS.LOCKED, LIVE: WEEK_STATUS.LIVE, FINAL: WEEK_STATUS.FINAL,
});
const KNOWN = new Set(Object.values(LOCK_PHASE));

/**
 * @param {object}  args
 * @param {object}  args.week              the week record (status, picksLockAt, autoLockOffsetMinutes, dataSourceMode, lockedAt)
 * @param {object[]} args.games            the week's games (kickoff drives the derived instant)
 * @param {number|Date} [args.now]         the clock; defaults to Date.now()
 * @param {string|null} [args.confirmedStatus]  the SERVER-confirmed status the adapter holds (serverConfirmedWeekStatus); with none, the mirror's status
 * @returns {{ stored: string|null, phase: string|null, derived: boolean, lockAtMs: number|null, closed: boolean, reopened: boolean }}
 */
export function weekLockState({ week, games, now = Date.now(), confirmedStatus = null } = {}) {
  if (!week || typeof week !== 'object') return { stored: null, phase: null, derived: false, lockAtMs: null, closed: false, reopened: false };
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const raw = confirmedStatus || week.status;
  const stored = typeof raw === 'string' ? raw : null;
  // An unknown or missing stored status is never "open": it reads as a draft (not editable, not closed), the fail-closed direction.
  const base = KNOWN.has(stored) ? stored : LOCK_PHASE.DRAFT;

  let lockAtMs = null;
  try {
    const at = computeEffectiveLockAt(week, Array.isArray(games) ? games : []);
    const ms = at ? at.getTime() : NaN;
    lockAtMs = Number.isFinite(ms) ? ms : null;
  } catch { lockAtMs = null; }

  const demo = week.dataSourceMode === DATA_SOURCE_MODE.DEMO;
  const derived = base === LOCK_PHASE.OPEN && !demo && lockAtMs !== null && Number.isFinite(nowMs) && nowMs >= lockAtMs;
  const phase = derived ? LOCK_PHASE.LOCKED : base;
  const closed = phase === LOCK_PHASE.LOCKED || phase === LOCK_PHASE.LIVE || phase === LOCK_PHASE.FINAL;
  // Re-opened by the commissioner (DI-511): stored open on a week that WAS locked once. `lockedAt` is set by the lock (the device or the server job) and the
  // Re-open transition leaves it set, so a lock time merely set at setup (no lockedAt) never reads as a re-open.
  const reopened = base === LOCK_PHASE.OPEN && !!week.lockedAt;
  return { stored, phase, derived, lockAtMs, closed, reopened };
}

/**
 * The status the week navigator's and the header's BADGE shows. A derived lock reads LOCKED; every other state shows the stored status exactly as before
 * (so a draft, a stored lock, a live and a final week are byte-identical to the old badge, and an unknown status keeps its old text).
 * @returns {{ phase: string, label: string }}
 */
export function weekBadgePhase({ week, games, now = Date.now() } = {}) {
  const st = weekLockState({ week, games, now });
  const phase = st.derived ? st.phase : String(week?.status ?? '');
  return { phase, label: String(phase || '').toUpperCase() };
}
