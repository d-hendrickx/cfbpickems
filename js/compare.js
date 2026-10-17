/**
 * CFB Pickems — compare.js (Deployment 1, Lane B, DI-594 / DI-595 / PF-453, 2026-10-08)
 * =====================================================================================
 * "You vs {name}": how two members' picks and seasons compare, inside ONE competition. A leaf module — pure, no storage, no DOM, no clock of its own. js/app.js assembles a
 * competition's data PACK (the members who played it, its weeks, games, picks, results and Standings' own rows, plus the three gates it must be asked through) and hands it
 * here; this file builds a MODEL of plain text and, separately, the markup (`comparisonHTML`, `rivalPickerBodyHTML`) with every dynamic string escaped at the sink.
 *
 * ── THE RULES THIS MODULE LIVES BY ────────────────────────────────────────────────────────────────────────────────────────────────────────────
 *   DI-594  ONE COMPETITION. Every figure comes from `pack`, which is one competition's data and nothing else: no sum, no average, no rank across sports, no second competition's
 *           games in the same denominator. Every figure names its denominator in words ("Through Week 5", "24 finished games", "Games you both picked: 8"). A member counts for a
 *           week only if the week's ENTRANTS include them (`pack.entrantsOf(week)`); a week they were not in is not a 0-0, it is not in their denominator (and a late joiner's note says
 *           how many weeks they entered). Switching sport (a segmented control, only when BOTH members play BOTH) swaps the whole screen; it never adds a column.
 *   BLIND   Other members' picks are read ONLY through `headToHeadRecord`'s REQUIRED `isPublic(week)` (here: `pack.isPublic(week) && pack.picksRead(week.weekId)` - the server's
 *           reveal AND the S-C10 "their rows have landed" check) and only for the two members being compared. An Open or Locked week contributes nothing, whatever the rows hold; a
 *           comparison opened before any week is revealed shows the no-games state. The Season card reads Standings' own rows and the S-C2 revealed view (public AND server-final).
 *           Demo weeks and weeks hidden from history are excluded (UN-71). No tiebreaker value appears anywhere (CONVENTIONS #23).
 *   TWO TALLIES, said once. The Season card's Picks is the WEIGHTED pair that drives rank (`totalCorrect-totalIncorrect`), Win % counts every pick once (RAW), Weeks is the group-collapsed
 *           weekly record: the numbers are Standings' (`pack.standings`, from seasonStandingsRows), never recomputed here (CONVENTIONS #21). The card carries the sentence
 *           "Picks count each game’s multiplier. Win % counts every pick once." (Standings' own words, js/app.js renderLeaderboard - pinned equal by historywiringtest)
 *   TWO REVEAL TIERS, each labelled. Head to head uses finished games in REVEALED weeks (current inside a live week); Season uses FINALIZED weeks. The header says which weeks
 *           it covers, and so does the Season card.
 *
 * pack = { competitionId, sport:{ label, code }|null (null in a one-sport league), players, weeks, allWeeks, games, picks, weeklyResults, standings,
 *          entrantsOf(week) -> players[], isPublic(week) -> bool, picksRead(weekId) -> bool, confirmedStatusFor(week) -> status|null, tieContexts, threadCount(gameId) -> number|null (null = chat is off: no button), canShare:bool (the app offers Share to chat), threadLoaded(gameId) -> bool (false = the game is older than what this device has loaded: a bare "Thread", no number) }
 *   `picks` are already narrowed to each week's entrants by the caller (security A3: a non-entrant's pick ROW counts for nothing).
 */

import { headToHeadRecord, memberSeasonStats, sortWeeks } from './stats.js';
import { buildRevealedView, ordinal, requireEscHtml } from './feed-cards.js';
import { icon } from './icons.js';
// D1 Lane B / DI-597: the share reference's one gate and the one-line headline (pure; js/chat-share.js)
import { validShareRef, shareLine, SHARE_COPY } from './chat-share.js';

