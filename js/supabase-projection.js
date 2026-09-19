/**
 * CFB Pickems — supabase-projection.js (Phase III, Step 2, DI-183a)
 * ===================================================================
 * PURE MODULE. Imports ONLY `./data-model.js` — never `storage.js`, never
 * `backend.js`, never the DOM. Must import cleanly in the browser, in Node,
 * and in Deno (assessment §8; Step 4/Step 6 both need it).
 *
 * This is the single definition of "what a pick (or a week, a game, a
 * comment, …) looks like as a Postgres row," in both directions:
 *
 *   toRows[cfbpKey](legacyValue, ctx)   -> { [table]: row[] , ... }
 *   fromRows[cfbpKey](rowsByTable, ctx) -> legacyValue   (exact inverse)
 *
 * `ctx = { leagueId, memberIds }` — `memberIds` (a Set<string> of this
 * league's `league_members.id`) is used ONLY to derive `author_member_id` /
 * `comments.author_member_id` from a legacy `author`/`authorId` string that
 * may or may not name a real member (DI-183a).
 *
 * FIELD-MAPPING RULE (applied uniformly by `rowFromLegacy`/`legacyFromRow`
 * below): camelCase legacy field -> snake_case column, per the table
 * comments in `supabase/migrations/0001_schema.sql` §1.1 of
 * DESIGN_INPUTS_PHASE_III_TECH_091226.md. Any legacy field with NO column
 * lands in `extra[field]`; on the way back `extra` is spread first and typed
 * columns overwrite, so the legacy object is reproduced key-for-key. A
 * legacy field that is ENTIRELY ABSENT (not null — literally missing, the
 * `data-model.js:641-643`/`:664-667`-class case CONVENTIONS #10 exists for)
 * is recorded in `extra.__absent: [field, …]` so `fromRows` can re-omit it —
 * that is what makes the hash exact on old Sheet rows that predate a field.
 *
 * Every column list below was read from `cfb-pickems/js/storage.js`,
 * `js/data-model.js`, `js/scoring.js`, `js/notifications.js`, `js/app.js`,
 * `js/chat.js` and `backend/Code.gs` against the working tree on 2026-09-13
 * (APP_VERSION v0.21.2) — one version ahead of the DI's citation baseline
 * (v0.21.0); line numbers drifted from the DI's citations by the XSS-HARDEN
 * commits in between, but every FIELD SHAPE checked byte-for-byte identical.
 * See the execute-stage handoff for the two real deviations found (feedback
 * legacy shape has no `member_id`/`status`/`excluded_from_export` at all —
 * expected, Step-1-only columns — and the DI's stated key count of 24 is
 * actually 23; both are cited with current file:line below, not "fixed"
 * silently).
 */

import {
  createPlayer, createWeek, createGame, createPick,
} from './data-model.js';

// ─── timestamp + canonicalization primitives ──────────────────────────────

/**
 * null/undefined -> null. Otherwise `new Date(v).toISOString()`. A no-op on
 * a value that is already the output of `toISOString()` (CONVENTIONS #19 —
 * every timestamp the app writes IS that string), which is exactly the
 * byte-identical round-trip B2/projectiontest.mjs requires. An unparseable
 * value becomes null rather than the string "Invalid Date" (fail closed —
 * a bad timestamp must not sail into a `timestamptz` column as garbage).
 */
export function toIso(v) {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * WHICH STRINGS `canonValue` TREATS AS A TIMESTAMP INSTANT (RG — Drew's first
 * real import, 2026-09-18).
 *
 * THE DEFECT. `verifyImport` reported `cfbp_games store=38 db=38
 * hash=MISMATCH` while every other key matched. All 38 differences were ONE
 * field: `kickoff`. The Sheet holds ESPN's kickoff strings WITHOUT SECONDS —
 * `"2026-08-29T21:30Z"` — and the `ts`-typed `kickoff` column runs them
 * through `toIso`, so the database side comes back `"2026-08-29T21:30:00.000Z"`.
 * The old pattern above REQUIRED seconds, so the STORE side was left
 * unnormalized while the DB side was normalized, and two spellings of the SAME
 * INSTANT hashed differently. Nothing was lost or mis-imported — the rows are
 * correct in Supabase; the comparator was simply not comparing instants.
 *
 * So the fix is comparator-only, and deliberately so: `toRows` is unchanged,
 * the importer writes exactly the rows it always did, and the widening is
 * applied by ONE function to BOTH sides of the hash.
 *
 * WHAT IS ADMITTED, and why each piece:
 *   `T\d{2}:\d{2}`         no seconds — the ESPN/Sheet shape that started this
 *   `(:\d{2})?`            seconds — everything the app itself writes
 *   `(\.\d{1,6})?`         1-6 fractional digits. Postgres `timestamptz`
 *                          returns MICROseconds (`…:00.123456+00:00`), so the
 *                          old 3-digit cap would have produced this same
 *                          class of false diff the first time a value came
 *                          back from PostgREST with six.
 *   `Z | ±hh:mm | ±hhmm`   unchanged; all three parse identically in V8.
 *
 * WHAT IS DELIBERATELY NOT ADMITTED, and these are the load-bearing ones:
 *
 *   A ZONE IS MANDATORY. `new Date('2026-08-29T21:30')` is LOCAL time: it
 *   yields 21:30Z under `TZ=UTC` and 04:30Z (next day) under
 *   `TZ=America/Los_Angeles`. Admitting a zone-less string would make the
 *   canonical form — and therefore the import verdict — depend on the
 *   operator's timezone. That is RG-38's failure mode, and the reason this
 *   suite is run under both zones.
 *
 *   A DATE-ONLY STRING IS NOT A TIMESTAMP. The `T` is required, so
 *   `'2026-08-29'` stays the string `'2026-08-29'`. `weeks.start_date` /
 *   `end_date` are the commissioner's calendar dates and are deliberately
 *   NOT `ts` columns (see WEEK_COLS below); `cfbp_game_requests`' payload
 *   carries a date-only `gameDate` (js/storage.js game-request record). Those
 *   must survive as typed, so a date-only value is never rewritten into
 *   midnight-UTC.
 *
 * KNOWN LIMIT, stated rather than discovered later: `toIso` goes through
 * `Date`, which TRUNCATES below the millisecond. `…:00.123456Z` and
 * `…:00.123Z` therefore canonicalize identically. That is exactly the
 * property the fix needs (a Postgres microsecond round trip of a millisecond
 * value compares equal to it), and the cost is that a genuine sub-millisecond
 * difference between two stored timestamps would not be seen. Nothing in this
 * app writes sub-millisecond precision — every timestamp it produces is
 * `toISOString()` output (CONVENTIONS #19).
 */
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})$/;

// Arrays of objects carrying one of these fields are sorted by that field
// (order-insensitive canonicalization) — everything else is left in order.
const CANON_ID_FIELDS = ['pickId', 'gameId', 'obligationId', 'id', 'commentId', 'runId', 'canonId'];

function canonSortKey(arr) {
  if (!arr.length || typeof arr[0] !== 'object' || arr[0] === null || Array.isArray(arr[0])) return null;
  for (const f of CANON_ID_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(arr[0], f)) return f;
  }
  // results-style composite: weekId + playerId
  if ('weekId' in arr[0] && 'playerId' in arr[0]) return '__weekId+playerId__';
  return null;
}

function canonValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Object.is(v, -0) ? 0 : v;
  if (typeof v === 'string') {
    // FAIL SAFE, not fail closed, and only here. `toIso` nulls an unparseable
    // value on purpose (a bad timestamp must not sail into a `timestamptz`
    // column), but `canonValue` is a COMPARATOR: widening ISO_RE widens the
    // set of strings that match it without parsing — `'2026-13-01T00:00Z'` is
    // regex-valid and `new Date()`-invalid. Nulling such a string would erase
    // it from BOTH sides of the hash, so two DIFFERENT bad timestamps would
    // compare EQUAL and the import would be declared clean. Left as the
    // original string, they compare as what they are.
    if (!ISO_RE.test(v)) return v;
    const iso = toIso(v);
    return iso === null ? v : iso;
  }
  if (Array.isArray(v)) {
    const mapped = v.map(canonValue);
    const key = canonSortKey(v);
    if (key === '__weekId+playerId__') {
      mapped.sort((a, b) => {
        const ka = `${a.weekId}__${a.playerId}`, kb = `${b.weekId}__${b.playerId}`;
        return ka < kb ? -1 : ka > kb ? 1 : 0;
      });
    } else if (key) {
      mapped.sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0));
    }
    return mapped;
  }
  if (typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = canonValue(v[k]);
    return out;
  }
  return v;
}

