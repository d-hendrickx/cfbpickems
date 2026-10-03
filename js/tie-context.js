/**
 * CFB Pickems — tie-context.js (SP-54, DI-465 to DI-470, 2026-10-01)
 * ===================================================================
 * THE ONE PLACE that turns a final week (or a complete multi-part group) into the KEYS the weekly
 * tie-break reads, and the one place that words the reason. Drew, 2026-09-30: when two or more players
 * are level for first or for last on weighted correct picks AND tiebreaker distance, the order is settled by
 *   S3  each player's alma mater against the spread (all-or-nothing per tied group),
 *   S4  the Extra Point (closest without going over; then a bust; then no entry),
 *   S5  a seeded draw (identical on every device, every recompute).
 *
 * WHY A LEAF MODULE. js/scoring.js must stay structurally ignorant of Extra Point data (AD-33, amended
 * 2026-09-30: the Extra Point is never a gate, never a scoring input, never aggregated across weeks, and never
 * read by the season sort; its only role is the fourth-ranked fallback inside a weekly true tie, handed to
 * scoring.js as precomputed keys). So scoring.js takes a `tie` argument and imports nothing new; THIS module
 * builds it. Nothing imports this module except js/app.js and the tests, and it never imports app.js (the
 * things it needs from the app are injected: `getGames`, `liveRoster`, `almaApplicable`), so there is no cycle.
 *
 * EVERY caller builds its context here and nowhere else (CONVENTIONS #21, the UN-126 class: display and money
 * disagreeing): finalize, the Dashboard, Weekly History, the season's pooled groups, the recap and the CSVs.
 *
 * SECURITY (design review Amendment 1; the conditions are quoted where they bite):
 *   SC-K1  every lookup keyed by a school or a player id is an OWN-PROPERTY read (ownGet), every map this module
 *          builds is null-prototype, and the builders can never throw out of finalize (they return a context with
 *          `degraded` set instead).
 *   SC-K2  a graded alma game counts only if it KICKED OFF at or after its own part's lock: a result already known
 *          cannot be bought by switching school before the lock.
 *   SC-K3  the snapshot reader accepts strings only, JS-trims, de-duplicates and sorts the roster by a fixed
 *          comparator, so the same league reads identically whichever writer made the map.
 *   SC-K5  the fallback tiers (current school) end at ALMA_SNAPSHOT_EPOCH_AT: after it, a week with no map runs with
 *          the alma step SKIPPED, never with a player's current school.
 *   SC-K6  a stored descriptor is untrusted input: validTieBreak() first, constant-led captions, numbers through
 *          Number(), names clipped to 80 characters, and no descriptor field ever goes into an attribute.
 *
 * Vocabulary: the league says "picks", never the other word (UN-77); this file is under that guard.
 */

import { getAlmaMaterMatch, getEffectiveGroupId, getGroupTiebreakerWeek, weeksInGroup, GAME_STATUS, WEEK_STATUS, ownGet } from './data-model.js';
import { calculateAtsWinner } from './scoring.js';
import { gradeWeekExtraPoint, extraPointActualIsUsable } from './extra-point.js';

// ─── constants ──────────────────────────────────────────────────────────────────────────────────

/**
 * DI-467 (forward-only, Drew Q9). The rule governs weeks finalized at or after this instant; a week finalized
 * before it keeps today's behaviour on every surface (Recalculate cannot re-rank it, and in a shared league it cannot
 * change a stored result at all: adaptertest [A-RECALC]). Drew's approval date: later than every week finalized before
 * the ruling, earlier than any week the new code can finalize.
 *
 * THE PRE-DEPLOY READ (LP-3; the old "run Recalculate once" baseline step is struck, it cannot run in a shared league).
 * Drew runs, across ALL leagues, one query:  select max(finalized_at) from public.weeks where status = 'final';
 * If the result is at or after this constant, a week the OLD code finalized would be re-ranked by the new rule, so stamp
 * this constant LATER than it (the `select now();` value from R-4b works). Until a build carrying SP-54 reaches the phones,
 * Drew finalizes from the web app only: an older build stores no descriptor and its accidental order as the winner.
 *   STAMPED 2026-10-03 from the LIVE reads (runbook 0038-C): max(finalized_at) = 2026-09-27 13:23:51.294674+00, so the
 *   `select now();` value taken right after the LIVE 0038 paste (2026-10-03 05:05:00.220874+00) is used, as C-1 allows.
 */
