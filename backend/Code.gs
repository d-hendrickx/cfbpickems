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
 * SCRIPT PROPERTIES (Project Settings -> Script Properties)
 *   CFBP_TOKEN                  — the shared write token. Created by setup().
 *   ONESIGNAL_APP_ID            — public OneSignal app id. Push is INERT until set.
 *   ONESIGNAL_REST_API_KEY      — secret OneSignal REST key. Push is INERT until set.
 *   NOTIFY_NAME_NON_SUBMITTERS  — 'true' (default when MISSING) or 'false'.
 *       Controls ONLY the PICKS_LOCKING_SOON reminder copy scanReminders()
 *       builds. 'true'  -> the body may name who has not submitted yet
 *                          (Drew's 2026-09-10 ruling — the blind rule's one
 *                          permitted exception: identity of non-submission,
 *                          never pick content).
 *       'false' -> the count-only pool is used instead; no player display
 *                  name ever reaches the body OR the stored meta. Flipping
 *                  this is a CONFIG change — set the property and the very
 *                  next 15-minute scan honors it. No code edit, no redeploy.
 *       Any other/blank/missing value reads as 'true' (see
 *       notifyNameNonSubmittersEnabled_) so an accidental delete can never
 *       silently change behavior in the surprising direction.
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
// Named-non-submitter reminder copy — a true config flip (Drew's option 2,
// 2026-09-10). See the SCRIPT PROPERTIES block in this file's header.
var NOTIFY_NAME_NON_SUBMITTERS_PROP = 'NOTIFY_NAME_NON_SUBMITTERS';

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
  ensureNotifySentSheet();     // Groups A/B (2026-09-10) — see that section below
  ensureNotifyLogSheet();      // F2 remediation (2026-09-10) — see that section below
  ensureRemindersTrigger();    // installs the 15-min scanReminders() time trigger, idempotent
  // Generate a token if none exists
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty(TOKEN_PROP)) {
    var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
    props.setProperty(TOKEN_PROP, token);
  }
  Logger.log('Setup complete. Token: ' + props.getProperty(TOKEN_PROP));
  // Groups A/B (2026-09-10) — REMINDER, not automated: push sending is INERT
  // until two more Script Properties are set BY HAND (never pasted into chat,
  // config.json, or the repo — see DESIGN_INPUTS_BATCH1_091026.md Appendix):
  //   ONESIGNAL_APP_ID           — public, from the OneSignal dashboard
  //   ONESIGNAL_REST_API_KEY     — secret, os_v2_app_…, shown once
  // Project Settings -> Script Properties -> Add script property, both. Until
  // both are present, sendOneSignalPush() below no-ops cleanly (returns
  // {ok:true, skipped:'not_configured'}) — the reminder trigger and the
  // notifyPush relay both run safely with zero effect, so running setup()
  // again later (once the keys are ready) needs no other change.
  Logger.log('Groups A/B: scanReminders trigger installed. Push stays inert until ONESIGNAL_APP_ID + ONESIGNAL_REST_API_KEY are set in Script Properties.');
  // 2026-09-10 (Drew's option 2) — naming non-submitters in the
  // PICKS_LOCKING_SOON reminder is now a CONFIG flip, not a code edit.
  // Absent property == 'true' == current behavior, so an existing deployment
  // that never sets it is unchanged.
  Logger.log('NOTIFY_NAME_NON_SUBMITTERS: currently ' +
    (notifyNameNonSubmittersEnabled_(props.getProperty(NOTIFY_NAME_NON_SUBMITTERS_PROP)) ? 'TRUE (names non-submitters)' : 'FALSE (count-only copy)') +
    ' [raw=' + (props.getProperty(NOTIFY_NAME_NON_SUBMITTERS_PROP) === null ? '(unset -> defaults true)' : props.getProperty(NOTIFY_NAME_NON_SUBMITTERS_PROP)) + ']. ' +
    'Set it to the literal string "false" in Project Settings -> Script Properties to switch PICKS_LOCKING_SOON to the count-only pool; delete it or set "true" to restore names. Takes effect on the next 15-minute scan, no redeploy.');
  // F7 remediation (2026-09-10) — REPLACES the old "never auto-pruned, manual
  // only" note. scanReminders() now calls autoPruneNotifySentIfDue_() on every
  // run, but that function is itself throttled to once per calendar day via a
  // PropertiesService timestamp (GAS executions are stateless between 15-min
  // trigger firings, so an in-memory flag would reset every run) — the sheet
  // scan/rewrite only actually happens on the one run per day that's due,
  // keeping the other ~95 runs/day a no-op property read. pruneNotifySentBefore()
  // itself is unchanged and still callable BY HAND with an explicit cutoff for
  // an out-of-cycle trim.
  Logger.log('CFBP_NOTIFY_SENT: auto-pruned once/day (rows older than ' + NOTIFY_SENT_PRUNE_AGE_DAYS + 'd) from inside scanReminders(). pruneNotifySentBefore(isoCutoff) remains available for a manual out-of-cycle trim.');
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
  var writeActions = { set: 1, setMany: 1, snapshot: 1, restoreSnapshot: 1, chatAppend: 1, notifyPush: 1 };
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
      // ── Push notifications (Groups A/B, 2026-09-10) — see that section below ──
      case 'notifyPush':      return json(notifyPush(req));
      // F2 (2026-09-10 remediation) — read-only fold of the server-fired
      // reminder/locking-soon log. NOT in writeActions (below) — a read,
      // same trust model as getAll/chatSince.
      case 'notifyLog':       return json(notifyLogRead(req));
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