/** Deep, order-insensitive canonical form: sorted object keys, id-sorted
 *  record arrays, ISO-normalized timestamp strings, -0 -> 0, then
 *  JSON.stringify (no float re-formatting — CONVENTIONS #7's "numbers stay
 *  numbers" is a fromRows concern, not a canonicalize concern). */
export function canonicalize(value) {
  return JSON.stringify(canonValue(value));
}

// ─── `actor`: a STRUCTURED value in a TEXT column ─────────────────────────
//
// THE DEFECT (RG — Drew's first real import, 2026-09-18, second finding).
// `verifyNotifyLog` reported `notify_log count=7 hash=MISMATCH`. The offline
// round trip `notifyLogToRow` -> `rowToNotifyLog` was EXACT, which is what
// made it confusing; a read-only diff against the database showed all 7
// differences were one field: `actor` — store `{ kind, playerId }`, database a
// 36-character STRING.
//
// ROOT CAUSE. The app's actor is an object: `{ kind: 'scribe'|'commissioner'|
// 'system'|'player', playerId: string|null }` (js/notifications.js:571 doc +
// the `_fireOne` record; the server writes `JSON.stringify(r.actor || null)`
// into CFBP_NOTIFY_LOG and parses it back, backend/Code.gs:1212 /
// rowToNotifyLogRecord_). `public.notifications.actor` is `text`
// (0001_schema.sql, notifications table). The projection passed the object
// through unchanged, so PostgREST/Postgres coerced it to its JSON text on the
// way in and the column handed a STRING back out. Round-tripping in memory
// could never see it, because nothing in memory performs that coercion —
// `MockImportRowsClient` stores whatever object it is given.
//
// WHY THE FIX IS HERE AND NOT IN THE SCHEMA. The migration is already applied
// to the dev project and the column type is not the problem: `actor` is a
// small closed-shape value the database never queries into, and text is a
// perfectly good home for it. What was missing is that the PROJECTION — the
// single definition of "what this looks like as a row" — has to state the
// representation instead of letting the wire pick one. So the object is
// serialized on the way out and parsed on the way in, symmetrically, and the
// database holds exactly what it held before.
//
// KEY ORDER IS SORTED, deliberately: `JSON.stringify` preserves insertion
// order, so `{playerId, kind}` and `{kind, playerId}` — the same actor, built
// by two call sites — would otherwise produce two different column texts and a
// re-import would rewrite the row. Sorting makes the written bytes a function
// of the VALUE alone, which is what keeps a re-run a genuine no-op (the same
// property DI-T7.7's unconditional lower-casing exists for).
//
// NOT AFFECTED, and checked rather than assumed (projectiontest [13b]):
// `comments.author_id` and `messages.author` are member-id STRINGS by design
// and stay strings; `destination` and `meta` are `jsonb` columns and keep
// carrying objects verbatim.

/** Recursive key-sorted JSON text. `undefined` becomes `null` rather than
 *  vanishing, because `JSON.stringify` DROPS a key whose value is undefined —
 *  which would silently change the shape (`{kind, playerId: undefined}` would
 *  come back with no `playerId` at all) and reintroduce a hash diff. */
function sortedJsonText(v) {
  const walk = (x) => {
    if (x === undefined || x === null) return null;
    if (Array.isArray(x)) return x.map(walk);
    if (typeof x !== 'object') return x;
    const out = {};
    for (const k of Object.keys(x).sort()) out[k] = walk(x[k]);
    return out;
  };
  return JSON.stringify(walk(v));
}

/** Legacy `actor` -> the `text` column. null/undefined -> null; an object or
 *  array -> deterministic JSON text; anything else (a plain-string actor from
 *  some other path) -> unchanged. */
export function actorToColumn(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return sortedJsonText(v);
  return v;
}

/** The `text` column -> legacy `actor`. Text that parses to a JSON OBJECT or
 *  ARRAY becomes that value; anything else is returned UNCHANGED, so a plain
 *  string actor written by some other path stays a plain string rather than
 *  being reinterpreted (`'123'` must not become the number 123). */
export function actorFromColumn(v) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if (!(t.startsWith('{') || t.startsWith('['))) return v;
  try {
    const parsed = JSON.parse(t);
    return parsed !== null && typeof parsed === 'object' ? parsed : v;
  } catch { return v; }
}

// ─── credential stripping (S1 — never let a secret enter Supabase) ────────

export const CREDENTIAL_FIELDS = {
  cfbp_settings: ['adminPasswordHash', 'sitePin', 'storageMode'],
  cfbp_players: ['pinHash'],
};

/** Returns a COPY with `CREDENTIAL_FIELDS[key]` removed. Handles both a
 *  single object (`cfbp_settings`) and an array of objects (`cfbp_players`).
 *  Both sides of the importer's verifier call this (DI-183e item 2) so a
 *  credential's absence from Supabase never registers as a hash mismatch. */
export function stripCredentials(key, value) {
  const fields = CREDENTIAL_FIELDS[key];
  if (!fields || !fields.length) return value;
  const stripOne = (v) => {
    if (!v || typeof v !== 'object') return v;
    const copy = { ...v };
    for (const f of fields) delete copy[f];
    return copy;
  };
  return Array.isArray(value) ? value.map(stripOne) : stripOne(value);
}

// ─── case-insensitive fields (DI-T7.7) ────────────────────────────────────

/** Fields whose CASE is not data. `email` is the only one, and it earns the
 *  status honestly: the database lower-cases it in four places
 *  (league_members_guard, create_league, join_league, handle_new_user) and
 *  every lookup keys on `lower(email)`, so two spellings of one address are
 *  the same address everywhere it matters. */
export const CASE_INSENSITIVE_FIELDS = {
  cfbp_players: ['email'],
};

/**
 * THE ONE NORMALIZER BOTH SIDES OF THE IMPORT VERIFIER SHARE (DI-T7.7).
 *
 * Exactly the `stripCredentials` precedent above, one field wider, and for
 * the same reason: the Sheet and Supabase legitimately differ on something
 * that is not data, and the hash comparison must not call that a diff.
 *   credentials — present in the Sheet, never written to Supabase;
 *   email case  — as typed in the Sheet, lower-cased on the way to a row.
 *
 * WHY THIS AND NOT A CASE-INSENSITIVE COMPARISON. `verifyImport` hashes each
 * side once and compares two hex strings; there is no field-by-field
 * comparison to make lenient, and adding one would mean re-implementing the
 * comparison the hash exists to avoid. Normalizing both inputs keeps the
 * check a single byte-for-byte equality, which is the property that makes it
 * worth running at all.
 *
 * WHY IT IS NOT OPTIONAL. Dropping `extra.__email_case` (DI-T7.7) means a
 * founder whose Sheet address is `Drew@Example.com` projects to
 * `drew@example.com` and comes back as `drew@example.com`. Without this
 * normalization the FIRST re-import of that league reports a false diff on
 * `cfbp_players` and the importer exits 1 — refusing a perfectly good import
 * over a capital letter. The marker and this function are the two halves of
 * one decision; removing the marker without adding this is a defect.
 *
 * A field that is ABSENT stays absent (DI-T7.6) — the guard is on the value's
 * type, never on a truthiness test that would invent an empty string.
 */
export function normalizeForCompare(key, value) {
  const stripped = stripCredentials(key, value);
  const fields = CASE_INSENSITIVE_FIELDS[key];
  if (!fields || !fields.length) return stripped;
  const lowerOne = (v) => {
    if (!v || typeof v !== 'object') return v;
    const copy = { ...v };
    for (const f of fields) {
      if (typeof copy[f] === 'string') copy[f] = copy[f].toLowerCase();
    }
    return copy;
  };
  return Array.isArray(stripped) ? stripped.map(lowerOne) : lowerOne(stripped);
}

// ─── generic row <-> legacy-object machinery ──────────────────────────────
//
// A "column descriptor" is { legacy, column, type? }. `type` is one of:
//   'ts'   — timestamptz column; toIso() both ways
//   'num'  — numeric/integer column; PostgREST returns `numeric` as a
//            string, so fromRows always coerces with Number() (CONVENTIONS #7)
//   'bool' — boolean column; coerced with !!
//   'actor'— a TEXT column holding a structured value; actorToColumn() /
//            actorFromColumn() (see above). ONLY `notifications.actor` — an
//            object handed to a text column is coerced by Postgres on the way
//            in and comes back a string, which no in-memory round trip can see
//   (unset)— string / jsonb passthrough, no coercion

function present(obj, field) {
  return obj != null && Object.prototype.hasOwnProperty.call(obj, field);
}