export const TIE_RULE_EFFECTIVE_AT = '2026-10-03T05:05:00.220Z';

/**
 * SC-K5. THE EPOCH THE FALLBACK TIERS END AT: "the migration's apply time, read from the database clock" (the
 * clock that stamps weeks.locked_at). Drew runs `select now();` right after the 0038 paste (R-4b) and the
 * coordinator stamps the value here, the way APP_VERSION is stamped.
 *   STAMPED 2026-10-03: the LIVE `select now();` read right after the 0038 paste returned Success
 *   (2026-10-03 05:05:00.220874+00, truncated to the millisecond).
 */
export const ALMA_SNAPSHOT_EPOCH_AT = '2026-10-03T05:05:00.220Z';

/** The ONE stage list: the Rules copy, the captions and the tests read it (drift guard, DI-470 T-R3). */
export const TIE_STAGES = Object.freeze([
  Object.freeze({ key: 'picks',      label: 'Picks' }),
  Object.freeze({ key: 'tiebreaker', label: 'Tiebreaker' }),
  Object.freeze({ key: 'alma',       label: 'Your alma mater vs. the spread' }),
  Object.freeze({ key: 'ep',         label: 'Extra Point' }),
  Object.freeze({ key: 'draw',       label: "The week's draw" }),
]);
/** The stages a stored descriptor may name (Step 1, picks, is the ranking itself and never a tie stage). */
export const TIE_STAGE_KEYS = new Set(TIE_STAGES.map(s => s.key).filter(k => k !== 'picks'));

/**
 * Every constant string the captions, the finalize notices and the toasts are built from. A caption always BEGINS
 * with one of these (SC-K6): data (a name, a school) never leads a line, so a hostile value cannot reach the first
 * character of a CSV cell, a recap line or a note.
 */
