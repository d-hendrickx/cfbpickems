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
  // ── SCRIBE v3 PACKAGE D (DI-284, UN-260, 2026-09-24) — THE COMEBACK. ──────
  // 50, which CLEARS `balanced` (45) ON ITS OWN. Drew's ruling on open
  // question 2: a message that plainly roasts SCRIBE, addressed at it, should
  // reliably get an answer rather than needing a second signal in the same
  // ten-minute bucket to combine with. It still obeys every other gate — the
  // per-post ticket, the global cooldown, the hourly cap, the consecutive
  // guard — so "reliably" means "clears the DIAL", never "bypasses the
  // floors" (SCRIBE.md §14, ruling 7(e): the floors never flex).
  roastOfScribe: 50,
  // ── DI-440 (N8, UN-384/UN-314, 2026-09-29) — A REAL UPSET, LIVE. 55: alone it
  //    clears Balanced (45) and the two looser levels, and does NOT clear
  //    Reserved (65) or Quiet (85) — the commissioner who asked for a quieter
  //    SCRIBE gets silence, not a named call-out. It is scored as the bare
  //    `[trigger]` on BOTH sides (the client sends `signals:[{signal:'liveUpset'}]`
  //    and the handler DISCARDS `evidence.points` for this trigger), so a request
  //    padded with extra signal names cannot lift a Reserved league over its
  //    threshold. `interacttest.mjs` pins this table equal to js/scribeLines.js's.
  liveUpset: 55,
  chartLeadChange: 45,
  milestone: 40,
  streak: 35,
  loneWolfWin: 30,
  unanimous: 25,
  // ── SCRIBE v3 PACKAGE D (DI-287, UN-263) — TWO PLAYERS GOING BACK AND
  //    FORTH. Lower-value than a direct provocation or a scoreboard event on
  //    purpose: an ambient "I notice you two" is real but lower-stakes than a
  //    personal roast, and 20 still lets it COMBINE with another signal in the
  //    same bucket to clear a higher threshold, which is how every other
  //    signal already behaves.
  heatedExchange: 20,
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

// ══════════════════════════════════════════════════════════════════════════
// SCRIBE v3 PACKAGE D — DI-287's HEATED-EXCHANGE PREDICATE, IN ONE PLACE.
// ══════════════════════════════════════════════════════════════════════════
// THE DETECTOR IS CODE-ONLY AND MODEL-FREE (DI-287's own shape, the same style
// `detectWeekSignals` already is): the last N `type='message'` rows in one room,
// inside a window, alternating between EXACTLY TWO distinct human authors.
//
// IT LIVES HERE RATHER THAN IN `js/scribeLines.js` BECAUSE BOTH RUNTIMES NEED
// THE SAME ANSWER. The client DETECTS the opportunity and the server VERIFIES
// it from its own `messages` rows before a cent is spent — and "verified" has
// to mean "the server re-derived the same thing", which a second, independently
// written copy of an alternation rule cannot promise. `js/scribeLines.js` cannot
// be imported into a Deno Edge Function (it reaches `fetch`, the DOM and
// `localStorage` — this file's own header explains that at length), and THIS
// module already is imported by both sides, so it is where a shared predicate
// belongs. `js/scribeLines.js` imports it from here rather than restating it;
// `_shared/scribe-evidence.mjs` does the same.
//
// PURE: a normalised row list in, a verdict out. No clock read of its own — the
// caller supplies `now`, the same discipline `scoreOpportunity`'s bucket option
// already follows.

/** DI-287's own numbers. Four messages, five minutes, exactly two authors. */
export const HEATED_MIN_LEN = 4;
export const HEATED_WINDOW_MS = 5 * 60 * 1000;

/**
 * @param {Array<{author:string, ts:number}>} rows OLDEST FIRST, one room only,
 *   `type='message'` only, human authors only (a SCRIBE or system row is not
 *   part of an argument between two players and the caller drops it).
 * @param {{minLen?:number, windowMs?:number, now?:number}} opts
 * @returns {{heated:boolean, authors:string[], count:number, spanMs:number}}
 *   `authors` is sorted, so two devices that saw the same exchange in a
 *   different arrival order still name the pair identically — which is what
 *   makes the deterministic post id for this trigger stable across six phones.
 */
