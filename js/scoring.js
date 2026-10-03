/**
 * CFB Pickems — Scoring Engine v5 (unchanged logic from v4)
 * No-decision scoring, tiebreaker-aware rankings, season stats by correct picks.
 */

import {
  PICK_RESULT, GAME_STATUS, getAlmaMaterMatch, getAutoLockOffsetMinutes,
  getEffectiveGroupId, weeksInGroup, getGroupTiebreakerWeek,
} from './data-model.js';
import { getTiebreakerGuess } from './storage.js';

// ─── AUTO-TRANSITION COMPUTE HELPERS ─────────────────────────────────────────
// These derive the "planned" transition times from the current slate. Read-only
// — the actual transitions happen in app.js via the auto-refresh tick.

/** First kickoff on the slate, or null if none. Ignores manual games without a kickoff time. */
export function computeFirstKickoff(games) {
  const times = (games || [])
    .map(g => g?.kickoff ? new Date(g.kickoff).getTime() : null)
    .filter(t => t && !isNaN(t));
  return times.length ? new Date(Math.min(...times)) : null;
}

/** Last kickoff on the slate — used for auto-final trigger (all games in must be past). */
export function computeLastKickoff(games) {
  const times = (games || [])
    .map(g => g?.kickoff ? new Date(g.kickoff).getTime() : null)
    .filter(t => t && !isNaN(t));
  return times.length ? new Date(Math.max(...times)) : null;
}

/**
 * The effective lock time for a week. Rule:
 *   1. If commissioner explicitly set `picksLockAt`, honor it.
 *   2. Otherwise, compute: firstKickoff - autoLockOffsetMinutes (default 30).
 *   3. If no games are on the slate yet, return null (nothing to derive from).
 */
export function computeEffectiveLockAt(week, games) {
  if (!week) return null;
  if (week.picksLockAt) return new Date(week.picksLockAt);
  const first = computeFirstKickoff(games);
  if (!first) return null;
  const offset = getAutoLockOffsetMinutes(week);
  return new Date(first.getTime() - offset * 60 * 1000);
}

/** Effective live time = first kickoff. Auto-live can be disabled. */
export function computeEffectiveLiveAt(week, games) {
  return computeFirstKickoff(games);
}

/**
 * Coerce a stored score or spread to a finite number, or null when the value
 * cannot decide anything. Same defensive-coercion pattern as
 * `gameMultiplier()` below (CONVENTIONS #7) — but this one falls back to NULL,
 * not to a safe default, because there is no safe default for "who covered."
 *
 * Why this exists: `calculateAtsWinner()` previously guarded only `=== null`.
 * An ABSENT key, `undefined`, `NaN`, `''` or any non-number reached the
 * arithmetic, made `diff` NaN, and then fell through both `Math.abs(NaN) <
 * 0.01` (false) and `NaN > 0` (false) to the else branch — silently returning
 * `awayTeam`. That is a real, money-deciding cover fabricated out of data that
 * cannot decide anything, always landing on the same side, and app.js persists
 * the result into `game.atsWinner`, after which `evaluatePick()` prefers the
 * stored value forever. Every other reader of these fields in the app uses a
 * loose `!= null` (chat-ui.js:822/1656/1989, app.js:4358); this was the one
 * strict-equality reader, and it is the one that decides who owes whom money.
 * Numeric strings coerce (a value that round-tripped through a text field
 * still describes the same game); everything else is refused.
 */
