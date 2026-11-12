/**
 * CFB Pickems - request-game.js (D2 lane 2, DI-923 / DI-924; UN-536 / PF-536; W-72, W-77)
 * =======================================================================================
 * Request a Game, beyond college football. A LEAF module: imports nothing, so the storage seam, the app and the Edge Functions can all import it.
 *
 *   sportKeyOfRecord(x)        the ESPN sport key a request row or a game belongs to: 'college-football' | 'nfl' | 'nhl', or NULL when this build does not know it.
 *                              A row or game with NO sport is college football BY DESIGN: the first request rows and every college game carry none ("v1 only ever writes
 *                              'college-football'"), so this is the one named place that default lives (the P-11 allow-list in unsupportedsporttest pins it).
 *   sportEventKey(x)           'nfl|401' - sport and event id TOGETHER, so an NHL event id that happens to equal a college id never collides; null for an unknown sport or no id.
 *   requestChips({...})        the date chips: college football the next four Saturdays ("This Sat", then "Sat Sep 26"), the NFL the next four Sundays, the NHL Today, Tomorrow
 *                              and the next five nights ("Fri Oct 23"). Driven by `profile.requestDays.kind`; an unknown kind is NO chips (never Saturdays).
 *   REQUEST_COPY               the copy this feature adds (the existing states keep their shipped strings in app.js, byte-identical).
 */

export const REQUEST_ESPN_KEYS = Object.freeze({ cfb: 'college-football', nfl: 'nfl', nhl: 'nhl' });
const KNOWN_ESPN_KEYS = Object.freeze(['college-football', 'nfl', 'nhl']);

/** A sport dbCode ('cfb' | 'nfl' | 'nhl') -> its ESPN key, or null. Strict: no default. */
export function requestEspnKey(dbCode) {
  return typeof dbCode === 'string' && Object.prototype.hasOwnProperty.call(REQUEST_ESPN_KEYS, dbCode.trim()) ? REQUEST_ESPN_KEYS[dbCode.trim()] : null;
}

/** The ESPN key of a request row or a game (its `espnSport`). Missing = college football (the legacy shape, named here once); a key this build does not know = null (never college football). */
export function sportKeyOfRecord(x) {
  const raw = x && typeof x === 'object' ? x.espnSport : undefined;
  if (raw === undefined || raw === null || raw === '') return 'college-football';   // the legacy default: rows and games written before a sport was stored
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (v === 'cfb') return 'college-football';
  return KNOWN_ESPN_KEYS.includes(v) ? v : null;
}

/** 'nfl|401' for a record with a known sport and an event id; null otherwise (an unknown sport matches nothing). */
export function sportEventKey(x) {
  const k = sportKeyOfRecord(x);
  const id = x && x.espnEventId != null ? String(x.espnEventId) : '';
  return k && id ? `${k}|${id}` : null;
}

// ── dates (UTC-noon arithmetic, so no DST boundary can move a day) ───────────────────────────────────────────────────
const KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n) => String(n).padStart(2, '0');
function parts(key) { const m = KEY.exec(String(key || '')); return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null; }
function atNoon(key) { const p = parts(key); return p ? Date.UTC(p.y, p.mo - 1, p.d, 12) : NaN; }
export function addDays(key, n) {
  const t = atNoon(key);
  if (Number.isNaN(t)) return '';
  const d = new Date(t + n * 86400000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 'Sat Sep 26' - the chip form (no comma). */
export function chipLabel(key) {
  const t = atNoon(key);
  if (Number.isNaN(t)) return 'Date TBD';
  const d = new Date(t);
  return `${WD[d.getUTCDay()]} ${MO[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
/** The next `n` days that fall on `weekday` (0 = Sunday), today counting. */
function nextWeekdays(weekday, n, fromKey) {
  const t = atNoon(fromKey);
  if (Number.isNaN(t)) return [];
  const delta = (weekday - new Date(t).getUTCDay() + 7) % 7;
  return Array.from({ length: n }, (_, i) => addDays(fromKey, delta + i * 7));
}

/**
 * The chips a sport's Request a Game card offers. `todayKey` is the date the first chip counts from ('YYYY-MM-DD'; the caller passes the device's Central date for football and the US Eastern
 * date for hockey, whose "night" is ESPN's Eastern date). Returns [{ date, label }].
 */
export function requestChips({ profile = null, todayKey = '' } = {}) {
  const kind = profile && profile.requestDays && profile.requestDays.kind;
  if (!parts(todayKey)) return [];
  if (kind === 'saturdays') return nextWeekdays(6, 4, todayKey).map((date, i) => ({ date, label: i === 0 ? 'This Sat' : chipLabel(date) }));
  if (kind === 'sundays') return nextWeekdays(0, 4, todayKey).map((date, i) => ({ date, label: i === 0 ? 'This Sun' : chipLabel(date) }));
  if (kind === 'nights') return Array.from({ length: 7 }, (_, i) => { const date = addDays(todayKey, i); return { date, label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : chipLabel(date) }; });
  return [];
}

export const REQUEST_COPY = Object.freeze({
  unrecognized: 'Unrecognized sport',
  unrecognizedNote: "This request is for a sport this version of Munera doesn't know.",
  unsupportedSearch: "This sport isn't available in this version of Munera. Update the app to search it.",
  sportLabel: 'Sport',
});
