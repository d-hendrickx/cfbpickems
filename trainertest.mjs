/**
 * CFB Pickems — trainertest.mjs (Build 2b, Group E, 2026-09-10, UN-161…163)
 * ===========================================================================
 * Unit/integration tests for the SCRIBE Trainer (`runTrainer`, E3), the
 * runtime-context slots it feeds (E4), and the two new UI surfaces that read
 * its output (E5a Rules-page archive, E5b Comm→Data metrics/approve card).
 *
 * TWO harnesses, same file, same split `scribeToolsTwin.mjs`/`scribetest.mjs`
 * already establish between "pure client function" and "runs inside Code.gs":
 *   PART A — backend/Code.gs executed WHOLESALE inside a Node `vm` context,
 *     IDENTICAL harness to scribetest.mjs (buildSandbox/makeFakeSheet/
 *     anthropicResponse/appendMsgRow) — kept duplicated rather than shared,
 *     same reasoning scribeToolsTwin.mjs's own header gives for not sharing
 *     state across a "clean process" boundary; this file is its own process.
 *   PART B — REAL ESM imports of js/app.js / js/storage.js / js/scribeAgent.js
 *     (DOM/localStorage stubbed, same shape scribetest.mjs's top-of-file
 *     stubs use for js/chat.js) for the two E5 render functions and the E4
 *     client-side getActiveContext() mirror — these are genuine client code,
 *     not a Code.gs port, so they run in Node exactly as the browser would.
 *
 * Run:  node trainertest.mjs
 * Must be run under BOTH TZ=UTC and TZ=America/Los_Angeles.
 *
 * Covers (task instruction, verbatim):
 *   [1]  Structured-output request shape (output_config.format, tools:[], max_tokens)
 *        …and NO `anthropic-beta` header: output_config.format is GA
 *        (claude-api shared/tool-use-concepts.md -> Structured Outputs)
 *   [2]  Cursor advance + pagination
 *   [3]  Aftermath computation on a fixture
 *   [4]  Headline metric math (+ rating mix, rewrite union, per-player hints,
 *        and round 3's latest-wins/truthy-only `weighInFlags`)
 *   [5]  ≥0.9 auto-apply vs pending (per-kind status rule)
 *   [6]  0.75 runtime threshold (E4)
 *   [7]  Kill switch empties slots
 *   [8]  Report §8 section order
 *   [9]  Chat post author/notify/id
 *   [10] RG-10 for both new cards (negative test)
 *   [11] Cache breakpoint placement — structural
 *   [12] SCRIBE.md never referenced by Trainer code — structural
 *   [13] Monthly cap shared with mention/autonomous invocations
 *   [14] Mutation-prove: ≥0.9 auto-apply gate + kill switch (scratch copies, never git)
 *
 * Round-2 remediation (reviewer BLOCK, 2026-09-10) — everything below was
 * added after the first review. The headline finding was that
 * SCRIBE_TRAINER_PROMPT_BASE was DEAD CODE: declared, drift-guarded in a
 * comment that described a guard nobody had written, and never loaded by any
 * code path. Hence the class rule these sections encode: a prompt/schema/
 * constant embedded as a snapshot needs a drift guard AND an assertion that
 * the snapshot is reached by its code path. One without the other is theater.
 *   [15]  BLOCK #1 — the Trainer prompt is REACHED (behavioral, at the wire)
 *   [16]  BLOCK #1 — the mention path still gets the persona, and no Trainer text
 *   [16b] …mutation: remove the invocationType selector -> dead code again
 *   [17]  BLOCK #2 — Trainer-prompt drift guard vs SCRIBE-TRAINER.md + canary
 *                    + the reachability half of the same rule
 *   [18]  BLOCK #3 — SCRIBE_TRAINER_ENABLED (default FALSE) and
 *                    SCRIBE_INTERACTIVE_ENABLED as a global stop, both entry points
 *   [18b] …mutation: force the trainer switch open
 *   [19]  BLOCK #4 — insufficient-data no-op (N=3 distinct rated responses);
 *                    round 3: the cursor is HELD, so thin windows pool
 *   [20]  #5 — E4 end to end: an approved ≥0.75 learning on the wire of a MENTION
 *   [20b] …mutation: drop the activeLearnings argument at the call site
 *   [21]  #6 — cursor advance asserted at the call site, after a real pass
 *   [21b] …mutation: drop the advance
 *   [22]  #7 — fact_candidates grounded in the 📌 remember_this source set
 *   [22c] ROUND-3 BLOCK — the remember_this CLEAR contract, tested against
 *                    the real producing call site (js/chat-ui.js:1003)
 *   [22d] …mutation: restore round 2's `=== null`-only clear
 *   [23]  #8 — commissioner credential + one-manual-run-per-hour floor
 *   [23b] …mutation: remove the credential gate
 *   [24]  #13 — fail closed: refusal / unparseable / network. Cursor NOT advanced
 *   [25]  #9 — responsesWithRatings counts DISTINCT rated responses
 *   [26]  #14 — Approve/Reject tap targets ≥40px (CONVENTIONS #17)
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

// ── DOM/browser stubs so js/app.js/js/storage.js/js/scribeAgent.js import
// cleanly for PART B below — identical shape to scribetest.mjs's own stubs. ──
const lsStore = new Map();
globalThis.localStorage = {
  getItem: k => (lsStore.has(k) ? lsStore.get(k) : null),
  setItem: (k, v) => lsStore.set(k, String(v)),
  removeItem: k => lsStore.delete(k),
  clear: () => lsStore.clear(),
};
globalThis.document = {
  addEventListener() {}, removeEventListener() {}, getElementById: () => null,
  querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({ set innerHTML(v) {}, get innerHTML() { return ''; }, appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {}, classList: { add() {}, remove() {} }, style: {}, id: '', className: '' }),
  body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '', dataset: {} },
  hidden: false,
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined, clipboard: { writeText: async () => {} } }, configurable: true }); }
globalThis.requestAnimationFrame = fn => fn();
globalThis.fetch = async () => { throw new Error('network disabled in trainertest'); };
globalThis.matchMedia = () => ({ matches: false });
globalThis.confirm = () => true;
globalThis.prompt = () => null;
globalThis.alert = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };

// ═══════════════════════════════════════════════════════════════════════════
// ── PART A — GAS sandbox harness (identical shape to scribetest.mjs) ────────
// ═══════════════════════════════════════════════════════════════════════════
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
  return {
    gs: sandbox, props, cacheStore, sheets, urlFetchCalls,
    setUrlFetchImpl: fn => { urlFetchImpl = fn; },
  };
}

/** A valid structured-output response matching scribeTrainerOutputSchema_'s
 *  shape — the DEFAULT fixture every test starts from unless it overrides a
 *  field. */
function trainerOutput(overrides = {}) {
  return {
    active_learnings: [],
    canon_candidates: [],
    proposed_experiments: [],
    fact_candidates: [],
    report: {
      what_landed: 'Short replies performed well.',
      what_missed: 'Two Too Much ratings on medical framing.',
      what_scribe_learned: 'Prefer brevity.',
      changes_being_tested: 'None yet.',
      feedback_not_adopted: 'Insufficient evidence on frequency.',
      what_we_need_more_data_on: 'Whether autonomous participation should increase.',
    },
    ...overrides,
  };
}
function anthropicJsonResponse(obj, usage = {}) {
  const body = { content: [{ type: 'text', text: JSON.stringify(obj) }], stop_reason: 'end_turn', usage: { input_tokens: 500, output_tokens: 200, ...usage } };
  return { getResponseCode: () => 200, getContentText: () => JSON.stringify(body) };
}
function appendMsgRow(sheet, { id, type = 'message', author, gameTag = '', body = '', targetId = '', replyTo = '', meta = {}, ts }) {
  const row = sheet.getLastRow() + 1;
  const seq = row - 1;
  sheet.getRange(row, 1, 1, 10).setValues([[seq, id, ts !== undefined ? ts : Date.now(), type, author, gameTag, body, targetId, replyTo, JSON.stringify(meta)]]);
  return seq;
}
// Round-2 remediation — a Trainer run now needs BOTH switches on. Default
// for both is OFF (never spends a dollar by accident), so every test that
// wants a real run has to say so explicitly, which is the point.
function enableTrainer(env, extra = {}) {
  env.props.ANTHROPIC_API_KEY = 'test-key';
  env.props.SCRIBE_TRAINER_ENABLED = 'true';
  env.props.SCRIBE_INTERACTIVE_ENABLED = 'true';
  Object.entries(extra).forEach(([k, v]) => { env.props[k] = String(v); });
}

/** btoa() for the sandbox's benefit — the commissioner credential is
 *  `btoa(password)`, exactly what js/app.js computes at the call site. */
function b64(str) { return Buffer.from(str, 'binary').toString('base64'); }

const TEST_COMMISH_PW = 'hunter2';
function seedCommissionerPassword(env, pw = TEST_COMMISH_PW) {
  const settings = env.gs.getOne('cfbp_settings') || {};
  settings.adminPasswordHash = b64(pw);
  env.gs.setOne('cfbp_settings', settings);
  return settings.adminPasswordHash;
}

/** Seeds `n` SCRIBE responses, each rated once by a player, so the window
 *  clears the insufficient-data floor (>=3 DISTINCT rated responses). */
function seedRatedWindow(env, n = 3) {
  const s = env.gs.ensureMsgSheet();
  for (let i = 0; i < n; i++) {
    appendMsgRow(s, { id: 'sr' + i, author: 'scribe', body: 'scribe line ' + i });
    appendMsgRow(s, { id: 'fbr' + i, type: 'feedback', author: 'p1', targetId: 'sr' + i, meta: { category: 'rating', value: 'hit' } });
  }
  return s;
}

/** The manual HTTP path, with a valid commissioner credential. */
function runTrainerAuthed(env, extra = {}) {
  const hash = seedCommissionerPassword(env);
  return env.gs.runTrainer(Object.assign({ adminPasswordHash: hash }, extra));
}

console.log('\n[1] Structured-output request shape — output_config.format, tools:[], larger max_tokens…');
{
  const env1 = buildSandbox();
  enableTrainer(env1);
  seedRatedWindow(env1);
  let captured1 = null;
  env1.setUrlFetchImpl((url, opts) => { captured1 = JSON.parse(opts.payload); return anthropicJsonResponse(trainerOutput()); });
  const r1 = runTrainerAuthed(env1);
  assert(r1.ok === true, `runTrainer succeeds against a well-formed fixture response (error: ${r1.error})`);
  assert(captured1.output_config && captured1.output_config.format && captured1.output_config.format.type === 'json_schema', 'output_config.format.type is json_schema');
  assert(captured1.output_config.format.schema && captured1.output_config.format.schema.type === 'object', 'a real JSON Schema object is attached');
  assert(!('tools' in captured1), 'NO tools key at all — Trainer never declares chat tools (tools:[] override)');
  assert(captured1.max_tokens === 4096, `Trainer's max_tokens is its own larger budget (got ${captured1.max_tokens}), not the 1024 mention default`);
  const schema1 = captured1.output_config.format.schema;
  function assertNoExtraProps(node, path) {
    if (node && node.type === 'object') {
      assert(node.additionalProperties === false, `additionalProperties:false at ${path}`);
      Object.entries(node.properties || {}).forEach(([k, v]) => assertNoExtraProps(v, path + '.' + k));
    } else if (node && node.type === 'array') {
      assertNoExtraProps(node.items, path + '[]');
    }
  }
  assertNoExtraProps(schema1, 'root');
  assert(Array.isArray(schema1.required) && schema1.required.includes('active_learnings') && schema1.required.includes('report'), 'the top-level schema requires active_learnings/canon_candidates/proposed_experiments/fact_candidates/report');

  // ── Round 3 — NO `anthropic-beta` HEADER, and that is a CHECKED fact, not
  // an omission. Reference: claude-api `shared/tool-use-concepts.md` ->
  // "Structured Outputs", which describes `output_config.format` as a GA
  // enhancement to the Messages API ("this is not a separate tool"), lists
  // the supported models outright, and names NO beta identifier anywhere in
  // the section. `curl/examples.md` has no structured-outputs section at all;
  // its only `anthropic-beta` content is the Required Headers row ("Required
  // for beta features") and a server-side-fallback example for an unrelated
  // feature. Asserted here so the matching comment in scribeCallAnthropic_
  // cannot quietly go stale, and so that if someone later adds a beta id
  // "just in case" a test says why that is wrong.
  const headers1 = env1.urlFetchCalls[0].opts.headers;
  assert(!Object.keys(headers1).some(h => h.toLowerCase() === 'anthropic-beta'),
    `no anthropic-beta header is sent on the Trainer's output_config.format call — structured outputs are GA (headers sent: ${JSON.stringify(Object.keys(headers1))})`);
  assert(headers1['anthropic-version'] === '2023-06-01' && !!headers1['x-api-key'],
    'the Trainer header set is exactly anthropic-version + x-api-key');
}

console.log('\n[2] Cursor advance + pagination — chatSince()-shaped incremental reads, never a full re-read…');
{
  const env2 = buildSandbox();
  const s2 = env2.gs.ensureMsgSheet();
  for (let i = 0; i < 1500; i++) appendMsgRow(s2, { id: 'm' + i, author: i % 5 === 0 ? 'scribe' : 'p1', body: 'msg ' + i });
  const read2a = env2.gs.scribeTrainerReadAllSince_(0);
  assert(read2a.events.length === 1500, `first read from seq 0 returns ALL 1500 events, paginated across multiple chatSince() calls (got ${read2a.events.length})`);
  assert(read2a.newCursor === 1500, `newCursor lands on the final seq consumed (got ${read2a.newCursor})`);
  assert(env2.gs.scribeTrainerCursor_() === 0, 'the Script Property cursor has NOT advanced yet — reading is separate from committing');
  env2.gs.scribeTrainerAdvanceCursor_(read2a.newCursor);
  assert(env2.gs.scribeTrainerCursor_() === 1500, 'scribeTrainerAdvanceCursor_ persists the advance to the Script Property');

  for (let i = 0; i < 10; i++) appendMsgRow(s2, { id: 'new' + i, author: 'p2', body: 'new msg ' + i });
  const read2b = env2.gs.scribeTrainerReadAllSince_(env2.gs.scribeTrainerCursor_());
  assert(read2b.events.length === 10, `a second run reads ONLY the 10 new events since the cursor, not the whole 1510-event history again (got ${read2b.events.length})`);
  assert(read2b.events[0].id === 'new0', 'the new range starts exactly where the cursor left off');
}

