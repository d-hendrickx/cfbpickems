/* teaser/scenes/standings.js — Beat D: a player climbs the Season Summary. PROMO-ONLY.
   Markup mirrors js/app.js renderLeaderboard() ("stand-season"). The app re-renders this table without motion;
   the row slide here is a promo animation of the app's own rows (cells are moved, nothing is redrawn). */
(function (T) {
  'use strict';
  var esc = T.esc;
  function rowHTML(s, i, n) {
    var p = T.byId[s.id], rank = i + 1;
    var mark = i === 0 ? '<span class="stand-mark">👑</span>' : i === n - 1 ? '<span class="stand-mark">🤡</span>' : '';
    return '<tr class="' + (i === 0 ? 'winner-row' : i === n - 1 ? 'loser-row' : '') + '" data-tz-row="' + s.id + '">'
      + '<td class="rank-cell rank-' + rank + '" data-tz-rank>' + rank + '</td>'
      + '<td class="stand-name"><div class="stand-name-wrap"><span class="stand-name-text player-name-cell">' + esc(p.name) + '</span>' + mark + '</div></td>'
      + '<td class="stand-num"><span class="result-win" data-tz-w>' + s.w + '</span><span class="stand-dash">–</span><span class="result-loss" data-tz-l>' + s.l + '</span></td>'
      + '<td class="stand-num" data-tz-pct>' + s.pct + '%</td>'
      + '<td class="stand-num" data-tz-weeks>' + s.weeks + '</td></tr>';
  }
  function pageHTML() {
    var st = T.standings;
    return '<div class="section-header"><h2>Standings</h2><div class="subtitle">Season 2026</div></div>'
      + '<div class="admin-section-title" data-section-header>Season Summary</div>'
      + '<div class="stand-box"><table class="stand-table stand-table-season" aria-label="Season Summary">'
      + '<colgroup><col class="stand-c-rank"><col><col class="stand-c-picks"><col class="stand-c-pct"><col class="stand-c-weeks"></colgroup>'
      + '<thead><tr><th scope="col" class="stand-c">#</th><th scope="col" class="stand-l">Player</th><th scope="col">Picks</th><th scope="col">Win %</th><th scope="col">Weeks</th></tr></thead>'
      + '<tbody>' + st.map(function (s, i) { return rowHTML(s, i, st.length); }).join('') + '</tbody></table></div>';
  }
  var C = T.climb, FROM = 3;                 /* Grant: 4th (index 3) to 2nd (index 1) */
  function row(phone, id) { return phone.page.querySelector('[data-tz-row="' + id + '"]'); }
  function shift(tr, y, lift) {
    if (!tr) return;
    Array.prototype.forEach.call(tr.children, function (td) {
      /* moved by layout offset, not a transform: a transformed cell is drawn as its own layer and its text goes soft while it
         moves (the owner, 2026-11-15: "the names are like blurred out"). Whole pixels, so the lettering stays crisp. */
      td.style.position = y || lift ? 'relative' : '';
      td.style.top = y ? Math.round(y) + 'px' : '';
      td.classList.toggle('tz-lift', !!lift);
    });
  }
  function setRank(tr, rank) { var c = tr && tr.querySelector('[data-tz-rank]'); if (!c) return; c.className = 'rank-cell rank-' + rank; T.tickText(c, String(rank)); }
  var ev = new T.Events()
    .at(0.30, function (phone) {             /* the week is graded: Grant's line updates first */
      var tr = row(phone, C.id); if (!tr) return;
      T.tickText(tr.querySelector('[data-tz-w]'), String(C.w)); T.tickText(tr.querySelector('[data-tz-l]'), String(C.l));
      T.tickText(tr.querySelector('[data-tz-pct]'), C.pct + '%'); T.tickText(tr.querySelector('[data-tz-weeks]'), C.weeks);
    })
    .at(0.82, function (phone) {             /* ranks renumber as the rows cross */
      setRank(row(phone, C.id), C.to + 1);
      T.standings.forEach(function (s, i) { if (i >= C.to && i < FROM) setRank(row(phone, s.id), i + 2); });
    });
  var badge = { phase:'final', label:'Final' };
  T.register({
    id: 'standings', label: 'Standings', tab: 'leaderboard', duration: 3.2,
    captions: [{ text: 'Climb the ranks.', from: 0.3, to: 2.9 }],
    mount: function (phone) { T.setPage(phone, 'standings', 'leaderboard', pageHTML(), { badge: badge }); },
    reset: function (phone) { if (phone.pageKey !== 'standings') this.mount(phone); else { phone.page.innerHTML = pageHTML(); T.setTab(phone, 'leaderboard', badge); } ev.reset(); phone.scroll.scrollTop = 0; },
    tick: function (t, phone) {
      var tr = row(phone, C.id); if (!tr) return;
      var h = tr.offsetHeight;
      /* 0.45–1.0 s: the row lifts and slides up two places on the app's large-motion curve; the two it passes move down one */
      var p = T.span(t, 0.45, 1.0, T.ease.native);
      shift(tr, -h*(FROM - C.to)*p, p > 0 && t < 1.35);
      T.standings.forEach(function (s, i) { if (i >= C.to && i < FROM) shift(row(phone, s.id), h*p, false); });
      ev.fire(t, phone);
    }
  });
})(window.TEASER);
