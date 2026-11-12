/**
 * CFB Pickems - night-slate.js (D2 lane 2, DI-886 / DI-887 / DI-909; UN-513 / PF-513; RPF-C3, Drew D-113/D-114: "one slate per game night, labelled by date, one open at a time, a light night may add
 * the next night, a heavy night suggests six; lock 30 minutes before the first puck; the tiebreaker is the total goals in the slate's last game")
 * ===========================================================================================================================================================================================
 * The PURE half of building a slate for a sport whose `profile.slate.unit` is 'night' (the NHL). It imports only js/data-model.js (the date label), reads no storage, no DOM and no clock (the caller hands in "now" and the
 * time formatter, CONVENTIONS #19: every time shown is in the viewer's zone), so a Node suite proves every rule and the wizard wiring in app.js stays thin.
 *
 *   isNightSport(profile)                       true when the profile's slate is a game night
 *   nightLabel('2026-10-22')                    "Thu, Oct 22": the default slate label (the weekday and date of ESPN's US Eastern date)
 *   etDateOf(isoOrMs)                           'YYYY-MM-DD' US Eastern date of an instant (a "night" is ESPN's Eastern date)
 *   nightChips({ nowMs, counts })               Today, Tomorrow, then the next five nights (each `{ key, date, label, count }`); counts ARE ESPN's, once a night has been fetched
 *   nightsState(chips)                          out-of-season rule: no chip in the next 14 days has a game -> 'out_of_season'
 *   nightDecision({ games, nights, profile })   { kind: 'light'|'ok'|'heavy'|'empty', count, ... } and what the commissioner is offered (RPF-C3)
 *   rankNightCandidates({ games, profile, favoriteTeams })  national TV first, then a team a member named, then the earliest puck drop; { slate, shortlist }
 *   tiebreakerChoice(games)                     the slate's latest puck drop; several share it -> the choices, a note, and a deterministic default (lowest game id)
 *   lockLine({ firstKickoffMs, offsetMinutes, nowMs, formatTime })   the lock sentence and the "players need time" warning
 *   openBlock({ weeks, week, profile, competitionId, weekCompetitionOf })   one slate is pickable at a time (oneOpenAtATime): the refusal sentence, or null
 *   slateWindow({ date, extraDate })            a light-night slate: start and end dates (one slate, two nights)
 */

import { nightLabel } from './data-model.js';

const MS_H = 3600000;

export function isNightSport(profile) {
  return !!(profile && profile.slate && profile.slate.unit === 'night');
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date 'YYYY-MM-DD' (rejects 2026-02-30). Returns { y, m, d } or null. */
function parseDate(s) {
  const m = typeof s === 'string' ? DATE_RE.exec(s) : null;
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d, 12));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? { y, m: mo, d } : null;
}

/** "Thu, Oct 22" (js/data-model.js owns it so the week-label functions can name a slate by it). */
export { nightLabel };

/** The US Eastern calendar date 'YYYY-MM-DD' of an instant (ISO string or epoch ms), or null. */
export function etDateOf(v) {
  const ms = typeof v === 'number' ? v : Date.parse(v);
  if (!Number.isFinite(ms)) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms));
    const g = (t) => parts.find((p) => p.type === t)?.value;
    return g('year') && g('month') && g('day') ? `${g('year')}-${g('month')}-${g('day')}` : null;
  } catch { return null; }
}

/** The NHL season a night belongs to, as the start-year string week.season keeps ("2026" for a night in October 2026 or January 2027): months July to December are that year, January to June the year before. */
export function seasonOfNight(date) {
  const p = parseDate(date);
  return p ? String(p.m >= 7 ? p.y : p.y - 1) : '';
}

/** The calendar date `n` days after `date` ('YYYY-MM-DD'), or null. */
export function addDays(date, n) {
  const p = parseDate(date);
  if (!p) return null;
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d, 12) + Number(n) * 24 * MS_H);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/**
 * The chips of "Which night?": Today, Tomorrow, then the next five nights ("Fri, Oct 23"), seven in all. `counts` maps a date to ESPN's game count for it once fetched (undefined = not fetched yet:
 * no count is shown, never a guess). A chip's key is its date.
 */
export function nightChips({ nowMs = Date.now(), counts = {} } = {}) {
  const today = etDateOf(nowMs);
  if (!today) return [];
  const out = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(today, i);
    out.push({ key: date, date, label: i === 0 ? 'Today' : (i === 1 ? 'Tomorrow' : nightLabel(date)), count: Object.prototype.hasOwnProperty.call(counts, date) && Number.isFinite(counts[date]) ? counts[date] : null });
  }
  return out;
}

