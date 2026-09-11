/**
 * CFB Pickems — Recap & Summary (v0.16.0)
 * ========================================
 * Two picks-page sections rendered BELOW the games list:
 *   1. renderPrevWeekRecapHTML(currentWeek)  — analysis of the most recent
 *      FINALIZED week before this one (winner, records, lone-wolf covers,
 *      unanimous busts, tiebreaker, Extra Point, standings movement).
 *   2. renderSeasonSummaryHTML(currentWeek)  — shown on Week 1 (no prior
 *      finalized week in the current season): summarizes the PRIOR season from
 *      whatever finalized data exists, plus a commissioner-editable blurb
 *      (settings.seasonRecapText) for lore the data can't compute (CFP 2K25).
 *
 * Pure read-side: computes from storage; no writes.
 */

import {
  getWeeks, getPlayers, getWeeklyResults, getGames, getPicks, getSettings,
} from './storage.js';
import { calculateSeasonStandings, calculateAtsWinner } from './scoring.js';
import { formatWeekLabel } from './data-model.js';
import { gradeWeekExtraPoint } from './extra-point.js';
import { SEASON_2025, season2025Nets } from './history-2025.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Chronological order of two week records within one season.
 *
 * RG — fb_1788306484896_1owwx (2026-09-01). This used to be a bare
 * `a.weekNumber - b.weekNumber`, which treats `weekNumber` as a TOTAL order
 * over a season's weeks. It never was one: `weekNumber` is the CFB week a
 * slate belongs to, and a single CFB week routinely needs more than one week
 * RECORD because one lock time can't cover it (Aug 29–30 and the Thu–Labor
 * Day Sep 3–7 games are both "Week 1"). `createWeek()` has shipped
 * same-weekNumber siblings as a supported shape since v0.17.7 —
 * `formatWeekGroupLabel()` in data-model.js explicitly handles "two parts
 * both left roundLabel blank, same weekNumber".
 *
 * With a tie, `weekNumber < weekNumber` is false in BOTH directions, so
 * Part 1 was invisible to Part 2's recap lookup and the picks page fell
 * through to the Week-1-only Permanent Record card. Ordering falls back to
 * `startDate`, then `createdAt` — both ISO strings, so lexicographic
 * comparison IS chronological comparison and no Date parsing (or timezone,
 * RG-38) is involved. `weekNumber` still dominates, so every week whose
 * numbers differ orders exactly as it did before.
 *
 * Deliberately group-agnostic: it says nothing about `groupId`. Whether a
 * grouped Part 2 should recap its own Part 1 or skip to the previous GROUP is
 * the open design question in DEVELOPMENT_LEDGER §6, and is not settled here.
 */
function compareWeekOrder(a, b) {
  const an = Number(a?.weekNumber ?? 0), bn = Number(b?.weekNumber ?? 0);
  if (an !== bn) return an - bn;
  const ad = String(a?.startDate || ''), bd = String(b?.startDate || '');
  if (ad !== bd) return ad < bd ? -1 : 1;
  const ac = String(a?.createdAt || ''), bc = String(b?.createdAt || '');
  if (ac !== bc) return ac < bc ? -1 : 1;
  return 0;
}

/** Most recent finalized, history-visible week strictly before `week` (same season first). */
export function findPreviousFinalizedWeek(week) {
  const weeks = getWeeks().filter(w =>
    w.status === 'final' && w.showInHistory !== false && w.weekId !== week?.weekId &&
    w.dataSourceMode !== 'demo');   // demo data never drives a recap (v0.17.0)
  if (!weeks.length) return null;
  const sameSeason = weeks
    .filter(w => w.season === week?.season && (week ? compareWeekOrder(w, week) < 0 : true))
    .sort((a, b) => compareWeekOrder(b, a));
  return sameSeason[0] || null;
}

/** Storyline extraction for one finalized week. */
export function buildWeekStorylines(week) {
  const players = getPlayers().filter(p => p.active !== false);
  const results = getWeeklyResults(week.weekId);
  const games = getGames(week.weekId);
  const picks = getPicks(week.weekId);
  if (!results.length) return null;

  const nameOf = id => players.find(p => p.playerId === id)?.displayName || id;
  const ranked = [...results].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  const winner = ranked[0];
  const loser = ranked[ranked.length - 1];

  // Per-game analysis: lone wolves + unanimous busts
  const loneWolves = [];
  const unanimousBusts = [];
  for (const g of games) {
    const ats = g.atsWinner ?? calculateAtsWinner(g);
    if (!ats || ats === 'no_decision') continue;
    const gp = picks.filter(p => p.gameId === g.gameId);
    if (gp.length < 2) continue;
    const right = gp.filter(p => p.selectedTeam === ats);
    if (right.length === 1 && gp.length >= 4) {
      loneWolves.push({ name: nameOf(right[0].playerId), team: ats, matchup: `${g.awayTeam} @ ${g.homeTeam}` });
    }
    if (right.length === 0 && gp.length >= 4) {
      const side = gp[0].selectedTeam;
      if (gp.every(p => p.selectedTeam === side)) {
        unanimousBusts.push({ team: side, matchup: `${g.awayTeam} @ ${g.homeTeam}` });
      }
    }
  }

  const ep = gradeWeekExtraPoint(week, players);

  return { week, players, results: ranked, winner, loser, loneWolves, unanimousBusts,
           nameOf, extraPoint: ep, tiebreakerActual: week.actualTiebreakerValue };
}

