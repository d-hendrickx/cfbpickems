/* teaser/data.js — PROMO-ONLY demo data for the Munera teaser. Not production code.
   Six players and a plausible Week 8 slate. All six names and initials are invented, so no real person appears
   with words they never said (compliance finding T-1, 2026-11-15).
   Oregon is on the slate because the Scribe line in the storyboard names it. */
window.TEASER = window.TEASER || {};
TEASER.players = [
  { id:'p1', name:'Grant',   initials:'GH' },
  { id:'p2', name:'Mason',   initials:'MT' },
  { id:'p3', name:'Tyler',   initials:'TC' },
  { id:'p4', name:'Cole',    initials:'CR' },
  { id:'p5', name:'Nolan',   initials:'NP' },
  { id:'p6', name:'Marcus',  initials:'MB' },
];
TEASER.week = { label:'Week 8', dates:'Oct 24–25', badge:'Open', phase:'open' };
/* spread is the app's signed home-perspective number; favorite + display derive from it. */
TEASER.games = [
  { id:'g1',  away:'Alabama',      awayMascot:'Crimson Tide', awayRank:4,  awayConf:'SEC',     home:'Tennessee',   homeMascot:'Volunteers', homeRank:11, homeConf:'SEC',     spread:3.5,  kickoff:'Sat 10/24 11:00 CT' },
  { id:'g2',  away:'Penn State',   awayMascot:'Nittany Lions',awayRank:7,  awayConf:'Big Ten', home:'Ohio State',  homeMascot:'Buckeyes',   homeRank:2,  homeConf:'Big Ten', spread:-6.5, kickoff:'Sat 10/24 11:00 CT' },
  { id:'g3',  away:'Texas A&M',    awayMascot:'Aggies',       awayRank:9,  awayConf:'SEC',     home:'LSU',         homeMascot:'Tigers',     homeRank:14, homeConf:'SEC',     spread:-1.5, kickoff:'Sat 10/24 14:30 CT' },
  { id:'g4',  away:'Notre Dame',   awayMascot:'Fighting Irish',awayRank:12,awayConf:'Ind',     home:'USC',         homeMascot:'Trojans',    homeRank:null,homeConf:'Big Ten',spread:2.5,  kickoff:'Sat 10/24 14:30 CT' },
  { id:'g5',  away:'Texas',        awayMascot:'Longhorns',    awayRank:6,  awayConf:'SEC',     home:'Oregon',      homeMascot:'Ducks',      homeRank:3,  homeConf:'Big Ten', spread:-6.5, kickoff:'Sat 10/24 18:30 CT' },
  { id:'g6',  away:'Oklahoma',     awayMascot:'Sooners',      awayRank:16, awayConf:'SEC',     home:'Georgia',     homeMascot:'Bulldogs',   homeRank:1,  homeConf:'SEC',     spread:-9.5, kickoff:'Sat 10/24 18:30 CT' },
  { id:'g7',  away:'Arkansas',     awayMascot:'Razorbacks',   awayRank:null,awayConf:'SEC',    home:'Missouri',    homeMascot:'Tigers',     homeRank:19, homeConf:'SEC',     spread:-4.5, kickoff:'Sat 10/24 15:00 CT' },
  { id:'g8',  away:'Michigan',     awayMascot:'Wolverines',   awayRank:10, awayConf:'Big Ten', home:'Indiana',     homeMascot:'Hoosiers',   homeRank:8,  homeConf:'Big Ten', spread:-2.5, kickoff:'Sat 10/24 19:00 CT' },
  { id:'g9',  away:'Clemson',      awayMascot:'Tigers',       awayRank:15, awayConf:'ACC',     home:'Miami',       homeMascot:'Hurricanes', homeRank:5,  homeConf:'ACC',     spread:-7.0, kickoff:'Sat 10/24 19:30 CT' },
  { id:'g10', away:'Utah',         awayMascot:'Utes',         awayRank:20, awayConf:'Big 12',  home:'BYU',         homeMascot:'Cougars',    homeRank:13, homeConf:'Big 12',  spread:-3.0, kickoff:'Sat 10/24 21:15 CT' },
];
/* Grant's draft picks when the Picks scene opens: six of ten, the Oregon game still open. */
TEASER.draft = { g1:'Alabama', g2:'Ohio State', g3:'Texas A&M', g4:'Notre Dame', g6:'Georgia', g7:'Missouri' };

/* ---- added for the full film (PROMO-ONLY demo data) ---- */
TEASER.accent = { p1:'#500000', p2:'#841617', p3:'#0C2340', p4:'#B58A00', p5:'#9D2235', p6:'#2F4F4F' };
TEASER.byId = {}; TEASER.players.forEach(function (p) { TEASER.byId[p.id] = p; });
/* Season Summary before Week 8 is graded. Picks = weighted W–L, Win % = raw, Weeks = weeks won–lost. */
TEASER.standings = [
  { id:'p6', w:46, l:24, pct:66, weeks:'3–1' },
  { id:'p4', w:43, l:27, pct:61, weeks:'2–1' },
  { id:'p5', w:42, l:28, pct:60, weeks:'1–1' },
  { id:'p1', w:41, l:29, pct:59, weeks:'1–2' },
  { id:'p3', w:38, l:32, pct:54, weeks:'0–1' },
  { id:'p2', w:33, l:37, pct:47, weeks:'0–1' },
];
/* Grant goes 8–2 in Week 8 and climbs from 4th to 2nd. */
TEASER.climb = { id:'p1', w:49, l:31, pct:61, weeks:'2–2', to:1 };
