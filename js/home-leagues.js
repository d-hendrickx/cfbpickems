/**
 * CFB Pickems — home-leagues.js (Deployment 2, thread 101826-D2, lane 3 "Personal Home"; DI-801 / DI-805 / DI-806 / DI-807 / DI-813, UN/PF-508 and UN/PF-517)
 * ==========================================================================================================================================================
 * ONE HOME ACROSS LEAGUES, the pure half: which leagues, what each card's provenance is, how the per-league card lists merge, and the presentation rules Drew ruled on
 * (round 3, 2026-10-19, all "as recommended"):
 *   RPF-B1  the feed's ORDER stays newest first by event time; relevance (the next batch, DI-829…840) decides only what gets in            -> FEED_ORDER
 *   RPF-B3  the league chip is drawn only for a member of two or more leagues; every card carries its provenance as data always             -> CHIP_MIN_LEAGUES
 *   Q5      Home reads at most five leagues (js/peek-store.js HOME_LEAGUE_CAP); a sixth is named in Your Leagues, never silently dropped
 *
 *   leagueChipLabel(name)                 "IRB Pick 'Ems" -> "IRB", "The Residency League" -> "Residency" (DI-806's derivation, 10 characters at most)
 *   leagueLabels(leagues)                 Map leagueId -> label, two leagues never sharing one (the next distinguishing word, else "(2)")
 *   sportCodeOf(dbCode)                   the registered profile's code ('cfb' -> 'CFB'), an unknown sport upper-cased
 *   provFor(league, { sport, competitionId, sportCode })   the frozen provenance object every League card and Game Day item carries: { leagueId, leagueName, leagueLabel, sport, sportCode, competitionId, order }
 *   stampLeagueCards(cards, league, { defaultSport })      new card objects with `prov` (the cards are never mutated); the card's own sport, else the league's
 *   capNewest(cards, n)                   the n newest (by sortKey, then id) — DI-805's per-league cap, so one busy league cannot bury another
 *   chipText(prov) / chipAria(prov)       "IRB · CFB" / "IRB Pick 'Ems, CFB" (the full name is spoken; the label truncates, the sport code never)
 *
 * Imports only the sport registry (a pure module an Edge Function can import). No storage, no DOM, no clock.
 */
import { listProfiles } from './sports/index.js';

/** RPF-B1 (Drew, 2026-10-19): newest first. Relevance decides inclusion, never order. */
export const FEED_ORDER = 'newest-first';
/** RPF-B3 (Drew, 2026-10-19): the league chip is drawn for members of this many leagues or more. */
export const CHIP_MIN_LEAGUES = 2;
/** DI-805: at most this many of a league's newest event cards enter the merged feed. */
export const PER_LEAGUE_CARD_CAP = 12;
/** DI-806: the derived label's hard cap (an ellipsis beyond it). */
export const LEAGUE_LABEL_MAX = 10;

const str = (v) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));
const GENERIC_TAIL = /\s+(?:pick\s*'?\s*ems?|pickems?|pick'?em|picks|league)\s*$/i;

/** DI-806's label rule for one league name. */
export function leagueChipLabel(name) {
  let n = str(name).replace(/\s+/g, ' ').trim();
  n = n.replace(/^the\s+/i, '');
  const stripped = n.replace(GENERIC_TAIL, '').trim();
  if (stripped) n = stripped;
  const tokens = n.split(' ').filter(Boolean);
  let label = tokens.length > 1 ? tokens[0] : (tokens[0] || '');
  const chars = Array.from(label);
  if (chars.length > LEAGUE_LABEL_MAX) label = `${chars.slice(0, LEAGUE_LABEL_MAX - 1).join('')}…`;
  return label || 'League';
}

/** Labels for the member's leagues (in their order), no two alike. */
export function leagueLabels(leagues) {
  const list = (Array.isArray(leagues) ? leagues : []).filter((l) => l && str(l.leagueId));
  const base = list.map((l) => leagueChipLabel(l.leagueName));
  const out = new Map();
  const words = (n) => str(n).replace(/^the\s+/i, '').replace(GENERIC_TAIL, '').trim().split(/\s+/).filter(Boolean);
  list.forEach((l, i) => {
    const clash = base.some((b, j) => j !== i && b === base[i]);
    if (!clash) { out.set(l.leagueId, base[i]); return; }
    // the next word that tells it apart from every league it clashes with
    const mine = words(l.leagueName);
    const others = list.filter((x, j) => j !== i && base[j] === base[i]).map((x) => words(x.leagueName));
    const pick = mine.slice(1).find((w) => others.every((o) => !o.includes(w)));
    let label = pick ? leagueChipLabel(pick) : `${base[i]} (${list.slice(0, i + 1).filter((x, j) => base[j] === base[i]).length})`;
    if ([...out.values()].includes(label)) label = `${label} (${i + 1})`;
    out.set(l.leagueId, label);
  });
  return out;
}

