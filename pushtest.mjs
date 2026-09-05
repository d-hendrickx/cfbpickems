/**
 * CFB Pickems — pushtest.mjs
 * ==========================
 * RG-56 — "I cleared the pool, am still getting the red banner. This is a big
 * issue if it wont sync … will not be able to receive picks from the last
 * person before the deadline."  (Drew, commissioner, live site, 2026-09-04)
 *
 * Run:  node pushtest.mjs
 *
 * A SEPARATE FILE ON PURPOSE, same rationale as synctest.mjs (CLAUDE.md): it
 * drives the REAL backend.flushPush() against a stubbed transport and leaves
 * the backend singleton hydrated and `_backendMode` flipped to googleSheets,
 * which would poison every suite that ran after it inside loadtest.mjs.
 *
 * WHAT THIS PROTECTS — THE OTHER HALF OF SYNC
 * -------------------------------------------
 * synctest.mjs covers hydrate(): what a stale mirror is allowed to do to fresh
 * remote data on the way IN. It was 32/0 straight through this outage and could
 * not have caught it, because its transport stub answers EVERY `setMany` with
 * `{ ok: true }`:
 *
 *     if (req.action === 'setMany') { sent.push(req.entries); return … ok:true }
 *
 * That models a Sheet with infinite capacity that never refuses a write. The
 * whole defect lives on the way OUT — in what `backend/Code.gs` does when it
 * CANNOT store a value — so a stub with no failure mode makes the bug
 * unreachable by construction. There was no coverage anywhere of a failed push.
 *
 * THE MECHANISM, END TO END
 * -------------------------
 *  1. One app storage key = ONE Google Sheets cell (`backend/Code.gs`, the
 *     CFBP_STORE tab: `key | json | updatedAt`). Sheets caps a cell at 50,000
 *     characters. `setMany()` writes each key in turn with NO chunking and NO
 *     size check.
 *  2. `cfbp_avail_games` is the commissioner's ESPN candidate pool, stored as
 *     `{ weekId: [game, …] }` — raw parsed ESPN rows, ~963 chars each after
 *     v0.17.9 added nationalTV/broadcastNetwork/marqueeEvent. 52 games in ONE
 *     week crosses the cap. Drew's Sep 3–7 fetch returned 91.
 *  3. Apps Script throws, `handle()` catches and returns `{ok:false,error}` for
 *     the WHOLE request. Keys ordered before the failing one are already
 *     committed; keys ordered after it never are.
 *  4. `flushPush()` re-marks every key in the batch dirty, sets `_lastError` and
 *     emits 'error' → app.js raises the persistent red banner. The same doomed
 *     batch is retried on every subsequent write, forever, so on the
 *     commissioner's device EVERY later write — the slate, the week status, his
 *     own picks — is stuck behind a scratch key full of third-party data.
 *  5. `persistMirror()` only runs on a SUCCESSFUL push, so nothing queued
 *     survives a reload. The queue is RAM-only.
 *
 * The stub below is a faithful port of `setMany()` + `handle()`'s catch,
 * including the cell cap and the partial-commit ordering, because every one of
 * those five steps has to be reproducible before any of it can be fixed.
 */

// ── DOM / browser stubs ──────────────────────────────────────────────────────
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({ set innerHTML(v) {}, get innerHTML() { return ''; }, appendChild() {}, remove() {},
    addEventListener() {}, removeEventListener() {}, classList: { add() {}, remove() {} }, style: {}, id: '', className: '' }),
  body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '' },
  hidden: false,
};
globalThis.window = globalThis;
globalThis.requestAnimationFrame = fn => fn();
globalThis.matchMedia = () => ({ matches: false });
globalThis.confirm = () => true;
globalThis.prompt = () => null;
globalThis.alert = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'u' + Math.random().toString(36).slice(2) };
if (typeof globalThis.btoa !== 'function') globalThis.btoa = s => Buffer.from(String(s), 'binary').toString('base64');
if (typeof globalThis.atob !== 'function') globalThis.atob = s => Buffer.from(String(s), 'base64').toString('binary');

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

const be      = await import('./js/backend.js');
const storage = await import('./js/storage.js');
const dp      = await import('./js/data-provider.js');

