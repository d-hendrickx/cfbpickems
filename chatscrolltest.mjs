/**
 * chatscrolltest.mjs — A READER WHO SCROLLS UP IN CHAT STAYS WHERE THEY ARE
 * ==========================================================================
 * Run:  node chatscrolltest.mjs          (also spawned by loadtest.mjs [112f])
 *
 * DREW, v0.27.0 live (2026-09-28): "when I open the text box it correctly
 * shows the most recent messages, but now it won't let me scroll up in the
 * chat without snapping back down within a few seconds."
 *
 * THE MECHANISM (RG-279). renderChatPage() rebuilds #page-chat with one
 * innerHTML assignment — a BRAND-NEW #chat-scroll node, scrollTop 0 — and
 * then unconditionally did `scroll.scrollTop = scroll.scrollHeight`. It runs
 * on EVERY inbound chat event (handleChatEvent 'events'), every transport
 * online/offline flip and every data-adapter repaint, i.e. every few seconds
 * in a live league. Any reader who had scrolled up to read history was put
 * back at the bottom by the next repaint. Before v0.27.0 this was masked:
 * RG-265/RG-275's unitless `--nav-height:0` made #page-chat's height calc()
 * invalid, the thread was never a bounded scroller, and the player scrolled
 * the PAGE instead — which no repaint touched. Fixing the height (v0.27.0)
 * made the thread the real scroller and exposed the snap-back.
 *
 * NOT the cause (proved in §4 against the real binder): RG-265's
 * bindBottomAnchor(). It observes only the thread's OWN box size and records
 * "at the bottom" on scroll events; a reader who scrolled up is left alone by
 * it across keyboard / viewport resizes — provided it is bound AFTER the
 * repaint has put the reader back, so its first reading is the reader's.
 *
 * Harness: drafttest.mjs's honest innerHTML model (every id="…" in the new
 * markup is a NEW node, the old one is detached) plus a scroll model for
 * #chat-scroll with browser semantics: scrollHeight from the rendered
 * message count, clientHeight 574 while the Chat section is laid out and 0
 * when it is display:none, scrollTop clamped to [0, sH − cH] and a 'scroll'
 * event on every change. The REAL renderChatPage(), handleChatEvent(),
 * doSend() and bindBottomAnchor() run; only layout is modelled.
 */

// ── DOM / browser stubs ──────────────────────────────────────────────────────
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};

const MSG_H = 80;          // px per rendered message row (model)
const THREAD_CH = 574;     // the Chrome-measured thread viewport at 390×844 (navgesturestest [12])
let chatTabActive = true;  // is #page-chat laid out (section .active) or display:none?

function mkEl(tag = 'div') {
  const L = {};
  return {
    tagName: tag, id: '', className: '', dataset: {}, style: {},
    value: '', selectionStart: 0, selectionEnd: 0, defaultValue: '', type: tag === 'textarea' ? 'textarea' : 'text',
    isConnected: true, _html: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; },
    set textContent(v) { this._text = v; }, get textContent() { return this._text || ''; },
    addEventListener(t, fn) { (L[t] ||= []).push(fn); },
    removeEventListener(t, fn) { L[t] = (L[t] || []).filter(h => h !== fn); },
    appendChild(c) { return c; }, remove() {}, setAttribute() {}, removeAttribute() {}, getAttribute() { return null; },
    setSelectionRange(s, e) { this.selectionStart = s; this.selectionEnd = e; },
    focus() { DOC.activeElement = this; }, blur() {},
    getBoundingClientRect() { return { height: 0, top: 0, bottom: 0, left: 0, right: 0, width: 0 }; },
    scrollIntoView() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    _fire(t, ev = {}) { (L[t] || []).slice().forEach(fn => fn({ stopPropagation() {}, preventDefault() {}, target: this, ...ev })); },
    _count(t) { return (L[t] || []).length; },
  };
}

/** #chat-scroll with browser scroll semantics (see the file header). */
function mkThread(el, messageCount) {
  let top = 0;
  const contentH = messageCount * MSG_H + 40;
  Object.defineProperty(el, 'clientHeight', { get: () => (chatTabActive && el.isConnected ? THREAD_CH : 0), configurable: true });
  Object.defineProperty(el, 'scrollHeight', { get: () => (chatTabActive && el.isConnected ? Math.max(contentH, THREAD_CH) : 0), configurable: true });
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    // A box that is display:none has no scroll position: it reads 0.
    get() { return chatTabActive && el.isConnected ? top : 0; },
    set(v) {
      if (!(chatTabActive && el.isConnected)) return;
      const next = Math.max(0, Math.min(Number(v) || 0, el.scrollHeight - el.clientHeight));
      if (next !== top) { top = next; el._fire('scroll'); }
    },
  });
  return el;
}

