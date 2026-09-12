/**
 * CFB Pickems — spreadsigntest.mjs
 * =================================
 * Item SS — spread-sign structural scan (deny-by-default). Approved by Drew
 * 2026-09-02. This file builds ONLY the structural scan; it does not touch
 * app.js, storage.js, scoring.js or loadtest.mjs.
 *
 * Run: node spreadsigntest.mjs
 *
 * WHY THIS FILE EXISTS
 * ---------------------
 * `game.spread` / `game.lockedSpread` is a SIGNED number from the HOME
 * team's perspective (AD-03): negative = home favored, positive = away
 * favored, 0 = PK. Every sign-error incident this codebase has actually
 * shipped came from the sign being taken from somewhere OTHER than a
 * resolved favorite:
 *   - the v0.13-v0.15 "spread bug" — sign typed directly instead of derived
 *     from Favorite + Margin (AD-03's origin story).
 *   - RG-54 — a deleted school-name substring heuristic that got
 *     shared-suffix matchups backwards (Ball State/Ohio State), answering
 *     5.14% of all pairings wrong when forced to be the sole resolver.
 *   - dg8 in `DEMO_GAMES` (js/data-model.js) — carried `spread:-2.5` with
 *     `favorite:'Alabama'` from authorship until 2026-08-27. It rendered
 *     "Alabama -2.5" (formatSpread ignores the stored sign and always
 *     prints the favorite) while SCORING as Michigan -2.5 — a real,
 *     shipped grading defect, caught only by atstest.mjs §11, a BEHAVIOURAL
 *     check on one fixture array, not a structural guard on the class.
 *
 * A behavioural test proves today's code is right. It says nothing about
 * tomorrow's fifth call site. This file asserts the CLASS property instead
 * — the same "build the guard, not a fifth per-surface test" move as
 * loadtest.mjs [64] (the blind-rule disclosure scan) and gradetest.mjs [6]
 * (no second copy of the ATS comparison): every place in the scanned
 * source that assigns a KEY named `spread` or `lockedSpread` inside an
 * object literal must be provably derived from a resolved favorite, or be
 * null/zero (no sign asserted), or be a copy-forward read of an
 * already-resolved `.spread`/`.lockedSpread`, or sit on a NAMED, reasoned
 * EXEMPT entry. Deny-by-default: an unresolved occurrence with no
 * exemption fails the scan.
 *
 * WHAT COUNTS AS "FAVORITE-DERIVED", MECHANICALLY
 * --------------------------------------------------
 * Checked structurally, never trusted by name alone:
 *   (a) NULL or ZERO literal        — no sign is asserted either way.
 *   (b) `<x>.spread` / `<x>.lockedSpread` READ — carries an ALREADY-resolved
 *       sign forward; derives nothing new. (applyWeekStatusChange() and
 *       tickAutoTransition() freezing lockedSpread from the live spread;
 *       availAddPayloadJSON() carrying an ESPN-resolved spread into an
 *       add-to-slate payload — extracted out of renderAvailableGamesList()
 *       by F4, 2026-09-12, so both "+ Add" buttons share one payload.)
 *   (c) THE FAVORITE-MARGIN LADDER — the commissioner's game modal
 *       (showGameModal): CLAUDE.md's mandated UI is Favorite (Home/Away/PK)
 *       + positive Margin, sign computed on save. Verified by finding >= 2
 *       direct assignments to the same local, all "simple" RHSs (0, null,
 *       or a possibly-negated bare identifier), where the non-null/zero set
 *       contains both `<mag>` and `-<mag>` for some shared magnitude name —
 *       i.e. the home branch and the away branch are textually each other's
 *       negation.
 *   (d) THE FAVORITE TERNARY — `favorite === <team> ? <mag> : -<mag>`
 *       (data-provider.js's `extractSpread()`), verified by requiring the
 *       condition to test `favorite` and exactly ONE branch to carry the
 *       unary minus.
 *   (e) A TRUSTED DERIVER CALL — destructured directly out of
 *       `extractSpread(...)`'s return. Composes with (d) rather than
 *       trusting the call blind: extractSpread's OWN region is scanned by
 *       this same file and must itself resolve clean.
 *
 * Anything else — most importantly a hand-typed numeric literal — is
 * unresolved and must be named on EXEMPT with a reason, or the scan fails.
 *
 * SCOPE OF THIS PASS
 * -------------------
 * Structural scan only. The RUNTIME lock-site validation (refuse to freeze
 * a spread whose sign contradicts its recorded favorite, at BOTH lock
 * sites in app.js — applyWeekStatusChange() and tickAutoTransition()) is
 * NOT built here. It is a separate, deliberately deferred app.js pass, so
 * this file could be built without a second agent editing app.js at the
 * same time. See the handoff report for what that pass still owes.
 */

