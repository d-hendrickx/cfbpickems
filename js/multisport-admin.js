/**
 * CFB Pickems - the commissioner's multisport operations, pure half (D1, v0.30.0, thread 100726-D1, Lane A)
 * =========================================================================================================
 * DI-532 (enable or disable NFL in the existing league), DI-533 (a week created for a chosen sport), DI-534 (the commissioner runs both slates from
 * Comm -> Week), DI-536 (the NFL profile values; the slate size). Everything here is a PURE FUNCTION over plain data: copy, the deterministic id,
 * which sports can be added, whether a sport can be archived, the rows of the all-sports card, a sport's entries and each row's one next action.
 * It imports ONE module, js/league-create.js (a pure leaf: the action-sheet builder, which itself imports only league-defaults.js) - nothing with storage, a DOM or app.js: the caller hands it the data,
 * so a Node suite proves every state and the wiring in app.js is thin.
 *
 * WHAT IS NOT HERE: who is in a sport (`playersForCompetition`, the client branch's), the sport context pointer (`getActiveSportKey`, the client
 * branch's), the weeks' lock state (`weekLockState`, integrity's), and every write (the caller saves). The seam to those is js/sport-seam.js.
 *
 * THE BLIND RULE: nothing here reads a pick, a guess or a selected team. A count of "in" is a count of members whose slate is complete, supplied by the
 * caller from the same `submissionStateFor()` the Who's-in strip uses; a member's "has picks in a week in progress" is one boolean from the same reader.
 */

import { actionSheetHTML } from './league-create.js';   // the ONE action-sheet builder (scrim, destructive action, bold Cancel) every confirmation here uses

