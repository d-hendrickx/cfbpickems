/**
 * CFB Pickems — gameday-dom.js (Deployment 1, Lane B, DI-603 / DI-604 / DI-605 rev 3, 2026-10-08)
 * ==============================================================================================
 * The DOM half of Game Day: what happens to the card's NODES when its markup changes. js/gameday.js and js/gameday-sheet.js decide WHAT the card says; js/home.js decides WHEN it repaints; this leaf
 * decides HOW the existing nodes become the new ones without the page moving, a pill blinking or a finger's pan being cancelled. It imports NOTHING (a leaf). Every app effect (the scroll
 * helper, the timer, the reduced-motion answer) arrives as a parameter, so a test can drive it.
 *
 *   swapGameDay(holder, html, env)     OPEN / CLOSE: the red card itself grows (or shrinks) in place. Measures the card, swaps the markup, measures again, then — unless Reduce Motion — animates the
 *                                      card's HEIGHT from the old to the new over --motion-modal (300 ms) on --ease-native: no overshoot, nothing stacked on it, `overflow: clip` while it runs,
 *                                      the final state `height: auto` (the inline height is cleared on `transitionend`, with a 420 ms backstop), so a text-size change never fights a fixed height. The new
 *                                      body fades in over the last 150 ms (100 ms delay). The page does not move: the scroll offset is read before and put back after (the scroller also carries
 *                                      `overflow-anchor: none`), so the card's top edge stays where it was and the feed below moves because the member tapped. Returns { from, to, animated }.
 *   patchGameDay(holder, html, env)    A DATA TICK: same kind, same open/closed. Patches the existing nodes — the header in place (the button keeps focus), the pill rail and the row list BY KEY
 *                                      (reconcileKeyed / patchNode below: a pill or row whose markup did not change is not touched, a changed one is patched IN PLACE; the rail node itself is never
 *                                      replaced, so its scrollLeft survives), the message and the footer only if they changed. Returns the patch counts for the tests.
 *   patchNode / reconcileKeyed         the generic prev -> next patcher both of the above use, and the Game view's in-place repaint (js/game-view.js's sections and data-bind hooks) uses too.
 *   writeAroundGameDay(feed, holder, items, prev, markup)   EVERY OTHER FEED ITEM, around the card's node (fix round 1, reviewer B3). When a game goes final its pill leaves AND a game.final card arrives in the same
 *                                      paint; the feed used to be rewritten whole, taking the card's nodes with it (focus lost, the rail's scrollLeft back to 0, a touch cancelled). Here the items are reconciled
 *                                      BY KEY around the card: an item whose markup did not change is not touched, a changed one is replaced, a new one is inserted (the caller's `markup(item, isNew)` builds the wrapper
 *                                      — escaped there), a gone one is removed, and the card's own node is NEVER moved, replaced or re-parsed.
 *   isGameDayOpen(holder) / gameDayKind(holder)   what the DOM currently shows.
 *   politeAnnouncer(env)           the ONE polite-announcement timing rule for Game Day and the Game view (DI-604 / DI-591 / DI-593, Std-7): debounced 1 s after the last change (a burst folds into one
 *                                      sentence group), never within 5 s of the previous announcement, HELD while the change it describes is parked under a finger, and spoken only if focus is still inside
 *                                      the surface when it fires (otherwise it is dropped). The caller supplies the clock, the focus test and the region to write.
 *
 * THE LEAVING PILL (DI-604): a game that ends leaves the rail with a 150 ms fade — patchGameDay marks its pill `data-leaving` (hidden from VoiceOver, out of the tab order; a focused one hands focus to its
 * neighbour first) and removes it when the fade is over; under Reduce Motion (or with no timer) it is removed at once. The pill's neighbours are never moved or replaced for it.
 *
 * Nothing here reads a pick, writes storage or knows what a week is.
 */

