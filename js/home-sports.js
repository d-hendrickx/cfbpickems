/**
 * CFB Pickems — home-sports.js (D1 / v0.30.0, DI-528: the Home feed combines every sport and names each card's sport)
 *
 * Drew D-54 / FB-032: "the dashboard is sport context dependent and the feed is sport context agnostic." The feed is ONE list of cards from every sport the league runs, each card
 * naming its sport, and nothing in it merges one sport with another. This module is the whole of that rule, as a PURE LEAF (it imports nothing, reads no store, touches no DOM and is
 * handed `deriveCards` rather than importing it), so the cross-sport guarantees are provable without a browser.
 *
 *   deriveFeedCards(derive, snapshot, opts)   the feed's cards: a league with NO contexts is `derive(snapshot, opts)` unchanged (the single-sport rule, v0.29.0 byte for byte);
 *                                             with contexts, `derive` runs ONCE PER SPORT on that sport's own slice and once more for the league-wide chat cards
 *   sportContextSnapshot(snapshot, ctx)       one sport's slice: its weeks, games, picks and results, its ENTRANTS as the players (C4), its own "N/M in" counts, no chat
 *   leagueChatSnapshot(snapshot)              the league-wide slice: chat candidates only (a room message belongs to no sport), no week, no pick
 *   cleanJoinOffers(list)                     DESIGN_D1_E (DI-E1.1): the app's join offers reduced to { dbCode, code, joinable } and nothing else (no pick, no member, no name can ride in)
 *   placeJoinNudges(entries, offers)          DESIGN_D1_E (DI-E1.2): one "Want in?" entry per offered sport, right under that sport's NEWEST card in the window; never in place of a card
 *
 * THE RULES
 *   - NOTHING MERGES. A rank, a streak, a milestone, a record and a week result are each computed from ONE sport's weeks and ONE sport's entrants (the slice carries nothing else), so
 *     "Kevin moved into 1st" is a fact about the sport the card names, never a blend. Standings are not summed anywhere.
 *   - THE BLIND RULE IS PER WEEK AND UNCHANGED. Each slice keeps the caller's `revealed*` view restricted to its own weeks, and `derive` re-applies the reveal gate week by week (feed-cards C1),
 *     so an open NFL week next to a live CFB week reveals no NFL pick. No flag crosses from one slice to another because no slice holds another's data.
 *   - A CARD NAMES ITS SPORT: `sport` (dbCode), `sportCode` ('CFB' / 'NFL', what the chip prints) and `competitionId`. Chat cards carry none: a room message has no sport.
 *   - YEAR-AGO is a CFB history dataset; it is never offered for another sport's week.
 *   - `FEED_CARD_LIMIT` is applied by the caller AFTER this merge and the newest-first sort; there is no per-sport quota.
 */

const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (typeof v === 'string' ? v : (v === null || v === undefined ? '' : String(v)));

/** A context the module will use: a competition id, a sport code, and the week ids it owns. Anything else is dropped (a malformed context contributes nothing, never everything). */
function validContext(c) {
  return !!c && typeof c === 'object' && typeof c.competitionId === 'string' && c.competitionId !== '' && typeof c.dbCode === 'string' && c.dbCode !== '' && Array.isArray(c.weekIds);
}

