/**
 * CFB Pickems — Google Apps Script Backend (Phase II)
 * =====================================================
 * A tiny key/value store backed by a Google Sheet, exposed as a web app.
 * The client (storage.js → backend.js) keeps the SAME key names it uses in
 * localStorage; this script just persists those JSON blobs so every player's
 * device shares one source of truth.
 *
 * DATA MODEL
 *   One Google Sheet named "CFBP_STORE" with a header row:
 *       key | json | updatedAt
 *   Each app storage key (cfbp_players, cfbp_weeks, cfbp_games, …) is one row.
 *   The "json" cell holds the stringified value. That's it — simple and robust.
 *
 *   A second optional tab "CFBP_SNAPSHOTS" stores timestamped full backups
 *   (one row per backup) so you can roll back a season.
 *
 * SECURITY
 *   - A shared SECRET token gates all writes (and reads, if you set
 *     REQUIRE_TOKEN_FOR_READ = true). The token lives in Script Properties,
 *     NOT in the client source. The client sends it in the request body.
 *   - This is "good enough" for a private friends league. It is NOT bank-grade.
 *     Anyone with the token + URL can read/write. Keep the URL private.
 *
 * ENDPOINTS (all POST to the web-app URL; GET supported for quick health check)
 *   action: "ping"      -> { ok:true, time }
 *   action: "getAll"    -> { ok:true, data:{ key: value, ... } }
 *   action: "get"       -> { key }                 -> { ok:true, key, value }
 *   action: "set"       -> { key, value }          -> { ok:true }
 *   action: "setMany"   -> { entries:{k:v,...} }   -> { ok:true, count }
 *   action: "snapshot"  -> { label? }              -> { ok:true, id }
 *   action: "listSnapshots" ->                     -> { ok:true, snapshots:[...] }
 *   action: "restoreSnapshot" -> { id }            -> { ok:true }
 *
 * SETUP — see backend/SETUP.md for the click-by-click. In short:
 *   1. Create a Google Sheet, Extensions → Apps Script, paste this file.
 *   2. Run setup() once (creates tabs + a random token; grant permissions).
 *   3. Deploy → New deployment → Web app → Execute as: Me,
 *      Who has access: Anyone → copy the /exec URL.
 *   4. Read the token: run logToken() and copy it from the execution log,
 *      OR open Project Settings → Script Properties.
 *   5. Paste URL + token into the app's Commissioner → Backend settings.
 */

// ── Config ────────────────────────────────────────────────────────────────────
var STORE_SHEET    = 'CFBP_STORE';
var MSG_SHEET      = 'CFBP_MESSAGES';   // v0.16.0 — append-only chat event log
var SNAP_SHEET     = 'CFBP_SNAPSHOTS';
var REQUIRE_TOKEN_FOR_READ = false;   // set true to also gate reads
var TOKEN_PROP     = 'CFBP_TOKEN';

// ── One-time setup ──────────────────────────────────────────────────────────
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var store = ss.getSheetByName(STORE_SHEET);
  if (!store) {
    store = ss.insertSheet(STORE_SHEET);
    store.getRange(1, 1, 1, 3).setValues([['key', 'json', 'updatedAt']]);
    store.setFrozenRows(1);
  }
  var snap = ss.getSheetByName(SNAP_SHEET);
  if (!snap) {
    snap = ss.insertSheet(SNAP_SHEET);
    snap.getRange(1, 1, 1, 4).setValues([['id', 'label', 'json', 'createdAt']]);
    snap.setFrozenRows(1);
  }
  ensureMsgSheet();
  ensureMetricsSheet();
  // Generate a token if none exists
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty(TOKEN_PROP)) {
    var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
    props.setProperty(TOKEN_PROP, token);
  }
  Logger.log('Setup complete. Token: ' + props.getProperty(TOKEN_PROP));
  return 'OK';
}

function logToken() {
  Logger.log('CFBP token: ' + PropertiesService.getScriptProperties().getProperty(TOKEN_PROP));
}

// Optional: rotate the token (invalidates all existing clients)
function rotateToken() {
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  PropertiesService.getScriptProperties().setProperty(TOKEN_PROP, token);
  Logger.log('New token: ' + token);
  return token;
}

