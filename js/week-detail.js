/**
 * CFB Pickems — week-detail.js (Deployment 1, Lane B, DI-594 / DI-596 / PF-453, PF-454, 2026-10-08)
 * ===============================================================================================
 * "Week {N}": what happened in one finished (or under-way) week of one competition - the result, the week's standings, and every game with its score, who covered, how the league
 * split and the viewer's own pick. A leaf module: pure, no storage, no DOM, no clock of its own. js/app.js assembles a PACK for the week (or, for a pooled multi-part group, for
 * every member week of it) from the SAME readers Weekly History and the Dashboard use, and this file turns it into a MODEL of plain text and, separately, the markup
 * (`weekDetailHTML`) with every dynamic string escaped at the sink.
 *
 * ── THE RULES THIS MODULE LIVES BY ────────────────────────────────────────────────────────────────────────────────────────────────────────────
 *   ONE COMPETITION (DI-594). A week belongs to one competition; its players are that week's ENTRANTS (`pack.players`), its picks are narrowed to them by the caller (security A3).
 *           Nothing here adds two sports' weeks together; the title carries the sport only where the league runs several.
 *   BLIND   Only a PUBLIC week has a detail at all (`pack.isPublic(week)`; anything else returns null = the calm unavailable state, so a screen held open while a week changes
 *           stops showing content the gate no longer allows). The league's SPLIT on a game is a COUNT per side (never a name) and is shown only when the S-C10 flag says the
 *           other members' rows have landed (`pack.picksRead(weekId)`); the viewer's own pick is always theirs to see. No other member's selection is ever put in the model.
 *           NOT ENTERED (pass 3, R2 / D1, DI-591 S2/C7): on a part the viewer was not an entrant of (another sport; a late joiner's week from before they joined) a signed-in member sees no chip of
 *           their own - never "No pick" - and no per-side split; the part's games, scores, covers and the week's standings still show (`pack.viewerParts`).
 *           A signed-out viewer has no personal chip. Nothing is called "covered", "won" or "lost" before its game is FINAL (js/game-state.js; live is ▲ covering / ▽ trailing).
 *   ONE RENDER PATH. The winner, the loser and the tie-break lines are Weekly History's own (`pack.winner`, `pack.loser`, `pack.tieLines`); the week's standings rows are the
 *           Dashboard's own finished fragment (`pack.standingsHtml`, `renderScoreSummaryRowsHTML`), SPLICED, never rebuilt here. A pooled group is "final" only when EVERY part is
 *           (UN-118/UN-125); until then the standings are replaced by one sentence and no winner is named.
 *   MISSING DATA IS VISIBLE. A final week with no result rows says so; it is never given a made-up winner or a 0-0.
 *
 * pack = { weekId, title, sport:{ label, code }|null, members:[week records, in order], finalParts, status:'final'|'in-progress', winner, loser, tieLines:[text], standingsHtml, standingsPending,
 *          players, games, picks, viewerId|null, viewerParts:[weekId] (the member weeks the viewer was an ENTRANT of; absent = none), isPublic(week), picksRead(weekId), liveEntryFor(gameId), now, formatKickoff(iso), threadCount(gameId) -> number|null (null = chat is off: no button), threadLoaded(gameId) -> bool (false = older than what this device has loaded: a bare "Thread"), canShare:bool (the app offers Share to chat) }
 */

import { gameStateOf, isLivePhase, coverWord } from './game-state.js';
import { calculateAtsWinner, evaluatePick } from './scoring.js';
import { atsMarginOf, sortWeeks } from './stats.js';
import { requireEscHtml } from './feed-cards.js';
import { icon } from './icons.js';
// D1 Lane B / DI-597: the share reference's one gate and the one-line headline (pure; js/chat-share.js)
import { validShareRef, shareLine, SHARE_COPY } from './chat-share.js';

