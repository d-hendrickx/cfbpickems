/**
 * CFB Pickems — game-state.js (Deployment 1, Lane B, DI-570, 2026-10-07)
 * ======================================================================
 * ONE vocabulary for "what state is this game in", for every surface that shows a game. The app stores only three statuses
 * (GAME_STATUS: scheduled | live | final — js/data-model.js) and ESPN's delayed / postponed states normalize to `scheduled`
 * (js/data-provider.js), so a stale score and a fresh one looked identical, and a game past kickoff with no score said nothing.
 * This pure module gives each of those cases one honest word, and every surface reads it (Live Peek rows, the Dashboard compact row
 * and matrix status cells, the Home summary, card details, and later GameDay and the thread header).
 *
 *   phase        what it means                                          label (what a chip says)
 *   ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 *   upcoming     scheduled, kickoff in the future (or unknown)          the kickoff time, in the viewer's zone (injected)
 *   awaiting     scheduled, kickoff has PASSED, no result yet           "Waiting for a score update"
 *   live         status live, a live-status capture <= 3 minutes old     the capture's own short text (quarter and clock, "Halftime")
 *   live-stale   status live, no capture or one older than 3 minutes     "Score may be behind" (the last known score stays visible)
 *   final        status final, with a score                              "Final"
 *   no-score     live or final, but no score on the record               "Score not available yet"
 *
 * THE DECIDED-LANGUAGE RULE (Std-8). Nothing is called "won", "lost", "clinched" or "locked in" before the game is final. `isDecided(phase)` is
 * true for `final` and for nothing else; `coverWord()` is the one place the covering / trailing / covered / did-not-cover words live, so a template
 * cannot say the wrong one for its phase. `BANNED_LIVE_WORDS` + `containsBannedLiveWord()` are what the copy-scan test (gamestatetest) runs over
 * every live-phase string this lane writes.
 *
 * PARITY. In the fresh `live` and `final` phases the label is byte-for-byte what js/app.js's liveStatusDisplayShort() / the FINAL chip print today
 * (the budget, the halftime rule and the ellipsis are the same lines; gamestatetest pins them against a frozen copy of the original). Adopting the
 * model therefore changes only the cases that were wrong: a stale score, a game past kickoff with no score.
 *
 * MANUAL AND DEMO GAMES. A game the commissioner runs by hand (`isManual`) or a Demo Simulation game (`dataSource: 'demo'`) has no provider capture, ever; "no
 * capture" is not evidence that its score is behind. Its live phase is `live` with `fresh: null` (freshness unknown, not stale). Recorded as a DI-570
 * interpretation in the handoff.
 *
 * Pure: no DOM, no storage, no clock of its own (`now` is a parameter), no imports. Reads synchronously (CONVENTIONS #9).
 */

/** js/app.js's LIVE_STATUS_STALE_MS, the same three minutes (gamestatetest pins the two together). */
export const LIVE_STATUS_STALE_MS = 3 * 60 * 1000;
/** js/app.js's LIVE_STATUS_SHORT_BUDGET: a compact chip never wraps. */
export const LIVE_STATUS_SHORT_BUDGET = 14;

export const GAME_PHASES = Object.freeze(['upcoming', 'awaiting', 'live', 'live-stale', 'final', 'no-score']);

export const PHASE_LABELS = Object.freeze({
  awaiting: 'Waiting for a score update',
  'live-stale': 'Score may be behind',
  final: 'Final',
  'no-score': 'Score not available yet',
});

/** Words no template may use for a game that is not final. */
export const BANNED_LIVE_WORDS = Object.freeze(['won', 'lost', 'clinched', 'locked in', 'decided']);

const isNum = (v) => v !== null && v !== undefined && String(v).trim() !== '' && Number.isFinite(Number(v));
const toMs = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const ms = v ? Date.parse(v) : NaN;
  return Number.isFinite(ms) ? ms : null;
};

/** True when the text uses a word that only a FINAL game may use (word-boundary match, case-insensitive). */
export function containsBannedLiveWord(text) {
  const t = String(text ?? '');
  return BANNED_LIVE_WORDS.some(w => new RegExp(`(^|[^a-z])${w.replace(/ /g, '\\s+')}([^a-z]|$)`, 'i').test(t));
}

/** The capture's own short text — liveStatusDisplayShort()'s `text`, same rules: Halftime by status name, the <=14 character budget with an ellipsis. */
export function liveDetailLabel(entry) {
  if (!entry || typeof entry !== 'object') return '';
  const isHalftime = entry.name === 'STATUS_HALFTIME';
  const source = isHalftime ? 'Halftime' : String(entry.shortDetail || entry.detail || '');
  return source.length <= LIVE_STATUS_SHORT_BUDGET ? source : source.slice(0, Math.max(0, LIVE_STATUS_SHORT_BUDGET - 1)) + '…';
}

/**
 * @param {object} game  a game record (status, kickoff, homeScore, awayScore, isManual, lastUpdated)
 * @param {{liveEntry?:object|null, now?:number, staleMs?:number, formatKickoff?:Function}} opts
 *        liveEntry — the game's liveStatusById value (or null); formatKickoff(iso) — the viewer-zone formatter (CONVENTIONS #19)
 * @returns {{phase:string, label:string, score:({home:number,away:number}|null), fresh:(boolean|null), capturedAt:(number|null), ageMs:(number|null), pulse:boolean}}
 *   fresh: true = a capture within the window; false = stale or never captured; null = not applicable (not live, or a manual game).
 *   pulse: whether the live dot should animate (the existing rule: not at halftime, not when stale).
 */