import { readFile } from 'node:fs/promises';

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

// ── Source under scan ─────────────────────────────────────────────────────────
// app.js / data-model.js / data-provider.js / storage.js are the four named in
// the brief. chat-ui.js is added defensively — it mentions `spread` (a READ,
// scribeLiveGameCheck()) but has never WRITTEN one; scanning it means a future
// write there is caught automatically rather than by remembering to update
// this file's file list.
const appJsSrc         = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
const dataModelSrc     = await readFile(new URL('./js/data-model.js', import.meta.url), 'utf8');
const dataProviderSrc  = await readFile(new URL('./js/data-provider.js', import.meta.url), 'utf8');
const storageSrc       = await readFile(new URL('./js/storage.js', import.meta.url), 'utf8');
const chatUiSrc        = await readFile(new URL('./js/chat-ui.js', import.meta.url), 'utf8');

// ═════════════════════════════════════════════════════════════════════════════
// THE SCANNER
// ═════════════════════════════════════════════════════════════════════════════

/** Blank out comment BODIES, preserving line/column structure, so prose
 *  describing the rule can never satisfy the scan (the RG-27 false-coverage
 *  shape — canary C7 below proves it). Same technique as loadtest.mjs [64]. */
const blankComments = s => s
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:'"\\/])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));

/** Split a file into top-level regions: every `function NAME` (declaration)
 *  or `const NAME =` (top-level array/object literal, e.g. DEMO_GAMES) that
 *  sits at column 0. A region runs from its own declaration line to the next
 *  column-0 declaration, or EOF — same slicing loadtest.mjs [64] and
 *  gradetest.mjs [6] use for function regions; extended here to also cover
 *  top-level data literals, because two of this codebase's actual
 *  spread-sign writes (DEMO_GAMES, HISTORICAL_DEMO_GAMES) are literal arrays,
 *  not function bodies. */
function regionsOf(src) {
  const lines = blankComments(src).split('\n');
  const decls = [];
  lines.forEach((l, i) => {
    const fn = l.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/);
    const cn = l.match(/^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=/);
    const m = fn || cn;
    if (m) decls.push({ name: m[1], line: i });
  });
  return decls.map((d, i) => ({
    name: d.name,
    body: lines.slice(d.line, i + 1 < decls.length ? decls[i + 1].line : lines.length).join('\n'),
  }));
}

/** Capture an RHS starting right after a `:`, stopping at the first
 *  TOP-LEVEL comma/semicolon or unmatched closer — same idea as
 *  gradetest[6]'s trimRhs, folded into the capture itself. */
function captureRhs(text) {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) { if (depth === 0) return text.slice(0, i).trim(); depth--; }
    else if ((c === ',' || c === ';') && depth === 0) return text.slice(0, i).trim();
  }
  return text.trim();
}

/** Walk backward from `pos` tracking bracket depth to find the nearest
 *  UNMATCHED `{` that directly encloses it (returns -1 if the nearest
 *  enclosing bracket is `(` or `[`, i.e. not directly inside an object
 *  literal at all). */
function findEnclosingBrace(text, pos) {
  const pairFor = { ')': '(', ']': '[', '}': '{' };
  const stack = [];
  for (let i = pos - 1; i >= 0; i--) {
    const c = text[i];
    if (c === ')' || c === ']' || c === '}') stack.push(c);
    else if (c === '(' || c === '[' || c === '{') {
      if (stack.length && pairFor[stack[stack.length - 1]] === c) stack.pop();
      else return c === '{' ? i : -1;
    }
  }
  return -1;
}

/** Is the `{` at `braceIdx` a DESTRUCTURING position (a read into locals),
 *  rather than an object literal being constructed (a write)? True if it's
 *  preceded by const/let/var, or its matching close is followed by `=`. */