function finiteOrNull(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function calculateAtsWinner(game) {
  const { homeScore, awayScore, lockedSpread, spread, homeTeam, awayTeam, status } = game;
  if (status !== GAME_STATUS.FINAL) return null;
  const hs = finiteOrNull(homeScore);
  const as_ = finiteOrNull(awayScore);
  if (hs === null || as_ === null) return null;
  // Prefer lockedSpread (the spread the week was scored against) but fall back
  // to live spread when nothing was locked — otherwise final games with scores
  // but never-locked weeks show as PENDING forever. The spread convention is
  // HOME perspective: negative = home favored, positive = away favored.
  // NOTE the precedence is on USABILITY, not presence: a locked line of 0 (a
  // locked PK) still governs, while a locked line that is blank or unparseable
  // is not a locked line at all and yields to the same fallback as null.
  const locked = finiteOrNull(lockedSpread);
  const sv = locked !== null ? locked : finiteOrNull(spread);
  if (sv === null) return null;
  const adjusted = hs + sv;
  const diff = adjusted - as_;
  if (Math.abs(diff) < 0.01) return 'no_decision';
  return diff > 0 ? homeTeam : awayTeam;
}

export function evaluatePick(pick, game) {
  if (!game) return PICK_RESULT.PENDING;
  if (game.status===GAME_STATUS.SCHEDULED) return PICK_RESULT.PENDING;
  if (game.status===GAME_STATUS.LIVE)      return PICK_RESULT.LIVE;
  const atsWinner = game.atsWinner ?? calculateAtsWinner(game);
  if (!atsWinner) return PICK_RESULT.PENDING;
  if (atsWinner==='no_decision') return PICK_RESULT.NO_DECISION;
  return atsWinner===pick.selectedTeam ? PICK_RESULT.WIN : PICK_RESULT.LOSS;
}

export function pointsForResult(result) {
  return result===PICK_RESULT.WIN ? 1 : 0;
}

/**
 * Read a game's scoring multiplier. Defaults to 1 (no-op) so pre-multiplier
 * data continues to behave identically. Any non-finite/negative value is
 * defensively coerced to 1 so a bad edit can't poison standings.
 */
export function gameMultiplier(game) {
  const m = Number(game?.multiplier);
  if (!Number.isFinite(m) || m <= 0) return 1;
  return m;
}

/**
 * The ranking tail shared by `calculateWeeklyResults()` and
 * `calculateGroupWeeklyResults()` (UN-118/UN-125). Sorts `rows` by
 * correctPicks desc, tiebreakerDelta asc (nulls last), assigns `rank`, and —
 * only when `anyFinal` is true and there's more than one row — sets
 * isWinner/isLoser/wonByTiebreaker on the first/last row after sorting.
 *
 * Mutates and returns `rows` (same contract `calculateWeeklyResults()` always
 * had: it built `results` via `.map()` then sorted/annotated those SAME
 * objects in place). Extracted verbatim — zero behaviour change — so a
 * single-week caller passing its own `games.some(FINAL)` reproduces today's
 * results exactly, and a pooled-group caller can reuse the identical
 * winner/loser logic on POOLED totals instead of re-deriving it.
 */
/**
 * Did the tiebreaker genuinely order two rows already tied on correctPicks?
 * True ONLY when their tiebreakerDelta yields a distinct, deterministic
 * ordering under the nulls-last sort — i.e. the tiebreaker actually decided
 * it. Both-null (nobody guessed) or equal non-null deltas (guesses equally
 * close) is an arbitrary, stable-sort coin flip and returns false. One delta
 * present and the other null is decisive (nulls-last ranks the guesser above
 * the non-guesser) and returns true.
 */
function tiebreakerBrokeTie(a, b) {
  if (a.tiebreakerDelta === null && b.tiebreakerDelta === null) return false;
  if (a.tiebreakerDelta === b.tiebreakerDelta) return false;
  return true;
}

// ─── SP-54 (DI-466) — THE WEEKLY TIE-BREAK, AFTER S1 AND S2 ──────────────────────────────────
//
// Drew, 2026-09-30: when a FINAL week has two or more players level on weighted correct picks AND level
// on tiebreaker distance, the order is settled by (S3) each player's alma mater against the spread, then
// (S4) the Extra Point, then (S5) a seeded draw. Everything below is PURE: it never reads a week, a guess,
// a game or storage. It is HANDED precomputed keys by the caller (js/tie-context.js builds them), so this
// file stays structurally ignorant of where they came from (AD-33, amended 2026-09-30: the Extra Point is
// never a gate, never a scoring input, never aggregated across weeks and never read by the season sort; its
// only role is the fourth-ranked fallback inside a weekly true tie, handed in as keys).
//
//   tie = { seed,                        S5's seed (the week id, or the group id)
//           alma,  { [playerId]: { played: boolean, net: number } } | null     S3 keys; null = S3 never applies
//           ep,    { byPlayer: { [playerId]: { cls: 0|1|2, delta: number|null } } } | null     S4 keys
//           facts, { [playerId]: { alma?: {...}, ep?: {...} } }                display-only echo (descriptor only)
//           degraded }                   names of halves the builder could not read (the caller toasts it)
//
// Absent (`tie === null`, the default) means today's behaviour EXACTLY: the 2-argument forms are
// byte-identical (tiebreaktest.mjs [T20]). Every key lookup below is an OWN-PROPERTY read (SC-K1): a player
// id of `constructor` or `__proto__` must never reach Object.prototype.

/** Own-property read of a map keyed by a player id (never the prototype chain). */
function tieKeyOf(map, playerId) {
  return map != null && Object.prototype.hasOwnProperty.call(map, playerId) ? map[playerId] : undefined;
}

/** S1 (weighted correctPicks, higher first) then S2 (tiebreakerDelta, smaller first, null last) — TODAY'S comparator, verbatim. */
function compareS1S2(a,b){
  const d=b.correctPicks-a.correctPicks; if(d!==0) return d;
  if(a.tiebreakerDelta===null&&b.tiebreakerDelta===null) return 0;
  if(a.tiebreakerDelta===null) return 1;
  if(b.tiebreakerDelta===null) return -1;
  return a.tiebreakerDelta-b.tiebreakerDelta;
}

function fnv1a32(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
function mix32(h) { h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return h >>> 0; }
/** S5 — the week's draw. Identical on every device and every recompute: a pure function of (seed, playerId). */
export function drawKey(seed, playerId) { return mix32(fnv1a32(String(seed) + '|' + String(playerId))); }

/** A player's S3 key, or null when he has none: `played` must be exactly true for it to count. */
function almaKeyOf(tie, playerId) {
  const k = tie ? tieKeyOf(tie.alma, playerId) : undefined;
  return k && k.played === true ? k : null;
}
function almaNetOf(tie, playerId) {
  const k = almaKeyOf(tie, playerId);
  return k && Number.isFinite(k.net) ? k.net : 0;
}
/** S3 applies to a run only if EVERY member has a graded alma mater game (Drew's Q3: the literal reading). */
function almaApplies(run, tie) {
  return !!tie.alma && run.every(r => almaKeyOf(tie, r.playerId) !== null);
}
/** A player's S4 key: class 0 (a guess not over the actual; smaller delta is better, exact = 0), class 1 (a bust), class 2 (no entry). A missing or malformed key is class 2. */
function epKeyOf(tie, playerId) {
  const k = tie && tie.ep ? tieKeyOf(tie.ep.byPlayer, playerId) : undefined;
  if (k && k.cls === 0 && Number.isFinite(k.delta)) return { cls: 0, delta: k.delta };
  if (k && k.cls === 1) return { cls: 1, delta: 0 };
  return { cls: 2, delta: 0 };
}
function compareEp(tie) {
  return (a, b) => {
    const ka = epKeyOf(tie, a.playerId), kb = epKeyOf(tie, b.playerId);
    return ka.cls - kb.cls || ka.delta - kb.delta;
  };
}
function compareAlma(tie) {
  return (a, b) => almaNetOf(tie, b.playerId) - almaNetOf(tie, a.playerId);
}
/** Split `group` into sub-groups of rows equal under `cmp`, best sub-group first (stable). */
function splitBy(group, cmp) {
  const sorted = [...group].sort(cmp);
  const out = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && cmp(last[0], r) === 0) last.push(r); else out.push([r]);
  }
  return out;
}
/** S5 — a total order: smaller drawKey first, ties by playerId. */
function drawOrder(group, seed) {
  return [...group].sort((a, b) =>
    drawKey(seed, a.playerId) - drawKey(seed, b.playerId)
    || (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0));
}
/** One run (rows equal on S1 and S2) -> a total order: S3 (all-or-nothing), then S4, then S5. */
function orderRun(run, tie) {
  let groups = [run];
  if (almaApplies(run, tie)) groups = splitBy(run, compareAlma(tie));
  if (tie.ep) groups = groups.flatMap(g => g.length > 1 ? splitBy(g, compareEp(tie)) : [g]);
  return groups.flatMap(g => g.length > 1 ? drawOrder(g, tie.seed) : g);
}
/** Maximal stretches of the (already S1/S2-sorted) rows that compare equal: [[start, end), ...]. */
function tieRunsOf(rows) {
  const runs = [];
  let i = 0;
  while (i < rows.length) {
    let j = i + 1;
    while (j < rows.length && compareS1S2(rows[i], rows[j]) === 0) j++;
    runs.push([i, j]);
    i = j;
  }
  return runs;
}
/** Reorder every run of size >= 2 IN PLACE (every run, not only the top and bottom, so the rank column never reshuffles by accident). */
function orderTieRuns(rows, tie) {
  for (const [i, j] of tieRunsOf(rows)) {
    if (j - i < 2) continue;
    const ordered = orderRun(rows.slice(i, j), tie);
    for (let k = 0; k < ordered.length; k++) rows[i + k] = ordered[k];
  }
}
const SRC_RANK = { snapshot: 0, 'locked-roster': 1, live: 2 };
function copyFact(f) { return f && typeof f === 'object' && !Array.isArray(f) ? { ...f } : null; }
/**
 * Stamp `tieBreak` on the winner row and the loser row, only where a tie stage decided that end: the earliest stage at which the
 * row and its neighbour differ, with the display-only echo (`tie.facts`) COPIED in. This is the ONLY function that reads
 * `tie.facts`: no ordering function above ever does (tiebreaktest.mjs T-K7 scans for it), so display data can never decide a rank.
 */
