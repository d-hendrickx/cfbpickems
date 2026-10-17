/**
 * CFB Pickems — next-up.js (Deployment 1, Lane B, DI-599 / PF-455 "After-game continuity", 2026-10-08)
 * ===================================================================================================
 * "What's next": the viewer's next SHARED opportunity, from PUBLISHED (non-Draft) weeks that have games — never invented. One pure function, read by every surface that says it (CONVENTIONS #21):
 * Game Day's Final card ("You went 7–3 · Next: …") and the Game view's What's next card on a Final game (DI-593). (The `week.result` card detail is the third surface DI-599 names; it is not built in this pass.)
 *
 *   nextOpportunity(input) -> { kind, weekId, weekN, sport, sportLabel, entered, lockAt, firstKickoff, editable, live }
 *     kind, by priority (DI-599):
 *       'picks-due'  a week OPEN for picks (its lock instant still ahead) in a sport the viewer is entered in, and they have not picked every game
 *       'picks-in'   a week Open or Locked, entered, every game picked (`editable`: the lock is still ahead, so Edit My Picks is offered)
 *       'follow'     a published slate the viewer cannot act on: a sport they are NOT entered in, or a Locked / Live week (`live`: it has kicked off)
 *       'none'       nothing is published that is still to come
 *   nextLine(next, fmt, { showSport })        the What's next sentence (DI-599's exact copy; the honest variants for a week already under way)
 *   nextShort(next, fmt, { showSport })       the Final card's compact "Next: …" ('' for none: the card says nothing rather than "nothing")
 *   nextAction(next, { showSport })           the button, or null: { action: 'next-picks' | 'open-gameday', label, tone }
 *
 * Never: a Draft week (the commissioner has not published it), a demo week for anyone but the commissioner (UN-71), a week with no games, a week already final or whose every game is over, a week
 * the caller excludes (`excludeWeekIds`), or a lock time in the past called "locks…". A one-sport league prints no sport words (S1). A member who is not entered in a sport is never counted or named as
 * missing its picks. The week a Final game belongs to counts while it still has games to come ("Week 6 is under way — follow along in Game Day and the chat.").
 *
 * Pure: plain data in, plain data out. No imports, no storage, no clock (the caller passes `now`).
 */

const asArray = (v) => (Array.isArray(v) ? v : []);
const isStr = (v) => typeof v === 'string' && v !== '';
const toMs = (v) => { if (typeof v === 'number') return Number.isFinite(v) ? v : null; const ms = v ? Date.parse(v) : NaN; return Number.isFinite(ms) ? ms : null; };

/**
 * @param {object} input
 *   weeks          every week record (Draft and demo ones are filtered here)
 *   games          every game record
 *   statusOf(w)    the week's status as the app trusts it (the server-confirmed one); default `w.status`
 *   lockAtOf(w, games)   the week's effective lock instant (ms or ISO) — the app's computeEffectiveLockAt; default: picksLockAt, else the first kickoff
 *   sportOf(w)           the week's sport (R1: its competition's, never the week record's own field); null = a week no competition in scope holds (skipped). Default: the week's field, else 'cfb'
 *   enteredIn(sport, w)  is the viewer entered in that sport FOR THAT WEEK? (Lane A's entrants; a one-sport league: true)
 *   pickedAll(weekId)    has the viewer picked every game of that week (their OWN picks only)?
 *   labelOf(sport)       'CFB' / 'NFL' (the competition's label)
 *   viewerId, isCommissioner, now, excludeWeekIds
 */