// Groups A/B (2026-09-10) — scanReminders() needs THREE logical keys
// (cfbp_weeks, cfbp_picks, cfbp_games — plus cfbp_players for the roster).
// getOne() does a FULL getDataRange().getValues() scan per call regardless of
// key (see the comment on getAll() above), so four getOne() calls would be
// four full-sheet scans per 15-minute trigger run. getMany() does the SAME
// scan ONCE and extracts every requested key from it — strictly cheaper than
// what DESIGN_INPUTS_BATCH1_091026.md §5 describes ("exactly two Sheet reads"
// via two getOne() calls), while also fixing a correctness gap that literal
// two-key design has: computing "remaining picks" needs to know the week's
// TOTAL game count, which is not derivable from cfbp_weeks + cfbp_picks alone
// — see the note in scanReminders() below. Chunk-aware via readRaw(), exactly
// like getOne()/getAll().
function getMany(keys) {
  var s = storeSheet();
  var values = s.getDataRange().getValues();
  var rawByKey = {};
  for (var i = 1; i < values.length; i++) {
    var k = values[i][0];
    if (k === '' || k === null) continue;
    rawByKey[String(k)] = values[i][1];
  }
  var out = {};
  keys.forEach(function (key) {
    var raw = readRaw(key, rawByKey);
    out[key] = (raw === '' || raw === undefined || raw === null) ? null : safeParse(raw);
  });
  return out;
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

// ── Push notifications (Groups A/B, 2026-09-10, UN-139…UN-148) ─────────────
// DESIGN_INPUTS_BATCH1_091026.md, Document 1, §4/§5. TWO ways a push leaves
// this script:
//   1. `notifyPush` — client -> server relay for IMMEDIATE events (chat
//      message, picks opened/locked, results, obligations, announcements).
//      js/notifications.js builds the notification record client-side and
//      calls this ONCE PER RECIPIENT (its dedupKey format bakes in a single
//      playerId — see js/notifications.js's resolveIntent/makeDedupKey
//      comments) — so a broadcast to N players costs N relay calls, each
//      still exactly one OneSignal UrlFetchApp call. This is a deliberate,
//      documented divergence from §5's literal "one batched call per EVENT"
//      framing — batching MULTIPLE playerIds under one shared dedupKey would
//      make per-recipient dedup impossible (what if player A already got it
//      and player B didn't?), and six relay HTTP calls for a once-a-week
//      broadcast is not a real cost. See the handoff report.
//   2. `scanReminders` — a 15-minute time trigger (installed by setup(), see
//      ensureRemindersTrigger() below). Genuinely batches: for one threshold,
//      every NEWLY-eligible player's dedupKey is checked/written in one pass,
//      then ONE OneSignal call carries all of them. This IS the O(1)-per-
//      threshold-per-scan path §5 describes.
//
// Both paths dedupe against ONE shared append-only sheet, CFBP_NOTIFY_SENT
// (dedupKey | sentAt — same shape/precedent as CFBP_MESSAGES), so a client
// relay and a server scan racing on the identical dedupKey (should that ever
// happen) still resolve to exactly one send.

var NOTIFY_SENT_SHEET  = 'CFBP_NOTIFY_SENT';
var NOTIFY_SENT_HEADER = ['dedupKey', 'sentAt'];

function ensureNotifySentSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var s = ss.getSheetByName(NOTIFY_SENT_SHEET);
  if (!s) {
    s = ss.insertSheet(NOTIFY_SENT_SHEET);
    s.getRange(1, 1, 1, NOTIFY_SENT_HEADER.length).setValues([NOTIFY_SENT_HEADER]);
    s.setFrozenRows(1);
  }
  return s;
}

// Own lock, deliberately SEPARATE in spirit from withStoreLock's CFBP_STORE
// critical section — both happen to share the one script-wide LockService
// resource GAS provides (there is no per-sheet lock in Apps Script), but this
// critical section is short (one small-sheet scan + append) and infrequent
// (at most a handful of real product events per week, plus the 15-min scan),
// so the added contention against the hotter picks-sync path is negligible in
// practice for a six-person league. Flagged, not hidden.
function withNotifyLock(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return fn(); }
  finally { lock.releaseLock(); }
}

function dedupKeyAlreadySent(s, dedupKey) {
  var last = s.getLastRow();
  if (last < 2) return false;
  var vals = s.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]) === dedupKey) return true;
  }
  return false;
}

function appendNotifySentRow(s, dedupKey) {
  var row = s.getLastRow() + 1;
  s.getRange(row, 1, 1, 2).setValues([[dedupKey, new Date().toISOString()]]);
}

// ── F8 remediation (2026-09-10) — batch variants ────────────────────────────
// dedupKeyAlreadySent()/appendNotifySentRow() above do ONE dedupKey at a time
// — fine for notifyPush's single-relay call, but scanReminders() used to call
// them once PER PLAYER PER THRESHOLD (up to 6 players × 3 thresholds + 1
// locking-soon pass = up to 19 lock-acquire + full-sheet-read cycles per
// 15-minute scan). These two let the WHOLE scan do it in ONE read + ONE
// append — see applyReminderScanCandidates_() below, scanReminders()'s only
// caller of either.
function readAllSentDedupKeys(s) {
  var last = s.getLastRow();
  if (last < 2) return {};
  var vals = s.getRange(2, 1, last - 1, 1).getValues();
  var set = {};
  for (var i = 0; i < vals.length; i++) set[String(vals[i][0])] = true;
  return set;
}
function appendNotifySentRows(s, dedupKeys) {
  if (!dedupKeys.length) return;
  var now = new Date().toISOString();
  var rows = dedupKeys.map(function (k) { return [k, now]; });
  s.getRange(s.getLastRow() + 1, 1, rows.length, 2).setValues(rows);
}

