#!/usr/bin/env node
/**
 * CFB Pickems - tests/kits/d1-stall-mutants.mjs (D1 / v0.30.0, thread 100726-D1; the S-3 mutation kit of DI-557, the stall banner; feature-builder, 2026-10-14)
 * ================================================================================================================================================================
 * THE ITEM'S KIT (S-3, D-69): every mutant the builder used to prove the stall banner's tests are not vacuous, encoded so the reviewer re-runs them and adds only gap mutants.
 * Each mutant is applied to a COPY of this cfb-pickems tree (never the checkout: no git restore, no stash, no in-place edit), the named suite is run IN THE COPY, and the mutant is
 * CAUGHT only if the suite exits non-zero AND every check named in `red` prints a cross. The copy's files go back to the checkout's own text before the next mutant, and every restore
 * is compared byte for byte; after the last mutant the suites are run once more on the restored copy and must be GREEN.
 *
 * Suites: sportstalltest.mjs (node, about 10 s), sportstallbrowsertest.mjs (real headless Chromium, about 60 s; SPORTSTALL_ROOT points it at the copy), xsstest.mjs (about 35 s).
 * The mutants DI-557 #10 names are S-01 (threshold 3 to 1), S-10 (no clear on success), S-31 (escHtml dropped), S-34 (the red-visible check removed), S-16 (a player gets trigger 1),
 * S-40 (the record keyed by sport, one record shared) and S-41 (the record written through the storage seam); the rest are the gap mutants found while writing the tests.
 *
 * Run:  node tests/kits/d1-stall-mutants.mjs                    every mutant (the Chromium ones dominate: allow about 12 minutes)
 *       node tests/kits/d1-stall-mutants.mjs S-01 S-10          just those
 *       node tests/kits/d1-stall-mutants.mjs --node             every mutant whose suite is not the browser one (about 6 minutes)
 *       node tests/kits/d1-stall-mutants.mjs --discover S-01    print the red lines instead of judging (how `red` was recorded)
 *       node tests/kits/d1-stall-mutants.mjs --anchors          only check every mutant's anchor text still matches exactly once (instant)
 * Exit 0 only when every mutant is CAUGHT. It is NOT registered with the runner: it copies the tree and takes minutes.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CFB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MOD = 'js/sport-stall.js', APP = 'js/app.js', DP = 'js/data-provider.js', CSS = 'css/styles.css', SW = 'service-worker.js', LT = 'loadtest.mjs', NG = 'js/nav-gestures.js';
const ST = 'sportstalltest.mjs', SB = 'sportstallbrowsertest.mjs', XS = 'xsstest.mjs';

// { id, what, edits: [{ file, find, replace }], suite, red: [labels that must print a cross] } - every `find` must match EXACTLY once in its file.
const e = (file, find, replace) => ({ file, find, replace });
const MUTANTS = [
  // -- the threshold, the record, the outcomes --
  { id: 'S-01', what: 'the banner needs ONE failed poll, not three', edits: [e(MOD, 'export const STALL_FAILURE_THRESHOLD = 3;', 'export const STALL_FAILURE_THRESHOLD = 1;')], suite: ST, red: ['[1b]', '[1x]'] },
  { id: 'S-02', what: 'the banner needs FOUR failed polls', edits: [e(MOD, 'export const STALL_FAILURE_THRESHOLD = 3;', 'export const STALL_FAILURE_THRESHOLD = 4;')], suite: ST, red: ['[1b]', '[1v]'] },
  { id: 'S-03', what: 'the threshold compares > instead of >= (a third failure is not enough)', edits: [e(MOD, 'pollFailures(health, f.competitionId) >= STALL_FAILURE_THRESHOLD', 'pollFailures(health, f.competitionId) > STALL_FAILURE_THRESHOLD')], suite: ST, red: ['[1v]', '[1w]'] },
  { id: 'S-10', what: 'a successful poll does not reset the count (cumulative, never cleared)', edits: [e(MOD, 'health.set(id, { ...rec, failures: 0, lastSuccessAt: nowMs });', 'health.set(id, { ...rec, lastSuccessAt: nowMs });')], suite: ST, red: ['[1h]', '[1i]'] },
  { id: 'S-11', what: 'a poll that never reached ESPN CLEARS the count', edits: [e(MOD, "  return false;\n}\n\nexport function pollFailures", "  health.set(id, { ...rec, failures: 0 });\n  return false;\n}\n\nexport function pollFailures")], suite: ST, red: ['[1e]', '[1f]'] },
  { id: 'S-12', what: 'a poll that never reached ESPN COUNTS as a failure', edits: [e(MOD, "  if (outcome === 'failed') {", "  if (outcome !== 'ok' && outcome !== 'empty') {")], suite: ST, red: ['[1e]', '[1f]'] },
  { id: 'S-13', what: 'a scoreboard with zero events is neutral (it does not clear)', edits: [e(MOD, "  if (outcome === 'ok' || outcome === 'empty') {", "  if (outcome === 'ok') {")], suite: ST, red: ['[1i]', '[2m]'] },
  { id: 'S-14', what: 'a scoreboard with zero events counts as a FAILURE', edits: [e(MOD, "  if (outcome === 'failed') {", "  if (outcome === 'failed' || outcome === 'empty') {")], suite: ST, red: ['[1i]', '[2m]'] },
  { id: 'S-15', what: 'the fetch reports a zero-event board as FAILED (the structural outcome is gone)', edits: [e(DP, "result.error ? (result.rawEventCount === 0 ? 'empty' : 'failed') : 'ok'", "result.error ? 'failed' : 'ok'")], suite: ST, red: ['[2m]', '[2n]'] },
  { id: 'S-17', what: 'the fetch reports every bucket as ok (a failed poll is never seen)', edits: [e(DP, "result.error ? (result.rawEventCount === 0 ? 'empty' : 'failed') : 'ok'", "'ok'")], suite: ST, red: ['[2a]', '[2b]'] },
  { id: 'S-40', what: 'ONE record is shared by every competition (one sport\'s failures count against another\'s)', edits: [e(APP, 'return notePoll(_sportPollHealth, comp.id, bucketOutcomes.get(bucket), Date.now());', "return notePoll(_sportPollHealth, 'shared', bucketOutcomes.get(bucket), Date.now());"), e(MOD, 'pollFailures(health, f.competitionId) >= STALL_FAILURE_THRESHOLD', "pollFailures(health, 'shared') >= STALL_FAILURE_THRESHOLD")], suite: ST, red: ['[1v]', '[1w]'] },
  { id: 'S-42', what: 'the poll is scored against the CFB bucket whatever the competition\'s sport', edits: [e(APP, 'const bucket = espnKeyForSport(comp.sport);', "const bucket = 'college-football';")], suite: ST, red: ['[2a]', '[2b]'] },
  { id: 'S-41', what: 'the record is written through the storage seam', edits: [e(APP, "  if (!bucket) return false;\n  return notePoll(", "  if (!bucket) return false;\n  saveSetting('stallPollHealth', String(Date.now()));\n  return notePoll(")], suite: ST, red: ['[6e]', '[10i]'] },
  { id: 'S-43', what: 'a poll with no game to refresh is counted as a failure (it never reached ESPN)', edits: [e(APP, '  if (!refreshable.length) return;\n  const{updated,errors,liveStatusByEventId,bucketOutcomes}', "  if (!refreshable.length) { recordSportPoll(week, new Map([['nfl', 'failed'], ['college-football', 'failed']])); return; }\n  const{updated,errors,liveStatusByEventId,bucketOutcomes}")], suite: ST, red: ['[3c]', '[10l]'] },
  { id: 'S-44', what: 'a demo or manual week is counted as a failure by the tick (it never reached ESPN)', edits: [e(APP, "  if (week.dataSourceMode === 'demo' || week.dataSourceMode === 'manual') continue;\n  // ══ DI-T6.6's CLIENT GATE", "  if (week.dataSourceMode === 'demo' || week.dataSourceMode === 'manual') { recordSportPoll(week, new Map([['nfl', 'failed'], ['college-football', 'failed']])); continue; }\n  // ══ DI-T6.6's CLIENT GATE")], suite: ST, red: ['[3a-demo]', '[3b-demo]'] },
  { id: 'S-45', what: 'a tick that arrives while the last round is running is not skipped', edits: [e(APP, "  if (_autoRefreshInFlight) { console.info('[autoRefresh] the previous round is still running — this one is skipped, not queued.'); return; }\n", '')], suite: ST, red: ['[3e]', '[3f]'] },
  { id: 'S-46', what: 'the poll is recorded AFTER the merge loop (a throw in it loses the observation)', edits: [e(APP, "  try { if (recordSportPoll(week, bucketOutcomes)) repaintSportStallBannerInPlace(); } catch (e) { console.warn('[sport-stall] the poll could not be recorded', e); }\n", ''), e(APP, "  if(errors.length)console.warn('[Refresh]',errors);\n}", "  if(errors.length)console.warn('[Refresh]',errors);\n  try { if (recordSportPoll(week, bucketOutcomes)) repaintSportStallBannerInPlace(); } catch (e) { console.warn('[sport-stall] the poll could not be recorded', e); }\n}")], suite: ST, red: ['[10m]'] },
  { id: 'S-47', what: 'an account or league change does not clear the record', edits: [e(APP, 'clearPollHealth(_sportPollHealth); _stallPainted.clear(); _stallVisit = null;', '_stallPainted.clear(); _stallVisit = null;')], suite: ST, red: ['[3c]', '[3d]'] },
  { id: 'S-48', what: 'an account or league change does not clear the painted-state memory', edits: [e(APP, 'clearPollHealth(_sportPollHealth); _stallPainted.clear(); _stallVisit = null;', 'clearPollHealth(_sportPollHealth); _stallVisit = null;')], suite: ST, red: ['[6i]', '[8o]'] },
  // -- the window --
  { id: 'S-20', what: 'the live window\'s tail is 12 h, not the server\'s 6 h', edits: [e(MOD, 'export const STALL_WINDOW_HOURS = 6;', 'export const STALL_WINDOW_HOURS = 12;')], suite: ST, red: ['[1b]', '[1r]'] },
  { id: 'S-21', what: 'a week whose games are all FINAL is still in the window', edits: [e(MOD, "  if (!list.some((g) => g.status !== 'final')) return false;\n", '')], suite: ST, red: ['[1q]', '[4b]'] },
  { id: 'S-22', what: 'a Draft, Open or Final week is in the window', edits: [e(MOD, "  if (week.status !== 'locked' && week.status !== 'live') return false;\n", '')], suite: ST, red: ['[1n]', '[4e]'] },
  { id: 'S-23', what: 'a kickoff still ahead opens the window (locked before the first game)', edits: [e(MOD, 'return Number.isFinite(k) && k <= now && k >= now - STALL_WINDOW_HOURS * HOUR_MS;', 'return Number.isFinite(k) && k >= now - STALL_WINDOW_HOURS * HOUR_MS;')], suite: ST, red: ['[1p]', '[4c]'] },
  { id: 'S-24', what: 'the 6 h tail never ends (no lower bound)', edits: [e(MOD, 'return Number.isFinite(k) && k <= now && k >= now - STALL_WINDOW_HOURS * HOUR_MS;', 'return Number.isFinite(k) && k <= now;')], suite: ST, red: ['[1r]', '[4c]'] },
  { id: 'S-25', what: 'a demo or manual week is not excluded', edits: [e(MOD, "const isDemoOrManual = (week) => !!week && (week.dataSourceMode === 'demo' || week.dataSourceMode === 'manual');", 'const isDemoOrManual = () => false;')], suite: ST, red: ['[1o]', '[1ah]'] },
  { id: 'S-26', what: 'a MANUAL week is not excluded (only demo is)', edits: [e(MOD, " || week.dataSourceMode === 'manual');", ');')], suite: ST, red: ['[1o]', '[5h]'] },
  { id: 'S-27', what: 'trigger 2 ignores the window entirely', edits: [e(MOD, ' && inActiveWindow(week, games, nowMs)) {', ') {')], suite: ST, red: ['[4b]', '[4c]'] },
  // -- the rows, the audiences --
  { id: 'S-16', what: 'a PLAYER gets the trigger-1 diagnostic', edits: [e(MOD, 'if (f.live && isCommissioner) rows.push({ trigger: 1', 'if (f.live) rows.push({ trigger: 1')], suite: ST, red: ['[1ab]'] },
  { id: 'S-17b', what: 'trigger 1 fires for a competition that is not live', edits: [e(MOD, 'if (f.live && isCommissioner) rows.push({ trigger: 1', 'if (isCommissioner) rows.push({ trigger: 1')], suite: ST, red: ['[1ac]', '[5m]'] },
  { id: 'S-19', what: 'a competition whose current week cannot be READ is read as "no week" (a false trigger-1 alarm for the commissioner)', edits: [e(APP, 'try { week = getCurrentWeekFor(c.id); } catch { return null; }', 'try { week = getCurrentWeekFor(c.id); } catch { week = null; }')], suite: ST, red: ['[5n]'] },
  { id: 'S-18', what: 'the app marks every competition live (an idle sport raises trigger 1)', edits: [e(APP, 'live: liveIds.has(c.id), week,', 'live: true, week,')], suite: ST, red: ['[5l]', '[5m]'] },
  { id: 'S-28', what: 'a player is shown the commissioner\'s trigger-2 diagnostic', edits: [e(MOD, 'text: isCommissioner ? STALL_COPY.feedCommissioner(f.label) : STALL_COPY.feedPlayer(f.label) });', 'text: STALL_COPY.feedCommissioner(f.label) });')], suite: ST, red: ['[1w]', '[1ak]'] },
  { id: 'S-29', what: 'a player is shown the commissioner\'s trigger-3 diagnostic (the unknown code leaks into player copy)', edits: [e(MOD, 'if (isCommissioner) {\n      if (seenCodes.has(u.code)) continue;', 'if (true) {\n      if (seenCodes.has(u.code)) continue;')], suite: ST, red: ['[1ae]', '[1ak]'] },
  { id: 'S-30', what: 'a FINAL game with an unknown tag still raises trigger 3', edits: [e(MOD, "const live = games.filter((g) => g.status !== 'final');", 'const live = games;')], suite: ST, red: ['[1af]', '[5g]'] },
  { id: 'S-35', what: 'the unrecognized sport key of a competition (UnknownSportError) is ignored', edits: [e(MOD, 'if (f.unknownCode) codes.add(clip(f.unknownCode));', '')], suite: ST, red: ['[1ai]', '[5j]'] },
  { id: 'S-36', what: 'an unrecognized code is not clipped to 40 characters', edits: [e(MOD, 'const clip = (v) => String(v).slice(0, 40);', 'const clip = (v) => String(v);')], suite: ST, red: ['[1al]'] },
  { id: 'S-37', what: 'the app\'s label for a sport is not clipped', edits: [e(APP, 'label: (labels.get(c.sport) || String(c.sport)).slice(0, 40), live:', 'label: (labels.get(c.sport) || String(c.sport)), live:')], suite: ST, red: ['[6a3]'] },
  { id: 'S-38', what: 'a recognized ESPN key is treated as unknown (trigger 3 for every game)', edits: [e(APP, "const stallKnownSport = (tag) => typeof tag === 'string' && Object.prototype.hasOwnProperty.call(ESPN_SPORT_ENDPOINTS, tag);", 'const stallKnownSport = () => false;')], suite: ST, red: ['[2a]', '[2b]'] },
  { id: 'S-39', what: 'an unrecognized game tag is treated as known (trigger 3 never fires)', edits: [e(APP, "const stallKnownSport = (tag) => typeof tag === 'string' && Object.prototype.hasOwnProperty.call(ESPN_SPORT_ENDPOINTS, tag);", 'const stallKnownSport = () => true;')], suite: ST, red: ['[5e]', '[5f]'] },
  { id: 'S-49', what: 'an archived sport still raises a row', edits: [e(APP, ".filter((c) => c && c.id && !c.archivedAt);\n  if (!comps.length) return [];", ".filter((c) => c && c.id);\n  if (!comps.length) return [];")], suite: ST, red: ['[8u5]'] },
  { id: 'S-50', what: 'a player is shown the same sentence twice (the dedupe is gone)', edits: [e(MOD, 'return rows.filter((r) => { if (seenText.has(r.text)) return false; seenText.add(r.text); return true; });', 'return rows;')], suite: ST, red: ['[1ak]'] },
  // -- the markup, the key, the escaping --
  { id: 'S-31', what: 'the row text is not escaped (escHtml dropped)', edits: [e(MOD, '<p>${esc(r.text)}</p>', '<p>${r.text}</p>')], suite: ST, red: ['[1au]', '[6a]'] },
  { id: 'S-31b', what: 'the row text is not escaped - proved against the REAL escaper by xsstest [9c-5]', edits: [e(APP, 'sportStallBannerHTML(rows, { escHtml, animate });   // xsstest', "sportStallBannerHTML(rows, { escHtml: (s) => String(s ?? ''), animate });   // xsstest")], suite: XS, red: ['[9c-5]'] },
  { id: 'S-32', what: 'data-rows is not escaped', edits: [e(MOD, 'data-rows="${esc(stallRowsKey(rows))}"', 'data-rows="${stallRowsKey(rows)}"')], suite: ST, red: ['[1au]'] },
  { id: 'S-33', what: 'the repaint key carries the sentence (a sport code reaches an attribute)', edits: [e(MOD, '`${r.competitionId}:${r.trigger}`', '`${r.competitionId}:${r.trigger}:${r.text}`')], suite: ST, red: ['[1an]', '[1ao]'] },
  { id: 'S-51', what: 'the banner is role="alert" (it would cut into VoiceOver mid-read)', edits: [e(MOD, 'id="sport-stall-banner" role="status"', 'id="sport-stall-banner" role="alert"')], suite: ST, red: ['[1ap]'] },
  // -- red wins, the hydrate guard --
  { id: 'S-34', what: 'the red banner is not consulted: both banners show', edits: [e(APP, 'if (ownsPage && !isContentWithheld() && !backendErrorBannerShowing()) {', 'if (ownsPage && !isContentWithheld()) {')], suite: ST, red: ['[7c]', '[7e]'] },
  { id: 'S-52', what: 'the banner stays withheld after the red one is hidden (its display is not read)', edits: [e(APP, "return !!red && red.style?.display !== 'none';", 'return !!red;')], suite: ST, red: ['[7g]'] },
  { id: 'S-53', what: 'nothing asks isContentWithheld() before the rows are computed', edits: [e(APP, 'if (ownsPage && !isContentWithheld() && !backendErrorBannerShowing()) {', 'if (ownsPage && !backendErrorBannerShowing()) {')], suite: ST, red: ['[3h]', '[10o]'] },
  // -- paint paths, scope, order, motion --
  { id: 'S-60', what: 'Picks and Standings show every sport\'s rows (no context scope)', edits: [e(APP, '  return [getActiveSportKey()];\n}', '  return null;\n}')], suite: ST, red: ['[8c]'] },
  { id: 'S-61', what: 'Home is scoped to the context sport (it must list every sport: Game Day is league-wide)', edits: [e(APP, "  if (tab === 'home' || tab === 'commissioner') return null;", "  if (tab === 'commissioner') return null;")], suite: ST, red: ['[2c]', '[2d]'] },
  { id: 'S-62', what: 'the Dashboard under All sports lists sports the viewer does not play', edits: [e(APP, 'return scope === DASHBOARD_ALL ? playedSports().map((s) => s.dbCode) : [scope];', 'return scope === DASHBOARD_ALL ? null : [scope];')], suite: ST, red: ['[8h]', '[8l]'] },
  { id: 'S-63', what: 'the Rules page is given a stall banner', edits: [e(MOD, "export const STALL_PAGES = Object.freeze(['home', 'picks', 'dashboard', 'leaderboard', 'commissioner']);", "export const STALL_PAGES = Object.freeze(['home', 'picks', 'dashboard', 'leaderboard', 'commissioner', 'rules']);"), e(APP, "const STALL_PAGE_IDS = { home: 'page-home',", "const STALL_PAGE_IDS = { rules: 'page-rules', home: 'page-home',")], suite: ST, red: ['[1b]'] },
  { id: 'S-64', what: 'the banner is seated ABOVE the maintenance and paused-league notices', edits: [e(APP, "  if (above && typeof above.insertAdjacentHTML === 'function') above.insertAdjacentHTML('afterend', html); else c.insertAdjacentHTML('afterbegin', html);", "  c.insertAdjacentHTML('afterbegin', html);")], suite: ST, red: ['[8n3-picks]', '[8n3-leaderboard]'] },
  { id: 'S-65', what: 'a copy of the banner left in another page is not removed (two in the document)', edits: [e(APP, "  for (const id of Object.values(STALL_PAGE_IDS)) { if (id !== STALL_PAGE_IDS[tab]) document.getElementById(id)?.querySelector?.('#sport-stall-banner')?.remove?.(); }\n", '')], suite: ST, red: ['[3g]', '[8e]'] },
  { id: 'S-66', what: 'an unchanged row set replaces the node (the fade would replay on every repaint)', edits: [e(APP, "  if (rows.length && here && prev.sig === sig && here.getAttribute?.('data-rows') === key) return;   // unchanged: the node is left as it is\n", '')], suite: ST, red: ['[7h]', '[8o]'] },
  { id: 'S-67', what: 'every paint adds the fade class (the page rebuilds every tick: a fade every minute)', edits: [e(APP, '{ escHtml, animate: key !== prev.key });', '{ escHtml, animate: true });')], suite: SB, red: ['C-3:', 'C-4:'] },
  { id: 'S-68', what: 'the fade class is never added (a changed row set arrives without its one fade)', edits: [e(APP, '{ escHtml, animate: key !== prev.key });', '{ escHtml, animate: false });')], suite: ST, red: ['[7h]', '[8o]'] },
  { id: 'S-69', what: 'a repaint of a page that is not on screen takes the visible page\'s banner away', edits: [e(APP, "  if (!STALL_PAGES.includes(tab) || state.currentTab !== tab) return;\n  const c = document.getElementById(STALL_PAGE_IDS[tab]);", "  if (!STALL_PAGES.includes(tab)) return;\n  const c = document.getElementById(STALL_PAGE_IDS[tab]);")], suite: ST, red: ['[8u4]'] },
  { id: 'S-70', what: 'a league-flow screen that owns the Home section is painted over', edits: [e(APP, "const ownsPage = tab === 'home' ? !!c.querySelector('#home-root') : (tab !== 'commissioner' || isComm);", "const ownsPage = tab === 'home' ? true : (tab !== 'commissioner' || isComm);")], suite: ST, red: ['[8u2]'] },
  { id: 'S-71', what: 'a non-commissioner is painted a banner on the Comm page', edits: [e(APP, "const ownsPage = tab === 'home' ? !!c.querySelector('#home-root') : (tab !== 'commissioner' || isComm);", "const ownsPage = tab === 'home' ? !!c.querySelector('#home-root') : true;")], suite: ST, red: ['[8u3]', '[8u3b]'] },
  { id: 'S-72', what: 'a poll that changes the record does not repaint the page in place (Picks, Standings and Comm never get it)', edits: [e(APP, "  try { if (recordSportPoll(week, bucketOutcomes)) repaintSportStallBannerInPlace(); } catch (e) { console.warn('[sport-stall] the poll could not be recorded', e); }", "  try { recordSportPoll(week, bucketOutcomes); } catch (e) { console.warn('[sport-stall] the poll could not be recorded', e); }")], suite: ST, red: ['[2e]', '[7i]'] },
  { id: 'S-73', what: 'the in-place paint ignores a touch that owns the page (it lands under the finger)', edits: [e(APP, '  if (deferInPlaceRepaint(tab, repaintSportStallBannerInPlace)) return;\n', '')], suite: ST, red: ['[9j]', '[9m]'] },
  // -- nothing moves under the thumb --
  { id: 'S-74', what: 'navigateTo() no longer calls the stall banner as the catch-all', edits: [e(APP, "  if (!linkFlow && !leagueFlow) renderSportStallBannerIfNeeded(tab);\n", '')], suite: ST, red: ['[8u3]', '[10d]'] },
  { id: 'S-75', what: 'the Standings render no longer ends with the stall banner', edits: [e(APP, "  renderSportStallBannerIfNeeded('leaderboard');   // D1 / DI-557\n", '')], suite: ST, red: ['[10a-leaderboard]'] },
  { id: 'S-76', what: 'the Dashboard render no longer ends with the stall banner', edits: [e(APP, "  renderSportStallBannerIfNeeded('dashboard');   // D1 / DI-557\n", '')], suite: ST, red: ['[10a-dashboard]'] },
  { id: 'S-77', what: 'Comm no longer ends with the stall banner', edits: [e(APP, "  renderSportStallBannerIfNeeded('commissioner');   // D1 / DI-557: every non-archived sport, whatever the lens says; above the tab strip like its siblings\n", '')], suite: ST, red: ['[10a-commissioner]'] },
  { id: 'S-78', what: 'the Home paint no longer calls the stall banner', edits: [e(APP, "  renderSportStallBannerIfNeeded('home');   // D1 / DI-557: below the other notices, outside #home-root like them\n", '')], suite: ST, red: ['[10c]'] },
  { id: 'S-79', what: 'the Picks page\'s historical-week exit no longer calls the stall banner', edits: [e(APP, "    renderSportStallBannerIfNeeded('picks');   // D1 / DI-557: last, so it seats itself below the two notices above it\n    armLockFlipForPage();   // D1 / DI-510: the current week's lock instant may still be ahead while a past week is on screen", "    armLockFlipForPage();   // D1 / DI-510: the current week's lock instant may still be ahead while a past week is on screen")], suite: ST, red: ['[10b]'] },
  { id: 'S-110', what: 'the in-place paint parks under its OWN key again (a repaint landing during a week-swipe spring-back is never held: N6)', edits: [e(APP, '  if (deferInPlaceRepaint(tab, repaintSportStallBannerInPlace)) return;\n', '  if (deferRenderWhileWeekSwiping(`stall:${tab}`, repaintSportStallBannerInPlace)) return;\n')], suite: ST, red: ['[9o]', '[9s]'] },
  { id: 'S-111', what: 'the in-place paint parks under the page key through the REPLACING door (a full repaint already parked for the page is dropped)', edits: [e(APP, '  if (deferInPlaceRepaint(tab, repaintSportStallBannerInPlace)) return;\n', '  if (deferRenderWhileWeekSwiping(tab, repaintSportStallBannerInPlace)) return;\n')], suite: ST, red: ['[9t]'] },
  { id: 'S-112', what: 'the in-place door ignores a spring-back (only a touch owner holds it)', edits: [e(NG, "  if ((!REPAINT_DEFERRING_OWNERS.has(touchOwner) && !springingPages.has(key)) || typeof render !== 'function') return false;\n  if (!deferredRenders.has(key)) deferredRenders.set(key, render);", "  if (!REPAINT_DEFERRING_OWNERS.has(touchOwner) || typeof render !== 'function') return false;\n  if (!deferredRenders.has(key)) deferredRenders.set(key, render);")], suite: ST, red: ['[9o]', '[9s]'] },
  { id: 'S-113', what: 'the in-place door replaces a repaint already parked for the page', edits: [e(NG, '  if (!deferredRenders.has(key)) deferredRenders.set(key, render);', '  deferredRenders.set(key, render);')], suite: ST, red: ['[9t]'] },
  { id: 'G-6', what: 'a bucket the poll never fetched for the competition counts as a failure (the reviewer\'s G-6, review N3)', edits: [e(APP, 'return notePoll(_sportPollHealth, comp.id, bucketOutcomes.get(bucket), Date.now());', "return notePoll(_sportPollHealth, comp.id, bucketOutcomes.get(bucket) || 'failed', Date.now());")], suite: ST, red: ['[2v]', '[2w]'] },
  { id: 'S-80', what: 'the scroller is never offset', edits: [e(APP, '  if (!delta || y <= 8) return;', '  return;')], suite: ST, red: ['[8u]', '[8v]'] },
  { id: 'S-81', what: 'the scroller is offset even at the top of the page', edits: [e(APP, '  if (!delta || y <= 8) return;', '  if (!delta) return;')], suite: ST, red: ['[8x]', '[8y]'] },
  { id: 'S-82', what: 'a navigation offsets the scroller (the banner arrives with the tab change)', edits: [e(APP, '  if (key !== prev.key && wasVisit) offsetScrollForStall(h - prev.h);', '  if (key !== prev.key) offsetScrollForStall(h - prev.h);')], suite: ST, red: ['[8z]', '[8zb]'] },
  { id: 'S-83', what: 'a tab change does not end the visit (Dashboard -> Rules -> Dashboard offsets as if the reader never left)', edits: [e(APP, '  if (_priorTab !== tab) _stallVisit = null;   // D1 / DI-557: a tab change is a navigation (its scroll is restored by restoreTabScroll), never a banner offset\n', '')], suite: ST, red: ['[8zb]'] },
  { id: 'S-84', what: 'a banner that goes away does not give its space back to the scroller', edits: [e(APP, '    if (prev.h) { if (wasVisit) offsetScrollForStall(-prev.h); }', '')], suite: ST, red: ['[8v]', '[8w]'] },
  { id: 'S-85', what: 'the Dashboard\'s movement passes run before the page is finished again (a spurious 66 px / banner-height bounce on every rebuild)', edits: [e(APP, 'const rowsBefore = captureGameRows(); renderDashboardInner();   // D1 / DI-557: the two movement passes run at the END of this function (below), over the finished page', 'const rowsBefore = captureGameRows(); renderDashboardInner(); playRankMovement(rankBefore); playGameMovement(rowsBefore);'), e(APP, "  playRankMovement(rankBefore); playGameMovement(rowsBefore);\n  // SP-57 (DI-385) — covers renderDashboardInner()'s early-return empty states too", "  // SP-57 (DI-385) — covers renderDashboardInner()'s early-return empty states too")], suite: SB, red: ['D-2b:', 'D-3:'] },
  { id: 'S-86', what: 'the scroller is never offset (proved in a real engine, frame by frame)', edits: [e(APP, '  if (!delta || y <= 8) return;', '  return;')], suite: SB, red: ['D-3:', 'D-4:'] },
  // -- the real engine: computed style, the fade, red wins, scope --
  { id: 'S-87', what: 'the offset forgets the margin under the banner (it is 16 px short)', edits: [e(APP, 'return Math.round((el.getBoundingClientRect().height || 0) + (cs ? parseFloat(cs.marginBottom) || 0 : 0));', 'return Math.round(el.getBoundingClientRect().height || 0);')], suite: SB, red: ['D-3:', 'D-4:'] },
  { id: 'S-88', what: 'an unbroken code can poke out of the banner (no overflow-wrap)', edits: [e(CSS, '.sport-stall-rows p{margin:0;overflow-wrap:anywhere}', '.sport-stall-rows p{margin:0}')], suite: SB, red: ['H-4:'] },
  { id: 'S-90', what: 'the stall banner leaves the page flow (position:fixed)', edits: [e(CSS, '.sport-stall-banner{display:flex;align-items:flex-start;gap:8px;margin-bottom:16px}', '.sport-stall-banner{position:fixed;top:0;left:0;right:0;display:flex;align-items:flex-start;gap:8px;margin-bottom:16px}')], suite: SB, red: ['B-1:', 'B-6:'] },
  { id: 'S-91', what: 'the stall banner takes 12 px below it (off the 8-pt grid)', edits: [e(CSS, '.sport-stall-banner{display:flex;align-items:flex-start;gap:8px;margin-bottom:16px}', '.sport-stall-banner{display:flex;align-items:flex-start;gap:8px;margin-bottom:12px}')], suite: ST, red: ['[10q]'] },
  { id: 'S-92', what: 'the fade is on the base class (every node that is painted animates)', edits: [e(CSS, '.sport-stall-banner.sport-stall-in{animation:paused-banner-fade-in var(--motion-fast) var(--ease-native)}', '.sport-stall-banner{animation:paused-banner-fade-in var(--motion-fast) var(--ease-native)}')], suite: SB, red: ['C-4:'] },
  { id: 'S-93', what: 'Reduce Motion no longer turns the fade off', edits: [e(CSS, '\n@media (prefers-reduced-motion:reduce){.sport-stall-banner.sport-stall-in{animation:none}}', '')], suite: SB, red: ['C-6:'] },
  { id: 'S-94', what: 'the paused-league banner is back to 12 px below it', edits: [e(CSS, '.paused-league-banner{margin-bottom:16px;', '.paused-league-banner{margin-bottom:12px;')], suite: SB, red: ['B-9:'] },
  { id: 'S-95', what: 'the maintenance banner is back to 12 px below it', edits: [e(CSS, '.maintenance-banner{margin-bottom:16px;', '.maintenance-banner{margin-bottom:12px;')], suite: SB, red: ['B-9:'] },
  { id: 'S-96', what: 'the banner takes the red fill (loud-fail\'s color)', edits: [e(CSS, '.sport-stall-rows p{margin:0;overflow-wrap:anywhere}', '.sport-stall-rows p{margin:0;overflow-wrap:anywhere}\n.sport-stall-banner{background:var(--loss-bg)}')], suite: SB, red: ['B-2:', 'B-3:'] },
  { id: 'S-97', what: 'a hex color enters the banner\'s rules', edits: [e(CSS, '.sport-stall-rows p{margin:0;overflow-wrap:anywhere}', '.sport-stall-rows p{margin:0;overflow-wrap:anywhere;color:#7A6000}')], suite: ST, red: ['[10t]'] },
  { id: 'S-98', what: 'the gap between glyph and text is 6 px', edits: [e(CSS, '.sport-stall-banner{display:flex;align-items:flex-start;gap:8px;margin-bottom:16px}', '.sport-stall-banner{display:flex;align-items:flex-start;gap:6px;margin-bottom:16px}')], suite: SB, red: ['B-4:'] },
  { id: 'S-99', what: 'the red banner is consulted but ignored in a real engine (both banners show)', edits: [e(APP, 'if (ownsPage && !isContentWithheld() && !backendErrorBannerShowing()) {', 'if (ownsPage && !isContentWithheld()) {')], suite: SB, red: ['E-2:'] },
  { id: 'S-100', what: 'Picks shows every sport\'s rows in a real engine (the context scope is gone)', edits: [e(APP, '  return [getActiveSportKey()];\n}', '  return null;\n}')], suite: SB, red: ['F-2:', 'F-7:'] },
  { id: 'S-101', what: 'the module is not in the service worker precache', edits: [e(SW, "  './js/sport-stall.js',\n", '')], suite: ST, red: ['[10v]'] },
  { id: 'S-102', what: 'the module is not in the module-load list (a broken import would not be seen)', edits: [e(LT, "  'sport-stall',\n", '')], suite: ST, red: ['[10w]'] },
];

const editsOf = (m) => m.edits;
const args = process.argv.slice(2);
const discover = args.includes('--discover');
const anchorsOnly = args.includes('--anchors');
const nodeOnly = args.includes('--node');
const ids = args.filter((a) => !a.startsWith('--'));
const run = MUTANTS.filter((m) => (!ids.length || ids.includes(m.id)) && (!nodeOnly || m.suite !== SB));
if (anchorsOnly) {                                                                  // does every `find` still match exactly once in the checkout? (no copy, no suite run)
  let bad = 0;
  for (const m of run) for (const x of editsOf(m)) { const n = readFileSync(join(CFB, x.file), 'utf8').split(x.find).length - 1; if (n !== 1) { bad++; console.log(`  ⚠️  ${m.id} anchor matches ${n}x in ${x.file}`); } }
  console.log(bad ? `\n❌ ${bad} stale anchor(s) of ${run.length}` : `\n✅ all ${run.length} mutants' anchors match exactly once`);
  process.exit(bad ? 1 : 0);
}
const tmp = mkdtempSync(join(tmpdir(), 'cfbp-stallkit-'));
const COPY = join(tmp, 'cfb-pickems');
console.log(`\nstall kit - ${run.length} mutant(s); copying ${CFB} -> ${COPY} (node_modules and .git left out)\n`);
cpSync(CFB, COPY, { recursive: true, filter: (src) => !/[\\/](node_modules|\.git)([\\/]|$)/.test(src) });
if (existsSync(join(CFB, '..', 'docs'))) cpSync(join(CFB, '..', 'docs'), join(tmp, 'docs'), { recursive: true });
const runSuite = (suite) => spawnSync(process.execPath, [suite], { cwd: COPY, env: { ...process.env, SPORTSTALL_ROOT: COPY }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 900000 });

let caught = 0, survived = 0, broken = 0;
const suitesUsed = [...new Set(run.map((m) => m.suite))];
const base = suitesUsed.map((s) => [s, runSuite(s)]).filter(([, r]) => r.status !== 0);
if (base.length && !discover) { console.log(`BASELINE RED on the unmutated copy (${base.map(([s]) => s).join(', ')}) - no kill would mean anything`); process.exit(2); }
for (const m of run) {
  const originals = new Map(editsOf(m).map((x) => [x.file, readFileSync(join(CFB, x.file), 'utf8')]));
  const stale = editsOf(m).map((x) => originals.get(x.file).split(x.find).length - 1).find((n) => n !== 1);
  if (stale !== undefined) { broken++; console.log(`  ⚠️  ${m.id} ANCHOR matches ${stale} times - the kit is stale for this mutant`); continue; }
  const mutated = new Map([...originals]);
  for (const x of editsOf(m)) mutated.set(x.file, mutated.get(x.file).split(x.find).join(x.replace));
  for (const [file, text] of mutated) writeFileSync(join(COPY, file), text);
  const t0 = Date.now();
  const r = runSuite(m.suite);
  for (const [file, text] of originals) writeFileSync(join(COPY, file), text);       // the COPY's files go back to the checkout's text
  const restored = [...originals].every(([file, text]) => readFileSync(join(COPY, file), 'utf8') === text);
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  const redLines = out.split('\n').filter((l) => l.includes('❌'));
  if (discover) { console.log(`\n${m.id} (${m.suite}) exit ${r.status}${restored ? '' : ' RESTORE DIFFERS'}: ${m.what}`); redLines.slice(0, 8).forEach((l) => console.log('   ' + l.trim().slice(0, 150)));
    if (!redLines.length) out.split('\n').filter((l) => l.trim()).slice(-6).forEach((l) => console.log('   | ' + l.trim().slice(0, 160)));
    continue; }
  if (r.status === null) { broken++; console.log(`  ⚠️  ${m.id} TIMED OUT after ${Math.round((Date.now() - t0) / 1000)}s - NOT counted as caught; re-run it alone`); continue; }
  const missing = m.red.filter((label) => !redLines.some((l) => l.includes(label)));
  const ok = r.status !== 0 && m.red.length > 0 && missing.length === 0 && restored;
  if (ok) caught++; else survived++;
  console.log(`  ${ok ? '✅ CAUGHT  ' : '❌ SURVIVED'} ${m.id} (${m.suite.replace(/^.*\//, '')}, ${Math.round((Date.now() - t0) / 1000)}s) - ${m.what}`);
  console.log(`        RED on: ${m.red.filter((l) => !missing.includes(l)).join(' | ') || '(none)'}${missing.length ? `   NOT red: ${missing.join(' | ')}` : ''}${restored ? '' : '   RESTORE DIFFERS'}   [exit ${r.status}, ${redLines.length} red line(s)]`);
}
if (!discover) {
  const closing = suitesUsed.map((s) => [s, runSuite(s)]).filter(([, r]) => r.status !== 0);
  console.log(closing.length ? `\nCLOSING RUN RED after every restore: ${closing.map(([s]) => s).join(', ')}` : `\nclosing run green after every restore: ${suitesUsed.join(', ')}`);
  if (closing.length) broken++;
}
try { rmSync(tmp, { recursive: true, force: true }); } catch { /* temp */ }
if (discover) process.exit(0);
console.log(`\n${survived === 0 && broken === 0 ? '✅ ALL CAUGHT' : '❌ NOT ALL CAUGHT'} - ${caught} caught, ${survived} survived, ${broken} stale anchor(s) / timeouts / red closing runs`);
process.exit(survived === 0 && broken === 0 ? 0 : 1);