export const TIE_COPY = Object.freeze({
  winnerLead: 'Won the tie',
  loserLead: 'Last on the tie',
  onEp: ' on the Extra Point',
  namedPrefix: 'Tie: ',
  draw: "Dead heat on every tiebreaker. Settled by the week's draw.",
  drawRecap: "dead heat on every tiebreaker, settled by the week's draw",
  schoolsNow: ' (schools as listed now)',
  noGuess: 'no tiebreaker guess',
  noEntry: 'no Extra Point entry',
  degradedAlma: 'The alma mater step could not be read for this week and was skipped, so the Extra Point decides.',
  degradedEp: 'The Extra Point step could not be read for this week and was skipped.',
  // The Extra Point save on a final week (DI-467 part 4, N-1).
  epSavedRecalculated: 'Extra Point saved — week results recalculated',
  outcomeChangedTail: 'Recorded outcome changed — check Weekly History and Obligation Corrections.',
  epSavedSharedFinal: 'Extra Point saved. This week is already final, so its results were not recalculated. Move it back to live and finalize it again to apply it.',
  // N-1 (coordinator, approved inline as part of DI-469, 2026-10-01): the two other callers of the same limitation. In a shared league `results` is written only by
  // finalize_week() on a live-to-final move (js/supabase-backend.js `results_outside_finalize`; adaptertest [A-RECALC]), so a tiebreaker saved on a FINAL week and the
  // Data-tab "Recalculate All Finalized Weeks" button cannot recalculate anything. They say so up front and never attempt the write (no refused write, no red banner).
  // Both are siblings of the approved epSavedSharedFinal sentence above (same facts, same next action), not new vocabulary.
  tbSavedSharedFinal: 'Tiebreaker saved. This week is already final, so its results were not recalculated. Move it back to live and finalize it again to apply it.',
  recalcSharedRefused: "Nothing was recalculated. A week that's already final can't be recalculated here. To apply a correction, move that week back to live and finalize it again.",
  // The same facts without the first sentence: the Data-tab card's caption in a shared league (the button beside it is disabled, with this as its reason).
  recalcSharedFacts: "A week that's already final can't be recalculated here. To apply a correction, move that week back to live and finalize it again.",
  // The sentence DI-469 appends to the Comm Data "Recalculate All Finalized Weeks" caption. It is shown ONLY where the button can actually apply it (a local
  // league): in a shared league the adapter refuses a results write outside finalize_week() (adaptertest [A-RECALC]), so the sentence would promise a recalculation
  // that cannot happen. In a shared league the card shows recalcSharedFacts (above) in place of the whole caption and the button is disabled with that as its reason
  // (renderRecalculateFinalizedWeeksAdminSectionHTML; tiebreaktest [T27c]).
  recalcCaption: ' It also applies the Weekly Ties rules to weeks finalized since they took effect; weeks settled before then keep the result they had. A changed winner or loser is flagged for review and never overwritten.',
  // The finalize notices (DI-469). Bodies, then the per-surface suffixes.
  finalizeBody: Object.freeze({
    'tb-missing': "This week has a tie in correct picks and no tiebreaker value entered. If you finalize now, it is settled by each tied player's alma mater against the spread, then the Extra Point.",
    'tb-missing-draw': "This week has a tie in correct picks and no tiebreaker value entered, and as it stands it would end at the week's draw.",
    'ep-missing': 'This tie would be settled by the Extra Point, and no longest field goal is entered yet.',
  }),
  finalizeSuffix: Object.freeze({
    confirm: Object.freeze({
      tb: ' Enter the tiebreaker first (Cancel), or finalize anyway and fix it later; entering the tiebreaker or the Extra Point afterward recalculates the week (OK).',
      ep: " Enter it first (Cancel), or finalize anyway and let the week's draw decide; entering it afterward recalculates the week (OK).",
    }),
    confirmShared: Object.freeze({
      tb: ' Enter the tiebreaker first (Cancel), or finalize anyway (OK). A value entered later is applied by moving the week back to live and finalizing it again.',
      ep: " Enter it first (Cancel), or finalize anyway and let the week's draw decide (OK). To apply it later, move the week back to live and finalize it again.",
    }),
    wizard: Object.freeze({
      tb: ' Enter it in Confirm Tiebreaker, then continue to Finalize.',
      ep: " Enter it in Confirm Extra Point, or the week's draw decides.",
    }),
  }),
});

// ─── small pure helpers ─────────────────────────────────────────────────────────────────────────

/** A school compared the way every alma mater consumer compares it: trimmed, case-insensitive. */
export function normAlma(s) { return String(s || '').trim().toLowerCase(); }

const clip = (s) => String(s == null ? '' : s).slice(0, 80);
const finiteOrNull = (n) => (typeof n === 'number' || (typeof n === 'string' && n.trim() !== '')) && Number.isFinite(Number(n)) ? Number(n) : null;
/** A number printed without float noise: 3, 2.5. */
const fmtNum = (n) => String(Math.round(Number(n) * 100) / 100);
const cap = (s) => (/^[a-z]/.test(s) ? s[0].toUpperCase() + s.slice(1) : s);
const isPlainObject = (o) => !!o && typeof o === 'object' && !Array.isArray(o);

// ─── DI-467 — is the rule in force for this week? ───────────────────────────────────────────────

/**
 * Forward-only, made structural (J1). Returns true when S3 to S5 may run for `weeks` (one week, or every member of
 * a group). `forPreview` is the commissioner's "if I finalize now" read (DI-469). `settlingNow` is the live-to-final
 * transition itself (N-3): the rule is in force on the week being settled whatever this device's clock says, and
 * every LATER read goes by the stamp (which, after a hydrate, is the server's finalized_at).
 */
