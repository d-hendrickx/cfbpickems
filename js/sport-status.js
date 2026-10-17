/**
 * CFB Pickems — sport-status.js (D1 / v0.30.0, DI-522 + DI-237's pure module, DI-554)
 *
 * ONE derivation of "what is this sport's week doing, and what does the viewer owe it", read by every surface that says so: the league overview sheet's sport cards, the League Page's
 * cards (the same function), the header pill's due dot, the sport switcher's due dots and the overview's At-a-glance chips. CONVENTIONS #21: one source, so the surfaces cannot disagree.
 *
 * A PURE LEAF. It imports NOTHING (a static scan in sportstatustest proves it, with a canary), reads no storage, touches no DOM and no clock but the one it is handed. That is also the
 * blind-rule guarantee: its inputs admit the viewer's OWN submitted boolean and counts of games, never another member's data, so a leak cannot be added here by accident.
 *
 *   formatTimeLeft(ms)                                  '2d 4h' | '3h 12m' | '8m' | ''   (the one implementation; app.js's timeUntil() delegates to it)
 *   formatGameWindow(firstMs, lastMs, ianaZone)         'Sat Oct 10' | 'Sun Oct 11 – Mon Oct 12' | ''   (built only from posted games; no games means '', never a guessed date)
 *   deriveSportCardStatus(inputs)                       the card's state machine (DI-522's table), never throws
 *   sportCardView(status, text)                         the card as DATA: pills, the lock/state line, the Games line, the tap target, the VoiceOver sentence
 *   joinCardView(status, text)                          the "Also in this league" card for a sport the viewer has not joined (DI-554), with the Join button's state and caption
 *   sportsNeedingPicks(items, now)                      played sports with picks due and a lock still ahead, earliest lock first
 *   glanceChips({ due, liveCount })                     the At-a-glance chips (0 to 2)
 */

export const SPORT_STATES = Object.freeze(['none', 'upcoming', 'draft', 'open', 'locked', 'live', 'final', 'error']);

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const countOr0 = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; };
const gamesWord = (n) => `${n} ${n === 1 ? 'game' : 'games'}`;

/** '2d 4h' | '3h 12m' | '8m' | '' once the time has passed. The same arithmetic app.js's timeUntil() always had (sportstatustest pins it against a frozen table). */
export function formatTimeLeft(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '';
  const mins = Math.floor(n / 60000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/**
 * The days a sport's games are played, in the viewer's zone: one local day reads `Sat Oct 10`; days apart read `Sun Oct 11 – Mon Oct 12` (an en dash). Built ONLY from the kickoffs
 * of posted games: no first kickoff means '' (no row at all), never a guessed date. `ianaZone` is an IANA name; an unusable one reads as ''.
 */
export function formatGameWindow(firstMs, lastMs, ianaZone) {
  const first = finite(firstMs);
  if (first === null) return '';
  const lastRaw = finite(lastMs);
  const last = lastRaw !== null && lastRaw >= first ? lastRaw : first;
  const parts = (ms) => {
    try {
      const f = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: ianaZone || undefined });
      const o = {};
      for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
      return o.weekday && o.month && o.day && o.year ? o : null;
    } catch { return null; }
  };
  const a = parts(first);
  const b = parts(last);
  if (!a || !b) return '';
  const label = (p) => `${p.weekday} ${p.month} ${p.day}`;
  const sameDay = a.year === b.year && a.month === b.month && a.day === b.day;
  return sameDay ? label(a) : `${label(a)} – ${label(b)}`;
}