console.log('\n[3] Aftermath computation on a fixture (SCRIBE-TRAINER.md §3.4)…');
{
  const env3 = buildSandbox();
  const base = Date.now();
  const events3 = [
    { type: 'message', id: 'h1', author: 'p1', gameTag: '', ts: base },
    { type: 'message', id: 's1', author: 'scribe', gameTag: '', ts: base + 1000 },
    { type: 'message', id: 'h2', author: 'p2', gameTag: '', ts: base + 2000, replyTo: 's1' },
    { type: 'message', id: 'h3', author: 'p3', gameTag: '', ts: base + 3000 },
    { type: 'message', id: 'other-tag', author: 'p4', gameTag: 'gameX', ts: base + 3500 },
    { type: 'message', id: 's2', author: 'scribe', gameTag: '', ts: base + 4000 },
  ];
  const aftermath3 = env3.gs.scribeTrainerComputeAftermath_(events3);
  const s1Result = aftermath3.find(a => a.id === 's1');
  assert(!!s1Result, 's1 (a SCRIBE message) produces an aftermath entry');
  assert(s1Result.humanReplies === 2, `s1 counts h2 and h3 as human replies in its own gameTag (got ${s1Result.humanReplies})`);
  assert(s1Result.directReply === true, 'h2.replyTo=s1 sets directReply true');
  assert(s1Result.scribeSpokeAgainFirst === false, 's1 has TWO human replies before s2 speaks again — scribeSpokeAgainFirst is false');

  const events3b = [
    { type: 'message', id: 'sA', author: 'scribe', gameTag: '', ts: base },
    { type: 'message', id: 'sB', author: 'scribe', gameTag: '', ts: base + 500 },
  ];
  const sAResult = env3.gs.scribeTrainerComputeAftermath_(events3b).find(a => a.id === 'sA');
  assert(sAResult.humanReplies === 0 && sAResult.scribeSpokeAgainFirst === true, 'zero human replies before SCRIBE speaks again -> scribeSpokeAgainFirst=true (the exact anti-pattern §3.4 names)');

  const events3c = [
    { type: 'message', id: 'sC', author: 'scribe', gameTag: '', ts: base },
    { type: 'message', id: 'hLate', author: 'p1', gameTag: '', ts: base + 31 * 60 * 1000 },
  ];
  assert(env3.gs.scribeTrainerComputeAftermath_(events3c).find(a => a.id === 'sC').humanReplies === 0, 'a reply more than 30 minutes later is OUTSIDE the aftermath window — not counted');

  const events3d = [
    { type: 'message', id: 'sD', author: 'scribe', gameTag: '', ts: base },
    { type: 'message', id: 'hOther', author: 'p1', gameTag: 'otherGame', ts: base + 1000 },
  ];
  assert(env3.gs.scribeTrainerComputeAftermath_(events3d).find(a => a.id === 'sD').humanReplies === 0, 'a reply in a DIFFERENT gameTag never counts as this response\'s aftermath');
}

console.log('\n[4] Headline metric math — human/SCRIBE ratio, rating mix, rewrite+weigh-in text union, per-player hints…');
{
  const env4 = buildSandbox();
  const events4 = [
    { type: 'message', author: 'p1' }, { type: 'message', author: 'p2' },
    { type: 'message', author: 'scribe' }, { type: 'message', author: 'p3' },
    { type: 'message', author: 'system' },
  ];
  const feedback4 = [
    { author: 'p1', targetId: 's1', meta: { category: 'rating', value: 'hit' } },
    { author: 'p1', targetId: 's2', meta: { category: 'rating', value: 'hit' } },
    { author: 'p1', targetId: 's3', meta: { category: 'rating', value: 'too_much' } },
    { author: 'p2', targetId: 's1', meta: { category: 'rating', value: 'mid' } },
    { author: 'p1', targetId: 's4', meta: { category: 'rewrite', value: 'should have said X' } },
    { author: 'p2', targetId: 'h9', meta: { category: 'weigh_in', value: 'this needed a response' } },
    { author: 'p3', targetId: 'h10', meta: { category: 'weigh_in', value: true } },
  ];
  const players4 = { p1: { playerId: 'p1', displayName: 'Kevin' }, p2: { playerId: 'p2', displayName: 'Brayden' } };
  const m4 = env4.gs.scribeTrainerComputeMetrics_(events4, feedback4, players4);
  assert(m4.humanMessagesPerInterjection === 3, `3 human messages / 1 SCRIBE message = 3 (got ${m4.humanMessagesPerInterjection})`);
  assert(m4.dataset.responsesEvaluated === 1, 'dataset.responsesEvaluated counts SCRIBE messages only (system excluded)');
  assert(m4.ratingMix.hit === 50 && m4.ratingMix.mid === 25 && m4.ratingMix.tooMuch === 25, `rating mix is 2 hit / 1 mid / 1 too_much = 50/25/25% (got ${JSON.stringify(m4.ratingMix)})`);
  assert(m4.rewriteCount === 1, 'rewriteCount counts exactly the one rewrite event');
  assert(m4.dataset.textFeedbackItems === 2, `textFeedbackItems UNIONS rewrite + STRING weigh_in (1 rewrite + 1 string weigh-in = 2; boolean weigh_in excluded — got ${m4.dataset.textFeedbackItems})`);
  assert(m4.weighInFlags.length === 2, 'BOTH weigh_in flags (string and boolean) count as missed-opportunity signals, even though only the string one is "text feedback"');
  assert(m4.perPlayerHints.some(h => h.includes('Kevin') && h.includes('Hit')), `p1 (Kevin, 2/3 Hit) produces a narrow hint (got ${JSON.stringify(m4.perPlayerHints)})`);
  assert(!m4.perPlayerHints.some(h => h.includes('Brayden')), 'p2 (Brayden, only 1 rating) is BELOW the n>=3 volume floor — no hint from one data point');

  // ── Round-3 BLOCK — `weighInFlags` is LATEST-WINS per (target, flagger)
  // and TRUTHY-ONLY, the same contract scribeTrainerRememberThisSources_
  // now uses. It used to push one entry PER EVENT, unconditionally. It is
  // consumed only as a count ("N flagged message(s) this window",
  // scribeTrainerBuildInputText_), so a per-event push inflated it in
  // exactly the direction note #9 already ruled against for
  // `responsesWithRatings`, and a cleared flag kept counting forever.
  const feedback4b = [
    { author: 'p1', targetId: 'hA', seq: 1, meta: { category: 'weigh_in', value: true } },
    { author: 'p2', targetId: 'hA', seq: 2, meta: { category: 'weigh_in', value: true } },
    { author: 'p3', targetId: 'hA', seq: 3, meta: { category: 'weigh_in', value: 'needed a jab here' } },
    { author: 'p1', targetId: 'hB', seq: 4, meta: { category: 'weigh_in', value: true } },
    { author: 'p1', targetId: 'hB', seq: 5, meta: { category: 'weigh_in', value: false } },
    { author: 'p1', targetId: 'hC', seq: 6, meta: { category: 'weigh_in', value: null } },
  ];
  const m4b = env4.gs.scribeTrainerComputeMetrics_([], feedback4b, {});
  assert(m4b.weighInFlags.length === 1 && m4b.weighInFlags[0].targetId === 'hA',
    `three players flagging the SAME message is ONE flagged message, not three (got ${JSON.stringify(m4b.weighInFlags)})`);
  assert(m4b.weighInFlags[0].author === 'p3' && m4b.weighInFlags[0].value === 'needed a jab here',
    'the surviving entry carries the most recent LIVE flagger and their value');
  assert(!m4b.weighInFlags.some(f => f.targetId === 'hB'),
    'a flag whose ONLY flagger later cleared it (`false`) is no longer a live missed-opportunity signal');
  assert(!m4b.weighInFlags.some(f => f.targetId === 'hC'), 'a `null` weigh_in is a clear too, never a flag');
  assert(m4b.dataset.textFeedbackItems === 1,
    'the text-feedback union stays a PER-EVENT count (one string weigh-in) — a different metric from the flag count, deliberately');
}

console.log('\n[5] ≥0.9 auto-apply vs pending — per-kind status rule (E-2)…');
{
  const env5 = buildSandbox();
  assert(env5.gs.scribeTrainerStatusFor_('learning', 0.95) === 'approved', 'a learning at 0.95 confidence auto-approves');
  assert(env5.gs.scribeTrainerStatusFor_('learning', 0.9) === 'approved', 'exactly 0.9 (the threshold) auto-approves — >= not >');
  assert(env5.gs.scribeTrainerStatusFor_('learning', 0.89) === 'pending', 'just under 0.9 stays pending');
  assert(env5.gs.scribeTrainerStatusFor_('canon', 0.99) === 'approved', 'a canon candidate at 0.99 auto-approves — same rule as learnings');
  assert(env5.gs.scribeTrainerStatusFor_('canon', 0.5) === 'pending', 'a low-confidence canon candidate stays pending');
  assert(env5.gs.scribeTrainerStatusFor_('experiment', 0.99) === 'pending', 'an experiment is NEVER auto-applied, regardless of confidence (DI: "never auto-applied")');
  assert(env5.gs.scribeTrainerStatusFor_('fact_candidate', 0.99) === 'pending', 'a fact candidate is NEVER auto-applied — D2 does not exist yet, nothing could act on an approval');
}

console.log('\n[6] 0.75 runtime threshold (E4) — approved learnings/Canon only enter context above the cutoff…');
{
  const env6 = buildSandbox();
  env6.gs.setOne('cfbp_scribe_learnings', [
    { kind: 'learning', category: 'brevity', instruction: 'Prefer one sentence.', confidence: 0.8, status: 'approved' },
    { kind: 'learning', category: 'humor', instruction: 'Escalate via evidence.', confidence: 0.6, status: 'approved' },
    { kind: 'learning', category: 'frequency', instruction: 'Speak less.', confidence: 0.95, status: 'pending' },
  ]);
  env6.gs.setOne('cfbp_scribe_canon', [
    { canonId: 'c1', contextSummary: 'bad beat', preferredResponse: 'The sample is no longer preliminary.', confidence: 0.9, approvalStatus: 'approved' },
    { canonId: 'c2', contextSummary: 'low conf', preferredResponse: 'low conf line', confidence: 0.5, approvalStatus: 'approved' },
  ]);
  const text6a = env6.gs.scribeActiveLearningsText_();
  assert(text6a.includes('Prefer one sentence') && !text6a.includes('Escalate via evidence') && !text6a.includes('Speak less'),
    'only the approved AND >=0.75-confidence learning is included (below-threshold and pending-but-high-confidence are both excluded)');
  const text6b = env6.gs.scribeCanonExamplesText_();
  assert(text6b.includes('no longer preliminary') && !text6b.includes('low conf line'),
    'only the approved AND >=0.75-confidence Canon entry is included');
}

console.log('\n[7] Kill switch — scribeLearningsEnabled:false empties BOTH slots regardless of what qualifies…');
{
  const env7 = buildSandbox();
  env7.gs.setOne('cfbp_scribe_learnings', [{ kind: 'learning', category: 'brevity', instruction: 'Prefer one sentence.', confidence: 0.99, status: 'approved' }]);
  env7.gs.setOne('cfbp_scribe_canon', [{ canonId: 'c1', contextSummary: 'x', preferredResponse: 'y', confidence: 0.99, approvalStatus: 'approved' }]);
  assert(env7.gs.scribeActiveLearningsText_() !== '' && env7.gs.scribeCanonExamplesText_() !== '', 'fixture check: with the switch ON (default, missing value), both slots ARE populated');
  env7.gs.setOne('cfbp_settings', { scribeLearningsEnabled: false });
  assert(env7.gs.scribeActiveLearningsText_() === '', 'kill switch OFF empties the active-learnings slot even though a qualifying entry exists');
  assert(env7.gs.scribeCanonExamplesText_() === '', 'kill switch OFF empties the Canon slot too');
}

console.log('\n[8] Report §8 section order…');
{
  const env8 = buildSandbox();
  const dataset8 = { responsesEvaluated: 3, responsesWithRatings: 2, textFeedbackItems: 1, playerRewrites: 1, autonomousInterjections: 0 };
  const report8 = env8.gs.scribeTrainerAssembleReport_(trainerOutput().report, dataset8);
  assert(JSON.stringify(Object.keys(report8)) === JSON.stringify(['dataset', 'what_landed', 'what_missed', 'what_scribe_learned', 'changes_being_tested', 'feedback_not_adopted', 'what_we_need_more_data_on']),
    `report object keys are in the EXACT §8 order (got ${JSON.stringify(Object.keys(report8))})`);
  assert(/SCRIBE responses evaluated: 3/.test(report8.dataset), 'the dataset section is the deterministically COMPUTED line, never model-authored');
  assert(report8.what_landed === 'Short replies performed well.', 'the other six sections come straight from the model\'s structured output');
}

console.log("\n[9] Chat post author/notify/id — condensed report post is OUT OF CHARACTER, never author:'scribe'…");
{
  const env9 = buildSandbox();
  enableTrainer(env9);
  seedRatedWindow(env9);
  env9.setUrlFetchImpl(() => anthropicJsonResponse(trainerOutput()));
  const r9 = runTrainerAuthed(env9);
  assert(r9.ok === true, `runTrainer succeeds (error: ${r9.error})`);
  const msgSheet9 = env9.sheets['CFBP_MESSAGES'];
  const row9 = msgSheet9.data.find(r => r && String(r[1]).indexOf('sys_trainer_') === 0);
  assert(!!row9, 'a sys_trainer_<runId> row was appended to CFBP_MESSAGES');
  assert(row9[3] === 'message' && row9[4] === 'system', `type:'message', author:'system' — NEVER 'scribe' (got type=${row9[3]}, author=${row9[4]})`);
  const meta9 = JSON.parse(row9[9] || '{}');
  assert(meta9._n === 0, "notify:false is packed into meta._n === 0 (chatAppend's own convention)");
  assert(String(row9[6]).length <= 600, `chat summary body is <=600 chars (got ${String(row9[6]).length})`);
  assert(!/chart review|filed\.|permanent record/i.test(row9[6]), "the chat summary is NOT written in SCRIBE's in-character register");
  assert(/Rules tab/i.test(row9[6]), 'the chat summary links the player to the Rules tab for the full report');
}

