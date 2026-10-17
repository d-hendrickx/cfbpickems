/**
 * CFB Pickems — chatfoottest.mjs (Deployment 1, Lane B, DI-573 / PF-440, 2026-10-07)
 * ==================================================================================
 * Drew, FB-009: "make the timing/timestamps for the messages underneath and not above." The proof, against the REAL messageHTML() (chat-ui.js's
 * `_messageHTMLForTest`, the same function the main chat AND the game-thread sheet render with) parsed into a real element tree (minidom.mjs):
 *
 *   [1] Placement — the <time> is a sibling AFTER .chat-bubble, inside .chat-foot, before the reactions; .chat-meta carries no time and no send state
 *   [2] The time itself — <time datetime> + a SPOKEN full date; the first-day text is relTime's (now / 5m / 3h); a day or more prints date AND time
 *   [3] The markers — "edited", "Sending…" (no time, no clock emoji), "Not sent" + Retry (no "FAILED"), a message with no ts, a deleted message
 *   [4] SCRIBE, system rows and react runs — every emitter moved
 *   [5] Unchanged — the NEW divider, ordering, relTime's thresholds, the search result line, the Retry wiring
 *   [6] CSS and source — the loss token (no #B02A37), a 44 pt Retry hit area, text-secondary, one messageHTML for both surfaces, the dead comment modal
 *   [7] MUTATION PROOFS on a scratch copy of chat-ui.js's source (never the file)
 *
 * Run:  node chatfoottest.mjs
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { MiniDocument } from './minidom.mjs';

const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k), clear: () => store.clear(),
};
globalThis.document = {
  addEventListener() {}, removeEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({ set innerHTML(v) {}, get innerHTML() { return ''; }, appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [], classList: { add() {}, remove() {} }, style: {}, id: '', className: '' }),
  body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '' }, hidden: false,
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined }, configurable: true }); }
globalThis.requestAnimationFrame = fn => fn();
globalThis.fetch = async () => { throw new Error('network disabled'); };
globalThis.matchMedia = () => ({ matches: false });
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}
const read = (rel) => readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const storage = await import('./js/storage.js');
const chat = await import('./js/chat.js');
const chatUi = await import('./js/chat-ui.js');
const { _messageHTMLForTest: renderMsg } = chatUi;
storage.addPlayer({ playerId: 'p1', displayName: 'Drew', active: true });
storage.addPlayer({ playerId: 'p2', displayName: 'Brayden', active: true });

const dom = new MiniDocument();
const tree = (html) => { const h = dom.createElement('div'); h.innerHTML = html; return h; };
const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;
const msg = (o = {}) => ({ id: 'm1', type: 'message', author: 'p2', gameTag: '', ts: Date.now() - 3 * HOUR, body: 'Texas is not covering that', reactions: {}, meta: null, ...o });
const parts = (m, self = 'p1') => {
  const t = tree(renderMsg(m, self, false));
  const col = t.querySelector('.chat-bubble-col');
  return { t, col, meta: t.querySelector('.chat-meta'), bubble: t.querySelector('.chat-bubble'), foot: t.querySelector('.chat-foot'), time: t.querySelector('time') };
};

// ═══ [1] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[1] Placement…');
{
  const { col, meta, bubble, foot, time } = parts(msg());
  assert(!!foot && !!time && foot.contains(time) && time.localName === 'time', '1a: the time is a <time> element inside the new .chat-foot row');
  const kids = col.children.map(n => n.className.split(' ')[0]);
  assert(kids.indexOf('chat-bubble') >= 0 && kids.indexOf('chat-foot') === kids.indexOf('chat-bubble') + 1, `1b: .chat-foot is the element DIRECTLY after .chat-bubble (column: ${kids.join(' > ')})`);
  assert(!meta.querySelector('time') && !meta.querySelector('.chat-time') && !meta.querySelector('.chat-edited') && !meta.querySelector('.chat-pending') && !meta.querySelector('.chat-failed') && !meta.querySelector('.chat-retry'), '1c: .chat-meta no longer holds the time, "edited", the pending mark or the failed marker');
  assert(meta.querySelector('.chat-author').textContent === 'Brayden', '1d: .chat-meta still carries the author (identity and attributes stay where they were)');
  const html = renderMsg(msg({ pinned: true, edited: true }), 'p1', false);
  assert(html.indexOf('chat-bubble"') < html.indexOf('<time') && html.indexOf('<time') < html.indexOf('chat-quick-react-row'), '1e: source order — bubble, then the time, then the reactions / quick-react row');
  assert(parts(msg({ pinned: true })).meta.querySelector('.chat-pinned') !== null, '1f: the 📌 pinned mark stays in .chat-meta');
  assert(parts(msg(), 'p2').col.parentNode.classList.contains('chat-mine') && /chat-foot/.test(renderMsg(msg(), 'p2', false)), '1g: the viewer\'s OWN message gets the foot row too (it aligns right by CSS)');
}

// ═══ [2] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[2] The time itself…');
{
  const at = (age) => parts(msg({ ts: Date.now() - age })).time;
  const t3 = at(3 * HOUR);
  assert(t3.getAttribute('datetime') === new Date(Date.parse(t3.getAttribute('datetime'))).toISOString() && Math.abs(Date.now() - 3 * HOUR - Date.parse(t3.getAttribute('datetime'))) < 5000, '2a: datetime is the message\'s ISO instant');
  assert(t3.textContent === '3h', '2b: 3 hours old reads "3h" (relTime\'s own text)');
  assert(at(20 * 1000).textContent === 'now' && at(5 * MIN).textContent === '5m' && at(59 * MIN).textContent === '59m', '2c: now / 5m / 59m — relTime\'s thresholds, unchanged');
  assert(at(23 * HOUR).textContent === '23h', '2d: 23 hours is still "23h"');
  const old = at(25 * HOUR);
  assert(/[A-Z][a-z]{2} \d{1,2}/.test(old.textContent) && /\d{1,2}:\d{2}/.test(old.textContent), `2e: a day or more prints the date AND the time ("${old.textContent}") so a historical thread reads as history`);
  assert(/ago/.test(t3.getAttribute('aria-label')) && /\d{1,2}:\d{2}/.test(t3.getAttribute('aria-label')) && /3 hours ago/.test(t3.getAttribute('aria-label')), `2f: the spoken label is "3 hours ago, <full date and time>" ("${t3.getAttribute('aria-label')}")`);
  assert(/just now/.test(at(5000).getAttribute('aria-label')) && /1 minute ago/.test(at(61 * 1000).getAttribute('aria-label')) && /1 hour ago/.test(at(61 * MIN).getAttribute('aria-label')), '2g: "just now", singular minute and hour');
  assert(!/ago/.test(old.getAttribute('aria-label')) && /\d{1,2}:\d{2}/.test(old.getAttribute('aria-label')), '2h: an old message is spoken as a full date and time, with no "ago"');
  const html = renderMsg(msg(), 'p1', false);
  assert((html.match(/<time /g) || []).length === 1, '2i: exactly ONE <time> per message (VoiceOver reads it once)');
  assert(/<time class="chat-time"/.test(html), '2j: it keeps the .chat-time class (the contrast scan and the themes still find it)');
}

// ═══ [3] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[3] The markers…');
{
  const e = parts(msg({ edited: true }));
  assert(e.foot.querySelector('.chat-edited') && e.foot.textContent.indexOf('edited') > e.foot.textContent.indexOf('h') && e.foot.querySelector('.chat-edited').textContent === 'edited', '3a: "edited" is in the foot row, after the time');
  // pending: a real local message through chat.sendMessage
  chat._resetForTest && chat._resetForTest();
  const id = chat.sendMessage({ body: 'in flight', author: 'p1' });
  const sent = chat.getMessage(id);
  const p = parts(sent, 'p1');
  assert(chat.isPending(id) && p.foot.querySelector('.chat-pending') && p.foot.querySelector('.chat-pending').textContent === 'Sending…', '3b: a PENDING message reads "Sending…" in the foot row');
  assert(!p.foot.querySelector('time') && !/🕐/.test(p.t.innerHTML), '3c: …with NO time beside it and no clock emoji');
  chat._markFailedForTest(id);
  const f = parts(chat.getMessage(id), 'p1');
  assert(chat.isFailed(id) && f.foot.querySelector('.chat-failed').textContent === 'Not sent', '3d: a FAILED message reads "Not sent" (the plain fact, still loud)');
  assert(!/FAILED/.test(f.t.innerHTML) && !f.foot.querySelector('.chat-pending'), '3e: …not "FAILED", and not still "Sending…"');
  const retry = f.foot.querySelector('.chat-retry');
  assert(retry && retry.localName === 'button' && retry.getAttribute('data-retry') === id && retry.textContent === 'Retry' && retry.getAttribute('aria-label') === 'Retry sending this message', '3f: a real Retry <button data-retry>, named for VoiceOver');
  assert(f.foot.classList.contains('chat-foot--failed') && f.foot.querySelector('time'), '3g: the failed foot is marked (it keeps 8 pt above the reactions) and keeps the time of the attempt');
  const none = parts(msg({ ts: 0, id: 'm_nots' }));
  assert(!none.t.querySelector('time') && none.foot.querySelector('.chat-pending').textContent === 'Sending…', '3h: a message with no ts yet shows only "Sending…"');
  const del = parts(msg({ deleted: true, body: '' }));
  assert(!!del.time && /withdrawn/.test(del.bubble.textContent), '3i: a deleted message ("message withdrawn") keeps its time');
}

// ═══ [3x] ════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[3x] 0045 review — a post the outbox marked "Not sent" reads SENT once its server row arrives (and the mutant that keeps the mark)…');
{
  // The outbox gives up after MAX_ATTEMPTS while chatTransport's A7 park can still be carrying the post (0045's bad_state on a lock notice
  // the server has not caught up with); when the park's resend lands, the row arrives through the subscription. js/chat.js ingest()'s
  // reconcile is where the device learns that, so it is driven here through the REAL ingest(), and the foot through the REAL messageHTML().
  const landsAfterFailing = (C) => {
    C._resetForTest && C._resetForTest();
    const id = C.sendMessage({ body: 'Week 6 is locked. 5/6 got picks in.', author: 'p1' });
    const marked = C._markFailedForTest(id) && C.isFailed(id);
    const echoOnly = (C.ingest([{ id, type: 'message', author: 'p1', gameTag: '', body: 'Week 6 is locked. 5/6 got picks in.', targetId: '', replyTo: '', notify: true, meta: null, local: true }]), C.isFailed(id));
    C.ingest([{ id, seq: 4242, ts: Date.now(), type: 'message', author: 'p1', gameTag: '', body: 'Week 6 is locked. 5/6 got picks in.', targetId: '', replyTo: '', notify: true, meta: null }]);
    return { id, marked, echoOnly, cleared: !C.isFailed(id), item: C.getMessage(id) };
  };
  const r = landsAfterFailing(chat);
  assert(r.marked && r.echoOnly, '3x-1 fixture: the post is FAILED ("Not sent"), and a local echo WITHOUT a server seq does not clear it');
  const f = parts(r.item, 'p1');
  assert(r.cleared && r.item.seq === 4242 && !f.foot.querySelector('.chat-failed') && !f.foot.querySelector('.chat-retry') && !f.foot.querySelector('.chat-pending') && !!f.foot.querySelector('time'),
    '3x-1: once its SERVER row (with a seq) arrives, the post reads SENT: no "Not sent", no Retry, no "Sending…", and its time is back in the foot');
  // MUTANT: a scratch copy of js/chat.js (loaded as a data: URL, never the file) WITHOUT the clear — the mark survives the landed row
  const src = await read('./js/chat.js');
  const line = '        if (typeof ev.seq === \'number\') S.failed.delete(ev.id);\n';
  let mutSrc = src.split(line).length === 2 ? src.split(line).join('') : null;
  let mutRes = null;
  if (mutSrc) {
    mutSrc = mutSrc.replace(/from '\.\/([\w.-]+)'/g, (_m, file) => `from '${new URL('./js/' + file, import.meta.url).href}'`);
    try { mutRes = landsAfterFailing(await import('data:text/javascript;base64,' + Buffer.from(mutSrc).toString('base64'))); } catch (e) { mutRes = { cleared: true, err: String(e.message).slice(0, 120) }; }
  }
  assert(!!mutSrc && mutRes && mutRes.marked && mutRes.cleared === false,
    `3x-2 MUTANT: without the clear in ingest()'s reconcile, the landed post still reads "Not sent" — 3x-1 turns RED (${JSON.stringify(mutRes && { marked: mutRes.marked, cleared: mutRes.cleared, err: mutRes.err })})`);
}

// ═══ [4] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[4] SCRIBE, system rows and react runs…');
{
  const sc = parts(msg({ author: 'scribe', id: 'm_sc' }), 'p1');
  assert(!!sc.foot && !!sc.time && !sc.meta.querySelector('time'), '4a: a SCRIBE post gets the foot row too');
  const sys = tree(renderMsg({ id: 'sys1', type: 'system', author: 'system', ts: Date.now() - 2 * HOUR, body: 'Week 9 is locked', meta: null }, 'p1', false));
  const row = sys.querySelector('.chat-system');
  const k = row.children.map(n => n.localName + '.' + (n.className.split(' ')[0] || ''));
  assert(k[0] === 'div.chat-system-body' && k[1] === 'time.chat-time', `4b: a system row — the pill first, the <time> on its own line beneath (${k.join(' > ')})`);
  const reveal = tree(renderMsg({ id: 'sys2', type: 'system', author: 'system', ts: Date.now() - HOUR, body: 'x', meta: { kind: 'reveal', title: 'Picks are in' } }, 'p1', false));
  assert(reveal.querySelector('.chat-system').children[1].localName === 'time', '4c: a reveal row too');
  const ack = tree(renderMsg({ id: 'sys3', type: 'system', author: 'system', ts: 0, body: 'asked', meta: { kind: 'scribeAsk' } }, 'p1', false));
  assert(/sending…/.test(ack.innerHTML) && !ack.querySelector('time'), '4d: a system row with no ts keeps the old "sending…" placeholder text and no <time>');
  const SRC = await read('./js/chat-ui.js');
  const run = SRC.slice(SRC.indexOf('function gamereactRunHTML'), SRC.indexOf('// ── UN-110 (batch 4)'));
  assert(/timeElHTML\(run\.ts\)/.test(run) && !/relTime\(/.test(run) && run.indexOf('chat-system-body') < run.indexOf('timeElHTML'), '4e: the game-react run puts the same <time> beneath its line');
  assert(renderMsg({ id: 'g1', type: 'gamereact' }, 'p1', false) === '', '4f: a lone gamereact still renders nothing here (coalesced elsewhere)');
}

// ═══ [5] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[5] Unchanged…');
{
  const html = renderMsg(msg(), 'p1', true);
  assert(html.trimStart().startsWith('<div class="chat-new-divider"><span>NEW</span></div>'), '5a: the NEW divider still opens the row when asked (unread behaviour is untouched)');
  const SRC = await read('./js/chat-ui.js');
  const rt = SRC.slice(SRC.indexOf('function relTime(ts)'), SRC.indexOf('function relTime(ts)') + 420);
  assert(/if \(!ts\) return 'sending…';/.test(rt) && /d < 60e3\) return 'now'/.test(rt) && /d < 3600e3\) return Math\.floor\(d \/ 60e3\) \+ 'm'/.test(rt) && /d < 86400e3\) return Math\.floor\(d \/ 3600e3\) \+ 'h'/.test(rt) && /toLocaleDateString\(undefined, \{ month: 'short', day: 'numeric' \}\)/.test(rt), '5b: relTime() itself is byte-for-byte what it was (the search result line below still uses it)');
  assert(/chat-search-result-meta"><strong>\$\{esc\(nameOf\(m\.author\)\)\}<\/strong> · \$\{relTime\(m\.ts\)\}/.test(SRC), '5c: the search results keep relTime');
  assert(/c\.querySelectorAll\('\[data-retry\]'\)\.forEach\(b => b\.addEventListener\('click', \(\) => \{ retryFailed\(b\.dataset\.retry\); renderChatPage\(\); \}\)\)/.test(SRC) && /host\.querySelectorAll\('\[data-retry\]'\)\.forEach\(b => b\.addEventListener\('click', \(\) => \{ retryFailed\(b\.dataset\.retry\); renderSheetMessages\(\); \}\)\)/.test(SRC), '5d: Retry is still wired in BOTH surfaces by [data-retry] (the markup moved, the handler did not)');
  assert(/messageHTML\(m, me\(\)/.test(SRC.slice(SRC.indexOf('function renderSheetMessages'))) || /messageHTML\(/.test(SRC.slice(SRC.indexOf('function renderSheetMessages'), SRC.indexOf('function renderSheetMessages') + 3000)), '5e: the game-thread sheet renders through the SAME messageHTML — one change covers both surfaces');
  const callers = [...SRC.matchAll(/messageHTML\(/g)].length;
  assert(callers >= 3, `5f: messageHTML has its callers (${callers}) — the main list, the sheet, and the test seam; the builder grepped every one`);
}

// ═══ [6] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[6] CSS and source…');
{
  const CSS = await read('./css/styles.css');
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (sel) => { const o = []; for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) if (m[1].split(',').some(s => s.trim() === sel)) o.push(m[2]); return o.join(';'); };
  assert(/var\(--loss\)/.test(rule('.chat-failed')) && /var\(--loss\)/.test(rule('.chat-retry')) && /var\(--loss\)/.test(rule('.chat-msg.is-failed .chat-bubble')) && !/B02A37/i.test(rule('.chat-failed') + rule('.chat-retry') + rule('.chat-msg.is-failed .chat-bubble')), '6a: the failed marker, Retry and the failed bubble\'s border use the --loss token — the hardcoded #B02A37 is gone from all three');
  assert(/font-weight:700/.test(rule('.chat-failed')), '6b: "Not sent" is weight 700 (impossible to miss)');
  assert(/width:max\(100%,44px\)/.test(rule(".chat-retry::before")) && /height:44px/.test(rule(".chat-retry::before")), '6c: Retry has a 44 pt hit area (the ::before expander)');
  assert(/display:flex/.test(rule('.chat-foot')) && /gap:8px/.test(rule('.chat-foot')) && /margin-top:4px/.test(rule('.chat-foot')) && /flex-wrap:wrap/.test(rule('.chat-foot')), '6d: the foot row — 8 pt between items, 4 pt under the bubble, wraps at the largest text size');
  assert(/justify-content:flex-end/.test(rule('.chat-msg.chat-mine .chat-foot')), '6e: the viewer\'s own foot aligns right');
  assert(/color:var\(--text-secondary\)/.test(rule('.chat-foot')) && /color:var\(--text-secondary\)/.test(rule('.chat-foot .chat-time')), '6f: time / meta text is --text-secondary (the muted token fails AA on a card)');
  assert(/margin-bottom:8px/.test(rule('.chat-foot--failed')), '6g: a failed foot keeps 8 pt above the reactions row');
  assert(/flex-direction:column/.test(rule('.chat-system')), '6h: a system row stacks (pill, then the time centred beneath)');
  const APP = await read('./js/app.js');
  const calls = (APP.match(/renderCommentBubble\(/g) || []).length;
  assert(calls === 1 && /function renderCommentBubble\(/.test(APP), `6i: TRACE — renderCommentBubble() is defined and has ZERO call sites (${calls} occurrence = its own definition), so the legacy comment modal and its .comment-time are unreachable dead code: left alone (DI-573 conditions it on a trace)`);
}

// ═══ [7] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[7] MUTATION PROOFS — a scratch copy of chat-ui.js\'s source evaluated for its message function…');
{
  const SRC = await read('./js/chat-ui.js');
  // Evaluate JUST the functions under test from the real source: footTime*, timeElHTML, chatFootHTML (pure string builders over esc/relTime).
  const grab = (name) => { const i = SRC.indexOf(`function ${name}(`); let d = 0; const j = SRC.indexOf(') {', i) + 2; for (let k = j; k < SRC.length; k++) { if (SRC[k] === '{') d++; else if (SRC[k] === '}') { d--; if (d === 0) return SRC.slice(i, k + 1); } } return ''; };
  const harness = (mut = (s) => s) => {
    const body = ['relTime', 'footTimeText', 'footTimeSpoken', 'timeElHTML', 'chatFootHTML'].map(grab).map(mut).join('\n');
    const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    return new Function('esc', `${body}\nreturn { relTime, footTimeText, timeElHTML, chatFootHTML };`)(esc);
  };
  const probe = (h) => {
    const m = { id: 'x1', ts: Date.now() - 3 * HOUR, edited: true };
    const normal = h.chatFootHTML(m, { pending: false, failed: false });
    const pend = h.chatFootHTML(m, { pending: true, failed: false });
    const fail = h.chatFootHTML(m, { pending: false, failed: true });
    const nots = h.chatFootHTML({ id: 'x2', ts: 0 }, { pending: false, failed: false });
    const old = h.timeElHTML(Date.now() - 2 * DAY);
    return {
      hasTime: /<time class="chat-time" datetime="/.test(normal) && />3h<\/time>/.test(normal),
      edited: /chat-edited">edited</.test(normal),
      pendingNoTime: /Sending…/.test(pend) && !/<time/.test(pend),
      failedWords: /Not sent/.test(fail) && /data-retry="x1"/.test(fail) && !/FAILED/.test(fail),
      noTsSending: /Sending…/.test(nots) && !/<time/.test(nots),
      oldDateTime: /\d{1,2}:\d{2}/.test(old.replace(/datetime="[^"]*"/, '').replace(/aria-label="[^"]*"/, '')),
      spoken: /aria-label="3 hours ago, /.test(normal),
    };
  };
  const base = probe(harness());
  assert(Object.values(base).every(Boolean), `7-0: the probe is GREEN on the real source (positive control: ${Object.entries(base).filter(([, v]) => !v).map(([k]) => k).join(', ') || 'all pass'})`);
  const mutants = [
    ['the <time> element is a plain span', (s) => s.replace('<time class="chat-time" datetime=', '<span class="chat-time" datetime=').replace('</time>`;', '</span>`;'), 'hasTime'],
    ['"edited" is dropped', (s) => s.replace("m.edited && !sending ? '<span class=\"chat-edited\">edited</span>' : ''", "''"), 'edited'],
    ['a pending message still shows its time', (s) => s.replace("sending ? '' : timeElHTML(m.ts)", 'timeElHTML(m.ts)'), 'pendingNoTime'],
    ['a failed message reads FAILED', (s) => s.replace('Not sent</span>', 'FAILED</span>'), 'failedWords'],
    ['a message with no ts shows nothing', (s) => s.replace("const sending = pending || !m.ts;", 'const sending = pending;'), 'noTsSending'],
    ['an old message prints only the date', (s) => s.replace("return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });", "return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });"), 'oldDateTime'],
    ['the spoken label is dropped', (s) => s.replace('aria-label="${esc(footTimeSpoken(ts))}"', ''), 'spoken'],
  ];
  for (const [name, mut, check] of mutants) {
    let res;
    try { res = probe(harness(mut)); } catch (e) { res = { [check]: false }; }
    assert(res[check] === false, `7: mutant "${name}" turns ${check} RED`);
  }
}

console.log(`\n══════════════════════════════════════════════════\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
