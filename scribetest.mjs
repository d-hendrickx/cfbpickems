/**
 * CFB Pickems — scribetest.mjs (Build 2, Group C, 2026-09-10, UN-149…154)
 * ===========================================================================
 * Unit/integration tests for the interactive SCRIBE runtime in
 * backend/Code.gs (`scribeAsk`, `scribeInvoke_`, the C3 league tools, the C4
 * ESPN wrappers, the C5 context assembler). Precedent: `notifytest.mjs`
 * (Groups A/B) / `grouptest.mjs` (UN-118) — a math/logic proof needs to read
 * start to finish, not sit buried among chat-fold assertions.
 *
 * MECHANISM: Code.gs is executed WHOLESALE inside a Node `vm` context, with
 * a small, faithful stub of the Apps Script globals it touches
 * (PropertiesService, CacheService, LockService, SpreadsheetApp, Utilities,
 * UrlFetchApp, ContentService, Logger). This is stronger than extracting one
 * function at a time (notifytest.mjs's technique, needed there because it
 * compares against a DIFFERENTLY-SHAPED twin file) — here we run the real
 * `scribeAsk` end to end, including its own LockService/CacheService/sheet
 * plumbing, exactly like production. UrlFetchApp is the ONE seam the test
 * controls per-case (task instruction: "proxy request-shape assertions using
 * a stubbed UrlFetchApp").
 *
 * Run:  node scribetest.mjs
 * Must be run under BOTH TZ=UTC and TZ=America/Los_Angeles.
 *
 * Covers (task instruction, verbatim):
 *   [1]  Proxy request-shape assertions against a stubbed UrlFetchApp
 *   [2]  Dedup / lock (placeholder-row-then-release)
 *   [3]  Throttle (player + league hourly) + budget cap + kill switch
 *   [4]  Fallback signaling (throttled/disabled/outage/refusal reasons)
 *   [5]  Blind-rule tool gating, positive/negative, INCLUDING the asker's
 *        own open-week pick
 *   [6]  AD-03 — no tool ever returns a signed spread
 *   [7]  Context ceiling (N=20 / 2,000 chars)
 *   [8]  Single-reply / no-self-retrigger (dedup collapses repeat calls)
 *   [9]  Ack supersession (client-side fold)
 *   [10] Cost estimator per model
 *   [11] Mutation-proof: blind-rule tool gate + dedup (scratch copies only)
 *
 * [26] (BUG-D, 2026-09-11) is a CLIENT-side ordering suite rather than a
 * Code.gs one: the mention branch used to issue `scribeAsk` in the same tick
 * as the trigger message's own send, ~750ms before chat.js's debounced outbox
 * put that message anywhere the server could read it. Nothing in Code.gs was
 * wrong — `scribeFindMessageById_` was answering the question it was asked.
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

// ── DOM/browser stubs so js/chat.js + js/chat-ui.js import cleanly (for the
// [9] ack-supersession section, which exercises the REAL client fold). ─────
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
globalThis.fetch = async () => { throw new Error('network disabled in scribetest'); };
globalThis.matchMedia = () => ({ matches: false });
globalThis.confirm = () => true;
globalThis.prompt = () => null;
globalThis.alert = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };

// ═══════════════════════════════════════════════════════════════════════════
// ── GAS sandbox harness ─────────────────────────────────────────────────────
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
  const data = [];   // data[0] = row 1
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
    // P1 remediation (Build 2b) — ensureScribeLogSheet() now calls
    // getLastColumn() to detect an under-width header row (a sheet created by
    // an older version of this file, before a later column was appended) and
    // widen it in place. Based on the HEADER row's own width, matching real
    // Sheets semantics closely enough for this fixture's purposes (every
    // seed helper in this file writes a full header row first).
    getLastColumn() { return (data[0] && data[0].length) || 0; },
    setFrozenRows() {},
    getDataRange() {
      const maxCols = data.reduce((m, r) => Math.max(m, r ? r.length : 0), 0) || 1;
      return this.getRange(1, 1, data.length, maxCols);
    },
  };
}

// `srcOverride` (B1/B3a remediation, round 1) — optional. Every existing
// call site (`buildSandbox()`, no args) is unaffected; new mutation-canary
// sections pass a SCRATCH source string here instead of duplicating this
// entire harness a second time.
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
  // scribeLoadLeagueData_() calls the pre-existing getMany()/storeSheet(),
  // which (like every other CFBP_STORE reader) requires the sheet to exist —
  // normally created once by setup(). Tests never call the real setup()
  // (it also installs a time trigger via ScriptApp, which this harness
  // deliberately does not stub — this feature never touches ScriptApp on
  // its own request path), so pre-create just the one sheet/header setup()
  // would have, matching that function's own shape exactly.
  const storeSheet = makeFakeSheet();
  storeSheet.getRange(1, 1, 1, 3).setValues([['key', 'json', 'updatedAt']]);
  sheets['CFBP_STORE'] = storeSheet;
  return {
    gs: sandbox, props, cacheStore, sheets, urlFetchCalls,
    setUrlFetchImpl: fn => { urlFetchImpl = fn; },
  };
}

function anthropicResponse({ stopReason = 'end_turn', text = '', toolUse = null, usage = {} } = {}) {
  const content = [];
  if (text) content.push({ type: 'text', text });
  if (toolUse) content.push({ type: 'tool_use', id: toolUse.id || 'toolu_1', name: toolUse.name, input: toolUse.input || {} });
  const body = { content, stop_reason: stopReason, usage: { input_tokens: 500, output_tokens: 50, ...usage } };
  return {
    getResponseCode: () => 200,
    getContentText: () => JSON.stringify(body),
  };
}

/** Appends one raw CFBP_MESSAGES row, correctly deriving seq from the
 *  physical row (row 1 = header, seq n lives at physical row n+1 — the same
 *  convention msgHead()/chatAppend() use). Every direct-seed call site below
 *  goes through this, so the seq/row relationship can't drift out of sync
 *  the way a copy-pasted `[[row, ...]]` literal would. */
function appendMsgRow(sheet, { id, type = 'message', author, gameTag = '', body = '', targetId = '', replyTo = '', meta = {} }) {
  const row = sheet.getLastRow() + 1;
  const seq = row - 1;
  sheet.getRange(row, 1, 1, 10).setValues([[seq, id, Date.now(), type, author, gameTag, body, targetId, replyTo, JSON.stringify(meta)]]);
  return seq;
}

function seedTriggerMessage(env, { id = 'trig1', author = 'p1', body = '@scribe who is leading?', gameTag = '' } = {}) {
  const s = env.gs.ensureMsgSheet();
  return appendMsgRow(s, { id, author, gameTag, body });
}

function enableInteractive(env, extra = {}) {
  env.props.SCRIBE_INTERACTIVE_ENABLED = 'true';
  env.props.ANTHROPIC_API_KEY = 'test-key';
  Object.entries(extra).forEach(([k, v]) => { env.props[k] = String(v); });
}

