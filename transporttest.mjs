/**
 * CFB Pickems — transporttest.mjs
 * ================================
 * Phase III Step 4 Part A, DI §7.3. The chat transport interlock, at the
 * transport's own level: in `dataMode:'supabase'` `js/chatTransport.js` refuses
 * BEFORE any fetch, `subscribe()` delivers nothing, the outbox holds — and while
 * the predicate has NEVER BEEN INSTALLED (the flag-off world every device is in
 * today) every request is byte-identical to v0.17.0.
 *
 * DI-T4.12 / security F-1 — THREE states, not two, and section [5] is where the
 * difference lives:
 *   never installed            chat available. Nothing has claimed otherwise.
 *   installed, answers false   chat available.
 *   installed, THROWS          chat INTERLOCKED (fail closed). A league whose
 *                              mode cannot be determined must not append to the
 *                              production Sheet.
 *
 * ── PHASE III STEP 5 (2026-09-18) — SECTIONS [6]-[16] ───────────────────────
 *
 * The table above gained a FOURTH state, and sections [1]-[5] are NOT edited:
 * they are the flag-off world and the fail-closed interlock, and DI-T5.11's
 * byte-identity claim IS that they still pass unchanged. What flips is only
 * which states reach the refusal.
 *
 *   installed, TRUE, chat context installed      -> SUPABASE. Sections [6]-[12].
 *   installed, TRUE, chat context NOT installed  -> INTERLOCKED, verbatim, with
 *                                                   Step 4's copy. Section [13].
 *
 * Section [16] re-measures the never-installed path at the END of the file,
 * after every Supabase section has run in the same process — so a module-level
 * rate cooldown, a remembered refusal or a live channel left behind by the
 * Supabase mode would show up there rather than in production.
 *
 * THE FAKE IS DRIVEABLE, and that is the point. A mock that always succeeds
 * tests nothing: this transport's interesting half is what it does with a
 * REFUSAL, a GAP, and a channel that reports SUBSCRIBED without listening. The
 * fake can refuse any RPC by name, deliver Realtime rows out of order and with
 * gaps, and reach SUBSCRIBED while delivering nothing at all — which is
 * RG-136's race reproduced deterministically instead of waited for, the same
 * bracket rls.test.mjs's B7 builds live against a real socket.
 *
 * Run:  node transporttest.mjs
 *       for tz in UTC America/Los_Angeles; do TZ=$tz node transporttest.mjs; done
 *
 * WHY A SEPARATE FILE rather than a block in `loadtest.mjs`: this suite has to
 * install its own `fetch` stub and count calls, and it drives `chat.js`'s outbox
 * through a real throw. `loadtest.mjs` is a Part B file in this build and is not
 * edited here; Part B wires this into its spawned list beside `adaptertest`.
 *
 * WHAT IT DOES NOT PROVE: that `config.json` will ever carry
 * `"dataMode": "supabase"` — that key and the predicate that reads it are Part
 * B (`js/backend.js` `loadDeployedConfig`, `js/auth.js` `configureAuth`). This
 * file proves the transport's half of the contract against the predicate it is
 * given.
 */

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
  get length() { return store.size; },
  key: (i) => [...store.keys()][i] ?? null,
};
globalThis.window = globalThis;
globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };

const _realLog = console.log.bind(console);
const _realErr = console.error.bind(console);
let pass = 0, fail = 0;
const failures = [];
function assert(cond, label) {
  if (cond) { pass++; _realLog('  ✅', label); }
  else { fail++; failures.push(label); _realErr('  ❌', label); }
}

// ── the fetch recorder ──────────────────────────────────────────────────────
const FETCHES = [];
globalThis.fetch = async (url, opts = {}) => {
  FETCHES.push({ url: String(url), method: opts.method || 'GET', headers: opts.headers || null, body: opts.body || null });
  return {
    ok: true,
    status: 200,
    async json() { return { ok: true, _action: FETCHES[FETCHES.length - 1]._expectAction || 'chatHead', head: 0, events: [], assigned: [], rows: [] }; },
  };
};

const backend = await import('./js/backend.js');
const transport = await import('./js/chatTransport.js');
const storage = await import('./js/storage.js');
const chat = await import('./js/chat.js');

backend.setDataMode('supabase');
// Section [1] measures the NEVER-INSTALLED world deliberately — that is the flag-off state every
// device is in today, and the one this file's byte-identity claim is about. `() => false` is the
// INSTALLED-and-answering-no state, which sections [3] and [5] cover separately.
transport._resetSupabaseDataModePredicateForTest();

/** The transport's misroute guard rejects a reply whose `_action` does not echo
 *  the action it asked for (backend.js:561-567). The recorder therefore echoes
 *  the action back out of the URL/body, so a byte-identity check is not fighting
 *  BUG-A's guard. */
function echoingFetch() {
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const body = opts.body || '';
    const action = (/[?&]action=([^&]+)/.exec(u) || [])[1] || (/"action":"([^"]+)"/.exec(body) || [])[1] || 'chatHead';
    FETCHES.push({ url: u, method: opts.method || 'GET', headers: opts.headers || null, body: body || null, action });
    return { ok: true, status: 200, async json() { return { ok: true, _action: action, head: 0, events: [], assigned: [], rows: [] }; } };
  };
}
echoingFetch();

/**
 * A MINIMAL serveable chat context, for the two sections that run BEFORE this
 * file's full `makeFakeSupabase()` is declared (sections [3] and [5], which
 * need a positive control and nothing more). It answers one `chat_head` and
 * records that it was asked; `makeFakeSupabase()` further down is the real
 * model and is what every Supabase-behaviour section uses.
 */
function installMinimalServeableChat(headValue = 1) {
  const seen = { head: 0 };
  transport.installSupabaseChat({
    getClient: () => ({
      async rpc(fn) { if (fn === 'chat_head') { seen.head++; return { data: headValue, error: null }; } return { data: null, error: { message: 'x' } }; },
      from() { const b = { select: () => b, eq: () => b, gt: () => b, lt: () => b, order: () => b, limit: () => b, then: (r) => r({ data: [], error: null }) }; return b; },
      channel() { const c = { on: () => c, subscribe: () => c }; return c; },
      removeChannel() { return true; },
    }),
    getLeagueId: () => 'lg_minimal',
    rowToMessage: (r) => r,
    isReady: () => true,
    getIdentityEpoch: () => 1,
  });
  transport.setSupabaseDataModePredicate(() => true);
  return seen;
}

// ══════════════════════════════════════════════════════════════════════════
_realLog('\n[1] predicate NEVER INSTALLED — the state is now a REFUSAL, not the Apps Script path…');
{
  // ── WHAT THIS SECTION USED TO BE, AND WHY IT COULD NOT SURVIVE ────────────
  // It pinned the WIRE SHAPE of the five Apps Script requests byte for byte —
  // `?action=chatHead&token=T0KEN`, the `seq`/`limit` order, the POST to the
  // bare URL with `text/plain;charset=utf-8` and a body of exactly
  // `{action, token, events}` in that key order. That was the "flag-off is
  // byte-identical to v0.17.0" claim Step 4 owed, and it was worth pinning
  // precisely because the interlock was new code in front of a live transport.
  //
  // `js/chatTransport.js`'s `get()`/`post()` were deleted on 2026-09-23 with
  // the rest of the Apps Script transport. There is no wire shape left to pin,
  // and the FOURTH state of DI-T5.1's table — "predicate never installed" —
  // no longer means "use the Sheet". It means this device has no shared chat
  // backend, which this module has always had a name for: interlocked.
  //
  // So the section asserts the NEW fact, and it is the one that matters on a
  // device in that state: the refusal is typed, it names the action, it is
  // flagged as DESIGNED rather than an outage (so chat.js holds the outbox and
  // the sync badge does not go red), and NOTHING reaches the network.
  FETCHES.length = 0;
  const neverInstalled = [
    ['fetchHead', () => transport.fetchHead(), 'chatHead'],
    ['fetchSince', () => transport.fetchSince(12, 300), 'chatSince'],
    ['fetchBefore', () => transport.fetchBefore(9, 100), 'chatBefore'],
    ['fetchMetrics', () => transport.fetchMetrics(7), 'chatMetrics'],
    ['appendEvents', () => transport.appendEvents([{ id: 'e1', type: 'message', author: 'p1', body: 'hi' }]), 'chatAppend'],
  ];
  for (const [name, call, action] of neverInstalled) {
    const e = await call().then(() => null, (err) => err);
    assert(e instanceof transport.ChatTransportUnavailableError,
      `${name}() on a device with NO chat context refuses with the typed error — the fourth state of DI-T5.1's table is 'interlocked' now, not 'sheets'`);
    assert(e && e.action === action, `${name}(): the refusal names the action it refused (${action})`);
    assert(e && e.interlocked === true,
      `${name}(): flagged as a DESIGNED refusal, not an outage — chat.js holds the outbox and the sync badge stays green`);
  }
  assert(FETCHES.length === 0,
    `and ZERO requests reached the network across all five (${FETCHES.length}) — there is no URL left for one to reach`);
  assert(transport.chatTransportMode() === 'interlocked',
    `chatTransportMode() answers 'interlocked' with no predicate installed — the string 'sheets' never comes out of it again (got ${transport.chatTransportMode()})`);
}

// ══════════════════════════════════════════════════════════════════════════
_realLog('\n[2] predicate TRUE — refused BEFORE any fetch, typed, all five…');
{
  transport.setSupabaseDataModePredicate(() => true);
  FETCHES.length = 0;
  const calls = [
    ['appendEvents', () => transport.appendEvents([{ id: 'e2' }])],
    ['fetchSince', () => transport.fetchSince(0)],
    ['fetchBefore', () => transport.fetchBefore(5)],
    ['fetchHead', () => transport.fetchHead()],
    ['fetchMetrics', () => transport.fetchMetrics(7)],
  ];
  for (const [name, call] of calls) {
    const e = await call().then(() => null, (err) => err);
    assert(e instanceof transport.ChatTransportUnavailableError, `${name}() throws ChatTransportUnavailableError`);
    assert(e && e.code === 'chat_transport_unavailable', `${name}(): the stable code is on the error`);
    assert(e && e.interlocked === true, `${name}(): marked interlocked — a designed refusal, not an outage`);
    assert(e && e.action === (name === 'appendEvents' ? 'chatAppend'
      : name === 'fetchSince' ? 'chatSince'
        : name === 'fetchBefore' ? 'chatBefore'
          : name === 'fetchHead' ? 'chatHead' : 'chatMetrics'),
    `${name}(): the error names the ACTION it refused`);
  }
  assert(FETCHES.length === 0, 'and ZERO fetches were issued across all five — the refusal is before the request');

  // The config is still perfectly valid, which is why the interlock has to be
  // checked BEFORE the "not configured" branch: otherwise it would never fire.
  assert(backend.isBackendConfigured() === true,
    'the Sheets config is still valid on this device (so "not configured" would NOT have refused these)');
}