export function renderPrevWeekRecapHTML(currentWeek) {
  const prev = findPreviousFinalizedWeek(currentWeek);
  if (!prev) return '';
  return renderWeekRecapCardHTML(prev);
}

/** SCRIBE weekly recap card for one finalized week (also used by the
 *  read-only historical picks view). */
export function renderWeekRecapCardHTML(prev) {
  const s = buildWeekStorylines(prev);
  if (!s) return '';

  const lines = [];
  lines.push(`<div class="recap-line recap-winner">🏆 <strong>${esc(s.nameOf(s.winner.playerId))}</strong> took ${esc(formatWeekLabel(prev))} — ${s.winner.correctPicks ?? s.winner.points ?? '?'} correct${s.winner.wonTiebreaker ? ' (won on the tiebreaker)' : ''}.</div>`);
  if (s.loser && s.loser.playerId !== s.winner.playerId) {
    lines.push(`<div class="recap-line">🥶 <strong>${esc(s.nameOf(s.loser.playerId))}</strong> brought up the rear.</div>`);
  }
  s.loneWolves.slice(0, 2).forEach(lw => {
    lines.push(`<div class="recap-line">🐺 Lone wolf: <strong>${esc(lw.name)}</strong> stood alone on ${esc(lw.team)} (${esc(lw.matchup)}) — and covered.</div>`);
  });
  s.unanimousBusts.slice(0, 2).forEach(ub => {
    lines.push(`<div class="recap-line">💀 Unanimous bust: everyone took ${esc(ub.team)} (${esc(ub.matchup)}). Everyone was wrong.</div>`);
  });
  if (s.tiebreakerActual != null) {
    lines.push(`<div class="recap-line">🎯 Tiebreaker actual: <strong>${esc(s.tiebreakerActual)}</strong>.</div>`);
  }
  if (s.extraPoint) {
    const winners = s.extraPoint.rows.filter(r => ['blackjack', 'win', 'push-win'].includes(r.outcome));
    const busts = s.extraPoint.rows.filter(r => r.outcome === 'bust');
    if (winners.length) lines.push(`<div class="recap-line">🂡 Extra Point (longest FG ${s.extraPoint.actual} yd): <strong>${esc(winners.map(w => w.displayName).join(' & '))}</strong> ${winners[0].outcome === 'blackjack' ? 'hit BLACKJACK' : 'held the table'}${busts.length ? `; ${esc(busts.map(b => b.displayName).join(', '))} busted` : ''}.</div>`);
    else if (s.extraPoint.allBusted) lines.push(`<div class="recap-line">🂡 Extra Point: the entire cohort busted. The house thanks you.</div>`);
  }

  // Standings context after that week
  const season = prev.season;
  const seasonResults = getWeeklyResults().filter(r => {
    const w = getWeeks().find(x => x.weekId === r.weekId);
    // `<= 0` — every week up to AND INCLUDING `prev`. Uses the same ordering
    // helper as findPreviousFinalizedWeek() rather than a bare
    // `w.weekNumber <= prev.weekNumber`, which was the identical
    // total-order-on-weekNumber bug: on a same-weekNumber sibling that
    // comparison is TRUE IN BOTH DIRECTIONS, so a LATER part's results leaked
    // into an EARLIER part's chart line and SCRIBE published, under its own
    // byline, a false claim about who led at a named point in time
    // ("Season chart after Week 1, Part 1: Kevin leads" while Drew won it
    // 5-4). Found by reviewer, 2026-09-02, alongside fb_1788306484896_1owwx.
    return w && w.season === season && w.status === 'final' && w.showInHistory !== false && compareWeekOrder(w, prev) <= 0;
  });
  // UN-118/UN-125 — DELIBERATELY NOT widened for grouping. Drew's explicit
  // scope ruling held the SCRIBE recap card (this file) until real
  // split-week data exists to test against — the 2-arg call is the
  // documented fail-safe fallback (scoring.js). See DEVELOPMENT_LEDGER.md §6.
  const standings = calculateSeasonStandings(s.players, seasonResults);
  if (standings?.length) {
    const top = standings[0];
    lines.push(`<div class="recap-line">📈 Standings after ${esc(formatWeekLabel(prev))}: <strong>${esc(s.nameOf(top.playerId))}</strong> leads.</div>`);
  }

  return `
    <div class="card mb-md recap-card">
      <div class="recap-header">
        <h3>📋 ${esc(formatWeekLabel(prev))} Recap</h3>
        <span class="recap-byline">filed by S.C.R.I.B.E.</span>
      </div>
      ${lines.join('')}
    </div>`;
}

