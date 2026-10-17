/**
 * scribe-profile-rules.js — the PURE half of the SCRIBE profile admin (D1 Lane C, FB-006 / UN-468 / PF-468; DI-643…648, DI-681, DI-682).
 * ===========================================================================================================================
 * One module imported by BOTH runtimes, the way `scribe-trainer-rules.js` is: the `scribe-profile` Edge Function (Deno) shapes and validates
 * with it, the pane (browser) validates and words with it, and `scribeprofiletest.mjs` (Node) drives the same code. It touches no
 * `Deno`, no `fetch`, no storage and no DOM, so there is nothing here that can read a pick, a secret or another league.
 *
 * WHAT IT HOLDS
 *   • the closed vocabularies (the eight instruction categories, the limits, the request-id shape);
 *   • the validators — ADVISORY on the client (they only save a round trip), AUTHORITATIVE on the server (the function runs the same ones
 *     before any write; `scribe_learning_add_human` / `scribe_lore_upsert` repeat the shape checks in SQL);
 *   • the SHAPERS that turn a database row into the fixed-field object the pane may see (`shapeLearningRow`, `shapeCanonRow`, the roster
 *     summary, `mapHistoryRow`). A shaper never copies a raw payload through: every field it returns is named here, clamped and stripped of
 *     control and bidirectional characters, so a field added to a payload later cannot reach the commissioner's screen by accident (DI-646:
 *     "fixed fields only, never a raw before or after image").
 *
 * WHAT IT NEVER RETURNS (DI-643): a pick, a tiebreaker, a secret, another league's row, a player's hard line TEXT (a count only), a
 * member's email or phone. The history shaper emits NO text at all for boundary and roast-limit rows — who and when, never what.
 */

import { isHumanApproved, isLearningExpired } from './scribe-trainer-rules.js';

// ── closed vocabularies ────────────────────────────────────────────────────────────────────────────
/** The EIGHT non-factual learning categories a person may write an instruction under (`FAST_AUTO_APPLY_CATEGORIES`, in the order the sheet lists them). */
export const INSTRUCTION_CATEGORIES = Object.freeze([
  Object.freeze({ value: 'roast_intensity', label: 'Roast intensity' }),
  Object.freeze({ value: 'brevity', label: 'Brevity' }),
  Object.freeze({ value: 'humor', label: 'Humor' }),
  Object.freeze({ value: 'frequency', label: 'Frequency' }),
  Object.freeze({ value: 'profanity', label: 'Profanity' }),
  Object.freeze({ value: 'callbacks', label: 'Callbacks' }),
  Object.freeze({ value: 'target_selection', label: 'Who to target' }),
  Object.freeze({ value: 'animation', label: 'Animation' }),
]);
export const INSTRUCTION_CATEGORY_VALUES = Object.freeze(INSTRUCTION_CATEGORIES.map((c) => c.value));
/** Display labels for every category a learning may carry (the eight above plus `factual`, which the Trainer may propose and a person may not write). */
const CATEGORY_LABELS = Object.freeze({ ...Object.fromEntries(INSTRUCTION_CATEGORIES.map((c) => [c.value, c.label])), factual: 'Factual' });
export function categoryLabel(value) {
  const key = String(value || '');
  if (Object.prototype.hasOwnProperty.call(CATEGORY_LABELS, key)) return CATEGORY_LABELS[key];
  return key ? key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : 'General';
}

