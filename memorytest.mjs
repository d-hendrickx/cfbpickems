/**
 * CFB Pickems — memorytest.mjs (Build 3, Group D, 2026-09-11, DI-D1/DI-D2)
 * ===========================================================================
 * Unit/integration tests for the SERVER half of Group D:
 *   - `CFBP_SCRIBE_MEMORY` — the dedicated memory sheet (Facts / Relations /
 *     hard-lines / roast tolerance) with TRUE per-row deletion
 *   - `scribeAutonomous` — the paid, unprompted-post action and every gate
 *     in front of it
 *   - `scribeClassify` — the capped chat-reactive classifier
 *
 * HARNESS: `backend/Code.gs` executed WHOLESALE inside a Node `vm` context,
 * the identical shape scribetest.mjs and trainertest.mjs already use (they
 * are deliberately duplicated rather than shared — each file is its own
 * process and its own clean state). One addition: `deleteRow`, which the
 * other two never needed because nothing in Build 2 ever deleted a row. That
 * is the point of this build.
 *
 * Run:  node memorytest.mjs
 * Must be run under BOTH TZ=UTC and TZ=America/Los_Angeles.
 *
 * Sections — the file runs in this order, and the mutation section deliberately
 * sits in the MIDDLE (it was written before the later rounds and renumbering it
 * would break every cross-reference in the assertions):
 *   [1]  CFBP_SCRIBE_MEMORY bootstrap — header, idempotency, widen-in-place
 *   [2]  upsert -> list round trip — float confidence, 200-char value cap, validation
 *   [3]  delete is PHYSICAL — gone from the raw sheet, not tombstoned
 *   [4]  Ownership on write and delete; a player's own write is forced player-stated
 *   [5]  Computed facts — idempotent, confidence 1.0, reusing the tools SCRIBE calls
 *   [6]  Approved fact candidates -> memory, idempotent, pending never applied
 *   [7]  Two floors, one store — 0.5 for the model, 0 for the player's own view
 *   [8]  Hard-lines reach the model as constraints, block 5, below the cache breakpoint
 *   [9]  Structural — no embedding/vector-store API in this feature's path (+ canaries)
 *   [10] scribeAutonomous gate order, each proven to spend NOTHING, incl. the
 *        server-side re-score (BLOCK-1) and both BLOCK-2 bounds
 *   [11] The autonomous post — shape, room context (F1), brief, tools, 2-sentence bound
 *   [12] Failure -> SILENT DROP: no post, no fallback line, a logged error
 *   [13] scribeClassify — daily cap, points mapping, never posts, no persona
 *   [14] MUTATION-PROOFS (in-memory source copies only, never the file, never git):
 *        threshold re-check, deleteRow, triggerSeq, unsorted streak, list ownership,
 *        trust-the-client score, league-wide floor, computed rows to the model,
 *        stamp-after-fetch, verdict reuse
 *   [15] F6 — the SIGNAL_POINTS twin and the combiner, server side
 *   [16] F6 — the calibration loop: near-miss replay, median + clamp, Trainer run
 *   [17] F2 — the streak is chronological, graded-only, and refuses to guess
 *   [18] F5 — reading another player's memory is refused
 *   [19] Note 13 — Episodes (📌 remember_this) ride the same context block
 *   [20] BLOCK-3 — computed facts never reach the model; refreshedAt is stamped
 *   [21] S-1 — the memory key is an identifier, capped and printable
 *   [22] N-2 — a repeat classify returns the verdict it already paid for
 *   [23] FINDING 2 — the league-wide stamp is taken at RESERVATION, not after the fetch
 *   [24] FINDING 3 — a claim is bound to its message; a verdict funds one post
 *   [25] F-D — the verdict is consumed whenever it contributed, whatever the trigger
 *   [26] F-E — the classify log key is sanitized identically on write and read
 *   [27] F-G — the stamp restore only puts back what is still ours
 */
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

console.log(`\n[TZ] running under TZ=${process.env.TZ || '(unset)'}\n`);

const codeGsSrc = await readFile(fileURLToPath(new URL('./backend/Code.gs', import.meta.url)), 'utf8');

// ── GAS sandbox harness ────────────────────────────────────────────────────
function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
function fakeFormatDate(date, tz, pattern) {
  const y = date.getUTCFullYear(), m = date.getUTCMonth() + 1, d = date.getUTCDate();
  if (pattern === 'yyyy-MM') return `${y}-${pad(m, 2)}`;
  if (pattern === 'yyyy-MM-dd') return `${y}-${pad(m, 2)}-${pad(d, 2)}`;
  if (pattern === 'yyyyMMdd') return `${y}${pad(m, 2)}${pad(d, 2)}`;
  throw new Error('fakeFormatDate: unsupported pattern ' + pattern);
}

function makeFakeSheet() {
  const data = [];
  return {
    data,
    getRange(row, col, numRows = 1, numCols = 1) {
      return {
        getValues() {
          const out = [];
          for (let r = 0; r < numRows; r++) {
            const rowArr = data[row - 1 + r] || [];
            const rowOut = [];
            for (let c = 0; c < numCols; c++) rowOut.push(rowArr[col - 1 + c] !== undefined ? rowArr[col - 1 + c] : '');
            out.push(rowOut);
          }
          return out;
        },
        setValues(vals) {
          for (let r = 0; r < vals.length; r++) {
            const rIdx = row - 1 + r;
            if (!data[rIdx]) data[rIdx] = [];
            for (let c = 0; c < vals[r].length; c++) data[rIdx][col - 1 + c] = vals[r][c];
          }
        },
        getValue() { return this.getValues()[0][0]; },
        setValue(v) { this.setValues([[v]]); },
        setNumberFormat() { return this; },
        clearContent() {
          for (let r = 0; r < numRows; r++) {
            const rIdx = row - 1 + r;
            if (data[rIdx]) for (let c = 0; c < numCols; c++) data[rIdx][col - 1 + c] = '';
          }
        },
      };
    },
    getLastRow() { return data.length; },
    getLastColumn() { return (data[0] && data[0].length) || 0; },
    setFrozenRows() {},
    // The one addition over scribetest/trainertest's copy of this stub — and
    // the whole reason D2 gets its own sheet instead of riding the
    // append-only chat log.
    deleteRow(rowIndex) { data.splice(rowIndex - 1, 1); },
    getDataRange() {
      const maxCols = data.reduce((m, r) => Math.max(m, r ? r.length : 0), 0) || 1;
      return this.getRange(1, 1, data.length, maxCols);
    },
  };
}

function buildSandbox(srcOverride) {
  const props = {};
  const scriptProps = {
    getProperty: k => (Object.prototype.hasOwnProperty.call(props, k) ? props[k] : null),
    setProperty: (k, v) => { props[k] = String(v); },
    deleteProperty: k => { delete props[k]; },
  };
  const cacheStore = new Map();
  const cache = {
    get: k => (cacheStore.has(k) ? cacheStore.get(k) : null),
    put: (k, v) => cacheStore.set(k, String(v)),
    remove: k => cacheStore.delete(k),
  };
  const sheets = {};
  const ss = {
    getSheetByName: n => sheets[n] || null,
    insertSheet: n => { const s = makeFakeSheet(); sheets[n] = s; return s; },
  };
  const urlFetchCalls = [];
  let urlFetchImpl = null;
  const sandbox = {
    PropertiesService: { getScriptProperties: () => scriptProps },
    CacheService: { getScriptCache: () => cache },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    Utilities: { getUuid: () => 'uuid_' + Math.random().toString(36).slice(2) + Date.now().toString(36), formatDate: fakeFormatDate },
    UrlFetchApp: {
      fetch(url, opts) {
        urlFetchCalls.push({ url, opts });
        if (!urlFetchImpl) throw new Error('UrlFetchApp.fetch stub not configured for this test (url=' + url + ')');
        return urlFetchImpl(url, opts);
      },
    },
    ContentService: { createTextOutput: s => ({ setMimeType: () => ({ getContent: () => s }) }), MimeType: { JSON: 'JSON' } },
    Logger: { log() {} },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(srcOverride || codeGsSrc, sandbox, { filename: 'Code.gs' });
  const storeSheet = makeFakeSheet();
  storeSheet.getRange(1, 1, 1, 3).setValues([['key', 'json', 'updatedAt']]);
  sheets['CFBP_STORE'] = storeSheet;
  return { gs: sandbox, props, cacheStore, sheets, urlFetchCalls, setUrlFetchImpl: fn => { urlFetchImpl = fn; } };
}

function b64(str) { return Buffer.from(str, 'binary').toString('base64'); }
const TEST_COMMISH_PW = 'hunter2';
function seedCommissionerPassword(env, pw = TEST_COMMISH_PW) {
  const settings = env.gs.getOne('cfbp_settings') || {};
  settings.adminPasswordHash = b64(pw);
  env.gs.setOne('cfbp_settings', settings);
  return settings.adminPasswordHash;
}
function setFrequency(env, level) {
  const settings = env.gs.getOne('cfbp_settings') || {};
  settings.scribeFrequency = level;
  env.gs.setOne('cfbp_settings', settings);
}
function anthropicTextResponse(text, usage = {}) {
  const body = { content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 400, output_tokens: 60, ...usage } };
  return { getResponseCode: () => 200, getContentText: () => JSON.stringify(body) };
}
function anthropicJsonResponse(obj) {
  return anthropicTextResponse(JSON.stringify(obj));
}
function appendMsgRow(sheet, { id, type = 'message', author, gameTag = '', body = '', targetId = '', replyTo = '', meta = {}, ts }) {
  const row = sheet.getLastRow() + 1;
  const seq = row - 1;
  sheet.getRange(row, 1, 1, 10).setValues([[seq, id, ts !== undefined ? ts : Date.now(), type, author, gameTag, body, targetId, replyTo, JSON.stringify(meta)]]);
  return seq;
}
/** Three players, one FINAL week, three final games with known ATS outcomes.
 *  p1 covers all three (3-0), p2 loses all three, p3 splits. */
function seedLeague(env) {
  const players = [
    { playerId: 'p1', displayName: 'Drew', active: true },
    { playerId: 'p2', displayName: 'Brayden', active: true },
    { playerId: 'p3', displayName: 'Kevin', active: true },
  ];
  const weeks = [{ weekId: 'w1', season: '2026', weekNumber: 1, status: 'final', actualTiebreakerValue: 50 }];
  const games = [];
  const picks = [];
  for (let i = 1; i <= 6; i++) {
    // home wins by 10 against a -3 home spread -> home covers, every time.
    // F2 — every game carries a real kickoff: a chronological claim is only
    // emitted when the whole sequence can actually be ordered.
    games.push({ gameId: 'g' + i, weekId: 'w1', status: 'final', homeTeam: 'Home' + i, awayTeam: 'Away' + i,
                 kickoff: '2026-09-0' + i + 'T17:00:00Z',
                 homeScore: 30, awayScore: 20, spread: -3, lockedSpread: -3, favorite: 'home', multiplier: 1 });
    picks.push({ weekId: 'w1', playerId: 'p1', gameId: 'g' + i, selectedTeam: 'Home' + i });          // all correct
    picks.push({ weekId: 'w1', playerId: 'p2', gameId: 'g' + i, selectedTeam: 'Away' + i });          // all wrong
    picks.push({ weekId: 'w1', playerId: 'p3', gameId: 'g' + i, selectedTeam: i <= 3 ? 'Home' + i : 'Away' + i });
  }
  env.gs.setMany({ cfbp_players: players, cfbp_weeks: weeks, cfbp_games: games, cfbp_picks: picks,
                   cfbp_tiebreaker_guesses: { w1__p1: 50, w1__p2: 40, w1__p3: 30 } });
}
function memRows(env) {
  const s = env.sheets['CFBP_SCRIBE_MEMORY'];
  return s ? s.data.slice(1).filter(r => r && r[0]) : [];
}
function logRows(env) {
  const s = env.sheets['CFBP_SCRIBE_LOG'];
  return s ? s.data.slice(1).filter(r => r && r[0]) : [];
}
function chatRows(env) {
  const s = env.sheets['CFBP_MESSAGES'];
  return s ? s.data.slice(1).filter(r => r && r[1]) : [];
}
/** Trainer needs BOTH switches on plus a key — same helper trainertest uses. */
function enableTrainer(env, extra = {}) {
  env.props.ANTHROPIC_API_KEY = 'test-key';
  env.props.SCRIBE_TRAINER_ENABLED = 'true';
  env.props.SCRIBE_INTERACTIVE_ENABLED = 'true';
  Object.entries(extra).forEach(([k, v]) => { env.props[k] = String(v); });
}
/** A valid structured-output Trainer response — the DEFAULT fixture. */
function trainerOutput(overrides = {}) {
  return {
    active_learnings: [], canon_candidates: [], proposed_experiments: [], fact_candidates: [],
    report: {
      what_landed: 'Short replies performed well.', what_missed: 'Nothing notable.',
      what_scribe_learned: 'Prefer brevity.', changes_being_tested: 'None yet.',
      feedback_not_adopted: 'Insufficient evidence.', what_we_need_more_data_on: 'More weeks.',
    },
    ...overrides,
  };
}
/** Seeds `n` SCRIBE responses, each rated once, so the window clears the
 *  insufficient-data floor (>=3 DISTINCT rated responses). */
function seedRatedWindow(env, n = 3) {
  const s = env.gs.ensureMsgSheet();
  for (let i = 0; i < n; i++) {
    appendMsgRow(s, { id: 'sr' + i, author: 'scribe', body: 'scribe line ' + i });
    appendMsgRow(s, { id: 'fbr' + i, type: 'feedback', author: 'p1', targetId: 'sr' + i, meta: { category: 'rating', value: 'hit' } });
  }
  return s;
}
/** The manual Trainer HTTP path, with a valid commissioner credential. */
function runTrainerAuthed(env, extra = {}) {
  const hash = seedCommissionerPassword(env);
  return env.gs.runTrainer(Object.assign({ adminPasswordHash: hash }, extra));
}
function enableAutonomous(env, extra = {}) {
  env.props.ANTHROPIC_API_KEY = 'test-key';
  env.props.SCRIBE_INTERACTIVE_ENABLED = 'true';
  env.props.SCRIBE_AUTONOMOUS_ENABLED = 'true';
  Object.entries(extra).forEach(([k, v]) => { env.props[k] = String(v); });
}
/**
 * The evidence envelope a client sends. Two independent things live in here
 * and BLOCK-1 turns on telling them apart:
 *   `signals`      — the NAMES of what fired. Trusted (against an allow-list)
 *                    and scored server-side from Code.gs's own point table.
 *   `claimedScore` — the number the CLIENT says it computed. The server is
 *                    required to ignore it entirely; [10c] is what proves it.
 * `claimedPoints` lets a test put a lying per-signal number on the wire too.
 */
function evidence({ signals = ['backdoorBust'], claimedScore = 90, claimedPoints = null,
                    gameTag = '', weekId = 'w1', triggerMessageId = null } = {}) {
  const points = signals.map(s => (claimedPoints === null ? { signal: s } : { signal: s, points: claimedPoints }));
  return { signal: signals[0], points, score: claimedScore, gameTag, weekId,
           ...(triggerMessageId ? { triggerMessageId } : {}) };
}
/** BLOCK-2 — the league-wide autonomous floor lives in CacheService. A test
 *  that deliberately posts twice has to step past it, exactly as ten real
 *  minutes would. */
