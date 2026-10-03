/**
 * CFB Pickems — spacingtest.mjs
 * =============================
 * ENGINE-MEASURED "Breathing Room" sweep (Drew, 2026-10-01: "all recommended"),
 * the app-wide follow-through on SB-14. A real Chromium lays out the REAL
 * css/styles.css against the REAL markup the app's own render functions emit,
 * and every spacing claim below is a measured distance, never a source grep.
 * (btnspacingtest.mjs models ONE group — the submitted-picks pair — in a small
 * layout model; this file measures the rest of the sweep in an engine.)
 *
 * The rule (docs/# iOS App Polish & Design Philosophy.md, "Breathing Room", AD-103):
 *   - at least 8 pt between items in a group;
 *   - at least 16 pt between groups, and from a card or screen edge;
 *   - a button never touches a line, a divider, a card edge or another button;
 *   - groups are centred; space comes from the container's gap, never from a
 *     margin on one button;
 *   - check at 375 pt wide and at the largest text size (here 2x: the root font
 *     size at 200%, which doubles every rem — the Dynamic Type stand-in).
 *
 * WHAT THIS FILE PINS (BEFORE -> AFTER measured at 375 wide, 1x text, in headless
 * Chrome against the 95a16c3 tree; the "before" numbers are in the 2026-10-01
 * sweep handoff):
 *   [2] Card padding            12 px  -> 16 px   (phone `.card{padding:12px}` removed)
 *   [3] Obligation groups       0 pt between the 2K25 row's text, badge and buttons
 *                               (loose flex children, no gap; Comm rows spaced by
 *                               `.ml-sm` margins) -> one `.ob-actions` group, 8 pt
 *                               gap on both axes, 16 pt from the text, no margins
 *   [4] Chat prefs panel        swatch gap 6 -> 12 (>= 8 visible even around the
 *                               scaled selected swatch); row padding 6 -> 8 (a
 *                               control or caption keeps >= 8 from its divider);
 *                               the alma caption's reserved line is really
 *                               reserved (row height empty == filled); "My SCRIBE
 *                               File" no longer runs 12 px past the row at 2x text
 *   [5] Feedback card           the Submit button was 27 px LEFT of the card's
 *                               centre -> centred (|offset| <= 1 px); the status
 *                               line lives under the group and takes no space
 *                               until it has text
 *   [6] Release notes           an open release's last bullet ended exactly on the
 *                               next release's divider (0 pt) -> 16 pt; bullets 7
 *                               apart -> 8; the footer note 10 -> 16 below
 *   [7] Edit My Picks           the pencil is the family's inline SVG (18 px,
 *                               currentColor), not an emoji
 *   [8] Anti-vacuity            every detector above is fed the OLD sheet / OLD
 *                               markup and must go RED, so none can pass by
 *                               measuring nothing
 *
 * Fonts are deterministic: the browser is launched with all network resolution
 * blocked, so styles.css's web-font @import never loads and every run lays out
 * with the same local fallback faces (wider than Oswald, so conservative). The
 * ASSERTIONS are distances and relations, not absolute widths. Only a device
 * confirms the final pixels: run the on-device checklist in the sweep handoff.
 *
 * Run:  node spacingtest.mjs     (spawned by loadtest.mjs [134])
 * Override the browser: SPACINGTEST_ENGINE=/path/to/Chromium (falls back to
 * NAVTEST_ENGINE, then the usual /Applications paths). A missing browser is a
 * FAILURE, never a skip.
 */

import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

// ── Node-side stubs: just enough DOM for the real render functions ───────────
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};
const els = new Map();
function mkEl(id) {
  return {
    id, _html: '', dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); },
    insertAdjacentHTML(pos, h) { this._html = pos === 'afterbegin' ? h + this._html : this._html + h; },
    appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null, setAttribute() {}, getAttribute: () => null,
  };
}
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: id => { if (!els.has(id)) els.set(id, mkEl(id)); return els.get(id); },
  querySelector: () => null, querySelectorAll: () => [], createElement: () => mkEl('x'),
  body: { classList: { add() {}, remove() {}, toggle() {} }, dataset: {}, appendChild() {}, innerHTML: '' }, hidden: false,
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined }, configurable: true }); }
globalThis.requestAnimationFrame = fn => fn();
globalThis.matchMedia = () => ({ matches: false });
globalThis.confirm = () => true; globalThis.prompt = () => null; globalThis.alert = () => {};
globalThis.scrollTo = () => {};
const REAL_FETCH = globalThis.fetch;                       // the DevTools endpoint is plain HTTP on localhost
globalThis.fetch = async () => { throw new Error('network disabled in spacingtest'); };

console.log(`\n[TZ=${process.env.TZ || '(system default)'}] spacingtest.mjs — Breathing Room sweep (engine-measured)\n`);

const storage = await import('./js/storage.js');
const app = await import('./js/app.js');
const chatUi = await import('./js/chat-ui.js');
const PO = await import('./js/pilot-only.js');
const h2025 = await import('./js/history-2025.js');
const CSS = readFileSync(join(here, 'css/styles.css'), 'utf8');
const APP_SRC = readFileSync(join(here, 'js/app.js'), 'utf8');

// ── [0] Engine ───────────────────────────────────────────────────────────────
console.log('[0] Engine…');
const ENGINES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
];
const override = process.env.SPACINGTEST_ENGINE || process.env.NAVTEST_ENGINE;
const bin = override || ENGINES.find(p => existsSync(p));
assert(!!bin && existsSync(bin), !bin
  ? `NO CHROMIUM-FAMILY BROWSER FOUND. Fix: SPACINGTEST_ENGINE=/path/to/Chromium node spacingtest.mjs. A missing browser is a FAILURE, never a skip. Looked for: ${ENGINES.join(', ')}`
  : `engine to measure in: ${bin}${override ? ' (from env)' : ''}`);
assert(typeof WebSocket === 'function', 'this Node has a global WebSocket (v22+) to speak the DevTools protocol over');

// ── Fixture league (real storage, real renderers) ────────────────────────────
storage.setBackendMode('local');
storage.getPlayers().forEach(p => storage.savePlayer({ ...p, active: false }));
[['sf_a', 'Ann'], ['sf_b', 'Bob'], ['sf_c', 'Cat'], ['sf_d', 'Dan'], ['sf_e', 'Eve']]
  .forEach(([id, n]) => storage.addPlayer({ playerId: id, displayName: n, active: true, preferences: {} }));
const mkWeek = over => ({
  weekId: 'w', weekNumber: 1, season: 2026, name: 'Week 1', status: 'final', dataSourceMode: 'live',
  startDate: '2026-09-24', endDate: '2026-09-26', picksOpenAt: null, picksLockAt: null,
  tiebreakerQuestion: 'Total?', actualTiebreakerValue: null, showInHistory: true, blurb: '',
  extraPointEnabled: false, extraPointActual: null, extraPointDetect: null, ...over,
});
const RES = (weekId, pid, name, cp, ip, flags = {}) => ({
  weekId, playerId: pid, displayName: name, rank: 2, correctPicks: cp, incorrectPicks: ip, correctCount: cp, incorrectCount: ip,
  noDecisions: 0, isWinner: false, isLoser: false, wonByTiebreaker: false, ...flags,
});
const OB = (id, weekId, payer, recipient, status) => ({
  obligationId: id, type: 'weekly', weekId, payerPlayerId: payer, recipientPlayerId: recipient, amountOrPrize: 'a drink',
  status, createdAt: '2026-09-20T00:00:00Z', paidAt: status === 'paid' ? '2026-09-21T00:00:00Z' : null,
});
for (const n of [41, 42, 43]) storage.saveWeek(mkWeek({ weekId: 'sfw' + n, weekNumber: n, name: 'Week ' + n }));
storage.saveAllWeeklyResults('sfw41', [RES('sfw41', 'sf_a', 'Ann', 4, 1, { isWinner: true, rank: 1 }), RES('sfw41', 'sf_b', 'Bob', 1, 4, { isLoser: true, rank: 4 })]);
storage.saveAllWeeklyResults('sfw42', [RES('sfw42', 'sf_c', 'Cat', 5, 0, { isWinner: true, rank: 1 }), RES('sfw42', 'sf_d', 'Dan', 0, 5, { isLoser: true, rank: 3 })]);
storage.saveAllWeeklyResults('sfw43', [RES('sfw43', 'sf_a', 'Ann', 2, 1, { isWinner: true, rank: 1 }), RES('sfw43', 'sf_c', 'Cat', 0, 3, { isLoser: true, rank: 3 })]);
storage.saveObligation(OB('sfo41', 'sfw41', 'sf_b', 'sf_a', 'unpaid'));     // Bob owes Ann (unpaid)
storage.saveObligation(OB('sfo42', 'sfw42', 'sf_d', 'sf_c', 'pending'));    // Dan owes Cat (pending): Cat sees Confirm + Deny, Dan sees the wait line
storage.saveObligation(OB('sfo43', 'sfw43', 'sf_c', 'sf_a', 'paid'));       // Cat owes Ann (paid): Comm shows Undo
PO.setPilotOnlyLeagueResolver(() => ({ pilot: true }));                    // let the 2K25 sections render
const rows2025 = h2025.season2025Obligations();
storage.saveSetting('ob2025', { [rows2025[0].obligationId]: 'pending', [rows2025[1].obligationId]: 'paid' });

