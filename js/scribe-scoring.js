/**
 * scribe-scoring.js — the pure half of SCRIBE's opportunity scoring.
 * ====================================================================
 * Phase III Step 6, PHASE 5 (DI-T6.5, DI-T6.14(b)).
 *
 * EXTRACTION, NOT A REWRITE. Every number and every step below is copied from
 * `backend/Code.gs`'s `SCRIBE_SIGNAL_POINTS_` (:6176), `scribeCollapseSignals_`
 * (:6226), `scribeCombineSignalPoints_` (:6249) and `scribeScoreOpportunity_`
 * (:6261) — cite those line numbers if this file is ever re-derived. The same
 * algorithm ALSO lives, independently authored to the same spec, in
 * `js/scribeLines.js` (`SIGNAL_POINTS`, `collapseSignals`, `combineSignalPoints`,
 * `scoreOpportunity`) — `scoringtest.mjs [22]` already proves that copy agrees
 * with Code.gs's, using the same `vm`-sandbox technique `scribeToolsTwin.mjs`
 * established. This file is a THIRD copy, and that is worth explaining rather
 * than quietly adding to: `js/scribeLines.js` cannot be imported here, because
 * it imports `./chat.js` and `./scribeAgent.js`, which reach `fetch`, the DOM
 * and `localStorage` — importing it into a Deno Edge Function would drag the
 * whole client app in behind it, the exact problem DI-T6.1 solved for
 * `js/notifications.js` by copying four pure functions instead of importing
 * the module that holds them. This file is that same move, for the same
 * reason, and it is asserted against BOTH existing copies rather than trusted:
 * `scribescoringtest.mjs` loads `backend/Code.gs` in a Node `vm` (the
 * `scoringtest.mjs [22]` precedent) and asserts this module's output is
 * byte-identical to it across a fixture table, and separately imports
 * `js/scribeLines.js`'s `scoreOpportunity` and asserts the same. A change to
 * any ONE of the three that is not mirrored in the other two goes RED there,
 * not here — this file carries no test of its own beyond what it needs to be
 * importable.
 *
 * PURE. No `Deno`, no `fetch`, no storage, no clock read as a default (a
 * caller supplies `now` explicitly if bucketing matters — Phase 5 does not
 * need the bucket feature `js/scribeLines.js` layers on top for the client's
 * own rate limiting, so it is not reproduced here).
 */

/** DI-D1's scoring table, verbatim (Code.gs `SCRIBE_SIGNAL_POINTS_`, :6176).
 *  `claim` is deliberately 0 — a text-based signal scores ONLY via the
 *  classifier's own returned points (see SCRIBE_CLASSIFY_POINTS below), never
 *  from a keyword match. */
export const SIGNAL_POINTS = Object.freeze({
  backdoorBust: 50,
  chartLeadChange: 45,
  milestone: 40,
  streak: 35,
  loneWolfWin: 30,
  unanimous: 25,
  drinkDebt: 15,
  verbosity: 10,
  claim: 0,
});

/** Code.gs `SCRIBE_MAX_DISTINCT_SIGNALS_` (:6221). */
export const MAX_DISTINCT_SIGNALS = 8;

/**
 * One entry per signal NAME — the highest points wins between instances —
 * sorted by points descending with the name as a stable tiebreak, capped at
 * `MAX_DISTINCT_SIGNALS`. Pure. Mirrors Code.gs `scribeCollapseSignals_` (:6226)
 * and `js/scribeLines.js`'s `collapseSignals` (private there).
 *
 * `points` is "a number the caller supplied"; `null`/`undefined` both mean
 * "the caller supplied nothing" (the RG-07 null trap `js/scribeLines.js:766`
 * documents — `Number(null)` is `0` and `Number.isFinite(0)` is `true`, so a
 * naive check would read an explicit `points:null` as an explicit zero and
 * suppress the table value).
 *
 * @param {Array<string|{signal:string, points?:number}>} signals
 * @returns {Array<{signal:string, points:number}>}
 */
export function collapseSignals(signals) {
  const byName = new Map();
  for (const raw of (signals || [])) {
    const s = (typeof raw === 'string') ? { signal: raw } : (raw || {});
    const name = String(s.signal || '');
    if (!name) continue;
    const explicit = Number(s.points);
    const hasExplicit = s.points !== undefined && s.points !== null && Number.isFinite(explicit);
    const pts = hasExplicit ? explicit
      : (Object.prototype.hasOwnProperty.call(SIGNAL_POINTS, name) ? SIGNAL_POINTS[name] : 0);
    const prev = byName.get(name);
    if (prev === undefined || pts > prev) byName.set(name, pts);
  }
  return [...byName.entries()]
    .map(([signal, points]) => ({ signal, points }))
    .sort((a, b) => (b.points - a.points) || String(a.signal).localeCompare(String(b.signal)))
    .slice(0, MAX_DISTINCT_SIGNALS);
}