function isDestructuringBrace(body, braceIdx) {
  const before = body.slice(Math.max(0, braceIdx - 20), braceIdx);
  if (/\b(?:const|let|var)\s*$/.test(before)) return true;
  let depth = 1;
  for (let j = braceIdx + 1; j < body.length; j++) {
    if (body[j] === '{') depth++;
    else if (body[j] === '}') {
      depth--;
      if (depth === 0) return /^\s*=(?!=)/.test(body.slice(j + 1, j + 20));
    }
  }
  return false;
}

const FIELDS = ['spread', 'lockedSpread'];

/** Every OBJECT-LITERAL-POSITION occurrence of `field` in a region body:
 *  colon-key writes (`spread: <rhs>`) and shorthand writes (`spread,` /
 *  `spread}` immediately after `{`/`,`) — EXCLUDING property reads
 *  (`x.spread`) and destructuring reads (`const {spread} = …`), which
 *  disclose or derive no NEW sign. Bare local reassignment (`spread = -x;`)
 *  is excluded here too — it is the DERIVATION step, not the write into a
 *  game object; classify() below follows it via one level of indirection. */
function objectLiteralOccurrences(body, field) {
  const out = [];
  const re = new RegExp(String.raw`\b${field}\b`, 'g');
  let m;
  while ((m = re.exec(body))) {
    const i = m.index;
    const beforeMatch = body.slice(0, i).match(/(\S)\s*$/);
    const before = beforeMatch ? beforeMatch[1] : '';
    if (before === '.') continue; // property READ — never a write
    const after = body.slice(i + field.length).match(/^\s*(\S)/)?.[1] || '';

    if (after === ':') {
      const colonIdx = body.indexOf(':', i + field.length);
      const rhs = captureRhs(body.slice(colonIdx + 1, colonIdx + 1 + 400));
      out.push({ field, form: 'colon', rhs, index: i });
    } else if ((before === '{' || before === ',') && (after === ',' || after === '}')) {
      const braceIdx = findEnclosingBrace(body, i);
      if (braceIdx !== -1 && isDestructuringBrace(body, braceIdx)) continue; // read, not write
      out.push({ field, form: 'shorthand', rhs: field, index: i });
    }
    // else: bare comparison/assignment/other reference — not a write here.
  }
  return out;
}

/** RHS is literal null/0 (no sign asserted) or a copy-forward read of an
 *  ALREADY-resolved `.spread`/`.lockedSpread` (freezes or carries forward,
 *  derives nothing new).
 *
 *  Two shapes look like a copy-forward on a naive substring check but are
 *  NOT — each asserts a NEW sign and must NOT pass here (reviewer BLOCK,
 *  Item SS scan, 2026-09-09):
 *   (a) a LEADING UNARY MINUS directly negating the ref, e.g. `-g.spread` —
 *       negation flips the sign; it is not a carry-forward of the resolved
 *       one.
 *   (b) a BARE NUMERIC LITERAL anywhere else in the RHS alongside the ref,
 *       e.g. a ternary `cond ? g.spread : -2.5` — the literal branch
 *       introduces a hand-typed sign the copy-forward branch doesn't cover;
 *       the RHS as a whole is not a pure copy. */
function isSafeLiteralOrCopy(rhs) {
  const t = rhs.trim();
  if (t === 'null' || t === '0') return true;
  const refChain = /[\w$]+(?:\s*\.\s*[\w$]+)*\s*\.\s*(?:spread|lockedSpread)\b/;
  if (!refChain.test(t)) return false;
  // (a) leading unary minus directly negating the .spread/.lockedSpread ref.
  if (new RegExp(String.raw`^-\s*(?:${refChain.source})`).test(t)) return false;
  // (b) a bare numeric literal anywhere else in the RHS — strip every ref
  //     chain first so digits belonging to the ref itself (there are none,
  //     but be safe) can't false-positive, then look for a leftover digit.
  const withoutRefs = t.replace(new RegExp(refChain.source, 'g'), '');
  if (/\d/.test(withoutRefs)) return false;
  return true;
}

/** RHS is `favorite === <team> ? <mag> : -<mag>` (or the mirror) — exactly
 *  one branch negated, condition keyed on `favorite`. */
function isFavoriteTernary(rhs) {
  const m = rhs.match(/\bfavorite\s*===?\s*[\w$.]+\s*\?\s*(-?)[\w$.]+\s*:\s*(-?)[\w$.]+/);
  if (!m) return false;
  return (m[1] === '-') !== (m[2] === '-');
}

