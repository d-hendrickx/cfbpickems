/**
 * CFB Pickems — sport-stall.js (D1 / v0.30.0, DI-557 + DI-535 #4 / DI-224 R3, R10; UN-425 / PF-425, and UN-229 for the player line)
 * ===================================================================================================================================
 * The stall banner's pure half: WHICH rows a viewer is told about a sport whose scores are not moving, in what words, and the markup. A sport the league plays can go quiet in
 * three ways, and nobody is looking at a console when it does:
 *
 *   trigger 1  a LIVE competition whose current week resolves to nothing (commissioner only: the player line would be false here, locks may not work)
 *   trigger 2  the sport's live feed has failed THREE polls in a row on this device, while the sport has a live or in-window game (commissioner: the diagnostic; player: the plain line)
 *   trigger 3  a game carries a sport tag the app does not recognize (commissioner: the diagnostic naming the code; player: the same plain line as trigger 2)
 *
 * A PURE LEAF. It imports ONLY js/icons.js (the one icon family, itself a leaf; a static scan in sportstalltest proves it, with a canary), reads no storage, touches no DOM and no clock but the one it is handed. Poll health is
 * THIS DEVICE'S OBSERVATION and is never league data: the record is a plain in-memory `Map` the caller owns, never saved, never synced, cleared when the account or league changes.
 *
 *   STALL_COPY                                                  the four sentences, verbatim from DI-535 #4
 *   createPollHealth() / notePoll() / pollFailures() / clearPollHealth()    the per-COMPETITION record: { failures, lastFailureAt, lastSuccessAt }
 *   inActiveWindow(week, games, nowMs)                          the server's own window (`SCORES_REFRESH_WINDOW_HOURS`, job-rules.mjs): locked or live, not demo/manual, a game kicked
 *                                                               off in the last 6 h or LIVE, and at least one game not FINAL
 *   stallRows({ facts, health, isCommissioner, nowMs, sports, isKnownSport })   the rows for one page, in order, as DATA (`{ trigger, competitionId, text }`)
 *   stallRowsKey(rows)                                          the repaint key: competition ids and trigger numbers ONLY, never a sport code
 *   sportStallBannerHTML(rows, { escHtml, animate })            the one banner element (`#sport-stall-banner`), every value through the injected escHtml
 *
 * `facts` is built by js/app.js from the competition API, one entry per NON-ARCHIVED competition in competition order:
 *   { competitionId, dbCode, label, live, week, games, unknownCode }
 * `week` is the competition's current week (or null), `games` its games, `live` whether the competition is live (competition.js getLiveSports), `unknownCode` the code a caught
 * UnknownSportError carried for the competition's own sport key (or null). Nothing in `facts` is another member's pick: the blind rule cannot be touched from here.
 */

import { icon } from './icons.js';

export const STALL_FAILURE_THRESHOLD = 3;
export const STALL_WINDOW_HOURS = 6;
const HOUR_MS = 3600000;

/** The pages that carry the banner (the keys js/app.js's page-banner maps already use). Locker Room, Rules, the Admin panel and every sheet are deliberately absent (DI-557 #2). */
export const STALL_PAGES = Object.freeze(['home', 'picks', 'dashboard', 'leaderboard', 'commissioner']);

/** DI-535 #4, adopted verbatim (the apostrophes are straight, the dashes are em dashes, the arrow is U+2192). `sport` is a profile label, `code` the unrecognized tag. */
export const STALL_COPY = Object.freeze({
  noWeek: (sport) => `${sport}'s week isn't being tracked — nothing will lock or update automatically. Open Comm → Week and check the slate.`,
  feedCommissioner: (sport) => `${sport} scores aren't updating — the live feed failed. Scores may be stale until this is fixed.`,
  feedPlayer: (sport) => `${sport} scores are delayed — picks and locks still work as normal.`,
  unknownTag: (code) => `A game is tagged with a sport this app doesn't recognize (${code}) — it won't fetch scores until this is corrected.`,
});

export function requireEscHtml(escHtml, fnName = 'sport-stall') {
  if (typeof escHtml !== 'function') throw new TypeError(`${fnName}() requires an injected escHtml function (CONVENTIONS #12)`);
  return escHtml;
}

// ── poll health: one record per COMPETITION, in memory only ─────────────────────────────────────────────────────────────────────────

/** A fresh record store. A `Map` keyed by competition id, never an object (an id of `__proto__` is just a key). It is never persisted. */
export function createPollHealth() { return new Map(); }

/**
 * Score one poll. `outcome` is 'failed' (the sport's ESPN bucket failed), 'ok' or 'empty' (it was reached: a scoreboard with zero events is a success), or anything else / undefined
 * (the tick NEVER REACHED ESPN for this sport: neither counts nor clears). The count is CONSECUTIVE, never cumulative: one success resets it. Returns true when the failure count
 * changed (the caller repaints the page in place only then).
 */
export function notePoll(health, competitionId, outcome, nowMs) {
  if (!(health instanceof Map) || !competitionId) return false;
  const id = String(competitionId);
  const rec = health.get(id) || { failures: 0, lastFailureAt: null, lastSuccessAt: null };
  if (outcome === 'failed') {
    health.set(id, { ...rec, failures: rec.failures + 1, lastFailureAt: nowMs });
    return true;
  }
  if (outcome === 'ok' || outcome === 'empty') {
    const changed = rec.failures !== 0;
    health.set(id, { ...rec, failures: 0, lastSuccessAt: nowMs });
    return changed;
  }
  return false;
}

export function pollFailures(health, competitionId) {
  const rec = health instanceof Map ? health.get(String(competitionId)) : null;
  return rec ? rec.failures : 0;
}

export function clearPollHealth(health) { if (health instanceof Map) health.clear(); }

