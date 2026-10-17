/**
 * CFB Pickems — homefeedtest.mjs (Deployment 1, Lane B, DI-574 / 575 / 585 / 586 / 587, 2026-10-07)
 * ===============================================================================================
 * The proof for what the Home FEED does around its cards, on the production path — a REAL createHome() over a REAL element tree (minidom.mjs):
 *
 *   [1] DI-575 tappable cards — one tap target with a name that says it opens details; the id in the markup is only a request (validated against the cards of THIS paint); Enter / Space
 *   [2] DI-586 windowed pagination — 20 on the first paint, the next page appended IN PLACE before the end, no duplicate, no gap, no rewrite of what is above, the end marker last
 *   [3] DI-574 the new-posts pill — held while the reader is down-feed, counted, one node updated in place, released at the top, never for a score patch, cleared with the identity
 *   [4] DI-587 NEW / EARLIER — the leading run, the 2-second visit rule, state cards never new, "no fake new", held for the visit, reset with the identity (session-only: R-B1 pending)
 *   [5] DI-575/576 resolveCardDetail — rebuilt from live data, the gate re-asked, forged ids refused
 *   [6] The reader's session — everything resets with the identity; nothing is persisted
 *   [7] MUTATION PROOFS on scratch copies of home.js (never the file)
 *
 * Run:  node homefeedtest.mjs
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { installDom, mkHomeEnv, click, key, keysOf, NOW, MIN, HOUR, DAY, iso, esc } from './d1homeenv.mjs';
import { MiniElement } from './minidom.mjs';

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}
const read = (rel) => readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
{ const realErr = console.error; console.error = (...a) => { if (typeof a[0] === 'string' && /^\[(home|card-detail)\]/.test(a[0])) return; realErr(...a); }; }

const doc = installDom();
const home = await import('./js/home.js');
const fc = await import('./js/feed-cards.js');
const { calculateWeeklyResults } = await import('./js/scoring.js');
const fx = await import('./statsfixtures.mjs');
const HOME_SRC = await read('./js/home.js');

// ── the layout the reader's-place code reads: every keyed item is 100 px tall with a 16 px gap under a 60 px header; getBoundingClientRect moves with window.scrollY ──
MiniElement.prototype.getBoundingClientRect = function () {
  const k = this.getAttribute && this.getAttribute('data-card-key');
  if (k === null || k === undefined || !this.parentNode) return { width: 390, height: 800, top: 0, left: 0, right: 390, bottom: 800 };
  const idx = this.parentNode.children.indexOf(this);
  const top = 60 + idx * 116 - (globalThis.scrollY || 0);
  return { width: 390, height: 100, top, left: 0, right: 390, bottom: top + 100 };
};
const scrollCalls = [];
globalThis.scrollBy = (o, y) => { const d = (o && typeof o === 'object') ? o : { top: Number(y) }; scrollCalls.push(d); globalThis.scrollY += Number(d.top); };
const scrollListeners = [];
globalThis.addEventListener = (t, fn) => { if (t === 'scroll') scrollListeners.push(fn); };
globalThis.removeEventListener = (t, fn) => { const k = scrollListeners.indexOf(fn); if (t === 'scroll' && k >= 0) scrollListeners.splice(k, 1); };

// W-92 (2026-10-17): related cards now COMBINE (one standings / streak card per week, no per-member record or "called it" cards), so the hand-derived league
// alone yields 19 feed entries — under one page. Windowing (DI-586), the pill (DI-574) and the dividers (DI-587) need pages to test, so the fixture carries
// 32 extra FINAL week-1 games with NO picks (they move no record, rank or streak), each one more game-result card.
const league = (w2 = 'final') => {
  const L = fx.buildLeague({ w2, calculateWeeklyResults });
  for (let i = 0; i < 32; i++) L.games.push(fx.mkGame({ id: `gx${i}`, weekId: 'w1', kick: new Date(Date.parse('2026-09-05T21:00:00.000Z') + i * 60e3).toISOString(), home: `Home ${i}`, away: `Away ${i}`, kind: 'cover', state: 'final' }));
  return L;
};
/** The same league 40 days after its last week was finalized: the Now card is "Between seasons" (not Game Day), and the feed still has more than one page. */
const betweenSeasons = () => { const L = league('final'); const last = L.weeks[L.weeks.length - 1]; return { ...L, weeks: L.weeks.map(w => (w.weekId === last.weekId ? { ...w, finalizedAt: iso(NOW - 40 * DAY) } : w)), games: L.games.map(g => (g.weekId === last.weekId ? { ...g, kickoff: iso(NOW - 41 * DAY) } : g)) }; };
const post = (id, ts, ctx = { weekId: 'w2', weekN: 2 }) => ({ id, leagueId: 'L1', ts, author: 'scribe', authorName: 'SCRIBE', body: 'Settled: ' + id, reactionCount: 0, context: ctx, meta: { kind: 'lifecycle', test: false } });
const LOCKER = (n = 3) => ({ id: 'lr1', leagueId: 'L1', ts: NOW - HOUR, author: 'p3', authorName: 'Kevin', body: 'a take', reactionCount: n, meta: { kind: null, test: false } });
function mk(mod, o = {}) {
  const L = o.league || league(o.w2 || 'final');
  const scribe = o.scribe || [];
  const locker = o.locker || [LOCKER()];
  const e = mkHomeEnv({ home: mod }, doc, L, { read: { currentWeek: () => L.weeks[L.weeks.length - 1] }, chat: () => ({ scribe: scribe.slice(), lockerRoom: locker.slice() }), ...o });
  e.scribe = scribe; e.locker = locker;
  return e;
}
const feedItems = (c) => c.querySelectorAll('.feed-item');
const ordinaryKeys = (c) => keysOf(c).filter(k => !['now', 'sentinel', 'caught-up', 'seen-new', 'seen-earlier'].includes(k) && !k.startsWith('nudge'));
const fullKeys = (mod) => { const e = mk(mod); e.home.renderHome(); for (let i = 0; i < 20 && e.container.querySelector('[data-feed-sentinel]'); i++) e.home.loadMore(); return keysOf(e.container); };

