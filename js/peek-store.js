/**
 * CFB Pickems — peek-store.js (Deployment 2, thread 101826-D2, lane 3 "Personal Home"; DI-803 / DI-804 / DI-801 / DI-811 / DI-815, UN/PF-508)
 * =============================================================================================================================================
 * THE READ-ONLY PEEK STORE: every league the signed-in member belongs to OTHER than the active one, read for Home under the member's own sign-in and held IN MEMORY ONLY.
 * The active league keeps living in the storage mirror exactly as before; nothing here is ever merged into it.
 *
 *   createPeekStore(deps)   one store per app (js/app.js's wiring lambda creates it and hands it to createHome as `peek`)
 *     .targets()            the leagues Home reads besides the active one: active memberships, the session's recently-active first, then membership order, at most
 *                           HOME_LEAGUE_CAP - 1 others; `.overflow` counts the ones beyond the cap (named in Your Leagues, never silently dropped)
 *     .refresh({ manual })  read the targets that are due (concurrency 2, one read in flight per league, 20 s apart, the device request guard, the back-off)
 *     .setVisible(bool)     Home visible / hidden: the poll runs only while visible (60 s while any peeked league has a live game, else 5 min)
 *     .leagueView(id)       what Home may use for one league: { leagueId, leagueName, memberId, pilot, source, isPublic, picksReadConfirmed, weekProgress, status, asOf, hasLive }
 *     .states()             per target: status ('loading' | 'ready' | 'stale' | 'failed' | 'never' | 'partial'), asOf, hasLive — the calm failure lines read these
 *     .clear(reason)        forget everything now (sign out, account switch, identity change; also done automatically when the identity tuple moves)
 *
 * PRIVACY (security read for the cross-league Home; DI-803, DI-811):
 *   - It holds, per league the member is an ACTIVE member of, only what row-level security returned to the member — and filters it again before storing (a belt over
 *     RLS): draft weeks, demo weeks (a commissioner's demo weeks never leave their own league) and archived sports' weeks are dropped; another member's pick is dropped
 *     for any week the league has not made public (live or final), so a policy regression cannot reach Home.
 *   - THE REVEAL CLOCK (the RG-255 rule): a week counts as "read while public" only if the PREVIOUS successful read of that league already saw it live or final, so the
 *     first read of a session confirms no week; another member's pick of a week is kept only once confirmed. Conservative on purpose (at most one poll's delay).
 *   - Keyed by `${accountId}|${leagueId}`; cleared when the account, the identity epoch or the membership set moves; a result that lands after any of those moved is
 *     DISCARDED with no state change and no event (I6). Nothing is written to storage, Capacitor, IndexedDB, the service worker or the device snapshot.
 *   - Caps (fail loud, never truncate silently): a league over PEEK_CAPS is 'partial' and contributes no items (a truncated pick set ranks wrongly).
 * This module imports js/league-source.js and nothing else: no storage, no writer, no chat module, no adapter (the read function is INJECTED).
 */
import { sourceFromPeek } from './league-source.js';

/** Q5 (Drew, round 3, 2026-10-19: "as recommended"): Home reads at most five leagues — the active one and four others; a sixth is named in Your Leagues. */
export const HOME_LEAGUE_CAP = 5;
export const PEEK_POLL_LIVE_MS = 60 * 1000;
export const PEEK_POLL_IDLE_MS = 5 * 60 * 1000;
export const PEEK_MIN_INTERVAL_MS = 20 * 1000;
export const PEEK_MAX_REQUESTS_PER_MIN = 40;
export const PEEK_CONCURRENCY = 2;
/** After a failed read: wait 60 s, then 120 s, then 300 s; a fourth failure HOLDS the league until a manual refresh. */
export const PEEK_BACKOFF_MS = Object.freeze([60 * 1000, 120 * 1000, 300 * 1000]);
/** A league with a live game whose last good read is older than this says so ("couldn't refresh. Showing 2:14 PM"). */
export const PEEK_STALE_LIVE_MS = 2 * 60 * 1000;
/**
 * The size one peeked league may hold (reviewer R1, 2026-10-19 — a planning defect in DI-803's 60-week cap, amended here and recorded for user-experience): an NHL league plays one slate per game
 * night (lane 2, D-113), about 180 nights in a regular season of up to ~15 games each, so ONE season must fit — 220 slates, 3,000 games, 20,000 pick rows. Older SEASONS are dropped from the peek
 * whole (newest first, never part of a season: a part-season would give a wrong rank or streak), so a long-lived league is never dropped; only a league whose newest season alone exceeds the caps
 * is "partial" — reported on Home in words, never silently omitted.
 */