function clearGlobalCooldown(env) { env.cacheStore.delete('scribeAutoLast_all'); }

// ═══════════════════════════════════════════════════════════════════════════
console.log('[1] CFBP_SCRIBE_MEMORY bootstrap — header, idempotency, widen-in-place…');
{
  const env = buildSandbox();
  const s = env.gs.ensureScribeMemorySheet();
  const header = s.getRange(1, 1, 1, 10).getValues()[0];
  assert(header.join('|') === 'id|playerId|kind|key|value|provenance|confidence|createdAt|reviewAt|sourceMessageId',
    `header is exactly DI-D2's record shape (got ${header.join('|')})`);
  const again = env.gs.ensureScribeMemorySheet();
  assert(again === s && s.data.length === 1, 'idempotent — a second call returns the same sheet and adds no rows');

  // A sheet created by an older/narrower revision keeps its rows and only
  // gains the missing header cells (the P1-remediation shape).
  const env2 = buildSandbox();
  const narrow = env2.sheets['CFBP_SCRIBE_MEMORY'] = makeFakeSheet();
  narrow.getRange(1, 1, 1, 4).setValues([['id', 'playerId', 'kind', 'key']]);
  narrow.getRange(2, 1, 1, 4).setValues([['mem_old', 'p1', 'fact', 'job']]);
  env2.gs.ensureScribeMemorySheet();
  assert(narrow.getRange(1, 1, 1, 10).getValues()[0][9] === 'sourceMessageId', 'an under-width header is widened in place');
  assert(narrow.getRange(2, 1, 1, 4).getValues()[0].join('|') === 'mem_old|p1|fact|job', 'the pre-existing row is untouched by the widening — no column renumbering');

  assert(/ensureScribeMemorySheet\(\);\s*\/\/ Build 3/.test(codeGsSrc), 'setup() calls ensureScribeMemorySheet() — the sheet exists after one setup() run, not on first write');
}

console.log('\n[2] upsert -> list round trip — float confidence, 200-char cap, validation…');
{
  const env = buildSandbox();
  const hash = seedCommissionerPassword(env);
  const r = env.gs.scribeMemoryUpsert({ adminPasswordHash: hash, record: {
    playerId: 'p1', kind: 'fact', key: 'job', value: 'started a new job in March',
    provenance: 'trainer-proposed', confidence: 0.62, sourceMessageId: 'm42' } });
  assert(r.ok === true && r.record.id.indexOf('mem_') === 0, 'upsert returns the stored record with a mem_ id');
  const list = env.gs.scribeMemoryList({ playerId: 'p1' });
  assert(list.records.length === 1, 'list returns exactly the row written');
  const rec = list.records[0];
  assert(rec.confidence === 0.62 && typeof rec.confidence === 'number',
    `confidence round-trips as a FLOAT, not coerced to a boolean or an int (got ${JSON.stringify(rec.confidence)} / ${typeof rec.confidence})`);
  assert(rec.value === 'started a new job in March' && rec.provenance === 'trainer-proposed' && rec.sourceMessageId === 'm42',
    'value / provenance / sourceMessageId all round-trip verbatim');
  assert(rec._row === undefined, 'the physical row index is NOT leaked to the client — it is invalidated by any delete');

  // Idempotent by (playerId, kind, key).
  env.gs.scribeMemoryUpsert({ adminPasswordHash: hash, record: { playerId: 'p1', kind: 'fact', key: 'job', value: 'changed jobs again', provenance: 'commissioner-set', confidence: 1 } });
  const list2 = env.gs.scribeMemoryList({ playerId: 'p1' });
  assert(list2.records.length === 1 && list2.records[0].value === 'changed jobs again',
    'a second upsert on the same (playerId,kind,key) UPDATES the row rather than appending a duplicate');
  assert(list2.records[0].id === rec.id && list2.records[0].createdAt === rec.createdAt,
    'the id and createdAt survive the update — an edit is not a new record');

  const long = 'x'.repeat(400);
  env.gs.scribeMemoryUpsert({ adminPasswordHash: hash, record: { playerId: 'p1', kind: 'fact', key: 'ramble', value: long, provenance: 'commissioner-set', confidence: 1 } });
  const stored = env.gs.scribeMemoryList({ playerId: 'p1', kinds: ['fact'] }).records.filter(x => x.key === 'ramble')[0];
  assert(stored.value.length === 200, `a 400-char value is capped at 200 — this is a fact store, not a second chat log (got ${stored.value.length})`);

  const bad = env.gs.scribeMemoryUpsert({ adminPasswordHash: hash, record: { playerId: 'p1', kind: 'gossip', key: 'k', value: 'v', provenance: 'commissioner-set', confidence: 1 } });
  assert(bad.ok === false && /unknown kind/.test(bad.error), 'an unknown kind is rejected at the boundary, not stored');
  const bad2 = env.gs.scribeMemoryUpsert({ adminPasswordHash: hash, record: { playerId: 'p1', kind: 'fact', key: 'k', value: 'v', provenance: 'made-it-up', confidence: 1 } });
  assert(bad2.ok === false && /unknown provenance/.test(bad2.error), 'an unknown provenance is rejected — provenance is what D3 renders as "how SCRIBE knows this"');
  const clamped = env.gs.scribeMemoryUpsert({ adminPasswordHash: hash, record: { playerId: 'p1', kind: 'fact', key: 'clamp', value: 'v', provenance: 'computed', confidence: 4.5 } });
  assert(clamped.record.confidence === 1, 'confidence is clamped into 0.0-1.0');
}

console.log('\n[3] delete is PHYSICAL — the row is gone from the raw sheet, not tombstoned…');
{
  const env = buildSandbox();
  const hash = seedCommissionerPassword(env);
  const a = env.gs.scribeMemoryUpsert({ adminPasswordHash: hash, record: { playerId: 'p1', kind: 'fact', key: 'a', value: 'A', provenance: 'computed', confidence: 1 } }).record;
  const b = env.gs.scribeMemoryUpsert({ adminPasswordHash: hash, record: { playerId: 'p1', kind: 'fact', key: 'b', value: 'B', provenance: 'computed', confidence: 1 } }).record;
  assert(memRows(env).length === 2, 'fixture check: two rows exist before the delete');
  const del = env.gs.scribeMemoryDelete({ adminPasswordHash: hash, id: a.id });
  assert(del.ok === true && del.deleted === true, 'delete reports success');
  assert(env.gs.scribeMemoryList({ playerId: 'p1' }).records.length === 1, 'the deleted row is gone from a subsequent list');
  const raw = memRows(env);
  assert(raw.length === 1 && String(raw[0][0]) === b.id,
    'the row is PHYSICALLY absent from the raw sheet read — no tombstone, no hidden flag (this is why memory is not on the append-only chat log)');
  assert(!JSON.stringify(raw).includes(a.id), 'the deleted id appears nowhere in the raw sheet data');
  const again = env.gs.scribeMemoryDelete({ adminPasswordHash: hash, id: a.id });
  assert(again.ok === true && again.deleted === false && again.reason === 'not_found', 'deleting an already-deleted id is a clean no-op, not an error');
}

console.log('\n[4] Ownership — best-effort, stated honestly, and actually enforced…');
{
  const env = buildSandbox();
  const hash = seedCommissionerPassword(env);
  const mine = env.gs.scribeMemoryUpsert({ adminPasswordHash: hash, record: { playerId: 'p1', kind: 'fact', key: 'job', value: 'A', provenance: 'computed', confidence: 1 } }).record;
  const notMine = env.gs.scribeMemoryDelete({ playerId: 'p2', id: mine.id });
  assert(notMine.ok === false && /another player/.test(notMine.error), "p2 cannot delete p1's memory row");
  assert(memRows(env).length === 1, 'and the row is still there — a rejected delete deletes nothing');
  const own = env.gs.scribeMemoryDelete({ playerId: 'p1', id: mine.id });
  assert(own.ok === true && own.deleted === true, 'p1 CAN delete his own row (D4: delete anything, no explanation needed)');

  const spoof = env.gs.scribeMemoryUpsert({ playerId: 'p2', record: { playerId: 'p1', kind: 'hardline', key: 'topic', value: 'x', provenance: 'player-stated', confidence: 1 } });
  assert(spoof.ok === false && /only write memory about himself/.test(spoof.error), 'p2 cannot write a row about p1');
  const wrongKind = env.gs.scribeMemoryUpsert({ playerId: 'p1', record: { playerId: 'p1', kind: 'fact', key: 'job', value: 'CEO', provenance: 'computed', confidence: 1 } });
  assert(wrongKind.ok === false && /hard-lines, roast tolerance and wagers/.test(wrongKind.error),
    'a player cannot inject a computed-provenance FACT about himself — only a hard-line or a roast tolerance');
  const hardline = env.gs.scribeMemoryUpsert({ playerId: 'p1', record: { playerId: 'p1', kind: 'hardline', key: 'topic', value: 'my knee surgery', provenance: 'computed', confidence: 0.1 } });
  assert(hardline.ok === true && hardline.record.provenance === 'player-stated' && hardline.record.confidence === 1,
    "a player's own hard-line is FORCED to provenance 'player-stated' and confidence 1.0, whatever the request claimed");
}

console.log('\n[5] Computed facts — idempotent, confidence 1.0, reusing the SAME tools SCRIBE calls…');
{
  const env = buildSandbox();
  seedLeague(env);
  const first = env.gs.scribeMemoryRefreshComputed_();
  const afterOne = memRows(env).length;
  assert(first.players === 3 && afterOne > 0, `a refresh writes rows for all three active players (${afterOne} rows)`);
  const second = env.gs.scribeMemoryRefreshComputed_();
  assert(memRows(env).length === afterOne, `a SECOND refresh writes no new rows — idempotent by (playerId,kind,key) (still ${memRows(env).length})`);
  assert(second.written === first.written, 'and it touches the same number of records both times');

  const p1 = env.gs.scribeMemoryList({ playerId: 'p1' }).records;
  const record = p1.filter(r => r.key === 'seasonRecord')[0];
  assert(!!record && record.value === '6-0', `p1's computed record comes from the standings twin, not a second computation (got ${record && record.value})`);
  assert(record.provenance === 'computed' && record.confidence === 1, "computed facts are provenance 'computed', confidence 1.0 — no review needed");
  const streak = p1.filter(r => r.key === 'currentStreak')[0];
  assert(!!streak && streak.value === '6 straight covers', `streak is derived from graded pick history (got ${streak && streak.value})`);
  const style = p1.filter(r => r.key === 'pickStyle')[0];
  assert(!!style && /100% of 6 graded picks/.test(style.value), `pick style is derived, not guessed (got ${style && style.value})`);

  const rel = env.gs.scribeMemoryList({ playerId: 'p1', kinds: ['relation'] }).records;
  assert(rel.length === 2, `p1 holds the head-to-head relation for each pair he sorts first in (got ${rel.length})`);
  const h2h = JSON.parse(rel[0].value);
  assert(h2h.pair === 'p1|p2' && h2h.gamesCompared === 6,
    `the relation value embeds the SORTED pair and the computed comparison (got ${rel[0].value})`);
  assert(rel[0].key === 'headToHead:p2',
    'the key disambiguates the opponent — DI-D2\'s bare "headToHead" key cannot be idempotent per pair (deviation flagged in Code.gs)');

  // The blind rule, inherited rather than re-implemented: an OPEN week's
  // picks cannot reach memory, because the tool itself withholds them.
  const env2 = buildSandbox();
  seedLeague(env2);
  const weeks = env2.gs.getOne('cfbp_weeks');
  weeks[0].status = 'open';
  env2.gs.setOne('cfbp_weeks', weeks);
  env2.gs.scribeMemoryRefreshComputed_();
  const openRows = env2.gs.scribeMemoryList({ playerId: 'p1' }).records;
  assert(!openRows.some(r => r.key === 'currentStreak' || r.key === 'pickStyle'),
    'with the only week still OPEN, no streak or pick-style fact is written at all — the blind rule is inherited from get_player_pick_history, not re-implemented');
}

console.log('\n[6] Approved fact candidates -> memory, idempotent, pending never applied…');
{
  const env = buildSandbox();
  seedLeague(env);
  const hash = seedCommissionerPassword(env);
  env.gs.scribeSaveLearnings_([
    { kind: 'fact_candidate', playerId: 'p1', key: 'newJob', value: 'started a new job', confidence: 0.6, status: 'approved', sourceMessageId: 'm7' },
    { kind: 'fact_candidate', playerId: 'p2', key: 'dog', value: 'got a dog', confidence: 0.55, status: 'pending' },
    { kind: 'learning', learningId: 'L1', status: 'approved', confidence: 0.95 },
  ]);
  const denied = env.gs.scribeMemorySync({ playerId: 'p1' });
  assert(denied.ok === false && /commissioner password/.test(denied.error), 'syncing approved facts without the commissioner credential is rejected');

  const r1 = env.gs.scribeMemorySync({ adminPasswordHash: hash, refreshComputed: false });
  assert(r1.ok === true && r1.applied === 1, `exactly the ONE approved candidate is applied (got ${r1.applied})`);
  const p1Facts = env.gs.scribeMemoryList({ playerId: 'p1', kinds: ['fact'] }).records;
  const applied = p1Facts.filter(f => f.key === 'newJob')[0];
  assert(!!applied && applied.provenance === 'trainer-proposed' && applied.confidence === 0.6 && applied.sourceMessageId === 'm7',
    "the applied row carries provenance 'trainer-proposed', the Trainer's own confidence, and the source message");
  assert(env.gs.scribeMemoryList({ playerId: 'p2' }).records.length === 0,
    'the PENDING candidate is not applied — D-4: a claim about a real person is never auto-applied');

  const r2 = env.gs.scribeMemorySync({ adminPasswordHash: hash, refreshComputed: false });
  assert(r2.applied === 0, 'a second sync applies nothing — idempotent via the memoryAppliedAt stamp');
  assert(env.gs.scribeMemoryList({ playerId: 'p1', kinds: ['fact'] }).records.filter(f => f.key === 'newJob').length === 1,
    'and there is still exactly one row, not two');
  assert(env.gs.scribeLoadLearnings_().filter(l => l.memoryAppliedAt).length === 1, 'the applied candidate is stamped in the learnings list');

  const r3 = env.gs.scribeMemorySync({ adminPasswordHash: hash });
  assert(r3.ok === true && r3.refreshed && r3.refreshed.players === 3, 'scribeMemorySync also refreshes the computed facts by default (one button, current data)');
  assert(/try \{ scribeMemoryRefreshComputed_\(\); \}/.test(codeGsSrc), 'and a Trainer run refreshes them too, at the start of the pass');
}

