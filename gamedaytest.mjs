/**
 * CFB Pickems — gamedaytest.mjs (Deployment 1, Lane B, DI-603 … DI-609, PF-420 / 443 / 445 / 447 / 448 / 452 rev 3, security C2 C3 C4 C5 C6 C7, 2026-10-08)
 * ==========================================================================================================================================================
 * GAME DAY: the red card at the top of Home — what is on the collapsed card in every state, what opens in place, what the open card shows to whom, and the one name it goes by. Run over a REAL createHome()
 * (d1homeenv) on a REAL element tree, the REAL storage seam, and the scenarios of the approved mockup (gamedayenv): live with 1 / 3 / 9 / 11 games, CFB + NFL, a CFB-only member following the NFL,
 * CFB Live + NFL Locked in ONE card, nothing live, Locked, all final, a finalized week, Open due / Open in.
 *
 *   [1] The pills: live games only; the order; the cap of five with "All n ›"; the first live game of each sport is always among them; one per live game, none for upcoming / awaiting / final
 *   [2] The collapsed card in every state: the count, the personal line, ONE calm two-line message when nothing is live (never an empty rail), the open states do not expand
 *   [3] The open card: at most five rows, the footer, the "All n games on Dashboard ›" button, no inner scroller
 *   [4] What the open card shows to whom (security): Locked / Open / derived-locked are blind; a live week groups; C2 (CFB Live + NFL Locked in one card); C3 (the model's JSON carries no rival);
 *       C4 (a non-entrant and a late joiner change nothing); C7 (a sport the viewer has not joined is a plain score row, in a Locked, an Open and a Live week)
 *   [5] Excluded weeks (UN-71): a draft week is absent for a member; a demo week for anyone but the commissioner
 *   [6] Entry points and forged ids: every action is validated against the CURRENT paint; in-place open / close; the card survives a repaint and a Game view; Back lands with the card open
 *   [7] Names (DI-608): "Game Day" is the card's name; "Live Peek" and "GameDay" appear in no user-facing string anywhere in the app
 *   [8] Escaping (C5): hostile team, display and sport names come out inert in text, aria-label and title; the renderers REFUSE to run without an escaper
 *   [9] Contrast: the pill's text pairs meet 4.5:1 on the card's gradient in every look and both sides
 *  [10] Every Game Day button tapped through the real dispatcher, in every state it is drawn in
 *  [11] A feed change in the same paint never replaces the Game Day node; the rail HOLD (a finger on it parks the change) — including a NEW touch during the hold (P-3: finger B lands before the flush;
 *       a lost touch A, then a touch B elsewhere ends; the app returning to the foreground)
 *  [12] Mutation proofs on a scratch copy: the four Game-Day bypasses of 3518519e against [4], the three hold mutants (the reviewer's B3m-b first) against [11], and the announcer / leaving-pill /
 *       in-place / logo / What's next / finish-in-place / locked-copy mutants against [13], [14] and [15], and the gate-transition / whole-card-fallback mutants against [16] and [17]
 *  [13] Live announcements (DI-604 / DI-593, Std-7), the leaving pill (DI-604) and DI-572(a) in-place ticks of pills and rows
 *  [14] Team logos in the open card's rows (DI-605 line 1, DI-572, PF-446)
 *  [15] What's next (DI-599) on the Final card and the Game view, the finish in place (DI-593: the chip cross-fade, What's next fading in), the locked copy for a partial slate
 *  [16] Every gate transition (public / hidden / none / rows not landed x By person / By team) patched in place equals a fresh paint, in the card and the panel; a closing gate leaves no rival side
 *  [17] A patch that throws: Home writes the whole card from the new markup
 *
 * Run:  node gamedaytest.mjs
 */