// ── the active window (DI-557 #9) ────────────────────────────────────────────────────────────────────────────────────────────────────

const isDemoOrManual = (week) => !!week && (week.dataSourceMode === 'demo' || week.dataSourceMode === 'manual');

/**
 * The server's own live window, so a device and the server agree on "something is expected to move": the week is locked or live and not demo or manual, a game kicked off within the
 * last STALL_WINDOW_HOURS (and not in the future) or is LIVE, and at least one game of the week is not FINAL. A week locked before its first kickoff is NOT in the window yet; a week
 * whose games are all FINAL, or whose 6 h tail has passed, is out of it.
 */
export function inActiveWindow(week, games, nowMs) {
  if (!week || isDemoOrManual(week)) return false;
  if (week.status !== 'locked' && week.status !== 'live') return false;
  const list = Array.isArray(games) ? games.filter(Boolean) : [];
  if (!list.some((g) => g.status !== 'final')) return false;
  const now = Number(nowMs);
  if (!Number.isFinite(now)) return false;
  return list.some((g) => {
    if (g.status === 'live') return true;
    const k = Date.parse(g.kickoff);
    return Number.isFinite(k) && k <= now && k >= now - STALL_WINDOW_HOURS * HOUR_MS;
  });
}

// ── the rows ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const clip = (v) => String(v).slice(0, 40);

/**
 * The rows one page shows, in order: every competition's trigger-1 or trigger-2 row in competition order, then the unknown-code rows by code (DI-557 #1).
 *   isCommissioner  the verified league role: triggers 1, 2 and 3 with the diagnostic copy. Everyone else gets triggers 2 and 3 as the PLAYER line (trigger 1 never reaches a player).
 *   sports          null = every sport (Home, Comm); otherwise an array of dbCodes the page is about (the context sport, or the Dashboard's scope).
 *   isKnownSport    (tag) => bool: is this game tag a sport the app can fetch? (an ESPN key; js/app.js passes the ESPN_SPORT_ENDPOINTS own-key test).
 * Demo and manual weeks never raise a row. A sport has at most one trigger-1/2 row; a PLAYER never sees the same sentence twice. Never throws.
 */
export function stallRows({ facts = [], health = null, isCommissioner = false, nowMs = 0, sports = null, isKnownSport = () => true } = {}) {
  const rows = [];
  const unknown = [];   // { code, competitionId, label }
  const known = typeof isKnownSport === 'function' ? isKnownSport : () => true;
  for (const f of Array.isArray(facts) ? facts : []) {
    if (!f || !f.competitionId) continue;
    if (Array.isArray(sports) && !sports.includes(f.dbCode)) continue;
    const week = f.week || null;
    if (!week) {
      if (f.live && isCommissioner) rows.push({ trigger: 1, competitionId: f.competitionId, text: STALL_COPY.noWeek(f.label) });
      continue;
    }
    if (isDemoOrManual(week)) continue;
    const games = Array.isArray(f.games) ? f.games.filter(Boolean) : [];
    if (pollFailures(health, f.competitionId) >= STALL_FAILURE_THRESHOLD && inActiveWindow(week, games, nowMs)) {
      rows.push({ trigger: 2, competitionId: f.competitionId, text: isCommissioner ? STALL_COPY.feedCommissioner(f.label) : STALL_COPY.feedPlayer(f.label) });
    }
    // trigger 3: a NON-FINAL game carries a tag the app cannot fetch (a FINAL game is done and cleared), or the competition's own sport key is the unrecognized one
    const live = games.filter((g) => g.status !== 'final');
    if (live.length) {
      const codes = new Set();
      if (f.unknownCode) codes.add(clip(f.unknownCode));
      for (const g of live) if (g.espnSport && !known(g.espnSport)) codes.add(clip(g.espnSport));
      for (const code of codes) unknown.push({ code, competitionId: f.competitionId, label: f.label });
    }
  }
  unknown.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  const seenCodes = new Set();
  for (const u of unknown) {
    if (isCommissioner) {
      if (seenCodes.has(u.code)) continue;
      seenCodes.add(u.code);
      rows.push({ trigger: 3, competitionId: u.competitionId, text: STALL_COPY.unknownTag(u.code) });
    } else {
      rows.push({ trigger: 3, competitionId: u.competitionId, text: STALL_COPY.feedPlayer(u.label) });
    }
  }
  if (isCommissioner) return rows;
  const seenText = new Set();
  return rows.filter((r) => { if (seenText.has(r.text)) return false; seenText.add(r.text); return true; });
}

/** The repaint key (DI-557 #5): competition ids and trigger numbers only. A sport code or a label NEVER enters it, so it can sit in an attribute without carrying data. */
export function stallRowsKey(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => `${r.competitionId}:${r.trigger}`).join('|');
}

/**
 * The one banner element. `.warning-box` is the app's existing in-page notice (caution, not red); `role="status"` is polite, never `alert`. The icon is the red banner's own glyph
 * (aria-hidden); every row is one `<p>` that reads as one sentence. `animate` adds the one-time fade-in class (a row set that CHANGED); an unchanged repaint passes false so the node
 * comes back already visible. Every interpolated value, the key included, goes through the injected escHtml.
 */
export function sportStallBannerHTML(rows, { escHtml, animate = false } = {}) {
  const esc = requireEscHtml(escHtml, 'sportStallBannerHTML');
  if (!Array.isArray(rows) || !rows.length) return '';
  return `<div class="warning-box sport-stall-banner${animate ? ' sport-stall-in' : ''}" id="sport-stall-banner" role="status" data-rows="${esc(stallRowsKey(rows))}">${icon('warning')}<div class="sport-stall-rows">${rows.map((r) => `<p>${esc(r.text)}</p>`).join('')}</div></div>`;
}