console.log('\n[7] Two floors, one store — 0.5 for the model, 0 for the player…');
{
  const env = buildSandbox();
  const hash = seedCommissionerPassword(env);
  env.gs.scribeMemoryUpsert({ adminPasswordHash: hash, record: { playerId: 'p1', kind: 'fact', key: 'solid', value: 'went to Texas A&M', provenance: 'computed', confidence: 1 } });
  env.gs.scribeMemoryUpsert({ adminPasswordHash: hash, record: { playerId: 'p1', kind: 'fact', key: 'shaky', value: 'maybe hates Oklahoma', provenance: 'trainer-proposed', confidence: 0.4 } });
  const forModel = env.gs.scribeMemoryFor_(['p1'], {});
  assert(forModel.length === 1 && forModel[0].key === 'solid',
    'scribeMemoryFor_ excludes the 0.4-confidence inference — a shaky guess never becomes something SCRIBE says out loud');
  const forPlayer = env.gs.scribeMemoryList({ playerId: 'p1' }).records;
  assert(forPlayer.length === 2 && forPlayer.some(r => r.key === 'shaky'),
    'the player-facing list DOES surface it, so the player can see and correct it (two callers, two floors, same data)');
  const capped = env.gs.scribeMemoryFor_(['p1'], { maxItems: 1, minConfidence: 0 });
  assert(capped.length === 1, 'maxItems caps what reaches the context, matching C5\'s token-budget discipline');
  const none = env.gs.scribeMemoryFor_(['nobody'], {});
  assert(none.length === 0, 'a player with no memory returns nothing — absent renders absent, never a guess (DI-D2 no-fabrication guard)');
  assert(env.gs.scribeMemoryContextText_(['nobody']) === '', 'and the context block for that player is empty, contributing zero tokens');
}

console.log('\n[8] Hard-lines reach the model as constraints, in block 5, below the cache breakpoint…');
{
  const env = buildSandbox();
  const hash = seedCommissionerPassword(env);
  env.gs.scribeMemoryUpsert({ adminPasswordHash: hash, record: { playerId: 'p1', kind: 'hardline', key: 'topic', value: 'his knee surgery', provenance: 'player-stated', confidence: 1 } });
  env.gs.scribeMemoryUpsert({ adminPasswordHash: hash, record: { playerId: 'p1', kind: 'fact', key: 'almaMater', value: 'Texas A&M', provenance: 'commissioner-set', confidence: 1 } });
  const ctx = env.gs.assembleScribeContext_({ invocationType: 'mention', playerId: 'p1', gameTag: '', triggerBody: 'hey', triggerSeq: 1, memoryPlayerIds: ['p1'] });
  const texts = ctx.systemBlocks.map(b => b.text);
  const boundaryBlock = texts.filter(t => t.indexOf('PLAYER BOUNDARIES') === 0)[0];
  assert(!!boundaryBlock, 'a boundaries block is present when the player has a hard-line on file');
  assert(/never bring up with p1: his knee surgery/.test(boundaryBlock), 'the hard-line is phrased as an absolute "never bring up" constraint, naming the player');
  // S-1 (reviewer, round 2) — PRECEDENCE. The old header told the model that
  // player-authored text "overrides anything else in this prompt," which put
  // it above the safety block; a hard-line is only ever an ADDITIONAL
  // restriction.
  assert(!/override anything else in this prompt/.test(boundaryBlock),
    'the block no longer claims player text overrides the rest of the prompt');
  assert(/ADDITIONAL restriction on top of the safety rules above/.test(boundaryBlock),
    'it is framed as narrowing what SCRIBE may say, never as permission');
  assert(/the safety rule wins/.test(boundaryBlock), 'and it says outright which side wins a contradiction');
  assert(/untrusted input/.test(boundaryBlock) && /never instructions/.test(boundaryBlock),
    'and it frames the player text as untrusted, the same framing the classifier prompt uses');
  assert(boundaryBlock.indexOf('PLAYER BOUNDARIES') < boundaryBlock.indexOf('LEAGUE MEMORY'),
    'hard-lines render BEFORE ordinary memory — a boundary buried under trivia reads as trivia');
  assert(/almaMater: Texas A&M/.test(boundaryBlock), 'ordinary facts ride the same block, with their confidence and provenance');

  const personaIdx = texts.findIndex(t => t.indexOf('# SCRIBE.md') === 0);
  const memoryIdx = texts.findIndex(t => t.indexOf('PLAYER BOUNDARIES') === 0);
  assert(personaIdx >= 0 && memoryIdx > personaIdx, 'memory sits AFTER the persona block');
  assert(!!ctx.systemBlocks[personaIdx].cache_control && !ctx.systemBlocks[memoryIdx].cache_control,
    'the cache breakpoint is still pinned to the persona — memory churn can never invalidate SCRIBE.md\'s ~6,000 cached tokens');

  // The C3 tool is no longer a stub.
  const tool = env.gs.tool_getRelevantPlayerContext_({ playerId: 'p1' });
  assert(tool.available === true && tool.memory.length === 2, 'get_relevant_player_context now returns real memory (D2 backs C3\'s reserved stub)');
  assert(env.gs.tool_getRelevantPlayerContext_({ playerId: 'p9' }).available === false, 'and returns available:false for a player with nothing on file');
}

console.log('\n[9] Structural — no embedding/vector-store API anywhere in this feature…');
{
  const scribeLinesSrc = await readFile(fileURLToPath(new URL('./js/scribeLines.js', import.meta.url)), 'utf8');
  const scribeAgentSrc = await readFile(fileURLToPath(new URL('./js/scribeAgent.js', import.meta.url)), 'utf8');
  // Targets an actual EMBEDDING/VECTOR-STORE call, not the English word
  // "vector" — Code.gs legitimately says "spoof-the-prompt vector" in prose,
  // and a scan that flagged that would be pressured into being loosened.
  const VECTOR_API = /\/v1\/embeddings|embeddings?\.create|createEmbedding|pinecone|weaviate|qdrant|\bfaiss\b|chromadb|vectorStore|vectorDb|cosineSimilarity/i;
  for (const [name, src] of [['backend/Code.gs', codeGsSrc], ['js/scribeLines.js', scribeLinesSrc], ['js/scribeAgent.js', scribeAgentSrc]]) {
    assert(!VECTOR_API.test(src), `${name} contains no embedding/vector-store API call — retrieval is a .filter() over a few dozen rows (DI §1's explicit rejection)`);
  }
  assert(VECTOR_API.test('const r = await openai.embeddings.create({ input });'),
    'canary: the scan DOES fire on a real embedding call — the guard is capable of failing (RG-27)');
  assert(!VECTOR_API.test('closes a trivial spoof-the-prompt vector'),
    'canary: the scan does NOT fire on the English word "vector" in prose — the exclusion is deliberate and narrow');
}

console.log('\n[10] scribeAutonomous — the gate order, each spending NOTHING…');
{
  // (a) the property is off — the safe default on a fresh deploy
  const a = buildSandbox();
  a.props.ANTHROPIC_API_KEY = 'test-key'; a.props.SCRIBE_INTERACTIVE_ENABLED = 'true';
  const ra = a.gs.scribeAutonomous({ trigger: 'backdoorBust', subject: 'p1', evidence: evidence({ signals: ['backdoorBust'] }) });
  assert(ra.ok === true && ra.skipped === 'disabled_autonomous', 'SCRIBE_AUTONOMOUS_ENABLED defaults OFF and is checked first');
  assert(a.urlFetchCalls.length === 0 && logRows(a).length === 0, '…with zero Anthropic calls and zero log rows — nothing was spent');

  // (b) the global stop
  const b = buildSandbox();
  b.props.ANTHROPIC_API_KEY = 'test-key'; b.props.SCRIBE_AUTONOMOUS_ENABLED = 'true';
  const rb = b.gs.scribeAutonomous({ trigger: 'backdoorBust', subject: 'p1', evidence: evidence({ signals: ['backdoorBust'] }) });
  assert(rb.skipped === 'disabled_interactive' && b.urlFetchCalls.length === 0, 'SCRIBE_INTERACTIVE_ENABLED is a global stop on autonomy too, zero spend');

  // (c) the threshold, RE-CHECKED server-side against settings.scribeFrequency
  // BLOCK-1 (reviewer, round 2) — THE SCORE IS RECOMPUTED SERVER-SIDE FROM
  // SIGNAL NAMES. `evidence.score` is never read; these assertions are the
  // proof, and the mutation at [14] is the proof that they are load-bearing.
  const c = buildSandbox();
  enableAutonomous(c); setFrequency(c, 'balanced');
  c.setUrlFetchImpl(() => anthropicTextResponse('Should never be called.'));
  const lyingLow = c.gs.scribeAutonomous({ trigger: 'verbosity', subject: 'p1',
    evidence: evidence({ signals: ['verbosity'], claimedScore: 90 }) });
  assert(lyingLow.skipped === 'below_threshold' && lyingLow.score === 10 && lyingLow.threshold === 45,
    `a client claiming score 90 for a single 'verbosity' signal is scored at the table's 10 and refused (got ${lyingLow.score})`);
  assert(c.urlFetchCalls.length === 0, '…and spends nothing');
  const lyingPoints = c.gs.scribeAutonomous({ trigger: 'verbosity', subject: 'p1c',
    evidence: evidence({ signals: ['verbosity'], claimedScore: 90, claimedPoints: 999 }) });
  assert(lyingPoints.score === 10, `a per-signal points value on the wire is discarded too (got ${lyingPoints.score})`);
  const unknown = c.gs.scribeAutonomous({ trigger: 'backdoorBust', subject: 'p1d',
    evidence: evidence({ signals: ['notARealSignal'], claimedScore: 90 }) });
  assert(unknown.score === 0, `a signal name that is not on the allow-list contributes 0 (got ${unknown.score})`);
  const badTrigger = c.gs.scribeAutonomous({ trigger: 'rm -rf', subject: 'p1e', evidence: evidence({}) });
  assert(badTrigger.ok === false && /Unknown trigger/.test(badTrigger.error),
    'N-6 — and an arbitrary trigger string is refused outright, before any gate');
  assert(c.urlFetchCalls.length === 0, 'none of the above cost a cent');

  // A claim is worth ONLY what the server's own classifier said it was.
  const cl = buildSandbox();
  enableAutonomous(cl); setFrequency(cl, 'balanced');
  appendMsgRow(cl.gs.ensureMsgSheet(), { id: 'cm1', author: 'p2', body: 'I guarantee it' });
  cl.setUrlFetchImpl(() => anthropicTextResponse('Should never be called.'));
  const unverified = cl.gs.scribeAutonomous({ trigger: 'claim', subject: 'p2',
    evidence: evidence({ signals: ['claim'], claimedScore: 90, claimedPoints: 50, triggerMessageId: 'cm1' }) });
  assert(unverified.skipped === 'below_threshold' && unverified.score === 0,
    `a 'claim' with NO logged classifier verdict is worth 0 no matter what the client says (got ${unverified.score})`);
  assert(cl.urlFetchCalls.length === 0, '…and buys nothing');
  cl.setUrlFetchImpl(() => anthropicJsonResponse({ claim: true, kind: 'guarantee', confidence: 0.9 }));
  const verdict = cl.gs.scribeClassify({ messageId: 'cm1' });
  assert(verdict.points === 45, 'fixture check: the server classified it at 45');
  cl.setUrlFetchImpl(() => anthropicTextResponse('Bold claim, bold result.'));
  const verified = cl.gs.scribeAutonomous({ trigger: 'claim', subject: 'p2', playerId: 'p2',
    evidence: evidence({ signals: ['claim'], claimedScore: 1, claimedPoints: 0, triggerMessageId: 'cm1' }) });
  assert(verified.posted === true && verified.score === 45,
    `once the SERVER has a logged verdict the same claim scores 45 — recovered from the log, never from the request (got ${verified.score})`);

  // Exactly at the threshold fires; one point below never does.
  const at = buildSandbox();
  enableAutonomous(at); setFrequency(at, 'balanced');
  at.setUrlFetchImpl(() => anthropicTextResponse('One line.'));
  const exact = at.gs.scribeAutonomous({ trigger: 'chartLeadChange', subject: 'x1',
    evidence: evidence({ signals: ['chartLeadChange'] }) });                       // 45
  assert(exact.posted === true && exact.score === 45, 'EXACTLY at the threshold it fires (>=, not >)');
  clearGlobalCooldown(at);
  const justUnder = at.gs.scribeAutonomous({ trigger: 'milestone', subject: 'x2',
    evidence: evidence({ signals: ['milestone'] }) });                             // 40
  assert(justUnder.skipped === 'below_threshold' && justUnder.score === 40, 'five points under, it does not');

  // The dial is the league's, not the caller's.
  const d = buildSandbox();
  enableAutonomous(d); setFrequency(d, 'quiet');
  d.setUrlFetchImpl(() => anthropicTextResponse('Nope.'));
  const lied = d.gs.scribeAutonomous({ trigger: 'backdoorBust', subject: 'p2',
    evidence: { ...evidence({ signals: ['backdoorBust'] }), clears: true } });
  assert(lied.skipped === 'below_threshold' && lied.threshold === 85 && d.urlFetchCalls.length === 0,
    'a 50-point signal is re-checked against the league\'s OWN dial (Quiet 85) and refused, whatever the request asserts');

  // (d) hourly throttle — its own bucket, not the mention one
  const e = buildSandbox();
  enableAutonomous(e, { SCRIBE_AUTONOMOUS_LIMIT_HOURLY: 1 });
  e.setUrlFetchImpl(() => anthropicTextResponse('One line.'));
  const first = e.gs.scribeAutonomous({ trigger: 'unanimous', subject: 's1', evidence: evidence({ signals: ['backdoorBust'] }) });
  const second = e.gs.scribeAutonomous({ trigger: 'unanimous', subject: 's2', evidence: evidence({ signals: ['backdoorBust'] }) });
  assert(first.posted === true && second.throttled === true && second.reason === 'throttle', 'the second autonomous post in the same hour is throttled');
  assert(e.urlFetchCalls.length === 1, '…and the throttled one never reached Anthropic');
  assert(Number(e.cacheStore.get('scribeMentionCount_league_' + e.gs.scribeHourBucket_()) || 0) === 0,
    'the autonomous bucket is SEPARATE from the mention bucket (Part 0b: separate hourly throttles per trigger)');

  // (e) consecutive-post guard, re-checked server-side
  const f = buildSandbox();
  enableAutonomous(f, { SCRIBE_AUTONOMOUS_LIMIT_HOURLY: 10 });
  f.setUrlFetchImpl(() => anthropicTextResponse('First and only.'));
  const p1 = f.gs.scribeAutonomous({ trigger: 'unanimous', subject: 'sA', evidence: evidence({ signals: ['backdoorBust'] }) });
  assert(p1.posted === true, 'fixture check: the first autonomous post lands');
  // BLOCK-2's league-wide floor would refuse everything below on its own, so
  // step past it deliberately — ten real minutes would do the same — and let
  // the consecutive guard be the thing under test.
  clearGlobalCooldown(f);
  const p2 = f.gs.scribeAutonomous({ trigger: 'loneWolfWin', subject: 'sB', evidence: evidence({ signals: ['backdoorBust'] }) });
  assert(p2.skipped === 'consecutive', 'a second autonomous post with NO intervening human message is refused');
  assert(f.urlFetchCalls.length === 1, '…before spending anything');
  appendMsgRow(f.gs.ensureMsgSheet(), { id: 'h1', author: 'p3', body: 'lol' });
  clearGlobalCooldown(f);
  const p3 = f.gs.scribeAutonomous({ trigger: 'loneWolfWin', subject: 'sC', evidence: evidence({ signals: ['backdoorBust'] }) });
  assert(p3.posted === true, 'once a human has spoken, SCRIBE is clear to speak again');
  // A tier-0 canned line is NOT a blocker — different in kind, already rationed.
  appendMsgRow(f.gs.ensureMsgSheet(), { id: 't0', author: 'scribe', body: 'canned', meta: { source: 'tier0', trigger: 'coverageFlip' } });
  clearGlobalCooldown(f);
  const p4 = f.gs.scribeAutonomous({ trigger: 'milestone', subject: 'sD', evidence: evidence({ signals: ['backdoorBust'] }) });
  assert(p4.skipped === 'consecutive', 'a tier-0 line does not RESET the guard either — the last human message is still what matters');

  // BLOCK-2 — the league-wide floor itself, server side.
  const gl = buildSandbox();
  enableAutonomous(gl, { SCRIBE_AUTONOMOUS_LIMIT_HOURLY: 10 });
  gl.setUrlFetchImpl(() => anthropicTextResponse('One line.'));
  const g1 = gl.gs.scribeAutonomous({ trigger: 'backdoorBust', subject: 'gA', evidence: evidence({ signals: ['backdoorBust'], gameTag: 'room1' }) });
  assert(g1.posted === true, 'fixture check: the first post lands');
  appendMsgRow(gl.gs.ensureMsgSheet(), { id: 'hg', author: 'p3', gameTag: 'room2', body: 'human, different room' });
  const g2 = gl.gs.scribeAutonomous({ trigger: 'backdoorBust', subject: 'gB', evidence: evidence({ signals: ['backdoorBust'], gameTag: 'room2' }) });
  assert(g2.skipped === 'global_cooldown',
    'a DIFFERENT room, with its own untouched per-room floor and a human message right there, is still refused — one autonomous post per 10 minutes across the whole league');
  assert(gl.urlFetchCalls.length === 1, '…and the refusal costs nothing');

  // …and the room-agnostic consecutive guard, with the league floor stepped past.
  const ca = buildSandbox();
  enableAutonomous(ca, { SCRIBE_AUTONOMOUS_LIMIT_HOURLY: 10 });
  ca.setUrlFetchImpl(() => anthropicTextResponse('One line.'));
  ca.gs.scribeAutonomous({ trigger: 'backdoorBust', subject: 'cA', evidence: evidence({ signals: ['backdoorBust'], gameTag: 'room1' }) });
  clearGlobalCooldown(ca);
  const cb = ca.gs.scribeAutonomous({ trigger: 'backdoorBust', subject: 'cB', evidence: evidence({ signals: ['backdoorBust'], gameTag: 'room2' }) });
  assert(cb.skipped === 'consecutive_all',
    'the last message in the WHOLE stream is an autonomous SCRIBE post, so a post in another room is refused too — SCRIBE never follows itself');

  // (f) deterministic id — six clients collapse to one paid call
  const g = buildSandbox();
  enableAutonomous(g, { SCRIBE_AUTONOMOUS_LIMIT_HOURLY: 10 });
  g.setUrlFetchImpl(() => anthropicTextResponse('Only once.'));
  const one = g.gs.scribeAutonomous({ trigger: 'chartLeadChange', subject: 'p4', evidence: evidence({ signals: ['backdoorBust'] }) });
  const two = g.gs.scribeAutonomous({ trigger: 'chartLeadChange', subject: 'p4', evidence: evidence({ signals: ['backdoorBust'] }) });
  assert(one.posted === true && one.responseMessageId.indexOf('scribe_auto_chartLeadChange_p4_') === 0,
    `the post id is scribe_auto_<trigger>_<subject>_<10-min bucket> (got ${one.responseMessageId})`);
  assert(two.deduped === true && g.urlFetchCalls.length === 1, 'a second client detecting the SAME event in the same bucket dedupes to one paid call');
  assert(chatRows(g).filter(r => String(r[4]) === 'scribe').length === 1, '…and one chat post, not two');
}