// ── HTTP entry points ─────────────────────────────────────────────────────────
function doGet(e) {
  // Health check / simple read via querystring (?action=ping)
  return handle(e && e.parameter ? e.parameter : {}, true);
}
function doPost(e) {
  var body = {};
  try { body = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {}; }
  catch (err) { return json({ ok: false, error: 'Bad JSON body' }); }
  return handle(body, false);
}

function handle(req, isGet) {
  var action = req.action || 'ping';

  if (action === 'ping') {
    return json({ ok: true, time: new Date().toISOString(), service: 'cfbp-backend', version: 2 });
  }

  var token = PropertiesService.getScriptProperties().getProperty(TOKEN_PROP);
  var writeActions = { set: 1, setMany: 1, snapshot: 1, restoreSnapshot: 1, chatAppend: 1 };
  var needsToken = writeActions[action] || REQUIRE_TOKEN_FOR_READ;
  if (needsToken && req.token !== token) {
    return json({ ok: false, error: 'Unauthorized' });
  }

  try {
    switch (action) {
      case 'getAll':          return json({ ok: true, data: getAll(), chatHead: msgHeadCached() });
      case 'get':             return json({ ok: true, key: req.key, value: getOne(req.key) });
      case 'set':             setOne(req.key, req.value); return json({ ok: true });
      case 'setMany':         return json({ ok: true, count: setMany(req.entries || {}) });
      case 'snapshot':        return json({ ok: true, id: makeSnapshot(req.label || '') });
      case 'listSnapshots':   return json({ ok: true, snapshots: listSnapshots() });
      case 'restoreSnapshot': restoreSnapshot(req.id); return json({ ok: true });
      // ── Chat (v0.17.0) — append-only event log, one room + gameTag ──
      case 'chatHead':        return json({ ok: true, head: msgHeadCached() });
      case 'chatAppend':      return json(chatAppend(req.events || []));
      case 'chatSince':       return json(chatSince(Number(req.seq || 0), Number(req.limit || 500)));
      case 'chatBefore':      return json(chatBefore(Number(req.seq || 0), Number(req.limit || 100)));
      case 'presence':        return json(presenceBeat(String(req.player || ''), Number(req.seen || 0)));
      case 'chatMetrics':     return json({ ok: true, rows: readMetrics(Number(req.days || 7)) });
      default:                return json({ ok: false, error: 'Unknown action: ' + action });
    }
  } catch (err) {
    return json({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

// ── Store helpers ───────────────────────────────────────────────────────────
function storeSheet() {
  var s = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(STORE_SHEET);
  if (!s) throw new Error('Store not initialized — run setup() first.');
  return s;
}

// ── Cell-cap chunking (Item CAP, 2026-09-04) ────────────────────────────────
// A Sheets cell caps at 50,000 chars. cfbp_picks (238 chars/pick × 60/week)
// crosses that around WEEK 3 and cfbp_games around week 5 — keys we cannot make
// device-local, because they ARE the shared league record. setMany() used to
// write each value into a single cell with no size check, so an over-cap value
// made Apps Script throw and failed the whole batch (RG-56). This splits a value
// too large for one cell across several cells and reassembles it on read.
//
// A logical key `K` whose JSON exceeds CELL_SAFE_LIMIT is stored as:
//   row  K                      -> the marker string  CHUNK_MARK + <gen> + ':' + <partCount>
//   row  K + CHUNK_TAG + <gen>0 -> chunk 0 (up to CELL_SAFE_LIMIT chars)
//   row  K + CHUNK_TAG + <gen>1 -> chunk 1
//   ...
// <gen> is 'A' or 'B'. A JSON string never begins with '_' (objects '{', arrays
// '[', strings '"', numbers/true/false/null with their own leads), so CHUNK_MARK
// can never collide with a real stored value, and a legacy single-cell row reads
// back unchanged — BACKWARD COMPATIBLE with every value already in the Sheet.
//
// GENERATION PING-PONG (Item CAP hardening, 2026-09-05). A chunked→chunked UPDATE
// must NOT overwrite the live prior fragments before the marker flip, or a crash
// mid-write leaves a reader reassembling new-front + old-tail → a corrupt value.
// So a new chunked write lands on the INACTIVE generation's FRESH rows and the
// marker atomically repoints from the old generation to the new. The dead
// generation is blanked AFTER the flip, and those blank rows are REUSED by the
// next write (putCell pulls from a free-row pool), so growth is bounded to ~2×
// fragments — no row is leaked per write. Legacy generation-less markers
// (CHUNK_MARK + <n>) still read via the old <key>+PART+i fragment keys.
//
// THIS BLOCK IS THE TESTED TWIN OF backend/chunkstore.mjs. captest.mjs runs that
// module and greps this file to confirm the two have not drifted (twin-sync).
// Keep the constants and control flow in step with chunkstore.mjs. A deploy is
// still MANUAL: Deploy → Manage deployments → Edit → New version, same deployment.
var CELL_SAFE_LIMIT = 45000;            // chars per cell; < 50,000 hard cap, with headroom
var CHUNK_MARK = '__CFBP_CHUNKED__';    // primary-cell marker: CHUNK_MARK + <gen> + ':' + <partCount>  (legacy: CHUNK_MARK + <partCount>)
var CHUNK_TAG  = '__CFBP_PART__';       // chunk-row key = <key> + CHUNK_TAG + <gen?> + <index>

function chunkKey(key, gen, i) { return key + CHUNK_TAG + (gen === null || gen === undefined ? '' : gen) + i; }
function isChunkKey(key) { return String(key).indexOf(CHUNK_TAG) !== -1; }

/** Parse a marker cell -> {gen, n} or null. Generational "A:5"/"B:5", or legacy
 *  generation-less "5" (gen=null, read via the old <key>+PART+i fragment keys). */
function parseMarker(raw) {
  if (typeof raw !== 'string' || raw.indexOf(CHUNK_MARK) !== 0) return null;
  var rest = raw.slice(CHUNK_MARK.length);
  var m = /^([AB]):(\d+)$/.exec(rest);
  if (m) return { gen: m[1], n: parseInt(m[2], 10) };
  if (/^\d+$/.test(rest)) return { gen: null, n: parseInt(rest, 10) };
  return null;
}

/** The generation a NEW chunked write targets, given the prior marker. Ping-pong
 *  A↔B; a legacy/non-chunked prior gets 'A' (its rows never collide with legacy). */
function nextGen(priorRaw) {
  var m = parseMarker(priorRaw);
  return (m && m.gen === 'A') ? 'B' : 'A';
}

/** Reassemble the raw JSON string for `key` from a map of every row's raw cell.
 *  Returns undefined when absent; a legacy row returns its cell text unchanged. */
function readRaw(key, rawByKey) {
  var raw = rawByKey[key];
  if (raw === undefined) return undefined;
  var m = parseMarker(raw);
  if (m) {
    var joined = '';
    for (var i = 0; i < m.n; i++) {
      var part = rawByKey[chunkKey(key, m.gen, i)];
      joined += (part === undefined || part === null) ? '' : String(part);
    }
    return joined;
  }
  return raw;
}

/** Write one logical key: one cell if it fits, else fresh-generation chunk rows
 *  + a marker row. `rowByKey` maps a physical row key -> its 1-based sheet row;
 *  `freeRows` is a pool of blank rows (from prior orphan cleanup) that putCell
 *  reuses before appending, which is what bounds row growth across ping-pong.
 *  `priorRaw` is the current marker cell, so a chunked→chunked write can pick the
 *  INACTIVE generation. */
function writeValue(s, rowByKey, freeRows, key, str, priorRaw, now) {
  if (typeof str !== 'string') str = 'null';            // JSON.stringify(undefined)
  if (str.length <= CELL_SAFE_LIMIT) {
    putCell(s, rowByKey, freeRows, key, str, now);      // single cell holds the value directly
    clearOrphanChunks(s, rowByKey, freeRows, key, null, 0, now);   // a prior chunked value's fragments are all orphans now
    return;
  }
  var gen = nextGen(priorRaw);                           // land on the INACTIVE generation
  var n = Math.ceil(str.length / CELL_SAFE_LIMIT);
  // FRESH-GENERATION FRAGMENTS FIRST, MARKER LAST. Writing the marker is the
  // atomic commit: because the fragments go to the inactive generation's rows,
  // the live prior value (old marker + old generation) is untouched until the
  // marker flips. A crash before the flip leaves a reader following the OLD
  // marker to intact OLD fragments — never a new-front/old-tail mixture.
  for (var i = 0; i < n; i++) {
    putCell(s, rowByKey, freeRows, chunkKey(key, gen, i), str.slice(i * CELL_SAFE_LIMIT, (i + 1) * CELL_SAFE_LIMIT), now);
  }
  putCell(s, rowByKey, freeRows, key, CHUNK_MARK + gen + ':' + n, now);   // flip the marker LAST — the commit
  clearOrphanChunks(s, rowByKey, freeRows, key, gen, n, now);             // blank the dead generation + any stragglers
}

/** Blank every chunk-fragment row of `key` that is NOT part of the live set
 *  (`gen`, `keepParts`): the whole other generation, any legacy fragments, and
 *  any higher-index fragment of the same generation. keepParts === 0 (single
 *  cell) orphans EVERY fragment. Rows are BLANKED (key + json cleared), not
 *  deleted: deleteRow would reshuffle every 1-based index cached in rowByKey
 *  mid-batch. A blanked row is skipped by getAll's `key === ''` guard, and it is
 *  pushed onto `freeRows` so the NEXT write reuses it instead of appending —
 *  that reuse is what keeps the ping-pong bounded to ~2× fragments. */
function clearOrphanChunks(s, rowByKey, freeRows, key, gen, keepParts, now) {
  var prefix = key + CHUNK_TAG;
  var keep = {};
  for (var i = 0; i < keepParts; i++) keep[chunkKey(key, gen, i)] = true;
  Object.keys(rowByKey).forEach(function (k) {
    if (k.indexOf(prefix) !== 0) return;
    if (keep[k]) return;
    var row = rowByKey[k];
    s.getRange(row, 1, 1, 3).setValues([['', '', now]]);
    delete rowByKey[k];
    freeRows.push(row);                                 // reclaimed — reused before any append
  });
}

/** Overwrite the json+updatedAt of an existing row, reuse a reclaimed blank row,
 *  or append a new one. The free-row pool is drained before appending so blanked
 *  orphans from prior writes are recycled rather than left to accumulate.
 *
 * The json cell is forced to PLAIN-TEXT format ('@') before the value is set.
 * setValues() otherwise coerces a string that looks like a number/date/boolean
 * to its typed value — harmless for the primary cell (JSON always begins with
 * {, [, or ") but NOT for a chunk fragment, whose split boundary can land on an
 * all-numeric substring that Sheets would store as a lossy number and corrupt on
 * reassembly. Text format on write, plus String() on read (readRaw), closes it.
 * (Apps-Script-only behaviour; verified only by a real deploy, not by node.) */
function putCell(s, rowByKey, freeRows, key, str, now) {
  var row;
  if (rowByKey[key]) {
    row = rowByKey[key];
  } else if (freeRows.length) {
    row = freeRows.shift();                             // recycle a blanked orphan row
    s.getRange(row, 1).setValue(key);
    rowByKey[key] = row;
  } else {
    row = s.getLastRow() + 1;
    s.getRange(row, 1).setValue(key);
    rowByKey[key] = row;
  }
  s.getRange(row, 2).setNumberFormat('@');          // json column -> plain text
  s.getRange(row, 2, 1, 2).setValues([[str, now]]);
}

function getAll() {
  var s = storeSheet();
  var values = s.getDataRange().getValues();
  var rawByKey = {};
  for (var i = 1; i < values.length; i++) {
    var k = values[i][0];
    if (k === '' || k === null) continue;
    rawByKey[String(k)] = values[i][1];
  }
  var out = {};
  Object.keys(rawByKey).forEach(function (key) {
    if (isChunkKey(key)) return;                          // fragments are not app keys
    var raw = readRaw(key, rawByKey);
    out[key] = (raw === '' || raw === undefined || raw === null) ? null : safeParse(raw);
  });
  return out;
}

function getOne(key) {
  var s = storeSheet();
  var values = s.getDataRange().getValues();
  var rawByKey = {};
  for (var i = 1; i < values.length; i++) {
    var k = values[i][0];
    if (k === '' || k === null) continue;
    rawByKey[String(k)] = values[i][1];
  }
  var raw = readRaw(key, rawByKey);
  return (raw === '' || raw === undefined || raw === null) ? null : safeParse(raw);
}

// Build the row index the write path needs: rowByKey maps a live physical row
// key -> its 1-based row; freeRows collects blank rows (from prior orphan
// cleanup) for putCell to recycle; rawByKey maps a live key -> its json cell so
// writeValue can read the PRIOR marker and pick the inactive generation.
function scanStore(values) {
  var rowByKey = {}, rawByKey = {}, freeRows = [];
  for (var i = 1; i < values.length; i++) {
    var k = values[i][0];
    if (k === '' || k === null) { freeRows.push(i + 1); continue; }
    rowByKey[String(k)] = i + 1;
    rawByKey[String(k)] = values[i][1];
  }
  return { rowByKey: rowByKey, rawByKey: rawByKey, freeRows: freeRows };
}

// ── Concurrent-writer guard (Item CAP, 2026-09-05) ──────────────────────────
// setMany/setOne mutate the chunked store as a read-marker → write-fragments →
// flip-marker → cleanup sequence. The generation ping-pong makes that sequence
// SINGLE-WRITER crash-atomic, but NOT concurrent-writer atomic: two Apps Script
// executions writing the SAME over-cap key in the same window would both read
// prior marker A, both pick generation B (nextGen of A), interleave their B
// fragments onto the same rows, and both flip the marker to B:n → mixed
// reassembly → safeParse downgrade → silent corruption of the value. cfbp_picks
// holds all six players' picks, so two near-simultaneous submissions past the
// cap (~week 3) is a realistic path — this is the pick-integrity failure class.
//
// Only a lock closes it. This mirrors chatAppend's LockService discipline
// exactly: one SCRIPT lock, a 10s wait budget, always released in a finally. The
// lock must span the ENTIRE read-then-write, not the individual cell writes — if
// it only covered the flip, both writers could still read marker A and both pick
// generation B before either flipped. On failure to acquire, waitLock THROWS;
// handle()'s catch turns that into { ok:false, error } and the client treats the
// push as failed and retries — loud-fail (never a silently dropped write).
//
// Reads (getAll/getOne) deliberately take NO lock. Each is a single
// getDataRange().getValues() snapshot, and because writeValue writes all
// fragments BEFORE flipping the marker (marker cell last), any snapshot reads
// either the old marker → intact prior generation, or the new marker → the
// fully-written new generation. Never a mixture. Locking reads would only add
// contention on the hot getAll path for no correctness gain.
function withStoreLock(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);                                  // same wait budget as chatAppend; throws on failure → loud-fail
  try { return fn(); }
  finally { lock.releaseLock(); }                        // always released, even when fn throws
}

function setOne(key, value) {
  if (!key) throw new Error('Missing key');
  return withStoreLock(function () {
    var s = storeSheet();
    var m = scanStore(s.getDataRange().getValues());
    writeValue(s, m.rowByKey, m.freeRows, key, JSON.stringify(value), m.rawByKey[key], new Date().toISOString());
  });
}

function setMany(entries) {
  return withStoreLock(function () {
    var s = storeSheet();
    var m = scanStore(s.getDataRange().getValues());
    var now = new Date().toISOString();
    var count = 0;
    Object.keys(entries).forEach(function (key) {
      writeValue(s, m.rowByKey, m.freeRows, key, JSON.stringify(entries[key]), m.rawByKey[key], now);
      count++;
    });
    return count;
  });
}

// ── Snapshots (season backups / rollback) ─────────────────────────────────────
function snapSheet() {
  var s = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SNAP_SHEET);
  if (!s) throw new Error('Snapshots not initialized — run setup() first.');
  return s;
}

// Append one row to CFBP_SNAPSHOTS with the json column forced to plain text,
// so a fragment whose split boundary lands on an all-numeric substring is not
// coerced to a lossy number (same reason putCell does it for the store).
function snapAppend(s, rowVals) {
  var row = s.getLastRow() + 1;
  s.getRange(row, 3).setNumberFormat('@');            // json column -> plain text
  s.getRange(row, 1, 1, 4).setValues([rowVals]);
}

// Item CAP NOTE 3 (2026-09-04). The full reassembled store crosses the 50,000-char
// cell cap on the same week 3–5 timeline as cfbp_picks/cfbp_games, so a single-cell
// snapshot payload would throw exactly when the season is largest — and restore
// snapshots first, so rollback would be dead too. The payload now rides the SAME
// chunk convention as CFBP_STORE: fragment rows keyed <id> + CHUNK_TAG + i written
// FIRST, then the marker row <id> holding CHUNK_MARK + n LAST (NOTE 1's ordering).
// A payload that fits stays a single row, byte-for-byte — old snapshots read back
// unchanged. Snapshots are APPEND-ONLY with a fresh id every time, so there is no
// in-place-overwrite hazard: they keep the legacy generation-less fragment keys
// (chunkKey(id, null, i)) and marker (CHUNK_MARK + n), which readRaw reads via the
// gen=null branch. Generations exist only for the mutated-in-place store rows.
function makeSnapshot(label) {
  var all = getAll();
  var id = 'snap_' + Date.now();
  var s = snapSheet();
  var now = new Date().toISOString();
  var str = JSON.stringify(all);
  if (str.length <= CELL_SAFE_LIMIT) {
    snapAppend(s, [id, label || '', str, now]);
    return id;
  }
  var n = Math.ceil(str.length / CELL_SAFE_LIMIT);
  for (var i = 0; i < n; i++) {
    snapAppend(s, [chunkKey(id, null, i), '', str.slice(i * CELL_SAFE_LIMIT, (i + 1) * CELL_SAFE_LIMIT), now]);
  }
  snapAppend(s, [id, label || '', CHUNK_MARK + n, now]);   // marker row LAST — the commit
  return id;
}

function listSnapshots() {
  var s = snapSheet();
  var values = s.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var rid = values[i][0];
    if (rid === '' || rid === null || isChunkKey(rid)) continue;   // skip blanks + fragment rows
    out.push({ id: rid, label: values[i][1], createdAt: values[i][3] });
  }
  return out.reverse(); // newest first
}

function restoreSnapshot(id) {
  if (!id) throw new Error('Missing snapshot id');
  var s = snapSheet();
  var values = s.getDataRange().getValues();
  // Map every snapshot row's id -> its json cell, then reassemble through the same
  // readRaw the store uses. A legacy single-cell snapshot has no marker and reads
  // straight through — backward compatible with every backup already on the Sheet.
  var rawById = {};
  for (var i = 1; i < values.length; i++) {
    var rid = values[i][0];
    if (rid === '' || rid === null) continue;
    rawById[String(rid)] = values[i][2];
  }
  var raw = readRaw(String(id), rawById);
  if (raw === undefined) throw new Error('Snapshot not found: ' + id);
  var data = safeParse(raw) || {};
  // Take a safety snapshot of current state before overwriting
  makeSnapshot('auto-before-restore-' + id);
  setMany(data);
}


// ── Chat event log (v0.16.0) ─────────────────────────────────────────────────
// Append-only. Rows are NEVER mutated or deleted. Columns:
//   A seq (server-assigned monotonic int — also the row order)
//   B id  (client UUID — idempotent dedupe key)
//   C ts  (server epoch ms — authoritative ordering aid)
//   D type / E author / F channel / G body / H targetId / I replyTo / J meta(JSON)
//
// Because seq is assigned under LockService and the row is appended in the same
// critical section, row (seq + 1) always holds event seq. chatSince/chatBefore
// exploit that for O(limit) reads instead of scanning the whole sheet.

var MSG_HEADER = ['seq','id','ts','type','author','channel','body','targetId','replyTo','meta'];

function ensureMsgSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var s = ss.getSheetByName(MSG_SHEET);
  if (!s) {
    s = ss.insertSheet(MSG_SHEET);
    s.getRange(1, 1, 1, MSG_HEADER.length).setValues([MSG_HEADER]);
    s.setFrozenRows(1);
  }
  return s;
}

