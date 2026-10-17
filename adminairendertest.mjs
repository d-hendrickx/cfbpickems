/**
 * CFB Pickems — adminairendertest.mjs (D1 Lane C, S-2 / P-8 / G3, 2026-10-08)
 * ==========================================================================
 * THE ROUTING CARD, THE STATUS CARD, THEIR SHEETS AND THE SOURCE CHIPS, MEASURED IN A REAL BROWSER ENGINE (headless Chromium over the DevTools protocol: the mechanism
 * leaguesettingsrendertest.mjs / shellrendertest.mjs / navtest.mjs use). routingtest and sourcechipstest assert markup and class names; this suite loads the REAL css/styles.css and the
 * REAL js modules (admin-panel.js around the two cards, scribe-routes-card.js, content-status-card.js, source-chips.js, icons.js) and measures COMPUTED STYLE and LAYOUT:
 *
 *   [A] 375 pt, default text AND 1.35x text (Dynamic Type): no horizontal overflow (the page, each card, each row's own content), every tap target (the routing rows, the status rows,
 *       Retry, Refresh) at least 44 pt tall, the cards 16 pt in from the screen edge, the rows' text really did grow at 1.35x (so the larger-text pass is not vacuous)
 *   [B] the routing sheet and the status sheet: fit a 375x667 phone (an SE) and scroll INSIDE themselves, the close button is 44x44, every radio and the Save / Cancel pair at least 44 pt,
 *       the body is inset 16 pt, the Save / Cancel group is centered with 8 pt between the buttons and 16 pt above it, the radio groups are 8 pt apart; at 1.35x text too
 *   [C] the source chips: 44 pt tall, 8 pt apart (and 8 pt between wrapped rows), 8 pt under the bubble, three long-host chips wrap inside the bubble column and never overflow, at 1.35x too
 *   [D] press feedback: a real mouse-down on a routing row, a status row, a chip and the close button compresses it to 97%, and releasing returns it to 1
 *   [E] MEASUREMENT CANARIES (anti-vacuity): a mutated row height, a mutated chip gap and an unbreakable long label are each REPORTED by the SAME measurement code, so a green [A]-[C] is
 *       not a scanner that finds nothing
 *   [F] the markup this page uses for the sheet shell and the chip placement is the markup js/app.js and js/chat-ui.js really emit (source-text pins), so the replica cannot drift
 *
 * WHAT THIS DOES NOT PROVE, said plainly: it is Chromium, not WKWebView on a handset. Real touch, the iOS safe areas, VoiceOver, haptics, the swipe-down physics and Dynamic Type's own
 * scaling are device checks (the hand-off names them). A missing browser is a FAILURE here, never a skip.
 *
 * Run:  node adminairendertest.mjs        Override the browser: ADMINAI_ENGINE=/path/to/Chromium (falls back to LSTEST_ENGINE, SHELLTEST_ENGINE, NAVTEST_ENGINE, then the usual /Applications paths).
 */

import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
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

const ENGINES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
];
const override = process.env.ADMINAI_ENGINE || process.env.LSTEST_ENGINE || process.env.SHELLTEST_ENGINE || process.env.NAVTEST_ENGINE;
const bin = override || ENGINES.find((p) => existsSync(p));
console.log('\n[0] Engine…');
assert(!!bin && existsSync(bin), !bin
  ? `NO CHROMIUM-FAMILY BROWSER FOUND. Fix: ADMINAI_ENGINE=/path/to/Chromium node adminairendertest.mjs. A missing browser is a FAILURE, never a skip. Looked for: ${ENGINES.join(', ')}`
  : `engine to measure in: ${bin}${override ? ' (from env)' : ''}`);
assert(typeof WebSocket === 'function', 'this Node has a global WebSocket (v22+) to speak the DevTools protocol over');

const tmp = mkdtempSync(join(tmpdir(), 'cfbp-adminai-'));
const cssHref = 'file://' + here + 'css/styles.css';
const jsBase = 'file://' + here + 'js/';

