/**
 * CFB Pickems — testchatfake.mjs
 * ==============================================================================
 * ONE fake Supabase chat context, shared by the suites that need a SERVEABLE
 * chat transport but are not themselves about the transport.
 *
 * WHY THIS FILE EXISTS, AND WHY IT IS SHARED WHEN NOTHING ELSE HERE IS.
 * Every standalone suite in this folder is deliberately self-contained — each
 * one is its own process with its own clean state, and `memorytest.mjs` /
 * `scribetest.mjs` / `trainertest.mjs` each load `backend/Code.gs` into their
 * own `vm` rather than sharing a harness. That is the right default, and it is
 * not what this is.
 *
 * Until 2026-09-23 these suites did not need a chat FAKE at all: they stubbed
 * `globalThis.fetch` with six lines of Apps Script URL parsing, because
 * `js/chatTransport.js` had its own `get()`/`post()` and a URL was the whole
 * interface. Those are deleted. A serveable Supabase context is
 * `installSupabaseChat({ getClient, getLeagueId, rowToMessage, isReady,
 * getIdentityEpoch })` plus a PostgREST-shaped client with a chainable builder
 * — forty lines, not six — and eight hand-maintained copies of forty lines is
 * exactly the drift this project keeps writing regression rows about.
 *
 * THIS IS NOT `transporttest.mjs`'s FAKE, and the two are not merged. That one
 * is a MODEL: it enforces the server's own rules (id dedupe, `_n` packing, the
 * rate window, the refusal vocabulary, Realtime channels) because the transport
 * is what it is testing. This one answers what it is told to answer and records
 * what it was asked, because its callers are testing something else and need
 * the chat backend to be a fixture rather than a subject.
 *
 * THE LIMIT, SAID OUT LOUD: a green run against this file is not evidence about
 * `js/chatTransport.js`'s Supabase behaviour and must never be cited as such.
 * `transporttest.mjs` is that proof offline, and `supabase/tests/rls.test.mjs`
 * on the real project is the proof that matters.
 */

/** One legacy wire event -> one `public.messages` row, in the column set
 *  `SB_MESSAGE_COLS` selects. Callers keep their own event fixtures. */
export function eventToRow(ev, leagueId = 'lg_test') {
  return {
    league_id: leagueId,
    id: ev.id,
    seq: ev.seq,
    ts: typeof ev.ts === 'number' ? new Date(ev.ts).toISOString() : (ev.ts || null),
    type: ev.type || 'message',
    author: ev.author || 'p1',
    game_tag: ev.gameTag || '',
    body: ev.body || '',
    target_id: ev.targetId || '',
    reply_to: ev.replyTo || '',
    notify: !!ev.notify,
    meta: ev.meta || null,
  };
}

/**
 * Install a serveable chat context around caller-supplied server behaviour.
 *
 * @param {object} transport  the imported js/chatTransport.js module
 * @param {object} projection the imported js/supabase-projection.js module
 * @param {object} opts
 *   head()                  -> number | Promise<number>; may THROW to model a refused probe
 *   since(afterSeq, limit)  -> { events: [...] }        (legacy event shape)
 *   before(beforeSeq, limit)-> [ ...events ]
 *   append(events)          -> { assigned: [{ id, seq, ts }] }; may THROW
 *   sinceThrows(afterSeq, limit) -> boolean; true models a refused page
 *
 * @returns {{ calls: Array, uninstall: Function }} `calls` records every request
 *   as `{ action: 'chatHead'|'chatSince'|'chatBefore'|'chatAppend', seq, limit }`
 *   — the same shape the Apps Script stubs recorded, so ported assertions read
 *   unchanged.
 */