function attachTieBreak(rows, tie) {
  const n = rows.length;
  if (n < 2) return;
  const runs = tieRunsOf(rows);
  const describe = (me, other, end) => {
    if (me.correctPicks !== other.correctPicks) return null;               // S1 alone separates them: nothing to explain
    const base = { v: 1, end, vs: other.playerId };
    if (tiebreakerBrokeTie(me, other)) {
      return { ...base, stage: 'tiebreaker', me: { delta: me.tiebreakerDelta }, other: { delta: other.tiebreakerDelta } };
    }
    const at = rows.indexOf(me);
    const run = runs.find(([i, j]) => at >= i && at < j);
    const members = run ? rows.slice(run[0], run[1]) : [me, other];
    if (almaApplies(members, tie) && almaNetOf(tie, me.playerId) !== almaNetOf(tie, other.playerId)) {
      const fm = copyFact(tieKeyOf(tie.facts, me.playerId)?.alma), fo = copyFact(tieKeyOf(tie.facts, other.playerId)?.alma);
      const worst = [fm && fm.src, fo && fo.src].filter(x => Object.prototype.hasOwnProperty.call(SRC_RANK, x)).sort((x, y) => SRC_RANK[y] - SRC_RANK[x])[0];
      return { ...base, stage: 'alma', me: fm, other: fo, ...(worst ? { src: worst } : {}) };
    }
    if (tie.ep && compareEp(tie)(me, other) !== 0) {
      return { ...base, stage: 'ep', me: copyFact(tieKeyOf(tie.facts, me.playerId)?.ep), other: copyFact(tieKeyOf(tie.facts, other.playerId)?.ep) };
    }
    return { ...base, stage: 'draw', me: null, other: null };
  };
  const w = describe(rows[0], rows[1], 'winner');
  if (w) rows[0].tieBreak = w;
  const l = describe(rows[n - 1], rows[n - 2], 'loser');
  if (l) rows[n - 1].tieBreak = l;
}

