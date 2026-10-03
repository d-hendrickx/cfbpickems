/**
 * CFB Pickems — minidom.mjs (SP-53, 2026-10-01)
 * ==============================================
 * A MINIMAL, REAL DOM for the suites that must drive app.js's DOM wiring and watch what it does to the TREE (node identity across an in-place patch, which control exists, what a
 * delegated click reaches), which authtest's `FakeEl` registry cannot answer: it keys every element by its id, so a re-rendered node is "the same instance" and an identity assertion
 * proves nothing. This one builds an ACTUAL element tree from every `innerHTML` assignment, so a node that is replaced is a different object and one that is patched stays itself.
 *
 * What it is: an HTML tokenizer (tags, double- or single-quoted and bare attributes, text, comments, void and `/>`-closed elements, the five named entities and numeric ones), an element tree
 * with parent/children, `classList`, `dataset`, attributes, `value`/`disabled`/`hidden` properties, `textContent`, `innerHTML` (set parses, get serializes), `closest`/`matches`/
 * `querySelector(All)` over a small selector grammar (comma lists; descendant and child combinators; compound `tag#id.class[attr][attr="v"]`), `getElementById`, `focus`/`blur` with
 * `document.activeElement`, bubbling `dispatchEvent`, `remove`, `contains`, `isConnected`.
 *
 * What it is NOT: a browser. No layout, no CSS, no scrolling physics, no real events, no `:has`, and `:not()` only over one simple compound; attribute operators only `=`/presence. Anything that depends on those (motion, press
 * feedback, safe areas, the keyboard, VoiceOver) is a DEVICE check and is named as one in the handoff — never claimed from here.
 */

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => String(s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, g) => {
  if (g[0] === '#') { const n = g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return Object.prototype.hasOwnProperty.call(ENT, g) ? ENT[g] : m;
});
const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const camel = (k) => k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const kebab = (k) => k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

export class MiniText {
  constructor(text) { this.nodeType = 3; this.data = text; this.parentNode = null; }
  get textContent() { return this.data; }
  remove() { if (this.parentNode) this.parentNode._removeChild(this); }
}