export function nextOpportunity(input = {}) {
  const i = input && typeof input === 'object' ? input : {};
  const now = Number(i.now);
  const none = { kind: 'none', weekId: null, weekN: null, sport: null, sportLabel: '', entered: true, lockAt: null, firstKickoff: null, editable: false, live: false };
  if (!isStr(i.viewerId) || !Number.isFinite(now)) return none;
  const statusOf = typeof i.statusOf === 'function' ? i.statusOf : (w) => w.status;
  const enteredIn = typeof i.enteredIn === 'function' ? i.enteredIn : () => true;
  const sportOf = typeof i.sportOf === 'function' ? i.sportOf : (w) => (isStr(w.sport) ? w.sport : 'cfb');
  const pickedAll = typeof i.pickedAll === 'function' ? i.pickedAll : () => false;
  const labelOf = typeof i.labelOf === 'function' ? i.labelOf : (sp) => String(sp || '').toUpperCase();
  const exclude = new Set(asArray(i.excludeWeekIds).filter(isStr));
  const games = asArray(i.games);
  const lockAtOf = typeof i.lockAtOf === 'function' ? i.lockAtOf : (w, gs) => toMs(w.picksLockAt) ?? gs.reduce((m, g) => { const k = toMs(g.kickoff); return k !== null && (m === null || k < m) ? k : m; }, null);
  const cands = [];
  for (const w of asArray(i.weeks)) {
    if (!w || !isStr(w.weekId) || exclude.has(w.weekId)) continue;
    if (w.dataSourceMode === 'demo' && i.isCommissioner !== true) continue;
    let st = null;
    try { st = statusOf(w) || w.status; } catch { st = w.status; }
    if (!['open', 'locked', 'live'].includes(st)) continue;                 // draft = unpublished; final = done
    const wg = games.filter(g => g && g.weekId === w.weekId);
    if (!wg.length) continue;
    if (wg.every(g => g.status === 'final')) continue;                      // every game over: nothing left to come
    let sport = null;
    try { sport = sportOf(w); } catch { sport = null; }
    if (!isStr(sport)) continue;                                            // a week no competition in scope holds is not Home's to offer
    let lockAt = null;
    try { lockAt = toMs(lockAtOf(w, wg)); } catch { lockAt = null; }
    const first = wg.reduce((m, g) => { const k = toMs(g.kickoff); return k !== null && (m === null || k < m) ? k : m; }, null);
    let entered = true, done = false;
    try { entered = enteredIn(sport, w) !== false; } catch { entered = true; }
    try { done = entered && pickedAll(w.weekId) === true; } catch { done = false; }
    const lockAhead = lockAt !== null && lockAt > now;
    const editable = st === 'open' && lockAhead;
    const live = st === 'live' || (first !== null && first <= now);
    let kind;
    if (entered && editable && !done) kind = 'picks-due';
    else if (entered && done && (st === 'open' || st === 'locked') && !live) kind = 'picks-in';
    else kind = 'follow';
    cands.push({ kind, weekId: w.weekId, weekN: w.weekNumber ?? null, sport, sportLabel: labelOf(sport), entered, lockAt, firstKickoff: first, editable: kind === 'picks-in' ? editable : kind === 'picks-due', live, rank: { 'picks-due': 0, 'picks-in': 1, follow: 2 }[kind] });
  }
  if (!cands.length) return none;
  // the highest priority first; inside one, the soonest moment (the lock for picks-due, the first kickoff otherwise); a week id as the last tie-break (deterministic)
  const when = (c) => (c.kind === 'picks-due' ? c.lockAt : c.firstKickoff) ?? Infinity;
  cands.sort((a, b) => (a.rank - b.rank) || (when(a) - when(b)) || (a.weekId < b.weekId ? -1 : a.weekId > b.weekId ? 1 : 0));
  const { rank, ...best } = cands[0];
  void rank;
  return best;
}

const sp = (next, showSport) => (showSport && isStr(next.sportLabel) ? `${next.sportLabel} ` : '');
const at = (fmt, ms) => (fmt && typeof fmt.time === 'function' ? fmt.time(ms) : new Date(ms).toISOString());

/** The What's next sentence (DI-599 copy, exact where it gives one). `fmt.time(ms)` is the viewer's own "Sun 12:30 PM". */
export function nextLine(next, fmt, { showSport = false } = {}) {
  const n = next && typeof next === 'object' ? next : { kind: 'none' };
  const wk = `${sp(n, showSport)}Week ${n.weekN ?? ''}`.trim();
  switch (n.kind) {
    case 'picks-due': return `Next up: ${wk} — picks lock ${at(fmt, n.lockAt)}.`;
    case 'picks-in': return n.editable && n.lockAt !== null ? `You're in for ${wk}. Picks lock ${at(fmt, n.lockAt)}.` : `You're in for ${wk}. It kicks off ${at(fmt, n.firstKickoff)}.`;
    case 'follow': {
      const notIn = n.entered === false ? " You're not entered —" : '';
      if (n.live || n.firstKickoff === null) return notIn ? `${wk} is under way.${notIn} follow along in Game Day and the chat.` : `${wk} is under way — follow along in Game Day and the chat.`;
      return notIn ? `${wk} kicks off ${at(fmt, n.firstKickoff)}.${notIn} follow along in Game Day and the chat.` : `${wk} kicks off ${at(fmt, n.firstKickoff)} — follow along in Game Day and the chat.`;
    }
    default: return 'Nothing else is scheduled yet. When the commissioner publishes the next slate, it shows up here.';
  }
}

/** The Final card's compact form, after "You went 7–3 · ". '' when there is nothing to come. */
export function nextShort(next, fmt, { showSport = false } = {}) {
  const n = next && typeof next === 'object' ? next : { kind: 'none' };
  const wk = `${sp(n, showSport)}Week ${n.weekN ?? ''}`.trim();
  switch (n.kind) {
    case 'picks-due': return `Next: ${wk} picks lock ${at(fmt, n.lockAt)}`;
    case 'picks-in': return `Next: you're in for ${wk}`;
    case 'follow': return n.live || n.firstKickoff === null ? `Next: ${wk} is under way` : `Next: ${wk} kicks off ${at(fmt, n.firstKickoff)}`;
    default: return '';
  }
}

/** The What's next button (DI-599): "Make your {sport} picks" (primary), "Edit My Picks", "Open Game Day"; none for 'none' or a week that can no longer be edited. */
export function nextAction(next, { showSport = false } = {}) {
  const n = next && typeof next === 'object' ? next : { kind: 'none' };
  if (n.kind === 'picks-due') return { action: 'next-picks', label: `Make your ${showSport && isStr(n.sportLabel) ? `${n.sportLabel} ` : ''}picks`, tone: 'primary' };
  if (n.kind === 'picks-in' && n.editable) return { action: 'next-picks', label: 'Edit My Picks', tone: 'secondary' };
  if (n.kind === 'follow') return { action: 'open-gameday', label: 'Open Game Day', tone: 'secondary' };
  return null;
}