// One page: the real stylesheet, the real page chrome (main.main-content > section.page-section#page-admin), the real modules.
const pageFile = join(tmp, 'adminai.html');
writeFileSync(pageFile, `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="stylesheet" href="${cssHref}"></head>
<body data-tab="admin">
<main class="main-content"><section class="page-section active" id="page-admin" data-admin-active="settings"></section></main>
<div id="chat-host"></div>
<script type="module">
import { renderAdminPanel } from '${jsBase}admin-panel.js';
import { renderScribeRoutesBody, renderRouteSheetBody, ROUTE_ROWS } from '${jsBase}scribe-routes-card.js';
import { renderContentStatusBody, renderStatusSheetBody, normalizeContentStatus } from '${jsBase}content-status-card.js';
import { sourceChipsHTML } from '${jsBase}source-chips.js';
import { icon } from '${jsBase}icons.js';
const escHtml = (s) => (!s ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'));
window.__ready = true;
const NOW = Date.now();
const iso = new Date(NOW - 5 * 60000).toISOString();
const STATUS = { v: 1, generatedAt: iso, rows: [
  { id: 'news:cbs', group: 'news', label: 'CBS Sports', state: 'ok', lastGoodAt: iso, items24h: 12 },
  { id: 'news:yahoo', group: 'news', label: 'Yahoo Sports News Network With A Long Name', state: 'blocked', code: 'robots_disallowed' },
  { id: 'feed', group: 'feed', label: 'Home-card synthesis', state: 'warning', spendUsd: 4.2, capUsd: 5 },
  { id: 'lookup', group: 'lookup', label: 'Source lookup', state: 'error', code: 'provider_error', searches24h: 3, runs: [{ at: iso, ok: false, code: 'provider_error' }, { at: iso, ok: true }, { at: iso, ok: true, code: null }] },
  { id: 'routes', group: 'routes', label: 'SCRIBE routes', state: 'ok' },
] };
const ROUTE_KV = { v: 1, routes: { chat: { tier: 'opus', fallback: 'sonnet' }, feed: { tier: 'sonnet', fallback: null } } };
// a stored route the resolver reports as a problem, and a spend line, so the long second line and the badge are on screen
window.__mountAdmin = (tab, o = {}) => {
  document.getElementById('chat-host').innerHTML = '';
  const page = document.getElementById('page-admin');
  page.setAttribute('data-admin-active', tab);
  const viewer = { playerId: null, isAdmin: false, playerVerified: false, userId: 'u1', isPlatformAdmin: true, isSuperAdmin: o.canWrite !== false, activeLeagueId: null, memberships: [] };
  const spend = { chat: 3.14, learn: 0.4, classify: 0.05, judge: 0.01, feed: 4.2, analysis: 0, retrieval: 0.62 };
  const bodies = {
    'scribe-routes': () => renderScribeRoutesBody({ state: o.routesState || { kv: o.kv === undefined ? ROUTE_KV : o.kv, loaded: true, spend }, canWrite: o.canWrite !== false, escHtml, icon }),
    'content-ai-status': () => renderContentStatusBody({ state: o.statusState || { data: STATUS, loaded: true }, escHtml, icon, nowMs: NOW }),
  };
  page.innerHTML = renderAdminPanel({ viewer, league: null, leagues: [], users: [], escHtml, icon, bodies, activeTab: tab });
};
// the sheet shell, markup-for-markup what js/app.js mountSheetShell() + openAdminAiSheet() emit (adminairendertest [F] pins the source text)
window.__mountSheet = (kind, arg) => {
  document.getElementById('admin-ai-sheet-wrap')?.remove();
  const wrap = document.createElement('div');
  wrap.id = 'admin-ai-sheet-wrap';
  wrap.setAttribute('data-hold-teardown', '');
  const title = kind === 'route' ? (ROUTE_ROWS.find((r) => r.cls === arg.cls) || {}).label : arg.row.label;
  const body = kind === 'route' ? renderRouteSheetBody({ cls: arg.cls, draft: arg.draft, status: arg.status || 'idle', escHtml }) : renderStatusSheetBody(arg.row, { escHtml, nowMs: NOW });
  wrap.innerHTML = '<div class="chat-sheet-backdrop"></div><div class="chat-sheet" id="admin-ai-sheet" role="dialog" aria-modal="true" aria-labelledby="admin-ai-sheet-title">'
    + '<div class="chat-sheet-header"><div class="chat-sheet-title" id="admin-ai-sheet-title" tabindex="-1">' + escHtml(title) + '</div>'
    + '<button type="button" class="chat-sheet-close admin-ai-close" id="admin-ai-sheet-close" aria-label="Close">' + icon('close') + '</button></div>'
    + '<div id="admin-ai-sheet-body" class="chat-sheet-scroll">' + body + '</div></div>';
  document.body.appendChild(wrap);
};
window.__statusRow = (id) => normalizeContentStatus(STATUS).rows.find((r) => r.id === id);
// the chips, in the placement chat-ui.js gives them: inside .chat-bubble-col, straight after .chat-bubble
window.__mountChips = (sources) => {
  document.getElementById('page-admin').innerHTML = '';
  const host = document.getElementById('chat-host');
  const m = { id: 'scribe_llm_1', author: 'scribe', relayed: false, deleted: false, meta: { sources } };
  host.innerHTML = '<div class="chat-page" style="padding:0 16px"><div class="chat-msg"><div class="chat-avatar chat-avatar-scribe">S</div><div class="chat-bubble-col"><div class="chat-meta"><span class="chat-author">SCRIBE</span></div>'
    + '<div class="chat-bubble">Nussmeier is listed as the starter. Hold your horses.</div>' + sourceChipsHTML(m, escHtml) + '</div></div></div>';
};
</script></body></html>`);