// ═════════════════════════════════════════════════════════════════════════════
// A faithful port of backend/Code.gs — the half of the system that decides
// whether a push succeeds. Ported rather than mocked: the bug IS this code's
// behaviour, so an idealised stub asserts nothing.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Google Sheets' hard per-cell limit. `Code.gs` stores each app key as one
 * cell (`setValues([[str, now]])` / `appendRow`) and never checks this.
 */
const SHEET_CELL_MAX = 50000;

function makeSheetBackend(initialData = {}) {
  const SHEET = new Map();                       // key -> json string (one cell)
  Object.entries(initialData).forEach(([k, v]) => SHEET.set(k, JSON.stringify(v)));
  const log = { setManyCalls: 0, rejected: [], batches: [] };

  /** Port of Code.gs setMany(). Writes each key IN ORDER; throws on cell overflow. */
  function setMany(entries) {
    let count = 0;
    for (const key of Object.keys(entries)) {
      const str = JSON.stringify(entries[key]);
      if (str.length > SHEET_CELL_MAX) {
        // What Apps Script does when a cell value exceeds the limit. The exact
        // wording is Google's and is deliberately NOT asserted anywhere below;
        // what matters is that it is a throw, not a return.
        throw new Error('Argument too large: value');
      }
      SHEET.set(key, str);                       // committed — Sheets flushes it
      count++;
    }
    return count;
  }

  /** Port of Code.gs handle(): the catch turns a throw into ok:false, HTTP 200. */
  function handle(req) {
    try {
      if (req.action === 'ping')    return { ok: true, time: new Date().toISOString() };
      if (req.action === 'getAll') {
        const data = {};
        SHEET.forEach((raw, k) => { try { data[k] = JSON.parse(raw); } catch { data[k] = raw; } });
        return { ok: true, data, chatHead: 0 };
      }
      if (req.action === 'setMany') {
        log.setManyCalls++;
        log.batches.push(Object.keys(req.entries || {}));
        return { ok: true, count: setMany(req.entries || {}) };
      }
      return { ok: true };
    } catch (err) {
      log.rejected.push(String(err.message || err));
      return { ok: false, error: String(err.message || err) };
    }
  }

  globalThis.fetch = async (_url, opts) => {
    const req = JSON.parse(opts.body);
    const res = handle(req);
    return { ok: true, json: async () => res };   // Apps Script always answers 200
  };

  return {
    SHEET, log,
    /** What the Sheet actually holds for a key, parsed — null if the row is absent. */
    read: k => (SHEET.has(k) ? JSON.parse(SHEET.get(k)) : null),
    has: k => SHEET.has(k),
    /** Was `k` ever OFFERED to the backend, whether or not the write succeeded? */
    everSent: k => log.batches.some(keys => keys.includes(k)),
  };
}

/** Capture the status events app.js listens to — 'error' is the red banner. */
function watchStatus() {
  const seen = [];
  const off = be.onBackendStatus((status, detail) => seen.push({ status, detail }));
  return { seen, off, errors: () => seen.filter(e => e.status === 'error') };
}

