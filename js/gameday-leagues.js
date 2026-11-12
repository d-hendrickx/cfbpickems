/**
 * CFB Pickems — gameday-leagues.js (Deployment 2, thread 101826-D2, lane 3 "Personal Home"; DI-817 … DI-827, UN/PF-509, UN/PF-517)
 * ================================================================================================================================
 * GAME DAY ACROSS LEAGUES, for a member of TWO OR MORE leagues (a one-league member keeps js/gameday.js's card byte for byte: gate J, DI-813). The compact red card summarises
 * rather than enumerates: at most five live pills, ranked (js/home-rank.js), the first live game of every (league, sport) pair protected; ONE summary line under them; "+n more";
 * the open card's top five rows; the Full Game Day screen (js/full-gameday.js) holds everything. Every item carries its provenance ("Residency · NHL").
 *
 *   crossLeagueGameDay(input)          PURE. The model (see the parameter block). Holds games, phases, counts and the VIEWER'S OWN pick and coverage only (C3), per league.
 *   crossLeagueCardHTML(model, ctx)    the collapsed / open card shell: the SAME classes, keys and actions as gameday.js's, so js/gameday-dom.js patches it in place
 *   crossLeagueBodyHTML(model, ctx)    the open card's body: rows through js/gameday-sheet.js gameRowHTML, footer "All {n} games ›" + Collapse
 *   SUMMARY_DUE_WITHIN_MS, PILL_CAP_MULTI   the named constants (DI-818 / DI-820)
 *
 * SECURITY: no other member's anything is in the model — a row's line 4 (the league's picks) is drawn only for the ACTIVE league's rows, through the caller's `resolve` (the shipped
 * gate over the active league's own seam); a row of another league never draws it (that gate reads the active league's picks by game id, and ids are unique only per league).
 * Imports gameday-sheet.js (the row) and nothing that reads storage itself.
 */
import { gameRowHTML } from './gameday-sheet.js';
import { rankItems, pickPills } from './home-rank.js';

export const PILL_CAP_MULTI = 5;
/**
 * DI-825 (measured, gdleaguesbrowsertest [1]): the cross-league card carries one more line per pill (its league chip) and the summary line, so at 1.35x text on a 375 x 667 phone a drawn rail takes it to
 * 40.7% of the content window. It therefore stops drawing its rail from 1.3x (the header says "n live · m due" and the summary line stays), where the one-league card's shipped RAIL_HIDDEN_SCALE is 1.5x.
 */
export const MULTI_RAIL_HIDDEN_SCALE = 1.3;
export const ROW_CAP_MULTI = 5;
/** DI-820 rung 1: a pick deadline within this window is "due" (the rung "Also due" takes the rest). */
export const SUMMARY_DUE_WITHIN_MS = 6 * 60 * 60 * 1000;
/** DI-819 rung 5: a week finalized this recently makes the card's kind "final". */
export const FINAL_RECENT_MS = 24 * 60 * 60 * 1000;

