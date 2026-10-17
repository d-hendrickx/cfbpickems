/**
 * CFB Pickems — pushedscreentest.mjs (Deployment 1, Lane B, DI-571, 2026-10-07)
 * ============================================================================
 * The proof for js/pushed-screen.js, driven against a REAL element tree (minidom.mjs) so a node that is replaced is a different object and one that is
 * kept stays itself:
 *
 *   [1] Configuration — escHtml and isContentWithheld are required, never defaulted; a push is refused while content is withheld
 *   [2] Structure — one #pushed-root (data-hold-teardown), the level anatomy, Back's name, the title, escaping at the sink
 *   [3] The stack — covering a level makes it inert and remembers its scroll; uncovering restores both; the page is inert exactly once
 *   [4] Leaving — Back, Esc, an animated pop (transitionend and the fallback timer), Reduce Motion, closeAllScreens(identity | hold)
 *   [5] Live data — only the top level repaints, debounced; identical markup writes nothing; covered levels repaint on uncover; the gate is re-asked
 *   [6] iOS swipe-back — the edge drag follows the finger, a short slow drag springs back, a long one completes with no second animation
 *   [7] Shapes the screen must survive — a render that is null (skeleton) or throws (calm state), a root swept away from under the stack, a duplicate id
 *   [8] The exclusion lists + source pins
 *   [9] MUTATION PROOFS on scratch copies (never the file)
 *
 * Run:  node pushedscreentest.mjs     (no clock: every timer is injected)
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

// ── the world: a real tree, an injectable timer, and a switchable Reduce Motion ──
let doc;
let reduced = false;
const timers = [];
const fakeTimer = (fn, ms) => { timers.push({ fn, ms, live: true }); return timers.length - 1; };
const fakeClear = (id) => { if (timers[id]) timers[id].live = false; };
const runTimers = (filter = () => true) => { for (const t of timers.slice()) if (t.live && filter(t)) { t.live = false; t.fn(); } };
function freshWorld({ native = false } = {}) {
  doc = new MiniDocument();
  globalThis.document = doc;
  globalThis.window = globalThis;
  globalThis.innerWidth = 390;
  globalThis.matchMedia = (q) => ({ matches: /reduce/.test(q) ? reduced : false });
  globalThis.requestAnimationFrame = (fn) => fn();
  if (native) globalThis.Capacitor = { isNativePlatform: () => true }; else delete globalThis.Capacitor;
  timers.length = 0; reduced = false;
}
const escHtml = (s) => (s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));

const mkModule = async (src) => import('data:text/javascript;base64,' + Buffer.from(src).toString('base64') + '#' + Math.random());
const REAL = await import('./js/pushed-screen.js');

function setup(mod, o = {}) {
  const calls = { inert: [], mount: 0, blocked: false, withheld: false, closed: [] };
  mod._resetForTest();
  mod.configurePushedScreens({
    escHtml, isContentWithheld: () => calls.withheld, setPageInert: (on) => calls.inert.push(on), getBlocked: () => calls.blocked,
    onMount: () => { calls.mount++; }, setTimer: fakeTimer, clearTimer: fakeClear, ...(o.cfg || {}),
  });
  return calls;
}
const root = () => doc.getElementById('pushed-root');
const levels = () => (root() ? root().querySelectorAll('.ps-level') : []);
const push = (mod, id, extra = {}) => mod.pushScreen({ id, title: `T ${id}`, backLabel: 'Home', render: () => `<p id="b-${id}">body ${id}</p>`, ...extra });

// ═══ [1] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[1] Configuration…');
{
  freshWorld();
  REAL._resetForTest();
  let threw = 0;
  try { REAL.configurePushedScreens({ isContentWithheld: () => false }); } catch (e) { if (e instanceof TypeError && /escHtml/.test(e.message)) threw++; }
  try { REAL.configurePushedScreens({ escHtml }); } catch (e) { if (e instanceof TypeError && /isContentWithheld/.test(e.message)) threw++; }
  try { REAL.configurePushedScreens({ escHtml: 'nope', isContentWithheld: () => false }); } catch (e) { if (e instanceof TypeError) threw++; }
  assert(threw === 3, '1a: escHtml and isContentWithheld are REQUIRED functions — a missing or non-function one throws (a gate is never defaulted)');
  REAL._resetForTest();
  assert(REAL.pushScreen({ id: 'x', render: () => 'x' }) === false && !root(), '1b: an unconfigured shell opens nothing');
  const calls = setup(REAL);
  calls.withheld = true;
  assert(push(REAL, 'a') === false && !root() && !REAL.isScreenOpen(), '1c: content withheld = the push is REFUSED (no root, no inert) — Std-12');
  calls.withheld = false;
  assert(REAL.pushScreen({ title: 't', render: () => 'x' }) === false && REAL.pushScreen({ id: 'a', title: 't' }) === false && REAL.pushScreen() === false, '1d: no id or no render = refused, never a throw');
}

// ═══ [2] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[2] Structure…');
{
  freshWorld();
  const calls = setup(REAL);
  assert(push(REAL, 'card:1', { title: 'Final', backLabel: 'Home' }) === true && REAL.isScreenOpen() && REAL.topScreenId() === 'card:1' && REAL.screenDepth() === 1, '2a: a push opens one level');
  const r = root();
  assert(!!r && r.getAttribute('data-hold-teardown') === '' && doc.querySelectorAll('#pushed-root').length === 1, '2b: ONE root, carrying data-hold-teardown (swept by the hold teardown and the identity chokepoint — Std-12)');
  assert(calls.mount === 1, '2c: onMount heard the root once (the app binds the logo events there — the FB-021 rule)');
  const lv = levels()[0];
  assert(lv.getAttribute('data-ps-id') === 'card:1' && !!lv.querySelector('header.ps-nav') && !!lv.querySelector('[data-ps-body]'), '2d: level anatomy — a navigation bar over a body');
  const back = lv.querySelector('[data-ps-back]');
  assert(back.getAttribute('aria-label') === 'Back to Home' && back.textContent.includes('Home') && back.localName === 'button' && back.getAttribute('type') === 'button', '2e: Back is a real <button> named "Back to {previous screen}"');
  const title = lv.querySelector('.ps-title');
  assert(title.textContent === 'Final' && title.localName === 'h2' && title.getAttribute('tabindex') === '-1' && lv.getAttribute('aria-labelledby') === title.id, '2f: the title is an <h2>, programmatically focusable, and names the level (aria-labelledby)');
  assert(doc.activeElement === title, '2g: focus lands on the title on push (VoiceOver reads it first)');
  freshWorld(); setup(REAL);
  REAL.pushScreen({ id: 'x', title: '<img src=x onerror=alert(1)>', backLabel: '"><script>', render: () => '<b>ok</b>' });
  const lvl = root().querySelector('.ps-level');
  assert(!lvl.querySelector('img') && !lvl.querySelector('script') && lvl.querySelector('.ps-title').textContent === '<img src=x onerror=alert(1)>' && lvl.querySelector('[data-ps-back]').getAttribute('aria-label') === 'Back to "><script>' && !!lvl.querySelector('b'),
    '2h: the title and the Back label are escaped at the sink (text and an attribute value, no element is created from them); the body is the render\'s own markup');
  freshWorld(); setup(REAL);
  REAL.pushScreen({ id: 'r', title: 'R', backLabel: 'Home', render: () => ({ html: '<p>b</p>', right: '<button id="rt">Edit</button>' }) });
  assert(!!root().querySelector('[data-ps-right] #rt') && root().querySelector('[data-ps-body]').innerHTML === '<p>b</p>', '2i: render may return { html, right } — the right slot carries a control');
}

// ═══ [3] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[3] The stack…');
{
  freshWorld();
  const calls = setup(REAL);
  push(REAL, 'a');
  assert(JSON.stringify(calls.inert) === '[true]', '3a: the page (main content, header, nav) is made inert on the FIRST push');
  root().querySelector('[data-ps-id="a"] [data-ps-body]').scrollTop = 321;
  push(REAL, 'b', { backLabel: 'T a' });
  const [la, lb] = levels();
  assert(JSON.stringify(calls.inert) === '[true]', '3b: a second level does not toggle the page inert again');
  assert(la.hasAttribute('inert') && la.getAttribute('aria-hidden') === 'true' && !lb.hasAttribute('inert'), '3c: the covered level is inert + aria-hidden; the top one is live');
  assert(REAL._stackForTest()[0].scrollTop === 321, '3d: the covered level\'s scroll position is remembered');
  assert(doc.querySelector('#b-a') !== null && levels().length === 2, '3e: the covered level stays IN the DOM (its state survives)');
  const bodyA = la.querySelector('[data-ps-body]');
  REAL.popScreen({ instant: true });
  const la2 = levels()[0];
  assert(la2 === la && la2 === la && !la2.hasAttribute('inert') && !la2.hasAttribute('aria-hidden'), '3f: popping uncovers the SAME node (not a rebuild) and lifts inert');
  assert(la2.querySelector('[data-ps-body]') === bodyA && bodyA.scrollTop === 321, '3g: its scroll position is restored exactly');
  assert(calls.inert.length === 1, '3h: the page stays inert while a level remains');
  REAL.popScreen({ instant: true });
  assert(!root() && !REAL.isScreenOpen() && JSON.stringify(calls.inert) === '[true,false]', '3i: popping the last level removes the root and lifts the page\'s inert');
  assert(REAL.popScreen() === false && REAL.topScreenId() === null, '3j: popping an empty stack is a quiet no-op');
}

// ═══ [4] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[4] Leaving…');
{
  freshWorld();
  let calls = setup(REAL);
  const closed = [];
  push(REAL, 'a', { onClose: (e) => closed.push(['a', e.reason]) });
  push(REAL, 'b', { onClose: (e) => closed.push(['b', e.reason]) });
  root().querySelector('[data-ps-id="b"] [data-ps-back]').click();
  runTimers();
  assert(closed.length === 1 && closed[0].join() === 'b,back' && REAL.topScreenId() === 'a', '4a: the Back button pops exactly one level (animated, via the fallback timer), and onClose hears "back"');
  freshWorld(); calls = setup(REAL);
  push(REAL, 'a'); push(REAL, 'b');
  doc.dispatchEvent({ type: 'keydown', key: 'Escape' });
  runTimers();
  assert(REAL.topScreenId() === 'a' && REAL.screenDepth() === 1, '4b: Esc closes the top level only');
  calls.blocked = true;
  doc.dispatchEvent({ type: 'keydown', key: 'Escape' });
  runTimers();
  assert(REAL.screenDepth() === 1, '4c: Esc is ignored while another surface (a sheet, a modal) is on top — it gets Esc first');
  calls.blocked = false;
  doc.dispatchEvent({ type: 'keydown', key: 'Enter' });
  assert(REAL.screenDepth() === 1, '4d: other keys do nothing');
  doc.dispatchEvent({ type: 'keydown', key: 'Escape' }); runTimers();
  assert(!REAL.isScreenOpen() && doc.listenerCount('keydown') === 0, '4e: the Esc listener goes with the last level (no leak)');
  // the animated pop waits for the transition
  freshWorld(); setup(REAL);
  push(REAL, 'a');
  const el = levels()[0];
  REAL.popScreen();
  assert(el.classList.contains('ps-level--leaving') && levels().length === 1 && el.hasAttribute('inert') && REAL.screenDepth() === 0, '4f: an animated pop slides the level out (class) and keeps it until the transition ends; it is inert meanwhile');
  el.dispatchEvent({ type: 'transitionend', bubbles: false });
  assert(levels().length === 0 && !root(), '4g: transitionend removes it (and the empty root)');
  freshWorld(); setup(REAL);
  push(REAL, 'a'); REAL.popScreen(); runTimers(t => t.ms === REAL.EXIT_FALLBACK_MS);
  assert(!root(), '4h: with no transitionend the bounded fallback timer still removes it');
  // reduce motion: no slide at all
  freshWorld(); reduced = true; setup(REAL);
  push(REAL, 'a');
  assert(!levels()[0].classList.contains('ps-level--entering'), '4i: Reduce Motion — a level never starts off-screen (no slide in)');
  REAL.popScreen();
  assert(!root(), '4j: Reduce Motion — it leaves at once (no slide out, no waiting on a transition)');
  // motion on: the entering class is dropped on the next frame
  freshWorld(); setup(REAL);
  globalThis.requestAnimationFrame = (fn) => { setTimeout(fn, 0); };
  push(REAL, 'a');
  assert(levels()[0].classList.contains('ps-level--entering'), '4k: with motion on, a level starts off-screen to the right…');
  await new Promise(r => setTimeout(r, 20));
  assert(!levels()[0].classList.contains('ps-level--entering'), '4l: …and settles in on the following frames');
  // closeAll
  freshWorld(); calls = setup(REAL);
  const cl = [];
  push(REAL, 'a', { onClose: (e) => cl.push(['a', e.reason]) }); push(REAL, 'b', { onClose: (e) => cl.push(['b', e.reason]) });
  REAL.closeAllScreens('identity');
  assert(!root() && !REAL.isScreenOpen() && cl.map(x => x.join()).join('|') === 'b,identity|a,identity', '4m: closeAllScreens("identity") removes every level at once; each onClose hears the reason (top first)');
  assert(calls.inert[calls.inert.length - 1] === false, '4n: …and lifts the page inert');
  assert(REAL.closeAllScreens('x') === false, '4o: closing with nothing open is a quiet no-op');
}

// ═══ [5] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[5] Live data…');
{
  freshWorld();
  let calls = setup(REAL);
  let n = 0, rendersA = 0, rendersB = 0;
  const data = { a: 'one', b: 'one' };
  REAL.pushScreen({ id: 'a', title: 'A', backLabel: 'Home', render: () => { rendersA++; return `<p>a ${data.a}</p>`; } });
  REAL.pushScreen({ id: 'b', title: 'B', backLabel: 'A', render: () => { rendersB++; return `<p>b ${data.b}</p>`; } });
  rendersA = 0; rendersB = 0;
  REAL.invalidateScreens(); REAL.invalidateScreens(); REAL.invalidateScreens();
  assert(timers.filter(t => t.live).length === 1 && timers[0].ms === REAL.REPAINT_DEBOUNCE_MS && REAL.REPAINT_DEBOUNCE_MS === 1000, '5a: a burst of invalidations schedules ONE repaint, 1 s out');
  assert(REAL._stackForTest()[0].stale === true && REAL._stackForTest()[1].stale === false, '5b: the covered level is marked stale; the top is not');
  const bodyB = levels()[1].querySelector('[data-ps-body]');
  const scribble = bodyB.innerHTML;
  runTimers();
  assert(rendersB === 1 && rendersA === 0, '5c: only the TOP level repaints; the covered one waits');
  assert(bodyB.innerHTML === scribble, '5d: identical markup writes NOTHING (the node and its text are untouched)');
  data.b = 'two'; bodyB.scrollTop = 77;
  REAL.invalidateScreens(); runTimers();
  assert(bodyB.innerHTML === '<p>b two</p>' && bodyB.scrollTop === 77, '5e: changed markup is patched into the same body and the scroll position is kept');
  data.a = 'two';
  REAL.popScreen({ instant: true });
  assert(levels()[0].querySelector('[data-ps-body]').innerHTML === '<p>a two</p>' && REAL._stackForTest()[0].stale === false, '5f: the stale covered level repaints when it is uncovered');
  // the gate is re-asked on every repaint
  freshWorld(); calls = setup(REAL);
  const gone = [];
  REAL.pushScreen({ id: 'g', title: 'G', backLabel: 'Home', render: () => '<p>x</p>', onClose: (e) => gone.push(e.reason) });
  calls.withheld = true;
  REAL.invalidateScreens(); runTimers();
  assert(!root() && gone.join() === 'withheld', '5g: a repaint while content is withheld CLOSES the screen (the gate is re-asked every time, never trusted from open)');
  // a repaint parked under a finger
  freshWorld({ native: true }); calls = setup(REAL);
  REAL.pushScreen({ id: 'p', title: 'P', backLabel: 'Home', render: () => `<p>${n}</p>` });
  root().dispatchEvent({ type: 'touchstart', touches: [{ clientX: 5, clientY: 100 }] });
  root().dispatchEvent({ type: 'touchmove', touches: [{ clientX: 60, clientY: 102 }] });
  n = 1; REAL.invalidateScreens(); runTimers();
  assert(levels()[0].querySelector('[data-ps-body]').innerHTML === '<p>0</p>', '5h: a repaint never replaces the node under a finger that is dragging the screen');
  root().dispatchEvent({ type: 'touchend' });
  runTimers();
  REAL._resetForTest();
}

// ═══ [5b] ════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[5b] The in-place patch hook (DI-572(a), fix round 2)…');
{
  freshWorld();
  setup(REAL);
  const data = { v: 'one', r: 'r1' };
  const seen = [];
  let answer = true;
  const patch = (el, part) => {
    seen.push({ ...part, el });
    if (answer === 'throw') throw new Error('boom');
    if (answer !== true) return false;
    const t = el.querySelector('[data-bind="v"]'); if (t) t.textContent = data.v;     // a patch that changes the one text it owns
    if (part.part === 'right') el.firstElementChild.setAttribute('data-r', data.r);
    return true;
  };
  REAL.pushScreen({ id: 'pv', title: 'P', backLabel: 'Home', render: () => ({ html: `<div class="x"><b data-bind="v">${data.v}</b><i>keep</i></div>`, right: `<span data-r="${data.r}">s</span>` }), patch });
  const body = levels()[0].querySelector('[data-ps-body]'), right = levels()[0].querySelector('[data-ps-right]');
  const keep = body.querySelector('i'), b = body.querySelector('b'), rs = right.firstElementChild;
  body.scrollTop = 33;
  data.v = 'two'; data.r = 'r2';
  REAL.invalidateScreens(); runTimers();
  const bodyCall = seen.find((x) => x.part === 'body'), rightCall = seen.find((x) => x.part === 'right');
  assert(!!bodyCall && bodyCall.el === body && /one/.test(bodyCall.prevHtml) && /two/.test(bodyCall.html), '5i: a repaint hands the level\'s patch hook the BODY, the markup it drew last time and the markup it would draw now');
  assert(body.querySelector('i') === keep && body.querySelector('b') === b && b.textContent === 'two' && body.scrollTop === 33, '5j: a patch that says it managed is the whole update: no rewrite (the untouched node is the same object), the scroll offset is left alone');
  assert(!!rightCall && right.firstElementChild === rs && rs.getAttribute('data-r') === 'r2', '5k: …and the right slot goes through the hook too (part "right"), so a control in it is patched, not replaced');
  data.v = 'three'; answer = false; seen.length = 0;
  REAL.invalidateScreens(); runTimers();
  assert(seen.length >= 1 && body.querySelector('i') !== keep && body.querySelector('b').textContent === 'three', '5l: a hook that answers false gets the old whole write (nothing is lost)');
  const keep2 = body.querySelector('i');
  data.v = 'four'; answer = 'throw';
  const realErr = console.error; console.error = () => {};
  try { REAL.invalidateScreens(); runTimers(); } finally { console.error = realErr; }
  assert(body.querySelector('i') !== keep2 && body.querySelector('b').textContent === 'four', '5m: a hook that THROWS is a whole write as well, never a blank or a stale screen');
  // the stale level beneath goes through its hook when it is uncovered
  answer = true; seen.length = 0;
  REAL.pushScreen({ id: 'top', title: 'T', backLabel: 'P', render: () => '<p>t</p>' });
  data.v = 'five';
  REAL.invalidateScreens(); runTimers();
  const keep3 = body.querySelector('i');
  REAL.popScreen({ instant: true });
  assert(seen.some((x) => x.part === 'body' && x.el === body) && body.querySelector('i') === keep3 && body.querySelector('b').textContent === 'five', '5n: an uncovered STALE level is brought up to date through its hook too (in place)');
  REAL._resetForTest();
}

// ═══ [6] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[6] iOS swipe-back…');
const realNow = Date.now;
let fakeNow = 1_000_000;
Date.now = () => fakeNow;
{
  freshWorld({ native: true });
  let calls = setup(REAL);
  const closed = [];
  push(REAL, 'a'); push(REAL, 'b', { onClose: (e) => closed.push(e.reason) });
  const top = levels()[1];
  const T = (type, x, y, dt = 0) => { fakeNow += dt; root().dispatchEvent({ type, touches: type === 'touchend' ? [] : [{ clientX: x, clientY: y }] }); };
  T('touchstart', 4, 300); T('touchmove', 100, 304, 1200);
  assert(top.getAttribute('data-dragging') === 'true' && Number(top.style['--pushed-drag-x']) > 0.2 && Number(top.style['--pushed-drag-x']) < 0.3, '6a: the screen FOLLOWS the finger (--pushed-drag-x tracks the drag as a fraction of the width)');
  T('touchend');
  assert(top.style['--pushed-drag-x'] === '0' && !top.hasAttribute('data-dragging') && REAL.screenDepth() === 2, '6b: a short, slow drag springs back to 0 and nothing closes');
  // a long drag completes
  T('touchstart', 4, 300); T('touchmove', 150, 302, 1000); T('touchmove', 260, 303, 1000);
  T('touchend', 0, 0, 1000);
  assert(top.style['--pushed-drag-x'] === '1', '6c: past 40% the screen plays out the REST of the slide (the offset goes to 1 with the CSS transition)…');
  assert(REAL.screenDepth() === 2, '6d: …and does not vanish mid-slide');
  runTimers(t => t.ms === REAL.EXIT_FALLBACK_MS);
  assert(REAL.screenDepth() === 1 && closed.join() === 'back' && levels()[0].getAttribute('data-ps-id') === 'a', '6e: it pops once the slide has finished — one level, with no second animation');
  // blocked by another surface
  calls.blocked = true;
  T('touchstart', 4, 300); T('touchmove', 200, 302, 1000); T('touchend');
  assert(REAL.screenDepth() === 1 && !levels()[0].hasAttribute('data-dragging'), '6f: while another surface is on top the edge drag does not arm');
  calls.blocked = false;
  // a vertical scroll is not a dismiss
  T('touchstart', 200, 300); T('touchmove', 204, 380, 1000); T('touchend');
  assert(REAL.screenDepth() === 1, '6g: a vertical scroll never dismisses (the axis locks)');
  // a quick flick completes even a short drag (the shared 0.3 px/ms rule)
  T('touchstart', 4, 300); T('touchmove', 20, 301, 10); T('touchmove', 60, 302, 10); T('touchend');
  assert(levels()[0].style['--pushed-drag-x'] === '1', '6h: a FAST flick completes a short drag (40 px in 10 ms is past 0.3 px/ms)');
  runTimers(t => t.ms === REAL.EXIT_FALLBACK_MS);
  assert(!REAL.isScreenOpen(), '6h2: …and the screen is gone once the slide ends');
  REAL._resetForTest();
  // reduced motion: a completed swipe closes at once
  freshWorld({ native: true }); reduced = true; setup(REAL);
  push(REAL, 'a');
  fakeNow += 1000; root().dispatchEvent({ type: 'touchstart', touches: [{ clientX: 4, clientY: 300 }] }); fakeNow += 1000; root().dispatchEvent({ type: 'touchmove', touches: [{ clientX: 300, clientY: 301 }] }); root().dispatchEvent({ type: 'touchend', touches: [] });
  assert(!REAL.isScreenOpen(), '6i: Reduce Motion — a completed swipe closes at once');
  REAL._resetForTest();
  freshWorld(); setup(REAL); push(REAL, 'a');
  Date.now = realNow;
  assert(root().listenerCount('touchstart') === 0, '6j: on the web no touch listener is bound (the swipe is native-only; the Back button and Esc are the web paths — PBD-B1)');
}

// ═══ [7] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[7] Shapes the screen must survive…');
{
  freshWorld(); setup(REAL);
  REAL.pushScreen({ id: 'n', title: 'N', backLabel: 'Home', render: () => null });
  const sk = root().querySelector('[data-ps-body]').innerHTML;
  assert(/ps-skeleton/.test(sk) && /feed-skel-line/.test(sk) && !/spinner/i.test(sk) && /role="status"/.test(sk), '7a: a render that is not ready paints a SKELETON (and a polite "Loading" for VoiceOver) — never a blank page or a spinner');
  freshWorld(); setup(REAL);
  { const realErr = console.error; console.error = () => {}; REAL.pushScreen({ id: 't', title: 'T', backLabel: 'Home', render: () => { throw new Error('boom'); } }); console.error = realErr; }
  const bd = root().querySelector('[data-ps-body]').innerHTML;
  assert(/couldn't load/.test(bd) && /Tap Back/.test(bd) && !/boom/.test(bd), '7b: a throwing render becomes one calm line that says what to do next — no technical text — and Back still works');
  root().querySelector('[data-ps-back]').click(); runTimers();
  assert(!root(), '7c: …Back closes it');
  freshWorld(); setup(REAL);
  push(REAL, 'a'); push(REAL, 'b');
  const before = levels().length;
  assert(push(REAL, 'a') === true && REAL.topScreenId() === 'a' && REAL.screenDepth() === 1 && before === 2, '7d: pushing a screen already in the stack comes BACK to it (never a duplicate level)');
  freshWorld(); setup(REAL);
  push(REAL, 'a');
  root().remove();                                                   // a hold sweep that did not call us
  assert(push(REAL, 'z') === true && REAL.screenDepth() === 1 && REAL.topScreenId() === 'z' && doc.querySelectorAll('#pushed-root').length === 1, '7e: a root swept away from under a non-empty stack is a dead stack: it is dropped and the new push starts clean');
  freshWorld(); setup(REAL);
  const acts = [];
  push(REAL, 'a', { onClick: (e) => acts.push('a:' + (e.target.getAttribute('data-act') || '')), render: () => '<button data-act="x" id="ba">x</button>' });
  push(REAL, 'b', { onClick: (e) => acts.push('b:' + (e.target.getAttribute('data-act') || '')), render: () => '<button data-act="y" id="bb">y</button>' });
  doc.getElementById('ba').click(); doc.getElementById('bb').click();
  assert(acts.join() === 'b:y', '7f: a click reaches only the TOP level\'s handler; a covered level\'s controls are dead');
  freshWorld(); setup(REAL);
  push(REAL, 'o'); const opener = doc.createElement('div'); opener.setAttribute('data-card-key', 'game.final:L1:w9:-:g1'); const btn = doc.createElement('article'); btn.setAttribute('data-card-open', 'x'); btn.setAttribute('tabindex', '0'); opener.appendChild(btn); doc.body.appendChild(opener);
  REAL._resetForTest(); doc.getElementById('pushed-root')?.remove();
  setup(REAL);
  REAL.pushScreen({ id: 'c', title: 'C', backLabel: 'Home', restoreKey: 'game.final:L1:w9:-:g1', render: () => 'x' });
  REAL.popScreen({ instant: true });
  assert(doc.activeElement === btn, '7g: on Back, focus returns to the control that opened the screen (found by its data-card-key, keys with ":" and "." included)');
  freshWorld(); setup(REAL);
  push(REAL, 'a'); push(REAL, 'b', { restoreKey: 'gone' });
  REAL.popScreen({ instant: true });
  assert(doc.activeElement === levels()[0].querySelector('.ps-title'), '7h: if the opener is gone (the feed changed) focus lands on the title of the level beneath');
}

// ═══ [8] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[8] The exclusion lists and the source…');
{
  const SRC = await read('./js/pushed-screen.js');
  const code = stripComments(SRC);
  const imports = [...code.matchAll(/import\s+([\s\S]*?)\s+from\s+'([^']+)'/g)].map(m => m[2]);
  assert(imports.length === 2 && imports.includes('./nav-gestures.js') && imports.includes('./icons.js') && !imports.some(i => /app\.js/.test(i)), `8a: imports only nav-gestures.js and icons.js, never app.js (${imports.join(', ')}) — every app effect arrives as a callback`);
  assert(!/\blocalStorage\b|\bload\(|\bsave\(|fetch\(/.test(code), '8b: no storage, no network');
  const NG = await read('./js/nav-gestures.js');
  assert(/document\.getElementById\?\.\('pushed-root'\)\) return true/.test(NG), '8c: nav-gestures.js\'s gesturesSuspended() lists #pushed-root (no week swipe, drawer swipe or pull-to-refresh arms underneath)');
  const APP = await read('./js/app.js');
  assert(/getElementById\('pushed-root'\)\) return true/.test(APP) && /excludePushed/.test(APP), '8d: app.js\'s other-surface-on-top list names #pushed-root and gives the screen its own carve-out (excludePushed)');
  const CC = await read('./js/control-center.js');
  assert(/pushed-root/.test(CC), '8e: the control-center drawer\'s edge swipe is blocked while a pushed screen is up');
  assert(/z-index:150/.test(await read('./css/styles.css').then(c => c.slice(c.indexOf('#pushed-root{'), c.indexOf('#pushed-root{') + 160))), '8f: the root sits in the League overlay\'s z-index band (150: above the header and nav at 100, below .modal-overlay at 200)');
  assert(/\.ps-level\{[^}]*transform:translateX\(calc\(100% \* var\(--pushed-drag-x,0\)\)\)/.test(await read('./css/styles.css')), '8g: the level\'s transform is driven by --pushed-drag-x (the League recipe)');
  assert(/@media \(prefers-reduced-motion:reduce\)\{[^}]*\.ps-level\{transition:none\}/.test((await read('./css/styles.css')).replace(/\n\s*/g, '')), '8h: Reduce Motion removes the level\'s transition');
}