export const OPEN_FALLBACK_MS = 420;       // comfortably past --motion-modal (300 ms): the transitionend backstop (the pushed screen's own rule)
export const LEAVE_MS = 150;               // --motion-fast: a leaving pill's fade (css: .gdp[data-leaving="true"])
export const ANNOUNCE_DEBOUNCE_MS = 1000;  // Std-7: live regions are polite and debounced (>= 1 s) so a score tick never floods the reader
export const ANNOUNCE_THROTTLE_MS = 5000;  // DI-604: at most one announcement per 5 s
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

const gdOf = (holder) => (holder && typeof holder.querySelector === 'function' ? holder.querySelector('.gd') : null);
export function isGameDayOpen(holder) { const g = gdOf(holder); return !!g && g.getAttribute('data-gd-expanded') === 'true'; }
export function gameDayKind(holder) { const g = gdOf(holder); return g ? g.getAttribute('data-gd-kind') : null; }

function parse(html, holder) {
  const doc = holder.ownerDocument || (typeof document !== 'undefined' ? document : null);
  const box = doc.createElement('div');
  box.innerHTML = html;
  return box.querySelector('.gd');
}

/**
 * @param {Element} holder  the Home feed item that holds the card (`[data-card-key="now"]`)
 * @param {string} html     the finished card markup (it contains exactly one `.gd`)
 * @param {{reduced?:boolean, win?:Window, setTimer?:Function, clearTimer?:Function, restoreScroll?:(y:number)=>void}} env
 */
export function swapGameDay(holder, html, env = {}) {
  const win = env.win || (typeof window !== 'undefined' ? window : null);
  const cur = gdOf(holder);
  const from = cur ? num(cur.getBoundingClientRect().height) : 0;
  const y0 = win ? num(win.scrollY) : 0;
  holder.innerHTML = html;
  const gd = gdOf(holder);
  if (!gd) return { from, to: 0, animated: false };
  const to = num(gd.getBoundingClientRect().height);                       // this read lays the new markup out
  if (win && env.restoreScroll && Math.abs(num(win.scrollY) - y0) >= 1) env.restoreScroll(y0);   // belt over overflow-anchor: none — the page does not move because the card changed
  if (env.reduced === true || !from || !to || Math.abs(to - from) < 1) return { from, to, animated: false };
  const setTimer = env.setTimer || ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = env.clearTimer || ((t) => clearTimeout(t));
  gd.style.height = `${from}px`;
  gd.style.transition = 'none';
  void gd.offsetHeight;                                                    // commit the start height before the transition is switched on
  gd.setAttribute('data-gd-moving', 'true');
  gd.style.transition = 'height var(--motion-modal) var(--ease-native)';
  gd.style.height = `${to}px`;
  let finished = false, timer = null;
  const done = () => {
    if (finished) return;
    finished = true;
    try { gd.removeEventListener('transitionend', onEnd); } catch { /* detached */ }
    if (timer !== null) { try { clearTimer(timer); } catch { /* dead timer */ } }
    gd.style.height = ''; gd.style.transition = '';
    gd.removeAttribute('data-gd-moving');
  };
  const onEnd = (e) => { if (e && e.target === gd && e.propertyName === 'height') done(); };
  gd.addEventListener('transitionend', onEnd);
  timer = setTimer(done, OPEN_FALLBACK_MS);
  return { from, to, animated: true };
}

// ═══ THE PATCHER: bring the nodes on screen from what was drawn (PREV) to what is drawn now (NEXT), touching only what differs between the two ═══════════════════════════════════════
// Both sides are the app's own markup, parsed by the same engine, so "did it change" is a string comparison of two pristine trees — never of the live node, which carries runtime state the markup
// never had (a logo's `is-loaded`, a row's 1.4 s outline, a leaving pill's marks, focus). A node whose markup did not change is not touched; an element whose children kept their shape is patched child by
// child (so an <img> beside a changed score is the same node afterwards, DI-572); a list whose children all carry a key (`data-key`, or a pick chip's `data-player-id`) is reconciled BY KEY; only an element
// whose own text changed has its content rewritten. Attributes are synced from the prev -> next difference (a runtime class survives unless the markup itself changed that class).