/**
 * Prior-season summary — rendered on Week 1 of a season (i.e. when no previous
 * finalized week exists IN THIS SEASON). Combines computed prior-season data
 * (when present in storage) with the commissioner's freeform blurb.
 */
export function renderSeasonSummaryHTML(currentWeek) {
  if (!currentWeek) return '';
  const season = currentWeek.season;
  const blurb = (getSettings().seasonRecapText || '').trim();

  // v0.17.0 — the 2K25 season of record is baked in (history-2025.js), so the
  // Week-1 Permanent Record renders with ZERO commissioner setup. This was the
  // root cause of the empty footer: the old path could only summarize prior
  // seasons that lived in app storage, and 2K25 lived in a spreadsheet.
  if (String(Number(season) - 1) === SEASON_2025.season) {
    const nets = season2025Nets();
    const fmtNet = n => (n > 0 ? `+${n}` : `${n}`);
    return `
    <div class="card mb-md recap-card recap-season">
      <div class="recap-header">
        <h3>📜 The Permanent Record — ${esc(SEASON_2025.label)}</h3>
        <span class="recap-byline">retrieved by S.C.R.I.B.E.</span>
      </div>
      <div class="recap-line">👑 <strong>${esc(SEASON_2025.champion.name)}</strong> — ${SEASON_2025.champion.points} points, ${esc(SEASON_2025.champion.note)}. Champion of record.</div>
      ${SEASON_2025.standings.map(s =>
        `<div class="recap-line recap-standing"><span class="recap-rank">${s.rank}.</span> ${esc(s.name)} <span class="recap-alias">"${esc(s.alias)}"</span> — ${s.total}</div>`
      ).join('')}
      <div class="recap-line">🍺 Ledger carried into this season: ${Object.entries(nets).sort((a,b)=>b[1]-a[1]).map(([n,v]) => `${esc(n)} ${fmtNet(v)}`).join(' · ')} — all payable in person.</div>
      <div class="recap-line">🎯 Extra Point champion: Jacob (4). Kevin finished at −1, which remains the only negative Extra Point total in league history.</div>
      ${blurb ? `<div class="recap-blurb">${esc(blurb).replace(/\n/g, '<br>')}</div>` : ''}
      <div class="recap-closer">The season resets. The receipts don't.</div>
    </div>`;
  }

  const priorWeeks = getWeeks().filter(w =>
    w.season !== season && w.status === 'final' && w.showInHistory !== false &&
    w.dataSourceMode !== 'demo');
  if (!priorWeeks.length && !blurb) return '';

  let computed = '';
  if (priorWeeks.length) {
    const players = getPlayers().filter(p => p.active !== false);
    const priorIds = new Set(priorWeeks.map(w => w.weekId));
    const priorResults = getWeeklyResults().filter(r => priorIds.has(r.weekId));
    // UN-118/UN-125 — DELIBERATELY NOT widened; see the note above in
    // renderWeekRecapCardHTML(). Same held scope, same fail-safe fallback.
    const standings = calculateSeasonStandings(players, priorResults);
    const priorSeason = priorWeeks[0].season;
    if (standings?.length) {
      const nameOf = id => players.find(p => p.playerId === id)?.displayName || id;
      computed = `
        <div class="recap-line">👑 <strong>${esc(nameOf(standings[0].playerId))}</strong> — Champion of record, CFP 2K${String(priorSeason).slice(-2)}.</div>
        ${standings.slice(0, 6).map((s2, i) =>
          `<div class="recap-line recap-standing"><span class="recap-rank">${i + 1}.</span> ${esc(nameOf(s2.playerId))} — ${s2.totalCorrect ?? s2.totalPoints ?? 0} correct over ${priorWeeks.length} week${priorWeeks.length > 1 ? 's' : ''}</div>`
        ).join('')}`;
    }
  }

  return `
    <div class="card mb-md recap-card recap-season">
      <div class="recap-header">
        <h3>📜 The Permanent Record — Last Season</h3>
        <span class="recap-byline">retrieved by S.C.R.I.B.E.</span>
      </div>
      ${computed}
      ${blurb ? `<div class="recap-blurb">${esc(blurb).replace(/\n/g, '<br>')}</div>` : ''}
      <div class="recap-closer">Last season isn't going anywhere.</div>
    </div>`;
}

/** The picks-page footer block: recap when available, season summary on week 1. */
export function renderPicksFooterHTML(currentWeek) {
  const recap = renderPrevWeekRecapHTML(currentWeek);
  if (recap) return recap;
  return renderSeasonSummaryHTML(currentWeek);
}
