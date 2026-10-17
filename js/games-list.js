/**
 * CFB Pickems — games-list.js (Deployment 1, thread 100726-D1, W-69 ONE games list; DI-W69.1 – DI-W69.9)
 * =======================================================================================================
 * Drew, 2026-10-14: "There is no way to remove a team on the slate when the week is in draft mode. Oh wait there is, but its in selected slate and I was looking in the available
 * games section. This is confusing and contains redundant info because the available games tab also includes the selected games. This should be consolidated."
 *
 * The PURE half of Comm -> Games. Before this module the same game was drawn in up to four places (the Suggested box, "Next Best", "All Available Games", "Selected Slate"), each with its
 * own buttons and its own hand-written copy of "is this pool game on the slate?". Now:
 *
 *   slateMatchFor(game, slate)    THE join, written once (DI-W69.2): a pool game is on the slate when a slate game has the same non-empty ESPN event id, or the same home and away
 *                                 team names (trimmed, case-insensitive). Every renderer and every add path asks this one function.
 *   gameIdentityKey(game)         the row's identity: the ESPN event id when there is one, else the normalized team pair. It does NOT change when a game is added to or removed from
 *                                 the slate, so the flip from "Not on slate" to "On slate" is the SAME row patched in place (the DI names the key as slate gameId -> event id -> team pair; a key
 *                                 that moved with the slate would make every add and remove look like one row vanishing and another appearing, and could not crossfade).
 *   buildGameRows(...)            the UNION of the slate's games and the pool's games that are not on the slate, de-duplicated by the join. A slate game with no pool counterpart (added
 *                                 by hand, or the pool was cleared) still appears, so "Clear pool" can never hide the slate; a duplicate slate record is never hidden either.
 *   gameRowHTML / controls / groups   the markup, with every helper that needs the app (names, spread text, logos) injected, `escHtml` first.
 *
 * Pure of the app: no storage, no DOM. `escHtml` is REQUIRED wherever markup is built (CONVENTIONS #12).
 */

import { spreadSourceLabel, SPREAD_COPY } from './spread-fallback.js';   // W-71 (I-3): the ONE source label (ESPN | Manual | one of four book names; a forged or unknown source reads Manual)

const GAME_STATUS_SCHEDULED = 'scheduled';