// ═══ [1] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[1] DI-575 — tappable cards…');
{
  const e = mk(home);
  e.home.renderHome();
  const taps = e.container.querySelectorAll('[data-home-action="open-card"]');
  assert(taps.length >= 15 && taps.every(a => a.localName === 'article' && a.getAttribute('role') === 'button' && a.getAttribute('tabindex') === '0' && a.classList.contains('feed-card--tap')), `1a: every card with a detail is ONE tap target — an <article role="button" tabindex="0"> (${taps.length} on the first page)`);
  assert(taps.every(a => /\. Opens details\.$/.test(a.getAttribute('aria-label')) && a.getAttribute('aria-label').length > 20), '1b: …named "{what the card says}. Opens details." for VoiceOver');
  assert(taps.every(a => a.parentNode.getAttribute('data-card-key') === a.getAttribute('data-card-id')), '1c: …and the card\'s id is the key of the wrapper that Back returns focus to (data-card-key)');
  assert(taps.every(a => a.querySelector('.feed-card-eyebrow .feed-card-chev svg') && a.querySelector('.feed-card-chev').getAttribute('aria-hidden') === 'true'), '1d: each shows a disclosure chevron at the end of its eyebrow (decorative to VoiceOver)');
  // D1 Lane B (2026-10-08): the Now card is GAME DAY (`section.gd`) in every state but Draft / Between / an empty league. It is still not an insight card: it is not itself a card button and never carries open-card —
  // its header, pills and rows are the controls (each their own allow-listed gd-* action).
  const nowEl = e.container.querySelector('section.feed-now') || e.container.querySelector('section.gd');
  assert(nowEl && !nowEl.hasAttribute('data-home-action') && !nowEl.querySelector('[data-home-action="open-card"]'), '1e: the Now card (Game Day) is NOT an insight card — it keeps its own controls and is not tappable as a whole');
  const t0 = taps[0];
  const t0Id = t0.getAttribute('data-card-id');
  e.calls.actions.length = 0; e.calls.haptics.length = 0;
  click(t0);
  assert(e.calls.actions.length === 1 && e.calls.actions[0][0] === 'open-card' && e.calls.actions[0][1].cardId === t0.getAttribute('data-card-id') && e.calls.haptics.join() === 'light', '1f: a tap sends the allow-listed action with the card id and a LIGHT haptic (a card\'s detail is a secondary tap)');
  // the DOM is untrusted input
  e.calls.actions.length = 0; e.calls.haptics.length = 0;
  t0.setAttribute('data-card-id', 'game.final:L1:w9:-:forged');
  click(t0);
  t0.setAttribute('data-card-id', 'slate.published:L1:w2:-');
  const real = taps.find(a => a.getAttribute('data-card-id') === 'slate.published:L1:w2:-');
  t0.setAttribute('data-card-id', '');
  click(t0);
  t0.setAttribute('data-card-id', t0Id);
  assert(e.calls.actions.length === 0 && e.calls.haptics.length === 0, '1g: Std-9 — a forged or empty card id (not one of the cards derived for THIS paint) does nothing: no action and no haptic');
  e.calls.actions.length = 0;
  const card = taps[1];
  const r1 = key(card, 'Enter'), r2 = key(card, ' ');
  assert(e.calls.actions.length === 2 && !r1.defaultPrevented === false && r2.defaultPrevented === true, '1h: Enter and Space on the focused card open it, and Space does not scroll the page behind it');
  e.calls.actions.length = 0;
  const inner = card.querySelector('.feed-card-title') || card.querySelector('.feed-card-reason');
  key(inner, 'Enter'); key(card, 'a'); key(card, 'Escape'); key(card, 'ArrowDown');
  assert(e.calls.actions.length === 0, '1i: a key pressed on something INSIDE the card, or any other key, does nothing');
  assert(e.container.listenerCount('click') === 1 && e.container.listenerCount('keydown') === 1, '1j: one delegated click and one keydown listener on the container — bound once, however many times Home repaints');
  e.home.renderHome(); e.home.renderHome();
  assert(e.container.listenerCount('click') === 1 && e.container.listenerCount('keydown') === 1, '1k: …and repainting does not stack another');
  const sess = e.home._sessionForTest();
  assert(sess.cardIds.length >= taps.length && taps.every(a => sess.cardIds.includes(a.getAttribute('data-card-id'))), '1l: the dispatcher\'s allow-list is rebuilt from the cards derived on every paint');
  void real;
}

// ═══ [1w] W-105 (DI-W105-5): a tap ON the finished-game card's team marks is the card's tap (one target, the real dispatcher) ═══════════════════════
console.log('\n[1w] W-105 — the team marks are inside the card\'s ONE tap target…');
{
  const LOGO = (team) => `https://a.espncdn.com/i/teamlogos/ncaa/500/${encodeURIComponent(String(team).toLowerCase())}.png`;
  const e = mk(home, { deps: { logoUrlFor: (game, side) => (game && !game.isManual ? LOGO(side === 'home' ? game.homeTeam : game.awayTeam) : null) } });
  e.home.renderHome();
  const gfCards = e.container.querySelectorAll('[data-card-type="game.final"]');
  const g0 = gfCards[0];
  const mark = g0 && g0.querySelector('.feed-card-marks .tl-abbr');
  const img = g0 && g0.querySelector('.feed-card-marks img.matrix-hdr-logo');
  assert(gfCards.length >= 2 && !!mark && !!img && g0.getAttribute('data-home-action') === 'open-card', `1w-a: with Team logos on, the finished-game cards (${gfCards.length}) carry their marks row INSIDE the tappable <article>`);
  e.calls.actions.length = 0; e.calls.haptics.length = 0;
  click(mark); click(img);
  assert(e.calls.actions.length === 2 && e.calls.actions.every(a => a[0] === 'open-card' && a[1].cardId === g0.getAttribute('data-card-id')) && e.calls.haptics.join() === 'light,light',
    '1w-b: a tap on a team mark (its abbreviation or its logo) goes through the REAL delegated dispatcher and opens THAT card\'s detail with the light haptic — no second target, no new control');
}

