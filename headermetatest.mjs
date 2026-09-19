// headermetatest.mjs — Item 9: header feedback button label + stacked
// placement (DI-A1), and week date-range year collapse (DI-A2).
//
// Precedent: weekidentitytest.mjs / grouptest.mjs — a focused standalone
// suite beside loadtest.mjs, not folded into it. Run under BOTH timezones,
// same as the rest:
//   for tz in UTC America/Los_Angeles; do TZ=$tz node headermetatest.mjs; done

import { readFileSync } from 'node:fs';

// ── DOM / browser stubs (same approach as weekidentitytest.mjs) ────────────
// app.js runs top-level DOMContentLoaded wiring, so the browser globals must
// exist BEFORE it is imported. Static imports are hoisted, so app.js is
// loaded via dynamic import() below, after the stubs are in place.
globalThis.localStorage = { _s:{}, getItem(k){return k in this._s?this._s[k]:null;}, setItem(k,v){this._s[k]=String(v);}, removeItem(k){delete this._s[k];}, clear(){this._s={};} };

// Two distinct DOM nodes standing in for #header-meta (the flex host
// setupHeaderFeedbackButton() appends into) and #header-meta-week (the
// separate element refreshHeader() writes the week text/dates into) — kept
// as SEPARATE objects on purpose, so DI-A1's "own element below the
// week-range element" claim is actually checkable: if the button ever
// started getting written into the week element's innerHTML instead of
// appended as a sibling under the host, this test would catch it.
const headerMetaHost = { id:'header-meta', children:[], appendChild(el){ this.children.push(el); } };
const headerMetaWeek = { id:'header-meta-week', _html:'', set innerHTML(v){ this._html = v; }, get innerHTML(){ return this._html; } };
const idMap = { 'header-meta': headerMetaHost, 'header-meta-week': headerMetaWeek };

globalThis.document = {
  addEventListener(){}, removeEventListener(){},
  getElementById(id){
    if (idMap[id]) return idMap[id];
    // setupHeaderFeedbackButton()'s idempotency guard looks up its OWN id
    // after appending — mirror that by searching the host's real children,
    // the same as the browser would.
    return headerMetaHost.children.find(el => el.id === id) || null;
  },
  querySelector(){ return null; }, querySelectorAll(){ return []; },
  createElement(){
    return {
      attrs:{}, classList:{ add(){}, remove(){} }, style:{}, addEventListener(){},
      setAttribute(k,v){ this.attrs[k] = v; },
      _html:'', set innerHTML(v){ this._html = v; }, get innerHTML(){ return this._html; },
    };
  },
  body:{ appendChild(){}, insertAdjacentHTML(){} },
};
globalThis.window = globalThis;
globalThis.requestAnimationFrame = fn => fn();
globalThis.matchMedia = () => ({ matches:false });
globalThis.confirm = () => true;
globalThis.alert = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };

const { setupHeaderFeedbackButton } = await import('./js/app.js');
const { formatWeekLabelParts, formatWeekLabel } = await import('./js/data-model.js');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✅ ' + msg); }
  else { fail++; console.log('  ❌ ' + msg); }
}

// ── (a) collapseYear:true collapses the leading year on a same-year range ──
console.log('\n[a] DI-A2 — collapseYear:true collapses the leading year, same-year range…');
{
  const week = { startDate:'2026-09-03', endDate:'2026-09-07', weekNumber:1 };
  const wl = formatWeekLabelParts(week, { collapseYear:true });
  assert(wl.dates === 'Sep 3 – Sep 7, 2026', 'got "' + wl.dates + '"');
}

// ── (b) HARD GATE — cross-year range must never collapse ───────────────────
console.log('\n[b] DI-A2 — collapseYear:true does NOT collapse a cross-year range (hard gate)…');
{
  const week = { startDate:'2026-12-30', endDate:'2027-01-02', weekNumber:17 };
  const wl = formatWeekLabelParts(week, { collapseYear:true });
  assert(wl.dates.includes('2026') && wl.dates.includes('2027'), 'both years present: "' + wl.dates + '"');
  assert(wl.dates === 'Dec 30, 2026–Jan 2, 2027', 'cross-year keeps the untouched two-full-dates format: "' + wl.dates + '"');
}

// ── (c) flag defaults OFF — the two OTHER callers stay byte-identical ──────
console.log('\n[c] DI-A2 — collapseYear defaults to OFF; other callers are byte-identical to before…');
{
  const week = { startDate:'2026-09-03', endDate:'2026-09-07', weekNumber:1 };
  const wl = formatWeekLabelParts(week); // no options — renderWeekBanner()/renderCommPage()'s exact call shape
  assert(wl.dates === 'Sep 3, 2026–Sep 7, 2026', 'unchanged default output: "' + wl.dates + '"');

  // formatWeekLabel() (the ~20-call-site single-line sibling) never took this
  // option and must be completely unaffected by its existence.
  const single = formatWeekLabel(week);
  assert(single.includes('Sep 3, 2026–Sep 7, 2026'), 'formatWeekLabel() unaffected: "' + single + '"');

  // demo weeks and dateless weeks: untouched regardless of the flag.
  const demoWeek = { dataSourceMode:'demo', weekNumber:0 };
  assert(
    formatWeekLabelParts(demoWeek).dates === '' && formatWeekLabelParts(demoWeek, { collapseYear:true }).dates === '',
    'demo week dates stay empty with the flag either way'
  );

  const singleDateWeek = { startDate:'2026-09-03', weekNumber:1 };
  assert(
    formatWeekLabelParts(singleDateWeek).dates === formatWeekLabelParts(singleDateWeek, { collapseYear:true }).dates,
    'a single-date week (no endDate) is identical with the flag either way'
  );
}

