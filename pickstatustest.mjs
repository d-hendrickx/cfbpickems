/**
 * CFB Pickems — pickstatustest.mjs
 * ================================
 * UN-412 / DI-500 … DI-502 / DI-506(a)(c) / DI-507 — "WHO'S IN" (Social Platform, Feature 1, 2026-10-01).
 *
 * Drew, 2026-10-01: "while I shouldn't be able to see the other players picks before the week is live I should be able to
 * see who has picked." Names and two integers — never a pick. THE BLIND RULE IS THE POINT OF THIS FILE: every placement is
 * driven with distinctive team strings planted in other players' rows, in BOTH the local-mode world (every pick is on the
 * device) and the supabase-mode world (RLS leaves only the viewer's own rows), and none of them may reach any strip.
 *
 * Run:  node pickstatustest.mjs
 * Also: for tz in UTC America/Los_Angeles; do TZ=$tz node pickstatustest.mjs; done
 *
 * SECTIONS
 *   [1]  the module's contract: pure, reader-injected, iOS-15-safe, no storage / DOM / random
 *   [2]  the model — one definition, three states, every week status (DI-500)
 *   [3]  the words — every string of DI-501, exactly
 *   [4]  the markup — states, never red, escaping with hostile names, no pick content (DI-500d, DI-501)
 *   [5]  patching in place — only what changed, the same nodes, a replace only when the roster changed (DI-502e item 3)
 *   [6]  the throttle — one per 20 s, never two in flight, one trailing, a hang cut off (DI-502e)
 *   [7]  the chat arrival helper (DI-506c)
 *   [8]  the CSS block — tokens only, never red, Reduce Motion per animated selector, 8 pt grid
 *   [9]  the definition at every call site: strip == submissionStateFor == Home's count == the server's rule (DI-500c)
 *   [10] placements on every render path, in order (DI-502a/b)
 *   [11] THE BLIND RULE, end to end, both worlds, with positive controls
 *   [12] freshness wiring: screen entry, own submit, chat arrival, the tick; the seam wrapper (DI-502e, DI-506c)
 *   [13] the touched-screen fixes: the matrix gate's button, the commissioner's "everyone picked" (A1)
 *   [14] the retired emitter and the boot-order position of the arrival hook (DI-506a, boot-order rule)
 */

import { readFile } from 'node:fs/promises';

// ═════════════════════════════════════════════════════════════════════════════
// harness
// ═════════════════════════════════════════════════════════════════════════════
setTimeout(() => { console.error('pickstatustest WATCHDOG: the run exceeded 90 s'); process.exit(2); }, 90000).unref();
let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}
const quiet = (fn) => { const w = console.warn, e = console.error, i = console.info; console.warn = () => {}; console.error = () => {}; console.info = () => {}; try { return fn(); } finally { console.warn = w; console.error = e; console.info = i; } };
const quietAsync = async (fn) => { const w = console.warn, e = console.error, i = console.info; console.warn = () => {}; console.error = () => {}; console.info = () => {}; try { return await fn(); } finally { console.warn = w; console.error = e; console.info = i; } };

const SRC = {
  ps: await readFile(new URL('./js/pick-status.js', import.meta.url), 'utf8'),
  app: await readFile(new URL('./js/app.js', import.meta.url), 'utf8'),
  css: await readFile(new URL('./css/styles.css', import.meta.url), 'utf8'),
  storage: await readFile(new URL('./js/storage.js', import.meta.url), 'utf8'),
  adapter: await readFile(new URL('./js/supabase-backend.js', import.meta.url), 'utf8'),
};
/** Comments out, so a source-position scan can never be satisfied by prose (the boot-order rule, 2026-09-26). */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map(l => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');

console.log(`\n[TZ=${process.env.TZ || '(system default)'}] pickstatustest.mjs — UN-412 "Who's in"\n`);

const PS = await import('./js/pick-status.js');
const { pickStatusFor, pickStatusCopy, renderPickStatusHTML, patchPickStatus, pickStatusSignature, createPickStatusRefresher,
  newPicksInArrival, isPicksInRow, PICK_STATUS_THROTTLE_MS, PICK_STATUS_TICK_MIN_AGE_MS, PICK_STATUS_STALE_NOTE_MS, PICK_STATUS_TIMEOUT_MS } = PS;

/** The app's own escaper (js/app.js escHtml): & < > " */
const esc = (s) => (s ? String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : '');

// ── a tiny DOM, built by PARSING the real markup, so patchPickStatus is driven against what the app actually emits ──
class El {
  constructor(tag, attrs = {}) { this.tag = tag; this.attrs = attrs; this.children = []; this.parent = null; this.text = ''; this.writes = []; this.removed = false; this.replacedWith = null; }
  getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; }
  setAttribute(n, v) { this.attrs[n] = String(v); this.writes.push(`attr:${n}`); }
  removeAttribute(n) { delete this.attrs[n]; this.writes.push(`rm:${n}`); }
  get classList() {
    const self = this;
    const get = () => String(self.attrs.class || '').split(/\s+/).filter(Boolean);
    return {
      add(c) { const a = get(); if (!a.includes(c)) { self.attrs.class = [...a, c].join(' '); self.writes.push(`class+${c}`); } },
      remove(c) { const a = get(); if (a.includes(c)) { self.attrs.class = a.filter(x => x !== c).join(' '); self.writes.push(`class-${c}`); } },
      contains(c) { return get().includes(c); },
    };
  }
  get textContent() { return this.text + this.children.map(c => c.textContent).join(''); }
  set textContent(v) { this.children = []; this.text = String(v); this.writes.push('text'); }
  matches(sel) {
    if (sel.startsWith('.')) return String(this.attrs.class || '').split(/\s+/).includes(sel.slice(1));
    const m = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(sel);
    if (m) return m[2] === undefined ? this.getAttribute(m[1]) !== null : this.getAttribute(m[1]) === m[2];
    return this.tag === sel;
  }
  querySelectorAll(sel) { const out = []; const walk = (n) => { for (const c of n.children) { if (c.matches(sel)) out.push(c); walk(c); } }; walk(this); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest(sel) { let n = this; while (n) { if (n.matches(sel)) return n; n = n.parent; } return null; }
  set outerHTML(v) { this.replacedWith = String(v); this.writes.push('outerHTML'); }
  remove() { this.removed = true; }
}
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function parseHtml(html) {
  const root = new El('#root');
  let cur = root;
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[\w-]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[5] !== undefined) { cur.text += decode(m[5]); continue; }
    const [, closing, tag, attrSrc, selfClose] = m;
    if (closing) { if (cur.parent) cur = cur.parent; continue; }
    const attrs = {};
    for (const a of attrSrc.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] === undefined ? '' : decode(a[2]);
    const el = new El(tag, attrs); el.parent = cur; cur.children.push(el);
    if (!selfClose) cur = el;
  }
  return root;
}

// ═════════════════════════════════════════════════════════════════════════════
// fixtures — the six-player league of the mockup, Brayden (index 1) is the viewer
// ═════════════════════════════════════════════════════════════════════════════
const ROSTER = [['p1', 'Drew', 'DH'], ['p2', 'Brayden', 'BR'], ['p3', 'Kevin', 'KV'], ['p4', 'Koby', 'KO'], ['p5', 'Jacob', 'JA'], ['p6', 'Kihoon', 'KH']];
const players = (over = {}) => ROSTER.map(([playerId, displayName, initials]) => ({ playerId, displayName, initials, active: true, ...(over[playerId] || {}) }));
const WEEK = (over = {}) => ({ weekId: 'w6', status: 'open', dataSourceMode: 'live', ...over });
const GAMES = [{ gameId: 'g1', weekId: 'w6' }, { gameId: 'g2', weekId: 'w6' }];
const AT = '2026-10-10T16:00:00.000Z';
/** read.state from a { playerId: 'yes'|'no'|'unknown' } map (a missing id is 'unknown' — absent is not zero). */
const readOf = (map, over = {}) => ({ state: (w, p) => (map[p] === undefined ? 'unknown' : map[p]), asOf: () => AT, isPublic: () => false, ...over });
const model = (map, over = {}) => pickStatusFor({ week: WEEK(over.week), games: GAMES, players: players(over.players), viewerId: over.viewerId === undefined ? 'p2' : over.viewerId, isCommissioner: !!over.isCommissioner, read: over.read || readOf(map), now: over.now ?? Date.parse(AT) + 5000 });
const OPEN_4 = { p1: 'yes', p2: 'no', p3: 'yes', p4: 'yes', p5: 'yes', p6: 'no' };
const FORBIDDEN = ['selectedTeam', 'pickCount', 'lastUpdated', 'hasTiebreaker', 'hasExtraPoint'];