/** Every direct `varName = <rhs>;` assignment inside `body`, RHS captured up
 *  to the first top-level comma/semicolon (so `let spread = null, fav =
 *  null;` yields `null` for `spread`, not the whole statement). */
function directAssignmentsOf(body, varName) {
  const re = new RegExp(String.raw`\b${varName}\s*=(?!=)\s*([^,;\n]*)[,;]`, 'g');
  return [...body.matchAll(re)].map(mm => mm[1].trim());
}

/** The Favorite+Margin modal ladder: >= 2 direct assignments to `varName`,
 *  every RHS "simple" (0, null, or a possibly-negated bare identifier), and
 *  the non-null/zero set contains both `<mag>` and `-<mag>` for some shared
 *  magnitude name — the home branch and away branch negating each other. */
function isFavoriteMarginLadder(body, varName) {
  const assigns = directAssignmentsOf(body, varName);
  if (assigns.length < 2) return false;
  const isSimple = s => s === '0' || s === 'null' || /^-?[A-Za-z_$][\w$]*$/.test(s);
  if (!assigns.every(isSimple)) return false;
  const mags = assigns.filter(s => s !== '0' && s !== 'null');
  const neg = mags.filter(s => s.startsWith('-'));
  const pos = mags.filter(s => !s.startsWith('-'));
  return neg.length > 0 && pos.length > 0 && neg.some(n => pos.includes(n.slice(1)));
}

/** `varName` is bound via `const { ..., varName, ... } = extractSpread(...)`
 *  — a TRUSTED DERIVER call. Trusted because extractSpread()'s own region is
 *  scanned by this same file and must itself resolve clean (composition, not
 *  blind trust — see the doc comment's shape (e)). */
function isTrustedDeriverBinding(body, varName) {
  const re = new RegExp(String.raw`\bconst\s*\{[^}]*\b${varName}\b[^}]*\}\s*=\s*extractSpread\s*\(`);
  return re.test(body);
}

const isBareIdentifier = s => /^[A-Za-z_$][\w$]*$/.test(s.trim());

/** Classify one occurrence. Returns a label string when SAFE, or null when
 *  UNRESOLVED (deny-by-default — caller decides EXEMPT vs offender). */
function classify(occ, region) {
  const rhs = occ.form === 'colon' ? occ.rhs : occ.field; // shorthand: bare name
  if (isSafeLiteralOrCopy(rhs)) return 'literal-null-zero-or-copy-forward';
  if (isFavoriteTernary(rhs)) return 'favorite-ternary';
  if (isBareIdentifier(rhs)) {
    if (isFavoriteMarginLadder(region.body, rhs)) return 'favorite-margin-ladder';
    if (isTrustedDeriverBinding(region.body, rhs)) return 'trusted-deriver(extractSpread)';
    // One level of indirection through a local binding — same depth
    // gradetest[6]/loadtest[64] follow.
    const binds = directAssignmentsOf(region.body, rhs).filter(b => b !== rhs);
    if (binds.length && binds.every(b => isSafeLiteralOrCopy(b) || isFavoriteTernary(b)))
      return 'favorite-derived (indirect)';
  }
  return null;
}

// ═════════════════════════════════════════════════════════════════════════════
// THE NAMED EXEMPTION LIST. Deny-by-default: an occurrence the scan cannot
// mechanically resolve must be named here with a reason, or the scan fails.
// Keyed by REGION NAME (matching the loadtest[64] EXEMPT convention), because
// every current unresolved occurrence in this codebase falls entirely inside
// exactly two regions — see the report for why nothing else needed one.
// ═════════════════════════════════════════════════════════════════════════════
const EXEMPT = {
  DEMO_GAMES:
    'js/data-model.js — 10 hand-typed { spread, favorite } fixture entries for the Demo week. This IS the class AD-03 exists to prevent: dg8 (Alabama #3 @ Michigan #6) carried spread:-2.5 with favorite:\'Alabama\' from authorship until 2026-08-27 — it rendered "Alabama -2.5" while SCORING as Michigan -2.5, a real shipped grading defect caught only by atstest.mjs §11 (a behavioural check on this one array), not by any structural guard. Exempted because it is frozen, hand-reviewed fixture data behind the Demo-week toggle, not a live weekly data-entry path — but it is the WEAKEST entry on this list and already burned once; Drew should decide whether to replace the literals with a computed helper so this class cannot recur.',
  HISTORICAL_DEMO_GAMES:
    'js/data-model.js — same bucket as DEMO_GAMES immediately above: 10 hand-typed { spread, lockedSpread, favorite } fixture entries, reachable through the Historical Demo week toggle. No dg8-class incident has been found in THIS array specifically, but the same lack of mechanical proof applies equally, for the same reason (static, hand-reviewed-once literals with no computed relationship to `favorite`).',
};