// F8 remediation (2026-09-10) — season-boundary cleanup. CFBP_NOTIFY_SENT is
// append-only and grows by at most a handful of rows per week in normal
// operation (§5's own "≤6 rows/scan" framing). Still callable BY HAND from
// the Apps Script editor with an explicit ISO cutoff for an out-of-cycle
// trim (Run -> pruneNotifySentBefore).
//
// F7 remediation (2026-09-10) — REPLACES the earlier "MANUAL ONLY, never
// called from setup(), any request action, or scanReminders() itself" note.
// It is now ALSO called automatically, once per calendar day, from inside
// scanReminders() via autoPruneNotifySentIfDue_() below — a 15-min sheet that
// nobody ever manually trims is exactly the kind of thing that gets forgotten
// until it's a problem (RG-55/RG-56 neighborhood: unbounded sheet growth).
// The manual path is untouched and still useful for an out-of-cycle cutoff.
function pruneNotifySentBefore(cutoffIso) {
  var s = ensureNotifySentSheet();
  var last = s.getLastRow();
  if (last < 2) return 0;
  var cutoff = new Date(cutoffIso).getTime();
  if (isNaN(cutoff)) throw new Error('pruneNotifySentBefore: invalid cutoffIso "' + cutoffIso + '"');
  var vals = s.getRange(2, 1, last - 1, 2).getValues();
  var keep = [];
  var removed = 0;
  for (var i = 0; i < vals.length; i++) {
    var sentAt = new Date(vals[i][1]).getTime();
    if (!isNaN(sentAt) && sentAt < cutoff) { removed++; continue; }
    keep.push(vals[i]);
  }
  if (!removed) return 0;
  s.getRange(2, 1, last - 1, 2).clearContent();
  if (keep.length) s.getRange(2, 1, keep.length, 2).setValues(keep);
  return removed;
}

// F7 remediation (2026-09-10) — automatic, throttled to once per calendar
// day via PropertiesService (a module-level/in-memory flag would reset on
// every one of the ~96 fresh executions/day scanReminders() gets — GAS does
// not keep state between separate trigger firings, only PropertiesService/
// the Sheet itself do). Cheap on the ~95 no-op runs/day: one property read,
// nothing else. Never lets a failure here block the real reminder scan.
var NOTIFY_SENT_PRUNE_PROP = 'cfbp_notify_sent_last_prune_at';
var NOTIFY_SENT_PRUNE_AGE_DAYS = 60;
function autoPruneNotifySentIfDue_() {
  try {
    var props = PropertiesService.getScriptProperties();
    var lastRaw = props.getProperty(NOTIFY_SENT_PRUNE_PROP);
    var now = Date.now();
    if (lastRaw && (now - Number(lastRaw)) < 24 * 60 * 60 * 1000) return;
    var cutoffIso = new Date(now - NOTIFY_SENT_PRUNE_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    pruneNotifySentBefore(cutoffIso);
    props.setProperty(NOTIFY_SENT_PRUNE_PROP, String(now));
  } catch (e) {
    Logger.log('autoPruneNotifySentIfDue_ failed (non-fatal, reminder scan continues): ' + e);
  }
}

// ── F2 remediation (2026-09-10) — CFBP_NOTIFY_LOG ──────────────────────────
// PICKS_REMINDER/PICKS_LOCKING_SOON fire ENTIRELY inside scanReminders() —
// server-only, no client call site exists for them — so they had NO
// persistent record beyond the push itself (invisible to anyone without push
// granted, or with the app closed when it arrived). CFBP_NOTIFY_LOG is a
// SEPARATE, append-only sheet holding one row per (event, recipient) the
// server actually fired — read-only from the client (`notifyLog` action,
// below), and NEVER merged into CFBP_STORE's cfbp_notifications key (RG-49
// clobber class: that key is client-authored via the debounced setMany()
// push; a server writer racing it is exactly RG-49's failure shape).
//
// Row shape mirrors js/notifications.js's provider-independent record (§2 of
// DESIGN_INPUTS_BATCH1_091026.md) field-for-field, actor/destination/meta
// JSON-stringified (same convention CFBP_MESSAGES' meta column already
// uses), with a monotonic `seq` (same "contiguous row = seq" trick as
// CFBP_MESSAGES' msgHead) so the client can page with a cheap afterSeq cursor.
var NOTIFY_LOG_SHEET  = 'CFBP_NOTIFY_LOG';
var NOTIFY_LOG_HEADER = ['seq', 'id', 'playerId', 'event', 'actor', 'title', 'body', 'destination', 'createdAt', 'dedupKey', 'weekId', 'meta'];

function ensureNotifyLogSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var s = ss.getSheetByName(NOTIFY_LOG_SHEET);
  if (!s) {
    s = ss.insertSheet(NOTIFY_LOG_SHEET);
    s.getRange(1, 1, 1, NOTIFY_LOG_HEADER.length).setValues([NOTIFY_LOG_HEADER]);
    s.setFrozenRows(1);
  }
  return s;
}

function notifyLogHead_(s) { return Math.max(0, s.getLastRow() - 1); }

// Lock-free BY DESIGN — its only caller (applyReminderScanCandidates_ below)
// already holds withNotifyLock's script lock for the entire dedup-check-
// then-append sequence; acquiring a second Lock object for the same
// script-wide resource from inside that same execution would be a pointless
// same-execution reentrant call, not real protection.
function appendNotifyLogRows_(records) {
  if (!records || !records.length) return;
  var s = ensureNotifyLogSheet();
  var seq = notifyLogHead_(s);
  var rows = records.map(function (r) {
    seq += 1;
    return [
      seq, r.id, r.playerId, r.event,
      JSON.stringify(r.actor || null), String(r.title || ''), String(r.body || ''),
      JSON.stringify(r.destination || null), r.createdAt, r.dedupKey,
      r.weekId || '', JSON.stringify(r.meta || {}),
    ];
  });
  s.getRange(s.getLastRow() + 1, 1, rows.length, NOTIFY_LOG_HEADER.length).setValues(rows);
}

function rowToNotifyLogRecord_(r) {
  var actor = null, destination = null, meta = {};
  try { actor = JSON.parse(r[4]); } catch (e) { actor = null; }
  try { destination = JSON.parse(r[7]); } catch (e) { destination = null; }
  try { meta = JSON.parse(r[11]) || {}; } catch (e) { meta = {}; }
  return {
    seq: Number(r[0]), id: String(r[1]), playerId: String(r[2]), event: String(r[3]),
    actor: actor, title: String(r[5] || ''), body: String(r[6] || ''), destination: destination,
    createdAt: String(r[8] || ''), dedupKey: String(r[9] || ''),
    weekId: r[10] ? String(r[10]) : null, meta: meta,
  };
}

/** `notifyLog` action — read-only, `{ playerId, afterSeq }` -> every row for
 *  THAT player with seq > afterSeq, plus the current head. One bounded
 *  contiguous-row read (same shape as chatSince/chatBefore) — cheap even as
 *  the sheet grows, since afterSeq lets the client page incrementally
 *  instead of re-reading from the top every poll. */