console.log('\n[10] RG-10 for both new cards — negative test across week/games/players/settings…');
{
  const appMod = await import('./js/app.js');
  const storageMod = await import('./js/storage.js');

  const dataSection10 = appMod.renderScribeTrainerAdminSectionHTML();
  assert(/^\s*<div class="admin-section" data-comm-tab="data">/.test(dataSection10), 'renderScribeTrainerAdminSectionHTML() returns markup wrapped in data-comm-tab="data"');
  assert(!/data-comm-tab="(week|games|players|settings)"/.test(dataSection10), 'RG-10 negative: the card never ALSO tags itself onto week/games/players/settings');

  const rulesCardEmpty10 = appMod.renderScribeTrainingCardHTML();
  assert(/Nothing yet/.test(rulesCardEmpty10), 'empty-state copy renders when no report exists yet');
  assert(!/data-comm-tab/.test(rulesCardEmpty10), 'the Rules-page card carries NO data-comm-tab attribute at all — it is not a commissioner-panel surface');

  storageMod._setScribeReportsForTest([{
    runId: 'r1', createdAt: '2026-09-15T00:00:00.000Z',
    report: { dataset: 'x dataset', what_landed: 'y landed', what_missed: 'z missed', what_scribe_learned: 'a learned', changes_being_tested: 'b tested', feedback_not_adopted: 'c not adopted', what_we_need_more_data_on: 'd more data' },
    metrics: { humanMessagesPerInterjection: 4.2, ratingMix: { hit: 60, mid: 30, tooMuch: 10 }, rewriteCount: 2, perPlayerHints: ['Kevin: 3/4 ratings are Hit'], asOf: '2026-09-15T00:00:00.000Z' },
    counts: { newLearnings: 1, newCanon: 0, newExperiments: 0, newFactCandidates: 0, autoApproved: 0 },
  }]);
  const rulesCardFull10 = appMod.renderScribeTrainingCardHTML();
  assert(/Training Report/.test(rulesCardFull10) && /data-scribe-report-idx="0"/.test(rulesCardFull10), 'a real report renders a row keyed to its array index');

  const reportBody10 = appMod.renderScribeReportBodyHTML(storageMod.getScribeReports()[0]);
  const order10 = ['Dataset', 'What landed', 'What missed', 'What SCRIBE learned', 'Changes being tested', 'Feedback that was not adopted', 'What we need more data on'];
  let lastIdx10 = -1, inOrder10 = true;
  order10.forEach(label => { const i = reportBody10.indexOf(label); if (i === -1 || i < lastIdx10) inOrder10 = false; lastIdx10 = i; });
  assert(inOrder10, 'the rendered report body presents all seven §8 sections in the exact documented order');

  const dataSectionFull10 = appMod.renderScribeTrainerAdminSectionHTML();
  assert(/4\.20/.test(dataSectionFull10), 'the metrics card reads the STORED snapshot verbatim (4.20), never an independent recompute');
  assert(/as of/i.test(dataSectionFull10), 'the "as of" stamp is present — never implying live data');

  storageMod._setScribeReportsForTest([]);
}

console.log('\n[E4-client] getActiveContext() client mirror — status/confidence filter + kill switch, matching the server exactly…');
{
  const storageMod2 = await import('./js/storage.js');
  const scribeAgentMod = await import('./js/scribeAgent.js');
  storageMod2.setScribeLearnings([
    { kind: 'learning', category: 'brevity', instruction: 'x', confidence: 0.8, status: 'approved' },
    { kind: 'learning', category: 'humor', instruction: 'y', confidence: 0.5, status: 'approved' },
    { kind: 'experiment', experiment: 'z', reason: 'r', confidence: 0.99, status: 'pending' },
  ]);
  storageMod2.setScribeCanon([{ canonId: 'c1', contextSummary: 's', preferredResponse: 'p', confidence: 0.9, approvalStatus: 'approved' }]);
  storageMod2.saveSetting('scribeLearningsEnabled', true);
  const ctx = scribeAgentMod.getActiveContext();
  assert(ctx.activeLearnings.length === 1 && ctx.activeLearnings[0].category === 'brevity', 'client mirror includes only the approved, >=0.75-confidence learning (kind:"learning" only — experiments never leak in)');
  assert(ctx.canonExamples.length === 1, 'client mirror includes the approved, >=0.75-confidence Canon entry');
  storageMod2.saveSetting('scribeLearningsEnabled', false);
  const ctxOff = scribeAgentMod.getActiveContext();
  assert(ctxOff.activeLearnings.length === 0 && ctxOff.canonExamples.length === 0, 'client mirror kill switch empties both arrays, matching the server-side behavior exactly');
  storageMod2.saveSetting('scribeLearningsEnabled', true);
  storageMod2.setScribeLearnings([]); storageMod2.setScribeCanon([]);
}

console.log('\n[11] Cache breakpoint placement (F-F) — cache_control sits on the PERSONA block specifically, not "whichever renders last"…');
{
  const env11 = buildSandbox();
  const ctx11 = env11.gs.assembleScribeContext_({ playerId: 'p1', triggerBody: 'hi', triggerSeq: 1, gameTag: '', activeLearnings: 'LEARNING-MARKER', canonExamples: 'CANON-MARKER' });
  const lastBlock11 = ctx11.systemBlocks[ctx11.systemBlocks.length - 1];
  assert(lastBlock11.text.includes('CANON-MARKER'), 'fixture check: canonExamples really is the LAST block once populated (proves this test is non-vacuous)');
  assert(!lastBlock11.cache_control, 'cache_control is NOT on the last block once learnings/Canon are populated');
  const personaBlock11 = ctx11.systemBlocks.find(b => b.text === env11.gs.SCRIBE_SYSTEM_PROMPT_BASE);
  assert(!!personaBlock11 && personaBlock11.cache_control && personaBlock11.cache_control.type === 'ephemeral', 'cache_control sits on the PERSONA block specifically, regardless of what renders after it');
  const learningsBlock11 = ctx11.systemBlocks.find(b => b.text === 'LEARNING-MARKER');
  assert(!!learningsBlock11 && !learningsBlock11.cache_control, 'the activeLearnings block itself carries NO cache_control — it renders fresh, uncached, every call, so a Trainer-driven change never invalidates the persona prefix');
}

console.log('\n[12] Structural — no Trainer code path references docs/SCRIBE.md (GAS has no repo filesystem access)…');
{
  const groupEStart = codeGsSrc.indexOf("SCRIBE_LEARNINGS_KEY_ = 'cfbp_scribe_learnings'");
  assert(groupEStart > -1, 'fixture check: the Group E block marker is found in Code.gs');
  const groupESrc = codeGsSrc.slice(groupEStart);
  // EXECUTABLE lines only — same exclusion almatest.mjs's own settings
  // allow-list scan uses (`saveSetting` §16e): a comment EXPLAINING that
  // Trainer cannot touch docs/SCRIBE.md (this section has several, by
  // design — see the SCRIBE_TRAINER_PROMPT_BASE header) must not itself
  // trip a scan for a literal code-path reference. Both halves proven by
  // the canary immediately below.
  const groupEExecutableLines = groupESrc.split('\n').filter(l => {
    const t = l.trimStart();
    return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
  }).join('\n');
  assert(!/docs\/SCRIBE\.md/.test(groupEExecutableLines), 'no literal path reference to docs/SCRIBE.md on any EXECUTABLE line in the Group E (Trainer) code');
  assert(/docs\/SCRIBE\.md/.test(groupESrc), 'fixture check: the full (comment-inclusive) source DOES mention docs/SCRIBE.md somewhere — proves the exclusion above is narrow, not vacuously true from an absent string');
  assert(!/writeFile|DriveApp\.\w*[Ww]rite|DriveApp\.create/.test(groupESrc), 'no filesystem/Drive write API is ever called from the Group E block — structurally cannot write to the repo');
}

console.log('\n[13] Monthly cap shared — Trainer runs count against the SAME SCRIBE_MONTHLY_BUDGET_USD as mention/autonomous invocations…');
{
  const env13 = buildSandbox();
  enableTrainer(env13, { SCRIBE_MONTHLY_BUDGET_USD: 1 });
  seedRatedWindow(env13);   // enough data that ONLY the budget can be the reason it stops
  const logSheet13 = env13.gs.ensureScribeLogSheet();
  const monthKey13 = env13.gs.scribeMonthKey_();
  logSheet13.getRange(logSheet13.getLastRow() + 1, 1, 1, 17).setValues([[
    'priorMention', 'mention', 'claude-sonnet-5', monthKey13 + '-01T00:00:00.000Z', 500, 1, 0, true, 10000, 500, 5.00, 'scribe_llm_priorMention', '', 0, 0, 0, 0,
  ]]);
  const r13 = runTrainerAuthed(env13);
  assert(r13.ok === false && /budget/i.test(r13.error), 'a monthly spend already over budget from a MENTION invocation blocks the NEXT Trainer run — one shared meter, not two');
}

console.log('\n[14] Mutation-prove — the >=0.9 auto-apply gate…');
{
  const marker14a = "return (Number(confidence) >= SCRIBE_LEARNING_AUTO_APPROVE_THRESHOLD_) ? 'approved' : 'pending';";
  assert(codeGsSrc.includes(marker14a), 'fixture check: the exact auto-apply gate line exists in the real source');
  const mutated14a = codeGsSrc.replace(marker14a, "return 'approved';   // MUTATED OUT FOR TEST");
  assert(mutated14a !== codeGsSrc, 'fixture check: the mutation changed the (in-memory) source string');

  const realEnv14a = buildSandbox();
  assert(realEnv14a.gs.scribeTrainerStatusFor_('learning', 0.1) === 'pending', 'REAL Code.gs: a 0.1-confidence learning is correctly pending');

  const mutEnv14a = buildSandbox(mutated14a);
  assert(mutEnv14a.gs.scribeTrainerStatusFor_('learning', 0.1) === 'approved', 'MUTATION CANARY: with the gate short-circuited on a SCRATCH source string, a 0.1-confidence learning wrongly auto-approves — the guard is capable of failing, this is a real test');
}

console.log('\n[14b] Mutation-prove — the kill switch (scribeLearningsEnabled)…');
{
  const marker14b = 'return settings.scribeLearningsEnabled !== false;   // CONVENTIONS #10 — missing value reads as ON';
  assert(codeGsSrc.includes(marker14b), 'fixture check: the exact kill-switch line exists in the real source');
  const mutated14b = codeGsSrc.replace(marker14b, 'return true;   // MUTATED OUT FOR TEST');
  assert(mutated14b !== codeGsSrc, 'fixture check: the mutation changed the (in-memory) source string');

  function seedApprovedLearning(env) {
    env.gs.setOne('cfbp_scribe_learnings', [{ kind: 'learning', category: 'brevity', instruction: 'x', confidence: 0.99, status: 'approved' }]);
    env.gs.setOne('cfbp_settings', { scribeLearningsEnabled: false });
  }

  const realEnv14b = buildSandbox();
  seedApprovedLearning(realEnv14b);
  assert(realEnv14b.gs.scribeActiveLearningsText_() === '', 'REAL Code.gs: kill switch OFF correctly empties the slot');

  const mutEnv14b = buildSandbox(mutated14b);
  seedApprovedLearning(mutEnv14b);
  assert(mutEnv14b.gs.scribeActiveLearningsText_() !== '', 'MUTATION CANARY: with the kill-switch check short-circuited on a SCRATCH source string, the slot wrongly stays populated even with the switch off — the guard is capable of failing, this is a real test');

  const reread14 = await readFile(fileURLToPath(new URL('./backend/Code.gs', import.meta.url)), 'utf8');
  assert(reread14 === codeGsSrc, 'the real backend/Code.gs file on disk is BYTE-IDENTICAL to what this section started with — never opened for writing (both mutations above were scratch in-memory strings only)');
}

console.log("\n[15] BLOCK #1 — the Trainer prompt is actually REACHED on the trainer code path (it was dead code)…");
{
  const env15 = buildSandbox();
  enableTrainer(env15);
  seedRatedWindow(env15);
  let captured15 = null;
  env15.setUrlFetchImpl((url, opts) => { captured15 = JSON.parse(opts.payload); return anthropicJsonResponse(trainerOutput()); });
  const r15 = runTrainerAuthed(env15);
  assert(r15.ok === true && !r15.skipped, `fixture check: the run actually happened (error: ${r15.error}, skipped: ${r15.skipped})`);
  assert(captured15 !== null, 'fixture check: a real outbound Anthropic request was captured');

  const systemText15 = captured15.system.map(b => b.text).join('\n');
  // Trainer-only markers — these strings exist ONLY in SCRIBE_TRAINER_PROMPT_BASE.
  assert(systemText15.includes('SCRIBE Trainer is not SCRIBE.'),
    "the outbound system prompt carries the Trainer base (SCRIBE-TRAINER.md §1's own opening line)");
  assert(systemText15.includes('# Runtime Addendum (Trainer, backend/Code.gs)'),
    'the outbound system prompt carries the Trainer RUNTIME ADDENDUM, not just the ported doc');
  assert(systemText15.includes('Output ONLY the structured JSON object the response schema specifies'),
    'a real addendum body is present, not just its heading');
  // Persona markers — these exist ONLY in SCRIBE_SYSTEM_PROMPT_BASE.
  assert(!systemText15.includes('# 4. Voice'),
    "the persona's VOICE section is absent from a trainer invocation (this is the exact assertion that was failing before the fix)");
  assert(!systemText15.includes('What SCRIBE sounds like'),
    "no part of the persona's voice specification reaches the Trainer");
  assert(!systemText15.includes(env15.gs.SCRIBE_SYSTEM_PROMPT_BASE),
    'the persona prompt is not embedded anywhere in the trainer request');

  assert(captured15.system.length === 2, `exactly two system blocks — safety + Trainer base (got ${captured15.system.length})`);
  assert(/SAFETY \(non-negotiable/.test(captured15.system[0].text), 'block 1 is the Trainer safety block, first');
  assert(!captured15.system.some(b => b.cache_control),
    'NO cache_control on the trainer path — a weekly run can never hit a 5-minute cache TTL, so a cache write would be pure cost');

  // No learnings/Canon/boundaries slots, and no recent-chat block.
  assert(!/ACTIVE LEARNINGS|CANON \(demonstrated/.test(systemText15),
    'no activeLearnings/canonExamples slots on the trainer path — Trainer PROPOSES those, it must not be instructed by them');
  const userText15 = captured15.messages[0].content;
  assert(!/RECENT ROOM CONTEXT/.test(userText15),
    'no recent-chat block — the whole analysis window is already assembled deterministically and passed in');
  assert(/=== SCRIBE TRAINER ANALYSIS INPUT ===/.test(userText15),
    'the user message IS the deterministic analysis input, nothing else');
}

console.log("\n[16] BLOCK #1 — the MENTION path is unchanged: persona in, Trainer text out…");
{
  const env16 = buildSandbox();
  enableTrainer(env16);
  appendMsgRow(env16.gs.ensureMsgSheet(), { id: 'trig16', author: 'p1', body: '@scribe who is leading?' });
  let captured16 = null;
  env16.setUrlFetchImpl((url, opts) => {
    captured16 = JSON.parse(opts.payload);
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ content: [{ type: 'text', text: 'Kihoon.' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } }) };
  });
  const r16 = env16.gs.scribeAsk({ triggerMessageId: 'trig16', playerId: 'p1' });
  assert(r16.ok === true && !!r16.responseMessageId, `fixture check: the mention path actually ran (${JSON.stringify(r16)})`);
  const systemText16 = captured16.system.map(b => b.text).join('\n');
  assert(systemText16.includes('# 4. Voice') && systemText16.includes('What SCRIBE sounds like'),
    "a mention invocation still loads the full persona, voice section included");
  assert(!systemText16.includes('SCRIBE Trainer is not SCRIBE.'),
    'a mention invocation carries NO Trainer text at all');
  assert(!systemText16.includes('# Runtime Addendum (Trainer, backend/Code.gs)'),
    "the Trainer addendum never leaks into a player-facing reply's prompt");
  assert(captured16.max_tokens === 1024, `the mention path keeps its own small budget (got ${captured16.max_tokens}), unaffected by Trainer's 4096`);
  assert(captured16.system.some(b => b.cache_control && b.cache_control.type === 'ephemeral'),
    'the mention path still sets its cache breakpoint (F-F) — untouched by this change');
}