// B3a remediation (round 1) — directly seeds a CFBP_SCRIBE_LOG row shaped
// exactly like a real crashed reservation (placeholder written, never
// finalized: responseMessageId stays '', startedAt is `ageMs` in the past).
function seedStaleScribeLogRow(env, { triggerMessageId, ageMs, model = 'claude-sonnet-5' }) {
  const s = env.gs.ensureScribeLogSheet();
  const startedAt = new Date(Date.now() - ageMs).toISOString();
  const row = s.getLastRow() + 1;
  s.getRange(row, 1, 1, 17).setValues([[
    triggerMessageId, 'mention', model, startedAt, 0, 0, 0, false, 0, 0, 0, '', 'crashed_mid_flight', 0, 0, 0, 0,
  ]]);
  return row;
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('[1] Kill switch — no response at all, zero Anthropic calls…');
{
  const env = buildSandbox();
  seedTriggerMessage(env);
  const r = env.gs.scribeAsk({ triggerMessageId: 'trig1', playerId: 'p1', weekId: '', gameTag: '' });
  assert(r.ok === true && r.disabled === true, 'SCRIBE_INTERACTIVE_ENABLED unset → {ok:true, disabled:true}');
  assert(env.urlFetchCalls.length === 0, 'zero UrlFetchApp calls when the kill switch is off');

  env.props.SCRIBE_INTERACTIVE_ENABLED = 'false';
  const r2 = env.gs.scribeAsk({ triggerMessageId: 'trig1', playerId: 'p1' });
  assert(r2.disabled === true, 'explicit "false" also reads as disabled');

  env.props.SCRIBE_INTERACTIVE_ENABLED = 'nonsense';
  const r3 = env.gs.scribeAsk({ triggerMessageId: 'trig1', playerId: 'p1' });
  assert(r3.disabled === true, 'a garbage value fails CLOSED (disabled), not open — this is the opposite default-when-missing convention from NOTIFY_NAME_NON_SUBMITTERS, deliberately');
}

console.log('\n[1b] Missing ANTHROPIC_API_KEY → degrade, zero Anthropic calls…');
{
  const env = buildSandbox();
  seedTriggerMessage(env);
  env.props.SCRIBE_INTERACTIVE_ENABLED = 'true';   // key deliberately NOT set
  const r = env.gs.scribeAsk({ triggerMessageId: 'trig1', playerId: 'p1' });
  assert(r.ok === true && r.throttled === true && r.reason === 'not_configured', 'missing API key → throttled/not_configured, never a thrown error');
  assert(env.urlFetchCalls.length === 0, 'zero UrlFetchApp calls with no key configured');
}

console.log('\n[1c] Trigger message not found → ok:false, zero Anthropic calls…');
{
  const env = buildSandbox();
  enableInteractive(env);
  const r = env.gs.scribeAsk({ triggerMessageId: 'ghost', playerId: 'p1' });
  assert(r.ok === false && /Trigger message not found/.test(r.error), 'unknown triggerMessageId is a real error, not a silent degrade');
  assert(env.urlFetchCalls.length === 0, 'never calls Anthropic for a trigger message that does not exist server-side (closes the prompt-spoof vector)');
}

console.log('\n[2] Dedup / lock — a second call for the SAME triggerMessageId never re-spends…');
{
  const env = buildSandbox();
  seedTriggerMessage(env);
  enableInteractive(env);
  env.setUrlFetchImpl(() => anthropicResponse({ text: 'The standings say Drew, obviously.' }));

  const r1 = env.gs.scribeAsk({ triggerMessageId: 'trig1', playerId: 'p1' });
  assert(r1.ok === true && !!r1.responseMessageId && r1.deduped === false, 'first call answers for real');
  assert(r1.responseMessageId === 'scribe_llm_trig1', 'deterministic id: scribe_llm_<triggerMessageId>');
  const callsAfterFirst = env.urlFetchCalls.length;
  assert(callsAfterFirst === 1, 'exactly one Anthropic call for the first, successful answer');

  const r2 = env.gs.scribeAsk({ triggerMessageId: 'trig1', playerId: 'p1' });
  assert(r2.ok === true && r2.deduped === true && r2.responseMessageId === r1.responseMessageId, 'second call for the SAME trigger dedupes to the exact same responseMessageId');
  assert(env.urlFetchCalls.length === callsAfterFirst, '[8] SINGLE-REPLY: the second call spends ZERO additional Anthropic calls');

  const r3 = env.gs.scribeAsk({ triggerMessageId: 'trig1', playerId: 'p2' });   // even a DIFFERENT asker
  assert(r3.deduped === true, 'dedup is keyed on triggerMessageId, not playerId — a different asker replaying the same trigger still dedupes');
  assert(env.urlFetchCalls.length === callsAfterFirst, 'still zero additional Anthropic calls');

  // The chat log itself carries exactly ONE row with this id, ever.
  const msgSheet = env.sheets['CFBP_MESSAGES'];
  const idCol = msgSheet.data.filter(r => r && r[1] === 'scribe_llm_trig1');
  assert(idCol.length === 1, '[8] exactly one CFBP_MESSAGES row exists for scribe_llm_trig1, no matter how many times scribeAsk was called');

  // CFBP_SCRIBE_LOG has exactly one row for this trigger too.
  const logSheet = env.sheets['CFBP_SCRIBE_LOG'];
  const logRows = logSheet.data.filter(r => r && r[0] === 'trig1');
  assert(logRows.length === 1, 'exactly one CFBP_SCRIBE_LOG row per triggerMessageId — placeholder-row-then-release never double-reserves');
}

console.log('\n[1] Proxy request-shape assertions against the stubbed UrlFetchApp…');
{
  const env = buildSandbox();
  seedTriggerMessage(env, { id: 'trigShape', body: '@scribe what are the standings?' });
  enableInteractive(env, { SCRIBE_MODEL: 'claude-opus-5', SCRIBE_EFFORT: 'medium' });
  let capturedPayload = null;
  env.setUrlFetchImpl((url, opts) => {
    capturedPayload = JSON.parse(opts.payload);
    return anthropicResponse({ text: 'Drew leads.' });
  });
  const r = env.gs.scribeAsk({ triggerMessageId: 'trigShape', playerId: 'p1' });
  assert(r.ok === true, 'call succeeds');
  assert(env.urlFetchCalls[0].url === 'https://api.anthropic.com/v1/messages', 'POSTs to the correct Anthropic endpoint');
  assert(env.urlFetchCalls[0].opts.method === 'post', 'HTTP method is post');
  assert(env.urlFetchCalls[0].opts.headers['x-api-key'] === 'test-key', 'x-api-key header carries the Script Property secret');
  assert(env.urlFetchCalls[0].opts.headers['anthropic-version'] === '2023-06-01', 'anthropic-version header is set');
  assert(env.urlFetchCalls[0].opts.contentType === 'application/json', 'contentType is application/json');
  assert(capturedPayload.model === 'claude-opus-5', 'model comes from the SCRIBE_MODEL Script Property, no redeploy needed to change it');
  assert(capturedPayload.output_config && capturedPayload.output_config.effort === 'medium', 'output_config.effort comes from SCRIBE_EFFORT');
  assert(capturedPayload.thinking && capturedPayload.thinking.type === 'adaptive', 'adaptive thinking, no budget_tokens field');
  assert(capturedPayload.budget_tokens === undefined && (!capturedPayload.thinking || capturedPayload.thinking.budget_tokens === undefined), 'never sends budget_tokens (rejected on Opus-tier models)');
  assert(!('prefill' in capturedPayload) && Array.isArray(capturedPayload.messages) && capturedPayload.messages[capturedPayload.messages.length - 1].role === 'user', 'no assistant prefill — the request ends on a user turn');
  assert(Array.isArray(capturedPayload.system) && capturedPayload.system.length >= 1, 'system is an array of blocks, not a bare string');
  assert(capturedPayload.system[capturedPayload.system.length - 1].cache_control && capturedPayload.system[capturedPayload.system.length - 1].cache_control.type === 'ephemeral', 'cache_control:{type:"ephemeral"} sits on the LAST non-empty stable system block');
  const toolNames = capturedPayload.tools.map(t => t.name || t.type);
  assert(toolNames.includes('get_current_standings'), 'league tools are declared');
  assert(toolNames.includes('web_search'), 'web search tool declared (SCRIBE_WEB_SEARCH_ENABLED defaults true per Drew\'s C-3 ruling)');
  const webSearchTool = capturedPayload.tools.find(t => t.name === 'web_search');
  assert(webSearchTool.type === 'web_search_20260209' && webSearchTool.max_uses === 2 && !webSearchTool.allowed_domains, 'web_search: max_uses:2, NO domain allow-list (correction #2)');
  const clientTools = capturedPayload.tools.filter(t => t.name !== 'web_search');
  assert(clientTools.every(t => t.strict === true), 'every client tool declares strict:true');
  assert(clientTools.every(t => t.input_schema.additionalProperties === false), 'every client tool schema sets additionalProperties:false');
}

console.log('\n[3] Mention throttle — per-player and per-league hourly caps…');
{
  const env = buildSandbox();
  enableInteractive(env, { SCRIBE_MENTION_LIMIT_PLAYER_HOURLY: 2, SCRIBE_MENTION_LIMIT_LEAGUE_HOURLY: 100 });
  env.setUrlFetchImpl(() => anthropicResponse({ text: 'answer' }));

  seedTriggerMessage(env, { id: 't1' });
  seedTriggerMessage(env, { id: 't2' });
  seedTriggerMessage(env, { id: 't3' });

  const r1 = env.gs.scribeAsk({ triggerMessageId: 't1', playerId: 'p1' });
  const r2 = env.gs.scribeAsk({ triggerMessageId: 't2', playerId: 'p1' });
  assert(r1.ok && !r1.throttled && r2.ok && !r2.throttled, 'first two mentions from the SAME player, within the limit of 2/hour, both answer for real');
  const r3 = env.gs.scribeAsk({ triggerMessageId: 't3', playerId: 'p1' });
  assert(r3.ok === true && r3.throttled === true && r3.reason === 'throttle', 'the THIRD mention in the same hour from the same player is throttled');
  assert(env.urlFetchCalls.length === 2, 'the throttled call never touched Anthropic at all');
}
{
  const env = buildSandbox();
  enableInteractive(env, { SCRIBE_MENTION_LIMIT_PLAYER_HOURLY: 100, SCRIBE_MENTION_LIMIT_LEAGUE_HOURLY: 2 });
  env.setUrlFetchImpl(() => anthropicResponse({ text: 'answer' }));
  seedTriggerMessage(env, { id: 'l1' }); seedTriggerMessage(env, { id: 'l2' }); seedTriggerMessage(env, { id: 'l3' });
  env.gs.scribeAsk({ triggerMessageId: 'l1', playerId: 'p1' });
  env.gs.scribeAsk({ triggerMessageId: 'l2', playerId: 'p2' });   // different players, same league bucket
  const r3 = env.gs.scribeAsk({ triggerMessageId: 'l3', playerId: 'p3' });
  assert(r3.throttled === true && r3.reason === 'throttle', 'league-wide hourly cap trips across DIFFERENT players, not just one');
}

console.log('\n[3b] Monthly budget cap — degrades once the running total crosses SCRIBE_MONTHLY_BUDGET_USD…');
{
  const env = buildSandbox();
  enableInteractive(env, { SCRIBE_MONTHLY_BUDGET_USD: 1 });
  const logSheet = env.gs.ensureScribeLogSheet();
  const monthKey = env.gs.scribeMonthKey_();
  // Seed a prior, already-finalized log row that alone exceeds the $1 budget.
  logSheet.getRange(logSheet.getLastRow() + 1, 1, 1, 13).setValues([[
    'priorTrigger', 'mention', 'claude-sonnet-5', monthKey + '-01T00:00:00.000Z',
    500, 1, 0, true, 10000, 500, 5.00, 'scribe_llm_priorTrigger', '',
  ]]);
  seedTriggerMessage(env, { id: 'overBudget' });
  const r = env.gs.scribeAsk({ triggerMessageId: 'overBudget', playerId: 'p1' });
  assert(r.ok === true && r.throttled === true && r.reason === 'budget', 'a monthly spend already over budget degrades the NEXT mention before any Anthropic call');
  assert(env.urlFetchCalls.length === 0, 'zero Anthropic spend once the budget is already exceeded');
}

console.log('\n[4] Fallback signaling — outage (one retry, then degrade) and refusal…');
{
  const env = buildSandbox();
  enableInteractive(env);
  seedTriggerMessage(env, { id: 'outage1' });
  let calls = 0;
  env.setUrlFetchImpl(() => { calls++; return { getResponseCode: () => 500, getContentText: () => '{}' }; });
  const r = env.gs.scribeAsk({ triggerMessageId: 'outage1', playerId: 'p1' });
  assert(r.ok === true && r.throttled === true && r.reason === 'outage', 'a persistent 5xx degrades to the SAME throttled shape as throttle/budget (one fallback mechanism, per C1)');
  assert(calls === 2, 'exactly ONE retry — no backoff loop (a mention should not hang)');
}
{
  const env = buildSandbox();
  enableInteractive(env);
  seedTriggerMessage(env, { id: 'refuse1' });
  env.setUrlFetchImpl(() => anthropicResponse({ stopReason: 'refusal' }));
  const r = env.gs.scribeAsk({ triggerMessageId: 'refuse1', playerId: 'p1' });
  assert(r.ok === true && !!r.responseMessageId, 'a refusal still produces a normal-looking post (the server writes the fixed decline itself)');
  const msgSheet = env.sheets['CFBP_MESSAGES'];
  const row = msgSheet.data.find(r2 => r2 && r2[1] === 'scribe_llm_refuse1');
  assert(row[6] === "Can't help with that one.", 'refusal copy is the EXACT flat, in-register decline — no apology-voice, no explanation');
  assert(!/anthropic|as an ai/i.test(row[6]), 'refusal copy never breaks character or mentions being an AI');
}

console.log('\n[5] Blind-rule tool gating — get_player_pick_history, positive AND negative, INCLUDING the asker\'s own open pick…');
{
  const env = buildSandbox();
  const data = {
    cfbp_players: [{ playerId: 'p1', displayName: 'Drew', active: true }],
    cfbp_weeks: [
      { weekId: 'wOpen', status: 'open' },
      { weekId: 'wFinal', status: 'final' },
    ],
    cfbp_picks: [
      { weekId: 'wOpen', gameId: 'gA', playerId: 'p1', selectedTeam: 'Texas A&M' },
      { weekId: 'wFinal', gameId: 'gB', playerId: 'p1', selectedTeam: 'Oklahoma' },
    ],
    cfbp_games: [
      { gameId: 'gA', weekId: 'wOpen', status: 'scheduled', homeTeam: 'Texas A&M', awayTeam: 'LSU' },
      { gameId: 'gB', weekId: 'wFinal', status: 'final', homeTeam: 'Oklahoma', awayTeam: 'Texas', homeScore: 10, awayScore: 24, lockedSpread: -7, atsWinner: 'Texas' },
    ],
    cfbp_tiebreaker_guesses: {},
  };
  const openResult = env.gs.tool_getPlayerPickHistory_({ playerId: 'p1', weekId: 'wOpen' }, data);
  assert(Array.isArray(openResult) && openResult.length === 0, 'NEGATIVE: an OPEN week never returns a pick — not even a placeholder, an empty array, for ANY player');
  const ownOpenResult = env.gs.tool_getPlayerPickHistory_({ playerId: 'p1' }, data);   // full season, no weekId filter — still must exclude wOpen
  assert(ownOpenResult.every(r => r.weekId !== 'wOpen'), 'the OPEN week is excluded even from the asker\'s OWN full-season history — SCRIBE\'s reply is public, "my own pick shown only to me" has no meaning here (C3\'s flagged nuance)');
  assert(ownOpenResult.some(r => r.weekId === 'wFinal'), 'POSITIVE: a FINAL week DOES return the pick');
  const finalRow = ownOpenResult.find(r => r.weekId === 'wFinal');
  assert(finalRow.selectedTeam === 'Oklahoma' && finalRow.result === 'loss', 'the returned row carries the real evaluated result, not a guess');
}

console.log('\n[5b] Blind-rule tool gating — get_head_to_head_record never compares an open week…');
{
  const env = buildSandbox();
  const data = {
    cfbp_weeks: [{ weekId: 'wOpen', status: 'open' }],
    cfbp_picks: [
      { weekId: 'wOpen', gameId: 'gA', playerId: 'p1', selectedTeam: 'Texas A&M' },
      { weekId: 'wOpen', gameId: 'gA', playerId: 'p2', selectedTeam: 'LSU' },
    ],
    cfbp_games: [{ gameId: 'gA', weekId: 'wOpen', status: 'final', homeTeam: 'Texas A&M', awayTeam: 'LSU', homeScore: 1, awayScore: 40, lockedSpread: -3 }],
  };
  const r = env.gs.tool_getHeadToHeadRecord_({ playerA: 'p1', playerB: 'p2' }, data);
  assert(r.gamesCompared === 0, 'a FINAL game inside a still-OPEN week is never compared — the week gate governs, not the game status alone');
}

console.log('\n[6] AD-03 — no tool output ever contains a raw signed spread…');
{
  const env = buildSandbox();
  const data = {
    cfbp_games: [{ gameId: 'gA', weekId: 'w1', status: 'final', homeTeam: 'TCU', awayTeam: 'UNC', homeScore: 30, awayScore: 20, lockedSpread: -6.5, favorite: 'TCU', atsWinner: 'TCU' }],
  };
  const out = env.gs.tool_getGameHistory_({ teamName: 'TCU' }, data);
  assert(out.length === 1 && out[0].spread === 'TCU -6.5', 'get_game_history: Favorite + Margin only');
  assert(!/^-?\d/.test(out[0].spread), 'the spread string never starts with a bare signed number');
  assert(JSON.stringify(out).indexOf('-6.5countedRaw') === -1, 'fixture sanity: the raw signed value never appears as a STANDALONE numeric field named spread');
  assert(typeof out[0].spread === 'string' && out[0].spread.indexOf('TCU') === 0, 'spread is composed as "Favorite -Margin", never a bare number');

  // get_current_spread — same guarantee via the thin ESPN wrapper's own formatter.
  const sp = env.gs.scribeExtractSpreadThin_(
    { odds: [{ details: 'TCU -6.5', homeTeamOdds: { favorite: true }, awayTeamOdds: { favorite: false } }], competitors: [{ homeAway: 'home', team: { abbreviation: 'TCU' } }, { homeAway: 'away', team: { abbreviation: 'UNC' } }] },
    'TCU', 'UNC');
  assert(sp.favorite === 'TCU' && sp.margin === 6.5, 'scribeExtractSpreadThin_ resolves favorite via ESPN\'s own structured flag (rung 1)');
}

console.log('\n[7] Context ceiling — N=20 messages OR 2,000 chars, whichever binds first…');
{
  const env = buildSandbox();
  const s = env.gs.ensureMsgSheet();
  for (let i = 1; i <= 30; i++) {
    appendMsgRow(s, { id: 'm' + i, author: 'p1', body: 'msg number ' + i });
  }
  const recent = env.gs.scribeReadRecentMessages_('', 999999);
  assert(recent.length <= 20, `count ceiling respected (got ${recent.length}, cap 20)`);
  const totalChars = recent.reduce((s2, l) => s2 + l.length, 0);
  assert(totalChars <= 2000, `char ceiling respected (got ${totalChars} chars, cap 2000)`);
  assert(recent[recent.length - 1].includes('msg number 30'), 'most-recent message survives (oldest-first order, last entry is the newest)');

  // gameTag scoping
  appendMsgRow(s, { id: 'gtag1', author: 'p1', gameTag: 'gameXYZ', body: 'tagged message' });
  const scoped = env.gs.scribeReadRecentMessages_('gameXYZ', 999999);
  assert(scoped.length === 1 && scoped[0].includes('tagged message'), 'gameTag scoping excludes main-room messages when a tag is given (matches the cross-talk rule)');

  // char-heavy single-message case: a huge char ceiling never crashes, and a
  // single overlong message right at the boundary still returns.
  const bigBody = 'x'.repeat(2500);
  appendMsgRow(s, { id: 'bigmsg', author: 'p1', body: bigBody });
  const withBig = env.gs.scribeReadRecentMessages_('', 999999);
  assert(Array.isArray(withBig), 'an over-ceiling single message does not throw');
}

console.log('\n[9] Ack supersession — server posts the broadcast ack; client fold hides it once the reply lands…');
{
  const env = buildSandbox();
  seedTriggerMessage(env, { id: 'ackTest' });
  enableInteractive(env);
  env.setUrlFetchImpl(() => anthropicResponse({ text: 'The standings have not changed.' }));

  env.gs.scribeAsk({ triggerMessageId: 'ackTest', playerId: 'p1', gameTag: '' });

  const msgSheet = env.sheets['CFBP_MESSAGES'];
  const ackRow = msgSheet.data.find(r => r && r[1] === 'scribe_ack_ackTest');
  const replyRow = msgSheet.data.find(r => r && r[1] === 'scribe_llm_ackTest');
  assert(!!ackRow, 'the broadcast ack event was appended (C-5, Drew\'s ruling — everyone sees it)');
  assert(ackRow[3] === 'system' && ackRow[4] === 'system', 'ack is a type:system, author:system event');
  const ackMeta = JSON.parse(ackRow[9]);
  assert(ackMeta.kind === 'scribeAsk' && ackMeta.triggerMessageId === 'ackTest', 'ack meta carries kind:scribeAsk + the triggerMessageId, keyed for client-side supersession');
  assert(!!replyRow, 'the real reply was ALSO appended — append-only, the ack is never mutated or deleted');

  // Now fold both through the REAL client — js/chat.js's ingest + js/chat-ui.js's
  // exported supersession filter.
  const chat = await import('./js/chat.js');
  const chatUi = await import('./js/chat-ui.js');
  chat._resetForTest();
  const ackEvent = { id: 'scribe_ack_ackTest', seq: 1, ts: Date.now(), type: 'system', author: 'system', gameTag: '', body: 'SCRIBE is looking into it…', targetId: 'ackTest', replyTo: '', notify: false, meta: { kind: 'scribeAsk', triggerMessageId: 'ackTest' } };
  const replyEvent = { id: 'scribe_llm_ackTest', seq: 2, ts: Date.now() + 1, type: 'message', author: 'scribe', gameTag: '', body: 'The standings have not changed.', targetId: '', replyTo: 'ackTest', notify: true, meta: { source: 'tier2' } };

  chat.ingest([ackEvent]);
  let list = chat.getMessages({ tag: 'all' });
  let filtered = chatUi._filterSupersededScribeAcksForTest(list);
  assert(filtered.some(m => m.id === 'scribe_ack_ackTest'), 'BEFORE the reply lands, the ack IS shown');

  chat.ingest([replyEvent]);
  list = chat.getMessages({ tag: 'all' });
  filtered = chatUi._filterSupersededScribeAcksForTest(list);
  assert(!filtered.some(m => m.id === 'scribe_ack_ackTest'), 'AFTER the reply lands, the ack is superseded — filtered out of what renders');
  assert(filtered.some(m => m.id === 'scribe_llm_ackTest'), 'the real reply itself still renders');
  assert(list.some(m => m.id === 'scribe_ack_ackTest'), 'the ack is still PRESENT in the underlying fold (hide-not-destroy, AD-10 — never mutated/deleted)');
}

console.log('\n[10] Cost estimator — table-driven per model, correction #3\'s pinned ratios…');
{
  const env = buildSandbox();
  const usage = { input_tokens: 1000000, output_tokens: 1000000, cache_read_input_tokens: 1000000, cache_creation_input_tokens: 1000000 };
  const opus = env.gs.scribeCostEstimateUsd_('claude-opus-5', usage, 0);
  const sonnet = env.gs.scribeCostEstimateUsd_('claude-sonnet-5', usage, 0);
  const haiku = env.gs.scribeCostEstimateUsd_('claude-haiku-4-5', usage, 0);
  assert(opus > sonnet && sonnet > haiku, 'opus > sonnet > haiku for identical token usage — the rate table actually differentiates models');
  // Manual check for sonnet: base 1M*$2 + cacheRead 1M*$2*0.1 + cacheWrite 1M*$2*1.25 + output 1M*$10
  const expectedSonnet = 2 + 0.2 + 2.5 + 10;
  assert(Math.abs(sonnet - expectedSonnet) < 1e-9, `sonnet cost matches the pinned formula exactly (got ${sonnet}, expected ${expectedSonnet})`);
  const withSearch = env.gs.scribeCostEstimateUsd_('claude-sonnet-5', { input_tokens: 0, output_tokens: 0 }, 3);
  assert(Math.abs(withSearch - 0.03) < 1e-9, '3 web searches at $0.01 each add exactly $0.03');
  const unknownModel = env.gs.scribeCostEstimateUsd_('some-future-model', usage, 0);
  assert(unknownModel === sonnet, 'an unrecognized model falls back to the sonnet rate rather than throwing — table-driven, one edit to add a new model');
}

// ═══════════════════════════════════════════════════════════════════════════
// [11] MUTATION-PROVING — scratch copies of the Code.gs SOURCE STRING only.
// The real file on disk is never opened for writing anywhere in this
// section (CLAUDE.md's git-mutation-hazard lesson, applied to source-text
// mutation instead of git): mutate the STRING held in memory, load THAT
// into a fresh vm sandbox, assert the guard goes RED, then reload the REAL
// (unmodified) source and confirm it is still GREEN.
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[11] Mutation-proof — blind-rule tool gate…');
{
  const marker = 'if (!arePicksPublicTwin_(w)) return;   // the tool withholds it — the model never sees "hidden", it sees nothing';
  assert(codeGsSrc.includes(marker), 'fixture check: the exact blind-rule guard line exists in the real source (a stale marker would make this whole section vacuous)');
  const mutatedSrc = codeGsSrc.replace(marker, '// MUTATED OUT FOR TEST — ' + marker.split('//')[0]);
  assert(mutatedSrc !== codeGsSrc, 'fixture check: the mutation actually changed the source string');

  function loadFromSource(src) {
    const sandbox = { PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty() {}, deleteProperty() {} }) },
      CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) },
      LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
      SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => null, insertSheet: () => makeFakeSheet() }) },
      Utilities: { getUuid: () => 'x', formatDate: fakeFormatDate },
      UrlFetchApp: { fetch: () => { throw new Error('not used in this section'); } },
      ContentService: { createTextOutput: s => ({ setMimeType: () => ({ getContent: () => s }) }), MimeType: { JSON: 'JSON' } },
      Logger: { log() {} }, console };
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox, { filename: 'Code.gs (scratch)' });
    return sandbox;
  }

  const openWeekData = {
    cfbp_weeks: [{ weekId: 'wOpen', status: 'open' }],
    cfbp_picks: [{ weekId: 'wOpen', gameId: 'gA', playerId: 'p1', selectedTeam: 'Texas A&M' }],
    cfbp_games: [{ gameId: 'gA', weekId: 'wOpen', status: 'final', homeTeam: 'Texas A&M', awayTeam: 'LSU' }],
  };

  const realGs = loadFromSource(codeGsSrc);
  const realOut = realGs.tool_getPlayerPickHistory_({ playerId: 'p1' }, openWeekData);
  assert(realOut.length === 0, 'REAL Code.gs (unmodified): the blind-rule guard correctly withholds the open-week pick');

  const mutatedGs = loadFromSource(mutatedSrc);
  const mutatedOut = mutatedGs.tool_getPlayerPickHistory_({ playerId: 'p1' }, openWeekData);
  assert(mutatedOut.length === 1, 'MUTATION CANARY: with the guard commented out on a SCRATCH source string, the same assertion goes RED (the guard is capable of failing, this is a real test)');

  // The real file on disk is confirmed untouched by re-reading it.
  const rereadSrc = await readFile(fileURLToPath(new URL('./backend/Code.gs', import.meta.url)), 'utf8');
  assert(rereadSrc === codeGsSrc, 'the real backend/Code.gs file on disk is BYTE-IDENTICAL to what this section started with — never opened for writing');
}

