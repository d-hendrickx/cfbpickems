/**
 * CFB Pickems — backendtest.mjs
 * =============================
 * BUG-A (2026-09-11) — "the server answered a different question than the one
 * we asked, and we called it success."
 *
 * Run:  node backendtest.mjs
 *
 * A SEPARATE FILE ON PURPOSE, same rationale synctest.mjs gives: this suite has
 * to drive the REAL backend.hydrate() / chatTransport calls against a stubbed
 * `fetch`, and doing that inside loadtest.mjs would leave the backend singleton
 * hydrated and the storage seam routed through a live mirror for every suite
 * that runs afterward. Transport behaviour needs its own process.
 *
 * WHAT DREW SAW (live site, v0.20.0, 2026-09-11)
 * ----------------------------------------------
 *   1. Comm → Data → "Run Trainer now" → toast: "Trainer run failed. Sync
 *      refused: the server returned no players, weeks or picks while this
 *      device still holds them…"  Twice. The Trainer never ran; nothing was
 *      ever written to cfbp_scribe_learnings/canon/reports.
 *   2. "@scribe" in chat answered with the canned-line degrade ("running on
 *      canned lines right now") instead of a real answer.
 *
 * THE ROOT CAUSE — ONE BUG IN TWO COSTUMES (RG-09's shape exactly)
 * ---------------------------------------------------------------
 * backend/Code.gs `handle()` opened with `var action = req.action || 'ping'`.
 * A request that reaches the server with NO action therefore gets answered with
 * the PING payload — HTTP 200, `{ok:true, time, service:'cfbp-backend',
 * version:2}` — no matter what the client actually asked for. Two real paths
 * deliver an action-less request, BOTH reproduced against the live /exec URL on
 * 2026-09-11:
 *
 *   doGet   — a POST that Apps Script 302-redirects arrives as a GET with no
 *             body and no `action` query param.  `curl -sL "$URL"` → the ping
 *             payload.
 *   doPost  — Apps Script hands doPost an empty `postData.contents` (observed
 *             correlating with cold start).  `curl -sL --data '' "$URL"` → the
 *             ping payload.
 *
 * `call()` in js/backend.js only ever asked `if (!data.ok) throw`. A ping
 * payload IS ok, so every caller read a misrouted reply as a SUCCESSFUL reply
 * to its own action. Downstream:
 *
 *   getAll     → ping shape has no `data` → hydrate()'s `fresh = {}` → the
 *                RG-12 guard fires → "Sync refused…"  (symptom 1's toast text —
 *                a guard doing its job, describing the wrong problem)
 *   scribeAsk  → `{ok:true}` with no responseMessageId → canned degrade (symptom 2)
 *   runTrainer → `{ok:true}` with no `skipped` → app.js treats it as success →
 *                refreshFromBackend() → another misroute → "Sync refused"
 *   set/setMany/chatAppend/notifyPush → `{ok:true}` for a write that NEVER
 *                REACHED THE SERVER → silent data loss.  The worst consequence,
 *                and the one nobody reported because it is invisible.
 *
 * THE GUARD THIS FILE IS
 * ----------------------
 * A reply is MISROUTED when it does not belong to the action that was sent.
 * Detected three ways, newest deployment first:
 *   (a) `misrouted:true`      — the fixed Code.gs says so explicitly
 *   (b) `_action` echo mismatch — the fixed Code.gs echoes, under a RESERVED
 *       name, the action it ran. Underscored on purpose (review finding 2):
 *       the echo is transport metadata, and a handler that one day returns a
 *       top-level `action` of its own must not read as a misroute
 *   (c) `service:'cfbp-backend'` on a non-ping action — the ping marker, which
 *       is the ONLY signal available against a deployment that predates the
 *       Code.gs fix, i.e. the live server right now
 * (c) is why the client fix ships independently of the redeploy, and why it
 * must not be deleted after the redeploy: a browser holding cached JS can talk
 * to any deployment, in either direction.
 */

// ── DOM / browser stubs ──────────────────────────────────────────────────────
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};
globalThis.document = { addEventListener() {}, removeEventListener() {}, hidden: false };
globalThis.window = globalThis;
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'u' + Math.random().toString(36).slice(2) };

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

