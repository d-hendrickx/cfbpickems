/**
 * CFB Pickems — newspicturestest.mjs (W-105, the Home visuals, release v0.30.2; feature-builder, 2026-10-17)
 * ===========================================================================================================
 * The proof for DI-W105-1 (how many news cards), DI-W105-2 (WHICH stories: the pictures spread through the feed) and the node-level half of DI-W105-4 (a picture
 * loads quietly and leaves quietly), plus the static allow-list guards the DI names (P-11). Drew: "I really liked how it included some photos every few cards ... it
 * needs to have more visuals to be more dynamic and make people want to scroll it" ("approve M-62 to M-65 as recommended").
 *
 *   [1] the count (DI-W105-1): the DI's table, the test league's final week (9 other cards -> 3), never more than 10, never a story over 48 hours
 *   [2] selectNews (DI-W105-2): acceptance (a) the spread over 18 cards / 24 hours, (b) determinism (the same inputs, shuffled anchors, shuffled cards), (c) the
 *       publisher guard (k = 6: 2; k = 10: 4), (d) a text-only pool is today's selection, (e) at least wantP pictures whenever that many exist (the top-up path too),
 *       (f) never twice, storylines / content never counted; no anchors; fewer pictures than wantP; no clock and no random value read AT RUN TIME (both throw)
 *   [3] mergeFeed end to end: the count reads the ordinary cards on screen, the chosen stories sit at their OWN times, nothing older than 48 hours, the pinned Now card
 *   [4] the binder (DI-W105-4) with FAKE GEOMETRY: load -> fade class; an already-loaded picture at bind -> instant; a failed picture below the viewport (instant, no
 *       scroll), on screen (the collapse, then gone), above (instant + ONE hook call with exactly the removed height), a partly visible card whose picture is above (held
 *       too), Reduce Motion (instant); the hook's throw is contained; unbind removes the root class and every listener; a failed picture is not drawn again; offline
 *       failures are not remembered; the memory is capped
 *   [5] the wiring: newsFeed.bindEvents forwards onPictureRemoved; js/app.js passes holdHomePlaceForPicture (pinned body) and it scrolls through home.js's scrollPageBy
 *       (exactly -removedPx, instant, the tab bar's hide paused) only for a picture ABOVE the viewport
 *   [6] static guards, allow-list form (P-11): the modules that emit `feed-card-marks`; every image-validator call site in js/ (file + exact line); the image host lists
 *       exactly today's (SHARED_IMAGE_CDNS empty); the <img> sinks of the news and lockup paths exactly the pinned two
 *
 * The real-browser half (computed style, the whole headline measured, a real failing picture, the real scroll hold, the 16:9 skeleton) is newsrendertest.mjs [W].
 * The S-3 kit: tests/kits/w105-home-visuals-kit.mjs.
 *
 * Run:  node newspicturestest.mjs
 */
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}
for (const ev of ['uncaughtException', 'unhandledRejection']) process.on(ev, (e) => { fail++; console.error('  ❌ the suite threw:', String((e && e.stack) || e).slice(0, 400)); console.log(`\n${'═'.repeat(50)}\n❌ FAILURES — ${pass} passed, ${fail} failed`); process.exit(1); });

const HERE = fileURLToPath(new URL('.', import.meta.url));
const read = (rel) => readFile(HERE + rel, 'utf8');
const home = await import('./js/home.js');
const card = await import('./js/newsCard.js');
const feed = await import('./js/newsFeed.js');
const rules = await import('./js/newsRules.js');
const nav = await import('./js/nav-gestures.js');