console.log('\n[11] The autonomous post itself — shape, brief, tools, 2-sentence bound…');
{
  const env = buildSandbox();
  seedLeague(env);
  enableAutonomous(env);
  const ms = env.gs.ensureMsgSheet();
  appendMsgRow(ms, { id: 'r1', author: 'p2', gameTag: 'g1', body: 'this one is over' });
  appendMsgRow(ms, { id: 'r2', author: 'p3', gameTag: 'g1', body: 'koby says he cannot lose this week' });
  let captured = null;
  env.setUrlFetchImpl((url, opts) => { captured = JSON.parse(opts.payload); return anthropicTextResponse('Koby covered for fifty-nine minutes and died on the final snap. Rough way to lose one. And a third sentence that must be cut. And a fourth.'); });
  const r = env.gs.scribeAutonomous({ trigger: 'backdoorBust', subject: 'p1', playerId: 'p1', evidence: evidence({ signals: ['backdoorBust'], gameTag: 'g1' }) });
  assert(r.posted === true, 'the post lands');
  const row = chatRows(env).filter(x => String(x[1]) === r.responseMessageId)[0];
  assert(!!row && String(row[4]) === 'scribe' && String(row[3]) === 'message', "posted as author 'scribe', a normal message");
  const meta = JSON.parse(row[9]);
  assert(meta.source === 'tier2' && meta.trigger === 'backdoorBust' && meta.autonomous === true,
    `meta carries source:'tier2', the trigger, and the autonomous marker (got ${JSON.stringify(meta)})`);
  assert(meta._n === 1, 'it notifies, like any other SCRIBE post');
  assert(String(row[5]) === 'g1', 'and it lands in the gameTag the evidence named');
  const body = String(row[6]);
  assert((body.match(/[.!?]/g) || []).length <= 2, `the post is bounded to two sentences even when the model ignores the instruction (got: ${body})`);
  assert(/fifty-nine minutes/.test(body), 'the model\'s own text is preserved, just truncated at the sentence boundary');

  // F1 (reviewer) — THE ROOM CONTEXT. Without a triggerSeq,
  // assembleScribeContext_ reads `beforeSeq = 0` and returns an empty
  // context: SCRIBE commenting on a conversation it cannot see.
  const userContent = captured.messages[0].content;
  assert(/RECENT ROOM CONTEXT/.test(userContent), 'the user turn carries the recent room context block');
  assert(/p3: koby says he cannot lose this week/.test(userContent),
    `the room's actual messages are IN the prompt, not an empty block (got: ${String(userContent).slice(0, 220)})`);
  assert(!/\(no recent messages\)/.test(userContent), '…and the block is not the empty placeholder');
  assert(/TRIGGERING EVENT \(no question was asked\)/.test(userContent),
    'the trigger is labelled as an EVENT, not as a "CURRENT QUESTION" nobody asked (note 8)');
  assert(!/CURRENT QUESTION/.test(userContent), '…and the mention-path label appears nowhere on an autonomous call');

  const sys = captured.system.map(b => b.text).join('\n');
  assert(/AUTONOMOUS INTERJECTION/.test(sys), 'the autonomous voice brief is on the wire');
  assert(/Two sentences, maximum/.test(sys) && /Post it and stop/.test(sys) && /still open/.test(sys),
    'and it carries the approved brief verbatim — one message, two sentences, the blind rule');
  assert(/# SCRIBE.md/.test(sys), 'the persona is still loaded — an autonomous post is SCRIBE speaking, unlike the Trainer/classifier paths');
  const toolNames = (captured.tools || []).map(t => t.name);
  assert(toolNames.indexOf('get_current_standings') >= 0 && toolNames.indexOf('get_relevant_player_context') >= 0,
    'the C3 league tools are available so the line can be anchored in a real number');
  assert(toolNames.indexOf('web_search') === -1 && toolNames.indexOf('get_current_score') === -1,
    'web search and the ESPN wrappers are NOT — an unprompted post never pays for a search nobody asked for');
  assert(captured.max_tokens === 512, `max_tokens is the autonomous budget, not the mention default (got ${captured.max_tokens})`);

  // F1, the claim path specifically — the trigger message is identified by
  // id, and the read must INCLUDE it (the opposite of the mention path,
  // which excludes the question because it is rendered separately).
  const envC = buildSandbox();
  seedLeague(envC);
  enableAutonomous(envC);
  const msC = envC.gs.ensureMsgSheet();
  appendMsgRow(msC, { id: 'c0', author: 'p2', body: 'who do you like tonight' });
  appendMsgRow(msC, { id: 'c1', author: 'p3', body: 'Texas covers, I guarantee it' });
  appendMsgRow(msC, { id: 'c2', author: 'p2', body: 'said after the claim, should not be in scope' });
  // BLOCK-1 — the claim must carry a SERVER-logged verdict to be worth
  // anything, so classify it first, exactly as the live path does.
  envC.setUrlFetchImpl(() => anthropicJsonResponse({ claim: true, kind: 'guarantee', confidence: 0.9 }));
  assert(envC.gs.scribeClassify({ messageId: 'c1' }).points === 45, 'fixture check: the server classified the claim at 45');
  let capturedC = null;
  envC.setUrlFetchImpl((url, opts) => { capturedC = JSON.parse(opts.payload); return anthropicTextResponse('Bold.'); });
  const rc = envC.gs.scribeAutonomous({ trigger: 'claim', subject: 'p3', playerId: 'p3',
    evidence: evidence({ signals: ['claim'], claimedScore: 1, gameTag: '', triggerMessageId: 'c1' }) });
  assert(rc.posted === true, 'fixture check: the claim-triggered post landed');
  const userC = capturedC.messages[0].content;
  assert(/Texas covers, I guarantee it/.test(userC),
    'the TRIGGERING CLAIM ITSELF is in the prompt — the thesis case for chat reactivity, and the one the empty-context defect broke completely');
  assert(/who do you like tonight/.test(userC), 'along with the conversation leading up to it');
  assert(!/should not be in scope/.test(userC),
    'and nothing said AFTER the claim — the read is bounded at the triggering message, not at the head');

  const log = logRows(env).filter(x => String(x[1]) === 'autonomous')[0];
  assert(!!log, "a CFBP_SCRIBE_LOG row is written with invocationType 'autonomous'");
  assert(String(log[7]) === 'true' || log[7] === true, 'marked successful');
  assert(Number(log[10]) > 0, `cost is accounted exactly as scribeAsk does (got $${log[10]})`);
  assert(String(log[11]) === r.responseMessageId, 'and the row points at the post it produced');
}

console.log('\n[12] Failure -> SILENT DROP: no post, no fallback line, a logged error…');
{
  const env = buildSandbox();
  enableAutonomous(env);
  env.setUrlFetchImpl(() => ({ getResponseCode: () => 500, getContentText: () => 'boom' }));
  const r = env.gs.scribeAutonomous({ trigger: 'backdoorBust', subject: 'p1', evidence: evidence({ signals: ['backdoorBust'] }) });
  assert(r.ok === true && r.posted === false, 'the action reports a non-post rather than an error the client must handle');
  assert(chatRows(env).length === 0,
    'NOTHING is posted — unlike a mention (which degrades to a canned line), a failed autonomous opportunity is simply dropped (C1)');
  const log = logRows(env).filter(x => String(x[1]) === 'autonomous')[0];
  assert(!!log && /anthropic_http_500/.test(String(log[12])), `the failure IS recorded, so a silent drop is still auditable (got ${log && log[12]})`);
  assert(env.urlFetchCalls.length === 2, 'one retry, then stop — same single-retry discipline as a mention');

  const env2 = buildSandbox();
  enableAutonomous(env2);
  env2.setUrlFetchImpl(() => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ content: [], stop_reason: 'refusal', usage: { input_tokens: 10, output_tokens: 0 } }) }));
  const r2 = env2.gs.scribeAutonomous({ trigger: 'unanimous', subject: 's', evidence: evidence({ signals: ['backdoorBust'] }) });
  assert(r2.posted === false && chatRows(env2).length === 0, 'a refusal is also a silent drop — an unprompted post never says "Can\'t help with that one."');
}