// ══════════════════════════════════════════════════════════════════════════
_realLog('\n[3] subscribe() delivers nothing while interlocked, and resumes after…');
{
  transport.setSupabaseDataModePredicate(() => true);
  FETCHES.length = 0;
  const delivered = [];
  const statuses = [];
  const unsub = transport.subscribe((events, head, meta) => delivered.push({ events, head, meta }), {
    getMode: () => 'closed',
    getKnownHead: () => 0,
    onStatus: (s, d) => statuses.push([s, d]),
  });
  await new Promise((r) => setTimeout(r, 20));
  assert(FETCHES.length === 0, 'an interlocked subscription issues no fetch');
  assert(delivered.length === 0, 'and delivers nothing (onEvents is never called)');
  assert(statuses.length === 0, 'and reports no error status — this is not an outage');

  // It RESUMES with no re-subscribe when a SERVEABLE mode arrives, because the
  // decision is made per tick and not at subscribe time.
  //
  // PORTED 2026-09-23: this used to flip the predicate to `false` and assert
  // the tick reached the Apps Script network. `false` now means "no shared
  // backend", so the serveable mode is `true` + an installed chat context.
  // The property under test is unchanged — the subscription notices on its own
  // next tick — and the observable is now the fake client rather than a URL.
  const seen3 = installMinimalServeableChat(3);
  const forced = await unsub.forceTick();
  assert(forced === true, 'forceTick() after a serveable mode arrives reaches the backend without a re-subscribe');
  assert(seen3.head > 0,
    'and the round trip really happened — proven on the client recorder, not inferred from the return value');
  unsub();
  transport._resetSupabaseChatForTest();
  transport._resetSupabaseDataModePredicateForTest();
  const afterUnsub = FETCHES.length;
  const forcedAfter = await unsub.forceTick();
  assert(forcedAfter === false && FETCHES.length === afterUnsub,
    'unsubscribe() tears it down: a later forceTick() answers false and issues no fetch');
}

// ══════════════════════════════════════════════════════════════════════════
_realLog('\n[4] the OUTBOX HOLDS: a refused append is retained, never failed…');
{
  // A real drive through chat.js: sendEvent() stages into the outbox and
  // persists it; flushOutbox() calls appendEvents(), which refuses. The catch
  // at js/chat.js:824-838 increments `attempts` and pushes the entry BACK —
  // so the player's message waits for Step 5 rather than being lost.
  store.clear();
  storage.setBackendMode('local');
  storage.initStorage();
  storage.setSession('p1', false, true);
  backend.setDataMode('supabase');
  chat.clearOutbox();
  transport.setSupabaseDataModePredicate(() => true);
  FETCHES.length = 0;

  chat.sendEvent({ id: 'ob1', type: 'message', author: 'p1', gameTag: '', body: 'does this survive?' });
  assert(chat._outboxForTest().some((e) => e.id === 'ob1'), 'the event is staged in the outbox');
  await chat.flushOutbox();
  assert(FETCHES.length === 0, 'the flush issued NO fetch');
  const held = chat._outboxForTest();
  assert(held.some((e) => e.id === 'ob1'), 'and the event is STILL in the outbox after the refused flush');
  assert(chat.isFailed('ob1') === false, 'it is not marked failed (one refusal is not three attempts)');
  assert(localStorage.getItem('cfbp_chat_outbox2') !== null,
    'and the outbox is persisted, so it survives a reload and flushes when Step 5 lands');
  chat.clearOutbox();
  transport._resetSupabaseDataModePredicateForTest();
}

// ══════════════════════════════════════════════════════════════════════════
_realLog('\n[5] INSTALLED + throwing predicate FAILS CLOSED; NEVER-INSTALLED stays open…');
{
  // DI-T4.12 / security F-1. The two states are not the same state, and the earlier version of
  // this file pinned the wrong answer for one of them.
  const warn = console.warn;
  const warnings = [];
  console.warn = (...a) => warnings.push(a.map(String).join(' '));
  try {
    transport.setSupabaseDataModePredicate(() => { throw new Error('boom'); });
    FETCHES.length = 0;
    const e = await transport.fetchHead().then(() => null, (err) => err);
    assert(e instanceof transport.ChatTransportUnavailableError,
      'INSTALLED and throwing: the transport FAILS CLOSED — a typed ChatTransportUnavailableError');
    assert(FETCHES.length === 0,
      'and NOT ONE fetch goes out (a league whose mode cannot be determined must not append to the production Sheet)');
    assert(warnings.some((w) => /THREW after being installed/.test(w) && /fail closed/.test(w)),
      'with one console warning that names the cause AND the direction it chose');

    // The subscription half: a throwing installed predicate must not deliver either.
    const delivered = [];
    const unsub = transport.subscribe((evs) => delivered.push(evs), {
      getMode: () => 'closed', getKnownHead: () => 0, onStatus: () => {},
    });
    await new Promise((r) => setTimeout(r, 20));
    assert(FETCHES.length === 0 && delivered.length === 0,
      'and an interlocked-by-throw subscription issues no fetch and delivers nothing');
    unsub();
  } finally { console.warn = warn; }

  // A NON-FUNCTION ARGUMENT IS A PROGRAMMING ERROR AND THROWS AT INSTALL. It used to revert to
  // "chat is available", which meant a typo'd export name in Part B's wiring disabled the whole
  // interlock for the session, silently.
  for (const [label, arg] of [['null', null], ['undefined', undefined], ['a string', 'yes'], ['an object', {}]]) {
    let threw = null;
    try { transport.setSupabaseDataModePredicate(arg); } catch (err) { threw = err; }
    assert(threw instanceof TypeError, `setSupabaseDataModePredicate(${label}) THROWS a TypeError rather than silently reverting`);
    assert(threw && /interlock/i.test(threw.message), `and ${label}'s message says what the silent revert would have cost`);
  }
  // A failed install must not have moved the state: the throwing predicate from above is still in
  // place, so the transport is still closed. (A partial install that left `null` behind would be
  // the silent revert arriving by another door.)
  FETCHES.length = 0;
  const still = await transport.fetchHead().then(() => null, (err) => err);
  assert(still instanceof transport.ChatTransportUnavailableError && FETCHES.length === 0,
    'and a REFUSED install leaves the previously-installed predicate in force, not `null`');

  // ── SECURITY F-B — A NON-BOOLEAN RETURN IS NOT AN ANSWER EITHER ────────────────────────
  //
  // `answer === true` alone read every other value as "not interlocked". Each of these is a
  // plausible wiring mistake whose author plainly meant chat to be interlocked, and each one sent a
  // Supabase-scoped league's chat to the six players' production Sheet.
  {
    const warnings2 = [];
    const realWarn = console.warn;
    console.warn = (...a2) => warnings2.push(a2.map(String).join(' '));
    try {
      for (const [label, fn] of [
        ["the MODE STRING ('supabase') instead of a comparison", () => 'supabase'],
        ['a truthy number (1)', () => 1],
        ['the config OBJECT', () => ({ dataMode: 'supabase' })],
        ['an ASYNC predicate (a Promise is truthy but never === true)', async () => true],
      ]) {
        transport.setSupabaseDataModePredicate(fn);
        FETCHES.length = 0;
        const e2 = await transport.fetchHead().then(() => null, (err) => err);
        assert(e2 instanceof transport.ChatTransportUnavailableError,
          `returning ${label} FAILS CLOSED`);
        assert(FETCHES.length === 0, `and ${label} issues no fetch`);
      }
      assert(warnings2.filter((w) => /NON-BOOLEAN/.test(w)).length === 4,
        'each of the four warns once, naming the non-boolean (a safe-but-silent refusal is undiagnosable)');
      assert(warnings2.some((w) => /string/.test(w)) && warnings2.some((w) => /object/.test(w)),
        'and the warning names the TYPE it got back');

      // ── THE CONTROL, AND IT HAD TO BE REBUILT (2026-09-23) ──────────────────────────────
      //
      // It used to be: "a predicate returning a real `false` still lets the request out",
      // because `false` meant "this league is on the Sheet" and the Sheet was reachable. That
      // control existed for a precise reason — without it, "fails closed on a non-boolean" is
      // indistinguishable from "always closed", and every assertion above would pass against a
      // transport that had simply stopped working.
      //
      // `false` now means "no shared backend", so BOTH arms refuse and the old control can no
      // longer tell them apart. The distinguishing observables are (i) the WARNING, which only
      // the non-boolean path emits, and (ii) a predicate of `true` WITH a chat context, which is
      // the only serveable state and therefore the only positive control there is. Both are
      // asserted, because either alone is weaker than what this replaces.
      transport.setSupabaseDataModePredicate(() => false);
      const warnsBeforeFalse = warnings2.length;
      const refusedOnFalse = await transport.fetchHead().then(() => null, (err) => err);
      assert(refusedOnFalse instanceof transport.ChatTransportUnavailableError,
        'CONTROL (i): a real `false` ALSO refuses now — there is no Apps Script path behind it');
      assert(warnings2.length === warnsBeforeFalse,
        'CONTROL (i): …and it does so SILENTLY. Only the non-boolean path warns, which is what still separates "fails closed on a bad answer" from "always closed"');

      // CONTROL (ii) — the positive one. A serveable state really does serve, so nothing above
      // is passing against a transport that stopped working.
      installMinimalServeableChat(1);
      const served = await transport.fetchHead().then((r) => r, (err) => err);
      assert(served && served.head === 1,
        `CONTROL (ii): predicate true + chat context installed SERVES the request (got ${JSON.stringify(served)}) — the positive control the boolean path needs`);
      transport._resetSupabaseChatForTest();
      transport._resetSupabaseDataModePredicateForTest();
      FETCHES.length = 0;
    } finally { console.warn = realWarn; }
  }

  // NEVER INSTALLED — since 2026-09-23 this is a device with no shared chat backend, not the
  // flag-off Apps Script world. It refuses, and it refuses WITHOUT a warning: "nobody told me"
  // is not the same failure as "somebody told me something I cannot read".
  transport._resetSupabaseDataModePredicateForTest();
  FETCHES.length = 0;
  const open = await transport.fetchHead().then(() => null, (e) => e);
  assert(open instanceof transport.ChatTransportUnavailableError,
    'NEVER INSTALLED: chat refuses with the typed error — the fourth state of the mode table is \'interlocked\' now');
  assert(FETCHES.length === 0, 'and no request goes out — there is no URL for one to reach');
}

