/**
 * js/spread-fallback.js - W-71 (Deployment 1, batch D, 2026-10-14): THE PURE HALF OF "FIND SPREADS". UN-W71 / PF-W71, DI-W71.1 .. DI-W71.8.
 * ============================================================================================================================================
 * Drew: "If espn doesnt have a spread, it should check draft kings or another source and let you know if that is okay to include (whereas espn listed spreads are ok to include)."
 *
 * No DOM, no storage, no network of its own: every effect is a dependency handed in (`runFindSpreads`'s deps), so each rule below is provable alone and the app is the only thing wired
 * to the world. js/app.js paints and binds; supabase/functions/odds-lookup answers the second-source question; this file decides.
 *
 * THE INVARIANTS (DI-W71.7), each with its test in oddsfallbacktest.mjs:
 *   1. A non-ESPN line is NEVER applied without an explicit Include. `runFindSpreads` returns cards; only `includePatch` produces a write, and only the Include handler calls it.
 *   2. The sign is ALWAYS computed by `signedSpreadFrom` from (favorite team, margin); the vendor's own sign is never read here - the server sends a favorite NAME and a positive
 *      margin, and a card whose favorite is neither of the game's two teams is dropped.
 *   3. `lockedSpread` is never touched: every patch is spread/favorite/spreadSource/oddsProvider only (the lock freezes `spread` through the existing guard).
 *   4. Favorite + Margin stays the only MANUAL entry (AD-03); this file adds no input.
 *   5. No scraping, no client call to the vendor, no key: the second source is one Edge Function the app calls with ids.
 *   6. ESPN lines (the re-read) are applied without a question, exactly as Build slate has always applied them.
 */

/** The four books the server may name, under OUR display names (the server's own allowlist, repeated here so a forged name from anywhere is dropped). */
export const KNOWN_PROVIDERS = Object.freeze(['DraftKings', 'FanDuel', 'BetMGM', 'Caesars']);
/** `games.spread_source` for a line the commissioner included from another source. Free text in the schema (no CHECK): no migration. */
export const ODDS_API_SOURCE = 'odds_api';

export const SPREAD_COPY = Object.freeze({
  FIND: 'Find spreads',
  FIND_ONE: 'Find spread',
  CHECKING_ESPN: 'Checking ESPN…',
  CHECKING_OTHER: 'Checking other sources…',
  ESPN_ALL: 'Found every spread on ESPN.',
  NOT_ESPN: 'Not an ESPN line',
  QUESTION: 'Include this spread?',
  INCLUDE: 'Include',
  NO_THANKS: 'No thanks',
  NOT_CONFIGURED: "Other spread sources aren't set up yet.",
  PAUSED: "Spread lookup is paused to protect this month's allowance. Enter spreads yourself for now.",
  // DI-W71.10 (Drew D-80): this league has used today's vendor lookups. Calm and final for today: no Try again (trying again today cannot succeed).
  DAILY_LIMIT: "This league has used today's spread lookups. Try again tomorrow, or enter the spread yourself.",
  ERROR: "Couldn't check other sources. Try again.",
  TRY_AGAIN: 'Try again',
  OFFLINE: "Couldn't fetch games — check your connection and try again.",
  ALREADY: 'That game has a spread now.',
});
export const espnAddedCopy = (n) => `Added ${n} ${n === 1 ? 'spread' : 'spreads'} from ESPN.`;
export const noLineCopy = (n) => `No other source has a line for ${n} ${n === 1 ? 'game' : 'games'} yet. Enter the spread yourself, or check again later.`;
export const stillNeedCopy = (n) => `${n} ${n === 1 ? 'game still needs' : 'games still need'} a spread.`;
export const addedCopy = (text, provider) => `Spread added: ${text} (${provider}).`;

function requireEscHtml(escHtml, who) {
  if (typeof escHtml !== 'function') throw new TypeError(`${who}: escHtml is required (every piece of data goes through it)`);
}

// -- DI-W71.1: what "missing" means ----------------------------------------------------------------------------------------------------------------------------------------------------

/** A game is missing its spread when `spread` is not a finite number: null with no source, `espn_unparsed` or `espn_unresolved`. PK (0) is a real, set spread (CONVENTIONS #18). */
export function isSpreadMissing(game) {
  return !!game && !(typeof game.spread === 'number' && Number.isFinite(game.spread));
}
/** The games missing a spread, in slate order. The banner's count and the list can never disagree: both are this. */
export function findMissingSpreads(games) {
  return (Array.isArray(games) ? games : []).filter(isSpreadMissing);
}