const KEY_ATTRS = ['data-key', 'data-player-id', 'data-gv', 'data-card-key'];   // a list item's key: a row or pill, a pick chip, a Game view section, a feed card
const KEEP_ATTRS = new Set(['data-key', 'data-sig', 'data-leaving']);
const FOCUS_SEL = 'button, a[href], input, select, textarea, [tabindex]';
const keyOf = (el) => { if (!el || el.nodeType !== 1) return null; for (const a of KEY_ATTRS) { const v = el.getAttribute(a); if (v !== null && v !== '') return `${a}=${v}`; } return null; };
const elementsOf = (el) => Array.from((el && el.children) || []);
const nodesOf = (el) => Array.from((el && el.childNodes) || []);
const attrNamesOf = (el) => (typeof el.getAttributeNames === 'function' ? el.getAttributeNames() : Array.from(el.attributes || [], a => a.name));
const docOf = (el) => (el && el.ownerDocument) || (typeof document !== 'undefined' ? document : null);
const activeIn = (el) => { const d = docOf(el); const a = d ? d.activeElement : null; return a && (a === el || (typeof el.contains === 'function' && el.contains(a))) ? a : null; };
const focusQuietly = (el) => { try { if (el && typeof el.focus === 'function') el.focus({ preventScroll: true }); } catch { /* focus is a courtesy */ } };
/** The same control in a freshly drawn subtree: matched by its action / key attributes, never by position alone. */
function counterpart(fresh, was) {
  if (!fresh || !was) return null;
  for (const a of ['data-gv-action', 'data-home-action', 'data-key', 'data-player-id', 'id']) {
    const v = was.getAttribute(a);
    if (v === null) continue;
    if (fresh.getAttribute(a) === v) return fresh;
    const hit = Array.from(fresh.querySelectorAll(`[${a}]`)).find(n => n.getAttribute(a) === v);
    if (hit) return hit;
  }
  return fresh.matches && fresh.matches(FOCUS_SEL) ? fresh : null;
}
function syncAttrs(live, prev, next) {
  for (const a of attrNamesOf(next)) {
    if (KEEP_ATTRS.has(a)) continue;
    const v = next.getAttribute(a), was = prev.getAttribute(a);
    if (was === v) continue;
    if (a === 'class' && was !== null && live.classList) {                 // a class list diff: what the markup removed goes, what it added comes, a runtime class stays
      const before = new Set(String(was).split(/\s+/).filter(Boolean)), after = new Set(String(v).split(/\s+/).filter(Boolean));
      for (const c of before) if (!after.has(c)) live.classList.remove(c);
      for (const c of after) if (!before.has(c)) live.classList.add(c);
      continue;
    }
    live.setAttribute(a, v);
  }
  for (const a of attrNamesOf(prev)) if (!KEEP_ATTRS.has(a) && !next.hasAttribute(a)) live.removeAttribute(a);
}
function sameShape(a, b) {
  const x = nodesOf(a), y = nodesOf(b);
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) {
    const p = x[i], q = y[i];
    if (p.nodeType !== q.nodeType) return false;
    if (p.nodeType === 3 && p.data !== q.data) return false;
    if (p.nodeType === 1 && p.tagName !== q.tagName) return false;
  }
  return true;
}
const isKeyedList = (el) => { const kids = elementsOf(el); return kids.length > 0 && kids.every(k => keyOf(k)) && nodesOf(el).every(n => n.nodeType === 1 || (n.nodeType === 3 && !String(n.data).trim())); };
/** `live` is swapped for a fresh copy of `next`; focus inside it moves to the same control in the copy. */
function replaceNode(live, next, ctx) {
  const had = activeIn(live);
  const fresh = next.cloneNode(true);
  live.replaceWith(fresh);
  if (ctx) ctx.replaced = (ctx.replaced || 0) + 1;
  if (had) focusQuietly(counterpart(fresh, had) || (fresh.matches && fresh.matches(FOCUS_SEL) ? fresh : null));
  return fresh;
}
/** An element whose own text changed: its CONTENT is rewritten (the element itself stays; focus inside it goes to the same control again). */
function setContent(live, next, ctx) {
  const had = activeIn(live);
  live.innerHTML = next.innerHTML;
  if (ctx) ctx.rewritten = (ctx.rewritten || 0) + 1;
  if (had && had !== live) focusQuietly(counterpart(live, had));
}
/**
 * Brings `live` (drawn from `prev`) up to `next`. Never replaces `live` itself unless its tag changed. `ctx` collects counts (patched / rewritten / replaced / inserted / removed) and carries `leave(node)`
 * for a keyed list whose vanished items fade out (the rail) and `fallbackFocus` (where focus goes when the focused item vanishes).
 * @returns {Element} the node now standing where `live` was
 */
