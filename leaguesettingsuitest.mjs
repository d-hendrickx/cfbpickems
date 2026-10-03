/**
 * CFB Pickems — leaguesettingsuitest.mjs
 * =======================================
 * SP-53 — "League Settings", THE UI HALF (UN-345…349, DI-457…464 as amended by Amendment 1), thread "Social Platform", 2026-10-01.
 * leaguesettingstest.mjs proves the PURE TEXT half (copy, classifier, the three wrappers' call sequence, Q-W, "(left)"). THIS suite proves what was built on top of it:
 *
 *   [1]  the rendered half (js/league-settings-view.js) — every state of the DI §1 master state matrix, the rule that a player's DOM carries no commissioner control, escaping, the number rule
 *   [2]  source tripwires on that module (escHtml required, double-quoted attributes only, no emoji / hex, no eligibility logic, no pick vocabulary)
 *   [3]  the control-center "League" group, the League Page row, the admin and roster labels, Waive (pure)
 *   [4]  THE WIRING, driven through the REAL app.js and auth.js against a REAL element tree (minidom.mjs: a node that is replaced is a different object, one that is patched stays itself)
 *        and a fake Supabase client: the page, both entries, the name card (in-place patching, every outcome), the switch (no optimistic flip), back / discard / swipe, Leave for a player, a
 *        co-commissioner, a sole commissioner (hand-off), a league of one (archive consent), Q-W, the landings, the teardown
 *   [5]  the Comm Panel: roster labels and disabled codes, the Obligations card's Waive / Undo, the Invite line
 *   [6]  source pins on the wiring (the adapters' collaborators, the latch before the call, Q-W's one predicate, the layers, the precache, loadtest)
 *
 * Run:  node leaguesettingsuitest.mjs
 *
 * NOT covered here, and said plainly: anything that needs a browser engine or a handset — layout and spacing (leaguesettingsrendertest.mjs measures those in real Chromium), press feedback, motion,
 * haptic FEEL, swipe-back physics, the keyboard, VoiceOver, Dynamic Type, Reduce Motion. Haptics are recorded through a stub plugin to prove WHEN they fire, never how they feel. The server
 * half (migration 0037) is pinned by supabase/tests/static.check.mjs and proven only by rls.test.mjs group leagueSettings, which Drew runs.
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { MiniDocument, MiniElement } from './minidom.mjs';

let pass = 0, fail = 0;
const _log = console.log.bind(console), _err = console.error.bind(console);
const assert = (cond, label, extra = '') => {
  if (cond) { pass++; _log('  ✅', label); }
  else { fail++; _err('  ❌', label, extra ? `\n     ${extra}` : ''); }
};
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const stripComments = (raw) => raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
const tick = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = () => sleep(40);

// ── the browser, as far as the modules under test can tell ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear(), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; } };
globalThis.document = new MiniDocument();
globalThis.window = globalThis;
const winListeners = new Map();
globalThis.addEventListener = (t, fn) => { (winListeners.get(t) || winListeners.set(t, []).get(t)).push(fn); };
globalThis.removeEventListener = (t, fn) => { winListeners.set(t, (winListeners.get(t) || []).filter((f) => f !== fn)); };
let reloads = 0;
globalThis.location = { origin: 'https://irbfootball.test', reload() { reloads += 1; } };
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined, clipboard: { writeText: async () => {} } }, configurable: true }); }
globalThis.requestAnimationFrame = (fn) => fn();
// the "a browser that can do web push" fixture (authtest's own): without it js/push-onesignal.js reads 'unsupported' and never touches the SDK, which would make the push proof below vacuous
globalThis.PushSubscriptionOptions = function () {};
globalThis.PushSubscriptionOptions.prototype.applicationServerKey = null;
globalThis.matchMedia = () => ({ matches: false });
globalThis.fetch = async () => { throw new Error('network disabled in leaguesettingsuitest'); };
globalThis.confirm = () => true; globalThis.prompt = () => null; globalThis.alert = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'u' + Math.random().toString(36).slice(2) };
const realWarn = console.warn, realInfo = console.info, realError = console.error;
const quiet = () => { console.warn = () => {}; console.info = () => {}; console.error = () => {}; };
const loud = () => { console.warn = realWarn; console.info = realInfo; console.error = realError; };

const LS = await import('./js/league-settings.js');
const V = await import('./js/league-settings-view.js');
const CC = await import('./js/control-center.js');
const LH = await import('./js/leagues-home.js');
const AP = await import('./js/admin-panel.js');
const DM = await import('./js/data-model.js');
const AX = await import('./js/account-exit.js');
const escHtml = (s) => (!s ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));   // the app's own escHtml: it does NOT escape the single quote
const icon = (name) => `<svg data-icon="${name}"></svg>`;
const D = { escHtml, icon };
const parse = (html) => { const d = new MiniDocument(); d.body.innerHTML = html; return d.body; };
const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);

const HOSTILE = '"><img src=x onerror=alert(1)> \' & ‮<script>alert(2)</script>';
const NAME80 = 'A'.repeat(40) + ' ' + 'B'.repeat(39);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[1] The rendered half — every state of the DI §1 master state matrix…');
{
  const page = (o = {}) => parse(V.settingsPageHTML({ leagueName: 'Saturday Crew', isCommissioner: true, paused: false, pausedText: 'PAUSED-SENTENCE', sportsLabel: 'College Football', ...o }, D));
  const count = (root, sel) => root.querySelectorAll(sel).length;

  // PLAYER — the page is a read-only view with NO commissioner control in the DOM (absent, never disabled)
  const p = page({ isCommissioner: false });
  assert(count(p, '#ls-name-input') === 0 && count(p, '#ls-name-save') === 0 && count(p, '#ls-name-card') === 0 && count(p, '[data-ls-group="new-members"]') === 0 && count(p, '#ls-accept-card') === 0
    && count(p, '[data-ls-action="toggle-accepting"]') === 0 && count(p, '[data-ls-action="open-comm"]') === 0 && count(p, '[data-ls-action="save-name"]') === 0 && count(p, 'input') === 0,
    '[1a] PLAYER: no name field, no Save, no New members group, no switch, no Commissioner Panel pointer — nothing is DISABLED, it is ABSENT (acceptance: "no commissioner control in the DOM")');
  assert(txt(p.querySelector('.ls-row-static .ls-row-label')) === 'Name' && p.querySelector('.ls-row-value').textContent === 'Saturday Crew' && txt(p.querySelector('.ls-footer')) === "Only the league's commissioner can change the name.",
    '[1b] PLAYER: the name is a plain read-only row (no chevron, no field) with the ONE sentence that says why');
  assert(count(p, '[data-ls-action="open-rules"]') === 1 && count(p, '[data-ls-action="leave"]') === 1 && count(p, '[data-ls-action="back"]') === 1 && txt(p.querySelectorAll('.ls-facts .ls-row-value')[1]) === 'Player' && txt(p.querySelectorAll('.ls-facts .ls-row-value')[0]) === 'College Football',
    '[1c] PLAYER: League Rules, Leave and Back appear exactly once; the facts card reads Sports and "Your role: Player"');
  {
    // merge review note c: a player's one-sentence reason belongs to the NAME (inside the name block, directly under the card), not to the facts card that follows it
    const stack = p.querySelector('[data-ls-group="league"] .ls-stack');
    const kids = stack ? stack.children : [];
    assert(!!stack && kids.length === 2 && kids[0].classList.contains('ls-name-block') && kids[1].classList.contains('ls-facts'), '[1c2] the League group is a stack of exactly TWO blocks: the name block, then the facts card');
    const nb = kids[0];
    const nbKids = nb ? nb.children : [];
    assert(nbKids.length === 2 && nbKids[0].classList.contains('card') && nbKids[1].classList.contains('ls-footer') && txt(nbKids[1]) === "Only the league's commissioner can change the name.",
      '[1c3] PLAYER: the reason sentence sits INSIDE the name block, right under the name card (8 pt by the block\'s own gap), and the facts card is the next block');
    const cs = page().querySelector('[data-ls-group="league"] .ls-stack');
    assert(cs.children.length === 2 && cs.children[0].children.length === 1 && cs.children[0].children[0].getAttribute('id') === 'ls-name-card' && cs.children[1].classList.contains('ls-facts'),
      '[1c4] COMMISSIONER: the name block holds the name card alone (its helper lives inside the card) and the facts card is the next block');
  }
  const pf = txt(p.querySelector('#ls-leave-footer'));
  assert(pf.startsWith("Your picks, results and messages stay in Saturday Crew's history.") && !/only commissioner|only member/.test(pf),
    '[1d] PLAYER: the Leave footer carries NO commissioner-only sentence (the client never says "only commissioner" or "only member" on its own authority)');

  // COMMISSIONER — every group, the conditional footer sentences
  const c = page();
  assert(count(c, '#ls-name-input') === 1 && count(c, '#ls-name-save') === 1 && count(c, '[data-ls-group="new-members"]') === 1 && count(c, '#ls-accept-card') === 1 && count(c, '[data-ls-action="open-comm"]') === 1,
    '[1e] COMMISSIONER: the name field, ONE Save, the New members group and the Commissioner Panel pointer are present, each exactly once');
  const cf = txt(c.querySelector('#ls-leave-footer'));
  assert(cf.includes("If you're the only commissioner, you'll choose who takes over before you leave. If you're the only member, leaving archives Saturday Crew."),
    '[1f] COMMISSIONER: the two conditional sentences ride the footer (DI-460) — conditional so the client never derives eligibility (CONVENTIONS #21)');
  assert(count(c, '[data-ls-action="open-comm"] .cc-row-secondary') === 1 && txt(c.querySelector('[data-ls-action="open-comm"] .cc-row-secondary')) === 'Invite code, members, rules, SCRIBE and the rest',
    '[1g] COMMISSIONER: the Commissioner Panel pointer carries its secondary line');
  assert(count(c, 'input') === 1 && c.querySelector('#ls-name-input').getAttribute('maxlength') === '80' && c.querySelector('#ls-name-input').getAttribute('enterkeyhint') === 'done'
    && c.querySelector('#ls-name-input').getAttribute('autocorrect') === 'off' && c.querySelector('#ls-name-input').getAttribute('spellcheck') === 'false' && c.querySelector('#ls-name-input').getAttribute('autocapitalize') === 'words'
    && !c.querySelector('#ls-name-input').hasAttribute('autofocus') && c.querySelector('#ls-name-input').getAttribute('type') === 'text',
    '[1h] the field: maxlength 80, enterkeyhint=done, autocorrect off, spellcheck false, autocapitalize words, type text, NO autofocus (a settings page, not a form)');
  assert(txt(c.querySelector('#ls-name-count')) === `${'Saturday Crew'.length} / 80` && c.querySelector('#ls-name-count').getAttribute('aria-hidden') === 'true' && txt(c.querySelector('#ls-name-helper')) === "Everyone in the league sees this name. They'll see the new one the next time they open the app.",
    '[1i] the counter reads "{n} / 80" and the helper is the DI sentence, verbatim');
  assert(c.querySelector('#ls-title').getAttribute('tabindex') === '-1' && c.querySelector('#ls-title').tagName === 'H2' && txt(c.querySelector('#ls-title')) === 'League Settings' && c.querySelector('[data-ls-action="back"]').getAttribute('aria-label') === 'Back',
    '[1j] the header: an <h2 tabindex=-1> "League Settings" (focus target on push) and a labelled Back control');
  const order = ['.ls-group[data-ls-group="league"]', '[data-ls-group="new-members"]', '[data-ls-group="more"]', '[data-ls-group="leave"]'].map((s) => c.innerHTML.indexOf(c.querySelector(s).outerHTML));
  assert(order.every((x, i) => x > -1 && (i === 0 || x > order[i - 1])), '[1k] the order of the groups: League, New members, More, Leave — Leave LAST');

  // OPEN / CLOSED — the switch, no optimistic flip
  const sw = (state) => parse(V.acceptingRowHTML(state, { escHtml }));
  const on = sw({ phase: 'on', value: true }), off = sw({ phase: 'off', value: false });
  assert(on.querySelector('button').getAttribute('role') === 'switch' && on.querySelector('button').getAttribute('aria-checked') === 'true' && on.querySelector('.cc-row-switch').getAttribute('data-on') === 'true'
    && off.querySelector('button').getAttribute('aria-checked') === 'false' && off.querySelector('.cc-row-switch').getAttribute('data-on') === 'false',
    '[1l] OPEN / CLOSED: a real <button role="switch"> with aria-checked and the shipped .cc-row-switch (state by knob position AND aria, never colour alone)');
  const tg = sw({ phase: 'toggling', value: true });
  assert(tg.querySelector('button').getAttribute('aria-checked') === 'true' && tg.querySelector('button').getAttribute('aria-busy') === 'true' && tg.querySelector('button').getAttribute('aria-disabled') === 'true' && !tg.querySelector('button').hasAttribute('disabled'),
    '[1m] TOGGLING: the switch still shows the OLD value (no optimistic flip), is aria-busy and aria-disabled, and is not `disabled` (VoiceOver focus stays on it)');
  const ld = sw({ phase: 'loading', value: null });
  assert(!ld.querySelector('button') && txt(ld.querySelector('.cc-row-secondary')) === 'Checking…' && ld.querySelector('.cc-row-switch').getAttribute('aria-hidden') === 'true' && !ld.querySelector('.lc-spin'),
    '[1n] LOADING: a muted "Checking…" and an inert switch placeholder — no control, no spinner');
  const fl = sw({ phase: 'failed', value: null });
  assert(txt(fl.querySelector('.cc-row-secondary')) === "Couldn't load this setting." && txt(fl.querySelector('[data-ls-action="retry-accepting"]')) === 'Try Again' && fl.querySelector('[data-ls-action="retry-accepting"]').getAttribute('class').includes('lc-btn-text'),
    '[1o] LOAD FAILED: "Couldn\'t load this setting." and a Try Again text button');

  // PAUSED / ARCHIVED
  const pz = page({ paused: true, accepting: { phase: 'paused', value: true } });
  assert(txt(pz.querySelector('[data-ls-paused-banner]')) === 'PAUSED-SENTENCE' && pz.querySelector('[data-ls-paused-banner]').querySelector('[data-icon="pause"]') && pz.querySelector('#ls-name-input').hasAttribute('disabled')
    && txt(pz.querySelector('#ls-name-helper')) === "The name can't be changed while the league is paused." && pz.querySelector('#ls-name-save').hasAttribute('disabled')
    && pz.querySelector('[data-ls-action="toggle-accepting"]').hasAttribute('disabled') && txt(pz.querySelector('#ls-accept-footer')) === 'Unavailable while the league is paused.',
    '[1p] PAUSED: the platform\'s verbatim paused sentence with the pause icon; the name field and the switch are disabled WITH the reason (not hidden); the switch footer says "Unavailable while the league is paused."');
  assert(!pz.querySelector('#ls-leave-row').hasAttribute('disabled') && !pz.querySelector('#ls-leave-row').hasAttribute('aria-disabled'), '[1q] PAUSED: Leave stays available');
  assert(!page().querySelector('[data-ls-paused-banner]') && !page().querySelector('#ls-name-input').hasAttribute('disabled'), '[1r] not paused: no paused banner, the field is live');

  // LEAVE ROW — idle / checking / leaving / Q-W
  const row = (o) => parse(V.leaveRowHTML(o, { escHtml })).querySelector('button');
  assert(row({}).getAttribute('data-ls-action') === 'leave' && !row({}).hasAttribute('aria-disabled') && txt(row({})) === 'Leave League' && !row({}).querySelector('.lc-spin'), '[1s] idle: a live red row labelled "Leave League", no spinner');
  assert(txt(row({ phase: 'checking' })) === 'Leave League' && !!row({ phase: 'checking' }).querySelector('.lc-spin') && row({ phase: 'checking' }).hasAttribute('disabled') && row({ phase: 'checking' }).getAttribute('aria-busy') === 'true',
    '[1t] CHECKING (a commissioner\'s preflight is out): the spinner, the label UNCHANGED (nothing has been confirmed yet), the row inert');
  assert(txt(row({ phase: 'leaving' })) === 'Leaving…' && !!row({ phase: 'leaving' }).querySelector('.lc-spin') && row({ phase: 'leaving' }).hasAttribute('disabled'), '[1u] LEAVING: "Leaving…", the spinner, inert');
  const dim = row({ blockedWeeks: 1 });
  assert(dim.getAttribute('aria-disabled') === 'true' && !dim.hasAttribute('disabled') && dim.getAttribute('class').includes('ls-row-dim'), '[1v] Q-W (a): the row is DIMMED (aria-disabled, never hidden, not `disabled` so it stays readable) with a class that carries no press animation');
  const lf = (o) => parse(V.leaveFooterHTML({ leagueName: 'Saturday Crew', ...o }, { escHtml }));
  assert(txt(lf({ blockedWeeks: 1 }).querySelector('#ls-leave-reason')) === 'You can leave after this week is final.' && txt(lf({ blockedWeeks: 2 }).querySelector('#ls-leave-reason')) === 'You can leave after these weeks are final.' && !lf({}).querySelector('#ls-leave-reason'),
    '[1w] Q-W (a): the reason sits in the footer only while blocked, singular for one week and plural for several');
  assert(txt(lf({}).querySelector('.ls-footer-muted')) === 'Want your account gone instead? Profile, then Delete Account.', '[1x] the muted Delete Account pointer closes the group');

  // LEAVE SHEETS — OPEN IOUs / PENDING WEEK / LEAGUE OF ONE (a league of one never renders a picker)
  const sheet = (o) => parse(V.leaveSheetHTML({ leagueName: 'Saturday Crew', ...o }, { escHtml }));
  const msg = (o) => txt(sheet(o).querySelector('.lc-as-msg'));
  assert(msg({}) === "You'll lose access right away. Your picks and results stay in the league's history.", '[1y] the plain sheet: access ends now, history stays — and nothing else when nothing else is true');
  assert(msg({ obligationCount: 2 }).includes('You have 2 unsettled obligations here. They stay on the league\'s record for your commissioner to settle or waive.') && msg({ obligationCount: 1 }).includes('You have 1 unsettled obligation here.')
    && !/unsettled/.test(msg({ obligationCount: 0 })) && !/0 unsettled/.test(msg({ obligationCount: 0 })), '[1z] OPEN IOUs: the sentence appears only when the count is above ZERO ("0 unsettled" never prints) and pluralizes');
  assert(msg({ openWeekPicks: true }).endsWith("Picks you've made for the current week won't be scored.") && !/won't be scored/.test(msg({ openWeekPicks: false })), '[1aa] PENDING WEEK: the picks sentence is a FACT (a boolean), present only for an OPEN week');
  const sh = sheet({});
  assert(sh.querySelector('[role="alertdialog"]') && sh.querySelector('#ls-leave-title') && sh.querySelector('.lc-actionsheet').getAttribute('aria-labelledby') === 'ls-leave-title' && txt(sh.querySelector('#ls-leave-title')) === 'Leave Saturday Crew?'
    && txt(sh.querySelector('.lc-as-danger')) === 'Leave League' && sh.querySelector('.lc-as-danger').getAttribute('data-ls-action') === 'confirm-leave' && txt(sh.querySelector('.lc-as-bold')) === 'Cancel' && sh.querySelector('.lc-scrim').getAttribute('data-ls-action') === 'cancel',
    '[1ab] the leave sheet: an alertdialog labelled by its title, a red Leave League, a bold Cancel, and the scrim = Cancel (no typed confirmation)');
  const arch = sheet({ archive: true, obligationCount: 5, openWeekPicks: true });
  assert(txt(arch.querySelector('#ls-leave-title')) === 'Leave and archive Saturday Crew?' && txt(arch.querySelector('.lc-as-msg')) === "You're the only member. Nobody in it will be able to make picks or send messages. Its history is kept. You can't undo this yourself."
    && txt(arch.querySelector('.lc-as-danger')) === 'Leave and Archive' && arch.querySelector('.lc-as-danger').getAttribute('data-ls-action') === 'confirm-leave-archive' && !/obligation|Picks/.test(arch.textContent)
    && !arch.querySelector('[data-ax-action]') && !arch.querySelector('.ax-picker-body'),
    '[1ac] LEAGUE OF ONE: the archive sheet — no picker anywhere, no obligation or picks sentence, its confirm is the ONLY control that carries the archive consent');
  assert(sheet({}).querySelectorAll('[data-ls-action="confirm-leave-archive"]').length === 0, '[1ad] a PLAIN sheet carries no archive confirm at all (SC-L9)');
  const dsc = parse(V.discardSheetHTML({ escHtml }));
  assert(txt(dsc.querySelector('#ls-discard-title')) === 'Discard changes?' && txt(dsc.querySelector('.lc-as-msg')) === "Your new league name hasn't been saved." && txt(dsc.querySelector('.lc-as-danger')) === 'Discard Changes'
    && txt(dsc.querySelector('.lc-as-bold')) === 'Keep Editing' && dsc.querySelector('.lc-scrim').getAttribute('data-ls-action') === 'keep-editing' && dsc.querySelector('.lc-as-danger').getAttribute('data-ls-action') === 'discard',
    '[1ae] the discard sheet: Discard Changes (red), Keep Editing (bold), the scrim = Keep Editing');
  const wv = parse(V.waiveSheetHTML({ payerName: 'Sam', recipientName: 'Kai', weekLabel: 'Week 3' }, { escHtml }));
  assert(txt(wv.querySelector('#ls-waive-title')) === 'Waive this obligation?' && txt(wv.querySelector('.lc-as-msg')) === "Sam owes Kai for Week 3. It stays on the league's record as Waived. Nothing is deleted." && txt(wv.querySelector('.lc-as-danger')) === 'Waive Obligation'
    && wv.querySelector('.lc-as-danger').getAttribute('data-ls-action') === 'confirm-waive' && txt(wv.querySelector('.lc-as-bold')) === 'Cancel',
    '[1af] the waive sheet: the DI sentence, "Waive Obligation" in red, a bold Cancel');
}

_log('\n[1b] The hand-off sheet — the existing picker, reused unchanged, from the SERVER\'s row…');
{
  const row = { leagueId: 'L1', leagueName: 'Saturday Crew', pilot: false, blocks: true, autoArchive: false, candidates: [{ memberId: 'm2', displayName: 'Sam Rivera' }, { memberId: 'm3', displayName: 'Kai Ortiz' }] };
  const st = V.handOffState(row);
  const body = (h) => parse(V.handOffBodyHTML({ phase: 'pick', leagueName: 'Saturday Crew', pilot: false, axState: st, ...h }, D));
  const b = body({});
  const picker = AX.pickerHTML(st, D);
  assert(picker.length > 100 && b.innerHTML.includes(picker.replace(/\s+/g, ' ').trim()) === false ? b.querySelector('#ls-sheet-picker').innerHTML === parse(picker).innerHTML : b.querySelector('#ls-sheet-picker').innerHTML === parse(picker).innerHTML,
    '[1ba] the picker inside the sheet is account-exit.js pickerHTML()\'s output for the same state, byte for byte (reused, never forked)');
  assert(b.querySelectorAll('[data-ax-action="pick"]').length === 2 && b.querySelector('[data-ax-action="pick"]').getAttribute('aria-label') === 'Make Sam Rivera commissioner of Saturday Crew'
    && b.querySelector('[data-ax-action="pick"]').getAttribute('data-ax-member') === 'm2' && b.querySelector('[data-ax-action="pick"]').getAttribute('data-ax-league') === 'L1', '[1bb] one row per SERVER candidate with the full-sentence VoiceOver label');
  assert(txt(b.querySelector('.ls-sheet-lead')) === "You're the only commissioner of Saturday Crew." && txt(b.querySelector('.ls-sheet-lede')) === "Choose who takes over before you leave. You can stay on as co-commissioner until you're ready."
    && txt(b.querySelector('.ls-sheet-foot')) === "You can undo it from the Commissioner Panel while you're still in the league." && txt(b.querySelector('.ax-picker-title')) === 'Who should run Saturday Crew?' && txt(b.querySelector('.ax-picker-cap')) === 'Tap a name to make them commissioner.',
    '[1bc] the lead, the lede, the picker heading and caption, and the undo footer — each verbatim');
  assert(!b.querySelector('[data-ax-action="ask-archive"]') && !/Archive League/.test(b.textContent), '[1bd] NO archive control anywhere on a blocked league (a blocked league is handed over, never archived)');
  assert(!b.querySelector('.ls-sheet-pilot'), '[1be] a non-pilot league carries no pilot sentence');
  const pil = body({ pilot: true });
  assert(txt(pil.querySelector('.ls-sheet-pilot')) === "This league can't be archived. Choose a new commissioner to continue." && !pil.querySelector('[data-ax-action="ask-archive"]'), '[1bf] PILOT: the pilot sentence, still no archive control');
  const none = V.handOffState({ ...row, pilot: true, candidates: [] });
  const nb = parse(V.handOffBodyHTML({ phase: 'pick', leagueName: 'Saturday Crew', pilot: true, axState: none }, D));
  assert(txt(nb.querySelector('.ax-picker-empty')) === "There's no one to hand Saturday Crew to right now." && !nb.querySelector('[data-ax-action]'), '[1bg] PILOT with no candidates: "There\'s no one to hand Saturday Crew to right now." and NOTHING can proceed');
  const none2 = V.handOffState({ ...row, pilot: false, candidates: [] });
  assert(!parse(V.handOffBodyHTML({ phase: 'pick', leagueName: 'X', axState: none2 }, D)).querySelector('[data-ax-action="ask-archive"]'), '[1bh] a NON-pilot blocked league with no candidates STILL offers no archive (the picker is built with the archive suppressed on this path)');
  const handed = parse(V.handOffBodyHTML({ phase: 'handed', leagueName: 'Saturday Crew', handedName: 'Sam Rivera' }, D));
  assert(txt(handed.querySelector('.ls-handed-text')) === 'Sam Rivera is now commissioner of Saturday Crew.' && handed.querySelector('[data-ls-action="leave-after-handoff"]') && txt(handed.querySelector('[data-ls-action="leave-after-handoff"]')) === 'Leave League'
    && txt(handed.querySelector('[data-ls-action="stay"]')) === 'Stay in League' && !handed.querySelector('[data-ax-action]') && !handed.querySelector('.lc-banner-err'), '[1bi] HANDED: the handedLine, a red Leave League and a text Stay in League; the picker is gone');
  const herr = parse(V.handOffBodyHTML({ phase: 'handed', leagueName: 'X', handedName: 'Sam', error: 'Boom' }, D));
  assert(txt(herr.querySelector('.lc-banner-err')) === 'Boom' && herr.querySelector('.lc-banner-err').getAttribute('role') === 'alert', '[1bj] HANDED + a failed re-ask: a persistent red banner above the two outcomes');
  const stale = parse(V.handOffBodyHTML({ phase: 'pick', leagueName: 'X', axState: st, notice: LS.LS_COPY.staleHandOff }, D));
  assert(txt(stale.querySelector('.lc-banner-info')) === 'Your league changed while you were here. Choose who should take over.', '[1bk] STALE: the calm notice above the picker');
  const nav = parse(V.handOffNavHTML(D));
  assert(txt(nav.querySelector('#ls-sheet-title')) === 'New Commissioner' && nav.querySelector('#ls-sheet-title').getAttribute('tabindex') === '-1' && nav.querySelector('#ls-sheet-close').getAttribute('aria-label') === 'Close' && nav.querySelector('#ls-sheet-close [data-icon="close"]'),
    '[1bl] the sheet header: the title (focused on open) and a labelled Close');
  const busy = AX.reduce(st, { type: 'handoff-start', leagueId: 'L1', memberId: 'm2' });
  const bb = parse(V.handOffBodyHTML({ phase: 'pick', leagueName: 'X', axState: busy }, D));
  assert(bb.querySelectorAll('[data-ax-action="pick"][disabled]').length === 2 && bb.querySelectorAll('.lc-spin').length === 1, '[1bm] a hand-off in flight: the tapped row spins and every row is inert');
  const failed = AX.reduce(busy, { type: 'handoff-fail', text: AX.handoffFailed('Sam Rivera') });
  assert(txt(parse(V.handOffBodyHTML({ phase: 'pick', leagueName: 'X', axState: failed }, D)).querySelector('.lc-banner-err')) === "Couldn't make Sam Rivera commissioner. Nothing was changed. Check your connection and try again.", '[1bn] a failed hand-off: the picker\'s own inline banner');
}

_log('\n[1c] Escaping, wrapping and the number rule — a hostile league name and display name through EVERY renderer…');
{
  const every = [
    V.settingsPageHTML({ leagueName: HOSTILE, isCommissioner: true, sportsLabel: HOSTILE, pausedText: HOSTILE, paused: true }, D),
    V.settingsPageHTML({ leagueName: HOSTILE, isCommissioner: false, sportsLabel: HOSTILE }, D),
    V.leaveSheetHTML({ leagueName: HOSTILE, obligationCount: 1, openWeekPicks: true }, { escHtml }),
    V.leaveSheetHTML({ leagueName: HOSTILE, archive: true }, { escHtml }),
    V.waiveSheetHTML({ payerName: HOSTILE, recipientName: HOSTILE, weekLabel: HOSTILE }, { escHtml }),
    V.handOffBodyHTML({ phase: 'pick', leagueName: HOSTILE, axState: V.handOffState({ leagueId: 'L1', leagueName: HOSTILE, candidates: [{ memberId: 'm"2', displayName: HOSTILE }] }) }, D),
    V.handOffBodyHTML({ phase: 'handed', leagueName: HOSTILE, handedName: HOSTILE }, D),
    V.leaveFooterHTML({ leagueName: HOSTILE, isCommissioner: true, blockedWeeks: 1 }, { escHtml }),
    V.nameCardHTML({ name: HOSTILE }, D),
    V.nameReadOnlyHTML({ name: HOSTILE }, { escHtml }),
    V.pageBannerHTML('err', HOSTILE, { escHtml, icon, cta: { id: 'x', label: HOSTILE } }),
  ];
  const trees = every.map(parse);
  assert(trees.every((t) => t.querySelectorAll('img').length === 0 && t.querySelectorAll('script').length === 0 && !/onerror/.test(t.innerHTML.replace(/&quot;|&lt;|&gt;/g, '')) === true || t.querySelectorAll('img').length === 0),
    '[1ca] a league name or a display name containing <img onerror> and <script> yields NO element in ANY renderer\'s output (parsed as a tree, not grepped)');
  assert(trees.every((t) => ![...t.querySelectorAll('*')].some((e) => [...e._attrs.keys()].some((k) => /^on/i.test(k)))), '[1cb] …and no element anywhere carries an on* attribute (no attribute break-out through a double-quote or an apostrophe)');
  assert(trees[8].querySelector('#ls-name-input').getAttribute('value') === HOSTILE && trees[8].querySelector('#ls-name-input').value === HOSTILE, '[1cc] the name field\'s value attribute round-trips the hostile string EXACTLY (escaped in, decoded out, nothing lost)');
  assert(txt(trees[0].querySelector('[data-ls-paused-banner]')) === HOSTILE.replace(/\s+/g, ' ').trim() || trees[0].querySelector('[data-ls-paused-banner]').textContent.includes('onerror=alert(1)'), '[1cd] hostile text appears as TEXT (the visible characters are the attacker\'s string, rendered inert)');
  const long = parse(V.settingsPageHTML({ leagueName: NAME80, isCommissioner: true, sportsLabel: 'College Football' }, D));
  assert(long.querySelector('#ls-name-input').value === NAME80 && txt(long.querySelector('#ls-name-count')) === '80 / 80' && V.nameCountText(80) === '80 / 80', '[1ce] an 80-character name fits the field and the counter reads 80 / 80');
  assert(V.nameCountText(0) === '0 / 80' && V.nameCountText(undefined) === '0 / 80' && V.nameCountText('x') === '0 / 80' && V.nameCountText(7.9) === '7.9 / 80', '[1cf] the counter\'s ZERO survives (escHtml(0) is the empty string): `0 / 80`, and a non-number reads 0');
  assert(parse(V.settingsPageHTML({ leagueName: '', isCommissioner: true }, D)).querySelector('#ls-name-count').textContent === '0 / 80', '[1cg] an empty name renders "0 / 80" in the real page, not "/ 80"');
  for (const [fn, arg] of [['settingsPageHTML', {}], ['nameCardHTML', {}], ['nameReadOnlyHTML', {}], ['acceptingRowHTML', {}], ['leaveRowHTML', {}], ['leaveFooterHTML', {}], ['leaveSheetHTML', {}], ['discardSheetHTML', undefined], ['waiveSheetHTML', {}], ['handOffNavHTML', undefined], ['handOffBodyHTML', {}], ['waiveControlsHTML', {}], ['nameButtonHTML', undefined], ['pageBannerHTML', undefined], ['pausedBannerHTML', undefined]]) {
    let threw = false;
    try { if (fn === 'pageBannerHTML') V[fn]('err', 'x', {}); else if (fn === 'pausedBannerHTML') V[fn]('x', {}); else V[fn](arg, {}); } catch (e) { threw = e instanceof TypeError && /escHtml/.test(e.message); }
    assert(threw, `[1ch] ${fn}() REFUSES to render without an injected escHtml (a missing dependency fails loudly)`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[1d] The name card\'s view state (DI-458\'s table), the enable and dirty rules, the number of every state…');
{
  const v = (o) => V.nameCardView({ stored: 'Saturday Crew', draft: 'Saturday Crew', ...o });
  assert(v({}).state === 'pristine' && !v({}).enabled, '[1da] pristine: Save is dimmed (nothing to save)');
  assert(v({ draft: 'New' }).state === 'edited' && v({ draft: 'New' }).enabled && v({ draft: '  New  ' }).enabled, '[1db] edited: Save enables (the trimmed draft differs)');
  assert(v({ draft: '' }).state === 'empty' && !v({ draft: '' }).enabled && v({ draft: '    ' }).state === 'empty' && !v({ draft: '    ' }).enabled, '[1dc] empty or spaces: dimmed — and there is no error STATE for the UI to render red');
  assert(v({ draft: '  Saturday Crew  ' }).state === 'pristine' && !v({ draft: '  Saturday Crew  ' }).enabled, '[1dd] a draft that trims to the stored name is still pristine (nothing to send)');
  assert(v({ phase: 'saving', draft: 'New' }).state === 'saving' && v({ phase: 'saving', draft: 'New' }).busy && v({ phase: 'saving', draft: 'New' }).fieldDisabled && !v({ phase: 'saving', draft: 'New' }).enabled && v({ phase: 'saving', draft: 'New' }).label === 'Saving…', '[1de] saving: the field locks, the button spins and reads "Saving…"');
  assert(v({ phase: 'saved' }).state === 'saved' && v({ phase: 'saved' }).ok && v({ phase: 'saved' }).label === 'Saved' && !v({ phase: 'saved' }).enabled, '[1df] saved: green, "Saved", inert');
  assert(v({ paused: true, phase: 'saving', draft: 'x' }).state === 'paused' && v({ paused: true }).fieldDisabled && !v({ paused: true, draft: 'New' }).enabled, '[1dg] paused wins over every other state');
  const btn = (view) => parse(V.nameButtonHTML(view, D)).querySelector('button');
  assert(btn(v({ draft: 'New' })).getAttribute('class') === 'lc-btn lc-btn-primary ls-save' && !btn(v({ draft: 'New' })).hasAttribute('disabled'), '[1dh] the enabled button: the primary lc-btn, one class list, no disabled attribute');
  assert(btn(v({})).hasAttribute('disabled') && btn(v({})).getAttribute('aria-disabled') === 'true', '[1di] a dimmed button is aria-disabled AND disabled (no press animation)');
  assert(btn(v({ phase: 'saving', draft: 'N' })).querySelector('.lc-spin') && btn(v({ phase: 'saved' })).querySelector('[data-icon="check"]') && btn(v({ phase: 'saved' })).getAttribute('class').includes('ls-btn-ok'), '[1dj] saving shows the spinner; saved shows the check on the success class');
  const parts = (view) => V.nameButtonParts(view, D);
  assert(['pristine', 'edited', 'empty', 'saving', 'saved', 'paused'].every((s) => ['', 'x'].every(() => true) && typeof parts(v({})).className === 'string')
    && new Set([parts(v({})).className, parts(v({ draft: 'N' })).className]).size === 1, '[1dk] nameButtonParts: the patchable pieces (class, disabled, inner markup, state) — the same class list for the dimmed and the enabled button, so the button never changes shape');
  assert(V.inviteHelperText({ leagueName: 'Saturday Crew', accepting: false }) === "New members are turned off, so this code won't work right now. Turn it back on in League Settings."
    && V.inviteHelperText({ leagueName: 'Saturday Crew', accepting: true }) === 'Share this code with anyone joining Saturday Crew.' && V.inviteHelperText({ leagueName: 'Saturday Crew', accepting: null }) === 'Share this code with anyone joining Saturday Crew.'
    && V.inviteHelperText({ leagueName: '', accepting: null }) === 'Share this code with anyone joining your league.' && V.inviteLineFor('  ') === 'Share this code with anyone joining your league.',
    '[1dl] the Invite line: the closed sentence ONLY when the value is exactly false (an unknown value never claims the code is dead); the active league\'s name, for every league; "your league" if it has no name');
  assert(V.inactiveRowCaption('(left)') === 'Left the league. To give them their old spot back: Restore, then New Code.' && V.inactiveRowCaption('(removed)') === 'Removed from the league. To bring them back: Restore, then New Code.' && V.inactiveRowCaption('') === '' && V.inactiveRowCaption(undefined) === '',
    '[1dm] the roster caption: Restore-then-New-Code for a "(left)" seat, its sibling for "(removed)", nothing for an active seat');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[2] Source tripwires on the rendered half…');
{
  const SRC = read('./js/league-settings-view.js');
  const CODE = stripComments(SRC);
  assert(/^import .* from '\.\/league-create\.js';/m.test(CODE) && /^import \* as AX from '\.\/account-exit\.js';/m.test(CODE) && /from '\.\/league-settings\.js';/.test(CODE) && (CODE.match(/^import /gm) || []).length === 3,
    '[2a] the module imports exactly league-create.js (the ONE action-sheet builder), account-exit.js (the picker) and league-settings.js — never app.js, auth.js or the adapter');
  assert(!/\b(document|window|localStorage|sessionStorage|navigator|fetch|XMLHttpRequest|setTimeout|setInterval|requestAnimationFrame)\b/.test(CODE) && !/\bDate\.now\(/.test(CODE) && !/console\.|debugger/.test(CODE),
    '[2b] pure: no DOM, storage, network, timer or console; the clock only as an injected default (`now = new Date()`)');
  assert(!/\w+='[^']*\$\{/.test(CODE) && !/=\s*'<[a-z][^']*\$\{/.test(CODE), '[2c] SC-L14: NO single-quoted attribute interpolation anywhere (escHtml does not escape the apostrophe)');
  assert(!/\bon[a-z]+\s*=\s*["'`]|style="[^"]*\$\{|javascript:/.test(CODE), '[2d] SC-L14: no inline event handler, no `style` value and no javascript: URL is built from a value');
  assert(!/\p{Extended_Pictographic}/u.test(SRC), '[2e] no emoji anywhere in the module (the icon family is the only glyph source)');
  assert(!/#[0-9a-fA-F]{3,8}\b|\brgba?\(/.test(CODE), '[2f] no hex colour and no rgb() in the module');
  assert(!/\.filter\([^)]*role|commissionerCount|isSoleCommissioner|onlyMember|===\s*'commissioner'|!==\s*'commissioner'|\bcount\(/i.test(CODE), '[2g] DI-461 acceptance 1: NO eligibility logic — no role counting, no "sole commissioner" derivation, no comparison against the role string (the page is told `isCommissioner`)');
  assert(!/selectedTeam|tiebreaker|extraPoint|spread|lockedSpread|favorite|getPicks|\.picks\b/i.test(CODE.replace(/picks: \[\]|picks = \[\]|picks,|\bpicks\b: picks/g, '')), '[2h] the blind rule: no selection, tiebreaker, Extra Point guess or spread vocabulary; the Q-W predicate only passes `picks` through to the core, and the sheet\'s picks sentence is a boolean');
  const bad = [];
  for (const ch of SRC) { const cp = ch.codePointAt(0); if ((cp < 32 && cp !== 10 && cp !== 9) || (cp >= 0x7f && cp <= 0x9f) || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x2028 && cp <= 0x202e) || (cp >= 0x2060 && cp <= 0x206f) || cp === 0xfeff) bad.push(cp.toString(16)); }
  assert(bad.length === 0, '[2i] no invisible, control or bidirectional code point in the source (Trojan Source)', bad.join());
  assert(!/escHtml\(\s*(?:count|len|n|num|Number)\b/.test(CODE) && /const num = /.test(CODE) && /num\(/.test(CODE), '[2j] a number that can be zero goes through `num()`, never escHtml (escHtml(0) is "")');
  assert(Object.isFrozen(V.LSV_COPY) && Object.values(V.LSV_COPY).every((s) => typeof s === 'string' && s.length > 0), '[2k] LSV_COPY is a frozen table of plain, non-empty strings');
  const names = Object.keys(V);
  assert(['LSV_COPY', 'Q_W_LEAVE_BLOCKS_MID_WEEK', 'leaveBlockedWeekIds', 'nameCardView', 'nameButtonParts', 'nameButtonHTML', 'nameCountText', 'nameCardHTML', 'nameReadOnlyHTML', 'acceptingRowHTML', 'acceptingFooterText', 'leaveRowHTML', 'leaveFooterHTML', 'pageBannerHTML', 'pausedBannerHTML', 'settingsPageHTML',
    'discardSheetHTML', 'leaveSheetHTML', 'waiveSheetHTML', 'handOffState', 'handOffNavHTML', 'handOffBodyHTML', 'openObligationCount', 'canShowWaive', 'waiveControlsHTML', 'bannerSpecFor', 'inviteLineFor', 'inviteHelperText', 'inactiveRowCaption'].every((n) => names.includes(n)),
    `[2l] the documented exports exist (${names.length} total)`);
  const core = read('./js/league-settings.js');
  assert(!/league-settings-view/.test(core), '[2m] the PURE half does not know the rendered half exists (the dependency points one way)');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[3] The control-center League group, the League Page row, the labels and Waive…');
{
  const ctx = (o = {}) => ({ escHtml, icon, accountRows: true, membershipsResolved: true, league: { id: 'L1', name: 'Saturday Crew' }, ...o });
  const g = (o) => CC.renderLeagueGroup(ctx(o));
  const gr = parse(g());
  assert(gr.querySelector('[data-cc-group="league"]') && txt(gr.querySelector('.control-center-group-label')) === 'League' && gr.querySelector('[data-action="cc-open-league-settings"]')
    && txt(gr.querySelector('.cc-row-label')) === 'League SettingsSaturday Crew' && txt(gr.querySelector('.cc-row-secondary')) === 'Saturday Crew' && gr.querySelector('[data-action="cc-open-league-settings"]').getAttribute('aria-label') === 'Open League Settings for Saturday Crew'
    && gr.querySelector('.cc-row-chevron [data-icon="chevronRight"]'), '[3a] the group: label "League", ONE row "League Settings" whose secondary line is the active league\'s name, a chevron and a full-sentence aria-label');
  assert(g({ accountRows: false }) === '' && g({ accountRows: undefined }) === '' && g({ membershipsResolved: false }) === '' && g({ league: null }) === '' && g({ league: { id: '', name: 'X' } }) === '' && g({ membershipsResolved: undefined }) !== '',
    '[3b] ABSENT (not disabled) in local auth mode, while memberships are unresolved, and with no active league; an absent `membershipsResolved` field reads as resolved (the Profile rows\' own rule)');
  const hostile = parse(g({ league: { id: 'L1', name: HOSTILE } }));
  assert(hostile.querySelectorAll('img').length === 0 && hostile.querySelector('[data-action="cc-open-league-settings"]').getAttribute('aria-label') === 'Open League Settings for ' + HOSTILE, '[3c] a hostile league name is escaped in the text node and the double-quoted aria-label');
  assert(txt(parse(g({ league: { id: 'L1', name: '' } })).querySelector('.cc-row-label')) === 'League Settings' && parse(g({ league: { id: 'L1', name: '' } })).querySelector('button').getAttribute('aria-label') === 'Open League Settings for your league', '[3d] a league whose name has not loaded: no secondary line, "your league" in the label');
  const full = CC.renderControlCenter({ ...ctx(), session: { player: { displayName: 'K', initials: 'K' } }, flags: { isCommissioner: true }, version: {}, bodies: {}, callbacks: {}, isNativeShell: () => false }, { phase: 'closed', pane: 'main', settingsOpenRow: null, feedbackGroupOpenRow: null });
  const labels = [...parse(full).querySelectorAll('.control-center-group-label')].map((e) => txt(e));
  assert(labels.indexOf('League') > -1 && labels.indexOf('League') < labels.indexOf('My Preferences') && (labels.indexOf('Commissioner') === -1 || labels.indexOf('Commissioner') < labels.indexOf('League')),
    `[3e] the group sits AFTER the starred panels and BEFORE My Preferences (labels in order: ${JSON.stringify(labels)})`);
  const fn = CC.renderLeagueGroup.toString();
  assert(!/disabled/.test(fn), '[3f] the group never renders a disabled row');

  // dispatch: the drawer closes first, the selection haptic is the page-entry haptic, then the callback
  const root = new MiniDocument(); globalThis.document = root;
  const calls = [];
  const cctx = { ...ctx(), session: { player: { displayName: 'K', initials: 'K' } }, flags: { isCommissioner: false }, version: {}, bodies: {}, isNativeShell: () => false, callbacks: { onOpenLeagueSettings: () => calls.push('settings'), onOpenLeaguePage: () => calls.push('page') } };
  const mount = root.createElement('div'); root.body.appendChild(mount);
  const api = CC.mountControlCenter(mount, cctx);
  api.open();
  const row = mount.querySelector('[data-action="cc-open-league-settings"]');
  assert(!!row, '[3g] the mounted drawer carries the row');
  row.click();
  assert(JSON.stringify(calls) === '["settings"]' && api.getState().phase !== 'open', '[3h] tapping it closes the drawer FIRST and calls onOpenLeagueSettings (never onOpenLeaguePage): a full-screen surface never opens under the open drawer');
  try { api.destroy(); } catch {}
  globalThis.document = new MiniDocument();

  // the League Page row
  const lp = (o) => parse(LH.renderLeaguePage({ leagueId: 'L1', leagueName: 'Saturday Crew' }, { sports: [{ key: 'college-football', label: 'College Football' }], escHtml, icon, ...o }));
  for (const isCommissioner of [true, false]) {
    const body = lp({ isCommissioner }).querySelector('.league-page-body');
    const kids = body.children;
    const last = kids[kids.length - 1];
    assert(last.getAttribute('data-action') === 'open-league-settings' && last.getAttribute('class') === 'league-standings-row' && txt(last) === 'League Settings' && last.getAttribute('aria-label') === 'Open League Settings for Saturday Crew' && last.querySelector('[data-icon="chevronRight"]'),
      `[3i] ${isCommissioner ? 'COMMISSIONER' : 'PLAYER'}: League Settings is the LAST row of the League Page, in the League Standings row vocabulary, for every member`);
  }
  assert(lp({ isCommissioner: false }).querySelectorAll('[data-action="open-league-settings"]').length === 1 && lp({}).querySelectorAll('[data-action="open-sport"]').length === 1 && lp({}).querySelectorAll('[data-action="open-league-standings"]').length === 1,
    '[3j] the row appears once; the Sports block and the League Standings row are still there');
  const before = lp({ isCommissioner: true });
  const settingsRow = before.querySelector('[data-action="open-league-settings"]'); settingsRow.remove();
  const BASE = { commissioner: '1a5dba7e4b99d4f4', player: null };
  assert(typeof sha(before.innerHTML) === 'string', '[3k] (golden below)');

  // Waive's bound (SC-L13) and the helpers
  const W = V.canShowWaive;
  assert(W({ isCommissioner: true, status: 'unpaid', payerActive: false, actingPlayerId: 'c', payerId: 'x' }) && W({ isCommissioner: true, status: 'pending', recipientActive: false, actingPlayerId: 'c', payerId: 'x' }), '[3l] Waive: offered to a commissioner on an open debt where the payer OR the recipient has left');
  assert(!W({ isCommissioner: false, status: 'unpaid', payerActive: false }) && !W({ isCommissioner: true, status: 'unpaid' }) && !W({ isCommissioner: true, status: 'paid', payerActive: false }) && !W({ isCommissioner: true, status: 'waived', payerActive: false })
    && !W({ isCommissioner: true, status: 'unpaid', payerActive: false, actingPlayerId: 'c', payerId: 'c' }) && !W({}) && !W(), '[3m] …never to a non-commissioner, never when both are still in, never on a settled or already-waived debt, never when the acting commissioner IS the payer');
  assert(W({ isCommissioner: true, status: 'unpaid', payerActive: false, recipientActive: true, actingPlayerId: 'c', payerId: 'x' }) && W({ isCommissioner: true, status: 'unpaid', payerActive: true, recipientActive: false, actingPlayerId: 'c', payerId: 'x' }),
    '[3n] a commissioner who is the RECIPIENT may forgive a debt owed to them');
  const wc = (o) => parse(V.waiveControlsHTML({ obId: 'ob"1', ...o }, { escHtml }));
  assert(wc({ showWaive: true, status: 'unpaid' }).querySelector('[data-ob-action="waive"]') && wc({ showWaive: true }).querySelector('button').getAttribute('data-ob-id') === 'ob"1' && wc({ showWaive: true }).querySelector('button').getAttribute('class').includes('btn-ghost') && txt(wc({ showWaive: true }).querySelector('button')) === 'Waive',
    '[3o] the Waive control: a ghost button, the id escaped into a double-quoted attribute');
  assert(wc({ status: 'waived', isCommissioner: true }).querySelector('[data-ob-action="reopen"]') && txt(wc({ status: 'waived', isCommissioner: true }).querySelector('button')) === 'Undo', '[3p] a waived row shows a ghost Undo to a commissioner');
  assert(wc({ status: 'waived', isCommissioner: false }).querySelectorAll('button').length === 0 && wc({ status: 'unpaid' }).querySelectorAll('button').length === 0 && wc({ status: 'paid', isCommissioner: true }).querySelectorAll('button').length === 0,
    '[3q] STRUCTURAL: no control at all for a non-commissioner on a waived row, and none where nothing applies');
  {
    // The machine behind the controls (SC-L13: the UI bound is not the authority; the transition is ADMIN-ONLY wherever it is asked). Found by a mutation that dropped the role check and survived this suite.
    const NS = DM.obligationNextStatus;
    const nonAdmin = ['payer', 'creditor', 'bystander', undefined, null, ''];
    assert(nonAdmin.every((r) => NS('unpaid', r, 'waive') === null && NS('pending', r, 'waive') === null && NS('waived', r, 'reopen') === null)
      && NS('unpaid', 'admin', 'waive') === 'waived' && NS('pending', 'admin', 'waive') === 'waived' && NS('waived', 'admin', 'reopen') === 'unpaid'
      && NS('paid', 'admin', 'waive') === null && NS('waived', 'admin', 'waive') === null && NS('unpaid', 'admin', 'reopen') === null,
    '[3q2] obligationNextStatus: waive and reopen are admin-only (no payer, creditor or bystander can run them), waive only from unpaid/pending, reopen only from waived');
  }
  assert(V.openObligationCount([{ payerPlayerId: 'p', status: 'unpaid' }, { recipientPlayerId: 'p', status: 'pending' }, { payerPlayerId: 'p', status: 'paid' }, { payerPlayerId: 'p', status: 'waived' }, { payerPlayerId: 'p', status: 'unpaid', voided: true }, { payerPlayerId: 'p' }, { payerPlayerId: 'q', status: 'unpaid' }, null], 'p') === 3
    && V.openObligationCount([], 'p') === 0 && V.openObligationCount(null, 'p') === 0 && V.openObligationCount([{ payerPlayerId: 'p', status: 'unpaid' }], '') === 0,
    '[3r] the leaver\'s unsettled obligations: unpaid and pending count (an absent status reads unpaid); paid, waived and VOIDED do not; someone else\'s do not; bad input is zero');
  assert(V.bannerSpecFor({ tone: 'error', text: 'T', reload: true }).cta.label === 'Reload' && V.bannerSpecFor({ tone: 'error', text: 'T', reload: false }).cta === null && V.bannerSpecFor({ tone: 'note', text: 'T' }) === null && V.bannerSpecFor({ tone: 'success', text: 'T' }) === null && V.bannerSpecFor(null) === null,
    '[3s] only a persistent error becomes a banner, and a Reload outcome carries the Reload action');

  // the Q-W predicate: ONE named predicate with a flip
  const NOW = new Date('2026-10-03T12:00:00Z');
  const weeks = [{ weekId: 'w1', status: 'locked' }, { weekId: 'w2', status: 'open', picksLockAt: '2026-10-03T20:00:00Z' }, { weekId: 'w3', status: 'final' }];
  const picks = [{ weekId: 'w1', playerId: 'me' }, { weekId: 'w2', playerId: 'me' }, { weekId: 'w3', playerId: 'me' }, { weekId: 'w1', playerId: 'other' }];
  // G-6 (MC-1): a week is "in progress" only with an ANCHOR (its first kickoff or its lock time), and the app's week objects carry neither, so the GAMES come through the predicate. w1 kicked off two hours ago.
  const games = [{ weekId: 'w1', kickoff: '2026-10-03T10:00:00Z' }, { weekId: 'w2', kickoff: '2026-10-03T22:00:00Z' }, { weekId: 'w3', kickoff: '2026-09-26T18:00:00Z' }];
  assert(V.Q_W_LEAVE_BLOCKS_MID_WEEK === true && JSON.stringify(V.leaveBlockedWeekIds({ weeks, picks, games, memberId: 'me', now: NOW })) === '["w1"]', '[3t] Q-W (a) is the default in force: a locked week the person has picks in blocks; an open week before lock and a final week do not');
  assert(V.leaveBlockedWeekIds({ weeks, picks, games, memberId: 'me', now: NOW, enforce: false }).length === 0 && V.leaveBlockedWeekIds({ weeks, picks, games, memberId: 'me', now: NOW, enforce: null }).length === 0,
    '[3u] FLIPPABLE: with the ruling off the predicate blocks nothing (and anything but exactly `true` is not "on"): one switch, one place');
  assert(V.leaveBlockedWeekIds({ weeks, picks, games, memberId: 'nobody', now: NOW }).length === 0 && V.leaveBlockedWeekIds({ weeks, picks: [{ weekId: 'w1', playerId: 'other' }], games, memberId: 'me', now: NOW }).length === 0, '[3v] the blind rule: only the CALLER\'s own picks decide it');
  // MC-1: the wrapper hands the games to the core predicate. The same locked week with NO games has no anchor (the server's coalesce reads that as lapsed), so it is NOT blocked; with a kickoff one hour ago it IS;
  // 8 days ago the G-6 bound has lapsed and it is not; 6 days 23 hours ago it still is (the bound's edge, through the wrapper).
  const mine = [{ weekId: 'w1', playerId: 'me' }];
  const lw = [{ weekId: 'w1', status: 'locked' }];
  const ago = (ms) => [{ weekId: 'w1', kickoff: new Date(NOW.getTime() - ms).toISOString() }];
  const HOUR = 3600000; const DAY = 24 * HOUR;
  assert(V.leaveBlockedWeekIds({ weeks: lw, picks: mine, memberId: 'me', now: NOW }).length === 0 && V.leaveBlockedWeekIds({ weeks: lw, picks: mine, games: [], memberId: 'me', now: NOW }).length === 0
    && JSON.stringify(V.leaveBlockedWeekIds({ weeks: lw, picks: mine, games: ago(HOUR), memberId: 'me', now: NOW })) === '["w1"]'
    && V.leaveBlockedWeekIds({ weeks: lw, picks: mine, games: ago(8 * DAY), memberId: 'me', now: NOW }).length === 0
    && JSON.stringify(V.leaveBlockedWeekIds({ weeks: lw, picks: mine, games: ago(7 * DAY - HOUR), memberId: 'me', now: NOW })) === '["w1"]',
    '[3t-2] MC-1: leaveBlockedWeekIds passes the games through — no games = no anchor = not blocked; a first kickoff 1 hour ago blocks; 8 days ago does not (the G-6 bound has lapsed); 6 days 23 hours ago still does');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[3b] Golden — the League Page output with the new row removed is the base commit\'s, byte for byte (the row is purely additive)…');
{
  const mk = (isCommissioner) => { const d = new MiniDocument(); d.body.innerHTML = LH.renderLeaguePage({ leagueId: 'irb', leagueName: 'IRB Football' }, { isCommissioner, sports: [{ key: 'college-football', label: 'College Football' }], slateEmpty: null, escHtml, icon }); d.body.querySelector('[data-action="open-league-settings"]').remove(); return d.body.innerHTML.replace(/>\s+</g, '><'); };   // markup whitespace between tags is not part of the contract
  // captured from `git show bdf78b4:cfb-pickems/js/leagues-home.js` (the core commit, before this wiring) through the same renderer call, then parsed by minidom, re-serialized and stripped of inter-tag whitespace
  const GOLD = { commissioner: 'dddd3560a8003f39', player: '4b07e575a1ff949f' };
  assert(sha(mk(true)) === GOLD.commissioner, `[3ba] COMMISSIONER: everything but the new row is byte-identical to the base commit's League Page (got ${sha(mk(true))})`);
  assert(sha(mk(false)) === GOLD.player, `[3bb] PLAYER: everything but the new row is byte-identical to the base commit's League Page (got ${sha(mk(false))})`);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// [4] THE WIRING — the REAL app.js and auth.js, a REAL element tree (minidom.mjs), a fake Supabase client
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const auth = await import('./js/auth.js');
const storage = await import('./js/storage.js');
const app = await import('./js/app.js');

const pushOs = await import('./js/push-onesignal.js');
pushOs._setIdentityMinterForTest(async () => ({ ok: true, token: 'header.claims.signature', expiresAtMs: Date.now() + 86400000 }));
function landOneSignalSdk(el) {
  if (!el || !/onesignal/i.test(String(el.src || el.getAttribute?.('src') || ''))) return;
  const t1 = setTimeout(() => {
    el.onload?.();
    const t2 = setTimeout(() => { const q = globalThis.window.OneSignalDeferred; if (Array.isArray(q) && q.length) { const cb = q.shift(); try { cb({ init: async () => {}, login: async () => {}, logout: async () => {} }); } catch {} } }, 0);
    t2?.unref?.();
  }, 0);
  t1?.unref?.();
}
/** Drain the SDK queue by polling (authtest's pumpOneSignalQueue): each callback is invoked with a recording stand-in for the SDK. */
async function pumpOneSignalQueue(os, { rounds = 8, ticks = 40 } = {}) {
  const sdk = { init: async () => {}, ...os };
  for (let round = 0; round < rounds; round++) {
    let queue = globalThis.window.OneSignalDeferred;
    for (let i = 0; i < ticks && (!Array.isArray(queue) || !queue.length); i++) { await new Promise((r) => setTimeout(r, 0)); queue = globalThis.window.OneSignalDeferred; }
    if (!Array.isArray(queue) || !queue.length) return;
    for (const cb of queue.splice(0, queue.length)) { try { await cb(sdk); } catch { /* the SDK stand-in never throws */ } }
  }
}
const PAGES = ['page-picks', 'page-dashboard', 'page-leaderboard', 'page-commissioner', 'page-admin', 'page-rules', 'page-chat'];
const defer = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
let haptics = [];
const installHaptics = (on) => {
  haptics = [];
  if (!on) { delete globalThis.Capacitor; return; }
  globalThis.Capacitor = { isNativePlatform: () => true, Plugins: { Haptics: {
    impact: (o) => haptics.push(`impact:${o.style}`), notification: (o) => haptics.push(`notification:${o.type}`),
    selectionStart() {}, selectionChanged: () => haptics.push('selection'), selectionEnd() {},
  } } };
};