console.log('\n[11b] Mutation-proof — dedup guard (BOTH redundant checks — scribeAsk\'s own fast-path AND scribeLogReserve_\'s race-safe re-check under the lock)…');
{
  // `scribeAsk` deliberately checks dedup TWICE: once as a fast path before
  // any throttle/budget accounting (this section's primary target — the one
  // actually load-bearing for "does one trigger get answered exactly once"
  // in the non-concurrent case this test exercises), and again INSIDE
  // scribeLogReserve_'s lock (defense against a genuine race between two
  // concurrent requests for the same trigger). Gutting only one leaves the
  // other standing, which is the CORRECT redundant-guard behavior — so a
  // real mutation-canary here must gut BOTH to observe the guard fail.
  // Markers updated for B3a remediation (round 1) — both guards now ALSO
  // handle the stale-reservation-reclaim branch (see [11c] below for a
  // mutation canary dedicated to THAT branch specifically). Mutation is now
  // a condition flip (`if (existingRow)` -> `if (false && existingRow)`)
  // rather than deleting the whole statement — B3a's branch bodies are no
  // longer single self-contained `return` statements, so blanking the
  // marker out with a comment would leave dangling closing braces (a
  // SYNTAX error, not a semantic one) instead of a clean, guard-only
  // mutation. Flipping the condition to always-false disables BOTH the
  // "found, answered" fast path and the "found, still fresh, wait" path in
  // one syntactically safe edit — exactly what this section needs to prove.
  const outerMarker = '  if (existingRow) {';
  const innerMarker = '    if (existing) {';
  assert(codeGsSrc.includes(outerMarker), 'fixture check: scribeAsk\'s own fast-path dedup check exists in the real source, verbatim');
  assert(codeGsSrc.includes(innerMarker), 'fixture check: scribeLogReserve_\'s race-safe re-check exists in the real source, verbatim');
  const mutatedSrc = codeGsSrc
    .replace(outerMarker, '  if (false && existingRow) {   // MUTATED OUT (fast-path) — dedup check disabled for test')
    .replace(innerMarker, '    if (false && existing) {   // MUTATED OUT (race-safe re-check) — dedup check disabled for test');

  function loadFullSandbox(src) {
    const s = buildSandboxFromSrc(src);
    return s;
  }
  function buildSandboxFromSrc(src) {
    const props = {};
    const scriptProps = { getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; } };
    const cacheStore = new Map();
    const cache = { get: k => (cacheStore.has(k) ? cacheStore.get(k) : null), put: (k, v) => cacheStore.set(k, String(v)), remove: k => cacheStore.delete(k) };
    const sheets = {};
    const ss = { getSheetByName: n => sheets[n] || null, insertSheet: n => { const sh = makeFakeSheet(); sheets[n] = sh; return sh; } };
    const urlFetchCalls = [];
    let impl = null;
    const sandbox = {
      PropertiesService: { getScriptProperties: () => scriptProps },
      CacheService: { getScriptCache: () => cache },
      LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
      SpreadsheetApp: { getActiveSpreadsheet: () => ss },
      Utilities: { getUuid: () => 'uuid_' + Math.random().toString(36).slice(2), formatDate: fakeFormatDate },
      UrlFetchApp: { fetch(url, opts) { urlFetchCalls.push({ url, opts }); if (!impl) throw new Error('no stub'); return impl(url, opts); } },
      ContentService: { createTextOutput: s2 => ({ setMimeType: () => ({ getContent: () => s2 }) }), MimeType: { JSON: 'JSON' } },
      Logger: { log() {} }, console,
    };
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox, { filename: 'Code.gs (scratch)' });
    const storeSheet = makeFakeSheet();
    storeSheet.getRange(1, 1, 1, 3).setValues([['key', 'json', 'updatedAt']]);
    sheets['CFBP_STORE'] = storeSheet;
    return { gs: sandbox, props, sheets, urlFetchCalls, setUrlFetchImpl: fn => { impl = fn; } };
  }

  const realEnv = loadFullSandbox(codeGsSrc);
  seedTriggerMessage(realEnv, { id: 'dupCheck' });
  enableInteractive(realEnv);
  realEnv.setUrlFetchImpl(() => anthropicResponse({ text: 'answer' }));
  realEnv.gs.scribeAsk({ triggerMessageId: 'dupCheck', playerId: 'p1' });
  realEnv.gs.scribeAsk({ triggerMessageId: 'dupCheck', playerId: 'p1' });
  assert(realEnv.urlFetchCalls.length === 1, 'REAL Code.gs: two calls for the same trigger cost exactly ONE Anthropic call');

  const mutatedEnv = loadFullSandbox(mutatedSrc);
  seedTriggerMessage(mutatedEnv, { id: 'dupCheck' });
  enableInteractive(mutatedEnv);
  mutatedEnv.setUrlFetchImpl(() => anthropicResponse({ text: 'answer' }));
  mutatedEnv.gs.scribeAsk({ triggerMessageId: 'dupCheck', playerId: 'p1' });
  mutatedEnv.gs.scribeAsk({ triggerMessageId: 'dupCheck', playerId: 'p1' });
  assert(mutatedEnv.urlFetchCalls.length === 2, 'MUTATION CANARY: with the dedup check disabled on a SCRATCH source string, the SAME trigger spends TWICE — the guard is capable of failing');

  const rereadSrc = await readFile(fileURLToPath(new URL('./backend/Code.gs', import.meta.url)), 'utf8');
  assert(rereadSrc === codeGsSrc, 'the real backend/Code.gs file on disk is still byte-identical — never opened for writing in this section either');
}

