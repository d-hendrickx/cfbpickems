/**
 * CFB Pickems — gamedaybudgettest.mjs
 * ===================================
 * ENGINE-MEASURED proof of Game Day's SIZE BUDGET and its IN-PLACE MOTION (Deployment 1, Lane B; DI-603, DI-605 rev 3, DI-609; Drew D-58 "no more than about 25-33% of the initial viewport" and "the red card
 * itself open[s] up"). A real Chromium lays out the REAL css/styles.css against the REAL markup the app's own Home renders (js/home.js over the real storage seam, gamedayenv.mjs), inside the REAL shell of
 * index.html (header, main, tab bar — its scripts removed), and every claim below is a measured distance or a sampled frame, never a source grep.
 *
 *   [1] The collapsed card, every state of DI-603's table (live, nothing live, Locked, all final, Final, Open due, Open in), at 375 x 812 and 375 x 667, default text and 1.35x text, Light and Dark:
 *         its height <= 33% of the content window (the area between the header and the tab bar), the FIRST FEED CARD'S TITLE is above the tab bar, no tap target under 44 pt, no two buttons within 8 pt, no pill
 *         text clipped, a pill only for a LIVE game (never an upcoming or final one), the rail starting 16 pt in and scrolling sideways (not wrapping), the card never growing with the number of live games.
 *   [2] The OPEN card (the states that open): at most FIVE game rows, no inner scroller (nothing in it scrolls vertically), the footer's buttons >= 44 pt tall, 8 pt apart and centred, a game row >= 44 pt.
 *   [3] The MOTION: opening grows the card's height over 300 ms on the native curve with no overshoot, monotonic, the final state `height: auto`; the card's top edge and the window's scroll offset do not move;
 *         closing is the reverse; under Reduce Motion it is an instant change. Sampled frame by frame in the engine.
 *   [4] Anti-vacuity: every detector above is fed a sheet that breaks the rule it measures and must go RED.
 *
 * Fonts are deterministic: network resolution is blocked, so styles.css's web-font @import never loads and every run lays out with the same local fallbacks (wider than Oswald, so conservative). The assertions
 * are distances, ratios and relations, never absolute widths. Only a device confirms the final pixels: the on-device checklist in the hand-off covers gestures, haptics and scroll physics.
 *
 * Run:  node gamedaybudgettest.mjs      Override the browser: GAMEDAYBUDGET_ENGINE=/path/to/Chromium (falls back to SPACINGTEST_ENGINE, NAVTEST_ENGINE). A missing browser is a FAILURE, never a skip.
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const REAL_FETCH = globalThis.fetch;
let pass = 0, fail = 0;
function assert(cond, label) { if (cond) { pass++; console.log('  ✅', label); } else { fail++; console.error('  ❌', label); } }

const { installDom } = await import('./d1homeenv.mjs');
const doc = installDom();
const home = await import('./js/home.js');
const storage = await import('./js/storage.js');
const E = await import('./gamedayenv.mjs');
const MODS = { home, storage };
const CSS = readFileSync(join(here, 'css/styles.css'), 'utf8');
const INDEX = readFileSync(join(here, 'index.html'), 'utf8');

console.log(`\n[TZ=${process.env.TZ || '(system default)'}] gamedaybudgettest.mjs — Game Day's size budget and in-place motion (engine-measured)\n`);

// ── [0] Engine ───────────────────────────────────────────────────────────────
console.log('[0] Engine…');
const ENGINES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
];
const override = process.env.GAMEDAYBUDGET_ENGINE || process.env.SPACINGTEST_ENGINE || process.env.NAVTEST_ENGINE;
const bin = override || ENGINES.find(p => existsSync(p));
assert(!!bin && existsSync(bin), !bin ? `NO CHROMIUM-FAMILY BROWSER FOUND. Fix: GAMEDAYBUDGET_ENGINE=/path/to/Chromium node gamedaybudgettest.mjs. A missing browser is a FAILURE, never a skip. Looked for: ${ENGINES.join(', ')}` : `engine to measure in: ${bin}${override ? ' (from env)' : ''}`);
assert(typeof WebSocket === 'function', 'this Node has a global WebSocket (v22+) to speak the DevTools protocol over');

// ── pages: the REAL index.html shell with Home's real markup in #page-home ──
const tmp = mkdtempSync(join(tmpdir(), 'cfbp-gdbudget-'));
const CSS_HREF = 'file://' + here + 'css/styles.css';
const NOANIM = '<style>*,*::before,*::after{animation:none!important;transition:none!important}</style>';
let fileN = 0;
function shell(homeHtml, { css = CSS_HREF, dark = false, noAnim = true, filler = 0 } = {}) {
  let h = INDEX.replace(/<script[\s\S]*?<\/script>/g, '').replace(/ inert(?=[\s>])/g, '').replace(/ aria-hidden="true"(?=[^>]*class="(?:main-content|bottom-nav)")/g, '');   // the boot identity cover (index.html ships .main-content / .bottom-nav inert -> visibility:hidden) is lifted: this page is a laid-out, visible app
  h = h.replace(/<link[^>]*rel="stylesheet"[^>]*>/g, `<link rel="stylesheet" href="${css}">`);
  h = h.replace(/<link[^>]*rel="(manifest|apple-touch-icon|icon)"[^>]*>/g, '');
  h = h.replace(/<section class="page-section active" id="page-home">[\s\S]*?<\/section>/, `<section class="page-section active" id="page-home"><div id="home-root">${homeHtml}</div>${filler ? `<div style="height:${filler}px"></div>` : ''}</section>`);
  h = h.replace('</head>', `${noAnim ? NOANIM : ''}</head>`);
  h = h.replace(/<body class="cfbp-booting"[^>]*>/, `<body class="theme-neutral" data-tab="home" data-color-scheme="${dark ? 'dark' : 'light'}">`);   // the real <body> (boot class removed: the app is up)
  const file = join(tmp, `p${++fileN}.html`);
  writeFileSync(file, h);
  return file;
}
function sheet(transform) {
  const out = transform(CSS);
  if (out === CSS) throw new Error('sheet(): the transform changed nothing — a mutant that is the original proves nothing');
  const file = join(tmp, `s${++fileN}.css`);
  writeFileSync(file, out);
  return 'file://' + file;
}

// ── the CDP client (the same plumbing spacingtest uses) ──
function launch() {
  const proc = spawn(bin, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + join(tmp, 'profile'), '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--allow-file-access-from-files', '--hide-scrollbars', '--disable-background-networking', '--disable-sync', '--disable-component-update', '--disable-default-apps', '--disable-extensions',
    '--disable-search-engine-choice-screen', '--metrics-recording-only', '--mute-audio', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
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

// ── in-page measurement library ──
function R(e) { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }
function visible(list) { return list.filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }); }
function gap2(a, b) { const dx = Math.max(0, Math.max(b.l - a.r, a.l - b.r)), dy = Math.max(0, Math.max(b.t - a.b, a.t - b.b)); return Math.hypot(dx, dy); }
function minPair(list) { const rs = visible(list).map(R); let m = Infinity; for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) m = Math.min(m, gap2(rs[i], rs[j])); return m === Infinity ? null : +m.toFixed(2); }
const LIB = [R, visible, gap2, minPair].map(f => f.toString()).join('\n');

const PHONES = [{ name: '375x812', w: 375, h: 812 }, { name: '375x667', w: 375, h: 667 }];
const TEXTS = [{ name: 'default', scale: 1 }, { name: '1.35x', scale: 1.35 }];

let engine = null;
try {
  if (!bin) throw new Error('no engine binary');
  engine = await launch();
  const cdp = await attach(engine.ws);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  async function measure(file, fn, { w = 375, h = 812, scale = 1, args = null, reduced = false } = {}) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true });
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }] });
    const loaded = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url: 'file://' + file });
    await loaded;
    if (scale !== 1) await cdp.send('Runtime.evaluate', { expression: `document.documentElement.style.fontSize='${scale * 100}%'` });
    const r = await cdp.send('Runtime.evaluate', { expression: `(async () => { ${LIB}\n return (${fn.toString()})(${JSON.stringify(args)}); })()`, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('measure threw: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails));
    return r.result.value;
  }

  // ── [1] THE COLLAPSED CARD ─────────────────────────────────────────────────
  console.log('\n[1] The collapsed card — the size budget, the first feed card, the tap targets, the pills…');
  // fix round 2 (DI-599): the Final card's line now ends "· Next: …" — 'finalNextDue' carries the longest one ("Next: NFL Week 6 picks lock Sun 7:10 AM"), 'finalNext' the picked-in one
  const STATES = ['live1', 'live3', 'live9', 'live11', 'quiet', 'locked', 'allfinal', 'final', 'finalNext', 'finalNextDue', 'openDue', 'openIn'];
  const HTML = {};
  for (const name of STATES) { const s = E.scenario(name); const m = E.mount(MODS, doc, s); HTML[name] = { collapsed: m.html(), cardKind: (/data-gd-kind="([^"]+)"/.exec(m.card()) || [])[1], expandable: m.home.gameDayState().expandable }; }
  assert(STATES.every(n => HTML[n].collapsed.includes('id="gd-card"')), `[1-0] fixture integrity: all ${STATES.length} scenarios render a Game Day card through the real Home (${STATES.map(n => n + '=' + HTML[n].cardKind).join(', ')})`);
  assert((HTML.live3.collapsed.match(/class="gdp"/g) || []).length === 3 && (HTML.live9.collapsed.match(/class="gdp"/g) || []).length === 5 && /gdp--more/.test(HTML.live9.collapsed) && (HTML.live11.collapsed.match(/class="gdp"/g) || []).length === 5,
    '[1-0b] fixture integrity: 3 live games -> 3 pills; 9 or 11 live -> 5 pills and the dashed "All n ›" pill (the cap of 5)');

  const collapsedMeasure = () => {
    const gd = document.getElementById('gd-card');
    const hdr = document.querySelector('.app-header'), nav = document.querySelector('.bottom-nav');
    const cardH = gd.getBoundingClientRect().height;
    const headerBottom = hdr ? hdr.getBoundingClientRect().bottom : 0, navTop = nav ? nav.getBoundingClientRect().top : innerHeight;
    const windowH = navTop - headerBottom;
    const items = [...document.querySelectorAll('.home-feed .feed-item')];
    const nowIdx = items.findIndex(i => i.contains(gd));
    const next = items[nowIdx + 1] || null;
    const title = next ? next.querySelector('.feed-card-title, .feed-card-body') : null;
    const titleBottom = title ? title.getBoundingClientRect().bottom : null;
    const taps = visible([...gd.querySelectorAll('button')]).filter(b => { const r = b.getBoundingClientRect(); return r.height < 43.5 || r.width < 43.5; }).map(b => (b.getAttribute('aria-label') || b.textContent).trim().slice(0, 24) + ' ' + Math.round(b.getBoundingClientRect().width) + 'x' + Math.round(b.getBoundingClientRect().height));
    const pills = [...gd.querySelectorAll('.gdp:not(.gdp--more)')];
    const clipped = pills.filter(p => [...p.querySelectorAll('.gdp-l1, .gdp-l2')].some(e => e.scrollWidth > e.clientWidth + 1)).length;
    const rail = gd.querySelector('[data-gd-rail]');
    const btns = visible([...gd.querySelectorAll('.gd-msg button, .gd-foot button')]);
    const rr = rail ? rail.getBoundingClientRect() : null;
    const firstPill = pills[0] ? pills[0].getBoundingClientRect() : null;
    return {
      cardH: +cardH.toFixed(1), windowH: +windowH.toFixed(1), ratio: +(cardH / windowH).toFixed(4), navTop: +navTop.toFixed(1), titleBottom: titleBottom === null ? null : +titleBottom.toFixed(1),
      nextTop: next ? +next.getBoundingClientRect().top.toFixed(1) : null, taps, pillCount: pills.length, clipped,
      railWraps: rail ? (new Set(pills.map(p => Math.round(p.getBoundingClientRect().top))).size > 1) : false,
      railOverflowsX: rail ? rail.scrollWidth > rail.clientWidth + 1 : false, railLeftPad: rail && firstPill ? +(firstPill.left - rr.left).toFixed(1) : null,
      pillGap: pills.length > 1 ? minPair(pills) : null, btnGap: btns.length > 1 ? minPair(btns) : null,
      kind: gd.getAttribute('data-gd-kind'), vOverflow: gd.scrollHeight - gd.clientHeight,
      next: gd.querySelector('.gd-next') ? (getComputedStyle(gd.querySelector('.gd-next')).display !== 'none' ? 'shown' : 'folded') : 'none',
    };
  };
  const BUDGET = 0.33;
  const rows = [];
  for (const mode of [false, true]) {
    for (const ph of PHONES) {
      for (const tx of TEXTS) {
        for (const name of STATES) {
          const f = shell(HTML[name].collapsed, { dark: mode });
          const m = await measure(f, collapsedMeasure, { w: ph.w, h: ph.h, scale: tx.scale });
          rows.push({ name, ph: ph.name, tx: tx.name, dark: mode, ...m });
        }
      }
    }
  }
  const worst = rows.reduce((a, r) => (r.ratio > a.ratio ? r : a), rows[0]);
  const over = rows.filter(r => r.ratio > BUDGET);
  assert(over.length === 0, `[1a] ${rows.length} measurements (${STATES.length} states x 2 phones x 2 text sizes x Light/Dark): the collapsed card is never over ${BUDGET * 100}% of the content window — worst ${worst.name} ${worst.ph} ${worst.tx} ${worst.dark ? 'dark' : 'light'}: ${worst.cardH} of ${worst.windowH} pt = ${(worst.ratio * 100).toFixed(1)}%${over.length ? ' — OVER: ' + over.slice(0, 4).map(r => `${r.name}/${r.ph}/${r.tx} ${(r.ratio * 100).toFixed(1)}%`).join('; ') : ''}`);
  const liveDefault = rows.filter(r => r.kind === 'live' && r.tx === 'default' && !r.dark);
  assert(liveDefault.length === 8 && liveDefault.every(r => r.ratio <= 0.25), `[1b] the live card at default text is inside Drew's "about 25%" on both phones (${liveDefault.map(r => `${r.ph} ${(r.ratio * 100).toFixed(1)}%`).filter((v, i, a) => a.indexOf(v) === i).join(', ')})`);
  const noTitle = rows.filter(r => r.titleBottom === null || r.titleBottom > r.navTop);
  assert(noTitle.length === 0, `[1c] THE FIRST FEED CARD'S TITLE IS ABOVE THE TAB BAR in every one of the ${rows.length} measurements — "at least the beginning of the new Home/feed cards underneath it"${noTitle.length ? ' — HIDDEN: ' + noTitle.slice(0, 4).map(r => `${r.name}/${r.ph}/${r.tx} title ${r.titleBottom} > nav ${r.navTop}`).join('; ') : ''}`);
  assert(rows.every(r => r.taps.length === 0), `[1d] no tap target under 44 pt in the collapsed card, in any of the ${rows.length} measurements${rows.some(r => r.taps.length) ? ' — ' + rows.filter(r => r.taps.length).slice(0, 3).map(r => `${r.name}/${r.ph}/${r.tx}: ${r.taps.join(', ')}`).join('; ') : ''}`);
  assert(rows.every(r => r.pillGap === null || r.pillGap >= 7.5) && rows.every(r => r.btnGap === null || r.btnGap >= 7.5), '[1e] no two pills, and no two buttons, within 8 pt of each other (the rail\'s gap and the message\'s button gap are 8)');
  assert(rows.every(r => r.clipped === 0), `[1f] no pill text clips (line 1 and line 2 fit their pill) in any measurement${rows.some(r => r.clipped) ? ' — ' + rows.filter(r => r.clipped).slice(0, 3).map(r => `${r.name}/${r.ph}/${r.tx}`).join(', ') : ''}`);
  assert(rows.filter(r => r.kind === 'live').every(r => !r.railWraps && r.railLeftPad >= 15.5 && r.railLeftPad <= 16.5), '[1g] the pill rail is ONE row that scrolls sideways (never wraps) and starts 16 pt in');
  assert(rows.filter(r => ['live9', 'live11'].includes(r.name) && r.tx === 'default').every(r => r.railOverflowsX), '[1h] with 9 or 11 live games the rail overflows sideways (the third pill peeks past the edge) — the card does not grow with the number of live games');
  const h = (n) => rows.find(r => r.name === n && r.ph === '375x812' && r.tx === 'default' && !r.dark).cardH;
  assert(h('live1') === h('live3') && h('live3') === h('live9') && h('live9') === h('live11'), `[1i] the collapsed LIVE card is the same height with 1, 3, 9 or 11 live games (${h('live1')}, ${h('live3')}, ${h('live9')}, ${h('live11')} pt): it never grows with the slate`);
  assert(rows.filter(r => r.name === 'live3' && r.tx === 'default').every(r => r.cardH >= 100 && r.cardH <= 140), `[1j] the live card is about 116 pt as drawn (got ${[...new Set(rows.filter(r => r.name === 'live3' && r.tx === 'default').map(r => r.cardH))].join(', ')})`);
  // DI-599 (fix round 2): the Final card's "· Next: …" is shown wherever it fits and FOLDED (into the open card) only where the narrow column at the largest text would break the 33% cap
  const nx = rows.filter((r) => r.name === 'finalNextDue');
  assert(nx.filter((r) => r.tx === 'default').every((r) => r.next === 'shown') && nx.filter((r) => r.tx === '1.35x' && r.ph === '375x667').every((r) => r.next === 'folded') && nx.every((r) => r.ratio <= BUDGET), `[1l] the Final card's "Next: …" shows at default text on both phones and folds away at 1.35x on the 667 pt phone, where it would cross the cap (${nx.map((r) => `${r.ph}/${r.tx}${r.dark ? '/dark' : ''}: ${r.next} ${(r.ratio * 100).toFixed(1)}%`).filter((v, i, a) => a.indexOf(v) === i).join('; ')})`);
  // pills only for LIVE games: the live3 slate holds upcoming (c4 c5 c7) and final (c6) games; none has a pill
  assert(!/data-game-id="c(4|5|6|7)"/.test(HTML.live3.collapsed) && /data-game-id="c1"/.test(HTML.live3.collapsed) && !/gdp/.test(HTML.quiet.collapsed) && !/gdp/.test(HTML.allfinal.collapsed) && !/gdp/.test(HTML.locked.collapsed),
    '[1k] a pill exists ONLY for a live game: the upcoming and final games of a live slate have none, and nothing-live / Locked / all-final have no pill at all (Drew D-58)');

  // ── [1m] DESIGN_D1_E (DI-E1.5 / DI-E1.9.4, W-85) - the Open card of a sport the member has NOT joined ───────────────────────────────────────────────────────────────────
  // "In 2h 10m · you're not in NFL picks yet" beside a "Join NFL picks" button (Make picks' replacement is 40% wider), through the real Home with a CFB-only member whose Now card is the NFL week, and the
  // same with the LONGEST plausible sport code ('NCAAFB', six characters; the registry's are three): the collapsed card must still be header + one two-line message, inside the cap, on both phones at both text sizes, Light and Dark.
  console.log('\n[1m] The Open card of a sport the member has not joined (W-85) — Join NFL picks, and the longest sport code…');
  E.SCENARIOS.joinOpen = { week: 'final', live: [], up: ['n1', 'n2', 'n3'], fin: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'], plays: ['cfb'], sportStatus: { nfl: 'open' }, noPicksFor: ['nfl'] };
  const joinCard = (label) => {
    const sc = E.scenario('joinOpen');
    const nflWeek = sc.league.weeks.find(w => w.weekId === 'w6n');
    const ids = (sp) => sc.league.weeks.filter(w => w.sport === sp).map(w => w.weekId);
    const all6 = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'], nflIn = all6.filter(p => p !== 'p1');
    const contexts = [
      { competitionId: 'c_cfb', dbCode: 'cfb', code: 'CFB', weekIds: ids('cfb'), playerIds: all6, currentWeekId: 'w6', weekEntrants: { w6: all6 } },
      { competitionId: 'c_nfl', dbCode: 'nfl', code: label, weekIds: ids('nfl'), playerIds: nflIn, currentWeekId: 'w6n', weekEntrants: { w6n: nflIn } },
    ];
    const comps = sc.competitions.map(c => (c.sport === 'nfl' ? { ...c, label } : c));
    const m = E.mount(MODS, doc, sc, { read: { currentWeek: () => nflWeek, contexts: () => contexts, rosterForWeek: () => sc.league.players }, deps: { competitions: () => comps, joinOffers: () => [{ dbCode: 'nfl', code: label, joinable: true }] } });
    return { html: m.html(), card: m.card() };
  };
  const JOIN = { joinOpen: joinCard('NFL'), joinOpenLong: joinCard('NCAAFB') };
  assert(/data-gd-kind="open-due"/.test(JOIN.joinOpen.card) && /Join NFL picks/.test(JOIN.joinOpen.card) && /you&#39;re not in NFL picks yet|you're not in NFL picks yet/.test(JOIN.joinOpen.card) && !/Make picks/.test(JOIN.joinOpen.card), '[1m-0] fixture integrity: the non-entrant\'s Open card says "you\'re not in NFL picks yet" and offers "Join NFL picks" (not Make picks)');
  assert(/Join NCAAFB picks/.test(JOIN.joinOpenLong.card) && /not in NCAAFB picks yet/.test(JOIN.joinOpenLong.card.replace(/&#39;/g, "'")), '[1m-0b] fixture integrity: the same card with the longest sport code ("Join NCAAFB picks", the longest plausible code, six characters)');
  const joinRows = [];
  for (const mode of [false, true]) for (const ph of PHONES) for (const tx of TEXTS) for (const name of Object.keys(JOIN)) {
    const f = shell(JOIN[name].html, { dark: mode });
    const m = await measure(f, collapsedMeasure, { w: ph.w, h: ph.h, scale: tx.scale });
    const b = await measure(f, () => { const gd = document.getElementById('gd-card'); const btn = gd.querySelector('.gd-msg button'); const r = btn.getBoundingClientRect(), cr = gd.getBoundingClientRect(); return { btnH: +r.height.toFixed(1), btnClipped: btn.scrollWidth > btn.clientWidth + 1, btnInside: r.right <= cr.right - 15.5 && r.left >= cr.left, lines: Math.round(r.height / 20), txClipped: [...gd.querySelectorAll('.gd-tx b, .gd-tx > span')].some(e => e.scrollWidth > e.clientWidth + 1) }; }, { w: ph.w, h: ph.h, scale: tx.scale });
    joinRows.push({ name, ph: ph.name, tx: tx.name, dark: mode, ...m, ...b });
  }
  const jWorst = joinRows.reduce((a, r) => (r.ratio > a.ratio ? r : a), joinRows[0]);
  assert(joinRows.every(r => r.ratio <= BUDGET), `[1m-1] ${joinRows.length} measurements (2 fixtures x 2 phones x 2 text sizes x Light/Dark): the non-entrant's Open card is never over ${BUDGET * 100}% of the content window — worst ${jWorst.name} ${jWorst.ph} ${jWorst.tx} ${jWorst.dark ? 'dark' : 'light'}: ${jWorst.cardH} of ${jWorst.windowH} pt = ${(jWorst.ratio * 100).toFixed(1)}%${joinRows.filter(r => r.ratio > BUDGET).length ? ' — OVER: ' + joinRows.filter(r => r.ratio > BUDGET).slice(0, 3).map(r => `${r.name}/${r.ph}/${r.tx} ${(r.ratio * 100).toFixed(1)}%`).join('; ') : ''}`);
  assert(joinRows.every(r => r.kind === 'open-due' && r.titleBottom !== null && r.titleBottom <= r.navTop), '[1m-2] the first feed card\'s title is above the tab bar in every one of them');
  assert(joinRows.every(r => r.taps.length === 0 && r.btnH >= 43.5), `[1m-3] the Join button is >= 44 pt tall and no tap target is under 44 pt (button ${[...new Set(joinRows.map(r => r.btnH))].join(', ')} pt)`);
  assert(joinRows.every(r => r.btnInside && !r.btnClipped && !r.txClipped), '[1m-4] the button stays inside the card (16 pt from its trailing edge) and neither it nor the message clips, even with the longest code');
  const jNext = joinRows.map(r => `${r.name}/${r.ph}/${r.tx}${r.dark ? '/dark' : ''}: ${r.next}`);
  assert(joinRows.filter(r => r.name === 'joinOpen' && r.tx === 'default').every(r => r.next === 'shown') && joinRows.filter(r => r.tx === '1.35x').every(r => r.next === 'folded'), `[1m-5] the clause shows at the default text size with NFL and folds at the largest text (with the longest code it folds sooner): the button names the action either way (${[...new Set(jNext)].slice(0, 6).join('; ')})`);

  // ── [2] THE OPEN CARD ──────────────────────────────────────────────────────
  console.log('\n[2] The open card — five rows at most, no inner scroller, the footer…');
  const OPENABLE = STATES.filter(n => HTML[n].expandable);
  for (const name of OPENABLE) { const s = E.scenario(name); const m = E.mount(MODS, doc, s); m.open(); HTML[name].open = m.html(); }
  const openMeasure = () => {
    const gd = document.getElementById('gd-card');
    const rowsEl = [...gd.querySelectorAll('.gd-row')];
    const foot = gd.querySelector('.gd-foot');
    const fb = foot ? visible([...foot.querySelectorAll('button')]) : [];
    const fr = foot ? foot.getBoundingClientRect() : null;
    const union = fb.length ? { l: Math.min(...fb.map(b => b.getBoundingClientRect().left)), r: Math.max(...fb.map(b => b.getBoundingClientRect().right)) } : null;
    const scrollers = [...gd.querySelectorAll('*')].filter(e => { const s = getComputedStyle(e); return (s.overflowY === 'auto' || s.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 1; }).length;
    const tooSmall = visible([...gd.querySelectorAll('button')]).filter(b => { const r = b.getBoundingClientRect(); return r.height < 43.5; }).map(b => (b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 24));
    return {
      rows: rowsEl.length, rowH: rowsEl.map(r => +r.getBoundingClientRect().height.toFixed(1)), scrollers, tooSmall,
      footBtns: fb.length, footGap: fb.length > 1 ? minPair(fb) : null, footH: fb.map(b => +b.getBoundingClientRect().height.toFixed(1)),
      footCenterDev: union && fr ? +Math.abs((union.l + union.r) / 2 - (fr.left + fr.right) / 2).toFixed(2) : null,
      head: gd.querySelector('.gd-head').getAttribute('aria-expanded'), headingFocusable: !!gd.querySelector('#gd-h[tabindex="-1"]'),
      cardH: +gd.getBoundingClientRect().height.toFixed(1), overflowX: gd.scrollWidth - gd.clientWidth,
      nextNote: [...gd.querySelectorAll('.gd-stat--note')].filter((n) => /What's next:/.test(n.textContent)).map((n) => ({ h: +n.getBoundingClientRect().height.toFixed(1), inside: n.getBoundingClientRect().right <= gd.getBoundingClientRect().right - 15.5 && n.scrollWidth <= n.clientWidth + 1 })),
      wide: gd.scrollWidth - gd.clientWidth > 1 ? [...gd.querySelectorAll('*')].filter(e => e.getBoundingClientRect().right > gd.getBoundingClientRect().right + 1).slice(0, 3).map(e => (e.className || e.tagName) + ' +' + Math.round(e.getBoundingClientRect().right - gd.getBoundingClientRect().right)) : [],
    };
  };
  const openRows = [];
  for (const name of OPENABLE) for (const ph of PHONES) for (const tx of TEXTS) {
    const m = await measure(shell(HTML[name].open), openMeasure, { w: ph.w, h: ph.h, scale: tx.scale });
    openRows.push({ name, ph: ph.name, tx: tx.name, ...m });
  }
  assert(openRows.every(r => r.rows <= 5) && openRows.some(r => r.rows === 5), `[2a] the open card shows AT MOST FIVE games in all ${openRows.length} measurements (the 9- and 11-game slates show five and "All N games on Dashboard ›")`);
  assert(openRows.every(r => r.scrollers === 0), '[2b] NO inner scroller: nothing inside the open card scrolls vertically (a nested scroller in a scrolling feed is a scroll trap)');
  assert(openRows.every(r => r.tooSmall.length === 0), `[2c] every button in the open card is >= 44 pt tall (header, rows, footer)${openRows.some(r => r.tooSmall.length) ? ' — ' + openRows.filter(r => r.tooSmall.length).slice(0, 3).map(r => `${r.name}/${r.ph}/${r.tx}: ${r.tooSmall}`).join('; ') : ''}`);
  assert(openRows.every(r => r.footBtns === 2 && r.footGap >= 7.5 && r.footH.every(x => x >= 43.5)), '[2d] the footer is TWO buttons (Dashboard, Collapse), 44 pt tall and at least 8 pt apart — side by side or stacked');
  assert(openRows.every(r => r.footCenterDev <= 1.5), `[2e] the footer's buttons are CENTRED in their container (worst deviation ${Math.max(...openRows.map(r => r.footCenterDev))} pt)`);
  assert(openRows.every(r => r.overflowX <= 1), `[2f] nothing in the open card is wider than the card (no sideways overflow at 375 pt or 1.35x text)${openRows.some(r => r.overflowX > 1) ? ' — WIDE: ' + openRows.filter(r => r.overflowX > 1).slice(0, 3).map(r => `${r.name}/${r.ph}/${r.tx}: ${r.wide.join(', ')}`).join('; ') : ''}`);
  assert(openRows.every(r => r.head === 'true' && r.headingFocusable), '[2g] the open card\'s header says aria-expanded="true" and the card holds the focusable heading focus moves into');
  // DI-599 (fix round 2): wherever the collapsed card folds "Next: …" away, the OPEN Final card carries the full sentence — laid out, inside the card's 16 pt padding, not clipped
  const fn = openRows.filter(r => r.name === 'finalNextDue');
  assert(fn.length === 4 && fn.every(r => r.nextNote.length === 1 && r.nextNote[0].h >= 16 && r.nextNote[0].inside), `[2i] the OPEN Final card shows "What's next: …" in full on both phones at both text sizes, inside the card (${fn.map(r => `${r.ph}/${r.tx}: ${r.nextNote.map(n => n.h + ' pt').join('')}`).join('; ')})`);
  const f9 = openRows.find(r => r.name === 'live9' && r.ph === '375x812' && r.tx === 'default');
  assert(f9 && f9.cardH > 400 && f9.cardH < 1100, `[2h] the open card with 9 live games is about one and a half screens at most (${f9 && f9.cardH} pt) — five rows, never a second page`);

  // ── [3] THE MOTION ─────────────────────────────────────────────────────────
  console.log('\n[3] The motion — the red card itself grows in place…');
  const domSrc = readFileSync(join(here, 'js/gameday-dom.js'), 'utf8');
  const klSrc = readFileSync(join(here, 'js/keyed-list.js'), 'utf8');
  const cardOf = (html) => (/<section class="gd[\s\S]*?<\/section>/.exec(html) || [''])[0];
  const motion = async ({ html0, html1, domSrc: dsrc, klSrc: ksrc }) => {
    const klUrl = URL.createObjectURL(new Blob([ksrc], { type: 'text/javascript' }));
    const dom = await import(URL.createObjectURL(new Blob([dsrc.replace("from './keyed-list.js'", `from '${klUrl}'`)], { type: 'text/javascript' })));
    const holder = document.querySelector('[data-card-key="now"]');
    window.scrollTo({ top: 120, left: 0, behavior: 'instant' });
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const run = async (html) => {
      const gd0 = holder.querySelector('.gd');
      const top0 = gd0.getBoundingClientRect().top, y0 = scrollY;
      const t0 = performance.now();
      const res = dom.swapGameDay(holder, html, { reduced, win: window, restoreScroll: (y) => window.scrollTo({ top: y, left: 0, behavior: 'instant' }) });
      const gd = holder.querySelector('.gd');
      const samples = [{ t: 0, h: +gd.getBoundingClientRect().height.toFixed(2), top: +gd.getBoundingClientRect().top.toFixed(2) }];   // the frame the tap itself paints
      await new Promise((resolve) => {
        const tick = () => { const t = performance.now() - t0; samples.push({ t: +t.toFixed(1), h: +gd.getBoundingClientRect().height.toFixed(2), top: +gd.getBoundingClientRect().top.toFixed(2) }); if (t < 700) requestAnimationFrame(tick); else resolve(); };
        requestAnimationFrame(tick);
      });
      const cs = getComputedStyle(gd);
      return { res, samples, top0: +top0.toFixed(2), y0, y1: scrollY, inlineHeight: gd.style.height, inlineTransition: gd.style.transition, overflow: cs.overflow, moving: gd.getAttribute('data-gd-moving') };
    };
    const open = await run(html1);
    const close = await run(html0);
    return { open, close, reduced };
  };
  const html0 = cardOf(HTML.live3.collapsed), html1 = cardOf(HTML.live3.open);
  const page = shell(HTML.live3.collapsed, { noAnim: false, filler: 1600 });
  const M = await measure(page, motion, { w: 375, h: 812, args: { html0, html1, domSrc, klSrc } });
  const grow = M.open.samples, shrink = M.close.samples;
  const hFrom = grow[0].h, hTo = M.open.res.to;
  const settled = (arr) => arr[arr.length - 1].h;
  const dur = (arr, to) => { const last = arr.find(s => Math.abs(s.h - to) <= 0.6); return last ? last.t : Infinity; };
  const monotonic = (arr, dir) => arr.every((s, i) => i === 0 || (dir > 0 ? s.h >= arr[i - 1].h - 0.01 : s.h <= arr[i - 1].h + 0.01));
  const collapsedH = M.close.res.to;
  assert(M.open.res.animated === true && M.open.res.from > 80 && M.open.res.from < 140 && M.open.res.to > 400, `[3a] opening animates (from ${M.open.res.from} to ${M.open.res.to} pt)`);
  assert(grow[0].h <= M.open.res.from + 1 && grow[0].h < M.open.res.to - 100, `[3b] the first frame is still (about) the collapsed height (${grow[0].h}) — the card GROWS, it does not snap`);
  const tOpen = dur(grow, M.open.res.to);
  assert(tOpen >= 220 && tOpen <= 400, `[3c] opening takes ~300 ms on the modal range 250-350 ms (reached its height after ${tOpen} ms)`);
  assert(monotonic(grow, 1) && Math.max(...grow.map(s => s.h)) <= M.open.res.to + 0.6, '[3d] the height rises monotonically and NEVER overshoots its final height (no bounce, no spring)');
  assert(M.open.inlineHeight === '' && M.open.inlineTransition === '' && M.open.moving === null && Math.abs(settled(grow) - M.open.res.to) <= 0.6, '[3e] when it ends the inline height and transition are CLEARED (the final state is height:auto, so a text-size change never fights a fixed height)');
  assert(grow.every(s => Math.abs(s.top - M.open.top0) <= 0.6) && M.open.y1 === M.open.y0, `[3f] the card's top edge does not move (${M.open.top0} pt throughout) and the window's scroll offset is unchanged (${M.open.y0} -> ${M.open.y1}): the feed moves down because the member tapped`);
  assert(/hidden|clip/.test(M.open.overflow), `[3g] the card clips its content while it grows (overflow: ${M.open.overflow})`);
  const tClose = dur(shrink, collapsedH);
  assert(M.close.res.animated === true && tClose >= 220 && tClose <= 400 && monotonic(shrink, -1) && Math.min(...shrink.map(s => s.h)) >= collapsedH - 0.6, `[3h] closing is the reverse: ~300 ms (${tClose} ms), monotonic down, never below the collapsed height, no overshoot`);
  const ease = await measure(page, () => { const gd = document.querySelector('.gd'); gd.style.transition = 'height var(--motion-modal) var(--ease-native)'; const cs = getComputedStyle(gd); return { fn: cs.transitionTimingFunction, dur: cs.transitionDuration, prop: cs.transitionProperty, modal: getComputedStyle(document.documentElement).getPropertyValue('--motion-modal').trim(), ease: getComputedStyle(document.documentElement).getPropertyValue('--ease-native').trim() }; }, { w: 375, h: 812 });
  assert(/cubic-bezier\(0\.32, 0\.72, 0, 1\)/.test(ease.fn) && ease.dur === '0.3s' && ease.prop === 'height', `[3i] the transition is 300 ms on the native curve (${ease.fn}, ${ease.dur}, ${ease.prop}) — the app's --motion-modal and --ease-native tokens`);
  const R0 = await measure(page, motion, { w: 375, h: 812, args: { html0, html1, domSrc, klSrc }, reduced: true });
  assert(R0.reduced === true && R0.open.res.animated === false && R0.open.samples[0].h >= R0.open.res.to - 0.6 && R0.close.res.animated === false && R0.close.samples[0].h <= R0.close.res.to + 0.6, '[3j] under Reduce Motion the change is INSTANT: no transition, the first frame is already the final height, both ways');

  // ── [3k..] A CHANGE ELSEWHERE IN THE FEED never replaces the card's node (reviewer B3, fix round 1) — measured in the engine, where focus, scroll offsets and animations are real ──
  console.log('\n[3k] A feed change in the same paint leaves the card\'s node, its focus and its rail\'s scroll alone (real engine)…');
  const around = async ({ domSrc: dsrc, klSrc: ksrc, wholesale }) => {
    const klUrl = URL.createObjectURL(new Blob([ksrc], { type: 'text/javascript' }));
    const dom = await import(URL.createObjectURL(new Blob([dsrc.replace("from './keyed-list.js'", `from '${klUrl}'`)], { type: 'text/javascript' })));
    const feed = document.querySelector('.home-feed');
    const holder = feed.querySelector('[data-card-key="now"]');
    const rail = holder.querySelector('.gd-rail');
    const frames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    rail.scrollLeft = 160; await frames();
    const sl0 = rail.scrollLeft;
    const pill = rail.querySelectorAll('.gdp')[1]; pill.focus();
    const kids = [...feed.children];
    const items = kids.map(k => ({ key: k.getAttribute('data-card-key'), html: k.innerHTML }));
    const prev = { htmls: new Map(items.map(i => [i.key, i.html])), keys: new Set(items.map(i => i.key)) };
    const next = [{ key: 'zz:arrived', html: '<article class="card feed-card"><p>A card that arrived</p></article>' }, items[0], { key: items[1].key, html: items[1].html + '<i data-changed="1"></i>' }, ...items.slice(2, -1)];
    const markup = (it, isNew) => `<div class="feed-item${isNew ? ' feed-item--enter' : ''}" data-card-key="${it.key}">${it.html}</div>`;
    const writes = [];
    if (wholesale) feed.parentNode.innerHTML = `<div class="home-feed">${next.map(it => markup(it, false)).join('')}</div>`;   // what the old paint did: rewrite the whole feed
    else dom.writeAroundGameDay(feed, holder, next, prev, markup);
    await frames();
    const feed2 = document.querySelector('.home-feed');
    const holder2 = feed2.querySelector('[data-card-key="now"]');
    return {
      sameHolder: holder2 === holder, sameRail: !!holder2 && holder2.querySelector('.gd-rail') === rail, railScroll: holder2 && holder2.querySelector('.gd-rail') ? holder2.querySelector('.gd-rail').scrollLeft : null, sl0,
      focusKept: document.activeElement === pill && pill.isConnected, active: document.activeElement && document.activeElement.tagName,
      keys: [...feed2.children].map(k => k.getAttribute('data-card-key')), want: next.map(i => i.key),
      changedApplied: !!feed2.querySelector(`[data-card-key="${items[1].key}"] [data-changed="1"]`), arrivedEntering: !!feed2.querySelector('[data-card-key="zz:arrived"].feed-item--enter'),
      removed: !feed2.querySelector(`[data-card-key="${items[items.length - 1].key}"]`),
    };
  };
  const pageA = shell(HTML.live3.collapsed, { noAnim: true });
  const W = await measure(pageA, around, { w: 375, h: 812, args: { domSrc, klSrc, wholesale: false } });
  assert(W.sameHolder && W.sameRail, '[3k] the card\'s feed-item node and its rail node are the SAME nodes after the feed changed around them');
  assert(W.sl0 >= 100 && W.railScroll === W.sl0, `[3l] the rail's scrollLeft is unchanged (${W.sl0} -> ${W.railScroll}): a pan in progress does not snap back to the first pill`);
  assert(W.focusKept, `[3m] focus stayed on the pill it was on (a detached node would drop it to <${String(W.active).toLowerCase()}>)`);
  assert(JSON.stringify(W.keys) === JSON.stringify(W.want) && W.changedApplied && W.arrivedEntering && W.removed, `[3n] …and the rest of the feed did what was asked: the new card is first and fades in, the changed one changed, the last one is gone, in order (${W.keys.join(', ')})`);
  const Wo = await measure(pageA, around, { w: 375, h: 812, args: { domSrc, klSrc, wholesale: true } });
  assert(!Wo.sameHolder && !Wo.focusKept && Wo.railScroll === 0, `[3o] anti-vacuity: the OLD way (rewrite the whole feed) fails every one of those in this engine — node replaced: ${!Wo.sameHolder}, focus lost to <${String(Wo.active).toLowerCase()}>: ${!Wo.focusKept}, rail back to ${Wo.railScroll} (was ${Wo.sl0}) — so [3k]-[3m] are measurements`);
  // the open body's fade belongs to the move: not to a card that is merely drawn
  const fadeOf = async ({ moving }) => {
    const gd = document.querySelector('.gd'); const x = gd.querySelector('.gd-x');
    if (moving) gd.setAttribute('data-gd-moving', 'true');
    const cs = getComputedStyle(x);
    return { name: cs.animationName, delay: cs.animationDelay, dur: cs.animationDuration };
  };
  const pageOpen = shell(HTML.live3.open, { noAnim: false });
  const still = await measure(pageOpen, fadeOf, { w: 375, h: 812, args: { moving: false } });
  const mv = await measure(pageOpen, fadeOf, { w: 375, h: 812, args: { moving: true } });
  const mvReduced = await measure(pageOpen, fadeOf, { w: 375, h: 812, args: { moving: true }, reduced: true });
  assert(still.name === 'none', `[3p] B3: an open card that is merely DRAWN (a repaint, a feed change elsewhere) plays no fade (animation-name: ${still.name})`);
  assert(mv.name === 'gd-fade-in' && mv.delay === '0.1s', `[3q] …while a card that is OPENING (data-gd-moving) fades its body in (${mv.name}, delay ${mv.delay}, ${mv.dur}): the 150 ms fade over the last of the 300 ms height change`);
  assert(mvReduced.name === 'none', '[3r] …and under Reduce Motion there is no fade at all');

  // ── [4] ANTI-VACUITY ───────────────────────────────────────────────────────
  console.log('\n[4] Anti-vacuity — every detector fed a sheet that breaks its rule must go RED…');
  {
    const fat = sheet(c => c + '\n.gdp{min-height:150px}\n');
    const m = await measure(shell(HTML.live3.collapsed, { css: fat }), collapsedMeasure, { w: 375, h: 667, scale: 1.35 });
    assert(m.ratio > BUDGET, `[4a] with the pill 150 pt tall the SAME budget detector reads ${(m.ratio * 100).toFixed(1)}% > 33% — so [1a] is a measurement, not a constant`);
    const tall = sheet(c => c + '\n.gd-head{min-height:420px}\n');
    const t = await measure(shell(HTML.live3.collapsed, { css: tall }), collapsedMeasure, { w: 375, h: 667 });
    assert(t.titleBottom === null || t.titleBottom > t.navTop, '[4b] with a card tall enough to push the feed under the tab bar the first-title detector reads HIDDEN — so [1c] can fail');
    const small = sheet(c => c + '\n.gdp{min-height:30px;padding-top:2px;padding-bottom:2px}\n.gd-head{min-height:30px}\n');
    const sm = await measure(shell(HTML.live3.collapsed, { css: small }), collapsedMeasure, { w: 375, h: 812 });
    assert(sm.taps.length > 0, `[4c] with 30 pt pills the tap-target detector flags them (${sm.taps.slice(0, 2).join(', ')}) — so [1d] can fail`);
    const touch = sheet(c => c + '\n.gd-rail{gap:0}\n');
    const tc = await measure(shell(HTML.live3.collapsed, { css: touch }), collapsedMeasure, { w: 375, h: 812 });
    assert(tc.pillGap !== null && tc.pillGap < 7.5, `[4d] with the rail's gap removed the pills touch (gap ${tc.pillGap}) — so [1e] can fail`);
    const wrapRail = sheet(c => c + '\n.gd-rail{flex-wrap:wrap}\n');
    const wr = await measure(shell(HTML.live9.collapsed, { css: wrapRail }), collapsedMeasure, { w: 375, h: 812 });
    assert(wr.railWraps === true && wr.ratio > h('live9') / 600, `[4e] with the rail allowed to wrap it grows with the games (${wr.cardH} pt vs ${h('live9')}) — so [1g]/[1i] can fail`);
    const noFold = sheet(c => c.replace('@container (max-width:12.5em){.gd-next{display:none}}', ''));
    const nf = await measure(shell(HTML.finalNextDue.collapsed, { css: noFold }), collapsedMeasure, { w: 375, h: 667, scale: 1.35 });
    assert(nf.next === 'shown' && nf.ratio > BUDGET, `[4g] without the fold rule the Final card with its longest "Next" line reads ${(nf.ratio * 100).toFixed(1)}% > 33% at 375 x 667, 1.35x — so [1a]/[1l] measure the fold, not a constant`);
    // N2 (review round 3 note): iOS 15 has NO container queries. Simulate that engine: the @container rule is dropped (an engine without them ignores it) and the
    // `@supports not (container-type:inline-size)` fallback is made to apply. The Final card with its longest "Next" line must still be within the cap on BOTH phones at BOTH text sizes.
    const noCQ = (c) => {
      const out = c.replace('@container (max-width:12.5em){.gd-next{display:none}}', '').replace('@supports not (container-type:inline-size)', '@supports (display:block)');
      if (out === c || out.includes('@container (max-width:12.5em)')) throw new Error('noCQ: the sheet did not change as intended');
      return out;
    };
    const noCQsheet = sheet(noCQ);
    const nq = [];
    for (const ph of PHONES) for (const tx of TEXTS) nq.push({ ph: ph.name, tx: tx.name, ...(await measure(shell(HTML.finalNextDue.collapsed, { css: noCQsheet }), collapsedMeasure, { w: ph.w, h: ph.h, scale: tx.scale })) });
    assert(nq.every(r => r.ratio <= BUDGET && r.next === 'folded'), `[4h] N2 — an engine WITHOUT container queries (iOS 15): the Final card's short "Next" line is folded (the open card carries it) and the card stays within 33% on both phones at both text sizes (${nq.map(r => `${r.ph}/${r.tx}: ${r.next} ${(r.ratio * 100).toFixed(1)}%`).join('; ')})`);
    const noFallback = sheet(c => c.replace('@container (max-width:12.5em){.gd-next{display:none}}', ''));
    const nf2 = await measure(shell(HTML.finalNextDue.collapsed, { css: noFallback }), collapsedMeasure, { w: 375, h: 667, scale: 1.35 });
    assert(nf2.next === 'shown' && nf2.ratio > BUDGET, `[4i] anti-vacuity for [4h]: with no container query AND no fallback the card reads ${(nf2.ratio * 100).toFixed(1)}% > 33% at 375 x 667, 1.35x`);
    // DESIGN_D1_E: the fold is what keeps the non-entrant's Open card inside the cap, and the iOS 15 fallback does the same
    const jf = await measure(shell(JOIN.joinOpen.html, { css: noFold }), collapsedMeasure, { w: 375, h: 667, scale: 1.35 });
    assert(jf.next === 'shown' && jf.ratio > BUDGET, `[4j] without the fold rule the non-entrant's Open card (Join NFL picks) reads ${(jf.ratio * 100).toFixed(1)}% > 33% at 375 x 667, 1.35x — so [1m-1] measures the fold, not a constant`);
    const jq = [];
    for (const ph of PHONES) for (const tx of TEXTS) for (const name of Object.keys(JOIN)) jq.push({ name, ph: ph.name, tx: tx.name, ...(await measure(shell(JOIN[name].html, { css: noCQsheet }), collapsedMeasure, { w: ph.w, h: ph.h, scale: tx.scale })) });
    assert(jq.every(r => r.ratio <= BUDGET && r.next === 'folded'), `[4k] an engine WITHOUT container queries (iOS 15): the clause is folded at every size and the non-entrant's Open card stays within 33% on both phones at both text sizes (${jq.map(r => `${r.name}/${r.ph}/${r.tx}: ${(r.ratio * 100).toFixed(1)}%`).join('; ')})`);
    const scroller = sheet(c => c + '\n.gd-list{max-height:200px;overflow-y:auto}\n');
    const sc = await measure(shell(HTML.live9.open, { css: scroller }), openMeasure, { w: 375, h: 812 });
    assert(sc.scrollers > 0, '[4f] with a max-height and overflow-y on the row list the no-inner-scroller detector reads a scroller — so [2b] can fail');
  }
} catch (e) {
  fail++;
  console.error('  ❌ the engine run threw:', e && e.stack ? e.stack : e);
} finally {
  try { engine && engine.proc.kill(); } catch { /* gone */ }
}

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