export function patchNode(live, prev, next, ctx = {}) {
  if (!live || !prev || !next) return live;
  if (prev.outerHTML === next.outerHTML) return live;
  if (live.tagName !== next.tagName || prev.tagName !== next.tagName) return replaceNode(live, next, ctx);
  syncAttrs(live, prev, next);
  ctx.patched = (ctx.patched || 0) + 1;
  if (prev.innerHTML === next.innerHTML) return live;
  if (isKeyedList(prev) && isKeyedList(next)) { reconcileKeyed(live, elementsOf(prev), elementsOf(next), ctx); return live; }
  const le = elementsOf(live), pe = elementsOf(prev), ne = elementsOf(next);
  if (sameShape(prev, next) && le.length === pe.length) { for (let i = 0; i < pe.length; i++) patchNode(le[i], pe[i], ne[i], ctx); return live; }
  setContent(live, next, ctx);
  return live;
}

/** Focus must never be left on (or fall from) a node that is going away: the next focusable sibling, else the previous one, else `fallback` (the card's header). */
function handFocusOff(node, fallback) {
  if (!activeIn(node)) return;
  const ok = (n) => !!n && n !== node && !n.hasAttribute('data-leaving') && typeof n.focus === 'function';
  let n = node.nextElementSibling;
  while (n && !ok(n)) n = n.nextElementSibling;
  if (!n) { n = node.previousElementSibling; while (n && !ok(n)) n = n.previousElementSibling; }
  focusQuietly(n || fallback || null);
}
const prevPlaced = (node) => { let p = node.previousElementSibling; while (p && p.hasAttribute('data-leaving')) p = p.previousElementSibling; return p || null; };
/**
 * A keyed list: `container`'s children were drawn from `prevKids`, and must become `nextKids`. Unchanged items are not touched, changed ones are patched in place (patchNode), new ones are inserted, gone ones
 * are removed — or, when `ctx.leave(node)` takes them, left to fade (a leaving node keeps its place and is never moved or patched). Nodes are moved only when out of order.
 */
export function reconcileKeyed(container, prevKids, nextKids, ctx = {}) {
  const prevBy = new Map(prevKids.map(k => [keyOf(k), k]));
  const liveBy = new Map();
  for (const c of elementsOf(container)) { const k = keyOf(c); if (k && !liveBy.has(k)) liveBy.set(k, c); }
  const want = new Set(nextKids.map(keyOf));
  for (const [k, node] of Array.from(liveBy)) {
    if (want.has(k)) continue;
    liveBy.delete(k);
    if (node.getAttribute('data-leaving') === 'true') continue;             // already fading
    if (typeof ctx.leave === 'function' && ctx.leave(node) === true) continue;
    handFocusOff(node, ctx.fallbackFocus);
    node.remove();
    ctx.removed = (ctx.removed || 0) + 1;
  }
  let cursor = null;
  const seen = new Set();
  for (const n of nextKids) {
    const k = keyOf(n);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    let node = liveBy.get(k) || null;
    if (node && node.getAttribute('data-leaving') === 'true') {              // back before it had gone: revived, and redrawn from the markup
      for (const a of ['data-leaving', 'aria-hidden', 'tabindex']) node.removeAttribute(a);
      node = replaceNode(node, n, ctx);
    } else if (node) {
      const p = prevBy.get(k);
      node = p ? patchNode(node, p, n, ctx) : replaceNode(node, n, ctx);
    } else {
      node = n.cloneNode(true);
      ctx.inserted = (ctx.inserted || 0) + 1;
      if (typeof ctx.onInsert === 'function') { try { ctx.onInsert(node); } catch { /* an entrance is decoration */ } }
    }
    if (node.parentNode !== container || prevPlaced(node) !== cursor) {
      const ref = cursor ? cursor.nextElementSibling : container.firstElementChild;
      if (ref !== node) container.insertBefore(node, ref || null);
    }
    cursor = node;
  }
  return ctx;
}

