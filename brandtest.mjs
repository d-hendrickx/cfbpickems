/**
 * CFB Pickems — brandtest.mjs (DI-213a/DI-213i, Munera brand thread, 2026-09-19)
 * ================================================================================
 * Unit tests for js/brand.js — the two-independent-facts brand model (AD-70):
 * platform resolves the SHELL's brand name, league resolves the LEAGUE's
 * display name, and neither call site may collapse the two. Precedent:
 * grouptest.mjs/platformtest.mjs — a focused standalone suite beside
 * loadtest.mjs.
 *
 * UPDATED 2026-09-20, PASS 1b: the Supabase thread's hold on js/app.js/
 * index.html released (docs/THREAD_BOARD.md). Sections [6]/[7]/[8] below are
 * new — the two js/app.js call sites DI-213a names (header fallback, version
 * footer) and DI-213k's header-wordmark slot are now wired, so this file
 * proves the SOURCE-level wiring (escHtml at every site, per S-C2) on top of
 * brand.js's own module-level assertions from PASS 1a.
 *
 * UPDATED 2026-09-29 — UN-312 / DI-437 (the Munera login rebrand), DELIBERATELY:
 * [9]/[9a]/[9b] swap their web-gate fixture for the new one-template Munera
 * markup and gain [9c]/[9d]; [11c] covers getGateWordmark()/getGateTagline()
 * (+[11c2]/[11c3] for the raw mark); [12]-[15] and [16o] are re-pointed from
 * `body.native-shell .site-gate[...]` to the neutral `.site-gate[data-gate-state]`
 * rules; [1f]/[2f] prove the getShell* seam is untouched. The reasoning sits
 * above each replaced block. gaterebrandtest.mjs carries the deeper scan.
 *
 * Run:  node brandtest.mjs
 *
 * Covers:
 *   [1] platform==='web' ⇒ getShellBrandName()==='CFB Pickems'.
 *   [2] platform==='native' ⇒ getShellBrandName()==='Munera' AND
 *       getLeagueDisplayName()==="IRB Pick 'Ems" in the SAME call pass —
 *       proving the two facts are independent, not one flag (AD-70's actual
 *       acceptance test).
 *   [2b] getLeagueDisplayName() is IDENTICAL on both platforms — the one
 *       value a platform switch must never move.
 *   [2c] getShellWordmark() — null on web, 'MUNERA' on native (DI-213k).
 *   [3] Mutation-proof workflow marker — see the shell commands in the
 *       execute-time report; this file's assertions are what goes red/green
 *       around that mutation, not a self-mutating step (Node cannot safely
 *       mutate its own already-imported module graph mid-run).
 *   [4] Structural guard — "SCRIBE" and "MunerAI" never appear as a key or
 *       value anywhere in brand.js's source (deny-by-default pattern,
 *       mirroring notify-copy.js's own).
 *   [5] DI-213g "untouched inventory" — every intentionally-hardcoded "No"
 *       row's literal string is still present IN ITS FILE (string-in-file,
 *       never a pinned line number — coordinator note V4: app.js moves by
 *       hundreds of lines a week across threads).
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

const root = path.dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────────────────────
// UN-312 / DI-437 fixture — showGoogleSignInGate()'s rendered innerHTML,
// captured from the REAL function on 2026-09-29 (a scratch child process, the
// same technique as captureSignInGateHtml() below) and pasted via
// JSON.stringify of the captured string, so no manual retyping can introduce a
// whitespace drift the diff wouldn't show. It is the byte-identity anchor for
// the gate's markup on BOTH platforms.
//
// REPLACED, DELIBERATELY (the DI's own instruction, DI-437 §4). Until
// 2026-09-29 this constant held the WEB gate as it stood before DI-216
// ("welcome to / irb pick 'ems", no data-gate-state), updated in place by
// DI-310, DI-332, reviewer round 3 item 6 and the 2026-09-26 audit — the proof
// that web had not moved without an explicit instruction. UN-312 (Drew,
// 2026-09-29; his Q7 ruling: the web login says Munera, amending UN-215 facet 2
// for this one screen) IS such an instruction, and the biggest this fixture has
// absorbed: ONE template for web and native, the Munera lockup, the
// .gate-screen / .site-gate-hero / .site-gate-actions wrappers,
// data-gate-state="google" on web too, the Google message slot directly under
// its button, the email/password message slot inside the form. The Google
// button node itself is byte-identical to the old fixture's. The old constant
// and its update history are in git (this file, before the UN-312 commit).
const MUNERA_GATE_FIXTURE = "\n    <div class=\"site-gate\" data-gate-state=\"google\">\n      <div class=\"site-gate-inner\">\n        <div class=\"gate-screen\" data-screen=\"signin\">\n          <div class=\"site-gate-hero\">\n          <svg class=\"site-gate-mark\" viewBox=\"205 250 614 495\" width=\"72\" height=\"58\" fill=\"currentColor\" aria-hidden=\"true\" focusable=\"false\">\n  <path d=\"M 212 393 L 499.25 262.78 Q 512 257 524.75 262.78 L 812 393 L 812 401 Q 812 417 796 417 L 228 417 Q 212 417 212 401 L 212 393 Z\"/>\n  <rect x=\"296\" y=\"445.57\" width=\"78\" height=\"154.29\"/>\n  <rect x=\"473\" y=\"445.57\" width=\"78\" height=\"154.29\"/>\n  <rect x=\"650\" y=\"445.57\" width=\"78\" height=\"154.29\"/>\n  <rect x=\"260\" y=\"599.86\" width=\"504\" height=\"51.43\" rx=\"7.71\"/>\n  <rect x=\"212\" y=\"679.86\" width=\"600\" height=\"57.14\" rx=\"22.86\"/>\n</svg>\n          <div class=\"site-gate-wordmark\">MUNERA</div>\n          <div class=\"site-gate-tagline\">Enter the arena.</div>\n        </div>\n          <div class=\"site-gate-actions\">\n            <button class=\"site-gate-btn google-signin-btn\" id=\"google-gate-submit\" type=\"button\">\n          <span class=\"google-g-mark\"><svg viewBox=\"0 0 18 18\" width=\"18\" height=\"18\" aria-hidden=\"true\" focusable=\"false\">\n  <path fill=\"#4285F4\" d=\"M17.64 9.2045c0-.6381-.0573-1.2518-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2581h2.9087c1.7018-1.5668 2.6836-3.874 2.6836-6.615z\"/>\n  <path fill=\"#34A853\" d=\"M9 18c2.43 0 4.4673-.8059 5.9564-2.1805l-2.9087-2.2581c-.8059.54-1.8368.8591-3.0477.8591-2.3436 0-4.3282-1.5831-5.0359-3.7104H.9573v2.3318C2.4382 15.9832 5.4818 18 9 18z\"/>\n  <path fill=\"#FBBC05\" d=\"M3.9641 10.71c-.18-.54-.2823-1.1168-.2823-1.71s.1023-1.17.2823-1.71V4.9582H.9573A8.9965 8.9965 0 000 9c0 1.4523.3477 2.8264.9573 4.0418L3.9641 10.71z\"/>\n  <path fill=\"#EA4335\" d=\"M9 3.5795c1.3214 0 2.5077.4541 3.4404 1.346l2.5818-2.5818C13.4632.8918 11.4259 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9582L3.9641 7.29C4.6718 5.1627 6.6564 3.5795 9 3.5795z\"/>\n</svg></span>\n          <span id=\"google-gate-btn-label\">Continue with Google</span>\n        </button>\n            <div id=\"google-gate-message\" style=\"display:none\"></div>\n            \n    <div class=\"divider-or\" aria-hidden=\"true\"><span>or</span></div>\n    <form id=\"pwacct-gate-form\" method=\"post\" novalidate>\n    <div class=\"form-group\">\n      <label class=\"form-label\" for=\"pwacct-email\">Email</label>\n      <input class=\"form-input\" id=\"pwacct-email\" name=\"email\" type=\"email\" inputmode=\"email\" autocomplete=\"email\" placeholder=\"you@example.com\" required />\n    </div>\n    <div class=\"form-group\">\n      <label class=\"form-label\" for=\"pwacct-password\">Password</label>\n      <input class=\"form-input\" id=\"pwacct-password\" name=\"password\" type=\"password\" autocomplete=\"current-password\" required />\n    </div>\n    <div id=\"pwacct-gate-message\" style=\"display:none\"></div>\n    <button class=\"site-gate-btn\" id=\"pwacct-gate-submit\" type=\"submit\" data-mode=\"signin\">Sign In</button>\n    </form>\n    <div class=\"site-gate-link-row\">\n      <button type=\"button\" class=\"site-gate-link\" id=\"pwacct-forgot-link\">Forgot password?</button>\n      <button type=\"button\" class=\"site-gate-link\" id=\"pwacct-mode-toggle\">New here? Create an account</button>\n    </div>\n          </div>\n        </div>\n      </div>\n    </div>";

/**
 * Runs showGoogleSignInGate() in a fresh child process (own event loop, own
 * module graph — importing js/app.js has real side effects at module scope,
 * nativeguardtest.mjs [8]'s own reasoning for why this can't share a process
 * with the rest of this file's plain dynamic imports) with a minimal DOM/
 * localStorage stub, optionally with a Capacitor bridge present, and returns
 * the innerHTML written to #site-gate-overlay.
 */
