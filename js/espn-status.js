/**
 * CFB Pickems - espn-status.js (D2 lane 2, DI-884 / DI-925; UN-513, UN-536 / PF-513, PF-536)
 * ============================================================================================
 * ONE shared, Edge-importable mapping from ESPN's `status.type` to Munera's three game statuses, plus the one transient note for the games ESPN says were not played. It is a PURE
 * LEAF: no imports, no browser globals, no storage; the client parse (js/data-provider.js) and the server job (which reaches the same parse through refreshScoresByEventIds) share it,
 * and a twin test (statusmaptest) proves the table below row by row.
 *
 * WHY STATE, NOT NAME. Hockey's ESPN status names are not documented, and a name this build has never seen must still land safely. ESPN's structured `state` ('pre' / 'in' / 'post')
 * and `completed` are the authority, with the NAME as a hint. The football path is EXACTLY the old name mapping (`footballStatusFromName`, which js/data-provider.js `normalizeStatus`
 * keeps returning): every college-football and NFL result is byte-identical to before this file existed.
 *
 *   ESPN (non-football)                                              Munera status   note (TRANSIENT, rides the live-status map, never the game record)
 *   state pre, name SCHEDULED                                        scheduled       -
 *   state in  (IN_PROGRESS, END_PERIOD, any overtime / shootout)     live            -   (`intermission` true for END_PERIOD: an 18-minute break does not pulse)
 *   state post, completed true                                       final           -
 *   POSTPONED / CANCELED / CANCELLED / FORFEIT / SUSPENDED / DELAYED unplayed        postponed | cancelled | suspended | delayed
 *   any other name, state post and not completed                     scheduled       unknown  (UNPLAYED, never final)
 *
 * An unplayed-name game is `scheduled`, or `live` ONLY when ESPN's own state is 'in' (play has begun and scores exist: a stored live row must never be sent back to `scheduled` with its
 * scores erased by a delay or a suspension).
 */

export const GAME_STATUS_VALUES = Object.freeze({ SCHEDULED: 'scheduled', LIVE: 'live', FINAL: 'final' });

const NOTE_BY_NAME = Object.freeze([
  ['POSTPONED', 'postponed'],
  ['CANCELED', 'cancelled'],
  ['CANCELLED', 'cancelled'],
  ['FORFEIT', 'cancelled'],
  ['SUSPENDED', 'suspended'],
  ['DELAYED', 'delayed'],
]);

/** The exact legacy football mapping (js/data-provider.js `normalizeStatus` delegates here): FINAL anywhere in the name; in progress, halftime and an end-of-period are live; anything else is scheduled. */
export function footballStatusFromName(name) {
  if (!name) return GAME_STATUS_VALUES.SCHEDULED;
  if (name.includes('FINAL')) return GAME_STATUS_VALUES.FINAL;
  if (name === 'STATUS_IN_PROGRESS' || name.includes('HALFTIME') || name.includes('END_PERIOD')) return GAME_STATUS_VALUES.LIVE;
  return GAME_STATUS_VALUES.SCHEDULED;
}

/** The sports whose status is the legacy name mapping, byte for byte. Any other sport (hockey) reads the structured state. */
export function usesFootballStatus(sportKey) {
  return sportKey === undefined || sportKey === null || sportKey === '' || sportKey === 'college-football' || sportKey === 'nfl' || sportKey === 'cfb';
}

/**
 * @param {{name?:string,state?:string,completed?:boolean}} type  ESPN's `event.status.type`
 * @param {string} sportKey  'college-football' | 'nfl' | 'nhl' (an ESPN key; a dbCode of a football sport is accepted)
 * @returns {{ status: 'scheduled'|'live'|'final', note: string|null, intermission: boolean }}
 */
export function normalizeEspnStatus(type, sportKey) {
  const t = type && typeof type === 'object' ? type : {};
  const name = typeof t.name === 'string' ? t.name.toUpperCase() : '';
  if (usesFootballStatus(sportKey)) return { status: footballStatusFromName(typeof t.name === 'string' ? t.name : ''), note: null, intermission: false };

  const state = typeof t.state === 'string' ? t.state.toLowerCase() : '';
  const completed = t.completed === true;

  for (const [needle, note] of NOTE_BY_NAME) {
    if (name.includes(needle)) {
      return { status: state === 'in' ? GAME_STATUS_VALUES.LIVE : GAME_STATUS_VALUES.SCHEDULED, note, intermission: false };
    }
  }
  if (state === 'in') return { status: GAME_STATUS_VALUES.LIVE, note: null, intermission: name.includes('END_PERIOD') || name.includes('HALFTIME') || name.includes('INTERMISSION') };
  if (state === 'post') {
    if (completed || name.includes('FINAL')) return { status: GAME_STATUS_VALUES.FINAL, note: null, intermission: false };
    return { status: GAME_STATUS_VALUES.SCHEDULED, note: 'unknown', intermission: false };      // a post-game name we have never seen: UNPLAYED, never final
  }
  if (state === 'pre') return { status: GAME_STATUS_VALUES.SCHEDULED, note: null, intermission: false };
  // No structured state at all (a malformed payload): the name decides, but an unseen name is unplayed, never final by guess.
  if (name.includes('FINAL')) return { status: GAME_STATUS_VALUES.FINAL, note: null, intermission: false };
  if (name === 'STATUS_IN_PROGRESS' || name.includes('END_PERIOD')) return { status: GAME_STATUS_VALUES.LIVE, note: null, intermission: name.includes('END_PERIOD') };
  return { status: GAME_STATUS_VALUES.SCHEDULED, note: name && name !== 'STATUS_SCHEDULED' ? 'unknown' : null, intermission: false };
}
