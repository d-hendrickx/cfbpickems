/**
 * CFB Pickems — sharetest.mjs (Deployment 1, Lane B, DI-597 / PF-454: "Share to chat", one contextual message — 2026-10-08)
 * =====================================================================================================================
 * DI-597's verification list, run against the REAL modules (js/chat-share.js pure; js/chat.js + js/chat-ui.js + js/app.js over the real index.html in minidom, local mode):
 *
 *   [1] THE REFERENCE GATE    validShareRef: the closed type set, a bounded plain-charset id, exactly two own keys — everything else (extra keys, prototypes, odd ids) is null
 *   [2] THE BODY              complete without the reference ("comment — headline"; an older client shows exactly that); the comment is plain, folded, <= 200; the headline one line, bounded
 *   [3] THE META              `{ ref: { type, id } }` and nothing else — no key migration 0045 reserves on the player path (sources, trigger, source, occasion, kind)
 *   [4] ONE MESSAGE           postShareToChat: one player message with a uuid id (never sys_ / scribe_ / pin_), the member as author, the game tag for a game; a second Post of the same thing in the same
 *                             place within 10 minutes is "You already shared this" and sends nothing; a double tap on the sheet's Post makes ONE message; a failing send keeps the sheet with
 *                             "Couldn't share. Try again." and Retry, and creates nothing until the retry
 *   [5] THE READER            the attachment is fixed copy rebuilt from the reader's data: "Open details" only when the reference resolves for THIS reader; a forged reference (bad shape, extra text,
 *                             a hidden week's game) renders ONLY the unavailable line and no text from the forged data; the tap re-validates and opens the reader's own detail / game
 *   [6] NOTHING HIDDEN        a share's text is invariant under every pick and result change (it carries no pick); Share is not offered signed out or with chat off, and not for an item the sharer's
 *                             own gate refuses (a draft or demo week's game for a member)
 *   [7] MUTATION PROOFS       scratch copies (data: URLs) of js/chat-share.js and js/chat-ui.js, each turning a named check red
 *
 * Run:  node sharetest.mjs
 */
import { readFileSync } from 'node:fs';
import { MiniDocument } from './minidom.mjs';

let pass = 0, fail = 0;
const _log = console.log.bind(console), _err = console.error.bind(console);
const assert = (cond, label, extra = '') => { if (cond) { pass++; _log('  ✅', label); } else { fail++; _err('  ❌', label, extra ? `\n     ${extra}` : ''); } };
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear(), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; } };
globalThis.window = globalThis;
globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
globalThis.location = { origin: 'https://irbfootball.test', reload() {}, search: '', hash: '' };
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined }, configurable: true }); }
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.matchMedia = () => ({ matches: false });
globalThis.fetch = async () => { throw new Error('network disabled in sharetest'); };
globalThis.confirm = () => true; globalThis.prompt = () => null; globalThis.alert = () => {};
globalThis.scrollY = 0;
globalThis.scrollTo = () => {};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
let uuidThrows = 0;
const realUUID = globalThis.crypto && globalThis.crypto.randomUUID ? globalThis.crypto.randomUUID.bind(globalThis.crypto) : null;
try { Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: () => { if (uuidThrows > 0) { uuidThrows -= 1; throw new Error('the send failed (test)'); } return realUUID(); } }); } catch { /* a frozen crypto: the retry case reports itself */ }
const realWarn = console.warn, realInfo = console.info, realError = console.error;
const quiet = () => { console.warn = () => {}; console.info = () => {}; console.error = () => {}; };
const loud = () => { console.warn = realWarn; console.info = realInfo; console.error = realError; };

const INDEX = read('./index.html');
const bodyHtmlOf = (html) => html.slice(html.indexOf('<body'), html.indexOf('</body>')).replace(/<script[\s\S]*?<\/script>/g, '').replace(/^<body[^>]*>/, '');
const freshDoc = () => { const doc = new MiniDocument(); const m = INDEX.match(/<body[^>]*data-tab="([^"]*)"/); if (m) doc.body.dataset.tab = m[1]; doc.body.innerHTML = bodyHtmlOf(INDEX); return doc; };
globalThis.document = freshDoc();

quiet();
const share = await import('./js/chat-share.js');
const app = await import('./js/app.js');
const storage = await import('./js/storage.js');
const chat = await import('./js/chat.js');
const chatUi = await import('./js/chat-ui.js');
const ps = await import('./js/pushed-screen.js');
const { calculateWeeklyResults } = await import('./js/scoring.js');
const fx = await import('./statsfixtures.mjs');
loud();