/** The practical out-of-season rule (ESPN's season window runs to July, so it cannot tell us): every fetched chip in the next 14 days has zero games -> 'out_of_season'; otherwise 'ok'. */
export function nightsState(counts) {
  const vals = Object.values(counts && typeof counts === 'object' ? counts : {}).filter((n) => Number.isFinite(n));
  return vals.length >= 7 && vals.every((n) => n === 0) ? 'out_of_season' : 'ok';
}

export const NIGHT_COPY = Object.freeze({
  title: 'Which night?',
  helper: 'Munera shows the NHL games on the date you pick.',
  loading: 'Checking ESPN for that night…',
  error: "Couldn't reach ESPN just now. Tap a night to try again.",
  empty: "No NHL games found for that night. ESPN may not have published the schedule yet, or couldn't be reached — try again, or try a night closer to game time.",
  outOfSeason: 'No NHL games in the next two weeks. The regular season runs October to April.',
  lightTitle: (n, label) => `Only ${n} ${n === 1 ? 'game is' : 'games are'} scheduled on ${label}.`,
  lightHelper: 'A slate usually has 4 to 8. You can add the next night or keep these.',
  addNight: (label) => `Add ${label}`,
  keepThese: (n) => `Keep these ${n}`,
  heavyHelper: (lo, hi) => `Pick ${lo} to ${hi}`,
  noSideContest: '',
  checklistNoLines: 'Pick the winner. No lines needed.',
  tiebreakerTogether: 'Two games start together. Pick which one decides ties.',
  openBlocked: (openLabel, nextLabel) => `${openLabel} is still open. Lock it first, or wait until it locks${nextLabel ? `, then open ${nextLabel}` : ''}.`,
  lockShort: (n) => `This slate would lock in ${n} minutes. Players need time to pick.`,
});

/**
 * What the commissioner is offered for the games found on a night (RPF-C3). Football is unchanged: this is only called for a night sport.
 *   empty  no games
 *   light  fewer than `minSize` and the night has not already been extended (`nights < maxNights`): offer "Add <next night>" and "Keep these n" (never padded)
 *   ok     minSize to maxSize, or a light night that has been extended or kept
 *   heavy  more than maxSize: show ALL of them with the suggested `size` ticked and "Pick 4 to 8" (never cut without telling)
 */
export function nightDecision({ games = [], nights = 1, profile = null, keepLight = false } = {}) {
  const s = (profile && profile.slate) || {};
  const min = Number.isFinite(s.minSize) ? s.minSize : 4, max = Number.isFinite(s.maxSize) ? s.maxSize : 8, size = Number.isFinite(s.size) ? s.size : 6, maxNights = Number.isFinite(s.maxNights) ? s.maxNights : 2;
  const count = Array.isArray(games) ? games.length : 0;
  if (count === 0) return { kind: 'empty', count, min, max, size };
  if (count < min) {
    const canAddNight = nights < maxNights;
    return { kind: canAddNight && !keepLight ? 'light' : 'ok', count, min, max, size, canAddNight, light: true };
  }
  if (count > max) return { kind: 'heavy', count, min, max, size, suggested: size };
  return { kind: 'ok', count, min, max, size };
}

/**
 * The suggested slate for a night (DI-887 step 2): `slate.rank` for a sport with no anchor days. National TV games first (the shipped `nationalTV` signal), then games that involve a team a
 * member named as a favourite (self-reported, when present and consented: `favoriteTeams` is a list of team names, empty when none), then the earliest puck drop; the first `size` become the
 * suggested slate, the rest the shortlist (up to `candidateSize`). Games with no usable start are left out. Deterministic: ties break on game id (`gameId`, else `espnEventId`).
 */
export function rankNightCandidates({ games = [], profile = null, favoriteTeams = [] } = {}) {
  const s = (profile && profile.slate) || {};
  const size = Number.isFinite(s.size) ? s.size : 6, cand = Number.isFinite(s.candidateSize) ? s.candidateSize : 16;
  const fav = new Set((Array.isArray(favoriteTeams) ? favoriteTeams : []).filter((t) => typeof t === 'string'));
  const t = (g) => { const n = Date.parse(g && g.kickoff); return Number.isFinite(n) ? n : Infinity; };
  const idOf = (g) => String((g && (g.gameId || g.espnEventId)) || '');
  const rank = (g) => (g.nationalTV ? 0 : 1) * 2 + ((fav.has(g.homeTeam) || fav.has(g.awayTeam)) ? 0 : 1);
  const dated = (Array.isArray(games) ? games : []).filter((g) => g && Number.isFinite(t(g)));
  const ordered = [...dated].sort((a, b) => rank(a) - rank(b) || t(a) - t(b) || (idOf(a) < idOf(b) ? -1 : idOf(a) > idOf(b) ? 1 : 0));
  const slate = ordered.slice(0, size);
  const taken = new Set(slate);
  const shortlist = ordered.filter((g) => !taken.has(g)).slice(0, Math.max(0, cand - slate.length));
  return { slate, shortlist, almaCount: 0, morningAnchorFilled: false, closingAnchorFilled: false };
}

