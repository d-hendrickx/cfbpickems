/**
 * CFB Pickems — scribememtest.mjs (UN-237 / UN-238, DI-258/259/260, 2026-09-23)
 * ==============================================================================
 * The CLIENT half of SCRIBE memory on Supabase. `memorytest.mjs` is the SERVER
 * half of the OLD one (backend/Code.gs in a vm) and is untouched by this file:
 * it proves what the Sheet did, which is now the archive. This file proves what
 * replaced it.
 *
 * WHAT DREW REPORTED, and what is under test here:
 *
 *   "approved, but applying it to SCRIBE's memory failed: Refusing to send
 *    'scribeMemorySync' to the Google Sheet…"
 *
 * That is `SheetsRelayRefusedError`. Four client actions — list / upsert /
 * delete / sync — were the last things in the app still routed at Apps Script,
 * and the post-cutover allow-list refused every one. They now go to migration
 * 0022's two RPCs and two plain PostgREST calls, through
 * `js/supabase-backend.js` §12b.
 *
 * ── THE FAKE CLIENT IS A MODEL, AND IT CAN REFUSE ───────────────────────────
 * adaptertest.mjs's standard, restated because it is the only thing that makes
 * a green here worth reading: a mock that always succeeds tests nothing. The
 * client below is PostgREST-shaped and models the parts of 0022 the client can
 * actually observe — a policy-filtered SELECT returns FEWER ROWS (not an
 * error), a policy-filtered DELETE returns an EMPTY SET and no error, an RPC's
 * named exception comes back as `{ error: { message: 'not_commissioner' } }`,
 * and a privilege refusal comes back as `{ error: { code: '42501' } }`.
 *
 * IT IS NOT TRUTH ABOUT THE SQL. `supabase/tests/rls.test.mjs`'s `scribeMemory`
 * group (S22.*) on the real project is the proof of the policies; this file
 * proves the CLIENT'S RESPONSE to them. Where they could drift, the live suite
 * is authoritative — the five cutover defects of 2026-09-19 were all invisible
 * offline, and nothing here changes that.
 *
 * Run:  node scribememtest.mjs
 *       for tz in UTC America/Los_Angeles; do TZ=$tz node scribememtest.mjs; done
 *
 * Sections:
 *   [1] js/supabase-backend.js §12b — the four calls, their wire shape, and
 *       their loud-fail behaviour, driven directly.
 *   [2] THE WHOLE CHAIN — js/app.js's REAL handlers through the REAL adapter
 *       to the fake client. No transport stub anywhere: this is the assertion
 *       that would have caught the reported bug.
 *   [3] The apply sweep: counts, the toast contract, quiet mode, loud failure.
 *   [4] Structural — the four Apps Script relays are GONE, not merely unchosen.
 */

import { readFile } from 'node:fs/promises';

// ── DOM / browser stubs — IDENTICAL shape to loadtest.mjs's / groupdtest.mjs's ──
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ set innerHTML(v) {}, get innerHTML() { return ''; }, appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [], classList: { add() {}, remove() {} }, style: {}, id: '', className: '' }),
  body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '' },
  hidden: false,
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined, clipboard: { writeText: async () => {} } }, configurable: true }); }
globalThis.requestAnimationFrame = fn => fn();
globalThis.fetch = async () => { throw new Error('network disabled in scribememtest'); };
globalThis.matchMedia = () => ({ matches: false });
let confirmAnswer = true;
globalThis.confirm = () => confirmAnswer;
globalThis.prompt = () => null;
globalThis.alert = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

const LEAGUE = 'lg_0000-1111';

// ══════════════════════════════════════════════════════════════════════════
// THE FAKE POSTGREST CLIENT
// ══════════════════════════════════════════════════════════════════════════
/**
 * `session` is `{ memberId, role }`. Everything the model refuses, it refuses
 * the way the server would — see the file header.
 *
 * `calls` records every request so the tests can assert on the WIRE, not only
 * on the return value: "the delete asked for the right table with the right
 * filters" is a different claim from "the delete resolved", and the second is
 * satisfied by a stub that does nothing.
 */