// ── fetch stub ───────────────────────────────────────────────────────────────
// Every test queues the exact sequence of replies the server will give. A reply
// may be an object or a function(requestBody, url). Running out of replies is a
// FAILURE, not a hang: it means the code under test retried more than expected.
let calls = [];
let replies = [];
globalThis.fetch = async (url, opts = {}) => {
  let body = null;
  if (opts.body) { try { body = JSON.parse(opts.body); } catch { body = opts.body; } }
  calls.push({ url: String(url), method: opts.method || 'GET', body });
  if (!replies.length) throw new Error('fetch stub exhausted — code under test made more requests than the test queued');
  const next = replies.shift();
  const data = typeof next === 'function' ? next(body, String(url)) : next;
  return { ok: true, status: 200, json: async () => data };
};
function arm(...seq) { calls = []; replies = seq.slice(); }

/** The exact payload the live server returns for an action-less request. */
const PING = () => ({ ok: true, time: new Date().toISOString(), service: 'cfbp-backend', version: 2 });

const NAMES = ['Drew', 'Brayden', 'Kevin', 'Koby', 'Jacob', 'Kihoon'];
const snapshot = () => ({
  cfbp_players: NAMES.map((n, i) => ({ playerId: `p${i}`, displayName: n, active: true })),
  cfbp_weeks: [{ weekId: 'w2026_1', status: 'FINAL' }, { weekId: 'w2026_2', status: 'OPEN' }],
  cfbp_picks: [{ pickId: 'pk1', playerId: 'p0', weekId: 'w2026_2' }],
});
const GETALL_OK = () => ({ ok: true, data: snapshot(), chatHead: 227 });
const MIRROR_KEY = 'cfbp_sheet_mirror';