export function tieRuleInForce(weeks, { forPreview = false, settlingNow = false } = {}) {
  if (!weeks || !weeks.length) return false;
  if (forPreview) return true;
  if (!weeks.every(w => w && w.status === WEEK_STATUS.FINAL)) return false;     // S3 to S5 never run on an unsettled week
  if (settlingNow) return true;
  if (weeks.every(w => w.dataSourceMode === 'demo')) return true;               // demo weeks rehearse the rule (commissioner-only, UN-71)
  const stamps = weeks.map(w => Date.parse(w.finalizedAt || ''));
  if (stamps.some(t => !Number.isFinite(t))) return false;                      // no stamp: settled before the rule existed
  return Math.max(...stamps) >= Date.parse(TIE_RULE_EFFECTIVE_AT);              // a group: the LAST member to finalize decides
}

// ─── DI-465 — the lock-time alma mater snapshot, and the reader ─────────────────────────────────

/** SC-K5: the fallback tiers exist only for a week that locked before the snapshot did. */
export function fallbackTiersAllowed(week) {
  const t = Date.parse((week && week.lockedAt) || '');
  return Number.isFinite(t) && t < Date.parse(ALMA_SNAPSHOT_EPOCH_AT);
}

/** Longest school first, then by normalized text, then by the text, in code-unit order (SC-K3): the substring fallback of
 *  getAlmaMaterMatch walks the roster in order, so the order must not depend on who wrote the list. */