function seed({ w2 = 'final' } = {}) {
  store.clear();
  const L = fx.buildLeague({ w2, calculateWeeklyResults });
  L.players.forEach((p) => storage.savePlayer({ ...p }));
  L.weeks.forEach((w) => storage.saveWeek(w));
  L.games.forEach((g) => storage.saveGame(g));
  storage.saveAllPicks(L.picks);
  storage.saveAllWeeklyResults('w1', L.weeklyResults.filter((r) => r.weekId === 'w1'));
  storage.saveAllWeeklyResults('w2', L.weeklyResults.filter((r) => r.weekId === 'w2'));
  storage.setSession('p1', false, true);
  try { chat._resetForTest(); } catch { /* the store starts empty */ }
  app._clearShareAvailMemoForTest();
  return L;
}
const reset = () => { try { ps.closeAllScreens('test'); } catch {} try { app._closeShareSheetForTest({ immediate: true }); } catch {} globalThis.document = freshDoc(); app._resetHomeWiringForTest(); app.state.currentTab = 'home'; app.state.viewingWeekId = null; globalThis.scrollY = 0; };
const go = (tab) => { quiet(); try { app._navigateToForTest(tab); } finally { loud(); } };
const tap = (n) => { quiet(); try { n.dispatchEvent({ type: 'click', target: n }); } finally { loud(); } };
const shares = () => chat.getMessages({ tag: 'all' }).filter((m) => m && m.type === 'message' && m.meta && m.meta.ref);
const openGameShare = (gid) => {
  reset(); go('home'); quiet(); app._openGameViewForTest(gid); loud();
  const b = document.getElementById('pushed-root')?.querySelector('.ps-level:last-child [data-gv-action="share"]');
  if (b) tap(b);
  return { btn: b, wrap: document.getElementById('share-sheet-wrap') };
};
const sheetBtn = (act) => document.getElementById('share-sheet-wrap')?.querySelector(`[data-share-action="${act}"]`) || null;

// ═══ [1] ═════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[1] The reference gate (validShareRef)…');
{
  const v = share.validShareRef;
  assert(['card', 'game', 'week', 'compare'].every((t) => JSON.stringify(v({ type: t, id: 'x1' })) === JSON.stringify({ type: t, id: 'x1' })), '1a: each of the four types, with a plain id, is a reference');
  const card = 'called.it:11111111-1111-4111-8111-111111111111:w2:22222222-2222-4222-8222-222222222222:g21';
  assert(JSON.stringify(v({ type: 'card', id: card })) === JSON.stringify({ type: 'card', id: card }), '1b: a real card id (type:league:week:member:suffix) passes');
  const bad = [
    null, undefined, 'game:g1', 5, [], ['game', 'g1'], {}, { type: 'game' }, { id: 'g1' }, { type: 'game', id: 'g1', title: 'Hi' }, { type: 'game', id: 'g1', html: '<b>' },
    { type: 'note', id: 'g1' }, { type: 'Game', id: 'g1' }, { type: 'game', id: '' }, { type: 'game', id: 7 }, { type: 'game', id: 'g 1' }, { type: 'game', id: '<img src=x onerror=alert(1)>' },
    { type: 'game', id: 'g"1' }, { type: 'game', id: 'é1' }, { type: 'game', id: '-g1' }, { type: 'game', id: ':g1' }, { type: 'game', id: 'x'.repeat(201) }, { type: 'game', id: '__proto__' },
    { type: 'game', id: 'constructor' }, Object.assign(Object.create({ evil: 1 }), { type: 'game', id: 'g1' }), JSON.parse('{"type":"game","id":"g1","__proto__":{"x":1}}'),
  ];
  const leaked = bad.filter((b) => v(b) !== null);
  assert(leaked.length === 0, `1c: every malformed reference is null — a missing or EXTRA key, a non-plain object, an unknown type, an empty / long / odd-charset id, a prototype name (${bad.length} shapes; leaked: ${leaked.map((x) => JSON.stringify(x)).join(' | ') || 'none'})`);
  assert(v({ type: 'game', id: 'x'.repeat(200) }) !== null && v({ type: 'game', id: 'x'.repeat(201) }) === null, '1d: the id bound is exactly 200');
  const r = v({ type: 'game', id: 'g1' });
  assert(Object.keys(r).join() === 'type,id' && Object.getPrototypeOf(r) === Object.prototype, '1e: what comes back is a NEW plain object with exactly { type, id }');
}

// ═══ [2] ═════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[2] The body: complete without the reference…');
{
  const { cleanShareComment: c, shareLine: line, shareBody: body } = share;
  assert(c('  wow \n\t what\u0000 a game  ') === 'wow what a game' && c(null) === '' && c(5) === '' && c({}) === '', '2a: the comment is plain text: control characters and line separators become spaces, runs fold, ends trim, non-strings are empty');
  const long = 'é'.repeat(250);
  assert(Array.from(c(long)).length === 200 && Array.from(c('😀'.repeat(250))).length === 200 && !/\uD83D$/.test(c('😀'.repeat(250))), '2b: at most 200 characters, counted by code point (an emoji pair is never split)');
  assert(line({ eyebrow: 'Final · Oregon at Washington', title: 'Oregon 31, Washington 24 — Oregon covered by 4.' }) === 'Final · Oregon at Washington: Oregon 31, Washington 24 — Oregon covered by 4.', '2c: the headline is "{eyebrow}: {title}" (the approved frame\'s preview, as one line)');
  assert(line({ eyebrow: 'Picks revealed · Week 6' }) === 'Picks revealed · Week 6' && line({ eyebrow: 'a\nb', title: '' }) === 'a b' && Array.from(line({ eyebrow: 'x'.repeat(400) })).length === share.SHARE_LINE_MAX, '2d: …or the eyebrow alone; always ONE line, bounded (with an ellipsis)');
  assert(body('Told you', 'Final · Oregon at Washington') === 'Told you — Final · Oregon at Washington' && body('', 'Final · X at Y') === 'Final · X at Y' && body('  ', 'Final · X at Y') === 'Final · X at Y' && body('hi', '') === '', '2e: the body is "comment — headline", the headline alone with no comment, and nothing without a headline');
}