// ══════════════════════════════════════════════════════════════════════════════════════════
// PHASE III STEP 5 — THE SUPABASE MODE (DI-T5.1…T5.14)
//
// Sections [1]-[5] above are Step 4's and are NOT edited: they are the flag-off world and the
// fail-closed interlock, and DI-T5.11's byte-identity claim IS that they still pass unchanged.
// What follows is the fourth state of DI-T5.1's table — predicate installed, answers true, chat
// context installed — which Step 4 could only describe as "interlocked".
//
// THE FAKE IS DRIVEABLE, AND THAT IS THE POINT. A mock that always succeeds tests nothing: the
// interesting half of this transport is what it does with a REFUSAL, a GAP and a channel that
// says SUBSCRIBED without listening. So the fake can refuse any RPC by name, deliver Realtime
// rows in any order with any gap, and reach SUBSCRIBED without delivering anything at all —
// which is the RG-136 race, reproduced deterministically instead of waited for.
// ══════════════════════════════════════════════════════════════════════════════════════════

const projection = await import('./js/supabase-projection.js');

const LEAGUE = '11111111-1111-1111-1111-111111111111';

/** One `messages` row in the shape PostgREST really returns — the projection's own column names,
 *  a timestamptz STRING for `ts`, and `notify` as a boolean. Built here rather than hand-mapped so
 *  DI-T5.14's "the imported history reads identically" is measured against the real row shape. */
function row(seq, over = {}) {
  return {
    league_id: LEAGUE,
    id: over.id || `m${seq}`,
    seq,
    ts: new Date(1757000000000 + seq * 1000).toISOString(),
    type: 'message',
    author: 'p1',
    game_tag: '',
    body: `body ${seq}`,
    target_id: '',
    reply_to: '',
    notify: false,
    meta: null,
    ...over,
  };
}

function makeFakeSupabase() {
  const S = {
    rows: [],
    nextSeq: 1,
    rpc: [],            // { fn, args }
    selects: [],        // { table, cols, filters, order, limit }
    channels: [],
    refuse: null,       // (fn, args) -> { message, code } | null
    inserts: [],        // direct from('messages').insert() attempts — must stay EMPTY (S3)
  };

  const builder = (table) => {
    const q = { table, cols: null, filters: [], order: null, limit: null };
    const api = {
      select(cols) { q.cols = cols; return api; },
      insert(v) { S.inserts.push({ table, v }); return api; },
      eq(col, val) { q.filters.push(['eq', col, val]); return api; },
      gt(col, val) { q.filters.push(['gt', col, val]); return api; },
      lt(col, val) { q.filters.push(['lt', col, val]); return api; },
      order(col, opts) { q.order = { col, ascending: opts ? opts.ascending !== false : true }; return api; },
      limit(n) { q.limit = n; return api; },
      then(resolve) {
        S.selects.push({ ...q, filters: q.filters.map((f) => [...f]) });
        let out = S.rows.filter((r) => q.filters.every(([op, col, val]) =>
          (op === 'eq' && r[col] === val) || (op === 'gt' && r[col] > val) || (op === 'lt' && r[col] < val)));
        if (q.order) out = out.slice().sort((a, b) => (q.order.ascending ? 1 : -1) * (a[q.order.col] - b[q.order.col]));
        if (q.limit != null) out = out.slice(0, q.limit);
        // PostgREST returns ONLY the requested columns. Modelled, because the whole of annotation
        // A2 is that `emitted_by` is not in the list — a fake that returned whole rows would let a
        // transport that asked for it look identical to one that did not.
        const cols = (q.cols || '').split(',').map((c) => c.trim()).filter(Boolean);
        const projected = cols.length
          ? out.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])))
          : out.map((r) => ({ ...r }));
        resolve({ data: projected, error: null });
        return Promise.resolve({ data: projected, error: null });
      },
    };
    return api;
  };

  const client = {
    from: builder,
    async rpc(fn, args) {
      S.rpc.push({ fn, args });
      const refusal = S.refuse ? S.refuse(fn, args) : null;
      if (refusal) return { data: null, error: refusal };
      if (fn === 'chat_head') {
        return { data: S.rows.reduce((m, r) => Math.max(m, r.seq), 0), error: null };
      }
      if (fn === 'chat_append' || fn === 'chat_append_system') {
        const out = [];
        for (const ev of args.p_events) {
          const existing = S.rows.find((r) => r.id === ev.id);
          if (existing) { out.push({ id: ev.id, seq: existing.seq, deduped: true, ts: existing.ts }); continue; }
          const seq = S.nextSeq++;
          const r = row(seq, {
            id: ev.id, type: ev.type, author: ev.author,
            game_tag: ev.gameTag || '', body: ev.body || '',
            target_id: ev.targetId || '', reply_to: ev.replyTo || '',
            // The server's own packing rule, modelled: `notify` comes from meta._n and the stored
            // meta is `meta - '_n'`. If the transport stopped packing, this fake would store
            // notify:false and S4 would go red — which is the point of modelling it here rather
            // than echoing whatever came in.
            notify: !!(ev.meta && (ev.meta._n === 1 || ev.meta._n === true)),
            meta: (() => { const m = { ...(ev.meta || {}) }; delete m._n; return Object.keys(m).length ? m : null; })(),
            emitted_by: fn === 'chat_append_system' ? 'me' : null,
          });
          S.rows.push(r);
          out.push({ id: ev.id, seq, deduped: false, ts: r.ts });
        }
        return { data: out, error: null };
      }
      return { data: null, error: { message: `unknown rpc ${fn}` } };
    },
    channel(name) {
      const ch = {
        name, handlers: [], statusCb: null, removed: false,
        on(_evt, opts, cb) { ch.handlers.push({ opts, cb }); return ch; },
        subscribe(cb) { ch.statusCb = cb; return ch; },
        /** Drive the channel to a status WITHOUT delivering anything — the RG-136 gap. */
        status(s) { if (ch.statusCb) ch.statusCb(s); },
        /** Deliver one INSERT payload, in whatever order the caller likes. */
        emit(r) { for (const h of ch.handlers) h.cb({ eventType: 'INSERT', new: r }); },
      };
      S.channels.push(ch);
      return ch;
    },
    removeChannel(ch) { ch.removed = true; return true; },
  };
  return { client, S };
}

/** Installs the Supabase chat context around one fake, with a live league/epoch pair the test can
 *  move under the transport's feet (DI-T5.7). */
function installFake(fake, { leagueId = LEAGUE, epoch = 1, ready = true } = {}) {
  const ctl = { leagueId, epoch, ready };
  transport.installSupabaseChat({
    getClient: () => fake.client,
    getLeagueId: () => ctl.leagueId,
    rowToMessage: projection.rowToMessage,
    isReady: () => ctl.ready,
    getIdentityEpoch: () => ctl.epoch,
  });
  transport.setSupabaseDataModePredicate(() => true);
  transport._resetRefusalStateForTest();
  return ctl;
}

function resetToFlagOff() {
  transport._resetSupabaseChatForTest();
  transport._resetSupabaseDataModePredicateForTest();
  transport._resetRefusalStateForTest();
}

// ══════════════════════════════════════════════════════════════════════════
_realLog('\n[6] Supabase mode — the reads, and ZERO Apps Script fetches (S1, S2)…');
{
  const fake = makeFakeSupabase();
  installFake(fake);
  for (let i = 1; i <= 7; i++) fake.S.rows.push(row(i));
  fake.S.nextSeq = 8;
  FETCHES.length = 0;

  const head = await transport.fetchHead();
  assert(head.head === 7, `S2: fetchHead() answers the true head from chat_head (${head.head})`);

  const since = await transport.fetchSince(3, 300);
  assert(since.events.length === 4 && since.events[0].seq === 4 && since.events[3].seq === 7,
    'S2: fetchSince(3) returns seqs 4..7, ASCENDING');
  // THE CAPPED PAGE IS THE ONLY CASE THAT CAN TELL THE TWO APART, and its absence let a mutation
  // through: when the page happens to reach the end of the log, max(seq) of the page and the true
  // head are the SAME NUMBER, so an assertion made only on an uncapped page is satisfied by the
  // RG-94 defect itself. Ask for a page of THREE against a log of seven.
  const capped = await transport.fetchSince(0, 3);
  assert(capped.events.length === 3 && capped.events.at(-1).seq === 3,
    'S2: a capped page returns exactly the limit (3 of 7)');
  assert(capped.head === 7,
    'S2/RG-94: …and its `head` is 7 — the TRUE head, from a SEPARATE chat_head call, NOT max(seq) of the page. That difference IS the paging contract: drainSince() walks forward until the events in hand reach the true head, and a page-derived head would say it had arrived on page one, every time, leaving everything past the cap unrequested for the life of the session');
  assert(since.head === 7, 'S2: and the uncapped page reports the same true head');

  const before = await transport.fetchBefore(5, 2);
  assert(before.events.length === 2 && before.events[0].seq === 3 && before.events[1].seq === 4,
    'S2: fetchBefore(5, 2) returns the two newest below 5, REVERSED into ascending order (which is what backfill() has always been handed)');

  const metrics = await transport.fetchMetrics(7);
  assert(metrics.rows.length === 0 && metrics.unsupported === true,
    'S2: fetchMetrics() answers { rows: [], unsupported: true } — Supabase has no Apps Script quota to report, and "No metrics yet" would be a lie rather than an empty series');

  // THE COLUMN LIST, on the wire. Annotation A2 lives or dies here.
  const sel = fake.S.selects.find((q) => q.table === 'messages');
  assert(sel && sel.cols === 'league_id,id,seq,ts,type,author,game_tag,body,target_id,reply_to,notify,meta',
    'S2/A2: the select names TWELVE columns explicitly — never `*`, and never emitted_by/author_member_id/author_kind');
  assert(fake.S.selects.every((q) => q.filters.some(([op, c, v]) => op === 'eq' && c === 'league_id' && v === LEAGUE)),
    'S2: every read is scoped league_id=eq.<active league>');

  await transport.appendEvents([{ id: 'w1', type: 'message', author: 'p1', body: 'hi', notify: true, meta: null }]);
  assert(FETCHES.length === 0,
    'S1: ZERO fetches to the Apps Script URL across reads, the head, the backfill, the metrics AND a write (D-4\'s core claim, proven as a NEGATIVE on the existing recorder)');
  assert(fake.S.inserts.length === 0,
    'S3: and ZERO direct from(\'messages\').insert() — every write went through an RPC');
  resetToFlagOff();
}

