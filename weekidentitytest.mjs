// weekidentitytest.mjs — week-identity defects (items 12 / 12b)
//
// Precedent: grouptest.mjs / atstest.mjs / synctest.mjs — a focused standalone
// suite beside loadtest.mjs. Run under BOTH timezones, same as the rest:
//   for tz in UTC America/Los_Angeles; do TZ=$tz node weekidentitytest.mjs; done
//
// THREE distinct symptoms, root-caused separately (they do NOT share a cause):
//   A  — dashboard "Viewing Week" toggle won't list a freshly-created Part 2     [FIXED]
//   B  — "ESPN Week #" field does not update the week name                        [FIXED (DI-135)]
//   C  — roundLabel "Part 2" renders "Week Part 2" not "Week 1, Part 2"           [FIXED (DI-135)]

// ── DOM / browser stubs (same approach as loadtest.mjs) ─────────────────────
// app.js runs `document.addEventListener('DOMContentLoaded', ...)` at module
// top level, so the browser globals must exist BEFORE it is imported. Static
// imports are hoisted and would run first, so app.js is loaded via dynamic
// import() after the stubs are in place — exactly what the harness does.
globalThis.localStorage = { _s:{}, getItem(k){return k in this._s?this._s[k]:null;}, setItem(k,v){this._s[k]=String(v);}, removeItem(k){delete this._s[k];}, clear(){this._s={};} };
globalThis.document = { addEventListener(){}, removeEventListener(){}, getElementById(){return null;}, querySelector(){return null;}, querySelectorAll(){return [];}, createElement:()=>({set innerHTML(v){},get innerHTML(){return '';},appendChild(){},remove(){},addEventListener(){},classList:{add(){},remove(){}},style:{}}), body:{appendChild(){},insertAdjacentHTML(){}} };
globalThis.window = globalThis;
globalThis.requestAnimationFrame = fn => fn();
globalThis.matchMedia = () => ({ matches:false });
globalThis.confirm = () => true;
globalThis.alert = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };

const { selectableDashboardWeeks } = await import('./js/app.js');
const { formatWeekLabel, formatWeekLabelParts, WEEK_STATUS } = await import('./js/data-model.js');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✅ ' + msg); }
  else { fail++; console.log('  ❌ ' + msg); }
}

// ── Fixtures: the exact league state Drew described ─────────────────────────
// "week 1, part 1" is open; he just created "week 1, part 2" (still a draft,
// because createWeek() stamps status:'draft'). The demo week is always present.
const demo  = { weekId:'w_demo', weekNumber:0, status:'open',  dataSourceMode:'demo'   };
const part1 = { weekId:'w_p1',   weekNumber:1, status:'open',  dataSourceMode:'manual' };
const part2 = { weekId:'w_p2',   weekNumber:1, status:'draft', dataSourceMode:'manual', roundLabel:'Part 2' };
const allWeeks = [demo, part1, part2];

