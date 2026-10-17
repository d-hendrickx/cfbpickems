/**
 * tests/lib/trace-reads.mjs — `node --import tests/lib/trace-reads.mjs <suite>`: record every repo file the process reads.
 *
 * Used only by `testrun.mjs --check-deps`, to PROVE the static dependency map (tests/lib/depmap.mjs) is not missing
 * anything: a suite that really reads a file its map does not list would be skipped by `--affected` when that file
 * changes. Writes one repo-relative posix path per line to $CFBP_TRACE_FILE (a trailing `/` marks a directory that was
 * listed or copied). Covers the fs read APIs (sync, callback, promises, streams, copyFile/cp) and, through a module
 * loader hook, every ES module the process loads.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register, syncBuiltinESMExports } from 'node:module';

const file = process.env.CFBP_TRACE_FILE;
const root = process.env.CFBP_TRACE_ROOT;
if (file && root) {
  const rootReal = fs.realpathSync(root);
  const seen = new Set();
  const note = (p, dir) => {
    try {
      if (p instanceof URL) p = fileURLToPath(p);
      if (typeof p !== 'string' && !Buffer.isBuffer(p)) return;
      let abs = path.resolve(String(p));
      abs = abs.replace(/\?.*$/, '');
      let rel = path.relative(rootReal, abs);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        let real = abs; try { real = fs.realpathSync(abs); } catch { /* may not exist */ }
        rel = path.relative(rootReal, real);
        if (rel.startsWith('..') || path.isAbsolute(rel)) return;     // outside the checkout (a tmpdir copy): not a repo dependency
      }
      rel = rel.split(path.sep).join('/') + (dir ? '/' : '');
      if (!seen.has(rel)) { seen.add(rel); fs.appendFileSync(file, rel + '\n'); }
    } catch { /* tracing must never break the suite */ }
  };
  const wrap = (obj, name, dir = false) => {
    const orig = obj[name];
    if (typeof orig !== 'function') return;
    obj[name] = function (p, ...rest) { note(p, dir); return orig.call(this, p, ...rest); };
  };
  for (const n of ['readFileSync', 'readFile', 'createReadStream', 'openSync', 'open', 'existsSync', 'statSync', 'copyFileSync', 'copyFile']) { wrap(fs, n); }
  for (const n of ['readdirSync', 'readdir', 'opendirSync', 'opendir', 'cpSync', 'cp']) { wrap(fs, n, true); }
  for (const n of ['readFile', 'open', 'copyFile']) { wrap(fsp, n); }
  for (const n of ['readdir', 'opendir', 'cp']) { wrap(fsp, n, true); }
  // existsSync/statSync/openSync are noisy (they do not read content) — keep them: a suite that stats a file depends on its presence.
  syncBuiltinESMExports();
  register('./trace-hooks.mjs', { parentURL: import.meta.url, data: { file, root: rootReal } });
}
