/**
 * CFB Pickems — gameday.js (Deployment 1, Lane B, DI-603 / DI-604 / DI-606 / DI-608, PF-420 / 443 / 447 / 448 / 452 rev 3, 2026-10-08)
 * =====================================================================================================================================
 * GAME DAY: the compact red card at the top of Home (what the earlier drafts called Live Peek). Drew, D-63: "home gameday ready to build". D-58: only LIVE games are pills; "the red card itself open[s]
 * up and expand[s]". This module is the card's MODEL and its COLLAPSED markup; the expanded body is js/gameday-sheet.js (the file name is kept although it is no longer a sheet).
 *
 *   gameDayModel(input)                 PURE. Plain data in, plain data out: the collapsed state, the live-game pills, the upcoming / final counts, the rows of the open card and the footer.
 *   gameDayCardHTML(model, ctx)         the card's markup: header button + (the pill rail | one calm message | the open body). `ctx.escHtml` and `ctx.numHtml` are REQUIRED and the renderer refuses without them.
 *
 * W-85 (DESIGN_D1_E, Drew D-88): first-person lines are for a viewer who PLAYS the Now card's sport and week (`entered`, default true). A non-entrant's Open card says where he stands ("you're not in NFL picks yet", in the
 * folding `body.next` span) and offers `Join NFL picks` (the app's `joinOffer`) instead of `Make picks`; his Locked card drops "your picks are in"; the Final winner line and Results stay (the tease).
 *
 * SECURITY (C3 / C4 / C5 / C7 — the Revision 2 conditions, S1 as amended in Revision 4):
 *   - The model carries ONLY games, phases, counts and the VIEWER'S OWN pick and coverage (`ownTeam`, `coverage`), with an explicit `viewerId` (no viewer, no pick). It holds no other member's playerId, name,
 *     pick or per-side count — not even in a Locked fixture (gamedaytest serialises the model and scans it). Clusters and "•••" chips are NOT built here: line 4 of an open row comes only from
 *     `picksRowHTML` (js/pick-groups.js), behind the gate, in js/gameday-sheet.js. This module imports NOTHING: no pick reader, no storage, no DOM.
 *   - A game of a sport the viewer has NOT joined is a plain score row: `entered: false` turns off every personal field (no coverage word, no pick, no league line), before and after reveal (C7).
 *   - Draft weeks never appear for a member and demo weeks never appear for anyone but the commissioner: the CALLER (home.js) assembles `entries` from exactly those weeks, per game, each with its own week (C2).
 *   - Every renderer takes the escaper as a parameter; every number crosses `numHtml`; every attribute is double-quoted.
 *
 * SIZE BUDGET (DI-603): the collapsed card is a 44 pt header and either one 56 pt pill rail or one two-line message — never taller with more games (the rail scrolls sideways) — so it holds
 * the Design budget of 25–33% of the visible window at any text size (gamedaybudgettest measures it in a real engine).
 */

export const GAME_DAY_NAME = 'Game Day';
/** Pills and open-card rows are capped at the same five, so the pills are always a subset of the rows (DI-604, DI-605). */
export const PILL_CAP = 5;
export const ROW_CAP = 5;
/** Under accessibility-size text the pill rail is not drawn at all (DI-603): the header alone is the card. */
export const RAIL_HIDDEN_SCALE = 1.5;

