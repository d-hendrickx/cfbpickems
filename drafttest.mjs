/**
 * CFB Pickems — drafttest.mjs
 * ============================
 * RG-174 (2026-09-19) — Drew, live on v0.22.4: "the chat will delete my message
 * halfway through me typing it."
 *
 * THE DEFECT, stated as a mechanism rather than a symptom: renderChatPage()
 * (js/chat-ui.js) rebuilds `#page-chat` wholesale with one `innerHTML`
 * assignment, and composerHTML() emits `<textarea id="chat-input">` with no
 * content — so every call replaces the textarea the player is typing into with
 * a brand-new empty one. That was always true; what changed on 2026-09-19 is
 * how OFTEN renderChatPage() is called. Under Sheets it ran on a slow poll.
 * Under Supabase it runs on:
 *
 *   • every inbound chat event      chat-ui.js handleChatEvent('events')
 *   • every Realtime table event    app.js  onRealtimeEvent -> _repaintForSupabaseData -> navigateTo
 *   • every rehydrate tick          app.js  ensureSupabaseDataHydrated -> afterSupabaseHydrate -> _repaintForSupabaseData
 *   • every auth/membership event   app.js  refreshAuthUI()'s trailing navigateTo
 *   • every pg_cron week flip       (a league-table Realtime event, i.e. the second bullet)
 *
 * …which during live games is every few seconds. A latent defect became a
 * constant one.
 *
 * Run:  node drafttest.mjs
 *
 * A DEDICATED file beside loadtest.mjs (the precedent is grouptest.mjs,
 * UN-118, and cachetest.mjs) because it needs a DOM stub rich enough to model
 * the one fact the bug lives in — that `innerHTML =` REPLACES nodes, so the
 * `#chat-input` you get back afterwards is a different, empty element. That
 * stub would be noise inside loadtest.mjs's own minimal top-level document.
 * Wired into loadtest.mjs's spawned-suite list, same shape as [79]-[81].
 *
 * §1  fixture (non-vacuous): the real renderChatPage() mounts a real composer
 * §2  an INBOUND MESSAGE (the reported trigger) — draft, caret and focus survive
 * §3  the sync chokepoint every app.js trigger lands on — draft survives
 * §4  an offline/online transport flip — draft survives
 * §5  sending still CLEARS the composer (the fix must not resurrect sent text)
 * §6  no composer (signed out) — no crash, nothing resurrected
 * §7  focus is not STOLEN: an unfocused composer stays unfocused (mobile keyboard)
 * §8  structural — the four app.js triggers really do funnel into renderChatPage()
 */

// ── DOM / browser stubs ──────────────────────────────────────────────────────
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};

/**
 * The element stub. Carries the four properties this defect is ABOUT —
 * `value`, `selectionStart`, `selectionEnd`, and whether it is the document's
 * activeElement — and nothing else beyond what renderChatPage()/bindChatPage()
 * touch on the way past.
 */
function mkEl(tag = 'div') {
  const L = {};
  return {
    tagName: tag, id: '', className: '', dataset: {}, style: {},
    value: '', selectionStart: 0, selectionEnd: 0, scrollHeight: 0, scrollTop: 0,
    // RG-176 — THE THREE PROPERTIES THE DIRTY RULE IS ABOUT, modeled the way
    // the real DOM models them:
    //   defaultValue  what the MARKUP said (the `value="…"` attribute, or a
    //                 textarea's text content). Assigning `.value` does NOT
    //                 change it — that asymmetry IS the dirty test.
    //   type          'text' for a bare <input>, per the HTML spec.
    //   isConnected   false once innerHTML has thrown the node away.
    defaultValue: '', type: tag === 'textarea' ? 'textarea' : 'text', isConnected: true,
    _html: '', _removed: false,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    set innerHTML(v) { this._html = v; },
    get innerHTML() { return this._html; },
    set textContent(v) { this._text = v; },
    get textContent() { return this._text || ''; },
    addEventListener(t, fn) { (L[t] ||= []).push(fn); },
    removeEventListener() {},
    appendChild(c) { return c; },
    remove() { this._removed = true; },
    setAttribute() {}, removeAttribute() {},
    setSelectionRange(s, e) { this.selectionStart = s; this.selectionEnd = e; },
    focus() { DOC.activeElement = this; },
    blur() { if (DOC.activeElement === this) DOC.activeElement = DOC.body; },
    getBoundingClientRect() { return { height: 0, top: 0, bottom: 0, left: 0, right: 0, width: 0 }; },
    scrollIntoView() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    _fire(t, ev = {}) { (L[t] || []).forEach(fn => fn({ stopPropagation() {}, preventDefault() {}, target: this, ...ev })); },
    _has(t) { return (L[t] || []).length > 0; },
  };
}

