/* teaser/scenes/ui.js — PROMO-ONLY markup builders. Each mirrors a production template, named beside it, so the
   app's own css/styles.css styles the result. Nothing here is imported by the app. */
(function (T) {
  'use strict';
  var esc = T.esc;
  var S = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
  var ICON = {                                   /* js/icons.js, copied */
    chevronRight: S + '<polyline points="9 6 15 12 9 18"/></svg>',
    chevronLeft:  S + '<polyline points="15 6 9 12 15 18"/></svg>',
    calendarWeek: S + '<rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="7" y1="2.5" x2="7" y2="6"/><line x1="17" y1="2.5" x2="17" y2="6"/><rect x="5.5" y="13" width="13" height="4" rx="1"/></svg>',
    scribeSpark:  S + '<path d="M12 2.5c.6 4 2.4 5.8 6.4 6.4-4 .6-5.8 2.4-6.4 6.4-.6-4-2.4-5.8-6.4-6.4 4-.6 5.8-2.4 6.4-6.4Z"/></svg>',
    trophy:       S + '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4"/><line x1="12" y1="13" x2="12" y2="17"/><line x1="8" y1="20" x2="16" y2="20"/></svg>',
    flame:        S + '<path d="M12 3c1 3-2 4-2 7a4 4 0 1 0 8 0c0-1.5-.8-2.2-1.3-3 .3 2-.7 2.8-1.7 2.8-1.6 0-2-1.6-1-3.3.6-1 .5-2.4-2-3.5Z"/></svg>',
    rankUp:       S + '<polyline points="4 15 10 9 14 13 20 6"/><polyline points="15 6 20 6 20 11"/></svg>',
    chatBubble:   S + '<path d="M4 5.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-4 3.5v-3.5H6a2 2 0 0 1-2-2v-9Z"/></svg>',
    check:        S + '<polyline points="5 12.5 10 17.5 19 7"/></svg>',
    close:        S + '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>'
  };
  var glyph = function (cls, name) { return '<span class="' + cls + '" aria-hidden="true">' + ICON[name] + '</span>'; };

  /* js/home.js cardHTML(): eyebrow [icon][reason][trail: time], title, body, chips */
  function feedCard(c) {
    var chips = (c.chips || []).map(function (x) {
      return '<span class="badge feed-chip ' + (x[1] ? 'badge-win' : 'badge-loss') + '">' + glyph('feed-chip-glyph', x[1] ? 'check' : 'close') + esc(x[0]) + '</span>';
    }).join('');
    return '<div class="feed-item" data-tz-card="' + esc(c.key) + '"><article class="card feed-card fam-lg" data-card-type="' + esc(c.type) + '">'
      + '<div class="feed-card-eyebrow">' + glyph('feed-card-icon', c.icon)
      +   (c.reason ? '<span class="feed-card-reason">' + esc(c.reason) + '</span>' : '')
      +   '<span class="feed-card-trail"><time class="feed-card-time">' + esc(c.time) + '</time></span></div>'
      + (c.title ? '<h3 class="feed-card-title">' + esc(c.title) + '</h3>' : '')
      + (c.body ? '<p class="feed-card-body' + (c.type === 'scribe.post' ? ' feed-card-body--scribe' : '') + '">' + esc(c.body) + '</p>' : '')
      + (chips ? '<div class="feed-card-chips">' + chips + '</div>' : '')
      + '</article></div>';
  }

  /* js/gameday.js pillHTML() + gameDayCardHTML(), kind "live", collapsed */
  function pill(p) {
    return '<button type="button" class="gdp" data-key="p:' + esc(p.id) + '" data-game-id="' + esc(p.id) + '">'
      + '<span class="gdp-l1"><span data-bind="score">' + esc(p.away) + ' ' + p.as + ' – ' + esc(p.home) + ' ' + p.hs + '</span></span>'
      + '<span class="gdp-l2" data-bind="l2">' + esc(p.clock) + ' · <span class="gdp-cv gdp-cv--' + p.cov + '">' + (p.cov === 'covering' ? '▲ Covering' : '▽ Trailing') + '</span></span></button>';
  }
  function gameDay(g) {
    return '<div class="feed-item" data-tz-card="gd"><section class="gd" id="gd-card" data-gd-kind="live" data-gd-expanded="false" aria-label="Game Day">'
      + '<button type="button" class="gd-head" aria-expanded="false"><span class="gd-dot" aria-hidden="true"></span><span class="gd-lab">Game Day</span>'
      +   '<span class="gd-cnt">' + esc(g.tail) + '</span><span class="gd-me">' + esc(g.me) + '</span><span class="gd-chev" aria-hidden="true">' + ICON.chevronLeft + '</span></button>'
      + '<div class="gd-rail" data-gd-rail role="group" aria-label="Live games">' + g.pills.map(pill).join('') + '</div>'
      + '</section></div>';
  }

  /* js/chat-ui.js messageHTML(): avatar, meta/author, bubble, foot time, reactions */
  function message(m) {
    var scribe = m.who === 'scribe', mine = m.who === 'p1';
    var p = T.byId[m.who];
    var av = scribe ? '<div class="chat-avatar chat-avatar-scribe">📋</div>'
      : '<div class="chat-avatar' + (mine ? ' chat-avatar-mine' : '') + '" style="background:' + T.accent[m.who] + ';color:#fff">' + esc(p.initials) + '</div>';
    var reacts = m.react ? '<div class="chat-reactions"><button class="chat-react-pill' + (m.react.me ? ' me' : '') + '" data-tz-react="' + esc(m.id) + '">' + m.react.emoji + ' <span data-tz-n>' + m.react.n + '</span></button></div>' : '';
    return '<div class="chat-msg' + (mine ? ' chat-mine' : '') + (scribe ? ' chat-scribe' : '') + '" data-mid="' + esc(m.id) + '">' + av
      + '<div class="chat-bubble-col"><div class="chat-meta"><span class="chat-author">' + (scribe ? 'S.C.R.I.B.E.' : esc(p.name)) + '</span></div>'
      + '<div class="chat-bubble" data-tz-body>' + (m.html || esc(m.text || '')) + '</div>'
      + '<div class="chat-foot"><time class="chat-time">' + esc(m.time || 'now') + '</time></div>' + reacts + '</div></div>';
  }
  /* js/chat-ui.js renderChatPage(): .chat-surface > #chat-scroll + composerHTML() */
  function chatPage(msgs) {
    return '<div class="chat-surface"><div class="chat-scroll" id="chat-scroll">' + msgs.map(message).join('') + '</div>'
      + '<div class="chat-composer"><div class="chat-composer-row"><textarea class="chat-input" id="chat-input" rows="1" placeholder="Message the league…" readonly></textarea>'
      + '<button class="chat-send-btn" id="chat-send">➤</button></div></div></div>';
  }
  /* entrance of one element as a function of time: hidden before `at`, then a 220 ms rise (the app's nav range) */
  function enter(el, t, at, dy, dur) {
    if (!el) return;
    if (t < at) { el.style.display = 'none'; return; }
    var p = T.span(t, at, at + (dur || .24), T.ease.entrance);
    el.style.display = ''; el.style.opacity = p.toFixed(3);
    el.style.transform = p >= 1 ? '' : 'translateY(' + ((1 - p)*(dy == null ? 12 : dy)).toFixed(1) + 'px)';
  }
  T.ui = { ICON: ICON, glyph: glyph, feedCard: feedCard, gameDay: gameDay, pill: pill, message: message, chatPage: chatPage, enter: enter };
})(window.TEASER);