console.log("\n[16b] Mutation-prove — remove the invocationType branch and the Trainer prompt goes back to being dead code…");
{
  const marker16 = "  if (opts.invocationType === 'trainer') return assembleTrainerContext_(opts);";
  assert(codeGsSrc.includes(marker16), 'fixture check: the invocationType selector line exists in the real source');
  const mutated16 = codeGsSrc.replace(marker16, '  // MUTATED OUT FOR TEST');
  assert(mutated16 !== codeGsSrc, 'fixture check: the mutation changed the (in-memory) source string');

  const mutEnv16 = buildSandbox(mutated16);
  enableTrainer(mutEnv16);
  seedRatedWindow(mutEnv16);
  let capturedMut16 = null;
  mutEnv16.setUrlFetchImpl((url, opts) => { capturedMut16 = JSON.parse(opts.payload); return anthropicJsonResponse(trainerOutput()); });
  const hashMut16 = seedCommissionerPassword(mutEnv16);
  mutEnv16.gs.runTrainer({ adminPasswordHash: hashMut16 });
  const mutSystem16 = capturedMut16.system.map(b => b.text).join('\n');
  assert(mutSystem16.includes('# 4. Voice') && !mutSystem16.includes('SCRIBE Trainer is not SCRIBE.'),
    'MUTATION CANARY: with the selector removed, a Trainer run reverts to sending the PERSONA and never sends the Trainer prompt — exactly the shipped defect this section exists to prevent recurring');
}

console.log("\n[17] BLOCK #2 — drift guard: SCRIBE_TRAINER_PROMPT_BASE matches SCRIBE-TRAINER.md v1.0 + a real addendum…");
{
  const env17 = buildSandbox();
  const promptBase17 = env17.gs.SCRIBE_TRAINER_PROMPT_BASE;
  assert(typeof promptBase17 === 'string' && promptBase17.length > 1000, 'fixture check: SCRIBE_TRAINER_PROMPT_BASE loaded as a real, substantial string from the sandbox');

  const addendumIdx17 = promptBase17.indexOf('# Runtime Addendum');
  assert(addendumIdx17 > 0, 'fixture check: the runtime addendum marker exists in the embedded Trainer prompt');
  assert(promptBase17.length - addendumIdx17 > 200, 'fixture check: a real addendum body follows the marker, not just the heading');
  const docPortion17 = promptBase17.slice(0, addendumIdx17);

  // The source of truth is the WORKING DESIGN DOC this was ported from —
  // there is no docs/SCRIBE-TRAINER.md. Same normalization as scribetest [19].
  const trainerDocPath = fileURLToPath(new URL('../weekly bug fixes and feedback/Chat SCRIBE updates 090526/SCRIBE-TRAINER.md', import.meta.url));
  const trainerDocSrc = await readFile(trainerDocPath, 'utf8');
  const norm17 = str => str.split('\n').map(l => l.trim()).filter(Boolean).join('\n');
  const normDoc17 = norm17(trainerDocSrc), normEmbedded17 = norm17(docPortion17);
  assert(normDoc17 === normEmbedded17,
    normDoc17 === normEmbedded17
      ? 'embedded snapshot matches SCRIBE-TRAINER.md v1.0 — no drift'
      : "DRIFT DETECTED: backend/Code.gs's SCRIBE_TRAINER_PROMPT_BASE no longer matches SCRIBE-TRAINER.md. Whoever edited that doc must hand-update the embedded snapshot in backend/Code.gs (search \"SCRIBE_TRAINER_PROMPT_BASE\") to match — GAS cannot import the doc at runtime.");

  const tampered17 = trainerDocSrc.replace('Core Identity', 'Core IdentityXYZ');
  assert(tampered17 !== trainerDocSrc, 'fixture check: the tamper string was actually applied');
  assert(norm17(tampered17) !== normEmbedded17, 'canary: a real one-word content change IS caught by this comparison — the guard is not vacuous');

  // THE OTHER HALF OF THE CLASS RULE. A drift guard on a constant that no
  // code path loads is a guard on dead code — which is precisely what this
  // file shipped last round. [15] proves reachability behaviourally; this is
  // the same claim restated here so the two halves live together.
  const env17b = buildSandbox();
  const trainerCtx17 = env17b.gs.assembleScribeContext_({ invocationType: 'trainer', triggerBody: 'INPUT', playerId: 'system', gameTag: '' });
  assert(trainerCtx17.systemBlocks.some(b => b.text === promptBase17),
    'REACHABILITY: assembleScribeContext_({invocationType:"trainer"}) returns the guarded snapshot itself — the drift guard above protects a LIVE constant, not dead code');
}

console.log("\n[18] BLOCK #3 — SCRIBE_TRAINER_ENABLED + SCRIBE_INTERACTIVE_ENABLED both gate the run…");
{
  // (a) Trainer switch missing entirely -> default FALSE.
  const env18a = buildSandbox();
  env18a.props.ANTHROPIC_API_KEY = 'test-key';
  env18a.props.SCRIBE_INTERACTIVE_ENABLED = 'true';
  seedRatedWindow(env18a);
  const r18a = runTrainerAuthed(env18a);
  assert(r18a.ok === true && r18a.skipped === 'disabled_trainer', `a MISSING SCRIBE_TRAINER_ENABLED defaults to OFF (got ${JSON.stringify(r18a)})`);
  assert(env18a.urlFetchCalls.length === 0, 'zero Anthropic calls — no spend');
  const msgSheet18a = env18a.sheets['CFBP_MESSAGES'];
  assert(!msgSheet18a || !msgSheet18a.data.some(r => r && String(r[1]).indexOf('sys_trainer_') === 0), 'no chat post');
  assert(env18a.gs.scribeLoadReports_().length === 0, 'no report appended');
  const logRows18a = env18a.sheets['CFBP_SCRIBE_LOG'].data.filter(r => r && String(r[0]).indexOf('trainer_skipped_') === 0);
  assert(logRows18a.length === 1 && String(logRows18a[0][12]).indexOf('skipped:disabled_trainer') === 0 && logRows18a[0][1] === 'trainer',
    `exactly one skipped row logged, invocationType:'trainer' (got ${JSON.stringify(logRows18a.map(r => [r[1], r[12]]))})`);

  // (b) Explicit 'false' and (c) a garbage value both fail CLOSED.
  const env18b = buildSandbox();
  env18b.props.ANTHROPIC_API_KEY = 'test-key';
  env18b.props.SCRIBE_INTERACTIVE_ENABLED = 'true';
  env18b.props.SCRIBE_TRAINER_ENABLED = 'false';
  seedRatedWindow(env18b);
  assert(runTrainerAuthed(env18b).skipped === 'disabled_trainer', "explicit 'false' reads as disabled");
  env18b.props.SCRIBE_TRAINER_ENABLED = 'nonsense';
  assert(env18b.gs.runTrainerPass_({ source: 'manual' }).skipped === 'disabled_trainer', 'a garbage value fails CLOSED, not open');

  // (d) Trainer ON but SCRIBE globally OFF -> still no run.
  const env18d = buildSandbox();
  env18d.props.ANTHROPIC_API_KEY = 'test-key';
  env18d.props.SCRIBE_TRAINER_ENABLED = 'true';
  env18d.props.SCRIBE_INTERACTIVE_ENABLED = 'false';
  seedRatedWindow(env18d);
  const r18d = runTrainerAuthed(env18d);
  assert(r18d.ok === true && r18d.skipped === 'disabled_interactive', `SCRIBE_INTERACTIVE_ENABLED=false is a GLOBAL stop on Trainer too (got ${JSON.stringify(r18d)})`);
  assert(env18d.urlFetchCalls.length === 0, 'zero Anthropic calls on the global stop either');

  // (e) The SCHEDULED entry honours both switches — it does not bypass them.
  const env18e = buildSandbox();
  env18e.props.ANTHROPIC_API_KEY = 'test-key';
  seedRatedWindow(env18e);
  env18e.gs.runTrainerScheduled_();
  assert(env18e.urlFetchCalls.length === 0, 'the weekly trigger spends nothing while the switches are off');
  assert(env18e.sheets['CFBP_SCRIBE_LOG'].data.some(r => r && String(r[12]).indexOf('skipped:disabled_trainer') === 0 && String(r[12]).indexOf('source:scheduled') > -1),
    "the scheduled skip is logged with source:'scheduled', distinguishable from a manual one");

  // (f) Both ON -> a real run.
  const env18f = buildSandbox();
  enableTrainer(env18f);
  seedRatedWindow(env18f);
  env18f.setUrlFetchImpl(() => anthropicJsonResponse(trainerOutput()));
  assert(runTrainerAuthed(env18f).ok === true, 'with BOTH switches on, the run proceeds normally');
  assert(env18f.urlFetchCalls.length === 1, 'exactly one Anthropic call for one run');
}

console.log("\n[18b] Mutation-prove — the SCRIBE_TRAINER_ENABLED gate…");
{
  const marker18 = "function scribeTrainerEnabled_() {\n  var raw = PropertiesService.getScriptProperties().getProperty('SCRIBE_TRAINER_ENABLED');\n  return String(raw || '').trim().toLowerCase() === 'true';\n}";
  assert(codeGsSrc.includes(marker18), 'fixture check: the exact kill-switch reader exists in the real source');
  const mutated18 = codeGsSrc.replace(marker18, 'function scribeTrainerEnabled_() {\n  return true;   // MUTATED OUT FOR TEST\n}');
  assert(mutated18 !== codeGsSrc, 'fixture check: the mutation changed the (in-memory) source string');

  const mutEnv18 = buildSandbox(mutated18);
  mutEnv18.props.ANTHROPIC_API_KEY = 'test-key';
  mutEnv18.props.SCRIBE_INTERACTIVE_ENABLED = 'true';
  seedRatedWindow(mutEnv18);
  mutEnv18.setUrlFetchImpl(() => anthropicJsonResponse(trainerOutput()));
  const rMut18 = runTrainerAuthed(mutEnv18);
  assert(rMut18.ok === true && !rMut18.skipped && mutEnv18.urlFetchCalls.length === 1,
    'MUTATION CANARY: with the switch forced open on a SCRATCH source string, a run with NO SCRIBE_TRAINER_ENABLED set spends money — the guard is capable of failing, this is a real test');
}