// ═══ [2] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[2] DI-586 — windowed pagination…');
{
  const e = mk(home);
  e.home.renderHome();
  const c = e.container;
  assert(ordinaryKeys(c).length === home.FEED_PAGE_SIZE && home.FEED_PAGE_SIZE === 20, `2a: the first paint carries ${home.FEED_PAGE_SIZE} ordinary entries (${ordinaryKeys(c).length}), the Now card pinned above them`);
  assert(!!c.querySelector('[data-feed-sentinel]') && !c.querySelector('.feed-caught-up') && e.calls.observed.length === 1 && e.calls.observed[0].el === c.querySelector('[data-feed-sentinel]'), '2b: more exist, so the sentinel is the last row and there is NO end marker yet; the observer watches that very node');
  assert(c.querySelector('[data-feed-sentinel]').getAttribute('aria-hidden') === 'true', '2c: the sentinel is invisible to VoiceOver');
  const first3 = feedItems(c).slice(0, 3);
  const writes = c.writes;
  e.calls.observed[0].cb();                                                          // the reader reached the sentinel
  assert(ordinaryKeys(c).length === 40 && c.writes === writes, `2d: the next page (${ordinaryKeys(c).length} now) is appended IN PLACE — no full-markup write (writes ${writes} → ${c.writes})`);
  assert(feedItems(c).slice(0, 3).every((n, i) => n === first3[i]), '2e: …and the nodes above are the very same objects (nothing the reader sees was rebuilt — a logo cannot blink)');
  const keys = ordinaryKeys(c);
  assert(new Set(keys).size === keys.length, '2f: no key appears twice');
  assert(feedItems(c).slice(-20).filter(n => n.classList.contains('feed-item--enter')).length > 0 && feedItems(c).slice(0, 20).every(n => !n.classList.contains('feed-item--enter')), '2g: only the appended entries carry the 150 ms entrance fade');
  assert(e.calls.observed[0].off === true && e.calls.observed.length === 2 && e.calls.observed[1].el === c.querySelector('[data-feed-sentinel]'), '2h: the old observer is released and a new one watches the NEW sentinel');
  const w2 = c.writes;
  e.home.renderHome();
  assert(c.writes === w2 && ordinaryKeys(c).length === 40, '2i: a repaint with nothing changed writes nothing and keeps the 40 the reader has scrolled into');
  for (let i = 0; i < 20 && c.querySelector('[data-feed-sentinel]'); i++) e.calls.observed[e.calls.observed.length - 1].cb();
  const all = keysOf(c);
  assert(!c.querySelector('[data-feed-sentinel]') && all[all.length - 1] === 'caught-up' && !!c.querySelector('.feed-caught-up'), '2j: the last page ends the feed — no sentinel, and "You\'re all caught up." is the LAST row');
  assert(JSON.stringify(all) === JSON.stringify(fullKeys(home)), '2k: no gaps — the paged feed is exactly the order a one-shot render of the whole list produces');
  const ids = e.container.querySelectorAll('[data-card-id]').map(n => n.getAttribute('data-card-id'));
  assert(new Set(ids).size === ids.length, '2l: no card is painted twice');
  // a new card at the top while the reader is at the top: the window keeps everything already rendered
  e.scribe.push(post('top1', NOW + 2 * DAY));
  const before = ordinaryKeys(c).length;
  e.home.renderHome();
  assert(ordinaryKeys(c).length === before + 1 && keysOf(c)[1].endsWith(':top1') && new Set(keysOf(c)).size === keysOf(c).length, '2m: a card arriving at the top joins the window; nothing the reader had scrolled to falls out of it, and no key repeats');
  // identity change
  e.state.identity = 'acct|L1|p2';
  e.home.renderHome();
  assert(ordinaryKeys(c).length === 20 && !!c.querySelector('[data-feed-sentinel]'), '2n: a different identity starts at page one (nothing of the previous reader\'s scroll depth survives)');
  // no IntersectionObserver at all: the default watcher loads on a microtask, to the end
  const e2 = mk(home, { deps: { observeSentinel: undefined } });
  e2.home.renderHome();
  await new Promise(r => setTimeout(r, 30));
  assert(!e2.container.querySelector('[data-feed-sentinel]') && !!e2.container.querySelector('.feed-caught-up'), '2o: an engine with no IntersectionObserver still reaches the end (the next page loads at once)');
  // the default observer: 600 pt early, only on intersection
  const seen = [];
  globalThis.IntersectionObserver = class { constructor(cb, opts) { seen.push({ cb, opts, observed: [], disconnected: false }); this.i = seen.length - 1; } observe(t) { seen[this.i].observed.push(t); } disconnect() { seen[this.i].disconnected = true; } };
  const e3 = mk(home, { deps: { observeSentinel: undefined } });
  e3.home.renderHome();
  assert(seen.length === 1 && seen[0].opts.rootMargin === '600px 0px' && home.SENTINEL_ROOT_MARGIN === '600px 0px' && seen[0].observed[0] === e3.container.querySelector('[data-feed-sentinel]'), '2p: the default watcher is an IntersectionObserver with rootMargin 600px — it loads BEFORE the reader reaches the end');
  seen[0].cb([{ isIntersecting: false }]);
  assert(ordinaryKeys(e3.container).length === 20, '2q: an entry that is not intersecting loads nothing');
  seen[0].cb([{ isIntersecting: true }]);
  assert(ordinaryKeys(e3.container).length === 40 && seen[0].disconnected === true, '2r: an intersecting entry loads the next page and releases that observer');
  delete globalThis.IntersectionObserver;
  assert(home.FEED_CARD_CAP === 200, '2s: the total rendered cap is 200');
}