console.log('\n[13] scribeClassify — capped, points-only, never posts, never loads the persona…');
{
  const env = buildSandbox();
  enableAutonomous(env, { SCRIBE_CLASSIFY_DAILY_CAP: 1 });
  appendMsgRow(env.gs.ensureMsgSheet(), { id: 'm1', author: 'p1', body: 'Texas covers, I guarantee it' });
  appendMsgRow(env.gs.ensureMsgSheet(), { id: 'm2', author: 'p2', body: 'also I guarantee this one' });
  let captured = null;
  env.setUrlFetchImpl((url, opts) => { captured = JSON.parse(opts.payload); return anthropicJsonResponse({ claim: true, kind: 'guarantee', confidence: 0.9 }); });
  const r = env.gs.scribeClassify({ messageId: 'm1' });
  assert(r.ok === true && r.claim === true && r.kind === 'guarantee', 'a guarantee is classified as one');
  assert(r.points === 45, `a confident guarantee is worth 45 points (got ${r.points})`);
  assert(chatRows(env).length === 2, 'the classifier posts NOTHING — the two rows are the fixture messages, unchanged');
  assert(captured.model === 'claude-haiku-4-5', `it runs on the cheap model by default (got ${captured.model})`);
  assert(!('tools' in captured), 'no tools are declared — it has one job');
  const sys = captured.system.map(b => b.text).join('\n');
  assert(!/# SCRIBE.md/.test(sys), 'the ~6,000-token persona is NOT loaded — that would be paid tokens to answer a yes/no question');
  assert(/You are a classifier, not a persona/.test(sys) && /UNTRUSTED PLAYER TEXT/.test(sys),
    'it gets its own tiny system prompt, including the untrusted-input guard');
  assert(!captured.system.some(b => b.cache_control), 'and no cache breakpoint — a 200-token prompt has nothing worth caching');
  const log = logRows(env).filter(x => String(x[1]) === 'd1-classify')[0];
  assert(!!log, "logged to CFBP_SCRIBE_LOG with invocationType 'd1-classify'");
  assert(String(log[0]).indexOf('classify_') === 0,
    'the log key is PREFIXED so it can never collide with the scribeAsk row for the same message id');
  assert(Number(log[10]) > 0, 'its cost counts against the same shared monthly budget');

  const capped = env.gs.scribeClassify({ messageId: 'm2' });
  assert(capped.skipped === 'daily_cap' && capped.points === 0, 'the daily cap refuses the second call');
  assert(env.urlFetchCalls.length === 1, '…without spending');

  const env2 = buildSandbox();
  enableAutonomous(env2);
  appendMsgRow(env2.gs.ensureMsgSheet(), { id: 'm1', author: 'p1', body: 'maybe texas idk' });
  env2.setUrlFetchImpl(() => anthropicJsonResponse({ claim: true, kind: 'bold_claim', confidence: 0.4 }));
  assert(env2.gs.scribeClassify({ messageId: 'm1' }).points === 0,
    'a low-confidence verdict scores ZERO — a coin-flip guess must not be able to make SCRIBE talk');
  const env3 = buildSandbox();
  enableAutonomous(env3);
  appendMsgRow(env3.gs.ensureMsgSheet(), { id: 'm1', author: 'p1', body: 'what time is kickoff' });
  env3.setUrlFetchImpl(() => anthropicJsonResponse({ claim: false, kind: 'none', confidence: 0.99 }));
  assert(env3.gs.scribeClassify({ messageId: 'm1' }).points === 0, 'ordinary chat scores zero — the common and correct answer');
  const env4 = buildSandbox();
  env4.props.ANTHROPIC_API_KEY = 'k'; env4.props.SCRIBE_INTERACTIVE_ENABLED = 'true';
  const off = env4.gs.scribeClassify({ messageId: 'm1' });
  assert(off.skipped === 'disabled_autonomous' && env4.urlFetchCalls.length === 0,
    'with autonomy off the classifier never runs at all — it exists only to feed D1');
}

console.log('\n[14] Mutation-proofs — against an in-memory source copy, never the file, never git…');
{
  // Mutation 1 — delete the server-side threshold re-check.
  const mutated1 = codeGsSrc.replace(
    "  if (score < threshold) return { ok: true, skipped: 'below_threshold', score: score, threshold: threshold };",
    '  // MUTATION: threshold re-check removed');
  assert(mutated1 !== codeGsSrc, 'fixture check: mutation 1 actually changed the source');
  const m1 = buildSandbox(mutated1);
  enableAutonomous(m1); setFrequency(m1, 'quiet');
  m1.setUrlFetchImpl(() => anthropicTextResponse('I should not exist.'));
  const leaked = m1.gs.scribeAutonomous({ trigger: 'verbosity', subject: 'p2', evidence: evidence({ score: 10 }) });
  assert(leaked.posted === true && m1.urlFetchCalls.length === 1,
    'MUTANT: without the re-check, a 10-point candidate posts on the QUIET setting and spends money — [10c] is load-bearing, not decorative');

  // Mutation 2 — turn the physical delete into a tombstone.
  const mutated2 = codeGsSrc.replace('    s.deleteRow(target._row);', '    /* MUTATION: tombstone instead of deleteRow */');
  assert(mutated2 !== codeGsSrc, 'fixture check: mutation 2 actually changed the source');
  const m2 = buildSandbox(mutated2);
  const hash2 = seedCommissionerPassword(m2);
  const rec = m2.gs.scribeMemoryUpsert({ adminPasswordHash: hash2, record: { playerId: 'p1', kind: 'fact', key: 'a', value: 'A', provenance: 'computed', confidence: 1 } }).record;
  m2.gs.scribeMemoryDelete({ adminPasswordHash: hash2, id: rec.id });
  const stillThere = m2.sheets['CFBP_SCRIBE_MEMORY'].data.slice(1).filter(r => r && r[0] === rec.id);
  assert(stillThere.length === 1,
    'MUTANT: with deleteRow removed the row survives in the raw sheet — [3] is what proves D4\'s delete is real');

  // Mutation 3 (F1) — drop triggerSeq from the autonomous invoke.
  const mutated3 = codeGsSrc.replace(
    'triggerBody: triggerBody, triggerSeq: triggerSeqForContext,',
    'triggerBody: triggerBody,');
  assert(mutated3 !== codeGsSrc, 'fixture check: mutation 3 actually changed the source');
  const m3 = buildSandbox(mutated3);
  seedLeague(m3);
  enableAutonomous(m3);
  appendMsgRow(m3.gs.ensureMsgSheet(), { id: 'rr1', author: 'p3', gameTag: 'g1', body: 'koby says he cannot lose this week' });
  let captured3 = null;
  m3.setUrlFetchImpl((url, opts) => { captured3 = JSON.parse(opts.payload); return anthropicTextResponse('Something.'); });
  // (a non-claim trigger: FINDING 3 now requires a claim to name its message,
  // and this mutation is about the CONTEXT READ, not about claim binding)
  m3.gs.scribeAutonomous({ trigger: 'backdoorBust', subject: 'p3', playerId: 'p3', evidence: evidence({ signals: ['backdoorBust'], gameTag: 'g1' }) });
  assert(/\(no recent messages\)/.test(captured3.messages[0].content),
    'MUTANT: without triggerSeq the room context is EMPTY — the exact defect F1 found, and [11] is what catches it');

  // Mutation 4 (F2) — remove the chronological sort.
  const mutated4 = codeGsSrc.replace(
    "  out.sort(function (a, b) {\n    return (a.rank - b.rank) || (a.ms - b.ms) || String(a.gameId).localeCompare(String(b.gameId));\n  });",
    '  /* MUTATION: chronological sort removed */');
  assert(mutated4 !== codeGsSrc, 'fixture check: mutation 4 actually changed the source');
  const m4 = buildSandbox(mutated4);
  seedLeague(m4);
  const picks4 = m4.gs.getOne('cfbp_picks').slice().reverse();
  m4.gs.setOne('cfbp_picks', picks4);
  m4.gs.scribeMemoryRefreshComputed_();
  const badStreak = m4.gs.scribeMemoryList({ playerId: 'p3' }).records.filter(r => r.key === 'currentStreak')[0];
  assert(!!badStreak && badStreak.value !== '3 straight misses',
    `MUTANT: unsorted, the same pick list reports a DIFFERENT streak (${badStreak && badStreak.value}) — [17] is load-bearing`);

  // Mutation 5 (F5) — remove the list ownership check.
  const mutated5 = codeGsSrc.replace(
    "      if (ids[q] !== requester) return { ok: false, error: 'Unauthorized — that memory belongs to another player' };",
    '      /* MUTATION: ownership check removed */');
  assert(mutated5 !== codeGsSrc, 'fixture check: mutation 5 actually changed the source');
  const m5 = buildSandbox(mutated5);
  const hash5 = seedCommissionerPassword(m5);
  m5.gs.scribeMemoryUpsert({ adminPasswordHash: hash5, record: { playerId: 'p2', kind: 'hardline', key: 'topic', value: 'his divorce', provenance: 'commissioner-set', confidence: 1 } });
  const leaked5 = m5.gs.scribeMemoryList({ playerId: 'p1', playerIds: ['p2'] });
  assert(leaked5.ok === true && leaked5.records.length === 1,
    "MUTANT: without the check, p1 reads p2's hard-lines — [18] is what makes \"private from other players\" true");
  // Mutation 6 (BLOCK-1) — trust the client's score again.
  const mutated6 = codeGsSrc.replace(
    '  var score = scribeScoreOpportunity_(trustedSignals);',
    '  var score = Number(evidence.score) || 0;   // MUTATION: trust the client');
  assert(mutated6 !== codeGsSrc, 'fixture check: mutation 6 actually changed the source');
  const m6 = buildSandbox(mutated6);
  enableAutonomous(m6); setFrequency(m6, 'quiet');
  m6.setUrlFetchImpl(() => anthropicTextResponse('Paid for by a client that lied.'));
  const lied6 = m6.gs.scribeAutonomous({ trigger: 'verbosity', subject: 'pQ',
    evidence: evidence({ signals: ['verbosity'], claimedScore: 999 }) });
  assert(lied6.posted === true && m6.urlFetchCalls.length === 1,
    'MUTANT: a single 10-point signal with `score:999` on the wire buys a paid model call at the QUIET setting — the money-safety defect BLOCK-1 found, and [10c] is what closes it');

  // Mutation 7 (BLOCK-2, server side) — remove the league-wide floor.
  const mutated7 = codeGsSrc
    .replace("  if (scribeAutonomousGlobalCooldownBlocked_()) return { ok: true, skipped: 'global_cooldown' };",
      '  // MUTATION: league-wide floor removed (early check)')
    .replace("    if (scribeAutonomousGlobalCooldownBlocked_()) return { reserved: false, globalBlocked: true };",
      '    // MUTATION: league-wide floor removed (the authoritative in-lock check)');
  assert(mutated7 !== codeGsSrc, 'fixture check: mutation 7 actually changed the source');
  const m7 = buildSandbox(mutated7);
  enableAutonomous(m7, { SCRIBE_AUTONOMOUS_LIMIT_HOURLY: 10 });
  m7.setUrlFetchImpl(() => anthropicTextResponse('One line.'));
  m7.gs.scribeAutonomous({ trigger: 'backdoorBust', subject: 'mA', evidence: evidence({ signals: ['backdoorBust'], gameTag: 'room1' }) });
  appendMsgRow(m7.gs.ensureMsgSheet(), { id: 'mh', author: 'p3', gameTag: 'room2', body: 'human' });
  const second7 = m7.gs.scribeAutonomous({ trigger: 'backdoorBust', subject: 'mB', evidence: evidence({ signals: ['backdoorBust'], gameTag: 'room2' }) });
  assert(second7.posted === true && m7.urlFetchCalls.length === 2,
    'MUTANT: two autonomous posts land seconds apart in one reader’s stream, each inside its own per-room floor — exactly what BLOCK-2 found');

  // Mutation 8 (BLOCK-3) — let computed rows back into the model-facing block.
  const mutated8 = codeGsSrc.replace(
    "    if (rows[i].provenance === 'computed') continue;",
    '    /* MUTATION: computed rows reach the model again */');
  assert(mutated8 !== codeGsSrc, 'fixture check: mutation 8 actually changed the source');
  const m8 = buildSandbox(mutated8);
  seedLeague(m8);
  m8.gs.scribeMemoryRefreshComputed_();
  const block8 = m8.gs.scribeMemoryContextText_(['p1']);
  assert(/straight covers/.test(block8),
    'MUTANT: a weekly-refreshed streak is handed to the model as confidence 1.0 alongside the live tool number — the staleness-as-fabrication defect BLOCK-3 found, and [20] is what closes it');

  // Mutation 9 (FINDING 2) — put the league-wide stamp back where it was,
  // after the Anthropic round trip.
  const mutated9 = codeGsSrc
    .replace(`      priorGlobalStamp = CacheService.getScriptCache().get('scribeAutoLast_all');
      ourGlobalStamp = scribeAutonomousNoteGlobalPost_();   // F-G — remember what WE wrote`,
      '      // MUTATION: stamp deferred until after the fetch')
    .replace('  if (claimUsed) scribeClaimVerdictConsume_(evidence.triggerMessageId);',
      '  scribeAutonomousNoteGlobalPost_();   // MUTATION: stamped only after chatAppend');
  assert(mutated9 !== codeGsSrc, 'fixture check: mutation 9 actually changed the source');
  const m9 = buildSandbox(mutated9);
  enableAutonomous(m9, { SCRIBE_AUTONOMOUS_LIMIT_HOURLY: 10 });
  let depth9 = 0, inner9 = null;
  m9.setUrlFetchImpl(() => {
    if (depth9 === 0) {
      depth9++;
      inner9 = m9.gs.scribeAutonomous({ trigger: 'chartLeadChange', subject: 'z2',
        evidence: evidence({ signals: ['backdoorBust'], gameTag: 'room2' }) });
    }
    return anthropicTextResponse('One line.');
  });
  m9.gs.scribeAutonomous({ trigger: 'backdoorBust', subject: 'z1', evidence: evidence({ signals: ['backdoorBust'], gameTag: 'room1' }) });
  assert(inner9 && inner9.posted === true && chatRows(m9).filter(r => String(r[4]) === 'scribe').length === 2,
    'MUTANT: with the stamp after the fetch, a candidate entering during the 10-20s round trip posts too — two autonomous messages, which is exactly the gap FINDING 2 found and [23] closes');

  // Mutation 10 (FINDING 3) — let a classifier verdict be spent twice.
  const mutated10 = codeGsSrc.replace(
    '  if (claimUsed) scribeClaimVerdictConsume_(evidence.triggerMessageId);',
    '  /* MUTATION: the verdict is never consumed */');
  assert(mutated10 !== codeGsSrc, 'fixture check: mutation 10 actually changed the source');
  const m10 = buildSandbox(mutated10);
  enableAutonomous(m10, { SCRIBE_AUTONOMOUS_LIMIT_HOURLY: 10 });
  appendMsgRow(m10.gs.ensureMsgSheet(), { id: 'v1', author: 'p2', body: 'I guarantee it' });
  m10.setUrlFetchImpl(() => anthropicJsonResponse({ claim: true, kind: 'guarantee', confidence: 0.9 }));
  m10.gs.scribeClassify({ messageId: 'v1' });
  m10.setUrlFetchImpl(() => anthropicTextResponse('Again and again.'));
  m10.gs.scribeAutonomous({ trigger: 'claim', playerId: 'p2', evidence: evidence({ signals: ['claim'], triggerMessageId: 'v1' }) });
  assert(chatRows(m10).filter(r => String(r[4]) === 'scribe').length === 1, 'fixture check: the mutant posted once');
  // The verdict is the thing under test, so assert on it directly rather than
  // through a second post — a same-bucket retry would dedupe on the post id
  // and hide the defect behind an unrelated guard.
  assert(m10.gs.scribeClaimVerdictPoints_('v1') === 45,
    `MUTANT: after a post that spent it, the verdict is STILL worth 45 (got ${m10.gs.scribeClaimVerdictPoints_('v1')}) — one classification funds an unbounded number of posts, which is what FINDING 3 found`);
  const real = buildSandbox();
  enableAutonomous(real, { SCRIBE_AUTONOMOUS_LIMIT_HOURLY: 10 });
  appendMsgRow(real.gs.ensureMsgSheet(), { id: 'v1', author: 'p2', body: 'I guarantee it' });
  real.setUrlFetchImpl(() => anthropicJsonResponse({ claim: true, kind: 'guarantee', confidence: 0.9 }));
  real.gs.scribeClassify({ messageId: 'v1' });
  real.setUrlFetchImpl(() => anthropicTextResponse('Once.'));
  real.gs.scribeAutonomous({ trigger: 'claim', playerId: 'p2', evidence: evidence({ signals: ['claim'], triggerMessageId: 'v1' }) });
  assert(real.gs.scribeClaimVerdictPoints_('v1') === 0,
    'and in the REAL file the same verdict reads 0 after the post that used it — the control that makes the mutant meaningful');
}


console.log('\n[15] F6 — the SIGNAL_POINTS twin agrees with the client, and the replay is pure…');
{
  const env = buildSandbox();
  const clientSrc = await readFile(fileURLToPath(new URL('./js/scribeLines.js', import.meta.url)), 'utf8');
  const m = /export const SIGNAL_POINTS = \{([^}]*)\}/.exec(clientSrc);
  const s = /var SCRIBE_SIGNAL_POINTS_ = \{([\s\S]*?)\};/.exec(codeGsSrc);
  assert(!!m && !!s, 'fixture check: both tables were found by the parse (a miss would make the comparison vacuous)');
  const parse = (body) => {
    const out = {};
    for (const part of body.split(',')) {
      const kv = /(\w+)\s*:\s*(\d+)/.exec(part);
      if (kv) out[kv[1]] = Number(kv[2]);
    }
    return out;
  };
  const client = parse(m[1]), server = parse(s[1]);
  // ── AMENDED 2026-09-24 (SCRIBE v3 Package D, DI-284/DI-287). ──────────────
  //
  // THIS ASSERTION USED TO BE EQUALITY, and equality stopped being the truth on
  // the day Apps Script was retired rather than on the day this test broke.
  // `backend/Code.gs` is a READ-ONLY ARCHIVE (CLAUDE.md: the Sheet is kept as
  // the archive; every relay is deleted and the deployment is archived). Drew
  // will never paste it again, so a table in it can never gain a row — while
  // the LIVE tables legitimately do: Package D adds `roastOfScribe` (50) and
  // `heatedExchange` (20), and there is no Apps Script runtime left for them to
  // be added to.
  //
  // SO THE PROPERTY IS NARROWED TO THE ONE THAT IS STILL TRUE AND STILL WORTH
  // HAVING: every signal the ARCHIVE knows must carry the SAME VALUE here. That
  // is the thing a Trainer replay over historical `job_runs` rows actually
  // depends on — a 2026 post scored `backdoorBust: 50` and must still replay at
  // 50. What it can no longer require is that the live client learn no new
  // signals, which would be a rule that the retired runtime gets a veto over
  // the shipped one.
  //
  // THE SUBSET IS ASSERTED IN THE HONEST DIRECTION: archive ⊆ client. A signal
  // DELETED from the client still fails here, which is the half of the old
  // assertion that protects a replay.
  const shared = Object.keys(server);
  assert(shared.length === 9,
    `fixture check: all nine of the ARCHIVE's signals parsed out of backend/Code.gs (got ${shared.length}) — a parse that found none would make the comparison vacuous`);
  const drifted = shared.filter((k) => client[k] !== server[k]);
  assert(drifted.length === 0,
    `every signal the ARCHIVE knows carries the SAME value in the live client — the Trainer replays a historical run with the numbers it was scored with (drifted: ${JSON.stringify(drifted.map((k) => [k, server[k], client[k]]))})`);
  const missing = shared.filter((k) => !(k in client));
  assert(missing.length === 0,
    `…and none of them has been DELETED from the client, which would make a historical replay silently score that signal at zero (missing: ${JSON.stringify(missing)})`);
  // The live-only additions, named rather than left as an unexplained count
  // difference for the next reader to rediscover.
  const added = Object.keys(client).filter((k) => !(k in server));
  assert(JSON.stringify(added.sort()) === JSON.stringify(['heatedExchange', 'roastOfScribe']),
    `…and the live client's ONLY signals beyond the archive are Package D's two, named here so the gap is a decision rather than drift (got ${JSON.stringify(added)})`);

  const sig = [{ signal: 'unanimous' }, { signal: 'drinkDebt' }];
  assert(env.gs.scribeScoreOpportunity_(sig) === 32.5,
    `the server applies the SAME combiner as the client: 25 + 0.5x15 = 32.5 (got ${env.gs.scribeScoreOpportunity_(sig)})`);
  assert(env.gs.scribeScoreOpportunity_(sig) === env.gs.scribeScoreOpportunity_(sig), 'and it is deterministic — same input, same score, twice');
  assert(env.gs.scribeScoreOpportunity_([{ signal: 'claim', points: 45 }]) === 45, 'an explicit points value overrides the table (the classifier path)');
  assert(env.gs.scribeScoreOpportunity_([{ signal: 'nope' }]) === 0, 'an unknown signal contributes 0, never NaN');
  assert(env.gs.scribeScoreOpportunity_(null) === 0, 'and no signals at all scores 0');
  // FINDING 1 — collapse and diminishing returns, server side.
  const twenty = [];
  for (let i = 0; i < 20; i++) twenty.push({ signal: 'verbosity' });
  assert(env.gs.scribeScoreOpportunity_(twenty) === 10,
    `twenty instances of one signal are worth one signal (got ${env.gs.scribeScoreOpportunity_(twenty)}) — the old flat sum made it 200`);
  assert(env.gs.scribeScoreOpportunity_([{ signal: 'streak' }, { signal: 'loneWolfWin' }, { signal: 'unanimous' }]) === 62.5,
    'an ordinary week scores 62.5 on the server too');
  assert(env.gs.scribeScoreOpportunity_([{ signal: 'backdoorBust' }, { signal: 'chartLeadChange' }, { signal: 'streak' }, { signal: 'unanimous' }]) === 90,
    'and only the top three distinct signals count — the fourth adds nothing');
}