function msgHead(s) {
  // Current max seq = number of data rows (seq starts at 1, contiguous).
  return Math.max(0, s.getLastRow() - 1);
}

// v0.17.0 — HOT PATH. Six clients poll the head constantly; serve it from
// CacheService (5s TTL) so a cache hit never touches the sheet. Invalidated
// (overwritten) on every successful append.
function msgHeadCached() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('chatHead');
  if (hit !== null) { bump('headHit'); return Number(hit); }
  bump('headMiss');
  var head = msgHead(ensureMsgSheet());
  cache.put('chatHead', String(head), 5);
  return head;
}

// ── Presence (v0.17.0) — CacheService only, ZERO sheet writes ──
// Each beat stores {ts, seen} under a per-player key (120s TTL). The response
// lists everyone seen in the last 90s, and each player's lastSeenSeq — which is
// what makes read receipts possible without any new storage.
function presenceBeat(playerId, seenSeq) {
  var cache = CacheService.getScriptCache();
  var now = Date.now();
  if (playerId) {
    cache.put('pr_' + playerId, JSON.stringify({ ts: now, seen: seenSeq || 0 }), 120);
    var roster = {};
    try { roster = JSON.parse(cache.get('pr_roster') || '{}'); } catch (e) { roster = {}; }
    roster[playerId] = now;
    cache.put('pr_roster', JSON.stringify(roster), 3600);
  }
  var out = [];
  var roster2 = {};
  try { roster2 = JSON.parse(cache.get('pr_roster') || '{}'); } catch (e) { roster2 = {}; }
  for (var pid in roster2) {
    var raw = cache.get('pr_' + pid);
    if (!raw) continue;
    try {
      var rec = JSON.parse(raw);
      if (now - rec.ts <= 90000) out.push({ playerId: pid, ts: rec.ts, seen: rec.seen || 0 });
    } catch (e) {}
  }
  return { ok: true, present: out };
}

