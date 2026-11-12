/**
 * CFB Pickems - js/analytics/packet.js (D2 lane 4; DI-947 "the packet"; 2026-10-19)
 * ==================================================================================
 * THE PACKET is the ONLY thing a model ever sees about an insight: a closed object, at most 6 KB serialised, stable key order, two
 * hashes of its canonical JSON. SCRIBE receives it and phrases it; SCRIBE does not recalculate it (UN-522).
 *
 *   `key`     a synchronous 32-bit FNV-1a (the same four-line algorithm scoring.js keeps private; scoring.js is not touched), for the
 *             in-memory memo and the UI's changed-data check;
 *   `sha256`  64 hex characters from an INJECTED async `digest` (WebCrypto in the browser and in Deno, supplied by index.js and the
 *             bridge, never imported by a metric file), used as the narrative cache key.
 *
 * The packet scan (the deep walk of feed-cards.js, FORBIDDEN_META_KEYS from js/notify-copy.js) REFUSES a forbidden key at any depth;
 * an unknown key is DROPPED and counted. It carries no signed spread, no tiebreaker, no chat, no pick of an unrevealed week: the input
 * it is built from cannot hold one (input.js).
 *
 * A packet is built from ONE league's input; a two-league packet cannot exist (input.js throws on a second league).
 */
import { FORBIDDEN_META_KEYS } from '../notify-copy.js';

export const PACKET_MAX_BYTES = 6 * 1024;
export const PACKET_SUPPORT_MAX = 24;
/** the closed top-level key set; anything else is dropped and counted */
export const PACKET_KEYS = Object.freeze(['insightId', 'v', 'headline', 'line', 'metrics', 'support', 'scope', 'sample', 'memory', 'asker']);
const FORBIDDEN = new Set(FORBIDDEN_META_KEYS);

/** stable, recursive, key-sorted JSON (the canonical form every hash is taken of) */
export function canonicalJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
}

/** 32-bit FNV-1a as 8 hex characters (the algorithm scoring.js keeps private, written here so scoring.js stays untouched) */
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Walk any value; throw on a forbidden key at any depth. Returns the count of keys seen (for the planted-key test). */
export function assertNoForbiddenKeys(v, path = 'packet') {
  if (v === null || typeof v !== 'object') return;
  if (Array.isArray(v)) { v.forEach((x, i) => assertNoForbiddenKeys(x, path + '[' + i + ']')); return; }
  for (const k of Object.keys(v)) {
    if (FORBIDDEN.has(k)) throw new Error('analytics: forbidden key "' + k + '" at ' + path);
    assertNoForbiddenKeys(v[k], path + '.' + k);
  }
}

/**
 * @param {object} p  { insightId, v, headline, line, metrics, support, scope, sample, memory?, asker? } (unknown keys are dropped and counted)
 * @returns {{ packet: object, dropped: number, key: string, bytes: number }}
 */
export function sealPacket(p) {
  const packet = {};
  let dropped = 0;
  for (const k of Object.keys(p)) { if (PACKET_KEYS.includes(k)) packet[k] = p[k]; else dropped++; }
  if (Array.isArray(packet.support)) packet.support = packet.support.slice(0, PACKET_SUPPORT_MAX);
  if (!Array.isArray(packet.memory)) packet.memory = [];
  assertNoForbiddenKeys(packet);
  const json = canonicalJson(packet);
  const bytes = json.length;
  if (bytes > PACKET_MAX_BYTES) throw new Error('analytics: packet over ' + PACKET_MAX_BYTES + ' bytes (' + bytes + ')');
  return { packet, dropped, key: fnv1a(json), bytes };
}

/** the cache key: sha256 of the canonical JSON through an injected async digest (returns an ArrayBuffer or a hex string) */
export async function packetSha(packet, digest) {
  const out = await digest(canonicalJson(packet));
  if (typeof out === 'string') return out;
  return Array.from(new Uint8Array(out)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
