/**
 * CFB Pickems - js/ask-insight-client.js (D2 lane 4 batch 3; UN/PF-522; DI-970, DI-971; 2026-10-21)
 * ==================================================================================================
 * The browser's two calls for "Ask SCRIBE about an insight": the platform setting that turns the open questions off, and the question itself. Thin on purpose, the shape of
 * js/odds-lookup-client.js: the SERVER decides who may ask (the caller's own JWT), recomputes the facts and enforces the caps; this module sends a request the pure half
 * (`ask-insight.js` buildAskRequest) built (an insight id, the question, a hash: never a number) and maps whatever comes back to one outcome (`askOutcomeFrom`).
 *
 *   askOpenCached()     the last answer of the setting: true when the open questions are on (the platform row absent or anything but the literal false); false when it is
 *                       exactly false or unreadable, before the first read, and on a device with no shared backend (local mode: there is no server to ask)
 *   refreshAskOpen()    re-reads the setting (5 minute cache); resolves true when the answer CHANGED, so the open sheet repaints
 *   askInsightModel(r)  scribe-ask, mode 'insight' -> { kind, text?, refreshed } (never throws; a transport failure is `failed`)
 */
import { getSupabaseClient } from './auth.js';
import { ASK_OPEN_KV_KEY, askOpenOn, askOutcomeFrom } from './ask-insight.js';

export const ASK_OPEN_TTL_MS = 5 * 60 * 1000;
const _open = { value: null, at: 0 };

// Test seams (the `_xForTest` convention; no production caller): a suite answers the question or the setting itself, so the sheet runs through the real dispatcher with no project.
let _askOverride = null, _openOverride = null;
export function _setAskInsightForTest(fn) { _askOverride = typeof fn === 'function' ? fn : null; }
export function _setAskOpenForTest(fn) { _openOverride = typeof fn === 'function' ? fn : null; _open.value = null; _open.at = 0; }

const clientOrNull = () => { try { const c = getSupabaseClient(); return c && typeof c.from === 'function' ? c : null; } catch { return null; } };

export function askOpenCached() { return _open.value === true; }

export async function refreshAskOpen({ now = Date.now(), force = false } = {}) {
  if (!force && _open.value !== null && now >= _open.at && now - _open.at < ASK_OPEN_TTL_MS) return false;
  const before = _open.value;
  let on = false;
  if (_openOverride) {
    try { on = (await _openOverride()) === true; } catch { on = false; }
  } else {
    const client = clientOrNull();
    if (client) {
      try {
        const r = await client.from('platform_kv').select('key, value').eq('key', ASK_OPEN_KV_KEY);
        on = !r.error && Array.isArray(r.data) && !r.data.some((x) => x && x.key === ASK_OPEN_KV_KEY && !askOpenOn(x.value));
      } catch { on = false; }
    }
  }
  _open.value = on; _open.at = now;
  return before !== on;
}

export async function askInsightModel(request) {
  if (!request || typeof request !== 'object') return { kind: 'failed', refreshed: false };
  if (_askOverride) { try { return askOutcomeFrom(await _askOverride(request)); } catch { return { kind: 'failed', refreshed: false }; } }
  const client = clientOrNull();
  if (!client || !client.functions || typeof client.functions.invoke !== 'function') return { kind: 'failed', refreshed: false };
  let res;
  try { res = await client.functions.invoke('scribe-ask', { body: request }); } catch { return { kind: 'failed', refreshed: false }; }
  return askOutcomeFrom(res && res.data);
}