/** The rail's leaving rule (DI-604): a pill whose game is no longer live is marked for its 150 ms fade and removed when it is over. False (removed at once) under Reduce Motion or with no timer. */
function railLeaver(env, fallbackFocus) {
  if (!env || env.reduced === true || typeof env.setTimer !== 'function') return null;
  return (node) => {
    handFocusOff(node, fallbackFocus);
    node.setAttribute('data-leaving', 'true'); node.setAttribute('aria-hidden', 'true'); node.setAttribute('tabindex', '-1');
    // P-3: the removal is itself a deferral — a finger that lands on the rail during the fade must not have the pills shift under it, so a busy rail (`env.isBusy`: a touch, or still coasting) waits
    const remove = () => {
      if (node.getAttribute('data-leaving') !== 'true' || !node.parentNode) return;
      if (typeof env.isBusy === 'function' && env.isBusy() === true) { env.setTimer(remove, LEAVE_MS); return; }
      handFocusOff(node, fallbackFocus);
      node.remove();
    };
    env.setTimer(remove, LEAVE_MS + 30);
    return true;
  };
}

/**
 * A data tick. Returns the patch counts, or null when the card must be swapped instead (kind or open state changed, or a region appeared / vanished).
 * `env` = { prevHtml, reduced, setTimer, isBusy }: `prevHtml` is the card markup the screen was drawn from (js/home.js keeps it), so the comparison is markup to markup; without it the live card is read
 * back instead. `reduced` / `setTimer` drive the leaving pill's fade (DI-604); without them a leaving pill is removed at once. `isBusy()` (a finger on the rail, or the rail still coasting) holds the removal.
 */
export function patchGameDay(holder, html, env = {}) {
  const cur = gdOf(holder);
  const next = cur ? parse(html, holder) : null;
  if (!cur || !next) return null;
  if (cur.getAttribute('data-gd-kind') !== next.getAttribute('data-gd-kind') || cur.getAttribute('data-gd-expanded') !== next.getAttribute('data-gd-expanded')) return null;
  let prev = env && typeof env.prevHtml === 'string' && env.prevHtml ? parse(env.prevHtml, holder) : null;
  if (!prev || prev.getAttribute('data-gd-kind') !== cur.getAttribute('data-gd-kind') || prev.getAttribute('data-gd-expanded') !== cur.getAttribute('data-gd-expanded')) prev = parse(cur.outerHTML, holder);
  if (!prev) return null;
  const out = { head: false, rail: null, list: null, region: false };
  // the header: the same button node (it may hold focus); its content and spoken label follow
  const ch = cur.querySelector('.gd-head'), nh = next.querySelector('.gd-head'), ph = prev.querySelector('.gd-head');
  if (!ch || !nh || !ph || ch.tagName !== nh.tagName || ph.tagName !== nh.tagName) return null;
  if (ph.outerHTML !== nh.outerHTML) { patchNode(ch, ph, nh, {}); out.head = true; }
  // the body: a rail, a message or the open body — it must be the same region on both sides
  const sel = ['.gd-rail', '.gd-msg', '.gd-x'].find(s => cur.querySelector(s) || next.querySelector(s));
  if (!sel) return out;
  const cb = cur.querySelector(sel), nb = next.querySelector(sel), pb = prev.querySelector(sel);
  if (!cb || !nb || !pb) return null;
  if (sel === '.gd-rail') {
    // pills by key: the rail node (and its scrollLeft) stays, an unchanged pill is not touched, a changed one is patched in place, a pill whose game ended fades out where it is
    out.rail = reconcileKeyed(cb, elementsOf(pb), elementsOf(nb), { leave: railLeaver(env, ch), fallbackFocus: ch });
  } else if (sel === '.gd-x') {
    for (const part of ['.gd-sub', '.gd-stats', '.gd-foot']) {
      const a = cb.querySelector(part), b = nb.querySelector(part), pa = pb.querySelector(part);
      if (a && b && pa) { if (pa.outerHTML !== b.outerHTML) { patchNode(a, pa, b, {}); out.region = true; } }
      else if (a || b) return null;                                         // a region appeared or vanished: swap the whole body
    }
    const al = cb.querySelector('.gd-list'), bl = nb.querySelector('.gd-list'), pl = pb.querySelector('.gd-list');
    if (al && bl && pl) {
      // rows AND their group labels by key (the labels carry `data-key="lbl:…"`), so a label and its row stay together; a row is patched in place (its <button> keeps focus, its logos stay)
      out.list = reconcileKeyed(al, elementsOf(pl), elementsOf(bl), { fallbackFocus: cb.querySelector('#gd-h') });
    } else if (al || bl) return null;
    const ae = cb.querySelector('.gd-error'), be = nb.querySelector('.gd-error');
    if ((ae && !be) || (!ae && be)) return null;
  } else if (pb.outerHTML !== nb.outerHTML) { patchNode(cb, pb, nb, {}); out.region = true; }
  return out;
}