console.log("\n[19] BLOCK #4 — insufficient-data no-op: no model call, no post, no report, and (round 3) the cursor is HELD so thin windows POOL…");
{
  const env19 = buildSandbox();
  enableTrainer(env19);
  const s19 = env19.gs.ensureMsgSheet();
  // Two rated responses — one BELOW the N=3 floor.
  for (let i = 0; i < 2; i++) {
    appendMsgRow(s19, { id: 'thin' + i, author: 'scribe', body: 'line ' + i });
    appendMsgRow(s19, { id: 'thinfb' + i, type: 'feedback', author: 'p1', targetId: 'thin' + i, meta: { category: 'rating', value: 'hit' } });
  }
  const headBefore19 = env19.gs.scribeTrainerReadAllSince_(0).newCursor;
  const r19 = runTrainerAuthed(env19);
  assert(r19.ok === true && r19.skipped === 'insufficient_data', `2 rated responses is under the floor of 3 -> skipped (got ${JSON.stringify(r19)})`);
  assert(r19.ratedResponses === 2 && r19.threshold === 3, 'the skip reports the actual count and the threshold it failed');
  assert(env19.urlFetchCalls.length === 0, 'NO model call');
  assert(!env19.sheets['CFBP_MESSAGES'].data.some(r => r && String(r[1]).indexOf('sys_trainer_') === 0), 'NO chat post');
  assert(env19.gs.scribeLoadReports_().length === 0, 'NO report appended');
  assert(env19.gs.scribeLoadLearnings_().length === 0 && env19.gs.scribeLoadCanon_().length === 0, 'nothing persisted to the learnings/Canon keys');
  assert(env19.sheets['CFBP_SCRIBE_LOG'].data.some(r => r && String(r[12]).indexOf('skipped:insufficient_data') === 0 && r[1] === 'trainer'),
    "a skipped row is logged with invocationType:'trainer' and skipped:'insufficient_data'");
  // ── ROUND-3 REVERSAL (reviewer ruling) — the cursor is HELD, not advanced.
  // Round 2 advanced it to stop a quiet window "accumulating into an
  // unbounded re-read"; the read is already bounded by
  // SCRIBE_TRAINER_MAX_PAGES_ (50 × 1,000 events) and this is a six-person
  // league, so that risk was theoretical while the cost was not: advancing
  // DISCARDED the one or two rated responses a thin window did contain, so
  // two consecutive 2-rating weeks analyzed nothing forever instead of
  // analyzing 4. Reversible — flagged to Drew as a one-line tradeoff.
  assert(env19.gs.scribeTrainerCursor_() === 0 && headBefore19 > 0,
    `the cursor does NOT advance past a window that was never analyzed (got ${env19.gs.scribeTrainerCursor_()}, expected 0; the window head was ${headBefore19})`);
  assert(r19.cursorHeld === true && r19.cursor === 0,
    `the skip REPORTS the hold rather than leaving the caller to infer it (got ${JSON.stringify(r19)})`);

  // Pooling, end to end — the whole reason for holding. One more rated
  // response arrives and the next pass sees THREE: the two the thin window
  // already had, plus the new one.
  appendMsgRow(s19, { id: 'thin2', author: 'scribe', body: 'line 2' });
  appendMsgRow(s19, { id: 'thinfb2', type: 'feedback', author: 'p1', targetId: 'thin2', meta: { category: 'rating', value: 'hit' } });
  let pooled19 = null;
  env19.setUrlFetchImpl((url, opts) => { pooled19 = JSON.parse(opts.payload); return anthropicJsonResponse(trainerOutput()); });
  const r19d = env19.gs.runTrainerPass_({ source: 'manual' });
  assert(r19d.ok === true && !r19d.skipped,
    `the NEXT pass clears the floor on the pooled window (got ${JSON.stringify(r19d.skipped || r19d.error || 'ok')})`);
  assert(/3 of them rated by at least one player/.test(pooled19.messages[0].content),
    'and it analyzes all THREE rated responses — the thin window\'s two are carried forward, which is exactly what advancing the cursor destroyed');
  assert(env19.gs.scribeTrainerCursor_() > 0,
    'a SUCCESSFUL pass still advances the cursor — only the data-volume skip holds it (a kill-switch skip returns before any read at all, so it has no cursor to hold)');

  // A third rated response clears the floor.
  const env19b = buildSandbox();
  enableTrainer(env19b);
  seedRatedWindow(env19b, 3);
  env19b.setUrlFetchImpl(() => anthropicJsonResponse(trainerOutput()));
  const r19b = runTrainerAuthed(env19b);
  assert(r19b.ok === true && !r19b.skipped, `exactly 3 distinct rated responses clears the floor (>= not >) — got ${JSON.stringify(r19b.skipped)}`);

  // Zero data at all — the degenerate case the reviewer named directly.
  const env19c = buildSandbox();
  enableTrainer(env19c);
  env19c.gs.ensureMsgSheet();
  const r19c = runTrainerAuthed(env19c);
  assert(r19c.skipped === 'insufficient_data' && env19c.urlFetchCalls.length === 0,
    'a window with ZERO SCRIBE responses and ZERO feedback events spends nothing');
}

console.log("\n[20] SIGNIFICANT #5 — E4 end-to-end: an approved >=0.75 learning reaches a MENTION's outbound system blocks…");
{
  const env20 = buildSandbox();
  enableTrainer(env20);
  appendMsgRow(env20.gs.ensureMsgSheet(), { id: 'trig20', author: 'p1', body: '@scribe who is leading?' });
  env20.gs.setOne('cfbp_scribe_learnings', [
    { kind: 'learning', category: 'brevity', instruction: 'APPROVED-LEARNING-MARKER', confidence: 0.8, status: 'approved' },
    { kind: 'learning', category: 'humor', instruction: 'PENDING-LEARNING-MARKER', confidence: 0.99, status: 'pending' },
    { kind: 'learning', category: 'frequency', instruction: 'LOWCONF-LEARNING-MARKER', confidence: 0.5, status: 'approved' },
  ]);
  env20.gs.setOne('cfbp_scribe_canon', [
    { canonId: 'c1', contextSummary: 'x', relevantFacts: 'y', preferredResponse: 'APPROVED-CANON-MARKER', whyItWorked: 'w', pattern: 'p', confidence: 0.9, approvalStatus: 'approved' },
    { canonId: 'c2', contextSummary: 'x', relevantFacts: 'y', preferredResponse: 'PENDING-CANON-MARKER', whyItWorked: 'w', pattern: 'p', confidence: 0.99, approvalStatus: 'pending' },
  ]);
  let captured20 = null;
  env20.setUrlFetchImpl((url, opts) => {
    captured20 = JSON.parse(opts.payload);
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ content: [{ type: 'text', text: 'Kihoon.' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } }) };
  });
  const r20 = env20.gs.scribeAsk({ triggerMessageId: 'trig20', playerId: 'p1' });
  assert(r20.ok === true && !!r20.responseMessageId, `fixture check: scribeAsk actually completed (${JSON.stringify(r20)})`);
  const systemText20 = captured20.system.map(b => b.text).join('\n');
  assert(systemText20.includes('APPROVED-LEARNING-MARKER'), 'an APPROVED, >=0.75-confidence learning reaches the real outbound request');
  assert(!systemText20.includes('PENDING-LEARNING-MARKER'), 'a PENDING learning never reaches it, even at 0.99 confidence');
  assert(!systemText20.includes('LOWCONF-LEARNING-MARKER'), 'an approved-but-below-0.75 learning never reaches it either');
  assert(systemText20.includes('APPROVED-CANON-MARKER') && !systemText20.includes('PENDING-CANON-MARKER'), 'the same gate holds for Canon entries, end to end');

  // Kill switch, end to end through the same real call path.
  const env20b = buildSandbox();
  enableTrainer(env20b);
  appendMsgRow(env20b.gs.ensureMsgSheet(), { id: 'trig20b', author: 'p1', body: '@scribe hi' });
  env20b.gs.setOne('cfbp_scribe_learnings', [{ kind: 'learning', category: 'brevity', instruction: 'APPROVED-LEARNING-MARKER', confidence: 0.99, status: 'approved' }]);
  env20b.gs.setOne('cfbp_settings', { scribeLearningsEnabled: false });
  let captured20b = null;
  env20b.setUrlFetchImpl((url, opts) => {
    captured20b = JSON.parse(opts.payload);
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: {} }) };
  });
  env20b.gs.scribeAsk({ triggerMessageId: 'trig20b', playerId: 'p1' });
  assert(!captured20b.system.map(b => b.text).join('\n').includes('APPROVED-LEARNING-MARKER'),
    'with scribeLearningsEnabled:false, nothing reaches the outbound request — the kill switch works at the WIRE, not just in the helper');
}

console.log("\n[20b] Mutation-prove — drop the activeLearnings argument at the scribeAsk call site…");
{
  const marker20 = "    activeLearnings: scribeActiveLearningsText_(), canonExamples: scribeCanonExamplesText_(),";
  assert(codeGsSrc.includes(marker20), 'fixture check: the E4 wire at the scribeAsk call site exists in the real source');
  const mutated20 = codeGsSrc.replace(marker20, '    canonExamples: scribeCanonExamplesText_(),   // activeLearnings MUTATED OUT FOR TEST');
  assert(mutated20 !== codeGsSrc, 'fixture check: the mutation changed the (in-memory) source string');

  const mutEnv20 = buildSandbox(mutated20);
  enableTrainer(mutEnv20);
  appendMsgRow(mutEnv20.gs.ensureMsgSheet(), { id: 'trigM20', author: 'p1', body: '@scribe hi' });
  mutEnv20.gs.setOne('cfbp_scribe_learnings', [{ kind: 'learning', category: 'brevity', instruction: 'APPROVED-LEARNING-MARKER', confidence: 0.9, status: 'approved' }]);
  let capturedM20 = null;
  mutEnv20.setUrlFetchImpl((url, opts) => {
    capturedM20 = JSON.parse(opts.payload);
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: {} }) };
  });
  mutEnv20.gs.scribeAsk({ triggerMessageId: 'trigM20', playerId: 'p1' });
  assert(!capturedM20.system.map(b => b.text).join('\n').includes('APPROVED-LEARNING-MARKER'),
    'MUTATION CANARY: with the argument dropped on a SCRATCH source string, the approved learning silently stops reaching the model while every helper-level test still passes — exactly the gap this end-to-end assertion closes');
}

console.log("\n[21] SIGNIFICANT #6 — the cursor advance is asserted AT THE CALL SITE, after a real runTrainer pass…");
{
  const env21 = buildSandbox();
  enableTrainer(env21);
  seedRatedWindow(env21, 3);
  env21.setUrlFetchImpl(() => anthropicJsonResponse(trainerOutput()));
  const expected21 = env21.gs.scribeTrainerReadAllSince_(0).newCursor;
  assert(env21.gs.scribeTrainerCursor_() === 0, 'fixture check: the cursor starts at 0');
  const r21 = runTrainerAuthed(env21);
  assert(r21.ok === true && !r21.skipped, `fixture check: a real run happened (${JSON.stringify(r21.skipped || r21.error || 'ok')})`);
  assert(env21.gs.scribeTrainerCursor_() === expected21 && expected21 > 0,
    `after the run, lastTrainerRunSeq equals the read's newCursor (got ${env21.gs.scribeTrainerCursor_()}, expected ${expected21})`);

  // A second immediate run reads ONLY the new range. Note the cursor
  // deliberately lands on the last seq ANALYZED, not on the sheet head after
  // the run — so Trainer's own report post (appended after the read) falls
  // into the next window. That is correct and intentional: anything appended
  // DURING the ~20s model call must not be skipped, and a system-authored row
  // is excluded from every metric anyway (scribeTrainerComputeMetrics_).
  appendMsgRow(env21.gs.ensureMsgSheet(), { id: 'after21', author: 'p2', body: 'new traffic' });
  const secondRead21 = env21.gs.scribeTrainerReadAllSince_(env21.gs.scribeTrainerCursor_());
  const ids21 = secondRead21.events.map(e => e.id);
  assert(secondRead21.events.every(e => e.seq > expected21),
    `every event in the second read is strictly past the cursor — no re-read of the analyzed window (got ${JSON.stringify(ids21)})`);
  assert(ids21.includes('after21'), 'the newly-appended message IS in the second read');
  assert(!ids21.includes('sr0') && !ids21.includes('fbr0'),
    'none of the already-analyzed events are read again — the whole point of the cursor');
  assert(ids21.filter(id => id.indexOf('sys_trainer_') === 0).length === 1,
    "the one extra event is Trainer's OWN report post, appended after the read — documented above, and inert (author:'system')");
}

console.log("\n[21b] Mutation-prove — drop the cursor advance…");
{
  const marker21 = "  scribeTrainerAdvanceCursor_(read.newCursor);\n\n  finalizeFields.success = true;";
  assert(codeGsSrc.includes(marker21), 'fixture check: the post-run cursor advance exists in the real source');
  const mutated21 = codeGsSrc.replace(marker21, '  // MUTATED OUT FOR TEST\n\n  finalizeFields.success = true;');
  assert(mutated21 !== codeGsSrc, 'fixture check: the mutation changed the (in-memory) source string');

  const mutEnv21 = buildSandbox(mutated21);
  enableTrainer(mutEnv21);
  seedRatedWindow(mutEnv21, 3);
  mutEnv21.setUrlFetchImpl(() => anthropicJsonResponse(trainerOutput()));
  const rMut21 = runTrainerAuthed(mutEnv21);
  assert(rMut21.ok === true, 'fixture check: the mutated run still "succeeds" — which is the whole hazard');
  assert(mutEnv21.gs.scribeTrainerCursor_() === 0,
    'MUTATION CANARY: with the advance removed on a SCRATCH source string, the cursor never moves and every later run re-analyzes (and re-pays for) the entire history — the guard is capable of failing');
}

console.log("\n[22] SIGNIFICANT #7 — fact_candidates are grounded in the 📌 remember_this source set…");
{
  const env22 = buildSandbox();
  enableTrainer(env22);
  env22.gs.setOne('cfbp_players', [{ playerId: 'p1', displayName: 'Kevin' }, { playerId: 'p2', displayName: 'Koby' }]);
  const s22 = env22.gs.ensureMsgSheet();
  seedRatedWindow(env22, 3);
  appendMsgRow(s22, { id: 'src22', author: 'p2', body: 'I only bet unders on Big Ten night games.' });
  appendMsgRow(s22, { id: 'flag22', type: 'feedback', author: 'p1', targetId: 'src22', meta: { category: 'remember_this', value: true } });
  appendMsgRow(s22, { id: 'unflagged22', author: 'p2', body: 'Nobody flagged this one.' });

  let captured22 = null;
  env22.setUrlFetchImpl((url, opts) => {
    captured22 = JSON.parse(opts.payload);
    return anthropicJsonResponse(trainerOutput({
      fact_candidates: [
        { playerId: 'p2', key: 'betting_habit', value: 'unders on Big Ten night games', confidence: 0.8, sourceMessageId: 'src22' },
        { playerId: 'p2', key: 'invented', value: 'hallucinated fact', confidence: 0.95, sourceMessageId: 'unflagged22' },
        { playerId: 'p2', key: 'invented2', value: 'fully made up id', confidence: 0.95, sourceMessageId: 'no_such_message' },
      ],
    }));
  });
  const r22 = runTrainerAuthed(env22);
  assert(r22.ok === true && !r22.skipped, `fixture check: a real run happened (${JSON.stringify(r22.skipped || r22.error || 'ok')})`);

  const userText22 = captured22.messages[0].content;
  assert(/FACT-CANDIDATE SOURCE SET/.test(userText22), 'the Trainer input declares an explicit fact-candidate source set');
  assert(userText22.includes('id=src22') && /Big Ten night games/.test(userText22), 'the flagged message is supplied by id AND body');
  assert(/flagged by Kevin/.test(userText22) && /said by Koby/.test(userText22), 'the flagging player and the speaker are both named, by display name');
  assert(!userText22.includes('id=unflagged22'), 'an UNflagged message is not offered as a source');

  const facts22 = env22.gs.scribeLoadLearnings_().filter(l => l.kind === 'fact_candidate');
  assert(facts22.length === 1 && facts22[0].sourceMessageId === 'src22',
    `only the grounded candidate is persisted (got ${facts22.length}: ${JSON.stringify(facts22.map(f => f.sourceMessageId))})`);
  assert(facts22.every(f => f.status === 'pending'), 'the surviving fact candidate is still PENDING regardless of confidence (D-4)');
  assert(r22.counts.droppedFactCandidates === 2 && r22.counts.factSourceSetSize === 1,
    `the run REPORTS the two dropped candidates rather than swallowing them (got ${JSON.stringify(r22.counts)})`);

  // Empty source set -> nothing can be grounded, and the prompt says so.
  const env22b = buildSandbox();
  enableTrainer(env22b);
  seedRatedWindow(env22b, 3);
  let captured22b = null;
  env22b.setUrlFetchImpl((url, opts) => {
    captured22b = JSON.parse(opts.payload);
    return anthropicJsonResponse(trainerOutput({ fact_candidates: [{ playerId: 'p1', key: 'k', value: 'v', confidence: 0.99, sourceMessageId: 'anything' }] }));
  });
  const r22b = runTrainerAuthed(env22b);
  assert(/return an EMPTY fact_candidates array/.test(captured22b.messages[0].content), 'with no flags in the window the prompt explicitly asks for an empty array');
  assert(env22b.gs.scribeLoadLearnings_().filter(l => l.kind === 'fact_candidate').length === 0 && r22b.counts.droppedFactCandidates === 1,
    'and a candidate produced anyway is dropped, not stored');

}