// -- DI-W71.6: the sign, and the label --------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Favorite + positive Margin -> the SIGNED HOME-PERSPECTIVE spread (AD-03): home favored = -margin, away favored = +margin, pick'em = 0 with no favorite. The same arithmetic as the game
 * modal's derivation (js/app.js showGameModal, `favPick === 'home' ? -marginVal : marginVal`), which oddsfallbacktest.mjs proves by running the modal's own lines against this one for every
 * case. Returns null for anything it cannot place (a favorite that is neither team, a negative or non-finite margin): never a guess.
 */
export function signedSpreadFrom({ homeTeam, awayTeam, favoriteTeam, margin, pk = false } = {}) {
  if (pk === true) return { spread: 0, favorite: null };
  const m = Number(margin);
  if (!Number.isFinite(m) || m < 0) return null;
  if (m === 0) return { spread: 0, favorite: null };
  if (typeof favoriteTeam !== 'string' || !favoriteTeam) return null;
  if (favoriteTeam === homeTeam) return { spread: -m, favorite: homeTeam };
  if (favoriteTeam === awayTeam) return { spread: m, favorite: awayTeam };
  return null;
}

/** Where a row's spread came from, in words: `ESPN`, `Manual`, or the book's name for an included line. An unknown value reads `Manual` (never a raw string from a data row). */
export function spreadSourceLabel(game) {
  const src = game && game.spreadSource;
  if (src === 'espn') return 'ESPN';
  if (src === ODDS_API_SOURCE && KNOWN_PROVIDERS.includes(game.oddsProvider)) return game.oddsProvider;
  return 'Manual';
}

// -- DI-W71.2 stage 1: ESPN again -------------------------------------------------------------------------------------------------------------------------------------------------------

/** A fresh ESPN row carries a RESOLVED line: ESPN's own source, a finite number (data-provider's extractSpread fails closed to null otherwise). */
function isResolvedEspn(g) {
  return !!g && g.spreadSource === 'espn' && typeof g.spread === 'number' && Number.isFinite(g.spread);
}

/**
 * For each missing slate game that has an `espnEventId`, the fresh ESPN row's line - or nothing. Matched by event id ONLY (never by team names: the slate's stored names are the
 * commissioner's own); read-only (it adds no game and replaces no pool).
 */
export function espnSpreadPatches({ missing, fresh }) {
  const byEvent = new Map();
  for (const g of Array.isArray(fresh) ? fresh : []) if (g && g.espnEventId != null && g.espnEventId !== '') byEvent.set(String(g.espnEventId), g);
  const out = [];
  for (const m of Array.isArray(missing) ? missing : []) {
    if (!m || m.espnEventId == null || m.espnEventId === '') continue;
    const f = byEvent.get(String(m.espnEventId));
    if (!isResolvedEspn(f)) continue;
    out.push({ gameId: m.gameId, patch: { spread: f.spread, favorite: f.favorite ?? null, spreadSource: 'espn', oddsProvider: f.oddsProvider ?? null } });
  }
  return out;
}

// -- DI-W71.4/5: a card from a server result ------------------------------------------------------------------------------------------------------------------------------------------

/**
 * One server result -> a card model for ITS game, or null. Every field is validated again here (the server is trusted to be right, not to be the only line of defence): the book must be
 * one of the four, the favorite one of THIS game's two teams (or pick'em), the margin a half-point number up to 100. A card is never built for a game that has a spread now.
 */
export function cardFromResult(game, result) {
  if (!game || !result || typeof result !== 'object' || String(result.gameId) !== String(game.gameId)) return null;
  if (!isSpreadMissing(game)) return null;
  if (!KNOWN_PROVIDERS.includes(result.provider)) return null;
  const pk = result.pk === true;
  const margin = result.margin;
  if (!pk) {
    // A NUMBER, as the server sends it: a string that would coerce is not accepted (fail closed), and a pick'em carries no margin to read.
    if (typeof margin !== 'number' || !Number.isFinite(margin) || !(margin > 0) || margin > 100 || Math.abs(margin * 2 - Math.round(margin * 2)) > 1e-9) return null;
    if (result.favorite !== game.homeTeam && result.favorite !== game.awayTeam) return null;
  }
  const signed = signedSpreadFrom({ homeTeam: game.homeTeam, awayTeam: game.awayTeam, favoriteTeam: pk ? null : result.favorite, margin: pk ? 0 : margin, pk });
  if (!signed) return null;
  const asOfMs = Date.parse(typeof result.asOf === 'string' ? result.asOf : '');
  return {
    gameId: game.gameId, provider: result.provider, favorite: pk ? null : result.favorite, margin: pk ? 0 : margin, pk,
    asOf: Number.isFinite(asOfMs) ? new Date(asOfMs).toISOString() : null,
  };
}