/**
 * @param {Element} feed     the `.home-feed` element
 * @param {Element} holder   the Game Day card's feed item (`[data-card-key="now"]`), a child of `feed`: it stays exactly where it is, as the same node
 * @param {{key:string, html:string}[]} items   EVERY item of the new paint, in order, the card's own included (keys unique)
 * @param {{htmls:Map<string,string>, keys:Set<string>}} prev   what was painted before (the markup per key, and the keys that were on screen)
 * @param {(item:{key:string,html:string}, isNew:boolean) => string} markup   the finished wrapper markup of one item (ONE root element carrying data-card-key), built and escaped by the caller
 */
export function writeAroundGameDay(feed, holder, items, prev, markup) {
  const doc = feed.ownerDocument || (typeof document !== 'undefined' ? document : null);
  const existing = new Map();
  for (const c of Array.from(feed.children || [])) { const k = typeof c.getAttribute === 'function' ? c.getAttribute('data-card-key') : null; if (k) existing.set(k, c); }
  const want = new Map(items.map(it => [it.key, it]));
  for (const [k, node] of Array.from(existing)) {                                          // gone, or changed: out (never the card)
    if (k === 'now') continue;
    const it = want.get(k);
    if (!it || prev.htmls.get(k) !== it.html) { node.remove(); existing.delete(k); }
  }
  const nodes = items.map((it) => {
    if (it.key === 'now') return holder;
    const kept = existing.get(it.key);
    if (kept) return kept;
    const box = doc.createElement('div');
    box.innerHTML = markup(it, !prev.keys.has(it.key));
    return box.firstElementChild;
  });
  const at = nodes.indexOf(holder);
  // a node already where it belongs is not touched at all (moving a node restarts its entrance animation); the card itself is never moved
  const place = (n, ref) => { if (n.parentNode === feed && n.classList) n.classList.remove('feed-item--enter'); feed.insertBefore(n, ref); };
  let ref = holder;
  for (let i = at - 1; i >= 0; i--) { const n = nodes[i]; if (n.parentNode !== feed || n.nextElementSibling !== ref) place(n, ref); ref = n; }
  ref = holder;
  for (let i = at + 1; i < nodes.length; i++) { const n = nodes[i]; if (n.parentNode !== feed || ref.nextElementSibling !== n) place(n, ref.nextElementSibling); ref = n; }
}