// ═════════════════════════════════════════════════════════════════════════════
// RUN THE SCAN over the real files.
// ═════════════════════════════════════════════════════════════════════════════
const FILES = {
  'app.js': appJsSrc,
  'data-model.js': dataModelSrc,
  'data-provider.js': dataProviderSrc,
  'storage.js': storageSrc,
  'chat-ui.js': chatUiSrc,
};

function runScan(files) {
  const offenders = [];
  const resolved = [];        // { file, region, field, form, rhs, label }
  const exempted = [];        // { file, region, field, form, rhs } — unresolved, but named on EXEMPT
  const seenRegionNames = []; // 'file.js:RegionName' for every region with >=1 occurrence
  const exemptHits = new Set();

  for (const [file, src] of Object.entries(files)) {
    for (const region of regionsOf(src)) {
      for (const field of FIELDS) {
        const occs = objectLiteralOccurrences(region.body, field);
        if (!occs.length) continue;
        seenRegionNames.push(`${file}:${region.name}`);
        for (const occ of occs) {
          const label = classify(occ, region);
          if (label) { resolved.push({ file, region: region.name, field, form: occ.form, rhs: occ.rhs, label }); continue; }
          if (Object.prototype.hasOwnProperty.call(EXEMPT, region.name)) {
            exemptHits.add(region.name);
            exempted.push({ file, region: region.name, field, form: occ.form, rhs: occ.rhs });
            continue;
          }
          offenders.push(`${file}:${region.name}:${field}(${occ.form})="${occ.rhs}"`);
        }
      }
    }
  }
  return { offenders, resolved, exempted, seenRegionNames: [...new Set(seenRegionNames)], exemptHits };
}