// ══════════════════════════════════════════════════════════════════════════════
// [1]–[9] ARE RETIRED WITH THE CLIENT TRANSPORT THEY DROVE (2026-09-23)
//
// WHAT THEY PROVED — BUG-A and BUG-E, both found live on 2026-09-11.
//
//   BUG-A, THE MISROUTE. `backend/Code.gs`'s `handle()` opened with
//   `var action = req.action || 'ping'`, so a request arriving with no action
//   was answered with the PING payload — HTTP 200, `{ok:true, service:
//   'cfbp-backend'}` — whatever the client had actually asked for. Two paths
//   delivered an action-less request, both reproduced against the live /exec
//   URL: an empty `postData.contents` (correlating with Apps Script cold start),
//   and a POST that Apps Script 302-redirected arriving at doGet as a GET with
//   no body. `call()` only asked `if (!data.ok) throw`, and a ping payload IS
//   ok — so `set`/`setMany`/`chatAppend`/`notifyPush` reported a write that
//   NEVER REACHED THE SERVER as synced. That last one is the dangerous one, and
//   it is the one nobody could report, because it is invisible.
//
//   BUG-E, ITS TWIN. A 404 on a request that had already completed
//   server-side: Apps Script answers a POST with a 302 to a
//   googleusercontent.com URL, and that second leg is a different host on a
//   different edge that can 404, 500 or 503 on its own with the real work done.
//
//   Sections [1]–[9] drove the REAL `call()` against a stubbed fetch: the retry
//   and its landing, the persistent-misroute error text, that hydrate() never
//   clears the mirror on a misroute (the RG-12 axis), that `ping` survives, that
//   the two SPEND actions (`runTrainer`, `scribeAsk`) get exactly one attempt,
//   that idempotent writes DO retry, the `_action` echo, and that the guard
//   stays NARROW so a genuine server error still fails fast with its own message.
//   [13] proved the token rode on every read, and [14] proved the post-cutover
//   allow-list refused thirteen relays before any fetch.
//
// WHY THEY ARE GONE. `call()`, `requestWithMisrouteGuard`, the retry ladder,
// the transient-HTTP set and the allow-list are all deleted with the Apps
// Script transport. There is no 302, no googleusercontent leg and no shared
// token, so there is nothing left to misroute or to refuse. The one fetch left
// in js/backend.js reads `config.json` — a same-origin static file beside
// index.html.
//
// WHAT STILL RUNS BELOW, and why: [10]–[12] are the SERVER TWIN. They execute
// `backend/Code.gs` in a vm and assert the server-side half — that an
// action-less request is never answered with ping, the one-click authorization
// trigger, and that reads require the token. `backend/Code.gs` is still in the
// repo and the Sheet is kept READ-ONLY for the season as the archive
// (SUPABASE_LIVE_RUNBOOK §RETIREMENT step 5), so those assertions are about a
// file that exists. They are the last thing in this suite that is.
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n[1]–[9], [13], [14] RETIRED — the Apps Script client transport they drove is deleted (see the note above)…');
{
  const fs0 = await import('node:fs');
  const { fileURLToPath: f0 } = await import('node:url');
  const beSrc0 = fs0.readFileSync(f0(new URL('./js/backend.js', import.meta.url)), 'utf8');
  const beCode0 = beSrc0.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert(!/async function call\s*\(/.test(beCode0),
    'js/backend.js has no call() — the one function that knew the URL, the token, the misroute guard and the money-safety list');
  assert(!/requestWithMisrouteGuard|isMisroutedResponse|MISROUTE_RETRY_DELAYS|TRANSIENT_HTTP|NO_RETRY_ACTIONS/.test(beCode0),
    '…and none of BUG-A/BUG-E\'s machinery survives it: no misroute guard, no retry ladder, no transient-HTTP set, no NO_RETRY_ACTIONS');
  assert(!/script\.google\.com/.test(beCode0) && !/backendToken/.test(beCode0),
    '…and no Apps Script URL and no token read anywhere in executable code');
  const txSrc0 = fs0.readFileSync(f0(new URL('./js/chatTransport.js', import.meta.url)), 'utf8');
  const txCode0 = txSrc0.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert(!/script\.google\.com/.test(txCode0) && !/searchParams\.set\('token'/.test(txCode0),
    'js/chatTransport.js\'s own get()/post() are deleted too — the second module that knew the URL and carried the token');
}


// ═══════════════════════════════════════════════════════════════════════════
// [10] SERVER TWIN — backend/Code.gs executed for real in a vm sandbox.
// Same precedent as scribeToolsTwin.mjs / trainertest.mjs. The client guard
// above stops the DAMAGE; this is the half that stops the misroute happening.
// Only ping + empty-request + unknown-action are exercised, so the sandbox
// needs no Sheet.
console.log('\n[10] backend/Code.gs — an action-less request is never answered with ping');
{
  const vm = await import('node:vm');
  const fs = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const src = fs.readFileSync(fileURLToPath(new URL('./backend/Code.gs', import.meta.url)), 'utf8');
  const sandbox = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'tok', setProperty() {}, deleteProperty() {} }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => null, insertSheet: () => { throw new Error('no sheet in this sandbox'); } }) },
    Utilities: { getUuid: () => 'uuid', formatDate: () => '' },
    UrlFetchApp: { fetch() { throw new Error('no network in this sandbox'); } },
    ContentService: { createTextOutput: s => ({ setMimeType: () => ({ getContent: () => s }) }), MimeType: { JSON: 'JSON' } },
    Logger: { log() {} },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'Code.gs' });
  const out = o => JSON.parse(o.getContent());

  const getNoAction = out(sandbox.doGet({ parameter: {} }));
  assert(getNoAction.ok === false,
    `doGet with no action refuses instead of answering ping — this is the 302-redirected POST (got ${JSON.stringify(getNoAction).slice(0, 120)})`);
  assert(getNoAction.misrouted === true, 'and flags itself misrouted so the client retries rather than giving up');
  assert(getNoAction.service !== 'cfbp-backend', 'and does not carry the ping marker');

  const getTokenOnly = out(sandbox.doGet({ parameter: { token: 'tok' } }));
  assert(getTokenOnly.ok === false && getTokenOnly.misrouted === true, 'a GET with a token but no action is refused the same way');

  const postEmpty = out(sandbox.doPost({ postData: { contents: '' } }));
  assert(postEmpty.ok === false && postEmpty.misrouted === true,
    `doPost with an empty body refuses instead of answering ping — the cold-start path (got ${JSON.stringify(postEmpty).slice(0, 120)})`);

  const postNoBody = out(sandbox.doPost({}));
  assert(postNoBody.ok === false && postNoBody.misrouted === true, 'doPost with no postData at all is refused the same way');

  const postNoAction = out(sandbox.doPost({ postData: { contents: JSON.stringify({ token: 'tok' }) } }));
  assert(postNoAction.ok === false && postNoAction.misrouted === true, 'a well-formed JSON body with no action is refused the same way');

  const postBadJson = out(sandbox.doPost({ postData: { contents: '{{{' } }));
  assert(postBadJson.ok === false && /Bad JSON/i.test(postBadJson.error), 'malformed JSON keeps its own distinct error');

  // The health check must still work, over both verbs.
  const pingGet = out(sandbox.doGet({ parameter: { action: 'ping' } }));
  assert(pingGet.ok === true && pingGet.service === 'cfbp-backend', 'GET ?action=ping still answers the health check');
  assert(pingGet._action === 'ping', 'and echoes the action it ran, under the reserved `_action` name');
  const pingPost = out(sandbox.doPost({ postData: { contents: JSON.stringify({ action: 'ping' }) } }));
  assert(pingPost.ok === true && pingPost.service === 'cfbp-backend', 'POST {"action":"ping"} still answers the health check');

  // Every non-ping response echoes its action, so the client can verify routing
  // positively rather than by sniffing for the ping marker.
  const unknown = out(sandbox.doPost({ postData: { contents: JSON.stringify({ action: 'bogusAction', token: 'tok' }) } }));
  assert(/Unknown action/.test(unknown.error), 'an unknown action still reports itself as unknown');
  assert(unknown._action === 'bogusAction', 'and echoes the action, so the client can tell WHICH request this answers');
  assert(unknown.action === undefined, 'and the echo does NOT squat on the generic `action` name a future handler may want for its own payload (review finding 2)');

  // Nothing to echo on a request that never dispatched — and the empty-request
  // reply must not look like an answer to anything.
  assert(getNoAction._action === undefined && postEmpty._action === undefined,
    'an action-less request carries no echo at all — there is no action it could be answering');

  // The mechanism itself: handle() must not resurrect the `|| 'ping'` default.
  // Comments are stripped first — the fix's own comment QUOTES the defective
  // line verbatim as the root-cause record, and a naive grep flags that, which
  // would pressure the next person to delete the explanation to get to green.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert(/function handle\s*\(/.test(code),
    'fixture check: comment-stripping left the executable source intact (a bad strip would make the next assertion vacuous)');
  assert(!/req\.action\s*\|\|\s*['"]ping['"]/.test(code),
    'handle() no longer defaults a missing action to ping — the literal root cause is gone from the executable source');
}

