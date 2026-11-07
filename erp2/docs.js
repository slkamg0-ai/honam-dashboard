/* HN28 현장 ERP v2 — 6단계: 문서(품의·공문·접수) 작성·결재·대장 화면
 * index.html 이 열어 둔 window.ERP2(api·me·showView 등)만 쓴다. 서버가 보낸 글자는 모두 textContent 로만 넣는다. */
(function () {
  'use strict';
  var E = window.ERP2; if (!E) return;
  var $ = E.$, el = E.el;
  var items = [], next = {}, today = '';
  var filter = 'all', query = '';
  var F = null;            // 작성 중인 양식 상태 {kind, id}
  var busy = false;
  var KINDS = ['품의', '공문', '접수'];

  function setMsg(id, text, info) { var m = $(id); m.className = 'msg' + (info ? ' info' : ''); m.textContent = text || ''; }
  function show(id, on) { $(id).classList.toggle('hide', !on); }
  function pane(name) { show('dList', name === 'list'); show('dDetail', name === 'detail'); show('dForm', name === 'form'); window.scrollTo(0, 0); }
  function fail(msgId, r) { if (E.authLost(r)) return true; if (r && r.ok) return false; setMsg(msgId, (r && r.message) || '처리하지 못했습니다.'); return false; }
  function isGm() { var me = E.me(); return !!me && (me.role === '공무' || me.role === '현장소장'); }
  function isMgr() { var me = E.me(); return !!me && me.role === '현장소장'; }
  function myId() { var me = E.me(); return me ? me.loginId : ''; }
  function safeUrl(u) { return /^https:\/\/(docs|drive)\.google\.com\//.test(String(u || '')) ? u : ''; }
  /** 서버가 알려 준 오늘(없으면 이 기기의 오늘) */
  function todayStr() {
    if (today) return today;
    var d = new Date(), m = d.getMonth() + 1, dd = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (dd < 10 ? '0' : '') + dd;
  }
  function dayDiff(a, b) { var x = a.split('-'), y = b.split('-'); return Math.round((new Date(+x[0], +x[1] - 1, +x[2]) - new Date(+y[0], +y[1] - 1, +y[2])) / 86400000); }

  /** 내가 결재(검토·승인)해야 하는 문서 */
  function needsMe(i) {
    if (i.status === '검토대기') return isGm() && i.authorId !== myId();
    if (i.status === '승인대기') return isMgr();
    return false;
  }
  /** 회신을 기다리는 문서: {late, days} (기한이 없으면 null) */
  function replyInfo(i) {
    if (i.kind === '품의' || i.replied || !i.due) return null;
    if (i.status !== '접수' && i.status !== '확정') return null;
    var d = dayDiff(i.due, todayStr());
    return { late: d < 0, days: d };
  }

  // ── 홈 타일 배지 ──
  function refreshBadge() {
    var sub = $('tileDocSub'); if (!sub) return;
    sub.textContent = '품의 · 공문 · 접수 · 문서대장';
    E.api('listDocs', {}, 15000).then(function (r) {
      if (!r || !r.ok) return;
      today = r.today || today;
      var a = r.items.filter(needsMe).length;
      var b = r.items.filter(function (i) { var x = replyInfo(i); return x && x.late; }).length;
      if (!a && !b) return;
      sub.textContent = '';
      if (a) { sub.appendChild(document.createTextNode('결재할 문서 ')); sub.appendChild(el('span', 'badge', a + '건')); }
      if (b) { sub.appendChild(document.createTextNode(a ? ' · 회신 지연 ' : '회신 지연 ')); sub.appendChild(el('span', 'badge', b + '건')); }
    });
  }
  E.onEnter.push(refreshBadge);
  E.onLeave.push(function () { items = []; next = {}; F = null; filter = 'all'; query = ''; $('dItems').textContent = ''; $('dDetail').textContent = ''; $('dSum').textContent = ''; $('dSearch').value = ''; });

  // ── 목록 ──
  function openList() { E.showView('vDoc'); pane('list'); buildFilters(); load(); }
  $('tileDoc').onclick = openList;
  $('dBack').onclick = function () { E.showView('vHome'); refreshBadge(); };

  var FILTERS = [['all', '전체'], ['품의', '품의'], ['공문', '공문'], ['접수', '접수'], ['mine', '내가 쓴 것'], ['queue', '결재 대기함'], ['reply', '회신 필요']];
  function buildFilters() {
    var box = $('dFilters'); box.textContent = '';
    FILTERS.forEach(function (f) {
      var b = el('button', filter === f[0] ? 'sel' : '', f[1]); b.type = 'button';
      b.onclick = function () { filter = f[0]; buildFilters(); render(); };
      box.appendChild(b);
    });
  }
  $('dSearch').oninput = function () { query = $('dSearch').value.trim().toLowerCase(); render(); };

  var seq = 0;
  function load() {
    var my = ++seq;
    setMsg('dMsg', '불러오는 중…', true);
    E.api('listDocs', {}, 25000).then(function (r) {
      if (my !== seq) return;
      if (E.authLost(r)) return;
      if (!r.ok) { items = []; render(); setMsg('dMsg', r.message || '목록을 불러오지 못했습니다.'); return; }
      items = r.items; next = r.next || {}; today = r.today || today; setMsg('dMsg', ''); render();
    });
  }

  function visible() {
    return items.filter(function (i) {
      if (filter === '품의' || filter === '공문' || filter === '접수') { if (i.kind !== filter) return false; }
      else if (filter === 'mine') { if (i.authorId !== myId()) return false; }
      else if (filter === 'queue') { if (!needsMe(i)) return false; }
      else if (filter === 'reply') { if (!replyInfo(i)) return false; }
      if (query) { var hay = (i.docNo + ' ' + i.title + ' ' + i.party + ' ' + i.author).toLowerCase(); if (hay.indexOf(query) < 0) return false; }
      return true;
    });
  }

  function chipFor(i) {
    var c = el('span', 'st st-' + i.status, i.status); return c;
  }

  function render() {
    var list = visible();
    var sum = $('dSum'); sum.textContent = '';
    var n = { 확정: 0, 진행: 0, 작성중: 0, 접수: 0, 결번: 0 };
    items.forEach(function (i) {
      if (i.status === '확정') n.확정++; else if (i.status === '검토대기' || i.status === '승인대기') n.진행++; else if (i.status === '작성중' || i.status === '반려') n.작성중++; else if (i.status === '접수') n.접수++; else if (i.status === '결번') n.결번++;
    });
    sum.appendChild(document.createTextNode('전체 ' + items.length + '건 · 확정 ' + n.확정 + ' · 결재 중 ' + n.진행 + ' · 작성중·반려 ' + n.작성중 + ' · 접수 ' + n.접수 + (n.결번 ? ' · 결번 ' + n.결번 : '')));
    var q = items.filter(needsMe).length;
    if (q) { sum.appendChild(document.createElement('br')); sum.appendChild(document.createTextNode('내가 결재할 문서 ' + q + '건')); }
    var nx = $('dNext'); nx.textContent = '다음 번호: ' + KINDS.map(function (k) { return next[k] || ''; }).filter(Boolean).join(' / ');
    var box = $('dItems'); box.textContent = '';
    if (!list.length) { box.appendChild(el('div', 'desc', filter === 'queue' ? '결재를 기다리는 문서가 없습니다.' : filter === 'reply' ? '회신을 기다리는 문서가 없습니다.' : '조건에 맞는 문서가 없습니다.')); return; }
    list.forEach(function (i) {
      var c = el('div', 'xi'); c.tabIndex = 0; c.setAttribute('role', 'button');
      if (i.status === '결번') c.style.opacity = '.6';
      var r1 = el('div', 'r1'); r1.appendChild(el('span', '', i.title)); r1.appendChild(el('span', '', i.kind));
      var r2 = el('div', 'r2');
      r2.appendChild(chipFor(i));
      r2.appendChild(document.createTextNode(' ' + i.docNo + ' · ' + i.date + (i.party ? ' · ' + i.party : '') + ' · ' + i.author));
      var r3 = el('div', 'r2');
      var ri = replyInfo(i);
      if (i.hq && i.hq.state) r3.appendChild(el('span', 'st st-hq', '본사 ' + i.hq.state));
      if (ri) r3.appendChild(el('span', 'st ' + (ri.late ? 'st-반려' : 'st-검토대기'), ri.late ? '회신 ' + (-ri.days) + '일 지연' : ri.days === 0 ? '오늘 회신기한' : '회신 D-' + ri.days));
      if (i.kind !== '품의' && i.replied) r3.appendChild(el('span', 'st st-승인', '회신 완료'));
      if (needsMe(i)) r3.appendChild(el('span', 'st st-검토대기', '내 차례'));
      c.appendChild(r1); c.appendChild(r2); if (r3.childNodes.length) c.appendChild(r3);
      c.onclick = function () { showDetail(i); };
      c.onkeydown = function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); showDetail(i); } };
      box.appendChild(c);
    });
  }

  // ── 상세 ──
  function kv(box, k, v) { var g = box.querySelector('.kv') || box.appendChild(el('div', 'kv')); g.appendChild(el('b', '', k)); g.appendChild(el('span', '', v)); }
  function kvLink(box, k, text, url) {
    var g = box.querySelector('.kv') || box.appendChild(el('div', 'kv')); g.appendChild(el('b', '', k));
    var sp = el('span'); var u = safeUrl(url);
    if (u) { var a = el('a', '', text); a.href = u; a.target = '_blank'; a.rel = 'noopener noreferrer'; sp.appendChild(a); } else sp.textContent = '-';
    g.appendChild(sp);
  }

  function showDetail(i, flash) {
    var mine = i.authorId === myId();
    var box = $('dDetail'); box.textContent = ''; pane('detail');
    var p = el('div', 'panel'); box.appendChild(p);
    var h = el('h3', '', i.kind + ' 상세 '); var b = el('button', 'sm', '목록으로'); b.type = 'button'; b.style.float = 'right'; b.onclick = function () { pane('list'); load(); }; h.appendChild(b); p.appendChild(h);
    var st = el('div'); st.appendChild(chipFor(i)); st.appendChild(document.createTextNode('  ' + i.docNo)); p.appendChild(st);
    if (i.status === '반려' && i.reason) p.appendChild(el('div', 'rej', '반려 사유: ' + i.reason + (i.approver ? '  (' + i.approver + ')' : i.reviewer ? '  (' + i.reviewer + ')' : '')));
    if (i.status === '결번' && i.reason) p.appendChild(el('div', 'rej', '결번 사유: ' + i.reason));
    kv(p, '제목', i.title); kv(p, '일자', i.date);
    if (i.party) kv(p, i.kind === '접수' ? '보낸 곳' : '수신', i.party);
    if (i.ref) kv(p, '참조', i.ref);
    if (i.summary) kv(p, i.kind === '접수' ? '내용 요지' : '본문 요지', i.summary);
    if (i.attach) kv(p, i.kind === '공문' ? '붙임' : '첨부', i.attach);
    if (i.due) kv(p, '회신기한', i.due + (i.kind !== '품의' ? (i.replied ? ' (회신 완료)' : '') : ''));
    kvLink(p, '문서', i.link ? '문서 열기 (구글 문서)' : '', i.link);
    kvLink(p, '폴더', i.folderUrl ? '드라이브 폴더 열기' : '', i.folderUrl);
    if (i.pdf) kvLink(p, '확정본', '확정 PDF 열기', i.pdf);
    kv(p, '작성', i.author + ' · ' + i.created);
    if (i.reviewer && (i.status === '승인대기' || i.status === '확정')) kv(p, '검토', i.reviewer + ' · ' + i.reviewedAt);
    if (i.approver && i.status === '확정') kv(p, '승인', i.approver + ' · ' + i.approvedAt);
    if (i.hq && i.hq.state) kv(p, '본사', '본사 ' + i.hq.state + ' · ' + i.hq.by + ' · ' + String(i.hq.at).slice(0, 16) + (i.hq.state === '확인' && i.hq.submitAt ? ' (제출 ' + String(i.hq.submitAt).slice(0, 16) + ')' : '') + (i.hq.note ? ' · ' + i.hq.note : ''));
    if (i.note) kv(p, '비고', i.note);

    var area = el('div'); p.appendChild(area);
    var btns = el('div', 'row-btns'); area.appendChild(btns);
    var msg = el('div', 'msg'); msg.id = 'dDMsg'; p.appendChild(msg);
    if (flash) setMsg('dDMsg', flash, true);
    function btn(text, cls, fn) { var x = el('button', cls || '', text); x.type = 'button'; x.onclick = fn; btns.appendChild(x); return x; }
    function act(action, data, okText) {
      if (busy) return; busy = true; setMsg('dDMsg', '처리 중…', true);
      E.api(action, data, 40000).then(function (r) {
        busy = false;
        if (fail('dDMsg', r)) return;
        if (!r.ok) return;
        showDetail(r.item, okText);
      });
    }
    /** 사유·메모를 적는 칸을 버튼 자리에 연다 */
    function noteBox(label, placeholder, required, cls, fn) {
      btns.textContent = ''; var t = el('textarea'); t.id = 'dDNote'; t.rows = 2; t.maxLength = 200; t.placeholder = placeholder;
      var w = el('div'); w.style.width = '100%'; w.appendChild(t); btns.appendChild(w);
      btn('취소', '', function () { showDetail(i); });
      btn(label, cls, function () { var v = t.value.trim(); if (required && v.length < 2) { setMsg('dDMsg', '내용을 2자 이상 적어 주세요.'); return; } fn(v); });
    }
    function linkBox() {
      btns.textContent = ''; var t = el('input'); t.type = 'text'; t.id = 'dDLink'; t.maxLength = 300; t.placeholder = 'https://docs.google.com/document/d/…'; t.value = i.link || '';
      var w = el('div'); w.style.width = '100%'; w.appendChild(t); btns.appendChild(w);
      btn('취소', '', function () { showDetail(i); });
      btn('링크 저장', 'ok', function () { act('linkDoc', { id: i.id, link: t.value.trim() }, '링크를 저장했습니다.'); });
    }

    var canEditAsAuthor = mine && i.kind !== '접수' && (i.status === '작성중' || i.status === '반려');
    var canEditRecv = i.kind === '접수' && (mine || isGm());
    if (canEditAsAuthor) {
      btn('수정', '', function () { openForm(i.kind, i); });
      btn(i.status === '반려' ? '다시 제출' : '제출', 'pri', function () { act('submitDoc', { id: i.id }, isMgr() ? '확정했습니다.' : '제출했습니다. 검토를 기다립니다.'); }).style.marginTop = '0';
    }
    if (canEditRecv) btn('수정', '', function () { openForm('접수', i); });
    if (i.status === '검토대기' && isGm() && !mine) {
      btn('검토 완료', 'ok', function () { act('reviewDoc', { id: i.id, decision: 'ok' }, '검토했습니다. 현장소장의 승인을 기다립니다.'); });
      btn('반려', 'warn', function () { noteBox('반려 확정', '반려 사유 (예: 금액 근거 보완 필요)', true, 'warn', function (v) { act('reviewDoc', { id: i.id, decision: 'no', reason: v }, '반려했습니다.'); }); });
    }
    if (i.status === '승인대기' && isMgr()) {
      btn('승인(확정)', 'ok', function () { act('approveDoc', { id: i.id, decision: 'ok' }, '확정했습니다.'); });
      btn('반려', 'warn', function () { noteBox('반려 확정', '반려 사유 (예: 수신처 변경 필요)', true, 'warn', function (v) { act('approveDoc', { id: i.id, decision: 'no', reason: v }, '반려했습니다.'); }); });
    }
    if ((i.kind === '접수' && i.status === '접수') || (i.kind === '공문' && i.status === '확정')) {
      btn(i.replied ? '회신 완료 취소' : '회신 완료로 표시', i.replied ? '' : 'ok', function () { act('replyDoc', { id: i.id, replied: !i.replied }, i.replied ? '회신 완료를 취소했습니다.' : '회신 완료로 표시했습니다.'); });
    }
    if (i.kind !== '접수' && i.status === '확정') {
      var hqs = i.hq ? i.hq.state : '';
      if (!hqs && isGm()) btn('본사 제출 표시', 'ok', function () { noteBox('제출 표시', '제출 방법 (예: 메일 발송 — 비워 둬도 됩니다)', false, 'ok', function (v) { act('hqDoc', { id: i.id, step: '제출', note: v }, '본사 제출을 표시했습니다.'); }); });
      if (hqs === '제출' && isMgr()) btn('본사 확인 표시', 'ok', function () { noteBox('확인 표시', '확인 방법·담당자 (예: 전화 확인 — 비워 둬도 됩니다)', false, 'ok', function (v) { act('hqDoc', { id: i.id, step: '확인', note: v }, '본사 확인을 표시했습니다.'); }); });
      if (hqs && isMgr()) btn('본사 표시 취소', 'warn', function () { noteBox('취소 확정', '취소 사유 (필수, 기록으로 남습니다)', true, 'warn', function (v) { act('hqDoc', { id: i.id, step: '취소', note: v }, '본사 표시를 취소했습니다.'); }); });
    }
    if (i.status !== '결번' && (mine || isGm())) btn('링크 바꾸기', '', linkBox);
    if ((i.status === '작성중' || i.status === '반려' || i.status === '접수') && (mine || isMgr())) {
      btn('결번 처리', 'warn', function () { noteBox('결번 확정', '결번 사유 (번호는 지우지 않고 기록으로 남깁니다)', true, 'warn', function (v) { act('voidDoc', { id: i.id, reason: v }, '결번으로 처리했습니다.'); }); });
    }
    if (i.status === '검토대기' && mine) p.appendChild(el('div', 'desc', '공무(또는 현장소장)의 검토를 기다리는 중입니다. 제출한 문서는 고칠 수 없습니다.'));
    if (i.status === '승인대기' && !isMgr()) p.appendChild(el('div', 'desc', '현장소장의 승인을 기다리는 중입니다.'));
    if (!btns.childNodes.length) btns.parentNode.removeChild(btns);
  }

  // ── 양식 ──
  var LABELS = { 품의: { party: '수신 (비우면 회장)', summary: '본문 요지 (문서 본문에 들어갑니다)', attach: '첨부', draft: '임시저장', ph: '예: 회장' },
    공문: { party: '수신처 (필수)', summary: '본문 요지 (문서 본문에 들어갑니다)', attach: '붙임', draft: '임시저장', ph: '예: 국가철도공단 광주건설사업단' },
    접수: { party: '보낸 곳 (필수)', summary: '내용 요지', attach: '첨부', draft: '접수 등록', ph: '예: 국가철도공단' } };
  function openForm(kind, item) {
    F = { kind: kind, id: item ? item.id : '' };
    var L = LABELS[kind];
    $('dFTitle').textContent = (item ? kind + ' 수정 · ' + item.docNo : kind + (kind === '접수' ? ' 등록' : ' 쓰기') + (next[kind] ? ' · ' + next[kind] : ''));
    $('dPartyL').textContent = L.party; $('dParty').placeholder = L.ph; $('dSummaryL').textContent = L.summary; $('dAttachL').textContent = L.attach;
    $('dDate').value = item ? item.date : todayStr();
    $('dParty').value = item ? item.party : ''; $('dTitle').value = item ? item.title : '';
    $('dRef').value = item ? item.ref : ''; $('dSummary').value = item ? item.summary : ''; $('dAttach').value = item ? item.attach : '';
    $('dDue').value = item ? item.due : ''; $('dNote').value = item ? item.note : '';
    show('dRefWrap', kind !== '접수'); show('dDueWrap', kind !== '품의'); show('dSubmit', kind !== '접수');
    $('dDraft').textContent = item && kind !== '접수' ? '저장' : L.draft;
    setMsg('dFMsg', ''); pane('form'); setTimeout(function () { $('dTitle').focus(); }, 30);
  }
  $('dNewP').onclick = function () { openForm('품의'); };
  $('dNewG').onclick = function () { openForm('공문'); };
  $('dNewR').onclick = function () { openForm('접수'); };
  $('dCancel').onclick = function () { pane('list'); };

  function collect() {
    return { id: F.id || undefined, kind: F.kind, date: $('dDate').value, party: $('dParty').value.trim(), title: $('dTitle').value.trim(), ref: $('dRef').value.trim(),
      summary: $('dSummary').value, attach: $('dAttach').value.trim(), due: $('dDue').value, note: $('dNote').value.trim() };
  }
  function check(v) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) return '일자를 고르세요.';
    if (v.title.length < 2) return '제목(건명)을 2자 이상 적어 주세요.';
    if (F.kind !== '품의' && !v.party) return F.kind === '접수' ? '보낸 곳을 적어 주세요.' : '수신처를 적어 주세요.';
    if (F.kind !== '품의' && v.due && v.due < v.date) return '회신기한이 일자보다 앞설 수 없습니다.';
    return '';
  }
  function save(thenSubmit) {
    if (busy || !F) return;
    var v = collect(); var bad = check(v);
    if (bad) { setMsg('dFMsg', bad); return; }
    busy = true; ['dDraft', 'dSubmit', 'dCancel'].forEach(function (b) { $(b).disabled = true; }); setMsg('dFMsg', '저장하는 중… (서식 복사에 몇 초 걸립니다)', true);
    function done() { busy = false; ['dDraft', 'dSubmit', 'dCancel'].forEach(function (b) { $(b).disabled = false; }); }
    E.api('saveDoc', v, 60000).then(function (r) {
      if (E.authLost(r)) { done(); return; }
      if (!r.ok) { done(); setMsg('dFMsg', r.message || '저장하지 못했습니다.'); return; }
      var warn = (r.warn || []).join(' ');
      if (!thenSubmit) { done(); showDetail(r.item, '저장했습니다. 번호 ' + r.item.docNo + (warn ? '\n※ ' + warn : '')); return; }
      E.api('submitDoc', { id: r.item.id }, 40000).then(function (s) {
        done();
        if (E.authLost(s)) return;
        if (!s.ok) { showDetail(r.item, '저장은 했지만 제출하지 못했습니다: ' + (s.message || '') + (warn ? '\n※ ' + warn : '')); return; }
        showDetail(s.item, (isMgr() ? '확정했습니다.' : '제출했습니다.') + ' 번호 ' + s.item.docNo + (warn ? '\n※ ' + warn : ''));
      });
    });
  }
  $('dDraft').onclick = function () { save(false); };
  $('dSubmit').onclick = function () { save(true); };
})();