/** #chat-sheet-scroll — unlike #chat-scroll a STABLE node: renderSheetMessages()
 *  swaps its innerHTML, and the browser keeps (clamps) its scrollTop across
 *  that. Laid out whenever it is connected (the sheet floats over any tab). */
const SHEET_CH = 400;
function mkSheetScroll(el) {
  let top = 0, contentH = 40;
  Object.defineProperty(el, 'clientHeight', { get: () => (el.isConnected ? SHEET_CH : 0), configurable: true });
  Object.defineProperty(el, 'scrollHeight', { get: () => (el.isConnected ? Math.max(contentH, SHEET_CH) : 0), configurable: true });
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get() { return el.isConnected ? top : 0; },
    set(v) {
      if (!el.isConnected) return;
      const next = Math.max(0, Math.min(Number(v) || 0, el.scrollHeight - el.clientHeight));
      if (next !== top) { top = next; el._fire('scroll'); }
    },
  });
  Object.defineProperty(el, 'innerHTML', {
    configurable: true,
    get() { return this._html; },
    set(v) {
      this._html = v;
      contentH = (v.match(/class="chat-msg[^"]*" data-mid="/g) || []).length * MSG_H + 40;
      const max = Math.max(0, el.scrollHeight - el.clientHeight);
      if (top > max) { top = max; el._fire('scroll'); }       // the browser's clamp; otherwise KEPT
    },
  });
  return el;
}

const els = new Map();
function unescHTML(s) {
  return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}
function buildFromHTML(v, owner) {
  for (const oid of owner._own) { const old = els.get(oid); if (old) { old.isConnected = false; els.delete(oid); } }
  owner._own.clear();
  if (DOC.activeElement && DOC.activeElement.isConnected === false) DOC.activeElement = DOC.body;
  const re = /<(\w+)([^>]*?)\bid="([^"]+)"([^>]*?)>/g;
  let m;
  while ((m = re.exec(v))) {
    const tag = m[1].toLowerCase();
    const el = mkEl(tag);
    el.id = m[3];
    if (tag === 'textarea') {
      const after = v.slice(re.lastIndex); const close = after.indexOf('</textarea>');
      el.value = unescHTML(close >= 0 ? after.slice(0, close) : '');
    } else {
      const val = /\bvalue="([^"]*)"/.exec(m[2] + m[4]); if (val) el.value = unescHTML(val[1]);
    }
    el.defaultValue = el.value;
    if (el.id === 'chat-scroll') mkThread(el, (v.match(/class="chat-msg[^"]*" data-mid="/g) || []).length);
    if (el.id === 'chat-sheet-scroll') mkSheetScroll(el);
    els.set(el.id, el);
    owner._own.add(el.id);
  }
  // The filter pills carry no id — model them too, so the REAL
  // bindFilterButtons() binds its REAL click handler to something (§5d).
  owner._filters = [...v.matchAll(/data-chat-filter="([^"]+)"/g)].map(fm => {
    const b = mkEl('button'); b.dataset.chatFilter = fm[1]; return b;
  });
}
function mkPage(id) {
  const p = mkEl('div'); p.id = id; p._own = new Set();
  p._filters = [];
  p.querySelectorAll = (sel) => (/data-chat-filter/.test(sel) ? p._filters : []);
  p.insertAdjacentHTML = () => {};
  Object.defineProperty(p, 'innerHTML', { get() { return this._html; }, set(v) { this._html = v; buildFromHTML(v, this); } });
  return p;
}
const PAGE = mkPage('page-chat');
const DOC = {
  body: mkEl('body'), activeElement: null,
  documentElement: { style: { setProperty() {}, removeProperty() {} } },
  // openGameChatSheet() builds its wrap with createElement + innerHTML — model
  // that the same honest way as a page section, so the REAL open path mints a
  // REAL (new) #chat-sheet-scroll.
  createElement: t => { const w = mkPage('created-' + t); w.tagName = t; return w; },
  getElementById: id => (id === 'page-chat' ? PAGE : els.get(id) || null),
  querySelector: sel => (sel === '#page-chat.active' ? (chatTabActive ? PAGE : null) : null),
  querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {}, hidden: false,
};
DOC.activeElement = DOC.body;
globalThis.document = DOC;
globalThis.MutationObserver = class { observe() {} disconnect() {} };
// The REAL bindBottomAnchor() needs a ResizeObserver; this one is driven by
// the test's `resize()` step, exactly as navgesturestest [12b] drives it.
const observers = [];
globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb; this.t = new Set(); observers.push(this); } observe(el) { this.t.add(el); } unobserve(el) { this.t.delete(el); } disconnect() { this.t.clear(); } };
globalThis.window = globalThis;
globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined }, configurable: true }); }
globalThis.matchMedia = () => ({ matches: false });
globalThis.confirm = () => true;
globalThis.alert = () => {};
globalThis.fetch = async () => { throw new Error('network disabled in chatscrolltest'); };
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'u' + Math.random().toString(36).slice(2) };
const _realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = () => 0;          // renderChatPage()'s 1 s mark-read timer must not outlive the run
globalThis.clearTimeout = () => {};

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