console.log("\n[22c] ROUND-3 BLOCK — the remember_this CLEAR contract, tested against the ACTUAL producing call site…");
{
  // NEW PROTOCOL, and the reason this section exists: a SERVER consumer of a
  // CLIENT-produced event shape is tested against the shape the producing
  // CALL SITE really emits — never against the shape the server's own
  // comment assumed. Round 2's source set was built against an invented
  // contract and every assertion below would have failed in production.
  //
  // The one and only producer of a `remember_this` event is
  // js/chat-ui.js:1003 —
  //
  //     recordFeedback({ targetId: mid, category: 'remember_this',
  //                      value: !mineNow.remember_this, author: self });
  //
  // — a BOOLEAN TOGGLE. Un-flagging emits `value:false`. It NEVER emits
  // `null`. Round 2's server code treated `null` as the only clear and made
  // a clear STICKY, so it (1) kept mining messages whose consent had been
  // withdrawn, (2) ADMITTED a message that had only ever been `false`, and
  // (3) ignored a re-flag forever.
  const env22c = buildSandbox();
  env22c.gs.setOne('cfbp_players', []);
  let seq22 = 0;
  const msg22 = (id, author = 'p2') => ({ type: 'message', id, author, body: 'body of ' + id, seq: ++seq22 });
  const flag22 = (targetId, author, value) => ({ type: 'feedback', targetId, author, seq: ++seq22, meta: { category: 'remember_this', value } });
  const srcIds22 = evs => env22c.gs.scribeTrainerRememberThisSources_(evs, {}).map(s => s.id);

  assert(srcIds22([msg22('c1'), flag22('c1', 'p1', true), flag22('c1', 'p1', false)]).length === 0,
    'a `false` clear — the shape js/chat-ui.js:1003 ACTUALLY emits when a player un-flags — removes the message from the fact-source set (round 2 kept mining it: consent withdrawn, still mined)');

  assert(srcIds22([msg22('c2'), flag22('c2', 'p1', true), flag22('c2', 'p1', null)]).length === 0,
    'a `null` clear still clears too — js/scribeFeedback.js documents null as the generic explicit-clear value, so BOTH shapes are honoured (any falsy value clears)');

  assert(srcIds22([msg22('c3'), flag22('c3', 'p1', false)]).length === 0,
    'a bare `false` on a NEVER-flagged message does not ADMIT it (round 2 fell straight through to the push: `seen` was unset and `value !== null`)');

  assert(srcIds22([msg22('c4'), flag22('c4', 'p1', true), flag22('c4', 'p1', false), flag22('c4', 'p1', true)]).indexOf('c4') !== -1,
    'clear-then-RE-FLAG restores the source — latest-wins, replayed in seq order, with no sticky `cleared` that ignored every later flag forever');

  assert(srcIds22([msg22('c5'), flag22('c5', 'p1', true), flag22('c5', 'p2', true), flag22('c5', 'p1', false)]).indexOf('c5') !== -1,
    'ONE FLAG SUFFICES: two players flag, one clears their OWN flag -> the other still wants it remembered, so it stays a source');

  assert(srcIds22([msg22('c6'), flag22('c6', 'p1', true), flag22('c6', 'p2', true), flag22('c6', 'p1', false), flag22('c6', 'p2', false)]).length === 0,
    'when the LAST remaining flagger clears, the message leaves the source set');

  const attrib22 = env22c.gs.scribeTrainerRememberThisSources_(
    [msg22('c7', 'p3'), flag22('c7', 'p1', true), flag22('c7', 'p2', true), flag22('c7', 'p1', false)],
    { p2: { playerId: 'p2', displayName: 'Koby' }, p3: { playerId: 'p3', displayName: 'Kevin' } });
  assert(attrib22.length === 1 && attrib22[0].flaggedBy === 'Koby' && attrib22[0].speaker === 'Kevin',
    `the prompt credits the flagger whose flag is still LIVE (Koby), never the one who cleared (got ${JSON.stringify(attrib22)})`);
}

console.log("\n[22d] Mutation-prove — restore round 2's `=== null`-is-the-only-clear check on a SCRATCH source string…");
{
  const marker22 = "state[targetId].byAuthor[author] = { seq: seq, on: !!fe.meta.value };";
  assert(codeGsSrc.includes(marker22), 'fixture check: the truthiness-based flag resolution exists in the real source');
  const mutated22 = codeGsSrc.replace(marker22,
    "state[targetId].byAuthor[author] = { seq: seq, on: fe.meta.value !== null };   // MUTATED FOR TEST — round 2's `=== null` check");
  assert(mutated22 !== codeGsSrc, 'fixture check: the mutation changed the (in-memory) source string');

  const mutEnv22 = buildSandbox(mutated22);
  const unflagged22 = [
    { type: 'message', id: 'mz', author: 'p2', body: 'flagged, then un-flagged', seq: 1 },
    { type: 'feedback', targetId: 'mz', author: 'p1', seq: 2, meta: { category: 'remember_this', value: true } },
    { type: 'feedback', targetId: 'mz', author: 'p1', seq: 3, meta: { category: 'remember_this', value: false } },
  ];
  assert(mutEnv22.gs.scribeTrainerRememberThisSources_(unflagged22, {}).length === 1,
    'MUTATION CANARY: with `=== null` restored, the `false` that js/chat-ui.js:1003 really emits is IGNORED and the un-flagged message stays a fact source — [22c]\'s first assertion is capable of going red');
  const neverFlagged22 = [
    { type: 'message', id: 'mz2', author: 'p2', body: 'never flagged', seq: 1 },
    { type: 'feedback', targetId: 'mz2', author: 'p1', seq: 2, meta: { category: 'remember_this', value: false } },
  ];
  assert(mutEnv22.gs.scribeTrainerRememberThisSources_(neverFlagged22, {}).length === 1,
    'MUTATION CANARY: and a message that was only ever `false` is ADMITTED — the second half of the same defect');
}

console.log("\n[23] SIGNIFICANT #8 — runTrainer requires the commissioner credential and is floored at one manual run per hour…");
{
  const env23 = buildSandbox();
  enableTrainer(env23);
  seedRatedWindow(env23, 3);
  env23.setUrlFetchImpl(() => anthropicJsonResponse(trainerOutput()));
  seedCommissionerPassword(env23);

  const rNoCred = env23.gs.runTrainer({});
  assert(rNoCred.ok === false && /Unauthorized/.test(rNoCred.error), `the shared backend token alone is NOT enough (got ${JSON.stringify(rNoCred)})`);
  assert(env23.urlFetchCalls.length === 0, 'an unauthorized call spends nothing');
  const rBadCred = env23.gs.runTrainer({ adminPasswordHash: b64('wrong') });
  assert(rBadCred.ok === false && /Unauthorized/.test(rBadCred.error), 'a WRONG password hash is rejected');
  assert(env23.urlFetchCalls.length === 0, 'still zero spend');

  const rGood = env23.gs.runTrainer({ adminPasswordHash: b64(TEST_COMMISH_PW) });
  assert(rGood.ok === true && !rGood.skipped, `the correct commissioner password hash is accepted (got ${JSON.stringify(rGood.skipped || rGood.error || 'ok')})`);

  const rSecond = env23.gs.runTrainer({ adminPasswordHash: b64(TEST_COMMISH_PW) });
  assert(rSecond.skipped === 'rate_limited', `a SECOND manual run inside the same hour is refused (got ${JSON.stringify(rSecond)})`);
  assert(env23.urlFetchCalls.length === 1, 'and costs nothing — exactly one Anthropic call across three authorized attempts');

  // The weekly trigger is a separate rate domain — a manual run must not block
  // it. Fresh rated traffic first, since the successful run above advanced the
  // cursor past everything that existed then.
  seedRatedWindow(env23, 3);
  env23.gs.runTrainerScheduled_();
  assert(env23.urlFetchCalls.length === 2, `the SCHEDULED run is not blocked by the manual hourly floor (got ${env23.urlFetchCalls.length} total calls)`);

  // Fail closed when no credential is configured server-side at all.
  const env23b = buildSandbox();
  enableTrainer(env23b);
  seedRatedWindow(env23b, 3);
  env23b.setUrlFetchImpl(() => anthropicJsonResponse(trainerOutput()));
  assert(env23b.gs.runTrainer({ adminPasswordHash: '' }).ok === false, 'no adminPasswordHash stored server-side -> nothing is accepted (fails CLOSED, never "no password set so everyone passes")');

  // The optional dedicated Script Property token is accepted as an alternative.
  const env23c = buildSandbox();
  enableTrainer(env23c, { SCRIBE_TRAINER_TOKEN: 'tok-123' });
  seedRatedWindow(env23c, 3);
  env23c.setUrlFetchImpl(() => anthropicJsonResponse(trainerOutput()));
  assert(env23c.gs.runTrainer({ trainerToken: 'tok-123' }).ok === true, 'SCRIBE_TRAINER_TOKEN is accepted as an alternative credential');
  const env23d = buildSandbox();
  enableTrainer(env23d, { SCRIBE_TRAINER_TOKEN: 'tok-123' });
  seedRatedWindow(env23d, 3);
  assert(env23d.gs.runTrainer({ trainerToken: 'wrong' }).ok === false, 'a wrong trainer token is rejected');
}

console.log("\n[23b] Mutation-prove — the commissioner credential gate…");
{
  const marker23 = "  if (!scribeTrainerCredentialOk_(req)) {";
  assert(codeGsSrc.includes(marker23), 'fixture check: the credential gate exists in the real source');
  const mutated23 = codeGsSrc.replace(marker23, '  if (false) {   // MUTATED OUT FOR TEST');
  assert(mutated23 !== codeGsSrc, 'fixture check: the mutation changed the (in-memory) source string');

  const mutEnv23 = buildSandbox(mutated23);
  enableTrainer(mutEnv23);
  seedRatedWindow(mutEnv23, 3);
  mutEnv23.setUrlFetchImpl(() => anthropicJsonResponse(trainerOutput()));
  const rMut23 = mutEnv23.gs.runTrainer({});
  assert(rMut23.ok === true && mutEnv23.urlFetchCalls.length === 1,
    'MUTATION CANARY: with the gate removed on a SCRATCH source string, a credential-less call spends money — the guard is capable of failing');
}

console.log("\n[24] NOTE #13 — fail closed on refusal and on unparseable output: nothing persisted, cursor NOT advanced…");
{
  function failClosedCase(label, urlFetchImpl, expectErr) {
    const env = buildSandbox();
    enableTrainer(env);
    seedRatedWindow(env, 3);
    env.setUrlFetchImpl(urlFetchImpl);
    const r = runTrainerAuthed(env);
    assert(r.ok === false && expectErr.test(r.error), `${label}: returns {ok:false} with a real reason (got ${JSON.stringify(r)})`);
    assert(env.gs.scribeLoadLearnings_().length === 0, `${label}: no learning/experiment/fact persisted`);
    assert(env.gs.scribeLoadCanon_().length === 0, `${label}: no Canon entry persisted`);
    assert(env.gs.scribeLoadReports_().length === 0, `${label}: no report appended`);
    assert(!env.sheets['CFBP_MESSAGES'].data.some(row => row && String(row[1]).indexOf('sys_trainer_') === 0), `${label}: no chat post`);
    assert(env.gs.scribeTrainerCursor_() === 0,
      `${label}: the cursor is NOT advanced — the window is retried on the next run rather than silently lost (got ${env.gs.scribeTrainerCursor_()})`);
    const logRow = env.sheets['CFBP_SCRIBE_LOG'].data.find(row => row && row[1] === 'trainer' && String(row[0]).indexOf('trainer_') === 0);
    assert(!!logRow && logRow[7] === false, `${label}: the CFBP_SCRIBE_LOG row records success=false, so the spend is still auditable`);
  }
  failClosedCase('refusal',
    () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ content: [], stop_reason: 'refusal', usage: { input_tokens: 100, output_tokens: 0 } }) }),
    /refus/i);
  failClosedCase('unparseable JSON',
    () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ content: [{ type: 'text', text: 'Sure! Here is my analysis: it went well.' }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 20 } }) }),
    /non-JSON/i);
  failClosedCase('network failure after one retry',
    () => { throw new Error('ECONNRESET'); },
    /failed/i);
}

console.log("\n[25] NOTE #9 — dataset.responsesWithRatings counts DISTINCT rated responses, not rating events…");
{
  const env25 = buildSandbox();
  const events25 = [{ type: 'message', author: 'p1' }, { type: 'message', author: 'scribe' }];
  const feedback25 = [
    { author: 'p1', targetId: 'sameResponse', meta: { category: 'rating', value: 'hit' } },
    { author: 'p2', targetId: 'sameResponse', meta: { category: 'rating', value: 'mid' } },
    { author: 'p3', targetId: 'sameResponse', meta: { category: 'rating', value: 'too_much' } },
    { author: 'p1', targetId: 'otherResponse', meta: { category: 'rating', value: 'hit' } },
  ];
  const m25 = env25.gs.scribeTrainerComputeMetrics_(events25, feedback25, {});
  assert(m25.dataset.responsesWithRatings === 2,
    `four rating events across TWO responses = 2 responses with ratings (got ${m25.dataset.responsesWithRatings})`);
  assert(m25.dataset.ratingEvents === 4, `the raw event count is retained separately for audit (got ${m25.dataset.ratingEvents})`);
  assert(m25.ratingMix.hit === 50 && m25.ratingMix.mid === 25 && m25.ratingMix.tooMuch === 25,
    'the rating MIX is still a per-EVENT percentage — the two numbers mean different things and both stay correct');

  // The report's dataset line reads off the corrected field.
  const line25 = env25.gs.scribeTrainerDatasetLine_(m25.dataset);
  assert(/Responses rated by at least one player: 2/.test(line25), `the §8 dataset line says what it means (got "${line25}")`);
}