/** "Georgia -3.5" - the favorite then the negative number, how a line is read; "PK" for a pick'em. Display only: nothing is parsed back out of it. */
export function lineText(card) {
  if (!card) return '';
  if (card.pk) return 'PK';
  return `${card.favorite} -${card.margin}`;
}

/**
 * The write Include makes: spread + favorite (through signedSpreadFrom, never the vendor's sign), the source, and the book. NOT `lockedSpread`. Null if the game cannot take it.
 * `current` is the game as the mirror holds it NOW: a game that has gained a spread since the card was built is refused (a manual entry in between must not be overwritten).
 */
export function includePatch(current, card) {
  if (!current || !card || !isSpreadMissing(current) || String(current.gameId) !== String(card.gameId)) return null;
  const signed = signedSpreadFrom({ homeTeam: current.homeTeam, awayTeam: current.awayTeam, favoriteTeam: card.favorite, margin: card.margin, pk: card.pk });
  if (!signed || !KNOWN_PROVIDERS.includes(card.provider)) return null;
  return { spread: signed.spread, favorite: signed.favorite, spreadSource: ODDS_API_SOURCE, oddsProvider: card.provider };
}

// -- the orchestration (DI-W71.2), all effects injected -----------------------------------------------------------------------------------------------------------------------------

/**
 * "Find spreads". Stage 1 re-reads ESPN and writes what it now has (no question); stage 2 asks the other source for what is STILL missing and returns cards (writes nothing).
 * deps: { getGames(weekId), fetchEspn(week) -> { games?, error? }, saveGame(game), lookup(weekId) -> { ok:true, results, unmatched } | { ok:false, reason }, now() -> ISO,
 *         onStage?(stage: 'espn'|'other') }. `skipEspn` runs stage 2 alone (the automatic check right after a fetch has just run stage 1).
 * @returns {Promise<{ stage1: { ran, error, added, all }, other: { status, cards, noLine } }>}
 *   other.status: 'skipped' | 'cards' | 'none' | 'not_configured' | 'paused' | 'unsupported' | 'daily_limit' | 'error'
 */
export async function runFindSpreads({ week, deps, skipEspn = false }) {
  const out = { stage1: { ran: false, error: false, added: 0, all: false }, other: { status: 'skipped', cards: [], noLine: 0 } };
  if (!week || !deps) return out;
  const liveGames = () => deps.getGames(week.weekId);
  if (findMissingSpreads(liveGames()).length === 0) { out.stage1.all = true; return out; }

  if (!skipEspn) {
    out.stage1.ran = true;
    if (typeof deps.onStage === 'function') deps.onStage('espn');
    let fresh = null;
    try { fresh = await deps.fetchEspn(week); } catch { fresh = null; }
    if (!fresh || fresh.error || !Array.isArray(fresh.games)) { out.stage1.error = true; return out; }
    for (const p of espnSpreadPatches({ missing: findMissingSpreads(liveGames()), fresh: fresh.games })) {
      const current = liveGames().find((g) => g.gameId === p.gameId);
      if (!current || !isSpreadMissing(current)) continue;          // a manual entry in the meantime wins
      deps.saveGame({ ...current, ...p.patch, updatedAt: deps.now() });
      out.stage1.added += 1;
    }
    if (findMissingSpreads(liveGames()).length === 0) { out.stage1.all = true; return out; }
  }

  if (typeof deps.onStage === 'function') deps.onStage('other');
  const still = findMissingSpreads(liveGames());
  let answer = null;
  try { answer = await deps.lookup(week.weekId); } catch { answer = { ok: false, reason: 'vendor_error' }; }
  if (!answer || answer.ok !== true) {
    const r = answer && answer.reason;
    out.other.status = r === 'not_configured' ? 'not_configured' : r === 'paused' ? 'paused' : r === 'unsupported' ? 'unsupported' : r === 'daily_limit' ? 'daily_limit' : 'error';
    return out;
  }
  const byId = new Map(still.map((g) => [String(g.gameId), g]));
  const cards = [];
  for (const r of Array.isArray(answer.results) ? answer.results : []) {
    const card = cardFromResult(byId.get(String(r && r.gameId)), r);
    if (card && !cards.some((c) => c.gameId === card.gameId)) cards.push(card);
  }
  out.other.cards = cards;
  out.other.noLine = still.length - cards.length;
  out.other.status = cards.length ? 'cards' : 'none';
  return out;
}