function unescHTML(s) {
  return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

/**
 * THE ONE FACT THE BUG LIVES IN, modeled honestly: assigning `innerHTML`
 * DESTROYS every descendant node and builds new ones from the markup. So this
 * stub throws away the element registry on each assignment and rebuilds it by
 * scanning the HTML for `id="…"` — a fresh `#chat-input` whose `value` is
 * whatever the markup actually says (nothing, for a bare `<textarea></textarea>`),
 * whose selection is at 0, and which is not focused.
 *
 * A stub that handed back the SAME node across a re-render would make this
 * whole suite pass against the unfixed code, which is the exact false-pass
 * class loadtest.mjs [32] warns about.
 */
const els = new Map();

/**
 * Build the elements a chunk of markup declares, and register them as belonging
 * to `owner` (a page). RG-176 split this out of PAGE's setter verbatim so the
 * Rules and commissioner page stubs below model innerHTML the SAME way rather
 * than a second, friendlier way — a stub that differed between pages would let
 * a fix pass on one surface and fail on another.
 */
function buildFromHTML(v, owner) {
  // innerHTML REPLACES: everything this page owned is detached, and a detached
  // node is no longer the document's activeElement.
  for (const oid of owner._own) {
    const old = els.get(oid);
    if (old) { old.isConnected = false; els.delete(oid); }
  }
  owner._own.clear();
  if (DOC.activeElement && DOC.activeElement.isConnected === false) DOC.activeElement = DOC.body;
  const re = /<(\w+)([^>]*?)\bid="([^"]+)"([^>]*?)>/g;
  let m;
  while ((m = re.exec(v))) {
    const tag = m[1].toLowerCase();
    const el = mkEl(tag);
    el.id = m[3];
    const attrs = m[2] + m[4];
    if (tag === 'textarea') {
      const after = v.slice(re.lastIndex);
      const close = after.indexOf('</textarea>');
      el.value = unescHTML(close >= 0 ? after.slice(0, close) : '');
    } else {
      const val = /\bvalue="([^"]*)"/.exec(attrs);
      if (val) el.value = unescHTML(val[1]);
      const ty = /\btype="([^"]*)"/.exec(attrs);
      if (ty) el.type = ty[1].toLowerCase();
    }
    // The markup's value IS the default value. Nothing that happens to
    // `.value` afterwards touches it — see mkEl().
    el.defaultValue = el.value;
    el.selectionStart = el.selectionEnd = el.value.length;
    el._page = owner.id;
    els.set(el.id, el);
    owner._own.add(el.id);
  }
}

/** A page section that replaces its subtree on every innerHTML write, and can
 *  be walked by `querySelectorAll('input[id],textarea[id]')` the way
 *  js/field-preserve.js walks a real one. */
function mkPage(id) {
  const p = mkEl('div');
  p.id = id;
  p._own = new Set();
  p.querySelectorAll = (sel) => {
    const wantInput = /\binput\b/.test(sel), wantTextarea = /\btextarea\b/.test(sel);
    return [...p._own].map(i => els.get(i)).filter(el => el && (
      (wantInput && el.tagName === 'input') || (wantTextarea && el.tagName === 'textarea')));
  };
  Object.defineProperty(p, 'innerHTML', {
    get() { return this._html; },
    set(v) { this._html = v; buildFromHTML(v, this); },
  });
  return p;
}

const PAGE = mkPage('page-chat');
// Two more page sections, for the surfaces js/app.js's navigateTo() rebuilds:
// `#fb-body` lives in the Rules page's markup (app.js:12628) and the
// commissioner panel's text inputs live in its own section.
const PAGE_RULES = mkPage('page-rules');
const PAGE_COMM = mkPage('page-commissioner');

const DOC = {
  body: mkEl('body'),
  activeElement: null,
  documentElement: { style: { setProperty() {}, removeProperty() {} } },
  createElement: t => mkEl(t),
  getElementById: id => ({ 'page-chat': PAGE, 'page-rules': PAGE_RULES, 'page-commissioner': PAGE_COMM }[id]
    || els.get(id) || null),
  querySelector: sel => {
    if (sel === '#page-chat.active') return chatTabActive ? PAGE : null;
    return null;                                        // no dashboard, no composer rect, no toast
  },
  querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {}, hidden: false,
};
DOC.activeElement = DOC.body;
let chatTabActive = true;
globalThis.document = DOC;
globalThis.MutationObserver = class { observe() {} disconnect() {} };
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined }, configurable: true }); }
globalThis.matchMedia = () => ({ matches: false });
globalThis.confirm = () => true;
globalThis.alert = () => {};
globalThis.fetch = async () => { throw new Error('network disabled in drafttest'); };
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'u' + Math.random().toString(36).slice(2) };
// renderChatPage() arms a 1s "mark read" timer on every pass; nothing in this
// suite depends on it and a live timer would outlive the assertions.
const _realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = () => 0;
globalThis.clearTimeout = () => {};

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

const { readFile } = await import('node:fs/promises');
const chat = await import('./js/chat.js');
const chatUi = await import('./js/chat-ui.js');
const storage = await import('./js/storage.js');
const dataModel = await import('./js/data-model.js');

// ── Fixture ──────────────────────────────────────────────────────────────────
const NAMES = ['Drew', 'Brayden', 'Kevin', 'Koby', 'Jacob', 'Kihoon'];
NAMES.map((n, i) => ({ ...dataModel.createPlayer(n, '', '0000', '', n[0]), playerId: `p${i + 1}`, active: true }))
  .forEach(p => storage.savePlayer(p));
storage.saveSetting('chatEnabled', true);
storage.saveSetting('chatEpochSeq', 0);
storage.saveSetting('chatRetentionDays', 0);
storage.setSession('p1', false, true);                  // Drew, verified — the composer only renders for a verified player

const ev = (seq, o = {}) => ({
  id: `d${seq}`, seq, ts: 1_700_000_000_000 + seq, type: 'message',
  author: 'p2', gameTag: '', body: 'incoming ' + seq, replyTo: '', notify: true, meta: null, targetId: '',
  ...o,
});

chat._resetForTest();
chat.ingest([ev(1), ev(2)]);

const DRAFT = 'kihoon is not covering that & you know it';
const CARET = 12;