function makeClient(session, rows) {
  const calls = [];
  const isComm = () => session.role === 'commissioner';
  const me = () => session.memberId || null;

  // 0022 §4a, modelled: self OR wager OR commissioner OR platform admin.
  const canRead = (r) => (me() != null && (r.subject_member_id === me() || r.kind === 'wager')) || isComm();
  // 0022 §4b, modelled: commissioner OR the row's own subject.
  const canDelete = (r) => isComm() || (me() != null && r.subject_member_id === me());

  function rpcScribeMemoryUpsert({ p_league, p_record }) {
    if (p_league !== LEAGUE) return { data: null, error: { message: 'not_member' } };
    if (!me()) return { data: null, error: { message: 'not_member' } };
    const rec = p_record || {};
    const subject = rec.subject_member_id || rec.playerId || null;
    const kind = rec.kind || '';
    const key = String(rec.key || '').replace(/[^\x20-\x7E]/g, '').slice(0, 40);
    let value = String(rec.value == null ? '' : rec.value).slice(0, 200);
    let provenance = rec.provenance || '';
    let confidence = typeof rec.confidence === 'number' ? Math.min(1, Math.max(0, rec.confidence)) : null;
    if (!subject) return { data: null, error: { message: 'bad_subject' } };
    if (!['fact', 'relation', 'hardline', 'roastTolerance', 'wager'].includes(kind)) return { data: null, error: { message: `bad_kind:${kind}` } };
    if (!key) return { data: null, error: { message: 'bad_key' } };
    if (!isComm()) {
      if (!['hardline', 'roastTolerance', 'wager'].includes(kind)) return { data: null, error: { message: `bad_kind_for_player:${kind}` } };
      if (subject !== me() && kind !== 'wager') return { data: null, error: { message: 'not_owner' } };
      provenance = 'player-stated';      // FORCED, never validated
      confidence = 1;
    }
    if (!['computed', 'player-stated', 'commissioner-set', 'trainer-proposed'].includes(provenance)) {
      return { data: null, error: { message: `bad_provenance:${provenance}` } };
    }
    const at = rows.find(r => r.league_id === p_league && (r.subject_member_id || '') === (subject || '') && r.kind === kind && r.key === key);
    const now = new Date().toISOString();
    let row;
    if (at) {
      Object.assign(at, { value, provenance, confidence, refreshed_at: now });
      row = at;
    } else {
      row = { league_id: p_league, id: 'mem_' + Math.random().toString(36).slice(2, 18),
              subject_member_id: subject, kind, key, value, provenance, confidence,
              created_at: now, review_at: rec.reviewAt || null,
              source_message_id: rec.sourceMessageId || null, refreshed_at: now };
      rows.push(row);
    }
    return { data: { ok: true, row: { ...row } }, error: null };
  }

  function rpcScribeMemoryApply({ p_league }, learnings) {
    if (!me()) return { data: null, error: { message: 'not_member' } };
    if (!isComm()) return { data: null, error: { message: 'not_commissioner' } };
    let applied = 0, skipped = 0;
    for (const l of learnings) {
      if (l.kind !== 'fact_candidate' || l.status !== 'approved') continue;
      if (l.payload.memoryAppliedAt) continue;
      if (!l.payload.playerId || !l.payload.key) { skipped++; continue; }
      const sub = l.payload.playerId;
      const key = l.payload.key;
      const at = rows.find(r => r.league_id === p_league && r.subject_member_id === sub && r.kind === 'fact' && r.key === key);
      const now = new Date().toISOString();
      if (at) Object.assign(at, { value: l.payload.value, provenance: 'trainer-proposed', refreshed_at: now });
      else rows.push({ league_id: p_league, id: 'mem_' + Math.random().toString(36).slice(2, 18),
                       subject_member_id: sub, kind: 'fact', key, value: l.payload.value,
                       provenance: 'trainer-proposed', confidence: l.payload.confidence ?? null,
                       created_at: now, review_at: null, source_message_id: l.payload.sourceMessageId || null, refreshed_at: now });
      l.payload.memoryAppliedAt = now;
      applied++;
    }
    return { data: { ok: true, applied, skipped }, error: null };
  }

  const learnings = [];
  const client = {
    _calls: calls,
    _rows: rows,
    _learnings: learnings,
    async rpc(name, args) {
      calls.push({ kind: 'rpc', name, args });
      if (client._rpcError) return { data: null, error: client._rpcError };
      if (name === 'scribe_memory_upsert') return rpcScribeMemoryUpsert(args || {});
      if (name === 'scribe_memory_apply') return rpcScribeMemoryApply(args || {}, learnings);
      return { data: null, error: { code: '42883', message: `function public.${name} does not exist` } };
    },
    from(table) {
      const req = { kind: 'from', table, filters: [], op: '', cols: '' };
      calls.push(req);
      const builder = {
        select(cols) { req.cols = cols || '*'; if (!req.op) req.op = 'select'; return builder; },
        eq(col, val) { req.filters.push([col, val]); return builder; },
        in(col, vals) { req.filters.push([col, vals]); req.inCol = col; req.inVals = vals; return builder; },
        delete() { req.op = 'delete'; return builder; },
        then(resolve, reject) { return builder._run().then(resolve, reject); },
        async _run() {
          if (client._selectError && req.op === 'select') return { data: null, error: client._selectError };
          if (client._deleteError && req.op === 'delete') return { data: null, error: client._deleteError };
          const match = (r) => req.filters.every(([c, v]) => (Array.isArray(v) ? v.includes(r[c]) : r[c] === v));
          if (req.op === 'delete') {
            const hits = rows.filter(r => match(r) && canDelete(r));
            for (const h of hits) rows.splice(rows.indexOf(h), 1);
            return { data: hits.map(h => ({ id: h.id })), error: null };
          }
          return { data: rows.filter(r => match(r) && canRead(r)).map(r => ({ ...r })), error: null };
        },
      };
      return builder;
    },
  };
  return client;
}

