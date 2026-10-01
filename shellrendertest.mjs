/**
 * CFB Pickems — shellrendertest.mjs
 * =================================
 * ENGINE-MEASURED app-shell layout: the control-center drawer and the
 * one-line header, laid out by a real Chromium against the REAL
 * css/styles.css and (for the drawer) the REAL js/control-center.js.
 *
 * Why an engine: both defects below were invisible to every Node suite.
 * controlcentertest.mjs passed on the shipped v0.27.0 build (its fake DOM has
 * no transform, no stacking, no layout), and headermetatest.mjs pins CSS TEXT
 * — neither can see where a box actually lands. Same technique and same
 * "a missing browser is a FAILURE, never a skip" rule as navtest.mjs [7].
 *
 *   [A] RG-278 (live v0.27.0 web, Drew 2026-09-28): tapping the top-left
 *       control-center trigger "grays out the screen but no settings or
 *       control center pops up". #control-center's transform is keyed ONLY
 *       on --cc-drag-progress; the tap path changed `phase`/`data-open`
 *       (which fades the scrim in) but never settled the progress at 1, so
 *       the panel sat at translateX(-100%) behind a visible scrim. Measured
 *       here: after a REAL mouse click on the trigger the panel's rect is
 *       inside the viewport, visible, stacked above the scrim, and is what
 *       a tap in its middle actually hits; after ✕ it is fully off-screen
 *       again and the scrim no longer takes input. Both motion and
 *       reduced-motion paths.
 *
 *   [B] Header league pill centred (Drew's design feedback on v0.27.0, DI-393
 *       amendment, coordinator-approved inline 2026-09-28): "the 'IRB
 *       Pickems' pill in the top header is not centered in the space it's
 *       in". At 375 and 390 px: with room, the pill sits visually centred
 *       between the trigger's visible content and the week zone (±1 px); the
 *       STRICT truncation order still holds (the pill is hidden before the
 *       week name ever ellipsizes, the status badge never clips, the sync
 *       icon never leaves the row); and a mutant header WITHOUT the leading
 *       spacer goes red on the centring assertion (anti-vacuity).
 *
 * The header fixture fills the zones with the exact markup js/app.js writes
 * (renderControlCenterTrigger() web shape, renderLeaguePill() single-league
 * shape, refreshHeader()'s week line, updateSyncBadge()'s glyph) inside the
 * REAL `<header class="app-header">` block lifted from index.html, and hides
 * the pill below 48 px exactly as _fitLeaguePill() does (headermetatest.mjs
 * [pill] drives the real function). Web fonts are not loaded offline
 * (Oswald falls back), so absolute widths differ slightly from a device; the
 * RELATIONS asserted here (order, containment, centring) do not depend on
 * the font.
 *
 * FONTS ARE DETERMINISTIC (v0.27.1 round 2, reviewer condition 2). The
 * browser is launched with ALL network resolution blocked, so styles.css's
 * Google Fonts @import never loads and every run — online or offline — lays
 * out with the same local fallback faces. The assertions are RELATIONS
 * (order, containment, centring). Centring is only meaningful where the row
 * HAS free space: in the fallback faces a 375–393 px row has none (the pill
 * is already shrinking), so the centring and mutant floors are met at 430,
 * 600 and 844 px (Pro Max portrait, small tablet, phone landscape) with a
 * short label ("IRB Pool") — font-independent by construction. Set
 * SHELLTEST_WEBFONTS=1 to allow the network instead and REQUIRE Oswald to
 * load (document.fonts.load, explicit) — a loud failure if it does not; that
 * mode is a manual device-like check, never what loadtest runs.
 *
 * Run: node shellrendertest.mjs   (spawned by loadtest.mjs [112e])
 * Override the browser: SHELLTEST_ENGINE=/path/to/Chromium (falls back to
 * NAVTEST_ENGINE, then the usual /Applications paths).
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
const override = process.env.SHELLTEST_ENGINE || process.env.NAVTEST_ENGINE;
const bin = override || ENGINES.find(p => existsSync(p));
console.log('\n[0] Engine…');
assert(!!bin && existsSync(bin), !bin
  ? `NO CHROMIUM-FAMILY BROWSER FOUND. Fix: SHELLTEST_ENGINE=/path/to/Chromium node shellrendertest.mjs. A missing browser is a FAILURE, never a skip. Looked for: ${ENGINES.join(', ')}`
  : `engine to measure in: ${bin}${override ? ' (from env)' : ''}`);
assert(typeof WebSocket === 'function', 'this Node has a global WebSocket (v22+) to speak the DevTools protocol over');

const WEBFONTS = process.env.SHELLTEST_WEBFONTS === '1';
console.log(WEBFONTS
  ? '  (SHELLTEST_WEBFONTS=1 — network allowed, Oswald REQUIRED to load)'
  : '  (network blocked — deterministic local fallback fonts; set SHELLTEST_WEBFONTS=1 to measure with Oswald)');
const tmp = mkdtempSync(join(tmpdir(), 'cfbp-shellrender-'));
const cssHref = 'file://' + here + 'css/styles.css';
const jsBase = 'file://' + here + 'js/';
const htmlSrc = readFileSync(join(here, 'index.html'), 'utf8');
const headerStart = htmlSrc.indexOf('<header class="app-header">');
const headerHtml = headerStart >= 0 ? htmlSrc.slice(headerStart, htmlSrc.indexOf('</header>', headerStart) + 9) : '';
assert(headerHtml.includes('id="control-center-trigger"') && headerHtml.includes('id="league-pill"') && headerHtml.includes('id="header-meta"') && headerHtml.includes('id="sync-badge"'),
  'fixture: the REAL <header class="app-header"> block was lifted from index.html with all its zones');

// ── fixtures ────────────────────────────────────────────────────────────────
function page(name, body) {
  const file = join(tmp, name + '.html');
  writeFileSync(file, `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="stylesheet" href="${cssHref}"></head>
<body data-tab="picks">${body}</body></html>`);
  return file;
}

// [A] — the drawer page: the real header, some page content, the real pill
// nav markup, and the real #control-center-root mount point, with the real
// module mounted and the trigger bound exactly as js/app.js:3712 binds it
// (minus its isContentWithheld() gate, which is app state, not layout).
const navStart = htmlSrc.indexOf('<nav class="bottom-nav"');
const navHtml = navStart >= 0 ? htmlSrc.slice(navStart, htmlSrc.indexOf('</nav>', navStart) + 6) : '';
const drawerFile = page('drawer', `<div class="page-wrapper">${headerHtml}
<main class="main-content"><section class="page-section active" id="page-picks">${'<div class="card" style="height:160px">Game</div>'.repeat(8)}</section></main>
${navHtml}</div>
<div id="control-center-root"></div>
<script type="module">
import { mountControlCenter } from '${jsBase}control-center.js';
import { icon } from '${jsBase}icons.js';
const escHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ctx = { session:{ player:{ id:'p1', displayName:'Drew', initials:'DH', almaMater:'Texas A&M' } }, memberships:[],
  league:{ id:'l1', name:'IRB Pick\\u2019Ems', pilot:false }, escHtml, icon, isNativeShell:()=>false,
  flags:{ isCommissioner:true, isPlatformAdmin:false, isSuperAdmin:false, isPilotLeague:false },
  version:{ APP_VERSION:'0.27.0', APP_VERSION_DATE:'2026-09-27' },
  bodies:{ notifSettingsHTML:'', chatPrefsHTML:'', scribeFileHTML:'', feedbackCardHTML:'', gameRequestHTML:'', releaseNotesHTML:'' },
  // REVIEWER ROUND 2 (RG-298, 2026-09-28) — accountRows:true so section [D]'s
  // Profile-pane rows (Your Leagues, Password, Sign Out, Delete Account) are
  // actually present to measure; section [A] does not touch Profile at all
  // and is unaffected by this addition.
  accountRows:true, hasPasswordIdentity:null,
  currentTimeZone:'PT', currentTheme:'neutral', logoView:false, callbacks:{} };
const trig = document.getElementById('control-center-trigger');
// DI-405 (2026-09-28, Drew's ruling "Munera mark on web too"): the trigger is the mark ONLY on both platforms.
trig.innerHTML = '<span class="control-center-trigger-mark">' + icon('munera') + '</span>';
const api = mountControlCenter(document.getElementById('control-center-root'), ctx);
trig.addEventListener('click', () => { api.open(); });
window.__ccReady = true;
</script>`);
assert(navHtml.includes('class="bottom-nav"'), 'fixture: the REAL bottom-nav pill markup was lifted from index.html (the drawer must stack above it too)');

// [B] — the header page: an empty shell; each case is built in-page.
const headerFile = page('header', `<div id="host"></div>`);

// [C] — DI-399(b-ii) reviewer round 2 (2026-09-28), finding 3: Chat's
// bottom-edge pull-to-refresh indicator must never change #chat-scroll's
// own measured height as it grows from idle (empty) to armed (labelled).
// Real #page-chat.active flex column (the REAL CSS rule, not a stand-in),
// a real .chat-scroll with enough content to force it to actually SCROLL
// (min-height:0 + flex:1 only matters once there is overflow), the real
// .chat-pull-refresh-wrap/.chat-pull-refresh pair, and a composer-shaped
// placeholder (.chat-composer already carries flex:0 0 auto in the real
// CSS, styles.css:3211) below it. body[data-tab="chat"] is set explicitly
// (page()'s helper hardcodes "picks") since one of the two bugs this
// fixture proves fixed (the OTHER: double-counted --nav-bar-clearance) is
// keyed on exactly that attribute.
const chatFile = join(tmp, 'chat.html');
writeFileSync(chatFile, `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="stylesheet" href="${cssHref}"></head>
<body data-tab="chat"><div class="page-wrapper">
<section class="page-section active" id="page-chat">
  <div class="chat-scroll" id="chat-scroll">${'<div style="height:80px">msg</div>'.repeat(30)}</div>
  <div class="chat-pull-refresh-wrap"><div class="chat-pull-refresh" id="chat-pull-refresh" data-phase="idle" aria-hidden="true"></div></div>
  <div class="chat-composer" style="height:64px">composer</div>
</section>
</div></body></html>`);

// ── the CDP client (same shape as navtest.mjs [7]) ──────────────────────────
function launch() {
  const proc = spawn(bin, ['--headless=new', '--remote-debugging-port=0',
    '--user-data-dir=' + join(tmp, 'profile'), '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--allow-file-access-from-files', '--hide-scrollbars',
    '--disable-background-networking', '--disable-sync', '--disable-component-update',
    '--disable-default-apps', '--disable-extensions', '--disable-search-engine-choice-screen',
    '--metrics-recording-only', '--mute-audio',
    ...(WEBFONTS ? [] : ['--host-resolver-rules=MAP * ~NOTFOUND']),   // no network, ever: deterministic fonts
    'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  return new Promise((res, rej) => {
    let buf = '';
    const t = setTimeout(() => { proc.kill(); rej(new Error('no DevTools endpoint within 25s: ' + buf.slice(-300))); }, 25000);
    proc.stderr.on('data', d => {
      buf += d.toString();
      const m = buf.match(/ws:\/\/\S+/);
      if (m) { clearTimeout(t); res({ proc, ws: m[0] }); }
    });
    proc.on('error', e => { clearTimeout(t); rej(e); });
  });
}
async function attach(browserWs) {
  const list = await (await fetch('http://' + new URL(browserWs).host + '/json/list')).json();
  const target = list.find(t => t.type === 'page');
  if (!target) throw new Error('no page target to attach to');
  const sock = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    sock.addEventListener('open', res, { once: true });
    sock.addEventListener('error', () => rej(new Error('DevTools socket refused')), { once: true });
  });
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
  return { send, once };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

let engine = null;
try {
  if (!bin) throw new Error('no engine binary');
  engine = await launch();
  const pg = await attach(engine.ws);
  await pg.send('Page.enable');
  await pg.send('Runtime.enable');
  const evaluate = async (expression) => {
    const r = await pg.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('page threw: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const open = async (file, w, h, reducedMotion = false) => {
    await pg.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true });
    await pg.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reducedMotion ? 'reduce' : 'no-preference' }] });
    const loaded = pg.once('Page.loadEventFired');
    await pg.send('Page.navigate', { url: 'file://' + file });
    await loaded;
  };
  const click = async (x, y) => {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await pg.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    }
  };

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[A] RG-278 — the control-center drawer is ON SCREEN after a real tap on the trigger (390×844)…');
  // ═════════════════════════════════════════════════════════════════════════
  const MEASURE_DRAWER = `(() => {
    const d = document.getElementById('control-center'), b = document.getElementById('control-center-backdrop');
    const r = d.getBoundingClientRect(), cs = getComputedStyle(d), bs = getComputedStyle(b);
    const midX = Math.max(1, Math.min(innerWidth - 1, r.left + r.width / 2)), midY = Math.round(innerHeight / 2);
    const hit = document.elementFromPoint(midX, midY);
    const nav = document.querySelector('.bottom-nav'), hdr = document.querySelector('.app-header');
    return { vw: innerWidth, vh: innerHeight, left: +r.left.toFixed(1), right: +r.right.toFixed(1), width: +r.width.toFixed(1),
      phase: d.dataset.phase, open: d.dataset.open, progress: d.style.getPropertyValue('--cc-drag-progress').trim(),
      visibility: cs.visibility, display: cs.display, opacity: cs.opacity, z: Number(cs.zIndex), backdropZ: Number(bs.zIndex),
      navZ: Number(getComputedStyle(nav).zIndex), headerZ: Number(getComputedStyle(hdr).zIndex),
      backdropOpacity: Number(bs.opacity), backdropPE: bs.pointerEvents,
      hitInDrawer: !!(hit && d.contains(hit)), hitIsBackdrop: hit === b, inert: d.hasAttribute('inert') };
  })()`;
  for (const reducedMotion of [false, true]) {
    const tag = reducedMotion ? 'reduced motion' : 'motion';
    await open(drawerFile, 390, 844, reducedMotion);
    for (let i = 0; i < 40 && !(await evaluate('!!window.__ccReady')); i++) await sleep(50);
    assert(await evaluate('!!window.__ccReady'), `A-${tag}-0: fixture — the REAL js/control-center.js module loaded and mounted in the engine`);
    const closed0 = await evaluate(MEASURE_DRAWER);
    assert(closed0.right <= 0.5 && closed0.phase === 'closed',
      `A-${tag}-1: fixture — mounted closed, the panel is fully off-screen to the left (right edge ${closed0.right}, phase ${closed0.phase})`);
    const t = await evaluate(`(() => { const r = document.getElementById('control-center-trigger').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; })()`);
    assert(t.w >= 44, `A-${tag}-2: fixture — the trigger is a real, filled, tappable box (${t.w}px wide)`);
    await click(t.x, t.y);                                    // a REAL click, through hit-testing, like a finger
    await sleep(700);                                         // DRAWER_MOTION_MS (260) + margin, real time
    const o = await evaluate(MEASURE_DRAWER);
    assert(o.open === 'true' && o.backdropOpacity > 0.99,
      `A-${tag}-3: fixture — the tap opened the drawer state and the scrim is painted (data-open ${o.open}, scrim opacity ${o.backdropOpacity}) — the half Drew DID see`);
    assert(o.left >= -0.5 && o.right <= o.vw + 0.5 && o.width >= 280,
      `A-${tag}-4: THE BUG — the panel is ON SCREEN (rect ${o.left}…${o.right} of ${o.vw}px, width ${o.width}; phase ${o.phase}, --cc-drag-progress "${o.progress}") — v0.27.0 left it at ${closed0.left}…${closed0.right}, behind the scrim`);
    assert(o.visibility === 'visible' && o.display !== 'none' && Number(o.opacity) === 1 && !o.inert,
      `A-${tag}-5: …visible, displayed, opaque, not inert (visibility ${o.visibility}, display ${o.display}, opacity ${o.opacity}, inert ${o.inert})`);
    assert(o.z > o.backdropZ && o.z > o.navZ && o.z > o.headerZ,
      `A-${tag}-6: …stacked ABOVE the scrim, the pill nav and the header (z ${o.z} vs scrim ${o.backdropZ}, nav ${o.navZ}, header ${o.headerZ})`);
    assert(o.hitInDrawer && !o.hitIsBackdrop,
      `A-${tag}-7: …and a tap in the middle of the panel lands IN the panel, not on the scrim (the rows — Sign Out included — are reachable)`);
    // close via the real ✕
    const x = await evaluate(`(() => { const r = document.querySelector('#control-center .control-center-close').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await click(x.x, x.y);
    // v0.27.1 round 2 (reviewer condition 1) — MID-CLOSE: the scrim must fade
    // WITH the panel, not sit fully dark until the panel has already gone
    // (the backdrop used to follow isDrawerVisuallyOpen(), true all through
    // 'closing', so it held at 1.00 for the whole 260 ms slide).
    const mid = await evaluate(`(async () => { await new Promise(r => setTimeout(r, 110));
      const b = document.getElementById('control-center-backdrop'), d = document.getElementById('control-center');
      return { scrim: Number(getComputedStyle(b).opacity), right: d.getBoundingClientRect().right, phase: d.dataset.phase, scrimOpen: b.dataset.open }; })()`);
    assert(mid.scrimOpen === 'false' && mid.scrim < 0.95,
      `A-${tag}-8a: ~120 ms into the close the scrim is already fading with the panel (scrim opacity ${mid.scrim.toFixed(2)}, data-open ${mid.scrimOpen}; panel right edge ${mid.right.toFixed(1)}, phase ${mid.phase}) — never a dark screen with no panel on it`);
    await sleep(700);
    const c = await evaluate(MEASURE_DRAWER);
    assert(c.phase === 'closed' && c.right <= 0.5,
      `A-${tag}-8: ✕ closes it fully OFF-screen again (phase ${c.phase}, rect ${c.left}…${c.right}) — never an inert panel left on screen`);
    assert(c.backdropPE === 'none' && c.backdropOpacity < 0.01 && !c.hitIsBackdrop,
      `A-${tag}-9: …and the scrim is gone and takes no input (pointer-events ${c.backdropPE}, opacity ${c.backdropOpacity})`);
  }

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[B] Header — the league pill is centred in its free space; the strict truncation order still holds (375 / 390)…');
  // ═════════════════════════════════════════════════════════════════════════
  const BUILD_AND_MEASURE = (c) => `(async () => {
    const c = ${JSON.stringify(c)};
    const host = document.getElementById('host');
    host.innerHTML = ${JSON.stringify(headerHtml)};
    const h = host.querySelector('.app-header');
    if (c.mutantNoLeadSpacer) h.querySelectorAll('.header-spacer--lead').forEach(e => e.remove());
    const q = s => h.querySelector(s), R = e => e.getBoundingClientRect();
    q('#control-center-trigger').innerHTML = '<span class="control-center-trigger-mark"><svg width="24" height="24" viewBox="0 0 24 24"></svg></span>';
    const pill = q('#league-pill'); pill.hidden = false;
    q('#header-meta-week').innerHTML = '<span class="week-heading week-heading-inline"><span class="week-heading-name"><strong>' + c.week + '</strong><span class="badge badge-locked ml-sm">LOCKED</span></span></span>';
    q('#sync-badge').innerHTML = '<span class="header-sync-glyph"><svg width="24" height="24" viewBox="0 0 24 24"></svg></span>';
    // The real type: Oswald/Inter come from styles.css's own @import. Measure
    // AFTER they settle (an offline run falls back to system faces — the
    // relations asserted below hold either way; the label reports which).
    // Explicit, not document.fonts.ready (which can resolve before a load
    // triggered by this innerHTML swap has even started).
    let oswald = false;
    try { oswald = (await document.fonts.load('700 1em Oswald')).length > 0; } catch { oswald = false; }
    try { await document.fonts.load('400 1em Inter'); } catch {}
    await document.fonts.ready;
    // DI-417 (UN-372) — sport graceful degradation, mirroring
    // _fitLeaguePill()'s real steps (js/app.js): full sport name -> short
    // code -> dropped entirely, measured with the REAL .league-pill-sport
    // CSS after fonts have settled (measuring against the fallback face
    // would test the wrong metrics).
    const setPillContent = (s) => { pill.innerHTML = c.league + (s ? ' <span class="league-pill-sport">· ' + s + '</span>' : ''); };
    if (c.sport) {
      setPillContent(c.sport);
      if (pill.getClientRects().length && pill.scrollWidth > pill.clientWidth + 0.5) {
        setPillContent(c.sportCode);
        if (pill.scrollWidth > pill.clientWidth + 0.5) setPillContent(null);
      }
    } else {
      setPillContent(null);
    }
    // _fitLeaguePill() (js/app.js): hidden when laid out narrower than 48px.
    if (pill.getClientRects().length && R(pill).width < 48) pill.hidden = true;
    const inner = q('.app-header-inner'), meta = q('.header-meta'), name = q('.week-heading-name strong'),
          badge = q('.header-meta .badge'), sync = q('#sync-badge'), trigMark = q('.control-center-trigger-mark'); // DI-405: measure from the mark, the trigger's only content
    const pr = R(pill), ir = R(inner), cs = getComputedStyle(inner);
    const contentRight = ir.right - parseFloat(cs.paddingRight);
    const sportShown = !c.sport ? null : (pill.textContent.indexOf(c.sport) >= 0 ? 'full' : ((c.sportCode && pill.textContent.indexOf(c.sportCode) >= 0) ? 'code' : 'none'));
    return { vw: innerWidth, pillHidden: pill.hidden, pillLeft: pr.left, pillRight: pr.right, pillW: pr.width,
      pillTruncated: !pill.hidden && pill.scrollWidth > pill.clientWidth + 0.5, sportShown,
      trigContentRight: R(trigMark).right, metaLeft: R(meta).left, metaRight: R(meta).right,
      nameTruncated: name.scrollWidth > name.clientWidth + 0.5, nameW: R(name).width,
      badgeLeft: R(badge).left, badgeRight: R(badge).right, badgeW: R(badge).width, nameRowRight: R(q('.week-heading-name')).right,
      syncLeft: R(sync).left, syncRight: R(sync).right, syncTop: R(sync).top, headerTop: R(h).top, headerBottom: R(h).bottom,
      contentRight, rowHeight: ir.height, oswald };
  })()`;
  const CASES = [
    ['Week 4', 'IRB Pool', 'short'],
    ['Week 12', 'IRB Pool', 'short'],
    ['Week 4', 'IRB Pick’Ems', 'mid'],
    ['Week 12', 'IRB Pick’Ems', 'mid'],
    ['Week 4', 'Hendricks Family Football League', 'long-league'],
    ['Conference Championship Week', 'IRB Pick’Ems', 'long-week'],
    ['College Football Playoff Quarterfinals', 'IRB Pick’Ems', 'long-week'],
  ];
  const CENTER_TOL = 1;
  let centredCases = 0, mutantCases = 0, fontCheck = null;
  const sportSteps = []; // DI-417 — {vw, oswald, shown} per width, for the monotonicity check below the loop
  // 375/390 are the widths the brief names; 393/430 the current iPhone Pro /
  // Pro Max; 600/844 a small tablet and phone landscape — widths where the
  // row has free space in ANY face, so the centring floors never depend on
  // which font happened to load.
  for (const vw of [375, 390, 393, 430, 600, 844]) {
    await open(headerFile, vw, 844);
    for (const [week, league, kind] of CASES) {
      const m = await evaluate(BUILD_AND_MEASURE({ week, league }));
      fontCheck = fontCheck === null ? m.oswald : (fontCheck && m.oswald);
      const id = `${vw}px "${week}" / "${league}"${m.oswald ? ' [Oswald]' : ' [fallback font]'}`;
      assert(m.vw === vw, `B ${id}: fixture — laid out at ${vw}px (got ${m.vw})`);
      assert(m.badgeW > 0 && m.badgeRight <= m.nameRowRight + 0.5 && m.badgeRight <= m.vw,
        `B ${id}: the LOCKED badge is fully visible (badge ${m.badgeLeft.toFixed(1)}…${m.badgeRight.toFixed(1)}, name row ends ${m.nameRowRight.toFixed(1)})`);
      assert(m.syncRight <= m.contentRight + 0.5 && m.syncTop >= m.headerTop && m.syncTop < m.headerBottom,
        `B ${id}: the sync icon stays on the row at the trailing edge (right ${m.syncRight.toFixed(1)} ≤ ${m.contentRight.toFixed(1)})`);
      assert(!m.nameTruncated || m.pillHidden,
        `B ${id}: STRICT order — the week name only ellipsizes once the pill is hidden (name truncated ${m.nameTruncated}, pill hidden ${m.pillHidden})`);
      if (m.pillHidden) {
        assert(Math.abs(m.syncLeft - 8 - m.metaRight) <= 1,
          `B ${id}: pill hidden — the week zone still sits flush against the sync icon (meta right ${m.metaRight.toFixed(1)}, sync left ${m.syncLeft.toFixed(1)}, gap 8)`);
      } else {
        const leftGap = m.pillLeft - m.trigContentRight, rightGap = m.metaLeft - m.pillRight;
        if (!m.pillTruncated) {
          centredCases++;
          assert(Math.abs(leftGap - rightGap) <= CENTER_TOL,
            `B ${id}: POLISH — the pill is visually CENTRED between the trigger's text and the week zone (left gap ${leftGap.toFixed(1)}, right gap ${rightGap.toFixed(1)}, tolerance ${CENTER_TOL}px)`);
        } else {
          assert(leftGap >= 7.5 && rightGap >= 7.5 && rightGap <= leftGap + 1,
            `B ${id}: a shrinking pill keeps at least one gap of air on each side (left ${leftGap.toFixed(1)}, right ${rightGap.toFixed(1)})`);
        }
      }
      if (kind === 'short' && vw >= 430) assert(!m.pillHidden && !m.nameTruncated, `B ${id}: fixture — a short week + league shows everything, untruncated`);
      if (kind === 'long-week' && vw === 375) assert(m.pillHidden, `B ${id}: fixture — a long round name at 375px hides the pill first`);
    }
    // Anti-vacuity: the same short case WITHOUT the leading spacer (the
    // v0.27.0 shape) must be OFF-centre wherever the pill has free space to
    // sit in at all — at 375px it is already shrinking (no free space, so
    // "centred" is moot there and the mutant is not asked to differ).
    const real = await evaluate(BUILD_AND_MEASURE({ week: 'Week 4', league: 'IRB Pool' }));
    // DI-417 (UN-372) — the header pill's sport degradation, measured for
    // real against the league's ACTUAL live name ("IRB Pick’Ems", the exact
    // string CASES already uses above), not the short "IRB Pool" stand-in —
    // reviewer round 2, finding 3: the first draft of this block used "IRB
    // Pool" here too, which made "full sport shows at >=430px" true for a
    // label Drew will never actually see. With the real name and its own
    // 35vw cap, the measured behavior is DIFFERENT — re-derived below, not
    // assumed. Font-metric-dependent (Oswald is condensed; the fallback face
    // is not), so the STRICT per-width thresholds are asserted only when
    // Oswald actually loaded — verified against real Oswald with
    // SHELLTEST_WEBFONTS=1 during this fix's own build: with "IRB Pick’Ems",
    // the short code shows at EVERY tested width (375/390/393/430) and the
    // full name only at 600/844 — i.e. Drew will see "IRB Pick’Ems · CFB" in
    // portrait on a real phone, not the full sport name. Offline (the
    // deterministic default every loadtest run uses) falls back to a WIDER
    // face than Oswald, and "IRB Pick’Ems" (unlike the short "IRB Pool"
    // stand-in) is long enough that even the SHORT CODE genuinely doesn't
    // fit at 375/390/393px under that wider face — 'none' (sport dropped
    // entirely) is the CORRECT, not a failing, outcome there. The RELATION
    // asserted unconditionally instead: never hidden, never REGRESSES to a
    // worse step as the row gets wider (checked post-loop), and the pill
    // still degrades to a VALID step, never a fourth, unexpected shape.
    const REAL_LEAGUE_NAME = 'IRB Pick’Ems';
    const sportCase = { week: 'Week 4', league: REAL_LEAGUE_NAME, sport: 'College Football', sportCode: 'CFB' };
    const noSportBaseline = await evaluate(BUILD_AND_MEASURE({ week: 'Week 4', league: REAL_LEAGUE_NAME }));
    const sm = await evaluate(BUILD_AND_MEASURE(sportCase));
    const sid = `${vw}px sport-pill "${REAL_LEAGUE_NAME} · College Football"${sm.oswald ? ' [Oswald]' : ' [fallback font]'}`;
    assert(!sm.pillHidden, `B ${sid}: plenty of room for "${REAL_LEAGUE_NAME}" alone at every tested width — the sport-bearing pill is never hidden (got hidden=${sm.pillHidden})`);
    assert(sm.sportShown === 'full' || sm.sportShown === 'code' || sm.sportShown === 'none',
      `B ${sid}: the degradation lands on a VALID step (full/code/none), never an unexpected fourth shape — showing "${sm.sportShown}"`);
    assert(sm.badgeLeft === noSportBaseline.badgeLeft && sm.badgeRight === noSportBaseline.badgeRight && sm.syncLeft === noSportBaseline.syncLeft && sm.syncRight === noSportBaseline.syncRight,
      `B ${sid}: adding the sport to the pill NEVER moves the badge or the sync icon, same league name with vs. without it (badge ${noSportBaseline.badgeLeft.toFixed(1)}…${noSportBaseline.badgeRight.toFixed(1)} vs ${sm.badgeLeft.toFixed(1)}…${sm.badgeRight.toFixed(1)}; sync ${noSportBaseline.syncLeft.toFixed(1)}…${noSportBaseline.syncRight.toFixed(1)} vs ${sm.syncLeft.toFixed(1)}…${sm.syncRight.toFixed(1)})`);
    sportSteps.push({ vw, oswald: sm.oswald, shown: sm.sportShown });
    if (sm.oswald) {
      // Re-derived against the REAL league name (reviewer round 2, finding
      // 3): the short code shows across the WHOLE tested narrow range
      // (375/390/393/430), and only 600/844 have room for the full name —
      // this is what Drew will actually see, not the "IRB Pool" fiction.
      if (vw === 600 || vw === 844) assert(sm.sportShown === 'full', `B ${sid}: DI-417 — with Oswald actually loaded and the REAL league name, the FULL sport name shows at ${vw}px (got "${sm.sportShown}")`);
      if (vw === 375 || vw === 390 || vw === 393 || vw === 430) assert(sm.sportShown === 'code', `B ${sid}: DI-417 — with Oswald actually loaded and the REAL league name, the SHORT CODE shows at ${vw}px — the pill reads "${REAL_LEAGUE_NAME} · CFB" here, not the full sport name (got "${sm.sportShown}")`);
    }
    if (!real.pillHidden && !real.pillTruncated) {
      const mut = await evaluate(BUILD_AND_MEASURE({ week: 'Week 4', league: 'IRB Pool', mutantNoLeadSpacer: true }));
      const mutDiff = Math.abs((mut.pillLeft - mut.trigContentRight) - (mut.metaLeft - mut.pillRight));
      mutantCases++;
      assert(!mut.pillHidden && mutDiff > CENTER_TOL,
        `B ${vw}px MUTANT (no .header-spacer--lead, the v0.27.0 shape): the pill hugs the trigger — off-centre by ${mutDiff.toFixed(1)}px (> ${CENTER_TOL}), so the centring assertion above is not vacuous`);
    }
  }
  assert(mutantCases >= 3, `B: fixture — the mutant ran at ${mutantCases} widths with free space (≥ 3)`);
  if (WEBFONTS) assert(fontCheck === true, `SHELLTEST_WEBFONTS=1: Oswald 700 actually LOADED (document.fonts.load) — a web-font run that silently fell back would measure the wrong type`);
  assert(centredCases >= 6, `B: fixture — the centring assertion actually ran on ${centredCases} visible, untruncated-pill cases (≥ 6)`);

  // DI-417 (UN-372) — monotonicity: as the row gets WIDER, the sport
  // degradation step never gets worse (full -> code -> none is the only
  // legal direction as room SHRINKS; going the other way as room GROWS is
  // the only legal direction here, since sportSteps is walked in ascending
  // vw order). Font-independent, unlike the strict per-width thresholds
  // above — holds under fallback AND real Oswald alike.
  const RANK = { full: 2, code: 1, none: 0 };
  for (let i = 1; i < sportSteps.length; i++) {
    const prev = sportSteps[i - 1], cur = sportSteps[i];
    assert(RANK[cur.shown] >= RANK[prev.shown],
      `B sport monotonicity: ${prev.vw}px (${prev.shown}) -> ${cur.vw}px (${cur.shown}) never REGRESSES to a worse degradation step as the row widens`);
  }
  assert(sportSteps.some(s => s.shown === 'full') && sportSteps.some(s => s.shown === 'code'),
    `B: fixture — the sport-pill measurements actually exercised BOTH the full and the code step across the tested widths (got: ${sportSteps.map(s => `${s.vw}:${s.shown}`).join(', ')}) — not vacuous`);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[C] DI-399(b-ii) reviewer round 2, finding 3 — Chat\'s pull-refresh indicator never changes the thread\'s own height (390×844)…');
  // ═════════════════════════════════════════════════════════════════════════
  await open(chatFile, 390, 844);
  const MEASURE_CHAT = `(() => {
    const scroll = document.getElementById('chat-scroll'), wrap = document.querySelector('.chat-pull-refresh-wrap'),
          ind = document.getElementById('chat-pull-refresh'), composer = document.querySelector('.chat-composer');
    const sr = scroll.getBoundingClientRect(), wr = wrap.getBoundingClientRect(), ir = ind.getBoundingClientRect(), cr = composer.getBoundingClientRect();
    return { scrollHeight: +sr.height.toFixed(1), scrollBottom: +sr.bottom.toFixed(1), wrapHeight: +wr.height.toFixed(1),
      indicatorVisible: getComputedStyle(ind).opacity !== '0', indicatorBottom: +ir.bottom.toFixed(1), indicatorTop: +ir.top.toFixed(1),
      composerTop: +cr.top.toFixed(1) };
  })()`;
  const idle = await evaluate(MEASURE_CHAT);
  assert(idle.wrapHeight === 0, `C-1: the wrapper itself is genuinely zero-height at idle (got ${idle.wrapHeight})`);
  assert(!idle.indicatorVisible, `C-2: fixture — the indicator is not visible at idle (opacity 0)`);

  await evaluate(`(() => { const el = document.getElementById('chat-pull-refresh'); el.dataset.phase = 'armed'; el.textContent = 'Release to sync'; })()`);
  await sleep(200); // past the 150ms opacity transition (css/styles.css) — a computed-style read mid-transition would report an interpolated value, not the settled one
  const armed = await evaluate(MEASURE_CHAT);
  assert(armed.indicatorVisible, 'C-3: fixture — the indicator IS visible once armed (opacity 1), so this is a real before/after, not two idle reads');
  assert(armed.wrapHeight === 0, `C-4: the wrapper stays zero-height even with a labelled, visible indicator inside it (got ${armed.wrapHeight})`);
  assert(armed.scrollHeight === idle.scrollHeight,
    `C-5: #chat-scroll's own measured height is IDENTICAL idle -> armed (idle ${idle.scrollHeight}, armed ${armed.scrollHeight}) — the indicator no longer competes with the thread for flex space (was: 708 -> 691, reviewer round 2 finding 3)`);
  assert(armed.indicatorBottom <= armed.composerTop + 0.5,
    `C-6: the (now-visible) indicator sits ABOVE the composer's own top edge, never over it (indicator bottom ${armed.indicatorBottom}, composer top ${armed.composerTop})`);
  // DI-399(b-ii) polish (Drew, 2026-09-28): "the bottom is right on the line
  // and should be brought vertically just a hair". The line is the thread
  // card's own bottom edge (#chat-scroll is a card; the composer card starts
  // 10px below it) — at bottom:0 the pill's bottom sat exactly on it (gap 0).
  // Now it clears that edge by one 8px grid step.
  assert(armed.scrollBottom - armed.indicatorBottom >= 8 - 0.5,
    `C-6b: the pill's bottom clears the thread card's bottom edge by at least 8px, not sitting on the line (indicator bottom ${armed.indicatorBottom}, thread bottom ${armed.scrollBottom}, gap ${(armed.scrollBottom - armed.indicatorBottom).toFixed(1)})`);
  assert(armed.indicatorTop < armed.scrollBottom,
    `C-7: …and below the last message — i.e. inside/overlapping the bottom of the thread area, never floating above it as a second "new content" signal (indicator top ${armed.indicatorTop}, thread bottom ${armed.scrollBottom})`);

  // Anti-vacuity: the OLD position:sticky recipe really did move the thread
  // — reproduced structurally against the CSS text this fixture's REAL
  // stylesheet no longer contains, so this isn't asserting a straw man.
  const cssText = readFileSync(join(here, 'css', 'styles.css'), 'utf8');
  assert(!/\.chat-pull-refresh\{position:sticky/.test(cssText),
    'C-8 mutation-proof companion: the OLD position:sticky rule for .chat-pull-refresh is genuinely gone from the shipped file, not left alongside the fix');

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[D] RG-294, RE-DERIVED for DI-421/D1 (RG-298, 2026-09-28) — "Sign Out" and');
  console.log('    "Your Leagues" line up with Password/Rules inside the PROFILE pane (390×844)…');
  // ═════════════════════════════════════════════════════════════════════════
  // Drew (live v0.27.1, 2026-09-28): "'sign out' and 'switch league' are
  // indented compared to the rest of the list" — RG-294's original fix (a
  // negative-margin correction on `.control-center-identity-actions`, the
  // wrapper those two rows sat in directly under the identity header).
  //
  // REVIEWER ROUND 2 (RG-298, 2026-09-28) — DI-421 subsequently moved BOTH
  // rows out of the identity header entirely, into the pushed PROFILE pane,
  // and D1 reordered/re-chevroned them there (Your Leagues -> Password ->
  // Sign Out -> Delete Account). `.control-center-identity-actions` is now
  // DELETED (nothing renders it) — RG-294's fix is superseded, not broken;
  // the alignment question is now "do Sign Out / Your Leagues line up with
  // every OTHER Profile row (Password)", since they all share the exact
  // same `.control-center-row control-center-row--action` markup there, with
  // no special wrapper at all. Re-measured against that reality: push into
  // Profile first, then compare.
  {
    await open(drawerFile, 390, 844, true);
    for (let i = 0; i < 40 && !(await evaluate('!!window.__ccReady')); i++) await sleep(50);
    const t = await evaluate(`(() => { const r = document.getElementById('control-center-trigger').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await click(t.x, t.y);
    await sleep(400);
    // Push into Profile — the SAME identity-tap button `renderIdentityHeader()`
    // wires to `data-action="cc-push-profile"`.
    const p = await evaluate(`(() => { const r = document.querySelector('[data-action="cc-push-profile"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await click(p.x, p.y);
    await sleep(400);
    const m = await evaluate(`(() => {
      const L = sel => { const e = document.querySelector(sel); return e ? +e.getBoundingClientRect().left.toFixed(1) : null; };
      const R = sel => { const e = document.querySelector(sel); return e ? +e.getBoundingClientRect().right.toFixed(1) : null; };
      return {
        signOutLabel: L('#control-center [data-action="cc-signout"] .cc-row-label'),
        leaguesLabel: L('#control-center [data-action="cc-open-leagues-home"] .cc-row-label'),
        signOutRow: L('#control-center [data-action="cc-signout"]'), signOutRowRight: R('#control-center [data-action="cc-signout"]'),
        pwLabel: L('#control-center [data-action="cc-open-password-change"] .cc-row-label'),
        pwRow: L('#control-center [data-action="cc-open-password-change"]'), pwRowRight: R('#control-center [data-action="cc-open-password-change"]'),
        avatar: L('#control-center .cc-avatar'),
        saveBtn: L('#control-center [data-action="cc-save-profile"]'), saveBtnRight: R('#control-center [data-action="cc-save-profile"]'),
        nameInput: L('#control-center #cc-field-display-name'), nameInputRight: R('#control-center #cc-field-display-name'),
      };
    })()`);
    assert([m.signOutLabel, m.leaguesLabel, m.pwLabel].every(v => typeof v === 'number'),
      `D-0: fixture — Profile's Sign Out / Your Leagues / Password rows all rendered and measured (${JSON.stringify(m)})`);
    assert(Math.abs(m.signOutLabel - m.pwLabel) <= 0.5 && Math.abs(m.leaguesLabel - m.pwLabel) <= 0.5,
      `D-1: Sign Out / Your Leagues labels start at the SAME x as the Password row's label — no residual indent from the retired identity-actions wrapper (sign out ${m.signOutLabel}, leagues ${m.leaguesLabel}, password ${m.pwLabel})`);
    assert(Math.abs(m.signOutRow - m.pwRow) <= 0.5 && Math.abs(m.signOutRowRight - m.pwRowRight) <= 0.5,
      `D-2: …and the rows themselves span the same box as Password, so their press-state and 44pt target line up too (sign out ${m.signOutRow}…${m.signOutRowRight}, password ${m.pwRow}…${m.pwRowRight})`);
    assert(m.avatar !== null,
      `D-3: fixture sanity — the identity header's avatar still measures (${m.avatar}) even though the drawer is now showing the Profile pane on top of it`);
    // REVIEWER ROUND 3 minor (b) (2026-09-29) — D-1/D-2 compare SIBLING rows,
    // which all share one markup and would still agree with each other if the
    // whole row group were indented. Drew's complaint was "indented compared
    // to the rest of the list", so measure ACROSS containers too: the account
    // rows (inside their own row group) against the Profile form column — the
    // Save button and the Display name field — that sits above them in the
    // same pane. Same left edge and same right edge, within half a pixel.
    assert(typeof m.saveBtn === 'number' && typeof m.nameInput === 'number'
        && Math.abs(m.signOutRow - m.saveBtn) <= 0.5 && Math.abs(m.signOutRow - m.nameInput) <= 0.5
        && Math.abs(m.signOutRowRight - m.saveBtnRight) <= 0.5 && Math.abs(m.signOutRowRight - m.nameInputRight) <= 0.5,
      `D-5: CROSS-CONTAINER — the account rows' box starts and ends where the Profile form column does (row ${m.signOutRow}…${m.signOutRowRight}, Save ${m.saveBtn}…${m.saveBtnRight}, Display name ${m.nameInput}…${m.nameInputRight})`);
    // Anti-vacuity: the retired wrapper class genuinely carries no rule
    // anymore, so this isn't "the rows happened to line up anyway."
    const cssTextD = readFileSync(join(here, 'css', 'styles.css'), 'utf8');
    assert(!/\.control-center-identity-actions\{/.test(cssTextD),
      'D-4 mutation-proof companion: .control-center-identity-actions carries NO rule at all in the shipped stylesheet (RG-298 minor finding) — the old alignment fix is genuinely gone, not merely unused');
  }

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[E] RG-TBD-B2 (bug batch B, N7, Drew 2026-09-29: "there is an awkward gap between');
  console.log('    appearance and SCRIBe settings in the control panel") — the drawer\'s row rhythm (390×844)…');
  // ═════════════════════════════════════════════════════════════════════════
  // DI-422 puts SCRIBE settings "directly below the 'My Preferences' group,
  // ungrouped" — its own UN-labelled .control-center-group (controlcentertest
  // 15d-3 pins that markup). Every .control-center-group carries the 24px
  // section gap, which is sized for a group that OPENS WITH A LABEL: gap +
  // label = a section break. With no label, the same 24px is an empty hole
  // between Appearance and SCRIBE settings in a list whose rows otherwise sit
  // flush. Measured on the REAL drawer + REAL stylesheet.
  {
    await open(drawerFile, 390, 844, true);
    for (let i = 0; i < 40 && !(await evaluate('!!window.__ccReady')); i++) await sleep(50);
    const t = await evaluate(`(() => { const r = document.getElementById('control-center-trigger').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await click(t.x, t.y);
    await sleep(400);
    const g = await evaluate(`(() => {
      const box = sel => { const e = document.querySelector('#control-center ' + sel); if (!e) return null; const r = e.getBoundingClientRect(); return { t: +r.top.toFixed(1), b: +r.bottom.toFixed(1) }; };
      const labels = [...document.querySelectorAll('#control-center .control-center-group-label')];
      const helpLabel = labels.find(l => /Help/.test(l.textContent));
      const hl = helpLabel ? helpLabel.getBoundingClientRect() : null;
      return { theme: box('[data-row="theme"]'), appearance: box('[data-row="appearance"]'), scribe: box('[data-row="scribe"]'),
        help: hl ? { t: +hl.top.toFixed(1), b: +hl.bottom.toFixed(1) } : null };
    })()`);
    assert(g.theme && g.appearance && g.scribe && g.help,
      `E-0: fixture — Theme, Appearance, SCRIBE settings and the "Help & Feedback" label all measure (${JSON.stringify(g)})`);
    const inGroup = +(g.appearance.t - g.theme.b).toFixed(1);
    const bugGap = +(g.scribe.t - g.appearance.b).toFixed(1);
    const sectionGap = +(g.help.t - g.scribe.b).toFixed(1);
    assert(inGroup === 0, `E-1: fixture — inside "My Preferences" rows sit flush (Theme → Appearance ${inGroup}px)`);
    assert(bugGap === inGroup,
      `E-2: THE BUG — SCRIBE settings follows Appearance on the list's own row rhythm (${bugGap}px, rows ${inGroup}px); an un-labelled group opens no empty section gap`);
    assert(sectionGap === 24,
      `E-3: control — a LABELLED group still opens with the 24px section gap on the 8-pt grid (SCRIBE settings → "Help & Feedback" ${sectionGap}px)`);
  }

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[F] RG-TBD-B3 reviewer follow-up — the Profile alma-mater caption never moves the Save button (375 / 390)…');
  // ═════════════════════════════════════════════════════════════════════════
  // The caption goes empty → "Loading…" → result while the player is looking
  // at the pane. Its line box is reserved (.alma-catalog-note) and every
  // caption string (js/control-center.js almaCatalogNoteText()) is one line,
  // so the Save button below it must sit at the SAME y in every state.
  for (const w of [375, 390]) {
    await open(drawerFile, w, 844, true);
    for (let i = 0; i < 40 && !(await evaluate('!!window.__ccReady')); i++) await sleep(50);
    const t = await evaluate(`(() => { const r = document.getElementById('control-center-trigger').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await click(t.x, t.y);
    await sleep(400);
    const p = await evaluate(`(() => { const r = document.querySelector('[data-action="cc-push-profile"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await click(p.x, p.y);
    await sleep(400);
    const states = await evaluate(`(async () => {
      const cc = await import(${JSON.stringify(jsBase + 'control-center.js')});
      const note = document.getElementById('cc-field-alma-note');
      const save = document.querySelector('#control-center [data-action="cc-save-profile"]');
      const out = [];
      const texts = [['empty', ''], ['loading', cc.almaCatalogNoteText('loading')], ['loaded', cc.almaCatalogNoteText('loaded', { count: 762 })],
        ['failed', cc.almaCatalogNoteText('failed')], ['partial', cc.almaCatalogNoteText('partial', { got: 700, count: 762 })]];
      for (const [k, v] of texts) {
        note.textContent = v;
        await new Promise(r => requestAnimationFrame(() => r()));
        out.push({ k, saveTop: +save.getBoundingClientRect().top.toFixed(1), noteH: +note.getBoundingClientRect().height.toFixed(1), hidden: note.hidden });
      }
      return out;
    })()`);
    assert(Array.isArray(states) && states.length === 5 && states.every(s => !s.hidden),
      `F-${w}-0: fixture — the real Profile pane renders the caption slot, visible in all five states (${JSON.stringify(states?.map(s => s.k + ':' + s.hidden))})`);
    const top0 = states?.[0]?.saveTop;
    assert(states.every(s => s.saveTop === top0),
      `F-${w}-1: THE FOLLOW-UP — Save does not move as the caption goes empty → loading → loaded / failed / partial (tops ${states.map(s => s.k + ' ' + s.saveTop).join(', ')})`);
    assert(states.every(s => s.noteH === states[0].noteH),
      `F-${w}-2: …because the caption's line box is reserved and every caption is ONE line at ${w}px (heights ${states.map(s => s.k + ' ' + s.noteH).join(', ')})`);
  }
} catch (e) {
  assert(false, `the engine sections ran to completion (threw: ${e && e.message})`);
} finally {
  if (engine) { try { engine.proc.kill(); } catch { /* already gone */ } }
}

process.stdout.write(`\n${'─'.repeat(70)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n${'─'.repeat(70)}\n`,
  () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 20000).unref();
