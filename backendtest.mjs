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

const be = await import('./js/backend.js');
const tx = await import('./js/chatTransport.js');
be.setBackendConfig('https://script.google.com/macros/s/FAKE/exec', 'tok');

async function rejects(p) {
  try { await p; return null; } catch (e) { return e; }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[1] A misrouted getAll is retried, and the retry lands');
{
  arm(PING(), GETALL_OK());
  const err = await rejects(be.hydrate().then(n => { assert(n > 0, `hydrate() resolved with ${n} keys instead of throwing`); }));
  assert(!err, `hydrate() survives one misroute (got: ${err && err.message})`);
  assert(calls.length === 2, `exactly two requests: the misrouted one and the retry (got ${calls.length})`);
  assert(calls.every(c => c.body && c.body.action === 'getAll'), 'both requests asked for getAll');
  const players = be.cacheGet('cfbp_players');
  assert(Array.isArray(players) && players.length === 6, `the real snapshot landed in the mirror (6 players, got ${players && players.length})`);
}

console.log('\n[2] A PERSISTENT misroute throws a CLEAR error — not a false success, and not "Sync refused"');
{
  arm(PING(), PING(), PING());
  const err = await rejects(be.hydrate());
  assert(!!err, 'hydrate() rejects rather than resolving {ok:true}');
  assert(!!err && /misrout/i.test(err.message), `the error names the real problem — misrouting (got: ${err && err.message})`);
  assert(!!err && !/Sync refused/i.test(err.message),
    'and does NOT surface as "Sync refused", which sent Drew hunting a data-loss bug that was not happening');
  assert(calls.length === 3, `three attempts, then it gives up (got ${calls.length})`);
}

console.log('\n[3] hydrate() never clears the mirror on a misrouted reply (RG-12 axis)');
{
  const before = localStorage.getItem(MIRROR_KEY);
  arm(PING(), PING(), PING());
  await rejects(be.hydrate());
  const players = be.cacheGet('cfbp_players');
  assert(Array.isArray(players) && players.length === 6, `the in-memory mirror still holds all 6 players (got ${players && players.length})`);
  assert(be.cacheGet('cfbp_picks')?.length === 1, 'and still holds the picks');
  assert(localStorage.getItem(MIRROR_KEY) === before, 'the persisted snapshot mirror is untouched');
}

console.log('\n[4] A real ping still works — the health check must not be collateral damage');
{
  arm(PING());
  const r = await be.pingBackend();
  assert(r.ok === true, 'pingBackend() reports ok');
  assert(r.service === 'cfbp-backend', 'and carries the service marker, which is legitimate FOR ping');
  assert(calls.length === 1, `one request, no retry (got ${calls.length})`);
}

console.log('\n[5] SPEND actions are never blindly retried — runTrainer / scribeAsk');
{
  arm(PING(), PING(), PING());
  const err = await rejects(be.runTrainerRemote({ adminPasswordHash: 'x' }));
  assert(!!err && /misrout/i.test(err.message), `runTrainer throws the misroute error (got: ${err && err.message})`);
  assert(calls.length === 1,
    `and sends EXACTLY ONE request — a retry could double-charge Anthropic if the first one did run (got ${calls.length})`);

  arm(PING(), PING(), PING());
  const err2 = await rejects(be.scribeAskRemote({ triggerMessageId: 'm1', playerId: 'p0' }));
  assert(!!err2 && /misrout/i.test(err2.message), `scribeAsk throws the misroute error (got: ${err2 && err2.message})`);
  assert(calls.length === 1, `and sends exactly one request (got ${calls.length})`);
}

console.log('\n[6] IDEMPOTENT writes DO retry — a dropped write must not be reported as synced');
{
  // chatAppend is id-deduped server-side (Code.gs chatAppend → knownIds/
  // idSeqFullScan); setMany is last-write-wins on the same payload; notifyPush
  // is dedupKey-deduped. All three are safe to send twice — and a misroute
  // means the server never ran the action at all, because both misroute paths
  // (empty body, dropped-body redirect) lose the request before dispatch.
  arm(PING(), { ok: true, assigned: [{ id: 'e1', seq: 228 }], head: 228 });
  const r = await be.chatAppendRemote([{ id: 'e1', body: 'hi' }]);
  assert(r.head === 228, `chatAppend survives a misroute and reports the real head (got ${r.head})`);
  assert(calls.length === 2, `two requests: misroute + retry (got ${calls.length})`);

  arm(PING(), { ok: true, head: 228 });
  const h = await tx.fetchHead();
  assert(h.head === 228, `chatTransport.fetchHead() survives a misroute (got ${h.head})`);
  assert(calls.length === 2, `chatTransport's own GET path retries too (got ${calls.length})`);

  arm(PING(), { ok: true, assigned: [], head: 229 });
  const a = await tx.appendEvents([{ id: 'e2', body: 'yo' }]);
  assert(a.head === 229, `chatTransport.appendEvents() survives a misroute (got ${a.head})`);
  assert(calls.length === 2, `chatTransport's own POST path retries too (got ${calls.length})`);

  arm(PING(), PING(), PING());
  const err = await rejects(tx.fetchHead());
  assert(!!err && /misrout/i.test(err.message), `chatTransport gives up loudly on a persistent misroute (got: ${err && err.message})`);
}

console.log('\n[7] Detection survives a server that drops the ping marker — the `action` echo');
{
  // Forward-compat with the fixed Code.gs, which echoes the action it ran.
  arm({ ok: true, _action: 'ping', time: 'now' }, GETALL_OK());
  const err = await rejects(be.hydrate());
  assert(!err, `an action-echo mismatch is caught and retried even with no service marker (got: ${err && err.message})`);
  assert(calls.length === 2, `two requests (got ${calls.length})`);

  // Review finding 2 — the echo lives under a RESERVED name, so a handler's own
  // top-level `action` field is payload, not routing metadata. Reading it as
  // the echo would make a perfectly-routed reply look misrouted: retried twice
  // (a duplicate write on anything but the id-deduped actions) and then thrown
  // as a sync error the player would see. Cheap to prevent today, expensive to
  // debug the first time a handler needs the field.
  arm({ ok: true, _action: 'getAll', action: 'somethingElseEntirely', data: snapshot(), chatHead: 227 });
  const err2 = await rejects(be.hydrate());
  assert(!err2, `a correctly-echoed reply that ALSO carries its own top-level 'action' field is NOT a misroute (got: ${err2 && err2.message})`);
  assert(calls.length === 1, `and is not retried (got ${calls.length})`);

  // And the layer below still covers a deployment that echoes nothing at all —
  // including the interim one that echoed the old un-reserved `action` name.
  arm({ ok: true, action: 'ping', time: 'now', service: 'cfbp-backend', version: 2 }, GETALL_OK());
  const err3 = await rejects(be.hydrate());
  assert(!err3, `a misroute from a deployment this client cannot read an echo from is still caught by the ping marker (got: ${err3 && err3.message})`);
  assert(calls.length === 2, `two requests (got ${calls.length})`);
}

console.log('\n[8] The fixed server\'s explicit empty-request reply is treated as a misroute, not a hard error');
{
  arm({ ok: false, error: 'Empty request — no action supplied', misrouted: true }, GETALL_OK());
  const err = await rejects(be.hydrate());
  assert(!err, `misrouted:true is retried rather than surfaced as a dead error (got: ${err && err.message})`);
  assert(calls.length === 2, `two requests (got ${calls.length})`);
}

console.log('\n[9] The guard is NARROW — a genuine server error still fails fast and keeps its message');
{
  arm({ ok: false, error: 'Unauthorized' });
  const err = await rejects(be.hydrate());
  assert(!!err && /Unauthorized/.test(err.message), `a real error keeps its own message (got: ${err && err.message})`);
  assert(calls.length === 1, `and is NOT retried — retrying every failure would be a different bug (got ${calls.length})`);

  arm({ ok: true, _action: 'getAll', data: snapshot(), chatHead: 227 });
  const err2 = await rejects(be.hydrate());
  assert(!err2, `a correctly-echoed reply passes straight through (got: ${err2 && err2.message})`);
  assert(calls.length === 1, `with no retry (got ${calls.length})`);
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

// ═══════════════════════════════════════════════════════════════════════════
// [13] C7, client half — every read request already carries the token.
// This is the proof that had to exist BEFORE the flag was flipped.
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[13] Client read paths — the token is on every request');
{
  const fs = await import('node:fs');
  const { fileURLToPath } = await import('node:url');

  // [13a] backend.js call() — POST body, driven through the real functions.
  arm(GETALL_OK());
  await be.hydrate();
  assert(calls[0]?.body?.action === 'getAll' && calls[0]?.body?.token === 'tok',
    `[13a] hydrate() -> getAll carries the token in the POST body (got: ${JSON.stringify(calls[0]?.body && { action: calls[0].body.action, token: calls[0].body.token })})`);

  arm({ ok: true, snapshots: [] });
  await be.listSnapshots();
  assert(calls[0]?.body?.token === 'tok', '[13a] listSnapshots carries the token');

  arm({ ok: true, rows: [] });
  await be.notifyLogFetch('p0', 0);
  assert(calls[0]?.body?.action === 'notifyLog' && calls[0]?.body?.token === 'tok',
    '[13a] notifications.js -> notifyLogFetch -> notifyLog carries the token');

  arm({ ok: true, events: [], head: 0 });
  await be.chatSinceRemote(0, 50);
  assert(calls[0]?.body?.token === 'tok', '[13a] chatSince carries the token');

  // [13b] chatTransport.js — GET reads put it in the QUERY STRING
  // (js/chatTransport.js:76, `u.searchParams.set('token', c.token || '')`).
  arm({ ok: true, head: 12 });
  await tx.fetchHead();
  assert(/[?&]token=tok(&|$)/.test(calls[0]?.url || ''),
    `[13b] chatTransport GET chatHead carries token= in the query string (got: ${calls[0]?.url})`);
  arm({ ok: true, events: [], head: 12 });
  await tx.fetchSince(0, 50);
  assert(/[?&]token=tok(&|$)/.test(calls[0]?.url || ''), '[13b] chatSince GET carries token=');
  arm({ ok: true, events: [] });
  await tx.fetchBefore(99, 50);
  assert(/[?&]token=tok(&|$)/.test(calls[0]?.url || ''), '[13b] chatBefore GET carries token=');
  arm({ ok: true, rows: [] });
  await tx.fetchMetrics(7);
  assert(/[?&]token=tok(&|$)/.test(calls[0]?.url || ''), '[13b] chatMetrics GET carries token=');
  arm({ ok: true, assigned: [], head: 13 });
  await tx.appendEvents([{ id: 'e9', body: 'x' }]);
  assert(calls[0]?.body?.token === 'tok', '[13b] chatTransport POST chatAppend carries the token in the body');

  // [13c] STRUCTURAL — the guard that covers the read path nobody has written
  // yet. Only backend.js and chatTransport.js may talk to the backend URL
  // (AD-16 for chat); a NEW module that fetches it, or an existing one that
  // stops attaching the token, fails here rather than at the next redeploy.
  const jsDir = fileURLToPath(new URL('./js/', import.meta.url));
  const fetchers = fs.readdirSync(jsDir).filter(f => f.endsWith('.js'))
    .filter(f => /\bfetch\s*\(/.test(fs.readFileSync(jsDir + f, 'utf8')));
  // iOS Munera thread, PASS 1b (2026-09-20) — app.js joined this list.
  // DI-208d's checkNativeShellStaleness() adds ONE new fetch() call, native
  // only, to the LIVE service-worker.js (never the backend URL, never
  // app.js's own ~800KB) — the loop below proves it never reaches the
  // backend the same way it already proves this for the other three.
  assert(JSON.stringify(fetchers.sort()) === JSON.stringify(['app.js', 'backend.js', 'chatTransport.js', 'data-provider.js', 'extra-point.js', 'push-onesignal.js']),
    `[13c] exactly six modules call fetch() — the two backend transports, ESPN/ESPN-summary/config.json, and app.js's DI-208d staleness check (got: ${fetchers.join(', ')})`);
  const beSrc = fs.readFileSync(jsDir + 'backend.js', 'utf8');
  const txSrc = fs.readFileSync(jsDir + 'chatTransport.js', 'utf8');
  assert(/JSON\.stringify\(\{\s*action,\s*token:\s*c\.token,/.test(beSrc),
    '[13c] backend.js call() builds every request body with the token');
  assert(/u\.searchParams\.set\('token',\s*c\.token/.test(txSrc),
    '[13c] chatTransport.js get() puts the token on every GET');
  assert(/JSON\.stringify\(\{\s*action,\s*token:\s*c\.token,/.test(txSrc),
    '[13c] chatTransport.js post() puts the token on every POST');
  for (const [f, s] of [['data-provider.js', fs.readFileSync(jsDir + 'data-provider.js', 'utf8')],
                        ['extra-point.js', fs.readFileSync(jsDir + 'extra-point.js', 'utf8')],
                        ['push-onesignal.js', fs.readFileSync(jsDir + 'push-onesignal.js', 'utf8')],
                        ['app.js', fs.readFileSync(jsDir + 'app.js', 'utf8')]]) {
    assert(!/getBackendConfig\(\)[\s\S]{0,400}?fetch\s*\(/.test(s),
      `[13c] ${f} does not fetch the backend URL (its fetch() calls go to ESPN / config.json${f === 'app.js' ? ' / the live service-worker.js' : ''})`);
  }
  // app.js's fetch() specifically: only ever the hardcoded live
  // service-worker.js literal, never app.js itself and never derived from
  // anything the response returns (security condition 11).
  const appSrc13c = fs.readFileSync(jsDir + 'app.js', 'utf8');
  assert(/fetch\('https:\/\/irbfootball\.com\/service-worker\.js',\s*\{\s*redirect:\s*'error'\s*\}\)/.test(appSrc13c),
    "[13c] app.js's one fetch() call is the hardcoded literal https://irbfootball.com/service-worker.js with redirect:'error' (security condition 10)");
}

// ═══════════════════════════════════════════════════════════════════════════
// [14] Phase III Step 4 Part B — THE SHEETS RELAY ALLOW-LIST (DI §2.7).
//
// This closes adaptertest.mjs's A17 skip, which named this file as its
// follow-up: the guard lives in call() at js/backend.js, a file Part A could
// not edit, so Part A asserted only that the ADAPTER can reach no relay and
// deferred the guard itself to here.
//
// THE ASSERTION THAT MATTERS IS "AND NEVER FETCHED". A refusal that happens
// AFTER the request has gone out is not an interlock — the production league's
// Sheet has already been read or written by then, which is the entire cross-
// league bleed §2.7 exists to prevent. Every case below therefore checks
// `calls.length === 0` as well as the throw, and the fetch stub is armed with
// NOTHING so that a request would also exhaust it and fail loudly.
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[14] dataMode:\'supabase\' — every Sheets relay except ping/notifyPush is refused BEFORE the fetch (DI §2.7, A17)');
{
  assert(be.getDataMode() === 'sheets',
    '[14] the default dataMode is \'sheets\' — the flag-off world, and what an absent config.json key means (CONVENTIONS #10)');

  // ── the flag-off world is untouched ──────────────────────────────────────
  arm(PING());
  const okBefore = await be.pingBackend();
  assert(okBefore.ok === true && calls.length === 1,
    '[14] in \'sheets\' mode every relay still goes out exactly as it does today');
  arm({ ok: true, _action: 'runTrainer', skipped: false });
  const trainerBefore = await rejects(be.runTrainerRemote({ adminPasswordHash: 'h' }));
  assert(!trainerBefore && calls.length === 1,
    '[14] …including the ones the allow-list will later refuse — runTrainer reaches the server in \'sheets\' mode');

  // ── flip the mode ────────────────────────────────────────────────────────
  assert(be.setDataMode('supabase') === 'supabase', '[14] setDataMode(\'supabase\') takes');
  assert(be.getDataMode() === 'supabase', '[14] …and getDataMode() reports it');

  // Every REFUSED action, by its own exported relay where there is one. The
  // list is written out rather than derived, so a relay added later without a
  // thought about the interlock shows up here as an untested name rather than
  // being swept into a loop that happens to still pass.
  const refused = [
    ['runTrainerRemote',       () => be.runTrainerRemote({ adminPasswordHash: 'h' }),                 'runTrainer'],
    ['scribeAskRemote',        () => be.scribeAskRemote({ triggerMessageId: 'm1', playerId: 'p1' }),  'scribeAsk'],
    ['scribeAutonomousRemote', () => be.scribeAutonomousRemote({ trigger: 't' }),                     'scribeAutonomous'],
    ['scribeClassifyRemote',   () => be.scribeClassifyRemote({ messageId: 'm1' }),                    'scribeClassify'],
    ['scribeMemoryListRemote',   () => be.scribeMemoryListRemote({ playerId: 'p1' }),                         'scribeMemoryList'],
    ['scribeMemoryUpsertRemote', () => be.scribeMemoryUpsertRemote({ playerId: 'p1', kind: 'k', text: 't' }), 'scribeMemoryUpsert'],
    ['scribeMemoryDeleteRemote', () => be.scribeMemoryDeleteRemote({ id: 'x', playerId: 'p1' }),              'scribeMemoryDelete'],
    ['scribeMemorySyncRemote',   () => be.scribeMemorySyncRemote({ adminPasswordHash: 'h' }),                 'scribeMemorySync'],
    ['createSnapshot',         () => be.createSnapshot('label'),                                      'snapshot'],
    ['listSnapshots',          () => be.listSnapshots(),                                              'listSnapshots'],
    ['restoreSnapshot',        () => be.restoreSnapshot('snap1'),                                     'restoreSnapshot'],
    ['hydrate (getAll)',       () => be.hydrate(),                                                    'getAll'],
    ['notifyLogFetch',         () => be.notifyLogFetch('p1', 0),                                     'notifyLog'],
  ];
  for (const [name, run, action] of refused) {
    arm();                                    // NOTHING queued: a fetch would also exhaust the stub
    const err = await rejects(run());
    assert(!!err && err.name === 'SheetsRelayRefusedError',
      `[14] ${name} throws a typed SheetsRelayRefusedError in supabase data mode`);
    assert(!!err && err.code === 'sheets_relay_refused',
      `[14] …with code 'sheets_relay_refused' (got ${err && err.code})`);
    assert(!!err && err.action === action, `[14] …naming the refused action '${action}' (got ${err && err.action})`);
    assert(!!err && err.interlocked === true,
      '[14] …flagged as a DESIGNED refusal, not an outage, so the sync badge does not go red for a Step 6 feature');
    assert(calls.length === 0, `[14] …and NOTHING was fetched (got ${calls.length} request(s)) — the refusal is before the wire`);
  }

  // ── the two allowed actions still work ───────────────────────────────────
  arm(PING());
  const p = await be.pingBackend();
  assert(p.ok === true && calls.length === 1 && calls[0].body.action === 'ping',
    '[14] `ping` is on the allow-list and still reaches the Sheet — the Comm → Settings connection test keeps working');

  arm({ ok: true, _action: 'notifyPush', sent: 1 });
  const np = await rejects(be.notifyPushRelay({ dedupKey: 'd1', playerIds: ['p1'], title: 'T', body: 'B', destination: 'chat', event: 'E' }));
  assert(!np, `[14] \`notifyPush\` is on the allow-list and does not throw (got: ${np && np.message})`);
  assert(calls.length === 1 && calls[0].body.action === 'notifyPush',
    '[14] …and the request really went out: OneSignal external_ids are league-unique by construction (D-4)');

  // ── the allow-list itself cannot be widened at runtime ───────────────────
  // Security F-3/F-E's lesson, applied here: a FROZEN ARRAY, so index
  // assignment, push, and Array.prototype.push.call all throw in strict mode.
  // A Set would have looked identical and been mutable through its internal slot.
  const listed = be._sheetsRelayAllowlistForTest();
  assert(JSON.stringify(listed) === JSON.stringify(['ping', 'notifyPush']),
    `[14] the allow-list is exactly ['ping','notifyPush'] (got ${JSON.stringify(listed)})`);
  listed.push('runTrainer');
  assert(JSON.stringify(be._sheetsRelayAllowlistForTest()) === JSON.stringify(['ping', 'notifyPush']),
    '[14] …and the accessor returns a COPY, so a caller mutating what it got cannot widen the real list');
  {
    const fs = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = fs.readFileSync(fileURLToPath(new URL('./js/backend.js', import.meta.url)), 'utf8');
    assert(/const SHEETS_RELAY_ALLOWLIST = Object\.freeze\(\[/.test(src),
      '[14] …and the real list is a FROZEN ARRAY, not a Set (a Set\'s contents are internal slots that Object.freeze cannot reach)');
    // Non-vacuity: prove the guard is the FIRST thing call() does, above
    // getBackendConfig() and therefore unambiguously above the fetch.
    // Comments stripped first — the guard's OWN comment says "above
    // getBackendConfig()", and matching prose instead of code is how a static
    // rule passes over the thing it is describing rather than over the thing
    // that runs (RG-49's shape).
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/[^\n]*$/gm, '');
    const at = code.indexOf('async function call(action');
    const callBody = code.slice(at, at + 900);
    assert(at > 0 && callBody.indexOf('SHEETS_RELAY_ALLOWLIST') > -1
      && callBody.indexOf('SHEETS_RELAY_ALLOWLIST') < callBody.indexOf('getBackendConfig()'),
      '[14] the guard is the first statement in call() — above the config read, above the body build, above fetch()');
  }

  // ── R2, THE RELEASE: the mode is not a one-way door ──────────────────────
  // Driven forward rather than asserted about — a rollback (DI §8.2 flips both
  // keys back) must restore every relay on the next config read.
  be.setDataMode('sheets');
  arm({ ok: true, _action: 'runTrainer', skipped: false });
  const back = await rejects(be.runTrainerRemote({ adminPasswordHash: 'h' }));
  assert(!back && calls.length === 1,
    '[14] R2: back in \'sheets\' mode the refused relays work again — a rollback restores them with no code change');
  assert(be.setDataMode('nonsense') === 'sheets' && be.setDataMode(undefined) === 'sheets',
    '[14] anything that is not literally \'supabase\' normalizes to \'sheets\' (CONVENTIONS #10, fail-safe direction)');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════════════');
if (fail === 0) console.log(`✅ ALL PASS — ${pass} passed, 0 failed`);
else { console.error(`❌ FAILURES — ${pass} passed, ${fail} failed`); process.exitCode = 1; }
