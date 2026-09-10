/**
 * CFB Pickems - captest.mjs
 * =========================
 * Item CAP (2026-09-04). cfbp_picks is stored in ONE Google Sheets cell and
 * Sheets caps a cell at 50,000 characters. Measured at 238 chars a pick and 60
 * picks a week (6 players x 10 games), the cumulative season blob crosses the
 * cap around WEEK 3. RG-56's client quarantine only HOLDS the over-cap key back;
 * it never stores it (pushtest [8], asserted "NOT FIXED, ONLY CONTAINED"). The
 * real fix is chunking: split one logical key across several physical cells in
 * backend/Code.gs and reassemble it transparently on read.
 *
 * Run:  node captest.mjs   (and TZ=... node captest.mjs)
 *
 * A SEPARATE FILE, like pushtest.mjs and synctest.mjs: it exercises the backend
 * storage format, not the chat-fold / scoring suites, and reads best start to
 * finish.
 *
 * WHAT IS ACTUALLY UNDER TEST
 * ---------------------------
 * Code.gs is Apps Script and cannot run under node. Rather than hand-port it
 * (which drifts), the PURE chunking algorithm lives in backend/chunkstore.mjs and
 * is imported here directly, so these assertions run the exact code Code.gs is a
 * copy of. Section [7] then greps Code.gs to prove the deployed script still
 * matches the twin. The Sheet row I/O in Code.gs (getRange/appendRow) is the one
 * part only a real deploy can confirm; that is Drew's manual redeploy step.
 *
 * GENERATION PING-PONG (Item CAP hardening, 2026-09-05). Sections [8] and [12]
 * are the reason for the generational rewrite: a chunked→chunked UPDATE must not
 * overwrite the live prior fragments before the marker flip, or a mid-write crash
 * reassembles new-front + old-tail into a corrupt value. The store here models
 * PHYSICAL sheet rows (with a blank/recycle free pool) so section [13] can prove
 * the fix does not leak a row on every write.
 */

import { createPick } from './js/data-model.js';
import * as CS from './backend/chunkstore.mjs';

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

const HARD_CAP = 50000;   // Google Sheets' real per-cell character limit
function safeParse(raw) { try { return JSON.parse(raw); } catch { return raw; } }