const sb = await import('./js/supabase-backend.js');
const storage = await import('./js/storage.js');
const app = await import('./js/app.js');
const proj = await import('./js/supabase-projection.js');

let CLIENT = null;
let LEAGUE_ID = LEAGUE;
function wire({ who = 'commissioner', memberId = 'p1', rows = [], leagueId = LEAGUE } = {}) {
  sb._resetForTest();
  CLIENT = makeClient({ role: who, memberId }, rows);
  LEAGUE_ID = leagueId;
  sb.init({
    getClient: () => CLIENT,
    getActiveLeagueId: () => LEAGUE_ID,
    getIdentityEpoch: () => 1,
    getAccountUserId: () => 'u_' + memberId,
    getDeviceDataOwnerTuple: () => 'u_' + memberId + ' ' + leagueId,
    getDeviceDataOwner: () => '',
    register: () => {},
  });
  return CLIENT;
}

const row = (o = {}) => ({
  league_id: LEAGUE, id: 'mem_' + (o.key || 'x'), subject_member_id: 'p1', kind: 'hardline',
  key: 'topic:x', value: 'v', provenance: 'player-stated', confidence: 1,
  created_at: '2026-09-01T00:00:00.000Z', review_at: null, source_message_id: null,
  refreshed_at: '2026-09-01T00:00:00.000Z', ...o,
});