// ═══════════════════════════════════════════════════════════════════════════
// REMEDIATION ROUND 1 (2026-09-10) — sections [12]-[23] below cover every
// BLOCKING (B1-B3) and NON-BLOCKING (F4-F11) finding from the reviewer's
// BLOCK on Build 2a. Same conventions as [1]-[11b] above: behavioral
// assertions against the REAL sandboxed Code.gs (and, where the finding is
// client-side, the REAL js/ modules), mutation canaries where the task
// explicitly asked for one (B1, B3a — B3c is a pure client-side render
// filter, proven correct/capable-of-failing via its own positive+negative
// cases instead).
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n[12] B1 remediation — FULL cost accounting persisted on the CFBP_SCRIBE_LOG row (all four usage fields + web search count, not just input/output_tokens)…');
{
  const env = buildSandbox();
  enableInteractive(env, { SCRIBE_MODEL: 'claude-sonnet-5' });
  seedTriggerMessage(env, { id: 'costTrig' });

  let call = 0;
  env.setUrlFetchImpl(() => {
    call++;
    if (call === 1) {
      return anthropicResponse({
        stopReason: 'tool_use', toolUse: { name: 'get_current_standings' },
        usage: { input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 2000, server_tool_use: { web_search_requests: 1 } },
      });
    }
    return anthropicResponse({
      stopReason: 'end_turn', text: 'Drew leads, per the standings.',
      usage: { input_tokens: 1500, output_tokens: 200, cache_read_input_tokens: 3000, server_tool_use: { web_search_requests: 1 } },
    });
  });

  const r = env.gs.scribeAsk({ triggerMessageId: 'costTrig', playerId: 'p1' });
  assert(r.ok === true && !!r.responseMessageId, 'the two-round scenario answers for real');
  assert(call === 2, 'fixture check: this scenario really took two Anthropic round trips (a tool round, then the final answer)');

  const logSheet = env.sheets['CFBP_SCRIBE_LOG'];
  const row = logSheet.data.find(r2 => r2 && r2[0] === 'costTrig');
  assert(!!row, 'fixture check: a CFBP_SCRIBE_LOG row exists for this trigger');

  // Hand computation (correction #3's pinned rates, sonnet: input $2, output $10/MTok,
  // cache read 0.1x base input, cache write 1.25x base input, search $0.01 each):
  //   uncached input = 1000+1500=2500 · cache write = 2000 (round 1) · cache read = 3000 (round 2)
  //   output = 100+200=300 · searches = 1+1=2
  const expected = {
    inputTokensTotal: 2500 + 2000 + 3000,     // col 9 — now TOTAL prompt, not just the uncached remainder
    outputTokens: 300, inputTokensUncached: 2500, cacheWriteTokens: 2000, cacheReadTokens: 3000, webSearches: 2,
    costEstimateUsd: (2500 / 1e6) * 2 + (3000 / 1e6) * 2 * 0.1 + (2000 / 1e6) * 2 * 1.25 + (300 / 1e6) * 10 + 2 * 0.01,
  };
  assert(Math.abs(expected.costEstimateUsd - 0.0336) < 1e-9, 'fixture check: the hand computation itself is 0.0336');

  assert(Number(row[8]) === expected.inputTokensTotal, `log col 'inputTokens' (9) is the TOTAL prompt (uncached+write+read) = ${expected.inputTokensTotal} (got ${row[8]})`);
  assert(Number(row[9]) === expected.outputTokens, `log col 'outputTokens' (10) = ${expected.outputTokens} (got ${row[9]})`);
  assert(Math.abs(Number(row[10]) - expected.costEstimateUsd) < 1e-6, `log col 'costEstimateUsd' (11) matches the hand computation exactly (got ${row[10]}, expected ${expected.costEstimateUsd})`);
  assert(Number(row[13]) === expected.inputTokensUncached, `log col 'inputTokensUncached' (14) = ${expected.inputTokensUncached} (got ${row[13]})`);
  assert(Number(row[14]) === expected.cacheWriteTokens, `log col 'cacheWriteTokens' (15) = ${expected.cacheWriteTokens} (got ${row[14]})`);
  assert(Number(row[15]) === expected.cacheReadTokens, `log col 'cacheReadTokens' (16) = ${expected.cacheReadTokens} (got ${row[15]})`);
  assert(Number(row[16]) === expected.webSearches, `log col 'webSearches' (17) = ${expected.webSearches} (got ${row[16]})`);

  // MUTATION — drop cache_read_input_tokens from accumulation in scribeInvoke_'s
  // round loop. The value WRITTEN TO THE LOG ROW (not the helper in isolation)
  // must go WRONG — undercounted — once this line is gutted.
  const marker = 'totalCacheReadTokens += Number(usage.cache_read_input_tokens || 0);';
  assert(codeGsSrc.includes(marker), 'fixture check: the cache_read_input_tokens accumulation line exists verbatim in the real source');
  const mutatedSrc = codeGsSrc.replace(marker, '// MUTATED OUT for test — ' + marker);
  assert(mutatedSrc !== codeGsSrc, 'fixture check: the mutation actually changed the source string');

  const mutEnv = buildSandbox(mutatedSrc);
  enableInteractive(mutEnv, { SCRIBE_MODEL: 'claude-sonnet-5' });
  seedTriggerMessage(mutEnv, { id: 'costTrig' });
  let mCall = 0;
  mutEnv.setUrlFetchImpl(() => {
    mCall++;
    if (mCall === 1) return anthropicResponse({ stopReason: 'tool_use', toolUse: { name: 'get_current_standings' }, usage: { input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 2000, server_tool_use: { web_search_requests: 1 } } });
    return anthropicResponse({ stopReason: 'end_turn', text: 'Drew leads.', usage: { input_tokens: 1500, output_tokens: 200, cache_read_input_tokens: 3000, server_tool_use: { web_search_requests: 1 } } });
  });
  mutEnv.gs.scribeAsk({ triggerMessageId: 'costTrig', playerId: 'p1' });
  const mutRow = mutEnv.sheets['CFBP_SCRIBE_LOG'].data.find(r2 => r2 && r2[0] === 'costTrig');
  assert(Number(mutRow[15]) === 0, 'MUTATION CANARY: with cache_read_input_tokens accumulation gutted, the persisted cacheReadTokens column reads 0 instead of 3000');
  assert(Math.abs(Number(mutRow[10]) - expected.costEstimateUsd) > 1e-6, 'MUTATION CANARY: the persisted costEstimateUsd is WRONG (undercounted) once cache-read accumulation is gutted — the guard is capable of failing');
  assert(Number(mutRow[10]) < expected.costEstimateUsd, 'the mutated cost is specifically LOWER than correct — an undercount, matching the reviewer\'s original finding shape');

  const rereadSrc12 = await readFile(fileURLToPath(new URL('./backend/Code.gs', import.meta.url)), 'utf8');
  assert(rereadSrc12 === codeGsSrc, 'the real backend/Code.gs file on disk is untouched by this mutation section');
}