function notifyLogRead(req) {
  var playerId = String(req.playerId || '');
  if (!playerId) return { ok: false, error: 'Missing playerId' };
  var afterSeq = Math.max(0, Number(req.afterSeq || 0));
  var s = ensureNotifyLogSheet();
  var head = notifyLogHead_(s);
  if (head <= afterSeq) return { ok: true, records: [], head: head };
  var startRow = afterSeq + 2;   // seq n lives at row n+1 (row 1 is the header)
  var count = head - afterSeq;
  var vals = s.getRange(startRow, 1, count, NOTIFY_LOG_HEADER.length).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var rec = rowToNotifyLogRecord_(vals[i]);
    if (rec.playerId === playerId) out.push(rec);
  }
  return { ok: true, records: out, head: head };
}

// ── correction #5 — validate shape + rate-limit per key ─────────────────────
// The relay is client-callable behind the shared token (client-visible by
// design, same trust model as every other write action). A malformed or
// hostile dedupKey must never be trusted as a real idempotency key, and a
// buggy client retry loop must never be able to hammer CFBP_NOTIFY_SENT or
// OneSignal's API. dedupKey shape is EXACTLY js/notifications.js's
// makeDedupKey() format: `${event}|${weekId}|${threshold}|${playerId}` — 4
// pipe-delimited parts, event and playerId non-empty (weekId/threshold may be
// blank for non-week-scoped events like OBLIGATION_SETTLED).
function isValidDedupKey(dedupKey) {
  if (typeof dedupKey !== 'string') return false;
  if (dedupKey.length < 3 || dedupKey.length > 300) return false;
  var parts = dedupKey.split('|');
  if (parts.length !== 4) return false;
  if (!parts[0] || !parts[3]) return false;
  return true;
}

// Cheap CacheService guard — a HOT client retry loop hitting the SAME
// dedupKey within a 10s window is rejected before it ever touches the Sheet
// or OneSignal. This is NOT the idempotency mechanism (CFBP_NOTIFY_SENT is —
// this only protects against a BURST of attempts, not a legitimate retry
// minutes later, which the sheet check below still correctly no-ops).
function rateLimitOk(dedupKey) {
  try {
    var cache = CacheService.getScriptCache();
    var ck = 'npr_' + dedupKey;
    if (cache.get(ck)) return false;
    cache.put(ck, '1', 10);
    return true;
  } catch (e) { return true; }   // never let a CacheService hiccup block a legitimate send
}

/** The client -> server relay. Body: { dedupKey, playerIds:[...], title,
 *  body, destination, event }. Idempotent per dedupKey; no-ops cleanly
 *  (ok:true, skipped) when OneSignal Script Properties are not yet set. */
function notifyPush(req) {
  var dedupKey = String(req.dedupKey || '');
  var playerIds = Array.isArray(req.playerIds) ? req.playerIds.map(String).filter(function (x) { return !!x; }) : [];
  if (!isValidDedupKey(dedupKey)) return { ok: false, error: 'Invalid dedupKey' };
  if (!playerIds.length) return { ok: false, error: 'No playerIds' };
  if (!rateLimitOk(dedupKey)) return { ok: true, deduped: true, rateLimited: true };
  return withNotifyLock(function () {
    var s = ensureNotifySentSheet();
    if (dedupKeyAlreadySent(s, dedupKey)) return { ok: true, deduped: true };
    appendNotifySentRow(s, dedupKey);
    var result = sendOneSignalPush(playerIds, req.title, req.body, req.destination, req.event);
    return { ok: true, deduped: false, push: result };
  });
}

/**
 * BLOCKING #1 remediation (2026-09-10) — mirrors js/notifications.js's
 * resolveIntent() EXACTLY for the server-fired path: push fires only if the
 * recipient's master toggle AND (when the event is category-gated) the
 * category toggle are both on. Default-when-missing reads as ON for both —
 * same opt-out model as js/storage.js's getNotifyPushMasterFor()/
 * getNotifyCategoryPrefsFor()/DEFAULT_NOTIFY_CATEGORIES (an old/absent
 * player record must not change behavior from "everything on").
 *
 * This does NOT gate the in-app record (CFBP_NOTIFY_LOG) — see
 * applyReminderScanCandidates_ below, which writes a log row for EVERY fresh
 * candidate regardless of what this function returns. Only the OneSignal
 * push is filtered by it. `category` is null for events D3 declares never
 * silenceable (none currently fire server-side, but the null branch mirrors
 * resolveIntent()'s shape for parity/future use).
 */
function resolveServerPushIntent_(player, category) {
  var prefs = (player && player.preferences) || {};
  var masterRaw = prefs.notifyPushMaster;
  var masterOn = (masterRaw === undefined || masterRaw === null) ? true : !!masterRaw;
  if (!category) return masterOn;
  var cats = prefs.notifyCategories || {};
  var catRaw = cats[category];
  var categoryOn = (catRaw === undefined || catRaw === null) ? true : !!catRaw;
  return categoryOn && masterOn;
}