// ═════════════════════════════════════════════════════════════════════════════
console.log('[1] THE MODULE CONTRACT — pure, reader-injected, no storage / DOM / random…');
// ═════════════════════════════════════════════════════════════════════════════
{
  const c = code(SRC.ps);
  const imports = [...c.matchAll(/^import\s[^;]*from\s+'([^']+)'/gm)].map(m => m[1]).sort();
  assert(JSON.stringify(imports) === JSON.stringify(['./data-model.js', './icons.js']),
    `[1a] pick-status.js imports ONLY data-model.js (initials) and icons.js (the check) — no storage, no DOM module, no adapter (got ${JSON.stringify(imports)})`);
  assert(!/localStorage|sessionStorage|document\.|window\.|Math\.random|\bfetch\(|XMLHttp/.test(c),
    '[1b] no localStorage (the seam), no document / window, no Math.random, no network of its own');
  assert((c.match(/Date\.now\(\)/g) || []).length === 2 && /now = Date\.now\(\)/.test(c) && /now = \(\) => Date\.now\(\)/.test(c),
    '[1c] the clock is INJECTED: Date.now() appears only as the two parameter defaults (pickStatusFor, the refresher)');
  assert(!/\.at\(|Object\.hasOwn\(|structuredClone|replaceAll\(/.test(c), '[1d] iOS 15 safe: no .at(), Object.hasOwn, structuredClone or replaceAll');
  assert(!/\blet\b[^;\n]*\bvar\b|\bvar\s/.test(c), '[1e] const / let only — never var (CONVENTIONS #2)');
  let threw = null;
  try { renderPickStatusHTML(model(OPEN_4)); } catch (e) { threw = e; }
  assert(threw instanceof TypeError && /escHtml/.test(threw.message), '[1f] renderPickStatusHTML() with no escHtml THROWS — the sink escapes and there is no default (CONVENTIONS #12)');
  threw = null;
  try { pickStatusFor({ week: WEEK(), games: GAMES, players: players(), viewerId: 'p2', read: { state: () => 'yes' } }); } catch (e) { threw = e; }
  assert(threw instanceof TypeError, '[1g] a missing reader (asOf / isPublic) THROWS at the call, never a silent guess');
  for (const n of ['PICK_STATUS_THROTTLE_MS', 'PICK_STATUS_TICK_MIN_AGE_MS', 'PICK_STATUS_STALE_NOTE_MS', 'PICK_STATUS_TIMEOUT_MS']) assert(Number.isFinite(PS[n]), `[1h] ${n} is exported`);
  assert(PICK_STATUS_THROTTLE_MS === 20000 && PICK_STATUS_TICK_MIN_AGE_MS === 60000 && PICK_STATUS_STALE_NOTE_MS === 300000,
    '[1i] the numbers are the DI\'s: 20 s throttle, 60 s tick age, 5 minute "Last checked" threshold');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[2] THE MODEL — one definition, three states, every week status…');
// ═════════════════════════════════════════════════════════════════════════════
{
  const m = model(OPEN_4);
  assert(m.phase === 'open' && m.total === 6 && m.inCount === 4 && m.known === true && m.loading === false,
    '[2a] four of six in, open phase, known');
  assert(m.members.map(x => x.playerId).join() === 'p1,p2,p3,p4,p5,p6' && m.members.map(x => x.state).join() === 'in,notyet,in,in,in,notyet',
    '[2b] members are in ROSTER ORDER (the viewer is not moved) with states in / notyet');
  assert(m.members.filter(x => x.isViewer).length === 1 && m.members[1].isViewer === true, '[2c] exactly one viewer tile, in his own roster slot');
  assert(m.members[0].name === 'Drew' && m.members[0].initials === 'DH', '[2d] name and initials come from the roster record');

  // the three-valued answer (DI-T4.11): 'unknown' is NEVER "not yet"
  const u = model({ p1: 'unknown', p2: 'no', p3: 'unknown', p4: 'unknown', p5: 'unknown', p6: 'unknown' });
  assert(u.known === false && u.inCount === 0 && u.members.filter(x => x.state === 'unknown').length === 5 && u.members[1].state === 'notyet',
    '[2e] when nothing is known, five tiles are UNKNOWN (not "notyet") and the viewer\'s own (always known) stays "notyet" — absent is not zero');
  const part = model({ ...OPEN_4, p5: 'unknown' });
  assert(part.known === false && part.members[4].state === 'unknown' && part.members[0].state === 'in',
    '[2f] ONE unknown member: the strip shows what it knows and marks the one it cannot, and the whole is not "known"');
  const weird = model({ ...OPEN_4, p3: 'maybe' });
  assert(weird.members[2].state === 'unknown', '[2g] a reader that answers anything but yes / no is treated as unknown — the strip never invents an answer');
  const thrower = pickStatusFor({ week: WEEK(), games: GAMES, players: players(), viewerId: 'p2', read: readOf({}, { state: () => { throw new Error('x'); } }) });
  assert(thrower.members.every(x => x.state === 'unknown'), '[2h] a throwing reader reads as unknown, not as a crash and not as zero');

  // week statuses (DI-500e, section 4 matrix)
  assert(model(OPEN_4, { week: { status: 'locked' } }).phase === 'locked', '[2i] a LOCKED week shows the strip, in the locked phase');
  for (const st of ['draft', 'live', 'final', 'paused', '', undefined]) {
    assert(model(OPEN_4, { week: { status: st } }).phase === 'hidden', `[2j] status ${JSON.stringify(st)} -> no strip`);
  }
  assert(model(OPEN_4, { read: readOf(OPEN_4, { isPublic: () => true }) }).phase === 'hidden', '[2k] picks public (the reveal happened) -> no strip even if the status string still says open');
  assert(model(OPEN_4, { read: readOf(OPEN_4, { isPublic: () => { throw new Error('x'); } }) }).phase === 'hidden', '[2l] a throwing reveal check FAILS CLOSED: no strip');
  assert(model(OPEN_4, { read: readOf(OPEN_4, { isPublic: () => undefined }) }).phase === 'hidden', '[2m] a reveal check that answers nothing fails closed too');

  // demo weeks: the commissioner only (UN-71)
  assert(model(OPEN_4, { week: { dataSourceMode: 'demo' } }).phase === 'hidden', '[2n] a DEMO week shows a player nothing');
  assert(model(OPEN_4, { week: { dataSourceMode: 'demo' }, isCommissioner: true }).phase === 'open', '[2o] …and shows the commissioner the strip');

  // who sees it
  assert(model(OPEN_4, { viewerId: '' }).phase === 'hidden' && model(OPEN_4, { viewerId: null }).phase === 'hidden', '[2p] no viewer (signed out / unverified) -> no strip');
  assert(model(OPEN_4, { viewerId: 'p9' }).phase === 'hidden', '[2q] a viewer who is not on the roster -> no strip');
  assert(model(OPEN_4, { players: { p2: { active: false } } }).phase === 'hidden', '[2r] a DEACTIVATED viewer is shown nothing new');
  const inactive = model(OPEN_4, { players: { p6: { active: false } } });
  assert(inactive.total === 5 && inactive.members.every(x => x.playerId !== 'p6') && inactive.inCount === 4, '[2s] a deactivated member is not listed and not counted (total 5)');
  assert(pickStatusFor({ week: WEEK(), games: [], players: players(), viewerId: 'p2', read: readOf(OPEN_4) }).phase === 'hidden', '[2t] a week with no games has nothing to be "in" for -> no strip');
  assert(pickStatusFor({ week: WEEK(), games: GAMES, players: players().slice(0, 1), viewerId: 'p1', read: readOf(OPEN_4) }).phase === 'hidden', '[2u] fewer than two members -> no strip');
  assert(pickStatusFor({ week: null, games: GAMES, players: players(), viewerId: 'p2', read: readOf(OPEN_4) }).phase === 'hidden', '[2v] no week -> no strip');
  const dup = pickStatusFor({ week: WEEK(), games: GAMES, players: [...players(), { playerId: 'p3', displayName: 'Kevin', active: true }], viewerId: 'p2', read: readOf(OPEN_4) });
  assert(dup.total === 6, '[2w] a player record listed twice is counted once');

  // the definition itself (DI-500a): the model COUNTS the reader's "yes", and a reader is the app's one definition
  const every = model(Object.fromEntries(ROSTER.map(([id]) => [id, 'yes'])));
  assert(every.inCount === 6 && every.members.every(x => x.state === 'in'), '[2x] six yes -> six in');
  const none = model(Object.fromEntries(ROSTER.map(([id]) => [id, 'no'])));
  assert(none.inCount === 0 && none.known === true, '[2y] six no -> zero in, still KNOWN (a true zero is not an unknown)');

  // the skeleton: asked for, nothing on the device yet
  const loadingModel = model({ p2: 'no' }, { read: readOf({ p2: 'no' }, { pending: () => true }) });
  assert(loadingModel.loading === true && loadingModel.members.every(x => x.state === 'loading') && loadingModel.known === false, '[2z] pending + every other member unknown -> the skeleton (all tiles loading)');
  const pendingButKnown = model(OPEN_4, { read: readOf(OPEN_4, { pending: () => true }) });
  assert(pendingButKnown.loading === false && pendingButKnown.members[0].state === 'in', '[2z2] pending WITH an answer on the device keeps the answer on screen — no skeleton flash on a refresh');
  const notPending = model({ p2: 'no' });
  assert(notPending.loading === false, '[2z3] unknown and NOT pending is the calm unknown state, never a skeleton that could sit forever');

  // staleness (DI-502e item 4)
  const fresh = model(OPEN_4, { now: Date.parse(AT) + 4 * 60e3 });
  const old = model(OPEN_4, { now: Date.parse(AT) + 6 * 60e3 });
  assert(fresh.stale === false && old.stale === true, '[2z4] an answer older than 5 minutes is stale; a fresher one is not');
  assert(model(OPEN_4, { read: readOf(OPEN_4, { asOf: () => '' }), now: Date.parse(AT) + 99 * 60e3 }).stale === false, '[2z5] no stamp -> never "stale" (local mode has no stamp and no staleness)');
  assert(model({ p2: 'no' }, { now: Date.parse(AT) + 99 * 60e3 }).stale === false, '[2z6] an UNKNOWN strip is not also "stale" — it has its own sentence');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[3] THE WORDS — every string of DI-501, exactly…');
// ═════════════════════════════════════════════════════════════════════════════
{
  const t = (map, over) => pickStatusCopy(model(map, over), { formatTime: () => '4:00 PM' });
  const open = t(OPEN_4);
  assert(open.title === "Who's in", '[3a] title: Who\'s in');
  assert(open.count === '4 of 6', '[3b] open count: "{n} of {total}"');
  assert(t(Object.fromEntries(ROSTER.map(([id]) => [id, 'no']))).count === '0 of 6', '[3c] open, none: "0 of 6"');
  assert(t(Object.fromEntries(ROSTER.map(([id]) => [id, 'yes']))).count === "Everyone's in", '[3d] open, all: "Everyone\'s in"');
  assert(open.groupLabel === '4 of 6 in. In: Drew, Kevin, Koby, Jacob. Not yet: you, Kihoon.', `[3e] group label, open: names in roster order, the viewer as "you" (got ${JSON.stringify(open.groupLabel)})`);
  const lockedAll = t(Object.fromEntries(ROSTER.map(([id]) => [id, 'yes'])), { week: { status: 'locked' } });
  assert(lockedAll.count === "Everyone's locked in", '[3f] locked, all: "Everyone\'s locked in"');
  const locked = t({ p1: 'yes', p2: 'no', p3: 'yes', p4: 'yes', p5: 'yes', p6: 'yes' }, { week: { status: 'locked' } });
  assert(locked.count === '5 of 6 locked in', '[3g] locked count: "{n} of {total} locked in"');
  assert(locked.groupLabel === '5 of 6 locked in. Locked in: Drew, Kevin, Koby, Jacob, Kihoon. No picks: you.', `[3h] group label, locked (got ${JSON.stringify(locked.groupLabel)})`);
  assert(t(Object.fromEntries(ROSTER.map(([id]) => [id, 'no'])), { week: { status: 'locked' } }).count === 'No one locked in', '[3i] locked, none: "No one locked in"');
  const lockedOther = t({ p1: 'yes', p2: 'yes', p3: 'yes', p4: 'yes', p5: 'yes', p6: 'no' }, { week: { status: 'locked' } });
  assert(lockedOther.tiles.find(x => x.playerId === 'p6').sub === 'No picks', '[3j] after lock, a member shown as not in reads "No picks" on his tile');
  assert(locked.tiles.find(x => x.playerId === 'p2').sub === '' && lockedOther.tiles.find(x => x.playerId === 'p1').sub === '', '[3k] …the viewer\'s own tile and the in-tiles carry no sub-label ("No picks: you" is in the group label)');
  assert(open.tiles.every(x => x.sub === ''), '[3l] while OPEN no tile carries a sub-label — "not yet" is not a miss yet');
  assert(open.tiles[1].label === 'You' && open.tiles[0].label === 'Drew', '[3m] the viewer\'s tile is labelled "You"');
  const unk = t({ p1: 'unknown', p2: 'no', p3: 'unknown', p4: 'unknown', p5: 'unknown', p6: 'unknown' });
  assert(unk.note === "Who else is in isn't available right now. Nobody is being shown as missing. Last checked 4:00 PM.", `[3n] unknown note, with the stamp (got ${JSON.stringify(unk.note)})`);
  assert(unk.count === '', '[3o] unknown: NO count — never "0 of 6"');
  const unkNoStamp = pickStatusCopy(model({ p2: 'no' }, { read: readOf({ p2: 'no' }, { asOf: () => '' }) }), { formatTime: () => '4:00 PM' });
  assert(unkNoStamp.note === "Who else is in isn't available right now. Nobody is being shown as missing.", '[3p] unknown note with no stamp has no "Last checked" tail');
  const unkNoFormatter = pickStatusCopy(model({ p2: 'no' }), {});
  assert(!/Last checked/.test(unkNoFormatter.note), '[3q] no formatter -> no tail (never a raw ISO string)');
  assert(t(OPEN_4, { now: Date.parse(AT) + 9 * 60e3 }).note === 'Last checked 4:00 PM.', '[3r] a known-but-old answer wears only "Last checked {time}."');
  assert(open.note === '', '[3s] a fresh known answer has no note');
  const skel = pickStatusCopy(model({ p2: 'no' }, { read: readOf({ p2: 'no' }, { pending: () => true }) }));
  assert(skel.groupLabel === 'Loading who has picked' && skel.count === '' && skel.note === '' && skel.tiles.every(x => x.label === '' && x.initials === ''),
    '[3t] skeleton: the group label says it is loading; no text anywhere');
  const part = t({ ...OPEN_4, p5: 'unknown' });
  assert(/^Who else is in isn't available right now\./.test(part.groupLabel) && /In: Drew, Kevin, Koby\./.test(part.groupLabel) && /Not yet: you, Kihoon\./.test(part.groupLabel),
    `[3u] partly unknown: the spoken label leads with the calm sentence, then what IS known (got ${JSON.stringify(part.groupLabel)})`);
  assert(!/missed|late|red|failed|didn't|did not/i.test(JSON.stringify([open, locked, unk])), '[3v] no accusatory word anywhere in any state ("missed", "late", "failed", …)');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[4] THE MARKUP — states, never red, escaping, no pick content…');
// ═════════════════════════════════════════════════════════════════════════════
{
  const html = renderPickStatusHTML(model(OPEN_4), { escHtml: esc, formatTime: () => '4:00 PM' });
  const root = parseHtml(html);
  const host = root.querySelector('.pick-status');
  assert(!!host && host.getAttribute('role') === 'group' && host.getAttribute('data-pick-status') === 'w6' && host.getAttribute('data-ps-phase') === 'open',
    '[4a] one .pick-status group, role=group, tagged with its week and phase');
  assert(host.getAttribute('aria-label') === '4 of 6 in. In: Drew, Kevin, Koby, Jacob. Not yet: you, Kihoon.', '[4b] the group\'s aria-label carries the WHOLE answer once');
  assert(host.querySelector('.ps-list').getAttribute('aria-hidden') === 'true' && host.querySelector('.ps-note').getAttribute('aria-hidden') === 'true',
    '[4c] the tiles and the note are aria-hidden — VoiceOver reads the group label once, not six tiles and a note');
  const tiles = host.querySelectorAll('[data-ps-player]');
  assert(tiles.length === 6 && tiles.map(x => x.getAttribute('data-state')).join() === 'in,notyet,in,in,in,notyet', '[4d] six tiles, one per member, each carrying its state');
  assert(tiles[1].matches('.you') && !tiles[0].matches('.you'), '[4e] the viewer\'s tile carries .you');
  assert(host.querySelector('.ps-count').textContent === '4 of 6' && host.querySelector('.ps-title').textContent === "Who's in", '[4f] title and count');
  assert(tiles.every(x => x.querySelector('.ps-badge') !== null) && /<svg[^>]*aria-hidden="true"/.test(html), '[4g] every tile carries a .ps-badge, and the check is the icon family\'s own svg (aria-hidden)');
  assert((html.match(/<svg/g) || []).length === 6, '[4h] exactly six check glyphs — one per tile, none elsewhere');
  assert(host.querySelector('.ps-note').getAttribute('hidden') !== null, '[4i] with no note the <p> carries `hidden` (it takes no layout)');
  assert(tiles.every(x => x.querySelector('.ps-name') && x.querySelector('.ps-sub') && x.querySelector('.ps-ini')), '[4j] every tile has the same four parts in every state (so a state change never changes the structure)');

  // never a pick, a guess, a timestamp of anyone's activity
  for (const tok of FORBIDDEN) assert(!html.includes(tok), `[4k] the markup never contains "${tok}"`);
  assert(!/>\s*(true|false|null|undefined|NaN)\s*</.test(html) && !/undefined|\[object/.test(html), '[4l] no stray "undefined" / "[object Object]" leaks into any state');

  // never red, never a cross (the CSS is in [8]); the markup carries no loss class, no X glyph
  assert(!/loss|danger|error|incorrect|close|cross|✕|✗|❌|⛔/i.test(html), '[4m] no loss / danger / cross class, glyph or emoji in the markup');
  assert(!/style=/.test(html), '[4n] no inline style — every look comes from the stylesheet');

  // dark tone (Home's Now card)
  const dark = renderPickStatusHTML(model(OPEN_4), { escHtml: esc, tone: 'dark' });
  assert(/class="pick-status ps-on-dark"/.test(dark) && /data-ps-tone="dark"/.test(dark), '[4o] tone "dark" adds ps-on-dark and nothing else');
  assert(/data-ps-tone="light"/.test(renderPickStatusHTML(model(OPEN_4), { escHtml: esc, tone: '<script>' })), '[4p] an unknown tone falls back to light (the value never reaches the markup)');
  assert(renderPickStatusHTML(model(OPEN_4, { week: { status: 'live' } }), { escHtml: esc }) === '' && renderPickStatusHTML(null, { escHtml: esc }) === '', '[4q] a hidden / null model renders the empty string');

  // loading
  const sk = renderPickStatusHTML(model({ p2: 'no' }, { read: readOf({ p2: 'no' }, { pending: () => true }) }), { escHtml: esc });
  assert(/ps-loading/.test(sk) && !/>You</.test(sk) && !/>Drew</.test(sk), '[4r] the skeleton carries .ps-loading and none of the names');
  assert(parseHtml(sk).querySelectorAll('[data-ps-player]').length === 6, '[4s] …in the SAME footprint: six tiles, same structure (no layout jump when the answer lands)');

  // hostile names and initials: every one escaped at the sink
  const HOSTILE = [
    { p: { displayName: '<img src=x onerror=alert(1)>', initials: '"><svg/onload=alert(2)>' } },
    { p: { displayName: '</li><script>alert(3)</script>', initials: '&lt;b&gt;' } },
    { p: { displayName: 'Robert"); DROP TABLE picks;--', initials: "'\"`" } },
  ];
  for (const h of HOSTILE) {
    const m = pickStatusFor({ week: WEEK(), games: GAMES, players: [{ playerId: 'p2', displayName: 'Brayden', active: true }, { playerId: 'p7', active: true, ...h.p }], viewerId: 'p2', read: readOf({ p2: 'yes', p7: 'no' }) });
    const out = renderPickStatusHTML(m, { escHtml: esc, formatTime: () => '4:00 PM' });
    const parsed = parseHtml(out);
    const live = out.replace(/data-ps-sig="[^"]*"/, '').replace(/aria-label="[^"]*"/, '');
    assert(!/<(script|img|a)\b/i.test(live) && !/<svg[^>]*onload/i.test(live) && (!/[<>]/.test(h.p.displayName + h.p.initials) || /&lt;|&gt;/.test(live)),
      `[4t] hostile name ${JSON.stringify(h.p.displayName).slice(0, 36)} reaches no live <script>/<img>/<a>/onload — and where the name carries < or >, they arrive as &lt; / &gt; TEXT`);
    assert(parsed.querySelectorAll('script').length === 0 && parsed.querySelectorAll('img').length === 0 && parsed.querySelectorAll('[data-ps-player]').length === 2,
      '[4u] …and the parsed tree has no script / img and exactly the two tiles (the name cannot close a tag and add one)');
    assert(parsed.querySelector('.pick-status').getAttribute('aria-label').includes(h.p.displayName.slice(0, 6)), '[4v] …the name survives as TEXT in the group label (escaped on the way in, decoded by the parser)');
  }
  // a hostile week id and player id are escaped too
  const hostileIds = renderPickStatusHTML(pickStatusFor({ week: WEEK({ weekId: 'w"><script>1</script>' }), games: [{ weekId: 'w"><script>1</script>' }], players: [{ playerId: 'a"b', displayName: 'A', active: true }, { playerId: 'c<d', displayName: 'C', active: true }], viewerId: 'a"b', read: readOf({}) }), { escHtml: esc });
  assert(!/<script/.test(hostileIds) && parseHtml(hostileIds).querySelectorAll('script').length === 0, '[4w] a hostile week id or player id cannot break out of its attribute');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[5] PATCHING IN PLACE — only what changed, the same nodes…');
// ═════════════════════════════════════════════════════════════════════════════
{
  const deps = { escHtml: esc, formatTime: () => '4:00 PM' };
  const mount = (m) => { const root = parseHtml(renderPickStatusHTML(m, deps)); return root.querySelector('.pick-status'); };
  const m0 = model(OPEN_4);
  const host = mount(m0);
  const tilesBefore = host.querySelectorAll('[data-ps-player]');
  assert(patchPickStatus(host, m0, deps) === 'unchanged' && host.writes.length === 0 && tilesBefore.every(t => t.writes.length === 0),
    '[5a] the same model writes NOTHING (no attribute, no text) — a no-change refresh costs no style recalculation and no flash');

  // Kevin... no: Brayden (the viewer's neighbour p6 Kihoon) submits
  const m1 = model({ ...OPEN_4, p6: 'yes' });
  const r1 = patchPickStatus(host, m1, deps);
  const tilesAfter = host.querySelectorAll('[data-ps-player]');
  assert(r1 === 'patched' && tilesAfter.every((t, i) => t === tilesBefore[i]), '[5b] a state change PATCHES: the very same tile nodes are kept (so the CSS transition has a node to run on)');
  assert(tilesAfter[5].getAttribute('data-state') === 'in' && tilesAfter[0].getAttribute('data-state') === 'in' && tilesAfter[1].getAttribute('data-state') === 'notyet', '[5c] only Kihoon\'s tile changed state');
  assert(tilesAfter[5].writes.includes('attr:data-state') && tilesAfter.slice(0, 5).every(x => x.writes.length === 0),
    '[5d] ONLY Kihoon\'s tile was written to — the other five tiles had no attribute and no text touched (an unchanged value is never re-written)');
  assert(host.querySelector('.ps-count').textContent === '5 of 6' && host.getAttribute('aria-label').startsWith('5 of 6 in.'), '[5e] the count and the group label follow');
  assert(host.getAttribute('data-ps-sig') === pickStatusSignature(m1, deps), '[5f] the stored signature is the new model\'s (the next identical refresh is a no-op)');
  assert(host.replacedWith === null && !host.writes.includes('outerHTML'), '[5g] a state change never replaces the strip (no outerHTML)');
  assert(patchPickStatus(host, m1, deps) === 'unchanged', '[5h] …and patching the same model again is "unchanged"');

  // everyone in, then the locked phase's sub-label
  const mAll = model(Object.fromEntries(ROSTER.map(([id]) => [id, 'yes'])));
  patchPickStatus(host, mAll, deps);
  assert(host.querySelector('.ps-count').textContent === "Everyone's in", '[5i] six of six reads "Everyone\'s in"');

  // locked: sub-label appears on the missing tile, in place
  const hostL = mount(model({ p1: 'yes', p2: 'yes', p3: 'yes', p4: 'yes', p5: 'yes', p6: 'yes' }, { week: { status: 'locked' } }));
  patchPickStatus(hostL, model({ p1: 'yes', p2: 'yes', p3: 'yes', p4: 'yes', p5: 'yes', p6: 'no' }, { week: { status: 'locked' } }), deps);
  assert(hostL.querySelectorAll('[data-ps-player]')[5].querySelector('.ps-sub').textContent === 'No picks' && hostL.getAttribute('data-ps-phase') === 'locked', '[5j] locked: the "No picks" sub-label is written in place');

  // unknown -> known and back (the note appears and disappears without a rebuild)
  const hostU = mount(model({ p2: 'no' }));
  assert(hostU.querySelector('.ps-note').getAttribute('hidden') === null && /isn't available/.test(hostU.querySelector('.ps-note').textContent), '[5k] fixture: an unknown strip shows its note');
  const rU = patchPickStatus(hostU, m0, deps);
  assert(rU === 'patched' && hostU.querySelector('.ps-note').getAttribute('hidden') !== null && hostU.querySelector('.ps-note').textContent === '' && hostU.replacedWith === null,
    '[5l] unknown -> known: the note is emptied and hidden IN PLACE, tiles keep their nodes');
  const rBack = patchPickStatus(hostU, model({ p2: 'no' }), deps);
  assert(rBack === 'patched' && hostU.querySelector('.ps-note').getAttribute('hidden') === null && /isn't available/.test(hostU.querySelector('.ps-note').textContent), '[5m] …and back to unknown shows the note again');

  // skeleton -> real
  const hostS = mount(model({ p2: 'no' }, { read: readOf({ p2: 'no' }, { pending: () => true }) }));
  assert(hostS.classList.contains('ps-loading'), '[5n] fixture: the skeleton carries ps-loading');
  const rS = patchPickStatus(hostS, m0, deps);
  assert(rS === 'patched' && !hostS.classList.contains('ps-loading') && hostS.querySelectorAll('[data-ps-player]')[0].querySelector('.ps-name').textContent === 'Drew' && hostS.querySelectorAll('[data-ps-player]')[0].getAttribute('data-state') === 'in',
    '[5o] skeleton -> real settles IN PLACE (the tiles fill in; no rebuild, no jump)');

  // roster changed shape -> only the strip itself is rebuilt
  const hostR = mount(m0);
  const shrunk = model(OPEN_4, { players: { p6: { active: false } } });
  const rR = patchPickStatus(hostR, shrunk, deps);
  assert(rR === 'replaced' && typeof hostR.replacedWith === 'string' && /data-pick-status="w6"/.test(hostR.replacedWith) && parseHtml(hostR.replacedWith).querySelectorAll('[data-ps-player]').length === 5,
    '[5p] a roster change rebuilds THIS strip\'s own markup (five tiles) and nothing else');
  const hostRT = parseHtml(renderPickStatusHTML(m0, { escHtml: esc, tone: 'dark' })).querySelector('.pick-status');
  patchPickStatus(hostRT, shrunk, deps);
  assert(/ps-on-dark/.test(hostRT.replacedWith) && /data-ps-tone="dark"/.test(hostRT.replacedWith), '[5q] …and the rebuilt strip keeps its tone');
  let thrown = null;
  try { patchPickStatus(mount(m0), shrunk, {}); } catch (e) { thrown = e; }
  assert(thrown instanceof TypeError, '[5r] a rebuild without an injected escHtml throws — the replace path has no escaping default either');

  // hidden / missing
  assert(patchPickStatus(mount(m0), model(OPEN_4, { week: { status: 'live' } }), deps) === 'hidden' && patchPickStatus(null, m0, deps) === 'missing', '[5s] a model that no longer shows a strip -> "hidden" (the caller removes the node); no host -> "missing"');
  // the patcher never assigns a container's innerHTML and never touches scroll
  const pc = code(SRC.ps.slice(SRC.ps.indexOf('export function patchPickStatus'), SRC.ps.indexOf('// ═══ the throttle')));
  assert(!/innerHTML|scrollTo|scrollTop|scrollIntoView|focus\(/.test(pc), '[5t] patchPickStatus never assigns innerHTML and never touches scroll or focus');
  assert(/textContent/.test(pc) && !/insertAdjacentHTML/.test(pc), '[5u] it writes text through textContent only (a name can never be parsed as markup on the patch path)');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[6] THE THROTTLE — one per 20 s, never two in flight, one trailing, a hang cut off…');
// ═════════════════════════════════════════════════════════════════════════════
{
  function harness({ gap = 20000, timeout = 8000 } = {}) {
    let t = 1_000_000; const timers = []; let nextId = 1;
    const calls = []; const settled = []; const started = [];
    let resolveCurrent = null; let rejectCurrent = null; let hang = false;
    const ctl = createPickStatusRefresher({
      refresh: ({ reason }) => { calls.push({ reason, at: t }); if (hang) return new Promise(() => {}); return new Promise((res, rej) => { resolveCurrent = res; rejectCurrent = rej; }); },
      now: () => t,
      setTimer: (fn, ms) => { const id = nextId++; timers.push({ id, fn, at: t + ms }); return id; },
      clearTimer: (id) => { const i = timers.findIndex(x => x.id === id); if (i >= 0) timers.splice(i, 1); },
      minGapMs: gap, timeoutMs: timeout,
      onStart: (e) => started.push(e.reason), onSettled: (e) => settled.push(e),
    });
    const advance = async (ms) => { const end = t + ms; for (;;) { const due = timers.filter(x => x.at <= end).sort((a, b) => a.at - b.at)[0]; if (!due) break; t = due.at; timers.splice(timers.indexOf(due), 1); due.fn(); await Promise.resolve(); await Promise.resolve(); } t = end; await Promise.resolve(); };
    const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
    return { ctl, calls, settled, started, timers, advance, flush, set hang(v) { hang = v; }, resolve: async (v = true) => { resolveCurrent(v); await flush(); }, reject: async () => { rejectCurrent(new Error('boom')); await flush(); }, now: () => t };
  }
  {
    const h = harness();
    assert(h.ctl.request('enter') === 'started' && h.calls.length === 1 && h.started.join() === 'enter' && h.ctl.pending() === true, '[6a] the first request starts a refresh at once, fires onStart, and is pending');
    assert(h.ctl.request('tick') === 'in-flight' && h.calls.length === 1, '[6b] a request while one is in flight does NOT start a second (never two in flight)');
    await h.resolve(true);
    assert(h.ctl.pending() === false && h.settled.length === 1 && h.settled[0].ok === true, '[6c] on success the controller settles, fires onSettled(ok:true) and is no longer pending');
    assert(h.calls.length === 1 && h.timers.length === 1, '[6d] the follow-up marked while in flight is NOT run immediately — it waits for the window (exactly one trailing timer is armed; the watchdog was cleared)');
    await h.advance(19000);
    assert(h.calls.length === 1, '[6e] nothing fires inside the 20 s window');
    await h.advance(1500);
    assert(h.calls.length === 2 && h.calls[1].reason === 'trailing', '[6f] ONE trailing refresh fires when the window ends');
    await h.resolve(true);
    assert(h.calls.length === 2, '[6g] and that is all: a trailing refresh does not chain');
  }
  {
    const h = harness();
    h.ctl.request('enter'); await h.resolve(true);
    await h.advance(21000); // the follow-up trailing (if any) runs
    await h.resolve(true);
    const before = h.calls.length;
    await h.advance(1000);
    const r1 = h.ctl.request('chat'); const r2 = h.ctl.request('chat'); const r3 = h.ctl.request('own-submit');
    assert(r1 === 'started' || r1 === 'trailing', '[6h] a request after the window starts (or is the trailing one)');
    await h.resolve(true); await h.advance(100);
    const mid = h.calls.length;
    const r4 = h.ctl.request('tick'); const r5 = h.ctl.request('tick'); const r6 = h.ctl.request('tick');
    assert(r4 === 'trailing' && r5 === 'trailing' && r6 === 'trailing', '[6i] requests inside the window all answer "trailing"');
    assert(h.timers.length === 1, '[6j] …but only ONE trailing timer is ever armed (a burst of requests is one request)');
    assert(h.calls.length === mid, '[6k] and none of them called refresh now');
    void before; void r2; void r3;
  }
  {
    // never more than one call per window, over a long chaotic run
    const h = harness();
    const starts = [];
    for (let i = 0; i < 400; i++) {
      h.ctl.request('r' + i);
      await h.advance(1000);
      if (h.calls.length && !starts.includes(h.calls[h.calls.length - 1].at)) starts.push(h.calls[h.calls.length - 1].at);
      if (h.ctl.pending()) await h.resolve(true);
    }
    const gaps = h.calls.slice(1).map((c, i) => c.at - h.calls[i].at);
    assert(h.calls.length > 5 && gaps.every(g => g >= 20000), `[6l] over 400 requests (400 s) the refresh ran ${h.calls.length} times and NEVER closer than 20 s apart (min gap ${Math.min(...gaps)} ms)`);
  }
  {
    const h = harness();
    h.ctl.request('enter');
    await h.reject();
    assert(h.settled.length === 1 && h.settled[0].ok === false && h.ctl.pending() === false, '[6m] a rejected refresh settles as ok:false and clears pending (a failed read is a result, never an unhandled rejection)');
  }
  {
    const h = harness();
    h.hang = true;
    h.ctl.request('enter');
    assert(h.ctl.pending() === true, '[6n] a hung refresh is pending…');
    await h.advance(7000);
    assert(h.ctl.pending() === true, '[6o] …still inside the ceiling');
    await h.advance(1500);
    assert(h.ctl.pending() === false && h.settled.length === 1 && h.settled[0].ok === false, '[6p] …and cut off at 8 s: settled as failed, so a skeleton can never sit on screen forever');
  }
  {
    const h = harness();
    h.ctl.request('enter');
    h.ctl.cancel();
    await h.resolve(true);
    assert(h.timers.length === 0 && h.ctl.pending() === false, '[6q] cancel() mid-flight leaves no timer armed (no trailing refresh is ever scheduled after it) and the settled answer clears pending');
    const threw = (() => { try { createPickStatusRefresher({}); return null; } catch (e) { return e; } })();
    assert(threw instanceof TypeError, '[6r] a controller without a refresh function is a wiring bug and throws');
    const h2 = harness();
    const bad = createPickStatusRefresher({ refresh: () => { throw new Error('sync throw'); }, now: () => 5, setTimer: () => 1, clearTimer: () => {}, onStart: () => { throw new Error('hook'); }, onSettled: () => { throw new Error('hook2'); } });
    const out = quiet(() => bad.request('x'));
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    assert(out === 'started' && bad.pending() === false, '[6s] a synchronous throw in refresh, and throwing UI hooks, can never wedge the controller (pending clears)');
    void h2;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[7] THE CHAT ARRIVAL HELPER — only a database-written line counts…');
// ═════════════════════════════════════════════════════════════════════════════
{
  const row = (over = {}) => ({ id: 'sys_in_1', type: 'system', author: 'system', seq: 10, meta: { kind: 'picksIn', weekId: 'w6', memberId: 'p3', inCount: 1, total: 6 }, body: 'Kevin is in for Week 6 · 1 of 6', ...over });
  assert(isPicksInRow(row()) === true, '[7a] a system row, author system, kind picksIn, with a server sequence IS a picksIn row');
  assert(isPicksInRow(row({ author: 'p3' })) === false, '[7b] a PLAYER-authored lookalike (author is a member id) is NOT one — the forgery the reservation cannot fully stop is ignored here');
  assert(isPicksInRow(row({ type: 'message' })) === false && isPicksInRow(row({ meta: { kind: 'lifecycle' } })) === false && isPicksInRow(row({ meta: null })) === false && isPicksInRow(null) === false,
    '[7c] other types, other kinds, a missing meta and null are not picksIn rows');
  assert(isPicksInRow(row({ seq: null })) === false && isPicksInRow(row({ seq: '10' })) === false, '[7d] an optimistic local row (no server sequence) is not an arrival');
  let r = newPicksInArrival([row({ seq: 10 })], -1);
  assert(r.arrived === true && r.watermark === 10, '[7e] a new picksIn row above the watermark is an arrival and moves the watermark');
  r = newPicksInArrival([row({ seq: 10 })], 10);
  assert(r.arrived === false && r.watermark === 10, '[7f] the SAME row again is not an arrival (history replay, a re-fold)');
  r = newPicksInArrival([row({ seq: 10 }), row({ id: 'sys_in_2', seq: 12 })], 10);
  assert(r.arrived === true && r.watermark === 12, '[7g] only a row ABOVE the watermark counts, and the watermark takes the highest');
  r = newPicksInArrival([row({ author: 'p3', seq: 99 })], 10);
  assert(r.arrived === false && r.watermark === 10, '[7h] a forged lookalike moves nothing — not the flag, not the watermark');
  assert(newPicksInArrival(undefined, 5).watermark === 5 && newPicksInArrival([], NaN).watermark === -1, '[7i] garbage in is harmless');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[8] THE CSS BLOCK — tokens only, never red, Reduce Motion per animated selector…');
// ═════════════════════════════════════════════════════════════════════════════
{
  const start = SRC.css.lastIndexOf('/*', SRC.css.indexOf('"WHO\'S IN" — UN-412 / DI-501'));
  const end = SRC.css.indexOf('"WHO\'S IN" — END');
  const block = SRC.css.slice(start, end);
  assert(start > 0 && end > start && block.length > 2000, `[8a] the "Who's in" CSS block exists and is bounded by its markers (${block.length} chars)`);
  const rules = block.replace(/\/\*[\s\S]*?\*\//g, '');
  assert(!/#[0-9a-fA-F]{3,8}\b/.test(rules), '[8b] NO hardcoded hex colour in the block (CONVENTIONS #13) — every colour is a token');
  assert(!/\bred\b|--loss|--danger|--error|rgba?\(\s*2[0-9]{2}\s*,\s*[0-9]\s*,\s*[0-9]\s*,/.test(rules), '[8c] never red: no `red`, no --loss / --danger / --error token anywhere');
  const notyet = (rules.match(/\.ps-m\[data-state="notyet"\][^{]*\{[^}]*\}/) || [''])[0];
  assert(/border-color:var\(--border-strong\)/.test(notyet) && !/--maroon|--win|--oxblood/.test(notyet), '[8d] "not yet" is a NEUTRAL ring (--border-strong), not brand or semantic colour');
  assert(/\.ps-m\[data-state="in"\] \.ps-av\{[^}]*background:var\(--maroon\)/.test(rules), '[8e] "in" is the one brand fill (--maroon)');
  assert(/\.ps-badge\{[^}]*background:var\(--win\)/.test(rules), '[8f] green appears only on the check badge (--win)');
  assert(/\.ps-av\{[^}]*transition:[^}]*var\(--motion-fast\)/.test(rules) && /\.ps-badge\{[^}]*transition:[^}]*var\(--motion-fast\)/.test(rules), '[8g] the state change is the shipped 150 ms token (--motion-fast), on fill, ring, colour and the check');
  assert(!/bounce|elastic|cubic-bezier|spring|scale\(1\.\d/.test(rules), '[8h] no bounce, no overshoot, no custom easing curve');
  assert(!/transform:scale\(\.9[5-9]\)|:active|:hover|cursor:pointer/.test(rules), '[8i] informational: no press state, no hover, no pointer cursor (not a tap target)');
  // Reduce Motion: every selector that animates or transitions has its OWN reduced-motion rule
  const reduced = (rules.match(/@media \(prefers-reduced-motion:reduce\)\{[\s\S]*?\n\}/) || [''])[0];
  const animated = [...rules.matchAll(/(?:^|\})\s*([^{}@]+)\{[^}]*(?:transition|animation):/g)].map(m => m[1].trim()).filter(s => !s.startsWith('@keyframes'));
  assert(animated.length >= 5, `[8j] fixture: the block animates ${animated.length} selectors (${animated.join(' | ')})`);
  assert(animated.every(sel => new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{[^}]*(?:transition:none|animation:none)').test(reduced)),
    `[8k] EVERY animated selector has its own Reduce Motion rule (missing: ${animated.filter(sel => !new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{[^}]*(?:transition:none|animation:none)').test(reduced)).join(' | ') || 'none'})`);
  assert(/\.ps-loading \.ps-av\{[^}]*animation:none;opacity:\.7/.test(reduced), '[8l] the skeleton holds still at a visible mid opacity under Reduce Motion (never at the dim end)');
  // Dynamic Type: rem sizes, wrapping rows, no overlap
  assert(/\.ps-list\{[^}]*flex-wrap:wrap/.test(rules) && /\.ps-m\{[^}]*min-width:3\.6em/.test(rules), '[8m] the row WRAPS (more rows at a larger text size, never an overlap) and a tile has a min-width in em');
  assert(/\.ps-av\{[^}]*width:2\.25rem;height:2\.25rem/.test(rules), '[8n] the avatar is 2.25rem (36 px at 16) — it scales with Dynamic Type');
  assert(!/font-size:\s*\d+(\.\d+)?px/.test(rules), '[8o] no px font sizes — rem only, so Dynamic Type scales the text');
  assert(/gap:12px 8px/.test(rules) && /\.ps-head\{[^}]*margin:0 0 12px/.test(rules), '[8p] spacing: 8 between tiles, 12 between wrapped rows and below the title row (the app\'s --gap)');
  assert(/\.ps-note\{[^}]*margin:12px 0 0/.test(rules) && /\.pick-status-block\{margin:0 0 12px\}/.test(rules), '[8q] 12 above the note and 12 between the strip and the blind note below it');
  assert(/\.week-status-card \+ \.pick-status-card\{margin-top:16px\}/.test(rules), '[8r] on the locked Picks card the strip sits 16 below the "Week is locked" card (Breathing Room: nothing touches)');
  assert(/\.ps-loading \.ps-av\{[^}]*animation:ps-pulse var\(--skeleton-shimmer/.test(rules) && /@keyframes ps-pulse\{0%,100%\{opacity:\.5\}50%\{opacity:\.9\}\}/.test(rules), '[8s] the skeleton uses the shipped shimmer token and the same .5-.9 opacity pulse Home uses');
  assert(/\.ps-on-dark \.ps-m\[data-state="in"\] \.ps-av\{[^}]*var\(--oxblood-on\)/.test(rules), '[8t] the dark (Home Now card) variant uses the constant --oxblood-on pair');
}

// ═════════════════════════════════════════════════════════════════════════════
// the app-level world (stubs in the shape of layouttest / weekprogresstest)
// ═════════════════════════════════════════════════════════════════════════════
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k), clear: () => store.clear(), get length() { return store.size; }, key(i) { return [...store.keys()][i] ?? null; },
};
const els = new Map();
function mkEl(id) {
  const e = {
    id, _html: '', dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); },
    insertAdjacentHTML(pos, h) { this._html = pos === 'afterbegin' ? h + this._html : this._html + h; },
    appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {},
    querySelector(sel) { if (sel !== '#picks-head-slot' || !this._html.includes('<div id="picks-head-slot"></div>')) return null; const host = this; return { get outerHTML() { return '<div id="picks-head-slot"></div>'; }, set outerHTML(h) { host._html = host._html.replace('<div id="picks-head-slot"></div>', h); } }; },
    querySelectorAll() { return []; }, closest: () => null, scrollTo() {}, focus() {},
  };
  els.set(id, e); return e;
}
['page-picks', 'games-list', 'page-dashboard', 'submitted-games', 'page-leaderboard', 'header-meta-week'].forEach(mkEl);
let strips = [];                       // what document.querySelectorAll('[data-pick-status]') returns (the freshness section drives this)
let stripsOnActivePage = true;       // false = the strips are in a HIDDEN page section (the pages persist in the DOM)
let docHidden = false;
globalThis.document = {
  addEventListener() {}, removeEventListener() {}, getElementById: id => els.get(id) || null,
  // a strip is "on screen" only inside the ACTIVE page section (the pages persist in the DOM); querySelectorAll('[data-pick-status]') is every strip, hidden pages included
  querySelector: (sel) => {
    if (sel === '.page-section.active [data-pick-status]') return stripsOnActivePage ? (strips[0] || null) : null;
    if (sel === '[data-pick-status]') return strips[0] || null;           // unscoped: a strip in ANY page section, hidden or not
    return null;
  },
  querySelectorAll: (sel) => (sel === '[data-pick-status]' ? strips : []),
  createElement: () => mkEl('tmp'),
  body: { classList: { add() {}, remove() {}, toggle() {} }, dataset: {}, appendChild() {}, innerHTML: '' },
  get hidden() { return docHidden; },
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined, clipboard: { writeText: async () => {} } }, configurable: true }); }
globalThis.requestAnimationFrame = fn => fn();
globalThis.matchMedia = () => ({ matches: false });
globalThis.confirm = () => true; globalThis.prompt = () => null; globalThis.alert = () => {}; globalThis.scrollTo = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'u_' + Math.random().toString(36).slice(2) };
globalThis.fetch = async () => { throw new Error('network disabled in pickstatustest'); };

const storage = await import('./js/storage.js');
const auth = await import('./js/auth.js');
const sb = await import('./js/supabase-backend.js');
const dataModel = await import('./js/data-model.js');
const chat = await import('./js/chat.js');
const app = await import('./js/app.js');
const home = await import('./js/home.js');

const WK = 'w_ps';
const ME = 'p2';
const SECRET_HOME = 'SECRETHOME-STATE', SECRET_AWAY = 'SECRETAWAY-TECH';
const NOW_PLUS = (ms) => new Date(Date.now() + ms).toISOString();

function resetStorage() { [...store.keys()].forEach(k => store.delete(k)); }
function localMode() {
  auth.configureAuth({ authMode: 'pins', dataMode: 'sheets', authModeKnown: true, supabaseUrl: '', supabaseAnonKey: '' });
  sb._resetForTest();
  storage.setBackendMode('local');
}
/** The week, games and roster, written in the flag-off world (the seam's interlock applies only to supabase mode). */
function seedWorld({ status = 'open', source = 'live', nGames = 2, tiebreaker = null } = {}) {
  localMode();
  resetStorage();
  const wk = dataModel.createWeek('2026', 6);
  wk.weekId = WK; wk.label = 'Week 6'; wk.status = status; wk.dataSourceMode = source; wk.blurb = 'WEEK BLURB'; wk.tiebreakerQuestion = tiebreaker;
  storage.saveWeek(wk); storage.setActiveWeekId(WK);
  for (let i = 1; i <= nGames; i++) {
    const g = dataModel.createGame(WK, { homeTeam: `${SECRET_HOME} ${i}`, awayTeam: `${SECRET_AWAY} ${i}`, kickoffAt: NOW_PLUS(86400e3 * 2), spread: -3 });
    g.gameId = `${WK}_g${i}`; g.kickoff = NOW_PLUS(86400e3 * 2); g.kickoffConfirmed = true;   // `kickoff` is the field the lock-timing line reads
    storage.saveGame(g);
  }
  ROSTER.forEach(([playerId, displayName, initials]) => storage.savePlayer({ playerId, displayName, initials, active: true, pin: '1111', preferences: {} }));
  storage.setSession(ME, false, true);
  return wk;
}
function pickRows(playerId, n = 2, team = SECRET_AWAY) {
  return Array.from({ length: n }, (_, i) => ({ pickId: `pk_${playerId}_${i + 1}`, weekId: WK, gameId: `${WK}_g${i + 1}`, playerId, selectedTeam: `${team} ${i + 1}`, submittedAt: '2026-10-10T00:00:00Z' }));
}
function setStatus(status, extra = {}) { const wk = storage.getWeek(WK); storage.saveWeek({ ...wk, status, ...extra }); }
const pageHtml = (id) => els.get(id)._html;
function renderPicks() { els.get('page-picks')._html = ''; app.state.viewingWeekId = null; app.state.editingPicks = false; window.navigateTo('picks'); return pageHtml('page-picks'); }
function renderDash() { els.get('page-dashboard')._html = ''; app.state.viewingWeekId = null; window.navigateTo('dashboard'); return pageHtml('page-dashboard'); }
const at = (html, marker) => html.indexOf(marker);
const stripsIn = (html) => (html.match(/class="pick-status[ "]/g) || []).length;
/** Every character of every strip in a page (all the `.pick-status` containers), so assertions about content look only at the strip. */
const stripHtmlOf = (html) => [...html.matchAll(/<div class="pick-status[^>]*>[\s\S]*?<\/p><\/div>/g)].map(m => m[0]).join('\n');

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[9] THE DEFINITION AT EVERY CALL SITE — strip == submissionStateFor == Home\'s count == the server\'s rule…');
// ═════════════════════════════════════════════════════════════════════════════
{
  // ── local mode: every row is on the device ──
  seedWorld();
  storage.saveAllPicks([...pickRows('p1'), ...pickRows('p3'), ...pickRows('p5', 1)]);        // p5 is half-way: NOT in
  const stateFor = app._submissionStateForTest;
  const localModel = app._buildPickStatusModelForTest(WK);
  assert(localModel.phase === 'open' && localModel.total === 6 && localModel.inCount === 2, '[9a] local mode: p1 and p3 have a full slate (2 of 6); p5\'s half slate is NOT in — a count other than a full slate is never used');
  assert(localModel.members.every(m => (m.state === 'in') === (stateFor(WK, m.playerId) === 'yes')), '[9b] every tile\'s state agrees with submissionStateFor() — the strip has no second definition');
  assert(localModel.members.every(m => (m.state === 'in') === storage.hasPlayerSubmitted(WK, m.playerId)), '[9c] …and with hasPlayerSubmitted() in the world where both can see the rows');
  const homeDeps = (supabase) => ({
    read: {
      weeks: storage.getWeeks, games: () => storage.getGames(), picks: () => storage.getPicks(), players: storage.getPlayers, weeklyResults: () => [],
      weekProgress: storage.getWeekProgress, currentWeek: storage.getCurrentWeek, activeWeekId: storage.getActiveWeekId, viewer: storage.getSession,
      timezone: storage.getTimezone, leagueId: () => 'L-ps', isSupabase: () => supabase,
    },
    confirmedStatusFor: (w) => w.status, picksReadConfirmed: () => true, chatCandidates: () => ({ scribe: [], lockerRoom: [] }),
  });
  const snapL = home.assembleHomeSnapshot(homeDeps(false), { viewerId: ME, isCommissioner: false });
  assert(snapL.submissionCounts[WK] && snapL.submissionCounts[WK].submittedCount === localModel.inCount && snapL.submissionCounts[WK].totalPlayers === localModel.total,
    `[9d] PARITY (local): Home's {submittedCount, totalPlayers} = the strip's {inCount, total} (${localModel.inCount}/${localModel.total})`);

  // ── supabase mode: RLS leaves the device only the viewer's own rows; the rest is the server's count ──
  const progress = (counts, at = new Date().toISOString()) => ({ at, weeks: { [WK]: Object.fromEntries(Object.entries(counts).map(([id, n]) => [id, { pickCount: n, hasTiebreaker: n >= 2, hasExtraPoint: false, lastUpdated: at }])) } });
  const wkRec = storage.getWeek(WK); const gamesRec = storage.getGames(WK); const playersRec = storage.getPlayers();
  const enterSupabase = (counts, { mine = pickRows(ME) } = {}) => {
    auth.configureAuth({ authMode: 'supabase', dataMode: 'supabase', authModeKnown: true, supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon' });
    auth._setMembershipsForTest([{ leagueId: 'L-ps', memberId: ME, role: 'player', displayName: 'Brayden', leagueName: 'League PS' }]);
    auth.setActiveLeagueId('L-ps');
    sb._resetForTest();
    sb.init({ getSession: () => ({ isAdmin: false, playerId: ME }) });
    sb._setStateForTest('ACTIVE', 'pickstatustest');
    quiet(() => {
      sb._seedMirrorForTest('cfbp_weeks', [wkRec]); sb._seedMirrorForTest('cfbp_games', gamesRec); sb._seedMirrorForTest('cfbp_players', playersRec);
      sb._seedMirrorForTest('cfbp_picks', mine);
      if (counts) sb._seedMirrorForTest('cfbp_week_progress', progress(counts));
    });
    storage.setBackendMode('supabase');
  };
  enterSupabase({ p1: 2, p2: 2, p3: 2, p4: 2, p5: 1, p6: 0 });
  const sbModel = app._buildPickStatusModelForTest(WK);
  assert(sbModel.members.map(m => m.state).join() === 'in,in,in,in,notyet,notyet' && sbModel.inCount === 4 && sbModel.known === true,
    '[9e] supabase: the server\'s counts (pick_count >= games) decide — 2,2,2,2 are in; 1 and 0 are not; and the viewer\'s own tile comes from his own rows');
  assert(sbModel.members.every(m => m.state === (stateFor(WK, m.playerId) === 'yes' ? 'in' : 'notyet')), '[9f] …and every tile agrees with submissionStateFor() in supabase mode too');
  const snapS = home.assembleHomeSnapshot(homeDeps(true), { viewerId: ME, isCommissioner: false });
  assert(snapS.submissionCounts[WK] && snapS.submissionCounts[WK].submittedCount === sbModel.inCount && snapS.submissionCounts[WK].totalPlayers === sbModel.total,
    `[9g] PARITY (supabase): Home's count equals the strip's (${sbModel.inCount}/${sbModel.total})`);
  // the server's rule, written out: pick_count >= game count (week_submission_status carries counts; the app compares)
  const gamesN = gamesRec.length;
  assert(['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].every((id, i) => (sbModel.members[i].state === 'in') === ([2, 2, 2, 2, 1, 0][i] >= gamesN)), '[9h] the rule is exactly `pick_count >= games` — the server\'s count semantics');

  // absent is not zero: no answer on the device -> unknown, never "not yet"
  enterSupabase(null);
  const unkModel = app._buildPickStatusModelForTest(WK);
  assert(unkModel.known === false && unkModel.members.filter(m => m.state === 'unknown').length === 5 && unkModel.members[1].state === 'in', '[9i] supabase with NO count on the device: five UNKNOWN tiles and the viewer\'s own known tile — nobody is shown as missing');
  const snapU = home.assembleHomeSnapshot(homeDeps(true), { viewerId: ME, isCommissioner: false });
  assert(snapU.submissionCounts[WK] === null, '[9j] …and Home\'s count is UNKNOWN (null) in the same state — one story on every surface');

  // a stale / offline adapter hands the seam null even if the mirror still holds a map
  enterSupabase({ p1: 2, p2: 2, p3: 2, p4: 2, p5: 2, p6: 2 });
  quiet(() => sb._setStateForTest('OFFLINE-READONLY', 'pickstatustest'));
  assert(app._buildPickStatusModelForTest(WK).known === false, '[9k] OFFLINE-READONLY: the seam answers null and the strip falls to unknown — a device that stopped asking does not state a count');
  quiet(() => sb._setStateForTest('ACTIVE', 'pickstatustest'));

  // a LIVE week: no strip at all (the matrix shows everyone)
  localMode();
  setStatus('live');
  assert(app._buildPickStatusModelForTest(WK).phase === 'hidden', '[9l] a LIVE week: no strip');
  setStatus('final');
  assert(app._buildPickStatusModelForTest(WK).phase === 'hidden', '[9m] a FINAL week: no strip');
  setStatus('open');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[10] PLACEMENTS ON EVERY RENDER PATH, IN ORDER…');
// ═════════════════════════════════════════════════════════════════════════════
{
  // ── Picks: draft form ──
  seedWorld({ tiebreaker: 'Total points?' });
  let picks = renderPicks();
  assert(at(picks, 'id="games-list"') > 0, '[10a] fixture: the draft form rendered');
  assert(stripsIn(picks) === 1, '[10b] Picks, draft form: exactly one strip');
  assert(at(picks, 'picks-timing-info') > 0 && at(picks, 'picks-timing-info') < at(picks, 'data-pick-status-wrap') && at(picks, 'data-pick-status-wrap') < at(picks, 'id="games-list"'),
    '[10c] it sits DIRECTLY under the lock-timing line and above the player-name row and the games');
  assert(at(picks, 'data-pick-status-wrap') < at(picks, 'make your picks'), '[10d] …above the name row ("make your picks")');
  assert(/class="card mb-md pick-status-card"/.test(picks), '[10e] in its own .card (cards, not dividers — CONVENTIONS #15), 16 below');
  assert(app._buildPickStatusModelForTest(WK).members[1].state === 'notyet' && /data-ps-player="p2" data-state="notyet"/.test(picks), '[10f] the viewer who has not picked is hollow ("notyet") on the form');

  // ── Picks: edit mode (the viewer is still "in" while he edits) ──
  storage.saveAllPicks(pickRows(ME));
  app.state.editingPicks = true; els.get('page-picks')._html = ''; window.navigateTo('picks');
  const editing = pageHtml('page-picks');
  assert(/id="games-list"/.test(editing) && stripsIn(editing) === 1 && /data-ps-player="p2" data-state="in"/.test(editing), '[10g] edit mode: the editable form shows the strip, and the viewer\'s own tile stays "in" while he edits');
  app.state.editingPicks = false;

  // ── Picks: submitted view ──
  picks = renderPicks();
  assert(/id="submitted-games"/.test(picks) && stripsIn(picks) === 1, '[10h] Picks, submitted view: exactly one strip');
  assert(at(picks, 'picks-timing-info') < at(picks, 'data-pick-status-wrap') && at(picks, 'data-pick-status-wrap') < at(picks, 'picks submitted'), '[10i] under the timing line, above the name row');
  assert(/data-ps-player="p2" data-state="in"/.test(picks), '[10j] the viewer\'s own tile is "in" the moment his slate is complete (it reads his own rows)');

  // ── Picks: locked, signed in, did not pick ──
  storage.saveAllPicks([]); // (picks are additive in storage; use a player with no picks instead)
  seedWorld({ status: 'locked' });
  storage.setSession('p4', false, true);
  // D1 integration (W-18 / DI-539): the PF-1 lock-draft notice (DI-510 B1) shows instead of the locked card when THIS session had the editable form up for this very week and holds an
  // unsaved draft. This case is the ordinary locked card (a member who never had the form up), so the session's form memory is cleared first.
  app.state.pickFormShownFor = null; app.state.draftPicks = {};
  picks = renderPicks();
  assert(/week-status-card/.test(picks) && stripsIn(picks) === 1, '[10k] Picks, LOCKED card: the strip is present');
  assert(at(picks, 'week-status-card') < at(picks, 'data-pick-status-wrap'), '[10l] …BELOW the "Week is locked" card (DI-502a)');
  assert(/data-ps-phase="locked"/.test(picks) && /locked in/.test(picks), '[10m] in the locked phase, with the locked wording');
  assert(/aria-label="[^"]*No picks:/.test(picks), '[10n] the spoken label says "No picks: …" for those not in — never "missed"');
  assert(!/class="week-status-card"[^]*pick-status[^]*loss/.test(picks), '[10o] nothing red anywhere on the locked card');

  // ── Picks: no strip when it should not show ──
  seedWorld({ status: 'draft' });
  storage.setSession('p4', false, true);
  assert(stripsIn(renderPicks()) === 0, '[10p] a DRAFT week: no strip on Picks');
  seedWorld({ status: 'live' });
  assert(stripsIn(renderPicks()) === 0, '[10q] a LIVE week: no strip on Picks');
  seedWorld({ source: 'demo' });
  storage.setSession('p4', false, true);
  assert(stripsIn(renderPicks()) === 0, '[10r] a DEMO week shows a PLAYER no strip');
  storage.setSession('p1', true, true);
  assert(stripsIn(renderPicks()) === 1, '[10s] …and shows the COMMISSIONER the strip');
  seedWorld();
  storage.setSession(null, false, false);
  assert(stripsIn(renderPicks()) === 0, '[10t] signed out: no strip');

  // ── Dashboard: the card, both layouts, above the blind note ──
  seedWorld();
  storage.saveAllPicks(pickRows(ME));
  storage.setSession(ME, false, true);
  let dash = renderDash();
  assert(/All Picks by Game/.test(dash) && stripsIn(dash) === 1, '[10u] Dashboard: the "All Picks by Game" card carries exactly one strip');
  assert(at(dash, 'All Picks by Game') < at(dash, 'data-pick-status-wrap') && at(dash, 'data-pick-status-wrap') < at(dash, 'blind-note'), '[10v] below the card header and ABOVE the blind note (DI-502b)');
  assert(/pick-status-block/.test(dash) && !/pick-status-card/.test(dash), '[10w] as a block inside the card (not a second card nested in a card)');
  const sectionOrder = [at(dash, 'All Picks by Game'), at(dash, 'This Week Score Summary')];
  assert(sectionOrder[0] > 0 && sectionOrder[0] < sectionOrder[1], '[10x] the Dashboard section order is untouched (All Picks by Game before the summary)');
  // the old placeholder note is not rendered next to a strip
  localMode();
  assert(!/Who else has picks in/.test(dash), '[10y] the older "who else has picks in isn\'t available" note is NOT rendered beside the strip (the strip carries that sentence)');
  // compact (native always uses it): the slot is above the layout switch, so it is the same
  const compactHtml = app.renderDashboardCompact(storage.getPlayers().filter(p => p.active), storage.getGames(WK), storage.getPicks(WK), [], WK, null);
  assert(typeof compactHtml === 'string' && compactHtml.length > 0, '[10z] fixture: the compact renderer answers');
  const dashSrc = code(SRC.app.slice(SRC.app.indexOf("'dash-picks': `"), SRC.app.indexOf("// 2. ALMA MATER WATCH")));
  assert(dashSrc.indexOf('pickStatusBlockHTML(week.weekId)') > 0 && dashSrc.indexOf('pickStatusBlockHTML(week.weekId)') < dashSrc.indexOf('renderDashboardCompact') && dashSrc.indexOf('pickStatusBlockHTML(week.weekId)') < dashSrc.indexOf('renderDashboardTable'),
    '[10z2] source: the strip is emitted BEFORE the Standard / Compact switch, so BOTH layouts get it in the same position');

  // ── the full-page gate: a player who has not submitted ──
  seedWorld();
  storage.setSession('p4', false, true);
  dash = renderDash();
  assert(/Submit Your Picks First/.test(dash) && stripsIn(dash) === 1, '[10z3] the full-page gate carries the strip');
  assert(at(dash, 'Dashboard is hidden until you submit') < at(dash, 'data-pick-status-wrap') && at(dash, 'data-pick-status-wrap') < at(dash, 'id="go-picks-btn"'), '[10z4] …between its paragraph and its button (DI-502b)');
  assert(/<div class="btn-row dash-gate-actions"><button class="btn btn-primary" id="go-picks-btn">/.test(dash), '[10z5] the gate\'s button is a centred .btn-row group (Breathing Room: spaced by the container, never a margin on the button)');
  assert(!/id="go-picks-btn">Make My Picks<\/button><\/div><\/div>[^]*pick-status/.test(dash) && !/mt-md" id="go-picks-btn"/.test(dash), '[10z6] …and no `mt-md` margin on the button any more');
  assert(!/This Week Score Summary|dash-picks|All Picks by Game/.test(dash), '[10z7] the gate still shows NO dashboard section (the blind rule: nothing but names)');
  seedWorld(); storage.setSession('p4', false, true); setStatus('live');
  assert(stripsIn(renderDash()) === 0, '[10z8] a live week: no gate, no strip');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[11] THE BLIND RULE, END TO END — both worlds, with positive controls…');
// ═════════════════════════════════════════════════════════════════════════════
{
  const LEAKS = [SECRET_HOME, SECRET_AWAY, 'SECRETHOME', 'SECRETAWAY'];
  const noLeak = (html) => LEAKS.every(t => !html.includes(t));
  // WORLD 1 — local mode: every player's picks are on the device (the adversarial world)
  seedWorld();
  storage.saveAllPicks([...pickRows('p1'), ...pickRows('p3'), ...pickRows('p5'), ...pickRows(ME, 2, SECRET_HOME)]);
  storage.setSession(ME, false, true);
  let page = renderPicks();
  const s1 = stripHtmlOf(page);
  assert(s1.length > 500 && noLeak(s1), '[11a] LOCAL world, Picks: other players\' picks are on the device, and NOT ONE selection string reaches the strip');
  for (const tok of FORBIDDEN) assert(!s1.includes(tok), `[11b] LOCAL, Picks: the strip never contains "${tok}"`);
  // positive control: the page DOES contain the viewer's OWN picks elsewhere, so the assertion above is not passing over an absent page
  assert(els.get('submitted-games')._html.includes(SECRET_HOME), '[11c] positive control: the submitted Picks page really renders the VIEWER\'S OWN picks (his own team strings are on the page), so "no selection in the strip" is not passing over an empty page');
  page = renderDash();
  const s2 = stripHtmlOf(page);
  assert(s2.length > 500 && noLeak(s2), '[11d] LOCAL world, Dashboard card: the strip carries no selection');
  assert(/blind-note/.test(page) && /•••/.test(page), '[11e] positive control: the dashboard\'s blind cells are still there beside the strip, exactly as before');
  assert(!page.slice(0, at(page, 'blind-note')).includes('SECRETAWAY'), '[11f] and no other player\'s selection appears anywhere above the blind note');
  storage.setSession('p4', false, true);
  page = renderDash();
  assert(/Submit Your Picks First/.test(page) && noLeak(page), '[11g] LOCAL world, the full-page GATE: the whole page carries no selection at all');
  const table = app.renderDashboardTable(storage.getPlayers().filter(p => p.active), storage.getGames(WK), storage.getPicks(WK), [], WK, null);
  assert(/Submit my picks first|Submit My Picks/.test(table) && noLeak(table) && stripsIn(table) === 1, '[11h] LOCAL world, the MATRIX gate: a strip, a button, and no selection');
  // the strip lists names; its own text carries no team
  const names = parseHtml(s1).querySelectorAll('.ps-name').map(n => n.textContent);
  assert(names.join() === 'Drew,You,Kevin,Koby,Jacob,Kihoon', '[11i] positive control: the strip DOES name everyone (who has submitted is visible)');

  // WORLD 2 — supabase mode: RLS leaves only the viewer's own rows; others arrive only as counts
  const wkRec = storage.getWeek(WK); const gamesRec = storage.getGames(WK); const playersRec = storage.getPlayers();
  seedWorld();
  const wk2 = storage.getWeek(WK), g2 = storage.getGames(WK), pl2 = storage.getPlayers();
  void wkRec; void gamesRec; void playersRec;
  auth.configureAuth({ authMode: 'supabase', dataMode: 'supabase', authModeKnown: true, supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon' });
  auth._setMembershipsForTest([{ leagueId: 'L-ps', memberId: ME, role: 'player', displayName: 'Brayden', leagueName: 'League PS' }]);
  auth.setActiveLeagueId('L-ps');
  sb._resetForTest();
  sb.init({ getSession: () => ({ isAdmin: false, playerId: ME }) });
  sb._setStateForTest('ACTIVE', 'pickstatustest');
  quiet(() => {
    sb._seedMirrorForTest('cfbp_weeks', [wk2]); sb._seedMirrorForTest('cfbp_games', g2); sb._seedMirrorForTest('cfbp_players', pl2);
    sb._seedMirrorForTest('cfbp_picks', pickRows(ME, 2, SECRET_HOME));
    sb._seedMirrorForTest('cfbp_week_progress', { at: new Date().toISOString(), weeks: { [WK]: { p1: { pickCount: 2, hasTiebreaker: true, hasExtraPoint: true, lastUpdated: '2026-10-10T12:00:00.000Z' }, p2: { pickCount: 2, hasTiebreaker: true, hasExtraPoint: false, lastUpdated: '2026-10-10T12:01:00.000Z' }, p3: { pickCount: 2, hasTiebreaker: false, hasExtraPoint: false, lastUpdated: '2026-10-10T12:02:00.000Z' }, p4: { pickCount: 0, hasTiebreaker: false, hasExtraPoint: false, lastUpdated: null }, p5: { pickCount: 1, hasTiebreaker: false, hasExtraPoint: false, lastUpdated: null }, p6: { pickCount: 2, hasTiebreaker: true, hasExtraPoint: true, lastUpdated: '2026-10-10T12:03:00.000Z' } } } });
  });
  storage.setBackendMode('supabase');
  // navigateTo() withholds league content in a stubbed supabase world (no proven identity), so the placements are driven through the seams that
  // build them: the strip helper itself, the submitted view's own renderer, and the exported dashboard renderer.
  const s3 = app._pickStatusHTMLForTest(WK);
  assert(s3.length > 500 && /data-ps-player="p6" data-state="in"/.test(s3) && /data-ps-player="p4" data-state="notyet"/.test(s3), '[11j] SUPABASE world: the strip shows who is in from the COUNT (p6 in, p4 not yet) — names and states');
  assert(noLeak(s3), '[11k] …and no selection (this device never held another member\'s rows; only counts crossed the wire)');
  for (const tok of [...FORBIDDEN, 'true', '2026-10-10T12', '12:03', 'hasTiebreaker']) assert(tok === 'true' ? !/>true</.test(s3) : !s3.includes(tok), `[11l] SUPABASE: no count flag, guess flag or activity timestamp ("${tok}") reaches the strip`);
  assert(!/pick_count|pickcount/i.test(s3), '[11m] no per-member count appears either (only the two integers of "n of total")');
  const submittedC = { _html: '', set innerHTML(v) { this._html = String(v); }, get innerHTML() { return this._html; }, addEventListener() {}, querySelector() { return null; } };
  quiet(() => app._renderSubmittedViewForTest(submittedC, storage.getWeek(WK), storage.getGames(WK), { playerId: ME }, 'Brayden'));
  assert(stripsIn(submittedC._html) === 1 && noLeak(stripHtmlOf(submittedC._html)), '[11n] SUPABASE submitted view: one strip, clean');
  const tableS = app.renderDashboardTable(storage.getPlayers().filter(p => p.active), storage.getGames(WK), storage.getPicks(WK), [], WK, null);
  assert(/•••/.test(tableS), '[11n2] SUPABASE matrix: the blind cells are unchanged beside the strip (positive control — nothing else moved)');

  // the strip is built only from the model — mutate nothing, but prove the model has no pick-bearing field at all
  const model11 = app._buildPickStatusModelForTest(WK);
  assert(JSON.stringify(Object.keys(model11).sort()) === JSON.stringify(['asOf', 'inCount', 'known', 'loading', 'members', 'phase', 'stale', 'total', 'weekId']), '[11o] the model\'s fields are exactly the nine the DI allows — none can carry a selection');
  assert(model11.members.every(m => JSON.stringify(Object.keys(m).sort()) === JSON.stringify(['initials', 'isViewer', 'name', 'playerId', 'state'])), '[11p] each member carries exactly {playerId, name, initials, state, isViewer} — no count, no flag, no timestamp');
  localMode();
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[12] FRESHNESS WIRING — entry, own submit, chat arrival, the tick; the seam wrapper…');
// ═════════════════════════════════════════════════════════════════════════════
{
  // the wrapper (DI-502e item 1): reachable only through storage.js
  localMode();
  const rLocal = await storage.refreshWeekProgress();
  assert(rLocal.ok === false && rLocal.reason === 'not-supabase', '[12a] the seam wrapper answers {ok:false, reason:"not-supabase"} in local mode and touches nothing');
  const c = code(SRC.storage);
  assert(/export async function refreshWeekProgress\(/.test(c) && /sb\.refreshWeekProgress\(opts\)/.test(c) && /_backendMode !== 'supabase'/.test(c), '[12b] storage.js exports refreshWeekProgress(), gated on supabase mode, calling the adapter\'s');
  assert(!/sb\.refreshWeekProgress/.test(code(SRC.app)) && !/supabase-backend/.test(code(SRC.app).replace(/import \* as sb from '\.\/supabase-backend\.js';/, '')), '[12c] app.js never calls the adapter\'s refresh directly — it goes through the seam (authtest [44h])');
  assert(/export function refreshWeekProgress\(/.test(code(SRC.adapter)), '[12d] the adapter exports refreshWeekProgress()');

  // mountPickStatus: only in supabase mode and only with a strip on screen
  app._resetPickStatusForTest();
  strips = [];
  assert(app._mountPickStatusForTest('enter') === 'off', '[12e] local mode: mount does nothing');
  seedWorld();
  auth.configureAuth({ authMode: 'supabase', dataMode: 'supabase', authModeKnown: true, supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon' });
  auth._setMembershipsForTest([{ leagueId: 'L-ps', memberId: ME, role: 'player', displayName: 'Brayden', leagueName: 'League PS' }]);
  auth.setActiveLeagueId('L-ps');
  assert(app._mountPickStatusForTest('enter') === 'off', '[12f] supabase mode but NO strip on screen: nothing is asked (no wasted RPC on a page with no strip)');
  const ctl = app._pickStatusRefresherForTest;
  const calls0 = ctl.stats().calls;
  strips = [{ getAttribute: () => WK }];
  const r1 = app._mountPickStatusForTest('enter');
  assert(r1 === 'started' && ctl.stats().calls === calls0 + 1, '[12g] supabase mode WITH a strip on screen: screen entry starts one refresh');
  await quietAsync(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
  const r2 = app._mountPickStatusForTest('own-submit');
  assert(r2 === 'in-flight' || r2 === 'trailing', `[12h] a second trigger right after (own submit) is throttled / trailing, never a second concurrent call (got ${r2})`);
  app._resetPickStatusForTest();

  // a strip left in a HIDDEN page (the sections persist in the DOM) is not on screen: no entry refresh, no tick refresh
  stripsOnActivePage = false;
  assert(app._mountPickStatusForTest('enter') === 'off' && app._tickPickStatusForTest() === 'off', '[12h2] a strip in a hidden page section costs NO request — only a strip inside the ACTIVE page is "on screen"');
  stripsOnActivePage = true;
  // a screen entry right after a hydrate (a Realtime repaint re-enters navigateTo) is answered by that hydrate: asks for nothing
  sb._resetForTest(); sb.init({ getSession: () => ({ isAdmin: false, playerId: ME }) }); sb._setStateForTest('ACTIVE', 'pickstatustest');
  quiet(() => sb._seedMirrorForTest('cfbp_week_progress', { at: new Date().toISOString(), weeks: {} }));
  storage.setBackendMode('supabase');
  const reqF = app._pickStatusRefresherForTest.stats().requests;
  assert(app._mountPickStatusForTest('enter') === 'fresh' && app._pickStatusRefresherForTest.stats().requests === reqF, '[12h3] "enter" within 5 s of the last read asks for nothing (that read IS the refresh)');
  quiet(() => sb._seedMirrorForTest('cfbp_week_progress', { at: new Date(Date.now() - 6000).toISOString(), weeks: {} }));
  assert(app._mountPickStatusForTest('enter') !== 'fresh', '[12h4] …and past 5 s it asks (subject to the throttle)');
  app._resetPickStatusForTest();
  quiet(() => sb._seedMirrorForTest('cfbp_week_progress', { at: new Date().toISOString(), weeks: {} }));
  assert(app._mountPickStatusForTest('own-submit') !== 'fresh', '[12h5] an OWN submit is never skipped as "fresh" — the others\' answer predates it by definition');
  app._resetPickStatusForTest();

  // the tick (DI-502e): visible, a strip on screen, an answer a minute old
  const tickCtl = app._pickStatusRefresherForTest;
  strips = [{ getAttribute: () => WK }];
  docHidden = true;
  assert(app._tickPickStatusForTest() === 'hidden', '[12i] the tick does nothing while the page is hidden');
  docHidden = false;
  strips = [];
  assert(app._tickPickStatusForTest() === 'off', '[12j] …nor with no strip on screen');
  strips = [{ getAttribute: () => WK }];
  // a FRESH answer (just now): the tick leaves it alone
  sb._resetForTest(); sb.init({ getSession: () => ({ isAdmin: false, playerId: ME }) }); sb._setStateForTest('ACTIVE', 'pickstatustest');
  quiet(() => sb._seedMirrorForTest('cfbp_week_progress', { at: new Date().toISOString(), weeks: {} }));
  storage.setBackendMode('supabase');
  assert(app._tickPickStatusForTest() === 'fresh', '[12k] an answer under a minute old is "fresh": the tick does NOT re-ask');
  quiet(() => sb._seedMirrorForTest('cfbp_week_progress', { at: new Date(Date.now() - 61000).toISOString(), weeks: {} }));
  const callsT = tickCtl.stats().calls;
  const rt = app._tickPickStatusForTest();
  assert((rt === 'started' || rt === 'trailing') && (rt === 'trailing' || tickCtl.stats().calls === callsT + 1), `[12l] an answer a minute old: the tick asks (got ${rt})`);
  app._resetPickStatusForTest();
  localMode();
  strips = [];

  // the chat arrival hook (DI-506c) through the REAL fold
  const hookCtl = app._pickStatusRefresherForTest;
  app._resetPickStatusForTest();
  auth.configureAuth({ authMode: 'supabase', dataMode: 'supabase', authModeKnown: true, supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon' });
  strips = [{ getAttribute: () => WK }];
  const unsub = app._wirePickStatusChatArrivalForTest();
  assert(typeof unsub === 'function' && app._wirePickStatusChatArrivalForTest() === unsub, '[12m] the arrival hook is wired once (idempotent: a second call returns the same subscription)');
  const mk = (over) => ({ id: 'sys_in_a', seq: 100, ts: Date.now(), type: 'system', author: 'system', body: 'Kevin is in for Week 6 · 1 of 6', notify: false, meta: { kind: 'picksIn', weekId: WK, memberId: 'p3', inCount: 1, total: 6 }, ...over });
  const settleAll = () => quietAsync(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });
  const R = () => hookCtl.stats().requests;
  const req0 = R();
  const calls0b = hookCtl.stats().calls;
  chat.ingest([mk({ id: 'sys_hist', seq: 90 })], 90, { caughtUp: true });             // history: the room becomes "caught up"
  await settleAll();
  assert(R() === req0, '[12n] a HISTORY delivery (the room was not caught up yet) never asks for a refresh');
  chat.ingest([mk({ id: 'sys_in_live', seq: 101 })], 101, { caughtUp: true });        // live: the room was caught up before it
  await settleAll();
  assert(R() === req0 + 1 && hookCtl.stats().calls === calls0b + 1, '[12o] a LIVE "is in" line from the database asks for ONE refresh, and it starts');
  chat.ingest([mk({ id: 'sys_in_live', seq: 101 })], 101, { caughtUp: true });
  await settleAll();
  assert(R() === req0 + 1, '[12p] the SAME line arriving again (a re-fold) does not ask');
  chat.ingest([mk({ id: 'sys_forged', seq: 102, author: 'p3' })], 102, { caughtUp: true });
  chat.ingest([{ id: 'plain_1', seq: 103, ts: Date.now(), type: 'message', author: 'p4', body: 'hello', notify: true, meta: null }], 103, { caughtUp: true });
  chat.ingest([mk({ id: 'sys_other', seq: 104, meta: { kind: 'lifecycle' } })], 104, { caughtUp: true });
  await settleAll();
  assert(R() === req0 + 1, '[12q] a FORGED lookalike (author is a member), an ordinary message and another system kind never ask');
  chat.ingest([mk({ id: 'sys_cache', seq: 105 })], 105, { caughtUp: true, fromCache: true });
  await settleAll();
  assert(R() === req0 + 1, '[12r] a device-cache replay never asks');
  chat.ingest([mk({ id: 'sys_in_next', seq: 106, meta: { kind: 'picksIn', weekId: WK, memberId: 'p4', inCount: 2, total: 6 } })], 106, { caughtUp: true });
  await settleAll();
  assert(R() === req0 + 2, '[12s] the NEXT genuine line asks again (the watermark moved, it did not latch) — and the throttle, not the hook, decides whether it runs now');
  chat._resetForTest();
  app._resetPickStatusForTest();
  strips = [];
  localMode();
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[13] THE TOUCHED-SCREEN FIXES — the matrix gate, the commissioner\'s "everyone picked"…');
// ═════════════════════════════════════════════════════════════════════════════
{
  seedWorld();
  storage.setSession('p4', false, true);
  const table = app.renderDashboardTable(storage.getPlayers().filter(p => p.active), storage.getGames(WK), storage.getPicks(WK), [], WK, null);
  assert(!/btn-sm/.test(table) && !/onclick=/.test(table), '[13a] the matrix-level gate: no `.btn-sm` (34 px, under the 40 px floor) and no inline onclick');
  assert(/<div class="btn-row"><button class="btn btn-primary" data-go-tab="picks">Submit My Picks<\/button><\/div>/.test(table), '[13b] a full-size .btn in its own centred .btn-row, wired by data-go-tab');
  const signedOut = (() => { storage.setSession(null, false, false); return app.renderDashboardTable(storage.getPlayers().filter(p => p.active), storage.getGames(WK), storage.getPicks(WK), [], WK, null); })();
  assert(!/btn-sm/.test(signedOut) && !/onclick=/.test(signedOut) && /data-go-tab="picks">Go to Picks</.test(signedOut) && stripsIn(signedOut) === 0, '[13c] the signed-out variant gets the same fix and shows no strip (nothing to show a visitor)');
  // the binder: a listener, an allow-list of one
  const bound = []; const navs = [];
  const fakeBtn = (tab) => ({ getAttribute: (n) => (n === 'data-go-tab' ? tab : null), addEventListener: (t, fn) => bound.push({ t, fn, tab }) });
  app._bindDashboardGateButtonsForTest({ querySelectorAll: () => [fakeBtn('picks'), fakeBtn('commissioner')] });
  assert(bound.length === 2 && bound.every(b => b.t === 'click'), '[13d] bindDashboardGateButtons() attaches a click LISTENER to each data-go-tab button');
  app.state.currentTab = 'dashboard';
  bound.find(b => b.tab === 'commissioner').fn();
  assert(app.state.currentTab === 'dashboard', '[13e] a data-go-tab other than "picks" navigates NOWHERE (markup can never steer the app)');
  bound.find(b => b.tab === 'picks').fn();
  assert(app.state.currentTab === 'picks', '[13f] "picks" navigates to Picks');
  void navs;
  storage.setSession(ME, false, true);

  // A1 — the commissioner's reminder controls ask the ONE definition
  const rem = app._renderScribeReminderControlsHTMLForTest;
  seedWorld();
  storage.saveAllPicks([...pickRows('p1'), ...pickRows('p2'), ...pickRows('p3'), ...pickRows('p4'), ...pickRows('p5'), ...pickRows('p6')]);
  const wk = storage.getWeek(WK);
  assert(/Everyone picked|everyone/i.test(rem(wk)) && !/remind the stragglers/.test(rem(wk)), '[13g] local mode, all six full: the controls say everyone picked (flag-off world unchanged)');
  seedWorld();
  storage.saveAllPicks([...pickRows('p1'), ...pickRows('p2')]);
  assert(/remind the stragglers/.test(rem(storage.getWeek(WK))), '[13h] local mode, four missing: the controls offer the reminder (unchanged)');
  // supabase mode, the commissioner's device: only HIS rows are here, but the server count says everyone is in
  const wkRec = storage.getWeek(WK); const gamesRec = storage.getGames(WK); const playersRec = storage.getPlayers();
  const commissioner = (counts) => {
    auth.configureAuth({ authMode: 'supabase', dataMode: 'supabase', authModeKnown: true, supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon' });
    auth._setMembershipsForTest([{ leagueId: 'L-ps', memberId: 'p1', role: 'commissioner', displayName: 'Drew', leagueName: 'League PS' }]);
    auth.setActiveLeagueId('L-ps');
    sb._resetForTest(); sb.init({ getSession: () => ({ isAdmin: true, playerId: 'p1' }) }); sb._setStateForTest('ACTIVE', 'pickstatustest');
    quiet(() => {
      sb._seedMirrorForTest('cfbp_weeks', [wkRec]); sb._seedMirrorForTest('cfbp_games', gamesRec); sb._seedMirrorForTest('cfbp_players', playersRec); sb._seedMirrorForTest('cfbp_picks', pickRows('p1'));
      if (counts) sb._seedMirrorForTest('cfbp_week_progress', { at: new Date().toISOString(), weeks: { [WK]: Object.fromEntries(Object.entries(counts).map(([id, n]) => [id, { pickCount: n, hasTiebreaker: false, hasExtraPoint: false, lastUpdated: null }])) } });
    });
    storage.setBackendMode('supabase');
  };
  commissioner({ p1: 2, p2: 2, p3: 2, p4: 2, p5: 2, p6: 2 });
  const allIn = rem(wkRec);
  assert(!/remind the stragglers/.test(allIn) && /everyone/i.test(allIn), '[13i] SUPABASE, commissioner\'s device (only his own rows here): the server count says all six are in -> the controls switch to "everyone is in" (the old check was never true under RLS)');
  commissioner({ p1: 2, p2: 2, p3: 2, p4: 2, p5: 2, p6: 1 });
  assert(/remind the stragglers/.test(rem(wkRec)), '[13j] SUPABASE: one member half-way -> the controls still offer the reminder');
  commissioner(null);
  assert(/remind the stragglers/.test(rem(wkRec)), '[13k] SUPABASE with NO count on the device ("unknown") -> the controls stay (unknown is NOT "picked": the safe side)');
  localMode();
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[14] THE RETIRED EMITTER and THE BOOT-ORDER POSITION OF THE ARRIVAL HOOK…');
// ═════════════════════════════════════════════════════════════════════════════
{
  const a = code(SRC.app);
  const submitBody = a.slice(a.indexOf('function submitPicks(week, games) {'), a.indexOf('export const _submitPicksForTest'));
  assert(/if \(!isSupabaseDataMode\(\)\) \{\s*try \{\s*const totalPicks[\s\S]*?emitPicksLockedEvent\(week\.weekId, session\.playerId, totalPicks, games\.length\);\s*\} catch \{\}\s*\}/.test(submitBody),
    '[14a] submitPicks() calls emitPicksLockedEvent ONLY when the data backend is NOT supabase (local mode keeps its "locked N/M" line)');
  assert((submitBody.match(/emitPicksLockedEvent\(/g) || []).length === 1, '[14b] and it is still the one call site');
  assert(/function emitPicksLockedEvent/.test(code(await readFile(new URL('./js/chat-ui.js', import.meta.url), 'utf8'))), '[14c] the emitter function itself is untouched (it stays for local mode and its tests)');

  // behaviour: local mode posts, supabase mode does not
  seedWorld({ tiebreaker: null });
  storage.setSession(ME, false, true);
  chat._resetForTest();
  const before = chat._outboxForTest().length;
  app.state.draftPicks = { [`${WK}_g1`]: `${SECRET_HOME} 1`, [`${WK}_g2`]: `${SECRET_HOME} 2` }; app.state.draftTiebreaker = null; app.state.editingPicks = false;
  quiet(() => app._submitPicksForTest(storage.getWeek(WK), storage.getGames(WK)));
  const localOut = chat._outboxForTest().filter(e => /^sys_lock_/.test(e.id));
  assert(localOut.length === 1 && localOut[0].id === `sys_lock_${WK}_${ME}` && localOut[0].meta.kind === 'picksLocked', `[14d] LOCAL mode still posts the "locked N/M" line (outbox +${chat._outboxForTest().length - before}, id ${localOut[0] && localOut[0].id})`);
  assert(!/SECRET/.test(localOut[0].body), '[14e] …and it carries a count only, never a selection (the hard rule)');
  chat._resetForTest();

  seedWorld({ tiebreaker: null });
  const wkRec = storage.getWeek(WK); const gamesRec = storage.getGames(WK); const playersRec = storage.getPlayers();
  auth.configureAuth({ authMode: 'supabase', dataMode: 'supabase', authModeKnown: true, supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon' });
  auth._setMembershipsForTest([{ leagueId: 'L-ps', memberId: ME, role: 'player', displayName: 'Brayden', leagueName: 'League PS' }]);
  auth.setActiveLeagueId('L-ps');
  // `register` hands storage.js the adapter's probe, so the picks write passes the data-layer interlock and submitPicks() REACHES its emit point
  sb._resetForTest(); sb.init({ getSession: () => ({ isAdmin: false, playerId: ME }), register: auth.registerSupabaseDataBackend }); sb._setStateForTest('ACTIVE', 'pickstatustest');
  quiet(() => { sb._seedMirrorForTest('cfbp_weeks', [wkRec]); sb._seedMirrorForTest('cfbp_games', gamesRec); sb._seedMirrorForTest('cfbp_players', playersRec); sb._seedMirrorForTest('cfbp_picks', []); });
  storage.setBackendMode('supabase');
  chat._resetForTest();
  app.state.draftPicks = { [`${WK}_g1`]: `${SECRET_HOME} 1`, [`${WK}_g2`]: `${SECRET_HOME} 2` }; app.state.draftTiebreaker = null; app.state.editingPicks = false;
  let submitErr = null;
  quiet(() => { try { app._submitPicksForTest(storage.getWeek(WK), storage.getGames(WK)); } catch (e) { submitErr = e; } });
  assert(submitErr === null && storage.getPicks(WK, ME).length === 2, `[14f0] positive control: the SUPABASE-mode submit really ran and wrote both picks, so the emit point WAS reached (${submitErr ? submitErr.message : 'no error'})`);
  assert(chat._outboxForTest().filter(e => /^sys_lock_/.test(e.id)).length === 0, '[14f] SUPABASE mode posts NO sys_lock_ line — the server has refused every one since the 2026-09-19 cutover, and a futile request plus a 60 s parked retry per submit is gone');
  chat._resetForTest();
  localMode();

  // boot order (the 2026-09-26 rule): the hook needs NO resolved precondition, and sits beside its sibling
  const bootAt = a.indexOf('boot()') >= 0 ? a.indexOf('wireChatNotifications();') : -1;
  const hookAt = a.indexOf('wirePickStatusChatArrival();');
  assert(bootAt > 0 && hookAt > bootAt && hookAt - bootAt < 900, `[14g] boot(): wirePickStatusChatArrival() sits directly AFTER wireChatNotifications() (comment-stripped source scan; ${hookAt - bootAt} chars apart)`);
  assert((a.match(/wirePickStatusChatArrival\(\);/g) || []).length === 1, '[14h] …and is called exactly once');
  const hookFn = a.slice(a.indexOf('function wirePickStatusChatArrival'), a.indexOf('export const _buildPickStatusModelForTest'));
  assert(/onChat\(/.test(hookFn) && !/getSession|getActiveLeagueId|hydrate|getSupabaseClient|configureAuth|getAuthMode/.test(hookFn), '[14i] it needs no resolved precondition: it only registers a chat subscriber and touches no auth, config, SDK or hydrate state');
  assert(/if \(_pickStatusChatUnsub\) return _pickStatusChatUnsub;/.test(hookFn), '[14j] it is idempotent (a second boot-path call cannot double-subscribe)');

  // the freshness hooks' source positions
  assert(/checkLifecyclePostDue\(\); \} catch \{\}\s*mountPickStatus\('enter'\);/.test(a), '[14k] navigateTo(): the screen-entry refresh rides the same chokepoint as the reveal / lifecycle checks');
  assert(/renderPicksPage\(\); window\.scrollTo\(\{ top: 0 \}\); mountPickStatus\('own-submit'\);/.test(a), '[14l] submitPicks(): own-submit refresh fires AFTER the submitted view is painted');
  const tick = a.slice(a.indexOf('export async function runAutoRefreshTick'), a.indexOf('export function tickAutoTransition'));
  const iTick = tick.indexOf('tickPickStatus();'); const iWeekReturn = tick.indexOf("if (week.dataSourceMode === 'demo'");
  assert(iTick > 0 && iWeekReturn > iTick && /if \(!statusTickRidesHydrate\) tickPickStatus\(\);/.test(tick), '[14m] the 60 s tick calls tickPickStatus() ABOVE the demo / manual week returns (a demo week still shows the commissioner a strip) and not when this round already re-hydrated');
  assert(/^\s*(?:return|await)\b/m.test(tick) && !/await tickPickStatus|return tickPickStatus/.test(tick), '[14n] fire-and-forget: the tick never awaits it, so it can never hold the scores round');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[15] D1 / DI-539 #2 — THE STRIP COUNTS ENTRANTS, NOT EVERYONE…');
// ═════════════════════════════════════════════════════════════════════════════
{
  const a = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
  const fn = a.slice(a.indexOf('function buildPickStatusModel'), a.indexOf('/** The strip for one week'));
  assert(/players: isMultiSportLeague\(\) \? entrantsForWeek\(week\) : getPlayers\(\),/.test(fn), '[15a] buildPickStatusModel hands the strip the week\'s ENTRANTS in a league with two or more sports, and every player in a one-sport league (the seam: sport-seam.entrantsForWeek -> playersForWeek once the client branch is merged)');
  // the pure model: a roster of the entrants is the whole story
  const wk = { weekId: 'w_ms', status: 'open', dataSourceMode: 'live' };
  const gs = [{ gameId: 'g1', weekId: 'w_ms' }, { gameId: 'g2', weekId: 'w_ms' }];
  const people = ['p1', 'p2', 'p3', 'p4'].map((id, i) => ({ playerId: id, displayName: ['Ann', 'Ben', 'Cy', 'Di'][i], initials: ['A', 'B', 'C', 'D'][i], active: true }));
  const read = { state: (w, id) => (id === 'p1' || id === 'p2' ? 'yes' : 'no'), isPublic: () => false, asOf: () => '', pending: () => false };
  const all4 = PS.pickStatusFor({ week: wk, games: gs, players: people, viewerId: 'p1', read, now: 0 });
  const nfl3 = PS.pickStatusFor({ week: wk, games: gs, players: people.slice(0, 3), viewerId: 'p1', read, now: 0 });
  assert(all4.total === 4 && all4.inCount === 2 && nfl3.total === 3 && nfl3.inCount === 2 && nfl3.members.map(m => m.playerId).join() === 'p1,p2,p3', '[15b] three entrants out of four members: the strip says 2 of 3, and the member who is not in the sport is not a tile (never called missing)');
  const outsider = PS.pickStatusFor({ week: wk, games: gs, players: people.slice(0, 3), viewerId: 'p4', read, now: 0 });
  assert(outsider.phase === 'hidden' && outsider.total === 0 && outsider.members.length === 0, '[15c] a viewer who is not an entrant of the week\'s sport gets NO strip - no You marker, no tiles, no Join prompt on the strip itself');
}

console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
// Flush before exiting (loadtest.mjs parses stdout + stderr from a pipe; process.exit() does not drain one).
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
