/**
 * CFB Pickems - chunkstore.mjs (TESTED TWIN of backend/Code.gs's CFBP_STORE path)
 * ==============================================================================
 * Item CAP (2026-09-04). cfbp_picks is a single Google Sheets cell, and Sheets
 * caps a cell at 50,000 characters. Measured at 238 chars a pick x 60 picks a
 * week, the cumulative season blob crosses the cap around WEEK 3 (pushtest [8]).
 * RG-56's client quarantine only HOLDS an over-cap key back; it never stores it.
 * The real fix is to split one logical key across several physical cells in the
 * Sheet and reassemble it transparently on read.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * backend/Code.gs is Google Apps Script and cannot run under node. pushtest.mjs
 * handled that by HAND-PORTING Code.gs into the test, which risks silent drift
 * between the port and the deployed script. This module is the alternative: the
 * PURE part of the chunking algorithm (how a value is split into cells, how the
 * cells are named, how they are reassembled) lives here as importable ES-module
 * functions, captest.mjs tests THESE functions directly, and Code.gs carries a
 * verbatim copy of the same constants and logic. captest.mjs then greps Code.gs
 * to assert the two have not diverged (the "twin-sync" check).
 *
 * The only thing Code.gs does that this module does not is the Sheet row I/O
 * (getRange/appendRow). That glue is unavoidably Apps-Script-specific and is the
 * one part only a real deploy can confirm.
 *
 * DEPLOY IS MANUAL. Editing Code.gs changes nothing until Drew runs
 * Deploy -> Manage deployments -> Edit -> New version on the SAME deployment.
 *
 * ── GENERATION PING-PONG (Item CAP hardening, 2026-09-05) ───────────────────
 * The first release wrote fragment rows IN PLACE (fixed keys <key>+PART+i) and
 * flipped the marker last. That made the FIRST over-cap write (single→chunked)
 * crash-safe — a mid-write death left the prior single cell intact — but a
 * chunked→chunked UPDATE overwrote the live prior fragments while the prior
 * marker still pointed at them. A crash after overwriting an early fragment but
 * before flipping the marker left a reader reassembling new-front + old-tail →
 * a corrupt/truncated string → safeParse downgrade → the prior value gone. This
 * bit early-byte-mutating keys, cfbp_games especially (any edit / re-grade /
 * spread correction), which crosses the cap ~week 5.
 *
 * The fix: fragments are versioned by GENERATION ('A' / 'B'). The marker names
 * the live generation AND part count: CHUNK_MARK + <gen> + ':' + <n>. A new
 * chunked write always lands on the INACTIVE generation's fresh rows; the live
 * prior fragments are never touched until AFTER the marker flip atomically
 * repoints to the new generation. Every mid-write prefix therefore reads back as
 * the prior value (old marker still live) or the finished new value (new marker
 * flipped) — never a mixture. Two generations bound row growth to ~2× fragments:
 * cleanup blanks the now-dead generation after the flip, and those blanked rows
 * are REUSED by the next write's fresh generation (Code.gs putCell pulls from a
 * free-row pool), so the sheet does not leak a row on every write.
 *
 * BACKWARD COMPAT: a legacy generation-less marker (CHUNK_MARK + <n>, no colon)
 * still reads correctly — its fragments are keyed the old way (<key>+PART+i) and
 * parseMarker returns gen=null for it, which chunkKey maps back to the old form.
 * The first write over a legacy value picks generation 'A' (whose rows,
 * <key>+PART+A0…, never collide with legacy <key>+PART+0…), so the legacy
 * fragments stay intact until the marker flip, then are cleaned up as orphans.
 */

// -- Constants -- MUST match backend/Code.gs verbatim (captest twin-sync guard) --
export const CELL_SAFE_LIMIT = 45000;            // chars per cell; < 50,000 hard cap, with headroom
export const CHUNK_MARK = '__CFBP_CHUNKED__';    // primary-cell marker: CHUNK_MARK + <gen> + ':' + <partCount>  (legacy: CHUNK_MARK + <partCount>)
export const CHUNK_TAG = '__CFBP_PART__';        // chunk-row key = <key> + CHUNK_TAG + <gen?> + <index>

/**
 * Physical row key for chunk `i` of logical `key` in generation `gen`.
 * gen === null / undefined is the LEGACY generation-less form (<key>+PART+i),
 * used only for reading values written before the ping-pong upgrade, and for the
 * append-only snapshot payload (fresh id every time, so no in-place hazard).
 */
export function chunkKey(key, gen, i) {
  return key + CHUNK_TAG + (gen === null || gen === undefined ? '' : gen) + i;
}

/** True when a physical row key is a chunk fragment, not a top-level app key. */
export function isChunkKey(key) { return String(key).indexOf(CHUNK_TAG) !== -1; }

/** How many chunk parts `str` occupies. 0 means it fits in a single cell. */
export function partCount(str) {
  if (typeof str !== 'string') str = 'null';
  return str.length <= CELL_SAFE_LIMIT ? 0 : Math.ceil(str.length / CELL_SAFE_LIMIT);
}