// ── the CDP client (same shape as leaguesettingsrendertest.mjs) ──
function launch() {
  const proc = spawn(bin, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + join(tmp, 'profile'), '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--allow-file-access-from-files', '--hide-scrollbars', '--disable-background-networking', '--disable-sync', '--disable-component-update', '--disable-default-apps',
    '--disable-extensions', '--disable-search-engine-choice-screen', '--metrics-recording-only', '--mute-audio', '--host-resolver-rules=MAP * ~NOTFOUND', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  return new Promise((res, rej) => {
    let buf = '';
    const t = setTimeout(() => { proc.kill(); rej(new Error('no DevTools endpoint within 25s: ' + buf.slice(-300))); }, 25000);
    proc.stderr.on('data', (d) => { buf += d.toString(); const m = buf.match(/ws:\/\/\S+/); if (m) { clearTimeout(t); res({ proc, ws: m[0] }); } });
    proc.on('error', (e) => { clearTimeout(t); rej(e); });
  });
}
async function attach(browserWs) {
  const list = await (await fetch('http://' + new URL(browserWs).host + '/json/list')).json();
  const target = list.find((t) => t.type === 'page');
  if (!target) throw new Error('no page target to attach to');
  const sock = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { sock.addEventListener('open', res, { once: true }); sock.addEventListener('error', () => rej(new Error('DevTools socket refused')), { once: true }); });
  let id = 0; const pending = new Map(); const waiters = [];
  sock.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method) waiters.filter((w) => w.method === msg.method).forEach((w) => w.res());
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const myId = ++id;
    pending.set(myId, (m) => (m.error ? rej(new Error(method + ' → ' + JSON.stringify(m.error))) : res(m.result)));
    sock.send(JSON.stringify({ id: myId, method, params }));
  });
  const once = (method) => new Promise((res) => waiters.push({ method, res }));
  return { send, once };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── the measurement code, ONE string used by every case (so the canaries exercise the SAME code) ──