// ── ChatMetrics (v0.17.0) — cheap counters in CacheService, flushed to the
// ChatMetrics sheet on appends (already inside the lock) so poll reads stay
// write-free. Approximate by design; it exists to make the migration triggers
// in the spec measurable.
var METRICS_SHEET = 'CFBP_CHAT_METRICS';
var METRIC_FIELDS = ['execCount','appendCount','sinceCount','headHit','headMiss'];

function bump(field) {
  try {
    var cache = CacheService.getScriptCache();
    var key = 'cm_' + todayStr() + '_' + field;
    cache.put(key, String(Number(cache.get(key) || 0) + 1), 21600);
  } catch (e) {}
}

function todayStr() {
  return Utilities.formatDate(new Date(), 'America/Chicago', 'yyyy-MM-dd');
}

function ensureMetricsSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var s = ss.getSheetByName(METRICS_SHEET);
  if (!s) {
    s = ss.insertSheet(METRICS_SHEET);
    s.getRange(1, 1, 1, METRIC_FIELDS.length + 1).setValues([['date'].concat(METRIC_FIELDS)]);
    s.setFrozenRows(1);
  }
  return s;
}

function flushMetrics() {
  try {
    var cache = CacheService.getScriptCache();
    var day = todayStr();
    var row = [day];
    for (var i = 0; i < METRIC_FIELDS.length; i++) row.push(Number(cache.get('cm_' + day + '_' + METRIC_FIELDS[i]) || 0));
    var s = ensureMetricsSheet();
    var last = s.getLastRow();
    if (last >= 2 && String(s.getRange(last, 1).getValue()) === day) {
      s.getRange(last, 1, 1, row.length).setValues([row]);
    } else {
      s.appendRow(row);
    }
  } catch (e) {}
}