// ═══════════════════════════════════════════════════════════════════════════
// [11] THE SECOND, INDEPENDENT CAUSE — outbound calls were never authorized.
//
// Drew's CFBP_SCRIBE_LOG, 2026-09-11: both live rows (mention 07:12Z, trainer
// 07:16Z) failed with
//   "network_You do not have permission to call UrlFetchApp.fetch.
//    Required permissions: https://www.googleapis.com/auth/script.external_request"
// Apps Script refused the call before it left Google. This project made ZERO
// UrlFetchApp calls before v0.20.0, so the OAuth grant stored for the web app
// never included that scope, and pasting code does not expand a grant — only
// RUNNING a function interactively re-shows the consent screen.
//
// This is NOT the misroute. It is a second cause sitting underneath it, and it
// is the one that fully explains the @scribe canned-line degrade. What can be
// tested in Node is that the one-click remedy exists, is free to run, and can
// never be turned into something that spends money. THE GRANT ITSELF CAN ONLY
// BE CONFIRMED BY DREW IN THE APPS SCRIPT EDITOR — see the report.
console.log('\n[11] backend/Code.gs — a free, one-click authorization trigger for outbound calls');
{
  const vm = await import('node:vm');
  const fs = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const here = new URL('.', import.meta.url);
  const src = fs.readFileSync(fileURLToPath(new URL('./backend/Code.gs', here)), 'utf8');
  const fetches = [];
  const sandbox = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty() {}, deleteProperty() {} }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => null, insertSheet: () => { throw new Error('no sheet'); } }) },
    Utilities: { getUuid: () => 'uuid', formatDate: () => '' },
    UrlFetchApp: {
      fetch(url, opts) {
        fetches.push({ url, opts });
        return { getResponseCode: () => 401, getContentText: () => '{"error":"authentication_error"}' };
      },
    },
    ContentService: { createTextOutput: s => ({ setMimeType: () => ({ getContent: () => s }) }), MimeType: { JSON: 'JSON' } },
    Logger: { log() {} },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'Code.gs' });

  assert(typeof sandbox.authorizeExternalRequests === 'function',
    'authorizeExternalRequests() exists — the function Drew selects and Runs once to trigger the consent screen');

  const code = sandbox.authorizeExternalRequests();
  assert(fetches.length === 1, `it makes exactly ONE outbound call (got ${fetches.length})`);
  assert(code === 401,
    'it returns the HTTP status rather than throwing on a 401 — a 401 is the SUCCESS case here, it proves the request left Google');
  const f = fetches[0];
  assert(/^https:\/\/api\.anthropic\.com\//.test(f.url), `the call goes to Anthropic (got ${f.url})`);
  assert(!/\/v1\/messages/.test(f.url),
    'and NOT to /v1/messages — an authorization step must be free to re-run, and messages is the endpoint that bills');
  assert(!!f.opts && f.opts.muteHttpExceptions === true, 'muteHttpExceptions is set, so the expected 401 does not read as a failure');
  assert(!f.opts.payload && (!f.opts.method || String(f.opts.method).toLowerCase() === 'get'),
    'it is a plain GET with no payload');
  const headers = (f.opts && f.opts.headers) || {};
  assert(!headers['x-api-key'], 'it sends NO API key — it must work before ANTHROPIC_API_KEY is ever set');

  // The function must stay a bare trigger. Wiring it to the real invoke path
  // would turn "click Run to grant permission" into "click Run to spend money".
  const body = src.slice(src.indexOf('function authorizeExternalRequests()'));
  const fnBody = body.slice(0, body.indexOf('\n}') + 2);
  assert(!/scribeInvoke_|runTrainer|scribeAsk|scribeCallAnthropic_/.test(fnBody),
    'and it never calls scribeInvoke_/scribeAsk/runTrainer — authorization must never be a spend path');

  // The click-path has to live somewhere Drew will find it next season, not
  // only in a chat message that scrolls away.
  const setup = fs.readFileSync(fileURLToPath(new URL('./backend/SETUP.md', here)), 'utf8');
  assert(/authorizeExternalRequests/.test(setup),
    'backend/SETUP.md documents the one-time authorization step by function name');
  assert(/script\.external_request/.test(setup),
    'and names the scope, so the same error message is searchable straight to the fix');
  assert(/New version/i.test(setup),
    'and says to ship it as a NEW VERSION of the SAME deployment — "New deployment" changes the /exec URL (RG-09)');
}


