/**
 * CFB Pickems — The Ischemic Extra Point (v0.16.0)
 * =================================================
 * Weekly blackjack side contest: each player guesses the LONGEST MADE FIELD
 * GOAL (yards) across this week's slate. Blackjack rules:
 *   - Closest to the actual WITHOUT GOING OVER wins.
 *   - Any guess OVER the actual is a BUST (out entirely).
 *   - Exact hit = BLACKJACK — outright win, beats everything.
 *   - Equal winning guesses share the win (push).
 *   - Everyone busts → no winner ("dealer takes the table").
 *
 * SCOPE DECISION (flag if this should change): "longest FG that week" is scored
 * against THE SLATE, because that's what the app can verify automatically from
 * ESPN per-event data and what every player can watch. Commissioner can always
 * override the actual manually.
 *
 * Auto-detection: ESPN's lightweight scoreboard payload does NOT carry scoring
 * plays, so detection fetches each slate game's SUMMARY endpoint
 * (site.api.espn.com …/summary?event=<id>) and parses scoringPlays entries of
 * type "Field Goal" ("Kicker 43 Yd Field Goal"). Made FGs only — scoringPlays
 * never contains misses. Games without an espnEventId are skipped and reported.
 */

import { getExtraPointGuess } from './storage.js';

// ── Detection ─────────────────────────────────────────────────────────────────

const SUMMARY_ROOT = 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary';

async function fetchSummary(eventId) {
  const res = await fetch(`${SUMMARY_ROOT}?event=${encodeURIComponent(eventId)}`);
  if (!res.ok) throw new Error(`ESPN summary HTTP ${res.status}`);
  return res.json();
}

function parseFieldGoals(summary, game) {
  const out = [];
  const plays = summary?.scoringPlays || [];
  for (const p of plays) {
    const typeTxt = String(p?.type?.text || '').toLowerCase();
    const text = String(p?.text || '');
    if (!typeTxt.includes('field goal') && !/yd field goal/i.test(text)) continue;
    const m = text.match(/(\d{1,2})\s*Y(?:ar)?d/i);
    if (!m) continue;
    const yards = parseInt(m[1], 10);
    if (!Number.isFinite(yards) || yards < 15 || yards > 75) continue;  // sanity window
    out.push({
      yards,
      text: text.trim(),
      team: p?.team?.displayName || p?.team?.abbreviation || '',
      gameId: game.gameId,
      matchup: `${game.awayTeam} @ ${game.homeTeam}`,
    });
  }
  return out;
}

/**
 * Detect the longest made FG across the slate. Returns
 * { ok, best, all, skipped } where best = {yards, text, team, gameId, matchup}.
 * Never throws — per-game failures are collected into `skipped`.
 */
export async function detectLongestFieldGoal(games) {
  const withIds = games.filter(g => g.espnEventId);
  const skipped = games.filter(g => !g.espnEventId)
    .map(g => ({ game: `${g.awayTeam} @ ${g.homeTeam}`, reason: 'no ESPN event id (manual game)' }));
  const all = [];
  const results = await Promise.allSettled(withIds.map(g => fetchSummary(g.espnEventId).then(s => ({ g, s }))));
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      all.push(...parseFieldGoals(r.value.s, r.value.g));
    } else {
      const g = withIds[i];
      skipped.push({ game: `${g.awayTeam} @ ${g.homeTeam}`, reason: String(r.reason?.message || r.reason) });
    }
  });
  all.sort((a, b) => b.yards - a.yards);
  return { ok: all.length > 0, best: all[0] || null, all, skipped };
}

// ── Grading (blackjack rules) ─────────────────────────────────────────────────

/**
 * Grade the Extra Point for a week.
 * @param actual  number — the verified longest FG in yards
 * @param entries [{playerId, displayName, guess}] — players WITH a guess
 * @returns { actual, rows:[{playerId,displayName,guess,outcome,delta}], winners:[playerId], allBusted }
 *   outcome: 'blackjack' | 'win' | 'push-win' | 'alive' | 'bust' | 'no-entry'
 */
export function gradeExtraPoint(actual, entries) {
  const rows = entries.map(e => {
    if (e.guess === null || e.guess === undefined || e.guess === '') {
      return { ...e, guess: null, outcome: 'no-entry', delta: null };
    }
    const guess = Number(e.guess);
    if (!Number.isFinite(guess)) return { ...e, guess: null, outcome: 'no-entry', delta: null };
    if (guess > actual) return { ...e, guess, outcome: 'bust', delta: guess - actual };
    return { ...e, guess, outcome: 'alive', delta: actual - guess };
  });
  const alive = rows.filter(r => r.outcome === 'alive');
  let winners = [];
  if (alive.length) {
    const exact = alive.filter(r => r.delta === 0);
    if (exact.length) {
      exact.forEach(r => { r.outcome = 'blackjack'; });
      winners = exact.map(r => r.playerId);
    } else {
      const bestDelta = Math.min(...alive.map(r => r.delta));
      const best = alive.filter(r => r.delta === bestDelta);
      best.forEach(r => { r.outcome = best.length > 1 ? 'push-win' : 'win'; });
      winners = best.map(r => r.playerId);
    }
  }
  rows.sort((a, b) => {
    const rank = { blackjack: 0, win: 1, 'push-win': 1, alive: 2, bust: 3, 'no-entry': 4 };
    return rank[a.outcome] - rank[b.outcome] || (a.delta ?? 99) - (b.delta ?? 99);
  });
  return { actual, rows, winners, allBusted: alive.length === 0 && rows.some(r => r.outcome === 'bust') };
}

