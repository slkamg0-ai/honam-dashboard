/* HN28 현장 ERP v2.26 — 공구 자료: 개소(공구)를 고르면 착공내역서(총괄분) 내역과 설계도면을 본다.
 * 서버 siteInfo(내역·도면 목록)·siteDrawing(도면 이미지 1장)은 로그인한 직원에게만 답한다(역할 무관, 읽기 전용).
 * 공정 현황판의 개소 카드 「내역·도면」 버튼은 erp2/#site=번호 로 들어온다 → 로그인 뒤 바로 그 공구를 연다.
 * 서버가 보낸 글자는 모두 textContent 로만 넣는다. */
(function () {
  'use strict';
  var E = window.ERP2; if (!E) return;
  var $ = E.$, el = E.el;
  var M = null;          // getMaster 결과(개소 목록)
  var D = null;          // 지금 보고 있는 공구의 siteInfo 결과
  var tab = 'boq';       // boq | dwg
  var grp = '';          // 내역 공종 필터('' = 전체)
  var curSeq = 0, zoom = 1, seq = 0, iseq = 0;
  var IMG = {};          // 'no_seq' → objectURL
  var ZOOMS = [1, 1.5, 2, 3, 4];

  function setMsg(text, info) { var m = $('sMsg'); m.className = 'msg' + (info ? ' info' : ''); m.textContent = text || ''; }
  function won(n) { return n === null || n === undefined || n === '' ? '' : Math.round(Number(n)).toLocaleString('ko-KR'); }
  function qty(n) { if (n === null || n === undefined || n === '') return ''; var v = Number(n); return Math.abs(v - Math.round(v)) < 1e-9 ? v.toLocaleString('ko-KR') : v.toLocaleString('ko-KR', { maximumFractionDigits: 3 }); }
  function siteKey() { var me = E.me(); return me ? 'HN28V2_SITE_' + me.id : ''; }
  function workSite() { try { return Number(localStorage.getItem(siteKey()) || 0) || 0; } catch (e) { return 0; } }

  // ── 주소 #site=9 (&tab=dwg) ──
  function parseHash() {
    var h = String(location.hash || ''), m = /site=(\d{1,2})/.exec(h);
    if (!m) return null;
    return { no: Number(m[1]), tab: /tab=dwg/.test(h) ? 'dwg' : 'boq' };
  }
  function clearHash() { try { if (/site=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* 무시 */ } }

  // ── 화면 열기 ──
  function open(no, t) {
    E.showView('vSite'); window.scrollTo(0, 0);
    if (t) tab = t;
    paintTabs();
    var need = M ? Promise.resolve(M) : E.api('getMaster', {}, 20000).then(function (m) { if (E.authLost(m)) return null; if (m && m.ok) M = m; return M; });
    need.then(function (m) {
      if (!m) { setMsg('개소 목록을 불러오지 못했습니다. 잠시 후 다시 열어 주세요.'); return; }
      fillPick();
      var n = no || (D && D.no) || workSite() || (m.sites[0] && m.sites[0].no) || 0;
      $('sPick').value = String(n);
      if (!$('sPick').value && m.sites[0]) $('sPick').value = String(m.sites[0].no);
      load(Number($('sPick').value));
    });
  }
  function fillPick() {
    var p = $('sPick'); if (p.options.length) return;
    M.sites.forEach(function (s) {
      var o = el('option', '', s.no + '번 · ' + (s.route || '') + ' ' + (s.location || '') + (s.work ? ' (' + s.work + ')' : ''));
      o.value = String(s.no); p.appendChild(o);
    });
  }
  $('tileSite').onclick = function () { open(0); };
  $('sBack').onclick = function () { clearHash(); E.showView('vHome'); };
  $('sPick').onchange = function () { curSeq = 0; grp = ''; load(Number(this.value)); };
  $('sTabBoq').onclick = function () { tab = 'boq'; paintTabs(); render(); };
  $('sTabDwg').onclick = function () { tab = 'dwg'; paintTabs(); render(); };
  function paintTabs() {
    $('sTabBoq').classList.toggle('sel', tab === 'boq'); $('sTabDwg').classList.toggle('sel', tab === 'dwg');
    $('sBoq').classList.toggle('hide', tab !== 'boq'); $('sDwg').classList.toggle('hide', tab !== 'dwg');
  }

  function load(no) {
    if (!no) return;
    var my = ++seq;
    D = null; $('sInfo').textContent = ''; $('sItems').textContent = ''; $('sDwgList').textContent = ''; $('sView').textContent = '';
    setMsg('불러오는 중…', true);
    E.api('siteInfo', { no: no }, 30000).then(function (r) {
      if (my !== seq) return;
      if (E.authLost(r)) return;
      if (!r || !r.ok) { setMsg((r && r.message) || '공구 자료를 불러오지 못했습니다.'); return; }
      D = r; setMsg(''); render();
    });
  }

  function render() {
    if (!D) return;
    var info = $('sInfo'); info.textContent = '';
    info.appendChild(el('b', '', D.no + '번 ' + D.name));
    info.appendChild(document.createTextNode(' · ' + (D.kind || '') + ' · 착공내역 직접공사비 '));
    info.appendChild(el('b', '', won(D.total) + '원'));
    if (tab === 'boq') renderBoq(); else renderDwg();
  }

  // ── 내역 ──
  function renderBoq() {
    var chips = $('sGrp'); chips.textContent = '';
    var groups = D.rows.filter(function (r) { return r[0] === '공종'; });
    var all = el('button', grp === '' ? 'sel' : '', '전체'); all.type = 'button'; all.onclick = function () { grp = ''; renderBoq(); }; chips.appendChild(all);
    groups.forEach(function (g) {
      var b = el('button', grp === g[2] ? 'sel' : '', g[2] + ' ' + won(g[7])); b.type = 'button';
      b.onclick = function () { grp = g[2]; renderBoq(); }; chips.appendChild(b);
    });
    var q = String($('sSearch').value || '').trim().toLowerCase();
    var box = $('sItems'); box.textContent = '';
    var tbl = el('table', 'stbl'), th = el('thead'), tr = el('tr');
    ['품명', '규격', '수량', '단위', '단가', '금액'].forEach(function (h, i) { tr.appendChild(el('th', i >= 2 && i !== 3 ? 'n' : '', h)); });
    th.appendChild(tr); tbl.appendChild(th);
    var tb = el('tbody'), n = 0, sum = 0;
    D.rows.forEach(function (r) {
      if (r[0] === '공종') return;
      if (grp && r[1] !== grp) return;
      if (r[0] === '분류' || r[0] === '세부') {
        if (q) return;
        var h = el('tr', r[0] === '분류' ? 'sg' : 'sg2'), td = el('td', '', (r[0] === '세부' ? '· ' : '') + r[2]); td.colSpan = 5; h.appendChild(td);
        h.appendChild(el('td', 'n', won(r[7]))); tb.appendChild(h); return;
      }
      var hay = (r[2] + ' ' + r[3]).toLowerCase();
      if (q && hay.indexOf(q) < 0) return;
      var row = el('tr');
      row.appendChild(el('td', 'nm', r[2])); row.appendChild(el('td', 'sp', r[3]));
      row.appendChild(el('td', 'n q', qty(r[4]))); row.appendChild(el('td', 'u', r[5]));
      row.appendChild(el('td', 'n p', won(r[6]))); row.appendChild(el('td', 'n b', won(r[7])));
      tb.appendChild(row); n++; sum += Number(r[7]) || 0;
    });
    tbl.appendChild(tb);
    var wrap = el('div', 'stw'); wrap.appendChild(tbl); box.appendChild(wrap);
    $('sSum').textContent = '항목 ' + n + '개 · 금액 합계 ' + won(sum) + '원' + (grp ? ' (' + grp + ')' : '') + (q ? ' · 검색: ' + q : '');
    $('sSrc').textContent = '출처: ' + (D.src || '착공내역서') + (D.made ? ' · 정리 ' + D.made : '') + ' · 금액은 계약단가 기준(부가세 별도)';
  }
  $('sSearch').oninput = function () { if (D && tab === 'boq') renderBoq(); };

  // ── 도면 ──
  function defaultSeq() {
    var d = D.drawings, i;
    for (i = 0; i < d.length; i++) if (/일반도|평면도/.test(d[i].title) && !/가도/.test(d[i].title)) return d[i].seq;
    return d.length ? d[0].seq : 0;
  }
  function renderDwg() {
    var list = $('sDwgList'); list.textContent = '';
    if (!D.drawings.length) { list.appendChild(el('div', 'desc', '이 공구에 등록된 도면이 없습니다.')); return; }
    if (!curSeq) curSeq = defaultSeq();
    D.drawings.forEach(function (x) {
      var b = el('button', x.seq === curSeq ? 'sel' : ''); b.type = 'button';
      b.appendChild(document.createTextNode(x.title)); b.title = x.code + (x.scale && x.scale !== 'NONE' ? ' · ' + x.scale : '');
      b.onclick = function () { curSeq = x.seq; zoom = 1; renderDwg(); };
      list.appendChild(b);
    });
    showDrawing(curSeq);
  }
  function showDrawing(s) {
    var x = D.drawings.filter(function (d) { return d.seq === s; })[0]; if (!x) return;
    $('sDTitle').textContent = x.title + ' · ' + x.code + (x.scale && x.scale !== 'NONE' && x.scale !== 'AS SHOWN' ? ' · ' + x.scale : '');
    var key = D.no + '_' + s, my = ++iseq, view = $('sView');
    if (IMG[key]) { paint(IMG[key]); return; }
    view.textContent = ''; view.appendChild(el('div', 'desc', '도면을 불러오는 중… (약 0.5MB)'));
    E.api('siteDrawing', { no: D.no, seq: s }, 45000).then(function (r) {
      if (my !== iseq) return;
      if (E.authLost(r)) return;
      if (!r || !r.ok) { view.textContent = ''; view.appendChild(el('div', 'msg', (r && r.message) || '도면을 불러오지 못했습니다.')); return; }
      var bin = atob(r.data), arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      IMG[key] = URL.createObjectURL(new Blob([arr], { type: r.mime || 'image/jpeg' }));
      paint(IMG[key]);
    });
  }
  function paint(url) {
    var view = $('sView'); view.textContent = '';
    var img = el('img'); img.src = url; img.alt = $('sDTitle').textContent; img.style.width = (zoom * 100) + '%';
    view.appendChild(img);
    $('sZoomLbl').textContent = Math.round(zoom * 100) + '%';
  }
  function setZoom(z, cx, cy) {
    var view = $('sView'), img = view.querySelector('img'); if (!img) return;
    var old = zoom; zoom = z;
    var px = (view.scrollLeft + (cx === undefined ? view.clientWidth / 2 : cx)) / (old || 1);
    var py = (view.scrollTop + (cy === undefined ? view.clientHeight / 2 : cy)) / (old || 1);
    img.style.width = (zoom * 100) + '%';
    view.scrollLeft = px * zoom - (cx === undefined ? view.clientWidth / 2 : cx);
    view.scrollTop = py * zoom - (cy === undefined ? view.clientHeight / 2 : cy);
    $('sZoomLbl').textContent = Math.round(zoom * 100) + '%';
  }
  function step(d) { var i = ZOOMS.indexOf(zoom); if (i < 0) i = 0; i = Math.max(0, Math.min(ZOOMS.length - 1, i + d)); setZoom(ZOOMS[i]); }
  $('sZin').onclick = function () { step(1); };
  $('sZout').onclick = function () { step(-1); };
  $('sZfit').onclick = function () { setZoom(1); $('sView').scrollLeft = 0; $('sView').scrollTop = 0; };
  $('sView').ondblclick = function (e) { var r = this.getBoundingClientRect(); setZoom(zoom >= 3 ? 1 : ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 2)], e.clientX - r.left, e.clientY - r.top); };
  $('sOpenNew').onclick = function () { var u = D && IMG[D.no + '_' + curSeq]; if (u) window.open(u, '_blank', 'noopener'); };
  // 끌어서 이동(마우스)
  (function () {
    var v = $('sView'), down = false, sx = 0, sy = 0, sl = 0, st = 0;
    v.addEventListener('mousedown', function (e) { if (zoom <= 1) return; down = true; sx = e.clientX; sy = e.clientY; sl = v.scrollLeft; st = v.scrollTop; v.classList.add('grab'); e.preventDefault(); });
    window.addEventListener('mousemove', function (e) { if (!down) return; v.scrollLeft = sl - (e.clientX - sx); v.scrollTop = st - (e.clientY - sy); });
    window.addEventListener('mouseup', function () { down = false; v.classList.remove('grab'); });
  })();

  // ── 로그인 뒤 · 주소 변경 ──
  E.onEnter.push(function () { var h = parseHash(); if (h) setTimeout(function () { open(h.no, h.tab); }, 0); });
  window.addEventListener('hashchange', function () { var h = parseHash(); if (h && E.me()) open(h.no, h.tab); });
  E.onLeave.push(function () {
    Object.keys(IMG).forEach(function (k) { try { URL.revokeObjectURL(IMG[k]); } catch (e) { /* 무시 */ } });
    IMG = {}; D = null; M = null; grp = ''; curSeq = 0; zoom = 1; seq++; iseq++;
    $('sPick').textContent = ''; $('sItems').textContent = ''; $('sDwgList').textContent = ''; $('sView').textContent = ''; $('sInfo').textContent = ''; $('sSearch').value = ''; setMsg('');
  });
})();
