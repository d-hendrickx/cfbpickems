/**
 * chatsporttest.mjs — THE LOCKER ROOM'S SPORT PILLS AND THE sportTag PLUMBING (D1, DI-553 / DI-530 / W-57)
 * =======================================================================================================
 * Run:  node chatsporttest.mjs
 *
 * Drew, D-48: "in this release i want sport filter pills in the locker room." The Locker Room stays ONE conversation in ONE log (`cfbp_comments`); the pills are a VIEW FILTER over
 * it. This suite proves, offline and without a browser, the parts that are logic:
 *
 *   [0] the closed set of tags: js/sport-tag.js, chatTransport's own copy and 0033's CHECK agree; the sport registry sits inside it; the `sport:` cursor namespace has ONE writer
 *   [1] the projection: a tag is read from the COLUMN only, only if it is a closed code, and an untagged row/event is BYTE-IDENTICAL to the pre-D1 shape (the export hash too)
 *   [2] chat.js: sendEvent / sendMessage / the fold carry a tag only when valid, and an untagged event has NO sportTag key
 *   [3] DI-553's table, row by row: which pill shows which row (including the forged, the deleted and the archived)
 *   [4] the filter can only REMOVE rows (a pill never reveals what `All` hides), and its mutation-resistant corners
 *   [5] unread: per-pill counts and cursors, the `sport:` namespace, the collision a forged gameTag could cause, RG-196's unknown
 *   [6] the pure row builder and the sport list (the gate, XSS, the accessible name)
 *   [7] the page's state in the REAL chat-ui: the row exists only with two sports, the composer rule, system-row stamps, a target is never hidden, the filter is per account and league
 *   [8] a single-sport league renders and sends BYTE-IDENTICALLY (compared with the pre-D1 tree's own output)
 *
 * WHAT THIS CANNOT SEE: taps, haptics, the 150 ms fade, scroll physics and the 44 pt targets on a device — chatsportbrowsertest.mjs measures what a headless Chromium can, and
 * the rest is on Drew's on-device list. `rls.test.mjs` (Drew-run) is the proof that a sent message reads back with its sport_tag under the real column grants.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(HERE, p), 'utf8');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

// ── stubs (unreadtest.mjs's shape) ─────────────────────────────────────────────────────────────
const store = new Map();
globalThis.localStorage = {
  get length() { return store.size; },
  key: (i) => [...store.keys()][i] ?? null,
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  body: { classList: { add() {}, remove() {} }, appendChild() {} }, hidden: false,
};
globalThis.window = globalThis;
globalThis.fetch = async () => { throw new Error('network disabled in chatsporttest'); };
globalThis.matchMedia = () => ({ matches: false });
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const storage = await import('./js/storage.js');
const chat = await import('./js/chat.js');
const ui = await import('./js/chat-ui.js');
const projection = await import('./js/supabase-projection.js');
const tagMod = await import('./js/sport-tag.js');
const pillsMod = await import('./js/chat-sport-pills.js');
const sportsReg = await import('./js/sports/index.js');
const auth = await import('./js/auth.js');

const ACTIVE_LEAGUE_KEY = 'cfbp_supabase_active_league';

// ═════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[0] The closed set of tags, and who may write the `sport:` cursor namespace…');
{
  // The server's CHECK is NOT read here by filename any more (security F2, 2026-10-08): supabase/tests/static.check.mjs replays EVERY migration's effective `messages.sport_tag` CHECK and pins
  // js/sport-tag.js and chatTransport's copy to it (with teeth). What this file still proves is the client half: the two client copies agree with each other, whatever the CHECK says.
  assert(tagMod.SPORT_TAG_CODES.length === 7 && new Set(tagMod.SPORT_TAG_CODES).size === 7 && Object.isFrozen(tagMod.SPORT_TAG_CODES), '[0a] js/sport-tag.js SPORT_TAG_CODES is seven distinct codes, frozen (the server-side pin is static.check F2)');
  const tSrc = stripComments(read('js/chatTransport.js'));
  const tCodes = [...((tSrc.match(/const SB_SPORT_TAGS = new Set\(\[([^\]]*)\]\)/) || [])[1] || '').matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
  assert(eq(tCodes, tagMod.SPORT_TAG_CODES), `[0b] chatTransport.js carries its OWN copy of the set (it may import only backend.js and platform.js) and it equals sport-tag.js (got ${JSON.stringify(tCodes)})`);
  const regKeys = sportsReg.listProfiles().map((p) => p.key);
  assert(regKeys.length >= 2 && regKeys.every((k) => tagMod.SPORT_TAG_CODES.includes(k)), `[0c] every registered sport profile (${regKeys.join(', ')}) is inside the closed set: a sport can always be tagged`);
  assert(tagMod.validSportTag('nfl') === 'nfl' && ['NFL', ' nfl', 'nfl ', 'football', '', null, undefined, 5, {}, ['nfl'], '__proto__', 'constructor', 'toString', '<b>', 'cfb\n'].every((v) => tagMod.validSportTag(v) === ''),
    '[0d] validSportTag: exact membership only — case, whitespace, non-strings, prototype names and markup are all \'\'');
  const stSrc = stripComments(read('js/sport-tag.js'));
  assert(!/\bimport\b/.test(stSrc), '[0e] js/sport-tag.js is a pure leaf: it imports nothing');
  const pSrc = stripComments(read('js/chat-sport-pills.js'));
  assert(eq([...pSrc.matchAll(/from '([^']+)'/g)].map((m) => m[1]).sort(), ['./icons.js', './sport-tag.js']),
    '[0f] js/chat-sport-pills.js imports exactly icons.js and sport-tag.js — no storage, no auth, no chat.js, no pick reader (it renders what it is handed)');

  // The `sport:` namespace has ONE writer. markSeen() refuses it; markSportSeen() is the only door; nothing else in js/ names the prefix.
  const chatSrc = stripComments(read('js/chat.js'));
  assert(/export function markSeen\(tag = 'all'\) \{\s*if \(isSportCursorTag\(tag\)\) return;/.test(chatSrc), '[0g] markSeen() refuses a `sport:` tag on its first line');
  assert((chatSrc.match(/_advanceCursor\(/g) || []).length === 3 && /export function markSportSeen\(sport, ctx = null\) \{\s*const tag = sportCursorTag\(sport\);\s*if \(!tag\) return;\s*_advanceCursor\(tag, sportViewOf\(\{ sport, ctx \}\)\);/.test(chatSrc),
    '[0g] _advanceCursor() has exactly its definition and its two callers: markSeen (after the refusal) and markSportSeen (closed set only)');
  const offenders = [];
  for (const f of ['app.js', 'chat-ui.js', 'chatTransport.js', 'supabase-projection.js', 'chat-sport-pills.js', 'storage.js', 'auth.js', 'scribeLines.js', 'notifications.js']) {
    if (/['"`]sport:/.test(stripComments(read('js/' + f)))) offenders.push(f);
  }
  assert(offenders.length === 0, `[0h] no other module writes a \`sport:\` cursor key literal (found in: ${offenders.join(', ') || 'none'}); chat-ui reaches the namespace only through sportCursorTag()/markSportSeen()`);
  const uiSrc = stripComments(read('js/chat-ui.js'));
  assert((uiSrc.match(/markSportSeen\(/g) || []).length === 1, '[0h] chat-ui calls markSportSeen() at exactly its one site (scheduleMarkRead)');
  assert(!/KEYS\.[A-Z_]*SPORT[A-Z_]*FILTER|cfbp_chat_sport|cfbp_sport_filter/i.test(stripComments(read('js/storage.js'))), '[0i] no new storage key: the selected pill is in memory only and the cursors live inside the existing device-local lastseen key');
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[1] The projection — column only, closed set, byte-identical when untagged…');
{
  const base = { league_id: 'L1', id: 'm1', seq: 7, ts: '2026-10-08T12:00:00.000Z', type: 'message', author: 'p1', game_tag: 'g1', body: 'hi', target_id: '', reply_to: '', notify: true, meta: { mentions: ['p2'] } };
  const untagged = projection.rowToMessage({ ...base, sport_tag: '' });
  const legacy = projection.rowToMessage(base);                       // a row from a database / cache with no such column at all
  assert(JSON.stringify(untagged) === JSON.stringify(legacy) && !('sportTag' in untagged), '[1a] an untagged row and a row with no column at all map to the SAME event, with no sportTag key');
  assert(JSON.stringify(untagged) === '{"leagueId":"L1","seq":7,"id":"m1","ts":1791460800000,"type":"message","author":"p1","gameTag":"g1","body":"hi","targetId":"","replyTo":"","notify":true,"meta":{"mentions":["p2"]}}',
    '[1a] BYTE-IDENTITY: the untagged event is exactly the pre-D1 string (key for key, in order)');
  assert(projection.rowToMessage({ ...base, sport_tag: 'nfl' }).sportTag === 'nfl', '[1b] a tagged row carries sportTag');
  for (const code of tagMod.SPORT_TAG_CODES) assert(projection.rowToMessage({ ...base, sport_tag: code }).sportTag === code, `[1b] …${code} included`);
  for (const bad of ['NFL', 'football', ' nfl', '<img src=x onerror=1>', '__proto__', null, 7, ['nfl'], { a: 1 }]) {
    assert(!('sportTag' in projection.rowToMessage({ ...base, sport_tag: bad })), `[1c] sport_tag ${JSON.stringify(bad)} yields NO tag (closed set only)`);
  }
  assert(!('sportTag' in projection.rowToMessage({ ...base, sport_tag: '', sportTag: 'nfl', meta: { sportTag: 'nfl' }, game_tag: 'sportTag:nfl' })),
    '[1d] the tag is read from the sport_tag COLUMN only: a camelCase twin, meta.sportTag or a look-alike game_tag never becomes a tag');
  // The export-shaped hash the importer verifies (verifyMessages -> rowToMessageEvent) must not move for untagged history.
  const exportEvents = [{ seq: 1, id: 'a', ts: 1791460800000, type: 'message', author: 'p1', gameTag: '', body: 'x', targetId: '', replyTo: '', notify: false, meta: null }];
  const rows = exportEvents.map((e) => projection.messageToRow(e, { leagueId: 'L1', memberIds: new Set(['p1']) }));
  assert(projection.canonicalize(exportEvents) === projection.canonicalize(rows.map(projection.rowToMessageEvent)), '[1e] messageToRow -> rowToMessageEvent round-trips HASH-EQUAL for an untagged event (the importer\'s verifier is unmoved)');
  assert(rows[0].sport_tag === '', '[1e] …and the imported row carries sport_tag \'\' (the column default), present on EVERY row so a bulk insert has one key set');
  const tagged = projection.messageToRow({ ...exportEvents[0], id: 'b', sportTag: 'nfl' }, { leagueId: 'L1', memberIds: new Set(['p1']) });
  assert(tagged.sport_tag === 'nfl' && projection.messageToRow({ ...exportEvents[0], id: 'c', sportTag: 'basketball' }, { leagueId: 'L1' }).sport_tag === '',
    '[1f] messageToRow writes a closed code and nothing else (an out-of-set tag is \'\', never a value the CHECK would refuse)');
  assert(projection.rowToMessageEvent({ ...base, sport_tag: 'nfl' }).sportTag === 'nfl', '[1f] …and a tagged row survives the export-shaped map (no leagueId, tag kept)');
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[2] chat.js — sendEvent / sendMessage / the fold…');
{
  localStorage.clear();
  localStorage.setItem(ACTIVE_LEAGUE_KEY, 'L-IRB');
  storage.setSession('mDrew', false, true);
  chat._resetForTest();
  const outbox = () => JSON.parse(localStorage.getItem('cfbp_chat_outbox2') || '[]');
  const idTagged = chat.sendMessage({ body: 'in the NFL thread', gameTag: 'gN', sportTag: 'nfl', author: 'mDrew' });
  const idPlain = chat.sendMessage({ body: 'plain', author: 'mDrew' });
  const idForged = chat.sendMessage({ body: 'forged', sportTag: 'basketball', author: 'mDrew' });
  const idUpper = chat.sendEvent({ type: 'message', body: 'upper', sportTag: 'NFL', author: 'mDrew' });
  const q = Object.fromEntries(outbox().map((e) => [e.id, e]));
  assert(q[idTagged].sportTag === 'nfl', '[2a] a tagged send queues an event with sportTag');
  assert(!('sportTag' in q[idPlain]) && !('sportTag' in q[idForged]) && !('sportTag' in q[idUpper]), '[2a] an untagged send — and a send with an out-of-set tag — queues an event with NO sportTag key');
  assert(eq(Object.keys(q[idPlain]).sort(), ['author', 'body', 'gameTag', 'id', 'leagueId', 'local', 'meta', 'notify', 'replyTo', 'targetId', 'type', '_localTs'].sort()),
    `[2a] BYTE-IDENTITY: an untagged queued event has exactly the pre-D1 key set (got ${Object.keys(q[idPlain]).sort().join(',')})`);
  const item = chat.getMessage(idTagged), plain = chat.getMessage(idPlain);
  assert(item.sportTag === 'nfl' && !('sportTag' in plain) && !('sportTag' in chat.getMessage(idForged)), '[2b] the optimistic fold item carries sportTag only when tagged and valid');
  // A wire event (and a cached one) goes through newItem too: a tag outside the set is not carried.
  chat.ingest([{ id: 'w1', seq: 1, ts: 1_700_000_000_001, type: 'message', author: 'mKevin', body: 'x', notify: true, gameTag: '', sportTag: 'cfb' },
               { id: 'w2', seq: 2, ts: 1_700_000_000_002, type: 'message', author: 'mKevin', body: 'x', notify: true, gameTag: '', sportTag: '<b>cfb</b>' },
               { id: 'w3', seq: 3, ts: 1_700_000_000_003, type: 'message', author: 'mKevin', body: 'x', notify: true, gameTag: '' }]);
  assert(chat.getMessage('w1').sportTag === 'cfb' && !('sportTag' in chat.getMessage('w2')) && !('sportTag' in chat.getMessage('w3')), '[2c] a folded wire event keeps a closed-code tag and drops anything else');
  // The tag is not a fold input for edits/reactions: an edit never re-tags a message.
  chat.ingest([{ id: 'e1', seq: 4, ts: 1_700_000_000_004, type: 'edit', author: 'mKevin', targetId: 'w1', body: 'edited', sportTag: 'nfl' }]);
  assert(chat.getMessage('w1').sportTag === 'cfb' && chat.getMessage('w1').body === 'edited', '[2d] an edit event cannot move a message to another sport\'s pill');
  chat._resetForTest();
}

// ── a multi-sport league on the storage seam, for [3]…[8] ────────────────────────────────────────
const CID = { cfb: '11111111-1111-4111-8111-111111111111', nfl: '22222222-2222-4222-8222-222222222222', nba: '33333333-3333-4333-8333-333333333333' };
const comp = (key, over = {}) => ({ id: CID[key], sport: key, kind: 'season', enrollment: 'all', isDefault: key === 'cfb', archivedAt: null, activeWeekId: null, settings: {}, createdAt: `2026-0${key === 'cfb' ? 1 : key === 'nfl' ? 2 : 3}-01T00:00:00.000Z`, ...over });
function seedLeague({ nfl = true, nba = false, keepFilter = false } = {}) {
  localStorage.clear();
  localStorage.setItem(ACTIVE_LEAGUE_KEY, 'L-IRB');
  storage.setSession('mDrew', false, true);
  storage.saveCompetition(comp('cfb'));
  if (nfl) storage.saveCompetition(comp('nfl'));
  if (nba) storage.saveCompetition(comp('nba', { archivedAt: '2026-09-01T00:00:00.000Z' }));
  storage.saveWeek({ weekId: 'w_cfb', weekNumber: 6, status: 'open', startDate: '2026-10-01', endDate: '2026-10-05', label: 'Week 6' });
  if (nfl) storage.saveWeek({ weekId: 'w_nfl', weekNumber: 5, status: 'open', startDate: '2026-10-04', endDate: '2026-10-08', label: 'Week 5', competitionId: CID.nfl });
  if (nba) storage.saveWeek({ weekId: 'w_nba', weekNumber: 1, status: 'final', startDate: '2026-09-01', endDate: '2026-09-05', label: 'Week 1', competitionId: CID.nba });
  storage.saveGame({ gameId: 'gC', weekId: 'w_cfb', homeTeam: 'Michigan', awayTeam: 'Ohio State', status: 'live', kickoff: '2026-10-03T16:00:00.000Z' });
  if (nfl) {
    storage.saveGame({ gameId: 'gN', weekId: 'w_nfl', homeTeam: 'Green Bay', awayTeam: 'Detroit', status: 'live', kickoff: '2026-10-05T17:00:00.000Z' });
    storage.saveGame({ gameId: 'gN2', weekId: 'w_nfl', homeTeam: 'Dallas', awayTeam: 'Seattle', status: 'scheduled', kickoff: '2026-10-05T20:00:00.000Z' });
  }
  if (nba) storage.saveGame({ gameId: 'gB', weekId: 'w_nba', homeTeam: 'Boston', awayTeam: 'Miami', status: 'final', kickoff: '2026-09-02T23:00:00.000Z' });
  chat._resetForTest();
  if (!keepFilter) { ui._setSportFilterForTest('all'); ui._setChatFilterForTest('all'); }
}
let seq = 0;
const m = (id, over = {}) => ({ id, seq: ++seq, ts: 1_700_000_000_000 + seq, type: 'message', author: 'mKevin', body: id, notify: true, gameTag: '', ...over });

// ═════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[3] DI-553\'s table: which pill shows which row…');
{
  seedLeague({ nfl: true, nba: true });
  seq = 0;
  const rows = [
    m('plain'),
    m('cfbThread', { gameTag: 'gC', sportTag: 'cfb' }),
    m('nflThread', { gameTag: 'gN', sportTag: 'nfl' }),
    m('nflLegacy', { gameTag: 'gN' }),                                                    // written before the column was read: sorted by its game, no backfill
    m('cfbLegacy', { gameTag: 'gC' }),
    m('sysCfb', { type: 'system', author: 'system', notify: false, meta: { kind: 'picksLocked', weekId: 'w_cfb' } }),
    m('sysNfl', { type: 'system', author: 'system', notify: false, meta: { kind: 'weekFinal', weekId: 'w_nfl' } }),
    m('scribeNfl', { author: 'scribe', meta: { kind: 'lifecycle', weekId: 'w_nfl' } }),
    m('scribeNflTagged', { author: 'scribe', sportTag: 'nfl' }),
    m('deletedGame', { gameTag: 'g_removed' }),
    m('archivedThread', { gameTag: 'gB' }),
    m('archivedSys', { type: 'system', author: 'system', notify: false, meta: { weekId: 'w_nba' } }),
    m('forgedArchived', { sportTag: 'nba' }),                                             // names a sport this league archived: not believed
    m('forgedNeverRan', { sportTag: 'nhl' }),                                             // names a sport this league never ran
    m('forgedUpper', { sportTag: 'NFL' }),                                                // outside the set: dropped by the fold
    m('playerMetaWeek', { meta: { weekId: 'w_nfl' } }),                                  // a PLAYER's meta is not where a week is read from
    // RESOLUTION ORDER, as amended 2026-10-08 (reviewer N2 / security hardening; DI-530: the sport is "never from the tag"): a gameTag that resolves to a game decides, from THAT game's competition; the
    // row's own tag is the fallback only when there is no game to read, then the week for system and SCRIBE rows, then untagged.
    m('gameBeatsTag', { gameTag: 'gC', sportTag: 'nfl' }),                                // a live CFB game, a tag claiming NFL: the game wins -> CFB
    m('forgedThreadTag', { gameTag: 'gN', sportTag: 'cfb' }),                             // an NFL thread row forged to file under CFB: still NFL
    m('gameBeatsTagArchived', { gameTag: 'gB', sportTag: 'nfl' }),                        // an ARCHIVED game's row cannot be re-filed under a live sport by its tag: All only
    m('tagWhenGameGone', { gameTag: 'g_removed', sportTag: 'nfl' }),                      // no game to read: the valid live tag stands
    m('sysGameBeatsTag', { type: 'system', author: 'system', notify: false, gameTag: 'gC', sportTag: 'nfl', meta: { weekId: 'w_nfl' } }),   // a system row with a game: the game, not its tag or its week
  ];
  chat.ingest(rows);
  const ctx = ui._chatSportCtxForTest();
  assert(ctx && eq(ctx.sports, ['cfb', 'nfl']), `[3a] the ctx lists the league's NON-ARCHIVED sports in competition order (got ${JSON.stringify(ctx && ctx.sports)}): the archived NBA is not a pill`);
  const under = (sport) => chat.getMessages({ tag: 'all', sportFilter: sport === 'all' ? undefined : { sport, ctx } }).map((x) => x.id);
  const all = under('all'), cfb = under('cfb'), nfl = under('nfl');
  assert(rows.every((r) => all.includes(r.id)) && all.length === rows.length, '[3b] `All` shows EVERY row, including a row of an archived sport and a deleted game');
  const expect = {
    plain: [1, 1, 1], cfbThread: [1, 1, 0], nflThread: [1, 0, 1], nflLegacy: [1, 0, 1], cfbLegacy: [1, 1, 0],
    sysCfb: [1, 1, 0], sysNfl: [1, 0, 1], scribeNfl: [1, 0, 1], scribeNflTagged: [1, 0, 1],
    deletedGame: [1, 1, 1], archivedThread: [1, 0, 0], archivedSys: [1, 0, 0],
    forgedArchived: [1, 1, 1], forgedNeverRan: [1, 1, 1], forgedUpper: [1, 1, 1], playerMetaWeek: [1, 1, 1],
    gameBeatsTag: [1, 1, 0], forgedThreadTag: [1, 0, 1], gameBeatsTagArchived: [1, 0, 0], tagWhenGameGone: [1, 0, 1], sysGameBeatsTag: [1, 1, 0],
  };
  for (const [id, [a, c, n]] of Object.entries(expect)) {
    assert(all.includes(id) === !!a && cfb.includes(id) === !!c && nfl.includes(id) === !!n, `[3c] ${id}: All ${a ? 'shows' : 'hides'}, CFB ${c ? 'shows' : 'hides'}, NFL ${n ? 'shows' : 'hides'}`);
  }
  assert(chat.messageSport(chat.getMessage('plain'), ctx) === '' && chat.messageSport(chat.getMessage('nflLegacy'), ctx) === 'nfl' && chat.messageSport(chat.getMessage('archivedThread'), ctx) === ''
    && chat.messageSport(chat.getMessage('forgedArchived'), ctx) === '' && chat.messageSport(chat.getMessage('sysNfl'), ctx) === 'nfl' && chat.messageSport(chat.getMessage('scribeNfl'), ctx) === 'nfl',
    '[3d] messageSport(): untagged \'\', a legacy thread row by its game, a forged tag \'\', a system/SCRIBE row by its week');
  assert(chat.messageSport(chat.getMessage('gameBeatsTag'), ctx) === 'cfb' && chat.messageSport(chat.getMessage('forgedThreadTag'), ctx) === 'nfl' && chat.messageSport(chat.getMessage('gameBeatsTagArchived'), ctx) === ''
    && chat.messageSport(chat.getMessage('tagWhenGameGone'), ctx) === 'nfl' && chat.messageSport(chat.getMessage('plain'), ctx) === '',
    '[3d2] RESOLUTION ORDER: a game that resolves decides (a forged tag on a thread row is ineffective, even toward an archived game); with no game the valid live tag stands; else the week; else untagged');
  // A failed lookup treats the row as untagged — and never hides it.
  const broken = { sports: ['cfb', 'nfl'], sportOfGame() { throw new Error('lookup failed'); }, sportOfWeek() { throw new Error('lookup failed'); } };
  const underBroken = (sport) => chat.getMessages({ tag: 'all', sportFilter: { sport, ctx: broken } }).map((x) => x.id);
  assert(['nflLegacy', 'sysNfl', 'archivedThread'].every((id) => underBroken('cfb').includes(id) && underBroken('nfl').includes(id)), '[3e] a resolver that throws makes a row UNTAGGED (shown everywhere), never hidden');
  // A stale / unknown filter narrows nothing.
  const narrow = (f) => chat.getMessages({ tag: 'all', sportFilter: f }).length;
  assert([narrow({ sport: 'nba', ctx }), narrow({ sport: 'zzz', ctx }), narrow({ sport: 'nfl' }), narrow({ sport: 'nfl', ctx: null }), narrow(null), narrow('nfl')].every((n) => n === rows.length),
    '[3f] a filter that names an archived/unknown sport, or has no ctx, narrows NOTHING (it fails open to `All`)');
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[4] The filter only REMOVES rows — it can never reveal what `All` hides (the blind-rule shape)…');
{
  seedLeague({ nfl: true, nba: true });
  seq = 0;
  const fresh = () => ({ ts: Date.now() - 1000 * (100 - seq) });   // inside any retention window (the fixture's default ts is 2023)
  chat.ingest([
    m('visible-plain', fresh()),
    m('nfl-thread', { gameTag: 'gN', sportTag: 'nfl', ...fresh() }),
    m('cfb-thread', { gameTag: 'gC', sportTag: 'cfb', ...fresh() }),
    m('private-selftest', { author: 'system', type: 'message', notify: false, id: 'sys_test_' + 'ab'.repeat(20) + 'ab', visibleTo: 'mKevin', meta: { kind: 'selfTest' }, ...fresh() }),
  ]);
  // RETENTION: the commissioner's window hides anything older than 7 days from every reader; a row 90 days old must stay hidden under every pill too
  chat.ingest([m('old-plain', { ts: Date.now() - 90 * 86400000 }), m('old-nfl-thread', { gameTag: 'gN', sportTag: 'nfl', ts: Date.now() - 90 * 86400000 })]);
  storage.saveSetting('chatRetentionDays', 7);
  // an epoch: everything at or below seq 1 is "pre-launch test chatter" and hidden from every reader
  storage.saveSetting('chatEpochSeq', 1);
  const ctx = ui._chatSportCtxForTest();
  const unfiltered = chat.getMessages({ tag: 'all', respectRetention: true }).map((x) => x.id);
  assert(!unfiltered.includes('visible-plain') && !unfiltered.includes('old-plain') && !unfiltered.includes('old-nfl-thread'), '[4a] fixture: the epoch hides seq 1 and retention hides the 90-day-old rows from `All` (the hides the filter must never undo)');
  for (const sport of ['cfb', 'nfl']) {
    const filtered = chat.getMessages({ tag: 'all', respectRetention: true, sportFilter: { sport, ctx } }).map((x) => x.id);
    assert(filtered.every((id) => unfiltered.includes(id)), `[4b] under the ${sport} pill, every shown row is a row \`All\` shows (a SUBSET — the pill adds nothing), got ${JSON.stringify(filtered)}`);
    assert(!filtered.includes('visible-plain'), `[4b] …and the epoch-hidden row stays hidden under ${sport}`);
    assert(!filtered.includes('old-plain') && !filtered.includes('old-nfl-thread'), `[4b] …and so do the retention-hidden rows (a plain one and an NFL thread one) under ${sport}`);
  }
  const cfbOnly = chat.getMessages({ tag: 'all', respectRetention: true, sportFilter: { sport: 'cfb', ctx } }).map((x) => x.id);
  assert(cfbOnly.includes('cfb-thread') && !cfbOnly.includes('nfl-thread'), '[4c] non-vacuity: the filter really narrows (the NFL thread is not under CFB)');
  // Unread cannot count a row the pill hides, nor one `All` hides.
  const before = chat.unreadCount('mDrew', 'sport:cfb', ctx);
  assert(before === 1, `[4d] unread under CFB counts only the CFB thread (the epoch-hidden plain row is not counted): ${before}`);
  storage.saveSetting('chatEpochSeq', 0);
  storage.saveSetting('chatRetentionDays', 0);
  // Structural: nothing the pills add reads a pick.
  const uiSrc = stripComments(read('js/chat-ui.js'));
  const bodyOf = (name) => { const i = uiSrc.indexOf(`function ${name}(`); return i < 0 ? '' : uiSrc.slice(i, uiSrc.indexOf('\n}\n', i)); };
  const added = ['lockerRoomSportList', 'chatSportCtx', 'currentSportFilter', 'currentComposerSportTag', 'systemSportFields', 'sportPillsHTML', 'ensureChatTargetVisible', 'onSportPillTap'].map(bodyOf);
  assert(added.every((b) => b.length > 40) && added.every((b) => !/getPicks|arePicksPublic|selectedTeam|gamePickChips|pickVisibilityFor/.test(b)), '[4e] none of the functions the pills added to chat-ui.js reads a pick (the ⚡ chips are untouched)');
  assert(!/getPicks|selectedTeam/.test(stripComments(read('js/chat-sport-pills.js'))), '[4e] the pill builder reads no pick either');
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[5] Unread: per-pill counts, the `sport:` cursors, and the collisions a forged tag could cause…');
{
  seedLeague({ nfl: true, nba: true });
  seq = 0;
  chat.ingest([
    m('u1'),                                                                  // plain: under every pill
    m('u2', { gameTag: 'gC', sportTag: 'cfb' }),
    m('u3', { gameTag: 'gN', sportTag: 'nfl' }),
    m('u4', { author: 'scribe', meta: { weekId: 'w_nfl' } }),                 // SCRIBE post of an NFL week
    m('u5', { author: 'mDrew' }),                                             // my own: never unread
    m('u6', { sportTag: 'nfl' }),
  ]);
  const ctx = ui._chatSportCtxForTest();
  const n = (tag) => chat.unreadCount('mDrew', tag, ctx);
  assert(n('all') === 5 && n('sport:cfb') === 2 && n('sport:nfl') === 4, `[5a] All counts every unread row (5); CFB counts the rows under the CFB pill (2: plain + CFB thread); NFL counts 4 (plain, thread, SCRIBE week post, tagged) — got ${n('all')}/${n('sport:cfb')}/${n('sport:nfl')}`);
  assert(chat.unreadCountOrUnknown('mDrew', 'sport:nfl', ctx).known === true && chat.unreadCountOrUnknown('mDrew', 'sport:nfl', ctx).count === 4, '[5b] unreadCountOrUnknown answers {known:true,count:4} for a pill with a ctx');
  assert(eq(chat.unreadCountOrUnknown('mDrew', 'sport:nfl'), { known: false, count: 0 }) && eq(chat.unreadCountOrUnknown('mDrew', 'sport:nfl', { sports: ['cfb'] }), { known: false, count: 0 }),
    '[5b] with no ctx — or a ctx that does not list the sport — the count is UNKNOWN (paints nothing), never a made-up 0');
  assert(eq(chat.unreadCountOrUnknown(null, 'sport:nfl', ctx), { known: false, count: 0 }) && chat.unreadCount(null, 'sport:nfl', ctx) === 0, '[5b] RG-196: an unknown viewer is {known:false} for a pill too');
  assert(eq(chat.unreadAuthors('mDrew', 'sport:cfb', ctx), ['mKevin']) && eq(chat.unreadAuthors('mDrew', 'sport:nfl', ctx), ['mKevin', 'scribe']), '[5c] unreadAuthors under a pill uses the same predicate');

  chat.markSportSeen('nfl');
  assert(n('sport:nfl') === 0 && n('sport:cfb') === 2 && n('all') === 5, `[5d] opening the NFL pill clears NFL ONLY: a row visible under two pills clears each only when that pill is opened (nfl ${n('sport:nfl')}, cfb ${n('sport:cfb')}, all ${n('all')})`);
  chat.markSportSeen('cfb');
  assert(n('sport:cfb') === 0 && n('all') === 5, `[5e] …CFB likewise, and \`All\` (the room's own cursor) is untouched by either (${n('all')})`);
  chat.ingest([m('u7'), m('u8', { gameTag: 'gC', sportTag: 'cfb' })]);
  assert(n('sport:cfb') === 2 && n('sport:nfl') === 1 && n('all') === 7, `[5f] new rows count under their pills again (cfb ${n('sport:cfb')}, nfl ${n('sport:nfl')}, all ${n('all')})`);
  chat.markSeen('all');
  assert(n('all') === 0 && n('sport:cfb') === 0 && n('sport:nfl') === 0, '[5g] reading the room (`All`) is reading every pill: markSeen(\'all\') advances the sport cursors too');
  // THE NAMESPACE HAS ONE WRITER.
  localStorage.removeItem('cfbp_chat_lastseen2');
  chat.markSeen('sport:nfl'); chat.markSeen('sport:cfb'); chat.markSeen('sport:');
  const byTagKeys = () => Object.keys(chat.getLastSeen().byTag);
  assert(!byTagKeys().some((k) => k.startsWith('sport:')), `[5h] markSeen() with a \`sport:\` tag writes NOTHING (the namespace has one writer) — byTag keys: ${JSON.stringify(byTagKeys())}`);
  chat.markSportSeen('nfl'); chat.markSportSeen('basketball'); chat.markSportSeen('__proto__'); chat.markSportSeen(null);
  assert(eq(byTagKeys(), ['sport:nfl']), `[5i] markSportSeen() writes the closed set only (one key: ${JSON.stringify(byTagKeys())})`);
  assert(![...store.keys()].some((k) => /sport/i.test(k)), `[5j] no new device storage key was created for any of it (keys: ${[...store.keys()].join(', ')})`);
  // Monotonic: a cursor never moves backward.
  const cur = chat.getLastSeen().byTag['sport:nfl'];
  chat.markSportSeen('nfl');
  assert(chat.getLastSeen().byTag['sport:nfl'] >= cur, '[5k] a pill cursor is monotonic');

  // THE COLLISION a forged gameTag could cause: a message whose gameTag is "sport:nfl" must not read a pill's cursor as its thread's.
  localStorage.removeItem('cfbp_chat_lastseen2');
  seq = 100;
  chat.ingest([m('forged-thread', { gameTag: 'sport:nfl' })]);
  chat.markSportSeen('nfl');                                              // the NFL pill cursor is now AT the forged row (seq 101); the room cursor is still 0
  const latest = chat.latestUnreadNotifying('mDrew');
  assert(latest && latest.id === 'forged-thread', '[5l] a message with gameTag "sport:nfl" is judged against the ROOM cursor (unread), not the NFL pill\'s — a member cannot make their message read as already-read');
  assert(chat.readThroughSeq('sport:nfl') === chat.readThroughSeq('all'), '[5l] readThroughSeq(\'sport:…\') is the room cursor');
  assert(chat.messageSport(chat.getMessage('forged-thread'), ctx) === '' && chat.appearsUnderSport(chat.getMessage('forged-thread'), 'cfb', ctx), '[5m] …and such a row is just untagged to the filter (shown under every pill)');
  chat._resetForTest();
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[5n] N1 (coordinator decision, 2026-10-08): reading under a sport pill also advances the ROOM cursor — up to, never past, the oldest unread row that pill hides…');
{
  const setup = (build, { nfl = true } = {}) => {
    seedLeague({ nfl }); localStorage.removeItem('cfbp_chat_lastseen2'); seq = 0;
    chat.ingest(build()); return ui._chatSportCtxForTest();
  };
  const n = (tag, ctx) => chat.unreadCount('mDrew', tag, ctx);
  const room = () => chat.getLastSeen().seq;

  // (a) a CFB thread row (hidden under the NFL pill, unread) sits between two plain rows: the room cursor stops just BEFORE it
  let ctx = setup(() => [m('p1'), m('c1', { gameTag: 'gC' }), m('n1', { gameTag: 'gN' }), m('p2')]);
  assert(n('all', ctx) === 4 && n('sport:nfl', ctx) === 3 && n('sport:cfb', ctx) === 3, '[5n-a] fixture: All 4, NFL 3 (p1 n1 p2), CFB 3 (p1 c1 p2)');
  chat.markSportSeen('nfl', ctx);
  assert(room() === 1, `[5n-a] the room cursor advanced to seq 1 — the row BEFORE the oldest unread row the NFL pill hides (c1, seq 2) — and not one step further (got ${room()})`);
  assert(n('all', ctx) === 3, `[5n-a] All (and so Locker Room, the Chat tab badge, the page title and the app badge) now counts only c1, n1, p2 = 3 (got ${n('all', ctx)})`);
  assert(n('sport:nfl', ctx) === 0, '[5n-a] the NFL pill itself is read');
  assert(n('sport:cfb', ctx) === 3, `[5n-a] the CFB pill is NOT cleared by reading NFL: its own cursor was fixed where it stood, so p1 c1 p2 still count (got ${n('sport:cfb', ctx)}) — DI-553: each pill clears only when opened`);
  assert(eq(Object.keys(chat.getLastSeen().byTag).sort(), ['sport:cfb', 'sport:nfl']) && chat.getLastSeen().byTag['sport:cfb'] === 0, '[5n-a] the CFB pill\'s cursor was materialised at its old position (0), never advanced');

  // (b) nothing hidden is unread: the room cursor goes all the way to the head
  ctx = setup(() => [m('p1'), m('n1', { gameTag: 'gN' }), m('p2')]);
  chat.markSportSeen('nfl', ctx);
  assert(room() === 3 && n('all', ctx) === 0, `[5n-b] no unread row is hidden from NFL here, so the room is read through the head (cursor ${room()}, All ${n('all', ctx)})`);
  assert(n('sport:cfb', ctx) === 2, '[5n-b] …and the CFB pill still holds its two visible rows (p1, p2) until CFB is opened');

  // (c) the oldest unread row IS the hidden one: the room cursor does not move at all
  ctx = setup(() => [m('c1', { gameTag: 'gC' }), m('p1'), m('n1', { gameTag: 'gN' })]);
  chat.markSportSeen('nfl', ctx);
  assert(room() === 0 && n('all', ctx) === 3, `[5n-c] a hidden unread row at the very front pins the room cursor where it was (cursor ${room()}, All ${n('all', ctx)})`);
  assert(n('sport:nfl', ctx) === 0, '[5n-c] …while the pill itself is still read');

  // (d) a hidden row that is already READ does not bound anything
  ctx = setup(() => [m('c0', { gameTag: 'gC' })]);
  chat.markSeen('all');
  chat.ingest([m('p1'), m('c2', { gameTag: 'gC' }), m('n1', { gameTag: 'gN' })]);
  chat.markSportSeen('nfl', ctx);
  assert(room() === 2 && n('all', ctx) === 2, `[5n-d] the read CFB row c0 does not bound the advance; the unread CFB row c2 (seq 3) does: cursor ${room()} (All ${n('all', ctx)})`);

  // (e) the viewer's OWN hidden row is never unread, so it never bounds
  ctx = setup(() => [m('p1'), m('mine', { gameTag: 'gC', author: 'mDrew' }), m('n1', { gameTag: 'gN' })]);
  chat.markSportSeen('nfl', ctx);
  assert(room() === 3 && n('all', ctx) === 0, `[5n-e] my own CFB-thread message hides from NFL but is not unread, so it does not hold the cursor back (cursor ${room()})`);

  // (f) without a usable ctx the answer is the SAFE one: only the pill's cursor moves, the room's does not
  ctx = setup(() => [m('p1'), m('c1', { gameTag: 'gC' })]);
  chat.markSportSeen('nfl');
  assert(room() === 0 && chat.getLastSeen().byTag['sport:nfl'] === 2, '[5n-f] markSportSeen(\'nfl\') with NO ctx marks the pill only (never over-clears the room)');
  chat.markSportSeen('nfl', { sports: ['cfb'] });
  assert(room() === 0, '[5n-f] …and a ctx that does not list the sport changes nothing at the room level either');
  chat.markSportSeen('basketball', ctx); chat.markSportSeen(null, ctx);
  assert(room() === 0 && !('sport:basketball' in chat.getLastSeen().byTag), '[5n-f] a sport outside the closed set writes nothing');

  // (g) game-thread cursors follow the room's advance, to the same bound and no further
  ctx = setup(() => []);
  chat.markSeen('gX');                                  // an explicit thread cursor at 0
  chat.ingest([m('p1'), m('c1', { gameTag: 'gC' }), m('n1', { gameTag: 'gN' })]);
  chat.markSportSeen('nfl', ctx);
  assert(room() === 1 && chat.getLastSeen().byTag.gX === 1, `[5n-g] a game-thread cursor advances with the room to the same bound (room ${room()}, gX ${chat.getLastSeen().byTag.gX})`);

  // (h) monotonic, and a second pill's read cannot walk the room cursor backward
  ctx = setup(() => [m('p1'), m('c1', { gameTag: 'gC' }), m('n1', { gameTag: 'gN' }), m('p2')]);
  chat.markSportSeen('nfl', ctx);
  const afterNfl = room();
  chat.markSportSeen('cfb', ctx);                      // c1 is CFB, so for the CFB pill the hidden unread row is n1 (seq 3): bound 2
  assert(room() === 2 && room() >= afterNfl && n('sport:cfb', ctx) === 0 && n('sport:nfl', ctx) === 0, `[5n-h] reading CFB next moves the room on to just before n1 (cursor ${room()}), never back, and both pills are now read`);
  chat.markSportSeen('nfl', ctx);
  assert(room() === 4 && n('all', ctx) === 0, `[5n-h] reading NFL again — c1 was read via CFB, so no unread row is hidden from NFL any more — takes the room to the head (cursor ${room()}); it never moves backward`);
  chat.markSeen('all');
  assert(room() === 4 && n('all', ctx) === 0 && n('sport:cfb', ctx) === 0 && n('sport:nfl', ctx) === 0, '[5n-h] reading All still reads everything (unchanged)');
  chat._resetForTest();
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[6] The pure row builder and the sport list…');
{
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const prof = (k) => sportsReg.listProfiles().find((p) => p.key === k) || null;
  // W-57 Part 2 (2026-10-08): the sport LIST is the sports lane's own, `isMultiSport() ? leagueSports() : []` (js/competition.js); the duplicate lockerRoomSports() in this module is gone. What a pill row offers is
  // therefore decided in exactly one place, and these cases drive it through the REAL storage seam rather than a hand-built competitions array.
  assert(!('lockerRoomSports' in pillsMod), '[6a0] js/chat-sport-pills.js no longer carries a second copy of "which sports does this league run" (lockerRoomSports is gone)');
  {
    const cuSrc0 = stripComments(read('js/chat-ui.js'));
    assert(/function lockerRoomSportList\(\) \{\s*try \{ return isMultiSport\(\) \? leagueSports\(\) : \[\]; \} catch \{ return \[\]; \}\s*\}/.test(cuSrc0), '[6a0] chat-ui\'s lockerRoomSportList() IS `isMultiSport() ? leagueSports() : []` — the sports lane\'s two functions, nothing re-derived');
    assert(!/lockerRoomSports\b|getCompetitions\(|listProfiles\(/.test(cuSrc0), '[6a0] …and chat-ui no longer reads competitions or the profile registry itself for the pill list');
  }
  seedLeague({ nfl: false });
  assert(eq(ui._lockerRoomSportListForTest(), []), '[6a] ONE sport: no pills (a one-sport league gets no markup)');
  seedLeague({ nfl: true }); storage.saveCompetition(comp('nfl', { archivedAt: '2026-01-01T00:00:00.000Z' }));
  assert(eq(ui._lockerRoomSportListForTest(), []), '[6a] two competitions with one ARCHIVED: still one live sport, no pills');
  localStorage.clear(); localStorage.setItem(ACTIVE_LEAGUE_KEY, 'L-IRB');
  assert(eq(ui._lockerRoomSportListForTest(), []), '[6a] no competitions at all (pre-backfill): []');
  seedLeague({ nfl: true, nba: true });
  const two = ui._lockerRoomSportListForTest();
  assert(eq(two.map((s) => s.dbCode), ['cfb', 'nfl']) && eq(two.map((s) => s.code), ['CFB', 'NFL']) && two.every((s) => s.glyphKey === 'sportFootball'), '[6b] two live sports (the archived third is not one): CFB then NFL, with the profile\'s code and the icon family\'s glyph key');
  seedLeague({ nfl: true }); storage.saveCompetition(comp('nba'));        // a THIRD live sport with no registered profile: labelled by its code, never dropped
  const three = ui._lockerRoomSportListForTest();
  assert(eq(three.map((s) => s.dbCode), ['cfb', 'nfl', 'nba']) && three[2].code === 'NBA' && three[2].glyphKey !== undefined, '[6d] a live sport with no registered profile is listed, labelled by its upper-cased code');
  const html = pillsMod.sportPillsMarkup({ sports: two, selected: 'nfl', allUnread: { badge: '12', unread: 12 }, unreadOf: (c) => (c === 'cfb' ? { badge: '2', unread: 2 } : { badge: '', unread: 0 }), esc });
  assert(/^<div class="chat-sport-pills" role="radiogroup" aria-label="Filter by sport">/.test(html) && (html.match(/<button /g) || []).length === 3, '[6f] a radiogroup labelled "Filter by sport" with All + one pill per sport');
  assert((html.match(/role="radio"/g) || []).length === 3 && (html.match(/aria-checked="true"/g) || []).length === 1 && /data-chat-sport-filter="nfl"[^>]*>/.test(html) && /aria-checked="true" aria-label="NFL, selected" data-chat-sport-filter="nfl"/.test(html), '[6g] each pill is a radio; exactly the selected one is aria-checked');
  assert(/aria-label="All, 12 unread"/.test(html) && /aria-label="CFB, 2 unread"/.test(html) && /aria-label="NFL, selected"/.test(html), '[6h] the accessible NAME carries the state: "All, 12 unread", "CFB, 2 unread", "NFL, selected"');
  assert(pillsMod.sportPillName({ code: 'NFL', unread: 2, selected: true }) === 'NFL, 2 unread, selected' && pillsMod.sportPillName({ code: 'NFL', unread: 250, selected: false }) === 'NFL, 99+ unread', '[6h] …"NFL, 2 unread, selected" exactly, and the 99+ ceiling');
  assert(/<span class="chat-unread-dot">12<\/span>/.test(html) && /<span class="chat-unread-dot">2<\/span>/.test(html) && (html.match(/chat-unread-dot/g) || []).length === 2, '[6i] a dot only where there is something unread');
  assert(/<span class="chat-sport-glyph" aria-hidden="true"><svg [^>]*aria-hidden="true"/.test(html) && (html.match(/chat-sport-glyph/g) || []).length === 2, '[6j] the sport pills carry the icon family\'s glyph (aria-hidden); All has none');
  assert(/class="chat-pill chat-sport-pill" role="radio" aria-checked="false" aria-label="All, 12 unread"/.test(html) && /class="chat-pill chat-sport-pill active" role="radio" aria-checked="true" aria-label="NFL, selected"/.test(html), '[6k] the selected pill takes the existing `.chat-pill.active` fill, nothing else');
  assert(/aria-checked="true" aria-label="All/.test(pillsMod.sportPillsMarkup({ sports: two, selected: 'zzz', allUnread: null, unreadOf: null, esc })), '[6l] a selection that is not offered renders as `All` selected');
  assert(pillsMod.sportPillsMarkup({ sports: [], selected: 'all', esc }) === '' && pillsMod.sportPillsMarkup({ sports: [two[0]], selected: 'all', esc }) === '', '[6m] fewer than two sports renders \'\'');
  let threw = false; try { pillsMod.sportPillsMarkup({ sports: two, selected: 'all' }); } catch { threw = true; }
  assert(threw, '[6n] a missing escaper THROWS — the builder never renders unescaped');

  // XSS (C5): a hostile profile code/label and a hostile dbCode value.
  const evil = '"><img src=x onerror=alert(1)>';
  const hostile = [{ dbCode: 'cfb', code: evil, label: evil, glyphKey: 'sportFootball', competitionId: 'x' }, { dbCode: 'nfl', code: '<script>alert(1)</script>', label: 'x', glyphKey: 'nope-not-a-glyph', competitionId: 'y' }];
  const safe = pillsMod.sportPillsMarkup({ sports: hostile, selected: 'all', allUnread: { badge: evil, unread: 0 }, unreadOf: () => ({ badge: evil, unread: 3 }), esc });
  const noSvg = safe.replace(/<svg[\s\S]*?<\/svg>/g, '');
  assert(!/<img|<script/.test(noSvg) && ![...noSvg.matchAll(/<[a-z][^>]*>/gi)].some((t) => /\son[a-z]+=/i.test(t[0].replace(/"[^"]*"/g, '""'))) && /&lt;img/.test(safe) && /&lt;script&gt;/.test(safe) && /&quot;&gt;&lt;img/.test(safe),
    '[6o] hostile code / label / badge text render INERT: no live <img>/<script>, no on* attribute, the quote-breaking attempt is &quot;-escaped, in text and in every attribute');
  const raw = pillsMod.sportPillsMarkup({ sports: hostile, selected: 'all', allUnread: null, unreadOf: null, esc: (s) => String(s) });
  assert(/<img src=x onerror=alert\(1\)>/.test(raw), '[6o] NON-VACUITY: with an identity escaper the same input DOES put live markup on the page — so it is the escaper (not the fixture) that makes [6o] pass');
  // The sport list no longer filters codes (lockerRoomSports did); the BUILDER now refuses an entry whose dbCode is not in the closed set, so a hostile or unknown code is never a pill, a value or an aria-label.
  const sneaky = pillsMod.sportPillsMarkup({ sports: [{ dbCode: 'cfb', code: 'CFB', glyphKey: 'sportFootball' }, { dbCode: evil, code: 'EVIL', glyphKey: '' }, { dbCode: 'nfl', code: 'NFL', glyphKey: 'sportFootball' }, { dbCode: '__proto__', code: 'PROTO', glyphKey: '' }, { dbCode: 'football', code: 'FB', glyphKey: '' }], selected: evil, allUnread: null, unreadOf: null, esc });
  assert(!/EVIL|PROTO|>FB<|football|__proto__|onerror/.test(sneaky) && (sneaky.match(/<button /g) || []).length === 3 && /aria-checked="true" aria-label="All, selected"/.test(sneaky),
    '[6o2] an entry whose dbCode is outside the closed set (markup, a prototype name, a near miss) is NOT rendered at all, and a hostile `selected` is simply `All`: All + CFB + NFL only');
  const oneValid = pillsMod.sportPillsMarkup({ sports: [{ dbCode: 'cfb', code: 'CFB', glyphKey: '' }, { dbCode: 'football', code: 'FB', glyphKey: '' }], selected: 'all', allUnread: null, unreadOf: null, esc });
  assert(oneValid === '', '[6o3] …and when that leaves fewer than two valid sports there is no row');
  const attrSingle = (html.replace(/<svg[\s\S]*?<\/svg>/g, '').match(/=\'/g) || []).length;
  assert(attrSingle === 0, '[6p] every attribute value is double-quoted (C5)');
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[7] The page\'s state in the REAL chat-ui…');
{
  // (a) the gate
  seedLeague({ nfl: false });
  assert(eq(ui._lockerRoomSportListForTest(), []) && ui._chatSportCtxForTest() === null && !/chat-sport/.test(ui._pillsHTMLForTest()), '[7a] ONE sport: no sport list, no ctx, and not a byte of sport-pill markup');
  seedLeague({ nfl: true });
  assert(eq(ui._lockerRoomSportListForTest().map((s) => s.dbCode), ['cfb', 'nfl']), '[7a] two sports: the list is CFB, NFL');
  const html = ui._pillsHTMLForTest();
  assert(html.startsWith('<div class="chat-sport-pills" role="radiogroup"') && html.indexOf('chat-sport-pills') < html.indexOf('chat-pills-scroll'), '[7b] the sport row sits ABOVE the Locker Room / Records / game row, in the same call that paints them');
  assert(/aria-checked="true" aria-label="All/.test(html) && /data-chat-filter="all"/.test(html), '[7b] All is selected by default, and the existing Locker Room pill is untouched');

  // (b) a CFB-only member still sees both pills (DI-553 / DI-555's "what the member who has not joined can still do"): the list does not depend on who is looking
  storage.setSession('mKevin', false, true);
  assert(eq(ui._lockerRoomSportListForTest().map((s) => s.dbCode), ['cfb', 'nfl']), '[7c] the pills list every non-archived sport of the league for ANY member (they filter one shared room; they are not a sport switcher)');
  storage.setSession('mDrew', false, true);

  // (c) game pills narrowed by the selected sport
  const gamePills = (h) => [...h.matchAll(/data-chat-filter="([^"]+)"/g)].map((x) => x[1]).filter((t) => !['all', 'records'].includes(t));
  chat.ingest([m('t1', { gameTag: 'gN2', sportTag: 'nfl' }), m('t2', { gameTag: 'gC', sportTag: 'cfb' })]);
  assert(eq(gamePills(ui._pillsHTMLForTest()).sort(), ['gC', 'gN', 'gN2']), `[7d] \`All\`: every sport's game pills — the live NFL game gets a pill from ITS week too (got ${JSON.stringify(gamePills(ui._pillsHTMLForTest()))})`);
  ui._setSportFilterForTest('nfl');
  assert(eq(gamePills(ui._pillsHTMLForTest()).sort(), ['gN', 'gN2']), `[7d] the NFL pill: only NFL games (got ${JSON.stringify(gamePills(ui._pillsHTMLForTest()))})`);
  ui._setSportFilterForTest('cfb');
  assert(eq(gamePills(ui._pillsHTMLForTest()), ['gC']), `[7d] the CFB pill: only CFB games (got ${JSON.stringify(gamePills(ui._pillsHTMLForTest()))})`);
  assert(/aria-checked="true" aria-label="CFB[^"]*selected"/.test(ui._pillsHTMLForTest()), '[7d] …and the selected pill is marked');
  // DI-530 ORDER (W-57 Part 2, 2026-10-08): in a multi-sport league the game pills run LIVE FIRST, then by kickoff (soonest first; no kickoff last) — not by who spoke last. A scheduled game that kicks off
  // EARLIER than a live one still comes after it. (A one-sport league keeps its activity order: [8f]'s golden.)
  ui._setSportFilterForTest('all');
  storage.saveGame({ gameId: 'gE', weekId: 'w_cfb', homeTeam: 'Purdue', awayTeam: 'Indiana', status: 'scheduled', kickoff: '2026-10-02T12:00:00.000Z' });
  chat.ingest([m('t3', { gameTag: 'gE', sportTag: 'cfb' })]);
  assert(eq(gamePills(ui._pillsHTMLForTest()), ['gC', 'gN', 'gE', 'gN2']),
    `[7d3] DI-530: live games first (by kickoff: CFB 10-03 then NFL 10-05), then the scheduled ones by kickoff (the 10-02 game after both live ones, then 10-05 evening) — got ${JSON.stringify(gamePills(ui._pillsHTMLForTest()))}`);
  ui._setSportFilterForTest('cfb');
  assert(eq(gamePills(ui._pillsHTMLForTest()), ['gC', 'gE']), `[7d3] …and the order holds inside a sport pill (got ${JSON.stringify(gamePills(ui._pillsHTMLForTest()))})`);
  ui._setSportFilterForTest('all');
  // N6 (DI-530, 2026-10-08): in a multi-sport league a game pill reads `{code} · {away} @ {home}` (the house abbreviations); the sport is no longer a guess from two team names.
  ui._setSportFilterForTest('all');
  const labels = Object.fromEntries([...ui._pillsHTMLForTest().matchAll(/data-chat-filter="(g[A-Za-z0-9]+)">\s*(?:<span class="live-pulse"><\/span>)?([^<]*?)\s*(?:<span class="chat-unread-dot">[^<]*<\/span>)?\s*<\/button>/g)].map((x) => [x[1], x[2].trim()]));
  assert(labels.gN === 'NFL · DETR @ GB' && labels.gC === 'CFB · OSU @ MICH', `[7d2] N6: game pills are labelled "{code} · {away} @ {home}" in a multi-sport league (got ${JSON.stringify(labels)})`);
  // ESCAPE REGRESSION GUARD (reviewer note 1, W-57 Part 2): team names are DATA (ESPN, or a commissioner's hand), and the multi-sport label now strings two of them with the sport code. The house
  // abbreviation map shortens a name to a few characters, but it keeps the characters that matter ('<script>alert(2)</script>' abbreviates to '<SCR'; a leading quote or angle survives too), so a hostile name
  // still puts markup-significant characters into the label. They must render inert in the multi-sport pill and in the thread sheet's header lead, with a non-vacuity check that the same label IS markup the
  // moment it is not escaped.
  {
    const evilTeam = '"><img src=x onerror=alert(1)>';
    storage.saveGame({ gameId: 'gH', weekId: 'w_nfl', homeTeam: '"><b>Boom</b>', awayTeam: '<script>alert(2)</script>', status: 'live', kickoff: '2026-10-05T18:00:00.000Z' });
    chat.ingest([m('t4', { gameTag: 'gH', sportTag: 'nfl' })]);
    const raw = ui._gamePillLabelForTest('gH');
    const html = ui._pillsHTMLForTest();
    const pill = (html.match(/<button class="chat-pill chat-pill-live" data-chat-filter="gH">[\s\S]*?<\/button>/) || [''])[0];
    assert(/^NFL · /.test(raw) && raw.includes('<script>alert(2)</script>') && raw.includes('"><b>Boom</b>'), `[7d4] NON-VACUITY: the hostile names REACH the label with their markup intact (raw label ${JSON.stringify(raw)}) — so the inert page below is the escaping, not the fixture`);
    assert(/<script>alert\(2\)<\/script>/.test('<button>' + raw + '</button>') && /"><b>/.test('<button class="' + raw + '">'), '[7d4] NON-VACUITY: that raw label dropped into text WOULD be a live <script> and, dropped into an attribute, WOULD break out of it (an unescaped interpolation is exactly this defect)');
    assert(pill && !/<script|<b>/i.test(pill) && pill.includes('&lt;script&gt;alert(2)&lt;/script&gt;') && pill.includes('&quot;&gt;&lt;b&gt;Boom&lt;/b&gt;') && (pill.match(/<button/g) || []).length === 1 && (pill.match(/<\/button>/g) || []).length === 1,
      `[7d4] the multi-sport game pill renders the hostile team names INERT: escaped text, no live tag, the quote break is &quot;-escaped, one well-formed button (${JSON.stringify(pill.replace(/\s+/g, ' '))})`);
    void evilTeam;
  }

  // (d) the composer rule: a plain Locker Room message is NEVER tagged; a thread message carries ITS game's sport
  ui._setSportFilterForTest('nfl');
  assert(ui._currentComposerSportTagForTest('') === '' && ui._currentComposerSportTagForTest(null) === '', '[7e] a plain Locker Room message is untagged — even with the NFL pill selected (a viewer\'s filter never tags what they send)');
  assert(ui._currentComposerSportTagForTest('gC') === 'cfb' && ui._currentComposerSportTagForTest('gN') === 'nfl', '[7e] a thread message carries its GAME\'s sport (read from the game\'s week\'s competition) — a CFB game under the NFL pill is still \'cfb\'');
  assert(ui._currentComposerSportTagForTest('g_removed') === '' && ui._currentComposerSportTagForTest('sport:nfl') === '', '[7e] a game that does not resolve (or a forged tag-shaped gameTag) is untagged');
  const cuSrc = stripComments(read('js/chat-ui.js'));
  const fnBody = (name) => { const i = cuSrc.indexOf(`function ${name}(`); return cuSrc.slice(i, cuSrc.indexOf('\n}\n', i)); };
  assert(!/U\.sportFilter|currentSportFilter|getActiveSportKey|activeSport/.test(fnBody('currentComposerSportTag')), '[7e] currentComposerSportTag() reads neither the selected pill nor any sport pointer — the one rule, in one place');
  assert((cuSrc.match(/sportTag: currentComposerSportTag\(/g) || []).length === 3, '[7e] ALL THREE player send paths (the room composer, the game sheet composer and the 📎 callout) send through it');
  // The callout, driven through the REAL shared wiring (bindMessageActionButtons) with a host that holds one [data-callout] button: a callout on an NFL thread message is an NFL thread message.
  {
    const clicks = [];
    const host = { querySelectorAll: (sel) => (sel === '[data-callout]' ? [{ dataset: { callout: 'c_target' }, addEventListener: (t, fn) => { if (t === 'click') clicks.push(fn); } }] : []) };
    const fire = (gameTag) => {
      seq += 10; chat._resetForTest();
      chat.ingest([m('c_target', { gameTag, author: 'mKevin', body: 'we will cover easily' })]);
      clicks.length = 0;
      ui._bindMessageActionButtons(host, () => {}, 'main');
      clicks[0]();
      return chat.getMessages({ tag: 'all' }).find((x) => x.body === 'Prior statement, for the record:');
    };
    const onNfl = fire('gN'), onCfb = fire('gC'), onPlain = fire('');
    assert(onNfl && onNfl.gameTag === 'gN' && onNfl.sportTag === 'nfl' && onCfb && onCfb.sportTag === 'cfb', '[7e] R3: a callout quoting an NFL thread message is tagged nfl (a CFB one cfb) — it files under its game\'s pill like every other thread message');
    assert(onPlain && !('sportTag' in onPlain) && onPlain.gameTag === '', '[7e] R3: a callout on a plain Locker Room message carries no tag');
  }

  // (e) system rows carry their week's / game's sport — EVERY stamped emitter, in a league where both weeks are PUBLIC (live), so the reveal, the game final and the Extra Point post for real
  const publicWeeks = (opts) => {
    seedLeague(opts);
    for (const id of ['w_cfb', ...(opts.nfl ? ['w_nfl'] : [])]) storage.saveWeek({ ...storage.getWeek(id), status: 'live' });
    chat._resetForTest();
    const wk = (id) => storage.getWeek(id), gm = (w, id) => storage.getGames(w).find((g) => g.gameId === id);
    return { cw: wk('w_cfb'), nw: opts.nfl ? wk('w_nfl') : null, gC: gm('w_cfb', 'gC'), gN: opts.nfl ? gm('w_nfl', 'gN') : null };
  };
  const emitAll = (F) => {
    const go = (week, game) => {
      ui.emitPicksLockedEvent(week.weekId, 'mKevin', 3, 6);
      ui.emitPickRevealEvent(week);
      ui.emitKickoffEvent(game);
      ui.emitGameFinalEvent(game, game.homeTeam, [], []);
      ui.emitExtraPointEvent(week.weekId, { rows: [], actual: 40, allBusted: false });
      ui.emitWeekFinalEvent(week, [{ rank: 1, playerId: 'mKevin', correctPicks: 5 }]);
    };
    go(F.cw, F.gC); if (F.nw) go(F.nw, F.gN);
  };
  const kinds = (w, g) => [['lock', `sys_lock_${w}_mKevin`], ['reveal', `sys_reveal_${w}`], ['kickoff', `sys_kick_${g}`], ['final', `sys_final_${g}`], ['extra point', `sys_ep_${w}`], ['week final', `sys_weekfinal_${w}`]];
  {
    const F = publicWeeks({ nfl: true });
    emitAll(F);
    for (const [kind, id] of kinds('w_nfl', 'gN')) assert(chat.getMessage(id) && chat.getMessage(id).sportTag === 'nfl', `[7f] the ${kind} post of the NFL week (${id}) carries sportTag nfl`);
    for (const [kind, id] of kinds('w_cfb', 'gC')) assert(chat.getMessage(id) && chat.getMessage(id).sportTag === 'cfb', `[7f] the ${kind} post of the CFB week (${id}) carries sportTag cfb`);
    const ctx = ui._chatSportCtxForTest();
    assert(chat.appearsUnderSport(chat.getMessage('sys_reveal_w_nfl'), 'nfl', ctx) && !chat.appearsUnderSport(chat.getMessage('sys_reveal_w_nfl'), 'cfb', ctx)
      && chat.appearsUnderSport(chat.getMessage('sys_ep_w_nfl'), 'nfl', ctx) && !chat.appearsUnderSport(chat.getMessage('sys_ep_w_nfl'), 'cfb', ctx), '[7f] …and the reveal and the Extra Point file under their own sport\'s pill only');
    assert(eq(ui._systemSportFieldsForTest({ weekId: 'w_nfl' }), { sportTag: 'nfl' }) && eq(ui._systemSportFieldsForTest({ weekId: 'nope' }), {}) && eq(ui._systemSportFieldsForTest({}), {}), '[7f] systemSportFields: { sportTag } or {} — never a key it cannot fill');
    chat._resetForTest();
  }
  {
    // ONE sport: every emitter posts, none carries the key — in the folded item AND in the queued event (byte-identical to before the column was read)
    const F = publicWeeks({ nfl: false });
    emitAll(F);
    const queued = JSON.parse(localStorage.getItem('cfbp_chat_outbox2') || '[]');
    assert(queued.length === 6 && kinds('w_cfb', 'gC').every(([, id]) => chat.getMessage(id) && !('sportTag' in chat.getMessage(id))), '[7g] a ONE-sport league: all six emitters post, and no folded row has a sportTag key');
    assert(queued.every((e) => !('sportTag' in e)), '[7g] …and none of the six queued events has the key (byte-identical to before)');
    chat._resetForTest();
  }
  chat._resetForTest();
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[8] A target is never hidden; the filter is per account and per league; single-sport is byte-identical…');
{
  seedLeague({ nfl: true, nba: true });
  seq = 0;
  chat.ingest([m('plain'), m('cfbThread', { gameTag: 'gC', sportTag: 'cfb' }), m('nflThread', { gameTag: 'gN', sportTag: 'nfl' })]);
  // (a) a deep link / "Open in chat" to a message the selected pill would hide resets the filter to All
  ui._setSportFilterForTest('cfb');
  assert(ui.ensureChatTargetVisible({ messageId: 'nflThread' }) === true && ui._getSportFilterForTest() === 'all', '[8a] a push/link to an NFL thread message while CFB is selected resets the filter to All first');
  ui._setSportFilterForTest('cfb');
  assert(ui.ensureChatTargetVisible({ messageId: 'plain' }) === false && ui._getSportFilterForTest() === 'cfb', '[8a] …a target the pill DOES show leaves the filter alone');
  assert(ui.ensureChatTargetVisible({ messageId: 'cfbThread' }) === false && ui._getSportFilterForTest() === 'cfb', '[8a] …including the CFB thread itself');
  assert(ui.ensureChatTargetVisible({ messageId: 'not-in-the-fold-yet' }) === true && ui._getSportFilterForTest() === 'all', '[8a] a target not in the fold yet (it may land hidden) resets too');
  assert(ui.ensureChatTargetVisible({ messageId: 'nflThread' }) === false, '[8a] with `All` selected there is nothing to reset');
  // (b) a game THREAD of another sport opened by any caller resets the filter (the render path heals it)
  ui._setSportFilterForTest('cfb');
  ui._setChatFilterForTest('gN');
  assert(ui._getSportFilterForTest() === 'all', '[8b] opening an NFL game thread while CFB is selected resets the filter to All (a thread is never hidden behind a pill)');
  ui._setChatFilterForTest('all');
  ui._setSportFilterForTest('nfl'); ui._setChatFilterForTest('gN');
  assert(ui._getSportFilterForTest() === 'nfl', '[8b] …but an NFL thread under the NFL pill keeps it');
  ui._setChatFilterForTest('all');
  // (c) the tap handler: same pill = nothing; another sport's thread open = back to the Locker Room view
  ui._setSportFilterForTest('all');
  ui._onSportPillTapForTest('nfl');
  assert(ui._getSportFilterForTest() === 'nfl', '[8c] tapping a pill selects it');
  ui._onSportPillTapForTest('nfl');
  assert(ui._getSportFilterForTest() === 'nfl', '[8c] …tapping the selected pill again changes nothing');
  ui._onSportPillTapForTest('zzz');
  assert(ui._getSportFilterForTest() === 'all', '[8c] a value that is not a pill is `All`');
  ui._setSportFilterForTest('all'); ui._setChatFilterForTest('gC');
  ui._onSportPillTapForTest('nfl');
  const cuSrc = stripComments(read('js/chat-ui.js'));
  assert(ui._getSportFilterForTest() === 'nfl', '[8c] tapping NFL while a CFB thread is open selects NFL (the thread yields to the Locker Room view of the sport just chosen)');
  ui._setChatFilterForTest('all');
  assert(/function onSportPillTap\(value\) \{[\s\S]*?if \(next === currentSportFilter\(sports\)\) return;\s*haptic\('selection'\);/.test(cuSrc), '[8c] the selection haptic fires after the same-pill early return and before the state change');
  // (c2) D1 Game Day round (DI-588, 2026-10-08): a sport pill IS a chat filter pill, so a tap that changes the sport ends the Back chip exactly as a filter pill tap does (the app's onFilterChange hook);
  // a tap on the pill already selected changes nothing and leaves the chip alone. Driven through onSportPillTap, the one function a [data-chat-sport-filter] button's click listener calls.
  {
    let ended = 0;
    ui.registerChatReturnHooks({ onFilterChange: () => { ended += 1; } });
    ui._setSportFilterForTest('all'); ui._setChatFilterForTest('all');
    ui._onSportPillTapForTest('nfl');
    assert(ended === 1 && ui._getSportFilterForTest() === 'nfl', '[8c2] a sport pill tap that changes the sport ends the Back chip (onFilterChange once)');
    ui._onSportPillTapForTest('nfl');
    assert(ended === 1, '[8c2] …the pill already selected: no change, the chip stays');
    ui._onSportPillTapForTest('all');
    assert(ended === 2 && ui._getSportFilterForTest() === 'all', '[8c2] …and back to All ends it too');
    const hooksBody = (cuSrc.match(/function onSportPillTap\(value\) \{[\s\S]*?\n\}/) || [''])[0];
    assert(/haptic\('selection'\);\s*try \{ _returnHooks && typeof _returnHooks\.onFilterChange === 'function' && _returnHooks\.onFilterChange\(\); \} catch/.test(hooksBody), '[8c2] …the hook runs right after the haptic, before the state change, and a throwing hook is contained');
    ui.registerChatReturnHooks({ onFilterChange: () => { throw new Error('boom'); } });
    let threw = false;
    try { ui._onSportPillTapForTest('nfl'); } catch { threw = true; }
    assert(!threw && ui._getSportFilterForTest() === 'nfl', '[8c2] …a hook that throws never stops the pill');
    ui.registerChatReturnHooks(null);
    ui._setSportFilterForTest('all');
  }
  // (d) the filter belongs to an account AND a league (DI-538, security A5)
  ui._setSportFilterForTest('nfl');
  storage.setSession('mKevin', false, true);
  assert(ui._getSportFilterForTest() === 'all', '[8d] another ACCOUNT never inherits the selection');
  storage.setSession('mDrew', false, true);
  assert(ui._getSportFilterForTest() === 'all', '[8d] …and signing back in does not resurrect it (it was dropped, not parked)');
  ui._setSportFilterForTest('nfl');
  localStorage.setItem(ACTIVE_LEAGUE_KEY, 'L-OTHER');
  assert(ui._getSportFilterForTest() === 'all', '[8d] another LEAGUE never inherits the selection');
  localStorage.setItem(ACTIVE_LEAGUE_KEY, 'L-IRB');
  // (d2) N3: ANY sign-in starts at `All` — the SAME account signing out and straight back in is a new sign-in, so the identity epoch moves and the old selection is not carried over
  seedLeague({ nfl: true });
  ui._setSportFilterForTest('nfl');
  assert(ui._getSportFilterForTest() === 'nfl', '[8d2] fixture: NFL is selected for member mDrew in league L-IRB');
  const epoch0 = auth.getIdentityEpoch();
  await auth.signOut();
  assert(auth.getIdentityEpoch() > epoch0, '[8d2] fixture: signOut() moved the identity epoch (the real bump, not a stand-in)');
  seedLeague({ nfl: true, keepFilter: true });          // the device sweep cleared the seed: the SAME league, the SAME member, signed straight back in — and the page's own state untouched
  assert(ui._getSportFilterForTest() === 'all', '[8d2] N3: after sign-out → sign-in as the SAME account in the SAME league the pill is back at All (it was dropped by the identity change, not carried across it)');
  ui._setSportFilterForTest('nfl');
  assert(ui._getSportFilterForTest() === 'nfl', '[8d2] …and a selection made AFTER that sign-in holds (the reset is the sign-in, not every read)');
  ui._setSportFilterForTest('all');

  // (e) a sport that stops being offered
  ui._setSportFilterForTest('nfl');
  storage.saveCompetition(comp('nfl', { archivedAt: '2026-10-08T00:00:00.000Z' }));
  assert(ui._getSportFilterForTest() === 'all' && eq(ui._lockerRoomSportListForTest(), []), '[8e] archiving the selected sport (the league back to one live sport) drops the filter and the row');

  // (f) SINGLE-SPORT BYTE-IDENTITY against the pre-D1 tree's own output (golden captured from 0ae9a21d with the same fixture)
  localStorage.clear();
  localStorage.setItem(ACTIVE_LEAGUE_KEY, 'L-IRB');
  storage.setSession('mDrew', false, true);
  storage.saveWeek({ weekId: 'w1', weekNumber: 1, status: 'open', startDate: '2026-10-01', endDate: '2026-10-05', label: 'Week 1' });
  storage.saveGame({ gameId: 'g1', weekId: 'w1', homeTeam: 'Michigan', awayTeam: 'Ohio State', status: 'live', kickoff: '2026-10-03T16:00:00.000Z' });
  storage.saveGame({ gameId: 'g2', weekId: 'w1', homeTeam: 'Texas', awayTeam: 'Oklahoma', status: 'scheduled', kickoff: '2026-10-03T19:00:00.000Z' });
  chat._resetForTest(); ui._setSportFilterForTest('all'); ui._setChatFilterForTest('all');
  chat.ingest([
    { id: 'a1', seq: 1, ts: 1_700_000_000_001, type: 'message', author: 'mKevin', body: 'hello', notify: true, gameTag: '' },
    { id: 'a2', seq: 2, ts: 1_700_000_000_002, type: 'message', author: 'mKevin', body: 'thread', notify: true, gameTag: 'g1' },
    { id: 'a3', seq: 3, ts: 1_700_000_000_003, type: 'message', author: 'mBrayden', body: 'g2', notify: true, gameTag: 'g2' },
  ]);
  const GOLDEN = `<div class="chat-pills-scroll">
    <button class="chat-pill active" data-chat-filter="all">Locker Room <span class="chat-unread-dot">3</span></button>
    <button class="chat-pill" data-chat-filter="records" title="Hall of Records">🏛 Records</button><button class="chat-pill" data-chat-filter="g2">
      OU/TEX <span class="chat-unread-dot">1</span></button><button class="chat-pill chat-pill-live" data-chat-filter="g1">
      <span class="live-pulse"></span>OSU/MICH <span class="chat-unread-dot">1</span></button></div>`;
  assert(ui._pillsHTMLForTest() === GOLDEN, '[8f] BYTE-IDENTITY: with no competitions (pre-backfill) the pill row is exactly what the pre-D1 tree rendered');
  storage.saveCompetition(comp('cfb'));
  assert(ui._pillsHTMLForTest() === GOLDEN, '[8f] …and with ONE competition (a backfilled one-sport league) too');
  // one-sport events: every system emitter and both composers leave NO sportTag key
  ui.emitKickoffEvent({ gameId: 'g1', weekId: 'w1', awayTeam: 'Ohio State', homeTeam: 'Michigan', spread: -3, favorite: 'home' });
  ui.emitPicksLockedEvent('w1', 'mKevin', 3, 6);
  assert(!('sportTag' in chat.getMessage('sys_kick_g1')) && !('sportTag' in chat.getMessage('sys_lock_w1_mKevin')), '[8g] a one-sport league\'s system rows have no sportTag key');
  const queued = JSON.parse(localStorage.getItem('cfbp_chat_outbox2') || '[]');
  assert(queued.length === 2 && queued.every((e) => !('sportTag' in e)), '[8g] …and neither do the queued events (byte-identical to before)');
  assert(ui._currentComposerSportTagForTest('g1') === '' && eq(ui._systemSportFieldsForTest({ weekId: 'w1' }), {}), '[8g] …and neither composer nor stamp would add one');
  chat._resetForTest();
}

console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.stdout.write('', () => process.exit(fail === 0 ? 0 : 1));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 3000).unref();