function nonEmpty(v) { const s = v == null ? '' : String(v).trim(); return s === '' ? '' : s; }
export function normTeam(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
function requireEsc(escHtml, who) { if (typeof escHtml !== 'function') throw new TypeError(`${who}() requires an injected escHtml function (CONVENTIONS #12)`); }

// ── the join (DI-W69.2) ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The slate game that `game` (a pool game, or the data of a game about to be added) already is, or null. ONE rule for every renderer and every add path. */
export function slateMatchFor(game, slateGames) {
  if (!game || typeof game !== 'object') return null;
  const list = Array.isArray(slateGames) ? slateGames : [];
  const eid = nonEmpty(game.espnEventId);
  const home = normTeam(game.homeTeam), away = normTeam(game.awayTeam);
  for (const g of list) {
    if (!g) continue;
    if (eid && nonEmpty(g.espnEventId) === eid) return g;
    if (home && away && normTeam(g.homeTeam) === home && normTeam(g.awayTeam) === away) return g;
  }
  return null;
}
export function isOnSlate(game, slateGames) { return slateMatchFor(game, slateGames) !== null; }

/** A game's identity for the list: the ESPN event id when it has one, else the normalized team pair. Stable across add / remove / swap. */
export function gameIdentityKey(game) {
  const eid = nonEmpty(game && game.espnEventId);
  if (eid) return `e:${eid}`;
  return `t:${normTeam(game && game.homeTeam)}|${normTeam(game && game.awayTeam)}`;
}

/**
 * The data a pool game becomes when it is added to the slate: the pool game as ESPN parsed it, without the suggestion engine's decoration (`_score`, `suggestionReasons`), its own
 * `gameId` / timestamps (the new slate game mints its own), and with the fields the old hand-built payload set. ONE builder for the list's Add and the Player Requests card's Add, so no add
 * path can lose a field another keeps (the DI-7 failure: a game added from one list lost its TV tag while the same game added from another kept it).
 */
export function poolGameToSlateData(game, week, now = () => new Date().toISOString()) {
  const { gameId, _score, suggestionReasons, createdAt, updatedAt, ...rest } = game || {};
  void gameId; void _score; void suggestionReasons; void createdAt; void updatedAt;
  return {
    ...rest,
    weekId: week && week.weekId,
    homeMascot: rest.homeMascot || '', awayMascot: rest.awayMascot || '',
    spreadSource: rest.spreadSource || null, oddsProvider: rest.oddsProvider || null,
    dataQuality: rest.dataQuality || 'partial',
    dataSource: (week && week.dataSourceMode) || 'espn_historical',
    venue: rest.venue || null, neutralSite: rest.neutralSite || false,
    lastUpdated: now(),
  };
}

// ── the rows (DI-W69.2) ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * @param {{ slate: object[], pool: object[], suggested?: object[], shortlist?: object[], suggestionKeyOf?: (g:object)=>string }} args
 * @returns {Array<{ key: string, onSlate: boolean, slateGame: object|null, poolGame: object|null, game: object, suggested: ''|'suggested'|'next', reasons: string[] }>}
 * Every slate game is exactly one row (a duplicate record gets its own `g:<gameId>` key rather than being hidden); every pool game that is not on the slate is one row (a repeated pool
 * event renders once). `suggested` / `reasons` come from the suggestion engine's own output and mark a Not-on-slate row only.
 */
export function buildGameRows({ slate = [], pool = [], suggested = [], shortlist = [], suggestionKeyOf = (g) => gameIdentityKey(g) } = {}) {
  const rows = [];
  const used = new Set();
  const rowOfSlate = new Map();
  for (const g of Array.isArray(slate) ? slate : []) {
    if (!g) continue;
    let key = gameIdentityKey(g);
    if (used.has(key)) key = `g:${g.gameId}`;
    used.add(key);
    const row = { key, onSlate: true, slateGame: g, poolGame: null, game: g, suggested: '', reasons: [] };
    rows.push(row); rowOfSlate.set(g, row);
  }
  const sug = new Map(), nxt = new Map();
  for (const s of Array.isArray(suggested) ? suggested : []) if (s) sug.set(suggestionKeyOf(s), s);
  for (const s of Array.isArray(shortlist) ? shortlist : []) if (s) nxt.set(suggestionKeyOf(s), s);
  const slateList = Array.isArray(slate) ? slate : [];
  for (const p of Array.isArray(pool) ? pool : []) {
    if (!p) continue;
    const m = slateMatchFor(p, slateList);
    if (m) { const r = rowOfSlate.get(m); if (r && !r.poolGame) r.poolGame = p; continue; }
    const key = gameIdentityKey(p);
    if (used.has(key)) continue;
    used.add(key);
    const sk = suggestionKeyOf(p);
    const s1 = sug.get(sk), s2 = s1 ? null : nxt.get(sk);
    const hit = s1 || s2;
    rows.push({ key, onSlate: false, slateGame: null, poolGame: p, game: p, suggested: s1 ? 'suggested' : (s2 ? 'next' : ''), reasons: hit && Array.isArray(hit.suggestionReasons) ? hit.suggestionReasons : [] });
  }
  return rows;
}

export function segmentCounts(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const on = list.filter((r) => r.onSlate).length;
  return { all: list.length, on, off: list.length - on };
}
export function rowsForSegment(rows, seg) {
  const list = Array.isArray(rows) ? rows : [];
  if (seg === 'on') return list.filter((r) => r.onSlate);
  if (seg === 'off') return list.filter((r) => !r.onSlate);
  return list;
}

/** The action buttons of a row, by name, in order (DI-W69.2, table 4.3): Lock / Unlock appear only past Draft, where they have an effect. */
function slateRowActionNames({ pastDraft = false, unlocked = false } = {}) {
  return ['edit', ...(pastDraft ? [unlocked ? 'lock' : 'unlock'] : []), 'remove'];
}
export function rowActionNames(row, { pastDraft = false, unlocked = false, findSpread = false } = {}) {
  if (!row.onSlate) return row.suggested === 'suggested' ? ['add', 'dismiss'] : ['add'];
  // W-71 (DI-W71.2): a slate game with no spread, in a week that can still take one, offers "Find spread" first (ahead of Edit: it is the likely next move). Off by default - today's rows are unchanged.
  const names = slateRowActionNames({ pastDraft, unlocked });
  return findSpread ? ['find-spread', ...names] : names;
}

// ── the summary line (DI-W69.4) ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** `{a} on slate · {b} not on slate`, plus the sport's size when the slate is not at it ("target 10" / "8 to 10 games"); an empty pool says so. */
export function summaryText({ onSlate = 0, notOnSlate = 0, poolEmpty = false, profile = null } = {}) {
  const slate = profile && profile.slate && typeof profile.slate === 'object' ? profile.slate : null;
  const target = slate && Number.isFinite(slate.size) && slate.size > 0 ? Math.floor(slate.size) : 10;
  let hint = '';
  if (onSlate !== target) {
    hint = slate && Number.isFinite(slate.minSize) && Number.isFinite(slate.maxSize) ? ` · ${slate.minSize} to ${slate.maxSize} games` : ` · target ${target}`;
  }
  return `${onSlate} on slate · ${poolEmpty ? 'pool is empty' : `${notOnSlate} not on slate`}${hint}`;
}

export const GAMES_COPY = Object.freeze({
  title: 'Games',
  segAll: (n) => `All ${n}`, segOn: (n) => `On slate ${n}`, segOff: (n) => `Not on slate ${n}`,
  addGame: 'Add a game', addSuggested: (k) => `Add ${k} suggested`, refreshScores: 'Refresh Scores', more: 'More…',
  filtersSummary: 'Search and filters',
  noGames: 'No games yet. Build the slate to pull this week’s games, or add one by hand.',
  poolEmptyNote: 'Build slate to refresh the pool.',
  noMatch: 'No games match these filters.',
  resetFilters: 'Reset filters',
  onSlateMark: 'On slate',
  noSpread: 'No spread',
});

// ── markup ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * One row (DI-W69.2). `ctx` carries the app's helpers so this stays pure: { escHtml, icon, teamName(game, side), spreadText(spread, favorite, game), timeText(game), num(v), logo(url, isManual),
 * venue(game), requestChip(game), sourceBadge(game), readiness(game), isUnlocked(gameId), pastDraft }. ONE root element, `data-key` set by the reconciler (it is also written here so the first paint is keyed).
 */