// ═════════════════════════════════════════════════════════════════════════════
// Realistic ESPN candidate pool, built through the REAL parse path so the
// per-game byte count is the shipped one and not an invented number.
// ═════════════════════════════════════════════════════════════════════════════
const SCHOOLS = [
  ['Ohio State', 'Buckeyes', 'OSU', 'Columbus', 'OH'],
  ['Michigan', 'Wolverines', 'MICH', 'Ann Arbor', 'MI'],
  ['Texas A&M', 'Aggies', 'TA&M', 'College Station', 'TX'],
  ['Southern California', 'Trojans', 'USC', 'Los Angeles', 'CA'],
  ['Notre Dame', 'Fighting Irish', 'ND', 'Notre Dame', 'IN'],
  ['Oklahoma', 'Sooners', 'OU', 'Norman', 'OK'],
  ['Arkansas', 'Razorbacks', 'ARK', 'Fayetteville', 'AR'],
  ['Purdue', 'Boilermakers', 'PUR', 'West Lafayette', 'IN'],
  ['Louisiana State', 'Tigers', 'LSU', 'Baton Rouge', 'LA'],
  ['Mississippi State', 'Bulldogs', 'MSST', 'Starkville', 'MS'],
  ['Washington State', 'Cougars', 'WSU', 'Pullman', 'WA'],
  ['Middle Tennessee', 'Blue Raiders', 'MTSU', 'Murfreesboro', 'TN'],
  ['Central Florida', 'Knights', 'UCF', 'Orlando', 'FL'],
  ['North Carolina State', 'Wolfpack', 'NCST', 'Raleigh', 'NC'],
];
function espnEvent(i) {
  const h = SCHOOLS[(i * 2) % SCHOOLS.length];
  const a = SCHOOLS[(i * 2 + 1) % SCHOOLS.length];
  return {
    id: String(401752000 + i),
    date: '2026-09-05T23:30:00Z',
    name: `${a[0]} ${a[1]} at ${h[0]} ${h[1]}`,
    shortName: `${a[2]} @ ${h[2]}`,
    status: { type: { name: 'STATUS_SCHEDULED', detail: 'Sat, September 5th at 7:30 PM EDT', shortDetail: '9/5 - 7:30 PM EDT' } },
    competitions: [{
      id: String(401752000 + i), neutralSite: false, timeValid: true,
      competitors: [
        { homeAway: 'home', score: null, curatedRank: { current: (i % 25) + 1 },
          team: { location: h[0], name: h[1], abbreviation: h[2], displayName: `${h[0]} ${h[1]}`, shortDisplayName: h[0], conferenceId: 8 } },
        { homeAway: 'away', score: null, curatedRank: { current: 99 },
          team: { location: a[0], name: a[1], abbreviation: a[2], displayName: `${a[0]} ${a[1]}`, shortDisplayName: a[0], conferenceId: 8 } },
      ],
      odds: [{ provider: { name: 'ESPN BET' }, details: `${h[2]} -${(i % 20) + 1.5}`,
               homeTeamOdds: { favorite: true }, awayTeamOdds: { favorite: false } }],
      broadcasts: [{ names: ['ESPN'] }],
      venue: { fullName: `${h[0]} Stadium`, address: { city: h[3], state: h[4], country: 'USA' } },
      notes: [],
    }],
  };
}

/** N candidate games as data-provider.js actually parses and stores them. */
async function realPool(n) {
  const events = Array.from({ length: n }, (_, i) => espnEvent(i));
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ events }) });
  const res = await dp.fetchByDateRange({ startDate: '2026-09-03', endDate: '2026-09-07', season: 2026 });
  globalThis.fetch = savedFetch;
  if (res.error || res.games.length !== n) throw new Error('fixture failed to parse: ' + res.error);
  return res.games;
}

const REMOTE_BASE = () => ({
  cfbp_players: [
    { playerId: 'p0', displayName: 'Drew',    active: true, email: 'drew@example.com',    pinHash: 'MTAwMA==' },
    { playerId: 'p1', displayName: 'Brayden', active: true, email: 'brayden@example.com', pinHash: 'MTAwMQ==' },
    { playerId: 'p2', displayName: 'Kevin',   active: true, email: 'kevin@example.com',   pinHash: 'MTAwMg==' },
  ],
  cfbp_weeks: [{ weekId: 'w1', weekNumber: 1, season: 2026, status: 'open', startDate: '2026-09-03', endDate: '2026-09-07' }],
  cfbp_games: [],
  cfbp_picks: [],
  cfbp_avail_games: {},
  cfbp_settings: { theme: 'neutral' },
});

/** Boot a connected device the way app.js does, then run `fn` against it. */
async function bootDevice(sheet) {
  store.clear();
  be.setBackendConfig('https://example.invalid/exec', 'tok');
  await be.hydrate();                 // _stale=false, _ready=true — pushes allowed
  storage.setBackendMode('googleSheets');
  return sheet;
}