function convertOut(v, type) {
  if (v === undefined || v === null) return null;
  if (type === 'ts') return toIso(v);
  if (type === 'num') return Number(v);
  if (type === 'bool') return !!v;
  if (type === 'actor') return actorToColumn(v);
  return v;
}

function convertIn(v, type) {
  if (v === undefined || v === null) return null;
  if (type === 'ts') return toIso(v);
  if (type === 'num') return Number(v);
  if (type === 'bool') return !!v;
  if (type === 'actor') return actorFromColumn(v);
  return v;
}

/**
 * legacy object -> a plain row object with an `extra` field.
 * `defaults` supplies the value to use for a field that is ENTIRELY ABSENT
 * from `obj` (not null — absent). Per CONVENTIONS #10 / the DI, that default
 * comes from the same factory (`createWeek`/`createGame`/…) the rest of the
 * app already trusts for "what does a field default to when missing," NOT a
 * value re-invented here. Absence is recorded in `extra.__absent` so
 * `legacyFromRow` can re-omit the field rather than resurrect it as an
 * explicit value the original record never had.
 */
function rowFromLegacy(obj, cols, defaults = {}) {
  const row = {};
  const absent = [];
  const known = new Set(cols.map((c) => c.legacy));
  for (const c of cols) {
    if (present(obj, c.legacy)) {
      row[c.column] = convertOut(obj[c.legacy], c.type);
    } else {
      absent.push(c.legacy);
      const d = Object.prototype.hasOwnProperty.call(defaults, c.legacy) ? defaults[c.legacy] : null;
      row[c.column] = convertOut(d, c.type);
    }
  }
  const extra = {};
  for (const k of Object.keys(obj || {})) {
    if (!known.has(k)) extra[k] = obj[k];
  }
  if (absent.length) extra.__absent = absent;
  row.extra = extra;
  return row;
}

/** The exact inverse of `rowFromLegacy`: typed columns first, then `extra`
 *  spread over them (so an unmodeled legacy field survives), then every
 *  field named in `extra.__absent` is deleted so the round-trip is exact. */
function legacyFromRow(row, cols) {
  const obj = {};
  for (const c of cols) {
    obj[c.legacy] = convertIn(row[c.column], c.type);
  }
  const extra = row && row.extra && typeof row.extra === 'object' ? row.extra : {};
  const absentSet = new Set(Array.isArray(extra.__absent) ? extra.__absent : []);
  for (const [k, v] of Object.entries(extra)) {
    if (k === '__absent') continue;
    obj[k] = v;
  }
  for (const k of absentSet) delete obj[k];
  return obj;
}

/** A key whose value is an ARRAY of legacy objects, each becoming one row in
 *  ONE table (players/weeks/games/picks/results/obligations/feedback/
 *  comments/notifications — DI's "rows" kind). */
function rowsKind(table, cols, { defaults = {}, credentialKey = null, decorateRow = null, restoreRow = null } = {}) {
  return {
    toRows(list, ctx) {
      const arr = Array.isArray(list) ? list : [];
      const stripped = credentialKey ? stripCredentials(credentialKey, arr) : arr;
      const rows = stripped.map((item) => {
        const row = rowFromLegacy(item, cols, defaults);
        row.league_id = ctx && ctx.leagueId ? ctx.leagueId : null;
        return decorateRow ? decorateRow(row, item, ctx) : row;
      });
      return { [table]: rows };
    },
    fromRows(rowsByTable, ctx) {
      const rows = (rowsByTable && rowsByTable[table]) || [];
      return rows.map((r) => {
        const obj = legacyFromRow(r, cols);
        // `ctx` reaches restoreRow (DI-T7.6): the player restore needs
        // `ctx.contacts` to merge get_member_contacts()' rows back in. Every
        // other restoreRow ignores it. A ctx WITHOUT `contacts` — which is
        // what verifyImport passes; it supplies leagueId and memberIds and has
        // no RPC to call — behaves exactly as before: the contact fields come
        // from the row's own columns, which is all the service role ever needs.
        // (A caller passing no ctx at all works too; `contactEntryFor` treats
        // both the same.)
        return restoreRow ? restoreRow(obj, r, ctx) : obj;
      });
    },
  };
}

/** A key that maps 1:1 to a single `league_kv` row (settings/nicknames/
 *  lock_overrides/rejected_suggestions/active_week/fetch_proof/
 *  feedback_excluded_ids — DI's "kv" kind). The value is stored verbatim in
 *  the jsonb `value` column (after credential stripping for `settings`). */
function kvKind(kvKey, { credentialKey = null, fallback = null } = {}) {
  return {
    toRows(value, ctx) {
      const v = credentialKey ? stripCredentials(credentialKey, value) : value;
      return {
        league_kv: [{
          league_id: ctx && ctx.leagueId ? ctx.leagueId : null,
          key: kvKey,
          value: v === undefined ? null : v,
        }],
      };
    },
    fromRows(rowsByTable) {
      const rows = (rowsByTable && rowsByTable.league_kv) || [];
      const row = rows.find((r) => r.key === kvKey);
      return row ? row.value : fallback;
    },
  };
}

/** A key whose value is a flat `{ "weekId__playerId": number }` map — one
 *  row per entry (tiebreaker/extra-point guesses — DI's "map-rows" kind).
 *  `updated_at` is Supabase-only bookkeeping (the legacy map carries no
 *  per-entry timestamp at all), so it is written but never read back. */
function mapRowsKind(table, idPrefix) {
  return {
    toRows(map, ctx) {
      const obj = map && typeof map === 'object' ? map : {};
      const rows = Object.keys(obj).map((key) => {
        const sep = key.indexOf('__');
        const weekId = sep >= 0 ? key.slice(0, sep) : key;
        const memberId = sep >= 0 ? key.slice(sep + 2) : '';
        return {
          league_id: ctx && ctx.leagueId ? ctx.leagueId : null,
          id: `${idPrefix}_${key}`,
          week_id: weekId,
          member_id: memberId,
          guess: Number(obj[key]),
          updated_at: toIso(new Date()),
        };
      });
      return { [table]: rows };
    },
    fromRows(rowsByTable) {
      const rows = (rowsByTable && rowsByTable[table]) || [];
      const out = {};
      for (const r of rows) out[`${r.week_id}__${r.member_id}`] = Number(r.guess);
      return out;
    },
  };
}

// ─── emoji codepoint hex, for the reactions row id ────────────────────────
function emojiHex(emoji) {
  return Array.from(String(emoji))
    .map((ch) => ch.codePointAt(0).toString(16))
    .join('-');
}

// ─── factory-derived defaults (CONVENTIONS #10 — reuse the app's own
//     default-when-missing pattern, don't re-invent one here) ─────────────
const _DEFAULT_PLAYER = createPlayer('');
const _DEFAULT_WEEK = createWeek('', 0);
const _DEFAULT_GAME = createGame('');
const _DEFAULT_PICK = createPick('', '', '', '');
// createObligation() lives in js/storage.js (~line 1597), not data-model.js —
// this module imports ONLY data-model.js (DI-183a), so its default shape is
// reproduced by hand here instead. Verified field-for-field against
// storage.js:1597-1613 on 2026-09-13.
const _DEFAULT_OBLIGATION = {
  type: 'weekly', amountOrPrize: '', status: 'unpaid', paidAt: null,
  needsReview: false, reviewNote: null,
  voided: false, voidedAt: null, voidReason: null,
  mergedInto: null, mergedFrom: [],
};

// ─── column descriptor tables (§1.1 of the DI, verified against the code
//     cited in each block's comment) ───────────────────────────────────────

// league_members — js/data-model.js createPlayer(); preferences: storage.js
// getPlayerPref()/setPlayerPref() family (~line 391 onward), CHAT_ACCENTS,
// notifyPushMaster/notifyCategories/sectionOrder (~line 490-580).
// `role`, `user_id`, `claim_code`, `claim_code_expires_at`, `linked_at`,
// `legacy_player_id` are DELIBERATELY NOT in this list — DI-183a: "not
// projection fields (importer sets role from --commissioner; never touches
// user_id/claim_code/linked_at on re-run)". `pinHash` is stripped as a
// credential (CREDENTIAL_FIELDS.cfbp_players) before this list ever runs.
const PLAYER_COLS = [
  { legacy: 'playerId', column: 'id' },
  { legacy: 'displayName', column: 'display_name' },
  { legacy: 'initials', column: 'initials' },
  { legacy: 'email', column: 'email' },
  { legacy: 'almaMater', column: 'alma_mater' },
  { legacy: 'active', column: 'active', type: 'bool' },
  { legacy: 'phone', column: 'phone' },
  { legacy: 'phoneVerified', column: 'phone_verified', type: 'bool' },
  { legacy: 'notifyPrefs', column: 'notify_prefs' },
  { legacy: 'preferences', column: 'preferences' },
  { legacy: 'createdAt', column: 'created_at', type: 'ts' },
  { legacy: 'updatedAt', column: 'updated_at', type: 'ts' },
];