// ═══ [9] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[9] MUTATION PROOFS — scratch copies loaded as data: URLs (never the file)…');
{
  const SRC = await read('./js/pushed-screen.js');
  // The mutant module's relative imports must resolve: point them at the real files.
  const base = new URL('./js/', import.meta.url).href;
  const retarget = (src) => src.replace("from './nav-gestures.js'", `from '${base}nav-gestures.js'`).replace("from './icons.js'", `from '${base}icons.js'`);
  const probe = async (m) => {
    const out = {};
    freshWorld(); let c = setup(m);
    c.withheld = true; out.refusesWhenWithheld = m.pushScreen({ id: 'a', title: 'a', backLabel: 'h', render: () => 'x' }) === false; c.withheld = false;
    freshWorld(); c = setup(m);
    m.pushScreen({ id: 'a', title: 'a', backLabel: 'h', render: () => 'x' }); m.pushScreen({ id: 'b', title: 'b', backLabel: 'a', render: () => 'y' });
    const [la] = doc.querySelectorAll('.ps-level');
    out.coverInert = la.hasAttribute('inert') && la.getAttribute('aria-hidden') === 'true';
    out.pageInertOnce = c.inert.length === 1;
    m.popScreen({ instant: true });
    out.uncover = !la.hasAttribute('inert');
    m.popScreen({ instant: true });
    out.inertLifted = c.inert[c.inert.length - 1] === false && !doc.getElementById('pushed-root');
    freshWorld(); c = setup(m);
    const gone = []; m.pushScreen({ id: 'g', title: 'g', backLabel: 'h', render: () => 'x', onClose: (e) => gone.push(e.reason) });
    c.withheld = true; m.invalidateScreens(); runTimers();
    out.regate = !doc.getElementById('pushed-root') && gone.join() === 'withheld';
    freshWorld(); c = setup(m);
    let renders = 0; m.pushScreen({ id: 'a', title: 'a', backLabel: 'h', render: () => { renders++; return 'x'; } }); m.pushScreen({ id: 'b', title: 'b', backLabel: 'a', render: () => 'y' }); renders = 0;
    m.invalidateScreens(); runTimers();
    out.onlyTopRepaints = renders === 0;
    freshWorld(); c = setup(m);
    m.pushScreen({ id: 'a', title: 'a', backLabel: 'h', render: () => 'x' }); m.pushScreen({ id: 'b', title: 'b', backLabel: 'a', render: () => 'y' });
    doc.dispatchEvent({ type: 'keydown', key: 'Escape' }); runTimers();
    c.blocked = true; doc.dispatchEvent({ type: 'keydown', key: 'Escape' }); runTimers();
    out.escOnce = m.screenDepth() === 1;
    freshWorld(); c = setup(m);
    const acts = []; m.pushScreen({ id: 'a', title: 'a', backLabel: 'h', onClick: () => acts.push('a'), render: () => '<button id="ba">x</button>' }); m.pushScreen({ id: 'b', title: 'b', backLabel: 'a', onClick: () => acts.push('b'), render: () => '<button id="bb">y</button>' });
    doc.getElementById('ba').click(); doc.getElementById('bb').click();
    out.topOnlyClicks = acts.join() === 'b';
    freshWorld(); c = setup(m);
    m.pushScreen({ id: 'a', title: '<b>', backLabel: '<i>', render: () => 'x' });
    out.escapes = !doc.getElementById('pushed-root').querySelector('.ps-nav b') && !doc.getElementById('pushed-root').querySelector('.ps-nav i');
    freshWorld(); c = setup(m);
    m.pushScreen({ id: 'a', title: 'a', backLabel: 'h', render: () => 'x' }); m.pushScreen({ id: 'b', title: 'b', backLabel: 'a', render: () => 'y' });
    out.noDuplicate = m.pushScreen({ id: 'a', title: 'a', backLabel: 'h', render: () => 'x' }) === true && m.screenDepth() === 1;
    freshWorld(); c = setup(m);
    m.pushScreen({ id: 'a', title: 'a', backLabel: 'h', render: () => 'x' }); m.pushScreen({ id: 'b', title: 'b', backLabel: 'a', render: () => 'y' });
    const cl = []; m.closeAllScreens('identity'); out.closeAll = !doc.getElementById('pushed-root') && m.screenDepth() === 0;
    return out;
  };
  const baseRes = await probe(await mkModule(retarget(SRC)));
  assert(Object.values(baseRes).every(Boolean), `9-0: the probe is GREEN on a faithful copy of the real module (positive control: ${Object.entries(baseRes).filter(([, v]) => !v).map(([k]) => k).join(', ') || 'all pass'})`);
  const R = (a, b) => { const out = retarget(SRC).replace(a, b); return out; };
  const mutants = [
    ['a push is allowed while content is withheld', R("if (!cfg || withheld() || typeof id !== 'string'", "if (!cfg || typeof id !== 'string'"), 'refusesWhenWithheld'],
    ['a covered level is not made inert', R("below.el.setAttribute('inert', ''); below.el.setAttribute('aria-hidden', 'true');", ''), 'coverInert'],
    ['the page is toggled inert on every push', R("  } else {\n    try { cfg.setPageInert(true); } catch {}\n  }", "  }\n    try { cfg.setPageInert(true); } catch {}"), 'pageInertOnce'],
    ['an uncovered level stays inert', R("now.el.removeAttribute('inert'); now.el.removeAttribute('aria-hidden');", ''), 'uncover'],
    ['the page is never un-inerted', R("  try { cfg && cfg.setPageInert(false); } catch {}", ''), 'inertLifted'],
    ['a repaint skips the withheld re-check', R("if (withheld()) { closeAllScreens('withheld'); return false; }", ''), 'regate'],
    ['every level repaints on invalidate', R("for (let i = 0; i < stack.length - 1; i++) stack[i].stale = true;", "for (let i = 0; i < stack.length - 1; i++) { stack[i].stale = true; try { stack[i].render({}); } catch {} }"), 'onlyTopRepaints'],
    ['Esc ignores the other-surface block', R("  if (blocked) return;                                       // another surface (a sheet, a modal) is on top and gets Esc first\n", ''), 'escOnce'],
    ['a covered level\'s controls act', R("if (!t || !levelEl || levelEl !== t.el || !isFn(t.onClick)) return;", "if (!t || !levelEl || !isFn(t.onClick)) return;"), 'topOnlyClicks'],
    ['the title is not escaped', R("${e(level.title)}</h2>", "${level.title}</h2>"), 'escapes'],
    ['the same id stacks a duplicate', R("if (existing >= 0) {", "if (false) {"), 'noDuplicate'],
    ['closeAll leaves the root', R("  removeRootIfEmpty();\n  for (const l of levels.reverse())", "  for (const l of levels.reverse())"), 'closeAll'],
  ];
  for (const [name, src, check] of mutants) {
    let res;
    try { res = await probe(await mkModule(src)); } catch (e) { res = { [check]: false }; }
    assert(src !== retarget(SRC) && res[check] === false, `9: mutant "${name}" turns ${check} RED`);
  }
}

console.log(`\n══════════════════════════════════════════════════\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
