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
const { BOTTOM_ANCHOR_PX, WEEK_SWIPE_BOUNCE_MS } = await import('./js/nav-gestures.js');
// REVIEWER ROUND 2 (B1 BLOCK, 2026-09-28) — the drawer binder, imported
// here (not navgesturestest.mjs) so the combined-binder simulation test
// (§8, below) can drive the REAL bindControlCenterEdgeSwipe() alongside the
// REAL bindMessageSwipe() this file already exercises, rather than a
// re-implementation of either.
const controlCenter = await import('./js/control-center.js');

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

// ── §9 DI-427 (UN-382, 2026-09-28) — reply-swipe drag-follow + spring-back ──
// State-machine-level (per the batch's own testing note: "engine-measured if
// you can, at least state-machine"): drives the REAL `_bindMessageSwipe()`/
// `_replySwipeDragOffset()` exports against a small, self-contained fake
// `.chat-msg`/`.chat-bubble-col` pair — NOT the file's own shared `mkEl()`
// fixtures (whose `closest()` is a permanent `() => null` stub, per this
// file's own §DOM-stub section, so `bindMessageSwipe()`'s
// `e.target.closest('.chat-msg')` could never resolve against them). `document`
// is swapped to a minimal always-null stand-in for this section only (saved/
// restored), so a commit's `openReplyFor()`/`openReactPickerFor()` calls
// (which read `document.getElementById('page-chat')` first) early-return
// exactly like every other DOM-light section in navgesturestest.mjs/
// controlcentertest.mjs does for the same reason — no coupling to this file's
// own chat-state fixtures.
console.log('\n[9] DI-427 (UN-382) — reply-swipe drag-follow + spring-back visual layer…');
{
  const savedDoc7 = globalThis.document;
  const savedCapacitor7 = globalThis.Capacitor;
  globalThis.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], body: { dataset: {} } };

  const { _bindMessageSwipe, _replySwipeDragOffset } = chatUi;
  assert(typeof _bindMessageSwipe === 'function' && typeof _replySwipeDragOffset === 'function',
    '7-pre: chat-ui.js exports _bindMessageSwipe()/_replySwipeDragOffset() for direct testing');

  // 7a: the pure curve — 1:1 to REPLY_SWIPE_MAX_PX (36), then
  // _rubberBandOffset()'s own resistance for the excess (DI-409's SAME
  // curve, no second one invented).
  assert(_replySwipeDragOffset(0) === 0, '7a-1: zero drag -> zero offset');
  assert(_replySwipeDragOffset(20) === 20, '7a-2: under the 36px cap -> 1:1 tracking (got ' + _replySwipeDragOffset(20) + ')');
  assert(_replySwipeDragOffset(36) === 36, '7a-3: exactly at the cap -> still 1:1 (got ' + _replySwipeDragOffset(36) + ')');
  const over = _replySwipeDragOffset(80);
  assert(over > 36 && over < 60, `7a-4: past the cap, resisted (not 1:1) — grows past 36 but nowhere near the raw 80 (got ${over})`);
  assert(_replySwipeDragOffset(-10) === 0, '7a-5: negative input (defensive) -> zero, never negative');

  function makeFakeChatMsg() {
    const colStyle = { transform: '', transition: '' };
    const colEl = { style: colStyle, tagName: 'DIV' };
    const dataset = { mid: 'm1' };
    const msgEl = {
      dataset,
      classList: { add() {}, remove() {}, contains: () => false },
      querySelector: (sel) => (sel === '.chat-bubble-col' ? colEl : null),
      // bindMessageSwipe()'s touchstart does `e.target.closest?.('.chat-msg')`
      // — a real `.chat-msg` bubble IS its own closest `.chat-msg` ancestor
      // (the touch lands directly on it in this fixture), matching a real
      // touch landing anywhere inside the row.
      closest: (sel) => (sel === '.chat-msg' ? msgEl : null),
    };
    return { msgEl, colEl, dataset };
  }
  function makeFakeChatRoot() {
    const handlers = {};
    return {
      addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
      removeEventListener(type, fn) { handlers[type] = (handlers[type] || []).filter(h => h !== fn); },
      _fire(type, ev) { (handlers[type] || []).slice().forEach(fn => fn(ev)); },
    };
  }
  function ts7(root, target, x, y) { root._fire('touchstart', { touches: [{ clientX: x, clientY: y }], target }); }
  function tm7(root, target, x, y) { root._fire('touchmove', { touches: [{ clientX: x, clientY: y }], target }); }
  function te7(root) { root._fire('touchend', {}); }

  // 7b: drag-follow, L->R, below the commit threshold — the column tracks
  // the finger via _replySwipeDragOffset(), the reply-glyph is NOT yet armed
  // (dx < SWIPE_THRESHOLD_PX/40).
  {
    const root = makeFakeChatRoot();
    _bindMessageSwipe(root);
    const { msgEl, colEl, dataset } = makeFakeChatMsg();
    ts7(root, msgEl, 100, 300);
    tm7(root, msgEl, 120, 300); // dx=20 — past the 8px dead zone, below the cap, below commit
    assert(colEl.style.transform === 'translateX(20px)', `7b-1: mid-drag, under the 36px cap — 1:1 tracking on .chat-bubble-col (got "${colEl.style.transform}")`);
    assert(dataset.swipeArmed === undefined, '7b-2: below SWIPE_THRESHOLD_PX(40) the reply-glyph is not yet armed ([data-swipe-armed] unset)');
    te7(root);
  }

  // 7c: crossing SWIPE_THRESHOLD_PX arms the glyph (before commit fires on
  // the SAME touchmove, since armed-check runs first in source order).
  {
    const root = makeFakeChatRoot();
    _bindMessageSwipe(root);
    const { msgEl, colEl, dataset } = makeFakeChatMsg();
    ts7(root, msgEl, 100, 300);
    tm7(root, msgEl, 141, 300); // dx=41 — past SWIPE_THRESHOLD_PX(40), commits AND arms in the same tick
    assert(dataset.swipeArmed === 'true', `7c-1: crossing the 40px arm point sets [data-swipe-armed="true"] (got ${dataset.swipeArmed})`);
    te7(root);
  }

  // 7d: spring-back on release — UNCONDITIONAL, whether or not the reply
  // armed (Drew's own words: the spring-back is the confirmation itself).
  // 7d-i: release BELOW threshold (never armed) — still springs back.
  {
    const root = makeFakeChatRoot();
    _bindMessageSwipe(root);
    const { msgEl, colEl, dataset } = makeFakeChatMsg();
    ts7(root, msgEl, 100, 300);
    tm7(root, msgEl, 115, 300); // dx=15 — never crosses 40
    assert(colEl.style.transform === 'translateX(15px)', '7d-i-0: fixture — mid-drag, under threshold');
    te7(root);
    assert(colEl.style.transform === '', `7d-i-1: MUTATION PROOF — release below threshold still springs the transform back to 0 (empty translateX, not left at 15px) (got "${colEl.style.transform}")`);
    assert(colEl.style.transition.includes('150ms'), `7d-i-2: …over WEEK_SWIPE_BOUNCE_MS/--motion-fast (150ms) — Small-feedback bucket, not DI-420's Navigation-bucket fix (got "${colEl.style.transition}")`);
    assert(dataset.swipeArmed === undefined, '7d-i-3: …and the glyph is un-armed on release (never armed in the first place, here)');
  }
  // 7d-ii: release AFTER arming (past threshold) — ALSO springs back (not
  // left at the dragged offset just because the reply "succeeded").
  {
    const root = makeFakeChatRoot();
    _bindMessageSwipe(root);
    const { msgEl, colEl, dataset } = makeFakeChatMsg();
    ts7(root, msgEl, 100, 300);
    tm7(root, msgEl, 150, 300); // dx=50 — commits (reply armed)
    assert(dataset.swipeArmed === 'true', '7d-ii-0: fixture — armed before release');
    te7(root);
    assert(colEl.style.transform === '', `7d-ii-1: MUTATION PROOF (Drew's own "give feedback on the reply swipe" — spring-back is unconditional, not gated on the outcome) — the ARMED case ALSO springs back to 0 rather than staying at the dragged offset (got "${colEl.style.transform}")`);
    assert(dataset.swipeArmed === undefined, '7d-ii-2: …and the glyph un-arms on release too');
  }

  // 7e: R->L (react picker direction) gets NO drag-follow at all — unchanged
  // from pre-DI-427 behavior, per Drew's own wording (item 10 is about the
  // reply direction specifically).
  {
    const root = makeFakeChatRoot();
    _bindMessageSwipe(root);
    const { msgEl, colEl, dataset } = makeFakeChatMsg();
    ts7(root, msgEl, 100, 300);
    tm7(root, msgEl, 50, 300); // dx=-50 — R->L, well past commit
    assert(colEl.style.transform === '', `7e-1: MUTATION PROOF — an R->L (react-picker) drag never touches the bubble's transform at all (got "${colEl.style.transform}")`);
    assert(dataset.swipeArmed === undefined, '7e-2: …and never arms the reply-glyph either — that glyph is reply-direction-only');
    te7(root);
  }

  // 7f: vertical-locked drag never touches the transform (axis-lock safety,
  // unchanged from pre-DI-427 detection).
  {
    const root = makeFakeChatRoot();
    _bindMessageSwipe(root);
    const { msgEl, colEl } = makeFakeChatMsg();
    ts7(root, msgEl, 100, 300);
    tm7(root, msgEl, 105, 340); // dx=5, dy=40 -> locks to 'y'
    tm7(root, msgEl, 160, 340); // a big dx now, but axis is already locked to 'y'
    assert(colEl.style.transform === '', `7f-1: MUTATION PROOF — a vertical-locked drag never moves the bubble's transform (got "${colEl.style.transform}")`);
    te7(root);
  }

  // 7g: reduced motion — no translate at all; detection/commit/haptic
  // unchanged (DI-409's/DI-420's own rule, reused here).
  {
    const savedMM7 = globalThis.matchMedia;
    globalThis.matchMedia = () => ({ matches: true });
    const root = makeFakeChatRoot();
    _bindMessageSwipe(root);
    const { msgEl, colEl, dataset } = makeFakeChatMsg();
    ts7(root, msgEl, 100, 300);
    tm7(root, msgEl, 120, 300); // dx=20 — under prior conditions this would translate
    assert(colEl.style.transform === '', `7g-1: prefers-reduced-motion — NO live transform at all (got "${colEl.style.transform}")`);
    assert(dataset.swipeArmed === undefined, '7g-2: …and the visual arm-glyph never appears either (opacity-only fade is also gated off)');
    te7(root);
    globalThis.matchMedia = savedMM7;
  }

  // 7h: haptic('light') fires ONCE at the arm point, native only — unchanged
  // from pre-DI-427 (DI-427 does not touch this call).
  {
    const calls = [];
    globalThis.Capacitor = { isNativePlatform: () => true, Plugins: { Haptics: { impact: (o) => calls.push(o) } } };
    const root = makeFakeChatRoot();
    _bindMessageSwipe(root);
    const { msgEl } = makeFakeChatMsg();
    ts7(root, msgEl, 100, 300);
    tm7(root, msgEl, 141, 300); // dx=41 — crosses the arm point once
    assert(calls.length === 1 && calls[0].style === 'LIGHT', `7h-1: haptic('light') fires exactly once at the arm point (got ${JSON.stringify(calls)})`);
    te7(root);
    globalThis.Capacitor = savedCapacitor7;
  }

  // 7i-7l: REVIEWER ROUND 2 (N1, 2026-09-28) — arm-then-commit-on-RELEASE,
  // not a mid-drag commit. `chatUi._replyTarget()` (U.replyTo, set
  // UNCONDITIONALLY as openReplyFor()'s first statement, before it ever
  // touches `document`) is the observation point — a real side effect of
  // the reply ACTUALLY committing, not just the visual glyph arming.
  {
    // 7i: crossing the 40px arm point on touchmove does NOT commit yet.
    const root = makeFakeChatRoot();
    _bindMessageSwipe(root);
    const { msgEl, dataset } = makeFakeChatMsg();
    dataset.mid = 'n1-i';
    ts7(root, msgEl, 100, 300);
    tm7(root, msgEl, 141, 300); // dx=41 — past the arm point
    assert(dataset.swipeArmed === 'true', '7i-0: fixture — armed');
    assert(chatUi._replyTarget() !== 'n1-i',
      `7i-1: MUTATION PROOF (N1): crossing the arm point mid-drag does NOT commit the reply — a version that still commits on touchmove (round 1's own bug) would already show _replyTarget()==='n1-i' here (got ${JSON.stringify(chatUi._replyTarget())})`);
    te7(root);
    assert(chatUi._replyTarget() === 'n1-i',
      `7i-2: …and releasing WHILE STILL ARMED commits it (got ${JSON.stringify(chatUi._replyTarget())})`);
  }
  {
    // 7j: dragging back UNDER the arm point before release un-arms — no commit.
    const root = makeFakeChatRoot();
    _bindMessageSwipe(root);
    const { msgEl, dataset } = makeFakeChatMsg();
    dataset.mid = 'n1-j';
    ts7(root, msgEl, 100, 300);
    tm7(root, msgEl, 145, 300); // dx=45 — armed
    assert(dataset.swipeArmed === 'true', '7j-0: fixture — armed');
    tm7(root, msgEl, 120, 300); // dx=20 — dragged back below the 40px arm point
    assert(dataset.swipeArmed === undefined, '7j-1: dragging back under the arm point un-arms the glyph');
    te7(root);
    assert(chatUi._replyTarget() !== 'n1-j',
      `7j-2: MUTATION PROOF (N1): releasing while UN-armed (dragged back under 40px first) does NOT commit — a version that latches "ever armed" instead of "still armed at release" would wrongly commit here (got ${JSON.stringify(chatUi._replyTarget())})`);
  }
  {
    // 7k: touchcancel never commits, even while armed — an interrupted
    // gesture is not a deliberate release.
    const root = makeFakeChatRoot();
    _bindMessageSwipe(root);
    const { msgEl, dataset } = makeFakeChatMsg();
    dataset.mid = 'n1-k';
    ts7(root, msgEl, 100, 300);
    tm7(root, msgEl, 150, 300); // dx=50 — armed
    assert(dataset.swipeArmed === 'true', '7k-0: fixture — armed');
    root._fire('touchcancel', {});
    assert(chatUi._replyTarget() !== 'n1-k',
      `7k-1: MUTATION PROOF (N1): touchcancel while armed does NOT commit (only a genuine touchend release does) (got ${JSON.stringify(chatUi._replyTarget())})`);
    assert(dataset.swipeArmed === undefined, '7k-2: …and still un-arms/springs back like any other release path');
  }
  {
    // 7l: drag-follow keeps tracking (bounded) PAST the arm point, all the
    // way to release — the round-1 bug this fix closes: mid-drag commit
    // froze the bubble at ~36-38px because the `committed` guard stopped
    // touchmove from updating the transform any further. Now nothing stops
    // it short of release.
    const root = makeFakeChatRoot();
    _bindMessageSwipe(root);
    const { msgEl, colEl } = makeFakeChatMsg();
    ts7(root, msgEl, 100, 300);
    tm7(root, msgEl, 141, 300); // dx=41 — armed
    const atArm = colEl.style.transform;
    tm7(root, msgEl, 180, 300); // dx=80 — well past the arm point, still dragging
    assert(colEl.style.transform !== atArm,
      `7l-1: MUTATION PROOF (N1): the drag-follow keeps updating PAST the arm point — a version that still commits (and freezes) at 40px would show the SAME transform here as at the arm instant (arm: "${atArm}", now: "${colEl.style.transform}")`);
    te7(root);
  }
  {
    // 7m: REVIEWER ROUND 3 (N4) — the glyph is placed from the BUBBLE's own
    // at-rest rect (centre of the band it vacates, vertically centred on it),
    // not a fixed row offset. Two rows, two bubble positions: the placement
    // must follow each bubble. A version that keeps a fixed `left` on the row
    // writes nothing here (or the same value for both).
    function makeRectRow({ rowL, rowT, bubL, bubT, bubH }) {
      const glyph = { style: {} };
      const bubble = { getBoundingClientRect: () => ({ left: bubL, top: bubT, width: 40, height: bubH }) };
      const colEl = { style: { transform: '', transition: '' }, querySelector: (sel) => (sel === '.chat-bubble' ? bubble : null) };
      const dataset = { mid: 'm7m' };
      const msgEl = {
        dataset, clientLeft: 0, clientTop: 0,
        getBoundingClientRect: () => ({ left: rowL, top: rowT, width: 366, height: 80 }),
        querySelector: (sel) => (sel === '.chat-bubble-col' ? colEl : sel === '.chat-swipe-reply-icon' ? glyph : null),
        closest: (sel) => (sel === '.chat-msg' ? msgEl : null),
      };
      return { msgEl, glyph, colEl };
    }
    const root = makeFakeChatRoot();
    root.dataset = {};
    _bindMessageSwipe(root);
    const rcv = makeRectRow({ rowL: 24, rowT: 300, bubL: 62, bubT: 316, bubH: 36 });   // a received row: avatar 24–54, bubble at 62
    ts7(root, rcv.msgEl, 100, 330);
    tm7(root, rcv.msgEl, 120, 330);
    assert(rcv.glyph.style.left === '56px' && rcv.glyph.style.top === '34px',
      `7m-1: received row — glyph centred at the bubble's left edge + REPLY_SWIPE_MAX_PX/2 (62-24+18 = 56px) and on the bubble's vertical centre (316-300+18 = 34px) (got left ${rcv.glyph.style.left}, top ${rcv.glyph.style.top})`);
    assert(root.dataset.replySwiping === 'true', '7m-2: the thread is clipped on x for the drag (own bubbles overflow it)');
    te7(root);
    const own = makeRectRow({ rowL: 24, rowT: 500, bubL: 331, bubT: 520, bubH: 30 });  // an own row: right-aligned bubble at 331
    ts7(root, own.msgEl, 340, 535);
    tm7(root, own.msgEl, 360, 535);
    assert(own.glyph.style.left === '325px' && own.glyph.style.top === '35px',
      `7m-3: own row — the SAME rule follows the right-aligned bubble (331-24+18 = 325px, 520-500+15 = 35px), never a fixed row offset (got left ${own.glyph.style.left}, top ${own.glyph.style.top})`);
    const placed = own.glyph.style.left;
    own.glyph.style.left = 'SENTINEL';
    tm7(root, own.msgEl, 400, 535);
    assert(own.glyph.style.left === 'SENTINEL',
      `7m-4: placement is measured ONCE per gesture (at axis lock, before the first transform write) — later moves never re-read the now-translated bubble (was ${placed})`);
    // This suite stubs setTimeout to a no-op (file header); capture the
    // spring-back's own end-of-transition timer and run it, as the engine would.
    const pending7m = [];
    const stubbedSetTimeout7m = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms) => { pending7m.push({ fn, ms }); return 0; };
    te7(root);
    globalThis.setTimeout = stubbedSetTimeout7m;
    assert(root.dataset.replySwiping === 'true' && pending7m.some(t => t.ms === WEEK_SWIPE_BOUNCE_MS),
      '7m-5: the clip holds through the spring-back (lifted by a timer matched to WEEK_SWIPE_BOUNCE_MS, not at release)');
    pending7m.forEach(t => t.fn());
    assert(root.dataset.replySwiping === undefined, '7m-6: …and is lifted once the spring-back ends');

    // 7m-7: reviewer round-3 note 1 — an L→R drag on a .chat-system row
    // (data-mid, NO .chat-bubble-col) must not leave the thread clipped.
    const sysDataset = { mid: 'sys7m' };
    const sysEl = {
      dataset: sysDataset, clientLeft: 0, clientTop: 0,
      getBoundingClientRect: () => ({ left: 24, top: 700, width: 366, height: 40 }),
      querySelector: () => null,
      closest: (sel) => (sel === '.chat-msg' ? sysEl : null),
    };
    ts7(root, sysEl, 100, 720);
    tm7(root, sysEl, 160, 720); // dx=60 — horizontal L→R, past the arm point
    te7(root);
    assert(root.dataset.replySwiping === undefined,
      `7m-7: an L→R drag on a system row (no bubble column), released, leaves NO [data-reply-swiping] on the thread (got ${JSON.stringify(root.dataset.replySwiping)})`);
  }

  globalThis.document = savedDoc7;
}