const NOW = Date.parse('2026-10-17T22:00:00.000Z');   // a Saturday evening
const MIN = 60e3, HOUR = 3600e3;
const iso = (ms) => new Date(ms).toISOString();
let seed = 105; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const shuffle = (a) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const PUBS = ['Fox News', 'NCAA.com', 'Sports Illustrated', 'CBS Sports'];
const pic = (id, ms, publisher) => ({ id, publishedAt: iso(ms), publisher, source: publisher, imageUrl: `https://images.example/${id}.jpg`, headline: 'Story ' + id, sport: 'cfb' });
const txt = (id, ms, publisher = 'ESPN') => ({ id, publishedAt: iso(ms), publisher, source: publisher, imageUrl: null, headline: 'Story ' + id, sport: 'cfb' });
const mkCard = (id, ms, type = 'week.result') => ({ id, type, weekId: 'w7', sortKey: iso(ms), facts: {}, reason: 'r' });
const ids = (list) => list.map((it) => it.id);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[1] The count (DI-W105-1): one news card per three other cards, up to ten; fewer than three: fill to ten…');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  const TABLE = [[0, 10], [1, 10], [2, 10], [3, 1], [8, 2], [9, 3], [17, 5], [29, 9], [30, 10], [60, 10], [200, 10]];
  const bad = TABLE.filter(([n, k]) => home.newsSlotCount(n) !== k);
  assert(bad.length === 0 && home.NEWS_PER_NON_NEWS === 3 && home.NEWS_MAX_CARDS === 10, `1-1: the DI's table holds (0/1/2 -> 10, 3 -> 1, 8 -> 2, 9 -> 3, 17 -> 5, 29 -> 9, 30 -> 10, 60 -> 10) (wrong: ${bad.map(([n]) => `${n} -> ${home.newsSlotCount(n)}`).join(', ') || 'none'})`);
  const nine = Array.from({ length: 9 }, (_, i) => mkCard('c' + i, NOW - (i + 1) * HOUR));
  const news = { status: 'ready', items: Array.from({ length: 14 }, (_, i) => txt('n' + i, NOW - (i + 1) * 30 * MIN)) };
  assert(home.mergeFeed({ now: NOW, cards: nine, news }).filter((e) => e.kind === 'news').length === 3, '1-2: the test league\'s final week (9 other cards after v0.30.1) carries THREE news cards (was 2)');
  const many = Array.from({ length: 90 }, (_, i) => mkCard('c' + i, NOW - (i + 1) * 10 * MIN));
  assert(home.mergeFeed({ now: NOW, cards: many, news: { status: 'ready', items: Array.from({ length: 40 }, (_, i) => txt('n' + i, NOW - i * MIN)) } }).filter((e) => e.kind === 'news').length === 10, '1-3: never more than ten, however long the feed');
  const old = { status: 'ready', items: [txt('fresh', NOW - 47 * HOUR), pic('stale', NOW - 49 * HOUR, 'Fox News')] };
  assert(JSON.stringify(home.mergeFeed({ now: NOW, cards: [], news: old }).filter((e) => e.kind === 'news').map((e) => e.key)) === '["news:fresh"]', '1-4: a pictured story older than 48 hours is never chosen (the window comes first; a picture does not buy freshness)');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[2] selectNews (DI-W105-2): two of three slots to pictures, spread by anchors, the publisher guard, deterministic…');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  // (a) 18 ordinary cards over 24 hours (k = 6, wantP = 4); twelve pictured stories published evenly across those 24 hours (one every 2 hours, four publishers
  //     round-robin), in a relevance order that is NOT time order, plus eight text-only ESPN stories that lead the relevance order.
  const SPAN = 24 * HOUR;
  const cards18 = Array.from({ length: 18 }, (_, i) => mkCard('c' + String(i).padStart(2, '0'), NOW - Math.round(((i + 0.5) * SPAN) / 18)));
  const pics = Array.from({ length: 12 }, (_, i) => pic('p' + String(i).padStart(2, '0'), NOW - (2 * i + 1) * HOUR, PUBS[i % 4]));
  const relevance = [...Array.from({ length: 8 }, (_, i) => txt('t' + i, NOW - (3 * i + 2) * HOUR)), ...[5, 0, 9, 3, 11, 7, 1, 10, 4, 8, 2, 6].map((i) => pics[i])];
  const anchors = cards18.map((c) => c.sortKey);
  const chosen = home.selectNews(relevance, 6, anchors);
  const chosenP = chosen.filter(home.hasPicture);
  const sixth = (it) => Math.min(5, Math.floor((NOW - Date.parse(it.publishedAt)) / (SPAN / 6)));
  assert(chosen.length === 6 && chosenP.length === 4 && new Set(chosenP.map(sixth)).size === 4, `2-1 (a): six chosen, FOUR with a picture, in four DIFFERENT sixths of the feed's 24-hour span (sixths: ${chosenP.map(sixth).join(', ')})`);
  const merged = home.mergeFeed({ now: NOW, cards: cards18, news: { status: 'ready', items: relevance } });
  const ord = merged.filter((e) => e.kind === 'card' || e.kind === 'news');
  let run = 0, longest = 0;
  for (const e of ord) { if (e.kind === 'news' && home.hasPicture(e.item)) run = 0; else { run++; longest = Math.max(longest, run); } }
  assert(ord.filter((e) => e.kind === 'news').length === 6 && longest <= 7, `2-2 (a): in the merged feed the longest run of consecutive entries without a picture is ${longest} (no more than 7)`);
  // (a) again, the realistic order: relevance that runs NEWEST FIRST (fresher stories rank higher). Taking the first four pictured stories would bunch them in the newest
  // hours; only the anchors spread them through the day (the kit's K5 drops the anchors and must turn this red).
  const freshFirst = [...pics, ...Array.from({ length: 8 }, (_, i) => txt('u' + i, NOW - (3 * i + 2) * HOUR))];
  const spread = home.selectNews(freshFirst, 6, anchors).filter(home.hasPicture);
  const mergedFresh = home.mergeFeed({ now: NOW, cards: cards18, news: { status: 'ready', items: freshFirst } }).filter((e) => e.kind === 'card' || e.kind === 'news');
  let run2 = 0, longest2 = 0;
  for (const e of mergedFresh) { if (e.kind === 'news' && home.hasPicture(e.item)) run2 = 0; else { run2++; longest2 = Math.max(longest2, run2); } }
  assert(spread.length >= 4 && new Set(spread.map(sixth)).size >= 4 && longest2 <= 7,
    `2-1b (a): with relevance running NEWEST first, the chosen pictures still cover at least four different sixths of the day (${spread.map(sixth).join(', ')}), the longest picture-less run ${longest2} — not bunched in the newest hours`);
  assert(chosen.some((it) => !home.hasPicture(it)) && ids(chosen).filter((id) => /^t/.test(id)).every((id, i, arr) => i === 0 || Number(arr[i - 1].slice(1)) < Number(id.slice(1))), '2-3: the remaining slots are filled in RELEVANCE order, pictured or not (text-only ESPN still appears: the top text stories)');
  const pos = (id) => relevance.findIndex((it) => it.id === id);
  assert(ids(chosen).every((id, i, arr) => i === 0 || pos(arr[i - 1]) < pos(id)), '2-4: the result comes back in relevance order (the merge places each by its own time)');
  // (b) determinism
  const again = home.selectNews(relevance.map((it) => ({ ...it })), 6, anchors.slice());
  const shuffledAnchors = home.selectNews(relevance, 6, shuffle(anchors));
  const shuffledCards = home.mergeFeed({ now: NOW, cards: shuffle(cards18), news: { status: 'ready', items: relevance } });
  assert(JSON.stringify(ids(again)) === JSON.stringify(ids(chosen)) && JSON.stringify(ids(shuffledAnchors)) === JSON.stringify(ids(chosen)) && JSON.stringify(shuffledCards.map((e) => e.key)) === JSON.stringify(merged.map((e) => e.key)),
    '2-5 (b): identical output for identical inputs, for the anchors shuffled, and (end to end) for the cards shuffled');
  const realNow = Date.now, realRandom = Math.random;
  let runtime = null;
  try {
    Date.now = () => { throw new Error('selectNews read the clock'); };
    Math.random = () => { throw new Error('selectNews read a random value'); };
    runtime = home.selectNews(relevance, 6, anchors);
  } catch (e) { runtime = String(e && e.message); } finally { Date.now = realNow; Math.random = realRandom; }
  assert(Array.isArray(runtime) && JSON.stringify(ids(runtime)) === JSON.stringify(ids(chosen)), `2-6 (b): with Date.now and Math.random made to THROW, selectNews still returns the same choice (no clock, no random value at run time${Array.isArray(runtime) ? '' : `: ${runtime}`})`);
  // (c) the publisher guard
  const count = (list) => list.reduce((m, it) => m.set(it.publisher, (m.get(it.publisher) || 0) + 1), new Map());
  const foxHeavy = [...Array.from({ length: 10 }, (_, i) => pic('fox' + i, NOW - (i + 1) * 2 * HOUR, 'Fox News')), pic('ncaa0', NOW - 3 * HOUR, 'NCAA.com'), pic('si0', NOW - 13 * HOUR, 'Sports Illustrated'), pic('ncaa1', NOW - 19 * HOUR, 'NCAA.com'),
    ...Array.from({ length: 6 }, (_, i) => txt('espn' + i, NOW - i * HOUR)), txt('cbs0', NOW - 5 * HOUR, 'CBS Sports'), txt('nbc0', NOW - 6 * HOUR, 'NBC Sports'), txt('yahoo0', NOW - 7 * HOUR, 'Yahoo Sports'), txt('cbs1', NOW - 8 * HOUR, 'CBS Sports')];
  const g6 = home.selectNews(foxHeavy, 6, anchors), g10 = home.selectNews(foxHeavy, 10, anchors);
  const max6 = Math.max(...count(g6).values()), max10 = Math.max(...count(g10).values());
  assert(g6.length === 6 && max6 <= 2 && g10.length === 10 && max10 <= 4, `2-7 (c): no publisher takes more than its share — k = 6: at most 2 (most: ${max6}); k = 10: at most 4 (most: ${max10}) — though Fox News leads the relevance order ten deep`);
  assert(g6.filter(home.hasPicture).length >= 4 && g10.filter(home.hasPicture).length === 7 && count(g10).get('Fox News') === 4, `2-8 (c/e): under the guard the pictures still come from the OTHER pictured sites (k = 6: ${g6.filter(home.hasPicture).length}, at least 4; k = 10: ${g10.filter(home.hasPicture).length} = Fox at its cap of 4 + the three others)`);
  // (d) text only
  const textOnly = Array.from({ length: 12 }, (_, i) => txt('x' + i, NOW - i * HOUR, i < 9 ? 'ESPN' : 'CBS Sports'));
  assert(JSON.stringify(ids(home.selectNews(textOnly, 6, anchors))) === JSON.stringify(ids(textOnly.slice(0, 6))) && JSON.stringify(ids(home.selectNews(textOnly, 10, []))) === JSON.stringify(ids(textOnly.slice(0, 10))),
    '2-9 (d): a pool of text-only stories returns the first k by relevance — TODAY\'s selection with the new count (the state until the picture pins run), even when one site leads it');
  // (e) at least wantP whenever that many exist — including when the anchors' near window runs dry under the guard (the top-up)
  const topUp = [...Array.from({ length: 9 }, (_, i) => pic('a' + i, NOW - 2 * HOUR, 'Fox News')), pic('b0', NOW - 40 * HOUR, 'NCAA.com'), pic('b1', NOW - 41 * HOUR, 'Sports Illustrated'), ...Array.from({ length: 6 }, (_, i) => txt('e' + i, NOW - i * HOUR))];
  const tu = home.selectNews(topUp, 6, anchors);
  assert(tu.filter(home.hasPicture).length === 4 && count(tu).get('Fox News') === 2 && ids(tu).includes('b0') && ids(tu).includes('b1'), `2-10 (e): the near window (first 12 pictured) is all Fox News, capped at 2 — the next pictured stories in relevance order make up the four (${ids(tu.filter(home.hasPicture)).join(', ')})`);
  const fewer = [pic('only', NOW - 5 * HOUR, 'Fox News'), ...Array.from({ length: 8 }, (_, i) => txt('f' + i, NOW - i * HOUR))];
  const fw = home.selectNews(fewer, 6, anchors);
  assert(fw.length === 6 && fw.filter(home.hasPicture).length === 1 && JSON.stringify(ids(fw.filter((it) => !home.hasPicture(it)))) === JSON.stringify(['f0', 'f1', 'f2', 'f3', 'f4']), '2-11 (edge): fewer pictured stories than wanted — all of them are taken and the rest is relevance (no padding, no invented picture)');
  assert(fw.filter((it) => it.publisher === 'ESPN').length === 5, '2-11b (edge): …and the guard never EMPTIES a slot: with only ESPN left to fill, ESPN fills past its share rather than the feed losing news cards (one pinned picture never shrinks the count)');
  const mixedFill = [pic('m0', NOW - 2 * HOUR, 'Fox News'), ...Array.from({ length: 5 }, (_, i) => txt('e' + i, NOW - i * HOUR)), txt('c0', NOW - 9 * HOUR, 'CBS Sports'), txt('n0', NOW - 10 * HOUR, 'NBC Sports'), txt('y0', NOW - 11 * HOUR, 'Yahoo Sports')];
  const mf = home.selectNews(mixedFill, 6, anchors);
  assert(JSON.stringify(ids(mf)) === JSON.stringify(['m0', 'e0', 'e1', 'c0', 'n0', 'y0']), `2-11c: …but while other sites can fill, the guard holds (ESPN 2 of 6, the next slots go to CBS, NBC and Yahoo) (${ids(mf).join(', ')})`);
  // no anchors (no ordinary cards): the first wantP pictured by relevance
  const noAnchor = home.selectNews(relevance, 10, []);
  assert(JSON.stringify(ids(noAnchor.filter(home.hasPicture))) === JSON.stringify(ids(relevance.filter(home.hasPicture).filter((it, i, all) => true)).filter((id) => ids(noAnchor).includes(id))) && noAnchor.filter(home.hasPicture).length === 7
    && JSON.stringify(ids(noAnchor.filter(home.hasPicture))) === JSON.stringify(['p05', 'p00', 'p09', 'p03', 'p11', 'p07', 'p01']), `2-12: with no anchors (no ordinary cards) the first wantP (7 of 10) pictured stories by relevance are taken, the guard allowing (${ids(noAnchor.filter(home.hasPicture)).join(', ')})`);
  // (f) never twice; junk; storylines / content never reach it
  const dupObj = pics[0];
  const twice = home.selectNews([dupObj, dupObj, ...relevance], 6, anchors);
  const sameId = home.selectNews([{ ...pics[0] }, { ...pics[0] }, ...relevance], 6, anchors);
  assert(new Set(ids(twice)).size === twice.length && twice.length === 6 && new Set(ids(sameId)).size === sameId.length && sameId.length === 6, '2-13 (f): a story is never chosen twice (the same object, or the same id, offered twice counts once)');
  assert(JSON.stringify(home.selectNews(null, 6, anchors)) === '[]' && JSON.stringify(home.selectNews(relevance, 0, anchors)) === '[]' && JSON.stringify(home.selectNews(relevance, 'x', anchors)) === '[]'
    && home.selectNews([null, 5, 'x', ...relevance], 6, ['nope', null, ...anchors]).length === 6, '2-14: junk in, nothing thrown: no pool or no slots -> []; non-objects and unparseable anchors are ignored');
  assert(home.hasPicture({ imageUrl: 'https://a.example/x.jpg' }) && !home.hasPicture({ imageUrl: 'http://a.example/x.jpg' }) && !home.hasPicture({ imageUrl: '' }) && !home.hasPicture({ imageUrl: null }) && !home.hasPicture({ imageUrl: 'javascript:x' }) && !home.hasPicture(null),
    '2-15: hasPicture is exactly "a non-empty string beginning https://"');
  const storyPic = { ...pic('st1', NOW - HOUR, 'Fox News'), cardKind: 'storyline', storyline: { tag: 'A at B · Sat' } };
  const contentPic = { id: 'content_1', cardKind: 'matchup.preview', publishedAt: iso(NOW - HOUR), eligibleUntil: iso(NOW + HOUR), imageUrl: 'https://images.example/c.jpg' };
  const m3 = home.mergeFeed({ now: NOW, cards: cards18.slice(0, 9), news: { status: 'ready', items: [storyPic, contentPic, ...textOnly] } });
  const newsKeys = m3.filter((e) => e.kind === 'news').map((e) => e.key);
  assert(newsKeys.includes('news:st1') && newsKeys.includes('news:content_1') && newsKeys.filter((k) => /^news:x/.test(k)).length === 3, '2-16 (f): storylines and content cards are never counted or chosen by selectNews (they keep their own rule) — nine cards still give three headline slots, filled by relevance');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[3] mergeFeed end to end: placement untouched, the pinned card first, the count reads the cards on screen…');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  const cards = Array.from({ length: 12 }, (_, i) => mkCard('c' + String(i).padStart(2, '0'), NOW - (i + 1) * 2 * HOUR));
  const items = [...Array.from({ length: 6 }, (_, i) => pic('p' + i, NOW - (i * 4 + 1) * HOUR, PUBS[i % 4])), ...Array.from({ length: 6 }, (_, i) => txt('t' + i, NOW - (i + 1) * 30 * MIN))];
  const m = home.mergeFeed({ now: NOW, cards, news: { status: 'ready', items } });
  const ord = m.filter((e) => e.kind === 'card' || e.kind === 'news');
  assert(m[0].kind === 'now' && ord.every((e, i) => i === 0 || ord[i - 1].t >= e.t) && ord.filter((e) => e.kind === 'news').every((e) => e.t === new Date(Date.parse(e.item.publishedAt)).toISOString()),
    '3-1: the Now card stays pinned first; every chosen story sits at its OWN publish time; the ordinary feed is strictly newest first (FB-010)');
  assert(JSON.stringify(ord.filter((e) => e.kind === 'card').map((e) => e.key)) === JSON.stringify(cards.map((c) => c.id)), '3-2: nothing here moves a league card (their order is exactly their time order)');
  assert(ord.filter((e) => e.kind === 'news').length === 4 && ord.filter((e) => e.kind === 'news' && home.hasPicture(e.item)).length >= 3, '3-3: twelve cards -> four slots, at least three of them (ceil(2k/3)) stories with a picture');
  const withError = home.mergeFeed({ now: NOW, cards, feedError: true, news: { status: 'ready', items } });
  assert(withError.filter((e) => e.kind === 'news').length === 10, '3-4: a failed derivation is ONE error entry (fewer than three ordinary entries: news fills to ten), as before');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[4] The binder (DI-W105-4) with fake geometry: fade, instant, the three positions, Reduce Motion, the hook, the memory…');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const VIEW_H = 800;
