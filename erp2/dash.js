/* HN28 현장 ERP v2 — 홈 대시보드: 오늘 처리할 일 · 이번 달 · 개소별 진행률 · 실행예산 집행
 * 서버(dashboard)가 한 번에 계산해 준 값을 보여 주기만 한다. 서버가 보낸 글자는 모두 textContent 로만 넣는다.
 * index.html 이 열어 둔 window.ERP2(api·me·onEnter 등)만 쓴다. */
(function () {
  'use strict';
  var E = window.ERP2; if (!E) return;
  var $ = E.$, el = E.el;
  var seq = 0;                 // 늦게 도착한 옛 응답을 버리기 위한 번호
  var showAll = false;         // 개소 목록: 예정·완료 개소까지 펼침
  var last = null;             // 마지막으로 받은 값
  var startedAt = 0;           // 마지막으로 서버를 부른 시각(같은 순간의 중복 호출을 막는다)
  var DOW = ['일', '월', '화', '수', '목', '금', '토'];
  var TONE_RANK = { act: 0, late: 1, warn: 2, fix: 3, mine: 4 };
  var GO = { exp: 'tileExp', ops: 'tileOps', doc: 'tileDoc', close: 'tileClose' };
  var STATE_CLS = { '완료': 'done', '진행': 'go', '지연': 'late', '예정': 'soon' };

  function num(v) { v = Number(v); return isFinite(v) ? v : 0; }
  function clamp(v) { v = num(v); return v < 0 ? 0 : v > 100 ? 100 : v; }
  function won(n) {
    n = num(n);
    if (n >= 1e8) return (Math.round(n / 1e6) / 100).toLocaleString('ko-KR') + '억원';
    if (n >= 1e6) return Math.round(n / 1e4).toLocaleString('ko-KR') + '만원';
    return n.toLocaleString('ko-KR') + '원';
  }
  function pct(a, b) { b = num(b); return b > 0 ? Math.round(num(a) / b * 1000) / 10 : 0; }
  function fmtDate(d) {
    var p = String(d || '').split('-'); if (p.length !== 3) return '';
    var dt = new Date(+p[0], +p[1] - 1, +p[2]);
    return (+p[1]) + '월 ' + (+p[2]) + '일 (' + DOW[dt.getDay()] + ')';
  }
  function monthName(ym) { return String(ym || '').length === 7 ? Number(String(ym).slice(5, 7)) + '월' : ''; }
  function bar(cls, fill, mark, fill2) {
    var b = el('div', 'pbar ' + (cls || ''));
    if (fill2 !== undefined && fill2 > 0) { var p = el('i', 'pend'); p.style.width = clamp(fill + fill2) + '%'; b.appendChild(p); }
    var f = el('i', 'fill'); f.style.width = clamp(fill) + '%'; b.appendChild(f);
    if (mark !== undefined && mark !== null) { var m = el('u'); m.style.left = clamp(mark) + '%'; m.title = '계획'; b.appendChild(m); }
    return b;
  }
  function kv(box, k, v, cls) { var r = el('div', 'dbkv'); r.appendChild(el('b', '', k)); r.appendChild(el('span', cls || '', v)); box.appendChild(r); }
  function setMsg(text, info) { var m = $('dbMsg'); m.className = 'msg' + (info ? ' info' : ''); m.textContent = text || ''; }
  function hideAll() { ['dbMonth', 'dbSites', 'dbBudget'].forEach(function (id) { $(id).classList.add('hide'); }); }

  // ── ① 오늘 처리할 일 ──
  function renderTodo(r) {
    var box = $('dbTodo'); box.textContent = '';
    $('dbDate').textContent = fmtDate(r.today);
    var list = (r.todo || []).map(function (t, i) { return { t: t, i: i }; }).sort(function (a, b) {
      var ra = TONE_RANK[a.t.tone], rb = TONE_RANK[b.t.tone]; ra = ra === undefined ? 9 : ra; rb = rb === undefined ? 9 : rb;
      return ra - rb || a.i - b.i;
    }).map(function (x) { return x.t; });
    if (!list.length) { box.appendChild(el('div', 'dbok', '지금 처리할 일이 없습니다. 수고하셨습니다.')); return; }
    list.forEach(function (t) {
      var tone = TONE_RANK[t.tone] !== undefined ? t.tone : 'mine';
      var b = el('button', 'dbt ' + tone); b.type = 'button';
      b.appendChild(el('span', 'l', t.label));
      b.appendChild(el('span', 'n', t.tag ? t.tag : num(t.n) + (t.unit || '')));
      var tile = GO[t.go];
      b.onclick = function () { if (tile && $(tile)) $(tile).click(); };
      box.appendChild(b);
    });
  }

  // ── ② 이번 달 ──
  function hqText(state) { return state === '확인' ? '본사 확인 받음' : state === '제출' ? '본사 제출함 (확인 대기)' : '본사 제출 전'; }
  function renderMonth(r) {
    var p = $('dbMonth'), box = $('dbMonthBody'); box.textContent = '';
    var m = r.month || {};
    $('dbMonthTitle').textContent = '이번 달 · ' + monthName(m.ym);
    var st = $('dbMonthState'); st.textContent = m.closed ? '마감됨' : '진행 중'; st.className = 'dbpill ' + (m.closed ? 'closed' : 'open');
    kv(box, '경비', '승인 ' + num(m.expApproved) + '건 · ' + won(m.expTotal) + (num(m.expWaiting) ? ' (승인 전 ' + num(m.expWaiting) + '건)' : ''));
    kv(box, '작업일보', '확인완료 ' + num(m.opsDone) + '건' + (num(m.opsWaiting) ? ' · 확인대기 ' + num(m.opsWaiting) + '건' : '') + ' · 연인원 ' + num(m.people).toLocaleString('ko-KR') + '명');
    kv(box, '마감', m.closed ? ((m.closedBy || '') + ' ' + String(m.closedAt || '').slice(5, 16)) : '아직 마감 전');
    if (m.closed) kv(box, '본사', hqText(m.hq));
    if (r.prev) kv(box, monthName(r.prev.ym), r.prev.closed ? '마감됨 · ' + hqText(r.prev.hq) : '마감 전', r.prev.closed && r.prev.hq ? '' : 'dbwarn');
    p.classList.remove('hide');
  }

  // ── ③ 개소별 진행률 ──
  function siteRow(s) {
    var row = el('div', 'dbs ' + (STATE_CLS[s.state] || 'soon'));
    var nm = el('div', 'nm'); nm.appendChild(el('b', '', s.code + ' ' + s.route)); nm.appendChild(el('small', '', s.location + ' · ' + s.work));
    row.appendChild(nm);
    var pv = s.pct === null || s.pct === undefined ? null : num(s.pct);
    var side = el('div', 'sd'); side.appendChild(el('span', 'tg ' + (STATE_CLS[s.state] || 'soon'), s.state));
    side.appendChild(el('span', 'pv', (pv === null ? '-' : pv + '%') + (s.planned ? ' / 계획 ' + num(s.planned) + '%' : '')));
    row.appendChild(side);
    row.appendChild(bar(STATE_CLS[s.state] || 'soon', pv || 0, s.planned ? num(s.planned) : null));
    if (s.planStart) row.appendChild(el('div', 'pl', '계획 ' + String(s.planStart).slice(2).replace(/-/g, '.') + ' ~ ' + String(s.planEnd).slice(2).replace(/-/g, '.')));
    return row;
  }
  function renderSites(r) {
    var p = $('dbSites'), box = $('dbSitesBody'); box.textContent = '';
    var sum = r.siteSummary || {}, sites = r.sites || [];
    var head = el('div', 'dbhead');
    head.appendChild(el('div', 'big', '전체 평균 ' + num(sum.avgPct) + '%'));
    head.appendChild(el('div', 'sub', '계획 대비 기준 ' + num(sum.avgPlan) + '% · 개소 ' + num(sum.n) + '곳'));
    box.appendChild(head);
    box.appendChild(bar('all', num(sum.avgPct), num(sum.avgPlan)));
    var chips = el('div', 'dbchips');
    [['완료', sum.done, 'done'], ['진행', sum.going, 'go'], ['지연', sum.late, 'late'], ['예정', sum.soon, 'soon']].forEach(function (c) { chips.appendChild(el('span', 'tg ' + c[2], c[0] + ' ' + num(c[1]))); });
    box.appendChild(chips);
    var order = { '지연': 0, '진행': 1, '예정': 2, '완료': 3 };
    var shown = sites.filter(function (s) { return showAll || s.state === '지연' || s.state === '진행'; })
      .map(function (s, i) { return { s: s, i: i }; }).sort(function (a, b) { return (order[a.s.state] || 0) - (order[b.s.state] || 0) || a.i - b.i; }).map(function (x) { return x.s; });
    var list = el('div', 'dbslist'); list.id = 'dbSiteList';
    if (!shown.length) list.appendChild(el('div', 'dbnone', '진행 중이거나 지연된 개소가 없습니다.'));
    shown.forEach(function (s) { list.appendChild(siteRow(s)); });
    box.appendChild(list);
    var hidden = sites.length - shown.length;
    if (hidden > 0 || showAll) {
      var t = el('button', 'sm dbtoggle', showAll ? '진행·지연 개소만 보기' : '예정·완료 개소 ' + hidden + '곳도 보기'); t.type = 'button'; t.id = 'dbSiteToggle';
      t.onclick = function () { showAll = !showAll; if (last) renderSites(last); };
      box.appendChild(t);
    }
    p.classList.remove('hide');
  }

  // ── ④ 실행예산 집행 (서버가 현장소장·공무에게만 보낸다) ──
  function renderBudget(r) {
    var p = $('dbBudget'), box = $('dbBudgetBody'); box.textContent = '';
    if (!r.budget) { p.classList.add('hide'); return; }
    var b = r.budget, t = b.total, pr = r.period || {};
    var head = el('div', 'dbhead');
    head.appendChild(el('div', 'big', '집행 ' + pct(t.spent, t.budget) + '%'));
    head.appendChild(el('div', 'sub', won(t.spent) + ' / 예산 ' + won(t.budget) + (num(t.pending) ? ' · 승인 전 ' + won(t.pending) : '')));
    box.appendChild(head);
    box.appendChild(bar(pct(t.spent, t.budget) > 100 ? 'late' : 'go', pct(t.spent, t.budget), pr.pct === null || pr.pct === undefined ? null : num(pr.pct), pct(t.pending, t.budget)));
    box.appendChild(el('div', 'dbnote', '공기 경과 ' + num(pr.pct) + '% (세로 눈금) · 승인된 경비 공급가 기준 · 간접노무비(상주 인력 급여)는 제외'));
    var list = el('div', 'dbglist');
    (b.groups || []).forEach(function (g) {
      var row = el('div', 'dbg');
      var top = el('div', 'tp'); top.appendChild(el('b', '', g.label)); top.appendChild(el('span', '', pct(g.spent, g.budget) + '%'));
      row.appendChild(top);
      row.appendChild(bar(pct(g.spent, g.budget) > 100 ? 'late' : 'go', pct(g.spent, g.budget), null, pct(g.pending, g.budget)));
      row.appendChild(el('div', 'pl', won(g.spent) + ' / ' + won(g.budget) + (num(g.pending) ? ' · 승인 전 ' + won(g.pending) : '')));
      list.appendChild(row);
    });
    box.appendChild(list);
    p.classList.remove('hide');
  }

  function render(r) { last = r; setMsg(''); renderTodo(r); renderMonth(r); renderSites(r); renderBudget(r); }

  function load(force) {
    if (!E.me()) return;
    if (force !== true && Date.now() - startedAt < 400) return; // 「돌아가기」 한 번에 두 곳에서 동시에 부르는 경우
    startedAt = Date.now();
    var my = ++seq;
    if (!last) { $('dbTodo').textContent = ''; setMsg('현황을 불러오는 중…', true); }
    $('dbRefresh').disabled = true;
    E.api('dashboard', {}, 25000).then(function (r) {
      if (my !== seq) return;
      $('dbRefresh').disabled = false;
      if (E.authLost(r)) return;
      if (!r || !r.ok) { setMsg((r && r.message) || '현황을 불러오지 못했습니다.'); if (!last) hideAll(); return; }
      render(r);
    });
  }
  $('dbRefresh').onclick = function () { load(true); };
  E.onEnter.push(function () { load(); });
  // 경비·작업일보·문서 화면에서 「돌아가기」로 홈에 오면 숫자를 다시 받는다
  var showView = E.showView;
  E.showView = function (name) {
    var wasHome = !$('vHome').classList.contains('hide');
    showView(name);
    if (name === 'vHome' && !wasHome) load();
  };
  E.onLeave.push(function () { seq++; last = null; showAll = false; startedAt = 0; $('dbTodo').textContent = ''; $('dbDate').textContent = ''; setMsg(''); hideAll(); ['dbMonthBody', 'dbSitesBody', 'dbBudgetBody'].forEach(function (id) { $(id).textContent = ''; }); $('dbRefresh').disabled = false; });
})();
