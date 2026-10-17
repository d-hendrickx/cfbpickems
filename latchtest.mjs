/**
 * CFB Pickems — latchtest.mjs (THE LIVE LATCH, defect prevention, 2026-10-01)
 * ===========================================================================
 * Run:  node latchtest.mjs
 *
 * `supabase/tests/_live-latch.mjs` is imported as the FIRST statement of the four scripts that load real
 * credentials (rls.test, import-backup, export-sheet, projectiontest). Without CFBP_LIVE_OK=1 it prints a
 * refusal and exits 77 before anything else in the script is evaluated.
 *
 * SAFETY, the whole point: this suite spawns ONLY the latch file and scratch copies of it, from a scratch
 * directory it creates and deletes. It never runs, imports or spawns any of the four scripts. That they
 * open with the latch import is proved STATICALLY, as text, by supabase/tests/static.check.mjs's LIVE-LATCH
 * section; running one of them "to check the latch works" would be the incident this exists to prevent.
 *
 *   [1] the latch on its own: parses; refuses unset, '0', '', 'true', 'yes', ' 1', '1 ', '01', '2' and an
 *       empty environment (the `env -i` shape of 2026-09-16) with exit 77 and the message on stderr; opens
 *       on exactly '1', silently; never echoes argv; the message survives a pipe on every run. Follow-ups
 *       (2026-10-14): the message OPENS with the LATCH REFUSED line and a documented `| grep -E` filter run by a
 *       real /bin/sh and grep prints it (N1); it says what the latch stops and no more about --env-file (F-4);
 *       it points at docs/runbook/ too (N3); under `node -e … <ARG>` it prints "this script", never <ARG> (Q3).
 *       M-46 (Drew, 2026-10-14, D-78): the flag opens the latch only when stdin is a REAL TERMINAL. Proved both ways with
 *       real child processes: the flag with stdin a pipe or /dev/null is refused; the flag inside a real pseudo-terminal
 *       (macOS `script -q /dev/null node …`, on the latch or a scratch copy, never a real script) opens; a terminal without
 *       the flag stays shut; and no extra env var or argument opens it without a terminal.
 *   [2] ORDER, with a scratch copy byte-identical to the shipped latch, imported first by a scratch entry
 *       shaped like the real scripts (shebang, comment header, latch import, then imports with side effects,
 *       then a body): without the flag no later import, no nested import and no body line runs; with it
 *       all of them do; a CONTROL entry with the latch BELOW an import proves the markers can see a leak.
 *   [3] the ways an accident actually happens: imported from another module (`await import(...)`), and an
 *       --env-file that does not carry the flag. Plus the residual Drew accepted (M-46 part 2): an env file that DOES
 *       carry it opens the latch in a terminal (and is refused without one). And a latched parent's child sees the
 *       terminal only when it inherits stdin, the shape projectiontest.mjs uses for its CLI children.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync, copyFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LATCH = path.join(__dirname, 'supabase', 'tests', '_live-latch.mjs');
const LATCH_EXIT = 77;
const LAST_LINE = 'Claude or any agent: do not set the flag and do not retry. Stop, and hand Drew the command.\n';
const TTY_LINE = 'It also needs a real terminal: stdin must be a TTY, so a pipe into node, cron, a detached job or an agent shell is refused even with the flag.\n';
const REFUSAL_LINE = 'LATCH REFUSED (exit 77): nothing ran, so nothing passed, failed or skipped.';
// The shape every runbook pipes the suite through (docs/runbook/0047_ID_SHAPE_CHECKS.md, as the shell hands it to grep).
const DOC_FILTER = 'S47\\.|passed|failed|skipped';

let pass = 0, fail = 0;
function assert(cond, label, detail) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label + (detail !== undefined ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : '')); }
}

/** A copy of this process's environment with CFBP_LIVE_OK REMOVED, then set only if a value is given — so
 *  the result never depends on the shell that launched the suite. */
function envWith(value) {
  const env = { ...process.env };
  delete env.CFBP_LIVE_OK;
  if (value !== undefined) env.CFBP_LIVE_OK = value;
  return env;
}
function runNode(args, env, cwd) {
  return spawnSync(process.execPath, args, { env, cwd, encoding: 'utf8', timeout: 30000 });
}
/** The same inside a REAL pseudo-terminal (M-46): macOS `script -q /dev/null node …` gives the child a TTY on stdin. `script`
 *  itself gets /dev/null as stdin (it refuses a socket), forwards that EOF as ^D and echoes it as "^D\b\b"; the child's stdout
 *  AND stderr both arrive on script's stdout with \r\n. `out` is that text without the echo and the \r. Only ever the latch or a
 *  scratch copy of it, like every spawn in this file. */