const MEASURE = `
window.__measure = (scope) => {
  const R = (e) => e.getBoundingClientRect();
  const vw = innerWidth, vh = innerHeight;
  const root = scope ? document.querySelector(scope) : document.body;
  const vis = (e) => { const r = R(e); return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden'; };
  const out = { vw, vh, docOverflowX: +(document.documentElement.scrollWidth - vw).toFixed(1), clipped: [] };
  const tap = (sel) => [...root.querySelectorAll(sel)].filter(vis).map((e) => ({ h: +R(e).height.toFixed(1), w: +R(e).width.toFixed(1), id: (e.id || e.getAttribute('data-route-class') || e.getAttribute('data-status-row') || e.getAttribute('data-route-tier') || e.getAttribute('data-route-fallback') || e.className || '').toString().slice(0, 40) }));
  out.routeRows = tap('[data-route-class]'); out.statusRows = tap('[data-status-row]'); out.retry = tap('#scribe-routes-retry-btn, #content-status-retry-btn, #content-status-refresh-btn');
  out.offscreen = [...root.querySelectorAll('[data-route-class], [data-status-row], .scribe-freq-opt, .chat-source-chip, #scribe-route-save, #scribe-route-cancel')].filter(vis).filter((e) => R(e).right > vw + 0.5 || R(e).left < -0.5).map((e) => (e.getAttribute('data-route-class') || e.getAttribute('data-status-row') || e.id || e.className).toString().slice(0, 30));
  out.radios = tap('[data-route-tier], [data-route-fallback]'); out.save = tap('#scribe-route-save'); out.cancel = tap('#scribe-route-cancel'); out.close = tap('#admin-ai-sheet-close'); out.chips = tap('.chat-source-chip');
  // a row's own content must not be clipped sideways: nothing inside may poke past the row's right edge
  for (const row of root.querySelectorAll('[data-route-class], [data-status-row], .scribe-freq-opt, .chat-source-chip')) {
    if (!vis(row)) continue;
    if (row.scrollWidth > row.clientWidth + 1) out.clipped.push((row.getAttribute('data-route-class') || row.getAttribute('data-status-row') || row.className).toString().slice(0, 40) + ' ' + row.scrollWidth + '>' + row.clientWidth);
  }
  const cards = [...root.querySelectorAll('.card, .admin-section')].filter(vis).filter((c) => c.querySelector('[data-route-class], [data-status-row], #scribe-routes-retry-btn, #content-status-retry-btn'));
  out.pagePad = +parseFloat(getComputedStyle(document.querySelector('.main-content')).paddingLeft).toFixed(1);
  out.cards = cards.map((c) => ({ left: +R(c).left.toFixed(1), right: +(vw - R(c).right).toFixed(1) }));
  const lab = root.querySelector('[data-route-class] .cc-row-label span, [data-status-row] .cc-row-label span, .scribe-freq-label');
  out.labelFont = lab ? +parseFloat(getComputedStyle(lab).fontSize).toFixed(2) : null;
  // the sheet
  const sh = document.getElementById('admin-ai-sheet'), body = document.getElementById('admin-ai-sheet-body');
  if (sh && body) {
    out.sheet = { top: +R(sh).top.toFixed(1), bottom: +R(sh).bottom.toFixed(1), left: +R(sh).left.toFixed(1), right: +R(sh).right.toFixed(1), h: +R(sh).height.toFixed(1), scrolls: body.scrollHeight > body.clientHeight + 1, overflowY: getComputedStyle(body).overflowY };
    const bs = getComputedStyle(body); out.sheet.padL = parseFloat(bs.paddingLeft); out.sheet.padR = parseFloat(bs.paddingRight); out.sheet.padT = parseFloat(bs.paddingTop);
    const acts = body.querySelector('.scribe-route-actions');
    if (acts) {
      const bt = [...acts.querySelectorAll('button')].filter(vis);
      const cs = getComputedStyle(acts);
      out.actions = { n: bt.length, gap: parseFloat(cs.columnGap) || parseFloat(cs.gap) || 0, rowGap: parseFloat(cs.rowGap) || 0, justify: cs.justifyContent, wrap: cs.flexWrap, mt: parseFloat(cs.marginTop) };
      const ar = R(acts), br = bt.map(R);
      out.actions.centerOff = br.length ? +(((Math.min(...br.map((r) => r.left)) + Math.max(...br.map((r) => r.right))) / 2) - (ar.left + ar.right) / 2).toFixed(1) : null;
      // the gap between the two buttons, whichever way they sit
      if (br.length === 2) out.actions.between = Math.abs(br[0].top - br[1].top) < 2 ? +(br[1].left - br[0].right).toFixed(1) : +(br[1].top - br[0].bottom).toFixed(1);
      const grp = [...body.querySelectorAll('.scribe-freq-dial')].filter(vis);
      out.actions.aboveLast = grp.length ? +(R(acts).top - R(grp[grp.length - 1]).bottom).toFixed(1) : null;
    }
    const dials = [...body.querySelectorAll('.scribe-freq-dial')].filter(vis);
    out.dialGaps = []; for (let i = 1; i < dials.length; i++) out.dialGaps.push(+(R(dials[i]).top - R(dials[i - 1]).bottom).toFixed(1));
    out.dialTitleGap = dials.length ? +(R(dials[0]).top - R(body.querySelector('p') || dials[0]).bottom).toFixed(1) : null;
  }
  // the chips
  const row = root.querySelector('.chat-source-row');
  if (row) {
    const cs = getComputedStyle(row), chips = [...row.querySelectorAll('.chat-source-chip')].filter(vis), rr = R(row), bub = root.querySelector('.chat-bubble'), col = root.querySelector('.chat-bubble-col');
    out.chipRow = { gap: parseFloat(cs.columnGap) || 0, rowGap: parseFloat(cs.rowGap) || 0, wrap: cs.flexWrap, mt: parseFloat(cs.marginTop), underBubble: bub ? +(rr.top - R(bub).bottom).toFixed(1) : null,
      overflowsCol: col ? chips.some((c) => R(c).right > R(col).right + 0.5 || R(c).left < R(col).left - 0.5) : null, n: chips.length };
    out.chipGaps = [];
    for (let i = 1; i < chips.length; i++) { const a = R(chips[i - 1]), b = R(chips[i]); out.chipGaps.push(Math.abs(a.top - b.top) < 2 ? +(b.left - a.right).toFixed(1) : +(b.top - a.bottom).toFixed(1)); }
  }
  return out;
};
`;