function captureSignInGateHtml({ native }) {
  const appUrl = new URL('./js/app.js', import.meta.url).href;
  const child = [
    "const store = new Map();",
    "globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), clear: () => store.clear() };",
    "const registry = new Map();",
    "function makeEl() { return { id: '', _html: '', get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); }, appendChild() {}, remove() { if (this.id) registry.delete(this.id); }, addEventListener() {}, removeEventListener() {}, classList: { add(){}, remove(){} }, style: {}, dataset: {} }; }",
    "globalThis.document = { addEventListener(){}, removeEventListener(){}, getElementById: id => registry.get(id) || null, querySelector: () => null, querySelectorAll: () => [], createElement: () => makeEl(), body: { appendChild(node){ if (node.id) registry.set(node.id, node); }, classList:{add(){},remove(){}}, innerHTML:'' }, hidden: false };",
    native
      ? "globalThis.window = { Capacitor: { isNativePlatform: () => true } };"
      : "globalThis.window = globalThis;",
    "try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; } catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined, clipboard: { writeText: async () => {} } }, configurable: true }); }",
    "globalThis.requestAnimationFrame = fn => fn();",
    "globalThis.matchMedia = () => ({ matches: false });",
    "globalThis.confirm = () => true; globalThis.prompt = () => null; globalThis.alert = () => {};",
    "if (!globalThis.crypto || !globalThis.crypto.randomUUID) globalThis.crypto = { randomUUID: () => 'u_fixture' };",
    "globalThis.fetch = async () => { throw new Error('network disabled in brandtest gate capture'); };",
    "const app = await import(process.env.APP_URL);",
    "app.showGoogleSignInGate();",
    "const overlay = registry.get('site-gate-overlay');",
    "console.log('GATE-HTML-JSON:' + JSON.stringify(overlay ? overlay.innerHTML : null));",
  ].join('\n');
  const run = spawnSync(process.execPath, ['--input-type=module', '--eval', child], {
    encoding: 'utf8', timeout: 20000, env: { ...process.env, APP_URL: appUrl },
  });
  const out = `${run.stdout || ''}${run.stderr || ''}`;
  const m = /GATE-HTML-JSON:(.*)/.exec(out);
  return { html: m ? JSON.parse(m[1]) : null, status: run.status, raw: out };
}

// ─────────────────────────────────────────────────────────────────────────────
// [1]/[2]/[2b]/[2c] — the two-fact model
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[1] web platform — brand.js is byte-for-byte the pre-existing web string…');
{
  globalThis.window = {};
  const brand = await import('./js/brand.js');
  assert(brand.getPlatform() === 'web', '[1a] no window.Capacitor → getPlatform()==="web"');
  assert(brand.getShellBrandName() === 'CFB Pickems', '[1b] web → getShellBrandName()==="CFB Pickems" — the value that must never change on this platform');
  assert(brand.getLeagueDisplayName() === "IRB Pick 'Ems", "[1c] web → getLeagueDisplayName()===\"IRB Pick 'Ems\"");
  assert(brand.getShellWordmark() === null, '[1d] web → getShellWordmark()===null (no in-app wordmark on the web platform, DI-213k)');
  assert(brand.getShellTagline() === null, '[1e] web → getShellTagline()===null (no in-app tagline on the web platform, DI-216) — checked DIRECTLY, not just through showGoogleSignInGate()\'s web branch, which never calls this function at all and so cannot catch a getShellTagline() that leaked the native string onto every platform');
  assert(brand.getGateWordmark() === 'MUNERA' && brand.getGateTagline() === 'Enter the arena.',
    '[1f] UN-312 — …while the gate lockup functions answer on WEB too (getGateWordmark()==="MUNERA", getGateTagline()==="Enter the arena."): the two seams are separate, so the header wordmark above stays null on web and only the sign-in gate says Munera (Drew\'s Q7, amending UN-215 facet 2 for one screen)');
}

console.log('\n[2] native platform — Munera chrome, IRB league, in the SAME pass…');
{
  globalThis.window = { Capacitor: { isNativePlatform: () => true } };
  const brand = await import('./js/brand.js');
  const platform = brand.getPlatform();
  const shellName = brand.getShellBrandName();
  const leagueName = brand.getLeagueDisplayName();
  assert(platform === 'native', '[2a] window.Capacitor.isNativePlatform()===true → getPlatform()==="native"');
  assert(shellName === 'Munera', `[2b] native → getShellBrandName()==="Munera" (got "${shellName}")`);
  assert(leagueName === "IRB Pick 'Ems",
    `[2c] …AND in the SAME render pass, getLeagueDisplayName() is STILL "IRB Pick 'Ems" — the two facts do not collapse into one flag (AD-70's acceptance test) (got "${leagueName}")`);
  assert(brand.getShellWordmark() === 'MUNERA', "[2d] native → getShellWordmark()===\"MUNERA\" (DI-213k)");
  assert(brand.getShellTagline() === 'Enter the arena.', `[2e] native → getShellTagline()==="Enter the arena." (DI-216, got "${brand.getShellTagline()}")`);
  assert(brand.getGateWordmark() === 'MUNERA' && brand.getGateTagline() === 'Enter the arena.' && brand.getGateMarkSVG().startsWith('<svg'),
    '[2f] UN-312 — the gate lockup functions return the SAME values on native (platform-independent by design: they never read isNativeShell())');
}

console.log("\n[2b] getLeagueDisplayName() is IDENTICAL across both platforms…");
{
  globalThis.window = {};
  const webBrand = await import('./js/brand.js');
  const webLeague = webBrand.getLeagueDisplayName();
  globalThis.window = { Capacitor: { isNativePlatform: () => true } };
  const nativeLeague = webBrand.getLeagueDisplayName();
  assert(webLeague === nativeLeague && webLeague === "IRB Pick 'Ems",
    `[2b-1] league name is the SAME literal regardless of which platform reads it (web="${webLeague}", native="${nativeLeague}")`);
}