export function rankWeeklyResults(rows, anyFinal, tie = null) {
  rows.sort(compareS1S2);
  // S3 to S5 run ONLY on a final week (the blind rule: nothing about a week still open, locked or live is decided here).
  if (anyFinal && tie && rows.length > 1) orderTieRuns(rows, tie);

  rows.forEach((r,i)=>{ r.rank=i+1; });
  if(anyFinal&&rows.length>1){
    rows[0].isWinner=true;
    // "(TB)" only when the tiebreaker GENUINELY broke the correctPicks tie —
    // not a coin flip among equal or both-absent guesses. A tie is broken iff
    // the two rows' tiebreakerDelta produce a distinct ordering (nulls-last):
    // both null, or equal non-null deltas, is arbitrary and must NOT flag.
    if(rows[1]&&rows[0].correctPicks===rows[1].correctPicks)
      rows[0].wonByTiebreaker=tiebreakerBrokeTie(rows[0],rows[1]);
    rows[rows.length-1].isLoser=true;
    const last=rows[rows.length-1];
    const sl=rows[rows.length-2];
    if(sl&&last.correctPicks===sl.correctPicks)
      last.wonByTiebreaker=tiebreakerBrokeTie(last,sl);
    if(tie) attachTieBreak(rows, tie);
  }
  return rows;
}

