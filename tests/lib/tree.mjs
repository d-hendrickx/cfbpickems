/**
 * tests/lib/tree.mjs — the tripwire and the private clone.
 *
 * THE PARALLEL HAZARD this exists for (found by profiling, 2026-10-01): two suites — notifytest.mjs and
 * pushnativetest.mjs — prove their mutation checks by gutting a REAL source file in place
 * (js/notify-copy.js, js/notifications.js, backend/notifyServer.mjs, js/push-native.js, …), importing it, and
 * copying it back from a scratch copy; static.check.mjs plants symlinks inside supabase/tests/. Run serially
 * that is safe; run next to a hundred readers of the same files it is a race (a reader sees the gutted file, or a
 * "must not exist" scan sees a scratch sibling).
 *
 * Two defences, because a list of known offenders is only as good as the next author's memory:
 *   1. `isolate: "tree"` in a suite's manifest runs it against a PRIVATE CLONE of the checkout (copy-on-write
 *      where the filesystem supports it), where it may mutate anything it likes;
 *   2. the TRIPWIRE. Every run records (a) the mtime + size of every FILE under the repo root before and after, and
 *      (b) every create/rename event a recursive filesystem watcher sees while the run is going. A file written is a
 *      file written even when it was restored byte-for-byte (the mtime moves); an entry that came and went (a
 *      scratch sibling, a temp-then-rename) leaves no trace in a snapshot but does in the event stream. Anything
 *      found is a FAILURE naming the path, so an un-isolated writer is caught on its first parallel run instead of
 *      flaking once a month.
 *
 * DIRECTORY mtimes are deliberately NOT compared. On this machine the agent harness's own file edits bubble a
 * (whole-second, sometimes delayed) mtime up through every ancestor directory; a directory-mtime tripwire fired on
 * the edits made just BEFORE the run and trained everyone to ignore it (found 2026-10-01, probed in
 * testruntest.mjs [runner-tripwire]).
 *
 * Never reads a `.env*` file: those names are skipped by the snapshot, the watcher and the clone.
 */

import { readdirSync, lstatSync, mkdirSync, cpSync, watch, openSync, readSync, closeSync, constants as fsConstants } from 'node:fs';
import path from 'node:path';

/** Directory / file names never snapshotted and never cloned. `.env*` is matched by prefix below. */
const SKIP_NAMES = new Set(['.git', 'node_modules', '.claude', '.deploy', '.DS_Store', '.testrun']);
export const skipName = n => SKIP_NAMES.has(n) || n.startsWith('.env');

/**
 * Paths (relative to the repo root) owned by the runner itself and excluded from the tripwire: a developer editing the
 * runner during a run is not a suite writing into the tree. Prefix match on posix paths.
 */
export const RUNNER_OWNED = ['cfb-pickems/tests/', 'cfb-pickems/testrun.mjs', 'cfb-pickems/testruntest.mjs'];

function owned(rel) { return RUNNER_OWNED.some(p => rel === p.replace(/\/$/, '') || rel.startsWith(p)); }
const skippedPath = rel => rel.split('/').some(skipName) || owned(rel);

/** Map relPath → "mtimeMs:size" (files) or "d" (directories: presence only — see the header for why not their mtimes). */
export function snapshotTree(root, { extraSkip = () => false } = {}) {
  const snap = new Map();
  const walk = (dir, rel) => {
    let ents;
    try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (skipName(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (owned(r) || extraSkip(r)) continue;
      const full = path.join(dir, e.name);
      let st;
      try { st = lstatSync(full); } catch { continue; }
      if (e.isDirectory()) { snap.set(r + '/', 'd'); walk(full, r); }
      else snap.set(r, `${st.mtimeMs}:${st.size}`);
    }
  };
  walk(root, '');
  return snap;
}

/**
 * PREFLIGHT: can every file in the checkout actually be READ? Found 2026-10-01 on this machine: iCloud evicted working-tree files ("dataless");
 * a sandboxed process reads such a file as EMPTY with no error — a suite then fails mysteriously (or, worse, `--affected` quietly maps nothing).
 * A file whose stat size is positive but whose first byte cannot be read is reported, so the run stops with the real cause instead of a
 * wall of confusing failures. Returns the unreadable relative paths.
 */
export function unreadableFiles(root, { limit = 50 } = {}) {
  const bad = [];
  const buf = Buffer.alloc(1);
  const walk = (dir, rel) => {
    let ents;
    try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (bad.length >= limit) return;
      if (skipName(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full, r); continue; }
      if (!e.isFile()) continue;
      let size = 0;
      try { size = lstatSync(full).size; } catch { continue; }
      if (size === 0) continue;
      let fd = -1;
      try { fd = openSync(full, 'r'); if (readSync(fd, buf, 0, 1, 0) === 0) bad.push(r); }
      catch { bad.push(r); }
      finally { if (fd >= 0) try { closeSync(fd); } catch { /* ignore */ } }
    }
  };
  walk(root, '');
  return bad;
}