// -- the rendered half (markup only; app.js binds) ------------------------------------------------------------------------------------------------------------------------------------

/**
 * One "Include this spread?" card. `gameName` is the matchup ("Georgia @ Alabama"), shown so a card that sits apart from its row still says whose line it is. `formatTime(iso)` is the
 * app's own time formatter. The buttons are 44 pt (the .spread-card rule) and carry data-spread-action; the game id rides on the card.
 */
export function cardHTML(card, { escHtml, formatTime, gameName = '' } = {}) {
  requireEscHtml(escHtml, 'cardHTML');
  if (!card) return '';
  const when = card.asOf && typeof formatTime === 'function' ? formatTime(card.asOf) : '';
  const head = card.pk ? `${card.provider} has this game as a pick'em (PK)` : `${card.provider} has ${lineText(card)}`;
  return `<div class="spread-card info-box" data-spread-card="${escHtml(card.gameId)}">`
    + (gameName ? `<div class="spread-card-game text-xs text-muted">${escHtml(gameName)}</div>` : '')
    + `<div class="spread-card-line"><strong>${escHtml(head)}</strong></div>`
    + `<div class="spread-card-source text-xs text-muted">${escHtml(SPREAD_COPY.NOT_ESPN)}${when ? ` · updated ${escHtml(when)}` : ''}</div>`
    + `<div class="spread-card-q">${escHtml(SPREAD_COPY.QUESTION)}</div>`
    + `<div class="spread-card-actions">`
    + `<button type="button" class="btn btn-primary spread-card-btn" data-spread-action="include" data-game-id="${escHtml(card.gameId)}">${escHtml(SPREAD_COPY.INCLUDE)}</button>`
    + `<button type="button" class="btn btn-ghost spread-card-btn" data-spread-action="decline" data-game-id="${escHtml(card.gameId)}">${escHtml(SPREAD_COPY.NO_THANKS)}</button>`
    + `</div></div>`;
}

/**
 * The whole block a screen shows when games are missing a spread: the count line, `Find spreads`, a quiet status line, and a card per line found. `state` is app.js's
 * { phase: 'idle'|'espn'|'other', cards, noLine, note, noteKind, declined:Set } for THIS week. Returns '' when nothing is missing (the block does not exist then).
 */
export function findBlockHTML({ missingCount, state, games = [], escHtml, formatTime } = {}) {
  requireEscHtml(escHtml, 'findBlockHTML');
  if (!missingCount) return '';
  const st = state || {};
  const busy = st.phase === 'espn' || st.phase === 'other';
  const label = st.phase === 'espn' ? SPREAD_COPY.CHECKING_ESPN : st.phase === 'other' ? SPREAD_COPY.CHECKING_OTHER : SPREAD_COPY.FIND;
  const nameOf = (id) => { const g = games.find((x) => String(x.gameId) === String(id)); return g ? `${g.awayTeam} @ ${g.homeTeam}` : ''; };
  const cards = (Array.isArray(st.cards) ? st.cards : []).filter((c) => !(st.declined && st.declined.has(c.gameId)));
  const note = st.note ? `<div class="spread-find-note text-xs ${st.noteKind === 'error' ? 'spread-find-note-error' : 'text-muted'}" role="status">${escHtml(st.note)}${st.noteKind === 'error' ? ` <button type="button" class="btn btn-ghost spread-try-btn" data-spread-action="find">${escHtml(SPREAD_COPY.TRY_AGAIN)}</button>` : ''}</div>` : '';
  return `<div class="spread-find" data-spread-block>`
    + `<div class="spread-find-row"><button type="button" class="btn btn-secondary spread-find-btn" data-spread-action="find"${busy ? ' disabled aria-busy="true"' : ''}>${escHtml(label)}</button></div>`
    + (st.phase === 'other' && !busy ? '' : '')
    + note
    + cards.map((c) => cardHTML(c, { escHtml, formatTime, gameName: nameOf(c.gameId) })).join('')
    + `</div>`;
}