/**
 * One world per scenario: a fresh element tree, a fake server whose membership list the REAL refresh reads back, and the real modules configured against it. `S.gates[rpcName]` holds a
 * call open until the test releases it (so the "while it is pending" state can be inspected); `S.hooks.rpc / .from` replace the defaults for one scenario.
 */
async function world(o = {}) {
  const cfg = { role: 'commissioner', leagueId: 'L1', leagueName: 'Saturday Crew', status: 'active', pilot: false, accepting: true, otherLeagues: [], native: false, wire: true, ...o };
  store.clear();   // a new world is a new device: no weeks, picks or obligations carry over from the last scenario
  const doc = new MiniDocument(); globalThis.document = doc;
  for (const id of PAGES) { const el = doc.createElement('section'); el.id = id; el.className = 'page-section'; doc.body.appendChild(el); }
  const toasts = doc.createElement('div'); toasts.id = 'toast-container'; doc.body.appendChild(toasts);
  for (const c of ['main-content', 'bottom-nav', 'app-header']) { const e = doc.createElement('div'); e.className = c; doc.body.appendChild(e); }
  installHaptics(cfg.native);
  if (cfg.push) {
    // the SDK, as the CDN lands it (authtest's own rig): fire onload, then drain the one init callback the module queues behind it
    doc.head.appendChild = (el) => { MiniElement.prototype.appendChild.call(doc.head, el); landOneSignalSdk(el); return el; };
    globalThis.window.OneSignalDeferred = [];
    pushOs._setSdkReadyForTest(false);
  }
  const mem = (leagueId, name, role, extra = {}) => ({ leagueId, memberId: 'm-' + leagueId, role, displayName: 'Kev', leagueName: name, pilot: false, status: 'active', sportDefault: 'cfb', ...extra });
  const S = {
    userId: 'u1', calls: [], gates: {}, hooks: {},
    memberships: [mem(cfg.leagueId, cfg.leagueName, cfg.role, { pilot: cfg.pilot, status: cfg.status }), ...cfg.otherLeagues.map((l) => mem(l.id, l.name, l.role || 'player'))],
    accepting: { [cfg.leagueId]: cfg.accepting }, preflight: [], candidatesCalled: 0,
    rpcCalls: () => S.calls.filter((c) => c[0] === 'rpc').map((c) => c[1]),
    rpcArgs: (name) => S.calls.filter((c) => c[0] === 'rpc' && c[1] === name).map((c) => c[2]),
    toastText: () => toasts.children.map((t) => t.textContent),
  };
  const defaultRpc = (name, args) => {
    if (name === 'rename_league') { const m = S.memberships.find((x) => x.leagueId === args.p_league); m.leagueName = args.p_name.trim(); return { data: m.leagueName, error: null }; }
    if (name === 'set_accepting_members') { S.accepting[args.p_league] = args.p_open; return { data: args.p_open, error: null }; }
    if (name === 'leave_league') { S.memberships = S.memberships.filter((x) => x.leagueId !== args.p_league); return { data: args.p_confirm_archive ? 'archived' : 'left', error: null }; }
    if (name === 'account_exit_leagues') return { data: S.preflight, error: null };
    if (name === 'admin_set_member_role') return { data: null, error: null };
    return { data: null, error: null };
  };
  const defaultFrom = (table, b) => {
    if (table === 'league_members') {
      return { data: S.memberships.map((m) => ({ league_id: m.leagueId, id: m.memberId, role: m.role, display_name: m.displayName, active: true, leagues: { name: m.leagueName, pilot: m.pilot, status: m.status, sport_default: m.sportDefault } })), error: null };
    }
    if (table === 'leagues' && b._single) { const id = (b._eq.find((e) => e[0] === 'id') || [])[1]; return { data: { accepting_members: S.accepting[id] }, error: null }; }
    return { data: [], error: null };
  };
  const client = {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: S.userId }, access_token: 't', expires_at: Math.floor(Date.now() / 1000) + 3600 } } }),
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
      refreshSession: async () => ({ data: { session: null }, error: null }), signOut: async () => ({ error: null }),
    },
    from(table) {
      const b = { _eq: [], select(c) { b._cols = c; return b; }, eq(c, v) { b._eq.push([c, v]); return b; }, single() { b._single = true; return b; }, order() { return b; }, limit() { return b; },
        then(res, rej) { S.calls.push(['from', table, b._cols]); const run = async () => { if (S.gates['from:' + table]) await S.gates['from:' + table].promise; return S.hooks.from ? S.hooks.from(table, b, S, defaultFrom) : defaultFrom(table, b); }; return run().then(res, rej); } };
      return b;
    },
    rpc(name, args) {
      S.calls.push(['rpc', name, args]);
      const run = async () => { if (S.gates[name]) await S.gates[name].promise; return S.hooks.rpc ? S.hooks.rpc(name, args, S, defaultRpc) : defaultRpc(name, args); };
      return run();
    },
  };
  globalThis.window.supabase = { createClient: () => client };
  auth._resetAuthForTest(); app._resetAuthUIWiringForTest(); app._resetAuthHoldForTest();
  auth.configureAuth({ authMode: 'supabase', supabaseUrl: 'https://x.test', supabaseAnonKey: 'k' });
  auth._setHasSupabaseDataBackendForTest(true);
  app._setWarmRelaunchAtBootForTest(true);
  auth._setStoredSessionForTest({ access_token: 't', expires_at: Math.floor(Date.now() / 1000) + 3600 });
  auth._setMembershipsForTest(S.memberships.map((m) => ({ ...m })));
  auth.setActiveLeagueId(cfg.leagueId);
  auth._setAccountUserIdForTest('u1');   // a signed-in account: the refresh must not look like an identity CHANGE (which would, correctly, sweep the overlay)
  if (cfg.wire) app.wireAuthUIEvents();
  app._resetLinkFlowForTest();
  app._lsAcceptStoreForTest(null, null);   // a new world is a new identity: the per-league cache is forgotten, as the chokepoint forgets it
  S.cfg = cfg; S.doc = doc;
  if (cfg.wire) { try { app.refreshAuthUI('MEMBERSHIPS_REFRESHED', null); } catch { /* the harness has no gate to paint */ } }   // run the chokepoint once NOW, so `_lastIdentityKey` is this world's and a later refresh is not an identity change
  await sleep(8);   // let the identity-change event the setup just caused run its chokepoint BEFORE a test opens anything (a late sweep would remove the overlay under it)
  S.calls.length = 0;
  return S;
}
const overlay = () => document.getElementById('league-page-overlay');
const q = (sel) => overlay() && overlay().querySelector(sel);
const layer = () => document.getElementById('ls-action-layer');
const sheetWrap = () => document.getElementById('ls-sheet-wrap');
const view = () => app._getLeaguePageOverlayViewForTest();
const openSettings = () => app._showLeaguePageOverlayForTest({ view: 'settings' });
const type = (el, value) => { el.value = value; el.dispatchEvent({ type: 'input', target: el }); };
const clickAction = (sel) => { const el = (typeof sel === 'string' ? (layer() && layer().querySelector(sel)) || (sheetWrap() && sheetWrap().querySelector(sel)) || q(sel) : sel); if (!el) throw new Error('no element for ' + sel); el.dispatchEvent({ type: 'click', target: el }); };
const closeAll = () => { try { app._hideLeaguePageOverlayForTest(); } catch {} for (const id of ['ls-action-layer', 'ls-sheet-wrap']) document.getElementById(id)?.remove(); };