const isStr = (v) => typeof v === 'string' && v !== '';
const arr = (v) => (Array.isArray(v) ? v : []);
const num = (v) => { if (v === null || v === undefined || String(v).trim() === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const toMs = (v) => { if (typeof v === 'number') return Number.isFinite(v) ? v : null; const ms = v ? Date.parse(v) : NaN; return Number.isFinite(ms) ? ms : null; };
const requireFn = (f, name, who) => { if (typeof f !== 'function') throw new TypeError(`${who}() requires an injected ${name} function (CONVENTIONS #12, security C5): there is no fallback`); return f; };
const LIVE = new Set(['live', 'live-stale']);
const chipOf = (lg, code) => (code ? `${lg.leagueLabel} · ${code}` : lg.leagueLabel);
const ariaLead = (lg, code) => (code ? `${lg.leagueName || lg.leagueLabel}, ${code}` : (lg.leagueName || lg.leagueLabel));
export const itemIdOf = (leagueId, gameId) => `${leagueId}|${gameId}`;

/** "4:12 - 3rd" -> "Q3" (the pill's short clock; the shipped rule, js/gameday.js shortStatus). */
function shortClock(label) {
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
const sentence = (cov) => {
  const by = cov && cov.margin ? ` by ${cov.margin}` : '';
  switch (cov && cov.kind) {
    case 'covering': return `You're covering${by}.`;
    case 'trailing': return `You're trailing${by}.`;
    case 'even': return "You're right on the number.";
    case 'covered': return `You covered${by}.`;
    case 'missed': return `You missed${by}.`;
    case 'push': return 'Your pick was a push.';
    default: return '';
  }
};
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
 *   leagues   [{ league: { leagueId, leagueName, leagueLabel, order }, active, viewerId, status ('ready'|'stale'|'never'|'loading'|'partial'), asOf, state (that league's Now-card state),
 *               entries (js/home.js gameDayEntries for THAT league's snapshot: each { game, weekId, sport, entered, phase, ownTeam, lineText, awayAbbr, homeAbbr }),
 *               due: [{ weekId, sport, sportCode, lockMs, remaining, total, entered, done }], finals: [{ weekId, sport, sportCode, weekN, finalizedMs }],
 *               myTeams: Set, personal ({ text, aria } | null — the active league's own), stats ({ lines, notes } | null) }]
 *   now, fmt { time(ms), countdown(ms), clock(ms) }, coverOf(game, team, phase), facts (peekFacts records, DI-824 — [] until the analytics lane ships), activity(leagueId) -> number | null, sameDay(ms)
 */
export function crossLeagueGameDay(input = {}) {
  const i = input && typeof input === 'object' ? input : {};
  const now = num(i.now) ?? 0;
  const fmt = { time: (v) => String(v ?? ''), countdown: (ms) => String(ms ?? ''), clock: (ms) => String(ms ?? ''), ...(i.fmt || {}) };
  const leagues = arr(i.leagues).filter((l) => l && l.league && isStr(l.league.leagueId));
  const items = [];
  for (const L of leagues) {
    for (const e of arr(L.entries)) {
      if (!e || !e.game) continue;
      const g = e.game;
      const code = isStr(e.sportCode) ? e.sportCode : (isStr(e.sport) ? e.sport.toUpperCase() : '');
      const cov = coverageOf(e, L.viewerId, i.coverOf);
      const p = e.phase || {};
      items.push({
        itemId: itemIdOf(L.league.leagueId, g.gameId), gameId: String(g.gameId), weekId: String(e.weekId || g.weekId || ''), leagueId: L.league.leagueId, leagueOrder: L.league.order || 0,
        active: L.active === true, league: L.league, sport: e.sport || '', sportCode: code, chip: chipOf(L.league, code), lead: ariaLead(L.league, code),
        game: g, entered: !!e.entered, ownTeam: e.ownTeam || null, coverage: cov, phase: p.phase || 'upcoming', phaseObj: p,
        kickoffMs: toMs(g.kickoff), finalMs: toMs(g.lastUpdated), liveLabel: p.label || '', lineText: e.lineText || '',
        away: e.awayAbbr || g.awayTeam, home: e.homeAbbr || g.homeTeam, awayName: g.awayTeam, homeName: g.homeTeam, awayScore: num(g.awayScore), homeScore: num(g.homeScore),
        coverMargin: cov.kind === 'covering' ? num(cov.margin) : cov.kind === 'trailing' ? -(num(cov.margin) || 0) : cov.kind === 'even' ? 0 : null,
        teams: [g.awayTeam, g.homeTeam], eventKey: `${e.sport || ''}|${g.espnEventId || g.espnId || g.gameId}`,
        closeScore: num(g.awayScore) !== null && num(g.homeScore) !== null && Math.abs(num(g.awayScore) - num(g.homeScore)) <= ((e.sport === 'nhl') ? 1 : 8),
      });
    }
  }
  const myTeams = new Set();
  for (const L of leagues) for (const t of (L.myTeams instanceof Set ? L.myTeams : [])) myTeams.add(t);
  const facts = new Set(arr(i.facts).map((f) => f && isStr(f.itemId) ? f.itemId : null).filter(Boolean));
  const ranked = rankItems(items, { now, myTeams, facts, sameDay: i.sameDay });
  const live = ranked.filter((x) => LIVE.has(x.phase));
  const upcoming = ranked.filter((x) => !LIVE.has(x.phase) && x.phase !== 'final');
  const finals = ranked.filter((x) => x.phase === 'final');
  const inScope = new Set(items.map((x) => x.leagueId));

  // ── pills: ranked, protected per (league, sport); the same game in two leagues is ONE pill when the viewer's coverage kind is the same in both (DI-817) ──
  const merged = [];
  const byEvent = new Map();
  for (const it of live) {
    const prev = byEvent.get(it.eventKey);
    if (prev && prev.coverage.kind === it.coverage.kind && prev.leagueId !== it.leagueId) { prev.also.push(it); continue; }
    const m = { ...it, also: [] };
    merged.push(m);
    if (!prev) byEvent.set(it.eventKey, m);
  }
  const picked = pickPills(merged, PILL_CAP_MULTI);
  const pillOf = (it) => {
    const leaguesOn = [it.league, ...it.also.map((a) => a.league)];
    const chip = it.also.length ? `${leaguesOn.map((l) => l.leagueLabel).join(', ')} · ${it.sportCode}` : it.chip;
    const lead = it.also.length ? `${leaguesOn.map((l) => l.leagueName || l.leagueLabel).join(' and ')}, ${it.sportCode}` : it.lead;
    const stale = it.phase === 'live-stale';
    const c = it.coverage.kind;
    const word = c === 'covering' ? '▲ Covering' : c === 'trailing' ? '▽ Trailing' : c === 'even' ? 'On the number' : c === 'none' ? 'No pick' : '';
    const route = !it.active;
    return {
      itemId: it.itemId, gameId: it.gameId, leagueId: it.leagueId, active: it.active, chip, away: it.away, home: it.home, awayScore: it.awayScore, homeScore: it.homeScore,
      clock: stale ? '' : shortClock(it.liveLabel), stale, coverage: c, coverWord: word,
      aria: `${lead}. ${it.awayName} ${it.awayScore ?? ''}, ${it.homeName} ${it.homeScore ?? ''}, ${stale ? 'score may be behind' : (it.liveLabel || 'live')}.${sentence(it.coverage) ? ` ${sentence(it.coverage)}` : ''} ${route ? `Opens ${it.league.leagueName || it.league.leagueLabel}.` : 'Opens Game Day.'}`,
    };
  };
  const pills = picked.pills.map(pillOf);

  // ── the due picks, across leagues (soonest first) ──
  const dueAll = [];
  for (const L of leagues) for (const d of arr(L.due)) {
    if (!d || num(d.lockMs) === null || num(d.lockMs) <= now || d.entered === false) continue;
    dueAll.push({ ...d, leagueId: L.league.leagueId, league: L.league, active: L.active === true, id: `due:${L.league.leagueId}:${d.weekId}` });
  }
  dueAll.sort((a, b) => (a.lockMs - b.lockMs) || ((a.league.order || 0) - (b.league.order || 0)));
  const pending = dueAll.filter((d) => d.done !== true);
  const allIn = dueAll.filter((d) => d.done === true);
  const routePicks = (d) => ({ leagueId: d.leagueId, destination: { tab: 'picks', params: { ...(isStr(d.sport) ? { sport: d.sport } : {}) } } });

  // ── the ladder (DI-819) ──
  let kind, expandable = items.length > 0;
  const header = { label: 'Game Day', tail: '', staleChip: false };
  const body = { type: 'none' };
  const leftText = (ms) => (ms - now <= SUMMARY_DUE_WITHIN_MS ? `in ${fmt.countdown(ms - now)}` : fmt.time(ms));
  if (live.length) {
    kind = 'live';
    const stale = live.every((x) => x.phase === 'live-stale');
    header.tail = stale ? '' : `· ${live.length} live`;
    header.staleChip = stale;
    body.type = 'pills';
  } else if (pending.length) {
    kind = 'open-due';
    const d = pending[0];
    const left = d.lockMs - now;
    body.type = 'action';
    body.title = `Picks lock ${left <= SUMMARY_DUE_WITHIN_MS ? `in ${fmt.countdown(left)}` : fmt.time(d.lockMs)}`;
    // the approved mockup's form ("Residency · NHL · 3 picks left"): short enough to stay beside the button at large text (gdleaguesbrowsertest [1a])
    const rem = num(d.remaining);
    body.line = `${chipOf(d.league, d.sportCode)} · ${rem !== null && rem > 0 ? `${rem} ${rem === 1 ? 'pick' : 'picks'} left` : 'picks open'}`;
    body.action = { label: 'Make picks', tone: 'solid', route: routePicks(d), id: d.id };
    header.tail = '· Picks due';
  } else if (allIn.length) {
    kind = 'open-in';
    const d = allIn[0];
    body.type = 'action';
    body.title = `You're in for ${chipOf(d.league, d.sportCode)}`;
    body.line = `locks ${fmt.time(d.lockMs)}`;
    body.action = { label: 'Edit picks', tone: 'outline', route: routePicks(d), id: d.id };
    header.tail = '· Picks in';
  } else if (leagues.some((L) => L.state === 'locked-far' || L.state === 'locked-near')) {
    kind = 'locked';
    header.tail = '· Locked';
    const lockedIds = new Set(leagues.filter((L) => L.state === 'locked-far' || L.state === 'locked-near').map((L) => L.league.leagueId));
    const first = upcoming.filter((x) => lockedIds.has(x.leagueId) && x.kickoffMs !== null && x.kickoffMs > now).sort((a, b) => a.kickoffMs - b.kickoffMs)[0] || null;
    body.type = 'message';
    body.title = first ? `First kickoff ${fmt.time(first.kickoffMs)}` : 'Picks are locked';
    body.line = first ? `${first.chip} · in ${fmt.countdown(first.kickoffMs - now)}` : 'Reveal comes as the week goes live';
  } else {
    const recentFinal = [];
    for (const L of leagues) for (const f of arr(L.finals)) if (f && num(f.finalizedMs) !== null && now - f.finalizedMs >= 0 && now - f.finalizedMs <= FINAL_RECENT_MS) recentFinal.push({ ...f, league: L.league, leagueId: L.league.leagueId });
    recentFinal.sort((a, b) => b.finalizedMs - a.finalizedMs);
    const next = upcoming.filter((x) => x.kickoffMs !== null && x.kickoffMs > now).sort((a, b) => a.kickoffMs - b.kickoffMs)[0] || null;
    if (recentFinal.length) {
      kind = 'final';
      const f = recentFinal[0];
      header.tail = '· Week final';
      body.type = 'action';
      body.title = `${chipOf(f.league, f.sportCode)} ${isStr(f.slate) ? f.slate : `Week ${f.weekN ?? ''}`} is final.`.replace(' .', '.');   // int/v0.31.0: a night's label (js/slate-name.js via Home)
      body.line = '';
      body.action = { label: 'Results', tone: 'solid', route: { leagueId: f.leagueId, destination: { tab: 'leaderboard', params: { ...(isStr(f.sport) ? { sport: f.sport } : {}), ...(isStr(f.weekId) ? { weekId: f.weekId } : {}) } } }, id: `final:${f.leagueId}:${f.weekId}` };
    } else {
      kind = 'quiet';
      header.tail = '· Nothing live right now';
      body.type = 'message';
      body.title = next ? `Next kickoff ${fmt.time(next.kickoffMs)}` : 'Nothing live right now';
      body.line = next ? `${next.awayName} at ${next.homeName} · ${next.chip}` : '';
    }
  }
  if (items.length === 0) expandable = false;
  const leagueCount = inScope.size;
  header.me = leagueCount >= 2 ? `${leagueCount} leagues` : '';
  const only = leagueCount === 1 ? leagues.find((L) => inScope.has(L.league.leagueId)) : null;
  if (only && only.active && only.personal && isStr(only.personal.text) && (kind === 'live' || kind === 'quiet' || kind === 'final')) { header.me = only.personal.text; header.meAria = only.personal.aria || ''; }

  // ── the summary line (DI-820): at most ONE item, the first that exists ──
  let summary = null;
  const fail = leagues.find((L) => !L.active && (L.status === 'stale' || L.status === 'never' || L.status === 'partial'));
  const duePending = kind === 'open-due' ? pending.slice(1) : pending;
  const soon = duePending.find((d) => d.lockMs - now <= SUMMARY_DUE_WITHIN_MS);
  const factLine = arr(i.facts).find((f) => f && isStr(f.leagueId) && inScope.has(f.leagueId) && f.basis === 'live-projection' && num(f.toRank) !== null && num(f.fromRank) !== null && f.toRank < f.fromRank);
  let activityOne = null;
  if (typeof i.activity === 'function') for (const L of leagues) { let n = null; try { n = i.activity(L.league.leagueId); } catch { n = null; } if (num(n) !== null && n > 0) { activityOne = { L, n }; break; } }
  const alsoDue = duePending.find((d) => d !== soon) || (soon ? null : duePending[0]);
  if (fail) {
    const name = fail.league.leagueName || fail.league.leagueLabel;
    summary = fail.status === 'partial'
      ? { id: `fail:${fail.league.leagueId}`, kind: 'route', route: { leagueId: fail.league.leagueId, destination: { tab: 'dashboard', params: {} } }, text: `${name} has too much this season to show here. Tap to open it.` }   // reviewer R1: said, never silently omitted; opening it is the way to see it
      : fail.status === 'never'
      ? { id: `fail:${fail.league.leagueId}`, kind: 'retry', leagueId: fail.league.leagueId, text: `Couldn't load ${name}. Tap to retry.` }
      : { id: `fail:${fail.league.leagueId}`, kind: 'retry', leagueId: fail.league.leagueId, text: `${name} couldn't refresh. Showing ${fmt.clock(fail.asOf)}. Tap to retry.` };
  } else if (soon) {
    const n = num(soon.remaining);
    summary = { id: soon.id, kind: 'route', route: routePicks(soon), text: `${chipOf(soon.league, soon.sportCode)} picks lock ${leftText(soon.lockMs)}.${n !== null && n > 0 ? ` You have ${n} left.` : ''}` };
  } else if (factLine) {
    const L = leagues.find((x) => x.league.leagueId === factLine.leagueId);
    const ord = (k) => { const s = ['th', 'st', 'nd', 'rd'], v = k % 100; return `${k}${s[(v - 20) % 10] || s[v] || s[0]}`; };
    summary = { id: `fact:${factLine.leagueId}:${factLine.weekId}`, kind: 'route', route: { leagueId: factLine.leagueId, destination: { tab: 'leaderboard', params: { ...(isStr(factLine.sport) ? { sport: factLine.sport } : {}) } } }, text: `If the live games hold, you move up to ${ord(factLine.toRank)} in ${L ? (L.league.leagueName || L.league.leagueLabel) : 'your league'}.` };
  } else if (activityOne) {
    summary = { id: `chat:${activityOne.L.league.leagueId}`, kind: 'route', route: { leagueId: activityOne.L.league.leagueId, destination: { tab: 'chat', params: {} } }, text: `${activityOne.n} new in the ${activityOne.L.league.leagueName || activityOne.L.league.leagueLabel} Locker Room.` };
  } else if (alsoDue) {
    summary = { id: alsoDue.id, kind: 'route', route: routePicks(alsoDue), text: `Also due: ${chipOf(alsoDue.league, alsoDue.sportCode)} picks lock ${fmt.time(alsoDue.lockMs)}.` };
  }
  const summarySkeleton = !summary && leagues.some((L) => !L.active && L.status === 'loading');

  // ── rows of the open card: the top five by score, grouped Live / Upcoming / Final ──
  const top = ranked.slice(0, ROW_CAP_MULTI);
  const rows = top.map((it) => ({
    gameId: it.itemId, weekId: it.weekId, sport: it.sport, sportLabel: it.sportCode, chip: it.chip, entered: it.entered, active: it.active,
    away: it.awayName, home: it.homeName, awayAbbr: it.away, homeAbbr: it.home, awayScore: it.awayScore, homeScore: it.homeScore,
    phase: it.phase, status: it.phase === 'live' ? (it.liveLabel || 'Live') : it.phase === 'live-stale' ? 'Score may be behind' : it.phase === 'final' ? 'Final' : (it.phaseObj.label || ''),
    kickoff: it.phase === 'upcoming' ? String(it.phaseObj.label || '') : '', group: LIVE.has(it.phase) ? 'live' : it.phase === 'final' ? 'final' : 'upcoming',
    line: it.lineText, coverage: it.coverage.kind, coverMargin: it.coverage.margin || '', coverTeam: it.coverage.team || '', fresh: it.phaseObj.fresh,
  }));
  // the announcer (Std-7): per item, the phase, the score and the viewer's own coverage, led by its league ("Final in IRB, CFB: …")
  const shownIds = new Set([...pills.map((p) => p.itemId), ...rows.map((r) => r.gameId)]);
  const watch = ranked.map((it) => ({ gameId: it.itemId, phase: it.phase, away: it.awayName, home: it.homeName, awayScore: it.awayScore, homeScore: it.homeScore, entered: it.entered, coverage: it.coverage.kind, margin: it.coverage.margin || '', shown: shownIds.has(it.itemId), lead: it.lead }));
  const only1 = leagueCount === 1 && only && only.active ? only.stats : null;
  const model = {
    multi: true, kind, expandable, leagueCount,
    header, body, pills, morePill: picked.rest > 0 ? { count: picked.rest } : null,
    summary, summarySkeleton,
    rows, rowsRest: Math.max(0, ranked.length - rows.length), totalCount: ranked.length, liveCount: live.length, upcomingCount: upcoming.length, finalCount: finals.length,
    sub: `${live.length} live · ${upcoming.length} upcoming · ${finals.length} final · ${leagueCount === 1 ? '1 league' : `${leagueCount} leagues`}`,
    stats: only1 && typeof only1 === 'object' ? { lines: arr(only1.lines).filter(isStr), notes: arr(only1.notes).filter(isStr) } : null,
    footer: { label: `All ${ranked.length} ${ranked.length === 1 ? 'game' : 'games'} ›` },
    items: ranked.map((it) => ({ itemId: it.itemId, gameId: it.gameId, weekId: it.weekId, leagueId: it.leagueId, leagueName: it.league.leagueName, active: it.active, sport: it.sport, sportCode: it.sportCode, chip: it.chip, lead: it.lead,
      phase: it.phase, kickoffMs: it.kickoffMs, finalMs: it.finalMs, awayName: it.awayName, homeName: it.homeName, awayScore: it.awayScore, homeScore: it.homeScore, liveLabel: it.liveLabel, upcomingLabel: String(it.phaseObj.label || ''),
      line: it.lineText, coverage: it.coverage.kind, coverMargin: it.coverage.margin || '', coverTeam: it.coverage.team || '', entered: it.entered, score: it.score })),
    due: dueAll.map((d) => ({ id: d.id, leagueId: d.leagueId, leagueName: d.league.leagueName, chip: chipOf(d.league, d.sportCode), sport: d.sport, lockMs: d.lockMs, remaining: num(d.remaining), total: num(d.total), done: d.done === true, route: routePicks(d) })),
    watch,
  };
  model.header.aria = `Game Day, ${kind === 'live' ? `${live.length} live` : kind === 'quiet' ? 'nothing live right now' : kind === 'open-due' ? 'picks due' : kind === 'open-in' ? 'your picks are in' : kind === 'final' ? 'a week is final' : 'quiet'}${leagueCount >= 2 ? ` in ${leagueCount} leagues` : ''}.`;
  return model;
}

/** What a tap on a Game Day control of the CURRENT paint may do, by id (the DOM is untrusted, Std-9): pills, rows, the summary line and the body action. */
export function crossLeagueTargets(model) {
  const m = model && typeof model === 'object' ? model : {};
  const items = new Map(arr(m.items).map((it) => [it.itemId, it]));
  const summary = m.summary ? new Map([[m.summary.id, m.summary]]) : new Map();
  const action = m.body && m.body.action && m.body.action.id ? new Map([[m.body.action.id, m.body.action]]) : new Map();
  return { items, summary, action, due: new Map(arr(m.due).map((d) => [d.id, d])) };
}

// ═══ markup ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════

function pillHTML(p, { escHtml, numHtml }) {
  const score = `${escHtml(p.away)} ${numHtml(p.awayScore)} – ${escHtml(p.home)} ${numHtml(p.homeScore)}`;
  const cover = p.stale ? '' : (p.coverWord ? ` · <span class="gdp-cv gdp-cv--${escHtml(p.coverage)}">${escHtml(p.coverWord)}</span>` : '');
  const l2 = p.stale ? '<span class="gdp-cv gdp-cv--stale">Score may be behind</span>' : (p.clock ? `${escHtml(p.clock)}${cover}` : cover.replace(/^ · /, ''));   // a peeked game has no live clock label (its row carries none): no dangling separator
  return `<button type="button" class="gdp gdp--lg${p.stale ? ' gdp--stale' : ''}" data-key="p:${escHtml(p.itemId)}" data-home-action="gd-pill" data-game-id="${escHtml(p.itemId)}" data-haptic="light" aria-label="${escHtml(p.aria)}"><span class="gdp-l0">${escHtml(p.chip)}</span><span class="gdp-l1"><span data-bind="score">${score}</span></span><span class="gdp-l2" data-bind="l2">${l2}</span></button>`;
}

/** The summary line (or its reserved skeleton, so the card never changes height when another league lands). */
function summaryHTML(m, { escHtml, chevHtml = '' }) {
  if (m.summary) return `<button type="button" class="gd-sum" data-key="sum" data-home-action="gd-summary" data-sum-id="${escHtml(m.summary.id)}" data-haptic="light"><span class="gd-sum-t">${escHtml(m.summary.text)}</span><span class="gd-sum-chev" aria-hidden="true">${chevHtml}</span></button>`;
  if (m.summarySkeleton) return '<div class="gd-sum gd-sum--skel" data-key="sum" aria-hidden="true"><span class="gd-sum-bar"></span></div>';
  return '';
}

/**
 * The card. `ctx` = { escHtml, numHtml, expanded, bodyHTML (the open body, SPLICED), railHidden, chevHtml (the header's glyph), rowChevHtml (the summary's glyph) }.
 */
export function crossLeagueCardHTML(model, { escHtml, numHtml, expanded = false, bodyHTML = '', railHidden = false, chevHtml = '', sumChevHtml = '' } = {}) {
  requireFn(escHtml, 'escHtml', 'crossLeagueCardHTML');
  requireFn(numHtml, 'numHtml', 'crossLeagueCardHTML');
  const m = model && typeof model === 'object' ? model : {};
  const open = expanded === true && m.expandable === true;
  const h = m.header || {};
  // at accessibility sizes the rail is not drawn (the shipped RAIL_HIDDEN_SCALE): the header carries "4 live · 2 due" and the summary line stays
  const dueCount = arr(m.due).filter((d) => !d.done).length;
  const tailText = railHidden && m.kind === 'live' ? `· ${m.liveCount} live${dueCount ? ` · ${dueCount} due` : ''}` : h.tail;
  const me = h.me ? `<span class="gd-me"${h.meAria ? ` aria-label="${escHtml(h.meAria)}"` : ''}>${escHtml(h.me)}</span>` : '';
  const tail = h.staleChip ? '<span class="gd-stalechip">Scores may be behind</span>' : (tailText ? `<span class="gd-cnt">${escHtml(tailText)}</span>` : '');
  const dot = m.kind === 'live' ? '<span class="gd-dot" aria-hidden="true"></span>' : '';
  const inner = `${dot}<span class="gd-lab">Game Day</span>${tail}${me}`;
  const chev = `<span class="gd-chev" aria-hidden="true">${chevHtml}</span>`;
  const aria = `${h.aria || 'Game Day.'} ${open ? 'Collapse.' : (m.expandable ? 'Expand.' : '')}`.trim();
  const head = m.expandable
    ? `<button type="button" class="gd-head" data-home-action="gd-toggle" data-haptic="light" aria-expanded="${open ? 'true' : 'false'}" aria-controls="gd-x" aria-label="${escHtml(aria)}">${inner}${chev}</button>`
    : `<div class="gd-head gd-head--static">${inner}</div>`;
  let content = '';
  if (open) content = bodyHTML;
  else {
    if (m.body && m.body.type === 'pills') {
      if (!railHidden) {
        const pills = arr(m.pills).map((p) => pillHTML(p, { escHtml, numHtml })).join('');
        const more = m.morePill ? `<button type="button" class="gdp gdp--more gdp--lg" data-key="p:more" data-home-action="gd-full" data-haptic="light" aria-label="${escHtml(`${m.morePill.count} more ${m.morePill.count === 1 ? 'game' : 'games'}. Opens all of Game Day.`)}"><span class="gdp-l1">+${numHtml(m.morePill.count)} more</span></button>` : '';
        content = `<div class="gd-rail" data-gd-rail role="group" aria-label="Live games">${pills}${more}</div>`;
      }
    } else if (m.body && (m.body.type === 'message' || m.body.type === 'action')) {
      const b = m.body;
      const btn = b.action ? `<button type="button" class="btn feed-action feed-action--${escHtml(b.action.tone || 'solid')} gd-btn" data-home-action="gd-route" data-route-id="${escHtml(b.action.id)}" data-haptic="${b.action.tone === 'solid' ? 'medium' : 'light'}">${escHtml(b.action.label)}</button>` : '';
      content = `<div class="gd-msg"><div class="gd-tx"><b>${escHtml(b.title || '')}</b>${b.line ? `<span>${escHtml(b.line)}</span>` : ''}</div>${btn}</div>`;
    }
    content += summaryHTML(m, { escHtml, chevHtml: sumChevHtml });
  }
  const live = '<p class="sr-only" data-gd-live role="status" aria-live="polite" aria-atomic="true"></p>';
  return [`<section class="gd gd--multi${open ? ' is-open' : ''}" id="gd-card" data-gd-kind="${escHtml(m.kind || '')}" data-gd-expanded="${open ? 'true' : 'false'}" aria-label="Game Day">`, head, content, live, '</section>'].join('');
}

/** The open card's body: the sub-line, "Your numbers" (one league in scope only), the top five rows, and "All {n} games ›" + Collapse. */
export function crossLeagueBodyHTML(model, ctx = {}) {
  const { escHtml, numHtml } = ctx;
  requireFn(escHtml, 'escHtml', 'crossLeagueBodyHTML');
  requireFn(numHtml, 'numHtml', 'crossLeagueBodyHTML');
  const m = model && typeof model === 'object' ? model : {};
  const rows = arr(m.rows);
  const c = { ...ctx, showSport: false, resolve: (row) => (row && row.active && typeof ctx.resolve === 'function' ? ctx.resolve(row) : null) };   // line 4 for the ACTIVE league's rows only
  const lines = m.stats ? m.stats.lines : [], notes = m.stats ? m.stats.notes : [];
  const stats = lines.length || notes.length ? `<div class="gd-stats">${lines.map((l) => `<p class="gd-stat">${escHtml(l)}</p>`).join('')}${notes.map((n) => `<p class="gd-stat gd-stat--note">${escHtml(n)}</p>`).join('')}</div>` : '';
  const sec = (label, g) => { const x = rows.filter((r) => r.group === g); return x.length ? `<p class="gd-lbl" data-key="lbl:${escHtml(label)}">${escHtml(label)} · ${numHtml(x.length)}</p>` + x.map((r) => gameRowHTML(r, c)).join('') : ''; };
  const list = sec('Live', 'live') + sec('Upcoming', 'upcoming') + sec('Final', 'final');
  const foot = `<div class="gd-foot"><button type="button" class="btn feed-action feed-action--solid gd-btn" data-home-action="gd-full" data-haptic="light">${escHtml(m.footer ? m.footer.label : 'All games ›')}</button><button type="button" class="btn feed-action feed-action--outline gd-btn" data-home-action="gd-collapse" data-haptic="light">Collapse</button></div>`;
  return ['<div class="gd-x" id="gd-x" role="region" aria-labelledby="gd-h"><h3 class="gd-h" id="gd-h" tabindex="-1">Game Day</h3>', `<p class="gd-sub">${escHtml(m.sub || '')}</p>`, stats, `<div class="gd-list" data-gd-list>${list}</div>`, foot, '</div>'].join('');
}