// weeks — js/data-model.js createWeek() (~line 656). `sport` has NO legacy
// counterpart at all (grep of `.sport`/`sport:` on a week object: zero hits)
// — it is a Supabase-only column (assessment §11 #2) and will therefore
// ALWAYS be recorded absent + defaulted to 'cfb', which is exactly correct:
// a week object never carries `.sport` today, so it must never come back
// with one either.
const WEEK_COLS = [
  { legacy: 'weekId', column: 'id' },
  { legacy: 'sport', column: 'sport' },
  { legacy: 'season', column: 'season' },
  { legacy: 'weekNumber', column: 'week_number', type: 'num' },
  { legacy: 'label', column: 'label' },
  { legacy: 'roundLabel', column: 'round_label' },
  { legacy: 'espnWeekNumber', column: 'espn_week_number' },
  { legacy: 'groupId', column: 'group_id' },
  { legacy: 'isGroupTiebreaker', column: 'is_group_tiebreaker', type: 'bool' },
  { legacy: 'startDate', column: 'start_date' },   // commissioner calendar TEXT, never toIso (DI §"Conventions")
  { legacy: 'endDate', column: 'end_date' },
  { legacy: 'status', column: 'status' },
  { legacy: 'dataSourceMode', column: 'data_source_mode' },
  { legacy: 'picksOpenAt', column: 'picks_open_at', type: 'ts' },
  { legacy: 'picksLockAt', column: 'picks_lock_at', type: 'ts' },
  { legacy: 'autoLockOffsetMinutes', column: 'auto_lock_offset_minutes', type: 'num' },
  { legacy: 'autoLiveEnabled', column: 'auto_live_enabled', type: 'bool' },
  { legacy: 'autoFinalizeEnabled', column: 'auto_finalize_enabled', type: 'bool' },
  { legacy: 'pendingFinalization', column: 'pending_finalization', type: 'bool' },
  { legacy: 'showInHistory', column: 'show_in_history', type: 'bool' },
  { legacy: 'blurb', column: 'blurb' },
  { legacy: 'recap', column: 'recap' },
  { legacy: 'emailSentAt', column: 'email_sent_at', type: 'ts' },
  { legacy: 'tiebreakerQuestion', column: 'tiebreaker_question' },
  { legacy: 'tiebreakerType', column: 'tiebreaker_type' },
  { legacy: 'tiebreakerCalculationMode', column: 'tiebreaker_calculation_mode' },
  { legacy: 'actualTiebreakerValue', column: 'actual_tiebreaker_value', type: 'num' },
  { legacy: 'tiebreakerFinalized', column: 'tiebreaker_finalized', type: 'bool' },
  { legacy: 'extraPointEnabled', column: 'extra_point_enabled', type: 'bool' },
  { legacy: 'extraPointActual', column: 'extra_point_actual', type: 'num' },
  { legacy: 'extraPointDetect', column: 'extra_point_detect' },
  { legacy: 'lockedAt', column: 'locked_at', type: 'ts' },
  { legacy: 'finalizedAt', column: 'finalized_at', type: 'ts' },
  { legacy: 'lockedAlmaMaters', column: 'locked_alma_maters' },
  { legacy: 'createdAt', column: 'created_at', type: 'ts' },
  { legacy: 'updatedAt', column: 'updated_at', type: 'ts' },
];

// games — js/data-model.js createGame() (~line 799).
const GAME_COLS = [
  { legacy: 'gameId', column: 'id' },
  { legacy: 'weekId', column: 'week_id' },
  { legacy: 'espnEventId', column: 'espn_event_id' },
  { legacy: 'dataQuality', column: 'data_quality' },
  { legacy: 'dataSource', column: 'data_source' },
  { legacy: 'homeTeam', column: 'home_team' },
  { legacy: 'awayTeam', column: 'away_team' },
  { legacy: 'homeMascot', column: 'home_mascot' },
  { legacy: 'awayMascot', column: 'away_mascot' },
  { legacy: 'homeConference', column: 'home_conference' },
  { legacy: 'awayConference', column: 'away_conference' },
  { legacy: 'homeRank', column: 'home_rank', type: 'num' },
  { legacy: 'awayRank', column: 'away_rank', type: 'num' },
  { legacy: 'kickoff', column: 'kickoff', type: 'ts' },
  { legacy: 'kickoffConfirmed', column: 'kickoff_confirmed', type: 'bool' },
  { legacy: 'kickoffDateOnly', column: 'kickoff_date_only', type: 'bool' },
  { legacy: 'timeWindow', column: 'time_window' },
  { legacy: 'spread', column: 'spread', type: 'num' },   // SIGNED, home-perspective (AD-03) — untouched
  { legacy: 'favorite', column: 'favorite' },
  { legacy: 'spreadSource', column: 'spread_source' },
  { legacy: 'oddsProvider', column: 'odds_provider' },
  { legacy: 'lockedSpread', column: 'locked_spread', type: 'num' },
  { legacy: 'homeScore', column: 'home_score', type: 'num' },
  { legacy: 'awayScore', column: 'away_score', type: 'num' },
  { legacy: 'status', column: 'status' },
  { legacy: 'actualWinner', column: 'actual_winner' },
  { legacy: 'atsWinner', column: 'ats_winner' },
  { legacy: 'isAlmaMaterGame', column: 'is_alma_mater_game', type: 'bool' },
  { legacy: 'nationalTV', column: 'national_tv', type: 'bool' },
  { legacy: 'broadcastNetwork', column: 'broadcast_network' },
  { legacy: 'marqueeEvent', column: 'marquee_event', type: 'bool' },
  { legacy: 'venue', column: 'venue' },
  { legacy: 'venueDisplay', column: 'venue_display' },
  { legacy: 'neutralSite', column: 'neutral_site', type: 'bool' },
  { legacy: 'multiplier', column: 'multiplier', type: 'num' },
  { legacy: 'isManual', column: 'is_manual', type: 'bool' },
  { legacy: 'leagueLabel', column: 'league_label' },
  { legacy: 'espnSport', column: 'espn_sport' },
  { legacy: 'lastUpdated', column: 'last_updated', type: 'ts' },
  { legacy: 'createdAt', column: 'created_at', type: 'ts' },
  { legacy: 'updatedAt', column: 'updated_at', type: 'ts' },
];

// picks — js/data-model.js createPick() (~line 855).
const PICK_COLS = [
  { legacy: 'pickId', column: 'id' },
  { legacy: 'weekId', column: 'week_id' },
  { legacy: 'gameId', column: 'game_id' },
  { legacy: 'playerId', column: 'member_id' },
  { legacy: 'selectedTeam', column: 'selected_team' },
  { legacy: 'selectedAt', column: 'selected_at', type: 'ts' },
  { legacy: 'updatedAt', column: 'updated_at', type: 'ts' },
  { legacy: 'locked', column: 'locked', type: 'bool' },
  { legacy: 'result', column: 'result' },
];

// results — js/scoring.js calculateWeeklyResults() (~line 183-216).
// AUTHORITATIVE (Drew 2026-09-12): no factory exists for this shape (it is
// built inline), so no `createResult()` default source exists either — every
// field is always present because scoring.js always sets all of them.
const RESULT_COLS = [
  { legacy: 'resultId', column: 'id' },
  { legacy: 'weekId', column: 'week_id' },
  { legacy: 'playerId', column: 'member_id' },
  { legacy: 'displayName', column: 'display_name' },
  { legacy: 'correctPicks', column: 'correct_picks', type: 'num' },
  { legacy: 'incorrectPicks', column: 'incorrect_picks', type: 'num' },
  { legacy: 'correctCount', column: 'correct_count', type: 'num' },
  { legacy: 'incorrectCount', column: 'incorrect_count', type: 'num' },
  { legacy: 'noDecisions', column: 'no_decisions', type: 'num' },
  { legacy: 'pending', column: 'pending', type: 'num' },
  { legacy: 'tiebreakerGuess', column: 'tiebreaker_guess', type: 'num' },
  { legacy: 'tiebreakerDelta', column: 'tiebreaker_delta', type: 'num' },
  { legacy: 'rank', column: 'rank', type: 'num' },
  { legacy: 'isWinner', column: 'is_winner', type: 'bool' },
  { legacy: 'isLoser', column: 'is_loser', type: 'bool' },
  { legacy: 'wonByTiebreaker', column: 'won_by_tiebreaker', type: 'bool' },
];