export const PEEK_CAPS = Object.freeze({ weeks: 220, games: 3000, picks: 20000 });
/**
 * Each peek RESERVES this many requests when it is queued: the eight table reads (supabase-backend.js PEEK_TABLES, one page each) and at most one counts call (PEEK_PROGRESS_WEEKS). A read
 * that needed more (a paged table, a table read again) is charged its REAL count when it lands (`peek.requests`), so the guard sees what was sent (security F1, 2026-10-19).
 */
export const PEEK_REQUESTS_PER_READ = 9;

const PUBLIC = new Set(['live', 'final']);
const arr = (v) => (Array.isArray(v) ? v : []);
const isStr = (v) => typeof v === 'string' && v !== '';
const fn = (f, fallback) => (typeof f === 'function' ? f : fallback);

/** The week statuses a peek reported, as `{ weekId: status }` (only string statuses survive). */
function statusMap(raw) {
  const out = {};
  if (raw && typeof raw === 'object') for (const [k, v] of Object.entries(raw)) if (isStr(k) && isStr(v)) out[k] = v;
  return out;
}

/**
 * THE BELT OVER RLS, applied to a fresh peek before it is stored. Returns `{ values, partial }`; `confirmed` is the reveal clock's set (weeks public in this read AND the previous one).
 * Exported for peektest.
 */
export function filterPeek(peek, { viewerMemberId, confirmed }) {
  const v = peek && peek.values && typeof peek.values === 'object' ? peek.values : {};
  const status = statusMap(peek && peek.weekStatus);
  const archived = new Set(arr(v.cfbp_competitions).filter((c) => c && c.archivedAt).map((c) => c.id));
  // The week's status is the SERVER's (the peek's own weekStatus, falling back to the projected row's).
  const statusOf = (w) => status[w.weekId] || w.status;
  const weeks = arr(v.cfbp_weeks).filter((w) => w && isStr(w.weekId)
    && statusOf(w) !== 'draft' && w.dataSourceMode !== 'demo' && !(w.competitionId && archived.has(w.competitionId)))
    .map((w) => (status[w.weekId] && status[w.weekId] !== w.status ? { ...w, status: status[w.weekId] } : w));
  // R1: whole seasons, newest first, while the caps hold (a season's pick rows are counted RAW, as the server sent them); the rest are dropped from the peek, never part of a season
  const seasonOf = (w) => String(w.season ?? '');
  const seasons = [...new Set(weeks.map(seasonOf))].sort((a, b) => (Number(b) - Number(a)) || (a < b ? 1 : a > b ? -1 : 0));
  const rawGames = arr(v.cfbp_games), rawPicks = arr(v.cfbp_picks);
  const tally = { weeks: 0, games: 0, picks: 0 };
  const keptSeasons = new Set();
  let partial = false;
  for (const se of seasons) {
    const ids = new Set(weeks.filter((w) => seasonOf(w) === se).map((w) => w.weekId));
    const add = { weeks: ids.size, games: rawGames.filter((g) => g && ids.has(g.weekId)).length, picks: rawPicks.filter((p) => p && ids.has(p.weekId)).length };
    if (tally.weeks + add.weeks > PEEK_CAPS.weeks || tally.games + add.games > PEEK_CAPS.games || tally.picks + add.picks > PEEK_CAPS.picks) { if (!keptSeasons.size) partial = true; break; }
    keptSeasons.add(se); tally.weeks += add.weeks; tally.games += add.games; tally.picks += add.picks;
  }
  const trimmed = !partial && keptSeasons.size < seasons.length;
  if (partial) weeks.length = 0; else if (trimmed) { const k = weeks.filter((w) => keptSeasons.has(seasonOf(w))); weeks.length = 0; weeks.push(...k); }
  const keep = new Set(weeks.map((w) => w.weekId));
  const publicWeek = new Set(weeks.filter((w) => PUBLIC.has(w.status)).map((w) => w.weekId));
  const games = arr(v.cfbp_games).filter((g) => g && keep.has(g.weekId));
  // Another member's pick survives only for a week the league has made public AND the reveal clock has confirmed. The viewer's own picks always survive.
  const picks = arr(v.cfbp_picks).filter((p) => p && keep.has(p.weekId) && (p.playerId === viewerMemberId || (publicWeek.has(p.weekId) && confirmed.has(p.weekId))));
  const results = arr(v.cfbp_results).filter((r) => r && keep.has(r.weekId) && weeks.find((w) => w.weekId === r.weekId).status === 'final' && confirmed.has(r.weekId));
  return {
    partial, trimmed,
    values: {
      cfbp_players: arr(v.cfbp_players), cfbp_weeks: weeks, cfbp_games: games, cfbp_picks: picks, cfbp_results: results,
      cfbp_competitions: arr(v.cfbp_competitions).filter((c) => c && !c.archivedAt), cfbp_competition_members: arr(v.cfbp_competition_members),
      cfbp_settings: v.cfbp_settings && typeof v.cfbp_settings === 'object' ? v.cfbp_settings : {}, cfbp_active_week: isStr(v.cfbp_active_week) && keep.has(v.cfbp_active_week) ? v.cfbp_active_week : null,
    },
  };
}

