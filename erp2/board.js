/* HN28 현장 ERP v2 — 홈 「현장 게시판」(v2.24): 이번 주·다음 주 주간계획 + 전체 공개 업무.
 * 서버 dashboard 응답의 board 값을 그대로 보여 준다(서버가 v2.23 이하면 패널을 숨긴다).
 * 주간계획 추가·삭제는 현장소장·공무만. 서버가 보낸 글자는 모두 textContent 로만 넣는다. */
(function () {
  'use strict';
  var E = window.ERP2; if (!E) return;
  var $ = E.$, el = E.el;
  var DOW = ['일', '월', '화', '수', '목', '금', '토'];
  var B = null, today = '', busy = false;

  function setMsg(text, info) { var m = $('bdMsg'); m.className = 'msg' + (info ? ' info' : ''); m.textContent = text || ''; }
  function dt(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function md(s) { var d = dt(s); return (d.getMonth() + 1) + '.' + d.getDate() + '(' + DOW[d.getDay()] + ')'; }
  function add(s, n) { var d = dt(s); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function meName() { var m = E.me(); return m ? m.name : ''; }
  function isMgr() { var m = E.me(); return !!m && m.role === '현장소장'; }

  function weekRow(w) {
    var r = el('div', 'bdw' + (w.start <= today && w.end >= today ? ' today' : ''));
    r.appendChild(el('div', 'dt', md(w.start) + (w.end !== w.start ? '~' : '')));
    var tx = el('div', 'tx');
    tx.appendChild(document.createTextNode((w.site ? '#' + w.site + ' ' : '') + w.text));
    if (w.pub) tx.appendChild(el('span', 'bdpub', '현황판'));
    tx.appendChild(el('small', '', w.kind + (w.end !== w.start ? ' · ~' + md(w.end) : '') + (w.by ? ' · ' + w.by : '')));
    r.appendChild(tx);
    if (B.canEdit && w.id && (isMgr() || w.by === meName())) {
      var del = el('button', 'sm', '지우기'); del.type = 'button';
      del.onclick = function () {
        if (del.getAttribute('data-ask') !== '1') { del.setAttribute('data-ask', '1'); del.textContent = '한 번 더'; setTimeout(function () { del.removeAttribute('data-ask'); del.textContent = '지우기'; }, 4000); return; }
        send('delWeek', { id: w.id }, del, '지웠습니다.');
      };
      r.appendChild(del);
    }
    return r;
  }

  function taskRow(t) {
    var r = el('div', 'bdw');
    var due = t.status === '완료' ? '완료' : t.due ? md(t.due) : '기한 없음';
    r.appendChild(el('div', 'dt', due));
    var tx = el('div', 'tx');
    tx.appendChild(document.createTextNode((t.urgent && t.status !== '완료' ? '[긴급] ' : '') + t.title));
    if (t.board) tx.appendChild(el('span', 'bdpub', '현황판'));
    var late = t.status !== '완료' && t.daysLeft !== null && t.daysLeft !== undefined && t.daysLeft < 0;
    tx.appendChild(el('small', '', '담당 ' + t.to + ' · 지시 ' + t.by + (late ? ' · ' + (-t.daysLeft) + '일 지남' : '') + (t.status === '완료' ? ' · ' + String(t.doneAt).slice(5, 10).replace('-', '.') + ' 완료' : '')));
    r.appendChild(tx);
    if (late) r.classList.add('today');
    r.style.cursor = 'pointer';
    r.onclick = function () { var tile = $('tileTask'); if (tile) tile.click(); };
    return r;
  }

  function render(r) {
    var p = $('dbBoard');
    if (!r || !r.board) { p.classList.add('hide'); B = null; return; }
    B = r.board; today = r.today;
    var mon = B.monday, sun = add(mon, 6);
    $('bdWeekLbl').textContent = md(mon) + ' ~ ' + md(sun);
    var wb = $('bdWeek'); wb.textContent = '';
    var thisW = B.week.filter(function (w) { return w.start <= sun; }), nextW = B.week.filter(function (w) { return w.start > sun; });
    if (!thisW.length) wb.appendChild(el('div', 'desc', '이번 주에 적힌 계획이 없습니다.' + (B.canEdit ? ' 아래 「주간계획 적기」로 추가하세요.' : '')));
    thisW.forEach(function (w) { wb.appendChild(weekRow(w)); });
    if (nextW.length) { wb.appendChild(el('div', 'bd-h', '다음 주')); nextW.forEach(function (w) { wb.appendChild(weekRow(w)); }); }
    var tb = $('bdTasks'); tb.textContent = '';
    if (!B.tasks.length) tb.appendChild(el('div', 'desc', '공개된 업무가 없습니다. 업무 지시에서 「전체 공개」를 고르면 여기에 나옵니다.'));
    B.tasks.forEach(function (t) { tb.appendChild(taskRow(t)); });
    $('bdAddBox').classList.toggle('hide', !B.canEdit);
    var ks = $('bdKind');
    if (!ks.options.length) (B.kinds || []).forEach(function (k) { var o = el('option', '', k); o.value = k; ks.appendChild(o); });
    p.classList.remove('hide');
  }

  function send(action, data, btn, okText) {
    if (busy) return;
    busy = true; if (btn) btn.disabled = true; setMsg('처리하는 중…', true);
    E.api(action, data, 30000).then(function (r) {
      busy = false; if (btn) btn.disabled = false;
      if (E.authLost(r)) return;
      if (!r || !r.ok) { setMsg((r && r.message) || '처리하지 못했습니다.'); return; }
      setMsg(okText, true);
      if (action === 'saveWeek') closeForm();
      if (E.dash) E.dash.load(true);
    });
  }

  function closeForm() { $('bdForm').classList.add('hide'); $('bdAddOpen').classList.remove('hide'); }
  $('bdAddOpen').onclick = function () {
    $('bdStart').value = today; $('bdEnd').value = ''; $('bdText').value = ''; $('bdSite').value = ''; $('bdPub').checked = false;
    var ws = $('workSite'); if (ws && ws.value && ws.value !== '0') $('bdSite').value = ws.value;
    $('bdForm').classList.remove('hide'); $('bdAddOpen').classList.add('hide'); setMsg(''); $('bdText').focus();
  };
  $('bdCancel').onclick = closeForm;
  $('bdSave').onclick = function () {
    var a = $('bdStart').value, b = $('bdEnd').value, t = $('bdText').value.trim();
    if (!a) { setMsg('날짜를 골라 주세요.'); return; }
    if (b && b < a) { setMsg('끝 날짜는 시작 날짜와 같거나 뒤여야 합니다.'); return; }
    if (t.length < 2) { setMsg('내용을 2자 이상 적어 주세요.'); return; }
    send('saveWeek', { start: a, end: b, kind: $('bdKind').value, site: $('bdSite').value.trim(), text: t, pub: $('bdPub').checked }, $('bdSave'), '주간계획을 적었습니다.' + ($('bdPub').checked ? ' 현황판에는 1분 안에 나옵니다.' : ''));
  };

  E.onDash = E.onDash || [];
  E.onDash.push(render);
  E.onLeave.push(function () { B = null; busy = false; $('dbBoard').classList.add('hide'); $('bdWeek').textContent = ''; $('bdTasks').textContent = ''; closeForm(); setMsg(''); });
})();
