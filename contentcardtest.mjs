/**
 * CFB Pickems — contentcardtest.mjs (D1 Lane C, DI-660…662, DI-664…666, DI-669; 2026-10-08)
 * ==========================================================================================
 * The proof for js/content-card.js: the Home content cards (matchup, player to watch, spotlight), their caption (who wrote it, when its facts were true), the detail
 * screen's sections and actions, what may LEAVE the device ("Talk about it", the spotlight share text) and the tap dispatcher. Markup only; the computed style, the press
 * and real taps are newsrendertest.mjs [G].
 *
 *   [1] the cards: one shell (the feed card's), the kind label and icon, the honest caption (SCRIBE only when a model wrote it), stale, the closed reason pill
 *   [2] SC-N14 / C10: hostile text in every sink renders inert; every attribute double-quoted; bad input renders nothing
 *   [3] the detail (DI-669): each kind's sections in order, "isn't available right now" for a missing one, "Updated …", the actions by kind
 *   [4] what leaves the device (DI-665 / DI-666): public payload only — a planted "Your pick" reason never appears; share is spotlight-only
 *   [5] the dispatcher: an id is a request; a forged id opens nothing; Enter opens; Retry calls back; news markup is ignored
 *   [6] static: one import (icons.js), no I/O, no navigator.share
 *   [7] app.js's detail screen and its ONE action dispatcher, driven from the REAL source (extracted from js/app.js; only the effects are stubbed): paint from the card,
 *       repaint / gone / failed detail reads, the allow-list against the CURRENT row, "Talk about it" (prefill, keep a draft, "Already shared."), "Open game", "Share…"
 *       (the house pair: the native Share plugin, else copy and "Copied."; a cancel is silent), Back; and the "A year ago" detail's "SCRIBE's read" splice (DI-667)
 *   [8] the Background jobs card's new "Home cards" switch (DI-659: serverJobs.feedBuild, default off), through the card's REAL change handler extracted from js/app.js
 *
 * Mutation kit (S-3): `node contentcardtest.mjs --mutate=<name>` (in-memory copies; must go RED).
 */
// Review N2 (2026-10-14): every production caller now passes the player's zone; the cases that do not pin one read the DEVICE zone, so the suite pins the device zone to the
// league default (Pacific) and is the same under any TZ the runner uses. The zone cases (1-8d, 1-8e, 7-3d) pass their zones explicitly.
process.env.TZ = 'America/Los_Angeles';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
function assert(cond, label) { if (cond) { pass++; console.log('  ✅', label); } else { fail++; console.error('  ❌', label); } }
// a suite that THROWS part-way still prints its tally (the throw is one more failure, never a silent crash a mutation kit cannot read)
for (const ev of ['uncaughtException', 'unhandledRejection']) process.on(ev, (e) => { fail++; console.error('  ❌ the suite threw:', String((e && e.message) || e).slice(0, 200)); console.log(`\n${'═'.repeat(50)}\n❌ FAILURES — ${pass} passed, ${fail} failed`); process.exit(1); });

