/**
 * CFB Pickems — synctest.mjs
 * ==========================
 * RG-39 — "all the emails for the players went away and the pins reset."
 *
 * Run:  node synctest.mjs
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * RETIRED 2026-09-23 — THE MECHANISM THIS FILE PROVED NO LONGER EXISTS.
 *
 * WHAT IT PROVED, kept in full because the incident is the point of the file.
 * Drew, 2026-08-15, after a deploy:
 *
 *   "When we updated the last update, all the emails for the players went away
 *    and the pins reset. We need to make sure that if we input personal
 *    information it stays, and if we update security information it stays."
 *
 * The cascade, end to end: a device boots on a mirror from BEFORE the
 * commissioner typed anyone's email — six players, same six, same order, all
 * well-formed, merely missing `email` and `pinHash`. RG-12 defense (c)
 * (`_shrinks`) counts RECORDS, and six is not fewer than six, so it did not
 * fire. The stale array was re-applied wholesale and `flushPush()` sent it to
 * the Sheet. Every player's contact and login data, gone league-wide, from ONE
 * ordinary tap during the 10–20s Apps Script cold start while the app was
 * already interactive.
 *
 * `pinHash` made it worse than it sounds: a wiped hash does not reset a PIN, it
 * REMOVES THE CREDENTIAL. Until RG-40 (2026-08-26) `verifyPlayerPin()` returned
 * TRUE when the field was absent, so such an account accepted any PIN at all —
 * that is what "the pins reset" meant from the outside, and it was live on
 * irbfootball.com. The fix was RG-39 defense (d), `_rebaseRecords()`: staleness
 * measured at FIELD resolution rather than record count, matched on a stable id,
 * with nested preference objects merged key-by-key.
 *
 * WHY IT IS RETIRED RATHER THAN PORTED. Every line of it drove
 * `backend.hydrate()` — the Sheets adapter's one-`getAll`-one-`setMany`
 * whole-snapshot exchange — and that adapter is deleted. The defect was
 * STRUCTURAL to that exchange: a device that has to re-apply a whole key can
 * re-apply a stale version of it. js/supabase-backend.js writes ROW-LEVEL DIFFS
 * to `league_members`, so a device that never read another player's row never
 * sends one, and `email`/`phone`/`pin_hash` are not even in the adapter's diff
 * path (0007 replaced the table grant with a column list; contacts come back
 * only from `get_member_contacts()`). There is no cascade left to reproduce.
 *
 * WHERE THE LIVE COVERAGE IS: `adaptertest.mjs` — [A-LSV] (the contact and
 * last-seen columns are invisible to the diff/upsert path), the N3 contact
 * convergence, and the flush-planner sections — plus
 * `supabase/tests/rls.test.mjs`'s `contacts` group on the real project, which is
 * the only thing that can prove the column grant.
 *
 * WHAT IS LEFT HERE, and why the file is not deleted: the structural claim that
 * the mechanism is GONE rather than inert. An inert guard whose comments still
 * describe a protection is RG-27's exact failure mode — verified 2026-08-12,
 * replacing `_shrinks`' body with `_cache.set(k, v)` left the suite green at
 * 552/552 — and the honest way to retire a data-loss proof is to assert that
 * what it was proving can no longer happen, not to delete it and hope the next
 * person reads a ledger row.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

const backendSrc = readFileSync(new URL('./js/backend.js', import.meta.url), 'utf8');
const projSrc = readFileSync(new URL('./js/supabase-projection.js', import.meta.url), 'utf8');
const adapterSrc = readFileSync(new URL('./js/supabase-backend.js', import.meta.url), 'utf8');
const strip = (s) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const backendCode = strip(backendSrc);
const adapterCode = strip(adapterSrc);

console.log('\n[1] RG-39 — the whole-snapshot hydrate that produced the cascade is DELETED, not disabled…');
{
  assert(!/export\s+async\s+function\s+hydrate\s*\(/.test(backendCode),
    'js/backend.js exports no hydrate() — the one-getAll-one-setMany exchange the cascade needed is gone');
  assert(!/_rebaseRecords|_FIELD_REBASE_ID/.test(backendCode),
    'RG-39 defense (d) (_rebaseRecords / _FIELD_REBASE_ID) is DELETED rather than left inert — a guard nothing calls, whose comments still describe a protection, is RG-27\'s exact failure mode (verified 2026-08-12: gutting _shrinks left the suite green at 552/552)');
  assert(!/_shrinks|_USER_DATA_KEYS|_APPEND_ONLY_ID/.test(backendCode),
    '…and so are RG-12 defense (c) and RG-49\'s union — all three were answers to "which of these twenty-two whole keys do I re-apply", a question the row-level adapter never asks');
  assert(!/setMany|getAll/.test(backendCode),
    'and neither action name survives in executable code, so nothing can re-open the exchange by calling one');
}

console.log('\n[2] …and the replacement cannot reproduce it: players travel as ROWS, credentials travel nowhere…');
{
  assert(/cfbp_players:\s*\{\s*tables:\s*\['league_members'\]/.test(projSrc),
    'cfbp_players is routed to league_members as a per-row projection — a device that never read another player\'s row never sends one, which is what makes the cascade structurally impossible rather than merely guarded against');
  assert(/stripCredentials/.test(projSrc) && /stripCredentials/.test(adapterCode),
    'js/supabase-projection.js exports stripCredentials() and the adapter actually CALLS it — the credential fields are removed on the way out, not trusted to be absent');
  // The positive control. Without it, an assertion that "credentials are not in
  // the write path" is satisfied just as well by a projection that has stopped
  // carrying players at all.
  assert(/PLAYER_COLS/.test(projSrc),
    'fixture check: the player column list is still declared in the projection — the rules above are about a live path, not an empty one');
  assert(/get_member_contacts/.test(adapterCode),
    'and contacts are read through get_member_contacts(), the commissioner-gated RPC 0007 introduced, rather than through any column this diff path can write');
}

console.log('\n══════════════════════════════════════════════════');
console.log(pass && !fail ? `✅ ALL PASS — ${pass} passed, ${fail} failed` : `❌ FAILURES — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