const newestFirst = (a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** One sport's slice of the snapshot. Nothing from another sport's weeks, picks or roster is copied into it. */
export function sportContextSnapshot(snapshot, ctx) {
  const s = (snapshot && typeof snapshot === 'object') ? snapshot : {};
  const weekIds = new Set(arr(ctx && ctx.weekIds).map(str));
  const entrants = new Set(arr(ctx && ctx.playerIds).map(str));
  // security N1 (2026-10-08): a pick row counts only for an entrant OF ITS OWN WEEK. `weekEntrants[weekId]` is that week's roster (joined before ITS lock); a context without the map (an older caller) falls back to
  // the roster as of now for every week - never to nobody.
  const perWeek = (ctx && ctx.weekEntrants && typeof ctx.weekEntrants === 'object') ? ctx.weekEntrants : null;
  const entrantOf = (x) => {
    const list = perWeek && Object.prototype.hasOwnProperty.call(perWeek, str(x.weekId)) ? perWeek[str(x.weekId)] : null;
    return Array.isArray(list) ? list.map(str).includes(str(x.playerId)) : entrants.has(str(x.playerId));
  };
  const mine = (x) => !!x && weekIds.has(str(x.weekId));
  const counts = {};
  const src = (s.submissionCounts && typeof s.submissionCounts === 'object') ? s.submissionCounts : {};
  for (const id of weekIds) if (Object.prototype.hasOwnProperty.call(src, id)) counts[id] = src[id];
  const readConfirmed = {};
  const rc = (s.picksReadConfirmed && typeof s.picksReadConfirmed === 'object') ? s.picksReadConfirmed : {};
  for (const id of weekIds) if (Object.prototype.hasOwnProperty.call(rc, id)) readConfirmed[id] = rc[id];
  return {
    ...s,
    contexts: undefined,
    players: arr(s.players).filter((p) => !!p && entrants.has(str(p.playerId))),
    weeks: arr(s.weeks).filter(mine),
    games: arr(s.games).filter(mine),
    picks: arr(s.picks).filter((x) => mine(x) && entrantOf(x)),   // a non-entrant's pick ROW counts for nothing (A3, and N1: of THAT week): not as a chip, not as "somebody else picked that side"
    weeklyResults: arr(s.weeklyResults).filter(mine),
    revealedWeeks: arr(s.revealedWeeks).filter(mine),
    revealedGames: arr(s.revealedGames).filter(mine),
    revealedPicks: arr(s.revealedPicks).filter((x) => mine(x) && entrantOf(x)),
    revealedWeeklyResults: arr(s.revealedWeeklyResults).filter(mine),
    submissionCounts: counts,
    picksReadConfirmed: readConfirmed,
    chatCandidates: { scribe: [], lockerRoom: [] },
    currentWeekId: ctx && ctx.currentWeekId ? str(ctx.currentWeekId) : null,
  };
}

/** The league-wide slice: the chat candidates and the roster (names), and no week, game, pick or result at all. */
export function leagueChatSnapshot(snapshot) {
  const s = (snapshot && typeof snapshot === 'object') ? snapshot : {};
  return {
    ...s,
    contexts: undefined,
    weeks: [], games: [], picks: [], weeklyResults: [],
    revealedWeeks: [], revealedGames: [], revealedPicks: [], revealedWeeklyResults: [],
    submissionCounts: {}, picksReadConfirmed: {}, tieContexts: null,
    currentWeekId: null,
  };
}

/**
 * @param {Function} derive    feed-cards deriveCards (injected: this module imports nothing)
 * @param {object}   snapshot  home.js's snapshot; `snapshot.contexts` is `null` in a single-sport league
 * @param {object}   opts      handed to every `derive` call untouched (viewerId, now, viewerIsCommissioner, isContentWithheld)
 * @returns {Array<object>} the cards, newest first, deterministic
 */
export function deriveFeedCards(derive, snapshot, opts = {}) {
  if (typeof derive !== 'function') throw new TypeError('deriveFeedCards() requires the deriveCards function');
  const contexts = snapshot && Array.isArray(snapshot.contexts) ? snapshot.contexts.filter(validContext) : null;
  if (contexts === null) return derive(snapshot, opts);    // the single-sport rule: exactly today's call, exactly today's cards
  const out = [];
  const seen = new Set();
  for (const ctx of contexts) {
    if (seen.has(ctx.competitionId)) continue;
    seen.add(ctx.competitionId);
    const cards = arr(derive(sportContextSnapshot(snapshot, ctx), opts));
    for (const c of cards) {
      if (!c) continue;
      if (c.type === 'year.ago' && ctx.dbCode !== 'cfb') continue;
      out.push({ ...c, sport: ctx.dbCode, sportCode: str(ctx.code) || ctx.dbCode.toUpperCase(), competitionId: ctx.competitionId });
    }
  }
  // The league-wide pass yields only chat-derived cards (it holds no week), so nothing in it can carry or leak a pick.
  for (const c of arr(derive(leagueChatSnapshot(snapshot), opts))) {
    if (c) out.push({ ...c, sport: null });
  }
  return out.sort(newestFirst);
}

/**
 * DESIGN_D1_E (DI-E1.1): the join offers Home was handed, cleaned. Only a sport with a code and a name survives, once, and an offer is EXACTLY { dbCode, code, joinable }: `joinable` is true only for the
 * boolean `true`. Nothing else the caller passed (a pick, a member id, a name) is copied, so nothing else can reach the markup or the snapshot.
 * @returns {Array<{dbCode:string, code:string, joinable:boolean}>}
 */
export function cleanJoinOffers(list) {
  const out = [];
  const seen = new Set();
  for (const o of arr(list)) {
    if (!o || typeof o !== 'object' || typeof o.dbCode !== 'string' || o.dbCode === '' || typeof o.code !== 'string' || o.code === '' || seen.has(o.dbCode)) continue;
    seen.add(o.dbCode);
    out.push({ dbCode: o.dbCode, code: o.code, joinable: o.joinable === true });
  }
  return out;
}

/**
 * DESIGN_D1_E (DI-E1.2): inserts ONE join entry, `{ kind: 'join', key: 'join:<dbCode>', offer }`, immediately AFTER the newest CARD of every offered sport in `entries` (newest first, so the first
 * card of that sport). A sport with no card in the window gets none (no tease, no cold ad); a news item, a divider or an error entry never hosts one; the entries are never changed or removed.
 * Pure: the input is not mutated, and with nothing offered the result is a copy of it.
 */
export function placeJoinNudges(entries, offers) {
  const list = arr(entries);
  const wanted = new Map();
  for (const o of cleanJoinOffers(offers)) wanted.set(o.dbCode, o);
  if (!wanted.size) return list.slice();
  const out = [];
  const placed = new Set();
  for (const e of list) {
    out.push(e);
    if (!e || e.kind !== 'card' || !e.card) continue;
    const code = e.card.sport;
    if (!wanted.has(code) || placed.has(code)) continue;
    placed.add(code);
    out.push({ kind: 'join', key: `join:${code}`, offer: wanted.get(code) });
  }
  return out;
}