export function calculateWeeklyResults(weekId, players, picks, games, actualTiebreaker=null, tie=null) {
  const results = players.map(player => {
    const pp = picks.filter(p=>p.weekId===weekId&&p.playerId===player.playerId);
    // Two parallel tallies:
    //   correctPicks / incorrectPicks  — WEIGHTED (respects game.multiplier)
    //   correctCount / incorrectCount  — RAW (unweighted counts, for math-audit)
    // Weighted values drive rankings and standings so multiplier games actually
    // "matter more". Raw counts stay available for CSV export + the season
    // audit tooling so a 2x game doesn't look like a math error.
    let correct=0, incorrect=0, correctCount=0, incorrectCount=0, noDecisions=0, pending=0;
    for (const pick of pp) {
      const game=games.find(g=>g.gameId===pick.gameId);
      if(!game) continue;
      const r=evaluatePick(pick,game);
      const mult = gameMultiplier(game);
      if(r===PICK_RESULT.WIN)            { correct += mult;   correctCount++; }
      else if(r===PICK_RESULT.LOSS)      { incorrect += mult; incorrectCount++; }
      else if(r===PICK_RESULT.NO_DECISION) noDecisions++;
      else pending++;
    }
    const tbGuess = getTiebreakerGuess(weekId, player.playerId);
    // Tiebreaker is a raw numeric guess and MUST NOT be scaled by any multiplier
    // (it's used only to break ties in the standings, not as a scoring input).
    const tbDelta = (actualTiebreaker!==null&&tbGuess!==null) ? Math.abs(tbGuess-actualTiebreaker) : null;
    return {
      resultId:`wr_${weekId}_${player.playerId}`,
      weekId, playerId:player.playerId, displayName:player.displayName,
      correctPicks:correct, incorrectPicks:incorrect,
      correctCount, incorrectCount,
      noDecisions, pending,
      tiebreakerGuess:tbGuess, tiebreakerDelta:tbDelta,
      rank:0, isWinner:false, isLoser:false, wonByTiebreaker:false,
    };
  });

  const anyFinal=games.some(g=>g.status===GAME_STATUS.FINAL);
  return rankWeeklyResults(results, anyFinal, tie);
}

/**
 * UN-118/UN-125 — the POOLED equivalent of `calculateWeeklyResults()` for a
 * multi-part competitive week (`groupWeeks.length > 1`). Pools raw picks and
 * games across every member week, runs the identical per-game weighted/raw
 * tally loop, then calls `rankWeeklyResults()` ONCE on the pooled totals —
 * so rank/isWinner/isLoser/wonByTiebreaker are computed exactly once at the
 * GROUP level, never derived by combining two independent per-part rankings.
 *
 * correctPicks/incorrectPicks/correctCount/incorrectCount are additive, so
 * pooling raw picks and summing per-part totals are mathematically
 * identical — what is NOT additive is rank/isWinner/isLoser, which is why
 * this function exists rather than a simple sum of two
 * `calculateWeeklyResults()` calls.
 *
 * The tiebreaker resolves through the ONE group member returned by
 * `getGroupTiebreakerWeek()` — every OTHER member's tiebreaker guess for
 * their own week's (different) tiebreaker question is ignored entirely, by
 * construction, since `getTiebreakerGuess()` is only ever called for that one
 * week's id. No storage schema change: this reads the exact same
 * `cfbp_tb_guesses` accessor every singleton week already uses.
 *
 * `weekId` on each returned row is the group's canonical id
 * (`getEffectiveGroupId`) — a real, resolvable weekId, so callers (obligation
 * creation, CSV export, Weekly History) don't need a second concept of "group
 * key" vs "week key."
 */