import { readFileSync, readdirSync, statSync, mkdtempSync, mkdirSync, cpSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// GDT_SECTIONS=4,6 runs only those sections; GDT_CORE=1 skips [12], the mutation proofs (a proof run re-runs section [4] or [11] on a scratch copy and must not recurse).
const WANT = process.env.GDT_SECTIONS ? new Set(process.env.GDT_SECTIONS.split(',').map((x) => x.trim())) : null;
const want = (n) => !WANT || WANT.has(String(n));
const CORE_ONLY = process.env.GDT_CORE === '1';

let pass = 0, fail = 0;
const assert = (cond, label, extra = '') => { if (cond) { pass++; console.log('  ✅', label); } else { fail++; console.error('  ❌', label, extra ? `\n     ${extra}` : ''); } };
const HERE = fileURLToPath(new URL('.', import.meta.url));
const read = (rel) => readFileSync(join(HERE, rel), 'utf8');

const { installDom, click, keysOf } = await import('./d1homeenv.mjs');
const doc = installDom();
const home = await import('./js/home.js');
const storage = await import('./js/storage.js');
const gd = await import('./js/gameday.js');
const gds = await import('./js/gameday-sheet.js');
const E = await import('./gamedayenv.mjs');
const fx = await import('./statsfixtures.mjs');
const MODS = { home, storage };
// THE SERVED MARKUP: every string assigned to any element's innerHTML, captured before the element tree parses it (the tree re-serialises attribute values, so reading it back is not what a browser is served).
const { MiniElement } = await import('./minidom.mjs');
const ihDesc = Object.getOwnPropertyDescriptor(MiniElement.prototype, 'innerHTML');
const servedLog = [];
Object.defineProperty(MiniElement.prototype, 'innerHTML', { configurable: true, get: ihDesc.get, set(v) { servedLog.push(String(v)); ihDesc.set.call(this, v); } });
const served = (fn) => { servedLog.length = 0; fn(); return servedLog.join('\n'); };

const strip = (h) => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const count = (h, re) => (h.match(re) || []).length;
const pillsOf = (card) => [...card.matchAll(/data-home-action="gd-pill" data-game-id="([^"]+)"/g)].map((m) => m[1]);
const rowsOf = (card) => [...card.matchAll(/class="gd-row"[^>]*data-game-id="([^"]+)"/g)].map((m) => m[1]);
const mountS = (name, o = {}, tweak = null) => { const s = E.scenario(name, o); if (tweak) tweak(s); return { s, m: E.mount(MODS, doc, s) }; };
const live = (name) => E.SCENARIOS[name].live;

// ═══ [1] The pills ═════════════════════════════════════════════════════════════════════════════
console.log('\n[1] The pills: live games only, in order, capped at five…');
if (want(1)) {
  const expected = { live1: 1, live3: 3, live9: 5, live11: 5, both: 5, spectator: 5, mixed: 2, quiet: 0, locked: 0, allfinal: 0, final: 0, openDue: 0, openIn: 0 };
  for (const [name, n] of Object.entries(expected)) {
    const { m } = mountS(name);
    const ids = pillsOf(m.card());
    assert(ids.length === n, `1-${name}: ${n} pill(s) (got ${ids.length}: ${ids.join(',')})`);
    assert(ids.every((id) => live(name).includes(id)), `1-${name}-live: every pill is a LIVE game — never an upcoming, awaiting or final one (${ids.join(',')})`);
  }
  const { m: m3 } = mountS('live3');
  assert(pillsOf(m3.card()).join() === 'c1,c2,c3', '1a: the pills are in kickoff order among the live games (c1, c2, c3)');
  const { m: m9 } = mountS('live9');
  const c9 = m9.card();
  assert(pillsOf(c9).length === 5 && /data-home-action="gd-more"/.test(c9) && /All 9/.test(strip(c9)), `1b: nine live games: FIVE pills and one "All 9 ›" (the rail is a window, never a wall): "${(strip(c9).match(/All 9[^A-Za-z]*/) || [''])[0].trim()}"`);
  assert(!/data-home-action="gd-more"/.test(m3.card()) && !/data-home-action="gd-more"/.test(mountS('live1').m.card()), '1c: three or fewer live games: no "All n ›"');
  const { m: m11 } = mountS('live11');
  const p11 = pillsOf(m11.card());
  assert(p11.length === 5 && p11.some((id) => ['n1', 'n2'].includes(id)), `1d: eleven live games over two sports: the first live game of EACH sport is among the five, so a live NFL game is never pushed out by five live CFB games (${p11.join(',')})`);
  assert(/All 11/.test(strip(m11.card())), '1e: …and the exact total is stated: "All 11 ›"');
  const { m: mb } = mountS('spectator');
  const pb = pillsOf(mb.card());
  assert(pb.indexOf('c1') < pb.indexOf('n1') && pb.length === 5, `1f: for a member who plays CFB and only follows the NFL, the sports they play come first inside a group (${pb.join(',')})`);
  const model9 = gd.gameDayModel;
  assert(typeof model9 === 'function' && gd.PILL_CAP === 5 && gd.ROW_CAP === 5, '1g: the pill cap and the row cap are the same five (so the pills are always a subset of the rows)');
}

// ═══ [2] The collapsed card in every state ═════════════════════════════════════════════════════
console.log('\n[2] The collapsed card in every state…');
if (want(2)) {
  const t = (name, o) => { const { m } = mountS(name, o); return { m, c: m.card(), txt: strip(m.card()) }; };
  let r = t('live3');
  assert(/Game Day/.test(r.txt) && /· 3 live/.test(r.txt) && /You: 1–0/.test(r.txt) && /aria-label="Game Day, 3 games live\. Expand\."/.test(r.c) && /data-gd-expanded="false"/.test(r.c), '2a: live — "Game Day · 3 live", the viewer\'s week, a header that announces itself ("Game Day, 3 games live. Expand.")');
  r = t('live1');
  assert(/aria-label="Game Day, 1 game live\. Expand\."/.test(r.c) && /· 1 live/.test(r.txt), '2b: one live game says "1 game live" (the singular)');
  r = t('quiet');
  assert(/Nothing live right now/.test(r.txt) && /class="gd-msg"/.test(r.c) && !/gd-rail/.test(r.c) && /<b>Next kickoff [^<]+<\/b><span>Clemson at Miami<\/span>/.test(r.c), '2c: nothing live: ONE calm two-line message ("Next kickoff Sun 11:00 AM" over the matchup), never an empty rail');
  r = t('locked');
  assert(/Locked/.test(r.txt) && /First kickoff/.test(r.txt) && /your picks are in/.test(r.txt) && !/gd-rail/.test(r.c), '2d: Locked — "First kickoff … In 2h 10m · your picks are in"');
  r = t('allfinal');
  assert(/All games final/.test(r.txt) && /Results post when Week 6 is finalized\./.test(r.txt), '2e: every game final, the week not yet finalized — "All games final" and when results post');
  r = t('final');
  assert(/Week 6 final/.test(r.txt) && /Kihoon took Week 6, 2–2/.test(r.txt) && /You went 4–0/.test(r.txt), '2f: a finalized week — the winner line and the viewer\'s own result');
  for (const name of ['openDue', 'openIn']) {
    const x = t(name);
    assert(!x.m.home.gameDayState().expandable && x.m.open() === x.m.html() === false || !x.m.home.gameDayState().expandable, `2g-${name}: an OPEN week's card does not expand (nothing to open: its one action is on the card)`);
  }
  r = t('openDue');
  assert(/Picks lock/.test(r.txt) && /you have not picked yet/.test(r.txt) && /Make picks/.test(r.txt), '2h: Open, picks due — the lock instant, "you have not picked yet" and one action "Make picks"');
  r = t('openIn');
  assert(/You're in for Week 6/.test(r.txt) && /6 of 6 picked/.test(r.txt) && /Edit picks/.test(r.txt), '2i: Open, picks in — "You\'re in for Week 6", the count, "Edit picks"');
  r = t('live3', { fresh: 'stale' });
  assert(/Score may be behind|behind|last update/i.test(r.txt) || /gd-stalechip/.test(r.c), '2j: a stale capture says so on the card (a quiet chip), never a silent minutes-old score');
  r = t('live3', { viewer: null });
  assert(!/You:/.test(r.txt) && pillsOf(r.c).length === 3, '2k: signed out: no personal line (there is no "you"), the live games still show');
  const all = Object.keys(E.SCENARIOS).map((n) => mountS(n).m.card()).join('\n');
  assert(!/Live Peek|GameDay/.test(all) && Object.keys(E.SCENARIOS).every((n) => /aria-label="Game Day"/.test(mountS(n).m.card())), '2l: DI-608 — every collapsed state carries the section name "Game Day" (aria-label) and never "Live Peek" or "GameDay"');
}

// ═══ [2b] Accessibility text sizes: the personal line moves into the open card (DI-603, fix round 1) ═══
console.log('\n[2b] At accessibility text sizes (root scale >= 150%) the header alone is the card and the personal line moves into the open card…');
if (want('2b')) {
  // DI-603 "Largest text": at accessibility categories the pill rail is not drawn, the header wraps to two lines, and the personal line ("You: 3–1 · 2nd") DROPS INTO THE EXPANDED CARD. Reduced to the facts: with
  // `railHidden` the collapsed header carries no personal line and the open card carries it (never both, never neither: a card that cannot open keeps it in the header).
  const nowCard = (name, { railHidden, expanded }) => {
    const s = E.scenario(name); const m = E.mount(MODS, doc, s);
    const snap = m.env.home.assembleSnapshot({ viewerId: 'p1', isCommissioner: false, now: s.now });
    const nm = home.nowCardModel(snap, { viewerId: 'p1', isCommissioner: false, now: s.now });
    return home.renderNowCard(snap, { viewerId: 'p1', isCommissioner: false, now: s.now, escHtml: E.esc, gameDay: { expanded, railHidden, view: 'team', entrantsFor: s.deps.entrantsFor } }).html + (nm ? '' : '');
  };
  const headOf = (h) => (h.match(/<(?:button|div) type="button" class="gd-head[\s\S]*?<\/(?:button|div)>/) || h.match(/<div class="gd-head[\s\S]*?<\/div>/) || [''])[0];
  for (const name of ['live3', 'quiet', 'allfinal', 'final']) {
    const normalClosed = nowCard(name, { railHidden: false, expanded: false });
    const bigClosed = nowCard(name, { railHidden: true, expanded: false });
    const bigOpen = nowCard(name, { railHidden: true, expanded: true });
    const normalOpen = nowCard(name, { railHidden: false, expanded: true });
    const line = (strip(headOf(normalClosed)).match(/You: [^]*$/) || [''])[0].replace(/\s+$/, '');
    assert(/class="gd-me"/.test(headOf(normalClosed)) && line.startsWith('You:'), `2b-${name}-0: (control) at normal text size the collapsed header carries the personal line ("${line}")`);
    assert(!/gd-rail/.test(bigClosed) && !/class="gd-me"/.test(headOf(bigClosed)) && !/You:/.test(strip(headOf(bigClosed))), `2b-${name}-a: at accessibility size the collapsed header carries NO personal line (and no rail)`);
    assert(new RegExp(`class="gd-stat gd-stat--me"[^>]*>${line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<`).test(bigOpen) && /aria-label="Your week /.test(bigOpen.match(/class="gd-stat gd-stat--me"[^>]*>/)[0]) && !/class="gd-me"/.test(headOf(bigOpen)), `2b-${name}-b: …and the OPEN card carries it, with its spoken label ("${line}")`);
    assert(!/gd-stat--me/.test(normalOpen), `2b-${name}-c: …but at normal size the open card does not repeat it (the header has it)`);
  }
  // a card that cannot open keeps the line in its header: dropping it would lose the fact
  const stuck = gd.gameDayModel({ state: 'live', entries: [], viewerId: 'p1', personal: { text: 'You: 3–1 · 2nd', aria: 'Your week 3–1, season rank 2nd' } });
  const closedStuck = gd.gameDayCardHTML({ ...stuck, expandable: false, header: { ...stuck.header, me: 'You: 3–1 · 2nd', meAria: 'x' } }, { escHtml: E.esc, numHtml: E.NUMHTML, railHidden: true });
  assert(/class="gd-me"/.test(closedStuck), '2b-d: a card that cannot open keeps the personal line in its header at accessibility size (nowhere else to put it)');
}

// ═══ [3] The open card ═════════════════════════════════════════════════════════════════════════
console.log('\n[3] The open card: five rows at most, the footer, no inner scroller…');
if (want(3)) {
  for (const name of ['live1', 'live3', 'live9', 'live11', 'both', 'spectator', 'mixed', 'quiet', 'locked', 'allfinal', 'final']) {
    const { m } = mountS(name);
    m.open();
    const c = m.card();
    const rows = rowsOf(c);
    assert(rows.length >= 1 && rows.length <= 5, `3-${name}: the open card shows at most FIVE game rows (${rows.length})`);
    assert(/data-gd-expanded="true"/.test(c) && /data-home-action="gd-collapse"/.test(c) && /data-home-action="gd-dashboard"/.test(c), `3-${name}-foot: it carries Collapse and the Dashboard button`);
    assert(!/overflow-y|overflow:\s*(auto|scroll)|max-height/.test(c), `3-${name}-scroll: no inner scroller (no overflow or max-height in the served markup)`);
  }
  const { s: s9, m: m9 } = mountS('live9'); m9.open();
  const total9 = s9.league.games.length;
  assert(new RegExp(`All ${total9} games on Dashboard`).test(strip(m9.card())), `3a: more games than rows: the footer button names the exact total ("All ${total9} games on Dashboard ›"), so no game is unreachable`);
  const { m: ml } = mountS('live3'); ml.open();
  assert(!/All \d+ games on Dashboard/.test(strip(ml.card())) || rowsOf(ml.card()).length === 5, '3b: with every game in view the button is the plain one');
  const first = rowsOf(m9.card());
  assert(first.slice(0, 5).every((id) => live('live9').includes(id)) && first.length === 5, `3c: the rows are live first (${first.join(',')})`);
  const { m: mq } = mountS('quiet'); mq.open();
  assert(/Your numbers|You: 4–2|4–2/.test(strip(mq.card())), '3d: the open card repeats the viewer\'s week in words ("Your numbers")');
  const { m: mf } = mountS('final');
  const fcol = mf.card();
  mf.open();
  assert(/Results/.test(strip(fcol)) && /data-home-action="gd-dashboard"/.test(mf.card()) && /data-home-action="gd-collapse"/.test(mf.card()), '3e: a finalized week offers "Results" on its card, and the open card the Dashboard button and Collapse');
  const { m: mo } = mountS('live3'); mo.open(); mo.close();
  assert(mo.home.gameDayState().expanded === false && /data-gd-expanded="false"/.test(mo.card()), '3f: closing it returns the collapsed card');
}

// ═══ [4] What the open card shows to whom ══════════════════════════════════════════════════════
console.log('\n[4] What the open card shows to whom: the gate, C2, C3, C4, C7…');
if (want(4)) {
  // F2.3 (security, fix round 1): the blind rule binds the COMMISSIONER too (RG-37), so every blind check below runs as a player AND as the commissioner (isCommissioner: true).
  for (const asAdmin of [false, true]) for (const base of ['locked']) {
    const name = asAdmin ? `${base}/commissioner` : base;
    const { m } = mountS(base, { admin: asAdmin }); m.open();
    const c = m.card();
    assert(count(c, /pg-pp--blind/g) === rowsOf(c).length * 5 && count(c, /pg-pp--me/g) === rowsOf(c).length && !/pg-cluster/.test(c), `4a-${name}: a LOCKED week: the blind form on every row (the viewer's own pick, five "•••"), no cluster`);
    const mine = [...c.matchAll(/<span class="pg-pp pg-pp--me"><b class="pg-who">([^<]*)<\/b> ([^<]*)<\/span>/g)].map((x) => `${x[1]} ${x[2]}`);
    const yours = [...c.matchAll(/class="gd-r3">Your pick: <b>([^<]*)<\/b>/g)].map((x) => x[1]);
    assert(yours.join() === 'Texas,Georgia,Michigan,USC,LSU' && mine.join(' | ') === 'DH TEX | DH UGA | DH MICH | DH USC | DH LSU' && !/\bOU\b/.test((c.match(/<button type="button" class="gd-row"[^>]*data-game-id="c1"[\s\S]*?<\/button>/) || [''])[0]), `4a-own-${name}: the "own" chip on a Locked row is the VIEWER'S pick (c1: DH TEX) and the side only a rival took (OU, p4 and p6) is nowhere on that row — c5 is the one game where the viewer (home, LSU) and the first rival (away, AUB) differ, so a rival's pick threaded into the own chip would turn this red (${mine.join(' | ')})`);
    assert(!/\b\d on [A-Z]{2,5}\b/.test(strip(c)), `4b-${name}: …and no per-side count anywhere (S2)`);
    assert(/Picks stay hidden until kickoff\./.test(strip(c)), `4c-${name}: …and it says why`);
  }
  for (const name of ['live3', 'quiet', 'allfinal', 'final']) {
    const { m } = mountS(name); m.open();
    const c = m.card();
    assert(count(c, /pg-cluster/g) >= rowsOf(c).length && !/pg-pp--blind/.test(c), `4d-${name}: a public week groups the picks (By team) on every row, no blind chip`);
  }
  // C2: CFB Live + NFL Locked in ONE card
  {
    const { m, s } = mountS('mixed'); m.open();
    const c = m.card();
    const rows = rowsOf(c);
    const cfb = rows.filter((id) => E.SLATE[id].sp === 'cfb'), nfl = rows.filter((id) => E.SLATE[id].sp === 'nfl');
    const rowHtml = (id) => (c.match(new RegExp(`<button type="button" class="gd-row"[^>]*data-game-id="${id}"[\\s\\S]*?</button>`)) || [''])[0];
    assert(cfb.length >= 1 && nfl.length >= 1 && cfb.every((id) => /pg-cluster/.test(rowHtml(id)) && !/pg-pp--blind/.test(rowHtml(id))), `4e: C2 — the CFB rows (Live) show clusters (${cfb.join(',')})`);
    assert(nfl.every((id) => !/pg-cluster/.test(rowHtml(id)) && count(rowHtml(id), /pg-pp--blind/g) === 5 && count(rowHtml(id), /pg-pp--me/g) === 1), `4f: C2 — the NFL rows (Locked) show ONLY the blind form for an entrant: the own pick and five "•••", no cluster (${nfl.join(',')})`);
    assert(!/Week 6/.test(strip((c.match(/<p class="gd-sub[^>]*>[\s\S]*?<\/p>/) || [''])[0])), '4g: C2 — the subtitle names no single week when the card spans two sports\' weeks');
    void s;
  }
  // C3: the model's JSON
  {
    const s = E.scenario('locked');
    const env = E.mount(MODS, doc, s).env;
    const snap = env.home.assembleSnapshot({ viewerId: 'p1', isCommissioner: false, now: s.now });
    const nm = home.nowCardModel(snap, { viewerId: 'p1', isCommissioner: false, now: s.now });
    const input = home.gameDayInputFor(snap, nm, { viewerId: 'p1', isCommissioner: false, now: s.now });
    const model = gd.gameDayModel(input);
    const json = JSON.stringify(model);
    const rivals = fx.PLAYERS.filter((p) => p.playerId !== 'p1');
    assert(json.length > 400 && !/"playerId"/.test(json) && rivals.every((p) => !json.includes(`"${p.playerId}"`) && !json.includes(p.displayName)), 'C3-a: the model\'s JSON for a LOCKED fixture holds no rival playerId and no rival name (it is serialised and scanned)');
    assert(!/"picks"|"clusters"|"submitted"|"others"|"members"/.test(json), 'C3-b: …and no field that could carry the league\'s picks (no picks, clusters, submitted or members key)');
    const onlyOwn = (function walk(v) { return v && typeof v === 'object' ? Object.entries(v).every(([k, x]) => (k !== 'ownTeam' || typeof x === 'string') && walk(x)) : true; })(model);
    assert(onlyOwn && model.rows.every((r) => !('pickersAway' in r) && !('pickersHome' in r)), 'C3-c: …the only pick the model carries is `ownTeam` (the viewer\'s own, a team name)');
    const mixed = E.scenario('mixed');
    const e2 = E.mount(MODS, doc, mixed).env;
    const sn2 = e2.home.assembleSnapshot({ viewerId: 'p1', isCommissioner: false, now: mixed.now });
    const m2 = JSON.stringify(gd.gameDayModel(home.gameDayInputFor(sn2, home.nowCardModel(sn2, { viewerId: 'p1', isCommissioner: false, now: mixed.now }), { viewerId: 'p1', isCommissioner: false, now: mixed.now })));
    assert(!/"playerId"/.test(m2) && fx.PLAYERS.filter((p) => p.playerId !== 'p1').every((p) => !m2.includes(p.displayName)), 'C3-d: …in the mixed Live + Locked fixture too');
  }
  // C4: a non-entrant and a late joiner change nothing
  {
    const stray = { pickId: 'pk_stray', weekId: 'w6', gameId: 'c1', playerId: 'pX', selectedTeam: 'Texas' };
    const roster = (s) => (week) => s.league.players.filter((p) => p.playerId !== 'p6').map((p) => ({ ...p }));
    const sA = E.scenario('live3', { extraPicks: [stray] });
    sA.deps.entrantsFor = roster(sA);
    const mA = E.mount(MODS, doc, sA); mA.open();
    const cA = mA.card();
    assert(!/Kihoon|KB\b/.test(cA) && !/pX/.test(cA), 'C4-a: a late joiner (p6, not on the week\'s roster) is in no cluster and no "No pick" group; a stray pick by a non-member appears nowhere');
    const sB = E.scenario('live3');
    const mB = E.mount(MODS, doc, sB); mB.open();
    const picksIn = (h) => [...h.matchAll(/aria-label="([A-Za-z ]+, (?:covering|trailing|on the number)[^"]*|[A-Za-z ]+: [^"]*)"/g)].length;
    assert(picksIn(cA) <= picksIn(mB.card()) && /Kihoon/.test(mB.card()), 'C4-b: …and the same week with the full roster does show him (the positive control)');
    const sC = E.scenario('live3', { extraPicks: [stray] }); sC.deps.entrantsFor = (w) => sC.league.players.map((p) => ({ ...p }));
    const mC = E.mount(MODS, doc, sC); mC.open();
    assert(mC.card() === mB.card(), 'C4-c: a pick by a non-entrant (it is in the picks table) leaves the open card BYTE-IDENTICAL to the card without it');
  }
  // C4 fail closed: Home invents no roster. With no entrantsFor injected nobody is an entrant, so the open card says nothing about picks (it never falls back to "every active player").
  {
    const sN = E.scenario('live3'); delete sN.deps.entrantsFor;
    const mN = E.mount(MODS, doc, sN); mN.open();
    assert(rowsOf(mN.card()).length >= 1 && !/pg-cluster|pg-pp|•••|pg-row/.test(mN.card()), 'C4-d: with NO roster injected the open card draws no pick line at all (fail closed — Home never builds a roster from the ACTIVE players)');
    const gvN = mN.home.resolveGameView('c1');
    assert(!!gvN && !/pg-cluster|pg-pp|•••/.test(gvN.html) && /not entered|loading|Submit/.test(strip(gvN.html)), 'C4-e: …nor does the Game view (its panel says why it has nothing to show)');
  }
  // C7: a sport the viewer has not joined
  {
    storage; // (the seam is seeded per mount)
    E.SCENARIOS.specLocked = { week: 'locked', live: [], up: ['c1', 'c2', 'n3'], fin: [], plays: ['cfb'], follows: ['nfl'] };
    E.SCENARIOS.specOpenLive = { week: 'live', live: ['c1', 'n1', 'n2'], up: ['n3'], fin: [], plays: ['cfb'], follows: ['nfl'] };
    for (const name of ['spectator', 'specLocked', 'specOpenLive']) {
      const { m } = mountS(name); m.open();
      const c = m.card();
      const nflRows = rowsOf(c).filter((id) => E.SLATE[id].sp === 'nfl');
      const rowHtml = (id) => (c.match(new RegExp(`<button type="button" class="gd-row"[^>]*data-game-id="${id}"[\\s\\S]*?</button>`)) || [''])[0];
      assert(nflRows.length >= 1 && nflRows.every((id) => !/pg-cluster|pg-pp|•••|gd-cov|You're/.test(rowHtml(id))), `C7-${name}: the NFL rows of a member who has not joined the NFL are plain score rows: no line, no cluster, no "•••", no coverage word (${nflRows.join(',')})`);
    }
    const { m: mp } = mountS('spectator');
    const pills = pillsOf(mp.card());
    const nflPill = (mp.card().match(/<button[^>]*data-game-id="n1"[\s\S]*?<\/button>/) || [''])[0];
    assert(pills.includes('n1') && !/gdp-cv--(covering|trailing)|Covering|Trailing/.test(nflPill), 'C7-pill: the followed sport\'s pill carries the score and no coverage word');
  }
}

// ═══ [5] Excluded weeks ════════════════════════════════════════════════════════════════════════
console.log('\n[5] Excluded weeks (UN-71)…');
if (want(5)) {
  const draftNfl = (s) => { s.league.weeks = s.league.weeks.map((w) => (w.sport === 'nfl' ? { ...w, status: 'draft' } : w)); };
  const { m } = mountS('both', {}, draftNfl);
  m.open();
  const c = m.card();
  assert(!pillsOf(c).some((id) => E.SLATE[id].sp === 'nfl') && !rowsOf(c).some((id) => E.SLATE[id].sp === 'nfl'), '5a: a DRAFT week (the NFL one) is absent for a member: no pill, no row');
  const demoNfl = (s) => { s.league.weeks = s.league.weeks.map((w) => (w.sport === 'nfl' ? { ...w, dataSourceMode: 'demo' } : w)); };
  const { m: md } = mountS('both', {}, demoNfl); md.open();
  assert(!pillsOf(md.card()).some((id) => E.SLATE[id].sp === 'nfl') && !rowsOf(md.card()).some((id) => E.SLATE[id].sp === 'nfl'), '5b: a DEMO week is absent for a member');
  const { m: ma } = mountS('both', { admin: true }, demoNfl); ma.open();
  assert(pillsOf(ma.card()).concat(rowsOf(ma.card())).some((id) => E.SLATE[id].sp === 'nfl'), '5c: …and present for the commissioner');
}

// ═══ [6] Entry points, forged ids, in-place open and close ═════════════════════════════════════
console.log('\n[6] Entry points and forged ids…');
if (want(6)) {
  const { m } = mountS('live3');
  const act = () => m.env.calls.actions;
  const pill = m.container.querySelectorAll('[data-home-action="gd-pill"]')[1];
  click(pill);
  assert(m.home.gameDayState().expanded === true && m.home.gameDayState().focusedGameId === 'c2', '6a: a pill opens the card IN PLACE with that game as its focus (no navigation)');
  assert(!act().some(([a]) => a === 'open-game'), '6b: …and does not leave the page');
  const row = m.container.querySelectorAll('[data-home-action="gd-row"]')[0];
  click(row);
  const og = act().filter(([a]) => a === 'open-game');
  assert(og.length === 1 && og[0][1].gameId === 'c1', `6c: a ROW opens the Game view (onAction open-game with ITS game id: ${JSON.stringify(og)})`);
  // forged row / pill ids
  const forged = m.container.querySelectorAll('[data-home-action="gd-row"]')[1];
  forged.setAttribute('data-game-id', 'zz_forged'); const before = act().length;
  click(forged);
  assert(act().length === before, '6d: a forged game id on a row (not one of the CURRENT paint\'s rows) dispatches nothing (Std-9)');
  m.close();
  const forgedPill = m.container.querySelectorAll('[data-home-action="gd-pill"]')[0];
  forgedPill.setAttribute('data-game-id', '__proto__'); click(forgedPill);
  assert(m.home.gameDayState().expanded === true && m.home.gameDayState().focusedGameId === null, '6e: a forged pill id opens the card but focuses nothing');
  assert(m.home.openGameDay({ gameId: 'nope' }) !== false && m.home.gameDayState().focusedGameId === null, '6f: openGameDay with an unknown id opens the card with no focus (never an error)');
  m.close();
  for (const bad of [undefined, null, 7, {}, [], '', { gameId: 7 }, { gameId: {} }]) { try { m.home.openGameDay(bad === undefined ? undefined : bad); } catch { assert(false, `6g: openGameDay(${JSON.stringify(bad)}) must not throw`); } }
  assert(true, '6g: openGameDay shrugs off undefined, null, numbers, objects and arrays');
  m.close();
  // in-place open / close, collapse button, repaint keeps it open, Game view keeps it open
  click(m.container.querySelector('[data-home-action="gd-toggle"]'));
  assert(m.home.gameDayState().expanded === true && /data-gd-expanded="true"/.test(m.card()), '6h: the header opens the card; the markup says so');
  m.home.renderHome();
  assert(m.home.gameDayState().expanded === true && /data-gd-expanded="true"/.test(m.card()), '6i: a Home repaint does NOT collapse an open card');
  const gv = m.home.resolveGameView('c1');
  assert(!!gv && m.home.gameDayState().expanded === true, '6j: opening a Game view leaves the card open underneath: Back lands with the card as it was');
  click(m.container.querySelector('[data-home-action="gd-collapse"]'));
  assert(m.home.gameDayState().expanded === false, '6k: Collapse closes it');
  m.open();
  const dash = m.container.querySelector('[data-home-action="gd-dashboard"]');
  const nb = act().length;
  click(dash);
  const od = act().slice(nb).filter(([a]) => a === 'open-dashboard');
  assert(od.length === 1, `6l: "Open Dashboard" hands the app ONE open-dashboard (${JSON.stringify(od)})`);
  assert(m.home.gameDayState().expandable === true, '6m: an expandable card says so');
  // a signed-out or withheld Home paints no Game Day
  const w = mountS('live3'); w.m.env.state.withheld = true;
  const writes0 = w.m.env.container.writes;
  assert(w.m.home.renderHome() === false && w.m.env.container.writes === writes0 && w.m.home.resolveGameView('c1') === null, '6n: a WITHHELD Home (a security hold) paints nothing, writes nothing and resolves no Game view (S-C7: the check is FIRST)');
  // the game view
  for (const asAdmin of [false, true]) {
    const gv2 = mountS('locked', { admin: asAdmin }).m.home.resolveGameView('c1');
    assert(!!gv2 && /data-picks-view="blind"/.test(gv2.html) && !/pg-cluster|pg-split/.test(gv2.html) && !/\b\d on [A-Z]{2,5}\b/.test(strip(gv2.html)) && !/Oklahoma|\bOU\b/.test((gv2.html.match(/class="gv-picks">[\s\S]*$/) || [''])[0]), `6o${asAdmin ? '-commissioner' : ''}: the Game view of a LOCKED game, as ${asAdmin ? 'the COMMISSIONER' : 'a player'}: the blind form only (no cluster, no split caption, no per-side count, and the side only rivals took (Oklahoma) is nowhere in the picks panel)`);
  }
  const gv3 = mountS('live3').m.home.resolveGameView('c1');
  assert(!!gv3 && /pg-cluster/.test(gv3.html) && /pg-split/.test(gv3.html) && /data-picks-view="team"/.test(gv3.html), '6p: …and of a LIVE game: By team with the split caption (the panel form)');
  assert(mountS('locked').m.home.resolveGameView('zz_nope') === null || /isn.t available/.test(mountS('locked').m.home.gameUnavailable()), '6q: a game that does not exist resolves to nothing; the calm unavailable state says "This game isn\'t available right now."');

  // A viewer who has NOT submitted (small fix, fix round 1): in an OPEN week they are asked to submit; in a LOCKED week — stored locked, or open but past its lock instant — they cannot, so the panel must not
  // tell them to ("Submit your picks to see who's in"), nor offer "Make your picks" (a button that leads to a locked form).
  {
    E.SCENARIOS.lockedNone = { week: 'locked', live: [], up: ['c1', 'c2', 'c3', 'c4', 'c5', 'c7'], fin: [], plays: ['cfb'], noPicks: true };
    const panel = (v) => strip(((v && v.html.match(/<article class="card gv-card gv-picks-card"[\s\S]*?<\/article>/)) || [''])[0]);
    const makeBtn = (v) => !!v && /data-gv-action="make-picks"/.test(v.html);
    const open = mountS('openDue').m.home.resolveGameView('c1');
    assert(!!open && /Submit your picks to see who's in\. Everyone's picks appear at kickoff\./.test(panel(open)) && makeBtn(open), `6r-0: (positive control) in an OPEN week a member who has not submitted is told to, and offered "Make your picks" (${panel(open)})`);
    const locked = mountS('lockedNone').m.home.resolveGameView('c1');
    assert(!!locked && !/Submit your picks to see who/.test(panel(locked)) && !makeBtn(locked) && /Picks are locked/.test(panel(locked)) && /Everyone's picks appear at kickoff/.test(panel(locked)), `6r: a LOCKED week: a member who has not submitted is not asked to submit and is offered no button; the panel says it is locked and when the picks appear ("${panel(locked)}")`);
    const derived = mountS('openDue', {}, (sc) => { sc.league.weeks = sc.league.weeks.map((w) => ({ ...w, picksLockAt: E.iso(E.NOW - E.HOUR) })); }).m.home.resolveGameView('c1');
    assert(!!derived && !/Submit your picks to see who/.test(panel(derived)) && !makeBtn(derived) && /Picks are locked/.test(panel(derived)), `6s: …and so for a week still STORED open whose lock instant has passed (the one week-lock state, the same answer the Picks tab gives) ("${panel(derived)}")`);
    for (const v of [locked, derived]) assert(!!v && !/pg-cluster|pg-pp|•••/.test(v.html.match(/class="gv-picks"[\s\S]*$/) ? v.html.match(/class="gv-picks"[\s\S]*$/)[0] : ''), '6t: …and no pick line is drawn for a member who has none to compare');
  }}

// ═══ [7] Names ═════════════════════════════════════════════════════════════════════════════════
console.log('\n[7] Names (DI-608): "Game Day" is the one name…');
if (want(7)) {
  assert(gd.GAME_DAY_NAME === 'Game Day', '7a: the card\'s name is the constant "Game Day" (two words, as written)');
  const walk = (dir, out = []) => { for (const f of readdirSync(dir)) { if (f.startsWith('.') || f === 'node_modules' || f === 'vendor') continue; const p = join(dir, f); const st = statSync(p); if (st.isDirectory()) walk(p, out); else out.push(p); } return out; };
  const files = [...walk(join(HERE, 'js')), join(HERE, 'css/styles.css'), join(HERE, 'index.html'), ...(statSync(join(HERE, 'supabase'), { throwIfNoEntry: false }) ? walk(join(HERE, 'supabase/functions')) : [])].filter((p) => /\.(js|css|html|ts|mjs)$/.test(p));
  const BAD = /Live Peek|(?<![A-Za-z])GameDay(?![A-Za-z])/;
  const hits = [];
  for (const f of files) {
    let src = readFileSync(f, 'utf8');
    src = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1').replace(/<!--[\s\S]*?-->/g, ' ');
    const lits = f.endsWith('.html') || f.endsWith('.css') ? [src] : [...src.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g)].map((m) => m[2]);
    for (const l of lits) if (BAD.test(l)) hits.push(`${f.replace(HERE, '')}: ${l.slice(0, 60)}`);
  }
  assert(files.length > 60 && hits.length === 0, `7b: no string literal in js/, css, index.html or the Edge Functions says "Live Peek" or "GameDay" (${files.length} files scanned)${hits.length ? ': ' + hits.slice(0, 3).join(' | ') : ''}`);
  assert(BAD.test('"Live Peek"') && BAD.test("'the GameDay list'") && !BAD.test("'openGameDay'") && !BAD.test("'picksViewGameDay'") && !BAD.test("'gameday'"), '7c: …and the scan catches the two retired names but not an identifier or a storage key that merely contains the letters');
  const m = mountS('live3').m; m.open();
  const all = m.html() + JSON.stringify(m.home.gameDayState());
  assert(!/Live Peek|GameDay/.test(all), '7d: the served Home markup never says either');
}

// ═══ [8] Escaping ══════════════════════════════════════════════════════════════════════════════
console.log('\n[8] Escaping (C5)…');
if (want(8)) {
  const HOST = '"><img src=x onerror=alert(1)>';
  const hostile = (s) => {
    s.league.games = s.league.games.map((g, i) => (i % 2 ? { ...g, homeTeam: `H${i}${HOST}`, awayTeam: `A${i}<b>x</b>` } : g));
    s.league.picks = s.league.picks.map((p) => { const g = s.league.games.find((x) => x.gameId === p.gameId); return g && /^H|^A/.test(g.homeTeam) ? { ...p, selectedTeam: g.homeTeam } : p; });
    s.league.weeks = s.league.weeks.map((w) => ({ ...w, sport: w.sport }));
    if (s.competitions) s.competitions = s.competitions.map((c) => ({ ...c, label: `CFB${HOST}` }));
  };
  const names = (h) => [...h.matchAll(/<[a-z][^>]*>/gi)].flatMap((mm) => [...mm[0].replace(/"[^"]*"/g, '""').matchAll(/\s([a-z-]+)(?==|\s|>|$)/gi)].map((a) => a[1].toLowerCase()));
  for (const name of ['both', 'live3', 'locked', 'mixed']) {
    let mm;
    const collapsed = served(() => { mm = mountS(name, { hostile: true }, hostile).m; });
    const open = served(() => { mm.open(); });
    for (const [what, h] of [['collapsed', collapsed], ['open', open]]) {
      assert(!/<img/i.test(h) && !/<b>x<\/b>/.test(h) && !names(h).some((n) => n.startsWith('on') || n === 'src'), `8-${name}-${what}: hostile team, display and sport names come out inert (no live element, no handler attribute) in text, aria-label and title`);
    }
    assert(/&lt;img/.test(collapsed + open) && /&lt;b&gt;/.test(collapsed + open), `8-${name}-visible: …and they are present as TEXT (escaped, not dropped)`);
  }
  const model = gd.gameDayModel({ state: 'live', entries: [], viewerId: 'p1' });
  const throws = (fn) => { try { fn(); return false; } catch (e) { return e instanceof TypeError; } };
  assert(throws(() => gd.gameDayCardHTML(model, {})) && throws(() => gd.gameDayCardHTML(model, { escHtml: (s) => s })) && throws(() => gd.gameDayCardHTML(model, { numHtml: (s) => s })) && throws(() => gds.gameDayBodyHTML(model, {})) && throws(() => gds.gameDayBodyHTML(model)) && throws(() => gd.gameDaySkeletonHTML({})),
    '8z: the card, its open body and its skeleton REFUSE to render without an escaper (and numHtml): a TypeError, never a fallback');
  const unq = ['live3', 'locked', 'mixed'].flatMap((n) => { let mm; const c1 = served(() => { mm = mountS(n, { hostile: true }, hostile).m; }); return [c1, served(() => { mm.open(); })]; }).flatMap((h) => [...h.matchAll(/<[a-z][^>]*>/gi)].map((mm) => mm[0]).filter((t) => /\s[a-z-]+=[^"'\s>]/i.test(t.replace(/"[^"]*"/g, '""'))));
  assert(unq.length === 0, '8y: every attribute is double-quoted');
}

// ═══ [9] Contrast ══════════════════════════════════════════════════════════════════════════════
console.log('\n[9] Contrast: the pills\' text on the card\'s gradient, every look, both sides…');
if (want(9)) {
  const R = await import('./themeresolve.mjs');
  const { ALL_THEME_KEYS } = await import('./themetables.mjs');
  const sheet = R.loadSheet(join(HERE, 'css/styles.css'));
  let checked = 0; const bad = [];
  for (const key of ALL_THEME_KEYS) for (const side of ['L', 'D']) {
    const r = R.resolveSide(sheet, key, side, 'system');
    const get = (n) => R.rgbOf(r.get(n));
    const ends = [get('--maroon'), get('--maroon-mid')];
    const veil = R.parseColor(r.get('--gameday-pill-bg'));
    const onAccent = get('--on-accent'), cover = get('--gameday-cover'), trail = get('--gameday-trail');
    if (!ends.every(Boolean) || !veil || !onAccent || !cover || !trail) { bad.push(`${key}/${side}: a token did not resolve`); continue; }
    for (const end of ends) {
      const surface = R.compositeOver(veil, end);
      for (const [nm, fg] of [['score', onAccent], ['covering', cover], ['trailing', trail]]) { checked++; const c = R.contrast(fg, surface); if (c < 4.5) bad.push(`${key}/${side}/${nm} ${c.toFixed(2)}:1`); }
      const cardC = R.contrast(onAccent, end); checked++; if (cardC < 4.5) bad.push(`${key}/${side}/card-text ${cardC.toFixed(2)}:1`);
    }
  }
  assert(checked >= 160 && bad.length === 0, `9a: the score text, the covering word and the trailing word on the pill veil, and the card's own text, meet 4.5:1 against BOTH ends of the gradient in all ${ALL_THEME_KEYS.length} looks x 2 sides (${checked} pairs)${bad.length ? ' — ' + bad.slice(0, 4).join(' | ') : ''}`);
}

// ═══ [10] Every button, tapped through the REAL dispatcher (reviewer B2, fix round 1) ═══════════════
console.log('\n[10] Every Game Day button is tapped through the real dispatcher, in every state it is drawn in…');
if (want(10)) {
  // B2: the Final card's "Results" button carried tab 'leaderboard', which the dispatcher's allow-list silently dropped — a dead button — and 3e only asserted that the label was PRESENT. A button a test
  // asserts is present must also be TAPPED, through home.js's own click handler (the delegated one the browser reaches), and something observable must happen. The table below is the expectation per
  // action; an action NOT in it fails the sweep, so a new button must say what it does here.
  const effect = {
    'go-tab': (b, before, m) => m.env.calls.actions.slice(before.n).some(([a, p]) => a === 'go-tab' && p && p.tab === b.tab),
    'gd-toggle': (b, before, m) => m.home.gameDayState().expanded !== before.expanded,
    'gd-pill': (b, before, m) => m.home.gameDayState().expanded === true && m.home.gameDayState().focusedGameId === b.gameId,
    'gd-more': (b, before, m) => m.home.gameDayState().expanded === true,
    'gd-row': (b, before, m) => m.env.calls.actions.slice(before.n).some(([a, p]) => a === 'open-game' && p && p.gameId === b.gameId),
    'gd-collapse': (b, before, m) => m.home.gameDayState().expanded === false,
    'gd-dashboard': (b, before, m) => m.env.calls.actions.slice(before.n).some(([a]) => a === 'open-dashboard'),
  };
  const attrs = (node) => ({ action: node.getAttribute('data-home-action'), tab: node.getAttribute('data-tab'), gameId: node.getAttribute('data-game-id') });
  const tapped = new Map();                       // action -> number of taps that produced their effect
  const dead = [], unknown = [];
  let taps = 0;
  const goTabs = new Set();
  for (const name of Object.keys(E.SCENARIOS)) {
    for (const opened of [false, true]) {
      const probe = mountS(name).m;
      if (opened) { if (!probe.home.gameDayState().expandable) continue; probe.open(); }
      const count = probe.container.querySelectorAll('#gd-card [data-home-action]').length;
      for (let i = 0; i < count; i++) {
        const { m } = mountS(name);
        if (opened) m.open();
        const node = m.container.querySelectorAll('#gd-card [data-home-action]')[i];
        const b = attrs(node);
        if (!effect[b.action]) { unknown.push(`${name}${opened ? '/open' : ''}: ${b.action}`); continue; }
        if (b.action === 'go-tab') goTabs.add(b.tab);
        const before = { n: m.env.calls.actions.length, ...m.home.gameDayState() };
        click(node);
        taps++;
        if (effect[b.action](b, before, m)) tapped.set(b.action, (tapped.get(b.action) || 0) + 1);
        else dead.push(`${name}${opened ? '/open' : ''}: ${b.action}${b.tab ? ' ' + b.tab : ''}${b.gameId ? ' ' + b.gameId : ''}`);
      }
    }
  }
  assert(taps >= 140 && unknown.length === 0, `10a: the sweep tapped ${taps} buttons across ${Object.keys(E.SCENARIOS).length} states, collapsed and open, and every action is one it has an expectation for${unknown.length ? ' (UNKNOWN: ' + unknown.slice(0, 4).join(' | ') + ')' : ''}`);
  assert(dead.length === 0, `10b: B2 — no Game Day button is a dead end: every tap did what its label says through the real dispatcher${dead.length ? ' (DEAD: ' + [...new Set(dead)].slice(0, 6).join(' | ') + ')' : ''}`);
  assert(['go-tab', 'gd-toggle', 'gd-pill', 'gd-more', 'gd-row', 'gd-collapse', 'gd-dashboard'].every((a) => (tapped.get(a) || 0) >= 1), `10c: …and every kind of Game Day button was reached at least once (${[...tapped].map(([a, n]) => `${a} x${n}`).join(', ')})`);
  assert(goTabs.has('leaderboard') && goTabs.has('picks'), `10d: …including "Results" (tab leaderboard) on a finalized week and "Make picks" / "Edit picks" (tab picks) on an Open one (${[...goTabs].join(', ')})`);
  // the named case, spelled out: Results on the Final card
  {
    const { m } = mountS('final');
    const results = [...m.container.querySelectorAll('#gd-card [data-home-action="go-tab"]')].find((n) => /Results/.test(strip(n.outerHTML)));
    const n0 = m.env.calls.actions.length;
    if (results) click(results);
    const got = m.env.calls.actions.slice(n0);
    assert(!!results && got.length === 1 && got[0][0] === 'go-tab' && got[0][1].tab === 'leaderboard', `10e: B2 — tapping "Results" on the Final card hands the app go-tab {tab: 'leaderboard'} (${JSON.stringify(got)})`);
    assert(m.env.calls.haptics.includes('medium'), '10f: …with its medium haptic (a primary action)');
  }
  // the allow-list still refuses a tab nobody offered
  {
    const { m } = mountS('final');
    const btn = m.container.querySelectorAll('#gd-card [data-home-action="go-tab"]')[0];
    const n0 = m.env.calls.actions.length;
    for (const bad of ['admin', '__proto__', 'chat', 'rules', '', 'leaderboard ', 'LEADERBOARD']) { btn.setAttribute('data-tab', bad); click(btn); }
    assert(m.env.calls.actions.length === n0, '10g: …and the allow-list still refuses a tab nobody offers (admin, __proto__, chat, rules, empty, a trailing space, upper case): a forged data-tab dispatches nothing');
  }
}

// ═══ [11] A change elsewhere in the feed never replaces the Game Day node (reviewer B3, fix round 1) ═══════════
console.log('\n[11] A feed change in the SAME paint never replaces the Game Day node: identity, focus, the rail\'s scroll, a held touch…');
if (want(11)) {
  // B3: Home patched Game Day in place only when it was the ONLY thing that changed. The moment another card changed in the same paint (a game goes final: its pill leaves AND its game.final card arrives) the
  // whole feed was rewritten with innerHTML, so the open card's nodes were thrown away (focus lost to <body>), the rail went back to scrollLeft 0 and a finger held on a pill lost its touch. The card's node is
  // now KEPT across every paint that still has a Game Day on both sides; the other items are written around it.
  const goFinal = (s, id, hs = 31, as = 20) => { const g = s.league.games.find((x) => x.gameId === id); Object.assign(g, { status: 'final', homeScore: hs, awayScore: as, lastUpdated: new Date(E.NOW - 60000).toISOString() }); };
  const cardKeys = (m) => keysOf(m.container);
  const feedItems = (m) => m.container.querySelectorAll('.home-feed > [data-card-key]');
  const itemMarkup = (m) => feedItems(m).map((n) => `${n.getAttribute('data-card-key')}|${n.innerHTML.replace(/ data-sig="[^"]*"/g, '')}`);   // (a keyed patch stamps its rows with a data-sig bookkeeping attribute; a fresh paint has none)

  // (a) the OPEN card: node identity and focus survive a game going final (its pill leaves, a game.final card arrives)
  {
    const { s, m } = mountS('live3');
    m.open();
    const gdx = m.container.querySelector('.gd-x'), head = m.container.querySelector('#gd-h'), gdCard = m.container.querySelector('#gd-card');
    head.focus();
    const writes0 = m.container.writes, keys0 = cardKeys(m);
    goFinal(s, 'c1');
    m.home.renderHome();
    const keys1 = cardKeys(m);
    assert(keys1.length === keys0.length + 1 && keys1.some((k) => /^game\.final:.*:c1$/.test(k)) && !keys0.some((k) => /^game\.final:.*:c1$/.test(k)), `11a-0: (fixture) in ONE paint a game goes final: the c1 Final card arrives in the feed (${keys0.length} -> ${keys1.length} cards) AND the open card changes`);
    assert(m.container.querySelector('#gd-card') === gdCard && m.container.querySelector('.gd-x') === gdx, '11a: B3 — the red card\'s node and its open body\'s node are the SAME nodes after that paint (nothing replaced them)');
    assert(m.container.querySelector('#gd-h') === head && head.isConnected && doc.activeElement === head, '11b: …so focus inside the open card is still on its heading, which is still attached (a detached node would drop focus to <body> in a browser)');
    assert(m.container.writes === writes0, `11c: …and the feed was not rewritten wholesale (top-level innerHTML writes: ${writes0} -> ${m.container.writes})`);
    const sub = strip((m.container.querySelector('.gd-sub') || { outerHTML: '' }).outerHTML);
    assert(/2 live · 3 upcoming · 2 final/.test(sub) && m.home.gameDayState().expanded === true, `11d: …and the card itself did update in place: its count line now reads "${sub}" (c1 moved from live to final), and the card is still open`);
    assert(JSON.stringify(cardKeys(m)) === JSON.stringify(keysOf(mountS('live3', {}, (s2) => goFinal(s2, 'c1')).m.container)) , '11e: the feed after the incremental write has the same cards in the same order as a feed drawn fresh from the same data');
  }

  // (b) the COLLAPSED card: the rail node and its scrollLeft survive another card's text changing
  {
    const { s, m } = mountS('live3');
    const rail = m.container.querySelector('.gd-rail'), pill1 = m.container.querySelector('.gdp');
    rail.scrollLeft = 160;
    const before = itemMarkup(m);
    const writes0 = m.container.writes;
    s.league.games = [...s.league.games, { ...s.league.games.find((g) => g.gameId === 'c7'), gameId: 'c99', homeTeam: 'Rice', awayTeam: 'Tulane' }];
    m.home.renderHome();
    const after = itemMarkup(m);
    const nowOf = (a) => a.find((x) => x.startsWith('now|'));
    const changedOthers = after.filter((x) => !x.startsWith('now|') && !before.includes(x));
    assert(nowOf(after) === nowOf(before) && changedOthers.length >= 1, `11f: (fixture) a game is added to the slate: ${changedOthers.length} OTHER card(s) change text (${changedOthers.map((x) => x.split('|')[0]).join(', ')}) while the Game Day card's own markup does not`);
    assert(m.container.querySelector('.gd-rail') === rail && m.container.querySelector('.gdp') === pill1 && rail.scrollLeft === 160, `11g: B3 — the rail node, its first pill and its scrollLeft (160) are untouched by another card's change`);
    assert(m.container.writes === writes0, '11h: …without a wholesale feed write');
  }
  // (b2) the same, with the Now card ALSO changing in that paint (a score tick) — the pills patch by key, the rail node stays
  {
    const { s, m } = mountS('live3');
    const rail = m.container.querySelector('.gd-rail');
    rail.scrollLeft = 96;
    const g = s.league.games.find((x) => x.gameId === 'c1'); g.homeScore = 20;
    s.league.games = [...s.league.games, { ...s.league.games.find((x) => x.gameId === 'c7'), gameId: 'c98', homeTeam: 'Rice', awayTeam: 'Tulane' }];
    m.home.renderHome();
    assert(m.container.querySelector('.gd-rail') === rail && rail.scrollLeft === 96 && /20/.test(strip(m.container.querySelector('.gdp').outerHTML)), '11i: a score tick AND another card changing in one paint: the rail node and its scrollLeft stay, and the pill\'s score updated in place');
  }

  // (c) a touch held on the rail during a paint that needs more than the card: nothing under the finger is replaced; it lands at release
  {
    const { s, m } = mountS('live3');
    const rail = m.container.querySelector('.gd-rail');
    const pillC1 = [...m.container.querySelectorAll('.gdp')].find((n) => n.getAttribute('data-game-id') === 'c1');
    pillC1.dispatchEvent({ type: 'touchstart' });
    goFinal(s, 'c1');
    m.home.renderHome();
    assert(m.container.querySelector('.gd-rail') === rail && [...m.container.querySelectorAll('.gdp')].find((n) => n.getAttribute('data-game-id') === 'c1') === pillC1 && pillC1.isConnected, '11j: B3 — with a finger on a pill, the paint that retires that game leaves the rail and the pill under the finger exactly as they were');
    assert(cardKeys(m).some((k) => /^game\.final:.*:c1$/.test(k)), '11k: …while the rest of the feed still moves on (the c1 Final card arrived)');
    pillC1.dispatchEvent({ type: 'touchend' });
    m.env.state.now += 400; m.env.advance(400);
    const leavingAt = (pillC1.isConnected && pillC1.getAttribute('data-leaving')) || 'gone';
    m.env.state.now += 400; m.env.advance(400);                     // (DI-604: the leaving pill's 150 ms fade is its own timer)
    const pillsAfter = [...m.container.querySelectorAll('.gdp')].map((n) => n.getAttribute('data-game-id'));
    assert(m.container.querySelector('.gd-rail') === rail && leavingAt === 'true' && !pillsAfter.includes('c1') && pillsAfter.length === 2, `11l: …and at release the parked change lands in place (c1's pill fades out — data-leaving: ${leavingAt} — then leaves; the rail node is still the same: ${pillsAfter.join(',')})`);
  }
  // (c2) a finger that never lifts (a lost touchend) does not freeze Home forever
  {
    const { s, m } = mountS('live3');
    const pill = m.container.querySelector('.gdp');
    pill.dispatchEvent({ type: 'touchstart' });
    goFinal(s, 'c1');
    m.home.renderHome();
    assert([...m.container.querySelectorAll('.gdp')].some((n) => n.getAttribute('data-game-id') === 'c1'), '11m: (fixture) a held finger parks the change');
    m.env.state.now += home.RAIL_DOWN_MAX_MS + 1000;
    m.home.renderHome();
    m.env.advance(400);                                              // (the leaving pill's fade)
    assert(![...m.container.querySelectorAll('.gdp')].some((n) => n.getAttribute('data-game-id') === 'c1'), `11n: …but a touch that has not ended after ${home.RAIL_DOWN_MAX_MS / 1000} s is treated as lost (a touchend that never arrives must not freeze the card or the feed)`);
  }
  // (c3) a paint that is NOT about GameDay at all (Game Day gone on one side) is still parked while a finger is on the rail, never a full write under it
  {
    const { s, m } = mountS('live3');
    const rail = m.container.querySelector('.gd-rail');
    rail.querySelector('.gdp').dispatchEvent({ type: 'touchstart' });
    const writes0 = m.container.writes;
    s.league.weeks = s.league.weeks.map((w) => ({ ...w, status: 'draft' }));
    m.home.renderHome();
    assert(m.container.writes === writes0 && m.container.querySelector('.gd-rail') === rail, '11o: B3 — a paint that cannot be done in place (the week went to draft: the card is replaced) is PARKED while a finger is on the rail: no full write under the touch');
    rail.querySelector('.gdp').dispatchEvent({ type: 'touchend' });
    m.env.state.now += 400; m.env.advance(400);
    assert(m.container.writes > writes0 && !m.container.querySelector('.gd-rail'), '11p: …and it is written at release');
  }
  // (c4) P-3 / TP 228 (reviewer round 2, probe (i)): a NEW touch arriving DURING the hold. Finger A lifts, and before the parked change is flushed finger B lands on the rail. Nothing may be written under B,
  // the pill under B stays attached, and the change lands when B lifts — not at A's release, and not never.
  {
    const { s, m } = mountS('live3');
    const rail = m.container.querySelector('.gd-rail');
    const pillOf = (id) => [...m.container.querySelectorAll('.gdp')].find((n) => n.getAttribute('data-game-id') === id) || null;
    const ids = () => [...m.container.querySelectorAll('.gdp')].filter((n) => !n.hasAttribute('data-leaving')).map((n) => n.getAttribute('data-game-id'));
    pillOf('c1').dispatchEvent({ type: 'touchstart' });                                  // finger A on the rail
    goFinal(s, 'c1');
    m.home.renderHome();                                                                // the change is parked under A
    const cardParked = m.card(), writes0 = m.container.writes;
    pillOf('c1').dispatchEvent({ type: 'touchend' });                                   // A lifts: the flush is armed (it waits for the rail to come to rest)
    m.env.state.now += 50; m.env.advance(50);                                           // …and before it fires
    const pB = pillOf('c2');
    pB.dispatchEvent({ type: 'touchstart' });                                           // finger B lands on the rail
    m.env.state.now += 400; m.env.advance(400);                                         // well past the flush's quiet window, B still down
    m.home.renderHome();                                                                // and another data paint arrives while B is down
    assert(ids().includes('c1') && m.card() === cardParked && m.container.writes === writes0, `11v: P-3 (i) — finger A lifts and finger B lands on the rail before the flush: NOTHING is written under B (the card's markup is the parked one, c1's pill is still there: ${ids().join(',')}; feed writes ${writes0} -> ${m.container.writes})`);
    assert(pB.isConnected && pillOf('c2') === pB && m.container.querySelector('.gd-rail') === rail, '11w: …the pill under finger B is the same node, still attached, in the same rail (its touch is not cancelled)');
    pB.dispatchEvent({ type: 'touchend' });                                             // B lifts
    m.env.state.now += 400; m.env.advance(400);
    m.env.state.now += 400; m.env.advance(400);                                         // (a leaving pill's fade is a timer of its own)
    assert(!ids().includes('c1') && ids().length === 2 && m.container.querySelector('.gd-rail') === rail, `11x: …and the change lands when B lifts (c1's pill has left; the rail is the same node: ${ids().join(',')})`);
  }
  // (c5) P-3 / TP 228 (reviewer round 2, probe (ii)): finger A's touch is LOST (no touchend ever comes), then a touch B somewhere else on Home ends. B's end is proof that no finger is on the rail any more:
  // the hold is released at B's end (after the rail's short quiet window), not 30 s later.
  {
    const { s, m } = mountS('live3');
    const ids = () => [...m.container.querySelectorAll('.gdp')].filter((n) => !n.hasAttribute('data-leaving')).map((n) => n.getAttribute('data-game-id'));
    m.container.querySelector('.gdp').dispatchEvent({ type: 'touchstart' });           // A, never ended
    goFinal(s, 'c1');
    m.home.renderHome();
    assert(ids().includes('c1'), '11y: (fixture) the change is parked under the lost touch A');
    const other = m.container.querySelector('.home-feed > [data-card-key]:last-child');
    assert(!!other && !other.closest('[data-gd-rail]'), '11y-2: (fixture) touch B lands on a feed card, not on the rail');
    other.dispatchEvent({ type: 'touchstart' });
    m.env.state.now += 200; other.dispatchEvent({ type: 'touchend' });
    m.env.state.now += 400; m.env.advance(400);
    m.env.state.now += 400; m.env.advance(400);
    assert(!ids().includes('c1') && m.env.state.now - E.NOW < 2000, `11z: P-3 (ii) — the lost touch A, then a touch B elsewhere on Home ends: the hold releases at B's end (${m.env.state.now - E.NOW} ms after the paint), not after ${home.RAIL_DOWN_MAX_MS / 1000} s (pills now: ${ids().join(',')})`);
  }
  // (c6) a lost touch also ends when the app comes back to the foreground (iOS cancels every touch when the app is backgrounded; a touchcancel that never reached us must not hold the card for 30 s)
  {
    const { s, m } = mountS('live3');
    const ids = () => [...m.container.querySelectorAll('.gdp')].filter((n) => !n.hasAttribute('data-leaving')).map((n) => n.getAttribute('data-game-id'));
    m.container.querySelector('.gdp').dispatchEvent({ type: 'touchstart' });
    goFinal(s, 'c1');
    m.home.renderHome();
    doc.hidden = true; doc.dispatchEvent({ type: 'visibilitychange' });
    m.env.state.now += 5000; m.env.advance(5000);
    const stillHeld = ids().includes('c1');
    doc.hidden = false; doc.dispatchEvent({ type: 'visibilitychange' });
    m.env.state.now += 400; m.env.advance(400);
    m.env.state.now += 400; m.env.advance(400);
    assert(stillHeld && !ids().includes('c1'), `11z-2: a lost touch is cleared when the app becomes VISIBLE again: the parked change lands then (held while hidden: ${stillHeld}; pills now: ${ids().join(',')})`);
  }
  // (d) invariants of the incremental write: order, removal, insertion above, and the same markup as a fresh paint
  {
    const { s, m } = mountS('live3');
    const gdCard = m.container.querySelector('#gd-card');
    goFinal(s, 'c2', 14, 30);
    goFinal(s, 'c3', 20, 3);
    m.home.renderHome();
    m.env.state.now += 400; m.env.advance(400);                     // (DI-604: c2's and c3's pills fade out before they leave — compare once they have)
    const fresh = mountS('live3', {}, (s2) => { goFinal(s2, 'c2', 14, 30); goFinal(s2, 'c3', 20, 3); }).m;
    const a = itemMarkup(m), b = itemMarkup(fresh);
    assert(a.length === b.length && a.every((x, i) => x === b[i]), `11q: after an incremental write every feed item (key AND markup, in order) equals the same data drawn fresh${a.length === b.length ? '' : ` (${a.length} vs ${b.length} items)`}`, a.filter((x, i) => x !== b[i]).slice(0, 1).map((x) => x.slice(0, 200)).join());
    assert(m.container.querySelector('#gd-card') === gdCard, '11r: …and the card is the same node');
  }
  // (e) the fade is for the OPEN / CLOSE move only: CSS gates the open body's fade on [data-gd-moving]
  {
    const css = read('css/styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = (sel) => { const m = css.match(new RegExp(`(?:^|\\})\\s*${sel.replace(/[.[\]"=]/g, '\\$&')}\\s*\\{([^}]*)\\}`)); return m ? m[1] : null; };
    const gdx = rule('.gd-x');
    assert(gdx !== null && !/animation/.test(gdx), '11s: B3 — `.gd-x` itself carries NO animation (a fade on the node would replay whenever the node is created)');
    const moving = css.match(/[^{}]*\.gd\[data-gd-moving="true"\]\s+\.gd-x[^{}]*\{[^}]*animation\s*:\s*gd-fade-in[^}]*\}/);
    assert(!!moving, '11t: …the fade belongs to `.gd[data-gd-moving="true"] .gd-x` (it runs only while the card is opening or closing)');
    const reduce = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.gd\[data-gd-moving="true"\]\s+\.gd-x[\s\S]*?animation\s*:\s*none/);
    assert(!!reduce, '11u: …and Reduce Motion turns it off');
  }
}

// ═══ [13] Live announcements and the leaving pill (DI-604 / DI-591 / DI-593; Std-7) ══════════════════════════════════════════════════
console.log('\n[13] Live announcements (polite, only with focus in the card, only a cover flip or a game ending, debounced 1 s, throttled 5 s, queued while parked) and the leaving pill…');
if (want(13)) {
  const goFinal = (s, id, hs = 31, as = 20) => { const g = s.league.games.find((x) => x.gameId === id); Object.assign(g, { status: 'final', homeScore: hs, awayScore: as, lastUpdated: new Date(E.NOW - 60000).toISOString() }); };
  const setScore = (s, id, as, hs) => { const g = s.league.games.find((x) => x.gameId === id); Object.assign(g, { awayScore: as, homeScore: hs }); };
  const pillOf = (m, id) => [...m.container.querySelectorAll('.gdp')].find((n) => n.getAttribute('data-game-id') === id) || null;
  const liveText = (m) => { const n = m.container.querySelector('[data-gd-live]'); return n ? n.textContent : null; };
  const tick = (m, ms) => { m.env.state.now += ms; m.env.advance(ms); };
  // (a) the region exists from the first paint (a live region must be in the page BEFORE it speaks), polite, empty
  {
    const { m } = mountS('live3');
    const r = m.container.querySelector('#gd-card [data-gd-live]');
    assert(!!r && r.getAttribute('role') === 'status' && r.getAttribute('aria-live') === 'polite' && r.textContent === '' && /\bsr-only\b/.test(r.getAttribute('class') || ''), '13a: the card carries ONE polite live region (role=status, aria-live=polite, visually hidden), empty, from the first paint');
  }
  // (b) a cover flip with focus inside the card: one polite sentence, 1 s after the change (not before)
  {
    const { s, m } = mountS('live3');
    pillOf(m, 'c2').focus();
    setScore(s, 'c1', 21, 28);                                        // Texas +3.5 was covering (21-17); now 24.5 vs 28: trailing by 3.5
    m.home.renderHome();
    tick(m, 999);
    const early = liveText(m);
    tick(m, 1);
    assert(early === '' && /^Texas 21, Oklahoma 28\. You're trailing by 3\.5\.$/.test(liveText(m)), `13b: a cover FLIP with focus inside the card is announced once, politely, 1 s after the change (at 999 ms: "${early}"; at 1 s: "${liveText(m)}")`);
  }
  // (c) a game ending: "Final: …" with the viewer's settled result
  {
    const { s, m } = mountS('live3');
    m.open(); m.container.querySelector('#gd-h').focus();
    goFinal(s, 'c1');
    m.home.renderHome();
    tick(m, 1000);
    assert(/^Final: Texas 20, Oklahoma 31\. You missed by 7\.5\.$/.test(liveText(m)), `13c: a game ENDING is announced with the viewer's settled result ("${liveText(m)}")`);
  }
  // (d) focus NOT in the card: nothing is ever said
  {
    const { s, m } = mountS('live3');
    doc.body.focus();
    setScore(s, 'c1', 21, 28); goFinal(s, 'c2');
    m.home.renderHome();
    tick(m, 6000);
    assert(liveText(m) === '', '13d: with focus outside the card a flip and an ending are NOT announced (only while focus is inside the card)');
  }
  // (e) a score tick that flips nothing is not announced; nor is a game that starts
  {
    const { s, m } = mountS('live3');
    pillOf(m, 'c2').focus();
    setScore(s, 'c1', 24, 17);                                        // still covering
    const g7 = s.league.games.find((x) => x.gameId === 'c7'); Object.assign(g7, { status: 'live', homeScore: 0, awayScore: 0, kickoff: new Date(E.NOW - 60000).toISOString() });
    m.home.renderHome();
    tick(m, 2000);
    assert(liveText(m) === '', `13e: a plain score tick and a kickoff are passive: nothing is announced ("${liveText(m)}")`);
  }
  // (f) debounce: a burst folds into ONE announcement, 1 s after the LAST change
  {
    const { s, m } = mountS('live3');
    pillOf(m, 'c2').focus();
    setScore(s, 'c1', 21, 28); m.home.renderHome();
    tick(m, 600);
    goFinal(s, 'c3', 20, 10); m.home.renderHome();
    tick(m, 900);
    const mid = liveText(m);
    tick(m, 100);
    const t = liveText(m);
    assert(mid === '' && /You're trailing by 3\.5\./.test(t) && /Final: Michigan 10, Ohio State 20\./.test(t), `13f: two changes 600 ms apart fold into ONE announcement 1 s after the last (at 1.5 s: "${mid}"; at 1.6 s: "${t}")`);
  }
  // (g) throttle: never two announcements within 5 s
  {
    const { s, m } = mountS('live3');
    pillOf(m, 'c2').focus();
    setScore(s, 'c1', 21, 28); m.home.renderHome();
    tick(m, 1000);
    const first = liveText(m);
    setScore(s, 'c1', 30, 28); m.home.renderHome();                  // flips back to covering, at the moment of the first announcement
    tick(m, 4900);
    const held = liveText(m);
    tick(m, 100);
    assert(/trailing/.test(first) && held === first && /^Texas 30, Oklahoma 28\. You're covering by 5\.5\.$/.test(liveText(m)), `13g: a second flip right after the first announcement is held to the 5 s throttle (4.9 s after it, still "${held}"; 5 s after it, "${liveText(m)}")`);
  }
  // (h) queued while parked: a finger on the rail holds the change AND its announcement; both land after release
  {
    const { s, m } = mountS('live3');
    const pc2 = pillOf(m, 'c2'); pc2.focus();
    pc2.dispatchEvent({ type: 'touchstart' });
    goFinal(s, 'c1'); m.home.renderHome();
    tick(m, 2500);
    const whileHeld = liveText(m);
    pc2.dispatchEvent({ type: 'touchend' });
    tick(m, 400); tick(m, 1000); tick(m, 1000);
    assert(whileHeld === '' && /^Final: Texas 20, Oklahoma 31\./.test(liveText(m)), `13h: while the change is parked under a finger its announcement waits ("${whileHeld}"), and it is spoken once the change has landed ("${liveText(m)}")`);
  }
  // (i) a sport the viewer has not joined: the ending is announced with the score only (C7: no coverage word, nothing implying a pick)
  {
    const { s, m } = mountS('spectator');
    pillOf(m, 'n1').focus();
    goFinal(s, 'n1'); m.home.renderHome();
    tick(m, 1000);
    assert(/^Final: Chiefs 20, Bills 31\.$/.test(liveText(m)), `13i: C7 — a followed sport's game ending is announced as a score only ("${liveText(m)}")`);
  }
  // (j) an identity change drops whatever was queued
  {
    const { s, m } = mountS('live3');
    pillOf(m, 'c2').focus();
    setScore(s, 'c1', 21, 28); m.home.renderHome();
    tick(m, 500);
    m.env.state.identity = 'acct|L1|p9'; m.home.renderHome();
    tick(m, 3000);
    assert(liveText(m) === '' || liveText(m) === null, '13j: an identity change cancels a queued announcement (the next reader never hears the last one\'s game)');
  }
  // (k) the LEAVING pill: a game that ends leaves the rail with a 150 ms fade — marked at once, removed after; the other pills are untouched
  {
    const { s, m } = mountS('live3');
    const rail = m.container.querySelector('.gd-rail');
    const p1 = pillOf(m, 'c1'), p2 = pillOf(m, 'c2'), p3 = pillOf(m, 'c3');
    goFinal(s, 'c1'); m.home.renderHome();
    assert(p1.isConnected && p1.getAttribute('data-leaving') === 'true' && p1.getAttribute('aria-hidden') === 'true' && p1.getAttribute('tabindex') === '-1' && pillOf(m, 'c2') === p2 && pillOf(m, 'c3') === p3 && m.container.querySelector('.gd-rail') === rail, '13k: a game that ends: its pill is marked data-leaving (and hidden from VoiceOver, out of the tab order) for its fade; the other pills and the rail are the same nodes');
    tick(m, 200);
    assert(!p1.isConnected && !pillOf(m, 'c1') && pillOf(m, 'c2') === p2, '13l: …and after the 150 ms fade the pill is removed');
  }
  // (l) a focused pill that leaves hands focus to its neighbour (focus never falls to <body> from under a VoiceOver user)
  {
    const { s, m } = mountS('live3');
    const p1 = pillOf(m, 'c1'); p1.focus();
    goFinal(s, 'c1'); m.home.renderHome();
    assert(doc.activeElement === pillOf(m, 'c2'), `13m: the focused pill that leaves passes focus to the next pill (focus on ${doc.activeElement && doc.activeElement.getAttribute && doc.activeElement.getAttribute('data-game-id')})`);
    tick(m, 1000);
    assert(/^Final: Texas 20, Oklahoma 31\./.test(liveText(m)), '13n: …so the ending is still announced (focus stayed inside the card)');
  }
  // (l2) P-3 for the leaving fade (itself a deferral): a NEW finger landing on the rail during the 150 ms fade — the faded pill is not removed under it (the pills would shift under the finger);
  // it goes once the rail is at rest again
  {
    const { s, m } = mountS('live3');
    const rail = m.container.querySelector('.gd-rail');
    const p1 = pillOf(m, 'c1'), p2 = pillOf(m, 'c2');
    goFinal(s, 'c1'); m.home.renderHome();
    p2.dispatchEvent({ type: 'touchstart' });                         // a new touch, during the fade
    tick(m, 200); tick(m, 400);
    const kept = p1.isConnected && p1.getAttribute('data-leaving') === 'true' && pillOf(m, 'c2') === p2 && p2.isConnected && m.container.querySelector('.gd-rail') === rail;
    p2.dispatchEvent({ type: 'touchend' });
    tick(m, 400); tick(m, 400);
    assert(kept && !p1.isConnected && pillOf(m, 'c2') === p2, `13u: P-3 — a finger that lands on the rail during a pill's 150 ms fade: the faded pill is NOT removed under it (the other pills do not shift beneath the finger); it goes once the rail is at rest (held: ${kept}; gone after: ${!p1.isConnected})`);
  }
  // (m) Reduce Motion: no fade; the pill is removed at once
  {
    const real = globalThis.matchMedia;
    globalThis.matchMedia = (q) => ({ matches: /prefers-reduced-motion:\s*reduce/.test(q) });
    try {
      const { s, m } = mountS('live3');
      const p1 = pillOf(m, 'c1');
      goFinal(s, 'c1'); m.home.renderHome();
      assert(!p1.isConnected && !m.container.querySelector('[data-leaving]'), '13o: under Reduce Motion a leaving pill is removed at once (no fade)');
    } finally { globalThis.matchMedia = real; }
  }
  // (o) DI-572(a): a score tick never REPLACES a pill or a row — the changed one is patched in place, an unchanged one is not touched at all (found in fix round 2: every tick replaced every pill)
  {
    const { s, m } = mountS('live3');
    const p1 = pillOf(m, 'c1'), p2 = pillOf(m, 'c2');
    const l2 = p1.querySelector('[data-bind="l2"]');
    p1.focus();
    setScore(s, 'c1', 24, 17); m.home.renderHome();
    assert(pillOf(m, 'c1') === p1 && pillOf(m, 'c2') === p2 && p1.querySelector('[data-bind="l2"]') === l2 && /24/.test(p1.querySelector('[data-bind="score"]').textContent) && doc.activeElement === p1, `13r: DI-572(a) — a score tick patches the changed pill IN PLACE (same node, its score now ${p1.querySelector('[data-bind="score"]').textContent}, focus still on it) and leaves the unchanged pill alone`);
    setScore(s, 'c1', 24, 18); m.home.renderHome();
    assert(pillOf(m, 'c1') === p1, '13s: …tick after tick (the second tick finds the same node too)');
    m.open();
    const row = m.container.querySelectorAll('.gd-row').find((r) => r.getAttribute('data-game-id') === 'c1');
    const row2 = m.container.querySelectorAll('.gd-row').find((r) => r.getAttribute('data-game-id') === 'c2');
    row.focus();
    setScore(s, 'c1', 27, 18); m.home.renderHome();
    goFinal(s, 'c3', 20, 10); m.home.renderHome();
    const rowNow = m.container.querySelectorAll('.gd-row').find((r) => r.getAttribute('data-game-id') === 'c1');
    assert(rowNow === row && /27/.test(row.textContent) && m.container.querySelectorAll('.gd-row').find((r) => r.getAttribute('data-game-id') === 'c2') === row2 && doc.activeElement === row, `13t: DI-572(a) — in the OPEN card a score tick and another game ending patch the rows in place: the focused row is the same <button> (now "${(row.querySelector('[data-bind="score"]') || row).textContent.trim()}"), the untouched row is the same node`);
  }
  // (n) the CSS: the fade is the leaving pill's opacity over --motion-fast, nothing else, and none under Reduce Motion
  {
    const css = read('css/styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const leave = css.match(/\.gdp\[data-leaving="true"\]\s*\{([^}]*)\}/);
    const gdp = css.match(/(?:^|\})\s*\.gdp\s*\{([^}]*)\}/);
    assert(!!leave && /opacity\s*:\s*0/.test(leave[1]) && /pointer-events\s*:\s*none/.test(leave[1]) && !!gdp && /transition\s*:[^;]*opacity\s+var\(--motion-fast\)/.test(gdp[1]), '13p: CSS — `.gdp[data-leaving="true"]` fades to opacity 0 (untappable) over --motion-fast');
    const reduce = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.gdp[^{]*\{[^}]*transition\s*:\s*none/);
    assert(!!reduce, '13q: …and Reduce Motion has no transition on a pill');
  }
}

// ═══ [14] Team logos in the open card's rows (DI-572 (b)/(c), DI-605 line 1, PF-446) ══════════════════════════════════════════
console.log('\n[14] Team logos in Game Day\'s rows: the shared lockup, only with Team logos on, never recreated by a tick…');
if (want(14)) {
  const setScore = (s, id, as, hs) => { const g = s.league.games.find((x) => x.gameId === id); Object.assign(g, { awayScore: as, homeScore: hs }); };
  const rowOf = (m, id) => m.container.querySelectorAll('.gd-row').find((r) => r.getAttribute('data-game-id') === id) || null;
  {
    const { m } = mountS('live3', { logos: true });
    m.open();
    const row = rowOf(m, 'c1');
    const tls = row ? row.querySelectorAll('.tl') : [];
    const imgs = row ? row.querySelectorAll('.tl img') : [];
    assert(tls.length === 2 && tls.every((t) => t.classList.contains('tl--sm') && t.getAttribute('aria-hidden') === 'true') && imgs.length === 2 && imgs[0].getAttribute('src').endsWith('c1-away.png') && imgs[1].getAttribute('src').endsWith('c1-home.png') && imgs.every((i) => i.getAttribute('alt') === '' && i.getAttribute('referrerpolicy') === 'no-referrer'), `14a: with Team logos on, each open-card row draws the SHARED lockup (small) for both teams — away before the matchup, home after it — decorative to VoiceOver (alt="", aria-hidden): ${tls.length} lockups`);
    assert(tls.length === 2 && tls.every((t) => !!t.querySelector('.tl-abbr') && t.querySelector('.tl-abbr').textContent.length > 0), '14b: …and the abbreviation is always inside the lockup (it shows while the logo loads, or if it fails)');
    assert(/Texas 21 – 17 Oklahoma/.test(row.querySelector('[data-bind="score"]').textContent), '14c: …the matchup and score stay words beside them (the row still reads "Texas 21 – 17 Oklahoma")');
  }
  {
    const { m } = mountS('live3');
    m.open();
    assert(m.container.querySelectorAll('.gd-row .tl').length === 0, '14d: with Team logos OFF (the shipped default) the rows draw no lockup at all (text only, as before)');
  }
  {
    const { s, m } = mountS('live3', { logos: true });
    m.open();
    const imgs = rowOf(m, 'c1').querySelectorAll('img');
    setScore(s, 'c1', 24, 17); m.home.renderHome();
    setScore(s, 'c1', 24, 20); m.home.renderHome();
    const imgs2 = rowOf(m, 'c1').querySelectorAll('img');
    assert(imgs2.length === 2 && imgs2[0] === imgs[0] && imgs2[1] === imgs[1] && /24 – 20/.test(rowOf(m, 'c1').textContent), '14e: DI-572 — score ticks never recreate a row\'s logo <img> (the same nodes after two ticks; the score text moved on)');
  }
  {
    const { m } = mountS('live3', { logos: true });
    const card = m.card();
    assert(!/<img/.test(card), '14f: the COLLAPSED card stays text: pills never draw logos (DI-604: "team abbreviations, never logos"), so the size budget is untouched');
  }
}

// ═══ [15] What's next (DI-599), the finish in place (DI-593) and the locked copy (coordinator decision, fix round 2) ════════════════════════════
console.log('\n[15] What\'s next on the Final card and the Game view, the finish in place, the locked copy for a partial slate…');
if (want(15)) {
  const goFinal = (s, id, hs = 31, as = 20) => { const g = s.league.games.find((x) => x.gameId === id); Object.assign(g, { status: 'final', homeScore: hs, awayScore: as, lastUpdated: new Date(E.NOW - 60000).toISOString() }); };
  const nextOf = (v) => ((v && v.html.match(/<article class="card gv-card gv-next"[\s\S]*?<\/article>/)) || [''])[0];
  const msgLine = (card) => strip((card.match(/<div class="gd-tx">[\s\S]*?<\/div>/) || [''])[0]);
  // (a) Game Day's Final card: "You went 7–3 · Next: …" (DI-603 / DI-599)
  {
    const due = mountS('finalNext', {}, (s) => { s.league.picks = s.league.picks.filter((p) => !(p.playerId === 'p1' && p.weekId === 'w6n')); }).m;
    const line = msgLine(due.card());
    assert(/data-gd-kind="final"/.test(due.card()) && /You went \d+–\d+ · Next: NFL Week 6 picks lock /.test(line), `15a: the Final card's line names the next opportunity: picks still due in the other sport ("${line}")`);
    const inn = mountS('finalNext').m;
    assert(/You went \d+–\d+ · Next: you're in for NFL Week 6/.test(msgLine(inn.card())), `15b: …and when every pick is in, it says so ("${msgLine(inn.card())}")`);
    const dueOpen = mountS('finalNext', {}, (s) => { s.league.picks = s.league.picks.filter((p) => !(p.playerId === 'p1' && p.weekId === 'w6n')); }).m;
    dueOpen.open();
    assert(/What's next: Next up: NFL Week 6 — picks lock /.test(strip((dueOpen.card().match(/<div class="gd-stats">[\s\S]*?<\/div>/) || [''])[0])) && /class="gd-next"/.test(due.card()), `15a-2: …the OPEN Final card always says it in full under the stats (so the collapsed short form may fold away at the largest text without losing it), and the short form is its own span (".gd-next")`);
    const quiet = mountS('final').m;
    assert(/You went \d+–\d+/.test(msgLine(quiet.card())) && !/Next/.test(msgLine(quiet.card())), `15c: with nothing published still to come the card does not invent a "Next" ("${msgLine(quiet.card())}")`);
    const spect = mountS('finalNext', {}, (s) => { s.competitions.forEach((c) => { if (c.sport === 'nfl') c.viewerEntered = false; }); }).m;
    assert(/Next: NFL Week 6 kicks off/.test(msgLine(spect.card())) && !/picks lock/.test(msgLine(spect.card())), `15d: a member NOT entered in NFL is never told NFL picks are due — it is a game to follow ("${msgLine(spect.card())}")`);
  }
  // (b) the Game view's What's next card (DI-593 / DI-599): only on a Final game, after Related; "See week results" only for a server-confirmed final week
  {
    const fin = mountS('final').m.home.resolveGameView('c1');
    const nx = nextOf(fin);
    assert(!!nx && /<h3 class="gv-h">What's next<\/h3>/.test(nx) && /Nothing else is scheduled yet\. When the commissioner publishes the next slate, it shows up here\./.test(nx) && /data-gv-action="week-results"[^>]*>See week results</.test(nx) && !/results post when/.test(nx), `15e: a Final game in a FINALIZED week: What's next with DI-599's quiet line and "See week results" (${strip(nx)})`);
    assert(fin.html.indexOf('data-gv="next"') > fin.html.indexOf('data-gv="thread"') && (!/data-gv="related"/.test(fin.html) || fin.html.indexOf('data-gv="next"') > fin.html.indexOf('data-gv="related"')), '15f: …placed after the thread card and Related (DI-591\'s order)');
    const mid = mountS('live3').m.home.resolveGameView('c6');
    const nm = nextOf(mid);
    assert(!!nm && /Week 6 is under way — follow along in Game Day and the chat\./.test(strip(nm)) && /data-gv-action="open-gameday"[^>]*>Open Game Day</.test(nm) && /Week 6 results post when the last game is final\./.test(nm) && !/week-results/.test(nm), `15g: a Final game in a week still LIVE: the rest of the week is the next thing (Open Game Day) and the results line waits (${strip(nm)})`);
    const due = mountS('finalNext', {}, (s) => { s.league.picks = s.league.picks.filter((p) => !(p.playerId === 'p1' && p.weekId === 'w6n')); }).m.home.resolveGameView('c1');
    assert(/Next up: NFL Week 6 — picks lock /.test(strip(nextOf(due))) && /data-gv-action="next-picks"[^>]*>Make your NFL picks</.test(nextOf(due)) && /class="btn btn-primary gv-btn" data-gv-action="next-picks"/.test(nextOf(due)), `15h: picks due in the other sport: "Make your NFL picks" is the card's primary button (${strip(nextOf(due))})`);
    const liveGame = mountS('live3').m.home.resolveGameView('c1');
    assert(!/data-gv="next"/.test(liveGame.html), '15i: a game still LIVE has no What\'s next');
    const signedOut = mountS('final', { viewer: null }).m.home.resolveGameView('c1');
    assert(!signedOut || !/data-gv="next"/.test(signedOut.html), '15j: signed out: no What\'s next (S4)');
    assert(fin.next === null || typeof fin.next === 'object', '15k: (wiring) resolveGameView reports the next action and the results target, so the app can validate a tap against them');
    assert(fin.results && fin.results.final === true && mid.results && mid.results.final === false && due.next && due.next.action === 'next-picks' && due.next.weekId === 'w6n' && mid.next && mid.next.action === 'open-gameday', `15l: …final: ${fin.results && fin.results.final}, mid-week: ${mid.results && mid.results.final}, due -> ${due.next && due.next.action} ${due.next && due.next.weekId}, mid -> ${mid.next && mid.next.action}`);
  }
  // (c) the finish IN PLACE (DI-593): the Game view of a live game goes Final — the status chip cross-fades, What's next fades in, the rest of the screen is the same nodes
  {
    const { s, m } = mountS('live3', { logos: true });
    const v1 = m.home.resolveGameView('c1');
    const host = doc.createElement('div'); doc.body.appendChild(host);
    host.innerHTML = v1.html;
    const thread = host.querySelector('[data-gv="thread"]'), status = host.querySelector('[data-bind="status"]'), imgs = host.querySelectorAll('.gv-score img'), score = host.querySelector('[data-gv="score"]');
    goFinal(s, 'c1');
    const v2 = m.home.resolveGameView('c1');
    const ok = m.home.patchGameView(host, { html: v2.html, prevHtml: v1.html, part: 'body' });
    const nx = host.querySelector('[data-gv="next"]');
    assert(ok === true && host.querySelector('[data-gv="thread"]') === thread && host.querySelector('[data-gv="score"]') === score && host.querySelectorAll('.gv-score img').every((im, i) => im === imgs[i]) && imgs.length === 2, '15m: DI-593 — the game finishing patches the open Game view IN PLACE: the score card, its logos and the thread card are the same nodes');
    assert(host.querySelector('[data-bind="status"]') === status && /Final/.test(status.textContent) && !!status.querySelector('.gv-xf-ghost[aria-hidden="true"]') && status.classList.contains('gv-xf') && /Live|3rd|Q3|4:12/i.test(status.querySelector('.gv-xf-ghost').textContent), `15n: …the status chip CROSS-FADES: the live chip stays on top as an aria-hidden ghost while "Final" fades in underneath (${strip(status.innerHTML)})`);
    assert(!!nx && nx.classList.contains('gv-enter'), '15o: …and What\'s next is INSERTED below and fades in (gv-enter)');
    m.env.advance(300);
    assert(!status.querySelector('.gv-xf-ghost'), '15p: …the ghost is gone after the 150 ms fade');
    host.remove();
  }
  {
    const real = globalThis.matchMedia;
    globalThis.matchMedia = (q) => ({ matches: /prefers-reduced-motion:\s*reduce/.test(q) });
    try {
      const { s, m } = mountS('live3');
      const v1 = m.home.resolveGameView('c1');
      const host = doc.createElement('div'); doc.body.appendChild(host);
      host.innerHTML = v1.html;
      goFinal(s, 'c1');
      m.home.patchGameView(host, { html: m.home.resolveGameView('c1').html, prevHtml: v1.html, part: 'body' });
      assert(!host.querySelector('.gv-xf-ghost') && !host.querySelector('.gv-enter') && /Final/.test(host.querySelector('[data-bind="status"]').textContent), '15q: under Reduce Motion the finish is an instant change: no ghost, no fade-in');
      host.remove();
    } finally { globalThis.matchMedia = real; }
  }
  // (d) the coordinator's decision: a LOCKED week where the member picked some games but not all (hasPlayerSubmitted = a full slate)
  {
    E.SCENARIOS.lockedNone = E.SCENARIOS.lockedNone || { week: 'locked', live: [], up: ['c1', 'c2', 'c3', 'c4', 'c5', 'c7'], fin: [], plays: ['cfb'], noPicks: true };
    const panel = (v) => strip(((v && v.html.match(/<article class="card gv-card gv-picks-card"[\s\S]*?<\/article>/)) || [''])[0]);
    const partial = mountS('locked', {}, (s) => { s.league.picks = s.league.picks.filter((p) => !(p.playerId === 'p1' && p.gameId !== 'c1')); });
    const onPicked = partial.m.home.resolveGameView('c1');
    assert(/Picks are locked\. You picked 1 of 6\. Everyone's picks appear at kickoff\./.test(panel(onPicked)) && /Your pick: Texas \+3\.5/.test(panel(onPicked)) && !/data-gv-action="make-picks"/.test(onPicked.html), `15r: LOCKED, 1 of 6 picked, on the game they picked: "Picks are locked. You picked 1 of 6. Everyone's picks appear at kickoff." and their own pick stays on screen, no button ("${panel(onPicked)}")`);
    const onOther = partial.m.home.resolveGameView('c2');
    assert(/Picks are locked\. You picked 1 of 6\./.test(panel(onOther)) && !/Your pick/.test(panel(onOther)), `15s: …on a game they did not pick: the same sentence, no "Your pick" ("${panel(onOther)}")`);
    const none = mountS('lockedNone').m.home.resolveGameView('c1');
    assert(/Picks are locked and yours weren't submitted\. Everyone's picks appear at kickoff\./.test(panel(none)) && !/You picked/.test(panel(none)) && !/Your pick/.test(panel(none)), `15t: …no picks at all: "Picks are locked and yours weren't submitted. Everyone's picks appear at kickoff." ("${panel(none)}")`);
    const openPartial = mountS('openIn', {}, (s) => { s.league.picks = s.league.picks.filter((p) => !(p.playerId === 'p1' && p.gameId !== 'c1')); }).m.home.resolveGameView('c1');
    assert(/Submit your picks to see who's in\./.test(panel(openPartial)) && /data-gv-action="make-picks"/.test(openPartial.html) && /Your pick: Texas \+3\.5/.test(panel(openPartial)), `15u: (control) an OPEN week with a partial slate still asks them to submit, offers the button, and shows their pick ("${panel(openPartial)}")`);
    const full = mountS('locked').m.home.resolveGameView('c1');
    assert(/data-picks-view="blind"/.test(full.html) && !/Picks are locked/.test(panel(full)), '15v: (control) a member with the FULL slate in a locked week sees the blind form, not the partial sentence');
  }
}

// ═══ [16] Gate transitions patched IN PLACE (reviewer round 3 + security finding 2, fix round 2) ═════════════════════════════════════════════
// The in-place patcher must never leave a revealed pick on screen when the gate CLOSES (revealed -> Locked, revealed -> rows not landed), and must draw exactly what a fresh paint draws for EVERY
// transition between the gate's states, in both forms the league line is drawn in: the open Game Day card's rows ('card', through Home's own paint -> patchGameDay) and the Game view's panel
// ('panel', patchGameView). States: public (week live, rows landed), hidden (week Locked, the viewer submitted: the blind form), none (week Locked, the viewer did not submit), rows (week live but the
// other members' rows have NOT landed: supabase mode, S-C10) — each By person and By team. The canary is a RIVAL's side: the team only rivals took.
console.log('\n[16] Every gate transition, patched in place, equals a fresh paint — and a closing gate leaves no rival side and no cluster…');
if (want(16)) {
  const chips = await import('./js/pick-chips.js');
  const { buildAbbrMap } = await import('./js/data-model.js');
  const RUNTIME_CLASSES = new Set(['gv-enter', 'gv-xf', 'gv-xf-in', 'gv-xf-out', 'gd-row--hl']);
  const canon = (node) => {
    if (!node) return '(none)';
    if (node.nodeType === 3) return node.data;
    if (node.nodeType !== 1) return '';
    if ((node.getAttribute('class') || '').split(/\s+/).includes('gv-xf-ghost')) return '';
    const attrs = node.getAttributeNames().filter((a) => a !== 'data-sig').sort().map((a) => {
      let v = node.getAttribute(a);
      if (a === 'class') v = v.split(/\s+/).filter((c) => c && !RUNTIME_CLASSES.has(c)).sort().join(' ');
      return `${a}="${v}"`;
    });
    return `<${node.localName}${attrs.length ? ' ' + attrs.join(' ') : ''}>${Array.from(node.childNodes).map(canon).join('')}</${node.localName}>`;
  };
  const parseBox = (html) => { const b = doc.createElement('div'); b.innerHTML = html; return b; };
  const STATES = [];
  for (const view of ['person', 'team']) for (const id of ['public', 'hidden', 'none', 'rows']) STATES.push({ id, view, key: `${id}/${view}` });
  /** Puts week `weekId` (and the store) into gate state `st`; `opts` is the scenario's options object (its picksView is read live). */
  const apply = (s, opts, st, weekId, viewerPicks) => {
    opts.picksView = st.view;
    chips._resetPickGateForTest();
    storage.setBackendMode('local');
    const status = st.id === 'hidden' || st.id === 'none' ? 'locked' : 'live';
    s.league.weeks = s.league.weeks.map((w) => (w.weekId === weekId ? { ...w, status } : w));
    s.league.weeks.forEach((w) => storage.saveWeek(w));
    const others = s.league.picks.filter((p) => !(p.playerId === 'p1' && p.weekId === weekId));
    s.league.picks = st.id === 'none' ? others : [...others, ...viewerPicks];
    globalThis.localStorage.setItem('cfbp_picks', JSON.stringify(s.league.picks));   // (the seam's own local-mode store, written whole: saveAllPicks upserts and cannot take a pick away)
    if (st.id === 'rows') { storage.setBackendMode('supabase'); chips.configurePickGate({ picksReadConfirmed: () => false, submissionStateFor: () => 'yes' }); }
  };
  const restore = () => { chips._resetPickGateForTest(); storage.setBackendMode('local'); };
  const results = { panel: { n: 0, inPlace: 0, bad: [] }, card: { n: 0, inPlace: 0, bad: [] } };
  const NFL = Object.values(E.SLATE).filter((g) => g.sp === 'nfl');
  const nflAbbr = buildAbbrMap(NFL.map((g) => ({ homeTeam: g.hn, awayTeam: g.an })));
  const canaryN = { n1: new RegExp(`\\bBills\\b|\\b${nflAbbr.get('Bills')}\\b`), n2: new RegExp(`\\bCowboys\\b|\\b${nflAbbr.get('Cowboys')}\\b`) };
  try {
    for (const from of STATES) for (const to of STATES) {
      // ── 'panel': the Game view of c1 (Texas at Oklahoma; the viewer took Texas, two rivals took Oklahoma) ──
      {
        const opts = { picksView: from.view };
        const { s, m } = mountS('live3', opts);
        const mine = s.league.picks.filter((p) => p.playerId === 'p1' && p.weekId === 'w6');
        apply(s, opts, from, 'w6', mine);
        const A = m.home.resolveGameView('c1');
        apply(s, opts, to, 'w6', mine);
        const B = m.home.resolveGameView('c1');
        const el = parseBox(A.html); doc.body.appendChild(el);
        const ok = m.home.patchGameView(el, { html: B.html, prevHtml: A.html, part: 'body' });
        const got = el.querySelector('[data-gv="picks"]'), want = parseBox(B.html).querySelector('[data-gv="picks"]');
        const same = canon(got) === canon(want);
        const leak = to.id !== 'public' && (/pg-cluster|pg-split/.test(got.outerHTML) || /\bOklahoma\b|\bOU\b/.test(got.outerHTML));
        results.panel.n++; if (ok === true) results.panel.inPlace++;
        if (!same || leak) results.panel.bad.push(`${from.key} -> ${to.key}${!same ? ' (differs from a fresh paint)' : ''}${leak ? ' (RIVAL SIDE / CLUSTER LEFT ON SCREEN)' : ''}`);
        el.remove();
        restore();
      }
      // ── 'card': the open Game Day card holding CFB (live) and NFL rows; the NFL week moves between the states, Home repaints through its own paint ──
      {
        const opts = { picksView: from.view };
        const { s, m } = mountS('both', opts);
        const mine = s.league.picks.filter((p) => p.playerId === 'p1' && p.weekId === 'w6n');
        apply(s, opts, from, 'w6n', mine);
        m.home.renderHome(); m.open();
        const gdBefore = m.container.querySelector('#gd-card');
        apply(s, opts, to, 'w6n', mine);
        m.home.renderHome();
        const gdAfter = m.container.querySelector('#gd-card');
        const fresh = mountS('both', { picksView: to.view });
        apply(fresh.s, { picksView: to.view }, to, 'w6n', mine);
        fresh.m.home.renderHome(); fresh.m.open();
        const got = gdAfter && gdAfter.querySelector('.gd-list'), want = fresh.m.container.querySelector('#gd-card .gd-list');
        const same = !!got && canon(got) === canon(want);
        const r4 = (id) => { const row = got ? got.children.find((r) => r.getAttribute('data-game-id') === id) : null; const l = row ? row.querySelector('.gd-r4') : null; return l ? l.outerHTML : ''; };
        const leak = to.id !== 'public' && ['n1', 'n2'].some((id) => /pg-cluster|pg-split/.test(r4(id)) || canaryN[id].test(r4(id)));
        results.card.n++; if (gdAfter === gdBefore) results.card.inPlace++;
        if (!same || leak) results.card.bad.push(`${from.key} -> ${to.key}${!same ? ' (differs from a fresh paint)' : ''}${leak ? ' (RIVAL SIDE / CLUSTER LEFT ON SCREEN)' : ''}`);
        restore();
      }
    }
  } finally { restore(); }
  const N = STATES.length * STATES.length;
  assert(results.panel.n === N && results.panel.inPlace === N && results.panel.bad.length === 0, `16a: the Game view panel — all ${N} transitions between the 8 gate states (public / hidden / none / rows not landed, each By person and By team) are patched IN PLACE (${results.panel.inPlace}/${N}) and each equals a fresh paint, with no rival side and no cluster left once the gate closes${results.panel.bad.length ? ' — ' + results.panel.bad.slice(0, 4).join('; ') : ''}`);
  assert(results.card.n === N && results.card.inPlace === N && results.card.bad.length === 0, `16b: the open Game Day card's rows — the same ${N} transitions, through Home's own paint, keep the card's node (${results.card.inPlace}/${N} in place) and every row's league line equals a fresh paint, the closing gate leaving no rival side (Bills / Cowboys) and no cluster${results.card.bad.length ? ' — ' + results.card.bad.slice(0, 4).join('; ') : ''}`);
  // the reviewer's two named sequences, spelled out (revealed -> Locked; revealed -> rows not landed), both views, both forms — they are in the sweep above; this proves the fixture really is revealed first
  {
    const opts = { picksView: 'team' };
    const { s, m } = mountS('live3', opts);
    const mine = s.league.picks.filter((p) => p.playerId === 'p1' && p.weekId === 'w6');
    apply(s, opts, { id: 'public', view: 'team' }, 'w6', mine);
    const A = m.home.resolveGameView('c1');
    restore();
    assert(/pg-cluster/.test(A.html) && /\bOU\b|Oklahoma/.test((A.html.match(/data-gv="picks"[\s\S]*?<\/article>/) || [''])[0]), '16c: (fixture) the "revealed" state really shows the rival side (OU) in clusters — so 16a/16b\'s "no rival side after closing" is a measurement');
  }
  {
    // (fixture) the four card states really are four different league lines on the NFL row
    const line = (st) => {
      const opts = { picksView: 'team' };
      const { s, m } = mountS('both', opts);
      const mine = s.league.picks.filter((p) => p.playerId === 'p1' && p.weekId === 'w6n');
      apply(s, opts, { id: st, view: 'team' }, 'w6n', mine);
      m.home.renderHome(); m.open();
      const row = m.container.querySelectorAll('.gd-row').find((r) => r.getAttribute('data-game-id') === 'n1');
      const l = row ? row.querySelector('.gd-r4') : null;
      restore();
      return l ? l.innerHTML : '';
    };
    const L = { public: line('public'), hidden: line('hidden'), none: line('none'), rows: line('rows') };
    const panel = (st) => {
      const opts = { picksView: 'team' };
      const { s, m } = mountS('live3', opts);
      const mine = s.league.picks.filter((p) => p.playerId === 'p1' && p.weekId === 'w6');
      apply(s, opts, { id: st, view: 'team' }, 'w6', mine);
      const v = m.home.resolveGameView('c1');
      restore();
      return strip(((v && v.html.match(/<article class="card gv-card gv-picks-card"[\s\S]*?<\/article>/)) || [''])[0]) + ((v && /data-picks-view="(\w+)"/.exec(v.html)) || [, ''])[1];
    };
    const P = { public: panel('public'), hidden: panel('hidden'), none: panel('none'), rows: panel('rows') };
    assert(/team$/.test(P.public) && /blind$/.test(P.hidden) && /Picks are locked and yours weren't submitted/.test(P.none) && /still loading/.test(P.rows), `16e: (fixture) the Game view panel in the four states: public = By team, hidden = blind, none = "Picks are locked and yours weren't submitted", rows not landed = "still loading"`);
    assert(/pg-cluster/.test(L.public) && /data-picks-view="blind"/.test(L.hidden) && !/pg-cluster/.test(L.hidden) && L.none === '' && L.rows === '', `16d: (fixture) the NFL row's league line in the four states: public = clusters, hidden = the blind form, none = nothing, rows not landed = nothing (${Object.entries(L).map(([k, v]) => `${k}: ${v ? (v.match(/data-picks-view="(\w+)"/) || [])[1] || 'drawn' : 'empty'}`).join(', ')})`);
  }
}

// ═══ [17] A patch that THROWS writes the whole card (security finding 1, fix round 2) ═════════════════════════════════════════════
console.log('\n[17] If the in-place patch throws, Home writes the whole card from the new markup (never a half-patched card)…');
if (want(17)) {
  const { MiniElement: ME } = await import('./minidom.mjs');
  const canonCard = (h) => h.replace(/ data-sig="[^"]*"/g, '');
  const { s, m } = mountS('live3');
  m.open();
  const g = s.league.games.find((x) => x.gameId === 'c1'); g.homeScore = 20;      // a tick: same kind, same open state -> the in-place path
  const real = ME.prototype.getAttributeNames;
  let threw = null, calls = 0;
  ME.prototype.getAttributeNames = function () { calls++; throw new Error('forced patch failure'); };
  const realErr = console.error; console.error = () => {};
  try { m.home.renderHome(); } catch (e) { threw = e; } finally { ME.prototype.getAttributeNames = real; console.error = realErr; }
  const fresh = mountS('live3', {}, (s2) => { s2.league.games.find((x) => x.gameId === 'c1').homeScore = 20; }).m;
  fresh.open();
  assert(calls > 0 && threw === null, `17a: (fixture) the in-place patch really threw (${calls} forced throw${calls === 1 ? '' : 's'}) — and Home did not (the paint caught it)`);
  assert(canonCard(m.card()) === canonCard(fresh.card()) && /20/.test((m.container.querySelector('.gd-row[data-game-id="c1"]') || { textContent: '' }).textContent), '17b: …the card on screen equals the NEW markup exactly (written whole, like pushed-screen\'s writePart): no half-patched card, no stale score');
}

// ═══ [12] MUTATION PROOFS (security F2.2, fix round 1) ═════════════════════════════════════════════
// Commit 3518519e CLAIMED four Game-Day-level mutation proofs (C2 week, C3 own pick, C4 roster, C7 coverage word) and kept them nowhere. They are encoded here: each bypass is applied to a SCRATCH COPY of the
// tree (never the working files), section [4] of this suite is re-run on that copy in a separate process, and it must go RED; the unmutated copy is the positive control and every restore is re-proved green.
if (!CORE_ONLY && !WANT) await mutations();
async function mutations() {
  console.log('\n[12] MUTATION PROOFS — the four Game-Day bypasses of 3518519e on a scratch copy; each must turn section [4] red…');
  const tmp = mkdtempSync(join(tmpdir(), 'cfbp-gdt-'));
  const copy = join(tmp, 'cfb-pickems');
  mkdirSync(copy, { recursive: true });
  for (const p of ['js', 'css/styles.css', 'index.html', 'minidom.mjs', 'd1homeenv.mjs', 'gamedayenv.mjs', 'statsfixtures.mjs', 'themeresolve.mjs', 'themetables.mjs', 'gamedaytest.mjs']) {
    if (!existsSync(join(HERE, p))) continue;
    mkdirSync(join(copy, p, '..'), { recursive: true });
    cpSync(join(HERE, p), join(copy, p), { recursive: true });
  }
  const original = (rel) => readFileSync(join(HERE, rel), 'utf8');
  const run = (sections = '4') => { const r = spawnSync(process.execPath, [join(copy, 'gamedaytest.mjs')], { cwd: copy, env: { ...process.env, GDT_CORE: '1', GDT_SECTIONS: sections }, encoding: 'utf8', timeout: 120000 }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
  const base = run();
  assert(base.code === 0 && /ALL PASS/.test(base.out), `12-0: POSITIVE CONTROL — section [4] on the unmutated COPY passes in a separate process (${(base.out.match(/(\d+) passed/) || [])[1]} assertions)`, base.out.slice(-500));
  const base11 = run('11');
  assert(base11.code === 0 && /ALL PASS/.test(base11.out), `12-0b: POSITIVE CONTROL — section [11] (the rail hold) on the unmutated COPY passes in a separate process (${(base11.out.match(/(\d+) passed/) || [])[1]} assertions)`, base11.out.slice(-500));
  const MUTANTS = [
    ['C2', 'the open card gates a row on the CARD\'s week instead of the row\'s own game week (a Locked sport\'s rows would draw clusters in a card that is Live)', 'js/home.js',
      [["const game = gamesById.get(row.gameId), week = game ? weeksById.get(game.weekId) : null;", "const game = gamesById.get(row.gameId), week = game ? (weeksById.get(input.weekId) || null) : null;"]]],
    ['C3', 'the "own pick" a row carries is read from a RIVAL (the first other player\'s pick on the game)', 'js/home.js',
      [["ownTeam: isNonEmptyString(viewerId) ? ownPickTeam(s.picks, g.gameId, viewerId) : null,", "ownTeam: ((s.picks.find(p => p.gameId === g.gameId && p.playerId !== viewerId) || {}).selectedTeam) || null,"]]],
    ['C4', 'Home invents a roster again: with no entrantsFor injected every ACTIVE player is an entrant (the card and the Game view)', 'js/home.js',
      [["const entrantsFor = typeof g.entrantsFor === 'function' ? g.entrantsFor : () => [];", "const entrantsFor = typeof g.entrantsFor === 'function' ? g.entrantsFor : () => asArray(snapshot.players).filter(p => p && p.active);"],
       ["const entrants = d.entrantsFor ? asArray(d.entrantsFor(week)) : [];", "const entrants = d.entrantsFor ? asArray(d.entrantsFor(week)) : asArray(snapshot.players).filter(p => p && p.active);"]]],
    ['C7', 'a pill and a row of a sport the viewer has NOT joined carry a coverage word', 'js/gameday.js',
      [["if (!isStr(viewerId) || !e.entered) return { kind: 'follow' };", "if (!isStr(viewerId)) return { kind: 'follow' };"]]],
  ];
  const reds = (out) => [...out.matchAll(/❌ ([^\n]{0,70})/g)].map((m) => m[1]).slice(0, 3);
  for (const [id, label, rel, edits] of MUTANTS) {
    let src = original(rel), ok = true;
    for (const [from, to] of edits) { if (!src.includes(from)) { ok = false; break; } src = src.replace(from, to); }
    if (!ok) { assert(false, `12-${id}: the mutation APPLIES (its anchor moved: ${edits[0][0].slice(0, 60)}…)`); continue; }
    writeFileSync(join(copy, rel), src);
    const r = run();
    writeFileSync(join(copy, rel), original(rel));                    // restore from the pristine file, then prove it is green again below
    assert(r.code !== 0 && /❌/.test(r.out), `12-${id}: ${label} → RED on: ${reds(r.out).join(' | ') || '(nothing!)'}`);
  }
  // P-3 / TP 228 (reviewer round 2): a NEW touch during the rail hold. Each mutant must turn the named [11] assertion red — the reviewer's B3m-b first.
  const HOLD_MUTANTS = [
    ['B3m-b', 'the parked flush ignores a finger on the rail (reviewer round 2: `flushParked` without its railBusy() check)', 'js/home.js',
      [['if (railBusy()) { armFlush(); return; }', ';']], /11x:/],
    ['P3-ii', 'only a touch that ends ON the rail releases it (a lost rail touch then holds Home until the 30 s cap)', 'js/home.js',
      [['const onTouchEnd = () => releaseRail();', "const onTouchEnd = (e) => { if (e && e.target && typeof e.target.closest === 'function' && e.target.closest('[data-gd-rail]')) releaseRail(); };"]], /11z:/],
    ['VIS', 'coming back to the foreground does not release a lost rail touch', 'js/home.js',
      [['    bindVisibilityOnce();\n', '']], /11z-2:/],
  ];
  for (const [id, label, rel, edits, mustRed] of HOLD_MUTANTS) {
    let src = original(rel), ok = true;
    for (const [from, to] of edits) { if (src.split(from).length !== 2) { ok = false; break; } src = src.replace(from, to); }
    if (!ok) { assert(false, `12-${id}: the mutation APPLIES (its anchor moved: ${edits[0][0].slice(0, 60)}…)`); continue; }
    writeFileSync(join(copy, rel), src);
    const r = run('11');
    writeFileSync(join(copy, rel), original(rel));
    const red = [...r.out.matchAll(/❌ ([^\n]{0,90})/g)].map((m) => m[1]);
    assert(r.code !== 0 && red.some((x) => mustRed.test(x)), `12-${id}: ${label} → RED on ${mustRed.source.replace(/[\\:]/g, '')}: ${red.slice(0, 3).join(' | ') || '(nothing!)'}`);
  }
  // Part B (2)/(1)/(4) (fix round 2): the announcer's rules, the leaving pill and the in-place patch — each mutant must turn the named [13]/[14] assertion red.
  const base1314 = run('13,14,15');
  assert(base1314.code === 0 && /ALL PASS/.test(base1314.out), `12-0c: POSITIVE CONTROL — sections [13], [14] and [15] on the unmutated COPY pass in a separate process (${(base1314.out.match(/(\d+) passed/) || [])[1]} assertions)`, base1314.out.slice(-500));
  const B_MUTANTS = [
    ['A-focus', 'the announcer speaks whatever has focus (not only inside the card)', 'js/home.js', [["return !!(card && active && typeof card.contains === 'function' && card.contains(active));", 'return true;']], /13d:/],
    ['A-debounce', 'no debounce (a tick is spoken at once)', 'js/gameday-dom.js', [['export const ANNOUNCE_DEBOUNCE_MS = 1000;', 'export const ANNOUNCE_DEBOUNCE_MS = 0;']], /13b:/],
    ['A-throttle', 'no 5 s throttle', 'js/gameday-dom.js', [['export const ANNOUNCE_THROTTLE_MS = 5000;', 'export const ANNOUNCE_THROTTLE_MS = 0;']], /13g:/],
    ['A-held', 'an announcement is spoken while its change is still parked under a finger', 'js/home.js', [['isHeld: () => parkedNow || railBusy(),', 'isHeld: () => false,']], /13h:/],
    ['A-flip', 'every live tick is announced (not only a cover flip)', 'js/gameday.js', [['FLIP_KINDS.has(w.coverage) && p.coverage !== w.coverage) {', 'FLIP_KINDS.has(w.coverage)) {']], /13e:/],
    ['L-fade', 'a game that ends drops its pill at once (no 150 ms fade)', 'js/gameday-dom.js', [["if (!env || env.reduced === true || typeof env.setTimer !== 'function') return null;", 'return null;']], /13k:/],
    ['L-reduce', 'the leaving fade ignores Reduce Motion', 'js/gameday-dom.js', [["if (!env || env.reduced === true || typeof env.setTimer !== 'function') return null;", "if (!env || typeof env.setTimer !== 'function') return null;"]], /13o:/],
    ['L-busy', 'a faded pill is removed under a finger that landed on the rail during the fade (P-3)', 'js/gameday-dom.js', [["if (typeof env.isBusy === 'function' && env.isBusy() === true) { env.setTimer(remove, LEAVE_MS); return; }", ';']], /13u:/],
    ['L-focus', 'a focused pill that leaves keeps (loses) focus instead of handing it on', 'js/gameday-dom.js', [['function handFocusOff(node, fallback) {\n  if (!activeIn(node)) return;', 'function handFocusOff(node, fallback) {\n  return;']], /13m:/],
    ['P-shape', 'a changed pill is rewritten whole instead of patched child by child', 'js/gameday-dom.js', [['if (sameShape(prev, next) && le.length === pe.length) {', 'if (false) {']], /13r:/],
    ['P-keyed', 'a keyed item that changed is REPLACED (the old patchKeyedRows behaviour)', 'js/gameday-dom.js', [['node = p ? patchNode(node, p, n, ctx) : replaceNode(node, n, ctx);', 'node = replaceNode(node, n, ctx);']], /13t:/],
    ['G-logo', 'the open card\'s rows never draw the lockup', 'js/gameday-sheet.js', [['const logos = !!(la || lh);', 'const logos = false;']], /14a:/],
    // Part B (5)/(3) and the coordinator's locked copy
    ['N-next', 'the Final card drops "Next: …"', 'js/gameday.js', [["body.next = isStr(f.next) ? f.next : '';", "body.next = '';"]], /15a:/],
    ['N-nextfull', 'the open Final card does not carry the full What\'s next (the folded short form would be lost)', 'js/home.js', [["if (next) input.stats = {", 'if (false) input.stats = {']], /15a-2:/],
    ['N-finalonly', 'What\'s next is drawn on a game that is still live', 'js/home.js', [["if (phase.phase === 'final' && viewer) {", 'if (viewer) {']], /15i:/],
    ['N-results', '"See week results" is offered before the week is server-confirmed final', 'js/home.js', [["const weekFinal = wstatus === 'final';", 'const weekFinal = true;']], /15g:/],
    ['N-locked', 'a partial slate in a locked week gets the "weren\'t submitted" sentence', 'js/home.js', [['picksNote = k > 0 ? `Picks are locked.', 'picksNote = k < 0 ? `Picks are locked.']], /15r:/],
    ['N-own', 'the member\'s own pick is dropped from the locked panel', 'js/game-view.js', [["(m.own.kind === 'pending' || m.picksState === 'hidden')", "(m.picksState === 'hidden')"]], /15r:/],
    ['N-xfade', 'the status chip changes with no cross-fade', 'js/gameday-dom.js', [['  container.classList.add(\'gv-xf\');\n  container.appendChild(ghost);', '']], /15n:/],
    ['N-enter', 'a section that appears in place does not fade in', 'js/gameday-dom.js', [["if (!reduced && node.classList) node.classList.add('gv-enter');", ';']], /15o:/],
  ];
  for (const [id, label, rel, edits, mustRed] of B_MUTANTS) {
    let src = original(rel), ok = true;
    for (const [from, to] of edits) { if (src.split(from).length !== 2) { ok = false; break; } src = src.replace(from, to); }
    if (!ok) { assert(false, `12-${id}: the mutation APPLIES (its anchor moved: ${edits[0][0].slice(0, 60)}…)`); continue; }
    writeFileSync(join(copy, rel), src);
    const r = run('13,14,15');
    writeFileSync(join(copy, rel), original(rel));
    const red = [...r.out.matchAll(/❌ ([^\n]{0,90})/g)].map((m) => m[1]);
    assert(r.code !== 0 && red.some((x) => mustRed.test(x)), `12-${id}: ${label} → RED on ${mustRed.source.replace(/[\\:]/g, '')}: ${red.slice(0, 3).join(' | ') || '(nothing!)'}`);
  }
  const again1314 = run('13,14,15');
  assert(again1314.code === 0 && /ALL PASS/.test(again1314.out), '12-Z2: …and the copy is GREEN again on [13], [14] and [15] after those restores');
  // Reviewer round 3 + security findings 1 and 2: the gate-transition property ([16]) and the whole-card fallback ([17])
  const base1617 = run('16,17');
  assert(base1617.code === 0 && /ALL PASS/.test(base1617.out), `12-0d: POSITIVE CONTROL — sections [16] and [17] on the unmutated COPY pass in a separate process (${(base1617.out.match(/(\d+) passed/) || [])[1]} assertions)`, base1617.out.slice(-500));
  const G_MUTANTS = [
    ['G-skip', 'patchNode skips setContent (an element whose own text changed keeps its OLD content)', 'js/gameday-dom.js', [['  setContent(live, next, ctx);\n  return live;\n}', '  return live;\n}']], /16a:|16b:/],
    ['G-shape', 'patchNode treats a text change as "the same shape" (it recurses past the changed text instead of rewriting it)', 'js/gameday-dom.js', [['    if (p.nodeType === 3 && p.data !== q.data) return false;\n', '']], /16a:|16b:/],
    ['S1-catch', 'Home lets a throwing patch escape (no whole-card fallback)', 'js/home.js', [["try { patched = patchGameDay(holder, nowIt.html, { prevHtml: prev.htmls.get('now'), reduced: prefersReducedMotion(), setTimer: d.setTimer || null, isBusy: railBusy }); }\n          catch (e) { console.error('[home] Game Day patch failed; writing the card whole', e); patched = null; }", "patched = patchGameDay(holder, nowIt.html, { prevHtml: prev.htmls.get('now'), reduced: prefersReducedMotion(), setTimer: d.setTimer || null, isBusy: railBusy });"]], /17a:|17b:/],
  ];
  for (const [id, label, rel, edits, mustRed] of G_MUTANTS) {
    let src = original(rel), ok = true;
    for (const [from, to] of edits) { if (src.split(from).length !== 2) { ok = false; break; } src = src.replace(from, to); }
    if (!ok) { assert(false, `12-${id}: the mutation APPLIES (its anchor moved: ${edits[0][0].slice(0, 60)}…)`); continue; }
    writeFileSync(join(copy, rel), src);
    const r = run('16,17');
    writeFileSync(join(copy, rel), original(rel));
    const red = [...r.out.matchAll(/❌ ([^\n]{0,110})/g)].map((m) => m[1]);
    assert(r.code !== 0 && red.some((x) => mustRed.test(x)), `12-${id}: ${label} → RED on ${mustRed.source.replace(/[\\:]/g, '')}: ${red.slice(0, 3).join(' | ') || '(nothing!)'}`);
  }
  const again1617 = run('16,17');
  assert(again1617.code === 0 && /ALL PASS/.test(again1617.out), '12-Z3: …and the copy is GREEN again on [16] and [17] after those restores');
  const again = run();
  const again11 = run('11');
  assert(again.code === 0 && /ALL PASS/.test(again.out) && again11.code === 0 && /ALL PASS/.test(again11.out), '12-Z: …and after every restore the copy is GREEN again, sections [4] and [11] (no mutant was left behind)');
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
}

console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 60000).unref();