/** Convenience: build graded results for a week from storage. */
export function gradeWeekExtraPoint(week, players) {
  if (!week || week.extraPointActual == null) return null;
  const entries = players.map(p => ({
    playerId: p.playerId, displayName: p.displayName,
    guess: getExtraPointGuess(week.weekId, p.playerId),
  }));
  return gradeExtraPoint(Number(week.extraPointActual), entries);
}

// ── Season tally (FEAT-9 / UN-176, 2026-09-12) ────────────────────────────────

/**
 * THE inclusion predicate for the season Extra Point views. Stated once and
 * used by BOTH the Standings ledger card and the CSV export, so the exported
 * rows can never fail to sum to the numbers on screen.
 *
 * A week is COUNTED when all of these hold:
 *   extraPointEnabled !== false   opt-out default (CONVENTIONS #10) — a week
 *                                 the league did not run is invisible to the
 *                                 tally in every direction, numerator and
 *                                 denominator alike
 *   status !== 'draft'            a week the commissioner has not opened has
 *                                 no result and is not "waiting" on one
 *   dataSourceMode !== 'demo'     byte-matching seasonStandingsRows()'s own
 *                                 filter (UN-71 — demo weeks never count)
 *   showInHistory !== false       same visibility rule as the standings
 *   a finite extraPointActual     junk ('abc') / undefined is NOT an
 *                                 everybody-busted week; it is no week at all
 *   canViewOtherPicks(week)       THE BLIND GATE — see below
 *
 * THE BLIND GATE, and why it is not negotiable (DI-176f):
 * `week.extraPointActual` can be set on a week that is still OPEN —
 * renderCommExtraPointCardHTML() says so in its own comment. A season tally
 * that counted such a week would be RG-40's leak through a third door: it
 * shows counts, not guesses, but a `wins` figure that ticks up for one player
 * on an open week tells everyone who is currently winning the blackjack table,
 * and knowing the field is more decisive here than knowing a single ATS pick —
 * you can sit one yard under whoever is highest and take the whole table.
 *
 * `canViewOtherPicks` is INJECTED rather than imported. It lives in app.js
 * (not data-model.js, as DI-176f's cross-reference says), and app.js imports
 * this module — importing it back would create the project's first module
 * cycle. Injection keeps this file leaf-level while still asking THE app's one
 * definition of the blind rule: the two call sites in app.js pass the real
 * `canViewOtherPicks`, and eptest.mjs passes the same imported function.
 * Nine drifted longhand copies of the blind rule is what produced the original
 * leak (UN-116), so there is no copy of its logic here. Default is
 * fail-CLOSED: with no predicate supplied nothing counts.
 */
export function isCountedExtraPointWeek(week, { canViewOtherPicks = () => false } = {}) {
  if (!week) return false;
  if (week.extraPointEnabled === false) return false;
  if (week.status === 'draft') return false;
  if (week.dataSourceMode === 'demo') return false;
  if (week.showInHistory === false) return false;
  // "a finite extraPointActual" spelled out. The commissioner's own Save
  // handler runs parseInt() and refuses anything non-finite, so the UI can
  // never write junk — but a hand-edited or legacy record can, and
  // Number('') is 0, which would otherwise grade as a real 0-yard result and
  // bust the entire league on a week nobody played. An empty/blank string is
  // an ABSENT value, not a zero.
  const rawActual = week.extraPointActual;
  if (rawActual == null) return false;
  if (typeof rawActual === 'string' && rawActual.trim() === '') return false;
  if (!Number.isFinite(Number(rawActual))) return false;
  return !!canViewOtherPicks(week);
}

/** Weeks that are eligible in principle (enabled, visible, non-demo, opened)
 *  but are not yet counted — no result on file yet, or still blinded. Surfaced
 *  as the ledger's footnote, never as a zero in somebody's row. */
function isEligibleExtraPointWeek(week) {
  if (!week) return false;
  if (week.status === 'draft') return false;
  if (week.dataSourceMode === 'demo') return false;
  if (week.showInHistory === false) return false;
  return true;
}

