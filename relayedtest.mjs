/**
 * CFB Pickems — relayedtest.mjs (D1, W-54 / DI-680, migration 0045, 2026-10-08)
 * ==============================================================================
 * The CLIENT half of 0045's `messages.relayed` column, end to end through the real modules: the column list the transport selects,
 * js/supabase-projection.js rowToMessage() (the row -> wire event map) and rowToMessageEvent() (the importer's hash shape), and
 * js/chat.js's fold (newItem / ingest / getMessage / getMessages — what Home and the source chips read).
 *
 * THE RULE BEING PROVED. The server's `relayed` is the ONLY evidence a client has that a SCRIBE row was minted by the server rather than relayed by a
 * member (`meta` is member-writable; `emitted_by` is never granted). So it must arrive TOP-LEVEL, ONLY as a real boolean, NEVER from `meta`, NEVER
 * defaulted when absent (absent must fail closed at every reader's `relayed === false`), and a LOCAL send must never be able to present one.
 *
 *   [1] the projection    [2] the fold    [3] the column list (text)    [5] security F-1, the integration negative into Home's candidate source
 *   [6] security F-1, the chip half: the same forged row into js/source-chips.js validChipSources() (zero chips; the server's row draws one)
 *   [4] the mutation kit: scratch copies of the modules loaded as data: URLs (never the files), each mutant must turn a NAMED check RED.
 *
 * WHAT IT IS NOT: proof that the server sets the column right (supabase/tests/pglite0045.check.mjs executes the migration; rls.test.mjs group
 * chatReserved is Drew's on DEV), nor every way a gate reads it (hometest C15, the source-chips suite); [5] and [6] are the integration negatives.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear() };
globalThis.window = globalThis;
globalThis.document = {
  addEventListener() {}, removeEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({ style: {}, dataset: {}, classList: { add() {}, remove() {} }, setAttribute() {}, appendChild() {} }), body: { appendChild() {} }, hidden: false,
};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'u' + Math.random().toString(36).slice(2) };

let pass = 0, fail = 0;
function assert(cond, label) { if (cond) { pass++; console.log('  ✅', label); } else { fail++; console.error('  ❌', label); } }

const URL_OF = (rel) => new URL(rel, import.meta.url).href;
const projection = await import('./js/supabase-projection.js');
const chat = await import('./js/chat.js');
const homeMod = await import('./js/home.js');
const chipsMod = await import('./js/source-chips.js');

const ROW = (over = {}) => ({
  league_id: 'L1', id: 'scribe_gamepost_1', seq: 1, ts: '2026-10-08T18:00:00.000Z', type: 'message', author: 'scribe', game_tag: 'g1', body: 'Upset watch',
  target_id: '', reply_to: '', notify: true, meta: { source: 'tier0', trigger: 'upsetWatch' }, ...over,
});
const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);

// ── the checks, as functions of the two modules so the kit can re-run them against a mutant ──
function projectionChecks(P) {
  const out = {};
  const m = (over) => P.rowToMessage(ROW(over));
  out['P1 a server row (relayed false) maps to a TOP-LEVEL relayed === false'] = m({ relayed: false }).relayed === false;
  out['P2 a member-relayed row (relayed true) maps to relayed === true'] = m({ relayed: true }).relayed === true;
  out['P3 an absent column (a database before 0045) leaves the key ABSENT: never defaulted, so every reader fails closed'] = !has(m({}), 'relayed');
  out['P4 null, "false", 0, 1, "" and {} are not booleans: the key stays ABSENT for each'] = [null, 'false', 0, 1, '', {}].every((v) => !has(m({ relayed: v }), 'relayed'));
  out['P5 a forged meta.relayed is never read: absent column + meta.relayed false leaves the key absent, and meta is passed through untouched'] =
    (() => { const e = m({ meta: { relayed: false, source: 'tier0' } }); return !has(e, 'relayed') && e.meta.relayed === false; })();
  out['P6 the column wins over meta: relayed true + meta.relayed false maps to true'] = m({ relayed: true, meta: { relayed: false } }).relayed === true;
  const exportEvents = [
    { seq: 1, id: 'm1', ts: 1757000000000, type: 'message', author: 'p1', gameTag: '', body: 'hi', targetId: '', replyTo: '', notify: false, meta: null },
    { seq: 2, id: 'sys_lc_PICKS_LOCKED_w1', ts: 1757000005000, type: 'message', author: 'scribe', gameTag: '', body: 'locked', targetId: '', replyTo: '', notify: true, meta: { kind: 'lifecycle' } },
  ];
  const rows = exportEvents.map((e, i) => ({ ...P.messageToRow(e, { leagueId: 'L1', memberIds: new Set(['p1']) }), relayed: i === 1 }));
  out['P7 rowToMessageEvent() strips relayed, so the importer\'s message hash stays EQUAL to the export\'s when the database rows carry the column'] =
    P.canonicalize(exportEvents) === P.canonicalize(rows.map(P.rowToMessageEvent)) && rows.map(P.rowToMessageEvent).every((e) => !has(e, 'relayed'));
  out['P8 …and rowToMessage() itself keeps it (the chat fold needs it)'] = P.rowToMessage(rows[1]).relayed === true && P.rowToMessage(rows[0]).relayed === false;
  return out;
}
function foldChecks(C, P) {
  const out = {};
  C._resetForTest();
  const evs = [
    P.rowToMessage(ROW({ id: 'scribe_srv', seq: 1, relayed: false })),
    P.rowToMessage(ROW({ id: 'scribe_mem', seq: 2, relayed: true })),
    P.rowToMessage(ROW({ id: 'scribe_old', seq: 3 })),                  // a row read before 0045, or from a cache written before it
  ];
  C.ingest(evs, 3, { caughtUp: true });
  out['F1 a server row folds with relayed === false (getMessage)'] = C.getMessage('scribe_srv')?.relayed === false;
  out['F2 a member-relayed row folds with relayed === true'] = C.getMessage('scribe_mem')?.relayed === true;
  out['F3 a row without the column folds WITHOUT the key (absent, never false)'] = !!C.getMessage('scribe_old') && !has(C.getMessage('scribe_old'), 'relayed');
  const viaRead = C.getMessages({ types: ['message'], respectRetention: true });
  out['F4 getMessages() (Home\'s read) carries the same three answers'] = viaRead.find((x) => x.id === 'scribe_srv')?.relayed === false
    && viaRead.find((x) => x.id === 'scribe_mem')?.relayed === true && !has(viaRead.find((x) => x.id === 'scribe_old'), 'relayed');
  // a LOCAL send can never present a server answer, whatever it is handed
  const localId = C.sendEvent({ id: 'scribe_local_1', type: 'message', author: 'scribe', body: 'local', relayed: false, meta: { relayed: false, source: 'tier0' } });
  out['F5 a local send (sendEvent with relayed:false at the top AND in meta) folds WITHOUT a relayed key'] = localId === 'scribe_local_1' && !has(C.getMessage('scribe_local_1'), 'relayed');
  // …and a later echo of the same id does not turn it into "server-minted" (the fold keeps the first sighting; it may only stay absent)
  C.ingest([P.rowToMessage(ROW({ id: 'scribe_local_1', seq: 4, relayed: false }))], 4, { caughtUp: true });
  out['F6 a server echo of a LOCAL row does not make the fold read relayed === false (fails closed)'] = C.getMessage('scribe_local_1')?.relayed !== false;
  // the device-local events cache stores raw wire events: a replay keeps the column
  C._resetForTest();
  C.ingest([P.rowToMessage(ROW({ id: 'scribe_cached', seq: 5, relayed: false }))], 5, { caughtUp: true, fromCache: true });
  out['F7 a cache replay (fromCache) of a wire event keeps relayed === false'] = C.getMessage('scribe_cached')?.relayed === false;
  try { C.clearOutbox(); } catch { /* not every mutant exports it */ }
  C._resetForTest();
  return out;
}
function textChecks() {
  const out = {};
  const ct = readFileSync(new URL('./js/chatTransport.js', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  const cols = (ct.match(/const SB_MESSAGE_COLS = '([^']*)'/) || [, ''])[1].split(',');
  out['T1 chatTransport selects relayed (the FOURTEEN-column list: the twelve wire fields, sport_tag and relayed), and still never emitted_by / author_member_id / author_kind / *'] =
    cols.join(',') === 'league_id,id,seq,ts,type,author,game_tag,sport_tag,body,target_id,reply_to,notify,meta,relayed' && !/emitted_by|author_member_id|author_kind/.test(ct);
  return out;
}

// [5] SECURITY F-1 (the 0045 review) — THE INTEGRATION NEGATIVE. One row that carries every marker a member can forge, carried through every layer a real one
// travels: the database row -> rowToMessage -> chat.js's fold (ingest) -> js/home.js's candidate source (each candidate becomes one Home SCRIBE card). The row is
// relayed by a member (the column says `relayed: true`), and its member-writable meta claims the opposite (`meta.relayed: false`), names a vetted game trigger and
// carries a valid https source. It must give ZERO Home SCRIBE cards; the same row with the SERVER's `relayed: false` gives exactly one (the positive control).
// `chatBoundToLeague` is stubbed true: this suite has no signed-in store, and the binding has its own proof (chatscopetest [24]). The chip half of F-1 is [6]
// (security's condition at the int merge, 2026-10-08): the same row, through the same layers, into js/source-chips.js validChipSources().
const NOW5 = Date.parse('2026-10-08T19:00:00.000Z');
const WEEKS5 = [{ weekId: 'w5', weekNumber: 5, status: 'live' }];
const GAMES5 = [{ gameId: 'g51', weekId: 'w5', homeTeam: 'Texas', awayTeam: 'Oklahoma', kickoff: '2026-10-08T17:00:00.000Z' }];
const ROW5 = (relayed) => ({
  league_id: 'L1', id: 'scribe_coverageFlip_g51_home_1', seq: 1, ts: new Date(NOW5 - 3600e3).toISOString(), type: 'message', author: 'scribe', game_tag: 'g51',
  body: 'Texas just flipped the number.', target_id: '', reply_to: '', notify: true, relayed,
  meta: { relayed: false, trigger: 'coverageFlip', source: 'tier0', sources: [{ label: 'ESPN', url: 'https://www.espn.com/college-football/story/_/id/1', publishedAt: null }] },
});
function homeChecks(P, C, H) {
  const out = {};
  const cardsFor = (relayed) => {
    C._resetForTest();
    C.ingest([P.rowToMessage(ROW5(relayed))], 1, { caughtUp: true });
    const src = H.makeChatCandidateSource({ getMessages: C.getMessages, isPrivateRow: C.isPrivateRow, chatBoundToLeague: () => true });
    const r = src({ leagueId: 'L1', weeks: WEEKS5, games: GAMES5, now: NOW5, timezone: 'PT', supabase: true });
    C._resetForTest();
    return r.scribe.length;
  };
  out['H1 F-1 a MEMBER-relayed row (column relayed:true) forging meta.relayed:false, a vetted game trigger on a real public game and an https source gives ZERO Home SCRIBE cards'] = cardsFor(true) === 0;
  out['H2 F-1 POSITIVE CONTROL: the same row with the SERVER\'s relayed:false gives exactly ONE (so H1\'s zero is the gate, not a broken path)'] = cardsFor(false) === 1;
  out['H3 F-1 …and a row whose column is ABSENT (a database before 0045) gives zero too'] = cardsFor(undefined) === 0;
  return out;
}

// [6] SECURITY F-1, THE CHIP HALF. The same forged row, the same layers (database row -> rowToMessage -> chat.js's fold), into validChipSources(): the source chips under
// a SCRIBE answer are drawn only for a row the SERVER minted (top-level relayed === false). The member's relay forging meta.relayed:false draws ZERO chips; the server's draws one.
function chipChecks(P, C, SC) {
  const out = {};
  const chipsFor = (relayed) => {
    C._resetForTest();
    C.ingest([P.rowToMessage(ROW5(relayed))], 1, { caughtUp: true });
    const m = C.getMessage('scribe_coverageFlip_g51_home_1');
    C._resetForTest();
    return m ? SC.validChipSources(m).length : -1;
  };
  out['S1 F-1 chips: a MEMBER-relayed row (column relayed:true) forging meta.relayed:false with a valid https source draws ZERO source chips'] = chipsFor(true) === 0;
  out['S2 F-1 chips POSITIVE CONTROL: the same row with the SERVER\'s relayed:false draws exactly ONE chip (so S1\'s zero is the gate, not a broken path)'] = chipsFor(false) === 1;
  out['S3 F-1 chips: …and a row whose column is ABSENT (a database before 0045) draws zero'] = chipsFor(undefined) === 0;
  return out;
}

function report(res) { for (const [label, ok] of Object.entries(res)) assert(ok === true, label); }
console.log('\n[1] the projection — rowToMessage / rowToMessageEvent…');
report(projectionChecks(projection));
console.log('\n[2] the fold — js/chat.js newItem / ingest / getMessage / getMessages / sendEvent…');
report(foldChecks(chat, projection));
console.log('\n[3] the column list…');
report(textChecks());
console.log('\n[5] security F-1 — the integration negative: row -> rowToMessage -> chat.ingest -> Home\'s candidate source…');
report(homeChecks(projection, chat, homeMod));
console.log('\n[6] security F-1, the chip half — row -> rowToMessage -> chat.ingest -> validChipSources…');
report(chipChecks(projection, chat, chipsMod));

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[4] MUTATION KIT — scratch copies loaded as data: URLs (never the files); each mutant must turn a NAMED check RED…');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
async function loadMutant(rel, edits) {
  let src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  for (const [a, b] of edits) {
    const n = src.split(a).length - 1;
    if (n !== 1) throw new Error(`mutation anchor must match exactly once in ${rel} (matched ${n}): ${a.slice(0, 80)}`);
    src = src.split(a).join(b);
  }
  src = src.replace(/from '\.\/([\w.-]+)'/g, (_m, f) => `from '${URL_OF('./js/' + f)}'`);
  return import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
}
async function mutant(label, rel, edits, mustFail) {
  let res;
  try {
    const mod = await loadMutant(rel, edits);
    res = rel.endsWith('supabase-projection.js') ? { ...projectionChecks(mod), ...foldChecks(chat, mod), ...homeChecks(mod, chat, homeMod), ...chipChecks(mod, chat, chipsMod) }
      : rel.endsWith('home.js') ? homeChecks(projection, chat, mod)
      : rel.endsWith('source-chips.js') ? chipChecks(projection, chat, mod)
      : { ...foldChecks(mod, projection), ...homeChecks(projection, mod, homeMod), ...chipChecks(projection, mod, chipsMod) };
  } catch (e) { res = { [`the mutant could not run: ${String(e.message).slice(0, 120)}`]: false }; }
  const failed = Object.entries(res).filter(([, ok]) => ok !== true).map(([l]) => l);
  const hit = mustFail.every((code) => failed.some((f) => f.startsWith(code)));
  assert(failed.length > 0 && hit, `${label} → RED on: ${failed.map((f) => f.split(' ')[0]).join(', ') || '(nothing — the mutant SURVIVED)'}${hit ? '' : `  (expected ${mustFail.join(', ')})`}`);
}
{
  const ctl = { ...projectionChecks(projection), ...foldChecks(chat, projection) };
  assert(Object.values(ctl).every((v) => v === true) && Object.keys(ctl).length === 15, `K0 POSITIVE CONTROL — the unmutated modules pass all ${Object.keys(ctl).length} named checks, so a red below is the mutation's doing`);
  const RM = "    ...(typeof row.relayed === 'boolean' ? { relayed: row.relayed } : {}),\n";
  await mutant('K1 rowToMessage drops relayed', './js/supabase-projection.js', [[RM, '']], ['P1', 'P2', 'F1', 'F2']);
  await mutant('K2 rowToMessage falls back to meta.relayed (member-writable)', './js/supabase-projection.js',
    [[RM, "    ...(typeof row.relayed === 'boolean' ? { relayed: row.relayed } : (row.meta && typeof row.meta.relayed === 'boolean' ? { relayed: row.meta.relayed } : {})),\n"]], ['P5']);
  await mutant('K3 rowToMessage defaults an ABSENT column to false (fails open before 0045)', './js/supabase-projection.js', [[RM, '    relayed: row.relayed === true,\n']], ['P3', 'P4', 'F3']);
  await mutant('K4 rowToMessage coerces any value (!!)', './js/supabase-projection.js', [[RM, "    ...('relayed' in row ? { relayed: !!row.relayed } : {}),\n"]], ['P4']);
  await mutant('K5 rowToMessageEvent keeps relayed (every import reports a false hash mismatch)', './js/supabase-projection.js',
    [['  const { leagueId, relayed, ...event } = rowToMessage(row);', '  const { leagueId, ...event } = rowToMessage(row);']], ['P7']);
  const NI = "           ...(typeof ev.relayed === 'boolean' ? { relayed: ev.relayed } : {}),\n";
  await mutant('K6 newItem drops relayed (the gates could never open)', './js/chat.js', [[NI, '']], ['F1', 'F2', 'F4', 'F7']);
  await mutant('K7 newItem copies whatever it is handed (an absent column becomes a present undefined)', './js/chat.js', [[NI, '           relayed: ev.relayed,\n']], ['F3']);
  await mutant('K8 sendEvent forwards a caller\'s relayed (a local send could present itself as server-minted)', './js/chat.js',
    [['    notify: !!ev.notify, meta: ev.meta || null,\n', '    notify: !!ev.notify, meta: ev.meta || null, relayed: ev.relayed,\n']], ['F5']);
  {
    const hctl = homeChecks(projection, chat, homeMod);
    assert(Object.values(hctl).every((v) => v === true) && Object.keys(hctl).length === 3, 'K0b POSITIVE CONTROL — the unmutated modules pass the three integration checks');
  }
  await mutant('K10 Home also trusts meta.relayed (member-writable) when the column says relayed', './js/home.js',
    [['!(gameTrigger && m.relayed === false)', '!(gameTrigger && (m.relayed === false || meta.relayed === false))']], ['H1']);
  await mutant('K11 the projection lets meta.relayed override the column', './js/supabase-projection.js',
    [[RM, "    ...((row.meta && typeof row.meta.relayed === 'boolean') ? { relayed: row.meta.relayed } : (typeof row.relayed === 'boolean' ? { relayed: row.relayed } : {})),\n"]], ['H1', 'P6', 'S1']);
  {
    const sctl = chipChecks(projection, chat, chipsMod);
    assert(Object.values(sctl).every((v) => v === true) && Object.keys(sctl).length === 3, 'K0c POSITIVE CONTROL — the unmutated modules pass the three chip checks');
  }
  const GATE = "  if (!m || m.author !== 'scribe' || m.relayed !== false || m.deleted) return [];";
  await mutant('K12 the chip gate also trusts meta.relayed (member-writable) when the column says relayed', './js/source-chips.js',
    [[GATE, "  if (!m || m.author !== 'scribe' || (m.relayed !== false && !(m.meta && m.meta.relayed === false)) || m.deleted) return [];"]], ['S1']);
  await mutant('K13 the chip gate drops the relayed term (author scribe is enough)', './js/source-chips.js',
    [[GATE, "  if (!m || m.author !== 'scribe' || m.deleted) return [];"]], ['S1', 'S3']);
  await mutant('K9 a server echo REPLACES the local row\'s answer', './js/chat.js',
    [['          existing.seq = ev.seq; existing.ts = ev.ts ?? existing.ts; existing.local = false;',
      '          existing.seq = ev.seq; existing.ts = ev.ts ?? existing.ts; existing.local = false; if (typeof ev.relayed === \'boolean\') existing.relayed = ev.relayed;']], ['F6']);
}

console.log(`\n${fail ? '❌ FAILURES' : '✅ ALL PASS'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