/**
 * The tiebreaker game of a slate (RPF-C3 / DI-887 step 3): the LATEST puck drop. If several games share it, `together` is true, `choices` lists them, and the default is the lowest game id
 * (deterministic). Games with no start are ignored. `null` when none has one.
 */
export function tiebreakerChoice(games, { nameOf = (g) => `${g.awayTeam} at ${g.homeTeam}` } = {}) {
  const list = (Array.isArray(games) ? games : []).filter((g) => g && g.gameId && Number.isFinite(Date.parse(g.kickoff)));
  if (!list.length) return null;
  const latest = Math.max(...list.map((g) => Date.parse(g.kickoff)));
  const tied = list.filter((g) => Date.parse(g.kickoff) === latest).sort((a, b) => (a.gameId < b.gameId ? -1 : a.gameId > b.gameId ? 1 : 0));
  return { defaultGameId: tied[0].gameId, together: tied.length > 1, choices: tied.map((g) => ({ gameId: g.gameId, label: nameOf(g) })), note: tied.length > 1 ? NIGHT_COPY.tiebreakerTogether : '' };
}

/**
 * The lock sentence of step 3: "Locks Thu, Oct 22 at 6:30 PM, 30 minutes before the first puck drop." `formatTime(ms)` is the caller's viewer-zone formatter. `short` is the "players need time" line when the
 * lock instant is past or under 10 minutes away (Open stays allowed). null firstKickoff (TBD) -> no lock yet.
 */
export function lockLine({ firstKickoffMs = null, offsetMinutes = 30, nowMs = Date.now(), formatTime = (ms) => new Date(ms).toISOString(), startWord = 'puck drop' } = {}) {
  if (!Number.isFinite(firstKickoffMs)) return { text: 'Timing not configured', short: '', lockMs: null };
  const off = Number.isFinite(offsetMinutes) && offsetMinutes >= 0 ? Math.round(offsetMinutes) : 30;
  const lockMs = firstKickoffMs - off * 60000;
  const mins = Math.floor((lockMs - nowMs) / 60000);
  return { text: `Locks ${formatTime(lockMs)}, ${off} minutes before the first ${startWord}.`, short: mins < 10 ? NIGHT_COPY.lockShort(Math.max(0, mins)) : '', lockMs };
}

/**
 * ONE SLATE IS PICKABLE AT A TIME per sport (profile.slate.oneOpenAtATime): opening a second slate while another of the SAME competition is Open is refused with a sentence naming it. Locked, live
 * and final slates do not block (they stay on the Dashboard). Returns the sentence or null. `weekCompetitionOf(w)` resolves a week's competition id (R1); football (no oneOpenAtATime) never blocks.
 */
export function openBlock({ weeks = [], week = null, profile = null, weekCompetitionOf = (w) => (w && w.competitionId) || null, labelOf = (w) => (w && (w.slateLabel || nightLabel(w.startDate))) || '' } = {}) {
  if (!profile || !profile.slate || profile.slate.oneOpenAtATime !== true || !week) return null;
  const comp = weekCompetitionOf(week);
  const other = (Array.isArray(weeks) ? weeks : []).find((w) => w && w.weekId !== week.weekId && w.status === 'open' && weekCompetitionOf(w) === comp);
  if (!other) return null;
  const next = labelOf(week);
  return NIGHT_COPY.openBlocked(labelOf(other), next && next !== labelOf(other) ? next : '');
}

/** A slate's start and end dates: one night, or (a light night extended) two consecutive nights: `endDate` is the later night. */
export function slateWindow({ date, extraDate = null } = {}) {
  const a = parseDate(date) ? date : '';
  const b = extraDate && parseDate(extraDate) ? extraDate : '';
  if (!a) return { startDate: '', endDate: '' };
  if (!b || b === a) return { startDate: a, endDate: a };
  return b > a ? { startDate: a, endDate: b } : { startDate: b, endDate: a };
}