const chat = await import('./js/chat.js');
const chatUi = await import('./js/chat-ui.js');
const storage = await import('./js/storage.js');
const dataModel = await import('./js/data-model.js');
const { BOTTOM_ANCHOR_PX } = await import('./js/nav-gestures.js');

['Drew', 'Brayden', 'Kevin', 'Koby', 'Jacob', 'Kihoon']
  .map((n, i) => ({ ...dataModel.createPlayer(n, '', '0000', '', n[0]), playerId: `p${i + 1}`, active: true }))
  .forEach(p => storage.savePlayer(p));
storage.saveSetting('chatEnabled', true);
storage.saveSetting('chatEpochSeq', 0);
storage.saveSetting('chatRetentionDays', 0);
storage.setSession('p1', false, true);

let seq = 500;       // leaves seq 1…500 free for §8's "load older" history
const ev = (o = {}) => { seq++; return { id: `m${seq}`, seq, ts: 1_700_000_000_000 + seq * 1000, type: 'message', author: 'p2', gameTag: '', body: 'message ' + seq, replyTo: '', notify: true, meta: null, targetId: '', ...o }; };
chat._resetForTest();
chat.ingest(Array.from({ length: 80 }, () => ev()));   // a real backlog: 80 rows ≈ 6440 px of thread

const thread = () => document.getElementById('chat-scroll');
const distFromBottom = (el) => el.scrollHeight - el.scrollTop - el.clientHeight;
const pinned = (el) => Math.abs(distFromBottom(el)) <= 1;
/** What the live league does every few seconds: a poll/Realtime delivery
 *  lands in the fold (chat.ingest) and chat.js notifies chat-ui's REAL
 *  subscriber (handleChatEvent, wired by initChatUI() in the app — driven
 *  directly here, the drafttest.mjs precedent). */
function inbound(n = 1) {
  const added = chat.ingest(Array.from({ length: n }, () => ev()));
  chatUi._handleChatEventForTest('events', { added });
}
/** The thread's own box changes height (keyboard, composer grow, rotation). */
function resize(el, newCH) {
  Object.defineProperty(el, 'clientHeight', { get: () => newCH, configurable: true });
  el.scrollTop = el.scrollTop;                                       // the browser's clamp
  for (const o of observers) if (o.t.has(el)) o.cb([{ target: el }], o);
}
/** Leave the Chat tab and come back, the way navigateTo() does it. */
function leaveAndReturn() {
  chatTabActive = false; chat.setPollMode('passive');
  chatTabActive = true; chatUi.renderChatPage(); chat.setPollMode('active');
}

// ── §1 fixture ───────────────────────────────────────────────────────────────
console.log('\n[1] Fixture — the real renderChatPage() opens the room at the newest message…');
chatUi.renderChatPage();
{
  const t = thread();
  assert(!!t && t.scrollHeight > 4 * THREAD_CH, `fixture: #chat-scroll rendered with a tall backlog (sH ${t?.scrollHeight}, cH ${t?.clientHeight})`);
  assert(!!t && pinned(t), `opening Chat lands on the NEWEST message (sT ${t?.scrollTop}, dist ${t && distFromBottom(t)}) — the half Drew confirmed works`);
  const before = thread(); chatUi.renderChatPage();
  assert(thread() !== before && before.isConnected === false,
    'fixture: the harness models innerHTML honestly — a repaint REPLACES #chat-scroll (a stub that kept the node would make §2 pass vacuously)');
}