export class MiniElement {
  constructor(doc, tag) {
    this.ownerDocument = doc; this.nodeType = 1;
    this.tagName = String(tag || 'div').toUpperCase(); this.localName = String(tag || 'div').toLowerCase();
    this.parentNode = null; this._children = []; this._attrs = new Map(); this._listeners = new Map();
    this._value = null; this.scrollTop = 0; this._style = null;
  }
  // ── tree ──
  get childNodes() { return this._children; }
  get children() { return this._children.filter((c) => c.nodeType === 1); }
  get firstElementChild() { return this.children[0] || null; }
  get firstChild() { return this._children[0] || null; }
  get isConnected() { let n = this; while (n) { if (n === this.ownerDocument.documentElement) return true; n = n.parentNode; } return false; }
  _removeChild(c) { const i = this._children.indexOf(c); if (i >= 0) this._children.splice(i, 1); c.parentNode = null; }
  appendChild(c) { if (c.parentNode) c.parentNode._removeChild(c); this._children.push(c); c.parentNode = this; return c; }
  removeChild(c) { this._removeChild(c); return c; }
  remove() { if (this.parentNode) this.parentNode._removeChild(this); }
  contains(n) { while (n) { if (n === this) return true; n = n.parentNode; } return false; }
  // ── attributes ──
  get id() { return this._attrs.get('id') || ''; }
  set id(v) { this._attrs.set('id', String(v)); }
  get className() { return this._attrs.get('class') || ''; }
  set className(v) { this._attrs.set('class', String(v)); }
  setAttribute(k, v) { this._attrs.set(k, String(v)); if (k === 'value') this._value = null; }
  getAttribute(k) { return this._attrs.has(k) ? this._attrs.get(k) : null; }
  hasAttribute(k) { return this._attrs.has(k); }
  removeAttribute(k) { this._attrs.delete(k); }
  toggleAttribute(k, force) { const on = force === undefined ? !this._attrs.has(k) : !!force; if (on) this._attrs.set(k, ''); else this._attrs.delete(k); return on; }
  get classList() {
    const el = this; const list = () => el.className.split(/\s+/).filter(Boolean);
    const set = (a) => { el.className = a.join(' '); };
    return {
      add: (...cs) => { const a = list(); for (const c of cs) if (!a.includes(c)) a.push(c); set(a); },
      remove: (...cs) => set(list().filter((c) => !cs.includes(c))),
      toggle: (c, force) => { const has = list().includes(c); const on = force === undefined ? !has : !!force; if (on && !has) set([...list(), c]); else if (!on && has) set(list().filter((x) => x !== c)); return on; },
      contains: (c) => list().includes(c),
      [Symbol.iterator]: () => list()[Symbol.iterator](),
    };
  }
  get dataset() {
    const el = this;
    return new Proxy({}, {
      get: (_, k) => (typeof k === 'string' && el._attrs.has('data-' + kebab(k)) ? el._attrs.get('data-' + kebab(k)) : undefined),
      set: (_, k, v) => { el._attrs.set('data-' + kebab(k), String(v)); return true; },
      has: (_, k) => el._attrs.has('data-' + kebab(String(k))),
      ownKeys: () => [...el._attrs.keys()].filter((k) => k.startsWith('data-')).map((k) => camel(k.slice(5))),
      getOwnPropertyDescriptor: (_, k) => (el._attrs.has('data-' + kebab(String(k))) ? { enumerable: true, configurable: true, value: el._attrs.get('data-' + kebab(String(k))) } : undefined),
    });
  }
  get style() {
    if (!this._style) {
      const st = {};
      Object.defineProperty(st, 'setProperty', { value(k, v) { this[k] = String(v); }, enumerable: false });
      Object.defineProperty(st, 'removeProperty', { value(k) { delete this[k]; }, enumerable: false });
      this._style = st;
    }
    return this._style;
  }
  // ── form-ish properties ──
  get value() { return this._value !== null ? this._value : (this._attrs.get('value') || ''); }
  set value(v) { this._value = String(v); }
  get disabled() { return this._attrs.has('disabled'); }
  set disabled(v) { if (v) this._attrs.set('disabled', ''); else this._attrs.delete('disabled'); }
  get hidden() { return this._attrs.has('hidden'); }
  set hidden(v) { if (v) this._attrs.set('hidden', ''); else this._attrs.delete('hidden'); }
  // ── content ──
  get textContent() { return this._children.map((c) => (c.nodeType === 3 ? c.data : c.textContent)).join(''); }
  set textContent(v) { for (const c of this._children) c.parentNode = null; this._children = []; if (String(v) !== '') this.appendChild(new MiniText(String(v))); }
  set innerHTML(html) { for (const c of this._children) c.parentNode = null; this._children = []; parseInto(this, String(html == null ? '' : html)); }
  get innerHTML() { return this._children.map((c) => serialize(c)).join(''); }
  get outerHTML() { return serialize(this); }
  // ── queries ──
  matches(sel) { return compile(sel).some((chain) => matchChain(this, chain)); }
  closest(sel) { const chains = compile(sel); let n = this; while (n && n.nodeType === 1) { if (chains.some((c) => matchChain(n, c))) return n; n = n.parentNode; } return null; }
  querySelectorAll(sel) { const chains = compile(sel); const out = []; walk(this, (n) => { if (n !== this && chains.some((c) => matchChain(n, c))) out.push(n); }); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  // ── events ──
  addEventListener(t, fn, opts) { const l = this._listeners.get(t) || []; l.push({ fn, once: !!(opts && opts.once) }); this._listeners.set(t, l); }
  removeEventListener(t, fn) { const l = this._listeners.get(t); if (l) this._listeners.set(t, l.filter((x) => x.fn !== fn)); }
  listenerCount(t) { return (this._listeners.get(t) || []).length; }
  dispatchEvent(evt) {
    const doc = this.ownerDocument;
    const e = { bubbles: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this._stop = true; }, ...evt, target: evt.target || this };
    const fire = (node, listeners) => { const l = listeners && listeners.get(e.type); if (!l) return; e.currentTarget = node; for (const x of l.slice()) { if (x.once) node.removeEventListener(e.type, x.fn); x.fn(e); } };
    let n = this; let top = this;
    while (n && !e._stop) {
      fire(n, n._listeners); top = n;
      if (e.bubbles === false) return !e.defaultPrevented;
      n = n.parentNode;
    }
    // the document hears an event only from a node that is IN it (a detached tree never reaches it)
    if (!e._stop && top === doc.documentElement) fire(doc, doc._docListeners);
    return !e.defaultPrevented;
  }
  click() { return this.dispatchEvent({ type: 'click' }); }
  // ── focus / geometry ──
  focus() { this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body; }
  getBoundingClientRect() { return { width: 390, height: 800, top: 0, left: 0, right: 390, bottom: 800 }; }
  scrollIntoView() {}
  get offsetWidth() { return 390; }
}