// ═══ [3] ═════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[3] The meta: the reference and nothing else…');
{
  const m = share.shareMeta({ type: 'game', id: 'g21' });
  assert(JSON.stringify(m) === '{"ref":{"type":"game","id":"g21"}}', `3a: shareMeta is exactly { ref: { type, id } } (${JSON.stringify(m)})`);
  const RESERVED = ['sources', 'trigger', 'source', 'occasion', 'kind', 'mentions', 'scribeReply', 'test', 'playerId', 'weekId', 'title'];
  assert(Object.keys(m).every((k) => !RESERVED.includes(k)) && share.shareMeta({ type: 'game', id: 'g21', kind: 'lifecycle' }) === null && share.shareMeta(null) === null, '3b: no key migration 0045 reserves on the player path (sources, trigger, source, occasion, kind) and none another reader keys on; an invalid reference gives no meta at all');
}

// ═══ [4] ═════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[4] One message…');
{
  seed();
  const ref = { type: 'game', id: 'g21' };
  const r1 = chatUi.postShareToChat({ ref, line: 'Final · Texas at Oklahoma', comment: 'called it', gameTag: 'g21' });
  const after1 = shares();
  const m1 = after1[0];
  assert(r1.ok === true && after1.length === 1 && !!m1 && m1.id === r1.id, `4a: a Post sends ONE message (${after1.length})`);
  assert(!!m1 && UUID_RE.test(m1.id) && !/^(sys_|scribe_|pin_)/.test(m1.id), `4b: its id is chat.js's uuid for a player event, never a sys_ / scribe_ / pin_ id (0045 refuses those on the player path) (${m1 && m1.id})`);
  assert(!!m1 && m1.type === 'message' && m1.author === 'p1' && m1.gameTag === 'g21' && m1.body === 'called it — Final · Texas at Oklahoma' && JSON.stringify(m1.meta) === '{"ref":{"type":"game","id":"g21"}}' && m1.notify === true, `4c: the member's own message, in the game's thread (gameTag), the body complete on its own, meta only the reference (${m1 && JSON.stringify({ a: m1.author, t: m1.gameTag, b: m1.body, meta: m1.meta })})`);
  const r2 = chatUi.postShareToChat({ ref, line: 'Final · Texas at Oklahoma', comment: 'again', gameTag: 'g21' });
  assert(r2.ok === false && r2.reason === 'duplicate' && r2.id === m1.id && shares().length === 1, '4d: the same reference in the same place again within 10 minutes: "duplicate", the first message\'s id, NOTHING sent');
  const r3 = chatUi.postShareToChat({ ref, line: 'Final · Texas at Oklahoma', gameTag: '' });
  assert(r3.ok === true && shares().length === 2, '4e: the same item in ANOTHER place (the Locker Room, untagged) is a new share');
  const nBefore = chat.getMessages({ tag: 'all' }).length;
  const bads = [chatUi.postShareToChat({ ref: { type: 'note', id: 'g21' }, line: 'x' }), chatUi.postShareToChat({ ref, line: '' }), chatUi.postShareToChat({ ref: { type: 'game', id: 'g21', html: '<b>' }, line: 'x' })];
  assert(bads.every((b) => b.ok === false && b.reason === 'invalid') && chat.getMessages({ tag: 'all' }).length === nBefore, '4f: an invalid reference or an empty headline sends nothing');
  storage.setSession(null, false, false);
  const so = chatUi.postShareToChat({ ref: { type: 'game', id: 'g22' }, line: 'x' });
  storage.setSession('p1', false, true);
  storage.saveSettings({ ...storage.getSettings(), chatEnabled: false });
  const off = chatUi.postShareToChat({ ref: { type: 'game', id: 'g22' }, line: 'x' });
  storage.saveSettings({ ...storage.getSettings(), chatEnabled: true });
  assert(so.ok === false && off.ok === false && chat.getMessages({ tag: 'all' }).length === nBefore, '4g: signed out, or with chat off, nothing is sent');
  // the sheet: a double tap on Post makes ONE message
  seed();
  const g1 = openGameShare('g21');
  assert(!!g1.btn && !!g1.wrap && !!sheetBtn('post'), '4h: (fixture) the Game view\'s "Share to chat" opens the sheet with "Post to chat"');
  {
    const NG = await import('./js/nav-gestures.js');
    quiet(); try { ps.closeAllScreens('test'); } catch {} loud();
    const up = NG.gesturesSuspended();
    assert(!!document.getElementById('share-sheet-wrap') && !ps.isScreenOpen() && up === true, '4h-2: while the Share sheet is up the page\'s gestures stand down (week swipe, pull to refresh) even with no pushed screen beneath it');
  }
  const post = sheetBtn('post');
  if (post) { tap(post); const again = sheetBtn('post'); if (again) tap(again); tap(post); }
  await wait(600);   // the sheet plays its slide out (DISMISS_SLIDE_FALLBACK_MS, 420 ms, without a transitionend in minidom)
  assert(shares().length === 1 && !document.getElementById('share-sheet-wrap') && app._shareSheetStateForTest() === null, `4i: a double tap on Post makes ONE message and the sheet closes (${shares().length})`);
  // reopening it: "You already shared this", View in chat, no Post
  const g2 = openGameShare('g21');
  assert(!!g2.wrap && app._shareSheetStateForTest()?.status === 'duplicate' && !sheetBtn('post') && !!sheetBtn('view') && /You already shared this\./.test(g2.wrap.innerHTML), '4j: opening it again within 10 minutes says "You already shared this." with "View in chat" and no Post');
  const viewBtn = sheetBtn('view');
  if (viewBtn) tap(viewBtn);
  await wait(ps.EXIT_FALLBACK_MS + 100);
  assert(!document.getElementById('share-sheet-wrap') && app.state.currentTab === 'chat' && !ps.isScreenOpen(), '4k: …and "View in chat" closes the sheet and the screens and opens Chat on it');
  // a failing send: the sheet stays with the error and Retry; no message until the retry
  seed();
  openGameShare('g22');
  uuidThrows = 1;
  const p2 = sheetBtn('post');
  if (p2) tap(p2);
  const failedState = app._shareSheetStateForTest();
  const wrapF = document.getElementById('share-sheet-wrap');
  assert(!!wrapF && failedState && failedState.status === 'failed' && /Couldn't share\. Try again\./.test(wrapF.innerHTML) && sheetBtn('post')?.textContent.trim() === 'Retry' && shares().length === 0, `4l: a send that fails keeps the sheet open: "Couldn't share. Try again.", the button reads Retry, and NO message was created (${shares().length})`);
  const retry = sheetBtn('post');
  if (retry) tap(retry);
  await wait(600);
  assert(shares().length === 1 && app._shareSheetStateForTest() === null && !document.getElementById('share-sheet-wrap'), '4m: …and Retry posts exactly one, and the sheet closes');
  uuidThrows = 0;
  // Cancel: the sheet closes and focus goes back to the Share button that opened it (VoiceOver resumes there)
  seed(); reset(); go('home'); quiet(); app._openGameViewForTest('g22'); loud();
  const sb = document.getElementById('pushed-root')?.querySelector('.ps-level:last-child [data-gv-action="share"]');
  if (sb) { sb.focus(); tap(sb); }
  const cancel = sheetBtn('cancel');
  if (cancel) tap(cancel);
  await wait(600);
  assert(!!sb && !!cancel && !document.getElementById('share-sheet-wrap') && document.activeElement === sb && shares().length === 0, '4n: Cancel posts nothing, closes the sheet, and returns focus to the Share button');
}

// ═══ [5] ═════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[5] The reader: an attachment rebuilt from the reader\'s own data…');
{
  seed();
  const html = (m) => chatUi._messageHTMLForTest(m, 'p2', false);
  const UNAVAIL = /This item isn(?:'|&#39;|&#x27;)t available to you right now\./;   // (the copy is escaped at the sink like every string)
  const base = { id: 'u-1', type: 'message', author: 'p1', ts: Date.now(), body: 'look — Final · Texas at Oklahoma', gameTag: '', reactions: {} };
  const ok = html({ ...base, meta: { ref: { type: 'game', id: 'g21' } } });
  assert(/data-share-open="u-1"/.test(ok) && /Open details/.test(ok) && !UNAVAIL.test(ok), '5a: a reference that resolves for this reader: "Open details", and the button carries ONLY the message id');
  const FORGED = 'FORGED<script>alert(1)</script>TEXT';
  const forgedRows = [
    { ref: { type: 'game', id: 'g21', title: FORGED } },
    { ref: { type: 'note', id: 'g21' }, text: FORGED },
    { ref: FORGED },
    { ref: { type: 'game', id: FORGED } },
    { ref: { type: 'card', id: 'week.result:nope:w9:-' }, label: FORGED },
    { ref: { type: 'compare', id: 'p1-vs-p2' } },
  ];
  const outs = forgedRows.map((meta) => html({ ...base, meta }));
  assert(outs.every((o) => UNAVAIL.test(o) && !/data-share-open/.test(o) && !/FORGED/.test(o)), '5b: a forged reference — an extra text key, an unknown type, a non-object, an odd id, an item that is not there, a comparison nobody registered — renders ONLY the unavailable line, and no text from the forged data');
  const esc = html({ ...base, body: '<img src=x onerror=alert(1)>', meta: { ref: { type: 'game', id: 'g21' } } });
  assert(!/<img/.test(esc) && /&lt;img/.test(esc), '5c: the body is escaped like any message (Std-9)');
  assert(html({ ...base, meta: null }).indexOf('chat-share-attach') === -1 && html({ ...base, meta: { mentions: [] } }).indexOf('chat-share-attach') === -1, '5d: a message without a reference has no attachment');
  // a demo week's game: the reader (a member) may not see it, so its share reads unavailable — and the sharer could not have offered it
  const demo = { weekId: 'w_demo_x', weekNumber: 0, season: '2026', status: 'live', dataSourceMode: 'demo', createdAt: new Date(Date.now() - 86400e3).toISOString() };
  storage.saveWeek(demo);
  storage.saveGame({ ...storage.getGames('w2')[0], gameId: 'gdemo', weekId: 'w_demo_x' });
  app._clearShareAvailMemoForTest();
  const dm = html({ ...base, meta: { ref: { type: 'game', id: 'gdemo' } } });
  assert(UNAVAIL.test(dm) && !/data-share-open/.test(dm) && app._shareRefAvailableForTest({ type: 'game', id: 'gdemo' }) === false, '5e: a game in a DEMO week is not available to a member (UN-71): the unavailable line');
  const draft = storage.getWeeks().find((w) => w.weekId === 'w2');
  storage.saveWeek({ ...draft, status: 'draft' });
  app._clearShareAvailMemoForTest();
  assert(app._shareRefAvailableForTest({ type: 'game', id: 'g21' }) === false && app._shareRefAvailableForTest({ type: 'week', id: 'w2' }) === false, '5f: …nor a game or week of a DRAFT week');
  seed();
  // the tap opens the reader's OWN view of it: a game -> its Game view over Chat; a card -> its detail
  reset(); go('chat');
  const mid = chatUi.postShareToChat({ ref: { type: 'game', id: 'g24' }, line: 'Final · X at Y' }).id;
  storage.setSession('p2', false, true);
  reset(); go('chat');
  const attach = document.getElementById('page-chat')?.querySelector(`[data-share-open="${mid}"]`);
  if (attach) tap(attach);
  await wait(10);
  assert(!!attach && ps.isScreenOpen() && ps.topScreenId() === 'game:g24', `5g: another member taps "Open details": the game opens as a Game view over Chat (${ps.topScreenId()})`);
  reset();
  const wr = (() => { reset(); go('home'); return document.querySelectorAll('#home-root [data-home-action="open-card"]').map((n) => n.getAttribute('data-card-id')).find((i) => i.startsWith('week.result:')); })();
  storage.setSession('p1', false, true);
  const cmid = chatUi.postShareToChat({ ref: { type: 'card', id: wr }, line: 'Week 2' }).id;
  storage.setSession('p2', false, true);
  reset(); go('chat');
  const cAttach = document.getElementById('page-chat')?.querySelector(`[data-share-open="${cmid}"]`);
  if (cAttach) tap(cAttach);
  await wait(10);
  assert(!!cAttach && ps.topScreenId() === `card:${wr}`, `5h: …and a card opens as ITS detail for this reader (${ps.topScreenId()})`);
  reset();
  // a tampered attachment (the DOM carries only an id): another message's id, or a forged one, opens nothing it should not
  const plain = chat.getMessages({ tag: 'all' }).length;
  void plain;
  const fake = document.createElement('button'); fake.setAttribute('data-share-open', 'no-such-message');
  storage.setSession('p2', false, true);
  reset(); go('chat');
  const host = document.getElementById('page-chat');
  const any = host?.querySelector('[data-share-open]');
  if (any) { any.setAttribute('data-share-open', 'no-such-message'); tap(any); }
  await wait(10);
  assert(!!any && !ps.isScreenOpen(), '5i: an attachment whose id is not a message in the store opens nothing (the store, not the DOM, says what it refers to)');
  reset();
  // the gate is asked again AT THE TAP: drawn while the game was visible, then its week becomes a draft before the tap — the tap opens nothing
  seed();
  storage.setSession('p1', false, true);
  const lateId = chatUi.postShareToChat({ ref: { type: 'game', id: 'g23' }, line: 'Final · X at Y' }).id;
  storage.setSession('p2', false, true);
  reset(); go('chat');
  const lateBtn = document.getElementById('page-chat')?.querySelector(`[data-share-open="${lateId}"]`);
  const wk = storage.getWeeks().find((w) => w.weekId === 'w2');
  storage.saveWeek({ ...wk, status: 'draft' });
  if (lateBtn) tap(lateBtn);
  await wait(10);
  assert(!!lateBtn && !ps.isScreenOpen(), '5j: an attachment drawn while the item was visible opens NOTHING once the item stops being visible to this reader (the gate is asked again at the tap, not trusted from the paint)');
  storage.saveWeek(wk);
  reset();
}

// ═══ [5b] ════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[5b] Security F-1 (availability): a room of shared messages costs ONE derivation per paint, and the next paint reads again…');
{
  seed();
  storage.setSession('p1', false, true);
  reset(); go('home');
  const cardIdsHere = document.querySelectorAll('#home-root [data-home-action="open-card"]').map((n) => n.getAttribute('data-card-id'));
  const games = storage.getGames('w2').map((g) => g.gameId).concat(storage.getGames('w1').map((g) => g.gameId));
  // Pass 3, N4 (review: probe P6): twenty COMPARISONS in the same room, half of them forged - a member who does not exist, a sport named in a one-sport league, the shapes an attacker would try. Each is
  // well-formed (validShareRef passes it), so every one reaches the resolver, which answers from Standings' own readers inside the pass's one read. Ten go BEFORE the other shares and ten after, so a
  // resolver that re-read per comparison would show up as extra reads.
  const VALID = ['p1:p3', 'p3:p4', 'p1:p2', 'p4:p5', 'p5:p6', 'p2:p6', 'p3:p1', 'p6:p4', 'p2:p5', 'p4:p1'];
  const FORGED = ['p1:p9', 'p9:p8', 'p1:p2:11111111-1111-4111-8111-111111111111', 'p7:p1', 'px:py', 'p1:zz', 'p2:p0', 'q1:q2', 'p3:p77', 'nobody:p1'];
  const postCompares = (from) => { for (let i = from; i < from + 10; i++) { const ref = { type: 'compare', id: i % 2 ? VALID[i >> 1] : FORGED[i >> 1] }; quiet(); chat.sendEvent({ type: 'message', author: 'p1', body: `Compared ${i}`, notify: true, meta: { ref } }); loud(); } };
  postCompares(0);
  let n = 0;
  for (let i = 0; i < 50; i++) {
    const ref = i % 3 === 0 && cardIdsHere.length ? { type: 'card', id: cardIdsHere[i % cardIdsHere.length] } : i % 3 === 1 ? { type: 'game', id: games[i % games.length] } : { type: 'week', id: i % 2 ? 'w1' : 'w2' };
    // fifty DISTINCT messages (each in its own place, so the 10-minute duplicate rule never folds two together)
    quiet(); const r = chatUi.postShareToChat({ ref, line: `Shared item ${i}` }); loud();
    if (r.ok) n++;
    else { quiet(); chat.sendEvent({ type: 'message', author: 'p1', body: `Shared item ${i}`, notify: true, meta: { ref } }); loud(); n++; }
  }
  postCompares(10);
  storage.setSession('p2', false, true);
  reset();
  await wait(5);                                            // whatever an earlier pass cached has ended with its task
  const hv = app._getHomeWiringForTest().homeView;
  const before = hv._freshSnapshotCountForTest();
  go('chat');
  const built = hv._freshSnapshotCountForTest() - before;
  const drawn = document.getElementById('page-chat').querySelectorAll('[data-share-open]').length;
  assert(n === 50 && drawn >= 40 && built <= 1, `5b-1: painting ${n} shared messages and 20 shared comparisons (${drawn} drawn with "Open details") built ${built} fresh read(s) — at most ONE per paint, never one per message`);
  const chatPg = document.getElementById('page-chat');
  const cmpMsgs = shares().filter((m) => m.meta.ref.type === 'compare');
  const opened = cmpMsgs.filter((m) => chatPg.querySelector(`[data-share-open="${m.id}"]`)).map((m) => m.meta.ref.id).sort();
  const refused = cmpMsgs.filter((m) => { const row = chatPg.querySelector(`[data-mid="${m.id}"]`); return !!row && !row.querySelector('[data-share-open]') && !!row.querySelector('.chat-share-attach--none'); }).map((m) => m.meta.ref.id).sort();
  assert(cmpMsgs.length === 20 && opened.join() === [...VALID].sort().join() && refused.join() === [...FORGED].sort().join(),
    `5b-1b: N4 - of the 20 comparisons, the 10 real pairs open and the 10 forged ids each read "not available" (opened ${opened.length}, refused ${refused.length}), all inside that ONE fresh read`);
  // the next paint (a later task) reads again: a game whose week turns draft between two paints reads unavailable on the next one
  const gid = storage.getGames('w2')[0].gameId;
  const wk = storage.getWeeks().find((w) => w.weekId === 'w2');
  const okBefore = app._shareRefAvailableForTest({ type: 'game', id: gid });
  storage.saveWeek({ ...wk, status: 'draft' });
  const sameTask = app._shareRefAvailableForTest({ type: 'game', id: gid });
  await wait(5);
  const nextPass = app._shareRefAvailableForTest({ type: 'game', id: gid });
  assert(okBefore === true && nextPass === false && app._shareRefAvailableNowForTest({ type: 'game', id: gid }) === false, `5b-2: the pass's answer lives only as long as its task — the next pass reads the draft week and says no (before ${okBefore}, same task ${sameTask}, next pass ${nextPass}); an ACTION always asks the exact question`);
  storage.saveWeek(wk);
  storage.setSession('p1', false, true);
  reset();
}

// ═══ [6] ═════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[6] Nothing hidden: a share carries no pick, and is offered only where the sharer may see the item…');
{
  // the Game view's share of a game in an OPEN week (picks hidden): its text is the same whatever anyone picked
  const openWeek = () => { seed(); const w = storage.getWeeks().find((x) => x.weekId === 'w2'); storage.saveWeek({ ...w, status: 'open', picksLockAt: new Date(Date.now() + 86400e3).toISOString() }); const g = storage.getGames('w2')[0]; storage.saveGame({ ...g, status: 'scheduled', homeScore: null, awayScore: null, kickoff: new Date(Date.now() + 2 * 86400e3).toISOString() }); return g.gameId; };
  const gid = openWeek();
  reset(); go('home');
  const hv = app._getHomeWiringForTest().homeView;
  const a = hv.resolveGameView(gid);
  const picks = storage.getPicks('w2');
  storage.saveAllPicks(picks.map((p) => (p.gameId === gid ? { ...p, selectedTeam: p.selectedTeam === storage.getGames('w2')[0].homeTeam ? storage.getGames('w2')[0].awayTeam : storage.getGames('w2')[0].homeTeam } : p)));
  reset(); go('home');
  const b = app._getHomeWiringForTest().homeView.resolveGameView(gid);
  storage.saveAllPicks([]);
  reset(); go('home');
  const c = app._getHomeWiringForTest().homeView.resolveGameView(gid);
  assert(!!a && !!a.share && JSON.stringify(a.share) === JSON.stringify(b.share) && JSON.stringify(a.share) === JSON.stringify(c.share) && !/Your pick|picked|•••/.test(a.share.line), `6a: a share's text is INVARIANT under every pick change (flipped, removed): it carries no pick ("${a && a.share && a.share.line}")`);
  assert(!!a && /^Kickoff|^\w{3} \d|at /.test(a.share.eyebrow) && a.share.ref.type === 'game' && a.share.gameTag === gid, '6b: …an upcoming game shares its kickoff, its matchup and its line, tagged to its own thread');
  // a card's share: the detail title, week and matchup — invariant under results
  seed(); reset(); go('home');
  const wr = document.querySelectorAll('#home-root [data-home-action="open-card"]').map((n) => n.getAttribute('data-card-id')).find((i) => i.startsWith('week.result:'));
  const d1 = app._getHomeWiringForTest().homeView.resolveCardDetail(wr);
  storage.saveAllWeeklyResults('w2', storage.getWeeklyResults().filter((r) => r.weekId === 'w2').map((r) => ({ ...r, correctPicks: Number(r.correctPicks || 0) + 3, correctCount: Number(r.correctCount || 0) + 3, incorrectPicks: 0, incorrectCount: 0 })));   // every member's record changes; the card stays
  reset(); go('home');
  const d2 = app._getHomeWiringForTest().homeView.resolveCardDetail(wr);
  assert(!!d1 && !!d1.model.share && d1.model.share.line === 'Week 2' && JSON.stringify(d1.model.share) === JSON.stringify(d2 && d2.model.share), `6c: a card's share is its detail title (and week): "${d1 && d1.model.share && d1.model.share.line}" — no member's result, unchanged when every result changes`);
  // offered only to a signed-in member with chat on
  seed();
  storage.setSession(null, false, false);
  reset(); go('home');
  const signedOut = app._getHomeWiringForTest().homeView.resolveGameView('g21');
  storage.setSession('p1', false, true);
  storage.saveSettings({ ...storage.getSettings(), chatEnabled: false });
  reset(); go('home');
  const chatOff = app._getHomeWiringForTest().homeView.resolveGameView('g21');
  const dOff = app._getHomeWiringForTest().homeView.resolveCardDetail(wr);
  storage.saveSettings({ ...storage.getSettings(), chatEnabled: true });
  assert(!!signedOut && !signedOut.share && !/data-gv-action="share"/.test(signedOut.html) && !!chatOff && !chatOff.share && !/data-gv-action="share"/.test(chatOff.html) && (!dOff || !dOff.model.actions.some((x) => x.id === 'share')), '6d: signed out, or with chat off, there is no Share button (Game view and card detail)');
  // a forged share for an item the sharer's own gate refuses: the sheet does not open
  seed();
  const demo = { weekId: 'w_demo_y', weekNumber: 0, season: '2026', status: 'live', dataSourceMode: 'demo', createdAt: new Date(Date.now() - 86400e3).toISOString() };
  storage.saveWeek(demo);
  storage.saveGame({ ...storage.getGames('w2')[0], gameId: 'gdemo2', weekId: 'w_demo_y' });
  reset(); go('home');
  quiet(); app._openShareSheetForTest({ ref: { type: 'game', id: 'gdemo2' }, eyebrow: 'Final · A at B', title: '', gameTag: 'gdemo2', line: 'Final · A at B' }); loud();
  assert(!document.getElementById('share-sheet-wrap') && app._shareSheetStateForTest() === null, '6e: a share of an item the sharer may not see (a demo week\'s game for a member) never opens the sheet: the sharer\'s own gate is asked again at open');
  reset();
}

// ═══ [7] ═════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[7] MUTATION PROOFS — scratch copies of js/chat-share.js loaded as data: URLs (never the file)…');
{
  const SRC = read('./js/chat-share.js');
  const R = (a, b) => { if (SRC.split(a).length !== 2) throw new Error('mutation anchor must match exactly once: ' + a.slice(0, 70)); return SRC.replace(a, b); };
  const load = async (src) => import('data:text/javascript;base64,' + Buffer.from(src).toString('base64') + '#' + Math.random());
  const probe = (m) => ({
    extraKey: m.validShareRef({ type: 'game', id: 'g1', title: 'x' }) === null,
    badType: m.validShareRef({ type: 'note', id: 'g1' }) === null,
    badId: m.validShareRef({ type: 'game', id: '<b>' }) === null && m.validShareRef({ type: 'game', id: 'x'.repeat(201) }) === null,
    proto: m.validShareRef(Object.assign(Object.create({ a: 1 }), { type: 'game', id: 'g1' })) === null,
    metaOnly: JSON.stringify(m.shareMeta({ type: 'game', id: 'g1' })) === '{"ref":{"type":"game","id":"g1"}}',
    bodyComplete: m.shareBody('hi', 'Final · A at B') === 'hi — Final · A at B',
    commentCap: Array.from(m.cleanShareComment('x'.repeat(300))).length === 200,
    dedupe: !!m.findRecentShare([{ id: 'a', type: 'message', author: 'p1', gameTag: 'g1', ts: 1000, meta: { ref: { type: 'game', id: 'g1' } } }], { ref: { type: 'game', id: 'g1' }, gameTag: 'g1', author: 'p1', now: 2000 })
      && !m.findRecentShare([{ id: 'a', type: 'message', author: 'p1', gameTag: 'g1', ts: 1000, meta: { ref: { type: 'game', id: 'g1' } } }], { ref: { type: 'game', id: 'g1' }, gameTag: 'g1', author: 'p1', now: 1000 + 11 * 60 * 1000 })
      && !m.findRecentShare([{ id: 'a', type: 'message', author: 'p2', gameTag: 'g1', ts: 1000, meta: { ref: { type: 'game', id: 'g1' } } }], { ref: { type: 'game', id: 'g1' }, gameTag: 'g1', author: 'p1', now: 2000 }),
  });
  const mutants = [
    ['an extra key is let through', R("if (keys.length !== 2 || !keys.includes('type') || !keys.includes('id')) return null;", "if (!keys.includes('type') || !keys.includes('id')) return null;"), 'extraKey'],
    ['the type is not a closed set', R("if (!isStr(type) || !SHARE_REF_TYPES.includes(type)) return null;", "if (!isStr(type)) return null;"), 'badType'],
    ['the id charset is gone', R("if (!isStr(id) || id.length > SHARE_ID_MAX || !SHARE_ID_RE.test(id)) return null;", "if (!isStr(id) || !id) return null;"), 'badId'],
    ['a non-plain object is accepted', R("  if (Object.getPrototypeOf(ref) !== Object.prototype && Object.getPrototypeOf(ref) !== null) return null;\n", ''), 'proto'],
    ['the meta carries the whole reference object (any key the poster sent)', R("return r ? { ref: { type: r.type, id: r.id } } : null;", "return r ? { ref, kind: 'share' } : null;"), 'metaOnly'],
    ['the body drops the headline (an older client sees only the comment)', R("return c ? `${c} — ${l}` : l;", "return c || l;"), 'bodyComplete'],
    ['the comment is not capped', R("return cps.length > SHARE_COMMENT_MAX ? cps.slice(0, SHARE_COMMENT_MAX).join('').trimEnd() : flat;", "return flat;"), 'commentCap'],
    ['the duplicate check ignores the window and the author', R("    if (!(now - ts <= windowMs)) continue;\n", ''), 'dedupe'],
  ];
  const base = probe(share);
  assert(Object.values(base).every(Boolean), `7-0: the probe is GREEN on the real chat-share.js (${Object.entries(base).filter(([, v]) => !v).map(([k]) => k).join(', ') || 'all pass'})`);
  for (const [name, src, check] of mutants) {
    let res;
    try { res = probe(await load(src)); } catch (e) { res = { [check]: 'ERR ' + e.message }; }
    assert(res[check] === false, `7: mutant "${name}" turns ${check} RED${typeof res[check] === 'string' ? ' (' + res[check] + ')' : ''}`);
  }
  // chat-ui's reader side: the attachment must not render from the reference without the resolver's yes, and the post must not pass an id of its own
  const UI = read('./js/chat-ui.js');
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');
  const post = (strip(UI).match(/export function postShareToChat\([\s\S]*?\n\}/) || [''])[0];
  assert(/sendEvent\(\{ type: 'message', author: self, body, gameTag: tag, \.\.\.\(sportTag \? \{ sportTag \} : \{\}\), notify: true, meta \}\)/.test(post) && !/[{,]\s*id\s*:/.test((post.match(/sendEvent\(\{[\s\S]*?\}\);/) || [''])[0].replace('sendEvent(', '')), '7-UI-1: postShareToChat sends a plain player message with NO id of its own (chat.js mints the uuid) and the validated meta');
  const att = (strip(UI).match(/function shareAttachHTML\([\s\S]*?\n\}/) || [''])[0];
  assert(/if \(ref && shareAvailable\(ref\)\)/.test(att) && !/m\.meta\.ref\.(?!type|id)/.test(att) && !/esc\(m\.meta/.test(att) && !/esc\(ref/.test(att), '7-UI-2: the attachment opens only on the resolver\'s yes and prints NOTHING from the reference (fixed copy and the message id only)');
}

_log(`\n══════════════════════════════════════════════════\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
