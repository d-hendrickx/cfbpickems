/**
 * CFB Pickems — bgjobscardtest.mjs
 * =================================
 * The Background-jobs card's branches that game day 2026-09-26 showed were wrong or mute.
 * Standalone (the grouptest.mjs / synctest.mjs precedent) so the card's copy decisions read
 * start to finish, rather than buried in authtest's 1800 assertions.
 *
 * [1] RG-253 — "Keep-alive heartbeat — Switched on 2d ago, still no run — expected every 360 min.
 *     This job may be dead." The keepalive writes its job_runs rows with league_id NULL (it is a
 *     property of the PROJECT, not of a league — supabase/functions/keepalive/index.js step 4), and
 *     the card's only read, getJobRuns() (js/auth.js), filters `.eq('league_id', leagueId)`. SQL's
 *     `NULL = x` is never true, so NO viewer — commissioner or platform admin — can ever receive a
 *     keepalive row through this card, and the "never ran" branch escalated a job it structurally
 *     cannot see. The card must say that, not declare the job dead.
 * [2] …while a keepalive row that DOES arrive (a future platform-scoped read) still gets the
 *     ordinary staleness rule — the fix is about visibility, not about exempting the job.
 * [3] Non-vacuity: a LEAGUE-scoped scheduled job (reminders) still escalates on silence.
 * [4] ESPN-CLASS (DI note) display half — a failed scores-refresh row that carries the fixed-name ESPN
 *     failure-class counts says WHICH failure, in this file's own words.
 * [5] …a failed row without them renders byte-identically to before.
 * [6] …and only an INTEGER status in [100,599] is ever rendered from failHttpStatus.
 *
 * Run:  node bgjobscardtest.mjs
 * Also: TZ=UTC node bgjobscardtest.mjs && TZ=America/Los_Angeles node bgjobscardtest.mjs
 */

// ── Minimal DOM / localStorage stubs — the feedbackexporttest.mjs shape. ─────────────────────────
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ set innerHTML(v) {}, get innerHTML() { return ''; }, appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {}, classList: { add() {}, remove() {} }, style: {}, id: '', className: '' }),
  body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '' },
  hidden: false,
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined, clipboard: { writeText: async () => {} } }, configurable: true }); }
globalThis.requestAnimationFrame = fn => fn();
globalThis.fetch = async () => { throw new Error('network disabled in bgjobscardtest'); };
globalThis.matchMedia = () => ({ matches: false });
globalThis.confirm = () => true;
globalThis.prompt = () => null;
globalThis.alert = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

const storage = await import('./js/storage.js');
const auth = await import('./js/auth.js');
const app = await import('./js/app.js');

auth.configureAuth({ authMode: 'supabase', dataMode: 'supabase', authModeKnown: true,
  supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' });
storage.setBackendMode('local');
// authtest's resetAll() posture: the Supabase data backend counts as SERVING, so settings writes
// through the seam are accepted (the card reads them back through getSettings()).
auth._setHasSupabaseDataBackendForTest(true);

// A fixed clock, so no sentence here depends on when the suite runs (authtest [49](j)'s lesson).
const NOW = Date.parse('2026-09-26T20:00:00Z');
const ago = (mins) => new Date(NOW - mins * 60000).toISOString();
const render = () => app.renderBackgroundJobsAdminSectionHTML({ now: NOW });
/** The one row for `label`: from its label to the end of that row's status div. */
function rowOf(html, label) {
  const at = html.indexOf(`<div>${label}</div>`);
  if (at === -1) return '';
  const end = html.indexOf('</div>', html.indexOf('<div class="text-xs"', at));
  return html.slice(at, end + 6);
}
const statusOf = (row) => {
  const m = /<div class="text-xs" style="([^"]*)">([^<]*)<\/div>/.exec(row);
  return m ? { style: m[1], text: m[2] } : { style: '', text: '' };
};
const isRed = (st) => /var\(--loss\)/.test(st.style);