/**
 * The state machine (DI-522's table). Inputs are plain facts the caller read from the mirror; every field is optional and a missing one reads as the cautious answer.
 *
 *   hasWeek            the competition has a current week at all
 *   phase              the ONE week-lock phase (week-lock.js weekLockState): 'draft' | 'open' | 'locked' | 'live' | 'final' (a derived lock already reads 'locked')
 *   isCommissioner     sees a draft week as `Draft · N games`; a member sees `Upcoming`
 *   totalGames, liveGames, finalGames, lockAtMs, firstKickoffMs, lastKickoffMs
 *   submitted          the viewer's OWN boolean (the blind rule: nothing about anyone else)
 *   canSubmit          false when the viewer may not submit (a demo week, a non-entrant), which shows no due pill
 *   reopened           the commissioner re-opened a locked week (a visible exception, DI-511)
 *   nextWeekPublished  true | false | null (null = unknown, say nothing)
 *   failed             true when the caller could not read its inputs (its own try/catch): the state is 'error' and the card says "Status unavailable"
 *
 * Returns { state, totalGames, liveGames, finalGames, lockAtMs, firstKickoffMs, lastKickoffMs, submit, reopened, nextWeekPublished, enterTab }. `submit` is 'due' | 'submitted' | 'not_submitted' | null.
 * `enterTab` is where a tap on the card goes: Picks when picks are due, or the week is open and the viewer cannot yet see anything better (DI-554); the Dashboard otherwise.
 */
export function deriveSportCardStatus(input = {}) {
  const i = input && typeof input === 'object' ? input : {};
  try {
    if (i.failed === true) throw new Error('inputs could not be read');   // the caller's own try/catch around its storage reads: "Status unavailable", never a guess
    const out = {
      state: 'none', totalGames: 0, liveGames: 0, finalGames: 0, lockAtMs: null, firstKickoffMs: null, lastKickoffMs: null,
      submit: null, reopened: false, nextWeekPublished: typeof i.nextWeekPublished === 'boolean' ? i.nextWeekPublished : null, enterTab: 'picks',
    };
    if (!i.hasWeek) return out;
    out.totalGames = countOr0(i.totalGames);
    out.liveGames = countOr0(i.liveGames);
    out.finalGames = countOr0(i.finalGames);
    out.lockAtMs = finite(i.lockAtMs);
    out.firstKickoffMs = finite(i.firstKickoffMs);
    out.lastKickoffMs = finite(i.lastKickoffMs);
    const submitted = i.submitted === true;
    const canSubmit = i.canSubmit !== false;
    switch (i.phase) {
      case 'draft':
        out.state = i.isCommissioner === true ? 'draft' : 'upcoming';
        out.enterTab = 'picks';
        return out;
      case 'open':
        out.state = 'open';
        out.reopened = i.reopened === true;
        out.submit = canSubmit ? (submitted ? 'submitted' : 'due') : null;
        out.enterTab = out.submit === 'due' ? 'picks' : 'dashboard';
        return out;
      case 'locked':
        out.state = 'locked';
        out.submit = submitted ? 'submitted' : 'not_submitted';
        out.enterTab = 'dashboard';
        return out;
      case 'live':
        out.state = 'live';
        out.submit = submitted ? 'submitted' : 'not_submitted';
        out.enterTab = 'dashboard';
        return out;
      case 'final':
        out.state = 'final';
        out.enterTab = 'dashboard';
        return out;
      default:
        return { ...out, state: 'error' };
    }
  } catch {
    return { state: 'error', totalGames: 0, liveGames: 0, finalGames: 0, lockAtMs: null, firstKickoffMs: null, lastKickoffMs: null, submit: null, reopened: false, nextWeekPublished: null, enterTab: 'dashboard' };
  }
}

/**
 * The card as data. `text` carries the strings only the caller can produce (they depend on the viewer's zone and the profile): sportName, code, weekLabel, windowText, leftText, lockWhenText,
 * kickoffWhenText, inCountText ('4 of 6 in', counts only, or ''), isCommissioner, canSetupWeek, nextWeekN.
 *
 * Pill tones are the badge vocabulary the app already has: 'open' 'locked' 'live' 'final' 'draft' (the status), 'due' (gold), 'ok' (submitted), 'nd' (neutral).
 * @returns {{ state, pills: {tone:string,text:string,dot?:boolean}[], line: string, windowLine: string, enterTab: string, setup: string|null, ariaLabel: string }}
 */
