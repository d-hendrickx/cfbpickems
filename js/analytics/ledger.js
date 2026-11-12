/**
 * CFB Pickems - js/analytics/ledger.js (D2 lane 4 batch 2; DI-1061, 1062, 1085; "the no-repeat ledger, client side"; UN/PF-543, UN/PF-526; 2026-10-21)
 * ======================================================================================================================================================
 * The device's memory of which insight facts it has already SHOWN, so a card is not re-emitted until something changed. The server-side twin (`scribe_said`, migration 0073) is lane 5's and records
 * what SCRIBE SAID in a room; this file is the same rule, applied to cards, over a ledger the caller keeps (the app persists it as a per-player preference; THIS FILE HAS NO STORAGE: pure,
 * no clock, no randomness; `now` and the ledger are parameters, the answer a new array).
 *
 * THE RULE IN ONE SENTENCE (DI-1062): a fact already shown inside its window is never shown again unless it has changed materially, and an identical `valueKey` is never shown again inside its
 * window under any circumstances. A fact is the engine's own unit; `factKey` = `{metricId}|{subjectKind}:{subjectId}[+{id2}]|{sport}.{season}|{asOf}` (built from the insight id, so the same insight
 * always has the same key), `valueKey` = a short canonical string of the numbers stated.
 *
 * WINDOWS (one frozen table, SAID_WINDOWS; a number moves in a visible one-line diff):
 *   week-moment   once, ever (the moment is the week's)            rank        7 days and only if the rank or the holder changed
 *   streak        once per run-length mark (3, 5, 8, 10)            rate        14 days            pair   14 days            default  14 days
 *   milestone     once per mark                                     callback    once per item per season
 *   team          a followed team's figures (DI-1085): not again until the team has played a NEW final game (the figure then changed because its record did); 7 days at the least
 * CHANGED MATERIALLY (the exact rule): at least one NEW final game entered the fact since it was shown AND one of: a rate moved 10 percentage points or more; a rank or a holder changed; a streak
 * crossed a mark or broke; a count crossed a milestone value; a record changed side of .500. A one-game wobble is not material; the same numbers never are.
 */
export const DAY_MS = 24 * 3600 * 1000;
export const SAID_WINDOWS = Object.freeze({
  'week-moment': Infinity, rank: 7 * DAY_MS, streak: Infinity, rate: 14 * DAY_MS, pair: 14 * DAY_MS, milestone: Infinity, callback: Infinity, team: 7 * DAY_MS, default: 14 * DAY_MS,
});
export const STREAK_MARKS = Object.freeze([3, 5, 8, 10]);
export const MATERIAL_RATE_MOVE = 0.10;
export const LEDGER_MAX = 200;
export const LEDGER_KEEP_MS = 90 * DAY_MS;

const WEEK_MOMENT = new Set(['cons.lone_correct', 'cons.league_miss', 'cons.polarizing', 'cons.unanimous', 'lg.closest_week', 'lg.blowout_week', 'lg.chaos_week', 'lg.collective_week', 'perf.best_worst_week']);
const RANK = new Set(['perf.rise_fall']);
const STREAK = new Set(['perf.streaks', 'beh.trust_run']);
const PAIR = new Set(['pair.agreement', 'pair.similar_opposite', 'pair.disagreement_record', 'pair.weekly_h2h', 'pair.split_team']);
/** the window kind a metric's facts follow (DI-1062's table) */
export function windowKindOf(metricId) {
  const id = String(metricId);
  if (id.startsWith('team.')) return 'team';
  if (id.startsWith('cb.')) return 'callback';
  if (WEEK_MOMENT.has(id)) return 'week-moment';
  if (RANK.has(id)) return 'rank';
  if (STREAK.has(id)) return 'streak';
  if (PAIR.has(id)) return 'pair';
  if (id.startsWith('lbl.') || id.startsWith('ident.') || id.startsWith('cons.') || id.startsWith('sit.')) return 'rate';
  return 'default';
}

const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); };
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const canonical = (v) => (v === null || typeof v !== 'object' ? JSON.stringify(v) : Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']' : '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}');

/** a short canonical string of the numbers a metric states: the record for a team (`4-3`), otherwise a hash of its value. Same numbers, same key; different numbers, different key. */
export function valueKeyOf(metric) {
  const v = metric && metric.value ? metric.value : {};
  if (metric.id === 'team.record') return `${v.w}-${v.l}${v.t ? '-' + v.t : ''}${v.otl ? '-' + v.otl : ''}/${v.games}`;
  if (metric.id === 'team.form') return `${(v.last || []).join('')}/${v.run ? v.run.n : 0}`;
  if (metric.id === 'team.ats_in_league') return `${v.covered}-${v.lost}-${v.pushed}`;
  return fnv(canonical(v)) + '/' + String(metric.n);
}
/** the one number "moved" is judged on, when the metric has one (a rate, a rank, a run, a count); null otherwise */
export function measureOf(metric) {
  const v = metric && metric.value ? metric.value : {};
  for (const k of ['rate', 'share', 'accuracy', 'homeShare']) if (num(v[k]) !== null) return v[k];
  if (v.current && num(v.current.run) !== null) return v.current.run;
  if (v.run && num(v.run.n) !== null) return v.run.n;
  for (const k of ['count', 'places', 'gap']) if (num(v[k]) !== null) return v[k];
  return null;
}