function rosterCompare(a, b) {
  const na = normAlma(a), nb = normAlma(b);
  return nb.length - na.length || (na < nb ? -1 : na > nb ? 1 : 0) || (a < b ? -1 : a > b ? 1 : 0);
}
/** Strings only, trimmed, non-empty, de-duplicated by normAlma, sorted by the fixed comparator. */
function cleanRoster(list) {
  const strs = (Array.isArray(list) ? list : []).filter(x => typeof x === 'string').map(x => x.trim()).filter(Boolean).sort(rosterCompare);
  const seen = new Set();
  const out = [];
  for (const s of strs) {
    const k = normAlma(s);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}
const TIER_RANK = { snapshot: 0, 'locked-roster': 1, live: 2 };

/**
 * Which school each player held for this week, and the roster used to find the week's games. Three tiers, first match
 * wins; the tier used is returned as `source` and shown to players when it is not `snapshot` (DI-468).
 *   1. snapshot       week.lockedAlmaByPlayer is a plain object whose values are all strings (A.3).
 *   2. locked-roster  no map; the week locked BEFORE the epoch; week.lockedAlmaMaters is a list. A player's school is his
 *                     CURRENT one, only if it equals an entry of that list.
 *   3. live           no map, no list, locked before the epoch: the live roster and the current school.
 *   none              no map and not before the epoch (or no usable lockedAt): no roster, no school — S3 is skipped (SC-K5).
 * @returns {{source:'snapshot'|'locked-roster'|'live'|'none', roster:string[], schoolOf:(playerId:string)=>(string|null)}}
 */
export function almaSnapshotForWeek(week, { players = [], liveRoster = [] } = {}) {
  const byId = new Map();
  for (const p of players || []) if (p && p.playerId != null) byId.set(p.playerId, p);
  const currentSchool = (pid) => {
    const p = byId.get(pid);
    const t = p && typeof p.almaMater === 'string' ? p.almaMater.trim() : '';
    return t || null;
  };
  const map = week ? week.lockedAlmaByPlayer : undefined;
  if (isPlainObject(map) && Object.values(map).every(v => typeof v === 'string')) {
    const roster = cleanRoster(Object.values(map));
    return {
      source: 'snapshot', roster,
      schoolOf: (pid) => { const v = ownGet(map, pid); return typeof v === 'string' && v.trim() ? v.trim() : null; },
    };
  }
  if (fallbackTiersAllowed(week)) {
    if (week && Array.isArray(week.lockedAlmaMaters)) {
      const roster = cleanRoster(week.lockedAlmaMaters);
      const byNorm = new Map(roster.map(r => [normAlma(r), r]));
      return {
        source: 'locked-roster', roster,
        schoolOf: (pid) => { const cur = currentSchool(pid); return cur ? (byNorm.get(normAlma(cur)) || null) : null; },
      };
    }
    return { source: 'live', roster: cleanRoster(liveRoster), schoolOf: currentSchool };
  }
  return { source: 'none', roster: [], schoolOf: () => null };
}

// ─── DI-466 — the key builders ──────────────────────────────────────────────────────────────────

/**
 * S3 keys, exactly (needs doc 4a). For each member week, each FINAL game with a usable ATS result that kicked off at or
 * after THAT part's own lock (SC-K2), each side whose getAlmaMaterMatch() resolves to a school a player held: a push counts
 * a push, the ATS winner equal to that side's own team counts covered, otherwise not covered. Counts are summed across the
 * parts of a group. `team` in the echo is the GAME ROW's own team name — never the player's free-text school.
 * @returns {{keys: Object|null, facts: Object}} keys is null when no member week yields a usable snapshot tier.
 */
export function buildAlmaKeys({ weeks, players, getGames, liveRoster }) {
  const acc = new Map();            // playerId -> { cov, mis, psh, team, src }
  let anyUsable = false;
  for (const w of weeks || []) {
    if (!w) continue;
    const snap = almaSnapshotForWeek(w, { players, liveRoster });
    if (snap.source === 'none') continue;
    anyUsable = true;
    const lockT = Date.parse(w.lockedAt || '');
    const demo = w.dataSourceMode === 'demo';
    const kickedAfterLock = (g) => demo || (Number.isFinite(lockT) && g.kickoffDateOnly !== true
      && Number.isFinite(Date.parse(g.kickoff || '')) && Date.parse(g.kickoff) >= lockT);
    for (const g of (getGames(w.weekId) || [])) {
      if (!g || g.status !== GAME_STATUS.FINAL) continue;
      const ats = g.atsWinner ?? calculateAtsWinner(g);
      if (!ats || (ats !== 'no_decision' && ats !== g.homeTeam && ats !== g.awayTeam)) continue;   // no usable ATS result
      if (!kickedAfterLock(g)) continue;
      for (const team of [g.homeTeam, g.awayTeam]) {
        if (typeof team !== 'string') continue;
        const entry = getAlmaMaterMatch(team, snap.roster);
        if (!entry) continue;
        const want = normAlma(entry);
        for (const p of players || []) {
          if (!p) continue;
          const school = snap.schoolOf(p.playerId);
          if (!school || normAlma(school) !== want) continue;
          const a = acc.get(p.playerId) || { cov: 0, mis: 0, psh: 0, team, src: snap.source };
          if (ats === 'no_decision') a.psh++; else if (ats === team) a.cov++; else a.mis++;
          if (TIER_RANK[snap.source] > TIER_RANK[a.src]) a.src = snap.source;
          acc.set(p.playerId, a);
        }
      }
    }
  }
  const keys = Object.create(null), facts = Object.create(null);
  for (const p of players || []) {
    if (!p) continue;
    const a = acc.get(p.playerId);
    keys[p.playerId] = a ? { played: true, net: a.cov - a.mis } : { played: false, net: 0 };
    if (a) facts[p.playerId] = { team: a.team, cov: a.cov, mis: a.mis, psh: a.psh, src: a.src };
  }
  return { keys: anyUsable ? keys : null, facts };
}

/**
 * S4 keys from the EXISTING grader (gradeWeekExtraPoint is never re-derived). null unless the week's Extra Point is
 * enabled AND its actual is usable (Number('') is 0, which would bust the league: extraPointActualIsUsable first).
 * Class 0 = a guess not over the actual (exact included), 1 = a bust, 2 = no entry.
 * @returns {{byPlayer: Object, facts: Object}|null}
 */
export function buildExtraPointKeys(tieWeek, players) {
  if (!tieWeek || tieWeek.extraPointEnabled === false || !extraPointActualIsUsable(tieWeek)) return null;
  const graded = gradeWeekExtraPoint(tieWeek, players || []);
  if (!graded) return null;
  const byPlayer = Object.create(null), facts = Object.create(null);
  for (const r of graded.rows) {
    const cls = r.outcome === 'bust' ? 1 : r.outcome === 'no-entry' ? 2 : 0;
    byPlayer[r.playerId] = { cls, delta: cls === 0 ? r.delta : null };
    facts[r.playerId] = { guess: r.guess == null ? null : r.guess, cls, delta: r.delta == null ? null : r.delta };
  }
  return { byPlayer, facts };
}

/**
 * The TieContext for one week (`weeks` = [week]) or one complete group (`weeks` = every member), or null — and null means
 * "today's exact behaviour" to every caller. The alma half and the Extra Point half are built in separate try/catch blocks
 * (SC-K1): a failure in one is logged, the half is skipped and `degraded` names it, so a finalize that already ran is never
 * aborted by this builder and no read of a school string can reach scoring.js (which only ever sees numeric keys).
 */
export function buildWeekTieContext({ weeks, players, getGames, liveRoster, almaApplicable, forPreview = false, settlingNow = false }) {
  if (!tieRuleInForce(weeks, { forPreview, settlingNow })) return null;
  const seed = getEffectiveGroupId(weeks[0]);
  const facts = Object.create(null);
  const put = (pid, k, v) => { (facts[pid] = facts[pid] || {})[k] = v; };
  const degraded = [];
  let alma = null, ep = null;
  if (almaApplicable) {
    try {
      const a = buildAlmaKeys({ weeks, players, getGames, liveRoster });
      alma = a.keys;
      for (const pid of Object.keys(a.facts)) put(pid, 'alma', a.facts[pid]);
    } catch (e) { console.error('[tie] the alma mater half could not be built; step 3 is skipped', e); alma = null; degraded.push('alma'); }
  }
  try {
    const e = buildExtraPointKeys(getGroupTiebreakerWeek(weeks), players);
    if (e) {
      ep = { byPlayer: e.byPlayer };
      for (const pid of Object.keys(e.facts)) put(pid, 'ep', e.facts[pid]);
    }
  } catch (e) { console.error('[tie] the Extra Point half could not be built; step 4 is skipped', e); ep = null; degraded.push('ep'); }
  return { seed, alma, ep, facts, degraded };
}

/**
 * One context per multi-part group (>= 2 member weeks) that is in force: the season's pooled win/loss uses the same
 * context the finalize and History paths use (needs doc F8). Singletons are not built (the season function only ever asks
 * for a group's). `almaApplicableFor(week)` is the app's sport-profile check, injected.
 * @returns {Map<string, object>} groupId -> TieContext
 */
export function buildGroupTieContexts({ allWeeks, players, getGames, liveRoster, almaApplicableFor }) {
  const out = new Map();
  const seen = new Set();
  const applicable = (w) => { try { return !!almaApplicableFor && !!almaApplicableFor(w); } catch { return false; } };
  for (const w of allWeeks || []) {
    if (!w) continue;
    const gid = getEffectiveGroupId(w);
    if (seen.has(gid)) continue;
    seen.add(gid);
    const members = weeksInGroup(allWeeks, w);
    if (members.length < 2) continue;
    const ctx = buildWeekTieContext({ weeks: members, players, getGames, liveRoster, almaApplicable: members.every(applicable) });
    if (ctx) out.set(gid, ctx);
  }
  return out;
}

// ─── SC-K6 — the stored descriptor is untrusted input ───────────────────────────────────────────

export function validTieBreak(tb) {
  return !!tb && typeof tb === 'object' && tb.v === 1
    && TIE_STAGE_KEYS.has(tb.stage) && (tb.end === 'winner' || tb.end === 'loser');
}
/** The stage that decided this row's end of the table, or null (also null for a descriptor that fails validation). */
export function tieDecidedBy(row) {
  return row && validTieBreak(row.tieBreak) ? row.tieBreak.stage : null;
}

// ─── DI-468 — the words ─────────────────────────────────────────────────────────────────────────

function almaWord(f) {
  const cov = finiteOrNull(f.cov), mis = finiteOrNull(f.mis), psh = finiteOrNull(f.psh);
  if (cov === null || mis === null || psh === null || cov < 0 || mis < 0 || psh < 0) return null;
  if (cov + mis + psh === 1) return cov ? 'covered' : psh ? 'pushed' : 'did not cover';
  return `went ${fmtNum(cov)}-${fmtNum(mis)}${psh ? `-${fmtNum(psh)}` : ''} against the spread`;
}
/** How one player did on the Extra Point, in words. null when the facts are not usable. */
function epWord(f) {
  const cls = f && f.cls;
  if (cls === 2) return TIE_COPY.noEntry;
  const guess = f ? finiteOrNull(f.guess) : null;
  if (guess === null) return null;
  if (cls === 1) return `busted at ${fmtNum(guess)} yd`;
  const delta = finiteOrNull(f.delta);
  if (cls !== 0 || delta === null || delta < 0) return null;
  return `${fmtNum(guess)} yd, ${delta === 0 ? 'exact' : `${fmtNum(delta)} under`}`;
}

/**
 * The reason, lower-case-led where it is prose ("tiebreaker off by 3, Koby off by 7"; "Notre Dame covered, USC did not
 * cover"; "50 yd, 2 under"). '' when the descriptor's facts are not usable — the sinks then show nothing rather than guess.
 * School names printed are the GAME ROW's team names (tb.me.team), never a player's free-text school.
 */
export function tieReason(tb, { otherName = '' } = {}) {
  if (!validTieBreak(tb)) return '';
  const name = clip(otherName) || 'the other player';
  if (tb.stage === 'tiebreaker') {
    const dm = tb.me ? finiteOrNull(tb.me.delta) : null, dO = tb.other ? finiteOrNull(tb.other.delta) : null;
    if (dm === null && dO === null) return '';
    return `${dm === null ? TIE_COPY.noGuess : `tiebreaker off by ${fmtNum(dm)}`}, ${dO === null ? `${name} made no guess` : `${name} off by ${fmtNum(dO)}`}`;
  }
  if (tb.stage === 'alma') {
    if (!isPlainObject(tb.me) || !isPlainObject(tb.other)) return '';
    const tm = typeof tb.me.team === 'string' ? clip(tb.me.team) : '', to = typeof tb.other.team === 'string' ? clip(tb.other.team) : '';
    const wm = almaWord(tb.me), wo = almaWord(tb.other);
    if (!tm || !to || !wm || !wo) return '';
    return `${tm} ${wm}, ${to} ${wo}${tb.src === 'snapshot' ? '' : TIE_COPY.schoolsNow}`;
  }
  if (tb.stage === 'ep') {
    if (!isPlainObject(tb.me)) return '';
    const mine = epWord(tb.me);
    if (!mine) return '';
    if (tb.end === 'winner' && tb.me.cls === 1 && isPlainObject(tb.other) && tb.other.cls === 2) return `${mine}, ${name} made no entry`;
    return mine;
  }
  return '';
}

/** "Won the tie" / "Last on the tie" (+ " on the Extra Point"), or the named lead ("Tie: Kevin won"). */
export function tieLead(tb, { named = false, subject = '' } = {}) {
  if (!validTieBreak(tb)) return '';
  const winner = tb.end === 'winner';
  const onEp = tb.stage === 'ep';
  if (!named) return `${winner ? TIE_COPY.winnerLead : TIE_COPY.loserLead}${onEp ? TIE_COPY.onEp : ''}`;
  return `${TIE_COPY.namedPrefix}${clip(subject)} ${winner ? 'won' : 'is last'}${onEp ? TIE_COPY.onEp : ''}`;
}

/**
 * One caption. UNNAMED (the row is the subject: the Dashboard and the CSV): "Won the tie: Notre Dame covered, USC did not
 * cover". NAMED (a shared row: Weekly History): "Tie: Kevin won. Notre Dame covered, USC did not cover". Both begin with a
 * TIE_COPY constant. '' when there is nothing honest to say.
 */
export function tieCaption(tb, { named = false, subject = '', otherName = '' } = {}) {
  if (!validTieBreak(tb)) return '';
  if (tb.stage === 'draw') {
    return named
      ? `${TIE_COPY.namedPrefix}Dead heat between ${clip(subject)} and ${clip(otherName) || 'the other player'} on every tiebreaker. Settled by the week's draw.`
      : TIE_COPY.draw;
  }
  const reason = tieReason(tb, { otherName });
  if (!reason) return '';
  return named ? `${tieLead(tb, { named: true, subject })}. ${cap(reason)}` : `${tieLead(tb)}: ${reason}`;
}

/** The recap's inline phrase, always parenthesised by the caller and always led by a constant: "won the tie: ...". */
export function tieRecapPhrase(tb, { otherName = '' } = {}) {
  if (!validTieBreak(tb)) return '';
  if (tb.stage === 'draw') return TIE_COPY.drawRecap;
  const reason = tieReason(tb, { otherName });
  if (!reason) return '';
  const lead = `${tb.end === 'winner' ? TIE_COPY.winnerLead : TIE_COPY.loserLead}${tb.stage === 'ep' ? TIE_COPY.onEp : ''}`;
  return `${lead[0].toLowerCase()}${lead.slice(1)}: ${reason}`;
}

/**
 * Weekly History's note lines for one week: [] or [{ end: 'winner'|'loser'|'both', text }]. Named form. A draw is printed ONCE
 * when the two ends name the same two players (a two-player league), otherwise once per end. `nameOf(playerId)` is the caller's
 * display-name resolver; every text is plain and is escaped at the sink.
 */
export function tieNoteLines(winner, loser, nameOf) {
  const nm = (pid) => clip(typeof nameOf === 'function' ? nameOf(pid) : pid);
  const w = winner && validTieBreak(winner.tieBreak) ? winner.tieBreak : null;
  const l = loser && validTieBreak(loser.tieBreak) ? loser.tieBreak : null;
  const out = [];
  if (w && l && w.stage === 'draw' && l.stage === 'draw' && w.vs === loser.playerId && l.vs === winner.playerId) {
    out.push({ end: 'both', text: tieCaption(w, { named: true, subject: nm(winner.playerId), otherName: nm(w.vs) }) });
    return out;
  }
  if (w) { const text = tieCaption(w, { named: true, subject: nm(winner.playerId), otherName: nm(w.vs) }); if (text) out.push({ end: 'winner', text }); }
  if (l) { const text = tieCaption(l, { named: true, subject: nm(loser.playerId), otherName: nm(l.vs) }); if (text) out.push({ end: 'loser', text }); }
  return out;
}

// ─── DI-469 — the finalize notice, one composer for every site ──────────────────────────────────

/**
 * What the commissioner is told BEFORE finalizing a tie (replacing the three copies of the false sentence). Pure.
 *   tb-missing        a tie in picks, no tiebreaker value, and the preview does NOT reach the draw
 *   tb-missing-draw   the same, and the preview DOES reach the draw
 *   ep-missing        a tiebreaker value is on file, the tie would still reach the draw, the Extra Point is enabled and has no result
 *   (silent)          a tie that ends at the draw with the Extra Point entered or disabled is a true dead heat: nothing is actionable
 * `variant` is 'confirm' (the browser dialog) or 'wizard' (the guided Step 4 inline box); `shared` is a shared league, where
 * re-finalizing a FINAL week is refused (N-1) and the "recalculates" suffix would be false.
 * @returns {{show:boolean, kind:string|null, text:string}}
 */
export function composeFinalizeTieNotice({ legacyTrigger, winnerStage, loserStage, epEnabled, epUsable, variant = 'confirm', shared = false }) {
  const drawReached = winnerStage === 'draw' || loserStage === 'draw';
  const note = (kind) => {
    const group = kind === 'ep-missing' ? 'ep' : 'tb';
    const table = variant === 'wizard' ? TIE_COPY.finalizeSuffix.wizard : (shared ? TIE_COPY.finalizeSuffix.confirmShared : TIE_COPY.finalizeSuffix.confirm);
    return { show: true, kind, text: TIE_COPY.finalizeBody[kind] + table[group] };
  };
  if (legacyTrigger && !drawReached) return note('tb-missing');
  if (legacyTrigger && drawReached) return note('tb-missing-draw');
  if (!legacyTrigger && drawReached && epEnabled && !epUsable) return note('ep-missing');
  return { show: false, kind: null, text: '' };
}