/**
 * @param {object} deps  ALL injected (the store reads no global):
 *   peekLeague(leagueId, { epoch }) -> Promise<peek>   js/supabase-backend.js peekLeague
 *   memberships() -> [{ leagueId, leagueName, memberId, role, pilot, status }] | null   null = not resolved (treated as ONE league: nothing is read, DI-801)
 *   activeLeagueId() -> string | null; accountId() -> string; identityEpoch() -> number
 *   now(), setTimer(fn, ms), clearTimer(h)   the clock and timers (tests drive them)
 *   onChange()      a peek landed / a league failed / the store was cleared: Home repaints
 *   onRefused(leagueId)   a read the server refused for a league the cache says the member is in: the app re-reads memberships (a removal is confirmed there)
 */
export function createPeekStore(deps = {}) {
  const peekLeague = fn(deps.peekLeague, null);
  if (!peekLeague) throw new TypeError('createPeekStore() requires an injected peekLeague function');
  const memberships = fn(deps.memberships, () => null);
  const activeLeagueId = fn(deps.activeLeagueId, () => null);
  const accountId = fn(deps.accountId, () => '');
  const identityEpoch = fn(deps.identityEpoch, () => 0);
  const now = fn(deps.now, () => Date.now());
  const setTimer = fn(deps.setTimer, null);
  const clearTimer = fn(deps.clearTimer, () => {});
  const onChange = fn(deps.onChange, () => {});
  const onRefused = fn(deps.onRefused, () => {});

  const entries = new Map();          // `${account}|${leagueId}` -> entry
  const recent = [];                  // league ids the session has had active, most recent first (memory only)
  let owner = null;                   // { account, epoch }
  let visible = false;
  let pollTimer = null;
  let requestLog = [];                // request timestamps (the device guard)
  let running = 0;
  const queue = [];

  const safe = (f, d) => { try { const v = f(); return v === undefined ? d : v; } catch { return d; } };
  const ownerNow = () => ({ account: String(safe(accountId, '') || ''), epoch: safe(identityEpoch, 0) });
  const keyOf = (o, leagueId) => `${o.account}|${leagueId}`;

  /** Every public call starts here: a different account or epoch is a different reader — everything of the previous one is forgotten at once. */
  function syncOwner() {
    const o = ownerNow();
    if (!owner || owner.account !== o.account || owner.epoch !== o.epoch) {
      const had = entries.size > 0;
      entries.clear(); queue.length = 0; recent.length = 0;
      owner = o;
      if (had) { try { onChange(); } catch { /* a repaint is a courtesy */ } }
    }
    return owner;
  }
  function membershipList() {
    const m = safe(memberships, null);
    return Array.isArray(m) ? m.filter((x) => x && isStr(x.leagueId)) : null;
  }
  const sigOf = (list) => (list ? list.map((m) => `${m.leagueId}:${m.memberId || ''}`).sort().join(',') : '');

  function noteActive() {
    const a = safe(activeLeagueId, null);
    if (!isStr(a)) return;
    const i = recent.indexOf(a);
    if (i !== 0) { if (i > 0) recent.splice(i, 1); recent.unshift(a); }
  }

  /** The leagues Home reads besides the active one (DI-801). An unresolved membership list, or one league, is nothing at all. */
  function targets() {
    const o = syncOwner();
    noteActive();
    const list = membershipList();
    const active = safe(activeLeagueId, null);
    // a league that is no longer a membership is dropped AT ONCE (its rows never paint again) — also when the member is down to one league
    if (list) {
      const ids = new Set(list.map((m) => m.leagueId));
      for (const k of [...entries.keys()]) { const lid = k.slice(k.indexOf('|') + 1); if (!ids.has(lid)) entries.delete(k); }
    }
    if (isStr(active)) entries.delete(keyOf(o, active));                     // the ACTIVE league lives in the mirror: no peek of it is kept (a later return to the list starts fresh)
    if (!list || list.length < 2 || !o.account) return Object.assign([], { overflow: 0 });
    const others = list.filter((m) => m.leagueId !== active);
    const rank = (m) => { const i = recent.indexOf(m.leagueId); return i === -1 ? Infinity : i; };
    const ordered = others.map((m, i) => ({ m, i })).sort((a, b) => (rank(a.m) - rank(b.m)) || (a.i - b.i)).map((x) => x.m);
    const cap = Math.max(0, HOME_LEAGUE_CAP - 1);
    return Object.assign(ordered.slice(0, cap), { overflow: Math.max(0, ordered.length - cap) });
  }

  function entryFor(leagueId) {
    const o = syncOwner();
    const k = keyOf(o, leagueId);
    if (!entries.has(k)) entries.set(k, { leagueId, status: 'idle', peek: null, filtered: null, prevPublic: null, confirmed: new Set(), fetchedAt: 0, lastAttemptAt: 0, lastManualAt: 0, failures: 0, hold: false, inFlight: false });
    return entries.get(k);
  }

  function guardAllows(t) {
    requestLog = requestLog.filter((x) => t - x < 60 * 1000);
    return requestLog.length + PEEK_REQUESTS_PER_READ <= PEEK_MAX_REQUESTS_PER_MIN;
  }
  function due(e, t, manual) {
    if (e.inFlight) return false;
    if (manual) return t - e.lastManualAt >= PEEK_MIN_INTERVAL_MS || e.lastManualAt === 0;
    if (e.hold) return false;
    if (t - e.lastAttemptAt < PEEK_MIN_INTERVAL_MS && e.lastAttemptAt !== 0) return false;
    if (e.failures > 0) return t - e.lastAttemptAt >= PEEK_BACKOFF_MS[Math.min(e.failures, PEEK_BACKOFF_MS.length) - 1];
    if (e.status === 'ready' || e.status === 'partial') return t - e.fetchedAt >= (wantsSoon(e) ? PEEK_POLL_LIVE_MS : PEEK_POLL_IDLE_MS) - 1000;
    return true;
  }

  async function readOne(m, manual) {
    const e = entryFor(m.leagueId);
    const t = now();
    e.inFlight = true; e.lastAttemptAt = t; if (manual) e.lastManualAt = t;
    if (e.status === 'idle') e.status = 'loading';
    const token = { ...owner, sig: sigOf(membershipList()) };
    let peek = null, error = null;
    try { peek = await peekLeague(m.leagueId, { epoch: token.epoch }); } catch (err) { error = err || new Error('peek failed'); }
    // the reservation made at enqueue was PEEK_REQUESTS_PER_READ: charge whatever more this read really sent (pages, re-reads), success or not
    const sent = Number((peek && peek.requests) ?? (error && error.requests));
    if (Number.isFinite(sent) && sent > PEEK_REQUESTS_PER_READ) requestLog.push(...Array(Math.min(sent - PEEK_REQUESTS_PER_READ, 1000)).fill(now()));
    // I6 — applied only if NOTHING moved while it was in flight: the account, the epoch, the membership set, and the league is still a membership
    const o = ownerNow();
    const list = membershipList();
    const still = !!list && list.some((x) => x.leagueId === m.leagueId);
    if (o.account !== token.account || o.epoch !== token.epoch || sigOf(list) !== token.sig || !still || !entries.has(keyOf(token, m.leagueId))) {
      e.inFlight = false;
      return;                                                                // discarded: no state change, no event
    }
    e.inFlight = false;
    if (error || !peek || peek.leagueId !== m.leagueId) {
      const refused = !!error && (error.httpStatus === 401 || error.httpStatus === 403 || error.pgCode === '42501');
      e.failures += 1;
      if (e.failures > PEEK_BACKOFF_MS.length) e.hold = true;
      if (refused) forget(e);                                                // security F3: an OUTRIGHT refusal ends what we hold, at once (the membership refresh only confirms it)
      else e.status = e.filtered ? 'ready' : (e.status === 'partial' ? 'partial' : 'failed');   // a network error keeps a good read (shown "as of"); a partial league stays partial (it holds nothing)
      if (refused) { try { onRefused(m.leagueId); } catch { /* the app's to confirm */ } }
      try { onChange(); } catch { /* a repaint is a courtesy */ }
      return;
    }
    const members = arr(peek.values && peek.values.cfbp_players);
    if (!members.length) {                                                   // a member always sees their own league's member rows: none = the server refused the league
      e.failures += 1; if (e.failures > PEEK_BACKOFF_MS.length) e.hold = true;
      forget(e);                                                             // security F3: refused — nothing of it is served from here on
      try { onRefused(m.leagueId); } catch { /* confirmed by the app's membership refresh */ }
      try { onChange(); } catch { /* courtesy */ }
      return;
    }
    const status = statusMap(peek.weekStatus);
    const nowPublic = new Set(Object.keys(status).filter((id) => PUBLIC.has(status[id])));
    const confirmed = new Set(e.prevPublic ? [...nowPublic].filter((id) => e.prevPublic.has(id)) : []);
    const f = filterPeek(peek, { viewerMemberId: m.memberId || null, confirmed });
    e.peek = { leagueId: m.leagueId, weekStatus: status, progress: peek.progress && typeof peek.progress === 'object' ? peek.progress : {}, readAt: peek.readAt || null };
    e.filtered = f.partial ? null : f.values;                                // security F3: an over-cap read is never held (nothing can serve it later)
    e.partialAt = f.partial ? now() : null;                                  // R1: when it was found too large (the line says so)
    e.prevPublic = nowPublic;
    e.confirmed = confirmed;
    e.fetchedAt = now();
    e.failures = 0; e.hold = false;
    e.status = f.partial ? 'partial' : 'ready';
    try { onChange(); } catch { /* courtesy */ }
  }

  /** Security F3: a refused league's rows, reveal clock and "as of" time are dropped; it reads as never loaded ("Couldn't load …"). */
  function forget(e) {
    e.filtered = null; e.peek = null; e.prevPublic = null; e.confirmed = new Set(); e.fetchedAt = 0; e.status = 'failed';
  }
  function pump() {
    while (running < PEEK_CONCURRENCY && queue.length) {
      const job = queue.shift();
      // the guard is asked AGAIN as the read starts (a read that landed meanwhile may have charged more than its reservation): over budget, the job is dropped, its reservation returned
      const t = now();
      requestLog = requestLog.filter((x) => t - x < 60 * 1000);
      if (requestLog.length > PEEK_MAX_REQUESTS_PER_MIN) {
        const i = requestLog.lastIndexOf(job.reservedAt);
        if (i !== -1) requestLog.splice(i - PEEK_REQUESTS_PER_READ + 1, PEEK_REQUESTS_PER_READ);
        const e = entries.get(keyOf(owner, job.m.leagueId)); if (e && e.status === 'loading' && !e.fetchedAt) e.status = 'idle';
        job.done();
        continue;
      }
      running++;
      readOne(job.m, job.manual).catch(() => {}).finally(() => { running--; job.done(); pump(); });
    }
  }

  /** Read every target that is due. Resolves when this round's reads have settled (Promise.allSettled discipline: one league's failure never blocks another). */
  function refresh({ manual = false } = {}) {
    const list = targets();
    const t = now();
    const waits = [];
    for (const m of list) {
      const e = entryFor(m.leagueId);
      if (!due(e, t, manual)) continue;
      if (queue.some((q) => q.m.leagueId === m.leagueId)) continue;
      if (!guardAllows(t)) break;                                            // the device guard (reservations included): the rest wait for the next round
      requestLog.push(...Array(PEEK_REQUESTS_PER_READ).fill(t));              // security F1: RESERVED now, so the next target in this round is checked against it
      if (e.status === 'idle') e.status = 'loading';
      waits.push(new Promise((resolve) => { queue.push({ m, manual, done: resolve, reservedAt: t }); }));
    }
    pump();
    if (!waits.length) schedule();
    // the next poll is decided by what THIS round brought back (a live game, a week waiting for its confirming read), so it is armed once the round has settled
    return Promise.allSettled(waits).then(() => { schedule(); return true; });
  }

  function hasLiveGame(e) {
    return !!(e && e.filtered && arr(e.filtered.cfbp_games).some((g) => g && g.status === 'live'));
  }
  /** Read again within a minute: a live game, or a week that went public in this read and still waits for the reveal clock's second read (DI-803: "at most 60 seconds"). */
  function wantsSoon(e) {
    if (hasLiveGame(e)) return true;
    return !!(e && e.prevPublic && [...e.prevPublic].some((id) => !e.confirmed.has(id)));
  }
  function schedule() {
    if (pollTimer !== null) { try { clearTimer(pollTimer); } catch { /* dead */ } pollTimer = null; }
    if (!visible || !setTimer) return;
    const list = targets();
    if (!list.length) return;
    const live = list.some((m) => wantsSoon(entries.get(keyOf(owner, m.leagueId))));
    pollTimer = setTimer(() => { pollTimer = null; if (visible) refresh({ manual: false }); }, live ? PEEK_POLL_LIVE_MS : PEEK_POLL_IDLE_MS);
  }
  /** Home visible (true) or hidden / backgrounded (false). Visible starts a round (cached results paint at once; due leagues read) and the poll; hidden stops the poll. */
  function setVisible(on) {
    if (on === true && visible) return Promise.resolve(false);                 // already visible: a repaint (a score tick) must not re-arm the poll and push it back
    visible = on === true;
    if (visible) return refresh({ manual: false });
    schedule();
    return Promise.resolve(false);
  }

  /** What Home may use for ONE peeked league, or null (not a target, never loaded, partial, or nothing usable). */
  function leagueView(leagueId) {
    const o = syncOwner();
    const list = membershipList();
    const m = list && list.find((x) => x.leagueId === leagueId);
    if (!m || leagueId === safe(activeLeagueId, null)) return null;
    const e = entries.get(keyOf(o, leagueId));
    if (!e || !e.filtered || e.status === 'partial') return null;
    const source = sourceFromPeek({ leagueId, values: e.filtered, viewerMemberId: m.memberId || null });
    if (!source) return null;
    const status = e.peek.weekStatus;
    const confirmed = new Set(e.confirmed);
    const progress = e.peek.progress;
    return {
      leagueId, leagueName: String(m.leagueName || ''), memberId: m.memberId || null, pilot: m.pilot === true, role: m.role || null, source,
      isPublic: (w) => !!w && PUBLIC.has(status[w.weekId] || ''),                      // THIS league's server-reported reveal (DI-811), never the active league's
      picksReadConfirmed: (weekId) => confirmed.has(weekId),
      weekProgress: () => ({ at: e.peek.readAt, weeks: progress }),
      confirmedStatusFor: (w) => (w && status[w.weekId]) || null,
      status: stateOf(e).status, asOf: e.fetchedAt || null, hasLive: hasLiveGame(e),
    };
  }
  function stateOf(e) {
    const t = now();
    if (!e) return { status: 'loading', asOf: null, hasLive: false };
    if (e.status === 'partial') return { status: 'partial', asOf: e.partialAt || null, hasLive: false };
    if (!e.fetchedAt) return { status: e.status === 'failed' ? 'never' : 'loading', asOf: null, hasLive: false };
    const live = hasLiveGame(e);
    if (e.failures >= 2 || (live && t - e.fetchedAt > PEEK_STALE_LIVE_MS)) return { status: 'stale', asOf: e.fetchedAt, hasLive: live };
    return { status: 'ready', asOf: e.fetchedAt, hasLive: live };
  }
  /** Per target league: its status for the calm failure lines (DI-804) — never a league silently omitted. */
  function states() {
    const o = syncOwner();
    const list = targets();
    return Object.assign(list.map((m) => ({ leagueId: m.leagueId, leagueName: String(m.leagueName || ''), ...stateOf(entries.get(keyOf(o, m.leagueId))) })), { overflow: list.overflow });
  }

  function clear() {
    entries.clear(); queue.length = 0; recent.length = 0; requestLog = [];
    if (pollTimer !== null) { try { clearTimer(pollTimer); } catch { /* dead */ } pollTimer = null; }
    owner = ownerNow();
    try { onChange(); } catch { /* courtesy */ }
  }

  /** peektest only: the store's shape, as plain data (never handed to the app). */
  function _dumpForTest() { return { owner, keys: [...entries.keys()], entries: [...entries.values()].map((e) => ({ ...e, confirmed: [...e.confirmed], prevPublic: e.prevPublic ? [...e.prevPublic] : null })), visible, pollArmed: pollTimer !== null, requests: requestLog.length }; }

  return { targets, refresh, setVisible, leagueView, states, clear, _dumpForTest };
}