console.log('\n[SS] [structural] every spread-sign write in the source is favorite-derived, null/zero, a copy-forward, or a NAMED exemption…');
{
  const { offenders, resolved, exempted, seenRegionNames, exemptHits } = runScan(FILES);

  const byLabel = {};
  for (const r of resolved) byLabel[r.label] = (byLabel[r.label] || 0) + 1;
  const total = resolved.length + exempted.length;
  console.log(`  scanned ${Object.keys(FILES).length} files · ${seenRegionNames.length} regions carry a spread/lockedSpread occurrence · ${total} total occurrences (${resolved.length} resolved safe, ${exempted.length} on a named exemption) · ${Object.keys(EXEMPT).length} named exemptions`);
  console.log(`  resolved by class: ${JSON.stringify(byLabel)}`);
  console.log(`  regions reached: ${seenRegionNames.join(', ')}`);

  // ── THE GUARD ITSELF ────────────────────────────────────────────────────
  assert(offenders.length === 0,
    `every spread-sign write is favorite-derived, null/zero, a copy-forward read, or named on EXEMPT (unaccounted for: ${offenders.join(', ') || 'none'})`);

  // ── NON-VACUOUS. A broken parser that finds nothing would pass everything
  //    above trivially. Pin real numbers so that can't happen unnoticed.
  assert(total >= 50,
    `fixture check: the scan actually parsed real files and examined ${total} occurrences (${resolved.length} resolved + ${exempted.length} exempt) — a broken parser would report 0 and pass everything above (expected >= 50)`);
  assert(exempted.length >= 20,
    `fixture check: the exemption list is actually load-bearing — ${exempted.length} REAL occurrences currently rely on it (DEMO_GAMES' and HISTORICAL_DEMO_GAMES' hand-typed spreads), not zero`);
  assert(Object.keys(byLabel).length >= 4,
    `all four mechanical SAFE classes actually fired at least once each on real code (got ${Object.keys(byLabel).length} distinct classes: ${Object.keys(byLabel).join(', ')}) — proof the classifier isn't just one broad rule swallowing everything`);

  // ── REGION REACH. Proof the scan is looking at the surfaces that have
  //    historically been (or currently are) the risk — not a coincidence of
  //    which functions happen to be near the top of the file.
  const mustReach = [
    'app.js:showGameModal',          // the Favorite+Margin modal — AD-03's canonical fix
    'data-provider.js:parseAndReport', // holds extractSpread()'s destructured write
    'app.js:applyWeekStatusChange',  // manual OPEN->LOCKED freeze
    'app.js:tickAutoTransition',     // auto OPEN->LOCKED freeze — the SECOND lock path
    // F4 (2026-09-12) — the add-to-slate payload's `spread:game.spread`
    // carry-forward was EXTRACTED out of renderAvailableGamesList() into
    // availAddPayloadJSON(), so the Player Requests card's "+ Add to slate"
    // could reuse the add path byte-for-byte. The surface that WRITES a spread
    // sign moved with it, so the required region moves with it too. This is a
    // rename of the same write, not a relaxation: the entry still names a real
    // region, and dropping it (or naming a region that carries no spread
    // occurrence) still fails this assertion.
    'app.js:availAddPayloadJSON',    // carry-forward into an add-to-slate payload
    'data-model.js:createGame',      // the null defaults every game starts from
    'data-model.js:DEMO_GAMES',      // the exempted, previously-wrong fixture array
    'data-model.js:HISTORICAL_DEMO_GAMES',
  ];
  const missing = mustReach.filter(r => !seenRegionNames.includes(r));
  assert(missing.length === 0,
    `the scan reaches every surface that has actually written a spread sign, historically or today (missing: ${missing.join(', ') || 'none'})`);

  // ── EXEMPT LIST HYGIENE. A stale entry is a standing permission attached
  //    to a name, ready to cover whatever gets written under that name next.
  const staleExempt = Object.keys(EXEMPT).filter(n => !exemptHits.has(n));
  assert(staleExempt.length === 0,
    `every EXEMPT entry names a region the scan actually needed it for right now — a fixed or renamed region must be removed, not left as a standing permission (stale: ${staleExempt.join(', ') || 'none'})`);
  const reasonless = Object.entries(EXEMPT).filter(([, why]) => !why || why.length < 40).map(([n]) => n);
  assert(reasonless.length === 0,
    `every exemption carries a written reason, not just a name (reasonless: ${reasonless.join(', ') || 'none'})`);
  assert(Object.keys(EXEMPT).length === 2,
    `exemption list is pinned at exactly 2 entries (DEMO_GAMES, HISTORICAL_DEMO_GAMES) — a widening third entry must be a deliberate, reviewed addition, not a quiet default (got ${Object.keys(EXEMPT).length}: ${Object.keys(EXEMPT).join(', ')})`);

  // ═══════════════════════════════════════════════════════════════════════
  // CANARIES. A green scan must mean "absent", never "unmatchable". Each
  // canary is a shape this codebase has actually produced, or the exact
  // false-coverage shape a weaker scan would miss.
  // ═══════════════════════════════════════════════════════════════════════

  // C1 — hand-typed literal, no exemption. THE shape this guard exists to
  //      catch: a new dg8, in a region not on the EXEMPT list.
  const C1 = `
function leakHandTyped() {
  saveGame({ ...g, spread: -2.5, favorite: 'Alabama' });
}
`;
  {
    const r = runScan({ c1: C1 });
    assert(r.offenders.some(o => o.includes('leakHandTyped')),
      'canary C1: a hand-typed literal sign with no exemption is caught as an offender');
  }

  // C2 — copy-forward read. Must NOT be flagged (freezing/carrying an
  //      already-resolved value forward, RG-style shape from
  //      applyWeekStatusChange/tickAutoTransition/renderAvailableGamesList).
  const C2 = `
function okFreeze(g) {
  saveGame({ ...g, lockedSpread: g.spread });
}
`;
  {
    const r = runScan({ c2: C2 });
    assert(!r.offenders.some(o => o.includes('okFreeze')),
      'canary C2: a copy-forward read of an already-resolved .spread is NOT flagged');
  }

  // C3 — null/zero. Must NOT be flagged (no sign asserted).
  const C3 = `
function okNullZero() {
  return { spread: null, favorite: null, lockedSpread: 0 };
}
`;
  {
    const r = runScan({ c3: C3 });
    assert(!r.offenders.some(o => o.includes('okNullZero')),
      'canary C3: null and 0 literals are NOT flagged — no sign is asserted either way');
  }

  // C4 — the favorite ternary (extractSpread's actual shape), including one
  //      level of indirection through a local, and its mirror-image branch
  //      order. Must NOT be flagged.
  const C4 = `
function okTernary(favorite, awayTeam, magnitude) {
  const homePerspective = favorite === awayTeam ? magnitude : -magnitude;
  return { spread: homePerspective };
}
function okTernaryMirror(favorite, homeTeam, magnitude) {
  const hp = favorite === homeTeam ? -magnitude : magnitude;
  return { spread: hp };
}
`;
  {
    const r = runScan({ c4: C4 });
    assert(!r.offenders.some(o => o.includes('okTernary')) && !r.offenders.some(o => o.includes('okTernaryMirror')),
      'canary C4: the favorite ternary (direct and mirrored) is NOT flagged, including through one level of local indirection');
  }

  // C5 — the favorite-margin ladder, the modal's real shape: a selector
  //      variable gated on 'home'/'away'/'pk', assigning the SAME local
  //      with the away branch and the home branch negating each other.
  //      Must NOT be flagged.
  const C5 = `
function okLadder(favPick, marginVal, ht, at) {
  let spread = null, fav = null;
  if (favPick === 'pk') { spread = 0; fav = null; }
  else if (favPick === 'home') { spread = -marginVal; fav = ht; }
  else if (favPick === 'away') { spread = marginVal; fav = at; }
  onSave({ spread, favorite: fav });
}
`;
  {
    const r = runScan({ c5: C5 });
    assert(!r.offenders.some(o => o.includes('okLadder')),
      'canary C5: the Favorite+Margin modal ladder (shorthand write, home/away branches negating each other) is NOT flagged');
  }

  // C6 — destructuring READ with no corresponding write. Must produce no
  //      offender (there is nothing written here at all).
  const C6 = `
function okDestructureOnly(comp) {
  const { spread, favorite, spreadSource, oddsProvider } = extractSpread(comp);
  return spread;
}
`;
  {
    const r = runScan({ c6: C6 });
    assert(r.offenders.length === 0 && r.resolved.length === 0,
      'canary C6: a destructuring READ with no write anywhere is not flagged and produces no resolved occurrence at all — it is genuinely absent, not silently passed');
  }

  // C7 — RG-27 false-coverage shape: the ONLY mention of `favorite` is in a
  //      comment sitting right next to a hand-typed literal. Must still be
  //      caught — prose does not satisfy the scan.
  const C7 = `
function leakCommentOnly() {
  // derived from favorite === awayTeam ? magnitude : -magnitude, trust me
  saveGame({ ...g, spread: -2.5 });
}
`;
  {
    const r = runScan({ c7: C7 });
    assert(r.offenders.some(o => o.includes('leakCommentOnly')),
      'canary C7: a hand-typed literal is still caught even when a comment right next to it recites the favorite-derivation prose — comments are blanked before scanning');
  }

  // C8 — the exact TRUSTED DERIVER composition shape (extractSpread's return
  //      destructured, then re-spread as shorthand into a second object,
  //      the real createGame(...) call shape). Must NOT be flagged.
  const C8 = `
function okTrustedDeriver(comp, homeTeam, awayTeam) {
  const { spread, favorite, spreadSource, oddsProvider } = extractSpread(comp, homeTeam, awayTeam);
  return createGame('', { homeTeam, awayTeam, spread, favorite, spreadSource, oddsProvider, lockedSpread: null });
}
`;
  {
    const r = runScan({ c8: C8 });
    assert(!r.offenders.some(o => o.includes('okTrustedDeriver')),
      'canary C8: a value destructured out of extractSpread(...) and re-spread as shorthand into createGame(...) is NOT flagged — the real parseAndReport() shape');
  }

  // C9 — EXEMPT covers a region by NAME only. A same-shaped hand-typed
  //      literal in a DIFFERENTLY-named region must still be caught — the
  //      exemption is not a pattern match on the VALUE, only on the name.
  const C9 = `
export const NOT_ON_THE_LIST = [
  { gameId:'x', spread:-9.5, favorite:'Home', lockedSpread:null },
];
`;
  {
    const r = runScan({ c9: C9 });
    assert(r.offenders.some(o => o.includes('NOT_ON_THE_LIST')),
      "canary C9: a hand-typed literal in a region NOT named on EXEMPT is caught, even though it is byte-for-byte the same shape as DEMO_GAMES' entries — exemption is by name, not by pattern");
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// PROVE THE SCAN BINDS: a NEW un-exempted hand-typed write introduced into the
// REAL source (not a synthetic snippet) must turn the scan RED. Done against
// an in-memory string built from the real file content plus one appended
// region — never against the actual file on disk, and no git command is used
// anywhere in this file.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[SS-bind] mutating a real-file copy in memory: a new unexempted hand-typed spread write goes RED…');
{
  const mutated = dataModelSrc + `
export const UN118_STYLE_NEW_SEED = [
  { gameId:'newseed1', spread:-6.5, favorite:'Home Team', lockedSpread:null },
];
`;
  const before = runScan({ 'data-model.js': dataModelSrc });
  const after  = runScan({ 'data-model.js': mutated });
  assert(before.offenders.length === 0,
    'fixture check: the unmutated real data-model.js scans clean before the mutation (isolates what the mutation itself changes)');
  assert(after.offenders.some(o => o.includes('UN118_STYLE_NEW_SEED')),
    'THE BIND: appending a new hand-typed { spread, favorite } literal under an un-exempted name turns the scan RED — a future author cannot add a second DEMO_GAMES-shaped mistake and stay green by accident');
  assert(after.offenders.length === before.offenders.length + 1,
    'the mutation adds EXACTLY one new offender — the scan is not coincidentally already red for an unrelated reason');
}

// ═════════════════════════════════════════════════════════════════════════════
// GUARD-CORRECTNESS CANARIES (reviewer BLOCK, Item SS scan, 2026-09-09):
// isSafeLiteralOrCopy() previously returned "safe copy-forward" whenever the
// RHS merely CONTAINED a `.spread`/`.lockedSpread` substring, so a sign FLIP
// on a copy-forward ref, and a literal-vs-copy ternary, both wrongly scanned
// GREEN. Same in-memory-mutation technique as [SS-bind] above — a real-file
// copy plus one appended region, never the file on disk.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[SS-bind-E1] a sign FLIP on a copy-forward ref (`-g.spread`) goes RED…');
{
  const mutated = dataModelSrc + `
export function un_SS_E1_signFlip(g) {
  saveGame({ ...g, spread: -g.spread });
}
`;
  const before = runScan({ 'data-model.js': dataModelSrc });
  const after  = runScan({ 'data-model.js': mutated });
  assert(before.offenders.length === 0,
    'fixture check: the unmutated real data-model.js scans clean before the E1 mutation');
  assert(after.offenders.some(o => o.includes('un_SS_E1_signFlip')),
    'E1: `spread: -g.spread` is caught — negating an already-resolved ref asserts a NEW sign, it is not a carry-forward');
  assert(after.offenders.length === before.offenders.length + 1,
    'the E1 mutation adds EXACTLY one new offender');
}

console.log('\n[SS-bind-E2] a ternary mixing a copy-forward branch with a hand-typed literal branch goes RED…');
{
  const mutated = dataModelSrc + `
export function un_SS_E2_ternaryLiteral(g, c) {
  saveGame({ ...g, spread: c ? g.spread : -2.5 });
}
`;
  const before = runScan({ 'data-model.js': dataModelSrc });
  const after  = runScan({ 'data-model.js': mutated });
  assert(before.offenders.length === 0,
    'fixture check: the unmutated real data-model.js scans clean before the E2 mutation');
  assert(after.offenders.some(o => o.includes('un_SS_E2_ternaryLiteral')),
    'E2: `spread: c ? g.spread : -2.5` is caught — the hand-typed -2.5 branch introduces a sign the copy-forward branch alone does not cover, this is not a favorite ternary either (condition does not test `favorite`)');
  assert(after.offenders.length === before.offenders.length + 1,
    'the E2 mutation adds EXACTLY one new offender');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(50)}`);
if (fail === 0) console.log(`✅ ALL PASS — ${pass} passed, 0 failed`);
else { console.error(`❌ ${fail} FAILED — ${pass} passed, ${fail} failed`); process.exitCode = 1; }
