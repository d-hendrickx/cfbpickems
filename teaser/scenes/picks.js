/* teaser/scenes/picks.js — Picks scroll + team selection, and the "last pick, submit" moment. PROMO-ONLY.
   Markup mirrors js/app.js renderPicksPageCurrent() / weekNavCardHTML() / renderGameCard() for an OPEN week,
   logos off (the app's own name-only state). Only the timing is scripted. */
(function (T) {
  'use strict';
  var esc = T.esc;
  function spreadLabel(g) {                       /* js/data-model.js formatSpread: "Favorite -n.n" */
    if (g.spread === 0) return 'PK';
    return (g.spread < 0 ? g.home : g.away) + ' -' + Math.abs(g.spread).toFixed(1);
  }
  function teamHTML(side, g) {
    var name = g[side], masc = g[side + 'Mascot'], rk = g[side + 'Rank'], conf = g[side + 'Conf'];
    return '<div class="team ' + side + '">' + (rk ? '<div class="team-rank">#' + rk + ' </div>' : '')
      + '<div class="team-name">' + esc(name) + (masc ? ' <span class="team-mascot">(' + esc(masc) + ')</span>' : '') + '</div>'
      + '<div class="team-conf">' + esc(conf || '') + '</div></div>';
  }
  function btnHTML(side, g, picked) {
    var name = g[side], masc = g[side + 'Mascot'];
    return '<button class="pick-btn' + (picked === name ? ' selected' : '') + '" data-team="' + esc(name) + '" data-game-id="' + esc(g.id) + '">'
      + esc(name) + (masc ? ' (' + esc(masc) + ')' : '') + '</button>';
  }
  function cardHTML(g, picked) {
    return '<div class="game-card" data-game-id="' + esc(g.id) + '">'
      + '<div class="game-card-header"><div class="game-card-meta"><span class="game-time">' + esc(g.kickoff) + '</span></div><div class="game-card-status"></div></div>'
      + '<div class="game-card-body"><div class="matchup">' + teamHTML('away', g) + '<div class="vs-divider">@</div>' + teamHTML('home', g) + '</div>'
      + '<div class="spread-row"><span class="text-muted text-xs">Spread:</span><span class="spread-badge">' + esc(spreadLabel(g)) + '</span></div>'
      + '<div class="pick-buttons">' + btnHTML('away', g, picked) + btnHTML('home', g, picked) + '</div></div></div>';
  }
  function pageHTML(draft) {
    var w = T.week, n = Object.keys(draft).length;
    return '<div class="picks-week-nav"><button class="btn btn-ghost btn-sm" aria-label="Previous week">‹</button>'
      + '<div class="week-heading"><span class="picks-week-nav-label">' + esc(w.label) + '</span> <span class="badge badge-' + w.phase + '">' + esc(w.badge) + '</span>'
      + '<span class="week-heading-dates">' + esc(w.dates) + ' · current</span></div><button class="btn btn-ghost btn-sm" aria-label="Next week">›</button></div>'
      + '<div class="flex-between mb-md"><div><span class="text-maroon font-display" style="font-size:1.05rem">Grant</span><span class="text-muted text-sm"> — make your picks</span></div></div>'
      + '<div id="games-list">' + T.games.map(function (g) { return cardHTML(g, draft[g.id]); }).join('') + '</div>'
      + '<div class="submit-bar"><div class="submit-progress"><strong id="pick-count">' + n + '</strong>/' + T.games.length + ' + tiebreaker</div>'
      + '<button class="btn btn-primary" id="submit-picks-btn"' + (n < T.games.length ? ' disabled' : '') + '>Submit All Picks</button></div>';
  }
  function centreOf(phone, sel) {
    var card = phone.page.querySelector(sel);
    return card.offsetTop + phone.header.offsetHeight - (phone.scroll.clientHeight - card.offsetHeight)/2 + 30;
  }
  function pick(phone, gameId, team, n) {
    var btn = phone.page.querySelector('[data-game-id="' + gameId + '"][data-team="' + team + '"]');
    if (btn) btn.classList.add('selected');           /* the app's own .pick-btn.selected transition does the rest */
    T.tickText(phone.page.querySelector('#pick-count'), String(n));
  }

  /* ── Beat A: scroll through the slate, Texas @ Oregon settles in the centre, Oregon is picked ── */
  var evA = new T.Events()
    .at(2.05, function (phone) { T.tapOn(phone, phone.page.querySelector('[data-game-id="g5"][data-team="Oregon"]')); })
    .at(2.2,  function (phone) { pick(phone, 'g5', 'Oregon', 7); });
  var endA = 0;
  T.register({
    id: 'picks', label: 'Picks', tab: 'picks', duration: 6.0,
    captions: [{ text: 'Make your picks.', from: 1.5, to: 5.4 }],
    mount: function (phone) { T.setPage(phone, 'picks', 'picks', pageHTML(T.draft)); endA = centreOf(phone, '.game-card[data-game-id="g5"]'); },
    reset: function (phone) { if (phone.pageKey !== 'picks') this.mount(phone); else { phone.page.innerHTML = pageHTML(T.draft); } evA.reset(); phone.scroll.scrollTop = 0; },
    tick: function (t, phone) {
      /* 0.3–1.7 s: an inertial scroll decelerating onto the Oregon card; 3.4–4.9 s: a slower drift one card on */
      var y = endA * T.span(t, 0.3, 1.7, T.ease.outQuint);
      if (t > 3.4) y += 150 * T.span(t, 3.4, 4.9, T.ease.outCubic);
      phone.scroll.scrollTop = y;
      evA.fire(t, phone);
    }
  });

  /* ── the last pick and the submit: nine of ten are in, the tenth goes in, Submit wakes and is pressed ── */
  var draft9 = {}; T.games.forEach(function (g, i) { if (i < 9) draft9[g.id] = g.spread < 0 ? g.home : g.away; });
  var evL = new T.Events()
    .at(0.10, function (phone) { T.tapOn(phone, phone.page.querySelector('[data-game-id="g10"][data-team="BYU"]')); })
    .at(0.20, function (phone) { pick(phone, 'g10', 'BYU', 10); var b = phone.page.querySelector('#submit-picks-btn'); if (b) b.disabled = false; })
    .at(0.52, function (phone) { T.tapOn(phone, phone.page.querySelector('#submit-picks-btn')); })
    .at(0.68, function (phone) { var b = phone.page.querySelector('#submit-picks-btn'); if (b) b.textContent = 'Picks Submitted ✓'; });
  T.register({
    id: 'lock', label: 'Last pick', tab: 'picks', duration: 2.4,
    captions: [],
    mount: function (phone) { T.setPage(phone, 'lock', 'picks', pageHTML(draft9)); },
    reset: function (phone) { if (phone.pageKey !== 'lock') this.mount(phone); else phone.page.innerHTML = pageHTML(draft9); evL.reset(); phone.scroll.scrollTop = phone.scroll.scrollHeight; },
    tick: function (t, phone) { phone.scroll.scrollTop = phone.scroll.scrollHeight; evL.fire(t, phone); }
  });
})(window.TEASER);