/** The collapsed kinds whose header carries "You: 3–1 · 2nd" (an Open or Locked week has nothing graded to say). */
const PERSONAL_KINDS = Object.freeze(['live', 'quiet', 'allfinal', 'final']);
const requireFn = (f, name, who) => { if (typeof f !== 'function') throw new TypeError(`${who}() requires an injected ${name} function (CONVENTIONS #12, security C5): there is no fallback`); return f; };
const isStr = (v) => typeof v === 'string' && v !== '';
const asArray = (v) => (Array.isArray(v) ? v : []);
const num = (v) => { if (v === null || v === undefined || String(v).trim() === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const toMs = (v) => { if (typeof v === 'number') return Number.isFinite(v) ? v : null; const ms = v ? Date.parse(v) : NaN; return Number.isFinite(ms) ? ms : null; };

/** "4:12 - 3rd" / "Q3 4:12" / "End of 2nd" / "Halftime" -> the short form a pill prints ("Q3", "Halftime"); the full text lives in the open card. */
export function shortStatus(label) {
  const t = String(label ?? '').trim();
  if (!t) return '';
  if (/^half/i.test(t)) return 'Halftime';
  const end = /^end of (\d)/i.exec(t);
  if (end) return `End Q${end[1]}`;
  const ord = /(\d)(?:st|nd|rd|th)\b/i.exec(t) || /\bQ(\d)\b/i.exec(t);
  if (ord) return `Q${ord[1]}`;
  if (/\bOT\b/i.test(t)) return 'OT';
  return t.length > 10 ? `${t.slice(0, 9)}…` : t;
}

/** The label as the open card prints it: the capture's own text ("4:12 - 3rd"), or a plain word for a game that is not live. */
function rowStatus(e) {
  const p = e.phase || {};
  if (p.phase === 'live') return p.label || 'Live';
  if (p.phase === 'live-stale') return 'Score may be behind';
  if (p.phase === 'final') return 'Final';
  return p.label || '';
}

const kickoffMsOf = (g) => toMs(g && g.kickoff);
const kickoffCmp = (a, b) => {
  const ka = kickoffMsOf(a.game), kb = kickoffMsOf(b.game);
  if (ka !== kb) { if (ka === null) return 1; if (kb === null) return -1; return ka - kb; }
  const ia = String(a.game.gameId), ib = String(b.game.gameId);
  return ia < ib ? -1 : ia > ib ? 1 : 0;
};
const isLive = (e) => e.phase && (e.phase.phase === 'live' || e.phase.phase === 'live-stale');
const isFinal = (e) => e.game && e.game.status === 'final';
const rank = (e) => (isLive(e) ? 0 : isFinal(e) ? 2 : 1);

/** Live, then not started, then final; kickoff order inside a group; the sports the viewer PLAYS before the ones they only follow, inside a group (DI-603/604/605). */
export function orderEntries(entries) {
  return asArray(entries).slice().sort((a, b) => (rank(a) - rank(b)) || ((a.entered ? 0 : 1) - (b.entered ? 0 : 1)) || kickoffCmp(a, b));
}

/**
 * The first `max` entries, except that the FIRST LIVE game of every sport is always among them, so a live NFL game is never pushed out by five live CFB games. Returned in the input order.
 * @returns {{shown:object[], rest:number}}
 */
export function capEntries(list, max, liveOnly = false) {
  const all = asArray(list);
  if (all.length <= max) return { shown: all, rest: 0 };
  const pick = new Set();
  const seen = new Set();
  for (const e of all) { if ((liveOnly || isLive(e)) && !seen.has(e.sport)) { seen.add(e.sport); pick.add(e); } }
  for (const e of all) { if (pick.size >= max) break; pick.add(e); }
  const shown = all.filter(e => pick.has(e));
  return { shown, rest: all.length - shown.length };
}

const sentence = (cov) => {
  if (!cov) return '';
  const by = cov.margin ? ` by ${cov.margin}` : '';
  switch (cov.kind) {
    case 'covering': return `You're covering${by}.`;
    case 'trailing': return `You're trailing${by}.`;
    case 'even': return "You're right on the number.";
    case 'covered': return `You covered${by}.`;
    case 'missed': return `You missed${by}.`;
    case 'push': return 'Your pick was a push.';
    default: return '';
  }
};

/** A row's / pill's own-coverage object. A game of a sport the viewer has not joined, or a viewer with no id, gets none (C7, S-C3). */
function coverageOf(e, viewerId, coverOf) {
  if (!isStr(viewerId) || !e.entered) return { kind: 'follow' };
  if (!isStr(e.ownTeam)) return { kind: 'none' };
  let c = null;
  try { c = coverOf ? coverOf(e.game, e.ownTeam, e.phase) : null; } catch { c = null; }
  if (!c || typeof c.kind !== 'string') return { kind: 'pending', team: e.ownTeam };
  return { kind: c.kind, margin: c.margin ? String(c.margin) : '', team: e.ownTeam };
}

/**
 * @param {object} input
 *   state          the Now card's state: 'live' | 'locked-far' | 'locked-near' | 'open-pending' | 'open-done' | 'final'
 *   weekN, weekId  the Now card's week; viewerId  the explicit viewer ('' / null = signed out)
 *   entries        EVERY game in scope, one per game: { game, weekId, sport, sportLabel, entered, phase (DI-570's gameStateOf result), ownTeam }
 *                  — already filtered to the weeks a member may see (no draft; no demo unless commissioner); the pick behind `ownTeam` is the VIEWER'S OWN, nothing else
 *   showSport      the league has two or more sports; weekScoped: every entry belongs to one week (so the open card's sub-line may say "Week 6 ·")
 *   lockMs, firstKickoffMs, counts ({submittedCount,totalPlayers}|null), remaining (own picks left), nextGame (the first game not final, for the quiet message)
 *   finalLine      { winnerLine, mine, next } for a finalized week;  mine: "7–3"; next: DI-599's short "Next: …" ('' when nothing is still to come)
 *   personal       { week: '3–1', rank: '2nd' , sportCode } | null — the collapsed header's right side (already decided by the caller: S2 omits, S3 names the sport)
 *   stats          { lines: [string], notes: [string] } — the open card's "Your numbers"
 *   fmt            { time(ms|iso) -> 'Sat 12:00 PM', countdown(ms) -> '2h 10m' }
 *   coverOf(game, team, phase) -> { kind, margin }   the caller's one coverage function (live or final), over the viewer's OWN pick
 *   actionSport    the Now card's sport (several sports only): the card's picks / dashboard button carries it as data-sport
 *   entered        DESIGN_D1_E (W-85): is the viewer IN the Now card's sport and week? false = every first-person line is dropped and the Open card says where he stands (default true: every caller that predates it)
 *   joinOffer      { dbCode, code, joinable } | null - the app's join offer for the Now card's sport (only a sport the viewer does NOT play is offered): the Open card's button becomes "Join NFL picks"
 *   sportCode      the Now card's sport code ('NFL'), for "you're not in NFL picks"
 *   now, textScale
 * @returns {object} plain JSON (see the top of the file for what it never holds)
 */
export function gameDayModel(input = {}) {
  const i = (input && typeof input === 'object') ? input : {};
  const viewerId = isStr(i.viewerId) ? i.viewerId : '';
  const fmt = { time: (v) => String(v ?? ''), countdown: (ms) => String(ms ?? ''), ...(i.fmt || {}) };
  const ordered = orderEntries(i.entries);
  const live = ordered.filter(isLive);
  const finals = ordered.filter(isFinal);
  const upcoming = ordered.filter(e => !isLive(e) && !isFinal(e));
  const stale = live.some(e => e.phase.phase === 'live-stale');
  const state = String(i.state || '');
  const weekN = num(i.weekN);
  // DESIGN_D1_E (W-85): first-person lines ("you have not picked yet", "your picks are in", "Make picks") are for a viewer who PLAYS the Now card's sport and week. Default: every caller that predates the flag
  // is an entrant. The final winner line and the Results button are NOT personal (R-2: they are the tease), so they are left alone.
  const entered = i.entered !== false;
  const asPlayer = !!viewerId && entered;
  const offer = i.joinOffer && typeof i.joinOffer === 'object' && isStr(i.joinOffer.dbCode) && isStr(i.joinOffer.code) ? i.joinOffer : null;
  const canJoin = !!offer && offer.joinable === true;
  const sportCode = isStr(i.sportCode) ? i.sportCode : (offer ? offer.code : 'this sport');

  // ── the collapsed card: which kind, what the header says, what the body is ──────────────────────────────────────────────────────
  let kind = 'live', expandable = true;
  const header = { tail: '', staleChip: false };
  const body = { type: 'none' };
  const countLabel = live.length === 1 ? '1 live' : `${live.length} live`;
  if (state === 'open-pending' || state === 'open-done') {
    // "Done" is a fact about someone's OWN picks: a viewer who is not in this sport cannot be done, so his card is the Open-and-due card (he is never told "You're in for Week 6").
    const asPending = state === 'open-pending' || (state === 'open-done' && !entered);
    kind = asPending ? 'open-due' : 'open-in';
    expandable = false;
    header.tail = `· Week ${weekN ?? ''}`.trim();
    if (asPending) {
      const left = num(i.lockMs) !== null ? num(i.lockMs) - (num(i.now) ?? 0) : null;
      body.type = 'action';
      body.title = num(i.lockMs) !== null ? `Picks lock ${fmt.time(i.lockMs)}` : 'Picks are open';
      const rem = num(i.remaining), tot = num(i.gameTotal);
      // A non-entrant is told where he stands, not asked to pick: "you're not in NFL picks yet" with the Join button while joining is possible, the same words without "yet" and with no button when it is not.
      // That clause rides in `body.next`, the Final card's "· Next: …" span: where the text column is too narrow for its font (the smallest phone at the largest text, with the wider "Join NFL picks" button beside
      // it) the shipped container query folds it away, so the collapsed card keeps to the 33% cap (gamedaybudgettest); the button names the action either way. A viewer who plays the sport keeps one plain line.
      const picked = !viewerId ? '' : (!asPlayer ? '' : (rem !== null && tot !== null && rem > 0 && rem < tot ? `you have ${rem} ${rem === 1 ? 'pick' : 'picks'} left` : 'you have not picked yet'));
      body.line = [left !== null && left > 0 ? `In ${fmt.countdown(left)}` : '', picked].filter(Boolean).join(' · ');
      if (viewerId && !asPlayer) body.next = canJoin ? `you're not in ${sportCode} picks yet` : `you're not in ${sportCode} picks`;
      body.action = !viewerId || asPlayer ? { label: 'Make picks', tab: 'picks', tone: 'solid' }
        : (canJoin ? { label: `Join ${offer.code} picks`, tab: 'picks', tone: 'solid', sport: offer.dbCode } : null);
    } else {
      const c = i.counts && num(i.counts.submittedCount) !== null && num(i.counts.totalPlayers) !== null ? i.counts : null;
      body.type = 'action';
      body.title = `You're in for Week ${weekN ?? ''}`.trim();
      body.line = [c ? `${c.submittedCount} of ${c.totalPlayers} picked` : '', num(i.lockMs) !== null ? `locks ${fmt.time(i.lockMs)}` : ''].filter(Boolean).join(' · ');
      body.action = { label: 'Edit picks', tab: 'picks', tone: 'outline' };
    }
  } else if (state === 'final') {
    kind = 'final';
    header.tail = `· Week ${weekN ?? ''} final`.trim();
    const f = i.finalLine || {};
    body.type = 'action';
    body.title = isStr(f.winnerLine) ? f.winnerLine : `Week ${weekN ?? ''} is final.`.replace('  ', ' ');
    body.line = isStr(f.mine) ? `You went ${f.mine}` : '';
    body.next = isStr(f.next) ? f.next : '';                           // DI-599: "· Next: NFL Week 6 picks lock Sun 12:30 PM" — drawn after the line, and folded into the open card when it cannot fit (css)
    body.action = { label: 'Results', tab: 'leaderboard', tone: 'solid', ...(isStr(i.weekId) ? { weekId: i.weekId } : {}) };   // D1 Lane B History: names its week so the app can open that week's detail (DI-596)
  } else if (state === 'locked-far' || state === 'locked-near') {
    kind = 'locked';
    header.tail = '· Locked';
    const first = num(i.firstKickoffMs);
    const left = first !== null ? first - (num(i.now) ?? 0) : null;
    body.type = 'message';
    body.title = first !== null ? `First kickoff ${fmt.time(first)}` : 'Picks are locked';
    body.line = left !== null && left > 0
      ? [`In ${fmt.countdown(left)}`, asPlayer ? 'your picks are in' : ''].filter(Boolean).join(' · ')
      : 'Reveal comes as the week goes live';
  } else if (live.length > 0) {
    kind = 'live';
    header.tail = stale ? '' : `· ${countLabel}`;
    header.staleChip = stale;
    body.type = 'pills';
  } else if (upcoming.length === 0 && finals.length > 0) {
    kind = 'allfinal';
    header.tail = '· All games final';
    body.type = 'message';
    body.title = isStr(i.mineLine) ? i.mineLine : 'Every game is final';
    body.line = `Results post when Week ${weekN ?? ''} is finalized.`.replace('  ', ' ');
  } else {
    kind = 'quiet';
    header.tail = '· Nothing live right now';
    const n = (i.nextGame && i.nextGame.game ? i.nextGame : null) || upcoming[0] || null;   // the first game not started: the model's own order (kickoff, the viewer's sports first)
    body.type = 'message';
    body.title = n && toMs(n.game.kickoff) !== null ? `Next kickoff ${fmt.time(n.game.kickoff)}` : 'Nothing live right now';
    body.line = n ? `${n.game.awayTeam} at ${n.game.homeTeam}` : '';
  }
  if (expandable && ordered.length === 0) expandable = false;          // nothing to open onto

  // ── pills: LIVE games only, capped, the first live game of every sport always among them ────────────────────────────────────────
  const capped = capEntries(live, PILL_CAP, true);
  const pillOf = (e) => {
    const g = e.game, cov = coverageOf(e, viewerId, i.coverOf);
    const p = e.phase;
    const hs = num(g.homeScore), as = num(g.awayScore);
    const clock = p.phase === 'live-stale' ? '' : shortStatus(p.label);
    const word = cov.kind === 'covering' ? '▲ Covering' : cov.kind === 'trailing' ? '▽ Trailing' : cov.kind === 'even' ? 'On the number' : cov.kind === 'none' ? 'No pick' : '';
    const aria = `${g.awayTeam} ${as ?? ''}, ${g.homeTeam} ${hs ?? ''}, ${p.phase === 'live-stale' ? 'score may be behind' : (p.label || 'live')}.${sentence(cov) ? ` ${sentence(cov)}` : ''} Opens Game Day.`;
    return {
      gameId: String(g.gameId), sport: e.sport, sportLabel: e.sportLabel || '', away: e.awayAbbr || g.awayTeam, home: e.homeAbbr || g.homeTeam, awayName: g.awayTeam, homeName: g.homeTeam, awayScore: as, homeScore: hs,
      clock, stale: p.phase === 'live-stale', coverage: cov.kind, coverWord: word, aria,
    };
  };
  const pills = capped.shown.map(pillOf);

  // ── rows of the open card: up to five, live -> upcoming -> final ────────────────────────────────────────────────────────────────
  const rowsCap = capEntries(ordered, ROW_CAP);
  const rowOf = (e) => {
    const g = e.game, cov = coverageOf(e, viewerId, i.coverOf);
    return {
      gameId: String(g.gameId), weekId: String(e.weekId || g.weekId || ''), sport: e.sport, sportLabel: e.sportLabel || '', entered: !!e.entered,
      away: g.awayTeam, home: g.homeTeam, awayAbbr: e.awayAbbr || '', homeAbbr: e.homeAbbr || '', awayScore: num(g.awayScore), homeScore: num(g.homeScore),
      phase: e.phase.phase, status: rowStatus(e), kickoff: e.phase.phase === 'upcoming' ? String(e.phase.label || '') : '', group: isLive(e) ? 'live' : isFinal(e) ? 'final' : 'upcoming',
      line: typeof e.lineText === 'string' ? e.lineText : '', coverage: cov.kind, coverMargin: cov.margin || '', coverTeam: cov.team || '', fresh: e.phase.fresh,
    };
  };
  const rows = rowsCap.shown.map(rowOf);

  // what the announcer compares between paints (DI-604 / Std-7): per game in scope, the phase, the score and the VIEWER'S OWN coverage — no other member's anything (C3). `shown`: drawn as a pill or a row.
  const shownIds = new Set([...pills.map(p => p.gameId), ...rows.map(r => r.gameId)]);
  const watch = ordered.map((e) => {
    const g = e.game, cov = coverageOf(e, viewerId, i.coverOf);
    return { gameId: String(g.gameId), phase: e.phase.phase, away: g.awayTeam, home: g.homeTeam, awayScore: num(g.awayScore), homeScore: num(g.homeScore), entered: !!e.entered, coverage: cov.kind, margin: cov.margin || '', shown: shownIds.has(String(g.gameId)) };
  });
  const sports = new Set(ordered.map(e => e.sport));
  // D1 Part 2 item 6 (the Lane A seam, 2026-10-08): in a several-sport league the card's button opens ITS week's sport (the Now card's own `sport`, from the feed contexts), never the member's pointer;
  // only the sport-scoped tabs carry it, and a one-sport league passes none (the markup is the unmodified one).
  if (body.action && isStr(i.actionSport) && (body.action.tab === 'picks' || body.action.tab === 'dashboard')) body.action.sport = i.actionSport;
  const model = {
    kind, state, weekN, weekId: isStr(i.weekId) ? i.weekId : null, expandable,
    liveCount: live.length, upcomingCount: upcoming.length, finalCount: finals.length, totalCount: ordered.length,
    stale, header: { label: GAME_DAY_NAME, tail: header.tail, staleChip: header.staleChip, me: PERSONAL_KINDS.includes(kind) && i.personal && isStr(i.personal.text) ? i.personal.text : '', meAria: PERSONAL_KINDS.includes(kind) && i.personal && isStr(i.personal.aria) ? i.personal.aria : '' },
    body, pills, morePill: capped.rest > 0 ? { count: live.length } : null,
    showSport: i.showSport === true, weekScoped: i.weekScoped === true,
    rows, rowsRest: rowsCap.rest,
    sub: `${i.weekScoped === true && weekN !== null ? `Week ${weekN} · ` : ''}${live.length} live · ${upcoming.length} upcoming · ${finals.length} final`,
    freshness: live.length || kind === 'quiet' ? (stale ? { text: isStr(i.staleText) ? i.staleText : 'Scores may be behind.', stale: true } : { text: isStr(i.freshText) ? i.freshText : '', stale: false }) : null,
    stats: i.stats && typeof i.stats === 'object' ? { lines: asArray(i.stats.lines).filter(isStr), notes: asArray(i.stats.notes).filter(isStr) } : null,
    footer: { label: rowsCap.rest > 0 ? `All ${ordered.length} games on Dashboard ›` : 'Open Dashboard', scope: sports.size > 1 && i.multiEntered === true ? 'all' : (ordered[0] ? ordered[0].sport : null) },
    sportCount: sports.size,
    watch,
  };
  model.header.aria = ariaForHeader(model);
  return model;
}

const LIVE_PHASES = new Set(['live', 'live-stale']);
const FLIP_KINDS = new Set(['covering', 'trailing', 'even']);
/**
 * DI-604 / DI-591 / DI-593 (Std-7) — what changed between two paints that is worth SAYING: only a cover flip (the viewer's own live coverage moves between covering, trailing and on the number) and a game
 * ending (live -> final). A score tick, a kickoff, a reorder say nothing. A sport the viewer has not joined has no coverage, so its ending is the score alone (C7). Pure: two `watch` lists in, sentences out.
 * @returns {string[]}
 */
export function gameDayAnnouncements(prevWatch, nextWatch) {
  const before = new Map(asArray(prevWatch).filter(w => w && isStr(w.gameId)).map(w => [w.gameId, w]));
  const out = [];
  for (const w of asArray(nextWatch)) {
    const p = w && before.get(w.gameId);
    if (!p) continue;
    const score = `${w.away} ${w.awayScore ?? ''}, ${w.home} ${w.homeScore ?? ''}`;
    if (LIVE_PHASES.has(p.phase) && w.phase === 'final' && (p.shown || w.shown)) {
      const own = w.entered ? sentence({ kind: w.coverage, margin: w.margin }) : '';
      out.push(`Final: ${score}.${own ? ` ${own}` : ''}`);
    } else if (LIVE_PHASES.has(p.phase) && LIVE_PHASES.has(w.phase) && w.entered && w.shown && FLIP_KINDS.has(p.coverage) && FLIP_KINDS.has(w.coverage) && p.coverage !== w.coverage) {
      out.push(`${score}. ${sentence({ kind: w.coverage, margin: w.margin })}`);
    }
  }
  return out;
}

/**
 * DI-591 / DI-593 (Std-7) — the Game view's own two moments worth saying, for ONE game: the viewer's cover flipping while it is live, and the game ending ("Final. Texas covered by 3.5." — the neutral
 * cover line — then the viewer's own result when they have one). `watch` = { gameId, phase, away, home, awayScore, homeScore, entered, coverage, margin, coverLine }. Pure.
 * @returns {string[]}
 */
export function gameViewAnnouncements(prev, next) {
  if (!prev || !next || prev.gameId !== next.gameId) return [];
  if (LIVE_PHASES.has(prev.phase) && next.phase === 'final') {
    const own = next.entered ? sentence({ kind: next.coverage, margin: next.margin }) : '';
    return [`Final.${isStr(next.coverLine) ? ` ${next.coverLine}.` : ''}${own ? ` ${own}` : ''}`];
  }
  if (LIVE_PHASES.has(prev.phase) && LIVE_PHASES.has(next.phase) && next.entered && FLIP_KINDS.has(prev.coverage) && FLIP_KINDS.has(next.coverage) && prev.coverage !== next.coverage) {
    return [`${next.away} ${next.awayScore ?? ''}, ${next.home} ${next.homeScore ?? ''}. ${sentence({ kind: next.coverage, margin: next.margin })}`];
  }
  return [];
}

function ariaForHeader(m) {
  const what = m.kind === 'live' ? `${m.liveCount === 1 ? '1 game live' : `${m.liveCount} games live`}${m.stale ? ', scores may be behind' : ''}`
    : m.kind === 'quiet' ? 'nothing live right now' : m.kind === 'locked' ? 'week locked' : m.kind === 'allfinal' ? 'all games final'
    : m.kind === 'final' ? `week ${m.weekN ?? ''} final` : `week ${m.weekN ?? ''}`;
  return `Game Day, ${what}.`;
}

// ═══ markup ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

const joinHtml = (parts) => parts.join('');

function pillHTML(p, { escHtml, numHtml }) {
  const tag = p.sportLabel ? `<span class="gdp-sp">${escHtml(p.sportLabel)}</span>` : '';
  const score = `${escHtml(p.away)} ${numHtml(p.awayScore)} – ${escHtml(p.home)} ${numHtml(p.homeScore)}`;
  const cover = p.stale ? '' : (p.coverWord ? ` · <span class="gdp-cv gdp-cv--${escHtml(p.coverage)}">${escHtml(p.coverWord)}</span>` : '');
  const l2 = p.stale ? '<span class="gdp-cv gdp-cv--stale">Score may be behind</span>' : `${escHtml(p.clock)}${cover}`;
  return `<button type="button" class="gdp${p.stale ? ' gdp--stale' : ''}" data-key="p:${escHtml(p.gameId)}" data-home-action="gd-pill" data-game-id="${escHtml(p.gameId)}" data-haptic="light" aria-label="${escHtml(p.aria)}"><span class="gdp-l1"><span data-bind="score">${score}</span>${tag}</span><span class="gdp-l2" data-bind="l2">${l2}</span></button>`;
}

/** The pill's fields as they are patched in place on a score tick (patchKeyedRows' `bind` map): the score text, the second line and the spoken label — nothing else is touched. */
export function pillBind(p, { escHtml, numHtml }) {
  const stale = p.stale;
  return {
    score: { text: `${p.away} ${p.awayScore ?? ''} – ${p.home} ${p.homeScore ?? ''}` },
    l2: { text: stale ? 'Score may be behind' : `${p.clock}${p.coverWord ? ` · ${p.coverWord}` : ''}` },
  };
}

/**
 * @param {object} model  gameDayModel's result
 * @param {{escHtml:Function, numHtml:Function, expanded?:boolean, bodyHTML?:string, railHidden?:boolean, chevHtml?:string}} ctx
 *        `bodyHTML` is the open card's finished body (js/gameday-sheet.js), SPLICED, never interpolated.
 */
export function gameDayCardHTML(model, { escHtml, numHtml, expanded = false, bodyHTML = '', railHidden = false, chevHtml = '' } = {}) {
  requireFn(escHtml, 'escHtml', 'gameDayCardHTML');
  requireFn(numHtml, 'numHtml', 'gameDayCardHTML');
  const m = model && typeof model === 'object' ? model : {};
  const open = expanded === true && m.expandable === true;
  const h = m.header || {};
  // DI-603 (fix round 1): under accessibility-size text (railHidden) the header alone is the card and the personal line DROPS INTO THE OPEN CARD (gameday-sheet.js draws it there) — unless the card cannot open,
  // in which case it stays here: there is nowhere else to put the fact.
  const me = h.me && !(railHidden && m.expandable === true) ? `<span class="gd-me"${h.meAria ? ` aria-label="${escHtml(h.meAria)}"` : ''}>${escHtml(h.me)}</span>` : '';
  const tail = h.staleChip ? '<span class="gd-stalechip">Scores may be behind</span>' : (h.tail ? `<span class="gd-cnt">${escHtml(h.tail)}</span>` : '');
  const dot = m.kind === 'live' ? '<span class="gd-dot" aria-hidden="true"></span>' : '';
  const inner = `${dot}<span class="gd-lab">${escHtml(GAME_DAY_NAME)}</span>${tail}${me}`;
  const chev = `<span class="gd-chev" aria-hidden="true">${chevHtml}</span>`;   // chevHtml is the caller's finished constant glyph (the icon family's chevronLeft, turned by CSS), SPLICED
  const aria = `${h.aria || 'Game Day.'} ${open ? 'Collapse.' : (m.expandable ? 'Expand.' : '')}`.trim();
  const head = m.expandable
    ? `<button type="button" class="gd-head" data-home-action="gd-toggle" data-haptic="light" aria-expanded="${open ? 'true' : 'false'}" aria-controls="gd-x" aria-label="${escHtml(aria)}">${inner}${chev}</button>`
    : `<div class="gd-head gd-head--static">${inner}</div>`;
  let content = '';
  if (open) content = bodyHTML;
  else if (m.body && m.body.type === 'pills') {
    if (!railHidden) {
      const pills = asArray(m.pills).map(p => pillHTML(p, { escHtml, numHtml })).join('');
      const more = m.morePill ? `<button type="button" class="gdp gdp--more" data-key="p:more" data-home-action="gd-more" data-haptic="light" aria-label="${escHtml(`All ${m.morePill.count} live games. Opens Game Day.`)}"><span class="gdp-l1">All ${numHtml(m.morePill.count)} ›</span></button>` : '';
      content = `<div class="gd-rail" data-gd-rail role="group" aria-label="Live games">${pills}${more}</div>`;
    }
  } else if (m.body && (m.body.type === 'message' || m.body.type === 'action')) {
    const b = m.body;
    const btn = b.action ? `<button type="button" class="btn feed-action feed-action--${escHtml(b.action.tone || 'solid')} gd-btn" data-home-action="go-tab" data-tab="${escHtml(b.action.tab)}"${isStr(b.action.sport) ? ` data-sport="${escHtml(b.action.sport)}"` : ''}${isStr(b.action.weekId) ? ` data-week-id="${escHtml(b.action.weekId)}"` : ''} data-haptic="${b.action.tone === 'solid' ? 'medium' : 'light'}">${escHtml(b.action.label)}</button>` : '';
    // DI-603 / DI-599 / D-54: the Final card's "· Next: …" is its own span. Where the text column is too narrow for its font (the smallest phone at the largest standard text) CSS folds it away, so the collapsed
    // card keeps to the 33% cap; it is never lost — the OPEN card always carries the full What's next sentence (gameday-sheet.js).
    const nx = isStr(b.next) ? `<span class="gd-next">${b.line ? ' · ' : ''}${escHtml(b.next)}</span>` : '';
    content = `<div class="gd-msg"><div class="gd-tx"><b>${escHtml(b.title || '')}</b>${b.line || nx ? `<span>${escHtml(b.line || '')}${nx}</span>` : ''}</div>${btn}</div>`;
  }
  // The polite live region (DI-604, Std-7): in the page from the first paint and always EMPTY in the markup — js/home.js writes a sentence into it (a cover flip, a game ending) only while focus is in the card.
  const live = '<p class="sr-only" data-gd-live role="status" aria-live="polite" aria-atomic="true"></p>';
  return joinHtml([`<section class="gd${open ? ' is-open' : ''}" id="gd-card" data-gd-kind="${escHtml(m.kind || '')}" data-gd-expanded="${open ? 'true' : 'false'}" aria-label="${escHtml(GAME_DAY_NAME)}">`, head, content, live, '</section>']);
}

/** The loading state: the same height as the live card (a header and two skeleton pills), so the feed does not shift when the real card arrives (DI-603). */
export function gameDaySkeletonHTML({ escHtml } = {}) {
  requireFn(escHtml, 'escHtml', 'gameDaySkeletonHTML');
  return `<section class="gd gd--skeleton" aria-label="${escHtml(GAME_DAY_NAME)}" aria-hidden="true"><div class="gd-head gd-head--static"><span class="gd-lab">${escHtml(GAME_DAY_NAME)}</span></div><div class="gd-rail"><span class="gdp gdp--skel"></span><span class="gdp gdp--skel"></span></div></section>`;
}