// ═══ [3] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[3] DI-574 — the new-posts pill…');
{
  const e = mk(home);
  const c = e.container;
  e.home.renderHome();
  scrollListeners.length = 0; scrollCalls.length = 0;
  globalThis.scrollY = 900;
  const before = JSON.stringify(keysOf(c));
  const w0 = c.writes;
  e.scribe.push(post('p-one', NOW + 3 * DAY));
  e.home.renderHome();
  const slot = c.querySelector('.home-pill-slot');
  assert(JSON.stringify(keysOf(c)) === before && c.writes === w0, '3a: reading down-feed, a newer card is HELD — the feed markup is untouched and not rewritten');
  assert(!!slot && c.children[0] === slot && !slot.closest('.home-feed') && slot.querySelector('.home-pill') && slot.querySelector('.home-pill').localName === 'button', '3b: the pill is the FIRST child of Home\'s root (a sticky zero-height slot), outside the feed, a real <button>');
  const pill = slot.querySelector('.home-pill');
  assert(pill.textContent === '1 new post' && pill.getAttribute('aria-label') === '1 new post' && pill.getAttribute('data-home-action') === 'new-posts' && pill.getAttribute('type') === 'button', '3c: "1 new post", named for VoiceOver, with the allow-listed action');
  assert(!!pill.querySelector('.home-pill-glyph svg') && pill.querySelector('.home-pill-glyph').getAttribute('aria-hidden') === 'true', '3d: the chevron is the existing chevronLeft glyph (CSS turns it to point up) — decorative');
  e.scribe.push(post('p-two', NOW + 3 * DAY + MIN));
  e.home.renderHome();
  assert(c.querySelector('.home-pill') === pill && pill.textContent === '2 new posts' && pill.getAttribute('aria-label') === '2 new posts' && c.writes === w0, '3e: more arrivals only update the count — the SAME pill node, still no feed rewrite');
  assert(e.home._sessionForTest().heldCount === 2 && scrollListeners.length === 1, '3f: the count is 2, and exactly one scroll watch is bound');
  e.calls.haptics.length = 0; scrollCalls.length = 0;
  click(pill);
  assert(e.calls.haptics.join() === 'light' && scrollCalls.length === 1 && scrollCalls[0].top === -900 && scrollCalls[0].behavior === 'smooth', '3g: tapping it scrolls to the top — SMOOTH, by exactly the distance travelled — with a light haptic');
  globalThis.scrollY = 900; scrollCalls.length = 0;
  globalThis.matchMedia = (q) => ({ matches: /reduce/.test(q) });
  click(pill);
  assert(scrollCalls.length === 1 && scrollCalls[0].behavior === 'instant', '3h: under Reduce Motion the scroll is instant');
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.scrollY = 50;
  scrollListeners.slice().forEach(fn => fn());
  const k = keysOf(c);
  assert(k[1].endsWith(':p-two') && k[2].endsWith(':p-one') && !c.querySelector('.home-pill-slot') && e.home._sessionForTest().heldCount === 0 && scrollListeners.length === 0, '3i: arriving at the top by scrolling lets BOTH held cards in (newest first), removes the pill and the watch');
  assert(feedItems(c).filter(n => n.classList.contains('feed-item--enter')).length === 2, '3j: …with the entrance fade on the two that arrived');
  // a change to a card already on screen is a patch, never a "new post"
  globalThis.scrollY = 900;
  const lockerBefore = c.querySelector('[data-card-type="lockerroom.top"]').textContent;
  e.locker.splice(0, 1, LOCKER(7));
  e.home.renderHome();
  assert(!c.querySelector('.home-pill-slot') && e.home._sessionForTest().heldCount === 0 && c.querySelector('[data-card-type="lockerroom.top"]').textContent !== lockerBefore && /7 reactions/.test(c.querySelector('[data-card-type="lockerroom.top"]').textContent), '3k: a card ALREADY on screen changing (a reaction count) is patched in place and never counted');
  // within the top band nothing is held
  globalThis.scrollY = 100;
  e.scribe.push(post('p-near', NOW + 4 * DAY));
  e.home.renderHome();
  assert(keysOf(c)[1].endsWith(':p-near') && !c.querySelector('.home-pill-slot'), '3l: within 120 pt of the top a newer card simply appears first');
  // the pill label
  assert(home.pillLabel(1) === '1 new post' && home.pillLabel(2) === '2 new posts' && home.pillLabel(99) === '99 new posts' && home.pillLabel(100) === '99+ new posts' && home.pillLabel(5000) === '99+ new posts' && home.pillLabel(0) === '0 new posts' && home.pillLabel('x') === '0 new posts', '3m: "1 new post" / "N new posts" / "99+ new posts"');
  // identity
  globalThis.scrollY = 900;
  e.home.renderHome();
  e.scribe.push(post('p-id', NOW + 5 * DAY));
  e.home.renderHome();
  const held = e.home._sessionForTest().heldCount;
  e.state.identity = 'acct|L1|p9';
  e.home.renderHome();
  assert(held === 1 && !c.querySelector('.home-pill-slot') && e.home._sessionForTest().heldCount === 0 && scrollListeners.length === 0, '3n: a different identity discards the held cards, removes the pill and the watch (never painted for another viewer)');
  globalThis.scrollY = 0;
  // VoiceOver (N1): the pill's appearance is announced ONCE, politely, after 1 s of quiet
  {
    const a = mk(home); a.home.renderHome();
    globalThis.scrollY = 900; scrollListeners.length = 0;
    const live = () => a.container.querySelector('.home-pill-live');
    a.scribe.push(post('v-one', NOW + 3 * DAY)); a.home.renderHome();
    assert(!!live() && live().getAttribute('role') === 'status' && live().getAttribute('aria-live') === 'polite' && live().getAttribute('aria-atomic') === 'true' && live().classList.contains('sr-only') && live().textContent === '' && a.pendingTimers(home.PILL_ANNOUNCE_MS) === 1 && home.PILL_ANNOUNCE_MS === 1000,
      '3p: the pill carries an EMPTY polite live region (role=status, sr-only) beside the button; nothing is announced at once; one 1000 ms timer is pending');
    a.advance(999);
    assert(live().textContent === '', '3q: …still silent at 999 ms');
    a.advance(1);
    assert(live().textContent === '1 new post' && a.pendingTimers(home.PILL_ANNOUNCE_MS) === 0, '3r: …"1 new post" is written to the live region at 1000 ms (so VoiceOver reads it once, politely)');
    a.scribe.push(post('v-two', NOW + 3 * DAY + MIN)); a.home.renderHome();
    assert(a.container.querySelector('.home-pill').getAttribute('aria-label') === '2 new posts' && live().textContent === '1 new post' && a.pendingTimers(home.PILL_ANNOUNCE_MS) === 0,
      '3s: a LATER arrival updates the button\'s name but is NOT announced again (no chatter) — nothing new is scheduled');
    // arrivals inside the window fold into ONE announcement of the final count
    const b = mk(home); b.home.renderHome(); globalThis.scrollY = 900;
    b.scribe.push(post('f-one', NOW + 3 * DAY)); b.home.renderHome();
    b.advance(600);
    b.scribe.push(post('f-two', NOW + 3 * DAY + MIN)); b.home.renderHome();
    b.advance(600);
    const blive = () => b.container.querySelector('.home-pill-live');
    assert(blive().textContent === '' && b.pendingTimers(home.PILL_ANNOUNCE_MS) === 1, '3t: a second arrival 600 ms in RESTARTS the quiet window — 1200 ms after the first, nothing has been said');
    b.advance(400);
    assert(blive().textContent === '2 new posts' && b.pendingTimers(home.PILL_ANNOUNCE_MS) === 0, '3u: …and one announcement follows, carrying the FINAL count ("2 new posts")');
    // the reader reaching the top removes the pill and its announcement; a later batch is announced afresh
    globalThis.scrollY = 50; scrollListeners.slice().forEach(fn => fn());
    assert(!b.container.querySelector('.home-pill-slot') && b.pendingTimers(home.PILL_ANNOUNCE_MS) === 0, '3v: arriving at the top removes the pill, live region included');
    globalThis.scrollY = 900;
    b.scribe.push(post('f-three', NOW + 4 * DAY)); b.home.renderHome();
    b.advance(1000);
    assert(b.container.querySelector('.home-pill-live').textContent === '1 new post', '3w: a NEW appearance is announced again (the once-only rule is per appearance)');
    // pending announcement is cancelled when the pill goes away before it fires
    const c2 = mk(home); c2.home.renderHome(); globalThis.scrollY = 900; scrollListeners.length = 0;
    c2.scribe.push(post('c-one', NOW + 3 * DAY)); c2.home.renderHome();
    globalThis.scrollY = 50; scrollListeners.slice().forEach(fn => fn());
    assert(c2.pendingTimers(home.PILL_ANNOUNCE_MS) === 0, '3x: the pill dismissed before 1 s cancels its pending announcement (a vanished pill is never announced)');
    // identity change before the timer fires
    globalThis.scrollY = 900;
    const d2 = mk(home); d2.home.renderHome();
    d2.scribe.push(post('i-one', NOW + 3 * DAY)); d2.home.renderHome();
    d2.state.identity = 'acct|L1|p9'; d2.home.renderHome();
    d2.advance(2000);
    assert(d2.pendingTimers(home.PILL_ANNOUNCE_MS) === 0 && !/new post/.test(d2.container.textContent || ''), '3y: a different identity cancels the announcement — a departed reader\'s count is never spoken for the next one');
    // no timer injected: silent, never throws
    const n = mk(home, { deps: { setTimer: undefined, clearTimer: undefined } }); n.home.renderHome(); globalThis.scrollY = 900;
    let threw = false;
    try { n.scribe.push(post('n-one', NOW + 3 * DAY)); n.home.renderHome(); n.advance(5000); } catch { threw = true; }
    assert(!threw && !!n.container.querySelector('.home-pill') && n.container.querySelector('.home-pill-live').textContent === '', '3z: with no timer injected the pill still works and simply makes no announcement');
    globalThis.scrollY = 0;
  }
  // withheld: nothing is held or painted
  const e2 = mk(home);
  e2.home.renderHome();
  e2.state.withheld = true;
  const w1 = e2.container.writes;
  globalThis.scrollY = 900; e2.scribe.push(post('p-w', NOW + 6 * DAY));
  e2.home.renderHome();
  assert(e2.container.writes === w1 && e2.home._sessionForTest().heldCount === 0, '3o: while content is withheld nothing is built, held or painted');
  globalThis.scrollY = 0;
}