export const KIT_MUTANTS = {
  'cc-headline-unescaped': ['js/content-card.js', '`<h3 class="feed-card-title">${esc(head)}</h3>`', '`<h3 class="feed-card-title">${head}</h3>`'],
  'cc-caption-scribe-always': ['js/content-card.js', "  const by = item && item.synthesisStatus === 'ok' ? 'SCRIBE · from public sources' : 'From ESPN';", "  const by = 'SCRIBE · from public sources';"],
  'cc-stale-off': ['js/content-card.js', "  const stale = item && item.cardKind !== 'spotlight' && Number.isFinite(fresh) && now - fresh > CONTENT_STALE_MS;", '  const stale = false;'],
  'cc-summary-structured': ['js/content-card.js', "    const ok = item.synthesisStatus === 'ok' && str(item.summary);", '    const ok = str(item.summary);'],
  'cc-reason-open': ['js/content-card.js', "    const reason = CONTENT_REASONS.indexOf(item.reason) >= 0 ? `<span class=\"feed-card-reason\">${esc(item.reason)}</span>` : '';", "    const reason = item.reason ? `<span class=\"feed-card-reason\">${esc(item.reason)}</span>` : '';"],
  'cc-talk-has-reason': ['js/content-card.js', "  if (item && item.cardKind === 'matchup.preview') return `Matchup: ${str(c.headline, 120)}${c.kickoff ? `, ${dayLabel(c.kickoff, undefined, timeZone)}` : ''} (ESPN)`;", "  if (item && item.cardKind === 'matchup.preview') return `Matchup: ${str(c.headline, 120)}${c.kickoff ? `, ${dayLabel(c.kickoff, undefined, timeZone)}` : ''} (ESPN)${item.reason ? ` — ${item.reason}` : ''}`;"],
  'cc-share-any-kind': ['js/content-card.js', "  if (!item || item.cardKind !== 'spotlight') return '';\n  const c = item.card || {};\n  const lines", "  if (!item) return '';\n  const c = item.card || {};\n  const lines"],
  'cc-forged-id-opens': ['js/content-card.js', "    return asArray(list).find((i) => i && i.id === id) || null;", '    return asArray(list).find((i) => i && i.id === id) || asArray(list)[0] || null;'],
  'cc-open-game-always': ['js/content-card.js', "  if ((k === 'matchup.preview' || k === 'player.preview') && gameAvailable && chatAvailable) out.push", "  if ((k === 'matchup.preview' || k === 'player.preview') && chatAvailable) out.push"],
  'cc-stale-drops-author': ['js/content-card.js', "  if (stale) return { text: day ? `${by} · Last updated ${day}` : `${by} · Last updated`, stale: true };", "  if (stale) return { text: `Last updated ${day}`, stale: true };"],
  'cc-stale-6h': ['js/content-card.js', 'export const CONTENT_STALE_MS = 7 * 60 * 60 * 1000;', 'export const CONTENT_STALE_MS = 6 * 60 * 60 * 1000;'],
  'cc-zone-ignored': ['js/content-card.js', "  try { return new Date(ms).toLocaleDateString('en-US', timeZone ? { ...opts, timeZone } : opts); }", "  try { return new Date(ms).toLocaleDateString('en-US', opts); }"],
  'cc-talk-when-chat-off': ['js/content-card.js', "  if ((k === 'matchup.preview' || k === 'spotlight') && chatAvailable) out.push", "  if ((k === 'matchup.preview' || k === 'spotlight')) out.push"],
  'app-detail-drops-sources': ['js/app.js', "    const merged = row ? { ...row, sources: Array.isArray(row.sources) && row.sources.length ? row.sources : (prev && prev.row && Array.isArray(prev.row.sources) ? prev.row.sources : []) } : null;", '    const merged = row;'],
  'app-chat-off-ignored': ['js/app.js', '  const chatAvailable = isChatEnabled();\n  return { gameAvailable: chatAvailable && !!contentGameFor(row), chatAvailable };', '  return { gameAvailable: !!contentGameFor(row), chatAvailable: true };'],
  'app-feedbuild-not-pilot-locked': ['js/app.js', "    const pilotLocked = (job === 'trainer' || job === 'feedBuild') && !pilot;", "    const pilotLocked = job === 'trainer' && !pilot;"],
  'app-detail-device-zone': ['js/app.js', "  return { timeZone: (TIME_ZONES.find((z) => z.key === key) || TIME_ZONES[0]).iana, formatTime: (iso) => formatGameTime(iso, key) };", '  return { timeZone: null, formatTime: null };'],
  'cc-detail-gap-blank': ['js/content-card.js', "const unavailable = (title) => para(SECTION_UNAVAILABLE(title));", "const unavailable = () => '';"],
  // js/app.js — applied to the extracted slice [7] drives (the file on disk is never touched)
  'app-action-not-allowlisted': ['js/app.js', "  if (!row || !contentDetailActions(row, contentDetailCaps(row)).some((a) => a.id === act)) return;", '  if (!row) return;'],
  'app-talk-repeats': ['js/app.js', "m.body === line && Number(m.ts) > now - CONTENT_TALK_REPEAT_MS)) {", "m.body === line && false)) {"],
  'app-talk-drops-draft': ['js/app.js', "    input.value = draft ? `${draft} ${line}` : line;", '    input.value = line;'],
  'app-share-cancel-copies': ['js/app.js', "    catch (err) { if (/cancel|dismiss|abort/i.test(String((err && err.message) || err || ''))) return; }", '    catch (err) { /* fall through */ }'],
  'app-gone-kept': ['js/app.js', "    _contentDetail.set(id, merged ? { status: 'ready', row: merged } : { status: 'gone', row: null });", "    if (merged) _contentDetail.set(id, { status: 'ready', row: merged });"],
  'app-insight-after-actions': ['js/app.js', "  const at = r.html.lastIndexOf('<div class=\"cd-actions\">');", '  const at = -1;'],
  'app-feedbuild-unbuilt': ['js/app.js', "scribeScan: true, feedBuild: true });", 'scribeScan: true });'],
  'app-feedbuild-truthy': ['js/app.js', "      const bag = { ...(getSettings().serverJobs || {}), [job]: next };", "      const bag = { ...(getSettings().serverJobs || {}), [job]: next ? 'on' : false };"],
  'app-insight-refetch': ['js/app.js', "  let st = _yearAgoInsight.get(key);\n  if (!st) {", "  let st = null;\n  if (!st) {"],
};
const mutateArg = (process.argv.find((a) => a.startsWith('--mutate=')) || '').slice(9);
const HERE = fileURLToPath(new URL('.', import.meta.url));
const SRC = await readFile(HERE + 'js/content-card.js', 'utf8');
const APP_SRC_DISK = await readFile(HERE + 'js/app.js', 'utf8');
const MU = mutateArg ? KIT_MUTANTS[mutateArg] : null;
if (mutateArg && !MU) throw new Error('unknown mutant ' + mutateArg);
if (MU) {
  const text = MU[0] === 'js/app.js' ? APP_SRC_DISK : SRC;
  if (text.split(MU[1]).length - 1 !== 1) throw new Error(`mutant anchor must match exactly once in ${MU[0]}: ${mutateArg}`);
  console.log(`\n[MUTANT] ${mutateArg}`);
}
const APP_SRC = MU && MU[0] === 'js/app.js' ? APP_SRC_DISK.split(MU[1]).join(MU[2]) : APP_SRC_DISK;
const CC_URL = MU && MU[0] === 'js/content-card.js'
  ? 'data:text/javascript;base64,' + Buffer.from(SRC.split(MU[1]).join(MU[2]).replace(/from '\.\/([\w.-]+)'/g, (_m, f) => `from '${pathToFileURL(HERE + 'js/' + f).href}'`)).toString('base64')
  : pathToFileURL(HERE + 'js/content-card.js').href;
const CC = await import(CC_URL);

const NOW = Date.parse('2026-10-08T17:00:00.000Z');
const HOUR = 3600e3, DAY = 24 * HOUR;
const iso = (ms) => new Date(ms).toISOString();
const base = (o = {}) => ({ id: 'content_00000000-0000-4000-8000-000000000001', contentId: '00000000-0000-4000-8000-000000000001', cardKind: 'matchup.preview', sport: 'cfb', eventRef: 'espn:event:401856716',
  teamKeys: ['missouri', 'texas a and m'], publishedAt: iso(NOW - HOUR), freshAsOf: iso(NOW - HOUR), eligibleUntil: iso(NOW + DAY),
  card: { headline: 'Texas A&M at Missouri', away: { name: 'Texas A&M', record: '3-2', rank: null }, home: { name: 'Missouri', record: '4-1', rank: 14 }, kickoff: '2026-10-10T16:00:00.000Z', venue: 'Memorial Stadium', tv: ['ABC'] },
  summary: null, watch: [], talk: null,
  facts: [{ id: 'm:1:rec:142', text: 'Missouri is 4-1, 1-1 in conference (2026 season · 5 games).', source: { label: 'ESPN', publishedAt: '2026-10-08' } }, { id: 'm:1:last:142', text: "Missouri's last game: beat Florida Gators 45-17 on Oct 3.", source: { label: 'ESPN', publishedAt: '2026-10-08' } }],
  gaps: [], sources: [{ label: 'ESPN', publishedAt: '2026-10-08' }], synthesisStatus: 'structured', version: 1, reason: null, ...o });
const okCard = (o = {}) => base({ synthesisStatus: 'ok', summary: 'Missouri is 4-1 and Texas A&M is 3-2.', watch: [{ text: 'Missouri scores 37.6 a game.' }, { text: 'Texas A&M allows 18.6.' }], talk: { text: 'Which offense has been sharper?' }, ...o });
const player = (o = {}) => base({ id: 'content_00000000-0000-4000-8000-000000000002', cardKind: 'player.preview', card: { headline: 'Jordan Love', name: 'Jordan Love', team: 'Green Bay', opponent: 'Chicago', position: 'QB', label: 'Expected starter (depth chart, Oct 8)',
  seasonLine: '2026 season · 4 games: 87 of 154, 1,041 pass yards, 8 TD, 3 INT', last3Line: 'Last 3 games: 59% completions, 654 pass yards, 6 TD, 2 INT', trend: 'down', injury: null, kickoff: '2026-10-11T17:00:00.000Z' },
  facts: [{ id: 'p:9:4036378:depth', text: "Jordan Love is listed QB1 on Green Bay's depth chart (ESPN, Oct 8).", source: { label: 'ESPN depth chart', publishedAt: '2026-10-08' } }], ...o });
