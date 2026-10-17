/**
 * CFB Pickems — lockinstanttest.mjs (PF-1 / UN-410, UN-411 / DI-489, DI-490, DI-495, DI-497, DI-498 item 2, 2026-10-01)
 * =====================================================================================================================
 * THE LOCK INSTANT HAS THREE COPIES, AND THIS FILE IS WHAT KEEPS THEM ONE FORMULA.
 *
 *   1. js/scoring.js        computeEffectiveLockAt(week, games)   — what the client lock tick and the Picks page read.
 *   2. js/reminder-rules.js effectiveLockAtMs(week, games)        — a deliberate pure copy for the reminders Edge Function (its header forbids importing scoring.js).
 *   3. migration 0043       public.week_lock_instant(league, week) — what the SERVER's guard (pick_window_open) and the job (auto_lock_weeks) read.
 *
 * They are NOT unified (a shared module would drag the DOM-touching import chain behind the Edge Function). They are PINNED: the third copy's rules are PARSED OUT OF THE SQL TEXT (the
 * leaguesettingstest [8] technique, so a change to the SQL moves this test), turned into a model, and that model is compared with the two JavaScript copies over a full matrix:
 *
 *      picksLockAt {none, past, future} x offset {0, 30, 720, negative, absent} x games {none, all-null kickoff, one, many, unsorted, a null among dated, date-only, equal kickoffs}
 *      x week {real, demo}                                                       = 300 cases, three answers each
 *
 * Then the BOUNDARY (now == instant is CLOSED in all three: the server's `now() <` and the client's `now >= lockAt`), the guard's own truth table (status x explicit time x instant x demo),
 * the client mirror of it (getEffectiveWeekStatus + canPlayerSubmitPicks's added clause) and the SP-53 Leave predicate fed the effective instant (the 25-case shape, from 0043's guard text).
 *
 * WHAT THIS DOES NOT PROVE: that Postgres evaluates the function the way the model reads it (that is rls.test.mjs S43.*, which Drew runs) and the polish of anything. A green offline suite is not
 * evidence about the real server.
 *
 * Run:  node lockinstanttest.mjs      (also under TZ=UTC and TZ=America/Los_Angeles)
 */
import { readFile } from 'node:fs/promises';

const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), clear: () => store.clear(),
};
globalThis.document = {
  addEventListener() {}, removeEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '' }, hidden: false,
};
globalThis.window = globalThis;
globalThis.fetch = async () => { throw new Error('network disabled in lockinstanttest'); };

let pass = 0, fail = 0;
function assert(cond, label, detail = '') {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label, detail ? `— ${detail}` : ''); }
}
const read = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const stripComments = (t) => t.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
const flat = (t) => stripComments(t).replace(/\s+/g, ' ').trim();

const scoring = await import('./js/scoring.js');
const rules = await import('./js/reminder-rules.js');
const storage = await import('./js/storage.js');
const leagueSettings = await import('./js/league-settings.js');
const weekLock = await import('./js/week-lock.js');          // D1 / DI-509: the fourth copy of the instant — the ONE helper every client lock surface reads
const { computeEffectiveLockAt } = scoring;
const { effectiveLockAtMs } = rules;
const { getEffectiveWeekStatus } = storage;

const sql43 = await read('./supabase/migrations/0043_pf1_server_lock.sql');
const sql01 = await read('./supabase/migrations/0001_schema.sql');
const dataModelSrc = await read('./js/data-model.js');
const appSrc = await read('./js/app.js');