console.log('\n[16] F6 — the DI-D1 calibration loop: near-miss weigh-ins propose a threshold experiment…');
{
  const env = buildSandbox();
  setFrequency(env, 'balanced');   // threshold 45
  // FINDING 4 — the replay runs the recorded signals through the SAME
  // trusted path the live gate uses: NAMES only. A `points` value written
  // onto a chat event by a client is ignored here exactly as it is there,
  // which is why these fixtures carry names and nothing else.
  const flagged = (id, signals) => ({ id, type: 'message', author: 'p1', body: 'bold take ' + id, meta: signals ? { scribeSignals: signals } : {} });
  const events = [
    flagged('x1', [{ signal: 'loneWolfWin' }]),               // 30
    flagged('x2', [{ signal: 'milestone' }]),                 // 40
    flagged('x3', [{ signal: 'streak' }]),                    // 35
    flagged('x4', null),                                      // nothing recorded -> score 0
  ];
  const flags = [{ targetId: 'x1' }, { targetId: 'x2' }, { targetId: 'x3' }, { targetId: 'x4' }];
  const out = env.gs.scribeTrainerCalibrationExperiments_(flags, events, 'balanced', 45, '2026-09-11T00:00:00Z', 'run1');
  assert(out.length === 1, `three near-misses (30/40/35 against 45) produce ONE proposed experiment (got ${out.length})`);
  // F-F — the MEDIAN of 30/35/40 is 35, not the minimum 30: one outlier must
  // not drag the dial down by the full 15-point window. The floor for
  // Balanced is 35 (halfway to Active's 25), so the clamp agrees here.
  assert(/lower balanced threshold from 45 to 35/.test(out[0].experiment), `the experiment names the level, the current threshold and the proposal (got: ${out[0].experiment})`);
  assert(/median 35/.test(out[0].reason) && /floored at 35/.test(out[0].reason),
    'and the reason shows its work — the scores, the median, and the floor it was clamped against');
  assert(out[0].status === 'pending', 'it is PENDING — DI-D1: gated through the same human approval, never auto-applied');
  assert(out[0].kind === 'experiment' && out[0].source === 'calibration', 'and it is tagged as a calibration experiment, distinguishable from a model-proposed one');
  assert(/4 flag\(s\) replayed/.test(out[0].reason), 'the reason states how many flags were replayed in total, including the ones that were not near-misses');

  const two = env.gs.scribeTrainerCalibrationExperiments_([{ targetId: 'x1' }, { targetId: 'x2' }, { targetId: 'x4' }], events, 'balanced', 45, '2026-09-11T00:00:00Z', 'run1');
  assert(two.length === 0, 'two near-misses is not a PATTERN — nothing is proposed (a single flagged moment must not move the dial)');

  // F-F — the clamp, on its own. Three near-misses at 30/31/32 have a median
  // of 31, but Balanced may not be proposed below 35 in one window.
  const clamped = env.gs.scribeTrainerCalibrationExperiments_(
    [{ targetId: 'q1' }, { targetId: 'q2' }, { targetId: 'q3' }],
    [flagged('q1', [{ signal: 'loneWolfWin' }]), flagged('q2', [{ signal: 'loneWolfWin' }]), flagged('q3', [{ signal: 'loneWolfWin' }])],
    'balanced', 45, '2026-09-11T00:00:00Z', 'run1');
  assert(clamped.length === 1 && /from 45 to 35/.test(clamped[0].experiment),
    `three 30-point near-misses propose 35, not 30 — one window can never move the dial more than halfway to the next level (got: ${clamped.length ? clamped[0].experiment : 'nothing'})`);
  assert(env.gs.scribeCalibrationFloorFor_(45) === 35 && env.gs.scribeCalibrationFloorFor_(85) === 75 &&
         env.gs.scribeCalibrationFloorFor_(15) === 7.5,
    'the floor is halfway to the next level down (Balanced 45 -> 35, Quiet 85 -> 75), and half the threshold at the bottom level');
  assert(/no mechanical effect|NOTHING, MECHANICALLY/.test(codeGsSrc),
    'and the file states outright that approving one of these changes nothing by itself — the thresholds are source constants in two files');

  const farOff = env.gs.scribeTrainerCalibrationExperiments_(
    [{ targetId: 'y1' }, { targetId: 'y2' }, { targetId: 'y3' }],
    [flagged('y1', [{ signal: 'verbosity' }]), flagged('y2', [{ signal: 'verbosity' }]), flagged('y3', [{ signal: 'verbosity' }])],
    'balanced', 45, '2026-09-11T00:00:00Z', 'run1');
  assert(farOff.length === 0, 'three flags scoring 10 against 45 are NOT near-misses — 35 points away is a different problem than a threshold');

  // The classifier's logged verdict is the second source, when the message
  // itself carries no recorded signals.
  const env2 = buildSandbox();
  setFrequency(env2, 'balanced');
  enableAutonomous(env2);
  appendMsgRow(env2.gs.ensureMsgSheet(), { id: 'c1', author: 'p1', body: 'I guarantee it' });
  env2.setUrlFetchImpl(() => anthropicJsonResponse({ claim: true, kind: 'bold_claim', confidence: 0.9 }));
  const cls = env2.gs.scribeClassify({ messageId: 'c1' });
  assert(cls.points === 35, `fixture check: the classifier scored this one 35 (got ${cls.points})`);
  // FINDING 4 — a client-written `points` on the flagged message cannot
  // steer the replay: the name is taken, the number is not.
  const spoofed = env2.gs.scribeTrainerCalibrationExperiments_(
    [{ targetId: 'c1' }, { targetId: 'c1' }, { targetId: 'c1' }],
    [{ id: 'c1', type: 'message', author: 'p1', body: 'x', meta: { scribeSignals: [{ signal: 'verbosity', points: 44 }] } }],
    'balanced', 45, '2026-09-11T00:00:00Z', 'run1');
  assert(spoofed.length === 0,
    'a crafted `points:44` on a flagged message scores 10, not 44 — it cannot manufacture a near-miss pattern and steer the Trainer into lowering the dial');
  const logged = env2.gs.scribeTrainerCalibrationExperiments_(
    [{ targetId: 'c1' }, { targetId: 'c1' }, { targetId: 'c1' }], [], 'balanced', 45, '2026-09-11T00:00:00Z', 'run1');
  assert(logged.length === 1 && /to 35/.test(logged[0].experiment),
    'a flagged message with no recorded signals falls back to the classifier verdict logged for it');

  // End to end: the experiment reaches the learnings store through a real run.
  const env3 = buildSandbox();
  setFrequency(env3, 'balanced');
  enableTrainer(env3);
  const sheet3 = seedRatedWindow(env3, 3);
  ['z1', 'z2', 'z3'].forEach(id => {
    appendMsgRow(sheet3, { id, author: 'p1', body: 'bold take', meta: { scribeSignals: [{ signal: 'milestone' }] } });
    appendMsgRow(sheet3, { id: 'wf_' + id, type: 'feedback', author: 'p2', targetId: id, meta: { category: 'weigh_in', value: true } });
  });
  env3.setUrlFetchImpl(() => anthropicJsonResponse(trainerOutput()));
  const run = runTrainerAuthed(env3);
  assert(run.ok === true, `fixture check: the Trainer run succeeded (error: ${run.error})`);
  assert(run.counts.calibrationExperiments === 1, `the run reports the calibration experiment it added (got ${run.counts.calibrationExperiments})`);
  const stored = env3.gs.scribeLoadLearnings_().filter(l => l.source === 'calibration');
  assert(stored.length === 1 && stored[0].status === 'pending', 'and it is persisted as a pending experiment alongside the model-proposed ones');
}

console.log('\n[17] F2 — the streak is chronological, graded-only, and refuses to guess…');
{
  const env = buildSandbox();
  seedLeague(env);
  env.gs.scribeMemoryRefreshComputed_();
  const ordered = env.gs.scribeMemoryList({ playerId: 'p3' }).records.filter(r => r.key === 'currentStreak')[0];
  assert(!!ordered && ordered.value === '3 straight misses',
    `p3 covered g1-g3 then missed g4-g6, so the CURRENT streak is 3 misses (got ${ordered && ordered.value})`);

  // Shuffle the pick list — the answer must not move.
  const env2 = buildSandbox();
  seedLeague(env2);
  const picks = env2.gs.getOne('cfbp_picks');
  const shuffled = picks.slice().reverse();
  shuffled.sort((a, b) => String(a.playerId + a.gameId).localeCompare(String(b.gameId + b.playerId)));
  assert(JSON.stringify(shuffled) !== JSON.stringify(picks), 'fixture check: the shuffled list really is in a different order');
  env2.gs.setOne('cfbp_picks', shuffled);
  env2.gs.scribeMemoryRefreshComputed_();
  const fromShuffled = env2.gs.scribeMemoryList({ playerId: 'p3' }).records.filter(r => r.key === 'currentStreak')[0];
  assert(!!fromShuffled && fromShuffled.value === ordered.value,
    `a shuffled pick list yields the SAME streak (${fromShuffled && fromShuffled.value}) — the claim is ordered by week and kickoff, not by array position`);

  // Ungraded picks are excluded from both the streak and the denominator.
  const env3 = buildSandbox();
  seedLeague(env3);
  const games3 = env3.gs.getOne('cfbp_games');
  games3[5].status = 'scheduled'; games3[5].homeScore = null; games3[5].awayScore = null;
  env3.gs.setOne('cfbp_games', games3);
  env3.gs.scribeMemoryRefreshComputed_();
  const p1rows = env3.gs.scribeMemoryList({ playerId: 'p1' }).records;
  const style = p1rows.filter(r => r.key === 'pickStyle')[0];
  assert(!!style && /100% of 5 graded picks/.test(style.value),
    `the denominator counts GRADED picks only — one scheduled game drops it from 6 to 5 (got ${style && style.value})`);
  const streak3 = p1rows.filter(r => r.key === 'currentStreak')[0];
  assert(!!streak3 && streak3.value === '5 straight covers', 'and the ungraded pick contributes nothing to the streak');

  // A week with no kickoff times cannot be ordered — no streak at all.
  const env4 = buildSandbox();
  seedLeague(env4);
  const games4 = env4.gs.getOne('cfbp_games');
  delete games4[2].kickoff;
  env4.gs.setOne('cfbp_games', games4);
  env4.gs.scribeMemoryRefreshComputed_();
  const p1rows4 = env4.gs.scribeMemoryList({ playerId: 'p1' }).records;
  assert(!p1rows4.some(r => r.key === 'currentStreak'),
    'one un-orderable graded pick means NO streak fact is written — a sequence with a hole renders as absent, never as a confident wrong number');
  assert(p1rows4.some(r => r.key === 'seasonRecord'),
    '…while the order-independent facts are still written (the guard is narrow, not a blanket refusal)');
}

console.log('\n[18] F5 — reading another player\'s memory is refused…');
{
  const env = buildSandbox();
  const hash = seedCommissionerPassword(env);
  env.gs.scribeMemoryUpsert({ adminPasswordHash: hash, record: { playerId: 'p1', kind: 'hardline', key: 'topic', value: 'his knee surgery', provenance: 'commissioner-set', confidence: 1 } });
  env.gs.scribeMemoryUpsert({ adminPasswordHash: hash, record: { playerId: 'p2', kind: 'fact', key: 'job', value: 'new job', provenance: 'commissioner-set', confidence: 1 } });

  const own = env.gs.scribeMemoryList({ playerId: 'p1' });
  assert(own.ok === true && own.records.length === 1, 'a player can read his own file');
  const other = env.gs.scribeMemoryList({ playerId: 'p1', playerIds: ['p2'] });
  assert(other.ok === false && /another player/.test(other.error), "…and cannot read another player's");
  const sneaky = env.gs.scribeMemoryList({ playerId: 'p1', playerIds: ['p1', 'p2'] });
  assert(sneaky.ok === false, 'nor smuggle one in alongside his own');
  const unfiltered = env.gs.scribeMemoryList({ playerId: 'p1', playerIds: [] });
  assert(unfiltered.ok === true && unfiltered.records.length === 1 && unfiltered.records[0].playerId === 'p1',
    'an unfiltered request is NARROWED to the requester, never answered with the whole league');
  const anon = env.gs.scribeMemoryList({});
  assert(anon.ok === false, 'and a request with no requester at all is refused');
  const commish = env.gs.scribeMemoryList({ adminPasswordHash: hash });
  assert(commish.ok === true && commish.records.length === 2,
    'the commissioner still sees everything — D4\'s honest scope is "private from other players, visible to the commissioner until SSO"');
}

