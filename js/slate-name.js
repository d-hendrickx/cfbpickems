/**
 * CFB Pickems - slate-name.js (D2 lane 2, DI-886 / DI-927 rows 5, 6 and 10; the review's item 7)
 * ==============================================================================================
 * THE ONE PLACE a screen names a slate and its start. A football week is "Week 6"; an NHL game night is its label ("Thu, Oct 22"), never "Week n". A leaf: it imports only the sport registry's copy helper.
 *
 *   slateName(src)            a WEEK object { weekNumber, slateLabel } or a FACTS object { weekN, slate } -> "Thu, Oct 22" when it carries a slate label, else "Week 6"; '' when it carries neither.
 *   slateFact(week)           `{ slate: 'Thu, Oct 22' }` for a week with a slate label, `{}` for every football week: spread it into a facts object beside `weekN` (football facts stay byte-identical).
 *   startWord(profileOrKey)   the sport's word for the start of a game: "Kickoff" (football), "Puck drop" (the NHL). `startVerb` is its sentence form: "kicks off" / "drops the puck".
 *   startWordOfWeek(week, sport) / startVerbOfWeek(week, sport)   the same for a WEEK: a night slate (it carries a label) reads as the night sport even when the week stores no sport (W-174).
 *   setupLabel(src, sport)    "Set up Week 6" for football, "Set up the next slate" for a night sport (whose next night has no number). `sport` is a registry key ('nhl') or a display code ('NHL').
 *   nextSlateName(n, sport)   "Week 7" for football, "the next slate" for a night sport.
 *
 * Lane 3's home.js calls these after the merge (import { slateName, slateFact, startWord } from './slate-name.js').
 */
import { sportCopy, getProfile, listProfiles } from './sports/index.js';

const num = (v) => { const n = Number(v); return v !== null && v !== undefined && v !== '' && Number.isFinite(n) ? n : null; };
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');
/** The longest a night's label may be (createWeek cuts it to 24 at the client; `weeks.extra` is JSON a commissioner can write directly, so every consumer cuts it again, here, before it reaches a push or a post). */
export const SLATE_LABEL_MAX = 24;
const label = (v) => text(v).slice(0, SLATE_LABEL_MAX).trim();

export function slateName(src) {
  if (!src || typeof src !== 'object') return '';
  const name = label(src.slateLabel) || label(src.slate);
  if (name) return name;
  const n = num(src.weekNumber !== undefined ? src.weekNumber : src.weekN);
  return n === null ? '' : `Week ${n}`;
}

export function slateFact(week) {
  const name = week && typeof week === 'object' ? label(week.slateLabel) : '';
  return name ? { slate: name } : {};
}

function profileOf(p) {
  if (p && typeof p === 'object') return p;
  if (typeof p === 'string' && p) {
    try { return getProfile(p); } catch { /* not a registry key: it may be a display code ('NHL') */ }
    try { return listProfiles().find((x) => x && x.code === p) || null; } catch { return null; }
  }
  return null;
}
export function startWord(p) { return sportCopy(profileOf(p)).start; }
export function startVerb(p) { return startWord(p) === 'Kickoff' ? 'kicks off' : 'drops the puck'; }

/**
 * D2 sweep, W-174 (the integrator's bug, int/v0.31.0 batch 3): the start word of a WEEK, not of a sport key. Home finds a week's sport through `sportOfWeek()`, which answers football's 'cfb' for a
 * week that stores no sport, so a one-sport NHL league with no competition rows read "Kickoff in 20 min." A NIGHT SLATE carries a label (weeks.slate_label) and a football week never does, so the
 * label is what says "this is a night": a labelled week reads as the first registered night sport (the NHL) whatever sport key came with it, and every other week reads as `sport`, exactly as
 * startWord(sport) always did (football byte-identical).
 */
function nightProfile() {
  try { return listProfiles().find((x) => x && x.slate && x.slate.unit === 'night') || null; } catch { return null; }
}
function weekProfile(week, sport) {
  const pr = profileOf(sport);
  if (pr && pr.slate && pr.slate.unit === 'night') return pr;
  if (week && typeof week === 'object' && label(week.slateLabel)) return nightProfile() || pr;
  return pr;
}
export function startWordOfWeek(week, sport) { return startWord(weekProfile(week, sport)); }
export function startVerbOfWeek(week, sport) { return startVerb(weekProfile(week, sport)); }

export function setupLabel(src, sport) {
  const pr = profileOf(sport);
  if (pr && pr.slate && pr.slate.unit === 'night') return 'Set up the next slate';
  const name = slateName(src);
  return `Set up ${name || 'Week 1'}`;
}

/** What a screen calls the slate that is not published yet: "Week 7" for football, "the next slate" for a night sport (whose next night has no number). */
export function nextSlateName(nextWeekNumber, sport) {
  const pr = profileOf(sport);
  if (pr && pr.slate && pr.slate.unit === 'night') return 'the next slate';
  const n = num(nextWeekNumber);
  return `Week ${n === null ? 1 : n}`;
}