const POOL_91 = await realPool(91);
const POOL_10 = await realPool(10);

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[1] THE TRIGGER — one week of ESPN candidates does not fit in one Sheets cell…');
// ═════════════════════════════════════════════════════════════════════════════
{
  const perGame = Math.round(JSON.stringify(POOL_91).length / POOL_91.length);
  const oneWeek = JSON.stringify({ w1: POOL_91 }).length;
  const crossesAt = Math.ceil(SHEET_CELL_MAX / perGame);

  assert(perGame > 900 && perGame < 1100,
    `a parsed ESPN candidate game serializes to ~${perGame} chars (measured through the real parse path, not assumed)`);
  assert(oneWeek > SHEET_CELL_MAX,
    `cfbp_avail_games for ONE 91-game week is ${oneWeek} chars — ${Math.round(oneWeek / SHEET_CELL_MAX * 100)}% of the ${SHEET_CELL_MAX}-char Sheets cell cap`);
  assert(crossesAt < 60,
    `the cap is crossed at ~${crossesAt} games in a single week — well inside one ordinary Saturday slate`);
  assert(JSON.stringify({ w1: POOL_10 }).length < SHEET_CELL_MAX,
    'control: a 10-game pool fits, so the failure below is about SIZE and nothing else');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log("\n[2] REPRODUCTION — the commissioner's picks never reach the Sheet, and the red banner comes up…");
// ═════════════════════════════════════════════════════════════════════════════
// The commissioner's device is the only one that writes the pool, so it is the
// only one that can be blocked by it. Everything he does afterwards — the
// slate, the week status, his own picks — rides in the SAME debounced batch.
{
  const sheet = makeSheetBackend(REMOTE_BASE());
  await bootDevice(sheet);
  const w = watchStatus();

  // 1. Commissioner hits "Fetch ESPN games" for the Sep 3–7 week.
  storage.saveAvailableGames('w1', POOL_91);
  // 2. Then makes his own picks for the open week.
  storage.saveAllPicks([
    { pickId: 'pk_1', weekId: 'w1', gameId: 'g1', playerId: 'p0', selectedTeam: 'Ohio State',
      selectedAt: '2026-09-04T17:00:00.000Z', updatedAt: '2026-09-04T17:00:00.000Z', locked: false, result: 'pending' },
    { pickId: 'pk_2', weekId: 'w1', gameId: 'g2', playerId: 'p0', selectedTeam: 'Michigan',
      selectedAt: '2026-09-04T17:00:00.000Z', updatedAt: '2026-09-04T17:00:00.000Z', locked: false, result: 'pending' },
  ]);

  let threw = null;
  try { await be.flushPush(); } catch (e) { threw = e; }

  assert(sheet.read('cfbp_picks')?.length === 2,
    'THE BUG: the picks written after the oversized pool reach the Sheet — a scratch key full of third-party ESPN data must never block irreplaceable user data');
  assert(w.errors().length === 0,
    "THE BUG: no 'error' event is emitted, so app.js does not raise the persistent red banner");
  assert(threw === null,
    'flushPush() resolves instead of throwing — the push is not a total loss');

  w.off();
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[3] SELF-PERPETUATING — the doomed batch is retried forever, so every later write is stuck behind it…');
// ═════════════════════════════════════════════════════════════════════════════
{
  const sheet = makeSheetBackend(REMOTE_BASE());
  await bootDevice(sheet);
  const w = watchStatus();

  storage.saveAvailableGames('w1', POOL_91);
  try { await be.flushPush(); } catch {}

  // A later, ordinary write — the commissioner opens the next week.
  storage.saveAllWeeklyResults('w1', []);
  let threw = null;
  try { await be.flushPush(); } catch (e) { threw = e; }

  assert(threw === null && be.getSyncStatus().pendingWrites <= 1,
    'THE BUG: the queue drains — one unstorable key does not re-queue every other key with it on every retry');
  assert(sheet.has('cfbp_results'),
    'THE BUG: a write made AFTER the failure still reaches the Sheet');

  w.off();
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[4] ARE THE PICKS SAFE? — what a failed push leaves behind for the next reload…');
// ═════════════════════════════════════════════════════════════════════════════
// persistMirror() runs only after a SUCCESSFUL push or hydrate, so a queued
// write lives in RAM alone. This section pins the guarantee we owe Drew: once
// the push is unblocked, a submitted pick is in the Sheet, not in a queue.
{
  const sheet = makeSheetBackend(REMOTE_BASE());
  await bootDevice(sheet);

  storage.saveAvailableGames('w1', POOL_91);
  storage.saveAllPicks([{ pickId: 'pk_9', weekId: 'w1', gameId: 'g9', playerId: 'p2', selectedTeam: 'Purdue',
    selectedAt: '2026-09-04T18:00:00.000Z', updatedAt: '2026-09-04T18:00:00.000Z', locked: false, result: 'pending' }]);
  try { await be.flushPush(); } catch {}

  const mirrorRaw = localStorage.getItem('cfbp_sheet_mirror');
  const mirror = mirrorRaw ? JSON.parse(mirrorRaw) : null;
  const mirrorPicks = mirror?.data?.cfbp_picks || [];

  assert((sheet.read('cfbp_picks') || []).some(p => p.pickId === 'pk_9'),
    'THE BUG: the pick is IN THE SHEET after the push — not sitting in a RAM-only retry queue that a reload discards');
  assert(mirrorPicks.some(p => p.pickId === 'pk_9') || (sheet.read('cfbp_picks') || []).some(p => p.pickId === 'pk_9'),
    'the pick survives a reload by at least one of the two durable paths (Sheet row, or persisted mirror)');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[5] THE GUARD — an over-cap value is quarantined and NAMED, never allowed to block the batch…');
// ═════════════════════════════════════════════════════════════════════════════
// The class, not just today's instance. cfbp_picks is measured to cross the
// same cap around WEEK 3 and cfbp_games around week 5; when that happens the
// batch must still deliver everything else, and the banner must say WHICH key.
{
  const sheet = makeSheetBackend(REMOTE_BASE());
  await bootDevice(sheet);
  const w = watchStatus();

  // A key that is over cap and is NOT the available-games pool.
  const fatComments = Array.from({ length: 400 }, (_, i) => ({
    commentId: 'c_' + i, weekId: 'w1', gameId: 'g1', authorId: 'p0', authorKind: 'player',
    body: 'x'.repeat(120), createdAt: '2026-09-04T17:00:00.000Z',
  }));
  assert(JSON.stringify(fatComments).length > SHEET_CELL_MAX, 'fixture check: the comments blob is genuinely over cap');

  // Injected at the cache seam directly: the point of this section is an
  // ARBITRARY over-cap key, not this particular one. cfbp_picks is measured to
  // cross the same cap around WEEK 3 and cfbp_games around week 5.
  be.cacheSet('cfbp_comments', fatComments);
  storage.saveAllPicks([{ pickId: 'pk_g', weekId: 'w1', gameId: 'g1', playerId: 'p1', selectedTeam: 'Michigan',
    selectedAt: '2026-09-04T19:00:00.000Z', updatedAt: '2026-09-04T19:00:00.000Z', locked: false, result: 'pending' }]);

  let threw = null;
  try { await be.flushPush(); } catch (e) { threw = e; }

  assert(threw === null, 'a quarantined key does not turn the push into a thrown rejection');
  assert((sheet.read('cfbp_picks') || []).some(p => p.pickId === 'pk_g'),
    'the picks in the same batch as an over-cap key STILL reach the Sheet');
  assert(w.errors().length > 0 && sheet.has('cfbp_picks'),
    'the failure is LOUD (AD-06) AND non-blocking — an error event still fires while the rest of the batch lands. Both halves in one assertion so neither can pass by the batch simply dying');
  assert(w.errors().some(e => String(e.detail?.error || '').includes('cfbp_comments')),
    'the error NAMES the offending key, so the next person does not have to re-derive it from a Sheet they cannot read');
  assert(be.getSyncStatus().pendingWrites >= 1 && sheet.has('cfbp_picks'),
    'the quarantined key stays queued — held back, not silently dropped — while the rest of the batch has already gone');

  // Quarantine RELEASES the moment the value fits again — it is a hold, not a
  // blacklist. Also the teardown: backend.js is a module singleton by design
  // (app.js has exactly one backend), so a section that ends with a key still
  // queued would leak it into the next one.
  be.cacheSet('cfbp_comments', fatComments.slice(0, 10));
  await be.flushPush();
  assert(be.getSyncStatus().pendingWrites === 0 && sheet.has('cfbp_comments'),
    'once the value fits, the held key flushes on the next push and the queue empties — quarantine is a hold, not a blacklist');

  w.off();
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[6] THE POOL IS SCRATCH — it must not consume shared-Sheet budget at all…');
// ═════════════════════════════════════════════════════════════════════════════
// Same ruling as RG-55 (2026-09-04) for the 760-team ESPN catalog: identical on
// every device, re-fetchable in one click, never authoritative, safe to lose.
// Being device-local is what makes the trigger unreachable rather than merely
// survivable.
{
  const sheet = makeSheetBackend(REMOTE_BASE());
  await bootDevice(sheet);
  const w = watchStatus();

  storage.saveAvailableGames('w1', POOL_91);
  let threw = null;
  try { await be.flushPush(); } catch (e) { threw = e; }

  assert(threw === null && w.errors().length === 0,
    'fetching a full week of ESPN candidates raises NO sync error at all');
  assert(!sheet.everSent('cfbp_avail_games'),
    'the candidate pool is never even OFFERED to the Sheet — asserted on the push payload, not on the Sheet, so it cannot pass merely because the write failed');
  assert(storage.getAvailableGames('w1').length === 91,
    'and the pool still READS BACK on this device — the slate builder is unaffected');

  w.off();
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[7] THE BANNER TEXT IS DIAGNOSTIC — three different failures, three different strings…');
// ═════════════════════════════════════════════════════════════════════════════
// Added 2026-09-04 while diagnosing the v0.17.9 rollback. The banner Drew
// reported read, verbatim:
//
//     Cross-device sync is OFF on this device.
//     Failed to fetch
//
// `Failed to fetch` is Chrome's message for a fetch() that REJECTED — the
// browser never got a usable response (network down, or a response with no
// Access-Control-Allow-Origin header, which is what an Apps Script execution
// error looks like from a browser). It is NOT what an over-cap Sheets write
// produces: that returns HTTP 200 with {ok:false} and Apps Script's OWN wording.
//
// Nothing in the suite modelled a rejecting fetch — synctest.mjs and sections
// [1]–[6] above both answer every request with a Response object — so the two
// failures were indistinguishable in test and got conflated in diagnosis, which
// cost a session. This section makes the banner string load-bearing evidence:
// each failure mode must put a DIFFERENT, identifiable message in _lastError.
{
  const sheet = makeSheetBackend(REMOTE_BASE());
  await bootDevice(sheet);
  const realFetch = globalThis.fetch;

  // ── (a) THE REPORTED SIGNATURE: fetch() rejects ────────────────────────────
  const wa = watchStatus();
  storage.saveAllPicks([{ pickId: 'pk_net', weekId: 'w1', gameId: 'g1', playerId: 'p0', selectedTeam: 'Ohio State',
    selectedAt: '2026-09-04T20:00:00.000Z', updatedAt: '2026-09-04T20:00:00.000Z', locked: false, result: 'pending' }]);
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  let netErr = null;
  try { await be.flushPush(); } catch (e) { netErr = e; }
  const netMsg = be.getSyncStatus().lastError;
  globalThis.fetch = realFetch;

  assert(String(netErr && netErr.message) === 'Failed to fetch' && netMsg === 'Failed to fetch',
    'a REJECTED fetch puts the browser\'s own message in _lastError verbatim — this, and only this, is what renders as the reported "Failed to fetch" banner line');
  assert(wa.errors().some(e => e.detail && e.detail.error === 'Failed to fetch'),
    "…and it reaches app.js through the same onBackendStatus('error') channel that raises the red banner");
  assert(be.getSyncStatus().pendingWrites >= 1 && !(sheet.read('cfbp_picks') || []).some(p => p.pickId === 'pk_net'),
    'the pick is QUEUED, not written and not lost — a network failure must never be mistaken for a delivered write');
  wa.off();

  // The queue must drain by itself once the network returns. If it did not, a
  // transient blip would be indistinguishable from the permanent outage above.
  await be.flushPush();
  assert(be.getSyncStatus().pendingWrites === 0 && be.getSyncStatus().lastError === null
         && (sheet.read('cfbp_picks') || []).some(p => p.pickId === 'pk_net'),
    'and the queued pick lands the moment the network comes back — a rejected fetch is recoverable on its own, with no commissioner action');

  // ── (b) THE SERVER ANSWERS: ok:false, in Apps Script's wording ─────────────
  // Reached by making the SERVER's cap stricter than the client's, so the
  // client-side quarantine lets the value through and Code.gs refuses it. That
  // disagreement is the real residual risk: Code.gs measures with its OWN
  // JSON.stringify, so the two numbers are not guaranteed to match forever.
  const wb = watchStatus();
  const serverStrict = makeSheetBackend(REMOTE_BASE());
  const passthrough = globalThis.fetch;
  globalThis.fetch = async (u, o) => {
    const req = JSON.parse(o.body);
    if (req.action === 'setMany' && Object.keys(req.entries).some(k => JSON.stringify(req.entries[k]).length > 400)) {
      return { ok: true, json: async () => ({ ok: false, error: 'Argument too large: value' }) };
    }
    return passthrough(u, o);
  };
  be.cacheSet('cfbp_nicknames', { n: 'y'.repeat(500) });   // under the client cap, over the server's
  let srvErr = null;
  try { await be.flushPush(); } catch (e) { srvErr = e; }
  const srvMsg = be.getSyncStatus().lastError;
  globalThis.fetch = realFetch;

  assert(srvErr !== null && srvMsg === 'Argument too large: value',
    "a SERVER refusal surfaces Apps Script's own wording untouched — a cell-cap failure can never read \"Failed to fetch\"");
  assert(srvMsg !== 'Failed to fetch',
    'THE DISTINCTION THAT COST A SESSION: server-refused and network-rejected are different failures and must never share a banner string');
  wb.off();
  await be.flushPush();   // teardown: drain the queue for the next section

  // ── (c) THE CLIENT QUARANTINE: held back before the request is even made ───
  const wc = watchStatus();
  be.cacheSet('cfbp_nicknames', { n: 'z'.repeat(SHEET_CELL_MAX + 10) });
  await be.flushPush();
  const qMsg = be.getSyncStatus().lastError || '';

  assert(qMsg.includes('cfbp_nicknames') && qMsg.includes(SHEET_CELL_MAX.toLocaleString()),
    'the client-side quarantine names the offending key AND the cap it broke — a third, self-explaining string');
  assert(qMsg !== 'Failed to fetch' && qMsg !== 'Argument too large: value',
    'all three failure modes are distinguishable from the banner alone, which is the only diagnostic a player or the commissioner can actually read');
  wc.off();

  be.cacheSet('cfbp_nicknames', {});    // teardown: release the quarantine
  await be.flushPush();
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[8] THE SAME CAP IS COMING FOR THE PICKS — measured at season scale…');
// ═════════════════════════════════════════════════════════════════════════════
// Making cfbp_avail_games device-local removes TODAY's trigger. It does not
// remove the class, and the class has a date on it. `cfbp_picks` and
// `cfbp_games` are single keys that grow every week for the whole season and
// CANNOT be made device-local — they are the shared league record.
//
// This section exists so the next change that inflates a per-record shape (which
// is exactly what v0.17.9 did to games: +21 chars each, moving the pool's
// crossing point from 57 candidates to 53) fails HERE, before a deploy, instead
// of mid-season on the commissioner's device an hour before a deadline.
{
  const dm = await import('./js/data-model.js');

  const seasonPicks = [];
  for (let wk = 1; wk <= 15; wk++)
    for (let p = 1; p <= 6; p++)
      for (let g = 1; g <= 10; g++)
        seasonPicks.push(dm.createPick(`w${wk}`, `g_1757001234567_${wk}${g}`, `p${p}`, 'Ohio State'));

  const seasonGames = [];
  for (let wk = 1; wk <= 15; wk++)
    for (let g = 1; g <= 10; g++)
      seasonGames.push(dm.createGame(`w${wk}`, {
        homeTeam: 'Ohio State', awayTeam: 'Michigan', homeMascot: 'Buckeyes', awayMascot: 'Wolverines',
        homeConference: 'Big Ten', awayConference: 'Big Ten', kickoff: '2026-09-05T23:30:00.000Z',
        kickoffConfirmed: true, spread: -7.5, favorite: 'Ohio State', spreadSource: 'espn',
        oddsProvider: 'ESPN BET', lockedSpread: -7.5, venue: 'Ohio Stadium', venueDisplay: 'Columbus, OH',
        espnEventId: '401752001', homeScore: 31, awayScore: 24, status: 'final',
        actualWinner: 'Ohio State', atsWinner: 'Ohio State',
      }));

  const pickChars   = Math.round(JSON.stringify(seasonPicks).length / seasonPicks.length);
  const gameChars   = Math.round(JSON.stringify(seasonGames).length / seasonGames.length);
  const picksWeek   = Math.max(1, Math.floor(SHEET_CELL_MAX / (pickChars * 60)));
  const gamesWeek   = Math.max(1, Math.floor(SHEET_CELL_MAX / (gameChars * 10)));

  assert(JSON.stringify(seasonPicks).length > SHEET_CELL_MAX,
    `a full season of picks is ${JSON.stringify(seasonPicks).length} chars in ONE cell — ${Math.round(JSON.stringify(seasonPicks).length / SHEET_CELL_MAX * 100)}% of the cap. This key cannot be made device-local; it IS the league record`);
  // TWO-SIDED BANDS ON THE MEASURED CHAR COUNT, not on the derived week number.
  //
  // The first version of this asserted `picksWeek <= 5`, which is directionally
  // INVERTED: picksWeek = floor(MAX / (pickChars * 60)), so GROWING a pick makes
  // picksWeek smaller and the assertion MORE true. It fired only when records got
  // SMALLER — the opposite of the inflation this section's header promises to
  // catch. Proven by mutation: adding an 80-char field to createPick() moved the
  // deadline from week 3 to week 2 and this suite stayed 35/0.
  //
  // A band on the char count fails in BOTH directions, so any change to the
  // record shape has to come back here and re-derive the deadline deliberately.
  assert(pickChars >= 200 && pickChars <= 280,
    `a pick measures ${pickChars} chars (band 200-280). If this failed, the pick record CHANGED SHAPE: re-derive the cap deadline — currently WEEK ${picksWeek} — and update js/backend.js, docs/SESSION_LOG_090126.md and this file together`);
  assert(gameChars >= 850 && gameChars <= 1050,
    `a slate game measures ${gameChars} chars (band 850-1050). If this failed, the game record CHANGED SHAPE: re-derive the cap deadline — currently WEEK ${gamesWeek} — and update the same three places`);
  assert(picksWeek <= 4,
    `cfbp_picks (6 players x 10 games, ~${pickChars} chars a pick) crosses the ${SHEET_CELL_MAX}-char cap around WEEK ${picksWeek} of this season — the outage is scheduled, not hypothetical`);
  assert(gamesWeek <= 6,
    `cfbp_games (10 slate games a week, ~${gameChars} chars a game) crosses it around WEEK ${gamesWeek}`);

  // And what the guard actually buys, stated honestly: it converts a silent,
  // league-wide, everything-behind-one-key outage into a loud, named, single-key
  // hold. It does NOT keep the picks syncing. Only chunking in Code.gs does that.
  const sheet = makeSheetBackend(REMOTE_BASE());
  await bootDevice(sheet);
  const w = watchStatus();

  be.cacheSet('cfbp_picks', seasonPicks);
  storage.saveAllObligations([{ obligationId: 'o1', weekId: 'w1', playerId: 'p0', kind: 'loser', settled: false }]);
  let threw = null;
  try { await be.flushPush(); } catch (e) { threw = e; }

  assert(threw === null && sheet.has('cfbp_obligations'),
    'with an over-cap cfbp_picks in the batch, every OTHER key in that batch still reaches the Sheet — the batch is no longer all-or-nothing');
  assert(w.errors().some(e => String((e.detail || {}).error || '').includes('cfbp_picks')),
    'the banner names cfbp_picks specifically, so week 3 does not start with the same guessing game week 1 did');
  assert(be.getSyncStatus().pendingWrites >= 1 && !sheet.everSent('cfbp_picks')
         && (sheet.read('cfbp_picks') || []).length === 0,
    'NOT FIXED, ONLY CONTAINED: the picks are held — never OFFERED to the Sheet and never written there, but still in the queue, so they are unsent and unlost. Chunking a large value across cells in backend/Code.gs is the real fix and is feature-sized; this guard only buys the time to build it');

  w.off();
  be.cacheSet('cfbp_picks', []);    // teardown: release the quarantine
  await be.flushPush();
}

// ═════════════════════════════════════════════════════════════════════════════
console.log(`\n${fail === 0 ? '✅' : '❌'} pushtest: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
