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
 *
 * UPDATE 2026-09-05 (Item CAP): the server half of the fix is now deployed —
 * `backend/Code.gs` CHUNKS a single over-cap value transparently across as many
 * 50,000-char cells as it needs and reassembles it on read. The stub's setMany
 * below models that upgrade (it chunks instead of throwing), so this suite now
 * proves the OTHER half: that the client stops quarantining an ordinary
 * season-scale `cfbp_picks` and lets it ride to the now-capable backend. The
 * per-cell 50,000 limit is still real (that is why chunking exists); it is just
 * no longer the binding ceiling on a single app key. See section [8].
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

import { readFile } from 'node:fs/promises';

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
 * Google Sheets' hard PER-CELL limit — still 50,000 chars. `Code.gs` stores an
 * app key across one OR MORE cells: since the Item CAP chunking upgrade a value
 * larger than one cell is split across several cells and reassembled on read, so
 * this limit no longer caps a single app key. It is modelled here (the stub
 * chunks at exactly this boundary) so the size FACTS in section [1] and the
 * chunk math in [8] stay honest about what one cell holds.
 */
const SHEET_CELL_MAX = 50000;

/** Split a string into ≤ SHEET_CELL_MAX-char pieces — how Code.gs fills cells. */
function toCells(str) {
  const parts = [];
  for (let i = 0; i < str.length; i += SHEET_CELL_MAX) parts.push(str.slice(i, i + SHEET_CELL_MAX));
  return parts.length ? parts : [''];
}

