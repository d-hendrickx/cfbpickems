/**
 * tests/lib/exec.mjs — run one suite as a child process with a hard deadline, and the worker pool that runs many.
 *
 * Same contract as the legacy `spawnSync(process.execPath, [file], { cwd, encoding: 'utf8', timeout })`:
 * stdout and stderr are captured separately and concatenated stdout-then-stderr (the legacy `out`), a child that
 * outlives its deadline is KILLED and reported as a timeout (a hung child must fail, not hang — reviewer F8,
 * 2026-09-17).
 *
 * THE CHILD WRITES TO FILES, NOT PIPES. Found by a flaky parallel run (2026-10-01): static.check.mjs ends with a bare
 * `process.exit()`, and a Node process that exits while its stdout PIPE still has bytes queued drops them — the
 * summary line (reviewer F3's finding, "both are ASYNCHRONOUS whenever they are a pipe"). The old harness got away with
 * it because spawnSync's parent does nothing but drain. Nine children plus a busy event loop is the case where the tail
 * is lost, and "exit 0, no summary line" is a FALSE FAILURE that reads as a flaky test. A file is written synchronously by
 * the child and read after it exits, so no suite — whatever its exit path — can lose a line, no output can ever back-pressure
 * a suite, and the parent spends no CPU copying bytes.
 *
 * ONE PROCESS GROUP PER RUN (W-22, 2026-10-08). A builder stopping its own run killed another agent's run: the runner sat in its CALLER's
 * process group (shared with the caller and any sibling run) and every suite led a group of its own, so no one handle covered exactly one
 * run; a runner that could not run its handler (SIGKILL) left its suites running; and the only handle left was a name, which matches every
 * agent's run on the machine. Now testrun.mjs starts each run in a fresh session (it leads its own group, see `claimRunGroup`) and the
 * suites stay IN that group (not detached), with what they start (Chromium and its helpers; Chrome's crashpad handler starts a session of its
 * own and exits by itself): `kill -TERM -<pgid>` stops exactly one run, even with SIGKILL. A timeout kills the suite's process TREE (the suite
 * and everything below it); when a suite ends, what it left running dies with it (`reapStrays`); stopping or ending the run sweeps its group.
 * Nothing here ever signals a process by name, or a process outside this run's group.
 */

import { spawn, spawnSync } from 'node:child_process';
import { openSync, closeSync, readFileSync, statSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const LIVE = new Map();            // pid → argv of every live suite child (killed with its tree if the runner itself is stopped)
let RUN_GROUP = null;              // this run's process group, once testrun.mjs has verified it leads one of its own (claimRunGroup)
let hooked = false;

/** The process table: pid, parent pid and process group of every process (ps -A, POSIX). Throws when ps cannot be read. */
export function processTable() {
  const r = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,pgid='], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0 || !r.stdout) throw new Error(`cannot read the process table (ps -A): ${((r.stderr || '') + (r.error ? r.error.message : '')).trim() || `exit ${r.status}`}`);
  return r.stdout.split('\n').map(l => l.trim().split(/\s+/).map(Number)).filter(a => a.length === 3 && a.every(Number.isInteger)).map(([pid, ppid, pgid]) => ({ pid, ppid, pgid }));
}
/** The process group `pid` belongs to (null if it is gone). */
export function groupOf(pid) {
  const row = processTable().find(p => p.pid === pid);
  return row ? row.pgid : null;
}
/** `pid` and every process below it, as of now. */
export function treeOf(pid, table = processTable()) {
  const out = new Set([pid]);
  for (let grew = true; grew;) { grew = false; for (const p of table) if (out.has(p.ppid) && !out.has(p.pid)) { out.add(p.pid); grew = true; } }
  return out;
}
/** Kill a suite and everything it started (its Chromium and the browser's helpers) — by PID, read from the tree under it. */
export function killTree(pid, sig = 'SIGKILL') {
  let pids;
  try { pids = [...treeOf(pid)]; } catch { pids = [pid]; }
  for (const p of pids) { try { process.kill(p, sig); } catch { /* gone */ } }
}
/** Every process in THIS run's group except the runner itself: what a stopped or finished run must not leave behind. */
export function sweepRunGroup(sig = 'SIGKILL') {
  if (RUN_GROUP === null) return;
  let table;
  try { table = processTable(); } catch { for (const pid of LIVE.keys()) { try { process.kill(pid, sig); } catch { /* gone */ } } return; }
  for (const p of table) if (p.pgid === RUN_GROUP && p.pid !== process.pid) { try { process.kill(p.pid, sig); } catch { /* gone */ } }
}
/**
 * What a finished suite left running dies WITH its suite (W-22 review note 8), not when the run ends. Once a suite exits, its leftovers are
 * still in the run's group but their parent is not: the kernel re-parents them outside the run. So a STRAY is a member of this run's group,
 * other than the runner, whose parent is not a member. A live suite's processes never match: the suite's parent is the runner, and every
 * process below it has its parent inside the group. Each stray is killed with the tree below it. Only processes of THIS run's group.
 */
export function reapStrays(sig = 'SIGKILL') {
  if (RUN_GROUP === null) return;
  let table;
  try { table = processTable(); } catch { return; }                         // the run's end still sweeps the whole group
  const members = new Set(table.filter(p => p.pgid === RUN_GROUP).map(p => p.pid));
  for (const p of table) {
    if (p.pgid !== RUN_GROUP || p.pid === process.pid || members.has(p.ppid)) continue;
    for (const q of treeOf(p.pid, table)) if (members.has(q) && q !== process.pid) { try { process.kill(q, sig); } catch { /* gone */ } }
  }
}
/**
 * testrun.mjs calls this once it has verified that it LEADS a process group of its own (a fresh session, started by its launcher). From then
 * on the group IS the run: SIGINT / SIGTERM / SIGHUP, and the run's exit, sweep that group and nothing else.
 */
export function claimRunGroup(pgid) {
  RUN_GROUP = pgid;
  hookExit();
}
function stopRun() {
  if (RUN_GROUP !== null) sweepRunGroup();
  else for (const pid of LIVE.keys()) killTree(pid);
}
function hookExit() {
  if (hooked) return;
  hooked = true;
  process.on('exit', stopRun);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { stopRun(); process.exit(130); });
}