export function sportCardView(status, text = {}) {
  const s = status && typeof status === 'object' ? status : { state: 'error' };
  const t = text && typeof text === 'object' ? text : {};
  const name = String(t.sportName || t.code || 'Sport');
  const weekLabel = String(t.weekLabel || '');
  const left = String(t.leftText || '');
  const lockWhen = String(t.lockWhenText || '');
  const inCount = String(t.inCountText || '');
  const windowText = String(t.windowText || '');
  const n = countOr0(s.totalGames);
  const pills = [];
  let line = '';
  let showWindow = true;
  let setup = null;
  const submitPill = () => {
    if (s.submit === 'submitted') pills.push({ tone: 'ok', text: 'Submitted', check: true });
    else if (s.submit === 'not_submitted') pills.push({ tone: 'nd', text: 'Not submitted' });
  };
  switch (s.state) {
    case 'none':
      pills.push({ tone: 'draft', text: 'No week yet' });
      showWindow = false;
      if (t.canSetupWeek) { line = 'Set up the first week to open picks'; setup = `Set up Week ${t.nextWeekN || 1}`; }
      else line = t.isCommissioner ? 'Set up the first week to open picks' : "Picks aren't open yet";
      break;
    case 'upcoming':
      pills.push({ tone: 'draft', text: 'Upcoming' });
      line = "Picks aren't open yet";
      showWindow = false;
      break;
    case 'draft':
      pills.push({ tone: 'draft', text: `Draft · ${gamesWord(n)}` });
      line = 'Not published yet';
      break;
    case 'open': {
      pills.push({ tone: 'open', text: n ? `Open · ${gamesWord(n)}` : 'Open' });
      if (s.submit === 'due') pills.push({ tone: 'due', text: left ? `Picks due in ${left}` : 'Picks due' });
      else if (s.submit === 'submitted') pills.push({ tone: 'ok', text: 'Submitted', check: true });
      if (!n) { line = 'No games on the slate yet'; showWindow = false; }
      else if (lockWhen) line = `${s.reopened ? 'Re-opened · locks' : 'Locks'} ${lockWhen}`;
      else line = s.reopened ? 'Re-opened' : '';
      if (n && inCount && line) line += ` · ${inCount}`;
      break;
    }
    case 'locked':
      pills.push({ tone: 'locked', text: 'Locked' });
      submitPill();
      line = t.kickoffWhenText ? `Kicks off ${t.kickoffWhenText}` : '';
      if (line && inCount) line += ` · ${inCount}`;
      else if (!line && inCount) line = inCount;
      break;
    case 'live':
      pills.push({ tone: 'live', text: 'Live', dot: true });
      submitPill();
      line = `${countOr0(s.liveGames)} live · ${countOr0(s.finalGames)} of ${n} final`;
      break;
    case 'final':
      pills.push({ tone: 'final', text: 'Final' });
      line = s.nextWeekPublished === false ? "All games final · Next week isn't published yet" : 'All games final';
      showWindow = false;
      break;
    default:
      line = 'Status unavailable';
      showWindow = false;
  }
  const windowLine = showWindow && windowText ? `Games ${windowText}` : '';
  const opens = s.enterTab === 'picks' ? 'Picks' : 'the Dashboard';
  const bits = [name + (weekLabel ? `, ${weekLabel}` : ''), ...pills.map((p) => p.text), line, windowLine ? windowLine.replace(/^Games /, 'games ') : ''].filter(Boolean);
  return {
    state: s.state, pills, line, windowLine, enterTab: s.enterTab === 'dashboard' ? 'dashboard' : 'picks', setup,
    ariaLabel: `${bits.join(', ')}. Opens ${opens}. Double tap to open.`,
  };
}

/** The sentence a closed Join says in the league overview and on Home's join nudge (DESIGN_D1_E, DI-E1.7: ONE string, so the two cannot drift). */
export function joinClosedCaption(code) {
  return `You can join when the next ${String(code || 'this sport')} week opens.`;
}

/**
 * The "Also in this league" card for a sport the viewer has NOT joined (DI-554's table). Nothing here is gold, nothing says late or missing, and the card is never a button into the sport:
 * its Join is a button of its own. `status` is the same deriveSportCardStatus() output (derived with submit/canSubmit ignored: a non-entrant owes nothing).
 * @returns {{ state, pills, line, windowLine, joinEnabled: boolean, caption: string, body: string, ariaLabel: string }}
 */