// ═══ [4] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[4] DI-587 — NEW / EARLIER…');
{
  const ent = (kind, t, type) => (kind === 'card' ? { kind, key: type + ':' + t, t, card: { type } } : { kind, key: kind + ':' + t, t });
  const T = (ms) => iso(ms);
  const feed = [ent('card', T(NOW - 1 * MIN), 'game.final'), ent('card', T(NOW - 2 * MIN), 'week.result'), ent('card', T(NOW - 3 * HOUR), 'game.final'), ent('card', T(NOW - 4 * HOUR), 'player.week')];
  const marker = NOW - 90 * MIN;
  const out = home.withSeenDividers(feed, feed, marker);
  assert(out.map(e => e.key).join() === ['seen-new', feed[0].key, feed[1].key, 'seen-earlier', feed[2].key, feed[3].key].join(), '4a: the leading run newer than the marker is bracketed — NEW above it, EARLIER beneath the last new card');
  assert(out[0].variant === 'new' && out[3].variant === 'earlier', '4b: …in that order');
  assert(home.withSeenDividers(feed, feed, null).length === 4 && home.withSeenDividers(feed, feed, undefined).length === 4, '4c: no stored marker = no divider (first launch: "no fake new")');
  assert(home.withSeenDividers(feed, feed, NOW - 10 * DAY).length === 4, '4d: when EVERYTHING is new there is nothing honest to compare against — no divider');
  assert(home.withSeenDividers(feed, feed, NOW + HOUR).length === 4, '4e: when nothing is new, no divider');
  const state = [ent('card', T(NOW - 1 * MIN), 'picks.submitted'), ent('card', T(NOW - 2 * MIN), 'week.revealed'), ent('card', T(NOW - 3 * MIN), 'year.ago'), ent('card', T(NOW - 5 * HOUR), 'game.final')];
  assert(home.withSeenDividers(state, state, NOW - HOUR).length === 4, '4f: state cards (picks.submitted, week.revealed, year.ago) have no event of their own — they never make anything NEW');
  const mixed = [ent('card', T(NOW - 1 * MIN), 'picks.submitted'), ent('card', T(NOW - 2 * MIN), 'game.final'), ent('card', T(NOW - 5 * HOUR), 'game.final')];
  assert(home.withSeenDividers(mixed, mixed, NOW - HOUR).map(e => e.key)[0] === 'seen-new', '4g: …but they ride inside a block that a real event card made new');
  const news = [ent('news', T(NOW - 2 * MIN)), ent('card', T(NOW - 6 * HOUR), 'game.final')];
  assert(home.withSeenDividers(news, news, NOW - HOUR)[0].key === 'seen-new', '4h: a news item published after the marker counts as new');
  const unparse = [{ kind: 'card', key: 'x', t: 'garbage', card: { type: 'game.final' } }, ent('card', T(NOW - 6 * HOUR), 'game.final')];
  assert(home.withSeenDividers(unparse, unparse, NOW - HOUR).length === 2 && home.withSeenDividers([], [], NOW).length === 0, '4i: an unparseable time is not "new"; an empty feed is untouched');
  const win = home.withSeenDividers(feed.slice(0, 2), feed, marker);
  assert(win.length === 4 && win[3].variant === 'earlier', '4j: when the WINDOW ends inside the new run but earlier entries exist beyond it, the EARLIER label still closes the run');
  // integration — every fixture card is dated before B (the fixture's week 2 was finalized on 09-14, after NOW)
  const B = NOW + 3 * DAY;
  const e = mk(home);
  const c = e.container;
  const sess = () => e.home._sessionForTest();
  e.state.now = B;
  e.home.renderHome();
  assert(!c.querySelector('.feed-divider') && sess().marker === null && sess().visibleSince === B, '4k: the first launch has no marker and no divider; the visit began now');
  e.state.now = B + 1000;
  assert(e.home.noteLeft() === false && sess().marker === null, '4l: leaving after under 2 seconds does not advance the marker');
  e.state.now = B + 10_000; e.home.renderHome();
  e.state.now = B + 20_000;
  assert(e.home.noteLeft() === true && sess().marker === B + 20_000 && sess().visibleSince === null, '4m: leaving after 2 s or more advances the marker to now and ends the visit');
  e.state.now = B + 30 * MIN;
  e.scribe.push(post('fresh1', B + 25 * MIN));
  e.home.renderHome();
  const ks = keysOf(c);
  const iNew = ks.indexOf('seen-new'), iEar = ks.indexOf('seen-earlier');
  assert(sess().baseline === B + 20_000 && iNew === 1 && ks[2].endsWith(':fresh1') && iEar === 3, `4n: back after 30 minutes with one new card: now · NEW · the card · EARLIER · the rest (${ks.slice(0, 5).map(k => k.split(':')[0]).join(' · ')})`);
  const nd = c.querySelector('.feed-divider--new');
  assert(nd.getAttribute('role') === 'separator' && nd.getAttribute('aria-label') === 'New since your last visit' && nd.textContent === 'NEW' && c.querySelector('.feed-divider--earlier').getAttribute('aria-label') === 'Earlier', '4o: the dividers are separators with spoken names (never colour alone)');
  await e.home.refresh();
  assert(sess().marker === B + 20_000 && sess().baseline === B + 20_000 && !!c.querySelector('.feed-divider--new'), '4p: a pull-to-refresh does not advance the marker and the NEW block stays while the reader reads it');
  e.state.now = B + 40 * MIN;
  e.home.renderHome();
  assert(!!c.querySelector('.feed-divider--new') && sess().baseline === B + 20_000, '4q: the marker is held for the whole visit');
  e.state.now = B + 41 * MIN; e.home.noteLeft();
  e.state.now = B + 50 * MIN; e.home.renderHome();
  assert(!c.querySelector('.feed-divider') && sess().baseline === B + 41 * MIN, '4r: leave and return again: the divider is gone');
  e.state.identity = 'acct|L1|p3';
  e.home.renderHome();
  assert(sess().marker === null && !c.querySelector('.feed-divider'), '4s: a different identity starts with its own (empty) marker — never the previous reader\'s');
  const code = stripComments(HOME_SRC);
  assert(!/localStorage|\bsave\(|setItem|sessionStorage|indexedDB/.test(code), '4t: the marker is held in memory only — nothing in home.js can write it anywhere (R-B1, a device-local timestamp, is pending Drew)');
  const hidden = mk(home);
  Object.defineProperty(doc, 'hidden', { value: true, configurable: true });
  hidden.home.renderHome();
  assert(hidden.home._sessionForTest().visibleSince === null, '4u: a paint while the page is hidden does not begin a visit');
  Object.defineProperty(doc, 'hidden', { value: false, configurable: true });
}

// ═══ [5] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[5] DI-575/576 — resolveCardDetail…');
{
  const e = mk(home, { deps: { detailContext: () => ({ threadCount: () => 5, capabilities: { thread: true, chat: true } }) } });
  e.home.renderHome();
  const gid = 'game.final:L1:w2:-:g24';
  const r = e.home.resolveCardDetail(gid);
  assert(!!r && r.title === 'Final' && r.model.type === 'game.final' && /class="cd" data-cd-type="game\.final"/.test(r.html), '5a: a card id resolves to its title, its model and its markup');
  assert(/Open thread · 5/.test(r.html) && /data-cd-game="g24"/.test(r.html), '5b: the app\'s injected context reaches the detail (the thread count, the available actions)');
  assert(/cd-eyebrow-icon/.test(r.html) && /In this week&#39;s slate|In this week's slate/.test(r.html.replace(/&amp;#39;/g, "'")), '5c: the eyebrow carries the card\'s own glyph and reason label');
  assert(e.home.resolveCardDetail('game.final:L1:w2:-:forged') === null && e.home.resolveCardDetail('') === null && e.home.resolveCardDetail(null) === null && e.home.resolveCardDetail('now') === null, '5d: a forged, empty or non-card id resolves to null — the pushed screen shows the calm unavailable state');
  assert(/Details for this card/.test(e.home.unavailableDetail()) && /back-home/.test(e.home.unavailableDetail()), '5e: …which home hands the app ready-made');
  // the gate is re-asked each time (live data)
  const L = league('final');
  const e2 = mk(home, { league: L });
  e2.home.renderHome();
  const wr = 'week.result:L1:w2:-';
  assert(!!e2.home.resolveCardDetail(wr), '5f CONTROL: a final week\'s result opens');
  e2.deps && e2.state && (e2.state.withheld = true);
  assert(e2.home.resolveCardDetail(wr) === null, '5g: content withheld → null (the screen closes on its next repaint)');
  e2.state.withheld = false;
  L.weeks[1].status = 'locked'; L.weeks[1].revealedAt = null;
  const e3 = mkHomeEnv({ home }, doc, L, { read: { currentWeek: () => L.weeks[1] }, confirmed: () => 'locked', chat: { scribe: [], lockerRoom: [] } });
  assert(e3.home.resolveCardDetail(wr) === null && e3.home.resolveCardDetail(gid) === null, '5h: the same week turned LOCKED while the screen was open → both the week result and the game card resolve to null (nothing stays on screen that the gate no longer allows)');
  const e4 = mk(home, { viewer: null });
  e4.home.renderHome();
  const anon = e4.home.resolveCardDetail(gid);
  assert(!!anon && !/Your pick/.test(anon.html) && !/data-cd-action="go-picks"/.test(anon.html), '5i: signed out — the detail opens (a public week) with no personal row and no picks action');
  const hostile = { ...e.league.players[2], displayName: '<img src=x onerror=1>' };
  const L2 = league('final'); L2.players = L2.players.map(p => (p.playerId === 'p3' ? hostile : p));
  const e5 = mk(home, { league: L2 });
  e5.home.renderHome();
  const hr = e5.home.resolveCardDetail(gid);
  assert(!!hr && !/<img src=x/.test(hr.html), '5j: a hostile display name is escaped in the detail markup');
}

// ═══ [6] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[6] The reader\'s session…');
{
  const e = mk(home);
  e.home.renderHome();
  e.calls.observed[0].cb();
  e.state.now = NOW + 10_000; e.home.renderHome(); e.state.now = NOW + 20_000; e.home.noteLeft();
  const s0 = e.home._sessionForTest();
  assert(s0.rendered.length >= 40 && s0.marker !== null, '6a: fixture — two pages in, a marker set');
  e.state.identity = 'someone-else';
  e.home.renderHome();
  const s1 = e.home._sessionForTest();
  assert(s1.marker === null && s1.baseline === null && s1.heldCount === 0 && s1.rendered.length === 20, '6b: a different identity resets the marker, the held count and the window — one reader\'s session never leaks into the next');
  e.state.identity = 'acct|L1|p1';
  e.home.renderHome();
  assert(e.home._sessionForTest().marker === null, '6c: …and coming back is a fresh session too (nothing is remembered across an identity change)');
  const code = stripComments(HOME_SRC);
  assert(/function syncSession\(\)/.test(code) && /syncSession\(\);/.test(code), '6d: the identity check runs at the top of every renderHome()');
}

// ═══ [7] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[7] MUTATION PROOFS — scratch copies loaded as data: URLs (never the file)…');
{
  const base = new URL('./js/', import.meta.url).href;
  const retarget = (src) => src.replace(/from '\.\/([\w.-]+)'/g, (_m, f) => `from '${base}${f}'`);
  const load = async (src) => import('data:text/javascript;base64,' + Buffer.from(retarget(src)).toString('base64') + '#' + Math.random());
  const probe = async (mod) => {
    const o = {};
    const e = mk(mod); e.home.renderHome();
    o.windowed = ordinaryKeys(e.container).length === 20 && !!e.container.querySelector('[data-feed-sentinel]');
    const first = feedItems(e.container)[1];
    e.calls.observed[0].cb();
    o.appendInPlace = ordinaryKeys(e.container).length === 40 && feedItems(e.container)[1] === first;
    {
      // The same property where a Home repaint is still a WHOLE-feed write: between seasons the Now card is not Game Day, so nothing reconciles the feed by key and a next page that fell back to
      // renderHome() would rebuild every card above it (the original mutant, kept here where it is not equivalent).
      const bs = mk(mod, { league: betweenSeasons() }); bs.home.renderHome();
      const nowEl = bs.container.querySelector('[data-card-key="now"]');
      const firstB = feedItems(bs.container)[1];
      bs.calls.observed[0].cb();
      o.appendInPlaceNoGd = !!nowEl && /data-now-state="between"/.test(nowEl.innerHTML) && !nowEl.querySelector('.gd') && ordinaryKeys(bs.container).length === 40 && feedItems(bs.container)[1] === firstB;
    }
    const t0 = e.container.querySelectorAll('[data-home-action="open-card"]')[0];
    e.calls.actions.length = 0;
    t0.setAttribute('data-card-id', 'forged');
    click(t0);
    o.forgedRefused = e.calls.actions.length === 0;
    const h = mk(mod); h.home.renderHome(); scrollListeners.length = 0;
    globalThis.scrollY = 900;
    const before = JSON.stringify(keysOf(h.container));
    h.scribe.push(post('m-one', NOW + 3 * DAY));
    h.home.renderHome();
    o.held = JSON.stringify(keysOf(h.container)) === before && !!h.container.querySelector('.home-pill');
    globalThis.scrollY = 50;
    scrollListeners.slice().forEach(fn => fn());
    o.released = keysOf(h.container)[1].endsWith(':m-one') && !h.container.querySelector('.home-pill-slot');
    globalThis.scrollY = 0;
    const BB = NOW + 3 * DAY;
    const s = mk(mod); s.state.now = BB; s.home.renderHome();
    s.state.now = BB + 1000; const early = s.home.noteLeft();
    s.state.now = BB + 10_000; s.home.renderHome(); s.state.now = BB + 20_000; const late = s.home.noteLeft();
    o.visitRule = early === false && late === true;
    s.state.now = BB + 30 * MIN; s.scribe.push(post('n-one', BB + 25 * MIN)); s.home.renderHome();
    o.dividers = !!s.container.querySelector('.feed-divider--new') && !!s.container.querySelector('.feed-divider--earlier');
    s.state.identity = 'other'; s.home.renderHome();
    o.identityReset = s.home._sessionForTest().marker === null && !s.container.querySelector('.feed-divider');
    {
      const v = mk(mod); v.home.renderHome(); globalThis.scrollY = 900; scrollListeners.length = 0;
      v.scribe.push(post('q-one', NOW + 3 * DAY)); v.home.renderHome();
      const lv = () => v.container.querySelector('.home-pill-live');
      v.advance(999);
      o.debounced = !!lv() && lv().textContent === '';
      v.advance(1);
      o.announces = !!lv() && lv().textContent === '1 new post';
      o.polite = !!lv() && lv().getAttribute('aria-live') === 'polite';
      v.scribe.push(post('q-two', NOW + 3 * DAY + MIN)); v.home.renderHome();
      o.once = v.pendingTimers(home.PILL_ANNOUNCE_MS) === 0 && lv().textContent === '1 new post';
      globalThis.scrollY = 50; scrollListeners.slice().forEach(fn => fn());          // the pill goes away (its announcement had fired)
      globalThis.scrollY = 900; v.scribe.push(post('q-three', NOW + 4 * DAY)); v.home.renderHome();
      v.advance(1000);
      o.announcesAgain = !!lv() && lv().textContent === '1 new post';             // a NEW appearance is announced afresh
      globalThis.scrollY = 50; scrollListeners.slice().forEach(fn => fn());
      globalThis.scrollY = 900; v.scribe.push(post('q-four', NOW + 5 * DAY)); v.home.renderHome();   // a pending announcement …
      globalThis.scrollY = 50; scrollListeners.slice().forEach(fn => fn());          // … and the pill is dismissed before it fires
      o.cancelledOnRemove = v.pendingTimers(home.PILL_ANNOUNCE_MS) === 0;
      globalThis.scrollY = 900; v.scribe.push(post('q-five', NOW + 6 * DAY)); v.home.renderHome();   // a pending announcement …
      v.state.identity = 'acct|L1|p8'; v.home.renderHome();                          // … and a different reader signs in
      o.cancelledOnIdentity = v.pendingTimers(home.PILL_ANNOUNCE_MS) === 0;
      globalThis.scrollY = 0;
    }
    const g = mk(mod); g.home.renderHome();
    const gone = g.home.resolveCardDetail('game.final:L1:w2:-:g24');
    g.state.withheld = true;
    o.withheldNull = !!gone && g.home.resolveCardDetail('game.final:L1:w2:-:g24') === null;
    return o;
  };
  const baseRes = await probe(home);
  assert(Object.values(baseRes).every(Boolean), `7-0: the probe is GREEN on the real module (positive control: ${Object.entries(baseRes).filter(([, v]) => !v).map(([k]) => k).join(', ') || 'all pass'})`);
  const R = (a, b) => { if (HOME_SRC.split(a).length !== 2) throw new Error('mutation anchor must match exactly once: ' + a.slice(0, 70)); return HOME_SRC.replace(a, b); };
  const mutants = [
    ['no windowing — the whole list renders at once', R('const limit = Math.min(FEED_CARD_CAP, Math.max(FEED_PAGE_SIZE * pages, lastIdx + 1));', 'const limit = FEED_CARD_CAP;'), 'windowed'],
    // (Retargeted 2026-10-08, D1 Game Day fix round 1 / reviewer B3: the OLD mutant made loadMore() fall back to renderHome(). Since that fix a Home repaint with Game Day on screen reconciles the feed BY KEY around the
    // card — an unchanged card is no longer rebuilt — so that fallback is no longer a regression of the property this proves (the cards already on screen are the same nodes after the next page arrives), and
    // the old mutant became equivalent. The mutant below still violates the property: the next page REWRITES the whole feed (every card replaced, every logo reloaded) instead of appending after the last card.)
    ['the next page rewrites the whole feed, not an append', R("feed.insertAdjacentHTML('beforeend', joinHtml(added.map(it => itemHTML(it, { isNew: true, escHtml }))));", "el.innerHTML = wrapItems(model.items, { enter: null, busy: false, escHtml });"), 'appendInPlace'],
    // The ORIGINAL mutant, kept (reviewer round 2): the next page falls back to a full renderHome(). With Game Day on screen that repaint reconciles by key (equivalent there), so it is proved on the
    // between-seasons fixture, where a Home repaint still writes the whole feed.
    ['the next page is a full repaint, not an append (between seasons: no Game Day to reconcile around)', R("if (!prev || prev.mode !== 'content' || !feed || typeof feed.insertAdjacentHTML !== 'function') { renderHome(); return; }", 'renderHome(); return;'), 'appendInPlaceNoGd'],
    ['a forged card id is accepted', R("if (!isNonEmptyString(cardId) || !currentCardIds.has(cardId)) return;", "if (!isNonEmptyString(cardId)) return;"), 'forgedRefused'],
    ['a reader scrolled down is shoved: nothing is held', R("if (!userRefreshing && renderedOrdinary.size > 0 && scrollY() > READER_TOP_PX) {", "if (false) {"), 'held'],
    ['held cards never come back (no scroll watch)', R("if (scrollY() > READER_TOP_PX || heldCount <= 0 || withheld() || safeTab() !== HOME_TAB) return;", "return;"), 'released'],
    ['a visit of any length advances the marker', R("const advanced = d.now() - seen.visibleSince >= SEEN_MIN_VISIT_MS;", "const advanced = true;"), 'visitRule'],
    ['the dividers are never drawn', R("const shown = withSeenDividers(visible, list, seen.baseline);", "const shown = visible;"), 'dividers'],
    ['a different identity keeps the previous reader\'s session', R("if (sessionIdentity !== id) { resetSession(); sessionIdentity = id; }", "if (sessionIdentity !== id) { sessionIdentity = id; }"), 'identityReset'],
    ['the pill\'s announcement is not debounced', R("    }, PILL_ANNOUNCE_MS);", "    }, 0);"), 'debounced'],
    ['the announcement is assertive, not polite', R('role="status" aria-live="polite"', 'role="status" aria-live="assertive"'), 'polite'],
    ['every later arrival is announced again', R("if (t) t.textContent = label; if (!pillAnnounced) scheduleAnnounce(); }", "if (t) t.textContent = label; scheduleAnnounce(); }"), 'once'],
    ['a dismissed pill never resets, so a new appearance is not announced', R("if (slot) slot.remove(); cancelAnnounce(); pillAnnounced = false; return; }", "if (slot) slot.remove(); return; }"), 'announcesAgain'],
    ['a dismissed pill\'s pending announcement is not cancelled', R("if (slot) slot.remove(); cancelAnnounce(); pillAnnounced = false; return; }", "if (slot) slot.remove(); pillAnnounced = false; return; }"), 'cancelledOnRemove'],
    ['a different identity keeps the previous reader\'s announcement (neither the session reset nor the pill sync cancels it)', R("if (slot) slot.remove(); cancelAnnounce(); pillAnnounced = false; return; }", "if (slot) slot.remove(); pillAnnounced = false; return; }").replace("heldCount = 0; cancelAnnounce(); pillAnnounced = false;", "heldCount = 0; pillAnnounced = false;"), 'cancelledOnIdentity'],
    // (retargeted 2026-10-08, D1 Lane B Game Day consolidated round: the card detail's fresh read moved into freshSnapshot(), which the Game view shares — the derive gate is mutated THERE)
    ['the card detail drops the Home-level withheld check AND the derive gate (both layers)', R("if (withheld() || !isNonEmptyString(cardId)) return null;\n    const fresh = freshSnapshot('card detail');", "if (!isNonEmptyString(cardId)) return null;\n    const fresh = freshSnapshot('card detail');").replace("const cards = deriveHomeCards(snapshot, { viewerId, now, viewerIsCommissioner: isCommissioner, isContentWithheld: d.isContentWithheld });", "const cards = deriveHomeCards(snapshot, { viewerId, now, viewerIsCommissioner: isCommissioner, isContentWithheld: () => false });"), 'withheldNull'],
  ];
  // DEFENCE IN DEPTH: either layer alone still blocks a withheld screen, so removing ONE of them must NOT leak (an equivalent mutant is documented, not hidden)
  for (const [name, src] of [
    ['the Home-level withheld check removed alone', R("if (withheld() || !isNonEmptyString(cardId)) return null;", "if (!isNonEmptyString(cardId)) return null;")],
    ['the derive gate removed alone', R("const cards = deriveHomeCards(snapshot, { viewerId, now, viewerIsCommissioner: isCommissioner, isContentWithheld: d.isContentWithheld });", "const cards = deriveHomeCards(snapshot, { viewerId, now, viewerIsCommissioner: isCommissioner, isContentWithheld: () => false });")],
  ]) {
    const res = await probe(await load(src));
    assert(src !== HOME_SRC && res.withheldNull === true, `7: "${name}" is still blocked by the other layer (defence in depth)`);
  }
  for (const [name, src, check] of mutants) {
    let res;
    try { res = await probe(await load(src)); } catch (err) { res = { [check]: false, _err: String(err.message).slice(0, 90) }; }
    globalThis.scrollY = 0;
    assert(src !== HOME_SRC && res[check] === false, `7: mutant "${name}" turns ${check} RED${res._err ? ' (' + res._err + ')' : ''}`);
  }
}

console.log(`\n══════════════════════════════════════════════════\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