export const WEEK_DETAIL_COPY = Object.freeze({
  unavailableTitle: "This week isn't available right now.",
  unavailableBody: 'It may have been updated, or it may not be open to everyone yet.',
  unavailableButton: 'Back',                       // N1 (pass 3): "Back to {the screen it returns to}" whenever that screen is named (unavailableBackText)
  noResults: "Results for this week aren't available.",
  noGames: 'No games are listed for this week.',
  standingsPending: "The week's standings appear once everyone's picks have loaded.",
  // Standings' own sentence, word for word (js/app.js renderLeaderboard; pinned equal by historywiringtest): the winner's record above is RAW, the table's counts carry each game's multiplier.
  footnote: 'Picks count each game’s multiplier. Win % counts every pick once.',
});
const STANDINGS_PENDING = WEEK_DETAIL_COPY.standingsPending;

const asArray = (v) => (Array.isArray(v) ? v : []);
const isId = (v) => typeof v === 'string' && v.length > 0;
const nz = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const joined = (parts) => parts.join('');
const toMs = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? t : 0; };

/** Weekly History's RAW pair (what the weekly update prints): correctCount, else the pre-multiplier correctPicks - never the weighted tally (CONVENTIONS #22). */
function rawRecord(row) {
  if (!row) return '';
  const w = row.correctCount ?? row.correctPicks ?? 0, l = row.incorrectCount ?? row.incorrectPicks ?? 0;
  return `${nz(w)}–${nz(l)}`;
}

/** The viewer's own pick on a game as a display facts object, live tentative and final settled (the card detail's rule). */
function ownMark(game, pick, phase) {
  if (!pick) return null;
  const team = String(pick.selectedTeam ?? '');
  if (phase === 'final') {
    const r = evaluatePick(pick, game);
    if (r === 'win') return { team, mark: '✓', word: 'covered', tone: 'win' };
    if (r === 'loss') return { team, mark: '✗', word: 'missed', tone: 'loss' };
    if (r === 'no_decision') return { team, mark: '—', word: 'push', tone: 'push' };
    return { team, mark: '', word: '', tone: '' };
  }
  if (isLivePhase(phase)) {
    let who = null;
    try { who = calculateAtsWinner({ ...game, status: 'final' }); } catch { who = null; }
    if (who && who !== 'no_decision') return who === team ? { team, mark: '▲', word: coverWord(phase, true), tone: 'covering' } : { team, mark: '▽', word: coverWord(phase, false), tone: 'trailing' };
  }
  return { team, mark: '', word: '', tone: '' };
}

/**
 * The model of the week screen, or null when it cannot be shown (the week is not public, or has vanished).
 * `state`: 'final' | 'in-progress' | 'no-results'.
 */