export function calculateGroupWeeklyResults(groupWeeks, players, allPicks, allGames, tie=null) {
  const weeks = groupWeeks || [];
  const gid = weeks.length ? getEffectiveGroupId(weeks[0]) : null;
  const memberWeekIds = new Set(weeks.map(w=>w.weekId));
  const tbWeek = getGroupTiebreakerWeek(weeks);
  const actualTiebreaker = tbWeek ? (tbWeek.actualTiebreakerValue ?? null) : null;

  const results = (players||[]).map(player => {
    const pp = (allPicks||[]).filter(p=>memberWeekIds.has(p.weekId)&&p.playerId===player.playerId);
    let correct=0, incorrect=0, correctCount=0, incorrectCount=0, noDecisions=0, pending=0;
    for (const pick of pp) {
      const game=(allGames||[]).find(g=>g.gameId===pick.gameId);
      if(!game) continue;
      const r=evaluatePick(pick,game);
      const mult = gameMultiplier(game);
      if(r===PICK_RESULT.WIN)            { correct += mult;   correctCount++; }
      else if(r===PICK_RESULT.LOSS)      { incorrect += mult; incorrectCount++; }
      else if(r===PICK_RESULT.NO_DECISION) noDecisions++;
      else pending++;
    }
    const tbGuess = tbWeek ? getTiebreakerGuess(tbWeek.weekId, player.playerId) : null;
    const tbDelta = (actualTiebreaker!==null&&tbGuess!==null) ? Math.abs(tbGuess-actualTiebreaker) : null;
    return {
      resultId:`wr_${gid}_${player.playerId}`,
      weekId: gid, playerId:player.playerId, displayName:player.displayName,
      correctPicks:correct, incorrectPicks:incorrect,
      correctCount, incorrectCount,
      noDecisions, pending,
      tiebreakerGuess:tbGuess, tiebreakerDelta:tbDelta,
      rank:0, isWinner:false, isLoser:false, wonByTiebreaker:false,
    };
  });

  const anyFinal=(allGames||[]).some(g=>memberWeekIds.has(g.weekId)&&g.status===GAME_STATUS.FINAL);
  return rankWeeklyResults(results, anyFinal, tie);
}

/**
 * Sums FINAL-game points for every school in `almaMaters` — the list the
 * caller decides matters (app.js's `claimedAlmaMaters()` for the real
 * Auto-Calc button: distinct schools actually CLAIMED by an active player,
 * per Drew's ruling 2026-09-04 — "calculate only the alma maters that are
 * claimed... if one is listed then its added to the auto calc." This
 * function itself is agnostic to WHERE the list came from; it just has to
 * agree with itself about what it is).
 *
 * FIX (regression on commit 8ae64f4): both halves below now resolve
 * against the SAME `almaMaters` list through the SAME precise matcher,
 * `getAlmaMaterMatch()`. Previously the filter half called
 * `getAlmaMaterMatch(team)` with NO second argument, which silently
 * defaults to the hardcoded ALMA_MATERS catalog (data-model.js) regardless
 * of what the caller passed — while the summing half below used a naive
 * `almaMaters.some(am => team.toLowerCase().includes(am.toLowerCase()))`.
 * The two agreed only by coincidence, as long as the caller's list equaled
 * the catalog; the moment the roster became commissioner-editable and
 * diverged from the catalog (Purdue removed, Clemson added), they disagreed
 * silently and produced a wrong total (28 instead of 59 on the Clemson
 * 31 / Oklahoma 28 fixture — see almatotaltest.mjs). Naive substring
 * matching is also replaced by `getAlmaMaterMatch()` so a claimed "Miami"
 * cannot also sum "Miami (OH)"'s score — RG-02's original defect class,
 * reachable again now that the list is commissioner-editable.
 *
 * Returns `null` — never `0` — whenever no FINAL game actually involves a
 * school in `almaMaters`. Before this fix, a game could pass the (wrongly
 * catalog-based) filter half while matching NEITHER side of the (correctly
 * list-based) summing half — e.g. a FINAL Purdue game, on-catalog but
 * off-roster — silently returning 0 (a false "nothing scored" instead of a
 * true "no signal"). Unifying both halves on one list/matcher closes this
 * as a side effect: any game that survives the filter is now GUARANTEED to
 * match at least one side in the summing loop.
 */
export function calculateAlmaMaterTotal(games, almaMaters, calcMode='selectedSlateOnly') {
  const list = Array.isArray(almaMaters) ? almaMaters : [];
  const ag=(games||[]).filter(g=>{
    const isAlma = !!(getAlmaMaterMatch(g.homeTeam, list) || getAlmaMaterMatch(g.awayTeam, list));
    return calcMode==='selectedSlateOnly'?g.isAlmaMaterGame&&isAlma:isAlma;
  });
  if(!ag.length) return null;
  const fg=ag.filter(g=>g.status===GAME_STATUS.FINAL&&g.homeScore!==null&&g.awayScore!==null);
  if(!fg.length) return null;
  let total=0;
  for(const g of fg){
    const hA=!!getAlmaMaterMatch(g.homeTeam, list);
    const aA=!!getAlmaMaterMatch(g.awayTeam, list);
    if(hA) total+=g.homeScore||0;
    if(aA) total+=g.awayScore||0;
  }
  return total;
}