function walk(root, fn) { for (const c of root._children) { if (c.nodeType === 1) { fn(c); walk(c, fn); } } }

function serialize(n) {
  if (n.nodeType === 3) return escText(n.data);
  const attrs = [...n._attrs.entries()].map(([k, v]) => (v === '' && (k === 'hidden' || k === 'disabled') ? ` ${k}` : ` ${k}="${escAttr(v)}"`)).join('');
  if (VOID.has(n.localName)) return `<${n.localName}${attrs}>`;
  return `<${n.localName}${attrs}>${n._children.map(serialize).join('')}</${n.localName}>`;
}

// ── the tokenizer / tree builder ───────────────────────────────────────────────────────────────────────────────
function parseInto(root, html) {
  const doc = root.ownerDocument; const stack = [root]; let i = 0;
  const top = () => stack[stack.length - 1];
  while (i < html.length) {
    if (html.startsWith('<!--', i)) { const j = html.indexOf('-->', i + 4); i = j < 0 ? html.length : j + 3; continue; }
    if (html[i] === '<' && /[a-zA-Z]/.test(html[i + 1] || '')) {
      let j = i + 1; while (j < html.length && /[^\s/>]/.test(html[j])) j++;
      const tag = html.slice(i + 1, j).toLowerCase(); const el = new MiniElement(doc, tag);
      // attributes
      for (;;) {
        while (j < html.length && /\s/.test(html[j])) j++;
        if (html[j] === '>' || (html[j] === '/' && html[j + 1] === '>') || j >= html.length) break;
        let k = j; while (k < html.length && /[^\s=/>]/.test(html[k])) k++;
        const name = html.slice(j, k); let val = '';
        j = k; while (j < html.length && /\s/.test(html[j])) j++;
        if (html[j] === '=') {
          j++; while (j < html.length && /\s/.test(html[j])) j++;
          if (html[j] === '"' || html[j] === "'") { const q = html[j]; const e = html.indexOf(q, j + 1); val = html.slice(j + 1, e < 0 ? html.length : e); j = e < 0 ? html.length : e + 1; }
          else { let e = j; while (e < html.length && /[^\s>]/.test(html[e])) e++; val = html.slice(j, e); j = e; }
        }
        if (name) el._attrs.set(name, decode(val));
      }
      const selfClose = html[j] === '/'; j = html.indexOf('>', j); j = j < 0 ? html.length : j + 1;
      top().appendChild(el);
      if (!selfClose && !VOID.has(tag)) stack.push(el);
      i = j; continue;
    }
    if (html[i] === '<' && html[i + 1] === '/') {
      const j = html.indexOf('>', i); const tag = html.slice(i + 2, j < 0 ? html.length : j).trim().toLowerCase();
      for (let s = stack.length - 1; s > 0; s--) { if (stack[s].localName === tag) { stack.length = s; break; } }
      i = j < 0 ? html.length : j + 1; continue;
    }
    let j = i + 1; while (j < html.length && html[j] !== '<') j++;
    top().appendChild(new MiniText(decode(html.slice(i, j))));
    i = j;
  }
}