function readMetrics(days) {
  var s = ensureMetricsSheet();
  var last = s.getLastRow();
  if (last < 2) return [];
  var n = Math.min(days || 7, last - 1);
  var vals = s.getRange(last - n + 1, 1, n, METRIC_FIELDS.length + 1).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var r = { date: String(vals[i][0]) };
    for (var j = 0; j < METRIC_FIELDS.length; j++) r[METRIC_FIELDS[j]] = Number(vals[i][j + 1] || 0);
    out.push(r);
  }
  return out;
}

// Recently-seen ids cache to keep dedupe O(1) for the common retry case
// without scanning the id column on every append. Falls back to a column scan
// for ids older than the cache window.
function knownIds(s, lookback) {
  var last = s.getLastRow();
  var start = Math.max(2, last - lookback + 1);
  var ids = {};
  if (last >= 2) {
    var vals = s.getRange(start, 2, last - start + 1, 1).getValues();
    for (var i = 0; i < vals.length; i++) {
      // Map id -> seq (row - 1)
      ids[String(vals[i][0])] = (start + i) - 1;
    }
  }
  return ids;
}

function idSeqFullScan(s, id) {
  var last = s.getLastRow();
  if (last < 2) return null;
  var vals = s.getRange(2, 2, last - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]) === String(id)) return i + 1; // seq
  }
  return null;
}