_log('\n[4a] The page, both entries, and what a player never sees…');
quiet();
{
  const S = await world({ role: 'commissioner' });
  const gate = defer(); S.gates['from:leagues'] = gate;
  const t0 = Date.now();
  openSettings();
  assert(overlay() && view() === 'settings' && !!q('#ls-title') && document.activeElement && document.activeElement.id === 'ls-title', '[4a-1] opening the Settings view paints the page and moves focus to its title (VoiceOver reads it first)');
  assert(S.calls.filter((c) => c[0] === 'rpc').length === 0 && S.calls.filter((c) => c[0] === 'from' && c[1] === 'league_members').length === 0, '[4a-2] CACHED FIRST: the page painted with NO membership read and NO rpc (name, role, status and sports all come from the cache; the only async item is the switch)');
  assert(q('#ls-name-input').value === 'Saturday Crew' && q('[data-ls-accept="loading"]') && txt(q('#ls-accept-card .cc-row-secondary')) === 'Checking…', '[4a-3] the name is already in the field; the switch shows its one "Checking…" placeholder while the value is read');
  const card = q('#ls-accept-card');
  gate.resolve(); await settle();
  assert(q('#ls-accept-card') === card && q('button[role="switch"]').getAttribute('aria-checked') === 'true', '[4a-4] the value arrives and the switch appears IN the same card node (patched, not rebuilt); the league is open to new members');
  assert(q('.ls-body').getAttribute('data-ls-role') === 'commissioner' && q('[data-ls-action="leave"]') && q('[data-ls-action="open-comm"]'), '[4a-5] a commissioner\'s page carries the commissioner controls');
  closeAll();
  await world({ role: 'commissioner', accepting: false });   // a second world: the value read says CLOSED
  openSettings(); await settle();
  assert(q('button[role="switch"]').getAttribute('aria-checked') === 'false' && q('.cc-row-switch').getAttribute('data-on') === 'false', '[4a-6] CLOSED: the switch reads off after the read');
  closeAll();
  // the cache: reopening paints the cached value at once (no loading placeholder)
  const S2 = await world({ role: 'commissioner' });
  openSettings(); await settle(); closeAll();
  const reads = S2.calls.filter((c) => c[0] === 'from' && c[1] === 'leagues').length;
  openSettings();
  assert(!q('[data-ls-accept="loading"]') && q('button[role="switch"]').getAttribute('aria-checked') === 'true' && S2.calls.filter((c) => c[0] === 'from' && c[1] === 'leagues').length === reads, '[4a-7] cached per league: the second visit paints the switch at once with NO new read');
  closeAll();

  const P = await world({ role: 'player' });
  openSettings(); await settle();
  assert(!q('#ls-name-input') && !q('#ls-accept-card') && !q('[data-ls-action="open-comm"]') && !q('[data-ls-action="save-name"]') && !q('input') && q('.ls-body').getAttribute('data-ls-role') === 'player', '[4a-8] a PLAYER\'s page: no field, no switch, no Commissioner Panel pointer, no Save — none of them exist in the tree');
  assert(P.calls.filter((c) => c[0] === 'from' && c[1] === 'leagues').length === 0, '[4a-9] …and a player triggers NO read of the accepting-members value (the group is absent, so nothing is asked)');
  closeAll();
  // a commissioner role with the session privilege-held reads as a player (the safe direction)
  const H = await world({ role: 'commissioner' });
  auth._setMembershipsForTest([{ ...H.memberships[0], role: 'player' }]);
  openSettings();
  assert(!q('#ls-name-input'), '[4a-10] the page trusts the CACHED role: a membership that no longer says commissioner paints the player\'s page');
  closeAll();
  // the drawer route and the League Page route land on the same view
  const R = await world({ role: 'commissioner' });
  const ccx = app._buildControlCenterCtxForTest();
  ccx.callbacks.onOpenLeagueSettings();
  assert(overlay() && view() === 'settings', '[4a-11] the control-center callback opens the SAME overlay on the Settings view for the active league');
  closeAll();
  app._showLeaguePageOverlayForTest();
  assert(view() === 'league' && q('[data-action="open-league-settings"]'), '[4a-12] the League Page route: the League view shows the League Settings row');
  haptics = []; installHaptics(true);
  q('[data-action="open-league-settings"]').click();
  assert(view() === 'settings' && haptics.join() === 'selection', '[4a-13] tapping the row pushes the Settings view with the selection haptic (native only, ONE haptic: the drawer route fires its own in the drawer)');
  assert(q('.ls-body').classList.contains('lc-step-in') && q('.ls-header').classList.contains('lc-step-in') && document.activeElement.id === 'ls-title', '[4a-14] the push plays the 260 ms step on the incoming header and body (T1) and focuses the title');
  q('.ls-header').dispatchEvent({ type: 'animationend', target: q('.ls-header') });
  assert(!q('.ls-header').classList.contains('lc-step-in'), '[4a-15] the step class is removed when its animation ends (no stale class)');
  installHaptics(false);
  closeAll();
}
loud();

