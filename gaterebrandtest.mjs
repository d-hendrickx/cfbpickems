/**
 * CFB Pickems — gaterebrandtest.mjs (UN-312 / DI-437 + DI-438, 2026-09-29)
 * ================================================================================
 * The Munera login rebrand: the sign-in gate (every state) and the hold screens
 * wear ONE red-and-black skin on web and iOS. brandtest.mjs was amended in the
 * same edit for the pins the redesign retired; THIS file carries the new gate's
 * own proof — markup and state, native-only behaviour, a scan of the gate's CSS
 * (scope, tokens, radius rule, tap sizes, contrast recomputed from the token
 * hexes) and the no-regression pins around the recovery/hold machinery.
 *
 * Precedent: brandtest.mjs / grouptest.mjs — a focused standalone suite beside
 * loadtest.mjs (which spawns it and ratchets its floor). No network, no storage
 * (a child process gets in-memory stubs), no credentials.
 *
 * Run:  node gaterebrandtest.mjs
 *
 * What a green run does NOT prove (named plainly, per the DI's device list):
 * gestures, haptics as FELT, the dark keyboard, safe areas on a real notch,
 * scroll physics, the pseudo-element mask on a real device, Reduce Motion as
 * rendered, and what the browser actually paints. Those are Drew's on-device
 * checklist (DI-437 §5); this suite proves the source and DOM say the right thing.
 *
 * Covers:
 *   [1]  markup + state (child process, web AND native): one template, no
 *        "welcome to"/"IRB", aria-hidden mark, slot order, Google button
 *        byte-identical to its pre-UN-312 self, keyboard attributes, roles,
 *        aria-invalid set/cleared, forgot/recovery/expired screens, Back keeps
 *        the typed email.
 *   [2]  native-only behaviour: haptic('medium') once per Google tap on native,
 *        never on web, never on an error path; auth-native.js never imported
 *        statically.
 *   [3]  brand.js: the gate lockup functions are platform-independent, the mark
 *        is a fixed literal, and the CSS mask carries the SAME shapes.
 *   [4]  CSS scan: scope, tokens (defined once, in :root, never in a theme or
 *        dark block), the single 0px radius, 52/44px tap sizes, rem type, Reduce
 *        Motion, web >=600px, PIN + hold rules byte-unchanged.
 *   [5]  contrast, recomputed with the WCAG formula from the token hexes.
 *   [6]  no-regression pins: the recovery-session predicates and the hold gate's
 *        markup function are exactly as they were.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

const root = path.dirname(fileURLToPath(import.meta.url));
const appUrl = new URL('./js/app.js', import.meta.url).href;
const cssSrc = await readFile(path.join(root, 'css', 'styles.css'), 'utf8');
const appSrc = await readFile(path.join(root, 'js', 'app.js'), 'utf8');
const brandSrc = await readFile(path.join(root, 'js', 'brand.js'), 'utf8');
const stripCssComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ');
const cssCode = stripCssComments(cssSrc);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ─────────────────────────────────────────────────────────────────────────────
// The child process: showGoogleSignInGate() and its screens, driven end to end
// against an in-memory DOM. importing js/app.js has real side effects at module
// scope, so (like brandtest's captureSignInGateHtml) it never shares a process
// with the rest of this file. One run per platform.
// ─────────────────────────────────────────────────────────────────────────────
async function childScenario() {
  const native = process.env.SCENARIO === 'native';
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k), clear: () => store.clear(),
    get length() { return store.size; }, key: (i) => [...store.keys()][i] ?? null,
  };
  const registry = new Map();
  class FakeEl {
    constructor(id) {
      this.id = id || ''; this.attrs = {}; this.dataset = {}; this.style = {}; this.className = '';
      this._html = ''; this._l = {}; this.value = ''; this.disabled = false; this.isConnected = true;
    }
    set innerHTML(v) {
      this._html = String(v);
      const re = /\bid="([^"]+)"/g; let m;
      while ((m = re.exec(this._html))) registry.set(m[1], new FakeEl(m[1])); // a fresh node per paint, like the real DOM
    }
    get innerHTML() { return this._html; }
    get textContent() { return this._html.replace(/<[^>]*>/g, ''); }
    set textContent(v) { this._html = String(v); }
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') { this.id = String(v); registry.set(this.id, this); } }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    removeAttribute(k) { delete this.attrs[k]; }
    addEventListener(t, fn) { (this._l[t] = this._l[t] || []).push(fn); }
    removeEventListener() {}
    dispatch(t, e = {}) { return Promise.all((this._l[t] || []).map((fn) => fn({ target: this, preventDefault() {}, ...e }))); }
    click() { return this.dispatch('click'); }
    appendChild(c) { if (c && c.id) registry.set(c.id, c); return c; }
    remove() { this._removed = true; if (this.id) registry.delete(this.id); }
    querySelector(sel) { return sel && sel.startsWith('#') ? (registry.get(sel.slice(1)) || null) : null; }
    insertAdjacentHTML(_pos, h) { this._html += h; }
    focus() {}
    get classList() { return { add() {}, remove() {}, contains() { return false; }, toggle() {}, [Symbol.iterator]: function* () {} }; }
  }
  const innerEl = new FakeEl('');
  const bodyEl = new FakeEl('');
  globalThis.document = {
    addEventListener() {}, removeEventListener() {}, hidden: false,
    getElementById: (id) => registry.get(id) || null,
    querySelector: (sel) => (sel === '#site-gate-overlay .site-gate-inner' ? innerEl : null),
    querySelectorAll: () => [], createElement: () => new FakeEl(), body: bodyEl, documentElement: new FakeEl(),
  };
  const hapticCalls = [];
  const Haptics = { impact: (o) => hapticCalls.push('impact:' + o.style), notification: (o) => hapticCalls.push('notification:' + o.type) };
  if (native) globalThis.window = { Capacitor: { isNativePlatform: () => true, Plugins: { Haptics } } };
  else { globalThis.window = globalThis; globalThis.Capacitor = { Plugins: { Haptics } }; } // plugin present but NOT a native shell
  try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
  catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined, clipboard: { writeText: async () => {} } }, configurable: true }); }
  globalThis.requestAnimationFrame = (fn) => fn();
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.confirm = () => true; globalThis.prompt = () => null; globalThis.alert = () => {};
  if (!globalThis.crypto || !globalThis.crypto.randomUUID) globalThis.crypto = { randomUUID: () => 'u_fixture' };
  globalThis.fetch = async () => { throw new Error('network disabled in gaterebrandtest'); };

  const app = await import(process.env.APP_URL);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const ticks = async (n = 5) => { for (let i = 0; i < n; i++) await tick(); };
  const g = (id) => registry.get(id);
  const slot = (id) => { const e = g(id); return e ? { cls: e.className, role: e.attrs.role ?? null, text: e.textContent, display: e.style.display ?? null } : null; };
  const out = {};

  // — paint —
  app.showGoogleSignInGate();
  out.html = g('site-gate-overlay').innerHTML;
  out.kbd = {
    emailHint: g('pwacct-email').attrs.enterkeyhint ?? null, emailCap: g('pwacct-email').attrs.autocapitalize ?? null,
    emailCorrect: g('pwacct-email').attrs.autocorrect ?? null, emailSpell: g('pwacct-email').attrs.spellcheck ?? null,
    pwHint: g('pwacct-password').attrs.enterkeyhint ?? null,
  };

  // — Google slot: both tones —
  app.showGoogleSignInGate({ message: 'Sign-in cancelled.', tone: 'notice' });
  out.googleNotice = slot('google-gate-message');
  app.showGoogleSignInGate({ message: 'Google sign-in failed for a test.', tone: 'error' });
  out.googleError = slot('google-gate-message');

  // — haptic: a single tap, then a double tap on a button that goes disabled —
  app.showGoogleSignInGate();
  hapticCalls.length = 0;
  await g('google-gate-submit').click(); await ticks();
  out.hapticSingle = hapticCalls.slice();
  app.showGoogleSignInGate();
  hapticCalls.length = 0;
  const gb = g('google-gate-submit');
  await Promise.all([gb.click(), gb.click()]); await ticks();
  out.hapticDouble = hapticCalls.slice();

  // — email/password: empty, malformed, cleared on input, wrong credentials —
  app.showGoogleSignInGate();
  const em = () => g('pwacct-email'), pw = () => g('pwacct-password'), sub = () => g('pwacct-gate-submit');
  const inv = (e) => e.attrs['aria-invalid'] ?? null;
  await sub().click();
  out.empty = { slot: slot('pwacct-gate-message'), email: inv(em()), pw: inv(pw()) };
  em().value = 'kev'; pw().value = 'x';
  await em().dispatch('input'); await pw().dispatch('input');
  out.afterTyping = { email: inv(em()), pw: inv(pw()) };
  await sub().click();
  out.malformed = { slot: slot('pwacct-gate-message'), email: inv(em()), pw: inv(pw()) };
  await em().dispatch('input');
  out.malformedCleared = { email: inv(em()), pw: inv(pw()) };
  em().value = 'kev@example.com'; pw().value = 'hunter22';
  hapticCalls.length = 0;
  await sub().click(); await ticks();
  out.wrongCreds = { slot: slot('pwacct-gate-message'), email: inv(em()), pw: inv(pw()), haptics: hapticCalls.slice(), disabledAfter: sub().disabled };
  await pw().dispatch('input');
  out.wrongCredsPwCleared = { email: inv(em()), pw: inv(pw()) };

  // — the S1-B notice-on-gate fallback writes through the same helper —
  app.showGoogleSignInGate();
  const where = app._showNoticeOnGateOrToastForTest('Heads up', 'warning');
  out.noticeFallback = { where, slot: slot('pwacct-gate-message') };
  app._showNoticeOnGateOrToastForTest('Bad thing', 'error');
  out.noticeFallbackError = slot('pwacct-gate-message');

  // — forgot password, and Back keeps the typed email —
  app.showGoogleSignInGate();
  em().value = 'kev@example.com';
  await g('pwacct-forgot-link').click();
  out.forgotHtml = innerEl.innerHTML;
  g('pwacct-reset-email').value = 'typed@example.com';
  await g('pwacct-reset-back-btn').click();
  out.backPrefill = g('pwacct-email').value;
  out.backHtml = g('site-gate-overlay').innerHTML;

  // — recovery form: mismatch marks Confirm; expired variant —
  app._showPasswordRecoveryScreenForTest();
  const ov = g('site-gate-overlay');
  out.recovery = { html: ov.innerHTML, variant: ov.attrs['data-recovery-variant'] ?? null };
  g('pwacct-recovery-new').value = 'aaaa-aaaa'; g('pwacct-recovery-confirm').value = 'bbbb-bbbb';
  await g('pwacct-recovery-submit').click();
  out.mismatch = { slot: slot('pwacct-recovery-message'), confirm: inv(g('pwacct-recovery-confirm')), newPw: inv(g('pwacct-recovery-new')) };
  await g('pwacct-recovery-confirm').dispatch('input');
  out.mismatchCleared = inv(g('pwacct-recovery-confirm'));
  app._showPasswordRecoveryScreenForTest({ expired: true });
  const ov2 = g('site-gate-overlay');
  out.expired = { html: ov2.innerHTML, variant: ov2.attrs['data-recovery-variant'] ?? null };

  console.log('SCENARIO-JSON:' + JSON.stringify(out));
}

function runScenario(scenario) {
  const child = `(${childScenario.toString()})().then(() => process.exit(0), (e) => { console.log('SCENARIO-ERROR:' + (e && e.stack || e)); process.exit(1); });`;
  const run = spawnSync(process.execPath, ['--input-type=module', '--eval', child], {
    encoding: 'utf8', timeout: 60000, env: { ...process.env, APP_URL: appUrl, SCENARIO: scenario },
  });
  const outText = `${run.stdout || ''}${run.stderr || ''}`;
  const m = /SCENARIO-JSON:(.*)/.exec(outText);
  return { data: m ? JSON.parse(m[1]) : null, status: run.status, raw: outText };
}

const web = runScenario('web');
const nat = runScenario('native');

// The Google button node exactly as it was before UN-312 (inner whitespace included) — DI-437 §1.1 "byte-unchanged".
const G_MARK = '<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true" focusable="false">\n  <path fill="#4285F4" d="M17.64 9.2045c0-.6381-.0573-1.2518-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2581h2.9087c1.7018-1.5668 2.6836-3.874 2.6836-6.615z"/>\n  <path fill="#34A853" d="M9 18c2.43 0 4.4673-.8059 5.9564-2.1805l-2.9087-2.2581c-.8059.54-1.8368.8591-3.0477.8591-2.3436 0-4.3282-1.5831-5.0359-3.7104H.9573v2.3318C2.4382 15.9832 5.4818 18 9 18z"/>\n  <path fill="#FBBC05" d="M3.9641 10.71c-.18-.54-.2823-1.1168-.2823-1.71s.1023-1.17.2823-1.71V4.9582H.9573A8.9965 8.9965 0 000 9c0 1.4523.3477 2.8264.9573 4.0418L3.9641 10.71z"/>\n  <path fill="#EA4335" d="M9 3.5795c1.3214 0 2.5077.4541 3.4404 1.346l2.5818-2.5818C13.4632.8918 11.4259 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9582L3.9641 7.29C4.6718 5.1627 6.6564 3.5795 9 3.5795z"/>\n</svg>';
const GOOGLE_BUTTON_PRE_UN312 = `<button class="site-gate-btn google-signin-btn" id="google-gate-submit" type="button">\n          <span class="google-g-mark">${G_MARK}</span>\n          <span id="google-gate-btn-label">Continue with Google</span>\n        </button>`;

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[1] Markup and state — ONE template on web and native (DI-437 §1.1)…');
{
  assert(web.status === 0 && !!web.data, `[1-pre] the web scenario child exited 0 and reported${web.data ? '' : '\n' + web.raw.slice(-1200)}`);
  assert(nat.status === 0 && !!nat.data, `[1-pre] the native scenario child exited 0 and reported${nat.data ? '' : '\n' + nat.raw.slice(-1200)}`);
  const W = web.data || {}, N = nat.data || {};
  const h = W.html || '';
  assert(!!W.html && W.html === N.html, '[1a] web and native render byte-identical gate markup — one template, not a pair');
  assert(!/welcome to/i.test(h) && !/irb/i.test(h) && !/Sign in to make your picks/i.test(h),
    '[1b] no "welcome to", no "IRB" and no old sub-line anywhere in the gate markup');
  assert(/<div class="site-gate" data-gate-state="google">/.test(h) && /<div class="gate-screen" data-screen="signin">/.test(h),
    '[1c] every screen root is .gate-screen[data-screen], and web carries data-gate-state="google" too (Drew\'s Q7)');
  assert(/<svg class="site-gate-mark"[^>]*aria-hidden="true"[^>]*focusable="false"/.test(h),
    '[1d] the temple mark is aria-hidden and unfocusable — decoration, never announced');
  assert(/>MUNERA<\/div>/.test(h) && /class="site-gate-tagline">Enter the arena\.</.test(h),
    '[1e] the lockup says MUNERA and "Enter the arena." on both platforms');
  const order = ['site-gate-hero', 'site-gate-actions', 'id="google-gate-submit"', 'id="google-gate-message"', 'class="divider-or"', 'id="pwacct-gate-form"',
    'id="pwacct-email"', 'id="pwacct-password"', 'id="pwacct-gate-message"', 'id="pwacct-gate-submit"', '</form>', 'id="pwacct-forgot-link"', 'id="pwacct-mode-toggle"'];
  const idx = order.map((k) => h.indexOf(k));
  assert(idx.every((i) => i >= 0) && idx.every((v, i) => i === 0 || v > idx[i - 1]),
    `[1f] slot order: hero, actions, Google button, ITS message slot directly beneath, "or", form (Email, Password, the password message slot, Sign In), then the two links (got ${JSON.stringify(idx)})`);
  const btnEnd = h.indexOf('</button>', h.indexOf('id="google-gate-submit"')) + '</button>'.length;
  assert(/^\s*<div id="google-gate-message" style="display:none"><\/div>/.test(h.slice(btnEnd)),
    '[1g] the Google slot sits IMMEDIATELY under the Google button on both platforms (web used to put it above, native below)');
  assert(h.includes(GOOGLE_BUTTON_PRE_UN312),
    '[1h] the Google button node is BYTE-UNCHANGED from before UN-312 — markup, ids, chip, label and inner whitespace');
  assert(!/site-gate-title-top/.test(h) && !/class="text-muted/.test(h),
    '[1i] neither the old eyebrow class nor an app-theme text token appears in the sign-in markup');
  for (const [name, r] of [['web', W], ['native', N]]) {
    assert(r.kbd && r.kbd.emailHint === 'next' && r.kbd.pwHint === 'go',
      `[1j] ${name}: Return on Email says "next" and on Password says "go" (enterkeyhint on the live nodes; got ${JSON.stringify(r.kbd)})`);
    assert(r.kbd && r.kbd.emailCap === 'none' && r.kbd.emailCorrect === 'off' && r.kbd.emailSpell === 'false',
      `[1k] ${name}: Email is never auto-capitalised, auto-corrected or spell-checked`);
  }
  assert(/id="pwacct-email" name="email" type="email" inputmode="email" autocomplete="email" placeholder="you@example\.com" required \/>/.test(h),
    '[1l] the Email input tag itself is unchanged (authtest [N6-2] pins it byte-for-byte; the keyboard hints are applied to the live node instead)');

  // messages
  for (const [name, r] of [['web', W], ['native', N]]) {
    assert(r.googleNotice && r.googleNotice.cls === 'site-gate-notice' && r.googleNotice.role === 'status' && r.googleNotice.display === 'block',
      `[1m] ${name}: a Google notice keeps class site-gate-notice, gains role="status", and shows (got ${JSON.stringify(r.googleNotice)})`);
    assert(r.googleError && r.googleError.cls === 'site-gate-error' && r.googleError.role === 'alert' && r.googleError.display === 'block',
      `[1n] ${name}: a Google error keeps class site-gate-error and gains role="alert" (got ${JSON.stringify(r.googleError)})`);
    assert(r.empty && r.empty.slot && r.empty.slot.text === 'Enter your email and password.' && r.empty.slot.cls === 'site-gate-error' && r.empty.slot.role === 'alert',
      `[1o] ${name}: the empty-submit message is an alert on the password slot (got ${JSON.stringify(r.empty && r.empty.slot)})`);
    assert(r.empty && r.empty.email === 'true' && r.empty.pw === 'true',
      `[1p] ${name}: an empty submit marks BOTH empty fields aria-invalid (got ${JSON.stringify(r.empty)})`);
    assert(r.afterTyping && r.afterTyping.email === null && r.afterTyping.pw === null,
      `[1q] ${name}: typing in a field clears THAT field's aria-invalid`);
    assert(r.malformed && r.malformed.slot.text === 'Enter a valid email address.' && r.malformed.email === 'true' && r.malformed.pw === null,
      `[1r] ${name}: a malformed email marks Email only (got ${JSON.stringify(r.malformed)})`);
    assert(r.malformedCleared && r.malformedCleared.email === null,
      `[1s] ${name}: …and Email's own input clears it`);
    assert(r.wrongCreds && r.wrongCreds.slot.text === "That email and password don't match. Check them and try again." && r.wrongCreds.slot.role === 'alert' && r.wrongCreds.email === 'true' && r.wrongCreds.pw === 'true',
      `[1t] ${name}: a failed credential pair shows the ONE enumeration-safe sentence as an alert and marks BOTH fields, so neither is singled out (got ${JSON.stringify(r.wrongCreds)})`);
    assert(r.wrongCredsPwCleared && r.wrongCredsPwCleared.pw === null && r.wrongCredsPwCleared.email === 'true',
      `[1u] ${name}: …and each field clears only on ITS OWN input (DI-437: "cleared on that field's input")`);
    assert(r.noticeFallback && r.noticeFallback.where === 'gate' && r.noticeFallback.slot.cls === 'site-gate-notice' && r.noticeFallback.slot.role === 'status',
      `[1v] ${name}: the notice-on-gate fallback writes a notice with role="status" through the shared helper (got ${JSON.stringify(r.noticeFallback)})`);
    assert(r.noticeFallbackError && r.noticeFallbackError.cls === 'site-gate-error' && r.noticeFallbackError.role === 'alert',
      `[1w] ${name}: …and an error with role="alert"`);
    // The inline Google writer and applyGateSlot must be indistinguishable to a player.
    assert(r.googleError.cls === r.noticeFallbackError.cls && r.googleError.role === r.noticeFallbackError.role && r.googleError.display === r.noticeFallbackError.display &&
           r.googleNotice.cls === r.noticeFallback.slot.cls && r.googleNotice.role === r.noticeFallback.slot.role && r.googleNotice.display === r.noticeFallback.slot.display,
      `[1x] ${name}: the Google slot's inline writer and the shared applyGateSlot() produce the SAME class, role and display for each tone (the two copies cannot drift)`);
  }

  // forgot / recovery / expired
  const f = W.forgotHtml || '';
  assert(/<div class="gate-screen" data-screen="forgot">/.test(f) && /class="site-gate-helper">We'll email you a link to set a new one\./.test(f) && !/text-muted/.test(f),
    '[1y] the forgot screen is .gate-screen[data-screen="forgot"], its helper is the gate\'s own class (not the theme-token .text-muted), copy unchanged');
  const fi = ['id="pwacct-reset-email"', 'id="pwacct-reset-send-btn"', 'id="pwacct-reset-message"', 'id="pwacct-reset-back-btn"'].map((k) => f.indexOf(k));
  assert(fi.every((i) => i >= 0) && fi.every((v, i) => i === 0 || v > fi[i - 1]),
    `[1z] forgot: Email, Send Reset Link, ITS message slot directly under the button, then Back (got ${JSON.stringify(fi)})`);
  assert(/id="pwacct-reset-email"[^>]*autocapitalize="none"[^>]*autocorrect="off"[^>]*spellcheck="false"/.test(f),
    '[1aa] the reset Email field is never auto-capitalised either');
  assert(W.backPrefill === 'typed@example.com' && /data-screen="signin"/.test(W.backHtml || ''),
    `[1ab] Back returns to the sign-in screen and KEEPS the email typed on the forgot screen (got ${JSON.stringify(W.backPrefill)})`);
  assert(W.recovery && /data-gate-state="recovery"/.test(W.recovery.html) && /data-screen="recovery"/.test(W.recovery.html) && W.recovery.variant === 'form',
    `[1ac] the new-password screen keeps data-gate-state="recovery" and data-recovery-variant="form" (got ${JSON.stringify(W.recovery && W.recovery.variant)}) — RG-249 wiring untouched`);
  const ri = ['id="pwacct-recovery-new"', 'id="pwacct-recovery-confirm"', 'id="pwacct-recovery-message"', 'id="pwacct-recovery-submit"', 'id="pwacct-recovery-back-btn"'].map((k) => (W.recovery ? W.recovery.html : '').indexOf(k));
  assert(ri.every((i) => i >= 0) && ri.every((v, i) => i === 0 || v > ri[i - 1]),
    `[1ad] recovery: two fields, the message slot between the last field and the button, then Back (got ${JSON.stringify(ri)})`);
  assert(!/Choose something you'll remember/.test(W.recovery ? W.recovery.html : ''),
    '[1ae] the mockup\'s optional frame-9 helper "Choose something you\'ll remember." is NOT built (awaiting Drew)');
  assert(W.mismatch && W.mismatch.slot.text === "Those passwords don't match." && W.mismatch.slot.role === 'alert' && W.mismatch.confirm === 'true' && W.mismatch.newPw === null && W.mismatchCleared === null,
    `[1af] a password mismatch is an alert, marks Confirm invalid (mockup frame 9), and Confirm's own input clears it (got ${JSON.stringify(W.mismatch)})`);
  assert(W.expired && /data-gate-state="recovery"/.test(W.expired.html) && /data-screen="expired"/.test(W.expired.html) && W.expired.variant === 'expired',
    `[1ag] the expired screen carries data-screen="expired" and data-recovery-variant="expired" (got ${JSON.stringify(W.expired && W.expired.variant)})`);
  assert(/id="pwacct-recovery-message" class="site-gate-error" role="alert" style="display:block">This reset link has expired or was already used\. Request a new one\./.test(W.expired ? W.expired.html : ''),
    '[1ah] …its error keeps class="site-gate-error", display:block and the exact copy, and gains role="alert"');
  assert(/id="pwacct-recovery-expired-reset-btn"[^>]*>Request a New Link</.test(W.expired ? W.expired.html : ''),
    '[1ai] …with "Request a New Link" as the one way forward');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[2] Native-only behaviour — haptics behind isNativeShell() (DI-437 §1.6)…');
{
  const W = web.data || {}, N = nat.data || {};
  assert(Array.isArray(N.hapticSingle) && N.hapticSingle.length === 1 && N.hapticSingle[0] === 'impact:MEDIUM',
    `[2a] native: one tap on the Google box fires exactly one MEDIUM impact (got ${JSON.stringify(N.hapticSingle)})`);
  assert(Array.isArray(N.hapticDouble) && N.hapticDouble.length === 1,
    `[2b] native: a second tap while the first is still connecting is a no-op — still exactly one buzz (got ${JSON.stringify(N.hapticDouble)})`);
  assert(Array.isArray(W.hapticSingle) && W.hapticSingle.length === 0 && Array.isArray(W.hapticDouble) && W.hapticDouble.length === 0,
    `[2c] web: the Google tap NEVER buzzes, even with a Haptics plugin object present — the gate is isNativeShell(), not plugin presence (got ${JSON.stringify(W.hapticSingle)} / ${JSON.stringify(W.hapticDouble)})`);
  assert(N.wrongCreds && N.wrongCreds.haptics.length === 0 && W.wrongCreds && W.wrongCreds.haptics.length === 0,
    '[2d] a FAILED password sign-in makes no haptic on either platform (errors are silent; success is the only buzz)');
  const clickBody = appSrc.slice(appSrc.indexOf("btn?.addEventListener('click', () => { if (!btn.disabled) haptic('medium'); });"));
  assert(clickBody.length < appSrc.length && clickBody.indexOf("btn?.addEventListener('click', async () => {") > 0 &&
         clickBody.indexOf("btn?.addEventListener('click', async () => {") < 200,
    '[2e] the haptic is its own listener, registered immediately BEFORE the async sign-in handler — so it fires on the tap, ahead of every await, and the handler body authnativetest extracts is untouched');
  const region = (name) => { const a = appSrc.indexOf(`function ${name}(`); return appSrc.slice(a, appSrc.indexOf('\n}\n', a)); };
  assert(/haptic\('medium'\)/.test(region('bindPasswordGateBlock')) && /haptic\('success'\)/.test(region('showPasswordRecoveryScreen')),
    '[2f] the password-success MEDIUM haptic (in bindPasswordGateBlock) and the new-password SUCCESS haptic (in showPasswordRecoveryScreen) are still in place — DI-437: medium on Google tap and password success, success on new password');
  assert(!/^\s*import\s[^;\n]*['"]\.\/auth-native\.js['"]/m.test(appSrc),
    '[2g] app.js has no STATIC import of auth-native.js — web never loads it (the only references are the two dynamic, native-path imports)');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[3] brand.js — the gate lockup is platform-independent and the mark is one fixed literal…');
{
  globalThis.window = {};
  const brandWeb = await import('./js/brand.js');
  const webVals = [brandWeb.getGateWordmark(), brandWeb.getGateTagline(), brandWeb.getGateMarkSVG()];
  globalThis.window = { Capacitor: { isNativePlatform: () => true } };
  const nativeVals = [brandWeb.getGateWordmark(), brandWeb.getGateTagline(), brandWeb.getGateMarkSVG()];
  assert(webVals.every((v, i) => v === nativeVals[i]), '[3a] getGateWordmark()/getGateTagline()/getGateMarkSVG() return identical values on web and native — they never read the platform');
  assert(webVals[0] === 'MUNERA' && webVals[1] === 'Enter the arena.', '[3b] "MUNERA" and "Enter the arena." — the launch screen\'s own strings, not new copy');
  const svg = webVals[2];
  assert(/^<svg /.test(svg) && /viewBox="205 250 614 495"/.test(svg) && /width="72" height="58"/.test(svg) && /fill="currentColor"/.test(svg) && /aria-hidden="true"/.test(svg) && /focusable="false"/.test(svg),
    '[3c] the mark: viewBox 205 250 614 495 (its own bounds), 72x58, currentColor, aria-hidden, focusable=false');
  assert(!/<text|<script|<style|<image|href=|on\w+=/i.test(svg), '[3d] the mark is shapes only — no text, script, style, image or link, so injecting it raw carries nothing');
  assert(!/isNativeShell|getPlatform/.test(brandSrc.slice(brandSrc.indexOf('export function getGateMarkSVG'))),
    '[3e] nothing from getGateMarkSVG() onward in brand.js reads isNativeShell()/getPlatform()');
  const shapesOf = (s) => [...s.matchAll(/<(path|rect)\b([^>]*?)\/?>/g)].map((m) => {
    const attrs = Object.fromEntries([...m[2].matchAll(/([\w-]+)=["']([^"']*)["']/g)].map((a) => [a[1], a[2]]));
    delete attrs.fill;
    return m[1] + ' ' + Object.entries(attrs).sort().map(([k, v]) => `${k}=${v}`).join(' ');
  });
  const brandShapes = shapesOf(svg);
  const maskMatch = /--gate-mark-mask:url\("data:image\/svg\+xml,([^"]+)"\)/.exec(cssCode);
  assert(!!maskMatch, '[3f-pre] the --gate-mark-mask token exists in styles.css');
  const maskSvg = maskMatch ? decodeURIComponent(maskMatch[1]) : '';
  assert(brandShapes.length === 6 && JSON.stringify(shapesOf(maskSvg)) === JSON.stringify(brandShapes) && /viewBox='205 250 614 495'/.test(maskSvg),
    '[3f] DI-438: the CSS mask (hold and sub-screen lockup) carries EXACTLY the six shapes and the viewBox of brand.js getGateMarkSVG() — the two cannot drift');
  const iconPath = path.join(root, '..', 'munera-ios', 'assets', 'svg', 'icon-temple.svg');
  if (existsSync(iconPath)) {
    const icon = await readFile(iconPath, 'utf8');
    const strip = (s) => s.replace(/ Q (\d+) (\d+) \1 \2/g, '').replace(/\.00/g, '').replace(/ry="[^"]*"/g, '').replace(/\s+/g, ' ');
    const iconShapes = shapesOf(icon.replace(/<rect width="1024"[^>]*>/, ''))
      .map((s) => s.replace(/ ry=\S+/, ''));
    assert(iconShapes.length === 6 && JSON.stringify(iconShapes.map((s) => strip(s))) === JSON.stringify(brandShapes.map((s) => strip(s))),
      '[3g] the mark is the SAME six shapes as the home-screen icon asset (icon-temple.svg): the rects verbatim, the roof path minus its zero-length segments');
  } else {
    console.log('  (skipped [3g]: munera-ios/assets/svg/icon-temple.svg not present in this checkout — the iOS tree is not part of the web deploy)');
  }
  const icons = await readFile(path.join(root, 'js', 'icons.js'), 'utf8');
  const warn = /warning: '(<svg[^']*<\/svg>)'/.exec(icons);
  const warnShapes = warn ? [...warn[1].matchAll(/<(path|line)\b([^>]*?)\/?>/g)].map((m) => m[1] + ' ' + [...m[2].matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => `${a[1]}=${a[2]}`).sort().join(' ')) : [];
  const glyphMatch = /\.site-gate\[data-gate-state\] \.site-gate-error::before\{[^}]*?-webkit-mask:url\("data:image\/svg\+xml,([^"]+)"\)/.exec(cssCode);
  const glyphSvg = glyphMatch ? decodeURIComponent(glyphMatch[1]) : '';
  const glyphShapes = [...glyphSvg.matchAll(/<(path|line)\b([^>]*?)\/?>/g)].map((m) => m[1] + ' ' + [...m[2].matchAll(/([\w-]+)='([^']*)'/g)].map((a) => `${a[1]}=${a[2]}`).sort().join(' '));
  assert(warnShapes.length === 3 && JSON.stringify(warnShapes) === JSON.stringify(glyphShapes),
    '[3h] the alert glyph in CSS is EXACTLY icons.js\'s `warning` shapes — the one icon family, reused, nothing new');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[4] CSS scan — scope, tokens, radius rule, tap sizes, type, motion, web layout (DI-437 §1.3)…');
{
  const rootBlockEnd = (() => { const a = cssCode.indexOf(':root {'); let d = 0; for (let i = cssCode.indexOf('{', a); i < cssCode.length; i++) { if (cssCode[i] === '{') d++; else if (cssCode[i] === '}' && --d === 0) return i; } return -1; })();
  const NEW_TOKENS = ['--gate-ink', '--gate-marble', '--gate-gold', '--gate-oxblood', '--gate-glow-clear', '--gate-card', '--gate-field-border', '--gate-secondary', '--gate-muted',
    '--gate-loss', '--gate-loss-border', '--gate-notice-border', '--gate-hairline', '--gate-focus-ring', '--gate-spinner-track', '--gate-radius-google', '--gate-font-serif', '--gate-font-ui',
    '--gate-mark-mask', '--google-btn-fill', '--google-btn-stroke', '--google-btn-label', '--google-btn-font'];
  for (const t of NEW_TOKENS) {
    const defs = [...cssCode.matchAll(new RegExp(`(?:^|[;{\\s])${escapeRe(t)}:`, 'g'))].map((m) => m.index);
    assert(defs.length === 1 && defs[0] < rootBlockEnd, `[4a] ${t} is defined exactly once, inside :root`);
  }
  // No theme block and no dark block may redefine a gate token.
  const themeBodies = [...cssCode.matchAll(/(body\.theme-[\w-]+[^{]*|@media \(prefers-color-scheme[^{]*\{\s*body[^{]*|body[^{]*data-color-scheme[^{]*)\{([^}]*)\}/g)].map((m) => m[2]);
  assert(themeBodies.length >= 8, `[4b-pre] non-vacuity: the scan found the theme and dark blocks (${themeBodies.length} bodies)`);
  assert(themeBodies.every((b) => !/--gate-(ink|marble|gold|oxblood|glow|card|field|secondary|muted|loss|notice|hairline|focus|spinner|radius|font|mark)|--google-btn/.test(b)),
    '[4b] no school-theme block and neither dark block (media query or manual override) redefines a gate or Google-button token');
  // (?<=^|\}) is a LOOKBEHIND on purpose: a consuming `(?:^|\})` swallows the closing brace the previous match already used, and the scan skips every other rule.
  const scoped = [...cssCode.matchAll(/(?<=^|\})\s*((?:@media[^{]*\{\s*)?(?:#site-gate-overlay )?\.site-gate\[data-gate-state[^{]*)\{([^}]*)\}/g)];
  const scopedBodies = scoped.map((m) => m[2]).join('\n');
  assert(scoped.length >= 40, `[4c-pre] non-vacuity: the scan collected the gate-scoped rules (${scoped.length} rules)`);
  const usedVars = new Set([...scopedBodies.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
  const allowedOutside = new Set(['--btn-radius', '--motion-fast', '--ease-native', '--ease-entrance']);
  const strays = [...usedVars].filter((v) => !/^--gate-|^--google-btn-/.test(v) && !allowedOutside.has(v));
  assert(strays.length === 0, `[4c] every var() the gate reads is a --gate-*/--google-btn-* token (or --btn-radius and the motion tokens); strays: ${JSON.stringify(strays)}`);
  assert(!/#[0-9a-fA-F]{3,8}\b/.test(scopedBodies.replace(/url\("data:[^"]*"\)/g, '')) && !/rgba?\(/.test(scopedBodies),
    '[4d] no literal colour in any gate-scoped rule — hexes and rgba() live only in the tokens');
  // The single 0px radius.
  const radiusUses = [...scoped].filter((m) => /border-radius:var\(--gate-radius-google\)/.test(m[2]));
  assert(radiusUses.length === 1 && /\.google-signin-btn\s*$/.test(radiusUses[0][1].trim()),
    `[4e] --gate-radius-google is used by EXACTLY one rule and it is the Google button's (got ${radiusUses.length}: ${radiusUses.map((m) => m[1].trim()).join(' | ')})`);
  assert(/--gate-radius-google:0px;/.test(cssCode) && !/border-radius:0(px)?\s*[;}]/.test(scopedBodies),
    '[4f] the token is 0px and no other gate rule sets a literal 0 radius — sharp = the third-party Google box only (the fallback if Google objects is one edit: 4px)');
  assert(!/(?:^|[^-\w])border-radius:(?!var\()/.test(scopedBodies.replace(/border-radius:50%/g, '')),
    '[4g] every gate corner radius is a token (--btn-radius for ours, --gate-radius-google for Google); the spinner\'s 50% is the one literal');
  // Tap sizes and type.
  const minHeights = (sel) => { const m = scoped.filter((r) => r[1].trim() === sel).map((r) => (/min-height:(\d+)px/.exec(r[2]) || [])[1]).filter(Boolean).map(Number); return m; };
  assert(minHeights('.site-gate[data-gate-state] .form-input').every((n) => n >= 52) && minHeights('.site-gate[data-gate-state] .form-input').length === 1,
    '[4h] fields are at least 52px tall');
  assert(minHeights('.site-gate[data-gate-state] .site-gate-btn').every((n) => n >= 52) && minHeights('.site-gate[data-gate-state] .site-gate-btn').length === 1,
    '[4i] buttons (Google, Sign In, Send, Set, Request, Retry) are at least 52px tall — the Google box inherits this and is never re-declared shorter');
  assert(minHeights('.site-gate[data-gate-state] .site-gate-link').every((n) => n >= 44),
    '[4j] links keep a >=44px tap target');
  assert(!/font(?:-size)?:[^;}]*\b\d+(\.\d+)?px/.test(scopedBodies.replace(/font:500 \.875rem\/1\.25rem/g, '')),
    '[4k] no gate font size is in px — every size is rem, so browser zoom reflows it unclipped (native Dynamic Type is a named gap, DI-437 §1.6)');
  const inputRule = scoped.find((r) => r[1].trim() === '.site-gate[data-gate-state] .form-input');
  assert(/font:400 1rem\//.test(inputRule ? inputRule[2] : ''), '[4l] input text is 1rem (16px): smaller makes iOS Safari zoom the page on focus');
  // Motion.
  const durations = [...scopedBodies.matchAll(/\b(\d+)ms\b/g)].map((m) => Number(m[1]));
  assert(durations.every((d) => d === 900), `[4m] the only literal duration in the gate is the spinner's 900ms loop; every transition/entrance reads --motion-fast (150ms) (found ${JSON.stringify(durations)})`);
  assert(/--motion-fast:150ms;/.test(cssCode) && /--ease-native:/.test(cssCode) && /--ease-entrance:/.test(cssCode), '[4n-pre] the motion tokens the gate reads exist');
  const reduce = /@media \(prefers-reduced-motion:reduce\)\{\s*\.site-gate\[data-gate-state\][\s\S]*?\n\}/.exec(cssCode);
  assert(!!reduce && /transform:none;opacity:\.85/.test(reduce[0]) && /:disabled::before\{animation:none\}/.test(reduce[0]) && /site-gate-error,[\s\S]*?site-gate-notice\{animation:none\}/.test(reduce[0]),
    '[4n] Reduce Motion: press = opacity .85 instead of scale, the spinner is frozen, the alert entry is off');
  assert(/\.site-gate\[data-gate-state\] \.site-gate-btn:active:not\(:disabled\)\{transform:scale\(\.97\)\}/.test(cssCode) && /\.site-gate\[data-gate-state\] \.site-gate-btn:disabled\{opacity:\.6/.test(cssCode),
    '[4o] press compresses to 97% (Interaction Principles); disabled is 60% with no press animation');
  assert(/@media \(hover:hover\)\{\s*\.site-gate\[data-gate-state\] \.site-gate-btn:hover:not\(:disabled\)/.test(cssCode) &&
         !/\.site-gate\[data-gate-state\][^{]*(?<!-webkit-autofill):hover[^{]*\{/.test(cssCode.replace(/@media \(hover:hover\)\{\s*\.site-gate\[data-gate-state\][\s\S]*?\n\}/, '')),
    '[4p] hover exists only under (hover:hover) — no sticky hover on touch');
  assert(/@keyframes gateAlertIn\{from\{opacity:0;transform:translateY\(4px\)\}/.test(cssCode) && /animation:gateAlertIn var\(--motion-fast\) var\(--ease-entrance\)/.test(cssCode),
    '[4q] an alert enters with opacity + 4px over --motion-fast (the mockup\'s 220ms snapped to the token)');
  // Web layout, glow, scroll.
  assert(/@media \(min-width:600px\)\{[\s\S]*?radial-gradient\(90% 60% at 50% 0[\s\S]*?\.site-gate-hero\{flex:none;min-height:0;padding:0 0 32px\}/.test(cssCode),
    '[4r] web at 600px and up: the same column, glow 90% 60%, hero flex:none (frame 14)');
  assert(/color-scheme:dark/.test(cssCode.slice(cssCode.indexOf('.site-gate[data-gate-state]{'), cssCode.indexOf('.site-gate[data-gate-state]{') + 200)),
    '[4s] the gate sets color-scheme:dark (keyboard, autofill and scrollbars match the ground)');
  assert(/\.site-gate\[data-gate-state\] \.form-input:-webkit-autofill/.test(cssCode) && /\.site-gate\[data-gate-state\] \.form-input\[aria-invalid="true"\]\{border-color:var\(--gate-loss\)\}/.test(cssCode) &&
         /\.site-gate\[data-gate-state\] \.form-input:focus\{border-color:var\(--gate-gold\);box-shadow:0 0 0 3px var\(--gate-focus-ring\)/.test(cssCode),
    '[4t] fields: AutoFill keeps the card fill, aria-invalid is the red border, focus is a Gold border + ring');
  assert(!/body\.native-shell\s+\.site-gate/.test(cssCode) && !/\.site-gate\[data-gate-state="google"\]/.test(cssCode),
    '[4u] no platform-scoped or state-scoped-to-google rule remains: the gate is one look');
  // PIN gate and hold rules byte-unchanged.
  const PIN_BLOCK = ".site-gate{\n  position:fixed;inset:0;background:#000;display:flex;align-items:center;\n  justify-content:center;z-index:9999;padding:24px;\n}\n.site-gate-inner{\n  text-align:center;max-width:320px;width:100%;\n  font-family:'Courier New',Courier,monospace;\n}\n.site-gate-title-top{\n  color:#aaa;font-size:.8rem;font-weight:400;\n  letter-spacing:.22em;text-transform:lowercase;margin-bottom:6px;line-height:1.2;\n}\n.site-gate-title{\n  color:#fff;font-size:clamp(1.4rem,5.5vw,1.95rem);font-weight:500;\n  letter-spacing:.1em;text-transform:lowercase;margin-bottom:14px;line-height:1.25;\n}\n.site-gate-subtitle{\n  color:#888;font-size:.8rem;letter-spacing:.15em;text-transform:lowercase;margin-bottom:28px;\n}\n.site-gate-input{\n  background:transparent;border:none;border-bottom:2px solid #fff;\n  color:#fff;font-family:'Courier New',monospace;font-size:1.6rem;\n  letter-spacing:.4em;text-align:center;width:160px;padding:8px 0;\n  outline:none;-webkit-appearance:none;display:block;margin:0 auto 16px;\n}\n.site-gate-input::placeholder{color:#444}\n.site-gate-error{color:#f44;font-size:.78rem;margin-bottom:12px;letter-spacing:.06em}\n.site-gate-btn{\n  background:transparent;border:1px solid #fff;color:#fff;\n  font-family:'Courier New',monospace;font-size:.85rem;letter-spacing:.15em;\n  text-transform:lowercase;padding:8px 28px;cursor:pointer;\n  transition:all .2s;\n}\n.site-gate-btn:hover{background:#fff;color:#000}";
  const HOLD_BLOCK = ".site-gate[data-gate-state=\"hold\"] .site-gate-title{\n  text-transform:none;letter-spacing:.04em;margin-bottom:12px;\n}\n.site-gate[data-gate-state=\"hold\"] .site-gate-subtitle{\n  text-transform:none;letter-spacing:.02em;font-size:.88rem;line-height:1.5;margin-bottom:24px;\n}\n.site-gate[data-gate-state=\"hold\"] .site-gate-btn{\n  display:block;width:100%;min-height:44px;text-transform:none;letter-spacing:.08em;\n}\n.site-gate[data-gate-state=\"hold\"] .site-gate-btn:disabled{opacity:.6;cursor:default}";
  assert(cssSrc.includes(PIN_BLOCK), '[4v] the PIN gate\'s rules (.site-gate … .site-gate-btn:hover) are BYTE-UNCHANGED');
  assert(cssSrc.includes(HOLD_BLOCK), '[4w] the four hold-gate rules DI-180l wrote are BYTE-UNCHANGED');
  assert(cssSrc.indexOf('data-gate-state="hold"') === cssSrc.indexOf(HOLD_BLOCK) + '.site-gate['.length,
    '[4x] the FIRST data-gate-state="hold" in the file is still that block (authtest slices the file from it to test the hold tap target and colours)');
  const holdBlockText = cssSrc.slice(cssSrc.indexOf(HOLD_BLOCK), cssSrc.indexOf('/* DI-184'));
  assert(!/#[0-9a-fA-F]{3,6}/.test(holdBlockText) && !/rgb\(/.test(holdBlockText), '[4y] …and the text between it and the next DI-184 comment still introduces no colour literal');
  // Compact lockup + holds.
  assert(/\.site-gate\[data-gate-state="hold"\] > \.site-gate-inner::before,\s*\.site-gate\[data-gate-state\] \.gate-screen:not\(\[data-screen="signin"\]\)::before\{[^}]*var\(--gate-mark-mask\)/.test(cssCode) &&
         /\.site-gate\[data-gate-state\] \.site-gate-title::before\{[^}]*content:"MUNERA" \/ ""/.test(cssCode),
    '[4z] the compact lockup is ONE pseudo-element rule pair for the holds and every sub-screen: the masked temple on the column, MUNERA (with an empty accessible name where supported) on the title');
  assert(/\.site-gate\[data-gate-state="hold"\] \.site-gate-btn\{\s*margin:0;background:transparent;color:var\(--gate-gold\);box-shadow:inset 0 0 0 1\.5px var\(--gate-gold\)/.test(cssCode),
    '[4aa] the hold\'s Retry is the quiet OUTLINED Gold button, never the filled Sign In style');
  assert(!/(?:^|[^-\w])(?:color|background|border-color):\s*(?:#f44|red|orange|amber)/i.test(scopedBodies) && !/var\(--(?:live|loss|win|push)\b/.test(scopedBodies),
    '[4ab] no red or amber reaches a hold (or any gate rule) through a theme/semantic token; the only red is the gate\'s own --gate-loss on an error card');
  // Ground and the glow.
  assert(/\.site-gate\[data-gate-state\]\{\s*color-scheme:dark;\s*padding:0;align-items:flex-start;justify-content:center;\s*background:radial-gradient\(120% 46% at 50% 0,var\(--gate-oxblood\) 0 30%,var\(--gate-glow-clear\)\) local,var\(--gate-ink\);/.test(cssCode),
    '[4ac] the ground: Oxblood solid to 30% then a same-hue fade, LOCAL (it scrolls away with the hero, so the sign-in form sits below it), over Ink');

  // Vertical rhythm — the mockup's gaps, on the 8-pt grid. Sibling margins COLLAPSE in block flow and ADD in a flex
  // column, so the two stacks that carry the gaps must be flex columns; this reads every margin back out of the CSS
  // and checks the SUMS the mockup draws (found by rendering the real markup: without the flex columns a 16px field
  // margin and an 8px button margin gave 16px, not 24px, and the alert-to-button gap was 8px, not 16px).
  assert(/\.site-gate\[data-gate-state\] \.site-gate-actions,\s*\.site-gate\[data-gate-state\] form\{display:flex;flex-direction:column;width:100%\}/.test(cssCode),
    '[4ad] .site-gate-actions and the form are FLEX COLUMNS, so the margins below add instead of collapsing');
  const rule = (sel) => { const m = new RegExp('(?:^|\\})\\s*' + escapeRe(sel) + '\\s*\\{([^}]*)\\}').exec(cssCode); return m ? m[1] : ''; };
  const margin = (body) => (/(?<![-\w])margin:([^;}]+)/.exec(body) || [])[1] || '';
  const G = '.site-gate[data-gate-state]';
  const groupMb = Number(/margin:0 0 (\d+)px/.exec(rule(`${G} .form-group`))?.[0]?.match(/(\d+)px/)?.[1]);
  const btnMt = Number(/^(\d+)px 0 0/.exec(margin(rule(`${G} .site-gate-btn`)))?.[1]);
  const errBody = cssCode.match(/\.site-gate\[data-gate-state\] \.site-gate-error,\s*\.site-gate\[data-gate-state\] \.site-gate-notice\{([^}]*)\}/)?.[1] || '';
  const alertMargin = /margin:0 0 (\d+)px/.exec(errBody)?.[1];
  assert(groupMb === 16 && btnMt === 8 && groupMb + btnMt === 24,
    `[4ae] last field to Sign In is 24px: form-group margin ${groupMb} + button margin-top ${btnMt} (the mockup's .field.last)`);
  assert(Number(alertMargin) === 8 && Number(alertMargin) + btnMt === 16,
    `[4af] an alert above a button sits 16px from it: alert margin-bottom ${alertMargin} + button margin-top ${btnMt} (mockup frame 4 / 9)`);
  assert(/\.site-gate-btn\.google-signin-btn \+ \.site-gate-error,\s*\.site-gate\[data-gate-state\] \.site-gate-btn\.google-signin-btn \+ \.site-gate-notice\{margin:8px 0 0\}/.test(cssCode),
    '[4ag] the Google slot sits 8px under the Google box — and that rule OUT-RANKS the generic button-plus-slot rule (the Google box is also a .site-gate-btn; equal specificity would let the later 16px rule win)');
  assert(/\.divider-or\{\s*display:flex;align-items:center;gap:16px;margin:24px 0;/.test(cssCode) && /\.site-gate-link-row\{display:flex;flex-direction:column;align-items:center;gap:0;margin-top:8px\}/.test(cssCode),
    '[4ah] "or" is 24px above and below; the link row is 8px under its button (mockup frame 1)');
  assert(/\.site-gate-btn \+ \.site-gate-error,\s*\.site-gate\[data-gate-state\] \.site-gate-btn \+ \.site-gate-notice\{margin:16px 0 0\}/.test(cssCode) && /\.site-gate-title \+ \.site-gate-error\{margin:8px 0 16px\}/.test(cssCode),
    '[4ai] a notice under Send Reset Link is 16px below it (frame 8); on the expired screen the alert is 16px under the title and 24px above Request a New Link (frame 10)');
  assert(/\.gate-screen:not\(\[data-screen="signin"\]\)::before\{margin-top:16px\}/.test(cssCode) &&
         /\.gate-screen:not\(\[data-screen="signin"\]\)::before\{[^}]*margin:0 auto;/.test(cssCode) && /\.site-gate\[data-gate-state\] \.site-gate-title\{[^}]*margin:8px 0;/.test(cssCode),
    '[4aj] compact lockup: the mark sits 16px from the top and 8px above the wordmark (the title\'s own 8px top margin), as frames 7-10');
  assert(/\.site-gate-title::before\{[^}]*margin-bottom:56px/.test(cssCode) && /\[data-gate-state="hold"\] \.site-gate-title::before\{margin-bottom:40px\}/.test(cssCode),
    '[4ak] wordmark to title is 56px on the sub-screens (frame 7: 16 + 32 + 8) and 40px on the hold (frame 12: 32 + 8)');
  assert(/\.site-gate-title \+ \.form-group\{margin-top:8px\}/.test(cssCode),
    '[4al] the new-password screen has no helper line, so its first label gets its own 8px under the title');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[5] Contrast — WCAG 2.x, recomputed from the token hexes (DI-437 §1.5)…');
{
  const tok = (name) => new RegExp(`${escapeRe(name)}:(#[0-9A-Fa-f]{6});`).exec(cssCode)?.[1];
  const hex = { ink: tok('--gate-ink'), marble: tok('--gate-marble'), gold: tok('--gate-gold'), card: tok('--gate-card'), border: tok('--gate-field-border'),
    secondary: tok('--gate-secondary'), muted: tok('--gate-muted'), loss: tok('--gate-loss'), oxblood: tok('--oxblood'),
    gWhite: tok('--google-btn-fill'), gStroke: tok('--google-btn-stroke'), gLabel: tok('--google-btn-label') };
  assert(Object.values(hex).every(Boolean), `[5-pre] every colour was read out of styles.css (${JSON.stringify(hex)})`);
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const lum = (c) => { const [r, g, b] = c.map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const la = lum(typeof a === 'string' ? rgb(a) : a), lb = lum(typeof b === 'string' ? rgb(b) : b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
  const near = (v, want) => Math.abs(v - want) < 0.011;
  const rows = [
    ['Marble on Ink (field text, titles)', ratio(hex.marble, hex.ink), 14.84, 4.5],
    ['Marble on Oxblood (tagline, worst case solid red)', ratio(hex.marble, hex.oxblood), 8.05, 4.5],
    ['Gold on Ink (links, focus, wordmark on Ink)', ratio(hex.gold, hex.ink), 7.84, 4.5],
    ['Ink on Gold (Sign In label)', ratio(hex.ink, hex.gold), 7.84, 4.5],
    ['Secondary on Ink (labels, helper)', ratio(hex.secondary, hex.ink), 8.67, 4.5],
    ['Secondary on card (notices)', ratio(hex.secondary, hex.card), 7.88, 4.5],
    ['Muted on card (the placeholder — its only use)', ratio(hex.muted, hex.card), 4.66, 4.5],
    ['Secondary on solid Oxblood (WORST CASE for small text that meets the glow: labels, helper, the "or" divider)', ratio(hex.secondary, hex.oxblood), 4.70, 4.5],
    ['Field border on card (non-text)', ratio(hex.border, hex.card), 3.52, 3],
    ['Loss on card (alert glyph and border)', ratio(hex.loss, hex.card), 6.19, 3],
    ['Google label on white', ratio(hex.gLabel, hex.gWhite), 16.48, 4.5],
    ['Google stroke on white (non-text)', ratio(hex.gStroke, hex.gWhite), 4.53, 3],
    ['Marble on card (alert text)', ratio(hex.marble, hex.card), 13.3, 4.5],
  ];
  for (const [label, got, want, floor] of rows) {
    assert(got >= floor && (want === 13.3 || near(got, want)), `[5a] ${label}: ${got.toFixed(2)}:1 (approved ${want}, floor ${floor})`);
  }
  const goldOnOx = ratio(hex.gold, hex.oxblood);
  assert(near(goldOnOx, 4.25) && goldOnOx < 4.5, `[5b] Gold on Oxblood is ${goldOnOx.toFixed(2)}:1 — large text only, and the ONLY gold on red is the 32px wordmark (small gold text is on Ink)`);
  const wordmarkRule = /\.site-gate\[data-gate-state\] \.site-gate-wordmark\{([^}]*)\}/.exec(cssCode)?.[1] || '';
  assert(/font:400 2rem\//.test(wordmarkRule), '[5c] …and that wordmark IS 2rem (32px, large text)');
  const blend = rgb(hex.oxblood).map((c, i) => 0.75 * c + 0.25 * rgb(hex.ink)[i]);
  const mutedOnGlow = ratio(hex.muted, blend);
  assert(Math.abs(mutedOnGlow - 3.37) < 0.05 && mutedOnGlow < 4.5,
    `[5d] Muted on 75% red is ${mutedOnGlow.toFixed(2)}:1 (fails AA). The glow is LOCAL, so the sign-in FORM sits below it — but the sub-screens (top-anchored) and the web layout at 600px+ do put small text over its fade, so Muted is reserved for the card-borne placeholder and every small text that can meet the glow is Secondary/Marble (pinned by [5k]/[5l])`);
  // Reviewer note (2026-09-29): at 600px+ the "or" divider sat on the glow's fade in Muted (~4.3:1, under 4.5).
  const blendAt = (a) => rgb(hex.oxblood).map((c, i) => a * c + (1 - a) * rgb(hex.ink)[i]);
  const H = 700, ry = 0.6 * H, solidR = 0.25 * ry, dividerY = 295; // the >=600px glow (90% 60%, solid to 25%) at a 1000x700 window, divider centre as rendered
  const glowAlpha = dividerY <= solidR ? 1 : Math.max(0, (ry - dividerY) / (ry - solidR));
  const mutedAtDivider = ratio(hex.muted, blendAt(glowAlpha)), secondaryAtDivider = ratio(hex.secondary, blendAt(glowAlpha));
  assert(mutedAtDivider < 4.5 && secondaryAtDivider >= 4.5 && secondaryAtDivider > 7,
    `[5j] at the web >=600px geometry the "or" divider sits on ~${Math.round(glowAlpha * 100)}% red: Muted would be ${mutedAtDivider.toFixed(2)}:1 (fails AA — the reviewed defect), Secondary is ${secondaryAtDivider.toFixed(2)}:1 (passes)`);
  const dividerRule = (cssCode.match(/\.site-gate\[data-gate-state\] \.divider-or\{([^}]*)\}/) || [])[1] || '';
  assert(/(?<![-\w])color:var\(--gate-secondary\)/.test(dividerRule) && !/gate-muted/.test(dividerRule),
    '[5k] the "or" divider is coloured --gate-secondary (4.70:1 even on SOLID Oxblood, 8.67:1 on Ink), on every viewport');
  const mutedUses = [...cssCode.matchAll(/(?<=^|\})\s*((?:@media[^{]*\{\s*)?(?:#site-gate-overlay )?\.site-gate\[data-gate-state[^{]*)\{([^}]*)\}/g)].filter((m) => /var\(--gate-muted\)/.test(m[2])).map((m) => m[1].trim());
  assert(mutedUses.length === 1 && /::placeholder$/.test(mutedUses[0]),
    `[5l] --gate-muted is used by exactly ONE gate rule and it is the placeholder (which sits on the card fill, 4.66:1) — never by text that can meet the glow (got ${JSON.stringify(mutedUses)})`);
  // The alpha tints must agree with the colours they are derived from.
  const rgbaOf = (name) => (new RegExp(`${escapeRe(name)}:rgba\\((\\d+),(\\d+),(\\d+),([\\d.]+)\\)`).exec(cssCode) || []).slice(1).map(Number);
  const eq = (a, b) => a.length === 3 && a.every((v, i) => v === b[i]);
  assert(eq(rgbaOf('--gate-glow-clear').slice(0, 3), rgb(hex.oxblood)) && rgbaOf('--gate-glow-clear')[3] === 0, '[5e] --gate-glow-clear is Oxblood at 0 alpha (a same-hue fade)');
  assert(eq(rgbaOf('--gate-hairline').slice(0, 3), rgb(hex.marble)), '[5f] --gate-hairline is Marble at low alpha');
  assert(eq(rgbaOf('--gate-focus-ring').slice(0, 3), rgb(hex.gold)), '[5g] --gate-focus-ring is Gold at low alpha');
  assert(eq(rgbaOf('--gate-loss-border').slice(0, 3), rgb(hex.loss)), '[5h] --gate-loss-border is Loss at 60% alpha');
  assert(eq(rgbaOf('--gate-spinner-track').slice(0, 3), rgb(hex.ink)), '[5i] --gate-spinner-track is Ink at low alpha');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[6] No-regression pins — the recovery-session predicates and the hold markup are exactly as they were…');
{
  const count = (s, k) => s.split(k).length - 1;
  // Counts taken from the pre-UN-312 tree (commit 527355f). A NEW caller of a predicate is legitimate someday and
  // should raise the number in that edit; a change that only RESTYLED the gate must not move any of them.
  const BASE = { 'isRecoverySession()': 13, 'data-recovery-variant': 3, 'currentGateIsHold()': 11, 'cancelRecovery': 7, 'showPasswordRecoveryScreen': 8,
    'updatePasswordForRecovery': 6, 'verifyPasswordRecovery': 5, 'overResolvedHold': 5 };
  for (const [k, n] of Object.entries(BASE)) {
    assert(count(appSrc, k) === n, `[6a] "${k}" appears exactly ${n} times in app.js, as before UN-312 (got ${count(appSrc, k)}) — RG-249's wiring was not touched`);
  }
  const fn = (s, name) => { const a = s.indexOf(`function ${name}(`); return s.slice(a, s.indexOf('\n}\n', a) + 3); };
  const HOLD_FN = "function authHoldGateInnerHTML(key) {\n  const copy = AUTH_HOLD_COPY[key];\n  return `\n    <div class=\"site-gate\" data-gate-state=\"hold\" data-hold-reason=\"${escHtml(key)}\">\n      <div class=\"site-gate-inner\">\n        <div class=\"site-gate-title\">${escHtml(copy.heading)}</div>\n        <div class=\"site-gate-subtitle\">${escHtml(copy.body)}</div>\n        <button class=\"site-gate-btn\" id=\"auth-hold-retry\" type=\"button\">Retry</button>\n      </div>\n    </div>`;\n}\n";
  assert(fn(appSrc, 'authHoldGateInnerHTML') === HOLD_FN, '[6b] authHoldGateInnerHTML() is byte-identical to before — DI-438 is CSS only, and the hold screens carry no lockup markup and no Google box');
  assert(fn(appSrc, 'currentGateIsHold') === "function currentGateIsHold() {\n  const ov = document.getElementById('site-gate-overlay');\n  return !!ov && ov.getAttribute?.('data-gate-state') === 'hold';\n}\n",
    '[6c] currentGateIsHold() is byte-identical — it still reads the WRAPPER\'s attribute, which the Google gate never sets');
  const appCode = appSrc.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n'); // comment lines narrate the old copy by name; the CODE is what counts
  assert((appCode.match(/irb pick 'ems/g) || []).length === 2, '[6d] "irb pick \'ems" still appears exactly twice in app.js (the PIN gate default and the commissioner field placeholder) — the dead web-gate copy is gone, brandtest [5] holds');
  assert(!/welcomeTitleTop|welcomeTitleMain/.test(appCode.slice(appCode.indexOf('export function showGoogleSignInGate('), appCode.indexOf('export function showGoogleSignInGate(') + 3000)),
    '[6e] showGoogleSignInGate() no longer reads the commissioner-editable welcome title (its only consumer was the web template)');
}

// ── Result ───────────────────────────────────────────────────────────────────
process.stdout.write(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`,
  () => process.exit(fail === 0 ? 0 : 1));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