/**
 * F8 remediation (2026-09-10) — scanReminders()'s sole write path.
 *
 * ONE lock acquisition + ONE CFBP_NOTIFY_SENT read + ONE batched append for
 * the ENTIRE scan, instead of one dedup-check-then-append cycle PER PLAYER
 * PER THRESHOLD (up to 6 players × 3 thresholds + 1 locking-soon pass = up
 * to 19 lock/read/write cycles per 15-minute run). Also writes the matching
 * CFBP_NOTIFY_LOG rows (F2) in the SAME locked pass, so the log and the
 * dedup ledger can never disagree about what "actually fired."
 *
 * BLOCKING #1 remediation (2026-09-10) — the CFBP_NOTIFY_LOG row (the
 * server-fired equivalent of an in-app record) is written for EVERY fresh
 * candidate UNCONDITIONALLY — a category or master toggle never removes the
 * record itself, only the push (exactly js/notifications.js's resolveIntent()
 * contract: "turning off Push Notifications does not empty the Center").
 * Preferences are applied AFTER that write, filtering which of the newly-
 * logged candidates actually get an OneSignal call.
 *
 * OneSignal sends happen AFTER the lock releases — they used to run INSIDE
 * withNotifyLock (the SAME script-wide LockService resource withStoreLock
 * uses for cfbp_picks writes), holding that shared lock for the duration of
 * an external HTTP call. The dedupKey is committed to the sheet before any
 * send is attempted either way, so a send that fails after commit has the
 * SAME "already marked sent, best-effort delivery" semantics the old code
 * had — moving the send outside the lock only removes needless contention.
 *
 * `candidates`: [{ playerId, dedupKey, title, body, destination, event,
 * weekId, meta, category, batchKey? }]. Entries sharing a `batchKey` collapse
 * into ONE OneSignal call (PICKS_LOCKING_SOON's shared body); entries with no
 * `batchKey` each get their own call (PICKS_REMINDER, personalized —
 * unchanged from the prior one-call-per-player behavior). `playersById`:
 * `{ [playerId]: playerRecord }` — the SAME active-players scan already read
 * by scanReminders(), passed through so this function never re-reads
 * cfbp_players itself.
 */
function applyReminderScanCandidates_(candidates, playersById) {
  if (!candidates.length) return { newlyEligible: [] };
  var newlyEligible = withNotifyLock(function () {
    var s = ensureNotifySentSheet();
    var already = readAllSentDedupKeys(s);
    var fresh = candidates.filter(function (c) { return !already[c.dedupKey]; });
    if (!fresh.length) return [];
    appendNotifySentRows(s, fresh.map(function (c) { return c.dedupKey; }));
    var now = new Date().toISOString();
    appendNotifyLogRows_(fresh.map(function (c) {
      return {
        id: 'ntf_' + Utilities.getUuid(), playerId: c.playerId, event: c.event,
        actor: { kind: 'scribe', playerId: null }, title: c.title, body: c.body,
        destination: c.destination, createdAt: now, dedupKey: c.dedupKey,
        weekId: c.weekId || null, meta: c.meta || {},
      };
    }));
    return fresh;
  });
  if (!newlyEligible.length) return { newlyEligible: [] };

  // BLOCKING #1 remediation — filter to push-ELIGIBLE candidates only, AFTER
  // the log write above already committed a record for every fresh one.
  var byId = playersById || {};
  var pushEligible = newlyEligible.filter(function (c) {
    return resolveServerPushIntent_(byId[c.playerId], c.category || null);
  });
  if (!pushEligible.length) return { newlyEligible: newlyEligible, pushed: [] };

  var groups = {}, order = [];
  pushEligible.forEach(function (c) {
    var key = c.batchKey || ('__solo__' + c.dedupKey);
    if (!groups[key]) { groups[key] = { title: c.title, body: c.body, destination: c.destination, event: c.event, playerIds: [] }; order.push(key); }
    groups[key].playerIds.push(c.playerId);
  });
  order.forEach(function (key) {
    var g = groups[key];
    sendOneSignalPush(g.playerIds, g.title, g.body, g.destination, g.event);
  });
  return { newlyEligible: newlyEligible, pushed: pushEligible };
}

// F7 remediation (2026-09-10) — DELETED fireBatchNotification() (zero
// callers since F8's applyReminderScanCandidates_ replaced it; the "kept in
// case a future broadcast wants it" rationale never materialized a second
// caller). Its shape is fully subsumed by applyReminderScanCandidates_
// above — a future single-event broadcast can call that with one-off
// candidates instead of reviving this.

/** `destination` -> a URL OneSignal opens on tap (its default notificationclick
 *  behavior — correction #1: we never hand-author push/notificationclick
 *  handling, the SDK's own merged service worker owns it, see
 *  service-worker.js). The app's boot path (js/app.js) parses `ntab`/`nparams`
 *  off the URL and calls navigateTo() — same "?access=scribe" query-param
 *  precedent index.html already uses for the reveal-page PIN bypass. */
function buildDestinationUrl(destination) {
  var base = 'https://irbfootball.com/';
  if (!destination || !destination.tab) return base;
  var q = 'ntab=' + encodeURIComponent(destination.tab);
  if (destination.params) {
    try { q += '&nparams=' + encodeURIComponent(JSON.stringify(destination.params)); } catch (e) {}
  }
  return base + '?' + q;
}

/**
 * The ONE UrlFetchApp call. No-ops cleanly (`{ok:true, skipped:'not_configured'}`)
 * until Drew sets BOTH Script Properties by hand (see setup()'s log line) —
 * matches the client's own "no-op cleanly when not configured" contract
 * (js/push-onesignal.js) all the way through the stack.
 *
 * AUTH HEADER — VERIFICATION NOTE: the Appendix names an `os_v2_app_…` REST
 * key, which is OneSignal's newer app-scoped key format; OneSignal's current
 * docs for that key format use `Authorization: Key <key>` (the OLDER
 * org-level legacy key used `Basic <key>`). Builder could not reach
 * OneSignal's live docs during this pass to confirm the exact current header
 * name for `/api/v1/notifications` against an app-scoped key — flagged in the
 * handoff report. If a real send returns 401/403 after Drew sets both
 * properties, this is the first thing to check.
 */