export const TEXT_MAX = 200;          // an instruction, a player fact's text, a lore entry's text
export const KEY_MAX = 40;            // a player fact's topic, a lore entry's topic
export const HISTORY_PAGE = 30;       // History pages 30 at a time (DI-646)
export const HISTORY_FETCH = 60;      // raw audit rows read per page; rows that map to nothing (a bookkeeping update) are skipped
export const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;
export const LIVE_CONFIDENCE_FLOOR = 0.75;   // = SCRIBE_RUNTIME_CONFIDENCE_THRESHOLD (scribe-context.mjs / scribeAgent.js): the floor for a row no human approved
export const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
/** Control characters and the bidirectional/invisible formatting class — the canonical class migration 0042's league-name check and 0052's text checks use. */
const UNSAFE_RANGES = Object.freeze([[0x0000, 0x001F], [0x007F, 0x009F], [0x061C, 0x061C], [0x200B, 0x200F], [0x2028, 0x202E], [0x2060, 0x206F], [0xFEFF, 0xFEFF]]);
const hex4 = (n) => '\\u' + n.toString(16).toUpperCase().padStart(4, '0');
export const UNSAFE_CHARS_RE = new RegExp(`[${UNSAFE_RANGES.map(([a, b]) => (a === b ? hex4(a) : `${hex4(a)}-${hex4(b)}`)).join('')}]`);
const PRINTABLE_ASCII_RE = /^[ -~]+$/;

export const ACTIONS = Object.freeze(['view', 'history', 'add_instruction', 'correct_instruction', 'keep', 'add_fact', 'remove_fact', 'add_lore', 'correct_lore', 'remove_lore']);
/** SCRIBE follows at most this many rules (`ACTIVE_LEARNING_CAP`, js/scribe-trainer-rules.js; migration 0052's scribe_active_rule_cap()): the 16th is refused, never silently dropped (B3). */
export const RULE_CAP = 15;
/** How many approved rows the prompt loader looks at before it applies the floor (`CONTEXT_ROW_LIMIT`, _shared/scribe-context.mjs). */
export const LOADER_ROW_WINDOW = 50;
/** The wording of the refusal, the pane's pre-check and the server's named code all say one thing. */
export const RULE_CAP_MESSAGE = `SCRIBE follows up to ${RULE_CAP} rules. Turn one off first.`;
/**
 * N2 (reviewer, 2026-10-08) — THE HELD-FOR-REVIEW WORDS, WRITTEN ONCE. The badge, its reason clause, the confirmation before approving a held proposal, the "held" toast and the refusal sentence
 * all come from these three constants; js/app.js (the Trainer card's badge and the pane's confirm) and js/scribe-profile-view.js (the pane's badge, reason and sentences) import them. The wording
 * says what was TOUCHED and leaves the judgement to the commissioner reading the row (the argument at `SCRIBE_HOLD_BADGE_REASON` in js/app.js).
 */
export const HOLD_BADGE_LABEL = '⚠️ held for review';
export const HOLD_BADGE_REASON = "touches safety, a hard line, or a player's real life";
export const HOLD_CONFIRM = `This proposal was held because it ${HOLD_BADGE_REASON}. SCRIBE will follow it if you approve it.`;
/** The one provenance a lore row may carry for SCRIBE to treat it as the commissioner's word (`scribe_lore_upsert` forces it; F1). */
export const LORE_PROVENANCE = 'commissioner-set';
export const READ_ACTIONS = Object.freeze(['view', 'history']);

