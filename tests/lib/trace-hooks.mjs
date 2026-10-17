/** Module-loader hook for trace-reads.mjs: record every file: module the process loads (they are read by the loader, not through the fs API we wrapped). */
import { appendFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

let file = null, root = null;
export function initialize(data) { file = data.file; root = data.root; }

export async function load(url, context, nextLoad) {
  try {
    if (file && url.startsWith('file:')) {
      const abs = fileURLToPath(url.replace(/[?#].*$/, ''));
      let real = abs; try { real = realpathSync(abs); } catch { /* data/mutant copies may not exist */ }
      const rel = path.relative(root, real);
      if (!rel.startsWith('..') && !path.isAbsolute(rel)) appendFileSync(file, rel.split(path.sep).join('/') + '\n');
    }
  } catch { /* never break a load */ }
  return nextLoad(url, context);
}
