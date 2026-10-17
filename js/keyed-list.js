/**
 * CFB Pickems — keyed-list.js (Deployment 1, Lane B, DI-572 / PF-449 / PF-446 / PF-452, 2026-10-07)
 * ===============================================================================================
 * The two pieces every NEW list in this lane is built from, so that a refresh, a score tick or a status change can never make a logo blink again
 * (Drew, v0.29.0: "When I refresh, the logos all blank out for a fraction of a second and it looks glitchy" — FB-024):
 *
 *   teamLockupHTML({ name, abbr, rank, logoUrl, escHtml, size })
 *       A fixed 48 x 48 pt circle (`size: 'sm'`: the 24 pt inline lockup of a list row, no rank badge). The team's abbreviation is ALWAYS in the DOM and always visible when the logo is absent or has not loaded; the logo <img>
 *       (`alt=""` — the name is adjacent; `referrerpolicy="no-referrer"`; never a guessed URL) is drawn only when the caller passes a `logoUrl` it has already
 *       vetted (the Team-logos switch is on AND logoOk(url) passed — the shared render-path gate), fades in only if it was not already complete (an
 *       already-cached file appears with no fade: js/app.js's FB-024 cache primes `.is-loaded` + `.logo-instant`), and is NEVER recreated while the same team
 *       stays on screen. An AP-rank badge appears only when a rank exists (CFB). The box never changes size, so nothing shifts when the picture arrives.
 *       The <img> is the SHIPPED `matrix-hdr-logo` inside a `matrix-hdr-logo-box` (the Dashboard matrix header's logo path), so js/app.js's one logo binder
 *       (bindLogoImageEvents) already shows it on `load` (the dark-surface swap and the FB-024 loaded-file cache included) and, on `error`, adds `.logo-broken` to
 *       the box — which this lockup's CSS turns into "hide the broken-image glyph, leave the abbreviation" (never a DOM text injection). No binder change, no
 *       sixth logo class. Any root that renders a lockup binds the logo events once (the pushed-screen shell does, on mount — the FB-021 rule).
 *
 *   patchKeyedRows(container, rows)
 *       Reconciles a container's rows BY KEY instead of rebuilding it. `rows` is `[{ key, html, sig?, bind? }]`: a stable key per row (a game id, a card id);
 *       `html` the row's whole markup (ONE root element carrying `data-key`); `sig` an optional change signature (default: the html itself); `bind` an optional
 *       `{ [name]: { text?, class?, attrs? } }` map of in-place patches for `[data-bind="name"]` descendants. A row whose signature is unchanged is not touched; a
 *       row with a `bind` map is patched IN PLACE (text and class, so an <img> inside it is the same node afterwards); only a row with no `bind` map and a new
 *       signature is replaced whole. New rows are inserted, vanished rows removed, and nodes are moved only when out of order. Returns the counts, for the tests.
 *
 * Pure of the app: no storage, no imports. The DOM it touches is the container it is handed.
 */

const ABBR_MAX = 5;

/** The 48 pt team lockup. `escHtml` is REQUIRED (there is no String() fallback — CONVENTIONS #12). */
export function teamLockupHTML({ name = '', abbr = '', rank = null, logoUrl = null, escHtml, size = 'md' } = {}) {
  if (typeof escHtml !== 'function') throw new TypeError('teamLockupHTML() requires an injected escHtml function (CONVENTIONS #12)');
  const short = String(abbr || name || '').trim().slice(0, ABBR_MAX).toUpperCase();
  const small = size === 'sm';                                             // the inline 24 pt lockup of a list row (Game Day's open card); no rank badge at that size
  const ranked = !small && Number.isInteger(Number(rank)) && Number(rank) > 0 && Number(rank) <= 99;
  const img = typeof logoUrl === 'string' && /^https:\/\//i.test(logoUrl)
    ? `<span class="matrix-hdr-logo-box tl-box"><img class="matrix-hdr-logo" src="${escHtml(logoUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>` : '';
  return `<span class="tl${small ? ' tl--sm' : ''}" data-team-lockup aria-hidden="true">${img}<span class="tl-abbr">${escHtml(short)}</span>${ranked ? `<span class="tl-rank">${escHtml(String(Number(rank)))}</span>` : ''}</span>`;
}

function sigOf(row) { return typeof row.sig === 'string' ? row.sig : String(row.html); }

