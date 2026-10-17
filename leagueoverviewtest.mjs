/**
 * CFB Pickems — leagueoverviewtest.mjs
 * =====================================
 * D1 (v0.30.0) Lane A — DI-554 / DI-556 / DI-522: js/league-overview.js, the markup of the league overview sheet and of the League Page's sport cards, driven through the six situations
 * of Drew's approved mockup (`league-overview-sheet.html`, D-60) as member and commissioner. Security C3 (the overview takes only { liveCount } and the viewer's own state) and C5 (escaper
 * and number sink required, double-quoted attributes, hostile text everywhere including aria-label and title).
 *
 * Run:  node leagueoverviewtest.mjs
 *
 *   [1]  structure — a pure leaf (imports nothing, canary proves the scan can fail), the exact API, escaper and numHtml REQUIRED (it refuses to render without them, no `typeof` fallback).
 *   [2]  the six situations x two roles — which groups exist, which cards, the labels ("Your sport" vs "Your sports"), the Join button's state and caption, the setup button, the zone note.
 *   [3]  the card contract — one button per played sport (data-sport, data-tab, aria-label), nothing interactive nested in a button, the Join button OUTSIDE any button, the setup button beside.
 *   [4]  the Join card — enabled / disabled with its reason in text, busy, the failure with a Retry; nothing gold, due, late or missing for a non-entrant.
 *   [5]  the League Page region is the SAME markup as the overview's card groups (one function, CONVENTIONS #21).
 *   [6]  C5 — a hostile league name, display text, sport label, week label and pill text escape everywhere: no live element, no attribute break, including aria-label; every attribute double-quoted.
 *   [7]  C3 — the model has no place for a pick or a rival; a fixture planted with ids and `•••` marks does not reach the markup; the module cannot ask for them.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const LO = await import('./js/league-overview.js');
const SS = await import('./js/sport-status.js');
const { ICONS } = await import('./js/icons.js');
const { leagueOverviewHeaderHTML, leagueOverviewBodyHTML, leaguePageSportsHTML, sportCardHTML, joinCardHTML, requireEscHtml } = LO;

// the app's own escaper (js/app.js escHtml) — reproduced by value; xsstest [..] pins the real one
const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const numHtml = (v) => { const n = Number(v); return Number.isFinite(n) ? String(n) : ''; };
const icon = (k) => (ICONS[k] ? `<svg data-k="${k}"></svg>` : '');
const deps = { escHtml, numHtml, icon };

// ── fixtures: model built the way app.js builds it, from sport-status's own functions ─────────────────────────────────
const T = (o = {}) => ({ sportName: 'College Football', code: 'CFB', weekLabel: 'Week 6', windowText: 'Sat Oct 10 – Sun Oct 11', leftText: '2h 10m', lockWhenText: 'Sat 10/10 11:30 PT', kickoffWhenText: 'Sat 10/10 12:00 PT', ...o });
const NFL_T = (o = {}) => ({ sportName: 'NFL', code: 'NFL', weekLabel: 'Week 6', windowText: 'Sun Oct 11 – Mon Oct 12', leftText: '21h 0m', lockWhenText: 'Sun 10/11 12:30 PT', kickoffWhenText: 'Sun 10/11 1:00 PT', nextWeekN: 7, ...o });
const st = (o) => SS.deriveSportCardStatus({ hasWeek: true, totalGames: 7, liveGames: 0, finalGames: 0, lockAtMs: 1, firstKickoffMs: 2, lastKickoffMs: 3, ...o });
const played = (dbCode, status, text) => ({ dbCode, sportName: text.sportName, glyphKey: 'sportFootball', weekLabel: text.weekLabel, view: SS.sportCardView(status, text) });
const other = (dbCode, status, text, extra = {}) => ({ dbCode, code: text.code, sportName: text.sportName, glyphKey: 'sportFootball', weekLabel: text.weekLabel, view: SS.joinCardView(status, text), busy: false, error: false, ...extra });

function situation(name, role) {
  const comm = role === 'commissioner';
  const base = { leagueName: 'IRB Football', memberCount: 6, isCommissioner: comm, focusSport: null, leagueCount: 2, played: [], other: [], glance: [], commissioner: [], showZoneNote: false, sportsLine: 'College Football · NFL' };
  switch (name) {
    case 'due': {
      const cfb = st({ phase: 'open', submitted: false }), nfl = st({ phase: 'open', submitted: true, totalGames: 10 });
      return { ...base, showZoneNote: true, played: [played('cfb', cfb, T()), played('nfl', nfl, NFL_T())],
        glance: SS.glanceChips({ due: SS.sportsNeedingPicks([{ dbCode: 'cfb', code: 'CFB', status: { ...cfb, lockAtMs: 5000 } }], 1), liveCount: 0 }) };
    }
    case 'live': {
      const cfb = st({ phase: 'live', liveGames: 3, finalGames: 1, submitted: true }), nfl = st({ phase: 'open', submitted: false, totalGames: 10 });
      return { ...base, showZoneNote: true, played: [played('cfb', cfb, T()), played('nfl', nfl, NFL_T())],
        glance: SS.glanceChips({ due: SS.sportsNeedingPicks([{ dbCode: 'nfl', code: 'NFL', status: { ...nfl, lockAtMs: 5000 } }], 1), liveCount: 3 }) };
    }
    case 'quiet': {
      const cfb = st({ phase: 'final', nextWeekPublished: false }), nfl = st({ phase: 'final', nextWeekPublished: false, totalGames: 10 });
      return { ...base, showZoneNote: true, played: [played('cfb', cfb, T()), played('nfl', nfl, NFL_T())] };
    }
    case 'casual': {
      const cfb = st({ phase: 'live', liveGames: 3, finalGames: 1, submitted: true }), nfl = st({ phase: 'open', totalGames: 10, submitted: true, canSubmit: false });
      return { ...base, showZoneNote: true, played: [played('cfb', cfb, T())], other: [other('nfl', nfl, NFL_T())], glance: SS.glanceChips({ due: [], liveCount: 3 }) };
    }
    case 'casualLocked': {
      const cfb = st({ phase: 'open', submitted: true }), nfl = st({ phase: 'live', liveGames: 2, totalGames: 10, submitted: true, canSubmit: false });
      return { ...base, showZoneNote: true, played: [played('cfb', cfb, T())], other: [other('nfl', nfl, NFL_T())], glance: SS.glanceChips({ due: [], liveCount: 2 }) };
    }
    case 'single': {
      const cfb = st({ phase: 'open', submitted: false });
      return { ...base, sportsLine: 'College Football', played: [played('cfb', cfb, T())], showZoneNote: false,
        glance: SS.glanceChips({ due: SS.sportsNeedingPicks([{ dbCode: 'cfb', code: 'CFB', status: { ...cfb, lockAtMs: 5000 } }], 1), liveCount: 0 }) };
    }
    default: throw new Error(name);
  }
}
const ROWS_COMM = [{ action: 'comm-add-sport', title: 'Add a sport', subtitle: 'NFL is available for this league' }, { action: 'comm-manage', dbCode: 'cfb', title: 'Manage CFB', subtitle: 'Set up Week 7 · publish · lock' }];
const render = (m) => leagueOverviewBodyHTML(m, deps);
const countOf = (html, re) => (html.match(re) || []).length;
const textOf = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[1] structure — a pure leaf; the escaper and the number sink are REQUIRED…');
{
  const src = await readFile(join(HERE, 'js', 'league-overview.js'), 'utf8');
  const scan = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const hasImport = (text) => /^\s*import\b|\bimport\s*\(|\brequire\s*\(/m.test(scan(text));
  assert(!hasImport(src), '[1a] js/league-overview.js has no import, dynamic import or require (it cannot reach a pick reader: C3)');
  assert(hasImport(`import { getPicks } from './storage.js';\n${src}`), '[1a] …and the scan is not vacuous: an injected import fails it (canary)');
  assert(!/\b(localStorage|document|window|getPicks|getPlayers|arePicksPublic|canViewOtherPicks)\b/.test(scan(src)), '[1b] it names no storage, no DOM and no pick reader');
  assert(eq(Object.keys(LO).sort(), ['joinCardHTML', 'leagueOverviewBodyHTML', 'leagueOverviewHeaderHTML', 'leaguePageSportsHTML', 'requireEscHtml', 'sportCardHTML']), `[1c] the exported API (${Object.keys(LO).sort().join(', ')})`);
  const thrown = (fn) => { try { fn(); return null; } catch (e) { return e; } };
  const m = situation('due', 'member');
  for (const [name, fn] of [['body', (d) => leagueOverviewBodyHTML(m, d)], ['header', (d) => leagueOverviewHeaderHTML(m, d)], ['page region', (d) => leaguePageSportsHTML(m, d)],
    ['sport card', (d) => sportCardHTML(m.played[0], d)], ['join card', (d) => joinCardHTML(situation('casual', 'member').other[0], d)]]) {
    const e1 = thrown(() => fn({ numHtml, icon }));
    assert(e1 instanceof TypeError && /escHtml/.test(e1.message), `[1d] ${name}: refuses to render WITHOUT an escaper (${e1 && e1.message})`);
    const e2 = thrown(() => fn({ escHtml: 'nope', numHtml, icon }));
    assert(e2 instanceof TypeError, `[1d] ${name}: a non-function escaper is refused too (no \`typeof escHtml\` fallback)`);
  }
  assert(thrown(() => leagueOverviewBodyHTML(m, { escHtml, icon })) instanceof TypeError && thrown(() => leagueOverviewHeaderHTML(m, { escHtml, icon })) instanceof TypeError, '[1e] the number sink (numHtml) is required as well');
  assert(thrown(() => requireEscHtml(escHtml)) === null && requireEscHtml(escHtml) === escHtml, '[1f] requireEscHtml returns the escaper it was given');
  assert(!/typeof\s+escHtml/.test(scan(src).replace(/export function requireEscHtml[\s\S]*?\n\}\n/, '')), '[1g] the source has no `typeof escHtml` fallback anywhere but inside requireEscHtml itself (the requirement, not a fallback)');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[2] the six situations x two roles…');
{
  for (const role of ['member', 'commissioner']) {
    for (const name of ['due', 'live', 'quiet', 'casual', 'casualLocked', 'single']) {
      const m = situation(name, role);
      if (role === 'commissioner') m.commissioner = ROWS_COMM;
      const html = render(m);
      const tag = `${name}/${role}`;
      const two = m.played.length === 2;
      assert(textOf(html).includes(two || m.other.length ? 'Your sports' : 'Your sport') && countOf(html, /lo-card--join/g) === m.other.length * 1 + 0 || m.other.length === 0,
        `[2a] ${tag}: the played group is labelled "${two || m.other.length ? 'Your sports' : 'Your sport'}"`);
      assert(countOf(html, /data-lo-action="enter"/g) === m.played.length + m.glance.filter((c) => c.kind === 'due').length, `[2b] ${tag}: one enter button per played sport (${m.played.length}) plus one per due chip`);
      assert((countOf(html, /Also in this league/g) === 1) === (m.other.length > 0), `[2c] ${tag}: "Also in this league" appears iff a sport is unjoined (${m.other.length})`);
      assert((countOf(html, /Commissioner<\/h3>/g) === 1) === (role === 'commissioner'), `[2d] ${tag}: the Commissioner group is absent for a member and present for the commissioner`);
      assert(countOf(html, /data-lo-action="league-page"/g) === 1 && countOf(html, /data-lo-action="switch-league"/g) === 1, `[2e] ${tag}: the League group always carries "League page" and "Switch or join a league"`);
      assert(countOf(html, /Times are shown in your time zone\./g) === (name === 'single' ? 0 : 1), `[2f] ${tag}: the zone footnote is multi-sport only`);
      assert(countOf(html, /At a glance/g) === (m.glance.length ? 1 : 0), `[2g] ${tag}: At a glance exists only when there is a chip (${m.glance.length})`);
    }
  }
  const quiet = textOf(render(situation('quiet', 'member')));
  assert(!/live now/.test(quiet) && !/Picks due/.test(quiet) && /All games final/.test(quiet) && /Next week isn't published yet/.test(quiet), '[2h] a quiet day: no live chip, no due chip, the truthful state');
  const casual = render(situation('casual', 'member'));
  assert(/Optional/.test(casual) && /Join NFL picks/.test(casual) && !/class="btn btn-primary lo-join"[^>]* disabled/.test(casual), '[2i] a CFB-only member with NFL open: Optional, "Join NFL picks", enabled');
  const locked = render(situation('casualLocked', 'member'));
  assert(/class="btn btn-primary lo-join"[^>]* disabled aria-disabled="true"/.test(locked) && /You can join when the next NFL week opens\./.test(locked), '[2j] NFL already live: Join is DISABLED and says when (in text)');
  const single = textOf(render(situation('single', 'member')));
  assert(!/Also in this league/.test(single) && /Your sport\b/.test(single) && !/Your sports/.test(single), '[2k] one-sport league: no "Also in this league", "Your sport" singular');
  const none = render({ ...situation('single', 'member'), played: [], other: [situation('casual', 'member').other[0]] });
  assert(!/Your sport/.test(none) && /Also in this league/.test(none), '[2l] a member who plays nothing: "Your sports" is omitted, only "Also in this league"');
  const head = leagueOverviewHeaderHTML(situation('due', 'commissioner'), deps);
  assert(/<h2 class="lo-title" id="league-overview-title" tabindex="-1">IRB Football<\/h2>/.test(head) && /College Football · NFL · 6 members · Commissioner/.test(head) && /id="league-overview-close"[^>]*aria-label="Close"/.test(head),
    `[2m] header: title, "College Football · NFL · 6 members · Commissioner", a labelled Close — ${textOf(head)}`);
  assert(/1 member\b/.test(leagueOverviewHeaderHTML({ ...situation('single', 'member'), memberCount: 1 }, deps)) && !/Commissioner/.test(leagueOverviewHeaderHTML(situation('due', 'member'), deps)), '[2n] "1 member" singular; the Commissioner suffix only for the commissioner');
  assert(/6 leagues|2 leagues/.test(render(situation('due', 'member'))) && /1 league\b/.test(render({ ...situation('due', 'member'), leagueCount: 1 })), '[2o] the league-count suffix (plural and singular)');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[3] the card contract…');
{
  const html = render({ ...situation('due', 'commissioner'), commissioner: ROWS_COMM });
  assert(countOf(html, /<button type="button" class="card lo-card(?: lo-card--focus)?" data-lo-action="enter" data-sport="[a-z]+" data-tab="(?:picks|dashboard)" aria-label="[^"]+">/g) === 2, '[3a] each played sport is ONE button with data-sport, data-tab and a VoiceOver sentence');
  // nothing interactive inside a button
  const buttons = [...html.matchAll(/<button\b[\s\S]*?<\/button>/g)].map((x) => x[0]);
  assert(buttons.length > 0 && buttons.every((b) => countOf(b, /<button\b/g) === 1 && !/<(a|input|select|textarea)\b/.test(b)), `[3b] no button contains another interactive element (${buttons.length} buttons checked)`);
  // phrasing content only inside the card button: spans, no div/p/h
  const cardBtns = buttons.filter((b) => /class="card lo-card/.test(b));
  assert(cardBtns.every((b) => !/<(div|p|h[1-6]|ul|li|section|article)\b/.test(b)), '[3c] a card button holds phrasing content only (spans), as HTML requires of a <button>');
  // Join is outside any button but its own; the Join card is an <article>
  const casual = render(situation('casual', 'member'));
  assert(/<article class="card lo-card lo-card--join"/.test(casual) && countOf(casual, /<article\b/g) === 1, '[3d] the unjoined sport is an <article>, not a button into the sport');
  assert(!/<button[^>]*data-lo-action="enter"[^>]*data-sport="nfl"/.test(casual), '[3e] …and there is no way into the NFL tabs from it (the only NFL button is Join)');
  // the setup button sits BESIDE the card
  const noWeek = { ...situation('single', 'commissioner'), played: [played('cfb', SS.deriveSportCardStatus({ hasWeek: false }), T({ isCommissioner: true, canSetupWeek: true, nextWeekN: 7 }))] };
  const nw = render(noWeek);
  assert(/<div class="lo-card-wrap"><button type="button" class="card lo-card"[\s\S]*?<\/button><button type="button" class="btn btn-primary btn-block lo-setup" data-lo-action="setup" data-sport="cfb">Set up Week 7<\/button><\/div>/.test(nw),
    '[3f] "Set up Week 7" is a separate button OUTSIDE the card button (no nested interactive)');
  const nwMember = render({ ...noWeek, isCommissioner: false, played: [played('cfb', SS.deriveSportCardStatus({ hasWeek: false }), T({}))] });
  assert(!/lo-setup/.test(nwMember) && /Picks aren&#39;t open yet/.test(nwMember), '[3g] a member sees no setup button and the honest line');
  // focus
  const f = render({ ...situation('casual', 'member'), focusSport: 'nfl' });
  assert(countOf(f, /lo-card--focus/g) === 1 && /lo-card--join lo-card--focus/.test(f), '[3h] the focused sport (a link to an unjoined sport) is marked on its card');
  // pills
  assert(/<span class="badge badge-due">Picks due in 2h 10m<\/span>/.test(html) && /<span class="badge badge-open"><span class="lo-pill-ic" aria-hidden="true"><svg data-k="check"><\/svg><\/span>Submitted<\/span>/.test(html), '[3i] the due pill is the gold badge; Submitted carries a check icon (not colour alone)');
  const live = render(situation('live', 'member'));
  assert(/<span class="badge badge-live"><span class="live-dot live-dot-static" aria-hidden="true"><\/span>Live<\/span>/.test(live), '[3j] the live pill carries a STATIC dot (the card is not an animation)');
  // commissioner rows
  assert(/data-lo-action="comm-add-sport"/.test(html) && /data-lo-action="comm-manage" data-sport="cfb"/.test(html), '[3k] commissioner rows carry their action (and sport)');
  const emptyComm = render({ ...situation('due', 'commissioner'), commissioner: [] });
  assert(!/Commissioner<\/h3>/.test(emptyComm), '[3l] a commissioner with NO real destination to offer gets no Commissioner group (never a dead stub)');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[4] the Join card…');
{
  const o = (extra, status = st({ phase: 'open', totalGames: 10, canSubmit: false, submitted: true })) => other('nfl', status, NFL_T(), extra);
  let html = joinCardHTML(o(), deps);
  assert(/<button type="button" class="btn btn-primary lo-join" data-lo-action="join" data-sport="nfl">Join NFL picks<\/button>/.test(html) && !/lo-caption/.test(html), '[4a] enabled: a primary "Join NFL picks" and no caption');
  html = joinCardHTML(o({ busy: true }), deps);
  assert(/class="btn btn-primary lo-join"[^>]* disabled aria-disabled="true">Joining…<\/button>/.test(html), '[4b] in flight: "Joining…", disabled (a second tap cannot double-send)');
  html = joinCardHTML(o({ error: true }), deps);
  assert(/<p class="lo-error" role="alert">Couldn&#39;t join NFL picks\. Nothing was changed\. Try again\.<\/p>/.test(html) && /class="btn lo-retry" data-lo-action="join"/.test(html), '[4c] failure: what happened, that nothing changed, and a Retry — announced as an alert');
  html = joinCardHTML(o({}, st({ phase: 'locked', totalGames: 10, canSubmit: false })), deps);
  assert(/ disabled aria-disabled="true">Join NFL picks<\/button>/.test(html) && /<p class="lo-caption" role="status">You can join when the next NFL week opens\.<\/p>/.test(html), '[4d] locked: disabled with the reason in text, announced as status');
  const all = [joinCardHTML(o(), deps), joinCardHTML(o({}, st({ phase: 'locked', canSubmit: false })), deps), joinCardHTML(o({}, st({ hasWeek: false })), deps), joinCardHTML(o({}, st({ phase: 'final', canSubmit: false })), deps)];
  assert(all.every((h) => !/badge-due/.test(h) && !/Not submitted/.test(h) && !/late|missing|behind|overdue/i.test(textOf(h))), '[4e] across open / locked / no-week / final: never a due badge, "Not submitted", late, missing or overdue for a non-entrant');
  assert(all.every((h) => /<article\b/.test(h) && countOf(h, /<button\b/g) === 1), '[4f] each Join card holds exactly one button (Join) — Retry appears only on failure');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[5] the League Page region is the overview\'s own markup…');
{
  for (const name of ['due', 'casual', 'casualLocked', 'single']) {
    const m = situation(name, 'member');
    const body = render(m);
    const region = leaguePageSportsHTML(m, deps);
    const groupsOf = (h) => (h.match(/<section class="lo-group"[\s\S]*?<\/section>|<p class="lo-note">[\s\S]*?<\/p>/g) || []).filter((x) => /lo-lbl-(your|also)|lo-note/.test(x)).join('');
    assert(groupsOf(body) === groupsOf(region) && groupsOf(region).length > 0, `[5a] ${name}: the League Page's Sports region and the overview carry byte-identical card groups`);
    assert(!/lo-glance|lo-lbl-comm|lo-lbl-league/.test(region), `[5b] ${name}: …and none of the chips, Commissioner or League groups`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[6] C5 — hostile text escapes everywhere…');
{
  const H = '"><img src=x onerror=alert(1)>';
  const hostileT = { sportName: H, code: H, weekLabel: H, windowText: H, leftText: H, lockWhenText: H, kickoffWhenText: H, nextWeekN: H, inCountText: H };
  const cfb = st({ phase: 'open', submitted: false });
  const nfl = st({ phase: 'open', totalGames: 10, canSubmit: false, submitted: true });
  const m = { ...situation('casual', 'commissioner'), leagueName: H, sportsLine: H, memberCount: '6<script>', leagueCount: 2,
    played: [{ dbCode: 'cfb', sportName: H, glyphKey: 'sportFootball', weekLabel: H, view: SS.sportCardView(cfb, hostileT) }],
    other: [{ dbCode: 'nfl', code: H, sportName: H, glyphKey: 'sportFootball', weekLabel: H, view: SS.joinCardView(nfl, hostileT), busy: false, error: true }],
    glance: [{ kind: 'due', text: H, dbCode: H, tab: H }, { kind: 'live', text: H }],
    commissioner: [{ action: 'comm-manage', dbCode: H, title: H, subtitle: H, right: H }], focusSport: H };
  const html = leagueOverviewHeaderHTML(m, deps) + leagueOverviewBodyHTML(m, deps) + leaguePageSportsHTML(m, deps);
  // attribute NAMES per tag (values stripped first): a live handler would be an `on…` name, and a broken-out value would add a name that is not one of ours
  const tagAttrNames = (h) => [...h.matchAll(/<([a-zA-Z][\w-]*)((?:\s[^<>]*)?)>/g)].flatMap((t) => [...t[2].replace(/="[^"]*"/g, '=""').matchAll(/\s([^\s=]+)/g)].map((a) => `${t[1]}:${a[1]}`));
  const names = tagAttrNames(html);
  const allowed = /^(?:button:(?:type|class|data-[a-z-]+|aria-label|aria-hidden|id|disabled|aria-disabled|tabindex)|article:(?:class|data-sport|aria-label)|span:(?:class|aria-hidden)|p:(?:class|role|id)|div:(?:class|role|aria-label)|h2:(?:class|id|tabindex)|h3:(?:class|id)|section:(?:class|aria-labelledby)|b:|svg:.*)$/;
  assert(!html.includes(H) && !html.includes('"><img') && !/<img\b|<script\b/i.test(html) && !names.some((n) => /:on/i.test(n)), '[6a] the raw hostile string appears NOWHERE; no <img>, no <script>, no live `on…` attribute on any tag');
  assert(names.length > 40 && names.every((n) => allowed.test(n)), `[6a2] every attribute on every tag is one the module writes (${names.length} checked; a broken-out value would add an unknown name: ${names.filter((n) => !allowed.test(n)).join(', ') || 'none'})`);
  assert(html.includes('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;'), '[6b] it is present, ESCAPED');
  const attrs = [...html.matchAll(/\s(aria-label|title|data-[a-z-]+|id|class)=("([^"]*)"|'([^']*)'|([^\s>]*))/g)];
  assert(attrs.length > 20 && attrs.every((a) => a[2][0] === '"'), `[6c] every attribute value (${attrs.length} checked) is double-quoted`);
  const aria = [...html.matchAll(/aria-label="([^"]*)"/g)].map((x) => x[1]);
  assert(aria.some((a) => a.includes('&quot;&gt;')) && aria.every((a) => !/[<>]/.test(a)), '[6d] hostile text inside aria-label is escaped (the attribute cannot be broken out of)');
  assert(!/>6<script/.test(html) && !/6<script/.test(html), '[6e] a hostile member count never reaches the markup raw (numHtml)');
  // a dbCode that is hostile cannot escape its data attribute either
  assert(!/data-sport="[^"]*"[^>]*>[^<]*"><img/.test(html), '[6f] hostile data-sport / data-tab values stay inside their quotes');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[7] C3 — the overview receives no pick and no rival…');
{
  // plant rival ids, names and hidden-pick marks in every field the module does NOT read: they must not reach the markup
  const m = situation('due', 'member');
  const planted = { ...m, picks: [{ playerId: 'p9', selectedTeam: 'DET' }], rivals: ['Brayden', 'p3'], hidden: '•••', whoPicked: ['p2', 'p4'], liveGames: [{ gameId: 'g1', picks: { p2: 'GB' } }] };
  planted.played = m.played.map((c) => ({ ...c, picks: ['p9'], rivalIds: ['p3'], names: ['Brayden'], view: { ...c.view, picks: ['p9'], rivalNames: ['Kevin'] } }));
  const html = leagueOverviewBodyHTML(planted, deps) + leaguePageSportsHTML(planted, deps) + leagueOverviewHeaderHTML(planted, deps);
  assert(!/p9|p3|p2|p4|Brayden|Kevin|DET|GB|•••|g1/.test(textOf(html) + (html.match(/data-[a-z-]+="[^"]*"/g) || []).join(' ')), '[7a] planted ids, names, teams and hidden-pick marks in unread fields never reach the markup');
  const keys = new Set();
  const walk = (o) => { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { keys.add(k); walk(v); } };
  walk(situation('casual', 'commissioner'));
  assert([...keys].every((k) => !/^(picks?|selectedTeam|playerId|memberId|rivals?|names?|whoPicked|pickers?|players?)$/i.test(k)), `[7b] the model the app builds has no field for a pick, a player or a rival (${keys.size} keys)`);
  const glance = SS.glanceChips({ due: [], liveCount: 4 });
  assert(eq(glance, [{ kind: 'live', text: '4 live now' }]), '[7c] the live chip is a count and nothing else ({ liveCount } only)');
  const src = await readFile(join(HERE, 'js', 'league-overview.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert(!/[.{,(]\s*(picks?|playerId|selectedTeam|memberId|players|rivals?)\b\s*[,.}:)=\]]/.test(code) && !/\b(picks|playerId|selectedTeam|memberId)\s*=/.test(code), '[7d] the source (comments aside) never reads or names a pick, a player or a member id as a property, a binding or a parameter');
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[8] JOIN through the real app (security F2 / reviewer 10b, 2026-10-08)…');
// ═════════════════════════════════════════════════════════════════
// joinSportFromOverview() is the ONE place a member joins a sport. C1a: the deadline is re-checked AT TAP TIME over the server-CONFIRMED status, and a closed sport sends NOTHING. F2/10b: the success
// toast waits for the SERVER ("You're in NFL picks." only once the competition_members write is acknowledged); a refusal (or no answer) puts the row back and shows the inline "Couldn't join" - never a
// success toast followed by the red banner. Driven with injected `confirmedStatusOf` / `confirmWrite` stand-ins for the adapter (the real ones read sb.getConfirmedWeekStatus / sb.flushAndConfirm).
{
  const { makeEnv, withMutantApp, els } = await import('./sportenv.mjs');
  const env = await makeEnv();
  const { app, comp, st } = env;
  const toasts = [];
  els.get('toast-container').appendChild = (t) => { toasts.push(String(t && t._html)); };
  const nflId = () => comp.getCompetitions().find((c) => c.sport === 'nfl').id;
  const rowsFor = (pid) => st.getCompetitionMembers().filter((r) => r.competitionId === nflId() && r.memberId === pid);
  const reset = (o) => {
    app._clearPickDraftForTest(); for (const k of Object.keys(app._viewingBySportForTest)) delete app._viewingBySportForTest[k];
    app._joinStateForTest.joining.clear(); app._joinStateForTest.failed.clear(); toasts.length = 0;
    return env.league({ sports: ['cfb', 'nfl'], viewer: 'p2', plays: { nfl: ['p1', 'p3'] }, ...o });
  };
  const warn = console.warn; console.warn = () => {};
  const scenarios = async (m) => {
    const out = {}; const joinOf = m._joinSportFromOverviewForTest;
    reset({ weekStatus: { cfb: 'open', nfl: 'locked' } });
    out['8a stored locked: nothing sent'] = (await joinOf('nfl')) === false && rowsFor('p2').length === 0 && toasts.length === 0;
    reset({ weekStatus: { cfb: 'open', nfl: 'open' }, lockOffsetHours: -2 });
    out['8b derived-locked (stored open, every kickoff passed): nothing sent'] = (await joinOf('nfl')) === false && rowsFor('p2').length === 0;
    reset({ weekStatus: { cfb: 'open', nfl: 'open' } });
    out['8c supabase fake: the server says locked while the mirror says open: nothing sent'] = (await joinOf('nfl', { confirmedStatusOf: () => 'locked' })) === false && rowsFor('p2').length === 0;
    reset({ weekStatus: { cfb: 'open', nfl: 'open' } });
    const before = st.getCompetitionMembers().length;
    out['8d a forged sport code: nothing sent'] = (await joinOf('nhl')) === false && st.getCompetitionMembers().length === before;
    reset({ weekStatus: { cfb: 'open', nfl: 'open' } });
    let toastsWhenAsked = -1;
    const ret = await joinOf('nfl', { confirmWrite: async () => { toastsWhenAsked = toasts.length; return 'saved'; } });
    const row = rowsFor('p2')[0];
    out['8e open before the lock: ONE own row, enrolled by self'] = ret === true && rowsFor('p2').length === 1 && row.memberId === 'p2' && row.enrolledBy === 'self';
    out['8f the success toast comes AFTER the server confirms, and only then'] = toastsWhenAsked === 0 && toasts.length === 1 && /You&#39;re in NFL picks\.|You're in NFL picks\./.test(toasts[0]);
    for (const verdict of ['refused', 'pending']) {
      reset({ weekStatus: { cfb: 'open', nfl: 'open' } });
      const r = await joinOf('nfl', { confirmWrite: async () => verdict });
      out[`8g ${verdict}: no success toast, the row is put back, the card shows the inline failure`] = r === false && rowsFor('p2').length === 0 && !toasts.some((t) => /in NFL picks/.test(t)) && m._joinStateForTest.failed.has('nfl') && !m._joinStateForTest.joining.has('nfl');
    }
    reset({ weekStatus: { cfb: 'open', nfl: 'open' } });
    let release; const gate = new Promise((res) => { release = res; });
    const first = joinOf('nfl', { confirmWrite: async () => { await gate; return 'saved'; } });
    const second = await joinOf('nfl');
    release(); await first;
    out['8h a second tap while the first is in flight sends nothing'] = second === false && rowsFor('p2').length === 1;
    return out;
  };
  const real = await scenarios(app);
  for (const [k, ok] of Object.entries(real)) assert(ok === true, `[${k}]`);
  assert(Object.keys(real).length === 9, `[8-n] ${Object.keys(real).length} named checks ran (4 closed-state cases + open + toast order + refused + pending + double tap)`);
  const src = await readFile(join(HERE, 'js', 'app.js'), 'utf8');
  assert(/case 'join': runJoinTap\(sport\); break;/.test(src) && !/case 'join': joinSportFromOverview\(sport\); break;/.test(src) && /function runJoinTap\(dbCode\) \{[\s\S]{0,400}\.catch\(|async \(\) => \{\s*try \{ await joinSportFromOverview/.test(src),
    '[8i] the Join tap handles the promise: nothing is left floating (an unexpected throw is caught and shown as the inline failure)');
  // MUTANTS on in-memory copies of app.js: each must turn a NAMED check RED
  const redOn = async (label, edits, must) => {
    let res;
    try { res = await withMutantApp(edits, scenarios); } catch (e) { res = { 'the mutant could not run': false, [String(e.message).slice(0, 90)]: false }; }
    const failed = Object.entries(res).filter(([, ok]) => ok !== true).map(([n]) => n);
    assert(failed.length > 0 && must.every((m) => failed.some((f) => f.startsWith(m))), `${label} -> RED on: ${failed.slice(0, 4).join(' | ') || '(nothing - the mutant SURVIVED)'}`);
  };
  await redOn('[8-m1] the tap-time `closed` check is gone: a locked sport still receives the insert (F2)', [['  if (closed) { _joinState.failed.delete(dbCode); repaintSportCardSurfaces(); return false; }', '']], ['8a', '8b', '8c']);
  await redOn('[8-m2] the re-check reads the MIRROR, not the server-confirmed status', [['confirmedStatus: confirmedStatusOf(week) }).closed', 'confirmedStatus: week.status }).closed']], ['8c']);
  await redOn('[8-m3] the success toast fires BEFORE the server confirms', [["    addCompetitionMember({ competitionId: entry.competitionId, memberId: me, enrolledBy: 'self' });   // false = already in: still a success\n    ok = true;", "    addCompetitionMember({ competitionId: entry.competitionId, memberId: me, enrolledBy: 'self' });   // false = already in: still a success\n    showToast(`You're in ${entry.code} picks.`, 'success');\n    ok = true;"]], ['8f']);
  await redOn('[8-m4] a refused write is left in the mirror (no put-back): the member looks joined and is not', [["removeCompetitionMember({ competitionId: entry.competitionId, memberId: me });", "void 0;"]], ['8g refused', '8g pending']);
  console.warn = warn;
}

console.log('\n' + (fail ? '❌ FAILURES' : '✅ ALL PASS') + ` — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
