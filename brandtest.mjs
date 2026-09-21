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
// DI-216j fixture — showGoogleSignInGate()'s rendered innerHTML, WEB, captured
// from js/app.js BEFORE DI-216's edit (commit a3509f0's parent tree, i.e. the
// showGoogleSignInGate() body as it existed pre-DI-216). Pasted verbatim via
// JSON.stringify of the captured string, so no manual retyping can introduce
// a whitespace drift the diff wouldn't show. This is the byte-identity
// anchor DI-216j/A3 requires: the web branch must never move, and this
// constant is the proof of what "never moved" means, captured from the real
// pre-change function rather than reconstructed from memory.
// ─────────────────────────────────────────────────────────────────────────────
const PRE_CHANGE_WEB_GATE_HTML = "\n    <div class=\"site-gate\">\n      <div class=\"site-gate-inner\">\n        <div class=\"site-gate-title-top\">welcome to</div>\n        <div class=\"site-gate-title\">irb pick 'ems</div>\n        <div class=\"site-gate-subtitle\">sign in to make your picks</div>\n        <div id=\"google-gate-message\" style=\"display:none\"></div>\n        <button class=\"site-gate-btn google-signin-btn\" id=\"google-gate-submit\" type=\"button\">\n          <span class=\"google-g-mark\"><svg viewBox=\"0 0 18 18\" width=\"18\" height=\"18\" aria-hidden=\"true\" focusable=\"false\">\n  <path fill=\"#4285F4\" d=\"M17.64 9.2045c0-.6381-.0573-1.2518-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2581h2.9087c1.7018-1.5668 2.6836-3.874 2.6836-6.615z\"/>\n  <path fill=\"#34A853\" d=\"M9 18c2.43 0 4.4673-.8059 5.9564-2.1805l-2.9087-2.2581c-.8059.54-1.8368.8591-3.0477.8591-2.3436 0-4.3282-1.5831-5.0359-3.7104H.9573v2.3318C2.4382 15.9832 5.4818 18 9 18z\"/>\n  <path fill=\"#FBBC05\" d=\"M3.9641 10.71c-.18-.54-.2823-1.1168-.2823-1.71s.1023-1.17.2823-1.71V4.9582H.9573A8.9965 8.9965 0 000 9c0 1.4523.3477 2.8264.9573 4.0418L3.9641 10.71z\"/>\n  <path fill=\"#EA4335\" d=\"M9 3.5795c1.3214 0 2.5077.4541 3.4404 1.346l2.5818-2.5818C13.4632.8918 11.4259 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9582L3.9641 7.29C4.6718 5.1627 6.6564 3.5795 9 3.5795z\"/>\n</svg></span>\n          <span id=\"google-gate-btn-label\">Continue with Google</span>\n        </button>\n      </div>\n    </div>";

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
    ['index.html', '<meta name="theme-color" content="#500000" />', 'web-PWA-install-specific metadata; irrelevant once running as a true native shell'],
    ['index.html', '<meta name="apple-mobile-web-app-title" content="Pickems" />', 'same reasoning — no "Add to Home Screen" step exists to read it in the native shell'],
    ['manifest.json', '"name": "CFB Pickems",', 'the native shell has its own app-icon/display-name assets (DI-214) and never reads manifest.json'],
    ['manifest.json', '"short_name": "Pickems",', 'same reasoning — must stay correct for the web PWA install'],
    ['js/app.js', 'value="CFB Pickems update"', 'league communication (commissioner broadcast) — outbound content, not shell chrome'],
    ['js/app.js', "'CFB Pickems update'", 'same reasoning — the broadcast subject default'],
    ['js/app.js', "'Your CFB Pickems PIN'", 'legacy PIN-reset copy, pre-Supabase auth model — flagged as a residual-cleanup candidate, not converted or fixed here'],
    ['js/app.js', '— Sent from CFB Pickems', 'outbound league content (broadcast/recap footer), not app-shell branding'],
    ['js/app.js', 'CFB Pickems — ${formatWeekLabel(week)} recap', 'recap email subject — outbound league content'],
    ['js/app.js', 'CFB Pickems feedback — ${entry.name}', 'feedback email subject — outbound league content'],
    ['js/app.js', "e.g. IRB Pick 'Ems", 'generic example placeholder for creating ANY future league, not this app\'s own brand'],
    ['privacy.html', "IRB Pick 'Ems (irbfootball.com)", "privacy content describing the league's own data practices — true and identical on both shells"],
    ['js/push-onesignal.js', 'irbfootball.com/OneSignalSDKWorker.js', 'a code comment — never rendered to any user'],
  ];
  for (const [file, needle, why] of INVENTORY) {
    let src = '';
    try { src = await readFile(path.join(root, file), 'utf8'); } catch { src = ''; }
    assert(src.includes(needle),
      `[5] ${file} still contains "${needle}" — ${why}`);
  }

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
console.log('\n[9] DI-216j/A3 — showGoogleSignInGate() on WEB is byte-identical to the pre-DI-216 fixture…');
{
  const { html, status, raw } = captureSignInGateHtml({ native: false });
  assert(status === 0, `[9-pre] the capture child process exited 0 (got ${status})${status === 0 ? '' : '\n' + raw.slice(-900)}`);
  assert(html === PRE_CHANGE_WEB_GATE_HTML,
    `[9a] web's rendered gate markup is EXACTLY the pre-DI-216 fixture — no new attribute, no new class, no copy change, no reflow (mismatch: ${html === null ? 'capture failed' : 'strings differ'})`);
  assert(!/data-gate-state="google"/.test(html || ''),
    '[9b] …and specifically, no data-gate-state="google" attribute appears on web at all (A3: the attribute is set ONLY when isNativeShell(), never present-but-inert)');
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
  assert(/>Sign in to make your picks\.</.test(h),
    '[10d] the sub-line reads sentence-case "Sign in to make your picks." on native (A1)');
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
  const rawInterpolation = /\$\{\s*(getShellWordmark|getShellTagline|getShellBrandName)\s*\(/g;
  const offenders = [...appSrc.matchAll(rawInterpolation)];
  assert(offenders.length === 0,
    `[11c] no unescaped \${getShellWordmark()}/\${getShellTagline()}/\${getShellBrandName()} interpolation anywhere in app.js (S-C2) — found ${offenders.length} (every call site must read \${escHtml(getShellXxx() ...)})`);
  const brandSrc = await readFile(path.join(root, 'js', 'brand.js'), 'utf8');
  assert(!/SCRIBE/.test(brandSrc.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')) &&
         !/MunerAI/.test(brandSrc.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')),
    '[11d] brand.js\'s lookup tables still contain neither "SCRIBE" nor "MunerAI" after adding getShellTagline() (re-asserted here, DI-216 scope)');
}

// ─────────────────────────────────────────────────────────────────────────────
// [12] Coordinator correction (2026-09-20) — A2 serif stacks are pinned to the
// TWO native-scoped rules ONLY, and appear NOWHERE else in styles.css (no
// font-family change leaked outside the native-scoped block); A1 vertical
// continuity (align-items:flex-start + the 50vh-centered padding-top) is
// pinned too.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[12] A2/A1 — the Georgia/Baskerville serif stacks and the 50vh block-centering live ONLY in the two native-scoped rules…');
{
  const cssSrc = await readFile(path.join(root, 'css', 'styles.css'), 'utf8');
  const wordmarkRule = /body\.native-shell \.site-gate\[data-gate-state="google"\] \.site-gate-wordmark\{([^}]*)\}/.exec(cssSrc);
  const taglineRule = /body\.native-shell \.site-gate\[data-gate-state="google"\] \.site-gate-tagline\{([^}]*)\}/.exec(cssSrc);
  const gateRule = /body\.native-shell \.site-gate\[data-gate-state="google"\]\{([^}]*)\}/.exec(cssSrc);
  assert(!!wordmarkRule, '[12-pre] the native-scoped .site-gate-wordmark rule exists (fixture check for 12a-c below)');
  assert(!!taglineRule, '[12-pre] the native-scoped .site-gate-tagline rule exists (fixture check for 12d-f below)');
  assert(!!gateRule, '[12-pre] the native-scoped .site-gate[data-gate-state="google"] base rule exists (fixture check for 12g-h below)');
  if (wordmarkRule) {
    assert(/font-family:Georgia,'Times New Roman',Baskerville,serif/.test(wordmarkRule[1]),
      `[12a] wordmark font-family is EXACTLY the iOS shell's launch-screen SVG wordmark stack (got "${wordmarkRule[1].match(/font-family:[^;]*/)?.[0]}")`);
    assert(/font-weight:400/.test(wordmarkRule[1]),
      '[12b] wordmark font-weight is 400 (normal) — the SVG <text> element declares no font-weight, so its computed weight is normal, copied verbatim rather than an invented 600');
    assert(/letter-spacing:\.159em/.test(wordmarkRule[1]),
      '[12c] wordmark letter-spacing is .159em — the SVG\'s 28-unit spacing on a 176-unit font-size, expressed as the equivalent em ratio (28/176)');
  }
  if (taglineRule) {
    assert(/font-family:Georgia,'Times New Roman',serif/.test(taglineRule[1]) && !/Baskerville/.test(taglineRule[1]),
      '[12d] tagline font-family is EXACTLY the launch-screen.svg tagline stack (no Baskerville — the SVG\'s tagline <text> omits it, unlike the wordmark\'s)');
    assert(/font-weight:400/.test(taglineRule[1]),
      '[12e] tagline font-weight is 400 (normal), same reasoning as 12b');
    assert(/letter-spacing:\.071em/.test(taglineRule[1]),
      '[12f] tagline letter-spacing is .071em — the SVG\'s 4-unit spacing on a 56-unit font-size (4/56)');
  }
  // Wordmark:tagline size ratio — 176:56 in the SVG reduces to 22:7 exactly;
  // 2.2rem:0.7rem preserves that exact ratio (2.2/0.7 === 22/7).
  const wordSize = Number(wordmarkRule?.[1].match(/font-size:([\d.]+)rem/)?.[1]);
  const taglineSize = Number(taglineRule?.[1].match(/font-size:([\d.]+)rem/)?.[1]);
  assert(Number.isFinite(wordSize) && Number.isFinite(taglineSize) && Math.abs((wordSize / taglineSize) - (22 / 7)) < 1e-9,
    `[12g] wordmark:tagline font-size ratio is EXACTLY 22:7 (the SVG's 176:56 reduced), matching launch-screen.svg's own proportions (got ${wordSize}rem:${taglineSize}rem = ${(wordSize / taglineSize).toFixed(6)})`);
  if (gateRule) {
    assert(/align-items:flex-start/.test(gateRule[1]),
      '[12h] the native-only gate variant overrides align-items to flex-start (A1) — the shared .site-gate\'s align-items:center would otherwise center the WHOLE column, not just the wordmark+tagline block, landing it well above the SVG\'s 50%-of-height position');
    assert(/padding-top:max\(24px, ?calc\(50vh - 44\.68px\)\)/.test(gateRule[1]),
      '[12i] padding-top is max(24px, calc(50vh - <half the block\'s own height>)) — the BLOCK\'S CENTER lands at 50% of viewport height on tall viewports, the same fraction the launch screen\'s layout math centers it at, with a 24px floor (reviewer note, landscape) so it never crowds the top edge on a short/landscape viewport');
  }
  // Global uniqueness — these font-family values may not leak into any OTHER
  // rule in the file (web's monospace .site-gate-inner, the hold gate, the
  // PIN gate title/subtitle, etc. must all stay untouched).
  // Counted against CODE only (comments stripped) — this file's own prose
  // legitimately discusses "Baskerville" by name when explaining why a given
  // rule does NOT use it (same stripComments technique brand.js's SCRIBE/
  // MunerAI guard uses in [4] above), so a raw count would be thrown off by
  // its own documentation rather than measuring the actual declarations.
  const stripCssComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const cssCode = stripCssComments(cssSrc);
  const georgiaCount = (cssCode.match(/Georgia/g) || []).length;
  const baskervilleCount = (cssCode.match(/Baskerville/g) || []).length;
  assert(cssCode.length < cssSrc.length,
    '[12-pre] non-vacuity: stripCssComments() actually removed characters — a no-op strip would make 12j/12k below count comment prose too');
  // Since Drew's font-follow-up ([14] below), the serif family also covers
  // the sub-line, the button and the message slot (one rule, two selectors)
  // — five rule-sites total, all still inside the SAME native-scoped block.
  assert(georgiaCount === 5,
    `[12j] "Georgia" appears EXACTLY five times in styles.css's CODE — wordmark, tagline, sub-line, button, and the grouped error/notice rule, ALL inside the native-scoped block, and nowhere else (got ${georgiaCount})`);
  assert(baskervilleCount === 1,
    `[12k] "Baskerville" appears EXACTLY once in styles.css's CODE — only in the wordmark rule's actual declaration (every other native-text rule uses the plain Georgia/Times New Roman/serif stack, per the SVG's own tagline face) — (got ${baskervilleCount})`);
  // No OTHER rule anywhere in the file overrides .site-gate-subtitle's
  // text-transform outside this native-scoped block (the hold gate has its
  // own, unrelated override at a DIFFERENT selector — [data-gate-state="hold"]
  // — so this counts occurrences of the EXACT native-scoped selector only).
  const subtitleOverrideCount = (cssSrc.match(/body\.native-shell \.site-gate\[data-gate-state="google"\] \.site-gate-subtitle\{/g) || []).length;
  assert(subtitleOverrideCount === 1,
    `[12l] the native-only .site-gate-subtitle text-transform override appears exactly once (got ${subtitleOverrideCount})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// [13] Reviewer round 1, items 2/3 — the Ink/Gold hexes were asserted NOWHERE
// (a hex swap left brandtest 69/0 green), and the 44.68px centering constant
// was a bare literal disconnected from the block it depends on. Both closed
// here: the hexes are pinned inside each native-scoped rule, and the
// constant is DERIVED from the SAME declared font-sizes/line-heights/margins
// [12] already parsed, so editing any one of those turns THIS assertion red
// instead of silently de-centring the block.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[13] Reviewer R1 items 2/3 — Ink/Gold hexes pinned; the 44.68px constant is DERIVED, not asserted as a bare literal…');
{
  const cssSrc = await readFile(path.join(root, 'css', 'styles.css'), 'utf8');
  const wordmarkRule = /body\.native-shell \.site-gate\[data-gate-state="google"\] \.site-gate-wordmark\{([^}]*)\}/.exec(cssSrc);
  const taglineRule = /body\.native-shell \.site-gate\[data-gate-state="google"\] \.site-gate-tagline\{([^}]*)\}/.exec(cssSrc);
  const gateRule = /body\.native-shell \.site-gate\[data-gate-state="google"\]\{([^}]*)\}/.exec(cssSrc);
  const btnRule = /body\.native-shell \.site-gate\[data-gate-state="google"\] \.site-gate-btn\{([^}]*)\}/.exec(cssSrc);
  const hoverRule = /body\.native-shell \.site-gate\[data-gate-state="google"\] \.site-gate-btn:hover\{([^}]*)\}/.exec(cssSrc);

  assert(!!gateRule && /background:#14110E/.test(gateRule[1]),
    '[13a] the native gate background is exactly #14110E (Ink)');
  assert(!!wordmarkRule && /color:#C9A24B/.test(wordmarkRule[1]),
    '[13b] the wordmark colour is exactly #C9A24B (Gold)');
  assert(!!taglineRule && /color:#C9A24B/.test(taglineRule[1]),
    '[13c] the tagline colour is exactly #C9A24B (Gold)');
  assert(!!btnRule && /border-color:#C9A24B/.test(btnRule[1]) && /color:#C9A24B/.test(btnRule[1]),
    '[13d] the button border AND text colour are exactly #C9A24B (Gold) in its resting state');
  assert(!!hoverRule && /background:#C9A24B/.test(hoverRule[1]) && /color:#14110E/.test(hoverRule[1]),
    '[13e] the button hover/pressed state fills Gold (#C9A24B) with Ink (#14110E) text — the exact inverse of the resting state, never a third colour');

  // .google-g-mark must carry NO rule at all inside the native-scoped block —
  // Google's OAuth branding guidelines govern that chip on every platform.
  const googleMarkInNativeBlock = new RegExp(
    'body\\.native-shell \\.site-gate\\[data-gate-state="google"\\][^{]*\\.google-g-mark'
  ).test(cssSrc);
  assert(!googleMarkInNativeBlock,
    '[13f] .google-g-mark has NO rule anywhere under the native-scoped block — untouched on every platform');

  // Error text must stay semantic red. Since Drew's font-follow-up (below,
  // [14]) the native block DOES carry a rule for .site-gate-error — but it
  // may declare ONLY typography (font-family/letter-spacing), never a color.
  const errorNativeRule = /body\.native-shell \.site-gate\[data-gate-state="google"\] \.site-gate-error(?:,\s*\n?body\.native-shell \.site-gate\[data-gate-state="google"\] \.site-gate-notice)?\{([^}]*)\}/.exec(cssSrc);
  assert(!!errorNativeRule, '[13-pre] the native-scoped .site-gate-error rule (possibly grouped with .site-gate-notice) exists (fixture check for 13g)');
  assert(!!errorNativeRule && !/color:/.test(errorNativeRule[1]),
    `[13g] the native-scoped .site-gate-error rule declares NO color property (got "${errorNativeRule?.[1]}") — only its FACE may change here, never its color; it stays the shared semantic #f44 on every platform (loud-fail must always look like an error)`);
  assert(/\.site-gate-error\{color:#f44/.test(cssSrc),
    '[13h] .site-gate-error\'s own (shared, unscoped) rule is still exactly #f44 — sanity check that 13g isn\'t vacuously passing because the rule itself vanished');

  // The 44.68px constant, DERIVED from [12]'s own font-size/line-height/
  // margin captures — not re-typed as a second literal. Assumes the browser
  // default 16px root (this codebase sets no root font-size override —
  // grep-checked once, not re-derived per run, since that is a separate,
  // stable fact about the stylesheet as a whole).
  const rootFontSize = cssSrc.match(/html\{[^}]*font-size:(\d+)px/)?.[1] ?? cssSrc.match(/:root\{[^}]*font-size:(\d+)px/)?.[1];
  assert(rootFontSize === '16',
    `[13-pre] non-vacuity: styles.css's html rule declares font-size:16px explicitly (got "${rootFontSize}") — 1rem===16px is a checked fact for the derivation below, not an assumption; if this ever changes, THIS assertion goes red first, before the derived constant silently drifts`);
  const parseBlockHalfHeightPx = (rule) => {
    const remSize = Number(rule.match(/font-size:([\d.]+)rem/)?.[1]);
    const lineHeight = Number(rule.match(/line-height:([\d.]+)/)?.[1]);
    const marginBottom = Number(rule.match(/margin-bottom:(\d+)px/)?.[1]);
    if (![remSize, lineHeight, marginBottom].every(Number.isFinite)) return NaN;
    return (remSize * 16 * lineHeight) + marginBottom;
  };
  const wordmarkHeight = wordmarkRule ? parseBlockHalfHeightPx(wordmarkRule[1]) : NaN;
  const taglineHeight = taglineRule ? parseBlockHalfHeightPx(taglineRule[1]) : NaN;
  assert(Number.isFinite(wordmarkHeight) && Number.isFinite(taglineHeight),
    `[13-pre] non-vacuity: both block heights were actually parsed from the CSS (wordmark=${wordmarkHeight}, tagline=${taglineHeight}) — a parse failure would make 13i below compare NaN to NaN and pass for the wrong reason`);
  const derivedHalf = (wordmarkHeight + taglineHeight) / 2;
  const cssConstant = Number(gateRule?.[1].match(/calc\(50vh - ([\d.]+)px\)/)?.[1]);
  assert(Number.isFinite(cssConstant), '[13-pre] non-vacuity: the padding-top rule\'s calc() constant was actually parsed');
  assert(Math.abs(derivedHalf - cssConstant) < 0.005,
    `[13i] the padding-top calc() constant (${cssConstant}px) EQUALS half the wordmark+tagline block's height, DERIVED here from the SAME declared font-size/line-height/margin-bottom values [12] already parsed (derived ${derivedHalf}px) — editing any one of those three properties on either element now turns this assertion RED instead of silently de-centring the block`);
}

// ─────────────────────────────────────────────────────────────────────────────
// [14] Drew, after the simulator screenshot (2026-09-20): "The font needs to
// all follow the munera theme, not the irb pickems theme." Everything BELOW
// the wordmark+tagline block — sub-line, button label, message slot — was
// still inheriting .site-gate-inner's monospace/lowercase/wide-tracking
// typewriter face. Pins the serif takeover on all three, the button's
// min-height:44px tap target, and that NONE of this leaked outside the
// native-scoped block (web stays byte-identical, proven separately in [9]).
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[14] Drew\'s font follow-up — sub-line/button/message slot go serif, native-scoped only…');
{
  const cssSrc = await readFile(path.join(root, 'css', 'styles.css'), 'utf8');
  const subtitleRule = /body\.native-shell \.site-gate\[data-gate-state="google"\] \.site-gate-subtitle\{([^}]*)\}/.exec(cssSrc);
  const btnRule = /body\.native-shell \.site-gate\[data-gate-state="google"\] \.site-gate-btn\{([^}]*)\}/.exec(cssSrc);
  const errNoticeRule = /body\.native-shell \.site-gate\[data-gate-state="google"\] \.site-gate-error,\s*\nbody\.native-shell \.site-gate\[data-gate-state="google"\] \.site-gate-notice\{([^}]*)\}/.exec(cssSrc);

  assert(!!subtitleRule, '[14-pre] the native-scoped .site-gate-subtitle rule exists (fixture check for 14a-c)');
  assert(!!btnRule, '[14-pre] the native-scoped .site-gate-btn rule exists (fixture check for 14d-g)');
  assert(!!errNoticeRule, '[14-pre] the grouped native-scoped .site-gate-error/.site-gate-notice rule exists (fixture check for 14h-i)');

  const SERIF = "Georgia,'Times New Roman',serif";
  if (subtitleRule) {
    assert(subtitleRule[1].includes(`font-family:${SERIF}`),
      '[14a] the sub-line uses the Munera serif stack (no Baskerville — that\'s the wordmark\'s own accent)');
    assert(/letter-spacing:\.0[2-4]em/.test(subtitleRule[1]),
      `[14b] the sub-line's letter-spacing is in the requested .02-.04em serif-appropriate band (got "${subtitleRule[1].match(/letter-spacing:[^;]*/)?.[0]}")`);
    assert(/font-size:1rem/.test(subtitleRule[1]),
      '[14c] the sub-line is sized ≈1rem, per the requested hierarchy');
  }
  if (btnRule) {
    assert(btnRule[1].includes(`font-family:${SERIF}`),
      '[14d] the button (and its inherited label span) uses the Munera serif stack');
    assert(/letter-spacing:\.0[2-4]em/.test(btnRule[1]),
      `[14e] the button's letter-spacing is in the .02-.04em band (got "${btnRule[1].match(/letter-spacing:[^;]*/)?.[0]}")`);
    assert(/font-size:1rem/.test(btnRule[1]),
      '[14f] the button label is sized ≈1rem, per the requested hierarchy');
    assert(/text-transform:none/.test(btnRule[1]),
      '[14g] the native button overrides text-transform to none — the shared .site-gate-btn\'s lowercase would otherwise render "continue with google" despite the capitalized "Continue with Google" HTML content (same class of bug [12l] already fixed for the sub-line)');
    assert(/min-height:44px/.test(btnRule[1]),
      '[14g2] the native button carries min-height:44px — the reviewer-flagged ~36px tap target, fixed on native only (web\'s pre-existing height is explicitly out of scope, deferred)');
  }
  if (errNoticeRule) {
    assert(errNoticeRule[1].includes(`font-family:${SERIF}`),
      '[14h] the message slot (error AND notice tone) uses the Munera serif stack');
    assert(/letter-spacing:\.0[2-4]em/.test(errNoticeRule[1]),
      `[14i] the message slot's letter-spacing is in the .02-.04em band (got "${errNoticeRule[1].match(/letter-spacing:[^;]*/)?.[0]}")`);
  }

  // Cross-scope exclusivity — NONE of this leaked onto the shared (web)
  // rules. The base .site-gate-subtitle/.site-gate-btn/.site-gate-error/
  // .site-gate-notice rules must still show the ORIGINAL monospace-era
  // face — proving web is unaffected at the CSS-source level too (on top of
  // [9]'s rendered-HTML byte-identity proof, which cannot see CSS at all).
  const baseSubtitle = /(?<!google"\] )\.site-gate-subtitle\{([^}]*)\}/.exec(cssSrc);
  const baseBtn = /^\.site-gate-btn\{([^}]*)\}/m.exec(cssSrc);
  const baseError = /^\.site-gate-error\{([^}]*)\}/m.exec(cssSrc);
  const baseNotice = /^\.site-gate-notice\{([^}]*)\}/m.exec(cssSrc);
  assert(!!baseSubtitle && /text-transform:lowercase/.test(baseSubtitle[1]) && !baseSubtitle[1].includes('font-family'),
    '[14j] the SHARED (web) .site-gate-subtitle rule still text-transform:lowercase and declares no font-family — untouched');
  assert(!!baseBtn && /text-transform:lowercase/.test(baseBtn[1]) && baseBtn[1].includes("font-family:'Courier New',monospace") && !/min-height/.test(baseBtn[1]),
    '[14k] the SHARED (web) .site-gate-btn rule is still monospace/lowercase with no min-height — untouched');
  assert(!!baseError && !baseError[1].includes('font-family') && !!baseNotice && !baseNotice[1].includes('font-family'),
    '[14l] the SHARED (web) .site-gate-error/.site-gate-notice rules declare no font-family — untouched');

  // [13i] must still hold — the wordmark+tagline block above the sub-line is
  // unchanged by this pass, so the derived 44.68px centering constant must
  // be unaffected. Re-verified here (not assumed) as its own assertion,
  // reading the SAME rules [12]/[13] already parse.
  const wordmarkRule = /body\.native-shell \.site-gate\[data-gate-state="google"\] \.site-gate-wordmark\{([^}]*)\}/.exec(cssSrc);
  const taglineRule = /body\.native-shell \.site-gate\[data-gate-state="google"\] \.site-gate-tagline\{([^}]*)\}/.exec(cssSrc);
  const gateRule = /body\.native-shell \.site-gate\[data-gate-state="google"\]\{([^}]*)\}/.exec(cssSrc);
  const parseHeight = (rule) => {
    const remSize = Number(rule.match(/font-size:([\d.]+)rem/)?.[1]);
    const lineHeight = Number(rule.match(/line-height:([\d.]+)/)?.[1]);
    const marginBottom = Number(rule.match(/margin-bottom:(\d+)px/)?.[1]);
    if (![remSize, lineHeight, marginBottom].every(Number.isFinite)) return NaN;
    return (remSize * 16 * lineHeight) + marginBottom;
  };
  const derivedHalf = wordmarkRule && taglineRule
    ? (parseHeight(wordmarkRule[1]) + parseHeight(taglineRule[1])) / 2 : NaN;
  const cssConstant = Number(gateRule?.[1].match(/calc\(50vh - ([\d.]+)px\)/)?.[1]);
  assert(Number.isFinite(derivedHalf) && Number.isFinite(cssConstant) && Math.abs(derivedHalf - cssConstant) < 0.005,
    `[14m] [13i]'s derived-centering constant STILL holds after this pass (constant=${cssConstant}px, derived=${derivedHalf}px) — the wordmark+tagline block above the sub-line was not touched by this change, verified here rather than assumed`);
}