// ── text helpers ────────────────────────────────────────────────────────────────────────────────────
/** A string, trimmed; anything else is ''. */
export function trimText(raw) {
  return typeof raw === 'string' ? raw.trim() : '';
}
/** For DISPLAY ONLY: a clamped, control-stripped copy of a stored string. Never used to decide anything. */
export function clampDisplay(raw, max = TEXT_MAX) {
  const s = typeof raw === 'string' ? raw : (raw === null || raw === undefined ? '' : String(raw));
  const clean = s.replace(new RegExp(UNSAFE_CHARS_RE.source, 'g'), ' ').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

// ── validators (the same ones run on the client for the live counter and on the server before any write) ───────────
/**
 * @param {{category?:string, text?:string}} input
 * @returns {{ok:true, category:string, text:string} | {ok:false, error:'bad_category'|'bad_text'}}
 */
export function validateInstruction(input) {
  const category = String((input && input.category) || '');
  if (!INSTRUCTION_CATEGORY_VALUES.includes(category)) return { ok: false, error: 'bad_category' };
  const text = trimText(input && input.text);
  if (text.length < 1 || text.length > TEXT_MAX || UNSAFE_CHARS_RE.test(text)) return { ok: false, error: 'bad_text' };
  return { ok: true, category, text };
}
/** A player fact: the topic is printable ASCII (it is an identifier — the upsert key), the text printable. */
export function validateFact(input) {
  const key = trimText(input && input.key);
  if (key.length < 1 || key.length > KEY_MAX || !PRINTABLE_ASCII_RE.test(key)) return { ok: false, error: 'bad_key' };
  const value = trimText(input && input.value);
  if (value.length < 1 || value.length > TEXT_MAX || UNSAFE_CHARS_RE.test(value)) return { ok: false, error: 'bad_text' };
  return { ok: true, key, value };
}
/** A lore entry: the same shapes as a fact (topic ≤ 40 printable ASCII, text ≤ 200). */
export function validateLore(input) {
  const key = trimText(input && input.key);
  if (key.length < 1 || key.length > KEY_MAX || !PRINTABLE_ASCII_RE.test(key)) return { ok: false, error: 'bad_key' };
  const text = trimText(input && input.text);
  if (text.length < 1 || text.length > TEXT_MAX || UNSAFE_CHARS_RE.test(text)) return { ok: false, error: 'bad_text' };
  return { ok: true, key, text };
}
export function isRequestId(value) {
  return typeof value === 'string' && REQUEST_ID_RE.test(value);
}

// ── row shapers ─────────────────────────────────────────────────────────────────────────────────────
function iso(value) {
  const t = Date.parse(value || '');
  return Number.isFinite(t) ? new Date(t).toISOString() : '';
}

/** The one-line text a learning row SAYS, whatever its kind. */
export function learningRowText(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  if (p.kind === 'experiment') return clampDisplay([p.experiment, p.reason].filter((x) => typeof x === 'string' && x).join(' — '));
  if (p.kind === 'fact_candidate') return clampDisplay(`${p.key || ''}: ${p.value || ''}`);
  return clampDisplay(p.instruction);
}
export function canonRowText(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  if (p.kind === 'anti_canon') return clampDisplay(p.line);
  const reply = clampDisplay(p.preferredResponse);
  const ctx = clampDisplay(p.contextSummary);
  return clampDisplay(ctx && reply ? `${ctx} → ${reply}` : (reply || ctx));
}

/**
 * Is a learning row ACTIVE — actually read into SCRIBE's prompt? The server's loader rule (`scribe-context.mjs`), restated over the row: approved, and either a
 * person approved it (DI-681: whatever the confidence) or its confidence clears the floor; and not past a provisional expiry (a human-approved row never expires).
 */
export function isLearningLive(payload, status, nowMs = Date.now()) {
  if (status !== 'approved') return false;
  if (isLearningExpired(payload, nowMs)) return false;
  return isHumanApproved(payload) || Number(payload && payload.confidence) >= LIVE_CONFIDENCE_FLOOR;
}

/**
 * THE ROWS SCRIBE ACTUALLY READS (B3: the pane's live flags and counts must match the prompt). The loader (`loadActiveLearningsText`) takes the approved kind=learning rows newest
 * first (created_at desc, id asc), looks at the first LOADER_ROW_WINDOW, keeps the live ones (isLearningLive) and stops at the cap. This is that selection, over raw rows, as a Set of ids.
 * @param {Array<{id:string, kind:string, status:string, created_at?:string, payload?:object}>} rows
 */
export function selectReadByScribe(rows, { cap = RULE_CAP, window = LOADER_ROW_WINDOW, nowMs = Date.now() } = {}) {
  const approved = (rows || []).filter((r) => r && r.kind === 'learning' && r.status === 'approved');
  approved.sort((a, b) => {
    const ta = Date.parse(a.created_at || ''), tb = Date.parse(b.created_at || '');
    const na = Number.isFinite(ta) ? ta : -Infinity, nb = Number.isFinite(tb) ? tb : -Infinity;
    if (na !== nb) return nb - na;
    return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
  });
  const read = new Set();
  for (const r of approved.slice(0, window)) {
    if (read.size >= cap) break;
    if (isLearningLive(r.payload || {}, 'approved', nowMs) && learningRowText({ ...(r.payload || {}), kind: 'learning' })) read.add(String(r.id));
  }
  return read;
}

/**
 * A `scribe_learnings` row → the fixed-field object the pane sees.
 * @param {{id:string, kind:string, status:string, origin?:string, payload?:object, created_at?:string}} row
 * @param {{names?:Record<string,string>, rowsById?:Record<string,object>, callerMemberId?:string, nowMs?:number, readIds?:Set<string>}} ctx
 *   `readIds` (from selectReadByScribe) makes `live` mean "SCRIBE reads this row"; without it `live` is the row's own isLearningLive.
 */
export function shapeLearningRow(row, ctx = {}) {
  const p = (row && row.payload && typeof row.payload === 'object') ? row.payload : {};
  const names = ctx.names || {};
  const nowMs = Number.isFinite(ctx.nowMs) ? ctx.nowMs : Date.now();
  const origin = ['trainer', 'instant', 'human'].includes(row.origin) ? row.origin : (['trainer', 'instant', 'human'].includes(p.origin) ? p.origin : 'trainer');
  const human = isHumanApproved(p);
  const createdAt = iso(row.created_at || p.createdAt);
  const confidence = Number.isFinite(Number(p.confidence)) ? Number(p.confidence) : 0;
  const src = p.source && typeof p.source === 'object' ? p.source : {};
  const autoApplied = row.status === 'approved' && !human && (origin === 'instant' || confidence >= 0.9);
  const ageMs = Date.parse(createdAt) ? nowMs - Date.parse(createdAt) : Infinity;
  const replacesId = typeof p.replaces === 'string' ? p.replaces : '';
  const target = replacesId && ctx.rowsById ? ctx.rowsById[replacesId] : null;
  const out = {
    id: String(row.id),
    list: 'learnings',
    kind: ['learning', 'experiment', 'fact_candidate'].includes(row.kind) ? row.kind : 'learning',
    category: row.kind === 'fact_candidate' ? 'player_fact' : (row.kind === 'experiment' ? 'experiment' : String(p.category || '')),
    text: learningRowText({ ...p, kind: row.kind }),
    status: String(row.status || ''),
    origin,
    humanApproved: human,
    live: ctx.readIds ? ctx.readIds.has(String(row.id)) : isLearningLive(p, row.status, nowMs),
    provisional: p.provisional === true && !human,
    autoApplied,
    undoable: autoApplied && ageMs >= 0 && ageMs < UNDO_WINDOW_MS,
    confidence,
    flaggedHostile: p.flaggedHostile === true,
    createdAt,
    source: {
      quote: clampDisplay(src.quote),
      authorName: clampDisplay(typeof src.playerId === 'string' ? (names[src.playerId] || '') : '', 60),
      at: iso(p.createdAt || row.created_at),
    },
  };
  // What the pane may offer on the row (the view never trusts the client to work these out): Correct only for a writable category (a Trainer `factual` rule has no instruction category to
  // correct it under — N4), Keep only for an approved rule no person has approved yet (B1).
  out.correctable = row.kind === 'learning' && INSTRUCTION_CATEGORY_VALUES.includes(String(p.category || ''));
  out.keepable = row.kind === 'learning' && row.status === 'approved' && !human;
  if (human) out.approvedAt = iso(p.approvedAt);
  if (row.kind === 'fact_candidate') out.playerName = clampDisplay(typeof p.playerId === 'string' ? (names[p.playerId] || '') : '', 60);
  if (typeof p.supersedes === 'string' && p.supersedes) out.supersedes = p.supersedes;
  if (typeof p.replacedId === 'string' && p.replacedId) out.replacedId = p.replacedId;
  if (replacesId) {
    out.replaces = replacesId;
    out.replacesText = target ? learningRowText({ ...(target.payload || {}), kind: target.kind }) : '';
    out.replacesActive = !!(target && target.status === 'approved');
  }
  return out;
}

/** A `scribe_canon` row → the fixed-field object. Canon is shown as "Examples it imitates" (approved) or a review row (pending). */
export function shapeCanonRow(row, ctx = {}) {
  const p = (row && row.payload && typeof row.payload === 'object') ? row.payload : {};
  const origin = ['trainer', 'instant', 'human'].includes(row.origin) ? row.origin : 'trainer';
  const kind = row.kind === 'anti_canon' ? 'anti_canon' : 'canon';
  return {
    id: String(row.id),
    list: 'canon',
    kind,
    category: kind === 'anti_canon' ? 'line_to_avoid' : 'example',
    text: canonRowText({ ...p, kind }),
    status: String(row.approval_status || ''),
    origin,
    humanApproved: false,
    live: row.approval_status === 'approved' && kind === 'canon' && Number(p.confidence) >= LIVE_CONFIDENCE_FLOOR,
    provisional: false,
    autoApplied: false,
    undoable: false,
    confidence: Number.isFinite(Number(p.confidence)) ? Number(p.confidence) : 0,
    flaggedHostile: p.flaggedHostile === true,
    createdAt: iso(row.created_at || p.createdAt),
    source: { quote: '', authorName: '', at: iso(p.createdAt || row.created_at) },
  };
}

/**
 * The roster summary: one entry per member, fixed fields. `rows` are `scribe_memory` rows (any kind, any subject) for ONE league.
 * Facts are listed (text ≤ 200, provenance, when); a hard line is COUNTED and its text is never returned; the roast limit is its word.
 */
export function summarizePlayers(members, memoryRows) {
  const byMember = new Map();
  for (const m of members || []) {
    if (!m || m.id === undefined || m.id === null) continue;
    byMember.set(String(m.id), {
      memberId: String(m.id), name: clampDisplay(m.display_name || m.name || 'Player', 60), factCount: 0, boundaryCount: 0, tolerance: '', facts: [],
    });
  }
  for (const r of memoryRows || []) {
    const e = r && byMember.get(String(r.subject_member_id || ''));
    if (!e) continue;
    if (r.kind === 'fact' || r.kind === 'relation') {
      e.factCount += 1;
      if (e.facts.length < 20) e.facts.push({ key: clampDisplay(r.key, KEY_MAX), text: clampDisplay(r.value), provenance: String(r.provenance || ''), at: iso(r.refreshed_at || r.created_at) });
    } else if (r.kind === 'hardline') {
      e.boundaryCount += 1;
    } else if (r.kind === 'roastTolerance') {
      e.tolerance = clampDisplay(r.value, 24);
    }
  }
  return [...byMember.values()];
}
/**
 * The lore entries: key, text, when, who added it. ONLY rows the commissioner's own path wrote (`provenance = 'commissioner-set'`, F1 — the same filter the prompt loader applies), so a
 * lore-shaped row of any other provenance is not shown as league history. `ctx.actors` maps a memory row id to the member who last wrote it (from the audit trail); `addedBy` is
 * 'you' for the caller, `{ name }` for another member, and '' when the trail does not say (N6: the wording is chosen per viewer by the markup, never assumed).
 */
export function shapeLore(memoryRows, ctx = {}) {
  const names = ctx.names || {};
  const actors = ctx.actors || {};
  return (memoryRows || []).filter((r) => r && r.kind === 'lore' && r.provenance === LORE_PROVENANCE)
    .map((r) => {
      const by = typeof actors[String(r.id)] === 'string' ? actors[String(r.id)] : '';
      return {
        key: clampDisplay(r.key, KEY_MAX), text: clampDisplay(r.value), updatedAt: iso(r.refreshed_at || r.created_at),
        addedBy: !by ? '' : (ctx.callerMemberId && by === ctx.callerMemberId ? 'you' : { name: clampDisplay(names[by] || 'A commissioner', 60) }),
      };
    })
    .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
}

// ── history (DI-646) ─────────────────────────────────────────────────────────────────────────────────
function actorOf(audit, after, before, ctx) {
  const names = ctx.names || {};
  const member = typeof audit.actor_member_id === 'string' ? audit.actor_member_id : '';
  if (member) {
    if (ctx.callerMemberId && member === ctx.callerMemberId) return 'you';
    return { name: clampDisplay(names[member] || 'A member', 60) };
  }
  const src = after || before || {};
  const payload = src.payload && typeof src.payload === 'object' ? src.payload : {};
  const origin = src.origin || payload.origin;
  // F3 (security, 2026-10-08): a row a COMMISSIONER added is written by `scribe_learning_add_human` under the SERVICE role, so the audit trail records no actor for it — and it used to read
  // "Trainer proposed". The function writes the author into `payload.source.playerId` (always an active commissioner of the league, checked in SQL), so an `origin = 'human'` row with a null
  // audit actor is attributed to that member: "You" when it is the caller, the commissioner's name otherwise.
  if (origin === 'human') {
    const author = payload.source && typeof payload.source === 'object' && typeof payload.source.playerId === 'string' ? payload.source.playerId : '';
    if (author) {
      if (ctx.callerMemberId && author === ctx.callerMemberId) return 'you';
      return { name: clampDisplay(names[author] || 'A commissioner', 60) };
    }
  }
  if (origin === 'instant') return 'instant';
  return 'trainer';
}

/**
 * One `audit_log` row → `{ at, actor, verb, kind, category, rowId, text }`, or `null` when the row records no change a commissioner would read (a bookkeeping
 * update of a payload, a wager, a row of another table). NEVER a raw before/after image. Boundary and roast-limit rows carry NO text.
 * `actor` is 'you' | 'trainer' | 'instant' | { name }.
 */
export function mapHistoryRow(audit, ctx = {}) {
  if (!audit || typeof audit !== 'object') return null;
  const before = audit.before && typeof audit.before === 'object' ? audit.before : null;
  const after = audit.after && typeof audit.after === 'object' ? audit.after : null;
  const at = iso(audit.at);
  const rowId = typeof audit.row_id === 'string' ? clampDisplay(audit.row_id, 120) : '';
  const base = { at, rowId };
  const table = audit.table_name;
  const action = audit.action;

  if (table === 'scribe_learnings') {
    const img = after || before || {};
    const payload = (img.payload && typeof img.payload === 'object') ? img.payload : {};
    const kind = img.kind || payload.kind || 'learning';
    const status = after && after.status;
    const prev = before && before.status;
    let verb = '';
    if (action === 'INSERT') {
      const origin = img.origin || payload.origin;
      if (origin === 'human') verb = status === 'approved' ? 'added' : 'added, held for review';
      else if (status === 'approved') verb = 'auto-applied';
      else verb = 'proposed';
    } else if (action === 'UPDATE' && status !== prev) {
      verb = { approved: prev === 'superseded' ? 'turned on' : 'approved', rejected: 'rejected', superseded: 'turned off', expired: 'expired', pending: 'put back for review' }[status] || '';
    }
    if (!verb) return null;
    const text = learningRowText({ ...payload, kind });
    const entry = { ...base, actor: actorOf(audit, after, before, ctx), verb, kind: kind === 'fact_candidate' ? 'fact' : kind, category: kind === 'learning' ? String(payload.category || '') : kind, text };
    // The two ways one statement changes TWO rows (N1): a correction (the new row records `supersedes`) and an approved Replace (the guard renames `replaces` to `replacedId`). The id of the row
    // that was retired rides along so foldHistory() can show ONE entry; it is an internal row id, not a secret.
    if (action === 'INSERT' && typeof payload.supersedes === 'string' && payload.supersedes) entry.corrects = clampDisplay(payload.supersedes, 120);
    if (action === 'UPDATE' && status === 'approved' && typeof payload.replacedId === 'string' && payload.replacedId) entry.replaces = clampDisplay(payload.replacedId, 120);
    return entry;
  }

  if (table === 'scribe_canon') {
    const img = after || before || {};
    const payload = (img.payload && typeof img.payload === 'object') ? img.payload : {};
    const kind = img.kind === 'anti_canon' ? 'anti_canon' : 'canon';
    const status = after && after.approval_status;
    const prev = before && before.approval_status;
    let verb = '';
    if (action === 'INSERT') verb = status === 'approved' ? 'auto-applied' : 'proposed';
    else if (action === 'UPDATE' && status !== prev) verb = { approved: 'approved', rejected: 'rejected', pending: 'put back for review' }[status] || '';
    if (!verb) return null;
    return { ...base, actor: actorOf(audit, after, before, ctx), verb, kind, category: 'example', text: canonRowText({ ...payload, kind }) };
  }

  if (table === 'scribe_memory') {
    const img = action === 'DELETE' ? before : (after || before);
    if (!img) return null;
    const kind = img.kind;
    const verb = { INSERT: 'added', UPDATE: 'updated', DELETE: 'removed' }[action];
    if (!verb) return null;
    if (kind === 'hardline' || kind === 'roastTolerance') {
      // WHO AND WHEN, NEVER WHAT: a boundary can name a real-life topic, and a roast limit is the player's own.
      return { ...base, actor: actorOf(audit, after, before, ctx), verb: kind === 'hardline' ? 'changed a boundary' : 'changed a roast limit', kind, category: '', text: '' };
    }
    if (kind === 'fact' || kind === 'lore') {
      if (action === 'UPDATE' && before && after && before.value === after.value && before.key === after.key) return null;   // a refresh stamp, not a change
      // A fact the system keeps current ('computed') or promoted from an approved candidate ('trainer-proposed') is not a hand edit: the refresh is noise and the
      // promotion is already listed as the candidate's APPROVAL. Only a removal of one is shown (that is somebody's act).
      if (action !== 'DELETE' && (img.provenance === 'computed' || img.provenance === 'trainer-proposed')) return null;
      const names = ctx.names || {};
      const out = { ...base, actor: actorOf(audit, after, before, ctx), verb, kind, category: kind === 'lore' ? 'lore' : 'fact', text: clampDisplay(`${img.key || ''}: ${img.value || ''}`) };
      if (kind === 'fact') out.subject = clampDisplay(typeof img.subject_member_id === 'string' ? (names[img.subject_member_id] || '') : '', 60);
      return out;
    }
    return null;
  }
  return null;
}

/**
 * N1 (reviewer, 2026-10-08) — A CORRECTION OR A REPLACE IS ONE ENTRY. One statement writes two rows: the correction inserts the new rule AND turns the old one off; an approved Replace turns
 * the proposal on AND the rule it replaces off. The audit trail has both writes, so History used to show a "turned off" line the commissioner never did. This folds them: the new rule's
 * entry becomes "corrected" / "replaced" and the old rule's "turned off" entry (same row id, same moment, within two seconds — the same transaction) is dropped.
 * @param {Array<object>} entries already mapped by mapHistoryRow, newest first
 */
export function foldHistory(entries) {
  const list = (entries || []).filter(Boolean);
  const drop = new Set();
  const out = list.map((e) => {
    const link = e.corrects || e.replaces;
    if (!link) return e;
    const t = Date.parse(e.at || '');
    list.forEach((o, i) => {
      if (o === e || o.rowId !== link || o.verb !== 'turned off') return;
      const to = Date.parse(o.at || '');
      if (Number.isFinite(t) && Number.isFinite(to) && Math.abs(t - to) <= 2000) drop.add(i);
    });
    const { corrects, replaces, ...rest } = e;
    return { ...rest, verb: corrects ? 'corrected' : 'replaced' };
  });
  return out.filter((_, i) => !drop.has(i));
}

/**
 * THE VIEW, as a pure function (B1/B3/N3/N6): everything the `view` action returns that is computed from rows. The Edge Function calls it with the rows it read; scribeprofiletest.mjs's fake
 * server calls the SAME function, so the pane is tested against the shape the function really produces, not a hand-copied one.
 * @param {{learningRows:Array, canonRows:Array, memory:Array, members:Array, names:Record<string,string>, pilot:boolean, callerMemberId?:string, actors?:Record<string,string>, nowMs?:number}} input
 */
export function buildProfileView({ learningRows = [], canonRows = [], memory = [], members = [], names = {}, pilot = false, callerMemberId = '', actors = {}, nowMs = Date.now() } = {}) {
  const rowsById = Object.fromEntries(learningRows.map((r) => [String(r.id), r]));
  // "live" means SCRIBE READS IT: the same selection the prompt loader makes (newest first, the first 50, the live ones, at most 15)
  const readIds = selectReadByScribe(learningRows, { nowMs });
  const shaped = learningRows.map((r) => shapeLearningRow(r, { names, rowsById, nowMs, readIds, callerMemberId }));
  const byFreshness = (a, b) => (Date.parse(b.approvedAt || b.createdAt) || 0) - (Date.parse(a.approvedAt || a.createdAt) || 0);
  const active = shaped.filter((r) => r.kind === 'learning' && r.status === 'approved').sort(byFreshness);
  // "Turned off": rules switched off, to turn back on. A rule another row names (`supersedes` / `replaces` / `replacedId`) was RETIRED by a newer rule, not switched off.
  const retiredByAnother = new Set();
  for (const r of learningRows) {
    const p = (r && r.payload) || {};
    for (const k of ['supersedes', 'replaces', 'replacedId']) if (typeof p[k] === 'string' && p[k]) retiredByAnother.add(p[k]);
  }
  const turnedOff = shaped.filter((r) => r.kind === 'learning' && r.status === 'superseded' && !retiredByAnother.has(r.id)).sort(byFreshness).slice(0, 30);
  const pendingLearnings = shaped.filter((r) => r.status === 'pending' && ['learning', 'experiment', 'fact_candidate'].includes(r.kind));
  const canon = canonRows.map((r) => shapeCanonRow(r));
  const pendingCanon = canon.filter((r) => r.status === 'pending');
  const examples = canon.filter((r) => r.kind === 'canon' && r.status === 'approved').sort(byFreshness);
  const pending = [...pendingLearnings, ...pendingCanon].sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
  const players = summarizePlayers(members.filter((m) => m.active !== false), memory);
  const lore = pilot ? shapeLore(memory, { names, actors, callerMemberId }) : [];
  return {
    // ONE definition of "active": the rules SCRIBE reads plus the examples it imitates. Lore is league history, not a rule, and is counted by neither this nor the entry card.
    counts: { active: readIds.size + examples.filter((r) => r.live).length, pending: pending.length, players: players.length },
    // how full the 15 rules are: every approved rule that is live (the database's own count), and the cap
    capacity: { rules: active.filter((r) => isLearningLive((rowsById[r.id] && rowsById[r.id].payload) || {}, 'approved', nowMs)).length, cap: RULE_CAP },
    active, turnedOff, pending, examples, lore, players,
  };
}