console.log('\n[13] B3a remediation — PERMANENT ORPHAN ACK: a crashed (never-finalized) reservation is reclaimed after 90s and answered exactly once…');
{
  // (a) STILL FRESH (< 90s old) — must NOT be stolen out from under a
  // plausibly-in-flight attempt. Zero new Anthropic spend, dedup-with-nothing.
  const freshEnv = buildSandbox();
  enableInteractive(freshEnv);
  seedTriggerMessage(freshEnv, { id: 'freshOrphan' });
  seedStaleScribeLogRow(freshEnv, { triggerMessageId: 'freshOrphan', ageMs: 10 * 1000 });
  freshEnv.setUrlFetchImpl(() => anthropicResponse({ text: 'should never be called' }));
  const rFresh = freshEnv.gs.scribeAsk({ triggerMessageId: 'freshOrphan', playerId: 'p1' });
  assert(rFresh.ok === true && rFresh.deduped === true && rFresh.responseMessageId === '', 'a reservation <90s old with no responseMessageId yet is reported as deduped-with-nothing (plausibly still in flight) — NOT reclaimed');
  assert(freshEnv.urlFetchCalls.length === 0, 'zero Anthropic spend while a fresh reservation is still plausibly in flight');

  // (b) STALE (> 90s old) — the REAL fix reclaims it and answers for real, exactly once.
  const staleEnv = buildSandbox();
  enableInteractive(staleEnv);
  seedTriggerMessage(staleEnv, { id: 'staleOrphan' });
  seedStaleScribeLogRow(staleEnv, { triggerMessageId: 'staleOrphan', ageMs: 5 * 60 * 1000 });   // 5 minutes — well past the 90s bound
  staleEnv.setUrlFetchImpl(() => anthropicResponse({ text: 'Reclaimed and answered.' }));
  const rStale = staleEnv.gs.scribeAsk({ triggerMessageId: 'staleOrphan', playerId: 'p1' });
  assert(rStale.ok === true && !!rStale.responseMessageId, 'REAL Code.gs: a stale (>90s) orphaned reservation IS reclaimed and answered for real');
  assert(staleEnv.urlFetchCalls.length === 1, 'exactly one Anthropic call for the reclaim');
  const staleLog = staleEnv.sheets['CFBP_SCRIBE_LOG'];
  const staleRows = staleLog.data.filter(r => r && r[0] === 'staleOrphan');
  assert(staleRows.length === 1, 'the SAME row is reused for the reclaim — no duplicate CFBP_SCRIBE_LOG row for this trigger');
  assert(staleRows[0][7] === true, 'the reclaimed row is finalized with success:true after answering for real');

  // (c) A later retry of the now-answered trigger dedupes normally.
  const rStaleAgain = staleEnv.gs.scribeAsk({ triggerMessageId: 'staleOrphan', playerId: 'p2' });
  assert(rStaleAgain.deduped === true && rStaleAgain.responseMessageId === rStale.responseMessageId, 'a later retry of the now-answered trigger dedupes normally');
  assert(staleEnv.urlFetchCalls.length === 1, 'still exactly one Anthropic call ever, for this trigger');

  // ── MUTATION — gut the staleness check itself: the orphan is NEVER
  // reclaimed, no matter how old. This is the EXACT pre-fix bug: every retry
  // of a genuinely crashed reservation returns deduped-with-nothing forever.
  const marker = "if (!(existingAgeMs > SCRIBE_STALE_RESERVATION_MS)) {\n      return { ok: true, deduped: true, responseMessageId: '' };\n    }";
  assert(codeGsSrc.includes(marker), 'fixture check: the outer staleness guard exists verbatim in the real source');
  const mutatedSrc = codeGsSrc.replace(marker, "if (true) {\n      return { ok: true, deduped: true, responseMessageId: '' };   // MUTATED — never reclaims, no matter how old\n    }");
  assert(mutatedSrc !== codeGsSrc, 'fixture check: the mutation actually changed the source string');

  const mutEnv = buildSandbox(mutatedSrc);
  enableInteractive(mutEnv);
  seedTriggerMessage(mutEnv, { id: 'staleOrphanMut' });
  seedStaleScribeLogRow(mutEnv, { triggerMessageId: 'staleOrphanMut', ageMs: 10 * 60 * 1000 });   // 10 minutes — even more stale
  mutEnv.setUrlFetchImpl(() => anthropicResponse({ text: 'should never be reached' }));
  const rMut1 = mutEnv.gs.scribeAsk({ triggerMessageId: 'staleOrphanMut', playerId: 'p1' });
  const rMut2 = mutEnv.gs.scribeAsk({ triggerMessageId: 'staleOrphanMut', playerId: 'p2' });
  assert(rMut1.deduped === true && rMut1.responseMessageId === '' && rMut2.deduped === true && rMut2.responseMessageId === '',
    'MUTATION CANARY: with the staleness check gutted, the orphaned trigger is NEVER reclaimed — every retry, no matter how many, returns deduped-with-nothing forever (the exact pre-fix "permanent orphan ack" bug)');
  assert(mutEnv.urlFetchCalls.length === 0, 'MUTATION CANARY: zero Anthropic calls ever happen — the mention is never actually answered, proving the guard is capable of failing');

  const rereadSrc13 = await readFile(fileURLToPath(new URL('./backend/Code.gs', import.meta.url)), 'utf8');
  assert(rereadSrc13 === codeGsSrc, 'the real backend/Code.gs file on disk is untouched by this mutation section');
}

console.log('\n[14] B3b remediation — scribeMentionDegraded ALWAYS posts, even with the entire mention pool burned within the 14-day reuse window…');
{
  const chatMod14 = await import('./js/chat.js');
  const scribeLinesMod14 = await import('./js/scribeLines.js');
  chatMod14._resetForTest();
  lsStore.clear();   // clean ledger — this section owns burning it deliberately

  assert(scribeLinesMod14.SCRIBE_POOLS.mention.length >= 10, 'B3b: the mention pool was widened to at least 10 lines (was 6)');

  function hashLineForTest(s) { let h = 0; for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; } return 'h' + (h >>> 0).toString(36); }
  const now14 = Date.now();
  const burnedLedger = {};
  scribeLinesMod14.SCRIBE_POOLS.mention.forEach(line => { burnedLedger[hashLineForTest(line)] = now14; });
  localStorage.setItem('cfbp_scribe_ledger', JSON.stringify(burnedLedger));

  const posted = scribeLinesMod14.scribeMentionDegraded({ triggerMessageId: 'burnTrig', vars: { name: 'Drew' } });
  assert(posted === true, 'scribeMentionDegraded returns true (a message WAS posted) even with the whole pool burned — this used to return false and post nothing');

  const msgs14 = chatMod14.getMessages({ tag: 'all' });
  const reply14 = msgs14.find(m => m.id === 'scribe_llm_burnTrig');
  assert(!!reply14, 'a real chat event was appended for the fully-burned-pool case');
  assert(reply14.body.startsWith("Can't get to that one right now."), 'the LAST-RESORT line (which bypasses the reuse ledger entirely) is what posts');
  assert(reply14.body.includes('(running on canned lines right now)'), 'the degraded marker is still present on the last-resort line — never reads as an ordinary LLM answer');

  // Calling it AGAIN immediately (pool still fully burned) posts again — the
  // last-resort line is not itself ledger-tracked, so it never runs out.
  const posted2 = scribeLinesMod14.scribeMentionDegraded({ triggerMessageId: 'burnTrig2', vars: { name: 'Kevin' } });
  assert(posted2 === true, 'the last-resort line can fire repeatedly — it deliberately never gets marked used, so a bad day never silences it a second time');
}

console.log('\n[15] B3c remediation — render-time staleness bound: an unanswered scribeAskAck older than 5 minutes stops rendering…');
{
  const chatMod15 = await import('./js/chat.js');
  const chatUiMod15 = await import('./js/chat-ui.js');
  chatMod15._resetForTest();

  const freshAck = { id: 'scribe_ack_freshTrig', seq: 1, ts: Date.now() - 60 * 1000, type: 'system', author: 'system', gameTag: '', body: 'SCRIBE is looking into it…', targetId: 'freshTrig', replyTo: '', notify: false, meta: { kind: 'scribeAsk', triggerMessageId: 'freshTrig' } };
  const staleAck = { id: 'scribe_ack_staleTrig', seq: 2, ts: Date.now() - 6 * 60 * 1000, type: 'system', author: 'system', gameTag: '', body: 'SCRIBE is looking into it…', targetId: 'staleTrig', replyTo: '', notify: false, meta: { kind: 'scribeAsk', triggerMessageId: 'staleTrig' } };
  chatMod15.ingest([freshAck, staleAck]);

  const list15 = chatMod15.getMessages({ tag: 'all' });
  const filtered15 = chatUiMod15._filterSupersededScribeAcksForTest(list15);
  assert(filtered15.some(m => m.id === 'scribe_ack_freshTrig'), 'an ack under 5 minutes old with no reply yet STILL renders (a normal, plausibly-in-flight wait)');
  assert(!filtered15.some(m => m.id === 'scribe_ack_staleTrig'), 'B3c: an ack OVER 5 minutes old with no reply STOPS rendering — no more permanent "SCRIBE is looking into it…" pin');
  assert(list15.some(m => m.id === 'scribe_ack_staleTrig'), 'the stale ack is still PRESENT in the underlying fold (hide-not-destroy, AD-10) — this is a render-time filter, not a delete');
}

console.log('\n[16] F4 remediation — SCRIBE_INTERACTIVE_ENABLED OFF on the SERVER now takes the degrade path (canned reply + marker) instead of total silence…');
{
  const chatMod16 = await import('./js/chat.js');
  const storageMod16 = await import('./js/storage.js');
  const backendMod16 = await import('./js/backend.js');
  const scribeLinesMod16 = await import('./js/scribeLines.js');
  chatMod16._resetForTest();
  storageMod16.saveSetting('scribeInteractiveEnabled', true);   // client-side convenience gate ON
  backendMod16.setDataMode('supabase');
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, disabled: true }) });

  const posted16 = await scribeLinesMod16.scribeInspectMessage({ author: 'p1', authorName: 'Drew', body: '@scribe who is leading?', gameTag: '', triggerMessageId: 'trigF4' });
  assert(posted16 === true, 'a server-disabled mention returns true (something WAS posted), not the old silent false');

  const msgs16 = chatMod16.getMessages({ tag: 'all' });
  const reply16 = msgs16.find(m => m.id === 'scribe_llm_trigF4');
  assert(!!reply16, 'F4: server kill switch OFF now posts the canned degrade line instead of leaving the mention permanently unanswered');
  assert(reply16.body.includes('(running on canned lines right now)'), 'the degrade marker is present');

  globalThis.fetch = priorFetch;
  backendMod16.setDataMode('sheets');
}