// ─────────────────────────────────────────────────────────────────────────────
// [4] Structural guard — SCRIBE/MunerAI never enter brand.js's tables
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[4] Structural guard — "SCRIBE" / "MunerAI" never appear in brand.js…');
{
  const brandSrc = await readFile(path.join(root, 'js', 'brand.js'), 'utf8');
  // DI-213i's own scope: "the literal substring 'SCRIBE' never appears as a
  // key or value anywhere in brand.js's LOOKUP TABLES" — the module's own
  // header comment legitimately DISCUSSES the constraint by name (exactly
  // like this test file does), so the scan strips comments first (same
  // `stripComments` technique loadtest.mjs's own SCRIBE-pool guard uses)
  // and asserts against the remaining CODE — the actual resolution tables —
  // never against prose that documents the rule.
  const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  const brandCode = stripComments(brandSrc);
  // Reviewer note — NON-VACUITY. 4a/4b below would pass trivially if
  // stripComments() stripped EVERYTHING (a no-op regex bug, or brand.js
  // simply never mentioning "SCRIBE" anywhere including its own header
  // comment). Prove the RAW source actually contains the string at least
  // once — this file's own header comment does, by design — and that the
  // stripped version is shorter, so 4a/4b are known to be testing something
  // real rather than passing because there was never anything to strip.
  assert(/SCRIBE/.test(brandSrc), '[4-pre] non-vacuity: the RAW (pre-strip) source mentions "SCRIBE" at least once (in a comment) — otherwise 4a below proves nothing');
  assert(brandCode.length < brandSrc.length, '[4-pre] non-vacuity: stripComments() actually removed characters — a no-op strip would make 4a/4b vacuous');
  assert(!/SCRIBE/.test(brandCode),
    '[4a] the literal substring "SCRIBE" never appears in brand.js\'s CODE (comments stripped) — SCRIBE keeps its name, this module never touches it (AD-70/AD-72)');
  assert(!/MunerAI/.test(brandCode),
    '[4b] the literal substring "MunerAI" never appears in brand.js\'s CODE (comments stripped) — never resolved as an in-app persona name (Drew\'s ruling, AD-72)');
}

// ─────────────────────────────────────────────────────────────────────────────
// [6]/[7]/[8] — PASS 1b: the app.js call sites are now wired
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[6] js/app.js header-meta fallback — wired through getShellBrandName(), escHtml\'d…');
{
  const appSrc = await readFile(path.join(root, 'js', 'app.js'), 'utf8');
  assert(appSrc.includes("el.innerHTML = `<strong>${escHtml(getShellBrandName())}</strong>`;"),
    '[6a] the header-meta no-week fallback resolves through getShellBrandName(), wrapped in escHtml — never a raw literal again');
  assert(!/'<strong>CFB Pickems<\/strong>'/.test(appSrc),
    '[6b] the OLD hardcoded literal is gone from this call site (replaced, not duplicated)');
}

console.log('\n[7] js/app.js version footer — wired through getShellBrandName(), escHtml\'d…');
{
  const appSrc = await readFile(path.join(root, 'js', 'app.js'), 'utf8');
  assert(appSrc.includes('${escHtml(getShellBrandName())} ${escHtml(APP_VERSION)} · ${escHtml(APP_VERSION_DATE)}'),
    '[7a] the version footer resolves through getShellBrandName(), escHtml\'d — S-C2\'s exact assertion: no unescaped interpolation of the shell brand string');
  assert(!/CFB Pickems \$\{escHtml\(APP_VERSION\)\}/.test(appSrc),
    '[7b] the OLD hardcoded "CFB Pickems ${...}" literal is gone from this call site');
}

