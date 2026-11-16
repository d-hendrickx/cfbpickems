/* teaser/scenes/chat.js — Beat E (the group chat) and the SCRIBE conversation. PROMO-ONLY.
   Markup mirrors js/chat-ui.js messageHTML() / composerHTML() / renderChatPage(). Two things here do not exist in
   the app and are promo mockups in the chat's own visual language: the typing indicator, and SCRIBE's text
   arriving a character at a time (the app delivers a message whole). */
(function (T) {
  'use strict';
  var ui = T.ui;
  var TALK = [
    { id:'m1', who:'p4', text:'Tyler taking Texas again lmao', time:'6:41 PM', at:0.10 },
    { id:'m2', who:'p3', text:'Texas +6.5 is free money. Screenshot this.', time:'6:41 PM', at:0.45, react:{ emoji:'😂', n:2 } },
    { id:'m3', who:'p1', text:'Oregon by 20. Book it.', time:'6:42 PM', at:0.80, react:{ emoji:'🔥', n:1, me:false } },
    { id:'m4', who:'p2', text:'the record remembers 💀', time:'6:42 PM', at:1.70 }
  ];
  var badge = { phase:'live', label:'Live' };
  function bottom(phone) { var s = phone.page.querySelector('#chat-scroll'); if (s) s.scrollTop = s.scrollHeight; }
  function pop(phone, id, n) {
    var pill = phone.page.querySelector('[data-tz-react="' + id + '"]'); if (!pill) return;
    if (n != null) pill.querySelector('[data-tz-n]').textContent = String(n);
    pill.classList.remove('tz-pop'); void pill.offsetWidth; pill.classList.add('tz-pop');
  }

  /* ── Beat E: the room ── */
  var evT = new T.Events()
    .at(1.05, function (phone) { pop(phone, 'm2', 3); })
    .at(1.28, function (phone) { pop(phone, 'm3', 2); })
    .at(2.05, function (phone) { pop(phone, 'm2', 4); });
  T.register({
    id: 'chat', label: 'Group chat', tab: 'chat', duration: 3.4,
    captions: [{ text: 'Talk your shit.', from: 0.25, to: 3.1 }],
    mount: function (phone) { T.setPage(phone, 'chat', 'chat', ui.chatPage(TALK), { badge: badge }); },
    reset: function (phone) { if (phone.pageKey !== 'chat') this.mount(phone); else { phone.page.innerHTML = ui.chatPage(TALK); T.setTab(phone, 'chat', badge); } evT.reset(); },
    tick: function (t, phone) {
      TALK.forEach(function (m) { ui.enter(phone.page.querySelector('[data-mid="' + m.id + '"]'), t, m.at); });
      /* a reaction pill only exists once its message has had a beat on screen */
      TALK.forEach(function (m) { var r = phone.page.querySelector('[data-tz-react="' + m.id + '"]'); if (r) r.parentNode.style.display = t >= m.at + 0.22 ? '' : 'none'; });
      evT.fire(t, phone); bottom(phone);
    }
  });

  /* ── the SCRIBE conversation ── */
  var HIST = TALK.map(function (m) { return { id:m.id, who:m.who, text:m.text, time:m.time, react: m.react ? { emoji:m.react.emoji, n:m.id === 'm2' ? 4 : 2 } : null }; });
  var ASK = { id:'q1', who:'p3', text:'Who should we be watching tonight?', time:'now' };
  var S1 = 'Oregon’s pass rush has a major matchup advantage tonight.';
  var S2 = ' But Grant has picked against Oregon three straight weeks, so we know where this is going.';
  var K = { ask:0.4, typeOn:1.7, s1:3.0, s1End:4.5, s2:5.2, s2End:7.0 };
  function scribePage() {
    return ui.chatPage(HIST.concat([ASK,
      { id:'typing', who:'scribe', html:'<span class="tz-typing" aria-label="SCRIBE is typing"><i></i><i></i><i></i></span>', time:'' },
      { id:'s1', who:'scribe', text:'', time:'now' }]));
  }
  T.register({
    id: 'scribe', label: 'SCRIBE', tab: 'chat', duration: 8.6,
    captions: [],
    K: K,
    mount: function (phone) { T.setPage(phone, 'scribe', 'chat', scribePage(), { badge: badge }); },
    reset: function (phone) { if (phone.pageKey !== 'scribe') this.mount(phone); else { phone.page.innerHTML = scribePage(); T.setTab(phone, 'chat', badge); } },
    tick: function (t, phone) {
      var q = function (id) { return phone.page.querySelector('[data-mid="' + id + '"]'); };
      ui.enter(q('q1'), t, K.ask);
      var typing = q('typing'), msg = q('s1');
      if (typing) { if (t >= K.typeOn && t < K.s1) ui.enter(typing, t, K.typeOn, 8, .2); else typing.style.display = 'none'; }
      if (msg) {
        if (t < K.s1) msg.style.display = 'none';
        else {
          ui.enter(msg, t, K.s1, 6, .18);
          var n1 = Math.round(S1.length * T.span(t, K.s1, K.s1End)), n2 = Math.round(S2.length * T.span(t, K.s2, K.s2End));
          var body = msg.querySelector('[data-tz-body]'), text = S1.slice(0, n1) + S2.slice(0, n2);
          if (body.textContent !== text) body.textContent = text;
          var foot = msg.querySelector('.chat-foot'); if (foot) foot.style.visibility = t >= K.s2End ? 'visible' : 'hidden';
        }
      }
      bottom(phone);
    }
  });
})(window.TEASER);