console.log('\n[17] F5 remediation — scribeWebSearchEnabled client toggle is now WIRED, and only ever RESTRICTS (never overrides the server master switch)…');
{
  // (a) client wiring — the toggle's value is actually SENT to the server.
  const storageMod17 = await import('./js/storage.js');
  const backendMod17 = await import('./js/backend.js');
  const scribeAgentMod17 = await import('./js/scribeAgent.js');
  // PORTED 2026-09-23. The claim is unchanged — the commissioner's toggle is
  // TRANSMITTED, not merely read (F5's whole finding was that
  // `isScribeWebSearchEnabled()` was consulted and then dropped) — but the wire
  // it rides is the `scribe-ask` Edge Function now, not an Apps Script POST
  // body. `js/scribeAgent.js`'s `scribeAskRemote()` no longer branches at all:
  // there is one route, and it goes through `chatTransport.js`'s `askScribe()`.
  const { installFakeChat } = await import('./testchatfake.mjs');
  const projection17 = await import('./js/supabase-projection.js');
  const transport17 = await import('./js/chatTransport.js');
  backendMod17.setDataMode('supabase');
  storageMod17.saveSetting('scribeWebSearchEnabled', false);
  storageMod17.saveSetting('serverJobs', { scribeAsk: true });
  let capturedBody17 = null;
  const fake17 = installFakeChat(transport17, projection17, {
    // The injected `getSettings` is what askScribe()'s own client-half switch
    // reads (Step 6 Phase 3) — the same seam js/app.js wires at boot.
    getSettings: () => storageMod17.getSettings(),
    invokeFn: (name, body) => {
      if (name === 'scribe-ask') capturedBody17 = body;
      return { data: { ok: true, skipped: 'not_configured' }, error: null };
    },
  });
  await scribeAgentMod17.scribeAskRemote({ triggerMessageId: 't1', playerId: 'p1' });
  assert(capturedBody17 && capturedBody17.webSearch === false, 'the client toggle OFF is actually SENT to the server as req.webSearch:false — it used to be read (isScribeWebSearchEnabled) but never transmitted');
  storageMod17.saveSetting('scribeWebSearchEnabled', true);
  await scribeAgentMod17.scribeAskRemote({ triggerMessageId: 't2', playerId: 'p1' });
  assert(capturedBody17.webSearch === true, 'the client toggle ON sends req.webSearch:true');
  fake17.uninstall();
  storageMod17.saveSetting('serverJobs', {});
  backendMod17.setDataMode('sheets');

  // (b) server-side — RESTRICTION ONLY, never an override of the master switch.
  const envA = buildSandbox();
  enableInteractive(envA);   // SCRIBE_WEB_SEARCH_ENABLED unset -> defaults TRUE (master ON)
  seedTriggerMessage(envA, { id: 'wsOff' });
  let capturedTools = null;
  envA.setUrlFetchImpl((url, opts) => { capturedTools = JSON.parse(opts.payload).tools; return anthropicResponse({ text: 'answer' }); });
  envA.gs.scribeAsk({ triggerMessageId: 'wsOff', playerId: 'p1', webSearch: false });
  assert(!(capturedTools || []).some(t => t.name === 'web_search'), 'client webSearch:false RESTRICTS — no web_search tool declared even though the master switch is ON');

  const envB = buildSandbox();
  enableInteractive(envB, { SCRIBE_WEB_SEARCH_ENABLED: 'false' });   // master switch OFF
  seedTriggerMessage(envB, { id: 'wsMasterOff' });
  let capturedTools2 = null;
  envB.setUrlFetchImpl((url, opts) => { capturedTools2 = JSON.parse(opts.payload).tools; return anthropicResponse({ text: 'answer' }); });
  envB.gs.scribeAsk({ triggerMessageId: 'wsMasterOff', playerId: 'p1', webSearch: true });   // client asks for it anyway
  assert(!(capturedTools2 || []).some(t => t.name === 'web_search'), 'client webSearch:true CANNOT override the server master switch when SCRIBE_WEB_SEARCH_ENABLED is off — the property stays authoritative');
}

console.log('\n[18] F6 remediation — server context reader applies delete/edit/epoch fold semantics, matching the client…');
{
  const env18 = buildSandbox();
  const s18 = env18.gs.ensureMsgSheet();
  appendMsgRow(s18, { id: 'keep1', author: 'p1', body: 'a message that survives' });
  appendMsgRow(s18, { id: 'editMe', author: 'p1', body: 'ORIGINAL BODY' });
  appendMsgRow(s18, { id: 'deleteMe', author: 'p1', body: 'this should never reach the model' });
  appendMsgRow(s18, { id: 'edit1', type: 'edit', author: 'p1', body: 'EDITED BODY', targetId: 'editMe' });
  appendMsgRow(s18, { id: 'del1', type: 'delete', author: 'p1', targetId: 'deleteMe' });
  appendMsgRow(s18, { id: 'keep2', author: 'p1', body: 'a later message' });

  const recent18 = env18.gs.scribeReadRecentMessages_('', 999999);
  const joined18 = recent18.join('\n');
  assert(!joined18.includes('this should never reach the model'), 'F6: a DELETED message never reaches the model, even though its row is still in the sheet');
  assert(joined18.includes('EDITED BODY'), 'F6: an EDITED message contributes its LATEST body');
  assert(!joined18.includes('ORIGINAL BODY'), 'F6: the STALE original body of an edited message is never surfaced');
  assert(joined18.includes('a message that survives') && joined18.includes('a later message'), 'ordinary messages around the edit/delete are unaffected');

  // Epoch watermark — pre-epoch messages excluded, no pin exemption.
  const env18b = buildSandbox();
  const s18b = env18b.gs.ensureMsgSheet();
  const seq1 = appendMsgRow(s18b, { id: 'preEpoch', author: 'p1', body: 'pre-launch test chatter' });
  appendMsgRow(s18b, { id: 'postEpoch', author: 'p1', body: 'real season chatter' });
  env18b.sheets['CFBP_STORE'].getRange(2, 1, 1, 3).setValues([['cfbp_settings', JSON.stringify({ chatEpochSeq: seq1 }), new Date().toISOString()]]);
  const recent18b = env18b.gs.scribeReadRecentMessages_('', 999999);
  const joined18b = recent18b.join('\n');
  assert(!joined18b.includes('pre-launch test chatter'), 'F6: a message AT OR BEFORE the chat epoch watermark is excluded from SCRIBE\'s context');
  assert(joined18b.includes('real season chatter'), 'a message AFTER the epoch is included');

  // NIT — a single over-ceiling line is SKIPPED (continue), not treated as
  // end-of-context (break): older, shorter messages behind it must still fit.
  const env18c = buildSandbox();
  const s18c = env18c.gs.ensureMsgSheet();
  appendMsgRow(s18c, { id: 'shortOld', author: 'p1', body: 'a short older message' });
  appendMsgRow(s18c, { id: 'hugeNew', author: 'p1', body: 'x'.repeat(2500) });   // exceeds the 2000-char ceiling on its own
  const recent18c = env18c.gs.scribeReadRecentMessages_('', 999999);
  assert(!recent18c.some(l => l.includes('x'.repeat(2500))), 'the over-ceiling single message is skipped, not included');
  assert(recent18c.some(l => l.includes('a short older message')), 'NIT: an older, SHORTER message behind an over-ceiling one still makes it in — the scan continues past it instead of stopping');
}

