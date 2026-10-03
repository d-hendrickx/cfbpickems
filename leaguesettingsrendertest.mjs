/**
 * CFB Pickems — leaguesettingsrendertest.mjs
 * ===========================================
 * SP-53 — League Settings, MEASURED in a REAL browser engine (headless Chromium over the DevTools protocol, the same mechanism shellrendertest.mjs and navtest.mjs use). leaguesettingsuitest.mjs proves
 * the markup and the wiring on a node-side element tree; it cannot see a single pixel. This suite loads the REAL css/styles.css and the REAL js/league-settings-view.js / js/icons.js modules into
 * Chromium and measures what the Design and Polish passes name in numbers:
 *
 *   [A] LAYOUT at 375 / 390 / 430 / 768 px — no horizontal overflow (an 80-character hostile name included), every row at least 48 pt, 24 pt between groups, 8 pt inside a group and between a card
 *       and its footer, 16 pt of page padding on every card, nothing overlapping, every tap target at least 44 pt, the Leave group last.
 *   [B] NO LAYOUT JUMP — the name card's height and the Save button's height are IDENTICAL in every state of DI-458's table (pristine, edited, empty, saving, saved, paused), patched in place exactly
 *       as app.js patches them; a banner arriving in its slot is the only thing allowed to move content, and it moves it DOWN, never the card.
 *   [C] THE ACTION SHEET IS NEVER CARRIED AWAY (F7) — in a SCROLLED League Page overlay the confirmation layer is `position:fixed` on <body> and its sheet sits inside the viewport; a CONTROL mounts the same
 *       sheet inside the scrolling overlay and the measurement must show it carried off (so the check can fail).
 *   [D] Z-ORDER — a real hit-test: the confirmation layer is above the hand-off sheet, which is above the League Page overlay.
 *   [E] THE HAND-OFF SHEET — fits a 375x667 phone (an SE) and scrolls inside itself; a centred 480 px modal at 768 px; the close control is at least 44 pt.
 *   [F] PRESS FEEDBACK AND MOTION TOKENS — a real mouse-down on a row compresses it to 97% over --motion-fast; a dimmed or disabled row does not; durations read the shared tokens; Reduce Motion
 *       turns the push into the 150 ms crossfade and the press transition off.
 *   [G] THE DRAWER ROW measures 48 pt.
 *   [H] MEASUREMENT CANARIES — a mutated gap and a mutated row height are REPORTED by the same measurement code, so a green [A] is not a scanner that finds nothing.
 *
 * Run:  node leaguesettingsrendertest.mjs        Override the browser: LSTEST_ENGINE=/path/to/Chromium (falls back to SHELLTEST_ENGINE, NAVTEST_ENGINE, then the usual /Applications paths).
 *
 * WHAT THIS DOES NOT PROVE, said plainly: it is Chromium, not WKWebView on a handset. Real touch, the iOS keyboard and its safe areas, VoiceOver, haptics, scroll physics and Dynamic Type are
 * device checks (the handoff names them). A missing browser is a FAILURE here, never a skip.
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
const override = process.env.LSTEST_ENGINE || process.env.SHELLTEST_ENGINE || process.env.NAVTEST_ENGINE;
const bin = override || ENGINES.find((p) => existsSync(p));
console.log('\n[0] Engine…');
assert(!!bin && existsSync(bin), !bin
  ? `NO CHROMIUM-FAMILY BROWSER FOUND. Fix: LSTEST_ENGINE=/path/to/Chromium node leaguesettingsrendertest.mjs. A missing browser is a FAILURE, never a skip. Looked for: ${ENGINES.join(', ')}`
  : `engine to measure in: ${bin}${override ? ' (from env)' : ''}`);
assert(typeof WebSocket === 'function', 'this Node has a global WebSocket (v22+) to speak the DevTools protocol over');

const tmp = mkdtempSync(join(tmpdir(), 'cfbp-lsrender-'));
const cssHref = 'file://' + here + 'css/styles.css';
const jsBase = 'file://' + here + 'js/';

const HOSTILE80 = '<img src=x onerror=alert(1)>' + ' Wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww'.slice(0, 52);   // 80 characters, no break opportunity after the first word

// One page: the real stylesheet, the real overlay id (so its real CSS applies), the real modules.
const pageFile = join(tmp, 'ls.html');
writeFileSync(pageFile, `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="stylesheet" href="${cssHref}"></head>
<body data-tab="dashboard">
<div id="league-page-overlay" data-hold-teardown></div>
<script type="module">
import * as V from '${jsBase}league-settings-view.js';
import * as CC from '${jsBase}control-center.js';
import * as LH from '${jsBase}leagues-home.js';
import { icon } from '${jsBase}icons.js';
const escHtml = (s) => (!s ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
window.V = V; window.CC = CC; window.LH = LH; window.icon = icon; window.escHtml = escHtml; window.__ready = true;
</script></body></html>`);

// ── the CDP client (same shape as shellrendertest.mjs) ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
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

// ── the measurement code, ONE string used by every case (so the canaries exercise the SAME code) ────────────────────────────────────────────────────────────────────────────────────────
const MEASURE = `
window.__measure = () => {
  const R = (e) => e.getBoundingClientRect();
  const ov = document.getElementById('league-page-overlay');
  const body = ov.querySelector('.ls-body');
  const vw = innerWidth;
  const out = { vw, overflowX: Math.max(document.documentElement.scrollWidth, ov.scrollWidth) - Math.max(vw, ov.clientWidth), problems: [] };
  const kids = [...body.children].filter((c) => getComputedStyle(c).display !== 'none' && R(c).height > 0);
  out.groupGaps = []; out.groupOverlap = false;
  for (let i = 1; i < kids.length; i++) { const g = R(kids[i]).top - R(kids[i - 1]).bottom; out.groupGaps.push(+g.toFixed(1)); if (g < -0.5) out.groupOverlap = true; }
  out.rows = [...ov.querySelectorAll('.ls-row')].map((r) => ({ h: +R(r).height.toFixed(1), cls: r.className, w: +R(r).width.toFixed(1) }));
  out.buttons = [...ov.querySelectorAll('button')].filter((b) => R(b).height > 0).map((b) => ({ cls: b.className.slice(0, 40), h: +R(b).height.toFixed(1), w: +R(b).width.toFixed(1), act: b.getAttribute('data-ls-action') || '' }));
  out.cards = [...ov.querySelectorAll('.card')].map((c) => ({ left: +R(c).left.toFixed(1), right: +(vw - R(c).right).toFixed(1), top: +R(c).top.toFixed(1), bottom: +R(c).bottom.toFixed(1) }));
  out.titleGaps = []; out.footGaps = [];
  for (const g of body.querySelectorAll('.ls-group')) {
    const t = g.querySelector(':scope > .admin-section-title'), cards = [...g.querySelectorAll(':scope > .card')], firstBlock = g.querySelector(':scope > .card, :scope > .ls-stack');
    if (t && firstBlock) out.titleGaps.push(+(R(firstBlock).top - R(t).bottom).toFixed(1));
    const lastCard = cards[cards.length - 1];
    for (const f of g.querySelectorAll(':scope > .ls-footer, :scope > .lc-helper.ls-footer, :scope > #ls-leave-foot > .ls-footer')) { if (lastCard && R(f).top >= R(lastCard).bottom - 0.5) { out.footGaps.push(+(R(f).top - R(lastCard).bottom).toFixed(1)); break; } }
  }
  out.footInset = [...ov.querySelectorAll('.ls-footer')].filter((f) => R(f).height > 0).map((f) => +(parseFloat(getComputedStyle(f).paddingLeft)).toFixed(1));
  // merge review notes a-c: the League group is a stack of two blocks; a player's reason sits under the name card inside the first block; the Leave footers are one container with a gap.
  out.stackGaps = []; out.nameBlockGaps = []; out.stackTitleGap = null; out.factsMarginTop = null;
  const stack = body.querySelector('.ls-stack');
  if (stack) {
    const sk = [...stack.children].filter((c) => R(c).height > 0);
    for (let i = 1; i < sk.length; i++) out.stackGaps.push(+(R(sk[i]).top - R(sk[i - 1]).bottom).toFixed(1));
    const nb = stack.querySelector('.ls-name-block'), nk = nb ? [...nb.children].filter((c) => R(c).height > 0) : [];
    for (let i = 1; i < nk.length; i++) out.nameBlockGaps.push(+(R(nk[i]).top - R(nk[i - 1]).bottom).toFixed(1));
    const st = stack.parentElement.querySelector(':scope > .admin-section-title');
    if (st) out.stackTitleGap = +(R(stack).top - R(st).bottom).toFixed(1);
    const facts = stack.querySelector('.ls-facts'); if (facts) out.factsMarginTop = parseFloat(getComputedStyle(facts).marginTop);
  }
  out.leaveFootGaps = []; out.leaveCardToFoot = null;
  const lfoot = ov.querySelector('#ls-leave-foot'), lcard = ov.querySelector('#ls-leave-card');
  if (lfoot) {
    const lk = [...lfoot.children].filter((c) => R(c).height > 0);
    for (let i = 1; i < lk.length; i++) out.leaveFootGaps.push(+(R(lk[i]).top - R(lk[i - 1]).bottom).toFixed(1));
    if (lcard && lk[0]) out.leaveCardToFoot = +(R(lk[0]).top - R(lcard).bottom).toFixed(1);
  }
  const last = kids[kids.length - 1];
  out.lastIsLeave = !!last && last.getAttribute('data-ls-group') === 'leave';
  out.docH = ov.scrollHeight; out.vh = innerHeight;
  const nameCard = ov.querySelector('#ls-name-card');
  if (nameCard) {
    const items = [...nameCard.children].filter((c) => !c.hasAttribute('hidden') && R(c).height > 0);
    out.nameGaps = []; for (let i = 1; i < items.length; i++) out.nameGaps.push(+(R(items[i]).top - R(items[i - 1]).bottom).toFixed(1));
    const save = nameCard.querySelector('#ls-name-save');
    out.nameCardH = +R(nameCard).height.toFixed(2); out.saveH = +R(save).height.toFixed(2); out.saveBottomToCard = +(R(nameCard).bottom - R(save).bottom).toFixed(1);
    out.inputFont = parseFloat(getComputedStyle(nameCard.querySelector('#ls-name-input')).fontSize);
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
  const open = async (w, h, reducedMotion = false) => {
    await pg.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true });
    await pg.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reducedMotion ? 'reduce' : 'no-preference' }] });
    const loaded = pg.once('Page.loadEventFired');
    await pg.send('Page.navigate', { url: 'file://' + pageFile });
    await loaded;
    for (let i = 0; i < 60 && !(await evaluate('!!window.__ready')); i++) await sleep(50);
    await evaluate(MEASURE);
  };
  const paint = (ctx) => evaluate(`(async () => { document.getElementById('league-page-overlay').innerHTML = V.settingsPageHTML(${JSON.stringify(ctx)}, { escHtml, icon });
    try { await document.fonts.ready; } catch {} return true; })()`);
  const mouse = async (type, x, y) => pg.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[A] LAYOUT — 375 / 390 / 430 / 768, commissioner and player, a hostile 80-character name…');
  const CASES = [
    ['commissioner', { leagueName: 'Saturday Crew', isCommissioner: true, sportsLabel: 'College Football', accepting: { phase: 'on', value: true } }],
    ['commissioner, hostile 80-char name, Q-W blocked', { leagueName: HOSTILE80, isCommissioner: true, sportsLabel: 'College Football, NFL, Men’s Basketball', accepting: { phase: 'off', value: false }, blockedWeeks: 2 }],
    ['player', { leagueName: 'Saturday Crew', isCommissioner: false, sportsLabel: 'College Football' }],
    ['player, hostile 80-char name', { leagueName: HOSTILE80, isCommissioner: false, sportsLabel: 'College Football' }],
    ['commissioner, paused', { leagueName: 'Saturday Crew', isCommissioner: true, paused: true, pausedText: 'This league is paused by the platform. Picks and chat are read-only until it resumes.', sportsLabel: 'College Football', accepting: { phase: 'paused', value: true } }],
  ];
  for (const vw of [375, 390, 430, 768]) {
    await open(vw, 844);
    for (const [label, ctx] of CASES) {
      await paint(ctx);
      const m = await evaluate('__measure()');
      const id = `${vw}px ${label}`;
      assert(m.overflowX <= 0.5, `A ${id}: no horizontal overflow (${m.overflowX}px) — a long or hostile name wraps and never pushes the page sideways`);
      assert(m.rows.length > 0 && m.rows.every((r) => r.h >= 47.5), `A ${id}: every row is at least 48 pt tall (smallest ${Math.min(...m.rows.map((r) => r.h))})`);
      assert(m.groupGaps.length >= 2 && m.groupGaps.every((g) => Math.abs(g - 24) <= 0.6) && !m.groupOverlap, `A ${id}: 24 pt between groups and nothing overlaps (gaps ${JSON.stringify(m.groupGaps)})`);
      assert(m.titleGaps.length >= 2 && m.titleGaps.every((g) => Math.abs(g - 8) <= 0.6), `A ${id}: 8 pt between a section title and its card (${JSON.stringify(m.titleGaps)})`);
      assert(m.footGaps.length >= 1 && m.footGaps.every((g) => Math.abs(g - 8) <= 0.6), `A ${id}: 8 pt between a card and its footer (${JSON.stringify(m.footGaps)})`);
      assert(m.stackGaps.length === 1 && Math.abs(m.stackGaps[0] - 16) <= 0.6 && m.factsMarginTop === 0, `A ${id}: the League group's name block and facts card are exactly 16 pt apart by the container gap alone — the global .card+.card margin (12) does not stack on top (gaps ${JSON.stringify(m.stackGaps)}, facts margin-top ${m.factsMarginTop}; before the merge fix it was 8 + 12 = 20)`);
      assert(m.stackTitleGap !== null && Math.abs(m.stackTitleGap - 8) <= 0.6, `A ${id}: 8 pt between the League title and its first block (${m.stackTitleGap})`);
      assert(ctx.isCommissioner ? m.nameBlockGaps.length === 0 : (m.nameBlockGaps.length === 1 && Math.abs(m.nameBlockGaps[0] - 8) <= 0.6), `A ${id}: ${ctx.isCommissioner ? 'the name block is the name card alone (its helper lives inside the card)' : "a player's one-sentence reason sits 8 pt under the name card, INSIDE the name block"} (${JSON.stringify(m.nameBlockGaps)})`);
      assert(m.leaveFootGaps.length >= 1 && m.leaveFootGaps.every((g) => Math.abs(g - 8) <= 0.6) && m.leaveCardToFoot !== null && Math.abs(m.leaveCardToFoot - 8) <= 0.6, `A ${id}: the stacked Leave footers are 8 pt apart and 8 pt under the Leave card — a container gap, never touching (footer gaps ${JSON.stringify(m.leaveFootGaps)}, card to first footer ${m.leaveCardToFoot})`);
      assert(m.cards.every((c) => c.left >= 15.5 && c.right >= 15.5), `A ${id}: every card keeps 16 pt of page padding from the screen edge (smallest ${Math.min(...m.cards.map((c) => Math.min(c.left, c.right)))})`);
      assert(m.footInset.every((p) => p >= 15.5), `A ${id}: footers are inset 16 pt so text never touches a card edge`);
      assert(m.buttons.every((b) => b.h >= 43.5), `A ${id}: every tap target is at least 44 pt tall (smallest ${Math.min(...m.buttons.map((b) => b.h))}; ${JSON.stringify(m.buttons.filter((b) => b.h < 43.5))})`);
      assert(m.lastIsLeave, `A ${id}: the Leave group is the LAST group on the page`);
      if (ctx.isCommissioner) {
        assert(m.nameGaps.length >= 3 && m.nameGaps.every((g) => g >= 7.5) && m.saveBottomToCard >= 15.5 && m.saveH >= 49.5 && m.inputFont >= 16, `A ${id}: inside the name card at least 8 pt between label, field, counter, helper and Save; Save keeps 16 pt from the card edge and is 50 pt tall; the field text is ${m.inputFont}px (>= 16: WKWebView never zooms on focus)`);
      }
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[B] NO LAYOUT JUMP — the name card in every state of DI-458\'s table, patched in place like app.js does…');
  await open(375, 844);
  await paint(CASES[0][1]);
  const STATES = [['pristine', { draft: 'Saturday Crew' }], ['edited', { draft: 'Saturday Crew League' }], ['empty', { draft: '' }], ['spaces', { draft: '   ' }], ['saving', { draft: 'New', phase: 'saving' }], ['saved', { phase: 'saved' }], ['paused', { paused: true, draft: 'Saturday Crew' }]];
  const heights = [];
  for (const [name, o] of STATES) {
    const m = await evaluate(`(() => { const v = V.nameCardView({ stored: 'Saturday Crew', draft: 'Saturday Crew', ...${JSON.stringify(o)} });
      const btn = document.getElementById('ls-name-save'); const p = V.nameButtonParts(v, { escHtml, icon });
      btn.innerHTML = p.innerHTML; btn.setAttribute('data-ls-state', p.state); btn.className = p.className; if (p.disabled) { btn.setAttribute('aria-disabled','true'); btn.disabled = true; } else { btn.removeAttribute('aria-disabled'); btn.disabled = false; }
      document.getElementById('ls-name-count').textContent = V.nameCountText(v.count);
      const clear = document.getElementById('ls-name-clear'); if (v.count > 0 && !v.fieldDisabled) clear.removeAttribute('hidden'); else clear.setAttribute('hidden', '');
      return __measure(); })()`);
    heights.push([name, m.nameCardH, m.saveH]);
  }
  assert(heights.every(([, c, s]) => Math.abs(c - heights[0][1]) <= 0.5 && Math.abs(s - heights[0][2]) <= 0.5), `B: the name card (${heights[0][1]} pt) and the Save button (${heights[0][2]} pt) are the SAME height in all ${STATES.length} states (${JSON.stringify(heights)}) — a state change never moves the layout`);
  // a banner in its slot moves content DOWN only; it must not resize the card
  const withBanner = await evaluate(`(() => { const before = __measure(); document.getElementById('ls-banner').innerHTML = V.pageBannerHTML('err', 'Couldn\\u2019t rename the league. Nothing was changed. Check your connection and try again.', { escHtml, icon });
    const after = __measure(); document.getElementById('ls-banner').innerHTML = ''; return { before: before.nameCardH, after: after.nameCardH, docBefore: before.docH, docAfter: after.docH, gaps: after.groupGaps }; })()`);
  assert(Math.abs(withBanner.before - withBanner.after) <= 0.5 && withBanner.docAfter > withBanner.docBefore && withBanner.gaps.every((g) => Math.abs(g - 24) <= 0.6), `B: a persistent error banner pushes the content DOWN (${withBanner.docBefore} -> ${withBanner.docAfter}) and leaves the card itself and the 24 pt group rhythm untouched`);
  const emptyBanner = await evaluate(`getComputedStyle(document.getElementById('ls-banner')).display`);
  assert(emptyBanner === 'none', 'B: the empty banner slot takes NO space (display none: it does not add a phantom 24 pt gap)');

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[C] THE ACTION SHEET IS NEVER CARRIED AWAY (F7) — a scrolled overlay…');
  await open(390, 700);
  await paint({ ...CASES[0][1], leagueName: 'Saturday Crew' });
  // make the overlay genuinely tall and scroll it, then raise the REAL layer markup on <body>
  await evaluate(`(() => { const ov = document.getElementById('league-page-overlay'); const pad = document.createElement('div'); pad.style.height = '900px'; pad.id = 'pad'; ov.querySelector('.ls-body').appendChild(pad); ov.scrollTop = 500; return ov.scrollTop; })()`);
  const raise = async (where) => {
    await evaluate(`(() => { document.getElementById('ls-action-layer')?.remove(); document.querySelectorAll('.ctrl-layer').forEach((e) => e.remove());
      const layer = document.createElement('div'); layer.id = ${where === 'body' ? "'ls-action-layer'" : "'ctrl-layer'"}; layer.className = ${where === 'body' ? "''" : "'ctrl-layer'"};
      layer.innerHTML = V.leaveSheetHTML({ leagueName: 'Saturday Crew', obligationCount: 2, openWeekPicks: true }, { escHtml });
      (${where === 'body'} ? document.body : document.getElementById('league-page-overlay')).appendChild(layer); return true; })()`);
    await sleep(450);   // the sheet's own 300 ms arrival has finished: measure where it LANDS, not where it starts
    return evaluate(`(() => { const layer = document.getElementById(${where === 'body' ? "'ls-action-layer'" : "'ctrl-layer'"}); const sheet = layer.querySelector('.lc-actionsheet'), r = sheet.getBoundingClientRect(), lr = layer.getBoundingClientRect();
      return { pos: getComputedStyle(layer).position, z: Number(getComputedStyle(layer).zIndex) || 0, layerTop: lr.top, layerBottom: lr.bottom, sheetTop: r.top, sheetBottom: r.bottom, vh: innerHeight, vw: innerWidth, sheetLeft: r.left, sheetRight: r.right,
        dangerH: layer.querySelector('.lc-as-danger').getBoundingClientRect().height, boldH: layer.querySelector('.lc-as-bold').getBoundingClientRect().height }; })()`);
  };
  const onBody = await raise('body');
  assert(onBody.pos === 'fixed' && Math.abs(onBody.layerTop) <= 0.5 && Math.abs(onBody.layerBottom - onBody.vh) <= 0.5 && onBody.z === 8100, `C: the layer is position:fixed at z-index 8100 and covers the viewport exactly (${onBody.layerTop}…${onBody.layerBottom} of ${onBody.vh}) even though the page behind is scrolled 500 px`);
  assert(onBody.sheetTop >= 0 && onBody.sheetBottom <= onBody.vh + 0.5 && onBody.sheetLeft >= 7.5 && onBody.sheetRight <= onBody.vw - 7.5, `C: the confirmation sheet sits INSIDE the viewport (${onBody.sheetTop.toFixed(0)}…${onBody.sheetBottom.toFixed(0)} of ${onBody.vh}), 8 pt from each side edge`);
  assert(onBody.dangerH >= 53.5 && onBody.boldH >= 53.5, `C: the two actions are at least 54 pt tall (${onBody.dangerH}, ${onBody.boldH})`);
  const control = await raise('overlay');
  assert(!(control.sheetBottom <= control.vh + 0.5 && control.sheetTop >= 0), `C (CONTROL): the SAME sheet mounted inside the scrolling overlay is carried off-screen (${control.sheetTop.toFixed(0)}…${control.sheetBottom.toFixed(0)} of ${control.vh}) — so the check above can fail, and F7's separate fixed layer is what prevents it`);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[D] Z-ORDER — a real hit-test…');
  await open(390, 844);
  await paint(CASES[0][1]);
  const hit = await evaluate(`(() => {
    const wrap = document.createElement('div'); wrap.id = 'ls-sheet-wrap';
    wrap.innerHTML = '<div class="chat-sheet-backdrop"></div><div class="chat-sheet" id="ls-sheet"><div class="chat-sheet-header"><div class="ax-nav"><div class="ax-nav-title" id="ls-sheet-title">New Commissioner</div></div></div><div id="ls-sheet-body" class="chat-sheet-scroll">' + V.handOffBodyHTML({ phase: 'handed', leagueName: 'Saturday Crew', handedName: 'Sam' }, { escHtml, icon }) + '</div></div>';
    document.body.appendChild(wrap);
    const layer = document.createElement('div'); layer.id = 'ls-action-layer'; layer.innerHTML = V.leaveSheetHTML({ leagueName: 'Saturday Crew' }, { escHtml }); document.body.appendChild(layer);
    const rd = layer.querySelector('.lc-as-danger').getBoundingClientRect(); const pt = [rd.left + rd.width / 2, rd.top + rd.height / 2];
    const atAction = document.elementFromPoint(pt[0], pt[1]);
    const sh = document.getElementById('ls-sheet').getBoundingClientRect(); const atSheet = document.elementFromPoint(sh.left + sh.width / 2, sh.top + 30);
    layer.remove();
    const atSheet2 = document.elementFromPoint(sh.left + sh.width / 2, sh.top + 30);
    const ov = document.getElementById('league-page-overlay').getBoundingClientRect(); const atOv = document.elementFromPoint(20, 20);
    return { actionInLayer: !!(atAction && atAction.closest('#ls-action-layer')), sheetUnderLayerHit: !!(atSheet && atSheet.closest('#ls-action-layer')), sheetHit: !!(atSheet2 && atSheet2.closest('#ls-sheet-wrap')), overlayZ: Number(getComputedStyle(document.getElementById('league-page-overlay')).zIndex), wrapZ: Number(getComputedStyle(wrap).zIndex), ovHitIsBehind: !!(atOv && !atOv.closest('#ls-sheet-wrap')) }; })()`);
  assert(hit.actionInLayer, 'D: a tap on the confirmation\'s red action lands IN the action layer (z 8100), over the hand-off sheet and the page');
  assert(hit.sheetHit && hit.wrapZ === 8000 && hit.overlayZ === 150, `D: with the layer gone, the same point lands in the hand-off sheet (z ${hit.wrapZ}), which is above the League Page overlay (z ${hit.overlayZ})`);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[E] THE HAND-OFF SHEET — an SE-sized phone and a 768 px window…');
  const SHEET = (state) => `(() => {
    document.getElementById('ls-sheet-wrap')?.remove();
    const wrap = document.createElement('div'); wrap.id = 'ls-sheet-wrap';
    wrap.innerHTML = '<div class="chat-sheet-backdrop"></div><div class="chat-sheet" id="ls-sheet"><div class="chat-sheet-header">' + V.handOffNavHTML({ escHtml, icon }) + '</div><div id="ls-sheet-body" class="chat-sheet-scroll"></div></div>';
    document.body.appendChild(wrap);
    const names = ['Sam Rivera', 'Kai Ortiz', 'Dee Park', 'Jo Nakamura', 'Alex Morgan', 'Riley Quinn', 'Taylor Brooks', 'Jordan Lee', 'Casey Kim', 'Morgan Diaz'];
    const row = { leagueId: 'L1', leagueName: ${JSON.stringify(HOSTILE80)}, pilot: ${state === 'pilot'}, blocks: true, candidates: names.map((n, i) => ({ memberId: 'm' + i, displayName: n })) };
    document.getElementById('ls-sheet-body').innerHTML = V.handOffBodyHTML({ phase: 'pick', leagueName: row.leagueName, pilot: ${state === 'pilot'}, axState: V.handOffState(row), notice: ${state === 'pilot' ? "''" : "'Your league changed while you were here. Choose who should take over.'"} }, { escHtml, icon });
    return true; })()`;
  const SHEET_MEASURE = () => `(() => {
    const s = document.getElementById('ls-sheet'), r = s.getBoundingClientRect(), b = document.getElementById('ls-sheet-body'), x = document.getElementById('ls-sheet-close').getBoundingClientRect();
    const rows = [...document.querySelectorAll('.ax-pick')].map((e) => e.getBoundingClientRect().height);
    return { vw: innerWidth, vh: innerHeight, top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, scrolls: b.scrollHeight > b.clientHeight + 1, overflowY: getComputedStyle(b).overflowY, closeW: x.width, closeH: x.height, minRow: Math.min(...rows), position: getComputedStyle(s).position, docOverflowX: document.documentElement.scrollWidth - innerWidth, closeInside: x.right <= r.right + 0.5 && x.left >= r.left - 0.5 }; })()`;
  await open(375, 667);
  await evaluate(SHEET('pick')); await sleep(450); const se = await evaluate(SHEET_MEASURE());
  assert(se.top >= 0 && se.bottom <= se.vh + 0.5 && se.left >= -0.5 && se.right <= se.vw + 0.5, `E: at 375x667 the sheet is entirely ON screen (${se.top.toFixed(0)}…${se.bottom.toFixed(0)} of ${se.vh}) and fits the width`);
  assert(se.scrolls && (se.overflowY === 'auto' || se.overflowY === 'scroll'), 'E: with ten candidates and an 80-character name the body SCROLLS inside the sheet (the sheet never grows past the viewport)');
  assert(se.closeW >= 43.5 && se.closeH >= 43.5 && se.closeInside && se.minRow >= 47.5 && se.docOverflowX <= 0.5, `E: the close control is ${se.closeW}x${se.closeH} (>= 44), inside the sheet; every candidate row is at least 48 pt (${se.minRow}); no horizontal overflow`);
  await open(768, 900);
  await evaluate(SHEET('pick')); await sleep(450); const wide = await evaluate(SHEET_MEASURE());
  assert(Math.abs(wide.width - 480) <= 1 && Math.abs((wide.left + wide.right) / 2 - wide.vw / 2) <= 1 && Math.abs((wide.top + wide.bottom) / 2 - wide.vh / 2) <= 1 && wide.top > 0 && wide.bottom < wide.vh, `E: at 768 px the sheet is a CENTRED 480 px modal (width ${wide.width}, centre ${((wide.left + wide.right) / 2).toFixed(0)} of ${wide.vw / 2})`);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[F] PRESS FEEDBACK AND MOTION TOKENS — a real mouse-down…');
  await open(390, 844);
  await paint({ ...CASES[0][1], blockedWeeks: 0 });
  const rect = (sel) => evaluate(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; })()`);
  const scaleOf = (sel) => evaluate(`(() => { const t = getComputedStyle(document.querySelector(${JSON.stringify(sel)})).transform; if (t === 'none') return 1; return +t.match(/matrix\\(([^,]+)/)[1]; })()`);
  const pressed = async (sel) => { const p = await rect(sel); await mouse('mouseMoved', p.x, p.y); await mouse('mousePressed', p.x, p.y); await sleep(260); const s = await scaleOf(sel); await mouse('mouseReleased', p.x, p.y); await sleep(260); return { down: s, up: await scaleOf(sel) }; };
  const row = await pressed('[data-ls-action="open-rules"]');
  assert(Math.abs(row.down - 0.97) <= 0.005 && row.up === 1, `F: a pointer row COMPRESSES to 97% on press (${row.down}) and returns to 1 on release (${row.up})`);
  const dur = await evaluate(`(() => { const r = getComputedStyle(document.querySelector('[data-ls-action="open-rules"]')); return { prop: r.transitionProperty, dur: r.transitionDuration }; })()`);
  assert(/transform/.test(dur.prop) && dur.dur.split(',')[0].trim() === '0.15s', `F: the press transition reads --motion-fast (${dur.prop} ${dur.dur})`);
  await paint({ ...CASES[1][1] });   // blocked: the Leave row is dimmed (aria-disabled)
  const dim = await pressed('[data-ls-action="leave"]');
  assert(dim.down === 1 && dim.up === 1, `F: a DIMMED (aria-disabled) Leave row does NOT animate on press (${dim.down})`);
  await paint({ ...CASES[0][1] });
  await evaluate(`(() => { const b = document.getElementById('ls-name-save'); return b.disabled; })()`);
  const dis = await pressed('#ls-name-save');
  assert(dis.down === 1, `F: the dimmed Save Name button does not animate either (${dis.down})`);
  const stepDur = await evaluate(`(() => { const e = document.createElement('div'); e.className = 'lc-step-in'; document.body.appendChild(e); const s = getComputedStyle(e); const r = { name: s.animationName, dur: s.animationDuration }; e.remove(); const f = document.createElement('div'); f.className = 'ls-view-back'; document.body.appendChild(f); const s2 = getComputedStyle(f); r.back = s2.animationName; r.backDur = s2.animationDuration; f.remove(); return r; })()`);
  assert(stepDur.name === 'lc-step-in' && stepDur.dur === '0.26s' && stepDur.back === 'lc-fade' && stepDur.backDur === '0.15s', `F: a PUSH is the 260 ms translateX+fade step and a BACK the 150 ms crossfade (${JSON.stringify(stepDur)}) — one motion language`);
  const sheetMotion = await evaluate(`(() => { const w = document.createElement('div'); w.id = 'ls-sheet-wrap'; w.innerHTML = '<div class="chat-sheet" id="ls-sheet"></div>'; document.body.appendChild(w); const s = getComputedStyle(document.getElementById('ls-sheet')); const r = { dur: s.animationDuration, tdur: s.transitionDuration }; w.remove(); return r; })()`);
  assert(sheetMotion.tdur.split(',')[0].trim() === '0.3s', `F: the hand-off sheet moves over --motion-modal (${sheetMotion.tdur})`);
  await open(390, 844, true);
  await paint(CASES[0][1]);
  const rm = await evaluate(`(() => { const e = document.createElement('div'); e.className = 'lc-step-in'; document.body.appendChild(e); const s = getComputedStyle(e); const r = { name: s.animationName, dur: s.animationDuration, rowT: getComputedStyle(document.querySelector('[data-ls-action="open-rules"]')).transitionDuration }; e.remove(); return r; })()`);
  assert(rm.name === 'lc-fade' && rm.dur === '0.15s' && rm.rowT === '0s', `F: under REDUCE MOTION the push becomes the 150 ms crossfade and the row's press transition is OFF (${JSON.stringify(rm)})`);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[G] THE DRAWER ROW…');
  await open(390, 844);
  const drawer = await evaluate(`(() => { const ctx = { escHtml, icon, accountRows: true, membershipsResolved: true, league: { id: 'L1', name: 'Saturday Crew' } };
    document.getElementById('league-page-overlay').innerHTML = '<div class="control-center-pane-content" style="padding:16px">' + CC.renderLeagueGroup(ctx) + '</div>';
    const row = document.querySelector('.cc-league-row'), r = row.getBoundingClientRect(), g = document.querySelector('.control-center-group').getBoundingClientRect();
    const sec = document.querySelector('.cc-row-secondary').getBoundingClientRect(), lab = document.querySelector('.cc-row-label').getBoundingClientRect();
    return { h: r.height, w: r.width, gw: g.width, secOK: sec.bottom <= r.bottom + 0.5 && lab.top >= r.top - 0.5 }; })()`);
  assert(drawer.h >= 47.5 && drawer.secOK, `G: the drawer's League Settings row measures ${drawer.h} pt (>= 48) with its secondary line inside it`);

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[I] STANDINGS WEEKLY HISTORY — the "(left) · by tiebreaker" caption in the real table at 375 pt (merge review, condition 2)…');
  await open(375, 700);
  const CAP = `(() => {
    document.getElementById('league-page-overlay').innerHTML = '<div style="padding:0 14px"><div class="stand-box mb-md"><table class="stand-table stand-table-history"><colgroup><col class="stand-c-wk"><col><col><col class="stand-c-st"></colgroup>'
      + '<thead><tr><th scope="col" class="stand-l">Week</th><th scope="col" class="stand-l">Winner</th><th scope="col" class="stand-l">Loser</th><th scope="col" class="stand-c">Status</th></tr></thead>'
      + '<tbody class="stand-wk-group"><tr class="stand-row"><td class="stand-wk"><span class="stand-wk-name">Week 1</span><span class="stand-sub">Sep 1-7</span></td>'
      + '<td class="stand-who"><span class="stand-name-text player-name-cell">Lefty</span><span class="stand-sub">(left) \\u00b7 by tiebreaker</span></td>'
      + '<td class="stand-who"><span class="stand-name-text player-name-cell">Sam</span></td><td class="stand-st"><span class="badge badge-open">Unpaid</span></td></tr></tbody></table></div></div>';
    const sub = document.querySelector('.stand-who .stand-sub'), who = document.querySelector('.stand-who'), r = sub.getBoundingClientRect(), wr = who.getBoundingClientRect(), lh = parseFloat(getComputedStyle(sub).lineHeight);
    return { clipped: sub.scrollWidth > sub.clientWidth + 1, lines: Math.round(r.height / lh), ws: getComputedStyle(sub).whiteSpace, insideCell: r.right <= wr.right + 0.5 && r.left >= wr.left - 0.5, text: sub.textContent, pageOverflow: document.documentElement.scrollWidth - innerWidth, whoW: +wr.width.toFixed(1) };
  })()`;
  const cap = await evaluate(CAP);
  assert(cap.text === '(left) · by tiebreaker' && !cap.clipped && cap.lines <= 2 && cap.insideCell && cap.pageOverflow <= 0.5, `I: the joined caption is shown IN FULL (never ellipsized away) in a ${cap.whoW} pt winner cell — ${cap.lines} line(s), white-space ${cap.ws}, inside the cell, no page overflow`);
  await evaluate(`(() => { const s = document.createElement('style'); s.id = 'mut3'; s.textContent = '.stand-who .stand-sub{white-space:nowrap !important;text-overflow:ellipsis !important}'; document.head.appendChild(s); })()`);
  const capMut = await evaluate(`(() => { const sub = document.querySelector('.stand-who .stand-sub'); return { clipped: sub.scrollWidth > sub.clientWidth + 1 }; })()`);
  assert(capMut.clipped === true, 'I (CANARY): with SP-56\'s own nowrap + ellipsis let back in, the same caption IS clipped — so the check above can fail, and the wrap rule is what keeps the tiebreaker note readable');

  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n[H] MEASUREMENT CANARIES — the SAME measurement reports a mutated layout…');
  await open(390, 844);
  await paint(CASES[0][1]);
  await evaluate(`(() => { const s = document.createElement('style'); s.id = 'mut'; s.textContent = '.ls-body{gap:4px !important}.ls-row{min-height:30px !important}'; document.head.appendChild(s); })()`);
  const mut = await evaluate('__measure()');
  assert(!mut.groupGaps.every((g) => Math.abs(g - 24) <= 0.6), `H: with the group gap mutated to 4 pt the 24 pt check FAILS (gaps ${JSON.stringify(mut.groupGaps)}) — the scanner is not vacuous`);
  assert(!mut.rows.every((r) => r.h >= 47.5), `H: with the row height mutated to 30 pt the 48 pt check FAILS (smallest ${Math.min(...mut.rows.map((r) => r.h))})`);
  // the merge-review spacing checks must be able to fail too: the global .card+.card margin let back in, and the Leave footers pressed together
  await paint(CASES[0][1]);
  await evaluate(`(() => { document.getElementById('mut')?.remove(); const s = document.createElement('style'); s.id = 'mut2'; s.textContent = '.ls-body .ls-facts{margin-top:12px !important}#ls-leave-foot{gap:0 !important}'; document.head.appendChild(s); })()`);
  const mut2 = await evaluate('__measure()');
  assert(!(mut2.stackGaps.length === 1 && Math.abs(mut2.stackGaps[0] - 16) <= 0.6 && mut2.factsMarginTop === 0), `H: with a margin let back onto the facts card (what the global .card+.card rule did when the two cards were siblings: 8 + 12 = 20) the 16 pt League-group check FAILS (gaps ${JSON.stringify(mut2.stackGaps)}, margin ${mut2.factsMarginTop}) — the 20 pt defect would be reported`);
  assert(!(mut2.leaveFootGaps.length >= 1 && mut2.leaveFootGaps.every((g) => Math.abs(g - 8) <= 0.6)), `H: with the Leave footers' gap removed the 8 pt footer check FAILS (${JSON.stringify(mut2.leaveFootGaps)}) — footers touching would be reported`);
} catch (e) {
  fail++;
  console.error('  ❌ the render suite could not run to completion:', e && e.message ? e.message : e);
}
await tallyAndExit();