function makeSheetBackend(initialData = {}) {
  const SHEET = new Map();                       // key -> array of cell strings (chunked)
  Object.entries(initialData).forEach(([k, v]) => SHEET.set(k, toCells(JSON.stringify(v))));
  const log = { setManyCalls: 0, rejected: [], batches: [] };

  /**
   * Port of Code.gs setMany() AFTER the chunking upgrade: each value is written
   * across as many 50,000-char cells as it needs and reassembled on read. It no
   * longer THROWS on an over-cap value — transparently storing a large value is
   * the entire point of the deployed server change this client half completes.
   */
  function setMany(entries) {
    let count = 0;
    for (const key of Object.keys(entries)) {
      SHEET.set(key, toCells(JSON.stringify(entries[key])));   // chunked, committed
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
        SHEET.forEach((cells, k) => { const raw = cells.join(''); try { data[k] = JSON.parse(raw); } catch { data[k] = raw; } });
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
    /** What the Sheet actually holds for a key, parsed (chunks rejoined) — null if absent. */
    read: k => (SHEET.has(k) ? JSON.parse(SHEET.get(k).join('')) : null),
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
console.log('\n[5] THE GUARD — a PATHOLOGICAL (runaway) value is quarantined and NAMED, never allowed to block the batch…');
// ═════════════════════════════════════════════════════════════════════════════
// DEFENCE-IN-DEPTH, POST-CHUNKING. Ordinary large keys (a full season of
// cfbp_picks, a week of cfbp_games) now CHUNK through to the Sheet — see [8].
// The quarantine no longer fires for them. What it still catches is a value so
// large it can only be a runaway (an unbounded append, a serialization loop):
// above the client's TOTAL-PAYLOAD ceiling (backend.js SHEET_CELL_MAX). When
// that happens the batch must still deliver everything else, and the banner must
// say WHICH key. This is the RG-56 loud-fail, preserved.
{
  const sheet = makeSheetBackend(REMOTE_BASE());
  await bootDevice(sheet);
  const w = watchStatus();

  // A key that is over the CLIENT RUNAWAY CEILING and is NOT the games pool.
  // Sized deliberately past be.SHEET_CELL_MAX so it can only be a defect, not
  // legitimate league data.
  const bodyLen = Math.ceil(be.SHEET_CELL_MAX / 300) + 100;   // ~300 comments clears the ceiling
  const fatComments = Array.from({ length: 300 }, (_, i) => ({
    commentId: 'c_' + i, weekId: 'w1', gameId: 'g1', authorId: 'p0', authorKind: 'player',
    body: 'x'.repeat(bodyLen), createdAt: '2026-09-04T17:00:00.000Z',
  }));
  assert(JSON.stringify(fatComments).length > be.SHEET_CELL_MAX,
    'fixture check: the comments blob is genuinely past the client runaway ceiling');

  // Injected at the cache seam directly: the point of this section is an
  // ARBITRARY runaway key, not this particular one.
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
  // A value past the CLIENT runaway ceiling (backend.js SHEET_CELL_MAX), so the
  // client holds it before the request — the third, distinct failure string.
  const wc = watchStatus();
  be.cacheSet('cfbp_nicknames', { n: 'z'.repeat(be.SHEET_CELL_MAX + 10) });
  await be.flushPush();
  const qMsg = be.getSyncStatus().lastError || '';

  assert(qMsg.includes('cfbp_nicknames') && qMsg.includes(be.SHEET_CELL_MAX.toLocaleString()),
    'the client-side quarantine names the offending key AND the ceiling it broke — a third, self-explaining string');
  assert(qMsg !== 'Failed to fetch' && qMsg !== 'Argument too large: value',
    'all three failure modes are distinguishable from the banner alone, which is the only diagnostic a player or the commissioner can actually read');
  wc.off();

  be.cacheSet('cfbp_nicknames', {});    // teardown: release the quarantine
  await be.flushPush();
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[8] THE PICKS OUTGROW ONE CELL — and the chunking backend now SYNCS them anyway…');
// ═════════════════════════════════════════════════════════════════════════════
// `cfbp_picks` and `cfbp_games` are single keys that grow every week for the
// whole season and CANNOT be made device-local — they are the shared league
// record. cfbp_picks crosses the 50,000-char PER-CELL limit around week 3.
//
// Before Item CAP that scheduled an outage: the client quarantined the over-cap
// picks, so they never reached the Sheet and a red banner went up mid-season an
// hour before a deadline. Now backend/Code.gs chunks a single value across
// cells, so the correct behaviour INVERTED: an ordinary season-scale cfbp_picks
// must be SENT (offered to the backend, not deleted from the batch) and must
// ROUND-TRIP. The quarantine is reserved for a genuinely pathological runaway
// value above the client's TOTAL-PAYLOAD ceiling — asserted at the end.
//
// This section still fails HERE, before a deploy, if a change inflates a
// per-record shape (v0.17.9 did exactly that to games: +21 chars each): the
// two-sided char-count bands below force a deliberate re-derivation, and the
// headroom assertion fires if cfbp_picks ever approaches the runaway ceiling.
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
  const seasonPicksChars = JSON.stringify(seasonPicks).length;

  assert(seasonPicksChars > SHEET_CELL_MAX,
    `a full season of picks is ${seasonPicksChars} chars — ${Math.round(seasonPicksChars / SHEET_CELL_MAX * 100)}% of ONE 50,000-char cell, so it MUST be chunked across cells. This key cannot be made device-local; it IS the league record`);
  // TIES THE TEST TO THE CLIENT CEILING: a full season of picks must sit well
  // under backend.js SHEET_CELL_MAX (the runaway tripwire), with generous
  // headroom. If this fails, cfbp_picks is nearing the ceiling and would start
  // quarantining LIVE picks — raise the ceiling deliberately or shard the key.
  assert(seasonPicksChars < be.SHEET_CELL_MAX / 2,
    `a full season of picks (${seasonPicksChars} chars) is under half the ${be.SHEET_CELL_MAX.toLocaleString()}-char client runaway ceiling — ${(be.SHEET_CELL_MAX / seasonPicksChars).toFixed(1)}x headroom`);
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
    `a pick measures ${pickChars} chars (band 200-280). If this failed, the pick record CHANGED SHAPE: re-derive where chunking begins — currently ~WEEK ${picksWeek} — re-check the ceiling headroom above, and update js/backend.js, docs/SESSION_LOG_090126.md and this file together`);
  assert(gameChars >= 850 && gameChars <= 1050,
    `a slate game measures ${gameChars} chars (band 850-1050). If this failed, the game record CHANGED SHAPE: re-derive where chunking begins — currently ~WEEK ${gamesWeek} — and update the same three places`);
  assert(picksWeek <= 4,
    `cfbp_picks (6 players x 10 games, ~${pickChars} chars a pick) exceeds one 50,000-char cell around WEEK ${picksWeek} of this season — from there the backend chunks it, so it syncs instead of an outage`);
  assert(gamesWeek <= 6,
    `cfbp_games (10 slate games a week, ~${gameChars} chars a game) exceeds one cell around WEEK ${gamesWeek}`);

  // ── FIXED, NOT MERELY CONTAINED (Item CAP) ─────────────────────────────────
  // The old assertion here read "NOT FIXED, ONLY CONTAINED": an over-cap
  // cfbp_picks was quarantined, so it was unsent-but-unlost and the real fix
  // (chunking in Code.gs) was still owed. That fix now ships. So this INVERTS:
  // an ordinary season-scale cfbp_picks must be OFFERED to the backend, written,
  // and read back intact, with NO error banner. This is the regression test for
  // Item CAP — it fails against the old 50,000-char client cap (which quarantines
  // the picks) and passes only once the client ceiling is raised above a season.
  const sheet = makeSheetBackend(REMOTE_BASE());
  await bootDevice(sheet);
  const w = watchStatus();

  be.cacheSet('cfbp_picks', seasonPicks);
  storage.saveAllObligations([{ obligationId: 'o1', weekId: 'w1', playerId: 'p0', kind: 'loser', settled: false }]);
  let threw = null;
  try { await be.flushPush(); } catch (e) { threw = e; }

  assert(threw === null && sheet.has('cfbp_obligations'),
    'the push resolves and every OTHER key in the batch reaches the Sheet');
  assert(sheet.everSent('cfbp_picks'),
    'THE FIX: an over-cap cfbp_picks is now OFFERED to the backend — NOT deleted from the push batch by the client quarantine as it was pre-CAP');
  assert((sheet.read('cfbp_picks') || []).length === seasonPicks.length,
    'THE FIX: the over-cap cfbp_picks ROUND-TRIPS — the chunking backend stores all of it and getAll reassembles it, so live picks actually sync');
  assert(w.errors().length === 0 && be.getSyncStatus().lastError === null,
    'and NO red banner: a season-scale picks payload is normal data now, not a sync failure');
  assert(be.getSyncStatus().pendingWrites === 0,
    'the queue drains — nothing is held back for an ordinary large picks value');

  w.off();

  // ── DEFENCE-IN-DEPTH SURVIVES: a truly pathological runaway still quarantines ─
  // The raised ceiling is a runaway tripwire, not a removal of the guard. A value
  // that has clearly run away (here ~10x a full season, past the client ceiling)
  // must STILL be held back and fail LOUD — never shipped to the backend where it
  // would spend a multi-MB slug of the shared Sheet's cell budget.
  const sheet2 = makeSheetBackend(REMOTE_BASE());
  await bootDevice(sheet2);
  const w2 = watchStatus();

  const runawayPicks = Array(10).fill(seasonPicks).flat();     // ~10 seasons in one key
  assert(JSON.stringify(runawayPicks).length > be.SHEET_CELL_MAX,
    'fixture check: the runaway value is genuinely past the client ceiling');

  be.cacheSet('cfbp_picks', runawayPicks);
  storage.saveAllObligations([{ obligationId: 'o2', weekId: 'w1', playerId: 'p1', kind: 'winner', settled: false }]);
  let threw2 = null;
  try { await be.flushPush(); } catch (e) { threw2 = e; }

  assert(threw2 === null && sheet2.has('cfbp_obligations'),
    'a quarantined runaway does not throw, and the rest of the batch still lands — the batch is not all-or-nothing');
  assert(w2.errors().some(e => String((e.detail || {}).error || '').includes('cfbp_picks')),
    'the red banner NAMES cfbp_picks as the runaway — loud-fail (AD-06) preserved');
  assert(be.getSyncStatus().pendingWrites >= 1 && !sheet2.everSent('cfbp_picks'),
    'the runaway is HELD — never OFFERED to the backend, still queued, unsent and unlost');

  w2.off();
  be.cacheSet('cfbp_picks', []);    // teardown: release the quarantine
  await be.flushPush();
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[9] N1 / DI-N3 — R10: a push-active device shows no in-app toast (UN-204)…');
{
  // Drew, 2026-09-12, verbatim: *"if push notifications are set up then all in
  // app notifications should be that"* — and, about the banner he actually saw
  // at lock, *"Now that we have push notifications that should have been a push
  // and not an in app banner."*
  //
  // THE ROOT CAUSE WAS NOT ONESIGNAL. wireForegroundSuppression() only
  // preventDefault()s when the push's destination tab equals the tab you are
  // already on, which is correct. The floating card he saw was chat-ui.js's own
  // showToast(), raised by emitPickRevealEvent() with `{force:true}` — a flag
  // that bypassed the player's own toasts preference. So the fix is a DELIVERY
  // DECISION, not a display tweak: if this device is genuinely being reached by
  // push, the push IS the delivery and the in-app card stands down.
  //
  // THIS DRIVES THE REAL showToast(), through its exported test seam, for the
  // reason that seam exists (chat-ui.js's own note): asserting against a
  // re-implementation of the predicate would pass while the shipped function
  // did something else.
  const chatUi = await import('./js/chat-ui.js');
  const { _showToastForTest, _toastQueueDepth, _resetToastsForTest } = chatUi;

  // Count what actually reaches the DOM, so "no toast" means "nothing was
  // rendered", not merely "the queue happened to be empty".
  let appended = 0;
  const realAppend = globalThis.document.body.appendChild;
  globalThis.document.body.appendChild = function (...args) { appended++; return realAppend.apply(this, args); };

  const raise = (n = 2) => {
    _resetToastsForTest();
    appended = 0;
    for (let i = 0; i < n; i++) _showToastForTest({ author: 'system', body: `notice ${i}` });
    return { depth: _toastQueueDepth(), appended };
  };

  // ── Push INACTIVE: today's behaviour, exactly. UN-N3 — not having push must
  //    never be the same as going blind. ──
  storage.setPushActive(false);
  const off = raise(2);
  assert(off.appended >= 1,
    `9-1: push INACTIVE -> the toast is rendered, exactly as it is today (${off.appended} toast node(s) appended)`);
  assert(off.depth === 1,
    `9-2: …and the second notice queues behind the first rather than being dropped (queue depth ${off.depth})`);

  // ── Push ACTIVE: the phone is already telling you. ──
  storage.setPushActive(true);
  const on = raise(2);
  assert(on.appended === 0,
    `9-3: push ACTIVE -> NOTHING is rendered in the app; the push is the delivery (${on.appended} toast nodes appended)`);
  assert(on.depth === 0,
    `9-4: …and nothing is queued either, so it cannot surface later when the flag flips (queue depth ${on.depth})`);

  // ── The forced toast obeys it too. This is THE one Drew saw. ──
  _resetToastsForTest(); appended = 0;
  _showToastForTest({ author: 'system', body: '🔓 Week 3 picks revealed' }, { force: true });
  assert(appended === 0 && _toastQueueDepth() === 0,
    `9-5: even a {force:true} toast is suppressed on a push-active device — the R10 check runs BEFORE the force escape hatch, deliberately, because the banner Drew reported WAS a forced one (appended ${appended})`);

  storage.setPushActive(false);
  _resetToastsForTest(); appended = 0;
  _showToastForTest({ author: 'system', body: '🔓 Week 3 picks revealed' }, { force: true });
  assert(appended === 1,
    '9-6: …and on a push-inactive device force still works, so a system announcement is not lost to a player who simply turned toasts off');

  // ── The reveal emitter itself no longer forces. ──
  const chatUiSrc9 = await readFile(new URL('./js/chat-ui.js', import.meta.url), 'utf8');
  const revealSrc9 = (chatUiSrc9.match(/export function emitPickRevealEvent\([\s\S]*?\n\}/) || [''])[0];
  assert(revealSrc9.length > 0, '9-7: fixture check — emitPickRevealEvent() was located in js/chat-ui.js');
  const revealToast9 = (revealSrc9.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    .match(/showToast\([^\n]*/) || [''])[0];
  assert(revealToast9.includes('picks revealed'), '9-8: fixture check — its showToast() call was located inside that function');
  assert(!/force/.test(revealToast9),
    `9-9: the pick-reveal toast no longer passes {force:true}. Forcing past a player's own getNotifPrefs().toasts preference was the thing Drew actually saw, and it is gone regardless of push state (got: ${revealToast9.trim()})`);

  // ── The flag itself fails CLOSED. ──
  localStorage.removeItem('cfbp_push_active');
  assert(storage.getPushActive() === false,
    '9-10: an ABSENT push-active flag reads FALSE — "push is not carrying this device". A false TRUE would swallow every in-app notice on a device receiving nothing, which is UN-N3\'s exact failure');
  localStorage.setItem('cfbp_push_active', JSON.stringify('true'));
  assert(storage.getPushActive() === false,
    '9-11: …and so does a non-boolean value; the accessor tests `=== true`, never truthiness, so a stringly-typed write cannot silence a device');
  localStorage.setItem('cfbp_push_active', 'not json at all');
  assert(storage.getPushActive() === false, '9-12: …and so does unparseable garbage');
  storage.setPushActive(false);

  // ── It is DEVICE-LOCAL. One phone's answer must never silence a laptop: the
  //    same player's laptop has no push at all and must keep its toasts. ──
  const storageSrc9 = await readFile(new URL('./js/storage.js', import.meta.url), 'utf8');
  assert(/PUSH_ACTIVE:\s*'cfbp_push_active'/.test(storageSrc9),
    '9-13: the flag is a real KEYS entry (AD-02 / CONVENTIONS #8), not an ad-hoc string');
  const deviceLocal9 = (storageSrc9.match(/const DEVICE_LOCAL_KEYS = new Set\(\[[\s\S]*?\]\);/) || [''])[0];
  assert(/KEYS\.PUSH_ACTIVE/.test(deviceLocal9) && /KEYS\.LIFECYCLE_POSTED/.test(deviceLocal9),
    '9-13b: …and both N1 keys are in DEVICE_LOCAL_KEYS — push-active describes THIS handset (a laptop with no push must keep its toasts), and the lifecycle ledger records what THIS device already tried (the server id-dedupe is the league-wide authority)');
  assert(!/localStorage\.(getItem|setItem)\(\s*['"]cfbp_push_active/.test(chatUiSrc9),
    '9-14: …and chat-ui.js reads it through getPushActive(), never localStorage directly — the toast path is synchronous, which is exactly why the async predicate is cached rather than inlined (CONVENTIONS #9)');

  globalThis.document.body.appendChild = realAppend;
}

console.log('\n[10] N1 follow-ups — receipts, the blip, and the stale push-active flag at boot…');
{
  // Three findings from the N1 review, all inside R10's blast radius. [9]
  // above proved the gate does what Drew asked for; these three are the places
  // it went one step too far, one step short, and one step stale.
  const chatUi10 = await import('./js/chat-ui.js');
  const chatUiSrc10 = await readFile(new URL('./js/chat-ui.js', import.meta.url), 'utf8');
  const appSrc10 = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');

  let appended10 = 0;
  const realAppend10 = globalThis.document.body.appendChild;
  globalThis.document.body.appendChild = function (...args) { appended10++; return realAppend10.apply(this, args); };

  // ── (c) RECEIPTS. "Rewrite saved." is a confirmation of the VIEWER'S OWN
  //      action. No push will ever carry it, so "the push is the delivery"
  //      (R10's own rationale) is not true for it, and R10 silenced it — a
  //      submit button that does nothing visible on a push-active phone.
  //      The fix is not a hole in the gate: own-action receipts belong on the
  //      APP-LEVEL toast (app.js's showToast, the one every other "saved"
  //      confirmation in the app already uses), which was never a
  //      notification surface and never gated. chat-ui.js's showToast() keeps
  //      exactly its two gates. ──
  const receipts10 = [];
  const realWindowToast = globalThis.showToast;
  globalThis.showToast = (msg, kind) => { receipts10.push({ msg, kind }); };

  storage.setPushActive(true);
  assert(typeof chatUi10._showReceiptForTest === 'function',
    '10-1: chat-ui.js has ONE named path for own-action receipts (the window.showToast bridge, same pattern as redirectChatDisabled) — one path is what makes "which toasts are receipts?" answerable');
  if (typeof chatUi10._showReceiptForTest === 'function') {
    receipts10.length = 0; appended10 = 0;
    chatUi10._showReceiptForTest('Rewrite saved.');
    assert(receipts10.length === 1 && /Rewrite saved\./.test(receipts10[0].msg),
      `10-2: push ACTIVE -> an own-action receipt STILL renders, via the app toast (got ${receipts10.length}). A receipt is not a notification: nothing else is going to tell this player their rewrite landed`);
  }

  chatUi10._resetToastsForTest(); appended10 = 0;
  chatUi10._showToastForTest({ author: 'system', body: 'someone else posted' }, { force: true });
  assert(appended10 === 0,
    `10-3: …while a NOTICE about something elsewhere stays suppressed on the same device, force or not (got ${appended10} toast node(s)) — [9]'s ruling is untouched`);

  storage.setPushActive(false);
  if (typeof chatUi10._showReceiptForTest === 'function') {
    receipts10.length = 0;
    chatUi10._showReceiptForTest('Rewrite saved.');
    assert(receipts10.length === 1,
      '10-4: …and on a push-inactive device the receipt is unchanged too — this is one delivery path, not a push-conditional one');
  }
  globalThis.showToast = realWindowToast;
  if (realWindowToast === undefined) delete globalThis.showToast;

  // The call site itself, and the enumeration behind it: after this change the
  // only showToast() calls left in chat-ui.js are NOTICES, so none of them
  // needs the force escape hatch to reach a push-active device.
  const rewriteLine10 = (chatUiSrc10.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    .match(/[^\n]*Rewrite saved[^\n]*/) || [''])[0];
  assert(/showReceipt\(/.test(rewriteLine10) && !/force/.test(rewriteLine10),
    `10-5: the rewrite confirmation goes through the receipt path, not showToast(..., {force:true}) — got: ${rewriteLine10.trim()}`);
  const toastCalls10 = (chatUiSrc10.split('\n')
    .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .filter(l => /[^.\w]showToast\(/.test(l) && !/function showToast|_showToastForTest|window\.showToast/.test(l)));
  assert(toastCalls10.length === 2 && toastCalls10.every(l => !/force/.test(l)),
    `10-6: …and the ENUMERATION holds — the ${toastCalls10.length} remaining showToast() call sites in chat-ui.js are both notices (the pick reveal and an incoming message) and neither forces past the gate`);

  // ── (f) THE BLIP. showToast() stood down on a push-active device; playBlip()
  //      did not, so the phone buzzed AND the app chirped for the same message.
  //      Drew: "all in app notifications should be that." ──
  // The sound preference lives on the PLAYER record (per-player preferences,
  // CLAUDE.md architecture bullet 4), so the fixture needs a signed-in player.
  storage.savePlayer({ playerId: 'pt10', displayName: 'Blip Tester', active: true, preferences: {} });
  storage.setSession('pt10', false, true);
  storage.setNotifPrefs({ sound: true });
  assert(storage.getNotifPrefs().sound === true, '10-7: fixture — the sound preference is ON for the two assertions below');
  let audioCtors = 0;
  const realAudioCtx = globalThis.AudioContext;
  globalThis.AudioContext = class {
    constructor() { audioCtors++; this.currentTime = 0; this.destination = {}; }
    createOscillator() { return { frequency: {}, type: '', connect: () => ({ connect: () => {} }), start() {}, stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: () => ({ connect: () => {} }) }; }
  };
  assert(typeof chatUi10._playBlipForTest === 'function',
    '10-8: chat-ui.js exposes the real playBlip() through a test seam — the gate has to be asserted on the shipped function, not a copy of it');
  if (typeof chatUi10._playBlipForTest === 'function') {
    storage.setPushActive(false);
    audioCtors = 0; chatUi10._playBlipForTest();
    assert(audioCtors === 1,
      `10-9: push INACTIVE -> the blip still plays for a player who asked for sound (got ${audioCtors}) — UN-N3, unchanged`);
    storage.setPushActive(true);
    audioCtors = 0; chatUi10._playBlipForTest();
    assert(audioCtors === 0,
      `10-10: push ACTIVE -> NO blip (got ${audioCtors}). The phone already made a sound for this message; R10 covers the audible in-app notification as much as the visible one`);
  }
  if (realAudioCtx === undefined) delete globalThis.AudioContext; else globalThis.AudioContext = realAudioCtx;
  storage.setNotifPrefs({ sound: false });
  storage.clearSession();
  storage.setPushActive(false);

  // ── (e) THE STALE FLAG AT BOOT. KEYS.PUSH_ACTIVE is device-local and
  //      PERSISTED, so a phone that revoked notification permission between
  //      sessions boots reading last session's `true` and swallows every
  //      in-app notice until refreshPushActiveFlag() resolves — which waits on
  //      the SDK (up to its 12s ready timeout, and forever if init never
  //      settles). Structural, and labelled: boot() needs a live DOM and a
  //      hydrate this harness has no business building (the [9] precedent). ──
  const bootBlock10 = (appSrc10.match(/Groups A\/B — notifications boot wiring[\s\S]{0,4000}?refreshPushActiveFlag\(\);/) || [''])[0];
  assert(bootBlock10.length > 0, '10-11: fixture check — the notifications boot-wiring block was located in js/app.js');
  // RG-177 (2026-09-19) — the clear still happens here and still happens FIRST;
  // it just goes through setPushActiveDurable() now. Under dataMode:'supabase'
  // this tail routinely runs before the adapter is serving, and js/storage.js's
  // SEC F1 write interlock refuses DEVICE-LOCAL keys too — so the bare
  // `try { setPushActive(false); } catch {}` that used to be here silently did
  // nothing on exactly the boots this assertion exists to protect, leaving last
  // session's `true` standing anyway. The durable writer records the refusal and
  // app.js's afterSupabaseHydrate() re-applies it the moment writes are possible
  // (boottest [24]). Matching the bare name would now match nothing.
  const clearAt10 = bootBlock10.indexOf('setPushActiveDurable(false)');
  // The `.then(` matters, for boottest.mjs §10E's reason: the comment beside
  // the clear NAMES ensureOneSignalInit() in prose a few lines above the real
  // call, and a bare indexOf would match the sentence and invert this.
  const initAt10  = bootBlock10.indexOf('ensureOneSignalInit().then(');
  assert(clearAt10 > -1,
    '10-12: boot clears the persisted push-active flag before it recomputes it — the stale window now fails CLOSED, which is what the comment beside refreshPushActiveFlag() already claims ("a device that has not computed it yet reads FALSE")');
  assert(!/try \{ setPushActive\([^)]*\); \} catch \{\}/.test(bootBlock10),
    '10-12b (RG-177): …and the clear is not written through a bare swallowing try/catch — under Supabase the write interlock refuses it, and a swallowed refusal made the fail-closed clear a no-op on precisely the boots it is for');
  assert(clearAt10 > -1 && initAt10 > -1 && clearAt10 < initAt10,
    `10-13: …and it clears BEFORE ensureOneSignalInit(), not inside its .then() — an init that never settles (no App ID, offline, SDK blocked) would otherwise leave last session's TRUE standing for the whole session (clear at ${clearAt10}, init at ${initAt10})`);

  globalThis.document.body.appendChild = realAppend10;
}

// ═════════════════════════════════════════════════════════════════════════════
// [11] DI-204 / DI-205 / DI-206 / DI-218 — THE PUSH SELF-TEST FAMILY'S CLIENT.
//
// Everything here is a PURE function of a server answer, which is the whole
// reason `js/push-selftest.js` is its own module: the assertions below are
// about the sentence the commissioner will actually read, not about a snapshot
// of HTML. A copy string written inline in app.js would be a string no test
// could reach.
//
// WHAT THIS CANNOT PROVE, said plainly: none of it touches a database or a
// browser. That the RLS policy hides the row is rls.test.mjs's (live, on
// cfbp-test); that the webhook fires is Drew's browser checklist; that the
// phone buzzes is the phone.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[11] DI-204/205/206/218 — the push self-test client…');
{
  const pst = await import('./js/push-selftest.js');

  // ── DI-204h — every state, one sentence each.
  {
    const run = (payload, over = {}) => ({ ok: true, skipped: null, error: null, payload, ...over });
    const t = (r, o) => pst.testPushResultCopy(r, o).text;

    assert(/accepted it for 1 device/.test(t(run({ pushed: 1, recorded: 1 }), { sentAgo: '2s ago' })),
      '11-1: OneSignal accepted it ⇒ the "accepted it for N device(s) — check your phone" line');
    assert(!/deliver/i.test(t(run({ pushed: 1, recorded: 1 }))),
      '11-2: A2 EVIDENCE RULE — the word "delivered" appears NOWHERE in the success copy. OneSignal reports what was TARGETED; the phone buzzing is the only proof of arrival, which is exactly why Drew is standing there watching it');
    assert(/only you can see it/.test(t(run({ pushed: 1, recorded: 1 }))),
      '11-3: …and it says the chat post is private, which is the clause of UN-206 a commissioner would otherwise have to take on faith');
    assert(/no subscribed device/.test(t(run({ pushed: 0, recorded: 1 }))),
      '11-4: recorded but not pushed and no preference blocked it ⇒ "no subscribed device for your account"');
    assert(/push notifications are turned off/.test(t(run({ pushed: 0, recorded: 1, breakdown: [{ memberId: 'p1', reason: 'master_off' }] }))),
      '11-5: the master switch off is named as the master switch, from the SERVER\'s own breakdown — the same check real traffic gets, so the copy and the behaviour cannot disagree');
    assert(/muted the Chat category/.test(t(run({ pushed: 0, recorded: 1, breakdown: [{ memberId: 'p1', reason: 'category_off' }] }))),
      '11-6: …and the category mute is named as the category mute — they need different instructions');
    assert(/still posted to chat/i.test(t(run({ pushed: 0, recorded: 1, breakdown: [{ memberId: 'p1', reason: 'master_off' }] }))),
      '11-7: …and both say the message DID post, so the rest of the pathway is still confirmed short of the phone buzz');
    assert(/couldn't work out who the test was for/.test(t(run({ recipients: 0, direct: 'unresolved' }, { skipped: 'no_work' }))),
      '11-8: B4\'s worst case has its OWN loud copy, and it says plainly that nothing went to anyone else');
    assert(/Test push failed — boom/.test(t(run({}, { ok: false, error: 'boom' }))),
      '11-9: a server failure is LOUD and quotes the reason (AD-06 — never softened, never a silent fallback)');
    assert(/hasn't reported back yet/.test(t(null, { sentAgo: '20s ago' })),
      '11-10: B3 — no matching run inside the poll window is the HONEST line, never a false success');
    // ── 11-11 REWRITTEN AT THE COMBINED RELEASE (2026-09-20, reviewer BLOCK R2).
    //
    // It used to read `t(run({}, { skipped: 'disabled' }))` and pin the copy on that branch. That
    // branch WAS UNREACHABLE: `notify-fanout` returns `skipped:'disabled'` before `startRun()`
    // (its §3; notifyFanout.twin.mjs :115 asserts zero job_runs writes on that path), so no run
    // row carrying that state can ever exist for `testPushResultCopy()` to be handed. The
    // assertion passed for 129 runs over copy the system could not produce — which is worse than
    // no assertion, because it read as coverage of the case Drew would actually hit.
    //
    // The reachable state is CLIENT-SIDE, off the switch the card already holds. Pinned here on
    // BOTH of its routes.
    assert(/switched off/.test(pst.serverPushOffCopy().text)
      && /notify-fanout/.test(pst.serverPushOffCopy().text),
      '11-11: the switch-off state names the job AND the card section a commissioner has to go to, so the line is actionable rather than merely true');
    assert(pst.serverPushOffCopy().tone === 'warn',
      '11-11a: …and it is a warn, not an ok — nothing was sent');
    assert(/can't be sent until it's on/.test(pst.serverPushOffCopy().text),
      '11-11b: …and it says plainly that NOTHING was sent, rather than implying a message posted anyway (the removed branch claimed "It still posted to your Locker Room", which was false — the RPC is never reached)');
    assert(pst.testPushResultCopy(null, { sentAgo: '20s ago', serverPushOff: true }).text === pst.serverPushOffCopy().text,
      '11-11c: …and the TIMEOUT route answers with the SAME sentence when the switch is off, so a switch flipped mid-poll cannot fall back to "hasn\'t reported back yet"');
    assert(/hasn't reported back yet/.test(pst.testPushResultCopy(null, { sentAgo: '20s ago', serverPushOff: false }).text),
      '11-11d: …while a genuine no-answer with the switch ON still gets the honest "hasn\'t reported back yet" — the new branch narrows that line, it does not replace it');
    {
      const src11 = await readFile(new URL('./js/push-selftest.js', import.meta.url), 'utf8');
      const code11 = src11.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
      assert(!/skipped\s*===\s*'disabled'/.test(code11),
        '11-11e: …and the unreachable `skipped === \'disabled\'` branch is GONE from the source, not merely untested — a dead branch is a future false assertion waiting for someone to notice it is uncovered');
    }
    assert(/not configured/i.test(t(run({}, { skipped: 'not_configured' }))),
      '11-12: an unconfigured OneSignal is reported as a SERVER problem, never as a player problem');
  }

  // ── DI-204h's refusal states.
  {
    assert(/wait 12s/.test(pst.testPushRefusalCopy({ reason: 'rate_limited', waitSeconds: 12 }).text),
      '11-13: the rate-limit copy uses the SERVER\'s own remaining seconds, so the countdown and the gate can never disagree');
    assert(pst.interpretRpcError({ message: 'rate_limited:7' }).waitSeconds === 7,
      '11-14: …parsed out of the RPC\'s raise message, which is where that number is decided');
    assert(pst.interpretRpcError({ message: 'ERROR: not_commissioner' }).reason === 'not_commissioner',
      '11-15: the commissioner refusal is recognised as its own state');
    assert(/only the commissioner/.test(pst.testPushRefusalCopy({ reason: 'not_commissioner' }).text),
      '11-16: …and rendered as its own sentence');
  }

  // ── B3 — the poll matches on the MESSAGE ID, never on "the newest run".
  {
    const rows = [
      { job: 'notify-fanout', finishedAt: 'x', payload: { meta: { messageId: 'somebody_elses' }, pushed: 5 } },
      { job: 'notify-fanout', finishedAt: 'x', payload: { meta: { messageId: 'sys_test_mine' }, pushed: 1 } },
    ];
    const hit = await pst.pollTestPushResult('L', 'sys_test_mine', { getRuns: async () => rows, sleep: async () => {} });
    assert(hit && hit.payload.pushed === 1,
      '11-17: B3 — the poll finds the run whose payload.meta.messageId MATCHES, not the newest one. On a Saturday the newest notify-fanout row belongs to somebody\'s chat message, and reporting a stranger\'s fan-out as your own result is worse than reporting nothing');
    const inflight = [{ job: 'notify-fanout', finishedAt: null, payload: { meta: { messageId: 'sys_test_mine' } } }];
    let ticks = 0;
    const none = await pst.pollTestPushResult('L', 'sys_test_mine', {
      getRuns: async () => inflight, sleep: async () => { ticks += 1; },
      now: () => (ticks >= 3 ? 1e12 : 0), timeoutMs: 1000,
    });
    assert(none === null,
      '11-18: …a START row with no finishedAt is a run still in flight — the poll keeps waiting rather than reporting a half-written row as the answer');
    const broken = await pst.pollTestPushResult('L', 'x', {
      getRuns: async () => { throw new Error('job_runs unreadable'); }, sleep: async () => {}, now: (() => { let n = 0; return () => (n += 1e6); })(),
    });
    assert(broken === null,
      '11-19: …and a THROWING getJobRuns degrades to the honest "hasn\'t reported back yet" line rather than taking the button down');
  }

  // ── DI-205 — the per-player breakdown lines.
  {
    const nameOf = (id) => ({ p1: 'Drew', p2: 'Brayden', p3: 'Kevin', p4: 'Koby' })[id] || '';
    const line = (e) => pst.breakdownLine(e, nameOf);
    assert(line({ memberId: 'p1', reason: null }).text === 'Drew — pushed', '11-20: a reachable player');
    assert(line({ memberId: 'p2', reason: 'category_off' }).text === 'Brayden — muted (Chat category off)', '11-21: a muted category');
    assert(line({ memberId: 'p3', reason: 'master_off' }).text === 'Kevin — push notifications off', '11-22: push off');
    assert(line({ memberId: 'p4', reason: 'inactive' }).text === 'Koby — not an active member', '11-23: an inactive member');
    assert(line({ memberId: 'p9', reason: null }).text === 'p9 — pushed',
      '11-24: an id the roster does not know renders as the ID rather than as a blank line — a member who left is still visible');
    assert(line({ memberId: 'p1', reason: 'something_new' }).icon === '⚠️',
      '11-25: a reason this client has never seen renders as a WARNING with the raw word, not as a success. A server that grows a new reason must not read as "pushed" here');
  }

  // ── DI-206 — the reachability lines, and the merge's honesty about what it
  //    does not know.
  {
    const nameOf = (id) => ({ p1: 'Drew', p2: 'Brayden', p5: 'Kihoon' })[id] || '';
    const l = (r, e) => pst.reachLine(r, e, nameOf);
    assert(/1 device \(iPhone\) can receive push/.test(l({ memberId: 'p5', deviceCount: 1, kinds: ['iPhone'], lookupOk: true }, null).text),
      '11-26: a device found');
    assert(/Preferences unknown/.test(l({ memberId: 'p5', deviceCount: 1, kinds: ['iPhone'], lookupOk: true }, null).text),
      '11-27: DI-206d — with NO recent send to read preferences from, the preference half is labelled UNKNOWN, never assumed to be on. That is the difference between a diagnostic and a guess');
    assert(!/unknown/i.test(l({ memberId: 'p5', deviceCount: 1, kinds: ['iPhone'], lookupOk: true }, { reason: null }).text),
      '11-28: …and with real eligibility data the hedge disappears');
    assert(/no device registered/.test(l({ memberId: 'p2', deviceCount: 0, kinds: [], lookupOk: true }, null).text),
      '11-29: zero devices — the one fact this check proves decisively');
    assert(/accept the notification prompt/.test(l({ memberId: 'p2', deviceCount: 0, kinds: [], lookupOk: true }, null).action),
      '11-30: …with the per-state ACTION line DI-206e requires: what to actually tell that player');
    const failed = l({ memberId: 'p1', deviceCount: null, kinds: [], lookupOk: false }, null);
    assert(/couldn't check/.test(failed.text) && !/no device/.test(failed.text),
      '11-31: C1 — a FAILED LOOKUP renders as "couldn\'t check" and NEVER as "no device". Telling Drew that Kevin has no phone when OneSignal simply did not answer sends him to Kevin with the wrong instruction');
    assert(/turned off in Settings/.test(l({ memberId: 'p1', deviceCount: 1, kinds: ['iPhone'], lookupOk: true }, { reason: 'master_off' }).text),
      '11-32: a registered device with push off is a DIFFERENT line from no device, and a different instruction');
    assert(/2 devices \(iPhone, Web\)/.test(l({ memberId: 'p1', deviceCount: 2, kinds: ['iPhone', 'Web'], lookupOk: true }, { reason: null }).text),
      '11-33: multiple devices, mixed kinds');
    assert(!/receiving|delivered|will get/i.test(l({ memberId: 'p1', deviceCount: 1, kinds: ['iPhone'], lookupOk: true }, { reason: null }).text),
      '11-34: the copy says "CAN receive push" and never claims a push will arrive — OneSignal\'s `enabled` can lag a revoked OS permission by a day (DI-206i.4)');
    assert(/isn't configured/.test(pst.reachHeaderCopy({ skipped: 'not_configured' }).text),
      '11-35: the unconfigured state is a SERVER problem line, not five identical player lines');
    assert(/wait 42s/.test(pst.reachHeaderCopy({ rateLimited: true, retryAfterSeconds: 42 }).text),
      '11-36: the whole-check rate limit counts down from the server\'s own number');
    assert(/Reachability check failed/.test(pst.reachHeaderCopy({ ok: false, error: 'onesignal_unreachable' }).text),
      '11-37: a total failure is loud (AD-06)');
  }

  // ── DI-218 — the version line.
  {
    const nameOf = (id) => ({ p1: 'Drew', p2: 'Brayden' })[id] || '';
    const now = Date.parse('2026-09-20T12:00:00Z');
    const cur = pst.versionLine({ memberId: 'p1', version: 'v0.22.7', seenAt: '2026-09-20T10:00:00Z' }, 'v0.22.7', nameOf, now);
    assert(cur.stale === false && cur.icon === '✅' && /Drew — v0\.22\.7 · since 2h ago/.test(cur.text),
      `11-38: a player on the current version is not highlighted, and the time is labelled "since" — report_app_version writes ONLY on change, so the timestamp is when they FIRST arrived on that version, not when they last opened the app (got ${cur.text})`);
    const old = pst.versionLine({ memberId: 'p2', version: 'v0.22.5', seenAt: '2026-09-18T10:00:00Z' }, 'v0.22.7', nameOf, now);
    assert(old.stale === true && old.icon === '⚠️',
      '11-39: anyone NOT on APP_VERSION is highlighted — the whole point of this column is the Step 6 switch-on precondition ("only flip this on once every device is on the latest app version"), which until now nothing in the system could check');
    const never = pst.versionLine({ memberId: 'p2', version: '', seenAt: null }, 'v0.22.7', nameOf, now);
    assert(never.stale === true && /never reported/.test(never.text),
      '11-40: a member who has never reported reads `never`, not blank and not "unknown" — that is the case the commissioner must not read past');
    assert(/2 of 3 not on v0\.22\.7 yet/.test(pst.versionSummary(
      [{ version: 'v0.22.7' }, { version: 'v0.22.5' }, { version: '' }], 'v0.22.7')),
      '11-41: the summary counts the stragglers, including the never-reported one');
    assert(/All 2 on v0\.22\.7/.test(pst.versionSummary([{ version: 'v0.22.7' }, { version: 'v0.22.7' }], 'v0.22.7')),
      '11-42: …and says so plainly when everyone is up to date');
  }

  // ── DI-218's boot hook: once per load, and NEVER the red banner.
  {
    pst._resetVersionReportForTest();
    assert(await pst.reportAppVersionOnce('v0.22.7', null) === 'skipped',
      '11-43: no league ⇒ the hook does nothing at all (and does not consume its once-per-load latch)');
    assert(await pst.reportAppVersionOnce('', 'L') === 'skipped', '11-44: …and neither does a missing version');
  }

  // ── The storage seam: this module stores NOTHING. Asserted over the SOURCE,
  //    because the claim is an absence and an absence has no runtime handle.
  {
    const { readFileSync } = await import('node:fs');
    const raw = readFileSync('js/push-selftest.js', 'utf8');
    // COMMENTS BLANKED, LENGTH PRESERVED (functions.check.mjs's `strip`). The
    // file's own header EXPLAINS that it reaches no localStorage and stores
    // nothing — a rule that a sentence describing it can defeat is the RG-49
    // shape, where prose satisfies the check the prose is about.
    const src = raw
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, (m, p1) => p1 + ' '.repeat(m.length - p1.length))).join('\n');
    assert(raw.length === src.length && /storage seam/.test(raw) && !/storage seam/.test(src),
      '11-45a: fixture check — the comment blanker is genuinely blanking and preserves length, so the two assertions below cannot pass by matching nothing');
    assert(!/localStorage/.test(src),
      '11-45: AD-02 — js/push-selftest.js never touches localStorage');
    assert(!/from '\.\/storage\.js'/.test(src),
      '11-46: …and it adds no storage key at all. The design input asked for a device ledger; the SERVER is the memory instead (report_app_version returns without writing when the version has not changed), because last_seen_version is a fact about a MEMBER and a per-device key would be the wrong subject — see that file\'s header');
    assert(/_versionReportedThisLoad = true;/.test(src) && src.indexOf('_versionReportedThisLoad = true;') < src.indexOf("client.rpc('report_app_version'"),
      '11-47: …and the once-per-load latch is set BEFORE the await, so two overlapping boots (a hydrate and a hold-gate resume) cannot both fire it');
  }

  // ── The app.js half: the card, the boot hook, and the banner rule.
  {
    const { readFileSync } = await import('node:fs');
    const appSrc = readFileSync('js/app.js', 'utf8');
    const html = (await import('./js/app.js')).renderPushSelfTestHTML;
    assert(typeof html === 'function', '11-48: renderPushSelfTestHTML is exported as its own test seam');
    assert(/data-comm-tab="data"[\s\S]{0,4000}renderPushSelfTestHTML\(\)/.test(appSrc),
      '11-49: RG-10 — the sub-section renders INSIDE the Background jobs card, which already carries data-comm-tab="data". An untagged admin-section renders on all five tabs');
    assert(/id="push-selftest-btn"[^>]*style="min-height:44px"/.test(appSrc)
      && /id="push-reach-btn"[^>]*style="min-height:44px"/.test(appSrc)
      && /id="push-breakdown-toggle"[^>]*style="min-height:44px"/.test(appSrc),
      '11-50: CONVENTIONS #17 — all three controls carry an explicit 44px floor (.btn-sm\'s base is 34px, under it)');
    assert(!/#[0-9a-fA-F]{6}/.test(appSrc.slice(appSrc.indexOf('const PUSH_TONE_COLOR'), appSrc.indexOf('const PUSH_TONE_COLOR') + 400)),
      '11-51: no hardcoded color — the tone map is CSS custom properties only, so all seven themes are correct by construction');
    assert(/⚠️.*var\(--loss\)|warn: 'var\(--loss\)'/.test(appSrc.slice(appSrc.indexOf('const PUSH_TONE_COLOR'), appSrc.indexOf('const PUSH_TONE_COLOR') + 400)),
      '11-52: DI-206f — `warn` REUSES --loss rather than inventing a new token, which is what the DI asked the builder to confirm against styles.css');
    const tailAt = appSrc.indexOf('async function runPostHydrateTail');
    const reportAt = appSrc.indexOf('reportAppVersionOnce(APP_VERSION)');
    assert(tailAt > -1 && reportAt > tailAt,
      '11-53: the version report is hooked into runPostHydrateTail() — the one place that runs once per load AFTER a hydrate returned ACTIVE, so the league is resolved and the RPC has something true to say');
    const hookBlock = appSrc.slice(reportAt - 1400, reportAt + 200);
    assert(!/showBackendErrorBanner/.test(hookBlock),
      '11-54: …and nothing on that path can raise the red banner. The banner means "your picks may not be saving" (AD-06); spending it on a diagnostic column would teach six people to ignore the one warning that matters');
    assert(/\.catch\(\(\) => \{\}\)/.test(appSrc.slice(reportAt, reportAt + 120)),
      '11-55: …and the promise is caught at the call site too, so an unhandled rejection cannot escape into the boot path');

    // ── REVIEWER BLOCK R2 — the switch check, on both routes, in the handler itself.
    const sendAt = appSrc.indexOf('async function handleSendTestPush()');
    assert(sendAt > -1, '11-56: fixture check — handleSendTestPush() was located');
    const sendBody = appSrc.slice(sendAt, appSrc.indexOf('\n}', appSrc.indexOf('refreshBackgroundJobsCard();', sendAt)));
    assert(/if \(!isServerJobEnabled\('notifyFanout'\)\)/.test(sendBody),
      '11-56a: R2 — the handler refuses BEFORE sending when notify-fanout is off, off the switch state the card already holds');
    assert(sendBody.indexOf("isServerJobEnabled('notifyFanout')") < sendBody.indexOf('await sendTestPush()'),
      '11-56b: …and that check is textually BEFORE the RPC call, so nothing is inserted — no private Locker Room message is written for a push that provably cannot follow it');
    assert(/serverPushOffCopy\(\)/.test(sendBody),
      '11-56c: …and it renders the pure copy function rather than a string written inline here, which no suite could reach');
    assert(/serverPushOff: !isServerJobEnabled\('notifyFanout'\)/.test(sendBody),
      '11-56d: …and the TIMEOUT route re-reads the switch rather than capturing it at send time, so a flip mid-poll is reported correctly');
    // push-reach: the brief asked whether the same check is needed. It is not, and that is a fact
    // about the function rather than an oversight — asserted so a later kill switch cannot be
    // added there without this going red and forcing the same client-side handling.
    const reachSrc = await readFile(new URL('./supabase/functions/push-reach/index.js', import.meta.url), 'utf8');
    assert(!/isJobEnabled\s*\(/.test(reachSrc.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')),
      '11-57: push-reach has NO kill switch at all (commissioner-only, class U), so there is no equivalent "switched off" state for its button to pre-empt. If one is ever added, this goes red and the DI-206 button needs the same treatment DI-204 just got');

    // ── [11c] ONE COHERENT CARD (combined release 2026-09-20, brief item (d)).
    //
    // Three warnings in SERVER_JOB_ON_WARNING send Drew to "the App version last seen list below".
    // That list is DI-218's, and it ships in the SAME release from a DIFFERENT branch — so this is
    // exactly the kind of cross-branch reference that is true on the day it is written and silently
    // false after the next rename. Pinned here: the phrase in the warnings and the HEADING that
    // renders are the same words, the list really is in the same card, and the two branches did not
    // each contribute a heading.
    const VERSION_HEADING = 'App version last seen';
    const warnAt = appSrc.indexOf('const SERVER_JOB_ON_WARNING');
    assert(warnAt > -1, '11c-1: fixture check — SERVER_JOB_ON_WARNING was located');
    const warnBlock = appSrc.slice(warnAt, appSrc.indexOf('});', warnAt));
    const referers = ['notifyFanout', 'reminders', 'scoresRefresh'];
    for (const job of referers) {
      const line = (warnBlock.match(new RegExp(`\\n  ${job}: '([^']*)'`)) || [, ''])[1];
      assert(line.length > 0, `11c-2/${job}: fixture check — the warning string was read`);
      assert(line.includes(`The ${VERSION_HEADING} list below`),
        `11c-3/${job}: the warning points at "The ${VERSION_HEADING} list below" — the EXACT words the card renders, not a paraphrase of them`);
      assert(/DI-218/.test(line),
        `11c-4/${job}: …and names DI-218, so the reference is traceable when somebody greps for what shipped it`);
    }
    assert(appSrc.includes(`>${VERSION_HEADING}\${`) || appSrc.includes(`${VERSION_HEADING}\${versionRows.length`),
      `11c-5: …and "${VERSION_HEADING}" is the literal heading the card renders, so the three warnings above name something a commissioner can actually find by eye`);
    // Same card, and ONE heading. The push sub-section is appended INSIDE the Background jobs
    // card's `.card`, after the per-job rows the warnings' own toggles live in — which is what
    // makes the word "below" true at phone width, where everything is one column.
    const cardAt = appSrc.indexOf('🛠 Background jobs');
    const rowsAt = appSrc.indexOf('${rowsHtml}', cardAt);
    const subAt = appSrc.indexOf('${renderPushSelfTestHTML()}', cardAt);
    assert(cardAt > -1 && rowsAt > cardAt && subAt > rowsAt,
      `11c-6: the push sub-section renders INSIDE the Background jobs card and BELOW the per-job rows (card=${cardAt}, rows=${rowsAt}, sub=${subAt}) — so "below" is literally true in the one-column phone layout, not just conceptually`);
    assert((appSrc.match(/🛠 Background jobs/g) || []).length === 1,
      '11c-7: …and there is exactly ONE "🛠 Background jobs" heading. Both merged branches added to this card; two headings would be the visible seam of the merge');
    // Counted as RENDERED MARKUP (`>App version last seen`), not as raw occurrences: the phrase
    // also appears in the three warning strings above and once more in the comment that explains
    // why those warnings were reworded, and none of those is a heading. What must be unique is the
    // heading itself — two would be the visible seam of the merge.
    const renderedHeadings = (appSrc.match(new RegExp(`>${VERSION_HEADING}`, 'g')) || []).length;
    assert(renderedHeadings === 1,
      `11c-8: …and "${VERSION_HEADING}" is rendered as a heading EXACTLY ONCE (got ${renderedHeadings}). Both merged branches wrote into this card; a second copy of this heading would mean each had contributed its own version list`);
  }

  // ══ [11r] REVIEWER BLOCK R1 — THE **REAL** ROSTER LOOKUP, DRIVEN FOR ALL THREE LISTS. ═══════
  //
  // Everything above this point injected its OWN `nameOf` fixture into `breakdownLine`/
  // `reachLine`/`versionLine`. That is the right way to unit-test those three pure functions, and
  // it is exactly why 129 assertions passed over a card that rendered a raw member id on every
  // single line: js/app.js's own `nameOf` read `x.id` and `.name`, and a player record has neither
  // (js/storage.js:941 / js/supabase-projection.js:545's PLAYER_COLS both say
  // `playerId` / `displayName`). Every lookup missed and fell through to `|| id`, so the card said
  // "Tell p_1724_ab3x to open the app".
  //
  // SO THIS SECTION CALLS `renderPushSelfTestHTML()` ITSELF, with REAL-SHAPED player records in
  // the real storage seam, and reads the produced HTML. It is the only assertion in this file that
  // can see the defect, because it is the only one that does not supply the lookup.
  {
    const app = await import('./js/app.js');
    const auth = await import('./js/auth.js');
    // ROSTER FIRST, MODE SECOND — and that ORDER is itself load-bearing. `save()` raises
    // `AuthModeMismatchError` for a write made while authMode is 'supabase' but the data layer is
    // still the Sheets backend (js/storage.js:408), which is the seam doing its job; seeding
    // before the flip is how a real device gets here too (it hydrates, then the mode is known).
    //
    // Through the storage SEAM (AD-02 / CONVENTIONS #8) — `savePlayer()`, never a localStorage
    // poke. `getPlayers()` inside renderPushSelfTestHTML() then reads exactly what a real device
    // would have.
    const priorPlayers = storage.getPlayers();
    storage.savePlayer({ playerId: 'p_1724_ab3x', displayName: 'Kihoon', active: true });
    storage.savePlayer({ playerId: 'p_1724_cd9y', displayName: 'Brayden', active: true });
    // `isSupabaseDataMode()` gates the whole sub-section; without this the function returns ''.
    auth.configureAuth({ authMode: 'supabase', dataMode: 'supabase', supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon' });
    app._setPushSelfTestForTest({
      breakdownOpen: true,
      breakdown: [{ memberId: 'p_1724_ab3x', pushed: true, reason: '' }],
      reach: { ok: true, results: [{ memberId: 'p_1724_cd9y', deviceCount: 1, kinds: ['iPhone'], lookupOk: true }], checked: 1 },
      versions: [{ memberId: 'p_1724_ab3x', version: 'v0.22.5', seenAt: '2026-09-18T10:00:00Z' }],
    });
    const out = app.renderPushSelfTestHTML();
    assert(typeof out === 'string' && out.length > 200,
      `11r-1: fixture check — the sub-section rendered at all in supabase data mode (got ${typeof out}, ${String(out).length} chars)`);
    assert(/App version last seen/.test(out),
      '11r-2: fixture check — …and it is really the push sub-section, not some other branch');
    // THE THREE LISTS, each proven by a name that only the real lookup can produce.
    assert(/Kihoon/.test(out),
      `11r-3: DI-205 breakdown + DI-218 version list — the REAL nameOf resolves p_1724_ab3x to "Kihoon". This is the assertion that fails against \`x.id\`/\`.name\`. Got:\n${out.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 400)}`);
    assert(/Brayden/.test(out),
      '11r-4: DI-206 reachability — …and p_1724_cd9y to "Brayden" on the push-reach list, which is fed by a different call site and could have been missed separately');
    assert(!/p_1724_ab3x/.test(out) && !/p_1724_cd9y/.test(out),
      `11r-5: …and NEITHER raw member id survives anywhere in the card. A name rendered beside its own id would still be the defect half-fixed. Got:\n${out.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 400)}`);
    // The fallback is still there for an id that genuinely is not on the roster — that is the one
    // case where showing the id is the useful answer, and it must not have been removed.
    app._setPushSelfTestForTest({ versions: [{ memberId: 'p_not_on_roster', version: 'v0.22.5', seenAt: '2026-09-18T10:00:00Z' }] });
    assert(/p_not_on_roster/.test(app.renderPushSelfTestHTML()),
      '11r-6: an id that is genuinely NOT on the roster still renders as the id — the `|| id` fallback is intact, and firing for one unknown member is right where firing for everybody was the bug');
    app._setPushSelfTestForTest({});
    // Restore in the same order, for the same reason: mode back to sheets BEFORE any write.
    auth.configureAuth({ authMode: 'pins', dataMode: 'sheets', supabaseUrl: '', supabaseAnonKey: '' });
    for (const pl of priorPlayers) storage.savePlayer(pl);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[12] RG-192 — the external id is never attached, so no player is reachable…');
// ═════════════════════════════════════════════════════════════════════════════
//
// THE REPORT (Drew, live, 2026-09-20). The new commissioner "Check who can
// receive push" answers: p1 — 1 device. p2…p6 — NO device registered. Meanwhile
// notify-fanout records `recipients:5, pushed:5` for every chat message, because
// "pushed" only means OneSignal ACCEPTED an `include_external_user_ids` request;
// with no subscription behind an external id nothing is delivered and nobody can
// tell. A desk analysis had already concluded from reading the code that
// "the client logs into OneSignal with getSession().playerId and the identity is
// stable" (SESSION_LOG_091126_SUPABASE.md, DECISION MEMO — UN-183 item 14). It
// was never verified on a device. It is wrong.
//
// THE MECHANISM, and why the Supabase cutover is what turned it on.
//
//   `loginOneSignal()` / `logoutOneSignal()` do NOT wait for the SDK to be
//   initialised. They await the App ID and then push a callback onto
//   `window.OneSignalDeferred`. The v16 SDK drains that queue by INVOKING each
//   callback — it does not await them in series — so every callback queued
//   before the first drain runs while `OneSignal.init()` is still an unsettled
//   promise, and `OneSignal.login()` on an uninitialised SDK THROWS. The throw
//   lands in push-onesignal.js's `catch (err) { console.warn(...) }` and is
//   never retried.
//
//   In PIN mode that never bit: `getSession()` was a synchronous localStorage
//   read, so the only caller was app.js's boot tail, INSIDE
//   `ensureOneSignalInit().then(...)` — i.e. after init. In `authMode:'supabase'`
//   identity arrives on an auth EVENT: js/app.js's chokepoint
//   (applyIdentityDeltaIfChanged -> resyncPlayerPreferences, app.js:3832) fires
//   from `wireAuthUIEvents()` during `applyAuthModeDecision()` — and that is
//   ABOVE the hydrate, while `ensureOneSignalInit()` is only reached afterwards
//   in `runPostHydrateTail()` (app.js:1906). The hydrate cannot even start until
//   memberships resolve (it needs the active league), so on a Supabase boot the
//   login is queued FIRST, essentially always. The cutover inverted the order.
//
// THE FIXTURE models exactly the two SDK facts this turns on, and nothing else:
// the queue is invoked rather than awaited, and login before init throws.
{
  const savedG = {
    document: globalThis.document, navigator: globalThis.navigator, fetch: globalThis.fetch,
    matchMedia: globalThis.matchMedia, Notification: globalThis.Notification,
    PushSubscriptionOptions: globalThis.PushSubscriptionOptions,
    OneSignalDeferred: globalThis.OneSignalDeferred,
  };
  const setNav = (v) => { try { globalThis.navigator = v; }
    catch { Object.defineProperty(globalThis, 'navigator', { value: v, configurable: true, writable: true }); } };
  const keepAlive = async (p) => { const ka = setInterval(() => {}, 5); try { return await p; } finally { clearInterval(ka); } };
  const settle = (ms = 250) => keepAlive(new Promise(r => setTimeout(r, ms)));

  let CALLS = [];
  let sdk = null;
  let scriptDelayMs = 5;

  /** The shipped v16 contract, the clauses that matter here.
   *
   *  `requestPermission()` deliberately creates NO subscription (reviewer BLOCK,
   *  2026-09-20): on a device where permission is ALREADY granted the v16 call
   *  resolves instantly and changes nothing, which is why "✅ Push enabled" could
   *  be shown over a device that is still unsubscribed. Only
   *  `User.PushSubscription.optIn()` creates the subscription. */
  function makeSdk({ initMs = 30, subscribed = true, optInCreates = true, loginGate = null } = {}) {
    let inited = false;
    const sub = {
      optedIn: subscribed,
      id: subscribed ? 'sub-abc' : undefined,
      async optIn() {
        CALLS.push('optIn');
        if (!optInCreates) return;
        sub.optedIn = true;
        sub.id = 'sub-new';
      },
    };
    const user = { PushSubscription: sub, externalId: '' };
    return {
      async init() { await new Promise(r => setTimeout(r, initMs)); inited = true; CALLS.push('init'); },
      async login(id) {
        // Read from the shipped SDK: every public User/Notifications call asserts
        // initialisation first and throws when it has not happened yet.
        if (!inited) { CALLS.push(`login:THREW(${id})`); throw new Error('OneSignal must be initialized before calling login'); }
        if (loginGate) await loginGate(id);           // [12c2] — a SLOW login, held open on purpose
        CALLS.push(`login(${id})`);
        user.externalId = String(id);
      },
      async logout() {
        if (!inited) { CALLS.push('logout:THREW'); throw new Error('OneSignal must be initialized before calling logout'); }
        CALLS.push('logout');
        user.externalId = '';
      },
      User: user,
      Notifications: { addEventListener() {}, async requestPermission() { CALLS.push('requestPermission'); } },
    };
  }
  function drain() {
    const pending = Array.isArray(globalThis.OneSignalDeferred) ? globalThis.OneSignalDeferred : [];
    globalThis.OneSignalDeferred = { push: (fn) => { fn(sdk); } };
    pending.forEach(fn => fn(sdk));     // INVOKED, not awaited in series — the SDK's own shape
  }

  function installWorld({ permission = 'granted', subscribed = true, initMs = 30, scriptMs = 5,
                          optInCreates = true, loginGate = null } = {}) {
    CALLS = [];
    sdk = makeSdk({ initMs, subscribed, optInCreates, loginGate });
    scriptDelayMs = scriptMs;
    globalThis.OneSignalDeferred = [];
    globalThis.document = {
      createElement: () => ({ src: '', defer: false, onload: null, onerror: null }),
      head: { appendChild(s) { const t = setTimeout(() => { drain(); s.onload?.(); }, scriptDelayMs); t?.unref?.(); } },
      body: { dataset: {} },
    };
    setNav({ userAgent: 'Mozilla/5.0 (Macintosh) Chrome/130', vendor: 'Google Inc.', maxTouchPoints: 0, serviceWorker: {} });
    globalThis.matchMedia = () => ({ matches: false });
    globalThis.Notification = { permission };
    globalThis.PushSubscriptionOptions = function () {};
    globalThis.PushSubscriptionOptions.prototype.applicationServerKey = null;
    // Answers config.json AND stays harmless to any backend.js push timer that
    // an earlier section left armed — this section waits on real timers, so a
    // debounced flushPush() can land inside it. The extra `ok/data/chatHead`
    // keys are exactly what js/backend.js's `call()` needs to not throw.
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ oneSignalAppId: 'abad65e9-0000-0000-0000-000000000000', ok: true, data: {}, chatHead: 0, count: 0 }),
    });
  }

  const push = await import('./js/push-onesignal.js');
  // Already evaluated by section [11]; this resolves the cached module, so the
  // push fixture installed above cannot re-run app.js's module-level work.
  const appMod = await import('./js/app.js');

  // ── [12a] THE REPRODUCTION — a Supabase boot, in its real order ────────────
  // The identity chokepoint runs before the boot tail, which is what a Supabase
  // boot always does. Nobody is linked afterwards.
  {
    installWorld();
    push._resetForTest({ sdkReadyMs: 400 });
    await keepAlive(push.loginOneSignal('p2'));      // app.js:3832 — resyncPlayerPreferences()
    await keepAlive(push.ensureOneSignalInit());     // app.js:1906 — runPostHydrateTail()
    await settle();
    assert(CALLS.includes('login(p2)'),
      `12a: A SUPABASE BOOT LINKS THE DEVICE. OneSignal.login('p2') must actually reach the SDK — an external id that was never attached is a player who receives nothing while notify-fanout records pushed:1 for them. Got ${JSON.stringify(CALLS)}`);
    assert(!CALLS.some(c => /THREW/.test(c)),
      `12a-1: …and it is never called against an uninitialised SDK. The throw is swallowed by a console.warn and never retried, which is why this has been silent since the cutover. Got ${JSON.stringify(CALLS)}`);
    assert(push.boundExternalId() === 'p2',
      '12a-2: …and the module can SAY which external id this device is bound to, so the honest status line and the commissioner\'s reachability check cannot disagree with the SDK');
  }

  // ── [12b] THE LATE SDK — a slow phone must still end up linked ────────────
  // ensureOneSignalInit() races SDK_READY_TIMEOUT_MS and resolves
  // {ok:false,'sdk-not-loaded'} when the SDK is slower than the bound. That
  // answer is deliberately NOT memoized, so a bounded retry finds the real one.
  {
    installWorld({ scriptMs: 320 });
    push._resetForTest({ sdkReadyMs: 60 });
    const init = await keepAlive(push.ensureOneSignalInit());
    assert(init.ok === false && init.reason === 'sdk-not-loaded',
      '12b: fixture — the SDK is slower than the ready bound, so the boot path gets sdk-not-loaded (exactly what a cold phone on hotel wifi gets)');
    await keepAlive(push.loginOneSignal('p3'));
    await settle(1500);
    assert(CALLS.includes('login(p3)'),
      `12b-1: A LATE SDK STILL GETS THE LOGIN. The retry is bounded, not infinite, and it exists because the alternative is a device that is silently unreachable for the whole session. Got ${JSON.stringify(CALLS)}`);
  }

  // ── [12c] ORDER IS STILL THE APP'S ORDER (DI-180q / security F-3) ─────────
  // The handover sequences logout-then-login deliberately. Awaiting init must
  // not reorder them, or the incoming player is bound to nobody — the exact
  // defect the serialization chain was written to prevent.
  {
    installWorld();
    push._resetForTest({ sdkReadyMs: 400 });
    const pOut = push.logoutOneSignal();
    const pIn = push.loginOneSignal('p4');
    await keepAlive(Promise.all([pOut, pIn]));
    await settle();
    const seq = CALLS.filter(c => c === 'logout' || c === 'login(p4)');
    assert(JSON.stringify(seq) === JSON.stringify(['logout', 'login(p4)']),
      `12c: logout-then-login still lands in call order. Got ${JSON.stringify(CALLS)}`);
    assert(push.boundExternalId() === 'p4',
      '12c-1: …and the device ends bound to the INCOMING player, not to nobody');
  }

  // ── [12d] A REAL SIGN-OUT STILL UNBINDS ──────────────────────────────────
  {
    installWorld();
    push._resetForTest({ sdkReadyMs: 400 });
    await keepAlive(push.loginOneSignal('p5'));
    await settle();
    await keepAlive(push.logoutOneSignal());
    await settle();
    assert(CALLS.includes('login(p5)') && CALLS.indexOf('logout') > CALLS.indexOf('login(p5)'),
      `12d: a sign-out after a session still calls OneSignal.logout() — a handed-off phone must stop receiving the previous player's pushes (DI-180q). Got ${JSON.stringify(CALLS)}`);
    assert(push.boundExternalId() === '',
      '12d-1: …and the module reports itself UNBOUND afterwards, so the status line says "not linked" rather than repeating the last player it saw');
  }

  // ── [12e] NO PROMPT, EVER, ON THE BOOT PATH ──────────────────────────────
  // Re-asserting identity must never raise the native permission sheet. A
  // never-asked device is linked-or-not silently; only the Turn On button asks.
  {
    installWorld({ permission: 'default' });
    let prompted = 0;
    const base = makeSdk({ initMs: 10 });
    sdk = { ...base, Notifications: { addEventListener() {}, async requestPermission() { prompted++; } } };
    push._resetForTest({ sdkReadyMs: 400 });
    await keepAlive(push.loginOneSignal('p6'));
    await settle();
    assert(prompted === 0,
      '12e: the boot-time re-assert NEVER calls requestPermission() — a permission sheet on first paint is a different bug and a worse one');
  }

  // ── [12f] THE HONEST STATUS LINE (UN-204's "push is on" must be TRUE) ────
  // Drew's iPhone: iOS Settings shows Pick 'Ems allowed, the app's 🔔 screen
  // shows no priming card at all and every box ticked — while OneSignal has no
  // subscription for it. renderPrimingCardHTML() returns '' for 'granted'
  // (app.js:4072), so permission-granted-but-unsubscribed is INVISIBLE and has
  // no button back. Three facts, not one: permission AND a subscription id AND
  // the external id attached.
  {
    installWorld({ subscribed: false });
    push._resetForTest({ sdkReadyMs: 400 });
    await keepAlive(push.ensureOneSignalInit());
    await settle();
    const st = await keepAlive(push.pushDeviceStatus());
    assert(st.permission === 'granted',
      '12f: fixture — the browser really has permission (this is the state that renders nothing today)');
    assert(st.hasSubscription === false && st.linked === false,
      `12f-1: …but the device has NO subscription and NO external id, and the status says so rather than staying silent. Got ${JSON.stringify(st)}`);
    assert(st.ok === false,
      '12f-2: …so "push is on for this device" is FALSE. It is an AND of the three facts — permission alone has never been enough, and saying so is the whole point of the line');

    installWorld({ subscribed: true });
    push._resetForTest({ sdkReadyMs: 400 });
    await keepAlive(push.loginOneSignal('p1'));
    await settle();
    const st2 = await keepAlive(push.pushDeviceStatus());
    assert(st2.ok === true && st2.linked === true && st2.hasSubscription === true,
      `12f-3: …and a genuinely reachable device reports ok — all three facts true, external id attached. Got ${JSON.stringify(st2)}`);
    assert(st2.externalId === 'p1' && !/@/.test(JSON.stringify(st2)),
      '12f-4: …reporting the league member id the app already renders everywhere, and no email or token (this line is meant to be read out to the commissioner)');
  }

  // ── [12h] THE SCREEN SAYS IT — app.js's own render, driven directly ──────
  // The status only helps if the player can see it, and the state that was
  // invisible is the one that had to change: permission granted, card empty.
  {
    const ON  = await appMod.renderNotifSettingsBodyHTML('p1', 'granted', { ok: true, hasSubscription: true, linked: true, permission: 'granted' });
    const OFF = await appMod.renderNotifSettingsBodyHTML('p1', 'granted', { ok: false, hasSubscription: false, linked: false, permission: 'granted' });
    const HALF = await appMod.renderNotifSettingsBodyHTML('p1', 'granted', { ok: false, hasSubscription: true, linked: false, permission: 'granted' });
    assert(/Push is on for this device/.test(ON),
      '12h: a genuinely reachable device says so in one line — the affirmative the 🔔 screen never had');
    assert(!/notif-priming-btn/.test(ON),
      '12h-1: …and offers NO button, because there is nothing to fix');
    assert(/isn't reaching this device/.test(OFF) && /notif-priming-btn/.test(OFF),
      `12h-2: THE REPORTED STATE — permission granted, no subscription — now renders a card AND the one button that fixes it. It rendered absolutely nothing before. Got: ${OFF.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 200)}`);
    assert(/isn't registered for push yet/.test(OFF) && /isn't linked to your account/.test(HALF),
      '12h-3: …and the two ways it can be broken get different sentences, because "no subscription" and "subscribed but unlinked" are different problems with the same symptom');
    assert(!/Push is on for this device/.test(OFF) && !/Push is on for this device/.test(HALF),
      '12h-4: …and neither broken state is ever allowed to claim push is on');
    const UNKNOWN = await appMod.renderNotifSettingsBodyHTML('p1', 'granted', null);
    assert(!/Push is on for this device/.test(UNKNOWN) && !/isn't reaching/.test(UNKNOWN),
      '12h-5: a status we could NOT resolve renders the old silence, never a guess in either direction');
  }

  // ── [12i] REVIEWER BLOCK — "Reconnect" MUST ACTUALLY RECONNECT ──────────
  // The card offered a Reconnect button for permission-granted-but-unsubscribed
  // and then called requestPushPermission(), whose Notifications.requestPermission()
  // resolves INSTANTLY when permission is already granted and creates nothing. It
  // then toasted "✅ Push enabled" over a device that was still unsubscribed —
  // a button that cannot fix the state it is offered for, and a success message
  // for a failure. Nothing in the app called optIn(), the v16 call that actually
  // creates the subscription.
  {
    installWorld({ permission: 'granted', subscribed: false });
    push._resetForTest();
    const out = await keepAlive(appMod.enablePushOnThisDevice('p1'));
    await settle();
    assert(CALLS.includes('optIn'),
      `12i: Reconnect calls OneSignal.User.PushSubscription.optIn() — the ONLY v16 call that creates a subscription. requestPermission() on an already-granted device creates nothing. Got ${JSON.stringify(CALLS)}`);
    assert(CALLS.indexOf('optIn') > -1 && CALLS.indexOf('optIn') < CALLS.indexOf('login(p1)'),
      `12i-1: …and the identity is asserted AFTER the subscription exists, so the external id lands on a real subscription. Got ${JSON.stringify(CALLS)}`);
    assert(out.ok === true && /Push is on for this device/.test(out.message),
      `12i-2: …and the success message is only reached once permission AND subscription AND linkage are all true — it RE-READS the device rather than trusting the call it just made. Got ${JSON.stringify(out.message)}`);

    // …and the failure direction: an optIn() that creates nothing must NOT report success.
    installWorld({ permission: 'granted', subscribed: false, optInCreates: false });
    push._resetForTest();
    const bad = await keepAlive(appMod.enablePushOnThisDevice('p1'));
    await settle();
    assert(bad.ok === false && !/Push is on/.test(bad.message),
      `12i-3: an optIn() that produced no subscription is NEVER reported as enabled — the re-read is what makes the message honest, and this is the assertion that fails if anyone trusts the call's own return. Got ${JSON.stringify(bad.message)}`);
    assert(/still isn't registered/.test(bad.message),
      `12i-4: …and it names the remaining problem and what to do, rather than "Could not enable push". Got ${JSON.stringify(bad.message)}`);
  }

  // ── [12j] COORDINATOR RULING — NO ACTION NEEDED FROM PLAYERS ─────────────
  // Five of six players cannot be asked to find a settings screen. Where
  // permission is ALREADY granted the subscription can be created with no
  // prompt at all, so boot does it: once per page, only for a signed-in linked
  // member whose master pref is on.
  {
    installWorld({ permission: 'granted', subscribed: false });
    push._resetForTest();
    appMod._resetAutoOptInForTest();
    const did = await keepAlive(appMod.maybeAutoOptInPush('p1'));
    await settle();
    assert(did === true && CALLS.includes('optIn'),
      `12j: a granted-but-unsubscribed device subscribes ITSELF at boot — the player does nothing. Got ${JSON.stringify(CALLS)}`);
    assert(!CALLS.includes('requestPermission'),
      `12j-1: …and NO permission request is made on this path, ever. It is prompt-free by construction (permission is already granted); a prompt on first paint would be a worse bug than the one being fixed. Got ${JSON.stringify(CALLS)}`);
    assert(CALLS.includes('login(p1)'),
      '12j-2: …and the external id is attached to the subscription it just created');

    // ONCE PER PAGE.
    const again = await keepAlive(appMod.maybeAutoOptInPush('p1'));
    assert(again === false,
      '12j-3: once per page load — a boot path that can re-enter must not re-run it');

    // NOT when the player has switched push off.
    installWorld({ permission: 'granted', subscribed: false });
    push._resetForTest(); appMod._resetAutoOptInForTest();
    // The preference lives on the PLAYER RECORD (storage.js:733), which is the
    // same place js/notifications.js reads it from when it decides whom to send
    // to — so the fixture sets it there rather than through a session-scoped
    // writer that would prove nothing about the id being bound.
    const priorP1 = (storage.getPlayers() || []).find(x => x.playerId === 'p1') || null;
    storage.savePlayer({ playerId: 'p1', displayName: 'Drew', active: true, preferences: { notifyPushMaster: false } });
    const offRes = await keepAlive(appMod.maybeAutoOptInPush('p1'));
    await settle();
    assert(offRes === false && !CALLS.includes('optIn'),
      `12j-4: MASTER OFF means the player said no. Subscribing them anyway would be the app overriding a preference it is supposed to honour. Got ${JSON.stringify(CALLS)}`);
    storage.savePlayer(priorP1 || { playerId: 'p1', displayName: 'Drew', active: true, preferences: { notifyPushMaster: true } });

    // NOT when permission was never asked for, and NOT when it was refused.
    for (const perm of ['default', 'denied']) {
      installWorld({ permission: perm, subscribed: false });
      push._resetForTest(); appMod._resetAutoOptInForTest();
      const r = await keepAlive(appMod.maybeAutoOptInPush('p1'));
      await settle();
      assert(r === false && !CALLS.includes('optIn') && !CALLS.includes('requestPermission'),
        `12j-5 (${perm}): without permission already granted this path does NOTHING — optIn() would raise the very prompt this must never raise. Got ${JSON.stringify(CALLS)}`);
    }

    // NOT for a signed-out device — there is no member id to attach.
    installWorld({ permission: 'granted', subscribed: false });
    push._resetForTest(); appMod._resetAutoOptInForTest();
    const anon = await keepAlive(appMod.maybeAutoOptInPush(null));
    await settle();
    assert(anon === false && !CALLS.includes('optIn'),
      '12j-6: …and not for a signed-out device: a subscription with nobody attached is exactly the orphan this whole fix is about');

    // STRUCTURAL — it is actually wired into boot, not merely exported.
    const appSrc12 = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
    const bootBlock12 = (appSrc12.match(/Groups A\/B — notifications boot wiring[\s\S]{0,4500}?refreshPushActiveFlag\(\);/) || [''])[0];
    assert(bootBlock12.includes('maybeAutoOptInPush('),
      '12j-7: …and the boot wiring really calls it — an exported function nothing calls fixes nobody');
  }

  // ── [12k] REVIEWER — "I COULD NOT CHECK" IS NOT "NOT REGISTERED" ────────
  // A blocked/unloaded SDK cannot answer, and reporting that as "this device
  // isn't registered" offers a Reconnect button that cannot keep its promise.
  {
    installWorld({ permission: 'granted', subscribed: true, scriptMs: 100000 });   // the SDK never lands
    push._resetForTest({ sdkReadyMs: 40 });
    const st = await keepAlive(push.pushDeviceStatus());
    assert(st.known === false && st.ok === false,
      `12k: an SDK that never answers resolves UNKNOWN, not "not registered" — and unknown is never ok. Got ${JSON.stringify(st)}`);
    const card = await appMod.renderNotifSettingsBodyHTML('p1', 'granted', st);
    assert(/didn't load/.test(card) && !/notif-priming-btn/.test(card),
      `12k-1: …and the card says we could not check, with NO button — a Reconnect that cannot reach the SDK is a promise the app cannot keep. Got: ${card.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 220)}`);
    assert(!/isn't registered for push yet/.test(card),
      '12k-2: …and it never uses the "not registered" sentence, which would be a claim about the device we did not actually make');
  }

  // ── [12k2] THE EXTERNAL ID COMES FROM THE SDK WHEN THE SDK KNOWS IT ─────
  {
    installWorld({ permission: 'granted', subscribed: true });
    push._resetForTest();
    await keepAlive(push.loginOneSignal('p1'));
    await settle();
    const st = await keepAlive(push.pushDeviceStatus());
    assert(st.externalId === 'p1' && st.known === true && st.ok === true,
      `12k2: the status reads OneSignal.User.externalId — the SDK's own answer outranks this page's memory of what it asked for. Got ${JSON.stringify(st)}`);
  }

  // ── [12c2] SECURITY F-2 — A SLOW CALL MUST NOT WIN ──────────────────────
  // _callSdk deliberately does not hold the chain, so a slow login(A) can land
  // AFTER a later logout()/login(B). Landing late must not be allowed to leave
  // the SDK on the superseded identity: the stale completion re-asserts whatever
  // the app currently wants.
  {
    let releaseA = null;
    installWorld({ permission: 'granted', subscribed: true,
      loginGate: (id) => (id === 'A' ? new Promise(r => { releaseA = r; }) : Promise.resolve()) });
    push._resetForTest();
    await keepAlive(push.loginOneSignal('A'));     // queued and INVOKED, now hanging inside login('A')
    await settle(60);
    await keepAlive(push.logoutOneSignal());
    await settle(60);
    releaseA?.();                                   // the stale login finally lands
    await settle(300);
    assert(CALLS[CALLS.length - 1] === 'logout',
      `12c2: a slow login('A') that resolves AFTER a sign-out leaves the device LOGGED OUT — the stale completion re-asserts the current target instead of silently winning. Got ${JSON.stringify(CALLS)}`);
    assert(push.boundExternalId() === '',
      '12c2-1: …and the module agrees it is unbound, so the status line cannot claim a linkage the SDK no longer has');

    let releaseA2 = null;
    installWorld({ permission: 'granted', subscribed: true,
      loginGate: (id) => (id === 'A' ? new Promise(r => { releaseA2 = r; }) : Promise.resolve()) });
    push._resetForTest();
    await keepAlive(push.loginOneSignal('A'));
    await settle(60);
    await keepAlive(push.loginOneSignal('B'));
    await settle(60);
    releaseA2?.();
    await settle(300);
    assert(CALLS[CALLS.length - 1] === 'login(B)',
      `12c2-2: …and after a player switch the device ends on B, never back on A. Got ${JSON.stringify(CALLS)}`);
    assert(push.boundExternalId() === 'B', '12c2-3: …and the binding says B');
  }

  // ── [12g] STRUCTURAL — nothing may call the SDK ahead of init again ──────
  // The defect was an ORDERING one, and an ordering defect walks back in the
  // moment someone adds a second `OneSignalDeferred.push` beside the first. Every
  // SDK call in the module goes through one helper that awaits init.
  {
    const src = await readFile(new URL('./js/push-onesignal.js', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    const userCalls = code.match(/OneSignal\.(login|logout)\s*\(/g) || [];
    assert(userCalls.length === 2,
      `12g: exactly ONE call site each for OneSignal.login()/logout() (got ${userCalls.length}) — two call sites is two orderings, and one of them will be the wrong one`);
    const idx = code.indexOf('async function _assertIdentity');
    assert(idx > -1 && /await ensureOneSignalInit\(\)/.test(code.slice(idx, idx + 1600)),
      '12g-1: …and that call site awaits ensureOneSignalInit() before it touches the SDK. Deleting the await is the mutation this section exists to catch');
  }

  // Restore the suite's own globals — every later section (and any suite that
  // imports this one's modules) must not inherit a push fixture.
  globalThis.document = savedG.document; setNav(savedG.navigator); globalThis.fetch = savedG.fetch;
  globalThis.matchMedia = savedG.matchMedia; globalThis.Notification = savedG.Notification;
  globalThis.PushSubscriptionOptions = savedG.PushSubscriptionOptions;
  globalThis.OneSignalDeferred = savedG.OneSignalDeferred;
  push._resetForTest();
}

// ═════════════════════════════════════════════════════════════════════════════
console.log(`\n${fail === 0 ? '✅' : '❌'} pushtest: ${pass} passed, ${fail} failed`);
// REVIEWER F3 (seventh gate, 2026-09-17) — FLUSH BEFORE EXITING.
// `process.exit()` does not drain stdout/stderr, and both are ASYNCHRONOUS
// whenever they are a pipe — which is what they are under loadtest.mjs's
// spawnSync() and under every `| grep` a human runs. So the one summary line a
// parent suite parses can be dropped from a run that really did finish, and a
// FAILING run whose line never arrives reads as a harness problem instead. The
// nested empty writes' callbacks fire only once every earlier write on that
// stream has reached the OS; BOTH streams are drained because loadtest.mjs
// parses `stdout + stderr`. Same fix as authtest.mjs/boottest.mjs, applied
// without changing one character of what is printed.
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));

// ── SECURITY F-6 (eighth gate, 2026-09-18) — THE FLUSH SHIM NEEDS ITS OWN
//    BACKSTOP ─────────────────────────────────────────────────────────────────
// The write-then-exit-in-the-callback shim above (reviewer F-3, seventh gate)
// fixed a dropped summary line by making the exit wait for the bytes. That trade
// bought correctness with a new failure mode: if the callback NEVER fires, the
// process never exits. It does not fire when the reader at the other end of the
// pipe has gone away mid-write, when stdout is a full pipe nobody is draining,
// or when an imported module has wedged the event loop — and loadtest.mjs runs
// every one of these suites through spawnSync(), which has no timeout and would
// simply hang the whole sweep with no output to say which suite did it.
//
// So the exit is armed twice. The callback is still the fast path and still the
// one that runs on every healthy run; this timer only ever fires if that path
// did not. .unref() is what keeps it honest — an unref'd timer does not hold the
// event loop open on its own account, so it cannot delay a natural exit by five
// seconds or resurrect a process that was ready to leave. It just makes "hang
// forever" impossible.
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