/** 'cfb' -> 'CFB' (the profile's code); an unregistered sport is its upper-cased code, never dropped. */
export function sportCodeOf(dbCode) {
  const k = str(dbCode);
  if (!k) return '';
  let p = null;
  try { p = listProfiles().find((x) => x.key === k) || null; } catch { p = null; }
  return p ? str(p.code || p.label) : k.toUpperCase();
}

/** 'cfb' -> 'College Football' (the profile's label); an unregistered sport is its upper-cased code. */
export function sportLabelOf(dbCode) {
  const k = str(dbCode);
  let p = null;
  try { p = listProfiles().find((x) => x.key === k) || null; } catch { p = null; }
  return p ? str(p.label) : k.toUpperCase();
}

/** The provenance object (frozen). `league` = { leagueId, leagueName, leagueLabel, order }. */
export function provFor(league, { sport = '', sportCode = '', competitionId = null } = {}) {
  const l = league && typeof league === 'object' ? league : {};
  const sp = str(sport);
  return Object.freeze({
    leagueId: str(l.leagueId), leagueName: str(l.leagueName), leagueLabel: str(l.leagueLabel) || leagueChipLabel(l.leagueName),
    sport: sp, sportCode: str(sportCode) || sportCodeOf(sp), competitionId: competitionId === null || competitionId === undefined ? null : str(competitionId),
    order: Number.isFinite(l.order) ? l.order : 0,
  });
}

/** Every card of one league, stamped with its provenance — new objects; the input is never mutated. A card with no sport (a chat card) takes the league's default sport. */
export function stampLeagueCards(cards, league, { defaultSport = 'cfb' } = {}) {
  return (Array.isArray(cards) ? cards : []).filter(Boolean).map((c) => {
    const sport = str(c.sport) || str(defaultSport);
    return { ...c, prov: provFor(league, { sport, sportCode: str(c.sportCode), competitionId: c.competitionId || null }) };
  });
}

/** The n newest cards (sortKey descending, then id): the per-league cap. */
export function capNewest(cards, n = PER_LEAGUE_CARD_CAP) {
  const list = (Array.isArray(cards) ? cards : []).filter(Boolean).slice();
  list.sort((a, b) => (str(a.sortKey) < str(b.sortKey) ? 1 : str(a.sortKey) > str(b.sortKey) ? -1 : (str(a.id) < str(b.id) ? -1 : str(a.id) > str(b.id) ? 1 : 0)));
  return list.slice(0, Math.max(0, n));
}

/**
 * D2 DI-1056 (amendment c): the newest `n` — and every OLDER card whose id is in `keep` (the entries already included this session): the per-league cap bounds NEW inclusion,
 * never a card the reader already has. The newest `n` come first, in capNewest's order; the kept older ones follow, newest first.
 */
export function capNewestKeeping(cards, keep, n = PER_LEAGUE_CARD_CAP) {
  const top = capNewest(cards, n);
  if (!(keep instanceof Set) || keep.size === 0) return top;
  const have = new Set(top.map((c) => c.id));
  const rest = capNewest(cards, Infinity).filter((c) => !have.has(c.id) && keep.has(c.id));
  return rest.length ? [...top, ...rest] : top;
}

/** The chip's text: "{label} · {sportCode}" (the sport code is always present when known). */
export function chipText(prov) {
  if (!prov) return '';
  return prov.sportCode ? `${prov.leagueLabel} · ${prov.sportCode}` : prov.leagueLabel;
}
/** What VoiceOver reads first (DI-806: "Residency, NHL."): the league's FULL name, then the sport's code. */
export function chipAria(prov) {
  if (!prov) return '';
  const name = prov.leagueName || prov.leagueLabel;
  return prov.sportCode ? `${name}, ${prov.sportCode}` : name;
}
