/**
 * gdkitapplytest.mjs — THE GAME DAY CONSOLIDATED ROUND'S MUTATION KIT STILL APPLIES (S-3)
 * ========================================================================================
 * tests/kits/gd-consolidated-mutants.json is the committed, re-runnable mutation kit of D1 Lane B's consolidated Game Day round (the Lane A seam swap, the sport pill's Back chip, the DI-592 thread sheet,
 * DI-597 Share to chat); tests/kits/gd-mutate.mjs runs it. A kit protects the item only while every mutant still lands: a later edit that moves a line a mutant's `old` string names would silently
 * retire it. This fast suite is the tripwire (chatsportkitapplytest's shape): for EVERY mutant, its file exists, its `old` text occurs EXACTLY ONCE in the live tree, the replacement differs, its suites
 * exist, it says why, and it names the RED it produced (recorded by `--record`). It does not run the mutants.
 *
 * Run: node gdkitapplytest.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
function assert(cond, label) { if (cond) { pass++; console.log('  ✅', label); } else { fail++; console.error('  ❌', label); } }

const kit = JSON.parse(readFileSync(join(HERE, 'tests', 'kits', 'gd-consolidated-mutants.json'), 'utf8'));
console.log(`\n[1] the kit's shape (${kit.length} mutants)…`);
assert(Array.isArray(kit) && kit.length >= 30, `[1a] the kit holds the round's mutants (${kit.length} >= 30: the seam, the pill, the thread sheet, Share)`);
assert(new Set(kit.map((m) => m.id)).size === kit.length, '[1b] every mutant id is unique');
assert(kit.every((m) => typeof m.why === 'string' && m.why.length > 8 && typeof m.file === 'string' && typeof m.old === 'string' && m.old.length > 0 && typeof m.new === 'string' && Array.isArray(m.suites) && m.suites.length > 0), '[1c] every mutant says why, names its file, its old and new text and at least one suite');
assert(kit.every((m) => m.old !== m.new), '[1d] no mutant is a no-op (old differs from new)');
const groups = ['S', 'P', 'T', 'SH'].map((g) => kit.filter((m) => m.id.startsWith(g + (g === 'S' ? '' : ''))).length);
assert(kit.some((m) => /^S\d/.test(m.id)) && kit.some((m) => /^P\d/.test(m.id)) && kit.some((m) => /^T\d/.test(m.id)) && kit.some((m) => /^SH\d/.test(m.id)), `[1e] all four parts of the round are in it (seam, pill, thread sheet, Share) (${groups.join('/')})`);

console.log('\n[2] every mutant lands exactly once on the live tree, and names its RED…');
const text = new Map();
const read = (f) => { if (!text.has(f)) text.set(f, existsSync(join(HERE, f)) ? readFileSync(join(HERE, f), 'utf8') : null); return text.get(f); };
for (const m of kit) {
  const src = read(m.file);
  const n = src === null ? -1 : src.split(m.old).length - 1;
  assert(n === 1 && m.suites.every((s) => existsSync(join(HERE, s))), `[2] ${m.id}: its old text matches ${n} time(s) in ${m.file} (needs exactly 1) and its suites exist (${m.suites.join(', ')})`);
}
const unrecorded = kit.filter((m) => !(m.red && typeof m.red.suite === 'string' && typeof m.red.label === 'string' && m.red.label.length > 3 && m.suites.includes(m.red.suite)));
assert(unrecorded.length === 0, `[2z] every mutant names the RED it produces — the killing suite (one of its own) and the first failing assertion (missing: ${unrecorded.map((m) => m.id).slice(0, 8).join(', ') || 'none'}) — \`node tests/kits/gd-mutate.mjs --record\``);

console.log(`\n${'='.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