// -----------------------------------------------------------------------------
// A faithful model of Code.gs's CFBP_STORE tab as PHYSICAL ROWS, not just a cell
// map — because the bounded-growth guarantee (reviewer note 2) lives in how rows
// are recycled, not in the logical key set. Each row is { key, json }. Writes
// route through chunkstore.planWrite (fresh-generation fragments first, marker
// last) and clean up through chunkstore.orphanChunkKeys, which BLANKS dead rows;
// putCell RECYCLES blank rows from a free pool before appending, exactly as
// Code.gs's putCell/scanStore do. The HARD 50,000-char cap throws on every
// physical cell write, exactly as real Sheets does.
// -----------------------------------------------------------------------------
function makeChunkStore(initialCells = {}) {
  const rows = [];                                       // [{ key, json }, ...] — physical sheet rows
  Object.entries(initialCells).forEach(([k, v]) => rows.push({ key: k, json: v }));
  const snaps = [];                                      // faithful CFBP_SNAPSHOTS rows: [id,label,json,createdAt]

  function scan() {
    const rowByKey = {}, rawByKey = {}, freeRows = [];
    rows.forEach((r, idx) => {
      if (r.key === '' || r.key === null) { freeRows.push(idx); return; }
      rowByKey[r.key] = idx;
      rawByKey[r.key] = r.json;
    });
    return { rowByKey, rawByKey, freeRows };
  }
  function putCell(rowByKey, freeRows, k, v) {
    if (typeof v === 'string' && v.length > HARD_CAP) throw new Error('Argument too large: value');
    let idx = rowByKey[k];
    if (idx === undefined) {
      idx = freeRows.length ? freeRows.shift() : rows.length;   // recycle a blanked row before appending
      if (idx === rows.length) rows.push({ key: k, json: v });
      else rows[idx] = { key: k, json: v };
      rowByKey[k] = idx;
    } else {
      rows[idx] = { key: k, json: v };
    }
  }
  function blank(rowByKey, freeRows, k) {
    const idx = rowByKey[k];
    if (idx === undefined) return;
    rows[idx] = { key: '', json: '' };                  // key + json cleared — invisible to getAll
    delete rowByKey[k];
    freeRows.push(idx);                                 // reclaimed — reused by the next write
  }
  function setMany(entries) {
    const { rowByKey, rawByKey, freeRows } = scan();
    Object.keys(entries).forEach(key => {
      const str = JSON.stringify(entries[key]);
      const { gen, parts, cells } = CS.planWrite(key, str, rawByKey[key]);   // prior marker -> inactive generation
      cells.forEach(([ck, cv]) => putCell(rowByKey, freeRows, ck, cv));      // fragments first, marker last
      CS.orphanChunkKeys(key, gen, parts, Object.keys(rowByKey)).forEach(k => blank(rowByKey, freeRows, k));
    });
    return Object.keys(entries).length;
  }
  function rawByKeyMap() {
    const m = {};
    rows.forEach(r => { if (r.key !== '' && r.key !== null) m[r.key] = r.json; });
    return m;
  }
  function getAll() {
    const rawByKey = rawByKeyMap();
    const out = {};
    Object.keys(rawByKey).forEach(key => {
      if (CS.isChunkKey(key)) return;                    // fragments are not top-level keys
      const raw = CS.readRaw(key, rawByKey);
      out[key] = (raw === '' || raw === undefined || raw === null) ? null : safeParse(raw);
    });
    return out;
  }

  // ── Snapshots — a faithful model of Code.gs's CFBP_SNAPSHOTS path (NOTE 3).
  // APPEND-ONLY with a fresh id each time, so no in-place hazard: the payload
  // rides the LEGACY generation-less chunk convention (fragment rows first,
  // marker row last), which readRaw reads via its gen=null branch.
  function snapCell(v) {
    if (typeof v === 'string' && v.length > HARD_CAP) throw new Error('Argument too large: value');
    return v;
  }
  function makeSnapshot(label) {
    const all = getAll();
    const id = 'snap_' + (snaps.length + 1);
    const now = new Date().toISOString();
    const str = JSON.stringify(all);
    if (str.length <= CS.CELL_SAFE_LIMIT) {
      snaps.push([id, label || '', snapCell(str), now]);
      return id;
    }
    const n = Math.ceil(str.length / CS.CELL_SAFE_LIMIT);
    for (let i = 0; i < n; i++) {
      snaps.push([CS.chunkKey(id, null, i), '', snapCell(str.slice(i * CS.CELL_SAFE_LIMIT, (i + 1) * CS.CELL_SAFE_LIMIT)), now]);
    }
    snaps.push([id, label || '', CS.CHUNK_MARK + n, now]);   // legacy generation-less marker, row last
    return id;
  }
  function listSnapshots() {
    const out = [];
    for (const r of snaps) {
      if (r[0] === '' || CS.isChunkKey(r[0])) continue;
      out.push({ id: r[0], label: r[1], createdAt: r[3] });
    }
    return out.reverse();
  }
  function restoreSnapshot(id) {
    const rawById = {};
    for (const r of snaps) if (r[0] !== '') rawById[String(r[0])] = r[2];
    const raw = CS.readRaw(String(id), rawById);
    if (raw === undefined) throw new Error('Snapshot not found: ' + id);
    const data = safeParse(raw) || {};
    makeSnapshot('auto-before-restore-' + id);
    setMany(data);
  }

  return {
    setMany, getAll,
    rawCellsMap: rawByKeyMap,
    cellKeys: () => rows.filter(r => r.key !== '' && r.key !== null).map(r => r.key),
    cellLens: () => rows.filter(r => r.key !== '' && r.key !== null).map(r => (typeof r.json === 'string' ? r.json.length : 0)),
    rowCount: () => rows.length,                          // physical rows, blanks INCLUDED
    liveRowCount: () => rows.filter(r => r.key !== '' && r.key !== null).length,
    rawCell: k => { const r = rows.find(x => x.key === k); return r ? r.json : undefined; },
    makeSnapshot, listSnapshots, restoreSnapshot,
    snapCellLens: () => snaps.map(r => (typeof r[2] === 'string' ? r[2].length : 0)),
    snapRawById: id => { const r = snaps.find(x => x[0] === id); return r ? r[2] : undefined; },
  };
}

// A model of the CURRENT, unchunked Code.gs setMany: one cell per key, no split,
// no size check -> Apps Script throws when a value exceeds the cap. This is the
// bug, preserved so the reason for the fix cannot be quietly forgotten.
function legacySetManyThrowsOnOverCap(value) {
  const str = JSON.stringify(value);
  if (str.length > HARD_CAP) throw new Error('Argument too large: value');
  return str;
}

// -----------------------------------------------------------------------------
// A realistic over-cap cfbp_picks: a full season through the REAL createPick path
// so the byte count is the shipped one, not an invented number. `team` lets a
// test build a DIFFERENT-but-same-size value to model an early-byte-mutating edit.
// -----------------------------------------------------------------------------
function seasonPicks(weeks, team = 'Ohio State') {
  const out = [];
  for (let wk = 1; wk <= weeks; wk++)
    for (let p = 1; p <= 6; p++)
      for (let g = 1; g <= 10; g++)
        out.push(createPick(`w${wk}`, `g_1757001234567_${wk}${g}`, `p${p}`, team));
  return out;
}

// =============================================================================
console.log('\n[1] MEASURE - a full season of picks does not fit in one Sheets cell...');
// =============================================================================
{
  const picks = seasonPicks(15);
  const perPick = Math.round(JSON.stringify(picks).length / picks.length);
  const total = JSON.stringify(picks).length;
  const crossWeek = Math.max(1, Math.floor(HARD_CAP / (perPick * 60)));

  assert(perPick >= 200 && perPick <= 280,
    `a pick serializes to ${perPick} chars through the real createPick path (band 200-280)`);
  assert(total > HARD_CAP,
    `a 15-week season of picks is ${total} chars in ONE cell - ${Math.round(total / HARD_CAP * 100)}% of the ${HARD_CAP}-char cap`);
  assert(crossWeek <= 4,
    `cfbp_picks crosses the cap around WEEK ${crossWeek} - imminent (today is week 1), not hypothetical`);
}