/** Types a draft into the LIVE composer node, exactly as a player would leave
 *  it mid-sentence: text, caret parked inside it, element focused. */
function typeDraft(text = DRAFT, caret = CARET) {
  const input = document.getElementById('chat-input');
  if (!input) return null;
  input.value = text;
  input.setSelectionRange(caret, caret);
  input.focus();
  return input;
}

function composerState() {
  const input = document.getElementById('chat-input');
  return input
    ? { value: input.value, start: input.selectionStart, end: input.selectionEnd, focused: DOC.activeElement === input }
    : null;
}

// ── §1 Fixture check — the REAL renderChatPage() mounts a REAL composer ──────
console.log('\n[1] Fixture — the real renderChatPage() renders a composer into the harness…');
chatUi.renderChatPage();
assert(/chat-composer/.test(PAGE.innerHTML) && /id="chat-input"/.test(PAGE.innerHTML),
  'renderChatPage() rendered the composer (fixture check — every assertion below is vacuous without it)');
assert(!!document.getElementById('chat-input'),
  'the harness resolves #chat-input from the rendered markup (fixture check)');
{
  // Non-vacuity of the harness itself: the node really IS replaced on a
  // re-render. If this went green with the same object, §2-§4 would pass
  // against the unfixed code and prove nothing.
  const before = document.getElementById('chat-input');
  chatUi.renderChatPage();
  const after = document.getElementById('chat-input');
  assert(before !== after,
    'the harness models innerHTML honestly: #chat-input is a DIFFERENT node after a re-render (fixture check — if this fails every case below is a false pass)');
}

// ── §2 THE REPORTED BUG — an inbound message lands mid-sentence ──────────────
console.log('\n[2] An inbound chat message arrives while Drew is typing (the reported trigger)…');
{
  chatUi.renderChatPage();
  const typed = typeDraft();
  assert(!!typed && typed.value === DRAFT, 'fixture: the draft is in the composer before the event');

  // The REAL subscriber chat.js notifies, not a re-implementation of it.
  chatUi._handleChatEventForTest('events', {});

  const s = composerState();
  assert(!!s && s.value === DRAFT,
    `an inbound message must not delete the in-progress draft — got ${JSON.stringify(s?.value)} (THE REPORTED BUG: '' means the composer was rebuilt empty)`);
  assert(!!s && s.start === CARET && s.end === CARET,
    `the caret stays where the player left it — got ${s?.start}/${s?.end}, expected ${CARET}/${CARET}`);
  assert(!!s && s.focused === true,
    'the composer keeps focus, so the next keystroke goes into the message and not into nowhere');
}

// ── §3 EVERY app.js SYNC TRIGGER LANDS ON THIS ONE CHOKEPOINT ───────────────
// Realtime table event, rehydrate tick, auth/membership refresh and the pg_cron
// week flip all reach the chat surface as `navigateTo('chat') -> renderChatPage()`
// (§8 pins that routing structurally). So the behavioural proof for all four is
// one call to the function they all end in.
console.log('\n[3] The adapter-sync / rehydrate-tick / auth-refresh / week-flip repaint…');
{
  chatUi.renderChatPage();
  typeDraft('week flipped live mid-type', 5);
  chatUi.renderChatPage();                    // what _repaintForSupabaseData() ends up calling
  const s = composerState();
  assert(!!s && s.value === 'week flipped live mid-type',
    `a repaint driven by the data adapter must not delete the draft — got ${JSON.stringify(s?.value)}`);
  assert(!!s && s.start === 5 && s.end === 5, `caret preserved across the repaint — got ${s?.start}`);
  assert(!!s && s.focused === true, 'focus preserved across the repaint');
}

// ── §4 A transport offline/online flip repaints too ─────────────────────────
console.log('\n[4] A chat transport offline/online flip…');
{
  chatUi.renderChatPage();
  typeDraft('typed while the banner flipped', 3);
  chatUi._handleChatEventForTest('offline', {});
  const s1 = composerState();
  assert(!!s1 && s1.value === 'typed while the banner flipped',
    `going offline mid-type must not delete the draft — got ${JSON.stringify(s1?.value)}`);
  chatUi._handleChatEventForTest('online', {});
  const s2 = composerState();
  assert(!!s2 && s2.value === 'typed while the banner flipped',
    `coming back online must not delete it either — got ${JSON.stringify(s2?.value)}`);
}

// ── §5 SENDING STILL CLEARS — the fix must not resurrect sent text ──────────
console.log('\n[5] Sending a message still clears the composer…');
{
  chatUi.renderChatPage();
  const input = typeDraft('this one actually gets sent', 4);
  input._fire('input');                                  // the composer's own listener
  document.getElementById('chat-send')?._fire('click');  // the REAL doSend()
  const s = composerState();
  assert(!!s && s.value === '',
    `after a send the composer is EMPTY — a draft-preserving fix must not put the sent text back (got ${JSON.stringify(s?.value)})`);
  const posted = chat.getMessages({ tag: 'all' }).filter(m => m.body === 'this one actually gets sent');
  assert(posted.length === 1, `fixture: the send really did post the message (got ${posted.length})`);
}

// ── §6 No composer at all (signed out) — no crash, nothing resurrected ──────
console.log('\n[6] A signed-out reader has no composer…');
{
  chatUi.renderChatPage();
  typeDraft('typed before signing out', 2);
  storage.clearSession();
  let threw = null;
  try { chatUi.renderChatPage(); } catch (e) { threw = e; }
  assert(!threw, `renderChatPage() with no composer on screen does not throw (got ${threw?.message})`);
  assert(!document.getElementById('chat-input') && /chat-login-prompt/.test(PAGE.innerHTML),
    'the signed-out surface renders the login prompt in place of the composer, and no draft is resurrected into it');
  storage.setSession('p1', false, true);
}