// ══════════════════════════════════════════════════════════════════════════
_realLog('\n[7] Supabase mode — the writes: _n packing, chunking, routing, ts (S3, S4, S5, S15)…');
{
  const fake = makeFakeSupabase();
  installFake(fake);
  FETCHES.length = 0;

  // (a) notify round-trips. A transport that posted the raw client event would store notify:false
  //     on every row and silently take out the badge, the teaser, the mention count and the push.
  const a = await transport.appendEvents([
    { id: 'n1', type: 'message', author: 'p1', body: 'loud', notify: true, meta: { mentions: ['p2'] } },
    { id: 'n2', type: 'message', author: 'p1', body: 'quiet', notify: false, meta: null },
  ]);
  const stored = (id) => fake.S.rows.find((r) => r.id === id);
  assert(stored('n1').notify === true && stored('n2').notify === false,
    'S4: notify:true round-trips as notify:true and notify:false as false — packed into meta._n on the way out, which is the shape chat_append actually reads (0008:364)');
  assert(JSON.stringify(stored('n1').meta) === JSON.stringify({ mentions: ['p2'] }),
    'S4: …and `_n` is stripped from the stored meta, so the round trip back through rowToMessage() is exact');
  const sentMeta = fake.S.rpc.find((c) => c.fn === 'chat_append').args.p_events[0].meta;
  assert(sentMeta && sentMeta._n === 1, 'S4: the packing really happened on the wire (meta._n === 1), not just in the fake');
  assert(a.assigned.length === 2 && typeof a.assigned[0].ts === 'number' && a.assigned[0].ts > 0,
    'S4/D-2: `assigned` carries ts as EPOCH MS — without it the sender\'s own message keeps its device clock forever and cmpOrder (ts, seq) sorts his room differently from everyone else\'s');
  assert(a.assigned[0].deduped === false, 'S4: and `deduped` comes straight off the RPC');

  // (b) chunking at each RPC's own cap.
  fake.S.rpc.length = 0;
  const many = Array.from({ length: 120 }, (_, i) => ({ id: `b${i}`, type: 'message', author: 'p1', body: 'x', notify: false, meta: null }));
  const big = await transport.appendEvents(many);
  const appendCalls = fake.S.rpc.filter((c) => c.fn === 'chat_append');
  assert(appendCalls.length === 3 && appendCalls.map((c) => c.args.p_events.length).join(',') === '50,50,20',
    `S5: 120 queued events became THREE chat_append calls of 50/50/20 (${appendCalls.map((c) => c.args.p_events.length).join(',')})`);
  assert(appendCalls.every((c) => c.args.p_events.length <= 50), 'S5: a 51-event call is never made (chat_append raises too_many_events above 50)');
  assert(big.assigned.length === 120, 'S5: and all 120 come back in one concatenated `assigned`');

  // (c) routing by author, and the cap that goes with each route.
  fake.S.rpc.length = 0;
  await transport.appendEvents([
    { id: 'p_a', type: 'message', author: 'p1', body: 'player', notify: false, meta: null },
    { id: 'sys_lc_X', type: 'system', author: 'system', body: 'lifecycle', notify: false, meta: null },
    { id: 'scribe_llm_X', type: 'message', author: 'scribe', body: 'banter', notify: true, meta: null },
    { id: 'p_b', type: 'message', author: 'p1', body: 'player again', notify: false, meta: null },
  ]);
  const seq = fake.S.rpc.map((c) => `${c.fn}:${c.args.p_events.map((e) => e.id).join('+')}`);
  assert(JSON.stringify(seq) === JSON.stringify([
    'chat_append:p_a', 'chat_append_system:sys_lc_X+scribe_llm_X', 'chat_append:p_b',
  ]), `S15: system/SCRIBE events route to chat_append_system and player events to chat_append, in RUNS that preserve the room's order (${JSON.stringify(seq)})`);
  assert(!fake.S.rpc.some((c) => c.fn === 'chat_append' && c.args.p_events.some((e) => e.author === 'scribe' || e.author === 'system')),
    'S15: and a \'scribe\'/\'system\' event NEVER reaches chat_append — where it could only ever raise bad_author');

  const sysRun = Array.from({ length: 45 }, (_, i) => ({ id: `sys_lc_${i}`, type: 'message', author: 'scribe', body: 'x', notify: false, meta: null }));
  fake.S.rpc.length = 0;
  await transport.appendEvents(sysRun);
  const sysCalls = fake.S.rpc.filter((c) => c.fn === 'chat_append_system');
  assert(sysCalls.map((c) => c.args.p_events.length).join(',') === '20,20,5',
    `S5: a system run chunks at TWENTY, not fifty — chat_append_system's own cap (${sysCalls.map((c) => c.args.p_events.length).join(',')})`);
  assert(FETCHES.length === 0, 'S1: still zero Apps Script fetches across every write path');
  resetToFlagOff();
}

// ══════════════════════════════════════════════════════════════════════════
_realLog('\n[8] Supabase mode — the refusal vocabulary (S6, S7, and bad_state)…');
{
  const fake = makeFakeSupabase();
  installFake(fake);
  FETCHES.length = 0;
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...x) => warnings.push(x.map(String).join(' '));
  try {
    // (a) bad_author — PERMANENT. Answered once, then answered LOCALLY, so the outbox's remaining
    //     attempts cost the backend nothing.
    fake.S.refuse = (fn) => (fn === 'chat_append' ? { message: 'bad_author', code: 'P0001' } : null);
    const e1 = await transport.appendEvents([{ id: 'bad1', type: 'message', author: 'p2', body: 'not mine', notify: false, meta: null }])
      .then(() => null, (err) => err);
    assert(e1 instanceof transport.ChatWriteRefusedError && e1.refusal === 'permanent',
      'S6: `bad_author` is classified PERMANENT, in ONE place, with a typed error');
    assert(e1.refused === true,
      'S6: …and marked `refused`, so chat.js\'s catch treats it as a designed refusal rather than an outage (no red sync banner for a message the server simply declined)');
    const rpcBefore = fake.S.rpc.length;
    const e2 = await transport.appendEvents([{ id: 'bad1', type: 'message', author: 'p2', body: 'not mine', notify: false, meta: null }])
      .then(() => null, (err) => err);
    assert(e2 instanceof transport.ChatWriteRefusedError && fake.S.rpc.length === rpcBefore,
      'S6: a RE-SEND of a permanently-refused id is answered LOCALLY — no second RPC. The outbox\'s bounded ladder runs out against this module instead of against the server, which is the loud-fail rule applied to the one path where "try again" would look like it was working');
    assert(warnings.some((w) => /1 event\(s\).*permanently refused/.test(w) && !/not mine/.test(w)),
      'S6: the console line carries a COUNT and never the body or the foreign id (chat.js:1006-1010\'s rule)');
    assert(transport._refusalStateForTest().permanent.includes('bad1'), 'S6: and the id is remembered, bounded');

    // (b) bad_state — PARKED, not dropped (amendment A7). Full coverage is §[17].
    transport._resetRefusalStateForTest();
    fake.S.refuse = (fn) => (fn === 'chat_append_system' ? { message: 'bad_state', code: 'P0001' } : null);
    const e3 = await transport.appendEvents([{ id: 'sys_final_g1', type: 'system', author: 'system', body: 'final', notify: false, meta: null }])
      .then(() => null, (err) => err);
    assert(e3 instanceof transport.ChatWriteRefusedError && e3.refusal === 'retryable' && e3.code === 'bad_state',
      'A7: a `bad_state` refusal is surfaced as RETRYABLE, so the OUTBOX KEEPS the event — the server\'s answer is final for the state it saw, but annotation A1 gates on a transition travelling on a different debounced queue (chat.js\'s 750ms outbox vs the adapter\'s 800ms push), so the state is usually about to change');
    assert(transport._refusalStateForTest().permanent.length === 0
      && transport._refusalStateForTest().parked.includes('sys_final_g1'),
      'A7: …and the event is PARKED rather than memoised — this module now owns re-sending it');
    transport._resetRefusalStateForTest();

    // (c) the rate limit — RETRYABLE, with D-5's honest copy and a local cooldown.
    transport._resetRefusalStateForTest();
    fake.S.refuse = () => ({ message: 'messages: rate limit exceeded (31 events in 60s by member p1)', code: '42501' });
    const e4 = await transport.appendEvents([{ id: 'r1', type: 'message', author: 'p1', body: 'fast', notify: false, meta: null }])
      .then(() => null, (err) => err);
    assert(e4 instanceof transport.ChatWriteRefusedError && e4.refusal === 'retryable',
      'S7: a rate refusal is RETRYABLE — the batch is worth sending again, unlike bad_author');
    assert(e4.message === 'Sending too fast — your messages will go out in a minute.',
      'S7/D-5: …and its MESSAGE is the honest player-facing copy, because that is what reaches chat.js\'s S.lastError and the chat status line');
    assert(e4.retryAfterMs === 60000,
      'S7/D-5: retryAfterMs is 60s, not the 2s ladder — a rate limit answered in two seconds is the same answer');
    const rpcBefore2 = fake.S.rpc.length;
    fake.S.refuse = null;                       // the server would say yes now; the transport must not ask
    const e5 = await transport.appendEvents([{ id: 'r2', type: 'message', author: 'p1', body: 'fast', notify: false, meta: null }])
      .then(() => null, (err) => err);
    assert(e5 instanceof transport.ChatWriteRefusedError && e5.refusal === 'retryable' && fake.S.rpc.length === rpcBefore2,
      'S7: and inside the cooldown the transport refuses LOCALLY — no request at all, so a flapping outbox cannot hammer a backend that has already said "slow down"');

    // (d) identity — NOT decided here.
    transport._resetRefusalStateForTest();
    fake.S.refuse = () => ({ message: 'not_member', code: 'P0001' });
    const e6 = await transport.appendEvents([{ id: 'i1', type: 'message', author: 'p1', body: 'x', notify: false, meta: null }])
      .then(() => null, (err) => err);
    assert(e6.refusal === 'identity',
      'not_member / not_authenticated / PGRST301 are classified IDENTITY and handed on — Step 4 §5.2 gives identity ONE classifier, in js/auth.js, and this is not it');
    assert(transport._refusalStateForTest().permanent.length === 0,
      '…and an identity refusal never memoises the id: the answer is expected to change once the session resolves');
    assert(FETCHES.length === 0, 'S1: not one Apps Script fetch anywhere in the refusal suite');
  } finally { console.warn = realWarn; fake.S.refuse = null; resetToFlagOff(); }
}