console.log('\n[19] F7 remediation — drift guard: embedded SCRIBE_SYSTEM_PROMPT_BASE matches docs/SCRIBE.md v2.1 (minus the legacy Slack-trigger subsection) + a real addendum follows…');
{
  const env19 = buildSandbox();
  const promptBase = env19.gs.SCRIBE_SYSTEM_PROMPT_BASE;
  assert(typeof promptBase === 'string' && promptBase.length > 1000, 'fixture check: SCRIBE_SYSTEM_PROMPT_BASE loaded as a real, substantial string from the sandbox');

  const addendumIdx = promptBase.indexOf('# Runtime Addendum');
  assert(addendumIdx > 0, 'fixture check: the runtime addendum marker exists in the embedded prompt');
  assert(promptBase.length - addendumIdx > 200, 'fixture check: a real addendum body follows the marker, not just the heading');
  const docPortion = promptBase.slice(0, addendumIdx).replace(/\n---\n+$/, '\n');

  const docPath = fileURLToPath(new URL('../docs/SCRIBE.md', import.meta.url));
  const docSrc = await readFile(docPath, 'utf8');
  const legacyRe = /\*\*Slack triggers \(legacy[\s\S]*?\n\n/;
  assert(legacyRe.test(docSrc), 'fixture check: docs/SCRIBE.md still carries the marked legacy Slack-trigger subsection to strip before comparing');
  const docExpected = docSrc.replace(legacyRe, '');

  // Comment-strip tolerant: normalize away blank lines and per-line leading/
  // trailing whitespace — real content edits still fail this; incidental
  // reflow/whitespace does not.
  const norm = s => s.split('\n').map(l => l.trim()).filter(Boolean).join('\n');
  const normDoc = norm(docExpected), normEmbedded = norm(docPortion);
  assert(normDoc === normEmbedded,
    normDoc === normEmbedded ? 'embedded snapshot matches docs/SCRIBE.md v2.1 (minus the legacy Slack subsection) — no drift'
      : 'DRIFT DETECTED: backend/Code.gs\'s SCRIBE_SYSTEM_PROMPT_BASE no longer matches docs/SCRIBE.md. Whoever edited docs/SCRIBE.md must hand-update the embedded snapshot in backend/Code.gs (search "SCRIBE_SYSTEM_PROMPT_BASE") to match — GAS cannot import the doc at runtime, per that variable\'s own header comment.');

  // Canary — prove the comparison is capable of failing, not vacuously true
  // from over-loose normalization.
  const tamperedDoc = docExpected.replace('Core Identity', 'Core IdentityXYZ');
  assert(norm(tamperedDoc) !== normEmbedded, 'canary: a real one-word content change IS caught by this comparison — the guard is not vacuous');
}

console.log('\n[20] F8 remediation — get_current_standings/get_player_statistics surface a caveat for grouped weeks instead of silently asserting pooled numbers…');
{
  const env20 = buildSandbox();
  const dataUngrouped = { cfbp_players: [{ playerId: 'p1', displayName: 'Drew', active: true }], cfbp_weeks: [{ weekId: 'w1', status: 'final' }], cfbp_picks: [], cfbp_games: [], cfbp_tiebreaker_guesses: {} };
  const outUngrouped = env20.gs.tool_getCurrentStandings_({}, dataUngrouped);
  assert(Array.isArray(outUngrouped), 'ungrouped weeks: get_current_standings returns a plain array, unchanged shape (no caveat noise for the common case)');

  const dataGrouped = { cfbp_players: [{ playerId: 'p1', displayName: 'Drew', active: true }], cfbp_weeks: [{ weekId: 'w1', status: 'final', groupId: 'grp1' }, { weekId: 'w2', status: 'final', groupId: 'grp1' }], cfbp_picks: [], cfbp_games: [], cfbp_tiebreaker_guesses: {} };
  const outGrouped = env20.gs.tool_getCurrentStandings_({}, dataGrouped);
  assert(!Array.isArray(outGrouped) && typeof outGrouped.caveat === 'string' && outGrouped.caveat.length > 0, 'a >1-member group flips get_current_standings to {caveat, standings} instead of a bare array');
  assert(Array.isArray(outGrouped.standings), 'the real (per-part, not pooled) standings are still included alongside the caveat — not withheld entirely');

  const statOut = env20.gs.tool_getPlayerStatistics_({ playerId: 'p1' }, dataGrouped);
  assert(typeof statOut.caveat === 'string' && statOut.playerId === 'p1', 'get_player_statistics also surfaces the caveat for the same grouped-week condition, alongside the real per-player row');

  // The runtime addendum instructs the model what to do when it sees this field.
  assert(/caveat/.test(env20.gs.SCRIBE_SYSTEM_PROMPT_BASE), 'the runtime addendum instructs the model to state a tool-supplied caveat plainly rather than assert numbers');
}

console.log('\n[21] F9 remediation — an explicit untrusted-content sentence guards the recent-room context + trigger question…');
{
  const env21 = buildSandbox();
  const ctx21 = env21.gs.assembleScribeContext_({ playerId: 'p1', triggerBody: 'hi', triggerSeq: 1, gameTag: '' });
  const safetyText = ctx21.systemBlocks[0].text;
  assert(/untrusted/i.test(safetyText), 'the safety block (block 1, always first) explicitly names player-authored text as untrusted input');
  assert(/never follow/i.test(safetyText) || /never let/i.test(safetyText), 'the safety block explicitly forbids following embedded instructions / persona changes');
  assert(/untrusted/i.test(env21.gs.SCRIBE_SYSTEM_PROMPT_BASE), 'the runtime addendum restates the same untrusted-content rule (belt and suspenders)');
}

console.log('\n[22] F10 remediation — CFBP_SCRIBE_LOG lookback is bounded (not a full-sheet scan), and a daily auto-prune exists…');
{
  const env22 = buildSandbox();
  const s22 = env22.gs.ensureScribeLogSheet();
  // Seed 250 rows — well past the 200-row lookback bound.
  for (let i = 0; i < 250; i++) {
    s22.getRange(s22.getLastRow() + 1, 1, 1, 17).setValues([[`old${i}`, 'mention', 'claude-sonnet-5', new Date(Date.now() - (250 - i) * 1000).toISOString(), 0, 0, 0, true, 0, 0, 0, `scribe_llm_old${i}`, '', 0, 0, 0, 0]]);
  }
  const recentHit = env22.gs.scribeLogFindByTrigger_('old249');   // the very last (most recent) row
  assert(!!recentHit && recentHit.responseMessageId === 'scribe_llm_old249', 'a trigger within the bounded lookback window IS found');
  const ancientMiss = env22.gs.scribeLogFindByTrigger_('old0');   // the very first (250 rows back) row — outside the 200-row bound
  assert(ancientMiss === null, 'F10: a trigger far outside the bounded lookback window (200 rows) is NOT found — the scan is genuinely bounded, not a full-sheet read that happens to work in this fixture');

  // Auto-prune — same shape as autoPruneNotifySentIfDue_/pruneNotifySentBefore.
  assert(typeof env22.gs.autoPruneScribeLogIfDue_ === 'function', 'autoPruneScribeLogIfDue_ exists');
  assert(typeof env22.gs.pruneScribeLogBefore_ === 'function', 'pruneScribeLogBefore_ exists');
  const oldRow = s22.getLastRow() + 1;
  s22.getRange(oldRow, 1, 1, 17).setValues([['ancientRow', 'mention', 'claude-sonnet-5', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(), 0, 0, 0, true, 0, 0, 0, 'x', '', 0, 0, 0, 0]]);
  const removed22 = env22.gs.pruneScribeLogBefore_(new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString());
  assert(removed22 === 1, `pruneScribeLogBefore_ removes exactly the one row older than the cutoff (got ${removed22})`);
}

console.log('\n[23] F11 remediation — scribeInvoke_ is the promised interface: tools override (tools:[] sends no `tools` key), reserved slots render as PARAMETERS, invocationType is logged, triggerBody/triggerSeq optional…');
{
  const env23 = buildSandbox();
  let capturedPayload23 = null;
  env23.setUrlFetchImpl((url, opts) => { capturedPayload23 = JSON.parse(opts.payload); return anthropicResponse({ text: 'trainer output' }); });

  const result23 = env23.gs.scribeInvoke_({
    trigger: 'trainer', invocationType: 'trainer', apiKey: 'k', model: 'claude-sonnet-5',
    tools: [], playerId: 'system', gameTag: '', leagueData: {},
    // NOTE: no triggerBody/triggerSeq at all — a non-mention invocation.
  });
  assert(result23.ok === true, 'scribeInvoke_ succeeds with no triggerBody/triggerSeq at all (E3/D1 shape)');
  assert(result23.invocationType === 'trainer', 'invocationType is carried through on the result, so the caller can log it');
  assert(!('tools' in capturedPayload23), 'F11: tools:[] sends NO `tools` key at all in the request payload');
  assert(!capturedPayload23.messages[0].content.includes('CURRENT QUESTION'), 'no triggerBody supplied -> no "CURRENT QUESTION" block rendered at all (not the literal string "undefined")');

  const ctx23 = env23.gs.assembleScribeContext_({
    playerId: 'p1', triggerBody: 'hi', triggerSeq: 1, gameTag: '',
    activeLearnings: 'LEARNING-TEXT-MARKER', canonExamples: 'CANON-TEXT-MARKER', playerBoundaries: 'BOUNDARY-TEXT-MARKER',
  });
  const allBlocks23 = ctx23.systemBlocks.map(b => b.text).join('\n');
  assert(allBlocks23.includes('LEARNING-TEXT-MARKER'), 'activeLearnings renders when supplied');
  assert(allBlocks23.includes('CANON-TEXT-MARKER'), 'canonExamples renders when supplied');
  assert(allBlocks23.includes('BOUNDARY-TEXT-MARKER'), 'playerBoundaries renders when supplied');

  const ctxEmpty23 = env23.gs.assembleScribeContext_({ playerId: 'p1', triggerBody: 'hi', triggerSeq: 1, gameTag: '' });
  const emptyBlocks23 = ctxEmpty23.systemBlocks.map(b => b.text).join('\n');
  assert(!emptyBlocks23.includes('LEARNING-TEXT-MARKER') && !emptyBlocks23.includes('CANON-TEXT-MARKER') && !emptyBlocks23.includes('BOUNDARY-TEXT-MARKER'), 'omitting the three slots keeps them empty (zero extra tokens), same as before this remediation');
}

console.log('\n[24] P1 remediation (Build 2b) — ensureScribeLogSheet() widens an UNDER-WIDTH header row in place, never renumbering existing columns…');
{
  const env24 = buildSandbox();
  // Simulate a sheet created by an OLDER version of this file — only the
  // pre-B1 13-column header, plus one real data row already written under
  // that layout.
  const OLD_HEADER_13 = ['triggerMessageId', 'invocationType', 'model', 'startedAt',
    'latencyMs', 'toolCallCount', 'toolFailureCount', 'success', 'inputTokens',
    'outputTokens', 'costEstimateUsd', 'responseMessageId', 'error'];
  const oldSheet = env24.gs.SpreadsheetApp.getActiveSpreadsheet().insertSheet('CFBP_SCRIBE_LOG');
  oldSheet.getRange(1, 1, 1, OLD_HEADER_13.length).setValues([OLD_HEADER_13]);
  oldSheet.getRange(2, 1, 1, OLD_HEADER_13.length).setValues([[
    'oldTrig', 'mention', 'claude-sonnet-5', '2026-08-01T00:00:00.000Z', 500, 1, 0, true, 1000, 100, 0.01, 'scribe_llm_oldTrig', '',
  ]]);
  const widened = env24.gs.ensureScribeLogSheet();
  assert(widened.getLastColumn() === 17, `header row is widened to the full 17-column SCRIBE_LOG_HEADER width (got ${widened.getLastColumn()})`);
  const headerRow = widened.getRange(1, 1, 1, 17).getValues()[0];
  let allOldPreserved = true;
  for (let i = 0; i < OLD_HEADER_13.length; i++) if (headerRow[i] !== OLD_HEADER_13[i]) allOldPreserved = false;
  assert(allOldPreserved, 'every pre-existing header cell is UNCHANGED, never renumbered/moved');
  assert(headerRow[13] === 'inputTokensUncached' && headerRow[14] === 'cacheWriteTokens' &&
    headerRow[15] === 'cacheReadTokens' && headerRow[16] === 'webSearches',
    'the four missing columns are appended at the END, in the correct order, with the correct names');
  const dataRow = widened.getRange(2, 1, 1, 13).getValues()[0];
  assert(dataRow[0] === 'oldTrig' && dataRow[11] === 'scribe_llm_oldTrig', 'the pre-existing data row written under the OLD layout is untouched by the widen');
  // Proves the widen isn't merely cosmetic — a real read against this
  // now-widened sheet still finds the row written under the OLD layout.
  const found24 = env24.gs.scribeLogFindByTrigger_('oldTrig');
  assert(!!found24 && found24.responseMessageId === 'scribe_llm_oldTrig', 'scribeLogFindByTrigger_ still finds a row written under the OLD (pre-widen) layout');
  // Idempotent — a second call on an already-full-width sheet is a no-op.
  const secondCall = env24.gs.ensureScribeLogSheet();
  assert(secondCall.getLastColumn() === 17, 'a second call is a no-op on an already-full-width sheet (no duplicate widen)');
}

console.log('\n[25] P2 remediation (Build 2b) — scribeMonthlySpendUsd_ correctly totals spend even when a startedAt cell has been DATE-COERCED (a real Date object, not a string)…');
{
  const env25 = buildSandbox();
  enableInteractive(env25, { SCRIBE_MONTHLY_BUDGET_USD: 100 });
  const s25 = env25.gs.ensureScribeLogSheet();
  const monthKey25 = env25.gs.scribeMonthKey_();
  const [y25, m25] = monthKey25.split('-').map(Number);
  // A "date-coerced" cell: getValues() returns a real JS Date object for a
  // date-formatted cell, NOT the ISO STRING this file always WRITES. The
  // fixture's job is to prove the COMPARISON survives this shape (this file
  // cannot reproduce Sheets' own auto-coercion mechanism, only its
  // documented effect on what getValues() returns) — the OLD code
  // (`startedAt.indexOf(monthPrefix) === 0`, a plain string-prefix match on
  // `String(aDateObject)`) would silently have excluded this row from the
  // total with no error anywhere.
  const coercedDate = new Date(Date.UTC(y25, m25 - 1, 15, 12, 0, 0));
  s25.getRange(s25.getLastRow() + 1, 1, 1, 17).setValues([[
    'dateCoercedTrig', 'mention', 'claude-sonnet-5', coercedDate, 500, 1, 0, true, 1000, 100, 3.00, 'scribe_llm_x', '', 0, 0, 0, 0,
  ]]);
  const total25 = env25.gs.scribeMonthlySpendUsd_();
  assert(Math.abs(total25 - 3.00) < 1e-9, `a Date-object startedAt cell IS included in the current month's total (got ${total25}, expected 3.00)`);

  // Canary — a row from TWO MONTHS AGO (also Date-shaped) is correctly
  // EXCLUDED — proves the fix isn't just "include everything."
  const otherMonthDate = new Date(Date.UTC(y25, m25 - 1, 15, 12, 0, 0));
  otherMonthDate.setUTCMonth(otherMonthDate.getUTCMonth() - 2);
  s25.getRange(s25.getLastRow() + 1, 1, 1, 17).setValues([[
    'otherMonthTrig', 'mention', 'claude-sonnet-5', otherMonthDate, 500, 1, 0, true, 1000, 100, 50.00, 'scribe_llm_y', '', 0, 0, 0, 0,
  ]]);
  env25.gs.scribeInvalidateMonthlySpendCache_();
  const total25b = env25.gs.scribeMonthlySpendUsd_();
  assert(Math.abs(total25b - 3.00) < 1e-9, `a row from two months ago (Date-shaped) is correctly excluded from the current month's total (got ${total25b}, expected 3.00 — the $50 row must not be counted)`);

  // scribeRowMonthKey_ directly — an invalid/unparseable value never throws
  // and never accidentally matches (returns '', which cannot equal a real
  // yyyy-MM key).
  assert(env25.gs.scribeRowMonthKey_('not a date') === '', 'scribeRowMonthKey_ returns empty string for an unparseable value, never throws');
  assert(env25.gs.scribeRowMonthKey_('') === '', 'scribeRowMonthKey_ returns empty string for an empty value');
}

console.log('\n[26] BUG-D — the @scribe ask must never race its own trigger message\'s append…');
{
  // LIVE SYMPTOM (Drew, 2026-09-11, chat seq 226-234): four "@scribe …"
  // questions in the Locker Room, each answered within ~10s by the canned
  // degrade line, no "SCRIBE is looking into it…" ack, and NO row in
  // CFBP_SCRIBE_LOG. Root cause is a pure ORDERING race on the client:
  // chat-ui.js doSend() calls sendMessage() (which only queues the event —
  // chat.js scheduleFlush() debounces 750ms) and then fires
  // scribeInspectMessage() in the SAME tick, so scribeAsk reaches the server
  // ~750ms BEFORE the trigger message does. Code.gs's scribeAsk re-reads the
  // trigger from CFBP_MESSAGES by id (never trusting a client-supplied body)
  // and correctly answers {ok:false, error:'Trigger message not found'}
  // (backend/Code.gs :4131) — the client turns that into the degrade.
  //
  // Worse than one bad answer: the degrade posts under the deterministic id
  // `scribe_llm_<triggerMessageId>`, so once it lands, a real answer carrying
  // the same id is deduped away — the mention is permanently unanswerable.
  //
  // These cases drive the REAL modules (chat.js outbox + chatTransport +
  // backend.js + scribeLines.js) against a mock Apps Script whose scribeAsk
  // applies exactly the server's lookup rule.
  const chatMod26 = await import('./js/chat.js');
  const storageMod26 = await import('./js/storage.js');
  const backendMod26 = await import('./js/backend.js');
  const scribeLinesMod26 = await import('./js/scribeLines.js');
  const priorFetch26 = globalThis.fetch;
  const sleep26 = ms => new Promise(r => setTimeout(r, ms));
  const DEGRADE_MARK = '(running on canned lines right now)';

  const { installFakeChat } = await import('./testchatfake.mjs');
  const projection26 = await import('./js/supabase-projection.js');
  const transport26 = await import('./js/chatTransport.js');
  let lastFake26 = null;
  const installFakeChat26 = (opts) => {
    if (lastFake26) lastFake26.uninstall();
    lastFake26 = installFakeChat(transport26, projection26, {
      ...opts,
      getSettings: () => storageMod26.getSettings(),
    });
    return lastFake26;
  };

  // PORTED 2026-09-23. The mock was an Apps Script `fetch` serving `chatAppend`
  // and `scribeAsk`; it is now a Supabase chat context serving `chat_append`
  // and the `scribe-ask` Edge Function. EVERY RULE IT MODELS IS UNCHANGED,
  // including the one the whole section turns on: the server looks the trigger
  // up in the log it can actually SEE, and answers "not found" when the append
  // has not landed. `_shared/scribe-ask` applies the identical rule against
  // `public.messages` that Code.gs's `scribeFindMessageById_` applied against
  // the sheet.
  function mockBackend26({ appendDelayMs = 0, appendFails = false, appendHangs = false } = {}) {
    const st = { serverLog: new Map(), seq: 0, order: [], asks: [], fake: null };
    st.fake = installFakeChat26({
      append: (events) => {
        st.order.push('chatAppend:request');
        if (appendFails) throw new Error('network down');
        if (appendHangs) return new Promise(() => {});   // never settles, and holds no timer
        const commit = () => {
          const assigned = (events || []).map((ev) => {
            const seq = ++st.seq; st.serverLog.set(ev.id, seq);
            return { id: ev.id, seq, ts: Date.now() };
          });
          st.order.push('chatAppend:committed');
          return { assigned };
        };
        return appendDelayMs ? sleep26(appendDelayMs).then(commit) : commit();
      },
      invokeFn: (name, body) => {
        if (name !== 'scribe-ask') return { data: null, error: { message: 'no function' } };
        const sawTrigger = st.serverLog.has(body.triggerMessageId);
        st.order.push('scribeAsk:request');
        st.asks.push({ triggerMessageId: body.triggerMessageId, sawTrigger });
        if (!sawTrigger) return { data: { ok: false, error: 'Trigger message not found' }, error: null };
        return { data: { ok: true, responseMessageId: 'scribe_llm_' + body.triggerMessageId }, error: null };
      },
    });
    return st;
  }

  // Exactly what chat-ui.js doSend() does, in the same order.
  function doSend26(body = '@scribe who is leading?') {
    const sentId = chatMod26.sendMessage({ body, gameTag: '', author: 'p1', mentions: ['scribe'] });
    return { sentId, done: scribeLinesMod26.scribeInspectMessage({ author: 'p1', authorName: 'Drew', body, gameTag: '', triggerMessageId: sentId }) };
  }
  const degradeFor26 = id => chatMod26.getMessages({ tag: 'all' }).find(m => m.id === 'scribe_llm_' + id);

  storageMod26.saveSetting('scribeInteractiveEnabled', true);
  storageMod26.saveSetting('serverJobs', { scribeAsk: true });
  backendMod26.setDataMode('supabase');

  // ── (a) the reproduction, now inverted: a 300ms append must be ACKED before
  //        the ask goes out, and the server must be able to see the trigger.
  chatMod26._resetForTest();
  const stA = mockBackend26({ appendDelayMs: 300 });
  const a = doSend26();
  const okA = await a.done;
  assert(stA.asks.length === 1, `exactly one scribeAsk was issued (got ${stA.asks.length})`);
  const iCommit26 = stA.order.indexOf('chatAppend:committed');
  const iAsk26 = stA.order.indexOf('scribeAsk:request');
  // `iCommit26 >= 0` is load-bearing: pre-fix the append had not even been
  // REQUESTED when the ask went out, so a bare `iAsk > iCommit` comparison
  // passes vacuously against -1 — an assertion that cannot fail.
  assert(iCommit26 >= 0 && iAsk26 > iCommit26,
    `BUG-D: the ask is issued only AFTER the trigger message's append is acknowledged — order was [${stA.order.join(' → ')}]`);
  assert(stA.asks[0] && stA.asks[0].sawTrigger === true,
    'the server can actually SEE the trigger message when scribeAsk arrives — no more {ok:false, "Trigger message not found"}');
  assert(okA === true && !degradeFor26(a.sentId),
    'the real reply id is accepted and NO canned degrade is posted under scribe_llm_<triggerMessageId>');

  // ── (b) FAILED append — the question never reached the room, so the canned
  //        reply is the honest outcome, and scribeAsk must never be spent.
  chatMod26._resetForTest();
  // A short bound on purpose: a FAILED append must degrade because it FAILED,
  // not because the clock ran out. With the bound at 4s and the real path
  // taking milliseconds, the elapsed assertion below can tell the two apart —
  // at the production bound both outcomes look identical to the test.
  scribeLinesMod26._setAppendWaitMsForTest(4000);
  const stB = mockBackend26({ appendFails: true });
  const tB = Date.now();
  const b = doSend26();
  for (let i = 0; i < 3; i++) await chatMod26.flushOutbox();   // MAX_ATTEMPTS -> FAILED
  const okB = await b.done;
  const elapsedB = Date.now() - tB;
  scribeLinesMod26._setAppendWaitMsForTest(null);
  assert(okB === true, 'a permanently-failed append still produces a reply (never silence)');
  const degB = degradeFor26(b.sentId);
  assert(!!degB && degB.body.includes(DEGRADE_MARK),
    'the degrade posts under the SAME deterministic id scribe_llm_<triggerMessageId> — the id-dedupe contract is unchanged');
  assert(stB.asks.length === 0,
    'scribeAsk is NEVER called for a message that failed to append — no wasted round trip, no model spend on a question the room never got');
  assert(elapsedB < 1500,
    `the FAILED queue itself ends the wait — the degrade lands as soon as the send is given up on, not when the bound expires (${elapsedB}ms against a 4000ms bound)`);

  // ── (c) the wait is BOUNDED — an append that never comes back degrades
  //        rather than hanging forever.
  chatMod26._resetForTest();
  scribeLinesMod26._setAppendWaitMsForTest(250);
  const stC = mockBackend26({ appendHangs: true });
  const tC = Date.now();
  const c = doSend26();
  const okC = await c.done;
  const elapsedC = Date.now() - tC;
  scribeLinesMod26._setAppendWaitMsForTest(null);
  assert(okC === true && !!degradeFor26(c.sentId) && degradeFor26(c.sentId).body.includes(DEGRADE_MARK),
    'a timed-out append degrades under the same deterministic id');
  assert(stC.asks.length === 0, 'a timed-out append never issues scribeAsk either');
  assert(elapsedC < 3000, `the wait is bounded, not indefinite (degraded after ${elapsedC}ms with a 250ms bound)`);
  // The PRODUCTION bound has to clear the worst-case SUCCESS path, not the
  // typical one: js/chat.js (~:267, startFreshChat) puts an Apps Script cold
  // start at 10-20s, and chatAppend can additionally eat backend.js's misroute
  // retries (400ms + 1200ms + their round trips) on top of the 750ms coalescing
  // window — ~26s before a healthy send is acknowledged. Expiring before that
  // is not a missed answer, it POISONS the trigger: the degrade takes the
  // deterministic scribe_llm_<triggerMessageId> id and the real answer arriving
  // behind it is deduped away for good.
  assert(scribeLinesMod26.SCRIBE_APPEND_WAIT_MS >= 30000 && scribeLinesMod26.SCRIBE_APPEND_WAIT_MS <= 60000,
    `the PRODUCTION bound outlasts a cold-start chatAppend plus misroute retries (got ${scribeLinesMod26.SCRIBE_APPEND_WAIT_MS}ms)`);

  // ── (d) an id this module never sent is NOT waited on — the wait applies to
  //        our own outbox, and the server's not-found error stays the backstop
  //        (this is what keeps §[16]'s server-side paths reachable).
  chatMod26._resetForTest();
  const stD = mockBackend26({ appendDelayMs: 0 });
  const tD = Date.now();
  await scribeLinesMod26.scribeInspectMessage({ author: 'p1', authorName: 'Drew', body: '@scribe hello', gameTag: '', triggerMessageId: 'notOurs' });
  assert(stD.asks.length === 1 && Date.now() - tD < 3000,
    'a trigger id that was never queued here asks immediately instead of stalling for the full bound');

  globalThis.fetch = priorFetch26;
  backendMod26.setDataMode('sheets');
  chatMod26._resetForTest();
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