// ── §7 Focus is preserved, never STOLEN ─────────────────────────────────────
// A player reading the room with a half-typed draft sitting in the box has NOT
// got the keyboard up. Re-focusing the textarea on every repaint would pop the
// on-screen keyboard open every few seconds on a phone — a different bug, in
// the same place, introduced by an over-eager fix.
console.log('\n[7] An UNFOCUSED composer stays unfocused…');
{
  chatUi.renderChatPage();
  const input = typeDraft('half a thought, then scrolled away', 6);
  input.blur();
  assert(DOC.activeElement !== input, 'fixture: the composer is not focused before the repaint');
  chatUi.renderChatPage();
  const s = composerState();
  assert(!!s && s.value === 'half a thought, then scrolled away',
    `the draft still survives when the composer is not focused — got ${JSON.stringify(s?.value)}`);
  assert(!!s && s.focused === false,
    'the repaint does NOT grab focus for a composer that did not have it (an unbidden mobile keyboard is its own bug)');
}

// ── §8 Structural — the four sync triggers really do reach renderChatPage() ─
// These are app.js wiring facts that cannot be driven from a chat-ui-scoped
// harness (navigateTo/_repaintForSupabaseData are module-private). Asserted as
// routing, and labelled [structural] exactly like loadtest.mjs [32] does.
console.log('\n[8] The Supabase-era triggers funnel into renderChatPage() [structural]…');
{
  const appSrc = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
  const uiSrc = await readFile(new URL('./js/chat-ui.js', import.meta.url), 'utf8');

  assert(/onRealtimeEvent:\s*\(\)\s*=>\s*\{\s*_repaintForSupabaseData\('realtime'\)/.test(appSrc),
    'the adapter\'s Realtime events repaint through _repaintForSupabaseData() [structural]');
  assert(/function _repaintForSupabaseData\([\s\S]{0,400}?navigateTo\(state\.currentTab/.test(appSrc),
    '_repaintForSupabaseData() repaints via navigateTo() [structural]');
  assert(/chat:\s*renderChatPage\s*\}\)\[tab\]/.test(appSrc),
    'navigateTo(\'chat\') dispatches to renderChatPage() — so every repaint above rebuilds the composer [structural]');
  assert(/afterSupabaseHydrate[\s\S]{0,2000}?_repaintForSupabaseData\(reason\)/.test(appSrc),
    'the rehydrate tick lands on the same repaint [structural]');
  const refreshAuthUIFn = (appSrc.match(/export function refreshAuthUI\(event, payload\) \{[\s\S]*?\n\}/) || [''])[0];
  assert(refreshAuthUIFn.length > 0, 'refreshAuthUI() body located [structural]');
  assert(/navigateTo\(state\.currentTab \|\| 'dashboard'\)/.test(refreshAuthUIFn),
    'refreshAuthUI()\'s trailing re-navigate lands on the same repaint [structural]');
  assert(/if \(chatPageActive\(\)\) renderChatPage\(\);/.test(uiSrc),
    'an inbound chat event re-renders the page while chat is open [structural]');

  // And the composer template still carries NO value of its own — i.e. the
  // draft can only survive because something restores it, never because the
  // markup happened to keep it.
  const composerFn = (uiSrc.match(/function composerHTML\(\) \{[\s\S]*?\n\}/) || [''])[0];
  assert(composerFn.length > 0, 'composerHTML() body located [structural]');
  assert(/<textarea class="chat-input" id="chat-input"[\s\S]{0,200}?><\/textarea>/.test(composerFn),
    'composerHTML() still emits an EMPTY textarea (the draft is restored onto it, not baked into the markup) [structural]');
}

// ── §9 A draft never crosses a SESSION change (reviewer BLOCK, v0.22.5) ─────
// The session changes on ANOTHER page (Picks → Log Out / Switch Player), which
// never re-renders chat — so the old node, with A's text in it, is still in the
// DOM when B first opens Chat. B's composer must come up EMPTY.
console.log('\n[9] Player A\'s draft is never restored into Player B\'s composer…');
{
  storage.setSession('p1', false, true);
  chatUi.renderChatPage();
  typeDraft('kihoon is not covering that', 5);
  storage.clearSession();                                  // logout on another page: NO chat render
  storage.setSession('p2', false, true);                   // B signs in, then opens Chat
  chatUi.renderChatPage();
  const b = composerState();
  assert(b && b.value === '', `B's composer is EMPTY — A's draft was dropped, not restored (got ${JSON.stringify(b && b.value)})`);
  assert(b && !b.focused, 'and B is not handed focus/keyboard for a draft that was never theirs');
  // Same player, straight after: drafts still survive (the guard is identity, not a blanket clear).
  typeDraft('my own words', 3);
  chatUi.renderChatPage();
  assert(composerState()?.value === 'my own words', 'B\'s OWN draft still survives a re-render');
  // A comes back: B's draft must not reach A either.
  storage.clearSession(); storage.setSession('p1', false, true);
  chatUi.renderChatPage();
  assert(composerState()?.value === '', 'and B\'s draft does not reach A on the way back');
}

// ═══════════════════════════════════════════════════════════════════════════
// RG-176 (2026-09-19) — THE SAME REPAINT HAZARD, EVERYWHERE ELSE
// ═══════════════════════════════════════════════════════════════════════════
// RG-174 fixed ONE field. `innerHTML =` destroys the others identically:
//   • the chat ⚙ prefs inputs   (chat-ui.js prefsPanelHTML, #pref-nick et al.)
//   • #fb-body                  (app.js renderRulesPage, the feedback textarea)
//   • the commissioner panel     (app.js renderCommPage — broadcast body, etc.)
// The first is reachable from this harness through the REAL renderChatPage().
// The other two are rebuilt by app.js's navigateTo(), which is module-private
// and cannot be driven from a chat-scoped harness — so they are proven the way
// §8 already proves app.js wiring: the BEHAVIOUR is asserted against the real
// js/field-preserve.js functions over an honest page stub, and the WIRING is
// asserted structurally. Same split, same labels.
const fp = await import('./js/field-preserve.js');

// ── §10 The chat ⚙ prefs panel — DIRTY WINS, CLEAN LOSES ───────────────────
// The rule Drew's design states and the composer's does not: `#pref-nick` is
// DURABLE synced state. An unsaved in-progress edit must survive the repaint;
// an UNTOUCHED field must take the fresh stored value, or a display-name change
// made on another device is clobbered by a stale copy held in this node.
// (bindPrefsPanel() listens on 'change', which fires on BLUR — so a repaint
// mid-edit doesn't merely lose the caret, it loses the edit entirely.)
console.log('\n[10] The chat ⚙ prefs panel survives a repaint — but only where it is DIRTY…');
{
  storage.clearSession(); storage.setSession('p1', false, true);
  chatUi.renderChatPage();
  document.getElementById('chat-prefs-btn')?._fire('click');       // the REAL toggle
  const nick = document.getElementById('pref-nick');
  assert(!!nick, 'fixture: the ⚙ panel is open and #pref-nick is on screen');
  assert(!!document.getElementById('pref-initials'), 'fixture: #pref-initials too (the panel has more than one text field)');

  nick.value = 'Drewbacca';                                        // typed, NOT yet blurred → never saved
  nick.setSelectionRange(4, 4);
  nick.focus();
  chatUi.renderChatPage();                                         // an inbound message / Realtime repaint
  const after = document.getElementById('pref-nick');
  assert(after && after.value === 'Drewbacca',
    `an in-progress nickname edit survives the repaint — got ${JSON.stringify(after && after.value)} (THE BUG: '' or the stored value means the node was rebuilt under the player)`);
  assert(after && after.selectionStart === 4, `the caret stays put — got ${after && after.selectionStart}`);
  assert(after && DOC.activeElement === after, 'and the field keeps focus, so the next keystroke lands in it');
}
{
  // The other half of the ruling, and the reason this is not just "preserve
  // everything": a field the player has NOT touched must take the fresh value.
  // First COMMIT the edit above the way the panel really commits it — the
  // 'change' listener bindPrefsPanel() wires, which fires on blur — so the node
  // stops being dirty. (Until then it SHOULD keep winning: the edit is still in
  // progress. That is the rule, not a leak.)
  document.getElementById('pref-nick')._fire('change');
  assert(storage.getChatNick() === 'Drewbacca',
    `fixture: blurring the field is what saves it — the stored nick is now ${JSON.stringify(storage.getChatNick())}`);
  storage.setChatNick('FromOtherPhone');                           // ≤16 chars — a change arriving from another device
  chatUi.renderChatPage();
  const clean = document.getElementById('pref-nick');
  assert(clean && clean.value === 'FromOtherPhone',
    `an UNTOUCHED #pref-nick takes the freshly stored value, so a cross-device change is not clobbered — got ${JSON.stringify(clean && clean.value)}`);
  assert(clean && DOC.activeElement !== clean,
    'and a clean field is not handed focus it never had (rule 3 — no unbidden mobile keyboard)');
  storage.setChatNick('');
}
{
  // Rule 2 on THIS surface. The session changes on another page (Picks → Log
  // Out / Switch Player), which never re-renders chat, so A's typed nickname is
  // still sitting in the node when B opens the ⚙ panel.
  storage.clearSession(); storage.setSession('p1', false, true);
  chatUi.renderChatPage();
  const a = document.getElementById('pref-nick');
  a.value = 'A-WAS-HERE'; a.focus();
  storage.clearSession();
  storage.setSession('p2', false, true);                           // B signs in elsewhere
  chatUi.renderChatPage();
  const b = document.getElementById('pref-nick');
  assert(b && b.value !== 'A-WAS-HERE',
    `Player A's unsaved nickname is NEVER restored into Player B's field — got ${JSON.stringify(b && b.value)} (a cross-session leak; one blur from saving A's text under B's name)`);
  assert(b && !(DOC.activeElement === b), 'and B is not handed focus for an edit that was never theirs');
  storage.clearSession(); storage.setSession('p1', false, true);
}

// ── §11 #fb-body and the commissioner panel, through the REAL mechanism ────
console.log('\n[11] The Rules feedback textarea and the commissioner panel…');
{
  const OWNER = 'acct1|league1|p1';
  // The Rules page exactly as app.js:12628 renders it: a name input carrying a
  // stored value, and an EMPTY feedback textarea.
  const rulesHTML = () => `<div class="card feedback-card">
    <input class="form-input" id="fb-name" type="text" value="Drew" />
    <textarea class="form-input" id="fb-body" rows="3"></textarea></div>`;
  PAGE_RULES.innerHTML = rulesHTML();
  fp.stampFieldOwner(PAGE_RULES, OWNER);                           // what navigateTo() does after every render
  const body = document.getElementById('fb-body');
  body.value = 'the spread on the Purdue game looks wrong'; body.setSelectionRange(7, 7); body.focus();
  const snap = fp.captureDirtyFields(PAGE_RULES, OWNER);
  PAGE_RULES.innerHTML = rulesHTML();                              // the Realtime repaint
  assert(document.getElementById('fb-body') !== body, 'fixture: the repaint really did replace #fb-body (non-vacuity)');
  fp.restoreDirtyFields(snap, PAGE_RULES, OWNER);
  const fresh = document.getElementById('fb-body');
  assert(fresh.value === 'the spread on the Purdue game looks wrong',
    `a half-written feedback report survives the repaint — got ${JSON.stringify(fresh.value)}`);
  assert(fresh.selectionStart === 7 && DOC.activeElement === fresh, 'caret and focus come back with it');
  assert(document.getElementById('fb-name').value === 'Drew',
    'the UNTOUCHED name input still shows the freshly rendered value (it was never captured — rule 1)');
}
{
  const OWNER = 'acct1|league1|p1';
  // The commissioner panel: a text input whose markup carries a STORED value.
  // This is the case the dirty rule exists for — a stale capture would undo a
  // commissioner edit made on another device.
  const commHTML = (nickname) => `<div class="card"><input class="form-input" id="cm-player-nickname" type="text" value="${nickname}" />
    <textarea class="form-input" id="broadcast-body"></textarea></div>`;
  PAGE_COMM.innerHTML = commHTML('Kihoon');
  fp.stampFieldOwner(PAGE_COMM, OWNER);
  const bc = document.getElementById('broadcast-body');
  bc.value = 'Locks at noon Saturday'; bc.setSelectionRange(5, 5);  // typed, NOT focused
  const snap = fp.captureDirtyFields(PAGE_COMM, OWNER);
  PAGE_COMM.innerHTML = commHTML('The Reigning Champ');            // …and the nickname changed on the server
  fp.restoreDirtyFields(snap, PAGE_COMM, OWNER);
  assert(document.getElementById('broadcast-body').value === 'Locks at noon Saturday',
    'a half-typed broadcast survives a commissioner-panel repaint');
  assert(DOC.activeElement !== document.getElementById('broadcast-body'),
    'focus is NOT granted to a field that did not have it (rule 3)');
  assert(document.getElementById('cm-player-nickname').value === 'The Reigning Champ',
    `the clean nickname input shows the SERVER's new value, not the one this device rendered a second ago — got ${JSON.stringify(document.getElementById('cm-player-nickname').value)}`);
}
{
  // Rule 2 on these surfaces too: a repaint that straddles a session change
  // restores nothing.
  const A = 'acct1|league1|p1', B = 'acct2|league1|p2';
  PAGE_RULES.innerHTML = '<textarea id="fb-body"></textarea>';
  fp.stampFieldOwner(PAGE_RULES, A);
  const t = document.getElementById('fb-body');
  t.value = "kevin still owes me twenty"; t.focus();
  const snap = fp.captureDirtyFields(PAGE_RULES, A);
  PAGE_RULES.innerHTML = '<textarea id="fb-body"></textarea>';
  fp.restoreDirtyFields(snap, PAGE_RULES, B);                      // B is on the handset now
  assert(document.getElementById('fb-body').value === '',
    `Player A's feedback draft is never restored under Player B (got ${JSON.stringify(document.getElementById('fb-body').value)})`);
  fp.restoreDirtyFields(snap, PAGE_RULES, A);
  assert(document.getElementById('fb-body').value === "kevin still owes me twenty",
    'and the guard is IDENTITY, not a blanket refusal — the same player still gets their draft back');
}
{
  // Idempotence. navigateTo() restores the active page AND renderChatPage()
  // restores #page-chat, so the chat surface is legitimately restored twice on
  // one repaint. A second restore must be a no-op, not a second write.
  const OWNER = 'acct1|league1|p1';
  PAGE_RULES.innerHTML = '<textarea id="fb-body"></textarea>';
  fp.stampFieldOwner(PAGE_RULES, OWNER);
  const t = document.getElementById('fb-body');
  t.value = 'once'; t.setSelectionRange(2, 2); t.focus();
  const snap = fp.captureDirtyFields(PAGE_RULES, OWNER);
  PAGE_RULES.innerHTML = '<textarea id="fb-body"></textarea>';
  fp.restoreDirtyFields(snap, PAGE_RULES, OWNER);
  fp.restoreDirtyFields(snap, PAGE_RULES, OWNER);
  const f = document.getElementById('fb-body');
  assert(f.value === 'once' && f.start !== 'onceonce', 'a double restore is idempotent (the value is written once, not appended)');
  assert(f.selectionStart === 2, 'and the caret is not moved by the second pass');
}

// ── §12 Rule 4 — a PIN or password is NEVER carried ────────────────────────
// The site PIN, the player PINs and the commissioner password ARE the auth
// model (CLAUDE.md). A copy of one living in a module-level snapshot, surviving
// a repaint that was meant to clear the screen, is not a preservation feature.
console.log('\n[12] Secrets are refused, by type AND by id…');
{
  const OWNER = 'acct1|league1|p1';
  PAGE_COMM.innerHTML = `<input id="comm-password" type="password" value="" />`
    + `<input id="player-pin-input" type="text" inputmode="numeric" value="" />`
    + `<input id="cm-week-name" type="text" value="" />`;
  fp.stampFieldOwner(PAGE_COMM, OWNER);
  document.getElementById('comm-password').value = 'hunter2';
  document.getElementById('player-pin-input').value = '4242';
  document.getElementById('cm-week-name').value = 'Rivalry Week';
  const snap = fp.captureDirtyFields(PAGE_COMM, OWNER);
  const ids = (snap?.fields || []).map(f => f.id);
  assert(!ids.includes('comm-password'), `a type="password" field is never captured — captured ${JSON.stringify(ids)}`);
  assert(!ids.includes('player-pin-input'),
    `a PIN box rendered as type="text" is refused BY ID too — this app ships both spellings — captured ${JSON.stringify(ids)}`);
  assert(ids.includes('cm-week-name'), 'fixture: an ordinary commissioner text input IS captured (so the two refusals above are not vacuous)');
}

// ── §13 The IME guard (reviewer follow-up on RG-174) ───────────────────────
// Between compositionstart and compositionend the browser owns a preedit buffer
// that is not yet in `value`, and the IME commits it on its own schedule.
// Writing value/selection in that window races the commit and duplicates or
// scrambles the text. Both directions stand down.
console.log('\n[13] Nothing is written while an IME composition is in flight…');
{
  const OWNER = 'acct1|league1|p1';
  PAGE_RULES.innerHTML = '<textarea id="fb-body"></textarea>';
  const t = document.getElementById('fb-body');
  t.value = 'にほん'; t.focus();
  fp._setComposingForTest(t);
  assert(fp.isComposing() === true, 'fixture: the composition watch reports a live composition');
  assert(fp.captureDirtyFields(PAGE_RULES, OWNER) === null,
    'capture stands down mid-composition — the preedit buffer is not part of value and must not be snapshotted');
  fp._setComposingForTest(null);
  const snap = fp.captureDirtyFields(PAGE_RULES, OWNER);
  assert(!!snap, 'fixture: with the composition ended, the same field IS captured');
  PAGE_RULES.innerHTML = '<textarea id="fb-body"></textarea>';
  fp.stampFieldOwner(PAGE_RULES, OWNER);
  const fresh = document.getElementById('fb-body');
  fp._setComposingForTest(fresh);
  fp.restoreDirtyFields(snap, PAGE_RULES, OWNER);
  assert(document.getElementById('fb-body').value === '',
    'restore stands down mid-composition — a programmatic write would race the IME commit');
  fp._setComposingForTest(null);
}
{
  // SELF-CLEARING. The repaint DESTROYS the composing node, which therefore
  // never fires compositionend. A latch that stuck would silently disable this
  // whole module for the rest of the page's life — i.e. hand the bug back.
  PAGE_RULES.innerHTML = '<textarea id="fb-body"></textarea>';
  const doomed = document.getElementById('fb-body');
  fp._setComposingForTest(doomed);
  PAGE_RULES.innerHTML = '<textarea id="fb-body"></textarea>';     // the node is thrown away mid-composition
  assert(doomed.isConnected === false, 'fixture: the composing node really was detached by the repaint');
  assert(fp.isComposing() === false,
    'the composition latch releases itself on a detached node — a stuck latch would disable every capture and restore from here on');
}
{
  // …and the composer honours it too (chat-ui.js's own pair, not this module's).
  storage.clearSession(); storage.setSession('p1', false, true);
  chatUi.renderChatPage();
  const input = typeDraft('半角', 1);
  fp._setComposingForTest(input);
  chatUi.renderChatPage();
  assert(composerState()?.value === '',
    'the chat composer does not restore a draft mid-composition either (reviewer follow-up: chat-ui.js had no IME guard)');
  fp._setComposingForTest(null);
}

// ── §14 captureComposerDraft() is the SOLE producer for restoreComposerDraft() ─
// Reviewer follow-up on RG-174. The producer is where the identity guard, the
// non-empty rule and the IME guard all live; a caller that hand-rolled its own
// snapshot object would bypass all three at once and look exactly like the
// supported path.
console.log('\n[14] restoreComposerDraft() refuses a snapshot it did not produce…');
{
  storage.clearSession(); storage.setSession('p1', false, true);
  chatUi.renderChatPage();
  const haveSeams = typeof chatUi._restoreComposerDraftForTest === 'function'
                 && typeof chatUi._captureComposerDraftForTest === 'function';
  assert(haveSeams,
    'chat-ui.js exports the producer/consumer pair as test seams (RG-27: the assertion runs against the SHIPPED functions, never a copy)');
  if (haveSeams) chatUi._restoreComposerDraftForTest({ value: 'forged, from nowhere', start: 0, end: 0, focused: true });
  assert(composerState()?.value === '',
    `a hand-built snapshot is refused — got ${JSON.stringify(composerState()?.value)} (the producer is where every guard lives)`);
  typeDraft('genuinely mine', 3);
  const real = haveSeams ? chatUi._captureComposerDraftForTest() : null;
  assert(!!real, 'fixture: the real producer still produces a snapshot');
  chatUi.renderChatPage();
  assert(composerState()?.value === 'genuinely mine',
    'and the REAL producer/consumer pair still works (the assertion is a brand check, not a blanket refusal)');
}

// ── §15 Structural — the repaint chokepoint really is wired ────────────────
console.log('\n[15] app.js and chat-ui.js wire the generic mechanism [structural]…');
{
  const appSrc = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
  const uiSrc = await readFile(new URL('./js/chat-ui.js', import.meta.url), 'utf8');

  assert(/import \{[^}]*captureDirtyFields[^}]*\} from '\.\/field-preserve\.js'/.test(appSrc),
    'app.js imports the generic mechanism [structural]');
  const navFn = (appSrc.match(/function navigateTo\(tab\) \{[\s\S]*?\n\}/) || [''])[0];
  assert(navFn.length > 0, 'navigateTo() body located [structural]');
  assert(/captureDirtyFields\(/.test(navFn) && /restoreDirtyFields\(/.test(navFn),
    'navigateTo() — the ONE render chokepoint every Realtime repaint lands on — both captures and restores [structural]');
  assert(navFn.indexOf('captureDirtyFields(') < navFn.indexOf("renderCommPage, rules: renderRulesPage"),
    'the capture happens BEFORE the render dispatch that destroys the fields [structural]');
  assert(navFn.indexOf('if (_priorTab === tab) restoreDirtyFields(') > navFn.indexOf("renderCommPage, rules: renderRulesPage"),
    'and the restore happens AFTER it [structural]');
  assert(/stampFieldOwner\(_pageEl, currentIdentityKey\(\)\)/.test(navFn),
    'navigateTo() stamps whose data it just painted — the guard that stops the NEXT player capturing this one\'s text [structural]');
  assert(/currentIdentityKey\(\)/.test(navFn),
    'navigateTo() passes the account+league+player identity key as the owner — the same tuple applyIdentityDeltaIfChanged() compares [structural]');
  assert(/restoreDirtyFields\(_fieldSnap, [\s\S]{0,120}?priorTab === tab/.test(navFn)
      || /priorTab === tab[\s\S]{0,200}?restoreDirtyFields\(/.test(navFn),
    'a restore only happens when the repaint painted the SAME tab it captured from [structural]');

  assert(/import \{[^}]*captureDirtyFields[^}]*\} from '\.\/field-preserve\.js'/.test(uiSrc),
    'chat-ui.js imports it too — renderChatPage() is reached from four places that never go through navigateTo() [structural]');
  const renderFn = (uiSrc.match(/export function renderChatPage\(\)[\s\S]*?\n\}/) || uiSrc.match(/function renderChatPage\(\)[\s\S]*?\n\}/) || [''])[0];
  assert(/skipIds: \['chat-input'\]/.test(uiSrc),
    'the composer is EXCLUDED from the generic pass — chat-ui.js carries it itself because a restored draft also needs its autosize height and char count [structural]');
  assert(/isComposing/.test(uiSrc), 'chat-ui.js consults the IME guard [structural]');
}