// ══════════════════════════════════════════════════════════════════════════
_realLog('\n[9] Realtime — the B7-shaped ordering bracket: JOINED is not LIVE (S8)…');
{
  // THE RG-136 RACE, REPRODUCED. `SUBSCRIBED` fires when the channel JOINS, before the server has
  // registered postgres_changes underneath it; events committed in that window reach nobody. So
  // the channel is JOINED, not LIVE, and the post-join drain — which asks the TABLE — is the
  // probe. rls.test.mjs's B7 proves the same shape live, against a real socket, on `picks`.
  const fake = makeFakeSupabase();
  installFake(fake);
  for (let i = 1; i <= 4; i++) fake.S.rows.push(row(i));
  fake.S.nextSeq = 5;
  FETCHES.length = 0;

  const delivered = [];
  let known = 0;
  const sub = transport.subscribe(
    (events, head, meta) => { delivered.push({ events, head, meta }); for (const e of events) if (e.seq > known) known = e.seq; },
    { getMode: () => 'closed', getKnownHead: () => known, onStatus: () => {} },
  );
  await new Promise((r) => setTimeout(r, 30));
  assert(fake.S.channels.length === 1 && fake.S.channels[0].name === `chat:${LEAGUE}`,
    'S8: exactly ONE channel, named chat:<leagueId> — its own, never the adapter\'s league:<id> (AD-16)');
  const h = fake.S.channels[0].handlers[0];
  assert(h && h.opts.event === 'INSERT' && h.opts.table === 'messages' && h.opts.filter === `league_id=eq.${LEAGUE}`,
    'S8: INSERT only, on `messages`, filtered by league_id — the log is append-only, so subscribing to `*` would widen the surface for nothing');
  assert(sub._rtPhaseForTest() === 'joined',
    'S8: before any status at all the channel is JOINED, not LIVE');

  // SUBSCRIBED with NO delivery — the gap. The post-join drain must still produce the room.
  fake.S.channels[0].status('SUBSCRIBED');
  // MEASURED SYNCHRONOUSLY, ON THE STATUS CALLBACK'S OWN TURN, and this assertion exists because
  // its absence let a mutation through: checking the phase only AFTER the drain had landed was
  // satisfied just as well by a transport that promoted to LIVE the instant SUBSCRIBED arrived —
  // which is precisely RG-136's defect, and which would switch the poll ladder off on the strength
  // of a channel that has not proven anything. The drain is scheduled on a microtask, so nothing
  // has run yet at this line.
  assert(sub._rtPhaseForTest() === 'joined',
    'S8: SUBSCRIBED ALONE DOES NOT PROMOTE. The channel is still JOINED on the status callback\'s own turn — SUBSCRIBED fires when the channel joins, which is earlier than when the server registers postgres_changes, and a change committed in that window reaches nobody');
  await new Promise((r) => setTimeout(r, 40));
  assert(known === 4 && delivered.length >= 1,
    `S8: the post-join drain produced the whole room from a channel that delivered NOTHING (cursor ${known})`);
  assert(sub._rtPhaseForTest() === 'live',
    'S8: and only once that drain LANDED CAUGHT-UP does the channel become LIVE — SUBSCRIBED alone never promotes it');
  assert(FETCHES.length === 0, 'S1: and it did so with zero Apps Script fetches');

  // A drop back to JOINED re-arms the probe and restores the full ladder.
  fake.S.channels[0].status('CHANNEL_ERROR');
  assert(sub._rtPhaseForTest() === 'joined',
    'S8: CHANNEL_ERROR drops LIVE back to JOINED — nothing is switched off on the strength of a channel that has stopped proving itself');
  sub();
  assert(fake.S.channels[0].removed === true,
    'S8/R2: unsubscribe() removes the channel. Every teardown path reaches it — app.js\'s identity chokepoint, chat.js\'s setPollMode(\'paused\') behind a hold gate, and refreshChatEnabled()\'s OFF branch — so "the unread badge cannot count behind a hold" is true of Realtime too, with no change to js/chat.js');
  resetToFlagOff();
}

// ══════════════════════════════════════════════════════════════════════════
_realLog('\n[10] Realtime — the CONTIGUITY rule, the gap drain, and duplicates (S9, S10)…');
{
  const fake = makeFakeSupabase();
  installFake(fake);
  for (let i = 1; i <= 3; i++) fake.S.rows.push(row(i));
  fake.S.nextSeq = 4;

  const delivered = [];
  let known = 0;
  const sub = transport.subscribe(
    (events, head, meta) => { delivered.push({ events, head, meta }); for (const e of events) if (e.seq > known) known = e.seq; },
    { getMode: () => 'closed', getKnownHead: () => known, onStatus: () => {} },
  );
  await new Promise((r) => setTimeout(r, 20));
  fake.S.channels[0].status('SUBSCRIBED');
  await new Promise((r) => setTimeout(r, 40));
  assert(known === 3, `S9: the room is at seq 3 to begin with (${known})`);

  // (a) known+1 — delivered immediately. This is the 2-seconds-instead-of-60 win.
  const before = delivered.length;
  const r4 = row(4); fake.S.rows.push(r4); fake.S.nextSeq = 5;
  fake.S.channels[0].emit(r4);
  assert(delivered.length === before + 1 && delivered.at(-1).events.length === 1
    && delivered.at(-1).events[0].seq === 4 && delivered.at(-1).meta.caughtUp === true && known === 4,
    'S9: a Realtime row at known+1 is delivered IMMEDIATELY, alone, marked caughtUp');

  // (b) a GAP — nothing is handed up, a drain fills the range in order.
  const r5 = row(5), r6 = row(6), r7 = row(7);
  fake.S.rows.push(r5, r6, r7); fake.S.nextSeq = 8;
  const beforeGap = delivered.length;
  fake.S.channels[0].emit(r7);                 // known is 4; this is known+3
  assert(delivered.length === beforeGap,
    'S9: a row at known+3 delivers NOTHING on its own — handing it up would set chat.js\'s cursor to 7 and 5 and 6 would never be requested again for the life of the session (RG-94, re-created through a new door)');
  await new Promise((r) => setTimeout(r, 40));
  assert(known === 7, `S9: …it triggered a drain instead, and the cursor advanced CONTIGUOUSLY to 7 (${known})`);
  const gapDelivery = delivered.slice(beforeGap).flatMap((d) => d.events.map((e) => e.seq));
  assert(JSON.stringify(gapDelivery) === JSON.stringify([5, 6, 7]),
    `S9: and the range arrived in order, 5,6,7 — never skipping (${JSON.stringify(gapDelivery)})`);

  // (c) duplicates and rows at or below the cursor are dropped without re-litigating it.
  const beforeDup = delivered.length;
  fake.S.channels[0].emit(r7);
  fake.S.channels[0].emit(r5);
  assert(delivered.length === beforeDup && known === 7,
    'S10: a duplicate row and one BELOW the cursor are both dropped — the fold would dedupe them anyway (AD-10), but the cursor must not be re-litigated');

  // ── (d) DI-204 RESIDUAL R6 — THE PERMANENT SEQ HOLE A PRIVATE TEST ROW LEAVES.
  //
  // `send_test_push` (migration 0018) writes a real `messages` row visible to ONE member. For the
  // other five, that seq number is simply never delivered and never will be — a permanent hole in
  // an otherwise contiguous sequence. This section costs the claim in the runbook's residual R6:
  // ONE extra gap drain per device, once, at the next PUBLIC message — not a retry loop.
  //
  // THE FAKE MODELS A NON-RECIPIENT CORRECTLY, and that is the load-bearing detail. `S.rows` is
  // what the caller can SELECT, and the fake's `chat_head` is `max(seq)` over `S.rows` — which is
  // exactly `public.chat_head`'s real semantics, because it is SECURITY INVOKER (0003:532) and so
  // `messages_select` applies to its own aggregate. 0018 proves that property at paste time with a
  // `do $defcheck$` block that raises if either chat_head or chat_since is ever made DEFINER.
  // THAT is why this is one drain and not a loop: a non-recipient's head EXCLUDES the private row,
  // so the drain it triggers reaches caughtUp instead of chasing a head it can never match.
  const holeSelects = fake.S.selects.length;
  const beforeHole = delivered.length;
  fake.S.nextSeq = 9;                            // seq 8 is the private row: never in S.rows,
  const r9 = row(9); fake.S.rows.push(r9);       // never emitted to a non-recipient.
  fake.S.nextSeq = 10;
  fake.S.channels[0].emit(r9);                   // known is 7; this is known+2, not known+1
  assert(delivered.length === beforeHole,
    'S9/R6: the next PUBLIC row after a private one is NOT contiguous (known+2), so it is correctly withheld rather than handed up — the hole must not be papered over by delivering across it');
  await new Promise((r) => setTimeout(r, 40));
  assert(known === 9, `S9/R6: …a drain filled it instead, and the cursor reached 9 (${known})`);
  const holeDelivery = delivered.slice(beforeHole).flatMap((d) => d.events.map((e) => e.seq));
  assert(JSON.stringify(holeDelivery) === JSON.stringify([9]),
    `S9/R6: …delivering ONLY seq 9. Seq 8 is not invented, not skipped-with-a-placeholder, and never appears (${JSON.stringify(holeDelivery)})`);
  assert(delivered.at(-1).meta.caughtUp === true,
    'S9/R6: …and the drain lands CAUGHT-UP. This is the whole claim: chat_head is INVOKER, so a non-recipient\'s head is 9, not 10 — it does not spend the rest of the session behind a head it can never reach');
  const drainSelects = fake.S.selects.length - holeSelects;
  assert(drainSelects === 1,
    `S9/R6: …at a cost of EXACTLY ONE extra page read (${drainSelects}). One drain, one page, then done — not a retry loop, which is what a DEFINER chat_head would have produced`);
  // And the hole is spent: the NEXT public row is contiguous again and costs nothing.
  const afterHole = fake.S.selects.length;
  const r10 = row(10); fake.S.rows.push(r10); fake.S.nextSeq = 11;
  fake.S.channels[0].emit(r10);
  assert(known === 10 && fake.S.selects.length === afterHole,
    `S9/R6: …and the cost is paid ONCE. The next public row is known+1 again and is delivered straight off Realtime with no read at all (known=${known}, extra reads=${fake.S.selects.length - afterHole})`);
  sub();
  resetToFlagOff();
}