export function joinCardView(status, text = {}) {
  const s = status && typeof status === 'object' ? status : { state: 'error' };
  const t = text && typeof text === 'object' ? text : {};
  const code = String(t.code || t.sportName || 'this sport');
  const windowText = String(t.windowText || '');
  const n = countOr0(s.totalGames);
  const pills = [{ tone: 'nd', text: 'Optional' }];
  let line = '';
  let joinEnabled = false;
  let showWindow = true;
  switch (s.state) {
    case 'open':
      pills.push({ tone: 'open', text: n ? `Open · ${gamesWord(n)}` : 'Open' });
      line = t.lockWhenText ? `Picks lock ${t.lockWhenText}` : '';
      joinEnabled = true;
      if (!n) showWindow = false;
      break;
    case 'locked':
      pills.push({ tone: 'locked', text: 'Locked' });
      break;
    case 'live':
      pills.push({ tone: 'live', text: `Live · ${gamesWord(countOr0(s.liveGames) || n)}`, dot: true });
      break;
    case 'final':
      pills.push({ tone: 'final', text: 'Final' });
      break;
    case 'none': case 'upcoming': case 'draft':
      pills.push({ tone: 'draft', text: 'No week yet' });
      line = `Picks open when the commissioner publishes Week ${t.nextWeekN || 1}.`;
      joinEnabled = true;
      showWindow = false;
      break;
    default:
      line = 'Status unavailable';
      showWindow = false;
  }
  const windowLine = showWindow && windowText ? `Games ${windowText}` : '';
  if (!line && windowLine && (s.state === 'locked' || s.state === 'live' || s.state === 'final')) { line = windowLine; }
  const caption = joinEnabled ? '' : joinClosedCaption(code);
  const body = `${code} picks are optional in this league. Join to make weekly picks and appear in ${code} standings. Nothing counts against you if you don't.`;
  const bits = [String(t.sportName || code) + (t.weekLabel ? `, ${t.weekLabel}` : ''), ...pills.map((p) => p.text), line, joinEnabled ? 'You can join.' : caption].filter(Boolean);
  return { state: s.state, pills, line, windowLine: windowLine && windowLine !== line ? windowLine : '', joinEnabled, caption, body, ariaLabel: `${bits.join(', ')}` };
}

/**
 * Played sports whose picks are due and whose lock is still ahead, earliest lock first. `items` is `[{ dbCode, code, status }]` (status from deriveSportCardStatus). A sport the viewer
 * has not joined is never in `items` (the caller passes played sports only), so a non-entrant is never shown a due pill, a dot or a chip (DI-555).
 * @returns {{ dbCode: string, code: string, lockAtMs: number, left: string }[]}
 */
export function sportsNeedingPicks(items, now = 0) {
  const nowMs = Number.isFinite(Number(now)) ? Number(now) : 0;
  const out = [];
  for (const it of Array.isArray(items) ? items : []) {
    const s = it && it.status;
    if (!s || s.state !== 'open' || s.submit !== 'due' || !Number.isFinite(s.lockAtMs) || s.lockAtMs <= nowMs) continue;
    out.push({ dbCode: String(it.dbCode), code: String(it.code || it.dbCode), lockAtMs: s.lockAtMs, left: formatTimeLeft(s.lockAtMs - nowMs) });
  }
  return out.sort((a, b) => a.lockAtMs - b.lockAtMs || a.dbCode.localeCompare(b.dbCode));
}

/**
 * The At-a-glance chips: ONE per sport whose picks are due (D-60 mockup, 2026-10-08: it used to be the next deadline only), earliest lock first, then one for the live count. `due` is
 * sportsNeedingPicks()'s output; `liveCount` is the number of live games across the league's published weeks (a number, never a pick). A chip never shows a number that is not a fact: a zero
 * or unknown live count makes no chip, and a junk entry in `due` makes none.
 * @returns {{ kind: 'due'|'live', text: string, dbCode?: string, tab?: string }[]}
 */
export function glanceChips({ due = [], liveCount = 0 } = {}) {
  const chips = [];
  for (const d of Array.isArray(due) ? due : []) {
    if (!d || typeof d !== 'object' || !(d.code || d.dbCode)) continue;
    chips.push({ kind: 'due', dbCode: d.dbCode, tab: 'picks', text: `Picks due · ${d.code || d.dbCode}${d.left ? ` · in ${d.left}` : ''}` });
  }
  const live = countOr0(liveCount);
  if (live > 0) chips.push({ kind: 'live', text: `${live} live now` });
  return chips;
}
