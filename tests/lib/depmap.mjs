/**
 * tests/lib/depmap.mjs — the auto-generated dependency map behind `--affected`.
 *
 * For every suite: which repo files can change its result? Built from
 *   1. the suite script itself and every file it imports, transitively (static `import … from`, `export … from`,
 *      `import('…')` with a literal specifier, and `import('./x/${name}.js')` read as the glob `./x/*.js`);
 *   2. every repo path the suite (and each test helper it imports) NAMES in a string literal — the files it reads
 *      with readFile/readFileSync/new URL(…, import.meta.url)/path.join(…): a literal that carries a recognised file
 *      extension is resolved against the suite's directory, cfb-pickems/, and the repo root, and a bare file name
 *      (`'push-native.js'`, as in `path.join(__dirname, 'js', 'push-native.js')`) matches every checked-in file with
 *      that name — over-approximating is the safe direction: it can only run MORE suites;
 *   3. a directory literal (`'js'`, `'./js/'`, `'supabase/migrations'`) in a file that also reads directories
 *      (readdir/walk/glob) ⇒ the whole subtree;
 *   4. the manifest's own `deps` globs, for anything a static scan cannot see.
 * Application modules (js/*.js) contribute their imports only, never their comments' path mentions.
 *
 * The map can UNDER-approximate (a path built at run time from pieces no literal spells out). Three nets:
 * the manifest `deps`; the rule that a changed file mapping to NO suite sends `--affected` to `--full`; and
 * `testrun.mjs --check-deps`, which traces what every suite really reads and fails if the map misses any of it.
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

const SKIP = new Set(['.git', 'node_modules', '.claude', '.deploy', '.DS_Store', '.testrun']);
const skip = n => SKIP.has(n) || n.startsWith('.env');
const FILE_EXT = /\.(?:js|mjs|css|html|json|sql|gs|md|swift|svg|plist|toml|txt|xcprivacy|entitlements|csv|png|webmanifest|ts|numbers|rtf)$/i;

/** Every checked-in-looking file under root, as posix paths relative to it. */
export function listRepoFiles(root) {
  const out = [];
  const walk = (dir, rel) => {
    let ents; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (skip(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else out.push(r);
    }
  };
  walk(root, '');
  return out;
}

/** Glob → RegExp over posix paths: `**` crosses `/`, `*` does not. */
export function globToRegExp(glob) {
  let s = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { s += '.*'; i++; if (glob[i + 1] === '/') i++; }
      else s += '[^/]*';
    } else if ('.+?^${}()|[]\\'.includes(c)) s += '\\' + c;
    else s += c;
  }
  return new RegExp(`^${s}$`);
}

