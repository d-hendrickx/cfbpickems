/**
 * CFB Pickems — adminaidispatchtest.mjs (D1 Lane C, S-2 / G2, 2026-10-08)
 * =======================================================================
 * EVERY NEW CONTROL, TAPPED THROUGH THE REAL DISPATCHER. routingtest and sourcechipstest prove the markup and the pure helpers; this suite proves the WIRING, which is the part a refactor
 * breaks silently: the REAL js/app.js against a real element tree built from the real index.html (minidom.mjs, the wizardfinalizetest precedent), a signed-in platform admin, and a fake
 * Supabase SDK (the only thing faked is the network edge: `client.from('platform_kv')`, `client.rpc('content_status' | 'super_set_platform_kv')`). Nothing here calls wireAdminAiCards,
 * onAdminAiSheetClick, saveScribeRoute or the chat-ui chip handler directly: a CLICK reaches them, as it does for a user.
 *
 *   [1] the routing card (Admin > Settings): the first load is ONE read for the page's lifetime however often it repaints (P-2: armed by a real render); a row opens ITS class's sheet;
 *       Home cards offer no fallback and Chat does; the tier and fallback taps move the draft; Save writes the exact value, closes the sheet, toasts and repaints the row; Cancel, the close
 *       button, the backdrop and Esc leave without a write
 *   [2] a failed save changes nothing and says so (the sheet stays, the pill stays, Retry works); a save IN FLIGHT locks the sheet (P-3: a second Save, a tier tap and Cancel are ignored) and
 *       the lock lifts when the answer lands
 *   [3] who may: a platform admin who is not the Super Admin gets no tap target; a flag that flips after the paint still opens nothing (the belt in the handler)
 *   [4] the routing card's read fails: the Retry button reads again and the card recovers
 *   [5] the status card (Admin > Data): the not-installed state and its Retry, rows and the row sheet, the Refresh button, a failed refresh keeping the rows, and the pull-to-refresh leg
 *   [6] the source chips (chat-ui): a click on a chip of a server-minted SCRIBE row opens exactly the validated address; the same row once it is not server-minted (relayed true, or absent) opens
 *       nothing; an unknown message opens nothing
 *
 * NOT COVERED HERE (a device, never a test): the sheet's motion and swipe-to-dismiss, haptics, 97% press, VoiceOver, 44 pt targets as laid out (adminairendertest measures the layout in Chromium).
 *
 * Run:  node adminaidispatchtest.mjs
 */
import { readFileSync } from 'node:fs';
import { MiniDocument, MiniElement } from './minidom.mjs';
if (typeof MiniElement.prototype.insertAdjacentHTML !== 'function') {
  MiniElement.prototype.insertAdjacentHTML = function (pos, html) {
    const t = this.ownerDocument.createElement('div'); t.innerHTML = html;
    const kids = [...t._children]; t._children = [];
    if (pos === 'afterbegin') { for (const k of kids.reverse()) { k.parentNode = this; this._children.unshift(k); } }
    else { for (const k of kids) { k.parentNode = this; this._children.push(k); } }
  };
}

let pass = 0, fail = 0;
const _log = console.log.bind(console), _err = console.error.bind(console);
const assert = (cond, label, extra = '') => {
  if (cond) { pass++; _log('  ✅', label); } else { fail++; _err('  ❌', label, extra ? `\n     ${extra}` : ''); }
};
const tick = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// ── the browser, as far as the modules under test can tell ──
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear(), key: (i) => [...store.keys()][i] ?? null };
globalThis.window = globalThis;
globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
globalThis.location = { origin: 'https://irbfootball.test', reload() {}, search: '', hash: '' };
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined }, configurable: true }); }
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.matchMedia = (q) => ({ matches: /reduce/.test(String(q)) });     // Reduce Motion: every sheet exit is immediate, so a close is observable without a clock
globalThis.fetch = async () => { throw new Error('network disabled in adminaidispatchtest'); };
globalThis.confirm = () => true; globalThis.prompt = () => null; globalThis.alert = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'u' + Math.random().toString(36).slice(2) };
const realWarn = console.warn, realError = console.error;
console.warn = () => {}; console.info = () => {};
console.error = (...a) => { if (/^\[admin\]/.test(String(a[0] || ''))) return; realError(...a); };   // the page's own other-card fetch failures are not this suite's subject