// ══════════════════════════════════════════════════════════════════════════
_realLog('\n[11] Realtime — the 60s head-only reconcile while LIVE (D-3)…');
{
  const fake = makeFakeSupabase();
  installFake(fake);
  for (let i = 1; i <= 2; i++) fake.S.rows.push(row(i));
  fake.S.nextSeq = 3;
  let known = 0;
  const sub = transport.subscribe(
    (events) => { for (const e of events) if (e.seq > known) known = e.seq; },
    { getMode: () => 'hot', getKnownHead: () => known, onStatus: () => {} },
  );
  await new Promise((r) => setTimeout(r, 20));
  fake.S.channels[0].status('SUBSCRIBED');
  await new Promise((r) => setTimeout(r, 40));
  assert(sub._rtPhaseForTest() === 'live' && known === 2, 'D-3: the channel is LIVE and the room is current');

  // A row committed while LIVE that the channel never delivers — the failure `phase:'live'` cannot
  // detect, and the only reason the reconcile tick exists.
  fake.S.rows.push(row(3)); fake.S.nextSeq = 4;
  fake.S.rpc.length = 0;
  const forced = await sub.forceTick();
  assert(forced === true && known === 3,
    'D-3: a head-only reconcile finds a row Realtime silently dropped and drains to it — Realtime primary, a poll as the net, never Realtime alone (Drew\'s own D-7 shape for picks)');
  assert(fake.S.rpc[0] && fake.S.rpc[0].fn === 'chat_head',
    'D-3: and the tick starts with the CHEAP chat_head probe, draining only when the head is ahead');
  sub();
  resetToFlagOff();
}

// ══════════════════════════════════════════════════════════════════════════
_realLog('\n[12] The identity chokepoint: league switch and a mid-flight epoch bump (S11, S12)…');
{
  const fake = makeFakeSupabase();
  const ctl = installFake(fake);
  for (let i = 1; i <= 2; i++) fake.S.rows.push(row(i));
  fake.S.nextSeq = 3;
  let known = 0;
  const sub = transport.subscribe(
    (events) => { for (const e of events) if (e.seq > known) known = e.seq; },
    { getMode: () => 'closed', getKnownHead: () => known, onStatus: () => {} },
  );
  await new Promise((r) => setTimeout(r, 20));
  fake.S.channels[0].status('SUBSCRIBED');
  await new Promise((r) => setTimeout(r, 40));
  const firstChannel = fake.S.channels[0];
  assert(firstChannel.name === `chat:${LEAGUE}`, 'S11: subscribed to league A');

  // (a) an event for the league this device has already left is DISCARDED.
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...x) => warnings.push(x.map(String).join(' '));
  const LEAGUE_B = '22222222-2222-2222-2222-222222222222';
  ctl.leagueId = LEAGUE_B;
  const beforeKnown = known;
  firstChannel.emit(row(3));
  assert(known === beforeKnown && warnings.some((w) => /already left/.test(w)),
    'S12/I6: an in-flight Realtime event stamped with the league this device has LEFT is discarded with a console line — `_opMoved()`\'s discipline (js/supabase-backend.js:873), which reviewer F2 had to make real in the adapter after the first version compared a value to itself');

  // (b) the next tick drops the old channel and re-subscribes scoped to the NEW league.
  await sub.forceTick();
  await new Promise((r) => setTimeout(r, 20));
  assert(firstChannel.removed === true,
    'S11/R2: league A\'s channel is REMOVED before a new one is opened');
  const second = fake.S.channels[fake.S.channels.length - 1];
  assert(second.name === `chat:${LEAGUE_B}` && second.handlers[0].opts.filter === `league_id=eq.${LEAGUE_B}`,
    'S11/R2: …and the new one is scoped to league B\'s league_id — the release is driven by the tick itself, so it heals even if app.js re-orders the teardown');

  // (c) an epoch bump mid-flight.
  ctl.leagueId = LEAGUE;
  await sub.forceTick();
  await new Promise((r) => setTimeout(r, 20));
  warnings.length = 0;
  const live = fake.S.channels[fake.S.channels.length - 1];
  ctl.epoch = 2;
  const k2 = known;
  live.emit(row(9));
  assert(known === k2 && warnings.some((w) => /already left/.test(w)),
    'S12/I6: an identity EPOCH bump discards an in-flight event too — an account handover on the same phone never moves the league, so the league term alone would have let the previous player\'s room fold under the new session');
  console.warn = realWarn;
  sub();
  resetToFlagOff();
}

// ══════════════════════════════════════════════════════════════════════════
_realLog('\n[13] The hold gate and offline (DI-T5.8), and the fourth state (S13)…');
{
  // (a) isReady() false — no fetch, no channel, and no boot-ladder rung spent.
  const fake = makeFakeSupabase();
  const ctl = installFake(fake, { ready: false });
  fake.S.rows.push(row(1));
  fake.S.nextSeq = 2;
  FETCHES.length = 0;
  let known = 0;
  const sub = transport.subscribe(
    (events) => { for (const e of events) if (e.seq > known) known = e.seq; },
    { getMode: () => 'closed', getKnownHead: () => known, onStatus: () => {} },
  );
  await new Promise((r) => setTimeout(r, 30));
  assert(fake.S.rpc.length === 0 && fake.S.channels.length === 0 && known === 0,
    'DI-T5.8: while the mirror is not serving, chat issues NO request and opens NO channel — and it does not tear the subscription down either, so a release needs no re-subscribe');
  ctl.ready = true;
  await sub.forceTick();
  await new Promise((r) => setTimeout(r, 30));
  assert(known === 1 && fake.S.channels.length === 1,
    'DI-T5.8/R2: …and the RELEASE is driven forward, not inspected: the next tick fetches and opens the channel');
  sub();

  // (b) offline — the browser says so, so nothing is asked for.
  // Node 24 defines `navigator` as a getter-only accessor on globalThis, so a plain assignment
  // throws. defineProperty is the way in, and the original descriptor is put back afterwards.
  const savedNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true, writable: true });
  const fake2 = makeFakeSupabase();
  installFake(fake2);
  fake2.S.rows.push(row(1));
  let known2 = 0;
  const sub2 = transport.subscribe(
    (events) => { for (const e of events) if (e.seq > known2) known2 = e.seq; },
    { getMode: () => 'closed', getKnownHead: () => known2, onStatus: () => {} },
  );
  await new Promise((r) => setTimeout(r, 30));
  assert(fake2.S.rpc.length === 0 && fake2.S.channels.length === 0,
    'DI-T5.8: OFFLINE — no fetch is issued and no channel is opened; chat renders from the device-local events cache and the outbox ACCEPTS sends and holds them, which is the one place chat is deliberately more permissive than save()');
  sub2();
  if (savedNav) Object.defineProperty(globalThis, 'navigator', savedNav);
  else delete globalThis.navigator;
  resetToFlagOff();

  // (c) THE FOURTH STATE. Predicate installed and answering true, chat context NOT installed.
  transport.setSupabaseDataModePredicate(() => true);
  FETCHES.length = 0;
  const err = await transport.fetchHead().then(() => null, (e) => e);
  assert(err instanceof transport.ChatTransportUnavailableError && FETCHES.length === 0,
    'S13: predicate true + chat context NOT installed => the Step 4 refusal, verbatim, and ZERO fetches. Part B installs the predicate and the context in the same boot; if they ever land in separate commits there is a build in between, and that build must fail CLOSED rather than send a Supabase-scoped league\'s chat to the six players\' production Sheet');
  assert(transport.chatTransportMode() === 'interlocked', 'S13: and the mode reads \'interlocked\', not \'supabase\'');
  const errA = await transport.appendEvents([{ id: 'x' }]).then(() => null, (e) => e);
  assert(errA instanceof transport.ChatTransportUnavailableError && FETCHES.length === 0,
    'S13: the WRITE half too — an append that reached the production Sheet could not be taken back');
  resetToFlagOff();
}