// ── §16 #page-chat has ONE owner (reviewer BLOCK on d554ae3) ────────────────
// navigateTo() and renderChatPage() both stamped #page-chat, with different key
// formats; the last stamp killed the other's next capture, so the ⚙ panel lost
// the edit on roughly every other repaint. chat-ui.js owns the node; app.js must
// neither capture, restore nor stamp it.
console.log('\n[16] #page-chat is stamped by chat-ui.js alone…');
{
  storage.clearSession(); storage.setSession('p1', false, true);
  chatUi.renderChatPage();
  if (!document.getElementById('pref-nick')) document.getElementById('chat-prefs-btn')?._fire('click');
  let nick = document.getElementById('pref-nick');
  assert(!!nick, 'fixture: the ⚙ panel is open');
  // Non-vacuity: a FOREIGN stamp on the node (what app.js used to write) really does kill the next capture.
  nick.value = 'HalfTyped'; nick.focus();
  fp.stampFieldOwner(PAGE, 'acct\u241flg\u241fp1');
  chatUi.renderChatPage();
  assert(document.getElementById('pref-nick')?.value !== 'HalfTyped',
    'fixture: a second stamper with a different key format DOES lose the edit — the hazard is real, so the rule below is load-bearing');
  // The rule, on comment-blanked app.js source.
  const blank = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const appCode = blank(await readFile(new URL('./js/app.js', import.meta.url), 'utf8'));
  assert(/const _fieldSnap = _priorTab === 'chat' \? null : captureDirtyFields\(/.test(appCode),
    'navigateTo() does not CAPTURE from #page-chat');
  const stampAt = appCode.indexOf('stampFieldOwner(_pageEl');
  const guardAt = appCode.lastIndexOf("if (tab !== 'chat') {", stampAt);
  assert(stampAt > 0 && guardAt > 0 && stampAt - guardAt < 1200 && appCode.slice(guardAt, stampAt).includes('restoreDirtyFields('),
    'navigateTo() neither RESTORES into nor STAMPS #page-chat — both sit inside `if (tab !== \'chat\')`');
  assert((appCode.match(/stampFieldOwner\(/g) || []).length === 1,
    'and that is app.js\'s only stampFieldOwner() call site');
  // And with a single owner, repeated repaints keep the edit every time, not every other time.
  nick = document.getElementById('pref-nick'); nick.value = 'StillHere'; nick.focus();
  for (let i = 0; i < 4; i++) chatUi.renderChatPage();
  assert(document.getElementById('pref-nick')?.value === 'StillHere', 'four repaints in a row all keep the edit');
  document.getElementById('pref-nick').value = document.getElementById('pref-nick').defaultValue;
}

// ── Result ───────────────────────────────────────────────────────────────────
globalThis.setTimeout = _realSetTimeout;
process.stdout.write(`\n${'─'.repeat(70)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n${'─'.repeat(70)}\n`,
  () => process.exit(fail === 0 ? 0 : 1));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