// ═════════════════════════════════════════════════════════════════════════
// 1. js/supabase-backend.js §12b — the four calls, driven directly
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[1] The adapter calls — wire shape, projection, loud-fail…');
{
  const rows = [
    row({ id: 'm_own', key: 'topic:own', subject_member_id: 'p1' }),
    row({ id: 'm_other', key: 'topic:other', subject_member_id: 'p2' }),
    row({ id: 'm_wager', key: 'wager:w1', kind: 'wager', subject_member_id: 'p2', value: '{"c":"x","o":"","w":"","b":"p1"}' }),
  ];
  const c = wire({ who: 'player', memberId: 'p1', rows });

  const listed = await sb.scribeMemoryList({ playerId: 'p1' });
  assert(listed.ok === true && Array.isArray(listed.records),
    '1-1: scribeMemoryList() answers the relay\'s own `{ ok, records }` shape, so js/app.js\'s call sites did not have to change');
  assert(listed.records.length === 2 && listed.records.some(r => r.id === 'm_own') && listed.records.some(r => r.id === 'm_wager'),
    '1-2: the SELECT is scoped by the SERVER (0022 §4a: self + wager + commissioner), not by a client filter — p2\'s hardline never arrives, and the wager does');

  const sel = c._calls.filter(x => x.kind === 'from' && x.table === 'scribe_memory');
  assert(sel.length === 1 && sel[0].filters.some(([col, v]) => col === 'league_id' && v === LEAGUE),
    '1-3: it reads `scribe_memory` scoped to the active league id — one table, one filter, no RPC');
  assert(!sel[0].filters.some(([col]) => col === 'subject_member_id'),
    '1-4: …and it does NOT filter on subject_member_id. Under the retired relay `playerId` WAS the ownership claim; sending it here would read as though it still were. The JWT decides now');
  assert(!/\*/.test(sel[0].cols) && /subject_member_id/.test(sel[0].cols) && /refreshed_at/.test(sel[0].cols),
    '1-5: it names its columns rather than `select(*)` — the lesson 0007 taught on league_members, applied before it costs anything');

  const fromProjection = proj.rowToMemory(rows.find(r => r.id === 'm_own'));
  assert(JSON.stringify(listed.records.find(r => r.id === 'm_own')) === JSON.stringify(fromProjection),
    '1-6: the record is js/supabase-projection.js\'s rowToMemory() OUTPUT, byte for byte — never a second, hand-rolled reading of the same row (this module\'s own header rule)');

  const kinds = wire({ who: 'player', memberId: 'p1', rows: [row({ id: 'm_w', key: 'wager:w', kind: 'wager', subject_member_id: 'p1' })] });
  await sb.scribeMemoryList({ playerId: 'p1', kinds: ['wager'] });
  const kindReq = kinds._calls.find(x => x.kind === 'from');
  assert(kindReq.inCol === 'kind' && JSON.stringify(kindReq.inVals) === '["wager"]',
    '1-7: the `kinds` carve-out becomes an `.in(\'kind\', […])`, which is what FEAT-5\'s league-wide wager read needs');
}
{
  const rows = [];
  const c = wire({ who: 'player', memberId: 'p1', rows });
  const r = await sb.scribeMemoryUpsert({ playerId: 'p1', kind: 'hardline', key: 'topic:t', value: 'no draft talk', provenance: 'computed', confidence: 0.4 });
  const rpc = c._calls.find(x => x.kind === 'rpc');
  assert(rpc && rpc.name === 'scribe_memory_upsert' && rpc.args.p_league === LEAGUE,
    '1-8: scribeMemoryUpsert() calls the RPC `scribe_memory_upsert(p_league, p_record)` with the ACTIVE league, never a league id from the record');
  assert(r.ok === true && r.record && r.record.playerId === 'p1' && r.record.key === 'topic:t',
    '1-9: …and returns `{ ok, record }` in the legacy shape the call sites already merge into their cache');
  assert(r.record.provenance === 'player-stated' && Number(r.record.confidence) === 1,
    '1-10: the record that comes BACK carries the server\'s FORCED provenance/confidence, not the ones the client sent (computed/0.4). The client cannot decide how its own claims are presented');
}
{
  const rows = [row({ id: 'm_own', key: 'topic:own', subject_member_id: 'p1' }),
                row({ id: 'm_other', key: 'topic:other', subject_member_id: 'p2' })];
  const c = wire({ who: 'player', memberId: 'p1', rows });
  const del = await sb.scribeMemoryDelete({ id: 'm_own', playerId: 'p1' });
  assert(del.ok === true && del.deleted === true && !rows.some(r => r.id === 'm_own'),
    '1-11: scribeMemoryDelete() physically removes the row (DI-D2 — this feature lives outside the storage seam precisely so a row CAN be deleted)');
  const req = c._calls.filter(x => x.kind === 'from').pop();
  assert(req.op === 'delete' && /id/.test(req.cols || ''),
    '1-12: the delete asks for `.select(\'id\')` back. PostgREST answers a POLICY-FILTERED delete with an empty set and NO error, so without this a refusal resolves happily and js/app.js drops the row from its cache until the next refresh brings it back — the silent-failure shape AD-06 exists to prevent, one line away by default');

  let threw = null;
  try { await sb.scribeMemoryDelete({ id: 'm_other', playerId: 'p1' }); } catch (e) { threw = e; }
  assert(!!threw && /refused to delete/i.test(threw.message) && rows.some(r => r.id === 'm_other'),
    '1-13: deleting ANOTHER player\'s row THROWS and leaves the row in place — the empty-set refusal is read as a refusal, not as success');
}
{
  const c = wire({ who: 'commissioner', memberId: 'p1', rows: [] });
  c._learnings.push(
    { kind: 'fact_candidate', status: 'approved', payload: { playerId: 'p2', key: 'k1', value: 'v1', confidence: 0.9 } },
    { kind: 'fact_candidate', status: 'approved', payload: { playerId: 'p3', key: 'k2', value: 'v2', confidence: 0.8 } },
    { kind: 'fact_candidate', status: 'pending', payload: { playerId: 'p2', key: 'k3', value: 'v3' } },
    { kind: 'learning', status: 'approved', payload: { key: 'k4' } },
  );
  const first = await sb.scribeMemoryApply({ adminPasswordHash: 'ignored' });
  assert(first.ok === true && first.applied === 2 && first.skipped === 0,
    '1-14: scribeMemoryApply() promotes ONLY the approved fact candidates — the pending one and the learning are left alone');
  const rpc = c._calls.filter(x => x.kind === 'rpc').pop();
  assert(rpc.name === 'scribe_memory_apply' && Object.keys(rpc.args).length === 1 && rpc.args.p_league === LEAGUE,
    '1-15: it sends the LEAGUE AND NOTHING ELSE. No adminPasswordHash: the relay needed one because a PIN-gated app had no identity and the token shipped on every device (AD-05); the RPC derives the commissioner from the JWT and raises not_commissioner itself');
  const second = await sb.scribeMemoryApply({});
  assert(second.applied === 0 && c._rows.filter(r => r.kind === 'fact').length === 2,
    '1-16: a SECOND call reports applied 0 and adds no row. This is the toast\'s promise ("Nothing new to apply") turned into an assertion');
}
{
  // LOUD-FAIL, all four, every failure mode the server has.
  const c = wire({ who: 'player', memberId: 'p1', rows: [] });
  c._selectError = { code: '42501', message: 'permission denied for table scribe_memory' };
  let e1 = null; try { await sb.scribeMemoryList({ playerId: 'p1' }); } catch (e) { e1 = e; }
  assert(!!e1 && /permission denied/.test(e1.message) && e1.code === '42501',
    '1-17: a refused READ throws and carries the server\'s OWN words plus its sqlstate — never `{records: []}`, which would render as "SCRIBE knows nothing about you"');

  const c2 = wire({ who: 'player', memberId: 'p1', rows: [] });
  c2._rpcError = { message: 'not_commissioner' };
  let e2 = null; try { await sb.scribeMemoryApply({}); } catch (e) { e2 = e; }
  assert(!!e2 && /not_commissioner/.test(e2.message),
    '1-18: a named RPC exception reaches the caller by NAME. `not_commissioner` is diagnosable; "something went wrong" is not');

  sb._resetForTest();
  sb.init({ getClient: () => null, getActiveLeagueId: () => LEAGUE, register: () => {} });
  let e3 = null; try { await sb.scribeMemoryList({ playerId: 'p1' }); } catch (e) { e3 = e; }
  assert(!!e3 && /not signed in/i.test(e3.message),
    '1-19: no client at all throws a sentence a player could act on, rather than a TypeError on `null.from`');

  sb._resetForTest();
  sb.init({ getClient: () => ({}), getActiveLeagueId: () => '', register: () => {} });
  let e4 = null; try { await sb.scribeMemoryUpsert({ playerId: 'p1', kind: 'hardline', key: 'k', value: 'v' }); } catch (e) { e4 = e; }
  assert(!!e4 && /no league is active/i.test(e4.message),
    '1-20: …and no active league does too. Both are states a boot really reaches (the membership resolve is not awaited), so both need an answer that is not a crash');
}