export function gameStateOf(game, { liveEntry = null, now = Date.now(), staleMs = LIVE_STATUS_STALE_MS, formatKickoff = (iso) => String(iso ?? '') } = {}) {
  const g = (game && typeof game === 'object') ? game : {};
  const hasScore = isNum(g.homeScore) && isNum(g.awayScore);
  const score = hasScore ? { home: Number(g.homeScore), away: Number(g.awayScore) } : null;
  const base = { score, fresh: null, capturedAt: null, ageMs: null, pulse: false };

  if (g.status === 'final') {
    return hasScore ? { ...base, phase: 'final', label: PHASE_LABELS.final } : { ...base, phase: 'no-score', label: PHASE_LABELS['no-score'] };
  }

  if (g.status === 'live') {
    if (!hasScore) return { ...base, phase: 'no-score', label: PHASE_LABELS['no-score'] };
    const entry = (liveEntry && typeof liveEntry === 'object') ? liveEntry : null;
    const capturedAt = entry && isNum(entry.capturedAt) ? Number(entry.capturedAt) : null;
    if (g.isManual === true || g.dataSource === 'demo') return { ...base, phase: 'live', label: entry ? liveDetailLabel(entry) : '', fresh: null, capturedAt, pulse: !!entry && entry.name !== 'STATUS_HALFTIME' };
    // An entry that carries no capturedAt reads as "captured just now" — liveStatusDisplayShort()'s own `entry.capturedAt ?? nowMs` — so a hand-built entry is fresh;
    // the stale rule bites only on an old capture, and "no capture at all" (no entry) is the live-stale case below.
    const ageMs = entry ? (capturedAt === null ? 0 : Math.max(0, now - capturedAt)) : null;
    if (entry && ageMs <= staleMs) {
      return { ...base, phase: 'live', label: liveDetailLabel(entry), fresh: true, capturedAt, ageMs, pulse: entry.name !== 'STATUS_HALFTIME' };
    }
    return { ...base, phase: 'live-stale', label: PHASE_LABELS['live-stale'], fresh: false, capturedAt, ageMs, pulse: false };
  }

  // 'scheduled' — and anything unrecognised is treated as scheduled, the safe reading.
  const kickoffMs = toMs(g.kickoff);
  if (kickoffMs !== null && kickoffMs <= now) return { ...base, phase: 'awaiting', label: PHASE_LABELS.awaiting };
  const label = kickoffMs === null ? 'TBD' : String(formatKickoff(g.kickoff) ?? '');
  return { ...base, phase: 'upcoming', label };
}

export const isLivePhase = (phase) => phase === 'live' || phase === 'live-stale';
/** The ONLY phase in which a result may be called a result. */
export const isDecided = (phase) => phase === 'final';

/**
 * The covering words. `covering`: true / false / null (null = right on the number). Live phases are tentative; `final` is settled; any other phase has no cover language.
 *   live:  covering → "covering", false → "trailing", null → "right on the number"
 *   final: covering → "covered",  false → "did not cover", null → "push"
 */
export function coverWord(phase, covering) {
  if (isLivePhase(phase)) return covering === true ? 'covering' : covering === false ? 'trailing' : 'right on the number';
  if (phase === 'final') return covering === true ? 'covered' : covering === false ? 'did not cover' : 'push';
  return '';
}

/** "12s ago" under a minute, else whole minutes: "3m ago". */
function agoShort(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m`;
}

/**
 * The freshness line, exact DI-570 copy.
 *   live        "Updated 12s ago" / "Updated 3m ago"
 *   live-stale  "Scores may be behind — last update 4 min ago."   (no capture: "Update time unavailable.")
 *   final       "Final · confirmed 4:12 PM"                       (no timestamp: "Final")
 *   upcoming    "Kickoff Sat 12:00 PM"
 *   awaiting / no-score → '' (the label already says it)
 * `formatTime(ms|iso)` renders a clock time in the viewer's zone; `formatKickoff(iso)` the kickoff.
 */
export function freshnessLine(state, { game = null, now = Date.now(), formatKickoff = (iso) => String(iso ?? ''), formatTime = null } = {}) {
  const s = state || {};
  switch (s.phase) {
    case 'live':
      if (s.fresh === null) return '';                                   // a manual game: nothing to claim
      return `Updated ${agoShort(s.ageMs ?? 0)} ago`;
    case 'live-stale':
      if (s.capturedAt === null || s.capturedAt === undefined) return 'Update time unavailable.';
      return `Scores may be behind — last update ${Math.max(1, Math.floor(Math.max(0, now - s.capturedAt) / 60000))} min ago.`;
    case 'final': {
      const ms = toMs(game && (game.lastUpdated || game.updatedAt));
      return ms !== null && typeof formatTime === 'function' ? `Final · confirmed ${formatTime(ms)}` : 'Final';
    }
    case 'upcoming':
      return game && game.kickoff ? `Kickoff ${formatKickoff(game.kickoff)}` : 'Kickoff time to be announced';
    default:
      return '';
  }
}
