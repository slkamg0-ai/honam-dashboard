/* HN28 현장 ERP v2 — 4단계: 작업일보(출역·장비·작업내용) 입력·확인 화면
 * index.html 이 열어 둔 window.ERP2(api·me·showView 등)만 쓴다. 서버가 보낸 글자는 모두 textContent 로만 넣는다. */
(function () {
  'use strict';
  var E = window.ERP2; if (!E) return;
  var $ = E.$, el = E.el;
  var M = null;            // 서버 마스터(개소·계획·휴무일 …)
  var month = '';          // 보고 있는 달 (YYYY-MM)
  var pendingId = '';     // 결재함에서 「열기」로 들어온 건(목록을 받으면 바로 상세를 연다)
  var filter = 'all';      // all | mine | queue
  var items = [];
  var closedList = [];
  var latest = {};         // 개소별 가장 최근 누계 진행률 {개소번호: {date, pct}}
  var F = null;            // 작성 중인 양식 상태
  var busy = false;
  var DOW = ['일', '월', '화', '수', '목', '금', '토'];

  function setMsg(id, text, info) { var m = $(id); m.className = 'msg' + (info ? ' info' : ''); m.textContent = text || ''; }
  function show(id, on) { $(id).classList.toggle('hide', !on); }
  function pane(name) { show('oList', name === 'list'); show('oDetail', name === 'detail'); show('oForm', name === 'form'); window.scrollTo(0, 0); }
  function fail(msgId, r) { if (E.authLost(r)) return true; if (r && r.ok) return false; setMsg(msgId, (r && r.message) || '처리하지 못했습니다.'); return false; }
  function dayName(d) { var p = d.split('-'); return DOW[new Date(+p[0], +p[1] - 1, +p[2]).getDay()]; }
  function mmdd(d) { return d.slice(5) + '(' + dayName(d) + ')'; }
  function isMgrOrGm() { var me = E.me(); return !!me && (me.role === '공무' || me.role === '현장소장'); }

  function withMaster(cb, msgId) {
    if (M) { cb(); return; }
    setMsg(msgId, '불러오는 중…', true);
    E.api('getMaster', {}, 20000).then(function (r) {
      if (E.authLost(r)) return;
      if (!r.ok) { setMsg(msgId, r.message || '기본 정보를 불러오지 못했습니다.'); return; }
      M = r; setMsg(msgId, ''); cb();
    });
  }
  function siteOf(no) { return (M ? M.sites : []).filter(function (x) { return x.no === no; })[0] || null; }
  function siteLabel(no) {
    if (!no) return '공통 (개소 없음)';
    var s = siteOf(no); return s ? s.code + ' · ' + s.route + ' ' + s.location : '개소' + no;
  }
  function holidayOf(date) { var h = (M ? M.holidays : []).filter(function (x) { return x[0] === date; })[0]; return h ? h[1] : ''; }
  /** 계획 대비 위치와 사유가 필요한 이유(서버와 같은 규칙) */
  function judge(date, site, kind) {
    var hol = holidayOf(date), s = site ? siteOf(site) : null, pos = 'common', why = [];
    if (s) pos = date < s.planStart ? 'before' : date > s.planEnd ? 'after' : 'in';
    if (hol) why.push(hol + ' 작업');
    if (pos === 'before') why.push('계획 착수일보다 앞선 작업');
    if (pos === 'after') why.push('계획 완료일보다 늦은 작업');
    if (kind !== '계획') why.push('구분이 「' + kind + '」');
    return { hol: hol, pos: pos, why: why, site: s };
  }
  function closedInfo(ym) { return closedList.filter(function (c) { return c.ym === ym; })[0] || null; }

  // ── 홈 타일의 확인 대기 표시 ──
  function myTodo(list) {
    var me = E.me(); if (!me || !isMgrOrGm()) return 0;
    return list.filter(function (i) { return i.status === '확인대기' && i.authorId !== me.loginId; }).length;
  }
  function refreshBadge() {
    var sub = $('tileOpsSub'); if (!sub) return;
    sub.textContent = '출역 · 장비 · 작업내용';
    E.api('listOps', { queue: true }, 15000).then(function (r) {
      if (!r || !r.ok) return;
      var n = myTodo(r.items); if (!n) return;
      sub.textContent = '';
      sub.appendChild(document.createTextNode('확인할 일보 '));
      sub.appendChild(el('span', 'badge', n + '건'));
    });
  }
  E.onEnter.push(refreshBadge);
  E.onLeave.push(function () { items = []; F = null; month = ''; filter = 'all'; M = null; latest = {}; closedList = []; $('oItems').textContent = ''; $('oDetail').textContent = ''; $('oSum').textContent = ''; $('oMissing').textContent = ''; });

  // ── 목록 ──
  function openList() {
    E.showView('vOps'); pane('list');
    M = null; // 열 때마다 계획·휴무일·마감 목록을 새로 받는다
    withMaster(function () { if (!month) month = M.today.slice(0, 7); $('oMonth').value = month; closedList = M.closed || []; buildFilters(); load(); }, 'oMsg');
  }
  $('tileOps').onclick = openList;
  E.openItem = E.openItem || {};
  E.openItem.ops = function (id) { filter = 'queue'; pendingId = String(id || ''); openList(); };
  $('oBack').onclick = function () { E.showView('vHome'); refreshBadge(); };

  function buildFilters() {
    var box = $('oFilters'); box.textContent = '';
    [['all', '이번 달 전체'], ['mine', '내가 쓴 것'], ['queue', '확인 대기함']].forEach(function (f) {
      var b = el('button', filter === f[0] ? 'sel' : '', f[1]); b.type = 'button';
      b.onclick = function () { filter = f[0]; buildFilters(); load(); };
      box.appendChild(b);
    });
    var q = filter === 'queue'; $('oMonth').disabled = q; $('oPrev').disabled = q; $('oNext').disabled = q; $('oThis').disabled = q;
  }
  function shiftMonth(d) { if (!month) return; var y = +month.slice(0, 4), m = +month.slice(5, 7) + d; if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; } month = y + '-' + (m < 10 ? '0' : '') + m; $('oMonth').value = month; load(); }
  $('oPrev').onclick = function () { shiftMonth(-1); };
  $('oNext').onclick = function () { shiftMonth(1); };
  $('oThis').onclick = function () { if (!M) return; month = M.today.slice(0, 7); $('oMonth').value = month; load(); };
  $('oMonth').onchange = function () { if (/^\d{4}-\d{2}$/.test($('oMonth').value)) { month = $('oMonth').value; load(); } };

  var seq = 0;
  function load() {
    var my = ++seq;
    setMsg('oMsg', '불러오는 중…', true);
    var req = filter === 'queue' ? { queue: true } : { month: month };
    E.api('listOps', req, 25000).then(function (r) {
      if (my !== seq) return; // 그 사이에 다른 달·보기로 넘어갔다
      if (E.authLost(r)) return;
      if (!r.ok) { items = []; render(); setMsg('oMsg', r.message || '목록을 불러오지 못했습니다.'); return; }
      items = r.items; closedList = r.closed || []; latest = r.latest || {}; setMsg('oMsg', ''); render();
      if (pendingId) { var hit = items.filter(function (x) { return x.id === pendingId; })[0]; pendingId = ''; if (hit) showDetail(hit); }
    });
  }

  /** 착공(가장 이른 개소 계획 착수일) 이후 오늘까지, 휴무일이 아닌데 일보가 하나도 없는 날 */
  function missingDays(list) {
    if (!M || filter === 'queue') return [];
    var first = M.sites.reduce(function (a, s) { return !a || s.planStart < a ? s.planStart : a; }, '');
    var have = {}; list.forEach(function (i) { if (i.status !== '반려') have[i.date] = true; });
    var out = [], y = +month.slice(0, 4), m = +month.slice(5, 7), last = new Date(y, m, 0).getDate();
    for (var d = 1; d <= last; d++) {
      var ds = month + '-' + (d < 10 ? '0' : '') + d;
      if (ds < first || ds > M.today || holidayOf(ds) || have[ds]) continue;
      out.push(ds);
    }
    return out;
  }

  function render() {
    var me = E.me(); var list = items;
    if (filter === 'mine') list = items.filter(function (i) { return i.authorId === me.loginId; });
    var sum = $('oSum'); sum.textContent = '';
    var cnt = {}, people = 0;
    list.forEach(function (i) { cnt[i.status] = (cnt[i.status] || 0) + 1; if (i.status === '확인완료' || i.status === '확인대기') people += i.people; });
    var head = filter === 'queue' ? '확인 대기 ' + list.length + '건' : (month.replace('-', '년 ') + '월 · ' + list.length + '건');
    sum.appendChild(document.createTextNode(head + ' · 확인완료 ' + (cnt['확인완료'] || 0) + '건' + (cnt['확인대기'] ? ' · 확인대기 ' + cnt['확인대기'] + '건' : '') + (cnt['반려'] ? ' · 반려 ' + cnt['반려'] + '건' : '')));
    sum.appendChild(document.createElement('br')); sum.appendChild(document.createTextNode('연인원 ' + people.toLocaleString('ko-KR') + '명 (확인완료·확인대기 합계)'));
    var cl = filter !== 'queue' ? closedInfo(month) : null;
    if (cl) { sum.appendChild(document.createElement('br')); sum.appendChild(document.createTextNode('이 달은 마감되었습니다 (' + cl.by + ', ' + cl.at.slice(0, 16) + '). 일보를 올리거나 확인하려면 현장소장이 마감을 해제해야 합니다.')); }
    var ms = $('oMissing'); ms.textContent = '';
    var miss = missingDays(items);
    if (miss.length) ms.appendChild(el('div', 'rej', '일보가 없는 날 ' + miss.length + '일: ' + miss.map(mmdd).join(', ') + '  (휴무일 제외)'));
    var box = $('oItems'); box.textContent = '';
    if (!list.length) { box.appendChild(el('div', 'desc', filter === 'queue' ? '확인을 기다리는 작업일보가 없습니다.' : '이 달에 등록된 작업일보가 없습니다.')); return; }
    list.forEach(function (i) {
      var c = el('div', 'xi'); c.tabIndex = 0; c.setAttribute('role', 'button');
      var r1 = el('div', 'r1'); r1.appendChild(el('span', '', siteLabel(i.site))); r1.appendChild(el('span', '', i.people + '명'));
      var r2 = el('div', 'r2');
      r2.appendChild(el('span', 'st st-' + i.status, i.status));
      r2.appendChild(document.createTextNode(' ' + mmdd(i.date) + ' · ' + i.weather + (i.kind !== '계획' ? ' · ' + i.kind : '') + (i.progress !== null ? ' · 누계 ' + i.progress + '%' : '') + ' · ' + i.author));
      var r3 = el('div', 'r2', i.memo);
      c.appendChild(r1); c.appendChild(r2); c.appendChild(r3);
      c.onclick = function () { showDetail(i); };
      c.onkeydown = function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); showDetail(i); } };
      box.appendChild(c);
    });
  }

  // ── 상세 ──
  function kv(box, k, v) { var g = box.querySelector('.kv') || box.appendChild(el('div', 'kv')); g.appendChild(el('b', '', k)); g.appendChild(el('span', '', v)); }

  function showDetail(i) {
    var me = E.me(), mine = i.authorId === me.loginId;
    var box = $('oDetail'); box.textContent = ''; pane('detail');
    var p = el('div', 'panel'); box.appendChild(p);
    var h = el('h3', '', '작업일보 상세 '); var b = el('button', 'sm', '목록으로'); b.type = 'button'; b.style.float = 'right'; b.onclick = function () { pane('list'); load(); }; h.appendChild(b); p.appendChild(h);
    var st = el('div'); st.appendChild(el('span', 'st st-' + i.status, i.status)); if (i.docNo) st.appendChild(document.createTextNode('  일보번호 ' + i.docNo)); p.appendChild(st);
    if (i.status === '반려' && i.reason) p.appendChild(el('div', 'rej', '반려 사유: ' + i.reason + (i.confirmer ? '  (' + i.confirmer + ')' : '')));
    kv(p, '작업일', i.date + ' (' + dayName(i.date) + ') · ' + i.weather); kv(p, '개소', siteLabel(i.site));
    var s = i.site ? siteOf(i.site) : null; if (s) kv(p, '공종·계획', s.work + ' · ' + s.planStart + ' ~ ' + s.planEnd);
    kv(p, '구분', i.kind); if (i.offReason) kv(p, '계획 외 사유', i.offReason);
    if (i.progress !== null) kv(p, '누계 진행률', i.progress + '%');
    kv(p, '출역 인원', '합계 ' + i.people + '명 (직원 ' + i.staff + ' · 기능공/일용 ' + i.worker + ' · 열차감시원/신호수 ' + i.safety + ')');
    kv(p, '장비·자재', i.equip || '-'); kv(p, '작업내용', i.memo);
    kv(p, '작성', i.author + ' · ' + i.created);
    if (i.confirmer && i.status === '확인완료') kv(p, '확인', i.confirmer + ' · ' + i.confirmedAt);

    var btns = el('div', 'row-btns'); p.appendChild(btns);
    var msg = el('div', 'msg'); msg.id = 'oDMsg'; p.appendChild(msg);
    function btn(text, cls, fn) { var x = el('button', cls || '', text); x.type = 'button'; x.onclick = fn; btns.appendChild(x); return x; }
    function act(action, data, okText) {
      if (busy) return; busy = true; setMsg('oDMsg', '처리 중…', true);
      E.api(action, data, 30000).then(function (r) {
        busy = false;
        if (fail('oDMsg', r)) return;
        if (!r.ok) return;
        if (action === 'deleteOps') { pane('list'); load(); return; }
        showDetail(r.item); setMsg('oDMsg', okText, true);
      });
    }
    function reasonBox(label, placeholder) {
      btns.textContent = ''; var t = el('textarea'); t.id = 'oDReason'; t.rows = 2; t.maxLength = 200; t.placeholder = placeholder;
      var w = el('div'); w.style.width = '100%'; w.appendChild(t); btns.appendChild(w);
      btn('취소', '', function () { showDetail(i); });
      btn(label, 'warn', function () { var v = t.value.trim(); if (v.length < 2) { setMsg('oDMsg', '사유를 적어 주세요.'); return; } act('confirmOps', { id: i.id, decision: 'reject', reason: v }, '반려했습니다. 작성자가 고쳐서 다시 제출합니다.'); });
    }

    if (mine && (i.status === '작성중' || i.status === '반려')) {
      btn('수정', '', function () { openForm(i); });
      btn(i.status === '반려' ? '다시 제출' : '제출', 'pri', function () { act('submitOps', { id: i.id }, '제출했습니다. 공무(또는 현장소장)의 확인을 기다립니다.'); }).style.marginTop = '0';
      btn('삭제', 'warn', function () { if (confirm('이 작업일보를 삭제할까요?')) act('deleteOps', { id: i.id }, ''); });
    }
    if (i.status === '확인대기' && !mine && isMgrOrGm()) {
      btn('확인', 'ok', function () { act('confirmOps', { id: i.id, decision: 'ok' }, '확인했습니다.'); });
      btn('반려', 'warn', function () { reasonBox('반려 확정', '반려 사유 (예: 출역 인원이 TBM 기록과 다릅니다)'); });
    }
    if (i.status === '확인완료' && me.role === '현장소장') {
      btn('확인 취소 (되돌리기)', 'warn', function () { reasonBox('되돌리기 확정', '되돌리는 사유 (예: 장비 투입 내용 정정 필요)'); });
    }
    if (i.status === '확인대기' && mine) p.appendChild(el('div', 'desc', '공무(또는 현장소장)의 확인을 기다리는 중입니다. 제출한 일보는 고칠 수 없습니다.'));
    if (i.status === '확인대기' && !mine && !isMgrOrGm()) p.appendChild(el('div', 'desc', '공무 또는 현장소장의 확인을 기다리는 중입니다.'));
  }

  // ── 양식 ──
  function fillSelect(sel, values) { sel.textContent = ''; values.forEach(function (v) { var o = el('option', '', typeof v === 'object' ? v.t : v); o.value = typeof v === 'object' ? v.v : v; sel.appendChild(o); }); }
  function cnt(id) { var t = String($(id).value || '').trim(); return /^\d{1,3}$/.test(t) ? Number(t) : NaN; }
  function pct(id) { var t = String($(id).value || '').trim(); return /^\d{1,3}$/.test(t) ? Number(t) : NaN; }
  function sumPeople() { var a = cnt('oStaff'), b = cnt('oWorker'), c = cnt('oSafety'); $('oTotal').textContent = (isNaN(a) || isNaN(b) || isNaN(c)) ? '-' : (a + b + c) + '명'; }
  ['oStaff', 'oWorker', 'oSafety'].forEach(function (id) { $(id).addEventListener('input', sumPeople); });

  /** 작업일에 계획상 진행 중인 개소(없으면 공통) */
  function siteByDate(date) {
    var hit = M.sites.filter(function (s) { return date >= s.planStart && date <= s.planEnd; })[0];
    return hit ? hit.no : 0;
  }
  /** 개소·날짜가 바뀌면: 계획 정보, 권장 구분, 기본 진행률, 사유 칸·안내를 다시 맞춘다 */
  function refreshPlan(resetKind, resetProg) {
    var date = $('oDate').value, site = Number($('oSite').value) || 0;
    var s = site ? siteOf(site) : null;
    $('oSiteInfo').textContent = s ? s.work + ' · 계획 ' + s.planStart + ' ~ ' + s.planEnd : '개소가 없는 일(가설·준비·안전교육 등)은 계획 기간을 검사하지 않습니다.';
    if (resetKind && /^\d{4}-\d{2}-\d{2}$/.test(date)) { var j0 = judge(date, site, '계획'); $('oKind').value = j0.pos === 'before' ? '선행' : j0.pos === 'after' ? '지연만회' : '계획'; }
    show('oProgWrap', !!site);
    if (resetProg && site) { var l = latest[String(site)]; $('oProg').value = l ? String(l.pct) : '0'; $('oProgHint').textContent = l ? '(직전 ' + l.date.slice(5) + ' 일보: ' + l.pct + '%)' : '(이 개소의 첫 일보)'; }
    var kind = $('oKind').value, j = judge(date, site, kind), ym = date.slice(0, 7), hint = $('oHint'), lines = [];
    show('oReasonWrap', j.why.length > 0);
    if (j.why.length) { hint.className = 'ohint need'; lines.push('⚠ 사유 필요 — ' + j.why.join(' · ')); }
    else { hint.className = 'ohint'; lines.push('✔ ' + (j.pos === 'in' ? '계획 기간 안의 작업입니다.' : '계획 기간을 검사하지 않는 일보입니다.')); }
    if (closedInfo(ym)) { hint.className = 'ohint need'; lines.push('⚠ ' + ym + '은(는) 마감된 달이라 저장할 수 없습니다. 현장소장이 마감을 해제해야 합니다.'); }
    hint.textContent = lines.join('\n');
  }
  // 날짜를 바꾸면(새 일보이고 개소를 직접 고르지 않았을 때) 그 날 계획상 진행 중인 개소를 자동으로 고른다. 직접 고른 개소는 바꾸지 않는다.
  $('oDate').addEventListener('change', function () {
    if (!M || !F) return;
    if (F.id) { refreshPlan(false, false); return; }
    var n = F.siteManual ? 0 : siteByDate($('oDate').value); // 그 날 계획상 진행 중인 개소가 없으면 지금 개소를 그대로 둔다
    if (n) { $('oSite').value = String(n); refreshPlan(!F.kindManual, true); } else refreshPlan(!F.kindManual, false);
  });
  $('oSite').addEventListener('change', function () { if (M && F) { F.siteManual = true; refreshPlan(!F.kindManual, true); } });
  $('oKind').addEventListener('change', function () { if (M && F) { F.kindManual = true; refreshPlan(false, false); } });

  function openForm(it) {
    withMaster(function () {
      F = { id: it ? it.id : '', siteManual: false, kindManual: false };
      fillSelect($('oWeather'), M.opsWeather); fillSelect($('oKind'), M.opsKinds);
      fillSelect($('oSite'), [{ v: '0', t: '공통 (개소 없음)' }].concat(M.sites.map(function (s) { return { v: String(s.no), t: s.code + ' · ' + s.route + ' ' + s.location + ' (' + s.work + ')' }; })));
      $('oTitle').textContent = it ? (it.status === '반려' ? '작업일보 고치기 (반려됨)' : '작업일보 고치기') : '작업일보 쓰기';
      $('oDate').max = M.today; $('oDate').value = it ? it.date : M.today;
      var base = it || (items.filter(function (x) { return x.authorId === E.me().loginId; })[0]) || null; // 새 일보는 내가 마지막으로 쓴 인원을 기본값으로
      $('oWeather').value = it ? it.weather : M.opsWeather[0];
      var ws = !it && E.workSite ? E.workSite() : 0; // 홈에서 고른 작업 개소가 있으면 그것을 먼저
      $('oSite').value = String(it ? it.site : (ws && $('oSite').querySelector('option[value="' + ws + '"]') ? ws : siteByDate(M.today)));
      $('oStaff').value = base ? String(base.staff) : '0'; $('oWorker').value = base ? String(base.worker) : '0'; $('oSafety').value = base ? String(base.safety) : '0'; sumPeople();
      $('oEquip').value = it ? it.equip : ''; $('oMemo').value = it ? it.memo : ''; $('oReason').value = it ? it.offReason : '';
      refreshPlan(!it, !it);
      if (it) { $('oKind').value = it.kind; if (it.progress !== null) $('oProg').value = String(it.progress); $('oProgHint').textContent = ''; refreshPlan(false, false); }
      setMsg('oFMsg', ''); pane('form');
    }, 'oMsg');
  }
  $('oNew').onclick = function () { openForm(null); };
  $('oCancel').onclick = function () { F = null; pane('list'); };

  function collect() {
    var site = Number($('oSite').value) || 0;
    return { date: $('oDate').value, weather: $('oWeather').value, site: site, kind: $('oKind').value, progress: site ? pct('oProg') : null,
      staff: cnt('oStaff'), worker: cnt('oWorker'), safety: cnt('oSafety'), equip: $('oEquip').value.trim(), memo: $('oMemo').value.trim(), offReason: $('oReason').value.trim() };
  }
  function problem(v) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) return '작업일을 입력해 주세요.';
    if (v.date > M.today) return '오늘 이후 날짜의 작업일보는 쓸 수 없습니다.';
    if (isNaN(v.staff) || isNaN(v.worker) || isNaN(v.safety)) return '인원은 0명 이상의 숫자로 입력해 주세요. (없으면 0)';
    if (v.site && (isNaN(v.progress) || v.progress > 100)) return '누계 진행률은 0~100 사이의 정수(%)로 입력해 주세요.';
    if (v.memo.length < 2) return '금일 작업내용을 입력해 주세요. (작업이 없었다면 그 사유)';
    var j = judge(v.date, v.site, v.kind); if (j.why.length && v.offReason.length < 2) return '계획 밖 작업입니다 (' + j.why.join(' · ') + '). 사유를 적어 주세요.';
    if (closedInfo(v.date.slice(0, 7))) return v.date.slice(0, 7) + '은(는) 마감된 달입니다. 현장소장이 마감을 해제해야 저장할 수 있습니다.';
    return '';
  }

  function saveForm(submit, force) {
    if (busy) return;
    var v = collect(), bad = problem(v); if (bad) { setMsg('oFMsg', bad); return; }
    var data = { id: F.id || undefined, date: v.date, weather: v.weather, site: v.site, kind: v.kind, progress: v.progress, staff: v.staff, worker: v.worker, safety: v.safety,
      equip: v.equip, memo: v.memo, offReason: v.offReason, force: !!force };
    busy = true; $('oDraft').disabled = $('oSubmit').disabled = true; setMsg('oFMsg', '저장하는 중…', true);
    function done() { busy = false; $('oDraft').disabled = $('oSubmit').disabled = false; }
    E.api('saveOps', data, 30000).then(function (r) {
      if (E.authLost(r)) { done(); return; }
      if (!r.ok) {
        done();
        if (r.error === 'DUP') { if (confirm(r.message + '\n\n그래도 저장할까요?')) saveForm(submit, true); else setMsg('oFMsg', '저장하지 않았습니다.'); return; }
        setMsg('oFMsg', r.message || '저장하지 못했습니다.'); return;
      }
      var saved = r.item; F = null;
      if (!submit) { done(); showDetail(saved); setMsg('oDMsg', '임시저장했습니다. 제출하면 공무·현장소장의 확인 단계로 넘어갑니다.', true); return; }
      E.api('submitOps', { id: saved.id }, 30000).then(function (s) {
        done(); if (E.authLost(s)) return;
        if (!s.ok) { showDetail(saved); setMsg('oDMsg', '저장은 했지만 제출하지 못했습니다: ' + (s.message || ''), false); return; }
        showDetail(s.item); setMsg('oDMsg', '제출했습니다. 공무(또는 현장소장)의 확인을 기다립니다.', true);
      });
    });
  }
  $('oDraft').onclick = function () { saveForm(false); };
  $('oSubmit').onclick = function () { saveForm(true); };
})();