/**
 * UN-118/UN-125 — `weeks` is OPTIONAL and OFF by default. Omitting it
 * reproduces today's behaviour exactly (fails safe): every weekly-result row
 * counts its own isWinner/isLoser toward weeklyWins/weeklyLosses, which is
 * what double-counts a split week into two winners. Callers that have NOT
 * been updated for grouping keep working unmodified.
 *
 * When `weeks` IS supplied, any weekly-result row whose week record belongs
 * to a >1-member group is pulled OUT of the per-row tally and replaced by a
 * single pooled result per group, computed the same way
 * `calculateGroupWeeklyResults()` does — but from the ALREADY-COMPUTED
 * per-part rows in `allWeeklyResults` (this function never sees raw
 * picks/games), which is valid because correctPicks is additive across
 * parts. A group only contributes a win/loss once EVERY member is actually
 * present in `allWeeklyResults` (i.e. finalized) — mirrors finalizeWeek()'s
 * own "not every member final ⇒ no obligation yet" gate (DI-126d), applied
 * here to the win/loss tally instead of the obligation.
 *
 * DI-A (2026-09-02) — Drew: "The rankings in the standings should be based
 * off of the delta tie breaker in the instance of a tie. Right now Kihoon is
 * listed as last, but Kevin has the L." The final sort below adds ONE middle
 * criterion between totalCorrect and winPct: each player's net WEEKLY
 * win/loss OUTCOME (weeklyWins-weeklyLosses, computed just above). Per
 * Drew's ruling the tiebreaker has NO season aggregate — this function must
 * never read the per-pick tiebreaker delta, a player's raw tiebreaker guess,
 * or a week's actual tiebreaker value, directly, summed, or renamed (see the
 * source-level tripwire in ranktest.mjs [5], which scans this function's own
 * body and therefore deliberately excludes this explanation naming those
 * fields — read that test before ever adding such a read here). The net
 * weekly win/loss criterion works precisely because it crosses into the
 * season view as an already-resolved OUTCOME of rankWeeklyResults() — which
 * itself resolves any intra-week tie using that week's own delta and never
 * lets it leave the week — the same way "games won" does in any standings
 * table. Grouping-safe by construction: weeklyWins/weeklyLosses already fold
 * in UN-118's pooled group win/loss when `weeks` is passed.
 */