/** The ledger fact of a candidate (`c.id` is its insight id). Null when it has no id or no metric. */
export function factOf(c) {
  if (!c || typeof c.id !== 'string' || !Array.isArray(c.metricIds) || !c.metrics || !c.metrics[0]) return null;
  const p = c.id.split(':');
  if (p[0] !== 'ins1' || (p.length !== 6 && p.length !== 7)) return null;
  const m = c.metrics[0];
  const subjectId = p[4] + (p.length === 7 ? '+' + p[5] : '');
  const factKey = `${p[3]}|${(m.subject && m.subject.kind) || 'x'}:${subjectId}|${p[2]}|${p[p.length - 1]}`;
  return { factKey, kind: windowKindOf(p[3]), metricId: p[3], subjectId, valueKey: valueKeyOf(m), n: Number.isFinite(m.n) ? m.n : 0, measure: measureOf(m) };
}

const markOf = (r) => { let mk = 0; for (const x of STREAK_MARKS) if (r >= x) mk = x; return mk; };

/** Did the fact change materially since `prior` was shown? (the exact rule above) */
export function changedMaterially(fact, prior) {
  if (fact.valueKey === prior.valueKey) return false;                       // the same numbers never are
  if (!(fact.n > prior.n)) return false;                                     // a NEW final game must have entered it
  switch (fact.kind) {
    case 'team': return true;                                                 // a new game changes a team's record, form or scoring (the 7-day window is enforced in isBlocked, not here)
    case 'rank': return fact.measure !== prior.measure;
    case 'streak': return fact.measure === null || prior.measure === null || fact.measure < prior.measure || markOf(fact.measure) > markOf(prior.measure);
    case 'rate': case 'pair': case 'default': return fact.measure === null || prior.measure === null || Math.abs(fact.measure - prior.measure) >= MATERIAL_RATE_MOVE - 1e-9;
    default: return false;
  }
}

/**
 * Is this fact blocked right now? `ledger` = entries { factKey, kind, metricId, subjectId, valueKey, n, measure, at }, any order. A fact never shown is never blocked.
 */
export function isBlocked(ledger, fact, now) {
  if (!fact) return false;
  const list = (Array.isArray(ledger) ? ledger : []).filter((e) => e && e.metricId === fact.metricId && e.subjectId === fact.subjectId).sort((a, b) => b.at - a.at);
  for (const e of list) {
    const age = now - e.at;
    const win = SAID_WINDOWS[fact.kind] ?? SAID_WINDOWS.default;
    switch (fact.kind) {
      case 'week-moment': case 'milestone': case 'callback':
        if (e.factKey === fact.factKey) return true;                          // once: the moment (or item, or mark) is shown a single time
        break;
      case 'streak':
        if (e.factKey === fact.factKey && !changedMaterially(fact, e)) return true;
        if (e.valueKey === fact.valueKey && age < 14 * DAY_MS) return true;
        if (fact.measure !== null && e.measure !== null && fact.measure >= e.measure && markOf(fact.measure) <= markOf(e.measure) && age < 14 * DAY_MS) return true;   // a run is told once per mark
        break;
      case 'team':
        if (e.valueKey === fact.valueKey) return true;                        // identical numbers: never again until something changed
        if (!(fact.n > e.n)) return true;                                     // the team has not played since: not re-emitted
        if (age < win) return true;                                           // DI-1085/1088: 7 days at the least, whatever the schedule (an NHL team that plays every two days is still shown once a week)
        break;
      default:
        if (age >= win) break;
        if (!changedMaterially(fact, e)) return true;                         // inside the window only a material change restates it (identical numbers are never material: under no circumstances)
    }
  }
  return false;
}

/** The ledger after `fact` was shown at `now` (a new array; entries past 90 days dropped, the newest LEDGER_MAX kept, one entry per factKey+valueKey). */
export function recordShown(ledger, fact, now) {
  if (!fact) return Array.isArray(ledger) ? ledger.slice() : [];
  const keep = (Array.isArray(ledger) ? ledger : []).filter((e) => e && now - e.at < LEDGER_KEEP_MS && !(e.factKey === fact.factKey && e.valueKey === fact.valueKey));
  keep.push({ factKey: fact.factKey, kind: fact.kind, metricId: fact.metricId, subjectId: fact.subjectId, valueKey: fact.valueKey, n: fact.n, measure: fact.measure, at: now });
  keep.sort((a, b) => b.at - a.at);
  return keep.slice(0, LEDGER_MAX);
}

/** closed-shape (de)serialisation for the caller's storage: an unreadable or hostile value is an EMPTY ledger (it only ever makes the app show a card it might have held back, never hide a new one) */
export function ledgerToJson(ledger) { return JSON.stringify((Array.isArray(ledger) ? ledger : []).slice(0, LEDGER_MAX)); }
export function ledgerFromJson(text) {
  let raw;
  try { raw = JSON.parse(String(text)); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const e of raw.slice(0, LEDGER_MAX)) {
    if (!e || typeof e !== 'object' || typeof e.factKey !== 'string' || typeof e.valueKey !== 'string' || typeof e.metricId !== 'string' || typeof e.subjectId !== 'string' || !Number.isFinite(e.at)) continue;
    out.push({ factKey: e.factKey.slice(0, 200), kind: typeof e.kind === 'string' && Object.prototype.hasOwnProperty.call(SAID_WINDOWS, e.kind) ? e.kind : 'default', metricId: e.metricId.slice(0, 40), subjectId: e.subjectId.slice(0, 120), valueKey: e.valueKey.slice(0, 80), n: Number.isFinite(e.n) ? e.n : 0, measure: Number.isFinite(e.measure) ? e.measure : null, at: e.at });
  }
  return out;
}