/**
 * Season-long, per-player Extra Point tally. Pure: no DOM, no network, no
 * clock — a deterministic function of the week records, the player list and
 * the persisted guesses.
 *
 * @param weeks    week records (the caller passes getWeeks(); filtering is this
 *                 function's job so every surface filters identically)
 * @param players  the SAME list the Standings page uses — getPlayers().filter(p => p.active).
 *                 gradeExtraPoint() is RELATIVE (a week's winner depends on who
 *                 else entered), an inherited property shared with the recap
 *                 card and the commissioner preview; passing the same roster
 *                 they pass is what stops this surface disagreeing with them.
 * @returns { rows, gradedWeeks, pendingWeeks, enabledWeeks, consideredWeeks }
 *
 * Per row: wins (weeks in graded.winners — blackjack, win and push-win alike,
 * because a push-win is a SHARED WIN, not a draw), blackjacks, busts, entries
 * (counted weeks the player actually entered), bestUnder (smallest non-zero
 * miss, tiebreak only).
 *
 * Grading is NEVER reimplemented here — every counted week goes through
 * gradeWeekExtraPoint(), the same function the weekly recap card and the
 * commissioner's preview call (CONVENTIONS #21). That is the specific thing
 * that would otherwise let Standings and the recap disagree about who won a
 * week.
 */
export function seasonExtraPointTally(weeks, players, { canViewOtherPicks = () => false } = {}) {
  const active = (players || []).filter(p => p && p.active !== false);
  const rows = active.map(p => ({
    playerId: p.playerId, displayName: p.displayName,
    wins: 0, blackjacks: 0, busts: 0, entries: 0, bestUnder: null,
  }));
  const byId = new Map(rows.map(r => [r.playerId, r]));

  let gradedWeeks = 0, pendingWeeks = 0, enabledWeeks = 0, consideredWeeks = 0;
  for (const week of (weeks || [])) {
    if (!isEligibleExtraPointWeek(week)) continue;
    consideredWeeks++;
    if (week.extraPointEnabled === false) continue;
    enabledWeeks++;
    if (!isCountedExtraPointWeek(week, { canViewOtherPicks })) { pendingWeeks++; continue; }
    const graded = gradeWeekExtraPoint(week, active);
    if (!graded) { pendingWeeks++; continue; }
    gradedWeeks++;
    const winners = new Set(graded.winners || []);
    for (const r of graded.rows) {
      const row = byId.get(r.playerId);
      if (!row) continue;
      if (r.outcome !== 'no-entry') row.entries++;
      if (r.outcome === 'blackjack') row.blackjacks++;
      if (r.outcome === 'bust') row.busts++;
      if (winners.has(r.playerId)) row.wins++;
      if ((r.outcome === 'alive' || r.outcome === 'win' || r.outcome === 'push-win')
          && Number.isFinite(r.delta) && r.delta > 0
          && (row.bestUnder === null || r.delta < row.bestUnder)) {
        row.bestUnder = r.delta;
      }
    }
  }

  // Sort is LOCAL to this card. It is never returned to renderLeaderboard()'s
  // standings array, never compared against currentRank, never persisted, and
  // feeds nothing (AD-33). displayName is the stable final key so two
  // identical players never swap between renders.
  rows.sort((a, b) =>
    b.wins - a.wins ||
    b.blackjacks - a.blackjacks ||
    a.busts - b.busts ||
    b.entries - a.entries ||
    (a.bestUnder === null ? Infinity : a.bestUnder) - (b.bestUnder === null ? Infinity : b.bestUnder) ||
    String(a.displayName).localeCompare(String(b.displayName))
  );

  return { rows, gradedWeeks, pendingWeeks, enabledWeeks, consideredWeeks };
}

// ── Display helpers ───────────────────────────────────────────────────────────

export const EP_OUTCOME_LABEL = {
  blackjack: '🂡 BLACKJACK', win: '✅ Wins', 'push-win': '🤝 Push (shared win)',
  alive: 'Under', bust: '💥 BUST', 'no-entry': '— no entry',
};

export function renderExtraPointResultsHTML(week, graded, escHtml) {
  if (!graded) return '';
  const rowsHtml = graded.rows.map(r => `
    <div class="ep-row ep-${escHtml(String(r.outcome))}">
      <span class="ep-name">${escHtml(r.displayName)}</span>
      <span class="ep-guess">${r.guess == null ? '—' : escHtml(String(r.guess)) + ' yd'}</span>
      <span class="ep-outcome">${EP_OUTCOME_LABEL[r.outcome] || escHtml(String(r.outcome))}${r.outcome === 'alive' || r.outcome === 'win' || r.outcome === 'push-win' ? ` (−${escHtml(String(r.delta))})` : ''}${r.outcome === 'bust' ? ` (+${escHtml(String(r.delta))})` : ''}</span>
    </div>`).join('');
  const detect = week.extraPointDetect;
  return `
    <div class="card mb-md ep-card">
      <h3 class="ep-title">🎯 The Ischemic Extra Point</h3>
      <div class="ep-actual">Longest FG this week: <strong>${escHtml(String(graded.actual))} yards</strong>
        ${detect ? `<div class="text-muted text-xs">${escHtml(detect.text || '')} — ${escHtml(detect.matchup || '')}</div>` : ''}
      </div>
      ${rowsHtml}
      ${graded.allBusted ? '<div class="ep-house">Everyone busted. The house wins. It usually does.</div>' : ''}
      <div class="text-muted text-xs mt-sm">Blackjack rules: closest without going over. Over = bust. Exact = blackjack.</div>
    </div>`;
}