console.log('\n[1] RG-253 — keepalive rows are league_id NULL; this card can never see them, so it must never call the job dead…');
{
  app._setBgJobsCacheForTest({ leagueId: 'L-x', rows: [], fetchedAt: NOW, loading: false, error: null });
  storage.saveSetting('serverJobs', { keepalive: true, reminders: true });
  storage.saveSetting('serverJobsFlippedAt', { keepalive: ago(2 * 24 * 60), reminders: ago(10) });
  const st = statusOf(rowOf(render(), 'Keep-alive heartbeat'));
  assert(st.text !== '', `1-0: fixture check — the keepalive row rendered (got ${JSON.stringify(st)})`);
  assert(!/may be dead/.test(st.text),
    `1-1: switched on 2 days ago with no VISIBLE run, the card does NOT say "This job may be dead" (got ${JSON.stringify(st.text)})`);
  assert(!isRed(st), '1-2: …and the line is not painted as a failure');
  assert(/project-wide/.test(st.text) && /can(no|'|&#39;)t be shown here/.test(st.text),
    `1-3: …it says WHY it cannot show the runs: the heartbeat is project-wide and is not logged under this league (got ${JSON.stringify(st.text)})`);
  assert(/Supabase/.test(st.text) && /job_runs/.test(st.text),
    `1-4: …and where to look instead (got ${JSON.stringify(st.text)})`);
  assert(/Switched on 2d ago/.test(st.text), `1-5: …keeping the flip time it always reported (got ${JSON.stringify(st.text)})`);
  storage.saveSetting('serverJobsFlippedAt', {});
  const st2 = statusOf(rowOf(render(), 'Keep-alive heartbeat'));
  assert(!/may be dead/.test(st2.text) && /project-wide/.test(st2.text),
    `1-6: with no recorded flip time the same explanation renders (got ${JSON.stringify(st2.text)})`);
  storage.saveSetting('serverJobs', { keepalive: false });
  const st3 = statusOf(rowOf(render(), 'Keep-alive heartbeat'));
  assert(st3.text === 'Off — the app&#39;s own path is handling this.' || st3.text === "Off — the app's own path is handling this.",
    `1-7: switched OFF, the row is byte-identical to before (got ${JSON.stringify(st3.text)})`);
}

console.log('\n[2] …a keepalive row that DOES arrive still gets the ordinary staleness rule…');
{
  storage.saveSetting('serverJobs', { keepalive: true });
  storage.saveSetting('serverJobsFlippedAt', { keepalive: ago(40 * 60) });
  app._setBgJobsCacheForTest({ leagueId: 'L-x', fetchedAt: NOW, loading: false, error: null,
    rows: [{ job: 'keepalive', runId: 'ka_1', actor: 'cron', ok: true, skipped: null, error: null,
      payload: {}, startedAt: ago(20 * 60 + 1), finishedAt: ago(20 * 60) }] });
  const st = statusOf(rowOf(render(), 'Keep-alive heartbeat'));
  assert(/No run in \d+ min — expected every 360 min\. This job may be dead\./.test(st.text) && isRed(st),
    `2-1: a VISIBLE keepalive row 20h old still escalates (got ${JSON.stringify(st.text)})`);
  app._setBgJobsCacheForTest({ leagueId: 'L-x', fetchedAt: NOW, loading: false, error: null,
    rows: [{ job: 'keepalive', runId: 'ka_2', actor: 'cron', ok: true, skipped: null, error: null,
      payload: { leagues: 1, pruned: 0 }, startedAt: ago(61), finishedAt: ago(60) }] });
  const ok = statusOf(rowOf(render(), 'Keep-alive heartbeat'));
  assert(/^Last ran 1h ago · leagues: 1, pruned: 0$/.test(ok.text),
    `2-2: …and a fresh one renders the ordinary success line (got ${JSON.stringify(ok.text)})`);
}

console.log('\n[3] Non-vacuity — a LEAGUE-scoped scheduled job still escalates on silence…');
{
  app._setBgJobsCacheForTest({ leagueId: 'L-x', rows: [], fetchedAt: NOW, loading: false, error: null });
  storage.saveSetting('serverJobs', { reminders: true });
  storage.saveSetting('serverJobsFlippedAt', { reminders: ago(20) });
  const st = statusOf(rowOf(render(), 'Pick reminders'));
  assert(/Switched on 20 min ago, still no run — expected every 5 min\. This job may be dead\./.test(st.text) && isRed(st),
    `3-1: reminders (league_id set) with no run 20 min after flip still reads "may be dead" (got ${JSON.stringify(st.text)})`);
}

console.log('\n[4] ESPN-CLASS (DI note) — a failed scores-refresh row says WHICH ESPN failure…');
const srRow = (payload, error = 'espn_fetch_failed') => ({
  job: 'scores-refresh', runId: 'sr_1', actor: 'cron', ok: false, skipped: null, error,
  payload, startedAt: ago(3), finishedAt: ago(2),
});
storage.saveSetting('serverJobs', { scoresRefresh: true });
storage.saveSetting('serverJobsFlippedAt', {});
{
  const cases = [
    [{ errors: 1, failHttp4xx: 1, failHttpStatus: 403 }, /FAILED — espn_fetch_failed · ESPN refused the request \(HTTP 403\)$/],
    [{ errors: 1, failHttp5xx: 1, failHttpStatus: 503 }, /FAILED — espn_fetch_failed · ESPN had a server error \(HTTP 503\)$/],
    [{ errors: 1, failTimeout: 1 }, /FAILED — espn_fetch_failed · ESPN did not answer in time$/],
    [{ errors: 1, failNetwork: 1 }, /FAILED — espn_fetch_failed · could not reach ESPN$/],
    [{ errors: 1, failParse: 1 }, /FAILED — espn_fetch_failed · ESPN's reply was not readable$/],
    [{ errors: 1, failTooLarge: 1 }, /FAILED — espn_fetch_failed · ESPN's reply was over the size cap$/],
    [{ errors: 1, failNoEvents: 1 }, /FAILED — espn_fetch_failed · ESPN returned no games$/],
    [{ errors: 2, failHttp4xx: 1, failHttp5xx: 1, failHttpStatus: 429 }, /· ESPN refused the request; ESPN had a server error \(HTTP 429\)$/],
  ];
  for (const [payload, re] of cases) {
    app._setBgJobsCacheForTest({ leagueId: 'L-x', rows: [srRow(payload)], fetchedAt: NOW, loading: false, error: null });
    const st = statusOf(rowOf(render(), 'Live score refresh'));
    const shown = st.text.replace(/&#39;/g, "'");
    assert(re.test(shown) && isRed(st), `4: ${JSON.stringify(payload)} -> ${JSON.stringify(shown)}`);
  }
}

console.log('\n[4b] …and an OK row whose run had a failed bucket says it in words, not raw key names…');
{
  app._setBgJobsCacheForTest({ leagueId: 'L-x', fetchedAt: NOW, loading: false, error: null, rows: [{
    job: 'scores-refresh', runId: 'sr_ok', actor: 'cron', ok: true, skipped: null, error: null,
    payload: { weeks: 1, games: 2, updated: 1, final: 0, refused: 0, errors: 1, failHttp4xx: 1, failHttpStatus: 403 },
    startedAt: ago(3), finishedAt: ago(2),
  }] });
  const st = statusOf(rowOf(render(), 'Live score refresh'));
  assert(!/fail[A-Z]\w*/.test(st.text),
    `4b-1: no raw fail* key name reaches the line (got ${JSON.stringify(st.text)})`);
  assert(st.text === 'Last ran 2 min ago · weeks: 1, games: 2, updated: 1, final: 0, refused: 0, errors: 1 · ESPN refused the request (HTTP 403)',
    `4b-2: the counts render as before, then the class in words (got ${JSON.stringify(st.text)})`);
  assert(!isRed(st), '4b-3: …and an OK run is still not painted as a failure');
  app._setBgJobsCacheForTest({ leagueId: 'L-x', fetchedAt: NOW, loading: false, error: null, rows: [{
    job: 'scores-refresh', runId: 'sr_ok2', actor: 'cron', ok: true, skipped: null, error: null,
    payload: { weeks: 1, games: 1, updated: 1, final: 1, refused: 0, errors: 0 },
    startedAt: ago(3), finishedAt: ago(2),
  }] });
  const clean = statusOf(rowOf(render(), 'Live score refresh'));
  assert(clean.text === 'Last ran 2 min ago · weeks: 1, games: 1, updated: 1, final: 1, refused: 0, errors: 0',
    `4b-4: a clean OK row is byte-identical to before (got ${JSON.stringify(clean.text)})`);
}

console.log('\n[5] …a failed row WITHOUT the class keys is byte-identical to before…');
{
  app._setBgJobsCacheForTest({ leagueId: 'L-x', rows: [srRow({ errors: 1 })], fetchedAt: NOW, loading: false, error: null });
  const st = statusOf(rowOf(render(), 'Live score refresh'));
  assert(st.text === 'Last ran 2 min ago · FAILED — espn_fetch_failed',
    `5-1: an old-shape row renders exactly the old line (got ${JSON.stringify(st.text)})`);
}

console.log('\n[6] …and only an INTEGER status in [100,599] is ever rendered…');
{
  for (const bad of ['<b>403</b>', 403.5, 42, 1000, '403']) {
    app._setBgJobsCacheForTest({ leagueId: 'L-x', rows: [srRow({ errors: 1, failHttp4xx: 1, failHttpStatus: bad })], fetchedAt: NOW, loading: false, error: null });
    const st = statusOf(rowOf(render(), 'Live score refresh'));
    assert(/· ESPN refused the request$/.test(st.text) && !/HTTP/.test(st.text) && !/&lt;b&gt;|<b>/.test(st.text),
      `6: failHttpStatus ${JSON.stringify(bad)} is not rendered (got ${JSON.stringify(st.text)})`);
  }
}

app._setBgJobsCacheForTest({});
storage.saveSetting('serverJobs', {});
storage.saveSetting('serverJobsFlippedAt', {});

console.log(`\n${'─'.repeat(70)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n${'─'.repeat(70)}`);
// Flush before exiting, with the unref'd backstop (loadtest.mjs's reviewer F3 / security F-6 shape):
// loadtest parses this summary line off a pipe, and a bare process.exit() can drop it.
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