/**
 * DI-593: a CROSS-FADE of one small part (the Game view's status chip going Live -> Final): `apply()` brings `container`'s content up to date (in place); the content it had before stays on top as an
 * aria-hidden ghost in the same grid cell, fading out over 150 ms while the new content fades in, then the ghost is removed. Reduce Motion, no timer, or nothing changed: just `apply()`.
 * CSS: `.gv-xf` stacks its children in one cell; `.gv-xf-out` / `.gv-xf-in` are the two fades.
 */
export function crossFadePart(container, apply, env = {}) {
  if (!container || typeof apply !== 'function') return false;
  const before = container.innerHTML;
  if (env.reduced === true || typeof env.setTimer !== 'function') { apply(); return false; }
  const ghost = container.ownerDocument.createElement('span');
  ghost.className = 'gv-xf-ghost gv-xf-out';
  ghost.setAttribute('aria-hidden', 'true');
  ghost.innerHTML = before;
  apply();
  if (container.innerHTML === before) return false;
  for (const c of Array.from(container.children)) { if (c.classList) { c.classList.remove('gv-xf-in'); void c.offsetWidth; c.classList.add('gv-xf-in'); } }
  container.classList.add('gv-xf');
  container.appendChild(ghost);
  env.setTimer(() => { try { ghost.remove(); } catch { /* gone */ } }, LEAVE_MS + 30);
  return true;
}

/**
 * DI-572(a) — the Game view's IN-PLACE repaint (the pushed-screen `patch` hook; js/home.js hands it on). `prevHtml` is what the screen drew last time, `html` what it would draw now; both are the app's
 * own markup (js/game-view.js). The sections are reconciled by key (`data-gv`) and each one patched node by node: a score tick rewrites the score's text and nothing else, so the lockups' <img>s, the
 * focused button and the scroll offset are untouched; a section that appears (What's next, Related cards) is inserted and fades in (`gv-enter`); the status chip CROSS-FADES when it changes (DI-593).
 * A different game (the stepper) or the unavailable state is not patched (false: the shell writes it whole). The right slot (the prev / next pair) is patched the same way, so the button the reader
 * pressed keeps focus. `env` = { reduced, setTimer }.
 * @returns {boolean} true when patched in place
 */
export function patchGameView(el, { html, prevHtml, part } = {}, env = {}) {
  if (!el || typeof el.querySelector !== 'function' || typeof html !== 'string' || !html || typeof prevHtml !== 'string' || !prevHtml) return false;
  const doc = docOf(el);
  if (!doc) return false;
  const parseBox = (h) => { const box = doc.createElement('div'); box.innerHTML = h; return box; };
  const p = parseBox(prevHtml), n = parseBox(html);
  const only = (x) => (elementsOf(x).length === 1 ? x.firstElementChild : null);
  const lc = only(el), pc = only(p), nc = only(n);
  if (!lc || !pc || !nc || lc.tagName !== nc.tagName || pc.tagName !== nc.tagName) return false;
  const has = (x, c) => !!(x.classList && x.classList.contains(c));
  if (part === 'right') {
    if (!has(lc, 'gv-step') || !has(nc, 'gv-step') || !has(pc, 'gv-step')) return false;
    patchNode(lc, pc, nc, {});                                               // the same two buttons: their labels and disabled states follow, the nodes (and focus) stay
    return true;
  }
  const id = (x) => x.getAttribute('data-game-id');
  if (!has(lc, 'gv') || !has(nc, 'gv') || !has(pc, 'gv') || id(lc) !== id(nc) || id(pc) !== id(nc)) return false;
  const reduced = env && env.reduced === true;
  const ctx = { onInsert: (node) => { if (!reduced && node.classList) node.classList.add('gv-enter'); } };
  const status = lc.querySelector('[data-bind="status"]');
  const apply = () => reconcileKeyed(lc, elementsOf(pc), elementsOf(nc), ctx);
  if (status) crossFadePart(status, apply, { reduced, setTimer: env && env.setTimer }); else apply();
  return true;
}