// =============================================================================
console.log('\n[2] THE OLD PATH IS BROKEN - one cell cannot hold the value, so Apps Script throws...');
// =============================================================================
{
  const picks = seasonPicks(15);
  let threw = null;
  try { legacySetManyThrowsOnOverCap(picks); } catch (e) { threw = e; }
  assert(threw !== null,
    'the CURRENT unchunked Code.gs setMany throws on an over-cap value - this is the outage RG-56 could only contain, reproduced');

  // And the small case must be untouched: a value that fits still stores as one
  // cell, byte-for-byte, so the fix changes nothing for the common path.
  const small = seasonPicks(1);
  assert(JSON.stringify(small).length < HARD_CAP && legacySetManyThrowsOnOverCap(small) === JSON.stringify(small),
    'control: one week of picks fits in a single cell and is stored unchanged');
}

// =============================================================================
console.log('\n[3] THE FIX ROUND-TRIPS - an over-cap cfbp_picks is chunked, stored, and read back identical...');
// =============================================================================
{
  const store = makeChunkStore();
  const picks = seasonPicks(15);

  let threw = null;
  try { store.setMany({ cfbp_picks: picks, cfbp_obligations: [{ obligationId: 'o1' }] }); }
  catch (e) { threw = e; }

  assert(threw === null,
    'storing an over-cap cfbp_picks no longer throws - it is split across cells instead of refused');

  const back = store.getAll();
  assert(JSON.stringify(back.cfbp_picks) === JSON.stringify(picks),
    'cfbp_picks reads back byte-for-byte identical after a chunked round trip');
  assert(back.cfbp_picks.length === picks.length && back.cfbp_picks[0].pickId === picks[0].pickId
         && back.cfbp_picks[picks.length - 1].pickId === picks[picks.length - 1].pickId,
    'first and last pick survive - the chunks reassemble in order with nothing dropped or duplicated');
  assert(JSON.stringify(back.cfbp_obligations) === JSON.stringify([{ obligationId: 'o1' }]),
    'a normal-sized sibling key in the same setMany is unaffected by the over-cap key beside it');

  // The first over-cap write lands on generation A.
  assert(String(store.rawCell('cfbp_picks')).indexOf(CS.CHUNK_MARK + 'A:') === 0,
    'the first chunked write marks the primary cell with generation A (CHUNK_MARK + "A:" + n)');
}

// =============================================================================
console.log('\n[4] BACKWARD COMPATIBLE - legacy non-chunked rows already in the Sheet still read correctly...');
// =============================================================================
{
  // A Sheet written by the OLD Code.gs: every value in a single cell, no markers.
  const legacyPlayers = [{ playerId: 'p0', displayName: 'Drew' }, { playerId: 'p1', displayName: 'Brayden' }];
  const legacyWeek = [{ weekId: 'w1', status: 'open' }];
  const store = makeChunkStore({
    cfbp_players: JSON.stringify(legacyPlayers),
    cfbp_weeks: JSON.stringify(legacyWeek),
  });

  let back = store.getAll();
  assert(JSON.stringify(back.cfbp_players) === JSON.stringify(legacyPlayers)
         && JSON.stringify(back.cfbp_weeks) === JSON.stringify(legacyWeek),
    'pre-existing single-cell rows read back unchanged through the new reassembly path');

  // Now grow one of them over the cap: it converts to chunked in place, and the
  // OTHER legacy key is still readable - a mixed Sheet (some chunked, some not).
  const bigPicks = seasonPicks(15);
  store.setMany({ cfbp_picks: bigPicks });
  back = store.getAll();
  assert(JSON.stringify(back.cfbp_players) === JSON.stringify(legacyPlayers)
         && JSON.stringify(back.cfbp_picks) === JSON.stringify(bigPicks),
    'a Sheet holding both legacy single-cell rows AND a new chunked key reads every key correctly');

  // getAll must never surface a chunk fragment as if it were an app key.
  assert(!Object.keys(back).some(k => CS.isChunkKey(k)),
    'chunk-fragment rows are never returned as top-level keys - the client sees only real app keys');
}

// =============================================================================
console.log('\n[5] NO PHYSICAL CELL EXCEEDS THE HARD CAP - the whole point of splitting...');
// =============================================================================
{
  const store = makeChunkStore();
  store.setMany({ cfbp_picks: seasonPicks(15) });   // would throw if any cell overflowed
  const lens = store.cellLens();
  assert(lens.every(n => n <= HARD_CAP),
    `every physical cell written is <= ${HARD_CAP} chars (max was ${Math.max(...lens)}) - no cell can overflow`);
  assert(lens.every(n => n <= CS.CELL_SAFE_LIMIT),
    `and every chunk stays within the ${CS.CELL_SAFE_LIMIT}-char safe budget, leaving headroom below the hard cap`);
}