export function heatedExchangeRun(rows, { minLen = HEATED_MIN_LEN, windowMs = HEATED_WINDOW_MS, now = 0 } = {}) {
  const none = { heated: false, authors: [], count: 0, spanMs: 0 };
  const list = Array.isArray(rows) ? rows.filter((r) => r && String(r.author || '')) : [];
  if (list.length < minLen) return none;
  const tail = list.slice(-minLen);
  // Every timestamp has to be real. A row we cannot place in time cannot be
  // said to be inside a five-minute window, and "probably recent" is exactly
  // the guess CONVENTIONS #7 exists to refuse.
  const times = tail.map((r) => Number(r.ts));
  if (!times.every((t) => Number.isFinite(t))) return none;
  const first = Math.min(...times);
  const last = Math.max(...times);
  const spanMs = last - first;
  if (spanMs > windowMs) return none;
  // The window is measured against the END of the run, not against `now`, so a
  // caller that passes `now` gets the additional freshness bound and a caller
  // that does not (a replay, a test fixture) still gets the span rule.
  if (now && (Number(now) - last) > windowMs) return none;
  const authors = [...new Set(tail.map((r) => String(r.author)))];
  if (authors.length !== 2) return none;
  // ALTERNATING, not merely "two people said four things". Two players
  // agreeing in two blocks (A A B B) is a conversation; A B A B is the
  // back-and-forth this trigger is about.
  for (let i = 1; i < tail.length; i += 1) {
    if (String(tail[i].author) === String(tail[i - 1].author)) return none;
  }
  return { heated: true, authors: authors.slice().sort(), count: tail.length, spanMs };
}

// ══════════════════════════════════════════════════════════════════════════
// N8 (DI-439 / DI-440, 2026-09-29) — THE LIVE-UPSET PREDICATES, IN ONE PLACE.
// ══════════════════════════════════════════════════════════════════════════
// The CLIENT detects a live cover turn or an alma mater going behind, and the
// SERVER re-derives the same facts from its own rows before a cent is spent.
// "Re-derived" only means something if both runtimes ran one implementation, so
// the three small pure rules they share live here beside `heatedExchangeRun`:
// this module is imported by `js/chat-ui.js` AND by `_shared/scribe-evidence.mjs`
// (`js/chat-ui.js` cannot be imported into a Deno Edge Function, and neither
// runtime may import the other's world).

/** DI-439 §2 — ONE SPORT RESOLVER, CLIENT AND SERVER.
 *
 *  A game row's `espnSport` is null (every ordinary ESPN college game), the legacy
 *  ESPN path key `'college-football'`, or `'nfl'` — NEVER `'cfb'` (data-model.js
 *  createGame). So "an unknown sport is silent" would, read literally against the
 *  stored value, have silenced EVERY college game. The resolver maps the stored
 *  spellings onto the dbCode space Multi-Sport's Phase 0 registry keys profiles by
 *  (`js/sports/index.js`, R1): null / undefined / 'college-football' -> 'cfb',
 *  'nfl' -> 'nfl', ANY OTHER STRING -> null (silent: a sport this build has no
 *  second-half rule for must never be guessed at).
 *
 *  Interim: at CORE's merge this becomes a delegate to the registry. Until then
 *  `liveupsettest.mjs` pins it against `listProfiles()` so the two cannot drift. */
export function sportDbCodeForGame(game) {
  if (!game || typeof game !== 'object') return null;
  const raw = game.espnSport;
  if (raw === null || raw === undefined) return 'cfb';
  if (typeof raw !== 'string') return null;
  if (raw === 'college-football') return 'cfb';
  if (raw === 'nfl') return 'nfl';
  return null;
}