console.log('\n[8] js/app.js — DI-213k header wordmark, native-only, escHtml\'d, no DOM element on web…');
{
  const appSrc = await readFile(path.join(root, 'js', 'app.js'), 'utf8');
  assert(/import\s*\{\s*getShellBrandName,\s*getShellWordmark,\s*getShellTagline\s*\}\s*from\s*['"]\.\/brand\.js['"]/.test(appSrc),
    '[8a] app.js imports getShellWordmark (and, since DI-216, getShellTagline) alongside getShellBrandName from ./brand.js — one seam, not a re-implementation');
  assert(/function initNativeWordmark\(\)\s*\{\s*if \(!isNativeShell\(\)\) return;/.test(appSrc),
    '[8b] initNativeWordmark() gates on isNativeShell() as its FIRST line — on web this function is a single false-check, never reaching document.createElement');
  assert(appSrc.includes("wm.innerHTML = escHtml(getShellWordmark() || '');"),
    '[8c] the wordmark text is escHtml\'d before it ever reaches innerHTML (S-C2 — even though getShellWordmark() only ever returns a fixed literal today, the same rule every other rendered string gets)');
  // REVIEWER F4 (pass-2, wiring pass 3a-bis, 2026-09-25) — the wordmark used
  // to anchor on `#league-pill`, which F4's header declutter just removed
  // from the DOM entirely (index.html no longer carries that id at all —
  // headermetatest.mjs's own [hdr-a] pins the absence). An unfixed anchor
  // would make `document.getElementById('league-pill')` return null forever,
  // silently disabling the native wordmark — a real regression to a shipped,
  // Drew-approved feature (DI-213k). Re-anchored on `#sync-badge`, the one
  // element `.header-right` is still guaranteed to have.
  // Scoped to the FUNCTION BODY, not the whole file — renderLeaguePill()
  // legitimately still looks up 'league-pill' (to no-op safely now that the
  // element is gone); this assertion is only about initNativeWordmark().
  const wmFnStart = appSrc.indexOf('function initNativeWordmark()');
  assert(wmFnStart !== -1, '[8d] fixture: initNativeWordmark() found in js/app.js');
  const wmFnBody = appSrc.slice(wmFnStart, appSrc.indexOf('\n}', wmFnStart));
  assert(!wmFnBody.includes("document.getElementById('league-pill')"),
    '[8d] initNativeWordmark() no longer references the removed #league-pill id at all');
  assert(/const anchor = document\.getElementById\('sync-badge'\);/.test(wmFnBody) && /anchor\.parentNode\.insertBefore\(wm, anchor\);/.test(wmFnBody),
    '[8e] the wordmark now anchors on #sync-badge (still present) and still inserts itself BEFORE its anchor — same left-of-badge position as before');
}

// ─────────────────────────────────────────────────────────────────────────────
// [5] DI-213g "untouched inventory" — string-in-file, never a line number
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[5] DI-213g untouched inventory — every intentionally-hardcoded "No" row is still present…');
{
  // Each row: [relative file, exact substring expected, why it must stay].
  // Per coordinator note V4: this is a STRING-IN-FILE check, never a pinned
  // line number, because app.js moves by hundreds of lines a week across
  // threads and a line-pinned test would go red on every other thread's
  // commit.
  const INVENTORY = [
    ['index.html', '<title>CFB Pickems</title>', 'no address bar/tab strip exists in the native shell for a <title> to appear in'],
    // RE-DERIVED (SP-52 DI-453, 2026-10-01): the static tag was the stale Aggie #500000 first value; it is Munera crimson #8C1515 now (and an inline block
    // replaces it with the resolved --chrome-bg of the player's look before first paint). The row's INTENT is unchanged: the tag still exists, web-PWA only.
    ['index.html', '<meta name="theme-color" content="#8C1515" />', 'web-PWA-install-specific metadata; irrelevant once running as a true native shell'],
    ['index.html', '<meta name="apple-mobile-web-app-title" content="Pickems" />', 'same reasoning — no "Add to Home Screen" step exists to read it in the native shell'],
    ['manifest.json', '"name": "CFB Pickems",', 'the native shell has its own app-icon/display-name assets (DI-214) and never reads manifest.json'],
    ['manifest.json', '"short_name": "Pickems",', 'same reasoning — must stay correct for the web PWA install'],
    ['js/app.js', 'value="CFB Pickems update"', 'league communication (commissioner broadcast) — outbound content, not shell chrome'],
    ['js/app.js', "'CFB Pickems update'", 'same reasoning — the broadcast subject default'],
    ['js/app.js', "'Your CFB Pickems PIN'", 'legacy PIN-reset copy, pre-Supabase auth model — flagged as a residual-cleanup candidate, not converted or fixed here'],
    ['js/app.js', '— Sent from CFB Pickems', 'outbound league content (broadcast/recap footer), not app-shell branding'],
    ['js/app.js', 'CFB Pickems — ${formatWeekLabel(week)} recap', 'recap email subject — outbound league content'],
    ['js/app.js', 'CFB Pickems feedback — ${entry.name}', 'feedback email subject — outbound league content'],
    // N1 (DI-430, 2026-09-30) — RETIRED, not left stale: the create form's `e.g. IRB Pick 'Ems` placeholder was an inventory entry ("generic example placeholder for creating
    // ANY future league"). The inline create form is gone (the New League sheet replaced it) and its neutral placeholder is `e.g. Saturday Crew` (js/league-create.js); the
    // pilot league's name in a placeholder was the pilot-specific string DI-430 removes. Its ABSENCE is asserted below.
    // RE-DERIVED at v0.28.0 (round 3b step 5, 2026-09-30): this row pinned the OLD page's date line, "IRB Pick 'Ems (irbfootball.com) · last updated …". Drew approved RD-01 v2.0.0-draft.3
    // ("Approve RD-01 v2.0.0-draft.3", 2026-09-30) and the page now carries that text word for word (privacytest.mjs pins every word), whose own line is "Munera (irbfootball.com and the Munera
    // iPhone app)". The row's INTENT survives: the page deliberately keeps the league's original name where it is history, not shell chrome — it still says "Munera, first built as IRB Pick 'Ems".
    // Re-pinned at v0.29.0 (2026-10-02): the page now carries RD-01 v3.0.0 (Drew, 2026-10-01: "privacy policy approved"), which adds the News sentences and leaves this opening sentence
    // untouched — so the needle is unchanged and only this reason text names v3.0.0 (PUBLISH_SPEC_RD-01_v3.0.0 §4).
    ['privacy.html', "Munera, first built as IRB Pick 'Ems", "privacy content naming the league's own history and data practices (the approved RD-01 v3.0.0 text, pinned word for word by privacytest.mjs) — true and identical on both shells"],
    ['js/push-onesignal.js', 'irbfootball.com/OneSignalSDKWorker.js', 'a code comment — never rendered to any user'],
  ];
  for (const [file, needle, why] of INVENTORY) {
    let src = '';
    try { src = await readFile(path.join(root, file), 'utf8'); } catch { src = ''; }
    assert(src.includes(needle),
      `[5] ${file} still contains "${needle}" — ${why}`);
  }

  const appSrcN1 = await readFile(path.join(root, 'js', 'app.js'), 'utf8');
  const lcSrcN1 = await readFile(path.join(root, 'js', 'league-create.js'), 'utf8');
  assert(!appSrcN1.includes("e.g. IRB Pick 'Ems") && !lcSrcN1.includes("IRB Pick 'Ems") && lcSrcN1.includes("e.g. Saturday Crew"),
    "[5] N1 (DI-430): the create placeholder is the neutral \"e.g. Saturday Crew\" and the pilot league's name is in neither the retired app.js placeholder nor the New League module");

  // welcomeTitleMain default — appears twice (js/app.js's two render call
  // sites for the welcome header), asserted as one substring check since
  // both sites share the identical literal.
  const appSrc = await readFile(path.join(root, 'js', 'app.js'), 'utf8');
  const welcomeCount = (appSrc.match(/irb pick 'ems/g) || []).length;
  assert(welcomeCount >= 2,
    `[5] js/app.js still contains the "irb pick 'ems" welcome-title/placeholder default at least twice (found ${welcomeCount}) — this IS the league display name, already correctly IRB on both platforms; changing it would violate Decision 1`);

  // js/notify-copy.js — the NEGATIVE claim from DI-213g's inventory: this
  // file contains NO app-name brand string anywhere in its templates.
  const notifyCopySrc = await readFile(path.join(root, 'js', 'notify-copy.js'), 'utf8');
  assert(!/CFB Pickems/.test(notifyCopySrc) && !/IRB Pick 'Ems/.test(notifyCopySrc),
    "[5] js/notify-copy.js still contains no app-name brand string anywhere in its templates (push/notification copy stays brand-neutral — confirmed by direct read, per DI-213g)");
}

console.log('\n(NOT asserted here, named explicitly per DI-213g: the derivative js/chat-ui.js title-prefix code and the index.html:63-107 inline theme-bootstrap duplicate have no FIXED literal of their own to pin — both are "not touched, on purpose" structural findings, not string-value rows.)');

// ─────────────────────────────────────────────────────────────────────────────
// [9]/[10]/[11] — DI-216: the native sign-in gate goes Munera. Web stays
// byte-identical (DI-216j/A3); native gets the Ink/Gold wordmark+tagline
// chrome (coordinator amendment A1).
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[9] UN-312/DI-437 — showGoogleSignInGate() renders ONE markup on web and native, byte-pinned to the Munera fixture…');
{
  const web = captureSignInGateHtml({ native: false });
  assert(web.status === 0, `[9-pre] the capture child process exited 0 (got ${web.status})${web.status === 0 ? '' : '\n' + web.raw.slice(-900)}`);
  assert(web.html === MUNERA_GATE_FIXTURE,
    `[9a] web's rendered gate markup is EXACTLY the UN-312 fixture — no stray attribute, class, copy change or reflow (mismatch: ${web.html === null ? 'capture failed' : 'strings differ'})`);
  assert(/data-gate-state="google"/.test(web.html || ''),
    '[9b] …and web NOW carries data-gate-state="google" (Q7, amending UN-215 facet 2 for this screen; this assertion used to be the attribute\'s ABSENCE on web — the reversal is the approved change, not a regression)');
  const native = captureSignInGateHtml({ native: true });
  assert(native.status === 0 && native.html === web.html,
    '[9c] native\'s markup is byte-identical to web\'s — one template, not a native/web pair (the drift that produced the old two-looks gate)');
  assert(!/welcome to/i.test(web.html || '') && !/irb/i.test(web.html || ''),
    '[9d] no "welcome to" and no "IRB" anywhere in the gate markup (UN-312 F1); league identity appears after sign-in');
}

console.log('\n[10] DI-216 — showGoogleSignInGate() on NATIVE renders the Munera wordmark/tagline chrome…');
{
  const { html, status, raw } = captureSignInGateHtml({ native: true });
  assert(status === 0, `[10-pre] the capture child process exited 0 (got ${status})${status === 0 ? '' : '\n' + raw.slice(-900)}`);
  const h = html || '';
  assert(/data-gate-state="google"/.test(h),
    '[10a] native carries the data-gate-state="google" attribute (DI-216h — CSS targeting primitive, mirrors the hold gate\'s data-gate-state="hold")');
  assert(/>MUNERA</.test(h),
    '[10b] the wordmark text "MUNERA" (getShellWordmark()) is rendered on native');
  assert(/>Enter the arena\.</.test(h),
    '[10c] the tagline "Enter the arena." (getShellTagline()) is rendered on native');
  // UPDATED — DI-310 (T-01, 2026-09-25, UX Revamp wiring pass 1) DELETES the
  // native sub-line entirely ("sub-line removed"). Re-asserted as an
  // ABSENCE rather than silently dropped.
  assert(!/Sign in to make your picks\./.test(h),
    '[10d] DI-310 — the native sub-line is GONE, not merely restyled');
  assert(!/welcome to/i.test(h) && !/irb pick 'ems/i.test(h),
    '[10e] the old "welcome to / irb pick \'ems" eyebrow+title is GONE on native — this is the whole point of the amendment');
  assert(/id="google-gate-submit"/.test(h) && /Continue with Google/.test(h),
    '[10f] the Google button is present, unchanged id and label');
  const webCapture = captureSignInGateHtml({ native: false });
  const webBtnMatch = /<button class="site-gate-btn google-signin-btn"[\s\S]*?<\/button>/.exec(webCapture.html || '');
  const nativeBtnMatch = /<button class="site-gate-btn google-signin-btn"[\s\S]*?<\/button>/.exec(h);
  assert(!!webBtnMatch && !!nativeBtnMatch && webBtnMatch[0] === nativeBtnMatch[0],
    '[10g] the button node — markup, id, .google-g-mark chip, label — is BYTE-IDENTICAL between web and native (DI-216g/l: only its ENCLOSING color inherits from CSS, never its markup)');
  assert(/id="google-gate-message"/.test(h),
    '[10h] the message slot still exists on native (same DOM primitive, per DI-216h — position may differ from web, content/id do not)');
}

console.log('\n[11] S-C2 / DI-216 — source-level: no unescaped interpolation of any brand.js string in app.js…');
{
  const appSrc = await readFile(path.join(root, 'js', 'app.js'), 'utf8');
  assert(/import\s*\{\s*isNativeShell\s*\}\s*from\s*['"]\.\/platform\.js['"]/.test(appSrc),
    '[11a] app.js still imports isNativeShell from ./platform.js (no second predicate implementation, AD-68)');
  assert(/import\s*\{\s*getShellBrandName,\s*getShellWordmark,\s*getShellTagline\s*\}\s*from\s*['"]\.\/brand\.js['"]/.test(appSrc),
    '[11b] app.js imports getShellTagline alongside the existing brand.js imports — one seam, not a re-implementation');
  // Every call to getShellWordmark()/getShellTagline()/getShellBrandName()
  // inside app.js's source must be wrapped in escHtml( ... ) — a raw
  // `${getShellWordmark()}`/`${getShellTagline()}` inside a template literal
  // (with nothing between `${` and the call) is the unescaped-interpolation
  // shape S-C2 exists to catch.
  const rawInterpolation = /\$\{\s*(getShellWordmark|getShellTagline|getShellBrandName|getGateWordmark|getGateTagline)\s*\(/g;
  const offenders = [...appSrc.matchAll(rawInterpolation)];
  assert(offenders.length === 0,
    `[11c] no unescaped \${getShellWordmark()}/\${getShellTagline()}/\${getShellBrandName()}/\${getGateWordmark()}/\${getGateTagline()} interpolation anywhere in app.js (S-C2; UN-312 extends the scan to the gate lockup's text) — found ${offenders.length} (every call site must read \${escHtml(getXxx() ...)})`);
  assert(/escHtml\(getGateWordmark\(\)\)/.test(appSrc) && /escHtml\(getGateTagline\(\)\)/.test(appSrc),
    '[11c-pre] non-vacuity: the gate lockup DOES interpolate both texts, each through escHtml() — the scan above is not passing because the calls vanished');
  // getGateMarkSVG() is the ONE deliberately-raw injection (a fixed-literal logo asset, like GOOGLE_G_MARK_SVG):
  // pin that it is called exactly once, inside gateLockupHTML(), and that brand.js builds it with no interpolation at all.
  const markCalls = [...appSrc.matchAll(/\$\{\s*getGateMarkSVG\(\)\s*\}/g)];
  const lockupFn = appSrc.slice(appSrc.indexOf('function gateLockupHTML('), appSrc.indexOf('function gateLockupHTML(') + 700);
  assert(markCalls.length === 1 && /\$\{\s*getGateMarkSVG\(\)\s*\}/.test(lockupFn),
    `[11c2] getGateMarkSVG() is injected raw in EXACTLY one place, inside gateLockupHTML() (found ${markCalls.length}) — a fixed-literal logo asset, never user data`);
  const brandSrcForMark = await readFile(path.join(root, 'js', 'brand.js'), 'utf8');
  const markFn = brandSrcForMark.slice(brandSrcForMark.indexOf('export function getGateMarkSVG()'), brandSrcForMark.indexOf('export function getGateWordmark()'));
  const markFnCode = markFn.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ').trim();
  assert(markFn.length > 200 && /^export function getGateMarkSVG\(\) \{\s*return `[^`$]*`;\s*\}$/.test(markFnCode),
    '[11c3] getGateMarkSVG() in brand.js is EXACTLY a parameterless function returning one template literal with no interpolation, no concatenation and no other statement — so injecting it raw cannot carry data (xsstest\'s classifier does not police the inside of that template; this does)');
  const brandSrc = await readFile(path.join(root, 'js', 'brand.js'), 'utf8');
  assert(!/SCRIBE/.test(brandSrc.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')) &&
         !/MunerAI/.test(brandSrc.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')),
    '[11d] brand.js\'s lookup tables still contain neither "SCRIBE" nor "MunerAI" after adding getShellTagline() (re-asserted here, DI-216 scope)');
}

// ─────────────────────────────────────────────────────────────────────────────
// [12]-[15] — UN-312 / DI-437 (2026-09-29): RE-POINTED, deliberately.
//
// Until 2026-09-29 these four sections pinned the DI-216/DI-310 native-only
// rules (`body.native-shell .site-gate[data-gate-state="google"] ...`: Georgia +
// Baskerville, Gold on Ink, the 38vh/47.44px wordmark centring, the 500px
// landscape media query). UN-312 replaces that block with NEUTRAL rules on
// `.site-gate[data-gate-state]` — one look on web and native, no
// `body.native-shell` prefix (DI-437 §1.3; Drew's Q7). Leaving the old pins in
// place would have been the two-looks failure the DI names, so each section
// keeps its job and is pointed at the new selector; the ones that pinned a
// value the redesign deliberately retired (the 22:7/11:5 size ratio, the
// vh-centring constant) are replaced by the value that replaced them, and the
// old text is in git. gaterebrandtest.mjs carries the deeper CSS scan.
// ─────────────────────────────────────────────────────────────────────────────
const G_SCOPE = '.site-gate[data-gate-state]';
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cssRule = (css, selector) => {
  const m = new RegExp('(?:^|\\n)' + escapeRe(selector) + '\\{([^}]*)\\}').exec(css);
  return m ? m[1] : null;
};
const stripCssComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ');

console.log('\n[12] UN-312 — the gate\'s type system: ONE serif token (Georgia), used for the lockup and titles only…');
{
  const cssSrc = await readFile(path.join(root, 'css', 'styles.css'), 'utf8');
  const cssCode = stripCssComments(cssSrc);
  const wordmark = cssRule(cssSrc, `${G_SCOPE} .site-gate-wordmark`);
  const tagline = cssRule(cssSrc, `${G_SCOPE} .site-gate-tagline`);
  const title = cssRule(cssSrc, `${G_SCOPE} .site-gate-title`);
  const ground = cssRule(cssSrc, G_SCOPE);
  assert(!!wordmark && !!tagline && !!title && !!ground,
    '[12-pre] the neutral .site-gate[data-gate-state] ground, wordmark, tagline and title rules all exist (fixture check for 12a-g)');
  assert(cssCode.length < cssSrc.length,
    '[12-pre] non-vacuity: stripping comments actually removed characters — a no-op strip would make 12d/12e count comment prose');
  assert(/font:400 2rem\/1\.15 var\(--gate-font-serif\)/.test(wordmark || '') && /letter-spacing:\.16em/.test(wordmark || '') && /color:var\(--gate-gold\)/.test(wordmark || ''),
    `[12a] wordmark: 2rem Georgia token, .16em tracking, Gold (got "${wordmark}")`);
  assert(/font:400 1rem\/1\.25 var\(--gate-font-serif\)/.test(tagline || '') && /letter-spacing:\.07em/.test(tagline || '') && /color:var\(--gate-marble\)/.test(tagline || ''),
    `[12b] tagline: 1rem Georgia token, .07em tracking, MARBLE (Gold on the red would be 4.25:1 — fails for 16px; Marble is 8.05:1) (got "${tagline}")`);
  assert(/font:400 1\.625rem\/1\.2 var\(--gate-font-serif\)/.test(title || '') && /text-transform:none/.test(title || ''),
    `[12c] screen titles: 1.625rem Georgia token, sentence case (text-transform:none ends the lowercase Courier) (got "${title}")`);
  assert((cssCode.match(/Georgia/g) || []).length === 1 && (cssCode.match(/Baskerville/g) || []).length === 0,
    `[12d] "Georgia" is declared EXACTLY once in styles.css's CODE (the --gate-font-serif token) and "Baskerville" never — was five Georgia + one Baskerville across the native block (got ${(cssCode.match(/Georgia/g) || []).length}/${(cssCode.match(/Baskerville/g) || []).length})`);
  assert(/--gate-font-serif:Georgia,'Times New Roman',serif;/.test(cssCode),
    '[12e] the token is exactly Georgia,\'Times New Roman\',serif');
  assert(!/body\.native-shell\s+\.site-gate/.test(cssCode),
    '[12f] no `body.native-shell .site-gate…` selector remains in CSS code — one look for one screen (DI-437 §1.3)');
  assert(/radial-gradient\(120% 46% at 50% 0,var\(--gate-oxblood\) 0 30%,var\(--gate-glow-clear\)\) local,var\(--gate-ink\)/.test(ground || '') && /color-scheme:dark/.test(ground || ''),
    `[12g] the ground is the Oxblood glow (120% 46%, LOCAL so it scrolls away with the hero) over Ink, colour-scheme dark (got "${(ground || '').slice(0, 200)}")`);
  assert(/align-items:flex-start/.test(ground || '') && /padding:0/.test(ground || ''),
    '[12h] the scroller is top-aligned with no padding of its own (the column carries the safe-area padding)');
}

// ─────────────────────────────────────────────────────────────────────────────
// [13] — colours pinned: every gate value is a token, the tokens are the mockup's
// hexes, and the gate reads NO theme token.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[13] UN-312 — the gate\'s colours are gate-scoped tokens with the approved hexes; no theme token leaks in…');
{
  const cssSrc = await readFile(path.join(root, 'css', 'styles.css'), 'utf8');
  const cssCode = stripCssComments(cssSrc);
  const TOKENS = { '--gate-ink': '#14110E', '--gate-marble': '#E8E4DC', '--gate-gold': '#C9A24B', '--gate-card': '#1F1B17',
    '--gate-field-border': '#7A7062', '--gate-secondary': '#B8AFA0', '--gate-muted': '#8F8474', '--gate-loss': '#F87171' };
  for (const [name, hex] of Object.entries(TOKENS)) {
    assert(new RegExp(`${escapeRe(name)}:${hex};`).test(cssCode), `[13a] ${name} is exactly ${hex}`);
  }
  assert(/--gate-oxblood:var\(--oxblood\);/.test(cssCode) && /--oxblood:#7A1F2B;/.test(cssCode),
    '[13b] --gate-oxblood is var(--oxblood), and --oxblood is #7A1F2B (D-2) — the red follows the brand token, never a second literal');
  // Scoped rules = every rule whose selector starts with the gate scope.
  // (?<=^|\}) is a lookbehind on purpose: a consuming `(?:^|\})` swallows the brace the previous match used and skips every other rule.
  const scoped = [...cssCode.matchAll(/(?<=^|\})\s*((?:@media[^{]*\{\s*)?\.site-gate\[data-gate-state[^{]*)\{([^}]*)\}/g)].map((m) => m[2]).join('\n');
  assert(scoped.length > 2000, `[13-pre] non-vacuity: the scan actually collected the gate-scoped declarations (${scoped.length} chars)`);
  assert(!/var\(--(gold|maroon|text-primary|text-secondary|text-muted|bg|bg-card|border)\b/.test(scoped) && !/var\(--(maroon|gold)-/.test(scoped),
    '[13c] no gate-scoped rule reads --gold, --maroon or a --text-*/--bg/--border theme token (all move with the player\'s theme and the OS mode)');
  const primary = cssRule(cssSrc, `${G_SCOPE} .site-gate-btn`);
  assert(/background:var\(--gate-gold\)/.test(primary || '') && /color:var\(--gate-ink\)/.test(primary || ''),
    `[13d] the primary button is Gold fill with Ink label (7.84:1) (got "${(primary || '').slice(0, 160)}")`);
  const chipRules = [...cssCode.matchAll(/(\.site-gate\[data-gate-state\][^{]*\.google-g-mark)\{([^}]*)\}/g)];
  assert(chipRules.length === 1 && !/(filter|fill|opacity|(?<![-\w])color):/.test(chipRules[0][2]),
    '[13e] .google-g-mark has exactly ONE gate rule and it never recolours the G (no filter/fill/color/opacity) — only the chip\'s white ground is dropped, because the Google box is white now (AD-55)');
  const err = cssRule(cssSrc, `${G_SCOPE} .site-gate-error`);
  assert(/border:1px solid var\(--gate-loss-border\)/.test(err || '') && /color:var\(--gate-marble\)/.test(err || ''),
    `[13f] an error is Marble text on a card with a loss-coloured border (never red text on the red glow — #f44 on Oxblood was 2.99:1) (got "${err}")`);
  assert(/\.site-gate\[data-gate-state\] \.site-gate-error::before\{[^}]*background:var\(--gate-loss\)/.test(cssSrc),
    '[13g] …and carries the warning glyph as a ::before mask painted --gate-loss, so the error is shape AND colour, never colour alone');
  assert(/\.site-gate-error\{color:#f44/.test(cssSrc),
    '[13h] the SHARED .site-gate-error rule (the PIN gate\'s, unscoped) is still exactly #f44 — sanity that 13f is not vacuously passing');
}

// ─────────────────────────────────────────────────────────────────────────────
// [14] — controls: 52 tall, Inter, rounded fields; the SHARED base rules
// (PIN gate) are untouched.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[14] UN-312 — controls are 52 tall, 1rem Inter, rounded; the SHARED (PIN-gate) base rules are untouched…');
{
  const cssSrc = await readFile(path.join(root, 'css', 'styles.css'), 'utf8');
  const input = cssRule(cssSrc, `${G_SCOPE} .form-input`);
  const btn = cssRule(cssSrc, `${G_SCOPE} .site-gate-btn`);
  const label = cssRule(cssSrc, `${G_SCOPE} .form-label`);
  const link = cssRule(cssSrc, `${G_SCOPE} .site-gate-link`);
  assert(!!input && !!btn && !!label && !!link, '[14-pre] the neutral input, button, label and link rules exist (fixture check for 14a-d)');
  assert(/min-height:52px/.test(input || '') && /font:400 1rem\/1\.5rem var\(--gate-font-ui\)/.test(input || '') && /border-radius:var\(--btn-radius\)/.test(input || '') && /border:1\.5px solid var\(--gate-field-border\)/.test(input || ''),
    `[14a] fields: 52 tall, 1rem (anything smaller makes iOS Safari zoom on focus), --btn-radius soft corners, 1.5px --gate-field-border (got "${(input || '').slice(0, 200)}")`);
  assert(/min-height:52px/.test(btn || '') && /font:600 1rem\/1 var\(--gate-font-ui\)/.test(btn || '') && /text-transform:none/.test(btn || '') && /border-radius:var\(--btn-radius\)/.test(btn || ''),
    `[14b] buttons: 52 tall, 1rem 600 Inter, real casing (text-transform:none), --btn-radius (got "${(btn || '').slice(0, 200)}")`);
  assert(/font:500 \.8125rem\/1rem var\(--gate-font-ui\)/.test(label || '') && /text-transform:none/.test(label || ''),
    '[14c] labels: .8125rem Inter, sentence case (the app-wide Oswald uppercase label rule no longer leaks in)');
  assert(/min-height:44px/.test(link || '') && /font:400 \.875rem\/1\.25rem var\(--gate-font-ui\)/.test(link || ''),
    '[14d] links keep a 44px tap target at .875rem Inter');

  // Cross-scope exclusivity — the SHARED base rules must still show the ORIGINAL monospace-era
  // face: the PIN gate (local-only authMode) relies on every one of them.
  const baseSubtitle = /(?<!\] )\.site-gate-subtitle\{([^}]*)\}/.exec(cssSrc);
  const baseBtn = /^\.site-gate-btn\{([^}]*)\}/m.exec(cssSrc);
  const baseError = /^\.site-gate-error\{([^}]*)\}/m.exec(cssSrc);
  const baseNotice = /^\.site-gate-notice\{([^}]*)\}/m.exec(cssSrc);
  assert(!!baseSubtitle && /text-transform:lowercase/.test(baseSubtitle[1]) && !baseSubtitle[1].includes('font-family'),
    '[14j] the SHARED .site-gate-subtitle rule still text-transform:lowercase and declares no font-family — untouched');
  assert(!!baseBtn && /text-transform:lowercase/.test(baseBtn[1]) && baseBtn[1].includes("font-family:'Courier New',monospace") && !/min-height/.test(baseBtn[1]),
    '[14k] the SHARED .site-gate-btn rule is still monospace/lowercase with no min-height — untouched');
  assert(!!baseError && !baseError[1].includes('font-family') && !!baseNotice && !baseNotice[1].includes('font-family'),
    '[14l] the SHARED .site-gate-error/.site-gate-notice rules declare no font-family — untouched');
}

// ─────────────────────────────────────────────────────────────────────────────
// [15] — the gate never clips a short screen: it scrolls; one landscape query.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[15] UN-312 — the gate scrolls instead of clipping (safe areas, no 100vh overshoot, one landscape query)…');
{
  const cssSrc = await readFile(path.join(root, 'css', 'styles.css'), 'utf8');
  const cssCode = stripCssComments(cssSrc);
  const ground = cssRule(cssSrc, G_SCOPE);
  assert(!!ground && /overflow-y:auto/.test(ground) && /-webkit-overflow-scrolling:touch/.test(ground) && /overscroll-behavior:contain/.test(ground),
    '[15a] the gate scroller carries overflow-y:auto, momentum scrolling and overscroll containment — a too-long error or a small phone with the keyboard up scrolls rather than clips');
  const column = cssRule(cssSrc, `${G_SCOPE} > .site-gate-inner`);
  assert(!!column && /env\(safe-area-inset-top,0px\)/.test(column) && /env\(safe-area-inset-bottom,0px\)/.test(column) && /max-width:408px/.test(column) && /min-height:100%/.test(column),
    '[15b] the column pads with the safe-area insets, is 360px of content (408 - 2x24), and is at least the scroller\'s height (so the hero can flex:1 and pin the form to the bottom)');
  assert(cssRule(cssSrc, `#site-gate-overlay ${G_SCOPE}`) !== null && /min-height:0/.test(cssRule(cssSrc, `#site-gate-overlay ${G_SCOPE}`)),
    '[15c] #site-gate-overlay .site-gate[data-gate-state] resets min-height to 0 — the shared 100vh is the LARGE viewport on iOS Safari and would push the bottom-anchored form under the toolbar');
  const queries = cssCode.match(/@media \(max-height:[^)]*\)\s*\{/g) || [];
  assert(queries.length === 1 && /@media \(max-height:500px\)\s*\{\s*\.site-gate\[data-gate-state\]/.test(cssCode),
    `[15d] exactly one @media (max-height:…) query exists in styles.css and it targets only .site-gate[data-gate-state] (got ${queries.length})`);
  assert(!/38vh|47\.44px/.test(cssCode),
    '[15e] the retired vh-centring formula (38vh, 47.44px) is gone — the hero flexes instead of being padded to a viewport fraction');
}

// ─────────────────────────────────────────────────────────────────────────────
// [16] UN-212 verification finding (2026-09-21) — status-bar backdrop strip.
// Source-level CSS-scope assertions, same technique as [15] above: regex the
// real stylesheet, never a browser, for existence/scoping/ordering. The
// engine-measured half (actual rendered geometry at a real inset, and the
// mutation-proof that the guard is load-bearing) lives in navtest.mjs §7j —
// this file covers what a browser cannot make cheap: exact source shape.
//
// SB-08 (2026-09-30) — RE-DERIVED, DELIBERATELY: Drew's iPhone report ("a row
// of color … underneath the floating island … All color in the header should
// scroll up and away") reverses RG-209's strip. Option O2b, his pick: the same
// one native-scoped ::before, now a SOFT EDGE of the PAGE colour — inset +
// 12px tall, painted from --bg (never --maroon / --chrome-bg), at z-index 90,
// BELOW the header (the header covers it at rest) and above the submit bar.
// [16d]/[16e]/[16h]/[16l] are re-pointed to that shape; each still fails on
// the defect it existed for (a band of the wrong size, the wrong colour source,
// the wrong stacking). [16a-c], [16f-g], [16i-p] are unchanged. The glyph
// legibility the strip bought with paint is now js/status-bar.js's job
// (statusbartest.mjs; navtest §7l measures it).
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[16] UN-212 / SB-08 — the native-only status-bar soft edge, source-level…');
{
  const cssSrc = await readFile(path.join(root, 'css', 'styles.css'), 'utf8');
  const stripRule = /body\.native-shell::before\{([^}]*)\}/.exec(cssSrc);
  assert(!!stripRule, '[16-pre] body.native-shell::before{...} exists in styles.css (fixture check for 16a-h below)');
  const decl = stripRule ? stripRule[1] : '';

  assert(/content:""/.test(decl),
    '[16a] generates a real box (content:"") — required for a ::before to render at all');
  assert(/position:fixed/.test(decl),
    '[16b] position:fixed — independent of scroll, never shifts with page content');
  assert(/top:0/.test(decl) && /left:0/.test(decl) && /right:0/.test(decl),
    '[16c] pinned to the full width of the viewport top edge (top:0;left:0;right:0)');
  assert(/height:calc\(env\(safe-area-inset-top,\s*0px\) \+ 12px\)/.test(decl),
    '[16d] height is calc(env(safe-area-inset-top,0px) + 12px) — the inset (zero on a Safari tab and in landscape, never a hardcoded px) plus O2b\'s 12px overhang, the soft edge content fades under (SB-08)');
  assert(/background:linear-gradient\(/.test(decl) && (decl.match(/var\(--bg\)/g) || []).length === 2 && !/--maroon|--chrome-bg/.test(decl),
    '[16e] paints a gradient from var(--bg) — the PAGE\'s own token, twice (78% then 62%) — and never --maroon or --chrome-bg, so the header\'s colour can never be painted under the Dynamic Island again (SB-08); still a token, so every look resolves automatically');
  assert(!/#[0-9a-fA-F]{3,8}/.test(decl),
    '[16f] no literal hex color anywhere in the rule — the token is the only color source');
  assert(/pointer-events:none/.test(decl),
    '[16g] pointer-events:none — never intercepts a tap meant for page content beneath it');
  const zMatch = /z-index:(\d+)/.exec(decl);
  assert(!!zMatch && zMatch[1] === '90',
    `[16h] z-index:90 — under the header, over page content (SB-08; RG-209's strip was 150, over the header) (got ${zMatch ? zMatch[1] : 'no z-index declared'})`);

  // [16i] Scoping proof — the selector text itself requires "body.native-shell",
  // not a bare "::before" or any other prefix. This is the literal guard that
  // keeps the rule off the web (body.native-shell is a class js/app.js only
  // ever adds when isNativeShell() is true — established and re-asserted by
  // platformtest.mjs/nativeguardtest.mjs elsewhere; not re-proved here).
  assert(/body\.native-shell::before\{/.test(cssSrc),
    '[16i] the exact selector "body.native-shell::before" appears verbatim — nothing broader (e.g. a bare "body::before" that would also paint on web)');
  const bareBodyBefore = (cssSrc.match(/(?:^|[^.\w])body::before\{/gm) || []).length;
  assert(bareBodyBefore === 0,
    '[16j] no UNSCOPED "body::before" rule exists anywhere in the file — the ONLY body::before in styles.css is the native-shell-scoped one');

  // [16k] Only one such rule — not accidentally duplicated with a competing
  // declaration elsewhere that a later cascade rule could silently override.
  const stripRuleCount = (cssSrc.match(/body\.native-shell::before\{/g) || []).length;
  assert(stripRuleCount === 1,
    `[16k] exactly one body.native-shell::before rule exists (got ${stripRuleCount})`);

  // [16l] Z-INDEX ORDERING, read from the real file, not restated by hand —
  // "above scrolling content and the sticky submit bar, below every modal/
  // overlay/toast/gate" is the DI's literal acceptance test.
  const zOf = (selRegex, label) => {
    const m = selRegex.exec(cssSrc);
    assert(!!m, `[16l-fixture] found a z-index for ${label} to compare against (regex: ${selRegex})`);
    return m ? Number(m[1]) : null;
  };
  const zHeaderNav = zOf(/\.app-header\{[^}]*z-index:(\d+)/, '.app-header');
  const zBottomNav = zOf(/\.bottom-nav\{[^}]*z-index:(\d+)/, '.bottom-nav');
  const zSubmitBar = zOf(/\.submit-bar\{[^}]*z-index:(\d+)/, '.submit-bar');
  const zModal = zOf(/\.modal-overlay\{[^}]*z-index:(\d+)/, '.modal-overlay');
  const zBackendBanner = zOf(/\.backend-error-banner\{[^}]*z-index:(\d+)/, '.backend-error-banner');
  const zToast = zOf(/#toast-container\{[^}]*z-index:(\d+)/, '#toast-container');
  const zChatToast = zOf(/\.chat-toast\{[^}]*z-index:(\d+)/, '.chat-toast');
  const zChatSheet = zOf(/#chat-sheet-wrap\{[^}]*z-index:(\d+)/, '#chat-sheet-wrap');
  const zGateOverlay = zOf(/#site-gate-overlay\{[^}]*z-index:(\d+)/, '#site-gate-overlay');
  const zGate = zOf(/^\.site-gate\{[^}]*z-index:(\d+)/m, '.site-gate');
  const zLeagueSwitch = zOf(/#league-switch-overlay\{[^}]*z-index:(\d+)/, '#league-switch-overlay');
  const zAuthStack = zOf(/#auth-banner-stack\{[^}]*z-index:(\d+)/, '#auth-banner-stack');
  // SB-08: read from the rule itself (no longer a restated constant), and the
  // header/nav pair moved to the OTHER side — the header now covers the band
  // at rest; page content and the submit bar still pass beneath it.
  const STRIP_Z = zMatch ? Number(zMatch[1]) : NaN;
  for (const [z, label] of [[zHeaderNav, '.app-header'], [zBottomNav, '.bottom-nav']]) {
    if (z != null) assert(STRIP_Z < z, `[16l] soft edge (${STRIP_Z}) sits BELOW ${label} (${z}) — the header covers it at rest, so the header's own colour fills the safe area while the header is there`);
  }
  if (zSubmitBar != null) assert(STRIP_Z > zSubmitBar, `[16l] soft edge (${STRIP_Z}) sits ABOVE .submit-bar (${zSubmitBar}) — page content scrolls under it`);
  for (const [z, label] of [[zModal, '.modal-overlay'], [zBackendBanner, '.backend-error-banner'],
      [zToast, '#toast-container'], [zChatToast, '.chat-toast'], [zChatSheet, '#chat-sheet-wrap'],
      [zGateOverlay, '#site-gate-overlay'], [zGate, '.site-gate'], [zLeagueSwitch, '#league-switch-overlay'],
      [zAuthStack, '#auth-banner-stack']]) {
    if (z != null) assert(STRIP_Z < z, `[16l] strip (${STRIP_Z}) sits BELOW ${label} (${z})`);
  }

  // [16m] Every gate/overlay the strip must read as "absent or Ink" behind is
  // fully opaque and full-bleed (position:fixed;inset:0, a solid background —
  // never transparent) — the structural reason the ordering above is
  // sufficient on its own, without a second state-gate on the strip itself.
  const gateOverlayRule = /#site-gate-overlay\{([^}]*)\}/.exec(cssSrc);
  assert(!!gateOverlayRule && /inset:0/.test(gateOverlayRule[1]) && /background:var\(--bg\)/.test(gateOverlayRule[1]),
    '[16m] #site-gate-overlay is position:fixed;inset:0 with a solid (non-transparent) background — fully covers the strip underneath it');
  const baseSiteGateRule = /^\.site-gate\{([^}]*)\}/m.exec(cssSrc);
  assert(!!baseSiteGateRule && /inset:0/.test(baseSiteGateRule[1]) && /background:#000/.test(baseSiteGateRule[1]),
    '[16n] the base .site-gate (PIN/hold variants) is also position:fixed;inset:0, solid #000 — opaque over the strip');
  // UPDATED — UN-312 (2026-09-29): the native-only rule this pinned is replaced by the neutral one (see [12]-[15]).
  const nativeGoogleGateRule = /(?:^|\n)\.site-gate\[data-gate-state\]\{([^}]*)\}/.exec(cssSrc);
  assert(!!nativeGoogleGateRule && /var\(--gate-ink\)/.test(nativeGoogleGateRule[1]) && /--gate-ink:#14110E;/.test(cssSrc),
    '[16o] the Munera sign-in gate ground paints Ink (--gate-ink, #14110E) as its solid final layer — the one gate state that can appear in the native shell reads as Ink, not maroon, per the requirement');

  // [16p] Mutation-proof (scope removed ⇒ RED) — source-level. A mutated copy
  // of just this rule, with the "body.native-shell" prefix stripped (leaving
  // a bare "::before{...}" that would paint on EVERY body, web included), no
  // longer matches [16i]'s scoping regex — proving that regex is load-bearing
  // and not vacuously true. This mutates an in-memory STRING only (never a
  // file on disk, nothing to restore) per CLAUDE.md's scratch-copy discipline.
  if (stripRule) {
    const mutated = cssSrc.replace('body.native-shell::before{' + stripRule[1] + '}', '::before{' + stripRule[1] + '}');
    assert(mutated !== cssSrc, '[16p-fixture] the mutation actually changed the text (otherwise the RED check below is vacuous)');
    const scopedStillPresent = /body\.native-shell::before\{/.test(mutated);
    assert(scopedStillPresent === false,
      '[16p] MUTATION-PROOF: with "body.native-shell" stripped from the rule, [16i]\'s scoping assertion goes RED (no longer finds the scoped selector) — the real (unmutated) file passing [16i] is not a vacuous pass');
  }
}

// ── Result ───────────────────────────────────────────────────────────────────
process.stdout.write(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`,
  () => process.exit(fail === 0 ? 0 : 1));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