/**
 * DI-591: the Game view's prev / next is a 150 ms CROSS-FADE of the body (no slide). The body's current content stays on top as an aria-hidden, inert ghost — the same box, the same scroll offset, the
 * screen's own background — fading out while `apply()` puts the next game underneath; the ghost is removed after the fade. Reduce Motion, no timer, or a body not in a level: just `apply()`.
 * CSS: `.ps-body-ghost`.
 */
export function crossFadeBody(body, apply, env = {}) {
  if (!body || typeof apply !== 'function') return false;
  const level = body.parentNode;
  if (env.reduced === true || typeof env.setTimer !== 'function' || !level || typeof level.insertBefore !== 'function') { apply(); return false; }
  const ghost = body.ownerDocument.createElement('div');
  ghost.className = 'ps-body ps-body-ghost';
  ghost.setAttribute('aria-hidden', 'true');
  ghost.setAttribute('inert', '');
  ghost.innerHTML = body.innerHTML;
  ghost.style.top = `${Number(body.offsetTop) || 0}px`;
  ghost.style.height = `${Number(body.clientHeight) || 0}px`;
  level.insertBefore(ghost, body.nextSibling || null);
  ghost.scrollTop = body.scrollTop || 0;
  apply();
  env.setTimer(() => { try { ghost.remove(); } catch { /* gone */ } }, LEAVE_MS + 30);
  return true;
}

/**
 * The polite announcer (DI-604 / DI-591 / DI-593, Std-7). `env`:
 *   setTimer(fn, ms) / clearTimer(id)   the app's timers (absent: nothing is ever announced — no timer means no debounce, and an undebounced live region is the thing Std-7 forbids)
 *   now()                               the clock the throttle is measured on
 *   canSpeak()                          is focus inside the surface right now? Asked when the announcement is due; false = the queued sentences are DROPPED, never spoken later
 *   isHeld()                            is the change this describes still parked (a finger on the rail)? true = wait another debounce period
 *   write(text)                         put the sentence group into the surface's polite live region
 * `note(sentences)` queues; the group is spoken 1 s after the LAST note, and never within 5 s of the previous announcement. `cancel()` drops everything (an identity change, the surface closing).
 */
export function politeAnnouncer(env = {}) {
  const e = env && typeof env === 'object' ? env : {};
  const debounceMs = Number.isFinite(e.debounceMs) ? e.debounceMs : ANNOUNCE_DEBOUNCE_MS;
  const throttleMs = Number.isFinite(e.throttleMs) ? e.throttleMs : ANNOUNCE_THROTTLE_MS;
  const ask = (fn) => { try { return typeof fn === 'function' && fn() === true; } catch { return false; } };
  let queue = [];
  let timer = null;
  let lastAt = null;
  const clear = () => { if (timer !== null) { try { e.clearTimer(timer); } catch { /* a dead timer */ } timer = null; } };
  const arm = (ms) => { clear(); timer = e.setTimer(fire, Math.max(0, ms)); };
  const sinceLast = () => (lastAt === null ? Infinity : Number(e.now()) - lastAt);
  function fire() {
    timer = null;
    if (!queue.length) return;
    if (ask(e.isHeld)) { arm(debounceMs); return; }                        // queued while parked: it speaks once the change is on screen
    const wait = throttleMs - sinceLast();
    if (wait > 0) { arm(wait); return; }
    const list = queue; queue = [];
    if (!ask(e.canSpeak)) return;                                          // the viewer is not in the surface: nothing is said
    const text = list.length <= 3 ? list.join(' ') : `${list.slice(0, 2).join(' ')} And ${list.length - 2} more games changed.`;
    lastAt = Number(e.now());
    try { e.write(text); } catch { /* a missing region is silence, never a throw */ }
  }
  return {
    note(sentences) {
      const list = (Array.isArray(sentences) ? sentences : [sentences]).filter(x => typeof x === 'string' && x !== '');
      if (!list.length || typeof e.setTimer !== 'function' || typeof e.now !== 'function') return false;
      queue.push(...list);
      arm(Math.max(debounceMs, throttleMs - sinceLast()));
      return true;
    },
    cancel() { clear(); queue = []; },
    pending: () => queue.slice(),
  };
}
