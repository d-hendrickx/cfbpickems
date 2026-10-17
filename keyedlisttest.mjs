/**
 * CFB Pickems — keyedlisttest.mjs (Deployment 1, Lane B, DI-572, 2026-10-07)
 * ==========================================================================
 * The proof for js/keyed-list.js — the two pieces every NEW list in the lane is built from, so a refresh or a score tick can never blink a logo again:
 *
 *   [1] teamLockupHTML — the abbreviation is ALWAYS in the DOM; the logo exists only for a vetted https URL; the rank only when it is a real rank; escaped at the sink
 *   [2] patchKeyedRows — insert, order, move, remove; an unchanged row is not touched; a `bind` patch changes text/class IN PLACE (the <img> inside is the SAME node);
 *       a row with no `bind` and a new signature is replaced whole; duplicates and junk are survived
 *   [3] The no-flash proof — ten score ticks add ZERO <img> nodes and replace none (the DI-572 verification, on a real element tree)
 *   [4] The CSS and the shared binder — the lockup rides the SHIPPED matrix-hdr-logo path (no sixth logo class), a broken logo leaves the abbreviation, 48 pt, Reduce Motion
 *   [5] MUTATION PROOFS on scratch copies (never the file)
 *
 * Run:  node keyedlisttest.mjs
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { MiniDocument } from './minidom.mjs';

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}
const read = (rel) => readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const esc = (s) => (s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));

const doc = new MiniDocument();
globalThis.document = doc;
const KL = await import('./js/keyed-list.js');
const SRC = await read('./js/keyed-list.js');
const { teamLockupHTML, patchKeyedRows, isPatchableAttr } = KL;
const mk = () => { const c = doc.createElement('div'); doc.body.appendChild(c); return c; };
const keys = (c) => c.children.map(n => n.getAttribute('data-key')).join(',');
const holder = (html) => { const h = doc.createElement('div'); h.innerHTML = html; return h; };
const URL1 = 'https://a.espncdn.com/i/teamlogos/ncaa/500/251.png';

// ═══ [1] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[1] teamLockupHTML…');
{
  let threw = false; try { teamLockupHTML({ name: 'x' }); } catch (e) { threw = e instanceof TypeError; }
  assert(threw, '1a: escHtml is REQUIRED — there is no String() fallback');
  const none = holder(teamLockupHTML({ name: 'Texas', abbr: 'tex', escHtml: esc }));
  assert(none.querySelector('.tl-abbr').textContent === 'TEX' && !none.querySelector('img') && !none.querySelector('.tl-rank'), '1b: no logo, no rank = the abbreviation alone (the shipped default — Team logos are opt-in)');
  const withLogo = holder(teamLockupHTML({ name: 'Texas', abbr: 'TEX', rank: 3, logoUrl: URL1, escHtml: esc }));
  const img = withLogo.querySelector('img');
  assert(!!withLogo.querySelector('.tl-abbr') && withLogo.querySelector('.tl-abbr').textContent === 'TEX', '1c: the abbreviation is STILL in the DOM when a logo is present (it is the fallback while the picture loads or if it fails)');
  assert(!!img && img.getAttribute('alt') === '' && img.getAttribute('referrerpolicy') === 'no-referrer' && img.getAttribute('src') === URL1 && img.classList.contains('matrix-hdr-logo') && !!img.closest('.matrix-hdr-logo-box'), '1d: the logo is alt="" (the name is adjacent), no-referrer, and is the SHIPPED matrix-hdr-logo inside its box');
  assert(withLogo.querySelector('.tl-rank').textContent === '3', '1e: an AP rank shows as a badge');
  for (const bad of [0, -1, 100, 2.5, 'x', null, undefined]) assert(!holder(teamLockupHTML({ name: 'T', abbr: 'T', rank: bad, escHtml: esc })).querySelector('.tl-rank'), `1f: rank ${JSON.stringify(bad)} draws no badge`);
  for (const bad of ['http://a.com/x.png', 'javascript:alert(1)', '//a.com/x.png', 'data:image/png;base64,AAAA', '', null, 42]) assert(!holder(teamLockupHTML({ name: 'T', abbr: 'T', logoUrl: bad, escHtml: esc })).querySelector('img'), `1g: logoUrl ${JSON.stringify(bad)} draws NO image (https only; the caller has vetted it, this is the belt)`);
  const evil = holder(teamLockupHTML({ name: '<b>x</b>', abbr: '<img src=x onerror=1>', logoUrl: 'https://a.com/"onerror="1', escHtml: esc }));
  assert(!evil.querySelector('b') && evil.querySelectorAll('img').length === 1 && !evil.querySelector('img').hasAttribute('onerror') && evil.querySelector('.tl-abbr').textContent.length <= 5, '1h: every dynamic string is escaped (an abbreviation is cut to five characters; an attribute cannot be broken out of)');
  assert(holder(teamLockupHTML({ name: 'Texas A&M', abbr: '', escHtml: esc })).querySelector('.tl-abbr').textContent === 'TEXAS', '1i: with no abbreviation it falls back to the first letters of the name');
  assert(holder(teamLockupHTML({ name: 'T', abbr: 'T', escHtml: esc })).querySelector('.tl').getAttribute('aria-hidden') === 'true', '1j: the lockup is decorative to VoiceOver (the team name is read from the adjacent text)');
}

// ═══ [2] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[2] patchKeyedRows…');
{
  const row = (k, text = k, extra = '') => ({ key: k, html: `<li data-key="${k}"><span data-bind="score">${text}</span><img class="matrix-hdr-logo" src="${URL1}" alt="">${extra}</li>` });
  const c = mk();
  let st = patchKeyedRows(c, [row('a'), row('b'), row('c')]);
  assert(keys(c) === 'a,b,c' && st.added === 3 && st.removed === 0, '2a: first paint inserts every row in order');
  const [na, nb, nc] = c.children;
  st = patchKeyedRows(c, [row('a'), row('b'), row('c')]);
  assert(st.unchanged === 3 && st.added + st.replaced + st.patched + st.moved === 0 && c.children[0] === na && c.children[1] === nb, '2b: an identical repaint touches NOTHING (same nodes, no writes)');
  st = patchKeyedRows(c, [row('c'), row('a'), row('b')]);
  assert(keys(c) === 'c,a,b' && c.children[1] === na && c.children[0] === nc && st.added === 0 && st.replaced === 0, '2c: a reorder MOVES the existing nodes (the same objects)');
  st = patchKeyedRows(c, [row('c'), row('b')]);
  assert(keys(c) === 'c,b' && st.removed === 1 && c.children[1] === nb, '2d: a vanished row is removed; the others stay themselves');
  st = patchKeyedRows(c, [row('c'), row('x'), row('b')]);
  assert(keys(c) === 'c,x,b' && st.added === 1 && c.children[0] === nc && c.children[2] === nb, '2e: a new row slots in at its place');
  // bind: patched in place
  const img = nc.querySelector('img');
  st = patchKeyedRows(c, [{ ...row('c'), sig: 's2', bind: { score: { text: '21–14', class: 'is-final' } } }, row('x'), row('b')]);
  assert(st.patched === 1 && c.children[0] === nc && nc.querySelector('[data-bind="score"]').textContent === '21–14' && nc.querySelector('[data-bind="score"]').getAttribute('class') === 'is-final', '2f: a `bind` patch changes text and class IN PLACE');
  assert(nc.querySelector('img') === img, '2g: …and the <img> inside the row is the SAME node afterwards (a logo cannot blink)');
  st = patchKeyedRows(c, [{ ...row('c'), sig: 's2', bind: { score: { text: '21–14', class: 'is-final' } } }, row('x'), row('b')]);
  assert(st.unchanged === 3 && st.patched === 0, '2h: the same signature again is a no-op');
  st = patchKeyedRows(c, [{ ...row('c', 'NEW'), sig: 's3' }, row('x'), row('b')]);
  assert(st.replaced === 1 && c.children[0] !== nc && c.children[0].querySelector('[data-bind="score"]').textContent === 'NEW', '2i: a row with a new signature and NO bind map is replaced whole');
  assert(c.children[0].getAttribute('data-key') === 'c' && c.children[0].getAttribute('data-sig') === 's3', '2j: the replacement carries the key and the signature');
  const c2 = mk();
  patchKeyedRows(c2, [row('a'), row('a'), row('b')]);
  assert(keys(c2) === 'a,b', '2k: a duplicate key renders once');
  patchKeyedRows(c2, [null, {}, { key: '', html: '<li></li>' }, { key: 'z' }, row('b')]);
  assert(keys(c2) === 'b', '2l: junk rows (no key / no html) are ignored; the container is reconciled to what is valid');
  const c3 = mk(); c3.innerHTML = '<li data-key="p">p</li><li>stray</li>';
  patchKeyedRows(c3, [row('p'), row('q')]);
  assert(keys(c3) === 'p,q' && c3.children.length === 2, '2m: a child with no data-key is removed');
  assert(patchKeyedRows(null, [row('a')]).added === 0 && patchKeyedRows(mk(), null).added === 0, '2n: no container / no rows never throws');
  const c4 = mk();
  patchKeyedRows(c4, [row('a', 'a', '<b>1</b>')]);
  patchKeyedRows(c4, [{ ...row('a'), sig: 'q', bind: { missing: { text: 'x' } } }]);
  assert(c4.children.length === 1 && c4.children[0].getAttribute('data-key') === 'a', '2o: a bind target that is not there changes nothing and does not throw');
}

// ═══ [3] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[3] The no-flash proof…');
{
  const c = mk();
  const mkRow = (id, a, h) => ({
    key: id, sig: `${a}-${h}`,
    html: `<div data-key="${id}">${teamLockupHTML({ name: 'Away', abbr: 'AWY', logoUrl: URL1, escHtml: esc })}<span data-bind="score">${a}–${h}</span>${teamLockupHTML({ name: 'Home', abbr: 'HOM', logoUrl: URL1, escHtml: esc })}</div>`,
    bind: { score: { text: `${a}–${h}` } },
  });
  patchKeyedRows(c, [mkRow('g1', 0, 0), mkRow('g2', 0, 0)]);
  const imgsBefore = c.querySelectorAll('img');
  let added = 0, replaced = 0, patched = 0;
  for (let i = 1; i <= 10; i++) { const st = patchKeyedRows(c, [mkRow('g1', i, i - 1), mkRow('g2', i * 2, i)]); added += st.added; replaced += st.replaced; patched += st.patched; }
  const imgsAfter = c.querySelectorAll('img');
  assert(added === 0 && replaced === 0 && patched === 20, `3a: ten score ticks over two rows = 20 in-place patches, ZERO <img> additions, ZERO replaced rows (added ${added}, replaced ${replaced}, patched ${patched})`);
  assert(imgsAfter.length === 4 && imgsAfter.every((n, i) => n === imgsBefore[i]), '3b: every one of the four logo <img> nodes is the identical object after the ten ticks');
  assert(c.querySelectorAll('[data-bind="score"]')[1].textContent === '20–10', '3c: …and the scores did change (the proof is not vacuous)');
}

// ═══ [4] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[4] The CSS and the shared binder…');
{
  const CSS = await read('./css/styles.css');
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (sel) => { const o = []; for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (m[1].split(',').some(s => s.trim() === sel)) o.push(m[2]); return o.join(';'); };
  assert(/width:48px/.test(rule('.tl')) && /height:48px/.test(rule('.tl')) && /border-radius:50%/.test(rule('.tl')), '4a: the lockup is a fixed 48 x 48 circle (no layout shift when the picture arrives)');
  assert(/display:flex/.test(rule('.tl-box.matrix-hdr-logo-box.logo-broken')) && /display:none/.test(rule('.tl-box.logo-broken .matrix-hdr-logo')), '4b: a broken logo hides the picture and KEEPS the abbreviation (the shipped rule would have hidden the whole box)');
  assert(/position:absolute/.test(rule('.tl-box.matrix-hdr-logo-box')) && /inset:0/.test(rule('.tl-box.matrix-hdr-logo-box')), '4c: the logo box overlays the abbreviation inside the circle');
  assert(!/background/.test(rule('.tl-box.matrix-hdr-logo-box')) && /visibility:hidden/.test(rule('.tl-box:has(.is-loaded) ~ .tl-abbr')) && /background:transparent/.test(rule('.tl:has(.is-loaded)')), '4c2: SB-07 — no plate behind a logo: the logo box paints NO background, the circle\'s fill goes away once a logo has loaded, and the abbreviation hides behind it');
  assert(!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test([rule('.tl'), rule('.tl-abbr'), rule('.tl-rank'), rule('.tl-box.matrix-hdr-logo-box')].join(';')), '4d: tokens only — no colour literal in the lockup rules');
  const APP = await read('./js/app.js');
  const b0 = APP.indexOf('function bindLogoImageEvents(');
  const bind = APP.slice(b0, APP.indexOf('export const _bindLogoImageEventsForTest', b0));
  assert(/contains\('matrix-hdr-logo'\)/.test(bind) && /img\.closest\('\.matrix-hdr-logo-box'\)\?\.classList\.add\('logo-broken'\)/.test(bind), '4e: the shared binder\'s load arm and error arm already handle matrix-hdr-logo and mark its box `.logo-broken` — the lockup needs no binder change');
  assert(/const LOGO_VARIANT_CLASSES = Object\.freeze\(\['pick-btn-logo', 'dc-chip-logo', 'matrix-hdr-logo', 'slate-row-logo'\]\)/.test(APP), '4f: the binder\'s four-class list is unchanged (no fifth logo class was added for the lockup)');
}

// ═══ [5] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[5] MUTATION PROOFS — scratch copies loaded as data: URLs (never the file)…');
{
  const load = async (src) => import('data:text/javascript;base64,' + Buffer.from(src).toString('base64') + '#' + Math.random());
  const probe = (m) => {
    const c = mk();
    const row = (k, a, bind = true) => ({ key: k, sig: `s${a}`, html: `<div data-key="${k}"><span data-bind="n">${a}</span><img src="${URL1}"></div>`, ...(bind ? { bind: { n: { text: String(a) } } } : {}) });
    m.patchKeyedRows(c, [row('a', 0), row('b', 0)]);
    const img = c.querySelectorAll('img')[0];
    m.patchKeyedRows(c, [row('a', 1), row('b', 1)]);
    const inPlace = c.querySelectorAll('img')[0] === img && c.children[0].querySelector('[data-bind="n"]').textContent === '1';
    const before = c.children[0];
    m.patchKeyedRows(c, [row('a', 1), row('b', 1)]);
    const noop = c.children[0] === before;
    m.patchKeyedRows(c, [row('b', 1), row('a', 1)]);
    const ordered = c.children.map(n => n.getAttribute('data-key')).join() === 'b,a';
    m.patchKeyedRows(c, [row('b', 1)]);
    const removed = c.children.length === 1;
    m.patchKeyedRows(c, [row('z', 1), row('z', 1)]);
    const dedup = c.children.length === 1;
    const lock = holder(m.teamLockupHTML({ name: 'T', abbr: 'TEX', logoUrl: 'http://x.com/a.png', escHtml: esc }));
    const httpsOnly = !lock.querySelector('img');
    const abbr = !!holder(m.teamLockupHTML({ name: 'T', abbr: 'TEX', logoUrl: URL1, escHtml: esc })).querySelector('.tl-abbr');
    const esced = !holder(m.teamLockupHTML({ name: '<b>', abbr: '<b>x</b>', escHtml: esc })).querySelector('b');
    return { inPlace, noop, ordered, removed, dedup, httpsOnly, abbr, esced };
  };
  const base = probe(KL);
  assert(Object.values(base).every(Boolean), '5-0: the probe is GREEN on the real module (positive control)');
  const R = (a, b) => SRC.replace(a, b);
  const mutants = [
    ['a bind row is replaced instead of patched', R("if (row.bind && typeof row.bind === 'object') {", 'if (false) {'), 'inPlace'],
    ['an unchanged row is rewritten', R("} else {\n      stats.unchanged++;\n    }", "} else {\n      const fresh = nodeFromHtml(container, row.html); fresh.setAttribute('data-key', row.key); fresh.setAttribute('data-sig', sig); container.replaceChild(fresh, node); node = fresh; stats.replaced++;\n    }"), 'noop'],
    ['no reordering', R('if (!placed) {', 'if (false) {'), 'ordered'],
    ['vanished rows stay', R('if (!seen.has(k)) { node.remove(); existing.delete(k); stats.removed++; }', ''), 'removed'],
    ['duplicate keys render twice', R('if (seen.has(r.key)) return false; seen.add(r.key); return true;', 'return true;'), 'dedup'],
    ['any URL scheme gets a logo', R("/^https:\\/\\//i.test(logoUrl)", 'true'), 'httpsOnly'],
    ['the abbreviation is dropped', R('<span class="tl-abbr">${escHtml(short)}</span>', ''), 'abbr'],
    ['the abbreviation is not escaped', R('${escHtml(short)}', '${short}'), 'esced'],
  ];
  for (const [name, src, check] of mutants) {
    let res;
    try { res = probe(await load(src)); } catch (e) { res = { [check]: false }; }
    assert(src !== SRC && res[check] === false, `5: mutant "${name}" turns ${check} RED`);
  }
}
{
  const code = stripComments(SRC);
  assert(!/^\s*import\s/m.test(code) && !/\b(localStorage|fetch\(|Math\.random|Date\.now)/.test(code), '6: a pure leaf — no imports, storage, network, randomness or clock');
}

// ═══ [7] ═══════════════════════════════════════════════════════════════════════
console.log('\n[7] applyBind\'s attribute allow-list (security O2 / F5) — aria-*, title and data-* only; never a handler, a URL or style…');
{
  const load = async (src) => import('data:text/javascript;base64,' + Buffer.from(src).toString('base64') + '#' + Math.random());
  const patchOne = (m, attrs) => {
    const c = mk();
    const html = `<div data-key="a" id="rowa"><span data-bind="s" title="t0" aria-label="l0" data-state="d0">0</span><img data-bind="i" src="${URL1}" alt=""></div>`;
    m.patchKeyedRows(c, [{ key: 'a', sig: 's0', html, bind: { s: { text: '0' } } }]);
    const st = m.patchKeyedRows(c, [{ key: 'a', sig: 's1', html, bind: { s: { attrs }, i: { attrs } } }]);
    return { span: c.children[0].querySelector('[data-bind="s"]'), img: c.children[0].querySelector('[data-bind="i"]'), root: c.children[0], st };
  };
  const probe = (m) => {
    const o = {};
    const ok = patchOne(m, { 'aria-label': 'Final', 'aria-live': 'polite', title: 'T', 'data-state': 'final' });
    o.allowed = ok.span.getAttribute('aria-label') === 'Final' && ok.span.getAttribute('aria-live') === 'polite' && ok.span.getAttribute('title') === 'T' && ok.span.getAttribute('data-state') === 'final' && ok.st.patched === 1;
    const bad = patchOne(m, { onclick: 'alert(1)', onerror: 'alert(2)', onfocus: 'x', ONCLICK: 'y', href: 'javascript:alert(3)', src: 'https://evil.example/x.png', srcset: 'https://evil.example/y.png 1x', style: 'display:none', formaction: 'z', 'xlink:href': 'z', action: 'z', class: 'evil' });
    o.noHandlers = ['onclick', 'onerror', 'onfocus', 'ONCLICK'].every(a => bad.span.getAttribute(a) === null && bad.img.getAttribute(a) === null);
    o.noUrls = ['href', 'srcset', 'formaction', 'xlink:href', 'action'].every(a => bad.span.getAttribute(a) === null && bad.img.getAttribute(a) === null) && bad.img.getAttribute('src') === URL1 && bad.span.getAttribute('src') === null;
    o.noStyleClass = bad.span.getAttribute('style') === null && bad.img.getAttribute('style') === null && bad.span.getAttribute('class') === null;
    o.nothingChanged = bad.st.patched === 0 && bad.st.unchanged === 1;
    const other = patchOne(m, { id: 'x', role: 'button', tabindex: '0', for: 'y', 'aria-': 'a', 'data-': 'b', 'data-UPPER': 'c', 'aria-Label': 'd', '': 'e' });
    o.denyByDefault = ['id', 'role', 'tabindex', 'for', 'aria-', 'data-', 'data-UPPER', 'aria-Label'].every(a => other.span.getAttribute(a) === null) && other.span.getAttribute('id') === null && other.root.getAttribute('id') === 'rowa';
    const own = patchOne(m, { 'data-key': 'hijack', 'data-sig': 'x', 'data-bind': 'other' });
    o.bookkeeping = own.root.getAttribute('data-key') === 'a' && own.span.getAttribute('data-bind') === 's' && own.img.getAttribute('data-bind') === 'i' && own.span.getAttribute('data-key') === null;
    const c = mk();
    m.patchKeyedRows(c, [{ key: 'a', sig: 's0', html: '<div data-key="a"><b data-bind="x">1</b></div>', bind: { x: { text: '1' } } }]);
    let threw = false;
    try { m.patchKeyedRows(c, [{ key: 'a', sig: 's1', html: '<div data-key="a"><b data-bind="x">1</b></div>', bind: { 'x"] , [': { text: 'p' }, 'a b': { text: 'q' }, x: { text: '2' } } }]); } catch { threw = true; }
    o.selectorInjection = !threw && c.children[0].querySelector('[data-bind="x"]').textContent === '2';
    return o;
  };
  const baseRes = probe({ patchKeyedRows, isPatchableAttr: null });
  assert(Object.values(baseRes).every(Boolean), `7-0: the allow-list probe is GREEN on the real module (positive control: ${Object.entries(baseRes).filter(([, v]) => !v).map(([k]) => k).join(', ') || 'all pass'})`);
  assert(baseRes.allowed && baseRes.noHandlers && baseRes.noUrls && baseRes.noStyleClass && baseRes.nothingChanged, '7a: aria-*, title and data-* are patched in place; on*, href / src / srcset / formaction / action / xlink:href, style and class (in attrs) are refused, the <img> keeps its src, and a patch of only refused attributes changes nothing');
  assert(baseRes.denyByDefault && baseRes.bookkeeping && baseRes.selectorInjection, '7b: anything else is refused by default (id, role, tabindex, for, a bare "aria-" / "data-", upper-case names); the reconciler\'s own data-key / data-sig / data-bind cannot be rewritten; a bind name that is not a plain word is skipped without a throw');
  assert(isPatchableAttr('aria-label') && isPatchableAttr('data-x-y') && isPatchableAttr('title') && !isPatchableAttr('onclick') && !isPatchableAttr('data-key') && !isPatchableAttr('href') && !isPatchableAttr(null) && !isPatchableAttr(5), '7c: the exported predicate answers the same, and refuses non-strings');
  const RR = (a, b) => { if (SRC.split(a).length !== 2) throw new Error('mutation anchor must match exactly once: ' + a.slice(0, 60)); return SRC.replace(a, b); };
  const mutants = [
    ['the allow-list is gone (every attribute is patched)', RR('for (const a of Object.keys(spec.attrs)) { if (!isPatchableAttr(a)) continue; const v', 'for (const a of Object.keys(spec.attrs)) { const v'), ['noHandlers', 'noUrls', 'noStyleClass', 'denyByDefault', 'bookkeeping']],
    ['on* handlers are allowed (the regex admits any attribute starting with on)', RR('/^(?:aria-[a-z][a-z0-9-]*|title|data-[a-z][a-z0-9-]*)$/', '/^(?:aria-[a-z][a-z0-9-]*|title|on[a-z]+|data-[a-z][a-z0-9-]*)$/'), ['noHandlers']],
    ['href and src are allowed', RR('/^(?:aria-[a-z][a-z0-9-]*|title|data-[a-z][a-z0-9-]*)$/', '/^(?:aria-[a-z][a-z0-9-]*|title|href|src|data-[a-z][a-z0-9-]*)$/'), ['noUrls']],
    ['style is allowed', RR('/^(?:aria-[a-z][a-z0-9-]*|title|data-[a-z][a-z0-9-]*)$/', '/^(?:aria-[a-z][a-z0-9-]*|title|style|data-[a-z][a-z0-9-]*)$/'), ['noStyleClass']],
    ['the reconciler\'s bookkeeping attributes can be rewritten', RR("const ATTR_RESERVED = new Set(['data-key', 'data-sig', 'data-bind']);", 'const ATTR_RESERVED = new Set([]);'), ['bookkeeping']],
    ['upper-case and bare prefixes are admitted', RR('/^(?:aria-[a-z][a-z0-9-]*|title|data-[a-z][a-z0-9-]*)$/', '/^(?:aria-.*|title|data-.*)$/i'), ['denyByDefault']],
    ['the bind name is spliced into the selector unchecked', RR("    if (!/^[A-Za-z0-9_-]+$/.test(name)) continue;                          // the name is spliced into a selector: a code-supplied word, never markup\n", ''), ['selectorInjection']],
  ];
  for (const [name, src, checks] of mutants) {
    let res;
    try { const m = await load(src); res = probe({ patchKeyedRows: m.patchKeyedRows }); } catch (e) { res = Object.fromEntries(checks.map(c => [c, false])); }
    assert(src !== SRC && checks.every(c => res[c] === false), `7m: mutant "${name}" turns ${checks.join(' + ')} RED`);
  }
}

console.log(`\n══════════════════════════════════════════════════\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
