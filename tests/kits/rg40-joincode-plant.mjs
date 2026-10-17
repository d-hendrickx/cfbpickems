/**
 * CFB Pickems — tests/kits/rg40-joincode-plant.mjs (D1 / v0.30.0, thread 100726-D1; bugfix, 2026-10-16)
 * =====================================================================================================================================================
 * THE S-3 KIT for static.check.mjs's RG-40 "every fixture league in one run gets a DISTINCT join code" guard (the DEV run of 2026-10-16 aborted pickPost
 * on `create fixture league X2: duplicate key … leagues_join_code_key`). Adapted from the reviewer's plant kit (BLOCK 2 of 2 on bd3337b8): it evaluates the
 * span of static.check.mjs between `// RG40-SCAN BEGIN` and `// RG40-SCAN END` on its own (it needs only the FIXTURE-VALUES region's fixtureJoinCode),
 * plants each shape into an IN-MEMORY copy of rls.test.mjs (no file is written), and checks the scan's verdict against the expected one.
 *
 * RED = the scan reports a problem. Every shape that could put two fixture leagues on one join code, or that the allow-list does not list, must be RED.
 * Three shapes are expected GREEN because they cannot produce a duplicate and the scan still resolves them: the clean control (a new unique literal tag),
 * the paused-pilot loop retagged 'z' -> 'w' ('w' is used nowhere else), and a // comment inserted between that loop and its call (the loop's literal is
 * still the line above once full-line comments are skipped). Block-comment text is scanned like code, so a call planted inside a block comment is RED.
 *
 * Run:  node tests/kits/rg40-joincode-plant.mjs        (from cfb-pickems/) — exit 0 only when every verdict matches.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'supabase', 'tests') + path.sep;
const sc = readFileSync(root + 'static.check.mjs', 'utf8');
const rls = readFileSync(root + 'rls.test.mjs', 'utf8');
const region = rls.slice(rls.indexOf('// BEGIN FIXTURE-VALUES'), rls.indexOf('// END FIXTURE-VALUES'));
const FX = new Function(`${region.replace(/^\s*export\s+/gm, '')}\n return { fixtureJoinCode };`)();
const a = sc.indexOf('// RG40-SCAN BEGIN'), b = sc.indexOf('// RG40-SCAN END');
if (a < 0 || b < a) { console.log('❌ the RG40-SCAN markers are missing from static.check.mjs'); process.exit(1); }
const scan = new Function('FX', sc.slice(a, b) + '\n return scanFixtureLeagueSites;')(FX);

const base = scan(rls);
let bad = 0;
const check = (ok, name, detail = '') => { if (!ok) bad++; console.log(`${ok ? '✅' : '❌'} ${name}${detail ? '  :: ' + detail : ''}`); };
check(base.problems.length === 0, `baseline: the real rls.test.mjs is clean (${base.tags.length} tags resolved)`, base.problems.slice(0, 2).join(' | '));

const RED = true, GREEN = false;
const cases = [
  // the reviewer's BLOCK 2 shapes
  ['space before paren', RED, (s) => s + "\nawait s44MkLeague (ctx, 'Z', 'a1');\n"],
  ['alias then call', RED, (s) => s + "\nconst mk9 = s44MkLeague; await mk9(ctx, 'Z', 'a1');\n"],
  ['.call form', RED, (s) => s + "\nawait s44MkLeague.call(null, ctx, 'Z', 'a1');\n"],
  ['.apply form', RED, (s) => s + "\nawait s44MkLeague.apply(null, [ctx, 'Z', 'q7']);\n"],
  ['alias with a unique tag (still an unlisted reference)', RED, (s) => s + "\nconst mk8 = s36MkLeague; await mk8(ctx, 'Z', 'q7');\n"],
  // the paused-pilot loop
  ['loop retag y -> v (dup with s35 v)', RED, (s) => s.replace("['LPP-paused-pilot', 'y', true]", "['LPP-paused-pilot', 'v', true]")],
  ['loop z -> w (w is unique)', GREEN, (s) => s.replace("['LPP-paused-pilot-alone', 'z', false]", "['LPP-paused-pilot-alone', 'w', false]")],
  ['loop third entry', RED, (s) => s.replace("['LPP-paused-pilot-alone', 'z', false]]", "['LPP-paused-pilot-alone', 'z', false], ['X', 'q9', true]]")],
  ['loop tag as variable', RED, (s) => s.replace("['LPP-paused-pilot', 'y', true]", "['LPP-paused-pilot', T, true]")],
  ['loop: // comment between for and call (still resolvable)', GREEN, (s) => s.replace("const pl = await s36TryMkPilot(ctx, label, tag, { status: 'paused' });", "// note\n          const pl = await s36TryMkPilot(ctx, label, tag, { status: 'paused' });")],
  ['loop: statement between for and call', RED, (s) => s.replace("const pl = await s36TryMkPilot(ctx, label, tag, { status: 'paused' });", "const qq = 1;\n          const pl = await s36TryMkPilot(ctx, label, tag, { status: 'paused' });")],
  ['loop call repeated elsewhere', RED, (s) => s + "\n          const pl = await s36TryMkPilot(ctx, label, tag, { status: 'paused' });\n"],
  // call shapes
  ['call inside a block comment (scanned like code)', RED, (s) => s + "\n/*\nawait s44MkLeague(ctx, 'Z', 'a1');\n*/\n"],
  ['double-quoted tag', RED, (s) => s + '\nawait s44MkLeague(ctx, "Z", "a1");\n'],
  ['multi-line call', RED, (s) => s + "\nawait s44MkLeague(\n  ctx, 'Z', 'a1');\n"],
  ['template tag', RED, (s) => s + "\nawait s44MkLeague(ctx, 'Z', `a1`);\n"],
  ['variable tag', RED, (s) => s + "\nasync function zz(ctx, t) { await s44MkLeague(ctx, 'Z', t); }\n"],
  ['new pass-through wrapper', RED, (s) => s + '\nconst mkL2 = (l, t) => s36MkLeague(ctx, l, t);\n'],
  // tag folding
  ['tag that folds onto w6a (w6A)', RED, (s) => s + "\nawait s44MkLeague(ctx, 'Z', 'w6A');\n"],
  ['tag folding 0 -> 2 onto a1 (a0)', RED, (s) => s + "\nawait s44MkLeague(ctx, 'Z', 'a0');\n"],
  ['letter-letter tag (S37 space)', RED, (s) => s + "\nawait s44MkLeague(ctx, 'Z', 'qq');\n"],
  // seeders and counters
  ['fixtureJoinCode in a trailing comment', RED, (s) => s + '\nconst c = 1; // fixtureJoinCode(x)\n'],
  ['new seeder outside the region', RED, (s) => s + '\nconst zzCode = fixtureJoinCode(`${runId}zq`);\n'],
  ['new seeder inside FIXTURE-VALUES region', RED, (s) => s.replace('// END FIXTURE-VALUES', "export const ZZ = () => fixtureJoinCode('q');\n// END FIXTURE-VALUES")],
  ['S37 counter reset', RED, (s) => s + '\nS37_SEQ = 0;\n'],
  ['admin salt counter reset', RED, (s) => s + '\nADMIN_LEAGUE_SEQ = 0;\n'],
  ['S37 alphabet changed', RED, (s) => s.replace("const S37_ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ';", "const S37_ALPHA = 'A2CDEFGHJKMNPQRSTUVWXYZ';")],
  // pinned lines
  ['second S48 bound line in another group', RED, (s) => s + "\nconst LB = await mkLeague('S48 bound');\n"],
  ['a pinned line gone', RED, (s) => s.replace("const LB = await mkLeague('S48 bound');", 'const LB = null;')],
  // control
  ['clean control: a new unique literal tag', GREEN, (s) => s + "\nawait s44MkLeague(ctx, 'Z', 'q8');\n"],
];
for (const [name, expectRed, f] of cases) {
  const src = f(rls);
  if (src === rls) { check(false, `${name}: the plant did not apply (rls.test.mjs changed shape; update this kit)`); continue; }
  const r = scan(src);
  const isRed = r.problems.length > 0;
  check(isRed === expectRed, `${expectRed ? 'RED  ' : 'GREEN'} expected, ${isRed ? 'RED' : 'GREEN'} got — ${name}`, isRed ? r.problems[0].slice(0, 140) : '');
}
console.log(`\n${cases.length + 1 - bad} passed, ${bad} failed.`);
process.exit(bad ? 1 : 0);
