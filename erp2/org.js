/* HN28 현장 ERP v2 — 조직표·구성원 설정: 직책과 담당업무를 현장소장이 직접 입력해 두면 화면 전체에 그대로 쓰인다.
 * (권한 = 앱에서 누를 수 있는 범위, 직책·담당업무 = 누가 무슨 일을 맡았는지.) 현장소장이 처음 들어오면 한 번 입력하도록 이 화면이 먼저 뜬다.
 * 서버가 보낸 글자는 모두 textContent 로만 넣는다. */
(function () {
  'use strict';
  var E = window.ERP2; if (!E) return;
  var $ = E.$, el = E.el;
  var QUICK = ['품질', '안전', '공사', '공무', '측량', '행정'];
  var DUTY_MAX = 5, DUTY_LEN = 12, TITLE_LEN = 20;
  var R = null;          // 마지막으로 받은 조직 {members, orgSetup, canEdit}
  var rows = [];         // 고치는 칸 [{id, t, d, hint, quick:{}}]
  var setupMode = false; // 처음 입력(모든 사람의 직책·담당업무 필수)
  var asked = false;     // 이번 로그인에서 이미 처음 입력 화면을 띄웠는지
  var busy = false;
  var seq = 0;

  function setMsg(text, info) { var m = $('orgMsg'); m.className = 'msg' + (info ? ' info' : ''); m.textContent = text || ''; }
  function show(id, on) { $(id).classList.toggle('hide', !on); }
  function isMgr() { var me = E.me(); return !!me && me.role === '현장소장'; }
  function goHome() { E.showView('vHome'); E.onEnter.forEach(function (f) { try { f(); } catch (e) {} }); }

  /** 서버와 같은 규칙으로 담당업무 글자를 나눈다. */
  function splitDuty(v) {
    var out = [];
    String(v || '').split(/[,，、·\/;\n]+/).forEach(function (t) { t = t.replace(/\s+/g, ' ').trim(); if (t && out.indexOf(t) < 0) out.push(t); });
    return out;
  }

  function dutyChips(duties) {
    var box = el('div', 'od');
    duties.forEach(function (d, i) { box.appendChild(el('span', 'dc' + (i === 0 ? ' main' : ''), (i === 0 ? '주 ' : '') + d)); });
    return box;
  }

  // ── 읽기 전용 카드 ──
  function viewCard(m) {
    var c = el('div', 'og' + (m.role === '현장소장' ? ' mgr' : ''));
    c.appendChild(el('div', 'on', m.name));
    c.appendChild(el('div', 'ot', m.title || '직책 미입력'));
    if (m.duties && m.duties.length) c.appendChild(dutyChips(m.duties));
    c.appendChild(el('div', 'or', '권한: ' + m.role));
    return c;
  }

  // ── 고치는 카드 ──
  function editCard(m, n) {
    var c = el('div', 'og' + (m.role === '현장소장' ? ' mgr' : ''));
    c.appendChild(el('div', 'on', m.name));
    var lt = el('label', '', '직책'); lt.setAttribute('for', 'ogT' + n);
    var t = el('input'); t.type = 'text'; t.id = 'ogT' + n; t.maxLength = TITLE_LEN; t.autocomplete = 'off'; t.placeholder = '예: 품질관리자'; t.value = m.title || '';
    var ld = el('label', '', '담당업무 (맨 앞이 주담당)'); ld.setAttribute('for', 'ogD' + n);
    var d = el('input'); d.type = 'text'; d.id = 'ogD' + n; d.maxLength = 60; d.autocomplete = 'off'; d.placeholder = '예: 품질, 공사'; d.value = (m.duties || []).join(', ');
    var qk = el('div', 'qk'), quick = {};
    QUICK.forEach(function (q) {
      var b = el('button', '', q); b.type = 'button'; quick[q] = b;
      b.onclick = function () {
        var cur = splitDuty(d.value), i = cur.indexOf(q);
        if (i >= 0) cur.splice(i, 1); else cur.push(q);
        d.value = cur.join(', '); sync();
      };
      qk.appendChild(b);
    });
    var hint = el('div', 'oh');
    function sync() {
      var cur = splitDuty(d.value);
      QUICK.forEach(function (q) { quick[q].classList.toggle('sel', cur.indexOf(q) >= 0); quick[q].setAttribute('aria-pressed', cur.indexOf(q) >= 0 ? 'true' : 'false'); });
      hint.textContent = cur.length ? '주담당: ' + cur[0] + (cur.length > 1 ? ' · 겸임: ' + cur.slice(1).join('·') : '') : '';
    }
    d.oninput = sync; sync();
    [lt, t, ld, d, qk, hint].forEach(function (x) { c.appendChild(x); });
    c.appendChild(el('div', 'or', '권한: ' + m.role));
    rows.push({ id: m.loginId, name: m.name, t: t, d: d });
    return c;
  }

  function render() {
    var body = $('orgBody'); body.textContent = ''; rows = [];
    if (!R) return;
    var edit = !!R.canEdit, n = 0;
    var mk = function (m) { return edit ? editCard(m, n++) : viewCard(m); };
    var top = R.members.filter(function (m) { return m.role === '현장소장'; });
    var rest = R.members.filter(function (m) { return m.role !== '현장소장'; });
    if (top.length) {
      var tr = el('div', 'og-top'); top.forEach(function (m) { tr.appendChild(mk(m)); }); body.appendChild(tr);
      if (rest.length) body.appendChild(el('div', 'og-line'));
    }
    if (rest.length) { var g = el('div', 'og-grid'); rest.forEach(function (m) { g.appendChild(mk(m)); }); body.appendChild(g); }
    $('orgTitle').textContent = setupMode ? '조직표 처음 설정' : '조직표';
    $('orgIntro').textContent = setupMode
      ? '처음 한 번만 입력해 주세요. 직책과 담당업무(맨 앞이 주담당)를 적어 두면 상단 이름, 업무 지시, 직원 목록 등 모든 화면에 계속 적용됩니다. 나중에 이 조직표에서 언제든 고칠 수 있습니다.'
      : edit ? '직책과 담당업무를 고치면 모든 화면에 바로 적용됩니다. 담당업무는 쉼표로 구분하고 맨 앞이 주담당입니다.'
        : '현장 조직표입니다. 고칠 내용이 있으면 현장소장에게 요청하세요.';
    show('orgActs', edit); show('orgLater', edit && setupMode); show('orgAdminLink', edit);
    $('orgSave').textContent = setupMode ? '저장하고 시작' : '저장';
  }

  function open(setup, doneMsg) {
    setupMode = !!setup && isMgr() && !E.orgSetup();
    E.showView('vOrg'); window.scrollTo(0, 0);
    setMsg('불러오는 중…', true); $('orgBody').textContent = ''; show('orgActs', false); show('orgAdminLink', false);
    var my = ++seq;
    E.api('getOrg', {}, 15000).then(function (r) {
      if (my !== seq || E.authLost(r)) return;
      if (!r || !r.ok) { setMsg((r && r.message) || '조직표를 불러오지 못했습니다.'); return; }
      R = r; setMsg(doneMsg || '', !!doneMsg);
      if (!setupMode && isMgr() && !r.orgSetup) setupMode = true;
      render();
    });
  }

  /** 입력 점검: 문제가 있으면 안내 글, 없으면 '' 와 보낼 목록. */
  function collect() {
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], title = r.t.value.replace(/\s+/g, ' ').trim(), duties = splitDuty(r.d.value);
      if (title.length > TITLE_LEN) return { err: r.name + ' 님의 직책은 ' + TITLE_LEN + '자 이내로 입력해 주세요.' };
      if (duties.length > DUTY_MAX) return { err: r.name + ' 님의 담당업무는 ' + DUTY_MAX + '가지까지 입력할 수 있습니다.' };
      for (var j = 0; j < duties.length; j++) if (duties[j].length > DUTY_LEN) return { err: r.name + ' 님의 담당업무 한 항목은 ' + DUTY_LEN + '자 이내로 입력해 주세요. (' + duties[j] + ')' };
      if (setupMode && (!title || !duties.length)) return { err: r.name + ' 님의 직책과 담당업무를 입력해 주세요. (없으면 가장 가까운 말로 적어 주세요)' };
      out.push({ loginId: r.id, title: title, duty: duties.join(',') });
    }
    return { members: out };
  }

  $('orgSave').onclick = function () {
    if (busy) return;
    var c = collect(); if (c.err) { setMsg(c.err); return; }
    busy = true; $('orgSave').disabled = true; setMsg('저장 중…', true);
    var wasSetup = setupMode;
    E.api('saveOrg', { members: c.members }, 20000).then(function (r) {
      busy = false; $('orgSave').disabled = false;
      if (E.authLost(r)) return;
      if (!r || !r.ok) { setMsg((r && r.message) || '저장하지 못했습니다.'); return; }
      E.orgSetup(true); setupMode = false;
      var mine = c.members.filter(function (m) { return m.loginId === E.me().loginId; })[0];
      if (mine) E.setMe({ name: E.me().name, title: mine.title, duty: mine.duty.split(',').join(', '), duties: splitDuty(mine.duty) });
      if (wasSetup) { goHome(); return; }
      open(false, '저장했습니다. 모든 화면에 바로 적용됩니다.');
    });
  };

  $('orgLater').onclick = function () { asked = true; goHome(); };
  $('orgBack').onclick = function () { asked = true; goHome(); };
  $('btnOrg').onclick = function () { open(true); };
  $('orgToAdmin').onclick = function () { asked = true; $('btnAdmin').click(); };

  // 현장소장이 로그인한 직후, 조직표를 아직 입력하지 않았다면 먼저 입력 화면을 띄운다(로그인 한 번에 한 번만).
  E.onEnter.push(function () {
    if (asked || !isMgr() || E.orgSetup()) return;
    asked = true; open(true);
  });
  E.onLeave.push(function () { seq++; asked = false; R = null; rows = []; setupMode = false; busy = false; $('orgBody').textContent = ''; setMsg(''); $('orgSave').disabled = false; });
})();