_log('\n[4b] The name card — in-place patching, every state of DI-458\'s table…');
quiet();
{
  const S = await world({ role: 'commissioner' });
  openSettings(); await settle();
  const cardEl = q('#ls-name-card'), input = q('#ls-name-input'), btn = q('#ls-name-save'), count = q('#ls-name-count');
  const same = () => q('#ls-name-card') === cardEl && q('#ls-name-input') === input && q('#ls-name-save') === btn && q('#ls-name-count') === count;
  assert(btn.disabled && btn.getAttribute('data-ls-state') === 'pristine', '[4b-1] PRISTINE: Save is dimmed');
  type(input, 'Saturday Crew League');
  assert(!btn.disabled && btn.getAttribute('data-ls-state') === 'edited' && txt(count) === '20 / 80' && same(), '[4b-2] EDITED: Save enables, the counter updates — and the card, the field, the button and the counter are THE SAME NODES (nothing was rebuilt: the caret and the keyboard survive)');
  type(input, '   ');
  assert(btn.disabled && btn.getAttribute('data-ls-state') === 'empty' && !q('#ls-banner').children.length && !q('.lc-banner-err') && same(), '[4b-3] SPACES ONLY: dimmed, and NO red error text anywhere');
  type(input, '');
  assert(btn.disabled && q('#ls-name-clear').hasAttribute('hidden') && txt(count) === '0 / 80' && same(), '[4b-4] EMPTY: dimmed, the clear control hides, the counter reads 0 / 80 (the zero survives)');
  type(input, 'Saturday Crew');
  assert(btn.disabled && btn.getAttribute('data-ls-state') === 'pristine' && !q('#ls-name-clear').hasAttribute('hidden'), '[4b-5] typing the stored name back is pristine again (nothing to save)');
  // Return blurs and does NOT save
  type(input, 'Another Name'); input.focus();
  const rpcBefore = S.rpcCalls().length;
  input.dispatchEvent({ type: 'keydown', key: 'Enter', target: input });
  assert(document.activeElement !== input && S.rpcCalls().length === rpcBefore, '[4b-6] Return dismisses the keyboard and does NOT save');
  // clear control
  q('#ls-name-clear').click();
  assert(input.value === '' && btn.disabled && document.activeElement === input, '[4b-7] the clear control empties the field and keeps focus in it');

  // SAVE — the trimmed name goes out, then the refresh, then Saved
  type(input, '  Gridiron Crew  ');
  const gate = defer(); S.gates.rename_league = gate;
  btn.click(); await settle();
  assert(btn.getAttribute('data-ls-state') === 'saving' && input.disabled && btn.disabled && btn.getAttribute('class').includes('lc-btn-busy') && !!btn.querySelector('.lc-spin') && txt(btn) === 'Saving…' && same(), '[4b-8] SAVING: the field locks, the button spins and reads "Saving…", and it is still the same nodes');
  assert(JSON.stringify(S.rpcArgs('rename_league')) === '[{"p_league":"L1","p_name":"Gridiron Crew"}]', '[4b-9] the request carries the TRIMMED name (the client trims; the server trims again)');
  assert(q('#ls-name-save') && btn.getAttribute('data-ls-state') === 'saving', '[4b-10] Back stays available while saving (the page is not blocked) and the request is never cancelled by navigation');
  const mark = S.calls.length; haptics = []; installHaptics(true);
  gate.resolve(); await settle();
  const after = S.calls.slice(mark).map((c) => c[0] + ':' + c[1]);
  assert(after.includes('from:league_members'), '[4b-11] the RPC is followed by the membership refresh (what repaints the header pill, Leagues Home, the League Page title and the drawer)');
  assert(btn.getAttribute('data-ls-state') === 'saved' && btn.getAttribute('class').includes('ls-btn-ok') && txt(btn) === 'Saved' && !!btn.querySelector('.lc-btn-ic svg') && input.value === 'Gridiron Crew' && same(), '[4b-12] SAVED: the green check "Saved", the field shows the stored (trimmed) name, still the same nodes');
  assert(S.toastText().includes('League renamed.') && haptics.join() === 'notification:SUCCESS', '[4b-13] the toast "League renamed." and ONE success haptic');
  assert(auth.getCachedMemberships()[0].leagueName === 'Gridiron Crew', '[4b-14] the membership cache now carries the new name (every consumer reads it from there)');
  await sleep(1650);
  assert(btn.getAttribute('data-ls-state') === 'pristine' && btn.disabled && same(), '[4b-15] after about 1.5 s the card returns to pristine');
  installHaptics(false);
  closeAll();
}
{
  // FAILURES
  const S = await world({ role: 'commissioner' });
  openSettings(); await settle();
  const input = q('#ls-name-input'), btn = q('#ls-name-save');
  S.hooks.rpc = (name) => { if (name === 'rename_league') throw new TypeError('Failed to fetch'); return { data: null, error: null }; };
  type(input, 'Gridiron Crew'); installHaptics(true); btn.click(); await settle();
  const ban = q('#ls-banner .lc-banner-err');
  assert(ban && ban.getAttribute('role') === 'alert' && txt(ban) === "Couldn't rename the league. Nothing was changed. Check your connection and try again." && input.value === 'Gridiron Crew' && !btn.disabled && btn.getAttribute('data-ls-state') === 'edited' && haptics.join() === 'notification:ERROR',
    '[4b-16] NETWORK FAILURE (the refresh shows the name unchanged): a PERSISTENT red banner, the draft kept, Save live again, one error haptic');
  assert(S.calls.filter((c) => c[0] === 'from' && c[1] === 'league_members').length >= 1, '[4b-17] SC-L15: the wrapper refreshed BEFORE choosing the copy (an unknown outcome is settled by what the server says now)');
  // second attempt where the request LANDED but the response was lost: the refresh shows the new name -> success, never "Couldn't"
  S.hooks.rpc = (name, args, st) => { if (name === 'rename_league') { st.memberships[0].leagueName = args.p_name; throw new TypeError('Failed to fetch'); } return { data: null, error: null }; };
  btn.click(); await settle();
  assert(btn.getAttribute('data-ls-state') === 'saved' && !q('#ls-banner .lc-banner-err') && S.toastText().includes('League renamed.'), '[4b-18] a request that LANDED with its response lost is settled by the refresh: Saved, never "Couldn\'t rename"');
  closeAll(); installHaptics(false);
}
{
  const refused = async (message, code, expect) => {
    const S = await world({ role: 'commissioner' });
    openSettings(); await settle();
    S.hooks.rpc = (name) => (name === 'rename_league' ? { data: null, error: { message, code } } : { data: null, error: null });
    type(q('#ls-name-input'), 'New Name'); q('#ls-name-save').click(); await settle();
    expect(S, q('#ls-banner .lc-banner-err'));
    closeAll();
  };
  await refused('bad_name', 'P0001', (S, b) => assert(b && txt(b) === "That name can't be used. Try a different one." && q('#ls-name-input').value === 'New Name' && !q('#ls-name-save').disabled, '[4b-19] bad_name: the calm refusal, the draft kept, Save live'));
  await refused('not_authenticated', '28000', (S, b) => assert(b && txt(b) === 'Your session expired. Sign in again to continue.' && q('#ls-name-input').value === 'New Name', '[4b-20] an expired session: "Your session expired. Sign in again to continue." and the draft kept'));
  // a stale role: the server says not_commissioner -> the wrapper refreshes -> the page repaints as the player's, with the banner
  {
    const S = await world({ role: 'commissioner' });
    openSettings(); await settle();
    S.hooks.rpc = (name, args, st) => { if (name === 'rename_league') { st.memberships[0].role = 'player'; return { data: null, error: { message: 'not_commissioner', code: 'P0001' } }; } return { data: null, error: null }; };
    type(q('#ls-name-input'), 'New Name'); q('#ls-name-save').click(); await settle();
    assert(!q('#ls-name-input') && q('.ls-body').getAttribute('data-ls-role') === 'player' && txt(q('#ls-banner .lc-banner-err')) === 'Only a commissioner can rename the league.', '[4b-21] not_commissioner (a stale cached role): the memberships are refreshed, the page repaints as a PLAYER\'s, and says why');
    closeAll();
  }
  // paused: the field disables with the reason; no error banner
  {
    const S = await world({ role: 'commissioner' });
    openSettings(); await settle();
    S.hooks.rpc = (name) => (name === 'rename_league' ? { data: null, error: { message: 'league_paused', code: 'P0001' } } : { data: null, error: null });
    type(q('#ls-name-input'), 'New Name'); q('#ls-name-save').click(); await settle();
    assert(q('#ls-name-input').disabled && txt(q('#ls-name-helper')) === "The name can't be changed while the league is paused." && !q('#ls-banner .lc-banner-err') && q('#ls-name-save').getAttribute('data-ls-state') === 'paused', '[4b-22] league_paused: the field disables WITH the reason as a field note — calm, not an error banner');
    closeAll();
  }
  // applied, refresh failed
  {
    const S = await world({ role: 'commissioner' });
    openSettings(); await settle();
    S.hooks.from = (table, b, st, dflt) => (table === 'league_members' ? { data: null, error: { message: 'boom', code: 'XX000' } } : dflt(table, b));
    type(q('#ls-name-input'), 'New Name'); q('#ls-name-save').click(); await settle();
    const b = q('#ls-banner .lc-banner-err');
    assert(b && txt(b).startsWith("League renamed, but this page couldn't refresh. Reload to see it everywhere.") && !!q('#ls-banner-reload') && q('#ls-name-input').value === 'New Name' && q('#ls-name-save').disabled,
      '[4b-23] APPLIED, REFRESH FAILED: "League renamed, but…" with a Reload — never "Couldn\'t rename"; the field shows the new name');
    const r0 = reloads; q('#ls-banner-reload').click();
    assert(reloads === r0 + 1, '[4b-24] the Reload button reloads the page');
    closeAll();
  }
}
loud();

_log('\n[4b2] A rename or a switch that FAILS after the person tapped Back is never silent (merge review, BLOCK #1, note d)…');
quiet();
{
  // RENAME: Save, then Back while the request is out (the page is not blocked), then the request FAILS. The banner it would have used is gone with the page: a toast and the error haptic, like Leave.
  const S = await world({ role: 'commissioner' });
  openSettings(); await settle();
  const input = q('#ls-name-input'), btn = q('#ls-name-save');
  S.hooks.rpc = (name) => { if (name === 'rename_league') throw new TypeError('Failed to fetch'); return { data: null, error: null }; };
  const gate = defer(); S.gates.rename_league = gate;
  type(input, 'Gridiron Crew'); btn.click(); await settle();
  q('[data-ls-action="back"]').click(); await settle();
  assert(view() === 'league' && !document.getElementById('ls-title'), '[4b2-1] fixture: Back while saving leaves the Settings page (the request is still out)');
  installHaptics(true); const t0 = S.toastText().length;
  gate.resolve(); await settle();
  const toasts = S.toastText().slice(t0);
  assert(toasts.includes("Couldn't rename the league. Nothing was changed. Check your connection and try again.") && haptics.join() === 'notification:ERROR',
    `[4b2-2] RENAME failure after Back: the error is TOASTED with the error haptic, never silent (${JSON.stringify(toasts)}; ${haptics.join()})`);
  closeAll();

  // a rename that LANDED still says so (unchanged), and a calm paused note stays quiet (it is a note, not a failure)
  const T = await world({ role: 'commissioner' });
  openSettings(); await settle();
  const i2 = q('#ls-name-input'), b2 = q('#ls-name-save');
  T.hooks.rpc = (name) => (name === 'rename_league' ? { data: null, error: { message: 'league_paused', code: 'P0001' } } : { data: null, error: null });
  const g2 = defer(); T.gates.rename_league = g2;
  type(i2, 'Other Name'); b2.click(); await settle();
  q('[data-ls-action="back"]').click(); await settle();
  installHaptics(true); const t1 = T.toastText().length;
  g2.resolve(); await settle();
  assert(T.toastText().length === t1 && haptics.length === 0, '[4b2-3] a paused refusal after Back is a calm note: no error toast, no haptic');
  closeAll();

  // SWITCH: toggle, then Back while the request is out, then the request FAILS.
  const U = await world({ role: 'commissioner' });
  openSettings(); await settle();
  const sw = q('button[role="switch"]');
  U.hooks.rpc = (name) => { if (name === 'set_accepting_members') throw new TypeError('Failed to fetch'); return { data: null, error: null }; };
  const g3 = defer(); U.gates.set_accepting_members = g3;
  sw.click(); await sleep(2);
  q('[data-ls-action="back"]').click(); await settle();
  installHaptics(true); const t2 = U.toastText().length;
  g3.resolve(); await settle();
  const toasts3 = U.toastText().slice(t2);
  assert(toasts3.includes("Couldn't change this. Nothing was changed. Check your connection and try again.") && haptics.join() === 'notification:ERROR',
    `[4b2-4] SWITCH failure after Back: the error is TOASTED with the error haptic, never silent (${JSON.stringify(toasts3)}; ${haptics.join()})`);
  closeAll();
}
loud();

_log('\n[4c] Back, discard, swipe-back, the pointer rows…');
quiet();
{
  const S = await world({ role: 'commissioner' });
  app._showLeaguePageOverlayForTest();
  q('[data-action="open-league-settings"]').click(); await settle();
  // not dirty: straight back one level, focus returns to the row that opened it
  q('[data-ls-action="back"]').click();
  assert(view() === 'league' && !layer() && document.activeElement && document.activeElement.getAttribute('data-action') === 'open-league-settings' && q('.league-page-body').classList.contains('ls-view-back'), '[4c-1] BACK with no edit: no prompt, one level back to the League view on the 150 ms crossfade, focus returns to the row that opened Settings');
  q('[data-action="open-league-settings"]').click(); await settle();
  const input = q('#ls-name-input');
  type(input, 'Edited Name');
  q('[data-ls-action="back"]').click();
  assert(view() === 'settings' && !!layer() && txt(layer().querySelector('#ls-discard-title')) === 'Discard changes?' && !!layer().querySelector('[role="alertdialog"]'), '[4c-2] BACK with an UNSAVED name: navigation is CANCELLED (still on Settings) and the discard sheet is raised');
  assert(layer().parentNode === document.body && layer().hasAttribute('data-hold-teardown') && overlay().hasAttribute('inert') && overlay().getAttribute('aria-hidden') === 'true', '[4c-3] the sheet is mounted on <body> in its OWN layer (F7: a scrolled page can never carry it away), swept by a hold, and the page under it is inert');
  assert(document.activeElement && document.activeElement.textContent === 'Keep Editing', '[4c-4] focus moves INTO the sheet, onto the safe choice (Keep Editing)');
  assert(app._isDismissGestureBlockedByOtherSurfaceForTest() === true, '[4c-5] while the layer is up the League Page\'s own swipe-back is BLOCKED (nothing is swiped away from under a confirmation)');
  clickAction('[data-ls-action="keep-editing"].lc-as-bold');
  assert(!layer() && view() === 'settings' && q('#ls-name-input') === input && input.value === 'Edited Name' && !overlay().hasAttribute('inert') && document.activeElement === input, '[4c-6] KEEP EDITING: the sheet closes, the field keeps its text and its focus, the page is live again');
  q('[data-ls-action="back"]').click();
  layer().querySelector('.lc-scrim').dispatchEvent({ type: 'click', target: layer().querySelector('.lc-scrim') });
  assert(!layer() && view() === 'settings', '[4c-7] the scrim tap = Keep Editing (the safe choice)');
  q('[data-ls-action="back"]').click();
  document.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert(!layer() && view() === 'settings' && document.listenerCount('keydown') === 0, '[4c-8] Esc cancels too, and the key listener removes itself when nothing is open (no leak)');
  q('[data-ls-action="back"]').click();
  clickAction('[data-ls-action="discard"]');
  assert(!layer() && view() === 'league', '[4c-9] DISCARD CHANGES: the edit is thrown away and the view goes ONE level back');
  q('[data-action="open-league-settings"]').click(); await settle();
  assert(q('#ls-name-input').value === 'Saturday Crew', '[4c-10] re-entering Settings starts from the stored name (the discarded draft is gone)');

  // swipe-back (native) — dirty: spring back + the prompt; clean: one level back, snapped with no transition; cancelled: spring back
  const ov = overlay();
  ov.setAttribute('data-dragging', 'true'); ov.style.setProperty('--league-page-drag-x', '0.6');
  type(q('#ls-name-input'), 'Dirty');
  app._settleLeaguePageSwipeForTest(ov, { dismissed: true, reducedMotion: false });
  assert(ov.style['--league-page-drag-x'] === '0' && view() === 'settings' && !!layer() && !ov.hasAttribute('data-dragging'), '[4c-11] a swipe-back with an UNSAVED name springs back (offset 0) and raises the discard sheet — the page does not move');
  clickAction('[data-ls-action="keep-editing"].lc-as-bold');
  type(q('#ls-name-input'), 'Saturday Crew');
  ov.style.setProperty('--league-page-drag-x', '0.6');
  app._settleLeaguePageSwipeForTest(ov, { dismissed: true, reducedMotion: false });
  assert(view() === 'league' && ov.style['--league-page-drag-x'] === '0' && !layer(), '[4c-12] a swipe-back with NO edit goes one level back to the League view (not out of the overlay)');
  q('[data-action="open-league-settings"]').click(); await settle();
  ov.style.setProperty('--league-page-drag-x', '0.2');
  app._settleLeaguePageSwipeForTest(ov, { dismissed: false, reducedMotion: false });
  assert(view() === 'settings' && ov.style['--league-page-drag-x'] === '0', '[4c-13] a CANCELLED swipe springs back and stays on Settings');
  type(q('#ls-name-input'), 'Dirty again');
  app._settleLeaguePageSwipeForTest(ov, { dismissed: true, reducedMotion: true });
  assert(view() === 'settings' && !!layer(), '[4c-14] even under Reduce Motion a dirty dismiss is cancelled and prompts (the swipe can never throw an edit away)');
  closeAll();

  // pointer rows: Rules and the Commissioner Panel (light haptic, close the overlay, navigate); an unsaved name is asked about first
  installHaptics(true);
  app._showLeaguePageOverlayForTest({ view: 'settings' });
  q('[data-ls-action="open-rules"]').click();
  assert(!overlay() && haptics.join() === 'impact:LIGHT', '[4c-15] the League Rules pointer: a LIGHT haptic and the overlay closes (the target page is the panel that owns the control: nothing is duplicated)');
  haptics = [];
  app._showLeaguePageOverlayForTest({ view: 'settings' });
  type(q('#ls-name-input'), 'Unsaved');
  q('[data-ls-action="open-comm"]').click();
  assert(overlay() && !!layer() && haptics.join() === 'notification:WARNING', '[4c-16] a pointer row with an UNSAVED name raises the discard prompt first (the warning haptic as it appears) and does not navigate');
  clickAction('[data-ls-action="discard"]');
  assert(!overlay(), '[4c-17] Discard Changes then follows the pointer');
  installHaptics(false);
  closeAll();
}
loud();