const STRING_LITERAL = /(['"`])((?:\\[\s\S]|(?!\1)[^\\\n])*?)\1/g;
// `from '…'` anywhere (an import / export list may span lines and carry comments with quotes in them — a stricter pattern missed
// app.js's data-provider/chat-ui/scribeAgent edges), and a bare side-effect `import '…'`. A mention inside a comment or a string can only add
// a dependency that resolves to a real file, i.e. over-approximate.
const IMPORT_FROM = /(?:\bfrom|\bimport)\s+(['"])([^'"\n]+)\1/g;
const IMPORT_CALL = /\bimport\(\s*(['"`])([^'"`\n]+)\1\s*\)/g;
const URL_CALL = /new URL\(\s*(['"`])([^'"`\n]+)\1\s*,\s*import\.meta\.url\s*\)/g;
const READS_DIRS = /\b(?:readdir|readdirSync|opendir|walk|glob)\b|\bcp(?:Sync)?\(/;     // listing a directory, or copying a whole one (cp reads every file under it)

/**
 * @param {object} o
 * @param {string} o.root        repo root (parent of cfb-pickems/)
 * @param {string} o.cfbDir      absolute path of cfb-pickems/
 * @param {Map<string,object>} o.suites  normalised manifests
 * @param {string[]} [o.files]   override the file list (tests)
 * @returns {Map<string, {files:Set<string>, globs:string[], named:Set<string>}>}  suite id → deps (repo-relative posix paths). `named` is the
 *   subset of `files` the suite reaches by NAME — its script, an import, a literal path or bare file name, a wildcard-free manifest dep —
 *   never through a glob or a directory walk (W-22: the suites that read loadtest.mjs itself, as opposed to every file beside it)
 */
export function buildDepMap({ root, cfbDir, suites, files = null }) {
  const all = files || listRepoFiles(root);
  const allSet = new Set(all);
  const byBase = new Map();
  for (const f of all) { const b = f.split('/').pop(); if (!byBase.has(b)) byBase.set(b, []); byBase.get(b).push(f); }
  const cfbRel = path.relative(root, cfbDir).split(path.sep).join('/');
  const dirs = new Set();
  for (const f of all) { let d = path.posix.dirname(f); while (d && d !== '.' && !dirs.has(d)) { dirs.add(d); d = path.posix.dirname(d); } }
  const dirsBySuffix = new Map();           // 'migrations' → ['cfb-pickems/supabase/migrations'], 'supabase/migrations' → […]
  for (const d of dirs) { const parts = d.split('/'); for (let i = 0; i < parts.length; i++) { const k = parts.slice(i).join('/'); if (!dirsBySuffix.has(k)) dirsBySuffix.set(k, []); dirsBySuffix.get(k).push(d); } }

  const textCache = new Map();
  // a file that cannot be read (or reads as EMPTY although it has a size: an iCloud-evicted "dataless" file) must stop the scan —
  // mapping its imports as "none" would make `--affected` quietly select too little
  const read = rel => {
    if (!textCache.has(rel)) {
      const full = path.join(root, rel);
      let text;
      try { text = readFileSync(full, 'utf8'); }
      catch (e) { if (e.code === 'ENOENT') text = ''; else throw new Error(`dependency scan: cannot read ${rel} (${e.code || e.message})`); }
      if (text === '' && statSync(full, { throwIfNoEntry: false })?.size > 0) throw new Error(`dependency scan: ${rel} reads as empty although it is not (an iCloud-evicted "dataless" file?) — make it local and re-run`);
      textCache.set(rel, text);
    }
    return textCache.get(rel);
  };

  const resolveRel = (fromRel, spec) => {
    if (!spec.startsWith('.')) return null;
    const p = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
    if (allSet.has(p)) return p;
    for (const ext of ['.js', '.mjs', '/index.js']) if (allSet.has(p + ext)) return p + ext;
    return null;
  };

  /** Candidate repo files named by a string literal (or a glob when it carries a ${…} hole). `named` collects the exact (non-glob) hits. */
  const resolveLiteral = (fromRel, lit, out, globs, named) => {
    if (!lit || lit.length > 300) return;
    const hasHole = /\$\{[^}]*\}/.test(lit);
    const text = lit.replace(/\$\{[^}]*\}/g, '*');
    if (!FILE_EXT.test(text.replace(/[?#].*$/, '')) && !/\*/.test(text)) return;
    const clean = text.replace(/[?#].*$/, '');
    const tries = [];
    const fromDir = path.posix.dirname(fromRel);
    const cands = [path.posix.normalize(path.posix.join(fromDir, clean)), path.posix.normalize(clean.replace(/^\.\//, '')), path.posix.normalize(path.posix.join(cfbRel, clean.replace(/^\.\//, '')))];
    for (const c of cands) tries.push(c.replace(/^\/+/, ''));
    let hit = false;
    for (const t of tries) {
      if (/\*/.test(t)) {
        if (!hasHole && !/[*]/.test(clean)) continue;
        const re = globToRegExp(t);
        for (const f of all) if (re.test(f)) { out.add(f); hit = true; }
        if (hit) globs.push(t);
      } else if (allSet.has(t)) { out.add(t); named.add(t); hit = true; }
    }
    if (!hit && !/[\/]/.test(clean.replace(/^\.\//, ''))) {     // a bare file name (path.join(__dirname, 'js', 'x.js'))
      for (const f of byBase.get(clean) || []) { out.add(f); named.add(f); hit = true; }
    }
    if (!hit) {                                                  // a path whose directory part differs (`js/x.js` joined under a different base)
      const base = clean.split('/').pop();
      if (!/\*/.test(base) && base) for (const f of byBase.get(base) || []) if (f.endsWith('/' + clean.replace(/^(\.\.?\/)+/, '')) || f === clean.replace(/^(\.\.?\/)+/, '')) { out.add(f); named.add(f); hit = true; }
    }
  };

  const scanFile = (rel, scanPaths, out, globs, queue, seen, named) => {
    const text = read(rel);
    if (!text) return;
    let m;
    for (const re of [IMPORT_FROM, IMPORT_CALL, URL_CALL]) {
      re.lastIndex = 0;
      while ((m = re.exec(text))) {
        const spec = m[2];
        if (re === URL_CALL) { resolveLiteral(rel, spec, out, globs, named); continue; }
        if (/\$\{[^}]*\}/.test(spec)) { resolveLiteral(rel, spec, out, globs, named); continue; }
        const r = resolveRel(rel, spec);
        if (r) { out.add(r); if (/\.m?js$/.test(r) && !seen.has(r)) { seen.add(r); queue.push(r); } }
        if (r) named.add(r);
      }
    }
    if (scanPaths) {
      const readsDirs = READS_DIRS.test(text);
      STRING_LITERAL.lastIndex = 0;
      while ((m = STRING_LITERAL.exec(text))) {
        const lit = m[2];
        resolveLiteral(rel, lit, out, globs, named);
        if (readsDirs) {
          const d = lit.replace(/^(\.\.?\/)+/, '').replace(/^\.\//, '').replace(/\/+$/, '');
          if (d.length >= 2 && !/[\s*$`]/.test(d)) {
            for (const cand of dirsBySuffix.get(d) || []) { for (const f of all) if (f.startsWith(cand + '/')) out.add(f); globs.push(cand + '/**'); }
          }
        }
      }
    }
  };

  const result = new Map();
  for (const [id, man] of suites) {
    const out = new Set();
    const globs = [];
    const scriptRel = path.posix.join(cfbRel, man.script);
    out.add(scriptRel);
    const named = new Set([scriptRel]);
    const seen = new Set([scriptRel]);
    const queue = [scriptRel];
    // a wildcard-free `.js` / `.mjs` entry in a manifest's deps is an IMPORT ROOT, not just a file: a suite that serves the app to a browser
    // depends on js/app.js and everything app.js loads, not on every file in js/ (a module nothing imports yet cannot change what the page does)
    for (const g of man.deps || []) {
      const resolved = path.posix.normalize(path.posix.join(cfbRel, g.replace(/^\.\//, '')));
      if (!/[*?]/.test(resolved) && /\.m?js$/.test(resolved) && allSet.has(resolved) && !seen.has(resolved)) { seen.add(resolved); out.add(resolved); named.add(resolved); queue.push(resolved); }
    }
    // the script and the test helpers it pulls in are scanned for the paths they NAME; app modules contribute only their imports
    while (queue.length) {
      const f = queue.shift();
      const isHelper = f === scriptRel || /(^|\/)(tests?|supabase\/tests)\//.test(f) || /^[^/]+\/[^/]+\.mjs$/.test(f);
      scanFile(f, isHelper, out, globs, queue, seen, named);
    }
    // the script's own comments name files it only discusses; a literal's resolution already covers the ones it reads.
    for (const g of man.deps || []) {                       // manifest globs are relative to cfb-pickems/ (`../docs/**` reaches the repo root)
      const resolved = path.posix.normalize(path.posix.join(cfbRel, g.replace(/^\.\//, '')));
      const re = globToRegExp(resolved);
      for (const f of all) if (re.test(f)) out.add(f);
      if (!/[*?]/.test(resolved) && allSet.has(resolved)) named.add(resolved);
      globs.push(resolved);
    }
    // M-43 (D-76): "affectedByDepsOnly" holds the suite's --affected selection to its script and its own deps (the map above stays whole)
    const gate = man.affectedByDepsOnly ? [...new Set([scriptRel, ...(man.deps || []).map(g => path.posix.normalize(path.posix.join(cfbRel, g.replace(/^\.\//, ''))))])] : null;
    result.set(id, { files: out, globs: [...new Set(globs)], named, ...(gate ? { gate } : {}) });
  }
  return result;
}

/** Changed paths that no suite can be affected by (documents and scratch). Checked AFTER the map: a mapped doc still maps. */
export const DEFAULT_INERT = ['docs/**', '**/*.md', 'weekly bug fixes and feedback/**', 'New Feature Prompt', 'historical data/**', 'reveal-launch 3/**', '.claude/**', 'CLAUDE.md', '.gitignore', 'cfb-pickems/tests/suites/_*'];

/** Paths whose change means "the runner itself changed": every suite is suspect. */
export const RUNNER_PATHS = ['cfb-pickems/testrun.mjs', 'cfb-pickems/tests/lib/**', 'cfb-pickems/tests/extract-suites.mjs', 'cfb-pickems/loadtest.mjs'];

/** The core harness, and the suite that runs only its section [1] (every js/ module imports cleanly, RG-03). */
export const LOADTEST = 'cfb-pickems/loadtest.mjs';
export const CORE_LOAD = 'core-load';

// W-22 (2026-10-08): loadtest.mjs is the core harness AND the list every new module must join (section [1]), so "loadtest.mjs changed ⇒
// --full" sent every module-adding branch to the full run. An edit CONFINED to that list is recognised here; anything else stays full.
const LIST_HEADER = /\[1\] Importing all modules/;
const LIST_OPEN = /^\s*for \(const m of \[/;                   // the line that opens the list (it carries the first entries)
const LIST_CLOSE = /^\s*\]\) \{\s*$/;                          // the first `]) {` after it closes the list
const NAME = `(?:'[\\w./-]+'|"[\\w./-]+")`;
// a line of the list: module-name strings and commas, then at most a `//` comment. Nothing that can run (a spread, a call, a template, a block comment).
const LIST_LINE = new RegExp(`^\\s*(?:${NAME}\\s*,\\s*)*(?:${NAME}\\s*)?(?:\\/\\/.*)?$`);
const LIST_NAMES = new RegExp(`^\\s*((?:${NAME}\\s*,?\\s*)*)`);

function findList(lines) {
  const h = lines.findIndex(l => LIST_HEADER.test(l));
  if (h < 0) return null;
  let open = -1;
  for (let i = h + 1; i < lines.length && open < 0; i++) if (LIST_OPEN.test(lines[i])) open = i;
  if (open < 0) return null;
  for (let i = open + 1; i < lines.length; i++) if (LIST_CLOSE.test(lines[i])) return { open, close: i };
  return null;
}

/**
 * Is the change from `baseText` to `headText` (two versions of loadtest.mjs) confined to section [1]'s import list?
 * Yes only when every line up to and including the line that opens the list, and every line from the line that closes it to the end of the
 * file, is unchanged, and every line added or removed inside the list is module-name entries and/or a `//` comment.
 * @returns {{ listOnly: boolean, why: string|null, added: string[], removed: string[] }}  the module names added / removed when listOnly
 */
export function classifyLoadtestEdit(baseText, headText) {
  const no = why => ({ listOnly: false, why, added: [], removed: [] });
  if (typeof baseText !== 'string' || typeof headText !== 'string') return no('there is no base version of loadtest.mjs to compare it with');
  const b = baseText.split('\n'), h = headText.split('\n');
  const lb = findList(b), lh = findList(h);
  if (!lb || !lh) return no(`section [1]'s import list was not found in the ${lb ? 'changed' : 'base'} loadtest.mjs`);
  for (let i = 0; i <= Math.max(lb.open, lh.open); i++) {                      // the head of the file, through the line that opens the list
    if (b[i] !== h[i] || i === Math.max(lb.open, lh.open) && lb.open !== lh.open) return no(`it changed above section [1]'s import list, or on the line that opens it (line ${i + 1})`);
  }
  const tailB = b.length - lb.close, tailH = h.length - lh.close;               // the rest of the file, from the line that closes the list
  for (let k = 1; k <= Math.max(tailB, tailH); k++) {
    if (b[b.length - k] !== h[h.length - k] || k === Math.max(tailB, tailH) && tailB !== tailH) return no(`it changed below section [1]'s import list (line ${Math.max(1, h.length - k + 1)})`);
  }
  const left = new Map();                                       // the lines inside the list, as multisets: what was removed and what was added
  for (const l of b.slice(lb.open + 1, lb.close)) left.set(l, (left.get(l) || 0) + 1);
  const added = [];
  for (const l of h.slice(lh.open + 1, lh.close)) { const n = left.get(l) || 0; if (n) left.set(l, n - 1); else added.push(l); }
  const removed = [...left].flatMap(([l, n]) => Array(n).fill(l));
  const bad = [...added, ...removed].find(l => !LIST_LINE.test(l));
  if (bad !== undefined) return no(`a changed line inside section [1]'s import list is not a module entry or a comment: ${JSON.stringify(bad.trim().slice(0, 80))}`);
  const names = ls => ls.flatMap(l => [...(LIST_NAMES.exec(l) || ['', ''])[1].matchAll(/['"]([\w./-]+)['"]/g)].map(m => m[1]));
  return { listOnly: true, why: null, added: names(added), removed: names(removed) };
}

/**
 * Decide what `--affected` runs.
 * @param {object|null} o.loadtestEdit  classifyLoadtestEdit() of loadtest.mjs against the diff's base, when loadtest.mjs changed (null: unknown ⇒ full)
 * @returns {{ ids: Set<string>, full: boolean, reasons: string[], unmapped: string[], inert: string[], listOnly: string[], held: string[] }}
 *   `held`: suites with "affectedByDepsOnly" that the map reached through a changed file outside their own deps, and that nothing selected
 */
export function selectAffected({ changed, depMap, suites, root, inert = DEFAULT_INERT, runnerPaths = RUNNER_PATHS, strictInert = false, loadtestEdit = null }) {
  const reasons = [];
  const unmapped = [];
  const inertHit = [];
  const listOnly = [];
  const ids = new Set();
  const runnerRes = runnerPaths.map(globToRegExp);
  const inertRes = strictInert ? [] : inert.map(globToRegExp);
  // M-43 (D-76): a held suite counts for a changed file only when that file is its script or one of its own deps. A file only held suites
  // reach therefore maps to NO suite (⇒ the fallback below), never to a suite that is then skipped and leaves the file untested.
  const gates = new Map();
  for (const [id, dep] of depMap) if (dep.gate) gates.set(id, dep.gate.map(globToRegExp));
  const heldBack = (id, f) => gates.has(id) && !gates.get(id).some(r => r.test(f));
  const held = new Set();
  let full = false;
  for (const f of changed) {
    if (f === LOADTEST && loadtestEdit && loadtestEdit.listOnly) {
      // only section [1]'s import list changed: the [1] module load, and every suite that reads loadtest.mjs BY NAME (the core itself, and the
      // suites that pin the list's order). Not every suite that merely globs the directory it sits in. The new module's own diff maps as usual.
      if (suites.has(CORE_LOAD)) ids.add(CORE_LOAD);
      for (const [id, dep] of depMap) if (dep.named && dep.named.has(f)) { if (heldBack(id, f)) held.add(id); else ids.add(id); }
      listOnly.push(f);
      continue;
    }
    if (runnerRes.some(r => r.test(f))) { full = true; reasons.push(f === LOADTEST && loadtestEdit && loadtestEdit.why ? `${f} is not a section-[1]-list-only edit (${loadtestEdit.why}) — every suite is suspect` : `${f} is part of the runner / core harness — every suite is suspect`); continue; }
    let mapped = false;
    // a manifest edit selects the suite it describes
    const mm = /^cfb-pickems\/tests\/suites\/([^/_][^/]*)\.json$/.exec(f);
    if (mm && suites.has(mm[1])) { ids.add(mm[1]); mapped = true; }
    for (const [id, dep] of depMap) {
      if (heldBack(id, f)) { if (dep.files.has(f) || dep.globs.some(g => globToRegExp(g).test(f))) held.add(id); continue; }
      if (dep.files.has(f)) { ids.add(id); mapped = true; continue; }
      for (const g of dep.globs) if (globToRegExp(g).test(f)) { ids.add(id); mapped = true; break; }
    }
    if (!mapped) {
      if (inertRes.some(r => r.test(f))) inertHit.push(f);
      else unmapped.push(f);
    }
  }
  if (unmapped.length) { full = true; reasons.push(`no suite reads ${unmapped.length === 1 ? unmapped[0] : `${unmapped.length} changed files (${unmapped.slice(0, 5).join(', ')}${unmapped.length > 5 ? ', …' : ''})`} — cannot prove they are inert, so the full run is the only safe answer`); }
  return { ids, full, reasons, unmapped, inert: inertHit, listOnly, held: [...held].filter(id => !ids.has(id)).sort() };
}

/**
 * `--check-deps`: which traced reads does a suite's static dependency set NOT cover?
 *  - a path that does not exist is not a dependency on its content (a probe for a file that is absent);
 *  - a FILE must be in the set or under one of its globs;
 *  - a DIRECTORY that was listed / copied / stat'ed is covered when some dependency lives under it, or a glob spans it.
 * @param {string[]} o.traced   repo-relative posix paths (a trailing `/` marks a listed directory)
 */
export function missedByMap({ traced, dep, exists, isDir, scope = '' }) {
  const globRes = dep.globs.map(globToRegExp);
  const literalPrefix = g => g.replace(/\*.*$/, '');
  const missed = [];
  const readFiles = traced.filter(p => !p.endsWith('/'));
  for (const p of traced) {
    const marked = p.endsWith('/');
    const rel = marked ? p.slice(0, -1) : p;
    if (!rel || !exists(rel)) continue;
    if (marked || isDir(rel)) {
      const prefix = rel + '/';
      // a directory OUTSIDE the app tree that was only walked for names (a suite indexing the whole repo) with nothing read beneath it is not a dependency
      if (scope && !prefix.startsWith(scope + '/') && !readFiles.some(f => f.startsWith(prefix))) continue;
      const covered = [...dep.files].some(f => f.startsWith(prefix)) || dep.globs.some(g => literalPrefix(g).startsWith(prefix) || prefix.startsWith(literalPrefix(g)) && /\*\*/.test(g));
      if (!covered) missed.push(prefix);
    } else if (!dep.files.has(rel) && !globRes.some(re => re.test(rel))) missed.push(rel);
  }
  return missed;
}