// ═════════════════════════════════════════════════════════════════════════
// 2. THE WHOLE CHAIN — app.js's real handlers, the real adapter, no stub
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[2] End to end: js/app.js handlers -> js/supabase-backend.js -> the fake client…');
{
  // NO `_wireScribeMemoryTransportForTest` ANYWHERE IN THIS SECTION. groupdtest
  // drives the handlers through the transport seam, which proves the handlers;
  // this drives them through the REAL DEFAULTS, which is the only thing that
  // proves the WIRING. The reported bug was entirely in the wiring: every
  // handler was correct and every one of them called a relay that refused.
  app._restoreScribeMemoryTransportForTest();
  storage.setBackendMode('local');
  storage.setSession('p1', false, true);

  const rows = [row({ id: 'm_mine', key: 'topic:mine', subject_member_id: 'p1', value: 'no draft talk' }),
                row({ id: 'm_theirs', key: 'topic:theirs', subject_member_id: 'p2', value: 'his knee' })];
  wire({ who: 'player', memberId: 'p1', rows });

  const cache = await app.refreshScribeMemory('p1');
  assert(cache.error === '' && cache.rows.length === 1 && cache.rows[0].id === 'm_mine',
    '2-1: refreshScribeMemory() fills the cache through the REAL default transport. Before DI-260 this threw SheetsRelayRefusedError and set SCRIBE_FILE_LOAD_ERROR — the reported bug, one surface over');

  const html = app.renderScribeFileBodyHTML({
    profile: app.getPlayerProfile('p1'), loading: false, error: '',
  });
  assert(/no draft talk/.test(html) && !/his knee/.test(html),
    '2-2: …and the My SCRIBE File body RENDERS what came back, with no other player\'s row anywhere in it (DI-D4 / E1)');

  const added = await app.scribeFileAddTopic('never mention the 2019 draft');
  assert(added.ok === true && rows.some(r => r.kind === 'hardline' && r.value === 'never mention the 2019 draft'),
    '2-3: scribeFileAddTopic() reaches the server and the row really lands — UN-238, the half that would have stayed broken if only the commissioner path had been fixed');
  const landed = rows.find(r => r.value === 'never mention the 2019 draft');
  assert(landed.provenance === 'player-stated' && Number(landed.confidence) === 1 && landed.subject_member_id === 'p1',
    '2-4: …attributed to the signed-in player, player-stated, confidence 1 — forced server-side, not merely requested by the call site');

  const tol = await app.scribeFileSetTolerance('no_limits');
  assert(tol.ok === true && rows.some(r => r.kind === 'roastTolerance' && r.value === 'no_limits'),
    '2-5: scribeFileSetTolerance() round-trips as a memory row of its own kind');
  await app.scribeFileSetTolerance('light');
  assert(rows.filter(r => r.kind === 'roastTolerance').length === 1 && rows.find(r => r.kind === 'roastTolerance').value === 'light',
    '2-6: …and setting it AGAIN updates in place rather than adding a second row — the upsert key (league, subject, kind, key) doing its job through the whole chain');

  confirmAnswer = true;
  await app.refreshScribeMemory('p1');
  const del = await app.scribeFileDeleteRow('m_mine');
  assert(del.ok === true && !rows.some(r => r.id === 'm_mine'),
    '2-7: scribeFileDeleteRow() physically deletes. 0002\'s policy was commissioner-only and would have refused this with 42501 on every tap — 0022 §4b is what makes the trash can real');

  confirmAnswer = false;
  const cancelled = await app.scribeFileDeleteRow(rows[0].id);
  assert(cancelled.ok === false && cancelled.skipped !== undefined,
    '2-8: a cancelled confirm writes nothing and calls nothing (D-5, unchanged by the transport move)');
  confirmAnswer = true;
}