// ══════════════════════════════════════════════════════════════════════════
_realLog('\n[14] installSupabaseChat() fails LOUD, and the mode table (DI-T5.1)…');
{
  for (const slot of ['getClient', 'getLeagueId', 'rowToMessage', 'isReady']) {
    const deps = {
      getClient: () => ({}), getLeagueId: () => LEAGUE,
      rowToMessage: (r) => r, isReady: () => true,
    };
    deps[slot] = undefined;
    let threw = null;
    try { transport.installSupabaseChat(deps); } catch (e) { threw = e; }
    assert(threw instanceof TypeError && new RegExp(slot).test(threw.message),
      `installSupabaseChat({ ${slot}: undefined }) THROWS a TypeError naming the slot — a silent partial install would leave chat interlocked for the whole session with no error and no log line`);
  }
  resetToFlagOff();
  // THE TABLE, AS AMENDED 2026-09-23. Two of its four rows used to answer
  // 'sheets' and meant "use the Apps Script chat log". That log is retired, so
  // both answer 'interlocked' — the state this module already had for "refuse
  // before any request, loudly, with a typed error". The table still has four
  // distinct INPUTS and the function is still the one place they are evaluated;
  // what changed is that two of them now share an outcome.
  assert(transport.chatTransportMode() === 'interlocked',
    'DI-T5.1: never installed => \'interlocked\'. A device with no shared chat backend, which is what a local-only build is');
  transport.setSupabaseDataModePredicate(() => false);
  assert(transport.chatTransportMode() === 'interlocked', 'DI-T5.1: installed and answering false => \'interlocked\' too');
  transport.setSupabaseDataModePredicate(() => true);
  assert(transport.chatTransportMode() === 'interlocked', 'DI-T5.1: installed + true, no chat context => \'interlocked\'');
  const fake = makeFakeSupabase();
  installFake(fake);
  assert(transport.chatTransportMode() === 'supabase', 'DI-T5.1: installed + true + chat context => \'supabase\'. Four states, one function, no second opinion');

  // ── THE FIFTH COMBINATION, and it is the one that decides DI-T5.11 ──────────────────────
  //
  // Chat context installed, predicate NEVER installed. This is not a state Part B produces on
  // purpose — but it is exactly what a mode function written as `_sbChat ? 'supabase' : …` would
  // make of a device whose predicate wiring failed or ran late, and the answer it gives is the
  // whole of the flag-off guarantee: `_sbChat` says the build CAN serve Supabase, and the
  // PREDICATE says whether this league SHOULD. Only the second question is about this league.
  // Its absence let a mutation through — the mode is asked of `_sbChat` first, every existing
  // assertion still passed, and a flag-off device would have gone to Supabase.
  transport._resetSupabaseDataModePredicateForTest();
  assert(transport.chatTransportMode() === 'interlocked',
    'DI-T5.11: chat context installed + predicate NEVER installed => \'interlocked\', NOT \'supabase\'. The predicate is what says whether THIS LEAGUE\'s data has moved; the context only says this build COULD serve it. A mode written as `_sbChat ? \'supabase\' : …` answers the wrong question and every other assertion in this file still passes');
  FETCHES.length = 0;
  backend.setDataMode('supabase');
  const open5 = await transport.fetchHead().then(() => null, (e) => e);
  assert(open5 instanceof transport.ChatTransportUnavailableError && FETCHES.length === 0,
    'DI-T5.11: …and the request is REFUSED rather than served from the installed context — proven by driving it, not inferred from the mode string');
  resetToFlagOff();
}

// ══════════════════════════════════════════════════════════════════════════
_realLog('\n[15] DI-T5.14 — the imported history folds IDENTICALLY through both paths…');
{
  // THE CHEAPEST STRONG TEST IN THE STEP. The same events, once through the Sheets wire shape and
  // once through PostgREST rows + the injected rowToMessage(), must produce a BYTE-IDENTICAL
  // `_foldedSnapshot()` — and must keep doing so when the Supabase side arrives shuffled, because
  // Realtime is not ordered and the fold's order-independence (AD-10) is what makes that safe.
  const sheetEvents = [
    { seq: 1, id: 'h1', ts: 1757000001000, type: 'message', author: 'p1', gameTag: '', body: 'first', targetId: '', replyTo: '', notify: true, meta: { mentions: ['p2'] } },
    { seq: 2, id: 'h2', ts: 1757000002000, type: 'message', author: 'p2', gameTag: 'g_1', body: 'reply', targetId: '', replyTo: 'h1', notify: false, meta: null },
    { seq: 3, id: 'h3', ts: 1757000003000, type: 'react', author: 'p3', gameTag: '', body: '', targetId: 'h1', replyTo: '', notify: false, meta: { emoji: '🔥' } },
    { seq: 4, id: 'h4', ts: 1757000004000, type: 'edit', author: 'p1', gameTag: '', body: 'first (edited)', targetId: 'h1', replyTo: '', notify: false, meta: null },
    { seq: 5, id: 'h5', ts: 1757000005000, type: 'pin', author: 'scribe', gameTag: '', body: '', targetId: 'h2', replyTo: '', notify: false, meta: null },
    { seq: 6, id: 'sys_lc_OPEN_w1', ts: 1757000006000, type: 'message', author: 'scribe', gameTag: '', body: 'Picks are open', targetId: '', replyTo: '', notify: true, meta: { kind: 'lifecycle' } },
  ];
  // The SAME six, as PostgREST would hand them back: snake_case columns, timestamptz strings,
  // `notify` already unpacked out of meta._n by the importer.
  const pgRows = sheetEvents.map((e) => ({
    league_id: LEAGUE, id: e.id, seq: e.seq, ts: new Date(e.ts).toISOString(), type: e.type,
    author: e.author, game_tag: e.gameTag, body: e.body, target_id: e.targetId,
    reply_to: e.replyTo, notify: e.notify, meta: e.meta,
  }));

  chat._resetForTest();
  chat.ingest(sheetEvents, 6, { caughtUp: true });
  const sheetFold = chat._foldedSnapshot();

  chat._resetForTest();
  const mapped = pgRows.map(projection.rowToMessage);
  chat.ingest(mapped, 6, { caughtUp: true });
  assert(chat._foldedSnapshot() === sheetFold,
    'DI-T5.14: the Supabase read path folds BYTE-IDENTICALLY to the Sheets path — same ids, same seq order, same pinned set, same reactions, same edit, same notify flags');

  for (let round = 0; round < 10; round++) {
    const shuffled = mapped.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    chat._resetForTest();
    chat.ingest(shuffled, 6, { caughtUp: true });
    if (chat._foldedSnapshot() !== sheetFold) { assert(false, `DI-T5.14: shuffle round ${round} folded differently`); break; }
    if (round === 9) assert(true, 'DI-T5.14: …and it stays byte-identical under shuffle ×10, which is what makes an out-of-order Realtime delivery safe (AD-10)');
  }
  assert(mapped.every((m) => !('emitted_by' in m) && !('author_member_id' in m) && !('author_kind' in m)),
    'DI-T5.14/A2: and the mapped event carries NONE of the derived/attribution columns — they have never existed on the wire event, and one of them is ungranted');
  chat._resetForTest();
  resetToFlagOff();
}

// ══════════════════════════════════════════════════════════════════════════
_realLog('\n[16] DI-T5.11 — the NON-SUPABASE path is unchanged, measured AFTER everything above…');
{
  // The never-installed path, re-measured at the END of the file. Sections [1]-[5] proved it
  // before the Supabase mode existed in this process; this proves the Supabase mode cannot leave
  // anything behind that changes it — a module-level cooldown, a remembered id, a live channel.
  //
  // WHAT "UNCHANGED" MEANS SINCE 2026-09-23. It used to mean "all five requests still go to the
  // Apps Script network, with byte-identical URLs and a byte-identical POST body" — the flag-off
  // guarantee Step 4 and Step 5 each owed, because the Sheet was a live backend and the interlock
  // was new code in front of it. That transport is deleted, so the guarantee this section carries
  // forward is the one that still has content: the Supabase sections above leave NOTHING behind
  // that could make a non-Supabase device behave differently from a cold one. All five refuse,
  // all five refuse with the typed designed-refusal error, and none of them touches the network.
  resetToFlagOff();
  backend.setDataMode('supabase');
  FETCHES.length = 0;
  const five = [
    ['fetchHead', () => transport.fetchHead()],
    ['fetchSince', () => transport.fetchSince(12, 300)],
    ['fetchBefore', () => transport.fetchBefore(9, 100)],
    ['fetchMetrics', () => transport.fetchMetrics(7)],
    ['appendEvents', () => transport.appendEvents([{ id: 'e1', type: 'message', author: 'p1', body: 'hi' }])],
  ];
  for (const [name, call] of five) {
    const e = await call().then(() => null, (err) => err);
    assert(e instanceof transport.ChatTransportUnavailableError,
      `DI-T5.11: ${name}() still refuses with the typed error after every Supabase section in this file has run — no cooldown, remembered id or live channel from them leaks into this path`);
  }
  assert(FETCHES.length === 0,
    `DI-T5.11: and ZERO requests reached the network (${FETCHES.length})`);
  assert(transport.chatTransportMode() === 'interlocked',
    `DI-T5.11: the mode is still 'interlocked' at the end of the run (got ${transport.chatTransportMode()})`);
}