// ═══════════════════════════════════════════════════════════════════════════
// [12] C7 — THE UNAUTHENTICATED READ GATE (security-reviewer, 2026-09-12)
//
// WHAT WAS WRONG
// --------------
// backend/Code.gs shipped `var REQUIRE_TOKEN_FOR_READ = false;`, and handle()
// computes `needsToken = writeActions[action] || REQUIRE_TOKEN_FOR_READ`. So
// every READ action — getAll, get, chatSince, chatBefore, chatHead,
// listSnapshots, chatMetrics, notifyLog, presence — answered a request that
// carried NO credential at all.
//
// The /exec URL is not a secret: it ships in config.json at the site root so
// every device auto-connects (CLAUDE.md, locked decision). Anyone who opens
// https://irbfootball.com/config.json can then POST {"action":"getAll"} and
// receive the entire store: settings.sitePin, settings.adminPasswordHash,
// every player's pinHash, and every pick for a week that is still OPEN — the
// blind rule enforced in the client is not enforced by the server.
//
// WHY THE FLIP IS SAFE TO MAKE
// ----------------------------
// Every client read path already sends the token — proven by [12c]/[12d]
// below, not assumed. That matters: if one path omitted it, flipping the flag
// takes sync down league-wide for six people mid-season (RG-56's class of
// failure). `ping` is answered BEFORE the gate, so the 🩺 health check and the
// comm panel's connection test keep working with no credential.
//
// DEPLOY IS MANUAL. Code.gs changes nothing until Drew pastes it and runs
// Deploy → Manage deployments → Edit → New version on the SAME deployment
// (never "New deployment" — that changes the /exec URL, RG-09). Until then the
// live server still answers reads without a token; the client is unaffected
// either way because it has always sent one.
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[12] backend/Code.gs — reads require the shared token');
{
  const vm = await import('node:vm');
  const fs = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const src = fs.readFileSync(fileURLToPath(new URL('./backend/Code.gs', import.meta.url)), 'utf8');

  // A Sheet twin with REAL secrets in it, so a tokenless getAll that gets past
  // the gate visibly returns them. Without this the RED reads "Store not
  // initialized" and understates the defect.
  const SECRETS = {
    cfbp_settings: { sitePin: '6969', adminPasswordHash: 'sha256:deadbeef', chatEnabled: true },
    cfbp_players: [{ playerId: 'p0', displayName: 'Drew', pinHash: 'sha256:1111' },
                   { playerId: 'p1', displayName: 'Kihoon', pinHash: 'sha256:2222' }],
    cfbp_picks: [{ pickId: 'pk1', playerId: 'p1', weekId: 'w2026_3', selectedTeam: 'Texas A&M' }],
  };
  function fakeSheet(rows) {
    const data = rows.slice();
    return {
      getDataRange: () => ({ getValues: () => data.map(r => r.slice()) }),
      getLastRow: () => data.length,
      getLastColumn: () => (data[0] ? data[0].length : 0),
      getRange: () => ({ getValues: () => data.map(r => r.slice()), setValues() {}, setValue() {} }),
      setFrozenRows() {}, appendRow(r) { data.push(r); },
      getName: () => 'fake',
    };
  }
  const store = fakeSheet([['key', 'json', 'updatedAt'],
    ...Object.entries(SECRETS).map(([k, v]) => [k, JSON.stringify(v), '2026-09-12'])]);
  const msgs = fakeSheet([['seq', 'id', 'ts', 'author', 'body']]);
  const sandbox = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'tok', setProperty() {}, deleteProperty() {} }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: n => (n === 'CFBP_STORE' ? store : n === 'CFBP_MESSAGES' ? msgs : null),
        insertSheet: () => fakeSheet([[]]),
      }),
    },
    Utilities: { getUuid: () => 'uuid', formatDate: () => '' },
    UrlFetchApp: { fetch() { throw new Error('no network in this sandbox'); } },
    ContentService: { createTextOutput: s => ({ setMimeType: () => ({ getContent: () => s }) }), MimeType: { JSON: 'JSON' } },
    Logger: { log() {} },
    console: { log() {}, warn() {}, error() {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'Code.gs' });
  const out = o => JSON.parse(o.getContent());
  const postAs = (body) => out(sandbox.doPost({ postData: { contents: JSON.stringify(body) } }));
  const getAs = (parameter) => out(sandbox.doGet({ parameter }));

  // [12a] THE REPRODUCTION — a tokenless getAll must not hand back the store.
  const anon = postAs({ action: 'getAll' });
  assert(anon.ok === false && /unauthor/i.test(String(anon.error)),
    `[12a] POST {"action":"getAll"} with NO token is refused (got: ${JSON.stringify(anon).slice(0, 160)})`);
  const leaked = JSON.stringify(anon);
  assert(!/6969/.test(leaked), '[12a] …so settings.sitePin is not in the reply');
  assert(!/adminPasswordHash|sha256:deadbeef/.test(leaked), '[12a] …nor the commissioner password hash');
  assert(!/pinHash|sha256:1111/.test(leaked), '[12a] …nor any player PIN hash');
  assert(!/pk1|selectedTeam/.test(leaked), '[12a] …nor anyone\'s picks');

  // [12b] EVERY store-returning action, both verbs. A gate that closed getAll
  // and left chatSince open would leak the whole chat log instead.
  const READ_ACTIONS = [
    ['getAll', {}], ['get', { key: 'cfbp_settings' }], ['chatHead', {}],
    ['chatSince', { seq: 0, limit: 50 }], ['chatBefore', { seq: 99, limit: 50 }],
    ['listSnapshots', {}], ['chatMetrics', { days: 7 }],
    ['notifyLog', { playerId: 'p0', afterSeq: 0 }], ['presence', { player: 'p0', seen: 0 }],
  ];
  for (const [action, params] of READ_ACTIONS) {
    const r = postAs({ action, ...params });
    assert(r.ok === false && /unauthor/i.test(String(r.error)),
      `[12b] POST ${action} without a token is refused (got: ${JSON.stringify(r).slice(0, 110)})`);
    const g = getAs({ action, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
    assert(g.ok === false && /unauthor/i.test(String(g.error)),
      `[12b] GET ?action=${action} without a token is refused too (the 302-redirect path)`);
  }

  // [12c] …and the SAME actions still work WITH the token. A gate that refuses
  // everyone is a different outage, not a fix.
  const authed = postAs({ action: 'getAll', token: 'tok' });
  assert(authed.ok === true, `[12c] getAll WITH the token still succeeds (got: ${JSON.stringify(authed).slice(0, 120)})`);
  assert(authed.data && authed.data.cfbp_settings && authed.data.cfbp_settings.sitePin === '6969',
    '[12c] …and still returns the real store, so hydrate() is unaffected');
  assert(authed._action === 'getAll', '[12c] …carrying the BUG-A action echo, which the client checks for misrouting');
  for (const [action, params] of READ_ACTIONS) {
    const r = postAs({ action, token: 'tok', ...params });
    assert(!/unauthor/i.test(String(r.error || '')),
      `[12c] ${action} WITH the token is not refused (got: ${JSON.stringify(r).slice(0, 110)})`);
  }

  // [12d] ping is answered BEFORE the gate — the 🩺 diagnostics button and the
  // comm panel's connection test must keep working with no credential.
  const pingAnon = postAs({ action: 'ping' });
  assert(pingAnon.ok === true && pingAnon.service === 'cfbp-backend',
    '[12d] ping still answers without a token (the health check is not collateral damage)');
  assert(!/6969|pinHash|adminPasswordHash/.test(JSON.stringify(pingAnon)), '[12d] …and carries no store data of its own');

  // [12e] THE MECHANISM — the flag itself, so a future paste of an older
  // Code.gs into the Apps Script editor fails here rather than in production.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert(/var\s+REQUIRE_TOKEN_FOR_READ\s*=\s*true\s*;/.test(code),
    '[12e] REQUIRE_TOKEN_FOR_READ is true in the executable source');
  assert(/needsToken\s*=\s*writeActions\[action\]\s*\|\|\s*REQUIRE_TOKEN_FOR_READ/.test(code),
    '[12e] …and handle() still consults it (the flag has to be wired, not just set)');
}

// [13] and [14] are retired with [1]–[9] — see the note at the top of this
// file. [13] proved the shared token rode on every read request; there is no
// token. [14] proved the post-cutover allow-list refused thirteen relays before
// any fetch; there are no relays, which is the stronger form of the same claim
// and is asserted structurally above and in `adaptertest.mjs [A17]`.



// ═══════════════════════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════════════');
if (fail === 0) console.log(`✅ ALL PASS — ${pass} passed, 0 failed`);
else { console.error(`❌ FAILURES — ${pass} passed, ${fail} failed`); process.exitCode = 1; }