console.log('\n[19] Note 13 — Episodes (📌 remember_this) ride the same context block…');
{
  const env = buildSandbox();
  const s = env.gs.ensureMsgSheet();
  appendMsgRow(s, { id: 'e1', author: 'p1', body: 'I will never pick against Texas again' });
  appendMsgRow(s, { id: 'fb1', type: 'feedback', author: 'p2', targetId: 'e1', meta: { category: 'remember_this', value: true } });
  appendMsgRow(s, { id: 'e2', author: 'p2', body: 'a moment about someone else' });
  appendMsgRow(s, { id: 'fb2', type: 'feedback', author: 'p1', targetId: 'e2', meta: { category: 'remember_this', value: true } });
  const text = env.gs.scribeMemoryContextText_(['p1']);
  assert(/MOMENTS THIS LEAGUE ASKED YOU TO REMEMBER/.test(text), 'Episodes render in the memory block — DI-D2: Episodes ARE E2\'s 📌 flags, read in place');
  assert(/never pick against Texas again/.test(text), "…carrying the flagged message's own words");
  assert(!/a moment about someone else/.test(text), 'and only for the player in scope — an Episode belongs to whoever said it');
  assert(env.sheets['CFBP_SCRIBE_MEMORY'] === undefined || memRows(env).length === 0,
    'no row is copied into the memory sheet — Episodes are read in place, exactly as the DI requires (no new storage)');

  // Un-flagging withdraws consent, and the Episode leaves the context.
  appendMsgRow(s, { id: 'fb3', type: 'feedback', author: 'p2', targetId: 'e1', meta: { category: 'remember_this', value: false } });
  assert(!/never pick against Texas again/.test(env.gs.scribeMemoryContextText_(['p1'])),
    'clearing the last flag removes the Episode from SCRIBE\'s context — latest-wins, nothing sticky');
}


console.log('\n[20] BLOCK-3 — computed facts never reach the model, and carry a freshness stamp…');
{
  const env = buildSandbox();
  seedLeague(env);
  const hash = seedCommissionerPassword(env);
  env.gs.scribeMemoryRefreshComputed_();
  env.gs.scribeMemoryUpsert({ adminPasswordHash: hash, record: { playerId: 'p1', kind: 'fact', key: 'almaMater',
    value: 'Texas A&M', provenance: 'commissioner-set', confidence: 1 } });
  env.gs.scribeMemoryUpsert({ playerId: 'p1', record: { playerId: 'p1', kind: 'hardline', key: 'topic',
    value: 'his knee surgery', provenance: 'player-stated', confidence: 1 } });

  const player = env.gs.scribeMemoryList({ playerId: 'p1' }).records;
  assert(player.some(r => r.key === 'currentStreak' && r.provenance === 'computed'),
    "the player's own view still shows the computed facts — D3 wants them, with a date");

  const block = env.gs.scribeMemoryContextText_(['p1']);
  assert(!/currentStreak|seasonRecord|pickStyle/.test(block),
    'but NONE of them reach the model: a weekly-refreshed snapshot stamped confidence 1.0 would contradict get_player_statistics, which returns the LIVE number');
  assert(/almaMater: Texas A&M/.test(block), 'a commissioner-set fact does reach it');
  assert(/never bring up with p1: his knee surgery/.test(block), 'and so does a player-stated hard-line');
  assert(!/headToHead/.test(block), 'computed RELATIONS are excluded on the same grounds — get_head_to_head_record is one tool call away');

  const tool = env.gs.tool_getRelevantPlayerContext_({ playerId: 'p1' });
  assert(tool.memory.every(r => r.provenance !== 'computed'),
    'the get_relevant_player_context tool applies the same exclusion — both doors to the model, one rule');

  const ctx = env.gs.assembleScribeContext_({ invocationType: 'mention', playerId: 'p1', gameTag: '',
    triggerBody: 'hey', triggerSeq: 1, memoryPlayerIds: ['p1'] });
  const sys = ctx.systemBlocks.map(b => b.text).join('\n');
  assert(!/straight covers/.test(sys), 'the assembled system prompt carries no computed streak');
  assert(/his knee surgery/.test(sys), 'and does carry the player-stated boundary');

  const first = player.filter(r => r.key === 'seasonRecord')[0];
  assert(!!first.refreshedAt, 'every row carries a refreshedAt stamp');
  assert(first.refreshedAt >= first.createdAt, 'which is at or after createdAt');
  const rows = memRows(env);
  assert(rows[0].length >= 11 && String(rows[0][10]), 'and it is a real column on the sheet, appended at the end (never renumbering the first ten)');
  env.gs.scribeMemoryUpsert({ adminPasswordHash: hash, record: { playerId: 'p1', kind: 'fact', key: 'seasonRecord',
    value: '7-0', provenance: 'computed', confidence: 1 } });
  const second = env.gs.scribeMemoryList({ playerId: 'p1' }).records.filter(r => r.key === 'seasonRecord')[0];
  assert(second.createdAt === first.createdAt, 'a re-write keeps the original createdAt — "when SCRIBE first learned this"');
  assert(second.refreshedAt >= first.refreshedAt,
    'and advances refreshedAt — "how stale is this number", which is what pass 2 renders as "as of <date>"');
}

console.log('\n[21] S-1 — the key is an identifier, not a place to put prose…');
{
  const env = buildSandbox();
  const hash = seedCommissionerPassword(env);
  const long = 'k'.repeat(200);
  const r = env.gs.scribeMemoryUpsert({ adminPasswordHash: hash, record: { playerId: 'p1', kind: 'fact',
    key: long, value: 'v', provenance: 'commissioner-set', confidence: 1 } });
  assert(r.ok === true && r.record.key.length === 40, `a 200-char key is capped at 40 (got ${r.record.key.length})`);
  const ctrl = env.gs.scribeMemoryUpsert({ adminPasswordHash: hash, record: { playerId: 'p1', kind: 'fact',
    key: 'ab c', value: 'v', provenance: 'commissioner-set', confidence: 1 } });
  assert(ctrl.record.key === 'abc', `control characters are stripped from the key (got ${JSON.stringify(ctrl.record.key)})`);
  const empty = env.gs.scribeMemoryUpsert({ adminPasswordHash: hash, record: { playerId: 'p1', kind: 'fact',
    key: '', value: 'v', provenance: 'commissioner-set', confidence: 1 } });
  assert(empty.ok === false && /key is required/.test(empty.error), 'a key that is nothing but control characters is rejected, not stored blank');
}

console.log('\n[22] N-2 — a repeat classify returns the verdict it already paid for…');
{
  const env = buildSandbox();
  enableAutonomous(env);
  appendMsgRow(env.gs.ensureMsgSheet(), { id: 'n2', author: 'p1', body: 'I guarantee it' });
  env.setUrlFetchImpl(() => anthropicJsonResponse({ claim: true, kind: 'contradiction', confidence: 0.95 }));
  const first = env.gs.scribeClassify({ messageId: 'n2' });
  assert(first.points === 50, `fixture check: a confident contradiction is worth 50 (got ${first.points})`);
  const again = env.gs.scribeClassify({ messageId: 'n2' });
  assert(again.deduped === true && again.points === 50,
    `a second device asking about the SAME message gets the recorded verdict back, not a silent 0 (got ${again.points})`);
  assert(env.urlFetchCalls.length === 1, 'without paying twice');
}


console.log('\n[23] FINDING 2 — the league-wide stamp is taken at RESERVATION, not after the round trip…');
{
  // Two candidates interleaved: the second enters while the first is still
  // inside its Anthropic call. That window is 10-20 seconds of real time, so
  // this is not a theoretical race — it is the ordinary case on a finalize.
  const env = buildSandbox();
  enableAutonomous(env, { SCRIBE_AUTONOMOUS_LIMIT_HOURLY: 10 });
  let inner = null;
  let depth = 0;
  env.setUrlFetchImpl(() => {
    if (depth === 0) {
      depth++;
      inner = env.gs.scribeAutonomous({ trigger: 'chartLeadChange', subject: 'sB',
        evidence: evidence({ signals: ['backdoorBust'], gameTag: 'room2' }) });
    }
    return anthropicTextResponse('One line.');
  });
  const outer = env.gs.scribeAutonomous({ trigger: 'backdoorBust', subject: 'sA',
    evidence: evidence({ signals: ['backdoorBust'], gameTag: 'room1' }) });
  assert(outer.posted === true, 'the first candidate posts');
  assert(inner && inner.skipped === 'global_cooldown',
    `the second, entering DURING the first's fetch, is refused — the stamp was taken under the reservation lock, not after chatAppend (got ${JSON.stringify(inner)})`);
  assert(chatRows(env).filter(r => String(r[4]) === 'scribe').length === 1, 'exactly one autonomous message reaches the room');

  // A first call that FAILS must put the stamp back, or one outage would
  // silence the league for ten minutes.
  const env2 = buildSandbox();
  enableAutonomous(env2, { SCRIBE_AUTONOMOUS_LIMIT_HOURLY: 10 });
  env2.setUrlFetchImpl(() => ({ getResponseCode: () => 500, getContentText: () => 'boom' }));
  const failed = env2.gs.scribeAutonomous({ trigger: 'backdoorBust', subject: 'fA', evidence: evidence({ signals: ['backdoorBust'] }) });
  assert(failed.posted === false, 'fixture check: the first call failed');
  env2.setUrlFetchImpl(() => anthropicTextResponse('Second one works.'));
  const recovered = env2.gs.scribeAutonomous({ trigger: 'chartLeadChange', subject: 'fB', evidence: evidence({ signals: ['backdoorBust'] }) });
  assert(recovered.posted === true, 'a second candidate can still post — the failed reservation restored the previous stamp');

  // …and a refusal does the same.
  const env3 = buildSandbox();
  enableAutonomous(env3, { SCRIBE_AUTONOMOUS_LIMIT_HOURLY: 10 });
  env3.setUrlFetchImpl(() => ({ getResponseCode: () => 200,
    getContentText: () => JSON.stringify({ content: [], stop_reason: 'refusal', usage: { input_tokens: 10, output_tokens: 0 } }) }));
  env3.gs.scribeAutonomous({ trigger: 'backdoorBust', subject: 'rA', evidence: evidence({ signals: ['backdoorBust'] }) });
  env3.setUrlFetchImpl(() => anthropicTextResponse('Fine.'));
  const afterRefusal = env3.gs.scribeAutonomous({ trigger: 'chartLeadChange', subject: 'rB', evidence: evidence({ signals: ['backdoorBust'] }) });
  assert(afterRefusal.posted === true, 'a refusal restores it too — nothing posted, nothing owed');
}

console.log('\n[24] FINDING 3 — a claim is bound to its message, and a verdict funds one post…');
{
  const env = buildSandbox();
  enableAutonomous(env, { SCRIBE_AUTONOMOUS_LIMIT_HOURLY: 10 });
  const s = env.gs.ensureMsgSheet();
  appendMsgRow(s, { id: 'cl1', author: 'p2', body: 'Texas covers, I guarantee it' });
  appendMsgRow(s, { id: 'cl2', author: 'p3', body: 'ordinary chatter' });
  env.setUrlFetchImpl(() => anthropicJsonResponse({ claim: true, kind: 'guarantee', confidence: 0.9 }));
  assert(env.gs.scribeClassify({ messageId: 'cl1' }).points === 45, 'fixture check: cl1 is classified at 45');

  // The verdict cannot be pointed at a DIFFERENT message.
  env.setUrlFetchImpl(() => anthropicTextResponse('Should not happen.'));
  const rePointed = env.gs.scribeAutonomous({ trigger: 'claim', subject: 'cl1', playerId: 'p3',
    evidence: evidence({ signals: ['claim'], triggerMessageId: 'cl2' }) });
  assert(rePointed.skipped === 'below_threshold' && rePointed.score === 0,
    `a verdict earned by cl1 is worth nothing to cl2 — the lookup key IS the message id (got ${rePointed.score})`);
  assert(env.urlFetchCalls.length === 1, '…and costs nothing');

  // A claim with no message id at all is refused outright.
  const noId = env.gs.scribeAutonomous({ trigger: 'claim', subject: 'anything', evidence: evidence({ signals: ['claim'] }) });
  assert(noId.ok === false && /requires evidence.triggerMessageId/.test(noId.error), 'a claim must name the message it is about');

  // The subject is FORCED to the message id, so varying it cannot mint a new
  // post id and walk past the dedupe.
  const first = env.gs.scribeAutonomous({ trigger: 'claim', subject: 'whatever-i-like', playerId: 'p2',
    evidence: evidence({ signals: ['claim'], triggerMessageId: 'cl1' }) });
  assert(first.posted === true, 'the real claim posts');
  assert(first.responseMessageId.indexOf('scribe_auto_claim_cl1_') === 0,
    `and the post id is built from the MESSAGE id, not the client's subject (got ${first.responseMessageId})`);

  // The verdict is consumed: a second attempt, even with a different subject
  // and a cleared cooldown, scores 0.
  clearGlobalCooldown(env);
  const reuse = env.gs.scribeAutonomous({ trigger: 'claim', subject: 'another-angle', playerId: 'p2',
    evidence: evidence({ signals: ['claim'], triggerMessageId: 'cl1' }) });
  assert(reuse.skipped === 'below_threshold' && reuse.score === 0,
    `one classification funds ONE post — the second attempt scores 0 (got ${reuse.score})`);
  assert(chatRows(env).filter(r => String(r[4]) === 'scribe').length === 1, 'and exactly one SCRIBE message exists for that claim');
  assert(env.gs.scribeClassify({ messageId: 'cl1' }).points === 0,
    'a re-classify of the consumed message reports 0 rather than re-issuing the verdict');

  // A candidate refused by a gate does NOT burn the verdict.
  const env2 = buildSandbox();
  enableAutonomous(env2, { SCRIBE_AUTONOMOUS_LIMIT_HOURLY: 10 });
  appendMsgRow(env2.gs.ensureMsgSheet(), { id: 'cl9', author: 'p2', body: 'I guarantee it' });
  env2.setUrlFetchImpl(() => anthropicJsonResponse({ claim: true, kind: 'guarantee', confidence: 0.9 }));
  env2.gs.scribeClassify({ messageId: 'cl9' });
  env2.cacheStore.set('scribeAutoLast_all', String(Date.now()));          // league floor live
  const blocked = env2.gs.scribeAutonomous({ trigger: 'claim', playerId: 'p2',
    evidence: evidence({ signals: ['claim'], triggerMessageId: 'cl9' }) });
  assert(blocked.skipped === 'global_cooldown', 'fixture check: this candidate was refused by the league-wide floor');
  clearGlobalCooldown(env2);
  env2.setUrlFetchImpl(() => anthropicTextResponse('Now it posts.'));
  const later = env2.gs.scribeAutonomous({ trigger: 'claim', playerId: 'p2',
    evidence: evidence({ signals: ['claim'], triggerMessageId: 'cl9' }) });
  assert(later.posted === true, 'the verdict survives a refused candidate — only the post that USES it consumes it');
}