export function buildWeekDetail(pack) {
  if (!pack || typeof pack !== 'object') return null;
  const members = sortWeeks(asArray(pack.members));
  if (!members.length) return null;
  const open = (w) => { try { return pack.isPublic(w) === true; } catch { return false; } };
  const shown = members.filter(open);                                              // THE GATE: a part that is not public contributes nothing, not even its games
  if (!shown.length) return null;
  const viewerId = isId(pack.viewerId) ? pack.viewerId : null;
  // R2 (DI-599 / PF-455 acceptance 2) and D1 (DI-591 S2/C7), pass 3: the viewer is PERSONAL on a part only if they were one of its entrants (`pack.viewerParts`, per part: a late joiner's pre-join part is not
  // theirs). Elsewhere a signed-in member gets no chip - never "No pick" - and no per-side split. A pack that does not say is read as "no part" (fail closed). A signed-out viewer (S4) keeps the split.
  const viewerParts = new Set(asArray(pack.viewerParts).filter(isId));
  const personalOn = (w) => viewerId !== null && viewerParts.has(w.weekId);
  const now = Number.isFinite(Number(pack.now)) ? Number(pack.now) : Date.now();
  const sport = pack.sport && typeof pack.sport === 'object' && pack.sport.code ? { label: String(pack.sport.label || ''), code: String(pack.sport.code) } : null;
  const finalCount = Math.max(0, Math.min(members.length, Math.trunc(nz(pack.finalParts))));   // how many parts are final: the APP counts them (the server-confirmed status, N2; this module keeps no status gate - consumertest)
  const allFinal = finalCount === members.length;

  let state = 'in-progress';
  if (allFinal && pack.status !== 'in-progress') state = (pack.winner || pack.loser) ? 'final' : 'no-results';

  const result = {
    status: state === 'in-progress' ? 'In progress' : 'Final',
    winner: state === 'final' && pack.winner ? { name: String(pack.winner.displayName || ''), record: rawRecord(pack.winner) } : null,
    loser: state === 'final' && pack.loser ? { name: String(pack.loser.displayName || ''), record: rawRecord(pack.loser) } : null,
    tie: state === 'final' ? asArray(pack.tieLines).filter(isId) : [],
  };
  const progress = state === 'in-progress'
    ? (members.length > 1 ? `Results post when every part is final. ${finalCount} of ${members.length} parts are final.` : 'Results post when the week is final.')
    : '';

  const games = [];
  const gameRows = (w, partLabel) => {
    const picksRead = (() => { try { return pack.picksRead(w.weekId) === true; } catch { return false; } })();
    const wkGames = asArray(pack.games).filter(g => g && g.weekId === w.weekId).sort((a, b) => (toMs(a.kickoff) - toMs(b.kickoff)) || String(a.gameId).localeCompare(String(b.gameId)));
    for (const g of wkGames) {
      const st = gameStateOf(g, { liveEntry: typeof pack.liveEntryFor === 'function' ? pack.liveEntryFor(g.gameId) : null, now, formatKickoff: typeof pack.formatKickoff === 'function' ? pack.formatKickoff : (iso) => String(iso ?? '') });
      const picks = asArray(pack.picks).filter(p => p && p.weekId === w.weekId && p.gameId === g.gameId);
      const mineOn = personalOn(w);
      let split = null;
      if (picksRead && (viewerId === null || mineOn)) {                              // D1: no per-side count for a signed-in member who was not an entrant of this part
        const away = picks.filter(p => p.selectedTeam === g.awayTeam).length, home = picks.filter(p => p.selectedTeam === g.homeTeam).length;
        if (away + home > 0) split = { text: `${away}–${home}`, spoken: `${away} picked ${g.awayTeam}, ${home} picked ${g.homeTeam}` };
      }
      let cover = '';
      if (st.phase === 'final') {
        let who = null;
        try { who = g.atsWinner ?? calculateAtsWinner(g); } catch { who = null; }
        const margin = atsMarginOf(g);
        if (who === 'no_decision') cover = 'Push';
        else if (who && margin !== null) cover = `${who} covered by ${Number(margin.toFixed(1))}`;
      }
      const score = st.score ? `${g.awayTeam} ${st.score.away} – ${g.homeTeam} ${st.score.home}` : '';
      const tc = typeof pack.threadCount === 'function' ? pack.threadCount(g.gameId) : null;
      const chatOn = tc !== null && tc !== undefined;
      const loaded = chatOn && (typeof pack.threadLoaded !== 'function' || pack.threadLoaded(g.gameId) !== false);   // review B1: a game older than what the device has loaded has no honest count
      games.push({
        gameId: g.gameId, weekId: w.weekId, part: partLabel, matchup: `${g.awayTeam} at ${g.homeTeam}`, phase: st.phase, status: st.phase === 'final' ? 'Final' : (st.label || ''),
        score, cover, split, mine: mineOn ? (ownMark(g, picks.find(p => p.playerId === viewerId) || null, st.phase) || { team: '', mark: '', word: 'no pick', tone: 'none' }) : null,
        threads: loaded ? nz(tc) : null, threadBare: chatOn && !loaded,
      });
    }
  };
  shown.forEach((w) => gameRows(w, members.length > 1 ? `Part ${members.indexOf(w) + 1}` : ''));

  // DI-597: "Share to chat" - the week's reference (any member week of a pooled group opens the group; the first part is the stable name) and the allow-listed headline: the title and a fixed phrase for the
  // state. No winner, no loser, no figure: those are what the reader's OWN re-gated screen shows. Offered only where the app says the viewer may share.
  let share = null;
  if (pack.canShare === true) {
    const ref = validShareRef({ type: 'week', id: String(members[0].weekId || '') });
    if (ref) {
      const eyebrow = String(pack.title || 'Week');
      const title = state === 'final' ? 'Final results' : state === 'in-progress' ? 'In progress' : 'Results';
      share = { ref, eyebrow, title, gameTag: '', line: shareLine({ eyebrow, title }) };
    }
  }
  return {
    state, title: String(pack.title || 'Week'), sport, weekId: String(pack.weekId || ''), result, progress, share,
    standingsHtml: state === 'final' && typeof pack.standingsHtml === 'string' ? pack.standingsHtml : '',
    // a final week whose standings cannot be drawn YET (other members' rows have not landed): said plainly, never a half-built table (DI-596: missing data is visible)
    standingsNote: state === 'final' && !pack.standingsHtml && pack.standingsPending === true ? STANDINGS_PENDING : '',
    // B3 (review): wherever a record and a rank share the screen (the winner's raw record + the standings table), the raw-versus-weighted sentence goes with them
    footnote: state === 'final' && typeof pack.standingsHtml === 'string' && pack.standingsHtml ? WEEK_DETAIL_COPY.footnote : '',
    games, pooled: members.length > 1,
  };
}

