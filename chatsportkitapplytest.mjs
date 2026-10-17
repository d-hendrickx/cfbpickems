/**
 * chatsportkitapplytest.mjs — THE W-57 MUTATION KIT STILL APPLIES (S-3)
 * ======================================================================
 * tests/kits/w57-mutants.json is the committed, re-runnable mutation kit of the Locker Room's sport pills (tests/kits/w57-mutate.mjs runs it, about 40 minutes). A kit only protects the item while every
 * mutant still lands: if a later edit moves or rewrites a line a mutant's `old` string names, the mutant silently stops being applicable and the kit quietly stops testing that line. This fast suite is the
 * tripwire — for EVERY mutant: its target file exists, its `old` text occurs EXACTLY ONCE in the live tree, the replacement really differs, every suite it names exists, and it names the RED it is
 * expected to produce (recorded by `--record`). It does not run the mutants.
 *
 * Run: node chatsportkitapplytest.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
function assert(cond, label) { if (cond) { pass++; console.log('  ✅', label); } else { fail++; console.error('  ❌', label); } }

const kit = JSON.parse(readFileSync(join(HERE, 'tests', 'kits', 'w57-mutants.json'), 'utf8'));
console.log(`\n[1] the kit's shape (${kit.length} mutants)…`);
assert(Array.isArray(kit) && kit.length >= 100, `[1a] the kit holds the whole item's mutants (${kit.length} >= 100: the reviewer's, the review delta's and Part 2's)`);
assert(new Set(kit.map((m) => m.id)).size === kit.length, '[1b] every mutant id is unique');
assert(kit.every((m) => typeof m.why === 'string' && m.why.length > 8 && typeof m.file === 'string' && typeof m.old === 'string' && m.old.length > 0 && typeof m.new === 'string' && Array.isArray(m.suites) && m.suites.length > 0), '[1c] every mutant says why, names a file, an old and a new text, and at least one suite');
assert(kit.every((m) => m.old !== m.new), '[1d] no mutant is a no-op (old differs from new)');

console.log('\n[2] every mutant lands exactly once on the live tree, and names its RED…');
const text = new Map();
const read = (f) => { if (!text.has(f)) text.set(f, existsSync(join(HERE, f)) ? readFileSync(join(HERE, f), 'utf8') : null); return text.get(f); };
for (const m of kit) {
  const src = read(m.file);
  const n = src === null ? -1 : src.split(m.old).length - 1;
  assert(n === 1 && m.suites.every((s) => existsSync(join(HERE, s))), `[2] ${m.id}: its old text matches ${n} time(s) in ${m.file} (needs exactly 1) and its suites exist (${m.suites.join(', ')})`);
}
const unrecorded = kit.filter((m) => !(m.red && typeof m.red.suite === 'string' && typeof m.red.label === 'string' && m.red.label.length > 3 && m.suites.includes(m.red.suite)));
assert(unrecorded.length === 0, `[2z] every mutant names the RED it produces — the killing suite (one of its own) and the first failing assertion (missing: ${unrecorded.map((m) => m.id).slice(0, 5).join(', ') || 'none'})`);

console.log(`\n${'='.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