// ══════════════════════════════════════════════════════════════════════════
console.log('\n[1] The SQL twin, PARSED: the rules the model below is built from…');
// ══════════════════════════════════════════════════════════════════════════
const fnText = (sql, name) => {
  const m = new RegExp(`^create or replace function public\\.${name}\\(`, 'm').exec(sql);
  if (!m) return '';
  const end = sql.indexOf('$$;', sql.indexOf('$$', m.index) + 2);
  return sql.slice(m.index, end + 3);
};
const wli = flat(fnText(sql43, 'week_lock_instant'));
const pwo = flat(fnText(sql43, 'pick_window_open'));
assert(wli.length > 100 && pwo.length > 100, '[1a] both functions were found in 0043');
const m1 = /select coalesce\( ?w\.picks_lock_at, \(select min\(g\.kickoff\) from public\.games g where (g\.league_id = w\.league_id and g\.week_id = w\.id)\) - make_interval\(mins => case when w\.auto_lock_offset_minutes >= (\d+) then w\.auto_lock_offset_minutes else (\d+) end\)\) from public\.weeks w where w\.league_id = p_league and w\.id = p_week;/.exec(wli);
assert(!!m1, '[1b] the instant is coalesce(picks_lock_at, min(kickoff of THIS week\'s own games) - make_interval(mins => offset-or-default)) over exactly the (league, week) row — and nothing else',
  wli);
const SQL_FLOOR = m1 ? Number(m1[2]) : NaN;
const SQL_FALLBACK = m1 ? Number(m1[3]) : NaN;
assert(!!m1 && m1[1] === 'g.league_id = w.league_id and g.week_id = w.id', '[1c] the games it reads are exactly the week\'s own rows by (league_id, week_id): no status, sport, question or competition filter (getGames(weekId) reads the same set)');
assert(!/\b(?:g|w)\.(?:status|sport|competition_id|parent_game_id)\b/.test(wli.replace(/w\.auto_lock_offset_minutes|w\.picks_lock_at|w\.league_id|w\.id/g, '')), '[1d] no status / sport / competition / question filter anywhere in the function');
const colDefault = Number((/auto_lock_offset_minutes\s+integer not null default (\d+)/.exec(sql01) || [])[1]);
assert(colDefault === 30, `[1e] the column is NOT NULL with default ${colDefault}: an "absent" offset is the column default, never NULL`);
const jsOffsetRule = /Number\.isFinite\(v\) && v >= (\d+) \? v : (\d+)/.exec(dataModelSrc);
assert(!!jsOffsetRule && Number(jsOffsetRule[1]) === SQL_FLOOR && Number(jsOffsetRule[2]) === SQL_FALLBACK && SQL_FLOOR === 0 && SQL_FALLBACK === 30,
  `[1f] the offset rule agrees across SQL and getAutoLockOffsetMinutes: v >= ${SQL_FLOOR} else ${SQL_FALLBACK} (a negative offset reads as ${SQL_FALLBACK})`, JSON.stringify({ SQL_FLOOR, SQL_FALLBACK }));
const createWeekDefault = Number((/autoLockOffsetMinutes:\s*(\d+),/.exec(dataModelSrc) || [])[1]);
assert(createWeekDefault === colDefault, `[1g] createWeek()'s default (${createWeekDefault}) equals the column default (${colDefault})`);
const guard = /select exists \(select 1 from public\.weeks w where w\.league_id = p_league and w\.id = p_week and w\.status = '(\w+)' and \(w\.picks_lock_at is null or now\(\) < w\.picks_lock_at\) and \(w\.data_source_mode = '(\w+)' or coalesce\(now\(\) < public\.week_lock_instant\(w\.league_id, w\.id\), (true|false)\)\)\);/.exec(pwo);
assert(!!guard, '[1h] the guard is: status is open AND (no explicit lock time, or now before it) AND (a demo week, or now before the lock instant — a NULL instant COUNTING AS NOT CLOSED)', pwo);
const OPEN_STATUS = guard ? guard[1] : '';
const DEMO_MODE = guard ? guard[2] : '';
const NULL_MEANS_OPEN = guard ? guard[3] === 'true' : false;
assert(OPEN_STATUS === 'open' && DEMO_MODE === 'demo' && NULL_MEANS_OPEN === true, '[1i] …with status open, the demo flag `demo`, and NULL = not closed (coalesce true)');
assert(!/picks_open_at/.test(pwo) && /picks_lock_at/.test(pwo), '[1j] still no picks_open_at (A3 / RG-28) and still picks_lock_at');