function runNodeTTY(args, env, cwd) {
  const r = spawnSync('script', ['-q', '/dev/null', process.execPath, ...args], { env, cwd, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
  return { ...r, out: String(r.stdout || '').replace(/\^D\x08\x08/g, '').replace(/\r/g, '') };
}

// ── [0] the shell running this suite ─────────────────────────────────────────────────────────────────
console.log('\n[0] The environment this suite runs in…');
assert(process.env.CFBP_LIVE_OK === undefined,
  'CFBP_LIVE_OK is not set in the shell running this suite (an exported flag holds the latch open for every command in that shell; it is typed per run, never exported)',
  process.env.CFBP_LIVE_OK);
assert(existsSync(LATCH), `the latch exists at supabase/tests/_live-latch.mjs`);

// ── [1] the latch on its own ────────────────────────────────────────────────────────────────────────
console.log('\n[1] The latch on its own: refuses unless CFBP_LIVE_OK is exactly "1"…');
{
  const chk = runNode(['--check', LATCH], envWith());
  assert(chk.status === 0, '`node --check` parses the latch', chk.stderr);

  const r = runNode([LATCH], envWith());
  assert(r.status === LATCH_EXIT, `unset: exits ${LATCH_EXIT} (EX_NOPERM — distinct from the 2 every guarded script uses for its own refusals)`, r.status);
  assert(r.stdout === '', 'unset: nothing on stdout', r.stdout);
  assert(r.stderr.includes('REFUSED: _live-latch.mjs uses REAL credentials'), 'unset: the refusal names the script that was run (argv[1]\'s file name)', r.stderr.slice(0, 200));
  assert(r.stderr.includes('Only Drew runs it.'), 'unset: the message says only Drew runs it');
  assert(r.stderr.split('\n')[1] === REFUSAL_LINE, `N1: the message OPENS with "${REFUSAL_LINE}" (after one blank line)`, r.stderr.split('\n').slice(0, 2));
  assert(r.stderr.includes('Nothing ran: this latch is the first statement, so no later import, file read or client in the script was evaluated.\n'),
    'unset: the message says nothing in the script ran (no later import, file read or client)');
  assert(r.stderr.includes('(An --env-file named on the command line is loaded by node itself before any script code; the refused script never used it.)\n')
    && !/no \.env file|was loaded\./.test(r.stderr),
    'F-4: the message says a named --env-file was loaded by node itself and never used, and no longer claims "no .env file … was loaded"');
  assert(r.stderr.includes('Every command is in docs/SUPABASE_LIVE_RUNBOOK.md and the runbooks in docs/runbook/.\n'), 'N3: the message points at docs/runbook/ as well as the live runbook');
  // N1, for real: the documented filter, run by /bin/sh and the system grep, over the latch's merged output.
  const piped = spawnSync('/bin/sh', ['-c', `"$NODE_BIN" "$LATCH_FILE" 2>&1 | grep -E "${DOC_FILTER}"`], { env: { ...envWith(), NODE_BIN: process.execPath, LATCH_FILE: LATCH }, encoding: 'utf8', timeout: 30000 });
  assert(piped.stdout === REFUSAL_LINE + '\n', 'N1: `node <latch> 2>&1 | grep -E "S47\\.|passed|failed|skipped"` (a real shell and grep) prints exactly the LATCH REFUSED line: a refused run never prints nothing', { stdout: piped.stdout, stderr: piped.stderr, status: piped.status });
  assert(r.stderr.includes('    CFBP_LIVE_OK=1 node --env-file=.env.test rls.test.mjs\n'), 'unset: the message gives the exact command with the flag in front of `node`');
  assert(r.stderr.includes('Never put it in an .env file, a shell profile or an export.'), 'unset: the message says the flag is typed per run, never stored');
  assert(r.stderr.endsWith(LAST_LINE), 'unset: the message ends by telling an agent to stop and hand Drew the command');
  assert(r.stderr.includes(TTY_LINE), 'M-46: the refusal says a real terminal is required too, so a refusal with the flag set does not look like a broken flag');

  const pty = runNodeTTY(['-e', 'process.stdout.write(String(process.stdin.isTTY))'], envWith());
  assert(process.platform === 'darwin' && pty.status === 0 && pty.out === 'true', 'the pseudo-terminal works here: under `script -q /dev/null` a child sees stdin.isTTY === true (else the opening cases below prove nothing)', { platform: process.platform, status: pty.status, out: pty.out, err: pty.stderr });

  for (const v of ['0', '', 'true', 'yes', 'TRUE', ' 1', '1 ', '01', '2']) {
    const rv = runNodeTTY([LATCH], envWith(v));
    assert(rv.status === LATCH_EXIT && rv.out.includes('REFUSED:'), `CFBP_LIVE_OK=${JSON.stringify(v)} in a real terminal: refused, exit ${LATCH_EXIT} (only the exact string '1' opens the latch)`, rv.status);
  }

  const empty = runNode([LATCH], {});
  assert(empty.status === LATCH_EXIT && empty.stderr.includes('REFUSED:'),
    `an EMPTY environment (the \`env -i … node\` shape of 2026-09-16) is refused, exit ${LATCH_EXIT}`, empty.status);

  // M-46: the flag alone is not enough. A pipe on stdin (an agent's shell, `x | node …`) and /dev/null (cron, a detached job)
  // are refused; inside a real terminal the flag opens; a terminal without the flag stays shut.
  const flagPipe = runNode([LATCH], envWith('1'));
  assert(flagPipe.status === LATCH_EXIT && flagPipe.stderr.split('\n')[1] === REFUSAL_LINE && flagPipe.stderr.includes(TTY_LINE),
    'M-46: CFBP_LIVE_OK=1 with stdin a PIPE (no terminal): refused, exit 77, the same first line, and the message says a terminal is required', { status: flagPipe.status, head: flagPipe.stderr.slice(0, 120) });
  const flagNull = spawnSync(process.execPath, [LATCH], { env: envWith('1'), encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
  assert(flagNull.status === LATCH_EXIT && flagNull.stderr.includes(TTY_LINE), 'M-46: CFBP_LIVE_OK=1 with stdin /dev/null (cron, a detached job): refused, exit 77', flagNull.status);
  const ok = runNodeTTY([LATCH], envWith('1'));
  assert(ok.status === 0, 'CFBP_LIVE_OK=1 in a real terminal (a pseudo-terminal from `script`): exits 0', { status: ok.status, out: ok.out, err: ok.stderr });
  assert(ok.out === '' && ok.stderr === '', 'CFBP_LIVE_OK=1 in a real terminal: prints nothing at all (an open latch is invisible)', { out: ok.out, stderr: ok.stderr });
  const ttyOnly = runNodeTTY([LATCH], envWith());
  assert(ttyOnly.status === LATCH_EXIT && ttyOnly.out.includes(REFUSAL_LINE), 'M-46: a real terminal WITHOUT the flag: refused, exit 77 (the terminal is a second condition, never a key)', ttyOnly.status);
  // No escape hatch: nothing an agent can set opens it without a terminal.
  const hatches = [[{ CI: '1' }, []], [{ FORCE_TTY: '1' }, []], [{ CFBP_LIVE_TTY: '1' }, []], [{ TERM: 'xterm-256color', FORCE_COLOR: '1' }, []], [{}, ['--tty']], [{}, ['--force']]];
  const opened = hatches.filter(([e, a]) => runNode([LATCH, ...a], { ...envWith('1'), ...e }).status !== LATCH_EXIT).map(([e, a]) => JSON.stringify([e, a]));
  assert(opened.length === 0, `M-46: no escape hatch: with the flag but no terminal, ${hatches.length} env vars and arguments an agent could set (CI, FORCE_TTY, a made-up TTY switch, TERM/FORCE_COLOR, --tty, --force) all stay refused`, opened);

  const SECRET = 'sk-latchtest-never-print-me';
  // The last argument ends in .mjs on purpose (2026-10-14): since Q3 a printed name must look like a script file, so an
  // argv-echoing latch would only show itself when the joined arguments END like one. This keeps the check's teeth.
  const argv = runNode([LATCH, '--service-role-key', SECRET, `--x=${SECRET}`, 'tail.mjs'], envWith());
  assert(argv.status === LATCH_EXIT && !argv.stderr.includes(SECRET) && !argv.stdout.includes(SECRET) && argv.stderr.includes('REFUSED: _live-latch.mjs uses'),
    'argv is never echoed: a key passed as an argument does not appear in the refusal (only argv[1]\'s base name does)');
  assert(!r.stderr.includes(path.dirname(LATCH)), 'only the file name is shown, never the directory it was run from', r.stderr.slice(0, 200));
  // Q3: under `node -e … <ARG>` argv[1] is <ARG>. The latch prints it only when it is a script file name.
  const latchUrl = pathToFileURL(LATCH).href;
  const eArg = runNode(['--input-type=module', '-e', `await import(${JSON.stringify(latchUrl)});`, 'SECRET-LOOKING-VALUE'], envWith());
  assert(eArg.status === LATCH_EXIT && eArg.stderr.includes('REFUSED: this script uses REAL credentials') && !eArg.stderr.includes('SECRET-LOOKING-VALUE') && !eArg.stdout.includes('SECRET-LOOKING-VALUE'),
    'Q3: `node -e "await import(<latch>)" SECRET-LOOKING-VALUE` is refused as "this script"; the trailing argument is never printed', eArg.stderr.slice(0, 200));
  const eKey = runNode(['--input-type=module', '-e', `await import(${JSON.stringify(latchUrl)});`, `sk/${SECRET}`], envWith());
  assert(eKey.status === LATCH_EXIT && !eKey.stderr.includes(SECRET) && eKey.stderr.includes('REFUSED: this script uses'),
    'Q3: a path-shaped argument (`sk/<key>`, whose basename is the key) is not printed either: only a name ending in .mjs, .cjs or .js is', eKey.stderr.slice(0, 200));
  const eCjs = runNode(['--input-type=module', '-e', `await import(${JSON.stringify(latchUrl)});`, '/some/dir/runner.cjs'], envWith());
  assert(eCjs.status === LATCH_EXIT && eCjs.stderr.includes('REFUSED: runner.cjs uses') && !eCjs.stderr.includes('/some/dir'),
    'Q3: an argv[1] that IS a script file name (…/runner.cjs) is named, by its base name only', eCjs.stderr.slice(0, 200));

  // stderr is a pipe here (spawnSync), and the latch exits right after writing. A dropped or truncated
  // message on any run would read as a silent exit; ten runs, every one must carry the whole message.
  let whole = 0;
  for (let i = 0; i < 10; i++) {
    const ri = runNode([LATCH], envWith());
    if (ri.status === LATCH_EXIT && ri.stderr === r.stderr) whole++;
  }
  assert(whole === 10, 'the whole message arrives over a pipe on every one of 10 runs (write, then exit)', whole);
}

// ── [2] order: nothing after the latch is evaluated ──────────────────────────────────────────────────
console.log('\n[2] Order — a scratch copy of the latch, imported first by a scratch entry, stops every later import and the body…');
const scratch = mkdtempSync(path.join(tmpdir(), 'cfbp-latchtest-'));
try {
  const copy = path.join(scratch, '_live-latch.mjs');
  copyFileSync(LATCH, copy);
  assert(readFileSync(copy).equals(readFileSync(LATCH)), 'the scratch latch is byte-identical to the shipped one (the proof below is about the real file)');

  // N1 CONTROL: the same filter over a scratch latch WITHOUT the LATCH REFUSED line prints nothing at all, so the
  // [1] result (exactly that line) is the line doing the work, not a filter that shows everything.
  const noLine = path.join(scratch, 'no-line-latch.mjs');
  const src = readFileSync(LATCH, 'utf8');
  const cut = src.replace("    'LATCH REFUSED (exit 77): nothing ran, so nothing passed, failed or skipped.\\n' +\n", '');
  writeFileSync(noLine, cut);
  const hiddenRun = spawnSync('/bin/sh', ['-c', `"$NODE_BIN" "$LATCH_FILE" 2>&1 | grep -E "${DOC_FILTER}"`], { env: { ...envWith(), NODE_BIN: process.execPath, LATCH_FILE: noLine }, encoding: 'utf8', timeout: 30000 });
  assert(cut !== src && hiddenRun.stdout === '' && hiddenRun.status === 1, 'N1 CONTROL: without that line the same documented filter prints NOTHING (grep exit 1): the refusal was invisible through every runbook command before the fix', { stdout: hiddenRun.stdout, status: hiddenRun.status, applied: cut !== src });
  unlinkSync(noLine);

  const marker = (name) => path.join(scratch, name);
  const MARKERS = ['marker-import.txt', 'marker-deep.txt', 'marker-body.txt'];
  const clearMarkers = () => { for (const m of MARKERS) if (existsSync(marker(m))) unlinkSync(marker(m)); };
  const present = () => MARKERS.filter((m) => existsSync(marker(m)));

  writeFileSync(path.join(scratch, 'side-effect.mjs'), [
    "import { writeFileSync } from 'node:fs';",
    "writeFileSync(new URL('./marker-import.txt', import.meta.url), 'a later import was evaluated\\n');",
    'export const LOADED = true;',
    '',
  ].join('\n'));
  writeFileSync(path.join(scratch, 'deep.mjs'), [
    "import { writeFileSync } from 'node:fs';",
    "writeFileSync(new URL('./marker-deep.txt', import.meta.url), 'a nested import was evaluated\\n');",
    '',
  ].join('\n'));
  writeFileSync(path.join(scratch, 'nested.mjs'), ["import './deep.mjs';", ''].join('\n'));

  // Shaped like the four scripts: shebang, a comment header, the latch's comment line, the latch import,
  // then imports with side effects, then a body that would read credentials in the real thing.
  const BODY = [
    "import { LOADED } from './side-effect.mjs';",
    "import './nested.mjs';",
    "import { writeFileSync } from 'node:fs';",
    '',
    "writeFileSync(new URL('./marker-body.txt', import.meta.url), String(LOADED));",
    '',
  ];
  const LATCH_LINES = [
    '// LIVE LATCH, first statement on purpose: ES modules evaluate imports in order, so without CFBP_LIVE_OK=1 the latch exits before any later import, .env read or client creation is evaluated.',
    "import './_live-latch.mjs';",
  ];
  const HEADER = ['#!/usr/bin/env node', '/**', ' * scratch entry for latchtest.mjs', ' */', ''];
  writeFileSync(path.join(scratch, 'entry-latched.mjs'), [...HEADER, ...LATCH_LINES, ...BODY].join('\n'));
  // CONTROL: the latch BELOW an import with a side effect. If the markers could not see a leak, the
  // "nothing ran" results above would be vacuous; this entry must leak exactly the import above the latch.
  writeFileSync(path.join(scratch, 'entry-late.mjs'), [...HEADER, BODY[0], ...LATCH_LINES, ...BODY.slice(1)].join('\n'));

  clearMarkers();
  const shut = runNode(['entry-latched.mjs'], envWith(), scratch);
  assert(shut.status === LATCH_EXIT, `latched entry, no flag: exits ${LATCH_EXIT}`, shut.status);
  assert(present().length === 0, 'latched entry, no flag: NO later import, NO nested import and NO body line was evaluated (zero markers)', present());
  assert(shut.stderr.includes('REFUSED: entry-latched.mjs uses REAL credentials'), 'latched entry, no flag: the refusal names the ENTRY script, not the latch', shut.stderr.slice(0, 200));

  clearMarkers();
  const zero = runNode(['entry-latched.mjs'], envWith('0'), scratch);
  assert(zero.status === LATCH_EXIT && present().length === 0, "latched entry, CFBP_LIVE_OK=0: refused, zero markers", { status: zero.status, markers: present() });

  clearMarkers();
  const openNoTty = runNode(['entry-latched.mjs'], envWith('1'), scratch);
  assert(openNoTty.status === LATCH_EXIT && present().length === 0, 'M-46: latched entry, the flag but NO terminal (stdin a pipe): refused, zero markers', { status: openNoTty.status, markers: present() });

  clearMarkers();
  const open = runNodeTTY(['entry-latched.mjs'], envWith('1'), scratch);
  assert(open.status === 0, 'latched entry, CFBP_LIVE_OK=1 in a real terminal: exits 0', { status: open.status, out: open.out.slice(0, 300) });
  assert(present().length === 3, 'latched entry, CFBP_LIVE_OK=1 in a real terminal: the later import, the nested import AND the body all ran (three markers) — the latch blocks nothing when open', present());

  clearMarkers();
  const late = runNode(['entry-late.mjs'], envWith(), scratch);
  assert(late.status === LATCH_EXIT, `CONTROL, latch below an import: still exits ${LATCH_EXIT}`, late.status);
  assert(existsSync(marker('marker-import.txt')), 'CONTROL: the import ABOVE the latch WAS evaluated (the markers can see a leak, so zero markers above is a real result)', present());
  assert(!existsSync(marker('marker-deep.txt')) && !existsSync(marker('marker-body.txt')), 'CONTROL: what comes after the latch still did not run', present());

  // ── [3] the ways an accident actually happens ──
  console.log('\n[3] Accident shapes: imported from another module, and an --env-file without the flag…');
  clearMarkers();
  const entryUrl = pathToFileURL(path.join(scratch, 'entry-latched.mjs')).href;
  const dyn = runNode(['--input-type=module', '-e', `await import(${JSON.stringify(entryUrl)});`], envWith(), scratch);
  assert(dyn.status === LATCH_EXIT && present().length === 0, `imported from another module (\`await import(…)\`), no flag: refused, exit ${LATCH_EXIT}, zero markers`, { status: dyn.status, markers: present() });

  const envNoFlag = path.join(scratch, 'probe-noflag.envfile');
  writeFileSync(envNoFlag, 'CFBP_LATCHTEST_PROBE=1\n');
  clearMarkers();
  const ef = runNode([`--env-file=${envNoFlag}`, 'entry-latched.mjs'], envWith(), scratch);
  assert(ef.status === LATCH_EXIT && present().length === 0, `--env-file naming a file WITHOUT the flag: refused, exit ${LATCH_EXIT}, zero markers (an env file is not a key to the latch)`, { status: ef.status, markers: present() });

  // The RESIDUAL Drew accepted (M-46 part 2, D-78). `node --env-file` loads the file before any module is evaluated, so a
  // flag written INTO an env file holds the latch open for every run in a terminal that names that file. Asserted, not
  // hidden, so the rule "never put CFBP_LIVE_OK in an .env file" has its reason on the record. Without a terminal the
  // same file is refused: an agent's shell has none.
  const envFlag = path.join(scratch, 'probe-flag.envfile');
  writeFileSync(envFlag, 'CFBP_LIVE_OK=1\n');
  clearMarkers();
  const ef1 = runNodeTTY([`--env-file=${envFlag}`, 'entry-latched.mjs'], envWith(), scratch);
  assert(ef1.status === 0 && present().length === 3, 'RESIDUAL, accepted by Drew (M-46 part 2): an env file that CARRIES CFBP_LIVE_OK=1 opens the latch in a terminal — which is why the flag is typed per run and never written into one', { status: ef1.status, markers: present() });
  clearMarkers();
  const ef1NoTty = runNode([`--env-file=${envFlag}`, 'entry-latched.mjs'], envWith(), scratch);
  assert(ef1NoTty.status === LATCH_EXIT && present().length === 0, 'M-46: the same env file WITHOUT a terminal is refused, zero markers (an agent\'s shell cannot use it)', { status: ef1NoTty.status, markers: present() });

  // Children of a latched script (projectiontest.mjs spawns two latched CLIs): a child sees the terminal only when it
  // INHERITS stdin. A scratch latched parent, run in a real terminal with the flag, spawns the scratch latched entry.
  const parent = (name, opts) => writeFileSync(path.join(scratch, name), [...HEADER, ...LATCH_LINES, "import { spawnSync } from 'node:child_process';",
    `const r = spawnSync(process.execPath, ['entry-latched.mjs'], ${opts});`, 'process.exit(r.status === null ? 99 : r.status);', ''].join('\n'));
  parent('parent-inherit.mjs', "{ encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'] }");
  parent('parent-default.mjs', "{ encoding: 'utf8' }");
  clearMarkers();
  const pInherit = runNodeTTY(['parent-inherit.mjs'], envWith('1'), scratch);
  assert(pInherit.status === 0 && present().length === 3, "M-46: a latched parent in a terminal whose child INHERITS stdin (`stdio: ['inherit', 'pipe', 'pipe']`, the shape the latched parent script uses for its CLI children): the child opens (three markers)", { status: pInherit.status, markers: present() });
  clearMarkers();
  const pDefault = runNodeTTY(['parent-default.mjs'], envWith('1'), scratch);
  assert(pDefault.status === LATCH_EXIT && present().length === 0, "M-46: the same parent with the DEFAULT stdio (a pipe): the child is refused, exit 77, zero markers — why every spawn of a latched CLI inherits stdin", { status: pDefault.status, markers: present() });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
assert(!existsSync(scratch), 'the scratch directory was removed');

console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
// Flush before exiting (the loadtest.mjs / hometest.mjs pattern): stdout and stderr are pipes under
// loadtest.mjs's spawnSync, and process.exit() does not drain them. The unref'd timer is the backstop.
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