// ── SYMPTOM A — the fixed defect ────────────────────────────────────────────
console.log('\n[A] dashboard Viewing-Week toggle lists a freshly-created Part 2…');
{
  // Control: the OLD inline predicate (app.js:1944 before the fix) excluded
  // every draft unconditionally — this is the bug, made permanent so a
  // regression re-introducing it is caught.
  const oldPredicate = w => w.status !== WEEK_STATUS.DRAFT && (w.dataSourceMode !== 'demo' || true /*commissioner*/);
  const oldOptions = allWeeks.filter(oldPredicate).map(w => w.weekId);
  assert(!oldOptions.includes('w_p2'),
    'CONTROL: the old filter dropped the draft Part 2 — exactly what Drew saw (' + oldOptions.join(', ') + ')');

  // Commissioner: Part 2 (draft) is now selectable, alongside Part 1 and demo.
  const commWeeks = selectableDashboardWeeks(allWeeks, true).map(w => w.weekId);
  assert(commWeeks.includes('w_p2'), 'commissioner can now toggle to the draft Part 2 — got [' + commWeeks.join(', ') + ']');
  assert(commWeeks.includes('w_p1') && commWeeks.includes('w_demo'), 'Part 1 and the demo week are still offered to the commissioner');

  // Player: draft AND demo stay hidden — the blind rule and demo gating are untouched.
  const playerWeeks = selectableDashboardWeeks(allWeeks, false).map(w => w.weekId);
  assert(!playerWeeks.includes('w_p2'), 'a player still does NOT see the unopened draft (blind rule intact)');
  assert(!playerWeeks.includes('w_demo'), 'a player still does NOT see the demo week');
  assert(playerWeeks.includes('w_p1'), 'a player still sees the open Part 1');

  // Ordering unchanged: highest weekNumber first.
  const ordered = selectableDashboardWeeks([{weekId:'a',weekNumber:0,status:'open'},{weekId:'b',weekNumber:3,status:'open'}], true).map(w=>w.weekId);
  assert(ordered[0] === 'b', 'ordering preserved — highest week number first');
  assert(selectableDashboardWeeks(null, true).length === 0, 'null weeks yields [] rather than a crash');
}

// ── SYMPTOM B — FIXED (DI-135) — espnWeekNumber now overrides the DISPLAYED
// week number only. It never mutates week.weekNumber — ordering, sorting and
// every identity comparator stay on the real weekNumber, untouched.
console.log('\n[B] espnWeekNumber now overrides the DISPLAYED week number (DI-135)…');
{
  const wk = { weekId:'w_b', weekNumber:2, roundLabel:'', espnWeekNumber:'1' };
  assert(formatWeekLabel(wk) === 'Week 1',
    'espnWeekNumber="1" overrides weekNumber=2 for DISPLAY only — got "' + formatWeekLabel(wk) + '"');
  assert(wk.weekNumber === 2, 'the override never mutates weekNumber itself — ordering stays on 2');
  assert(formatWeekLabel({ weekId:'w_b2', weekNumber:2, roundLabel:'' }) === 'Week 2',
    'no espnWeekNumber set → falls back to weekNumber, unchanged');
  assert(formatWeekLabel({ weekId:'w_b3', weekNumber:2, roundLabel:'', espnWeekNumber:'' }) === 'Week 2',
    'espnWeekNumber:"" (the createWeek default) is treated as unset');
}

// ── SYMPTOM C — FIXED (DI-135) — roundLabel is now a SUFFIX, not a
// full-replacement label. The display number is auto-prepended.
console.log('\n[C] roundLabel is now a SUFFIX — the number is auto-prepended (DI-135)…');
{
  assert(formatWeekLabel({ weekNumber:1, roundLabel:'Part 2' }) === 'Week 1, Part 2',
    'roundLabel="Part 2" alone now yields "Week 1, Part 2" — the reported symptom is fixed');
  assert(formatWeekLabelParts({ weekNumber:1, roundLabel:'Part 1' }).name === 'Week 1, Part 1',
    'loadtest[35] fixture uses "Part 1" (not "1 Part 1") going forward');
  assert(formatWeekLabel({ weekNumber:1, roundLabel:'' }) === 'Week 1',
    'a blank roundLabel still yields plain "Week 1", no trailing comma');
  assert(formatWeekLabel({ weekNumber:1, espnWeekNumber:'7', roundLabel:'Part 2' }) === 'Week 7, Part 2',
    'override number and roundLabel suffix compose together');
  assert(formatWeekLabel({ weekNumber:1, roundLabel:'1, Part 2' }) === 'Week 1, 1, Part 2',
    'DOCUMENTED HAZARD: a pre-DI-135 pre-composed roundLabel (the old workaround) now DOUBLES the number — this is exactly the live Week 1 record; see DI-135 §5 migration note before deploy');
}

console.log(`\nweekidentitytest: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