function sendOneSignalPush(playerIds, title, body, destination, event) {
  var props = PropertiesService.getScriptProperties();
  var restKey = props.getProperty('ONESIGNAL_REST_API_KEY');
  var appId = props.getProperty('ONESIGNAL_APP_ID');
  if (!restKey || !appId) return { ok: true, skipped: 'not_configured' };
  var payload = {
    app_id: appId,
    include_external_user_ids: playerIds,
    headings: { en: String(title || 'CFB Pickems') },
    contents: { en: String(body || '') },
    data: { event: String(event || '') },
    url: buildDestinationUrl(destination),
  };
  var opts = {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Key ' + restKey },   // see VERIFICATION NOTE above
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };
  try {
    var resp = UrlFetchApp.fetch('https://onesignal.com/api/v1/notifications', opts);
    var code = resp.getResponseCode();
    if (code >= 200 && code < 300) {
      var parsed = safeParse(resp.getContentText());
      return { ok: true, id: (parsed && parsed.id) || null };
    }
    return { ok: false, error: 'OneSignal HTTP ' + code, body: resp.getContentText() };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

// ── Reminder-due scheduling — the write-pressure-sensitive piece ───────────
// One time-driven trigger, installed once by setup() (ensureRemindersTrigger,
// idempotent — re-running setup() never double-installs it). 15-minute
// granularity is required by the 15m-before-lock threshold and is the
// coarsest interval that still catches it.
var REMINDER_THRESHOLDS = [
  { key: '24h', ms: 24 * 60 * 60 * 1000 },
  { key: '1h',  ms: 60 * 60 * 1000 },
  { key: '15m', ms: 15 * 60 * 1000 },
];
var LOCKING_SOON_MS = 60 * 60 * 1000;   // single fire, recommended 1h mark (§1 Q1/DI-B2)

// Ports js/scoring.js's computeFirstKickoff/computeEffectiveLockAt — GAS
// cannot import an ES module, so this is a deliberate, small, verbatim-in-
// SPIRIT port (not a shared file). Keep the two in step by hand if that
// logic ever changes; there is no automated twin-sync guard for this one
// (unlike the CAP-chunking arc's chunkstore.mjs/captest.mjs pattern) because
// GAS genuinely cannot run the real module — flagged as a known gap, not
// hidden.
function firstKickoffMs_(games) {
  var times = [];
  (games || []).forEach(function (g) {
    if (g && g.kickoff) {
      var t = new Date(g.kickoff).getTime();
      if (!isNaN(t)) times.push(t);
    }
  });
  if (!times.length) return null;
  return Math.min.apply(null, times);
}
function effectiveLockAtMs_(week, games) {
  if (!week) return null;
  if (week.picksLockAt) {
    var t = new Date(week.picksLockAt).getTime();
    return isNaN(t) ? null : t;
  }
  var first = firstKickoffMs_(games);
  if (first === null) return null;
  var offset = (typeof week.autoLockOffsetMinutes === 'number' && week.autoLockOffsetMinutes >= 0) ? week.autoLockOffsetMinutes : 30;
  return first - offset * 60000;
}

function ensureRemindersTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'scanReminders') return;   // already installed — idempotent
  }
  ScriptApp.newTrigger('scanReminders').timeBased().everyMinutes(15).create();
}

// ── F10 remediation (2026-09-10) — select the SAME active week the app does.
// js/storage.js's getCurrentWeek() checks cfbp_active_week FIRST, falling
// back to scanning cfbp_weeks only when no active pointer is set (or it
// points at a week that isn't actually open). scanReminders() previously
// picked the FIRST week with status==='open' in array order, which could
// silently scan/notify for the wrong week the moment two weeks are
// simultaneously open (e.g. a lagging prior week left open during a
// transition). Twin-tested in notifytest.mjs against
// backend/notifyServer.mjs's selectActiveOpenWeek(). ──────────────────────
function selectActiveOpenWeek_(weeks, activeWeekId, allGames) {
  if (activeWeekId) {
    var found = null;
    for (var i = 0; i < weeks.length; i++) {
      if (weeks[i] && weeks[i].weekId === activeWeekId) { found = weeks[i]; break; }
    }
    if (found && found.status === 'open') return found;
  }
  var openWeeks = weeks.filter(function (w) { return w && w.status === 'open'; });
  if (!openWeeks.length) return null;
  if (openWeeks.length === 1) return openWeeks[0];
  // More than one simultaneously open and no active pointer resolved one —
  // prefer whichever locks SOONEST (the one where a reminder is most urgent).
  var best = null, bestLock = Infinity;
  openWeeks.forEach(function (w) {
    var wGames = allGames.filter(function (g) { return g && g.weekId === w.weekId; });
    var lockMs = effectiveLockAtMs_(w, wGames);
    if (lockMs !== null && lockMs < bestLock) { bestLock = lockMs; best = w; }
  });
  return best || openWeeks[0];
}

// ── F7 remediation (2026-09-10) — SCRIBE-voiced copy, PORTED from
// js/notify-copy.js. GAS cannot import that ES module, so this is a
// deliberate, same-content manual port of exactly the two events
// scanReminders() fires (PICKS_REMINDER, PICKS_LOCKING_SOON + its all-
// submitted fallback pool) — content and ORDER must stay byte-identical to
// notify-copy.js's POOLS/FALLBACK for the same three keys, or the two
// systems would pick different (still valid, but inconsistent) lines for
// the same dedupKey. notifytest.mjs's drift test (F5) diffs this against
// notify-copy.js's own `_poolsForTest()` export — if you edit one, edit
// both in the same pass. Uses SCRIBE_VOICE_REFRESH_091026.md §2's approved
// register (the earlier "SCRIBE NOTE:.../Filed." register is retired).
var SCRIBE_PICKS_REMINDER_POOL = [
  '{remainingPicks} picks outstanding for Week {weekN}. The deadline is approaching fast, boys.',
  '{remainingPicks} entries still pending. Lock in {timeUntilLock}.',
  "{remainingPicks} left. Lock in {timeUntilLock}. Don't be that guy.",
  "Still {remainingPicks} picks sitting there. Clock's at {timeUntilLock}.",
  '{remainingPicks} to go for Week {weekN}. Tick tock.',
  '{remainingPicks} picks unfinished. You know what to do.',
  "{timeUntilLock} left and you've still got {remainingPicks} picks open.",
];
var SCRIBE_PICKS_REMINDER_FALLBACK = 'You have {remainingPicks} picks left for Week {weekN}.';

var SCRIBE_PICKS_LOCKING_SOON_POOL = [
  '{timeUntilLock} to lock. On the record as huge slackers: {namedNonSubmitters}.',
  'Week {weekN} locks in {timeUntilLock}. Still waiting on {namedNonSubmitters}.',
  "{timeUntilLock} left. {namedNonSubmitters}, the week isn't going to pick itself.",
  "Clock's at {timeUntilLock}. {namedNonSubmitters} are cutting it close.",
  "{submittedCount}/{totalPlayers} in with {timeUntilLock} to go. {namedNonSubmitters}, let's go.",
  '{namedNonSubmitters} — {timeUntilLock} before Week {weekN} locks. Move.',
];
var SCRIBE_PICKS_LOCKING_SOON_FALLBACK = 'Week {weekN} locks in {timeUntilLock}.';