// ── SHA-256, synchronously ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// The competition id is derived (DI-532: "a retry or double tap writes the same row and can never create a duplicate sport"), and the storage seam is
// synchronous, so crypto.subtle (async) is not an option. This is the standard FIPS 180-4 function; multisporttest.mjs proves it equals node:crypto's
// on a spread of inputs (empty, one block, 55/56/63/64/65 bytes, multi-block, non-ASCII).
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** UTF-8 bytes of a string, without TextEncoder (the module stays importable anywhere). */
function utf8(str) {
  const out = [];
  for (const ch of String(str)) {
    let c = ch.codePointAt(0);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

/** SHA-256 of a string (UTF-8), as 32 bytes. */
export function sha256Bytes(str) {
  const bytes = utf8(str);
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const hi = Math.floor(bitLen / 0x100000000), lo = bitLen >>> 0;
  for (let i = 3; i >= 0; i--) bytes.push((hi >>> (i * 8)) & 255);
  for (let i = 3; i >= 0; i--) bytes.push((lo >>> (i * 8)) & 255);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = (bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) | (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3];
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) for (let j = 0; j < 4; j++) out[i * 4 + j] = (h[i] >>> (24 - j * 8)) & 255;
  return out;
}

/**
 * The competition id for (league, sport, season-kind): a UUID derived from `sha256('cfbp-competition:' + leagueId + ':' + dbCode + ':season')` with the
 * version (5) and variant bits set, so a retry or a double tap writes THE SAME ROW and can never create a duplicate sport (no unique index is needed,
 * so no migration). Pure and total: any inputs give a well-formed UUID.
 */
export function deterministicCompetitionId(leagueId, dbCode) {
  const d = sha256Bytes(`cfbp-competition:${String(leagueId)}:${String(dbCode)}:season`);
  const b = Array.from(d.slice(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = b.map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ── copy (every string a commissioner reads on these surfaces; the tests pin them) ─────────────────────────────────────────────────────────────────
export const MS_COPY = Object.freeze({
  addTitle: 'Add a sport',
  addIntro: 'Sports this league can add',
  whoPlays: (label) => `Who plays ${label}?`,
  optIn: 'Members who join',
  optInHint: 'Each member chooses. Nobody is counted as missing.',
  optInTag: '(recommended)',
  allMembers: 'Everyone in the league',
  allMembersHint: (label) => `All active members are in ${label} picks.`,
  reassure: (label) => `Your league, members, chat and college football history stay exactly as they are. Members will see ${label} as soon as you add it.`,
  announceLabel: 'Tell the league in the Locker Room',
  announceBody: (label, leagueName) => `${label} is now part of ${leagueName}. Picks open when the commissioner publishes the first week.`,
  cancel: 'Cancel',
  add: (label) => `Add ${label}`,
  added: (label) => `${label} added.`,
  failed: (label) => `Couldn't add ${label}. Nothing was changed. Try again.`,
  setUpFirstWeek: (label) => `Set up the first ${label} week`,
  notNow: 'Not now',
  archivedTag: (label) => `${label} (archived, history kept)`,
  archiveSheetTitle: (label) => `Archive ${label}?`,
  archiveSheetMessage: 'Members will no longer see it. Its picks, results and standings are kept.',
  archiveBlocked: (label) => `${label} has a week in progress. Finish or re-open it first.`,
  archiveAction: (label) => `Archive ${label}`,
  archived: (label) => `${label} archived.`,
  allSportsTitle: 'All sports',
  lensNote: (code) => `These controls change ${code} only.`,
  weekCardTitle: (code, n) => `${code} · Week ${n}`,
  entriesTitle: 'Sport entries',
  whoPlaysEntries: (label) => `Who plays ${label}`,
  addEveryone: 'Add everyone',
  entryIn: 'In',
  entryOut: 'Not in',
  countsFromNextWeek: 'Counts from next week',
  removeBlocked: (name) => `${name} has picks in a week that is in progress.`,
});

// ── which sports a commissioner can add ────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * The rows of the Add a sport sheet: the platform's registered profiles that are OFFERED (`platform_kv.offered_sports`) and that this league does not already
 * run. A sport the league archived appears as "NFL (archived, history kept)" and is RESTORED by the add (its competition id is its own, never a second row);
 * a sport with a live (non-archived) competition never appears. The result is empty when nothing is left to add - the caller then renders no card at all
 * ("never a dead stub").
 *
 * @param {{ offeredSports: string[], profiles: {key:string,label:string,code?:string}[], competitions: {id:string,sport:string,archivedAt?:string|null}[] }} a
 * @returns {{ dbCode:string, label:string, code:string, state:'new'|'archived', competitionId:string|null, listLabel:string }[]}
 */
export function addSportOptions({ offeredSports = [], profiles = [], competitions = [] } = {}) {
  const offered = new Set((Array.isArray(offeredSports) ? offeredSports : []).filter((x) => typeof x === 'string'));
  const comps = Array.isArray(competitions) ? competitions.filter((c) => c && c.sport) : [];
  const out = [];
  for (const p of Array.isArray(profiles) ? profiles : []) {
    if (!p || !p.key || !offered.has(p.key)) continue;
    const mine = comps.filter((c) => c.sport === p.key);
    if (mine.some((c) => !c.archivedAt)) continue;                    // already running in this league
    const archived = mine.find((c) => c.archivedAt) || null;
    const label = p.label || p.key;
    out.push({
      dbCode: p.key, label, code: p.code || label, state: archived ? 'archived' : 'new', competitionId: archived ? archived.id : null,
      listLabel: archived ? MS_COPY.archivedTag(label) : label,
    });
  }
  return out;
}

/** The words under the overview's "Add a sport" row, from the OPTIONS the sheet would offer (addSportOptions): "NFL is available for this league", "NFL and NHL are available for this league". Empty when there is nothing to add - the caller then draws no row. */
export function addSportRowSubtitle(options) {
  const codes = (Array.isArray(options) ? options : []).filter((o) => o && (o.code || o.label)).map((o) => String(o.code || o.label));
  if (!codes.length) return '';
  if (codes.length === 1) return `${codes[0]} is available for this league`;
  return `${codes.slice(0, -1).join(', ')} and ${codes[codes.length - 1]} are available for this league`;
}

/**
 * The competition row an "Add a sport" writes. DETERMINISTIC id (above); `enrollment` is 'opt_in' for "Members who join" and 'all' for "Everyone in the league"
 * (anything else is refused by returning null: never a guessed enrollment); `isDefault` is false (the league's main sport is untouched); a restored sport clears
 * `archivedAt`. The row carries NO `extra` field (batch T: a competitions row has no such column).
 */
export function newCompetitionRow({ leagueId, dbCode, enrollment, seasonLabel = '', existing = null } = {}) {
  if (!leagueId || !dbCode) return null;
  if (enrollment !== 'opt_in' && enrollment !== 'all') return null;
  const id = existing && existing.id ? existing.id : deterministicCompetitionId(leagueId, dbCode);
  const row = {
    id, sport: dbCode, kind: 'season', enrollment, isDefault: false, archivedAt: null, settings: existing && existing.settings && typeof existing.settings === 'object' ? existing.settings : {},
  };
  if (seasonLabel) row.seasonLabel = String(seasonLabel);
  else if (existing && existing.seasonLabel) row.seasonLabel = existing.seasonLabel;
  return row;
}

// ── archive (disable) ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const IN_PROGRESS = new Set(['open', 'locked', 'live']);

/**
 * Why a sport cannot be archived right now, or null when it can: a sport with an open, locked or live week, or a week waiting on finalization, is in
 * progress and stays. A draft or a final week does not block (nothing is lost: archiving only sets `archivedAt`, nothing is deleted).
 */
export function archiveBlocker({ weeks = [], label = 'This sport' } = {}) {
  const busy = (Array.isArray(weeks) ? weeks : []).some((w) => w && (IN_PROGRESS.has(w.status) || (w.pendingFinalization === true && w.status !== 'final')));
  return busy ? MS_COPY.archiveBlocked(label) : null;
}

// ── the next action of a sport's week ──────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * The ONE button a sport's row on the all-sports card offers, from the week alone:
 *   no week, or a final one   -> Set up Week {N+1}
 *   a draft                   -> Open for picks
 *   an open week              -> Lock
 *   locked or live            -> Finalize once every game is final (or finalization is pending), else no button (the clock does the rest)
 * `n` is the next week NUMBER within THIS sport (never the other sport's).
 */
export function nextActionFor({ week, games = [], nextWeekNumber = 1 } = {}) {
  if (!week || week.status === 'final') return { kind: 'setup', label: `Set up Week ${nextWeekNumber}` };
  if (week.status === 'draft') return { kind: 'open', label: 'Open for picks' };
  if (week.status === 'open') return { kind: 'lock', label: 'Lock' };
  if (week.status === 'locked' || week.status === 'live') {
    const list = Array.isArray(games) ? games : [];
    const allFinal = list.length > 0 && list.every((g) => g && g.status === 'final');
    if (week.pendingFinalization === true || allFinal) return { kind: 'finalize', label: 'Finalize' };
    return null;
  }
  return null;
}

/**
 * THE ONE "k of n in" RULE (merge 2026-10-08: Lane A's all-sports row and the client's overview card each carried their own copy of this count and of its words; this is the survivor and both call it).
 * `entrants` are the week's ENTRANTS (playersForWeek); `answerFor(playerId)` is true (slate complete) / false (not yet) / anything else for UNKNOWN. "k of n" is a claim about EVERY entrant: if any
 * answer is unknown (no count on this device yet) the number would read as "missing" for someone who may be in, so there is NO count at all - the same fail-quiet rule the strip follows. Nobody to
 * count is no count either ("0 of 0 in" says nothing). COUNTS ONLY: it names nobody and reads no pick. Returns { inCount, entrantCount } or null.
 */
export function inCountOf(entrants, answerFor) {
  const list = Array.isArray(entrants) ? entrants.filter(Boolean) : [];
  if (!list.length || typeof answerFor !== 'function') return null;
  let n = 0;
  for (const e of list) {
    const a = answerFor(e.playerId);
    if (a === true) n += 1;
    else if (a !== false) return null;
  }
  return { inCount: n, entrantCount: list.length };
}
/** The words of the count: "4 of 6 in", or '' for no count. */
export function inCountText(c) {
  return c && Number.isFinite(c.inCount) && Number.isFinite(c.entrantCount) ? `${c.inCount} of ${c.entrantCount} in` : '';
}

/**
 * The rows of the all-sports card (Comm -> Week, first card under the lens): one per live competition, default first. Each row reads only counts and the
 * week's own state, never a pick:
 *   { competitionId, dbCode, code, label, weekId, weekNumber, status, statusLabel, badgeKind, inCount, entrantCount, showCounts, timeLabel, action, isLens }
 * `readers` supplies the data (so this stays pure):
 *   currentWeekFor(competitionId) -> week|null      gamesFor(weekId) -> game[]       weeksFor(competitionId) -> week[]
 *   entrantsFor(week) -> {playerId}[]               submittedFor(weekId, playerId) -> true|false|null (null = unknown)
 *   lockState(week, games) -> { phase, label?, lockAtMs }   formatTime(ms) -> string
 */
export function allSportsRows({ competitions = [], profiles = [], readers, lensDbCode = null } = {}) {
  const r = readers || {};
  const byKey = new Map((profiles || []).map((p) => [p.key, p]));
  const rows = [];
  for (const c of (competitions || [])) {
    if (!c || c.archivedAt) continue;
    const p = byKey.get(c.sport) || null;
    const code = p ? (p.code || p.label || c.sport) : String(c.sport).toUpperCase();
    const label = p ? (p.label || code) : code;
    const week = r.currentWeekFor ? r.currentWeekFor(c.id) : null;
    const games = week && r.gamesFor ? r.gamesFor(week.weekId) : [];
    const all = r.weeksFor ? r.weeksFor(c.id) : [];
    const nextNum = (all.length ? Math.max(...all.map((w) => Number(w.weekNumber) || 0)) : 0) + 1;
    const ls = week && r.lockState ? r.lockState(week, games) : null;
    const entrants = week && r.entrantsFor ? r.entrantsFor(week) : [];
    const isOpen = week && week.status === 'open';
    // "k of n in" (S2): the ONE rule, inCountOf() above - any unknown answer means no count at all, never a number that reads as "missing".
    let inCount = null;
    if (isOpen && r.submittedFor) {
      const c = inCountOf(entrants, (pid) => r.submittedFor(week.weekId, pid));
      inCount = c ? c.inCount : null;
    }
    const lockAtMs = ls && Number.isFinite(ls.lockAtMs) ? ls.lockAtMs : null;
    const firstKick = (games || []).map((g) => Date.parse(g && g.kickoff)).filter(Number.isFinite).sort((a, b) => a - b)[0];
    let timeLabel = '';
    if (isOpen && lockAtMs !== null && r.formatTime) timeLabel = `Locks ${r.formatTime(lockAtMs)}`;
    else if (week && (week.status === 'locked' || week.status === 'live') && Number.isFinite(firstKick) && r.formatTime) timeLabel = `Kicks off ${r.formatTime(firstKick)}`;
    rows.push({
      competitionId: c.id, dbCode: c.sport, code, label,
      weekId: week ? week.weekId : null, weekNumber: week ? week.weekNumber : nextNum,
      status: week ? week.status : 'none',
      statusLabel: !week ? 'NO WEEK' : (ls && ls.label ? String(ls.label).toUpperCase() : String(week.status).toUpperCase()),
      badgeKind: week ? (ls && ls.phase ? ls.phase : week.status) : 'none',
      inCount, entrantCount: isOpen ? entrants.length : null, showCounts: !!isOpen && inCount !== null,
      timeLabel, lockAtMs: isOpen ? lockAtMs : null,
      action: nextActionFor({ week, games, nextWeekNumber: nextNum }),
      isLens: !!lensDbCode && c.sport === lensDbCode,
    });
  }
  return rows;
}

/** The one line under the rows: the next two deadlines, soonest first ("Next: NFL locks Sun 12:30 PM. CFB locks Sat 11:30 AM."). Empty when nothing is open. */
export function nextDeadlinesLine(rows, formatTime) {
  // Soonest first (S13): the deadline that comes up next leads, whatever order the sports are listed in. A row without a finite lock instant sorts last, keeping its place among equals.
  const open = (rows || []).filter((x) => x.status === 'open' && x.timeLabel && /^Locks /.test(x.timeLabel))
    .map((x, i) => ({ x, i, at: Number.isFinite(x.lockAtMs) ? x.lockAtMs : Infinity }))
    .sort((a, b) => (a.at === b.at ? a.i - b.i : (a.at < b.at ? -1 : 1))).map((e) => e.x);
  if (!open.length) return '';
  return `Next: ${open.map((x) => `${x.code} ${x.timeLabel.charAt(0).toLowerCase()}${x.timeLabel.slice(1)}`).join('. ')}.`;
}

// ── a sport's entries (Comm -> Players) ────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * The Sport entries card for ONE opt-in sport: every active member with an In / Not in switch, plus the data for "Add everyone".
 * Removing a member is BLOCKED while they hold picks in a week of this sport that is in progress (`{name} has picks in a week that is in progress.`).
 * A member whose entry row was created after the current week's lock reads "Counts from next week" (a commissioner-inserted late row, C1).
 * `entryRows` are the competition_members rows `[{ memberId, joinedAt, enrolledBy }]`; `hasPicksInProgress(memberId)` is one boolean per member.
 */
export function sportEntriesModel({ competition, members = [], entryRows = [], hasPicksInProgress = () => false, currentLockAtMs = null, label = 'this sport' } = {}) {
  if (!competition || competition.enrollment !== 'opt_in') return null;
  const byMember = new Map((entryRows || []).filter((r) => r && r.memberId).map((r) => [String(r.memberId), r]));
  const rows = (members || []).filter((m) => m && m.active !== false).map((m) => {
    const id = String(m.playerId);
    const row = byMember.get(id) || null;
    const isIn = !!row;
    const joined = row ? Date.parse(row.joinedAt) : NaN;
    const late = isIn && currentLockAtMs !== null && Number.isFinite(joined) && joined >= currentLockAtMs;
    const blocked = isIn && hasPicksInProgress(id) === true;
    return {
      memberId: id, name: m.displayName || id, isIn,
      note: late ? MS_COPY.countsFromNextWeek : '',
      canRemove: isIn && !blocked, blockReason: blocked ? MS_COPY.removeBlocked(m.displayName || id) : '',
    };
  });
  return { title: MS_COPY.entriesTitle, caption: MS_COPY.whoPlaysEntries(label), rows, notInIds: rows.filter((x) => !x.isIn).map((x) => x.memberId) };
}

// ── a week for a chosen sport (the wizard) ─────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * The next week NUMBER within ONE competition: max over THAT competition's weeks + 1 (never league-wide: the NFL's Week 6 does not make the college
 * league's next week 7). `weeks` are that competition's weeks only (the caller filters through competitionForWeek, R1).
 */
export function nextWeekNumberFor(weeks) {
  const nums = (Array.isArray(weeks) ? weeks : []).map((w) => Number(w && w.weekNumber)).filter(Number.isFinite);
  return nums.length ? Math.max(...nums) + 1 : 1;
}

/**
 * Wizard slate size for a sport: the profile's own 8..10 for the NFL (default 10), 10 for college football. `requested` (the commissioner's choice) is
 * clamped into the profile's [minSize, maxSize] and floored to an integer; anything unreadable is the profile's default.
 */
export function slateSizeFor(profile, requested = null) {
  const slate = profile && profile.slate ? profile.slate : null;
  const dflt = slate && Number.isFinite(slate.size) ? slate.size : 10;
  const lo = slate && Number.isFinite(slate.minSize) ? slate.minSize : 1;
  const hi = slate && Number.isFinite(slate.maxSize) ? slate.maxSize : Math.max(dflt, 10);
  const n = Math.floor(Number(requested));
  if (!Number.isFinite(n) || requested === null || requested === undefined || requested === '') return dflt;
  return Math.min(hi, Math.max(lo, n));
}

/** The tiebreaker game choices for an NFL week (DI-533 #6): the slate's games by kickoff, the LAST kickoff first as the default ("Monday night"). */
export function tiebreakerGameOptions(games, { nameOf = (g) => `${g.awayTeam} at ${g.homeTeam}` } = {}) {
  const list = (Array.isArray(games) ? games : []).filter((g) => g && g.gameId);
  const t = (g) => { const n = Date.parse(g.kickoff); return Number.isFinite(n) ? n : -Infinity; };
  const sorted = [...list].sort((a, b) => t(b) - t(a));         // latest first: the default is index 0
  return sorted.map((g, i) => ({ gameId: g.gameId, label: nameOf(g), isDefault: i === 0 }));
}

/** The fields a tiebreaker-game choice writes on the week (DI-533 #6): the game id (an unmodeled field in `extra`), the manual type and the question naming the matchup. */
export function tiebreakerFieldsFor({ week, game, profile, questionFor }) {
  if (!week || !game) return null;
  const q = questionFor ? questionFor(profile, game) : null;
  return {
    tiebreakerGameId: game.gameId,
    tiebreakerType: profile && profile.tiebreakerDefault ? profile.tiebreakerDefault.type : 'custom',
    tiebreakerCalculationMode: profile && profile.tiebreakerDefault ? profile.tiebreakerDefault.calcMode : 'manual',
    ...(q ? { tiebreakerQuestion: q } : {}),
  };
}

// ── the suggested slate for a sport with no alma-mater, ranking or conference signal (DI-533 #4) ──────────────────────────────────────────────
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** The weekday key ('sun'..'sat') of a kickoff in US Eastern time (the NFL's own calendar: Sunday night's 8:20 PM ET kickoff is a Sunday game, though it is Monday in UTC). */
export function weekdayKeyET(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  try {
    const name = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'America/New_York' }).format(new Date(t)).toLowerCase().slice(0, 3);
    return WEEKDAY_KEYS.includes(name) ? name : '';
  } catch { return ''; }
}

/**
 * The suggested slate for a sport whose profile has NO affinity (the NFL): the candidates ordered by KICKOFF, favoring the profile's `slate.anchorDays` (Sunday
 * and Monday), `size` of them (the profile's own 8..10, default 10). A game on any other day (a Thursday, a Saturday) is NEVER in the default slate: the
 * commissioner adds it on purpose, which moves the lock (DI-533 #4). Fewer anchor-day games than `size` simply gives a shorter slate (never padded with a day the profile
 * does not name). Candidates without a kickoff are left out (a game with no time cannot be ordered or locked). `shortlist` is the remaining candidates, kickoff order.
 * Returns the same shape `buildSuggestedSlate` does where the wizard reads it (`slate`, `shortlist`).
 */
export function suggestSlateFor({ profile, candidates = [], size = null, dayOf = weekdayKeyET } = {}) {
  const want = slateSizeFor(profile, size);
  const days = profile && profile.slate && Array.isArray(profile.slate.anchorDays) && profile.slate.anchorDays.length ? profile.slate.anchorDays : null;
  const t = (g) => { const n = Date.parse(g && g.kickoff); return Number.isFinite(n) ? n : Infinity; };
  const dated = (Array.isArray(candidates) ? candidates : []).filter((g) => g && Number.isFinite(t(g))).sort((a, b) => t(a) - t(b));
  const onDay = (g) => !days || days.includes(dayOf(g.kickoff));
  const anchor = dated.filter(onDay);
  const slate = anchor.slice(0, want);
  const taken = new Set(slate);
  const shortlist = dated.filter((g) => !taken.has(g)).slice(0, Math.max(0, ((profile && profile.slate && profile.slate.candidateSize) || 16) - slate.length));
  return { slate, shortlist, almaCount: 0, morningAnchorFilled: false, closingAnchorFilled: false };
}

// ── the Add a sport action (DI-532), orchestrated over injected deps so a Node suite proves every outcome ────────────────────────────────────────
/**
 * Add (or restore) a sport to the league. Order, and why:
 *   1. build the competition row (deterministic id; null if the inputs are unreadable, which is a refusal, never a guess);
 *   2. SAVE THE COMPETITION - the one write that matters; a throw here is a failure and NOTHING else is attempted ("Nothing was changed"); a retry or a double tap writes the SAME row;
 *   3. with `opt_in`, the commissioner's own entry (they chose to play) - a failure here does not undo the sport: it is reported (`entryAdded:false`) and the commissioner can join from the overview;
 *   4. the Locker Room announcement, only when asked - best effort, reported (`announced`), never a reason to fail the add.
 * Nothing in weeks, picks, results, members or chat is touched by (1) and (2); `getCurrentWeek()` and every college surface are unchanged.
 *
 * @returns {{ ok:true, row:object, competitionId:string, entryAdded:boolean, announced:boolean } | { ok:false, error:string }}
 */
export function addSportAction({ leagueId, leagueName = 'the league', option, enrollment, seasonLabel = '', commissionerMemberId = null, announce = false, existing = null, deps = {} } = {}) {
  const label = option && option.label ? option.label : 'the sport';
  const row = newCompetitionRow({ leagueId, dbCode: option && option.dbCode, enrollment, seasonLabel, existing });
  if (!row) return { ok: false, error: MS_COPY.failed(label) };
  try {
    if (typeof deps.saveCompetition !== 'function') throw new Error('no writer');
    deps.saveCompetition(row);
  } catch (err) {
    return { ok: false, error: MS_COPY.failed(label) };
  }
  let entryAdded = false;
  if (enrollment === 'opt_in' && commissionerMemberId && typeof deps.addEntry === 'function') {
    try { entryAdded = deps.addEntry(row.id, commissionerMemberId, 'commissioner') !== false; } catch { entryAdded = false; }
  }
  let announced = false;
  if (announce && typeof deps.announce === 'function') {
    try { announced = !!deps.announce(MS_COPY.announceBody(label, leagueName)); } catch { announced = false; }
  }
  return { ok: true, row, competitionId: row.id, entryAdded, announced };
}

/** Archive a sport: refused with the in-progress copy when a week is in progress; otherwise sets `archivedAt` (nothing is deleted) through the one writer. */
export function archiveSportAction({ competition, weeks = [], label = 'This sport', now = () => new Date().toISOString(), deps = {} } = {}) {
  if (!competition || competition.isDefault) return { ok: false, error: MS_COPY.archiveBlocked(label) };
  const blocked = archiveBlocker({ weeks, label });
  if (blocked) return { ok: false, error: blocked };
  try { deps.saveCompetition({ ...competition, archivedAt: now() }); } catch { return { ok: false, error: MS_COPY.failed(label) }; }
  return { ok: true };
}

/**
 * The Archive confirmation (reviewer S7): the shared action sheet - the same builder and layer Waive and Leave use - so the scrim, Esc, inert background, focus return and the warning haptic are the
 * ones every destructive confirmation already has. Never `window.confirm`. Destructive "Archive NFL", bold Cancel; the scrim and Esc cancel. `data-ls-action` is the layer's own attribute.
 */
export function archiveSportSheetHTML({ label = '' } = {}, { escHtml } = {}) {
  if (typeof escHtml !== 'function') throw new TypeError('archiveSportSheetHTML() requires the real escHtml');
  return actionSheetHTML({
    escHtml, titleId: 'ms-archive-title', title: MS_COPY.archiveSheetTitle(label), message: MS_COPY.archiveSheetMessage, scrimAction: 'cancel', actionAttr: 'data-ls-action',
    danger: { label: MS_COPY.archiveAction(label), action: 'confirm-archive-sport' }, cancel: { label: MS_COPY.cancel, action: 'cancel' },
  });
}