// ── §10 REVIEWER ROUND 2 (B1 BLOCK, 2026-09-28) — the drawer backs off a
// reply-swipe on a chat bubble. Driven through the REAL
// bindControlCenterEdgeSwipe() (js/control-center.js) AND the REAL
// bindMessageSwipe() (this file's own §7 target), on ONE fake `window` (the
// drawer's own listen target) and a separate fake chat root (bindMessageSwipe's
// own listen target) — the SAME synthetic touch sequence fed to both,
// exactly as two independently-bound listeners would both receive the same
// real DOM event (neither calls stopPropagation).
console.log('\n[10] REVIEWER ROUND 2 (B1) — the drawer backs off a reply-swipe on a chat bubble…');
{
  const savedWindow8 = globalThis.window;
  const savedDoc8 = globalThis.document;
  globalThis.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], body: { dataset: {} } };

  function makeFakeEventTarget8() {
    const handlers = {};
    return {
      addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
      removeEventListener(type, fn) { handlers[type] = (handlers[type] || []).filter(h => h !== fn); },
      _fire(type, ev) { (handlers[type] || []).slice().forEach(fn => fn(ev)); },
    };
  }

  function runCombined8(onBubble) {
    const fakeWin = makeFakeEventTarget8();
    fakeWin.innerWidth = 400;
    globalThis.window = fakeWin;

    let drawerArmed = false;
    const unbindDrawer = controlCenter.bindControlCenterEdgeSwipe(
      (action) => { if (action.type === 'drag-start') drawerArmed = true; },
      () => ({ phase: 'closed', dragProgress: 0 }),
      { getWidthPx: () => 340, getTab: () => 'chat' }, // Chat — DI-419's "anywhere" tab, the exact case B1 closes
    );

    const chatRoot = makeFakeEventTarget8();
    chatUi._bindMessageSwipe(chatRoot);

    // isInDrawerOpenZone()'s own _isDrawerYieldTarget() calls
    // target.closest() with a COMMA-SEPARATED selector list
    // ('.chat-msg, input, textarea, [contenteditable]') — this fake
    // `closest()` matches on substring, same as real DOM `.closest()`
    // would match any one branch of that list.
    const msgEl = onBubble
      ? { dataset: { mid: 'b1-combined' }, classList: { add() {}, remove() {}, contains: () => false },
          querySelector: () => null, closest(sel) { return String(sel).includes('.chat-msg') ? msgEl : null; } }
      : { closest: () => null }; // plain page background — not a message bubble

    const startX = 40, endX = 260; // fast L→R, well past every threshold
    const seq = [
      ['touchstart', { touches: [{ clientX: startX, clientY: 300 }], target: msgEl }],
      ['touchmove', { touches: [{ clientX: (startX + endX) / 2, clientY: 300 }], target: msgEl }],
      ['touchmove', { touches: [{ clientX: endX, clientY: 300 }], target: msgEl }],
    ];
    for (const [type, ev] of seq) { fakeWin._fire(type, ev); chatRoot._fire(type, ev); }
    fakeWin._fire('touchend', {});
    chatRoot._fire('touchend', {});
    unbindDrawer();
    return { drawerArmed, replyTarget: chatUi._replyTarget() };
  }

  const onBubble = runCombined8(true);
  assert(onBubble.drawerArmed === false,
    '8a: MUTATION PROOF (B1): a fast L→R drag STARTING on a chat bubble → ZERO drawer dispatches (a version without the target-based refusal would show drag-start here)');
  assert(onBubble.replyTarget === 'b1-combined',
    `8b: …and the SAME gesture still commits the reply on release (got ${JSON.stringify(onBubble.replyTarget)})`);

  const offBubble = runCombined8(false);
  assert(offBubble.drawerArmed === true,
    '8c: the identical swipe starting OFF a bubble arms the drawer normally — the refusal is target-specific, not a blanket Chat-tab block');

  globalThis.window = savedWindow8;
  globalThis.document = savedDoc8;
}

globalThis.setTimeout = _realSetTimeout;
process.stdout.write(`\n${'─'.repeat(70)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n${'─'.repeat(70)}\n`,
  () => process.exit(fail === 0 ? 0 : 1));
_realSetTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
