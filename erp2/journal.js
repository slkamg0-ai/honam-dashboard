/* HN28 현장 ERP v2.21 — 소장 작업일지: 현장소장 본인만 보는 하루 기록(하루 한 장).
 * 서버(listJournal·getJournal·saveJournal·deleteJournal)가 작성자 본인 것만 돌려준다. 메뉴도 현장소장에게만 보인다.
 * 새 일지를 열면 그날 작업일보(날씨·개소·인원·작업내용)를 초안으로 채우고, 지난 일지의 「내일 할 일」을 보여 준다.
 * 서버가 보낸 글자는 모두 textContent 로만 넣는다. */
(function () {
  'use strict';
  var E = window.ERP2; if (!E) return;
  var $ = E.$, el = E.el;
  var R = null;            // {today, items[]}
  var M = null;            // getMaster 결과(개소·날씨)
  var ym = '';             // 보고 있는 달('' 이면 전체 기간)
  var flag = 'all';        // all | star | change | extra | issue | safety
  var OPS = null;          // 열린 날짜의 작업일보 초안
  var picked = [];         // 선택한 개소 번호
  var busy = false, seq = 0;
  var TEXT = { work: 'jWork', crew: 'jCrew', meet: 'jMeet', issue: 'jIssue', safety: 'jSafety', cost: 'jCost', plan: 'jPlan' };
  var FLAGS = [['all', '전체'], ['star', '중요'], ['change', '설계변경 근거'], ['extra', '계약외 투입'], ['issue', '문제 있음'], ['safety', '안전 기록']];

  function setMsg(id, text, info) { var m = $(id); m.className = 'msg' + (info ? ' info' : ''); m.textContent = text || ''; }
  function pane(name) { $('jList').classList.toggle('hide', name !== 'list'); $('jForm').classList.toggle('hide', name !== 'form'); window.scrollTo(0, 0); }
  function isMgr() { var me = E.me(); return !!me && me.role === '현장소장'; }
  function dow(d) { return '일월화수목금토'.charAt(new Date(d + 'T00:00:00').getDay()); }

  // ── 홈 타일·메뉴(현장소장만) ──
  function refreshTile() {
    var on = isMgr();
    $('tileJnl').classList.toggle('hide', !on); $('navJnl').classList.toggle('hide', !on);
    if (!on) return;
    var sub = $('tileJnlSub'); sub.textContent = '하루 기록 · 협의 · 설계변경 근거';
    E.api('listJournal', {}, 15000).then(function (r) {
      if (!r || !r.ok) return;
      var done = r.items.some(function (j) { return j.date === r.today; });
      sub.textContent = ''; sub.appendChild(document.createTextNode('기록 ' + r.items.length + '일 '));
      sub.appendChild(el('span', done ? 'tag' : 'badge', done ? '오늘 작성' : '오늘 미작성'));
    });
  }
  E.onEnter.push(refreshTile);
  E.onLeave.push(function () { R = null; M = null; OPS = null; picked = []; ym = ''; flag = 'all'; busy = false; seq++; $('jItems').textContent = ''; $('jSum').textContent = ''; $('jSearch').value = ''; setMsg('jMsg', ''); setMsg('jFMsg', ''); $('tileJnl').classList.add('hide'); $('navJnl').classList.add('hide'); });

  // ── 목록 ──
  function openList() { if (!isMgr()) return; ym = null; E.showView('vJnl'); pane('list'); load(); }
  $('tileJnl').onclick = openList;
  $('jBack').onclick = function () { E.showView('vHome'); refreshTile(); };

  function load() {
    var my = ++seq;
    setMsg('jMsg', '불러오는 중…', true);
    var need = M ? Promise.resolve(M) : E.api('getMaster', {}, 20000).then(function (m) { if (m && m.ok) M = m; return M; });
    Promise.all([E.api('listJournal', {}, 25000), need]).then(function (res) {
      if (my !== seq) return;
      var r = res[0];
      if (E.authLost(r)) return;
      if (!r.ok) { R = null; render(); setMsg('jMsg', r.message || '일지를 불러오지 못했습니다.'); return; }
      R = r; if (ym === null) ym = r.today.slice(0, 7);
      $('jMonth').value = ym || ''; setMsg('jMsg', ''); render();
    });
  }

  function shiftMonth(n) {
    var base = ym || (R ? R.today.slice(0, 7) : ''); if (!base) return;
    var y = +base.slice(0, 4), m = +base.slice(5, 7) + n; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; }
    ym = y + '-' + (m < 10 ? '0' : '') + m; $('jMonth').value = ym; render();
  }
  $('jPrev').onclick = function () { shiftMonth(-1); };
  $('jNext').onclick = function () { shiftMonth(1); };
  $('jMonth').onchange = function () { ym = $('jMonth').value || ''; render(); };
  $('jAll').onclick = function () { ym = ''; $('jMonth').value = ''; render(); };
  $('jSearch').oninput = function () { render(); };

  function hay(j) { return [j.date, j.sites.split(', ').map(function (n) { return n ? '#' + n : ''; }).join(' '), j.weather, j.work, j.crew, j.meet, j.issue, j.safety, j.cost, j.plan, j.tags].join(' ').toLowerCase(); }
  function filtered() {
    if (!R) return [];
    var q = $('jSearch').value.trim().toLowerCase(), words = q ? q.split(/\s+/) : [];
    return R.items.filter(function (j) {
      if (ym && j.date.slice(0, 7) !== ym) return false;
      if (flag === 'star' && !j.star) return false;
      if (flag === 'change' && !j.change) return false;
      if (flag === 'extra' && !j.extra) return false;
      if (flag === 'issue' && !j.issue) return false;
      if (flag === 'safety' && !j.safety) return false;
      if (words.length) { var h = hay(j); for (var i = 0; i < words.length; i++) if (h.indexOf(words[i]) < 0) return false; }
      return true;
    });
  }

  function render() {
    var box = $('jFilters'); box.textContent = '';
    FLAGS.forEach(function (f) { var b = el('button', flag === f[0] ? 'sel' : '', f[1]); b.type = 'button'; b.onclick = function () { flag = f[0]; render(); }; box.appendChild(b); });
    var list = filtered(), items = $('jItems'), sum = $('jSum'); items.textContent = ''; sum.textContent = '';
    if (!R) return;
    var nC = list.filter(function (j) { return j.change; }).length, nX = list.filter(function (j) { return j.extra; }).length;
    sum.textContent = (ym ? ym.replace('-', '년 ') + '월' : '전체 기간') + ' · ' + list.length + '일' + (nC ? ' · 설계변경 근거 ' + nC : '') + (nX ? ' · 계약외 투입 ' + nX : '');
    var hasToday = R.items.some(function (j) { return j.date === R.today; });
    $('jNew').textContent = hasToday ? '오늘 일지 고치기' : '+ 오늘 일지 쓰기';
    if (!list.length) { items.appendChild(el('div', 'desc', R.items.length ? '조건에 맞는 일지가 없습니다.' : '아직 쓴 일지가 없습니다. 「오늘 일지 쓰기」로 시작하세요.')); return; }
    list.forEach(function (j) { items.appendChild(card(j)); });
  }

  function firstLine(t, n) { var s = String(t || '').split('\n')[0]; return s.length > n ? s.slice(0, n) + '…' : s; }
  function card(j) {
    var c = el('div', 'tk' + (j.star ? ' soon' : '')); c.style.cursor = 'pointer';
    var t1 = el('div', 't1'), tt = el('div', 'tt', j.date.slice(5).replace('-', '.') + ' (' + dow(j.date) + ')' + (j.weather ? ' · ' + j.weather : '') + (j.temp ? ' ' + j.temp : ''));
    t1.appendChild(tt); if (j.sites) t1.appendChild(el('span', 'dd', j.sites.split(', ').map(function (n) { return '#' + n; }).join(' ')));
    c.appendChild(t1);
    var body = j.work || j.meet || j.issue || j.plan || j.safety || j.cost;
    if (body) c.appendChild(el('div', 'bd', firstLine(body, 90)));
    var f = el('div', 'jf');
    if (j.star) f.appendChild(el('span', 'tag tmp', '중요'));
    if (j.change) f.appendChild(el('span', 'tag lock', '설계변경 근거'));
    if (j.extra) f.appendChild(el('span', 'tag lock', '계약외 투입'));
    if (j.meet) f.appendChild(el('span', 'tag off', '협의'));
    if (j.issue) f.appendChild(el('span', 'tag off', '문제'));
    if (j.safety) f.appendChild(el('span', 'tag', '안전'));
    j.tags.split(',').map(function (t) { return t.trim(); }).filter(Boolean).forEach(function (t) { f.appendChild(el('span', 'tag off', '#' + t)); });
    if (f.childNodes.length) c.appendChild(f);
    c.onclick = function () { openForm(j.date); };
    return c;
  }

  // ── CSV(엑셀) 내려받기: 지금 걸러진 목록 그대로 ──
  $('jCsv').onclick = function () {
    var list = filtered(); if (!list.length) { setMsg('jMsg', '내려받을 일지가 없습니다.'); return; }
    var cols = [['date', '일자'], ['weather', '날씨'], ['temp', '기온'], ['sites', '개소'], ['work', '오늘 한 일'], ['crew', '인원·장비'], ['meet', '협의·지시'], ['issue', '문제·특이사항'], ['safety', '안전'],
      ['change', '설계변경근거'], ['extra', '계약외투입'], ['cost', '비용메모'], ['plan', '내일 할 일'], ['tags', '태그'], ['star', '중요'], ['updated', '수정일시']];
    function q(v) { v = v === true ? 'Y' : v === false ? '' : String(v || ''); if (/^[=+\-@]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; }
    var lines = [cols.map(function (c) { return q(c[1]); }).join(',')];
    list.slice().reverse().forEach(function (j) { lines.push(cols.map(function (c) { return q(j[c[0]]); }).join(',')); });
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '작업일지_' + (ym || '전체') + '.csv';
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    setMsg('jMsg', list.length + '일치 일지를 내려받았습니다.', true);
  };

  // ── 쓰기·고치기 ──
  function fillWeather(v) {
    var s = $('jWeather'); s.textContent = '';
    var o0 = el('option', '', '선택'); o0.value = ''; s.appendChild(o0);
    ((M && M.opsWeather) || ['맑음', '구름조금', '흐림', '비', '눈', '강풍·한파']).forEach(function (w) { var o = el('option', '', w); o.value = w; if (w === v) o.selected = true; s.appendChild(o); });
  }
  function drawSites() {
    var box = $('jSites'); box.textContent = '';
    ((M && M.sites) || []).slice().sort(function (a, b) { return a.no - b.no; }).forEach(function (s) {
      var b = el('button', picked.indexOf(s.no) >= 0 ? 'sel' : '', '#' + s.no); b.type = 'button'; b.title = s.location + ' · ' + s.work;
      b.onclick = function () { var i = picked.indexOf(s.no); if (i >= 0) picked.splice(i, 1); else picked.push(s.no); drawSites(); };
      box.appendChild(b);
    });
  }
  function setForm(j) {
    fillWeather(j ? j.weather : ''); $('jTemp').value = j ? j.temp : ''; $('jTags').value = j ? j.tags : '';
    Object.keys(TEXT).forEach(function (k) { $(TEXT[k]).value = j ? j[k] : ''; });
    $('jChange').checked = !!(j && j.change); $('jExtra').checked = !!(j && j.extra); $('jStar').checked = !!(j && j.star);
    picked = j && j.sites ? j.sites.split(', ').map(Number).filter(Boolean) : []; drawSites();
  }
  /** 작업일보 초안으로 빈 칸만 채운다(이미 적은 내용은 건드리지 않는다) */
  function applyOps(force) {
    if (!OPS) return 0;
    var n = 0;
    if (OPS.weather && (force || !$('jWeather').value)) { fillWeather(OPS.weather); n++; }
    if (OPS.sites) { OPS.sites.split(', ').map(Number).forEach(function (s) { if (s && picked.indexOf(s) < 0) { picked.push(s); n++; } }); drawSites(); }
    if (OPS.work && !$('jWork').value.trim()) { $('jWork').value = OPS.work; n++; }
    if (OPS.crew && !$('jCrew').value.trim()) { $('jCrew').value = OPS.crew; n++; }
    return n;
  }

  function openForm(date) {
    if (!isMgr() || busy) return;
    var d = date || (R ? R.today : '');
    $('jDate').value = d; $('jDate').max = R ? R.today : '';
    pane('form'); setForm(null); OPS = null;
    $('jOpsNote').textContent = ''; $('jPrevPlan').textContent = ''; $('jFromOps').classList.add('hide'); $('jDel').classList.add('hide');
    $('jFTitle').textContent = '작업일지 · ' + d + ' (' + dow(d) + ')';
    loadDay(d);
  }
  function loadDay(d) {
    var my = ++seq; busy = true; $('jSave').disabled = true;
    setMsg('jFMsg', '불러오는 중…', true);
    E.api('getJournal', { date: d }, 25000).then(function (r) {
      if (my !== seq) return;
      busy = false; $('jSave').disabled = false;
      if (E.authLost(r)) return;
      if (!r.ok) { setMsg('jFMsg', r.message || '불러오지 못했습니다.'); return; }
      setMsg('jFMsg', '');
      OPS = r.ops;
      setForm(r.item);
      $('jDel').classList.toggle('hide', !r.item);
      $('jFTitle').textContent = '작업일지 · ' + d + ' (' + dow(d) + ')' + (r.item ? ' — 고치기' : '');
      if (OPS) {
        $('jOpsNote').textContent = '이 날 작업일보 ' + OPS.count + '건이 있습니다.' + (r.item ? '' : ' 날씨·개소·인원·작업내용을 일지 초안으로 채웠습니다.');
        $('jFromOps').classList.toggle('hide', !r.item);
        if (!r.item) applyOps(false);
      } else {
        $('jOpsNote').textContent = '이 날 작업일보는 아직 없습니다.';
      }
      if (r.prevPlan) $('jPrevPlan').textContent = '지난 일지(' + r.prevPlan.date.slice(5).replace('-', '.') + ')에 적은 내일 할 일: ' + r.prevPlan.plan;
    });
  }
  $('jNew').onclick = function () { openForm(R ? R.today : ''); };
  $('jDate').onchange = function () { var d = $('jDate').value; if (!d) return; if (R && d > R.today) { $('jDate').value = R.today; d = R.today; } $('jFTitle').textContent = '작업일지 · ' + d + ' (' + dow(d) + ')'; loadDay(d); };
  $('jFromOps').onclick = function () { var n = applyOps(false); setMsg('jFMsg', n ? '작업일보 내용으로 빈 칸을 채웠습니다.' : '채울 빈 칸이 없습니다. (이미 적은 내용은 그대로 둡니다)', true); };
  $('jCancel').onclick = function () { seq++; busy = false; $('jSave').disabled = false; pane('list'); render(); };

  $('jSave').onclick = function () {
    if (busy) return;
    var d = $('jDate').value;
    if (!d) { setMsg('jFMsg', '일자를 골라 주세요.'); return; }
    var data = { date: d, weather: $('jWeather').value, temp: $('jTemp').value, tags: $('jTags').value, sites: picked.join(','), change: $('jChange').checked, extra: $('jExtra').checked, star: $('jStar').checked };
    var any = false; Object.keys(TEXT).forEach(function (k) { data[k] = $(TEXT[k]).value; if (k !== 'crew' && data[k].trim()) any = true; });
    if (!any) { setMsg('jFMsg', '오늘 한 일, 협의·지시, 문제, 안전, 비용, 내일 할 일 중 하나는 적어 주세요.'); return; }
    busy = true; $('jSave').disabled = true; setMsg('jFMsg', '저장하는 중…', true);
    E.api('saveJournal', data, 30000).then(function (r) {
      busy = false; $('jSave').disabled = false;
      if (E.authLost(r)) return;
      if (!r.ok) { setMsg('jFMsg', r.message || '저장하지 못했습니다.'); return; }
      if (R) { R.items = R.items.filter(function (j) { return j.date !== r.item.date; }).concat([r.item]).sort(function (a, b) { return a.date < b.date ? 1 : -1; }); }
      ym = r.item.date.slice(0, 7); $('jMonth').value = ym;
      pane('list'); render(); setMsg('jMsg', r.item.date + ' 일지를 저장했습니다.', true);
    });
  };

  var delArm = 0;
  $('jDel').onclick = function () {
    if (busy) return;
    var d = $('jDate').value, b = $('jDel');
    if (Date.now() - delArm > 4000) { delArm = Date.now(); b.textContent = '한 번 더 누르면 삭제됩니다'; setTimeout(function () { b.textContent = '이 날 일지 삭제'; }, 4000); return; }
    delArm = 0; busy = true; b.disabled = true; setMsg('jFMsg', '삭제하는 중…', true);
    E.api('deleteJournal', { date: d }, 30000).then(function (r) {
      busy = false; b.disabled = false; b.textContent = '이 날 일지 삭제';
      if (E.authLost(r)) return;
      if (!r.ok) { setMsg('jFMsg', r.message || '삭제하지 못했습니다.'); return; }
      if (R) R.items = R.items.filter(function (j) { return j.date !== d; });
      pane('list'); render(); setMsg('jMsg', d + ' 일지를 삭제했습니다.', true);
    });
  };
})();