function nodeFromHtml(container, html) {
  const doc = container.ownerDocument || (typeof document !== 'undefined' ? document : null);
  const holder = doc.createElement('div');
  holder.innerHTML = html;
  return holder.firstElementChild;
}

/**
 * Which attributes a `bind` patch may set (security F5 / O2): DENY BY DEFAULT. Only `aria-*`, `title` and `data-*` — the things a live row's accessibility name and state hooks need. Never an event handler
 * (`on*`), a URL (`href`, `src`, `srcset`, `action`, `formaction`, `xlink:href`), `style`, `class` (that has its own `class` field) or anything else; and never the reconciler's own bookkeeping
 * (`data-key`, `data-sig`, `data-bind`), which a patch must not be able to rewrite. A refused attribute is skipped silently (the rest of the patch still applies).
 */
const ATTR_ALLOWED = /^(?:aria-[a-z][a-z0-9-]*|title|data-[a-z][a-z0-9-]*)$/;
const ATTR_RESERVED = new Set(['data-key', 'data-sig', 'data-bind']);
export function isPatchableAttr(name) { return typeof name === 'string' && ATTR_ALLOWED.test(name) && !ATTR_RESERVED.has(name); }

/** Applies one row's `bind` patches to `node` in place. Returns whether anything changed. */
function applyBind(node, bind) {
  let changed = false;
  for (const name of Object.keys(bind || {})) {
    if (!/^[A-Za-z0-9_-]+$/.test(name)) continue;                          // the name is spliced into a selector: a code-supplied word, never markup
    const spec = bind[name] || {};
    const el = node.querySelector(`[data-bind="${name}"]`);
    if (!el) continue;
    if (typeof spec.text === 'string' && el.textContent !== spec.text) { el.textContent = spec.text; changed = true; }
    if (typeof spec.class === 'string' && el.getAttribute('class') !== spec.class) { el.setAttribute('class', spec.class); changed = true; }
    if (spec.attrs && typeof spec.attrs === 'object') {
      for (const a of Object.keys(spec.attrs)) { if (!isPatchableAttr(a)) continue; const v = String(spec.attrs[a]); if (el.getAttribute(a) !== v) { el.setAttribute(a, v); changed = true; } }
    }
  }
  return changed;
}

export function patchKeyedRows(container, rows) {
  const stats = { added: 0, removed: 0, patched: 0, replaced: 0, moved: 0, unchanged: 0 };
  if (!container) return stats;
  const want = (Array.isArray(rows) ? rows : []).filter(r => r && typeof r.key === 'string' && r.key !== '' && typeof r.html === 'string');
  const seen = new Set();
  const uniq = want.filter(r => { if (seen.has(r.key)) return false; seen.add(r.key); return true; });    // a duplicate key renders once
  const existing = new Map();
  for (const child of Array.from(container.children || [])) {
    const k = child.getAttribute('data-key');
    if (k !== null) existing.set(k, child); else child.remove();
  }
  for (const [k, node] of existing) if (!seen.has(k)) { node.remove(); existing.delete(k); stats.removed++; }
  let cursor = null;                                                      // the node the next row must follow
  for (const row of uniq) {
    let node = existing.get(row.key) || null;
    const sig = sigOf(row);
    if (!node) {
      node = nodeFromHtml(container, row.html);
      if (!node) continue;
      node.setAttribute('data-key', row.key); node.setAttribute('data-sig', sig);
      stats.added++;
    } else if (node.getAttribute('data-sig') !== sig) {
      if (row.bind && typeof row.bind === 'object') {
        if (applyBind(node, row.bind)) stats.patched++; else stats.unchanged++;
        node.setAttribute('data-sig', sig);
      } else {
        const fresh = nodeFromHtml(container, row.html);
        if (fresh) { fresh.setAttribute('data-key', row.key); fresh.setAttribute('data-sig', sig); container.replaceChild(fresh, node); node = fresh; stats.replaced++; }
      }
    } else {
      stats.unchanged++;
    }
    // position: after `cursor` (or first)
    const shouldBeAfter = cursor;
    const prev = node.previousElementSibling || null;
    const placed = node.parentNode === container && (shouldBeAfter === null ? container.firstElementChild === node : prev === shouldBeAfter);
    if (!placed) {
      const ref = shouldBeAfter === null ? container.firstElementChild : shouldBeAfter.nextElementSibling;
      if (ref === node) { /* already there */ }
      else { container.insertBefore(node, ref || null); if (existing.has(row.key)) stats.moved++; }
    }
    cursor = node;
  }
  return stats;
}