const renderBoard = ([pid, adm, ver]) => {
  storage.setSession(pid, adm, ver);
  const el = document.getElementById('page-leaderboard'); el._html = '';
  app.renderLeaderboard();
  return el._html;
};
const BOARD = {
  creditor: renderBoard(['sf_c', false, true]),   // Cat: Confirm + Deny on Week 42
  payer: renderBoard(['sf_d', false, true]),      // Dan: "Waiting on Cat to confirm."
  admin: renderBoard(['sf_e', true, true]),       // the commissioner: every action, plus the 2K25 rows' buttons
};
storage.setSession('sf_e', true, true);
const COMM = app.renderObligationsAdmin() + '<div class="divider"></div>' + app.renderSeason2025ObligationsAdmin();

// The chat prefs panel + the feedback card + release notes: the real functions.
storage.addPlayer({ playerId: 'p1', displayName: 'Drew', active: true, preferences: {} });
storage.setSession('p1', true, true);
const PREFS = chatUi._prefsPanelHTMLForTest();
const FEEDBACK = app.renderFeedbackCardHTML();
const RELEASES = app.renderReleaseNotesCardHTML();
// The Notifications settings body (priming card + prefs card), in every state that renders a button (reviewer N2).
const NOTIF = {
  'never-asked': await app.renderNotifSettingsBodyHTML('p1', 'never-asked'),
  'native-not-asked': await app.renderNotifSettingsBodyHTML('p1', 'native-not-asked'),
  'native-denied': await app.renderNotifSettingsBodyHTML('p1', 'native-denied'),
  'unreachable': await app.renderNotifSettingsBodyHTML('p1', 'granted', { known: true, ok: false, hasSubscription: false }),
};

// The real submitted-picks view (for the Edit My Picks control).
const FUTURE = new Date(Date.now() + 7 * 86400_000).toISOString();
const SUB_WEEK = mkWeek({ weekId: 'w_sub', weekNumber: 5, name: 'Week 5', status: 'open', startDate: '2026-10-03', endDate: '2026-10-04', blurb: '' });
const SUB_GAME = {
  gameId: 'w_sub_g1', weekId: 'w_sub', espnEventId: null, dataQuality: 'manual', dataSource: 'manual',
  homeTeam: 'Texas A&M', awayTeam: 'Alabama', homeConference: 'SEC', awayConference: 'SEC', homeRank: null, awayRank: null,
  kickoff: FUTURE, kickoffConfirmed: true, kickoffDateOnly: false, timeWindow: 'evening', spread: -3.5, favorite: 'Texas A&M',
  lockedSpread: null, homeScore: null, awayScore: null, status: 'scheduled', actualWinner: null, atsWinner: null, isAlmaMaterGame: false,
  spreadSource: 'manual', oddsProvider: null, lastUpdated: null, venue: null, venueDisplay: null, neutralSite: false, multiplier: 1,
};
storage.saveWeek(SUB_WEEK); storage.saveGame(SUB_GAME);
storage.saveAllPicks([{ pickId: 'sub_p', weekId: 'w_sub', gameId: 'w_sub_g1', playerId: 'p1', selectedTeam: 'Texas A&M', submittedAt: '2026-10-01T00:00:00Z' }]);
const SUBMITTED = (() => {
  const c = { _html: '', addEventListener() {}, get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); } };
  app._renderSubmittedViewForTest(c, SUB_WEEK, [SUB_GAME], { playerId: 'p1', isAdmin: false, verified: true }, 'Drew');
  return c._html;
})();

console.log('[1] Fixture integrity — the real renderers produced what each section measures…');
assert(/class="btn-row stand-act-row"/.test(BOARD.creditor) && /data-ob-action="confirm"/.test(BOARD.creditor) && /data-ob-action="deny"/.test(BOARD.creditor),
  '[1a] Standings, viewed by the creditor of a pending week: a .btn-row.stand-act-row group holds Confirm + Deny');
assert(/Waiting on Cat to confirm/.test(BOARD.payer), '[1b] Standings, viewed by the payer of that week: the "Waiting on Cat to confirm." line is in the group');
assert((BOARD.admin.match(/class="flex-between ob-row"/g) || []).length >= 10 && /class="ob-actions( ob-actions-tap)?"/.test(BOARD.admin),
  `[1c] Standings 2K25 Outstanding card: every owes-row is a .flex-between.ob-row with its own .ob-actions group (${(BOARD.admin.match(/class="flex-between ob-row"/g) || []).length} rows)`);
assert(/data-ob-action="undo"/.test(COMM) && /ob-delete-btn/.test(COMM) && (COMM.match(/class="ob-actions"/g) || []).length >= 10,
  '[1d] Comm obligations (current season + 2K25): rows carry Undo and the delete control inside .ob-actions');
assert([BOARD.creditor, BOARD.payer, BOARD.admin, COMM].every(h => !/<button[^>]*\bml-sm\b/.test(h) && !/text-xs ml-sm/.test(h)),
  '[1e] none of the four pages carries .ml-sm on a button or on the wait line — the markup the groups wrap is margin-free');
assert((PREFS.match(/class="chat-prefs-row/g) || []).length >= 7 && /id="scribe-file-btn"/.test(PREFS) && (PREFS.match(/chat-accent-swatch/g) || []).length >= 9,
  '[1f] the chat settings panel: its rows, the nine accent swatches and the "My SCRIBE File" entry point are all present');
assert(/id="fb-submit-btn"/.test(FEEDBACK) && /id="fb-status"/.test(FEEDBACK), '[1g] the feedback card carries #fb-submit-btn and #fb-status');
assert((RELEASES.match(/class="release-entry"/g) || []).length >= 3 && /<details class="release-entry"[^>]* open>/.test(RELEASES),
  '[1h] release notes: several entries, the newest open');
assert(/id="edit-picks-btn"/.test(SUBMITTED) && /id="go-dash-btn"/.test(SUBMITTED), '[1i] the real submitted view renders Edit My Picks + View Dashboard');
assert(Object.values(NOTIF).every(h => /id="notif-priming-card"/.test(h) && /id="notif-priming-btn"/.test(h) && /notif-prefs-card/.test(h)),
  `[1j] the Notifications body renders the priming card, its button and the prefs card in all ${Object.keys(NOTIF).length} button-bearing states (${Object.keys(NOTIF).join(', ')})`);
assert(/class="ob-actions ob-actions-tap"/.test(BOARD.admin) && !/ob-actions-tap/.test(COMM) && /class="ob-filter-tabs/.test(BOARD.creditor),
  '[1k] the Standings 2K25 card carries the .ob-actions-tap modifier and the owes-filter tabs; the Comm lists do not carry the modifier');

// ── Page builders ────────────────────────────────────────────────────────────
const tmp = mkdtempSync(join(tmpdir(), 'cfbp-spacing-'));
const CSS_HREF = 'file://' + here + 'css/styles.css';
const NOANIM = '<style>*,*::before,*::after{animation:none!important;transition:none!important}</style>';
const MODES = [
  { name: 'light', attrs: 'class="theme-neutral" data-color-scheme="light"' },
  { name: 'dark', attrs: 'class="theme-neutral" data-color-scheme="dark"' },
];
let fileN = 0;
function page(body, { css = CSS_HREF, attrs = MODES[0].attrs } = {}) {
  const file = join(tmp, `p${++fileN}.html`);
  writeFileSync(file, `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="${css}">${NOANIM}</head>
<body ${attrs}>${body}</body></html>`);
  return file;
}
function sheet(transform) {
  const out = transform(CSS);
  if (out === CSS) throw new Error('sheet(): the transform changed nothing — a mutant that is the original proves nothing');
  const file = join(tmp, `s${++fileN}.css`);
  writeFileSync(file, out);
  return 'file://' + file;
}
const mainWrap = inner => `<main class="main-content"><section class="page-section active">${inner}</section></main>`;
// The control-center drawer chain the prefs + feedback cards really live in (85vw / 340px max, pane 16px, row body 16px).
const drawerWrap = inner => `<div id="control-center" data-open="true" style="--cc-drag-progress:1"><div class="control-center-pane" data-active="true"><div class="control-center-pane-content"><div class="control-center-group"><div class="control-center-row-wrap"><div class="control-center-row-body"><div class="control-center-row-body-inner">${inner}</div></div></div></div></div></div></div>`;

// ── In-page measurement library (stringified into every page) ────────────────
function R(e) { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }
function gap2(a, b) {
  const dx = Math.max(0, Math.max(b.l - a.r, a.l - b.r)), dy = Math.max(0, Math.max(b.t - a.b, a.t - b.b));
  return Math.hypot(dx, dy);
}
function visible(list) { return list.filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }); }
function minPair(list) {
  const rs = visible(list).map(R); let m = Infinity;
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) m = Math.min(m, gap2(rs[i], rs[j]));
  return m === Infinity ? null : +m.toFixed(2);
}
function visualLines(list) {
  const rs = visible(list).map(R).sort((a, b) => a.t - b.t || a.l - b.l); const out = [];
  for (const r of rs) {
    const L = out.find(x => r.t < x.b - 1 && r.b > x.t + 1);
    if (L) { L.l = Math.min(L.l, r.l); L.r = Math.max(L.r, r.r); L.t = Math.min(L.t, r.t); L.b = Math.max(L.b, r.b); } else out.push({ ...r });
  }
  return out;
}
function contentBox(e) {
  const cs = getComputedStyle(e), r = e.getBoundingClientRect();
  return { l: r.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft), r: r.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight),
    t: r.top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop), b: r.bottom - parseFloat(cs.borderBottomWidth) - parseFloat(cs.paddingBottom) };
}
function maxCenterDev(group, kids) {            // how far each visual line's centre sits from the group's content-box centre
  const c = contentBox(group), cx = (c.l + c.r) / 2;
  return +Math.max(0, ...visualLines(kids).map(L => Math.abs((L.l + L.r) / 2 - cx))).toFixed(2);
}
function extentOf(row) {                        // union of the row's element + text boxes; an empty row reserves its content box
  let u = null;
  const add = r => { if (r.w === 0 && r.h === 0) return; u = u ? { l: Math.min(u.l, r.l), t: Math.min(u.t, r.t), r: Math.max(u.r, r.r), b: Math.max(u.b, r.b) } : { l: r.l, t: r.t, r: r.r, b: r.b }; };
  for (const k of row.children) add(R(k));
  for (const n of row.childNodes) if (n.nodeType === 3 && n.textContent.trim()) { const g = document.createRange(); g.selectNodeContents(n); const q = g.getBoundingClientRect(); add({ l: q.left, t: q.top, r: q.right, b: q.bottom, w: q.width, h: q.height }); }
  if (!u) { const c = contentBox(row); u = { l: c.l, t: c.t, r: c.r, b: c.b }; }
  return u;
}
function dividerGaps(row) {                     // space from the row's content to the divider above (its own top edge) and below (its bottom border)
  const r = row.getBoundingClientRect(), cs = getComputedStyle(row), u = extentOf(row);
  return { top: +(u.t - r.top).toFixed(2), bottom: +((r.bottom - parseFloat(cs.borderBottomWidth)) - u.b).toFixed(2) };
}
const LIB = [R, gap2, visible, minPair, visualLines, contentBox, maxCenterDev, extentOf, dividerGaps].map(f => f.toString()).join('\n');

