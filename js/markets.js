/**
 * CFB Pickems - markets.js (D2 lane 2, DI-883 / DI-897 / DI-919; UN-513, UN-515, UN-516 / PF-513, 515, 516)
 * =========================================================================================================
 * Reading the lines and prices ESPN publishes, and ONLY from the STRUCTURED fields. A PURE LEAF (no imports, no browser globals): the client parse (js/data-provider.js), the server
 * job (supabase/functions/scores-refresh, through the same parse) and the append-only price record all read through here.
 *
 * THE HAZARD THIS FILE EXISTS FOR (found in the live probe of 2026-10-18, recorded in docs/DESIGN_INPUTS_D2_C.md DI-883). For an NHL game ESPN's `competitions[0].odds[0].details` is
 * "MIN -192": the FAVOURITE'S MONEYLINE, not a spread. Football's `extractSpread` (js/data-provider.js) parses the trailing number of `details` as the point-spread magnitude, so an
 * unguarded NHL import stores a spread of 192. NOTHING in this file ever reads `odds[0].details`. The puck line is the structured `odds[0].spread` (home-perspective, signed: negative
 * is the home team favoured, the app's own convention) and the favourite is DERIVED FROM THE SIGN of that line, never from `homeTeamOdds.favorite` (that flag is the MONEYLINE favourite).
 *
 * WHAT IS STORED ON A GAME (`game.markets`, an unmodeled field that rides `extra`): { v:1, capturedAt, spread{line, favorite 'home'|'away'|null, homePrice, awayPrice},
 * total{line, overPrice, underPrice}, moneyline{homePrice, awayPrice} }. A price is an American-odds string ('+160', '-192'); anything else drops THAT ONE PIECE and nothing else;
 * an absent market is ABSENT (never zero, never a default). A bookmaker's name, link, logo or disclaimer is never stored on a game and never shown; the append-only record
 * (the append-only snapshot table of migration 0064) keeps the provider's name internally, and nothing displays it (regulatory F12).
 *
 * `priceFor(snapshots, { sport, espnEventId, atMs })` is the one reader of the record for lane D: the latest snapshot at or before the game's start, or null. A price is NEVER assumed.
 */

/** American odds: a sign and a 2-to-5 digit magnitude with no leading zero. */
export const PRICE_RE = /^[+-][1-9][0-9]{1,4}$/;
/** A price outside plus or minus this is dropped (a parse that went wrong, not a market). */
export const PRICE_ABS_MAX = 10000;

/** A price string ESPN sent, normalised and validated; null for anything else (a number, 'EVEN', '', '+0', '<img ...>', 1e9). */
export function cleanPrice(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!PRICE_RE.test(s)) return null;
  return Math.abs(Number(s)) <= PRICE_ABS_MAX ? s : null;
}

/** Football totals are not bounded by the sport's rules; this is only the "a parse that went wrong" fence. Hockey: 3 to 12 (DI-883). */
function totalPlausible(total, sportKey) {
  if (typeof total !== 'number' || !Number.isFinite(total)) return false;
  return sportKey === 'nhl' ? total >= 3 && total <= 12 : total > 0 && total <= 300;
}

