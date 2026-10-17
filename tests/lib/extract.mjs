/**
 * tests/lib/extract.mjs — turns the legacy "spawned suite" blocks of loadtest.mjs into manifests.
 *
 * WHY THIS EXISTS. Until the tiered runner, every standalone suite was registered by appending a
 * hand-written block to the tail of loadtest.mjs: a `spawnSync` of the suite plus four to six
 * `assert()`s (exit 0, a summary line was printed, the summary says zero failed, the count is at or
 * above a ratcheted floor, and sometimes "no ERR_MODULE_NOT_FOUND" / "no skips" / "no leaked scratch
 * file"). Every branch appended to the same tail, so every merge conflicted. A suite is now one
 * `tests/suites/<id>.json`; this module converts the old blocks, mechanically and re-runnably (the
 * switchover happens after more branches have merged, so the final loadtest.mjs will hold more blocks
 * than today's).
 *
 * THE RULE THAT MATTERS: NOTHING IS DROPPED SILENTLY. Every line inside a legacy block is classified.
 * A block whose shape is not recognised, or that carries a statement this module does not know how to
 * carry across, is an ERROR naming the loadtest.mjs line — never a skipped block and never a weaker
 * manifest. The two blocks that carry a "no leaked scratch file" hygiene check are handled by a
 * fingerprinted override (HYGIENE_OVERRIDES): if their text changes the fingerprint stops matching and
 * the extractor refuses until a human re-reads them.
 *
 * Pure functions only (strings in, data out): no file I/O, so testruntest.mjs can drive it with
 * fixtures and mutate them.
 */

import { createHash } from 'node:crypto';
import vm from 'node:vm';

export const DEFAULT_TIMEOUT_MS = 300000; // SPAWNED_SUITE_TIMEOUT_MS in the legacy harness (reviewer F8, 2026-09-17)

const STRICT_RE = '(✅ ALL PASS|❌ FAILURES) — (\\d+) passed, (\\d+) failed';
/**
 * Named summary shapes. A manifest may carry `"summary": "<preset>"` or the explicit object (same keys).
 *   regex/flags — how to find the suite's own summary line in stdout+stderr (first match wins, like the old harness)
 *   passed/failed — capture-group indexes of the two counts
 *   verdict — null, or { group, equals, combined }: capture `group` must equal `equals`; `combined` means the old
 *             block asserted that AND failed==0 as ONE assertion
 *   skipped — null, or the capture-group index that must be 0
 *   single  — (optional, true only) the old block asserted "a summary was printed AND the verdict AND zero failed AND
 *             passed >= floor" as ONE assertion (the [125b] fixed-zone re-run shape), so the runner makes ONE check for
 *             all four instead of three or four: the same conditions, the same arithmetic as the legacy total
 */
export const SUMMARY_PRESETS = {
  strict:             { regex: STRICT_RE, flags: '', passed: 2, failed: 3, verdict: { group: 1, equals: '✅ ALL PASS', combined: false }, skipped: null },
  'strict-combined':  { regex: STRICT_RE, flags: '', passed: 2, failed: 3, verdict: { group: 1, equals: '✅ ALL PASS', combined: true }, skipped: null },
  'strict-single':    { regex: STRICT_RE, flags: '', passed: 2, failed: 3, verdict: { group: 1, equals: '✅ ALL PASS', combined: true }, skipped: null, single: true },
  'strict-noverdict': { regex: STRICT_RE, flags: '', passed: 2, failed: 3, verdict: null, skipped: null },
  loose:              { regex: '(\\d+) passed, (\\d+) failed', flags: '', passed: 1, failed: 2, verdict: null, skipped: null },
  'loose-skips':      { regex: '(\\d+) passed, (\\d+) failed, (\\d+) skipped', flags: '', passed: 1, failed: 2, verdict: null, skipped: 3 },
};

/** Resolve a manifest's `summary` (preset name or explicit object) to the explicit object. */
export function resolveSummary(s) {
  if (typeof s === 'string') {
    if (!SUMMARY_PRESETS[s]) throw new Error(`unknown summary preset "${s}"`);
    return SUMMARY_PRESETS[s];
  }
  if (!s || typeof s !== 'object' || typeof s.regex !== 'string') throw new Error('summary must be a preset name or { regex, passed, failed, … }');
  return { flags: '', verdict: null, skipped: null, ...s };
}