// ── §2 THE REPORTED BUG ──────────────────────────────────────────────────────
console.log('\n[2] A reader scrolled up to read history, then the league keeps talking…');
{
  chatUi.renderChatPage();
  thread().scrollTop = 2000;                       // the player scrolls up
  assert(distFromBottom(thread()) > BOTTOM_ANCHOR_PX, `fixture: the reader is well outside the ${BOTTOM_ANCHOR_PX}px "at the latest" band (dist ${distFromBottom(thread())})`);
  const nodeBefore = thread();
  inbound(1);                                      // the next poll lands (handleChatEvent → renderChatPage)
  assert(thread() !== nodeBefore, 'fixture: the delivery really REPAINTED the room (a new #chat-scroll node) — otherwise the next line proves nothing');
  assert(thread().scrollTop === 2000,
    `THE BUG — an inbound message must NOT snap a scrolled-up reader back to the bottom (sT ${thread().scrollTop}, expected 2000; dist ${distFromBottom(thread())})`);
  for (let i = 0; i < 5; i++) inbound(1);          // "within a few seconds" — keep polling
  assert(thread().scrollTop === 2000, `…nor do five more deliveries in a row (sT ${thread().scrollTop})`);
  chatUi._handleChatEventForTest('offline', {}); chatUi._handleChatEventForTest('online', {});
  assert(thread().scrollTop === 2000, `…nor a transport offline/online flip (sT ${thread().scrollTop})`);
  chatUi.renderChatPage();                         // a data-adapter / rehydrate repaint
  assert(thread().scrollTop === 2000, `…nor a data-adapter repaint (sT ${thread().scrollTop})`);
  assert(document.getElementById('chat-jump')?.style.display === 'block',
    `the "↓ latest" button is SHOWN for the preserved scroll-up (display ${document.getElementById('chat-jump')?.style.display}) — the way back down is one tap`);
}

// ── §3 a reader AT the latest still follows new messages ────────────────────
console.log('\n[3] A reader at (or within the band of) the newest message follows new content…');
{
  chatUi.renderChatPage();
  thread().scrollTop = thread().scrollHeight;
  inbound(1);
  assert(pinned(thread()), `at the bottom: a new message keeps the thread pinned to it (dist ${distFromBottom(thread())})`);
  thread().scrollTop = thread().scrollHeight - thread().clientHeight - (BOTTOM_ANCHOR_PX - 40);
  assert(distFromBottom(thread()) < BOTTOM_ANCHOR_PX, `fixture: ${distFromBottom(thread())}px from the bottom is inside the band`);
  inbound(2);
  assert(pinned(thread()), `inside the band: the thread follows the new messages to the bottom (dist ${distFromBottom(thread())})`);
}

// ── §4 the anchor: a keyboard/viewport resize is not "new content" ──────────
console.log('\n[4] The stick-to-bottom anchor leaves a scrolled-up reader alone across resizes…');
{
  chatUi.renderChatPage();
  thread().scrollTop = 1500;
  inbound(1);                                      // a repaint FIRST — the anchor on the new node must read the restored position
  const t = thread();
  assert(t.scrollTop === 1500, `fixture: the repaint kept the reader at 1500 (sT ${t.scrollTop})`);
  resize(t, THREAD_CH - 300);                      // keyboard up (thread shrinks)
  assert(t.scrollTop === 1500, `keyboard UP after a repaint: the anchor does not yank the reader down (sT ${t.scrollTop})`);
  resize(t, THREAD_CH);                            // keyboard down
  assert(t.scrollTop === 1500, `keyboard DOWN: still 1500 (sT ${t.scrollTop})`);
  // …and the RG-265 half still works: a reader AT the bottom stays pinned across the same cycle.
  chatUi.renderChatPage();
  const b = thread(); b.scrollTop = b.scrollHeight;
  inbound(1);
  const b2 = thread();
  resize(b2, THREAD_CH + 60); resize(b2, THREAD_CH);
  assert(pinned(b2), `a reader at the bottom stays pinned through a repaint + keyboard cycle (RG-265 intact; dist ${distFromBottom(b2)})`);
}