// obligations — js/storage.js createObligation() (~line 1597).
const OBLIGATION_COLS = [
  { legacy: 'obligationId', column: 'id' },
  { legacy: 'type', column: 'type' },
  { legacy: 'weekId', column: 'week_id' },
  { legacy: 'payerPlayerId', column: 'payer_member_id' },
  { legacy: 'recipientPlayerId', column: 'recipient_member_id' },
  { legacy: 'amountOrPrize', column: 'amount_or_prize' },
  { legacy: 'status', column: 'status' },
  { legacy: 'createdAt', column: 'created_at', type: 'ts' },
  { legacy: 'paidAt', column: 'paid_at', type: 'ts' },
  { legacy: 'needsReview', column: 'needs_review', type: 'bool' },
  { legacy: 'reviewNote', column: 'review_note' },
  { legacy: 'voided', column: 'voided', type: 'bool' },
  { legacy: 'voidedAt', column: 'voided_at', type: 'ts' },
  { legacy: 'voidReason', column: 'void_reason' },
  { legacy: 'mergedInto', column: 'merged_into' },
  { legacy: 'mergedFrom', column: 'merged_from' },
];

// feedback — js/app.js submitFeedback() (~line 11085-11107). The legacy
// object NEVER carries `memberId`/`status`/`excludedFromExport` at all — those
// three are Step-1-only columns (member_id: null on import; status: 'new'
// commissioner-only column, guard-triggered in 0002; excluded_from_export:
// mirrors cfbp_feedback_excluded_ids for NEW rows only, per that column's own
// DDL comment). All three are therefore listed here WITH defaults so the
// generic absent/extra machinery marks them absent on every legacy row and
// `legacyFromRow` always strips them back out — the round-tripped object
// never gains fields the app itself never wrote.
const FEEDBACK_COLS = [
  { legacy: 'id', column: 'id' },
  { legacy: 'memberId', column: 'member_id' },
  { legacy: 'name', column: 'name' },
  { legacy: 'kind', column: 'kind' },
  { legacy: 'weekId', column: 'week_id' },
  { legacy: 'body', column: 'body' },
  { legacy: 'submittedAt', column: 'submitted_at', type: 'ts' },
  { legacy: 'appVersion', column: 'app_version' },
  { legacy: 'siteUrl', column: 'site_url' },
  { legacy: 'status', column: 'status' },
  { legacy: 'excludedFromExport', column: 'excluded_from_export', type: 'bool' },
];
const FEEDBACK_DEFAULTS = {
  memberId: null, kind: 'unspecified', status: 'new', excludedFromExport: false,
};

// comments — js/storage.js addComment()/addBotPostIfNew() (~line 1451-1530).
// `author_member_id` is DERIVED (ctx.memberIds), not a legacy field — it is
// set directly on the row after the generic mapping (decorateRow) and must
// never appear back on the legacy object (restoreRow deletes it).
const COMMENT_COLS = [
  { legacy: 'commentId', column: 'id' },
  { legacy: 'weekId', column: 'week_id' },
  { legacy: 'gameId', column: 'game_id' },
  { legacy: 'authorId', column: 'author_id' },
  { legacy: 'authorKind', column: 'author_kind' },
  { legacy: 'botEventKey', column: 'bot_event_key' },
  { legacy: 'body', column: 'body' },
  { legacy: 'createdAt', column: 'created_at', type: 'ts' },
];

// notifications (client-origin) — js/notifications.js _fireOne() record
// (~line 616-630). `deliveryState` has no column — it survives via the
// generic "unmodeled legacy field -> extra" path with zero special-casing.
const NOTIFICATION_COLS = [
  { legacy: 'id', column: 'id' },
  { legacy: 'playerId', column: 'member_id' },
  { legacy: 'event', column: 'event' },
  // `actor` is `text` and the legacy value is an OBJECT — same defect as the
  // notify-log path below, same fix, and it had to be fixed in both or the
  // client-origin notifications would have carried the bug alone.
  { legacy: 'actor', column: 'actor', type: 'actor' },
  { legacy: 'title', column: 'title' },
  { legacy: 'body', column: 'body' },
  { legacy: 'destination', column: 'destination' },
  { legacy: 'createdAt', column: 'created_at', type: 'ts' },
  { legacy: 'readAt', column: 'read_at', type: 'ts' },
  { legacy: 'dedupKey', column: 'dedup_key' },
  { legacy: 'weekId', column: 'week_id' },
  { legacy: 'meta', column: 'meta' },
];

function memberAuthorKind(author, memberIds) {
  if (author === 'system') return 'system';
  if (author === 'scribe') return 'scribe';
  return 'player'; // includes 'unknown' and any non-member literal — DI-183a
}
function memberIdOrNull(author, memberIds) {
  return memberIds && memberIds.has(author) ? author : null;
}

// ─── the 23 `cfbp_*` keys (DI's per-key table, §4.1) ──────────────────────
// NOTE ON COUNT: the execute-stage task brief cites "24 cfbp_* keys"; the DI's
// own per-key table (DESIGN_INPUTS_PHASE_III_TECH_091226.md lines 985-1007)
// lists 23. Built to the DI's actual table, not the brief's count — flagged
// in the handoff, not silently reconciled either direction.

export const KEY_TABLES = {
  cfbp_settings: { tables: ['league_kv'], kind: 'kv' },
  cfbp_players: { tables: ['league_members'], kind: 'rows' },
  cfbp_weeks: { tables: ['weeks'], kind: 'rows' },
  cfbp_games: { tables: ['games'], kind: 'rows' },
  cfbp_picks: { tables: ['picks'], kind: 'rows' },
  cfbp_results: { tables: ['results'], kind: 'rows' },
  cfbp_obligations: { tables: ['obligations'], kind: 'rows' },
  cfbp_nicknames: { tables: ['league_kv'], kind: 'kv' },
  cfbp_lock_overrides: { tables: ['league_kv'], kind: 'kv' },
  cfbp_tiebreaker_guesses: { tables: ['tiebreaker_guesses'], kind: 'map-rows' },
  cfbp_extra_point_guesses: { tables: ['extra_point_guesses'], kind: 'map-rows' },
  cfbp_rejected_suggestions: { tables: ['league_kv'], kind: 'kv' },
  cfbp_reactions: { tables: ['reactions'], kind: 'nested-rows' },
  cfbp_feedback: { tables: ['feedback'], kind: 'rows' },
  cfbp_feedback_excluded_ids: { tables: ['league_kv'], kind: 'kv' },
  cfbp_comments: { tables: ['comments'], kind: 'rows' },
  cfbp_active_week: { tables: ['league_kv'], kind: 'kv' },
  cfbp_fetch_proof: { tables: ['league_kv'], kind: 'kv' },
  cfbp_notifications: { tables: ['notifications'], kind: 'rows' },
  cfbp_scribe_learnings: { tables: ['scribe_learnings'], kind: 'scalar' },
  cfbp_scribe_canon: { tables: ['scribe_canon'], kind: 'scalar' },
  cfbp_scribe_reports: { tables: ['scribe_reports'], kind: 'scalar' },
  cfbp_game_requests: { tables: ['game_requests'], kind: 'rows' },
  // Not a `cfbp_*` storage key — history-2025.js's exported constant. Kept in
  // this same dictionary (synthetic key) so the importer has one dispatch
  // table instead of two (DI-183g).
  SEASON_2025: { tables: ['season_archives'], kind: 'archive' },
};

export const toRows = {};
export const fromRows = {};