function chatAppend(events) {
  if (!events || !events.length) {
    var s0 = ensureMsgSheet();
    return { ok: true, assigned: [], head: msgHead(s0) };
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var s = ensureMsgSheet();
    var seq = msgHead(s);
    var now = Date.now();
    var recent = knownIds(s, 2000); // dedupe window: last 2000 events
    var assigned = [];
    var rows = [];
    for (var i = 0; i < events.length; i++) {
      var ev = events[i] || {};
      var id = String(ev.id || '');
      if (!id) continue;
      var existing = recent[id];
      if (existing === undefined) existing = idSeqFullScan(s, id) == null ? undefined : idSeqFullScan(s, id);
      if (existing !== undefined && existing !== null) {
        assigned.push({ id: id, seq: existing, ts: null, deduped: true });
        continue;
      }
      seq += 1;
      var body = String(ev.body || '').slice(0, 1000);
      // v0.17.0 — column F is the gameTag ('' = main room). The notify flag is
      // packed into the meta JSON as _n to keep the physical 10-column layout
      // (logical schema per spec; physical packing documented in the ledger).
      var meta = ev.meta && typeof ev.meta === 'object' ? ev.meta : {};
      meta._n = ev.notify ? 1 : 0;
      rows.push([
        seq, id, now,
        String(ev.type || 'message'),
        String(ev.author || 'unknown'),
        String(ev.gameTag || ''),
        body,
        String(ev.targetId || ''),
        String(ev.replyTo || ''),
        JSON.stringify(meta),
      ]);
      recent[id] = seq;
      assigned.push({ id: id, seq: seq, ts: now });
    }
    if (rows.length) {
      s.getRange(s.getLastRow() + 1, 1, rows.length, MSG_HEADER.length).setValues(rows);
    }
    var head = msgHead(s);
    CacheService.getScriptCache().put('chatHead', String(head), 5);   // invalidate/refresh
    bump('appendCount'); bump('execCount');
    flushMetrics();
    return { ok: true, assigned: assigned, head: head };
  } finally {
    lock.releaseLock();
  }
}

