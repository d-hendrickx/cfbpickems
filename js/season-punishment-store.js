/**
 * js/season-punishment-store.js — the season-ender vote, the transport half (D2 lane 1 batch 3; UN/PF-542, DI-1022..1030; migration 0072). The ONLY module that calls the seven `season_punishment_*` RPCs.
 * ==========================================================================================================================================
 * The server owns every rule (who may propose, the strict majority of ALL eligible members, silence as no, the lock, the commissioner-named last place and its end log); this module only asks and tells.
 *   - A synchronous cache keyed by sport-season (`leagueId:competitionId`) holds the LAST card read, so a screen paints at once and repaints when the read lands (cached, then fresh).
 *   - `loadSeasonStakes()` reads `season_punishment_state()` (the card read: the proposal, the counts of who has voted, the caller's OWN vote, never the yes/no split and never another member's vote).
 *     A missing function (migration 0072 not applied) is silence ('unavailable'), never an error banner. A failed read keeps the last good card and says nothing new.
 *   - Every write returns a KIND, never throws: `'saved'` (the server took it; the card was re-read) or the server's sentinel (`not_open`, `not_eligible`, `try_limit`, `bad_text`, ...) mapped by `errorKind()`;
 *     anything unreadable is `'failed'`. A write that is not acknowledged is never reported saved (the card is re-read only after the server said yes).
 *   - Nothing here touches localStorage, the storage seam or another module's state: a vote is not league data, and it is never mirrored (the blind rule's cousin: nothing a member did is shown to another).
 *   - `clearSeasonStakes()` forgets everything (sign-out, an account change); a read or write that lands after a clear is dropped.
 */
import { errorKind } from './season-punishment.js';

let cfg = { getClient: () => null, onChange: () => {} };
let cache = new Map();   // `${leagueId}:${competitionId}` -> { state, at, status: 'ready' | 'unavailable' | 'failed' | 'loading' }
let inflight = new Map();
let generation = 0;

/** `configureSeasonStakes({ getClient, onChange })` — called once by js/app.js at boot. `onChange()` fires after the cache changes (a read landed, a write committed). */
export function configureSeasonStakes(c) {
  const d = c && typeof c === 'object' ? c : {};
  cfg = { getClient: typeof d.getClient === 'function' ? d.getClient : () => null, onChange: typeof d.onChange === 'function' ? d.onChange : () => {} };
}
const clientNow = () => { try { return cfg.getClient(); } catch { return null; } };
const changed = () => { try { cfg.onChange(); } catch { /* a listener never wedges the store */ } };
export const seasonStakesKey = (leagueId, competitionId) => `${String(leagueId || '')}:${String(competitionId || '')}`;
/** The cached entry for a sport-season, or null: `{ state, at, status }`. Synchronous. */
export const getSeasonStakes = (leagueId, competitionId) => cache.get(seasonStakesKey(leagueId, competitionId)) || null;
export function clearSeasonStakes() { generation += 1; cache = new Map(); inflight = new Map(); changed(); }
export function _resetSeasonStakesForTest() { generation += 1; cache = new Map(); inflight = new Map(); cfg = { getClient: () => null, onChange: () => {} }; }

const missing = (e) => !!e && (['PGRST202', '42883'].includes(String(e.code || '')) || /could not find the function|does not exist/i.test(String(e.message || '')));

/** Reads the card for one sport-season. Returns the entry's status. Dedupes a read already in flight; `maxAgeMs` skips a read that is fresh enough; `force` always reads. */
export async function loadSeasonStakes({ leagueId, competitionId, force = false, maxAgeMs = 15000, now = Date.now() } = {}) {
  const key = seasonStakesKey(leagueId, competitionId), client = clientNow();
  if (!leagueId || !competitionId || !client || typeof client.rpc !== 'function') return 'failed';
  const have = cache.get(key);
  if (!force && have && have.status === 'ready' && now - have.at < maxAgeMs) return 'ready';
  if (inflight.has(key)) return inflight.get(key);
  const gen = generation;
  const p = (async () => {
    try {
      const r = await client.rpc('season_punishment_state', { p_league: leagueId, p_competition: competitionId });
      if (gen !== generation) return 'stale';
      if (r.error) {
        const status = missing(r.error) ? 'unavailable' : 'failed';
        const prev = cache.get(key);
        cache.set(key, { state: status === 'failed' && prev ? prev.state : null, at: Date.now(), status: status === 'failed' && prev && prev.state ? 'ready' : status });
        changed();
        return status;
      }
      const state = r.data && typeof r.data === 'object' ? r.data : null;
      cache.set(key, { state, at: Date.now(), status: state ? 'ready' : 'failed' });
      changed();
      return state ? 'ready' : 'failed';
    } catch {
      return gen === generation ? 'failed' : 'stale';
    } finally {
      if (gen === generation) inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

async function call(fn, args, { leagueId, competitionId }) {
  const client = clientNow();
  if (!client || typeof client.rpc !== 'function') return 'failed';
  const gen = generation;
  try {
    const r = await client.rpc(fn, args);
    if (gen !== generation) return 'failed';
    if (r.error) return errorKind(r.error);
    await loadSeasonStakes({ leagueId, competitionId, force: true });
    return 'saved';
  } catch (e) { return errorKind(e); }
}

/** The commissioner sends a punishment to a vote. `text` must already have passed validateText(); the server re-checks. Returns 'saved' or a kind. */
export const sendProposal = ({ leagueId, competitionId, text, hours }) => call('season_punishment_propose', { p_league: leagueId, p_competition: competitionId, p_text: String(text || ''), p_window_hours: Number(hours) }, { leagueId, competitionId });
/** A member's vote (changeable until the vote closes). `yes` is a boolean. */
export const castVote = ({ leagueId, competitionId, id, yes }) => call('season_punishment_vote', { p_league: leagueId, p_id: id, p_vote: yes === true }, { leagueId, competitionId });
export const withdrawProposal = ({ leagueId, competitionId, id }) => call('season_punishment_withdraw', { p_league: leagueId, p_id: id }, { leagueId, competitionId });
/** "Season ended": the commissioner's app names last place from the standings; `memberIds` are the named members and `hash` is the SHA-256 of the standings snapshot it used (recorded server side). */
export const endSeason = ({ leagueId, competitionId, id, memberIds, hash }) => call('season_punishment_end_season', { p_league: leagueId, p_id: id, p_last_place: memberIds, p_standings_hash: hash }, { leagueId, competitionId });
/** The ONE correction (within 24 hours, never after carried out). */
export const correctLastPlace = ({ leagueId, competitionId, id, memberIds, hash }) => call('season_punishment_correct_last_place', { p_league: leagueId, p_id: id, p_last_place: memberIds, p_standings_hash: hash }, { leagueId, competitionId });
export const markCarriedOut = ({ leagueId, competitionId, id }) => call('season_punishment_carried_out', { p_league: leagueId, p_id: id }, { leagueId, competitionId });