// ── 2026-09-10 (Drew's option 2) — the COUNT-ONLY pool, used instead of the
// named pool above when the NOTIFY_NAME_NON_SUBMITTERS Script Property is the
// literal string 'false'. Same manual-port/byte-identical-to-notify-copy.js
// obligation as every other pool in this section (notifytest.mjs's F5 drift
// test diffs this one too). Every line here uses ONLY {submittedCount},
// {totalPlayers} and {timeUntilLock} — no {namedNonSubmitters}, by
// construction, so no template in this pool CAN place a name in the body.
// The flat fallback below is shared with the named pool and is already
// name-free ('Week {weekN} locks in {timeUntilLock}.'), so the fallback path
// is safe in this mode too.
var SCRIBE_PICKS_LOCKING_SOON_COUNT_ONLY_POOL = [
  '{submittedCount}/{totalPlayers} in. {timeUntilLock} to lock.',
  "{timeUntilLock} to lock and we're at {submittedCount}/{totalPlayers}. You know who you are.",
  "{timeUntilLock} left. {submittedCount}/{totalPlayers} in. Don't be the holdout.",
];

/**
 * Reads the NOTIFY_NAME_NON_SUBMITTERS Script Property's raw value into a
 * boolean. DEFAULT-WHEN-MISSING IS TRUE (CONVENTIONS #10 applied to a config
 * property): a deployment that never sets this behaves exactly as it did
 * before the property existed. ONLY the literal string 'false'
 * (case/whitespace-insensitive) turns naming off — any other value, including
 * a typo, reads as true, so a fat-fingered property can never silently take
 * the app somewhere surprising.
 *
 * Twin: backend/notifyServer.mjs's readNameNonSubmittersFlag(). notifytest.mjs
 * EXECUTES this function out of the real Code.gs source and compares it
 * case-for-case against that twin.
 */
function notifyNameNonSubmittersEnabled_(raw) {
  if (raw === null || raw === undefined) return true;
  return String(raw).trim().toLowerCase() !== 'false';
}

var SCRIBE_PICKS_LOCKING_SOON_ALL_IN_POOL = [
  'All picks in. Week {weekN} is set. LFG.',
  '{totalPlayers}/{totalPlayers} in. Week {weekN} is locked and loaded.',
];
var SCRIBE_PICKS_LOCKING_SOON_ALL_IN_FALLBACK = 'Week {weekN} is set.';

// Same small deterministic hash as notify-copy.js's stableIndex() — picks a
// pool member REPRODUCIBLY per seed (the dedupKey) rather than randomly, so
// a retried scan never "flickers" between wordings, and results are testable
// without mocking Math.random(). Same algorithm, same twin-drift obligation
// as the pools above.
function scribeStableIndex_(seed, mod) {
  var h = 0;
  var s = String(seed || '');
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return mod > 0 ? h % mod : 0;
}

function scribeSubstitute_(tpl, facts) {
  return tpl.replace(/\{(\w+)\}/g, function (m, key) {
    return Object.prototype.hasOwnProperty.call(facts, key) ? String(facts[key]) : m;
  });
}

// Same "only use a template whose every {placeholder} is present in facts,
// else fall back" contract as notify-copy.js's buildCopy() — no free
// generation, no unsupplied-fact guess.
function scribeBuildCopy_(pool, fallbackTpl, facts, dedupKey) {
  var usable = [];
  for (var i = 0; i < pool.length; i++) {
    var tpl = pool[i];
    var ok = true;
    var re = /\{(\w+)\}/g, m;
    while ((m = re.exec(tpl))) { if (facts[m[1]] === undefined) { ok = false; break; } }
    if (ok) usable.push(tpl);
  }
  if (!usable.length) return scribeSubstitute_(fallbackTpl, facts);
  return scribeSubstitute_(usable[scribeStableIndex_(dedupKey, usable.length)], facts);
}

/**
 * The 15-minute trigger body. NOT an HTTP action (not reachable via
 * doGet/doPost/handle()) — Apps Script calls this directly on schedule.
 *
 * Read cost: ONE getMany() scan (cfbp_weeks, cfbp_picks, cfbp_games,
 * cfbp_players, cfbp_active_week) — see getMany()'s comment for why this is
 * cheaper than, and corrects a real gap in, the DI's literal "exactly two
 * getOne() reads" framing (that framing has no way to know a week's TOTAL
 * game count, which "remaining picks" needs — flagged in the handoff report
 * as a deliberate, necessary deviation for correctness, not a silent scope
 * change).
 *
 * Write cost: zero unless a threshold was actually crossed since players
 * were last fully caught up — CFBP_NOTIFY_SENT gates every write, checked
 * ONCE for the whole scan (F8 remediation — see applyReminderScanCandidates_).
 *
 * BLOCKING #1 remediation (2026-09-10) — `cfbp_players` was already part of
 * this ONE getMany() scan (used below for displayName/active-filtering); it
 * is now ALSO read for `preferences.notifyPushMaster`/`preferences.
 * notifyCategories` so applyReminderScanCandidates_ can apply the SAME
 * master×category push gate js/notifications.js's resolveIntent() applies
 * client-side. No extra read — same data, one more field consulted from it.
 */
