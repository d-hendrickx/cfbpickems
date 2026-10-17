#!/usr/bin/env node
/**
 * CFB Pickems — whatsnewtest.mjs (v0.30.0 release cut, 2026-10-14)
 * ================================================================
 * The in-app release notes for v0.30.0 (Deployment 1), pinned against the REAL constant (js/app.js `_whatsNewForTest()`), the REAL renderers
 * and the REAL copy tables of the modules each line points at — not against a fixture. Until this file, nothing asserted what a shipped entry SAYS: loadtest [82]
 * only proves that no entry carries a placeholder and that the newest entry's version/date match APP_VERSION.
 *
 * RE-PINNED 2026-10-14 from v0.29.0 to v0.30.0 against the copy Drew approved on 2026-10-14 (M-47: all 23 lines, the NFL line kept). Nothing was loosened: the
 * version/date/stamp checks, the 90-character headline cut, the banned-words check and the internal-ID check all carry over; the banned list only GREW (the features that
 * ship OFF or dormant in this release are named in it), and the v0.29.0 entry and its privacy line are now pinned as intact history.
 *
 * RE-PINNED 2026-10-15 (deploy day, D-87) for two approved lines (Drew, D-91: "Join nudge line, Privacy line") and the deploy date: `added` goes from 14 to 16 lines, `fixed`
 * stays at 9 (25 lines in all); APP_VERSION_DATE and the entry's date are 2026-10-15. The privacy line was HELD (it said nothing until the policy page shipped with the
 * deploy) and is now REQUIRED: RD-01 v4.0.0 is published with this release (Drew, M-57/D-90: "Approve RD-01 v4.0.0-draft.1"; privacytest pins the page), so the entry must
 * carry the line exactly once, verbatim, and never as the headline. v0.29.0's News-from-ESPN privacy line stays pinned as intact history and must not be in this entry.
 *
 * RE-PINNED 2026-10-17 from v0.30.0 to v0.30.1 (W-92, the Home feed fix; Drew "approve M-61"). v0.30.1 carries ONE line, the coordinator's, which Drew sees before
 * the deploy: "Home combines cards from the same moment and shows when each one happened." It is pinned exactly (one `added`, no `fixed`, uncut as the SCRIBE
 * headline, no privacy line — the policy did not change). Nothing about v0.30.0 was loosened: every one of its pins and every one of its mutants still runs, now
 * against R[1] as intact HISTORY (problemsV030), the way v0.29.0 was carried when v0.30.0 shipped; v0.29.0 moves to R[2].
 *
 * WHAT IS PINNED
 *   [1] The four version strings agree (APP_VERSION, index.html's three ?v=, service-worker CACHE_NAME, derived from one another) and the entry is the newest one.
 *   [2] The entry is exactly the approved copy: 16 added lines and 9 fixed lines, each verbatim and in order (a line dropped, reworded, added or reordered fails by name).
 *   [3] The headline (the first `added` item, SCRIBE's chat-post headline) is within the 90-character cut; the privacy line is REQUIRED (the policy page ships with this
 *       release): present exactly once, verbatim, not first, and v0.29.0's older privacy line is not carried in.
 *   [4] Coupled to what the app really says: Game Day, Who's in, the Sort labels, Add a sport, Share to chat, Find spreads and its "not yet on" clause, the stall notice, the slate
 *       add-or-swap choice, the Finalize steps, the red sync banner's title, the five-tab bar, the chat time footer.
 *   [5] History: v0.29.0 sits right behind it, intact, with its privacy line exactly once; v0.28.0's two web-overpromising lines still read as iPhone-app items.
 *   [6] Both renderers show the entry (the Picks card is closed; the Rules history opens it) and escape it.
 *   [7] TEETH: the same checks run in memory against mutants (a line dropped / reworded / added, the privacy line dropped / reworded / made the headline / doubled / v0.29.0's carried in, a feature that ships OFF announced, an internal
 *       ID, a placeholder or stale date, a headline cut past 90, a lock-job claim, a haptics claim) and each must FAIL.
 *
 * Run:  node whatsnewtest.mjs   (and under TZ=UTC / TZ=America/Los_Angeles; spawned by loadtest.mjs [139])
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

// ── DOM / localStorage stubs — requesttest.mjs's shape, trimmed to what importing app.js and the two pure renderers touch. ────────────────────
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};
const els = new Map();
function mkEl(id) {
  const e = {
    id, _html: '', dataset: {}, style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
    insertAdjacentHTML(pos, h) { this._html = pos === 'afterbegin' ? h + this._html : this._html + h; },
    appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    scrollTo() {}, focus() {},
  };
  els.set(id, e);
  return e;
}
['page-rules', 'page-commissioner', 'page-picks'].forEach(mkEl);
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: id => els.get(id) || null,
  querySelector: () => null, querySelectorAll: () => [],
  createElement: () => mkEl('tmp'),
  body: { classList: { add() {}, remove() {}, toggle() {} }, dataset: {}, appendChild() {}, innerHTML: '' },
  hidden: false,
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined }, configurable: true }); }
globalThis.requestAnimationFrame = fn => fn();
globalThis.matchMedia = () => ({ matches: false });
globalThis.confirm = () => true;
globalThis.prompt = () => null;
globalThis.alert = () => {};
globalThis.scrollTo = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'u_' + Math.random().toString(36).slice(2) };
globalThis.fetch = async () => { throw new Error('network disabled in whatsnewtest'); };

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass += 1; console.log('  ✅', label); }
  else { fail += 1; console.log('  ❌', label); }
}

console.log(`\n[TZ=${process.env.TZ || '(system default)'}] whatsnewtest.mjs — the v0.30.1 release notes (v0.30.0 pinned as history)\n`);

const app = await import('./js/app.js');
const live = app._whatsNewForTest();
const R = live.releases;
const NOW = R[0];        // v0.30.1 (W-92) — the release under test
const V030 = R[1];       // v0.30.0 — intact history: every pin below that names v0.30.0 runs against it
const PREV = R[2];       // v0.29.0
const W92_LINE = 'Home combines cards from the same moment and shows when each one happened.';

// v0.29.0's privacy line (RD-01 v3.0.0, R-C14) — now HISTORY: pinned below as still intact in the v0.29.0 entry, and ABSENT from v0.30.0's.
const PRIVACY_LINE_V029 = "The privacy policy has been updated to cover News, which loads headlines straight from ESPN. You'll find it at the bottom of the menu.";

// ── THE APPROVED COPY, VERBATIM (Drew, 2026-10-14, M-47: "all 23 lines, NFL line kept"; plus the join-nudge and privacy lines, 2026-10-15, D-91). [name, text] — the name is what a failure prints. ───────────────────────────────────────
// Template literals on purpose: no line contains a backtick or a ${ — every apostrophe and the two double quotes are the literal characters the player reads.
const ADDED_PIN = [
  ['game-day-headline', `Game Day is on Home: the live games, your week and your rank, on one card.`],
  ['game-view-and-back', `Tap a game or a Home card for its own screen: the live score and spread, picks once they're revealed, and the game's chat thread. Back takes you to where you were.`],
  ['whos-in', `Who's in, on Picks and Dashboard, shows who has submitted their picks and never what they picked. The Locker Room posts a line as each person gets their picks in.`],
  ['live-tiebreak', `The weekly ranking and the alma mater tiebreaker now move on their own as scores come in, without anyone pressing Calculate.`],
  ['dashboard-sort', `Dashboard has a Sort button: Kickoff time, Live first or Custom, where you hold a game and drag it into place.`],
  ['league-overview', `Tap the league name for the league overview: your sports, what is due and when, what is live, and Add a sport for commissioners.`],
  ['nfl-sport', `NFL, for leagues that add it: commissioners add it from the league name, members join it from the same sheet, and each sport gets its own Picks, Dashboard and Standings, with sport pills in the Locker Room.`],
  ['compare-and-week-detail', `Standings: tap a player to compare picks and seasons head to head, or tap a week in Weekly History for its games and results.`],
  ['share-to-chat', `Share to chat: from a Home card, a game, a week or a comparison, send it to the Locker Room as one message, with a comment if you like.`],
  ['chat-times-home-mark', `Chat times now sit under each message, and the Home button in the centre of the bar carries the full Munera mark.`],
  ['stall-notice', `An amber notice appears when a sport's live scores stall. Players are told scores are delayed and picks still lock as normal; commissioners see the cause.`],
  ['slate-add-or-swap', `Commissioners: adding a game to a full slate asks whether to add it as an extra game or swap it for one already on the slate, and Comm → Games is now one list with Remove on each game's row.`],
  ['comm-swipes', `Commissioners: swipe down to close the Week Wizard, swipe sideways to move between its steps, and swipe sideways to change Comm tabs.`],
  ['find-spreads', `Commissioners: Find spreads (Comm → Games) re-checks ESPN for any slate game still missing a spread. Checking other sources too is not yet on.`],
  ['join-nudge', `In a league with more than one sport, Home shows how the sports you're not in are going, with a Join button when you want in.`],
  ['privacy', `The privacy policy has been updated to cover how SCRIBE looks up football questions and where News headlines come from. You'll find it at the bottom of the menu.`],
];
const FIXED_PIN = [
  ['lock-everywhere', `Picks now lock at the stated time everywhere: the Open and Locked badge, the countdown and the Picks page flip together, and a late edit is turned away.`],
  ['home-newest-first', `Home puts the newest card first, its summary now covers every live game, and SCRIBE posts on Home say what they are about. Casual banter stays in Chat.`],
  ['logos', `Team logos show in Game Day and no longer blank out when scores refresh.`],
  ['payments', `Players can mark a payment paid, confirm it or deny it, and it saves. A denial's reason shows under Unpaid.`],
  ['finalize-guided', `Commissioners: Finalize Week now walks through approving scores, confirming the tiebreaker and the longest field goal before it finalizes, and no longer trips the red "Cross-device sync is OFF" error.`],
  ['scribe-ask-slate', `Ask SCRIBE about a game on the slate and it now knows the teams, the score and whether the game is live.`],
  ['scribe-callout', `SCRIBE's call-out before picks lock no longer depends on push notifications: it posts to the Locker Room once a week and leaves out anyone who has already submitted.`],
  ['notifications-row', `After you switch leagues, the notifications row in the menu shows the new league's setting right away.`],
  ['request-a-game', `Request a Game: Find games now shows the games it finds, and swiping the Saturday chips no longer fights the swipe that opens the menu.`],
];

// The privacy line for THIS release (RD-01 v4.0.0 publishes with it). Pulled from the pin so there is one source for the words.
const PRIVACY_LINE_V030 = ADDED_PIN.find(([n]) => n === 'privacy')[1];

// The banned-words check. The first seven are v0.29.0's own list, carried over unchanged. The rest name what this release ships OFF or dormant, or does not ship at all
// (the release comment in js/app.js and the draft's "Not mentioned" table are the source): the news collector and its publishers, the Home content cards, SCRIBE's final-hour
// call-out and scan, the spread lookup from other sources, league creation, the push-address migration, the server lock job (held line C3), Request a Game for NFL, and
// anything about the iPhone app (it gets none of this until a TestFlight build, and no line claims haptics).
const UNSHIPPED = new RegExp([
  'server-side', 'who (has|have) picked', 'create a league', 'league creation', 'multi-sport', 'multisport',
  'news collector', '\\b(CBS|Yahoo|NBC)\\b', 'Sports Illustrated', 'NCAA\\.com',
  'team facts', 'player previews?', 'storyline', 'spotlight', 'history callback',
  'final[- ]hour', 'non-participation',
  'DraftKings', 'FanDuel', 'BetMGM', 'Caesars',
  'push[- ]address',
  'locks? on the server', 'server lock', 'lock job',
  'Request a Game[^.]*\\bNFL\\b', '\\bNFL\\b[^.]*Request a Game',
  'haptic', 'TestFlight', 'iPhone',
].join('|'), 'i');

/** Every property this suite pins about the v0.30.0 entry (HISTORY since v0.30.1), as named failures. [] means the entry is as it shipped on 2026-10-16. */
function problemsV030(rel) {
  const out = [];
  const added = Array.isArray(rel?.added) ? rel.added : [];
  const fixed = Array.isArray(rel?.fixed) ? rel.fixed : [];
  const all = [...added, ...fixed];
  if (rel?.version !== 'v0.30.0') out.push('version');
  if (rel?.date !== '2026-10-16') out.push('date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(rel?.date))) out.push('date-format');
  for (const [name, text] of ADDED_PIN) if (!added.includes(text)) out.push(name);
  for (const [name, text] of FIXED_PIN) if (!fixed.includes(text)) out.push(name);
  if (JSON.stringify(added) !== JSON.stringify(ADDED_PIN.map(([, t]) => t))) out.push('added-list-exact');
  if (JSON.stringify(fixed) !== JSON.stringify(FIXED_PIN.map(([, t]) => t))) out.push('fixed-list-exact');
  if (!(added[0] && added[0].length <= 90 && /^Game Day is on Home/.test(added[0]))) out.push('headline-is-game-day-and-uncut');
  // The privacy line is REQUIRED (the policy page ships with this release): exactly one line in the whole entry mentions the policy, it is the approved one, it is in `added`,
  // it is not the headline, and v0.29.0's older News-from-ESPN line is not carried in.
  const privacyLines = all.filter(b => /privacy/i.test(b));
  if (!(privacyLines.length === 1 && privacyLines[0] === PRIVACY_LINE_V030 && added.includes(PRIVACY_LINE_V030))) out.push('privacy-line');
  if (added.indexOf(PRIVACY_LINE_V030) === 0 || (added[0] && /privacy/i.test(added[0]))) out.push('privacy-not-headline');
  if (all.includes(PRIVACY_LINE_V029)) out.push('privacy-stale');
  if (all.some(b => UNSHIPPED.test(b))) out.push('announces-unshipped');
  if (all.some(b => /\b(UN|PF|DI|SB|SP|RG|AD|DO|VT|FB|TP|PM)-\d+\b|\bDI-W\d+|\b[WMDNT]-\d{2,3}\b/.test(b))) out.push('internal-id');
  if (all.some(b => /RELEASE-EDIT|\bXX\b/.test(b)) || /XX/.test(String(rel?.date))) out.push('placeholder');
  if (rel?.expanded === true) out.push('expanded-flag');
  return out;
}

/** W-92: everything pinned about the v0.30.1 entry. ONE approved line, in `added` (so it is SCRIBE's chat-post headline, uncut), nothing in `fixed`, no privacy line. */
function problems(rel) {
  const out = [];
  const added = Array.isArray(rel?.added) ? rel.added : [];
  const fixed = Array.isArray(rel?.fixed) ? rel.fixed : [];
  const all = [...added, ...fixed];
  if (rel?.version !== app.APP_VERSION) out.push('version');
  if (rel?.date !== app.APP_VERSION_DATE) out.push('date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(rel?.date))) out.push('date-format');
  if (!added.includes(W92_LINE)) out.push('w92-line');
  if (JSON.stringify(added) !== JSON.stringify([W92_LINE])) out.push('added-list-exact');
  if (JSON.stringify(fixed) !== '[]') out.push('fixed-list-exact');
  if (!(added[0] && added[0].length <= 90 && added[0] === W92_LINE)) out.push('headline-uncut');
  if (all.some(b => /privacy/i.test(b))) out.push('privacy-line');
  if (all.some(b => UNSHIPPED.test(b))) out.push('announces-unshipped');
  if (all.some(b => /\b(UN|PF|DI|SB|SP|RG|AD|DO|VT|FB|TP|PM)-\d+\b|\bDI-W\d+|\b[WMDNT]-\d{2,3}\b/.test(b))) out.push('internal-id');
  if (all.some(b => /RELEASE-EDIT|\bXX\b/.test(b)) || /XX/.test(String(rel?.date))) out.push('placeholder');
  if (rel?.expanded === true) out.push('expanded-flag');
  return out;
}

/** The cache-bust stamps as named failures: index.html's three ?v= references and service-worker.js's CACHE_NAME must all be the tag APP_VERSION derives ('v0.30.0' -> '30-0'). */
function stampProblems({ html, sw, version }) {
  const out = [];
  const tag = String(version).replace(/^v0\./, '').replace('.', '-');
  const refs = html.match(/\?v=\d[\d-]*/g) || [];
  if (refs.length !== 3) out.push('html-ref-count');
  if (refs.some(r => r !== `?v=${tag}`)) out.push('html-ref-value');
  if (!sw.includes(`const CACHE_NAME = 'cfb-pickems-v${tag}';`)) out.push('cache-name');
  return out;
}

console.log('[1] Stamps — one release, one version, one date, newest first…');
{
  const html = readFileSync(join(HERE, 'index.html'), 'utf8');
  const sw = readFileSync(join(HERE, 'service-worker.js'), 'utf8');
  const tag = String(app.APP_VERSION).replace(/^v0\./, '').replace('.', '-');   // DERIVED from APP_VERSION, so the stamps cannot all be pinned to the same wrong literal
  assert(app.APP_VERSION === 'v0.30.1' && app.APP_VERSION_DATE === '2026-10-17', `[1a] APP_VERSION is v0.30.1 and APP_VERSION_DATE is 2026-10-17, the deploy day (got ${app.APP_VERSION}, ${app.APP_VERSION_DATE})`);
  assert(NOW?.version === 'v0.30.1' && NOW?.date === '2026-10-17' && NOW?.date === app.APP_VERSION_DATE, `[1b] WHATS_NEW_RELEASES[0] is the v0.30.1 entry dated 2026-10-17, equal to APP_VERSION_DATE (got ${NOW?.version}, ${NOW?.date})`);
  assert(V030?.version === 'v0.30.0' && PREV?.version === 'v0.29.0' && R[3]?.version === 'v0.28.0', `[1c] the entries behind it are v0.30.0, v0.29.0 then v0.28.0 — newest first, nothing dropped (got ${V030?.version}, ${PREV?.version}, ${R[3]?.version})`);
  assert(tag === '30-1' && stampProblems({ html, sw, version: app.APP_VERSION }).length === 0, `[1d] index.html carries ?v=30-1 in exactly three places (styles.css, app.js, service-worker registration) and service-worker.js CACHE_NAME is cfb-pickems-v30-1 — the tag APP_VERSION derives (${tag}); problems: ${stampProblems({ html, sw, version: app.APP_VERSION }).join(', ') || 'none'}`);
  assert(!/\?v=30-0/.test(html) && !/cfb-pickems-v30-0/.test(sw) && /<link rel="stylesheet" href="css\/styles\.css\?v=30-1"/.test(html) && /<script type="module" src="js\/app\.js\?v=30-1"><\/script>/.test(html) && /setupServiceWorker\(\{ scriptUrl: 'service-worker\.js\?v=30-1' \}\)/.test(html), '[1e] no 30-0 is left anywhere, and the three references are the stylesheet link, the app.js module and the service-worker registration');
  assert(live.shown.length >= 1 && live.shown[0] === NOW && live.shown.length === 1, `[1f] the Picks card shows v0.30.1 first and alone — no older release still carries the one-release 'expanded' flag (shown: ${live.shown.map(r => r.version).join(', ')})`);
}

console.log('\n[2] The entry as shipped is exactly the copy Drew approved…');
{
  const p0 = problems(NOW);
  assert(p0.length === 0 && NOW.added.length === 1 && NOW.fixed.length === 0 && NOW.added[0] === W92_LINE, `[2-v0301] v0.30.1 is exactly the one approved line, in \`added\`, nothing in \`fixed\` (problems: ${p0.join(', ') || 'none'})`);
  const p = problemsV030(V030);
  assert(p.length === 0, `[2a] problemsV030(v0.30.0) is empty — the history entry is as it shipped (got: ${p.join(', ') || 'none'})`);
  assert(V030.added.length === 16 && V030.fixed.length === 9, `[2b] v0.30.0 keeps sixteen added lines and nine fixed lines (got ${V030.added.length} / ${V030.fixed.length})`);
  assert(JSON.stringify(V030.added) === JSON.stringify(ADDED_PIN.map(([, t]) => t)) && JSON.stringify(V030.fixed) === JSON.stringify(FIXED_PIN.map(([, t]) => t)), '[2c] every line is verbatim and in the approved order');
  assert(new Set([...V030.added, ...V030.fixed]).size === 25 && !V030.added.some(b => V030.fixed.includes(b)) && !V030.added.includes(W92_LINE), '[2d] v0.30.0: 25 distinct lines, none duplicated across `added` and `fixed`, and the v0.30.1 line was not slipped into it');
}

console.log('\n[3] The headline is uncut; the privacy line is required, once, and not first…');
{
  assert(NOW.added[0].length <= 90 && NOW.added[0] === W92_LINE, `[3a] v0.30.1's first item (SCRIBE's chat-post headline) is the approved line and within the 90-character cut, so it posts uncut (${NOW.added[0].length} characters)`);
  assert(![...NOW.added, ...NOW.fixed].some(b => /privacy/i.test(b)), '[3a2] v0.30.1 says nothing about the privacy policy (it did not change; v0.30.0\'s line is history)');
  assert(V030.added[0].length <= 90 && /^Game Day is on Home/.test(V030.added[0]) && V030.added[0] === ADDED_PIN[0][1], '[3b] v0.30.0 still leads with the Game Day line, uncut');
  const privAt = V030.added.indexOf(PRIVACY_LINE_V030);
  assert([...V030.added, ...V030.fixed].filter(b => /privacy/i.test(b)).length === 1 && privAt > 0 && V030.fixed.indexOf(PRIVACY_LINE_V030) === -1, `[3c] exactly one line says the privacy policy changed (RD-01 v4.0.0 ships with this deploy), it is the approved one, it sits in \`added\` at position ${privAt + 1} of ${V030.added.length}, and it is not first`);
  assert(!V030.added.includes(PRIVACY_LINE_V029) && !V030.fixed.includes(PRIVACY_LINE_V029) && /how SCRIBE looks up football questions/.test(PRIVACY_LINE_V030) && /where News headlines come from/.test(PRIVACY_LINE_V030) && /bottom of the menu/.test(PRIVACY_LINE_V030), '[3d] v0.29.0\'s older privacy line (News straight from ESPN) is not carried in, and this one names what v4.0.0 adds: SCRIBE\'s football lookups and where News headlines come from');
}

console.log('\n[4] Coupled to what the app really says…');
{
  const src = readFileSync(join(HERE, 'js', 'app.js'), 'utf8');
  const chatSrc = readFileSync(join(HERE, 'js', 'chat-ui.js'), 'utf8');
  const listSrc = readFileSync(join(HERE, 'js', 'games-list.js'), 'utf8');
  const line = name => [...ADDED_PIN, ...FIXED_PIN].find(([n]) => n === name)[1];
  const { GAME_DAY_NAME } = await import('./js/gameday.js');
  const { SORT_MODES, SORT_COPY } = await import('./js/game-sort.js');
  const { PICK_STATUS_COPY } = await import('./js/pick-status.js');
  const { MS_COPY } = await import('./js/multisport-admin.js');
  const { SHARE_COPY } = await import('./js/chat-share.js');
  const { SPREAD_COPY } = await import('./js/spread-fallback.js');
  const { STALL_COPY } = await import('./js/sport-stall.js');
  const { SLATE_COPY } = await import('./js/slate-add.js');
  const { FINALIZE_STEPS } = await import('./js/week-wizard.js');

  assert(line('game-day-headline').startsWith(`${GAME_DAY_NAME} is on Home`), `[4a] the headline uses the card's real name ("${GAME_DAY_NAME}", js/gameday.js)`);
  assert(line('whos-in').startsWith(`${PICK_STATUS_COPY.title},`), `[4b] the Who's in line uses the strip's real title ("${PICK_STATUS_COPY.title}", js/pick-status.js)`);
  const labels = SORT_MODES.map(m => m.label);
  assert(labels.length === 3 && line('dashboard-sort').includes(`${labels[0]}, ${labels[1]} or ${labels[2]}`) && line('dashboard-sort').includes(`${SORT_COPY.button} button`), `[4c] the Sort line names the real button ("${SORT_COPY.button}") and the three real modes in their order (${labels.join(', ')})`);
  assert(line('league-overview').includes(MS_COPY.addTitle) && line('nfl-sport').startsWith('NFL, for leagues that add it'), `[4d] the league overview line names the real "${MS_COPY.addTitle}" row (js/multisport-admin.js)`);
  assert(line('share-to-chat').startsWith(`${SHARE_COPY.button}:`) && /Locker Room/.test(SHARE_COPY.posted) && /Locker Room/.test(line('share-to-chat')), `[4e] the share line uses the real button ("${SHARE_COPY.button}") and the real destination ("Locker Room")`);
  assert(line('find-spreads').includes(SPREAD_COPY.FIND) && /not yet on/.test(line('find-spreads')) && /aren't set up yet/.test(SPREAD_COPY.NOT_CONFIGURED), `[4f] the Find spreads line names the real button ("${SPREAD_COPY.FIND}") and its "not yet on" clause matches the real answer ("${SPREAD_COPY.NOT_CONFIGURED}")`);
  const pl = STALL_COPY.feedPlayer('NFL');
  assert(/delayed/.test(pl) && /picks and locks still work as normal/.test(pl) && /delayed/.test(line('stall-notice')) && /still lock as normal/.test(line('stall-notice')) && /aren't updating/.test(STALL_COPY.feedCommissioner('NFL')), `[4g] the stall line says what the real notice says: players hear "delayed" with picks and locks working; commissioners hear the cause ("${pl}")`);
  assert(SLATE_COPY.extendLabel(15) === 'Add as game 15' && SLATE_COPY.swapLabel === 'Swap with a game on the slate' && /extra game/.test(line('slate-add-or-swap')) && /swap it for one already on the slate/.test(line('slate-add-or-swap')) && /btn\('row-remove', 'Remove'/.test(listSrc), '[4h] the add-or-swap line matches the real choice sheet (Add as game N / Swap with a game on the slate) and the real Remove on each games-list row');
  const titles = FINALIZE_STEPS.map(s => s.title);
  assert(titles.includes('Approve Scores') && titles.includes('Confirm Tiebreaker') && titles.some(t => /^Longest field goal/.test(t)) && /approving scores, confirming the tiebreaker and the longest field goal/.test(line('finalize-guided')), `[4i] the Finalize line walks the real steps in order (${titles.join(' > ')})`);
  assert(src.includes("'Cross-device sync is OFF on this device.'") && line('finalize-guided').includes('"Cross-device sync is OFF"'), '[4j] the red error the Finalize line says is gone is the real banner title');
  const html = readFileSync(join(HERE, 'index.html'), 'utf8');
  const nav = html.match(/<button class="nav-item[^"]*" data-tab="([a-z]+)"/g).map(s => s.match(/data-tab="([a-z]+)"/)[1]);
  assert(nav.join(',') === 'picks,dashboard,home,chat,leaderboard' && /Home button in the centre of the bar/.test(line('chat-times-home-mark')), `[4k] the Home button the line describes is the centre of the real five-tab bar: ${nav.join(', ')}`);
  assert(/class="chat-foot\$\{/.test(chatSrc) && /Chat times now sit under each message/.test(line('chat-times-home-mark')), '[4l] chat times sit in the real .chat-foot under each message (js/chat-ui.js)');
  assert(/Denied: \$\{escHtml\(reason\)\}/.test(src) && src.includes("btn('mark', 'Mark Paid')") && /ob-denied-line/.test(src), '[4m] the payments line is real: Mark Paid, Confirm, Deny and the "Denied: <reason>" line under Unpaid');
  assert(/id="gr-find"[^>]*>[^<]*Find games/.test(src), '[4n] "Find games" in Request a Game is a real button (#gr-find)');
  const { JOIN_NUDGE_COPY } = await import('./js/home.js');
  assert(JOIN_NUDGE_COPY.title === 'Want in?' && JOIN_NUDGE_COPY.button('NFL').startsWith('Join ') && /Join button/.test(line('join-nudge')) && /not in/.test(line('join-nudge')) && /more than one sport/.test(line('join-nudge')), `[4o] the join-nudge line describes the real Home card: a "${JOIN_NUDGE_COPY.title}" card for a sport the member is not in, whose button reads "${JOIN_NUDGE_COPY.button('NFL')}" (js/home.js JOIN_NUDGE_COPY)`);
  const priv = readFileSync(join(HERE, 'privacy.html'), 'utf8');
  const ccSrc = readFileSync(join(HERE, 'js', 'control-center.js'), 'utf8');
  assert(/When someone asks SCRIBE a current sports question/.test(priv) && /<strong>Sports publishers<\/strong>/.test(priv) && /last updated 2026-10-15/.test(priv), '[4p] the privacy line is true of the page that ships: privacy.html carries the SCRIBE web-lookup paragraph and the Sports publishers bullet, dated 2026-10-15 (privacytest pins every word)');
  const fcm = await import('./js/feed-cards.js'), H = await import('./js/home.js');
  const card = { id: 'rank.changed:L1:w2:-', type: 'rank.changed', weekId: 'w2', facts: { weekN: 2, rankedCount: 6, members: [{ playerId: 'p1', playerName: 'Drew', fromRank: 2, toRank: 1 }, { playerId: 'p2', playerName: 'Kevin', fromRank: 1, toRank: 2 }] }, reason: 'In your league', sortKey: '2026-10-17T06:00:00.000Z' };
  const rendered = H.cardHTML(card, { escHtml: (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'), now: Date.parse('2026-10-17T08:00:00.000Z') });
  assert(/combines cards from the same moment/.test(NOW.added[0]) && /Drew moved up; Kevin slipped\./.test(rendered) && JSON.stringify(fcm.RETIRED_CARD_TYPES) === '["called.it","stood.alone","player.week"]', '[4r] v0.30.1\'s "combines cards from the same moment" is true of the code: one standings card names everyone who moved, and the per-person cards are retired (js/feed-cards.js)');
  assert(/shows when each one happened/.test(NOW.added[0]) && /<time class="feed-card-time"[^>]*>2h ago<\/time>/.test(rendered), '[4s] …and "shows when each one happened" is true: the card carries its own time ("2h ago", js/home.js cardHTML)');
  assert(ccSrc.includes('privacy.html') && /bottom of the menu/.test(line('privacy')), '[4q] "at the bottom of the menu" is real: the control centre\'s footer links privacy.html (js/control-center.js)');
}

console.log('\n[5] History — v0.30.0 intact right behind it, then v0.29.0; v0.28.0 still reads as iPhone-app items…');
{
  assert(V030.version === 'v0.30.0' && V030.date === '2026-10-16' && problemsV030(V030).length === 0, `[5-030] v0.30.0 is R[1], dated 2026-10-16, every line as shipped (the history was not edited)`);
  const V28 = R.find(r => r.version === 'v0.28.0');
  const all28 = [...(V28?.added || []), ...(V28?.fixed || [])];
  assert(PREV.version === 'v0.29.0' && PREV.date === '2026-10-02' && PREV.added.length === 9 && PREV.fixed.length === 7, `[5a] v0.29.0 is R[2] (behind v0.30.0), dated 2026-10-02, nine added and seven fixed (got ${PREV.version}, ${PREV.date}, ${PREV.added.length}/${PREV.fixed.length})`);
  assert(PREV.added.filter(b => b === PRIVACY_LINE_V029).length === 1 && PREV.added[0] !== PRIVACY_LINE_V029 && /^Meet Home/.test(PREV.added[0]), '[5b] v0.29.0 still carries its privacy line exactly once, not first, and still leads with "Meet Home" (the history was not edited)');
  assert(readFileSync(join(HERE, 'js', 'app.js'), 'utf8').includes("The privacy policy has been updated to cover News, which loads headlines straight from ESPN. You\\'ll find it at the bottom of the menu."), '[5c] the same v0.29.0 text is in js/app.js source');
  const rules = app.renderWeeklyTiesRulesHTML();
  const order = ['Picks', 'Tiebreaker', 'alma mater', 'Extra Point', "The week&#39;s draw|The week's draw"].map(t => rules.search(new RegExp(t)));
  const tieLine = PREV.added.find(b => /Weekly ties/.test(b)) || '';
  const idx = ['correct picks', 'tiebreaker', 'alma mater', 'Extra Point', 'draw'].map(t => tieLine.indexOf(t));
  assert(/Weekly Ties/.test(rules) && order.every(i => i >= 0) && order.every((v, i) => i === 0 || v > order[i - 1]) && idx.every((v, i) => v >= 0 && (i === 0 || v > idx[i - 1])), '[5d] v0.29.0\'s tie-steps line still names the steps in the order the real Rules page lists them');
  assert(V28?.added[0] === 'A new Munera sign-in screen.' && !all28.some(b => /Munera sign-in/.test(b) && /iPhone|on the web and in the app/.test(b)) && all28.filter(b => /Munera sign-in/.test(b)).length === 1,
    '[5e] v0.28.0\'s first "added" line still reads exactly "A new Munera sign-in screen." and exactly one line mentions it, claiming no platform');
  assert((V28?.fixed || []).some(b => /^In the iPhone app, pages bounce at the top and bottom/.test(b)), '[5f] v0.28.0\'s bounce line is still explicitly an iPhone-app item');
}

console.log('\n[6] Both renderers show the entry, escaped…');
{
  const card = app.renderWhatsNewCardHTML();
  const hist = app.renderReleaseNotesCardHTML();
  assert(/What's new in v0\.30\.1/.test(card) && card.includes(W92_LINE) && !/Game Day is on Home/.test(card), '[6a] the Picks card is titled "What\'s new in v0.30.1" and carries its one line (v0.30.0\'s bullets are history now)');
  assert(/data-release="v0\.30\.1"[^>]*\bopen\b/.test(hist) && !/data-release="v0\.30\.0"[^>]*\bopen\b/.test(hist) && !/data-release="v0\.29\.0"[^>]*\bopen\b/.test(hist), '[6b] the Rules → Release notes history opens v0.30.1 (newest) first, and only it');
  assert(/data-release="v0\.30\.0"/.test(hist) && /data-release="v0\.29\.0"/.test(hist) && /data-release="v0\.28\.0"/.test(hist), '[6c] v0.30.0, v0.29.0 and v0.28.0 stay in the history, closed');
  assert(/&quot;Cross-device sync is OFF&quot;|"Cross-device sync is OFF"/.test(hist) && /Game Day is on Home/.test(hist), '[6d] v0.30.0\'s lines (the quoted red-error line, the Game Day headline) still render in the history');
  const hostile = app.renderWhatsNewCardHTML([{ version: 'v9.9.9', date: '2026-10-14', added: ['<img src=x onerror=alert(1)>'], fixed: ['<b>bold</b>'] }]);
  assert(!/<img src=x/.test(hostile) && /&lt;img src=x/.test(hostile) && !/<b>bold<\/b>/.test(hostile), '[6e] every bullet goes through escHtml: markup in a bullet renders as text (CONVENTIONS #12)');
  assert(/Comm → Games is now one list/.test(hist), '[6f] the history carries the commissioner Comm → Games line');
  assert(/The privacy policy has been updated to cover how SCRIBE looks up football questions and where News headlines come from\./.test(hist) && /Home shows how the sports you(?:&#39;|')re not in are going, with a Join button/.test(hist), '[6g] the history shows v0.30.0\'s two late lines (apostrophes may be entity-escaped)');
}

console.log('\n[7] TEETH — the same checks FAIL on in-memory mutants…');
{
  // v0.30.0's teeth, kept whole: they run against the HISTORY entry (problemsV030), which must still catch every one of them.
  const clone = () => ({ ...V030, added: [...V030.added], fixed: [...V030.fixed] });
  const caught = (mutate, name) => { const r = clone(); mutate(r); return problemsV030(r).includes(name); };
  // v0.30.1's own teeth (W-92)
  const cloneNow = () => ({ ...NOW, added: [...NOW.added], fixed: [...NOW.fixed] });
  const caughtNow = (mutate, name) => { const r = cloneNow(); mutate(r); return problems(r).includes(name); };
  assert(caughtNow(r => { r.added = []; }, 'w92-line') && caughtNow(r => { r.added = []; }, 'headline-uncut'), '[7-301a] v0.30.1: the one line dropped -> caught by name');
  assert(caughtNow(r => { r.added = ['Home combines cards and shows times.']; }, 'added-list-exact') && caughtNow(r => { r.added = ['Home combines cards and shows times.']; }, 'w92-line'), '[7-301b] the line reworded -> caught');
  assert(caughtNow(r => { r.added = [...r.added, 'And much more.']; }, 'added-list-exact'), '[7-301c] an extra, unapproved line added -> caught');
  assert(caughtNow(r => { r.fixed = [W92_LINE]; r.added = []; }, 'fixed-list-exact'), '[7-301d] the line moved from `added` to `fixed` (it would no longer be the SCRIBE headline) -> caught');
  assert(caughtNow(r => { r.added = [...r.added, PRIVACY_LINE_V030]; }, 'privacy-line'), '[7-301e] v0.30.0\'s privacy line carried into v0.30.1 -> caught');
  assert(caughtNow(r => { r.version = 'v0.30.0'; }, 'version') && caughtNow(r => { r.date = '2026-10-16'; }, 'date'), '[7-301f] the entry left on v0.30.0\'s version or date -> caught');
  assert(caughtNow(r => { r.added = [W92_LINE + ' Fixes W-92 and DI-W92-1.']; }, 'internal-id'), '[7-301g] an internal ID in the line -> caught');
  const swapIn = (arr, from, to) => arr.map(b => (b === from ? to : b));
  const A = Object.fromEntries(ADDED_PIN), F = Object.fromEntries(FIXED_PIN);
  assert(caught(r => { r.added = r.added.filter(b => b !== A['whos-in']); }, 'whos-in'), '[7a] the Who\'s in line dropped -> caught by name');
  assert(caught(r => { r.fixed = r.fixed.filter(b => b !== F['scribe-callout']); }, 'scribe-callout'), '[7b] the SCRIBE call-out line dropped -> caught by name');
  assert(caught(r => { r.added = swapIn(r.added, A['dashboard-sort'], 'Dashboard has a Sort button: Kickoff time or Live first.'); }, 'dashboard-sort'), '[7c] the Sort line reworded to drop Custom -> caught');
  assert(caught(r => { r.added = [...r.added, 'And much more.']; }, 'added-list-exact'), '[7d] an extra, unapproved line added -> caught');
  assert(caught(r => { r.added = [r.added[1], r.added[0], ...r.added.slice(2)]; }, 'added-list-exact') && caught(r => { r.added = [r.added[1], r.added[0], ...r.added.slice(2)]; }, 'headline-is-game-day-and-uncut'), '[7e] the first two lines swapped (the headline changes) -> caught');
  assert(caught(r => { r.added = [...r.added, PRIVACY_LINE_V029]; }, 'privacy-line') && caught(r => { r.added = [...r.added, PRIVACY_LINE_V029]; }, 'privacy-stale'), '[7f] v0.29.0\'s older privacy line carried into this entry -> caught two ways');
  assert(caught(r => { r.added = r.added.filter(b => b !== PRIVACY_LINE_V030); }, 'privacy') && caught(r => { r.added = r.added.filter(b => b !== PRIVACY_LINE_V030); }, 'privacy-line'), '[7g] the privacy line DROPPED (the page ships, the notice owed) -> caught by name');
  assert(caught(r => { r.added = swapIn(r.added, PRIVACY_LINE_V030, 'The privacy policy has been updated to cover how SCRIBE looks up football questions.'); }, 'privacy-line'), '[7g2] the privacy line shortened (News headlines dropped from it) -> caught');
  assert(caught(r => { r.added = [...r.added, PRIVACY_LINE_V030]; }, 'privacy-line'), '[7g3] the privacy line doubled -> caught');
  assert(caught(r => { r.added = [PRIVACY_LINE_V030, ...r.added.filter(b => b !== PRIVACY_LINE_V030)]; }, 'privacy-not-headline') && caught(r => { r.added = [PRIVACY_LINE_V030, ...r.added.filter(b => b !== PRIVACY_LINE_V030)]; }, 'headline-is-game-day-and-uncut'), '[7g4] the privacy line made the FIRST line (the SCRIBE chat-post headline) -> caught two ways');
  assert(caught(r => { r.added = r.added.filter(b => b !== PRIVACY_LINE_V030); r.fixed = [...r.fixed, PRIVACY_LINE_V030]; }, 'privacy-line') && caught(r => { r.added = r.added.filter(b => b !== PRIVACY_LINE_V030); r.fixed = [...r.fixed, PRIVACY_LINE_V030]; }, 'fixed-list-exact'), '[7g5] the privacy line moved from `added` to `fixed` -> caught');
  assert(caught(r => { r.added = r.added.filter(b => b !== A['join-nudge']); }, 'join-nudge'), '[7g6] the join-nudge line dropped -> caught by name');
  assert(caught(r => { r.added = swapIn(r.added, A['join-nudge'], 'Home shows how the sports you\'re not in are going.'); }, 'join-nudge'), '[7g7] the join-nudge line reworded (the Join button promise dropped) -> caught');
  assert(caught(r => { r.added = [...r.added, 'Server-side pick lock: picks lock on our server at kickoff.']; }, 'announces-unshipped'), '[7h] an unshipped feature announced (server-side pick lock) -> caught');
  assert(caught(r => { r.added = [...r.added, 'Commissioners can now create a league from the menu.']; }, 'announces-unshipped'), '[7i] league creation announced -> caught');
  assert(caught(r => { r.fixed = swapIn(r.fixed, F['lock-everywhere'], F['lock-everywhere'] + ' The week now locks on the server even if no commissioner\'s phone is open.'); }, 'announces-unshipped'), '[7j] the held lock-job line C3 appended -> caught');
  assert(caught(r => { r.added = swapIn(r.added, A['find-spreads'], 'Commissioners: Find spreads checks ESPN, then DraftKings and FanDuel, for any slate game missing a spread.'); }, 'announces-unshipped'), '[7k] the spread lookup from other sources announced -> caught');
  assert(caught(r => { r.added = [...r.added, 'Home now shows team facts, player previews and storylines.']; }, 'announces-unshipped'), '[7l] the Home content cards announced -> caught');
  assert(caught(r => { r.fixed = [...r.fixed, 'SCRIBE\'s final-hour call-out now names anyone who has not picked.']; }, 'announces-unshipped'), '[7m] the final-hour call-out announced -> caught');
  assert(caught(r => { r.added = [...r.added, 'Taps now give a light haptic on the iPhone app.']; }, 'announces-unshipped'), '[7n] a haptics / iPhone claim -> caught');
  assert(caught(r => { r.added = [...r.added, 'Request a Game now works for NFL.']; }, 'announces-unshipped'), '[7o] Request a Game for NFL announced -> caught');
  assert(caught(r => { r.fixed = [...r.fixed, 'Fixed W-71 on the Find spreads button.']; }, 'internal-id') && caught(r => { r.fixed = [...r.fixed, 'Delivers PF-498.']; }, 'internal-id'), '[7p] an internal ID in player copy (W-71, PF-498) -> caught');
  assert(caught(r => { r.date = '2026-10-XX'; }, 'date') && caught(r => { r.date = '2026-10-XX'; }, 'date-format') && caught(r => { r.date = '2026-10-XX'; }, 'placeholder'), '[7q] the draft\'s date placeholder left in -> caught three ways');
  assert(caught(r => { r.date = '2026-10-13'; }, 'date'), '[7r] a date that disagrees with APP_VERSION_DATE -> caught');
  assert(caught(r => { r.version = 'v0.29.0'; }, 'version'), '[7s] a version that disagrees with APP_VERSION -> caught');
  assert(caught(r => { r.added = swapIn(r.added, A['game-day-headline'], A['game-day-headline'] + ' And so much more, all of it new this week, for everyone in every league!'); }, 'headline-is-game-day-and-uncut'), '[7t] a headline cut past 90 characters -> caught');
  assert(caught(r => { r.added = swapIn(r.added, A['find-spreads'], 'Commissioners: Find spreads (Comm → Games) re-checks ESPN, and other sources too.'); }, 'find-spreads'), '[7u] the "not yet on" clause dropped (other sources promised) -> caught');
  assert(caught(r => { r.expanded = true; }, 'expanded-flag'), '[7v] the one-release `expanded` flag left on -> caught');
  {
    const html = readFileSync(join(HERE, 'index.html'), 'utf8'), sw = readFileSync(join(HERE, 'service-worker.js'), 'utf8');
    const sp = (m) => stampProblems({ html: m.html ?? html, sw: m.sw ?? sw, version: m.version ?? app.APP_VERSION });
    assert(sp({}).length === 0, '[7x0] baseline: the real stamps pass the stamp check');
    assert(sp({ html: html.replace('css/styles.css?v=30-1', 'css/styles.css?v=30-0') }).includes('html-ref-value'), '[7x] one index.html reference left on 30-0 -> caught');
    assert(sp({ html: html.replace('js/app.js?v=30-1', 'js/app.js') }).includes('html-ref-count'), '[7y] a reference dropped (two left) -> caught');
    assert(sp({ sw: sw.replace("cfb-pickems-v30-1", "cfb-pickems-v30-0") }).includes('cache-name'), '[7z] CACHE_NAME left on v30-0 -> caught');
    assert(sp({ version: 'v0.30.2' }).length > 0 && sp({ version: 'v0.31.0' }).length > 0, '[7z1] APP_VERSION bumped without the cache stamps -> caught');
  }
  assert(problems(NOW).length === 0 && problemsV030(V030).length === 0, '[7w] and the real entries still pass after every mutation above (the mutants were clones, the real constant is untouched)');
}

console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
// Flush both streams before exiting (loadtest parses stdout + stderr from a pipe); the unref'd timer is the backstop if a callback never fires.
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