console.log('\n[25] F-D — a verdict is consumed whenever it CONTRIBUTED, whatever the trigger…');
{
  const env = buildSandbox();
  enableAutonomous(env, { SCRIBE_AUTONOMOUS_LIMIT_HOURLY: 10 });
  appendMsgRow(env.gs.ensureMsgSheet(), { id: 'd1', author: 'p2', body: 'I guarantee it' });
  env.setUrlFetchImpl(() => anthropicJsonResponse({ claim: true, kind: 'guarantee', confidence: 0.9 }));
  assert(env.gs.scribeClassify({ messageId: 'd1' }).points === 45, 'fixture check: d1 is classified at 45');

  // A GAME-EVENT trigger carrying a claim in its evidence: the claim's 45
  // points are part of what bought this post, so the verdict is spent.
  env.setUrlFetchImpl(() => anthropicTextResponse('Both things at once.'));
  const mixed = env.gs.scribeAutonomous({ trigger: 'backdoorBust', subject: 'mix', playerId: 'p2',
    evidence: evidence({ signals: ['backdoorBust', 'claim'], triggerMessageId: 'd1' }) });
  assert(mixed.posted === true && mixed.score === 72.5,
    `fixture check: backdoorBust 50 + 0.5 x claim 45 = 72.5 (got ${mixed.score})`);
  assert(env.gs.scribeClaimVerdictPoints_('d1') === 0,
    "the verdict is consumed even though the trigger was not 'claim' — gating consumption on the trigger name left the same hole open through a different door");

  // A claim that contributed NOTHING (no logged verdict, so 0 points) does
  // not mark anything used — there is nothing to consume.
  const env2 = buildSandbox();
  enableAutonomous(env2, { SCRIBE_AUTONOMOUS_LIMIT_HOURLY: 10 });
  appendMsgRow(env2.gs.ensureMsgSheet(), { id: 'd2', author: 'p2', body: 'unclassified' });
  env2.setUrlFetchImpl(() => anthropicTextResponse('Event only.'));
  const eventOnly = env2.gs.scribeAutonomous({ trigger: 'backdoorBust', subject: 'ev', playerId: 'p2',
    evidence: evidence({ signals: ['backdoorBust', 'claim'], triggerMessageId: 'd2' }) });
  assert(eventOnly.posted === true && eventOnly.score === 50,
    `an unclassified claim contributes 0, so the score is the game event alone (got ${eventOnly.score})`);
  env2.setUrlFetchImpl(() => anthropicJsonResponse({ claim: true, kind: 'guarantee', confidence: 0.9 }));
  assert(env2.gs.scribeClassify({ messageId: 'd2' }).points === 45,
    'and classifying that message afterwards still yields a usable verdict — nothing was marked spent that was never spent');
}

console.log('\n[26] F-E — the classify log key is sanitized identically on write and on read…');
{
  const env = buildSandbox();
  enableAutonomous(env, { SCRIBE_AUTONOMOUS_LIMIT_HOURLY: 10 });
  const longId = 'm_' + 'x'.repeat(68);          // 70 chars, past the 64-char cap
  assert(longId.length === 70, 'fixture check: the id really is 70 characters');
  appendMsgRow(env.gs.ensureMsgSheet(), { id: longId, author: 'p2', body: 'I guarantee it' });
  env.setUrlFetchImpl(() => anthropicJsonResponse({ claim: true, kind: 'guarantee', confidence: 0.9 }));
  assert(env.gs.scribeClassify({ messageId: longId }).points === 45, 'fixture check: the long-id message classifies');
  assert(env.gs.scribeClaimVerdictPoints_(longId) === 45,
    'the verdict ROUND-TRIPS: the writer narrows the key the same way the reader does, so a 70-character id is not written under one key and looked up under another');
  env.setUrlFetchImpl(() => anthropicTextResponse('Found it.'));
  const posted = env.gs.scribeAutonomous({ trigger: 'claim', playerId: 'p2',
    evidence: evidence({ signals: ['claim'], triggerMessageId: longId }) });
  assert(posted.posted === true && posted.score === 45, 'and a claim on that message scores its real 45 rather than a silent 0');
  assert(env.gs.scribeClaimVerdictPoints_(longId) === 0, 'consumption finds it under the same key too');
}

console.log('\n[27] F-G — the stamp restore only puts back what is still ours…');
{
  const env = buildSandbox();
  enableAutonomous(env, { SCRIBE_AUTONOMOUS_LIMIT_HOURLY: 10 });
  // The first candidate fails, but a SECOND candidate stamps the cooldown
  // while the first is still inside its (failing) fetch. The first must not
  // roll back a stamp that now belongs to the second.
  let phase = 'outer-first', inner = null;
  const boom = { getResponseCode: () => 500, getContentText: () => 'boom' };
  env.setUrlFetchImpl(() => {
    if (phase === 'outer-first') {
      phase = 'inner';
      // A later candidate legitimately takes the stamp while the first is
      // still in flight (ten real minutes would do the same).
      env.cacheStore.delete('scribeAutoLast_all');
      inner = env.gs.scribeAutonomous({ trigger: 'chartLeadChange', subject: 'gB',
        evidence: evidence({ signals: ['backdoorBust'], gameTag: 'room2' }) });
      phase = 'outer-retry';
      return boom;                                   // the OUTER call's own first response
    }
    if (phase === 'inner') return anthropicTextResponse('The second one posts.');
    return boom;                                     // the outer's single retry
  });
  const outer = env.gs.scribeAutonomous({ trigger: 'backdoorBust', subject: 'gA',
    evidence: evidence({ signals: ['backdoorBust'], gameTag: 'room1' }) });
  assert(inner && inner.posted === true, 'fixture check: the inner candidate posted');
  assert(outer.posted === false, 'fixture check: the outer candidate failed after it');
  const stamp = env.cacheStore.get('scribeAutoLast_all');
  assert(!!stamp, "the failed candidate did NOT roll back the live cooldown — it no longer owned the stamp, and clearing it would re-open the window FINDING 2 closed");
}

console.log('\n[28] FEAT-5 (UN-202) — the `wager` kind: the four Code.gs edits, end to end…');
{
  // The SERVER half of DI-202. Each of the four DI-202o edits is exercised
  // against backend/Code.gs itself in a Node vm — the same file Drew pastes.
  const env = buildSandbox();
  const hash = seedCommissionerPassword(env);
  const wagerValue = (o) => JSON.stringify({ c: 'USC is not ranked by week 7', o: o || '', w: 'wk7', b: 'p3' });

  // ── 1. The new kind is accepted; an unknown kind is still rejected. ──
  const ok1 = env.gs.scribeMemoryUpsert({ playerId: 'p1', record: { playerId: 'p1', kind: 'wager',
    key: 'wager:w1abc', value: wagerValue('p2'), reviewAt: '2026-10-11T23:59:59.000Z', sourceMessageId: 'm_src' } });
  assert(ok1.ok === true && ok1.record.kind === 'wager',
    '28-1: edit 1 — SCRIBE_MEMORY_KINDS_ accepts the new `wager` kind (without it every log attempt dies at "unknown kind")');
  const bogus1 = env.gs.scribeMemoryUpsert({ adminPasswordHash: hash, record: { playerId: 'p1', kind: 'wagerish',
    key: 'k', value: 'v', provenance: 'commissioner-set', confidence: 1 } });
  assert(bogus1.ok === false && /unknown kind/.test(bogus1.error),
    '28-2: …and an unknown kind is STILL rejected at the boundary — the map was widened by one entry, not opened');

  // ── 2. A player writes about himself; provenance/confidence are FORCED. ──
  assert(ok1.record.provenance === 'player-stated' && Number(ok1.record.confidence) === 1,
    '28-3: edit 2 — a non-commissioner wager write is forced to player-stated / 1.0, unchanged from the hard-line path (a wager is a claim a person made, never a computed inference)');
  assert(ok1.record.reviewAt === '2026-10-11T23:59:59.000Z' && ok1.record.sourceMessageId === 'm_src',
    '28-4: …and it carries reviewAt (the due date, a header column written by nothing until now) and sourceMessageId (which is what makes "↩ Jump to the message" free)');
  const notMine = env.gs.scribeMemoryUpsert({ playerId: 'p2', record: { playerId: 'p1', kind: 'wager',
    key: 'wager:w9', value: wagerValue('') } });
  assert(notMine.ok === false && /only write memory about himself/.test(notMine.error),
    '28-5: the OWNERSHIP check is untouched — edit 2 widened the allowed KINDS, it did not widen who a player may write about');

  // ── 3. kinds:['wager'] reads LEAGUE-WIDE for a non-commissioner. ──
  env.gs.scribeMemoryUpsert({ playerId: 'p2', record: { playerId: 'p2', kind: 'wager',
    key: 'wagerack:w1abc', value: JSON.stringify({ w: 'w1abc', r: 'accepted' }), sourceMessageId: 'scribe_wager_w1abc' } });
  env.gs.scribeMemoryUpsert({ adminPasswordHash: hash, record: { playerId: 'p2', kind: 'fact', key: 'job',
    value: 'new job', provenance: 'commissioner-set', confidence: 1 } });
  const leagueWide = env.gs.scribeMemoryList({ playerId: 'p3', kinds: ['wager'] });
  assert(leagueWide.ok === true && leagueWide.records.length === 2
      && leagueWide.records.every(r => r.kind === 'wager'),
    `28-6: edit 3 — kinds:['wager'] returns EVERY player's wager rows to a non-commissioner (got ${leagueWide.records.length}). Without this there is no resurfacing at all: the counterparty could not see the proposer's row and no device could post the callback`);
  assert(leagueWide.records.some(r => r.playerId === 'p1') && leagueWide.records.some(r => r.playerId === 'p2'),
    '28-7: …both sides of the wager, proposer row and counterparty ack, reach the requester');

  // ── 4. THE F5 REGRESSION GUARD. The carve-out is one kind wide. ──
  const factRead = env.gs.scribeMemoryList({ playerId: 'p3', kinds: ['fact'] });
  assert(factRead.ok === true && factRead.records.length === 0,
    `28-8: F5 REGRESSION GUARD — kinds:['fact'] STILL narrows to the requester (p3 owns no facts, so 0; got ${factRead.records.length}). This is the assertion that proves the carve-out did not widen`);
  const unfiltered = env.gs.scribeMemoryList({ playerId: 'p1' });
  assert(unfiltered.ok === true && unfiltered.records.every(r => r.playerId === 'p1'),
    '28-9: …and an UNFILTERED request is still narrowed to the requester, never answered with the whole league');
  const twoKinds = env.gs.scribeMemoryList({ playerId: 'p3', kinds: ['wager', 'fact'] });
  assert(twoKinds.ok === false || twoKinds.records.every(r => r.playerId === 'p3'),
    "28-10: …and ['wager','fact'] is NOT the carve-out — it is EXACTLY ['wager'] or nothing, so a second kind cannot ride along");
  const anon = env.gs.scribeMemoryList({ kinds: ['wager'] });
  assert(anon.ok === false, '28-11: the carve-out still requires a requester — an anonymous read is refused');

  // ── 5. Wagers never reach the model's context. ──
  const ctx = env.gs.scribeMemoryFor_(['p1']);
  assert(ctx.every(r => r.kind !== 'wager'),
    '28-12: edit 4 — scribeMemoryFor_ EXCLUDES wagers from the default model context. They are written at confidence 1.0, so without this they clear the 0.5 floor and enter every @scribe prompt');
  const named = env.gs.scribeMemoryFor_(['p1'], { kinds: ['wager'] });
  assert(named.length === 1 && named[0].kind === 'wager',
    '28-13: …excluded from the DEFAULT set only — a caller that names the kind still gets them');
  {
    // THE WAGERS ARE WRITTEN IN THE MIDDLE, deliberately. scribeMemoryFor_ caps
    // at 8 items in SHEET (insertion) order, so wagers appended after eight
    // facts would fall off the end anyway and this assertion would pass with the
    // exclusion deleted — a test that proves nothing. Interleaved, an unexcluded
    // wager genuinely displaces a real fact, which is the regression DI-202e is
    // about.
    const facts2 = buildSandbox();
    const h2 = seedCommissionerPassword(facts2);
    const writeFacts = (env, from, to) => {
      for (let i = from; i < to; i++) {
        env.gs.scribeMemoryUpsert({ adminPasswordHash: h2, record: { playerId: 'p1', kind: 'fact',
          key: 'f' + i, value: 'fact ' + i, provenance: 'commissioner-set', confidence: 1 } });
      }
    };
    writeFacts(facts2, 0, 8);
    const before = facts2.gs.scribeMemoryFor_(['p1']).map(r => r.key).join(',');

    const env2 = buildSandbox();
    seedCommissionerPassword(env2);
    writeFacts(env2, 0, 4);
    for (let i = 0; i < 10; i++) {
      env2.gs.scribeMemoryUpsert({ playerId: 'p1', record: { playerId: 'p1', kind: 'wager',
        key: 'wager:z' + i, value: JSON.stringify({ c: 'c' + i, o: '', w: 'wk7', b: 'p1' }) } });
    }
    writeFacts(env2, 4, 8);
    const after = env2.gs.scribeMemoryFor_(['p1']).map(r => r.key).join(',');
    assert(before === after && before.split(',').length === 8,
      `28-14: …and a store with TEN wagers written BETWEEN the facts surfaces the SAME eight facts it would without them — the 8-item cap is insertion-ordered, so an unexcluded wager progressively displaces the real facts about a player (got ${after})`);
  }

  // ── 6. Delete is a TRUE delete, and it is still ownership-checked. ──
  const rowsBefore = memRows(env).length;
  const notYours = env.gs.scribeMemoryDelete({ playerId: 'p3', id: ok1.record.id });
  assert(notYours.ok === false && /belongs to another player/.test(notYours.error),
    "28-15: a player cannot delete another player's wager row — the league-wide READ bought no write or delete power");
  const gone = env.gs.scribeMemoryDelete({ playerId: 'p1', id: ok1.record.id });
  assert(gone.ok === true && gone.deleted === true && memRows(env).length === rowsBefore - 1,
    '28-16: the proposer deleting his own wager row is a TRUE deleteRow — AD-49: the wager is gone, and SCRIBE never brings it back');

  // ── 7. The 200-char slice — the reason the client caps the claim at 110. ──
  const env3 = buildSandbox();
  const longEnvelope = JSON.stringify({ c: 'x'.repeat(250), o: 'p2', w: 'wk7', b: 'p3' });
  const sliced = env3.gs.scribeMemoryUpsert({ playerId: 'p1', record: { playerId: 'p1', kind: 'wager',
    key: 'wager:wlong', value: longEnvelope } });
  assert(sliced.ok === true && sliced.record.value.length === 200,
    `28-17: the server hard-slices \`value\` at 200 chars (got ${sliced.record.value.length})`);
  let stillParses = true;
  try { JSON.parse(sliced.record.value); } catch { stillParses = false; }
  assert(stillParses === false,
    '28-18: …and a slice landing MID-JSON leaves an UNPARSEABLE row, silently, forever — which is exactly why the client caps the claim at 110 and asserts the serialised envelope fits BEFORE it sends');
}

console.log('\n══════════════════════════════════════════════════');
console.log(fail === 0 ? `✅ ALL PASS — ${pass} passed, ${fail} failed` : `❌ FAILURES — ${pass} passed, ${fail} failed`);
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