/** A line number from ESPN: a finite number, or a numeric string ('-1.5', '+1.5', 'o6.5', 'u6.5'). Anything else is null. Never read from a display string. */
function lineOf(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^[ou]?([+-]?\d+(?:\.\d+)?)$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

const close = (side) => (side && side.close && typeof side.close === 'object' ? side.close : null);
const open  = (side) => (side && side.open  && typeof side.open  === 'object' ? side.open  : null);

/**
 * The puck/point line from the structured fields: `odds[0].spread` (home-perspective, signed), else the home side's `pointSpread.home.close.line`. A line of 0, a missing line and
 * anything that is not a finite number is `null`. NEVER `odds[0].details`.
 */
function structuredSpreadLine(odds) {
  const direct = lineOf(odds && odds.spread);
  if (direct !== null && direct !== 0) return direct;
  const fromBlock = lineOf(close(odds && odds.pointSpread && odds.pointSpread.home) && close(odds.pointSpread.home).line);
  return fromBlock !== null && fromBlock !== 0 ? fromBlock : null;
}

/**
 * `extractMarkets(comp, sportKey, { lineMax, capturedAt })`  -> `{ markets, spread, favoriteSide, spreadSource, rejected, provider }`
 *   markets       the `game.markets` object, or null when ESPN carried no usable market at all
 *   spread        the home-perspective signed line to put on `game.spread` for a SPREAD (puck-line) game: a finite non-zero number within `lineMax`, else null
 *   favoriteSide  'home' | 'away' | null, DERIVED FROM THE SIGN of `spread`
 *   spreadSource  'espn' when a line was accepted, 'espn_rejected' when a line was present but implausible (never clamped), else null
 *   provider      ESPN's provider name for the append-only record ONLY (never stored on a game, never shown)
 * `lineMax` is the sport profile's `markets.lineMax` (hockey 3.5); null/undefined means no bound (football's shipped behaviour).
 */
export function extractMarkets(comp, sportKey, { lineMax = null, capturedAt = null } = {}) {
  const none = { markets: null, spread: null, favoriteSide: null, spreadSource: null, rejected: false, provider: null };
  const odds = comp && Array.isArray(comp.odds) ? comp.odds[0] : null;
  if (!odds || typeof odds !== 'object') return none;
  const provider = typeof odds.provider?.name === 'string' && odds.provider.name.length <= 80 ? odds.provider.name : null;

  // ── spread / puck line ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  let spreadLine = structuredSpreadLine(odds);
  let rejected = false;
  if (spreadLine !== null && typeof lineMax === 'number' && Math.abs(spreadLine) > lineMax) {
    rejected = true;
    spreadLine = null;
    try { console.warn('[markets] a spread line outside the sport\'s plausible bound was rejected (never clamped):', String(odds.spread).slice(0, 20)); } catch { /* no console */ }
  }
  const favoriteSide = spreadLine === null ? null : (spreadLine < 0 ? 'home' : 'away');
  const ps = odds.pointSpread && typeof odds.pointSpread === 'object' ? odds.pointSpread : null;
  const spread = {};
  if (spreadLine !== null) { spread.line = spreadLine; spread.favorite = favoriteSide; }
  const sHome = cleanPrice(close(ps && ps.home) && close(ps.home).odds);
  const sAway = cleanPrice(close(ps && ps.away) && close(ps.away).odds);
  if (spreadLine !== null && sHome) spread.homePrice = sHome;
  if (spreadLine !== null && sAway) spread.awayPrice = sAway;

  // ── total ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const tb = odds.total && typeof odds.total === 'object' ? odds.total : null;
  let totalLine = lineOf(odds.overUnder);
  if (totalLine === null) totalLine = lineOf(close(tb && tb.over) && close(tb.over).line);
  const total = {};
  if (totalPlausible(totalLine, sportKey)) {
    total.line = totalLine;
    const o = cleanPrice(close(tb && tb.over) && close(tb.over).odds);
    const u = cleanPrice(close(tb && tb.under) && close(tb.under).odds);
    if (o) total.overPrice = o;
    if (u) total.underPrice = u;
  }

  // ── moneyline ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const mb = odds.moneyline && typeof odds.moneyline === 'object' ? odds.moneyline : null;
  const moneyline = {};
  const mHome = cleanPrice(close(mb && mb.home) && close(mb.home).odds);
  const mAway = cleanPrice(close(mb && mb.away) && close(mb.away).odds);
  if (mHome) moneyline.homePrice = mHome;
  if (mAway) moneyline.awayPrice = mAway;

  const markets = { v: 1 };
  if (Object.keys(spread).length) markets.spread = spread;
  if (Object.keys(total).length) markets.total = total;
  if (Object.keys(moneyline).length) markets.moneyline = moneyline;
  if (markets.spread || markets.total || markets.moneyline) markets.capturedAt = capturedAt || new Date().toISOString();
  const hasAny = !!(markets.spread || markets.total || markets.moneyline);
  return {
    markets: hasAny ? markets : null,
    spread: spreadLine,
    favoriteSide,
    spreadSource: spreadLine !== null ? 'espn' : (rejected ? 'espn_rejected' : null),
    rejected,
    provider,
  };
}

/**
 * The payload the append-only record stores (open AND close lines and prices for each market), validated piece by piece. Null when nothing usable. `provider` is returned separately
 * (it is a column of the record, never part of the payload and never shown). Same structured-only rule as `extractMarkets`: NEVER `odds[0].details`.
 */
export function marketRecordFromComp(comp, sportKey, { lineMax = null } = {}) {
  const odds = comp && Array.isArray(comp.odds) ? comp.odds[0] : null;
  if (!odds || typeof odds !== 'object') return null;
  const provider = typeof odds.provider?.name === 'string' && odds.provider.name.length <= 80 ? odds.provider.name : null;
  const sides = (block, keys) => {
    const out = {};
    for (const k of keys) {
      const side = block && block[k];
      const c = cleanPrice(close(side) && close(side).odds);
      const o = cleanPrice(open(side) && open(side).odds);
      if (c || o) out[k] = { ...(c ? { close: c } : {}), ...(o ? { open: o } : {}) };
    }
    return out;
  };
  const payload = { v: 1 };
  let line = structuredSpreadLine(odds);
  if (line !== null && typeof lineMax === 'number' && Math.abs(line) > lineMax) line = null;
  const sp = line === null ? {} : sides(odds.pointSpread, ['home', 'away']);
  if (line !== null) payload.spread = { line, ...sp };
  const tb = odds.total && typeof odds.total === 'object' ? odds.total : null;
  let tline = lineOf(odds.overUnder);
  if (tline === null) tline = lineOf(close(tb && tb.over) && close(tb.over).line);
  if (totalPlausible(tline, sportKey)) {
    const t = sides(tb, ['over', 'under']);
    const oline = lineOf(open(tb && tb.over) && open(tb.over).line);
    payload.total = { line: tline, ...t, ...(oline !== null && totalPlausible(oline, sportKey) ? { openLine: oline } : {}) };
  }
  const ml = sides(odds.moneyline, ['home', 'away']);
  if (Object.keys(ml).length) payload.moneyline = ml;
  if (!payload.spread && !payload.total && !payload.moneyline) return null;
  return { payload, provider };
}

/** Stable JSON (sorted keys) of a payload: what `payload_hash` is the SHA-256 of, so the same lines always hash the same. */
export function canonicalPayloadJson(payload) {
  const norm = (v) => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k])]));
    return v;
  };
  return JSON.stringify(norm(payload));
}

