/* HN28 현장 ERP v2 — 3단계: 월 마감 점검·마감/해제·본사 제출 엑셀 화면
 * index.html 이 열어 둔 window.ERP2 와 export.js 의 HNExport 만 쓴다. 서버가 보낸 글자는 모두 textContent 로만 넣는다. */
(function () {
  'use strict';
  var E = window.ERP2, X = window.HNExport; if (!E || !X) return;
  var $ = E.$, el = E.el;
  var M = null;          // 서버 마스터
  var month = '';        // 보고 있는 달
  var closedList = [];   // 마감된 달
  var data = null;       // 이 달 점검 결과(HNExport.buildClose)
  var busy = false, seq = 0, note = '';

  function setMsg(text, info) { var m = $('cMsg'); m.className = 'msg' + (info ? ' info' : ''); m.textContent = text || ''; }
  function show(id, on) { $(id).classList.toggle('hide', !on); }
  function role() { var me = E.me(); return me ? me.role : ''; }
  function isMgr() { return role() === '현장소장'; }

  function withMaster(cb) {
    if (M) { cb(); return; }
    setMsg('불러오는 중…', true);
    E.api('getMaster', {}, 20000).then(function (r) {
      if (E.authLost(r)) return;
      if (!r.ok) { setMsg(r.message || '기본 정보를 불러오지 못했습니다.'); return; }
      M = r; setMsg(''); cb();
    });
  }

  function open() {
    E.showView('vClose');
    M = null; // 열 때마다 마감 목록을 새로 받는다
    withMaster(function () { if (!month) month = M.today.slice(0, 7); $('cMonth').value = month; closedList = M.closed || []; load(); });
  }
  $('tileClose').onclick = open;
  $('cBack').onclick = function () { E.showView('vHome'); E.onEnter.forEach(function (f) { try { f(); } catch (e) {} }); };
  E.onLeave.push(function () { M = null; data = null; note = ''; month = ''; closedList = []; $('cSummary').textContent = ''; $('cChecks').textContent = ''; setMsg(''); });

  function shift(d) { var y = +month.slice(0, 4), m = +month.slice(5, 7) + d; if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; } month = y + '-' + (m < 10 ? '0' : '') + m; $('cMonth').value = month; load(); }
  $('cPrev').onclick = function () { if (month) shift(-1); };
  $('cNext').onclick = function () { if (month) shift(1); };
  $('cThis').onclick = function () { if (!M) return; month = M.today.slice(0, 7); $('cMonth').value = month; load(); };
  $('cMonth').onchange = function () { if (/^\d{4}-\d{2}$/.test($('cMonth').value)) { month = $('cMonth').value; load(); } };

  function load() {
    var my = ++seq, ym = month;
    data = null; setMsg('불러오는 중…', true); ['cExport', 'cClose', 'cReopen'].forEach(function (b) { $(b).disabled = true; });
    Promise.all([E.api('listExpenses', { month: ym }, 25000), E.api('listExpenses', { upTo: ym }, 25000)]).then(function (rs) {
      if (my !== seq) return; // 그 사이에 다른 달로 넘어갔다
      if (E.authLost(rs[0]) || E.authLost(rs[1])) return;
      if (!rs[0].ok || !rs[1].ok) { setMsg((rs[0].ok ? rs[1] : rs[0]).message || '불러오지 못했습니다.'); render(); return; }
      closedList = rs[0].closed || closedList;
      data = X.buildClose({ ym: ym, master: M, monthItems: rs[0].items, cumItems: rs[1].items, closed: closedList.filter(function (c) { return c.ym === ym; })[0] || null, today: M.today, manager: M.manager || '' });
      setMsg(note, !!note); note = ''; render();
    });
  }

  function card(l, v, s, color) {
    var d = el('div'); d.appendChild(el('div', 'l', l)); var vv = el('div', 'v', v); if (color) vv.style.color = color; d.appendChild(vv); d.appendChild(el('div', 's', s)); return d;
  }

  function render() {
    var sum = $('cSummary'), box = $('cChecks'); sum.textContent = ''; box.textContent = '';
    show('cLock', false);
    ['cExport', 'cClose', 'cReopen'].forEach(function (b) { $(b).disabled = false; });
    show('cExport', role() === '현장소장' || role() === '공무'); show('cClose', false); show('cReopen', false);
    if (!data) { ['cExport', 'cClose', 'cReopen'].forEach(function (b) { $(b).disabled = true; }); return; }
    var d = data;
    var verdict = d.closed ? ['마감됨', '#475569'] : d.bad ? ['확인 필요 ' + (d.bad + d.warn) + '건', '#b91c1c'] : d.warn ? ['보완 권장 ' + d.warn + '건', '#b45309'] : ['마감 가능', '#15803d'];
    sum.appendChild(card('점검 결과', verdict[0], d.ym.replace('-', '년 ') + '월 · 문제 ' + d.bad + ' · 보완 ' + d.warn, verdict[1]));
    sum.appendChild(card('승인된 경비 (공급가)', X.won(d.totals.supply), d.items.length + '건 · 부가세 ' + X.won(d.totals.vat)));
    sum.appendChild(card('지불요청 합계', X.won(d.totals.total), '공급가 + 부가세'));
    sum.appendChild(card('승인 전 경비', d.pendingItems.length + '건', d.pendingItems.length ? '엑셀에 들어가지 않음' : '모두 승인됨'));
    d.checks.forEach(function (c) {
      var k = el('div', 'ck k-' + (c.level === 'mute' ? 'info' : c.level)); k.appendChild(el('div', 't', c.title)); if (c.detail) k.appendChild(el('div', 'd', c.detail)); box.appendChild(k);
    });
    if (d.closed) {
      var ll = $('cLock'); ll.textContent = d.ym + ' 마감됨 · ' + d.closed.by + ' · ' + d.closed.at + ' — 이 달 청구분의 검토·승인은 막혀 있습니다. 늦게 나온 영수증은 누락분으로 다음 달에 올립니다.'; show('cLock', true);
    }
    show('cClose', isMgr() && !d.closed); show('cReopen', isMgr() && !!d.closed);
    if (!isMgr()) { var n = el('div', 'desc', '마감과 마감 해제는 현장소장만 할 수 있습니다.'); n.style.marginTop = '8px'; box.appendChild(n); }
  }

  // ── 마감 ──
  $('cClose').onclick = function () {
    if (busy || !data || data.closed) return;
    var d = data, ym = d.ym;
    var msg = ym + ' 을(를) 마감합니다.\n마감하면 이 달 청구분의 검토·승인이 막히고, 늦게 나온 영수증은 누락분으로 다음 달에 올립니다. (현장소장이 사유를 적고 해제할 수 있습니다.)';
    if (d.bad || d.warn) msg += '\n\n점검에서 확인할 것이 ' + (d.bad + d.warn) + '건 남아 있습니다 (문제 ' + d.bad + ' · 보완 ' + d.warn + ').\n그래도 마감할까요?';
    else msg += '\n\n점검 결과 문제가 없습니다. 마감할까요?';
    if (!confirm(msg)) return;
    busy = true; $('cClose').disabled = true; setMsg('마감하는 중…', true);
    E.api('closeMonth', { ym: ym }, 30000).then(function (r) {
      busy = false;
      if (E.authLost(r)) return;
      if (!r.ok) { $('cClose').disabled = false; setMsg(r.message || '마감하지 못했습니다.'); return; }
      closedList = r.closed || closedList; note = ym + ' 마감했습니다. 아래 버튼으로 본사 제출 엑셀을 만들 수 있습니다.'; load();
    });
  };
  $('cReopen').onclick = function () {
    if (busy || !data || !data.closed) return;
    var ym = data.ym;
    var reason = prompt(ym + ' 마감을 해제합니다.\n해제 사유를 적어 주세요 (필수, 기록으로 남습니다):');
    if (reason === null) return;
    reason = String(reason).trim();
    if (reason.length < 2) { setMsg('사유를 적어야 해제할 수 있습니다.'); return; }
    busy = true; $('cReopen').disabled = true; setMsg('해제하는 중…', true);
    E.api('reopenMonth', { ym: ym, reason: reason }, 30000).then(function (r) {
      busy = false;
      if (E.authLost(r)) return;
      if (!r.ok) { $('cReopen').disabled = false; setMsg(r.message || '해제하지 못했습니다.'); return; }
      closedList = r.closed || closedList; note = ym + ' 마감을 해제했습니다. 고친 뒤 다시 마감해 주세요.'; load();
    });
  };

  // ── 엑셀 ──
  $('cExport').onclick = function () {
    if (!data) return;
    try {
      var bytes = X.makeWorkbook(data, new Date());
      var blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = X.fileName(data); document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      setMsg(a.download + ' 파일을 만들었습니다.' + (data.closed ? '' : ' (아직 마감 전이라 파일 이름에 「마감전」이 붙었습니다.)'), true);
    } catch (e) { setMsg('엑셀을 만들지 못했습니다. 화면을 새로 고친 뒤 다시 시도해 주세요.'); }
  };
})();