export function gameRowHTML(row, ctx) {
  const { escHtml } = ctx;
  requireEsc(escHtml, 'gameRowHTML');
  const g = row.game;
  const name = `${g.awayTeam} @ ${g.homeTeam}`;
  const slateGame = row.slateGame;
  const sv = slateGame ? (slateGame.lockedSpread != null ? slateGame.lockedSpread : slateGame.spread) : g.spread;
  const hasSpread = sv !== null && sv !== undefined;
  const spreadBit = hasSpread
    ? `<span>${escHtml(ctx.spreadText(sv, g.favorite, g))} <em class="games-row-src">${escHtml(spreadSourceLabel(g))}</em></span>`
    : `<span class="games-row-nospread">${escHtml(GAMES_COPY.noSpread)}</span>`;
  const readiness = row.onSlate && ctx.readiness ? ctx.readiness(slateGame) : { level: 'ok', issues: [] };
  const readyStrip = readiness.level === 'ok' ? '' :
    `<div class="game-readiness game-readiness-${escHtml(readiness.level)}">${readiness.level === 'incomplete' ? 'Incomplete — hidden from players' : 'Pending confirmation'}: ${readiness.issues.map(escHtml).join(' · ')}</div>`;
  const venue = ctx.venue ? ctx.venue(g) : '';
  const espnId = String((slateGame && slateGame.espnEventId) || g.espnEventId || '');   // the commissioner's id chip (the old cards showed it on both kinds of row)
  const status = g.status && g.status !== GAME_STATUS_SCHEDULED ? `<span class="badge badge-${escHtml(g.status)}">${escHtml(g.status)}</span>` : '';
  const score = g.status === 'final' && g.homeScore != null && g.awayScore != null ? `<span>FINAL ${ctx.num(g.awayScore)}–${ctx.num(g.homeScore)}</span>` : '';
  const unlockedNow = row.onSlate && ctx.isUnlocked ? !!ctx.isUnlocked(slateGame.gameId) : false;
  const unlockedBadge = unlockedNow ? `<span class="badge badge-open games-unlocked-mark">${ctx.icon('unlock')} Unlocked</span>` : '';
  const chips = !row.onSlate && row.suggested
    ? `<div class="games-row-chips"><span class="games-row-chip">${row.suggested === 'next' ? 'Next best' : 'Suggested'}</span>${row.reasons.map((r) => `<span class="candidate-reason">${escHtml(r)}</span>`).join('')}</div>`
    : '';
  const btn = (action, label, cls, inner = null) => `<button type="button" class="btn btn-sm games-row-btn ${cls}" data-action="${action}" aria-label="${escHtml(`${label} ${name}`)}">${inner == null ? escHtml(label) : inner}</button>`;
  const wantsFind = !!(row.onSlate && slateGame && typeof ctx.findSpread === 'function' && ctx.findSpread(slateGame));
  const buttons = rowActionNames(row, { pastDraft: !!ctx.pastDraft, unlocked: unlockedNow, findSpread: wantsFind }).map((a) => {
    if (a === 'find-spread') return btn('row-find-spread', SPREAD_COPY.FIND_ONE, 'btn-ghost');
    if (a === 'add') return btn('row-add', 'Add', 'btn-primary');
    if (a === 'dismiss') return btn('row-dismiss', 'Dismiss', 'btn-ghost');
    if (a === 'edit') return btn('row-edit', 'Edit', 'btn-ghost');
    if (a === 'lock') return btn('row-lock', 'Lock', 'btn-ghost', `${ctx.icon('lock')} Lock`);
    if (a === 'unlock') return btn('row-lock', 'Unlock', 'btn-ghost', `${ctx.icon('unlock')} Unlock`);
    return btn('row-remove', 'Remove', 'btn-ghost games-row-btn--danger');
  }).join('');
  const sep = g.neutralSite ? 'vs' : '@';
  const logoView = (url) => (ctx.logo ? ctx.logo(url, g.isManual) : '');
  const rowCls = `games-row${row.onSlate ? ' is-on-slate' : ''}${readiness.level !== 'ok' ? ` games-row-${escHtml(readiness.level)}` : ''}`;
  const state = row.onSlate ? 'on' : 'off';
  const inner = `
      ${readyStrip}
      <div class="games-row-head">
        <div class="games-row-matchup">
          ${logoView(g.awayLogo)}${g.awayRank ? `#${ctx.num(g.awayRank)} ` : ''}${escHtml(ctx.teamName(g, 'away'))}
          <span class="text-muted"> ${sep} </span>
          ${logoView(g.homeLogo)}${g.homeRank ? `#${ctx.num(g.homeRank)} ` : ''}${escHtml(ctx.teamName(g, 'home'))}${g.neutralSite ? '' : ' <span class="home-badge">H</span>'}
          ${g.isAlmaMaterGame ? `<span class="alma-mater-badge">${ctx.icon('almaMater', { label: 'Alma mater game' })}</span>` : ''}
          ${g.nationalTV ? `<span class="national-tv-badge">${ctx.icon('tv')} ${escHtml(g.broadcastNetwork || '')}</span>` : ''}
          ${ctx.requestChip ? ctx.requestChip(g) : ''}
          ${row.onSlate && ctx.sourceBadge ? ctx.sourceBadge(slateGame) : ''}
        </div>
        ${row.onSlate ? `<span class="badge badge-open games-row-mark">${ctx.icon('check')} ${escHtml(GAMES_COPY.onSlateMark)}</span>` : ''}
      </div>
      <div class="games-row-meta">
        <span>${escHtml(ctx.timeText(g))}</span>${spreadBit}${status}${score}${unlockedBadge}${venue ? `<span class="text-muted text-xs">${escHtml(venue)}</span>` : ''}${espnId ? `<code class="games-row-espn">ESPN:${escHtml(espnId)}</code>` : ''}
      </div>
      ${chips}
      <div class="games-row-actions">${buttons}</div>
    `;
  // The row's change signature is a hash of everything it draws (its classes, its state and its inner markup), written INTO the root so a first paint and a patch compare the same value.
  return `<div class="${rowCls}" role="listitem" data-sig="${escHtml(hashSig(`${rowCls}|${state}|${inner}`))}" data-key="${escHtml(row.key)}" data-row-state="${state}">${inner}</div>`;
}

/** The segmented control (DI-W69.4), on the existing 44 pt `.lc-segs` / `.lc-seg`. */
export function segmentsHTML({ escHtml, counts, seg }) {
  requireEsc(escHtml, 'segmentsHTML');
  const one = (id, label) => `<button type="button" class="lc-seg${seg === id ? ' lc-seg-on' : ''}" data-action="seg" data-seg="${id}" aria-pressed="${seg === id ? 'true' : 'false'}">${escHtml(label)}</button>`;
  return one('all', GAMES_COPY.segAll(counts.all)) + one('on', GAMES_COPY.segOn(counts.on)) + one('off', GAMES_COPY.segOff(counts.off));
}

/** The slate-level controls (DI-W69.6): Add a game, Add k suggested (only when it can add), Refresh Scores (past Draft only), More… (only when it holds something). */
export function controlsHTML({ escHtml, icon, addable = 0, atTarget = false, pastDraft = false, hasMore = true }) {
  requireEsc(escHtml, 'controlsHTML');
  const parts = [`<button type="button" class="btn btn-ghost games-ctl" id="add-manual-game-btn" data-action="add-manual">${icon('plus')} ${escHtml(GAMES_COPY.addGame)}</button>`];
  if (addable > 0 && !atTarget) parts.push(`<button type="button" class="btn btn-primary games-ctl" id="apply-suggested-btn" data-action="add-suggested">${escHtml(GAMES_COPY.addSuggested(addable))}</button>`);
  if (pastDraft) parts.push(`<button type="button" class="btn btn-secondary games-ctl" id="refresh-scores-btn" data-action="refresh-scores">${icon('refresh')} ${escHtml(GAMES_COPY.refreshScores)}</button>`);
  if (hasMore) parts.push(`<button type="button" class="btn btn-ghost games-ctl" id="games-more-btn" data-action="more">${escHtml(GAMES_COPY.more)}</button>`);
  return parts.join('');
}

/** A change signature for a row's markup (the reconciler compares signatures, not markup): djb2, base 36. */
export function hashSig(str) {
  const t = String(str == null ? '' : str);
  let h = 5381;
  for (let i = 0; i < t.length; i++) h = (((h << 5) + h) + t.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
/** The change signature a row's markup carries in its own `data-sig` (see gameRowHTML): what the reconciler compares, read back out of the markup so the first paint and a patch agree by construction. */
export function sigOfHtml(html) {
  const m = / data-sig="([^"]*)"/.exec(String(html == null ? '' : html));
  return m ? m[1] : '';
}
export function groupSig(label, count) { return `${label}|${count}`; }

/**
 * A date group (DI-W69.4): the existing collapsible `<details class="avail-group">`, keyed and signed for the reconciler. Its rows live in `.avail-group-body`. `closed` groups stay closed
 * across a patch; `bodyHTML` is the first paint's rows (a patch builds the shell empty and reconciles the rows by key).
 */
export function groupShellHTML(escHtml, label, count, closed = false, bodyHTML = '') {
  requireEsc(escHtml, 'groupShellHTML');
  const sig = groupSig(label, count);
  const key = `grp:${label}`;
  const text = groupCountText(count);
  return `<details class="avail-group"${closed ? '' : ' open'} data-sig="${escHtml(sig)}" data-key="${escHtml(key)}"><summary class="avail-group-header"><span>${escHtml(label)}</span><span class="text-muted text-xs" data-bind="count">${escHtml(text)}</span></summary><div class="avail-group-body" role="list">${bodyHTML}</div></details>`;
}
export function groupCountText(n) { return `${n} game${n === 1 ? '' : 's'}`; }

/** "Showing x of y games (filtered)." (the existing count line, kept). */
export function countLineText({ shown, total }) { return `Showing ${shown} of ${total} games${shown !== total ? ' (filtered)' : ''}.`; }

/**
 * Which one-line state message the list shows, if any (DI-W69.4):
 *   'none'      no games anywhere                        -> GAMES_COPY.noGames
 *   'nomatch'   rows exist, the segment + filters hide them all -> GAMES_COPY.noMatch (+ Reset filters)
 *   ''          rows are showing
 */
export function listStateOf({ rowsTotal, shown }) {
  if (rowsTotal === 0) return 'none';
  return shown === 0 ? 'nomatch' : '';
}

/**
 * The muted notes above the list when the suggestion engine has something to say (the alma-mater budget, and an anchor slot it could not fill): the old Suggested box's banner and notes, kept
 * as plain lines now that the box is one attribute on the rows (DI-W69.4 "Budget banner kept as one muted line"). `target` is the usual 10 the engine reserves slots in.
 */
export function suggestionNotes({ suggestedCount = 0, almaCount = 0, morningAnchorFilled = true, closingAnchorFilled = true, target = 10 } = {}) {
  if (!suggestedCount) return [];
  const notes = [];
  if (almaCount >= 1) {
    notes.push({ kind: 'budget', text: almaCount > target ? `${almaCount} alma mater games this week \u2014 slate expanded` : `${almaCount} of ${target} slots reserved for alma mater games this week` });
  }
  if (!morningAnchorFilled) notes.push({ kind: 'anchor', text: 'No Saturday morning games this week \u2014 opening slot not filled automatically.' });
  if (!closingAnchorFilled) notes.push({ kind: 'anchor', text: 'No Saturday games this week \u2014 closing slot not filled automatically.' });
  return notes;
}