let engine = null;
const tallyAndExit = async () => {
  console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
  try { engine?.proc?.kill(); } catch { /* the browser is going away anyway */ }
  process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
};
try {
  if (!bin) throw new Error('no engine binary');
  engine = await launch();
  const pg = await attach(engine.ws);
  await pg.send('Page.enable'); await pg.send('Runtime.enable');
  const evaluate = async (expression) => {
    const r = await pg.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('page threw: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const open = async (w, h, { text = 1, reducedMotion = false } = {}) => {
    await pg.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true });
    await pg.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reducedMotion ? 'reduce' : 'no-preference' }] });
    const loaded = pg.once('Page.loadEventFired');
    await pg.send('Page.navigate', { url: 'file://' + pageFile });
    await loaded;
    for (let i = 0; i < 60 && !(await evaluate('!!window.__ready')); i++) await sleep(50);
    await evaluate(MEASURE);
    // Dynamic Type, as far as this page can tell: the root font size, which every rem in the stylesheet follows
    await evaluate(`document.documentElement.style.fontSize = '${text * 100}%'`);
  };
  const settle = async () => {
    await evaluate('(async () => { try { await document.fonts.ready; } catch {} return true; })()');
    for (let i = 0; i < 40; i++) { await sleep(50); if ((await evaluate('document.getAnimations().length')) === 0) break; }      // the sheet slides in: measure it AT REST
    await sleep(50);
  };
  const mouse = async (type, x, y) => pg.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  const center = (sel) => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  const scaleOf = (sel) => evaluate(`(() => { const t = getComputedStyle(document.querySelector(${JSON.stringify(sel)})).transform; if (t === 'none') return 1; const m = t.match(/matrix\\(([^)]+)\\)/); return m ? +parseFloat(m[1].split(',')[0]).toFixed(3) : null; })()`);

  const min = (a) => (a.length ? Math.min(...a.map((x) => x.h)) : Infinity);
  const check = (m, label, { sheet = false } = {}) => {
    const problems = [];
    if (m.docOverflowX > 0.5) problems.push(`page overflows sideways by ${m.docOverflowX}px`);
    if (m.clipped.length) problems.push(`content clipped inside ${JSON.stringify(m.clipped)}`);
    if (m.offscreen && m.offscreen.length) problems.push(`a control extends past the screen edge: ${JSON.stringify(m.offscreen)}`);
    for (const k of ['routeRows', 'statusRows', 'retry', 'radios', 'save', 'cancel', 'close', 'chips']) {
      const bad = (m[k] || []).filter((x) => x.h < 43.5);
      if (bad.length) problems.push(`${k} under 44 pt tall: ${JSON.stringify(bad)}`);
    }
    if ((m.close || []).some((x) => x.w < 43.5)) problems.push(`close button under 44 pt wide`);
    if (m.cards && m.cards.some((c) => Math.abs(c.left - m.pagePad) > 0.6 || Math.abs(c.right - m.pagePad) > 0.6)) problems.push(`a card is not flush with the page's own content edge (${m.pagePad}): ${JSON.stringify(m.cards)}`);
    if (m.chipRow && m.chipRow.overflowsCol) problems.push('a chip pokes out of the bubble column');
    if (m.chipRow && Math.abs(m.chipRow.gap - 8) > 0.6) problems.push(`chip column gap ${m.chipRow.gap} is not 8`);
    if (m.chipRow && Math.abs(m.chipRow.rowGap - 8) > 0.6) problems.push(`chip row gap ${m.chipRow.rowGap} is not 8`);
    if (m.chipGaps && m.chipGaps.some((g) => Math.abs(g - 8) > 0.6)) problems.push(`measured chip gaps ${JSON.stringify(m.chipGaps)} are not 8`);
    if (m.chipRow && m.chipRow.underBubble !== null && Math.abs(m.chipRow.underBubble - 8) > 0.6) problems.push(`chips are ${m.chipRow.underBubble} under the bubble, not 8`);
    if (sheet && m.sheet) {
      if (m.sheet.bottom > m.vh + 0.5 || m.sheet.top < -0.5) problems.push(`the sheet leaves the viewport (${m.sheet.top}..${m.sheet.bottom} of ${m.vh})`);
      if (m.sheet.overflowY !== 'auto' && m.sheet.overflowY !== 'scroll') problems.push(`the sheet body does not scroll inside itself (${m.sheet.overflowY})`);
      if (Math.abs(m.sheet.padL - 16) > 0.6 || Math.abs(m.sheet.padR - 16) > 0.6) problems.push(`sheet body inset ${m.sheet.padL}/${m.sheet.padR} is not 16`);
    }
    if (sheet && m.actions) {
      if (m.actions.n !== 2) problems.push(`${m.actions.n} buttons in the action group`);
      if (Math.abs(m.actions.between - 8) > 0.6) problems.push(`Save / Cancel are ${m.actions.between} apart, not 8`);
      if (Math.abs(m.actions.centerOff) > 1.5) problems.push(`the Save / Cancel group is ${m.actions.centerOff} off center`);
      if (m.actions.justify !== 'center') problems.push(`the group is not centered (justify-content ${m.actions.justify})`);
      if (m.actions.aboveLast < 15.5) problems.push(`only ${m.actions.aboveLast} between the last radio group and the actions, not 16`);
    }
    if (sheet && m.dialGaps && m.dialGaps.some((g) => g < 7.5)) problems.push(`radio groups are ${JSON.stringify(m.dialGaps)} apart, under 8`);
    if (problems.length) console.error('     ' + label + ' → ' + problems.join(' | '));
    return problems;
  };

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[A] THE CARDS at 375 pt - default text and 1.35x text…');
  for (const text of [1, 1.35]) {
    for (const [tab, what, key] of [['settings', 'routing card', 'routeRows'], ['data', 'status card', 'statusRows']]) {
      await open(375, 812, { text });
      await evaluate(`__mountAdmin(${JSON.stringify(tab)})`); await settle();
      const m = await evaluate('__measure("#page-admin")');
      const p = check(m, `A ${what} ${text}x`);
      assert(m[key].length >= 5 && p.length === 0, `A ${what} at ${text}x text: ${m[key].length} rows, no sideways overflow, nothing clipped, every tap target >= 44 pt (smallest ${min(m[key])}), cards flush with the page edge (${m.cards.map((c) => c.left).join('/')} = the page's own ${m.pagePad} pt inset)`);
      if (text === 1) globalThis.__font1 = globalThis.__font1 || {}, globalThis.__font1[tab] = m.labelFont;
      else assert(m.labelFont > globalThis.__font1[tab] * 1.3, `A ${what}: the row text really grew at 1.35x (${globalThis.__font1[tab]} -> ${m.labelFont} px), so the larger-text pass is not vacuous`);
    }
    // the calm failure states each carry a Retry: it is a tap target too
    await open(375, 812, { text });
    await evaluate(`__mountAdmin('settings', { routesState: { kv: null, loaded: false, error: 'failed', attempted: true } })`); await settle();
    const bad1 = await evaluate('__measure("#page-admin")');
    const pBad1 = check(bad1, `A routing card unreadable ${text}x`);
    assert(bad1.retry.length === 1 && bad1.routeRows.length === 0 && pBad1.length === 0, `A routing card unreadable at ${text}x: the Retry button is there, >= 44 pt (${min(bad1.retry)}), no overflow`);
    await evaluate(`__mountAdmin('data', { statusState: { data: null, loaded: false, error: 'unavailable', attempted: true } })`); await settle();
    const bad2 = await evaluate('__measure("#page-admin")');
    const pBad2 = check(bad2, `A status card not installed ${text}x`);
    assert(bad2.retry.length === 1 && pBad2.length === 0, `A status card "not installed" at ${text}x: the Retry button is there, >= 44 pt (${min(bad2.retry)}), no overflow`);
    await open(375, 812, { text });
    await evaluate(`__mountAdmin('settings', { kv: null, canWrite: false })`); await settle();
    const ro = await evaluate('__measure("#page-admin")');
    assert(ro.routeRows.length === 0 && ro.docOverflowX <= 0.5, `A read-only routing card at ${text}x: no tap targets and no overflow`);
  }

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[B] THE SHEETS at 375x667 (an SE) - default text and 1.35x…');
  for (const text of [1, 1.35]) {
    for (const [name, call] of [
      ['routing sheet (chat: tier + fallback)', `__mountSheet('route', { cls: 'chat', draft: { tier: 'sonnet', fallback: null } })`],
      ['routing sheet (chat, failed save)', `__mountSheet('route', { cls: 'chat', draft: { tier: 'opus', fallback: 'sonnet' }, status: 'failed' })`],
      ['routing sheet (feed: tier only)', `__mountSheet('route', { cls: 'feed', draft: { tier: 'haiku', fallback: null } })`],
      ['status sheet (a red row with runs)', `__mountSheet('status', { row: __statusRow('lookup') })`],
    ]) {
      await open(375, 667, { text });
      await evaluate(call); await settle();
      const m = await evaluate('__measure("#admin-ai-sheet-wrap")');
      const p = check(m, `B ${name} ${text}x`, { sheet: true });
      const isRoute = /route/.test(call);
      assert(p.length === 0 && !!m.sheet && (isRoute ? m.radios.length >= 2 && m.save.length === 1 && m.cancel.length === 1 : true) && m.close.length === 1,
        `B ${name} at ${text}x: fits the 375x667 viewport, scrolls inside itself, the close button is 44x44, ${isRoute ? `${m.radios.length} radios and Save / Cancel >= 44 pt, ` : ''}the body is inset 16 pt${isRoute ? `, Save / Cancel centered 8 pt apart and 16 pt below the last group (gap ${m.actions?.between}, above ${m.actions?.aboveLast})` : ''}`);
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[C] THE SOURCE CHIPS in the bubble column - 375 pt, default and 1.35x text…');
  const SRC3 = [{ label: 'ESPN', url: 'https://www.espn.com/a', publishedAt: '2026-10-03' }, { label: 'x', url: 'https://www.cbssports.com/b', publishedAt: '2026-09-28' }, { label: 'x', url: 'https://a-very-long-publisher-hostname-for-wrapping.example.com/c', publishedAt: null }];
  for (const text of [1, 1.35]) {
    for (const [name, srcs] of [['one chip', SRC3.slice(0, 1)], ['three chips, one with a very long host', SRC3]]) {
      await open(375, 812, { text });
      await evaluate(`__mountChips(${JSON.stringify(srcs)})`); await settle();
      const m = await evaluate('__measure("#chat-host")');
      const p = check(m, `C ${name} ${text}x`);
      assert(p.length === 0 && m.chipRow.n === srcs.length && m.docOverflowX <= 0.5, `C ${name} at ${text}x: ${m.chipRow.n} chip(s) >= 44 pt tall, 8 pt apart (gaps ${JSON.stringify(m.chipGaps)}), 8 pt under the bubble (${m.chipRow.underBubble}), none pokes out of the column, no page overflow`);
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[D] PRESS FEEDBACK - a real mouse-down compresses to 97% and releasing returns it…');
  {
    await open(375, 812);
    await evaluate(`__mountAdmin('settings')`); await settle();
    const targets = [['routing row', '[data-route-class="chat"]']];
    for (const [name, sel] of targets) {
      const c = await center(sel);
      await mouse('mouseMoved', c.x, c.y); await mouse('mousePressed', c.x, c.y); await sleep(260);
      const down = await scaleOf(sel);
      await mouse('mouseReleased', c.x, c.y); await sleep(260);
      const up = await scaleOf(sel);
      assert(Math.abs(down - 0.97) <= 0.011 && up === 1, `D ${name}: pressed scale ${down} (97%), released ${up}`);
    }
    await evaluate(`__mountAdmin('data')`); await settle();
    {
      const sel = '[data-status-row="lookup"]'; const c = await center(sel);
      await mouse('mouseMoved', c.x, c.y); await mouse('mousePressed', c.x, c.y); await sleep(260);
      const down = await scaleOf(sel); await mouse('mouseReleased', c.x, c.y); await sleep(260); const up = await scaleOf(sel);
      assert(Math.abs(down - 0.97) <= 0.011 && up === 1, `D status row: pressed scale ${down} (97%), released ${up}`);
    }
    await evaluate(`__mountChips(${JSON.stringify(SRC3.slice(0, 2))})`); await settle();
    {
      const sel = '.chat-source-chip'; const c = await center(sel);
      await mouse('mouseMoved', c.x, c.y); await mouse('mousePressed', c.x, c.y); await sleep(260);
      const down = await scaleOf(sel); await mouse('mouseReleased', c.x, c.y); await sleep(260); const up = await scaleOf(sel);
      assert(Math.abs(down - 0.97) <= 0.011 && up === 1, `D source chip: pressed scale ${down} (97%), released ${up}`);
    }
    await evaluate(`__mountSheet('route', { cls: 'chat', draft: { tier: 'sonnet', fallback: null } })`); await settle();
    {
      const sel = '#admin-ai-sheet-close'; const c = await center(sel);
      await mouse('mouseMoved', c.x, c.y); await mouse('mousePressed', c.x, c.y); await sleep(260);
      const down = await scaleOf(sel); await mouse('mouseReleased', c.x, c.y); await sleep(260); const up = await scaleOf(sel);
      assert(Math.abs(down - 0.97) <= 0.011 && up === 1, `D sheet close button: pressed scale ${down} (97%), released ${up}`);
    }
    // Reduce Motion: the shared row keeps its instant pressed state (the app-wide Control Center rule) but its transition is OFF; the chip and the close button (this lane's own rules) do not move at all
    await open(375, 812, { reducedMotion: true });
    await evaluate(`__mountAdmin('settings')`); await settle();
    {
      const sel = '[data-route-class="chat"]'; const c = await center(sel);
      const dur = await evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(sel)})).transitionDuration`);
      await mouse('mouseMoved', c.x, c.y); await mouse('mousePressed', c.x, c.y); await sleep(120);
      const down = await scaleOf(sel); await mouse('mouseReleased', c.x, c.y);
      assert(/^0s(, 0s)*$/.test(dur) && Math.abs(down - 0.97) <= 0.011, `D Reduce Motion: the routing row's transition is OFF (${dur}); its pressed state is instant (scale ${down}), as every Control Center row`);
    }
    await evaluate(`__mountChips(${JSON.stringify(SRC3.slice(0, 2))})`); await settle();
    {
      const sel = '.chat-source-chip'; const c = await center(sel);
      await mouse('mouseMoved', c.x, c.y); await mouse('mousePressed', c.x, c.y); await sleep(120);
      const down = await scaleOf(sel); await mouse('mouseReleased', c.x, c.y);
      assert(down === 1, `D Reduce Motion: the source chip does not move when pressed (scale ${down})`);
    }
    await evaluate(`__mountSheet('route', { cls: 'chat', draft: { tier: 'sonnet', fallback: null } })`); await settle();
    {
      const sel = '#admin-ai-sheet-close'; const c = await center(sel);
      await mouse('mouseMoved', c.x, c.y); await mouse('mousePressed', c.x, c.y); await sleep(120);
      const down = await scaleOf(sel); await mouse('mouseReleased', c.x, c.y);
      assert(down === 1, `D Reduce Motion: the sheet's close button does not move when pressed (scale ${down})`);
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[E] MEASUREMENT CANARIES - the SAME measurement code must REPORT a broken layout…');
  {
    const inject = (css) => evaluate(`(() => { const s = document.createElement('style'); s.id = 'canary'; s.textContent = ${JSON.stringify(css)}; document.head.appendChild(s); return true; })()`);
    await open(375, 812);
    await evaluate(`__mountAdmin('settings')`); await settle();
    await inject('[data-route-class]{height:30px !important;min-height:0 !important;padding-top:0 !important;padding-bottom:0 !important}');
    let m = await evaluate('__measure("#page-admin")');
    assert(check(m, 'canary row height').some((p) => /routeRows under 44/.test(p)), 'E canary 1: a routing row mutated to 30 pt is REPORTED as under 44 pt by the same check');
    await open(375, 812);
    await evaluate(`__mountChips(${JSON.stringify(SRC3)})`); await settle();
    await inject('.chat-source-row{gap:0 !important;margin-top:0 !important}');
    m = await evaluate('__measure("#chat-host")');
    const pc = check(m, 'canary chip gap');
    assert(pc.some((p) => /chip column gap 0/.test(p)) && pc.some((p) => /not 8/.test(p)), 'E canary 2: a chip row mutated to a 0 gap and 0 margin is REPORTED (gap and distance under the bubble)');
    await open(375, 812, { text: 1.35 });
    await evaluate(`__mountAdmin('settings')`); await settle();
    await inject('[data-route-class]{width:600px !important;flex:none !important}');
    m = await evaluate('__measure("#page-admin")');
    assert(check(m, 'canary overflow').some((p) => /overflow|clipped|extends past/.test(p)), 'E canary 3: a row forced 600 pt wide at 1.35x text is REPORTED as sideways overflow / clipping');
    await open(375, 667);
    await evaluate(`__mountSheet('route', { cls: 'chat', draft: { tier: 'sonnet', fallback: null } })`); await settle();
    await inject('.scribe-route-actions{gap:0 !important;justify-content:flex-start !important}');
    m = await evaluate('__measure("#admin-ai-sheet-wrap")');
    assert(check(m, 'canary actions', { sheet: true }).some((p) => /not 8|not centered|off center/.test(p)), 'E canary 4: a Save / Cancel group mutated to a 0 gap and left-aligned is REPORTED');
  }

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[F] THE REPLICA CANNOT DRIFT - the markup this page uses is what js/app.js and js/chat-ui.js emit…');
  {
    const app = readFileSync(here + 'js/app.js', 'utf8'), chatUi = readFileSync(here + 'js/chat-ui.js', 'utf8'), panel = readFileSync(here + 'js/admin-panel.js', 'utf8');
    assert(/<div class="chat-sheet-title" id="admin-ai-sheet-title" tabindex="-1"><\/div><button type="button" class="chat-sheet-close admin-ai-close" id="admin-ai-sheet-close" aria-label="Close">\$\{icon\('close'\)\}<\/button>/.test(app)
      && /<div class="chat-sheet-backdrop"><\/div>\s*<div class="chat-sheet" id="\$\{escHtml\(sheetId\)\}"\$\{sheetAttrs\}>/.test(app) && /<div id="\$\{escHtml\(bodyId\)\}" class="chat-sheet-scroll"><\/div>/.test(app)
      && /wrapId: ADMIN_AI_SHEET_WRAP_ID, sheetId: 'admin-ai-sheet'/.test(app) && /bodyId: 'admin-ai-sheet-body'/.test(app),
      'F the sheet shell in this page (backdrop, .chat-sheet, header with the title and the .admin-ai-close button, .chat-sheet-scroll body, the ids) is the one app.js mounts');
    assert(/\$\{quoteHTML\(m\)\}\s*<div class="chat-bubble">[^\n]*<\/div>\s*\n\s*\$\{scribe && !m\.deleted \? sourceChipsHTML\(m, esc\) : ''\}/.test(chatUi) && /<div class="chat-bubble-col">/.test(chatUi),
      'F chat-ui.js puts the chip row straight after .chat-bubble inside .chat-bubble-col, which is the placement this page measures');
    assert(/data-admin-tab/.test(panel) && /'scribe-routes'/.test(panel) && /'content-ai-status'/.test(panel), 'F admin-panel.js renders both cards in the data-admin-tab sections this page activates');
  }
} catch (e) {
  fail++;
  console.error('  ❌ the browser run failed:', e.message);
}
await tallyAndExit();
