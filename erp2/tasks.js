/* HN28 현장 ERP v2 — 업무 지시: 현장소장·공무가 팀원에게 할 일을 내리고, 담당자는 완료 처리한다.
 * 담당자의 대시보드 「오늘 처리할 일」에 서버가 자동으로 올려 준다. 서버가 보낸 글자는 모두 textContent 로만 넣는다. */
(function () {
  'use strict';
  var E = window.ERP2; if (!E) return;
  var $ = E.$, el = E.el;
  var R = null;            // 마지막으로 받은 목록 {items, staff, canAssign, today}
  var filter = 'mine';     // mine | out | all | done
  var editId = '';         // 고치는 업무 번호('' 이면 새 지시)
  var busy = false;
  var seq = 0;

  function setMsg(id, text, info) { var m = $(id); m.className = 'msg' + (info ? ' info' : ''); m.textContent = text || ''; }
  function show(id, on) { $(id).classList.toggle('hide', !on); }
  function pane(name) { show('tList', name === 'list'); show('tForm', name === 'form'); window.scrollTo(0, 0); }
  function mmdd(d) { return d ? String(d).slice(5) : ''; }
  function meId() { var me = E.me(); return me ? me.loginId : ''; }
  function canManage(t) { var me = E.me(); return !!me && (me.role === '현장소장' || t.byId === me.loginId); }

  // ── 홈 타일 ──
  function refreshBadge() {
    var sub = $('tileTaskSub'); if (!sub) return;
    sub.textContent = '지시 · 기한 · 완료 확인';
    E.api('listTasks', {}, 15000).then(function (r) {
      if (!r || !r.ok) return;
      var n = r.items.filter(function (t) { return t.status === '진행' && t.toId === meId(); }).length; if (!n) return;
      sub.textContent = ''; sub.appendChild(document.createTextNode('내 업무 ')); sub.appendChild(el('span', 'badge', n + '건'));
    });
  }
  E.onEnter.push(refreshBadge);
  E.onLeave.push(function () { R = null; filter = 'mine'; editId = ''; busy = false; seq++; $('tItems').textContent = ''; $('tSum').textContent = ''; setMsg('tMsg', ''); setMsg('tFMsg', ''); });

  // ── 목록 ──
  function openList() { E.showView('vTask'); pane('list'); load(); }
  $('tileTask').onclick = openList;
  $('tBack').onclick = function () { E.showView('vHome'); refreshBadge(); };

  function load() {
    var my = ++seq;
    setMsg('tMsg', '불러오는 중…', true);
    E.api('listTasks', {}, 25000).then(function (r) {
      if (my !== seq) return;
      if (E.authLost(r)) return;
      if (!r.ok) { R = null; render(); setMsg('tMsg', r.message || '목록을 불러오지 못했습니다.'); return; }
      R = r; setMsg('tMsg', ''); render();
    });
  }

  function buildFilters() {
    var box = $('tFilters'); box.textContent = '';
    var list = [['mine', '내가 할 일']];
    if (R && R.canAssign) list.push(['out', '내가 지시한 것'], ['all', '진행 중 전체']);
    list.push(['done', '완료']);
    list.forEach(function (f) {
      var b = el('button', filter === f[0] ? 'sel' : '', f[1]); b.type = 'button';
      b.onclick = function () { filter = f[0]; render(); };
      box.appendChild(b);
    });
  }

  function dueText(t) {
    if (t.status === '완료') return '완료 ' + mmdd(t.doneAt);
    var d = t.daysLeft;
    if (d === null || d === undefined) return t.urgent ? '긴급' : '기한 없음';
    if (d < 0) return (-d) + '일 지남';
    if (d === 0) return '오늘까지';
    if (d === 1) return '내일까지';
    return 'D-' + d + ' (' + mmdd(t.due) + ')';
  }
  function tone(t) {
    if (t.status === '완료') return 'done';
    if (t.daysLeft !== null && t.daysLeft !== undefined && t.daysLeft < 0) return 'late';
    if (t.urgent || (t.daysLeft !== null && t.daysLeft !== undefined && t.daysLeft <= 1)) return 'soon';
    return '';
  }

  function filtered() {
    var items = R ? R.items : [], me = meId();
    if (filter === 'done') return items.filter(function (t) { return t.status === '완료'; });
    var open = items.filter(function (t) { return t.status === '진행'; });
    if (filter === 'mine') return open.filter(function (t) { return t.toId === me; });
    if (filter === 'out') return open.filter(function (t) { return t.byId === me; });
    return open;
  }

  function render() {
    buildFilters();
    var list = filtered(), box = $('tItems'), sum = $('tSum'); box.textContent = ''; sum.textContent = '';
    $('tNew').classList.toggle('hide', !(R && R.canAssign));
    if (!R) return;
    var late = list.filter(function (t) { return tone(t) === 'late'; }).length;
    sum.textContent = (filter === 'done' ? '완료 ' : '진행 중 ') + list.length + '건' + (late ? ' · 기한 지남 ' + late + '건' : '');
    if (!list.length) {
      box.appendChild(el('div', 'desc', filter === 'done' ? '완료된 업무가 없습니다.' : filter === 'mine' ? '지금 맡은 업무가 없습니다.' : '진행 중인 업무가 없습니다.'));
      return;
    }
    list.forEach(function (t) { box.appendChild(card(t)); });
  }

  function card(t) {
    var c = el('div', 'tk ' + tone(t)); c.setAttribute('data-id', t.id);
    var t1 = el('div', 't1'), tt = el('div', 'tt');
    if (t.urgent) tt.appendChild(el('span', 'urg', '긴급'));
    tt.appendChild(document.createTextNode(t.title)); t1.appendChild(tt); t1.appendChild(el('span', 'dd', dueText(t))); c.appendChild(t1);
    c.appendChild(el('div', 'mt', '담당 ' + t.to + ' · 지시 ' + t.by + ' ' + mmdd(t.created).slice(0, 5) + (t.due ? ' · 기한 ' + mmdd(t.due) : '')));
    if (t.memo) c.appendChild(el('div', 'bd', t.memo));
    if (t.status === '완료') c.appendChild(el('div', 'mt', '완료: ' + t.doneBy + ' ' + String(t.doneAt).slice(5, 16) + (t.doneMemo ? ' — ' + t.doneMemo : '')));
    var act = el('div', 'tkact hide'), bar = el('div', 'tkb');
    function btn(label, cls, fn) { var b = el('button', cls || '', label); b.type = 'button'; b.onclick = fn; bar.appendChild(b); return b; }
    function ask(placeholder, okLabel, run) {
      act.textContent = ''; act.classList.remove('hide');
      var inp = el('input'); inp.type = 'text'; inp.maxLength = 200; inp.placeholder = placeholder; act.appendChild(inp);
      var ok = el('button', 'ok', okLabel); ok.type = 'button'; ok.onclick = function () { run(inp.value.trim(), ok); }; act.appendChild(ok);
      var no = el('button', '', '닫기'); no.type = 'button'; no.onclick = function () { act.classList.add('hide'); act.textContent = ''; }; act.appendChild(no);
      inp.focus();
    }
    var me = meId();
    if (t.status === '진행') {
      if (t.toId === me || canManage(t)) btn('완료', 'ok', function () { ask('완료 메모 (선택)', '완료 처리', function (v, ok) { send('doneTask', { id: t.id, memo: v }, ok); }); });
      if (canManage(t)) {
        btn('수정', '', function () { openForm(t); });
        btn('취소', 'warn', function () { ask('취소 사유 (2자 이상)', '취소하기', function (v, ok) { if (v.length < 2) { setMsg('tMsg', '취소 사유를 2자 이상 적어 주세요.'); return; } send('cancelTask', { id: t.id, reason: v }, ok); }); });
      }
    } else if (canManage(t)) {
      btn('다시 진행', '', function () { send('reopenTask', { id: t.id }, null); });
    }
    if (bar.childNodes.length) c.appendChild(bar);
    c.appendChild(act);
    return c;
  }

  function send(action, data, okBtn) {
    if (busy) return;
    busy = true; if (okBtn) okBtn.disabled = true; setMsg('tMsg', '처리하는 중…', true);
    E.api(action, data, 30000).then(function (r) {
      busy = false; if (okBtn) okBtn.disabled = false;
      if (E.authLost(r)) return;
      if (!r.ok) { setMsg('tMsg', r.message || '처리하지 못했습니다.'); return; }
      setMsg('tMsg', action === 'doneTask' ? '완료 처리했습니다.' : action === 'cancelTask' ? '업무를 취소했습니다.' : '다시 진행으로 돌렸습니다.', true);
      var my = ++seq;
      E.api('listTasks', {}, 25000).then(function (l) { if (my !== seq || E.authLost(l)) return; if (l.ok) { R = l; render(); } });
    });
  }

  // ── 지시 양식 ──
  function openForm(t) {
    if (!R || !R.canAssign) return;
    editId = t ? t.id : '';
    $('tFTitle').textContent = t ? '업무 수정' : '업무 지시하기';
    $('tTitle').value = t ? t.title : ''; $('tMemo').value = t ? t.memo : '';
    var sel = $('tTo'); sel.textContent = '';
    var ph = el('option', '', '담당자를 선택하세요'); ph.value = ''; sel.appendChild(ph);
    R.staff.forEach(function (s) { var o = el('option', '', s.name + ' (' + s.role + ')'); o.value = s.id; if (t && t.toId === s.id) o.selected = true; sel.appendChild(o); });
    $('tDue').value = t ? t.due : ''; $('tDue').min = R.today; $('tUrgent').checked = !!(t && t.urgent);
    setMsg('tFMsg', ''); pane('form'); $('tTitle').focus();
  }
  $('tNew').onclick = function () { openForm(null); };
  $('tCancel').onclick = function () { pane('list'); };
  $('tSave').onclick = function () {
    if (busy) return;
    var title = $('tTitle').value.trim(), to = $('tTo').value, due = $('tDue').value;
    if (title.length < 2) { setMsg('tFMsg', '업무 제목을 2자 이상 입력해 주세요.'); return; }
    if (!to) { setMsg('tFMsg', '담당자를 선택해 주세요.'); return; }
    var orig = editId && R ? R.items.filter(function (x) { return x.id === editId; })[0] : null;
    if (due && due < R.today && (!orig || orig.due !== due)) { setMsg('tFMsg', '기한은 오늘 이후 날짜로 정해 주세요.'); return; }
    busy = true; $('tSave').disabled = true; setMsg('tFMsg', '저장하는 중…', true);
    E.api('saveTask', { id: editId || undefined, title: title, memo: $('tMemo').value, toId: to, due: due, urgent: $('tUrgent').checked }, 30000).then(function (r) {
      busy = false; $('tSave').disabled = false;
      if (E.authLost(r)) return;
      if (!r.ok) { setMsg('tFMsg', r.message || '저장하지 못했습니다.'); return; }
      var wasEdit = !!editId; editId = '';
      filter = wasEdit ? filter : 'out'; pane('list'); setMsg('tMsg', (wasEdit ? '수정했습니다.' : r.item.to + ' 님에게 업무를 지시했습니다.'), true);
      var my = ++seq;
      E.api('listTasks', {}, 25000).then(function (l) { if (my !== seq || E.authLost(l)) return; if (l.ok) { R = l; render(); } });
    });
  };
})();