/** DI-439 §2 — the FIRST in-game period that counts as "the second half", per
 *  sport, as ESPN numbers periods. Football's fourth-quarter game has its second
 *  half start in period 3; a two-half sport (college basketball, March Madness)
 *  in period 2; hockey has no half at all (`null` = the sport never fires; a
 *  three-period game's "late" is a different rule this build does not invent).
 *
 *  INTERIM TABLE. The interface addition is a new `SportProfile` slot,
 *  `secondHalfFromPeriod: integer | null` (an IN-GAME period — not the excluded
 *  competition-level `period` slot, DI-223), which Multi-Sport CORE (DI-219)
 *  ratifies. `cfb` and `nfl` already carry it on their profiles
 *  (`js/sports/{cfb,nfl}.js`); the other five keys land with their phases. Same
 *  keys, frozen, pinned to the profile values by `liveupsettest.mjs`. */
export const SECOND_HALF_FROM_PERIOD = Object.freeze({
  cfb: 3, nfl: 3, nba: 3, cbb: 2, mm: 2, nhl: null, wjc: null,
});

/** The first second-half period for a dbCode, or `null` (silent) when the sport
 *  is unknown, hockey, or anything not on the table. Own-property lookup: a
 *  dbCode of 'constructor' is unknown, not a hit on Object.prototype. */
export function secondHalfFromPeriod(dbCode) {
  if (typeof dbCode !== 'string') return null;
  if (!Object.prototype.hasOwnProperty.call(SECOND_HALF_FROM_PERIOD, dbCode)) return null;
  const n = SECOND_HALF_FROM_PERIOD[dbCode];
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/** DI-439 §3 — DEFINITION A, THE CROWD RULE. `L` = distinct players whose pick is
 *  the team now NOT covering; `G` = those on the covering team. A "real upset in
 *  spread coverage" is one where the room is on the wrong side of it: fire only
 *  when **L >= 2 and L > G**. (1,0) is one player — a private matter; (2,2) and
 *  (3,3) are a split room, nobody is being caught out; (0,2) is the room being
 *  RIGHT. (2,1) fires. Anything that is not a finite count is silent. Pure. */
export function crowdTurn(L, G) {
  const l = Number(L), g = Number(G);
  if (!Number.isFinite(l) || !Number.isFinite(g)) return false;
  return l >= 2 && l > g;
}

/** DI-439 §4 as RULED 2026-09-29 (Drew, coordinator relay: the alma call-out "fires
 *  on BOTH conditions") — is this team's school BEHIND right now?
 *
 *    `su`   the team is LOSING STRAIGHT-UP (its score is strictly below the other's;
 *           a tie is "on the number", not behind — the Alma Mater Watch surface's own
 *           straight-up reading);
 *    `ats`  the team is NOT COVERING (the OTHER side covers, strictly; exactly on the
 *           number is not "not covering"). Needs a line: a null / non-finite spread
 *           means `ats` is false, never a guess.
 *
 *  Signed home-perspective spread, the same margin every cover check in the app
 *  uses (AD-03): `(home + spread) - away > 0` means HOME covers.
 *
 *  One state per (game, side), and the machine on both runtimes watches whether
 *  EITHER is true — a team that is losing straight-up AND not covering is ONE alma
 *  situation, so it is one post, never two (the dedupe Drew asked for).
 *
 *  `side` is the team the question is about: 'home' | 'away'. Returns `null` when a
 *  score is missing — an unknown state is not a state, and the caller treats it as
 *  "no observation". Pure; the client passes the ESPN-fresh scores and the server
 *  passes an `audit_log` row's, through this one function. */
export function almaSideState({ homeScore, awayScore, spread, side } = {}) {
  if (side !== 'home' && side !== 'away') return null;
  if (homeScore === null || homeScore === undefined || awayScore === null || awayScore === undefined) return null;
  const h = Number(homeScore), a = Number(awayScore);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return null;
  const su = side === 'home' ? h < a : a < h;
  let ats = false;
  if (spread !== null && spread !== undefined && spread !== '' && Number.isFinite(Number(spread))) {
    const margin = (h + Number(spread)) - a;   // >0 home covering
    ats = side === 'home' ? margin < 0 : margin > 0;
  }
  return { su, ats };
}

/** Which condition(s) a `{su, ats}` state satisfies: 'su' (losing outright, the line
 *  not failing it), 'ats' (only failing the number), 'both', or null (not behind). */
export function almaCondition(state) {
  if (!state) return null;
  if (state.su && state.ats) return 'both';
  if (state.su) return 'su';
  if (state.ats) return 'ats';
  return null;
}