// ═══ the markup (every dynamic string escaped HERE, at the sink; `escHtml` is REQUIRED) ═════════════════════════════════════════════════════════

/** The screen's body (the pushed screen supplies the navigation bar). Pure string building; the standings fragment is a finished piece from outside and is SPLICED. */
export function weekDetailHTML(model, { escHtml, backLabel = '' } = {}) {
  const esc = requireEscHtml(escHtml, 'weekDetailHTML');
  if (!model || typeof model !== 'object') return unavailableWeekDetailHTML({ escHtml, backLabel });
  const m = model;
  const who = (label, p) => (p ? `<div class="cd-row"><dt>${esc(label)}</dt><dd>${esc(p.name)}${p.record ? ` (${esc(p.record)})` : ''}</dd></div>` : '');
  const resultBody = m.state === 'final'
    ? joined([`<dl class="cd-rows">`, who('Winner', m.result.winner), who('Loser', m.result.loser), '</dl>', joined(m.result.tie.map(t => `<p class="cd-fresh">${esc(t)}</p>`))])
    : m.state === 'no-results'
      ? `<p class="cd-sentence">${esc(WEEK_DETAIL_COPY.noResults)}</p>`
      : `<p class="cd-sentence">${esc(m.progress)}</p>`;
  const sportChip = m.sport ? `<span class="cd-sport">${esc(m.sport.code)}</span>` : '';
  const head = joined([
    '<section class="card cd-card wd-card wd-result" aria-label="Result">',
    `<div class="cd-eyebrow">${sportChip}<span class="cd-reason">${esc(m.result.status)}</span></div>`,
    resultBody,
    '</section>',
  ]);
  const table = m.standingsHtml ? joined([
    '<section class="card cd-card wd-card cd-table" aria-labelledby="wd-h-standings"><h4 class="cd-h" id="wd-h-standings">Standings for the week</h4>',
    '<table class="leaderboard-table"><thead><tr><th>#</th><th>Player</th><th>✅</th><th>❌</th><th>Tiebreaker</th></tr></thead><tbody>',
    m.standingsHtml,
    '</tbody></table>',
    m.footnote ? `<p class="cd-fresh wd-foot">${esc(m.footnote)}</p>` : '',
    '</section>',
  ]) : '';

  const pending = m.standingsNote ? `<section class="card cd-card wd-card" role="status"><p class="cd-sentence">${esc(m.standingsNote)}</p></section>` : '';
  const gameItem = (g) => {
    const mine = g.mine && g.mine.tone !== 'none' ? `<span class="hx-pick"><span class="hx-who">Your pick</span> ${esc(g.mine.team)} <span class="hx-mark hx-mark--${esc(g.mine.tone)}">${esc(g.mine.mark)}</span></span>`
      : (g.mine ? '<span class="hx-pick"><span class="hx-who">No pick</span></span>' : '');
    const spoken = [g.matchup, g.part, g.score, g.cover, g.split ? `League split ${g.split.spoken}` : '', g.mine ? (g.mine.tone === 'none' ? 'You made no pick' : `You picked ${g.mine.team}${g.mine.word ? `, ${g.mine.word}` : ''}`) : '', 'Opens the game'].filter(Boolean).join('. ');
    const thread = g.threadBare ? `<button type="button" class="hx-thread" data-wd-action="open-thread" data-wd-game="${esc(g.gameId)}" aria-label="${esc(`Thread, ${g.matchup}`)}">Thread</button>`
      : g.threads === null ? '' : `<button type="button" class="hx-thread" data-wd-action="open-thread" data-wd-game="${esc(g.gameId)}" aria-label="${esc(`Thread, ${g.threads} ${g.threads === 1 ? 'message' : 'messages'}, ${g.matchup}`)}">Thread · ${esc(String(g.threads))}</button>`;
    return joined([
      `<li class="hx-item" data-key="${esc(g.gameId)}">`,
      `<button type="button" class="hx-open" data-wd-action="open-game" data-wd-game="${esc(g.gameId)}" aria-label="${esc(spoken)}">`,
      `<span class="hx-main"><span class="hx-title">${esc(g.matchup)}</span>`,
      g.score ? `<span class="hx-sub">${esc(g.score)}${g.phase === 'final' ? '' : ` · ${esc(g.status)}`}</span>` : `<span class="hx-sub">${esc(g.status)}</span>`,
      g.cover ? `<span class="hx-sub hx-cover">${esc(g.cover)}</span>` : '',
      '</span>',
      // (pass 3, polish) a row with neither the split nor a chip - a non-entrant's (D1 / R2) - draws no empty column: an empty flex item would add the row's 8 pt gap under the cover line
      (g.split || mine) ? joined(['<span class="hx-picks" aria-hidden="true">', g.split ? `<span class="hx-pick"><span class="hx-who">Split</span> ${esc(g.split.text)}</span>` : '', mine, '</span>']) : '',
      '</button>',
      thread,
      '</li>',
    ]);
  };
  const groupBlock = (part, rows) => {
    const items = joined(rows.map((g) => gameItem(g)));
    return joined([part ? `<h5 class="wd-part">${esc(part)}</h5>` : '', `<ul class="hx-items">${items}</ul>`]);
  };
  const parts = [];
  for (const g of m.games) {
    const last = parts[parts.length - 1];
    if (last && last.part === g.part) last.rows.push(g); else parts.push({ part: g.part, rows: [g] });
  }
  const gamesCard = joined([
    '<section class="card cd-card wd-card wd-games" aria-labelledby="wd-h-games"><h4 class="cd-h" id="wd-h-games">Games</h4>',
    parts.length ? joined(parts.map(p => groupBlock(p.part, p.rows))) : `<p class="cd-sentence">${esc(WEEK_DETAIL_COPY.noGames)}</p>`,
    '</section>',
  ]);
  // DI-597: the one action - Share to chat (secondary, 44 pt, the share glyph from the one icon family); only when the model carries a share.
  const share = m.share ? `<div class="cd-actions"><button type="button" class="btn cd-action cd-action--secondary" data-wd-action="share"><span class="cd-action-icon" aria-hidden="true">${icon('share')}</span>${esc(SHARE_COPY.button)}</button></div>` : '';
  return `<div class="cd wd" data-wd-state="${esc(m.state)}">${joined([head, table, pending, gamesCard, share])}</div>`;
}

/** N1 (pass 3): the unavailable state's button names the screen Back returns to, in the navigation bar's own words ("Back to Home"); a plain "Back" when it is not told which. Plain text: escaped at the sink. */
export function unavailableBackText(backLabel) {
  const label = typeof backLabel === 'string' ? backLabel.trim() : '';
  return label ? `Back to ${label}` : WEEK_DETAIL_COPY.unavailableButton;
}

/** The one calm state for a week that cannot be shown (what happened, why, what to do next). Back also works, and the button says where it goes (`backLabel`, N1). */
export function unavailableWeekDetailHTML({ escHtml, backLabel = '' } = {}) {
  const esc = requireEscHtml(escHtml, 'unavailableWeekDetailHTML');
  return `<div class="cd cd--unavailable wd"><section class="card cd-card cd-unav" role="status"><h3 class="cd-title">${esc(WEEK_DETAIL_COPY.unavailableTitle)}</h3><p class="cd-body">${esc(WEEK_DETAIL_COPY.unavailableBody)}</p><div class="cd-actions"><button type="button" class="btn cd-action cd-action--primary" data-wd-action="back">${esc(unavailableBackText(backLabel))}</button></div></section></div>`;
}