export function calculateSeasonStandings(players, allWeeklyResults, weeks=null, tieContexts=null) {
  const weekById = weeks ? new Map(weeks.map(w=>[w.weekId,w])) : null;

  // Map<playerId, {wins,losses}> — populated once, up front, from every
  // >1-member group whose members are ALL represented in allWeeklyResults.
  let groupWinLoss = null;
  if (weekById) {
    const resultWeekIds = new Set(allWeeklyResults.map(r=>r.weekId));
    const seenGroups = new Set();
    groupWinLoss = new Map(players.map(p=>[p.playerId,{wins:0,losses:0}]));
    for (const weekId of resultWeekIds) {
      const w = weekById.get(weekId);
      if (!w) continue; // result row for a week not in `weeks` — leave it to the per-row path
      const gid = getEffectiveGroupId(w);
      if (seenGroups.has(gid)) continue;
      seenGroups.add(gid);
      const memberWeeks = weeksInGroup(weeks, w);
      if (memberWeeks.length <= 1) continue; // singleton — unaffected, per-row path handles it
      if (!memberWeeks.every(m => resultWeekIds.has(m.weekId))) continue; // not every member final yet
      const tbWeek = getGroupTiebreakerWeek(memberWeeks);
      const pooled = players.map(player => {
        const rows = memberWeeks
          .map(m => allWeeklyResults.find(r=>r.weekId===m.weekId&&r.playerId===player.playerId))
          .filter(Boolean);
        const correctPicks = rows.reduce((s,r)=>s+(r.correctPicks||0),0);
        const tbRow = tbWeek ? rows.find(r=>r.weekId===tbWeek.weekId) : null;
        return {
          playerId: player.playerId, correctPicks,
          tiebreakerDelta: tbRow ? (tbRow.tiebreakerDelta ?? null) : null,
          rank:0, isWinner:false, isLoser:false, wonByTiebreaker:false,
        };
      });
      rankWeeklyResults(pooled, true, tieContexts ? (tieContexts.get(gid) ?? null) : null);
      const gWinner = pooled.find(r=>r.isWinner);
      const gLoser  = pooled.find(r=>r.isLoser);
      if (gWinner) groupWinLoss.get(gWinner.playerId).wins++;
      if (gLoser)  groupWinLoss.get(gLoser.playerId).losses++;
    }
  }

  const standings=players.map(player=>{
    const pr=allWeeklyResults.filter(r=>r.playerId===player.playerId);
    // WEIGHTED totals drive ranking. These are the numbers players compare on.
    // Additive across group members by construction — grouping never changes
    // a season total, only how many DISCRETE weekly wins/losses it produced.
    const totalCorrect=pr.reduce((s,r)=>s+(r.correctPicks||0),0);
    const totalIncorrect=pr.reduce((s,r)=>s+(r.incorrectPicks||0),0);
    // RAW counts preserved for the season audit tooling. They fall back to the
    // weighted values when older weekly results (pre-multiplier) don't carry
    // the count fields — safe default because no multipliers existed then.
    const totalCorrectCount=pr.reduce((s,r)=>s+(r.correctCount ?? r.correctPicks ?? 0),0);
    const totalIncorrectCount=pr.reduce((s,r)=>s+(r.incorrectCount ?? r.incorrectPicks ?? 0),0);
    const totalND=pr.reduce((s,r)=>s+(r.noDecisions||0),0);
    let weeklyWins, weeklyLosses;
    if (weekById) {
      const soloRows = pr.filter(r => {
        const w = weekById.get(r.weekId);
        if (!w) return true; // unknown week record — fall back to the old per-row behaviour for this row
        return weeksInGroup(weeks, w).length <= 1;
      });
      const g = groupWinLoss.get(player.playerId) || {wins:0,losses:0};
      weeklyWins = soloRows.filter(r=>r.isWinner).length + g.wins;
      weeklyLosses = soloRows.filter(r=>r.isLoser).length + g.losses;
    } else {
      weeklyWins=pr.filter(r=>r.isWinner).length;
      weeklyLosses=pr.filter(r=>r.isLoser).length;
    }
    const totalGames=totalCorrectCount+totalIncorrectCount+totalND;
    // Win % uses raw counts — otherwise a 2x game skews the ratio in a
    // misleading way ("83% win rate" when they got 5 of 6 raw games right
    // but the 6th was a 2x loss).
    const winPct=totalGames>0?Math.round((totalCorrectCount/totalGames)*1000)/10:0;
    return{
      playerId:player.playerId, displayName:player.displayName,
      totalCorrect, totalIncorrect,
      totalCorrectCount, totalIncorrectCount,
      totalND, weeklyWins, weeklyLosses, winPct,
      currentRank:0, isSeasonLeader:false, isCurrentLastPlace:false,
    };
  });
  // DI-A — see the function-level comment above for the full rationale and
  // Drew's ruling this satisfies. Net weekly win/loss is the middle
  // criterion, ahead of winPct.
  standings.sort((a,b)=>
    b.totalCorrect-a.totalCorrect
    || (b.weeklyWins-b.weeklyLosses)-(a.weeklyWins-a.weeklyLosses)
    || b.winPct-a.winPct
    || (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0)
  );
  standings.forEach((s,i)=>{s.currentRank=i+1;});
  if(standings.length>1){standings[0].isSeasonLeader=true;standings[standings.length-1].isCurrentLastPlace=true;}
  return standings;
}

export function getPickStatusLabel(result) {
  return{win:'✅ Correct',loss:'❌ Wrong',no_decision:'— No Decision',live:'🔴 Live',pending:'⏳ Pending'}[result]||'—';
}
export function getPickStatusClass(result) {
  return{win:'result-win',loss:'result-loss',no_decision:'result-nd',live:'result-live'}[result]||'result-pending';
}