// ─────────────────────────────────────────────────────────────────────────────
// [15] Reviewer round 2 — landscape safety. A flat min(calc(...),30vh) clamp
// was checked against the 402x874pt portrait reference and REJECTED (30vh=
// 262.2px < 392.32px, so it would have fired in portrait too). A height
// media query is used instead, scoped to max-height:500px so portrait is
// provably untouched; overflow-y:auto is the actual anti-clipping guarantee.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[15] Reviewer R2 — landscape safety: height media query (native-scoped only) + overflow-y:auto…');
{
  const cssSrc = await readFile(path.join(root, 'css', 'styles.css'), 'utf8');
  const gateRule = /body\.native-shell \.site-gate\[data-gate-state="google"\]\{([^}]*)\}/.exec(cssSrc);
  assert(!!gateRule && /overflow-y:auto/.test(gateRule[1]) && /-webkit-overflow-scrolling:touch/.test(gateRule[1]),
    '[15a] the native gate carries overflow-y:auto and -webkit-overflow-scrolling:touch, so a too-long multi-line error can scroll rather than clip, in either orientation');

  const mediaBlockMatch = /@media \(max-height:500px\)\{\s*(body\.native-shell[^}]*\{[^}]*\})\s*\}/.exec(cssSrc);
  assert(!!mediaBlockMatch, '[15-pre] the @media (max-height:500px) block exists (fixture check for 15b-d)');
  if (mediaBlockMatch) {
    assert(mediaBlockMatch[1].startsWith('body.native-shell .site-gate[data-gate-state="google"]{'),
      '[15b] the media-query rule is scoped to the SAME native-only selector as every other rule in this block — it cannot ever apply on web');
    assert(/padding-top:24px/.test(mediaBlockMatch[1]),
      '[15c] below the 500px height threshold, padding-top reverts to a flat 24px (matching the shared gate\'s own default) rather than attempting a 50vh centering with too little room');
    assert(/align-items:flex-start/.test(mediaBlockMatch[1]),
      '[15d] the media-query rule keeps align-items:flex-start (consistent with the base native rule, not re-centering)');
  }
  // Exactly one @media (max-height:...) block in the whole file, and it is
  // the one just checked — this rule was not accidentally duplicated
  // elsewhere, and no OTHER max-height query silently competes with it.
  const maxHeightQueryCount = (cssSrc.match(/@media \(max-height:/g) || []).length;
  assert(maxHeightQueryCount === 1,
    `[15e] exactly one @media (max-height:...) query exists in styles.css (got ${maxHeightQueryCount})`);

  // Portrait must be pixel-identical to before this pass: at 874px (or any
  // height > 500px) the media query's own condition is false, so the ONLY
  // padding-top in effect is the unchanged max(24px, calc(50vh - 44.68px))
  // — re-verified here (not assumed) that this base rule is untouched.
  assert(!!gateRule && /padding-top:max\(24px, ?calc\(50vh - 44\.68px\)\)/.test(gateRule[1]),
    '[15f] the base (portrait / >500px height) padding-top rule is UNCHANGED — max(24px, calc(50vh - 44.68px)) — so portrait rendering is pixel-identical to before this pass');
}

// ── Result ───────────────────────────────────────────────────────────────────
process.stdout.write(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`,
  () => process.exit(fail === 0 ? 0 : 1));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
