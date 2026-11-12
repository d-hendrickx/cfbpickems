/**
 * js/account-context.js — the owner-only account store, client side (D2 lane 1, UN-507 / UN-507A; DI-741, DI-748, DI-1035). The ONLY module that reads or writes `account_context`.
 * ==========================================================================================================================================
 * `account_context` (migration 0066) holds, for ONE account: the About you answers (`profile`), and the tips seen, the master tips switch and the Getting started "hidden" flag (`tips`). It is
 * owner-only on the server (RLS; a league mate, a commissioner and the platform admin read zero rows) and it is NOT the league storage seam: tips and answers must follow the PERSON across leagues and
 * devices, never one league's data. This module therefore keeps its own in-memory cache with SYNCHRONOUS getters (the app reads synchronously) and writes to the table through the injected client.
 *
 *   - `loadAccountContext()` reads the row once per session (per account). Until it has, or if it fails, `accountContextAvailable()` is false and the getters return empty: NO tip and no Getting started card
 *     is shown (silence, never an error: DI-741). A missing table (migration 0066 not applied) is the same silence.
 *   - `patchAccountProfile(patch)` / `patchAccountTips(patch)` merge a patch (a key set to `undefined` is REMOVED), check the result against the catalog twin (`profileValid` / `tipsValid`: what the server will
 *     accept), update the cache AT ONCE and write the block. A refused or failed write is reported (`'refused'` / `'failed'`); the caller shows the failure state; the cache rolls back for the profile (an answer
 *     is never claimed saved) and is kept for the tips (a dismissed tip stays dismissed this session; tips are never loud-fail material).
 *   - Writes are serialized: two quick taps never interleave their read-modify-write.
 *   - `removeAllAccountProfile()` clears the whole profile block on the server at once (DI-750 "Remove everything I told Munera").
 * Nothing here is written to localStorage, to `profiles.extra` or to `league_members.preferences`; a different account (or a sign-out) clears the cache (`clearAccountContext`).
 */
import { profileValid, tipsValid } from './profile-questions.js';

let cfg = null;
let st = { uid: '', status: 'idle', profile: {}, tips: {}, rowExists: false };
let chain = Promise.resolve();
let generation = 0;

/** `configureAccountContext({ getClient, getUserId, onChange })` — called once by js/app.js at boot. `onChange()` fires after the cache changes (a load landed, a write committed). */
export function configureAccountContext(c) {
  const d = c && typeof c === 'object' ? c : {};
  cfg = {
    getClient: typeof d.getClient === 'function' ? d.getClient : () => null,
    getUserId: typeof d.getUserId === 'function' ? d.getUserId : () => '',
    onChange: typeof d.onChange === 'function' ? d.onChange : () => {},
  };
}
const uidNow = () => { try { return cfg ? String(cfg.getUserId() || '') : ''; } catch { return ''; } };
const clientNow = () => { try { return cfg ? cfg.getClient() : null; } catch { return null; } };
const changed = () => { try { cfg && cfg.onChange(); } catch { /* a listener never wedges the store */ } };
const clone = (o) => JSON.parse(JSON.stringify(o && typeof o === 'object' ? o : {}));

export const accountContextStatus = () => st.status;
/** True only once THIS account's row has been read (or found absent). Everything that shows a tip or the Getting started card asks this first. */
export const accountContextAvailable = () => st.status === 'ready' && st.uid !== '' && st.uid === uidNow();
export const getAccountProfile = () => (accountContextAvailable() ? st.profile : {});
export const getAccountTips = () => (accountContextAvailable() ? st.tips : {});

/** Forget everything (sign-out, an account change). The next load starts clean; an in-flight load or write that lands later is dropped. */
export function clearAccountContext() { generation += 1; st = { uid: '', status: 'idle', profile: {}, tips: {}, rowExists: false }; chain = Promise.resolve(); changed(); }
export function _resetAccountContextForTest() { generation += 1; st = { uid: '', status: 'idle', profile: {}, tips: {}, rowExists: false }; chain = Promise.resolve(); }
export const _accountContextStateForTest = () => ({ ...st, profile: clone(st.profile), tips: clone(st.tips) });

const missing = (e) => !!e && (['42P01', 'PGRST205', 'PGRST200'].includes(String(e.code || '')) || /does not exist|could not find the table|schema cache/i.test(String(e.message || '')));