export const COMPARE_COPY = Object.freeze({
  noGames: 'No finished games to compare yet. Head-to-head fills in as games finish.',
  noSeason: 'No finalized weeks yet. The season figures fill in once a week is final.',
  agreedAll: 'You agreed on every game you both picked.',
  footnote: 'Picks count each game’s multiplier. Win % counts every pick once.',
  unavailableTitle: "This comparison isn't available right now.",
  unavailableBody: 'It may have been updated, or you may not be signed in.',
  // Pass 3 (coordinator, 2026-10-14): the TRUE reason for a signed-in reader who is not entered in the comparison's sport (R1) - never "you may not be signed in" to someone who is
  unavailableBodyNotEntered: "You're not entered in {sport} picks, so it isn't shown to you.",
  unavailableBodyNotEnteredAny: "You're not entered in this sport, so it isn't shown to you.",
  unavailableButton: 'Back',                       // N1 (pass 3): "Back to {the screen it returns to}" whenever that screen is named (unavailableBackText)
  pickerTitle: 'Compare with',
  pickerNone: 'No one else has joined yet, so there is nobody to compare with.',
  showFewer: 'Show fewer',
});

/** The first rows the "Games you split on" card shows before "Show all". */
export const SPLIT_PREVIEW = 10;

/**
 * DI-597: a shared comparison's reference id. `compare` refs name TWO members (the sharer's side first) and, in a league that runs several sports, the competition: `{a}:{b}` or `{a}:{b}:{competition}`.
 * Each part is a plain id token; anything else is not a comparison (a reader treats null as "not available"). The READER rebuilds the screen from its OWN data and the same gates - the ids are only a request.
 */
const SHARE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export function compareShareId({ aId, bId, competitionId = null } = {}) {
  const parts = [aId, bId, ...(competitionId ? [competitionId] : [])];
  if (!parts.every((x) => typeof x === 'string' && SHARE_TOKEN.test(x)) || aId === bId) return null;
  return parts.join(':');
}
export function parseCompareShareId(id) {
  if (typeof id !== 'string') return null;
  const t = id.split(':');
  if ((t.length !== 2 && t.length !== 3) || !t.every((x) => SHARE_TOKEN.test(x)) || t[0] === t[1]) return null;
  return { aId: t[0], bId: t[1], competitionId: t.length === 3 ? t[2] : null };
}

const asArray = (v) => (Array.isArray(v) ? v : []);
const isId = (v) => typeof v === 'string' && v.length > 0;
const nz = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const nameOf = (players, id) => { const p = asArray(players).find(x => x && x.playerId === id); return p && p.displayName ? String(p.displayName) : ''; };
const joined = (parts) => parts.join('');

/** A week that may appear in any comparison: not a demo week (UN-71), not hidden from history (Standings' own rule). A DRAFT is removed by the app when it assembles the pack (it reads the stored status; this
 *  module keeps no status gate of its own - consumertest) and could not pass the reveal gate in any case. */
function countsInHistory(w) {
  return !!w && w.dataSourceMode !== 'demo' && w.showInHistory !== false;
}

/** "Week 4" - a number when there is one, else the stored label. */
function weekWord(w) {
  if (!w) return '';
  const n = Number(w.weekNumber);
  return Number.isFinite(n) && n > 0 ? `Week ${n}` : String(w.label || 'Week');
}

const RESULT_MARK = Object.freeze({
  win: { mark: '✓', word: 'covered', tone: 'win' },
  loss: { mark: '✗', word: 'missed', tone: 'loss' },
  no_decision: { mark: '—', word: 'push', tone: 'push' },
});
const markFor = (result) => RESULT_MARK[result] || { mark: '', word: 'not graded', tone: '' };

/**
 * The members the viewer may compare with: everyone ELSE who played this competition, in roster order. `current` marks the present rival.
 * @returns {Array<{playerId:string, name:string, current:boolean}>}
 */
export function rivalChoices({ players = [], viewerId = null, rivalId = null } = {}) {
  return asArray(players)
    .filter(p => p && isId(p.playerId) && p.playerId !== viewerId)
    .map(p => ({ playerId: p.playerId, name: String(p.displayName || 'Member'), current: p.playerId === rivalId }));
}

/**
 * The model of the comparison screen, or null when it cannot be shown at all (no signed-in viewer, the same person twice, a rival who is not a member).
 * `state` says what the body is: 'ok' | 'no-games' | 'viewer-not-entered' | 'rival-not-entered'.
 *
 * @param {object} pack          see the module header
 * @param {{viewerId:string, rivalId:string, competitions?:Array<{id:string, code:string, label:string}>}} who
 *        competitions - the sports BOTH members play (>= 2 shows the sport control); [] in a one-sport league
 */