// settings
{
  const kv = kvKind('settings', { credentialKey: 'cfbp_settings', fallback: null });
  toRows.cfbp_settings = kv.toRows;
  fromRows.cfbp_settings = kv.fromRows;
}
// players -> league_members
//
// REV F6 (2026-09-13): `email` is lower-cased HERE, on the way out.
//
// Why the projection and not the database: `league_members_guard` (0002) does
// `NEW.email := lower(NEW.email)` — but it is a BEFORE **UPDATE** trigger, so
// the first import (an INSERT) stores whatever case the Sheet had, while any
// later live edit of that member silently canonicalizes it. A re-import would
// then write the original case back, and the stored value would flip back and
// forth depending on which of the two last touched it. Canonicalizing at the
// source makes "what the importer writes" and "what the app writes" the same
// bytes, so a re-run is a genuine no-op. (The guard now also short-circuits
// entirely under app.import='1' — REV F6's other half — so it is no longer a
// second, competing opinion about case during an import.)
//
// ── DI-T7.7 (approved 2026-09-17) — THE CASE MARKER IS GONE ───────────────
//
// It used to keep the original spelling in `extra.__email_case`, so that the
// round trip was EXACT and verifyImport's sha256 could not raise a false diff
// on a capitalised Sheet address. That was a real solution to a real problem
// and it created a worse one: `extra` is a MEMBER-READABLE column (0002, and
// re-granted by 0007), so for every founder whose Sheet email had a capital
// letter, the marker put a full, readable copy of that address one `select`
// away from all five of his co-members — defeating DI-T7.1, which had just
// revoked the `email` column, by leaving the value next door in a blob.
//
// So: `email` is lower-cased UNCONDITIONALLY and the original spelling is not
// kept anywhere. The round trip is now exact MODULO EMAIL CASE, and the
// importer's verifier is told so ONCE, in a normalizer both sides share —
// `normalizeForCompare()` above, the same shape as `stripCredentials` and for
// the same reason. Those two changes are ONE decision: dropping the marker
// without the shared normalizer makes the first re-import of a mixed-case
// founder report a false diff and refuse.
//
// What changes for a human: an address typed `Drew@Example.com` in the Sheet
// displays as `drew@example.com` in the commissioner's Players tab, the CSV
// export and mailto links after cutover. Nothing else. Lookups were never
// affected either way — `league_members_email_idx` and
// `link_member_by_email()` both key on `lower(email)`.
//
// ── DI-T7.6 (migration 0007) — CONTACT FIELDS ARE ABSENT, NEVER BLANK ─────
//
// After 0007 a plain member cannot SELECT `email`, `phone` or
// `phone_verified` off `league_members` at all; they come back only from
// `get_member_contacts()`, which returns every row to a commissioner or
// platform admin and exactly one row — his own — to everybody else. So the
// rows this projection is handed now come in two shapes, and the difference
// between them is the presence of the PROPERTY, not its value:
//
//   service role / commissioner-with-contacts : { …, email: 'a@b.c', phone: '+1…' }
//   plain member reading a co-member          : { …               }   <- no key at all
//
// THE HAZARD, and it is the dangerous part of this whole change: if the
// second shape projected as `email: ''` (which is what `_DEFAULT_PLAYER`
// would supply, `createPlayer`'s default being the empty string), then the
// next `save(cfbp_players, …)` by ANY member would write those empty strings
// back over five other people's real addresses. A redaction that reads as
// data is worse than no redaction at all: it is silent, it is total, and the
// Sheet backup would agree with it.
//
// So, both directions:
//   fromRows — a contact field is set ONLY from a column the row actually
//              carries, or from a `ctx.contacts` entry (the RPC's rows,
//              merged by member id). Otherwise the key is DELETED, and the
//              legacy object simply has no `email` — the same state an old
//              Sheet record with no `phone` field has always had, which the
//              rest of the app already handles (CONVENTIONS #10).
//   toRows   — a field that is ABSENT on the legacy object does not become a
//              column at all. `rowFromLegacy` would otherwise substitute the
//              factory default ('' / false) and record the absence only in
//              `extra.__absent`, which round-trips perfectly and blanks the
//              database on the way through. The absence is still recorded in
//              `__absent`, so `fromRows` re-omits it and the round trip stays
//              exact; only the blanking is gone.
//
// The importer is UNAFFECTED, and that is checked rather than assumed
// (projectiontest [1d]): it runs as the service role and its input is the
// Sheet's own player records, which always carry all three fields — so every
// column is present, every value is written, and the six founders' emails and
// phones import exactly as before.
const CONTACT_COLS = PLAYER_COLS.filter((c) => ['email', 'phone', 'phoneVerified'].includes(c.legacy));

/** The `get_member_contacts()` row for this member, or null. Accepts the RPC
 *  shape ({ member_id, email, phone, phone_verified }) as PostgREST returns
 *  it — no reshaping in the caller, because a reshaping step is somewhere for
 *  a field to go missing. */
function contactEntryFor(ctx, memberId) {
  const list = ctx && Array.isArray(ctx.contacts) ? ctx.contacts : null;
  if (!list || memberId === undefined || memberId === null) return null;
  return list.find((c) => c && c.member_id === memberId) || null;
}