/**
 * The recorded price for a game: the LATEST snapshot at or before `atMs` (the game's start), or null. Pure over rows `{ sport, espn_event_id (or espnEventId), captured_at (or capturedAt),
 * payload }`. A game with no row has NO price: this never invents one (a default, a neighbour's price, the current price). Lane D reads through this.
 */
export function priceFor(snapshots, { sport, espnEventId, atMs } = {}) {
  if (!Array.isArray(snapshots) || !sport || !espnEventId || !Number.isFinite(atMs)) return null;
  let best = null; let bestMs = -Infinity;
  for (const r of snapshots) {
    if (!r || r.sport !== sport) continue;
    if (String(r.espn_event_id ?? r.espnEventId) !== String(espnEventId)) continue;
    const ms = Date.parse(r.captured_at ?? r.capturedAt);
    if (!Number.isFinite(ms) || ms > atMs) continue;
    if (ms >= bestMs) { best = r; bestMs = ms; }
  }
  return best ? { capturedAt: new Date(bestMs).toISOString(), payload: best.payload } : null;
}

/** The picks-page price caption for one side ('home' | 'away') of a game's `markets` for a pick-the-winner game, or '' (no price, no caption, no placeholder). */
export function moneylineCaption(markets, side) {
  const p = markets && markets.moneyline ? markets.moneyline[side === 'home' ? 'homePrice' : 'awayPrice'] : null;
  return cleanPrice(p) || '';
}

/** "Total 6.5" for the pill under the matchup, or '' (absent). */
export function totalPillText(markets) {
  const l = markets && markets.total ? markets.total.line : null;
  return typeof l === 'number' && Number.isFinite(l) ? `Total ${l}` : '';
}