// ── §5 intentional jumps to the bottom are unchanged ────────────────────────
console.log('\n[5] Deliberate moves still go to the newest message…');
{
  // 5a — sending your own message while scrolled up takes you to it.
  chatUi.renderChatPage();
  thread().scrollTop = 1000;
  const input = document.getElementById('chat-input');
  input.value = 'sent from halfway up the thread'; input._fire('input');
  document.getElementById('chat-send')._fire('click');
  assert(chat.getMessages({ tag: 'all' }).some(m => m.body === 'sent from halfway up the thread'), 'fixture: the REAL doSend() posted the message');
  assert(pinned(thread()), `sending while scrolled up lands on your own new message (dist ${distFromBottom(thread())})`);
  // 5b — leaving the tab and coming back opens at the newest message (Drew's "correctly shows the most recent").
  thread().scrollTop = 1000;
  leaveAndReturn();
  assert(pinned(thread()), `leaving Chat and coming back opens at the newest message, not the old reading position (dist ${distFromBottom(thread())})`);
  // 5c — the "↓ latest" button.
  thread().scrollTop = 1000;
  document.getElementById('chat-jump')._fire('click');
  assert(pinned(thread()), `"↓ latest" still jumps to the bottom (dist ${distFromBottom(thread())})`);
  // 5d — switching the filter shows a DIFFERENT list: it starts at that
  // list's newest message, never at the old list's pixel offset. Hall of
  // Records needs pinned rows to be a real (scrollable) list.
  chat.ingest(Array.from({ length: 20 }, (_, i) => ev({ type: 'pin', targetId: `m${501 + i}`, body: '' })));
  chatUi.renderChatPage();
  thread().scrollTop = 300;
  const pill = (f) => PAGE._filters.find(b => b.dataset.chatFilter === f);
  assert(!!pill('all') && !!pill('records'), `fixture: the filter pills rendered (${PAGE._filters.map(b => b.dataset.chatFilter).join(', ')})`);
  pill('records')?._fire('click');                 // the REAL bindFilterButtons() handler
  assert(thread().scrollHeight - thread().clientHeight > 300 + BOTTOM_ANCHOR_PX,
    `fixture: Hall of Records is a real scrollable list, taller than the old offset + the band (sH ${thread().scrollHeight}) — otherwise the next line proves nothing`);
  assert(pinned(thread()), `a filter change opens the new list at its newest message, not at the old list's offset (dist ${distFromBottom(thread())})`);
  pill('all')?._fire('click');
  assert(pinned(thread()), `…and switching back to All opens at the newest message too (dist ${distFromBottom(thread())})`);
}

// ── §7 RG-280 — the per-game chat SHEET, same defect class ──────────────────
console.log('\n[7] RG-280 — a reader scrolled up in a game thread (the sheet) keeps their place too…');
{
  const G = 'g-scroll-test';
  chat.ingest(Array.from({ length: 30 }, () => ev({ gameTag: G })));
  chatTabActive = false;                           // the sheet floats over another tab
  chatUi.openGameChatSheet(G);                     // the REAL open path
  const host = () => document.getElementById('chat-sheet-scroll');
  const sheetDist = (h) => h.scrollHeight - h.scrollTop - h.clientHeight;
  assert(!!host() && host().scrollHeight > 3 * SHEET_CH, `fixture: the sheet rendered a tall game thread (sH ${host()?.scrollHeight})`);
  assert(Math.abs(sheetDist(host())) <= 1, `opening the sheet lands on the game thread's NEWEST message (dist ${sheetDist(host())})`);
  const h1 = host();
  h1.scrollTop = 600;                              // the reader scrolls up
  const deliver = () => { const added = chat.ingest([ev({ gameTag: G })]); chatUi._handleChatEventForTest('events', { added }); };
  deliver();
  assert(host() === h1, 'fixture: #chat-sheet-scroll is the SAME node across a repaint (only its innerHTML is swapped)');
  assert(h1.scrollTop === 600, `THE BUG (RG-280) — an inbound message does not snap a scrolled-up sheet reader to the bottom (sT ${h1.scrollTop}, expected 600)`);
  for (let i = 0; i < 4; i++) deliver();
  assert(h1.scrollTop === 600, `…nor do four more deliveries (sT ${h1.scrollTop})`);
  // a reader at the bottom still follows
  h1.scrollTop = h1.scrollHeight;
  deliver();
  assert(Math.abs(sheetDist(h1)) <= 1, `a sheet reader AT the newest message follows new ones (dist ${sheetDist(h1)})`);
  // your own send from halfway up lands on it
  h1.scrollTop = 600;
  const inp = document.getElementById('chat-sheet-input');
  inp.value = 'sent from the sheet, scrolled up';
  document.getElementById('chat-sheet-send')._fire('click');     // the REAL sendSheetMessage()
  assert(chat.getMessages({ tag: G }).some(m => m.body === 'sent from the sheet, scrolled up'), 'fixture: the REAL sendSheetMessage() posted to the game thread');
  assert(Math.abs(sheetDist(host())) <= 1, `sending from the sheet while scrolled up lands on your own message (dist ${sheetDist(host())})`);
  // re-opening the sheet opens at the newest message
  host().scrollTop = 600;
  chatUi.openGameChatSheet(G);
  assert(host() !== h1 && Math.abs(sheetDist(host())) <= 1, `re-opening the sheet opens at the newest message (dist ${sheetDist(host())})`);
  chatTabActive = true;
}