{
  const r = rowsKind('league_members', PLAYER_COLS, {
    defaults: _DEFAULT_PLAYER,
    credentialKey: 'cfbp_players',
    decorateRow(row, item) {
      // DI-T7.7: lower-cased unconditionally, and NOTHING is written into
      // `extra` to remember the original spelling. `extra` is member-readable;
      // a copy of the address there would undo DI-T7.1's revoke.
      if (typeof row.email === 'string') row.email = row.email.toLowerCase();
      // DI-T7.6: never emit a column for a contact field the source object did
      // not have. `rowFromLegacy` has already recorded it in `extra.__absent`,
      // which is what makes the round trip exact without the value.
      for (const c of CONTACT_COLS) {
        if (!present(item, c.legacy)) delete row[c.column];
      }
      return row;
    },
    restoreRow(obj, row, ctx) {
      // DI-T7.6. (There is no case-marker restore here any more — DI-T7.7
      // deleted the marker, so the only thing that could put an address on
      // this object is a column or a contacts entry, both of which are gated.)
      const entry = contactEntryFor(ctx, row && row.id);
      const absent = new Set(
        row && row.extra && Array.isArray(row.extra.__absent) ? row.extra.__absent : [],
      );
      // PRECEDENCE, and it is the answer to a reproduced defect (reviewer
      // F-10(b), corrected by reviewer F-11, on the 0007 build). Three sources
      // disagree about a contact field; the order below is deliberate:
      //
      //   1. An INFORMATIVE value from the contacts list wins. Informative is
      //      a stronger test than non-null — see below; it is the whole of
      //      F-11.
      //   2. Otherwise `__absent` wins. A legacy record that never had a
      //      `phone` must not acquire one because the RPC reported that column
      //      as its default — that would resurrect a field the Sheet never had
      //      and put a false diff in verifyImport's sha256, which is the exact
      //      class of bug `__absent` was invented for.
      //   3. Otherwise the list's value, if it sent one (an uninformative value
      //      on a record that is NOT marked absent is the record's real value:
      //      createPlayer() gives every new player `phone: ''`).
      //   4. Otherwise the row's own column decides; an unreadable column
      //      (absent property) means the field is absent.
      //
      // WHY THE LIST BEATS `__absent` AT ALL (F-10(b)). `__absent` can be WRONG
      // about a contact field, and only about a contact field: a caller that
      // reads rows WITHOUT `ctx.contacts` — which is every client read, now
      // that no client can SELECT the columns — projects all three as absent,
      // and a save from that projection writes
      // `__absent: [email, phone, phoneVerified]` into a row whose COLUMNS
      // still hold the real values. With `__absent` outranking the list, every
      // later read — including the commissioner's own, with a good list in
      // hand — would delete the fields again, PERMANENTLY HIDING data that is
      // right there in the table, with nothing the caller could do about it.
      //
      // WHY "NON-NULL" WAS THE WRONG TEST (F-11). `league_members.phone` is
      // `text not null default ''` and `phone_verified` is
      // `boolean not null default false` (0001_schema.sql:78-79), so
      // get_member_contacts() CANNOT return null for either one — it returns
      // `''` and `false`. A non-null test therefore took branch 1 for every
      // row, resurrected `phone: ''` / `phoneVerified: false` on
      // pre-notification Sheet records, and on the first commissioner-side
      // write-back destroyed their `__absent` marker for good. Only `email` is
      // nullable, which is why the first version of this looked right.
      //
      // So the test is CARRIES INFORMATION, per column, against that column's
      // own NOT NULL default:
      //   email          non-null and non-empty
      //   phone          non-null and non-empty ('' is the default: it says
      //                  nothing, and cannot outrank a marker)
      //   phone_verified `true`, OR the same row's phone is informative —
      //                  because `false` ALONGSIDE A REAL NUMBER is information
      //                  ("we have his number and nobody has verified it"),
      //                  while `false` beside an empty phone is just the
      //                  default. It travels with the phone rather than being
      //                  judged alone, which also keeps the pair consistent:
      //                  a projection with `phone` and no `phoneVerified`
      //                  would be a shape the app has never seen.
      //
      // It does NOT stop the wrong `__absent` being WRITTEN. That is a
      // write-side question — should the projection REFUSE to write a
      // commissioner-shaped row with no contacts? — and it belongs to Step 4's
      // design input, where the adapter's read/write path is specified. See the
      // projectiontest assertions named F-10(b)/F-11, which pin every branch.
      const carriesInformation = (column) => {
        if (!entry || !Object.prototype.hasOwnProperty.call(entry, column)) return false;
        const v = entry[column];
        if (v === null || v === undefined || v === '') return false;
        if (column === 'phone_verified') return v === true || carriesInformation('phone');
        return true;
      };
      for (const c of CONTACT_COLS) {
        const sent = entry && Object.prototype.hasOwnProperty.call(entry, c.column);
        const fromList = sent ? convertIn(entry[c.column], c.type) : undefined;
        if (carriesInformation(c.column)) {
          obj[c.legacy] = fromList;
        } else if (absent.has(c.legacy)) {
          delete obj[c.legacy];
        } else if (sent) {
          obj[c.legacy] = fromList;          // uninformative, but the record is not marked absent
        } else if (!present(row, c.column)) {
          delete obj[c.legacy];
        }
      }
      return obj;
    },
  });
  toRows.cfbp_players = r.toRows;
  fromRows.cfbp_players = r.fromRows;
}
// weeks
{
  const defaults = { ..._DEFAULT_WEEK, sport: 'cfb' };
  const r = rowsKind('weeks', WEEK_COLS, { defaults });
  toRows.cfbp_weeks = r.toRows;
  fromRows.cfbp_weeks = r.fromRows;
}
// games
{
  const r = rowsKind('games', GAME_COLS, { defaults: _DEFAULT_GAME });
  toRows.cfbp_games = r.toRows;
  fromRows.cfbp_games = r.fromRows;
}
// picks
{
  const r = rowsKind('picks', PICK_COLS, { defaults: _DEFAULT_PICK });
  toRows.cfbp_picks = r.toRows;
  fromRows.cfbp_picks = r.fromRows;
}
// results
{
  const r = rowsKind('results', RESULT_COLS, { defaults: {} });
  toRows.cfbp_results = r.toRows;
  fromRows.cfbp_results = r.fromRows;
}
// obligations
{
  const r = rowsKind('obligations', OBLIGATION_COLS, { defaults: _DEFAULT_OBLIGATION });
  toRows.cfbp_obligations = r.toRows;
  fromRows.cfbp_obligations = r.fromRows;
}
// nicknames / lock_overrides / rejected_suggestions / active_week /
// fetch_proof / feedback_excluded_ids — all plain league_kv passthroughs.
{
  const nick = kvKind('nicknames', { fallback: {} });
  toRows.cfbp_nicknames = nick.toRows;
  fromRows.cfbp_nicknames = nick.fromRows;
  const lock = kvKind('lock_overrides', { fallback: {} });
  toRows.cfbp_lock_overrides = lock.toRows;
  fromRows.cfbp_lock_overrides = lock.fromRows;
  const rej = kvKind('rejected_suggestions', { fallback: {} });
  toRows.cfbp_rejected_suggestions = rej.toRows;
  fromRows.cfbp_rejected_suggestions = rej.fromRows;
  const aw = kvKind('active_week', { fallback: null });
  toRows.cfbp_active_week = aw.toRows;
  fromRows.cfbp_active_week = aw.fromRows;
  const fp = kvKind('fetch_proof', { fallback: null });
  toRows.cfbp_fetch_proof = fp.toRows;
  fromRows.cfbp_fetch_proof = fp.fromRows;
  const fx = kvKind('feedback_excluded_ids', { fallback: [] });
  toRows.cfbp_feedback_excluded_ids = fx.toRows;
  fromRows.cfbp_feedback_excluded_ids = fx.fromRows;
}
// tiebreaker / extra point guesses
{
  const tb = mapRowsKind('tiebreaker_guesses', 'tb');
  toRows.cfbp_tiebreaker_guesses = tb.toRows;
  fromRows.cfbp_tiebreaker_guesses = tb.fromRows;
  const ep = mapRowsKind('extra_point_guesses', 'ep');
  toRows.cfbp_extra_point_guesses = ep.toRows;
  fromRows.cfbp_extra_point_guesses = ep.fromRows;
}
// reactions — nested { weekId: { gameId: { emoji: [playerId] } } }
{
  toRows.cfbp_reactions = (value, ctx) => {
    const rows = [];
    const byWeek = value && typeof value === 'object' ? value : {};
    for (const weekId of Object.keys(byWeek)) {
      const byGame = byWeek[weekId] || {};
      for (const gameId of Object.keys(byGame)) {
        const byEmoji = byGame[gameId] || {};
        for (const emoji of Object.keys(byEmoji)) {
          const players = Array.isArray(byEmoji[emoji]) ? byEmoji[emoji] : [];
          for (const memberId of players) {
            rows.push({
              league_id: ctx && ctx.leagueId ? ctx.leagueId : null,
              id: `rx_${weekId}_${gameId}_${memberId}_${emojiHex(emoji)}`,
              week_id: weekId, game_id: gameId, member_id: memberId, emoji,
              created_at: toIso(new Date()),
            });
          }
        }
      }
    }
    return { reactions: rows };
  };
  fromRows.cfbp_reactions = (rowsByTable) => {
    const rows = (rowsByTable && rowsByTable.reactions) || [];
    const out = {};
    for (const r of rows) {
      out[r.week_id] = out[r.week_id] || {};
      out[r.week_id][r.game_id] = out[r.week_id][r.game_id] || {};
      const arr = out[r.week_id][r.game_id][r.emoji] = out[r.week_id][r.game_id][r.emoji] || [];
      if (!arr.includes(r.member_id)) arr.push(r.member_id);
    }
    // DI-183a: "array order inside [playerId] is not preserved" — sort so the
    // output is deterministic regardless of row-fetch order (the projection's
    // own contribution to that guarantee; canonicalize() does not sort plain
    // string arrays, only id-bearing record arrays).
    for (const w of Object.values(out)) {
      for (const g of Object.values(w)) {
        for (const e of Object.keys(g)) g[e].sort();
      }
    }
    return out;
  };
}
// feedback
{
  const r = rowsKind('feedback', FEEDBACK_COLS, { defaults: FEEDBACK_DEFAULTS });
  toRows.cfbp_feedback = r.toRows;
  fromRows.cfbp_feedback = r.fromRows;
}
// comments — author_member_id/author_kind derivation via ctx.memberIds
{
  const r = rowsKind('comments', COMMENT_COLS, {
    defaults: { botEventKey: null },
    decorateRow(row, item, ctx) {
      const memberIds = ctx && ctx.memberIds;
      row.author_member_id = memberIdOrNull(item.authorId, memberIds);
      return row;
    },
    restoreRow(obj) {
      delete obj.authorMemberId; // never a legacy field; guards against a future col-name collision
      return obj;
    },
  });
  toRows.cfbp_comments = r.toRows;
  fromRows.cfbp_comments = r.fromRows;
}
// notifications (client origin)
{
  const r = rowsKind('notifications', NOTIFICATION_COLS, {
    defaults: {},
    decorateRow(row) {
      row.origin = 'client';
      return row;
    },
  });
  toRows.cfbp_notifications = r.toRows;
  fromRows.cfbp_notifications = r.fromRows;
}
// game_requests — id/kind/member_id/target_request_id/created_at typed;
// EVERY OTHER FIELD -> payload, verbatim (js/storage.js:1194-1253). No
// `extra` column exists on this table at all (§1.1 DDL) — this is NOT the
// generic rowsKind()/extra machinery, by design.
{
  const GR_TYPED = new Set(['id', 'kind', 'playerId', 'targetRequestId', 'createdAt']);
  toRows.cfbp_game_requests = (list, ctx) => {
    const rows = (Array.isArray(list) ? list : []).map((item) => {
      const payload = {};
      for (const k of Object.keys(item || {})) {
        if (!GR_TYPED.has(k)) payload[k] = item[k];
      }
      return {
        league_id: ctx && ctx.leagueId ? ctx.leagueId : null,
        id: item.id,
        kind: item.kind,
        member_id: item.playerId,
        target_request_id: item.kind === 'withdraw' ? (item.targetRequestId || null) : null,
        created_at: toIso(item.createdAt),
        payload,
      };
    });
    return { game_requests: rows };
  };
  fromRows.cfbp_game_requests = (rowsByTable) => {
    const rows = (rowsByTable && rowsByTable.game_requests) || [];
    return rows.map((r) => {
      const obj = { id: r.id, kind: r.kind, playerId: r.member_id };
      if (r.kind === 'withdraw') obj.targetRequestId = r.target_request_id;
      Object.assign(obj, r.payload || {});
      obj.createdAt = toIso(r.created_at);
      return obj;
    });
  };
}
// scribe_learnings / scribe_canon / scribe_reports — every item's `payload`
// IS the whole legacy entry verbatim (Code.gs literal object construction
// confirms every kind, including 'experiment'/'fact_candidate', already
// carries its own `runId` — no external run context is needed to synthesize
// an id). `ord` = array index, restored by sorting on read.
{
  // `hasRunId` — REV n11 (2026-09-13). `scribe_learnings` and `scribe_canon`
  // both have a `run_id` column; `scribe_reports` does NOT, because its own
  // primary key IS the runId (id: (item) => item.runId, below). Emitting
  // `run_id` for scribe_reports anyway meant import_rows' jsonb_to_recordset
  // silently discarded the key — harmless in this one case, but only by
  // accident, and invisible either way. The seam test in projectiontest.mjs
  // now rejects a row key that no recordset column list names, so this is a
  // hard error rather than a shrug.
  function scribeScalarKind(table, { id, statusCols, hasRunId = true }) {
    return {
      toRows(list, ctx) {
        const arr = Array.isArray(list) ? list : [];
        const rows = arr.map((item, ord) => {
          const row = {
            league_id: ctx && ctx.leagueId ? ctx.leagueId : null,
            id: id(item, ord),
            ord,
            payload: item,
            created_at: toIso(item.createdAt),
          };
          if (hasRunId) row.run_id = item.runId !== undefined ? item.runId : null;
          for (const [col, legacy] of Object.entries(statusCols)) row[col] = item[legacy];
          return row;
        });
        return { [table]: rows };
      },
      fromRows(rowsByTable) {
        const rows = ((rowsByTable && rowsByTable[table]) || []).slice().sort((a, b) => a.ord - b.ord);
        return rows.map((r) => r.payload);
      },
    };
  }
  const learnings = scribeScalarKind('scribe_learnings', {
    id: (item, ord) => (item.kind === 'learning' && item.learningId) ? item.learningId : `sl_${item.runId}_${ord}`,
    statusCols: { kind: 'kind', status: 'status' },
  });
  toRows.cfbp_scribe_learnings = learnings.toRows;
  fromRows.cfbp_scribe_learnings = learnings.fromRows;

  const canon = scribeScalarKind('scribe_canon', {
    id: (item) => item.canonId,
    statusCols: { approval_status: 'approvalStatus' },
  });
  toRows.cfbp_scribe_canon = canon.toRows;
  fromRows.cfbp_scribe_canon = canon.fromRows;

  const reports = scribeScalarKind('scribe_reports', {
    id: (item) => item.runId,
    statusCols: {},
    hasRunId: false,   // REV n11 — the table has no run_id column; `id` already is the runId
  });
  toRows.cfbp_scribe_reports = reports.toRows;
  fromRows.cfbp_scribe_reports = reports.fromRows;
}
// SEASON_2025 (history-2025.js) — synthetic key, no `cfbp_*` storage key
// exists for it. The importer builds `{ season: SEASON_2025, obligations:
// season2025Obligations() }` (it may import history-2025.js directly, unlike
// this module) and passes that composed payload in.
{
  toRows.SEASON_2025 = (payload, ctx) => ({
    season_archives: [{
      league_id: ctx && ctx.leagueId ? ctx.leagueId : null,
      season: '2025',
      payload,
    }],
  });
  fromRows.SEASON_2025 = (rowsByTable) => {
    const rows = (rowsByTable && rowsByTable.season_archives) || [];
    const row = rows.find((r) => r.season === '2025');
    return row ? row.payload : null;
  };
}