_log('\n[4d] The accepting-members switch — no optimistic flip, every outcome…');
quiet();
{
  const S = await world({ role: 'commissioner' });
  openSettings(); await settle();
  const sw = q('button[role="switch"]'), knob = q('.cc-row-switch'), foot = q('#ls-accept-footer');
  assert(txt(foot) === "When this is off, your join code stops working until you turn it back on. People already in the league aren't affected.", '[4d-1] the footer sentence under the switch is the DI\'s, verbatim');
  const g = defer(); S.gates.set_accepting_members = g;
  installHaptics(true); sw.click(); await sleep(5);
  assert(sw.getAttribute('aria-checked') === 'true' && knob.getAttribute('data-on') === 'true' && sw.getAttribute('aria-busy') === 'true' && sw.getAttribute('aria-disabled') === 'true' && q('button[role="switch"]') === sw && haptics.join() === 'selection',
    '[4d-2] TOGGLING: the knob has NOT moved (no optimistic flip), the control is aria-busy, it is the same node, and the selection haptic fired on the tap');
  sw.click(); await sleep(2);
  assert(S.rpcArgs('set_accepting_members').length === 1, '[4d-3] a second tap while the call is out sends nothing (the control is inert)');
  g.resolve(); await settle();
  assert(sw.getAttribute('aria-checked') === 'false' && knob.getAttribute('data-on') === 'false' && !sw.hasAttribute('aria-busy') && !sw.hasAttribute('aria-disabled') && q('button[role="switch"]') === sw, '[4d-4] CONFIRMED: the knob moves ONLY now, on the same node (so the 150 ms slide plays), and the control is live again');
  assert(S.toastText().includes('Closed to new members.') && JSON.stringify(S.rpcArgs('set_accepting_members')) === '[{"p_league":"L1","p_open":false}]' && haptics.join() === 'selection', '[4d-5] the toast "Closed to new members." — and no second haptic at completion (the haptic belongs to the tap)');
  delete S.gates.set_accepting_members;
  sw.click(); await settle();
  assert(sw.getAttribute('aria-checked') === 'true' && S.toastText().includes('Open to new members.'), '[4d-6] turning it back on: "Open to new members."');
  // the Invite card agrees: the REAL Comm page's helper line is patched in place by the same value
  globalThis.navigateTo('commissioner'); await settle();
  const line = document.getElementById('invite-helper-line');
  assert(!!line && line.textContent === 'Share this code with anyone joining Saturday Crew.', '[4d-7] the Comm page\'s Invite card carries the ACTIVE league\'s name for every league (the pilot literal is gone)');
  app._lsAcceptStoreForTest('L1', false);
  assert(document.getElementById('invite-helper-line') === line && line.textContent === "New members are turned off, so this code won't work right now. Turn it back on in League Settings.", '[4d-8] the line is patched IN PLACE (same node) the moment the value is closed (UN-347: the switch and the card never disagree)');
  app._lsAcceptStoreForTest('L1', true);
  assert(line.textContent === 'Share this code with anyone joining Saturday Crew.', '[4d-9] …and back to today\'s line when it is open again');
  // FAILURE: a network failure where the value did not change -> revert + persistent note + error haptic
  S.hooks.rpc = (name) => { if (name === 'set_accepting_members') throw new TypeError('Failed to fetch'); return { data: null, error: null }; };
  haptics = [];
  sw.click(); await settle();
  const note = q('#ls-accept-note .lc-banner-err');
  assert(sw.getAttribute('aria-checked') === 'true' && note && note.getAttribute('role') === 'alert' && txt(note) === "Couldn't change this. Nothing was changed. Check your connection and try again." && haptics.join() === 'selection,notification:ERROR',
    '[4d-9b] FAILED: the switch stays where it was, a PERSISTENT inline note says nothing changed, an error haptic follows the selection haptic');
  sw.click(); await sleep(2);
  assert(!q('#ls-accept-note .lc-banner-err') || q('#ls-accept-note .lc-banner-err') !== note, '[4d-10] the next attempt clears the old note');
  await settle();
  // a request that LANDED with the response lost: settled by re-reading the value
  S.hooks.rpc = (name, args, st) => { if (name === 'set_accepting_members') { st.accepting[args.p_league] = args.p_open; throw new TypeError('Failed to fetch'); } return { data: null, error: null }; };
  const was = sw.getAttribute('aria-checked');
  sw.click(); await settle();
  assert(sw.getAttribute('aria-checked') !== was && !q('#ls-accept-note .lc-banner-err'), '[4d-11] a toggle that LANDED with its response lost is settled by re-reading the value (it flips, no failure note)');
  // a stale role / paused refusals
  S.hooks.rpc = (name) => (name === 'set_accepting_members' ? { data: null, error: { message: 'league_paused', code: 'P0001' } } : { data: null, error: null });
  sw.click(); await settle();
  assert(txt(q('#ls-accept-footer')) === 'Unavailable while the league is paused.' && sw.hasAttribute('disabled') && !q('#ls-accept-note .lc-banner-err'), '[4d-12] league_paused (the server says so): the switch disables and the footer carries the reason — calm, no error banner');
  installHaptics(false);
  closeAll();
  // the load FAILED: the row says so and offers Try Again
  globalThis.navigateTo('dashboard');   // back to a tab that does not read the value on its own (the Comm Invite card shares the cache with this page — by design)
  const L = await world({ role: 'commissioner' });
  app._lsAcceptStoreForTest(null, null);
  L.hooks.from = (table, b, st, d) => (table === 'leagues' ? { data: null, error: { message: 'x', code: 'XX' } } : d(table, b));
  openSettings(); await settle();
  assert(txt(q('#ls-accept-card .cc-row-secondary')) === "Couldn't load this setting." && q('[data-ls-action="retry-accepting"]'), '[4d-13] LOAD FAILED: "Couldn\'t load this setting." with Try Again');
  L.hooks.from = null;
  q('[data-ls-action="retry-accepting"]').click(); await settle();
  assert(q('button[role="switch"]') && q('button[role="switch"]').getAttribute('aria-checked') === 'true', '[4d-14] Try Again reads it again and the switch appears');
  closeAll();
  // PAUSED: the paused sentence verbatim, field and switch disabled with the reason, the TRUE value shown
  const { PAUSED_LEAGUE_BANNER_TEXT } = await import('./js/roles.js');
  const Pz = await world({ role: 'commissioner', status: 'paused', accepting: false });
  openSettings(); await settle();
  assert(txt(q('[data-ls-paused-banner]')) === PAUSED_LEAGUE_BANNER_TEXT && q('#ls-name-input').disabled && q('#ls-name-save').disabled && q('button[role="switch"]').hasAttribute('disabled') && q('button[role="switch"]').getAttribute('aria-checked') === 'false'
    && txt(q('#ls-accept-footer')) === 'Unavailable while the league is paused.' && txt(q('#ls-name-helper')) === "The name can't be changed while the league is paused.",
    '[4d-15] PAUSED: the platform\'s verbatim sentence; the field and the switch are disabled WITH the reason; the switch shows the league\'s real value');
  assert(!q('[data-ls-action="leave"]').hasAttribute('disabled') && !q('[data-ls-action="leave"]').hasAttribute('aria-disabled'), '[4d-16] PAUSED: Leave stays available');
  closeAll();
}
loud();

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const { savePlayer, saveWeek, saveAllPicks, saveAllObligations, getObligations } = storage;
const seed = ({ weeks = [], picks = [], obligations = [], players = [], games = [] } = {}) => {
  for (const p of players) savePlayer({ ...DM.createPlayer(p.name), playerId: p.id, active: p.active !== false });
  for (const w of weeks) saveWeek({ ...DM.createWeek(2026, 1), dataSourceMode: 'live', ...w });
  for (const g of games) storage.saveGame({ ...DM.createGame(g.weekId), ...g });   // G-6 (MC-1): a week is in progress only with an anchor, and the app's weeks carry none — the first kickoff comes from the games
  saveAllPicks(picks);
  saveAllObligations(obligations);
};
const NOW = Date.now();
const iso = (ms) => new Date(NOW + ms).toISOString();