// ── the selector grammar ─────────────────────────────────────────────────────────────────────────────────────────
const selCache = new Map();
function compile(sel) {
  if (selCache.has(sel)) return selCache.get(sel);
  const chains = String(sel).split(',').map((s) => s.trim()).filter(Boolean).map((part) => {
    const tokens = part.replace(/\s*>\s*/g, ' > ').split(/\s+/); const chain = []; let comb = ' ';
    for (const t of tokens) {
      if (t === '>') { comb = '>'; continue; }
      chain.push({ comb, compound: parseCompound(t) }); comb = ' ';
    }
    return chain;
  });
  selCache.set(sel, chains); return chains;
}
function parseCompound(t) {
  const c = { tag: null, id: null, classes: [], attrs: [], nots: [] }; let i = 0;
  const m = /^[a-zA-Z][\w-]*/.exec(t); if (m) { c.tag = m[0].toLowerCase(); i = m[0].length; } else if (t[0] === '*') i = 1;
  while (i < t.length) {
    if (t[i] === '#') { const r = /^#([\w-]+)/.exec(t.slice(i)); c.id = r[1]; i += r[0].length; }
    else if (t[i] === '.') { const r = /^\.([\w-]+)/.exec(t.slice(i)); c.classes.push(r[1]); i += r[0].length; }
    else if (t[i] === '[') { const e = t.indexOf(']', i); const body = t.slice(i + 1, e); const q = /^([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|(.*)))?$/.exec(body); c.attrs.push({ name: q[1], val: q[2] ?? q[3] ?? q[4] ?? null }); i = e + 1; }
    else if (t.startsWith(':not(', i)) { const e = t.indexOf(')', i); c.nots.push(parseCompound(t.slice(i + 5, e))); i = e + 1; }
    else throw new Error(`minidom: unsupported selector "${t}"`);
  }
  return c;
}
function matchCompound(el, c) {
  if (c.tag && el.localName !== c.tag) return false;
  if (c.id && el.id !== c.id) return false;
  for (const cl of c.classes) if (!el.classList.contains(cl)) return false;
  for (const a of c.attrs) { if (!el.hasAttribute(a.name)) return false; if (a.val !== null && el.getAttribute(a.name) !== a.val) return false; }
  for (const n of c.nots) if (matchCompound(el, n)) return false;
  return true;
}
/** Whether `el` matches the selector chain, right to left (chain[i].comb joins chain[i-1] to chain[i]). Ancestors outside the element a query was called on may match, as in a real DOM. */
function matchChain(el, chain) {
  const test = (node, i) => {
    if (i === 0) return true;
    const { comb } = chain[i]; const prev = chain[i - 1].compound;
    let p = node.parentNode;
    if (comb === '>') return !!p && p.nodeType === 1 && matchCompound(p, prev) && test(p, i - 1);
    while (p && p.nodeType === 1) { if (matchCompound(p, prev) && test(p, i - 1)) return true; p = p.parentNode; }
    return false;
  };
  return matchCompound(el, chain[chain.length - 1].compound) && test(el, chain.length - 1);
}

// ── the document ─────────────────────────────────────────────────────────────────────────────────────────────────
export class MiniDocument {
  constructor() {
    this._docListeners = new Map(); this.hidden = false; this.title = '';
    this.documentElement = new MiniElement(this, 'html');
    this.head = new MiniElement(this, 'head'); this.body = new MiniElement(this, 'body');
    this.documentElement.appendChild(this.head); this.documentElement.appendChild(this.body);
    this.documentElement.parentNode = null;
    this.activeElement = this.body;
  }
  createElement(tag) { return new MiniElement(this, tag); }
  getElementById(id) { let hit = null; walk(this.documentElement, (n) => { if (!hit && n.id === id) hit = n; }); return hit; }
  querySelector(sel) { return this.documentElement.querySelector(sel); }
  querySelectorAll(sel) { return this.documentElement.querySelectorAll(sel); }
  addEventListener(t, fn, opts) { const l = this._docListeners.get(t) || []; l.push({ fn, once: !!(opts && opts.once) }); this._docListeners.set(t, l); }
  removeEventListener(t, fn) { const l = this._docListeners.get(t); if (l) this._docListeners.set(t, l.filter((x) => x.fn !== fn)); }
  listenerCount(t) { return (this._docListeners.get(t) || []).length; }
  dispatchEvent(evt) { const l = this._docListeners.get(evt.type); const e = { preventDefault() {}, stopPropagation() {}, ...evt }; if (l) for (const x of l.slice()) x.fn(e); return true; }
}