// ─── event-log projections (paged imports; not part of toRows/fromRows) ───
// CFBP_MESSAGES / CFBP_SCRIBE_MEMORY / CFBP_NOTIFY_LOG are Apps Script
// SHEETS, not `cfbp_*` KV keys — the importer pages them (chatSince,
// scribeMemoryList, notifyLog) rather than reading one blob, so they get
// per-row functions instead of a toRows/fromRows entry (DI-183a's public
// surface section lists these as separate named exports for exactly this
// reason).

/**
 * One CFBP_MESSAGES event (the shape `Code.gs`'s `rowToEvent()`, ~line 958,
 * returns to a client: seq, id, ts EPOCH MS, type, author, gameTag, body,
 * targetId, replyTo, notify (already unpacked from meta._n), meta (already
 * stripped of _n)) -> one `messages` row (DDL comment, `backend/Code.gs:754`
 * MSG_HEADER + row build ~901-943).
 */
export function messageToRow(ev, ctx) {
  const memberIds = ctx && ctx.memberIds;
  const author = String(ev.author || 'unknown');
  return {
    league_id: ctx && ctx.leagueId ? ctx.leagueId : null,
    id: ev.id,
    seq: Number(ev.seq),
    ts: toIso(ev.ts),
    type: ev.type || 'message',
    author,
    author_member_id: memberIdOrNull(author, memberIds),
    author_kind: memberAuthorKind(author, memberIds),
    game_tag: ev.gameTag || '',
    body: ev.body || '',
    target_id: ev.targetId || '',
    reply_to: ev.replyTo || '',
    notify: !!ev.notify,
    meta: ev.meta && typeof ev.meta === 'object' ? ev.meta : null,
  };
}

/** Inverse of `messageToRow` — reconstructs the `rowToEvent()`-shaped object
 *  (ts back to epoch ms, since that is the wire shape `chat.js`/`ingest()`
 *  consume). `author_member_id`/`author_kind` are DERIVED columns and are
 *  never restored onto the event (they don't exist on the legacy shape). */
export function rowToMessage(row) {
  return {
    seq: Number(row.seq),
    id: row.id,
    ts: row.ts ? new Date(row.ts).getTime() : null,
    type: row.type,
    author: row.author,
    gameTag: row.game_tag || '',
    body: row.body || '',
    targetId: row.target_id || '',
    replyTo: row.reply_to || '',
    notify: !!row.notify,
    meta: row.meta && typeof row.meta === 'object' ? row.meta : null,
  };
}

/** One CFBP_SCRIBE_MEMORY row (`backend/Code.gs:6217-6218` SCRIBE_MEMORY_
 *  HEADER) <-> one `scribe_memory` row. */
export function memoryToRow(rec, ctx) {
  return {
    league_id: ctx && ctx.leagueId ? ctx.leagueId : null,
    id: rec.id,
    subject_member_id: rec.playerId || null,
    kind: rec.kind,
    key: rec.key || '',
    value: rec.value || '',
    provenance: rec.provenance || '',
    confidence: rec.confidence === undefined || rec.confidence === null ? null : Number(rec.confidence),
    created_at: toIso(rec.createdAt),
    review_at: rec.reviewAt ? toIso(rec.reviewAt) : null,
    source_message_id: rec.sourceMessageId || null,
    refreshed_at: rec.refreshedAt ? toIso(rec.refreshedAt) : null,
  };
}
export function rowToMemory(row) {
  return {
    id: row.id,
    playerId: row.subject_member_id || null,
    kind: row.kind,
    key: row.key || '',
    value: row.value || '',
    provenance: row.provenance || '',
    confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
    createdAt: toIso(row.created_at),
    reviewAt: row.review_at ? toIso(row.review_at) : '',
    sourceMessageId: row.source_message_id || '',
    refreshedAt: row.refreshed_at ? toIso(row.refreshed_at) : null,
  };
}

/** One CFBP_NOTIFY_LOG record (`backend/Code.gs:1169` NOTIFY_LOG_HEADER +
 *  `rowToNotifyLogRecord_()` ~line 1201) <-> one `notifications` row with
 *  `origin='server'`. `seq` has no column of its own — DI-183a: "kept in
 *  meta.__seq" (extra-less; there is no `extra` column on `notifications`
 *  either, so it goes directly into the typed `meta` jsonb column). */
export function notifyLogToRow(rec, ctx) {
  const meta = rec.meta && typeof rec.meta === 'object' ? { ...rec.meta } : {};
  meta.__seq = Number(rec.seq);
  return {
    league_id: ctx && ctx.leagueId ? ctx.leagueId : null,
    id: rec.id,
    member_id: rec.playerId,
    origin: 'server',
    event: rec.event,
    actor: actorToColumn(rec.actor),   // `notifications.actor` is TEXT; the record's actor is an object
    title: rec.title || '',
    body: rec.body || '',
    destination: rec.destination === undefined ? null : rec.destination,
    created_at: toIso(rec.createdAt),
    read_at: null,
    dedup_key: rec.dedupKey,
    week_id: rec.weekId || null,
    meta,
  };
}
export function rowToNotifyLog(row) {
  const meta = row.meta && typeof row.meta === 'object' ? { ...row.meta } : {};
  const seq = Number(meta.__seq || 0);
  delete meta.__seq;
  return {
    seq,
    id: row.id,
    playerId: row.member_id,
    event: row.event,
    actor: actorFromColumn(row.actor),
    title: row.title || '',
    body: row.body || '',
    destination: row.destination === undefined ? null : row.destination,
    createdAt: toIso(row.created_at),
    dedupKey: row.dedup_key,
    weekId: row.week_id || null,
    meta,
  };
}