// ══════════════════════════════════════════════════════════════════════════
_realLog('\n[17] AMENDMENT A7 — park a `bad_state` and re-send it, bounded…');
{
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const sysEv = (id) => ({ id, type: 'system', author: 'system', body: 'final', notify: false, meta: null });

  // (a) REFUSED, THEN THE STATE LANDS ⇒ DELIVERED, EXACTLY ONCE.
  //     This is the race the amendment exists for: the post overtakes its own transition by ~50ms,
  //     is refused, and must go out again the moment the transition arrives — without the player
  //     ever seeing a failure.
  {
    const fake = makeFakeSupabase();
    installFake(fake);
    transport._setParkScheduleForTest({ steps: [15, 30, 60, 120], ceilingMs: 5000 });
    fake.S.refuse = (fn) => (fn === 'chat_append_system' ? { message: 'bad_state', code: 'P0001' } : null);
    await transport.appendEvents([sysEv('sys_final_race')]).then(() => null, () => null);
    assert(transport._refusalStateForTest().parked.length === 1, 'A7: the refused post is parked');

    // The adapter's flush lands — the state the post was waiting on is now in the database.
    fake.S.refuse = null;
    const before = fake.S.rpc.filter((c) => c.fn === 'chat_append_system').length;
    await wait(60);
    const resends = fake.S.rpc.filter((c) => c.fn === 'chat_append_system').length - before;
    assert(resends === 1, `A7: exactly ONE resend went out once the state was there (${resends})`);
    assert(fake.S.rows.some((r) => r.id === 'sys_final_race'),
      'A7: …and the post LANDED — the row is in the log, so the subscription ingests it and chat.js\'s ingest() reconcile branch settles the waiter (js/chat.js:538-541), the same path RG-95 already relies on');
    assert(transport._refusalStateForTest().parked.length === 0,
      'A7: …and the park is empty again, so nothing keeps re-sending a post that has landed');
    resetToFlagOff();
  }

  // (b) REFUSED FOREVER ⇒ FAILED AFTER THE CEILING, WITH EXACTLY THE BOUNDED NUMBER OF ATTEMPTS.
  //     Bounded is load-bearing for the reason every accelerated path in this module is bounded:
  //     an unbounded resend against a state that is never going to arrive is a quota bug wearing a
  //     fix's clothes, and it would keep a post alive long after the player was told it failed.
  {
    const fake = makeFakeSupabase();
    installFake(fake);
    transport._setParkScheduleForTest({ steps: [10, 10, 10, 10], ceilingMs: 5000 });
    fake.S.refuse = (fn) => (fn === 'chat_append_system' ? { message: 'bad_state', code: 'P0001' } : null);
    const first = await transport.appendEvents([sysEv('sys_final_never')]).then(() => null, (e) => e);
    assert(first.refusal === 'retryable', 'A7: the first refusal is retryable');
    const firstCalls = fake.S.rpc.filter((c) => c.fn === 'chat_append_system').length;
    await wait(200);
    const total = fake.S.rpc.filter((c) => c.fn === 'chat_append_system').length;
    assert(total - firstCalls === 4,
      `A7: EXACTLY FOUR resends — the step list, and not one more (${total - firstCalls}). An unbounded ladder would have spent the whole 200ms window`);
    assert(transport._refusalStateForTest().parked.length === 0
      && transport._refusalStateForTest().permanent.includes('sys_final_never'),
      'A7: …and past the ceiling it becomes the PERMANENT refusal — the park is released and the id is memoised');
    const after = await transport.appendEvents([sysEv('sys_final_never')]).then(() => null, (e) => e);
    assert(after instanceof transport.ChatWriteRefusedError && after.refusal === 'permanent',
      'A7: so the next attempt gets the permanent answer, which is what puts the FAILED chip up — the player is owed that once the state is simply not coming');
    resetToFlagOff();
  }

  // (c) ONE RESEND IN FLIGHT PER ID. The outbox retries on its own 2s/4s ladder while this module
  //     is re-sending; both must not be sending the same deterministic id.
  {
    const fake = makeFakeSupabase();
    installFake(fake);
    transport._setParkScheduleForTest({ steps: [400], ceilingMs: 5000 });
    fake.S.refuse = (fn) => (fn === 'chat_append_system' ? { message: 'bad_state', code: 'P0001' } : null);
    await transport.appendEvents([sysEv('sys_final_once')]).then(() => null, () => null);
    const base = fake.S.rpc.filter((c) => c.fn === 'chat_append_system').length;
    const again = await transport.appendEvents([sysEv('sys_final_once')]).then(() => null, (e) => e);
    assert(again instanceof transport.ChatWriteRefusedError && again.refusal === 'retryable'
      && fake.S.rpc.filter((c) => c.fn === 'chat_append_system').length === base,
      'A7: while an id is parked the OUTBOX\'s own retry is answered LOCALLY with no request — one resender per id, so a bounded ladder cannot become an unbounded one by having two owners');
    resetToFlagOff();
  }

  // (d) onAdapterSynced — the whole reason the dep exists. It turns a 2-to-20-second wait into one
  //     round trip, and with NO dep injected the ladder's first rung is the documented fallback.
  {
    const fake = makeFakeSupabase();
    let fire = null;
    transport.installSupabaseChat({
      getClient: () => fake.client, getLeagueId: () => LEAGUE,
      rowToMessage: projection.rowToMessage, isReady: () => true,
      getIdentityEpoch: () => 1,
      onAdapterSynced: (cb) => { fire = cb; return () => { fire = null; }; },
    });
    transport.setSupabaseDataModePredicate(() => true);
    transport._resetRefusalStateForTest();
    transport._setParkScheduleForTest({ steps: [10000], ceilingMs: 60000 });   // the ladder is far away
    fake.S.refuse = (fn) => (fn === 'chat_append_system' ? { message: 'bad_state', code: 'P0001' } : null);
    await transport.appendEvents([sysEv('sys_final_synced')]).then(() => null, () => null);
    assert(typeof fire === 'function', 'A7: the adapter\'s `synced` signal was subscribed at install');
    fake.S.refuse = null;
    const before = fake.S.rpc.filter((c) => c.fn === 'chat_append_system').length;
    fire();
    await wait(30);
    const sent = fake.S.rpc.filter((c) => c.fn === 'chat_append_system').length - before;
    assert(sent === 1 && fake.S.rows.some((r) => r.id === 'sys_final_synced'),
      `A7: the adapter reporting its flush LANDED resends immediately — one round trip instead of a ten-second wait (${sent})`);

    // ONE RESEND IN FLIGHT PER ID, through the path that can actually reach it. The adapter emits
    // `synced` once per flush and a burst of writes produces a burst of flushes, so two signals
    // arriving in the same tick is ordinary rather than exotic — and without the in-flight guard
    // the second one starts a SECOND resend of the same deterministic id while the first is still
    // open. (The other half of the guard, the pending-timer check inside _scheduleParked(), is
    // defence in depth with no reachable path today; it is pinned by static.check.mjs's
    // S5/A7 rule rather than claimed here.)
    transport._resetRefusalStateForTest();
    transport._setParkScheduleForTest({ steps: [10000], ceilingMs: 60000 });
    fake.S.refuse = (fn) => (fn === 'chat_append_system' ? { message: 'bad_state', code: 'P0001' } : null);
    await transport.appendEvents([sysEv('sys_final_double')]).then(() => null, () => null);
    fake.S.refuse = null;
    const before2 = fake.S.rpc.filter((c) => c.fn === 'chat_append_system').length;
    fire();
    fire();                                   // a second `synced` in the same tick
    await wait(30);
    const sent2 = fake.S.rpc.filter((c) => c.fn === 'chat_append_system').length - before2;
    assert(sent2 === 1,
      `A7: TWO adapter 'synced' signals in one tick still produce exactly ONE resend — the in-flight guard, not luck (${sent2})`);
    resetToFlagOff();
  }

  // (e) R2 — A HANDOVER MID-PARK DROPS THE SET AND SENDS NOTHING. A parked post belongs to one
  //     room under one identity; relaying it into another is the failure chat.js's own outbox
  //     league stamp exists to prevent (SECURITY F-4), one layer out.
  {
    const fake = makeFakeSupabase();
    const ctl = installFake(fake);
    transport._setParkScheduleForTest({ steps: [40], ceilingMs: 5000 });
    fake.S.refuse = (fn) => (fn === 'chat_append_system' ? { message: 'bad_state', code: 'P0001' } : null);
    await transport.appendEvents([sysEv('sys_final_handover')]).then(() => null, () => null);
    assert(transport._refusalStateForTest().parked.length === 1, 'A7/R1: the post is parked under the current identity');
    const warns = [];
    const realWarn = console.warn;
    console.warn = (...x) => warns.push(x.map(String).join(' '));
    try {
      fake.S.refuse = null;                       // the server would accept it now
      ctl.epoch = 2;                              // …but this device has changed hands
      const before = fake.S.rpc.filter((c) => c.fn === 'chat_append_system').length;
      await wait(120);
      assert(fake.S.rpc.filter((c) => c.fn === 'chat_append_system').length === before
        && !fake.S.rows.some((r) => r.id === 'sys_final_handover'),
        'A7/R2: NOTHING was sent after the identity moved — the previous session\'s parked post never reaches the room');
      assert(transport._refusalStateForTest().parked.length === 0
        && warns.some((w) => /parked system post/.test(w) && /1/.test(w) && !/sys_final_handover/.test(w)),
        'A7/R2: …the set is dropped, and the console line carries a COUNT and never an id (chat.js:1006-1010\'s rule)');
    } finally { console.warn = realWarn; }
    resetToFlagOff();
  }

  // (f) R2 again, through the other door: a subscription teardown (a hold gate) drops the set.
  {
    const fake = makeFakeSupabase();
    installFake(fake);
    transport._setParkScheduleForTest({ steps: [40], ceilingMs: 5000 });
    fake.S.refuse = (fn) => (fn === 'chat_append_system' ? { message: 'bad_state', code: 'P0001' } : null);
    let known = 0;
    const sub = transport.subscribe((events) => { for (const e of events) if (e.seq > known) known = e.seq; },
      { getMode: () => 'closed', getKnownHead: () => known, onStatus: () => {} });
    await wait(20);
    await transport.appendEvents([sysEv('sys_final_hold')]).then(() => null, () => null);
    assert(transport._refusalStateForTest().parked.length === 1, 'A7: parked while the subscription is up');
    const realWarn2 = console.warn;
    console.warn = () => {};
    try {
      sub();                                       // chat.js's setPollMode('paused') behind a hold gate
      fake.S.refuse = null;
      const before = fake.S.rpc.filter((c) => c.fn === 'chat_append_system').length;
      await wait(120);
      assert(transport._refusalStateForTest().parked.length === 0
        && fake.S.rpc.filter((c) => c.fn === 'chat_append_system').length === before,
        'A7/R2: a HOLD GATE drops the parked set too — a hold exists so that no league data moves while it is up, and a background ladder quietly re-sending a reveal from behind the lock is the shape DI §6.5 was written to stop, one queue over');
    } finally { console.warn = realWarn2; }
    resetToFlagOff();
  }
}

_realLog(`\n${pass} passed, ${fail} failed.`);
if (fail) _realLog(`Failed: ${failures.join(' | ')}`);
await new Promise((r) => (process.stdout.write('') ? r() : process.stdout.once('drain', r)));
process.exit(fail > 0 ? 1 : 0);