function classList(init = []) {
  const set = new Set(init);
  return { add: (...c) => c.forEach((x) => set.add(x)), remove: (...c) => c.forEach((x) => set.delete(x)), contains: (c) => set.has(c), toString: () => [...set].join(' '), set };
}
function fakeImg({ src = 'https://a.espncdn.com/photo/x.jpg', top = 100, height = 190, complete = false, naturalWidth = 0 } = {}) {
  const l = {};
  const img = {
    nodeType: 1, classList: classList(['news-card__image']), complete, naturalWidth, style: { height: '' }, src,
    ownerDocument: { defaultView: { innerHeight: VIEW_H } },
    getAttribute: (n) => (n === 'src' ? src : null),
    getBoundingClientRect: () => ({ top, bottom: top + height, height, left: 0, right: 343, width: 343 }),
    get offsetHeight() { return height; },
    addEventListener: (t, f) => { (l[t] ||= []).push(f); }, removeEventListener: (t, f) => { l[t] = (l[t] || []).filter((x) => x !== f); },
    fire: (t, ev = {}) => (l[t] || []).slice().forEach((f) => f({ target: img, ...ev })), listeners: l,
    matches: () => false, querySelectorAll: () => [],
  };
  return img;
}
function fakeRoot(imgs = []) {
  const l = {};
  return {
    classList: classList(), imgs,
    addEventListener(t, f, c) { (l[t] ||= []).push({ f, c }); }, removeEventListener(t, f) { l[t] = (l[t] || []).filter((x) => x.f !== f); },
    fire(t, ev) { for (const x of (l[t] || []).slice()) x.f(ev); }, count(t) { return (l[t] || []).length; }, capture(t) { return (l[t] || []).every((x) => x.c === true); },
    querySelectorAll: (sel) => (sel === 'img.news-card__image' ? imgs : []), matches: () => false,
  };
}
const withMotion = async (reduce, fn) => {
  const saved = globalThis.window;
  globalThis.window = { matchMedia: (q) => ({ matches: reduce && /prefers-reduced-motion: reduce/.test(q) }), innerHeight: VIEW_H };
  try { return await fn(); } finally { if (saved === undefined) delete globalThis.window; else globalThis.window = saved; }
};
await withMotion(false, async () => {
  card._failedPicturesForTest.clear();
  // load and the cached path
  const cached = fakeImg({ complete: true, naturalWidth: 640 }), pending = fakeImg({ complete: false }), lazyChrome = fakeImg({ complete: true, naturalWidth: 0 });
  const root = fakeRoot([cached, pending, lazyChrome]);
  const calls = [];
  const unbind = card.bindNewsCardEvents(root, { items: [], onPictureRemoved: (x) => calls.push(x) });
  assert(root.classList.contains('news-images-bound') && root.count('load') === 1 && root.capture('load') && root.count('error') === 1 && root.capture('error'), '4-1: binding marks the root .news-images-bound (the hidden-until-loaded rule needs it) and adds ONE capture load and ONE capture error listener');
  assert(cached.classList.contains('is-loaded') && cached.classList.contains('news-card__image--instant') && !pending.classList.contains('is-loaded') && !lazyChrome.classList.contains('is-loaded'),
    '4-2: a picture already loaded when its node is there (complete, with pixels) is shown at once with NO transition; one still loading, or a deferred one with no pixels, is not');
  root.fire('load', { target: pending });
  assert(pending.classList.contains('is-loaded') && !pending.classList.contains('news-card__image--instant'), '4-3: a picture that loads afterwards gets is-loaded (the 150 ms fade) and not the instant class');
  root.fire('load', { target: { classList: classList(['something-else']) } });
  // the three positions
  const below = fakeImg({ top: VIEW_H + 40, src: 'https://a.espncdn.com/below.jpg' });
  root.fire('error', { target: below });
  assert(below.classList.contains('news-card__image--failed') && !below.classList.contains('news-card__image--collapsing') && below.style.height === '' && calls.length === 1 && calls[0].aboveViewport === false && calls[0].removedPx === 190,
    '4-4: a picture wholly BELOW the viewport is removed at once (no animation nobody would see), and the hook hears { removedPx: 190, aboveViewport: false } (no scroll)');
  const onScreen = fakeImg({ top: 200, src: 'https://a.espncdn.com/on.jpg' });
  root.fire('error', { target: onScreen });
  assert(onScreen.classList.contains('news-card__image--collapsing') && !onScreen.classList.contains('news-card__image--failed') && onScreen.style.height === '0px' && calls.length === 2 && calls[1].aboveViewport === false,
    '4-5: a picture ON SCREEN collapses (the --collapsing class, its height animating from the measured 190 to 0 while it fades) and nothing scrolls');
  onScreen.fire('transitionend', { target: { other: true } });
  assert(!onScreen.classList.contains('news-card__image--failed'), '4-5b: …a transitionend from some other element does not end it');
  onScreen.fire('transitionend');
  assert(onScreen.classList.contains('news-card__image--failed') && !onScreen.classList.contains('news-card__image--collapsing') && onScreen.style.height === '' && (onScreen.listeners.transitionend || []).length === 0,
    '4-6: …and when the collapse ends the picture is gone (--failed), the measured height is cleared and the listener removed: a clean text card');
  const above = fakeImg({ top: -500, src: 'https://a.espncdn.com/above.jpg' });
  root.fire('error', { target: above });
  assert(above.classList.contains('news-card__image--failed') && !above.classList.contains('news-card__image--collapsing') && calls.length === 3 && calls[2].aboveViewport === true && calls[2].removedPx === 190,
    '4-7: a picture wholly ABOVE the viewport is removed at once and the hook hears { removedPx: 190, aboveViewport: true } — exactly once, exactly its height (Home scrolls by it)');
  const partly = fakeImg({ top: -195, height: 190, src: 'https://a.espncdn.com/partly.jpg' });   // the card's text still on screen, its picture scrolled past the top
  root.fire('error', { target: partly });
  assert(partly.classList.contains('news-card__image--failed') && calls.length === 4 && calls[3].aboveViewport === true, '4-8: a partly visible card whose PICTURE is above the top counts as above (collapsing it would slide the text the reader is on)');
  const straddle = fakeImg({ top: -60, src: 'https://a.espncdn.com/straddle.jpg' });
  root.fire('error', { target: straddle });
  assert(straddle.classList.contains('news-card__image--collapsing') && calls[4].aboveViewport === false, '4-9: a picture that straddles the top edge is on screen: it collapses');
  root.fire('error', { target: straddle });
  root.fire('error', { target: below });
  assert(calls.length === 5, '4-10: a second error for a picture already going or gone does nothing (one hook call per picture)');
  root.fire('error', { target: { classList: classList(['not-a-news-picture']) } });
  assert(calls.length === 5, '4-11: an error from anything that is not a news picture is ignored');
  // the memory
  assert(['https://a.espncdn.com/below.jpg', 'https://a.espncdn.com/on.jpg', 'https://a.espncdn.com/above.jpg'].every((u) => card._failedPicturesForTest.has(u)), '4-12: each failed picture is remembered (its URL, in memory)');
  const item = { id: 'n1', headline: 'H', source: 'ESPN', sport: 'cfb', publishedAt: iso(NOW - HOUR), imageUrl: 'https://a.espncdn.com/on.jpg', url: 'https://www.espn.com/x' };
  const fresh = { ...item, id: 'n2', imageUrl: 'https://a.espncdn.com/fine.jpg' };
  assert(!/<img/.test(card.renderNewsCard(item)) && /news-card__headline/.test(card.renderNewsCard(item)) && /<img class="news-card__image" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" src="https:\/\/a\.espncdn\.com\/fine\.jpg">/.test(card.renderNewsCard(fresh)),
    '4-13: a picture that failed on this page is not drawn again — the card renders as a text card (no box, no request, no jump on Home\'s next repaint); any other picture renders exactly as shipped');
  unbind();
  assert(!root.classList.contains('news-images-bound') && root.count('load') === 0 && root.count('error') === 0 && root.count('click') === 0 && root.count('keydown') === 0, '4-14: unbind removes the root class (a root without the binder shows its pictures as before) and every listener it added');
  // the hook's throw is contained
  const root2 = fakeRoot([]);
  card.bindNewsCardEvents(root2, { items: [], onPictureRemoved: () => { throw new Error('hook boom'); } });
  const warn = console.warn; let warned = 0; console.warn = () => { warned++; };
  const t1 = fakeImg({ top: -500, src: 'https://a.espncdn.com/t1.jpg' }), t2 = fakeImg({ top: VIEW_H + 10, src: 'https://a.espncdn.com/t2.jpg' });
  try { root2.fire('error', { target: t1 }); root2.fire('error', { target: t2 }); } finally { console.warn = warn; }
  assert(t1.classList.contains('news-card__image--failed') && t2.classList.contains('news-card__image--failed') && warned === 2, '4-15: a throwing onPictureRemoved is logged, never thrown into the binder (the next picture is still handled)');
  // offline failures are not remembered; the cap
  const savedNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
  try { root2.fire('error', { target: fakeImg({ top: VIEW_H + 10, src: 'https://a.espncdn.com/offline.jpg' }) }); } finally { if (savedNav) Object.defineProperty(globalThis, 'navigator', savedNav); else delete globalThis.navigator; }
  assert(!card._failedPicturesForTest.has('https://a.espncdn.com/offline.jpg'), '4-16: a failure while the device is OFFLINE is not remembered (every picture fails then; none is broken)');
  card._failedPicturesForTest.clear();
  const root3 = fakeRoot([]);
  card.bindNewsCardEvents(root3, { items: [] });
  for (let i = 0; i < card.FAILED_PICTURES_CAP + 50; i++) root3.fire('error', { target: fakeImg({ top: VIEW_H + 10, src: `https://a.espncdn.com/c${i}.jpg` }) });
  assert(card._failedPicturesForTest.size === card.FAILED_PICTURES_CAP && card.FAILED_PICTURES_CAP === 200, '4-17: the memory is capped (200 URLs), so it can never grow without bound');
  card._failedPicturesForTest.clear();
});
await withMotion(true, async () => {
  const root = fakeRoot([]); const calls = [];
  card.bindNewsCardEvents(root, { items: [], onPictureRemoved: (x) => calls.push(x) });
  const onScreen = fakeImg({ top: 200, src: 'https://a.espncdn.com/rm.jpg' });
  root.fire('error', { target: onScreen });
  assert(onScreen.classList.contains('news-card__image--failed') && !onScreen.classList.contains('news-card__image--collapsing') && onScreen.style.height === '' && calls.length === 1 && calls[0].aboveViewport === false,
    '4-18: Reduce Motion — a picture on screen is removed at once (no collapse animation)');
  card._failedPicturesForTest.clear();
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[5] The wiring: newsFeed forwards the hook; app.js holds the reader\'s place through home.js\'s scrollPageBy…');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  await withMotion(false, async () => {
    const hn = feed.createHomeNews({});
    const root = fakeRoot([]); const calls = [];
    const un = hn.bindEvents(root, { onPictureRemoved: (x) => calls.push(x) });
    root.fire('error', { target: fakeImg({ top: -400, src: 'https://a.espncdn.com/wire.jpg' }) });
    assert(calls.length === 1 && calls[0].aboveViewport === true && calls[0].removedPx === 190 && root.classList.contains('news-images-bound'), '5-1: newsFeed.bindEvents(root, { onPictureRemoved }) forwards the hook to the news binder (a real error on a bound root reaches it)');
    un();
    card._failedPicturesForTest.clear();
  });
  const APP = await read('js/app.js');
  const holdBody = (() => { const a = APP.indexOf('function holdHomePlaceForPicture('); if (a < 0) return ''; const b = APP.indexOf('\n}\n', a); return APP.slice(a, b + 2); })();
  assert(holdBody === "function holdHomePlaceForPicture({ removedPx, aboveViewport } = {}) {\n  if (aboveViewport !== true || !Number.isFinite(removedPx) || removedPx <= 0) return false;\n  return scrollPageBy(-removedPx, 'instant');\n}",
    '5-2: js/app.js holdHomePlaceForPicture is exactly the pinned body: only a picture ABOVE the viewport moves the page, by -removedPx, instantly, through scrollPageBy');
  const binds = [...APP.matchAll(/homeNews\.bindEvents\(([^)]*)\)/g)].map((m) => m[1]);
  assert(binds.length === 1 && binds[0] === 'root, { onPictureRemoved: holdHomePlaceForPicture }' && /import \{ createHome, makeChatCandidateSource, shortWhen, scrollPageBy \} from '\.\/home\.js';/.test(APP),
    `5-3: Home's ONE news binding passes exactly { onPictureRemoved: holdHomePlaceForPicture } (no custom onOpen: security C2), and scrollPageBy is home.js's own (${binds.join(' | ')})`);
  const saved = globalThis.window; const scrolls = [];
  globalThis.window = { scrollBy: (o) => scrolls.push(o), scrollY: 1200 };
  try {
    const before = nav.isNavHidePaused();
    const moved = home.scrollPageBy(-190, 'instant');
    assert(moved === true && scrolls.length === 1 && scrolls[0].top === -190 && scrolls[0].left === 0 && scrolls[0].behavior === 'instant' && nav.isNavHidePaused() && !before, '5-4: home.scrollPageBy(-190) scrolls the window up by exactly 190, instantly, and pauses the tab bar\'s hide-on-scroll (the scroll is the app\'s, not the reader\'s)');
    assert(home.scrollPageBy(0.4) === false && scrolls.length === 1, '5-5: a removal under a point moves nothing');
  } finally { if (saved === undefined) delete globalThis.window; else globalThis.window = saved; }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[6] Static guards, allow-list form (P-11): marks emitters, image-validator call sites, host lists, <img> sinks…');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  const files = (await readdir(HERE + 'js')).filter((f) => f.endsWith('.js')).sort();
  const SRC = {};
  for (const f of files) SRC['js/' + f] = await read('js/' + f);
  const occ = (re) => Object.entries(SRC).flatMap(([f, src]) => src.split('\n').map((line, i) => ({ f, line: line.trim(), n: i + 1 })).filter((x) => re.test(x.line) && !/^(\*|\/\/|\/\*)/.test(x.line)));
  // (1) who may emit the marks row
  const marks = occ(/feed-card-marks/);
  assert(marks.length === 1 && marks[0].f === 'js/home.js' && marks[0].line === "return joinHtml(['<div class=\"feed-card-marks\" aria-hidden=\"true\">', lockup(away), lockup(home), '</div>']);",
    `6-1: exactly ONE place emits feed-card-marks — js/home.js gameMarksHTML's pinned line (found: ${marks.map((x) => `${x.f}:${x.n}`).join(', ') || 'none'})`);
  // (3) every image-validator call site: file + exact line text; any other fails, a pinned one that disappeared fails
  const PINNED_VALIDATOR_CALLS = [
    ['js/newsCard.js', "return isAllowedImageUrl(raw, Array.isArray(hosts) ? hosts : ESPN_IMAGE_LIST);           // D1: ONE validator, newsRules.js; a server item passes its source's pinned hosts"],
    ['js/newsCard.js', "const allowedSrc = isAllowedNewsImageUrl(item.imageUrl, Array.isArray(item.imageHosts) ? item.imageHosts : null);"],
    ['js/newsTransport.js', "const candidate = img && typeof img === 'object' ? isAllowedNewsImageUrl(logoOk(img.url)) : null;"],
    ['js/newsTransport.js', "const imageUrl = picturesOn && typeof row.image_url === 'string' ? isAllowedImageUrl(row.image_url, source.imageHosts) : null;"],
  ];
  const calls = occ(/isAllowed(News)?ImageUrl\(/).filter((x) => !/^export function /.test(x.line)).map((x) => [x.f, x.line]);
  const extra = calls.filter((c) => !PINNED_VALIDATOR_CALLS.some((p) => p[0] === c[0] && p[1] === c[1]));
  const missing = PINNED_VALIDATOR_CALLS.filter((p) => !calls.some((c) => c[0] === p[0] && c[1] === p[1]));
  assert(extra.length === 0 && missing.length === 0 && calls.length === PINNED_VALIDATOR_CALLS.length, `6-2: the picture validators are called at EXACTLY the four pinned lines (ingest, render) — none added, none gone (extra: ${extra.map((c) => c.join(': ')).join(' | ') || 'none'}; missing: ${missing.map((c) => c[0]).join(', ') || 'none'})`);
  assert(Array.isArray(rules.SHARED_IMAGE_CDNS) && rules.SHARED_IMAGE_CDNS.length === 0 && Object.isFrozen(rules.SHARED_IMAGE_CDNS), '6-3: SHARED_IMAGE_CDNS is still EMPTY (every picture host is pinned per source; nothing is shared)');
  assert(JSON.stringify(card.NEWS_IMAGE_HOSTS) === JSON.stringify({ suffixes: ['.espncdn.com', '.espn.com'], exact: ['espncdn.com', 'espn.com', 'espnmedia-cdn.akamaized.net'] }),
    '6-4: the ESPN contingency picture hosts are exactly today\'s (.espncdn.com, .espn.com suffixes; espncdn.com, espn.com, espnmedia-cdn.akamaized.net exact)');
  assert(JSON.stringify(rules.FORBIDDEN_IMAGE_PROXIES) === JSON.stringify(['i0.wp.com', 'i1.wp.com', 'i2.wp.com', 'images.weserv.nl', 'res.cloudinary.com', 'googleusercontent.com']) && rules.IMAGE_HOST_DENYLIST.length >= 5 && Object.isFrozen(rules.IMAGE_HOST_DENYLIST),
    '6-5: the forbidden picture proxies are exactly today\'s and the denylist stands');
  // a picture from a host the source did not pin, or from a forbidden proxy, is never drawn — at render, whatever selectNews preferred
  const it = (imageUrl, imageHosts) => card.renderNewsCard({ id: 'h', headline: 'H', source: 'Fox News', publisher: 'Fox News', sport: 'cfb', publishedAt: iso(NOW - HOUR), imageUrl, imageHosts });
  assert(!/<img/.test(it('https://evil.example/x.jpg', ['a57.foxnews.com'])) && !/<img/.test(it('https://i0.wp.com/a57.foxnews.com/x.jpg', ['i0.wp.com'])) && !/<img/.test(it('https://a57.foxnews.com/x.jpg', [])) && /<img/.test(it('https://a57.foxnews.com/x.jpg', ['a57.foxnews.com'])),
    '6-6: the card draws a picture ONLY from its source\'s pinned host (an unpinned host, a forbidden proxy, an empty pin list: no <img>) — hasPicture prefers, it never admits');
  // the <img> sinks of the news and lockup paths
  const sinks = occ(/<img /).filter((x) => ['js/newsCard.js', 'js/home.js', 'js/newsFeed.js', 'js/keyed-list.js', 'js/content-card.js'].includes(x.f)).map((x) => `${x.f}: ${x.line}`);
  assert(JSON.stringify(sinks) === JSON.stringify([
    "js/keyed-list.js: ? `<span class=\"matrix-hdr-logo-box tl-box\"><img class=\"matrix-hdr-logo\" src=\"${escHtml(logoUrl)}\" alt=\"\" loading=\"lazy\" referrerpolicy=\"no-referrer\"></span>` : '';",
    "js/newsCard.js: const image = imageSrc ? `<img class=\"news-card__image\" alt=\"\" loading=\"lazy\" decoding=\"async\" referrerpolicy=\"no-referrer\" src=\"${esc(imageSrc)}\">` : '';",
  ]), `6-7: the news and lockup paths hold exactly the two pinned <img> sinks (the shipped lockup, the shipped news picture); home.js builds none of its own (${sinks.length})`);
}

console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