/**
 * Parse a primary-cell marker string. Returns { gen, n } or null when `raw` is
 * not a chunk marker (a plain single-cell value, or absent).
 *   CHUNK_MARK + "A:5"  -> { gen:'A', n:5 }   (current generational format)
 *   CHUNK_MARK + "5"    -> { gen:null, n:5 }  (legacy generation-less format)
 */
export function parseMarker(raw) {
  if (typeof raw !== 'string' || raw.indexOf(CHUNK_MARK) !== 0) return null;
  const rest = raw.slice(CHUNK_MARK.length);
  const m = /^([AB]):(\d+)$/.exec(rest);
  if (m) return { gen: m[1], n: parseInt(m[2], 10) };
  if (/^\d+$/.test(rest)) return { gen: null, n: parseInt(rest, 10) };
  return null;
}

/** The generation a NEW chunked write must target, given the prior marker (or
 *  undefined for a single-cell / absent prior). Ping-pong: A↔B. A legacy or
 *  non-chunked prior gets 'A' — its rows never collide with generation-A rows. */
export function nextGen(priorRaw) {
  const m = parseMarker(priorRaw);
  return (m && m.gen === 'A') ? 'B' : 'A';
}

/**
 * Plan the physical cell writes for one logical key, IN THE ORDER THEY MUST BE
 * APPLIED, given the PRIOR marker cell (`priorRaw`) so a chunked→chunked write
 * targets the inactive generation.
 * `str` is the JSON string Code.gs already computed (JSON.stringify(value)).
 * Returns { gen, parts, cells: [[cellKey, cellValue], ...] }.
 *   - fits in one cell  -> { gen:null, parts:0, cells:[[key, str]] }
 *   - over the limit    -> fresh-generation chunk rows FIRST, then the marker LAST
 *
 * WRITE ORDER IS LOAD-BEARING. The marker cell is the last thing written, so
 * flipping it is the atomic commit of the whole value. Because the fragments go
 * to the INACTIVE generation's rows, no prefix of this plan disturbs the live
 * prior value: a reader that has not yet seen the new marker follows the OLD
 * marker to the OLD generation's still-intact fragments; a reader that sees the
 * new marker follows it to the fully-written new generation. Neither can see a
 * mixture. A JSON string never starts with '_', so the marker can never collide
 * with a real stored value.
 */
export function planWrite(key, str, priorRaw) {
  if (typeof str !== 'string') str = 'null';     // JSON.stringify(undefined) -> undefined
  if (str.length <= CELL_SAFE_LIMIT) return { gen: null, parts: 0, cells: [[key, str]] };
  const gen = nextGen(priorRaw);
  const n = Math.ceil(str.length / CELL_SAFE_LIMIT);
  const cells = [];
  for (let i = 0; i < n; i++) cells.push([chunkKey(key, gen, i), str.slice(i * CELL_SAFE_LIMIT, (i + 1) * CELL_SAFE_LIMIT)]);
  cells.push([key, CHUNK_MARK + gen + ':' + n]);   // marker LAST — the atomic commit
  return { gen, parts: n, cells };
}

/**
 * Physical chunk-row keys for `key` that are ORPHANED once it is written as the
 * live set (`gen`, `keepParts`). `existingKeys` is every physical row key
 * currently in the store. This is EVERYTHING that belongs to `key` and is not a
 * fragment of the live set: the entire other generation, any legacy fragments,
 * and any higher-index fragment of the same generation from an earlier, larger
 * write. keepParts === 0 (value now fits a single cell) orphans EVERY fragment.
 *
 * The write layer clears these after the marker flip. Clearing them keeps the
 * two-generation ping-pong bounded (the dead generation's rows become free rows
 * the next write reuses) and removes any stale fragment a later regrow could
 * otherwise pick up.
 */
export function orphanChunkKeys(key, gen, keepParts, existingKeys) {
  const prefix = key + CHUNK_TAG;
  const keep = {};
  for (let i = 0; i < keepParts; i++) keep[chunkKey(key, gen, i)] = 1;
  const out = [];
  for (const k of existingKeys) {
    const s = String(k);
    if (s.indexOf(prefix) !== 0) continue;
    if (keep[s]) continue;
    out.push(k);
  }
  return out;
}

/**
 * Reassemble the raw JSON string for one logical key from a map of every
 * physical row's raw cell text (key -> raw string). Returns:
 *   undefined  the key is absent
 *   string     the raw JSON string (caller runs safeParse/JSON.parse)
 * A legacy non-chunked row returns its cell text unchanged - backward compatible.
 * A generational marker (gen A/B) reads its generation's fragments; a legacy
 * generation-less marker reads the old <key>+PART+i fragments.
 */
export function readRaw(key, rawByKey) {
  const raw = rawByKey[key];
  if (raw === undefined) return undefined;
  const m = parseMarker(raw);
  if (m) {
    let joined = '';
    for (let i = 0; i < m.n; i++) {
      const part = rawByKey[chunkKey(key, m.gen, i)];
      joined += (part === undefined || part === null) ? '' : String(part);
    }
    return joined;
  }
  return raw;
}