// ── The CDP client ───────────────────────────────────────────────────────────
function launch() {
  const proc = spawn(bin, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + join(tmp, 'profile'), '--no-first-run',
    '--no-default-browser-check', '--disable-gpu', '--allow-file-access-from-files', '--hide-scrollbars', '--disable-background-networking',
    '--disable-sync', '--disable-component-update', '--disable-default-apps', '--disable-extensions', '--disable-search-engine-choice-screen',
    '--metrics-recording-only', '--mute-audio', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  return new Promise((res, rej) => {
    let buf = '';
    const t = setTimeout(() => { proc.kill(); rej(new Error('no DevTools endpoint within 25s: ' + buf.slice(-300))); }, 25000);
    proc.stderr.on('data', d => { buf += d.toString(); const m = buf.match(/ws:\/\/\S+/); if (m) { clearTimeout(t); res({ proc, ws: m[0] }); } });
    proc.on('error', e => { clearTimeout(t); rej(e); });
  });
}
async function attach(browserWs) {
  const list = await (await REAL_FETCH('http://' + new URL(browserWs).host + '/json/list')).json();
  const target = list.find(t => t.type === 'page');
  if (!target) throw new Error('no page target to attach to');
  const sock = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { sock.addEventListener('open', res, { once: true }); sock.addEventListener('error', () => rej(new Error('DevTools socket refused')), { once: true }); });
  let id = 0; const pending = new Map(); const waiters = [];
  sock.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method) waiters.filter(w => w.method === msg.method).forEach(w => w.res());
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const myId = ++id;
    pending.set(myId, m => m.error ? rej(new Error(method + ' → ' + JSON.stringify(m.error))) : res(m.result));
    sock.send(JSON.stringify({ id: myId, method, params }));
  });
  const once = method => new Promise(res => waiters.push({ method, res }));
  return { send, once, sock };
}