// ── (d) header markup — feedback button is its OWN element, separate from
//        the week-range element (structurally capable of rendering on its
//        own line beneath it, per DI-A1) ───────────────────────────────────
console.log('\n[d] DI-A1 — feedback button renders as its own element, separate from #header-meta-week…');
{
  setupHeaderFeedbackButton();
  assert(headerMetaHost.children.length === 1, 'exactly one button appended to #header-meta');
  const btn = headerMetaHost.children[0];
  assert(btn.id === 'header-feedback-btn', 'appended element is the feedback button');
  assert(btn !== headerMetaWeek, 'button element is NOT the #header-meta-week element (separate DOM node)');
  assert((btn.innerHTML || '').includes('Feedback'), 'button carries the visible "Feedback" text label: ' + btn.innerHTML);
  assert((btn.innerHTML || '').includes('header-feedback-icon'), 'button still carries the icon span');

  // Pre-existing idempotency contract must survive this change.
  setupHeaderFeedbackButton();
  assert(headerMetaHost.children.length === 1, 'second call is a no-op (idempotent) — still exactly one button');
}

// ── CSS: #header-meta is a flex COLUMN, and no min-width media query
//        anywhere in the file reintroduces a row for it (that would defeat
//        "stacked at every width, no desktop breakpoint reintroducing the
//        row"). A text-level check on the shipped CSS, not a rendered-layout
//        assertion — the actual pixel result is a browser-verify, flagged
//        separately below.
console.log('\n[css] #header-meta is flex-direction:column, with no min-width override reintroducing a row…');
{
  const cssPath = new URL('./css/styles.css', import.meta.url);
  const css = readFileSync(cssPath, 'utf8');

  const ruleMatch = css.match(/\.header-meta\{([^}]*)\}/);
  assert(!!ruleMatch, 'found a base .header-meta{...} rule');
  assert(!!ruleMatch && /flex-direction:\s*column/.test(ruleMatch[1]), '.header-meta base rule includes flex-direction:column');

  // Reconstruct each @media block and confirm no min-width block mentions
  // .header-meta at all (the only existing overrides are max-width font-size
  // tweaks, which are fine and untouched by this check since they're inside
  // max-width blocks).
  const mediaBlocks = css.split(/@media/).slice(1).map(s => '@media' + s);
  const minWidthBlocksWithHeaderMeta = mediaBlocks.filter(
    b => /^@media\s*\(min-width/.test(b) && b.includes('.header-meta')
  );
  assert(minWidthBlocksWithHeaderMeta.length === 0, 'no @media (min-width…) block references .header-meta');
}

console.log(`\n${pass} passed, ${fail} failed`);
// REVIEWER F3 (seventh gate, 2026-09-17) — FLUSH BEFORE EXITING.
// `process.exit()` does not drain stdout/stderr, and both are ASYNCHRONOUS
// whenever they are a pipe — which is what they are under loadtest.mjs's
// spawnSync() and under every `| grep` a human runs. So the one summary line a
// parent suite parses can be dropped from a run that really did finish, and a
// FAILING run whose line never arrives reads as a harness problem instead. The
// nested empty writes' callbacks fire only once every earlier write on that
// stream has reached the OS; BOTH streams are drained because loadtest.mjs
// parses `stdout + stderr`. Same fix as authtest.mjs/boottest.mjs, applied
// without changing one character of what is printed.
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail > 0 ? 1 : 0)));

// ── SECURITY F-6 (eighth gate, 2026-09-18) — THE FLUSH SHIM NEEDS ITS OWN
//    BACKSTOP ─────────────────────────────────────────────────────────────────
// The write-then-exit-in-the-callback shim above (reviewer F-3, seventh gate)
// fixed a dropped summary line by making the exit wait for the bytes. That trade
// bought correctness with a new failure mode: if the callback NEVER fires, the
// process never exits. It does not fire when the reader at the other end of the
// pipe has gone away mid-write, when stdout is a full pipe nobody is draining,
// or when an imported module has wedged the event loop — and loadtest.mjs runs
// every one of these suites through spawnSync(), which has no timeout and would
// simply hang the whole sweep with no output to say which suite did it.
//
// So the exit is armed twice. The callback is still the fast path and still the
// one that runs on every healthy run; this timer only ever fires if that path
// did not. .unref() is what keeps it honest — an unref'd timer does not hold the
// event loop open on its own account, so it cannot delay a natural exit by five
// seconds or resurrect a process that was ready to leave. It just makes "hang
// forever" impossible.
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