export function buildComparison(pack, { viewerId = null, rivalId = null, rivalName: givenRivalName = '', viewerName: givenViewerName = '', competitions = [], neutral = false } = {}) {
  if (!pack || typeof pack !== 'object') return null;
  if (!isId(viewerId) || !isId(rivalId) || viewerId === rivalId) return null;
  const everyone = asArray(pack.players);
  const rivalIn = everyone.some(p => p && p.playerId === rivalId);
  const rivalName = nameOf(everyone, rivalId) || String(givenRivalName || '');
  const viewerName = nameOf(everyone, viewerId) || String(givenViewerName || '');
  const sport = pack.sport && typeof pack.sport === 'object' ? { competitionId: pack.competitionId ?? null, label: String(pack.sport.label || ''), code: String(pack.sport.code || '') } : null;
  const controls = asArray(competitions).length >= 2
    ? asArray(competitions).map(c => ({ id: String(c.id), code: String(c.code || c.label || ''), label: String(c.label || c.code || ''), selected: c.id === pack.competitionId }))
    : [];
  const aWord = neutral ? (viewerName || 'A member') : 'You';   // DI-597: a shared comparison read by a THIRD member names both sides
const base = { state: 'ok', perspective: neutral ? 'third' : 'self', sport, controls, viewer: { id: viewerId, name: viewerName || 'You' }, rival: { id: rivalId, name: rivalName }, title: `${aWord} vs ${rivalName || 'a member'}` };

  const where = sport && sport.label ? sport.label : 'this competition';
  const viewerIn = everyone.some(p => p && p.playerId === viewerId);
  if (!viewerIn) return { ...base, state: 'viewer-not-entered', sentence: `${neutral ? `${aWord} isn't` : "You aren't"} entered in ${where}, so there's nothing to compare.` };
  if (!rivalName) return null;                                                    // not a member of the league at all: nothing to say about them
  if (!rivalIn) return { ...base, state: 'rival-not-entered', sentence: `${rivalName} isn't entered in ${where}, so there's nothing to compare.` };

  const weeks = sortWeeks(asArray(pack.weeks)).filter(countsInHistory);
  const entered = (w, id) => { let list = []; try { list = asArray(pack.entrantsOf(w)); } catch { list = []; } return list.some(p => p && p.playerId === id); };
  // A week counts for the PAIR only if both were entrants of it (DI-594: a week they were not in is not in their denominator).
  const bothIn = weeks.filter(w => entered(w, viewerId) && entered(w, rivalId));
  const gate = (w) => pack.isPublic(w) === true && pack.picksRead(w.weekId) === true;     // THE reveal: the server's, plus "their rows have landed" (S-C10)
  const h2h = headToHeadRecord(viewerId, rivalId, { weeks: bothIn, games: asArray(pack.games), picks: asArray(pack.picks), isPublic: gate });

  // ── Season: Standings' own rows, and the revealed-view stats the table does not carry ──
  const view = buildRevealedView({ weeks, games: pack.games, picks: pack.picks, weeklyResults: pack.weeklyResults, confirmedStatusFor: pack.confirmedStatusFor, includeDemo: false });
  const stat = (id) => memberSeasonStats(id, { players: everyone, revealedWeeks: view.revealedWeeks, revealedGames: view.revealedGames, revealedPicks: view.revealedPicks, revealedWeeklyResults: view.revealedWeeklyResults, allWeeks: asArray(pack.allWeeks), tieContexts: pack.tieContexts instanceof Map ? pack.tieContexts : null });
  const finalized = sortWeeks(view.revealedWeeks);
  const rows = asArray(pack.standings);
  const mine = rows.find(r => r && r.playerId === viewerId) || null;
  const theirs = rows.find(r => r && r.playerId === rivalId) || null;
  const sMine = stat(viewerId), sTheirs = stat(rivalId);
  const rank = (r) => (r ? `${ordinal(r.currentRank)} of ${rows.length}` : '—');
  const pct = (r) => (r ? `${nz(r.winPct)}%` : '—');
  const picks = (r) => (r ? `${nz(r.totalCorrect)}–${nz(r.totalIncorrect)}` : '—');
  const weeksWL = (r) => (r ? `${nz(r.weeklyWins)}–${nz(r.weeklyLosses)}` : '—');
  const best = (s) => (s.bestWeek ? `Week ${s.bestWeek.weekN}, ${nz(s.bestWeek.wins)}–${nz(s.bestWeek.losses)}` : '—');
  const streak = (s) => (s.currentStreak && s.currentStreak.state === 'active' ? `${nz(s.currentStreak.run)} ${s.currentStreak.kind === 'misses' ? 'misses' : 'covers'}` : '—');
  const lastFinal = finalized.length ? finalized[finalized.length - 1] : null;
  const seasonRows = finalized.length ? [
    { key: 'rank', label: 'Rank', you: rank(mine), rival: rank(theirs) },
    { key: 'winpct', label: 'Win %', you: pct(mine), rival: pct(theirs) },
    { key: 'picks', label: 'Picks', you: picks(mine), rival: picks(theirs) },
    { key: 'weeks', label: 'Weeks', you: weeksWL(mine), rival: weeksWL(theirs) },
    { key: 'best', label: 'Best week', you: best(sMine), rival: best(sTheirs) },
    { key: 'streak', label: 'Current streak', you: streak(sMine), rival: streak(sTheirs) },
    { key: 'upsets', label: 'Upsets called', you: String(nz(sMine.upsetsCalled)), rival: String(nz(sTheirs.upsetsCalled)) },
  ] : [];
  // Weeks entered (DI-594's denominator in words): said only for a member who missed a finalized week of this sport.
  const enteredCount = (id) => finalized.filter(w => entered(w, id)).length;
  const notes = [];
  for (const [id, nm] of [[viewerId, aWord], [rivalId, rivalName]]) {
    const e = enteredCount(id);
    if (finalized.length && e < finalized.length) notes.push(`${nm} ${nm === 'You' ? 'were' : 'was'} entered in ${e} of ${finalized.length} finalized weeks.`);
  }

  // ── the games they split on, newest first ──
  const gameById = new Map(asArray(pack.games).map(g => [g.gameId, g]));
  const weekById = new Map(weeks.map(w => [w.weekId, w]));
  const splits = h2h.splits.map(s => {
    const g = gameById.get(s.gameId) || {};
    const w = weekById.get(s.weekId);
    const tc = typeof pack.threadCount === 'function' ? pack.threadCount(s.gameId) : null;
    const chatOn = tc !== null && tc !== undefined;
    const loaded = chatOn && (typeof pack.threadLoaded !== 'function' || pack.threadLoaded(s.gameId) !== false);   // review B1: a game older than what the device has loaded has no honest count
    return { gameId: s.gameId, weekId: s.weekId, matchup: `${g.awayTeam ?? ''} at ${g.homeTeam ?? ''}`, weekText: weekWord(w),
      you: { team: s.aTeam, ...markFor(s.aResult) }, rival: { team: s.bTeam, ...markFor(s.bResult) }, threads: loaded ? nz(tc) : null, threadBare: chatOn && !loaded };
  });

  const through = h2h.through;
  const model = {
    ...base,
    state: h2h.gamesCompared === 0 ? 'no-games' : 'ok',
    header: { text: through ? `Through ${weekWord(through)} · ${h2h.finished} finished ${h2h.finished === 1 ? 'game' : 'games'}` : 'No finished games yet' },
    h2h: { compared: h2h.gamesCompared, agreed: h2h.agreed, split: h2h.gamesCompared - h2h.agreed, youCovered: h2h.aRightBWrong, rivalCovered: h2h.bRightAWrong, bothRight: h2h.bothRight, bothWrong: h2h.bothWrong },
    season: { rows: seasonRows, header: lastFinal ? `Through ${weekWord(lastFinal)} · ${finalized.length} finalized ${finalized.length === 1 ? 'week' : 'weeks'}` : '', notes, footnote: COMPARE_COPY.footnote },
    splits,
    share: null,
  };
  // DI-597: "Share to chat" - the reference and the allow-listed headline (two names, the sport, a fixed phrase; never a pick, a figure or a tiebreaker). Offered only where the app says the viewer may share,
  // and only for a comparison that HAS games to show. The reader rebuilds the screen from their own data; nothing here travels but the two member ids (and the sport).
  if (pack.canShare === true && model.state === 'ok' && viewerName && rivalName) {
    const sid = compareShareId({ aId: viewerId, bId: rivalId, competitionId: sport ? (pack.competitionId ?? null) : null });
    const ref = sid ? validShareRef({ type: 'compare', id: sid }) : null;
    if (ref) {
      const eyebrow = [sport && sport.code ? sport.code : '', `${viewerName} vs ${rivalName}`].filter(Boolean).join(' · ');
      const title = 'Head to head and season';
      model.share = { ref, eyebrow, title, gameTag: '', line: shareLine({ eyebrow, title }) };
    }
  }
  return model;
}

// ═══ the markup (every dynamic string escaped HERE, at the sink; `escHtml` is REQUIRED) ═════════════════════════════════════════════════════════

/** The comparison's body (the pushed screen supplies the navigation bar). Pure string building. */
export function comparisonHTML(model, { escHtml, backLabel = '' } = {}) {
  const esc = requireEscHtml(escHtml, 'comparisonHTML');
  if (!model || typeof model !== 'object') return unavailableComparisonHTML({ escHtml, backLabel });
  const m = model;
  if (m.state === 'viewer-not-entered' || m.state === 'rival-not-entered') {
    return `<div class="cd cmp" data-cmp-state="${esc(m.state)}"><section class="card cd-card cmp-card"><p class="cd-sentence">${esc(m.sentence)}</p></section></div>`;
  }
  const control = m.controls.length ? joined([
    '<div class="cmp-seg" role="radiogroup" aria-label="Sport">',
    joined(m.controls.map(c => `<button type="button" class="cmp-seg-btn${c.selected ? ' is-on' : ''}" role="radio" aria-checked="${c.selected ? 'true' : 'false'}" aria-label="${esc(c.label)}" data-cmp-action="sport" data-cmp-sport="${esc(c.id)}">${esc(c.code)}</button>`)),
    '</div>',
  ]) : '';
  const sportChip = m.sport && m.sport.code && !m.controls.length ? `<div class="cd-eyebrow"><span class="cd-sport">${esc(m.sport.code)}</span></div>` : '';
  const head = joined([
    '<section class="card cd-card cmp-card cmp-head" aria-label="Summary">',
    sportChip,
    control,
    `<h3 class="cd-title cmp-through">${esc(m.header.text)}</h3>`,
    '</section>',
  ]);

  const h = m.h2h;
  const third = m.perspective === 'third';
  const youName = third ? m.viewer.name : 'You', they = third ? 'they' : 'you', rivalName = m.rival.name;   // a shared comparison read by a third member names both sides (DI-597)
  const barTotal = h.youCovered + h.rivalCovered;
  // One block per game they split on (no inline style, no width arithmetic): the blocks share the bar's width equally, so the two runs ARE the proportion.
  const runOf = (n, one) => joined(Array.from({ length: Math.max(0, n) }, () => one));
  const youRun = runOf(h.youCovered, '<i class="cmp-bar-a"></i>'), rivalRun = runOf(h.rivalCovered, '<i class="cmp-bar-b"></i>');
  const bar = barTotal > 0 ? joined([
    '<div class="cmp-split-wrap">',
    `<span class="cmp-split-n" aria-hidden="true">${esc(String(h.youCovered))}</span>`,
    `<span class="cmp-bar" role="img" aria-label="${esc(`${youName} covered ${h.youCovered}, ${rivalName} covered ${h.rivalCovered}, of the games ${they} split on`)}">${youRun}${rivalRun}</span>`,
    `<span class="cmp-split-n" aria-hidden="true">${esc(String(h.rivalCovered))}</span>`,
    '</div>',
    `<div class="cmp-split-names" aria-hidden="true"><span>${esc(youName)}</span><span>${esc(rivalName)}</span></div>`,
  ]) : '';
  const agreedAllText = third ? `${youName} and ${rivalName} agreed on every game they both picked.` : COMPARE_COPY.agreedAll;
  const h2hBody = h.compared === 0
    ? `<p class="cd-sentence">${esc(COMPARE_COPY.noGames)}</p>`
    : joined([
      `<p class="cd-sentence">Games ${they} both picked: <b class="cmp-n">${esc(String(h.compared))}</b></p>`,
      h.split === 0
        ? `<p class="cd-sentence">${esc(agreedAllText)}</p>`
        : joined([
          `<p class="cd-sentence">${esc(third ? 'They' : 'You')} agreed on <b class="cmp-n">${esc(String(h.agreed))}</b> · split on <b class="cmp-n">${esc(String(h.split))}</b></p>`,
          `<p class="cd-sentence">When ${they} split: ${esc(third ? youName : 'you')} covered <b class="cmp-n">${esc(String(h.youCovered))}</b>, ${esc(rivalName)} covered <b class="cmp-n">${esc(String(h.rivalCovered))}</b></p>`,
          bar,
        ]),
    ]);
  const h2hCard = `<section class="card cd-card cmp-card cmp-h2h" aria-labelledby="cmp-h-h2h"><h4 class="cd-h" id="cmp-h-h2h">Head to head</h4>${h2hBody}</section>`;

  const seasonBody = m.season.rows.length ? joined([
    `<p class="cd-fresh">${esc(m.season.header)}</p>`,
    '<div class="cmp-grid">',
    `<div class="cmp-gridrow cmp-gridhead" aria-hidden="true"><span class="cmp-lab"></span><span class="cmp-val">${esc(youName)}</span><span class="cmp-val">${esc(rivalName)}</span></div>`,
    joined(m.season.rows.map(r => `<div class="cmp-gridrow" role="group" aria-label="${esc(`${r.label}, ${third ? youName : 'you'} ${r.you}, ${rivalName} ${r.rival}`)}" data-cmp-row="${esc(r.key)}"><span class="cmp-lab" aria-hidden="true">${esc(r.label)}</span><span class="cmp-val" aria-hidden="true">${esc(r.you)}</span><span class="cmp-val" aria-hidden="true">${esc(r.rival)}</span></div>`)),
    '</div>',
    joined(m.season.notes.map(n => `<p class="cd-fresh">${esc(n)}</p>`)),
    `<p class="cd-fresh cmp-foot">${esc(m.season.footnote)}</p>`,
  ]) : `<p class="cd-sentence">${esc(COMPARE_COPY.noSeason)}</p>`;
  const seasonCard = `<section class="card cd-card cmp-card cmp-season" aria-labelledby="cmp-h-season"><h4 class="cd-h" id="cmp-h-season">Season</h4>${seasonBody}</section>`;

  const splitItem = (s, i) => {
    const label = `${s.matchup}, ${s.weekText}. ${youName} ${s.you.team} ${s.you.word}, ${rivalName} ${s.rival.team} ${s.rival.word}. Opens the game`;
    const thread = s.threadBare ? `<button type="button" class="hx-thread" data-cmp-action="open-thread" data-cmp-game="${esc(s.gameId)}" aria-label="${esc(`Thread, ${s.matchup}`)}">Thread</button>`
      : s.threads === null ? '' : `<button type="button" class="hx-thread" data-cmp-action="open-thread" data-cmp-game="${esc(s.gameId)}" aria-label="${esc(`Thread, ${s.threads} ${s.threads === 1 ? 'message' : 'messages'}, ${s.matchup}`)}">Thread · ${esc(String(s.threads))}</button>`;
    return joined([
      `<li class="hx-item${i >= SPLIT_PREVIEW ? ' hx-item--extra' : ''}" data-key="${esc(s.gameId)}">`,
      `<button type="button" class="hx-open" data-cmp-action="open-game" data-cmp-game="${esc(s.gameId)}" aria-label="${esc(label)}">`,
      `<span class="hx-main"><span class="hx-title">${esc(s.matchup)}</span><span class="hx-sub">${esc(s.weekText)}</span></span>`,
      '<span class="hx-picks" aria-hidden="true">',
      `<span class="hx-pick"><span class="hx-who">${esc(youName)}</span> ${esc(s.you.team)} <span class="hx-mark hx-mark--${esc(s.you.tone)}">${esc(s.you.mark)}</span></span>`,
      `<span class="hx-pick"><span class="hx-who">${esc(rivalName)}</span> ${esc(s.rival.team)} <span class="hx-mark hx-mark--${esc(s.rival.tone)}">${esc(s.rival.mark)}</span></span>`,
      '</span>',
      '</button>',
      thread,
      '</li>',
    ]);
  };
  const more = m.splits.length > SPLIT_PREVIEW ? `<button type="button" class="btn cd-more" data-cmp-action="show-all" aria-expanded="false">Show all ${esc(String(m.splits.length))}</button>` : '';
  const splitRows = joined(m.splits.map((s, i) => splitItem(s, i)));
  const splitCard = m.splits.length ? joined([
    '<section class="card cd-card cmp-card cmp-splits" data-cmp-list data-expanded="false" aria-labelledby="cmp-h-splits">',
    `<h4 class="cd-h" id="cmp-h-splits">Games ${they} split on</h4>`,
    `<ul class="hx-items">${splitRows}</ul>`,
    more,
    '</section>',
  ]) : '';

  // DI-597: the one action - Share to chat (secondary, 44 pt, the share glyph from the one icon family). It exists only when the model carries a share (the app offered it and the comparison has games).
  const share = m.share ? `<div class="cd-actions"><button type="button" class="btn cd-action cd-action--secondary" data-cmp-action="share"><span class="cd-action-icon" aria-hidden="true">${icon('share')}</span>${esc(SHARE_COPY.button)}</button></div>` : '';
  return `<div class="cd cmp" data-cmp-state="${esc(m.state)}">${joined([head, h2hCard, seasonCard, splitCard, share])}</div>`;
}

/** N1 (pass 3): the unavailable state's button names the screen Back returns to, in the navigation bar's own words ("Back to Chat"); a plain "Back" when it is not told which. Plain text: escaped at the sink. */
export function unavailableBackText(backLabel) {
  const label = typeof backLabel === 'string' ? backLabel.trim() : '';
  return label ? `Back to ${label}` : COMPARE_COPY.unavailableButton;
}

/**
 * The one calm state for a comparison that cannot be shown (DI-595: what happened, WHY, what to do next). Back also works, and the button says where it goes (`backLabel`, N1). `notEnteredIn` (pass 3): the
 * reader is signed in but not entered in the comparison's sport - a string (the sport's code, '' when it is not known) says so in plain words; absent, the body is the general one (updated, or signed out).
 */
export function unavailableComparisonHTML({ escHtml, backLabel = '', notEnteredIn = null } = {}) {
  const esc = requireEscHtml(escHtml, 'unavailableComparisonHTML');
  const sport = typeof notEnteredIn === 'string' ? notEnteredIn.trim() : null;
  const body = sport === null ? COMPARE_COPY.unavailableBody : sport ? COMPARE_COPY.unavailableBodyNotEntered.replace('{sport}', sport) : COMPARE_COPY.unavailableBodyNotEnteredAny;
  return `<div class="cd cd--unavailable cmp"><section class="card cd-card cd-unav" role="status"><h3 class="cd-title">${esc(COMPARE_COPY.unavailableTitle)}</h3><p class="cd-body">${esc(body)}</p><div class="cd-actions"><button type="button" class="btn cd-action cd-action--primary" data-cmp-action="back">${esc(unavailableBackText(backLabel))}</button></div></section></div>`;
}

/** The rival picker sheet's list: ≥ 44 pt rows, a check on the present rival. `choices` come from `rivalChoices()`. */
export function rivalPickerBodyHTML({ choices = [], sportLabel = '' } = {}, { escHtml } = {}) {
  const esc = requireEscHtml(escHtml, 'rivalPickerBodyHTML');
  const list = asArray(choices);
  if (!list.length) return `<p class="cmp-picker-empty">${esc(COMPARE_COPY.pickerNone)}</p>`;
  const intro = sportLabel ? `<p class="cmp-picker-sub">${esc(sportLabel)}</p>` : '';
  const rows = joined(list.map(c => `<li><button type="button" class="cmp-pick-row${c.current ? ' is-current' : ''}" data-cmp-action="pick-rival" data-cmp-rival="${esc(c.playerId)}" aria-pressed="${c.current ? 'true' : 'false'}"><span class="cmp-pick-name">${esc(c.name)}</span>${c.current ? `<span class="cmp-pick-check" aria-hidden="true">${icon('check')}</span><span class="sr-only">Current</span>` : ''}</button></li>`));
  return `${intro}<ul class="cmp-picks-list" aria-label="${esc(COMPARE_COPY.pickerTitle)}">${rows}</ul>`;
}