// ═════════════════════════════════════════════════════════════════════════
// 3. The apply sweep and its toasts
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[3] syncApprovedScribeFacts() — counts, copy, quiet mode, loud failure…');
{
  app._restoreScribeMemoryTransportForTest();
  const toasts = [];
  const realToast = app._setToastSinkForTest ? null : null;
  // No toast sink export exists; assert on the RETURN VALUE and on the server
  // state instead, which is the durable half. The copy itself is pinned by
  // groupdtest [12] against the same function.
  const c = wire({ who: 'commissioner', memberId: 'p1', rows: [] });
  c._learnings.push(
    { kind: 'fact_candidate', status: 'approved', payload: { playerId: 'p2', key: 'k1', value: 'v1', confidence: 0.9 } },
  );
  const r1 = await app.syncApprovedScribeFacts();
  assert(r1 && r1.ok === true && r1.applied === 1,
    '3-1: the commissioner sweep applies the approved candidate and reports the real count — this is the exact action whose failure Drew pasted');
  const r2 = await app.syncApprovedScribeFacts();
  assert(r2 && r2.applied === 0,
    '3-2: a second sweep reports 0. Idempotent twice over — the upsert collapses and the source is stamped');
  const r3 = await app.syncApprovedScribeFacts({ quiet: true });
  assert(r3 && r3.ok === true && r3.applied === 0,
    '3-3: quiet mode still RUNS and still reports; it suppresses only the zero-case toast, so the post-Trainer auto-apply cannot follow "Training run complete" with what reads as a failure');

  const c2 = wire({ who: 'player', memberId: 'p2', rows: [] });
  c2._rpcError = { message: 'not_commissioner' };
  const bad = await app.syncApprovedScribeFacts();
  assert(bad && bad.ok === false && /not_commissioner/.test(String(bad.error)),
    '3-4: a refused sweep returns ok:false carrying the server\'s own word. The approval itself already persisted through the seam, so the honest message is "the approval saved, the sync did not" — never a silent success (AD-06)');
  const quietBad = await app.syncApprovedScribeFacts({ quiet: true });
  assert(quietBad && quietBad.ok === false,
    '3-5: `quiet` NEVER suppresses a failure. It has one job — the zero-applied line — and the catch branch has no branch on it at all');
  void toasts; void realToast;
}

