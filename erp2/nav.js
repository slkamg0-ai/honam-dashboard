/* HN28 현장 ERP v2.20 — 이동 메뉴 · 결재함 · 새로 쓰기
 * 휴대폰: 하단 탭(홈 · 결재함 · + · 문서 · 더보기), PC(1024px 이상): 왼쪽 메뉴.
 * 결재함은 홈 대시보드(dashboard)가 계산한 「오늘 처리할 일」을 묶어서 보여 준다. 서버 호출을 따로 늘리지 않는다.
 * 각 업무 화면은 기존 타일 버튼(tileExp 등)을 눌러 여는 방식 그대로 쓴다. */
(function () {
  'use strict';
  var E = window.ERP2; if (!E) return;
  var $ = E.$, el = E.el;

  var TILE = { exp: 'tileExp', doc: 'tileDoc', ops: 'tileOps', task: 'tileTask', close: 'tileClose' };
  var VIEW_KEY = { vHome: 'home', vApv: 'apv', vExp: 'exp', vDoc: 'doc', vOps: 'ops', vTask: 'task', vClose: 'close', vOrg: 'org' };
  var SIDE_VIEWS = ['vOrg', 'vStamp', 'vAdmin', 'vApv'];   // 나갈 때 정리 단계(홈으로 버튼)를 거쳐야 하는 화면
  var APPROVE = { exp: 1, doc: 1, ops: 1 };
  var opener = null, pollTimer = 0;

  function current() {
    var views = ['vHome', 'vApv', 'vOrg', 'vStamp', 'vAdmin', 'vExp', 'vClose', 'vOps', 'vDoc', 'vTask'];
    for (var i = 0; i < views.length; i++) if (!$(views[i]).classList.contains('hide')) return views[i];
    return '';
  }
  function mark(view) {
    var key = VIEW_KEY[view] || '';
    Array.prototype.forEach.call(document.querySelectorAll('#nav .nv'), function (b) {
      if (b.getAttribute('data-go') === key) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
  }
  var showView = E.showView;
  E.showView = function (name) { showView(name); mark(name); };

  function leaveSide() { if (SIDE_VIEWS.indexOf(current()) >= 0) $('btnHome').click(); }
  function goHome() { if (current() !== 'vHome') $('btnHome').click(); window.scrollTo(0, 0); }
  function openTile(key) {
    clearTimeout(pollTimer);
    leaveSide();
    var t = $(TILE[key]); if (t) t.click();
    window.scrollTo(0, 0);
  }
  function go(key) {
    closeSheet(true);
    if (key === 'home') return goHome();
    if (key === 'apv') return openApv();
    if (key === 'org') { leaveSide(); $('btnOrg').click(); window.scrollTo(0, 0); return; }
    if (key === 'new') return openSheet('new');
    if (key === 'more') return openSheet('more');
    if (TILE[key]) openTile(key);
  }

  // ── 새로 쓰기: 목록 화면을 연 뒤 기본 정보가 다 오면 등록 버튼을 눌러 준다 ──
  function visible(b) { return b && !b.classList.contains('hide') && b.offsetParent !== null && !b.disabled; }
  function loading(msgId) { var m = $(msgId); return m && /불러오는/.test(m.textContent || ''); }
  var READY = {
    exp: function () { return !loading('xMsg') && !!$('xMonth').value; },
    ops: function () { return !loading('oMsg') && !!$('oMonth').value; },
    doc: function () { return true; },
    task: function () { return !!$('tSum').textContent; }
  };
  function quickNew(key, btnId) {
    openTile(key);
    var tries = 0;
    (function wait() {
      var b = $(btnId);
      if (READY[key]() && visible(b)) { b.click(); return; }
      if (++tries > 80) return;          // 10초 안에 준비되지 않으면 목록 화면에 그대로 둔다
      pollTimer = setTimeout(wait, 125);
    })();
  }

  // ── 아래에서 올라오는 선택 창 ──
  function item(label, sub, fn) {
    var b = el('button'); b.type = 'button';
    b.appendChild(document.createTextNode(label));
    if (sub) b.appendChild(el('small', '', sub));
    b.onclick = function () { closeSheet(true); fn(); };
    return b;
  }
  function openSheet(kind) {
    var me = E.me() || {}, body = $('navSheetBody'); body.textContent = '';
    var gm = me.role === '현장소장' || me.role === '공무';
    if (kind === 'new') {
      $('navSheetT').textContent = '새로 쓰기';
      body.appendChild(item('경비 등록', '영수증 사진과 금액', function () { quickNew('exp', 'xNew'); }));
      body.appendChild(item('작업일보 쓰기', '오늘 출역 · 장비 · 작업내용', function () { quickNew('ops', 'oNew'); }));
      body.appendChild(item('품의 쓰기', '회장 결재가 필요한 건', function () { quickNew('doc', 'dNewP'); }));
      body.appendChild(item('공문 쓰기', '감리단 · 발주처로 보내는 문서', function () { quickNew('doc', 'dNewG'); }));
      body.appendChild(item('받은 문서 접수', '발주처 · 감리단에서 온 공문', function () { quickNew('doc', 'dNewR'); }));
      if (gm) body.appendChild(item('업무 지시', '담당자와 기한 정하기', function () { quickNew('task', 'tNew'); }));
    } else {
      $('navSheetT').textContent = '메뉴';
      body.appendChild(item('경비', '영수증 등록 · 검토 · 승인', function () { openTile('exp'); }));
      body.appendChild(item('작업일보', '출역 · 장비 · 작업내용', function () { openTile('ops'); }));
      body.appendChild(item('업무 지시', '지시 · 기한 · 완료 확인', function () { openTile('task'); }));
      body.appendChild(item('월 마감', '점검 · 마감 · 본사 제출 엑셀', function () { openTile('close'); }));
      body.appendChild(item('조직표', '', function () { leaveSide(); $('btnOrg').click(); }));
    }
    opener = document.activeElement;
    $('navSheet').classList.remove('hide');
    var first = body.querySelector('button'); if (first) first.focus();
  }
  function closeSheet(silent) {
    var s = $('navSheet'); if (s.classList.contains('hide')) return;
    s.classList.add('hide');
    if (!silent && opener && opener.focus) opener.focus();
    opener = null;
  }
  $('navSheetClose').onclick = function () { closeSheet(); };
  $('navSheet').onclick = function (e) { if (e.target === $('navSheet')) closeSheet(); };
  $('navSheet').addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); closeSheet(); } });

  // ── 결재함 ──
  function groups(todo) {
    var g = { act: [], late: [], fix: [], task: [], etc: [] };
    (todo || []).forEach(function (t) {
      if (t.go === 'task') g.task.push(t);
      else if (t.tone === 'act' && APPROVE[t.go]) g.act.push(t);
      else if (t.tone === 'late') g.late.push(t);
      else if (t.tone === 'fix') g.fix.push(t);
      else g.etc.push(t);
    });
    return g;
  }
  function count(list) { return list.reduce(function (a, t) { return a + (Number(t.n) || 0); }, 0); }
  function row(t) {
    var tone = (E.dash && E.dash.tone && E.dash.tone[t.tone] !== undefined) ? t.tone : 'mine';
    var b = el('button', 'dbt ' + tone); b.type = 'button';
    b.appendChild(el('span', 'l', t.label));
    b.appendChild(el('span', 'n', t.tag ? t.tag : (Number(t.n) || 0) + (t.unit || '')));
    b.onclick = function () { if (TILE[t.go]) openTile(t.go); };
    return b;
  }
  function renderApv(r) {
    var box = $('apvBody'); box.textContent = '';
    var g = groups(r && r.todo);
    var parts = [['내가 결재·확인할 것', g.act], ['기한이 지난 것', g.late], ['반려되어 고칠 것', g.fix], ['지시받은 업무', g.task], ['그 밖에 챙길 일', g.etc]];
    var any = false;
    parts.forEach(function (p) {
      if (!p[1].length) return;
      any = true;
      var sec = el('div', 'apv-g'); sec.appendChild(el('h4', '', p[0]));
      p[1].forEach(function (t) { sec.appendChild(row(t)); });
      box.appendChild(sec);
    });
    if (!any) box.appendChild(el('div', 'dbok', '결재하거나 고칠 것이 없습니다.'));
  }
  function badge(r) {
    var n = count(groups(r && r.todo).act), b = $('navApvN');
    b.textContent = n > 99 ? '99+' : String(n);
    b.classList.toggle('hide', !n);
    var btn = document.querySelector('#nav .nv[data-go="apv"]');
    if (btn) btn.setAttribute('aria-label', n ? '결재함, 결재할 것 ' + n + '건' : '결재함');
  }
  function setApvMsg(t, info) { var m = $('apvMsg'); m.className = 'msg' + (info ? ' info' : ''); m.textContent = t || ''; }
  function openApv() {
    leaveSide();
    E.showView('vApv'); window.scrollTo(0, 0);
    var last = E.dash && E.dash.last();
    if (last) renderApv(last); else setApvMsg('불러오는 중…', true);
    if (E.dash) E.dash.load(true);
  }
  $('apvRefresh').onclick = function () { setApvMsg('불러오는 중…', true); if (E.dash) E.dash.load(true); };
  $('apvBack').onclick = function () { E.showView('vHome'); };

  E.onDash = E.onDash || [];
  E.onDash.push(function (r) { badge(r); setApvMsg(''); if (current() === 'vApv') renderApv(r); });

  Array.prototype.forEach.call(document.querySelectorAll('#nav .nv'), function (b) {
    b.onclick = function () { go(b.getAttribute('data-go')); };
  });
  E.onEnter.push(function () { mark(current() || 'vHome'); });
  E.onLeave.push(function () { clearTimeout(pollTimer); closeSheet(true); $('apvBody').textContent = ''; setApvMsg(''); var b = $('navApvN'); b.textContent = ''; b.classList.add('hide'); });
})();
