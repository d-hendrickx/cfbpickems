/**
 * tests/lib/manifest.mjs — load and validate tests/suites/*.json, and the hard denylist.
 *
 * A manifest is one suite. The schema is closed: an unknown key is an ERROR (a typo like "flor"
 * would otherwise silently drop the ratchet), a manifest that names a missing script is an ERROR, and
 * a manifest that names a denied script is an ERROR — nothing here is ever "skipped with a warning".
 */

import { readdirSync, readFileSync, existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { resolveSummary, DEFAULT_TIMEOUT_MS } from './extract.mjs';
import { listRepoFiles, globToRegExp } from './depmap.mjs';

/**
 * Scripts the runner must NEVER execute, whatever a manifest says (CLAUDE.md prohibited moves: they auto-load real
 * credentials from supabase/tests/.env*, or read the live project). Matched on the basename of the script AND of every
 * argument, after normalisation, so `./supabase/tests/./rls.test.mjs`, `x/../rls.test.mjs` and an argument that names one
 * are all refused. They are Drew's to run by hand.
 */
export const DENYLIST = ['rls.test.mjs', 'import-backup.mjs', 'export-sheet.mjs', 'projectiontest.mjs'];

export function denied(nameOrPath) {
  // lower-cased: APFS is case-insensitive by default, so `node RLS.test.mjs` would happily run rls.test.mjs
  const base = path.posix.basename(path.posix.normalize(String(nameOrPath).replace(/\\/g, '/'))).toLowerCase();
  return DENYLIST.includes(base);
}

/**
 * The files themselves (reviewer N6, 2026-10-07): a name check alone lets `alias.mjs -> supabase/tests/rls.test.mjs` (a symlink) or a hard
 * link of it run the real script under another name — and Node resolves a symlinked entry point to its real path, so it would even find the
 * real .env beside it. So a path is also denied when its REAL path's name is on the list, or when it IS (same device + inode) a denylisted
 * file found under `root`.
 */
const identityCache = new Map();
function deniedIdentities(root) {
  if (identityCache.has(root)) return identityCache.get(root);
  const ids = new Set();
  const walk = (dir, depth) => {
    let ents; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < 12) walk(full, depth + 1); }
      else if (e.isFile() && DENYLIST.includes(e.name.toLowerCase())) { try { const st = statSync(full); ids.add(`${st.dev}:${st.ino}`); } catch { /* vanished */ } }
    }
  };
  walk(root, 0);
  identityCache.set(root, ids);
  return ids;
}
export function deniedFile(abs, root = null) {
  if (denied(abs)) return true;
  try { if (denied(realpathSync(abs))) return true; } catch { /* missing: the name check above is all there is */ }
  if (root) { try { const st = statSync(abs); if (deniedIdentities(root).has(`${st.dev}:${st.ino}`)) return true; } catch { /* missing */ } }
  return false;
}

/** Throws if the script or any arg names a denied file — by name, by real path, or by identity when `cwd` is known. Called at manifest load, at plan time AND at spawn time. */
export function assertNotDenied(script, args = [], { cwd = null } = {}) {
  for (const x of [script, ...args]) {
    if (denied(x) || (cwd && deniedFile(path.resolve(cwd, x), cwd))) throw new Error(`REFUSED: "${x}" is on the runner's hard denylist (${DENYLIST.join(', ')}) — by name, real path or identity; those scripts auto-load real credentials and are Drew's to run by hand`);
  }
}

export const KNOWN_TAGS = ['smoke', 'quick', 'browser', 'slow', 'tz'];   // tz: date/time-sensitive — the second-zone pass (--tz) runs only these
export const KNOWN_KEYS = new Set(['id', 'kind', 'script', 'args', 'label', 'summary', 'floor', 'forbid', 'timeoutMs', 'tags', 'isolate', 'deps', 'affectedByDepsOnly', 'post', 'env', 'expectedMs', 'note', 'comment']);
/**
 * M-43 (Drew, 2026-10-14, D-76): the only suites whose --affected selection may be held to their own deps ("affectedByDepsOnly"). On any other
 * suite one manifest line would quietly shrink --affected runs (review B1). Widening this list edits a runner file, so it stops --affected and
 * comes to review.
 */