function normSummary(s) {
  return { regex: s.regex, flags: s.flags || '', passed: s.passed, failed: s.failed, verdict: s.verdict ? { group: s.verdict.group, equals: s.verdict.equals, combined: !!s.verdict.combined } : null, skipped: s.skipped ?? null, ...(s.single ? { single: true } : {}) };
}
function compactSummary(spec) {
  for (const [name, p] of Object.entries(SUMMARY_PRESETS)) {
    if (JSON.stringify(normSummary(p)) === JSON.stringify(normSummary(spec))) return name;
  }
  return normSummary(spec);
}

// ── tiny JS-literal scanner (strings / comments only — enough for the suite tables) ────────────────
function evalStringLiteral(tok) {
  // `tok` is ONE complete string literal captured by the scanner below; evaluating a lone literal in a
  // fresh context cannot run code. Anything that is not a plain literal (a template with `${`) is refused.
  if (!/^(['"`])[\s\S]*\1$/.test(tok)) throw new Error(`not a plain string literal: ${tok.slice(0, 60)}`);
  if (tok[0] === '`' && /(^|[^\\])\$\{/.test(tok)) throw new Error(`template literal with an interpolation in a suite table: ${tok.slice(0, 60)}`);
  return vm.runInNewContext(tok, Object.create(null), { timeout: 100 });
}

/** Parse the text between `of [` and `]) {` of a legacy table loop into entries (label, file, floor, why) + the comments above each. */
export function scanTable(text) {
  const entries = [];
  let i = 0;
  let depth = 0;           // bracket depth INSIDE the table (0 = between entries)
  let cur = null;          // entry being read
  let pendingComment = [];
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (c === '/' && n === '/') {                       // line comment
      let j = text.indexOf('\n', i); if (j < 0) j = text.length;
      if (depth === 0) pendingComment.push(text.slice(i + 2, j).replace(/^ ?/, '').replace(/\s+$/, ''));
      i = j; continue;
    }
    if (c === '/' && n === '*') {                       // block comment
      const j = text.indexOf('*/', i + 2); if (j < 0) throw new Error('unterminated block comment in suite table');
      i = j + 2; continue;
    }
    if (c === "'" || c === '"' || c === '`') {          // string literal
      let j = i + 1;
      while (j < text.length && text[j] !== c) { if (text[j] === '\\') j++; j++; }
      if (j >= text.length) throw new Error('unterminated string in suite table');
      if (!cur) throw new Error(`a string outside any [..] entry in the suite table near: ${text.slice(i, i + 40)}`);
      cur.items.push(text.slice(i, j + 1));
      i = j + 1; continue;
    }
    if (c === '[') {
      if (depth !== 0) throw new Error('a nested array inside a suite table entry');
      cur = { items: [], comment: pendingComment.join('\n').trim() }; pendingComment = [];
      depth++; i++; continue;
    }
    if (c === ']') {
      depth--;
      if (depth < 0) throw new Error('unbalanced ] in suite table');
      if (depth === 0 && cur) { entries.push(cur); cur = null; }
      i++; continue;
    }
    if (c === ',' || /\s/.test(c)) { i++; continue; }
    if (cur && /[0-9]/.test(c)) {                        // number
      let j = i; while (j < text.length && /[0-9_.]/.test(text[j])) j++;
      cur.items.push(text.slice(i, j)); i = j; continue;
    }
    throw new Error(`unrecognised token in suite table near: ${text.slice(i, i + 40).replace(/\n/g, ' ')}`);
  }
  if (depth !== 0) throw new Error('unbalanced [ in suite table');
  return entries.map(e => {
    if (e.items.length !== 4) throw new Error(`suite table entry has ${e.items.length} items (expected label, file, floor, why): ${e.items[0]}`);
    const [label, file, floor, why] = e.items;
    if (!/^[0-9_]+$/.test(floor)) throw new Error(`floor is not a plain number in the entry ${label}`);
    return { label: evalStringLiteral(label), file: evalStringLiteral(file), floor: Number(floor.replace(/_/g, '')), why: evalStringLiteral(why), comment: e.comment };
  });
}

// ── line classifiers ────────────────────────────────────────────────────────────────────────────
const RE = {
  // Two optional, exactly-shaped extensions are carried into the manifest (everything else in the options is still REFUSED):
  //   `timeout: SPAWNED_SUITE_TIMEOUT_MS * N`             → "timeoutMs": N × 300000 (a suite the old harness gave a longer deadline)
  //   `, env: { ...process.env, TZ: '<zone>' }`           → "env": { "TZ": "<zone>" } (a fixed-zone re-run; the runner merges
  //                                                          the manifest env over process.env, so the meaning is identical)
  // An env WITHOUT `...process.env` (it would replace PATH and everything else) or with any other key is not this shape: refused.
  spawn: /^\s*const result = spawnSync\(process\.execPath, \[([^\]]*)\], \{ cwd, encoding: 'utf8', timeout: SPAWNED_SUITE_TIMEOUT_MS(?: \* (\d+))?(?:, env: \{ \.\.\.process\.env, TZ: '([A-Za-z0-9_+\-/]+)' \})? \}\);\s*$/,
  boiler: [
    /^\s*const \{ spawnSync \} = await import\('node:child_process'\);\s*$/,
    /^\s*const \{ fileURLToPath \} = await import\('node:url'\);\s*$/,
    /^\s*const cwd = fileURLToPath\(new URL\('\.', import\.meta\.url\)\);\s*$/,
    /^\s*const out = \(result\.stdout \|\| ''\) \+ \(result\.stderr \|\| ''\);\s*$/,
  ],
  headerBare: /^console\.log\((['`])\\n\[([^\]]+)\][^\n]*\1\);\s*$/,   // column 0, the line above the block
  headerIn: /^\s*console\.log\((['`])\\n(?:\[([^\]]+)\]|\$\{label\})[^\n]*\1\);\s*$/,   // indented: inside the block / a table loop
  match: /^\s*const (\w+) = out\.match\(\/(.+)\/(\w*)\);\s*$/,
  ifMatch: /^\s*if \((\w+)\) \{\s*$/,
  close: /^\s*\}\s*$/,
  exit0: /^\s*assert\(result\.status === 0, `[\s\S]*`\);\s*$/,
  present: /^\s*assert\(!!(\w+), /,
  // the one-assertion shape: summary printed AND verdict AND zero failed AND floor, in ONE assert (→ the 'strict-single' preset)
  single: /^\s*assert\(!!(\w+) && \1\[(\d)\] === '([^']*)' && Number\(\1\[(\d)\]\) === 0 && Number\(\1\[(\d)\]\) >= (\w+|\d+), `([\s\S]*)`\);\s*$/,
  forbid: /^\s*assert\(!\/(.+)\/(\w*)\.test\(out\), (['`])([\s\S]*)\3\);\s*$/,
  verdict: /^\s*assert\((\w+)\[(\d)\] === '([^']*)'( && Number\(\1\[(\d)\]\) === 0)?, /,
  failedZero: /^\s*assert\(Number\((\w+)\[(\d)\]\) === 0, /,
  floor: /^\s*assert\(Number\((\w+)\[(\d)\]\) >= (\w+|\d+), `([\s\S]*)`\);\s*$/,
  comment: /^\s*\/\//,
  blank: /^\s*$/,
};

function sha(s) { return createHash('sha256').update(s).digest('hex').slice(0, 16); }

/**
 * Hand-reviewed blocks that carry one extra hygiene check (a scratch file must not survive the run).
 * `fingerprint` pins the exact residual text that was reviewed; a changed block must be re-read by a human.
 */
export const HYGIENE_OVERRIDES = {
  'authstoragenativetest.mjs': {
    fingerprint: '3536df88fa3a65d0',
    post: [{
      kind: 'noLeaked', dir: 'js',
      names: ['__mutation_scratch_auth_storage_native.js', '__mutation_scratch_auth.js'],
      label: "authstoragenativetest.mjs's mutation scratch files were cleaned up (nothing leaked into js/)",
    }],
  },
  'pushnativetest.mjs': {
    fingerprint: '0304341565b5fd94',
    post: [{
      kind: 'noLeaked', dir: '$TMPDIR', pattern: '^push-native\\.pre-mutation\\.',
      label: "pushnativetest.mjs's mutation scratch file was cleaned up (nothing leaked into its TMPDIR)",
    }],
  },
};

function residualFingerprint(lines) { return sha(lines.map(l => l.trim()).filter(Boolean).join('\n')); }

export function slugArgs(args) { return args.map(a => String(a).replace(/^-+/, '').replace(/[^A-Za-z0-9]+/g, '-')).join('-'); }

export function suiteIdFor(script, args = [], env = null) {
  const base = script.split('/').pop().replace(/\.mjs$/, '');
  const withArgs = args.length ? `${base}-${slugArgs(args)}` : base;
  // a fixed-zone re-run of the same script is a different suite (its own manifest, its own floor line in the legacy log)
  return env && env.TZ ? `${withArgs}-tz-${slugArgs([env.TZ])}` : withArgs;
}

function parseSpawnArgs(argText, tableVar) {
  const items = argText.split(',').map(s => s.trim()).filter(Boolean);
  if (!items.length) throw new Error('spawnSync with no script');
  return items.map(it => {
    if (/^'[^']*'$/.test(it)) return it.slice(1, -1);
    if (it === 'file' && tableVar) return { var: 'file' };
    throw new Error(`unrecognised spawn argument ${it}`);
  });
}

/** An `assert(` that continues onto the next line(s) is one statement: join it (a continuation ends at a line ending `);`). */
function logicalLines(raw) {
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    let l = raw[i];
    if (/^\s*assert\(/.test(l) && !/\);\s*$/.test(l)) {
      let j = i + 1;
      while (j < raw.length && !/\);\s*$/.test(raw[j])) j++;
      if (j < raw.length) { l = raw.slice(i, j + 1).map(x => x.trim()).join(' '); i = j; }
    }
    out.push(l);
  }
  return out;
}

const MIXED_SINGLE = 'the block asserts its summary as ONE combined assertion AND as separate ones — an unrecognised mix (the runner would make a different number of checks)';

const isSpawnLine = l => /spawnSync\(process\.execPath/.test(l) && !RE.comment.test(l);

/**
 * Find every legacy spawned-suite block in `src`.
 * Returns { entries, regions, errors, notes }:
 *   entries  — manifest drafts (extractor-owned fields only)
 *   regions  — [{ start, end, kind, firstLine }] zero-based inclusive line ranges to strip (header + block + the comment directly above)
 *   errors   — human-readable, each naming a loadtest.mjs line; non-empty ⇒ the caller must refuse
 *   notes    — loop-level comments, keyed by the loop's first suite id
 */
export function extractLegacy(src) {
  const lines = src.split('\n');
  const entries = [];
  const regions = [];
  const errors = [];
  const notes = {};
  const sites = [];
  lines.forEach((l, i) => { if (isSpawnLine(l)) sites.push(i); });

  const claimed = new Set();
  for (const i of sites) {
    if (claimed.has(i)) continue;
    try {
      // ── block bounds ─────────────────────────────────────────────────────────────────────────
      let open = i; while (open >= 0 && !/^(\{|for \()/.test(lines[open])) open--;
      let close = i; while (close < lines.length && !/^\}/.test(lines[close])) close++;
      if (open < 0 || close >= lines.length) throw new Error('could not find the enclosing block');
      const isLoop = /^for \(/.test(lines[open]);
      let tableEnd = -1;
      if (isLoop) {
        if (!/^for \(const \[label, file, floor, why\] of \[\s*$/.test(lines[open])) throw new Error(`unrecognised table-loop header: ${lines[open].slice(0, 80)}`);
        tableEnd = open + 1; while (tableEnd < i && !/^\]\) \{\s*$/.test(lines[tableEnd])) tableEnd++;
        if (!/^\]\) \{\s*$/.test(lines[tableEnd])) throw new Error('could not find the end of the suite table (`]) {`)');
      }
      // everything strictly inside must be indented (or the table terminator), so one block == one region
      for (let k = open + 1; k < close; k++) {
        if (isLoop && k === tableEnd) continue;
        if (lines[k] !== '' && !/^\s/.test(lines[k])) throw new Error(`line ${k + 1} is not indented — the block boundary is ambiguous`);
      }
      const bodyStart = isLoop ? tableEnd + 1 : open + 1;
      const body = logicalLines(lines.slice(bodyStart, close));
      for (let k = bodyStart; k < close; k++) if (isSpawnLine(lines[k])) claimed.add(k);
      if (body.filter(isSpawnLine).length !== 1) throw new Error('expected exactly one spawnSync in the block');

      // ── header (console.log) — inside the block, or the line right above it ───────────────────
      let label = null;
      let regionStart = open;
      const innerHeader = body.map(l => RE.headerIn.exec(l)).find(Boolean);
      if (innerHeader) label = innerHeader[2] || null;
      else {
        if (isLoop) throw new Error('table loop has no `console.log(`\\n[${label}] …`)` header');
        const prev = open - 1;
        const hm = prev >= 0 ? RE.headerBare.exec(lines[prev]) : null;
        if (!hm) throw new Error('no `console.log(\'\\n[LABEL] …\')` header found inside the block or on the line above it');
        label = hm[2]; regionStart = prev;
      }
      if (!isLoop && !label) throw new Error('the header does not carry a `[LABEL]`');

      // ── comment directly above the region. A `═══ BEGIN/END …` marker brackets code elsewhere: never swallowed ─
      const above = [];
      let k = regionStart - 1;
      while (k >= 0 && RE.comment.test(lines[k]) && !/═══ (BEGIN|END)\b/.test(lines[k])) { above.unshift(lines[k].replace(/^\s*\/\/ ?/, '').replace(/\s+$/, '')); k--; }
      const commentStart = k + 1;
      const adjacentComment = above.join('\n').trim();

      // ── classify the body line by line ────────────────────────────────────────────────────────
      let spawnArgs = null, timeoutMult = null, tz = null, single = false;
      let matchVar = null, regexSrc = null, regexFlags = '';
      const forbid = [];
      let verdict = null, failedIdx = null, skippedIdx = null, floorRef = null, floorIdx = null, floorNote = '';
      let sawExit = false, sawPresent = false;
      let residual = [];
      for (const l of body) {
        let m;
        if (RE.blank.test(l) || RE.comment.test(l)) continue;
        if ((m = RE.spawn.exec(l))) { spawnArgs = parseSpawnArgs(m[1], isLoop); if (m[2] !== undefined) timeoutMult = Number(m[2]); if (m[3] !== undefined) tz = m[3]; continue; }
        if (RE.boiler.some(r => r.test(l)) || RE.headerIn.test(l)) continue;
        if ((m = RE.match.exec(l))) { matchVar = m[1]; regexSrc = m[2]; regexFlags = m[3]; continue; }
        if (RE.exit0.test(l)) { sawExit = true; continue; }
        if ((m = RE.single.exec(l)) && m[1] === matchVar) {
          if (sawPresent || verdict || failedIdx !== null || floorRef !== null) throw new Error(MIXED_SINGLE);
          sawPresent = true; single = true;
          verdict = { group: Number(m[2]), equals: m[3], combined: true };
          failedIdx = Number(m[4]); floorIdx = Number(m[5]); floorRef = m[6]; floorNote = m[7];
          continue;
        }
        if ((m = RE.present.exec(l)) && m[1] === matchVar) { if (single) throw new Error(MIXED_SINGLE); sawPresent = true; continue; }
        if ((m = RE.forbid.exec(l))) { forbid.push({ regex: m[1], flags: m[2], label: m[4].replace(/\\'/g, "'") }); continue; }
        if ((m = RE.verdict.exec(l)) && m[1] === matchVar) {
          if (single) throw new Error(MIXED_SINGLE);
          verdict = { group: Number(m[2]), equals: m[3], combined: !!m[4] };
          if (m[4]) failedIdx = Number(m[5]);
          continue;
        }
        if ((m = RE.failedZero.exec(l)) && m[1] === matchVar) { if (single) throw new Error(MIXED_SINGLE); if (failedIdx === null) failedIdx = Number(m[2]); else skippedIdx = Number(m[2]); continue; }
        if ((m = RE.floor.exec(l)) && m[1] === matchVar) { if (single) throw new Error(MIXED_SINGLE); floorRef = m[3]; floorIdx = Number(m[2]); floorNote = m[4]; continue; }
        if (RE.ifMatch.test(l) || RE.close.test(l)) continue;
        residual.push(l);
      }
      if (!spawnArgs) throw new Error('no recognisable spawnSync line (the options must be exactly `{ cwd, encoding: \'utf8\', timeout: SPAWNED_SUITE_TIMEOUT_MS }` — an `env:` or any other option would be dropped)');
      if (!sawExit) throw new Error('the block does not assert `result.status === 0`');
      if (!matchVar || !sawPresent) throw new Error('the block does not parse and assert the suite\'s own summary line');
      if (floorRef === null) throw new Error('the block has no `>= floor` assertion');
      if (failedIdx === null) throw new Error('the block does not assert zero failed');

      // a floor may be a numeric constant declared inside the block (`const floor105 = 481;`)
      let floor = null;
      if (/^\d+$/.test(floorRef)) floor = Number(floorRef);
      else if (isLoop && floorRef === 'floor') floor = null;                  // per-entry, from the table
      else {
        const declIdx = residual.findIndex(l => new RegExp(`^\\s*const ${floorRef} = \\d+;\\s*$`).test(l));
        if (declIdx < 0) throw new Error(`floor identifier ${floorRef} is not a numeric constant declared in the block`);
        floor = Number(/= (\d+);/.exec(residual[declIdx])[1]);
        residual = residual.filter((_, ix) => ix !== declIdx);
      }

      const summary = compactSummary({ regex: regexSrc, flags: regexFlags, passed: floorIdx, failed: failedIdx, verdict, skipped: skippedIdx, ...(single ? { single: true } : {}) });
      const script = typeof spawnArgs[0] === 'string' ? spawnArgs[0] : null;
      const env = tz ? { TZ: tz } : null;

      const draft = (file, args, fl, why, comment, lbl) => ({
        script: file, args, label: String(lbl).replace(/^\[|\]$/g, ''), summary, floor: fl,
        ...(forbid.length ? { forbid } : {}),
        ...(timeoutMult !== null ? { timeoutMs: DEFAULT_TIMEOUT_MS * timeoutMult } : {}),
        ...(env ? { env } : {}),
        note: why, comment,
      });

      if (isLoop) {
        if (floorRef !== 'floor') throw new Error('a table loop must assert against its `floor` column');
        if (residual.length) throw new Error(`table-loop body carries statements the extractor cannot carry across:\n      ${residual.map(r => r.trim().slice(0, 140)).join('\n      ')}`);
        const tab = scanTable(lines.slice(open + 1, tableEnd).join('\n'));
        if (!tab.length) throw new Error('empty suite table');
        tab.forEach((t, idx) => {
          entries.push(draft(t.file, spawnArgs.slice(1), t.floor, t.why, t.comment, t.label));
          if (idx === 0 && adjacentComment) notes[suiteIdFor(t.file, spawnArgs.slice(1), env)] = adjacentComment;
        });
      } else {
        const d = draft(script, spawnArgs.slice(1), floor, floorNote, adjacentComment, label);
        if (residual.length) {
          const ov = HYGIENE_OVERRIDES[script];
          const fp = residualFingerprint(residual);
          if (!ov) throw new Error(`block carries statements the extractor cannot carry across (and there is no reviewed override for ${script}):\n      ${residual.map(r => r.trim().slice(0, 140)).join('\n      ')}`);
          if (ov.fingerprint !== fp) throw new Error(`the hygiene override for ${script} is STALE: its block changed (fingerprint ${fp}, reviewed ${ov.fingerprint}). Re-read the block and update HYGIENE_OVERRIDES deliberately.`);
          d.post = ov.post;
        } else if (HYGIENE_OVERRIDES[script]) {
          throw new Error(`${script} is expected to carry a hygiene check (a leaked scratch file) but its block has none — a check was removed; restore it or update HYGIENE_OVERRIDES deliberately`);
        }
        entries.push(d);
      }
      regions.push({ start: commentStart, end: close, kind: isLoop ? 'table' : 'block', firstLine: open + 1 });
    } catch (e) {
      errors.push(`loadtest.mjs:${i + 1}: ${e.message}`);
    }
  }
  return { entries, regions, errors, notes };
}

/** Remove the claimed regions from `src` (descending, so indexes stay valid). */
export function stripRegions(src, regions) {
  const lines = src.split('\n');
  const sorted = [...regions].sort((a, b) => b.start - a.start);
  for (const r of sorted) {
    lines.splice(r.start, r.end - r.start + 1);
    // the removal can leave two blank lines facing each other at the join; keep one
    while (r.start > 0 && r.start < lines.length && lines[r.start - 1].trim() === '' && lines[r.start].trim() === '') lines.splice(r.start, 1);
  }
  return lines.join('\n');
}

export const CORE_GUARD_MARK = '// ── TIERED RUNNER GUARD (docs/TESTING.md) ─';
export const CORE_LOAD_MARK = '// ── CFBP_CORE=load (docs/TESTING.md) ─';

/** The guard that makes `node loadtest.mjs` keep meaning "the full harness" while the spawned suites live in tests/suites/. */
export function coreGuardSource() {
  return `${CORE_GUARD_MARK}─────────────────────────────────────────────────────────────
// \`node loadtest.mjs\` is still THE full harness (deploy.sh Gate 1 runs exactly this). The standalone
// suites it used to spawn one after another now live as one manifest each in tests/suites/ and run in
// parallel under testrun.mjs; THIS FILE IS THE CORE SUITE (module-load smoke + every inline section).
// testrun.mjs launches it with CFBP_CORE=full (everything) or CFBP_CORE=load (section [1] only, the
// --quick tier). Run bare, it delegates to the runner, so a human or deploy.sh typing the old command
// gets the whole sweep — never just the core, which would read as a pass it is not.
{
  const { spawnSync: spawnTestrun } = await import('node:child_process');
  const { fileURLToPath: toPathTestrun } = await import('node:url');
  if (!process.env.CFBP_CORE) {
    const r = spawnTestrun(process.execPath, [toPathTestrun(new URL('./testrun.mjs', import.meta.url)), '--full', ...process.argv.slice(2)], { stdio: 'inherit' });
    process.exit(r.status === null ? 1 : r.status);
  }
}
`;
}

export function coreLoadStopSource() {
  return `${CORE_LOAD_MARK}──────────────────────────────────────────────────────────────
// --quick tier: stop after section [1] (every js/ module imports cleanly) and print the same summary line.
if (process.env.CFBP_CORE === 'load') {
  console.log(\`\\n\${'═'.repeat(50)}\\n\${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — \${pass} passed, \${fail} failed\\n\`);
  // same flush-then-exit shim as the end of this file (reviewer F3 / security F-6): a bare exit can drop the summary line off a pipe
  process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
  setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
  await new Promise(() => {});    // park here: the callbacks above exit the process, and nothing below may run in load mode
}
`;
}

/** The leftover F8 timeout comment/const are dead once nothing spawns from here. */
const F8_START = '/**\n * ══ REVIEWER F8 (sixth gate, 2026-09-17)';
const F8_END = 'const SPAWNED_SUITE_TIMEOUT_MS = 300000;\n';

/**
 * Turn the legacy harness into the core: strip regions, drop the dead F8 constant, add the guard + the load-stop.
 * Idempotent: a source that already carries the guard keeps exactly one.
 */
export function buildCore(src, regions) {
  let out = stripRegions(src, regions);
  const f8 = out.indexOf(F8_START);
  if (f8 >= 0) {
    const e = out.indexOf(F8_END, f8);
    if (e >= 0) {
      out = out.slice(0, f8)
        + '// Spawned-suite timeouts (reviewer F8, 2026-09-17: a hung child must FAIL, not hang) moved to testrun.mjs with the suites:\n'
        + '// every manifest carries a deadline (default 300000 ms) and the runner kills the whole process group when it passes.\n'
        + out.slice(e + F8_END.length);
    }
  }
  if (!out.includes(CORE_GUARD_MARK)) {
    const anchor = "import { readFile, readdir } from 'node:fs/promises';\n";
    const at = out.indexOf(anchor);
    if (at < 0) throw new Error("loadtest.mjs: could not find the `import { readFile, readdir } from 'node:fs/promises';` anchor for the runner guard");
    out = out.slice(0, at + anchor.length) + '\n' + coreGuardSource() + out.slice(at + anchor.length);
  }
  if (!out.includes(CORE_LOAD_MARK)) {
    const h = out.indexOf("console.log('\\n[1] Importing all modules…');");
    if (h < 0) throw new Error('loadtest.mjs: could not find the section [1] header for the CFBP_CORE=load stop');
    const lines = out.split('\n');
    const hLine = out.slice(0, h).split('\n').length - 1;
    let k = hLine + 1; while (k < lines.length && lines[k] !== '}') k++;
    if (k >= lines.length) throw new Error('loadtest.mjs: could not find the end of the section [1] import loop');
    lines.splice(k + 1, 0, '', ...coreLoadStopSource().trimEnd().split('\n'));
    out = lines.join('\n');
  }
  return out;
}

/** Cheap detector used by the runner: does this loadtest.mjs still register spawned suites the old way? */
export function legacyBlockCount(src) {
  return src.split('\n').filter(isSpawnLine).length;
}
