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

import { setupLabel, startVerb } from './slate-name.js';
import { actionSheetHTML } from './league-create.js';
import { rankNightCandidates } from './night-slate.js';   // the ONE action-sheet builder (scrim, destructive action, bold Cancel) every confirmation here uses

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
    // D2 DI-875 (lane 3, 2026-10-19): an ARCHIVED sport is not offered here — it has its own Restore (which keeps who plays); one path, never an add that re-asks and rewrites enrollment
    if (mine.some((c) => c.archivedAt)) continue;
    const archived = null;
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
export function nextActionFor({ week, games = [], nextWeekNumber = 1, sport = null } = {}) {
  if (!week || week.status === 'final') return { kind: 'setup', label: setupLabel({ weekN: nextWeekNumber }, sport) };   // D2 lane 2: "Set up Week 7" for football, "Set up the next slate" for a night sport
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
    else if (week && (week.status === 'locked' || week.status === 'live') && Number.isFinite(firstKick) && r.formatTime) timeLabel = `${startVerb(c.sport).replace(/^./, (x) => x.toUpperCase())} ${r.formatTime(firstKick)}`;
    rows.push({
      competitionId: c.id, dbCode: c.sport, code, label,
      weekId: week ? week.weekId : null, weekNumber: week ? week.weekNumber : nextNum,
      status: week ? week.status : 'none',
      statusLabel: !week ? 'NO WEEK' : (ls && ls.label ? String(ls.label).toUpperCase() : String(week.status).toUpperCase()),
      badgeKind: week ? (ls && ls.phase ? ls.phase : week.status) : 'none',
      inCount, entrantCount: isOpen ? entrants.length : null, showCounts: !!isOpen && inCount !== null,
      timeLabel, lockAtMs: isOpen ? lockAtMs : null,
      action: nextActionFor({ week, games, nextWeekNumber: nextNum, sport: c.sport }),
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
export function suggestSlateFor({ profile, candidates = [], size = null, dayOf = weekdayKeyET, favoriteTeams = [] } = {}) {
  // D2 lane 2 (DI-887): a sport whose slate is a game NIGHT (the NHL) ranks by national TV, then a member's favourite team, then the earliest puck drop (js/night-slate.js).
  if (profile && profile.slate && profile.slate.unit === 'night') return rankNightCandidates({ games: candidates, profile, favoriteTeams });
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


// ── archive and restore (Deployment 2, thread 101826-D2, lane 3; UN/PF-518, DI-867…880) ─────────────────────────────────────────────────
/**
 * The words of the feature (DI-867): Archive, Archived, Restore, "history kept". "Delete" never appears beside it. Every sentence a surface shows comes from here.
 * `code` is the sport's short code ("NFL"), `league` the league's name.
 */
export const ARCHIVE_COPY = Object.freeze({
  archiveRow: 'Archive a sport…',
  archiveRowSub: (codes) => `${codes} · stops reminders and weekly setup, keeps history`,
  archivedRow: 'Archived sports',
  archivedRowSubComm: (n) => `${n} archived · restore or view history`,
  archivedRowSubMember: (n) => `${n} archived · view history`,
  pickTitle: 'Archive which sport?',
  // D2 DI-869's blocked state (review fix 5): the shipped sentence is joined by ONE button that opens that sport's week in Comm
  openBlockedWeek: (code, n) => (Number.isFinite(Number(n)) && Number(n) > 0 ? `Open ${code} Week ${Number(n)}` : `Open the ${code} week`),
  sheetSubtitle: (league, code) => (league ? `${league} · ${code}` : code),
  stopsTitle: 'Stops',
  stops: (code) => `${code} pick reminders and notifications · weekly setup in Comm · ${code} in the sport switcher, Game Day and the join offer`,
  keepsTitle: 'Keeps',
  keeps: 'Picks, results, standings, game threads, history, analytics and league memories. Nothing is deleted.',
  restorableTitle: 'You can restore it any time',
  restorable: (code) => `Members who played ${code} are still in.`,
  announceLabel: 'Tell the league in the Locker Room',
  archiveAnnounce: (name, code) => `${name} archived ${code}. Its history is kept and can be restored.`,
  archiveAction: (code) => `Archive ${code}`,
  archiving: (code) => `Archiving ${code}…`,
  archiveFailed: (code) => `Couldn't archive ${code}. Nothing was changed. Try again.`,
  archived: (code) => `${code} archived.`,
  restoreTitle: (code) => `Restore ${code}?`,
  comesBackTitle: 'Comes back',
  comesBack: (code) => `${code} in the switcher, Game Day, reminders and Comm. Picks open when you set up the next week.`,
  unchangedTitle: 'Unchanged',
  unchanged: 'Who played, past picks, results and standings.',
  restoreAnnounce: (name, code) => `${name} restored ${code}.`,
  restoreAction: (code) => `Restore ${code}`,
  restoring: (code) => `Restoring ${code}…`,
  restoreFailed: (code) => `Couldn't restore ${code}. Nothing was changed. Try again.`,
  restored: (code) => `${code} restored.`,
  mainSportBadge: 'Main sport',
  mainSportReason: "This is the league's main sport. To archive it, make another sport the main one first.",
  archivedBadge: 'Archived',
  activeBadge: 'Active',
  listTitle: 'Archived sports',
  listIntro: 'Archived sports are read-only. Their picks, results and history are kept.',
  listRowSub: (date, n) => `Archived ${date} · ${n} ${n === 1 ? 'week' : 'weeks'} played · history kept`,
  listFootnote: 'Only the commissioner sees Restore. Members can open the history.',
  historyBanner: (code, n) => `${code} is archived. This is a read-only record of ${n} ${n === 1 ? 'week' : 'weeks'}.`,
  historyStandingsTitle: 'Standings',
  historyWeeksTitle: 'Weeks',
  historyEmpty: 'No weeks were played.',
  threadReadOnly: 'This sport is archived. Threads are read-only.',
  linkArchived: (code) => `${code} is archived. History is in the league overview.`,
  sportArchived: (code) => `${code} is archived. Restore it to set up a week.`,
  offlineArchive: "Not connected — a sport can't be archived right now.",
  offlineRestore: "Not connected — a sport can't be restored right now.",
});

/**
 * DI-872: the server's named refusals (migration 0070) to the sentences the member reads — never a code. `serverMessage` is what the adapter kept for the refused write.
 * @returns {string}
 */
export function archiveRefusalCopy(serverMessage, code, { restoring = false } = {}) {
  const m = String(serverMessage || '');
  if (/\bmain_sport\b/.test(m)) return ARCHIVE_COPY.mainSportReason;
  if (/\bsport_in_progress\b/.test(m)) return MS_COPY.archiveBlocked(code);
  if (/\bsport_archived\b/.test(m)) return ARCHIVE_COPY.sportArchived(code);
  return restoring ? ARCHIVE_COPY.restoreFailed(code) : ARCHIVE_COPY.archiveFailed(code);
}

/**
 * DI-875: Restore writes `archivedAt = null` and NOTHING else — enrollment, who plays (competition_members), the settings, the season label are the row's own, untouched; no week moves.
 * The writer is the caller's (the storage seam); it is handed a COPY of the row with the one field changed.
 * @returns {{ok:true} | {ok:false, error:string}}
 */
export function restoreSportAction({ competition, label = 'This sport', deps = {} } = {}) {
  if (!competition || !competition.archivedAt) return { ok: false, error: ARCHIVE_COPY.restoreFailed(label) };
  try { deps.saveCompetition({ ...competition, archivedAt: null }); } catch { return { ok: false, error: ARCHIVE_COPY.restoreFailed(label) }; }
  return { ok: true };
}

/**
 * DI-876: the Archived sports list — one row per archived sport of this league, newest archive first: its code, the archive date and how many weeks were played. Pure: the caller hands the
 * league's competitions, weeks (every week, with its competitionId), `playedWeekIds` (the weeks that were finalized AND are revealed — the caller asks its own reveal predicate; this module
 * reads no week status), the sport profiles, and a date formatter in the viewer's zone.
 */
export function archivedSportsRows({ competitions = [], weeks = [], playedWeekIds = null, profiles = [], formatDate = (iso) => String(iso).slice(0, 10) } = {}) {
  const comps = (Array.isArray(competitions) ? competitions : []).filter((c) => c && c.id && c.archivedAt);
  const prof = (k) => (Array.isArray(profiles) ? profiles : []).find((p) => p && p.key === k) || null;
  return comps.map((c) => {
    const p = prof(c.sport);
    const code = (p && (p.code || p.label)) || String(c.sport || '').toUpperCase();
    const played = playedWeekIds instanceof Set ? (Array.isArray(weeks) ? weeks : []).filter((w) => w && w.competitionId === c.id && playedWeekIds.has(w.weekId)).length : 0;
    let date = '';
    try { date = formatDate(c.archivedAt) || ''; } catch { date = ''; }
    return { competitionId: c.id, sport: c.sport, code, label: (p && p.label) || code, archivedAt: c.archivedAt, weeksPlayed: played, subtitle: ARCHIVE_COPY.listRowSub(date, played) };
  }).sort((a, b) => String(b.archivedAt).localeCompare(String(a.archivedAt)));
}

const groupRow = (escHtml, title, body) => `<div class="ms-ar-row"><span class="ms-ar-ttl">${escHtml(title)}</span><span class="ms-ar-body">${escHtml(body)}</span></div>`;

/**
 * DI-869: the Archive confirmation, on the shared action sheet (scrim, Esc, inert background, focus return, warning haptic). Title "Archive NFL?", the "IRB · NFL" line, the three plain groups
 * (Stops, Keeps, You can restore it any time), the announcement toggle (on), the destructive "Archive NFL" and the bold Cancel. `switchHTML` is the app's own switch row builder (one markup).
 */
export function archiveSportConfirmHTML({ code = '', league = '', announce = true } = {}, { escHtml, switchHTML } = {}) {
  if (typeof escHtml !== 'function') throw new TypeError('archiveSportConfirmHTML() requires the real escHtml');
  if (typeof switchHTML !== 'function') throw new TypeError('archiveSportConfirmHTML() requires the app switch row builder');
  const fieldHTML = `<div class="ms-ar-groups">${groupRow(escHtml, ARCHIVE_COPY.stopsTitle, ARCHIVE_COPY.stops(code))}${groupRow(escHtml, ARCHIVE_COPY.keepsTitle, ARCHIVE_COPY.keeps)}`
    + `${groupRow(escHtml, ARCHIVE_COPY.restorableTitle, ARCHIVE_COPY.restorable(code))}</div>`
    + switchHTML({ id: 'ms-archive-announce', label: ARCHIVE_COPY.announceLabel, on: announce !== false })
    + `<p class="ms-ar-error" id="ms-archive-error" role="alert"></p>`;
  return actionSheetHTML({
    escHtml, titleId: 'ms-archive-title', title: MS_COPY.archiveSheetTitle(code), message: ARCHIVE_COPY.sheetSubtitle(league, code), fieldHTML, scrimAction: 'cancel', actionAttr: 'data-ls-action',
    danger: { label: ARCHIVE_COPY.archiveAction(code), action: 'confirm-archive-sport' }, cancel: { label: MS_COPY.cancel, action: 'cancel' },
  });
}

/** DI-875: the Restore confirmation — the same shared sheet: "Restore CFB?", the "Residency · CFB" line, Comes back / Unchanged, the announcement toggle (on), "Restore CFB" (not destructive) and the bold Cancel. */
export function restoreSportConfirmHTML({ code = '', league = '', announce = true } = {}, { escHtml, switchHTML } = {}) {
  if (typeof escHtml !== 'function') throw new TypeError('restoreSportConfirmHTML() requires the real escHtml');
  if (typeof switchHTML !== 'function') throw new TypeError('restoreSportConfirmHTML() requires the app switch row builder');
  const fieldHTML = `<div class="ms-ar-groups">${groupRow(escHtml, ARCHIVE_COPY.comesBackTitle, ARCHIVE_COPY.comesBack(code))}${groupRow(escHtml, ARCHIVE_COPY.unchangedTitle, ARCHIVE_COPY.unchanged)}</div>`
    + switchHTML({ id: 'ms-restore-announce', label: ARCHIVE_COPY.announceLabel, on: announce !== false })
    + `<p class="ms-ar-error" id="ms-restore-error" role="alert"></p>`;
  return actionSheetHTML({
    escHtml, titleId: 'ms-restore-title', title: ARCHIVE_COPY.restoreTitle(code), message: ARCHIVE_COPY.sheetSubtitle(league, code), fieldHTML, scrimAction: 'cancel', actionAttr: 'data-ls-action',
    actions: [{ label: ARCHIVE_COPY.restoreAction(code), action: 'confirm-restore-sport' }], cancel: { label: MS_COPY.cancel, action: 'cancel' },
  });
}

/** DI-868: "Archive a sport…" with more than one sport that can be archived — a CHOICE on the shared sheet (one row per sport, bold Cancel); the confirmation follows. Ids are the caller's own competitions. */
/**
 * D2 DI-869's blocked state, in place (review fix 5): no confirmation sheet — the shipped sentence and ONE button that opens that sport's week in Comm. The caller puts it directly
 * under the control that was tapped (the league overview's "Archive a sport…", or the chosen row of the choice sheet). Every dynamic part through the injected `escHtml`.
 */
export function archiveBlockedHTML({ competitionId = '', message = '', code = '', weekNumber = null } = {}, { escHtml } = {}) {
  if (typeof escHtml !== 'function') throw new TypeError('archiveBlockedHTML() requires the real escHtml');
  if (!competitionId || !message || !code) return '';
  return `<div class="ms-archive-blocked" role="status" data-archive-blocked="${escHtml(competitionId)}"><p class="ms-archive-blocked-text">${escHtml(message)}</p>`
    + `<button type="button" class="btn btn-secondary btn-sm ms-archive-blocked-go" data-archive-open-week="${escHtml(competitionId)}">${escHtml(ARCHIVE_COPY.openBlockedWeek(code, weekNumber))}</button></div>`;
}

export function archivePickHTML({ sports = [] } = {}, { escHtml } = {}) {
  if (typeof escHtml !== 'function') throw new TypeError('archivePickHTML() requires the real escHtml');
  const list = (Array.isArray(sports) ? sports : []).filter((s) => s && s.competitionId && s.code);
  if (!list.length) return '';
  return actionSheetHTML({
    escHtml, titleId: 'ms-archive-pick-title', title: ARCHIVE_COPY.pickTitle, scrimAction: 'cancel', actionAttr: 'data-ls-action',
    actions: list.map((s) => ({ label: s.code, action: `archive-pick:${s.competitionId}` })), cancel: { label: MS_COPY.cancel, action: 'cancel' },
  });
}

/** DI-875: after a restore, the shipped offer — "Set up the first CFB week" — on the shared sheet as a choice, with "Not now". */
export function restoreSetupOfferHTML({ code = '' } = {}, { escHtml } = {}) {
  if (typeof escHtml !== 'function') throw new TypeError('restoreSetupOfferHTML() requires the real escHtml');
  return actionSheetHTML({
    escHtml, titleId: 'ms-restore-setup-title', title: ARCHIVE_COPY.restored(code), scrimAction: 'cancel', actionAttr: 'data-ls-action',
    actions: [{ label: MS_COPY.setUpFirstWeek(code), action: 'restore-setup-week' }], cancel: { label: MS_COPY.notNow, action: 'cancel' },
  });
}

/**
 * DI-868: Comm's Sports rows, from the caller's row model (the app reads the competitions and the blockers; this builds the markup, every dynamic part through the injected `escHtml`).
 * rows: [{ competitionId, code, badge, line?, note?, noteId?, action?: { kind: 'archive' | 'restore', label, disabled? } }]. '' with no rows.
 */
export function sportsStateCardHTML(rows, { escHtml } = {}) {
  if (typeof escHtml !== 'function') throw new TypeError('sportsStateCardHTML() requires the real escHtml');
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && r.competitionId && r.code);
  if (!list.length) return '';
  const rowHTML = (r) => {
    const a = r.action && (r.action.kind === 'archive' || r.action.kind === 'restore') ? r.action : null;
    const noteId = r.note ? String(r.noteId || `comm-sport-note-${r.competitionId}`) : '';
    const btn = a
      ? `<button type="button" class="btn ${a.kind === 'restore' ? 'btn-secondary' : 'btn-ghost'} btn-sm comm-sport-state-btn" data-action="comm-sport-${a.kind}" data-competition="${escHtml(r.competitionId)}"`
        + (a.disabled ? ` disabled aria-describedby="${escHtml(noteId)}"` : '') + `>${escHtml(a.label)}</button>`
      : '';
    return `<div class="comm-sport-state-row" data-competition="${escHtml(r.competitionId)}">`
      + `<div class="comm-sport-state-head"><strong>${escHtml(r.code)}</strong><span class="badge comm-sport-state-badge">${escHtml(r.badge)}</span></div>`
      + (r.line ? `<div class="text-muted text-xs">${escHtml(r.line)}</div>` : '')
      + btn
      + (r.note ? `<p class="text-muted text-xs" id="${escHtml(noteId)}" style="margin:0">${escHtml(r.note)}</p>` : '')
      + (r.go && r.go.label ? `<button type="button" class="btn btn-secondary btn-sm comm-sport-state-btn" data-action="comm-sport-open-week" data-competition="${escHtml(r.competitionId)}">${escHtml(r.go.label)}</button>` : '')   // DI-869: the blocked row's way forward
      + '</div>';
  };
  return '<div class="admin-section" data-comm-tab="week"><div class="admin-section-title">Sports</div><div class="card" id="comm-sports-state-card">'
    + list.map(rowHTML).join('') + '</div></div>';
}