function rowToEvent(r) {
  var meta = null;
  if (r[9]) { try { meta = JSON.parse(r[9]); } catch (e) { meta = null; } }
  // v0.17.0 one-room model. Legacy v0.16 rows stored a channel in col F:
  //   'general' / 'week:N'  -> untagged main-room message
  //   'game:<id>'           -> gameTag <id>
  var tag = String(r[5] || '');
  if (tag === 'general' || tag.indexOf('week:') === 0) tag = '';
  else if (tag.indexOf('game:') === 0) tag = tag.slice(5);
  var notify = false;
  if (meta && meta._n !== undefined) { notify = !!meta._n; delete meta._n; }
  return {
    seq: Number(r[0]), id: String(r[1]), ts: Number(r[2]),
    type: String(r[3]), author: String(r[4]), gameTag: tag,
    body: String(r[6] || ''), targetId: String(r[7] || ''), replyTo: String(r[8] || ''),
    notify: notify, meta: meta,
  };
}

function chatSince(afterSeq, limit) {
  bump('sinceCount'); bump('execCount');
  var s = ensureMsgSheet();
  var head = msgHead(s);
  limit = Math.max(1, Math.min(limit || 500, 1000));
  if (head <= afterSeq) return { ok: true, events: [], head: head };
  var startSeq = afterSeq + 1;
  var count = Math.min(limit, head - afterSeq);
  var vals = s.getRange(startSeq + 1, 1, count, MSG_HEADER.length).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) out.push(rowToEvent(vals[i]));
  return { ok: true, events: out, head: head };
}

function chatBefore(beforeSeq, limit) {
  var s = ensureMsgSheet();
  var head = msgHead(s);
  limit = Math.max(1, Math.min(limit || 100, 500));
  var endSeq = Math.min(beforeSeq - 1, head);
  if (endSeq < 1) return { ok: true, events: [], head: head };
  var startSeq = Math.max(1, endSeq - limit + 1);
  var count = endSeq - startSeq + 1;
  var vals = s.getRange(startSeq + 1, 1, count, MSG_HEADER.length).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) out.push(rowToEvent(vals[i]));
  return { ok: true, events: out, head: head };
}

// ── Utils ──────────────────────────────────────────────────────────────────
function safeParse(raw) {
  try { return JSON.parse(raw); } catch (e) { return raw; }
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