let engine = null;
try {
  if (!bin) throw new Error('no engine binary');
  engine = await launch();
  const cdp = await attach(engine.ws);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  /** Load `file` at `w` px wide and `scale`x text, then run `fn(args)` in the page (LIB in scope). */
  async function measure(file, fn, { w = 375, scale = 1, args = null } = {}) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: 812, deviceScaleFactor: 1, mobile: true });
    const loaded = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url: 'file://' + file });
    await loaded;
    if (scale !== 1) await cdp.send('Runtime.evaluate', { expression: `document.documentElement.style.fontSize='${scale * 100}%'` });
    const r = await cdp.send('Runtime.evaluate', { expression: `(() => { ${LIB}\n return (${fn.toString()})(${JSON.stringify(args)}); })()`, returnByValue: true });
    if (r.exceptionDetails) throw new Error('measure threw: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails));
    return r.result.value;
  }

  // ── [2] CARD PADDING ───────────────────────────────────────────────────────
  console.log('\n[2] Card padding — every card keeps 16 pt from its edge on every phone width, light and dark…');
  const cardsOf = () => [...document.querySelectorAll('.card')].map(c => { const s = getComputedStyle(c); return [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft]; });
  for (const mode of MODES) {
    const f = page(mainWrap('<div class="card" id="c1"><p>one</p></div><div class="card"><p>two</p></div>' + FEEDBACK + PREFS), { attrs: mode.attrs });
    for (const w of [320, 375, 390, 430, 600]) {
      const pads = await measure(f, cardsOf, { w });
      const flat = pads.flat();
      assert(pads.length >= 4 && flat.every(v => v === '16px'),
        `[2a] ${mode.name}, ${w} wide: all ${pads.length} cards compute padding 16px on every side (got ${[...new Set(flat)].join(', ')})`);
    }
  }
  {
    // The detector is only as good as its power to fail: the OLD phone override, re-added on top of the real sheet, must read 12px.
    const old = sheet(c => c + '\n@media (max-width: 480px) { .card { padding: 12px; } }\n');
    const pads = await measure(page(mainWrap('<div class="card"><p>x</p></div>'), { css: old }), cardsOf, { w: 375 });
    assert(pads[0].every(v => v === '12px'), `[2b] anti-vacuity: with the old phone rule re-added, the SAME detector reads 12px at 375 (got ${pads[0].join(' ')}) — so [2a] is a measurement, not a constant`);
    const phoneCardRules = [...CSS.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(?:^|[}\s])\.card\s*\{([^{}]*)\}/g)].map(m => m[1]).filter(b => /(^|;)\s*padding\s*:/.test(b));
    assert(phoneCardRules.length === 1, `[2c] the sheet declares padding on a bare \`.card\` exactly once — the base rule, no phone-tier override (found ${phoneCardRules.length})`);
  }

  // [2d] EVERY card subclass the app renders (reviewer BLOCK #1, B2). Deleting the phone `.card{padding:12px}` exposed two earlier subclass rules
  // (.notif-priming-card 14, .notif-prefs-card 8/14) that a bare-`.card` check can never see. The class lists are DERIVED from the source — every
  // static `class="… card …"` in js/**/*.js and index.html (interpolations stripped) — so a new card subclass is measured the day it is added.
  const CARD_CLASS_LISTS = (() => {
    const found = new Set();
    const scan = src => { for (const m of src.matchAll(/class="([^"]*\bcard\b[^"]*)"/g)) { const c = m[1].replace(/\$\{[^}]*\}/g, ' ').trim().replace(/\s+/g, ' '); if (c.split(' ').includes('card')) found.add(c); } };
    for (const f of readdirSync(join(here, 'js'), { recursive: true }).filter(f => String(f).endsWith('.js'))) scan(readFileSync(join(here, 'js', String(f)), 'utf8'));
    scan(readFileSync(join(here, 'index.html'), 'utf8'));
    return [...found].sort();
  })();
  // The only cards allowed to differ from "16 on every side", each pinned to its exact value so a change is noticed:
  //   notif-prefs-card  8/16/8/16 — the reviewer-specified shape: the 16 sides are the card edge; its rows carry their own 11px padding and 44px floor.
  //   scribe-mem-row    10/12/10/12 — the My SCRIBE File modal's dense row cards, a rule that predates the sweep (same value at every width); deferred, not changed.
  //   card ls-card, card ls-card ls-facts   0/0/0/0 — SP-53's League Settings GROUPED-LIST cards: grouped list: rows carry the 16 pt side inset (`.ls-row`
  //                     8px 16px), measured by leaguesettingsrendertest [127b]; coordinator ruling 2026-10-01 (v0.29.0 batch-5b integration). Pinned by EXACT class list,
  //                     not by the `ls-card` token: `card ls-card ls-name-card` is a regular card (16 on every side) and stays under the >= 16 rule, and a new ls-card
  //                     variant needs its own ruling rather than inheriting the exemption. [2g] below holds the rows to that inset.
  //   card news-card   0/0/0/0 — the Home News feed's article card (Social Platform News option A, merged into the Home wiring window 2026-10-01): the 16:9 picture bleeds to the card's edges,
  //                     so the padding lives on `.news-card__body` (16 pt on every side, gap 8), measured by [2i] below. Pinned by EXACT class list like the ls-cards.
  const CARD_PINNED = { 'notif-prefs-card': '8/16/8/16', 'scribe-mem-row': '10/12/10/12' };
  const CARD_PINNED_EXACT = { 'card ls-card': '0/0/0/0', 'card ls-card ls-facts': '0/0/0/0', 'card news-card': '0/0/0/0' };
  const cardClassPads = () => [...document.querySelectorAll('[data-card-i]')].map(e => { const s = getComputedStyle(e); return [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft].map(parseFloat).join('/'); });
  const cardPage = (css, attrs) => page(mainWrap(CARD_CLASS_LISTS.map((c, i) => `<div class="${c}" data-card-i="${i}"><p>x</p></div>`).join('')), { css, attrs });
  const cardVerdicts = pads => CARD_CLASS_LISTS.map((c, i) => {
    const pinned = CARD_PINNED_EXACT[c] ?? c.split(' ').map(t => CARD_PINNED[t]).find(Boolean);
    const sides = pads[i].split('/').map(Number);
    return { c, pad: pads[i], ok: pinned ? pads[i] === pinned : sides.every(v => v >= 16) };
  });
  assert(CARD_CLASS_LISTS.length >= 20 && CARD_CLASS_LISTS.includes('card') && CARD_CLASS_LISTS.includes('card notif-priming-card') && CARD_CLASS_LISTS.includes('card notif-prefs-card'),
    `[2d-fixture] the derivation found ${CARD_CLASS_LISTS.length} distinct card class lists in the app's source, including the two notification cards the bare-.card check missed`);
  assert(Object.keys(CARD_PINNED_EXACT).every(k => CARD_CLASS_LISTS.includes(k)),
    `[2d-fixture] every exact-list pin names a card the app really renders (${Object.keys(CARD_PINNED_EXACT).join(', ')}) — a dead exemption must be removed, not left to excuse a future card`);
  for (const [mode, w] of [[MODES[0], 320], [MODES[0], 375], [MODES[0], 430], [MODES[0], 600], [MODES[1], 375]]) {
    const bad = cardVerdicts(await measure(cardPage(CSS_HREF, mode.attrs), cardClassPads, { w })).filter(v => !v.ok);
    assert(bad.length === 0, `[2d] ${mode.name}, ${w} wide: all ${CARD_CLASS_LISTS.length} card class lists keep >= 16 on every side (the pinned exceptions hold their value)${bad.length ? ' — OFFENDERS: ' + bad.map(v => `"${v.c}" ${v.pad}`).join('; ') : ''}`);
  }
  {
    const old = sheet(c => c + '\n.notif-priming-card{padding:14px}\n');
    const bad = cardVerdicts(await measure(cardPage(old, MODES[0].attrs), cardClassPads, { w: 375 })).filter(v => !v.ok);
    assert(bad.length === 1 && bad[0].c === 'card notif-priming-card' && bad[0].pad === '14/14/14/14',
      `[2e] anti-vacuity: with the old .notif-priming-card{padding:14px} rule re-added the SAME detector flags exactly "${bad.map(v => v.c + ' ' + v.pad).join('; ')}"`);
    const old2 = sheet(c => c + '\n.notif-prefs-card{padding:8px 14px}\n');
    const bad2 = cardVerdicts(await measure(cardPage(old2, MODES[0].attrs), cardClassPads, { w: 375 })).filter(v => !v.ok);
    assert(bad2.length === 1 && bad2[0].c === 'card notif-prefs-card' && bad2[0].pad === '8/14/8/14',
      `[2f] anti-vacuity: with the old .notif-prefs-card{padding:8px 14px} re-added it flags exactly "${bad2.map(v => v.c + ' ' + v.pad).join('; ')}" (its pinned value is 8/16/8/16)`);
  }
  // [2g] The coordinator's ruling pins 'ls-card' at 0/0/0/0 ONLY because a grouped list's rows carry the 16 pt side inset themselves (2026-10-01, v0.29.0 batch-5b
  // integration). So every row class list the app renders inside an .ls-card is measured too, DERIVED from the source like [2d]: a new row variant is measured the day it is added.
  const LS_ROW_CLASS_LISTS = (() => {
    const found = new Set();
    for (const f of readdirSync(join(here, 'js'), { recursive: true }).filter(f => String(f).endsWith('.js'))) {
      for (const m of readFileSync(join(here, 'js', String(f)), 'utf8').matchAll(/class="([^"]*\bls-row\b[^"]*)"/g)) {
        const c = m[1].replace(/\$\{[^}]*\}/g, ' ').trim().replace(/\s+/g, ' ');
        if (c.split(' ').includes('ls-row')) found.add(c);
      }
    }
    return [...found].sort();
  })();
  const lsRowPage = (css, attrs) => page(mainWrap(`<div class="card ls-card">${LS_ROW_CLASS_LISTS.map((c, i) => `<div class="${c}" data-lsrow-i="${i}"><span class="ls-row-label">x</span></div>`).join('')}</div>`), { css, attrs });
  const lsRowPads = () => [...document.querySelectorAll('[data-lsrow-i]')].map(e => { const s = getComputedStyle(e); return [parseFloat(s.paddingLeft), parseFloat(s.paddingRight)]; });
  assert(LS_ROW_CLASS_LISTS.length >= 4 && LS_ROW_CLASS_LISTS.includes('ls-row ls-row-nav') && LS_ROW_CLASS_LISTS.includes('ls-row ls-row-switch'),
    `[2g-fixture] the derivation found ${LS_ROW_CLASS_LISTS.length} distinct .ls-row class lists in the app's source (${LS_ROW_CLASS_LISTS.join(' | ')})`);
  for (const [mode, w] of [[MODES[0], 320], [MODES[0], 375], [MODES[0], 430], [MODES[0], 600], [MODES[1], 375]]) {
    const pads = await measure(lsRowPage(CSS_HREF, mode.attrs), lsRowPads, { w });
    const bad = LS_ROW_CLASS_LISTS.map((c, i) => ({ c, p: pads[i] })).filter(({ p }) => !(p && p[0] >= 16 && p[1] >= 16));
    assert(pads.length === LS_ROW_CLASS_LISTS.length && bad.length === 0,
      `[2g] ${mode.name}, ${w} wide: every .ls-row inside an .ls-card keeps >= 16 pt left and right padding — the inset that pins 'ls-card' at 0/0/0/0${bad.length ? ' — OFFENDERS: ' + bad.map(({ c, p }) => `"${c}" ${p ? p.join('/') : 'missing'}`).join('; ') : ''}`);
  }
  {
    const old = sheet(c => c + '\n.ls-row{padding:8px 12px}\n');
    const pads = await measure(lsRowPage(old, MODES[0].attrs), lsRowPads, { w: 375 });
    assert(pads.length === LS_ROW_CLASS_LISTS.length && pads.every(p => p[0] === 12 && p[1] === 12),
      `[2h] anti-vacuity: with .ls-row{padding:8px 12px} re-added, the SAME detector reads 12/12 on every row (got ${pads.map(p => p.join('/')).join(', ')}) — so [2g] is a measurement`);
  }

  // [2i] The news card is pinned at 0/0/0/0 ONLY because its body carries the 16 pt inset itself (the picture is full-bleed). Measured on the real sheet, light and dark, phone widths.
  const newsBodyPads = () => [...document.querySelectorAll('.news-card__body')].map(e => { const s = getComputedStyle(e); return [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft].map(parseFloat); });
  const newsPage = (css, attrs) => page(mainWrap('<div class="card news-card"><img class="news-card__image" alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><div class="news-card__body"><p class="news-card__headline">x</p></div></div>'), { css, attrs });
  for (const [mode, w] of [[MODES[0], 320], [MODES[0], 375], [MODES[0], 430], [MODES[0], 600], [MODES[1], 375]]) {
    const pads = await measure(newsPage(CSS_HREF, mode.attrs), newsBodyPads, { w });
    assert(pads.length === 1 && pads[0].every(v => v >= 16),
      `[2i] ${mode.name}, ${w} wide: .news-card__body keeps >= 16 pt on every side — the inset that pins 'card news-card' at 0/0/0/0 (got ${pads.map(p => p.join('/')).join(', ') || 'no body'})`);
  }
  {
    const old = sheet(c => c + '\n.news-card__body{padding:8px 12px}\n');
    const pads = await measure(newsPage(old, MODES[0].attrs), newsBodyPads, { w: 375 });
    assert(pads.length === 1 && pads[0].join('/') === '8/12/8/12',
      `[2j] anti-vacuity: with .news-card__body{padding:8px 12px} re-added, the SAME detector reads 8/12/8/12 (got ${pads.map(p => p.join('/')).join(', ')}) — so [2i] is a measurement`);
  }

  // ── [3] OBLIGATION GROUPS ──────────────────────────────────────────────────
  console.log('\n[3] Obligation buttons — one group, an 8 pt gap from the container, no margins, nothing touching or overlapping the text, at 320/375 wide and 1x/2x text…');
  const obMeasure = () => {
    const groups = [...document.querySelectorAll('.btn-row.stand-act-row, .ob-actions')];
    const rows = [...document.querySelectorAll('.ob-row')];
    const marginOf = e => { const s = getComputedStyle(e); return [s.marginLeft, s.marginRight, s.marginTop, s.marginBottom].some(v => v !== '0px'); };
    const kidsOf = g => [...g.children];
    const multi = groups.filter(g => visible(kidsOf(g)).length >= 2);
    // B1 (reviewer BLOCK #1, 2026-10-01): measure each badge/button against the text's REAL line boxes (one Range per text node), never against the
    // text block's or the action group's own box. A group that shrinks below its widest button (min-width:0 + justify-content:flex-end) keeps a
    // perfectly tidy box while its buttons spill LEFT over the text, so a box-to-box distance reads a false pass.
    const textRects = row => {
      const out = [], w = document.createTreeWalker(row.children[0], NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (!n.textContent.trim()) continue;
        const g = document.createRange(); g.selectNodeContents(n);
        for (const q of g.getClientRects()) if (q.width > 0 && q.height > 0) out.push({ l: q.left, t: q.top, r: q.right, b: q.bottom });
      }
      return out;
    };
    const hit = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    let minClear = Infinity, overlaps = 0, pairs = 0;
    for (const r of rows) {
      const ob = r.querySelector('.ob-actions'), tr = textRects(r);
      if (!ob || !tr.length) continue;
      for (const k of visible([...ob.children])) {
        const kr = R(k);
        for (const t of tr) { pairs++; minClear = Math.min(minClear, gap2(kr, t)); if (hit(kr, t)) overlaps++; }
      }
    }
    return {
      groups: groups.length, multi: multi.length, rows: rows.length, pairs,
      minInGroup: multi.length ? Math.min(...multi.map(g => minPair(kidsOf(g)))) : null,
      marginedKids: groups.flatMap(kidsOf).filter(marginOf).length,
      stand: [...document.querySelectorAll('.btn-row.stand-act-row')].map(g => ({ kids: visible(kidsOf(g)).length, dev: maxCenterDev(g, kidsOf(g)), text: g.textContent.trim().slice(0, 30) })),
      textClear: minClear === Infinity ? null : +minClear.toFixed(2), overlaps,
      overflow: rows.filter(r => { const c = contentBox(r); return visible([...r.children]).some(k => k.getBoundingClientRect().right > c.r + 0.5); }).length,
      dividers: rows.map(dividerGaps),
    };
  };
  const OB_PAGES = [['Standings (creditor)', BOARD.creditor], ['Standings (payer)', BOARD.payer], ['Standings (commissioner)', BOARD.admin], ['Comm → Players obligations', `<div class="card">${COMM}</div>`]];
  const obResults = {};
  for (const [label, body] of OB_PAGES) {
    const f = page(mainWrap(body));
    for (const w of [320, 375]) {
      for (const scale of [1, 2]) {
        const m = await measure(f, obMeasure, { w, scale });
        obResults[`${label}|${w}|${scale}`] = m;
        const tag = `${label}, ${w} wide, ${scale}x text`;
        assert(m.groups >= 1, `[3-fixture] ${tag}: the page has ${m.groups} action group(s) to measure`);
        if (m.multi) assert(m.minInGroup >= 8, `[3a] ${tag}: the smallest distance between any two items in a group (badge, buttons, wait line) is ${m.minInGroup} pt, needs >= 8 — on both axes, so a wrapped stack keeps it`);
        assert(m.marginedKids === 0, `[3b] ${tag}: no item in an action group carries a margin (${m.marginedKids} do) — the gap is the container's`);
        if (m.rows) {
          // Reviewer nit (spacing sweep second pass), applied at the v0.29.0 batch-5b integration (2026-10-01): the bar is 16 pt with a 0.5 pt SUB-PIXEL TOLERANCE.
          // Line boxes and fractional layout (2x text, odd viewport widths) round the measured gap to values like 15.6 for a rule that IS 16 pt; the defect this guards
          // (items touching the text, 0 pt before the sweep) is nowhere near that tolerance.
          assert(m.pairs > 0 && m.textClear >= 15.5, `[3c] ${tag}: every badge/button is >= 16 pt (0.5 pt sub-pixel tolerance) from the "X owes Y" text's real line boxes (smallest ${m.textClear} pt over ${m.pairs} item/line pairs); they were touching (0 pt) before the sweep`);
          assert(m.overlaps === 0, `[3d] ${tag}: no badge or button is drawn over the text (${m.overlaps} of ${m.pairs} item/line pairs overlap)`);
          assert(m.dividers.every(d => d.top >= 8 && d.bottom >= 8), `[3e] ${tag}: every row keeps >= 8 pt from the divider above and below (smallest top ${Math.min(...m.dividers.map(d => d.top))}, bottom ${Math.min(...m.dividers.map(d => d.bottom))})`);
        }
        for (const s of m.stand) assert(s.dev <= 1, `[3f] ${tag}: the Standings action group "${s.text}" is centred in its row (off by ${s.dev} pt per line, needs <= 1; ${s.kids} item(s))`);
      }
    }
  }
  {
    // [3d2] The right edge. Once the buttons stop shrinking (B1) a row whose longest word + 16 + the widest button is wider than the row would push
    // the group off the card (21 rows at 320 wide / 2x text on the 95a16c3 tree; 3 after B1 alone). `.ob-row>:first-child{min-width:0;overflow-wrap:anywhere}`
    // makes the TEXT yield instead, so every combination is zero.
    const ov = (label, w, scale) => obResults[`${label}|${w}|${scale}`].overflow;
    const worst = OB_PAGES.map(([l]) => [l, ov(l, 375, 1), ov(l, 375, 2), ov(l, 320, 1), ov(l, 320, 2)]);
    assert(worst.every(r => r.slice(1).every(n => n === 0)),
      `[3d2] no row runs past its right edge at 320 or 375 wide, 1x or 2x text — ${worst.map(([l, a, b, c, d]) => `${l}: ${a}/${b}/${c}/${d}`).join('; ')} (375x1 / 375x2 / 320x1 / 320x2)`);
  }
  {
    // Anti-vacuity: the OLD structure — loose siblings with a margin on each button and no group gap — must be caught.
    const oldRow = '<div class="flex-between" style="padding:6px 0;border-bottom:1px solid var(--border)"><div class="text-sm"><strong>Kevin</strong> owes <strong>Bra</strong> — a drink</div>'
      + '<span class="badge badge-nd">Pending</span><button class="btn btn-win btn-sm ml-sm">Confirm</button><button class="btn btn-danger btn-sm ml-sm">Deny</button></div>';
    const m = await measure(page(mainWrap(`<div class="card">${oldRow}</div>`)), () => {
      const row = document.querySelector('.flex-between');
      const k = visible([...row.children]);
      const c = contentBox(row);
      return { min: minPair(k), margined: [...row.querySelectorAll('button')].filter(b => getComputedStyle(b).marginLeft !== '0px').length, dev: dividerGaps(row), cw: c.r - c.l };
    }, { w: 375 });
    assert(m.min < 8 && m.margined === 2 && m.dev.top < 8,
      `[3g] anti-vacuity: the OLD 2K25 row (loose children, .ml-sm margins, 6px padding) reads min distance ${m.min} pt, ${m.margined} margined buttons, ${m.dev.top} pt to the divider — each of the three detectors above would have gone red`);
  }
  {
    // [3h] B1 mutant (reviewer BLOCK #1): put `min-width:0` back on .ob-actions and the SAME text-line-box detector must go red at large text. Measured on the
    // 5741b05 tree at 2x text: 12 badge/button-over-text overlaps on the Standings 2K25 card at 375 and at 320 wide, 5 on the Comm lists at 320.
    const withMin0 = sheet(c => c.replace('.ob-actions{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:8px}', '.ob-actions{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:8px;min-width:0}'));
    const mo = await measure(page(mainWrap(BOARD.creditor), { css: withMin0 }), obMeasure, { w: 375, scale: 2 });
    const mc = await measure(page(mainWrap(BOARD.creditor)), obMeasure, { w: 375, scale: 2 });
    assert(mo.overlaps >= 1 && mo.textClear < 16 && mc.overlaps === 0,
      `[3h] anti-vacuity (B1): with min-width:0 restored the detector reads ${mo.overlaps} overlap(s) and ${mo.textClear} pt of clearance at 375 / 2x text; the shipped sheet reads ${mc.overlaps} and ${mc.textClear} pt`);
    const withoutYield = sheet(c => c.replace('.ob-row>:first-child{min-width:0;overflow-wrap:anywhere}', ''));
    const my = await measure(page(mainWrap(`<div class="card">${COMM}</div>`), { css: withoutYield }), obMeasure, { w: 320, scale: 2 });
    assert(my.overflow >= 1, `[3h2] anti-vacuity: without the text-yields rule, Comm → Players at 320 / 2x has ${my.overflow} row(s) running past the right edge (the shipped sheet: 0, asserted in [3d2])`);
  }
  {
    // [3i] N3: the 44 pt tap floor, scoped. The Standings 2K25 buttons carry it; the commissioner's Comm lists keep their denser rows.
    // Comm's buttons may still WRAP to two lines (a tall button is not a raised one), so the scoping is read from the computed min-height, not the rendered height.
    const tap = () => ({
      standings: [...document.querySelectorAll('.ob-actions-tap .btn')].map(b => +b.getBoundingClientRect().height.toFixed(1)),
      comm: [...document.querySelectorAll('.ob-actions:not(.ob-actions-tap) .btn')].map(b => parseFloat(getComputedStyle(b).minHeight)),
    });
    const ts = await measure(page(mainWrap(BOARD.admin)), tap, { w: 375 });
    const tc = await measure(page(mainWrap(`<div class="card">${COMM}</div>`)), tap, { w: 375 });
    assert(ts.standings.length >= 10 && ts.standings.every(h => h >= 44), `[3i] the Standings 2K25 card's ${ts.standings.length} payment buttons are all >= 44 pt tall (smallest ${Math.min(...ts.standings)})`);
    assert(tc.comm.length >= 10 && tc.standings.length === 0 && tc.comm.every(h => h < 44), `[3j] the scoping holds: Comm's ${tc.comm.length} buttons keep their own min-height (largest ${Math.max(...tc.comm)} pt, < 44) — no global .btn-sm change`);
  }
  {
    // [3k] N1: the owes-filter tabs keep 8 pt between them and 8 pt below their divider.
    const tabs = () => { const t = document.querySelector('.ob-filter-tabs'); const k = visible([...t.children]); return { n: k.length, min: minPair(k), below: +(t.nextElementSibling.getBoundingClientRect().top - t.getBoundingClientRect().bottom).toFixed(2), above: dividerGaps(t).bottom }; };
    const m = await measure(page(mainWrap(BOARD.creditor)), tabs, { w: 375 });
    assert(m.n >= 3 && m.min >= 8 && m.below >= 8 && m.above >= 8, `[3k] the "All / What I owe / Owed to me" tabs: ${m.n} items, ${m.min} pt apart (needs >= 8), ${m.above} pt above their divider and ${m.below} pt below it (both >= 8)`);
    const oldTabs = sheet(c => c.replace('display: flex; flex-wrap: wrap; gap: 8px; align-items: center;', 'display: flex; flex-wrap: wrap; gap: 6px; align-items: center;').replace('padding-bottom: 8px; margin-bottom: 8px;\n  border-bottom', 'padding-bottom: 8px; margin-bottom: 4px;\n  border-bottom'));
    const mo = await measure(page(mainWrap(BOARD.creditor), { css: oldTabs }), tabs, { w: 375 });
    assert(mo.min < 8 && mo.below < 8, `[3l] anti-vacuity: with the old gap 6 / margin 4 the SAME detector reads ${mo.min} pt between tabs and ${mo.below} pt below the divider`);
  }

  // ── [4] CHAT SETTINGS PANEL ────────────────────────────────────────────────
  console.log('\n[4] Chat settings — swatches, rows vs dividers, the alma caption, "My SCRIBE File" at 2x…');
  const swatchMeasure = () => {
    const sw = [...document.querySelectorAll('.chat-accent-swatch')];
    const layout = list => { // layout geometry: offset boxes ignore the selected swatch's transform
      let m = Infinity;
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const A = { l: a.offsetLeft, t: a.offsetTop, r: a.offsetLeft + a.offsetWidth, b: a.offsetTop + a.offsetHeight };
        const B = { l: b.offsetLeft, t: b.offsetTop, r: b.offsetLeft + b.offsetWidth, b: b.offsetTop + b.offsetHeight };
        m = Math.min(m, gap2(A, B));
      }
      return +m.toFixed(2);
    };
    const row = document.querySelector('.chat-accent-row'), cs = getComputedStyle(row);
    const before = { layout: layout(sw), visual: minPair(sw) };
    sw[4].classList.add('active');                 // a coloured swatch mid-row selected: scale(1.12) takes ~1.4 pt a side
    const after = { layout: layout(sw), visual: minPair(sw) };
    return { n: sw.length, colGap: parseFloat(cs.columnGap), rowGap: parseFloat(cs.rowGap), before, after, lines: visualLines(sw).length };
  };
  for (const mode of MODES) {
    const f = page(drawerWrap(PREFS), { attrs: mode.attrs });
    const m = await measure(f, swatchMeasure, { w: 375 });
    assert(m.n >= 9 && m.colGap >= 8 && m.rowGap >= 8, `[4a] ${mode.name}: the ${m.n} accent swatches sit in a flex row with column-gap ${m.colGap} and row-gap ${m.rowGap}, both >= 8 (the row wraps into ${m.lines} lines and keeps the gap)`);
    assert(m.before.layout >= 8 && m.after.layout >= 8, `[4b] ${mode.name}: the measured layout gap between any two swatches is ${m.before.layout} pt (needs >= 8)`);
    assert(m.after.visual >= 8, `[4c] ${mode.name}: and with a swatch SELECTED (it scales to 1.12) the visible gap around it is still ${m.after.visual} pt, >= 8`);
  }
  const prefsMeasure = () => {
    const rows = [...document.querySelectorAll('.chat-prefs-row')];
    const note = document.getElementById('pref-alma-note');
    const gaps = rows.map(r => ({ txt: r.textContent.trim().replace(/\s+/g, ' ').slice(0, 24), ...dividerGaps(r) }));
    const emptyH = note.getBoundingClientRect().height;
    note.textContent = 'All 500 schools, from ESPN.';
    const filledH = note.getBoundingClientRect().height;
    const filled = dividerGaps(note);
    return { gaps, emptyH: +emptyH.toFixed(2), filledH: +filledH.toFixed(2), filled, rowsN: rows.length };
  };
  {
    const m = await measure(page(drawerWrap(PREFS)), prefsMeasure, { w: 375 });
    const tightest = m.gaps.reduce((a, g) => Math.min(a, g.top, g.bottom), Infinity);
    assert(m.rowsN >= 7 && m.gaps.every(g => g.top >= 8 && g.bottom >= 8), `[4d] all ${m.rowsN} settings rows keep >= 8 pt between their content and the divider above and below (tightest ${tightest} pt${tightest < 8 ? ': ' + JSON.stringify(m.gaps.filter(g => g.top < 8 || g.bottom < 8)) : ''})`);
    assert(m.emptyH === m.filledH, `[4e] the alma caption's line is truly reserved: its row is ${m.emptyH} px tall empty and ${m.filledH} px with the caption — no layout jump when "Loading…" arrives (it grew 13 px before)`);
    assert(m.filled.top >= 8 && m.filled.bottom >= 8, `[4f] a filled caption sits ${m.filled.top} pt below and ${m.filled.bottom} pt above its dividers, both >= 8`);
  }
  const scribeMeasure = () => {
    const row = document.getElementById('scribe-file-btn').parentElement, btn = document.getElementById('scribe-file-btn'), label = row.querySelector('label');
    const c = contentBox(row), b = btn.getBoundingClientRect(), l = label.getBoundingClientRect();
    return { overRight: +(b.right - c.r).toFixed(2), overLeft: +(c.l - b.left).toFixed(2), stacked: b.top >= l.bottom - 1, vgap: +(b.top - l.bottom).toFixed(2), rowGap: parseFloat(getComputedStyle(row).rowGap), docOver: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      btnH: +b.height.toFixed(2), lineH: parseFloat(getComputedStyle(btn).lineHeight) || parseFloat(getComputedStyle(btn).fontSize) * 1.3, fullWidth: +(b.width - (c.r - c.l)).toFixed(2) };
  };
  for (const mode of MODES) {
    for (const scale of [1, 1.35, 2]) {
      const m = await measure(page(drawerWrap(PREFS), { attrs: mode.attrs }), scribeMeasure, { w: 375, scale });
      assert(m.overRight <= 0.5 && m.overLeft <= 0.5 && !m.docOver, `[4g] ${mode.name}, ${scale}x text: "My SCRIBE File" stays inside its row (past the right edge by ${m.overRight} pt, past the left by ${m.overLeft}; the page does not scroll sideways)`);
      assert(m.stacked && m.vgap >= 8 && Math.abs(m.fullWidth) <= 1, `[4h] ${mode.name}, ${scale}x text: the button sits UNDER its label (gap ${m.vgap} pt, needs >= 8) at the full row width (off by ${m.fullWidth} pt) — one layout at every text size`);
    }
  }
  {
    const m1 = await measure(page(drawerWrap(PREFS)), scribeMeasure, { w: 375, scale: 1 });
    assert(m1.btnH <= 52, `[4i] at 1x the button's text stays on one line (button ${m1.btnH} pt tall; side by side it wrapped to THREE lines and was 106 pt tall in the 108 pt column)`);
    // Anti-vacuity: the OLD markup (no wrap on the row) at 2x text must overflow with the same detector.
    const oldPrefs = PREFS.replace(' chat-prefs-row-wrap', '');
    assert(oldPrefs !== PREFS, '[4j-fixture] the pre-sweep row markup was reconstructed (the wrap class removed)');
    const mo = await measure(page(drawerWrap(oldPrefs)), scribeMeasure, { w: 375, scale: 2 });
    assert(mo.overRight > 4, `[4j] anti-vacuity: without the row's wrap, the SAME detector reads the button ${mo.overRight} pt past the row's right edge at 2x text (it was 12.05 pt on the 95a16c3 tree)`);
  }

  // ── [5] FEEDBACK CARD ──────────────────────────────────────────────────────
  console.log('\n[5] Feedback card — the Submit button is a centred group; the status line takes no space until it has text…');
  const fbMeasure = () => {
    const card = document.querySelector('.feedback-card'), btn = document.getElementById('fb-submit-btn'), status = document.getElementById('fb-status');
    const c = contentBox(card), b = btn.getBoundingClientRect();
    // EMPTY-state readings first — the status line is empty on a fresh card, and filling it changes the card's height.
    const empty = {
      offCenter: +(((b.left + b.right) / 2) - ((c.l + c.r) / 2)).toFixed(2),
      bottomSpace: +(card.getBoundingClientRect().bottom - parseFloat(getComputedStyle(card).borderBottomWidth) - b.bottom).toFixed(2),
      aboveSpace: +(b.top - btn.parentElement.previousElementSibling.getBoundingClientRect().bottom).toFixed(2),
      statusH: status.getBoundingClientRect().height, top: b.top,
    };
    status.textContent = '✅ Saved — the Commissioner will see it in the review panel.';
    const b2 = btn.getBoundingClientRect(), s2 = status.getBoundingClientRect();
    return {
      ...empty, btnMoved: +(b2.top - empty.top).toFixed(2), statusGap: +(s2.top - b2.bottom).toFixed(2),
      statusCentered: +(((s2.left + s2.right) / 2) - ((c.l + c.r) / 2)).toFixed(2),
      inGroup: btn.parentElement.classList.contains('btn-row') && !btn.parentElement.contains(status),
    };
  };
  for (const mode of MODES) {
    for (const scale of [1, 2]) {
      const m = await measure(page(drawerWrap(FEEDBACK), { attrs: mode.attrs }), fbMeasure, { w: 375, scale });
      const tag = `${mode.name}, 375 wide, ${scale}x text`;
      assert(Math.abs(m.offCenter) <= 1, `[5a] ${tag}: Submit Feedback is centred in the card (off by ${m.offCenter} pt; it was 27.2 pt left of centre at 1x)`);
      assert(m.inGroup, `[5b] ${tag}: the button is the only child of a .btn-row group and the status line is outside it`);
      assert(m.statusH === 0 && Math.abs(m.bottomSpace - 16) <= 0.5 && Math.abs(m.aboveSpace - m.bottomSpace) <= 0.5,
        `[5c] ${tag}: with no status the empty line takes no space (height ${m.statusH}) and the group has EQUAL space above (${m.aboveSpace} pt) and below (${m.bottomSpace} pt, the card's padding), both 16`);
      assert(m.btnMoved === 0 && m.statusGap >= 8 && Math.abs(m.statusCentered) <= 1, `[5d] ${tag}: when the status arrives the button does not move (${m.btnMoved} pt), the line sits ${m.statusGap} pt below it (>= 8) and is centred (off ${m.statusCentered})`);
    }
  }
  {
    const oldFb = FEEDBACK.replace(/<div class="btn-row"><button([^>]*id="fb-submit-btn"[^>]*)>([^<]*)<\/button><\/div>\s*<p[^>]*id="fb-status"[^>]*><\/p>/,
      '<div class="flex gap-sm flex-wrap"><button$1>$2</button><span class="text-muted text-xs" id="fb-status"></span></div>');
    assert(oldFb !== FEEDBACK, '[5e-fixture] the pre-sweep markup was reconstructed from the real card');
    const m = await measure(page(drawerWrap(oldFb)), () => {
      const card = document.querySelector('.feedback-card'), btn = document.getElementById('fb-submit-btn');
      const c = contentBox(card), b = btn.getBoundingClientRect();
      return +(((b.left + b.right) / 2) - ((c.l + c.r) / 2)).toFixed(2);
    }, { w: 375 });
    assert(Math.abs(m) > 20, `[5e] anti-vacuity: the OLD markup measures ${m} pt off-centre with the same detector — it would have gone red`);
  }
  {
    // [5f] N4 (reviewer): the empty status line must stay IN the accessibility tree so role="status" is a live region that announces the first time it fills.
    // display:none (the earlier `.fb-status:empty{display:none}`) removes it; an empty <p> is already zero-height, so only its margin needs to go.
    const live = () => { const s = document.getElementById('fb-status'), cs = getComputedStyle(s); return { display: cs.display, mt: cs.marginTop, mb: cs.marginBottom, h: s.getBoundingClientRect().height, role: s.getAttribute('role'), vis: cs.visibility }; };
    const f = page(drawerWrap(FEEDBACK));
    const m = await measure(f, live, { w: 375 });
    assert(m.display !== 'none' && m.vis === 'visible' && m.role === 'status' && m.mt === '0px' && m.mb === '0px' && m.h === 0,
      `[5f] the EMPTY status line is a live region that still exists (display ${m.display}, role ${m.role}) and takes no space (height ${m.h}, margins ${m.mt}/${m.mb})`);
    const hidden = sheet(c => c.replace('.fb-status:empty{margin:0}', '.fb-status:empty{display:none}'));
    const mo = await measure(page(drawerWrap(FEEDBACK), { css: hidden }), live, { w: 375 });
    assert(mo.display === 'none', `[5g] anti-vacuity: with the earlier display:none the SAME detector reads display ${mo.display} — the live region would have been dropped from the accessibility tree`);
    const tap = await measure(f, () => +document.getElementById('fb-submit-btn').getBoundingClientRect().height.toFixed(1), { w: 375 });
    assert(tap >= 44, `[5h] N3: Submit Feedback is ${tap} pt tall, >= 44 (scoped #fb-submit-btn rule, not a global .btn-sm change)`);
  }

  // ── [6] RELEASE NOTES ──────────────────────────────────────────────────────
  console.log('\n[6] Release notes — an open release keeps 16 pt from the next divider; bullets 8 apart; footer 16 below…');
  const relMeasure = () => {
    const entries = [...document.querySelectorAll('.release-entry')];
    const openMid = entries[2]; openMid.open = true;              // also prove a SECOND open entry in the middle of the list
    const out = [];
    entries.forEach((e, i) => {
      if (!e.open || i === entries.length - 1) return;
      const lis = [...e.querySelectorAll('li')], last = lis[lis.length - 1], next = entries[i + 1];
      out.push({ v: e.dataset.release, toDivider: +(next.getBoundingClientRect().top - last.getBoundingClientRect().bottom).toFixed(2) });
    });
    const first = entries[0], lis0 = [...first.querySelectorAll('li')];
    const liGap = Math.min(...lis0.slice(1).map((li, i) => li.getBoundingClientRect().top - lis0[i].getBoundingClientRect().bottom));
    const lastE = entries[entries.length - 1], foot = document.querySelector('.release-notes-foot');
    return { out, liGap: +liGap.toFixed(2), footGap: +(foot.getBoundingClientRect().top - lastE.getBoundingClientRect().bottom).toFixed(2), n: entries.length };
  };
  for (const mode of MODES) {
    const m = await measure(page(mainWrap(RELEASES), { attrs: mode.attrs }), relMeasure, { w: 375 });
    assert(m.out.length >= 2 && m.out.every(o => o.toDivider >= 16), `[6a] ${mode.name}: every OPEN release that is followed by another keeps >= 16 pt between its last bullet and the next divider (${m.out.map(o => o.v + ': ' + o.toDivider).join(', ')}); it was 0`);
    assert(m.liGap >= 8, `[6b] ${mode.name}: bullets inside a release are ${m.liGap} pt apart (>= 8; they were 7)`);
    assert(m.footGap >= 16, `[6c] ${mode.name}: the "Release notes start with…" footer is ${m.footGap} pt below the last entry (>= 16; it was 10)`);
  }
  {
    const old = sheet(c => c.replace('.release-entry[open]:not(:last-of-type)>div{padding-bottom:16px}', ''));
    const m = await measure(page(mainWrap(RELEASES), { css: old }), relMeasure, { w: 375 });
    assert(m.out.some(o => o.toDivider < 1), `[6d] anti-vacuity: with the padding rule deleted the SAME detector reads ${m.out.map(o => o.toDivider).join(' / ')} pt — the bullet touches the divider again`);
  }

  // ── [7] EDIT MY PICKS — THE FAMILY'S PENCIL ────────────────────────────────
  console.log('\n[7] Edit My Picks — the pencil is the Munera inline SVG, not an emoji…');
  assert(!/✏/.test(SUBMITTED.slice(SUBMITTED.indexOf('id="edit-picks-btn"'), SUBMITTED.indexOf('</button>', SUBMITTED.indexOf('id="edit-picks-btn"')))),
    '[7a] the rendered button contains no ✏ emoji');
  for (const mode of MODES) {
    const m = await measure(page(mainWrap(`<div class="card mt-md">${SUBMITTED.slice(SUBMITTED.indexOf('<div class="btn-row">'), SUBMITTED.indexOf('</div>', SUBMITTED.indexOf('go-dash-btn')) + 6)}</div>`), { attrs: mode.attrs }), () => {
      const btn = document.getElementById('edit-picks-btn'), svg = btn.querySelector('svg');
      const s = svg && svg.getBoundingClientRect(), cs = svg && getComputedStyle(svg);
      const row = btn.parentElement;
      return { has: !!svg, w: s && s.width, h: s && s.height, hidden: svg && svg.getAttribute('aria-hidden'), stroke: cs && cs.stroke, color: getComputedStyle(btn).color,
        label: btn.textContent.trim(), dev: maxCenterDev(row, [...row.children]), gap: minPair([...row.children]) };
    }, { w: 375 });
    assert(m.has && m.w === 18 && m.h === 18 && m.hidden === 'true', `[7b] ${mode.name}: the button holds an inline <svg> sized ${m.w}x${m.h} (18x18) and marked aria-hidden (the label carries the meaning)`);
    assert(m.stroke === m.color && m.label === 'Edit My Picks', `[7c] ${mode.name}: it strokes with currentColor (stroke ${m.stroke} = button text ${m.color}), so it follows every theme; label "${m.label}"`);
    assert(m.dev <= 1 && m.gap >= 8, `[7d] ${mode.name}: the Edit/Dashboard pair is still a centred group (off ${m.dev} pt) with ${m.gap} pt between the buttons`);
  }

  // ── [8] SOURCE-LEVEL GUARDS (what a measurement cannot see) ────────────────
  console.log('\n[8] Source guards — tokens only, no margin on grouped buttons, no sub-8 gap left on a button group…');
  {
    const sweepBlocks = [...CSS.matchAll(/\/\*[^*]*Breathing Room sweep \(2026-10-01\)[\s\S]*?\*\/\s*[^\n]*\n(?:[^\n}]*\{[^}]*\}\s*\n?)*/g)].map(m => m[0]);
    const body = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const sel of ['.ob-row', '.ob-actions', '.fb-status', '.chat-prefs .chat-prefs-row-wrap', '.release-entry[open]:not(:last-of-type)>div']) {
      const m = body.match(new RegExp('(?:^|[}\\s])' + sel.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&') + '\\s*\\{([^}]*)\\}'));
      assert(!!m && !/#[0-9a-fA-F]{3,8}\b/.test(m[1]) && !/rgba?\(/.test(m[1]), `[8a] ${sel}: the sweep's new rule exists and carries no hex/rgb colour (tokens only; light and dark follow) — body "${m ? m[1] : '(missing)'}"`);
    }
    assert(sweepBlocks.length >= 1 || /Breathing Room sweep \(2026-10-01\)/.test(CSS), '[8b] the sweep is banner-commented in css/styles.css so a merge can find every hunk');
    // A margin class must not appear on a button inside any group the sweep owns.
    assert(!/btn-sm ml-sm/.test(APP_SRC.slice(APP_SRC.indexOf('function obligationButtonsHTML'), APP_SRC.indexOf('export function obligationBadgeAndActions'))),
      '[8c] obligationButtonsHTML() emits no .ml-sm on any button');
    const gapRules = [['.gap-sm', 8], ['.chat-accent-row', 12], ['.rules-list', 8], ['.player-admin-field.player-admin-actions', 8], ['.pin-field', 8], ['.scribe-freq-dial', 8], ['.lc-footer', 8],
      ['.chat-header-actions', 8], ['.chat-sheet-header-actions', 8], ['.chat-search-row', 8], ['.chat-pills-scroll', 8], ['.chat-mention-menu', 8], ['.btn-row', 8]];
    for (const [sel, min] of gapRules) {
      const re = new RegExp('(?:^|[}\\s])' + sel.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'g');
      const bodies = [...body.matchAll(re)].map(m => m[1]);
      const gaps = bodies.map(b => (b.match(/(?:^|[;\s/])gap\s*:\s*(\d+)px/) || [])[1]).filter(Boolean).map(Number);
      assert(bodies.length >= 1 && gaps.length >= 1 && gaps.every(g => g >= min), `[8d] ${sel}{gap} is ${gaps.join('/')} px (needs >= ${min})`);
    }
    const ob = (body.match(/(?:^|[}\s])\.ob-actions\s*\{([^}]*)\}/) || [])[1] || '';
    assert(ob.length > 0 && !/min-width/.test(ob), `[8e] B1: .ob-actions declares NO min-width (the group may never shrink below its widest item) — body "${ob}"`);
  }

  // ── [9] NOTIFICATIONS PRIMING CARD (reviewer N2) ───────────────────────────
  console.log('\n[9] Notifications — the priming card keeps 16 pt around it; its button is a centred group 16 pt under the paragraph…');
  const primeMeasure = () => {
    const card = document.getElementById('notif-priming-card'), btn = document.getElementById('notif-priming-btn');
    const cs = getComputedStyle(card), c = contentBox(card);
    const out = { pad: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(parseFloat).join('/'), hasBtn: !!btn };
    if (!btn) return out;
    const row = btn.parentElement, b = btn.getBoundingClientRect(), grouped = row.classList.contains('btn-row');
    const prev = (grouped ? row : btn).previousElementSibling.getBoundingClientRect();   // the pre-sweep markup has no group: the paragraph is the button's own previous sibling
    return { ...out, inGroup: grouped && row.children.length === 1,
      off: +(((b.left + b.right) / 2) - ((c.l + c.r) / 2)).toFixed(2), above: +(b.top - prev.bottom).toFixed(2), h: +b.height.toFixed(1),
      below: +(card.getBoundingClientRect().bottom - parseFloat(cs.borderBottomWidth) - b.bottom).toFixed(2) };
  };
  for (const [state, html] of Object.entries(NOTIF)) {
    const hasBtn = /id="notif-priming-btn"/.test(html);
    for (const mode of MODES) {
      const m = await measure(page(drawerWrap(html), { attrs: mode.attrs }), primeMeasure, { w: 375 });
      assert(m.pad === '16/16/16/16', `[9a] ${state}, ${mode.name}: the priming card computes padding ${m.pad} (needs 16 on every side; it was 14)`);
      if (hasBtn) {
        assert(m.hasBtn && m.inGroup && Math.abs(m.off) <= 1, `[9b] ${state}, ${mode.name}: the button is the only child of a .btn-row group, centred in the card (off by ${m.off} pt)`);
        assert(m.above >= 16 && m.below >= 16, `[9c] ${state}, ${mode.name}: the group sits ${m.above} pt under the paragraph (it touched: 0 pt) and ${m.below} pt above the card's bottom edge, both >= 16`);
        assert(m.h >= 44, `[9d] ${state}, ${mode.name}: the button is ${m.h} pt tall, >= 44 (the scoped #notif-priming-btn rule)`);
      }
    }
  }
  {
    const oldPrime = sheet(c => c.replace('.notif-priming-card .btn-row{margin-top:16px}', ''));
    const html = NOTIF['never-asked'];
    const mo = await measure(page(drawerWrap(html), { css: oldPrime }), primeMeasure, { w: 375 });
    assert(mo.above < 16, `[9e] anti-vacuity: with the 16 pt group margin deleted the SAME detector reads ${mo.above} pt between the paragraph and the button`);
    const oldBare = html.replace(/<div class="btn-row">(<button[^>]*id="notif-priming-btn"[^>]*>[^<]*<\/button>)<\/div>/, '$1');
    assert(oldBare !== html, '[9e-fixture] the pre-sweep markup (a bare button under the paragraph) was reconstructed from the real card');
    const mb = await measure(page(drawerWrap(oldBare)), primeMeasure, { w: 375 });
    assert(mb.above < 8 && Math.abs(mb.off) > 8 && !mb.inGroup, `[9f] anti-vacuity: the OLD bare button reads ${mb.above} pt under the paragraph and ${mb.off} pt off-centre (the reviewer measured 0 / 16)`);
  }
} catch (e) {
  fail++;
  console.error('  ❌ the engine section threw: ' + (e && e.stack || e));
} finally {
  try { engine && engine.proc && engine.proc.kill(); } catch {}
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
}

console.log(`\n[spacingtest] ${pass} passed, ${fail} failed`);
process.stdout.write(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`, () => process.exit(fail === 0 ? 0 : 1));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