/** Reads the account's row. Returns 'ready' | 'unavailable' (the table is missing: silence) | 'failed' | 'stale' (the account changed mid-flight: dropped). Idempotent per account unless `force`. */
export async function loadAccountContext({ force = false } = {}) {
  const uid = uidNow(), client = clientNow();
  if (!uid || !client || typeof client.from !== 'function') return 'failed';
  if (!force && st.uid === uid && (st.status === 'ready' || st.status === 'loading')) return st.status === 'ready' ? 'ready' : 'loading';
  const gen = ++generation;
  st = { uid, status: 'loading', profile: {}, tips: {}, rowExists: false };
  try {
    const r = await client.from('account_context').select('user_id, profile, tips').eq('user_id', uid).maybeSingle();
    if (gen !== generation || uidNow() !== uid) return 'stale';
    if (r.error) { st = { uid, status: missing(r.error) ? 'unavailable' : 'failed', profile: {}, tips: {}, rowExists: false }; changed(); return st.status; }
    const row = r.data && typeof r.data === 'object' ? r.data : null;
    st = { uid, status: 'ready', profile: row && profileValid(row.profile) ? clone(row.profile) : {}, tips: row && tipsValid(row.tips) ? clone(row.tips) : {}, rowExists: !!row };
    changed();
    return 'ready';
  } catch { if (gen === generation) { st = { uid, status: 'failed', profile: {}, tips: {}, rowExists: false }; changed(); return 'failed'; } return 'stale'; }
}

/** The write of ONE block, update first and insert when the account has no row yet (the table has no upsert grant by design). Returns 'saved' | 'failed' | 'unavailable'. */
async function writeBlock(col, value, gen) {
  const uid = uidNow(), client = clientNow();
  if (!uid || !client || st.uid !== uid) return 'failed';
  const upd = async () => client.from('account_context').update({ [col]: value }).eq('user_id', uid).select('user_id');
  const ins = async () => client.from('account_context').insert({ user_id: uid, [col]: value }).select('user_id');
  try {
    let r = await upd();
    if (r.error) return missing(r.error) ? 'unavailable' : 'failed';
    if (Array.isArray(r.data) && r.data.length > 1) return 'failed';   // one account, one row: two is not a success anyone should read as saved
    if (!Array.isArray(r.data) || r.data.length === 0) {
      r = await ins();
      if (r.error && String(r.error.code || '') === '23505') { r = await upd(); if (r.error || !Array.isArray(r.data) || r.data.length !== 1) return 'failed'; }   // a second device inserted first
      else if (r.error) return missing(r.error) ? 'unavailable' : 'failed';
      else if (!Array.isArray(r.data) || r.data.length !== 1) return 'failed';
    }
    if (gen === generation) st.rowExists = true;
    return 'saved';
  } catch { return 'failed'; }
}

function patchBlock(col, patch, { rollback }) {
  const run = async () => {
    const uid = uidNow();
    if (!uid || st.uid !== uid || st.status !== 'ready') return 'failed';
    const gen = generation;
    const before = clone(st[col]);
    const next = { ...before };
    for (const [k, v] of Object.entries(patch && typeof patch === 'object' ? patch : {})) { if (v === undefined) delete next[k]; else next[k] = v; }
    const ok = col === 'profile' ? profileValid(next) : tipsValid(next);
    if (!ok) return 'refused';
    if (JSON.stringify(next) === JSON.stringify(before) && st.rowExists) return 'saved';
    st[col] = next; changed();
    const r = await writeBlock(col, next, gen);
    if (gen !== generation) return 'stale';
    if (r !== 'saved' && rollback) { st[col] = before; changed(); }
    return r;
  };
  const p = chain.then(run, run);
  chain = p.then(() => {}, () => {});
  return p;
}

/** Merge into the answers. 'saved' | 'refused' (the catalog twin would not accept it: nothing changed) | 'failed' | 'unavailable' (the cache is rolled back: an answer is never claimed saved). */
export const patchAccountProfile = (patch) => patchBlock('profile', patch, { rollback: true });
/** Merge into the tips block (seen, off, gsHidden). A failed write keeps the local change this session (a tip is never worth an error). */
export const patchAccountTips = (patch) => patchBlock('tips', patch, { rollback: false });
/** Clears every answer (DI-750). */
export function removeAllAccountProfile() {
  const keys = Object.keys(st.profile || {});
  const patch = {}; for (const k of keys) patch[k] = undefined;
  return patchBlock('profile', patch, { rollback: true });
}
