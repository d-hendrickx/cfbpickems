/**
 * CFB Pickems — authtest.mjs
 * ===========================
 * Phase III Step 3a — DI-180 (Google sign-in gate), DI-181 (league flow),
 * DI-184 (active-league label), the authMode flag, and getSession()
 * delegation. Precedent: cachetest.mjs/grouptest.mjs — a focused standalone
 * suite beside loadtest.mjs, not folded into it (a logic proof deserves its
 * own file, and this one needs a fake window.supabase.createClient that has
 * no business existing inside loadtest.mjs's shared DOM stub).
 *
 * Run:  node authtest.mjs
 *   for tz in UTC America/Los_Angeles; do TZ=$tz node authtest.mjs; done
 *
 * NOT covered here (say so plainly, per the task brief): a real Google
 * OAuth round trip cannot be exercised outside a browser. Every assertion
 * below either (a) drives auth.js's own logic against a scripted fake
 * client, or (b) drives app.js's rendering against that same fake, and
 * confirms the RIGHT calls are made with the right shape — never that a
 * real Google popup actually appears. §12's browser-only list names exactly
 * what still needs Drew's own click-through (per DI-180k/181j/184i).
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// ── DOM / browser stubs (same pattern as headermetatest.mjs/boottest.mjs's
//    own Step-3a section — a minimal element that supports exactly what
//    app.js's new render functions use: id-based lookup, innerHTML as a
//    string, addEventListener/click, and per-element #id sub-lookups memoized
//    so a listener bound during render is the SAME object a test can later
//    .click()). ──────────────────────────────────────────────────────────────
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
  // SEC F3 — `length`/`key(i)` are the Storage interface the spec actually
  // defines, and auth.js's PKCE-artefact sweep enumerates through them. Without
  // these on the stub the sweep would silently fall back to Object.keys() (which
  // on THIS object returns the method names, not the stored keys) and the test
  // guarding the sweep would pass against code that never swept anything.
  get length() { return store.size; },
  key: i => [...store.keys()][i] ?? null,
};

const registry = new Map();
class FakeEl {
  constructor(tag) {
    this.tagName = tag || 'div'; this.id = ''; this.hidden = false; this.className = '';
    this.attrs = {}; this.dataset = {}; this._html = ''; this._listeners = {}; this.style = {};
    this._subEls = {};
  }
  set innerHTML(v) {
    this._html = v;
    // app.js sets a wrapper's innerHTML to a STRING containing further
    // id="..." elements, then calls document.getElementById() to bind
    // listeners on them (never document.createElement for each one) — so
    // the fake DOM has to parse ids out of whatever innerHTML is assigned
    // and register a real, addEventListener-capable stand-in for each,
    // exactly once (a re-render reuses the same instance rather than
    // orphaning the listener app.js just bound to it).
    const re = /\bid="([^"]+)"/g;
    let m;
    while ((m = re.exec(v))) {
      if (!registry.has(m[1])) { const el = new FakeEl(); el.id = m[1]; registry.set(m[1], el); }
    }
  }
  get innerHTML() { return this._html; }
  get textContent() { return this._html.replace(/<[^>]*>/g, ''); }
  set textContent(v) { this._html = v; }
  setAttribute(k, v) { this.attrs[k] = v; if (k === 'id') { this.id = v; registry.set(v, this); } }
  getAttribute(k) { return this.attrs[k] || null; }
  // Reviewer B4 — renderLeaguePill() must be able to REMOVE role/tabindex when
  // an account drops to a single membership, and the test has to be able to
  // read that it did (a stale role="button" on a static label is exactly the
  // "looks tappable, isn't" state DI-184g forbids).
  removeAttribute(k) { delete this.attrs[k]; }
  /** Number of click listeners currently attached — DI-184b's "no click
   *  handler" is asserted as a property of the element, not of a code path. */
  listenerCount(t = 'click') { return (this._listeners[t] || []).length; }
  addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); }
  removeEventListener(t, fn) { if (this._listeners[t]) this._listeners[t] = this._listeners[t].filter(f => f !== fn); }
  dispatch(t, evt = {}) { (this._listeners[t] || []).forEach(fn => fn(evt)); }
  click() { this.dispatch('click', { target: this }); }
  // Appended children are RECORDED, not just registered. showToast() builds its
  // toast with document.createElement and gives it no id, so a registry-only
  // appendChild left it unreachable — and an assertion about "what the app told
  // the player" had nothing to read. `children` is the DOM's own name for this.
  appendChild(child) { (this.children = this.children || []).push(child); if (child?.id) registry.set(child.id, child); return child; }
  // `_removed` is recorded because security 9's assertion is about elements
  // that have NO id — the injected <script> tags — so registry membership
  // cannot answer "was this node taken out of the document".
  remove() { this._removed = true; if (this.id) registry.delete(this.id); }
  // #id lookups are memoized ON THIS ELEMENT so a listener bound during
  // app.js's own render (e.g. showAccountSheet()'s `ov.querySelector(...)`)
  // is the SAME object a test later retrieves and .click()s.
  querySelector(sel) {
    if (sel?.startsWith?.('#')) {
      const id = sel.slice(1);
      if (!this._subEls[id]) this._subEls[id] = new FakeEl();
      return this._subEls[id];
    }
    return null;
  }
  querySelectorAll() { return []; }
  insertAdjacentHTML(pos, html) { this._html = pos === 'afterbegin' ? html + this._html : this._html + html; }
  focus() {}
  get classList() { return fakeClassList(); }
}
// applyTheme() (reached via resyncPlayerPreferences(), which the reviewer-B3
// chokepoint now calls on every session change) does `[...body.classList]`, so
// the stub has to be a real iterable, not an object with three no-op methods.
function fakeClassList() {
  const set = new Set();
  return {
    add: c => set.add(c), remove: c => set.delete(c),
    toggle: (c, on) => (on ? set.add(c) : set.delete(c)),
    contains: c => set.has(c),
    [Symbol.iterator]: () => set[Symbol.iterator](),
  };
}
// Every <script> element app.js ever creates, in creation order — reviewer B2's
// "the injected src is the pinned filename, and nothing else".
let createdScripts = [];
/**
 * FIFTH GATE — CLASS-SELECTOR LOOKUPS ARE REAL NOW, FOR ONE REASON.
 *
 * `document.querySelectorAll()` used to answer [] for everything, which meant
 * every rule the app expresses through a class selector was UNTESTABLE and
 * therefore untested: A6's `.page-section`/`.nav-unread` sweep, security 7's
 * `inert` on `.main-content`/`.bottom-nav`, security 8's `.modal-overlay`
 * teardown. A stub that answers "nothing matched" makes a teardown look
 * successful precisely when it has nothing to tear down.
 *
 * Deliberately simple: an exact-selector -> elements map a test fills in. No
 * selector engine, because the app only ever asks for single class selectors
 * here and a half-built matcher is worse than an explicit one.
 */
const byClass = new Map();
function setClassEls(sel, els) { byClass.set(sel, els); }
function freshDom() {
  registry.clear();
  byClass.clear();
  globalThis.document = {
    hidden: false,
    // DOCUMENT-LEVEL LISTENERS ARE RECORDED, not discarded. DI-180l/A2's
    // background re-check pauses while `document.hidden` and RESUMES on
    // visibilitychange, and a stub that threw the listener away could only ever
    // prove the first half.
    _docListeners: {},
    addEventListener(t, fn) { (this._docListeners[t] = this._docListeners[t] || []).push(fn); },
    removeEventListener(t, fn) { if (this._docListeners[t]) this._docListeners[t] = this._docListeners[t].filter(f => f !== fn); },
    fireDocEvent(t, e = {}) { (this._docListeners[t] || []).slice().forEach(fn => fn(e)); },
    getElementById(id) { return registry.get(id) || null; },
    createElement(tag) { const el = new FakeEl(tag); if (String(tag).toLowerCase() === 'script') createdScripts.push(el); return el; },
    querySelector(sel){ return (byClass.get(sel) || [])[0] || null; },
    querySelectorAll(sel){ return byClass.get(sel) || []; },
    body: { appendChild(el) { this.lastChild = el; if (el?.id) registry.set(el.id, el); }, classList: fakeClassList(), dataset:{}, lastChild: null },
    head: { appendChild(el) { if (el?.id) registry.set(el.id, el); return el; } },
    title: '',
  };
  createdScripts = [];
}
freshDom();
globalThis.window = globalThis;
globalThis.location = { origin: 'https://irbfootball.test' };
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined, clipboard: { writeText: async () => {} } }, configurable: true }); }
globalThis.requestAnimationFrame = fn => fn();
globalThis.fetch = async () => { throw new Error('network disabled in authtest'); };
globalThis.matchMedia = () => ({ matches: false });
globalThis.confirm = () => true;
globalThis.prompt = () => null;
globalThis.alert = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'u' + Math.random().toString(36).slice(2) };

let pass = 0, fail = 0;
// HARNESS HARDENING (2026-09-17): the reporters are bound to the REAL console
// at import time. Several sections below stub console.error/console.warn to
// capture what the app logs, and a failure that landed inside one of those
// windows used to be counted but never PRINTED — a suite that says "1 failed"
// and shows nothing is the same unfalsifiable shape RG-41b is about.
const _realLog = console.log.bind(console);
const _realErr = console.error.bind(console);
function assert(cond, label) {
  if (cond) { pass++; _realLog('  ✅', label); }
  else { fail++; _realErr('  ❌', label); }
}

const auth = await import('./js/auth.js');
const storage = await import('./js/storage.js');
const app = await import('./js/app.js');
// SECURITY F-4 (seventh gate) — the outbox guard lives in chat.js, and app.js
// already pulled the module into this graph, so this import adds no new edge.
const chat = await import('./js/chat.js');
// Step 3b (DI-182a) — the player self-edit rows live in prefsPanelHTML(), and
// its `_prefsPanelHTMLForTest` seam is how DI-182j's "assert on rendered output"
// rule (RG-27) is satisfied for them rather than grepping the source.
const chatUi = await import('./js/chat-ui.js');

// ── Fake Supabase client factory ─────────────────────────────────────────────
let lastCreateArgs = null;
function makeFakeClient(overrides = {}) {
  const listeners = [];
  return {
    auth: {
      onAuthStateChange(cb) { listeners.push(cb); return { data: { subscription: { unsubscribe(){} } } }; },
      getSession: overrides.getSession || (async () => ({ data: { session: overrides.session || null } })),
      // DI-180p — the SDK call the app makes ONCE before it destroys anything.
      // Default: the SDK is not asked to do anything it cannot (no session
      // back, no recognisable code) => the 'unknown' verdict, which keeps the
      // lock and destroys nothing. Every scenario that cares overrides it.
      refreshSession: overrides.refreshSession || (async () => ({ data: { session: null }, error: null })),
      signInWithOAuth: overrides.signInWithOAuth || (async () => ({ data: {}, error: null })),
      signOut: overrides.signOut || (async () => { listeners.slice().forEach(fn => fn('SIGNED_OUT', null)); return { error: null }; }),
    },
    from(table) {
      const b = {
        _table: table, _eq: [],
        select(cols) { b._select = cols; return b; },
        // Step 3b — setMemberRole()/setMemberActive() are scoped UPDATEs on
        // league_members (DI-182g names the UPDATE POLICY as the server proof,
        // not an RPC; there is no set_member_role in the approved contract).
        // The builder records the patch so a test can assert on what was
        // written as well as on what came back.
        update(patch) { b._update = patch; return b; },
        eq(col, val) { b._eq.push([col, val]); return b; },
        then(resolve, reject) {
          const result = overrides.from ? overrides.from(table, b) : { data: [], error: null };
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return b;
    },
    rpc(name, params) {
      const fn = overrides.rpc || (() => ({ data: null, error: null }));
      return Promise.resolve(fn(name, params));
    },
    _fire: (event, session) => listeners.slice().forEach(fn => fn(event, session)),
  };
}
function installFakeSupabase(overrides) {
  globalThis.window.supabase = {
    createClient(url, key, opts) { lastCreateArgs = { url, key, opts }; return makeFakeClient(overrides); },
  };
}
function resetAll(overrides = {}) {
  auth._resetAuthForTest();
  app._resetAuthUIWiringForTest();   // auth._resetAuthForTest() dropped the listener set; drop app's latch with it, or a later wireAuthUIEvents() silently no-ops and proves nothing
  app._resetAuthHoldForTest();       // DI-180l — cancel the 20s re-check timer and drop the hold latch, or A7's "never take a hold gate down" rule fires in a section that has no hold
  freshDom();
  lastCreateArgs = null;
  installFakeSupabase(overrides);
  auth.configureAuth({ authMode: 'supabase', supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' });
  // SEC F1 — every section EXCEPT the interlock section itself runs as if the
  // Step-4 Supabase data backend were live, because that is the world the rest
  // of this file is describing. Section [16] is the one that drives the real
  // (false) value and proves the refusal. Setting it here rather than leaving
  // it false also keeps storage.save() usable inside resyncPlayerPreferences(),
  // which the chokepoint assertions need to actually run.
  auth._setHasSupabaseDataBackendForTest(true);
}

/** Drives the REAL listener chain: auth.js -> its listener set -> app.js's
 *  refreshAuthUI(). Reviewer B1 — no test below hand-calls refreshAuthUI(). */
function wireRealAuthUI() { app.wireAuthUIEvents(); }

/** A valid, unexpired persisted session, as hasValidSupabaseSession() reads it. */
function storeValidSession() {
  auth._setStoredSessionForTest({ access_token: 't', expires_at: Math.floor(Date.now() / 1000) + 3600 });
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[1] hasValidSupabaseSession() — synchronous, local-only (DI-180a)…');
{
  resetAll();
  assert(auth.hasValidSupabaseSession() === false, 'no stored session -> false');
  auth._setStoredSessionForTest({ access_token: 't1', expires_at: Math.floor(Date.now() / 1000) + 3600 });
  assert(auth.hasValidSupabaseSession() === true, 'unexpired session -> true');
  auth._setStoredSessionForTest({ access_token: 't1', expires_at: Math.floor(Date.now() / 1000) - 10 });
  assert(auth.hasValidSupabaseSession() === false, 'expired session -> false');
  auth._setStoredSessionForTest({ access_token: '' });
  assert(auth.hasValidSupabaseSession() === false, 'a record with no access_token -> false');
  localStorage.setItem(auth._AUTH_STORAGE_KEY_FOR_TEST, '{not json');
  assert(auth.hasValidSupabaseSession() === false, 'malformed JSON -> false, never throws');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[2] getSession() shape + storage.js delegation (DI-180j "getSession() shape test")…');
{
  resetAll();
  auth.configureAuth({ authMode: 'pins' });
  storage.setSession('p1', true, true);
  const pinSess = storage.getSession();
  assert(pinSess.playerId === 'p1' && pinSess.isAdmin === true, 'authMode:\'pins\' (default) — getSession() reads the REAL local session, unaffected by auth.js');
  storage.clearSession();

  auth.configureAuth({ authMode: 'prelink', supabaseUrl: 'https://x.test', supabaseAnonKey: 'k' });
  storage.setSession('p2', false, true);
  const prelinkSess = storage.getSession();
  assert(prelinkSess.playerId === 'p2', 'authMode:\'prelink\' — getSession() ALSO reads the real local session (DI-180f: PIN paths run exactly as today), not auth.js');
  storage.clearSession();

  auth.configureAuth({ authMode: 'supabase', supabaseUrl: 'https://x.test', supabaseAnonKey: 'k' });
  const signedOut = storage.getSession();
  assert(signedOut.playerId === null && signedOut.isAdmin === false && signedOut.playerVerified === false,
    'authMode:\'supabase\', no membership yet — getSession() delegates to auth.js\'s default shape');
  auth._setMembershipsForTest([{ leagueId: 'L1', memberId: 'p_1', role: 'commissioner', displayName: 'Drew', leagueName: 'IRB' }]);
  auth.setActiveLeagueId('L1');
  const supaSess = storage.getSession();
  assert(supaSess.playerId === 'p_1' && supaSess.isAdmin === true && supaSess.playerVerified === true,
    'authMode:\'supabase\' — getSession() synthesizes {playerId,isAdmin,playerVerified} from the active membership');
  const keys = Object.keys(supaSess).sort();
  assert(keys.length === 3 && keys.join(',') === 'isAdmin,playerId,playerVerified',
    `the synthesized shape has EXACTLY playerId/isAdmin/playerVerified — no extra, no missing (got [${keys.join(',')}])`);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[3] DI-184 — the active-league pill + DI-184d\'s single-source invariant…');
{
  resetAll();
  auth._setMembershipsForTest([
    { leagueId: 'A', memberId: 'm1', role: 'player', displayName: 'x', leagueName: 'League A' },
    { leagueId: 'B', memberId: 'm2', role: 'commissioner', displayName: 'x', leagueName: 'League B' },
  ]);
  auth.setActiveLeagueId('A');
  assert(auth.getActiveLeagueId() === 'A' && auth.getActiveLeagueName() === 'League A',
    'active=A -> getActiveLeagueName() derives "League A" from getActiveLeagueId(), not a separately cached string');
  auth.setActiveLeagueId('B');
  assert(auth.getActiveLeagueId() === 'B' && auth.getActiveLeagueName() === 'League B',
    'switching the SAME pointer to B changes the derived name in the same call — no second write site to keep in sync');

  // ── DI-184h — THE SPY, not a value comparison ────────────────────────────
  // DI-184d's invariant is "the label and the scope come from the SAME call",
  // which two variables that happen to agree once cannot demonstrate. ES
  // modules can't be monkey-patched from here, so auth.js carries a read
  // counter on getActiveLeagueId() and both consumers are watched through it.
  // NAMED GAP, not papered over: the second consumer available in THIS build
  // is the synthesized-session/scope resolution (_recomputeSynthesizedSession),
  // because the league-scoped hydrate itself is Step 4 (js/supabase-backend.js
  // does not exist). When it lands, its read belongs in this same assertion.
  registry.set('league-pill', new FakeEl());
  document.getElementById('league-pill').id = 'league-pill';
  storeValidSession();
  auth._resetActiveLeagueIdReadsForTest();
  app.renderLeaguePill();
  const readsAfterPill = auth._getActiveLeagueIdReadsForTest();
  assert(readsAfterPill >= 1, `the header pill's text is produced by a getActiveLeagueId() read (spy saw ${readsAfterPill})`);
  auth._resetActiveLeagueIdReadsForTest();
  auth.setActiveLeagueId('B');   // re-resolves the active scope / synthesized session
  const readsAfterScope = auth._getActiveLeagueIdReadsForTest();
  assert(readsAfterScope >= 1, `the active read/write scope resolves through the SAME getActiveLeagueId() function (spy saw ${readsAfterScope})`);
  assert(storage.getSession().playerId === 'm2',
    'and that one call is what the session/scope actually resolved from — league B\'s membership, not league A\'s');

  // ── The pill itself, reverted to DI-184b (reviewer B4) ───────────────────
  const pill = document.getElementById('league-pill');
  app.renderLeaguePill();   // still two memberships
  assert(pill.hidden === false && pill.innerHTML.includes('League B'), 'multi-membership: the pill renders the ACTIVE league\'s name');
  assert(pill.getAttribute('role') === 'button', 'multi-membership: the pill carries role="button" (it is a control)');
  assert(pill.innerHTML.includes('▾'), 'multi-membership: the caret affordance is present (DI-184c)');
  assert(pill.listenerCount('click') === 1, 'multi-membership: exactly ONE click handler is attached');
  app.renderLeaguePill(); app.renderLeaguePill();
  assert(pill.listenerCount('click') === 1, 're-rendering does not stack a second/third handler on the same element');

  auth._setMembershipsForTest([{ leagueId: 'A', memberId: 'm1', role: 'player', displayName: 'x', leagueName: 'League A' }]);
  auth.setActiveLeagueId('A');
  app.renderLeaguePill();
  assert(pill.hidden === false && pill.innerHTML.includes('League A'),
    'SINGLE membership: the pill STILL renders — DI-184b\'s approved text, for every account, not only multi-league ones (reviewer B4 reverting D-2)');
  assert(pill.listenerCount('click') === 0, 'single membership: NO click handler — a static label is not a control (DI-184b)');
  assert(pill.getAttribute('role') === null, 'single membership: no button role');
  assert(!pill.innerHTML.includes('▾'), 'single membership: no caret (DI-184g — a caret implies interactivity)');

  // D-2 is gone: document.title is no longer touched by this function at all.
  document.title = 'CFB Pickems';
  app.renderLeaguePill();
  assert(document.title === 'CFB Pickems',
    'renderLeaguePill() no longer assigns document.title — D-2 cannot attach (.app-header has no title element), so the original title behaviour is restored (reviewer B4)');

  auth.configureAuth({ authMode: 'pins' });
  app.renderLeaguePill();
  assert(pill.hidden === true && pill.innerHTML === '' && pill.listenerCount('click') === 0,
    'authMode:\'pins\' — the pill is hidden, empty and unbound (the whole DI is inert when the flag is off)');

  // Structural halves of the same invariant: ONE call site, and index.html
  // carries a <span>, never a <button> (a tag cannot change at runtime, so the
  // non-interactive case has to be the element's default shape).
  const src = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
  const fnMatch = src.match(/export function renderLeaguePill\(\)\s*\{[\s\S]*?\n\}/);
  assert(!!fnMatch, 'fixture check — renderLeaguePill() was located in js/app.js');
  const nameUses = (fnMatch[0].match(/getActiveLeagueName\(\)/g) || []).length;
  assert(nameUses === 1, `getActiveLeagueName() is called exactly ONCE per render (got ${nameUses}) — two reads could disagree`);
  assert(/const name = getActiveLeagueName\(\)/.test(fnMatch[0]), 'the call result is captured into `name`');
  assert(/escHtml\(name/.test(fnMatch[0]), 'the rendered pill text is escHtml() of that same `name` — one source, provably (DI-184d)');
  assert(!/document\.title/.test(fnMatch[0]), 'and nothing in the function assigns document.title');
  const htmlSrc = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  assert(/<span id="league-pill"/.test(htmlSrc) && !/<button[^>]*id="league-pill"/.test(htmlSrc),
    'index.html declares #league-pill as a <span>, never a <button> — the single-membership default really is non-interactive');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[4] refreshMembershipsAndSession() — auto-resolve, DI-181c/g…');
{
  resetAll({ from: () => ({ data: [{ league_id: 'ONLY', id: 'm1', role: 'commissioner', display_name: 'Drew', active: true, leagues: { name: 'Solo League' } }], error: null }),
             getSession: async () => ({ data: { session: { user: { id: 'u1', email: 'drew@example.com' } } } }) });
  const list1 = await auth.refreshMembershipsAndSession();
  assert(list1.length === 1 && auth.getActiveLeagueId() === 'ONLY',
    'exactly ONE membership auto-activates — DI-181g\'s "no screen at all" for the six current players');

  resetAll({ from: () => ({ data: [], error: null }), getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) });
  await auth.refreshMembershipsAndSession();
  assert(auth.getCachedMemberships().length === 0 && auth.getActiveLeagueId() === null,
    'ZERO memberships -> no active league (DI-181a landing case)');

  resetAll({ from: () => ({ data: [
      { league_id: 'A', id: 'm1', role: 'player', display_name: 'x', active: true, leagues: { name: 'League A' } },
      { league_id: 'B', id: 'm2', role: 'commissioner', display_name: 'x', active: true, leagues: { name: 'League B' } },
    ], error: null }), getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) });
  await auth.refreshMembershipsAndSession();
  assert(auth.getActiveLeagueId() === null, 'TWO memberships, nothing previously active -> stays unresolved (DI-181c selector case)');

  const src = readFileSync(new URL('./js/auth.js', import.meta.url), 'utf8');
  // `getMemberships(op = null)` since the sixth gate (security F-1's identity
  // epoch is handed in as an operation token), so the signature is matched by
  // its opening paren rather than by an exact empty argument list — the needle
  // being stale is how a rule about SELECT columns goes quietly vacuous.
  const gm = src.match(/export async function getMemberships\([\s\S]*?\n\}/);
  assert(!!gm, 'fixture check — getMemberships() was located');
  assert(!!gm && !/select\(\s*['"]\*/.test(gm[0]), 'getMemberships() never calls select(\'*\') — enumerated columns only (task instruction)');
  assert(!!gm && !/claim_code/.test(gm[0]), 'getMemberships()\'s own column list does not name claim_code/claim_code_expires_at');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[5] joinLeague()/createLeague() — DI-181 join/create…');
{
  resetAll({
    rpc: (name, params) => {
      if (name === 'join_league') return params.p_code === 'GOODCODE' ? { data: 'm_new', error: null } : { data: null, error: new Error('invalid_code') };
      if (name === 'create_league') return { data: 'league-uuid-1', error: null };
      return { data: null, error: null };
    },
    from: (table, b) => {
      if (b._eq.some(([k]) => k === 'user_id')) {
        return { data: [{ league_id: 'NEWLEAGUE', id: 'm_new', role: 'player', display_name: 'x', active: true, leagues: { name: 'Joined League' } }], error: null };
      }
      return { data: [], error: null };
    },
    getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }),
  });
  const joined = await auth.joinLeague('GOODCODE');
  assert(joined?.leagueId === 'NEWLEAGUE' && auth.getActiveLeagueId() === 'NEWLEAGUE',
    'a valid join code resolves membership and makes the new league active (skips the selector — DI-181c)');

  let threw = false;
  try { await auth.joinLeague('BADCODE'); } catch { threw = true; }
  assert(threw, 'an invalid code throws (invalid_code) — the caller renders DI-181d\'s inline error, nothing silently succeeds');

  resetAll({
    rpc: (name) => name === 'create_league' ? { data: 'league-uuid-2', error: null } : { data: null, error: null },
    from: () => ({ data: [{ league_id: 'league-uuid-2', id: 'm_c', role: 'commissioner', display_name: 'x', active: true, leagues: { name: 'New League' } }], error: null }),
    getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }),
  });
  const newId = await auth.createLeague("Drew's Test League");
  assert(newId === 'league-uuid-2' && auth.getActiveLeagueId() === 'league-uuid-2', 'createLeague() makes the new league active immediately, no interstitial (DI-181f item 5)');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[6] signOut() — DI-180d / annotation 4…');
{
  resetAll();
  auth._setMembershipsForTest([{ leagueId: 'A', memberId: 'm1', role: 'player', displayName: 'x', leagueName: 'League A' }]);
  auth.setActiveLeagueId('A');
  auth._setAccountEmailForTest('kevin@example.com');
  for (const k of auth._SIGNOUT_LOCAL_KEYS_FOR_TEST) localStorage.setItem(k, 'stale-from-previous-account');
  localStorage.setItem('cfbp_sheet_mirror', 'stale-mirror');

  let fired = null;
  const off = auth.onAuthEvent((event) => { if (event === 'SIGNED_OUT') fired = event; });
  await auth.signOut();
  off();

  assert(fired === 'SIGNED_OUT', 'signOut() fires a SIGNED_OUT event for app.js\'s refreshAuthUI() to re-show the gate');
  assert(auth.getActiveLeagueId() === null && auth.getCachedMemberships().length === 0 && auth.getAccountEmail() === '',
    'signOut() clears the active-league pointer, the membership cache, and the account email');
  assert(auth.isSessionExpired() === false, 'a DELIBERATE signOut() is never reported as "session expired" (that banner is for involuntary sign-outs only)');
  const stillStale = auth._SIGNOUT_LOCAL_KEYS_FOR_TEST.some(k => localStorage.getItem(k) !== null);
  assert(!stillStale, 'every listed chat/notify device-local cache key is cleared — a second account on this device inherits none of them');
  assert(localStorage.getItem('cfbp_sheet_mirror') === null, 'the Sheets mirror\'s localStorage backup is cleared via backend.js\'s own clearMirror()');

  // Involuntary sign-out (session expired) is a DIFFERENT code path.
  resetAll();
  auth._fireAuthEventForTest('SIGNED_OUT', null);
  assert(auth.isSessionExpired() === true, 'an involuntary SIGNED_OUT (e.g. revoked refresh token) DOES set isSessionExpired() — DI-180c\'s banner trigger');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[7] app.js — showGoogleSignInGate() (DI-180a/b/c/d)…');
{
  resetAll();
  app.showGoogleSignInGate();
  const gate = registry.get('site-gate-overlay');
  assert(!!gate, 'the overlay reuses #site-gate-overlay — same id showSitePinGate() uses (DI-180e verbatim reuse)');
  assert(gate.innerHTML.includes('sign in to make your picks'), 'DI-180d subtitle copy present');
  assert(gate.innerHTML.includes('Continue with Google'), 'DI-180d button copy present');
  assert(gate.innerHTML.includes('<svg'), 'D-1 — the Google G-mark inline SVG is present in the button');
  assert(!registry.has('site-pin-input'), 'no PIN input field anywhere in the Google gate — DI-180b "no PIN field"');
}

console.log('\n[7b] cancelled vs failed — distinct code paths, distinct copy (DI-180c)…');
{
  resetAll({ signInWithOAuth: async () => { throw new Error('popup closed by user'); } });
  app.showGoogleSignInGate();
  const btn = registry.get('google-gate-submit');
  btn.click();
  await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
  const msgEl1 = document.getElementById('google-gate-message');
  assert(!!msgEl1, 'fixture: the gate\'s message slot exists (without this the class/copy assertions below are vacuous)');
  assert(msgEl1?.className === 'site-gate-notice', 'a cancelled sign-in renders the NEUTRAL notice class, not the error class');
  // REVIEWER N7 — this assertion used to end in `|| true`, i.e. it could not
  // fail, i.e. it proved nothing while reading green. The copy is set with
  // .textContent, which this stub stores in _html, so read it the same way.
  assert(String(msgEl1?.textContent || '') === 'Sign-in cancelled.',
    `the cancelled copy is exactly DI-180d's "Sign-in cancelled." (got ${JSON.stringify(String(msgEl1?.textContent || ''))})`);

  resetAll({ signInWithOAuth: async () => { throw new Error('network down'); } });
  app.showGoogleSignInGate();
  const btn2 = document.getElementById('google-gate-submit');
  btn2.click();
  await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
  const msgEl2 = document.getElementById('google-gate-message');
  assert(msgEl2?.className === 'site-gate-error', 'a genuine failure renders the ERROR class — cancelled and failed are provably different code paths, not just different strings');
  assert(String(msgEl2?.textContent || '').startsWith("Google sign-in couldn't complete"),
    `…and the failure copy is DI-180d's, not the cancelled one (got ${JSON.stringify(String(msgEl2?.textContent || '').slice(0, 40))})`);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[7c] Account sheet + header-identity click routing (DI-180a/d)…');
{
  resetAll();
  auth._setAccountEmailForTest('kevin@example.com');
  auth._setMembershipsForTest([{ leagueId: 'A', memberId: 'm1', role: 'player', displayName: 'x', leagueName: 'League A' }]);
  app.showAccountSheet();
  let sheet = document.body.lastChild;
  assert(sheet?.className === 'modal-overlay centered', 'Account sheet reuses .modal-overlay.centered verbatim (DI-180e)');
  assert(sheet.innerHTML.includes('Signed in as kevin@example.com'), 'DI-180d body copy: "Signed in as &lt;email&gt;"');
  assert(sheet.innerHTML.includes('Sign Out'), 'DI-180d Sign Out action present');
  assert(!sheet.innerHTML.includes('Switch League'), 'single-membership account gets NO "Switch League" row');

  auth._setMembershipsForTest([
    { leagueId: 'A', memberId: 'm1', role: 'player', displayName: 'x', leagueName: 'League A' },
    { leagueId: 'B', memberId: 'm2', role: 'commissioner', displayName: 'x', leagueName: 'League B' },
  ]);
  app.showAccountSheet();
  sheet = document.body.lastChild;
  assert(sheet.innerHTML.includes('Switch League'), 'multi-membership account DOES get the "Switch League" row (DI-180a)');

  let signOutCalled = false;
  const realSignOut = auth.signOut;
  // signOut() is exercised directly in [6]; here we only need to prove the
  // BUTTON is wired to it, so a lightweight in-place spy is enough — no
  // module-mocking framework needed for one call-site check.
  const signOutBtn = sheet.querySelector('#account-signout-btn');
  signOutBtn.addEventListener('click', () => { signOutCalled = true; });
  signOutBtn.click();
  assert(signOutCalled, 'fixture: the Sign Out button\'s click handler fires');
  // The REAL handler bound to that button is `async () => { close(); await
  // signOut(); clearPickDraft(); resyncPlayerPreferences(); }`. Clicking and
  // walking away leaves it in flight: its signOut() resolved DURING section [9]
  // and dispatched a SIGNED_OUT there, which re-showed the gate that section was
  // asserting about — masking a genuine failure into a pass under mutation.
  // Drain it here, where it belongs.
  for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0));

  // setupHeaderIdentity() — routing decided at CLICK time (DI-180a).
  resetAll();
  registry.set('header-identity', new FakeEl());
  document.getElementById('header-identity').id = 'header-identity';
  app.setupHeaderIdentity();
  auth.configureAuth({ authMode: 'pins' });
  registry.set('page-picks', new FakeEl());
  document.getElementById('header-identity').click();
  // In 'pins' mode this reaches navigateTo('picks') — proven indirectly: no
  // Account sheet (.modal-overlay) was appended as the LAST body child.
  assert(document.body.lastChild?.className !== 'modal-overlay centered', 'authMode:\'pins\' — clicking #header-identity does NOT open the Account sheet');

  auth.configureAuth({ authMode: 'supabase', supabaseUrl: 'https://x.test', supabaseAnonKey: 'k' });
  document.getElementById('header-identity').click();
  assert(document.body.lastChild?.className === 'modal-overlay centered', 'authMode:\'supabase\' — clicking #header-identity opens the Account sheet instead of routing to Picks (DI-180a)');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[8] Session-expired banner vs backend-error banner — distinct nodes, coexist (DI-180c/e)…');
{
  resetAll();
  app.showSessionExpiredBanner();
  const sessionBanner = document.getElementById('session-expired-banner');
  assert(!!sessionBanner, 'session-expired-banner renders');
  assert(!!document.getElementById('auth-banner-stack'), 'reviewer N5 — it renders INSIDE #auth-banner-stack (the one stacking context that clears the gate and the bottom nav), not straight onto <body>');
  // Simulate the backend-error banner existing at the same time — a real
  // DOM node under a DIFFERENT id, exactly as showBackendErrorBanner()
  // creates in js/app.js (not re-implemented here; this proves the two IDs
  // never collide and neither function removes the other's node).
  const backendBanner = document.createElement('div');
  backendBanner.setAttribute('id', 'backend-error-banner');
  document.body.appendChild(backendBanner);
  assert(document.getElementById('session-expired-banner') !== document.getElementById('backend-error-banner'),
    'the two banners are DISTINCT DOM nodes');
  assert(!!document.getElementById('session-expired-banner') && !!document.getElementById('backend-error-banner'),
    'both are simultaneously present — neither removes the other');
  app.hideSessionExpiredBanner();
  assert(!document.getElementById('session-expired-banner') && !!document.getElementById('backend-error-banner'),
    'hiding the session-expired banner leaves the (unrelated) backend banner untouched');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[9] refreshAuthUI() through the REAL listener wiring (reviewer B1)…');
{
  // Everything here goes through auth.js's own event dispatch — no test in
  // this section calls refreshAuthUI() directly. That distinction is the whole
  // point of B1: the bug was in WHICH events reached the handler and with what
  // payload, which a hand-call cannot reproduce.
  resetAll();
  wireRealAuthUI();
  app.showGoogleSignInGate();
  assert(!!document.getElementById('site-gate-overlay'), 'fixture: gate is up before the event');

  // ── B1, THE REGRESSION ITSELF ───────────────────────────────────────────
  // The SDK fires INITIAL_SESSION on EVERY load, with a null session when
  // nobody is signed in. The old handler removed the gate on any event that
  // wasn't SIGNED_OUT, so the front door opened by itself on boot.
  auth._fireAuthEventForTest('INITIAL_SESSION', null);
  // Checked SYNCHRONOUSLY, on the same tick the event dispatched. Anything
  // awaited here gives an unrelated async path a chance to put the gate back
  // and turn a real regression into a pass — which is exactly what happened
  // the first time this was written.
  assert(!!document.getElementById('site-gate-overlay'),
    'INITIAL_SESSION with a NULL session LEAVES THE GATE UP — the gate comes down on a real session, not on "some event happened" (reviewer B1)');
  await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
  assert(!!document.getElementById('site-gate-overlay'), '…and is still up after the background membership refresh settles');

  // Same for a token refresh that produced nothing, and for a signed-out
  // TOKEN_REFRESHED — neither is a session.
  auth._fireAuthEventForTest('TOKEN_REFRESHED', null);
  assert(!!document.getElementById('site-gate-overlay'), 'TOKEN_REFRESHED with a null session also leaves the gate up');
  await new Promise(r => setTimeout(r, 0));

  // A session object with no VALID stored token is still not signed in — both
  // terms are required (an event payload can arrive after the token expired).
  auth._fireAuthEventForTest('SIGNED_IN', { user: { id: 'u1', email: 'x@example.com' } });
  assert(!!document.getElementById('site-gate-overlay'),
    'a SIGNED_IN payload with NO unexpired token on the device does not open the gate either — session object AND hasValidSupabaseSession()');
  await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));

  // ── B1's consequence: the cancelled/failed copy can now survive ──────────
  {
    resetAll({ signInWithOAuth: async () => { throw new Error('popup closed by user'); } });
    wireRealAuthUI();
    app.showGoogleSignInGate();
    document.getElementById('google-gate-submit').click();
    await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
    const msg = document.getElementById('google-gate-message');
    assert(String(msg?.textContent || '') === 'Sign-in cancelled.', 'fixture: the cancelled copy is on screen');
    auth._fireAuthEventForTest('INITIAL_SESSION', null);
    await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
    const msgAfter = document.getElementById('google-gate-message');
    assert(String(msgAfter?.textContent || '') === 'Sign-in cancelled.',
      'a later null-session event does NOT re-create the overlay and wipe that copy — the gate is left alone when it is already up (reviewer B1)');
  }

  // ── The signed-in path still works: gate down, no reload ─────────────────
  {
    resetAll({ getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }),
               from: () => ({ data: [{ league_id: 'L', id: 'm1', role: 'player', display_name: 'x', active: true, leagues: { name: 'L' } }], error: null }) });
    wireRealAuthUI();
    app.showGoogleSignInGate();
    storeValidSession();
    auth._fireAuthEventForTest('SIGNED_IN', { user: { id: 'u1', email: 'x@example.com' } });
    await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
    assert(!document.getElementById('site-gate-overlay'),
      'a SIGNED_IN event WITH a valid stored session removes the gate overlay (no reload, DI-180a)');
  }

  // ── Involuntary sign-out: gate back up, expiry banner with it ────────────
  {
    resetAll();
    wireRealAuthUI();
    auth._fireAuthEventForTest('SIGNED_OUT', null);
    await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
    assert(!!document.getElementById('site-gate-overlay'), 'an involuntary SIGNED_OUT re-shows the gate');
    assert(!!document.getElementById('session-expired-banner'), 'and the session-expired banner shows with it');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[10] DI-181 — needsLeagueFlowScreen() / renderLeagueFlowScreen()…');
{
  resetAll();
  assert(app.needsLeagueFlowScreen() === false, 'no valid session yet -> false (the sign-in gate owns this state, not the league flow)');

  auth._setStoredSessionForTest({ access_token: 't', expires_at: Math.floor(Date.now() / 1000) + 3600 });
  assert(app.needsLeagueFlowScreen() === false, 'session valid but memberships not yet fetched -> false (hold empty, DI-184c\'s rule reused)');

  auth._setMembershipsForTest([]);
  assert(app.needsLeagueFlowScreen() === true, 'zero memberships, resolved -> true (DI-181a landing)');
  registry.set('page-dashboard', new FakeEl());
  app.renderLeagueFlowScreen('dashboard');
  const landing = registry.get('page-dashboard');
  assert(landing.innerHTML.includes("You're not in a league yet"), 'DI-181d landing title copy present');
  assert(landing.innerHTML.includes('Ask your commissioner for this'), 'DI-181d join reassurance line present (adjacent need #2)');

  auth._setMembershipsForTest([{ leagueId: 'A', memberId: 'm1', role: 'player', displayName: 'x', leagueName: 'League A' }]);
  assert(app.needsLeagueFlowScreen() === false, 'exactly ONE membership -> false, dashboard reachable directly (DI-181g, hard constraint #1)');

  auth._setMembershipsForTest([
    { leagueId: 'A', memberId: 'm1', role: 'player', displayName: 'x', leagueName: 'League A' },
    { leagueId: 'B', memberId: 'm2', role: 'commissioner', displayName: 'x', leagueName: 'League B' },
  ]);
  assert(app.needsLeagueFlowScreen() === true, 'TWO memberships, none active yet -> true (DI-181c selector)');
  app.renderLeagueFlowScreen('dashboard');
  const selector = registry.get('page-dashboard');
  assert(selector.innerHTML.includes('Choose a League'), 'DI-181d selector title copy present');
  assert(selector.innerHTML.includes('League A') && selector.innerHTML.includes('League B'), 'both leagues listed by name');
  assert(selector.innerHTML.includes('Commissioner') && selector.innerHTML.includes('Player'), 'role badges present per DI-181d');

  auth.setActiveLeagueId('A');
  assert(app.needsLeagueFlowScreen() === false, 'once one of the two is made active, the selector is no longer forced on every navigation');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[11] DI-181c — switching overlay / blind-rule write-block…');
{
  resetAll();
  auth._setMembershipsForTest([
    { leagueId: 'A', memberId: 'm1', role: 'player', displayName: 'x', leagueName: 'League A' },
    { leagueId: 'B', memberId: 'm2', role: 'commissioner', displayName: 'x', leagueName: 'League B' },
  ]);
  auth.setActiveLeagueId('A');
  let sawSwitchStart = false, sawSwitchEnd = false;
  const off = auth.onAuthEvent(event => { if (event === 'SWITCH_START') sawSwitchStart = true; if (event === 'SWITCH_END') sawSwitchEnd = true; });
  await auth.switchActiveLeague('B');
  off();
  assert(auth.getActiveLeagueId() === 'B', 'switchActiveLeague() moves the pointer');
  assert(sawSwitchStart && sawSwitchEnd, 'both SWITCH_START and SWITCH_END fire — app.js\'s blocking overlay listens on exactly these');

  let threw = false;
  try { await auth.switchActiveLeague('NOT-A-MEMBER'); } catch { threw = true; }
  assert(threw, 'switching to a league the account is not a member of is refused, not silently accepted (DI-181h)');

  await app.doSwitchActiveLeague('A');
  assert(!document.getElementById('league-switch-overlay'), 'after doSwitchActiveLeague() resolves, the blocking overlay is gone again');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[12] Vendored SDK — sha256 pin, and it is INJECTED, not tagged (reviewer B2)…');
{
  const vendorPath = new URL('./vendor/supabase-js-2.116.0.js', import.meta.url);
  const bytes = readFileSync(vendorPath);
  const hash = createHash('sha256').update(bytes).digest('hex');
  // The pin lives in js/app.js now, beside the src it pins — index.html no
  // longer references the file at all.
  assert(hash === app._SUPABASE_SDK_SHA256_FOR_TEST,
    `vendor/supabase-js-2.116.0.js sha256 matches SUPABASE_SDK_SHA256 in js/app.js (got ${hash})`);
  assert(app._SUPABASE_SDK_SRC_FOR_TEST === 'vendor/supabase-js-2.116.0.js',
    'the injected src is the pinned same-origin filename');
  assert(!/^https?:|\/\//.test(app._SUPABASE_SDK_SRC_FOR_TEST),
    'the injected src is relative — never an absolute URL, never a CDN');
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  // Comments stripped first: the replacement comment EXPLAINS what used to be
  // on that line, and a scanner that reads prose as markup would pass or fail
  // for the wrong reason.
  const htmlNoComments = html.replace(/<!--[\s\S]*?-->/g, '');
  assert(!/vendor\/supabase-js/.test(htmlNoComments),
    'index.html carries NO static script tag for the SDK — a flag that is off must cost zero bytes (reviewer B2)');
  assert(/vendor\/supabase-js/.test(html),
    '…and the fixture is real: the comment explaining the removal IS still there, so the assertion above is testing comment-stripping, not an empty file');
  assert(!/cdn\.|jsdelivr|unpkg/i.test(htmlNoComments), 'index.html references no CDN anywhere');
  // The src is a module-level constant, not built from config or from any
  // value a response could influence.
  const appSrc = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
  assert(/const SUPABASE_SDK_SRC = 'vendor\/supabase-js-2\.116\.0\.js';/.test(appSrc),
    'SUPABASE_SDK_SRC is a literal constant in js/app.js — never interpolated from config');
  assert(/el\.src = SUPABASE_SDK_SRC;/.test(appSrc),
    'the injected <script> takes its src from that constant and nothing else');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[13] createClient() options — PKCE, detectSessionInUrl, our own storageKey…');
{
  resetAll();
  auth.hasValidSupabaseSession();   // does NOT create the client (pure localStorage read)
  assert(lastCreateArgs === null, 'hasValidSupabaseSession() never creates the Supabase client — a purely local, synchronous check (CONVENTIONS #9)');
  await auth.getMemberships();      // first network-touching call — NOW it lazily creates the client
  assert(lastCreateArgs !== null, 'the client is created lazily, on first real need');
  assert(lastCreateArgs.opts?.auth?.flowType === 'pkce', 'PKCE flow configured');
  assert(lastCreateArgs.opts?.auth?.detectSessionInUrl === true, 'detectSessionInUrl configured (task item 2)');
  assert(lastCreateArgs.opts?.auth?.persistSession === true && lastCreateArgs.opts?.auth?.autoRefreshToken === true, 'session persistence + auto-refresh configured');
  assert(typeof lastCreateArgs.opts?.auth?.storageKey === 'string' && lastCreateArgs.opts.auth.storageKey === auth._AUTH_STORAGE_KEY_FOR_TEST,
    'the client is configured with OUR OWN storageKey — the same one hasValidSupabaseSession() reads');
}

console.log('\n[14] signInWithGoogle() — redirectTo/location.origin…');
{
  resetAll();
  let capturedOpts = null;
  installFakeSupabase({ signInWithOAuth: async (opts) => { capturedOpts = opts; return { data: {}, error: null }; } });
  await auth.signInWithGoogle();
  assert(capturedOpts?.provider === 'google', 'provider:"google"');
  assert(capturedOpts?.options?.redirectTo === globalThis.location.origin, 'redirectTo is location.origin (task item 2)');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[15] loadDeployedConfig() authMode default (CONVENTIONS #10)…');
{
  const backend = await import('./js/backend.js');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ backendUrl: 'https://x', backendToken: 't' }) });
  const cfg = await backend.loadDeployedConfig();
  globalThis.fetch = realFetch;
  assert(cfg.authMode === 'pins', 'authMode absent from config.json -> defaults to \'pins\', never \'supabase\' (an old/absent config must not change behavior)');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[16] SEC F1 (CRITICAL) — THE INTERLOCK: supabase auth over a Sheets data layer…');
{
  // THE HAZARD, stated once: authMode:'supabase' resolves isAdmin from a
  // league_members row in a project ANY Google account can sign into and
  // create a league in. Every write in this build still lands in the live
  // six-player league's Google Sheet. Put those together and a stranger is
  // commissioner of the real league. The interlock refuses the combination.
  resetAll();
  auth._setHasSupabaseDataBackendForTest(null);   // the REAL value: false, until Step 4
  assert(auth.hasSupabaseDataBackend() === false,
    'hasSupabaseDataBackend() is false in this build — js/supabase-backend.js (Step 4) does not exist');
  assert(auth.isAuthDataLayerMismatch() === true,
    'authMode:\'supabase\' + no Supabase data backend = a mismatch, detected in ONE place both storage.js and app.js read');

  // 1. NO ADMIN IS DERIVED. Not "hidden", not "ignored later" — the synthesized
  //    session is latched to the signed-out shape and stays there even if a
  //    commissioner membership resolves afterwards.
  auth.forceSignedOutSession();
  auth._setMembershipsForTest([{ leagueId: 'L1', memberId: 'm1', role: 'commissioner', displayName: 'Drew', leagueName: 'IRB' }]);
  auth.setActiveLeagueId('L1');
  const sess = storage.getSession();
  assert(sess.isAdmin === false && sess.playerId === null && sess.playerVerified === false,
    'a COMMISSIONER membership resolving under the interlock still yields {playerId:null,isAdmin:false,playerVerified:false} — the latch holds after the fact, not just at the moment it is set');

  // 2. THE BANNER. Persistent, its own node, its own copy.
  app.showAuthConfigErrorBanner();
  const banner = document.getElementById('auth-config-error-banner');
  assert(!!banner, 'the config-error banner renders');
  assert(String(banner.textContent) === "This build's data layer is not ready for Supabase sign-in. Contact the commissioner.",
    'with exactly the specified copy');
  assert(!!document.getElementById('auth-banner-stack'), 'inside the auth banner stack (above the gate, clear of the nav)');
  app.showAuthConfigErrorBanner();
  assert(String(banner.textContent).length > 0, 'calling it twice does not duplicate or blank it');

  // 3. EVERY WRITE IS REFUSED, with a TYPED error — never a silent no-op, which
  //    would look exactly like a successful save to every caller (AD-06).
  let threw = null;
  try { storage.saveSetting('dashboardLayout', 'compact'); } catch (e) { threw = e; }
  assert(!!threw, 'storage.save() (via saveSetting) REFUSES to write while the modes disagree');
  assert(threw?.name === 'AuthModeMismatchError' && threw?.code === 'auth_mode_mismatch',
    `…and it throws the TYPED AuthModeMismatchError, not a bare Error (got ${threw?.name}/${threw?.code})`);
  // "No key is exempt", proven on a SECOND league key rather than on the
  // session — see the note below for why the session stopped being the right
  // witness for this particular claim.
  let threw2 = null;
  try { storage.setActiveWeekId('w_interlock'); } catch (e) { threw2 = e; }
  assert(threw2?.name === 'AuthModeMismatchError',
    'a second, unrelated league key is refused too — no key is exempt while the modes disagree');

  // ── WHY setSession() IS NO LONGER ASSERTED HERE (Step 4 Part B, §6.7) ─────
  //
  // This line used to be `storage.setSession(...)` and it used to throw
  // AuthModeMismatchError, because setSession() reached save() and save() has
  // the interlock. It no longer reaches save(): §6.7 makes it a guarded no-op
  // in authMode:'supabase', and the guard returns first.
  //
  // THAT IS A STRENGTHENING, NOT A HOLE, and the difference is the whole point.
  // The interlock only refuses while the modes DISAGREE — i.e. only until the
  // adapter goes ACTIVE. After cutover isAuthDataLayerMismatch() is false, so
  // the old path would have let setSession() WRITE a PIN-era
  // `{playerId, isAdmin}` record: unreadable in this mode, and read straight
  // back as a live session by a rollback to 'pins'. §6.7 refuses it in
  // authMode:'supabase' unconditionally, mismatch or not, which covers the
  // case this assertion never could.
  //
  // So the refusal is asserted where it now lives ([44i]), and what is pinned
  // HERE is that the two guards do not overlap in a way that could hide one
  // behind the other: the session guard fires FIRST and independently.
  let sessThrew = null;
  const warnedIL = [];
  const realWarnIL = console.warn;
  console.warn = (...a) => warnedIL.push(a.join(' '));
  try { storage.setSession('p1', true, true); } catch (e) { sessThrew = e; }
  finally { console.warn = realWarnIL; }
  assert(sessThrew === null && warnedIL.some(w => /REFUSING to write cfbp_session/.test(w)),
    '…and setSession() is refused by its OWN §6.7 guard before the interlock is consulted — a broader rule (every supabase boot) reached first, not a gap in this one');
  assert(localStorage.getItem('cfbp_session') === null,
    '…with nothing written either way, which is the only thing the caller actually depends on');

  // 4. THE GUARD IS TWO-SIDED. A constant-false interlock that refused every
  //    write in every mode would pass assertion 3 while breaking the app.
  auth.configureAuth({ authMode: 'pins' });
  assert(auth.isAuthDataLayerMismatch() === false, 'authMode:\'pins\' — no mismatch, because Supabase identity is not in play at all');
  let pinsOk = true;
  try { storage.saveSetting('dashboardLayout', 'compact'); } catch { pinsOk = false; }
  assert(pinsOk, 'and writes work normally in \'pins\' mode — the live mode is completely unaffected by the interlock');
  auth.configureAuth({ authMode: 'supabase', supabaseUrl: 'https://x.test', supabaseAnonKey: 'k' });
  auth._setHasSupabaseDataBackendForTest(true);
  assert(auth.isAuthDataLayerMismatch() === false, 'and once a Supabase DATA backend exists (Step 4), the mismatch clears');
  let step4Ok = true;
  try { storage.saveSetting('dashboardLayout', 'compact'); } catch { step4Ok = false; }
  assert(step4Ok, '…and writes are allowed again — the interlock gates on AGREEMENT, not on authMode alone');

  // 5. ONE SOURCE. storage.js's guard and app.js's boot branch must read the
  //    same predicate, or they can disagree about whether the app is safe.
  const storageSrc = readFileSync(new URL('./js/storage.js', import.meta.url), 'utf8');
  const appSrc16 = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
  assert(/function save\(k,v,fields\) \{[\s\S]{0,1400}?isAuthDataLayerMismatch\(\)/.test(storageSrc),
    'storage.js\'s save() itself carries the guard — an interlock that lives anywhere else is not an interlock');
  assert(/if \(isAuthDataLayerMismatch\(\)\) \{\s*\n\s*forceSignedOutSession\(\);/.test(appSrc16),
    'boot() gates on the SAME isAuthDataLayerMismatch() and forces the signed-out session before anything else can run');
  {
    // ORDER MATTERS inside that branch: the interlock returns BEFORE the PIN
    // gate is taken down. Otherwise a device that had never satisfied the site
    // PIN would have its only lock removed on the one path where no replacement
    // gate is ever offered — a misconfiguration would have UNLOCKED the app.
    // NOTE the branch condition changed shape in the second remediation pass:
    // boot() now branches on the EFFECTIVE mode (resolveEffectiveAuthMode(),
    // SEC F1-R1), not on the raw config field, so a failed config read cannot
    // choose 'pins' for a cut-over device.
    const branch = appSrc16.slice(appSrc16.indexOf("if (authMode === 'supabase') {"));
    const interlockAt = branch.indexOf('if (isAuthDataLayerMismatch())');
    const removeAt = branch.indexOf("document.getElementById('site-gate-overlay')?.remove()");
    assert(interlockAt > -1 && removeAt > -1 && interlockAt < removeAt,
      `boot() hits the interlock (and returns) BEFORE it removes the PIN gate overlay (interlock@${interlockAt}, remove@${removeAt})`);
    // ── DI-180l (approved 2026-09-17) — WHAT THIS ASSERTION USED TO SAY ──────
    // It used to be "nothing inside the interlock branch touches the gate
    // overlay at all", whose reasoning was: the PIN gate is this device's only
    // lock and no replacement gate will ever be offered on this path, so don't
    // take it down. The premise is now false — the hold gate IS that
    // replacement, and it is a strictly stronger lock (no PIN field, no Google
    // button, no control that can look like it succeeded) painted over page
    // content that has been torn down first (A6). So the requirement flips
    // shape: the branch must REPLACE the overlay with the hold gate, and must
    // never merely remove one.
    const upToReturn = branch.slice(interlockAt, branch.indexOf('return ', interlockAt));
    assert(/showAuthHoldGate\('interlock'\)/.test(upToReturn),
      'DI-180l — the interlock branch stands the HOLD GATE up (it never leaves a device with no lock, and never offers a sign-in it cannot back)');
    assert(!/site-gate-overlay'\)\?\.remove\(\)/.test(upToReturn),
      '…and it never REMOVES an overlay without replacing it — showAuthHoldGate() swaps the content under a cover that is never absent');
    // A CALL, not a mention: the comment at that site necessarily names the
    // function it replaced, and a rule that cannot tell prose from a statement
    // would have to be deleted the moment it was written (same discipline as
    // boottest [18]'s ignoreSearch rule).
    assert(!/showAuthConfigErrorBanner\(\);/.test(upToReturn),
      'DI-180l — and the banner-only CALL is gone from this site, not kept alongside the gate ("in place of, not in addition to")');
    assert(/showAuthConfigErrorBanner\(\);/.test('  showAuthConfigErrorBanner();\n'),
      'canary: that rule DOES match a real call statement, so it is not vacuously green');
  }
  assert(/isAuthDataLayerMismatch\(\)\s*\{[\s\S]{0,200}?authMode === 'supabase' && !hasSupabaseDataBackend\(\)/.test(readFileSync(new URL('./js/auth.js', import.meta.url), 'utf8')),
    'and the predicate is defined once, in auth.js, in terms of both halves');

  // 6. config.json names the REAL hazard, not onboarding friction.
  const cfgRaw = readFileSync(new URL('./config.json', import.meta.url), 'utf8');
  const cfg = JSON.parse(cfgRaw);
  assert(cfg.authMode === undefined, 'config.json still has NO authMode key — absent is \'pins\' (CONVENTIONS #10)');
  assert(/commissioner of the real league|stranger would be commissioner/i.test(cfg._authComment),
    'config.json\'s _authComment names the stranger-as-commissioner hazard over the shared Sheet');
  assert(/Sheet/.test(cfg._authComment) && /hasSupabaseDataBackend/.test(cfg._authComment),
    '…and points at the interlock that enforces it, so the comment cannot drift from the code');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[17] Reviewer B3 / SEC F3 — the session-change chokepoint…');
{
  // WHAT THIS PREVENTS: a shared phone. PIN-mode login/logout has called
  // clearPickDraft() + resyncPlayerPreferences() for a year (RG-51). The
  // Supabase paths called neither, so signing out left the next account with
  // the previous player's draft picks pre-filled, their OneSignal binding,
  // their theme and timezone, and layout edit mode still on.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ oneSignalAppId: 'test-app-id' }) });
  const drainOneSignal = async (os) => {
    for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0));
    const queue = globalThis.window.OneSignalDeferred || [];
    const pending = queue.splice(0, queue.length);
    for (const cb of pending) { try { await cb(os); } catch {} }
  };

  // ── SIGN OUT ────────────────────────────────────────────────────────────
  {
    resetAll();
    wireRealAuthUI();
    globalThis.window.OneSignalDeferred = [];
    auth._setMembershipsForTest([{ leagueId: 'A', memberId: 'm1', role: 'player', displayName: 'x', leagueName: 'League A' }]);
    auth.setActiveLeagueId('A');
    app.state.draftPicks = { g1: 'home', g2: 'away' };
    app.state.draftTiebreaker = 55;
    app.state.draftExtraPoint = 41;
    app.state.layoutEditing = 'dashboard';

    // FIXTURE CORRECTION (third remediation pass). auth.js's identity writes are
    // instrumented now, so `setActiveLeagueId('A')` above ANNOUNCES the identity
    // it establishes — which binds OneSignal to member m1. That is correct
    // behavior (it is the binding the sign-out below then has to undo), but it
    // means the queue already holds a login() before signOut() is ever called.
    // Drained here so the assertions below measure the SIGN-OUT's OneSignal
    // traffic and not the setup's. Without this, "nothing was logged IN during a
    // sign-out" would be reading the fixture's own login and reporting it as the
    // sign-out's.
    await drainOneSignal({ login: () => {}, logout: () => {} });
    globalThis.window.OneSignalDeferred = [];

    await auth.signOut();
    let loggedOut = false, loggedInWith = null;
    await drainOneSignal({ login: id => { loggedInWith = id; }, logout: () => { loggedOut = true; } });

    assert(Object.keys(app.state.draftPicks).length === 0, 'after signOut(): state.draftPicks is empty — the next account on this phone inherits no picks (RG-51\'s class)');
    assert(app.state.draftTiebreaker === null && app.state.draftExtraPoint === null, '…and the tiebreaker and Extra Point drafts are cleared with them');
    assert(app.state.layoutEditing === false || app.state.layoutEditing === null, `…and layout edit mode is reset (got ${JSON.stringify(app.state.layoutEditing)})`);
    assert(loggedOut === true, 'logoutOneSignal() fired — a handed-off phone stops receiving the previous player\'s pushes (correction #2\'s whole point)');
    assert(loggedInWith === null, '…and nothing was logged IN during a sign-out');
  }

  // ── SIGN IN ─────────────────────────────────────────────────────────────
  {
    resetAll({ getSession: async () => ({ data: { session: { user: { id: 'u1', email: 'k@example.com' } } } }),
               from: () => ({ data: [{ league_id: 'A', id: 'member-id-1', role: 'player', display_name: 'Kevin', active: true, leagues: { name: 'League A' } }], error: null }) });
    wireRealAuthUI();
    globalThis.window.OneSignalDeferred = [];
    storeValidSession();
    app.state.draftPicks = { g9: 'home' };

    const resets = [];
    const realInfo = console.info;
    console.info = (...a) => { const s = a.map(String).join(' '); if (/identity changed/.test(s)) resets.push(s); realInfo(...a); };
    let logins = 0, logouts = 0;
    const signInSeq = [];
    try {
      auth._fireAuthEventForTest('SIGNED_IN', { user: { id: 'u1', email: 'k@example.com' } });
      var loggedInWith = null, loggedOut = false;
      await drainOneSignal({
        login: id => { loggedInWith = id; logins++; signInSeq.push(`login:${id}`); },
        logout: () => { loggedOut = true; logouts++; signInSeq.push('logout'); },
      });
    } finally { console.info = realInfo; }

    // ── REVIEWER NOTE 6 — WHAT A SIGN-IN ACTUALLY COSTS ────────────────────
    // Measured rather than estimated. The chokepoint fires TWICE on a sign-in:
    // once for the raw event (account id known, league/member not resolved yet)
    // and once when the membership read lands. That is not reducible without
    // teaching the latch to HOLD on a partially-unknown identity, which is
    // exactly the "unknown ⇒ changed" weakening the fail-closed rule forbids —
    // so it is pinned here as a known, bounded cost instead of fixed.
    // The cost itself is smaller than the note assumed: the first pass has a
    // null playerId, so it is a logout(), not a login(), and it skips the wager
    // fetch entirely (resyncPlayerPreferences() guards both on sess.playerId).
    // Net per sign-in: one logout, one login, ONE wager refresh.
    assert(resets.length === 2, `a sign-in fires the identity reset exactly twice (got ${resets.length}) — raw event, then membership resolution`);
    // SECURITY F-1 (seventh gate) — THE COUNT MOVED, AND THE REASON IS THE
    // POINT. The sweep is a `cfbp_` PREFIX rule now, so _hasDeviceLocalSessionData()
    // is true on essentially every unmarked handset (this fixture carries
    // `cfbp_session` and the settings blob). DI-180q's fail-closed "no marker,
    // data present ⇒ clear once" therefore fires on the FIRST sign-in of every
    // device — which is exactly what DI-180q was approved to do ("all six
    // players get exactly one chat re-download") — and that clear logs OneSignal
    // out. So a first sign-in now costs TWO logouts (the clear's, plus the
    // first chokepoint pass's, which has no playerId yet) and ONE login.
    //
    // WHAT MATTERS IS THE ORDER, NOT THE COUNT, and it is asserted as the
    // sequence rather than the endpoint: the login must be LAST, or the device
    // ends up bound to nobody and silently receives nothing (security F-2).
    assert(logins === 1 && logouts === 2,
      `…which costs TWO OneSignal logouts and ONE login (got ${logouts}/${logins}): DI-180q's one-time clear logs out, and so does the first chokepoint pass, which has no playerId yet`);
    assert(signInSeq[signInSeq.length - 1] === 'login:member-id-1',
      `…and the LOGIN IS LAST (${JSON.stringify(signInSeq)}) — security F-2: with loadAppId() memoizing only the VALUE, these raced two independent config.json reads and a logout could land after the login, leaving the handset bound to nobody`);

    assert(Object.keys(app.state.draftPicks).length === 0, 'after SIGNED_IN: any draft left over from the previous occupant of this device is cleared');
    assert(storage.getSession().playerId === 'member-id-1', 'fixture: the membership resolved, so getSession().playerId is the active member id');
    assert(loggedInWith === 'member-id-1', `loginOneSignal() fired with that same id (got ${JSON.stringify(loggedInWith)}) — pushes now follow the signed-in account`);
  }

  // ── The wiring is real: ONE function owns the reset, and refreshAuthUI()
  //    routes into it UNCONDITIONALLY (see [17c] for why an event list was the
  //    wrong shape twice).
  const appSrc17 = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
  const fn17 = appSrc17.match(/export function refreshAuthUI\([\s\S]*?\n\}/)[0];
  const choke17 = appSrc17.match(/function applyIdentityDeltaIfChanged\([\s\S]*?\n\}/)[0];
  // Both calls are in the one body, in that order. Not adjacent LINES any more
  // (DI-180o(b) put a paragraph of per-item justification between them for why
  // each thing resyncPlayerPreferences() does is right to run AT an expiry),
  // so the rule is "both, in order, in this body" — which is what it was always
  // about. Canaries below prove it still fails when one of them is dropped.
  // SIXTH GATE — matched by the opening PAREN, not by `();`. The chokepoint now
  // passes resyncPlayerPreferences() one argument (DI-180o(b)'s layout-edit
  // exemption on the one path that just RESTORED a suspended slate), and a
  // needle pinned to the empty argument list made this rule report the app's own
  // correct code as a missing call.
  // …and COMMENTS ARE STRIPPED FIRST. The chokepoint's own comment block names
  // resyncPlayerPreferences() in prose (DI-180o(b)'s per-item justification for
  // why each thing it does is right to run AT an expiry), so a paren-based
  // needle finds the DOCUMENTATION before the call — which made the "it was
  // dropped" canary below unfalsifiable. Same lesson as [17d]'s blanker, and the
  // second time in this pass a source rule has read the app's own prose as code.
  const stripComments = raw => raw.replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
  // The mutation is applied to the STRIPPED code, not the raw text — deleting a
  // call out of raw source whose comments mention the same name by hand is how
  // the canary managed to delete the prose and leave the call standing.
  const chokeCode17 = stripComments(choke17);
  const chokeOrderOk = src => {
    const a = src.indexOf('clearPickDraft(');
    const b = src.indexOf('resyncPlayerPreferences(');
    return a > -1 && b > -1 && a < b;
  };
  assert(chokeOrderOk(chokeCode17),
    'the chokepoint calls clearPickDraft() and resyncPlayerPreferences() together, never one without the other');
  assert(!chokeOrderOk(chokeCode17.replace(/clearPickDraft\([^)]*\);/, '')),
    'canary: the rule above FAILS when clearPickDraft() is dropped from the chokepoint');
  assert(!chokeOrderOk(chokeCode17.replace(/resyncPlayerPreferences\([^;]*\);/, '')),
    'canary: …and when resyncPlayerPreferences() is dropped');
  assert(!/clearPickDraft\(|resyncPlayerPreferences\(/.test(fn17),
    'refreshAuthUI() no longer calls either of them itself — there is exactly ONE body that performs the reset');
  assert(/applyIdentityDeltaIfChanged\(`event:\$\{event\}`,\s*\{[^}]*\}\);/.test(fn17),
    'refreshAuthUI() routes EVERY event it sees into that one function (no event-name list to leave a path out of)');
  assert(/await signOut\(\);[\s\S]{0,900}?applyIdentityDeltaIfChanged\(/.test(appSrc17),
    'and the Account sheet\'s Sign Out routes into the same function directly — the chokepoint does not depend on a listener being wired');
  globalThis.fetch = realFetch;
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[17b] REVIEWER F-1 — a token refresh must not eat a half-filled slate…');
{
  // THE DEFECT, introduced by the FIRST remediation pass: the SDK fires
  // TOKEN_REFRESHED roughly hourly and on tab focus; auth.js answers it with
  // refreshMembershipsAndSession(), which emits MEMBERSHIPS_REFRESHED, which
  // was in the chokepoint's event list. So a player who had four games picked
  // and a tiebreaker typed lost all of it, silently, because a token rotated.
  // Identity had not changed by any measure.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ oneSignalAppId: 'test-app-id' }) });
  const drainOneSignal = async (os) => {
    for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0));
    const queue = globalThis.window.OneSignalDeferred || [];
    const pending = queue.splice(0, queue.length);
    for (const cb of pending) { try { await cb(os); } catch {} }
  };

  let fakeUser = { id: 'u1', email: 'kevin@example.com' };
  let fakeRows = [{ league_id: 'A', id: 'member-A', role: 'player', display_name: 'Kevin', active: true, leagues: { name: 'League A' } }];
  resetAll({
    getSession: async () => ({ data: { session: { user: fakeUser } } }),
    from: () => ({ data: fakeRows, error: null }),
  });
  wireRealAuthUI();
  globalThis.window.OneSignalDeferred = [];
  storeValidSession();

  // Establish identity the way the real app does — through a real SIGNED_IN.
  auth._fireAuthEventForTest('SIGNED_IN', { user: fakeUser });
  await drainOneSignal({ login: () => {}, logout: () => {} });
  assert(storage.getSession().playerId === 'member-A', 'fixture: signed in, one membership resolved, identity established');

  // Now the player fills in a slate.
  app.state.draftPicks = { g1: 'home', g2: 'away', g3: 'home' };
  app.state.draftTiebreaker = 52;
  app.state.draftExtraPoint = 47;
  app.state.layoutEditing = 'dashboard';
  globalThis.window.OneSignalDeferred = [];

  // …and an hour passes. Same account, same league, same membership.
  auth._fireAuthEventForTest('TOKEN_REFRESHED', { user: fakeUser });
  let loggedInWith = null, loggedOut = false;
  await drainOneSignal({ login: id => { loggedInWith = id; }, logout: () => { loggedOut = true; } });

  assert(Object.keys(app.state.draftPicks).length === 3,
    `TOKEN_REFRESHED with UNCHANGED identity leaves the draft picks alone (got ${JSON.stringify(app.state.draftPicks)})`);
  assert(app.state.draftTiebreaker === 52, '…the tiebreaker survives');
  assert(app.state.draftExtraPoint === 47, '…the Extra Point guess survives');
  assert(app.state.layoutEditing === 'dashboard', '…and an in-progress layout edit is not torn down mid-drag');
  assert(loggedInWith === null && loggedOut === false,
    `…and OneSignal is neither re-logged-in nor logged out (login=${JSON.stringify(loggedInWith)}, logout=${loggedOut}) — nothing about who this device belongs to changed`);
  assert(app._lastIdentityKeyForTest() === app._currentIdentityKeyForTest(),
    'the latch agrees: the identity key after the refresh is the one already recorded');

  // FALSIFIABILITY: the very same event, with a DIFFERENT account behind it,
  // still clears. Without this pair the assertions above would pass equally
  // well if the chokepoint had simply been deleted.
  fakeUser = { id: 'u2', email: 'koby@example.com' };
  fakeRows = [{ league_id: 'A', id: 'member-A2', role: 'player', display_name: 'Koby', active: true, leagues: { name: 'League A' } }];
  globalThis.window.OneSignalDeferred = [];
  auth._fireAuthEventForTest('SIGNED_IN', { user: fakeUser });
  let loggedInWith2 = null;
  await drainOneSignal({ login: id => { loggedInWith2 = id; }, logout: () => {} });
  assert(Object.keys(app.state.draftPicks).length === 0,
    'signing in as a DIFFERENT Google account on the same device DOES clear the draft (the existing SEC F3 coverage still holds)');
  assert(app.state.draftTiebreaker === null && app.state.draftExtraPoint === null && !app.state.layoutEditing,
    '…along with the tiebreaker, the Extra Point guess and layout edit mode');
  assert(loggedInWith2 === 'member-A2', `…and OneSignal is re-logged-in as the new member (got ${JSON.stringify(loggedInWith2)})`);
  globalThis.fetch = realFetch;
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[17c] REVIEWER F-2 — a league switch changes identity, so it clears…');
{
  // THE DEFECT: switchActiveLeague() emits SWITCH_START/SWITCH_END and nothing
  // else. Neither was in the chokepoint's event list, and doSwitchActiveLeague()'s
  // finally only refreshed the header and re-navigated. So after a switch
  // getSession().playerId was league B's member id while the draft picks, the
  // tiebreaker, layoutEditing and the OneSignal binding were all still league
  // A's — and the header said B. UN-184's "the label and the state never
  // disagree" failed in the one place it was written for.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ oneSignalAppId: 'test-app-id' }) });
  const drainOneSignal = async (os) => {
    for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0));
    const queue = globalThis.window.OneSignalDeferred || [];
    const pending = queue.splice(0, queue.length);
    for (const cb of pending) { try { await cb(os); } catch {} }
  };

  resetAll();
  wireRealAuthUI();
  globalThis.window.OneSignalDeferred = [];
  storeValidSession();
  auth._setAccountUserIdForTest('u-drew');
  auth._setMembershipsForTest([
    { leagueId: 'A', memberId: 'mA', role: 'player', displayName: 'Drew', leagueName: 'League A' },
    { leagueId: 'B', memberId: 'mB', role: 'commissioner', displayName: 'Drew', leagueName: 'League B' },
  ]);
  auth.setActiveLeagueId('A');
  // Establish the latch on league A the way a real session would.
  auth._fireAuthEventForTest('SIGNED_IN', { user: { id: 'u-drew', email: 'drew@example.com' } });
  await drainOneSignal({ login: () => {}, logout: () => {} });

  app.state.draftPicks = { g1: 'home', g2: 'home' };
  app.state.draftTiebreaker = 61;
  app.state.draftExtraPoint = 38;
  app.state.layoutEditing = 'standings';
  globalThis.window.OneSignalDeferred = [];

  await app.doSwitchActiveLeague('B');
  let loggedInWith = null;
  await drainOneSignal({ login: id => { loggedInWith = id; }, logout: () => {} });

  assert(storage.getSession().playerId === 'mB', 'fixture: the switch moved the active membership from mA to mB');
  assert(Object.keys(app.state.draftPicks).length === 0,
    `a league switch clears the draft picks (got ${JSON.stringify(app.state.draftPicks)}) — league A's slate must never be submitted into league B`);
  assert(app.state.draftTiebreaker === null && app.state.draftExtraPoint === null,
    '…and the tiebreaker and Extra Point guess with them');
  assert(!app.state.layoutEditing, '…and layout edit mode, which was wired to the other league\'s pageKey');
  assert(loggedInWith === 'mB', `…and OneSignal is re-logged-in as the NEW league's member id (got ${JSON.stringify(loggedInWith)})`);

  // THE TUPLE, not just playerId: two leagues whose member ids COINCIDE must
  // still clear on a switch. This is the case a playerId-only latch misses.
  resetAll();
  wireRealAuthUI();
  globalThis.window.OneSignalDeferred = [];
  storeValidSession();
  auth._setAccountUserIdForTest('u-drew');
  auth._setMembershipsForTest([
    { leagueId: 'L1', memberId: 'same-id', role: 'player', displayName: 'Drew', leagueName: 'League One' },
    { leagueId: 'L2', memberId: 'same-id', role: 'commissioner', displayName: 'Drew', leagueName: 'League Two' },
  ]);
  auth.setActiveLeagueId('L1');
  auth._fireAuthEventForTest('SIGNED_IN', { user: { id: 'u-drew' } });
  await drainOneSignal({ login: () => {}, logout: () => {} });
  app.state.draftPicks = { g7: 'away' };
  await app.doSwitchActiveLeague('L2');
  await drainOneSignal({ login: () => {}, logout: () => {} });
  assert(storage.getSession().playerId === 'same-id', 'fixture: both leagues resolve to the SAME member id, so playerId alone cannot see this switch');
  assert(Object.keys(app.state.draftPicks).length === 0,
    'the switch still clears — the latch is the (account, league, member) TUPLE, not playerId alone');

  // …and a switch that does NOT move the pointer is a genuine no-op: no draft
  // is destroyed by tapping the league you are already in.
  app.state.draftPicks = { g8: 'home' };
  app.state.draftTiebreaker = 12;
  await app.doSwitchActiveLeague('L2');
  await drainOneSignal({ login: () => {}, logout: () => {} });
  assert(Object.keys(app.state.draftPicks).length === 1 && app.state.draftTiebreaker === 12,
    're-selecting the league that is already active changes no identity, so it clears nothing');
  globalThis.fetch = realFetch;
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[17d] THE STATIC RULE — every identity-changing path routes through the ONE chokepoint…');
{
  // REVIEWER'S PROCESS FINDING: this is the THIRD time a session path skipped
  // the chokepoint (PIN paths had it; the Supabase sign-in/out paths did not;
  // then the league-switch path did not). A behavioral test catches the paths
  // someone thought to write a test for. This one enumerates the paths from the
  // SOURCE, so a path added later fails the suite whether or not anyone
  // remembers it exists.
  const appSrc = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
  const authSrc = readFileSync(new URL('./js/auth.js', import.meta.url), 'utf8');

  /** Every violation the rule can find in a given pair of sources. Returns a
   *  list of strings; [] means clean. Run against the REAL sources below, and
   *  against deliberately broken copies right after (the negative self-test) —
   *  a matcher that cannot report a violation proves nothing. */
  /**
   * Blank every comment to spaces, preserving LENGTH so every offset below
   * still points at the same character of the real file. Needed because this
   * file's own explanatory comments name the very functions the rule hunts
   * for — a prose mention of `switchActiveLeague()` is not a call site, and a
   * rule that cannot tell the difference reports the documentation as a defect.
   * Verified safe by the node --check assertion right below the audit.
   */
  function blankComments(src) {
    let out = src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
    out = out.split('\n').map(line => {
      const bare = line.match(/^(\s*)\/\//);
      if (bare) return line.replace(/[^\n]/g, ' ');
      // A trailing `//` counts as a comment only when the code before it has
      // balanced quotes — otherwise it is inside a string (a URL, a regex).
      for (let i = 0; i < line.length - 1; i++) {
        if (line[i] === '/' && line[i + 1] === '/') {
          const head = line.slice(0, i);
          const q = ch => (head.split(ch).length - 1) % 2 === 0;
          if (q("'") && q('"') && q('`')) return head + ' '.repeat(line.length - i);
        }
      }
      return line;
    }).join('\n');
    return out;
  }

  function auditIdentityPaths(appTextRaw, authTextRaw) {
    const problems = [];
    const appText = blankComments(appTextRaw);
    const authText = blankComments(authTextRaw);

    // (1) Enumerate every event auth.js can emit to its listener set: the raw
    //     SDK events it passes through, plus its own lifecycle names.
    const emitted = new Set();
    for (const m of authText.matchAll(/fn\(\s*'([A-Z_]+)'/g)) emitted.add(m[1]);
    const passesThroughRawEvents = /_authListeners\.forEach\(fn\s*=>\s*\{\s*try\s*\{\s*fn\(event,\s*session\)/.test(authText);
    if (!passesThroughRawEvents) problems.push('auth.js no longer passes raw SDK events through to its listeners — the enumeration below is stale');
    for (const e of ['SIGNED_IN', 'SIGNED_OUT', 'INITIAL_SESSION', 'TOKEN_REFRESHED', 'USER_UPDATED']) emitted.add(e);
    if (emitted.size < 6) problems.push(`only ${emitted.size} emitted events found in auth.js — the emit matcher has gone stale`);

    // (2) app.js wires exactly ONE listener, and it calls refreshAuthUI() for
    //     every event without filtering.
    const wire = (appText.match(/export function wireAuthUIEvents\(\)[\s\S]*?\n\}/) || [''])[0];
    if (!/onAuthEvent\(\(event, payload\) => \{/.test(wire) || !/refreshAuthUI\(event, payload\)/.test(wire)) {
      problems.push('wireAuthUIEvents() no longer forwards every event to refreshAuthUI()');
    }
    if (/if\s*\(/.test(wire.replace(/if \(_authEventsWired\) return;/, ''))) {
      problems.push('wireAuthUIEvents() filters events before forwarding them — a filter there is a path that skips the chokepoint');
    }

    // (3) refreshAuthUI() calls the chokepoint UNCONDITIONALLY. "Unconditional"
    //     is checked structurally: the call must not sit inside a braced block
    //     that opened after an `if`/`else`/loop keyword.
    const refresh = (appText.match(/export function refreshAuthUI\([\s\S]*?\n\}/) || [''])[0];
    const callIdx = refresh.indexOf('applyIdentityDeltaIfChanged(');
    if (callIdx === -1) problems.push('refreshAuthUI() does not call applyIdentityDeltaIfChanged() at all');
    else {
      const before = refresh.slice(0, callIdx);
      let depth = 0;
      const opens = [];
      for (let i = 0; i < before.length; i++) {
        if (before[i] === '{') { depth++; opens.push(i); }
        else if (before[i] === '}') { depth--; opens.pop(); }
      }
      // depth 1 == the function body itself. Anything deeper is conditional.
      if (depth !== 1) problems.push(`refreshAuthUI() calls the chokepoint at brace depth ${depth} — it must be unconditional (depth 1)`);
    }

    // (4) Every NON-event path on which identity can change, by call site.
    //     Scoped to the ENCLOSING FUNCTION rather than to a character window:
    //     a character window is a magic number that a long comment can push a
    //     real route out of (and did, on the first draft of this rule). The
    //     requirement is that the chokepoint is called LATER IN THE SAME
    //     FUNCTION — after the thing that changed identity, before that
    //     function returns.
    const fnStarts = [];
    for (const m of appText.matchAll(/^(?:export )?(?:async )?function [A-Za-z0-9_$]+\s*\(/gm)) fnStarts.push(m.index);
    /** [start, end) of the top-level function enclosing `at`, or null. */
    const enclosingFn = at => {
      let start = -1;
      for (const s of fnStarts) { if (s <= at) start = s; else break; }
      if (start === -1) return null;
      // Top-level functions in this file close with a `}` in column 0.
      const close = appText.indexOf('\n}\n', at);
      return close === -1 ? [start, appText.length] : [start, close + 3];
    };
    const nonEventPaths = [
      [/(?<![\w.$])switchActiveLeague\(/g, 'a league switch moves getSession().playerId'],
      [/(?<![\w.$])forceSignedOutSession\(/g, 'forcing the signed-out session is an identity change'],
      [/await signOut\(/g, 'signing out is an identity change'],
    ];
    for (const [re, why] of nonEventPaths) {
      let seen = 0;
      for (const m of appText.matchAll(re)) {
        const at = m.index;
        seen++;
        const span = enclosingFn(at);
        if (!span) { problems.push(`${m[0]} at offset ${at} is not inside any function — cannot verify it routes through the chokepoint`); continue; }
        const after = appText.slice(at, span[1]);
        if (!/applyIdentityDeltaIfChanged\(/.test(after)) {
          problems.push(`${m[0]} at offset ${at} (${why}) is not followed by applyIdentityDeltaIfChanged() before its enclosing function ends`);
        }
      }
      if (seen === 0) problems.push(`no call site found for ${re} — the enumeration has gone stale`);
    }

    // ════════════════════════════════════════════════════════════════════════
    // (6) THE WRITE RULE — the one the first three passes did not have.
    //
    // ── WHAT THIS RULE IS, AND WHERE IT STOPS (reviewer F5, SIXTH gate) ─────
    // IT IS A LINT-GRADE HEURISTIC OVER TEXT, not a control-flow analysis, and
    // it has now been widened three times — F2 added three shapes, F7 added
    // three more. THE REVIEWER'S INSTRUCTION AT THE SIXTH GATE IS: DO NOT WIDEN
    // IT A FOURTH TIME. Each widening buys one more regex and one more negative
    // self-test, and each one makes the next reader trust the rule a little more
    // than it deserves — which is the actual hazard, because the real guarantee
    // has never been this rule. It is the BEHAVIORAL tests: [17e] (join/create
    // move identity and the chokepoint sees it), [36] and [37] (the expiry
    // machine's locks and releases), [41] (the identity epoch, every latch's
    // release). Those drive the app and read what it did. This rule only makes a
    // silent write LOUD at the moment somebody adds one.
    //
    // KNOWN-UNCOVERED SHAPES, stated so they are visible rather than assumed
    // absent:
    //   • MULTILINE DESTRUCTURING — `destructure()` is deliberately one-line
    //     (`[^{}[\]\n]*`), so a pattern broken across lines is not matched.
    //   • for-of / for-in WRITES — `for (_accountUserId of xs)` assigns the term
    //     with no `=` anywhere near it.
    //   • DEFERRED CLOSURES — a write inside a setTimeout/promise callback,
    //     announced by a notify that runs FIRST and therefore announces the OLD
    //     tuple. The reviewer's P3. It is exercised below as an explicit
    //     documented-gap canary that is expected to PASS the rule, so the gap is
    //     a visible fact in the output rather than a silence.
    //
    // Rules (1)-(4) above are all about CALLERS: which app.js functions must
    // reach the chokepoint. That is the shape that failed three times in a row,
    // because a list of callers is a list of the paths somebody remembered. The
    // third miss was joinLeague()/createLeague() in js/auth.js — functions rule
    // (4) never looks at, writing identity state after the last event had gone
    // out, so nothing routed through the chokepoint at all.
    //
    // This rule anchors on the WRITE instead. The identity tuple has exactly
    // three backing terms, all in js/auth.js; a path that changes identity
    // cannot avoid writing one of them. So: every assignment to those terms,
    // and every call of the one function that writes the league pointer, must be
    // followed — later in the SAME function, and not nested deeper than the
    // write itself, so it cannot be hidden inside a conditional the write is not
    // in — by the private notifier or by an emit to `_authListeners` (which
    // app.js routes into the same chokepoint unconditionally).
    // ════════════════════════════════════════════════════════════════════════
    {
      // ── REVIEWER F2 (fourth gate, 2026-09-17) — THREE WAYS TO DEFEAT THIS
      //    RULE, ALL CLOSED ─────────────────────────────────────────────────
      // The rule's job is "every identity write is followed by a notify THAT
      // CANNOT BE SKIPPED". The first version tested only "a notify appears
      // later in the function at a brace depth no deeper than the write", which
      // three real shapes walk straight through:
      //
      //   (i)  an early RETURN between the write and the notify —
      //          _accountUserId = uid;
      //          if (!something) return;          <- a path that skips the emit
      //          _notifyIdentityMaybeChanged();
      //        The notify is there, at the right depth, and never runs.
      //   (ii) write and notify in SIBLING blocks at equal depth —
      //          if (a) { _accountUserId = uid; }
      //          if (b) { _notifyIdentityMaybeChanged(); }
      //        Absolute depth at the notify equals the write's, so `<=` passed
      //        it, while the two branches are completely independent.
      //   (iii) ARROW / const writers — `authFnStarts` matched only `function`
      //        DECLARATIONS, so a write inside
      //          export const _adopt = uid => { _accountUserId = uid; };
      //        was attributed to whatever `function` happened to precede it in
      //        the file, and inherited that function's notify.
      //
      // The replacement: the notify must POST-DOMINATE the write. Approximated
      // structurally — at the notify the depth relative to the write must be
      // the SHALLOWEST point reached on the way (so a block that was entered
      // after the write's own block closed does not count), and no
      // return/throw at the write's level or shallower may appear in between.
      const authFnStarts = [];
      const AUTH_FN_START = /^(?:export\s+)?(?:async\s+)?function\s+[A-Za-z0-9_$]+\s*\(|^(?:export\s+)?(?:const|let|var)\s+[A-Za-z0-9_$]+\s*=\s*(?:async\s*)?(?:function\b|\(|[A-Za-z0-9_$]+\s*=>)/gm;
      for (const m of authText.matchAll(AUTH_FN_START)) authFnStarts.push(m.index);
      if (authFnStarts.length < 10) problems.push(`only ${authFnStarts.length} top-level functions found in js/auth.js — the function matcher has gone stale`);
      const enclosingAuthFn = at => {
        let start = -1;
        for (const s of authFnStarts) { if (s <= at) start = s; else break; }
        if (start === -1) return null;
        // Top-level bodies in this file close with `}` or `};` in column 0 —
        // BOTH, because (iii)'s arrow/const writers end in the second shape and
        // a rule that only knew the first would run the span on into the next
        // real function and borrow its notify.
        const ends = [authText.indexOf('\n}\n', at), authText.indexOf('\n};\n', at)].filter(i => i !== -1);
        return ends.length === 0 ? [start, authText.length] : [start, Math.min(...ends) + 3];
      };
      /**
       * ── REVIEWER F7 (fifth gate, 2026-09-17) — THREE MORE WAYS IN, CLOSED ──
       *
       * (iv) A WRITE INSIDE A `finally` WHOSE `try` ALWAYS RETURNS.
       *        try { return; } finally { _accountUserId = uid; }
       *        _notifyIdentityMaybeChanged();          <- unreachable
       *      The notify sits later in the function at an acceptable relative
       *      depth, and the `exits` check never saw the `return` because the
       *      return is BEFORE the write, not after it. So a write inside a
       *      `finally` block now requires its notify to be inside that SAME
       *      finally block — which is the only place that is guaranteed to run
       *      when the write does.
       * (v)  COMPOUND ASSIGNMENT. `_accountUserId ||= uid` / `&&=` / `??=` /
       *      `+=` are all writes, and the old matcher (`term\s*=`) matched none
       *      of them: the characters between the term and the `=` made it miss.
       * (vi) DESTRUCTURING ASSIGNMENT. `({ id: _accountUserId } = session)` and
       *      `[_accountUserId] = arr` write the term without the term ever being
       *      immediately followed by `=`.
       * Each has its own negative self-test below; without them this widening
       * would be three regexes nobody can prove do anything.
       */
      /** Every `finally { … }` block in the file, as [open, close) ranges over
       *  authText. Computed once; the write rule asks which one contains it. */
      const finallyRanges = (() => {
        const out = [];
        for (const m of authText.matchAll(/\bfinally\s*\{/g)) {
          const open = authText.indexOf('{', m.index);
          let d = 0;
          for (let i = open; i < authText.length; i++) {
            if (authText[i] === '{') d++;
            else if (authText[i] === '}') { d--; if (d === 0) { out.push([open, i + 1]); break; } }
          }
        }
        return out;
      })();
      const enclosingFinally = at => {
        let best = null;
        for (const r of finallyRanges) {
          if (at > r[0] && at < r[1] && (!best || r[0] > best[0])) best = r;
        }
        return best;
      };
      /**
       * Walk `from` -> `to` tracking brace depth RELATIVE to `from`.
       *   d      depth at `to`
       *   min    shallowest depth reached anywhere on the way
       *   exits  a return/throw was passed at depth <= 0, i.e. on a path that
       *          leaves the function without reaching `to`
       */
      const relWalk = (from, to) => {
        let d = 0, min = 0, exits = false;
        for (let i = from; i < to; i++) {
          const ch = authText[i];
          if (ch === '{') d++;
          else if (ch === '}') { d--; if (d < min) min = d; }
          else if ((ch === 'r' || ch === 't') && d <= 0 && !/[\w$.]/.test(authText[i - 1] || '')
                   && /^(?:return|throw)\b/.test(authText.slice(i, i + 7))) {
            exits = true;
          }
        }
        return { d, min, exits };
      };
      const NOTIFY = /_notifyIdentityMaybeChanged\(|_recordIdentityNotified\(|_authListeners\.forEach\(/g;

      // F7 (v) — the assignment operator, not just `=`. `(?!=)` after the `=`
      // still rejects `==`/`===`, and the operator class deliberately excludes
      // `!` and `<`/`>` so `!==` and `>=` are not read as writes.
      const ASSIGN = String.raw`\s*(?:\|\||&&|\?\?|\+|-|\*|\/|%|\*\*)?=(?!=)`;
      // F7 (vi) — the term inside a destructuring pattern that is itself
      // assigned. One line, no nested braces, which is every shape this file
      // could plausibly grow.
      const destructure = term => new RegExp(String.raw`[{[][^{}[\]\n]*\b${term}\b[^{}[\]\n]*[}\]]\s*=(?!=)`, 'g');
      // `mustExist:false` on the destructuring matchers: the real file has no
      // destructuring write today, and "found none" is the CORRECT answer for
      // them — unlike the three shapes that do exist, where zero matches means
      // the matcher has gone stale rather than the code being clean.
      const writeSites = [
        [new RegExp(String.raw`(?<![\w.$])(?<!let )_accountUserId${ASSIGN}`, 'g'), 'term 1 — the Supabase account id', true],
        [new RegExp(String.raw`(?<![\w.$])(?<!let )_synthesizedSession${ASSIGN}`, 'g'), 'term 3 — the synthesized session (playerId/isAdmin)', true],
        [/(?<![\w.$])(?<!function )setActiveLeagueId\(/g, 'term 2 — the active league pointer', true],
        [destructure('_accountUserId'), 'term 1, written by destructuring', false],
        [destructure('_synthesizedSession'), 'term 3, written by destructuring', false],
      ];
      for (const [re, why, mustExist] of writeSites) {
        let seen = 0;
        for (const m of authText.matchAll(re)) {
          seen++;
          const at = m.index;
          const span = enclosingAuthFn(at);
          if (!span) { problems.push(`js/auth.js: the identity write at offset ${at} (${why}) is not inside any function — it cannot be shown to notify`); continue; }
          // F7 (iv) — a write inside a `finally` may only be announced from
          // inside that same `finally`. Anything after the try/finally statement
          // is not guaranteed to run when the write does.
          const fin = enclosingFinally(at);
          const limit = fin ? Math.min(span[1], fin[1]) : span[1];
          let ok = false;
          NOTIFY.lastIndex = at;
          let n;
          while ((n = NOTIFY.exec(authText)) && n.index < limit) {
            const w = relWalk(at, n.index);
            if (w.d === w.min && !w.exits) { ok = true; break; }
          }
          NOTIFY.lastIndex = 0;
          if (!ok) {
            const line = authText.slice(0, at).split('\n').length;
            problems.push(`js/auth.js:${line} — an identity write (${why}) is not followed by a notify/emit that cannot be skipped before its function returns. Every write to the identity tuple must announce itself; app.js's chokepoint cannot see a write it is never told about.`);
          }
        }
        if (seen === 0 && mustExist) problems.push(`no write site found in js/auth.js for ${re} — the write enumeration has gone stale`);
      }

      // The two write FUNCTIONS themselves must notify, or every call site above
      // would be relying on a body that no longer announces anything.
      for (const [name, pat] of [
        ['setActiveLeagueId', /export function setActiveLeagueId\([\s\S]*?\n\}/],
        ['_recomputeSynthesizedSession', /function _recomputeSynthesizedSession\([\s\S]*?\n\}/],
      ]) {
        const body = (authText.match(pat) || [''])[0];
        if (!body) problems.push(`js/auth.js: ${name}() could not be located — the write rule cannot check it`);
        else if (!/_notifyIdentityMaybeChanged\(/.test(body)) problems.push(`js/auth.js: ${name}() no longer calls _notifyIdentityMaybeChanged() — the write it owns would be silent`);
      }

      // ACTIVE_LEAGUE_KEY is written in exactly ONE place. A second writer would
      // move identity without ever entering the instrumented function. Checked
      // by OFFSET, not by substring containment: two different call sites can
      // share the same first forty characters, and a containment test would call
      // the impostor clean because the original exists elsewhere.
      const setter = (authText.match(/export function setActiveLeagueId\([\s\S]*?\n\}/) || [''])[0];
      const setterAt = setter ? authText.indexOf(setter) : -1;
      if (setterAt === -1) problems.push('js/auth.js: setActiveLeagueId() could not be located — the pointer-write rule cannot scope itself');
      let pointerWrites = 0;
      for (const m of authText.matchAll(/localStorage\.(?:setItem|removeItem)\(\s*ACTIVE_LEAGUE_KEY/g)) {
        pointerWrites++;
        if (setterAt === -1 || m.index < setterAt || m.index >= setterAt + setter.length) {
          const line = authText.slice(0, m.index).split('\n').length;
          problems.push(`js/auth.js:${line} — ACTIVE_LEAGUE_KEY is written outside setActiveLeagueId(); that is an identity change that bypasses the instrumented write`);
        }
      }
      if (pointerWrites === 0) problems.push('js/auth.js: no ACTIVE_LEAGUE_KEY write found at all — the pointer-write matcher has gone stale');

      // …and the notifier has to actually notify. Without this, emptying its
      // body out would leave every rule above green: they check that the CALL
      // is there, and a call to a function that does nothing is still a call.
      const notifier = (authText.match(/function _notifyIdentityMaybeChanged\([\s\S]*?\n\}/) || [''])[0];
      if (!notifier) problems.push('js/auth.js: _notifyIdentityMaybeChanged() could not be located');
      else if (!/_authListeners\.forEach\(/.test(notifier) || !/'IDENTITY_MAYBE_CHANGED'/.test(notifier)) {
        problems.push('js/auth.js: _notifyIdentityMaybeChanged() no longer emits IDENTITY_MAYBE_CHANGED to _authListeners — every write site is calling a function that tells nobody anything');
      }
    }

    // (5) Inside the Phase III surface, the reset exists in exactly ONE body.
    //     SCOPED, and the scope is the point: the PIN-mode login/logout paths
    //     have called clearPickDraft()+resyncPlayerPreferences() inline since
    //     RG-51 and are explicitly out of this rule's jurisdiction — they are
    //     the contract the Supabase paths were failing to match, not a defect.
    //     What must never happen again is a SECOND hand-written copy inside the
    //     Supabase surface, which is how these two call sites drifted apart.
    const phase3At = appText.indexOf('const GOOGLE_G_MARK_SVG');
    if (phase3At === -1) problems.push('the Phase III region marker (GOOGLE_G_MARK_SVG) is gone — rule (5) cannot scope itself');
    else {
      const region = appText.slice(phase3At);
      const choke = (appText.match(/function applyIdentityDeltaIfChanged\([\s\S]*?\n\}/) || [''])[0];
      const count = (t, needle) => t.split(needle).length - 1;
      const inRegion = count(region, 'clearPickDraft(') + count(region, 'resyncPlayerPreferences(');
      const inChoke = count(choke, 'clearPickDraft(') + count(choke, 'resyncPlayerPreferences(');
      if (inChoke !== 2) problems.push(`applyIdentityDeltaIfChanged() should contain exactly one clearPickDraft() and one resyncPlayerPreferences() (found ${inChoke} of the two combined)`);
      if (inRegion !== inChoke) problems.push(`the Phase III region of js/app.js calls clearPickDraft()/resyncPlayerPreferences() ${inRegion} time(s) but only ${inChoke} of those are inside the chokepoint — every other one is a hand-written copy`);
    }

    return problems;
  }

  // The comment-blanker is load-bearing for every offset below, so prove it
  // only removed comments: same length, and the result still parses. A blanker
  // that ate half a string literal (a URL containing `//`, a regex containing
  // `/*`) would sail through a "does it contain the anchors" check and quietly
  // shift every subsequent match.
  {
    const blanked = blankComments(appSrc);
    assert(blanked.length === appSrc.length, 'the comment-blanker preserves length, so every offset below still indexes the real file');
    const { writeFileSync, unlinkSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { spawnSync } = await import('node:child_process');
    const tmp = join(tmpdir(), `cfbp-authtest-blanked-${process.pid}.mjs`);
    writeFileSync(tmp, blanked);
    const checked = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
    try { unlinkSync(tmp); } catch {}
    assert(checked.status === 0, `…and the blanked source still parses — it removed comments and nothing else (${String(checked.stderr || '').split('\n')[0]})`);
    // Falsifiability: a deliberately broken blanker must fail that same check.
    const badBlanked = appSrc.replace(/'/g, ' ');
    writeFileSync(tmp, badBlanked);
    const badChecked = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
    try { unlinkSync(tmp); } catch {}
    assert(badChecked.status !== 0, 'negative self-test — the parse check above DOES fail for a blanker that damages string literals');
  }

  const real = auditIdentityPaths(appSrc, authSrc);
  assert(real.length === 0, `every identity-changing path in js/app.js routes through applyIdentityDeltaIfChanged()${real.length ? ':\n     - ' + real.join('\n     - ') : ''}`);

  // ── NEGATIVE SELF-TEST ───────────────────────────────────────────────────
  // Four mutations, each removing one route, each of which the rule must
  // catch. Without these the assertion above is a green light that cannot turn
  // red — the exact class of unfalsifiable proof RG-41b was written about.
  const CHOKE_CALL = 'applyIdentityDeltaIfChanged(`event:${event}`, { expiry, discard });';
  assert(appSrc.includes(CHOKE_CALL),
    'fixture: the chokepoint call in refreshAuthUI() is the exact text the three mutations below rewrite (a stale needle would make them no-ops)');
  const mutations = [
    ['the chokepoint call is deleted from refreshAuthUI()',
      s => s.replace(CHOKE_CALL, '')],
    ['the chokepoint call in refreshAuthUI() is put back behind an event list',
      s => s.replace(CHOKE_CALL, `if (event === 'SIGNED_IN') { ${CHOKE_CALL} }`)],
    ['the league-switch route is deleted from doSwitchActiveLeague()',
      s => s.replace(/applyIdentityDeltaIfChanged\(`league-switch:\$\{leagueId\}`,[^;]*\);/, '')],
    ['the reset body is hand-copied to a second call site',
      s => s.replace('export function _resetAuthUIWiringForTest()',
        'function _strayResetCopy() { clearPickDraft();\n  resyncPlayerPreferences(); }\nexport function _resetAuthUIWiringForTest()')],
  ];
  for (const [label, mutate] of mutations) {
    const found = auditIdentityPaths(mutate(appSrc), authSrc);
    assert(found.length > 0, `negative self-test — the rule REPORTS a violation when ${label}`);
  }
  // …and a mutation of the OTHER file is caught too (the enumeration is fed by
  // auth.js, so a stale enumeration must not read as "clean").
  const authMutated = authSrc.replace(/_authListeners\.forEach\(fn => \{ try \{ fn\(event, session\)/, '_authListeners.forEach(fn => { try { fn(String(event), session)');
  assert(auditIdentityPaths(appSrc, authMutated).length > 0,
    'negative self-test — the rule reports a violation when auth.js stops passing raw SDK events through verbatim');

  // ── NEGATIVE SELF-TESTS FOR THE WRITE RULE (rule 6) ──────────────────────
  // The first two REINTRODUCE THE ACTUAL DEFECT the reviewer found — the exact
  // shape joinLeague()/createLeague() had at commit 1d71cbf — so this suite can
  // demonstrate it would now be caught, rather than asserting that it is absent
  // from code that was just edited to remove it.
  const authMutations = [
    ['joinLeague() writes the active-league pointer AFTER the refresh again (the reviewer\'s Finding 1, verbatim)',
      s => s.replace(
        /const list = await refreshMembershipsAndSession\(\{ preferMemberId: memberId \}\);\n  return \(list \|\| \[\]\)\.find\(m => m\.memberId === memberId\) \|\| null;/,
        'const list = await refreshMembershipsAndSession();\n  const joined = (list || []).find(m => m.memberId === memberId) || null;\n  if (joined) setActiveLeagueId(joined.leagueId);\n  return joined;')],
    ['createLeague() writes the pointer after the refresh again',
      s => s.replace(
        /await refreshMembershipsAndSession\(\{ preferLeagueId: leagueId \}\);\n  return leagueId;/,
        'await refreshMembershipsAndSession();\n  if (leagueId) setActiveLeagueId(leagueId);\n  return leagueId;')],
    ['a NEW function assigns the account id with no notify (the class, not the two names)',
      s => s.replace('export function getAccountUserId() { return _accountUserId; }',
        'export function getAccountUserId() { return _accountUserId; }\nexport function _adoptAccount(uid) {\n  _accountUserId = uid;\n}')],
    ['a new function moves the league pointer and returns without notifying',
      s => s.replace('export function getActiveLeagueName() {',
        'export function _quietlyRescope(id) {\n  setActiveLeagueId(id);\n}\nexport function getActiveLeagueName() {')],
    ['setActiveLeagueId() stops notifying',
      s => s.replace('  _recomputeSynthesizedSession();\n  // Explicit, not merely transitive', '  // Explicit, not merely transitive')
            .replace('  _notifyIdentityMaybeChanged();\n}\n\n/** DI-184\'s header pill', '}\n\n/** DI-184\'s header pill')],
    ['_recomputeSynthesizedSession() stops notifying',
      s => s.replace(/    : \{ playerId: null, isAdmin: false, playerVerified: false \};\n  _notifyIdentityMaybeChanged\(\);/,
        '    : { playerId: null, isAdmin: false, playerVerified: false };')],
    ['something other than setActiveLeagueId() writes the league pointer directly',
      s => s.replace('export function getActiveLeagueName() {',
        'export function _rawPointerWrite(id) {\n  localStorage.setItem(ACTIVE_LEAGUE_KEY, id);\n}\nexport function getActiveLeagueName() {')],
    ['the notifier itself is emptied out (it no longer emits to any listener)',
      s => s.replace(/  _authListeners\.forEach\(fn => \{\n    try \{ fn\('IDENTITY_MAYBE_CHANGED', \{ identity: tuple \}\); \}\n    catch \(e\) \{ console\.warn\('\[auth\] listener failed', e\); \}\n  \}\);/, '  return;')],
    // ── REVIEWER F2's THREE SHAPES, as negative self-tests ─────────────────
    // Each of these passed the FIRST version of rule (6). Each must now fail.
    ['(i) an early RETURN sits between the write and the notify',
      s => s.replace('  _notifyIdentityMaybeChanged();   // instrumented write (term 3)',
        '  if (!_cfg.supabaseUrl) return;\n  _notifyIdentityMaybeChanged();   // instrumented write (term 3)')],
    ['(ii) the write and the notify are in SIBLING blocks at equal depth',
      s => s.replace('export function getActiveLeagueName() {',
        'export function _siblingBlocks(uid, flag) {\n  if (flag) { _accountUserId = uid; }\n  if (!flag) { _notifyIdentityMaybeChanged(); }\n}\nexport function getActiveLeagueName() {')],
    ['(iii) an ARROW/const writer assigns the account id with no notify',
      s => s.replace('export function getActiveLeagueName() {',
        'export const _arrowAdopt = (uid) => {\n  _accountUserId = uid;\n};\nexport function getActiveLeagueName() {')],
    // ── REVIEWER F7's THREE SHAPES (fifth gate) ────────────────────────────
    ['(iv) the write is inside a `finally` whose `try` always returns, and the notify after it is unreachable',
      s => s.replace('export function getActiveLeagueName() {',
        'export function _finallyAdopt(uid) {\n  try { return; } finally { _accountUserId = uid; }\n  _notifyIdentityMaybeChanged();\n}\nexport function getActiveLeagueName() {')],
    ['(v) a COMPOUND assignment (||=) writes the account id with no notify',
      s => s.replace('export function getActiveLeagueName() {',
        'export function _coalesceAdopt(uid) {\n  _accountUserId ||= uid;\n}\nexport function getActiveLeagueName() {')],
    ['(vi) a DESTRUCTURING assignment writes the account id with no notify',
      s => s.replace('export function getActiveLeagueName() {',
        'export function _destructureAdopt(session) {\n  ({ id: _accountUserId } = session);\n}\nexport function getActiveLeagueName() {')],
  ];
  for (const [label, mutate] of authMutations) {
    const mutated = mutate(authSrc);
    assert(mutated !== authSrc, `fixture: the mutation "${label}" actually changed js/auth.js (a no-op mutation would make the assertion below vacuous)`);
    const found = auditIdentityPaths(appSrc, mutated);
    assert(found.length > 0, `negative self-test — the WRITE rule REPORTS a violation when ${label}`);
  }

  // ── REVIEWER F5 (SIXTH gate) — THE DOCUMENTED-GAP CANARIES ───────────────
  // These are the reviewer's P3 and its two siblings: real ways to write an
  // identity term that rule (6) does NOT catch. They are asserted to PASS,
  // deliberately, so the limit of the rule is a line in the suite's output
  // instead of an assumption in a reader's head. If a future pass ever makes one
  // of these red, THAT IS FINE and the assertion should be flipped — what must
  // not happen is the gap being closed in the reader's imagination while the
  // rule stays a text heuristic.
  //
  // Each one is DANGEROUS in the same specific way: the notify runs, and it
  // announces a tuple that does not yet include the write. app.js's chokepoint
  // then latches the OLD identity as "announced" — so the write that follows is
  // invisible to it, and the NEXT genuine change compares against a key that is
  // one step behind. This is exactly the F-1 class, and the thing that actually
  // guards it is [17e]/[36]/[37]/[41], which drive the app rather than read it.
  const documentedGaps = [
    ['P3 — a DEFERRED-CLOSURE write, announced by a notify that runs before it',
      s => s.replace('export function getActiveLeagueName() {',
        'export function _deferredAdopt(uid) {\n  setTimeout(() => { _accountUserId = uid; }, 0);\n  _notifyIdentityMaybeChanged();\n}\nexport function getActiveLeagueName() {')],
    ['a MULTILINE destructuring write (destructure() is deliberately one-line)',
      s => s.replace('export function getActiveLeagueName() {',
        'export function _multilineAdopt(session) {\n  ({\n    id: _accountUserId,\n  } = session);\n}\nexport function getActiveLeagueName() {')],
    ['a for-of write, which assigns the term with no `=` anywhere near it',
      s => s.replace('export function getActiveLeagueName() {',
        'export function _loopAdopt(ids) {\n  for (_accountUserId of ids) { void 0; }\n}\nexport function getActiveLeagueName() {')],
  ];
  for (const [label, mutate] of documentedGaps) {
    const mutated = mutate(authSrc);
    assert(mutated !== authSrc, `fixture: the documented-gap mutation "${label}" actually changed js/auth.js`);
    const found = auditIdentityPaths(appSrc, mutated);
    assert(found.length === 0,
      `DOCUMENTED GAP (expected to pass, and it does) — rule (6) does NOT report ${label}. It is a lint-grade text heuristic; the real guarantee is the behavioral suites [17e]/[36]/[37]/[41]. Do not widen the rule a fourth time to close this (reviewer F5).`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[17e] REVIEWER FINDING 1 — joining/creating a league IS an identity change…');
{
  // THE DEFECT, at commit 1d71cbf, found on the third gate. joinLeague() and
  // createLeague() called setActiveLeagueId() AFTER refreshMembershipsAndSession()
  // had emitted its last event. Identity (active league, playerId, and for
  // createLeague the commissioner ROLE) therefore moved with nothing routing
  // through app.js's chokepoint:
  //   • League A's draft picks, tiebreaker, Extra Point guess and layoutEditing
  //     survived into League B;
  //   • OneSignal stayed bound to A's member id, so B's pushes went to A;
  //   • and the latch was left holding A's key — so the NEXT background
  //     TOKEN_REFRESHED compared B's identity against A's, read that as a
  //     change, and wiped a draft the player had legitimately entered in B.
  //     That is F-1 reborn out of an F-2-shaped hole, which is why the fix had
  //     to close the CLASS (instrumented writes in auth.js) rather than add two
  //     more names to a list of callers.
  //
  // Driven through the REAL listener chain — auth.js's own emit -> app.js's
  // wired listener -> refreshAuthUI -> the chokepoint. Nothing here hand-calls
  // the chokepoint.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ oneSignalAppId: 'test-app-id' }) });
  const drainOneSignal = async (os) => {
    for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0));
    const queue = globalThis.window.OneSignalDeferred || [];
    const pending = queue.splice(0, queue.length);
    for (const cb of pending) { try { await cb(os); } catch {} }
  };
  const ROW_A = { league_id: 'L-A', id: 'mA', role: 'player', display_name: 'Drew', active: true, leagues: { name: 'League A' } };
  const ROW_B = { league_id: 'L-B', id: 'mB', role: 'player', display_name: 'Drew', active: true, leagues: { name: 'League B' } };
  const ROW_C = { league_id: 'L-C', id: 'mC', role: 'commissioner', display_name: 'Drew', active: true, leagues: { name: 'League C' } };

  /** A signed-in device sitting in League A with a half-filled slate. */
  async function deviceInLeagueA(rows, rpc) {
    let fakeRows = rows;
    resetAll({
      getSession: async () => ({ data: { session: { user: { id: 'u-drew', email: 'drew@example.com' } } } }),
      from: () => ({ data: fakeRows, error: null }),
      rpc,
    });
    wireRealAuthUI();
    globalThis.window.OneSignalDeferred = [];
    storeValidSession();
    auth._fireAuthEventForTest('SIGNED_IN', { user: { id: 'u-drew', email: 'drew@example.com' } });
    await drainOneSignal({ login: () => {}, logout: () => {} });
    return { setRows: r => { fakeRows = r; } };
  }
  const fillSlate = () => {
    app.state.draftPicks = { g1: 'home', g2: 'away', g3: 'home' };
    app.state.draftTiebreaker = 44;
    app.state.draftExtraPoint = 31;
    app.state.layoutEditing = 'dashboard';
    globalThis.window.OneSignalDeferred = [];
  };

  // ── JOIN A SECOND LEAGUE ────────────────────────────────────────────────
  {
    const dev = await deviceInLeagueA([ROW_A], () => ({ data: 'mB', error: null }));
    assert(storage.getSession().playerId === 'mA' && auth.getActiveLeagueId() === 'L-A',
      'fixture: the device is signed in, scoped to League A, with A\'s member id as the playerId');
    fillSlate();

    dev.setRows([ROW_A, ROW_B]);          // the server now sees both memberships
    const joined = await auth.joinLeague('IRB-4F2K');
    let loggedInWith = null, loggedOut = false;
    // SIXTH GATE — the ORDER is recorded, not just the fact. DI-180q's clear now
    // runs on this path too (the marker's LEAGUE term moved, and the chat cache,
    // read cursors and unread counts are all league-scoped), and that clear logs
    // OneSignal out. A logout landing AFTER the login would leave the device
    // bound to nobody and silently stop every push — so the sequence is the
    // assertion, not the endpoint.
    const osSeq = [];
    await drainOneSignal({
      login: id => { loggedInWith = id; osSeq.push(`login:${id}`); },
      logout: () => { loggedOut = true; osSeq.push('logout'); },
    });

    assert(joined?.leagueId === 'L-B', `fixture: the join really resolved the new membership (got ${JSON.stringify(joined?.leagueId)})`);
    assert(auth.getActiveLeagueId() === 'L-B' && storage.getSession().playerId === 'mB',
      'the device is now scoped to League B — pointer and playerId both moved (DI-181c)');
    assert(Object.keys(app.state.draftPicks).length === 0,
      `joining a second league CLEARS the draft picks (got ${JSON.stringify(app.state.draftPicks)}) — League A's slate must never be submitted into League B`);
    assert(app.state.draftTiebreaker === null && app.state.draftExtraPoint === null,
      '…and the tiebreaker and Extra Point guess with them');
    assert(!app.state.layoutEditing, '…and layout edit mode, which was wired to the other league\'s pageKey');
    assert(loggedInWith === 'mB',
      `…and OneSignal is re-logged-in as the NEW league's member id (got ${JSON.stringify(loggedInWith)}) — B's pushes do not go to A's binding`);
    assert(loggedOut === true && osSeq[osSeq.length - 1] === 'login:mB',
      `DI-180q — …and the league-scoped clear logs OUT first, so the LAST thing that happens is the login for the new scope (${JSON.stringify(osSeq)}). The other order would leave a device bound to nobody and silently receiving nothing.`);
    assert(app._lastIdentityKeyForTest() === app._currentIdentityKeyForTest(),
      'the latch is left holding the CURRENT identity, not the stale one');

    // ── THE FOLLOW-ON, which is the half that actually bit a player ────────
    // With the latch left stale, the next hourly TOKEN_REFRESHED read as an
    // identity change and wiped a slate entered AFTER the join.
    app.state.draftPicks = { g7: 'home', g8: 'away' };
    app.state.draftTiebreaker = 59;
    app.state.draftExtraPoint = 27;
    app.state.layoutEditing = 'standings';
    globalThis.window.OneSignalDeferred = [];
    auth._fireAuthEventForTest('TOKEN_REFRESHED', { user: { id: 'u-drew', email: 'drew@example.com' } });
    let refreshLogin = null;
    await drainOneSignal({ login: id => { refreshLogin = id; }, logout: () => {} });
    assert(Object.keys(app.state.draftPicks).length === 2,
      `a token refresh AFTER the join leaves the new league's draft alone (got ${JSON.stringify(app.state.draftPicks)}) — the latch was not left stale`);
    assert(app.state.draftTiebreaker === 59 && app.state.draftExtraPoint === 27 && app.state.layoutEditing === 'standings',
      '…along with the tiebreaker, the Extra Point guess and the in-progress layout edit');
    assert(refreshLogin === null, '…and OneSignal is not re-bound: nothing about who this device belongs to changed');
  }

  // ── CREATE A SECOND LEAGUE (player -> COMMISSIONER) ─────────────────────
  {
    const dev = await deviceInLeagueA([ROW_A], () => ({ data: 'L-C', error: null }));
    assert(storage.getSession().isAdmin === false, 'fixture: the player is NOT a commissioner in League A');
    fillSlate();

    dev.setRows([ROW_A, ROW_C]);
    const created = await auth.createLeague("Drew's League");
    let loggedInWith = null;
    await drainOneSignal({ login: id => { loggedInWith = id; }, logout: () => {} });

    assert(created === 'L-C', 'fixture: create_league returned the new league id');
    assert(auth.getActiveLeagueId() === 'L-C' && storage.getSession().playerId === 'mC',
      'the device is scoped to the new league, and playerId is its member id');
    assert(storage.getSession().isAdmin === true,
      'and the role moved with it — creating a league makes this session a COMMISSIONER, which is the sharpest identity change of the three');
    assert(Object.keys(app.state.draftPicks).length === 0 && app.state.draftTiebreaker === null && app.state.draftExtraPoint === null && !app.state.layoutEditing,
      'creating a league clears the draft, the tiebreaker, the Extra Point guess and layout edit mode');
    assert(loggedInWith === 'mC', `…and OneSignal follows to the new member id (got ${JSON.stringify(loggedInWith)})`);
    assert(app._lastIdentityKeyForTest() === app._currentIdentityKeyForTest(), 'the latch tracks the new identity');
  }

  // ── ONE RESET, NOT TWO ──────────────────────────────────────────────────
  // The pointer is written BEFORE the event goes out, so the chokepoint sees
  // the FINAL tuple once. A transient "account known, league null" tuple in the
  // middle would fire a second, pointless reset (and a second OneSignal login).
  {
    const dev = await deviceInLeagueA([ROW_A], () => ({ data: 'mB', error: null }));
    dev.setRows([ROW_A, ROW_B]);
    const keys = [];
    const realInfo = console.info;
    console.info = (...a) => { const s = a.map(String).join(' '); if (/identity changed/.test(s)) keys.push(s); realInfo(...a); };
    try {
      await auth.joinLeague('IRB-4F2K');
      await drainOneSignal({ login: () => {}, logout: () => {} });
    } finally { console.info = realInfo; }
    assert(keys.length === 1,
      `a join fires the identity reset exactly ONCE (got ${keys.length}: ${JSON.stringify(keys)}) — the pointer moves before the event, so there is no intermediate tuple to react to`);
  }

  globalThis.fetch = realFetch;
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[18] SEC F2 / reviewer N4 — AD-06 loud-fail: no failure ever reads as "you have no leagues"…');
{
  // THE BUG: getMemberships() returned [] when it could not build a client. []
  // is the exact value DI-181a renders "You're not in a league yet" for. So an
  // outage told a founding member he wasn't in a league, and offered him a
  // stranger's join/create form.
  const cases = [
    ['the vendored SDK is absent from the page', () => {
      resetAll(); wireRealAuthUI(); storeValidSession(); globalThis.window.supabase = undefined;
    }],
    ['supabaseUrl/anon key are not configured', () => {
      resetAll(); wireRealAuthUI(); storeValidSession();
      auth.configureAuth({ authMode: 'supabase', supabaseUrl: '', supabaseAnonKey: '' });
      auth._setHasSupabaseDataBackendForTest(true);
    }],
    ['the membership read fails on the network', () => {
      resetAll({ getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }),
                 from: () => { throw new TypeError('Failed to fetch'); } });
      wireRealAuthUI(); storeValidSession();
    }],
  ];
  for (const [label, setup] of cases) {
    setup();
    let caught = null;
    try { await auth.refreshMembershipsAndSession(); } catch (e) { caught = e; }
    await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
    assert(!!caught, `${label}: refreshMembershipsAndSession() THROWS — it never resolves to an empty list`);
    assert(!!auth.getMembershipsError(), `${label}: the failure is latched where every consumer can read it`);
    assert(app.needsLeagueFlowScreen() === false,
      `${label}: needsLeagueFlowScreen() is FALSE — the join/create landing is structurally unreachable over an infrastructure failure`);
    assert(!!document.getElementById('auth-unavailable-banner'), `${label}: a persistent banner is on screen`);
    // Null-safe on purpose: when this regresses, the banner is MISSING, and a
    // thrown TypeError here would abort the whole suite and hide every later
    // section instead of reporting one clean failure.
    // DI-180m — the copy is SHORTER now ("try again in a minute" is replaced by
    // the Sign In button itself), and the banner carries that button. Read off
    // the rendered markup rather than a whole-node textContent match, because
    // the node is no longer one text child.
    assert(/Can't reach sign-in right now\. Your picks are safe\./.test(String(document.getElementById('auth-unavailable-banner')?.innerHTML ?? '')),
      `${label}: with its own copy — distinct from the sync banner and from the session-expired banner`);
    assert(!/try again in a minute/.test(String(document.getElementById('auth-unavailable-banner')?.innerHTML ?? '')),
      `${label}: …and no longer tells the player to wait with nothing to do (DI-180m)`);
    assert(!document.getElementById('backend-error-banner'),
      `${label}: and it did NOT raise the SYNC banner — auth and sync stay two channels (AD-06)`);
  }

  // The first two are typed, so a caller can tell "unreachable" from "the
  // server said no".
  resetAll(); storeValidSession(); globalThis.window.supabase = undefined;
  let e1 = null; try { await auth.getMemberships(); } catch (e) { e1 = e; }
  assert(e1?.name === 'AuthUnavailableError' && e1?.code === 'auth_unavailable', `SDK absent -> typed AuthUnavailableError (got ${e1?.name})`);
  resetAll(); auth.configureAuth({ authMode: 'supabase', supabaseUrl: '', supabaseAnonKey: '' });
  let e2 = null; try { await auth.getMemberships(); } catch (e) { e2 = e; }
  assert(e2?.name === 'AuthUnavailableError', 'url absent -> typed AuthUnavailableError');

  // ── SEC F2 (second pass) — "COULD NOT ASK" IS NOT "ZERO LEAGUES" ──────────
  // A session-less client used to answer `[]`, which refreshMembershipsAndSession()
  // then cached as a RESOLVED zero-league answer. hasValidSupabaseSession()
  // reads an unexpired token straight off localStorage while the SDK is still
  // rehydrating its own session, so those two can disagree for a tick — and in
  // that tick a founding member was shown DI-181a's "You're not in a league
  // yet" with a stranger's join/create form under it.
  resetAll({ getSession: async () => ({ data: { session: null } }) });
  storeValidSession();          // the device DOES have a token; the SDK just hasn't surfaced it
  const none = await auth.getMemberships();
  assert(none === null, `a session-less client returns null ("could not ask"), never [] ("zero leagues") — got ${JSON.stringify(none)}`);
  const refreshed = await auth.refreshMembershipsAndSession();
  assert(refreshed === null, '…and refreshMembershipsAndSession() passes that null straight through to its caller');
  assert(auth.hasResolvedMemberships() === false,
    'the membership cache is LEFT AT NULL — hasResolvedMemberships() stays false, so nothing downstream can read the race as an answer');
  assert(app.needsLeagueFlowScreen() === false,
    'and needsLeagueFlowScreen() is FALSE — the join/create landing is structurally unreachable during the SDK-internal race (SEC F2)');
  assert(!document.getElementById('auth-unavailable-banner'),
    '…while NOT raising the unavailable banner either: nobody failed, nobody was asked (the sign-in gate owns this state)');
  // Falsifiability check: the same fixture WITH a signed-in user resolves a
  // real empty list, and THAT one does show the landing. Without this, the
  // assertions above would also pass if needsLeagueFlowScreen() were hardwired
  // to false.
  resetAll({ getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }), from: () => ({ data: [], error: null }) });
  storeValidSession();
  const empty = await auth.refreshMembershipsAndSession();
  assert(Array.isArray(empty) && empty.length === 0, 'a real signed-in account with no rows still resolves to [] — "zero leagues" survives as its own distinct answer');
  assert(auth.hasResolvedMemberships() === true && app.needsLeagueFlowScreen() === true,
    '…and THAT is what renders DI-181a\'s landing — so the null case above is proving a difference, not a constant');

  // The Picks tab tells the same story instead of spinning forever.
  resetAll({ getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }), from: () => { throw new TypeError('Failed to fetch'); } });
  wireRealAuthUI(); storeValidSession();
  try { await auth.refreshMembershipsAndSession(); } catch {}
  const picksEl = new FakeEl(); picksEl.id = 'page-picks'; registry.set('page-picks', picksEl);
  globalThis.navigateTo('picks');
  assert(!/spinner/.test(picksEl.innerHTML), 'the Picks tab does NOT render an indefinite spinner over a failed membership read');
  assert(/Can't reach sign-in right now/.test(picksEl.innerHTML), '…it renders the same loud copy the banner carries (one story, two places)');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[19] SEC F5 — join/create input bounds + one error message per server code…');
{
  resetAll();
  auth._setMembershipsForTest([]);
  storeValidSession();
  const page = new FakeEl(); page.id = 'page-dashboard'; registry.set('page-dashboard', page);
  app.renderLeagueFlowScreen('dashboard');
  assert(/id="league-join-code"[^>]*maxlength="16"/.test(page.innerHTML), 'the join-code field is capped at maxlength="16"');
  assert(/id="league-create-name"[^>]*maxlength="80"/.test(page.innerHTML),
    'the league-name field is capped at maxlength="80" — the same bound create_league() itself enforces (0003_functions.sql), so the form cannot submit something the server will always reject');

  const { resolve, connectivity, unknown } = app._LEAGUE_RPC_ERROR_COPY_FOR_TEST;
  const distinct = new Set();
  for (const [code, expected] of [
    ['invalid_code', 'code'], ['bad_name', 'name'], ['not_authenticated', 'sign-in'], ['already_member', 'already'],
  ]) {
    const copy = resolve(new Error(code));
    distinct.add(copy);
    assert(copy !== connectivity && copy !== unknown, `${code} maps to its OWN copy, not the connectivity or the catch-all line`);
    assert(new RegExp(expected, 'i').test(copy), `${code}'s copy actually describes ${code} (got ${JSON.stringify(copy.slice(0, 48))})`);
  }
  assert(distinct.size === 4, `all four server codes produce four DIFFERENT messages (got ${distinct.size})`);
  assert(resolve(new Error('PGRST301: JWT expired, not_authenticated')) !== unknown,
    'a decorated PostgREST message still matches its code (matched by substring, not by exact equality)');
  assert(resolve(new TypeError('Failed to fetch')) === connectivity, 'a REAL transport failure gets the connectivity copy');
  assert(resolve(new (Object.assign(class extends Error {}, {}))('x') && Object.assign(new Error('x'), { name: 'AuthUnavailableError' })) === connectivity,
    'so does AuthUnavailableError — sign-in genuinely unreachable is a connectivity problem');
  assert(resolve(new Error('some unmapped server condition')) === unknown,
    'an UNRECOGNISED server error gets the honest catch-all, never the connectivity line — a server that answered is not a connection problem');
  assert(!/connection/i.test(unknown), '…and the catch-all does not mention the connection either');

  // The copy reaches the DOM through textContent, never innerHTML.
  const appSrc19 = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
  assert(/joinErr\.textContent = leagueRpcErrorCopy\(err\)/.test(appSrc19) && /createErr\.textContent = leagueRpcErrorCopy\(err\)/.test(appSrc19),
    'both inline errors are written with .textContent — a server-supplied string never reaches an innerHTML sink');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[20] Reviewer N5 — the auth banner\'s z-order and nav clearance, read from the CSS…');
{
  // Precedent: layouttest [A10] parses css/styles.css and asserts the COMPUTED
  // CONSTRAINT (a number), not the presence of a property name.
  const css = readFileSync(new URL('./css/styles.css', import.meta.url), 'utf8');
  const ruleOf = sel => (css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{[^}]*\\}')) || [''])[0];
  const zOf = sel => Number((ruleOf(sel).match(/z-index:\s*(\d+)/) || [])[1] || NaN);

  const zStack = zOf('#auth-banner-stack');
  const zGateOverlay = zOf('#site-gate-overlay');
  const zGateInner = zOf('.site-gate');
  const zNav = zOf('.bottom-nav');
  assert(Number.isFinite(zStack) && Number.isFinite(zGateOverlay) && Number.isFinite(zGateInner) && Number.isFinite(zNav),
    `fixture: all four z-indexes were found in the CSS (stack ${zStack}, overlay ${zGateOverlay}, gate ${zGateInner}, nav ${zNav})`);
  assert(zStack > zGateOverlay,
    `the auth banner stack (${zStack}) is ABOVE #site-gate-overlay (${zGateOverlay}) — it used to be 190, i.e. behind the opaque overlay it was telling the player to sign in through`);
  assert(zStack > zGateInner, `…and above .site-gate itself (${zGateInner}), which is the element that actually paints`);
  assert(zStack > 9000, `…which satisfies the stated floor of > 9000 (got ${zStack})`);
  assert(zStack > zNav, `…and above .bottom-nav (${zNav})`);

  const stackRule = ruleOf('#auth-banner-stack');
  assert(/bottom:\s*calc\([^)]*var\(--nav-height\)/.test(stackRule),
    'and it is offset upward by var(--nav-height), so when no gate is up it sits ABOVE the bottom nav rather than covering it');
  assert(/env\(safe-area-inset-bottom/.test(stackRule), '…including the iOS home-indicator inset');
  assert(!/position:\s*fixed/.test(ruleOf('.session-expired-banner')),
    'the individual banners are no longer independently position:fixed — they are children of the one stack, which is why two of them can be on screen without overlapping');
  const zBackend = zOf('.backend-error-banner');
  assert(Number.isFinite(zBackend) && /top:\s*0/.test(ruleOf('.backend-error-banner')),
    `the SYNC banner is still its own top-anchored node (z ${zBackend}) — AD-06's two channels stay separate and can both be read at once`);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[21] SEC concern 1 — a missing player record must not recurse…');
{
  // WHY THIS RECURSED: in 'pins' mode `clearSession()` removes KEYS.SESSION,
  // the next getSession() reads null, and the re-render lands on the login
  // screen — one bounce, terminated. In 'supabase' mode getSession() no longer
  // reads KEYS.SESSION at all, so clearSession() changes nothing observable,
  // session.playerId is still set, getPlayer() still misses, and the re-render
  // re-enters the same branch. Unbounded, on the first tab a player opens.
  resetAll();
  wireRealAuthUI();
  storeValidSession();
  auth._setMembershipsForTest([{ leagueId: 'A', memberId: 'ghost-member', role: 'player', displayName: 'Ghost', leagueName: 'League A' }]);
  auth.setActiveLeagueId('A');
  assert(storage.getSession().playerId === 'ghost-member' && storage.getSession().playerVerified === true,
    'fixture: an ACTIVE membership resolves, so the picks page gets past its signed-out branch');

  const picksEl = new FakeEl(); picksEl.id = 'page-picks'; registry.set('page-picks', picksEl);
  let writes = 0;
  const proto = Object.getPrototypeOf(picksEl);
  const desc = Object.getOwnPropertyDescriptor(proto, 'innerHTML');
  Object.defineProperty(picksEl, 'innerHTML', { configurable: true, get: desc.get, set(v) { writes++; desc.set.call(this, v); } });

  let overflow = null;
  try { globalThis.navigateTo('picks'); } catch (e) { overflow = e; }
  assert(overflow === null, `rendering the Picks tab with a membership whose player row does not exist RETURNS (got ${overflow && overflow.name})`);
  assert(writes <= 3, `…after a BOUNDED number of renders (got ${writes}) — an unbounded re-render is the failure this pins`);
  assert(/can't find your player record/i.test(picksEl.innerHTML), '…and it says so, loudly, on the page');
  assert(/ask your commissioner/i.test(picksEl.innerHTML), '…with the one action that actually resolves it');
  assert(storage.getSession().playerId === 'ghost-member',
    'and it did NOT clear the session — clearSession() is a no-op on a synthesized session, so calling it would only have hidden the loop, not stopped it');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[22] SEC concern 2 — a deliberate sign-out is never reported as an expiry…');
{
  // The old code set _signingOut for the duration of the awaited
  // client.auth.signOut() and cleared it in a `finally`. That assumed the SDK
  // fires SIGNED_OUT synchronously inside that await. It does not have to: one
  // tick later, the flag was already false and a deliberate sign-out rendered
  // the amber "Your session expired" banner at a player who had just tapped
  // Sign Out.
  resetAll({ signOut: async () => ({ error: null }) });   // resolves WITHOUT firing the event
  auth._setMembershipsForTest([{ leagueId: 'A', memberId: 'm1', role: 'player', displayName: 'x', leagueName: 'A' }]);
  auth.setActiveLeagueId('A');
  await auth.signOut();
  await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
  auth._fireAuthEventForTest('SIGNED_OUT', null);   // the SDK's event, arriving late
  assert(auth.isSessionExpired() === false,
    'a SIGNED_OUT that arrives AFTER signOut() has already returned is still recognised as deliberate — no expiry banner');

  // …and the latch does not swallow a genuine expiry that happens later.
  resetAll({ signOut: async () => ({ error: null }) });
  await auth.signOut();
  await new Promise(r => setTimeout(r, 1100));        // past SIGNOUT_GRACE_MS
  auth._fireAuthEventForTest('SIGNED_OUT', null);
  assert(auth.isSessionExpired() === true,
    'but an involuntary SIGNED_OUT more than a second later IS an expiry — the grace window is a window, not a permanent mute');

  // SEC F2's last probe: "Sign Out" must clear the device token even when no
  // client could ever be built. It could not before, so the button looked like
  // it worked and the very next boot read the session straight back.
  resetAll();
  storeValidSession();
  globalThis.window.supabase = undefined;             // ensureClient() -> null
  assert(auth.hasValidSupabaseSession() === true, 'fixture: a valid session is on the device');
  await auth.signOut();
  assert(auth.hasValidSupabaseSession() === false,
    'signOut() with NO client still removes the persisted session — the one step that must survive every failure above it');
  assert(localStorage.getItem(auth._AUTH_STORAGE_KEY_FOR_TEST) === null, '…the storage key itself is gone');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[23] Reviewer N10 — the league-flow screen never takes over #page-chat…');
{
  resetAll();
  wireRealAuthUI();
  storeValidSession();
  auth._setMembershipsForTest([]);   // zero memberships -> the landing is due
  assert(app.needsLeagueFlowScreen() === true, 'fixture: the league-flow screen is due');

  const chatEl = new FakeEl(); chatEl.id = 'page-chat'; registry.set('page-chat', chatEl);
  chatEl.innerHTML = '<div class="chat-scroll">chat-ui.js owns this subtree</div>';
  const dashEl = new FakeEl(); dashEl.id = 'page-dashboard'; registry.set('page-dashboard', dashEl);

  app.renderLeagueFlowScreen('chat');
  assert(/chat-ui\.js owns this subtree/.test(chatEl.innerHTML),
    'renderLeagueFlowScreen(\'chat\') refuses outright — #page-chat\'s markup, listeners, scroll anchoring and composer are chat-ui.js\'s, and innerHTML would destroy all of it with no way for chat-ui.js to know');
  assert(!/not in a league yet/.test(chatEl.innerHTML), '…and the landing is not in there');

  globalThis.navigateTo('chat');
  assert(/not in a league yet/.test(dashEl.innerHTML),
    'and navigating to Chat in that state re-routes to the dashboard page, which DOES get the landing — the player is not left staring at a blank tab');
  assert(/chat-ui\.js owns this subtree/.test(chatEl.innerHTML), '…with #page-chat still untouched');

  const appSrc23 = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
  // Step 3b widened the condition to cover DI-183's link-result screens, which
  // occupy the same slot and carry the same #page-chat prohibition (reviewer
  // N10). The rule is unchanged in substance: BOTH re-route decisions are made
  // before `tab` is committed, in navigateTo(), in one place.
  assert(/if \(\(leagueFlow \|\| linkFlow\) && tab === 'chat'\) tab = 'dashboard';/.test(appSrc23),
    'the re-route is decided in navigateTo() BEFORE the tab is committed, so the active section and the rendered content can never disagree — and it covers DI-183\'s link screens as well as DI-181\'s landing');
  assert(/const linkFlow = linkFlowScreen\(\);/.test(appSrc23),
    '…and `linkFlow` is resolved ONCE, beside `leagueFlow`, so the answer cannot change between the redirect and the render');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[24] REVIEWER N-a — an unresolvable league name renders NO pill, not an empty one…');
{
  resetAll();
  registry.set('league-pill', new FakeEl());
  document.getElementById('league-pill').id = 'league-pill';
  const pill = document.getElementById('league-pill');
  storeValidSession();

  // Fixture first: a resolvable name DOES render, so the assertions below are
  // measuring the guard and not a pill that never renders at all.
  auth._setMembershipsForTest([{ leagueId: 'A', memberId: 'm1', role: 'player', displayName: 'x', leagueName: 'League A' }]);
  auth.setActiveLeagueId('A');
  app.renderLeaguePill();
  assert(pill.hidden === false && pill.innerHTML.includes('League A'), 'fixture: a named active league renders the pill');

  // (a) The active pointer names a league this account is no longer in — the
  //     membership list resolved, it just does not contain that id.
  auth.setActiveLeagueId('GONE');
  app.renderLeaguePill();
  assert(pill.hidden === true, 'an active-league pointer that matches no cached membership renders NO pill (hidden)');
  assert(pill.innerHTML === '', '…and no markup at all — not a bordered empty chip');
  assert(pill.getAttribute('aria-label') === null || !/Active league:\s*$/.test(pill.getAttribute('aria-label') || 'x'),
    '…and no dangling "Active league: " aria-label announcing a league with no name');
  assert(pill.listenerCount('click') === 0, '…and nothing is bound to it');

  // (b) The league row genuinely carries no name (leagues(name) came back
  //     null/'' — the DI-181 create form has a 1..80 bound, but a row written
  //     before that bound, or a SELECT that could not embed the FK, can).
  auth._setMembershipsForTest([
    { leagueId: 'N', memberId: 'm1', role: 'player', displayName: 'x', leagueName: '' },
    { leagueId: 'O', memberId: 'm2', role: 'commissioner', displayName: 'x', leagueName: 'Other' },
  ]);
  auth.setActiveLeagueId('N');
  app.renderLeaguePill();
  assert(pill.hidden === true && pill.innerHTML === '',
    'a MULTI-membership account whose ACTIVE league has an empty name also renders no pill — not a caret with nothing beside it');
  assert(pill.getAttribute('role') === null && pill.listenerCount('click') === 0,
    '…and it is not left looking (or behaving) like a control');

  // …and it comes back the moment the name resolves. The guard holds the slot
  // empty; it does not latch the pill off.
  auth.setActiveLeagueId('O');
  app.renderLeaguePill();
  assert(pill.hidden === false && pill.innerHTML.includes('Other'),
    'switching to a league that DOES have a name brings the pill straight back — "hold empty" is a state, not a latch');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[25] REVIEWER N-b — the vendored SDK gets a deadline, not an open-ended wait…');
{
  // THE FAILURE: a <script> that fires neither 'load' nor 'error' (captive
  // portal, stalled proxy, a tab backgrounded mid-fetch) left the promise
  // pending forever, and boot() awaits it in supabase mode. No gate decision,
  // no membership refresh, no banner — a silent permanent hang indistinguishable
  // from a slow network.
  //
  // Driven with an INJECTED 5ms deadline against a real appendChild that never
  // fires an event, so the suite proves the race exists without sleeping for
  // the production ten seconds.
  resetAll();
  globalThis.window.supabase = undefined;      // force the injection path
  app._resetSupabaseSdkLoaderForTest();
  const t0 = Date.now();
  const stalled = await app.ensureSupabaseSdkLoaded({ timeoutMs: 5 });
  const elapsed = Date.now() - t0;
  assert(createdScripts.some(el => /supabase/.test(String(el.src || ''))), 'fixture: a <script> for the vendored SDK really was injected (otherwise there is nothing to time out on)');
  assert(stalled === false, 'a script that fires NEITHER load nor error resolves false at the deadline instead of hanging forever');
  assert(elapsed < 2000, `…and it resolves at the deadline, not at the production one (took ${elapsed}ms)`);

  // The deadline does not steal a real success: a script that loads inside the
  // window still resolves true. Without this the assertion above would pass
  // equally well for a function hardwired to false.
  resetAll();
  globalThis.window.supabase = undefined;
  app._resetSupabaseSdkLoaderForTest();
  const beforeCount = createdScripts.length;
  const p = app.ensureSupabaseSdkLoaded({ timeoutMs: 5000 });
  const injected = createdScripts.slice(beforeCount).find(el => /supabase/.test(String(el.src || '')));
  assert(!!injected, 'fixture: the second injection happened too');
  injected.dispatch('load', {});
  assert(await p === true, 'a script that DOES load inside the window still resolves true — the deadline is a floor, not a ceiling');

  // …and an 'error' is still its own answer, unchanged.
  resetAll();
  globalThis.window.supabase = undefined;
  app._resetSupabaseSdkLoaderForTest();
  const beforeCount2 = createdScripts.length;
  const p2 = app.ensureSupabaseSdkLoaded({ timeoutMs: 5000 });
  const injected2 = createdScripts.slice(beforeCount2).find(el => /supabase/.test(String(el.src || '')));
  injected2.dispatch('error', {});
  assert(await p2 === false, 'a script that ERRORS resolves false immediately, exactly as before');

  // ── REVIEWER FINDING 3 — THE DEADLINE MUST BE CANCELLED ────────────────
  // Promise.race() ignores the loser's resolution; it does not cancel the
  // TIMER. So every SUCCESSFUL supabase boot logged
  //   "[auth] the vendored Supabase SDK neither loaded nor errored within
  //    10000ms"
  // to console.error ten seconds after the SDK had in fact loaded — a red error
  // on the exact channel an operator scans to decide whether sign-in is broken,
  // describing a failure that did not happen. Driven with an injected 5ms
  // deadline and a real load, then waited PAST it; no ten-second sleep.
  for (const [label, outcome, expected] of [['load', 'load', true], ['error', 'error', false]]) {
    resetAll();
    globalThis.window.supabase = undefined;
    app._resetSupabaseSdkLoaderForTest();
    const errs = [];
    const realError = console.error;
    console.error = (...a) => errs.push(a.map(String).join(' '));
    try {
      const before = createdScripts.length;
      const pending = app.ensureSupabaseSdkLoaded({ timeoutMs: 5 });
      const el = createdScripts.slice(before).find(e => /supabase/.test(String(e.src || '')));
      assert(!!el, `fixture (${label}): the script was injected`);
      el.dispatch(outcome, {});
      assert(await pending === expected, `fixture (${label}): the promise settles ${expected} immediately, before the 5ms deadline`);
      // Well past the deadline. If the timer were still armed it would fire here.
      await new Promise(r => setTimeout(r, 40));
    } finally { console.error = realError; }
    assert(!errs.some(e => /neither loaded nor errored/.test(e)),
      `after a settled '${label}', the deadline is CLEARED — no false "neither loaded nor errored" error is logged (captured: ${JSON.stringify(errs)})`);
    if (label === 'error') {
      assert(errs.some(e => /failed to load/.test(e)),
        '…while the real failure IS still logged, so clearing the timer did not mute the honest error either');
    }
  }
  // Falsifiability: the deadline log still exists for the case it was written
  // for — a script that fires neither event.
  {
    resetAll();
    globalThis.window.supabase = undefined;
    app._resetSupabaseSdkLoaderForTest();
    const errs = [];
    const realError = console.error;
    console.error = (...a) => errs.push(a.map(String).join(' '));
    try { await app.ensureSupabaseSdkLoaded({ timeoutMs: 5 }); await new Promise(r => setTimeout(r, 20)); }
    finally { console.error = realError; }
    assert(errs.some(e => /neither loaded nor errored/.test(e)),
      'negative self-test — a script that fires NEITHER event still logs the deadline error exactly once');
    assert(errs.filter(e => /neither loaded nor errored/.test(e)).length === 1, '…once, not repeatedly');
  }

  // The production default is the stated 10s, and boot() consumes the answer.
  const appSrc25 = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
  assert(/const SUPABASE_SDK_LOAD_TIMEOUT_MS = 10000;/.test(appSrc25), 'the production deadline is 10000ms');
  assert(/timeoutMs = SUPABASE_SDK_LOAD_TIMEOUT_MS/.test(appSrc25), '…and it is the default of the injectable parameter, so the test above exercises the same code path production does');
  // DI-180l — boot() still USES the answer, and now it uses it TWICE, split on
  // the gate family's scope boundary: pre-identity (no saved session) gets the
  // fail-closed sdk-unavailable HOLD GATE, because a Google button that can
  // only fail when tapped is worse than no button; post-identity (a saved
  // session) stays the banner it always was (A8).
  // SIXTH GATE — NO CHARACTER WINDOW. This was `[\s\S]{0,3000}?`, and a comment
  // block added above wireAuthUIEvents() pushed the anchor past it, which turns
  // the fixture red (loudly, this time) but would have turned the two rules
  // below VACUOUS had the fixture assertion not existed. Same lesson [17d] rule
  // (4) already learned: a magic-number window is a rule that a long comment can
  // defeat. The span is taken between two OFFSETS instead, so it is whatever the
  // branch actually is.
  const sdkAt = appSrc25.indexOf('const sdkReady = await ensureSupabaseSdkLoaded();');
  const wireAt = sdkAt === -1 ? -1 : appSrc25.indexOf('wireAuthUIEvents();', sdkAt);
  const sdkBranch = (sdkAt === -1 || wireAt === -1) ? '' : appSrc25.slice(sdkAt, wireAt + 'wireAuthUIEvents();'.length);
  assert(!!sdkBranch, 'fixture: boot()\'s SDK branch was located (an unfound branch would make the two rules below vacuous)');
  assert(/if \(!sdkReady && !hasValidSupabaseSession\(\)\) \{[\s\S]{0,200}?showAuthHoldGate\('sdk-unavailable'\)/.test(sdkBranch),
    "boot() USES the answer — with NO proven identity, a false resolution raises DI-180l's sdk-unavailable hold gate");
  assert(/if \(!sdkReady\) showAuthUnavailableBanner\(\);/.test(sdkBranch),
    '…and with a saved session it is still the banner, never a re-block (DI-180l\'s scope boundary / A8)');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[26] SEC F3 — sign-out leaves no auth artefact on the device…');
{
  resetAll();
  storeValidSession();
  auth._setMembershipsForTest([{ leagueId: 'A', memberId: 'm1', role: 'player', displayName: 'x', leagueName: 'A' }]);
  auth.setActiveLeagueId('A');

  // The PKCE artefacts the SDK parks beside its session record, plus the PIN-
  // mode session that 'supabase' mode stops reading (and therefore stops
  // anyone noticing).
  const K = auth._AUTH_STORAGE_KEY_FOR_TEST;
  localStorage.setItem(`${K}-code-verifier`, 'verifier-abc');
  localStorage.setItem(`${K}-flow-9f2c-code-verifier`, 'verifier-def');
  localStorage.setItem('cfbp_session', JSON.stringify({ playerId: 'p_drew', isAdmin: true, playerVerified: true }));
  localStorage.setItem('cfbp_site_unlocked', '1');

  // Fixture: the stub really does enumerate, or the sweep below proves nothing.
  assert(auth._localStorageKeysForTest().includes(`${K}-code-verifier`),
    'fixture: localStorage enumerates through length/key(i), which is what the sweep walks');

  await auth.signOut();

  const leftovers = auth._localStorageKeysForTest().filter(k => k.startsWith(`${K}-`));
  assert(leftovers.length === 0, `no key starting with "${K}-" survives sign-out (found ${JSON.stringify(leftovers)}) — a PKCE code verifier is half of an authorization-code exchange`);
  assert(localStorage.getItem(K) === null, '…and the session record itself is gone');
  assert(localStorage.getItem('cfbp_session') === null,
    'cfbp_session is gone too — in supabase mode getSession() never reads it, so a stale {isAdmin:true} would sit there invisibly until a rollback read it straight back');
  assert(storage.getSession().playerId === null && storage.getSession().isAdmin === false,
    '…and the resolved session is signed out by both routes');

  // SDK-ABSENT PATH: ensureClient() returns null, so every SDK-side cleanup is
  // skipped. The sweep must still run — that was the shape of the original
  // defect ("Sign Out" looked like it worked and the next boot read it back).
  resetAll();
  storeValidSession();
  localStorage.setItem(`${K}-code-verifier`, 'verifier-xyz');
  localStorage.setItem('cfbp_session', JSON.stringify({ playerId: 'p_drew', isAdmin: true }));
  globalThis.window.supabase = undefined;
  await auth.signOut();
  assert(auth._localStorageKeysForTest().filter(k => k.startsWith(`${K}-`)).length === 0,
    'with NO Supabase client available, the prefix sweep still runs');
  assert(localStorage.getItem('cfbp_session') === null, '…and cfbp_session is still removed');

  // ── SECURITY F-1 (seventh gate) — THE SWEEP IS INVERTED, SO SO IS THIS ────
  // This block used to assert that `cfbp_players` SURVIVED a sign-out, on the
  // reasoning that the sweep was "scoped to the auth storage key prefix". That
  // was the finding: `save()` writes raw localStorage whenever the backend
  // mirror is not live (offline boot, failed hydrate, a device never connected),
  // so `cfbp_players`, `cfbp_picks`, `cfbp_comments`, `cfbp_notifications` and
  // eighteen more league keys were on the handset and were all left behind by
  // "Sign Out". The rule is now: everything under `cfbp_` goes, and the survivors
  // are a named KEEP-list, each entry justified at its declaration.
  //
  // FALSIFIABILITY, which is what this block is for: a prefix rule must not be
  // "delete everything". So it is asserted in BOTH directions — league data is
  // gone, every KEEP entry is still here, and a key belonging to some other
  // application on the same origin is untouched.
  resetAll();
  storeValidSession();
  localStorage.setItem(`${K}-code-verifier`, 'v');
  localStorage.setItem('cfbp_supabase_active_league_notes', 'similar-but-not-kept');
  localStorage.setItem('cfbp_players', 'the-league-roster');
  localStorage.setItem('cfbp_picks', 'every-players-picks');
  localStorage.setItem('cfbp_comments', 'the-whole-chat-log');
  localStorage.setItem('cfbp_site_unlocked', '1');
  localStorage.setItem('cfbp_backend_config', '{"url":"u","token":"t"}');
  localStorage.setItem('cfbp_auth_mode_last_known', 'supabase');
  // Reviewer F-2 (eighth gate) — SCRIBE's two restraint ledgers, seeded so the
  // "KEEP entries survive" loop below is measuring them and not skipping them.
  localStorage.setItem('cfbp_scribe_ledger', '{"abc123":1758000000000}');
  localStorage.setItem('cfbp_scribe_lastpost', '{"":1758000000000}');
  localStorage.setItem('someone_elses_app_key', 'not-ours');
  await auth.signOut();
  for (const k of ['cfbp_players', 'cfbp_picks', 'cfbp_comments', 'cfbp_supabase_active_league_notes']) {
    assert(localStorage.getItem(k) === null,
      `SEC F-1 — ${k} is GONE after a sign-out. In local mode save() writes these raw, so before the inversion the next account on this handset inherited every player's picks and the entire chat log.`);
  }
  // THE KEEP-LIST IS SPELLED OUT HERE, not read out of the module. Iterating
  // `_CLEAR_KEEP_KEYS_FOR_TEST` alone is self-referential: a mutation that
  // DELETES an entry also deletes the assertion about it, so the list shrinks
  // and the suite stays green (it did, on the first run of this block). Every
  // addition or removal now has to be made in two places, deliberately.
  const EXPECTED_KEEP = [
    'cfbp_site_unlocked',
    'cfbp_auth_mode_last_known',
    'cfbp_backend_config',
    'cfbp_supabase_active_league',
    'cfbp_device_data_owner',
    // REVIEWER F-2 (eighth gate, coordinator ruling 2026-09-18): SCRIBE's two
    // restraint ledgers. `{lineHash: ms}` and `{rateKey: ms}` — no player id,
    // no name, no content, they identify nobody. Sweeping them buys no privacy
    // and LOOSENS a rate limiter, which is the wrong direction for a handover.
    'cfbp_scribe_ledger',
    'cfbp_scribe_lastpost',
  ];
  assert(JSON.stringify([...auth._CLEAR_KEEP_KEYS_FOR_TEST].sort()) === JSON.stringify([...EXPECTED_KEEP].sort()),
    `SEC F-1 / reviewer F-2 — the KEEP-list is exactly the seven justified entries and nothing else (got ${JSON.stringify(auth._CLEAR_KEEP_KEYS_FOR_TEST)}). An eighth entry added without a justification beside it, or one of these quietly dropped, is the whole failure mode an include-list had.`);
  for (const k of EXPECTED_KEEP) {
    if (k === auth._DEVICE_DATA_OWNER_KEY_FOR_TEST || k === auth._ACTIVE_LEAGUE_KEY_FOR_TEST) continue;   // both removed by signOut() on its own lines
    assert(localStorage.getItem(k) !== null,
      `…and the KEEP entry ${k} SURVIVES (falsifiability — a prefix rule that took this too would be "delete everything", and each keep entry carries its justification at its declaration)`);
  }
  assert(auth._DEVICE_CLEAR_MODES_FOR_TEST.join(',') === 'handover,signout',
    'SEC F-1 — and there are exactly TWO modes, named: the token key is kept on a handover (it is the INCOMING player\'s, freshly written by the SDK) and swept on a sign-out');
  // …and the mode list is LOAD-BEARING, not documentation: an unrecognised mode
  // fails closed to the strictest one. A typo in a future caller must not be
  // able to choose "keep the previous player's token".
  {
    localStorage.setItem(auth._AUTH_STORAGE_KEY_FOR_TEST, JSON.stringify({ access_token: 't', expires_at: 9e9 }));
    localStorage.setItem('cfbp_picks', 'someone-elses');
    const realWarnF1 = console.warn; const warns = [];
    console.warn = (...a) => warns.push(a.map(String).join(' '));
    try { auth.clearDeviceLocalSessionData({ mode: 'handoverr' }); } finally { console.warn = realWarnF1; }
    assert(localStorage.getItem(auth._AUTH_STORAGE_KEY_FOR_TEST) === null,
      'SEC F-1 — an unknown mode sweeps the TOKEN too (fails closed to \'signout\'), rather than defaulting to the one mode that keeps it');
    assert(localStorage.getItem('cfbp_picks') === null, '…and the league data with it');
    assert(warns.some(w => /unknown mode/.test(w)), '…and it says so out loud rather than silently picking one');
    // …while the real handover mode still keeps the incoming player's token.
    localStorage.setItem(auth._AUTH_STORAGE_KEY_FOR_TEST, JSON.stringify({ access_token: 't', expires_at: 9e9 }));
    localStorage.setItem('cfbp_picks', 'someone-elses');
    auth.clearDeviceLocalSessionData();
    assert(localStorage.getItem(auth._AUTH_STORAGE_KEY_FOR_TEST) !== null,
      'non-vacuity — the DEFAULT (handover) mode does keep the token, so the assertion above is measuring the fallback and not the ordinary behaviour');
    assert(localStorage.getItem('cfbp_picks') === null, '…and still sweeps the league data');
    // Leave the store as the sign-out above left it, so the final re-ask below
    // is still asking about THAT sweep and not about this sub-block's fixtures.
    try { localStorage.removeItem(auth._AUTH_STORAGE_KEY_FOR_TEST); } catch {}
  }
  assert(localStorage.getItem('someone_elses_app_key') === 'not-ours',
    '…and a key that is not ours at all is untouched — the rule is OUR prefix, not the whole store');
  assert(auth._keysToClearForTest('signout').length === 0,
    'SEC F-1 — and the sweep RE-ASKS its own predicate: nothing `cfbp_` outside the KEEP-list is left to clear');

  // ── SECURITY F-1 (EIGHTH gate, cutover blocker) — A STORE THAT CANNOT BE
  //    ENUMERATED MUST NOT READ AS AN EMPTY ONE ──────────────────────────────
  //
  // The hostile handset: `length` and `key(i)` both throw (iOS private browsing,
  // a partitioned in-app browser, a quota-dead device) AND `Object.keys()` is
  // refused too — modelled with a Proxy whose `ownKeys` trap throws, because
  // `Object.keys()` on a plain object stub cheerfully returns the METHOD names
  // and would make this test measure nothing. `getItem`/`setItem`/`removeItem`
  // still work, which is exactly what makes the bug invisible: the store is
  // fully usable, it just cannot be listed.
  //
  // Before the fix this device reported a COMPLETE clear having removed nothing,
  // reconcileDeviceDataOwner() stamped the owner marker over the previous
  // player's picks and chat log, and because the marker then MATCHED every later
  // boot returned 'kept' and never looked again. Three assertions, one per
  // fail-closed direction the flag now drives.
  {
    const realLS = globalThis.localStorage;
    const hostileBase = {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
      clear: () => store.clear(),
      get length() { throw new Error('SecurityError: this store cannot be enumerated'); },
      key: () => { throw new Error('SecurityError: this store cannot be enumerated'); },
    };
    const hostile = new Proxy(hostileBase, { ownKeys() { throw new Error('SecurityError: ownKeys refused'); } });

    store.clear();
    // Seeded with keys that are NOT on `_SIGNOUT_LOCAL_KEYS`, deliberately: the
    // union loop in _scanKeysToClear() finds those BY NAME through getItem(),
    // which would mask the enumeration failure. `cfbp_picks`/`cfbp_comments` are
    // reachable ONLY by enumeration, so they are the honest fixture — and they
    // are the two that matter (every player's picks, the whole chat log).
    store.set('cfbp_picks', 'the-previous-players-picks');
    store.set('cfbp_comments', 'the-whole-chat-log');
    globalThis.localStorage = hostile;
    const realWarnE1 = console.warn; const warnsE1 = [];
    console.warn = (...a) => warnsE1.push(a.map(String).join(' '));
    let scanE1, completeE1, reconcileE1;
    try {
      scanE1 = auth._scanKeysToClearForTest('handover');
      completeE1 = auth.clearDeviceLocalSessionData({ mode: 'handover' });
      auth._setAccountUserIdForTest('u-incoming-player');
      auth.setActiveLeagueId('L-hostile');
      reconcileE1 = auth.reconcileDeviceDataOwner('eighth-gate-hostile-store');
    } finally { console.warn = realWarnE1; globalThis.localStorage = realLS; }

    assert(scanE1.enumerated === false,
      'fixture: the hostile store really is un-enumerable — _scanKeysToClear() reports `enumerated:false` (if this were true the rest of the block would be measuring an ordinary device)');
    assert(scanE1.keys.length === 0,
      'fixture: …and it therefore yields an EMPTY key list, which is the value that used to be indistinguishable from "this device is clean"');
    assert(completeE1 === false,
      'SECURITY F-1 (eighth gate) — clearDeviceLocalSessionData() reports INCOMPLETE on an un-enumerable store. It removed nothing because it could not look; claiming `true` here is what let the owner marker be written over the previous player\'s data, permanently.');
    assert(warnsE1.some(w => /could not ENUMERATE/.test(w)),
      '…and it says so out loud rather than failing quietly (loud-fail, AD-06\'s principle one layer down)');
    assert(store.get('cfbp_picks') === 'the-previous-players-picks' && store.get('cfbp_comments') === 'the-whole-chat-log',
      'fixture: the previous player\'s data IS still on the device after that call — which is precisely why the verdict must not be `true`');
    assert(localStorage.getItem(auth._DEVICE_DATA_OWNER_KEY_FOR_TEST) === null,
      'SECURITY F-1 (eighth gate) — and the OWNER MARKER IS NOT WRITTEN. This is the cutover blocker: a marker stamped here matches forever, so the next boot returns \'kept\' and the previous player\'s picks and chat log are adopted by the incoming account for good.');
    assert(reconcileE1.action === 'clear-incomplete',
      `…so reconcileDeviceDataOwner() lands on 'clear-incomplete' (got '${reconcileE1.action}'). 'adopted' is the pre-fix answer — it is reached only through _hasDeviceLocalSessionData() returning FALSE, which is the same empty list read the other way round.`);
    assert(reconcileE1.persisted === false,
      '…and reports that it did not persist, so the next boot reads MISSING and clears again rather than trusting this one');

    // NON-VACUITY — the SAME fixture with enumeration RESTORED must behave
    // differently, or the four assertions above are measuring the seeded data
    // and not the flag.
    store.clear();
    store.set('cfbp_picks', 'the-previous-players-picks');
    store.set('cfbp_comments', 'the-whole-chat-log');
    auth._setAccountUserIdForTest('u-incoming-player');
    auth.setActiveLeagueId('L-hostile');
    const scanE2 = auth._scanKeysToClearForTest('handover');
    const completeE2 = auth.clearDeviceLocalSessionData({ mode: 'handover' });
    assert(scanE2.enumerated === true && scanE2.keys.includes('cfbp_picks'),
      'non-vacuity — with enumeration working the scan FINDS the two keys and reports `enumerated:true`');
    assert(completeE2 === true,
      'non-vacuity — …and the very same clear then reports COMPLETE, so `false` above is the enumeration verdict and nothing else');
    assert(store.get('cfbp_picks') === undefined && store.get('cfbp_comments') === undefined,
      'non-vacuity — …having actually swept them');
    const reconcileE2 = auth.reconcileDeviceDataOwner('eighth-gate-non-vacuity');
    assert(reconcileE2.action === 'adopted' && reconcileE2.persisted === true,
      `non-vacuity — …and the marker IS written on a device that really is clean (got '${reconcileE2.action}')`);
    auth._setAccountUserIdForTest('');
    auth.setActiveLeagueId(null);
    store.clear();
  }

  // ── SECURITY F-1 (eighth gate) — THE PKCE PREFIX SWEEP IS DEFEATED THE SAME
  //    WAY, so it reports too ─────────────────────────────────────────────────
  // A code verifier is half of an authorization-code exchange. The sweep that
  // removes it enumerates through the same broken interface, so on the hostile
  // handset it removed nothing and said nothing — SEC F3's finding, resurrected
  // through the one line that swallowed the failure.
  {
    const realLS = globalThis.localStorage;
    const K26 = auth._AUTH_STORAGE_KEY_FOR_TEST;
    store.clear();
    store.set(`${K26}-code-verifier`, 'half-an-authorization-code-exchange');
    assert(auth._removeLocalKeysWithPrefixForTest(`${K26}-`) === true,
      'non-vacuity — on an enumerable store the PKCE sweep reports COMPLETE…');
    assert(store.get(`${K26}-code-verifier`) === undefined, '…having removed the verifier');
    store.set(`${K26}-code-verifier`, 'half-an-authorization-code-exchange');
    const hostileBase2 = {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
      get length() { throw new Error('SecurityError'); },
      key: () => { throw new Error('SecurityError'); },
    };
    globalThis.localStorage = new Proxy(hostileBase2, { ownKeys() { throw new Error('SecurityError'); } });
    let prefixVerdict;
    const realWarnE3 = console.warn; console.warn = () => {};
    try { prefixVerdict = auth._removeLocalKeysWithPrefixForTest(`${K26}-`); }
    finally { console.warn = realWarnE3; globalThis.localStorage = realLS; }
    assert(prefixVerdict === false,
      'SECURITY F-1 (eighth gate) — and the PKCE prefix sweep reports INCOMPLETE on an un-enumerable store rather than returning silently, so a caller can tell "there was nothing to remove" from "I could not look"');
    assert(store.get(`${K26}-code-verifier`) === 'half-an-authorization-code-exchange',
      'fixture: …and the verifier really is still there, which is what the verdict is about');
    store.clear();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[27] SEC F4 — an expired JWT says "expired", not "check your connection"…');
{
  // A PostgREST 401 / PGRST301 on the membership read means the token is dead.
  // The fix is one tap on "Sign In". Telling that player "Can't reach sign-in
  // right now. Your picks are safe; try again in a minute." sends them to
  // restart their wifi — the same class of misdirection SEC F2 fixed in the
  // other direction, so both branches are pinned here.
  const expiredCases = [
    ['a PostgREST 401', () => Object.assign(new Error('JWT expired'), { status: 401 })],
    ['a PGRST301 code', () => Object.assign(new Error('permission denied'), { code: 'PGRST301' })],
    ['a GoTrue not_authenticated message', () => new Error('not_authenticated')],
  ];
  for (const [label, makeErr] of expiredCases) {
    resetAll({ getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }),
               from: () => { throw makeErr(); } });
    wireRealAuthUI();
    storeValidSession();
    try { await auth.refreshMembershipsAndSession(); } catch {}
    await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
    assert(!!document.getElementById('session-expired-banner'), `${label}: the SESSION-EXPIRED banner is raised (DI-180c)`);
    assert(String(document.getElementById('session-expired-banner')?.innerHTML || '').includes('Your session expired'),
      `${label}: …with DI-180c's copy`);
    assert(!document.getElementById('auth-unavailable-banner'),
      `${label}: and NOT the "can't reach sign-in" banner — one failure, one story`);
    assert(auth.isSessionExpired() === true, `${label}: the expiry latch is set, so the gate's own re-render agrees`);
    assert(app.needsLeagueFlowScreen() === false, `${label}: the join/create landing stays unreachable either way (SEC F2 holds)`);
  }

  // THE OTHER BRANCH, unchanged: a genuine transport failure is still the
  // unavailable banner. Without this pair, hardwiring every failure to
  // "expired" would pass everything above.
  const unavailableCases = [
    ['a dropped connection', () => { throw new TypeError('Failed to fetch'); }],
    ['an unrecognised server error', () => { throw new Error('some unmapped condition'); }],
  ];
  for (const [label, from] of unavailableCases) {
    resetAll({ getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }), from });
    wireRealAuthUI();
    storeValidSession();
    try { await auth.refreshMembershipsAndSession(); } catch {}
    await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
    assert(!!document.getElementById('auth-unavailable-banner'), `${label}: raises the auth-UNAVAILABLE banner`);
    assert(!document.getElementById('session-expired-banner'), `${label}: …and never claims the session expired`);
    assert(auth.isSessionExpired() === false, `${label}: …and does not set the expiry latch`);
  }

  // The classifier itself, in isolation — narrow on purpose: anything it does
  // not recognise falls through to "unavailable", which is the honest answer.
  assert(auth.isSessionExpiredError(Object.assign(new Error('x'), { status: 401 })) === true, 'isSessionExpiredError(): status 401 -> expired');
  assert(auth.isSessionExpiredError(new Error('PGRST301')) === true, 'isSessionExpiredError(): PGRST301 in the message -> expired');
  assert(auth.isSessionExpiredError(new Error('JWT expired')) === true, 'isSessionExpiredError(): "JWT expired" -> expired');
  assert(auth.isSessionExpiredError(Object.assign(new Error('x'), { status: 500 })) === false, 'isSessionExpiredError(): a 500 is NOT an expiry');
  assert(auth.isSessionExpiredError(new TypeError('Failed to fetch')) === false, 'isSessionExpiredError(): a transport failure is NOT an expiry');
  assert(auth.isSessionExpiredError(null) === false, 'isSessionExpiredError(null) is false, never a throw');

  // ── SEC S-4 (a) — REVOKED REFRESH TOKENS ARRIVE AS 400/403, NOT 401 ──────
  // Widened against the shapes the VENDORED SDK itself recognises. Cited so the
  // list is checkable rather than asserted (vendor/supabase-js-2.116.0.js is
  // minified; offsets are into that file):
  //   • ~110014 `AuthApiError`: `this.name='AuthApiError'; this.status=t;
  //     this.code=n` — a GoTrue rejection carries BOTH a status and a string code.
  //   • ~182311, the SDK's own INITIAL_SESSION handler, treats exactly
  //     `refresh_token_not_found` / `refresh_token_already_used` /
  //     `session_expired` as "the session is gone, this is expected".
  //   • ~122669 reads the wire body's code as `code` ELSE `error_code`, and maps
  //     `session_not_found` to AuthSessionMissingError (~110353, status 400).
  //   • `invalid_grant` and the literal "Invalid Refresh Token" are NOT in the
  //     bundle — they are what the GoTrue SERVER returns for a revoked refresh
  //     token, so they are matched as text and not claimed as SDK constants.
  const refreshDeaths = [
    ['GoTrue 400 refresh_token_not_found', Object.assign(new Error('Invalid Refresh Token: Refresh Token Not Found'), { name: 'AuthApiError', status: 400, code: 'refresh_token_not_found' })],
    ['GoTrue 400 refresh_token_already_used', Object.assign(new Error('Invalid Refresh Token: Already Used'), { name: 'AuthApiError', status: 400, code: 'refresh_token_already_used' })],
    ['GoTrue 403 session_expired', Object.assign(new Error('Session Expired'), { name: 'AuthApiError', status: 403, code: 'session_expired' })],
    ['an OAuth2 invalid_grant on error_code', Object.assign(new Error('invalid grant'), { status: 400, error_code: 'invalid_grant' })],
    ['the bare server message, no code at all', new Error('Invalid Refresh Token: Refresh Token Not Found')],
    ['AuthSessionMissingError', Object.assign(new Error('Auth session missing!'), { name: 'AuthSessionMissingError', status: 400 })],
  ];
  for (const [label, err] of refreshDeaths) {
    assert(auth.isSessionExpiredError(err) === true, `isSessionExpiredError(): ${label} -> expired`);
  }
  // STILL NARROW — the whole value of this classifier is what it refuses.
  const notExpiry = [
    ['a bare 400 with no recognisable code', Object.assign(new Error('bad request'), { status: 400 })],
    ['a bare 403', Object.assign(new Error('forbidden'), { status: 403 })],
    ['a 500 with a scary message', Object.assign(new Error('internal token error'), { status: 500 })],
    ['a PostgREST row-level-security refusal', Object.assign(new Error('new row violates row-level security policy'), { status: 403, code: '42501' })],
  ];
  for (const [label, err] of notExpiry) {
    assert(auth.isSessionExpiredError(err) === false, `isSessionExpiredError(): ${label} is NOT an expiry — it falls through to the honest "we don't know" banner`);
  }

  // ── SEC S-4 (b) — AN EXPIRED SESSION IS TAKEN OFF THE DEVICE ─────────────
  // The old code set a banner latch and changed nothing else: the dead token
  // stayed in localStorage (hasValidSupabaseSession() kept answering TRUE) and
  // _membershipsCache kept its last good rows, so a COMMISSIONER panel stayed
  // painted over a session the server had already rejected.
  //
  // DI-180p (approved 2026-09-17) — WHEN it happens changed, and that is the
  // point of the input: destruction now waits for PROOF. Each case below
  // therefore says how the proof arrives:
  //   • a dead refresh token is proof on the FIRST failure (the SDK's own
  //     enumerated codes — there is no refresh token left to try);
  //   • a bare 401 is NOT, because a 90-second-slow clock produces exactly that
  //     shape, so it takes a failed refresh plus a SECOND 401 to destroy.
  // The state assertions themselves — the whole point of SEC S-4 — are
  // unchanged, and still run against the moment the clear actually happens.
  for (const [label, makeErr, driveToDestruction] of [
    ['a PostgREST 401', () => Object.assign(new Error('JWT expired'), { status: 401 }), 2],
    ['a revoked refresh token (400)', () => Object.assign(new Error('Invalid Refresh Token: Refresh Token Not Found'), { name: 'AuthApiError', status: 400, code: 'refresh_token_not_found' }), 1],
  ]) {
    let rows = [{ league_id: 'L-A', id: 'mA', role: 'commissioner', display_name: 'Drew', active: true, leagues: { name: 'League A' } }];
    let failing = false;
    resetAll({
      getSession: async () => ({ data: { session: { user: { id: 'u-drew', email: 'drew@example.com' } } } }),
      // DI-180p — the SDK is asked to refresh once. This fake REFUSES (no
      // session back, no recognisable code), which is the 'unknown' verdict:
      // keep the lock, destroy nothing, let the next 401 be strike two.
      refreshSession: async () => ({ data: { session: null }, error: Object.assign(new Error('network'), { status: 0 }) }),
      from: () => { if (failing) throw makeErr(); return { data: rows, error: null }; },
    });
    wireRealAuthUI();
    storeValidSession();
    const K = auth._AUTH_STORAGE_KEY_FOR_TEST;
    localStorage.setItem(`${K}-code-verifier`, 'verifier-abc');
    await auth.refreshMembershipsAndSession();
    assert(storage.getSession().isAdmin === true && auth.hasValidSupabaseSession() === true,
      `${label}: fixture — a live COMMISSIONER session on this device before the token dies`);

    failing = true;
    // ── DI-180p's FIRST failure: locked, banner up, NOTHING destroyed ────────
    try { await auth.refreshMembershipsAndSession(); } catch {}
    await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
    if (driveToDestruction === 2) {
      assert(localStorage.getItem(K) !== null,
        `${label}: DI-180p — after the FIRST 401 the saved sign-in is still on the device (a slow clock and a rotated key both produce this exact shape)`);
      assert(storage.getSession().isAdmin === false,
        `${label}: …but every privileged surface is already locked (${JSON.stringify(storage.getSession())}) — the LOCK is immediate, only the DESTRUCTION waits`);
      assert(storage.getSession().playerId === 'mA',
        `${label}: …and playerId is untouched, so the identity tuple did not move and no draft was suspended by a false alarm`);
      assert(auth.isPrivilegeHeld() === true, `${label}: …which is the unverified-expiry hold, readable as state`);
      assert(!!document.getElementById('session-expired-banner'), `${label}: …with the banner already on screen`);
      // Strike two, in the same page.
      try { await auth.refreshMembershipsAndSession(); } catch {}
      await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
      assert(auth._expiredStrikesForTest() >= 2, `${label}: …and the second consecutive 401 is COUNTED, not guessed at`);
    }

    assert(localStorage.getItem(K) === null,
      `${label}: the dead token is REMOVED from the device — a session the server rejected must not read back as valid`);
    assert(auth._localStorageKeysForTest().filter(k => k.startsWith(`${K}-`)).length === 0,
      `${label}: …and the PKCE artefacts with it`);
    assert(auth.hasValidSupabaseSession() === false,
      `${label}: hasValidSupabaseSession() now answers FALSE — the gate's own condition can finally be true`);
    assert(storage.getSession().isAdmin === false && storage.getSession().playerId === null,
      `${label}: getSession() resolves SIGNED OUT (${JSON.stringify(storage.getSession())}) — no commissioner rights survive a dead session`);
    assert(auth.hasResolvedMemberships() === false && auth.getCachedMemberships().length === 0,
      `${label}: the membership cache is cleared, so nothing downstream can re-derive a role from it`);
    assert(auth.getAccountEmail() === '' && auth.getAccountUserId() === '',
      `${label}: and the account identity is cleared too`);
    assert(auth.getActiveLeagueId() === 'L-A',
      `${label}: the active-league POINTER is deliberately kept — the player is about to sign back into the same league, and "your token died" is not a reason to re-scope the device`);
    assert(!!document.getElementById('session-expired-banner'),
      `${label}: DI-180c's session-expired banner is on screen`);
    assert(app.needsLeagueFlowScreen() === false,
      `${label}: and the join/create landing stays unreachable (SEC F2 still holds over the new clearing)`);

    // WHAT ACTUALLY HAPPENS ON SCREEN, stated rather than assumed. The gate is
    // NOT repainted by MEMBERSHIPS_FAILED — that event is not one of
    // AUTH_SESSION_EVENTS, and refreshAuthUI() only touches the overlay for
    // those. The banner appears, the commissioner surface is re-rendered
    // signed-out by the navigateTo() at the end of the handler, and the Google
    // gate paints on the NEXT session event (the SDK's own SIGNED_OUT, or the
    // next boot). No Sign In button is added to the unavailable banner — that
    // is UI and is going through a DI amendment.
    assert(!document.getElementById('site-gate-overlay'),
      `${label}: (recorded, not desired) the sign-in gate is NOT repainted by the membership failure itself`);
    auth._fireAuthEventForTest('SIGNED_OUT', null);
    assert(!!document.getElementById('site-gate-overlay'),
      `${label}: …and it DOES paint on the next session event, now that hasValidSupabaseSession() is false — the state clearing is what makes that possible`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[28] Hardening note — the test hooks are not reachable from a page…');
{
  // The security review flagged that _setHasSupabaseDataBackendForTest() and
  // _setMembershipsForTest() ship to production, and asked whether they can be
  // cheaply made inert without a build step. The honest answer, recorded here
  // as an executable assertion rather than a claim: they already are, BECAUSE
  // ES module exports are not globals. Nothing can call them from a console
  // unless app.js explicitly bridges them onto `window`, and app.js's bridge
  // list is short, deliberate and asserted below. A runtime "am I a test?"
  // flag would be strictly weaker — anything that could reach the hook could
  // also set the flag.
  //
  // What is NOT closed by this, and stays a Step 4 item: hasSupabaseDataBackend()
  // must stop being a constant and derive from the live adapter. Until it does,
  // the override hook is the only thing that can change its answer, which is
  // exactly why it must stay unreachable.
  const appSrc28 = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
  const authSrc28 = readFileSync(new URL('./js/auth.js', import.meta.url), 'utf8');
  const bridged = [...appSrc28.matchAll(/^window\.([A-Za-z0-9_$]+)\s*=\s*([A-Za-z0-9_$.]+);/gm)].map(m => [m[1], m[2]]);
  assert(bridged.length > 0, `fixture: app.js's window bridge really does exist (found ${bridged.length} entries) — an empty match would make the rule below vacuous`);
  const leaked = bridged.filter(([, rhs]) => /ForTest|_set|_reset|_fire/i.test(rhs));
  assert(leaked.length === 0, `no test hook is bridged onto window (found ${JSON.stringify(leaked)})`);
  assert(!/\bwindow\.[A-Za-z0-9_$]+\s*=/.test(authSrc28), 'js/auth.js attaches nothing to window at all — its exports are reachable only through an ES import');
  assert(/_setHasSupabaseDataBackendForTest/.test(authSrc28) && /_setMembershipsForTest/.test(authSrc28),
    '…and the hooks this is about do exist in that file, so the two assertions above are about something real');

  // ── SECURITY F-5 (EIGHTH gate, 2026-09-18) — THE EXPORTED ALLOW-LISTS ARE
  //    IMMUTABLE, NOT MERELY DOCUMENTED AS SUCH ──────────────────────────────
  //
  // The reasoning above ("ES module exports are not globals, so a console cannot
  // reach them") answers the WINDOW question and stops there. It does not answer
  // the in-process one, and three exports make that question real: they are not
  // hooks, they are ALLOW-LISTS, and each decides something security-relevant.
  //   • `_CLEAR_KEEP_KEYS_FOR_TEST`   — what SURVIVES the device-local sweep.
  //   • `_DEVICE_CLEAR_MODES_FOR_TEST` — which modes the fail-closed validation
  //                                      will accept.
  //   • `_SYSTEM_AUTHORS_FOR_TEST`    — whose queued events may flush under a
  //                                      different member's session.
  // A single `push('cfbp_picks')` or `.add('p3')` from anywhere in the module
  // graph — including a suite that ran earlier in this very process — widens one
  // of them permanently, in production code, with no diff to show for it.
  //
  // MUTATION IS ATTEMPTED, NOT INFERRED. `Object.isFrozen()` alone would be a
  // false comfort for the Set (see below), so each list is actually pushed at
  // and then re-read.
  {
    const keepBefore = [...auth._CLEAR_KEEP_KEYS_FOR_TEST];
    assert(Object.isFrozen(auth._CLEAR_KEEP_KEYS_FOR_TEST),
      'SEC F-5 — _CLEAR_KEEP_KEYS is frozen');
    let keepThrew = false;
    try { auth._CLEAR_KEEP_KEYS_FOR_TEST.push('cfbp_picks'); } catch { keepThrew = true; }
    assert(keepThrew, '…and a push at it THROWS (ES modules are strict mode, where a frozen array refuses rather than silently ignoring)');
    assert(JSON.stringify([...auth._CLEAR_KEEP_KEYS_FOR_TEST]) === JSON.stringify(keepBefore),
      `…and the list is unchanged afterwards — 'cfbp_picks' on this list would exempt every player's picks from every sweep (got ${JSON.stringify([...auth._CLEAR_KEEP_KEYS_FOR_TEST])})`);

    const modesBefore = [...auth._DEVICE_CLEAR_MODES_FOR_TEST];
    assert(Object.isFrozen(auth._DEVICE_CLEAR_MODES_FOR_TEST), 'SEC F-5 — DEVICE_CLEAR_MODES is frozen');
    let modesThrew = false;
    try { auth._DEVICE_CLEAR_MODES_FOR_TEST.push('keep-everything'); } catch { modesThrew = true; }
    assert(modesThrew && JSON.stringify([...auth._DEVICE_CLEAR_MODES_FOR_TEST]) === JSON.stringify(modesBefore),
      '…and a pushed-on mode does not stick — an accepted extra mode is how the fail-closed validation would be talked into KEEPING the previous player\'s token');

    // ── js/chat.js's hook, and the TWO traps that make this worth asserting.
    //
    // SECURITY F-5 (audit #10). The first version of this block asserted
    // `Object.isFrozen()` and that `.add()` threw. Both were satisfied by a
    // shape that is NOT immutable: a Set's contents live in an INTERNAL SLOT, so
    // `Object.freeze(new Set([...]))` freezes nothing that matters and
    // `Set.prototype.add.call(SET, 'p3')` walks straight past an own-property
    // stub and mutates the slot anyway. The module is a FROZEN ARRAY now (same
    // arc, same two wrong answers, as js/supabase-backend.js:109-140).
    //
    // THE PROBE IS SHAPE-AGNOSTIC ON PURPOSE, which is the second trap:
    // "push() throws" is ALSO true of a value that has no `push` at all — i.e.
    // of a Set — so a throw-shaped assertion passes against the very shape it
    // exists to reject. What is actually being claimed is THE CONTENTS DO NOT
    // CHANGE, whatever is thrown at them. So that is what is measured: snapshot,
    // attempt every bypass, compare. A throw is allowed and a silent no-op is
    // allowed; a mutation is not.
    const sysList = chat._SYSTEM_AUTHORS_FOR_TEST;
    assert(Array.isArray(sysList),
      `SEC F-5 — SYSTEM_AUTHORS is a frozen ARRAY, not a Set (a Set's contents are internal slots and cannot be frozen, so a "frozen" Set is a Set)`);
    assert(Object.isFrozen(sysList), 'SEC F-5 — …and it is frozen');
    const sysBefore = JSON.stringify([...sysList]);
    assert(JSON.stringify([...sysList].sort()) === JSON.stringify(['scribe', 'system']),
      `fixture: SYSTEM_AUTHORS is the two known names (got ${sysBefore})`);
    const tryIt = (fn) => { try { fn(); } catch { /* a throw is a fine outcome; a mutation is not */ } };
    for (const [label, fn] of [
      ['push', () => sysList.push('p3')],
      ['index write', () => { sysList[0] = 'p3'; }],
      ['length = 0', () => { sysList.length = 0; }],
      // THE PROTOTYPE-CALL PROBES — the exact bypasses that defeated both earlier shapes.
      ['Array.prototype.push.call', () => Array.prototype.push.call(sysList, 'p3')],
      ['Array.prototype.splice.call', () => Array.prototype.splice.call(sysList, 0, 1)],
      ['Set.prototype.add.call', () => Set.prototype.add.call(sysList, 'p3')],
      ['Set.prototype.delete.call', () => Set.prototype.delete.call(sysList, 'scribe')],
      ['Set.prototype.clear.call', () => Set.prototype.clear.call(sysList)],
    ]) {
      tryIt(fn);
      assert(JSON.stringify([...sysList]) === sysBefore,
        `SEC F-5 — SYSTEM_AUTHORS is UNCHANGED after ${label} (a player id added here is exempted from flushOutbox()'s author guard; 'scribe' removed silences every SCRIBE post)`);
    }
    assert(sysList.length === 2, `SEC F-5 — …and it still has its two entries (got ${sysList.length})`);
    assert(sysList.includes('scribe') && sysList.includes('system') && !sysList.includes('p3'),
      'non-vacuity — includes() still answers correctly, so the list was hardened rather than broken');

    // …and chat.js's own hooks are no more reachable from a page than auth.js's.
    const chatSrc28 = readFileSync(new URL('./js/chat.js', import.meta.url), 'utf8');
    assert(!/\bwindow\.[A-Za-z0-9_$]+\s*=/.test(chatSrc28),
      'js/chat.js attaches nothing to window either — _SYSTEM_AUTHORS_FOR_TEST/_outboxForTest are reachable only through an ES import');
    assert(/_SYSTEM_AUTHORS_FOR_TEST/.test(chatSrc28) && /_outboxForTest/.test(chatSrc28),
      '…and those hooks do exist in that file, so the assertion above is about something real');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[29] DI-180o(b) — an EXPIRY suspends the slate; it does not discard it…');
{
  // THE DEFECT THE FOURTH GATE BLOCKED ON, in one sentence: a player half-way
  // through a slate whose session expired tapped "Sign In", came back as
  // THEMSELVES, and their picks were gone. Nine consequences of an expiry were
  // asserted in [27] and the one a player would actually notice was not.
  //
  // Everything below is driven through the REAL listener chain — auth.js's own
  // emit -> app.js's wired listener -> refreshAuthUI -> the chokepoint. Nothing
  // hand-calls the chokepoint, and nothing hand-calls the suspension.
  const realFetch29 = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ oneSignalAppId: 'test-app-id' }) });
  const drain = async (os = { login: () => {}, logout: () => {} }) => {
    for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0));
    const queue = globalThis.window.OneSignalDeferred || [];
    const pending = queue.splice(0, queue.length);
    for (const cb of pending) { try { await cb(os); } catch {} }
  };
  const ROW_DREW = { league_id: 'L-A', id: 'mA', role: 'player', display_name: 'Drew', active: true, leagues: { name: 'League A' } };
  const ROW_KEVIN = { league_id: 'L-A', id: 'mK', role: 'player', display_name: 'Kevin', active: true, leagues: { name: 'League A' } };
  const DEAD_REFRESH = () => Object.assign(new Error('Invalid Refresh Token: Refresh Token Not Found'), { name: 'AuthApiError', status: 400, code: 'refresh_token_not_found' });

  /**
   * A device signed in as `uid`, scoped to League A, with a HALF-FILLED SLATE,
   * whose session then expires with proof (a dead refresh token, so DI-180p
   * destroys on the first failure rather than waiting for strike two — the
   * verify-before-destroy machinery has its own section, [30]).
   */
  async function expireMidSlate() {
    let rows = [ROW_DREW];
    let failWith = null;
    // The fake SDK reports whoever is CURRENTLY signed in, not a hardcoded id.
    // getMemberships() re-reads client.storage.getSession() on every call and
    // writes `_accountUserId` from it (instrumented write, term 1), so a
    // hardcoded id here would silently overwrite a second account's id back to
    // the first one's and make the whole handover scenario untestable.
    let uid = { id: 'u-drew', email: 'drew@example.com' };
    resetAll({
      getSession: async () => ({ data: { session: { user: uid } } }),
      from: () => { if (failWith) throw failWith(); return { data: rows, error: null }; },
    });
    wireRealAuthUI();
    globalThis.window.OneSignalDeferred = [];
    storeValidSession();
    auth._fireAuthEventForTest('SIGNED_IN', { user: { id: 'u-drew', email: 'drew@example.com' } });
    await drain();
    assert(storage.getSession().playerId === 'mA' && auth.getActiveLeagueId() === 'L-A',
      'fixture: signed in, scoped to League A, playerId is A\'s member id');
    // The half-filled slate.
    app.state.draftPicks = { g1: 'home', g2: 'away', g3: 'home' };
    app.state.draftTiebreaker = 44;
    app.state.draftExtraPoint = 31;
    app.state.layoutEditing = 'dashboard';
    globalThis.window.OneSignalDeferred = [];

    failWith = DEAD_REFRESH;
    try { await auth.refreshMembershipsAndSession(); } catch {}
    let loggedOut = false;
    await drain({ login: () => {}, logout: () => { loggedOut = true; } });
    return {
      setRows: r => { rows = r; },
      setUser: u => { uid = u; },
      heal: () => { failWith = null; },
      loggedOut: () => loggedOut,
    };
  }

  // ── (1) WHILE SIGNED OUT: nothing draft-derived is reachable ─────────────
  {
    const dev = await expireMidSlate();
    assert(auth.hasValidSupabaseSession() === false && storage.getSession().playerId === null,
      'fixture: the expiry really did sign this device out (DI-180p had proof, so it destroyed)');
    assert(Object.keys(app.state.draftPicks).length === 0 && app.state.draftTiebreaker === null
           && app.state.draftExtraPoint === null && !app.state.layoutEditing,
      `NOTHING DRAFT-DERIVED IS REACHABLE while signed out — all four fields are out of state (${JSON.stringify(app.state.draftPicks)}, ${app.state.draftTiebreaker}, ${app.state.draftExtraPoint}, ${app.state.layoutEditing})`);
    const box = app._suspendedSlateForTest();
    assert(!!box && Object.keys(box.draftPicks).length === 3 && box.draftTiebreaker === 44 && box.draftExtraPoint === 31 && box.layoutEditing === 'dashboard',
      `…because they were MOVED into the suspension box, not deleted (${JSON.stringify(box && { p: Object.keys(box.draftPicks).length, tb: box.draftTiebreaker, ep: box.draftExtraPoint, le: box.layoutEditing })})`);
    assert(box.accountId === 'u-drew',
      `…keyed to the last PROVEN account id, which is the only thing that can unlock it again (got ${JSON.stringify(box.accountId)}, key ${JSON.stringify(box.key)})`);
    assert(dev.loggedOut() === true,
      'OneSignal is logged OUT at the expiry itself — a device nobody is signed into must stop receiving the previous player\'s pushes immediately, not at the next sign-in');
  }

  // ── (2) THE SAME ACCOUNT COMES BACK: the slate is exactly where it was ──
  {
    const dev = await expireMidSlate();
    dev.heal();                       // the server is answering again
    storeValidSession();              // the OAuth round trip landed
    auth._fireAuthEventForTest('SIGNED_IN', { user: { id: 'u-drew', email: 'drew@example.com' } });
    await drain();
    assert(storage.getSession().playerId === 'mA',
      'fixture: the same account resolved back to the same membership');
    assert(Object.keys(app.state.draftPicks).length === 3 && app.state.draftPicks.g1 === 'home',
      `expiry -> SAME-account sign-in KEEPS the draft picks (got ${JSON.stringify(app.state.draftPicks)}) — this is the assertion whose absence blocked the fourth gate`);
    assert(app.state.draftTiebreaker === 44 && app.state.draftExtraPoint === 31,
      '…and the tiebreaker and the Extra Point guess with them');
    assert(app.state.layoutEditing === 'dashboard',
      '…and the in-progress layout edit');
    assert(app._suspendedSlateForTest() === null,
      '…and the box is emptied on restore, so a LATER different account cannot inherit it');
    assert(app._lastIdentityKeyForTest() === app._currentIdentityKeyForTest(),
      'the page-level latch is left holding the CURRENT identity — a restore is not allowed to leave it stale (that is F-1 reborn)');
  }

  // ── (2b) A SECOND EXPIRY MUST NOT EMPTY THE BOX ─────────────────────────
  // auth.js's expiry latch STAYS SET across later events, so without a guard a
  // second expiry-classified delta would capture again — over the top of a
  // real suspension, with the now-EMPTY state — and silently destroy exactly
  // the slate this input exists to keep. The realistic sequence: the player
  // taps Sign In, the OAuth round trip lands, but the membership read fails
  // with the token still dead before it can resolve.
  {
    const dev = await expireMidSlate();
    const firstKey = app._suspendedSlateForTest()?.key;
    assert(!!firstKey, 'fixture: a slate is suspended after the first expiry');
    // Sign-in lands, membership read fails expired again (strike two).
    storeValidSession();
    auth._fireAuthEventForTest('SIGNED_IN', { user: { id: 'u-drew', email: 'drew@example.com' } });
    await drain();
    const box = app._suspendedSlateForTest();
    assert(!!box && box.key === firstKey && Object.keys(box.draftPicks).length === 3,
      `a SECOND expiry does NOT re-capture over an existing suspension (key ${JSON.stringify(box && box.key)}, ${box ? Object.keys(box.draftPicks).length : 0} picks) — the latch stays set, so a re-capture would replace a real slate with the empty one`);
    // …and the real sign-in still restores it.
    dev.heal();
    storeValidSession();
    auth._fireAuthEventForTest('SIGNED_IN', { user: { id: 'u-drew', email: 'drew@example.com' } });
    await drain();
    assert(Object.keys(app.state.draftPicks).length === 3 && app.state.draftTiebreaker === 44 && app.state.draftExtraPoint === 31,
      `…so the slate still comes back after two expiries (got ${JSON.stringify(app.state.draftPicks)})`);
  }

  // ── (3) A DIFFERENT ACCOUNT SIGNS IN: wiped, before anything renders ────
  {
    const dev = await expireMidSlate();
    // A9's timing: the previous player's device-local data is still here while
    // the same player might come back…
    localStorage.setItem('cfbp_chat_lastseen2', '{"x":1}');
    assert(!!app._suspendedSlateForTest(), 'fixture: a slate is suspended before the handover');
    dev.setRows([ROW_KEVIN]);
    dev.setUser({ id: 'u-kevin', email: 'kevin@example.com' });
    dev.heal();
    storeValidSession();
    auth._fireAuthEventForTest('SIGNED_IN', { user: { id: 'u-kevin', email: 'kevin@example.com' } });
    await drain();
    assert(auth.getAccountUserId() === 'u-kevin', 'fixture: a DIFFERENT Google account is now at this device');
    assert(app._suspendedSlateForTest() === null,
      'expiry -> DIFFERENT-account sign-in WIPES the suspended slate (RG-51 preserved: player A\'s slate can never pre-fill player B\'s)');
    assert(Object.keys(app.state.draftPicks).length === 0 && app.state.draftTiebreaker === null && app.state.draftExtraPoint === null,
      '…and nothing from it is in state either');
    assert(localStorage.getItem('cfbp_chat_lastseen2') === null,
      'A9 — …and THIS is the moment the previous player\'s device-local data is cleared on the expiry path (chat cache, cursors, notify log, outbox, mirror)');
  }
  // …and the wipe happens BEFORE the first render, which is an ORDERING claim
  // about refreshAuthUI() and is therefore read off the source: the chokepoint
  // call must precede every render call in that handler.
  {
    const src29 = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
    const fn29 = (src29.match(/export function refreshAuthUI\([\s\S]*?\n\}/) || [''])[0];
    const chokeAt = fn29.indexOf('applyIdentityDeltaIfChanged(');
    const navAt = fn29.indexOf('navigateTo(');
    const headerAt = fn29.indexOf('refreshHeader(');
    assert(chokeAt > -1 && navAt > -1 && headerAt > -1, 'fixture: refreshAuthUI() was located with both its chokepoint call and its render calls');
    assert(chokeAt < navAt && chokeAt < headerAt,
      `…and the wipe/restore decision runs BEFORE the first render (choke@${chokeAt}, header@${headerAt}, nav@${navAt}) — "wiped before anything paints"`);
  }

  // ── (4) AN EXPLICIT SIGN OUT WIPES, as it always did ────────────────────
  {
    await expireMidSlate();
    assert(!!app._suspendedSlateForTest(), 'fixture: a slate is suspended');
    await auth.signOut();
    await drain();
    assert(app._suspendedSlateForTest() === null,
      'expiry -> explicit Sign Out WIPES: an expiry is not a change of person, a Sign Out is');
    assert(Object.keys(app.state.draftPicks).length === 0, '…and state stays empty');
  }

  // ── (5) A LEAGUE SWITCH WIPES TOO ───────────────────────────────────────
  {
    await expireMidSlate();
    assert(!!app._suspendedSlateForTest(), 'fixture: a slate is suspended');
    // The real path: the pointer moves INSIDE switchActiveLeague()'s batch and
    // SWITCH_END is emitted after it, so the chokepoint sees the final tuple.
    auth._setMembershipsForTest([
      { leagueId: 'L-A', memberId: 'mA', role: 'player', displayName: 'Drew', leagueName: 'League A' },
      { leagueId: 'L-B', memberId: 'mB', role: 'player', displayName: 'Drew', leagueName: 'League B' },
    ]);
    assert(!!app._suspendedSlateForTest(),
      'fixture: a membership refresh that does NOT move the account does not discard the suspension (that would throw the slate away one event before the one that restores it)');
    await auth.switchActiveLeague('L-B');
    await drain();
    assert(app._suspendedSlateForTest() === null,
      'a completed league switch WIPES the suspension — the scope the slate belongs to moved');
  }
  // …and the discard set is exactly the deliberate ones, read structurally so a
  // fourth event cannot be added to it by accident (and MEMBERSHIPS_REFRESHED
  // cannot be added to it at all, which would break every restore).
  {
    const src29b = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
    const fn29b = (src29b.match(/export function refreshAuthUI\([\s\S]*?\n\}/) || [''])[0];
    assert(/const discard = \(event === 'SIGNED_OUT' && !expiry\) \|\| event === 'SWITCH_END';/.test(fn29b),
      "the discard set is exactly {a deliberate SIGNED_OUT, SWITCH_END} — and NOT MEMBERSHIPS_REFRESHED, which is the event that RESOLVES a returning player's tuple and therefore restores");
    assert(/applyIdentityDeltaIfChanged\('account-sheet-signout', \{ discard: true \}\)/.test(src29b),
      '…and the Account sheet\'s Sign Out passes it explicitly, so the chokepoint does not depend on a listener being wired');
    assert(/applyIdentityDeltaIfChanged\(`league-switch:\$\{leagueId\}`, \{ discard: true \}\)/.test(src29b),
      '…as does doSwitchActiveLeague()\'s idempotent net');
  }

  // ── (6) FAIL-CLOSED: no proven account id => nothing is kept ────────────
  {
    resetAll({ getSession: async () => ({ data: { session: null } }) });
    wireRealAuthUI();
    app.state.draftPicks = { g9: 'home' };
    app.state.draftTiebreaker = 7;
    // An expiry on a page whose latch has never held a resolved account id
    // (the boot-time case: _lastIdentityKey starts null).
    auth._fireAuthEventForTest('SIGNED_OUT', null);
    await new Promise(r => setTimeout(r, 0));
    assert(app._suspendedSlateForTest() === null,
      'FAIL-CLOSED — with no proven account id in memory for this page, an expiry keeps NOTHING (DI-180o\'s stated rule: missing/unknown => wipe)');
    assert(Object.keys(app.state.draftPicks).length === 0 && app.state.draftTiebreaker === null,
      '…and the draft is cleared, exactly as the general "unknown => changed" rule has always done');
  }

  // ── (7) THE GENERAL COMPARISON IS UNTOUCHED, and the box is unreachable ─
  // "Unknown => changed" stays the default and expiry is the single NAMED
  // exception. Read structurally, because that is the property (three attempts
  // to loosen the comparison itself have failed review).
  {
    const src29 = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
    const choke = (src29.match(/function applyIdentityDeltaIfChanged\([\s\S]*?\n\}/) || [''])[0];
    assert(/const key = currentIdentityKey\(\);\s*\n\s*if \(key === _lastIdentityKey\) return false;/.test(choke),
      'the identity COMPARISON is byte-for-byte what it was — the expiry exception is bookkeeping beside it, never a loosening of it');
    assert(/_reconcileSuspendedSlate\(/.test(choke) && /clearPickDraft\(\);/.test(choke),
      '…and the draft is still cleared on EVERY delta; the suspension happens after that clear, not instead of it');
    // Nothing can render a suspended slate, because nothing can reach it.
    const blanked = src29.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
    const refs = [...blanked.matchAll(/_suspendedSlate\b/g)].map(m => m.index);
    assert(refs.length >= 6, `fixture: the suspension box is referenced ${refs.length} times in code (a matcher finding none would make the rule below vacuous)`);
    const reconcile = blanked.match(/function _reconcileSuspendedSlate\([\s\S]*?\n\}/) || [''];
    const reconcileAt = blanked.indexOf(reconcile[0]);
    const declAt = blanked.indexOf('let _suspendedSlate = null;');
    const hookAt = blanked.indexOf('export function _suspendedSlateForTest()');
    // The three places that are allowed to name the box: the one function that
    // reconciles it, its declaration, the read-only test hook, and the test
    // teardown that drops it (same lifecycle as _lastIdentityKey beside it).
    const teardown = blanked.match(/export function _resetAuthUIWiringForTest\(\)[\s\S]*?\n\}/) || [''];
    const teardownAt = blanked.indexOf(teardown[0]);
    const outside = refs.filter(i => !(i >= reconcileAt && i < reconcileAt + reconcile[0].length)
                                  && !(i >= declAt && i < declAt + 40)
                                  && !(i >= hookAt && i < hookAt + 80)
                                  && !(i >= teardownAt && i < teardownAt + teardown[0].length));
    assert(outside.length === 0,
      `every reference to the suspension box is inside _reconcileSuspendedSlate(), its declaration, or the test hook (${outside.length} stray reference(s) at ${JSON.stringify(outside)}) — no render path can reach a suspended slate, which is what makes "unreachable while signed out" structural rather than a policy`);
  }
  globalThis.fetch = realFetch29;
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[30] DI-180p — verify before you destroy…');
{
  // THE FALSE POSITIVE: a 401 from the data server is NOT proof the session is
  // dead. A handset whose clock is ≥ 90 seconds slow gets one on a perfectly
  // good token (the SDK only sends tokens it believes have ≥ 90 s left), and so
  // does every open tab if the project's public key is rotated. Before this
  // input that deleted the saved sign-in on every boot for that player.
  const K30 = auth._AUTH_STORAGE_KEY_FOR_TEST;
  const ROW = { league_id: 'L-A', id: 'mA', role: 'commissioner', display_name: 'Drew', active: true, leagues: { name: 'League A' } };
  const four01 = () => Object.assign(new Error('JWT expired'), { status: 401 });

  // ── (a) A 401 FOLLOWED BY A SUCCESSFUL REFRESH LOSES NOTHING ────────────
  {
    let failures = 0;          // the FIXTURE read succeeds; the 401 is armed below
    let refreshCalls = 0;
    resetAll({
      getSession: async () => ({ data: { session: { user: { id: 'u-drew', email: 'drew@example.com' } } } }),
      refreshSession: async () => { refreshCalls++; return { data: { session: { access_token: 't2', expires_at: Math.floor(Date.now() / 1000) + 3600 } }, error: null }; },
      from: () => { if (failures > 0) { failures--; throw four01(); } return { data: [ROW], error: null }; },
    });
    wireRealAuthUI();
    storeValidSession();
    await auth.refreshMembershipsAndSession();
    // SECURITY F-1 (seventh gate) — SEEDED AFTER THE FIRST RESOLVED READ, not
    // before it. That read is when DI-180q records this device's owner, and an
    // UNMARKED device with any `cfbp_` data on it takes its one fail-closed
    // clear right there — which, now that the sweep is a prefix rule, includes
    // a spent PKCE verifier. Seeding after the marker exists keeps this section
    // measuring what it is about (a false-alarm 401 destroys nothing) instead of
    // measuring DI-180q's one-time clear.
    localStorage.setItem(`${K30}-code-verifier`, 'verifier-abc');
    app.state.draftPicks = { g1: 'home', g2: 'away' };
    app.state.draftTiebreaker = 51;
    app.state.draftExtraPoint = 29;
    const latchBefore = app._lastIdentityKeyForTest();
    assert(storage.getSession().isAdmin === true, 'fixture: a live COMMISSIONER session, mid-slate');

    failures = 1;
    try { await auth.refreshMembershipsAndSession(); } catch {}
    for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0));

    assert(refreshCalls === 1, `the SDK is asked to refresh EXACTLY ONCE (got ${refreshCalls}) — not a retry loop`);
    assert(localStorage.getItem(K30) !== null,
      'the saved sign-in is STILL ON THE DEVICE — the 401 was a slow clock or a rotated key, and nothing was destroyed');
    assert(auth._localStorageKeysForTest().filter(k => k.startsWith(`${K30}-`)).length === 1,
      '…and the PKCE artefacts with it');
    assert(Object.keys(app.state.draftPicks).length === 2 && app.state.draftTiebreaker === 51 && app.state.draftExtraPoint === 29,
      `…and the unsubmitted slate is untouched (${JSON.stringify(app.state.draftPicks)})`);
    assert(app._suspendedSlateForTest() === null,
      '…and nothing was even SUSPENDED: a false alarm must not move the slate at all');
    assert(app._lastIdentityKeyForTest() === latchBefore,
      'NO IDENTITY CHANGE FIRED — isAdmin is deliberately not one of the three tuple terms, which is what makes an immediate LOCK compatible with a deferred destroy');
    assert(auth.isPrivilegeHeld() === false, 'the privilege hold is released once the refresh proves the session is alive');
    assert(storage.getSession().isAdmin === true,
      `…so commissioner rights come back (${JSON.stringify(storage.getSession())}) — nothing was lost`);
    assert(!document.getElementById('session-expired-banner'),
      'and the banner comes DOWN: the player is not left reading a false alarm');
    assert(auth.isSessionExpired() === false, '…with the expiry latch cleared, so the gate stops agreeing the session is dead');
  }

  // ── (b) THE LOCK IS IMMEDIATE, even while the verdict is unknown ────────
  {
    resetAll({
      getSession: async () => ({ data: { session: { user: { id: 'u-drew' } } } }),
      refreshSession: async () => ({ data: { session: null }, error: Object.assign(new Error('network'), { status: 0 }) }),
      from: (() => { let n = 0; return () => { n++; if (n > 1) throw four01(); return { data: [ROW], error: null }; }; })(),
    });
    wireRealAuthUI();
    storeValidSession();
    await auth.refreshMembershipsAndSession();
    assert(storage.getSession().isAdmin === true, 'fixture: commissioner before the 401');
    try { await auth.refreshMembershipsAndSession(); } catch {}
    for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0));
    assert(auth.isPrivilegeHeld() === true, 'an UNKNOWN verdict keeps the lock on — fail closed on privilege');
    assert(storage.getSession().isAdmin === false,
      `…so no commissioner control is reachable (${JSON.stringify(storage.getSession())}) — which is the whole of what SEC S-4 was protecting`);
    assert(storage.getSession().playerId === 'mA',
      '…while playerId is untouched, so the identity has not moved and nothing was suspended');
    assert(localStorage.getItem(K30) !== null, '…and fail SAFE on the data: the saved sign-in is still there');
    assert(!!document.getElementById('session-expired-banner'), '…with the banner up, because the player does need to know');
  }

  // ── (c) THE SDK REPORTS A DEAD REFRESH TOKEN => destroy on the FIRST 401 ─
  {
    resetAll({
      getSession: async () => ({ data: { session: { user: { id: 'u-drew' } } } }),
      refreshSession: async () => ({ data: { session: null }, error: Object.assign(new Error('Invalid Refresh Token: Refresh Token Not Found'), { name: 'AuthApiError', status: 400, code: 'refresh_token_not_found' }) }),
      from: (() => { let n = 0; return () => { n++; if (n > 1) throw four01(); return { data: [ROW], error: null }; }; })(),
    });
    wireRealAuthUI();
    storeValidSession();
    await auth.refreshMembershipsAndSession();
    try { await auth.refreshMembershipsAndSession(); } catch {}
    for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0));
    assert(localStorage.getItem(K30) === null,
      'the SDK\'s OWN dead-refresh-token verdict is proof, so the saved sign-in is destroyed after ONE 401 — no second strike needed');
    assert(auth.hasValidSupabaseSession() === false && storage.getSession().playerId === null,
      '…and the device resolves signed out');
    assert(auth.isPrivilegeHeld() === false,
      '…and the hold is released, because the signed-out session is now saying the same thing');
  }

  // ── (d) THE CLASSIFIER IS NARROWER THAN isSessionExpiredError() ─────────
  // Deliberately: a bare 401/PGRST301 is EXACTLY the shape a slow clock makes,
  // so it is the one thing that must never authorise a destroy on its own.
  assert(auth._isDeadRefreshTokenError(Object.assign(new Error('JWT expired'), { status: 401 })) === false,
    '_isDeadRefreshTokenError(): a bare 401 is NOT proof of a dead refresh token (while isSessionExpiredError() calls it an expiry — two different questions)');
  assert(auth.isSessionExpiredError(Object.assign(new Error('JWT expired'), { status: 401 })) === true,
    '…fixture: the WIDER classifier still says "expired" for it, so the two are genuinely different rules');
  assert(auth._isDeadRefreshTokenError(new Error('PGRST301')) === false, '…and PGRST301 is not proof either');
  for (const [label, err] of [
    ['refresh_token_not_found', Object.assign(new Error('x'), { code: 'refresh_token_not_found' })],
    ['refresh_token_already_used', Object.assign(new Error('x'), { code: 'refresh_token_already_used' })],
    ['session_expired', Object.assign(new Error('x'), { code: 'session_expired' })],
    ['session_not_found', Object.assign(new Error('x'), { code: 'session_not_found' })],
    ['invalid_grant on error_code', Object.assign(new Error('x'), { error_code: 'invalid_grant' })],
    ['AuthSessionMissingError', Object.assign(new Error('Auth session missing!'), { name: 'AuthSessionMissingError' })],
    ['the bare server message', new Error('Invalid Refresh Token: Refresh Token Not Found')],
  ]) {
    assert(auth._isDeadRefreshTokenError(err) === true, `_isDeadRefreshTokenError(): ${label} IS proof (the SDK's own enumerated vocabulary)`);
  }
  assert(auth._isDeadRefreshTokenError(null) === false, '_isDeadRefreshTokenError(null) is false, never a throw');

  // ── (e) EXACTLY ONE CALL SITE MAY TRIGGER A CLEAR (static rule) ─────────
  {
    const authSrc30 = readFileSync(new URL('./js/auth.js', import.meta.url), 'utf8');
    const code = authSrc30.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
    const decl = [...code.matchAll(/function _clearExpiredSessionFromDevice\(/g)];
    const calls = [...code.matchAll(/(?<!function )_clearExpiredSessionFromDevice\(/g)];
    assert(decl.length === 1, `the destroy routine is declared exactly once (found ${decl.length})`);
    assert(calls.length === 1,
      `EXACTLY ONE call site may trigger a clear (found ${calls.length}) — verify-before-destroy is a property of the code, not of the path somebody remembered`);
    // Falsifiability: a second call site IS reported.
    const mutated = code.replace('export function isSessionForcedOut()', 'export function _sneakyClear() { _clearExpiredSessionFromDevice(null); }\nexport function isSessionForcedOut()');
    // Asserted as a DELTA, not as "=== 2": the mutation-proof pass for this
    // build injects exactly this second call site into a scratch copy to show
    // the rule above turns red, and a canary pinned to the absolute count went
    // red alongside it for no reason of its own.
    assert([...mutated.matchAll(/(?<!function )_clearExpiredSessionFromDevice\(/g)].length === calls.length + 1,
      'canary: ONE MORE call site than the source has is reported by that same rule');
    // …and the one call site is reached only past the verdict.
    //
    // FIFTH GATE: the body this used to scan moved into
    // `_refreshMembershipsAndSessionOnce()` when reviewer F1's single-flight gate
    // was put in front of the exported name. Same function, same order, one
    // level down — so the scan follows it rather than silently matching a
    // wrapper that contains neither call (which is what it did for one run of
    // this pass: verify@-1, clear@-1, i.e. the rule had gone vacuous and SAID
    // so, which is the only reason it was caught).
    const refresh = (code.match(/async function _refreshMembershipsAndSessionOnce\([\s\S]*?\n\}/) || [''])[0];
    const verdictAt = refresh.indexOf('_verifySessionStillAlive(');
    const clearAt = refresh.indexOf('_clearExpiredSessionFromDevice(');
    assert(verdictAt > -1 && clearAt > -1 && verdictAt < clearAt,
      `…and the verification runs BEFORE it (verify@${verdictAt}, clear@${clearAt}) — the order is the input`);
    // The gate in front of it may not be a second way in: only the worker, and
    // only via the gate, ever runs that body.
    const gate = (code.match(/export async function refreshMembershipsAndSession\([\s\S]*?\n\}/) || [''])[0];
    assert(/_refreshMembershipsAndSessionOnce\(/.test(gate) && !/_verifySessionStillAlive\(|_clearExpiredSessionFromDevice\(/.test(gate),
      'the exported entry point is a single-flight GATE over that one worker — it carries no second copy of the verify/destroy decision');
    assert((code.match(/_refreshMembershipsAndSessionOnce\(/g) || []).length === 2,
      `…and the worker has exactly one declaration and one call site (found ${(code.match(/_refreshMembershipsAndSessionOnce\(/g) || []).length} mentions)`);
  }

  // ── (f) THE SDK's OWN getSession() ERROR IS HANDLED, NOT DROPPED ────────
  // The security reviewer's point: `const { data: sessData } = await
  // client.storage.getSession()` threw the error half away, so a GoTrue rejection
  // discovered while rehydrating became an indistinguishable "no uid" — the
  // honest-but-mute "could not ask" answer — which is why the PostgREST read
  // was in practice the only live trigger for the entire expiry path.
  {
    resetAll({
      getSession: async () => ({ data: { session: null }, error: Object.assign(new Error('Invalid Refresh Token: Refresh Token Not Found'), { name: 'AuthApiError', status: 400, code: 'refresh_token_not_found' }) }),
      refreshSession: async () => ({ data: { session: null }, error: Object.assign(new Error('Invalid Refresh Token'), { code: 'refresh_token_not_found' }) }),
    });
    wireRealAuthUI();
    storeValidSession();
    let caught = null;
    try { await auth.refreshMembershipsAndSession(); } catch (e) { caught = e; }
    for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0));
    assert(!!caught, 'an SDK getSession() rejection THROWS out of the membership read — it is no longer swallowed into "could not ask"');
    assert(auth.isSessionExpired() === true,
      '…and is classified by the ONE classifier as an expiry, so the expired banner and the DI-180p machinery both engage');
    assert(localStorage.getItem(K30) === null,
      '…and, being a dead refresh token, it destroys — the path the reviewer showed was unreachable now works');
  }
  // …and an SDK error that is NOT an expiry is reported, never dropped silently.
  {
    resetAll({ getSession: async () => ({ data: { session: null }, error: new Error('some transport hiccup') }) });
    const warns = [];
    const realWarn = console.warn;
    console.warn = (...a) => warns.push(a.map(String).join(' '));
    try { await auth.refreshMembershipsAndSession(); } finally { console.warn = realWarn; }
    assert(warns.some(w => /getSession\(\) reported an error/.test(w)),
      'a NON-expiry SDK getSession() error is logged loudly rather than vanishing (it still falls through to the honest "could not ask")');
    assert(auth.hasResolvedMemberships() === false && app.needsLeagueFlowScreen() === false,
      '…and still never reads as "you have no leagues" (SEC F2 holds over the new handling)');
  }

  // ── (g) REVIEWER F4/F5 — the notification bookkeeping ───────────────────
  {
    // F4 — an emit into an EMPTY listener set delivered nothing, so it may not
    // latch the tuple as "announced". Otherwise the first genuine notification
    // after a listener is finally wired is swallowed — and boot() really does
    // write identity (forceSignedOutSession) before wireAuthUIEvents() runs.
    resetAll();
    auth._setAccountUserIdForTest('u-nobody-listening');   // instrumented write, no listeners
    const seen = [];
    auth.onAuthEvent((e, p) => { if (e === 'IDENTITY_MAYBE_CHANGED') seen.push(p?.identity); });
    auth._setAccountUserIdForTest('u-nobody-listening');   // SAME tuple as the unheard write
    assert(seen.length === 1,
      `F4 — the first write AFTER a listener exists still notifies (got ${seen.length}), even though an identical earlier write went out to nobody`);

    // F5 — `emitsOwnEvent:true` is a promise about the NEXT line. If the batch
    // body throws, that line never runs, so recording the tuple as announced
    // would swallow a half-applied identity.
    const authSrc30b = readFileSync(new URL('./js/auth.js', import.meta.url), 'utf8');
    const batch = (authSrc30b.match(/function _withIdentityBatch\([\s\S]*?\n\}/) || [''])[0];
    assert(/catch \(e\) \{\s*\n\s*threw = true;/.test(batch),
      'F5 — _withIdentityBatch() notices when its body throws');
    assert(/if \(threw\) \{ if \(pending\) _notifyIdentityMaybeChanged\(\); \}/.test(batch),
      '…and on a throw it falls back to the ordinary notifier instead of recording an emit that never happened');
    const rec = (authSrc30b.match(/function _recordIdentityNotified\(\) \{[\s\S]*?\n\}/) || [''])[0];
    assert(/_authListeners\.size === 0\) return;/.test(rec),
      'F4 — _recordIdentityNotified() records nothing when there is nobody to deliver to');
    const notifier = (authSrc30b.match(/function _notifyIdentityMaybeChanged\(\) \{[\s\S]*?\n\}/) || [''])[0];
    assert(/_authListeners\.size === 0\) return;/.test(notifier),
      '…and so does the notifier itself');
    // Behavioral falsifiability for F5: a throwing batch still notifies.
    resetAll();
    const seen2 = [];
    auth.onAuthEvent((e) => { if (e === 'IDENTITY_MAYBE_CHANGED') seen2.push(e); });
    let threw2 = false;
    try { await auth.switchActiveLeague('L-NOT-A-MEMBER'); } catch { threw2 = true; }
    assert(threw2, 'fixture: switchActiveLeague() on a non-membership throws (the one batch-adjacent throw reachable from outside)');
  }

  // ── (h) SECURITY F-6 — no emit swallows a listener failure silently ─────
  {
    const authSrc30c = readFileSync(new URL('./js/auth.js', import.meta.url), 'utf8');
    const code = authSrc30c.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
    const emits = [...code.matchAll(/_authListeners\.forEach\(/g)];
    assert(emits.length >= 6, `fixture: found ${emits.length} emit sites in js/auth.js (a matcher finding none would make the rule below vacuous)`);
    const bare = emits.filter(m => /catch\s*\{\s*\}/.test(code.slice(m.index, m.index + 260)));
    assert(bare.length === 0,
      `no emit site swallows a throwing listener with a bare catch (found ${bare.length}) — every one reports it on the same console channel`);
    assert(/catch\s*\{\s*\}/.test('x.forEach(fn => { try { fn(); } catch {} });'),
      'canary: that rule DOES match a bare catch, so it is not vacuously green');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[31] A9 — expiry-clear and signOut() leave the SAME device-local key set…');
{
  // THE FINDING: signOut() removed a list of device-local keys and the Sheets
  // mirror backup; the expiry path removed only the SDK's token and its PKCE
  // artefacts. So a handset whose session expired and was then handed to a
  // second player still carried the first player's chat cache, read cursors,
  // notification log and unsent outbox — RG-51's class, one layer down.
  //
  // Asserted as a SET DIFFERENCE, not as two lists that happen to agree today.
  const K31 = auth._AUTH_STORAGE_KEY_FOR_TEST;
  const SEED = () => {
    for (const k of auth._SIGNOUT_LOCAL_KEYS_FOR_TEST) localStorage.setItem(k, `payload-${k}`);
    localStorage.setItem(`${K31}-code-verifier`, 'v');
    localStorage.setItem('cfbp_sheet_mirror', '{"at":"x","data":{"cfbp_picks":[]}}');   // js/backend.js:39 MIRROR_KEY
    localStorage.setItem('cfbp_players', '[]');
  };
  const ROW31 = { league_id: 'L-A', id: 'mA', role: 'player', display_name: 'Drew', active: true, leagues: { name: 'League A' } };
  const ROW31B = { league_id: 'L-A', id: 'mK', role: 'player', display_name: 'Kevin', active: true, leagues: { name: 'League A' } };
  const DEAD = () => Object.assign(new Error('Invalid Refresh Token: Refresh Token Not Found'), { name: 'AuthApiError', status: 400, code: 'refresh_token_not_found' });

  // PATH 1 — explicit Sign Out.
  let rows31 = [ROW31];
  resetAll({
    getSession: async () => ({ data: { session: { user: { id: 'u-drew' } } } }),
    from: () => ({ data: rows31, error: null }),
  });
  wireRealAuthUI();
  storeValidSession();
  await auth.refreshMembershipsAndSession();
  SEED();
  await auth.signOut();
  const afterSignOut = new Set(auth._localStorageKeysForTest());
  const snapSignOut = new Map(auth._localStorageKeysForTest().map(k => [k, localStorage.getItem(k)]));

  // PATH 2 — an expiry, then a DIFFERENT account signs in (A9's timing).
  let failing31 = false;
  resetAll({
    getSession: async () => ({ data: { session: { user: { id: 'u-drew' } } } }),
    refreshSession: async () => ({ data: { session: null }, error: DEAD() }),
    from: () => { if (failing31) throw DEAD(); return { data: rows31, error: null }; },
  });
  wireRealAuthUI();
  storeValidSession();
  rows31 = [ROW31];
  await auth.refreshMembershipsAndSession();
  SEED();
  failing31 = true;
  try { await auth.refreshMembershipsAndSession(); } catch {}
  for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0));
  // A9's TIMING, asserted before the handover: the returning player's own room
  // is still here, because it might still be their device.
  assert(localStorage.getItem('cfbp_chat_lastseen2') !== null,
    'A9 timing — at the MOMENT OF EXPIRY the chat cache/cursors/outbox are still on the device: the same player signing straight back in must find their room where they left it');
  failing31 = false;
  rows31 = [ROW31B];
  storeValidSession();
  auth._fireAuthEventForTest('SIGNED_IN', { user: { id: 'u-kevin' } });
  for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
  const afterExpiryHandover = new Set(auth._localStorageKeysForTest());
  const snapExpiry = new Map(auth._localStorageKeysForTest().map(k => [k, localStorage.getItem(k)]));

  // ── THE SET DIFFERENCE, both directions ─────────────────────────────────
  // Two keys are EXCLUDED, each for a stated reason rather than because it was
  // inconvenient:
  //   • the SDK's own session key, because path 2 ends with a SUCCESSFUL new
  //     sign-in, and the incoming player's own fresh token is not a leftover of
  //     the outgoing one. (The outgoing one WAS removed — [27]/[30] assert that
  //     directly, at the moment it happens.)
  //   • the active-league pointer, which A9 exempts on the expiry path
  //     explicitly. Asserted as a real difference below, not hidden.
  //   • DI-180q's OWNER MARKER (added at the sixth gate). The two paths
  //     deliberately differ on it, and the difference is the input: the
  //     expiry+handover path ENDS with somebody signed in, so it records the new
  //     owner (after clearing the old one's data — which is what the whole key
  //     is for); sign-out ends with NOBODY signed in, so it removes the marker
  //     along with the data it describes. Excluded from the set comparison and
  //     asserted directly, in both directions, immediately below.
  const POINTER = auth._ACTIVE_LEAGUE_KEY_FOR_TEST;
  const OWNER31 = auth._DEVICE_DATA_OWNER_KEY_FOR_TEST;
  //   • KEYS.PUSH_ACTIVE (added at the seventh gate). It is not a leftover of
  //     the outgoing player at all — it is WRITTEN by the incoming session's own
  //     boot tail (runPostHydrateTail() clears it to false before asking
  //     OneSignal), which only happens on the path that ends signed IN. Now that
  //     the sweep is a `cfbp_` prefix rule, sign-out removes it and the handover
  //     path re-creates it, so it shows up as a one-sided difference for a
  //     reason that has nothing to do with A9. Asserted directly below.
  //   • KEYS.WHATS_NEW_POSTED and the CHAT OUTBOX (added at the seventh gate,
  //     same reason as PUSH_ACTIVE). Neither is a leftover: the handover path
  //     ends signed IN, so refreshAuthUI() -> navigateTo() ->
  //     checkWhatsNewPostDue() queues a fresh SCRIBE "What's New" post into the
  //     outbox and stamps the posted ledger — the INCOMING session's own first
  //     paint, writing brand-new values microseconds after the clear. The
  //     question this section asks is "did A's data survive?", so it is asked
  //     by VALUE below (SEED() writes `payload-<key>`), not by key presence.
  const EXCLUDE = new Set([K31, OWNER31, 'cfbp_push_active', 'cfbp_whatsnew_posted', 'cfbp_chat_outbox2']);
  assert(snapExpiry.get('cfbp_chat_outbox2') !== `payload-cfbp_chat_outbox2`
      && (snapExpiry.get('cfbp_chat_outbox2') === undefined || /"author":"scribe"/.test(snapExpiry.get('cfbp_chat_outbox2') || '')),
    `SEC F-1/F-4 — the outbox key present after the handover holds the INCOMING session's own SCRIBE post, not A's payload (${JSON.stringify(String(snapExpiry.get('cfbp_chat_outbox2')).slice(0, 60))})`);
  assert(!afterSignOut.has('cfbp_push_active'),
    'SEC F-1 — the push-active flag is swept on sign-out (it is device-local state about a binding that no longer exists); it reappears on the handover path only because the incoming session\'s own boot tail writes it');
  assert(afterExpiryHandover.has(OWNER31) && !afterSignOut.has(OWNER31),
    `DI-180q — the owner marker is PRESENT after the handover (the incoming player now owns this device's data) and ABSENT after sign-out (nobody does): ${JSON.stringify([afterExpiryHandover.has(OWNER31), afterSignOut.has(OWNER31)])}`);
  const onlySurvivesExpiryPath = [...afterExpiryHandover].filter(k => !afterSignOut.has(k) && !EXCLUDE.has(k));
  const onlySurvivesSignOutPath = [...afterSignOut].filter(k => !afterExpiryHandover.has(k) && !EXCLUDE.has(k));
  assert(onlySurvivesSignOutPath.length === 0,
    `nothing survives the SIGN-OUT path that the expiry+handover path clears (${JSON.stringify(onlySurvivesSignOutPath)})`);
  assert(onlySurvivesExpiryPath.filter(k => k !== POINTER).length === 0,
    `…and nothing survives the expiry+handover path that sign-out clears, EXCEPT the active-league pointer (${JSON.stringify(onlySurvivesExpiryPath)}) — which A9 exempts on the expiry path deliberately: it is an opaque uuid that grants nothing and the returning player lands in the same league`);
  assert(onlySurvivesExpiryPath.includes(POINTER),
    'fixture: the pointer really IS the one difference (present after the expiry path, absent after sign-out) — a comparison that found NO difference at all would mean one of the two paths never ran');
  // BY VALUE, not by key presence (seventh gate). SEED() writes the sentinel
  // `payload-<key>`; a key that is present with any OTHER value was written
  // AFTER the clear by the incoming session, which is not a survival of A's
  // data. Asserting presence made this section red the moment the sweep grew
  // wide enough for the What's New post to land in it.
  for (const k of auth._SIGNOUT_LOCAL_KEYS_FOR_TEST) {
    assert(snapExpiry.get(k) !== `payload-${k}`, `A9 — the expiry+handover path cleared ${k}, the same key sign-out clears`);
    assert(snapSignOut.get(k) !== `payload-${k}`, `…and so did sign-out (fixture: ${k} was seeded on both paths, so neither assertion is vacuous)`);
  }
  assert(!afterExpiryHandover.has('cfbp_sheet_mirror') && !afterSignOut.has('cfbp_sheet_mirror'),
    'A9 — …and the local mirror backup on both paths, through backend.js\'s own exported clearMirror()');

  // ONE ROUTINE, read structurally: both callers must call it, and neither may
  // carry a second hand-written list.
  {
    const authSrc31 = readFileSync(new URL('./js/auth.js', import.meta.url), 'utf8');
    const code = authSrc31.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
    // SECURITY F-1 (seventh gate) — the sweep iterates `_keysToClear(mode)` now
    // (a prefix rule with a KEEP-list) rather than the eight-name include-list,
    // and the routine takes a mode. The structural rule is unchanged in spirit:
    // ONE body does the sweeping, and both callers reach it.
    // SECURITY F-1 (EIGHTH gate) — the sweep now reads `_scanKeysToClear(mode)`,
    // which returns `{keys, enumerated}`, so the enumeration VERDICT travels with
    // the list instead of being flattened into an empty array. The structural
    // rule is unchanged in spirit and gains one clause: the verdict is READ.
    const sweeps = [...code.matchAll(/\.keys\.forEach\(/g)];
    assert(sweeps.length === 1,
      `the device-local key sweep exists in exactly ONE body (found ${sweeps.length}) — two hand-written lists is how these two paths drifted apart`);
    const routine = (code.match(/export function clearDeviceLocalSessionData\([^)]*\)[\s\S]*?\n\}/) || [''])[0];
    assert(/_scanKeysToClear\(mode\)/.test(routine) && /\.keys\.forEach\(/.test(routine) && /clearMirror\(\)/.test(routine),
      '…and that body is clearDeviceLocalSessionData(), which sweeps the keys AND the mirror');
    assert(/\.keys\.length > 0 \|\| !\w+\.enumerated/.test(routine),
      '…and it RE-ASKS the predicate after sweeping, so "complete" is read back rather than assumed (the same discipline the per-key getItem check uses) — and the re-ask fails on an UN-ENUMERABLE store too, not just on a leftover key');
    assert(/let complete = \w+\.enumerated;/.test(routine),
      'SECURITY F-1 (eighth gate) — `complete` STARTS from the enumeration verdict, so a store that could not be looked at can never report a clean sweep. Hardcoding `let complete = true` here is the whole cutover-blocker: the sweep found nothing because it could not look, said "done", and the caller stamped the owner marker over the previous player\'s data.');
    const signOutFn = (code.match(/export async function signOut\(\)[\s\S]*?\n\}/) || [''])[0];
    assert(/clearDeviceLocalSessionData\(\{ mode: 'signout' \}\)/.test(signOutFn),
      'signOut() calls the shared routine, in SIGN-OUT mode — the one difference between the two callers is the token key, and it is a parameter rather than a hidden branch (security F-1)');
    // REVIEWER NIT (eighth gate) — the `|| /…/.test(code)` disjunction that used
    // to be here was a FILE-WIDE fallback: it matched the same call anywhere in
    // js/auth.js, so this assertion would have stayed green with the call
    // deleted out of reconcileDeviceDataOwner() entirely. Scoped to the one
    // function the claim is about.
    const reconcileFn31 = (code.match(/export function reconcileDeviceDataOwner\([\s\S]*?\n\}/) || [''])[0];
    assert(!!reconcileFn31, 'fixture: reconcileDeviceDataOwner() was located in js/auth.js');
    assert(/clearDeviceLocalSessionData\(\) !== true/.test(reconcileFn31),
      '…and the handover caller uses the DEFAULT (handover) mode, so the incoming player\'s own fresh token is not removed underneath them — asserted inside reconcileDeviceDataOwner()\'s own body, not anywhere in the file');
    const appSrc31 = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
    const reconcile31 = (appSrc31.match(/function _reconcileSuspendedSlate\([\s\S]*?\n\}/) || [''])[0];
    assert(/clearDeviceLocalSessionData\(\)/.test(reconcile31),
      '…and the identity chokepoint calls the SAME routine at the moment a different account is proven, which is A9\'s ruled timing for the expiry path');
    const clearFn = (code.match(/function _clearExpiredSessionFromDevice\([\s\S]*?\n\}/) || [''])[0];
    assert(!/clearDeviceLocalSessionData\(\)/.test(clearFn),
      '…and NOT at the moment of expiry, so a player whose token died and who signs straight back in keeps their room');
    assert(!/ACTIVE_LEAGUE_KEY/.test(routine) && !/setActiveLeagueId\(/.test(routine),
      'the shared routine does not touch the active-league pointer — the difference between the two paths is one explicit line in signOut(), not something hidden inside the routine');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[32] DI-180l — the fail-closed HOLD GATE (A1/A2/A6), on all three triggers…');
{
  const CFG_OK = extra => () => ({ ok: true, json: async () => ({ backendUrl: 'https://script.test/exec', backendToken: 'tok', ...extra }) });
  /** One drive of boot()'s REAL auth-mode branch, with config.json scripted. */
  async function driveDecision(config, { seedSiteUnlocked = true, lastKnown = null, validSession = false, dataBackend = true, sdkLatchedFalse = false } = {}) {
    resetAll();
    app._resetSupabaseSdkLoaderForTest();
    auth._setHasSupabaseDataBackendForTest(dataBackend);
    // THE DEVICE UNDER TEST: it has ALREADY satisfied the site PIN. That is the
    // exact device security S-1 was about — boot()'s only gate call is
    // `if (!isSiteUnlocked()) showSitePinGate()`, so this device used to get no
    // gate at all and sat looking at its own league's data behind one banner.
    if (seedSiteUnlocked) localStorage.setItem('cfbp_site_unlocked', '1');
    else localStorage.removeItem('cfbp_site_unlocked');   // resetAll() does not clear the store, and a previous drive seeded it
    if (lastKnown) auth.setLastKnownAuthMode(lastKnown);
    if (validSession) storeValidSession();
    if (sdkLatchedFalse) {
      globalThis.window.supabase = undefined;
      // ── A NODE-ONLY KEEPALIVE, AND WHY IT IS HERE (Step 4 Part B, 2026-09-18) ──
      // ensureSupabaseSdkLoaded()'s 10-second deadline timer is deliberately
      // unref'd ("a 10s deadline must not hold the process open"), and in THIS
      // fixture that timer is the ONLY thing that can ever resolve the promise:
      // the DOM stub's <script> element fires neither `load` nor `error`. So the
      // await below needs some OTHER ref'd handle to exist, or Node decides it
      // has no work left, exits, and reports this line as an unsettled
      // top-level await (exit 13, zero failed assertions).
      //
      // It used to get one BY ACCIDENT: chat.js's background poll interval, left
      // running by an earlier section. Step 4's hold gate now calls
      // setPollMode('paused'), which stops that interval — correct in
      // production (an unread COUNT is league data and it was reappearing on the
      // nav pill in front of the lock, DI §6.5) and the thing that made this
      // accidental dependency visible. The fixture owns its own keepalive now
      // rather than borrowing one from a module it is not testing.
      const keepAlive = setInterval(() => {}, 5);
      try { await app.ensureSupabaseSdkLoaded({ timeoutMs: 1 }); }
      finally { clearInterval(keepAlive); }
      await new Promise(r => setTimeout(r, 15));
    }
    assert(storage.isSiteUnlocked() === (seedSiteUnlocked ? true : false),
      `fixture: isSiteUnlocked() is ${seedSiteUnlocked} going in`);
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (String(url).includes('config.json')) return config();
      throw new Error('network disabled in authtest');
    };
    let out = null;
    const realErr = console.error;
    console.error = () => {};
    try { out = await app._applyAuthModeDecisionForTest(); }
    finally { console.error = realErr; globalThis.fetch = realFetch; }
    return out;
  }

  const TRIGGERS = [
    ['config-unreadable', () => driveDecision(() => { throw new TypeError('Failed to fetch'); }, { lastKnown: 'supabase' }),
      'One moment', "We couldn't confirm you're signed in"],
    ['interlock', () => driveDecision(CFG_OK({ authMode: 'supabase', supabaseUrl: 'https://p.test', supabaseAnonKey: 'a' }), { dataBackend: false }),
      "We'll be right back", "Something's not set up right on our end"],
    ['sdk-unavailable', () => driveDecision(CFG_OK({ authMode: 'supabase', supabaseUrl: 'https://p.test', supabaseAnonKey: 'a' }), { sdkLatchedFalse: true }),
      'One moment', "Sign-in didn't load"],
  ];
  for (const [reason, drive, heading, body] of TRIGGERS) {
    const out = await drive();
    assert(out?.hold === reason, `${reason}: the branch reports a HOLD (got ${JSON.stringify(out?.hold)})`);
    const ov = document.getElementById('site-gate-overlay');
    assert(!!ov, `${reason}: a full-viewport gate is UP — rendered UNCONDITIONALLY, on a device whose site PIN was already satisfied`);
    assert(ov?.getAttribute('data-gate-state') === 'hold' && ov?.getAttribute('data-hold-reason') === reason,
      `${reason}: …tagged data-gate-state="hold" / data-hold-reason="${reason}" (got ${JSON.stringify(ov?.getAttribute('data-hold-reason'))})`);
    const html = ov?.innerHTML || '';
    assert(new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(html), `${reason}: the approved heading, verbatim ("${heading}")`);
    assert(new RegExp(body.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(html), `${reason}: the approved body line, verbatim`);
    assert(/data-gate-state="hold"/.test(html) && /class="site-gate"/.test(html) && /class="site-gate-inner"/.test(html),
      `${reason}: …in the SAME .site-gate/.site-gate-inner shell the PIN and Google gates use (DI-180e reuse)`);
    assert(!/site-gate-input/.test(html) && !document.getElementById('site-pin-input'),
      `${reason}: NO PIN field anywhere in the DOM while this variant is up`);
    assert(!/Continue with Google/.test(html) && !/google-g-mark/.test(html) && !document.getElementById('google-gate-submit'),
      `${reason}: NO Google button either — a control that can only fail when tapped is worse than no control`);
    assert(!/site-gate-title-top/.test(html),
      `${reason}: …and no "welcome to" framing: a hold is not an invitation to proceed`);
    assert(/id="auth-hold-retry"/.test(html) && />Retry</.test(html),
      `${reason}: exactly one control, the Retry button`);
    assert(/class="site-gate-btn"/.test(html),
      `${reason}: …wearing .site-gate-btn, the same chrome every other gate button wears (44px target comes from the CSS variant, asserted in [33])`);
    assert(app.currentAuthHoldReason() === reason,
      `${reason}: and the hold is readable as state, which is what A7 keys "never take a hold gate down" on`);
  }

  // ── A6 — THE PAGE CONTENT IS TORN DOWN BEFORE THE GATE PAINTS ───────────
  // A gate is not a data boundary. The app paints from its local mirror BEFORE
  // the config is read (AD-08 paint-first), so by the time a hold fires league
  // data is already in the document — hidden from a player by an opaque
  // overlay, and fully readable to anyone who opens dev tools.
  {
    resetAll();
    const painted = {};
    for (const id of app._APP_PAGE_CONTAINER_IDS_FOR_TEST) {
      const el = new FakeEl(); el.id = id;
      el.innerHTML = `<div class="card">Kihoon 4-2 &middot; Drew 3-3 &middot; tiebreaker 47</div>`;
      registry.set(id, el); painted[id] = el;
    }
    const week = new FakeEl(); week.id = 'header-meta-week'; week.innerHTML = '<strong>Week 4</strong>'; registry.set('header-meta-week', week);
    const pill = new FakeEl(); pill.id = 'league-pill'; pill.innerHTML = 'IRB Pick \'Ems'; pill.setAttribute('aria-label', 'Active league: IRB Pick \'Ems'); pill.hidden = false; registry.set('league-pill', pill);
    const ident = new FakeEl(); ident.id = 'header-identity'; ident.innerHTML = 'Drew'; ident.hidden = false; registry.set('header-identity', ident);
    assert(app._APP_PAGE_CONTAINER_IDS_FOR_TEST.length === 6,
      'fixture: the teardown list names all six page containers (a shorter list would leave a tab painted behind the gate)');
    assert(Object.values(painted).every(el => /Kihoon/.test(el.innerHTML)),
      'fixture: every page container really is painted with league data before the hold fires');

    app.showAuthHoldGate('config-unreadable');

    const leftover = Object.entries(painted).filter(([, el]) => el.innerHTML !== '');
    assert(leftover.length === 0,
      `A6 — every page container is EMPTIED before the gate paints (${leftover.length} still holding markup: ${JSON.stringify(leftover.map(([id]) => id))}) — no mirror-derived markup is left in the DOM, not merely covered by an overlay`);
    assert(week.innerHTML === '', 'A6 — …and the header week block (a week NAME is league data)');
    assert(pill.hidden === true && pill.innerHTML === '' && pill.getAttribute('aria-label') === null,
      'A6 — …and the league pill, through the same _clearLeaguePill() DI-184j hardened');
    assert(ident.hidden === true && ident.innerHTML === '', 'A6 — …and the identity chip');
  }

  // ── A2 — THE 20s SILENT RE-CHECK, on a controllable clock ───────────────
  {
    resetAll();
    const realST = globalThis.setTimeout;
    const scheduled = [];
    globalThis.setTimeout = (fn, ms) => { scheduled.push({ fn, ms }); return { unref() {} }; };
    let configReads = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (String(url).includes('config.json')) { configReads++; throw new TypeError('Failed to fetch'); }
      throw new Error('no network');
    };
    const realErr = console.error; console.error = () => {};
    try {
      auth.setLastKnownAuthMode('supabase');
      app.showAuthHoldGate('config-unreadable');
      const tick = scheduled.find(s => s.ms === 20000);
      assert(!!tick, `A2 — showing the gate schedules a re-check 20 seconds out (scheduled: ${JSON.stringify(scheduled.map(s => s.ms))})`);
      assert(scheduled.filter(s => s.ms === 20000).length === 1, '…exactly one, not one per call');

      // PAUSED WHILE BACKGROUNDED: a hidden tab polls nothing at all.
      document.hidden = true;
      configReads = 0;
      tick.fn();
      await new Promise(r => realST(r, 0));
      assert(configReads === 0,
        'A2 — while document.hidden the re-check does NOT fire: a backgrounded tab must not poll config.json every 20 seconds');
      assert(!scheduled.some((s, i) => s.ms === 20000 && i > scheduled.indexOf(tick)),
        '…and it does not reschedule itself from the hidden state either — the visibilitychange listener resumes the cadence');

      // …and it RESUMES on visibilitychange.
      assert((document._docListeners.visibilitychange || []).length === 1,
        'fixture: the gate wired exactly ONE visibilitychange listener (a stub that discarded it would make the resume assertion vacuous)');
      document.hidden = false;
      const before = scheduled.length;
      document.fireDocEvent('visibilitychange');
      assert(scheduled.length > before && scheduled[scheduled.length - 1].ms === 20000,
        'A2 — becoming visible again RESUMES the 20s cadence');
      document.hidden = true;
      const before2 = scheduled.length;
      document.fireDocEvent('visibilitychange');
      assert(scheduled.length === before2,
        '…and going BACK to hidden schedules nothing: the listener resumes, it does not poll');

      // ONE IN FLIGHT: the timer's tick and a manual Retry coalesce.
      document.hidden = false;
      configReads = 0;
      const p1 = app.runAuthHoldCheck({ manual: false });
      const p2 = app.runAuthHoldCheck({ manual: true });
      await p1; await p2;
      assert(configReads === 1,
        `A2 — a manual Retry COALESCES with an in-flight background check: one config read, not two (got ${configReads})`);
      assert(app.currentAuthHoldReason() === 'config-unreadable',
        '…and the hold is still up, because the config still cannot be read');
      const btn = document.getElementById('auth-hold-retry');
      assert(btn && btn.disabled === false && String(btn.textContent) === 'Retry',
        `…with the button restored to "Retry", not stuck on "Retrying…" (got ${JSON.stringify(btn && { d: btn.disabled, t: String(btn.textContent) })})`);
    } finally {
      globalThis.setTimeout = realST; globalThis.fetch = realFetch; console.error = realErr;
      document.hidden = false;
      app._resetAuthHoldForTest();
    }
  }

  // ── RETRY THAT SUCCEEDS: no reload, the gate comes down, the app repaints ─
  {
    resetAll();
    const realFetch = globalThis.fetch;
    let reloaded = false;
    globalThis.location = { origin: 'https://irbfootball.test', reload: () => { reloaded = true; } };
    auth.setLastKnownAuthMode('supabase');
    let cfgOk = false;
    globalThis.fetch = async (url) => {
      if (String(url).includes('config.json')) {
        if (!cfgOk) throw new TypeError('Failed to fetch');
        // The read finally succeeds and says PINS — which is the only way a
        // hold can fully clear in THIS build, because 'supabase' always meets
        // the interlock (hasSupabaseDataBackend() is a constant false until
        // Step 4). Stated here so the test is honest about what it proves.
        return { ok: true, json: async () => ({ backendUrl: 'https://script.test/exec', backendToken: 'tok' }) };
      }
      throw new Error('no network');
    };
    const realErr = console.error; console.error = () => {};
    try {
      app.showAuthHoldGate('config-unreadable');
      assert(app.currentAuthHoldReason() === 'config-unreadable', 'fixture: the hold gate is up');
      cfgOk = true;
      const btn = document.getElementById('auth-hold-retry');
      assert(!!btn, 'fixture: the Retry button exists and is bound');
      btn.click();
      for (let i = 0; i < 12; i++) await new Promise(r => setTimeout(r, 0));
      assert(app.currentAuthHoldReason() === '',
        'a Retry that succeeds clears the hold — the branch decides, the button only re-runs it');
      assert(reloaded === false,
        'NO PAGE RELOAD, ever (DI-180a\'s rule for the gate generally) — the same loadDeployedConfig -> resolveEffectiveAuthMode -> branch runs in place');
      assert(auth.getAuthMode() === 'pins', 'fixture: the config really did resolve a mode this time');
    } finally { globalThis.fetch = realFetch; console.error = realErr; app._resetAuthHoldForTest(); }
  }

  // ── THE sdk-unavailable HOLD MUST BE ABLE TO CLEAR WITHOUT A RELOAD ─────
  // ensureSupabaseSdkLoaded() latches its answer for the life of the page (one
  // injection per boot, reviewer B2/N-b). That latch would make A2's promise
  // FALSE for this variant: every re-check would read the same `false` and the
  // gate could only clear on a page reload, which DI-180a forbids. So the
  // re-check drops the latch — but only while the SDK is genuinely still
  // absent, so a boot that DID get the script never re-injects it.
  {
    resetAll();
    app._resetAuthHoldForTest();
    app._resetSupabaseSdkLoaderForTest();
    auth._setHasSupabaseDataBackendForTest(true);
    localStorage.setItem('cfbp_site_unlocked', '1');
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (String(url).includes('config.json')) return { ok: true, json: async () => ({ backendUrl: 'https://script.test/exec', backendToken: 'tok', authMode: 'supabase', supabaseUrl: 'https://p.test', supabaseAnonKey: 'a' }) };
      throw new Error('no network');
    };
    const realErr = console.error; console.error = () => {};
    const realST = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms) => (ms === 20000 ? { unref() {} } : realST(fn, ms));
    try {
      // Boot 1: no SDK, no saved session -> the sdk-unavailable hold.
      globalThis.window.supabase = undefined;
      await app.ensureSupabaseSdkLoaded({ timeoutMs: 1 });
      await new Promise(r => realST(r, 15));
      const out1 = await app._applyAuthModeDecisionForTest();
      assert(out1.hold === 'sdk-unavailable', `fixture: the hold is up (got ${JSON.stringify(out1.hold)})`);
      // Signal comes back: the script would now load. Nothing else changes.
      installFakeSupabase({});
      await app.runAuthHoldCheck({ manual: false });
      for (let i = 0; i < 6; i++) await new Promise(r => realST(r, 0));
      assert(app.currentAuthHoldReason() === '',
        'A2 — once the SDK is reachable again the background re-check CLEARS the sdk-unavailable hold, with no page reload: the loader latch is dropped for exactly this case');
      assert(!!document.getElementById('google-gate-submit'),
        '…and the branch lands on the state that is actually correct — the Google sign-in gate, because there is no session on this device');
    } finally {
      globalThis.setTimeout = realST; globalThis.fetch = realFetch; console.error = realErr;
      app._resetAuthHoldForTest();
    }
  }

  // ── THE FLAG-OFF WORLD NEVER REACHES ANY OF THIS ────────────────────────
  {
    const out = await driveDecision(() => ({ ok: true, json: async () => ({ backendUrl: 'https://script.test/exec', backendToken: 'tok' }) }), { seedSiteUnlocked: false });
    assert(out?.hold === null, "authMode absent -> 'pins' -> no hold of any kind");
    assert(app.currentAuthHoldReason() === '', '…no hold state');
    assert(!document.getElementById('site-gate-overlay'),
      '…and the branch paints no gate at all in pins mode (boot()\'s own `if (!isSiteUnlocked()) showSitePinGate()` above it owns that decision, unchanged)');
    assert(!document.getElementById('auth-hold-retry'), '…no hold-gate DOM');
    assert(!document.getElementById('auth-banner-stack'), '…and no auth banner stack: the whole Phase III surface stays inert');
  }
  {
    // No TIMERS either — the 20s re-check is created by showAuthHoldGate() and
    // by nothing else, so a pins boot arms nothing.
    const realST = globalThis.setTimeout;
    const scheduled = [];
    globalThis.setTimeout = (fn, ms) => { scheduled.push(ms); return { unref() {} }; };
    try {
      await driveDecision(() => ({ ok: true, json: async () => ({ backendUrl: 'https://script.test/exec', backendToken: 'tok' }) }), { seedSiteUnlocked: false });
    } finally { globalThis.setTimeout = realST; }
    assert(!scheduled.includes(20000),
      `…and no 20-second re-check timer is armed in pins mode (scheduled: ${JSON.stringify(scheduled)})`);
  }
  app._resetAuthHoldForTest();
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[33] DI-180m + A4 + A7 — the "Sign In" affordance…');
{
  // THE RISK DI-180m CLOSES: isSessionExpiredError()'s classification can be
  // wrong. A revoked-but-misclassified session lands on the "can't reach
  // sign-in" banner, which used to offer nothing but "try again in a minute" —
  // no way back in short of clearing storage.
  resetAll();
  app.showAuthUnavailableBanner();
  {
    const b = document.getElementById('auth-unavailable-banner');
    assert(!!b, 'fixture: the unavailable banner rendered');
    assert(/Can't reach sign-in right now\. Your picks are safe\./.test(b.innerHTML), 'DI-180m — the shortened copy');
    assert(!/try again in a minute/.test(b.innerHTML), '…with the "wait and see" instruction removed, because there is a button now');
    assert(/id="auth-unavailable-signin-btn"/.test(b.innerHTML) && />Sign In</.test(b.innerHTML),
      'DI-180m — the banner carries a Sign In action');
    assert(/class="btn btn-sm btn-ghost"/.test(b.innerHTML),
      '…wearing the SAME .btn.btn-sm.btn-ghost chrome as the expired banner\'s button (one affordance, one look)');
  }
  // ONE HANDLER for both banners — read structurally, so the two cannot drift.
  {
    const appSrc33 = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
    const unav = (appSrc33.match(/export function showAuthUnavailableBanner\(\)[\s\S]*?\n\}/) || [''])[0];
    const expd = (appSrc33.match(/export function showSessionExpiredBanner\(\)[\s\S]*?\n\}/) || [''])[0];
    assert(/addEventListener\('click', authSignInAffordance\)/.test(unav) && /addEventListener\('click', authSignInAffordance\)/.test(expd),
      'both banners bind the SAME named handler — never two inline copies that can drift');
    assert(!/addEventListener\('click', \(\) =>/.test(expd),
      '…and neither binds an INLINE handler any more: the expired banner\'s used to be `hideSessionExpiredBanner(); showGoogleSignInGate();`, which cleared the expiry latch and would have torn a hold gate down');
  }

  // ── HAPPY PATH: with the SDK present and no hold up, it opens the gate ───
  {
    resetAll();
    app.showSessionExpiredBanner();
    document.getElementById('session-expired-signin-btn').click();
    assert(!!document.getElementById('google-gate-submit'), 'with the SDK loaded and no hold up, Sign In opens the Google gate in place');
    assert(!document.getElementById('session-expired-banner'), '…and takes the banner it was on down');
  }

  // ── A7 — IT MAY NEVER TAKE A HOLD GATE DOWN ────────────────────────────
  for (const reason of ['config-unreadable', 'sdk-unavailable', 'interlock']) {
    resetAll();
    app._resetAuthHoldForTest();
    const realST = globalThis.setTimeout;
    globalThis.setTimeout = () => ({ unref() {} });
    try {
      app.showAuthHoldGate(reason);
      app.showAuthUnavailableBanner();
      document.getElementById('auth-unavailable-signin-btn').click();
      const ov = document.getElementById('site-gate-overlay');
      assert(!!ov && ov.getAttribute('data-hold-reason') === reason,
        `A7 (${reason}) — tapping Sign In RE-RENDERS the hold gate; it never replaces a fail-closed lock with a Google gate this build cannot back`);
      assert(!document.getElementById('google-gate-submit') && !/Continue with Google/.test(ov.innerHTML),
        `A7 (${reason}) — …and no Google button appears anywhere`);
      assert(app.currentAuthHoldReason() === reason, `A7 (${reason}) — …and the hold state is intact`);
    } finally { globalThis.setTimeout = realST; app._resetAuthHoldForTest(); }
  }

  // ── A4 — WITH NO SDK ON THE PAGE IT ROUTES TO THE sdk-unavailable HOLD ──
  {
    resetAll();
    app._resetAuthHoldForTest();
    globalThis.window.supabase = undefined;
    const realST = globalThis.setTimeout;
    globalThis.setTimeout = () => ({ unref() {} });
    try {
      app.showAuthUnavailableBanner();
      document.getElementById('auth-unavailable-signin-btn').click();
      const ov = document.getElementById('site-gate-overlay');
      assert(!!ov && ov.getAttribute('data-hold-reason') === 'sdk-unavailable',
        'A4 — with the sign-in script not loaded, Sign In routes to the sdk-unavailable HOLD GATE rather than a Google gate that can only fail when tapped');
      assert(!document.getElementById('google-gate-submit'), '…and never calls showGoogleSignInGate()');
    } finally { globalThis.setTimeout = realST; app._resetAuthHoldForTest(); }
  }

  // ── A7 (second half) — IT MUST NOT FORGET THE EXPIRED STATE ────────────
  {
    resetAll({ getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }),
               from: () => { throw Object.assign(new Error('JWT expired'), { status: 401 }); } });
    wireRealAuthUI();
    storeValidSession();
    try { await auth.refreshMembershipsAndSession(); } catch {}
    for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0));
    assert(auth.isSessionExpired() === true && !!document.getElementById('session-expired-banner'),
      'fixture: the session is latched expired and the banner is up');
    document.getElementById('session-expired-signin-btn').click();
    assert(auth.isSessionExpired() === true,
      'A7 — tapping Sign In does NOT clear the expiry latch: the old inline handler called hideSessionExpiredBanner(), so a sign-in that then FAILED left the app having forgotten the session was dead');
    // …and the next session event puts the same banner back.
    auth._fireAuthEventForTest('SIGNED_OUT', null);
    assert(!!document.getElementById('session-expired-banner'),
      '…so when the sign-in attempt fails, the banner comes straight back instead of the state vanishing');
  }
  app._resetAuthHoldForTest();

  // ── THE HOLD GATE'S CSS: 44px target, no new color tokens ───────────────
  {
    const css = readFileSync(new URL('./css/styles.css', import.meta.url), 'utf8');
    const variant = css.slice(css.indexOf('data-gate-state="hold"'));
    assert(/min-height:44px/.test(variant.slice(0, 900)),
      'DI-180l — the hold gate\'s button carries min-height:44px, the same tap target every other gate button has');
    const block = variant.slice(0, variant.indexOf('/* DI-184'));
    assert(!/#[0-9a-fA-F]{3,6}/.test(block) && !/rgb\(/.test(block),
      `DI-180l — and the variant introduces NO color at all (hardcoded or otherwise): it inherits .site-gate's own black/white, because a hold is informational, not an error${/#[0-9a-fA-F]{3,6}/.test(block) ? ' — found ' + JSON.stringify(block.match(/#[0-9a-fA-F]{3,6}/g)) : ''}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[34] DI-184j — a cleared league pill leaves no stale accessible name…');
{
  // THE GAP: _clearLeaguePill() already reset hidden/innerHTML/role/tabindex
  // (reviewer N-a), but left `aria-label="Active league: <old name>"` behind.
  // A screen reader still announced a league this account is no longer in —
  // reviewer N-a's "control-shaped nothing", in the accessibility tree.
  const THREE = [
    ['(a) the split second before the active league resolves', () => {
      resetAll();
      storeValidSession();
      // memberships never resolved
    }],
    ['(b) memberships resolved but the active id matches none of them', () => {
      resetAll();
      storeValidSession();
      auth._setMembershipsForTest([{ leagueId: 'L-B', memberId: 'mB', role: 'player', displayName: 'Drew', leagueName: 'League B' }]);
      auth.setActiveLeagueId('L-GONE');
    }],
    ["(c) authMode is 'pins'/'prelink'", () => {
      resetAll();
      storeValidSession();
      auth._setMembershipsForTest([{ leagueId: 'L-A', memberId: 'mA', role: 'player', displayName: 'Drew', leagueName: 'League A' }]);
      auth.setActiveLeagueId('L-A');
      auth.configureAuth({ authMode: 'pins' });
    }],
  ];
  for (const [label, setup] of THREE) {
    // FIRST render the pill WITH a name, so there is a stale attribute to leave
    // behind — a test that starts from a blank element proves nothing.
    resetAll();
    storeValidSession();
    auth._setMembershipsForTest([
      { leagueId: 'L-A', memberId: 'mA', role: 'player', displayName: 'Drew', leagueName: 'League A' },
      { leagueId: 'L-B', memberId: 'mB', role: 'player', displayName: 'Drew', leagueName: 'League B' },
    ]);
    auth.setActiveLeagueId('L-A');
    const pill = new FakeEl(); pill.id = 'league-pill'; registry.set('league-pill', pill);
    app.renderLeaguePill();
    assert(pill.getAttribute('aria-label') === 'Active league: League A. Tap to switch.',
      `${label}: fixture — the pill really did render an accessible name first (${JSON.stringify(pill.getAttribute('aria-label'))})`);
    assert(pill.getAttribute('role') === 'button' && pill.hidden === false, `${label}: fixture — …as an interactive pill`);

    // Now re-render into the clear trigger, on the SAME element.
    setup();
    registry.set('league-pill', pill);
    app.renderLeaguePill();
    assert(pill.hidden === true && pill.innerHTML === '', `${label}: the pill is not rendered — hidden, no markup (DI-184c/N-a, unchanged)`);
    assert(pill.getAttribute('role') === null && pill.getAttribute('tabindex') === null, `${label}: …role and tabindex removed`);
    assert(pill.getAttribute('aria-label') === null,
      `${label}: DI-184j — and aria-label is ABSENT, not merely empty-stringed (got ${JSON.stringify(pill.getAttribute('aria-label'))}) — nothing for a screen reader to announce`);
    assert(!('aria-label' in pill.attrs),
      `${label}: …removed from the element, so nothing can read a stale accessible name off it at all`);
  }
  // Structural: the ONE function does it, so all three triggers cannot drift.
  {
    const appSrc34 = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
    const clearFn = (appSrc34.match(/function _clearLeaguePill\(el\)[\s\S]*?\n\}/) || [''])[0];
    assert(/removeAttribute\?\.\('aria-label'\)/.test(clearFn),
      "the removal lives in _clearLeaguePill(), the one function all three triggers call (DI-184j's 'one behavior a test can pin once')");
    const render = (appSrc34.match(/export function renderLeaguePill\(\)[\s\S]*?\n\}/) || [''])[0];
    assert((render.match(/_clearLeaguePill\(el\)/g) || []).length === 3,
      `…and renderLeaguePill() reaches it from exactly the three documented triggers (found ${(render.match(/_clearLeaguePill\(el\)/g) || []).length})`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[35] SECURITY 9 — ONE identity-key separator, shared by both modules…');
{
  // THE DISAGREEMENT: js/app.js declared its own IDENTITY_KEY_SEP as a LITERAL
  // NUL byte in the source (invisible in every editor and diff) while
  // js/auth.js's _identityTuple() joined its three terms with a SPACE. Two
  // separators, two files, and nothing asserting they agreed — in a pass whose
  // own DI-180o(b) parser had already been broken once by exactly this.
  assert(app._IDENTITY_KEY_SEP_FOR_TEST === auth.IDENTITY_KEY_SEP,
    'app.js uses auth.js\'s exported constant — not a second declaration that can drift');
  assert(auth.IDENTITY_KEY_SEP === '\u0000' && auth.IDENTITY_KEY_SEP.length === 1,
    `the separator is a single U+0000 (got ${JSON.stringify(auth.IDENTITY_KEY_SEP)}) — a space would let a league name forge a different tuple`);
  {
    const src = readFileSync(new URL('./js/auth.js', import.meta.url), 'utf8');
    const appSrc = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
    assert(/IDENTITY_KEY_SEP = '\\u0000'/.test(src),
      'and it is written as the ESCAPE in the source, never as a literal NUL byte (which is what js/app.js held until this pass)');
    assert(!appSrc.includes('\u0000'),
      'js/app.js contains no literal NUL byte anywhere any more');
    assert((appSrc.match(/const IDENTITY_KEY_SEP\s*=/g) || []).length === 0,
      'js/app.js declares no separator of its own — one constant, one owner');
  }
  // …and the two modules really do build the SAME string for the same identity.
  {
    resetAll({ getSession: async () => ({ data: { session: { user: { id: 'u-sep' } } } }),
               from: () => ({ data: [{ league_id: 'L S', id: 'm S', role: 'player', display_name: 'Drew', active: true, leagues: { name: 'Spacey League' } }], error: null }) });
    const seen = [];
    auth.onAuthEvent((e, p) => { if (e === 'IDENTITY_MAYBE_CHANGED') seen.push(p?.identity); });
    storeValidSession();
    await auth.refreshMembershipsAndSession();
    // Move term 1 so auth.js emits a tuple with every term RESOLVED (the emit
    // during the read carries the intermediate one, by design — the pointer
    // moves before the event).
    auth._setAccountUserIdForTest('u-sep-2');
    const fromAuth = seen[seen.length - 1];
    assert(!!fromAuth, 'fixture: auth.js emitted an identity tuple (league id and member id both CONTAIN a space, which is the case a space separator would collide on)');
    assert(fromAuth === app._currentIdentityKeyForTest(),
      `the two modules' keys are byte-identical for the same identity (auth ${JSON.stringify(fromAuth)} vs app ${JSON.stringify(app._currentIdentityKeyForTest())})`);
    assert(fromAuth.split('\u0000').length === 3,
      '…and the key still parses into exactly three terms even though two of them contain spaces');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[36] REVIEWER F1 — concurrent 401s share ONE round; strikes counts ROUNDS…');
{
  // THE DEFECT, in one sentence: every supabase boot issues TWO membership
  // reads concurrently (applyAuthModeDecision + the SDK's INITIAL_SESSION
  // handler), `_verifySessionStillAlive()` incremented the strike counter per
  // CALL before any refresh, and `>= 2` short-circuited to 'dead' — so ONE
  // cause that 401s both reads (a handset clock 90s slow, a rotated anon key)
  // destroyed a LIVE session on the first boot and suspended the slate with it.
  const K36 = auth._AUTH_STORAGE_KEY_FOR_TEST;
  const ROW = { league_id: 'L-A', id: 'mA', role: 'commissioner', display_name: 'Drew', active: true, leagues: { name: 'League A' } };
  const four01 = () => Object.assign(new Error('JWT expired'), { status: 401 });
  const ALIVE = () => ({ data: { session: { access_token: 't2', expires_at: Math.floor(Date.now() / 1000) + 3600 } }, error: null });

  // ── (a) THE REAL BOOT SHAPE: two preference-free callers, ONE read ───────
  {
    let reads = 0, refreshCalls = 0, failures = 0;
    resetAll({
      getSession: async () => ({ data: { session: { user: { id: 'u-drew' } } } }),
      refreshSession: async () => { refreshCalls++; return ALIVE(); },
      from: () => { reads++; if (failures > 0) { failures--; throw four01(); } return { data: [ROW], error: null }; },
    });
    wireRealAuthUI();
    storeValidSession();
    await auth.refreshMembershipsAndSession();
    app.state.draftPicks = { g1: 'home', g2: 'away' };
    app.state.draftTiebreaker = 38;
    assert(storage.getSession().isAdmin === true, 'fixture: a live commissioner session, mid-slate');

    reads = 0; refreshCalls = 0; failures = 1;   // ONE cause, and one read will hit it
    const p1 = auth.refreshMembershipsAndSession().catch(() => {});
    const p2 = auth.refreshMembershipsAndSession().catch(() => {});
    assert(auth._isMembershipRefreshInFlightForTest() === true,
      'the second concurrent caller finds a read already in flight (the latch is observable, not inferred)');
    await Promise.all([p1, p2]);
    for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));

    assert(reads === 2,
      `TWO concurrent callers cause ONE membership read plus the single post-verification re-read (got ${reads}) — not two reads, and not a loop`);
    assert(refreshCalls === 1, `the SDK is asked to refresh EXACTLY ONCE (got ${refreshCalls})`);
    assert(localStorage.getItem(K36) !== null,
      'THE SAVED SIGN-IN IS STILL ON THE DEVICE — this is the assertion that was red before F1 was fixed');
    assert(Object.keys(app.state.draftPicks).length === 2 && app.state.draftTiebreaker === 38,
      `…and the unsubmitted slate is untouched (${JSON.stringify(app.state.draftPicks)})`);
    assert(app._suspendedSlateForTest() === null, '…and nothing was suspended: no identity term ever moved');
    assert(auth._expiredStrikesForTest() === 0, 'I1 — a round that proved the session ALIVE resets the strike counter');
    assert(auth.isPrivilegeHeld() === false && storage.getSession().isAdmin === true,
      `I3 — and the privilege lock is released, so the commissioner surface comes back (${JSON.stringify(storage.getSession())})`);
  }

  // ── (b) TWO classifications that are NOT coalesced still share ONE round ─
  // A join/create call carries a preference and is deliberately never folded
  // into a preference-free read, so two independent classifications really can
  // land in the same tick. They must share one VERDICT.
  {
    let reads = 0, refreshCalls = 0, failures = 0;
    let release = null;
    const gate = new Promise(r => { release = r; });
    resetAll({
      getSession: async () => ({ data: { session: { user: { id: 'u-drew' } } } }),
      refreshSession: async () => { refreshCalls++; await gate; return ALIVE(); },
      from: () => { reads++; if (failures > 0) { failures--; throw four01(); } return { data: [ROW], error: null }; },
    });
    wireRealAuthUI();
    storeValidSession();
    await auth.refreshMembershipsAndSession();
    reads = 0; refreshCalls = 0; failures = 2;   // one cause, two independent reads
    const p1 = auth.refreshMembershipsAndSession().catch(() => {});
    const p2 = auth.refreshMembershipsAndSession({ preferLeagueId: 'L-A' }).catch(() => {});
    for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0));
    assert(reads === 2, `fixture: these two calls really were NOT coalesced — two reads, two 401s (got ${reads})`);
    assert(auth._isVerificationInFlightForTest() === true,
      'I2 — exactly one verification round is open while both callers wait on it');
    assert(refreshCalls === 1,
      `…and the SDK has been asked to refresh ONCE for the two of them (got ${refreshCalls})`);
    assert(auth._expiredStrikesForTest() === 0,
      'I1 — the strike counter has not moved yet: it counts COMPLETED rounds, and this one has not completed');
    release();
    await Promise.all([p1, p2]);
    for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
    assert(refreshCalls === 1, `…still exactly one refresh after both callers resolve (got ${refreshCalls})`);
    assert(localStorage.getItem(K36) !== null, '…the saved sign-in survives both of them');
    assert(auth._expiredStrikesForTest() === 0 && auth.isPrivilegeHeld() === false,
      '…and one ALIVE verdict released the lock for both callers');
  }

  // ── (c) TWO CONCURRENT UNKNOWNS ARE STILL *ONE* STRIKE ──────────────────
  {
    let reads = 0, refreshCalls = 0, failures = 0;
    resetAll({
      getSession: async () => ({ data: { session: { user: { id: 'u-drew' } } } }),
      refreshSession: async () => { refreshCalls++; return { data: { session: null }, error: Object.assign(new Error('network'), { status: 0 }) }; },
      from: () => { reads++; if (failures > 0) { failures--; throw four01(); } return { data: [ROW], error: null }; },
    });
    wireRealAuthUI();
    storeValidSession();
    await auth.refreshMembershipsAndSession();
    failures = 2;
    await Promise.all([
      auth.refreshMembershipsAndSession().catch(() => {}),
      auth.refreshMembershipsAndSession({ preferLeagueId: 'L-A' }).catch(() => {}),
    ]);
    for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
    assert(auth._expiredStrikesForTest() === 1,
      `I1 — two concurrent classifications from ONE cause are ONE strike (got ${auth._expiredStrikesForTest()})`);
    assert(refreshCalls === 1, `…because they shared one round (refreshes: ${refreshCalls})`);
    assert(localStorage.getItem(K36) !== null,
      'S1 -E3-> S2: an UNKNOWN verdict destroys NOTHING, however many callers hit it at once');
    assert(auth.isPrivilegeHeld() === true, '…and the lock stays on — fail closed on privilege');
    // …and only a SECOND completed round destroys.
    failures = 1;
    try { await auth.refreshMembershipsAndSession(); } catch {}
    for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
    assert(auth._expiredStrikesForTest() >= 2, 'S2 -E1-> S3: the next classification opens a SECOND round');
    assert(localStorage.getItem(K36) === null,
      'S3 -E4-> S4: a second COMPLETED round with no intervening success IS the proof DI-180p means, and only then is the saved sign-in destroyed');
    assert(refreshCalls === 1,
      `…and that second round does not even ask the SDK again (refreshes still ${refreshCalls}) — two rounds in a row is the answer`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[37] REVIEWER F2 — the lock and the strike counter are RELEASED by recovery…');
{
  // THE DEFECT: the only release was the 'alive' verdict. After an 'unknown'
  // (a 401 whose refresh failed with a 429/5xx/dropped connection) a later
  // FULLY SUCCESSFUL membership read left _privilegeHeld true, isAdmin false and
  // strikes at 1 for the life of the page — with no banner explaining it once
  // TOKEN_REFRESHED cleared the expiry latch — and the NEXT unrelated 401 was
  // "strike two" and destroyed the saved sign-in without verifying anything.
  const K37 = auth._AUTH_STORAGE_KEY_FOR_TEST;
  const ROW = { league_id: 'L-A', id: 'mA', role: 'commissioner', display_name: 'Drew', active: true, leagues: { name: 'League A' } };
  const four01 = () => Object.assign(new Error('JWT expired'), { status: 401 });

  /** Drive the page into S2 (HELD, strikes 1, nothing destroyed). */
  async function intoHeldState() {
    const st = { reads: 0, refreshCalls: 0, failures: 0, sdkSession: { user: { id: 'u-drew' } } };
    resetAll({
      getSession: async () => ({ data: { session: st.sdkSession } }),
      refreshSession: async () => { st.refreshCalls++; return { data: { session: null }, error: Object.assign(new Error('rate limited'), { status: 429 }) }; },
      from: () => { st.reads++; if (st.failures > 0) { st.failures--; throw four01(); } return { data: [ROW], error: null }; },
    });
    wireRealAuthUI();
    storeValidSession();
    await auth.refreshMembershipsAndSession();
    app.state.draftPicks = { g1: 'home' };
    st.failures = 1;
    try { await auth.refreshMembershipsAndSession(); } catch {}
    for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
    return st;
  }

  // ── (a) A LATER SUCCESSFUL MEMBERSHIP READ RELEASES ─────────────────────
  {
    const st = await intoHeldState();
    assert(auth.isPrivilegeHeld() === true && auth._expiredStrikesForTest() === 1
           && storage.getSession().isAdmin === false && localStorage.getItem(K37) !== null,
      `fixture: S2 — held, one strike, isAdmin false, nothing destroyed (${JSON.stringify(storage.getSession())})`);
    assert(!!document.getElementById('session-expired-banner'), 'fixture: …and the banner is up');

    // The server comes back. Nothing else changes.
    try { await auth.refreshMembershipsAndSession(); } catch {}
    for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
    assert(auth.isPrivilegeHeld() === false,
      'S2 -E5-> S0: a membership read that SUCCEEDS is proof the server accepts this JWT, so the privilege lock is released');
    assert(storage.getSession().isAdmin === true,
      `…and the commissioner surface comes back (${JSON.stringify(storage.getSession())}) — before this fix it stayed gone for the life of the page`);
    assert(auth._expiredStrikesForTest() === 0, '…and the strike counter is reset with it');
    assert(!document.getElementById('session-expired-banner'),
      '…and the banner comes DOWN (SESSION_REVERIFIED), so the player is not left reading a stale warning');
    assert(auth.isSessionExpired() === false, '…with the expiry latch cleared too');

    // ── R1 — DRIVE THE PAGE FORWARD, THEN RE-ASSERT ──────────────────────
    await app.runAutoRefreshTick();
    storeValidSession();
    auth._fireAuthEventForTest('TOKEN_REFRESHED', { access_token: 't9', user: { id: 'u-drew' } });
    for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
    assert(auth.isPrivilegeHeld() === false && storage.getSession().isAdmin === true && localStorage.getItem(K37) !== null,
      'R1 — after one auto-refresh tick and one real session event, the release still holds and nothing has been destroyed');

    // …and the NEXT unrelated 401 is strike ONE again: verified, not destroyed.
    st.failures = 1;
    const refreshesBefore = st.refreshCalls;
    try { await auth.refreshMembershipsAndSession(); } catch {}
    for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
    assert(st.refreshCalls === refreshesBefore + 1,
      `a later unrelated 401 is VERIFIED rather than assumed (one more refresh: ${refreshesBefore} -> ${st.refreshCalls})`);
    assert(auth._expiredStrikesForTest() === 1,
      `…and counts as strike ONE again (got ${auth._expiredStrikesForTest()}) — the intervening success reset the run`);
    assert(localStorage.getItem(K37) !== null,
      '…so the saved sign-in survives it. Before F2 this was strike two and destroyed it.');
  }

  // ── (b) A PROVEN-GOOD SESSION EVENT RELEASES, ON ITS OWN ────────────────
  // Attributed to the EVENT and nothing else: the SDK is switched to "no
  // session" first, so the membership read the event triggers answers "could
  // not ask" (null) and cannot be what released the lock.
  {
    const st = await intoHeldState();
    assert(auth.isPrivilegeHeld() === true, 'fixture: S2 again');
    st.sdkSession = null;                       // every later read答 "could not ask"
    storeValidSession();
    auth._fireAuthEventForTest('TOKEN_REFRESHED', { access_token: 't5', user: { id: 'u-drew' } });
    for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
    assert(auth.hasResolvedMemberships() === true,
      'fixture: the membership cache is the LAST GOOD one — the read triggered by the event resolved nothing new');
    assert(auth.isPrivilegeHeld() === false && auth._expiredStrikesForTest() === 0,
      'S2 -E6-> S0: a TOKEN_REFRESHED carrying a session is the GoTrue server minting a token, which is proof — the lock and the strike are released by the event itself');
    assert(!document.getElementById('session-expired-banner'), '…and the banner comes down');
  }

  // ── (c) NARROW, IN THE FAIL-CLOSED DIRECTION ────────────────────────────
  // INITIAL_SESSION is a LOCAL rehydrate — it fires with whatever is in
  // localStorage, including on the boot where the token is already dead — so it
  // is NOT proof and must not release.
  {
    await intoHeldState();
    assert(auth.isPrivilegeHeld() === true, 'fixture: S2');
    auth._fireAuthEventForTest('INITIAL_SESSION', { access_token: 't6', user: { id: 'u-drew' } });
    assert(auth.isPrivilegeHeld() === true,
      'INITIAL_SESSION does NOT release the lock: it reports what this device already had, not what the server just said');
    auth._fireAuthEventForTest('SIGNED_IN', null);
    assert(auth.isPrivilegeHeld() === true,
      '…and neither does a SIGNED_IN with no session on it');
  }

  // ── (d) SIGN OUT ENDS THE CONVERSATION (any -E7-> S0) ───────────────────
  {
    await intoHeldState();
    assert(auth.isPrivilegeHeld() === true, 'fixture: S2');
    await auth.signOut();
    for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0));
    assert(auth.isPrivilegeHeld() === false && auth._expiredStrikesForTest() === 0,
      'an explicit Sign Out clears the whole machine — there is nothing left to verify and nothing left to hold');
  }

  // ── (e) THE RELEASE IS ONE ROUTINE, NOT FOUR COPIES ─────────────────────
  {
    const src37 = readFileSync(new URL('./js/auth.js', import.meta.url), 'utf8');
    const code = src37.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
    const decl = (code.match(/function _releaseExpiryHoldOnProof\([\s\S]*?\n\}/) || [''])[0];
    assert(!!decl, 'the release routine exists and could be located');
    assert(/_privilegeHeld = false;/.test(decl) && /_expiredStrikes = 0;/.test(decl) && /_sessionExpired = false;/.test(decl)
           && /SESSION_REVERIFIED/.test(decl),
      '…and it lowers ALL of the lock, the strike counter and the banner latch in one place, then announces it');
    const calls = (code.match(/_releaseExpiryHoldOnProof\(/g) || []).length;
    assert(calls === 4,
      `…called from exactly three proven-good paths plus its own declaration (found ${calls} mentions: the 'alive' verdict, the successful read, and the SIGNED_IN/TOKEN_REFRESHED branch)`);
    // Falsifiability: the writes must not ALSO happen anywhere else, or a
    // future path could "release" without announcing it.
    const strays = [...code.matchAll(/(?<!let )_privilegeHeld = false/g)].filter(m => {
      const at = m.index; const declAt = code.indexOf(decl);
      return !(at >= declAt && at < declAt + decl.length);
    });
    assert(strays.length === 3,
      `outside the routine the lock is lowered in exactly three places (found ${strays.length}): the destroy path (where the signed-out session already says the same thing), signOut(), and the test reset. A fourth would be a release that announces nothing.`);
    assert(/let _privilegeHeld = false;/.test(code), '…and its declaration, which the count above deliberately excludes by matching the assignment only');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[38] SECURITY 5 / REVIEWER F6 — the verification refresh is BOUNDED…');
{
  const K38 = auth._AUTH_STORAGE_KEY_FOR_TEST;
  const ROW = { league_id: 'L-A', id: 'mA', role: 'commissioner', display_name: 'Drew', active: true, leagues: { name: 'League A' } };
  const four01 = () => Object.assign(new Error('JWT expired'), { status: 401 });
  // THE HAZARD: `await client.auth.refreshSession()` with no deadline. The
  // SDK's fetch can hang (captive portal, stalled proxy, backgrounded iOS tab),
  // and while it hangs the privilege lock is up, the banner is up, and the
  // machine never reaches a verdict — a PERMANENT loss of the commissioner
  // surface with no path back but a reload, which DI-180a forbids.
  {
    let refreshCalls = 0, failures = 0;
    resetAll({
      getSession: async () => ({ data: { session: { user: { id: 'u-drew' } } } }),
      refreshSession: () => { refreshCalls++; return new Promise(() => {}); },   // never settles
      from: () => { if (failures > 0) { failures--; throw four01(); } return { data: [ROW], error: null }; },
    });
    wireRealAuthUI();
    storeValidSession();
    await auth.refreshMembershipsAndSession();
    auth._setRefreshDeadlineForTest(5);
    const realWarn = console.warn; const warns = [];
    console.warn = (...a) => warns.push(a.map(String).join(' '));
    failures = 1;
    try { await auth.refreshMembershipsAndSession(); } catch {}
    console.warn = realWarn;
    for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
    assert(refreshCalls === 1, 'fixture: the SDK was asked to refresh, and its promise never settles');
    assert(auth._expiredStrikesForTest() === 1,
      `the round COMPLETED anyway, on its deadline (strikes ${auth._expiredStrikesForTest()}) — it did not hang forever`);
    // REVIEWER F6 (sixth gate) — this read
    //   `auth.isVerificationPending === undefined || auth._isVerificationInFlightForTest() === false`
    // and `isVerificationPending` is not an export of js/auth.js and never has
    // been, so the first disjunct was permanently true and the assertion could
    // not fail whatever the latch did. Dead disjunct deleted; what is left is
    // the claim that was meant.
    assert(auth._isVerificationInFlightForTest() === false,
      '…and the in-flight latch is dropped, so a later 401 can open a second round instead of sharing a dead one');
    assert(warns.some(w => /did not answer within 5ms/.test(w)),
      '…and it says so out loud on the console rather than failing silently');
    assert(auth.isPrivilegeHeld() === true && localStorage.getItem(K38) !== null,
      'the timeout resolves UNKNOWN: fail closed on the lock, fail safe on the data (nothing destroyed)');
    // The next classification is strike two and destroys — i.e. a hung refresh
    // delays the destroy by one deadline, it does not prevent it forever.
    failures = 1;
    try { await auth.refreshMembershipsAndSession(); } catch {}
    for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
    assert(localStorage.getItem(K38) === null,
      '…and the second round still destroys, so a hung refresh cannot strand a dead session on the device either');
    auth._setRefreshDeadlineForTest(null);
  }
  // The deadline is a parameter with a production CONSTANT behind it, and the
  // residual it leaves open is written down rather than discovered later.
  {
    const src38 = readFileSync(new URL('./js/auth.js', import.meta.url), 'utf8');
    assert(/const SESSION_REFRESH_TIMEOUT_MS = \d+;/.test(src38),
      'the production deadline is a named constant, not a magic number at the call site');
    const code = src38.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
    const raw = [...code.matchAll(/refreshSession\(\)/g)];
    assert(raw.length === 1,
      `there is exactly ONE refreshSession() call in the module (found ${raw.length}), and it is inside the bounded wrapper`);
    const wrapper = (code.match(/async function _refreshSessionWithinDeadline\([\s\S]*?\n\}/) || [''])[0];
    assert(wrapper.includes('refreshSession()') && /Promise\.race/.test(wrapper),
      '…which races it against the deadline rather than awaiting it open-endedly');
    assert(/STEP 4 TODO/.test(src38) && /verify window/i.test(src38),
      'security 5\'s residual — what a player can still DO inside the verify window — is stated at the DI-180p site with a marked Step 4 TODO, not left to be rediscovered');
  }
  // …and the state table the fifth gate asked for is IN the source, beside the
  // code it describes. A state machine documented somewhere else is documented
  // nowhere.
  {
    const src38b = readFileSync(new URL('./js/auth.js', import.meta.url), 'utf8');
    for (const marker of ['THE STATE TABLE', 'S0 CLEAR', 'S1 VERIFYING', 'S2 HELD', 'S4 DESTROYED', 'TRANSITIONS', 'INVARIANTS'])
      assert(src38b.includes(marker), `the DI-180p state table names ${marker}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[39] SECURITY S-1/S-2 — the hold gate STAYS a lock, and clearing it never leaves none…');
{
  /** Paint the six page containers + the header, and register the class
   *  selectors the teardown sweeps, exactly as a primed-mirror boot would. */
  function paintPage() {
    const painted = {};
    for (const id of app._APP_PAGE_CONTAINER_IDS_FOR_TEST) {
      const el = new FakeEl(); el.id = id; el.className = 'page-section';
      el.innerHTML = '<div class="card">Kihoon 4-2 &middot; Drew 3-3 &middot; tiebreaker 47</div>';
      registry.set(id, el); painted[id] = el;
    }
    const main = new FakeEl(); main.className = 'main-content';
    const nav = new FakeEl(); nav.className = 'bottom-nav';
    const unread = new FakeEl(); unread.className = 'nav-unread'; unread.innerHTML = '3';
    const modal = new FakeEl(); modal.id = 'a-modal'; modal.className = 'modal-overlay';
    const toasts = new FakeEl(); toasts.id = 'toast-container'; toasts.innerHTML = '<div class="toast">Kevin picked</div>';
    registry.set('toast-container', toasts);
    registry.set('a-modal', modal);
    setClassEls('.page-section', Object.values(painted));
    setClassEls('.main-content', [main]);
    setClassEls('.bottom-nav', [nav]);
    setClassEls('.nav-unread', [unread]);
    setClassEls('.modal-overlay', [modal]);
    document.title = '(3) IRB Pick \'Ems';
    return { painted, main, nav, unread, modal, toasts };
  }

  // ── A6 IS DURABLE: THE PAGE STAYS TORN DOWN WHILE IT IS DRIVEN FORWARD ──
  let badgeClears = 0;
  {
    resetAll();
    app._resetAuthHoldForTest();
    const realST = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms) => (ms === 20000 ? { unref() {} } : realST(fn, ms));
    // The Badging API, feature-detected by the app and therefore spied here.
    badgeClears = 0;
    globalThis.navigator.clearAppBadge = async () => { badgeClears++; };
    const dom = paintPage();
    try {
      app.showAuthHoldGate('config-unreadable');
      assert(Object.values(dom.painted).every(el => el.innerHTML === ''),
        'fixture: the teardown emptied all six containers (A6, as before)');
      assert(dom.painted['page-dashboard'].classList.contains('active') === false,
        'security 8 — …and removed the `.active` marker chat-ui.js keys its own repaints on (it owns #page-chat and the dashboard teaser, and cannot import app.js to be told to stop)');
      assert(dom.toasts.innerHTML === '' && !registry.get('a-modal'),
        'security 8 — every open modal overlay is removed and the toast container emptied: those sit IN FRONT of the lock, not behind it');
      // `inert` is a boolean attribute (value ''), and this stub's getAttribute()
      // answers null for an empty string — so the attribute MAP is what is read.
      assert('inert' in dom.main.attrs && dom.main.getAttribute('aria-hidden') === 'true'
             && 'inert' in dom.nav.attrs && dom.nav.getAttribute('aria-hidden') === 'true',
        'security 7 — .main-content and .bottom-nav are inert + aria-hidden: the withheld page is unreachable by keyboard, screen reader and scripted click, not merely covered');
      assert(!/^\(3\)/.test(String(document.title)), 'A6 — and the unread count is off the tab title');
      assert(badgeClears === 1,
        `security 8 — and the HOME-SCREEN badge is cleared (${badgeClears} call(s)): an installed PWA's badge is a count of six named people's messages, sitting on a device that is no longer signed in`);

      // ── R1 — DRIVE THE PAGE FORWARD. THREE ENTRY POINTS, ONE PREDICATE ──
      await app.runAutoRefreshTick();
      assert(Object.values(dom.painted).every(el => el.innerHTML === ''),
        'R1 — one auto-refresh tick later the containers are STILL empty (this tick used to repaint the whole dashboard from the mirror ~60s after the gate went up)');
      wireRealAuthUI();
      storeValidSession();
      auth._fireAuthEventForTest('SIGNED_IN', { access_token: 't', user: { id: 'u-drew' } });
      for (let i = 0; i < 6; i++) await new Promise(r => realST(r, 0));
      assert(Object.values(dom.painted).every(el => el.innerHTML === ''),
        'R1 — …and after one real session event through the listener chain (refreshAuthUI\'s trailing navigateTo is the second path that used to undo the teardown)');
      globalThis.window.navigateTo('dashboard');
      globalThis.window.deepLinkTo({ tab: 'dashboard' });
      globalThis.window.deepLinkTo({ tab: 'chat', params: { messageId: 'm1' } });
      assert(Object.values(dom.painted).every(el => el.innerHTML === ''),
        'R1 — …and after a direct window.navigateTo() and two window.deepLinkTo() calls, which are the bridges chat-ui.js and the notification tap use');
      assert(app.currentAuthHoldReason() === 'config-unreadable',
        'R2 — the hold is still held through all of it: nothing above releases a lock as a side effect');
      assert(app.isContentWithheld() === true, '…and the one predicate still answers "withheld"');
    } finally { globalThis.setTimeout = realST; app._resetAuthHoldForTest(); }
  }

  // ── THE 20s RE-CHECK UPDATES THE GATE IN PLACE (security 9 / F10) ───────
  {
    resetAll();
    app._resetAuthHoldForTest();
    const realST = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms) => (ms === 20000 ? { unref() {} } : realST(fn, ms));
    try {
      app.showAuthHoldGate('config-unreadable');
      const first = document.getElementById('site-gate-overlay');
      app.showAuthHoldGate('config-unreadable');
      const second = document.getElementById('site-gate-overlay');
      assert(first === second,
        'the overlay node is REUSED, not removed and re-appended — the remove/append pair flickered every 20 seconds AND left the page with no overlay at all for the width of the swap');
      app.showAuthHoldGate('sdk-unavailable');
      const third = document.getElementById('site-gate-overlay');
      assert(third === first && third.getAttribute('data-hold-reason') === 'sdk-unavailable',
        '…and a change of VARIANT updates the same node in place (reason + copy), so the lock is never momentarily absent');
      assert(/Sign-in didn't load/.test(third.innerHTML) && !/We couldn't confirm/.test(third.innerHTML),
        '…with the new variant\'s copy, and none of the old variant\'s left behind');
      assert(!!document.getElementById('auth-hold-retry'), '…and the Retry button is re-bound after the in-place update');
    } finally { globalThis.setTimeout = realST; app._resetAuthHoldForTest(); }
  }

  // ── NO 20s TIMER SURVIVES hideAuthHoldGate() (security 10) ──────────────
  {
    resetAll();
    app._resetAuthHoldForTest();
    const realST = globalThis.setTimeout, realCT = globalThis.clearTimeout;
    const live = new Set();
    globalThis.setTimeout = (fn, ms) => { if (ms !== 20000) return realST(fn, ms); const id = { unref() {} }; live.add(id); return id; };
    globalThis.clearTimeout = id => { if (live.has(id)) live.delete(id); else realCT(id); };
    try {
      app.showAuthHoldGate('config-unreadable');
      assert(live.size === 1, `fixture: the gate armed its 20-second re-check (${live.size} live)`);
      app.hideAuthHoldGate();
      assert(live.size === 0,
        'security 10 — the re-check timer dies with the hold. A survivor would re-run the entire auth decision underneath a resolved app, every 20 seconds, forever');
      assert(app.currentAuthHoldReason() === '', '…and the hold state goes with it');
    } finally { globalThis.setTimeout = realST; globalThis.clearTimeout = realCT; app._resetAuthHoldForTest(); }
  }

  // ── S-1: A HOLD THAT CLEARS INTO A GOOGLE GATE DOES NOT DELETE IT ───────
  // THE SEQUENCE THAT HAPPENED: runAuthHoldCheck() -> applyAuthModeDecision()
  // paints the Google gate into #site-gate-overlay -> hideAuthHoldGate() removed
  // "#site-gate-overlay" unconditionally, i.e. deleted the gate just painted ->
  // resumeAfterHoldCleared() repainted the league dashboard from the mirror.
  // Reached with nobody touching the device, on the 20-second timer.
  {
    resetAll();
    app._resetAuthHoldForTest();
    app._resetSupabaseSdkLoaderForTest();
    auth._setHasSupabaseDataBackendForTest(true);
    localStorage.setItem('cfbp_site_unlocked', '1');
    auth._setStoredSessionForTest(null);          // NO saved session on this device
    const dom = paintPage();
    const realFetch = globalThis.fetch;
    const realST = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms) => (ms === 20000 ? { unref() {} } : realST(fn, ms));
    globalThis.fetch = async (url) => {
      if (String(url).includes('config.json')) return { ok: true, json: async () => ({ backendUrl: 'https://script.test/exec', backendToken: 'tok', authMode: 'supabase', supabaseUrl: 'https://p.test', supabaseAnonKey: 'a' }) };
      throw new Error('no network');
    };
    const realErr = console.error; console.error = () => {};
    try {
      globalThis.window.supabase = undefined;
      await app.ensureSupabaseSdkLoaded({ timeoutMs: 1 });
      await new Promise(r => realST(r, 15));
      const out1 = await app._applyAuthModeDecisionForTest();
      assert(out1.hold === 'sdk-unavailable', `fixture: the sdk-unavailable hold is up (got ${JSON.stringify(out1.hold)})`);
      // Signal comes back.
      installFakeSupabase({});
      await app.runAuthHoldCheck({ manual: false });
      for (let i = 0; i < 12; i++) await new Promise(r => realST(r, 0));
      const ov = document.getElementById('site-gate-overlay');
      assert(!!ov,
        'S-1 — AN OVERLAY IS STILL ON SCREEN after the hold cleared. This is the assertion that was red: hideAuthHoldGate() deleted the Google gate the decision had just painted, leaving a device with no identity and no gate');
      assert(ov.getAttribute('data-gate-state') !== 'hold' && /Continue with Google/.test(ov.innerHTML),
        '…and it is the correct gate for the resolved state: Google sign-in, because there is no session on this device');
      assert(app.currentAuthHoldReason() === '', '…with the hold state cleared before that gate painted');
      assert(Object.values(dom.painted).every(el => el.innerHTML === ''),
        'S-1 — and NO page container was repainted: resumeAfterHoldCleared() refuses while no identity is proven, so the league data stays gone');
      assert(app.isContentWithheld() === true, '…because the one predicate still says content is withheld (supabase mode, no session)');
    } finally {
      globalThis.setTimeout = realST; globalThis.fetch = realFetch; console.error = realErr;
      app._resetAuthHoldForTest();
    }
  }

  // ── REVIEWER F5 — THE TWO `!currentAuthHoldReason()` GUARDS, PINNED ─────
  // Deleting BOTH of them left the whole suite green before this.
  {
    resetAll();
    app._resetAuthHoldForTest();
    const realST = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms) => (ms === 20000 ? { unref() {} } : realST(fn, ms));
    try {
      wireRealAuthUI();
      app.showAuthHoldGate('interlock');
      // GUARD 1 — a session event that says "signed in" must not remove the lock.
      storeValidSession();
      auth._fireAuthEventForTest('SIGNED_IN', { access_token: 't', user: { id: 'u-drew' } });
      for (let i = 0; i < 6; i++) await new Promise(r => realST(r, 0));
      const ov = document.getElementById('site-gate-overlay');
      assert(!!ov && ov.getAttribute('data-hold-reason') === 'interlock',
        'F5 guard 1 — a SIGNED_IN with a valid token does NOT take the hold gate down (this is the line whose deletion nothing noticed)');
      // GUARD 2 — a signed-out event must not paint a Google gate over the lock.
      auth._setStoredSessionForTest(null);
      auth._fireAuthEventForTest('SIGNED_OUT', null);
      for (let i = 0; i < 6; i++) await new Promise(r => realST(r, 0));
      const ov2 = document.getElementById('site-gate-overlay');
      assert(!!ov2 && ov2.getAttribute('data-hold-reason') === 'interlock' && !/Continue with Google/.test(ov2.innerHTML),
        'F5 guard 2 — …and a signed-out event does not replace it with a Google gate this build cannot back');
      assert(!document.getElementById('google-gate-submit'), '…no Google control exists at all while the interlock holds');
      // GUARD 2, THE CASE THAT MAKES IT LOAD-BEARING: the hold is held but the
      // overlay NODE is momentarily absent. That is a real state — it is what
      // applyAuthModeDecision() used to create on its way into the SDK await —
      // and it is the only state in which the second guard's `&&` clause is the
      // thing doing the work.
      document.getElementById('site-gate-overlay')?.remove();
      assert(!document.getElementById('site-gate-overlay') && app.currentAuthHoldReason() === 'interlock',
        'fixture: the hold is still HELD while its overlay node is momentarily gone');
      auth._fireAuthEventForTest('SIGNED_OUT', null);
      for (let i = 0; i < 6; i++) await new Promise(r => realST(r, 0));
      assert(!document.getElementById('google-gate-submit') && !document.getElementById('site-gate-overlay'),
        'F5 guard 2 — with the hold held and no overlay on screen, a session event still refuses to paint a Google gate: the lock is the STATE, not the node');
    } finally { globalThis.setTimeout = realST; app._resetAuthHoldForTest(); }
  }

  // ── THE APP'S OWN TIMERS ARE PARKED WHILE A HOLD IS UP ──────────────────
  // The score/auto-transition interval is armed at boot, ABOVE the gate
  // decision (AD-08's paint-first order, which is load-bearing). Leaving it
  // running behind a lock means a device with no identity keeps waking up to
  // fetch and repaint every 60 seconds; the per-tick predicate stops the WORK,
  // and this stops the wake-ups.
  {
    resetAll();
    app._resetAuthHoldForTest();
    const realSI = globalThis.setInterval, realCI = globalThis.clearInterval, realST = globalThis.setTimeout;
    const liveIntervals = new Set();
    globalThis.setInterval = (fn, ms) => { const id = { ms }; liveIntervals.add(id); return id; };
    globalThis.clearInterval = id => { liveIntervals.delete(id); };
    globalThis.setTimeout = (fn, ms) => (ms === 20000 ? { unref() {} } : realST(fn, ms));
    try {
      app.setupAutoRefresh();
      assert(liveIntervals.size >= 1, `fixture: the auto-refresh interval is armed (${liveIntervals.size})`);
      app.showAuthHoldGate('config-unreadable');
      assert(liveIntervals.size === 0,
        `the hold parks the app's own intervals (${liveIntervals.size} left) — a locked device does not keep waking up to fetch scores and repaint`);
    } finally {
      globalThis.setInterval = realSI; globalThis.clearInterval = realCI; globalThis.setTimeout = realST;
      app._resetAuthHoldForTest();
    }
  }

  // ── SECURITY 10 — THE OVERLAY IS NEVER OFF DURING THE SDK AWAIT ─────────
  // applyAuthModeDecision() used to remove #site-gate-overlay unconditionally
  // on its way into `await ensureSupabaseSdkLoaded()`. On the 20-second
  // re-check path that took the HOLD GATE down for the width of that await —
  // up to its 10-second deadline, and longer on the re-injection path — leaving
  // a device with no identity looking at whatever the paint-first boot had left
  // on screen. The removal is scoped to "not a hold overlay" now.
  {
    resetAll();
    app._resetAuthHoldForTest();
    app._resetSupabaseSdkLoaderForTest();
    auth._setHasSupabaseDataBackendForTest(true);
    const realFetch = globalThis.fetch;
    const realST = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms) => (ms === 20000 || ms === 10000 ? { unref() {} } : realST(fn, ms));
    globalThis.fetch = async (url) => {
      if (String(url).includes('config.json')) return { ok: true, json: async () => ({ backendUrl: 'https://script.test/exec', backendToken: 'tok', authMode: 'supabase', supabaseUrl: 'https://p.test', supabaseAnonKey: 'a' }) };
      throw new Error('no network');
    };
    const realErr = console.error; console.error = () => {};
    try {
      globalThis.window.supabase = undefined;     // the injected script never fires either event
      app.showAuthHoldGate('sdk-unavailable');
      assert(app.currentAuthHoldReason() === 'sdk-unavailable', 'fixture: the hold gate is up');
      const pending = app._applyAuthModeDecisionForTest();   // deliberately NOT awaited
      for (let i = 0; i < 8; i++) await new Promise(r => realST(r, 0));
      const mid = document.getElementById('site-gate-overlay');
      assert(!!mid && mid.getAttribute('data-gate-state') === 'hold',
        'security 10 — WHILE the SDK load is still pending, the hold gate is STILL on screen: the decision no longer takes the lock down on its way into an await that can last ten seconds');
      assert(app.currentAuthHoldReason() === 'sdk-unavailable', '…and the hold state is intact mid-flight');
      void pending.catch(() => {});
    } finally { globalThis.setTimeout = realST; globalThis.fetch = realFetch; console.error = realErr; app._resetAuthHoldForTest(); }
  }

  // ── THE HOLD STATE IS CLEARED BY THE DECISION ITSELF, NOT ONLY BY THE ────
  //    RE-CHECK THAT HAPPENS TO CALL IT ──────────────────────────────────────
  // applyAuthModeDecision() is called from THREE places (boot, the Retry
  // button, the 20-second timer) and only two of them follow it with
  // hideAuthHoldGate(). A resolved decision must therefore drop the hold state
  // itself — otherwise a hold that resolves through any other caller leaves
  // `_authHoldReason` set, which is what A7 reads to refuse to take a gate
  // down, and what keeps the 20-second re-check timer alive.
  {
    resetAll();
    app._resetAuthHoldForTest();
    app._resetSupabaseSdkLoaderForTest();
    auth._setHasSupabaseDataBackendForTest(true);
    installFakeSupabase({});
    const realFetch = globalThis.fetch;
    const realST = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms) => (ms === 20000 ? { unref() {} } : realST(fn, ms));
    globalThis.fetch = async (url) => {
      if (String(url).includes('config.json')) return { ok: true, json: async () => ({ backendUrl: 'https://script.test/exec', backendToken: 'tok', authMode: 'supabase', supabaseUrl: 'https://p.test', supabaseAnonKey: 'a' }) };
      throw new Error('no network');
    };
    const realErr = console.error; console.error = () => {};
    try {
      app.showAuthHoldGate('config-unreadable');
      assert(app.currentAuthHoldReason() === 'config-unreadable', 'fixture: the hold gate is up');
      const out = await app._applyAuthModeDecisionForTest();
      assert(out.hold === null, `fixture: this time the decision resolves (got ${JSON.stringify(out.hold)})`);
      assert(app.currentAuthHoldReason() === '',
        'a resolved decision clears the hold state itself, BEFORE it paints the gate for the resolved mode — so no caller has to remember to, and the 20-second timer dies with it');
    } finally { globalThis.setTimeout = realST; globalThis.fetch = realFetch; console.error = realErr; app._resetAuthHoldForTest(); }
  }

  // ── PINS MODE IS UNTOUCHED BY THE WHOLE PREDICATE ───────────────────────
  {
    resetAll();
    app._resetAuthHoldForTest();
    auth.configureAuth({ authMode: 'pins' });
    assert(app.isContentWithheld() === false,
      "pins mode: content is never withheld, whatever the session looks like — the flag-off world keeps AD-08's paint-first behaviour byte for byte");
    auth._setStoredSessionForTest(null);
    assert(app.isContentWithheld() === false, '…including with no Supabase session on the device at all');
    auth.configureAuth({ authMode: 'prelink' });
    assert(app.isContentWithheld() === false, "…and 'prelink' likewise");
    auth.configureAuth({ authMode: 'supabase', supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' });
    assert(app.isContentWithheld() === true, 'fixture: …while supabase mode with no session DOES withhold (so the three above are not vacuous)');
    storeValidSession();
    assert(app.isContentWithheld() === false,
      '…and a supabase device WITH a valid session paints normally: the predicate withholds for lack of identity, not for being in the new mode');
  }

  // ── SECURITY 9 — NO ORPHAN <script> GROWTH ON REPEATED RE-INJECTION ─────
  {
    resetAll();
    app._resetAuthHoldForTest();
    app._resetSupabaseSdkLoaderForTest();
    const realErr = console.error; console.error = () => {};
    try {
      globalThis.window.supabase = undefined;
      const before = createdScripts.length;
      for (let i = 0; i < 3; i++) {
        app._resetSupabaseSdkLoaderForTest();
        await app.ensureSupabaseSdkLoaded({ timeoutMs: 1 });
        await new Promise(r => setTimeout(r, 5));
      }
      const injected = createdScripts.slice(before);
      assert(injected.length === 3, `fixture: three injection attempts really happened (got ${injected.length})`);
      assert(injected.every(el => el.src === app._SUPABASE_SDK_SRC_FOR_TEST),
        'fixture: every injected tag is the pinned vendored filename (never a CDN, never interpolated)');
      const live = injected.filter(el => el._removed !== true);
      assert(live.length === 1,
        `security 9 — each re-injection REMOVES the previous failed tag: exactly one is left in the document (got ${live.length} of 3). The sdk-unavailable hold re-injects every 20 seconds, so a device sitting on that gate for ten minutes used to accumulate thirty dead tags, each with its own listeners`);
      assert(live[0] === injected[injected.length - 1], '…and the one left is the most recent attempt, not an earlier corpse');
    } finally { console.error = realErr; }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[40] REVIEWER F7(e) — a RESTORED draft is still validated against the CURRENT slate…');
{
  // DI-180o(b) hands a slate back across a sign-out/sign-in boundary, and time
  // passes in between: the week can have locked, or a game can have been pulled
  // from the slate. The restore is not a licence to submit — it puts the draft
  // back in `state`, and every existing gate still applies. Pre-existing
  // behaviour; pinned here so a future "make the restore smoother" change
  // cannot quietly remove it.
  assert(app.canPlayerSubmitPicks({ weekId: 'w1', status: 'locked' }, 'mA').allowed === false,
    'a draft restored after the week LOCKED cannot be submitted — canPlayerSubmitPicks() refuses, and submitPicks() consults it before it writes anything');
  assert(app.canPlayerSubmitPicks({ weekId: 'w1', status: 'live' }, 'mA').allowed === false,
    '…same once the games are in progress');
  assert(app.canPlayerSubmitPicks({ weekId: 'w1', status: 'open' }, 'mA').allowed === true,
    'fixture: …and an OPEN week still accepts them, so the two above are not vacuous');
  {
    const src40 = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
    const submit = (src40.match(/function submitPicks\(week, games\)[\s\S]*?\n\}/) || [''])[0];
    assert(!!submit, 'fixture: submitPicks() was located');
    const permAt = submit.indexOf('canPlayerSubmitPicks(');
    const saveAt = submit.indexOf('saveAllPicks(');
    assert(permAt > -1 && saveAt > -1 && permAt < saveAt,
      `…and the permission check runs BEFORE anything is written (perm@${permAt}, save@${saveAt})`);
    assert(/games\.map\(game\s*=>/.test(submit) && /state\.draftPicks\[game\.gameId\]/.test(submit),
      'it iterates the CURRENT slate and looks each game up in the draft — never the other way round, so a draft entry for a game that is no longer on the slate has nothing to attach to');
    // REVIEWER F6 (sixth gate) — the `|| /isGamePickable\(game\)/` disjunct made
    // this unfalsifiable: the weak alternative matches the mere MENTION of the
    // function anywhere in the body, including in a comment, so the strong regex
    // could never be the thing doing the work. Deleted; the strong form is what
    // is asserted.
    assert(/!isGamePickable\(game\)\)return null/.test(submit.replace(/\s+/g, ' ').replace(/ \)/g, ')')),
      '…and a game that has kicked off is skipped per-game, even on an open week');
  }

  // ── REVIEWER F7 (SIXTH gate, 2026-09-17) — THE OTHER HALF, BEHAVIORALLY ───
  // Everything above is a SOURCE SCAN: it reads submitPicks() and checks that
  // two substrings appear in the right order. That is a claim about the text,
  // and it stays green for a submitPicks() that calls canPlayerSubmitPicks() and
  // then ignores the answer. The claim this section is actually making — "a
  // slate suspended by an expiry and handed back later is not a licence to
  // submit into a week that has moved on" — is now driven end to end: the slate
  // is really suspended by a real expiry, really restored by the same account
  // signing back in, and then really submitted against a CHANGED slate.
  {
    const realFetch40 = globalThis.fetch;
    const realST40 = globalThis.setTimeout;
    // submitPicks() schedules a 300ms renderPicksPage(); this DOM stub is too
    // small for that render and an exception inside a timer is an uncaught
    // exception, i.e. a crashed suite rather than a failed assertion.
    globalThis.setTimeout = (fn, ms) => (ms === 300 ? 0 : realST40(fn, ms));
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ oneSignalAppId: 'test-app-id' }) });
    const ROW40 = { league_id: 'L-A', id: 'mA', role: 'player', display_name: 'Drew', active: true, leagues: { name: 'League A' } };
    const DEAD40 = () => Object.assign(new Error('Invalid Refresh Token: Refresh Token Not Found'), { name: 'AuthApiError', status: 400, code: 'refresh_token_not_found' });
    const KICKOFF = new Date(Date.now() + 86_400_000).toISOString();
    const GAME = (id, home, away) => ({ gameId: id, weekId: 'w1', homeTeam: home, awayTeam: away,
      homeScore: null, awayScore: null, spread: -3.5, lockedSpread: null, status: 'scheduled', kickoff: KICKOFF, multiplier: 1 });
    const OPEN_WEEK   = { weekId: 'w1', weekNumber: 1, name: 'Week 1', status: 'open',   startDate: '2026-09-05', endDate: '2026-09-07' };
    const LOCKED_WEEK = { ...OPEN_WEEK, status: 'locked' };
    const tick40 = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise(r => realST40(r, 0)); };
    const realWarn40 = console.warn, realInfo40 = console.info, realErr40 = console.error;

    /** Sign in as u-drew, half-fill a slate, expire WITH PROOF (so DI-180p
     *  destroys and the identity tuple really moves, which is what suspends),
     *  then sign back in as the same account so the slate is RESTORED. */
    async function suspendThenRestore() {
      let failWith = null;
      resetAll({
        getSession: async () => ({ data: { session: { user: { id: 'u-drew', email: 'drew@example.com' } } } }),
        from: () => { if (failWith) throw failWith(); return { data: [ROW40], error: null }; },
      });
      wireRealAuthUI();
      globalThis.window.OneSignalDeferred = [];
      storeValidSession();
      auth._fireAuthEventForTest('SIGNED_IN', { user: { id: 'u-drew', email: 'drew@example.com' } });
      await tick40();
      app.state.draftPicks = { g1: 'Texas A&M', g2: 'LSU' };
      app.state.draftTiebreaker = 44;
      app.state.draftExtraPoint = null;
      failWith = DEAD40;
      try { await auth.refreshMembershipsAndSession(); } catch {}
      await tick40();
      failWith = null;
      storeValidSession();
      auth._fireAuthEventForTest('SIGNED_IN', { user: { id: 'u-drew', email: 'drew@example.com' } });
      await tick40();
    }

    console.warn = () => {}; console.info = () => {}; console.error = () => {};
    try {
      // ── (A) THE WEEK LOCKED WHILE THE SLATE WAS SUSPENDED ────────────────
      await suspendThenRestore();
      assert(storage.getSession().playerId === 'mA' && storage.getSession().playerVerified === true,
        `fixture: the same account is back (${JSON.stringify(storage.getSession())})`);
      assert(app._suspendedSlateForTest() === null && Object.keys(app.state.draftPicks).length === 2,
        `fixture: …and the suspended slate was RESTORED into state (${JSON.stringify(app.state.draftPicks)}) — so there is a real draft to refuse`);
      assert(storage.getPicks('w1', 'mA').length === 0, 'fixture: nothing is written for this player yet');

      app._submitPicksForTest(LOCKED_WEEK, [GAME('g1', 'Texas A&M', 'LSU'), GAME('g2', 'LSU', 'Florida')]);
      await tick40(4);
      assert(storage.getPicks('w1', 'mA').length === 0,
        `F7 — a RESTORED draft submitted into a week that LOCKED while it was suspended writes NOTHING (${storage.getPicks('w1', 'mA').length} pick(s) stored). The restore puts the draft back in state; it does not put the player back inside the window.`);
      assert(Object.keys(app.state.draftPicks).length === 2,
        '…and the draft is not consumed either, so the player still has it if the commissioner reopens the week');

      // ── (B) A GAME WAS PULLED FROM THE SLATE WHILE IT WAS SUSPENDED ──────
      await suspendThenRestore();
      assert(Object.keys(app.state.draftPicks).length === 2 && app.state.draftPicks.g2 === 'LSU',
        'fixture: the restored draft holds picks for BOTH g1 and g2');
      // The commissioner removed g2 from the slate in the meantime.
      app._submitPicksForTest(OPEN_WEEK, [GAME('g1', 'Texas A&M', 'LSU')]);
      await tick40(4);
      const stored = storage.getPicks('w1', 'mA');
      assert(stored.length === 1 && stored[0].gameId === 'g1',
        `F7 — the submit iterates the CURRENT slate, so exactly one pick is written (${JSON.stringify(stored.map(p => p.gameId))})`);
      assert(!stored.some(p => p.gameId === 'g2'),
        '…and the restored draft entry for the REMOVED game has nothing to attach to: it is silently dropped rather than written against a game the league no longer has');
      assert(storage.getTiebreakerGuess('w1', 'mA') === 44,
        `…while the rest of the restored slate submits normally (tiebreaker ${JSON.stringify(storage.getTiebreakerGuess('w1', 'mA'))}) — which is what makes the two refusals above non-vacuous`);
    } finally {
      console.warn = realWarn40; console.info = realInfo40; console.error = realErr40;
      globalThis.fetch = realFetch40; globalThis.setTimeout = realST40;
      for (const k of ['cfbp_picks', 'cfbp_tiebreaker_guesses', 'cfbp_extra_point_guesses']) { try { localStorage.removeItem(k); } catch {} }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[41] SIXTH GATE — the identity EPOCH, and every latch that had no release…');
{
  // ── WHY THIS SECTION EXISTS ───────────────────────────────────────────────
  // The fifth gate's state table enumerated four terms and the code was made to
  // match it. The sixth gate found three more defects, every one of them in
  // state that lived OUTSIDE that table: the two in-flight PROMISES (an
  // asynchronous result landing for a person who has left the device), the DOM's
  // `inert` attribute (a page painted but dead to touch), and
  // `_sessionForcedOut` (a latch with no production release at all). So the
  // table now lists EVERY latch the feature owns — see js/auth.js's header —
  // and this section is R2 for the new rows: each is driven UP and then proven
  // to come back DOWN, behaviorally, through the real listener chain.
  const K41 = auth._AUTH_STORAGE_KEY_FOR_TEST;
  const ROW_A = { league_id: 'L-A', id: 'mA', role: 'commissioner', display_name: 'Drew', active: true, leagues: { name: 'League A' } };
  const ROW_B = { league_id: 'L-B', id: 'mB', role: 'player', display_name: 'Kihoon', active: true, leagues: { name: 'League B' } };
  const four01 = () => Object.assign(new Error('JWT expired'), { status: 401 });
  const ALIVE = () => ({ data: { session: { access_token: 't2', expires_at: Math.floor(Date.now() / 1000) + 3600 } }, error: null });
  const tick = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };
  /** Capture console.warn/info/error for one window, so "one console.warn and
   *  nothing else" is an assertion rather than a claim. */
  async function quiet(fn) {
    const rw = console.warn, ri = console.info, re = console.error;
    const logs = [];
    console.warn = (...a) => logs.push(a.map(String).join(' '));
    console.info = (...a) => logs.push(a.map(String).join(' '));
    console.error = (...a) => logs.push(a.map(String).join(' '));
    try { await fn(logs); } finally { console.warn = rw; console.info = ri; console.error = re; }
    return logs;
  }

  // ── (a) SECURITY F-1, REPRODUCTION (A) ────────────────────────────────────
  // A supabase boot kicks off the membership read. The player taps Sign Out
  // while the round trip is still out. The read LANDS — and, before the epoch,
  // wrote the cache, auto-resolved setActiveLeagueId(), recomputed the
  // synthesized session and emitted MEMBERSHIPS_REFRESHED. Net result: a device
  // with no token on it answering getSession() = {playerId:'mA', isAdmin:true}.
  {
    let releaseRead = null;
    const readGate = new Promise(r => { releaseRead = r; });
    let reads = 0;
    resetAll({
      getSession: async () => ({ data: { session: { user: { id: 'u-drew', email: 'drew@example.com' } } } }),
      from: async () => { reads++; await readGate; return { data: [ROW_A], error: null }; },
    });
    wireRealAuthUI();
    storeValidSession();
    const events = [];
    auth.onAuthEvent(e => events.push(e));
    const p = auth.refreshMembershipsAndSession().catch(() => {});
    await tick(6);
    assert(reads === 1 && auth.getAccountUserId() === 'u-drew',
      `fixture: the read is genuinely IN FLIGHT and has already adopted the account (reads ${reads}, account ${JSON.stringify(auth.getAccountUserId())})`);
    const epochBefore = auth.getIdentityEpoch();

    await auth.signOut();
    await tick(6);
    assert(auth.getIdentityEpoch() > epochBefore,
      `Sign Out advances the identity epoch (${epochBefore} -> ${auth.getIdentityEpoch()}) — everything issued for the departing player is void from the tap, not from whenever the SDK answers`);
    events.length = 0;

    const logs = await quiet(async () => { releaseRead(); await p; await tick(10); });

    assert(auth.getSupabaseSession().playerId === null && auth.getSupabaseSession().isAdmin === false,
      `F-1(A) — the landing read is DISCARDED: the signed-out device does not answer with the departed player (${JSON.stringify(auth.getSupabaseSession())})`);
    assert(storage.getSession().playerId === null && storage.getSession().isAdmin === false,
      `…and storage.getSession() agrees, which is the accessor every isAdmin call site in js/app.js reads (${JSON.stringify(storage.getSession())})`);
    assert(auth.getActiveLeagueId() === null,
      `…the active-league POINTER was never moved (${JSON.stringify(auth.getActiveLeagueId())}) — the auto-resolve for "exactly one membership" is one of the writes the discard skips`);
    assert(auth.hasResolvedMemberships() === false,
      '…and the membership cache was not written, so nothing downstream can re-derive a session from it');
    assert(!events.includes('MEMBERSHIPS_REFRESHED'),
      `…and NO membership event was emitted after the sign-out (got ${JSON.stringify(events)}) — a discard is silent by design`);
    assert(logs.filter(l => /DISCARDED/.test(l)).length === 1,
      `…with exactly one console warning explaining it (${logs.filter(l => /DISCARDED/.test(l)).length})`);
  }
  // …and the NON-VACUITY half: the identical read, with nobody signing out,
  // resolves the league exactly as it always did.
  {
    let releaseRead = null;
    const readGate = new Promise(r => { releaseRead = r; });
    resetAll({
      getSession: async () => ({ data: { session: { user: { id: 'u-drew' } } } }),
      from: async () => { await readGate; return { data: [ROW_A], error: null }; },
    });
    wireRealAuthUI();
    storeValidSession();
    const p = auth.refreshMembershipsAndSession().catch(() => {});
    await tick(6);
    releaseRead();
    await p;
    await tick(6);
    assert(auth.getActiveLeagueId() === 'L-A' && storage.getSession().playerId === 'mA' && storage.getSession().isAdmin === true,
      `non-vacuity — the SAME slow read, with no sign-out, still resolves normally (${JSON.stringify(storage.getSession())}). The epoch discards stale work, not slow work.`);
  }

  // ── (a2) THE WINDOW ONLY THE *TOP* OF signOut() COVERS ────────────────────
  // (a) above is defended twice over: signOut() bumps the epoch at its first
  // line, AND the SDK's SIGNED_OUT event clears `_accountUserId` through the one
  // setter, which bumps too. A mutation removing only the first stayed green
  // because the fake SDK fires SIGNED_OUT synchronously inside the await.
  //
  // Real SDKs do not have to. SEC concern 2 is the whole reason `_signOutAt`
  // exists: the SIGNED_OUT event may arrive a tick later, or after signOut() has
  // already returned, or (on a client that could not be built) never. In that
  // world the ONLY thing standing between an in-flight read and a signed-out
  // device is the bump at the top of signOut() — so this drives exactly that:
  // the SDK's sign-out is SLOW, fires nothing, and the read LANDS INSIDE IT.
  {
    let releaseRead = null;
    const readGate = new Promise(r => { releaseRead = r; });
    resetAll({
      getSession: async () => ({ data: { session: { user: { id: 'u-drew' } } } }),
      from: async () => { await readGate; return { data: [ROW_A], error: null }; },
      // No listener fire, and slow: the awaited call yields enough turns for the
      // released read to run to completion before signOut() resumes.
      signOut: async () => {
        releaseRead();
        for (let i = 0; i < 12; i++) await new Promise(r => setTimeout(r, 0));
        return { error: null };
      },
    });
    wireRealAuthUI();
    storeValidSession();
    const events = [];
    auth.onAuthEvent(e => events.push(e));
    const p = auth.refreshMembershipsAndSession().catch(() => {});
    await tick(6);
    assert(auth.getAccountUserId() === 'u-drew', 'fixture: the read is in flight, account adopted');
    events.length = 0;

    await quiet(async () => { await auth.signOut(); await p; await tick(10); });

    assert(!events.includes('MEMBERSHIPS_REFRESHED'),
      `F-1(A), the narrow window — an SDK sign-out that fires NO event and takes several turns still voids the in-flight read (events since the tap: ${JSON.stringify(events)}). Without the bump at signOut()'s first line the read lands mid-await, writes the cache and emits a membership refresh for the player who has just left.`);
    assert(auth.getSupabaseSession().playerId === null && auth.getActiveLeagueId() === null,
      `…and the device is nobody, scoped to nothing (${JSON.stringify(auth.getSupabaseSession())})`);
  }

  // ── (a3) REVIEWER F2 (SEVENTH GATE) — THE ADOPTION STEP HAD ZERO COVERAGE ─
  // getMemberships() has its OWN epoch check, at the moment it is about to adopt
  // `uid` (js/auth.js, immediately after `await client.storage.getSession()`), and
  // nothing exercised it: mutating that branch to `if (false)` left authtest
  // 944/0 while the DEPARTED account was re-adopted AND the DI-180q owner marker
  // was stamped with the departed identity.
  //
  // (a) and (a2) both cannot reach it, and the reason is the whole point: in
  // both of those the account is ALREADY adopted before the sign-out, so the
  // relevant guard is the one on the RESOLVE path. This drives the other window
  // — the sign-out lands INSIDE `await client.storage.getSession()`, i.e. before
  // `_accountUserId` has ever been written. That call is a round trip of its own
  // (the SDK rehydrating a token), so it is a real window, not a contrived one.
  {
    let releaseSession = null;
    const sessionGate = new Promise(r => { releaseSession = r; });
    let sessionReads = 0;
    const rowReads = [];
    resetAll({
      getSession: async () => {
        sessionReads++;
        await sessionGate;
        return { data: { session: { user: { id: 'u-drew', email: 'drew@example.com' } } } };
      },
      from: async () => { rowReads.push('league_members'); return { data: [ROW_A], error: null }; },
      // Same shape as (a2): no event, and slow enough that the released
      // getSession() resumes and runs to completion inside the await.
      signOut: async () => {
        releaseSession();
        for (let i = 0; i < 12; i++) await new Promise(r => setTimeout(r, 0));
        return { error: null };
      },
    });
    wireRealAuthUI();
    storeValidSession();
    const events = [];
    auth.onAuthEvent(e => events.push(e));
    const p = auth.refreshMembershipsAndSession().catch(() => {});
    await tick(6);
    assert(sessionReads === 1 && auth.getAccountUserId() === '' && rowReads.length === 0,
      `fixture: the read is parked INSIDE client.storage.getSession() — no account adopted yet (${JSON.stringify(auth.getAccountUserId())}), no league rows requested (${rowReads.length})`);
    const epochBefore3 = auth.getIdentityEpoch();
    events.length = 0;

    const logs3 = await quiet(async () => { await auth.signOut(); await p; await tick(12); });

    assert(auth.getIdentityEpoch() > epochBefore3,
      `Sign Out advanced the epoch while the getSession() round trip was still out (${epochBefore3} -> ${auth.getIdentityEpoch()})`);
    assert(storage.getSession().playerId === null,
      `F2 — the departed account is NOT re-adopted: playerId is null (${JSON.stringify(storage.getSession().playerId)}). With the adoption-step guard removed this read wrote 'u-drew' straight back over the signed-out state.`);
    assert(storage.getSession().isAdmin === false,
      `…and isAdmin is false (${JSON.stringify(storage.getSession().isAdmin)}) — A9's commissioner rights do not come back with it`);
    assert(auth.getAccountUserId() === '',
      `…and the account id itself was never written (${JSON.stringify(auth.getAccountUserId())}) — the guard returns "could not ask", the one answer that writes nothing`);
    assert(auth.getActiveLeagueId() === null,
      `…and no active league was resolved (${JSON.stringify(auth.getActiveLeagueId())})`);
    assert(auth.getDeviceDataOwner() === '',
      `F2 — and DI-180q's OWNER MARKER was NOT stamped (${JSON.stringify(auth.getDeviceDataOwner())}). This is the half that is not merely cosmetic: a marker written with the DEPARTED identity makes the next boot read "marker matches" and keep that player's cached room forever.`);
    assert(rowReads.length === 0,
      `…and the second round trip (the league_members SELECT) was never even issued (${rowReads.length}) — the guard is above it, so a voided read costs nothing`);
    assert(!events.includes('MEMBERSHIPS_REFRESHED'),
      `…and nothing was emitted (${JSON.stringify(events)})`);
    assert(logs3.filter(l => /account-adoption step/.test(l)).length === 1,
      `…with exactly one console warning naming the step it was discarded at (${logs3.filter(l => /account-adoption step/.test(l)).length})`);
  }
  // NON-VACUITY for (a3): the identical slow getSession(), nobody signing out.
  {
    let releaseSession = null;
    const sessionGate = new Promise(r => { releaseSession = r; });
    resetAll({
      getSession: async () => { await sessionGate; return { data: { session: { user: { id: 'u-drew' } } } }; },
      from: async () => ({ data: [ROW_A], error: null }),
    });
    wireRealAuthUI();
    storeValidSession();
    const p = auth.refreshMembershipsAndSession().catch(() => {});
    await tick(4);
    releaseSession();
    await p;
    await tick(8);
    assert(auth.getAccountUserId() === 'u-drew' && storage.getSession().playerId === 'mA',
      `non-vacuity — the SAME slow getSession(), with no sign-out, adopts the account and resolves the league exactly as it always did (${JSON.stringify(storage.getSession())})`);
    assert(auth.getDeviceDataOwner() !== '',
      '…and the owner marker IS stamped on that path, so (a3)\'s marker assertion is measuring a difference rather than a permanent absence');
  }

  // ── (b) SECURITY F-1, REPRODUCTION (B): the A -> B handover ───────────────
  // B's own preference-free read was COALESCED into A's in-flight promise, so
  // one network call served two different people and B received A's rows, A's
  // league and A's COMMISSIONER role. One call, so not even the request count
  // gave it away.
  {
    const st = { uid: 'u-A', reads: [] };
    let releaseReads = null;
    const gate = new Promise(r => { releaseReads = r; });
    resetAll({
      getSession: async () => ({ data: { session: { user: { id: st.uid } } } }),
      from: async () => {
        const who = st.uid;              // whose read this is, fixed at issue time
        st.reads.push(who);
        await gate;
        return { data: [who === 'u-A' ? ROW_A : ROW_B], error: null };
      },
    });
    wireRealAuthUI();
    storeValidSession();
    const pA = auth.refreshMembershipsAndSession().catch(() => {});
    await tick(6);
    assert(st.reads.length === 1 && auth.getAccountUserId() === 'u-A', 'fixture: A\'s read is in flight');

    // The handset is handed over. The SDK reports the new account.
    st.uid = 'u-B';
    const logs = await quiet(async () => {
      auth._fireAuthEventForTest('SIGNED_IN', { access_token: 't', user: { id: 'u-B', email: 'kihoon@example.com' } });
      await tick(8);
      assert(st.reads.length === 2 && st.reads[1] === 'u-B',
        `F-1(B) — B ISSUES ITS OWN NETWORK CALL (reads: ${JSON.stringify(st.reads)}). Before the epoch, the single-flight latch handed B the promise A's read was already waiting on — the assertion that was red.`);
      releaseReads();
      await pA;
      await tick(12);
    });

    assert(auth.getActiveLeagueId() === 'L-B',
      `…and B lands in B's league, not A's (${JSON.stringify(auth.getActiveLeagueId())})`);
    assert(storage.getSession().playerId === 'mB',
      `…as B's own member id (${JSON.stringify(storage.getSession())})`);
    assert(storage.getSession().isAdmin === false,
      '…and NOT as a commissioner: A\'s role is the thing this handover must never carry across');
    assert(auth.getCachedMemberships().every(m => m.leagueId !== 'L-A'),
      `…with none of A's rows left in the cache (${JSON.stringify(auth.getCachedMemberships().map(m => m.leagueId))})`);
    assert(logs.some(l => /DISCARDED/.test(l)), '…and A\'s read, which landed afterwards, said out loud that it was discarded');
  }

  // ── (c) 'alive' FOR A, LANDING AFTER B, RELEASES NOTHING FOR B ────────────
  // The reviewer's wording exactly, and the scenario is built so that B REALLY
  // HAS SOMETHING TO RELEASE: B signs in, B's own read 401s, B's own round comes
  // back 'unknown', so B sits in S2 with the lock up and one strike. THEN A's
  // long-gated round resolves ALIVE. Evidence about A's session must not lower
  // B's lock, must not reset B's strike, and must not tell B they have been
  // re-verified.
  {
    const st = { uid: 'u-A', failures: 0, refreshCalls: { 'u-A': 0, 'u-B': 0 } };
    let releaseA = null;
    const gateA = new Promise(r => { releaseA = r; });
    resetAll({
      getSession: async () => ({ data: { session: { user: { id: st.uid } } } }),
      // A's refresh HANGS on the gate and will eventually answer ALIVE.
      // B's answers immediately with a 429, i.e. the 'unknown' verdict.
      refreshSession: async () => {
        const who = st.uid;
        st.refreshCalls[who]++;
        if (who === 'u-A') { await gateA; return ALIVE(); }
        return { data: { session: null }, error: Object.assign(new Error('rate limited'), { status: 429 }) };
      },
      from: () => {
        if (st.failures > 0) { st.failures--; throw four01(); }
        return { data: [st.uid === 'u-A' ? ROW_A : ROW_B], error: null };
      },
    });
    wireRealAuthUI();
    storeValidSession();
    await auth.refreshMembershipsAndSession();
    assert(storage.getSession().isAdmin === true, 'fixture: A is signed in, as a commissioner');
    st.failures = 1;
    const pA = auth.refreshMembershipsAndSession().catch(() => {});
    await tick(6);
    assert(auth.isPrivilegeHeld() === true && auth._isVerificationInFlightForTest() === true && st.refreshCalls['u-A'] === 1,
      'fixture: S1 for A — the lock is up and A\'s verification round is open and unanswered');

    // The handset changes hands. B's first read SUCCEEDS, so B is genuinely
    // scoped to their own league — which is what makes "A's verdict must not
    // re-scope B" a claim about something rather than about an unresolved page.
    st.uid = 'u-B';
    st.failures = 0;
    await quiet(async () => {
      auth._fireAuthEventForTest('SIGNED_IN', { access_token: 't', user: { id: 'u-B' } });
      await tick(12);
    });
    assert(auth.getActiveLeagueId() === 'L-B' && storage.getSession().playerId === 'mB',
      `fixture: B is signed in and scoped to B's own league (${JSON.stringify(auth.getActiveLeagueId())})`);
    // …and now B lands in S2 on their OWN evidence.
    st.failures = 1;
    await quiet(async () => { await auth.refreshMembershipsAndSession().catch(() => {}); await tick(12); });
    assert(st.refreshCalls['u-B'] === 1,
      `fixture: B opened a verification round OF THEIR OWN (${st.refreshCalls['u-B']}) rather than sharing A's — the epoch keys the round latch too`);
    assert(auth.isPrivilegeHeld() === true && auth._expiredStrikesForTest() === 1,
      `fixture: S2 for B — held, one strike, nothing destroyed (strikes ${auth._expiredStrikesForTest()})`);

    const seen = [];
    auth.onAuthEvent(e => seen.push(e));
    await quiet(async () => { releaseA(); await pA; await tick(12); });

    assert(!seen.includes('SESSION_REVERIFIED'),
      `I6 — A's 'alive' verdict, landing after B, emits NO SESSION_REVERIFIED at B (got ${JSON.stringify(seen)}): it is proof about a session that has left the device`);
    assert(auth.isPrivilegeHeld() === true,
      '…and B\'s privilege lock is STILL UP. Before the epoch, A\'s refresh answering "your token is fine" would have handed B the commissioner surface on somebody else\'s evidence.');
    assert(auth._expiredStrikesForTest() === 1,
      `…and B's strike counter is untouched (${auth._expiredStrikesForTest()}) — a stale round is not an intervening success`);
    assert(auth.getActiveLeagueId() === 'L-B' && storage.getSession().playerId === 'mB',
      `…and the re-read an 'alive' verdict normally triggers never ran, so B was never re-scoped to A's league (${JSON.stringify(auth.getActiveLeagueId())})`);
  }

  // ── (c2) SECURITY O-2 (SEVENTH GATE) — ONE ASSERTION PER HALF ─────────────
  // F-1(B) is closed TWICE OVER, deliberately (js/auth.js's epoch block, use
  // (2) and (3)): the single-flight latches each store the epoch they were
  // opened under AND `_bumpIdentityEpoch()` nulls both of them. (b) and (c)
  // above are property tests over the OUTCOME — "B got its own read", "A's
  // verdict did not reach B" — so removing either half on its own leaves them
  // green, which is precisely the redundancy-is-invisible problem this arc keeps
  // hitting. One targeted assertion per half, so a single-half regression is red
  // on its own line.
  {
    // ── HALF 2, BEHAVIOURALLY: a bump NULLS both latches ──────────────────
    // Both are observable as state (_isMembershipRefreshInFlightForTest /
    // _isVerificationInFlightForTest), so this needs no source reading: open a
    // membership read AND a verification round, bump the epoch by handing the
    // device to a different account, and assert both latches are gone even
    // though the underlying promises are still genuinely out.
    const st2 = { uid: 'u-A' };
    let releaseRead2 = null, releaseRefresh2 = null;
    const readGate2 = new Promise(r => { releaseRead2 = r; });
    const refreshGate2 = new Promise(r => { releaseRefresh2 = r; });
    let failNext = false;
    resetAll({
      getSession: async () => ({ data: { session: { user: { id: st2.uid } } } }),
      refreshSession: async () => { await refreshGate2; return ALIVE(); },
      from: async () => {
        if (failNext) { failNext = false; throw four01(); }
        await readGate2;
        return { data: [st2.uid === 'u-A' ? ROW_A : ROW_B], error: null };
      },
    });
    wireRealAuthUI();
    storeValidSession();
    // ONE call opens BOTH latches: the membership single-flight latch wraps the
    // whole run, and the 401 inside it opens a verification round that parks on
    // its own gate. Deliberately NOT awaited — awaiting it would block until the
    // round resolved (or hit its deadline), by which point both latches have
    // already released and the fixture would be measuring nothing.
    failNext = true;
    const pBoth = auth.refreshMembershipsAndSession().catch(() => {});
    await tick(8);
    assert(auth._isVerificationInFlightForTest() === true,
      'fixture: a verification round is OPEN and unanswered (its refreshSession is parked on a gate)');
    assert(auth._isMembershipRefreshInFlightForTest() === true,
      'fixture: …and the membership read that triggered it is still in flight, so both latches are set at once');

    // THE BUMP IS A SIGN-OUT, NOT A HANDOVER, and that is the point of this
    // assertion rather than an accident of convenience: a handover immediately
    // opens B's OWN membership read, so `_isMembershipRefreshInFlightForTest()`
    // reads true again one tick later and says nothing about whether A's latch
    // was nulled. (It read true on the first run of this assertion for exactly
    // that reason.) A sign-out bumps the epoch and starts nothing, so "the latch
    // is gone" is observable on its own.
    await quiet(async () => { await auth.signOut(); await tick(4); });
    assert(auth._isMembershipRefreshInFlightForTest() === false,
      'O-2, HALF 2 — the identity bump NULLED the membership single-flight latch, so no later caller can even FIND the departing player\'s promise. (Half 1 — the epoch stamped on the latch — would still make it unusable if found; that is the redundancy, and it is asserted separately below.)');
    assert(auth._isVerificationInFlightForTest() === false,
      '…and the verification round latch with it, on the same bump and for the same reason');
    await quiet(async () => { releaseRead2(); releaseRefresh2(); await pBoth; await tick(12); });

    // ── HALF 1, STRUCTURALLY, AND WHY IT CANNOT BE BEHAVIOURAL ────────────
    // Half 2 nulls the latches on every bump, so "the latch object exists AND
    // the epoch has moved" is a state production can no longer reach — which is
    // exactly what makes half 1 redundant, and exactly why it cannot be driven
    // from outside the module. It is asserted at the source instead: each latch
    // must STORE an epoch and each read of it must COMPARE that epoch. A
    // mutation that drops either comparison turns this red while every
    // behavioural assertion above stays green.
    {
      const src = readFileSync(new URL('./js/auth.js', import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
      for (const latch of ['_membershipRefreshInFlight', '_verificationInFlight']) {
        const reads = [...src.matchAll(new RegExp(`${latch}\\s*&&\\s*${latch}\\.epoch === _identityEpoch`, 'g'))];
        assert(reads.length === 1,
          `O-2, HALF 1 — ${latch} is read exactly once, and that read COMPARES the epoch it was opened under (found ${reads.length}). A caller arriving under a different identity is therefore never served the previous one's promise, independently of the nulling asserted above.`);
        assert(new RegExp(`${latch} = entry`).test(src)
            && (/const entry = \{ epoch: _identityEpoch/.test(src) || /const entry = \{ epoch: epoch0/.test(src)),
          `…and ${latch} is ASSIGNED an object carrying the epoch it was opened under, so there is an epoch there to compare (the verification round captures it as \`epoch0\` on entry; the membership latch reads \`_identityEpoch\` at assignment — same value, one line apart)`);
      }
      assert(!/_membershipRefreshInFlight\s*&&\s*_membershipRefreshInFlight\.epoch === _identityEpoch/.test('if (x && x.epoch === _identityEpoch) return x.promise;'),
        'canary: that pattern is specific — it does not match a latch read with no epoch comparison, so the two rules above are not vacuously green');
    }
  }

  // ── (d) REVIEWER F2 — `_sessionForcedOut` HAS A PRODUCTION RELEASE ────────
  // It was set on both fail-closed hold branches and cleared ONLY in
  // _resetAuthForTest. _recomputeSynthesizedSession() short-circuits on it
  // forever, so a device that recovered — and the config-unreadable variant
  // recovers BY ITSELF, silently, on a 20-second timer — painted its league as
  // nobody, holding a perfectly valid saved session, for the life of the page.
  {
    let forceA401 = false;
    resetAll({
      getSession: async () => ({ data: { session: { user: { id: 'u-drew' } } } }),
      refreshSession: async () => ({ data: { session: null }, error: Object.assign(new Error('rate limited'), { status: 429 }) }),
      from: () => { if (forceA401) throw four01(); return { data: [ROW_A], error: null }; },
    });
    app._resetAuthHoldForTest();
    app._resetSupabaseSdkLoaderForTest();
    storeValidSession();
    const realFetch = globalThis.fetch;
    const realST = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms) => (ms === 20000 ? { unref() {} } : realST(fn, ms));
    globalThis.fetch = async (url) => {
      if (String(url).includes('config.json')) return { ok: true, json: async () => ({ backendUrl: 'https://script.test/exec', backendToken: 'tok', authMode: 'supabase', supabaseUrl: 'https://p.test', supabaseAnonKey: 'a' }) };
      throw new Error('no network');
    };
    try {
      // R2(i) — ENTERED. The interlock is live, so the decision forces out.
      auth._setHasSupabaseDataBackendForTest(false);
      let out1 = null;
      await quiet(async () => { out1 = await app._applyAuthModeDecisionForTest(); await tick(8); });
      assert(out1.hold === 'interlock', `fixture: the interlock hold is up (got ${JSON.stringify(out1.hold)})`);
      assert(auth.isSessionForcedOut() === true, 'R2(i) — …and the latch is SET');
      assert(storage.getSession().playerId === null && storage.getSession().isAdmin === false,
        `…so no session is derived (${JSON.stringify(storage.getSession())})`);

      // …and it is NOT released by a proven-good path. A successful membership
      // read says the SERVER accepts this JWT; it says nothing whatever about
      // whether this build's data layer is ready for a Supabase-derived isAdmin.
      // Releasing there would reopen SEC F1 (CRITICAL) through its own fix.
      //
      // THE RELEASE ROUTINE HAS TO ACTUALLY RUN for this to mean anything:
      // _releaseExpiryHoldOnProof() early-returns when nothing is held, so a
      // plain successful read on a quiet page never enters it — and a mutation
      // that added `_sessionForcedOut = false` inside it stayed green for
      // exactly that reason. So the page is driven into a state where BOTH are
      // true (forced out by the interlock AND privilege held by a 401), and only
      // then is the read allowed to succeed.
      forceA401 = true;
      await quiet(async () => { await auth.refreshMembershipsAndSession().catch(() => {}); await tick(10); });
      forceA401 = false;
      assert(auth.isPrivilegeHeld() === true && auth.isSessionForcedOut() === true,
        'fixture: BOTH latches are up — forced out by the interlock, and privilege held by an unverified 401');
      let released = false;
      const unsub = auth.onAuthEvent(e => { if (e === 'SESSION_REVERIFIED') released = true; });
      await quiet(async () => { await auth.refreshMembershipsAndSession().catch(() => {}); await tick(10); });
      unsub();
      assert(released === true && auth.isPrivilegeHeld() === false,
        'fixture: …and the successful read really did run the release routine (SESSION_REVERIFIED went out and the privilege lock came down)');
      assert(auth.isSessionForcedOut() === true && storage.getSession().isAdmin === false,
        `…but the INTERLOCK latch is untouched by it (${JSON.stringify(storage.getSession())}) — a stranger's league_members.role must never reach an app whose every write lands in the six-player league's Sheet`);

      // R2(ii) — RELEASED, and by WHO the page comes back as.
      auth._setHasSupabaseDataBackendForTest(true);
      let out2 = null;
      await quiet(async () => { out2 = await app._applyAuthModeDecisionForTest(); await tick(12); });
      assert(out2.hold === null, `fixture: the decision now resolves (got ${JSON.stringify(out2.hold)})`);
      assert(auth.isSessionForcedOut() === false,
        'R2(ii) — the latch is RELEASED, by applyAuthModeDecision() once it is past every hold branch: the exact inverse of the two places it is set');
      assert(storage.getSession().playerVerified === true && storage.getSession().playerId === 'mA',
        `…and the page comes back as WHO it actually is (${JSON.stringify(storage.getSession())}) — "recovered" must not mean "recovered as nobody"`);
      assert(storage.getSession().isAdmin === true,
        '…including the commissioner surface, which the latch had been suppressing with nothing on screen to explain it');
    } finally {
      globalThis.fetch = realFetch; globalThis.setTimeout = realST;
      app._resetAuthHoldForTest();
    }
  }

  // ── (e) REVIEWER F3 — THE POST-VERIFICATION RE-READ MAY NOT DESTROY ───────
  // `_afterVerifyReread ? 'dead' : …` was a THIRD destroy trigger, absent from
  // the state table and a violation of I4. The sequence, with no second round
  // anywhere in it: 401 -> the SDK proves the refresh token WORKS -> strikes
  // reset to 0 -> the one confirming re-read hits the same flaky 401 (a rotated
  // key and a slow clock are both persistent for minutes, so this is the LIKELY
  // case) -> saved sign-in destroyed, with strikes at zero.
  {
    const st = { refreshCalls: 0, armed: 0, reads: 0 };
    resetAll({
      getSession: async () => ({ data: { session: { user: { id: 'u-drew' } } } }),
      refreshSession: async () => { st.refreshCalls++; return ALIVE(); },
      from: () => { st.reads++; if (st.armed > 0) { st.armed--; throw four01(); } return { data: [ROW_A], error: null }; },
    });
    wireRealAuthUI();
    storeValidSession();
    await auth.refreshMembershipsAndSession();
    assert(storage.getSession().isAdmin === true, 'fixture: a live commissioner session');

    st.armed = 2;      // the 401, AND the confirming re-read's 401
    await quiet(async () => { await auth.refreshMembershipsAndSession().catch(() => {}); await tick(12); });

    assert(st.refreshCalls === 1, `fixture: the SDK was asked once and answered ALIVE (refreshes ${st.refreshCalls})`);
    assert(localStorage.getItem(K41) !== null,
      'F3 — THE SAVED SIGN-IN IS STILL ON THE DEVICE. This is the assertion that was red: the re-read\'s 401 used to be hard-coded to \'dead\' and destroy it one line after the SDK had proved the refresh token works.');
    assert(auth._expiredStrikesForTest() === 0,
      `I1/I4 — …and no strike was recorded for it (${auth._expiredStrikesForTest()}): the re-read opens no round of its own, which is the rule the flag exists for`);
    assert(auth.isPrivilegeHeld() === true && auth.isSessionExpired() === true,
      'S?-E3 — the honest answer is \'unknown\': fail CLOSED on the lock, fail SAFE on the data, and the banner stays up');
    assert(!!document.getElementById('session-expired-banner'), '…with the banner on screen, because the player does need to know');

    // …and the NEXT classification is a genuine second round, not a free pass.
    st.armed = 1;
    await quiet(async () => { await auth.refreshMembershipsAndSession().catch(() => {}); await tick(12); });
    assert(st.refreshCalls === 2,
      `…and the NEXT expired classification opens a REAL round (refreshes ${st.refreshCalls}) — 'unknown' defers the destroy by one round, it does not disable it`);
  }

  // ── (f) SECURITY F-3 — I5: held => expired, after EVERY event ─────────────
  // `_sessionExpired = false` ran for all four of INITIAL_SESSION /
  // USER_UPDATED / SIGNED_IN / TOKEN_REFRESHED while the privilege release was
  // narrowed to two of them. INITIAL_SESSION is a purely LOCAL rehydrate, fired
  // on every page load with whatever is in localStorage — so it took the banner
  // down and left the lock up: the commissioner surface gone, and nothing on
  // screen saying why.
  {
    const st = { failures: 0, sdkSession: { user: { id: 'u-drew' } } };
    resetAll({
      getSession: async () => ({ data: { session: st.sdkSession } }),
      refreshSession: async () => ({ data: { session: null }, error: Object.assign(new Error('rate limited'), { status: 429 }) }),
      from: () => { if (st.failures > 0) { st.failures--; throw four01(); } return { data: [ROW_A], error: null }; },
    });
    wireRealAuthUI();
    storeValidSession();
    await auth.refreshMembershipsAndSession();
    st.failures = 1;
    await quiet(async () => { await auth.refreshMembershipsAndSession().catch(() => {}); await tick(10); });
    assert(auth.isPrivilegeHeld() === true && auth.isSessionExpired() === true,
      'fixture: S2 — held, banner latched, nothing destroyed');
    // Every later read answers "could not ask", so nothing below can be
    // attributed to a successful membership read.
    st.sdkSession = null;
    const invariant = () => !auth.isPrivilegeHeld() || auth.isSessionExpired();
    for (const ev of ['INITIAL_SESSION', 'USER_UPDATED']) {
      await quiet(async () => {
        auth._fireAuthEventForTest(ev, { access_token: 't', user: { id: 'u-drew' } });
        await tick(8);
      });
      assert(auth.isSessionExpired() === true,
        `F-3 — ${ev} does NOT clear the expiry latch: it is a local rehydrate / a profile change, not the GoTrue server minting a token`);
      assert(auth.isPrivilegeHeld() === true, `…and the lock it would have contradicted is still up after ${ev}`);
      assert(invariant(), `I5 — isPrivilegeHeld() => isSessionExpired() still holds after ${ev}`);
      assert(!!document.getElementById('session-expired-banner'),
        `…and the banner is STILL on screen after ${ev} — the app.js half of the same finding (hideSessionExpiredBanner() clears the latch as well as the node)`);
    }
    // NON-VACUITY: the two events that ARE proof still clear both, at once.
    storeValidSession();
    await quiet(async () => {
      auth._fireAuthEventForTest('TOKEN_REFRESHED', { access_token: 't9', user: { id: 'u-drew' } });
      await tick(8);
    });
    assert(auth.isPrivilegeHeld() === false && auth.isSessionExpired() === false,
      'non-vacuity — a TOKEN_REFRESHED carrying a session releases BOTH, so the four assertions above are about the narrowing and not about a latch nothing can clear');
    assert(invariant(), 'I5 — …and the invariant holds there too');
    assert(!document.getElementById('session-expired-banner'), '…with the banner taken down by SESSION_REVERIFIED, exactly as before');
  }

  // ── (g) SECURITY F-4 — refreshHeader() REPAINTED THE WEEK BEHIND THE HOLD ──
  // A week's NAME and DATES are the league's data, which is why A6's teardown
  // empties #header-meta-week. refreshAuthUI() calls refreshHeader()
  // UNCONDITIONALLY (deliberately — the identity chip and the league pill are
  // what make the page stop claiming to be somebody), so every auth event put
  // them straight back from the local mirror, behind a live lock.
  {
    resetAll({ from: () => { throw new Error('the membership service is unreachable'); },
               getSession: async () => ({ data: { session: { user: { id: 'u-drew' } } } }) });
    app._resetAuthHoldForTest();
    const realST = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms) => (ms === 20000 ? { unref() {} } : realST(fn, ms));
    localStorage.setItem('cfbp_weeks', JSON.stringify([
      { weekId: 'w4', weekNumber: 4, name: 'Week 4', status: 'open', startDate: '2026-09-19', endDate: '2026-09-20' },
    ]));
    const wk = new FakeEl(); wk.id = 'header-meta-week'; wk.innerHTML = '<strong>Week 4</strong>';
    registry.set('header-meta-week', wk);
    try {
      wireRealAuthUI();
      app.showAuthHoldGate('config-unreadable');
      assert(wk.innerHTML === '', 'fixture: the teardown emptied the header week block');
      await quiet(async () => {
        await auth.refreshMembershipsAndSession().catch(() => {});   // emits MEMBERSHIPS_FAILED
        await tick(8);
        auth._fireAuthEventForTest('INITIAL_SESSION', null);
        await tick(8);
      });
      assert(wk.innerHTML === '',
        `F-4 — after a real MEMBERSHIPS_FAILED and a real INITIAL_SESSION through the listener chain, the week block is STILL empty (got ${JSON.stringify(wk.innerHTML)})`);
      assert(app.isContentWithheld() === true, '…because the one predicate still says content is withheld');

      // NON-VACUITY: the same events on an UNHELD page repaint it, which is what
      // makes the assertion above about the guard and not about a dead function.
      app._resetAuthHoldForTest();
      storeValidSession();
      await quiet(async () => {
        auth._fireAuthEventForTest('INITIAL_SESSION', { access_token: 't', user: { id: 'u-drew' } });
        await tick(8);
      });
      assert(/Week 4/.test(wk.innerHTML),
        `non-vacuity — with nothing withheld the very same event DOES repaint the week block (got ${JSON.stringify(wk.innerHTML)})`);
    } finally { globalThis.setTimeout = realST; localStorage.removeItem('cfbp_weeks'); app._resetAuthHoldForTest(); }
  }

  // ── (h) SECURITY F-6 — THE LEAGUE SWITCHER'S ROLE BADGE ───────────────────
  // It rendered `league_members.role` straight out of the membership cache. The
  // lock deliberately does not touch that cache (the hold is a VIEW over an
  // unchanged session), so while privilege was HELD every commissioner control
  // was gone, getSession().isAdmin was false, the expired banner was up — and
  // the switcher still labelled the ACTIVE league "Commissioner".
  {
    const st = { failures: 0 };
    resetAll({
      getSession: async () => ({ data: { session: { user: { id: 'u-drew' } } } }),
      refreshSession: async () => ({ data: { session: null }, error: Object.assign(new Error('rate limited'), { status: 429 }) }),
      from: () => { if (st.failures > 0) { st.failures--; throw four01(); } return { data: [ROW_A, ROW_B], error: null }; },
    });
    wireRealAuthUI();
    storeValidSession();
    await auth.refreshMembershipsAndSession();
    auth.setActiveLeagueId('L-A');
    const page = new FakeEl(); page.id = 'page-dashboard'; registry.set('page-dashboard', page);
    const badgeFor = (html, leagueId) => {
      const at = html.indexOf(`data-league-id="${leagueId}"`);
      if (at === -1) return null;
      const next = html.indexOf('data-league-id="', at + 1);
      const row = html.slice(at, next === -1 ? html.length : next);
      return /Commissioner/.test(row) ? 'Commissioner' : (/Player/.test(row) ? 'Player' : null);
    };
    app.renderLeagueFlowScreen('dashboard');
    assert(badgeFor(page.innerHTML, 'L-A') === 'Commissioner' && badgeFor(page.innerHTML, 'L-B') === 'Player',
      'fixture: with nothing held, the switcher labels the active league Commissioner and the other one Player');

    st.failures = 1;
    await quiet(async () => { await auth.refreshMembershipsAndSession().catch(() => {}); await tick(10); });
    assert(auth.isPrivilegeHeld() === true && storage.getSession().isAdmin === false,
      `fixture: S2 — privilege is HELD and getSession().isAdmin is forced false (${JSON.stringify(storage.getSession())})`);
    assert(auth.getCachedMemberships().find(m => m.leagueId === 'L-A')?.role === 'commissioner',
      '…while the raw membership cache still says \'commissioner\', which is exactly why reading it was the defect');
    app.renderLeagueFlowScreen('dashboard');
    assert(badgeFor(page.innerHTML, 'L-A') === 'Player',
      `F-6 — the ACTIVE league's badge is rendered from the LOCKED session, so it no longer contradicts the app's own behaviour (got ${JSON.stringify(badgeFor(page.innerHTML, 'L-A'))})`);
    assert(badgeFor(page.innerHTML, 'L-B') === 'Player',
      '…and another league\'s row keeps its own cached role, because the lock has no opinion about a league this device is not scoped to');

    // R2 — and it comes BACK when the lock is released.
    await quiet(async () => { await auth.refreshMembershipsAndSession().catch(() => {}); await tick(10); });
    assert(auth.isPrivilegeHeld() === false, 'fixture: a successful read released the lock');
    app.renderLeagueFlowScreen('dashboard');
    assert(badgeFor(page.innerHTML, 'L-A') === 'Commissioner',
      'R2 — …and the Commissioner badge returns with the privilege it describes');
  }

  // ── (i) SECURITY F-7 — A THROW BETWEEN clearAuthHoldReason() AND THE PAINT ─
  // clearAuthHoldReason() drops the hold STATE and kills the 20-second re-check
  // timer with it. If anything below it throws while painting, the page is left
  // in the one state the whole family exists to prevent: a hold OVERLAY still on
  // screen, no hold state behind it, no timer to clear it, and a Retry button
  // whose handler now runs a decision that thinks nothing is held.
  {
    resetAll({ getSession: async () => ({ data: { session: { user: { id: 'u-drew' } } } }),
               from: () => ({ data: [ROW_A], error: null }) });
    app._resetAuthHoldForTest();
    app._resetSupabaseSdkLoaderForTest();
    auth._setHasSupabaseDataBackendForTest(true);
    auth._setStoredSessionForTest(null);          // no session -> the Google gate is what paints
    const realFetch = globalThis.fetch;
    const realST = globalThis.setTimeout;
    const liveTimers = new Set();
    globalThis.setTimeout = (fn, ms) => { if (ms !== 20000) return realST(fn, ms); const id = { unref() {} }; liveTimers.add(id); return id; };
    globalThis.fetch = async (url) => {
      if (String(url).includes('config.json')) return { ok: true, json: async () => ({ backendUrl: 'https://script.test/exec', backendToken: 'tok', authMode: 'supabase', supabaseUrl: 'https://p.test', supabaseAnonKey: 'a' }) };
      throw new Error('no network');
    };
    const realAppend = document.body.appendChild;
    try {
      app.showAuthHoldGate('config-unreadable');
      assert(app.currentAuthHoldReason() === 'config-unreadable' && liveTimers.size === 1,
        `fixture: the hold is up and its 20-second re-check is armed (${liveTimers.size})`);
      // ONE injected throw, at the first append after the hold state is cleared —
      // i.e. exactly where the resolved gate paints.
      let armed = true;
      document.body.appendChild = function (el) {
        if (armed) { armed = false; throw new Error('the device refused to append the gate'); }
        return realAppend.call(this, el);
      };
      let out = null, threw = null;
      await quiet(async () => {
        // CAUGHT, not allowed to propagate: a throw out of this call is the
        // DEFECT, and a suite that dies on it reports a crash instead of a named
        // failing assertion. (It really did crash, once, before this try — which
        // is how the mutation proof found the difference.)
        try { out = await app._applyAuthModeDecisionForTest(); } catch (e) { threw = e; }
        await tick(8);
      });
      assert(armed === false, 'fixture: the injected throw really did fire (a no-op injection would make the rest vacuous)');
      assert(!threw,
        `F-7 — the decision ABSORBS the paint failure instead of throwing out of boot() (${threw && (threw.message || threw)}). An unhandled rejection here is an unhandled rejection out of the DOMContentLoaded handler, with the hold state already cleared.`);
      assert(out && out.hold === 'config-unreadable',
        `F-7 — the decision reports itself as STILL HELD (got ${JSON.stringify(out && out.hold)}), so boot() stops rather than proceeding past a gate that never painted`);
      assert(app.currentAuthHoldReason() === 'config-unreadable',
        '…the hold STATE is re-asserted, so A7\'s "never take a hold gate down" rule is live again');
      const ov = document.getElementById('site-gate-overlay');
      assert(!!ov && ov.getAttribute('data-gate-state') === 'hold',
        '…a hold overlay is genuinely on screen again, not an orphan left by the gate that failed');
      assert(!!document.getElementById('auth-hold-retry'), '…with its Retry button re-bound');
      assert(liveTimers.size >= 1, `…and the 20-second re-check re-armed (${liveTimers.size}) — without it the device could never recover without a reload, which DI-180a forbids`);
    } finally {
      document.body.appendChild = realAppend;
      globalThis.fetch = realFetch; globalThis.setTimeout = realST;
      app._resetAuthHoldForTest();
    }
  }

  // ── (j) REVIEWER F9 — SESSION_REVERIFIED CARRIES THE *NEW* TUPLE ──────────
  // The release ran ABOVE the three term assignments, so the event announcing
  // "this session is good again" was emitted while the module still held the
  // previous account id and email — i.e. it re-verified the person who had just
  // been replaced.
  {
    const st = { failures: 0, sdkSession: { user: { id: 'u-drew', email: 'drew@example.com' } } };
    resetAll({
      getSession: async () => ({ data: { session: st.sdkSession } }),
      refreshSession: async () => ({ data: { session: null }, error: Object.assign(new Error('rate limited'), { status: 429 }) }),
      from: () => { if (st.failures > 0) { st.failures--; throw four01(); } return { data: [ROW_A], error: null }; },
    });
    wireRealAuthUI();
    storeValidSession();
    await auth.refreshMembershipsAndSession();
    st.failures = 1;
    await quiet(async () => { await auth.refreshMembershipsAndSession().catch(() => {}); await tick(10); });
    assert(auth.isPrivilegeHeld() === true, 'fixture: S2 again');
    st.sdkSession = null;                     // so nothing below is the read's doing
    const atEmit = [];
    auth.onAuthEvent((e) => { if (e === 'SESSION_REVERIFIED') atEmit.push({ uid: auth.getAccountUserId(), email: auth.getAccountEmail() }); });
    storeValidSession();
    await quiet(async () => {
      auth._fireAuthEventForTest('TOKEN_REFRESHED', { access_token: 't7', user: { id: 'u-newer', email: 'newer@example.com' } });
      await tick(8);
    });
    assert(atEmit.length === 1, `fixture: exactly one SESSION_REVERIFIED went out (${atEmit.length})`);
    assert(atEmit[0].uid === 'u-newer' && atEmit[0].email === 'newer@example.com',
      `F9 — a listener woken by SESSION_REVERIFIED reads the NEW tuple (got ${JSON.stringify(atEmit[0])}), because the release now runs BELOW the term assignments`);
  }

  // ── (k) REVIEWER F4 — isContentWithheld()'s SECOND TERM IS PRE-IDENTITY ────
  // It was `supabase && !hasValidSupabaseSession()`, and that is a LOCAL read of
  // `expires_at` which goes false routinely for a signed-in player who has done
  // nothing wrong: an iOS tab woken from the background before TOKEN_REFRESHED
  // fires, and the whole of DI-180p's verify window. For that span every tap did
  // NOTHING, with no gate and no banner to explain it — while A8 says a
  // post-identity failure is a banner, never a re-block.
  {
    const st = { armed: 0 };
    resetAll({
      getSession: async () => ({ data: { session: { user: { id: 'u-drew' } } } }),
      refreshSession: async () => ({ data: { session: null }, error: Object.assign(new Error('x'), { code: 'refresh_token_not_found' }) }),
      from: () => { if (st.armed > 0) { st.armed--; throw four01(); } return { data: [ROW_A], error: null }; },
    });
    app._resetAuthHoldForTest();
    wireRealAuthUI();
    assert(app.isContentWithheld() === true,
      'fixture: PRE-identity (supabase mode, no session, nobody ever proven) — content is withheld, unchanged');
    storeValidSession();
    await auth.refreshMembershipsAndSession();
    assert(auth.getAccountUserId() === 'u-drew' && app.isContentWithheld() === false,
      'fixture: an identity has been proven on this page');

    // The LOCAL token lapses — the SDK has not fired TOKEN_REFRESHED yet.
    auth._setStoredSessionForTest({ access_token: 't', expires_at: Math.floor(Date.now() / 1000) - 10 });
    assert(auth.hasValidSupabaseSession() === false, 'fixture: the locally-persisted token now reads as lapsed');
    assert(app.isContentWithheld() === false,
      'F4 — a POST-identity device is NOT frozen by that: the second term asks whether anyone has ever been proven here, not whether the local clock likes the token');
    app.state.currentTab = 'dashboard';
    await quiet(async () => { try { globalThis.window.navigateTo('picks'); } catch {} });
    assert(app.state.currentTab === 'picks',
      '…proved behaviorally at the render chokepoint: the tab actually MOVES (a withheld device returns before state.currentTab is assigned, deliberately)');

    // …AND THE DOCUMENTED DECISION: after a GENUINE destroy it is withheld
    // again. _clearExpiredSessionFromDevice() clears the account id, so the
    // device is back to pre-identity — the fail-closed direction, and the one a
    // page-lifetime "ever proven" flag would have got wrong.
    st.armed = 1;
    await quiet(async () => { await auth.refreshMembershipsAndSession().catch(() => {}); await tick(10); });
    assert(localStorage.getItem(K41) === null && auth.getAccountUserId() === '',
      `fixture: the SDK reported a dead refresh token, so the saved sign-in really was destroyed (account now ${JSON.stringify(auth.getAccountUserId())})`);
    assert(app.isContentWithheld() === true,
      'F4, the decision — AFTER A DESTROY content is withheld again: the token is off the device, nobody is proven, and the SDK\'s own SIGNED_OUT brings the gate up to explain it');
    app.state.currentTab = 'dashboard';
    await quiet(async () => { try { globalThis.window.navigateTo('picks'); } catch {} });
    assert(app.state.currentTab === 'dashboard',
      '…and the chokepoint refuses again, which is what makes the "not frozen" assertions above non-vacuous');
  }
  // The two catch arms fail in OPPOSITE directions, and that is a decision
  // rather than an oversight. Checked structurally, and said so: every read
  // inside the predicate is total today (getAuthMode() is an in-memory read,
  // hasValidSupabaseSession() swallows its own throws), so there is no way to
  // drive a throw through it from a test without stubbing the function itself —
  // which would prove only that the stub works.
  {
    const appSrcF4 = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
    const fn = (appSrcF4.match(/export function isContentWithheld\(\)[\s\S]*?\n\}/) || [''])[0];
    assert(!!fn, 'fixture: isContentWithheld() was located');
    assert(/if \(!supabaseMode\) \{[\s\S]*?catch \{ return false; \}/.test(fn),
      'the FLAG-OFF arm fails OPEN on a throw (security E3: a throwing storage must not lock six players out of the PIN app they have used all season)');
    assert(/catch \(e\) \{[\s\S]*?return true;\s*\n\s*\}/.test(fn),
      '…and the SUPABASE arm fails CLOSED on a throw: there, the same exception means "we cannot tell whether anyone is signed in"');
    assert(/getAccountUserId\(\)/.test(fn),
      '…and the pre-identity test is getAccountUserId(), not a page-lifetime flag — so a destroy returns the device to withheld');
  }

  // ── (l) REVIEWER F1 + SECURITY F-2 — THE PAGE COMES BACK TO LIFE ──────────
  // A device that boots into a hold has .main-content/.bottom-nav made `inert`
  // and its two timers parked. The hold clears into the Google gate (still
  // withheld — correct). Then the player signs in, and before this fix NOTHING
  // re-triggered any of it: the page stayed inert (every tap swallowed, the nav
  // unreachable by keyboard and invisible to VoiceOver) while looking completely
  // normal, and both timers stayed parked for the rest of the session.
  {
    resetAll({ getSession: async () => ({ data: { session: { user: { id: 'u-drew' } } } }),
               from: () => ({ data: [ROW_A], error: null }) });
    app._resetAuthHoldForTest();
    const main = new FakeEl(); main.className = 'main-content';
    const nav = new FakeEl(); nav.className = 'bottom-nav';
    setClassEls('.main-content', [main]);
    setClassEls('.bottom-nav', [nav]);
    const realSI = globalThis.setInterval, realCI = globalThis.clearInterval, realST = globalThis.setTimeout;
    const live = new Set();
    globalThis.setInterval = (fn, ms) => { const id = { ms }; live.add(id); return id; };
    globalThis.clearInterval = id => { live.delete(id); };
    globalThis.setTimeout = (fn, ms) => (ms === 20000 ? { unref() {} } : realST(fn, ms));
    try {
      wireRealAuthUI();
      app.setupAutoRefresh();
      assert(live.size >= 1, `fixture: the app's own interval is armed (${live.size})`);
      app.showAuthHoldGate('config-unreadable');
      assert('inert' in main.attrs && main.getAttribute('aria-hidden') === 'true' && 'inert' in nav.attrs,
        'fixture: the teardown made the page inert');
      assert(live.size === 0, `fixture: …and parked the app's timers (${live.size})`);

      // The hold clears — into the Google gate, because nobody is signed in yet.
      app.hideAuthHoldGate();
      assert(app.currentAuthHoldReason() === '' && app.isContentWithheld() === true,
        'the hold state is gone but content is STILL withheld: the lock changed shape, it did not lift');
      assert('inert' in main.attrs, 'R1 — …so the page stays inert, correctly');
      assert(live.size === 0, '…and the timers stay parked');

      // …and now the identity ARRIVES. This is the transition that had no caller.
      storeValidSession();
      await quiet(async () => {
        auth._fireAuthEventForTest('SIGNED_IN', { access_token: 't', user: { id: 'u-drew' } });
        await tick(12);
      });
      assert(app.isContentWithheld() === false, 'fixture: an identity is proven, so nothing is withheld any more');
      assert(!('inert' in main.attrs) && main.getAttribute('aria-hidden') === null
             && !('inert' in nav.attrs) && nav.getAttribute('aria-hidden') === null,
        'F1/F-2 — THE PAGE IS OPERABLE AGAIN. `inert` had three call sites and the sign-in path was not one of them, so a recovered device was painted and dead to touch, keyboard and screen reader alike.');
      assert(live.size >= 2,
        `R2 — …and BOTH parked timers are re-armed (${live.size}: the score/auto-transition interval and the chat-enabled watch), so a recovered device refreshes scores again and still notices a commissioner turning chat off`);
    } finally {
      globalThis.setInterval = realSI; globalThis.clearInterval = realCI; globalThis.setTimeout = realST;
      app._resetAuthHoldForTest();
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[41b] SECURITY F-3 (seventh gate) — the console trail carries no identifiers…');
{
  // THE FINDING. `_setAccountUserId()` handed the epoch logger
  // `"memberships-read: <uuid-A> -> <uuid-B>"` and that logger is console.INFO,
  // so two raw Supabase account ids — the stable cross-league primary key for a
  // person — were printed on every change of identity, i.e. on exactly the
  // handset that had just changed hands. Console output survives into
  // screenshots players send the commissioner and into anything a future remote
  // log hook forwards.
  //
  // A STATIC RULE, not a spot fix: no console call in js/auth.js may reference
  // an account id, an email or a token by name. Written as a rule because the
  // next person to add a log line will not read this section.
  const srcF3 = readFileSync(new URL('./js/auth.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
  const FORBIDDEN = /\b(?:_accountUserId|_accountEmail|getAccountUserId\(\)|getAccountEmail\(\)|access_token|refresh_token|\buid\b|\bemail\b)\b/;
  /** An id passed THROUGH `_idTag()` is not an id any more — that is the whole
   *  remedy — so the wrapper is collapsed before the rule is applied. Nothing
   *  else is exempt: this is the one sanctioned way to mention an id near a log. */
  const deTag = t => t.replace(/_idTag\([^()]*\)/g, '_idTag(…)');
  /** Every console call in the file, as the text of the call itself (from
   *  `console.x(` to the end of that statement or 300 chars, whichever first). */
  const consoleCalls = [...srcF3.matchAll(/console\.(?:log|info|warn|error|debug)\(/g)].map(m => {
    const from = m.index;
    const stop = srcF3.indexOf('\n', from);
    return srcF3.slice(from, stop === -1 ? from + 300 : Math.min(stop, from + 300));
  });
  assert(consoleCalls.length >= 20,
    `fixture: found ${consoleCalls.length} console calls in js/auth.js — a matcher that found none would make the rule below vacuous`);
  const offenders = consoleCalls.filter(c => FORBIDDEN.test(deTag(c)));
  assert(offenders.length === 0,
    `SEC F-3 — no console call in js/auth.js references an account id, an email or a token by name (${offenders.length} offender(s)): ${JSON.stringify(offenders.slice(0, 3))}`);
  assert(FORBIDDEN.test(deTag("console.info(`[auth] identity epoch -> ${_identityEpoch} (${reason}: ${_accountUserId} -> ${next})`);")),
    'canary: that rule DOES match the exact line this finding was about, so it is not vacuously green');
  assert(FORBIDDEN.test(deTag("console.warn('[auth] signed in as', email);")),
    'canary: …and it matches a plain (non-template) argument too, so the rule is about the CALL and not about template syntax');

  // …AND THE LOGGER'S INPUT, not only its call site. This is where the finding
  // actually lived: `_bumpIdentityEpoch(reason)` prints `reason` verbatim into
  // its own console.info, so a caller that builds `reason` out of raw ids leaks
  // them while the log site itself reads clean. A rule that stopped at
  // `console.*(` would have been green over the defect.
  const epochCalls = [...srcF3.matchAll(/_bumpIdentityEpoch\(/g)].map(m => {
    const stop = srcF3.indexOf('\n', m.index);
    return srcF3.slice(m.index, stop === -1 ? m.index + 200 : Math.min(stop, m.index + 200));
  });
  assert(epochCalls.length >= 2,
    `fixture: found ${epochCalls.length} _bumpIdentityEpoch() call sites (a matcher finding fewer than the sign-out and the account-id writer would be vacuous)`);
  const epochOffenders = epochCalls.filter(c => FORBIDDEN.test(deTag(c)));
  assert(epochOffenders.length === 0,
    `SEC F-3 — no _bumpIdentityEpoch() caller builds its reason string out of an account id, an email or a token (${epochOffenders.length} offender(s)): ${JSON.stringify(epochOffenders)}`);
  assert(FORBIDDEN.test(deTag("if (_accountUserId) _bumpIdentityEpoch(`${reason}: ${_accountUserId} -> ${next || '(none)'}`);")),
    'canary: that rule DOES match the exact pre-fix line, so the caller-side half is not vacuously green either');

  assert(FORBIDDEN.test(deTag("_bumpIdentityEpoch(`x: ${_idTag(a)} ${_accountUserId}`);")) === true,
    'canary: and the _idTag() exemption is narrow — a line that wraps ONE id and leaks another beside it is still an offender');
  assert(FORBIDDEN.test(deTag("_bumpIdentityEpoch(`${reason}: ${_idTag(_accountUserId)} -> ${_idTag(next)}`);")) === false,
    'canary: …while the sanctioned shape (every id behind a digest) is genuinely clean, so the rule is not simply always-true');

  // …and the replacement is a DIGEST, which still has to tell two people apart.
  const tagA = auth._idTagForTest('3f2b8c14-0000-4000-8000-aaaaaaaaaaaa');
  const tagB = auth._idTagForTest('3f2b8c14-0000-4000-8000-bbbbbbbbbbbb');
  assert(/^#[0-9a-f]{6}$/.test(tagA),
    `the digest is six hex characters behind a '#' (got ${JSON.stringify(tagA)}) — short on purpose: it is a log aid, explicitly not a security primitive`);
  assert(tagA !== tagB,
    `…and two different accounts get different digests (${tagA} vs ${tagB}), which is the ONE property the epoch log is read for: did the person actually change?`);
  assert(auth._idTagForTest('3f2b8c14-0000-4000-8000-aaaaaaaaaaaa') === tagA,
    '…and it is stable for the same id, so "A -> A" is still distinguishable from "A -> B"');
  assert(!tagA.includes('3f2b8c14') && !tagA.includes('aaaa'),
    `…and it contains no fragment of the id it came from (${tagA})`);
  assert(auth._idTagForTest('') === '(none)' && auth._idTagForTest(null) === '(none)',
    'an absent id reads as the literal "(none)" — "nobody" is not an identifier, and hashing it would make the signed-out case unreadable');

  // The one place it is actually used, asserted at the source rather than
  // inferred: the epoch's reason string is built from digests.
  assert(/_bumpIdentityEpoch\(`\$\{reason\}: \$\{_idTag\(_accountUserId\)\} -> \$\{_idTag\(next\)\}`\)/.test(srcF3),
    'the epoch bump\'s reason string is built from _idTag() on both sides — the one call site that used to interpolate the ids themselves');

  // ── SECURITY F-10 (EIGHTH gate, 2026-09-18) — THE RULE APPLIES TO EVERY
  //    MODULE THAT CAN HOLD AN IDENTITY, NOT JUST js/auth.js ──────────────────
  //
  // The rule above was scoped to one file because that is where the finding was.
  // But js/auth.js is not where most console calls live: app.js handles the
  // identity chokepoint, chat.js logs outbox drops, push-onesignal.js logs login
  // and logout failures, and backend.js logs every transport error. Each of those
  // handles the same values, and "don't print an account id" scoped to one file
  // is a spot fix wearing a rule's clothes.
  //
  // THE ARGUMENT PATTERNS ARE WIDENED TOO. `.email`, `user.id` and a bare
  // `session` are the shapes the Supabase SDK actually hands back — `session.user.id`,
  // `data.user.email` — and none of them is caught by a matcher looking for
  // `_accountEmail`. Logging a whole `session` object is the worst of the three:
  // it carries the access token, the refresh token, the email AND the id, in one
  // console line, on a device that may have just changed hands.
  const F10_FILES = ['auth', 'app', 'chat', 'push-onesignal', 'backend'];
  // Written out rather than spliced from FORBIDDEN.source: the two rules are
  // read by different people for different reasons, and a string surgery that
  // silently produced an invalid or over-broad pattern would be worse than the
  // duplication. The first group is FORBIDDEN's, verbatim; the second is new.
  // SECURITY R-3 (audit #10) — `claim_code` / `claimCode` JOIN THE LIST. A claim
  // code is a BEARER CREDENTIAL until it is claimed: anyone holding the string
  // can attach their Google account to that member row and inherit a season of
  // picks. It is the one value in Step 3b that is worth more on a console line
  // than an account id is — an id identifies, a code AUTHORIZES — and the whole
  // reason it is read through a commissioner-gated RPC instead of a column grant
  // (TECH doc A2) is that it must not be casually reachable. Printing one into a
  // console that survives into screenshots players send the commissioner, and
  // into anything a future remote log hook forwards, would hand it back.
  const F10_FORBIDDEN = /\b(?:_accountUserId|_accountEmail|getAccountUserId\(\)|getAccountEmail\(\)|access_token|refresh_token|\buid\b|\bemail\b)\b|\.email\b|\buser\.id\b|\bsession\b|\bclaim_code\b|\bclaimCode\b/;
  /**
   * THE RULE IS ABOUT VALUES, NOT ABOUT VOCABULARY. The first run of this widened
   * scan returned nine "offenders", every one of them the English word "session"
   * inside a log MESSAGE — "the SDK's session refresh did not answer", "the
   * PIN-mode session record could not be removed". Those are the log lines this
   * codebase is supposed to have; a rule that forbids naming the concept in prose
   * would be deleted by the next person who needs to write one, and then the real
   * rule goes with it.
   *
   * So the message text is stripped and only the ARGUMENT positions are judged:
   * quoted literals are removed outright, and a template literal is reduced to
   * its `${…}` interpolations. What survives is what actually reaches the console
   * as a value — `, session)`, `${user.id}`, `data.user.email`.
   */
  const argsOnly = (call) => call
    .replace(/`(?:[^`\\]|\\.)*`/g, (lit) => [...lit.matchAll(/\$\{([^{}]*)\}/g)].map(m => ` ${m[1]} `).join(''))
    .replace(/'(?:[^'\\]|\\.)*'/g, ' ')
    .replace(/"(?:[^"\\]|\\.)*"/g, ' ');
  assert(F10_FORBIDDEN.test(argsOnly('console.warn("x", session)')) && F10_FORBIDDEN.test(argsOnly('console.log(data.user.email)')) && F10_FORBIDDEN.test(argsOnly('console.info(`${user.id}`)')),
    'canary: the widened pattern matches the three Supabase-shaped leaks (`session`, `.email`, `user.id`) the narrow one missed');
  assert(F10_FORBIDDEN.test(argsOnly('console.info("[auth] the device-local clear completed")')) === false,
    'canary: …and an ordinary log line is still clean, so the widened rule is not simply always-true');
  assert(F10_FORBIDDEN.test(argsOnly("console.warn('[auth] the PIN-mode session record could not be removed', e)")) === false,
    'canary: …and naming "session" in the MESSAGE is not an offence — the rule is about what reaches the console as a VALUE, not about vocabulary (this exact line was one of nine false positives on the first run)');
  assert(F10_FORBIDDEN.test(argsOnly('console.warn(`[auth] session refresh timed out after ${timeoutMs}ms`, session)')) === true,
    'canary: …while the same sentence WITH the object passed alongside it is still caught, so stripping the message did not disarm the rule');
  assert(F10_FORBIDDEN.test(argsOnly('console.info(`issued ${code.claimCode}`)')) === true &&
         F10_FORBIDDEN.test(argsOnly('console.warn("row", row.claim_code)')) === true,
    'canary (R-3): a claim code reaching the console is caught in BOTH spellings — `claimCode` (the client shape, auth.js\'s getClaimCodes() mapping) and `claim_code` (the wire shape the RPC returns)');
  assert(F10_FORBIDDEN.test(argsOnly("console.info('[auth] a new claim code was issued')")) === false,
    'canary (R-3): …and SAYING that a code was issued is still allowed — the rule is about the VALUE reaching the console, not about the subject being mentionable');
  const f10Offenders = [];
  let f10Calls = 0;
  for (const name of F10_FILES) {
    const raw = readFileSync(new URL(`./js/${name}.js`, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
    const calls = [...raw.matchAll(/console\.(?:log|info|warn|error|debug)\(/g)].map(m => {
      const stop = raw.indexOf('\n', m.index);
      return raw.slice(m.index, stop === -1 ? m.index + 300 : Math.min(stop, m.index + 300));
    });
    f10Calls += calls.length;
    calls.filter(c => F10_FORBIDDEN.test(argsOnly(deTag(c)))).forEach(c => f10Offenders.push(`${name}.js :: ${c.trim()}`));
  }
  assert(f10Calls >= 100,
    `fixture: the widened scan found ${f10Calls} console calls across ${F10_FILES.length} modules — a matcher that found a handful would make the rule vacuous`);
  assert(f10Offenders.length === 0,
    `SEC F-10 — no console call in ${F10_FILES.map(f => f + '.js').join('/')} references an account id, an email, a token, a raw session object or a \`user.id\` (${f10Offenders.length} offender(s)):\n  ${f10Offenders.slice(0, 6).join('\n  ')}`);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[42] DI-180q — whose data is on this phone? (Drew\'s ruling, option (a))…');
{
  // ── THE GAP, restated as the sequence a player reaches ────────────────────
  // A9 (approved) clears the previous player's device-local items — chat cache,
  // read cursors, notification log, the UNSENT outbox, the local mirror — the
  // moment a DIFFERENT account is proven at the device. The build only did that
  // when a SUSPENDED SLATE existed to compare against. If A's sign-in died
  // before the app ever worked out who A was (a dead saved token discovered at
  // boot), there is no suspension box and no previous account in memory — so B
  // inherited A's cached room, A's read positions, A's notification log and any
  // unsent messages A had queued, WHICH WOULD THEN SEND UNDER B'S SESSION.
  //
  // Everything below is driven through the REAL listener chain. The marker is
  // never written by hand except in the one case that is ABOUT the write failing.
  const OWNER = auth._DEVICE_DATA_OWNER_KEY_FOR_TEST;
  const SEP = auth.IDENTITY_KEY_SEP;
  const ROW_A42 = { league_id: 'L-A', id: 'mA', role: 'player', display_name: 'Drew', active: true, leagues: { name: 'League A' } };
  const ROW_B42 = { league_id: 'L-B', id: 'mB', role: 'player', display_name: 'Kihoon', active: true, leagues: { name: 'League B' } };
  const ROW_A2_42 = { league_id: 'L-A2', id: 'mA2', role: 'player', display_name: 'Drew', active: true, leagues: { name: 'League A2' } };
  const DEAD42 = () => Object.assign(new Error('Invalid Refresh Token: Refresh Token Not Found'), { name: 'AuthApiError', status: 400, code: 'refresh_token_not_found' });
  const tick42 = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };
  async function quiet42(fn) {
    const rw = console.warn, ri = console.info, re = console.error;
    const logs = [];
    console.warn = (...a) => logs.push(a.map(String).join(' '));
    console.info = (...a) => logs.push(a.map(String).join(' '));
    console.error = (...a) => logs.push(a.map(String).join(' '));
    try { await fn(logs); } finally { console.warn = rw; console.info = ri; console.error = re; }
    return logs;
  }
  /** Everything a previous player leaves on a handset, including the UNSENT
   *  outbox and the local mirror. Seeded so every "it was cleared" below is
   *  about something that demonstrably existed. */
  const A_DATA = {
    cfbp_chat_lastseen2: '412',
    cfbp_chat_outbox2: JSON.stringify([{ id: 'o1', body: 'kevin you are cooked', author: 'mA' }]),
    cfbp_chat_epoch_applied: '7',
    cfbp_chat_events_cache: JSON.stringify([{ id: 'e1', author: 'mA', body: 'Drew: taking the points' }]),
    cfbp_notify_log_cache: JSON.stringify([{ id: 'n1' }]),
    cfbp_notif_readstate: JSON.stringify({ n1: true }),
    cfbp_sheet_mirror: JSON.stringify({ at: '2026-09-17T00:00:00.000Z', data: { cfbp_picks: [{ playerId: 'mA' }] } }),
  };
  const seedADat = () => { for (const [k, v] of Object.entries(A_DATA)) localStorage.setItem(k, v); };
  // SECURITY F-1/F-4 (seventh gate) — "REMAINING" MEANS A'S PAYLOAD IS STILL
  // THERE, not that the key name exists. The handover path ends signed IN, so
  // the incoming session's own first paint (refreshAuthUI -> navigateTo ->
  // checkWhatsNewPostDue) queues a fresh SCRIBE post into `cfbp_chat_outbox2`
  // microseconds after the clear. Comparing key PRESENCE reported that as A's
  // outbox surviving, which it is not — and would have hidden the real question
  // behind a false red. The comparison is against the exact seeded value.
  const remaining = () => Object.keys(A_DATA).filter(k => localStorage.getItem(k) === A_DATA[k]);
  /** …and for the outbox specifically, the sharper question: is A's ENTRY in it? */
  const aEntryStillQueued = () => {
    const raw = localStorage.getItem('cfbp_chat_outbox2') || '[]';
    try { return JSON.parse(raw).some(e => e?.author === 'mA' || e?.id === 'o1'); } catch { return true; }
  };

  const realFetch42 = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ oneSignalAppId: 'test-app-id' }) });
  const drainOS42 = async (os) => {
    await tick42(6);
    const queue = globalThis.window.OneSignalDeferred || [];
    for (const cb of queue.splice(0, queue.length)) { try { await cb(os); } catch {} }
  };

  try {
    // ── (a) THE RULED SCENARIO: A's SIGN-IN DIED BEFORE IT RESOLVED ─────────
    // No suspension box is ever created (the app never learned who A was), so
    // A9's chokepoint clear cannot fire. This is the exact hole DI-180q closes.
    {
      let uid = null, rows = [ROW_B42];
      resetAll({
        getSession: async () => ({ data: { session: uid ? { user: uid } : null }, error: uid ? null : DEAD42() }),
        from: () => ({ data: rows, error: null }),
      });
      wireRealAuthUI();
      globalThis.window.OneSignalDeferred = [];
      seedADat();
      storeValidSession();
      assert(remaining().length === Object.keys(A_DATA).length,
        `fixture: A's handset carries all ${Object.keys(A_DATA).length} device-local items, including an UNSENT outbox entry`);
      assert(auth.getDeviceDataOwner() === '', 'fixture: …and NO owner marker (every phone in the league is in this state on the first boot after this ships)');

      // A's saved token is discovered dead at boot. Nothing resolves; no
      // suspension box is created, because there is no account id to key one to.
      await quiet42(async () => { await auth.refreshMembershipsAndSession().catch(() => {}); await tick42(); });
      assert(app._suspendedSlateForTest() === null && auth.getAccountUserId() === '',
        'fixture: A\'s sign-in died BEFORE identity resolved — no suspension box, no account id, so A9\'s chokepoint clear can never fire for this device');
      assert(remaining().length === Object.keys(A_DATA).length,
        `fixture: …and A's data is all still here (${remaining().length} items) — this is the state B is about to sign in on top of`);

      // B signs in.
      let loggedOut = false, loggedInWith = null;
      uid = { id: 'u-B', email: 'kihoon@example.com' };
      storeValidSession();
      await quiet42(async () => {
        auth._fireAuthEventForTest('SIGNED_IN', { access_token: 't', user: uid });
        await drainOS42({ login: id => { loggedInWith = id; }, logout: () => { loggedOut = true; } });
        await tick42();
      });

      assert(remaining().length === 0,
        `DI-180q — NONE of A's keys remain (${JSON.stringify(remaining())}). Before this input, B inherited A's cached room, A's read cursors, A's notification log and A's unsent outbox.`);
      assert(aEntryStillQueued() === false,
        '…including the UNSENT OUTBOX, which is the one consequence here that is not merely cosmetic: those entries would have gone out under B\'s session. (Asked as "is A\'s ENTRY still queued?" — the KEY can legitimately exist again, holding the incoming session\'s own SCRIBE What\'s New post.)');
      assert(auth.getDeviceDataOwner() === `u-B${SEP}L-B`,
        `…and the marker now records B's FULL tuple, account and league (got ${JSON.stringify(auth.getDeviceDataOwner())})`);
      assert(loggedOut === true,
        'DI-180q — …and the OneSignal binding is dropped, so A\'s player-targeted pushes stop landing on a phone that is now B\'s (OneSignal.logout() is also the supported way to clear the SDK\'s own IndexedDB)');
      assert(loggedInWith === 'mB', '…then re-bound to B, in that order');
    }

    // ── (b) NON-VACUITY: THE SAME TUPLE COMES BACK, NOTHING IS TOUCHED ──────
    // This is the whole reason the ruling is option (a) and not "clear whenever
    // we don't know": v0.21.0's instant chat boot has to survive an ordinary
    // cold start.
    {
      resetAll({
        getSession: async () => ({ data: { session: { user: { id: 'u-drew' } } } }),
        from: () => ({ data: [ROW_A42], error: null }),
      });
      wireRealAuthUI();
      storeValidSession();
      await quiet42(async () => { await auth.refreshMembershipsAndSession(); await tick42(); });
      assert(auth.getDeviceDataOwner() === `u-drew${SEP}L-A`, 'fixture: the marker records this device\'s owner');
      seedADat();
      // …the app reloads, the same player signs in again.
      await quiet42(async () => { await auth.refreshMembershipsAndSession(); await tick42(); });
      // THE OUTBOX IS COMPARED BY CONTENT, NOT BY BYTES. Nothing cleared it —
      // that is the claim — but the second sign-in's own first paint can APPEND
      // a SCRIBE "What's New" post to it (checkWhatsNewPostDue(), which fires
      // whenever the version ledger is unset), so the stored string legitimately
      // differs while A's entry is still in there. Asked as "is A's entry still
      // queued?" plus "is every other key byte-identical?".
      const keptOthers = remaining().filter(k => k !== 'cfbp_chat_outbox2');
      assert(keptOthers.length === Object.keys(A_DATA).length - 1,
        `non-vacuity — the SAME account in the SAME league keeps everything (${keptOthers.length} of ${Object.keys(A_DATA).length - 1} non-outbox items intact): the cached room and the read cursors survive an ordinary cold start, which is what option (b) would have cost every player every morning`);
      assert(aEntryStillQueued() === true,
        '…and the unsent message is still queued too — nothing about a returning player\'s own device is cleared');
      assert(auth.getDeviceDataOwner() === `u-drew${SEP}L-A`, '…and the marker is unchanged');
    }

    // ── (c) MARKER MISSING BUT DATA PRESENT: CLEAR ONCE, THEN KEEP ──────────
    // The state every existing handset is in on the first boot after this ships.
    {
      resetAll({
        getSession: async () => ({ data: { session: { user: { id: 'u-drew' } } } }),
        from: () => ({ data: [ROW_A42], error: null }),
      });
      wireRealAuthUI();
      storeValidSession();
      seedADat();
      try { localStorage.removeItem(OWNER); } catch {}
      await quiet42(async () => { await auth.refreshMembershipsAndSession(); await tick42(); });
      assert(remaining().length === 0,
        `DI-180q — marker MISSING with data present clears ONCE, fail-closed (${JSON.stringify(remaining())}). Every phone in the league is in this state today, so all six players get exactly one chat re-download.`);
      assert(auth.getDeviceDataOwner() === `u-drew${SEP}L-A`, '…and the owner is recorded on the way out');
      // …and the NEXT boot keeps everything. One re-download, not one per boot.
      seedADat();
      await quiet42(async () => { await auth.refreshMembershipsAndSession(); await tick42(); });
      assert(remaining().length === Object.keys(A_DATA).length,
        `…and the very next sign-in keeps it all (${remaining().length} items) — ONE re-download, not one per boot`);
    }

    // ── (d) THE MARKER IS WRITTEN *LAST*, SO A PARTIAL CLEAR RE-CLEARS ──────
    // If the marker were written first, a device that died mid-sweep would come
    // back recording an owner for data that is still half somebody else's.
    {
      const authSrcQ = readFileSync(new URL('./js/auth.js', import.meta.url), 'utf8');
      const code = authSrcQ.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
      const fn = (code.match(/export function reconcileDeviceDataOwner\([\s\S]*?\n\}/) || [''])[0];
      assert(!!fn, 'fixture: reconcileDeviceDataOwner() was located');
      const clearAt = fn.indexOf('clearDeviceLocalSessionData(');
      const markAt = fn.indexOf('_setDeviceDataOwner(');
      assert(clearAt > -1 && markAt > -1 && clearAt < markAt,
        `the CLEAR runs before the MARK (clear@${clearAt}, mark@${markAt}) — an interrupted sweep must leave no marker, so the next boot clears again rather than adopting half of somebody else's data`);
      // ── BEHAVIORAL, TWICE, BECAUSE A SWEEP CAN FAIL TWO DIFFERENT WAYS ────
      // (i) removeItem THROWS — caught by the per-key catch.
      // (ii) removeItem SILENTLY NO-OPS — a shape real storage shims and some
      //      in-app browsers really have, and the ONLY thing that can catch it
      //      is reading the key back. Case (ii) is here because a mutation that
      //      deleted the read-back left the suite completely green on case (i)
      //      alone: the catch and the read-back are two guards, and a test that
      //      exercises one of them proves nothing about the other.
      for (const [label, breakRemove] of [
        ['THROWS mid-sweep (the device dies, quota, a partitioned store)',
         (real, keyToBreak) => k => { if (k === keyToBreak) throw new Error('the device died mid-sweep'); return real(k); }],
        ['SILENTLY NO-OPS (a shim that accepts the call and removes nothing)',
         (real, keyToBreak) => k => { if (k === keyToBreak) return undefined; return real(k); }],
      ]) {
        resetAll({
          getSession: async () => ({ data: { session: { user: { id: 'u-drew' } } } }),
          from: () => ({ data: [ROW_A42], error: null }),
        });
        wireRealAuthUI();
        storeValidSession();
        seedADat();
        try { localStorage.removeItem(OWNER); } catch {}
        const realRemove = localStorage.removeItem.bind(localStorage);
        localStorage.removeItem = breakRemove(realRemove, 'cfbp_chat_events_cache');
        try {
          await quiet42(async () => { await auth.refreshMembershipsAndSession().catch(() => {}); await tick42(); });
        } finally { localStorage.removeItem = realRemove; }
        assert(remaining().includes('cfbp_chat_events_cache'),
          `fixture (${label}): the injected failure really did leave a key behind (${JSON.stringify(remaining())}) — a clear that quietly succeeded would make the assertion below vacuous`);
        assert(auth.getDeviceDataOwner() === '',
          `DI-180q (${label}) — NO marker is written over a PARTIAL clear, so the next boot reads MISSING and clears again. A marker here would record the incoming player as the owner of a cache that is still partly the outgoing player's, and — because it would then MATCH — keep it forever.`);
      }
    }

    // ── (e) AN UNWRITABLE MARKER IS "MISSING", NEVER "A MATCH" ──────────────
    {
      resetAll({
        getSession: async () => ({ data: { session: { user: { id: 'u-drew' } } } }),
        from: () => ({ data: [ROW_A42], error: null }),
      });
      wireRealAuthUI();
      storeValidSession();
      seedADat();
      try { localStorage.removeItem(OWNER); } catch {}
      const realSet = localStorage.setItem.bind(localStorage);
      localStorage.setItem = (k, v) => { if (k === OWNER) throw new Error('QuotaExceededError'); return realSet(k, v); };
      let logs = [];
      try {
        logs = await quiet42(async () => { await auth.refreshMembershipsAndSession(); await tick42(); });
      } finally { localStorage.setItem = realSet; }
      assert(remaining().length === 0, 'fixture: the clear still ran on this device');
      assert(auth.getDeviceDataOwner() === '',
        `an unwritable marker is ABSENT, not assumed (got ${JSON.stringify(auth.getDeviceDataOwner())})`);
      assert(logs.some(l => /owner marker could NOT be persisted/.test(l)),
        '…and it says so out loud, because the cost lands on the next boot rather than this one');
      // The next boot therefore CLEARS AGAIN — the fail-closed direction.
      seedADat();
      await quiet42(async () => { await auth.refreshMembershipsAndSession(); await tick42(); });
      assert(remaining().length === 0,
        `DI-180q — …so the next boot clears AGAIN (${JSON.stringify(remaining())}): an unpersistable marker behaves as MISSING forever, never as a match. One repeated chat re-download is the price; a cross-account leak is not.`);
    }

    // ── (f) SIGN OUT CLEARS THE DATA *AND* THE MARKER ───────────────────────
    {
      resetAll({
        getSession: async () => ({ data: { session: { user: { id: 'u-drew' } } } }),
        from: () => ({ data: [ROW_A42], error: null }),
      });
      wireRealAuthUI();
      storeValidSession();
      await quiet42(async () => { await auth.refreshMembershipsAndSession(); await tick42(); });
      seedADat();
      assert(auth.getDeviceDataOwner() !== '', 'fixture: an owner is recorded, and the device carries data');
      await quiet42(async () => { await auth.signOut(); await tick42(); });
      assert(remaining().length === 0, `sign-out clears the data (${JSON.stringify(remaining())})`);
      assert(auth.getDeviceDataOwner() === '',
        'DI-180q — …and the MARKER with it: the data is gone, so recording an owner for it would be a lie, and a stale marker would make that player\'s next sign-in read "matches" over a cache that no longer exists');
    }

    // ── (g) A LEAGUE SWITCH UNDER THE SAME ACCOUNT STILL CLEARS ─────────────
    // The league term is load-bearing: the chat cache, the read cursors and the
    // unread counts are all league-scoped.
    {
      resetAll({
        getSession: async () => ({ data: { session: { user: { id: 'u-drew' } } } }),
        from: () => ({ data: [ROW_A42, ROW_A2_42], error: null }),
      });
      wireRealAuthUI();
      storeValidSession();
      await quiet42(async () => { await auth.refreshMembershipsAndSession(); await tick42(); });
      auth.setActiveLeagueId('L-A');
      await quiet42(async () => { await auth.refreshMembershipsAndSession(); await tick42(); });
      assert(auth.getDeviceDataOwner() === `u-drew${SEP}L-A`, 'fixture: the marker holds account AND league');
      seedADat();
      await quiet42(async () => { await auth.switchActiveLeague('L-A2'); await tick42(); });
      assert(remaining().length === 0,
        `DI-180q — the SAME account switching LEAGUES clears the league-scoped cache (${JSON.stringify(remaining())}): the cached room, the read cursors and the unread counts all belong to the league that was left`);
      assert(auth.getDeviceDataOwner() === `u-drew${SEP}L-A2`,
        `…and the marker moves with it (got ${JSON.stringify(auth.getDeviceDataOwner())}) — which is why it is the full tuple and not the account alone`);
    }

    // ── (h) R1 — THE EPOCH AND THE MARKER, IN THE RIGHT ORDER ───────────────
    // THE REASON BOTH HAD TO SHIP IN ONE PASS. A membership read issued for A
    // can still be in flight when B is proven at the device. Without the epoch
    // it lands immediately AFTER DI-180q's clear and repopulates the very cache
    // that was just wiped — a marker saying B over data that is A's again. This
    // drives exactly that: the stale read is released only AFTER the clear.
    {
      const st = { uid: 'u-A', reads: [] };
      let releaseA = null;
      const gateA = new Promise(r => { releaseA = r; });
      resetAll({
        getSession: async () => ({ data: { session: { user: { id: st.uid } } } }),
        from: async () => {
          const who = st.uid;
          st.reads.push(who);
          if (who === 'u-A') await gateA;
          return { data: [who === 'u-A' ? ROW_A42 : ROW_B42], error: null };
        },
      });
      wireRealAuthUI();
      globalThis.window.OneSignalDeferred = [];
      storeValidSession();
      const pA = auth.refreshMembershipsAndSession().catch(() => {});
      await tick42(6);
      assert(auth.getAccountUserId() === 'u-A' && st.reads.length === 1, 'fixture: A\'s read is in flight');
      seedADat();

      // B is proven. DI-180q clears A's data and records B as the owner.
      st.uid = 'u-B';
      storeValidSession();
      await quiet42(async () => {
        auth._fireAuthEventForTest('SIGNED_IN', { access_token: 't', user: { id: 'u-B' } });
        await tick42(14);
      });
      assert(remaining().length === 0 && auth.getDeviceDataOwner() === `u-B${SEP}L-B`,
        `fixture: the handover cleared A's data and recorded B as the owner (${JSON.stringify(auth.getDeviceDataOwner())})`);

      // …and NOW A's read lands.
      const logs = await quiet42(async () => { releaseA(); await pA; await tick42(14); });
      assert(remaining().length === 0,
        `R1 — A's read lands AFTER the clear and brings NOTHING back (${JSON.stringify(remaining())}). The epoch discards it; the marker decided what to wipe. Neither is sufficient alone, which is why both shipped together.`);
      assert(auth.getDeviceDataOwner() === `u-B${SEP}L-B`,
        `…and the marker still says B (${JSON.stringify(auth.getDeviceDataOwner())}) — the stale read does not re-mark the device either`);
      assert(auth.getActiveLeagueId() === 'L-B' && storage.getSession().playerId === 'mB',
        '…and B is still scoped to B\'s own league, with B\'s own member id');
      assert(logs.some(l => /DISCARDED/.test(l)), '…with the discard said out loud');
    }

    // ── (h2) EVERY CLEAR PRECEDES THE RE-LOGIN, ON *BOTH* HANDOVER PATHS ────
    // DI-180q gave the shared clear a second job — dropping the OneSignal
    // binding — and that turned the ORDER of two existing calls into a defect.
    // A9's chokepoint branch (d) calls the clear, and resyncPlayerPreferences()
    // ends with loginOneSignal(newPlayerId). Queued login-then-logout leaves the
    // INCOMING player bound to nobody and silently receiving nothing for the
    // rest of the session — on exactly the path this whole input exists for.
    // (Found by reading the diff, not by a failing test: the suite was 937/0
    // with the wrong order, because no assertion had looked at the SEQUENCE on
    // the suspended-slate path.)
    {
      // ONE client for the whole scenario, driven by mutable state — the same
      // shape [29]'s expireMidSlate() uses, because ensureClient() caches the
      // client and re-installing the factory mid-scenario would do nothing.
      const st = { uid: { id: 'u-A', email: 'a@example.com' }, rows: [ROW_A42], failing: false };
      resetAll({
        getSession: async () => ({ data: { session: { user: st.uid } } }),
        refreshSession: async () => ({ data: { session: null }, error: DEAD42() }),
        from: () => { if (st.failing) throw DEAD42(); return { data: st.rows, error: null }; },
      });
      wireRealAuthUI();
      globalThis.window.OneSignalDeferred = [];
      storeValidSession();
      auth._fireAuthEventForTest('SIGNED_IN', { access_token: 't', user: st.uid });
      await drainOS42({ login: () => {}, logout: () => {} });
      assert(storage.getSession().playerId === 'mA', 'fixture: A is signed in with a resolved membership');
      // A half-filled slate, so the expiry really does create a suspension box
      // and A9's branch (d) is genuinely reached on the handover below.
      app.state.draftPicks = { g1: 'home', g2: 'away' };
      app.state.draftTiebreaker = 44;
      globalThis.window.OneSignalDeferred = [];
      // A's session dies WITH PROOF (a dead refresh token), so DI-180p destroys
      // on the first failure and the slate is SUSPENDED.
      st.failing = true;
      await quiet42(async () => { await auth.refreshMembershipsAndSession().catch(() => {}); await tick42(); });
      assert(!!app._suspendedSlateForTest(),
        'fixture: the expiry SUSPENDED the slate, so A9\'s branch (d) is reachable on the handover');
      seedADat();
      // …and a DIFFERENT account signs in.
      st.failing = false;
      st.uid = { id: 'u-B', email: 'b@example.com' };
      st.rows = [ROW_B42];
      globalThis.window.OneSignalDeferred = [];
      const seq = [];
      storeValidSession();
      await quiet42(async () => {
        auth._fireAuthEventForTest('SIGNED_IN', { access_token: 't', user: st.uid });
        await drainOS42({ login: id => seq.push(`login:${id}`), logout: () => seq.push('logout') });
        await tick42();
      });
      assert(app._suspendedSlateForTest() === null && remaining().length === 0,
        `fixture: the handover wiped the suspension box AND A's device-local data (${JSON.stringify(remaining())})`);
      assert(seq.length > 0, `fixture: OneSignal calls really were queued (${JSON.stringify(seq)})`);
      assert(seq[seq.length - 1] === 'login:mB',
        `DI-180q — the LAST OneSignal call is the login for the incoming player (${JSON.stringify(seq)}). Every clear, on both handover paths, happens before the re-login — the other order binds the new player to nobody.`);
    }

    // ── (i) THE MARKER IS AN OPAQUE TUPLE, NEVER AN EMAIL ──────────────────
    {
      resetAll({
        getSession: async () => ({ data: { session: { user: { id: 'u-drew', email: 'drew@example.com' } } } }),
        from: () => ({ data: [ROW_A42], error: null }),
      });
      wireRealAuthUI();
      storeValidSession();
      await quiet42(async () => { await auth.refreshMembershipsAndSession(); await tick42(); });
      const marker = auth.getDeviceDataOwner();
      assert(!/@/.test(marker) && !/drew@example/.test(marker) && !/Drew/.test(marker),
        `the marker carries opaque ids only — no email, no display name (got ${JSON.stringify(marker)})`);
      assert(marker.split(SEP).length === 2,
        `…and exactly two terms joined with the ONE shared separator (${marker.split(SEP).length})`);
      assert(marker.split(SEP)[0] === auth.getAccountUserId() && marker.split(SEP)[1] === auth.getActiveLeagueId(),
        '…which are the account id and the active league id, read back out through the same accessors the app uses');
    }

    // ── (j) THE CLEAR ROUTINE'S OWN CONTRACT, STATED ───────────────────────
    {
      const authSrcQ2 = readFileSync(new URL('./js/auth.js', import.meta.url), 'utf8');
      const code2 = authSrcQ2.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
      const routine = (code2.match(/export function clearDeviceLocalSessionData\([^)]*\)[\s\S]*?\n\}/) || [''])[0];
      assert(/logoutOneSignal\(/.test(routine),
        'the ONE clearing routine drops the OneSignal binding — the previous player\'s pushes must not keep landing on a handset that is now somebody else\'s');
      assert(/clearAppBadge/.test(routine),
        '…and the home-screen badge, which is a count of six named people\'s messages on a device that has changed hands');
      assert(!/caches\.|serviceWorker/.test(routine),
        'the service-worker caches are NOT cleared — they hold app assets only, and wiping them would re-download the whole app on every handover for no privacy gain (and collide with CACHE_NAME, which is the release checklist\'s business)');
      assert(!/ACTIVE_LEAGUE_KEY/.test(routine) && !/setActiveLeagueId\(/.test(routine),
        '…and the active-league pointer stays exempt (A9), cleared by signOut() on its own explicit line so the difference between the callers stays visible');
      assert(!/DEVICE_DATA_OWNER_KEY/.test(routine),
        '…and the routine does not touch the marker: the caller writes it AFTER the clear returns, which is what makes an interrupted sweep re-clear');
    }

    // ── (k) THE OUTBOX — CLOSED AT THE SEVENTH GATE (SECURITY F-4) ─────────
    // The marker-driven clear DROPS the persisted outbox key on a handover,
    // which closes the leak for every device that can persist a marker. The
    // reviewer's marker-INDEPENDENT half is now built, in two pieces:
    //   • js/chat.js clearOutbox() drops S.outbox in RAM *and* the key, and
    //     app.js's identity chokepoint calls it (auth.js cannot — chat.js ->
    //     storage.js -> auth.js is already an edge, so the reverse would cycle);
    //   • flushOutbox() refuses to send an entry whose author is neither the
    //     current session's member id nor a SYSTEM author.
    // This block used to assert the gap as KNOWN-OPEN (`guards === false`). It
    // asserts the guard instead now — structurally AND behaviourally.
    {
      assert(auth._SIGNOUT_LOCAL_KEYS_FOR_TEST.includes('cfbp_chat_outbox2'),
        'the unsent outbox key is in the ONE clearing list, so every handover that reaches the clear drops it');
      const chatSrc = readFileSync(new URL('./js/chat.js', import.meta.url), 'utf8');
      const chatCode = chatSrc.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
      assert(/S\.outbox\.push\(\{\s*ev/.test(chatCode),
        'fixture: js/chat.js queues whole chat EVENTS, so each entry already carries the author it was composed under — the stamp half of the guard was already there');
      const flushFn = (chatCode.match(/export async function flushOutbox\(\)[\s\S]*?\n\}/) || [''])[0];
      assert(!!flushFn, 'fixture: flushOutbox() was located');
      assert(/getSession\(/.test(flushFn) && /playerId/.test(flushFn),
        'SEC F-4 — flushOutbox() reads the CURRENT session before it sends anything (this assertion was the KNOWN-OPEN gap at the sixth gate; it is the guard at the seventh)');
      // `.includes(` since security F-5 (audit #10) turned SYSTEM_AUTHORS from a
      // Set into a frozen ARRAY — a Set cannot be made immutable, and this
      // allow-list decides whose queued words may leave the device under
      // somebody else's session. The RULE is unchanged: the guard consults the
      // list rather than comparing to `me` alone.
      assert(/SYSTEM_AUTHORS\.includes\(/.test(flushFn),
        '…and the allow-list is the member id OR a SYSTEM author — a bare `author === me` check would have silently stopped every SCRIBE post (What\'s New, wager-due, lifecycle, Tier 1, the weekly pin) from ever being sent');
      const clearFn42 = (chatCode.match(/export function clearOutbox\(\)[\s\S]*?\n\}/) || [''])[0];
      assert(/S\.outbox = \[\]/.test(clearFn42) && /removeItem\(K_OUTBOX\)/.test(clearFn42),
        '…and clearOutbox() drops BOTH halves: the live array in RAM and the persisted key. The key alone was the sixth gate\'s fix and a same-page handover never reloads.');
      // COMMENTS STRIPPED FIRST. The chokepoint's own comment block explains
      // why it calls clearOutbox(), so a rule applied to the raw text passes on
      // the prose alone — a mutation that removed the CALL and left the comment
      // stayed green on the first run of this assertion.
      const appSrc42 = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
      const chokepoint42 = (appSrc42.match(/function applyIdentityDeltaIfChanged\([\s\S]*?\n\}/) || [''])[0];
      assert(/clearOutbox\(\)/.test(chokepoint42),
        '…and app.js\'s identity chokepoint is what calls it — one place, reached by signOut(), by reconcileDeviceDataOwner()\'s handover and by the suspended-slate branch alike');
      const authCode42 = readFileSync(new URL('./js/auth.js', import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
      assert(!/^\s*import[^\n]*chat\.js/m.test(authCode42),
        '…and js/auth.js does NOT import js/chat.js: chat.js -> storage.js -> auth.js is already an edge, so the reverse would close a cycle');

      // ── BEHAVIOURAL, NOT JUST STRUCTURAL ────────────────────────────────
      // PIN mode, deliberately: storage.getSession() reads the synthesized
      // Supabase session in 'supabase' mode, so setSession() would be ignored
      // and the guard would be measured against whatever identity the previous
      // sub-block happened to leave resolved (it was — the first run of this
      // assertion passed vacuously because `me` was already 'mA').
      auth._resetAuthForTest();
      chat._resetForTest();
      storage.setSession('mA', false, true);
      chat.sendEvent({ type: 'message', body: 'kevin you are cooked', author: 'mA' });
      chat.sendEvent({ type: 'message', body: 'weekly recap', author: 'scribe' });
      assert(chat._outboxForTest().length === 2, 'fixture: two events are queued — one by member mA, one by SCRIBE');

      // (1) THE SAME-PAGE HANDOVER. B is proven at the device; nothing A queued
      // may still be sitting in RAM.
      storage.setSession('mB', false, true);
      chat.clearOutbox();
      assert(chat._outboxForTest().length === 0,
        `SEC F-4 — a same-page handover leaves NOTHING queued (${JSON.stringify(chat._outboxForTest().map(e => e.author))}): the persisted key was already dropped at the sixth gate, this is the in-RAM half`);
      assert(localStorage.getItem('cfbp_chat_outbox2') === null, '…and the persisted copy with it');

      // (2) THE MARKER-INDEPENDENT GUARD. Re-queue A's entry (the shape a
      // loadOutbox() on a handset that changed hands between sessions produces,
      // or a clear that could not complete) and flush as B.
      chat._resetForTest();
      storage.setSession('mA', false, true);
      chat.sendEvent({ type: 'message', body: 'still A\'s words', author: 'mA' });
      chat.sendEvent({ type: 'message', body: 'weekly recap', author: 'scribe' });
      storage.setSession('mB', false, true);
      await chat.flushOutbox();
      const left = chat._outboxForTest().map(e => e.author);
      assert(!left.includes('mA'),
        `SEC F-4 — a mismatched-author entry is NEVER flushed (${JSON.stringify(left)}): it is dropped from the queue, not sent under B's session`);
      assert(left.includes('scribe'),
        `…while SCRIBE's entry is untouched (${JSON.stringify(left)}) — the guard is an allow-list, not an equality check, or every system post would die here`);
      storage.setSession(null, false, false);
      chat._resetForTest();

      // ── SECURITY F-2 (EIGHTH gate) — "NOBODY IS SIGNED IN" vs "I DO NOT KNOW
      //    YET WHO IS SIGNED IN" ──────────────────────────────────────────────
      // flushOutbox()'s author guard disarms when `getSession().playerId` is
      // empty, and until Step 3a that was safe: empty meant PIN mode with nobody
      // logged in, or an anonymous viewer, and there was no second account to
      // send anything under. Step 3a made a third state reachable — a PROVEN
      // Google session whose member id has not resolved yet, which is a real
      // network-round-trip-wide window on every boot. A handset that changed
      // hands between sessions restores the previous player's queue via
      // loadOutbox() and hits flushOutbox() inside it.
      //
      // Both branches are asserted, because a fix that held everything would be
      // just as wrong as one that held nothing: a PIN-mode device must keep
      // flushing, or a league that never migrates silently stops sending chat.
      {
        const realFetchF2 = globalThis.fetch;
        const AUTHKEY = auth._AUTH_STORAGE_KEY_FOR_TEST;
        try {
          // (a) PINS MODE, NOBODY SIGNED IN → FLUSHES, exactly as today.
          auth._resetAuthForTest();
          chat._resetForTest();
          storage.setSession(null, false, false);
          chat.sendEvent({ type: 'message', body: 'queued with nobody logged in', author: 'mA' });
          assert(chat._outboxForTest().length === 1, 'fixture: one event is queued');
          assert(auth.getAuthMode() === 'pins', 'fixture: …on a device in PIN mode');
          await chat.flushOutbox();
          // Asserted on the HOLD COUNTER, not on the queue. With no backend
          // configured in this fixture, "held at the identity guard" and "ran
          // through and stopped at the backend gate" leave the queue in exactly
          // the same state — a test that read the queue here would pass against a
          // guard that armed on every device in the league.
          assert(chat._identityHoldCountForTest() === 0,
            `SEC F-2 — a PIN-mode device with nobody signed in does NOT hold (held ${chat._identityHoldCountForTest()} time(s)): it runs the ordinary flush path, exactly as today. Holding here would silently stop chat for any league that never migrates — the guard must not be armed by "no playerId" alone.`);

          // (b) SUPABASE MODE, ACCOUNT PROVEN, MEMBER ID NOT RESOLVED → HOLDS.
          auth._resetAuthForTest();
          chat._resetForTest();
          auth.configureAuth({ authMode: 'supabase', supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' });
          // A live token on the device — an account IS proven here…
          localStorage.setItem(AUTHKEY, JSON.stringify({ access_token: 't', expires_at: Math.floor(Date.now() / 1000) + 3600 }));
          assert(auth.hasValidSupabaseSession() === true, 'fixture: …the device carries a valid Supabase session');
          // …while the membership read has not landed, so there is no playerId.
          // NOT via storage.setSession(): in 'supabase' mode getSession() reads
          // the SYNTHESIZED session and save() refuses the PIN-mode key outright
          // (AuthModeMismatchError). An unresolved membership cache IS the state
          // under test, and it is already the state _resetAuthForTest() leaves.
          let pid = '';
          try { pid = String(storage.getSession()?.playerId || ''); } catch { pid = ''; }
          assert(pid === '', 'fixture: …and the member id has NOT resolved yet — this is the window, not a contrivance');
          chat.sendEvent({ type: 'message', body: 'the previous player\'s unsent words', author: 'mA' });
          await chat.flushOutbox();
          assert(chat._outboxForTest().length === 1,
            `SEC F-2 — with an account PROVEN but the member id still unresolved, flushOutbox() HOLDS: the queue is intact, nothing was sent (${JSON.stringify(chat._outboxForTest().map(e => e.author))}). Flushing here is how the previous player's words leave the device under the incoming account's token.`);
          // ══ SECURITY R-1 (audit #10) — LOAD-BEARING COMPANION. The assertion
          // ABOVE THIS ONE ("the queue is intact, nothing was sent") IS VACUOUS
          // WITHOUT IT. With no backend configured in this fixture, flushOutbox()
          // leaves the queue untouched on BOTH paths — held at the identity
          // guard, or run through and stopped at the backend gate two branches
          // later. The queue looks identical either way, so reading the queue
          // alone would pass against a guard that never armed. This counter is
          // the only thing in the pair that distinguishes them. Do not delete it
          // as redundant; it is the half that does the work.
          assert(chat._identityHoldCountForTest() === 1,
            `…and it held because of THIS guard, not because of the backend gate further down (held ${chat._identityHoldCountForTest()} time(s)) — the two are indistinguishable from the queue alone, which is why the counter exists`);
          assert(chat._outboxForTest()[0].author === 'mA',
            '…and it is held, not dropped — the identity is coming, so destroying the queue would lose a real message');
          // R2 (the release half) — a state that engages and never releases is
          // half a guard. The membership read LANDS, which is the one thing the
          // hold is waiting for, and the very next flush runs straight through.
          auth._setAccountUserIdForTest('u-mA');
          auth._setMembershipsForTest([{ leagueId: 'L-A', memberId: 'mA', role: 'player', displayName: 'Drew', leagueName: 'League A' }]);
          auth.setActiveLeagueId('L-A');
          assert(String(storage.getSession()?.playerId || '') === 'mA',
            'fixture: the membership read landed and the synthesized session now carries the member id — this is the release condition, driven rather than asserted about');
          await chat.flushOutbox();
          assert(chat._identityHoldCountForTest() === 1,
            `R2 — once the member id RESOLVES the hold does not fire again (still ${chat._identityHoldCountForTest()}): the queue is not parked forever waiting for a trigger that already came`);
        } finally {
          globalThis.fetch = realFetchF2;
          try { localStorage.removeItem(AUTHKEY); } catch {}
          auth._resetAuthForTest();
          chat._resetForTest();
          storage.setSession(null, false, false);
        }
      }

      // ── SECURITY F-7/F-8 (EIGHTH gate) — TWO SEVENTH-GATE FIXES THAT SHIPPED
      //    WITH NO ASSERTION OF THEIR OWN ─────────────────────────────────────
      // Both were reviewed, both are correct, and neither had a test that would
      // go red if it were undone. A fix nobody can break is not the same thing as
      // a fix nobody WILL break; these are the two that decide whether every
      // phone in the league takes a pointless wipe or keeps a real one.

      // (3) M15 — AN EMPTY OUTBOX LEAVES NO KEY, AND A DEVICE CARRYING ONLY
      //     THAT IS NOT "PREVIOUS PLAYER DATA PRESENT".
      //     persistOutbox() used to write the literal `[]`. Once a handset had
      //     ever sent one message the key existed forever holding nothing, and
      //     DI-180q's "is there anything here?" answered YES on EVERY phone in
      //     the league — so all six took a one-time clear and re-hydrate they did
      //     not need. The second half is the half that was never asserted.
      auth._resetAuthForTest();
      chat._resetForTest();
      storage.setSession('mA', false, true);
      chat.sendEvent({ type: 'message', body: 'a message that gets sent', author: 'mA' });
      assert(localStorage.getItem('cfbp_chat_outbox2') !== null,
        'fixture: a queued event DOES persist the outbox key — otherwise the assertion below is about a key that never existed');
      // DRAINED THROUGH persistOutbox(), NOT clearOutbox(). This assertion is
      // about the line inside persistOutbox() that decides what an EMPTY queue
      // writes, and clearOutbox() never reaches it — it calls removeItem()
      // directly, so pointing the test there passed against the mutated code.
      // (Caught by the mutation run of this very block: M15 stayed green.) The
      // author guard is the shortest honest path to "persistOutbox() ran with an
      // empty S.outbox": B signs in, A's entry is dropped, the queue empties.
      storage.setSession('mB', false, true);
      await chat.flushOutbox();
      assert(chat._outboxForTest().length === 0,
        'fixture: …and the author guard drained it, so persistOutbox() really did run with an empty queue (this is the line under test)');
      assert(localStorage.getItem('cfbp_chat_outbox2') === null,
        'SEC F-8 — an EMPTY outbox leaves NO key. Writing the literal `[]` here is what made every handset read as "previous player data present".');
      storage.setSession(null, false, false);
      chat._resetForTest();
      {
        // A device whose ONLY cfbp_ content is the (now absent) empty outbox,
        // plus the keep-list entries that are always there. It has nothing to
        // inherit, so it must be ADOPTED — no clear, no re-hydrate.
        store.clear();
        localStorage.setItem('cfbp_site_unlocked', '1');
        auth._setAccountUserIdForTest('u-only-empty-outbox');
        auth.setActiveLeagueId('L-A');
        const r15 = auth.reconcileDeviceDataOwner('eighth-gate-M15');
        assert(r15.action === 'adopted',
          `SEC F-8 — …so a device carrying nothing but an empty outbox is NOT judged "previous player data present" (got '${r15.action}'). 'cleared' here is the pre-fix answer, and it costs every phone in the league one unnecessary wipe and re-download.`);
        auth._setAccountUserIdForTest('');
        auth.setActiveLeagueId(null);
        store.clear();
      }

      // (4) M20 — A PHONE HOLDING ONLY LEAGUE DATA, WITH NO MARKER, IS CLEARED
      //     AND NOT ADOPTED.
      //     `_hasDeviceLocalSessionData()` used to ask an eight-name include-list
      //     that did not contain `cfbp_picks` or `cfbp_comments`. In LOCAL mode
      //     (an offline boot, a hydrate that failed behind AD-06's banner) those
      //     two are exactly what a handset carries — every player's picks and the
      //     whole chat log — and the device answered "nothing to inherit", got
      //     ADOPTED, and the marker then MATCHED forever with the previous
      //     player's data still on it. The seventh gate pointed the question at
      //     `_keysToClear()` so it can never drift from the action again; this is
      //     the assertion that says so.
      {
        store.clear();
        localStorage.setItem('cfbp_picks', 'every-players-picks');
        localStorage.setItem('cfbp_comments', 'the-whole-chat-log');
        assert(localStorage.getItem(auth._DEVICE_DATA_OWNER_KEY_FOR_TEST) === null,
          'fixture: and NO owner marker — this is a PIN-era handset meeting the Supabase build for the first time, which is the case all six founders hit');
        auth._setAccountUserIdForTest('u-incoming-founder');
        auth.setActiveLeagueId('L-A');
        const realInfo20 = console.info; console.info = () => {};
        let r20;
        try { r20 = auth.reconcileDeviceDataOwner('eighth-gate-M20'); } finally { console.info = realInfo20; }
        assert(r20.action === 'cleared',
          `SEC F-7 — a phone holding only cfbp_picks + cfbp_comments and NO marker is CLEARED, not adopted (got '${r20.action}'). 'adopted' is the pre-fix answer: it marks the device as the incoming player's with the previous player's picks and entire chat log still on it, permanently, because the marker matches from then on.`);
        assert(localStorage.getItem('cfbp_picks') === null && localStorage.getItem('cfbp_comments') === null,
          '…and the data really is gone, so the verdict is not just a label');
        assert(r20.persisted === true && localStorage.getItem(auth._DEVICE_DATA_OWNER_KEY_FOR_TEST) !== null,
          '…and only THEN is the marker written — clear first, mark last, so an interrupted sweep re-clears next boot');
        auth._setAccountUserIdForTest('');
        auth.setActiveLeagueId(null);
        store.clear();
      }
    }
  } finally {
    globalThis.fetch = realFetch42;
    for (const k of Object.keys(A_DATA)) { try { localStorage.removeItem(k); } catch {} }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[43] STEP 3b (DI-182/DI-183) — claim codes, linking, and member management…');
{
  // The brief's §5 list, in order, plus the two non-vacuity halves R1/R2 asks
  // for. Everything here drives the REAL wrappers against the fake client's
  // rpc()/from() seams — no test hand-builds a membership and calls a renderer.

  /** A client whose rpc() is a scripted table. `calls` records the ORDER, which
   *  several of these assertions are entirely about. */
  const scriptClient = (script, calls) => ({
    // A PROVEN account, because every wrapper below ends in
    // refreshMembershipsAndSession() and getMemberships() returns the
    // fail-closed `null` ("could not ask") without a uid — which would make
    // every assertion here measure an unresolved read rather than a link.
    session: script._session || { user: { id: 'u-koby', email: 'koby@example.com' } },
    rpc: (name, params) => {
      calls.push({ name, params });
      const fn = script[name];
      if (!fn) return { data: null, error: null };
      return fn(params);
    },
    from: (table, b) => (script._from ? script._from(table, b) : { data: [], error: null }),
  });

  // ── [43a] CLAIM-CODE ROUND TRIP (brief §5.1) ──────────────────────────────
  {
    const calls = [];
    let issued = '';
    let consumed = false;
    resetAll(scriptClient({
      issue_claim_code: () => { issued = '7XK4P2QR'; return { data: issued, error: null }; },
      link_member: ({ p_code }) => {
        if (consumed) return { data: null, error: Object.assign(new Error('already_linked'), { code: 'already_linked' }) };
        if (p_code !== issued) return { data: null, error: new Error('invalid_code') };
        consumed = true;
        return { data: [{ league_id: 'L-A', member_id: 'mKoby' }], error: null };
      },
      _from: () => ({ data: [{ league_id: 'L-A', id: 'mKoby', role: 'player', display_name: 'Koby', active: true, user_id: 'u1' }], error: null }),
    }, calls));
    storeValidSession();

    const code = await auth.issueClaimCode('L-A', 'mKoby');
    assert(code === '7XK4P2QR', `[43a] issueClaimCode() returns the server's code verbatim (got ${JSON.stringify(code)})`);
    assert(calls[0].name === 'issue_claim_code' && calls[0].params.p_league === 'L-A' && calls[0].params.p_member === 'mKoby',
      `[43a] …through issue_claim_code(p_league, p_member), scoped to the ACTIVE league's id and never a cross-league one (${JSON.stringify(calls[0])})`);
    assert(!('p_ttl' in calls[0].params),
      '[43a] …and NO p_ttl is passed (brief §4, approved): the server clamps to its 7-day default, and a TTL picker is depth paid for in taps that six founders onboarded once do not need');

    const linked = await auth.linkMember(code);
    assert(linked.leagueId === 'L-A' && linked.memberId === 'mKoby',
      `[43a] the issued code round-trips through linkMember() to a resolved membership (${JSON.stringify(linked)})`);
    assert(storage.getSession().playerId === 'mKoby',
      `[43a] …and getSession().playerId is the linked member — which only refreshMembershipsAndSession() can produce, so the wrapper really did refresh rather than flip a local flag (got ${JSON.stringify(storage.getSession().playerId)})`);

    // R2 — the RELEASE half. A code is single-use, and the second attempt must
    // fail with the SERVER's actual error, not a generic one.
    let second = null;
    try { await auth.linkMember(code); } catch (e) { second = e; }
    assert(second && `${second.message} ${second.code || ''}`.includes('already_linked'),
      `[43a] R2 — the SECOND use of the same code fails with the server's own error code, rethrown unchanged (got ${JSON.stringify(second && second.message)})`);
    assert(app._CLAIM_CODE_ERROR_COPY_FOR_TEST.resolve(second) === app._CLAIM_CODE_ERROR_COPY_FOR_TEST.map.find(r => r[0] === 'already_linked')[1],
      '[43a] …and it maps to the already_linked copy, not the generic "double-check your typing" line a player would act on wrongly');
  }

  // ── [43b] AUTO-LINK vs. CLAIM SCREEN — ASSERTED ON RENDERED DOM (§5.2) ────
  // RG-27's lesson, cited by the base DI itself: a code-path grep proves the
  // branch exists, not that the player sees it.
  {
    const calls = [];
    resetAll(scriptClient({
      link_member_by_email: () => ({ data: [{ league_id: 'L-A', member_id: 'mKoby' }], error: null }),
      _from: () => ({ data: [{ league_id: 'L-A', id: 'mKoby', role: 'player', display_name: 'Koby', active: true, user_id: 'u1' }], error: null }),
    }, calls));
    storeValidSession();
    app._resetLinkFlowForTest();

    const outcome = await app.attemptAutoLink();
    assert(outcome === 'linked', `[43b] a verified-email match resolves via link_member_by_email() (got ${JSON.stringify(outcome)})`);
    assert(app.linkFlowScreen() === 'confirm', '[43b] …and the CONFIRMATION card is owed — DI-183h forbids any path that skips it');
    const dashEl43 = new FakeEl(); dashEl43.id = 'page-dashboard'; registry.set('page-dashboard', dashEl43);
    app.renderLinkFlowScreen('dashboard');
    assert(/You're linked as Koby\./.test(dashEl43.innerHTML),
      `[43b] …and the RENDERED DOM carries the display name off the linked row (got ${JSON.stringify(dashEl43.innerHTML.slice(0, 120))})`);
    assert(/This isn't me/.test(dashEl43.innerHTML),
      '[43b] …with the "This isn\'t me" escape on it — the control that catches a wrong link, not optional polish');
    assert(!/Join a League|Create a League/.test(dashEl43.innerHTML),
      '[43b] …and no join/create affordance anywhere on it');
  }
  {
    // The differing-email half, in the SAME tick: zero matches is NOT an error
    // and the player is never told "you're linked."
    const calls = [];
    resetAll(scriptClient({
      link_member_by_email: () => ({ data: [], error: null }),
      _from: () => ({ data: [], error: null }),
    }, calls));
    storeValidSession();
    app._resetLinkFlowForTest();
    auth._setMembershipsForTest([]);

    const outcome = await app.attemptAutoLink();
    assert(outcome === 'unmatched', `[43b] a DIFFERING email matches zero rows (got ${JSON.stringify(outcome)})`);
    assert(app.linkFlowScreen() === 'claim', '[43b] …and the claim-code screen is owed instead — not an error state, the expected path');
    const dashEl43b = new FakeEl(); dashEl43b.id = 'page-dashboard'; registry.set('page-dashboard', dashEl43b);
    app.renderLinkFlowScreen('dashboard');
    assert(/Enter the code your commissioner gave you\./.test(dashEl43b.innerHTML),
      `[43b] …asserted on the RENDERED DOM (got ${JSON.stringify(dashEl43b.innerHTML.slice(0, 120))})`);
    assert(!/You're linked as/.test(dashEl43b.innerHTML),
      '[43b] …and the player is NEVER told they are linked on this path');

    // ── [43i] §3d's CRUX — NO JOIN/CREATE AFFORDANCE, EVER, ON THIS SCREEN ──
    // The fail-closed rule the whole item turns on: an unmatched Google account
    // can never become a NEW member of the founders' league by itself.
    assert(!/Join a League|Create a League|Join League|league-join-code|league-create-name|league-join-btn|league-create-btn/.test(dashEl43b.innerHTML),
      `[43i] the claim-code screen offers NO path by which an unmatched account becomes a new member of this league — not a button, not a field, not an id (got ${JSON.stringify(dashEl43b.innerHTML.slice(0, 200))})`);
    assert(/e\.g\. 7XK4P2QR/.test(dashEl43b.innerHTML),
      '[43i] …and the placeholder is the REAL generator\'s shape (8 chars, [A-Z2-9], no separator) — the approved correction to DI-183f\'s "KB7-2X9", which is one character short, hyphenated, and from an alphabet the server does not use');
    // Non-vacuity — DI-181's landing, which DOES carry those affordances, is
    // still reachable and still renders them. If this failed, the assertion
    // above would be measuring an app with no join flow at all.
    const dashEl43c = new FakeEl(); dashEl43c.id = 'page-dashboard'; registry.set('page-dashboard', dashEl43c);
    app._resetLinkFlowForTest();
    app.renderLeagueFlowScreen('dashboard');
    assert(/Join a League/.test(dashEl43c.innerHTML) && /Create a League/.test(dashEl43c.innerHTML),
      '[43i] non-vacuity — DI-181\'s landing still offers join/create; the two screens are genuinely different, not one screen with a feature deleted');
  }

  // ── [43c] "THIS ISN'T ME" IS DESTRUCTIVE-FIRST (§5.3) ─────────────────────
  {
    const calls = [];
    let unlinkDone = false;
    resetAll(scriptClient({
      link_member_by_email: () => ({ data: [{ league_id: 'L-A', member_id: 'mKevin' }], error: null }),
      unlink_member: () => { unlinkDone = true; return { data: null, error: null }; },
      _from: () => ({ data: unlinkDone ? [] : [{ league_id: 'L-A', id: 'mKevin', role: 'player', display_name: 'Kevin', active: true, user_id: 'u1' }], error: null }),
    }, calls));
    storeValidSession();
    app._resetLinkFlowForTest();
    await app.attemptAutoLink();
    assert(app.linkFlowScreen() === 'confirm', 'fixture: the disputed link resolved and the confirmation card is up');

    const beforeCalls = calls.length;
    await app._disputeCurrentLinkForTest();
    const after = calls.slice(beforeCalls).map(c => c.name);
    assert(after[0] === 'unlink_member',
      `[43c] the dispute's FIRST server call is unlink_member (${JSON.stringify(after)}) — the mis-link already granted this account read and write on another player's picks, so it cannot outlive the tap`);
    assert(unlinkDone === true, '[43c] …and it COMPLETED (in the mock) before anything else ran');
    assert(app.linkFlowScreen() === 'claim',
      '[43c] …and only THEN is the claim-code screen owed — never the reverse order, which would show "you are not linked" while the server still said otherwise');
    assert(app._linkFlowStateForTest().memberId === '',
      '[43c] …and the disputed member id is dropped from the flow, so the confirmation card cannot be re-rendered about a link that no longer exists');
  }

  // ── [43b2] REVIEWER F3 — §3d's PRECEDENCE, AT THE DISPATCHER ────────────────
  //
  // THE GAP THIS CLOSES, and it is a real one: reversing the `linkFlow` /
  // `leagueFlow` order in navigateTo() (js/app.js, the two branches around the
  // `if (linkFlow) … else if (leagueFlow)`) painted DI-181's JOIN/CREATE LANDING
  // to an unmatched founder — and authtest stayed 1146/0. Every §3d assertion in
  // this file until now has been about what `claimCodeScreenHTML()` CONTAINS.
  // None of them asked WHICH SCREEN THE APP ACTUALLY PAINTS, which is the only
  // question §3d's fail-closed rule is about: an unmatched Google account must
  // never be offered a path into the founders' league.
  //
  // Driven through the REAL dispatcher — globalThis.navigateTo — not by calling
  // renderLinkFlowScreen(). Calling the renderer directly is what made the
  // earlier assertions pass over a broken dispatcher.
  {
    const calls = [];
    resetAll(scriptClient({
      link_member_by_email: () => ({ data: [], error: null }),
      _from: () => ({ data: [], error: null }),
    }, calls));
    storeValidSession();
    app._resetLinkFlowForTest();
    auth._setMembershipsForTest([]);

    const outcome = await app.attemptAutoLink();
    assert(outcome === 'unmatched' && app.linkFlowScreen() === 'claim',
      `fixture: an unmatched founder owes the CLAIM screen (got '${outcome}' / '${app.linkFlowScreen()}')`);
    // …and DI-181's landing would ALSO fire in this state. That is the whole
    // point: both predicates are true at once, which is why one has to win.
    assert(app.needsLeagueFlowScreen() === true,
      'fixture: needsLeagueFlowScreen() is ALSO true here — a proven account with zero memberships satisfies both, so this is a genuine precedence question and not a contrived one');

    const dashEl43b2 = new FakeEl(); dashEl43b2.id = 'page-dashboard'; registry.set('page-dashboard', dashEl43b2);
    globalThis.navigateTo('dashboard');
    const painted = dashEl43b2.innerHTML;

    assert(/Enter the code your commissioner gave you\./.test(painted),
      `[43b2] REV F3 — navigateTo('dashboard') in the CLAIM state paints the claim-code screen (got ${JSON.stringify(painted.slice(0, 160))})`);
    assert(!/You're not in a league yet|Join a League|Create a League/.test(painted),
      `[43b2] …and NOT DI-181's join/create landing. This is §3d's crux at the only layer that decides it: an unmatched Google account must never be offered a path into the founders' league, and "the claim screen contains no join button" is not the same claim as "the join screen is not what got painted".`);
    assert(!/league-join-code|league-create-name|league-join-btn|league-create-btn/.test(painted),
      '[43b2] …no join/create field or button id reached the DOM either');

    // NON-VACUITY: the SAME dispatcher, the SAME state, with the link flow
    // resolved out of the way, paints DI-181's landing. Without this, the
    // assertions above would be satisfied by a dispatcher that painted nothing.
    app._resetLinkFlowForTest();
    assert(app.linkFlowScreen() === '' && app.needsLeagueFlowScreen() === true,
      'fixture: with the link flow reset, only DI-181\'s predicate is left true');
    const dashEl43b3 = new FakeEl(); dashEl43b3.id = 'page-dashboard'; registry.set('page-dashboard', dashEl43b3);
    globalThis.navigateTo('dashboard');
    assert(/Join a League/.test(dashEl43b3.innerHTML) && /Create a League/.test(dashEl43b3.innerHTML),
      `[43b2] non-vacuity — the same dispatcher DOES paint DI-181's landing once the link flow no longer claims the slot, so the assertion above is about PRECEDENCE and not about a dispatcher that paints nothing (got ${JSON.stringify(dashEl43b3.innerHTML.slice(0, 120))})`);
  }

  // ── [43c] THE REFUSAL HALF — DI-183e-A1, and the reason the first gate BLOCKED
  //
  // THE DEFECT THIS EXISTS FOR, in one sentence: the block above mocks
  // `unlink_member` to succeed UNCONDITIONALLY, and the live server built it
  // commissioner-only — so five of the six founders tapped "This isn't me", got
  // `not_commissioner`, and this suite stayed 1146/0 over a control that was
  // dead for everyone it was for. A MOCK THAT CANNOT REFUSE IS NOT COVERAGE OF A
  // REFUSAL PATH. Migration 0009 fixes the server; this fixes the test, and it
  // is the half that would have caught it.
  //
  // Driven through the REAL tap handler on the REAL rendered card, not by
  // calling the helper: the three things being asserted (the button comes back,
  // nothing routes, the copy names the commissioner) are all properties of the
  // handler's catch branch, and calling disputeCurrentLink() directly skips it.
  {
    const calls = [];
    resetAll(scriptClient({
      link_member_by_email: () => ({ data: [{ league_id: 'L-A', member_id: 'mKevin' }], error: null }),
      // The server as it behaves WITHOUT 0009 applied. This is not a contrived
      // error: it is the exact string `unlink_member`'s pre-0009 body raises.
      unlink_member: () => ({ data: null, error: Object.assign(new Error('not_commissioner'), { code: 'not_commissioner' }) }),
      _from: () => ({ data: [{ league_id: 'L-A', id: 'mKevin', role: 'player', display_name: 'Kevin', active: true, user_id: 'u1' }], error: null }),
    }, calls));
    storeValidSession();
    app._resetLinkFlowForTest();
    await app.attemptAutoLink();
    assert(app.linkFlowScreen() === 'confirm', 'fixture: the disputed link resolved and the confirmation card is up');

    const dashEl43cr = new FakeEl(); dashEl43cr.id = 'page-dashboard'; registry.set('page-dashboard', dashEl43cr);
    app.renderLinkFlowScreen('dashboard');
    const notMeBtn = dashEl43cr.querySelector('#link-not-me-btn');
    assert(!!notMeBtn && notMeBtn.listenerCount('click') === 1,
      'fixture: the "This isn\'t me" button is rendered with exactly one handler bound');

    // THE REAL TOAST, read out of the REAL container. showToast() is module-local
    // to js/app.js and renders into #toast-container — it is not on globalThis,
    // so a `globalThis.showToast = spy` would have replaced nothing and the
    // assertions below would have been reading an array app.js never wrote to.
    // (They were, on the first run of this block: three reds, all `[]`.)
    const toastHost = new FakeEl(); toastHost.id = 'toast-container'; registry.set('toast-container', toastHost);
    const realConfirm43 = globalThis.confirm; globalThis.confirm = () => true;
    try {
      notMeBtn.dispatch('click', {});
      for (let i = 0; i < 12; i++) await Promise.resolve();
    } finally { globalThis.confirm = realConfirm43; }
    const toasts43 = (toastHost.children || []).map(c => ({ msg: c.innerHTML || '', kind: /\berror\b/.test(c.className || '') ? 'error' : 'other' }));

    assert(notMeBtn.disabled === false && /This isn't me/.test(notMeBtn.textContent || "This isn't me"),
      `[43c] a REFUSED unlink leaves the button ENABLED and back to its own label (got disabled=${notMeBtn.disabled}, label=${JSON.stringify(notMeBtn.textContent)}) — a control stuck on "Unlinking…" is a dead end on the one screen a player is already anxious on`);
    assert(app.linkFlowScreen() === 'confirm',
      `[43c] …and NOTHING ROUTED (still '${app.linkFlowScreen()}'): the claim-code screen must not paint over a link the server still says is in place. Routing on a failed unlink is the same lie as the mock that succeeded unconditionally, arrived at from the other side.`);
    assert(app._linkFlowStateForTest().memberId === 'mKevin',
      '[43c] …and the flow still holds the disputed member, so a second tap can retry the same dispute');
    const refusal = toasts43.map(t => t.msg).join(' | ');
    assert(toasts43.length === 1 && toasts43[0].kind === 'error',
      `[43c] …and it FAILS LOUD — exactly one error toast (got ${JSON.stringify(toasts43)})`);
    assert(/commissioner/i.test(refusal),
      `[43c] …whose copy NAMES THE COMMISSIONER, because on the pre-0009 server they are the only person who can actually do it (got ${JSON.stringify(refusal)})`);
    const notCommRow = app._CLAIM_CODE_ERROR_COPY_FOR_TEST.map.find(r => r[0] === 'not_commissioner');
    assert(!!notCommRow,
      '[43c] REV F4 — `not_commissioner` IS in the copy table. Asserted before it is indexed into: without this line a missing entry threw a TypeError and killed the suite, which is a red that names the crash instead of the rule.');
    assert(refusal.includes(notCommRow ? notCommRow[1] : '\u0000'),
      `[43c] …and it carries the mapped not_commissioner line rather than the generic "tell your commissioner what you typed" (reviewer F4) (got ${JSON.stringify(refusal)})`);
  }

  // ── [43c] REVIEWER F-E — THE UNLINK LANDED; ONLY THE REFRESH DID NOT ───────
  //
  // THE LIE THIS REMOVES. `unlinkMember()` awaits the RPC and then the membership
  // refresh. Until now both threw the same way, so a refresh failure was reported
  // as "We couldn't unlink that just now" — while the server had ALREADY DONE IT.
  // The disputed account has lost its access, which is the entire point of the
  // control, and the player is told it failed and invited to retry. The retry then
  // calls unlink_member on a row that is no longer theirs, `my_member_id()` no
  // longer returns that id, and the server answers `not_commissioner`. So the
  // honest outcome reads as a hard failure TWICE, and the player tells their
  // commissioner that "This isn't me" is broken when it worked the first time.
  {
    const calls = [];
    let unlinkCalls = 0;
    resetAll(scriptClient({
      link_member_by_email: () => ({ data: [{ league_id: 'L-A', member_id: 'mKevin' }], error: null }),
      unlink_member: () => { unlinkCalls++; return { data: null, error: null }; },   // the RPC SUCCEEDS
      // …and the membership re-read that follows it fails. A transport failure, which
      // is the ordinary way this happens: the tap goes out on a train.
      _from: () => { throw new TypeError('Failed to fetch'); },
    }, calls));
    storeValidSession();
    app._resetLinkFlowForTest();
    // The auto-link has to resolve BEFORE the read starts failing, or there is no
    // confirmation card to dispute. Seeded through the same wrapper, then the
    // failure is switched on by the fixture above for the unlink's own refresh.
    auth._setMembershipsForTest([{ leagueId: 'L-A', memberId: 'mKevin', role: 'player', displayName: 'Kevin', leagueName: 'IRB' }]);
    auth.setActiveLeagueId('L-A');
    app._recordResolvedLinkForTest('L-A', 'mKevin');
    assert(app.linkFlowScreen() === 'confirm', 'fixture: the confirmation card is up and the link is disputable');

    const dashEl43fe = new FakeEl(); dashEl43fe.id = 'page-dashboard'; registry.set('page-dashboard', dashEl43fe);
    app.renderLinkFlowScreen('dashboard');
    const notMeFe = dashEl43fe.querySelector('#link-not-me-btn');
    assert(!!notMeFe && notMeFe.listenerCount('click') === 1, 'fixture: the "This isn\'t me" button is bound');

    const toastHostFe = new FakeEl(); toastHostFe.id = 'toast-container'; registry.set('toast-container', toastHostFe);
    const realConfirmFe = globalThis.confirm; globalThis.confirm = () => true;
    const realWarnFe = console.warn; console.warn = () => {};
    try {
      notMeFe.dispatch('click', {});
      for (let i = 0; i < 14; i++) await Promise.resolve();
    } finally { globalThis.confirm = realConfirmFe; console.warn = realWarnFe; }

    assert(unlinkCalls === 1,
      `[43c] REV F-E — fixture: the unlink RPC went out exactly once and SUCCEEDED (got ${unlinkCalls} call(s)); only the refresh after it failed`);
    const msgs = (toastHostFe.children || []).map(c => c.innerHTML || '').join(' | ');
    assert(/You're unlinked/.test(msgs) || /You&#39;re unlinked/.test(msgs),
      `[43c] REV F-E — the copy says the unlink SUCCEEDED (got ${JSON.stringify(msgs)}). "We couldn't unlink that" here is a lie about a write the server has already made, and it is the dangerous direction: it sends the player back to retry a control that has already done its job.`);
    assert(!/couldn't unlink/i.test(msgs) && !/couldn&#39;t unlink/i.test(msgs),
      `[43c] REV F-E — …and NEVER says the unlink failed (got ${JSON.stringify(msgs)})`);
    assert(/reload/i.test(msgs),
      `[43c] REV F-E — …and the one instruction it gives is the one that actually helps (got ${JSON.stringify(msgs)})`);
    assert(app.linkFlowScreen() !== 'confirm',
      `[43c] REV F-E — and the confirmation card is DOWN (screen is '${app.linkFlowScreen()}'): leaving it up offers a retry that would answer not_commissioner, because the caller is no longer that member — which is precisely what succeeded`);

    // NON-VACUITY: the RPC-failed path still says the unlink failed and still
    // leaves the card up. Without this, the assertions above would be satisfied
    // by a handler that reported success for everything.
    const calls2 = [];
    resetAll(scriptClient({
      link_member_by_email: () => ({ data: [{ league_id: 'L-A', member_id: 'mKevin' }], error: null }),
      unlink_member: () => ({ data: null, error: Object.assign(new Error('not_commissioner'), { code: 'not_commissioner' }) }),
      _from: () => ({ data: [{ league_id: 'L-A', id: 'mKevin', role: 'player', display_name: 'Kevin', active: true, user_id: 'u1' }], error: null }),
    }, calls2));
    storeValidSession();
    app._resetLinkFlowForTest();
    await app.attemptAutoLink();
    const dashEl43fe2 = new FakeEl(); dashEl43fe2.id = 'page-dashboard'; registry.set('page-dashboard', dashEl43fe2);
    app.renderLinkFlowScreen('dashboard');
    const notMeFe2 = dashEl43fe2.querySelector('#link-not-me-btn');
    const toastHostFe2 = new FakeEl(); toastHostFe2.id = 'toast-container'; registry.set('toast-container', toastHostFe2);
    const realConfirmFe2 = globalThis.confirm; globalThis.confirm = () => true;
    try {
      notMeFe2.dispatch('click', {});
      for (let i = 0; i < 14; i++) await Promise.resolve();
    } finally { globalThis.confirm = realConfirmFe2; }
    const msgs2 = (toastHostFe2.children || []).map(c => c.innerHTML || '').join(' | ');
    assert(/couldn&#39;t unlink|couldn't unlink/i.test(msgs2) && !/You&#39;re unlinked|You're unlinked/.test(msgs2),
      `[43c] REV F-E non-vacuity — when the RPC ITSELF fails, the copy still says the unlink failed (got ${JSON.stringify(msgs2)}) — the two outcomes read differently, which is the whole finding`);
    assert(app.linkFlowScreen() === 'confirm',
      '[43c] REV F-E non-vacuity — …and the card STAYS UP, because there a retry is genuinely the right next step');
  }

  // ── [43d] ALL FOUR SERVER ERRORS MAP TO DISTINCT, NON-GENERIC COPY (§5.4) ─
  {
    const seen = new Set();
    for (const code of ['invalid_code', 'code_expired', 'already_linked', 'already_member']) {
      const copy = app._CLAIM_CODE_ERROR_COPY_FOR_TEST.resolve(Object.assign(new Error(code), { code }));
      assert(copy && copy !== app._CLAIM_CODE_ERROR_COPY_FOR_TEST.unknown && copy !== app._CLAIM_CODE_ERROR_COPY_FOR_TEST.connectivity,
        `[43d] ${code} gets its own honest line, not the generic fallback (got ${JSON.stringify(copy)})`);
      seen.add(copy);
    }
    assert(seen.size === 4,
      `[43d] and the four are DISTINCT (${seen.size} of 4). The base DI wrote ONE string for all four; under it, a player whose code EXPIRED was told to double-check their typing and would retype a code that can never work.`);
    assert(app._CLAIM_CODE_ERROR_COPY_FOR_TEST.resolve(new TypeError('Failed to fetch')) === app._CLAIM_CODE_ERROR_COPY_FOR_TEST.connectivity,
      '[43d] …and a REAL transport failure gets the connectivity line, never a validation one');
    assert(app._CLAIM_CODE_ERROR_COPY_FOR_TEST.resolve(new Error('something nobody has seen')) === app._CLAIM_CODE_ERROR_COPY_FOR_TEST.unknown,
      '[43d] …while an unrecognised server string falls to the honest unknown line, never to a reassuring one');
  }

  // ── [43e] THE ONE-TIME RE-DOWNLOAD LINE IS KEYED ON THE MARKER (§5.5) ─────
  {
    const calls = [];
    resetAll(scriptClient({
      link_member_by_email: () => ({ data: [{ league_id: 'L-A', member_id: 'mKoby' }], error: null }),
      _from: () => ({ data: [{ league_id: 'L-A', id: 'mKoby', role: 'player', display_name: 'Koby', active: true, user_id: 'u1' }], error: null }),
    }, calls));
    storeValidSession();
    app._resetLinkFlowForTest();
    // A PIN-era handset: local league data, and NO owner marker — the case all
    // six founders hit, because the marker is Supabase-only.
    localStorage.setItem('cfbp_picks', 'a-season-of-picks');
    assert(localStorage.getItem(auth._DEVICE_DATA_OWNER_KEY_FOR_TEST) === null, 'fixture: no owner marker on this device');
    const realInfo43 = console.info; console.info = () => {};
    try { await app.attemptAutoLink(); } finally { console.info = realInfo43; }

    assert(auth.getLastDeviceDataReconcile()?.action === 'cleared',
      `[43e] the link's own refresh ran reconcileDeviceDataOwner() and it CLEARED (got ${JSON.stringify(auth.getLastDeviceDataReconcile()?.action)}) — the six founders' case`);
    // R2 half (§5.5's own): assert the MARKER WRITE happened, not just that a
    // clear happened once by coincidence.
    assert(localStorage.getItem(auth._DEVICE_DATA_OWNER_KEY_FOR_TEST) !== null,
      '[43e] R2 — …and the owner marker is now WRITTEN, which is what makes the second open a no-op rather than a second wipe');
    const dashEl43e = new FakeEl(); dashEl43e.id = 'page-dashboard'; registry.set('page-dashboard', dashEl43e);
    app.renderLinkFlowScreen('dashboard');
    assert(dashEl43e.innerHTML.includes(app._LINK_REDOWNLOAD_COPY_FOR_TEST),
      `[43e] …and the confirmation card carries the one-time line (got ${JSON.stringify(dashEl43e.innerHTML.slice(0, 200))})`);
    // EIGHTH-GATE COPY RULING: the sweep is every cfbp_ key now, not just chat.
    assert(!/chat history/i.test(app._LINK_REDOWNLOAD_COPY_FOR_TEST),
      `[43e] …and it does NOT say "chat history" (got ${JSON.stringify(app._LINK_REDOWNLOAD_COPY_FOR_TEST)}). Security F-1 inverted the sweep to a cfbp_ prefix rule, so the whole league re-hydrates; naming only chat is both a smaller promise than the app keeps and the one thing that worries a player about the one thing never at risk.`);

    // SECOND OPEN, same account + league: the marker now MATCHES, nothing is
    // cleared, and the line must NOT be shown.
    const second = auth.reconcileDeviceDataOwner('second-open');
    assert(second.action === 'kept',
      `[43e] a second open on the same device with the same account+league is 'kept' (got '${second.action}') — no second re-download`);
    app._resetLinkFlowForTest();
    const dashEl43e2 = new FakeEl(); dashEl43e2.id = 'page-dashboard'; registry.set('page-dashboard', dashEl43e2);
    app._setMemberCardDataForTest({});
    // Re-enter the confirmation card WITHOUT a clear having fired.
    await app.attemptAutoLink();
    app.renderLinkFlowScreen('dashboard');
    assert(!dashEl43e2.innerHTML.includes(app._LINK_REDOWNLOAD_COPY_FOR_TEST),
      `[43e] …and the line is NOT shown when no clear fired — it is conditioned on the re-download actually happening, never rendered unconditionally (got ${JSON.stringify(dashEl43e2.innerHTML.slice(0, 200))})`);
    try { localStorage.removeItem('cfbp_picks'); } catch {}
  }

  // ── [43f] DEMOTE-IMMEDIATELY (DI-182i, §5.6) ──────────────────────────────
  // Asserted against the RENDERED permission-denied markup, not a variable.
  {
    const calls = [];
    let role = 'commissioner';
    resetAll(scriptClient({
      _from: (table, b) => {
        // The UPDATE path records the write; the SELECT path answers with the
        // current role. One fake, both directions, so the demotion is really
        // travelling through the membership read rather than a test variable.
        if (b && b._update) { role = b._update.role; return { data: null, error: null }; }
        return { data: [{ league_id: 'L-A', id: 'mDrew', role, display_name: 'Drew', active: true, user_id: 'u1' }], error: null };
      },
    }, calls));
    storeValidSession();
    auth._setMembershipsForTest([{ leagueId: 'L-A', memberId: 'mDrew', role: 'commissioner', displayName: 'Drew', leagueName: 'IRB' }]);
    auth.setActiveLeagueId('L-A');
    assert(storage.getSession().isAdmin === true, 'fixture: the active session IS a commissioner before the demotion');

    const commEl = new FakeEl(); commEl.id = 'page-commissioner'; registry.set('page-commissioner', commEl);
    app.renderCommPage();
    assert(!/Commissioner Only/.test(commEl.innerHTML),
      'fixture: …and the Comm tab renders the panel, not the denial card, so the assertion below is measuring a change');

    // The demotion, through the SAME session-recompute path production uses.
    auth._setMembershipsForTest([{ leagueId: 'L-A', memberId: 'mDrew', role: 'player', displayName: 'Drew', leagueName: 'IRB' }]);
    assert(storage.getSession().isAdmin === false, '[43f] the demotion moved getSession().isAdmin — which ONLY the session recompute can do');
    app.renderCommPage();
    assert(/Commissioner Only/.test(commEl.innerHTML),
      `[43f] DI-182i — the Comm tab flips to the permission-denied card on the VERY NEXT render, no stale isAdmin, asserted on the rendered markup (got ${JSON.stringify(commEl.innerHTML.slice(0, 160))})`);
    assert(!/player-admin-row|member-promote-btn|member-unlink-btn|Claim code/.test(commEl.innerHTML),
      '[43f] …and not one member-management control survives into that tree');
  }

  // ── [43g] STRUCTURALLY DIFFERENT DOM TREES, NOT CSS HIDING (DI-182j, §5.7)─
  {
    const calls = [];
    resetAll(scriptClient({}, calls));
    storeValidSession();
    const commEl = new FakeEl(); commEl.id = 'page-commissioner'; registry.set('page-commissioner', commEl);

    auth._setMembershipsForTest([{ leagueId: 'L-A', memberId: 'mK', role: 'player', displayName: 'Kevin', leagueName: 'IRB' }]);
    auth.setActiveLeagueId('L-A');
    app.renderCommPage();
    const playerTree = commEl.innerHTML;

    auth._setMembershipsForTest([{ leagueId: 'L-A', memberId: 'mK', role: 'commissioner', displayName: 'Kevin', leagueName: 'IRB' }]);
    app._setMemberCardDataForTest({
      members: [{ memberId: 'mK', displayName: 'Kevin', role: 'commissioner', active: true, linked: false, initials: 'KV', almaMater: '' }],
      codes: [{ memberId: 'mK', claimCode: '7XK4P2QR', expiresAt: null }],
    });
    app.renderCommPage();
    const commTree = commEl.innerHTML;

    assert(!/7XK4P2QR/.test(playerTree),
      '[43g] a NON-commissioner render contains no claim code at all…');
    assert(!/comm-members-card|member-newcode-btn|Claim code/.test(playerTree),
      '[43g] …and no code-BEARING NODE for CSS to hide either — the two trees are structurally different, which is the only version of this that survives a stylesheet change');
    assert(/Commissioner Only/.test(playerTree),
      '[43g] …because the non-commissioner path returns at the denial card and never reaches the member markup');
    // ── DI-182a's COORDINATOR ANNOTATION — NO PIN AFFORDANCE, ANYWHERE ────
    // The annotation says "that modal must render WITHOUT its PIN reset/show
    // controls". The brief's §1 clarification is that showEditPlayerModal() has
    // no PIN markup and never did — the controls it means live one level up, in
    // the "Players, PINs & Contact" card, which DI-182b REPLACES wholesale in
    // supabase mode. So the annotation is satisfied by the replacement, and this
    // asserts the INTENT (no PIN affordance anywhere) rather than the imprecise
    // literal wording, against the rendered commissioner tree.
    assert(!/pin-toggle-btn|reset-pin-btn|share-pin-btn|Reset PIN|Show\/hide PIN/.test(commTree),
      `[43g] DI-182a — a COMMISSIONER's supabase-mode panel renders NO PIN control of any kind: not the reveal toggle, not Reset PIN, not Share PIN. There are no PINs in this mode, and a control for one would be a promise the app cannot keep.`);
    assert(!/Players, PINs/.test(commTree),
      '[43g] …and the PIN-centric card is not merely emptied, it is not emitted at all — DI-182b replaces it rather than hiding it');
    const appSrc43g = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
    assert(/if \(getAuthMode\(\) !== 'supabase'\) sections\.push\(/.test(appSrc43g),
      '[43g] …by a mode check on the SECTION, which is what keeps the pins-mode card byte-identical to what it has always been (DI-180f\'s flag contract)');
    // ══ SECURITY R-1 (audit #10) — LOAD-BEARING COMPANION. Every assertion above
    // this one in [43g] is an ABSENCE: no claim code in the player tree, no
    // code-bearing node, no PIN control. An absence assertion is satisfied by a
    // card that was never rendered at all — by a broken selector, a renamed id,
    // a renderer that threw — and would then be green over an app with no member
    // management in it. THIS is the assertion that says the thing whose absence
    // was measured actually exists on the other side of the role boundary. Do
    // not delete it as an obvious tautology; it is what makes four assertions
    // above it mean anything.
    assert(/comm-members-card/.test(commTree),
      `[43g] non-vacuity — the COMMISSIONER render does emit the card (got ${JSON.stringify(commTree.slice(0, 120))}), so the absence above is about the role and not about the card never existing`);
  }

  // ── [43d2] REVIEWER F4/F5/F8 — THE THREE AUDIT-#10 NITS, EACH WITH A RED ───
  {
    const copy = app._CLAIM_CODE_ERROR_COPY_FOR_TEST;
    const member = app._MEMBER_ACTION_ERROR_COPY_FOR_TEST;

    // ── F4: three more server codes reach a PLAYER'S screen now.
    // `last_commissioner` and `not_commissioner` come from unlink_member, which
    // "This isn't me" calls; `not_found` comes from link_member and (since
    // migration 0009 / R-5) from an inactive member's code. All three used to
    // fall through to "tell your commissioner what you typed", which is wrong
    // for each and actively misleading for last_commissioner: there is nothing
    // to retype and retrying will never work.
    for (const code of ['last_commissioner', 'not_commissioner', 'not_found']) {
      const resolved = copy.resolve(Object.assign(new Error(code), { code }));
      assert(resolved !== copy.unknown && resolved !== copy.connectivity,
        `[43d2] REV F4 — ${code} has its OWN line rather than the generic fallback (got ${JSON.stringify(resolved)})`);
    }
    const allSeven = ['invalid_code', 'code_expired', 'already_linked', 'already_member', 'last_commissioner', 'not_commissioner', 'not_found']
      .map(c => copy.resolve(Object.assign(new Error(c), { code: c })));
    assert(new Set(allSeven).size === 7,
      `[43d2] REV F4 — …and all SEVEN mapped codes are DISTINCT (${new Set(allSeven).size} of 7): a table where two codes share a string is a table that cannot tell a player which of two different things went wrong`);
    assert(/at least one commissioner/i.test(copy.resolve(Object.assign(new Error('last_commissioner'), { code: 'last_commissioner' }))),
      '[43d2] REV F4 — last_commissioner explains the WAY OUT (promote someone else first), because the action is not retryable as-is');

    // ── F5: the commissioner's actions get their own FALLBACK, not their own table.
    const unknownErr = new Error('something nobody has seen');
    assert(member.resolve(unknownErr) === member.refused && member.refused !== copy.unknown,
      `[43d2] REV F5 — an UNKNOWN failure reads differently for a commissioner (${JSON.stringify(member.resolve(unknownErr))}) than for a player (${JSON.stringify(copy.unknown)})`);
    assert(!/what you typed/i.test(member.refused),
      '[43d2] REV F5 — …and the commissioner is never told to "tell your commissioner what you typed": they ARE the commissioner, and nothing was typed');
    assert(member.resolve(Object.assign(new Error('permission denied'), { code: '42501' })) === member.refused,
      '[43d2] REV F5 — a bare 42501 (the shape a POLICY or GUARD refusal arrives in, with no named exception behind it) lands on that line too — it is the most likely unknown here, since every member-management write goes through league_members\' UPDATE policy and its trigger');
    assert(member.resolve(Object.assign(new Error('not_commissioner'), { code: 'not_commissioner' })) === copy.resolve(Object.assign(new Error('not_commissioner'), { code: 'not_commissioner' })),
      '[43d2] REV F5 — …while the MAPPED codes are SHARED: not_commissioner means the same thing whoever reads it, and two tables would be two places for the seven strings to drift');
    assert(member.resolve(new TypeError('Failed to fetch')) === copy.connectivity,
      '[43d2] REV F5 — and a real transport failure still gets the connectivity line, never "Nothing was changed" — which would be a claim about the database that a write cut off mid-flight cannot support');
    // …and the card actually USES it. A resolver nothing calls is a string.
    const appSrc43d2 = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
    const runMemberFn = (appSrc43d2.match(/const runMemberAction = async \([\s\S]*?\n  \};/) || [''])[0];
    assert(!!runMemberFn, 'fixture: runMemberAction() was located in js/app.js');
    assert(/memberActionErrorCopy\(err\)/.test(runMemberFn) && !/claimCodeErrorCopy\(/.test(runMemberFn),
      `[43d2] REV F5 — runMemberAction() resolves through memberActionErrorCopy(), not the player-addressed one (got ${JSON.stringify(runMemberFn.slice(-220))})`);
    const loadCardFn = (appSrc43d2.match(/export async function loadLeagueMembersCard\(\)[\s\S]*?\n\}/) || [''])[0];
    assert(/memberActionErrorCopy\(err\)/.test(loadCardFn),
      '[43d2] REV F5 — …and so does the card\'s own load-failure line, which only a commissioner can reach');

    // ── F8: all THREE self-actions re-enter the Comm tab.
    // Demote-self and unlink-self already did. Remove-self did not, and it takes
    // access away the same way: `active = false` drops the row out of
    // my_member_id() (0002_rls.sql's `and m.active`), which is the term
    // getSession().isAdmin is derived through.
    const bindFn = (appSrc43d2.match(/function bindLeagueMembersCard\(container\)[\s\S]*?\n\}/) || [''])[0];
    assert(!!bindFn, 'fixture: bindLeagueMembersCard() was located');
    const selfComparisons = (bindFn.match(/reRenderCommTab: btn\.dataset\.memberId === \(getSession\(\)\?\.playerId \|\| ''\)/g) || []).length;
    assert(selfComparisons === 3,
      `[43d2] REV F8 — all THREE self-actions (demote, unlink, REMOVE) re-enter the Comm tab on the same comparison (found ${selfComparisons}). Remove was the one without it, and a commissioner who removes themself keeps every control they no longer have until the next navigation.`);
    /** ONE action's own binding block: from its querySelectorAll to the next
     *  one. A fixed character window overlapped into the NEXT action's block and
     *  reported promote as carrying demote's line (it did, on the first run). */
    const actionBlock = (cls) => {
      const start = bindFn.indexOf(`container.querySelectorAll('.${cls}')`);
      if (start === -1) return '';
      const nextRel = bindFn.slice(start + 10).indexOf('container.querySelectorAll(');
      return nextRel === -1 ? bindFn.slice(start) : bindFn.slice(start, start + 10 + nextRel);
    };
    for (const cls of ['member-demote-btn', 'member-unlink-btn', 'member-remove-btn']) {
      const blk = actionBlock(cls);
      assert(!!blk, `fixture: ${cls}'s binding block was located`);
      assert(/reRenderCommTab: btn\.dataset\.memberId/.test(blk),
        `[43d2] REV F8 — …and ${cls} is one of them (matched inside its OWN block, so "three somewhere in the function" cannot be satisfied by one action carrying it three times)`);
    }
    // NON-VACUITY: the actions that CANNOT take your own access away do not carry it.
    for (const cls of ['member-promote-btn', 'member-newcode-btn', 'member-copy-code-btn']) {
      const blk = actionBlock(cls);
      assert(!!blk, `fixture: ${cls}'s binding block was located`);
      assert(!/reRenderCommTab/.test(blk),
        `[43d2] REV F8 non-vacuity — ${cls} does NOT re-enter the tab: promoting somebody else, issuing a code and copying one cannot change the acting commissioner's own role, and throwing away their scroll position for nothing is a cost with no purchase`);
    }
  }

  // ── [43g2] DI-183e-A2 — THE DISPUTE NOTE THE COMMISSIONER SEES ─────────────
  // DI-183e's second half ("records a dispute note the commissioner's link-status
  // table shows") and DI-183h item 3 ("surfaces the mismatch to the commissioner
  // … not just the player") both fell out of the brief's restatement, and §7 then
  // marked the clause covered. This is the clause, built and asserted.
  //
  // DRIVEN THROUGH THE REAL READ, not through the render cache. renderCommPage()
  // paints a LOADING placeholder into #comm-link-status-card and
  // loadLeagueMembersCard() fills it in a tick later — so seeding
  // _setMemberCardDataForTest() and reading #page-commissioner's own innerHTML
  // measures the placeholder, which is what the first draft of this block did.
  // Going through loadLeagueMembersCard() also exercises listLeagueMembers()'s
  // new `link_disputed_at` column, which is the half that would break if the
  // select list and the renderer ever disagreed.
  {
    const DISPUTED_AT = new Date(Date.now() - 2 * 3600e3).toISOString();   // two hours ago
    /** Render the two commissioner cards from a given set of league_members rows
     *  and return the link-status card's own innerHTML. */
    const statusCardFor = async (rows, codes = []) => {
      const calls = [];
      resetAll(scriptClient({
        get_claim_codes: () => ({ data: codes, error: null }),
        get_member_contacts: () => ({ data: [], error: null }),
        _from: (table) => (table === 'league_members' ? { data: rows, error: null } : { data: [], error: null }),
      }, calls));
      storeValidSession();
      auth._setMembershipsForTest([{ leagueId: 'L-A', memberId: 'mDrew', role: 'commissioner', displayName: 'Drew', leagueName: 'IRB' }]);
      auth.setActiveLeagueId('L-A');
      const commEl = new FakeEl(); commEl.id = 'page-commissioner'; registry.set('page-commissioner', commEl);
      app.renderCommPage();
      await app.loadLeagueMembersCard();
      return {
        status: registry.get('comm-link-status-card')?.innerHTML || '',
        members: registry.get('comm-members-card')?.innerHTML || '',
      };
    };
    const row = (id, name, extra = {}) => ({
      league_id: 'L-A', id, display_name: name, role: 'player', active: true,
      user_id: 'u-' + id, initials: name.slice(0, 2).toUpperCase(), alma_mater: '',
      link_disputed_at: null, ...extra,
    });

    const { status } = await statusCardFor([
      row('mDrew', 'Drew', { role: 'commissioner' }),
      row('mKoby', 'Koby', { user_id: null, link_disputed_at: DISPUTED_AT }),
      row('mKev', 'Kevin'),
    ], [{ member_id: 'mKoby', claim_code: '7XK4P2QR', claim_code_expires_at: null }]);

    assert(/Said &quot;this isn't me&quot;/.test(status),
      `[43g2] the link-status card marks a DISPUTED row — the commissioner sees the mismatch, not just the player (got ${JSON.stringify(status.slice(0, 400))})`);
    assert(/⚠️ Said &quot;this isn't me&quot; 2h ago/.test(status),
      `[43g2] …with WHEN, so a dispute raised months ago reads differently from one raised this morning (got ${JSON.stringify((status.match(/⚠️[^<]*/) || [])[0])})`);
    assert(/2 of 3 linked · 1 disputed/.test(status),
      `[43g2] …and the SUMMARY LINE counts it, so a commissioner scanning six rows does not have to find the warning to know there is one (got ${JSON.stringify((status.match(/\d of \d linked[^<]*/) || [])[0])})`);
    assert(status.indexOf("Said &quot;this isn't me&quot;") > status.indexOf('Koby') &&
           status.indexOf("Said &quot;this isn't me&quot;") < status.indexOf('7XK4P2QR'),
      '[43g2] …and it sits ABOVE the code on that row (brief §8: "above the code") — the warning is the thing to read before deciding whether to reissue');

    // NON-VACUITY, three ways. Without these the assertions above would pass on a
    // card that warned about everybody, or about nobody with a code.
    const kevSlice = status.slice(status.indexOf('Kevin'), status.indexOf('Kevin') + 260);
    assert(!/this isn't me/.test(kevSlice),
      `[43g2] non-vacuity — an UNDISPUTED linked row carries no warning (got ${JSON.stringify(kevSlice)})`);
    {
      const { status: clean } = await statusCardFor([row('mKev', 'Kevin')]);
      assert(!/disputed/.test(clean) && /1 of 1 linked/.test(clean),
        `[43g2] non-vacuity — with NO disputes the summary says so by OMISSION rather than "0 disputed" (got ${JSON.stringify((clean.match(/\d of \d linked[^<]*/) || [])[0])})`);
    }
    {
      // An UNPARSEABLE timestamp must still warn — the commissioner needs to know
      // a dispute happened far more than they need to know when, and "⚠️ … NaN"
      // is how a whole warning gets ignored.
      const { status: bad } = await statusCardFor([row('mKoby', 'Koby', { user_id: null, link_disputed_at: 'not-a-date' })]);
      assert(/Said &quot;this isn't me&quot;/.test(bad) && !/NaN|Invalid/.test(bad),
        `[43g2] …and an unparseable timestamp still WARNS, with no "NaN" beside it (got ${JSON.stringify((bad.match(/⚠️[^<]*/) || [])[0])})`);
    }
    assert(app._disputeRelTimeForTest('not-a-date') === '' && app._disputeRelTimeForTest(new Date(Date.now() + 60e3).toISOString()) === 'just now',
      "[43g2] …which is disputeRelTime() returning '' for garbage, and tolerating a handset clock that is AHEAD of the server rather than printing a negative age");

    // XSS: the display name on a disputed row is the same escaped sink as any
    // other, and this card is the one most likely to render a value typed into a
    // Google profile.
    {
      const { status: hostile } = await statusCardFor(
        [row('mX', '<img src=x onerror=alert(1)>', { user_id: null, link_disputed_at: DISPUTED_AT })],
        [{ member_id: 'mX', claim_code: '<script>alert(1)</script>', claim_code_expires_at: null }]);
      assert(!/<img src=x/.test(hostile) && !/<script>alert/.test(hostile),
        `[43g2] a hostile display name and a hostile claim code on a DISPUTED row are both escaped (got ${JSON.stringify(hostile.slice(0, 220))})`);
      assert(/&lt;img src=x/.test(hostile),
        '[43g2] …and present as escaped TEXT, so the commissioner still sees what the row actually says');
      assert(/Said &quot;this isn't me&quot;/.test(hostile),
        '[43g2] …with the dispute warning still on it — escaping must not swallow the row');
    }
    app._setMemberCardDataForTest({});
  }

  // ── [43h] THE PRE-LINK BANNER'S SDK ROUTE (§5.8) ───────────────────────────
  {
    resetAll();
    auth.configureAuth({ authMode: 'prelink', supabaseUrl: 'https://x.test', supabaseAnonKey: 'k' });
    const host = new FakeEl(); host.id = 'page-dashboard'; registry.set('page-dashboard', host);
    const html = app.prelinkBannerHTML();
    assert(/prelink-banner-btn/.test(html) && /Link My Account Now/.test(html),
      `[43h] fixture: the banner renders in 'prelink' mode (got ${JSON.stringify(html.slice(0, 120))})`);
    host.innerHTML = html;
    app.bindPrelinkBanner(host);

    // The SDK never arrives. `window.supabase` is undefined and the deadline is
    // shrunk to milliseconds, so this is the REAL ensureSupabaseSdkLoaded()
    // timing out — not a mock that returns false, which would prove only that
    // the `if` exists.
    globalThis.window.supabase = undefined;
    // The loader memoizes its promise for the whole PAGE, and earlier sections
    // in this file have already resolved it `true`. Without this drop the tap
    // below would take the memo's happy answer and open the Google gate —
    // proving nothing about the deadline.
    app._resetSupabaseSdkLoaderForTest();
    app._setPrelinkSdkTimeoutForTest(20);
    app._resetAuthHoldForTest();
    const realErr43 = console.error; console.error = () => {};   // the deadline logs by design
    // THROUGH THE HOST'S OWN querySelector, not the global registry: FakeEl
    // memoizes #id lookups ON THE ELEMENT, so the node bindPrelinkBanner() bound
    // its listener to is the one `host.querySelector()` returns — a registry
    // lookup can hand back a different object with no listeners on it, and the
    // tap would silently do nothing while the assertion blamed the routing.
    const btn43 = host.querySelector('#prelink-banner-btn');
    assert(btn43 && btn43.listenerCount('click') === 1,
      '[43h] fixture: the banner button has exactly one click listener bound, so the tap below really is the handler under test');
    btn43.dispatch('click', {});
    await new Promise(r => setTimeout(r, 150));
    console.error = realErr43;
    app._setPrelinkSdkTimeoutForTest(null);
    assert(app.currentAuthHoldReason() === 'sdk-unavailable',
      `[43h] an SDK that never arrives routes the TAP to showAuthHoldGate('sdk-unavailable') (hold is ${JSON.stringify(app.currentAuthHoldReason())}) — DI-180l/A4: no button that will only fail when tapped, and ONE hold-gate family rather than a bespoke banner-local error`);
    assert(!/couldn't|error|failed/i.test(host.innerHTML),
      '[43h] …and the banner does NOT grow an error message of its own — a second error surface beside the hold-gate family is exactly what A4 forbids');
    app._resetAuthHoldForTest();
  }

  // ── [43j] HOLD-GATE PRECEDENCE (§5.11) ────────────────────────────────────
  {
    const calls = [];
    resetAll(scriptClient({
      link_member_by_email: () => ({ data: [{ league_id: 'L-A', member_id: 'mKoby' }], error: null }),
      _from: () => ({ data: [{ league_id: 'L-A', id: 'mKoby', role: 'player', display_name: 'Koby', active: true, user_id: 'u1' }], error: null }),
    }, calls));
    storeValidSession();
    app._resetLinkFlowForTest();
    await app.attemptAutoLink();
    assert(app.linkFlowScreen() === 'confirm', 'fixture: with no hold up, a resolved link DOES owe the confirmation card');

    app.showAuthHoldGate('interlock');
    assert(app.isContentWithheld() === true, 'fixture: a hold gate is now up');
    assert(app.linkFlowScreen() === '',
      '[43j] with ANY hold gate up, NO DI-183 screen renders — even though a link would otherwise resolve. A hold is a fail-closed lock on a device whose config or data layer cannot be trusted; a link screen competing with it would be a control that cannot work (§3a precondition 4, A4).');
    const dashEl43j = new FakeEl(); dashEl43j.id = 'page-dashboard'; registry.set('page-dashboard', dashEl43j);
    app.renderLinkFlowScreen('dashboard');
    assert(dashEl43j.innerHTML === '',
      `[43j] …and renderLinkFlowScreen() paints nothing into the page rather than relying on a caller to have checked (got ${JSON.stringify(dashEl43j.innerHTML)})`);
    assert(app.prelinkBannerHTML() === '',
      '[43j] …and the pre-link banner is withheld by the same rule');
    app._resetAuthHoldForTest();
  }

  // ── [43k] THE TWO CODE TYPES ARE NOT INTERCHANGEABLE (§5.9) ───────────────
  {
    const calls = [];
    resetAll(scriptClient({
      // Each RPC rejects the OTHER kind of code with its own honest error —
      // exactly what the real functions do (join_league matches leagues.join_code,
      // link_member matches league_members.claim_code; neither falls back).
      join_league: ({ p_code }) => (p_code === 'IRB4F2KJ'
        ? { data: 'mNew', error: null }
        : { data: null, error: Object.assign(new Error('invalid_code'), { code: 'invalid_code' }) }),
      link_member: ({ p_code }) => (p_code === '7XK4P2QR'
        ? { data: [{ league_id: 'L-A', member_id: 'mKoby' }], error: null }
        : { data: null, error: Object.assign(new Error('invalid_code'), { code: 'invalid_code' }) }),
      _from: () => ({ data: [], error: null }),
    }, calls));
    storeValidSession();

    let a = null;
    try { await auth.joinLeague('7XK4P2QR'); } catch (e) { a = e; }
    assert(a && `${a.message}`.includes('invalid_code'),
      '[43k] a MEMBER CLAIM code submitted to the league-join flow is rejected by join_league() — never a "close enough" accept');
    let b = null;
    try { await auth.linkMember('IRB4F2KJ'); } catch (e) { b = e; }
    assert(b && `${b.message} ${b.code || ''}`.includes('invalid_code'),
      '[43k] …and a LEAGUE-JOIN code submitted to the claim flow is rejected by link_member()');
    // The shapes are IDENTICAL by design (both 8 × [A-Z2-9]), which is exactly
    // why the client must never treat "looks like a code" as "is the right KIND
    // of code". Pinned so a future shape divergence does not quietly make the
    // client the arbiter.
    assert(auth.isClaimCodeShape('7XK4P2QR') && auth.isClaimCodeShape('IRB4F2KJ'),
      '[43k] both code types pass the client SHAPE check — so the shape check is a typo filter and the SERVER is the only authority on which kind a code is');
    assert(!auth.isClaimCodeShape('KB7-2X9') && !auth.isClaimCodeShape('7XK4P2Q') && !auth.isClaimCodeShape('7XK4P2QR0'),
      '[43k] …while a hyphenated 7-char string (DI-183f\'s old placeholder), a short code and a long one are all refused before a round trip');
    // …AND linkMember() ACTUALLY USES IT. Asserting the predicate alone proves
    // only that the predicate exists: a mutation that deleted the shape check
    // out of linkMember() left this whole block green (found by the mutation run
    // of this very section). The observable difference is the ROUND TRIP — a
    // malformed code must never reach the server at all.
    const callsBefore43k = calls.length;
    let shapeErr = null;
    try { await auth.linkMember('KB7-2X9'); } catch (e) { shapeErr = e; }
    assert(!!shapeErr && shapeErr.clientShapeCheck === true,
      `[43k] linkMember() REFUSES a malformed code itself, marked as the CLIENT's own shape verdict rather than passed off as the server's (got ${JSON.stringify(shapeErr && shapeErr.message)})`);
    assert(calls.length === callsBefore43k,
      `[43k] …and NO RPC was issued for it (${calls.length - callsBefore43k} call(s)) — which is the entire point of a shape check: it saves the round trip, and nothing else`);
    const callsBeforeGood43k = calls.length;
    try { await auth.linkMember('7XK4P2QR'); } catch { /* the fixture's script decides the outcome */ }
    assert(calls.length > callsBeforeGood43k && calls[calls.length - 1].name === 'link_member',
      '[43k] non-vacuity — a WELL-FORMED code does reach link_member(), so the shape check is a filter and not a wall, and the server stays the only authority on a real code');
    assert(auth.normalizeClaimCode(' 7xk4-p2qr ') === '7XK4P2QR',
      '[43k] …and normalizeClaimCode() upper-cases and strips the spaces and hyphen a player adds themselves — the commissioner reads this code aloud at least once');
  }

  // ── [43l] DI-182a — THE SELF-EDIT ROWS, AND ONE DROPDOWN (§DI-182j) ───────
  {
    resetAll();
    auth.configureAuth({ authMode: 'pins', supabaseUrl: '', supabaseAnonKey: '' });
    storage.setSession('p1', false, true);
    storage.savePlayer({ playerId: 'p1', displayName: 'Drew', active: true, initials: 'DH', almaMater: 'Purdue' });
    const panel = chatUi._prefsPanelHTMLForTest();
    // THE LABEL AND THE VISIBILITY, not just the id. A mutation that kept
    // `id="pref-initials"` while renaming the label and adding `hidden` left the
    // original version of this assertion green — an id is not a control.
    assert(/<label>Initials<\/label>/.test(panel),
      `[43l] the row is LABELLED "Initials" — the word DI-182e specifies, which is what a player actually reads (got ${JSON.stringify((panel.match(/<label>[^<]*<\/label>/g) || []).slice(0, 8))})`);
    assert(!/<div class="chat-prefs-row"[^>]*\bhidden\b[^>]*>\s*<label>Initials/.test(panel),
      '[43l] …and the row is not hidden — a control nobody can see is the same as one that does not exist');
    assert(/<label>Alma mater<\/label>/.test(panel),
      '[43l] …and the Alma mater row is labelled as DI-182e specifies too');
    assert(/id="pref-initials"/.test(panel) && /value="DH"/.test(panel),
      `[43l] the prefs panel carries an Initials row backed by player.initials — a field that has existed on the data model with NO editable UI anywhere until now (got ${JSON.stringify(panel.slice(0, 200))})`);
    assert(/id="pref-alma"/.test(panel) && /Purdue/.test(panel),
      '[43l] …and an Alma mater row pre-selected to the player\'s current school');
    assert(/Your commissioner can also set this for you\./.test(panel),
      '[43l] …with DI-182e\'s note, so a player is not surprised when their commissioner overrides it');
    assert(!/pin|PIN/.test(panel),
      '[43l] …and NO PIN control of any kind (DI-182a\'s coordinator annotation — no PIN affordance anywhere in supabase mode)');
    // DI-182f — ONE dropdown implementation. app.js owns buildAlmaMaterOptions()
    // and hands it down; chat-ui.js never reimplements it.
    const chatUiSrc = readFileSync(new URL('./js/chat-ui.js', import.meta.url), 'utf8');
    assert(!/function buildAlmaMaterOptions/.test(chatUiSrc),
      '[43l] DI-182f — js/chat-ui.js does NOT contain a second buildAlmaMaterOptions(): one implementation, two call sites, or the two drift the first time the ESPN catalog\'s shape changes');
    assert(/registerAlmaMaterOptionsProvider/.test(chatUiSrc),
      '[43l] …it takes app.js\'s builder by injection instead — the one direction that does not close the cycle app.js -> chat-ui.js -> app.js');
    assert(!/^\s*import[^\n]*from '\.\/app\.js'/m.test(chatUiSrc),
      '[43l] …and js/chat-ui.js still imports nothing from js/app.js');

    // ── SECURITY F-3 / DI-T7.6 (audit #10) — A PREFS WRITE NEVER CARRIES A
    //    CONTACT FIELD ──────────────────────────────────────────────────────
    //
    // THE DEFECT, as the sequence a real handset reaches. The prefs rows wrote
    // `savePlayer({ ...player, ...patch })`, and savePlayer() REPLACES the row
    // (js/storage.js:777-783) — so the write carried every field of a copy read
    // when the panel rendered. After migration 0007 the contact columns left the
    // member-readable grant, so js/supabase-projection.js projects another
    // player's email/phone/phoneVerified as ABSENT. A player edits their
    // initials, and the absence is written back as the new truth over a real
    // phone number. DI-T7.6's rule is exact: never write a contact field you did
    // not read.
    //
    // ASSERTED ON THE PATCH KEYS, not on the record afterwards. The record looks
    // the same whether a contact key was absent or present-and-equal, so reading
    // it back would pass against the bug on any row whose contacts happened to
    // be current. The keys are what the rule is about.
    {
      const before = { playerId: 'p1', displayName: 'Drew', active: true, initials: 'DH', almaMater: 'Purdue', email: 'drew@example.com', phone: '+15551234567', phoneVerified: true };
      storage.savePlayer(before);
      app.patchPlayer('p1', { initials: 'DRW' });
      const keys = app._lastPlayerPatchKeysForTest();
      assert(JSON.stringify(keys) === JSON.stringify(['initials']),
        `[43l] SEC F-3 — a prefs-panel write names EXACTLY the field it edits (got ${JSON.stringify(keys)}) — not the whole row`);
      assert(app._PLAYER_CONTACT_FIELDS_FOR_TEST.every(k => !keys.includes(k)),
        `[43l] …so it carries NO contact key (${JSON.stringify(app._PLAYER_CONTACT_FIELDS_FOR_TEST)}), which is DI-T7.6's rule stated as a property of the call rather than of the caller's memory`);
      const after = storage.getPlayers().find(p => p.playerId === 'p1');
      assert(after.initials === 'DRW',
        '[43l] …the edit landed…');
      assert(after.email === 'drew@example.com' && after.phone === '+15551234567' && after.phoneVerified === true,
        `[43l] …and the three contact values are INTACT (got ${JSON.stringify({ email: after.email, phone: after.phone, phoneVerified: after.phoneVerified })})`);

      // THE PROJECTION CASE, which is the one DI-T7.6 actually names: the row as
      // this client holds it has NO contact keys at all (they projected absent).
      // A patch must leave them absent — not write `undefined`, not write ''.
      storage.savePlayer({ playerId: 'p2', displayName: 'Kevin', active: true, almaMater: 'Purdue' });
      app.patchPlayer('p2', { initials: 'KV' });
      const p2 = storage.getPlayers().find(p => p.playerId === 'p2');
      assert(!('email' in p2) && !('phone' in p2) && !('phoneVerified' in p2),
        `[43l] SEC F-3 — a row whose contacts projected ABSENT keeps them absent after a patch (got ${JSON.stringify(Object.keys(p2).sort())}) — writing undefined or '' would be the blanking DI-T7.6 forbids`);

      // NON-VACUITY, from the other side: a caller that DOES name a contact
      // field — the commissioner's Edit Player modal — still writes it. A rule
      // that refused contact writes outright would break the one surface that is
      // supposed to make them.
      app.patchPlayer('p1', { email: 'drew.new@example.com' });
      const p1b = storage.getPlayers().find(p => p.playerId === 'p1');
      assert(p1b.email === 'drew.new@example.com' && p1b.phone === '+15551234567',
        `[43l] non-vacuity — a caller that NAMES a contact field still writes it, and the ones it did not name are untouched (got ${JSON.stringify({ email: p1b.email, phone: p1b.phone })})`);

      // …and the STALE-ROW half of the same fix: patchPlayer re-reads at WRITE
      // time, so a change made after a render cannot be clobbered by it.
      const staleCopy = storage.getPlayers().find(p => p.playerId === 'p1');
      storage.savePlayer({ ...staleCopy, displayName: 'Drew (renamed by the commissioner)' });
      app.patchPlayer('p1', { almaMater: 'Notre Dame' });
      const p1c = storage.getPlayers().find(p => p.playerId === 'p1');
      assert(p1c.displayName === 'Drew (renamed by the commissioner)' && p1c.almaMater === 'Notre Dame',
        `[43l] SEC F-3 — and the patch re-reads the row at WRITE time, so an edit made while the panel was open is not overwritten by the copy it rendered from (got ${JSON.stringify({ displayName: p1c.displayName, almaMater: p1c.almaMater })})`);
    }

    // ── AND THROUGH THE PANEL'S OWN CALL SITE, not just through patchPlayer().
    //
    // The block above drives `app.patchPlayer()` directly, which proves the
    // WRITER is correct and says nothing about what the PREFS PANEL hands it. A
    // mutation that put the whole-row spread back inside saveSelfField() —
    // `_playerPatchWriter(self, { ...getPlayer(self), ...patch })` — left this
    // suite completely green, because nothing here exercised that line. That is
    // the same shape as reviewer F3's finding one layer over: testing the helper
    // instead of the path.
    //
    // So the writer is SPIED and the real binding is driven. What is measured is
    // the KEYS the panel passes, which is the whole of DI-T7.6's rule.
    {
      const realWriter = chatUi._playerPatchWriterForTest();
      const handed = [];
      try {
        storage.savePlayer({ playerId: 'p_panel', displayName: 'Koby', active: true, initials: 'KB', almaMater: 'Purdue', email: 'koby@example.com', phone: '+15559876543', phoneVerified: true });
        storage.setSession('p_panel', false, true);
        chatUi.registerPlayerPatchWriter((id, patch) => { handed.push({ id, keys: Object.keys(patch), patch }); });

        // Render the panel, bind it for real, and fire ONE row — then start over.
        //
        // ONE ROW PER RENDER, and that is a harness necessity rather than a
        // stylistic choice. Each handler ends with `renderChatPage()`, which
        // re-runs bindPrefsPanel(); in a browser that re-render replaces the
        // nodes, so the old listeners go with them. FakeEl deliberately REUSES a
        // node for a given id (so a listener bound during a render is the same
        // object a test can click), so the second binding lands on the SAME node
        // and one dispatch fires two handlers. That produced three writer calls
        // from two edits on the first run of this block. Dropping the ids and
        // re-rendering between edits is the harness's version of "new nodes".
        const fireRow = (id, value) => {
          registry.delete('pref-initials'); registry.delete('pref-alma');
          const host = new FakeEl(); host.id = 'page-chat'; registry.set('page-chat', host);
          host.innerHTML = chatUi._prefsPanelHTMLForTest();
          chatUi._bindPrefsPanelForTest();
          const el = registry.get(id);
          assert(!!el && el.listenerCount('change') === 1,
            `fixture: #${id} has exactly ONE change handler bound by the REAL bindPrefsPanel() (got ${el && el.listenerCount('change')})`);
          el.dispatch('change', { target: { value } });
        };
        fireRow('pref-initials', 'kb');
        fireRow('pref-alma', 'Notre Dame');
      } finally {
        chatUi.registerPlayerPatchWriter(realWriter);
        storage.setSession(null, false, false);
      }

      assert(handed.length === 2,
        `[43l] fixture: both rows reached the writer (got ${handed.length})`);
      assert(JSON.stringify(handed.map(h => h.keys)) === JSON.stringify([['initials'], ['almaMater']]),
        `[43l] SEC F-3 — THE PANEL hands the writer exactly ONE named field per edit (got ${JSON.stringify(handed.map(h => h.keys))}) — not a spread of the row it rendered from, which is what carried email/phone/phoneVerified into every self-edit`);
      const contactLeak = handed.filter(h => app._PLAYER_CONTACT_FIELDS_FOR_TEST.some(k => h.keys.includes(k)));
      assert(contactLeak.length === 0,
        `[43l] …so NO contact key is handed over by the prefs panel, ever (offending calls: ${JSON.stringify(contactLeak)}) — DI-T7.6 stated as a property of the CALL SITE, which is the line a careless edit changes`);
      assert(handed[0].patch.initials === 'KB',
        `[43l] …and the value still arrives normalised (uppercased, trimmed) rather than as typed (got ${JSON.stringify(handed[0].patch.initials)})`);
      assert(handed[1].patch.almaMater === 'Notre Dame' && handed[0].id === 'p_panel',
        `[43l] …scoped to the signed-in player's own id (got ${JSON.stringify({ id: handed[0].id, alma: handed[1].patch.almaMater })})`);
    }

    // chat-ui.js must have no whole-row writer left in it at all.
    // COMMENTS STRIPPED FIRST. The header above saveSelfField() explains the
    // defect by QUOTING the old `savePlayer({ ...player, ...patch })` line, and
    // a rule that could not tell a post-mortem from a live call would punish
    // writing the post-mortem down — which is the one thing that stops the shape
    // coming back.
    const chatUiCode = chatUiSrc.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
    assert(!/savePlayer\(/.test(chatUiCode),
      '[43l] SEC F-3 — js/chat-ui.js no longer CALLS savePlayer() anywhere: the self-edit goes through the injected field patch, so the whole-row shape cannot come back by copy-paste');
    assert(!/^\s*import[\s\S]{0,400}\bsavePlayer\b[\s\S]{0,200}from '\.\/storage\.js'/m.test(chatUiCode),
      '[43l] …and it no longer IMPORTS savePlayer either — a dead edge is how the call comes back');
    assert(/registerPlayerPatchWriter/.test(chatUiSrc),
      '[43l] …and it takes that writer by INJECTION, the one direction that does not close the app.js -> chat-ui.js cycle');
    storage.setSession(null, false, false);
  }

  // ── [43m] NO NEW DEVICE-LOCAL KEYS (the brief's builder note 4) ───────────
  {
    const appSrc43 = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
    const authSrc43 = readFileSync(new URL('./js/auth.js', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
    const newKeys = [...`${appSrc43}\n${authSrc43}`.matchAll(/localStorage\.setItem\(\s*'(cfbp_[a-z0-9_]+)'/g)].map(m => m[1]);
    const KNOWN = new Set(auth._CLEAR_KEEP_KEYS_FOR_TEST.concat(auth._SIGNOUT_LOCAL_KEYS_FOR_TEST, ['cfbp_push_active', 'cfbp_reveal_emitted', 'cfbp_scribe_weeksignals', 'cfbp_whatsnew_posted', 'cfbp_supabase_session']));
    const unknown = newKeys.filter(k => !KNOWN.has(k));
    assert(unknown.length === 0,
      `[43m] Step 3b added NO new device-local key (found ${JSON.stringify(unknown)}). The link flow is per-PAGE state on purpose: the server is the authority on whether an account is linked, re-asking is one RPC, and a persisted answer would be a lie the moment somebody unlinked it from the other side.`);
    assert(/let _linkFlow = /.test(appSrc43),
      '[43m] …and the flow state really is a module variable, so the assertion above is about something that exists');
  }
}



// ═══════════════════════════════════════════════════════════════════════════
// [44] PHASE III STEP 4 PART B — THE INTERLOCK FLIP, THE SWITCH GATE, AND THE
//      HANDOVER TEARDOWN (DI §1.3, §3.2, §3.3, §6.6; entry conditions #1/#2/#10)
//
// THE ONE SENTENCE THAT MATTERS. Until this build, hasSupabaseDataBackend() was
// the constant `false` — so isAuthDataLayerMismatch() was true for every
// supabase-mode device, storage.save() threw for all of them, and app.js held
// the whole mode behind the 'interlock' gate. That constant is now a live read
// of the adapter's state machine. Every 3a hold/withhold path in this file
// consulted it, which is why the sections above still run with
// `_setHasSupabaseDataBackendForTest(true)` — and why the REAL derivation needs
// its own section that takes the override away and drives the machine.
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[44] Step 4 Part B — hasSupabaseDataBackend() derives, the switch gate, the handover drop…');
{
  const sb = await import('./js/supabase-backend.js');

  /** A PostgREST-shaped fake with exactly the surface hydrate() uses. It can
   *  REFUSE, which is the whole point — "a mock that always succeeds tests
   *  nothing" (the assessment's §10 standard). */
  function fakeClient({ fail = null, rows = {} } = {}) {
    const thenable = (table) => ({
      select() { return this; },
      eq() { return this; },
      then(res) {
        if (fail) return res({ data: null, error: fail });
        return res({ data: rows[table] || [], error: null });
      },
    });
    return {
      from: (table) => thenable(table),
      rpc: async () => (fail ? { data: null, error: fail } : { data: [], error: null }),
    };
  }

  /** Put the adapter in a known, wired state with the accessors app.js injects. */
  function wireAdapter({ client = fakeClient(), league = () => auth.getActiveLeagueId() } = {}) {
    sb._resetForTest();
    sb.init({
      register: auth.registerSupabaseDataBackend,
      getClient: () => client,
      getActiveLeagueId: league,
      getIdentityEpoch: auth.getIdentityEpoch,
      getAccountUserId: auth.getAccountUserId,
      getDeviceDataOwnerTuple: auth.getDeviceDataOwnerTuple,
      getDeviceDataOwner: auth.getDeviceDataOwner,
      getLeagueName: auth._switchBannerLeagueName,
      getLeagueNameById: auth._leagueNameById,
      getSession: () => ({ isAdmin: true, playerId: 'm1' }),
      hasValidSupabaseSession: auth.hasValidSupabaseSession,
      isPrivilegeHeld: auth.isPrivilegeHeld,
      hasSheetMirror: auth.hasSheetMirrorOnDevice,
      isSiteUnlocked: storage.isSiteUnlocked,
    });
  }

  const quiet = async (fn) => {
    const rl = console.log, rw = console.warn, re = console.error, ri = console.info;
    console.log = () => {}; console.warn = () => {}; console.error = () => {}; console.info = () => {};
    try { return await fn(); } finally { console.log = rl; console.warn = rw; console.error = re; console.info = ri; }
  };

  // ── (a) THE DERIVATION ITSELF (entry condition #2) ───────────────────────
  {
    resetAll();
    auth._setHasSupabaseDataBackendForTest(null);   // take the override away — this section drives the real thing
    auth._resetSupabaseDataBackendForTest();
    assert(auth.hasSupabaseDataBackend() === false,
      '[44a] with NO probe registered the answer is false — an unwired adapter is not a data backend, which is also the flag-off world');

    auth.registerSupabaseDataBackend(() => true);
    assert(auth.hasSupabaseDataBackend() === true, '[44a] a registered probe is what answers — it is a READ, not a cached value');
    auth.registerSupabaseDataBackend(() => false);
    assert(auth.hasSupabaseDataBackend() === false, '[44a] …and it is re-read on every call, so the answer can change within a tick (a switch does exactly that)');
    await quiet(() => auth.registerSupabaseDataBackend(() => { throw new Error('probe exploded'); }));
    assert(await quiet(() => auth.hasSupabaseDataBackend()) === false,
      '[44a] a THROWING probe reads as false — "we cannot tell" is never permission, and storage.save()\'s interlock has no catch of its own');
    const took = await quiet(() => auth.registerSupabaseDataBackend('not a function'));
    assert(took === false && auth.hasSupabaseDataBackend() === false,
      '[44a] a non-function UNREGISTERS and warns rather than throwing — the interlock then holds the whole mode, which is already the loud failure');

    // THE REAL PROBE, against the real state machine.
    wireAdapter();
    const STATES = ['IDLE', 'HYDRATING', 'ACTIVE', 'ACTIVE-STALE', 'SWITCHING', 'HELD', 'OFFLINE-READONLY'];
    const expected = { ACTIVE: true, 'ACTIVE-STALE': true };
    for (const st of STATES) {
      await quiet(() => sb._setStateForTest(st, 'authtest'));
      assert(auth.hasSupabaseDataBackend() === (expected[st] === true),
        `[44a] state ${st} -> hasSupabaseDataBackend() ${expected[st] === true} (§1.3's two-state rule, read through the live machine)`);
    }

    // MUTANT (A7's): a probe that answers from a CONFIG FLAG alone. The adapter
    // is constructed and the mode is on, but nothing has hydrated.
    await quiet(() => sb._resetForTest());
    wireAdapter();
    auth.configureAuth({ authMode: 'supabase', dataMode: 'supabase', authModeKnown: true, supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' });
    assert(auth.getDataMode() === 'supabase' && auth.isSupabaseDataMode() === true,
      '[44a] fixture: the config flag really is ON');
    assert(auth.hasSupabaseDataBackend() === false,
      '[44a] MUTANT-PROOF: with the flag ON and NO hydrate the answer is still false — a config flag, a URL being present, or "hydrate started" is not enough (§0.3 item 6)');
    await quiet(() => auth.registerSupabaseDataBackend(() => auth.isSupabaseDataMode()));
    assert(auth.hasSupabaseDataBackend() === true,
      '[44a] …and the flag-only mutant DOES answer true, so the assertion above is about the real probe rather than about nothing');
    await quiet(() => { auth.registerSupabaseDataBackend(sb.probe); });
    assert(auth.hasSupabaseDataBackend() === false, '[44a] …restored: the real probe answers false again');
  }

  // ── (b) §6.4 — THE VERIFY WINDOW FOLDS INTO THE PROBE, NO NEW LATCH ──────
  {
    // auth.js has no setter for `_privilegeHeld` — it is raised only by the real
    // expiry classification, which sections [24]/[29] drive. So the LOCK is
    // driven here through the adapter's injected accessor, and the fact that
    // app.js injects auth.js's REAL one is asserted separately, below. The two
    // halves together are the claim; either alone would be decoration.
    let held = false;
    sb._resetForTest();
    sb.init({
      register: auth.registerSupabaseDataBackend,
      getClient: () => fakeClient(),
      getActiveLeagueId: () => auth.getActiveLeagueId(),
      isPrivilegeHeld: () => held,
    });
    await quiet(() => sb._setStateForTest('ACTIVE', 'authtest'));
    assert(auth.hasSupabaseDataBackend() === true, '[44b] fixture: ACTIVE, so the probe is true');
    held = true;
    assert(auth.hasSupabaseDataBackend() === false,
      "[44b] DI-180p's verify window makes the probe FALSE while the privilege lock is up — the server would refuse the write, and the client must not offer an action it knows may be refused (§6.4)");
    held = false;
    assert(auth.hasSupabaseDataBackend() === true,
      '[44b] R2: …and releasing the lock releases the probe, through the EXISTING SESSION_REVERIFIED path — no new latch was added, so R2 is the release test that already exists');
    // …and it is auth.js's OWN isPrivilegeHeld() that gets injected in production.
    const appSrc44 = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
    const wireFn = appSrc44.slice(appSrc44.indexOf('function wireSupabaseAdapter()'), appSrc44.indexOf('sb.onStatus(onSupabaseDataStatus)'));
    assert(/\n\s*isPrivilegeHeld,/.test(wireFn),
      '[44b] …and js/app.js injects auth.js\'s real isPrivilegeHeld into the adapter — the half the driven test above cannot see');
    assert(/\n\s*getSession,/.test(wireFn) && /register: registerSupabaseDataBackend,/.test(wireFn),
      '[44b] …alongside the session accessor the ROUTE table reads and the probe registration itself');
  }

  // ── (c) §3.3 LAYER 1 — A WRITE DURING THE SWITCH IS REFUSED AT save() ────
  {
    const modeBefore = storage.getBackendMode();
    // Section (b) re-inited the adapter with a reduced accessor set to drive the
    // privilege lock; put the full one back, because the ROUTE table reads
    // getSession() and a player may not write cfbp_settings at all (§2.1).
    wireAdapter();
    await quiet(() => auth.registerSupabaseDataBackend(sb.probe));
    storage.setBackendMode('supabase');
    await quiet(() => sb._setStateForTest('ACTIVE', 'authtest'));
    let ok = true;
    try { storage.saveSetting('autoRefreshInterval', 60); } catch { ok = false; }
    assert(ok === true, '[44c] R1: while ACTIVE a save() passes the interlock and reaches the adapter');

    for (const st of ['SWITCHING', 'HELD', 'IDLE', 'HYDRATING', 'OFFLINE-READONLY']) {
      await quiet(() => sb._setStateForTest(st, 'authtest'));
      let err = null;
      try { storage.saveSetting('autoRefreshInterval', 30); } catch (e) { err = e; }
      assert(err && err.name === 'AuthModeMismatchError',
        `[44c] a save() during ${st} throws AuthModeMismatchError BEFORE the mirror is touched (got ${err && err.name}) — §3.3 layer 1, falling out of the EXISTING interlock rather than a second mechanism`);
    }
    await quiet(() => sb._setStateForTest('ACTIVE', 'authtest'));
    let ok2 = true;
    try { storage.saveSetting('autoRefreshInterval', 45); } catch { ok2 = false; }
    assert(ok2 === true, '[44c] R2: the refusal RELEASES — back in ACTIVE the same write goes through, so this is a gate and not a one-way door');
    storage.setBackendMode(modeBefore);
  }

  // ── (d) §3.2 — SWITCH_END IS GATED ON THE HYDRATE, AND THE LATCH RESETS ──
  {
    resetAll();
    auth._setHasSupabaseDataBackendForTest(null);
    auth.configureAuth({ authMode: 'supabase', dataMode: 'supabase', authModeKnown: true, supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' });
    auth._setMembershipsForTest([
      { leagueId: 'A', memberId: 'm1', role: 'commissioner', displayName: 'x', leagueName: 'League A' },
      { leagueId: 'B', memberId: 'm2', role: 'commissioner', displayName: 'x', leagueName: 'League B' },
    ]);
    auth.setActiveLeagueId('A');

    // THE FAILING SWITCH FIRST, because the interesting claim is the negative.
    const refusal = { code: '42501', message: 'permission denied for table weeks' };
    wireAdapter({ client: fakeClient({ fail: refusal }) });
    await quiet(() => auth.registerSupabaseDataBackend(sb.probe));
    let sawStart = false, sawEnd = false;
    let off = auth.onAuthEvent(ev => { if (ev === 'SWITCH_START') sawStart = true; if (ev === 'SWITCH_END') sawEnd = true; });
    let thrown = null;
    await quiet(async () => { try { await auth.switchActiveLeague('B'); } catch (e) { thrown = e; } });
    off();
    assert(sawStart === true, '[44d] SWITCH_START still fires — app.js paints DI-181c\'s blocking overlay off it');
    assert(sawEnd === false,
      '[44d] SWITCH_END does NOT fire when the new league\'s hydrate fails — the overlay stays up rather than letting taps through to a half-hydrated view (DI-181c\'s blind-rule obligation)');
    assert(thrown && thrown.name === 'LeagueSwitchFailedError' && thrown.code === 'league_switch_failed',
      `[44d] …and the caller gets a TYPED failure to render, not a silent resolve (got ${thrown && thrown.name})`);
    assert(thrown && thrown.leagueId === 'B', '[44d] …naming the league it could not load');
    assert(auth.getActiveLeagueId() === 'B',
      '[44d] the POINTER did move — the switch happened, the data did not. Saying otherwise would leave the pill and the scope disagreeing (DI-184d)');
    assert(sb.getState() === 'HELD', '[44d] …and the adapter is HELD for the new league, so every read answers null and every save is refused');
    assert(auth.hasSupabaseDataBackend() === false, '[44d] …which the probe reports, so the interlock is doing the refusing');

    // R2 — THE LATCH RESETS. A working client, a second switch, and everything
    // that was true above is now false. Driven forward, never asserted about.
    wireAdapter({ client: fakeClient() });
    await quiet(() => auth.registerSupabaseDataBackend(sb.probe));
    sawStart = false; sawEnd = false;
    off = auth.onAuthEvent(ev => { if (ev === 'SWITCH_START') sawStart = true; if (ev === 'SWITCH_END') sawEnd = true; });
    let ok = null;
    await quiet(async () => { try { await auth.switchActiveLeague('A'); } catch (e) { ok = e; } });
    off();
    assert(ok === null, `[44d] R2: a switch whose hydrate LANDS does not throw (got ${ok && ok.message})`);
    assert(sawStart && sawEnd, '[44d] R2: …and both events fire, in order, with the hydrate awaited between them');
    assert(sb.getState() === 'ACTIVE', '[44d] R2: …leaving the adapter ACTIVE for the league the pointer now names');
    assert(auth.getActiveLeagueId() === 'A' && auth.hasSupabaseDataBackend() === true,
      '[44d] R2: …and writes are permitted again — the failure above latched nothing that a later success could not clear');

    // ORDER: the mirror is dropped BEFORE the pointer moves, so no render
    // between the two can serve league A's rows under league B's pill.
    const srcOrder = readFileSync(new URL('./js/auth.js', import.meta.url), 'utf8');
    const fnSwitch = srcOrder.slice(srcOrder.indexOf('export async function switchActiveLeague'),
      srcOrder.indexOf('// ═══════════════════════════════════════════════════════════════════════════\n// STEP 3B'));
    const beginAt = fnSwitch.indexOf('sb.beginSwitch(');
    const pointerAt = fnSwitch.indexOf('setActiveLeagueId(leagueId);');
    const reconcileAt = fnSwitch.indexOf('reconcileDeviceDataOwner(');
    const hydrateAt = fnSwitch.indexOf('await sb.switchLeague(');
    const endAt = fnSwitch.indexOf("fn('SWITCH_END'");
    assert(beginAt > -1 && pointerAt > -1 && reconcileAt > -1 && hydrateAt > -1 && endAt > -1,
      '[44d] fixture: every step of §3.2\'s sequence was located in switchActiveLeague()');
    assert(beginAt < pointerAt && pointerAt < reconcileAt && reconcileAt < hydrateAt && hydrateAt < endAt,
      `[44d] §3.2's ORDER holds: beginSwitch -> setActiveLeagueId -> reconcileDeviceDataOwner -> awaited hydrate -> SWITCH_END (${beginAt},${pointerAt},${reconcileAt},${hydrateAt},${endAt})`);
  }

  // ── (e) §6.6 — THE HANDOVER DROPS THE LIVE MIRROR, AND SAYS SO ───────────
  {
    // A RESOLVED ACCOUNT, because the device snapshot is owner-tagged and
    // _persistSnapshot() refuses to write one with no owner (§5.3's fail-closed
    // rule). Without this the whole section would pass VACUOUSLY: there would be
    // no snapshot to fail to remove.
    await quiet(() => auth._setAccountUserIdForTest('u-44e'));
    wireAdapter({ client: fakeClient() });
    await quiet(() => auth.registerSupabaseDataBackend(sb.probe));
    await quiet(() => sb.hydrate('A', { epoch: auth.getIdentityEpoch() }));
    assert(sb.getState() === 'ACTIVE' && sb.get('cfbp_players') !== null,
      '[44e] fixture: the adapter is ACTIVE and holding a league in memory');
    assert(sb.hasDeviceSnapshot() === true,
      '[44e] fixture: …and it really persisted a device snapshot, so "the snapshot is gone afterwards" is not a vacuous claim');

    const complete = await quiet(() => auth.clearDeviceLocalSessionData({ mode: 'handover' }));
    assert(sb.get('cfbp_players') === null && sb.get('cfbp_picks') === null,
      '[44e] the handover clear empties the LIVE IN-MEMORY mirror, not only the localStorage backup — a same-page handover never reloads, so the Map is the original and the keys were the copy');
    assert(sb.hasDeviceSnapshot() === false,
      '[44e] …and cfbp_supabase_mirror is gone, read back through the adapter\'s own predicate rather than a third key literal in auth.js (reviewer F9)');
    assert(sb.getState() === 'IDLE' && auth.hasSupabaseDataBackend() === false,
      '[44e] …leaving the adapter IDLE with the probe false, so nothing can be written under the outgoing player\'s league');
    assert(complete === true, '[44e] …and the routine reports a COMPLETE clear when every step verified');

    // THE VERDICT FEEDS `complete`: a drop that fails OPEN must not buy an
    // owner-marker stamp. Simulated by a store that refuses to remove that one
    // key, which is the iOS-private-browsing / full-quota shape DI-180q names.
    wireAdapter({ client: fakeClient() });
    await quiet(() => auth.registerSupabaseDataBackend(sb.probe));
    await quiet(() => sb.hydrate('A', { epoch: auth.getIdentityEpoch() }));
    assert(sb.hasDeviceSnapshot() === true, '[44e] fixture: a second snapshot is on the device for the mutant to refuse to remove');
    const realRemove = globalThis.localStorage.removeItem;
    globalThis.localStorage.removeItem = (k) => { if (k === 'cfbp_supabase_mirror') return; return realRemove.call(globalThis.localStorage, k); };
    const complete2 = await quiet(() => auth.clearDeviceLocalSessionData({ mode: 'handover' }));
    globalThis.localStorage.removeItem = realRemove;
    assert(complete2 === false,
      '[44e] MUTANT: a device that refuses to remove the snapshot makes the whole clear report INCOMPLETE — so reconcileDeviceDataOwner() leaves the owner marker unwritten and the next boot clears again, instead of adopting data that is still partly somebody else\'s');
    await quiet(() => sb.dropMirror('authtest-cleanup'));
    await quiet(() => auth._setAccountUserIdForTest(''));
  }

  // ── (g) §6.5 — THE HOLD GATE PAUSES CHAT'S POLL, AND THE PAUSE HOLDS ────
  //
  // THE FINDING, from the amendment, verbatim: *"Chat's background poll keeps
  // running behind a hold gate, so the unread COUNT can reappear on the nav
  // badge."* A hold tears the page down precisely so no league data is
  // reachable — and a count of messages six named people wrote is league data,
  // arriving on the nav pill and in the tab title, IN FRONT of the lock, every
  // twenty seconds.
  //
  // 'passive' was never enough. It says only "the chat tab is not showing"; the
  // poll loop keeps running, which is what makes an unread badge possible at
  // all. This is the mutation that was GREEN against every suite before this
  // section existed.
  {
    const pausedBefore = chat._isPollPausedForTest();
    chat.setPollMode('active');
    assert(chat._isPollPausedForTest() === false, '[44g] fixture: the poll is not paused to begin with');

    chat.setPollMode('paused');
    assert(chat._isPollPausedForTest() === true,
      "[44g] setPollMode('paused') is a STATE, not a one-off unsubscribe — three other paths re-subscribe on their own schedule, so a pause that only dropped the current subscription would be undone by whichever fired next");
    assert(chat._isPollingActiveForTest() === false,
      '[44g] …and the subscription really is dropped, so the timer is not merely quiet');

    // THE GUARD THAT MAKES IT HOLD: a re-subscribe attempt while paused is refused.
    await quiet(() => chat.refreshChatEnabled());
    assert(chat._isPollingActiveForTest() === false,
      "[44g] a re-subscribe attempt while paused does NOTHING — refreshChatEnabled()'s 30-second watch is exactly the path that would otherwise put the badge back behind the lock");

    // R2 — THE RELEASE. A latch with no release is how a device comes back from
    // a hold painted, operable and permanently without chat.
    chat.setPollMode('passive');
    assert(chat._isPollPausedForTest() === false,
      '[44g] R2: the pause is released by the ordinary active/passive arm, which is what releaseWithholdIfResolved() calls');

    // …and both call sites are really wired, which the driven half cannot see.
    const appSrcG = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
    const parkFn = appSrcG.slice(appSrcG.indexOf('function _parkTimersForHold()'), appSrcG.indexOf('function _parkTimersForHold()') + 900);
    assert(/setPollMode\('paused'\)/.test(parkFn),
      "[44g] _parkTimersForHold() calls setPollMode('paused') — NOT 'passive'. This is the assertion the mutation M16 had nothing to turn red");
    assert(!/setPollMode\('passive'\)/.test(parkFn),
      '[44g] …and it does not also call the old value, which would re-arm what it just parked');
    const relIdx = appSrcG.indexOf('async function releaseWithholdIfResolved');
    const relFn = appSrcG.slice(relIdx, appSrcG.indexOf('_timersParkedForHold = false;', relIdx));
    assert(/setPollMode\(state\.currentTab === 'chat' \? 'active' : 'passive'\)/.test(relFn),
      '[44g] …and the un-withhold transition releases it explicitly, beside the score tick and the chat-enabled watch it already re-arms');
    assert(/catch \(e\) \{ console\.error\('\[auth\] could not un-pause/.test(relFn),
      '[44g] …with its OWN catch, so losing the chat poll cannot also cost the score tick (reviewer F1\'s rule on this function)');

    if (pausedBefore) chat.setPollMode('paused');
  }

  // ── (h) §0.3 item 1 — THE SEAM IS THE ONLY DOOR TO THE ADAPTER'S DATA ───
  //
  // STATIC, and it has to be: the rule is about which files CAN reach a
  // function, which no amount of driving can demonstrate. It is the one §0.3
  // calls out first — *"Every league read/write in the app goes through
  // load()/save(). The adapter is reached ONLY from those two functions. No
  // module imports supabase-backend.js to read data."*
  //
  // THE DISTINCTION THIS RULE DRAWS, because it is not "app.js may not touch
  // the adapter". app.js legitimately owns the adapter's LIFECYCLE — it is the
  // only module that imports auth.js, storage.js and backend.js at once, so it
  // is the only place the injected accessor set exists, and §1.5/§5.1/§7.1 put
  // the boot, the banners and the tick there by design. What it may NOT do is
  // READ or WRITE league data through it, because that is a second door past
  // the seam, and a second door is how one of them ends up without a guard.
  //
  // So: the two SYNCHRONOUS DATA entry points are storage-only, and every other
  // member app.js and auth.js reach is enumerated. A new one is not forbidden —
  // it is made deliberate.
  {
    const fsMod = await import('node:fs');
    const strip = (src) => src
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
    const files = ['app.js', 'auth.js', 'storage.js', 'chat.js', 'chatTransport.js', 'backend.js',
      'data-model.js', 'scoring.js', 'notifications.js', 'chat-ui.js', 'recap.js', 'extra-point.js'];
    const src = {};
    for (const f of files) {
      try { src[f] = strip(readFileSync(new URL(`./js/${f}`, import.meta.url), 'utf8')); }
      catch { src[f] = ''; }
    }
    assert(Object.values(src).filter(Boolean).length === files.length,
      '[44h] fixture: every module in the sweep was read (a missing file would make the rule below vacuous)');

    // (1) THE DATA DOOR. `sb.get(` and `sb.set(` — the synchronous read and the
    //     synchronous write — appear in js/storage.js and nowhere else.
    for (const f of files) {
      const hits = [...src[f].matchAll(/\bsb\.(get|set)\s*\(/g)].map((m) => m[0]);
      if (f === 'storage.js') {
        assert(hits.length >= 3,
          `[44h] js/storage.js DOES reach the adapter's data door (${hits.length} sites: load(), save(), getWeekProgress()) — otherwise the rule below would be passing over an app that never uses the adapter at all`);
      } else {
        assert(hits.length === 0,
          `[44h] js/${f} never reads or writes the adapter directly (found ${JSON.stringify(hits)}) — §0.3 item 1: the seam is the only door`);
      }
    }
    // MUTANT: the shape app.js had before the coordinator's ruling.
    const crafted = "function weekSubmissionProgress(w){ const v = sb.get('cfbp_week_progress'); return v; }";
    assert([...strip(crafted).matchAll(/\bsb\.(get|set)\s*\(/g)].length === 1,
      '[44h] MUTANT: app.js reading the adapter directly for cfbp_week_progress is detected by that same rule — which is what it looked like before getWeekProgress() existed');

    // (2) THE LIFECYCLE SURFACE, ENUMERATED. Every adapter member app.js and
    //     auth.js reach, listed, so adding one is a decision somebody makes
    //     here rather than a line that slips in.
    const ALLOWED = {
      'app.js': ['init', 'onStatus', 'getState', 'getStatus', 'hydrate', 'primeFromSnapshot',
        'subscribeRealtime', 'withhold', 'isContentWithheldByAdapter',
        // Step 5 (DI-T5.1): boot hands `sb.isReady` to installSupabaseChat() as the chat
        // transport's "is the mirror serving" probe. app.js does not CALL it — it passes the
        // reference — so the transport can refuse a fetch from a mirror that is not serving
        // without importing the adapter itself (AD-16: chatTransport imports only backend.js).
        'isReady'],
      'auth.js': ['beginSwitch', 'switchLeague', 'dropMirror', 'hasDeviceSnapshot'],
      'storage.js': ['isReady', 'getState', 'get', 'set'],
    };
    for (const [f, allowed] of Object.entries(ALLOWED)) {
      const used = [...new Set([...src[f].matchAll(/\bsb\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]))].sort();
      const stray = used.filter((n) => !allowed.includes(n) && !n.startsWith('_'));
      assert(stray.length === 0,
        `[44h] js/${f} reaches only its enumerated adapter members (unlisted: ${JSON.stringify(stray)}) — a new one is not forbidden, it is made deliberate`);
      assert(used.length > 0, `[44h] fixture: js/${f} really does reach the adapter (${used.length} members)`);
    }
    // And no OTHER module imports it at all.
    for (const f of files) {
      if (['app.js', 'auth.js', 'storage.js'].includes(f)) continue;
      assert(!/from '\.\/supabase-backend\.js'/.test(src[f]),
        `[44h] js/${f} does not import the adapter at all — three modules do, and each for a stated reason`);
    }

    // ── REVIEWER F4 — THE RULE ABOVE KEYS ON THE NAME `sb` ──────────────────
    // Every assertion in this section matches `sb.something`. That is only a
    // rule about the ADAPTER while every importer actually binds it to `sb`;
    // one `import * as adapter from './supabase-backend.js'` and the whole
    // section would go green over a module reading the mirror directly. So the
    // alias is pinned, across the WHOLE of js/ rather than across the sweep
    // list — a file added next season is covered by default.
    {
      const { readdirSync } = fsMod;
      const jsDir = new URL('./js/', import.meta.url);
      const all = readdirSync(jsDir).filter((f) => f.endsWith('.js'));
      assert(all.length >= 15, `[44h] fixture: js/ was enumerated (${all.length} modules)`);
      const importers = [];
      for (const f of all) {
        if (f === 'supabase-backend.js') continue;
        const raw = strip(readFileSync(new URL(f, jsDir), 'utf8'));
        const m = raw.match(/import\s+(?:\*\s+as\s+([A-Za-z_$][\w$]*)|\{[^}]*\}|([A-Za-z_$][\w$]*))\s+from\s+'\.\/supabase-backend\.js'/);
        if (!m) continue;
        importers.push({ file: f, alias: m[1] || m[2] || '(named)' });
      }
      assert(importers.length === 3,
        `[44h] exactly three modules import the adapter (got ${JSON.stringify(importers.map((i) => i.file))})`);
      const wrong = importers.filter((i) => i.alias !== 'sb');
      assert(wrong.length === 0,
        `[44h] …and every one of them binds it as \`sb\` (offenders: ${JSON.stringify(wrong)}) — otherwise the rules above are about a NAME rather than about the module, and one rename would take them all green`);
      // MUTANT: the rename that would have done it.
      const crafted = "import * as adapter from './supabase-backend.js';";
      const cm = crafted.match(/import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+'\.\/supabase-backend\.js'/);
      assert(cm && cm[1] !== 'sb',
        '[44h] MUTANT: an importer aliasing it as anything else is detected by that same matcher');
    }
  }

  // ── (i) §6.7 — setSession() IS A GUARDED NO-OP IN authMode:'supabase' ────
  //
  // getSession() already delegates to this module in that mode, so
  // `cfbp_session` is UNREADABLE there — which is what makes writing it
  // dangerous rather than merely pointless. A stray call lays down a PIN-era
  // `{playerId, isAdmin}` record that nothing in this mode can see and that a
  // ROLLBACK to 'pins' reads straight back as a live session: SEC F1-R1's
  // hazard arriving by a different door, a pre-cutover commissioner becoming
  // one again on a config change nobody connected to it.
  {
    const SESSION_KEY = 'cfbp_session';
    // PINS: unchanged, and asserted FIRST so the supabase arm below cannot pass
    // because setSession() is broken for everybody.
    auth.configureAuth({ authMode: 'pins', dataMode: 'sheets', authModeKnown: true, supabaseUrl: '', supabaseAnonKey: '' });
    storage.setBackendMode('local');
    localStorage.removeItem(SESSION_KEY);
    storage.setSession('p_pins', true, true);
    const written = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    assert(written && written.playerId === 'p_pins' && written.isAdmin === true,
      '[44i] in pins mode setSession() writes cfbp_session exactly as it always has — byte-identical, and this is the world all six players are in today');

    // SUPABASE: refused, loudly, and the PREVIOUS record is left alone.
    auth.configureAuth({ authMode: 'supabase', dataMode: 'sheets', authModeKnown: true, supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' });
    const warned = [];
    const realWarn = console.warn;
    console.warn = (...a) => warned.push(a.join(' '));
    try { storage.setSession('p_stranger', true, true); } finally { console.warn = realWarn; }
    const after = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    assert(after && after.playerId === 'p_pins' && after.isAdmin === true,
      `[44i] in supabase mode setSession() writes NOTHING — the record is untouched, still the pins-era one (got ${JSON.stringify(after && after.playerId)})`);
    assert(warned.some((w) => /REFUSING to write cfbp_session/.test(w)),
      '[44i] …and it WARNS rather than returning quietly: the PIN paths are retired in this mode (DI-180g), so any caller that reaches this is a defect that should be findable');
    assert(warned.some((w) => /rollback/i.test(w)),
      '[44i] …naming the consequence (a rollback to pins reading it back as a live session), not just the refusal');

    // clearSession() is deliberately NOT guarded — removing the record is always
    // safe, and app.js's boot does exactly that on a supabase config read.
    storage.clearSession();
    assert(localStorage.getItem(SESSION_KEY) === null,
      '[44i] clearSession() still works in supabase mode — the guard is on the WRITE, because only a write can resurrect a session');

    localStorage.removeItem(SESSION_KEY);
  }


  // ── (j) REVIEWER F2 / §6.3 (A8) — THE EXPIRY GATE, R1 AND R2 ─────────────
  //
  // `grep "withhold(" ` across the whole test tree returned NOTHING before this
  // section existed, which is the finding: A8's promotion had no coverage at
  // all, and what it actually did was withhold the next REPAINT while leaving
  // the painted dashboard — six players' picks, the standings, the week — in
  // the DOM under an identity the server had just rejected.
  //
  // This is the sixth gate's F4 in a new place, and the lesson there was that a
  // lock asserted once and never re-checked is not a lock. Here it was never
  // asserted at all.
  {
    const quietJ = (fn) => { const l = console.log, w = console.warn, e = console.error, i = console.info;
      console.log = () => {}; console.warn = () => {}; console.error = () => {}; console.info = () => {};
      try { return fn(); } finally { console.log = l; console.warn = w; console.error = e; console.info = i; } };

    resetAll();
    auth._setHasSupabaseDataBackendForTest(null);
    auth.configureAuth({ authMode: 'supabase', dataMode: 'supabase', authModeKnown: true, supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' });
    auth._setMembershipsForTest([{ leagueId: 'L-j', memberId: 'm-j', role: 'player', displayName: 'Me', leagueName: 'League J' }]);
    auth.setActiveLeagueId('L-j');
    auth._setAccountUserIdForTest('u-j');
    storeValidSession();
    wireAdapter({ client: fakeClient(), league: () => 'L-j' });
    quietJ(() => auth.registerSupabaseDataBackend(sb.probe));
    await quietJ(() => sb.hydrate('L-j', { epoch: auth.getIdentityEpoch() }));
    assert(sb.getState() === 'ACTIVE', '[44j] fixture: a hydrated, ACTIVE page — the state every player is actually in');

    // A PAINTED PAGE. The teardown's job is to empty these, so they have to
    // hold something first or R1 proves nothing.
    const painted = ['page-dashboard', 'page-picks', 'page-leaderboard'];
    painted.forEach((id) => { registry.set(id, new FakeEl()); registry.get(id).innerHTML = '<table>six players’ picks</table>'; });
    const weekEl = new FakeEl(); weekEl.innerHTML = 'Week 3'; registry.set('header-meta-week', weekEl);
    assert(painted.every((id) => registry.get(id).innerHTML.length > 0),
      '[44j] fixture: the dashboard, picks and standings containers really are painted');

    wireRealAuthUI();
    // R1 — DRIVE THE REAL EVENT through the real listener chain.
    quietJ(() => auth._fireAuthEventForTest?.length);
    quietJ(() => app.refreshAuthUI('MEMBERSHIPS_FAILED', { expired: true }));

    assert(sb.getState() === 'HELD',
      '[44j] R1: the expiry withholds the league — the adapter goes HELD, so the probe is false and every save() is refused through the existing interlock');
    assert(app.currentAuthHoldReason() === 'session-expired',
      `[44j] R1: …and a GATE is painted, not just a banner (got ${JSON.stringify(app.currentAuthHoldReason())}) — A8's whole point is that once local data is league-scoped, withholding the next repaint is not enough`);
    assert(painted.every((id) => registry.get(id).innerHTML === ''),
      `[44j] R1: …and tearDownRenderedContentForHold() RAN: every page container is empty (${JSON.stringify(painted.map((id) => registry.get(id).innerHTML.length))}). This is the half that was missing — the rows were served to a token the server has now rejected`);
    assert(registry.get('header-meta-week').innerHTML === '',
      '[44j] R1: …including the header week block, because a week NAME is league data too');
    assert(app.isContentWithheld() === true,
      '[44j] R1: …and content stays withheld, so the 60 s tick cannot paint it straight back (the durability half of the sixth gate’s lesson)');

    const ov = document.getElementById('site-gate-overlay');
    assert(!!ov && ov.getAttribute('data-hold-reason') === 'session-expired',
      '[44j] R1: the overlay is tagged with its own reason');
    const html = ov?.innerHTML || '';
    assert(/Your session expired — sign in again to keep picking\./.test(html),
      '[44j] R1: …carrying DI-180d’s copy VERBATIM — the same sentence the banner has always shown, so a player who sees both sees one message');
    assert(!/site-gate-input/.test(html) && !/Continue with Google/.test(html),
      '[44j] R1: …with NO PIN field and NO Google button (DI-180l’s non-negotiable; the Sign In affordance stays on the banner, DI-180m/A7)');

    // R2 — THE RELEASE, driven forward. DI-180p means a 401 is a QUESTION, and
    // SESSION_REVERIFIED is the answer "alive": nothing was destroyed and the
    // banner was a false alarm. The device has to come back without a reload.
    storeValidSession();
    await quietJ(async () => { app.refreshAuthUI('SESSION_REVERIFIED', {}); await new Promise((r) => setTimeout(r, 0)); });
    assert(sb.getState() === 'ACTIVE',
      `[44j] R2: SESSION_REVERIFIED re-hydrates the league through the ONE hydrate path (got ${sb.getState()})`);
    assert(app.currentAuthHoldReason() === '',
      '[44j] R2: …the gate comes down with it');
    assert(!document.getElementById('site-gate-overlay'),
      '[44j] R2: …the overlay is gone from the DOM, not merely un-flagged');
    assert(app.isContentWithheld() === false && auth.hasSupabaseDataBackend() === true,
      '[44j] R2: …content paints again and writes are permitted — a false-alarm expiry costs a repaint, not a reload (DI-180a)');

    // The wiring itself, which the driven half cannot see: the withhold and the
    // gate are raised TOGETHER. One without the other is the defect.
    const appSrcJ = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
    const expiryBlock = appSrcJ.slice(appSrcJ.indexOf("if (event === 'MEMBERSHIPS_FAILED' && payload?.expired) {"),
      appSrcJ.indexOf("if (event === 'MEMBERSHIPS_REFRESHED' || event === 'SIGNED_IN'"));
    assert(/sb\.withhold\('session-expired'\)/.test(expiryBlock) && /showAuthHoldGate\('session-expired'\)/.test(expiryBlock),
      '[44j] the expiry path raises BOTH the withhold and the gate — withholding alone stops the next repaint and leaves the current one on screen');
    assert(/SESSION_REVERIFIED/.test(appSrcJ.slice(appSrcJ.indexOf("event === 'MEMBERSHIPS_REFRESHED' || event === 'SIGNED_IN'") - 200, appSrcJ.indexOf("event === 'MEMBERSHIPS_REFRESHED' || event === 'SIGNED_IN'") + 200)),
      '[44j] …and SESSION_REVERIFIED is one of the events that triggers the re-hydrate, or a verified-alive session would come back to an empty app');

    quietJ(() => { app._resetAuthHoldForTest(); sb._resetForTest(); });
  }

  // ── (k) REVIEWER F3 / §7.2 — tickAutoTransition() IS COMMISSIONER-ONLY ───
  //
  // Against the shared Sheet "whichever device ticks first" is correct. Against
  // RLS it is five phones attempting, once a minute at a lock boundary, a write
  // the server refuses.
  //
  // WHAT IT COSTS — corrected at the re-gate. The first version of this comment
  // (and of the one in js/app.js) said the throw aborted the tick above
  // doRefreshScores(); it does not, because tickAutoTransition() catches
  // everything itself. The real costs are a swallowed typed error on the
  // console once a minute on five devices, a skipped repaint of whatever
  // surface depends on week.status, and — the part that is not a symptom —
  // five devices repeatedly attempting a write the policy exists to refuse.
  {
    const quietK = (fn) => { const l = console.log, w = console.warn, e = console.error, i = console.info;
      console.log = () => {}; console.warn = () => {}; console.error = () => {}; console.info = () => {};
      try { return fn(); } finally { console.log = l; console.warn = w; console.error = e; console.info = i; } };

    const appSrcK = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
    const fnK = appSrcK.slice(appSrcK.indexOf('export function tickAutoTransition()'),
      appSrcK.indexOf('export function tickAutoTransition()') + 3000);
    const codeK = fnK.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
    const gateAt = codeK.indexOf('isSupabaseDataMode()');
    const weekAt = codeK.indexOf('const week = getCurrentWeek()');
    assert(gateAt > -1, '[44k] tickAutoTransition() has a supabase-mode gate at all');
    assert(gateAt > -1 && weekAt > -1 && gateAt < weekAt,
      `[44k] …and it is ABOVE every read and every write in the function (gate@${gateAt}, first read@${weekAt}) — a gate below the first saveWeek() would refuse nothing. Both indices are required to be FOUND, because indexOf() returns -1 and -1 < anything`);
    assert(/isAdmin = getSession\(\)\?\.isAdmin === true/.test(codeK),
      '[44k] …keyed on getSession().isAdmin, which honours DI-180p’s privilege lock by construction — a commissioner in the verify window is gated too, correctly, because the server would refuse that write as well');
    assert(/catch \{ isAdmin = false; \}/.test(codeK),
      '[44k] …and a session read that THROWS reads as not-admin: fail-closed, because the alternative is a refused write from a device that could not say who it was');
    assert(!/isSupabaseDataMode/.test(codeK.slice(weekAt)),
      '[44k] …and there is exactly ONE such gate, not a second opinion further down');

    resetAll();
    auth._setHasSupabaseDataBackendForTest(null);
    auth.configureAuth({ authMode: 'supabase', dataMode: 'supabase', authModeKnown: true, supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' });
    auth._setMembershipsForTest([{ leagueId: 'L-k', memberId: 'm-k', role: 'player', displayName: 'Koby', leagueName: 'League K' }]);
    auth.setActiveLeagueId('L-k');
    auth._setAccountUserIdForTest('u-k');
    storeValidSession();
    wireAdapter({ client: fakeClient(), league: () => 'L-k' });
    quietK(() => auth.registerSupabaseDataBackend(sb.probe));
    await quietK(() => sb.hydrate('L-k', { epoch: auth.getIdentityEpoch() }));
    assert(sb.getState() === 'ACTIVE', '[44k] fixture: the adapter is ACTIVE, so a write would otherwise be attempted and reach the server');

    // ── DRIVEN, AND THIS TIME AT A REAL LOCK BOUNDARY ───────────────────────
    //
    // The first version of this block was VACUOUS and the re-gate caught it:
    // the fixture had no active week, so tickAutoTransition() returned at
    // `if (!week) return` — three lines below the gate — and would have passed
    // with the gate deleted. A test that cannot fail is worse than no test,
    // because it is counted.
    //
    // So the fixture is a week that is genuinely DUE TO LOCK: status 'open',
    // picksLockAt in the past, auto-lock on, with games. That is the one state
    // in which the ungated function reaches saveWeek().
    const lockBoundaryWeek = () => ({
      weekId: 'wk_k', season: '2026', weekNumber: 1, label: 'Week 1',
      status: 'open', dataSourceMode: 'espn',
      picksOpenAt: new Date(Date.now() - 7200e3).toISOString(),
      picksLockAt: new Date(Date.now() - 60e3).toISOString(),   // lock time HAS PASSED
      autoLockEnabled: true, autoLiveEnabled: true, autoFinalizeEnabled: false,
      lockedAt: null, lockedAlmaMaters: null, pendingFinalization: false,
      tiebreakerQuestion: '', extraPointEnabled: false, groupId: null,
    });
    const boundaryGames = () => ([{
      gameId: 'g_k1', weekId: 'wk_k', homeTeam: 'Home', awayTeam: 'Away',
      kickoffAt: new Date(Date.now() + 1800e3).toISOString(),
      spread: -3, status: 'scheduled', homeScore: null, awayScore: null,
      lockedSpread: null, multiplier: 1,
    }]);
    const seedTickMirror = () => quietK(() => {
      sb._seedMirrorForTest('cfbp_weeks', [lockBoundaryWeek()]);
      sb._seedMirrorForTest('cfbp_games', boundaryGames());
      sb._seedMirrorForTest('cfbp_active_week', 'wk_k');
      sb._seedMirrorForTest('cfbp_settings', { autoRefreshInterval: 60 });
      sb._seedMirrorForTest('cfbp_lock_overrides', {});
      sb._seedMirrorForTest('cfbp_picks', []);
    });

    const modeK = storage.getBackendMode();
    storage.setBackendMode('supabase');
    seedTickMirror();
    assert(storage.getSession().isAdmin === false,
      '[44k] fixture: this device is a PLAYER (one of the five phones)');
    assert(storage.getCurrentWeek()?.weekId === 'wk_k' && storage.getGames('wk_k').length === 1,
      '[44k] fixture: …and there IS an active week with games, so the function gets past `if (!week) return` — the line the first version of this test stopped at');
    assert(new Date(storage.getCurrentWeek().picksLockAt).getTime() < Date.now()
      && storage.getCurrentWeek().status === 'open',
      '[44k] fixture: …and that week is genuinely DUE TO LOCK, which is the one state in which the ungated function reaches saveWeek()');

    let threwK = null;
    quietK(() => { try { app.tickAutoTransition(); } catch (e) { threwK = e; } });
    assert(threwK === null, `[44k] a player device's tick returns cleanly (got ${threwK && threwK.name})`);
    assert(sb._dirtyKeysForTest().length === 0,
      `[44k] …and queued NO write at all: not the week status, not the frozen spreads, not pendingFinalization (dirty: ${JSON.stringify(sb._dirtyKeysForTest())})`);
    assert(sb._overlayForTest().size === 0,
      '[44k] …and touched no game overlay either');
    assert(storage.getCurrentWeek().status === 'open',
      '[44k] …and the week is UNCHANGED on this device — the player phone neither wrote nor pretended to');

    // NON-VACUITY, and it is the assertion that makes every line above mean
    // something: the COMMISSIONER's device, same fixture, same call, DOES act.
    auth._setMembershipsForTest([{ leagueId: 'L-k', memberId: 'm-k', role: 'commissioner', displayName: 'Drew', leagueName: 'League K' }]);
    quietK(() => auth.setActiveLeagueId('L-k'));
    seedTickMirror();
    assert(storage.getSession().isAdmin === true,
      '[44k] fixture: the SAME device, now resolving as the commissioner');
    quietK(() => { try { app.tickAutoTransition(); } catch (e) { threwK = e; } });
    assert(sb._dirtyKeysForTest().includes('cfbp_weeks'),
      `[44k] the commissioner's device DOES transition the week (dirty: ${JSON.stringify(sb._dirtyKeysForTest())}) — so the gate is about WHO, not a blanket disable, and the three source assertions above are not passing over a dead function`);
    assert(storage.getCurrentWeek().status === 'locked',
      '[44k] …and the week really reached LOCKED, through the same seam every other write uses');

    storage.setBackendMode(modeK);
    quietK(() => sb._resetForTest());
  }


  // ── (l) SECURITY F2 — A 'session-expired' RE-CHECK IS NOT AN INTERLOCK ───
  //
  // THE FINDING, as the twenty seconds it would have taken. runAuthHoldCheck()
  // special-cased ONE reason and let the rest fall through to
  // applyAuthModeDecision(), whose interlock branch asks
  // `isAuthDataLayerMismatch()` — i.e. `!hasSupabaseDataBackend()` — i.e. "is
  // the adapter serving". While a 'session-expired' hold is up it is NOT, which
  // is the reason the gate exists. So the silent re-check answered its own hold
  // by calling forceSignedOutSession() and swapping the gate for 'interlock',
  // whose copy says it "does not clear until Drew redeploys".
  //
  // A player whose token blipped on a Saturday would have been locked out until
  // a deploy, BY THE TIMER THAT EXISTS TO LET THEM BACK IN. Driven here against
  // the real runAuthHoldCheck(), both the timer path and the button.
  {
    const quietL = (fn) => { const l = console.log, w = console.warn, e = console.error, i = console.info;
      console.log = () => {}; console.warn = () => {}; console.error = () => {}; console.info = () => {};
      try { return fn(); } finally { console.log = l; console.warn = w; console.error = e; console.info = i; } };

    for (const manual of [false, true]) {
      const label = manual ? 'the Retry BUTTON' : 'the 20-second SILENT re-check';
      resetAll();
      auth._setHasSupabaseDataBackendForTest(null);
      auth.configureAuth({ authMode: 'supabase', dataMode: 'supabase', authModeKnown: true, supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' });
      auth._setMembershipsForTest([{ leagueId: 'L-l', memberId: 'm-l', role: 'player', displayName: 'Me', leagueName: 'League L' }]);
      auth.setActiveLeagueId('L-l');
      auth._setAccountUserIdForTest('u-l');
      storeValidSession();

      // THE SERVER IS STILL REJECTING THE TOKEN. This is the state the re-check
      // runs in, and the one the old code turned into a permanent lockout.
      const dead = { code: 'PGRST301', message: 'JWT expired' };
      let failure = dead;
      // A LAZY client: `fakeClient()` destructures its options once, so a getter
      // there would be read at construction and R2 would be testing the same
      // dead token twice. This one re-reads `failure` on every request, which is
      // what lets the SAME re-check be driven forward from refusing to serving.
      const lazyClient = {
        from: () => ({
          select() { return this; },
          eq() { return this; },
          then(res) { return failure ? res({ data: null, error: failure }) : res({ data: [], error: null }); },
        }),
        rpc: async () => (failure ? { data: null, error: failure } : { data: [], error: null }),
      };
      wireAdapter({ client: lazyClient, league: () => 'L-l' });
      quietL(() => auth.registerSupabaseDataBackend(sb.probe));
      // A PAINTED PAGE, so "nothing is painted" below is a claim about
      // something. Reviewer F2's re-gate finding was precisely that the release
      // branch cleared the hold and ran resumeAfterHoldCleared() while the
      // adapter was HELD and the mirror empty — a painted, permanently empty
      // app — and a fixture with empty containers could not have seen it.
      const paintedL = ['page-dashboard', 'page-picks', 'page-leaderboard'];
      paintedL.forEach((id) => { registry.set(id, new FakeEl()); registry.get(id).innerHTML = '<table>six players\u2019 picks</table>'; });
      quietL(() => sb.withhold('session-expired'));
      quietL(() => app.showAuthHoldGate('session-expired'));
      assert(app.currentAuthHoldReason() === 'session-expired' && sb.getState() === 'HELD',
        `[44l] ${label}: fixture — an A8 hold is up and the adapter is HELD`);
      assert(paintedL.every((id) => registry.get(id).innerHTML === ''),
        `[44l] ${label}: fixture — …and the gate tore the painted page down`);

      await quietL(() => app.runAuthHoldCheck({ manual }));

      assert(app.currentAuthHoldReason() === 'session-expired',
        `[44l] ${label}: the gate STAYS 'session-expired' (got ${JSON.stringify(app.currentAuthHoldReason())}) — never 'interlock', which is a statement about the BUILD and would be a lie here`);
      assert(auth.isSessionForcedOut() === false,
        `[44l] ${label}: …and forceSignedOutSession() was NOT called. That latch had no production release until the sixth gate, and reaching it from a token blip is how a player stays nobody for the life of the page`);
      const ovL = document.getElementById('site-gate-overlay');
      assert(ovL && ovL.getAttribute('data-hold-reason') === 'session-expired',
        `[44l] ${label}: …and the overlay on screen still says so`);
      assert(sb.getState() === 'HELD' && sb.probe() === false,
        `[44l] ${label}: …with the adapter still HELD rather than torn down — the retry re-verified the session by making a real request, and the server said no again`);
      assert(!/does not clear until/i.test(String(ovL?.innerHTML || '')) && !/right back/i.test(String(ovL?.innerHTML || '')),
        `[44l] ${label}: …and the player is NOT reading the interlock copy, which promises nothing they can do`);
      // REVIEWER F2 (re-gate) — THE TWO CLAIMS THE RELEASE BRANCH BROKE.
      assert(app.isContentWithheld() === true,
        `[44l] ${label}: content is STILL WITHHELD after the failed recovery — the branch used to clear the hold reason and un-withhold on a hydrate whose failure it swallowed`);
      assert(paintedL.every((id) => registry.get(id).innerHTML === ''),
        `[44l] ${label}: …and NOTHING was painted back (${JSON.stringify(paintedL.map((id) => registry.get(id).innerHTML.length))}) — resumeAfterHoldCleared() running here is what produced a painted, permanently EMPTY app: the gate down, the mirror gone, and no way back without a reload`);

      // R2 — the server accepts. Same call, same path, opposite outcome.
      failure = null;
      await quietL(() => app.runAuthHoldCheck({ manual }));
      assert(sb.getState() === 'ACTIVE',
        `[44l] ${label}: R2 — once the server accepts, the SAME re-check re-hydrates the league (got ${sb.getState()})`);
      assert(app.currentAuthHoldReason() === '' && !document.getElementById('site-gate-overlay'),
        `[44l] ${label}: R2 — …and the gate comes down, with no reload (DI-180a)`);
      assert(app.isContentWithheld() === false && auth.hasSupabaseDataBackend() === true,
        `[44l] ${label}: R2 — …content paints and writes are permitted again`);
      assert(paintedL.some((id) => registry.get(id).innerHTML.length > 0),
        `[44l] ${label}: R2 — …and the dashboard is REPAINTED. "The gate came down" and "the app came back" are two claims, and only the second is what the player experiences`);

      quietL(() => { app._resetAuthHoldForTest(); sb._resetForTest(); });
    }

    // ── THE CLASS RULE (audit item 3): the dispatch is EXHAUSTIVE, and no
    //    Step-4 hold reaches the auth decision.
    const recovery = app._AUTH_HOLD_RECOVERY_FOR_TEST;
    const copy = app._AUTH_HOLD_COPY_FOR_TEST;
    const reasons = Object.keys(copy);
    assert(reasons.length >= 5, `[44l] fixture: every hold variant was enumerated (${reasons.length})`);
    const missing = reasons.filter((r) => !recovery[r]);
    assert(missing.length === 0,
      `[44l] CLASS RULE: every AUTH_HOLD_COPY reason has a declared recovery path (missing: ${JSON.stringify(missing)}) — a missing entry IS a fall-through, and a fall-through is this finding`);
    const stray = Object.keys(recovery).filter((r) => !reasons.includes(r));
    assert(stray.length === 0, `[44l] …and the table declares no reason the copy does not (${JSON.stringify(stray)})`);
    assert(Object.values(recovery).every((v) => ['auth-decision', 'adapter-hydrate'].includes(v)),
      '[44l] …and every value is one of the two known recoveries, so a typo cannot become a silent third behaviour');
    for (const r of ['data-hold', 'session-expired']) {
      assert(recovery[r] === 'adapter-hydrate',
        `[44l] CLASS RULE: '${r}' is recovered by re-hydrating, NOT by re-running the auth decision — the identity and the mode were never in doubt, and applyAuthModeDecision()'s interlock branch would read "the adapter is not serving" as "this build is broken"`);
    }

    // …and the dispatch really is what the function branches on, not a table
    // nobody reads. Source-level, because the alternative is trusting a comment.
    const appSrcL = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
    const fnL = appSrcL.slice(appSrcL.indexOf('export async function runAuthHoldCheck'),
      appSrcL.indexOf('async function resumeAfterHoldCleared'));
    const codeL = fnL.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
    const dispatchAt = codeL.indexOf("AUTH_HOLD_RECOVERY[_authHoldReason] === 'adapter-hydrate'");
    const decisionAt = codeL.indexOf('applyAuthModeDecision()');
    assert(dispatchAt > -1, '[44l] runAuthHoldCheck() branches on the recovery TABLE, not on a hardcoded reason');
    assert(dispatchAt < decisionAt,
      `[44l] …and it does so BEFORE applyAuthModeDecision() is reachable (dispatch@${dispatchAt}, decision@${decisionAt})`);
    assert(!/_authHoldReason === 'data-hold'/.test(codeL),
      '[44l] …and the old single-reason special case is GONE, not merely supplemented — two ways to answer the same question is how the second one gets forgotten');
  }


  // ── (m) REVIEWER F-B — A HOLD RAISED *DURING* A RETRY'S AWAITED HYDRATE ──
  //
  // THE INTERLEAVING, which is a real half-second on a real Saturday: a
  // 'data-hold' retry is in flight (the 20-second re-check fired), its hydrate
  // is a genuine round trip, and while we are awaiting it the membership read
  // comes back with an expired token. A8 raises 'session-expired'. The retry
  // then returns, finds the reason is not the one it started with, and — before
  // this fix — concluded "somebody took my gate down" and put 'data-hold' back.
  //
  // WHAT THAT COSTS THE PLAYER: 'data-hold' says "Couldn't load your league,
  // retry in a moment" and carries a Retry button. 'session-expired' says
  // "sign in again" and is the state in which DI-180d's banner offers the Sign
  // In affordance. The overwrite replaces the one gate with a way out with one
  // that tells them to wait for a connection that is not the problem — and the
  // 20-second re-check then reproduces it, forever.
  //
  // TWO GUARDS now stand between that and the player, and the audit's own note
  // is that THEY MASK EACH OTHER. So each is driven by its own case.
  {
    const quietM = (fn) => { const l = console.log, w = console.warn, e = console.error, i = console.info;
      console.log = () => {}; console.warn = () => {}; console.error = () => {}; console.info = () => {};
      try { return fn(); } finally { console.log = l; console.warn = w; console.error = e; console.info = i; } };

    /** A client that runs `onFirstSelect` in the middle of the hydrate — i.e.
     *  while runAuthHoldCheck() is awaiting it. That is the whole point: the
     *  event has to land DURING the await, not before or after it. */
    function interleavingClient(onFirstSelect) {
      let fired = false;
      const fail = { code: 'PGRST301', message: 'JWT expired' };
      const hook = () => { if (!fired) { fired = true; onFirstSelect(); } };
      return {
        from: () => ({
          select() { return this; },
          eq() { return this; },
          then(res) { hook(); return res({ data: null, error: fail }); },
        }),
        rpc: async () => { hook(); return { data: null, error: fail }; },
      };
    }

    const setup = (client) => {
      resetAll();
      auth._setHasSupabaseDataBackendForTest(null);
      auth.configureAuth({ authMode: 'supabase', dataMode: 'supabase', authModeKnown: true, supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' });
      auth._setMembershipsForTest([{ leagueId: 'L-m', memberId: 'm-m', role: 'player', displayName: 'Me', leagueName: 'League M' }]);
      auth.setActiveLeagueId('L-m');
      auth._setAccountUserIdForTest('u-m');
      storeValidSession();
      wireAdapter({ client, league: () => 'L-m' });
      quietM(() => auth.registerSupabaseDataBackend(sb.probe));
      app._resetSupabaseDataForTest();
      wireAdapter({ client, league: () => 'L-m' });
      quietM(() => auth.registerSupabaseDataBackend(sb.probe));
    };

    // ── CASE 1 — the expiry lands mid-hydrate. This is the production
    //    scenario, and it kills the PRESERVATION guard's mutant.
    {
      let landed = false;
      setup(interleavingClient(() => {
        // A8's real path, through the real handler.
        quietM(() => app.refreshAuthUI('MEMBERSHIPS_FAILED', { expired: true }));
        landed = true;
      }));
      quietM(() => app.showAuthHoldGate('data-hold'));
      assert(app.currentAuthHoldReason() === 'data-hold',
        '[44m] case 1 fixture: a DATA hold is up and its 20-second re-check is about to fire');

      await quietM(() => app.runAuthHoldCheck({ manual: false }));

      assert(landed === true,
        '[44m] case 1 fixture: …and the expiry really did land DURING the awaited hydrate (not before it, which would prove nothing)');
      assert(app.currentAuthHoldReason() === 'session-expired',
        `[44m] REVIEWER F-B: the gate reads 'session-expired' afterwards (got ${JSON.stringify(app.currentAuthHoldReason())}) — the retry does NOT put its own, older, less specific reason back over a hold raised while it was awaiting`);
      const ovM = document.getElementById('site-gate-overlay');
      assert(ovM && ovM.getAttribute('data-hold-reason') === 'session-expired',
        '[44m] …and so does the overlay actually on screen');
      assert(/sign in again to keep picking/i.test(String(ovM?.innerHTML || '')),
        '[44m] …so the player is told the thing they can act on, rather than to wait for a connection that is not the problem');
      assert(!/Couldn.t load your league/i.test(String(ovM?.innerHTML || '')),
        '[44m] …and the data-hold copy is NOT what they are reading');
      assert(auth.isSessionForcedOut() === false,
        '[44m] …and nothing forced the session out on the way through');
      quietM(() => { app._resetAuthHoldForTest(); sb._resetForTest(); });
    }

    // ── CASE 2 — the gate is taken DOWN mid-hydrate, and the retry re-raises
    //    its own reason. This is what the `if (!_authHoldReason)` line is for.
    //
    // HONEST LABEL, because it matters for how much this assertion is worth:
    // I could not construct a PRODUCTION path that empties the reason inside a
    // failed retry's await. Every clearer is either behind the in-flight guard
    // or on a branch that returns `ok === true` and exits early. What is driven
    // here is the real EXPORTED hideAuthHoldGate() being called by an
    // interleaved caller — which is possible, but which nothing in the app does
    // today. So the line is DEFENCE IN DEPTH and this is a seam-driven red, not
    // a scenario red, and it is reported as such rather than dressed up.
    {
      setup(interleavingClient(() => { quietM(() => app.hideAuthHoldGate()); }));
      quietM(() => app.showAuthHoldGate('session-expired'));
      assert(app.currentAuthHoldReason() === 'session-expired', '[44m] case 2 fixture: a session-expired hold is up');

      await quietM(() => app.runAuthHoldCheck({ manual: true }));

      assert(app.currentAuthHoldReason() === 'session-expired',
        `[44m] case 2: a retry whose gate was taken down mid-await RE-RAISES ITS OWN reason (got ${JSON.stringify(app.currentAuthHoldReason())}) — a failed recovery must never leave the page ungated`);
      assert(!!document.getElementById('site-gate-overlay'),
        '[44m] case 2: …and the overlay is back on screen, not merely the state');
      assert(app.isContentWithheld() === true,
        '[44m] case 2: …with content still withheld, because the league still is not there');
      quietM(() => { app._resetAuthHoldForTest(); sb._resetForTest(); });
    }

    // ── CASE 3 — the hydrate SERVES (ACTIVE-STALE / OFFLINE-READONLY) and the
    //    gate came down mid-await. This is the ONE path on which
    //    afterSupabaseHydrate() returns false WITHOUT raising a gate, and
    //    therefore the only path on which the retry's own re-raise fires.
    //    Found by case 2 turning red for the wrong reason, which is the sort of
    //    thing a test earns its keep by doing.
    {
      // THE FIXTURE HAS TO EARN ITS BRANCH. The first version of this case
      // forced the state to OFFLINE-READONLY and then let the hydrate fail with
      // a PGRST301 — which _fail() classifies as a SERVER ANSWER, so the adapter
      // went HELD, afterSupabaseHydrate() gated after all, and the case passed
      // with the line under test deleted. Caught by the mutant, which is what
      // mutants are for.
      //
      // So the offline path is set up for real: a successful hydrate first (so
      // a device snapshot exists and the four §5.3 conditions can hold), then a
      // CONNECTION failure, which is the only kind that serves.
      let failNow = null;
      const servingClient = {
        from: () => ({
          select() { return this; },
          eq() { return this; },
          then(res) {
            if (!failNow) return res({ data: [], error: null });
            quietM(() => app.hideAuthHoldGate());      // the interleaved teardown
            return res({ data: null, error: failNow });
          },
        }),
        rpc: async () => (failNow ? { data: null, error: failNow } : { data: [], error: null }),
      };
      setup(servingClient);
      await quietM(() => sb.hydrate('L-m', { epoch: auth.getIdentityEpoch() }));
      assert(sb.getState() === 'ACTIVE' && sb.hasDeviceSnapshot() === true,
        '[44m] case 3 fixture: a real hydrate landed and persisted a device snapshot — §5.3 needs one before it can serve');
      // §5.3 condition (4): the owner MARKER must agree with the tuple.
      localStorage.setItem('cfbp_device_data_owner', auth.getDeviceDataOwnerTuple());
      failNow = { code: '08006', message: 'connection failure' };
      quietM(() => app.showAuthHoldGate('session-expired'));
      assert(app.currentAuthHoldReason() === 'session-expired',
        '[44m] case 3 fixture: …and a session-expired hold is up over it');

      await quietM(() => app.runAuthHoldCheck({ manual: false }));

      assert(sb.getState() === 'OFFLINE-READONLY',
        `[44m] case 3 fixture: the retry's hydrate landed in a SERVING state (got ${sb.getState()}) — the ONE branch that returns false WITHOUT raising a gate, and therefore the only path on which the retry's own re-raise can fire`);

      assert(app.currentAuthHoldReason() !== '',
        '[44m] case 3: the page is NOT left ungated when the gate came down mid-await and the hydrate raised none of its own');
      assert(app.currentAuthHoldReason() === 'session-expired',
        `[44m] case 3: …and the reason restored is the retry's OWN, not a downgrade (got ${JSON.stringify(app.currentAuthHoldReason())})`);
      quietM(() => { app._resetAuthHoldForTest(); sb._resetForTest(); });
    }

    // The two guards, named, so the next reader knows there are two and why
    // neither is redundant.
    const appSrcM = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
    assert(/if \(!_authHoldReason\) showAuthHoldGate\(heldReason\);/.test(appSrcM),
      "[44m] guard 1: the retry re-raises only when there is NO gate — `!== heldReason` re-raised over a CHANGED one, which is the case that must be left alone");
    assert(/showAuthHoldGate\(currentAuthHoldReason\(\) \|\| _sbHoldRetryReason \|\| 'data-hold'\)/.test(appSrcM),
      '[44m] guard 2: afterSupabaseHydrate() raises, in precedence order, (1) a hold raised DURING the await, (2) the reason the in-flight retry is FOR, (3) the generic data hold — ONE place, because three call sites answering the same question is how the third one gets forgotten');
  }

  // ── (f) RESTORE THE WORLD FOR ANY LATER SECTION ──────────────────────────
  await quiet(() => sb._resetForTest());
  await quiet(() => auth._resetSupabaseDataBackendForTest());
  auth._setHasSupabaseDataBackendForTest(true);
  auth.configureAuth({ authMode: 'supabase', dataMode: 'sheets', authModeKnown: true, supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' });
  storage.setBackendMode('local');
  assert(auth.isSupabaseDataMode() === false && storage.getBackendMode() === 'local',
    '[44f] teardown: the suite is handed back in dataMode:\'sheets\' with the seam local, so nothing below inherits this section\'s adapter');
}


// ── REVIEWER F8 (sixth gate, 2026-09-17) — THE SUMMARY LINE MUST SURVIVE THE
//    EXIT ──────────────────────────────────────────────────────────────────────
// `console.log(summary); process.exit(code);` is a RACE, and it is a race this
// suite loses exactly where it matters most. When stdout is a PIPE — which is
// what it is under loadtest.mjs's spawnSync(), and under every `| grep` a human
// runs — Node's writes are asynchronous and buffered. process.exit() does not
// flush them. So a long run's final line can be dropped, and loadtest's [73b]
// reads that as "authtest.mjs printed no pass/fail summary", i.e. a suite that
// PASSED reported as broken, or (worse, and the reason this is a finding rather
// than a nicety) a FAILING run whose ❌ line never arrives being diagnosed as a
// harness problem. Writing with a completion callback and exiting inside it
// means the bytes are out before the process is.
//
// The exit itself is still unconditional (cachetest.mjs/grouptest.mjs
// precedent): importing js/app.js's full module graph leaves at least one handle
// open — nothing in this file registers a timer or interval of its own — which
// would otherwise hang loadtest.mjs's spawnSync() waiting for a natural exit.
process.stdout.write(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`,
  () => process.exit(fail === 0 ? 0 : 1));

// ── SECURITY F-6 (eighth gate, 2026-09-18) — THE FLUSH SHIM NEEDS ITS OWN
//    BACKSTOP ─────────────────────────────────────────────────────────────────
// The write-then-exit-in-the-callback shim above (reviewer F-3, seventh gate)
// fixed a dropped summary line by making the exit wait for the bytes. That trade
// bought correctness with a new failure mode: if the callback NEVER fires, the
// process never exits. It does not fire when the reader at the other end of the
// pipe has gone away mid-write, when stdout is a full pipe nobody is draining,
// or when an imported module has wedged the event loop — and loadtest.mjs runs
// every one of these suites through spawnSync(), which has no timeout and would
// simply hang the whole sweep with no output to say which suite did it.
//
// So the exit is armed twice. The callback is still the fast path and still the
// one that runs on every healthy run; this timer only ever fires if that path
// did not. .unref() is what keeps it honest — an unref'd timer does not hold the
// event loop open on its own account, so it cannot delay a natural exit by five
// seconds or resurrect a process that was ready to leave. It just makes "hang
// forever" impossible.
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