/** Read a captured stream file; a runaway (> maxBytes) is reduced to its head and tail and flagged. */
function readCapture(file, maxBytes) {
  let size = 0;
  try { size = statSync(file).size; } catch { return { text: '', overflow: false }; }
  if (size <= maxBytes) return { text: readFileSync(file, 'utf8'), overflow: false };
  const buf = readFileSync(file);
  const keep = 1024 * 1024;
  return { text: buf.subarray(0, keep).toString('utf8') + `\n… [${size - 2 * keep} bytes omitted] …\n` + buf.subarray(size - keep).toString('utf8'), overflow: true };
}

/**
 * @param rawPrefix  path prefix for the two capture files (`<prefix>.out`, `<prefix>.err`); the caller owns their removal
 * @returns {Promise<{status:number|null, signal:string|null, error:Error|null, timedOut:boolean, stdout:string, stderr:string, ms:number}>}
 */
export function runChild({ node = process.execPath, args, cwd, env, timeoutMs, rawPrefix, maxBytes = 64 * 1024 * 1024 }) {
  hookExit();
  return new Promise(resolve => {
    const t0 = Date.now();
    mkdirSync(path.dirname(rawPrefix), { recursive: true });
    const outFile = `${rawPrefix}.out`, errFile = `${rawPrefix}.err`;
    const outFd = openSync(outFile, 'w'), errFd = openSync(errFile, 'w');
    let timedOut = false, settled = false, spawnError = null;
    let child;
    try {
      // NOT detached: the suite stays in the run's process group, so the run's stop command (kill -TERM -<pgid>) reaches it and its Chromium
      child = spawn(node, args, { cwd, env, stdio: ['ignore', outFd, errFd], detached: false });
    } catch (e) {
      closeSync(outFd); closeSync(errFd);
      resolve({ status: null, signal: null, error: e, timedOut: false, stdout: '', stderr: '', ms: 0 });
      return;
    }
    closeSync(outFd); closeSync(errFd);          // the child holds its own copies
    LIVE.set(child.pid, args);
    const finish = (status, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      LIVE.delete(child.pid);
      if (RUN_GROUP !== null) reapStrays();      // what the suite left running (a Chromium whose suite crashed) dies with it, before the next suite starts
      const o = readCapture(outFile, maxBytes), e = readCapture(errFile, maxBytes);
      resolve({
        status, signal, timedOut,
        error: spawnError || (o.overflow || e.overflow ? new Error(`output exceeded ${maxBytes} bytes — head and tail kept`) : null),
        stdout: o.text, stderr: e.text, ms: Date.now() - t0,
      });
    };
    child.on('error', e => { spawnError = e; finish(null, null); });
    child.on('close', (code, signal) => finish(code, signal));
    const timer = setTimeout(() => { timedOut = true; killTree(child.pid); }, timeoutMs);
  });
}

/**
 * Run `items` through `runOne` with at most `jobs` at once, and at most `browserJobs` of the items flagged `browser`.
 * Items are taken longest-expected-first (LPT) so the slow suites start immediately and the short ones fill the gaps.
 * Returns `[{ item, error }]` for every `runOne` that REJECTED — never swallowed (reviewer B1, 2026-10-07: a silent catch here let
 * a suite whose run threw vanish from a run that then read ✅ ALL PASS). The caller must turn each into a red row.
 */
export async function runPool(items, { jobs, browserJobs, runOne }) {
  const queue = [...items].sort((a, b) => (b.expectedMs || 0) - (a.expectedMs || 0));
  const rejected = [];
  let running = 0, browserRunning = 0;
  await new Promise(resolve => {
    const pump = () => {
      while (running < jobs) {
        const i = queue.findIndex(t => !(t.browser && browserRunning >= browserJobs));
        if (i < 0) break;
        const t = queue.splice(i, 1)[0];
        running++; if (t.browser) browserRunning++;
        Promise.resolve().then(() => runOne(t)).catch(error => { rejected.push({ item: t, error }); }).finally(() => {
          running--; if (t.browser) browserRunning--;
          pump();
        });
      }
      if (!queue.length && running === 0) resolve();
    };
    pump();
  });
  return rejected;
}