console.log("\n[26] NOTE #14 (CONVENTIONS #17) — the Approve/Reject buttons clear the 40px tap-target floor…");
{
  const cssSrc = await readFile(fileURLToPath(new URL('./css/styles.css', import.meta.url)), 'utf8');
  const rule26 = /\.scribe-approve-btn,\s*\.scribe-reject-btn,\s*\.scribe-canon-approve-btn,\s*\.scribe-canon-reject-btn\s*\{[^}]*min-height:\s*40px/;
  assert(rule26.test(cssSrc), 'all four approve/reject selectors carry an explicit min-height:40px');
  assert(/\.btn-sm\{[^}]*min-height:34px/.test(cssSrc),
    'fixture check: .btn-sm really does default to 34px — proves the override above is necessary, not decorative');

  const appSrc26 = await readFile(fileURLToPath(new URL('./js/app.js', import.meta.url)), 'utf8');
  ['scribe-approve-btn', 'scribe-reject-btn', 'scribe-canon-approve-btn', 'scribe-canon-reject-btn'].forEach(cls => {
    assert(appSrc26.includes(cls), `the rendered markup really uses .${cls} — the CSS override is not aimed at a stale class name`);
  });
}

console.log("\n[27] RG-144 — a trainer-output playerId is RESOLVED against the roster: real id kept, unambiguous display name mapped, anything else discarded…");
{
  // THE REPORTED DEFECT. The live Sheet acquired `fact_candidate` rows whose
  // playerId was "Brayden"/"Jacob" — DISPLAY NAMES, not ids. The Supabase
  // importer's projection refused them (scribe_memory.subject_member_id is a
  // members FK), which is how they surfaced; the export was corrected by hand.
  //
  // WHY the model produced a name: scribeTrainerBuildInputText_ named every
  // player in the fact-source set by DISPLAY NAME only ("said by Koby,
  // flagged by Kevin") and never printed a single canonical id, while the
  // schema asked for a `playerId`. The only player-shaped string in the whole
  // prompt was a display name, so that is what came back — and nothing
  // server-side ever checked it (scribeTrainerFilterFactCandidates_ validated
  // `sourceMessageId` and nothing else; the persist step took
  // `String(f.playerId || '')` verbatim).
  const env27 = buildSandbox();
  enableTrainer(env27);
  const logs27 = [];
  env27.gs.Logger = { log: m => logs27.push(String(m)) };
  env27.gs.setOne('cfbp_players', [
    { playerId: 'p1', displayName: 'Drew', active: true },
    { playerId: 'p2', displayName: 'Brayden', active: true },
    { playerId: 'p5', displayName: 'Jacob', active: true },
    { playerId: 'p9', displayName: 'Ghosty', active: false },
  ]);
  const s27 = env27.gs.ensureMsgSheet();
  seedRatedWindow(env27, 3);
  ['srcA', 'srcB', 'srcC', 'srcD', 'srcE', 'srcF'].forEach((id, i) => {
    appendMsgRow(s27, { id, author: 'p2', body: 'flagged source ' + id });
    appendMsgRow(s27, { id: 'flag_' + id, type: 'feedback', author: 'p1', targetId: id, meta: { category: 'remember_this', value: true } });
  });

  let captured27 = null;
  env27.setUrlFetchImpl((url, opts) => {
    captured27 = JSON.parse(opts.payload);
    return anthropicJsonResponse(trainerOutput({
      fact_candidates: [
        { playerId: 'Brayden', key: 'k_name', value: 'bets unders', confidence: 0.8, sourceMessageId: 'srcA' },
        { playerId: 'p5', key: 'k_realid', value: 'always takes the dog', confidence: 0.8, sourceMessageId: 'srcB' },
        { playerId: '  jacob ', key: 'k_case', value: 'hates night games', confidence: 0.8, sourceMessageId: 'srcC' },
        { playerId: 'Kihoon', key: 'k_unknown', value: 'not in this league', confidence: 0.9, sourceMessageId: 'srcD' },
        { playerId: 'Ghosty', key: 'k_inactive', value: 'a former member by name', confidence: 0.9, sourceMessageId: 'srcE' },
        { playerId: 'p9', key: 'k_inactive_id', value: 'a former member by ID', confidence: 0.9, sourceMessageId: 'srcF' },
      ],
    }));
  });
  const r27 = runTrainerAuthed(env27);
  assert(r27.ok === true && !r27.skipped, `fixture check: a real run happened (${JSON.stringify(r27.skipped || r27.error || 'ok')})`);

  const rosterIds27 = ['p1', 'p2', 'p5', 'p9'];
  const facts27 = env27.gs.scribeLoadLearnings_().filter(l => l.kind === 'fact_candidate');
  const byKey27 = {};
  facts27.forEach(f => { byKey27[f.key] = f; });

  // ── THE HEADLINE ASSERTION — this is the bug, stated once ────────────────
  assert(facts27.every(f => rosterIds27.indexOf(f.playerId) !== -1),
    `NOT ONE stored fact_candidate carries a playerId that is not a known player id (got ${JSON.stringify(facts27.map(f => f.playerId))})`);

  assert(byKey27.k_name && byKey27.k_name.playerId === 'p2',
    `an unambiguous display name is MAPPED to the canonical id, not stored and not thrown away (got ${byKey27.k_name && byKey27.k_name.playerId})`);
  assert(byKey27.k_realid && byKey27.k_realid.playerId === 'p5',
    'a real id passes through untouched');
  assert(byKey27.k_case && byKey27.k_case.playerId === 'p5',
    `the name match is case-insensitive and whitespace-tolerant (got ${byKey27.k_case && byKey27.k_case.playerId})`);
  assert(byKey27.k_inactive_id && byKey27.k_inactive_id.playerId === 'p9',
    'a real id belonging to an INACTIVE player is still a real id — the members row exists, so the FK resolves and the row is kept');
  assert(!byKey27.k_unknown,
    'a playerId matching no player at all is DISCARDED — never stored for an approver who would have no idea who it refers to');
  assert(!byKey27.k_inactive,
    'a display name that only matches a DEACTIVATED player is discarded too — name-matching is deliberately limited to active players');
  assert(facts27.length === 4, `exactly the four resolvable candidates survive (got ${facts27.length}: ${JSON.stringify(facts27.map(f => f.key + '=' + f.playerId))})`);

  // The run REPORTS both outcomes rather than swallowing them — same
  // discipline [22]'s droppedFactCandidates already established.
  assert(r27.counts.droppedFactCandidates === 2,
    `the two unresolvable candidates are counted as dropped (got ${JSON.stringify(r27.counts)})`);
  assert(r27.counts.unresolvedPlayerFactCandidates === 2,
    `…and broken out by REASON, so "the model is naming people we do not have" is visible separately from "the model cited a source it was not given" (got ${r27.counts.unresolvedPlayerFactCandidates})`);
  assert(r27.counts.mappedPlayerIds === 2,
    `…and the two display-name mappings are counted as well (got ${r27.counts.mappedPlayerIds})`);

  // Logging — a mapping is a silent repair unless it is written down, and a
  // discard is data loss unless it is written down.
  assert(logs27.some(l => /scribeTrainerResolvePlayerId_: mapped display name "Brayden" -> p2/.test(l)),
    `every mapping is logged with both halves (got ${JSON.stringify(logs27.filter(l => /ResolvePlayerId/.test(l)))})`);
  assert(logs27.some(l => /scribeTrainerResolvePlayerId_: DISCARDED/.test(l) && /Kihoon/.test(l)),
    'every discard is logged with the string that could not be resolved');

  // ── And the prompt half of the root cause: the ids are now IN the input ──
  const userText27 = captured27.messages[0].content;
  assert(/LEAGUE ROSTER/.test(userText27) && /p2=Brayden/.test(userText27),
    'the Trainer input now prints the canonical id next to every active player — the model was previously shown display names ONLY and asked for an id');
  assert(/never a display name/i.test(userText27),
    'and says in words that a fact_candidate playerId must be one of those ids');
  assert(/said by Brayden \[p2\]/.test(userText27),
    'each fact source names its speaker BY ID as well as by display name, since that speaker is the usual subject of the fact');
  const factPlayerIdField27 = captured27.output_config.format.schema.properties.fact_candidates.items.properties.playerId;
  assert(/canonical/i.test(factPlayerIdField27.description || '') && /display name/i.test(factPlayerIdField27.description || ''),
    `the schema field ITSELF says canonical id, never a display name — the instruction travels with the field, not only in the prose above it (got ${JSON.stringify(factPlayerIdField27.description || null)})`);
}

console.log("\n[27b] RG-144 — ambiguity is NEVER guessed, and the resolver is exercised directly…");
{
  const env27b = buildSandbox();
  env27b.gs.setOne('cfbp_players', []);
  const R = (raw, players) => env27b.gs.scribeTrainerResolvePlayerId_(raw, players);
  const roster27 = {
    p3: { playerId: 'p3', displayName: 'Kevin', active: true },
    p7: { playerId: 'p7', displayName: 'Kevin', active: true },   // two Kevins — a commissioner-editable roster allows it
    p4: { playerId: 'p4', displayName: 'Koby', active: true },
  };
  const amb = R('Kevin', roster27);
  assert(amb.ok === false && amb.reason === 'ambiguous',
    `two active players share a display name -> the candidate is REFUSED, never assigned to whichever one sorted first (got ${JSON.stringify(amb)})`);
  assert(R('p3', roster27).ok === true && R('p3', roster27).playerId === 'p3',
    'the id path is unaffected by the ambiguity — an exact id is never name-matched at all');
  assert(R('Koby', roster27).ok === true && R('Koby', roster27).playerId === 'p4' && R('Koby', roster27).mapped === true,
    'an unambiguous name still maps, and reports that it was mapped');
  assert(R('', roster27).ok === false && R('', roster27).reason === 'empty', 'an empty playerId is refused');
  assert(R(null, roster27).ok === false, 'a null playerId is refused, not coerced into the string "null"');
  assert(R('P4', roster27).ok === false && R('P4', roster27).reason === 'unknown',
    'id matching is EXACT and case-SENSITIVE — "P4" is not "p4", because an id is an identifier and a near-miss must not silently become a different row');
  assert(R('Koby', {}).ok === false, 'an empty roster resolves nothing (fails closed, never "no roster so allow anything")');
}

console.log("\n[27c] RG-144 — the memory-apply path is the LAST gate: a legacy display-name row never reaches CFBP_SCRIBE_MEMORY…");
{
  // The live Sheet already contains rows written before this fix. When Drew
  // approves one, scribeMemoryApplyApprovedFacts_ copies its playerId into
  // CFBP_SCRIBE_MEMORY — the sheet whose projected column IS the members FK.
  // So the same resolution runs here too: repair what is unambiguous, refuse
  // the rest, and never stamp memoryAppliedAt on a row that was not applied.
  const env27c = buildSandbox();
  const logs27c = [];
  env27c.gs.Logger = { log: m => logs27c.push(String(m)) };
  env27c.gs.setOne('cfbp_players', [
    { playerId: 'p2', displayName: 'Brayden', active: true },
    { playerId: 'p5', displayName: 'Jacob', active: true },
  ]);
  env27c.gs.scribeSaveLearnings_([
    { kind: 'fact_candidate', playerId: 'Brayden', key: 'legacy_name', value: 'unders on Big Ten nights', confidence: 0.8, sourceMessageId: 'm1', status: 'approved', createdAt: '2026-09-01T00:00:00Z', runId: 'r1' },
    { kind: 'fact_candidate', playerId: 'Kihoon', key: 'legacy_unknown', value: 'nobody by that name', confidence: 0.8, sourceMessageId: 'm2', status: 'approved', createdAt: '2026-09-01T00:00:00Z', runId: 'r1' },
    { kind: 'fact_candidate', playerId: 'p5', key: 'legacy_id', value: 'already correct', confidence: 0.8, sourceMessageId: 'm3', status: 'approved', createdAt: '2026-09-01T00:00:00Z', runId: 'r1' },
  ]);
  const applied27 = env27c.gs.scribeMemoryApplyApprovedFacts_();
  const mem27 = env27c.gs.scribeMemoryAll_();
  assert(mem27.every(m => m.playerId === 'p2' || m.playerId === 'p5'),
    `every memory row written carries a real player id (got ${JSON.stringify(mem27.map(m => m.playerId + ':' + m.key))})`);
  assert(mem27.some(m => m.key === 'legacy_name' && m.playerId === 'p2'),
    'an unambiguous legacy display-name row is repaired on the way in rather than blocking the approval');
  assert(!mem27.some(m => m.key === 'legacy_unknown'),
    'an unresolvable legacy row is NOT written to memory — this is the row shape the Supabase import refused');
  assert(applied27.applied === 2 && applied27.skipped === 1,
    `the sync reports what it refused instead of reporting success for it (got ${JSON.stringify(applied27)})`);
  const stillPending = env27c.gs.scribeLoadLearnings_().filter(l => l.key === 'legacy_unknown')[0];
  assert(stillPending && !stillPending.memoryAppliedAt,
    'the refused row is never stamped memoryAppliedAt — it is unfinished business, not a completed sync');
  assert(logs27c.some(l => /scribeMemoryApplyApprovedFacts_/.test(l) && /Kihoon/.test(l)),
    'and the refusal is logged with the offending value');
}