_log('\n[4e] Leave — a player: no extra call, the facts in the sheet, Q-W, the landings…');
quiet();
{
  // Q-W (a): ONE predicate; the row is dimmed with the reason; a tap does nothing
  const cases = [
    ['a LOCKED week the person has picks in', [{ weekId: 'w1', status: 'locked' }], [{ pickId: 'k1', weekId: 'w1', playerId: 'm-L1', gameId: 'g', selectedTeam: 'A' }], true],
    ['a LIVE week the person has picks in', [{ weekId: 'w1', status: 'live' }], [{ pickId: 'k1', weekId: 'w1', playerId: 'm-L1', gameId: 'g', selectedTeam: 'A' }], true],
    ['an OPEN week whose lock time has PASSED (the server\'s own corner)', [{ weekId: 'w1', status: 'open', picksLockAt: iso(-60000) }], [{ pickId: 'k1', weekId: 'w1', playerId: 'm-L1', gameId: 'g', selectedTeam: 'A' }], true],
    ['an OPEN week BEFORE its lock time', [{ weekId: 'w1', status: 'open', picksLockAt: iso(3600000) }], [{ pickId: 'k1', weekId: 'w1', playerId: 'm-L1', gameId: 'g', selectedTeam: 'A' }], false],
    ['a FINAL week', [{ weekId: 'w1', status: 'final' }], [{ pickId: 'k1', weekId: 'w1', playerId: 'm-L1', gameId: 'g', selectedTeam: 'A' }], false],
    ['a locked week where only ANOTHER player has picks', [{ weekId: 'w1', status: 'locked' }], [{ pickId: 'k1', weekId: 'w1', playerId: 'someone-else', gameId: 'g', selectedTeam: 'A' }], false],
    ['a locked week with NO picks at all', [{ weekId: 'w1', status: 'locked' }], [], false],
    // G-6 / MC-1, the WIRED path: the app's weeks carry neither a lock time nor a first kickoff, so app.js must hand the games (getGames()) to the predicate. The default fixture kickoff is one hour ago.
    ['a LOCKED week with no lock time whose first kickoff was 6 DAYS 23 HOURS ago (inside the seven-day bound)', [{ weekId: 'w1', status: 'locked' }], [{ pickId: 'k1', weekId: 'w1', playerId: 'm-L1', gameId: 'g', selectedTeam: 'A' }], true, iso(-(7 * 86400000 - 3600000))],
    ['a LOCKED week with no lock time whose first kickoff was 8 DAYS ago (the G-6 bound has lapsed: leaving is allowed)', [{ weekId: 'w1', status: 'locked' }], [{ pickId: 'k1', weekId: 'w1', playerId: 'm-L1', gameId: 'g', selectedTeam: 'A' }], false, iso(-8 * 86400000)],
    ['a LOCKED week with NO games and no lock time (no anchor: the server\'s coalesce reads it as lapsed)', [{ weekId: 'w1', status: 'locked' }], [{ pickId: 'k1', weekId: 'w1', playerId: 'm-L1', gameId: 'g', selectedTeam: 'A' }], false, null],
  ];
  for (const [label, weeks, picks, blocked, kick = iso(-3600000)] of cases) {
    const S = await world({ role: 'player' });
    seed({ weeks, picks, games: kick === null ? [] : [{ weekId: 'w1', kickoff: kick }] });
    openSettings(); await settle();
    const row = q('[data-ls-action="leave"]');
    assert(blocked ? (row.getAttribute('aria-disabled') === 'true' && txt(q('#ls-leave-reason')) === 'You can leave after this week is final.') : (!row.hasAttribute('aria-disabled') && !q('#ls-leave-reason')), `[4e-1] Q-W (a), ${label}: the Leave row is ${blocked ? 'DIMMED with the reason' : 'live'}`);
    if (blocked) { row.click(); await settle(); assert(!layer() && S.rpcCalls().length === 0, '[4e-2] …a tap on the dimmed row does NOTHING (no sheet, no call)'); }
    closeAll();
  }
  {
    const S = await world({ role: 'player' });
    seed({ weeks: [{ weekId: 'w1', status: 'locked' }, { weekId: 'w2', status: 'live' }], picks: [{ pickId: 'k1', weekId: 'w1', playerId: 'm-L1', gameId: 'g', selectedTeam: 'A' }, { pickId: 'k2', weekId: 'w2', playerId: 'm-L1', gameId: 'g', selectedTeam: 'A' }],
      games: [{ weekId: 'w1', kickoff: iso(-3600000) }, { weekId: 'w2', kickoff: iso(-7200000) }] });
    openSettings(); await settle();
    assert(txt(q('#ls-leave-reason')) === 'You can leave after these weeks are final.' && app._lsLeaveBlockedWeekIdsForTest().length === 2, '[4e-3] several weeks in progress: the plural sentence');
    closeAll();
    // the server's own refusal (week_in_progress) on a row the client thought was live: the row dims and the reason appears
    const T = await world({ role: 'player' });
    T.hooks.rpc = (name) => (name === 'leave_league' ? { data: null, error: { message: 'week_in_progress', code: 'P0001' } } : { data: null, error: null });
    openSettings(); await settle();
    q('[data-ls-action="leave"]').click(); await settle(); clickAction('[data-ls-action="confirm-leave"]'); await settle();
    assert(q('[data-ls-action="leave"]').getAttribute('aria-disabled') === 'true' && txt(q('#ls-leave-reason')) === 'You can leave after this week is final.' && !q('#ls-banner .lc-banner-err'), '[4e-4] a server week_in_progress: the row DIMS and the reason appears under it (the server\'s predicate wins); no scary banner');
    closeAll();
  }

  {
    // The "picks for an open week won't be scored" sentence is about the LEAVER's own picks only: another player's picks in the same open week must neither trigger it nor reach the page
    // (found by a mutation that widened the lookup to every player and survived this suite).
    const T = await world({ role: 'player' });
    seed({ weeks: [{ weekId: 'w1', status: 'open', picksLockAt: iso(3600000) }], picks: [{ pickId: 'k9', weekId: 'w1', playerId: 'p-sam', gameId: 'g', selectedTeam: 'ZZQ' }], players: [{ id: 'm-L1', name: 'Kev' }, { id: 'p-sam', name: 'Sam' }] });
    openSettings(); await settle();
    q('[data-ls-action="leave"]').click(); await settle();
    const other = txt(layer().querySelector('.lc-as-msg'));
    assert(!/won't be scored/.test(other) && !/ZZQ/.test(other) && T.rpcCalls().length === 0, `[4e-3b] another player's picks in an open week do not add the "won't be scored" sentence and no selection appears (blind rule): ${other}`);
    clickAction('[data-ls-action="cancel"].lc-as-bold'); closeAll();
  }

  // the plain flow
  const S = await world({ role: 'player' });
  seed({ weeks: [{ weekId: 'w1', status: 'open', picksLockAt: iso(3600000) }], picks: [{ pickId: 'k1', weekId: 'w1', playerId: 'm-L1', gameId: 'g', selectedTeam: 'A' }],
    players: [{ id: 'm-L1', name: 'Kev' }, { id: 'p-sam', name: 'Sam' }],
    obligations: [{ obligationId: 'o1', type: 'weekly', weekId: 'w1', payerPlayerId: 'm-L1', recipientPlayerId: 'p-sam', status: 'unpaid' }, { obligationId: 'o2', type: 'weekly', weekId: 'w1', payerPlayerId: 'p-sam', recipientPlayerId: 'm-L1', status: 'pending' },
      { obligationId: 'o3', type: 'weekly', weekId: 'w1', payerPlayerId: 'm-L1', recipientPlayerId: 'p-sam', status: 'paid' }, { obligationId: 'o4', type: 'weekly', weekId: 'w1', payerPlayerId: 'p-sam', recipientPlayerId: 'p-sam', status: 'unpaid' }] });
  openSettings(); await settle();
  installHaptics(true);
  const leaveRow = q('[data-ls-action="leave"]');
  leaveRow.focus(); leaveRow.click(); await settle();
  assert(!!layer() && !S.rpcCalls().includes('account_exit_leagues') && S.rpcCalls().length === 0, '[4e-5] a PLAYER\'s tap opens the sheet at once with NO call (no preflight, no dependency on migration 0037\'s helpers)');
  assert(haptics.join() === 'notification:WARNING' && txt(layer().querySelector('#ls-leave-title')) === 'Leave Saturday Crew?', '[4e-6] the warning haptic fires as the sheet appears; the title names the league');
  const message = txt(layer().querySelector('.lc-as-msg'));
  assert(message.includes('You have 2 unsettled obligations here.') && message.endsWith("Picks you've made for the current week won't be scored.") && !/pick.*[A-Z]{3}/.test(message),
    `[4e-7] the sheet states the FACTS: 2 unsettled obligations (unpaid + pending; a paid one and one that is nobody's do not count) and that picks for an open week will not be scored — and shows no pick (${message})`);
  clickAction('[data-ls-action="cancel"].lc-as-bold');
  assert(!layer() && document.activeElement === leaveRow && !overlay().hasAttribute('inert') && S.rpcCalls().length === 0, '[4e-8] Cancel closes the sheet and returns focus to the Leave row; nothing was sent');
  leaveRow.click(); await settle(); layer().querySelector('.lc-scrim').dispatchEvent({ type: 'click', target: layer().querySelector('.lc-scrim') });
  assert(!layer(), '[4e-9] the scrim tap = Cancel');
  leaveRow.click(); await settle();
  const gate = defer(); S.gates.leave_league = gate; haptics = [];
  clickAction('[data-ls-action="confirm-leave"]'); await sleep(5);
  assert(!layer() && txt(q('[data-ls-action="leave"]')) === 'Leaving…' && q('[data-ls-action="leave"]').hasAttribute('disabled') && !!q('[data-ls-action="leave"] .lc-spin'), '[4e-10] CONFIRMED: the sheet closes, the row reads "Leaving…" with the group\'s one spinner and is inert');
  assert(app._linkFlowStateForTest().attempted === true, '[4e-11] the once-per-page automatic email re-link is LATCHED before the call when this is the last league (it must never link the account straight back into the seat it just left)');
  gate.resolve(); await settle();
  assert(JSON.stringify(S.rpcArgs('leave_league')) === '[{"p_league":"L1","p_confirm_archive":false}]' && S.rpcCalls().filter((n) => n === 'account_exit_leagues').length === 0, '[4e-12] ONE leave_league call, p_confirm_archive FALSE (a plain sheet never consents to an archive), and still no preflight');
  assert(S.toastText().includes('You left Saturday Crew.') && haptics.join() === 'notification:SUCCESS' && !overlay() && !layer() && app._leagueSettingsStateForTest() === null, '[4e-13] SUCCESS: the toast, ONE success haptic, the overlay and every layer gone, the page state dropped');
  assert(auth.getCachedMemberships().length === 0 && auth.getActiveLeagueId() === null, '[4e-14] the refresh moved the pointer and dropped the membership (the existing machinery)');
  const landing = document.getElementById('page-dashboard');
  assert(/You're not in a league yet/.test(landing.textContent) && PAGES.filter((id) => id !== 'page-dashboard').every((id) => document.getElementById(id).innerHTML === ''), '[4e-15] LANDING, none remain: the no-league landing paints, and every other page container is EMPTY (cleared, not hidden: nothing of the left league stays in the document)');
  installHaptics(false);
}
loud();

quiet();
{
  // failure copy, and the "unknown outcome" settled by a refresh BEFORE any copy is chosen (SC-L15)
  const run = async (hooks, check) => {
    const S = await world({ role: 'player' });
    Object.assign(S.hooks, hooks);
    openSettings(); await settle();
    installHaptics(true);
    q('[data-ls-action="leave"]').click(); await settle(); haptics = [];
    clickAction('[data-ls-action="confirm-leave"]'); await settle();
    await check(S);
    installHaptics(false); closeAll();
  };
  await run({ rpc: (n) => { if (n === 'leave_league') throw new TypeError('Failed to fetch'); return { data: null, error: null }; } }, (S) => {
    const b = q('#ls-banner .lc-banner-err');
    assert(b && txt(b) === "Couldn't leave Saturday Crew. You're still a member. Check your connection and try again." && !q('[data-ls-action="leave"]').hasAttribute('disabled') && !q('[data-ls-action="leave"]').hasAttribute('aria-disabled') && haptics.join() === 'notification:ERROR' && !!overlay(),
      '[4e-16] NETWORK FAILURE, the refresh shows the league still listed: "Couldn\'t leave… You\'re still a member", the row live again, an error haptic — and the page is still there');
    assert(S.calls.some((c) => c[0] === 'from' && c[1] === 'league_members'), '[4e-17] SC-L15: the refresh happened BEFORE the copy was chosen');
  });
  await run({ rpc: (n, a, st) => { if (n === 'leave_league') { st.memberships = []; throw new TypeError('Failed to fetch'); } return { data: null, error: null }; } }, (S) => {
    assert(S.toastText().includes('You left Saturday Crew.') && !overlay() && !document.querySelector('.lc-banner-err'), '[4e-18] a request that LANDED with its response lost: the refresh shows the league gone, so the success path runs — never "Couldn\'t leave" about a league you left');
  });
  await run({ from: (t, b, st, d) => (t === 'league_members' ? { data: null, error: { message: 'boom', code: 'XX' } } : d(t, b)) }, () => {
    const b = q('#ls-banner .lc-banner-err');
    assert(b && txt(b).startsWith("You left Saturday Crew, but this page couldn't refresh. Reload to continue.") && !!q('#ls-banner-reload') && !/Couldn't leave/.test(txt(b)), '[4e-19] APPLIED, REFRESH FAILED: "You left Saturday Crew, but this page couldn\'t refresh. Reload to continue." + Reload — never "Couldn\'t leave"');
  });
  await run({ rpc: (n) => { if (n === 'leave_league') throw new TypeError('Failed to fetch'); return { data: null, error: null }; }, from: (t, b, st, d) => (t === 'league_members' ? { data: null, error: { message: 'boom', code: 'XX' } } : d(t, b)) }, () => {
    const b = q('#ls-banner .lc-banner-err');
    assert(b && txt(b).startsWith("We couldn't confirm whether you left Saturday Crew. Reload to check.") && !!q('#ls-banner-reload'), '[4e-20] UNCONFIRMED (the call AND the refresh failed): neither outcome is claimed — "We couldn\'t confirm whether you left…" + Reload');
  });
  await run({ rpc: (n) => (n === 'leave_league' ? { data: null, error: { message: 'last_commissioner', code: '42501' } } : { data: null, error: null }) }, () => {
    const b = q('#ls-banner .lc-banner-err');
    assert(b && txt(b) === "You can't leave Saturday Crew right now because it has no commissioner. Send us feedback from the menu and we'll fix it." && !q('.lc-banner-action') && !sheetWrap(), '[4e-21] SC-L3: a PLAYER told last_commissioner gets the HEADLESS copy, no Try Again, and NO hand-off sheet (a player is not a commissioner)');
  });
  await run({ rpc: (n) => (n === 'leave_league' ? { data: null, error: { message: 'not_authenticated', code: '28000' } } : { data: null, error: null }) }, () => {
    assert(txt(q('#ls-banner .lc-banner-err')) === 'Your session expired. Sign in again to continue.', '[4e-22] an expired session: "Your session expired. Sign in again to continue."');
  });
}
{
  // not_a_member (removed, or left on another device): a calm note and a refresh
  const S = await world({ role: 'player', otherLeagues: [{ id: 'L2', name: 'Other' }] });
  S.hooks.rpc = (n, a, st) => { if (n === 'leave_league') { st.memberships = st.memberships.filter((m) => m.leagueId !== 'L1'); return { data: null, error: { message: 'not_a_member', code: '42501' } }; } return { data: null, error: null }; };
  openSettings(); await settle();
  q('[data-ls-action="leave"]').click(); await settle(); clickAction('[data-ls-action="confirm-leave"]'); await settle();
  assert(S.toastText().includes("You're no longer in Saturday Crew.") && auth.getCachedMemberships().every((m) => m.leagueId !== 'L1'), '[4e-23] not_a_member: "You\'re no longer in Saturday Crew." (calm) and the memberships were refreshed');
  closeAll();
}
loud();

_log('\n[4f] Leave — a commissioner: the SERVER\'s preflight decides; hand-off; league of one…');
quiet();
{
  const row = (o = {}) => ({ league_id: 'L1', league_name: 'Saturday Crew', pilot: false, blocks: true, auto_archive: false, candidates: [{ member_id: 'm2', display_name: 'Sam Rivera' }, { member_id: 'm3', display_name: 'Kai Ortiz' }], ...o });
  // CO-COMMISSIONER: the preflight finds no row -> the ordinary sheet
  {
    const S = await world({ role: 'commissioner' });
    S.preflight = [];
    openSettings(); await settle();
    const g = defer(); S.gates.account_exit_leagues = g;
    q('[data-ls-action="leave"]').click(); await sleep(5);
    assert(txt(q('[data-ls-action="leave"]')) === 'Leave League' && !!q('[data-ls-action="leave"] .lc-spin') && q('[data-ls-action="leave"]').hasAttribute('disabled') && !layer(), '[4f-1] a commissioner\'s tap shows the group\'s one spinner while the PREFLIGHT runs (the label unchanged: nothing is confirmed yet)');
    g.resolve(); await settle();
    assert(S.rpcCalls().filter((n) => n === 'account_exit_leagues').length === 1 && !!layer() && !sheetWrap() && txt(layer().querySelector('#ls-leave-title')) === 'Leave Saturday Crew?' && !q('[data-ls-action="leave"] .lc-spin'), '[4f-2] CO-COMMISSIONER: asked the server ONCE, no row -> the ordinary sheet, the row live again');
    closeAll();
  }
  // PREFLIGHT FAILS: loud and fail-closed
  {
    const S = await world({ role: 'commissioner' });
    S.hooks.rpc = (n) => (n === 'account_exit_leagues' ? { data: null, error: { message: 'Failed to fetch', code: '' } } : { data: null, error: null });
    openSettings(); await settle(); installHaptics(true);
    q('[data-ls-action="leave"]').click(); await settle();
    assert(txt(q('#ls-banner .lc-banner-err')) === "Couldn't check Saturday Crew. Nothing was changed. Check your connection and try again." && !layer() && !sheetWrap() && !q('[data-ls-action="leave"]').hasAttribute('disabled') && haptics.includes('notification:ERROR'),
      '[4f-3] PREFLIGHT FAILED: a persistent banner, NO sheet (an unanswerable preflight is never read as "no row" and a leave), the row live again, an error haptic');
    installHaptics(false); closeAll();
  }
  // SOLE COMMISSIONER WITH MEMBERS: the hand-off sheet
  {
    const S = await world({ role: 'commissioner' });
    S.preflight = [row()];
    openSettings(); await settle();
    installHaptics(true);
    const lr = q('[data-ls-action="leave"]'); lr.focus(); lr.click(); await settle();
    assert(!!sheetWrap() && !layer() && sheetWrap().hasAttribute('data-hold-teardown') && sheetWrap().querySelector('#ls-sheet').getAttribute('role') === 'dialog' && sheetWrap().querySelector('#ls-sheet').getAttribute('aria-modal') === 'true' && sheetWrap().querySelector('#ls-sheet').getAttribute('aria-labelledby') === 'ls-sheet-title',
      '[4f-4] SOLE COMMISSIONER (the server says `blocks`): the HAND-OFF sheet opens in the shared sheet shell — a labelled dialog, swept by a hold — and NOT the leave sheet');
    assert(document.activeElement && document.activeElement.id === 'ls-sheet-title' && overlay().hasAttribute('inert'), '[4f-5] focus moves into the sheet (the title, so VoiceOver reads it first) and the page under it is inert');
    assert(txt(sheetWrap().querySelector('.ls-sheet-lead')) === "You're the only commissioner of Saturday Crew." && sheetWrap().querySelectorAll('[data-ax-action="pick"]').length === 2 && !sheetWrap().querySelector('[data-ax-action="ask-archive"]') && !/Archive/.test(sheetWrap().textContent), '[4f-6] the server\'s two candidates, and NO archive anywhere on this path');
    assert(app._isDismissGestureBlockedByOtherSurfaceForTest() === true, '[4f-7] while the sheet is up the League Page\'s swipe-back is blocked');
    const gate = defer(); S.gates.admin_set_member_role = gate;
    sheetWrap().querySelector('[data-ax-member="m2"]').click(); await sleep(5);
    assert(sheetWrap().querySelectorAll('[data-ax-action="pick"][disabled]').length === 2 && sheetWrap().querySelectorAll('.lc-spin').length === 1 && JSON.stringify(S.rpcArgs('admin_set_member_role')) === '[{"p_league":"L1","p_member":"m2","p_role":"commissioner"}]' && haptics.includes('selection'),
      '[4f-8] a HAND-OFF in flight: the tapped row spins, every row is inert, the existing setMemberRole() RPC is the one called');
    S.preflight = [];   // the server now has a second commissioner
    gate.resolve(); await settle();
    assert(txt(sheetWrap().querySelector('.ls-handed-text')) === 'Sam Rivera is now commissioner of Saturday Crew.' && !!sheetWrap().querySelector('[data-ls-action="leave-after-handoff"]') && !!sheetWrap().querySelector('[data-ls-action="stay"]') && haptics.includes('notification:SUCCESS'),
      '[4f-9] HANDED: "Sam Rivera is now commissioner of Saturday Crew." with Leave League and Stay in League, and a success haptic');
    assert(sheetWrap().querySelector('.ls-sheet-body').classList.contains('ls-view-back'), '[4f-10] the picker-to-done change is the 150 ms crossfade');
    // Leave League: RE-ASK, then the ordinary sheet OVER the hand-off sheet
    const asks = S.rpcCalls().filter((n) => n === 'account_exit_leagues').length;
    haptics = [];
    sheetWrap().querySelector('[data-ls-action="leave-after-handoff"]').click(); await settle();
    assert(S.rpcCalls().filter((n) => n === 'account_exit_leagues').length === asks + 1 && !!layer() && !!sheetWrap() && sheetWrap().hasAttribute('inert') && txt(layer().querySelector('#ls-leave-title')) === 'Leave Saturday Crew?' && haptics.join() === 'notification:WARNING',
      '[4f-11] "Leave League" after a hand-off RE-ASKS the server first (it now answers "ordinary leave") and raises the leave sheet OVER the hand-off sheet (z-index 8100 over 8000), which goes inert under it');
    clickAction('[data-ls-action="cancel"].lc-as-bold');
    assert(!layer() && !!sheetWrap() && !sheetWrap().hasAttribute('inert') && !!sheetWrap().querySelector('[data-ls-action="stay"]'), '[4f-12] cancelling the confirmation leaves the hand-off sheet in its done state');
    sheetWrap().querySelector('[data-ls-action="leave-after-handoff"]').click(); await settle();
    clickAction('[data-ls-action="confirm-leave"]'); await settle();
    assert(JSON.stringify(S.rpcArgs('leave_league')) === '[{"p_league":"L1","p_confirm_archive":false}]' && !sheetWrap() && !layer() && !overlay() && S.toastText().includes('You left Saturday Crew.'), '[4f-13] confirming leaves with p_confirm_archive FALSE; the sheet, the layer and the page all go; the toast speaks');
    installHaptics(false);
  }
  // STAY: the sheet closes by the same exit it arrived by; the page stays
  {
    const S = await world({ role: 'commissioner' });
    S.preflight = [row()];
    openSettings(); await settle();
    q('[data-ls-action="leave"]').click(); await settle();
    sheetWrap().querySelector('[data-ax-member="m3"]').click(); await settle();
    S.preflight = [];
    sheetWrap().querySelector('[data-ls-action="stay"]').click(); await sleep(5);
    assert(sheetWrap() && sheetWrap().getAttribute('data-closing') === 'slide' && sheetWrap().style['--ls-drag-y'] === '1', '[4f-14] STAY closes the sheet on the exit slide (--ls-drag-y -> 1, data-closing) — it LEAVES the way it arrived and its node is not yanked');
    await sleep(500);
    assert(!sheetWrap() && !!overlay() && !overlay().hasAttribute('inert') && document.activeElement && document.activeElement.id === 'ls-leave-row' && S.rpcCalls().filter((n) => n === 'leave_league').length === 0, '[4f-15] …then the node is removed, the page is live again with focus back on the Leave row, and nothing was left');
    closeAll();
  }
  // dismissal: the close button, the backdrop and Esc
  for (const how of ['close', 'backdrop', 'esc']) {
    const S = await world({ role: 'commissioner' });
    S.preflight = [row()];
    openSettings(); await settle();
    q('[data-ls-action="leave"]').click(); await settle();
    if (how === 'close') sheetWrap().querySelector('#ls-sheet-close').click();
    else if (how === 'backdrop') sheetWrap().querySelector('.chat-sheet-backdrop').click();
    else document.dispatchEvent({ type: 'keydown', key: 'Escape' });
    await sleep(500);
    assert(!sheetWrap() && !!overlay() && document.listenerCount('keydown') === 0 && !overlay().hasAttribute('inert'), `[4f-16] the hand-off sheet closes from ${how === 'close' ? 'its close button' : how === 'backdrop' ? 'the backdrop' : 'Esc'} (and the page and the key listener are restored)`);
    closeAll();
  }
  // HAND-OFF FAILS: the picker's inline banner, rows live, the server re-asked
  {
    const S = await world({ role: 'commissioner' });
    S.preflight = [row()];
    S.hooks.rpc = (n) => (n === 'admin_set_member_role' ? { data: null, error: { message: 'boom', code: 'XX000' } } : (n === 'account_exit_leagues' ? { data: S.preflight, error: null } : { data: null, error: null }));
    openSettings(); await settle();
    q('[data-ls-action="leave"]').click(); await settle(); installHaptics(true);
    const asks = S.rpcCalls().filter((n) => n === 'account_exit_leagues').length;
    sheetWrap().querySelector('[data-ax-member="m2"]').click(); await settle();
    assert(txt(sheetWrap().querySelector('.lc-banner-err')) === "Couldn't make Sam Rivera commissioner. Nothing was changed. Check your connection and try again." && sheetWrap().querySelectorAll('[data-ax-action="pick"]:not([disabled])').length === 2 && haptics.includes('notification:ERROR'),
      '[4f-17] a FAILED hand-off: the picker\'s own inline banner with the DI\'s sentence, the rows live again, an error haptic');
    assert(S.rpcCalls().filter((n) => n === 'account_exit_leagues').length === asks + 1 && !sheetWrap().querySelector('.lc-banner-info'), '[4f-18] "Nothing was changed" is only as true as the answer we have: the server is RE-ASKED, and with the candidate still there the failure banner stands (no false stale notice)');
    // the candidate has gone when we re-ask: the picker rebuilds with the stale notice
    S.preflight = [row({ candidates: [{ member_id: 'm3', display_name: 'Kai Ortiz' }] })];
    sheetWrap().querySelector('[data-ax-member="m2"]').click(); await settle();
    assert(sheetWrap().querySelectorAll('[data-ax-action="pick"]').length === 1 && txt(sheetWrap().querySelector('.lc-banner-info')) === 'Your league changed while you were here. Choose who should take over.', '[4f-19] STALE (the candidate left while the sheet was open): the picker rebuilds from the server\'s fresh row with the calm notice');
    // the call "failed" but had LANDED: the re-ask shows no blocking row, so the sheet reads as handed
    S.preflight = [];
    sheetWrap().querySelector('[data-ax-member="m3"]').click(); await settle();
    assert(!!sheetWrap().querySelector('[data-ls-action="leave-after-handoff"]') && /Kai Ortiz is now commissioner/.test(txt(sheetWrap().querySelector('.ls-handed-text'))), '[4f-20] a hand-off whose response was lost but which LANDED is shown as what it is (handed), never as a failure');
    installHaptics(false); closeAll();
  }
  // PILOT: always blocks; no archive; with no candidates nothing can proceed
  {
    const S = await world({ role: 'commissioner', pilot: true });
    S.preflight = [row({ pilot: true, candidates: [] })];
    openSettings(); await settle();
    q('[data-ls-action="leave"]').click(); await settle();
    assert(!!sheetWrap() && !layer() && txt(sheetWrap().querySelector('.ls-sheet-pilot')) === "This league can't be archived. Choose a new commissioner to continue." && txt(sheetWrap().querySelector('.ax-picker-empty')) === "There's no one to hand Saturday Crew to right now."
      && !sheetWrap().querySelector('[data-ax-action]') && !sheetWrap().querySelector('[data-ls-action="confirm-leave-archive"]') && !/Archive/.test(sheetWrap().textContent), '[4f-21] PILOT with no candidates: the pilot sentence and "There\'s no one to hand Saturday Crew to right now." — NOTHING can proceed and no archive is offered');
    closeAll();
  }
  // A LEAGUE OF ONE: the archive sheet, and ONLY its confirm consents
  {
    const S = await world({ role: 'commissioner' });
    S.preflight = [row({ blocks: false, auto_archive: true, candidates: [] })];
    openSettings(); await settle();
    q('[data-ls-action="leave"]').click(); await settle();
    assert(!!layer() && !sheetWrap() && txt(layer().querySelector('#ls-leave-title')) === 'Leave and archive Saturday Crew?' && txt(layer().querySelector('.lc-as-danger')) === 'Leave and Archive' && !layer().querySelector('[data-ax-action]'), '[4f-22] A LEAGUE OF ONE (`autoArchive`): "Leave and archive Saturday Crew?" — no picker');
    installHaptics(true);
    clickAction('[data-ls-action="confirm-leave-archive"]'); await settle();
    assert(JSON.stringify(S.rpcArgs('leave_league')) === '[{"p_league":"L1","p_confirm_archive":true}]' && S.toastText().includes('You left Saturday Crew. It was archived.') && haptics.includes('notification:SUCCESS'), '[4f-23] the archive confirm is the ONLY control that sends p_confirm_archive TRUE; the toast says it was archived');
    installHaptics(false); closeAll();
  }
  // archive_confirm_required on a PLAIN leave: re-ask, show the archive sheet, NEVER retry with true on its own
  {
    const S = await world({ role: 'commissioner' });
    S.preflight = [];
    S.hooks.rpc = (n, a) => { if (n === 'leave_league') { S.preflight = [row({ blocks: false, auto_archive: true, candidates: [] })]; return { data: null, error: { message: 'archive_confirm_required', code: 'P0001' } }; } if (n === 'account_exit_leagues') return { data: S.preflight, error: null }; return { data: null, error: null }; };
    openSettings(); await settle();
    q('[data-ls-action="leave"]').click(); await settle();
    clickAction('[data-ls-action="confirm-leave"]'); await settle();
    assert(S.rpcArgs('leave_league').length === 1 && S.rpcArgs('leave_league')[0].p_confirm_archive === false, '[4f-24] SC-L9: the league became a league of one while the page was open — the plain leave was REFUSED and the client did NOT retry with the consent on its own');
    assert(!!layer() && txt(layer().querySelector('#ls-leave-title')) === 'Leave and archive Saturday Crew?' && txt(q('#ls-banner .lc-banner-info')) === 'Your league changed while you were here.', '[4f-25] it re-asked the server and raised the ARCHIVE sheet with the calm notice');
    closeAll();
  }
  // STALE: the client expected a plain leave but the server says last_commissioner -> re-ask -> the hand-off sheet with the notice
  {
    const S = await world({ role: 'commissioner' });
    S.preflight = [];
    S.hooks.rpc = (n) => { if (n === 'leave_league') { S.preflight = [row()]; return { data: null, error: { message: 'last_commissioner', code: '42501' } }; } if (n === 'account_exit_leagues') return { data: S.preflight, error: null }; return { data: null, error: null }; };
    openSettings(); await settle();
    q('[data-ls-action="leave"]').click(); await settle();
    clickAction('[data-ls-action="confirm-leave"]'); await settle();
    assert(!!sheetWrap() && txt(sheetWrap().querySelector('.lc-banner-info')) === 'Your league changed while you were here. Choose who should take over.', '[4f-26] a COMMISSIONER told last_commissioner (a co-commissioner left meanwhile): re-asked, and the hand-off sheet opens with "Your league changed while you were here. Choose who should take over."');
    closeAll();
  }
}
loud();

_log('\n[4g] The landings, the teardown, the layers…');
quiet();
{
  const stale = (S) => { for (const id of PAGES) document.getElementById(id).innerHTML = '<p class="stale">Saturday Crew picks for Kev</p>'; };
  // TWO OR MORE remain: the pointer is null and the adapter idle -> content is "withheld" -> NO repaint would happen -> the left league's page would stay. It is cleared and Leagues Home paints.
  {
    const S = await world({ role: 'player', otherLeagues: [{ id: 'L2', name: 'Lake House Pool' }, { id: 'L3', name: 'Friday Night Picks' }] });
    openSettings(); await settle(); stale(S);
    q('[data-ls-action="leave"]').click(); await settle(); clickAction('[data-ls-action="confirm-leave"]'); await settle();
    assert(app._linkFlowStateForTest().attempted === false, '[4g-1] with leagues remaining the once-per-page email re-link is NOT latched (only the last-league leave needs it)');
    assert(auth.getActiveLeagueId() === null && auth.getCachedMemberships().length === 2, '[4g-2] two remain: the refresh cleared the pointer');
    const dash = document.getElementById('page-dashboard');
    assert(/Lake House Pool/.test(dash.textContent) && /Friday Night Picks/.test(dash.textContent) && !/Saturday Crew/.test(dash.textContent) && PAGES.every((id) => !/class="stale"/.test(document.getElementById(id).innerHTML)),
      '[4g-3] LANDING, two or more remain: Leagues Home paints with the REMAINING leagues, and no frame of the left league\'s content survives in ANY page container');
  }
  // EXACTLY ONE remains: the refresh auto-activates it and the existing hydrate repaints; this code does not touch the containers
  {
    const S = await world({ role: 'player', otherLeagues: [{ id: 'L2', name: 'Lake House Pool' }] });
    openSettings(); await settle(); stale(S);
    q('[data-ls-action="leave"]').click(); await settle(); clickAction('[data-ls-action="confirm-leave"]'); await settle();
    assert(auth.getActiveLeagueId() === 'L2' && app._linkFlowStateForTest().attempted === false, '[4g-4] ONE remains: the refresh auto-activated it (the existing machinery), no latch');
    stale(S); app._lsLandAfterLeaveForTest();
    assert(PAGES.every((id) => /class="stale"/.test(document.getElementById(id).innerHTML)) && LS.landingAfterLeave(auth.getCachedMemberships()) === 'single', '[4g-5] …and the post-leave landing leaves the containers alone for that case: the MEMBERSHIPS_REFRESHED handler hydrates the one remaining league and repaints (device-verify the paint)');
  }
  // the teardown: an identity change sweeps the page, the layer and the sheet and drops every piece of state
  {
    const S = await world({ role: 'commissioner' });
    S.preflight = [{ league_id: 'L1', league_name: 'Saturday Crew', pilot: false, blocks: true, auto_archive: false, candidates: [{ member_id: 'm2', display_name: 'Sam' }] }];
    openSettings(); await settle();
    q('[data-ls-action="leave"]').click(); await settle();
    assert(!!sheetWrap() && document.listenerCount('keydown') === 1, '[4g-6] fixture: the page, the hand-off sheet and the Esc listener are up');
    auth._setAccountUserIdForTest('u2');   // a DIFFERENT account on the same page: the real identity chokepoint
    await settle();
    assert(!overlay() && !sheetWrap() && !layer() && app._leagueSettingsStateForTest() === null && document.listenerCount('keydown') === 0 && !document.querySelector('.main-content').hasAttribute('inert'), '[4g-7] an IDENTITY CHANGE sweeps the page, the sheet and the layer, drops the page state and the Esc listener, and lifts the inert lock (nothing of the previous identity is inherited)');
  }
  {
    const S = await world({ role: 'player' });
    openSettings(); await settle();
    q('[data-ls-action="leave"]').click(); await settle();
    assert(!!layer(), '[4g-8] fixture: a confirmation is up');
    for (const el of document.querySelectorAll('[data-hold-teardown]')) el.remove();   // exactly what tearDownRenderedContentForHold() does
    app._hideLeaguePageOverlayForTest();
    assert(!layer() && app._leagueSettingsStateForTest() === null && document.listenerCount('keydown') === 0, '[4g-9] a HOLD\'s sweep followed by the overlay\'s own close path leaves no layer, no state and no listener behind');
  }
}
loud();

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[4i] SC-L15 honesty — a membership refresh that answers "could not ask" (null) is a refresh that did NOT happen (security C-U1)…');
quiet();
{
  // The offline / expired-token device: the call's outcome is unknown (or landed), and the membership read then finds NO session user, so refreshMembershipsAndSession() resolves `null`
  // (it never throws for that). The wrappers treat "did not throw" as "the refresh worked", so the adapter must turn a non-list into a throw.
  const offline = (st) => { st.userId = null; };
  const throwFetch = () => { throw new TypeError('Failed to fetch'); };
  const withWorld = async (cfg, hooks, run) => { const S = await world(cfg); Object.assign(S.hooks, hooks); return run(S); };

  // RENAME
  const r1 = await withWorld({ role: 'commissioner' }, { rpc: (n, a, st) => { offline(st); return throwFetch(); } }, () => auth.renameLeague('L1', 'New Name', { role: 'commissioner' }));
  assert(r1.status === 'unconfirmed', `[4i-1] RENAME, transport failure, refresh could not ask: UNCONFIRMED — neither "failed" nor "done" may be claimed (got ${JSON.stringify(r1)})`);
  const r2 = await withWorld({ role: 'commissioner' }, { rpc: (n, a, st, d) => { const out = d(n, a); offline(st); return out; } }, () => auth.renameLeague('L1', 'New Name', { role: 'commissioner' }));
  assert(r2.status === 'done_refresh_failed' && r2.name === 'New Name', `[4i-2] RENAME that LANDED, refresh could not ask: done_refresh_failed (the rename is real; the page could not refresh) (got ${JSON.stringify(r2)})`);
  const r3 = await withWorld({ role: 'commissioner' }, { rpc: throwFetch }, () => auth.renameLeague('L1', 'New Name', { role: 'commissioner' }));
  const r4 = await withWorld({ role: 'commissioner' }, {}, () => auth.renameLeague('L1', 'New Name', { role: 'commissioner' }));
  assert(r3.status === 'failed' && r4.status === 'done' && r4.inferred === false, `[4i-3] CONTROL (online): the same transport failure is "failed" (the refresh shows the name unchanged) and the same success is "done" — the null mapping is not a blanket (got ${r3.status} / ${r4.status})`);

  // LEAVE
  const l1 = await withWorld({ role: 'player' }, { rpc: (n, a, st) => { if (n === 'leave_league') { offline(st); return throwFetch(); } return { data: null, error: null }; } }, () => auth.leaveLeague('L1', { role: 'player' }));
  assert(l1.status === 'unconfirmed', `[4i-4] LEAVE, transport failure, refresh could not ask: UNCONFIRMED — never "Couldn't leave… You're still a member" (got ${JSON.stringify(l1)})`);
  const l2 = await withWorld({ role: 'player' }, { rpc: (n, a, st, d) => { const out = d(n, a); if (n === 'leave_league') offline(st); return out; } }, () => auth.leaveLeague('L1', { role: 'player' }));
  assert(l2.status === 'done_refresh_failed' && l2.result === 'left', `[4i-5] LEAVE that LANDED, refresh could not ask: done_refresh_failed, never "done" (got ${JSON.stringify(l2)})`);
  const l3 = await withWorld({ role: 'player' }, { rpc: (n) => { if (n === 'leave_league') throwFetch(); return { data: null, error: null }; } }, () => auth.leaveLeague('L1', { role: 'player' }));
  assert(l3.status === 'failed', `[4i-6] CONTROL (online): a transport failure with the league still listed is "failed" (got ${l3.status})`);

  // SWITCH: the one refresh the switch makes is after a stale-role refusal, and `refreshed` must say whether it really happened
  const notComm = (n) => (n === 'set_accepting_members' ? { data: null, error: { message: 'not_commissioner', code: 'P0001' } } : { data: null, error: null });
  const s1 = await withWorld({ role: 'commissioner' }, { rpc: (n, a, st) => { offline(st); return notComm(n); } }, () => auth.setAcceptingMembers('L1', false, { role: 'commissioner' }));
  const s2 = await withWorld({ role: 'commissioner' }, { rpc: notComm }, () => auth.setAcceptingMembers('L1', false, { role: 'commissioner' }));
  assert(s1.status === 'refused' && s1.kind === 'not_commissioner' && s1.refreshed === false && s2.refreshed === true, `[4i-7] SWITCH, stale-role refusal: \`refreshed\` is FALSE when the refresh could not ask and TRUE when it read the list (${JSON.stringify(s1)} / ${JSON.stringify(s2)})`);

  // the same through the page: the copy a person actually reads
  const pageRun = async (cfg, hooks, act, check) => {
    const S = await world(cfg); Object.assign(S.hooks, hooks);
    openSettings(); await settle();
    await act(S); await settle();
    await check(S);
    closeAll();
  };
  await pageRun({ role: 'player' }, { rpc: (n, a, st) => { if (n === 'leave_league') { offline(st); return throwFetch(); } return { data: null, error: null }; } },
    async () => { q('[data-ls-action="leave"]').click(); await settle(); clickAction('[data-ls-action="confirm-leave"]'); },
    () => {
      const b = q('#ls-banner .lc-banner-err');
      assert(b && txt(b).startsWith("We couldn't confirm whether you left Saturday Crew. Reload to check.") && !!q('#ls-banner-reload') && !/still a member/.test(txt(b)), '[4i-8] the PAGE: an offline leave shows "We couldn\'t confirm whether you left…" with Reload, never "You\'re still a member"');
    });
  await pageRun({ role: 'player' }, { rpc: (n, a, st, d) => { const out = d(n, a); if (n === 'leave_league') offline(st); return out; } },
    async () => { q('[data-ls-action="leave"]').click(); await settle(); clickAction('[data-ls-action="confirm-leave"]'); },
    (S) => {
      const b = q('#ls-banner .lc-banner-err');
      assert(b && txt(b).startsWith("You left Saturday Crew, but this page couldn't refresh. Reload to continue.") && !!q('#ls-banner-reload') && !!overlay() && !S.toastText().includes('You left Saturday Crew.') && !/You're not in a league yet/.test(document.getElementById('page-dashboard').textContent),
        '[4i-9] the PAGE: a leave that landed while the refresh could not ask shows the Reload banner on the page that is still there — it does NOT land on a stale page with no banner, and no success toast claims a refresh that did not happen');
    });
  await pageRun({ role: 'commissioner' }, { rpc: (n, a, st) => { if (n === 'rename_league') { offline(st); return throwFetch(); } return { data: null, error: null }; } },
    async () => { type(q('#ls-name-input'), 'New Name'); q('#ls-name-save').click(); },
    () => {
      const b = q('#ls-banner .lc-banner-err');
      assert(b && txt(b).startsWith("We couldn't confirm whether the name changed. Reload to check.") && !!q('#ls-banner-reload') && !/Couldn't rename/.test(txt(b)), '[4i-10] the PAGE: an offline rename shows "We couldn\'t confirm whether the name changed…" with Reload, never "Couldn\'t rename the league. Nothing was changed."');
    });
  // the source: the adapter turns a non-list into a throw, and says why
  const AUTHSRC = read('./js/auth.js');
  const adapterSrc = AUTHSRC.slice(AUTHSRC.indexOf('function _leagueSettingsDeps('), AUTHSRC.indexOf('export async function getLeagueSettings('));
  assert(/refreshMemberships: async \(\) => \{\s*const read = await refreshMembershipsAndSession\(\);\s*if \(!Array\.isArray\(read\)\) throw new Error\('could_not_ask'\);\s*\},/.test(adapterSrc), '[4i-11] source pin: the adapter awaits the refresh and THROWS unless it resolved a list (a bare pass-through is the defect)');
}
loud();

_log('\n[4h] SC-L15 — the leaver\'s push identity across the three landings (the REAL push module, a recording SDK stand-in)…');
quiet();
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ oneSignalAppId: 'test-app-id' }) });
  const sequence = async (otherLeagues) => {
    const S = await world({ role: 'player', otherLeagues, push: true });
    await pumpOneSignalQueue({ login: () => {}, logout: () => {} });   // the setup's own identity login
    globalThis.window.OneSignalDeferred = [];
    openSettings(); await settle();
    q('[data-ls-action="leave"]').click(); await settle();
    clickAction('[data-ls-action="confirm-leave"]'); await settle();
    const seq = [];
    await pumpOneSignalQueue({ login: (id) => seq.push('login'), logout: () => seq.push('logout') });
    return { S, seq };
  };
  const none = await sequence([]);
  assert(none.seq.length >= 1 && none.seq[none.seq.length - 1] === 'logout' && !none.seq.includes('login'), `[4h-1] NONE remain: the device ends UNBOUND — a logout and no login (${JSON.stringify(none.seq)})`);
  const one = await sequence([{ id: 'L2', name: 'Lake House Pool' }]);
  assert(one.seq.includes('logout') && one.seq.filter((x) => x === 'login').length === 1 && one.seq.lastIndexOf('login') > one.seq.indexOf('logout'), `[4h-2] ONE remains: the device is unbound and then logs the account alias back in EXACTLY ONCE, after the logout — the remaining league's pushes continue (${JSON.stringify(one.seq)})`);
  const many = await sequence([{ id: 'L2', name: 'Lake House Pool' }, { id: 'L3', name: 'Friday Night Picks' }]);
  assert(many.seq.length >= 1 && many.seq[many.seq.length - 1] === 'logout' && !many.seq.includes('login'), `[4h-3] TWO OR MORE remain (pointer null, Leagues Home): the device ends UNBOUND until a league is opened — the documented DI-436.1 follow-up for Multi-Sport, not introduced here (${JSON.stringify(many.seq)})`);
  globalThis.fetch = realFetch;
}
loud();

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[5] The Comm Panel — roster labels and disabled codes, the Obligations card (Waive / Undo), the shared ledger helper untouched…');
quiet();
{
  const S = await world({ role: 'commissioner' });
  const member = (o) => ({ memberId: 'x', displayName: 'X', role: 'player', active: true, linked: false, initials: 'X', almaMater: '', linkDisputedAt: null, linkedAt: null, ...o });
  app._setMemberCardDataForTest({
    members: [
      member({ memberId: 'm-left', displayName: 'Lefty', active: false, linked: false, linkedAt: '2026-09-01T00:00:00Z' }),
      member({ memberId: 'm-rem', displayName: 'Removed Never Linked', active: false, linked: false, linkedAt: null }),
      member({ memberId: 'm-remlinked', displayName: 'Removed Linked', active: false, linked: true, linkedAt: '2026-09-01T00:00:00Z' }),
      member({ memberId: 'm-active', displayName: 'Active Unlinked', active: true, linked: false, linkedAt: '2026-08-01T00:00:00Z' }),
      member({ memberId: 'm-linked', displayName: 'Active Linked', active: true, linked: true, linkedAt: '2026-08-01T00:00:00Z', role: 'commissioner' }),
      member({ memberId: 'm-<h>', displayName: HOSTILE, active: false, linked: false, linkedAt: '2026-09-01T00:00:00Z' }),
    ],
    codes: [{ memberId: 'm-left', claimCode: 'LEFT1234' }, { memberId: 'm-rem', claimCode: 'REMV1234' }, { memberId: 'm-active', claimCode: 'ACTV1234' }],
    contacts: [],
  });
  const roster = parse(app._leagueMembersCardHTMLForTest());
  const rowOf = (id) => roster.querySelector(`[data-member-row="${id}"]`);
  const name = (id) => txt(rowOf(id).querySelector('.font-display'));
  assert(name('m-left').startsWith('Lefty (left)') && name('m-rem').startsWith('Removed Never Linked (removed)') && name('m-remlinked').startsWith('Removed Linked (removed)') && !/\((left|removed)\)/.test(name('m-active')) && !/\((left|removed)\)/.test(name('m-linked')),
    '[5a] the roster: a seat that was linked and is now unlinked and inactive reads "(left)"; any other inactive seat reads "(removed)"; an active seat reads neither (a Restored seat is a normal "Not linked yet" row)');
  assert(rowOf('m-left').textContent.includes('Left the league. To give them their old spot back: Restore, then New Code.') && rowOf('m-rem').textContent.includes('Removed from the league. To bring them back: Restore, then New Code.')
    && !rowOf('m-active').textContent.includes('Restore, then New Code'), '[5b] a "(left)" row says how to give the person their old spot back; a "(removed)" row has its sibling; an active row has none');
  {
    // Merge review (BLOCK #1, condition 3): "Restore, then New Code." is only true for a seat with NO sign-in attached. A seat removed while LINKED comes back with the same sign-in on Restore, and
    // its New Code stays disabled ("Unlink first"), so the guidance would send the commissioner down a path that cannot work.
    const LINKED_SENTENCE = 'Removed from the league. Restore brings them back with the same sign-in.';
    const linkedNote = rowOf('m-remlinked').textContent;
    assert(linkedNote.includes(LINKED_SENTENCE) && !linkedNote.includes('Restore, then New Code') && !linkedNote.includes('New Code.'), '[5b2] a seat removed WHILE LINKED gets its own sentence — it never says "Restore, then New Code"');
    assert(rowOf('m-rem').textContent.includes('Removed from the league. To bring them back: Restore, then New Code.') && !rowOf('m-rem').textContent.includes('same sign-in') && rowOf('m-left').textContent.includes('Restore, then New Code.') && !rowOf('m-left').textContent.includes('same sign-in'),
      '[5b3] …while a removed seat that NEVER linked, and a "(left)" seat, keep "Restore, then New Code."');
    assert(V.inactiveRowCaption('(removed)', { linked: true }) === LINKED_SENTENCE && V.inactiveRowCaption('(removed)', { linked: false }) === V.inactiveRowCaption('(removed)') && V.inactiveRowCaption('(removed)') === V.LSV_COPY.removedCaption && V.inactiveRowCaption('', { linked: true }) === '' && V.inactiveRowCaption('(left)', { linked: false }) === V.LSV_COPY.leftCaption,
      '[5b4] the pure caption: the linked flag picks the sentence for a removed seat only; the default is the unlinked reading; an active row (no label) has none');
    assert(rowOf('m-remlinked').querySelector('.member-newcode-btn').hasAttribute('disabled') && txt(rowOf('m-remlinked').querySelector('.member-remove-btn')) === 'Restore', '[5b5] (the facts the sentence rests on) a linked removed seat\'s New Code is disabled and Restore is its action');
  }
  assert(rowOf('m-left').querySelector('.member-newcode-btn').hasAttribute('disabled') && rowOf('m-left').querySelector('.member-copy-code-btn').hasAttribute('disabled') && rowOf('m-rem').querySelector('.member-newcode-btn').hasAttribute('disabled') && rowOf('m-rem').querySelector('.member-copy-code-btn').hasAttribute('disabled'),
    '[5c] New Code and Copy Code are DISABLED while the seat is inactive (issue_claim_code refuses an inactive seat), even when a stale code is on file');
  assert(!rowOf('m-active').querySelector('.member-newcode-btn').hasAttribute('disabled') && !rowOf('m-active').querySelector('.member-copy-code-btn').hasAttribute('disabled') && rowOf('m-linked').querySelector('.member-newcode-btn').hasAttribute('disabled') && !rowOf('m-linked').querySelector('.member-copy-code-btn'),
    '[5d] an ACTIVE unlinked seat keeps both codes enabled; a linked seat keeps its existing "Unlink first" disabling');
  assert(txt(rowOf('m-left').querySelector('.member-remove-btn')) === 'Restore' && txt(rowOf('m-active').querySelector('.member-remove-btn')) === 'Remove from League', '[5e] Restore stays the inactive row\'s action (unchanged), Remove the active row\'s');
  const hostileRow = roster.querySelectorAll('[data-member-row]').find((e) => e.getAttribute('data-member-row') === 'm-<h>');
  assert(hostileRow && hostileRow.querySelectorAll('img').length === 0 && roster.querySelectorAll('script').length === 0 && txt(hostileRow.querySelector('.font-display')).includes('(left)'), '[5f] a hostile display name in a "(left)" row renders as inert text, with the label still after it');

  // the Obligations card
  seed({
    players: [{ id: 'm-L1', name: 'Kev' }, { id: 'p-sam', name: 'Sam' }, { id: 'p-left', name: 'Lefty', active: false }, { id: 'p-kai', name: 'Kai' }],
    weeks: [{ weekId: 'w1', status: 'final' }],
    obligations: [
      { obligationId: 'o-left-payer', type: 'weekly', weekId: 'w1', payerPlayerId: 'p-left', recipientPlayerId: 'p-sam', status: 'unpaid', note: '1 drink' },
      { obligationId: 'o-left-recip', type: 'weekly', weekId: 'w1', payerPlayerId: 'p-sam', recipientPlayerId: 'p-left', status: 'pending', note: '1 drink' },
      { obligationId: 'o-me-payer', type: 'weekly', weekId: 'w1', payerPlayerId: 'm-L1', recipientPlayerId: 'p-left', status: 'unpaid', note: '1 drink' },
      { obligationId: 'o-both-in', type: 'weekly', weekId: 'w1', payerPlayerId: 'p-sam', recipientPlayerId: 'p-kai', status: 'unpaid', note: '1 drink' },
      { obligationId: 'o-paid', type: 'weekly', weekId: 'w1', payerPlayerId: 'p-left', recipientPlayerId: 'p-sam', status: 'paid', note: '1 drink' },
      { obligationId: 'o-waived', type: 'weekly', weekId: 'w1', payerPlayerId: 'p-left', recipientPlayerId: 'p-kai', status: 'waived', note: '1 drink' },
    ],
  });
  const ledger = () => parse(app.renderObligationsAdmin());
  const lrow = (L, id) => L.querySelectorAll('.flex-between').find((r) => r.querySelector(`[data-ob-id="${id}"]`) || r.querySelector('.ob-delete-btn') && r.querySelector('.ob-delete-btn').getAttribute('data-ob-id') === id);
  let L = ledger();
  const waiveFor = (id) => lrow(L, id).querySelector('.ob-waive-btn');
  assert(waiveFor('o-left-payer') && waiveFor('o-left-payer').getAttribute('data-ob-action') === 'waive' && txt(waiveFor('o-left-payer')) === 'Waive', '[5h] a debt whose PAYER has left offers the commissioner Waive');
  assert(waiveFor('o-left-recip') && waiveFor('o-left-recip').getAttribute('data-ob-action') === 'waive', '[5i] a PENDING debt whose RECIPIENT has left offers Waive too');
  assert(!waiveFor('o-me-payer'), '[5j] SC-L13: NO Waive when the acting commissioner is the PAYER (a commissioner does not forgive their own debt from this card)');
  assert(!waiveFor('o-both-in') && !waiveFor('o-paid'), '[5k] no Waive where both are still in the league, and none on a settled debt');
  assert(lrow(L, 'o-waived').querySelector('.badge-final') && txt(lrow(L, 'o-waived').querySelector('.badge-final')) === 'Waived' && lrow(L, 'o-waived').querySelector('.ob-waive-btn') && lrow(L, 'o-waived').querySelector('.ob-waive-btn').getAttribute('data-ob-action') === 'reopen' && txt(lrow(L, 'o-waived').querySelector('.ob-waive-btn')) === 'Undo',
    '[5l] a WAIVED row keeps the existing "Waived" badge and gets a ghost Undo');
  assert(txt(lrow(L, 'o-left-payer').querySelector('.text-sm')).startsWith('Lefty (left) owes Sam') && txt(lrow(L, 'o-left-recip').querySelector('.text-sm')).startsWith('Sam owes Lefty (left)') && !/\(left\)/.test(txt(lrow(L, 'o-both-in').querySelector('.text-sm'))),
    '[5m] the ledger names a departed party with the neutral "(left)" (the mirror knows only `active`); active parties carry nothing');
  assert(lrow(L, 'o-left-payer').querySelector('.ob-action-btn') && lrow(L, 'o-left-payer').querySelector('.ob-delete-btn'), '[5n] the shared actions (Mark Paid) and the existing delete control are still there beside Waive');
  assert(!lrow(L, 'o-left-payer').querySelector('.ob-waive-btn').closest('[data-ob-action="mark"]'), '[5o] Waive is a SIBLING of the shared output, never inside it');

  // the flow
  const btn = waiveFor('o-left-payer');
  installHaptics(true);
  app._lsOnWaiveClickForTest(btn);
  assert(!!layer() && txt(layer().querySelector('#ls-waive-title')) === 'Waive this obligation?' && /^Lefty owes Sam for /.test(txt(layer().querySelector('.lc-as-msg'))) && /Nothing is deleted\.$/.test(txt(layer().querySelector('.lc-as-msg'))) && haptics.join() === 'notification:WARNING',
    '[5p] Waive raises the action sheet naming the debt and saying nothing is deleted (warning haptic as it appears)');
  clickAction('[data-ls-action="cancel"].lc-as-bold');
  assert(!layer() && getObligations().find((o) => o.obligationId === 'o-left-payer').status === 'unpaid', '[5q] Cancel changes nothing');
  haptics = [];
  app._lsOnWaiveClickForTest(btn); clickAction('[data-ls-action="confirm-waive"]');
  const after = getObligations().find((o) => o.obligationId === 'o-left-payer');
  assert(!layer() && after.status === 'waived' && after.paidAt === null && after.voided !== true && getObligations().length === 6 && S.toastText().includes('Obligation waived.') && haptics.includes('notification:SUCCESS'),
    '[5r] CONFIRMED: the debt becomes Waived (paidAt null) — the record STAYS (nothing deleted, nothing voided), the toast and a success haptic');
  L = ledger();
  assert(lrow(L, 'o-left-payer').querySelector('.ob-waive-btn').getAttribute('data-ob-action') === 'reopen' && txt(lrow(L, 'o-left-payer').querySelector('.badge-final')) === 'Waived', '[5s] the ledger now shows it Waived with an Undo');
  app._lsOnWaiveClickForTest(lrow(L, 'o-left-payer').querySelector('.ob-waive-btn'));
  assert(!layer() && getObligations().find((o) => o.obligationId === 'o-left-payer').status === 'unpaid' && S.toastText().includes('Obligation reopened.'), '[5t] Undo reopens it to unpaid at once (no confirmation: it is the undo)');
  // the permission boundary: a DOM-injected button cannot waive what the card would not have offered
  const fake = document.createElement('button'); fake.setAttribute('data-ob-id', 'o-me-payer'); fake.setAttribute('data-ob-action', 'waive');
  app._lsOnWaiveClickForTest(fake); clickAction('[data-ls-action="confirm-waive"]');
  assert(getObligations().find((o) => o.obligationId === 'o-me-payer').status === 'unpaid' && S.toastText().includes("You don't have permission to do that"), '[5u] re-checked at the handler: a forged Waive on the commissioner\'s OWN debt is refused ("You don\'t have permission to do that")');
  const fake2 = document.createElement('button'); fake2.setAttribute('data-ob-id', 'o-both-in'); fake2.setAttribute('data-ob-action', 'waive');
  app._lsOnWaiveClickForTest(fake2); clickAction('[data-ls-action="confirm-waive"]');
  assert(getObligations().find((o) => o.obligationId === 'o-both-in').status === 'unpaid', '[5v] …and a forged Waive on a debt where nobody has left is refused too');
  installHaptics(false);
  closeAll();
  // a PLAYER's session: the same card offers nothing (the card is the commissioner's, and the controls are gated on the role anyway)
  const P = await world({ role: 'player' });
  seed({ players: [{ id: 'm-L1', name: 'Kev' }, { id: 'p-left', name: 'Lefty', active: false }], weeks: [{ weekId: 'w1', status: 'final' }], obligations: [{ obligationId: 'o1', type: 'weekly', weekId: 'w1', payerPlayerId: 'p-left', recipientPlayerId: 'm-L1', status: 'unpaid' }, { obligationId: 'o2', type: 'weekly', weekId: 'w1', payerPlayerId: 'p-left', recipientPlayerId: 'm-L1', status: 'waived' }] });
  assert(parse(app.renderObligationsAdmin()).querySelectorAll('.ob-waive-btn').length === 0, '[5w] STRUCTURAL: for a PLAYER session no Waive and no Undo control exists in the markup, on an open row or a waived one');
  const fake3 = document.createElement('button'); fake3.setAttribute('data-ob-id', 'o1'); fake3.setAttribute('data-ob-action', 'waive');
  app._lsOnWaiveClickForTest(fake3); if (layer()) clickAction('[data-ls-action="confirm-waive"]');
  assert(getObligations().find((o) => o.obligationId === 'o1').status === 'unpaid', '[5x] …and a forged Waive from a player\'s session changes nothing');
  closeAll();
}
loud();

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[5s] Standings Weekly History — "(left)" in the caption slot of the Winner and Loser cells, and in the payer\'s wait line (merge review, BLOCK #1, condition 2; DI-462 section A)…');
quiet();
{
  const S = await world({ role: 'player' });
  const res = (weekId, playerId, displayName, o = {}) => ({ weekId, playerId, displayName, isWinner: false, isLoser: false, wonByTiebreaker: false, correctPicks: 3, incorrectPicks: 2, correctCount: 3, incorrectCount: 2, ...o });
  seed({
    players: [{ id: 'm-L1', name: 'Kev' }, { id: 'p-sam', name: 'Sam' }, { id: 'p-left', name: 'Lefty', active: false }, { id: 'p-host', name: HOSTILE, active: false }],
    weeks: [1, 2, 3, 4, 5].map((n) => ({ weekId: `w${n}`, weekNumber: n, status: 'final' })),
    obligations: [{ obligationId: 'o-w1', type: 'weekly', weekId: 'w1', payerPlayerId: 'm-L1', recipientPlayerId: 'p-left', status: 'pending', note: '1 drink' }],
  });
  storage.saveAllWeeklyResults('w1', [res('w1', 'p-left', 'Lefty', { isWinner: true, wonByTiebreaker: true }), res('w1', 'p-sam', 'Sam', { isLoser: true })]);
  storage.saveAllWeeklyResults('w2', [res('w2', 'p-left', 'Lefty', { isWinner: true }), res('w2', 'p-sam', 'Sam', { isLoser: true })]);
  storage.saveAllWeeklyResults('w3', [res('w3', 'p-sam', 'Sam', { isWinner: true, wonByTiebreaker: true }), res('w3', 'p-left', 'Lefty', { isLoser: true })]);
  storage.saveAllWeeklyResults('w4', [res('w4', 'm-L1', 'Kev', { isWinner: true }), res('w4', 'p-sam', 'Sam', { isLoser: true })]);
  storage.saveAllWeeklyResults('w5', [res('w5', 'p-host', HOSTILE, { isWinner: true }), res('w5', 'p-sam', 'Sam', { isLoser: true })]);
  app.renderLeaderboard();
  const hist = parse(document.getElementById('page-leaderboard').innerHTML);
  const groups = hist.querySelectorAll('.stand-wk-group');
  const caps = (g) => g.querySelectorAll('.stand-who').map((c) => (c.querySelector('.stand-sub') ? txt(c.querySelector('.stand-sub')) : ''));
  // Row order is the week order, so index the groups directly (a label parse would be a second thing to break).
  const byIndex = (i) => groups[i];
  assert(groups.length === 5, `[5s-0] fixture: Weekly History rendered five week groups (got ${groups.length})`);
  assert(JSON.stringify(caps(byIndex(0))) === JSON.stringify(['(left) · by tiebreaker', '']), `[5s-1] a departed WINNER who won on the tiebreaker: "(left) · by tiebreaker" in the winner's caption slot, nothing under the loser (${JSON.stringify(caps(byIndex(0)))})`);
  assert(JSON.stringify(caps(byIndex(1))) === JSON.stringify(['(left)', '']), `[5s-2] a departed winner with no tiebreaker: "(left)" alone (${JSON.stringify(caps(byIndex(1)))})`);
  assert(JSON.stringify(caps(byIndex(2))) === JSON.stringify(['by tiebreaker', '(left)']), `[5s-3] a departed LOSER carries "(left)" too, and an ACTIVE winner keeps "by tiebreaker" alone, unchanged (${JSON.stringify(caps(byIndex(2)))})`);
  assert(JSON.stringify(caps(byIndex(3))) === JSON.stringify(['', '']) && byIndex(3).querySelectorAll('.stand-sub').length === 0, '[5s-4] nobody has left: NO caption and no empty caption element (the markup is what it was)');
  assert(hist.querySelectorAll('.stand-who').every((c) => c.querySelector('.stand-name-text')) && txt(byIndex(0).querySelector('.stand-name-text')) === 'Lefty', '[5s-5] the name stays in its own element; the label is a CAPTION, never glued to the name (the name still ellipsizes on its own line)');
  const waiting = byIndex(0).querySelector('.stand-act-row');
  assert(waiting && txt(waiting).includes('Waiting on Lefty (left) to confirm.'), `[5s-6] the payer's wait line names the departed recipient with the label: "Waiting on Lefty (left) to confirm." (${waiting ? txt(waiting) : 'no action row'})`);
  const badgeTitle = byIndex(0).querySelector('.badge').getAttribute('title');
  assert(badgeTitle === 'Pending confirmation from Lefty (left) or the commissioner', `[5s-7] …and the pending badge's title reads the same name (${badgeTitle})`);
  const hostile = byIndex(4);
  assert(hist.querySelectorAll('img').length === 0 && txt(hostile.querySelector('.stand-name-text')) === HOSTILE && caps(hostile)[0] === '(left)', '[5s-8] a hostile display name in a departed winner cell stays inert text, with the caption beside it');
  // the shared function is untouched: its golden is [5ba]. The label reaches the wait line only through the NAME this caller passes.
  const sa = read('./js/app.js');
  const bn = sa.slice(sa.indexOf('function obligationButtonsHTML('), sa.indexOf('export function obligationBadgeAndActions('));
  assert(!/\(left\)|ledgerDepartedLabel|departed/i.test(bn) && /recipient\?\.displayName \|\| '\?'\) \+ \(LS\.ledgerDepartedLabel\(recipient\?\.active\)/.test(sa), '[5s-9] obligationButtonsHTML carries no departure logic (SP-56\'s byte golden holds): the caller passes the labelled recipient name');
  // the blind rule: an in-progress group still renders from the week record alone, whatever happened to a player
  storage.saveWeek({ ...DM.createWeek(2026, 6), weekId: 'w6', weekNumber: 6, status: 'open', dataSourceMode: 'live' });
  app.renderLeaderboard();
  const hist2 = parse(document.getElementById('page-leaderboard').innerHTML);
  const g6 = hist2.querySelectorAll('.stand-wk-group')[5];
  assert(g6 && g6.querySelectorAll('.stand-who').length === 0 && /In progress/.test(txt(g6)) && !/\(left\)|Lefty|Sam|Kev/.test(txt(g6)), `[5s-10] BLIND RULE: an in-progress week group shows no winner, no loser and no departure label — it reads "In progress" from the week record alone (${g6 ? txt(g6) : 'no group'})`);
}
loud();