// ── §8 "↑ load earlier" keeps the reader's place ─────────────────────────────
console.log('\n[8] Load older — the reader keeps looking at the same message, not ~100 messages up…');
{
  chatUi.renderChatPage();
  const t0 = thread();
  t0.scrollTop = 0;                                // at the very top, where the button is
  const h0 = t0.scrollHeight;                      // read now: t0 is detached (reads 0) once the repaint replaces it
  const fromBottom = t0.scrollHeight - t0.scrollTop;
  let old = 0;
  // A stand-in for chat.backfill(100) with the SAME observable effect: older
  // events land in the fold and chat.js notifies the REAL subscriber.
  const fakeBackfill = async (limit) => {
    const evs = Array.from({ length: limit }, () => { old++; return { id: `o${old}`, seq: old, ts: 1_700_000_000_000 + old * 1000, type: 'message', author: 'p3', gameTag: '', body: 'older ' + old, replyTo: '', notify: false, meta: null, targetId: '' }; });
    const added = chat.ingest(evs);
    chatUi._handleChatEventForTest('events', { added });
    return added;
  };
  assert(typeof chatUi._loadOlderForTest === 'function', 'chat-ui exports _loadOlderForTest (thin delegate to the REAL load-older handler body)');
  if (typeof chatUi._loadOlderForTest === 'function') await chatUi._loadOlderForTest(fakeBackfill);
  const t1 = thread();
  assert(t1.scrollHeight > h0 + 50 * MSG_H, `fixture: 100 older messages were prepended (sH ${h0} -> ${t1.scrollHeight})`);
  assert(Math.abs((t1.scrollHeight - t1.scrollTop) - fromBottom) <= 1,
    `after "load earlier" the reader is still looking at the SAME message (distance from the bottom ${fromBottom} kept; got ${t1.scrollHeight - t1.scrollTop}, sT ${t1.scrollTop}) — not thrown to the top of the new batch`);
}

// ── §6 structural ────────────────────────────────────────────────────────────
console.log('\n[6] Structural — the repaint never pins unconditionally…');
{
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./js/chat-ui.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
  const start = src.indexOf('export function renderChatPage(');
  const body = src.slice(start, src.indexOf('\nfunction renderPillsOnly(', start));
  assert(body.length > 0, 'renderChatPage() located');
  const pinIdx = body.search(/scroll\.scrollTop\s*=\s*scroll\.scrollHeight/);
  const anchorIdx = body.search(/bindBottomAnchor\(\s*scroll\s*\)/);
  assert(anchorIdx > 0 && body.slice(Math.max(0, anchorIdx - 1500), anchorIdx).match(/scrollTop\s*=/g)?.length >= 1 && anchorIdx > pinIdx,
    'the anchor is bound AFTER the repaint has set the thread\'s position (its first reading must be the reader\'s, §4)');
}

globalThis.setTimeout = _realSetTimeout;
process.stdout.write(`\n${'─'.repeat(70)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n${'─'.repeat(70)}\n`,
  () => process.exit(fail === 0 ? 0 : 1));
_realSetTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