// ══════════════════════════════════════════════════════════════════════════
console.log('\n[2] The model, and the three formula copies over the full matrix…');
// ══════════════════════════════════════════════════════════════════════════
const NOW = Date.parse('2026-10-04T18:00:00Z');
const MIN = 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const PAST = iso(NOW - 3 * 60 * MIN);
const FUTURE = iso(NOW + 3 * 60 * MIN);
const K = (offsetMin) => iso(NOW + offsetMin * MIN);

/** The server's week_lock_instant, as the PARSED text reads: `row` is a weeks row, `games` the games rows of that week (kickoff: ISO | null). Returns epoch ms or null. */
function sqlInstant(row, games) {
  if (row.picks_lock_at !== null && row.picks_lock_at !== undefined) return Date.parse(row.picks_lock_at);
  const ks = games.map((g) => g.kickoff).filter((k) => k !== null && k !== undefined).map((k) => Date.parse(k));   // min() ignores NULLs
  if (!ks.length) return null;
  const off = row.auto_lock_offset_minutes >= SQL_FLOOR ? row.auto_lock_offset_minutes : SQL_FALLBACK;
  return Math.min(...ks) - off * MIN;
}
const weekFor = ({ lock, offset, demo }) => {
  const w = { weekId: 'w', status: 'open', dataSourceMode: demo ? 'demo' : 'manual' };
  if (lock !== 'none') w.picksLockAt = lock === 'past' ? PAST : FUTURE;
  if (offset !== 'absent') w.autoLockOffsetMinutes = offset;
  return w;
};
/** The week as a ROW: a missing offset is the column default, never NULL. */
const rowFor = (w) => ({ picks_lock_at: w.picksLockAt ?? null, auto_lock_offset_minutes: w.autoLockOffsetMinutes === undefined ? colDefault : w.autoLockOffsetMinutes, data_source_mode: w.dataSourceMode });
const GAME_SHAPES = {
  none: [],
  'all-null': [{ gameId: 'a', kickoff: null }, { gameId: 'b', kickoff: null }],
  'all-empty-string': [{ gameId: 'a', kickoff: '' }],
  one: [{ gameId: 'a', kickoff: K(120) }],
  many: [{ gameId: 'a', kickoff: K(120) }, { gameId: 'b', kickoff: K(300) }, { gameId: 'c', kickoff: K(60) }],
  unsorted: [{ gameId: 'a', kickoff: K(500) }, { gameId: 'b', kickoff: K(45) }, { gameId: 'c', kickoff: K(200) }, { gameId: 'd', kickoff: K(46) }],
  'null-among-dated': [{ gameId: 'a', kickoff: null }, { gameId: 'b', kickoff: K(90) }, { gameId: 'c', kickoff: null }],
  'date-only': [{ gameId: 'a', kickoff: '2026-10-04T00:00:00.000Z', kickoffDateOnly: true }, { gameId: 'b', kickoff: K(240) }],
  'equal-kickoffs': [{ gameId: 'a', kickoff: K(100) }, { gameId: 'b', kickoff: K(100) }],
  'past-kickoffs': [{ gameId: 'a', kickoff: K(-60) }, { gameId: 'b', kickoff: K(-10) }],
};
const sqlGames = (games) => games.map((g) => ({ kickoff: g.kickoff === '' ? null : g.kickoff }));   // an empty string is no kickoff: the column would be NULL
let cases = 0;
const misses = [];
for (const lock of ['none', 'past', 'future']) for (const offset of [0, 30, 720, -5, 'absent']) for (const [shape, games] of Object.entries(GAME_SHAPES)) for (const demo of [false, true]) {
  cases += 1;
  const w = weekFor({ lock, offset, demo });
  const server = sqlInstant(rowFor(w), sqlGames(games));
  const a = computeEffectiveLockAt(w, games);
  const client = a ? a.getTime() : null;
  const reminder = effectiveLockAtMs(w, games);
  const helper = weekLock.weekLockState({ week: w, games, now: NOW }).lockAtMs;
  if (client !== server || reminder !== server || helper !== server) misses.push({ lock, offset, shape, demo, server, client, reminder, helper });
}
assert(cases === 3 * 5 * 10 * 2 && misses.length === 0, `[2a] computeEffectiveLockAt, effectiveLockAtMs, week-lock.js weekLockState and the PARSED week_lock_instant agree on the instant over all ${cases} cases (picksLockAt x offset x ten game shapes x real/demo)`, JSON.stringify(misses.slice(0, 3)));
{
  const w = weekFor({ lock: 'none', offset: 30, demo: false });
  assert(sqlInstant(rowFor(w), sqlGames(GAME_SHAPES.many)) === NOW + 60 * MIN - 30 * MIN, '[2b] hand-checked: first kickoff in 60 minutes, offset 30 -> the instant is 30 minutes ahead');
  assert(sqlInstant(rowFor({ ...w, autoLockOffsetMinutes: 0 }), sqlGames(GAME_SHAPES.many)) === NOW + 60 * MIN, '[2c] offset 0: the instant IS the first kickoff');
  assert(sqlInstant(rowFor({ ...w, autoLockOffsetMinutes: -5 }), sqlGames(GAME_SHAPES.many)) === NOW + 60 * MIN - 30 * MIN, '[2d] a NEGATIVE offset reads as 30');
  assert(sqlInstant(rowFor({ ...w, autoLockOffsetMinutes: 720 }), sqlGames(GAME_SHAPES.many)) === NOW + 60 * MIN - 720 * MIN, '[2e] offset 720 (the wizard\'s cap) is accepted as written: it locks EARLY, never late');
  assert(sqlInstant(rowFor(weekFor({ lock: 'future', offset: 30, demo: false })), sqlGames(GAME_SHAPES.many)) === Date.parse(FUTURE), '[2f] an explicit picks_lock_at is the instant, EXACTLY — even later than first kickoff (honoured, not capped)');
  assert(sqlInstant(rowFor(w), []) === null && sqlInstant(rowFor(w), sqlGames(GAME_SHAPES['all-null'])) === null, '[2g] no games, or no kickoff time on any game: no instant (NULL), so nothing to close');
  assert(sqlInstant(rowFor(w), sqlGames(GAME_SHAPES['null-among-dated'])) === NOW + 90 * MIN - 30 * MIN, '[2h] a game with no kickoff among dated ones is ignored (the client filter in computeFirstKickoff)');
  assert(sqlInstant(rowFor(w), sqlGames(GAME_SHAPES['date-only'])) < NOW && Date.parse('2026-10-04T00:00:00.000Z') - 30 * MIN === sqlInstant(rowFor(w), sqlGames(GAME_SHAPES['date-only'])),
    '[2i] a DATE-ONLY (TBD time) game COUNTS: it can lock the week earlier than its real kickoff, never later (client behaviour, mirrored)');
}
{
  // Recorded, unreachable quirk: computeFirstKickoff's `t && !isNaN(t)` treats a kickoff at EXACTLY the Unix epoch (a falsy number) as no kickoff, where the SQL and reminder-rules.js count it.
  const epoch = [{ gameId: 'e', kickoff: '1970-01-01T00:00:00.000Z' }];
  const w = weekFor({ lock: 'none', offset: 30, demo: false });
  const c = computeEffectiveLockAt(w, epoch);
  assert(c === null && effectiveLockAtMs(w, epoch) === -30 * MIN && sqlInstant(rowFor(w), epoch) === -30 * MIN,
    '[2j] RECORDED, UNREACHABLE (a game at 1970-01-01T00:00:00Z): scoring.js drops a kickoff of exactly epoch 0 (falsy), the other two copies count it — not matrix material, and a change in either direction shows up here');
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n[3] The BOUNDARY, and the guard\'s truth table…');
// ══════════════════════════════════════════════════════════════════════════
/** pick_window_open as the PARSED text reads, for one week row at `now`. */
function sqlWindowOpen(row, games, now) {
  if (row.status !== OPEN_STATUS) return false;
  if (!(row.picks_lock_at === null || row.picks_lock_at === undefined || now < Date.parse(row.picks_lock_at))) return false;
  if (row.data_source_mode === DEMO_MODE) return true;
  const inst = sqlInstant(row, games);
  const lt = inst === null ? null : now < inst;
  return lt === null ? NULL_MEANS_OPEN : lt;
}
/** The client's mirror: getEffectiveWeekStatus() for an explicit time + canPlayerSubmitPicks()'s added clause (app.js) for the derived instant. */
function clientWindowOpen(week, games, now) {
  const realNow = Date.now;
  Date.now = () => now;
  const RealDate = globalThis.Date;
  try {
    // getEffectiveWeekStatus uses `new Date()`: pin it through a subclass so both reads see `now`
    globalThis.Date = class extends RealDate { constructor(...a) { if (a.length === 0) super(now); else super(...a); } static now() { return now; } };
    const eff = getEffectiveWeekStatus(week);
    if (eff !== 'open' || week.status !== 'open') return false;
    if (week.dataSourceMode !== 'demo') {
      const lockAt = computeEffectiveLockAt(week, games);
      if (lockAt && now >= lockAt.getTime()) return false;
    }
    return true;
  } finally { globalThis.Date = RealDate; Date.now = realNow; }
}
{
  const w = weekFor({ lock: 'none', offset: 30, demo: false });
  const games = GAME_SHAPES.one;                                        // first kickoff NOW+120 min -> instant NOW+90 min
  const instant = sqlInstant(rowFor(w), sqlGames(games));
  const at = (d) => [sqlWindowOpen({ ...rowFor(w), status: 'open' }, sqlGames(games), instant + d), clientWindowOpen(w, games, instant + d)];
  assert(JSON.stringify(at(-1)) === '[true,true]', '[3a] one millisecond BEFORE the instant: open on the server model and on the client mirror');
  assert(JSON.stringify(at(0)) === '[false,false]', '[3b] EXACTLY AT the instant: CLOSED on both (the server\'s `now() <` and the client\'s `now >= lockAt` are the same boundary)');
  assert(JSON.stringify(at(1)) === '[false,false]', '[3c] one millisecond after: closed on both');
  const e = weekFor({ lock: 'future', offset: 30, demo: false });
  const ei = Date.parse(FUTURE);
  assert(sqlWindowOpen({ ...rowFor(e), status: 'open' }, sqlGames(games), ei - 1) === true && sqlWindowOpen({ ...rowFor(e), status: 'open' }, sqlGames(games), ei) === false
    && clientWindowOpen(e, games, ei - 1) === true && clientWindowOpen(e, games, ei) === false, '[3d] the same boundary for an EXPLICIT picks_lock_at (the older clause and getEffectiveWeekStatus)');
}
{
  const rowsTable = [];
  const mism = [];
  for (const status of ['draft', 'open', 'locked', 'live', 'final']) for (const lock of ['none', 'past', 'future']) for (const shape of ['none', 'one', 'past-kickoffs', 'all-null']) for (const demo of [false, true]) for (const nowOff of [-90, -1, 0, 1, 90]) {
    const w = { ...weekFor({ lock, offset: 30, demo }), status };
    const games = GAME_SHAPES[shape];
    const now = NOW + nowOff * MIN;
    const srv = sqlWindowOpen({ ...rowFor(w), status }, sqlGames(games), now);
    // the client mirror is meaningful for an OPEN stored status; every other status is denied by the earlier lines of canPlayerSubmitPicks, so it must equal the server's `false`
    const cli = status === 'open' ? clientWindowOpen(w, games, now) : false;
    rowsTable.push([status, lock, shape, demo, nowOff]);
    if (srv !== cli) mism.push({ status, lock, shape, demo, nowOff, srv, cli });
  }
  assert(rowsTable.length === 5 * 3 * 4 * 2 * 5 && mism.length === 0, `[3e] the server's pick window and the client mirror agree over every (stored status x explicit time x slate x real/demo x moment) combination (${rowsTable.length} cases)`, JSON.stringify(mism.slice(0, 3)));
  const draftOrFinal = ['draft', 'locked', 'live', 'final'].every((s) => sqlWindowOpen({ ...rowFor(weekFor({ lock: 'none', offset: 30, demo: false })), status: s }, [], NOW) === false);
  assert(draftOrFinal, '[3f] only an `open` week has a pick window at all (draft, locked, live and final are closed on status alone)');
  assert(sqlWindowOpen({ ...rowFor(weekFor({ lock: 'none', offset: 30, demo: true })), status: 'open' }, sqlGames(GAME_SHAPES['past-kickoffs']), NOW) === true
    && sqlWindowOpen({ ...rowFor(weekFor({ lock: 'none', offset: 30, demo: false })), status: 'open' }, sqlGames(GAME_SHAPES['past-kickoffs']), NOW) === false,
    '[3g] a DEMO week with every kickoff past is still open; the identical slate as a real week is closed (the exemption is the demo flag)');
  assert(sqlWindowOpen({ ...rowFor(weekFor({ lock: 'none', offset: 30, demo: false })), status: 'open' }, [], NOW) === true
    && sqlWindowOpen({ ...rowFor(weekFor({ lock: 'none', offset: 30, demo: false })), status: 'open' }, sqlGames(GAME_SHAPES['all-null']), NOW) === true,
    '[3h] no dated game: a NULL instant is NOT closed (a bare `now() < NULL` would deny every pick on a hand-built slate)');
  const later = weekFor({ lock: 'future', offset: 30, demo: false });
  assert(sqlWindowOpen({ ...rowFor(later), status: 'open' }, sqlGames(GAME_SHAPES['past-kickoffs']), NOW) === true,
    '[3i] AMENDMENT 1 (late entry): an explicit picks_lock_at LATER than the derived instant keeps the window open although every kickoff has passed — the commissioner\'s chosen time is honoured exactly');
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n[4] The SP-53 Leave predicate, fed the EFFECTIVE instant (DI-495(b), DI-497)…');
// ══════════════════════════════════════════════════════════════════════════
{
  const statuses = ['draft', 'open', 'locked', 'live', 'final'];
  // leave_league's predicate, in its LATEST definition (0042 = 0037's body + the G-6 seven-day bound): w.status in ('open','locked','live') and NOT pick_window_open and the bound — over the guard text PARSED above
  const sql42 = flat(await read('./supabase/migrations/0042_sp53_release_gates.sql'));
  const inList = /w\.status in \(([^)]*)\) and not public\.pick_window_open\(w\.league_id, w\.id\)/.exec(sql42);
  const inProgressStatuses = inList ? [...inList[1].matchAll(/'(\w+)'/g)].map((m) => m[1]) : [];
  const boundM = /coalesce\(now\(\) < greatest\(\(select min\(g\.kickoff\) from public\.games g where g\.league_id = w\.league_id and g\.week_id = w\.id\), w\.picks_lock_at\) \+ interval '(\d+) days', false\)/.exec(sql42);
  const boundDays = boundM ? Number(boundM[1]) : NaN;
  assert(inProgressStatuses.join() === 'open,locked,live' && boundDays === 7, '[4a] leave_league (0042) refuses `week_in_progress` for status in (open, locked, live) and NOT pick_window_open — the guard 0043 just widened — and only inside the G-6 seven-day bound (greatest of the first kickoff and picks_lock_at, coalesced to false)', JSON.stringify({ inProgressStatuses, boundDays }));
  const instants = [null, iso(NOW - 90 * MIN), iso(NOW + 90 * MIN), iso(NOW), '', iso(NOW - 1), iso(NOW + 1)];
  const rows = [];
  const mism = [];
  for (const status of statuses) for (const instantIso of instants) {
    // the server: the instant here is what week_lock_instant returned (explicit or derived), no demo flag, `now` = NOW
    const open = status === OPEN_STATUS && (instantIso === null || instantIso === '' ? NULL_MEANS_OPEN : NOW < Date.parse(instantIso));
    // G-6: the bound is anchored on max(first kickoff, picks_lock_at); this fixture feeds the instant alone (no firstKickoff), so the instant is the anchor, and no anchor reads as lapsed (the coalesce)
    const anchorMs = instantIso ? Date.parse(instantIso) : NaN;
    const withinBound = Number.isFinite(anchorMs) && NOW < anchorMs + boundDays * 24 * 60 * MIN;
    const server = inProgressStatuses.includes(status) && !open && withinBound;
    const client = leagueSettings.isWeekInProgressForLeave({ weekId: 'w', status, picksLockAt: instantIso }, new Date(NOW));
    rows.push([status, instantIso]);
    if (server !== client) mism.push({ status, instantIso, server, client });
  }
  assert(rows.length === 5 * 7 && mism.length === 0, `[4b] isWeekInProgressForLeave fed the effective instant equals the server model over every (stored status x instant) combination, the boundary (now exactly, +/-1 ms) included (${rows.length} cases)`, JSON.stringify(mism));
  // the end to end shape: a stored-open week with NO explicit time whose first kickoff minus the offset has passed IS in progress once the Leave row feeds the DERIVED instant
  const w = weekFor({ lock: 'none', offset: 30, demo: false });
  const derivedIso = (() => { const d = computeEffectiveLockAt(w, GAME_SHAPES['past-kickoffs']); return d ? d.toISOString() : null; })();
  assert(leagueSettings.isWeekInProgressForLeave({ weekId: 'w', status: 'open', picksLockAt: null }, new Date(NOW)) === false
    && leagueSettings.isWeekInProgressForLeave({ weekId: 'w', status: 'open', picksLockAt: derivedIso }, new Date(NOW)) === true,
    '[4c] THE Q-W GAP, in one line: the same stored-open week reads "not in progress" with its null picksLockAt and "in progress" once the Leave row feeds computeEffectiveLockAt\'s instant — the server answers the second since 0043');
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n[5] The source pins: the client mirror in app.js, and the Leave comment…');
// ══════════════════════════════════════════════════════════════════════════
{
  const fn = appSrc.slice(appSrc.indexOf('export function canPlayerSubmitPicks('), appSrc.indexOf('function isGamePickable('));
  const code = fn.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n').replace(/\s+/g, ' ');
  // D1 / DI-509 (2026-10-07): the inline mirror became the ONE helper (js/week-lock.js weekLockState). The clause is the same test asked of that helper: `.derived` is true exactly when the
  // week is stored open, not a demo week, has an instant and `now >= instant` (weeklocktest.mjs proves the helper over this file's own 300-case fixtures), so the source pin moved with it.
  assert(/if \(week\.status === 'open' && weekLockState\(\{ week, games: getGames\(week\.weekId\) \}\)\.derived\) return \{ allowed:false, reason:'Week is locked — no new picks accepted\.' \};/.test(code),
    '[5a] canPlayerSubmitPicks closes at the derived instant through the ONE helper (weekLockState(...).derived: `now >= instant`, only an open non-demo week), only ever denying, with the EXISTING sentence');
  assert(code.indexOf("reason:'Games are in progress — picks closed.'") < code.indexOf('weekLockState({ week, games: getGames(week.weekId) }).derived') && code.indexOf('weekLockState({ week, games: getGames(week.weekId) }).derived') < code.lastIndexOf('allowed:true'),
    '[5b] …and the added clause sits AFTER every existing denial and BEFORE the one `allowed:true` (fail-closed order preserved)');
  const ls = await read('./js/league-settings.js');
  assert(/THE FORMER KNOWN GAP IS CLOSED \(PF-1/.test(ls) && !/KNOWN GAP \(PF-1, Drew deciding/.test(ls), '[5c] league-settings.js records the closed gap (the comment is a record, not a warning)');
}

console.log(`\n${pass} passed, ${fail} failed.`);
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
