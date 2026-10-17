/**
 * tests/lib/semaphore.mjs — a counting semaphore of N machine-wide FULL runs, built from slot lock files.
 *
 * Replaces the single `lockf /tmp/cfbp-loadtest.lock` (which serialised every full run on the machine; the queue
 * reached 8–10 runs, ~2 hours). The runs are hermetic now (profiling found only two in-place mutators, isolated by
 * `isolate: "tree"`), so the remaining limit is CPU: each full run uses ~CPUs-1 workers, so two at once is the
 * most a laptop can carry without every browser suite's timing assertions drifting. `--quick` and `--affected`
 * take no slot.
 *
 * A slot is a file created with O_EXCL holding {pid, startedAt, cwd, tier}. A holder that died (SIGKILL, closed
 * terminal) leaves a stale file: a waiter checks `process.kill(pid, 0)`; ESRCH ⇒ the slot is stolen with an atomic
 * rename (only one waiter wins the rename), so a crash can never wedge the machine. Released on exit and on
 * SIGINT/SIGTERM/SIGHUP.
 */

import { openSync, closeSync, writeSync, readFileSync, mkdirSync, renameSync, unlinkSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export const DEFAULT_SLOTS = 2;
export const DEFAULT_SLOT_DIR = '/tmp/cfbp-testrun-slots';

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; }   // EPERM ⇒ it exists, we just may not signal it
}

function readHolder(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

/** Try each slot once. Returns { slot, file } or null. */
export function tryAcquire({ dir = DEFAULT_SLOT_DIR, slots = DEFAULT_SLOTS, info = {} } = {}) {
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < slots; i++) {
    const file = path.join(dir, `slot-${i}.lock`);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const fd = openSync(file, 'wx');
        writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), ...info }));
        closeSync(fd);
        return { slot: i, file };
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        const h = readHolder(file);
        // a half-written file (holder between open and write) reads as null: give it a few seconds before calling it stale
        if (h === null) {
          let age = 0;
          try { age = Date.now() - statSync(file).mtimeMs; } catch { /* vanished: retry */ }
          if (age < 5000) break;
        } else if (alive(h.pid)) break;
        // stale: steal atomically — only one waiter's rename succeeds
        const grave = `${file}.stale.${process.pid}.${Date.now()}`;
        try { renameSync(file, grave); unlinkSync(grave); } catch { /* someone else stole it first */ }
      }
    }
  }
  return null;
}

/** Who holds the slots right now (for the "waiting for…" message). */
export function holders({ dir = DEFAULT_SLOT_DIR, slots = DEFAULT_SLOTS } = {}) {
  const out = [];
  for (let i = 0; i < slots; i++) {
    const file = path.join(dir, `slot-${i}.lock`);
    if (!existsSync(file)) continue;
    const h = readHolder(file);
    if (h && alive(h.pid)) out.push(h);
  }
  return out;
}

export function release(lock) {
  if (!lock) return;
  try {
    const h = readHolder(lock.file);
    if (h && h.pid === process.pid) unlinkSync(lock.file);   // never delete a slot someone else now owns
  } catch { /* already gone */ }
}

/**
 * Wait for a slot. Resolves to the lock. Polls (a lock file has no wakeup); calls onWait(holders) every ~15 s.
 * Releases on process exit and on termination signals.
 */
export async function acquire({ dir = DEFAULT_SLOT_DIR, slots = DEFAULT_SLOTS, info = {}, pollMs = 500, maxWaitMs = 0, onWait = null } = {}) {
  const start = Date.now();
  let lastNote = 0;
  for (;;) {
    const lock = tryAcquire({ dir, slots, info });
    if (lock) {
      const rel = () => release(lock);
      process.once('exit', rel);
      for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(sig, () => { rel(); process.exit(130); });
      lock.waitedMs = Date.now() - start;
      return lock;
    }
    const now = Date.now();
    if (maxWaitMs && now - start > maxWaitMs) throw new Error(`no full-run slot free after ${Math.round((now - start) / 1000)} s (${slots} slots in ${dir})`);
    if (onWait && now - lastNote > 15000) { lastNote = now; onWait(holders({ dir, slots }), now - start); }
    await new Promise(r => setTimeout(r, pollMs));
  }
}

/** Count of OTHER live full runs right now — the runner halves its worker count when it is not alone. */
export function otherRuns({ dir = DEFAULT_SLOT_DIR, slots = DEFAULT_SLOTS } = {}) {
  return holders({ dir, slots }).filter(h => h.pid !== process.pid).length;
}

export function listSlotFiles(dir = DEFAULT_SLOT_DIR) {
  try { return readdirSync(dir).filter(f => f.startsWith('slot-')); } catch { return []; }
}