// ═════════════════════════════════════════════════════════════════════════
// 4. Structural — the relays are GONE, not merely unchosen
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[4] Structural — the four Apps Script memory relays no longer exist…');
{
  const backendSrc = await readFile(new URL('./js/backend.js', import.meta.url), 'utf8');
  // COMMENTS ARE STRIPPED, CODE IS NOT. The deletion leaves a headstone behind
  // on purpose — RG-120 item (xii)'s coupling has to be carried forward
  // somewhere or the next person re-derives the wager carve-out from scratch.
  // So the rule is about EXECUTABLE text: the names may be discussed, they may
  // not exist.
  const backendCode = backendSrc.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert(!/scribeMemory/.test(backendCode) && !/export\s+(async\s+)?function\s+scribeMemory/.test(backendSrc),
    '4-1: js/backend.js has no `scribeMemory` anything in executable code, and exports none of the four. Deleted, not stubbed — an export that exists and can only throw is worse than no export: it is importable, it looks like a fallback, and the next person wiring a memory surface will find it');

  const appSrc = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
  const code = appSrc.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert(!/scribeMemory\w*Remote/.test(code),
    '4-2: js/app.js imports none of the four `scribeMemory*Remote` names in executable code');

  const defaults = app._scribeMemoryTransportDefaultsForTest();
  assert(defaults.list === sb.scribeMemoryList && defaults.upsert === sb.scribeMemoryUpsert
      && defaults.remove === sb.scribeMemoryDelete && defaults.sync === sb.scribeMemoryApply,
    '4-3: the production defaults ARE the adapter\'s four exports, by IDENTITY. A default that silently reverted to a look-alike would pass every behavioural assertion above');

  const sbSrc = await readFile(new URL('./js/supabase-backend.js', import.meta.url), 'utf8');
  const sbCode = sbSrc.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert(!/script\.google\.com/.test(sbCode) && !/backendToken/.test(sbCode),
    '4-4: the adapter reaches no Apps Script URL and reads no backend token — there is no second transport hiding behind the new one');
  assert(/scribe_memory/.test(sbCode) && !/KEY_TABLES\[['"]scribe_memory/.test(sbCode),
    '4-5: `scribe_memory` is reached directly and is NOT a mirror key. Its rows must be physically deletable, which a whole-key seam write plus RG-49\'s union can never be');
}

console.log(`\n${'═'.repeat(50)}`);
console.log(fail === 0 ? `✅ ALL PASS — ${pass} passed, ${fail} failed` : `❌ FAILURES — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