// =============================================================================
console.log('\n[6] GROW THEN SHRINK - a key that was chunked reads correctly after it shrinks again...');
// =============================================================================
{
  const store = makeChunkStore();
  const big = seasonPicks(15);      // several chunks
  const small = seasonPicks(1);     // fits in one cell

  store.setMany({ cfbp_picks: big });
  store.setMany({ cfbp_picks: small });   // primary row overwritten with plain JSON

  const back = store.getAll();
  assert(JSON.stringify(back.cfbp_picks) === JSON.stringify(small),
    'after shrinking back under the cap, the key reads as the new small value - stale higher-index chunk rows are inert, never re-read');
  assert(back.cfbp_picks.length === small.length,
    'no leftover picks from the larger prior value bleed into the reassembled result');

  // And grow again: a value larger than the first chunked write reassembles fine.
  const bigger = seasonPicks(20);
  store.setMany({ cfbp_picks: bigger });
  assert(JSON.stringify(store.getAll().cfbp_picks) === JSON.stringify(bigger),
    'growing to MORE chunks than any prior write reassembles correctly - part count is read from the current marker, not assumed');
}

// =============================================================================
console.log('\n[7] TWIN-SYNC - the deployed backend/Code.gs matches the tested chunking twin...');
// =============================================================================
// The assertions above run backend/chunkstore.mjs. Production runs backend/Code.gs.
// If the two drift, the tests are green while the Sheet is still broken. This
// section reads Code.gs and requires the same constants and chunking control flow
// to be present, so a Code.gs that lost the fix (or never got it) fails HERE.
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = new URL('./backend/Code.gs', import.meta.url);
  const gs = fs.readFileSync(url.fileURLToPath(path), 'utf8');

  assert(gs.includes(CS.CHUNK_MARK),
    `Code.gs contains the chunk marker constant "${CS.CHUNK_MARK}" - without it the Sheet cannot be reassembled`);
  assert(gs.includes(CS.CHUNK_TAG),
    `Code.gs contains the chunk-row tag "${CS.CHUNK_TAG}"`);
  assert(gs.includes(String(CS.CELL_SAFE_LIMIT)),
    `Code.gs uses the same ${CS.CELL_SAFE_LIMIT}-char safe limit as the tested twin`);
  assert(/function chunkKey\(key, gen, i\)/.test(gs),
    'Code.gs chunkKey is generation-aware (key, gen, i) — matching the twin');
  assert(/function parseMarker/.test(gs) && /function nextGen/.test(gs),
    'Code.gs carries the generation parser (parseMarker) and the ping-pong selector (nextGen)');
  assert(/planWrite|writeValue|splitChunks|CHUNK_MARK\s*\+/.test(gs),
    'Code.gs actually splits an over-cap value on write (has the chunk-write helper), not just the constants');
  assert(/readValue|readRaw|CHUNK_MARK/.test(gs) && /getAll/.test(gs),
    'Code.gs reassembles chunked values on read (getAll routes through the chunk-aware reader)');

  // THE FIX — generation ping-pong. writeValue must write the fresh-generation
  // fragments BEFORE it flips the marker (marker putCell LAST), and the marker
  // must encode the generation, or a chunked→chunked crash re-introduces the
  // new-front/old-tail corruption sections [8]/[12] exist to prevent.
  const wv = gs.slice(gs.indexOf('function writeValue'), gs.indexOf('function clearOrphanChunks'));
  const fragPut = wv.indexOf('chunkKey(key, gen, i)');
  const markPut = wv.indexOf("CHUNK_MARK + gen + ':' + n");
  assert(fragPut !== -1 && markPut !== -1 && fragPut < markPut,
    'Code.gs writeValue writes the fresh-GENERATION fragments before it flips the generational marker (marker putCell comes LAST) — the atomic-commit ordering');
  assert(wv.includes('nextGen(priorRaw)'),
    'Code.gs writeValue targets the INACTIVE generation (nextGen(priorRaw)) — a chunked→chunked write never overwrites the live prior fragments');
  assert(/function clearOrphanChunks/.test(gs) && /clearOrphanChunks\(s, rowByKey, freeRows, key/.test(gs),
    'Code.gs cleans up the dead generation + orphaned __CFBP_PART__ rows after the flip (clearOrphanChunks)');

  // BOUNDED GROWTH (reviewer note 2). Blanked orphan rows must be RECYCLED, or the
  // ping-pong leaks a row set on every write. The free-row pool is the guard.
  assert(/freeRows/.test(gs) && /freeRows\.shift\(\)/.test(gs) && /freeRows\.push\(/.test(gs),
    'Code.gs recycles blanked orphan rows through a free-row pool (freeRows.shift on write, push on cleanup) — bounded row growth, not one leaked row per write');
  assert(/function scanStore/.test(gs) && /freeRows\.push\(i \+ 1\)/.test(gs),
    'Code.gs scanStore discovers blank rows as free rows for the next write to reuse');

  // NOTE 3 — the snapshot payload rides the legacy generation-less chunk convention.
  const ms = gs.slice(gs.indexOf('function makeSnapshot'), gs.indexOf('function listSnapshots'));
  assert(ms.includes('CHUNK_MARK + n') && ms.includes('chunkKey(id, null'),
    'Code.gs makeSnapshot chunks an over-cap backup across snapshot rows (chunkKey(id, null, …) + CHUNK_MARK + n), append-only so no generation needed');
  assert(/readRaw\(String\(id\)/.test(gs),
    'Code.gs restoreSnapshot reassembles a chunked backup through readRaw — and reads a legacy single-cell snapshot unchanged');
}

// =============================================================================
console.log('\n[8] MID-WRITE CRASH, SINGLE→CHUNKED — a partial chunk write never yields a truncated read...');
// =============================================================================
// The FIRST over-cap write: a single-cell prior value becomes chunked. The marker
// is written LAST, so every prefix of the plan leaves the primary cell holding the
// prior single-cell value until the atomic commit. Applies EVERY prefix and proves
// the read is always prior-or-new.
{
  const prior = seasonPicks(2);            // last week's picks — under the cap, one cell
  const next  = seasonPicks(15);           // this week's value — over the cap, chunked
  const priorStr = JSON.stringify(prior);
  assert(priorStr.length <= CS.CELL_SAFE_LIMIT, 'fixture: the prior value fits in a single cell');

  const { cells: plan } = CS.planWrite('cfbp_picks', JSON.stringify(next), priorStr);
  assert(plan.length > 1 && plan[plan.length - 1][1].indexOf(CS.CHUNK_MARK) === 0,
    'the marker cell is planned LAST — flipping it is the atomic commit, not the first write');
  assert(plan[0][1].indexOf(CS.CHUNK_MARK) !== 0,
    'the FIRST planned write is a fragment, not the marker — nothing promises parts before they exist');

  let everCorrupt = false;
  for (let cut = 0; cut <= plan.length; cut++) {
    const cells = { cfbp_picks: priorStr };              // the sheet as it stood before this write
    for (let i = 0; i < cut; i++) cells[plan[i][0]] = plan[i][1];
    const raw = CS.readRaw('cfbp_picks', cells);
    const parsed = (raw === '' || raw === undefined || raw === null) ? null : safeParse(raw);
    const isPrior = JSON.stringify(parsed) === JSON.stringify(prior);
    const isNext  = JSON.stringify(parsed) === JSON.stringify(next);
    if (!isPrior && !isNext) everCorrupt = true;
  }
  assert(!everCorrupt,
    'single→chunked: at EVERY point mid-write, cfbp_picks reads back as the prior value OR the finished new value — never a truncated/corrupt reassembly');
}

// =============================================================================
console.log('\n[9] CHUNKED → SINGLE CELL — shrinking cleans up orphaned fragments...');
// =============================================================================
{
  const store = makeChunkStore();
  const small = seasonPicks(1);
  const eight = seasonPicks(8);
  store.setMany({ cfbp_picks: seasonPicks(15) });        // chunked: several __CFBP_PART__ rows
  assert(store.cellKeys().some(k => CS.isChunkKey(k)), 'fixture: the over-cap value created fragment rows');

  store.setMany({ cfbp_picks: small });                  // back under the cap -> single cell
  assert(!store.cellKeys().some(k => CS.isChunkKey(k)),
    'after shrinking to a single-cell value, NO __CFBP_PART__ fragment rows survive — orphans are cleared, not left to be mis-read on a later regrow');
  assert(JSON.stringify(store.getAll().cfbp_picks) === JSON.stringify(small),
    'and the shrunk value reads back correctly through the single-cell path');

  // Regrow to FEWER parts than the first chunked write, and confirm no stale
  // higher fragment from the first write can leak into the reassembly.
  store.setMany({ cfbp_picks: seasonPicks(15) });        // chunked again
  store.setMany({ cfbp_picks: eight });                  // fewer chunks than before
  assert(JSON.stringify(store.getAll().cfbp_picks) === JSON.stringify(eight),
    'shrinking to FEWER chunks drops the now-orphaned high-index fragments and still reads back exactly the new value');
}

// =============================================================================
console.log('\n[10] SNAPSHOT ROUND-TRIP — an over-cap season backup is chunked and restores intact (NOTE 3)...');
// =============================================================================
{
  const store = makeChunkStore();
  const big = seasonPicks(15);
  store.setMany({ cfbp_picks: big, cfbp_games: [{ gameId: 'g1' }], cfbp_settings: { theme: 'neutral' } });

  const wholeLen = JSON.stringify(store.getAll()).length;
  assert(wholeLen > HARD_CAP, `fixture: the full store serializes to ${wholeLen} chars — over the ${HARD_CAP}-char cap, so a one-cell snapshot would throw`);

  let threw = null, id = null;
  try { id = store.makeSnapshot('mid-season'); } catch (e) { threw = e; }
  assert(threw === null, 'making an over-cap snapshot no longer throws — the payload is split across snapshot rows');
  assert(store.snapCellLens().every(n => n <= HARD_CAP),
    `no snapshot cell exceeds the ${HARD_CAP}-char cap (max was ${Math.max(...store.snapCellLens())}) — the backup is chunked like the store`);
  assert(store.listSnapshots().length === 1 && store.listSnapshots()[0].id === id,
    'listSnapshots returns the backup exactly once — fragment rows are never surfaced as snapshots');

  // Wipe the picks, then restore: every pick must return byte-for-byte.
  store.setMany({ cfbp_picks: [] });
  store.restoreSnapshot(id);
  assert(JSON.stringify(store.getAll().cfbp_picks) === JSON.stringify(big),
    'restoreSnapshot reassembles the chunked backup and puts every pick back, in order');
}

// =============================================================================
console.log('\n[11] SNAPSHOT BACKWARD COMPAT — a legacy single-cell snapshot still restores...');
// =============================================================================
{
  const store = makeChunkStore();
  const one = seasonPicks(1);
  store.setMany({ cfbp_picks: one });
  const id = store.makeSnapshot('small');               // fits in one cell -> legacy shape
  assert(store.snapRawById(id) !== undefined && String(store.snapRawById(id)).indexOf(CS.CHUNK_MARK) !== 0,
    'a small snapshot is stored as a single cell with NO marker — identical to the legacy format already on the Sheet');

  store.setMany({ cfbp_picks: [] });
  store.restoreSnapshot(id);
  assert(JSON.stringify(store.getAll().cfbp_picks) === JSON.stringify(one),
    'the single-cell snapshot restores through the same readRaw path — old backups are unaffected by the chunking change');
}

// =============================================================================
console.log('\n[12] MID-WRITE CRASH, CHUNKED → CHUNKED — the generation ping-pong closes the window...');
// =============================================================================
// THE BUG THIS ITEM CLOSES. A chunked value is UPDATED with another over-cap
// value whose EARLY BYTES differ (a cfbp_games edit / re-grade / spread fix). The
// old in-place algorithm overwrote the live prior fragments while the prior marker
// still pointed at them: a crash after overwriting fragment 0 but before flipping
// the marker left a reader reassembling new-front + old-tail → corrupt. This
// section builds a real chunked prior, then applies EVERY PREFIX of the
// chunked→chunked write plan and proves the read is ALWAYS prior-or-new.
//
// FAILS against the old in-place-overwrite logic (fragments keyed <key>+PART+i,
// reused): the very first fragment prefix reads a new-front/old-tail mixture.
{
  const prior = seasonPicks(15, 'Ohio State');   // chunked
  const next  = seasonPicks(15, 'Michigan');     // chunked, DIFFERS from the first pick on
  const priorStr = JSON.stringify(prior);
  const nextStr  = JSON.stringify(next);
  assert(priorStr.length > CS.CELL_SAFE_LIMIT && nextStr.length > CS.CELL_SAFE_LIMIT,
    'fixture: both the prior and the next value are over the cap (a genuine chunked→chunked update)');
  assert(priorStr.slice(0, 200) !== nextStr.slice(0, 200),
    'fixture: the values differ in their EARLY bytes — the exact shape that broke the in-place overwrite');

  // Build the sheet exactly as it stands after the prior chunked write.
  const store = makeChunkStore();
  store.setMany({ cfbp_games: prior });
  const priorMarker = store.rawCell('cfbp_games');
  assert(priorMarker.indexOf(CS.CHUNK_MARK + 'A:') === 0, 'fixture: prior value is live on generation A');
  const priorCells = store.rawCellsMap();

  // The chunked→chunked plan, chosen against the prior marker → lands on gen B.
  const { gen, cells: plan } = CS.planWrite('cfbp_games', nextStr, priorMarker);
  assert(gen === 'B', 'the new chunked write targets the INACTIVE generation B — the live A fragments are never touched');
  assert(plan[plan.length - 1][1] === CS.CHUNK_MARK + 'B:' + (plan.length - 1),
    'the marker flip to generation B is planned LAST — the atomic commit');

  let everCorrupt = false, corruptAt = -1;
  for (let cut = 0; cut <= plan.length; cut++) {
    const cells = { ...priorCells };                     // the sheet before this write — prior A fragments live
    for (let i = 0; i < cut; i++) cells[plan[i][0]] = plan[i][1];   // apply the first `cut` writes of the plan
    const raw = CS.readRaw('cfbp_games', cells);
    const parsed = (raw === '' || raw === undefined || raw === null) ? null : safeParse(raw);
    const isPrior = JSON.stringify(parsed) === JSON.stringify(prior);
    const isNext  = JSON.stringify(parsed) === JSON.stringify(next);
    if (!isPrior && !isNext) { everCorrupt = true; if (corruptAt < 0) corruptAt = cut; }
  }
  assert(!everCorrupt,
    `chunked→chunked: at EVERY point mid-write, cfbp_games reads back as the prior value OR the finished new value — never a corrupt reassembly${corruptAt >= 0 ? ` (first corruption at prefix ${corruptAt})` : ''}`);

  // The specific killer prefix, named: all NEW fragments written, marker not yet
  // flipped. Under ping-pong the prior marker still points at generation A, whose
  // fragments are untouched, so the key still reads the PRIOR value intact.
  const partial = { ...priorCells };
  for (let i = 0; i < plan.length - 1; i++) partial[plan[i][0]] = plan[i][1];   // all B fragments, NO marker flip
  assert(JSON.stringify(safeParse(CS.readRaw('cfbp_games', partial))) === JSON.stringify(prior),
    'with every new-generation fragment written but the marker not yet flipped, cfbp_games still reads the PRIOR value — the crash is invisible until the atomic commit');

  // And the completed write commits fully, then the store round-trips it and pings
  // the generation back to A on the next update.
  store.setMany({ cfbp_games: next });
  assert(JSON.stringify(store.getAll().cfbp_games) === JSON.stringify(next)
         && store.rawCell('cfbp_games').indexOf(CS.CHUNK_MARK + 'B:') === 0,
    'after the completed chunked→chunked write the value is the new one and the live generation is B');
  store.setMany({ cfbp_games: prior });
  assert(JSON.stringify(store.getAll().cfbp_games) === JSON.stringify(prior)
         && store.rawCell('cfbp_games').indexOf(CS.CHUNK_MARK + 'A:') === 0,
    'the next chunked→chunked write ping-pongs back to generation A and still round-trips correctly');
}

// =============================================================================
console.log('\n[13] BOUNDED GROWTH — repeated chunked→chunked writes do not leak a row each time...');
// =============================================================================
// reviewer note 2: blanked orphan rows must not accumulate across ping-pong /
// shrink / regrow. The dead generation is blanked AFTER each flip, and those rows
// are recycled by the next write, so the physical row count settles at ~2×
// fragments + 1 marker and never grows per write.
{
  const store = makeChunkStore();
  const parts = CS.partCount(JSON.stringify(seasonPicks(15)));
  assert(parts >= 2, `fixture: the value chunks into ${parts} parts`);

  const counts = [];
  let lastWritten = null;
  for (let i = 0; i < 20; i++) {
    // createPick randomises pickId, so hold the EXACT value written to compare
    // against — the store round-trips what it was given, not a fresh generation.
    lastWritten = seasonPicks(15, i % 2 ? 'Michigan' : 'Ohio State');   // alternate early bytes
    store.setMany({ cfbp_picks: lastWritten });
    counts.push(store.rowCount());
  }
  const bound = 2 * parts + 1;   // two generations of fragments + one marker row
  assert(counts.every(n => n <= bound),
    `physical row count stays <= ${bound} (2× fragments + marker) across 20 chunked→chunked writes (max seen ${Math.max(...counts)}) — the dead generation's rows are recycled, not leaked`);
  assert(counts[19] === counts[2],
    `the row count is FLAT after it reaches steady state (write 3 = write 20 = ${counts[19]} rows) — no per-write growth`);
  assert(JSON.stringify(store.getAll().cfbp_picks) === JSON.stringify(lastWritten),
    'and after all that ping-ponging the value still round-trips exactly (compared to the exact bytes written, not a fresh generation)');

  // Shrink/regrow churn must also stay bounded — no blank rows pile up.
  const before = store.rowCount();
  for (let i = 0; i < 10; i++) {
    store.setMany({ cfbp_picks: seasonPicks(1) });        // single cell
    store.setMany({ cfbp_picks: seasonPicks(15) });       // chunked again
  }
  assert(store.rowCount() <= bound,
    `shrink→regrow churn also stays <= ${bound} rows (was ${before}, now ${store.rowCount()}) — blanked rows are reused, not accumulated`);
}

// =============================================================================
console.log('\n[14] READ AN ALREADY-DEPLOYED (generation-less) CHUNKED VALUE, then UPGRADE it...');
// =============================================================================
// The first Item CAP release wrote chunked values as CHUNK_MARK + <n> with
// fragments keyed <key>+PART+i (no generation). Those rows are ALREADY on the
// live Sheet. The upgraded reader must read them, and the first write over one
// must migrate it to a generational value without corrupting the read.
{
  const legacy = seasonPicks(15, 'Ohio State');
  const legacyStr = JSON.stringify(legacy);
  const n = Math.ceil(legacyStr.length / CS.CELL_SAFE_LIMIT);
  // Reconstruct a Sheet in the deployed generation-less format by hand.
  const init = { cfbp_picks: CS.CHUNK_MARK + n };         // legacy marker: NO generation, NO colon
  for (let i = 0; i < n; i++) init['cfbp_picks' + CS.CHUNK_TAG + i] = legacyStr.slice(i * CS.CELL_SAFE_LIMIT, (i + 1) * CS.CELL_SAFE_LIMIT);
  const store = makeChunkStore(init);

  assert(CS.parseMarker(CS.CHUNK_MARK + n) && CS.parseMarker(CS.CHUNK_MARK + n).gen === null,
    'parseMarker recognises the deployed generation-less marker (gen=null)');
  assert(JSON.stringify(store.getAll().cfbp_picks) === JSON.stringify(legacy),
    'the upgraded reader reassembles an already-deployed generation-less chunked value byte-for-byte');

  // Now UPDATE it with an early-byte-mutating over-cap value. The write migrates to
  // generation A (nextGen of a legacy marker), leaves the legacy fragments intact
  // until the marker flip, and cleans them up afterwards.
  const updated = seasonPicks(15, 'Michigan');
  store.setMany({ cfbp_picks: updated });
  assert(JSON.stringify(store.getAll().cfbp_picks) === JSON.stringify(updated),
    'updating a generation-less chunked value round-trips to the new value');
  assert(store.rawCell('cfbp_picks').indexOf(CS.CHUNK_MARK + 'A:') === 0,
    'the update migrates the primary cell to the generational format (generation A)');
  assert(!store.cellKeys().some(k => k.indexOf('cfbp_picks' + CS.CHUNK_TAG) === 0 && /^\d+$/.test(k.slice(('cfbp_picks' + CS.CHUNK_TAG).length))),
    'the legacy generation-less fragment rows (…PART+<digit>) are cleaned up after the migration — no stale legacy fragment survives');
}

// =============================================================================
console.log('\n[15] CONCURRENCY LOCK — the mutating store entry points hold a script lock (reviewer NOTE 1)...');
// =============================================================================
// The generation ping-pong gives single-writer CRASH atomicity, NOT concurrent-
// writer atomicity. Two Apps Script executions writing the SAME over-cap key in
// the same window both read prior marker A, both pick generation B, interleave
// their B fragments, and both flip to B:n → mixed reassembly → safeParse downgrade
// → silent pick corruption. cfbp_picks holds all six players' picks, so two
// near-simultaneous submissions past the cap (~week 3) is a realistic path. Only a
// lock closes it. LockService is Apps-Script-only and cannot run under node, so
// this is a TWIN-SYNC GREP (same technique as section [7]): it proves the deployed
// Code.gs wraps setMany/setOne in a LockService critical section mirroring
// chatAppend. A future edit that drops the lock fails HERE. True concurrency
// behaviour is confirmable only on a live deploy (Drew's manual check).
{
  const fs = await import('node:fs');
  const url = await import('node:url');
  const path = new URL('./backend/Code.gs', import.meta.url);
  const gs = fs.readFileSync(url.fileURLToPath(path), 'utf8');

  // The shared critical-section helper mirrors chatAppend's discipline exactly:
  // one SCRIPT lock, a 10s wait budget, always released in a finally.
  assert(/function withStoreLock/.test(gs),
    'Code.gs defines withStoreLock — the store critical-section helper');
  const wsl = gs.slice(gs.indexOf('function withStoreLock'), gs.indexOf('function withStoreLock') + 400);
  assert(/LockService\.getScriptLock\(\)/.test(wsl),
    'withStoreLock takes a SCRIPT lock (LockService.getScriptLock) — same lock scope kind as chatAppend');
  assert(/waitLock\(\s*10000\s*\)/.test(wsl),
    'withStoreLock waits up to 10000ms to acquire — same timeout budget as chatAppend (throws on failure → loud-fail)');
  assert(/finally\s*\{[^}]*releaseLock\(\)/.test(wsl),
    'withStoreLock releases the lock in a finally — always released, even when the wrapped write throws');

  // chatAppend's lock must still be present — the pattern this fix mirrors.
  const ca = gs.slice(gs.indexOf('function chatAppend'), gs.indexOf('function rowToEvent'));
  assert(/LockService\.getScriptLock\(\)/.test(ca) && /waitLock\(10000\)/.test(ca) && /releaseLock\(\)/.test(ca),
    'chatAppend still holds its script lock (10s wait, released in finally) — the discipline withStoreLock copies');

  // Both mutating entry points route their WHOLE body through the lock, so the
  // read-marker → write-fragments → flip-marker → cleanup sequence is atomic
  // against another writer, not just each individual cell write.
  const sm = gs.slice(gs.indexOf('function setMany'), gs.indexOf('function setMany') + 400);
  assert(/withStoreLock\(/.test(sm),
    'Code.gs setMany runs inside withStoreLock — the full write sequence is atomic against a concurrent writer');
  const so = gs.slice(gs.indexOf('function setOne'), gs.indexOf('function setOne') + 400);
  assert(/withStoreLock\(/.test(so),
    'Code.gs setOne runs inside withStoreLock — a single over-cap write is atomic against a concurrent writer');

  // The lock must WRAP the read-then-write, not sit beside it: withStoreLock must
  // come BEFORE scanStore (reads the prior marker) which comes BEFORE writeValue
  // (flips it). If the lock only covered the flip, two writers could still both
  // read marker A and pick generation B before either flipped.
  const smBody = gs.slice(gs.indexOf('function setMany'), gs.indexOf('return count'));
  assert(smBody.indexOf('withStoreLock') !== -1
      && smBody.indexOf('withStoreLock') < smBody.indexOf('scanStore')
      && smBody.indexOf('scanStore') < smBody.indexOf('writeValue'),
    'setMany acquires the lock BEFORE it reads the marker (scanStore) and BEFORE it flips it (writeValue) — the whole read-then-write is inside the critical section');
  const soBody = gs.slice(gs.indexOf('function setOne'), gs.indexOf('function setMany'));
  assert(soBody.indexOf('withStoreLock') !== -1
      && soBody.indexOf('withStoreLock') < soBody.indexOf('scanStore')
      && soBody.indexOf('scanStore') < soBody.indexOf('writeValue'),
    'setOne acquires the lock BEFORE scanStore and writeValue — same read-then-write atomicity');
}

// =============================================================================
console.log(`\n${fail === 0 ? '✅' : '❌'} captest: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