console.log("\n[27d] RG-144 Mutation-prove — delete the resolver call on a SCRATCH source string and the display name comes straight back…");
{
  const marker27 = "var resolved = scribeTrainerResolvePlayerId_(c.playerId, playersById || {});";
  assert(codeGsSrc.includes(marker27), 'fixture check: the resolver really is called from the fact-candidate filter in the real source');
  const mutated27 = codeGsSrc.replace(marker27,
    "var resolved = { ok: true, playerId: String(c.playerId || ''), mapped: false };   // MUTATED FOR TEST — the pre-RG-144 behaviour");
  assert(mutated27 !== codeGsSrc, 'fixture check: the mutation changed the (in-memory) source string');

  const mutEnv27 = buildSandbox(mutated27);
  enableTrainer(mutEnv27);
  mutEnv27.gs.setOne('cfbp_players', [{ playerId: 'p2', displayName: 'Brayden', active: true }]);
  const sM27 = mutEnv27.gs.ensureMsgSheet();
  seedRatedWindow(mutEnv27, 3);
  appendMsgRow(sM27, { id: 'srcM', author: 'p2', body: 'flagged source' });
  appendMsgRow(sM27, { id: 'flagM', type: 'feedback', author: 'p1', targetId: 'srcM', meta: { category: 'remember_this', value: true } });
  mutEnv27.setUrlFetchImpl(() => anthropicJsonResponse(trainerOutput({
    fact_candidates: [{ playerId: 'Brayden', key: 'k_mut', value: 'v', confidence: 0.8, sourceMessageId: 'srcM' }],
  })));
  const rM27 = runTrainerAuthed(mutEnv27);
  assert(rM27.ok === true, 'fixture check: the mutated run still "succeeds" — which is exactly how this shipped unnoticed');
  const mutFacts = mutEnv27.gs.scribeLoadLearnings_().filter(l => l.kind === 'fact_candidate');
  assert(mutFacts.length === 1 && mutFacts[0].playerId === 'Brayden',
    'MUTATION CANARY: with the resolver bypassed on a scratch source string, "Brayden" is stored verbatim exactly as the live Sheet shows — [27]\'s headline assertion is capable of going red');
}

console.log("\n[28] REVIEWER BLOCK 1 (2026-09-20) — THE PORTED INPUT ASSEMBLY IS BYTE-IDENTICAL TO CODE.GS…");
{
  // Reviewer BLOCK 1: the Supabase trainer sent the model a "materially simpler" input while the
  // prompt riding with it promised COMPUTED METRICS, CONVERSATION AFTERMATH and RAW TEXT FEEDBACK.
  // `js/scribe-trainer-rules.js` now carries the real port. "Ported faithfully" is a claim that has
  // to be TESTED, and this is the strongest available form of that test: run Code.gs's own function
  // in the vm sandbox against a fixture, run the ported one in Node against the SAME fixture, and
  // compare the strings. Not a substring check — `===`.
  const rules = await import('./js/scribe-trainer-rules.js');
  const env28 = buildSandbox();
  const base = Date.now();

  const events28 = [
    { type: 'message', id: 'h1', seq: 1, author: 'p1', gameTag: '', ts: base, body: 'kickoff talk', meta: {} },
    { type: 'message', id: 's1', seq: 2, author: 'scribe', gameTag: '', ts: base + 1000, body: 'a line', meta: { trigger: 'autonomous' } },
    { type: 'message', id: 'h2', seq: 3, author: 'p2', gameTag: '', ts: base + 2000, replyTo: 's1', body: 'ha', meta: {} },
    { type: 'message', id: 'h3', seq: 4, author: 'p3', gameTag: 'gameX', ts: base + 2500, body: 'different thread', meta: {} },
    { type: 'message', id: 's2', seq: 5, author: 'scribe', gameTag: '', ts: base + 4000, body: 'another line', meta: {} },
    { type: 'message', id: 'src1', seq: 6, author: 'p1', gameTag: '', ts: base + 5000, body: 'I went to Purdue', meta: {} },
    { type: 'feedback', id: 'f1', seq: 7, author: 'p1', targetId: 's1', ts: base + 6000, meta: { category: 'rating', value: 'hit' } },
    { type: 'feedback', id: 'f2', seq: 8, author: 'p2', targetId: 's2', ts: base + 6100, meta: { category: 'rating', value: 'mid' } },
    { type: 'feedback', id: 'f3', seq: 9, author: 'p1', targetId: 's2', ts: base + 6200, meta: { category: 'rewrite', value: 'should have said X' } },
    { type: 'feedback', id: 'f4', seq: 10, author: 'p2', targetId: 'h1', ts: base + 6300, meta: { category: 'weigh_in', value: 'this needed a jab' } },
    { type: 'feedback', id: 'f5', seq: 11, author: 'p2', targetId: 'src1', ts: base + 6400, meta: { category: 'remember_this', value: true } },
  ];
  const players28 = {
    p1: { playerId: 'p1', displayName: 'Kevin', active: true },
    p2: { playerId: 'p2', displayName: 'Koby', active: true },
    p3: { playerId: 'p3', displayName: 'Jacob', active: false },
  };
  const learnings28 = [
    { kind: 'learning', status: 'approved', category: 'tone', confidence: 0.95, instruction: 'be terser' },
    { kind: 'learning', status: 'pending', category: 'tone', confidence: 0.5, instruction: 'not this one' },
    { kind: 'experiment', status: 'pending', experiment: 'shorter posts', reason: 'ratings', confidence: 0.6 },
  ];

  // ── the GAS side ──
  const gasFeedback = env28.gs.scribeTrainerExtractFeedback_(events28);
  const gasAftermath = env28.gs.scribeTrainerComputeAftermath_(events28);
  const gasMetrics = env28.gs.scribeTrainerComputeMetrics_(events28, gasFeedback, players28);
  const gasSources = env28.gs.scribeTrainerRememberThisSources_(events28, players28);
  const gasContinuity = env28.gs.scribeTrainerContinuityText_(learnings28);
  const gasInput = env28.gs.scribeTrainerBuildInputText_(
    events28, gasFeedback, gasAftermath, gasMetrics, learnings28, gasSources, players28);

  // ── the ported side ──
  const portFeedback = rules.extractFeedback(events28);
  const portAftermath = rules.computeAftermath(events28);
  const portMetrics = rules.computeMetrics(events28, portFeedback, players28);
  const portSources = rules.rememberThisSources(events28, players28);
  const portContinuity = rules.continuityText(learnings28);
  const portInput = rules.buildTrainerInputText({
    events: events28, feedbackEvents: portFeedback, aftermath: portAftermath, metrics: portMetrics,
    learnings: learnings28, factSources: portSources, playersById: players28,
  });

  assert(gasInput.length > 800, `fixture check: the GAS builder produced a real input (got ${gasInput.length} chars) — comparing two empty strings would pass trivially`);
  assert(JSON.stringify(portFeedback) === JSON.stringify(gasFeedback), 'extractFeedback() matches scribeTrainerExtractFeedback_ exactly');
  assert(JSON.stringify(portAftermath) === JSON.stringify(gasAftermath),
    `computeAftermath() matches scribeTrainerComputeAftermath_ exactly — the section the prompt calls CONVERSATION AFTERMATH (GAS: ${JSON.stringify(gasAftermath)})`);
  assert(portContinuity === gasContinuity, 'continuityText() matches scribeTrainerContinuityText_ BYTE FOR BYTE');
  assert(portInput === gasInput,
    'buildTrainerInputText() matches scribeTrainerBuildInputText_ BYTE FOR BYTE — same sections, same order, same caps, same exclusions. This is the assertion reviewer BLOCK 1 asked for');

  // The promises the prompt makes are all kept by this fixture's own input.
  for (const { promise, section } of rules.PROMPT_PROMISES) {
    assert(portInput.includes(section),
      `PROMPT-PROMISE "${promise}" has a real section behind it in the built input ("${section.slice(0, 40)}…")`);
  }
  assert(portInput.includes('should have said X') && portInput.includes('this needed a jab'),
    'the player-authored REWRITE and WEIGH-IN text actually travel — the specific bytes the old builder never sent');
  assert(portInput.includes('- s1: 1 human replies, directReply=true'),
    'the aftermath line for a real SCRIBE response is present with its computed numbers');
  assert(portInput.includes('I went to Purdue'),
    'the 📌-flagged source body travels, so a fact_candidate citing it is something a human can verify');

  // ── THE BLIND RULE, at the builder. Chat text only, never a pick. ──
  const picky = events28.concat([
    { type: 'message', id: 'pk', seq: 12, author: 'p1', gameTag: '', ts: base + 7000, body: 'ordinary chat',
      meta: { selectedTeam: 'BAMA_SECRET_PICK', tiebreakerGuess: 47 } },
  ]);
  const pickyInput = rules.buildTrainerInputText({
    events: picky, feedbackEvents: rules.extractFeedback(picky), aftermath: rules.computeAftermath(picky),
    metrics: rules.computeMetrics(picky, rules.extractFeedback(picky), players28),
    learnings: learnings28, factSources: rules.rememberThisSources(picky, players28), playersById: players28,
  });
  assert(!pickyInput.includes('BAMA_SECRET_PICK') && !pickyInput.includes('47') && !pickyInput.includes('selectedTeam'),
    'BLIND RULE — a planted pick and tiebreaker guess on an event\'s meta reach the prompt NOWHERE: the builder reads bodies, ids and counts, never a selection. A mutation that dumped the raw events would go red here');
}

console.log("\n[28b] BLOCK 1 Mutation-prove — delete a section from the ported builder and [28] goes red…");
{
  // Scratch string only — never the file (CLAUDE.md's own rule: commit before mutation testing,
  // mutate a copy, never `git restore`).
  const { readFile } = await import('node:fs/promises');
  const rulesSrc = await readFile(fileURLToPath(new URL('./js/scribe-trainer-rules.js', import.meta.url)), 'utf8');
  const marker = "parts.push('RAW TEXT FEEDBACK (rewrites + weigh-in text";
  assert(rulesSrc.includes(marker), 'fixture check: the RAW TEXT FEEDBACK section really is in the shipped builder');
  const mutated = rulesSrc.replace(marker, "parts.push('REMOVED FOR TEST (rewrites + weigh-in text");
  assert(mutated !== rulesSrc, 'fixture check: the mutation changed the in-memory source string');
  const mod = await import('data:text/javascript;base64,' + Buffer.from(mutated).toString('base64'));
  const mutInput = mod.buildTrainerInputText({
    events: [], feedbackEvents: [], aftermath: [],
    metrics: { humanMessagesPerInterjection: null, ratingMix: { hit: 0, mid: 0, tooMuch: 0 }, rewriteCount: 0, weighInFlags: [],
      dataset: { responsesEvaluated: 0, responsesWithRatings: 0, ratingEvents: 0, textFeedbackItems: 0, playerRewrites: 0, autonomousInterjections: 0 } },
    learnings: [], factSources: [], playersById: {},
  });
  assert(!mutInput.includes('RAW TEXT FEEDBACK'),
    'MUTATION CANARY: with the section renamed on a scratch copy, the promised "RAW TEXT FEEDBACK" heading is gone — [28]\'s promise loop and the byte comparison are both capable of going red');
}

console.log("\n[29] REVIEWER NOTE 5 (2026-09-20) — once serverJobs.trainer is TRUE, no path in this build reaches Apps Script's runTrainer…");
{
  // THE RISK the F4 switch-on carried was a double SPEND: while the Supabase Trainer was on, an
  // Apps Script `runTrainer` was a second paid Anthropic call against the frozen Sheet, drawn on
  // no ledger this project could see. js/app.js's button branched on the switch — but a branch at
  // ONE call site is a convention, not a guarantee, so the refusal went INSIDE the relay: a
  // property of the MODULE, not of one handler, and tested as one.
  //
  // RETIRED-AND-STRENGTHENED, 2026-09-23. The Apps Script relay is deleted, so the refusal is
  // UNCONDITIONAL rather than switch-gated and the double-spend risk is closed by construction
  // rather than by a gate. What this section asserts now is that BOTH arms of js/app.js's button
  // answer in DI-T6.0(f)'s envelope — because the false arm is still reachable (a device whose
  // settings blob has not hydrated, or a league with the job flipped off) and it must say
  // something the existing `result.skipped` branch can render. An export that threw, or one that
  // was deleted outright, would turn that arm into a TypeError in a click handler.
  const storageMod29 = await import('./js/storage.js');
  const scribeAgent29 = await import('./js/scribeAgent.js');
  const settings29 = storageMod29.getSettings();

  for (const flag of [false, true]) {
    storageMod29.saveSetting('serverJobs', { trainer: flag });
    // `.catch()` so that a mutation which makes this THROW is a clean RED rather than an
    // unhandled rejection that kills the suite before it can print a summary — a mutation whose
    // symptom is "no output" is indistinguishable from a harness problem.
    const r = await scribeAgent29.runTrainerRemote({ adminPasswordHash: 'x' })
      .catch((e) => ({ threw: String(e && e.message ? e.message : e) }));
    assert(r && r.ok === true && r.skipped === 'disabled',
      `29-1/${flag}: with serverJobs.trainer ${flag ? 'ON' : 'OFF'} the legacy relay answers the DI-T6.0(f) envelope (ok:true, skipped:'disabled') rather than throwing — js/app.js's existing result.skipped branch renders it with no new branch (got ${JSON.stringify(r)})`);
    assert(/retired/i.test(String(r.error || '')) && /Edge Function/.test(String(r.error || '')),
      `29-2/${flag}: …and the reason SAYS the relay was retired and names where the Trainer runs now, so a commissioner who reaches this arm is told rather than left with a silent no-op (got ${JSON.stringify(r.error)})`);
  }

  // THE STRUCTURAL HALF, which is the one that could regress: nothing in the module can reach
  // Apps Script any more, because there is nothing to import.
  const agentSrc29 = await readFile(fileURLToPath(new URL('./js/scribeAgent.js', import.meta.url)), 'utf8');
  const agentCode29 = agentSrc29.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert(!/from '\.\/backend\.js'/.test(agentCode29),
    '29-3: js/scribeAgent.js imports NOTHING from js/backend.js — the four relays it wrapped (scribeAsk, runTrainer, scribeAutonomous, scribeClassify) are deleted, so the double-spend this section was written about is closed by construction rather than by a gate that could be edited');

  storageMod29.saveSetting('serverJobs', settings29.serverJobs === undefined ? {} : settings29.serverJobs);
}

console.log('\n══════════════════════════════════════════════════');
if (fail === 0) console.log(`✅ ALL PASS — ${pass} passed, ${fail} failed`);
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
else process.stderr.write(`❌ FAILURES — ${pass} passed, ${fail} failed` + '\n', () => process.stdout.write('', () => process.exit(1)));

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