export const HELD_SUITES = ['testruntest'];
const repoFilesCache = new Map();
const repoFiles = root => { if (!repoFilesCache.has(root)) repoFilesCache.set(root, listRepoFiles(root)); return repoFilesCache.get(root); };
const FORBID_KEYS = new Set(['regex', 'flags', 'label']);
const POST_KINDS = new Set(['noLeaked']);

/** Validate one parsed manifest. Returns an array of problems (empty ⇒ valid). */
export function validateManifest(m, file, { cfbDir = null, checkExists = true } = {}) {
  const errs = [];
  const at = `${file}`;
  if (!m || typeof m !== 'object' || Array.isArray(m)) return [`${at}: not a JSON object`];
  for (const k of Object.keys(m)) if (!KNOWN_KEYS.has(k)) errs.push(`${at}: unknown key "${k}" (a typo here would silently weaken the suite — the schema is closed)`);
  const expectId = path.basename(file).replace(/\.json$/, '');
  if (m.id !== expectId) errs.push(`${at}: "id" must equal the file name (${expectId}), got ${JSON.stringify(m.id)}`);
  if (m.kind !== undefined && !['suite', 'core'].includes(m.kind)) errs.push(`${at}: kind must be "suite" or "core"`);
  if (typeof m.script !== 'string' || !m.script) errs.push(`${at}: "script" is required`);
  else {
    if (path.isAbsolute(m.script) || m.script.split('/').includes('..')) errs.push(`${at}: "script" must be a path inside cfb-pickems/ (no absolute path, no ..)`);
    if (!/\.mjs$/.test(m.script)) errs.push(`${at}: "script" must be a .mjs file`);
    try { assertNotDenied(m.script, Array.isArray(m.args) ? m.args : [], { cwd: cfbDir }); } catch (e) { errs.push(`${at}: ${e.message}`); }
    if (checkExists && cfbDir && !existsSync(path.join(cfbDir, m.script))) errs.push(`${at}: script ${m.script} does not exist`);
  }
  if (m.args !== undefined && (!Array.isArray(m.args) || m.args.some(a => typeof a !== 'string'))) errs.push(`${at}: "args" must be an array of strings`);
  if (!Number.isInteger(m.floor) || m.floor < 0) errs.push(`${at}: "floor" must be a non-negative integer (the ratchet)`);
  try { resolveSummary(m.summary); } catch (e) { errs.push(`${at}: ${e.message}`); }
  if (m.timeoutMs !== undefined && !(Number.isInteger(m.timeoutMs) && m.timeoutMs > 0)) errs.push(`${at}: "timeoutMs" must be a positive integer`);
  if (m.expectedMs !== undefined && !(Number.isFinite(m.expectedMs) && m.expectedMs >= 0)) errs.push(`${at}: "expectedMs" must be a number`);
  if (m.tags !== undefined) {
    if (!Array.isArray(m.tags)) errs.push(`${at}: "tags" must be an array`);
    else for (const t of m.tags) if (!KNOWN_TAGS.includes(t)) errs.push(`${at}: unknown tag "${t}" (known: ${KNOWN_TAGS.join(', ')})`);
    // a fixed-zone variant's zone IS its identity (its env wins over --tz): tagging it tz would re-run it unchanged and read as a second-zone check
    if (Array.isArray(m.tags) && m.tags.includes('tz') && m.env && typeof m.env === 'object' && m.env.TZ !== undefined) errs.push(`${at}: a fixed-zone manifest (env.TZ) cannot be tagged "tz" — the second-zone pass would not change its zone; tag the base suite instead`);
  }
  if (m.isolate !== undefined && !['none', 'tree'].includes(m.isolate)) errs.push(`${at}: isolate must be "none" or "tree"`);
  if (m.deps !== undefined && (!Array.isArray(m.deps) || m.deps.some(d => typeof d !== 'string'))) errs.push(`${at}: "deps" must be an array of path globs`);
  // M-43 (Drew, 2026-10-14, D-76): --affected selects such a suite only when its own script or a file its "deps" name changes; --full always runs it
  if (m.affectedByDepsOnly !== undefined) {
    if (typeof m.affectedByDepsOnly !== 'boolean') errs.push(`${at}: "affectedByDepsOnly" must be true or false`);
    else if (m.affectedByDepsOnly) {
      if (!HELD_SUITES.includes(m.id)) errs.push(`${at}: "affectedByDepsOnly" is allowed only on ${HELD_SUITES.join(', ')} (D-76): on any other suite it would quietly hold the suite back from the --affected runs that should run it`);
      if (!Array.isArray(m.deps) || !m.deps.length) errs.push(`${at}: "affectedByDepsOnly" needs a non-empty "deps": with it, they (and the script) are the only files that select the suite in --affected`);
      else if (checkExists && cfbDir && Array.isArray(m.deps) && m.deps.every(d => typeof d === 'string')) {
        // review B1: a held dep that matches nothing (a typo such as testrun.mj) would hold the suite back from the very file it meant
        const root = path.resolve(cfbDir, '..');
        const cfbRel = path.relative(root, cfbDir).split(path.sep).join('/');
        const files = repoFiles(root);
        for (const d of m.deps) {
          const re = globToRegExp(path.posix.normalize(path.posix.join(cfbRel, d.replace(/^\.\//, ''))));
          if (!files.some(f => re.test(f))) errs.push(`${at}: "affectedByDepsOnly" dep "${d}" matches no file (relative to cfb-pickems/): a typo here would hold the suite back from the file it meant`);
        }
      }
      for (const t of ['smoke', 'quick']) if (Array.isArray(m.tags) && m.tags.includes(t)) errs.push(`${at}: a suite with "affectedByDepsOnly" cannot be tagged "${t}": the ${t} set runs on every ${t === 'smoke' ? '--affected' : '--quick'} run, whatever changed`);
    }
  }
  if (m.env !== undefined && (typeof m.env !== 'object' || Array.isArray(m.env) || Object.values(m.env).some(v => typeof v !== 'string'))) errs.push(`${at}: "env" must be an object of strings`);
  if (m.forbid !== undefined) {
    if (!Array.isArray(m.forbid)) errs.push(`${at}: "forbid" must be an array`);
    else for (const f of m.forbid) {
      for (const k of Object.keys(f || {})) if (!FORBID_KEYS.has(k)) errs.push(`${at}: forbid entry has unknown key "${k}"`);
      try { new RegExp(f.regex, f.flags || ''); } catch (e) { errs.push(`${at}: forbid regex does not compile: ${e.message}`); }
    }
  }
  if (m.post !== undefined) {
    if (!Array.isArray(m.post)) errs.push(`${at}: "post" must be an array`);
    else for (const p of m.post) if (!p || !POST_KINDS.has(p.kind)) errs.push(`${at}: post entry has an unknown kind ${JSON.stringify(p && p.kind)}`);
  }
  return errs;
}

/** Load every tests/suites/*.json (files starting with `_` are notes, not suites). */
export function loadManifests(suitesDir, { cfbDir = null } = {}) {
  const suites = new Map();
  const errors = [];
  if (!existsSync(suitesDir)) return { suites, errors: [`${suitesDir} does not exist`] };
  const files = readdirSync(suitesDir).filter(f => f.endsWith('.json') && !f.startsWith('_')).sort();
  for (const f of files) {
    let m;
    try { m = JSON.parse(readFileSync(path.join(suitesDir, f), 'utf8')); }
    catch (e) { errors.push(`${f}: not valid JSON (${e.message})`); continue; }
    const errs = validateManifest(m, f, { cfbDir });
    if (errs.length) { errors.push(...errs); continue; }
    suites.set(m.id, normalise(m));
  }
  // two manifests running the same script with the same args would double-count one suite
  const byKey = new Map();
  for (const m of suites.values()) {
    const k = `${m.script}\u0000${(m.args || []).join('\u0000')}\u0000${JSON.stringify(m.env || {})}`;
    if (byKey.has(k)) errors.push(`manifests ${byKey.get(k)} and ${m.id} run the same script with the same args and env`);
    else byKey.set(k, m.id);
  }
  return { suites, errors };
}

/** Fill defaults (the manifest on disk stays minimal). */
export function normalise(m) {
  return {
    kind: 'suite', args: [], tags: [], isolate: 'none', deps: [], env: {}, timeoutMs: DEFAULT_TIMEOUT_MS, forbid: [], post: [],
    ...m,
  };
}