const INDEX = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const bodyHtmlOf = (html) => html.slice(html.indexOf('<body'), html.indexOf('</body>')).replace(/<script[\s\S]*?<\/script>/g, '').replace(/^<body[^>]*>/, '');
const freshDoc = () => { const d = new MiniDocument(); d.body.innerHTML = bodyHtmlOf(INDEX); return d; };
globalThis.document = freshDoc();

const app = await import('./js/app.js');
const auth = await import('./js/auth.js');
const chat = await import('./js/chat.js');
const chatUi = await import('./js/chat-ui.js');
const { ROUTES_COPY } = await import('./js/scribe-routes-card.js');
const { STATUS_COPY } = await import('./js/content-status-card.js');
const { sourceChipsHTML } = await import('./js/source-chips.js');

// ── the fake network edge ──
const world = {};
function resetWorld() {
  Object.assign(world, {
    kv: [{ key: 'scribe_model_routes', value: { v: 1, routes: {} } }, { key: 'scribe_class_caps_usd', value: {} }, { key: 'scribe_search', value: 'on' }],
    kvError: null,
    status: 'unavailable',                  // 'unavailable' | 'ok' | 'error'
    statusData: null,
    setKv: 'ok',                            // 'ok' | 'error' | 'pending'
    pendingResolve: null,
    kvReads: 0, rpc: [],
  });
}
const nowIso = new Date().toISOString();
const STATUS_FIXTURE = {
  v: 1, generatedAt: nowIso,
  rows: [
    { id: 'news:cbs', group: 'news', label: 'CBS Sports', state: 'ok', lastGoodAt: nowIso, items24h: 12 },
    { id: 'lookup', group: 'lookup', label: 'Source lookup', state: 'error', code: 'provider_error', searches24h: 3, runs: [{ at: nowIso, ok: false, code: 'provider_error' }, { at: nowIso, ok: true }] },
    { id: 'routes', group: 'routes', label: 'SCRIBE routes', state: 'ok' },
  ],
};
const builder = (table) => {
  const b = {
    _keys: null,
    select() { return b; }, eq() { return b; }, order() { return b; }, limit() { return b; }, maybeSingle() { return b; }, single() { return b; }, is() { return b; },
    in(col, vals) { b._keys = vals; return b; },
    then(res, rej) {
      let out;
      if (table === 'platform_kv' && Array.isArray(b._keys) && b._keys.includes('scribe_model_routes')) {
        world.kvReads += 1;
        out = world.kvError ? { data: null, error: { message: world.kvError, code: 'XX000' } } : { data: world.kv, error: null };
      } else out = { data: [], error: null };
      return Promise.resolve(out).then(res, rej);
    },
  };
  return b;
};
const fakeClient = {
  from: builder,
  rpc(name, params) {
    world.rpc.push([name, params]);
    if (name === 'content_status') {
      if (world.status === 'unavailable') return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.content_status' } });
      if (world.status === 'error') return Promise.resolve({ data: null, error: { code: 'XX000', message: 'boom' } });
      return Promise.resolve({ data: world.statusData || STATUS_FIXTURE, error: null });
    }
    if (name === 'super_set_platform_kv') {
      if (world.setKv === 'error') return Promise.resolve({ data: null, error: { code: '42501', message: 'not_super_admin' } });
      if (world.setKv === 'pending') return new Promise((resolve) => { world.pendingResolve = () => resolve({ data: null, error: null }); });
      return Promise.resolve({ data: null, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  },
  auth: { onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }, getSession: async () => ({ data: { session: null } }) },
  functions: { invoke: async () => ({ data: null, error: null }) },
};

function boot({ superAdmin = true } = {}) {
  resetWorld();
  store.clear();
  globalThis.document = freshDoc();
  auth._resetAuthForTest();
  globalThis.window.supabase = { createClient: () => fakeClient };
  // pins mode on purpose: in supabase mode `isContentWithheld()` (correctly) withholds everything until an identity is proven, and a sheet will not open over withheld content.
  auth.configureAuth({ authMode: 'pins', supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' });
  auth._setPlatformAdminFlagsForTest(true, superAdmin);
  app._resetAdminAiForTest();
  app.state.currentTab = 'admin';
}
async function openAdmin(adminTab = 'settings') {
  app.state.adminTab = adminTab;
  app.renderAdminPage();
  await tick();
  return document.getElementById('page-admin');
}
const page = () => document.getElementById('page-admin');
const rowFor = (cls) => page().querySelector(`[data-route-class="${cls}"]`);
const pillOf = (cls) => norm((rowFor(cls) || { querySelector: () => null }).querySelector('.scribe-route-pill')?.textContent);
const sheet = () => document.getElementById('admin-ai-sheet-wrap');
const sheetClass = () => sheet()?.querySelector('[data-route-sheet-class]')?.getAttribute('data-route-sheet-class') || null;
const checked = (attr) => [...document.querySelectorAll(`[${attr}]`)].filter((b) => b.getAttribute('aria-checked') === 'true').map((b) => b.getAttribute(attr));
const toasts = () => [...document.querySelectorAll('#toast-container .toast')].map((t) => norm(t.textContent));
const click = (sel) => { const el = document.querySelector(sel); if (el) el.click(); return !!el; };
/** A sheet LEAVES the way it arrived: its node is removed when the exit ends (a transition's end or a bounded fallback timer). Wait for the real thing, bounded. */
const gone = async (ms = 2000) => { for (let t = 0; t < ms; t += 25) { if (!sheet()) return true; await new Promise((r) => setTimeout(r, 25)); } return !sheet(); };
const setKvCalls = () => world.rpc.filter((r) => r[0] === 'super_set_platform_kv');

// ═════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[1] THE ROUTING CARD - first load, open, draft, save, leave…');
{
  boot();
  await openAdmin('settings');
  assert(page().querySelectorAll('[data-route-class]').length === 7, `1-1: seven class rows with a tap target for the Super Admin (got ${page().querySelectorAll('[data-route-class]').length})`);
  for (let i = 0; i < 4; i++) { app.renderAdminPage(); await tick(); }
  assert(world.kvReads === 1, `1-2 (P-2): however often the page repaints the routing rows are read ONCE for the cache's lifetime - armed by a real renderAdminPage(), not by calling the fetch (got ${world.kvReads} reads)`);

  rowFor('feed').click();
  assert(!!sheet() && sheetClass() === 'feed', `1-3: a tap on the Home cards row opens THAT class's sheet (got ${sheetClass()})`);
  assert(document.querySelectorAll('[data-route-fallback]').length === 0 && checked('data-route-tier').join() === 'haiku', '1-4: Home cards offers no fallback group (its failure path is the structured-facts card) and has Haiku selected');
  click('#scribe-route-cancel');
  assert(await gone() && setKvCalls().length === 0, '1-5: Cancel closes the sheet and writes nothing');

  rowFor('chat').click();
  assert(sheetClass() === 'chat' && checked('data-route-tier').join() === 'sonnet' && checked('data-route-fallback').join() === 'none', '1-6: the Chat row opens the Chat sheet: Sonnet selected, fallback "none" selected');
  document.querySelector('[data-route-tier="opus"]').click();
  assert(checked('data-route-tier').join() === 'opus', '1-7: a tier tap moves the draft (Opus selected)');
  document.querySelector('[data-route-fallback="sonnet"]').click();
  assert(checked('data-route-fallback').join() === 'sonnet' && setKvCalls().length === 0, '1-8: a fallback tap moves the draft; nothing is written until Save');
  document.querySelector('[data-route-tier="sonnet"]').click();
  assert(checked('data-route-tier').join() === 'sonnet' && checked('data-route-fallback').join() === 'none', '1-9: choosing the tier the fallback names clears the fallback (a fallback equal to the primary is no fallback)');
  document.querySelector('[data-route-tier="opus"]').click();
  document.querySelector('[data-route-fallback="sonnet"]').click();
  click('#scribe-route-save');
  await tick();
  const sets = setKvCalls();
  assert(sets.length === 1 && sets[0][1].p_key === 'scribe_model_routes' && JSON.stringify(sets[0][1].p_value) === JSON.stringify({ v: 1, routes: { chat: { tier: 'opus', fallback: 'sonnet' } } }),
    `1-10: Save calls super_set_platform_kv once with the exact value (got ${JSON.stringify(sets)})`);
  assert(!sheet() && toasts().some((t) => /Saved\. New requests use Opus\./.test(t)) && pillOf('chat') === 'Opus', `1-11: the sheet closes, the success toast shows, and the row repaints to Opus (pill "${pillOf('chat')}", toasts ${JSON.stringify(toasts())})`);

  rowFor('judge').click();
  click('#admin-ai-sheet-close');
  assert(await gone(), '1-12: the close button leaves the sheet');
  rowFor('judge').click();
  const backdrop = sheet()?.querySelector('.chat-sheet-backdrop');
  backdrop?.click();
  assert(!!backdrop && await gone(), '1-13: a tap on the backdrop leaves the sheet');
  rowFor('judge').click();
  document.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert(await gone(), '1-14: Esc leaves the sheet');
  assert(setKvCalls().length === 1, '1-15: none of those departures wrote anything (still the one save)');
}

console.log('\n[2] A FAILED SAVE CHANGES NOTHING; A SAVE IN FLIGHT LOCKS THE SHEET…');
{
  boot();
  await openAdmin('settings');
  world.setKv = 'error';
  rowFor('chat').click();
  document.querySelector('[data-route-tier="opus"]').click();
  click('#scribe-route-save');
  await tick();
  const err = document.getElementById('scribe-route-error');
  assert(!!sheet() && sheetClass() === 'chat' && err && /is-visible/.test(err.getAttribute('class') || '') && norm(err.textContent) === norm(ROUTES_COPY.FAILED), `2-1: a refused save keeps the sheet open and says "${ROUTES_COPY.FAILED}" (got "${norm(err && err.textContent)}")`);
  assert(pillOf('chat') === 'Sonnet' && norm(document.querySelector('#scribe-route-save')?.textContent) === ROUTES_COPY.RETRY && checked('data-route-tier').join() === 'opus', '2-2: the card still shows the previous route (Sonnet), the button reads Retry, and the draft is kept');
  world.setKv = 'ok';
  click('#scribe-route-save');
  await tick();
  assert(!sheet() && pillOf('chat') === 'Opus' && setKvCalls().length === 2, '2-3: Retry writes again and, this time, saves');

  // in flight
  world.setKv = 'pending';
  rowFor('classify').click();
  document.querySelector('[data-route-tier="sonnet"]').click();
  click('#scribe-route-save');
  await tick();
  const saveBtn = document.querySelector('#scribe-route-save');
  assert(setKvCalls().length === 3 && norm(saveBtn?.textContent) === ROUTES_COPY.SAVING && saveBtn.getAttribute('aria-busy') === 'true' && pillOf('classify') === 'Haiku', '2-4: while the write is in flight the button reads Saving, is busy, and the row still shows the previous route');
  click('#scribe-route-save');
  document.querySelector('[data-route-tier="haiku"]')?.click();
  click('#scribe-route-cancel');
  document.dispatchEvent({ type: 'keydown', key: 'Escape' });
  click('#admin-ai-sheet-close');
  await new Promise((r) => setTimeout(r, 400));
  assert(setKvCalls().length === 3 && !!sheet() && checked('data-route-tier').join() === 'sonnet', `2-5 (P-3): a SECOND Save, a tier tap, Cancel, Esc and the close button during the write are all ignored - no second write, the sheet stays, the draft does not move (writes ${setKvCalls().length})`);
  world.pendingResolve();
  await tick();
  assert(!sheet() && pillOf('classify') === 'Sonnet', '2-6: when the answer lands the lock lifts, the sheet closes and the row repaints');
  rowFor('classify').click();
  assert(sheetClass() === 'classify', '2-7: the card is usable again afterwards (a new tap opens a sheet)');
  click('#scribe-route-cancel');
  await gone();
}

console.log('\n[3] WHO MAY…');
{
  boot({ superAdmin: false });
  await openAdmin('settings');
  assert(page().querySelectorAll('[data-route-class]').length === 0 && !!page().querySelector('#scribe-routes-readonly') && /Only the app administrator can change these\./.test(norm(page().textContent)), '3-1: a platform admin who is not the Super Admin sees the table and the read-only note, with NO tap target');
  boot();
  await openAdmin('settings');
  const row = rowFor('chat');
  auth._setPlatformAdminFlagsForTest(true, false);              // the flag flips after the paint; the painted row is still on screen
  row.click();
  assert(!sheet() && setKvCalls().length === 0, '3-2: a tap on a row painted for the Super Admin opens NOTHING once the flag is gone (the handler re-checks; the card renders no target for anyone else, this is the belt)');
}

console.log('\n[4] THE ROUTING CARD CANNOT READ - Retry…');
{
  boot();
  resetWorld();
  world.kvError = 'statement timeout';
  await openAdmin('settings');
  const retry = page().querySelector('#scribe-routes-retry-btn');
  assert(!!retry && page().querySelectorAll('[data-route-class]').length === 0 && world.kvReads === 1, `4-1: a failed read shows the calm retry state (no rows, a Retry button), one read so far (got ${world.kvReads})`);
  app.renderAdminPage(); await tick();
  assert(world.kvReads === 1, '4-2 (P-2): a failed first load is NOT retried by repainting - only the Retry button goes back in');
  world.kvError = null;
  retry.click();
  await tick();
  assert(world.kvReads === 2 && page().querySelectorAll('[data-route-class]').length === 7, `4-3: Retry reads again and the card recovers its seven rows (reads ${world.kvReads}, rows ${page().querySelectorAll('[data-route-class]').length})`);
}

console.log('\n[5] THE STATUS CARD (Admin > Data)…');
{
  boot();
  await openAdmin('data');
  const statusCalls = () => world.rpc.filter((r) => r[0] === 'content_status').length;
  assert(statusCalls() === 1 && norm(page().textContent).includes(STATUS_COPY.NOT_INSTALLED), `5-1: before migration 0056 the card says "${STATUS_COPY.NOT_INSTALLED}" (one read, no guess)`);
  const retry = page().querySelector('#content-status-retry-btn');
  assert(!!retry, '5-2: ...with a Retry button');
  app.renderAdminPage(); await tick();
  assert(statusCalls() === 1, '5-3 (P-2): repainting does not re-read (the read is once per cache lifetime)');
  world.status = 'ok';
  retry.click();
  await tick();
  const rows = page().querySelectorAll('[data-status-row]');
  assert(statusCalls() === 2 && rows.length === 3, `5-4: Retry reads again and the three rows appear (reads ${statusCalls()}, rows ${rows.length})`);
  assert(page().querySelectorAll('[data-status-row]')[0].getAttribute('data-status-row') === 'lookup', '5-5: the red row sorts first');
  page().querySelector('[data-status-row="lookup"]').click();
  assert(!!sheet() && norm(sheet().querySelector('#admin-ai-sheet-title')?.textContent) === 'Source lookup' && /The AI service returned an error\./.test(norm(sheet().textContent)), '5-6: a row tap opens its sheet: the row\'s title and the plain meaning of its code');
  click('#admin-ai-sheet-close');
  assert(await gone(), '5-7: the status sheet closes');
  const before = statusCalls();
  click('#content-status-refresh-btn');
  await tick();
  assert(statusCalls() === before + 1, '5-8: the Refresh button reads again');
  world.status = 'error';
  click('#content-status-refresh-btn');
  await tick();
  assert(page().querySelectorAll('[data-status-row]').length === 3, '5-9: a refresh that FAILS keeps the rows already on screen');
  world.status = 'ok';
  const sync = app._makeRunManualSyncForTest(async () => {}, () => 'ACTIVE', () => false);
  const b2 = statusCalls(), k2 = world.kvReads;
  app.state.currentTab = 'admin';
  await sync('pull-to-refresh');
  assert(statusCalls() === b2 + 1 && world.kvReads === k2 + 1, `5-10: pull-to-refresh / the header sync tap on the Admin page re-reads BOTH cards (status +${statusCalls() - b2}, routes +${world.kvReads - k2})`);
  app.state.currentTab = 'dashboard';
  const b3 = statusCalls();
  try { await sync('pull-to-refresh'); } catch { /* the dashboard leg is not this suite's subject */ }
  assert(statusCalls() === b3, '5-11: on any other tab the sync leaves the Admin caches alone');
  app.state.currentTab = 'admin';
}

console.log('\n[6] THE SOURCE CHIPS - the chat-ui click handler…');
{
  boot();
  chat._resetForTest && chat._resetForTest();
  const opened = [];
  globalThis.window.open = (u, t, f) => { opened.push([u, t, f]); };
  const SOURCES = [{ label: 'ESPN', url: 'https://www.espn.com/college-football/story/_/id/401/lsu', publishedAt: '2026-10-03' }, { label: 'x', url: 'https://www.cbssports.com/a', publishedAt: null }];
  const ev = (id, author) => ({ id, type: 'message', seq: Number(id.replace(/\D/g, '')) || 1, ts: nowIso, author, body: 'Nussmeier is listed as the starter.', gameTag: '', meta: { source: 'tier2', sources: SOURCES } });
  chat.ingest([ev('scribe_llm_c1', 'scribe'), ev('scribe_llm_c2', 'scribe'), ev('scribe_llm_c3', 'scribe')], 3);
  const paint = (id) => {
    const host = document.createElement('div');
    host.innerHTML = chatUi._messageHTMLForTest(chat.getMessage(id), 'p1');
    document.body.appendChild(host);
    chatUi._bindMessageActionButtons(host, () => {}, 'main');
    return host;
  };
  // c1: the row the SERVER minted (what migration 0045's `relayed = emitted_by is not null` will say); c2: a row a MEMBER minted through chat_append_system; c3: 0045 has not landed
  chat.getMessage('scribe_llm_c1').relayed = false;
  chat.getMessage('scribe_llm_c2').relayed = true;
  const h1 = paint('scribe_llm_c1'), h2 = paint('scribe_llm_c2'), h3 = paint('scribe_llm_c3');
  assert(h1.querySelectorAll('[data-source-idx]').length === 2 && h2.querySelectorAll('[data-source-idx]').length === 0 && h3.querySelectorAll('[data-source-idx]').length === 0,
    `6-1: the real message renderer draws 2 chips for the server-minted row and NONE for a member-minted row (relayed true) or a row with relayed absent (got ${h1.querySelectorAll('[data-source-idx]').length}/${h2.querySelectorAll('[data-source-idx]').length}/${h3.querySelectorAll('[data-source-idx]').length})`);
  h1.querySelectorAll('[data-source-idx]')[1].click();
  assert(opened.length === 1 && opened[0][0] === 'https://www.cbssports.com/a' && /noopener/.test(opened[0][2]), `6-2: a click on the second chip opens exactly its validated address with noopener (got ${JSON.stringify(opened)})`);
  h1.querySelectorAll('[data-source-idx]')[0].click();
  assert(opened.length === 2 && opened[1][0] === 'https://www.espn.com/college-football/story/_/id/401/lsu', '6-3: the first chip opens the first address');
  // the gate is re-checked AT THE TAP: the chips were drawn, then the row stopped being server-minted
  chat.getMessage('scribe_llm_c1').relayed = true;
  h1.querySelectorAll('[data-source-idx]')[0].click();
  assert(opened.length === 2, '6-4: if the row is no longer server-minted when the tap lands, nothing opens (the gate is not only a paint-time check)');
  chat.getMessage('scribe_llm_c1').relayed = false;
  // a forged chip in the DOM naming a message that is not in the fold, and one naming a member-minted row
  const forgedHost = document.createElement('div');
  forgedHost.innerHTML = sourceChipsHTML({ id: 'scribe_llm_ghost', author: 'scribe', relayed: false, meta: { sources: SOURCES } }, chatUi._escForTest)
    + sourceChipsHTML({ id: 'scribe_llm_c2', author: 'scribe', relayed: false, meta: { sources: SOURCES } }, chatUi._escForTest);
  document.body.appendChild(forgedHost);
  chatUi._bindMessageActionButtons(forgedHost, () => {}, 'main');
  const n = opened.length;
  forgedHost.querySelectorAll('[data-source-idx]').forEach((b) => b.click());
  assert(forgedHost.querySelectorAll('[data-source-idx]').length === 4 && opened.length === n, '6-5: chips whose message is not in the fold, or whose row is member-minted, open NOTHING when tapped (the handler resolves the index against the in-memory message, not the DOM)');
  const idxs = h1.querySelectorAll('[data-source-idx]');
  idxs[0].setAttribute('data-source-idx', '9');
  idxs[0].click();
  idxs[0].setAttribute('data-source-idx', '-1');
  idxs[0].click();
  assert(opened.length === n, '6-6: an index edited in the DOM to point outside the list opens nothing');
  delete globalThis.window.open;
}

console.log(`\n${'─'.repeat(70)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n${'─'.repeat(70)}`);
console.warn = realWarn; console.error = realError;
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