export function installFakeChat(transport, projection, {
  leagueId = 'lg_test',
  head = () => 0,
  since = () => ({ events: [] }),
  before = () => [],
  append = null,
  sinceThrows = () => false,
  isReady = () => true,
  invokeFn = () => ({ data: null, error: { message: 'no function' } }),
  // Step 6 Phase 3 — `askScribe()`'s own client-half switch read
  // (`settings.serverJobs.scribeAsk`), injected exactly as js/app.js wires it
  // at boot. Default OFF, which is the deliberate CONVENTIONS #10 inversion
  // DI-T6.0(a) states: an absent/stale settings blob degrades to the canned
  // pool rather than switching a paid model call on by omission.
  getSettings = () => ({}),
} = {}) {
  const calls = [];
  const client = {
    from() {
      const q = { gt: null, lt: null, limit: 0 };
      const b = {
        select() { return b; },
        eq() { return b; },
        gt(_c, v) { q.gt = Number(v); return b; },
        lt(_c, v) { q.lt = Number(v); return b; },
        order() { return b; },
        limit(n) { q.limit = Number(n); return b; },
        then(res, rej) { return b._run().then(res, rej); },
        async _run() {
          if (q.lt !== null) {
            calls.push({ action: 'chatBefore', seq: q.lt, limit: q.limit });
            return { data: (before(q.lt, q.limit) || []).map((e) => eventToRow(e, leagueId)), error: null };
          }
          calls.push({ action: 'chatSince', seq: q.gt, limit: q.limit });
          // A refused page, shaped the way PostgREST returns one.
          if (sinceThrows(q.gt, q.limit)) return { data: null, error: { code: '500', message: 'server error' } };
          // AWAITED, for the same reason `append()` is: a caller may model a
          // round trip that is still IN FLIGHT by returning a never-settling
          // promise, and that shape has to reach the transport as a pending
          // request rather than as an instant answer of `undefined`.
          const r = (await since(q.gt, q.limit)) || { events: [] };
          return { data: (r.events || []).map((e) => eventToRow(e, leagueId)), error: null };
        },
      };
      return b;
    },
    async rpc(fn, args) {
      if (fn === 'chat_head') {
        calls.push({ action: 'chatHead' });
        // `head()` may return a value, a PROMISE (a round trip held open) or
        // THROW (a refused probe). All three are shapes the real client has.
        try { return { data: await head(), error: null }; }
        catch (e) { return { data: null, error: { message: String((e && e.message) || e) } }; }
      }
      if (fn === 'chat_append' || fn === 'chat_append_system') {
        const events = (args && args.p_events) || [];
        calls.push({ action: 'chatAppend', events });
        try {
          // AWAITED. `append()` may return a promise (a delayed commit), and an
          // un-awaited one yields `r.assigned === undefined` — which reads to the
          // transport as a successful append that assigned nothing, so chat.js
          // never reconciles and `whenAppended()` times out into a degrade. That
          // is a test-harness bug that looks exactly like the BUG-D defect the
          // suites using this file are written to catch.
          const r = await (append ? append(events) : { assigned: [] });
          return {
            data: (r.assigned || []).map((a) => ({
              id: a.id, seq: a.seq, deduped: false,
              ts: new Date(a.ts || Date.now()).toISOString(),
            })),
            error: null,
          };
        } catch (e) { return { data: null, error: { message: String((e && e.message) || e) } }; }
      }
      return { data: null, error: { message: 'unknown rpc ' + fn } };
    },
    channel() { const ch = { on() { return ch; }, subscribe() { return ch; } }; return ch; },
    removeChannel() { return true; },
    // `askScribe()` reaches the `scribe-ask` Edge Function through the SAME
    // client (chatTransport.js), so the recorder lives here rather than in a
    // second stub beside it. `invokeFn` defaults to a refusal, which degrades
    // to the canned pool — the contract askScribe()'s own header states.
    functions: {
      async invoke(name, opts) {
        calls.push({ action: 'functions.invoke', name, body: (opts && opts.body) || null });
        return invokeFn(name, (opts && opts.body) || null);
      },
    },
  };

  transport.installSupabaseChat({
    getClient: () => client,
    getLeagueId: () => leagueId,
    rowToMessage: projection.rowToMessage,
    isReady,
    getIdentityEpoch: () => 1,
    getSettings,
  });
  transport.setSupabaseDataModePredicate(() => true);
  transport._resetRefusalStateForTest();

  return {
    calls,
    client,
    uninstall() {
      transport._resetSupabaseChatForTest();
      transport._resetSupabaseDataModePredicateForTest();
      transport._resetRefusalStateForTest();
    },
  };
}