const fmt = v => { const m = /^(\d+(?:\.\d+)?):(\d+)/.exec(v || ''); return m ? `${new Date(Number(m[1])).toISOString().slice(11, 23)} ${m[2]}B` : String(v); };

/**
 * A recursive watcher over `root`. `stop()` waits `settleMs` (FSEvents delivers a little late), closes it, and returns the
 * `rename` events (create / remove / rename) that fell on paths worth caring about. Where recursive watching is not
 * supported it returns `supported: false` and no events (the snapshot half still works).
 */
export function watchTree(root, { settleMs = 700, warmupMs = 400 } = {}) {
  const events = [];
  let w = null;
  let supported = true;
  try {
    w = watch(root, { recursive: true, persistent: false }, (type, name) => {
      if (type !== 'rename' || !name) return;
      const rel = String(name).split(path.sep).join('/');
      if (!skippedPath(rel)) events.push(rel);
    });
    w.on('error', () => { supported = false; });
  } catch { supported = false; }
  // FSEvents can deliver the tail of what happened just BEFORE the stream started (an editor's temp-then-rename a moment
  // earlier); events inside the warm-up window belong to the edits that preceded the run, not to a suite, and are dropped.
  const ready = new Promise(r => setTimeout(() => { events.length = 0; r(); }, supported ? warmupMs : 0));
  return {
    ready,
    get supported() { return supported; },
    async stop() {
      await new Promise(r => setTimeout(r, settleMs));
      try { w && w.close(); } catch { /* already closed */ }
      return [...new Set(events)].sort();
    },
  };
}

/**
 * What changed between two snapshots, plus the TRANSIENT entries the event stream saw: a `rename` event on a path that
 * is in neither snapshot is something created and removed again between them.
 */
export function diffSnapshots(before, after, events = []) {
  const changed = [];
  for (const [k, v] of before) {
    if (!after.has(k)) changed.push(`removed ${k}`);
    else if (after.get(k) !== v && v !== 'd') changed.push(`modified ${k}  [${fmt(v)} → ${fmt(after.get(k))}]`);
  }
  for (const k of after.keys()) if (!before.has(k)) changed.push(`added ${k}`);
  for (const rel of events) {
    const present = before.has(rel) || before.has(rel + '/') || after.has(rel) || after.has(rel + '/');
    if (!present) changed.push(`transient ${rel}  (created and removed again during the run)`);
  }
  return [...new Set(changed)].sort();
}

/**
 * Copy the checkout to `dest` (copy-on-write where the filesystem supports it). Excludes git metadata,
 * node_modules, deploy staging, other worktrees and every `.env*`.
 */
export function cloneTree(root, dest) {
  mkdirSync(dest, { recursive: true });
  cpSync(root, dest, {
    recursive: true,
    mode: fsConstants.COPYFILE_FICLONE,
    // only what a checkout holds: directories, regular files, symlinks. A FIFO, socket or device node (reviewer B1 put a named pipe at the
    // root) cannot be copied and is never test input; cpSync would THROW on it, failing the suite for a reason that is not the suite's.
    filter: src => {
      if (src !== root && skipName(path.basename(src))) return false;
      try { const st = lstatSync(src); return st.isDirectory() || st.isFile() || st.isSymbolicLink(); } catch { return true; }
    },
    errorOnExist: false,
    force: true,
  });
  return dest;
}
