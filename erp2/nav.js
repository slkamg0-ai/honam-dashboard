/* HN28 현장 ERP v2.20 — 이동 메뉴 · 결재함 · 새로 쓰기
 * 휴대폰: 하단 탭(홈 · 결재함 · + · 문서 · 더보기), PC(1024px 이상): 왼쪽 메뉴.
 * 결재함: 서버 approvalQueue(v2.20)로 건별 목록을 받아 바로 검토·승인·확인하고, 나머지 할 일은 대시보드 값을 묶어 보여 준다.
 * 홈의 「자동처리 기록」: 대시보드가 함께 보내는 auto(루트 폴더 자동처리 예약 작업이 남긴 기록)를 그린다.
 * 각 업무 화면은 기존 타일 버튼(tileExp 등)을 눌러 여는 방식 그대로 쓴다. */
(function () {
  'use strict';
  var E = window.ERP2; if (!E) return;
  var $ = E.$, el = E.el;

  var TILE = { exp: 'tileExp', doc: 'tileDoc', ops: 'tileOps', task: 'tileTask', close: 'tileClose', jnl: 'tileJnl' };
  var VIEW_KEY = { vHome: 'home', vApv: 'apv', vExp: 'exp', vDoc: 'doc', vOps: 'ops', vTask: 'task', vClose: 'close', vOrg: 'org', vJnl: 'jnl' };
  var SIDE_VIEWS = ['vOrg', 'vStamp', 'vAdmin', 'vApv'];   // 나갈 때 정리 단계(홈으로 버튼)를 거쳐야 하는 화면
  var APPROVE = { exp: 1, doc: 1, ops: 1 };
  var opener = null, pollTimer = 0;

  function current() {
    var views = ['vHome', 'vApv', 'vOrg', 'vStamp', 'vAdmin', 'vExp', 'vClose', 'vOps', 'vDoc', 'vTask', 'vJnl'];
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
    task: function () { return !!$('tSum').textContent; },
    jnl: function () { return !loading('jMsg') && !!$('jSum').textContent; }
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
      if (me.role === '현장소장') body.appendChild(item('작업일지 쓰기', '나만 보는 하루 기록', function () { quickNew('jnl', 'jNew'); }));
    } else {
      $('navSheetT').textContent = '메뉴';
      body.appendChild(item('경비', '영수증 등록 · 검토 · 승인', function () { openTile('exp'); }));
      body.appendChild(item('작업일보', '출역 · 장비 · 작업내용', function () { openTile('ops'); }));
      body.appendChild(item('업무 지시', '지시 · 기한 · 완료 확인', function () { openTile('task'); }));
      if (me.role === '현장소장') body.appendChild(item('작업일지', '나만 보는 하루 기록 · 검색', function () { openTile('jnl'); }));
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
  // 위: 서버 approvalQueue가 주는 건별 목록(바로 검토·승인·확인). 아래: 대시보드의 나머지 할 일(기한·반려·지시·그 밖).
  var KIND = { exp: '경비', doc: '문서', ops: '일보' };
  var STEP = {
    exp: { review: ['reviewExpense', '검토 완료'], approve: ['approveExpense', '승인'] },
    doc: { review: ['reviewDoc', '검토 완료'], approve: ['approveDoc', '승인'] },
    ops: { confirm: ['confirmOps', '확인'] }
  };
  var queue = null, qSeq = 0, doneNote = '';
  function won(n) { return (Number(n) || 0).toLocaleString('ko-KR') + '원'; }
  function groups(todo) {
    var g = { late: [], fix: [], task: [], etc: [] };
    (todo || []).forEach(function (t) {
      if (t.tone === 'act' && APPROVE[t.go]) return;   // 결재할 것은 위 건별 목록이 대신한다
      if (t.go === 'task') g.task.push(t);
      else if (t.tone === 'late') g.late.push(t);
      else if (t.tone === 'fix') g.fix.push(t);
      else g.etc.push(t);
    });
    return g;
  }
  function actCount(todo) { return (todo || []).reduce(function (a, t) { return a + (t.tone === 'act' && APPROVE[t.go] ? (Number(t.n) || 0) : 0); }, 0); }
  function row(t) {
    var tone = (E.dash && E.dash.tone && E.dash.tone[t.tone] !== undefined) ? t.tone : 'mine';
    var b = el('button', 'dbt ' + tone); b.type = 'button';
    b.appendChild(el('span', 'l', t.label));
    b.appendChild(el('span', 'n', t.tag ? t.tag : (Number(t.n) || 0) + (t.unit || '')));
    b.onclick = function () {
      if (t.go === 'auto') { goHome(); var a = $('dbAuto'); if (a) a.scrollIntoView({ block: 'start' }); return; }
      if (TILE[t.go]) openTile(t.go);
    };
    return b;
  }
  function itemCard(it) {
    var c = el('div', 'apv-i');
    var t = el('div', 't'); t.appendChild(el('span', 'k ' + it.kind, KIND[it.kind] || ''));
    t.appendChild(el('span', '', it.title || '(제목 없음)'));
    if (it.kind === 'exp' && it.amount) t.appendChild(el('span', 'amt', won(it.amount)));
    else if (it.kind === 'doc' && it.amount) t.appendChild(el('span', 'amt', String(it.amount)));
    c.appendChild(t);
    var stepWord = it.step === 'review' ? '검토할 차례' : it.step === 'approve' ? '승인할 차례' : '확인할 차례';
    c.appendChild(el('div', 's', [stepWord, it.sub, String(it.date || '').slice(5), it.author, it.no].filter(function (x) { return x; }).join(' · ')));
    var bx = el('div', 'b'), def = (STEP[it.kind] || {})[it.step];
    var msg = el('div', 'msg');
    if (def) {
      var go = el('button', 'go2', def[1]); go.type = 'button';
      var armed = 0;
      go.onclick = function () {
        if (!armed) { // 실수로 한 번 눌러 처리되지 않게 한 번 더 누르게 한다
          go.classList.add('arm'); go.textContent = '한 번 더 누르면 ' + def[1];
          armed = setTimeout(function () { armed = 0; go.classList.remove('arm'); go.textContent = def[1]; }, 4000);
          return;
        }
        clearTimeout(armed); armed = 0;
        go.disabled = true; go.textContent = '처리 중…'; msg.className = 'msg info'; msg.textContent = '';
        E.api(def[0], { id: it.id, decision: 'ok' }, 30000).then(function (r) {
          if (E.authLost(r)) return;
          if (!r.ok) { go.disabled = false; go.classList.remove('arm'); go.textContent = def[1]; msg.className = 'msg'; msg.textContent = r.message || '처리하지 못했습니다.'; return; }
          doneNote = (KIND[it.kind] || '') + ' 「' + (it.title || '') + '」 ' + def[1] + ' 처리했습니다.' + (r.warn ? ' ' + r.warn : '');
          if (queue) queue.items = queue.items.filter(function (x) { return x !== it; });
          renderApv(E.dash && E.dash.last());
          if (E.dash) E.dash.load(true);
        });
      };
      bx.appendChild(go);
    }
    var open = el('button', '', '열기 · 반려'); open.type = 'button';
    open.onclick = function () { leaveSide(); if (E.openItem && E.openItem[it.kind]) E.openItem[it.kind](it.id); else openTile(it.kind); window.scrollTo(0, 0); };
    bx.appendChild(open);
    c.appendChild(bx); c.appendChild(msg);
    return c;
  }
  function renderApv(r) {
    var box = $('apvBody'); box.textContent = '';
    var any = false;
    if (doneNote) box.appendChild(el('div', 'msg info', doneNote));
    if (queue && queue.items.length) {
      any = true;
      var sec = el('div', 'apv-g'); sec.appendChild(el('h4', '', '지금 결재할 것 ' + queue.items.length + '건'));
      queue.items.forEach(function (it) { sec.appendChild(itemCard(it)); });
      box.appendChild(sec);
    } else if (!queue && r && actCount(r.todo)) {
      any = true;
      box.appendChild(el('div', 'desc', '결재할 건을 불러오는 중…'));
    }
    var g = groups(r && r.todo);
    [['기한이 지난 것', g.late], ['반려되어 고칠 것', g.fix], ['지시받은 업무', g.task], ['그 밖에 챙길 일', g.etc]].forEach(function (p) {
      if (!p[1].length) return;
      any = true;
      var sec = el('div', 'apv-g'); sec.appendChild(el('h4', '', p[0]));
      p[1].forEach(function (t) { sec.appendChild(row(t)); });
      box.appendChild(sec);
    });
    if (!any) box.appendChild(el('div', 'dbok', '결재하거나 고칠 것이 없습니다.'));
  }
  function loadQueue() {
    var my = ++qSeq;
    E.api('approvalQueue', {}, 25000).then(function (r) {
      if (my !== qSeq) return;
      if (E.authLost(r)) return;
      if (!r.ok) { // 서버가 아직 v2.20 전이면 UNKNOWN 같은 오류가 온다 → 예전처럼 종류별 합계만 보여 준다
        queue = { items: [], err: true };
        setApvMsg(r.error === 'NETWORK' ? (r.message || '서버에 연결하지 못했습니다.') : '건별 결재 목록은 서버를 v2.20으로 새로 배포하면 보입니다. 지금은 각 화면에서 결재해 주세요.');
      } else { queue = { items: r.items || [] }; setApvMsg(''); }
      if (current() === 'vApv') renderApv(E.dash && E.dash.last());
    });
  }
  function badge(r) {
    var n = actCount(r && r.todo), b = $('navApvN');
    b.textContent = n > 99 ? '99+' : String(n);
    b.classList.toggle('hide', !n);
    var btn = document.querySelector('#nav .nv[data-go="apv"]');
    if (btn) btn.setAttribute('aria-label', n ? '결재함, 결재할 것 ' + n + '건' : '결재함');
  }
  function setApvMsg(t, info) { var m = $('apvMsg'); m.className = 'msg' + (info ? ' info' : ''); m.textContent = t || ''; }
  function openApv() {
    leaveSide();
    E.showView('vApv'); window.scrollTo(0, 0);
    queue = null; doneNote = ''; setApvMsg('불러오는 중…', true);
    renderApv(E.dash && E.dash.last());
    loadQueue();
    if (E.dash) E.dash.load(true);
  }
  $('apvRefresh').onclick = function () { setApvMsg('불러오는 중…', true); loadQueue(); if (E.dash) E.dash.load(true); };
  $('apvBack').onclick = function () { E.showView('vHome'); };

  // ── 홈: 루트 폴더 자동처리 기록 ──
  function renderAuto(r) {
    var p = $('dbAuto'), box = $('dbAutoBody'), a = r && r.auto;
    if (!a) { p.classList.add('hide'); return; }       // 서버가 v2.20 전이면 기록을 보내지 않는다
    p.classList.remove('hide'); box.textContent = '';
    var pill = $('dbAutoN');
    pill.textContent = a.open ? '확인할 일 ' + a.open + '건' : '';
    pill.className = 'dbpill' + (a.open ? ' open' : '');
    if (!a.items.length) { box.appendChild(el('div', 'desc', '아직 기록이 없습니다. 루트 폴더에 파일을 올리면 매시간 자동으로 정리하고 여기에 남깁니다.')); return; }
    a.items.forEach(function (o) {
      var it = el('div', 'au-i');
      var h = el('div', 'h'); h.appendChild(el('b', '', o.file || '(파일 이름 없음)')); h.appendChild(el('span', '', String(o.at || '').slice(5, 16).replace('-', '.')));
      it.appendChild(h);
      if (o.action) it.appendChild(el('div', 'w', o.action));
      if (o.where) it.appendChild(el('div', 'w', '위치: ' + o.where));
      if (o.todo) {
        var done = o.status === '확인함';
        var td = el('div', 'todo' + (done ? ' done' : ''));
        td.appendChild(el('div', '', (done ? '확인함 (' + (o.by || '') + ') · ' : '할 일: ') + o.todo));
        if (!done && a.canDone) {
          var b = el('button', 'sm', '확인함으로 표시'); b.type = 'button';
          b.onclick = function () {
            b.disabled = true; b.textContent = '처리 중…';
            E.api('doneAuto', { row: o.row, file: o.file }, 20000).then(function (x) {
              if (E.authLost(x)) return;
              if (!x.ok) { b.disabled = false; b.textContent = '확인함으로 표시'; td.appendChild(el('div', 'msg', x.message || '처리하지 못했습니다.')); return; }
              if (E.dash) E.dash.load(true);
            });
          };
          td.appendChild(b);
        }
        it.appendChild(td);
      }
      box.appendChild(it);
    });
  }

  // ── 작업 개소: 사람마다 이 기기에 저장, 새 경비·작업일보의 개소 기본값으로 쓴다 ──
  function siteKey() { var me = E.me() || {}; return 'HN28V2_SITE_' + (me.loginId || ''); }
  E.workSite = function () { try { return Number(localStorage.getItem(siteKey())) || 0; } catch (e) { return 0; } };
  function saveSite(n) { try { if (n) localStorage.setItem(siteKey(), String(n)); else localStorage.removeItem(siteKey()); } catch (e) {} }
  var siteList = [];
  function renderSiteNow() {
    var box = $('workSiteNow'), n = E.workSite(); box.textContent = '';
    var st = siteList.filter(function (x) { return x.no === n; })[0];
    if (!n || !st) { box.appendChild(document.createTextNode('새 경비·작업일보의 개소가 여기서 고른 곳으로 먼저 채워집니다.')); return; }
    box.appendChild(el('b', '', '#' + st.no + ' ' + st.route + ' ' + st.location));
    var bits = [st.work];
    if (st.pct !== null && st.pct !== undefined) bits.push('진행 ' + st.pct + '%' + (st.inPlan ? ' (계획 ' + st.planned + '%)' : ''));
    else bits.push('아직 일보 없음');
    if (st.planStart) bits.push('계획 ' + String(st.planStart).slice(2).replace(/-/g, '.') + '~' + String(st.planEnd).slice(2).replace(/-/g, '.'));
    if (st.lastDate) bits.push('최근 일보 ' + String(st.lastDate).slice(5).replace('-', '.'));
    box.appendChild(document.createTextNode(' · ' + bits.filter(String).join(' · ')));
  }
  function fillSites(r) {
    if (!r || !r.sites || !r.sites.length) return;
    siteList = r.sites.slice().sort(function (a, b) { return a.no - b.no; });
    var sel = $('workSite'), cur = E.workSite();
    if (sel.options.length !== siteList.length + 1) {
      sel.textContent = '';
      var o0 = document.createElement('option'); o0.value = '0'; o0.textContent = '전체 (개소 정하지 않음)'; sel.appendChild(o0);
      siteList.forEach(function (x) { var o = document.createElement('option'); o.value = String(x.no); o.textContent = '#' + x.no + ' ' + x.route + ' ' + x.location; sel.appendChild(o); });
    }
    sel.value = String(siteList.some(function (x) { return x.no === cur; }) ? cur : 0);
    renderSiteNow();
  }
  $('workSite').onchange = function () { saveSite(Number($('workSite').value) || 0); renderSiteNow(); };

  E.onDash = E.onDash || [];
  E.onDash.push(function (r) { badge(r); renderAuto(r); fillSites(r); if (current() === 'vApv') { if (queue && !queue.err) setApvMsg(''); renderApv(r); } });

  Array.prototype.forEach.call(document.querySelectorAll('#nav .nv'), function (b) {
    b.onclick = function () { go(b.getAttribute('data-go')); };
  });
  E.onEnter.push(function () { mark(current() || 'vHome'); });
  E.onLeave.push(function () { clearTimeout(pollTimer); closeSheet(true); queue = null; qSeq++; $('apvBody').textContent = ''; $('dbAutoBody').textContent = ''; $('dbAuto').classList.add('hide'); setApvMsg(''); var b = $('navApvN'); b.textContent = ''; b.classList.add('hide'); });
})();