/**
 * `top + 0.5 x (second + third)` over an already-collapsed, descending list.
 * Pure. Mirrors Code.gs `scribeCombineSignalPoints_` (:6249). Fractional
 * scores are expected — thresholds are integers and the comparison is `>=`.
 *
 * @param {Array<{signal:string, points:number}>} collapsed
 * @returns {number}
 */
export function combineSignalPoints(collapsed) {
  const a = collapsed[0] ? Number(collapsed[0].points) || 0 : 0;
  const b = collapsed[1] ? Number(collapsed[1].points) || 0 : 0;
  const c = collapsed[2] ? Number(collapsed[2].points) || 0 : 0;
  return a + 0.5 * (b + c);
}

/**
 * PURE. Same input, same output, every time. Mirrors Code.gs
 * `scribeScoreOpportunity_` (:6261).
 *
 * @param {Array<string|{signal:string, points?:number}>} signals
 * @returns {number}
 */
export function scoreOpportunity(signals) {
  return combineSignalPoints(collapseSignals(signals));
}

/**
 * BLOCK-1 / FINDING 1 / FINDING 3's trust boundary for `scribe-autonomous`.
 * Mirrors Code.gs `scribeAutonomousTrustedSignals_` (:7267) MINUS the
 * `claim`-verdict lookup, which needs a database read and therefore lives in
 * `scribe-autonomous/index.js` itself, not in this pure module. The caller
 * passes the resolved `claimPoints` (or `null` when the trigger carries no
 * `claim` entry) so this function never touches `Deno`/a client.
 *
 * WHAT IS TRUSTED, EXACTLY: signal NAMES, and only those on `SIGNAL_POINTS`
 * (N-6's allow-list) — every client-supplied number is discarded. `claim`'s
 * points come from `claimPoints`, never from the request.
 *
 * @param {{points?: Array<string|{signal:string}>}} evidence
 * @param {number|null} claimPoints resolved server-side, or null if absent
 * @returns {Array<{signal:string, points:number}>}
 */
export function trustedAutonomousSignals(evidence, claimPoints) {
  const raw = (evidence && evidence.points) || [];
  const named = [];
  for (const entry of raw) {
    const name = (typeof entry === 'string') ? entry : String((entry && entry.signal) || '');
    if (!Object.prototype.hasOwnProperty.call(SIGNAL_POINTS, name)) continue; // N-6 allow-list
    if (name === 'claim') {
      named.push({ signal: 'claim', points: claimPoints === null || claimPoints === undefined ? 0 : claimPoints });
    } else {
      named.push({ signal: name }); // scored from SIGNAL_POINTS, never from the request
    }
  }
  return collapseSignals(named);
}

// ── The classifier's own point table (DI-T6.5 / Code.gs :7706-7709) ─────────
// NOT part of the collapse/combine machinery above — a classify verdict feeds
// a SINGLE `claim` entry into it (via `trustedAutonomousSignals`'s
// `claimPoints` argument), it does not participate in the diminishing-returns
// combiner itself.
export const CLASSIFY_POINTS = Object.freeze({
  bold_claim: 35,
  guarantee: 45,
  contradiction: 50,
  none: 0,
});

/** Below this the classifier's own verdict is "not sure" and scores zero — a
 *  coin-flip guess must not be able to make SCRIBE talk. Code.gs
 *  `SCRIBE_CLASSIFY_MIN_CONFIDENCE_` (:7709). */
export const CLASSIFY_MIN_CONFIDENCE = 0.6;

/**
 * The classify verdict → points, in one place so `scribe-classify/index.js`
 * and any later replay (a Trainer calibration pass) compute it identically.
 * Mirrors the inline arithmetic at the tail of Code.gs `scribeClassify`
 * (:7830-7833).
 *
 * @param {{claim?: boolean, kind?: string, confidence?: number}} parsed
 * @returns {number}
 */
export function classifyVerdictPoints(parsed) {
  const kind = String((parsed && parsed.kind) || 'none');
  const confidence = Number(parsed && parsed.confidence);
  const clamped = Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0;
  const base = Object.prototype.hasOwnProperty.call(CLASSIFY_POINTS, kind) ? CLASSIFY_POINTS[kind] : 0;
  return (parsed && parsed.claim === true && clamped >= CLASSIFY_MIN_CONFIDENCE) ? base : 0;
}