function scanReminders() {
  autoPruneNotifySentIfDue_();   // F7 remediation — cheap no-op on all but ~1 run/day
  var data = getMany(['cfbp_weeks', 'cfbp_picks', 'cfbp_games', 'cfbp_players', 'cfbp_active_week']);
  var weeks = data['cfbp_weeks'] || [];
  var allGames = data['cfbp_games'] || [];
  var week = selectActiveOpenWeek_(weeks, data['cfbp_active_week'], allGames);   // F10
  // DI-B2 — demo weeks never fire; also nothing to do without an OPEN week.
  if (!week || week.dataSourceMode === 'demo') return;

  var weekGames = allGames.filter(function (g) { return g && g.weekId === week.weekId; });
  var totalGames = weekGames.length;
  if (!totalGames) return;   // nothing on the slate yet — nothing to remind about

  var lockAtMs = effectiveLockAtMs_(week, weekGames);
  if (lockAtMs === null) return;
  var now = Date.now();
  if (now >= lockAtMs) return;   // already past lock — PICKS_LOCKED fires client-side, not here (§ DI-B2)

  var players = (data['cfbp_players'] || []).filter(function (p) { return p && p.active; });
  // BLOCKING #1 remediation — lookup map for applyReminderScanCandidates_'s
  // push-preference gate; built from the SAME active-players list, no extra read.
  var playersById = {};
  players.forEach(function (p) { playersById[p.playerId] = p; });
  var allPicks = data['cfbp_picks'] || [];
  var weekPicks = allPicks.filter(function (pk) { return pk && pk.weekId === week.weekId; });
  var completedByPlayer = {};
  players.forEach(function (p) { completedByPlayer[p.playerId] = 0; });
  weekPicks.forEach(function (pk) {
    if (pk && Object.prototype.hasOwnProperty.call(completedByPlayer, pk.playerId)) {
      completedByPlayer[pk.playerId] += 1;
    }
  });

  var candidates = [];
  var destination = { tab: 'picks', params: {} };

  // ── PICKS_REMINDER — personalized, per player, per threshold ─────────────
  // `category: 'pickReminders'` matches js/notifications.js's
  // CATEGORY_OF_EVENT[PICKS_REMINDER] exactly (BLOCKING #1 remediation).
  REMINDER_THRESHOLDS.forEach(function (th) {
    if (now < lockAtMs - th.ms) return;   // this threshold hasn't been reached yet
    players.forEach(function (p) {
      var remaining = totalGames - (completedByPlayer[p.playerId] || 0);
      if (remaining <= 0) return;   // DI-B2 — a player with zero remaining never receives this
      var dedupKey = 'PICKS_REMINDER|' + week.weekId + '|' + th.key + '|' + p.playerId;
      var facts = { remainingPicks: remaining, weekN: week.weekNumber, timeUntilLock: th.key };
      var body = scribeBuildCopy_(SCRIBE_PICKS_REMINDER_POOL, SCRIBE_PICKS_REMINDER_FALLBACK, facts, dedupKey);
      candidates.push({
        playerId: p.playerId, dedupKey: dedupKey, title: 'Picks reminder', body: body,
        destination: destination, event: 'PICKS_REMINDER', weekId: week.weekId, meta: facts,
        category: 'pickReminders',
      });
    });
  });

  // ── PICKS_LOCKING_SOON — broadcast, single fire at the 1h mark, named
  //    non-submitters by default (Drew's 2026-09-10 ruling — the blind-rule's
  //    ONE permitted exception; identity of non-submission only, never pick
  //    content). Every entry shares one batchKey so
  //    applyReminderScanCandidates_ collapses them into ONE OneSignal call
  //    for every newly-eligible player this scan. ───────────────────────────
  if (now >= lockAtMs - LOCKING_SOON_MS) {
    var nonSubmitters = [];
    players.forEach(function (p) {
      if ((completedByPlayer[p.playerId] || 0) < totalGames) {
        nonSubmitters.push(p.displayName || p.playerId);
      }
    });
    var submittedCount = players.length - nonSubmitters.length;
    var lockingSoonDedupBase = 'PICKS_LOCKING_SOON|' + week.weekId + '|locking-soon|';
    // Read ONCE per scan, and only on the ~1-in-4 scans that actually reach
    // the locking-soon window — a PropertiesService read costs nothing on the
    // other runs this way, and the value can never change mid-scan.
    var nameNonSubmitters = notifyNameNonSubmittersEnabled_(
      PropertiesService.getScriptProperties().getProperty(NOTIFY_NAME_NON_SUBMITTERS_PROP));
    var facts2, body2;
    if (nonSubmitters.length && nameNonSubmitters) {
      facts2 = { weekN: week.weekNumber, timeUntilLock: '1h', namedNonSubmitters: nonSubmitters.join(', '), submittedCount: submittedCount, totalPlayers: players.length };
      body2 = scribeBuildCopy_(SCRIBE_PICKS_LOCKING_SOON_POOL, SCRIBE_PICKS_LOCKING_SOON_FALLBACK, facts2, lockingSoonDedupBase);
    } else if (nonSubmitters.length) {
      // Count-only mode. `namedNonSubmitters` is deliberately NOT placed in
      // facts2 at all — not blanked, not joined-then-dropped — so no player
      // name reaches the notification BODY or the stored META, and the
      // count-only pool's own templates cannot reference it either.
      facts2 = { weekN: week.weekNumber, timeUntilLock: '1h', submittedCount: submittedCount, totalPlayers: players.length };
      body2 = scribeBuildCopy_(SCRIBE_PICKS_LOCKING_SOON_COUNT_ONLY_POOL, SCRIBE_PICKS_LOCKING_SOON_FALLBACK, facts2, lockingSoonDedupBase);
    } else {
      facts2 = { weekN: week.weekNumber, totalPlayers: players.length };
      body2 = scribeBuildCopy_(SCRIBE_PICKS_LOCKING_SOON_ALL_IN_POOL, SCRIBE_PICKS_LOCKING_SOON_ALL_IN_FALLBACK, facts2, lockingSoonDedupBase);
    }
    players.forEach(function (p) {
      candidates.push({
        playerId: p.playerId, dedupKey: lockingSoonDedupBase + p.playerId,
        title: 'Locking soon', body: body2, destination: destination, event: 'PICKS_LOCKING_SOON',
        weekId: week.weekId, meta: facts2, batchKey: lockingSoonDedupBase,
        // 'leagueUpdates' matches js/notifications.js's
        // CATEGORY_OF_EVENT[PICKS_LOCKING_SOON] exactly (BLOCKING #1 remediation).
        category: 'leagueUpdates',
      });
    });
  }

  applyReminderScanCandidates_(candidates, playersById);
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