const spot = (o = {}) => base({ id: 'content_00000000-0000-4000-8000-000000000003', cardKind: 'spotlight', card: { headline: 'Braden Atkinson', name: 'Braden Atkinson', team: 'Oregon State', opponent: 'Colorado State', score: '56-26', result: 'won', date: '2026-10-03',
  lines: ['31/34, 427 passing yards, 5 TD, 0 INT'], why: 'Why featured: 427 passing yards in a 56-26 win. Selected under the Munera Spotlight standard v2 (QB: 400+ passing yards).', rationale: { standardVersion: '2', rule: 'QB: 400+ passing yards', rank: 1, ofCandidates: 4 } },
  freshAsOf: iso(NOW - 5 * DAY), facts: [], ...o });

console.log('\n[1] the cards');
{
  const s = CC.renderContentCard(base(), { now: NOW });
  assert(/^<article class="card feed-card feed-card--tap content-card content-card--matchup" role="button" tabindex="0" data-content-id="content_00000000-0000-4000-8000-000000000001" aria-label="Matchup: Texas A&amp;M at Missouri, as of October 8\. Opens details\.">/.test(s),
    '1-1: the feed card\'s own shell, one tap target, the spoken name "Matchup: …, as of October 8. Opens details."');
  assert(/<span class="feed-card-icon" aria-hidden="true"><svg/.test(s) && /<span class="content-card-kind">Matchup<\/span>/.test(s) && /feed-card-chev/.test(s), '1-2: one icon from the family, the kind label, the chevron');
  assert(/<h3 class="feed-card-title">Texas A&amp;M at Missouri<\/h3>/.test(s), '1-3: the deterministic headline');
  assert(/<li>Missouri is 4-1, 1-1 in conference/.test(s) && !/feed-card-body">/.test(s), '1-4: STRUCTURED: the card-level facts, and no model summary');
  const leftover = CC.renderContentCard(base({ summary: 'Leaked model text.', watch: [{ text: 'Leaked watch.' }], talk: { text: 'Leaked talk?' } }), { now: NOW });
  assert(!/Leaked/.test(leftover) && !/SCRIBE/.test(leftover), '1-4b: a STRUCTURED card never shows model text it may still carry (and never names SCRIBE)');
  assert(/<p class="feed-card-caption content-card-caption">From ESPN · as of Oct 8<\/p>/.test(s), '1-5: STRUCTURED caption: "From ESPN · as of Oct 8" (SCRIBE is not named)');
  const o = CC.renderContentCard(okCard(), { now: NOW });
  assert(/<p class="feed-card-body">Missouri is 4-1 and Texas A&amp;M is 3-2\.<\/p>/.test(o) && (o.match(/<li>/g) || []).length === 2 && /Talk about it<\/span> Which offense/.test(o), '1-6: OK: the summary, two "What to watch" lines, the "Talk about it" line');
  assert(/SCRIBE · from public sources · as of Oct 8/.test(o), '1-7: OK caption names SCRIBE (a model wrote it)');
  const stale = CC.renderContentCard(base({ freshAsOf: iso(NOW - 8 * HOUR) }), { now: NOW });
  assert(/content-card-caption--stale">From ESPN · Last updated Oct 8</.test(stale), '1-8: facts older than 7 hours: "From ESPN · Last updated …" in the muted caption, and the card still shows');
  const staleOk = CC.renderContentCard(okCard({ freshAsOf: iso(NOW - 8 * HOUR) }), { now: NOW });
  assert(/content-card-caption--stale">SCRIBE · from public sources · Last updated Oct 8</.test(staleOk), '1-8b: review N1 — a STALE model-written card still says "SCRIBE · from public sources" (going stale never drops the label)');
  const onTime = CC.renderContentCard(base({ freshAsOf: iso(NOW - 6.5 * HOUR) }), { now: NOW });
  assert(CC.CONTENT_STALE_MS === 7 * HOUR && !/--stale/.test(onTime), '1-8c: review N1 — the stale line is 7 hours, ABOVE the 6-hour refresh: a card refreshed on time (6.5 hours old) never reads stale');
  // review N2: every time in the PLAYER'S zone — the house formatter for instants, the zone for days; calendar dates never shift
  const late = base({ freshAsOf: '2026-10-08T05:30:00.000Z', card: { ...base().card, kickoff: '2026-10-10T03:30:00.000Z' } });   // 10:30 PM Pacific on Oct 7 / Oct 9
  const lateNow = Date.parse('2026-10-08T07:00:00.000Z');                                    // 90 minutes after the facts: fresh
  const pt = CC.renderContentCard(late, { now: lateNow, timeZone: 'America/Los_Angeles', formatTime: (iso2) => `FMT(${iso2})` });
  const et = CC.renderContentCard(late, { now: lateNow, timeZone: 'America/New_York' });
  assert(/From ESPN · as of Oct 7/.test(pt) && /FMT\(2026-10-10T03:30:00.000Z\)/.test(pt) && /From ESPN · as of Oct 8/.test(et),
    '1-8d: review N2 — the as-of day is the PLAYER\'s (Oct 7 in Pacific, Oct 8 in Eastern for the same instant) and the kickoff goes through the house formatter');
  const ptDetail = CC.contentDetailHTML(late, { now: lateNow, timeZone: 'America/Los_Angeles', formatTime: (iso2) => `FMT(${iso2})` });
  assert(/<p class="cd-note">Updated FMT\(2026-10-08T05:30:00.000Z\)<\/p>/.test(ptDetail), '1-8e: …and the detail\'s "Updated" line uses the same house formatter');
  const sp = CC.renderContentCard(spot(), { now: NOW });
  assert(/content-card--spotlight/.test(sp) && !/--stale/.test(sp) && /<li>31\/34, 427 passing yards/.test(sp) && /content-card-why">Why featured: 427 passing yards/.test(sp), '1-9: a spotlight: its stat lines and "Why featured", and it never reads as stale');
  assert(/<p class="content-card-sub">Oregon State vs Colorado State · 56-26 win · Oct 3<\/p>/.test(sp), '1-10: …the team, opponent, score and date');
  const pl = CC.renderContentCard(player(), { now: NOW });
  assert(/content-card--player/.test(pl) && /Green Bay · Expected starter \(depth chart, Oct 8\)/.test(pl) && /<li>2026 season · 4 games: 87 of 154/.test(pl) && /<li>Last 3 games: 59%/.test(pl), '1-11: a player: team and the qualified starter label, the season and last-3 lines');
  assert(/<span class="feed-card-reason">Your pick<\/span>/.test(CC.renderContentCard(base({ reason: 'Your pick' }))) && !/feed-card-reason/.test(CC.renderContentCard(base({ reason: 'Something else' }))), '1-12: the reason pill is the closed set only');
  assert(/<div class="card feed-card content-error" role="status"><p class="feed-card-body">Some cards couldn&#39;t load\.<\/p>/.test(CC.renderContentErrorNote()) && /data-content-retry="1">Retry</.test(CC.renderContentErrorNote()), '1-13: the calm error note: "Some cards couldn\'t load." and Retry');
}

console.log('\n[2] SC-N14 / C10: one sink, inert text, double-quoted attributes');
{
  const H = '"><img src=x onerror=y>\'<script>alert(1)</script>';
  const hostile = [
    CC.renderContentCard(okCard({ card: { ...base().card, headline: H, venue: H, tv: [H] }, summary: H, watch: [{ text: H }], talk: { text: H }, reason: 'Your pick' }), { now: NOW }),
    CC.renderContentCard(base({ facts: [{ id: 'x', text: H }] })),
    CC.renderContentCard(player({ card: { ...player().card, headline: H, team: H, label: H, seasonLine: H, last3Line: H, injury: H } })),
    CC.renderContentCard(spot({ card: { ...spot().card, headline: H, team: H, opponent: H, lines: [H], why: H } })),
    CC.contentDetailHTML(okCard({ card: { ...base().card, headline: H }, summary: H, sources: [{ label: H, publishedAt: H }], facts: [{ id: 'm:1:last:1', text: H }] }), { now: NOW }),
    CC.contentDetailHTML(spot({ card: { ...spot().card, lines: [H], why: H } }), { now: NOW }),
  ];
  assert(hostile.every((h) => h.length > 0 && !h.includes(H) && !/<img|<script|onerror=y>/.test(h)), '2-1: markup in every field (headline, venue, TV, summary, watch, talk, facts, player lines, spotlight lines, why, sources) renders as inert text, card and detail');
  // the tags only (text between tags removed), every double-quoted value emptied: what is LEFT may not hold an unquoted or single-quoted value
  const tagsOnly = (h) => h.replace(/>[^<]*</g, '><').replace(/="[^"]*"/g, '=""');
  assert(hostile.every((h) => !/=\s*'|=[^"\s>]/.test(tagsOnly(h)) && (h.match(/"/g) || []).length % 2 === 0), '2-2: every attribute value in the cards and the detail is double-quoted (and no value breaks out of its quotes)');
  for (const [label, it] of [['an unknown kind', base({ cardKind: 'team.card' })], ['an id not of the content shape', base({ id: 'news_1' })], ['no headline', base({ card: {} })], ['null', null]]) {
    assert(CC.renderContentCard(it) === '', `2-3: ${label} renders nothing`);
  }
}

console.log('\n[3] the detail (DI-669)');
{
  const d = CC.contentDetailHTML(okCard({ reason: "In this week's slate" }), { now: NOW, gameAvailable: true });
  const order = ['The matchup', 'What to watch', 'Talk about it', 'Sources'].map((t) => d.indexOf(`>${t}</h4>`));
  assert(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1])), '3-1: matchup: The matchup · What to watch · Talk about it · Sources, in order');
  assert(/cd-item-title">Missouri<\/span><span class="cd-item-sub">No\. 14 · 4-1/.test(d) && /cd-item-title">Missouri&#39;s last game: beat Florida Gators 45-17/.test(d), '3-2: the matchup lists both teams (rank, record) and the last results');
  assert(/<p class="cd-note">Updated /.test(d) && /cd-reason">In this week&#39;s slate</.test(d), '3-3: it ends with "Updated …"; the viewer\'s own reason shows on their device');
  assert(/data-content-action="talk">Talk about it</.test(d) && /data-content-action="open-game">Open game</.test(d) && !/data-content-action="share"/.test(d), '3-4: matchup actions: Talk about it, Open game (no Share)');
  const dOff = CC.contentDetailHTML(okCard(), { now: NOW, gameAvailable: true, chatAvailable: false });
  const spOff = CC.contentDetailHTML(spot(), { now: NOW, chatAvailable: false });
  assert(!/data-content-action="talk"/.test(dOff) && !/data-content-action="open-game"/.test(dOff) && /data-content-action="share">Share…</.test(spOff) && !/data-content-action="talk"/.test(spOff),
    '3-4b: review N4 — with league chat OFF the chat-bound actions (Talk about it, Open game) are not offered; Share… stays');
  const ds = CC.contentDetailHTML(base(), { now: NOW });
  assert(/What to watch isn&#39;t available right now\./.test(ds) && /Talk about it isn&#39;t available right now\./.test(ds) && !/data-content-action="open-game"/.test(ds), '3-5: a structured matchup: the missing sections SAY so; no Open game when the league has no such game');
  const dp = CC.contentDetailHTML(player({ card: { ...player().card, seasonLine: null, last3Line: null } }), { now: NOW, gameAvailable: true });
  assert(/Season stats aren&#39;t available yet\./.test(dp) && /Last 3 games isn&#39;t available right now\./.test(dp) && />Starter status<\/h4>/.test(dp) && /Expected starter \(depth chart, Oct 8\)/.test(dp) && /Why he matters isn&#39;t available right now\./.test(dp),
    '3-6: player: Season ("Season stats aren\'t available yet."), Last 3 games, Starter status with its evidence, Why he matters');
  assert(/data-content-action="open-game">Open game</.test(dp) && !/data-content-action="talk"/.test(dp), '3-7: player actions: Open game only');
  const dsp = CC.contentDetailHTML(spot(), { now: NOW });
  assert(/>Stat lines<\/h4>/.test(dsp) && />The game<\/h4>/.test(dsp) && />Why featured<\/h4>/.test(dsp) && /Ranked 1 of 4 that day under the standard\./.test(dsp), '3-8: spotlight: Stat lines · The game · Why featured (with its rank)');
  assert(/data-content-action="share">Share…</.test(dsp) && /data-content-action="talk">Talk about it</.test(dsp), '3-9: spotlight actions: Share…, Talk about it');
  assert(/This card isn&#39;t available right now\./.test(CC.contentDetailHTML(null)) && /data-content-action="back">Back to Home</.test(CC.contentDetailUnavailableHTML()), '3-10: a card that is gone: the one calm unavailable state, with Back');
}

console.log('\n[4] what leaves the device: the public payload only');
{
  const mine = base({ reason: 'Your pick' });
  const t = CC.talkLine(mine);
  assert(t === 'Matchup: Texas A&M at Missouri, Oct 10 (ESPN)' && !/pick|slate|reason/i.test(t), `4-1: "Talk about it" is deterministic and never carries the private reason ("${t}")`);
  const ts = CC.talkLine(spot({ reason: 'Your pick' }));
  assert(ts.startsWith('Spotlight: Braden Atkinson, Oregon State, 31/34, 427 passing yards, 5 TD, 0 INT vs Colorado State (ESPN, Oct 3)') && !/pick/i.test(ts), `4-2: the spotlight line is DI-666's shape ("${ts}")`);
  const sh = CC.spotlightShareText(spot({ reason: 'Your pick' }));
  assert(sh === 'Braden Atkinson, Oregon State: 31/34, 427 passing yards, 5 TD, 0 INT vs Colorado State (56-26), Oct 3. Source: ESPN box score. Munera Spotlight standard v2.', `4-3: the share text is public data only, with its source and standard ("${sh}")`);
  assert(CC.spotlightShareText(base()) === '' && CC.spotlightShareText(player()) === '', '4-4: only a spotlight can be shared (DI-665)');
  assert(!/https?:|irbfootball|league/i.test(sh), '4-5: no link into the app and no league in the shared text');
}

console.log('\n[4b] "SCRIBE\'s read" (DI-667)');
{
  assert(CC.insightSectionHTML({ status: 'loading' }) === '' && CC.insightSectionHTML(null) === '', '4b-1: while the read is loading, nothing (the record above stands)');
  const ok = CC.insightSectionHTML({ status: 'ok', read: 'Kihoon got 6 right in Week 6, 2025.\n\nThis year Kevin has 22 through Week 5.', createdAt: iso(NOW) });
  assert(/>SCRIBE&#39;s read<\/h4>/.test(ok) && /Written by SCRIBE from the league record/.test(ok) && (ok.match(/<p class="cd-sentence">/g) || []).length === 2 && /Source: CFP 2K25 league record · last updated Oct 8/.test(ok),
    '4b-2: the read, labelled "Written by SCRIBE from the league record", in its paragraphs, with its source and date');
  for (const st of [{ status: 'none' }, { status: 'error' }, { status: 'ok', read: '' }]) assert(/Analysis isn&#39;t available right now\./.test(CC.insightSectionHTML(st)), `4b-3: ${JSON.stringify(st)} -> "Analysis isn't available right now."`);
  const H = '"><img src=x onerror=y>';
  assert(!CC.insightSectionHTML({ status: 'ok', read: H, createdAt: iso(NOW) }).includes(H), '4b-4: the read is escaped at the sink');
}

console.log('\n[5] the dispatcher');
{
  const L = {};
  const root = { addEventListener(t, f) { (L[t] ||= []).push(f); }, removeEventListener() {} };
  const items = [base(), spot()];
  const opened = []; let retried = 0;
  CC.bindContentCardEvents(root, { items: () => items, onOpen: (it) => opened.push(it.id), onRetry: () => { retried++; } });
  const el = (attrs) => ({ getAttribute: (k) => (k in attrs ? attrs[k] : null) });
  const target = (map) => ({ closest: (sel) => { for (const [k, v] of Object.entries(map)) if (sel.includes(k)) return v; return null; } });
  L.click.forEach((f) => f({ target: target({ 'data-content-id': el({ 'data-content-id': items[1].id }) }) }));
  assert(opened.join() === items[1].id, '5-1: a tap resolves the card\'s id against the CURRENT items and opens that one');
  L.click.forEach((f) => f({ target: target({ 'data-content-id': el({ 'data-content-id': 'content_00000000-0000-4000-8000-0000000000ff' }) }) }));
  assert(opened.length === 1, '5-2: a forged id opens NOTHING (the DOM is a request, never an authority)');
  L.keydown.forEach((f) => f({ key: 'Enter', preventDefault() {}, target: target({ 'data-content-id': el({ 'data-content-id': items[0].id }) }) }));
  assert(opened.length === 2 && opened[1] === items[0].id, '5-3: Enter on a focused card opens it');
  L.click.forEach((f) => f({ target: target({ 'data-content-retry': el({}) }) }));
  assert(retried === 1 && opened.length === 2, '5-4: Retry on the error note calls back, and opens nothing');
  L.click.forEach((f) => f({ target: target({ 'data-news-id': el({ 'data-news-id': 'news_1' }) }) }));
  assert(opened.length === 2 && retried === 1, '5-5: a news card\'s markup is ignored (each surface keeps its own dispatcher)');
}

console.log('\n[6] static');
{
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  const imps = [...code.matchAll(/^\s*import\s+[\s\S]*?\s+from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  assert(JSON.stringify(imps) === JSON.stringify(['./icons.js']), '6-1: content-card.js imports only icons.js');
  assert(!/fetch\(|localStorage|\.rpc\(|navigator\.share|innerHTML\s*=/.test(code), '6-2: no I/O, no storage, no navigator.share, no DOM write (it returns strings)');
  const nc = await readFile(HERE + 'js/newsCard.js', 'utf8');
  const reasons = JSON.parse((/export const NEWS_CARD_REASONS = Object\.freeze\((\[[^\]]*\])\)/.exec(nc) || [])[1].replace(/'/g, '"').replace(/"In this week"s slate"/, '"In this week\'s slate"') || '[]');
  assert(CC.CONTENT_REASONS.every((r) => reasons.includes(r)), '6-3: every content reason is in newsCard\'s closed NEWS_CARD_REASONS set');
}

console.log('\n[7] app.js: the detail screen and its one action dispatcher (the REAL source, effects stubbed)');
{
  // Extract the two blocks from js/app.js by their own first and last lines (this file does not import app.js; loadtest [1d]'s technique). Everything the blocks call that
  // is NOT content-card.js is a recorded stub on H; content-card.js is the real module (or its mutant).
  const sliceFn = (src, startMark, lastFnMark) => {
    const a = src.indexOf(startMark), b = src.indexOf(lastFnMark, a), c = b > -1 ? src.indexOf('\n}\n', b) : -1;
    return a > -1 && b > a && c > b ? src.slice(a, c + 2) : null;
  };
  const detailBlock = sliceFn(APP_SRC, 'const _contentDetail = new Map();', 'async function shareContentSpotlight(');
  const yearAgoBlock = sliceFn(APP_SRC, 'const _yearAgoInsight = new Map();', 'async function loadYearAgoInsight(');
  assert(!!detailBlock && !!yearAgoBlock && /function onContentDetailClick\(/.test(detailBlock) && /function talkAboutContent\(/.test(detailBlock) && /function withYearAgoInsight\(/.test(yearAgoBlock),
    '7-0: fixture: the detail block (openContentDetail … shareContentSpotlight) and the year-ago block were extracted from js/app.js');
  const H = globalThis.__ccH = {};
  const reset = (o = {}) => Object.assign(H, { withheld: false, screens: [], haptics: [], invalidations: 0, screenOpen: true, fetchDetail: async () => null, weeks: [], games: {},
    openedGames: [], session: { playerId: 'p1' }, messages: [], toasts: [], nav: [], input: { value: '', events: [], dispatchEvent(e) { this.events.push(e.type); }, focus() {} },
    native: false, window: {}, copied: [], copyOk: true, week: { weekId: 'w6', season: 2026 }, leagueId: 'L1', insightCalls: [], fetchInsight: async () => ({ status: 'none' }), ...o });
  reset();
  const mod = await import('data:text/javascript;base64,' + Buffer.from([
    `import { CONTENT_KIND_META, contentDetailHTML, contentDetailUnavailableHTML, contentDetailActions, talkLine, spotlightShareText, insightSectionHTML } from '${CC_URL}';`,
    'const H = globalThis.__ccH;',
    'const isContentWithheld = () => H.withheld; const ensurePushedScreens = () => {}; const haptic = (k) => H.haptics.push(k);',
    'const pushScreen = (cfg) => { H.screens.push(cfg); }; const isScreenOpen = () => H.screenOpen; const invalidateScreens = () => { H.invalidations++; };',
    'const fetchContentDetail = (id) => H.fetchDetail(id); const currentWeeksToSweep = () => H.weeks; const getGames = (wid) => H.games[wid] || [];',
    'const openGameChatSheet = (gid) => { H.openedGames.push(gid); }; const getSession = () => H.session; const getChatMessages = () => H.messages;',
    'const showToast = (m, k) => { H.toasts.push([m, k]); }; const navigateTo = (t) => { H.nav.push(t); }; const requestAnimationFrame = (fn) => fn();',
    "const document = { getElementById: (id) => (id === 'chat-input' ? H.input : null) }; class Event { constructor(type) { this.type = type; } }",
    'const isNativeShell = () => H.native; const window = new Proxy({}, { get: (_t, k) => H.window[k] }); const lcCopyText = async (t) => { H.copied.push(t); return H.copyOk; };',
    'const getContextWeek = () => H.week; const getActiveLeagueId = () => H.leagueId; const fetchLeagueInsight = (a) => { H.insightCalls.push(a); return H.fetchInsight(a); };',
    "const isChatEnabled = () => H.chatOn !== false; const DEFAULT_TZ = 'PT'; const getTimezone = () => H.tz || 'PT';",
    "const TIME_ZONES = [{ key: 'PT', iana: 'America/Los_Angeles' }, { key: 'ET', iana: 'America/New_York' }]; const formatGameTime = (iso, key) => `GT(${iso}|${key})`;",
    detailBlock, yearAgoBlock,
    'export { openContentDetail, onContentDetailClick, withYearAgoInsight, _contentDetail };',
  ].join('\n')).toString('base64'));
  const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };
  const tap = (act) => ({ target: { closest: (sel) => (sel === '[data-content-action]' && act ? { getAttribute: (n) => (n === 'data-content-action' ? act : null) } : null) } });
  const apiCalls = [];
  const api = { pop: () => apiCalls.push('pop'), close: (r) => apiCalls.push('close:' + r) };
  const click = (row, act) => { apiCalls.length = 0; H.screens.at(-1).onClick(tap(act), api); };

  // open: paints at once from the card, then the detail read repaints it in place
  const m = okCard({ reason: 'Your pick' });
  let resolveDetail;
  reset({ fetchDetail: () => new Promise((r) => { resolveDetail = r; }) });
  mod.openContentDetail(m);
  const scr = H.screens[0];
  assert(!!scr && scr.id === `content:${m.contentId}` && scr.title === CC.CONTENT_KIND_META['matchup.preview'].label && scr.backLabel === 'Home' && scr.restoreKey === `news:${m.id}` && H.haptics.join() === 'light',
    '7-1: a card tap pushes ONE screen titled by its kind, Back to "Home", focus restored to the card that opened it, one light haptic');
  assert(/Texas A&amp;M at Missouri/.test(scr.render()) && /data-content-action="talk"/.test(scr.render()), '7-2: the screen paints AT ONCE from the card the feed holds (no spinner)');
  resolveDetail({ ...m, reason: null, summary: 'Missouri is 4-1 and has won three of its last four.' });
  await settle();
  assert(H.invalidations === 1 && /won three of its last four/.test(scr.render()) && /Your pick/.test(scr.render()), '7-3: the full detail repaints IN PLACE when it lands, and the reason pill is the viewer\'s own (kept from the card, never the server\'s)');
  // review B1: the detail row (feed_content_get) that carries no source list never empties the card's Sources section; one that carries its own wins
  const srcSection = (h) => ((h.match(/<section[^>]*cd-h-sources[\s\S]*?<\/section>/) || [''])[0]).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  reset({ fetchDetail: async () => ({ ...base(), sources: [], gaps: ['the series history is not in the source'] }) });
  mod.openContentDetail(base());
  await settle();
  assert(/ESPN 2026-10-08/.test(srcSection(H.screens[0].render())) && !/isn&#39;t available|isn't available/.test(srcSection(H.screens[0].render())),
    `7-3b: review B1 — a detail-shaped row with NO sources keeps the card's Sources ("${srcSection(H.screens[0].render())}")`);
  reset({ fetchDetail: async () => ({ ...base(), sources: [{ label: 'ESPN stats', publishedAt: '2026-10-09' }] }) });
  mod.openContentDetail(base());
  await settle();
  assert(/ESPN stats 2026-10-09/.test(srcSection(H.screens[0].render())) && !/ESPN 2026-10-08/.test(srcSection(H.screens[0].render())), '7-3c: …and a detail row that carries its own sources shows THOSE');
  // review N2: the detail's times are the player's zone, through the house formatter
  reset({ fetchDetail: () => new Promise(() => {}), tz: 'ET' });
  mod.openContentDetail(base());
  assert(new RegExp(`Updated GT\\(${base().freshAsOf.replace(/[.]/g, '\\.')}\\|ET\\)`).test(H.screens[0].render()), '7-3d: review N2 — the detail\'s "Updated" line is formatGameTime(…, the player\'s zone)');
  reset({ fetchDetail: async () => null });
  mod.openContentDetail(base());
  await settle();
  assert(H.screens[0].render() === CC.contentDetailUnavailableHTML(), '7-4: a card that is gone by the time the detail is read becomes the one calm unavailable state');
  reset({ fetchDetail: async () => { throw new Error('offline'); } });
  mod.openContentDetail(base());
  await settle();
  assert(/Texas A&amp;M at Missouri/.test(H.screens[0].render()) && H.invalidations === 0, '7-5: a FAILED detail read keeps the card on screen (no unavailable flash, no throw)');
  reset({ withheld: true });
  mod.openContentDetail(base());
  assert(H.screens.length === 0 && H.haptics.length === 0, '7-6: during a hold (content withheld) a tap opens nothing');

  // the dispatcher: Back, and the allow-list against the CURRENT row
  reset({ fetchDetail: () => new Promise(() => {}) });
  mod.openContentDetail(okCard());
  H.haptics.length = 0;
  click(okCard(), 'back');
  assert(apiCalls.join() === 'pop' && H.haptics.length === 0, '7-7: "Back to Home" pops the screen');
  click(okCard(), 'share');
  click(okCard(), 'delete');
  click(okCard(), 'open-game');
  click(okCard(), null);
  assert(H.haptics.length === 0 && H.copied.length === 0 && H.openedGames.length === 0 && H.toasts.length === 0 && H.nav.length === 0,
    '7-8: an action the CURRENT row does not offer does nothing at all: "share" on a matchup, a forged "delete", "open-game" with no league game, a tap off every button');

  // "Talk about it" (DI-666)
  click(okCard(), 'talk');
  const line = CC.talkLine(okCard(), { timeZone: 'America/Los_Angeles' });   // the app passes the player's zone (H.tz 'PT')
  assert(apiCalls.join() === 'close:navigate' && H.nav.join() === 'chat' && H.input.value === line && H.input.events.includes('input') && H.haptics.join() === 'light',
    '7-9: "Talk about it" closes the detail, opens Chat and PREFILLS the composer with the public line (the member sends it themselves)');
  reset({ fetchDetail: () => new Promise(() => {}) });
  mod.openContentDetail(okCard());
  H.input.value = 'wait for it';
  click(okCard(), 'talk');
  assert(H.input.value === `wait for it ${line}`, '7-10: an existing draft is KEPT; the line is added after it');
  reset({ fetchDetail: () => new Promise(() => {}), messages: [{ author: 'p1', body: line, ts: Date.now() - 60e3 }] });
  mod.openContentDetail(okCard());
  click(okCard(), 'talk');
  assert(H.toasts.length === 1 && H.toasts[0][0] === 'Already shared.' && H.nav.length === 0 && H.input.value === '', '7-11: the same line sent by this member in the last 10 minutes answers "Already shared." and opens nothing');
  reset({ fetchDetail: () => new Promise(() => {}), messages: [{ author: 'p1', body: line, ts: Date.now() - 11 * 60e3 }, { author: 'p2', body: line, ts: Date.now() - 60e3 }] });
  mod.openContentDetail(okCard());
  click(okCard(), 'talk');
  assert(H.nav.join() === 'chat' && H.toasts.length === 0, '7-12: …but not when it was longer ago than 10 minutes, or sent by someone else');

  // "Open game"
  reset({ fetchDetail: () => new Promise(() => {}), weeks: [{ weekId: 'w6' }], games: { w6: [{ gameId: 'g-other', espnEventId: '1' }, { gameId: 'g-mizzou', espnEventId: '401856716' }] } });
  mod.openContentDetail(okCard());
  click(okCard(), 'open-game');
  assert(H.openedGames.join() === 'g-mizzou', '7-13: "Open game" opens the league\'s game matched by its ESPN event id (never a guess by team name)');
  // review N4: league chat OFF — the chat-bound actions are neither drawn nor honoured
  reset({ fetchDetail: () => new Promise(() => {}), chatOn: false, weeks: [{ weekId: 'w6' }], games: { w6: [{ gameId: 'g-mizzou', espnEventId: '401856716' }] } });
  mod.openContentDetail(okCard());
  const offHtml = H.screens[0].render();
  click(okCard(), 'talk'); click(okCard(), 'open-game');
  assert(!/data-content-action="(talk|open-game)"/.test(offHtml) && H.nav.length === 0 && H.openedGames.length === 0 && H.input.value === '',
    '7-13b: review N4 — with chat OFF, "Talk about it" and "Open game" are not drawn, and a forged tap on either does nothing');

  // "Share…" (DI-665): the house pair
  const sp = spot();
  const shareText = CC.spotlightShareText(sp);
  reset({ fetchDetail: () => new Promise(() => {}) });
  mod.openContentDetail(sp);
  click(sp, 'share');
  await settle();
  assert(H.copied.join() === shareText && H.toasts.length === 1 && H.toasts[0][0] === 'Copied.', '7-14: on the web "Share…" copies the public share text and says "Copied."');
  reset({ fetchDetail: () => new Promise(() => {}), copyOk: false });
  mod.openContentDetail(sp);
  click(sp, 'share');
  await settle();
  assert(H.toasts.length === 1 && H.toasts[0][0] === "Couldn't copy automatically.", '7-15: a copy that fails says so');
  const shared = [];
  reset({ fetchDetail: () => new Promise(() => {}), native: true, window: { Capacitor: { Plugins: { Share: { share: async (o) => { shared.push(o); } } } } } });
  mod.openContentDetail(sp);
  click(sp, 'share');
  await settle();
  assert(shared.length === 1 && shared[0].text === shareText && H.copied.length === 0 && H.toasts.length === 0, '7-16: in the app "Share…" opens the native share sheet with the same text (no copy, no toast)');
  reset({ fetchDetail: () => new Promise(() => {}), native: true, window: { Capacitor: { Plugins: { Share: { share: async () => { throw new Error('Share canceled'); } } } } } });
  mod.openContentDetail(sp);
  click(sp, 'share');
  await settle();
  assert(H.copied.length === 0 && H.toasts.length === 0, '7-17: cancelling the native share sheet is silent (nothing copied, no toast)');
  reset({ fetchDetail: () => new Promise(() => {}), native: true, window: { Capacitor: { Plugins: { Share: { share: async () => { throw new Error('plugin missing'); } } } } } });
  mod.openContentDetail(sp);
  click(sp, 'share');
  await settle();
  assert(H.copied.join() === shareText && H.toasts[0] && H.toasts[0][0] === 'Copied.', '7-18: a native share that FAILS (not a cancel) falls back to copy and "Copied."');

  // "SCRIBE's read" on the "A year ago" detail (DI-667)
  const actions = '<div class="cd-actions"><button type="button">Back</button></div>';
  const yr = (type = 'year.ago', weekN = 6) => ({ model: { type, facts: { weekN } }, html: `<div class="cd"><p>record</p>${actions}</div>` });
  reset();
  assert(mod.withYearAgoInsight(yr('scribe.recap')) === yr('scribe.recap').html && H.insightCalls.length === 0, '7-19: any other card\'s detail is returned unchanged, and asks for nothing');
  let resolveInsight;
  reset({ fetchInsight: () => new Promise((r) => { resolveInsight = r; }) });
  const first = mod.withYearAgoInsight(yr());
  assert(first === yr().html && H.insightCalls.length === 1 && H.insightCalls[0].leagueId === 'L1' && H.insightCalls[0].weekRef === '2026:cfb:6',
    '7-20: the year-ago detail asks ONCE for this league\'s callback for its week (2026:cfb:6) and paints without a section while it loads (no spinner)');
  resolveInsight({ status: 'ok', read: 'Week 6 of 2025 went to Kihoon.', createdAt: '2026-10-08T10:15:00Z' });
  await settle();
  const second = mod.withYearAgoInsight(yr());
  const at = second.indexOf("SCRIBE&#39;s read") >= 0 ? second.indexOf("SCRIBE&#39;s read") : second.indexOf("SCRIBE's read");
  assert(H.invalidations === 1 && at > 0 && at < second.indexOf('<div class="cd-actions">') && /Week 6 of 2025 went to Kihoon\./.test(second) && H.insightCalls.length === 1,
    '7-21: when it lands the detail repaints in place with "SCRIBE\'s read" BEFORE the actions, and asks nothing again');
  reset({ leagueId: 'L2', fetchInsight: async () => { throw new Error('not_member'); } });
  mod.withYearAgoInsight(yr(undefined, 7));
  await settle();
  assert(/Analysis isn(&#39;|')t available right now\./.test(mod.withYearAgoInsight(yr(undefined, 7))), '7-22: a failed read (including not_member) is the one calm "Analysis isn\'t available right now."');
  reset({ leagueId: null });
  assert(mod.withYearAgoInsight(yr()) === yr().html && H.insightCalls.length === 0, '7-23: with no active league nothing is asked and the detail is unchanged');
}

console.log('\n[8] the "Home cards" switch on the Background jobs card (the REAL change handler)');
{
  const grab = (src, start, endMark) => { const a = src.indexOf(start), b = a > -1 ? src.indexOf(endMark, a) : -1; return a > -1 && b > a ? src.slice(a, b + endMark.length) : null; };
  const labels = grab(APP_SRC, 'const SERVER_JOB_LABELS = Object.freeze({', '\n});');
  const built = grab(APP_SRC, 'const SERVER_JOB_BUILT = Object.freeze({', '});');
  const warn = grab(APP_SRC, 'const SERVER_JOB_ON_WARNING = Object.freeze({', '\n});');
  const handler = grab(APP_SRC, "document.querySelectorAll('.server-job-toggle').forEach((el) => {", 'renderCommPage();\n    });\n  });');
  assert(!!labels && !!built && !!warn && !!handler, '8-0: fixture: the labels, the built list, the on-warnings and the switch\'s change handler were extracted from js/app.js');
  const S = globalThis.__ccS = { listeners: [], saved: [], toasts: [], renders: 0, confirms: [], settings: { serverJobs: { reminders: true } } };
  const mod = await import('data:text/javascript;base64,' + Buffer.from([
    'const S = globalThis.__ccS;',
    "const el = { dataset: { job: 'feedBuild' }, checked: false, addEventListener: (t, f) => S.listeners.push([t, f]) }; S.el = el;",
    'const document = { querySelectorAll: (sel) => (sel === ".server-job-toggle" ? [el] : []) };',
    'const getSettings = () => S.settings; const saveSetting = (k, v) => { S.saved.push([k, v]); S.settings = { ...S.settings, [k]: v }; };',
    'const showToast = (m, k) => { S.toasts.push([m, k]); }; const renderCommPage = () => { S.renders++; }; const confirm = (m) => { S.confirms.push(m); return true; };',
    labels, built, warn,
    'export function bind() {', handler, '}',
    'export { SERVER_JOB_LABELS, SERVER_JOB_BUILT, SERVER_JOB_ON_WARNING };',
  ].join('\n')).toString('base64'));
  assert(mod.SERVER_JOB_BUILT.feedBuild === true && mod.SERVER_JOB_LABELS.feedBuild === 'Home cards (matchups, players, spotlights)',
    '8-1: the switch exists, is labelled "Home cards (matchups, players, spotlights)" and is BUILT (a live switch, not a disabled row)');
  mod.bind();
  const onChange = (S.listeners.find(([t]) => t === 'change') || [])[1];
  S.el.checked = true;
  onChange();
  const jobs = (S.saved.find(([k]) => k === 'serverJobs') || [])[1];
  const flipped = (S.saved.find(([k]) => k === 'serverJobsFlippedAt') || [])[1];
  assert(!!jobs && jobs.feedBuild === true && jobs.reminders === true && !!flipped && /^\d{4}-\d\d-\d\dT/.test(flipped.feedBuild || ''),
    '8-2: turning it ON writes serverJobs.feedBuild EXACTLY true (the server\'s feed_build_due compares to the JSON true) beside the other jobs, and stamps when it flipped');
  assert(S.toasts.length === 1 && S.toasts[0][0] === '✅ Enabled Home cards (matchups, players, spotlights)' && S.renders === 1, '8-3: one toast names the switch, and the card repaints');
  // review N6: the switch is pilot-locked exactly like trainer (the real predicate line from the card renderer)
  const lockLine = (APP_SRC.match(/\n\s*const pilotLocked = [^\n]*\n/) || [''])[0];
  const lockFor = new Function('job', 'pilot', `${lockLine.replace(/\/\/.*$/, '')}; return pilotLocked;`);
  assert(/const pilotLocked = /.test(lockLine) && lockFor('feedBuild', false) === true && lockFor('feedBuild', true) === false && lockFor('trainer', false) === true && lockFor('reminders', false) === false,
    '8-5: review N6 — on a non-pilot league the Home cards switch is LOCKED (as trainer is: "only available to the pilot league"); the pilot league gets the live switch');
  S.el.checked = false; S.saved.length = 0;
  onChange();
  assert(((S.saved.find(([k]) => k === 'serverJobs') || [])[1] || {}).feedBuild === false, '8-4: turning it OFF writes false (the next tick makes zero calls)');
}

console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