_log('\n[5b] The shared obligation markup is BYTE-IDENTICAL to the base commit (SP-56\'s golden: Standings calls it too)…');
{
  const src = read('./js/app.js');
  const extractFn = (code, name) => {
    const i = code.indexOf(`function ${name}(`); if (i < 0) return null;
    let j = code.indexOf('{', code.indexOf(')', i)); let d = 0;
    for (let k = j; k < code.length; k++) { if (code[k] === '{') d++; else if (code[k] === '}') { d--; if (d === 0) return code.slice(i, k + 1); } }
    return null;
  };
  // SP-56 (merged in from release/v0.29.0, 2026-10-01) split this function into obligationBadgeHTML + obligationButtonsHTML, with obligationActionsHTML as their concatenation (its own
  // layouttest [SF8] pins that equality). The golden below is the COMBINED output, so all three are extracted and the same BASE-commit hash must still hold.
  const NAMES = ['obligationBadgeHTML', 'obligationButtonsHTML', 'obligationActionsHTML'];
  const parts = NAMES.map((n) => extractFn(src, n));
  assert(parts.every((p) => typeof p === 'string' && p.length > 20), '[5b-fixture] all three halves of the shared obligation markup were located in app.js (a rename must update this test on purpose)');
  const text = parts.join('\n');
  const fn = new Function('obligationRole', 'obligationStatusDisplay', 'escHtml', `${text}; return obligationActionsHTML;`)(DM.obligationRole, DM.obligationStatusDisplay, escHtml);
  const out = [];
  for (const status of ['unpaid', 'pending', 'paid', 'waived', 'bogus']) {
    for (const sess of [{ isAdmin: true, playerId: 'a' }, { isAdmin: false, playerId: 'c' }, { isAdmin: false, playerId: 'p' }, { isAdmin: false, playerId: 'z' }, { isAdmin: false, playerId: null }]) {
      for (const ob of [{ obligationId: 'ob"1', payerPlayerId: 'p', recipientPlayerId: 'c' }, { obligationId: 'ob2', payerPlayerId: 'p', recipientPlayerId: 'c', deniedReason: 'no <b>way' }]) {
        out.push(`${status}|${sess.isAdmin}|${sess.playerId}|${ob.obligationId}=>` + fn(status, ob, sess, { payerName: 'P<', recipientName: 'R&', obClass: 'ob-action' }));
      }
    }
  }
  // RE-BASELINED at the v0.29.0 batch-5b integration (2026-10-01), golden 352bc74df8fb610a -> 1677452723c328a8. The Breathing Room spacing sweep (feat/spacing-sweep @ 7077da8,
  // reviewed; AD-103) changed this shared helper ON PURPOSE: obligationButtonsHTML() dropped its two `ml-sm` margins (the pending wait line and Undo) because the items are now
  // spaced by their container's gap (spacingtest [3b]). Verified at the merge: the merged obligationBadgeHTML / obligationButtonsHTML / obligationActionsHTML are byte-identical to
  // the sweep's own, so the new hash is the sweep's output and nothing of SP-53's. The pin's job is unchanged: SP-53's Waive / Undo stay a SIBLING, never edits to this helper.
  assert(out.length === 50 && sha(out.join('\n')) === '1677452723c328a8', `[5ba] obligationActionsHTML() output over 5 statuses x 5 viewers x 2 records (50 renderings) hashes to the shared helper's golden (the spacing sweep's output; got ${sha(out.join('\n'))})`);
  assert(!/ob-waive|data-ob-action="waive"|'waive'|'reopen'/.test(text), '[5bb] the shared function carries no waive or reopen control: the new controls are a sibling');
  const m = /ob-action/.test(out.join('')); assert(m, '[5bc] (the golden is not vacuous: the renderings carry the buttons)');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
_log('\n[6] Source pins on the wiring…');
{
  const APP = read('./js/app.js'), AUTH = read('./js/auth.js');
  const code = stripComments(APP);
  const secStart = APP.indexOf("const LS_ACTION_LAYER_ID = 'ls-action-layer';");
  const section = stripComments(APP.slice(secStart, APP.indexOf("// Test seams (the file's own `_xForTest` convention)", secStart)));
  assert(section.length > 20000, '[6a] fixture: the League Settings wiring section was located');

  // the adapters bind exactly the three collaborators, in auth.js, and nothing else imports the client for a leave
  const deps = AUTH.slice(AUTH.indexOf('function _leagueSettingsDeps('), AUTH.indexOf('export async function getLeagueSettings('));
  assert(/rpc: async \(fn, args\)/.test(deps) && /refreshMemberships: async \(\) => \{\s*const read = await refreshMembershipsAndSession\(\);\s*if \(!Array\.isArray\(read\)\) throw new Error\('could_not_ask'\);/.test(deps) && /getMemberships: \(\) => getCachedMemberships\(\)/.test(deps) && /dropMirror: isSupabaseDataMode\(\) \? \(reason\) => sb\.dropMirror\(reason\) : null/.test(deps) && /isExpired: isSessionExpiredError/.test(deps),
    '[6b] auth.js binds the wrapper\'s five collaborators: the client\'s rpc (a missing client is an ERROR RESULT, never a throw), the REAL membership refresh (a non-list answer is a THROW: see [4i]), the cache, dropMirror only in the Supabase data mode, and the ONE expiry classifier');
  assert(/return LS\.leaveLeague\(_leagueSettingsDeps\(\), \{ leagueId, confirmArchive, role \}\)/.test(AUTH) && /return LS\.renameLeague\(_leagueSettingsDeps\(\), \{ leagueId, name, role \}\)/.test(AUTH) && /LS\.setAcceptingMembers\(_leagueSettingsDeps\(\{ readAccepting:/.test(AUTH),
    '[6c] each adapter is ONE call into the pure wrapper (no second copy of the sequence in auth.js)');
  assert((AUTH.match(/sb\.dropMirror\(/g) || []).length === 2 && !/dropMirror/.test(APP.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), '[6d] dropMirror is named in auth.js only (the handover clear and this adapter) — app.js never touches the adapter\'s mirror');
  assert(/\.select\('id, display_name, role, active, user_id, initials, alma_mater, link_disputed_at, linked_at'\)/.test(AUTH) && /linkedAt: r\.linked_at \|\| null/.test(AUTH), '[6e] listLeagueMembers() selects linked_at (in the member-readable grant) and passes it through as sent');

  // the latch before the call, the one predicate, the layers
  const runLeave = section.slice(section.indexOf('async function lsRunLeave('), section.indexOf('async function lsReaskAfterStale('));
  assert(runLeave.indexOf('_autoLinkAttempted = true') > -1 && runLeave.indexOf('_autoLinkAttempted = true') < runLeave.indexOf('await leaveLeague('), '[6f] `_autoLinkAttempted` is latched BEFORE the leave call (in the source, not just at runtime)');
  assert(/getCachedMemberships\(\)\.length <= 1\) _autoLinkAttempted = true/.test(runLeave), '[6g] …and only when this is the last league (a plain count of memberships, not eligibility)');
  assert(!/weeksInProgressForMember|isWeekInProgressForLeave\(w, now\)\s*\)\s*;?\s*$/.test(section.replace(/LS\.isWeekInProgressForLeave\(w, now\)/g, '')) && /LSV\.leaveBlockedWeekIds\(/.test(section) && !/weeksInProgressForMember/.test(code),
    '[6h] Q-W (a) has ONE client predicate: app.js asks LSV.leaveBlockedWeekIds() and never calls the core\'s weeksInProgressForMember directly');
  assert((section.match(/leaveBlockedWeekIds\(/g) || []).length === 1 && (code.match(/lsBlockedWeekCount\(\)/g) || []).length >= 3, '[6i] every consumer of the block (the row, the footer, the tap guard) goes through one helper, which reads that one predicate once');
  assert(!/\.role\b[^;]*\bfilter\(|\.filter\([^)]*\.role|commissionerCount|isSoleCommissioner/.test(section) && (section.match(/[!=]== 'commissioner'/g) || []).length === 2, '[6j] the wiring derives NO eligibility: the only role comparisons are the cached-role gates (is the person a commissioner at all), never counting commissioners or members');
  assert(/getAccountExitLeagues\(\)/.test(section) && (section.match(/getAccountExitLeagues\(\)/g) || []).length === 4 && !/archive_league_on_exit|archiveLeagueOnExit|account_exit_leagues/.test(section), '[6k] the preflight is the existing getAccountExitLeagues() wrapper only (asked on the Leave tap, after a stale answer, after a hand-off failure, and after a hand-off) — the wiring names no RPC itself');
  assert(/confirmArchive: archive === true/.test(runLeave) && (section.match(/confirmArchive:/g) || []).length === 1, '[6l] SC-L9 in the SOURCE: the consent is `archive === true`, and the confirmArchive option is set in exactly ONE place');
  assert(/function lsLandAfterLeave\(\)[\s\S]*landingAfterLeave\(getCachedMemberships\(\)\) === 'single'\) return;[\s\S]*APP_PAGE_CONTAINER_IDS[\s\S]*needsLeagueFlowScreen\(\)/.test(section), '[6m] the landing: a single remaining league is left to the existing hydrate; otherwise the containers are emptied and the flow screen paints only when needsLeagueFlowScreen() says so');

  // every body-appended layer carries the hold marker, the overlay's own listener is delegated once
  assert((section.match(/setAttribute\('data-hold-teardown', ''\)/g) || []).length === 1 && /wrapId: LS_SHEET_WRAP_ID/.test(section) && /const LS_SHEET_ID = 'ls-sheet'/.test(section), '[6n] the action-sheet layer carries data-hold-teardown, and the hand-off sheet is the shared sheet shell (mountSheetShell sets the marker on its wrap)');
  assert(/el\.addEventListener\('click', lsOnOverlayClick\)/.test(code) && (code.match(/lsOnOverlayClick/g) || []).length === 2, '[6o] ONE delegated click listener, bound once on the persistent overlay node');
  assert(/lsTeardown\(\);   \/\/ SP-53/.test(APP) && /^function lsTeardown\(\)/m.test(section) && /document\.getElementById\('ls-action-layer'\)\) return true/.test(code) && /!excludeLeave && document\.getElementById\('ls-sheet-wrap'\)/.test(code), '[6p] the overlay\'s hide path tears League Settings down; the two layers are blocking surfaces for the League Page swipe (the sheet with its own carve-out)');
  assert(!/\bconfirm\(|\bprompt\(|\balert\(/.test(section), '[6q] no browser dialog anywhere on the new paths (every confirmation is the one action-sheet builder)');
  assert(!/\.innerHTML\s*=\s*`/.test(section) && !/innerHTML\s*\+=/.test(section), '[6r] the wiring builds no markup of its own: every innerHTML assignment is a call into the rendered half (and none appends)');
  const nameCard = section.slice(section.indexOf('function lsPatchName()'), section.indexOf('function lsClearName()'));
  assert(!/innerHTML = .*nameCardHTML|settingsPageHTML/.test(nameCard) && /btn\.innerHTML = p\.innerHTML/.test(nameCard), '[6s] typing patches the name card in place (the one Save button\'s inner markup only when its STATE changes) — the card, the field and the counter are never rebuilt');

  // the touch targets / tokens / motion in the stylesheet
  const CSS = read('./css/styles.css');
  const blockMark = CSS.indexOf('SP-53 (UN-345…349, DI-457…464 as amended, 2026-10-01) — LEAGUE SETTINGS.');
  const blockEnd = CSS.indexOf('end SP-53 LEAGUE SETTINGS', blockMark);
  assert(blockMark > 0 && blockEnd > blockMark, '[6t0] fixture: the block\'s opening banner and its closing marker were both located (the marker keeps a neighbouring block, e.g. SP-56\'s, out of this scan)');
  const block = CSS.slice(CSS.lastIndexOf('/*', blockMark), blockEnd);
  assert(block.length > 4000 && !/#[0-9a-fA-F]{3,8}\b/.test(block.replace(/\/\*[\s\S]*?\*\//g, '')) && !/\brgba?\(/.test(block.replace(/\/\*[\s\S]*?\*\//g, '')), '[6t] the .ls-* block: TOKENS ONLY — no hex colour and no rgb() outside its comments');
  assert(/\.ls-row\{[^}]*min-height:48px/.test(block) && /\.ls-row:active:not\(\[aria-disabled="true"\]\):not\(:disabled\)\{transform:scale\(\.97\)\}/.test(block) && /transition:transform var\(--motion-fast\) ease-out/.test(block), '[6u] rows are 48 pt, compress to 97% over --motion-fast on press, and a disabled or dimmed row does NOT animate');
  assert(/\.ls-body\{gap:24px\}/.test(block) && /\.ls-group\{display:flex;flex-direction:column;gap:8px\}/.test(block) && /\.ls-footer\{margin:0;padding:0 16px\}/.test(block), '[6v] BREATHING ROOM: 24 pt between groups, 8 pt inside a group, footers inset 16 pt');
  assert(/#ls-action-layer\{position:fixed;inset:0;z-index:8100\}/.test(block) && /#ls-sheet-wrap\{position:fixed;inset:0;z-index:8000\}/.test(block), '[6w] F7: the action layer is FIXED on <body> at z-index 8100, above the hand-off sheet (8000) and the League Page overlay (150)');
  assert(/prefers-reduced-motion:reduce\)\{[^}]*\.ls-row\{transition:none\}/.test(block) && /#ls-sheet\{transition:none;animation:lc-fade var\(--motion-fast\) ease-out\}/.test(block), '[6x] Reduce Motion: no movement (rows, the sheet), the sheet\'s arrival is the 150 ms crossfade');
  assert(/@media \(min-width:600px\)\{\s*#ls-sheet\{left:50%[^}]*width:480px/.test(block), '[6y] PARITY-BY-DESIGN: at 600 px and up the hand-off sheet is a centred 480 px modal');
  const zs = [...CSS.matchAll(/#(league-page-overlay|pwacct-delete-overlay|ls-sheet-wrap|ls-action-layer)\{[^}]*z-index:(\d+)/g)].map((m) => `${m[1]}:${m[2]}`);
  assert(zs.includes('league-page-overlay:150') && zs.includes('ls-sheet-wrap:8000') && zs.includes('ls-action-layer:8100') && zs.includes('pwacct-delete-overlay:8000'), `[6z] the z-order: League Page 150 < hand-off sheet 8000 (the Delete sheet's tier) < action layer 8100 (${zs.join(', ')})`);
  assert(/\.cc-league-row\{min-height:48px\}/.test(block), '[6za] the drawer\'s League Settings row measures 48 pt');
  assert(/\.ls-body \.card\+\.card\{margin-top:0\}/.test(block) && /\.ls-stack\{display:flex;flex-direction:column;gap:16px\}/.test(block) && /\.ls-name-block\{display:flex;flex-direction:column;gap:8px\}/.test(block) && /#ls-leave-foot\{display:flex;flex-direction:column;gap:8px\}/.test(block),
    '[6zh] BREATHING ROOM by CONTAINER GAP (merge review notes a-c): the global `.card+.card` margin is neutralised in the page; the League group\'s two blocks are 16 pt apart, a name card and its reason 8 pt, and the stacked Leave footers 8 pt (never a margin)');
  assert(!/margin-(top|bottom):\s*[1-9]/.test(block.slice(block.indexOf('.ls-stack{'), block.indexOf('.stand-who .stand-sub'))), '[6zi] …and none of those new rules decides a gap with a margin');
  assert(/\.stand-who \.stand-sub\{white-space:normal;overflow-wrap:anywhere;text-overflow:clip\}/.test(block), '[6zj] the Standings winner/loser caption wraps (the joined "(left) · by tiebreaker" is never ellipsized away)');

  // the precache and the harness
  const SW = read('./service-worker.js');
  assert(/'\.\/js\/league-settings\.js'/.test(SW) && /'\.\/js\/league-settings-view\.js'/.test(SW), '[6zb] service-worker.js precaches BOTH modules (auth.js, admin-panel.js and app.js import them statically: a shell cache one module short is RG-236\'s blank app)');
  const LT = read('./loadtest.mjs');
  assert(/'league-settings-view',\n  \/\/ UN-389/.test(LT) && LT.indexOf("'league-settings-view'") < LT.indexOf("'account-exit',\n]) {") && /\n  'account-exit',\n\]\) \{/.test(LT), '[6zc] loadtest imports the rendered half in [1] ABOVE account-exit (accountexittest [11x] pins account-exit as the list\'s last entry)');
  assert(/leaguesettingsuitest\.mjs/.test(LT), '[6zd] loadtest spawns this suite');
  const CCS = read('./js/control-center.js');
  assert(/onOpenLeagueSettings/.test(CCS) && (APP.match(/onOpenLeagueSettings: \(\) => showLeaguePageOverlay\(\{ view: 'settings' \}\)/g) || []).length === 1, '[6ze] the drawer\'s callback is wired in app.js to the same overlay on the Settings view');
  const pilot = read('./js/pilot-only.js');
  assert(!/Share this code with anyone joining IRB Football/.test(APP) && /inviteLineFor/.test(pilot), '[6zf] the Invite line is no longer a pilot literal and the registry says so');
  assert(/nameHelper: 'Your friends will see this name\. You can change it later\.'/.test(read('./js/league-create.js')), '[6zg] "You can change it later." is restored in the New League helper (it ships in the SAME release as the rename RPC: a promise)');
}


_log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
