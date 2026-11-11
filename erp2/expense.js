/* HN28 현장 ERP v2 — 2단계: 경비 입력·검토·승인 화면 (3단계: 마감된 달의 누락분 확인 포함)
 * index.html 이 열어 둔 window.ERP2(api·me·showView 등)만 쓴다. 서버가 보낸 글자는 모두 textContent 로만 넣는다. */
(function () {
  'use strict';
  var E = window.ERP2; if (!E) return;
  var $ = E.$, el = E.el;
  var M = null;            // 서버 마스터(비목·결제수단·개소 …)
  var month = '';          // 보고 있는 달 (YYYY-MM)
  var pendingId = '';     // 결재함에서 「열기」로 들어온 건(목록을 받으면 바로 상세를 연다)
  var filter = 'all';      // all | mine | queue
  var items = [];
  var closedList = [];     // 서버가 알려 주는 마감된 달
  var F = null;            // 작성 중인 양식 상태
  var busy = false;

  var won = function (n) { return Number(n || 0).toLocaleString('ko-KR') + '원'; };
  function setMsg(id, text, info) { var m = $(id); m.className = 'msg' + (info ? ' info' : ''); m.textContent = text || ''; }
  function show(id, on) { $(id).classList.toggle('hide', !on); }
  function pane(name) { show('xList', name === 'list'); show('xDetail', name === 'detail'); show('xForm', name === 'form'); window.scrollTo(0, 0); }
  function fail(msgId, r) { if (E.authLost(r)) return true; if (r && r.ok) return false; setMsg(msgId, (r && r.message) || '처리하지 못했습니다.'); return false; }

  // ── 마스터 ──
  function withMaster(cb, msgId) {
    if (M) { cb(); return; }
    setMsg(msgId, '불러오는 중…', true);
    E.api('getMaster', {}, 20000).then(function (r) {
      if (E.authLost(r)) return;
      if (!r.ok) { setMsg(msgId, r.message || '기본 정보를 불러오지 못했습니다.'); return; }
      M = r; setMsg(msgId, ''); cb();
    });
  }
  function siteLabel(no) {
    if (!no) return '공통';
    var s = (M ? M.sites : []).filter(function (x) { return x.no === no; })[0];
    return s ? s.code + ' · ' + s.route + ' ' + s.location : '개소' + no;
  }

  // ── 홈 타일의 결재 대기 표시 ──
  function myTodo(list) {
    var me = E.me(); if (!me) return 0;
    return list.filter(function (i) {
      if (i.authorId === me.loginId) return me.role === '현장소장' && (i.status === '검토대기' || i.status === '승인대기'); // 소장 본인 경비는 소장이 검토·승인
      if (i.status === '검토대기') return me.role === '현장소장' || (me.role === '공무' && !(M && M.manager && i.author === M.manager));
      if (i.status === '승인대기') return me.role === '현장소장';
      return false;
    }).length;
  }
  function refreshBadge() {
    var sub = $('tileExpSub'); if (!sub) return;
    sub.textContent = '영수증 등록 · 검토 · 승인';
    E.api('listExpenses', { queue: true }, 15000).then(function (r) {
      if (!r || !r.ok) return;
      var n = myTodo(r.items); if (!n) return;
      sub.textContent = '';
      sub.appendChild(document.createTextNode('처리할 결재 '));
      sub.appendChild(el('span', 'badge', n + '건'));
    });
  }
  E.onEnter.push(refreshBadge);
  E.onLeave.push(function () { items = []; F = null; month = ''; filter = 'all'; $('xItems').textContent = ''; $('xDetail').textContent = ''; $('xSum').textContent = ''; });

  // ── 목록 ──
  function openList() {
    E.showView('vExp'); pane('list');
    withMaster(function () { if (!month) month = M.today.slice(0, 7); $('xMonth').value = month; buildFilters(); load(); }, 'xMsg');
  }
  $('tileExp').onclick = openList;
  E.openItem = E.openItem || {};
  E.openItem.exp = function (id) { filter = 'queue'; pendingId = String(id || ''); openList(); };
  $('xBack').onclick = function () { E.showView('vHome'); refreshBadge(); };

  function buildFilters() {
    var box = $('xFilters'); box.textContent = '';
    [['all', '이번 달 전체'], ['mine', '내가 쓴 것'], ['queue', '결재 대기함']].forEach(function (f) {
      var b = el('button', filter === f[0] ? 'sel' : '', f[1]); b.type = 'button';
      b.onclick = function () { filter = f[0]; buildFilters(); load(); };
      box.appendChild(b);
    });
    var q = filter === 'queue'; $('xMonth').disabled = q; $('xPrev').disabled = q; $('xNext').disabled = q; $('xThis').disabled = q;
  }
  function shiftMonth(d) { if (!month) return; var y = +month.slice(0, 4), m = +month.slice(5, 7) + d; if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; } month = y + '-' + (m < 10 ? '0' : '') + m; $('xMonth').value = month; load(); }
  $('xPrev').onclick = function () { shiftMonth(-1); };
  $('xNext').onclick = function () { shiftMonth(1); };
  $('xThis').onclick = function () { if (!M) return; month = M.today.slice(0, 7); $('xMonth').value = month; load(); };
  $('xMonth').onchange = function () { if (/^\d{4}-\d{2}$/.test($('xMonth').value)) { month = $('xMonth').value; load(); } };

  function load() {
    setMsg('xMsg', '불러오는 중…', true);
    var req = filter === 'queue' ? { queue: true } : { month: month };
    E.api('listExpenses', req, 25000).then(function (r) {
      if (E.authLost(r)) return;
      if (!r.ok) { items = []; render(); setMsg('xMsg', r.message || '목록을 불러오지 못했습니다.'); return; }
      items = r.items; closedList = r.closed || []; setMsg('xMsg', ''); render();
      if (pendingId) { var hit = items.filter(function (x) { return x.id === pendingId; })[0]; pendingId = ''; if (hit) showDetail(hit); }
    });
  }

  function render() {
    var me = E.me(); var list = items;
    if (filter === 'mine') list = items.filter(function (i) { return i.authorId === me.loginId; });
    var sum = $('xSum'); sum.textContent = '';
    var all = 0, done = 0, cnt = {};
    list.forEach(function (i) { cnt[i.status] = (cnt[i.status] || 0) + 1; if (i.status !== '반려') all += i.total; if (i.status === '승인') done += i.total; });
    var head = filter === 'queue' ? '결재 대기 ' + list.length + '건' : (month.replace('-', '년 ') + '월 · ' + list.length + '건');
    sum.appendChild(document.createTextNode(head + ' · 합계 ' + won(all) + ' (반려 제외)'));
    if (filter !== 'queue') { sum.appendChild(document.createElement('br')); sum.appendChild(document.createTextNode('승인 완료 ' + won(done) + (cnt['반려'] ? ' · 반려 ' + cnt['반려'] + '건' : ''))); }
    var cl = filter !== 'queue' ? closedList.filter(function (c) { return c.ym === month; })[0] : null;
    if (cl) { sum.appendChild(document.createElement('br')); sum.appendChild(document.createTextNode('이 달은 마감되었습니다 (' + cl.by + ', ' + cl.at.slice(0, 16) + '). 늦게 나온 영수증은 누락분으로 다음 달에 청구합니다.')); }
    var box = $('xItems'); box.textContent = '';
    if (!list.length) { box.appendChild(el('div', 'desc', filter === 'queue' ? '결재를 기다리는 경비가 없습니다.' : '이 달에 등록된 경비가 없습니다.')); return; }
    list.forEach(function (i) {
      var c = el('div', 'xi'); c.tabIndex = 0; c.setAttribute('role', 'button');
      var r1 = el('div', 'r1'); r1.appendChild(el('span', '', i.vendor)); r1.appendChild(el('span', '', won(i.total)));
      var r2 = el('div', 'r2');
      r2.appendChild(el('span', 'st st-' + i.status, i.status)); if (i.late) r2.appendChild(el('span', 'st st-late', '누락분')); r2.appendChild(document.createTextNode(' ' + i.date.slice(5) + ' · ' + i.category.split('(')[0] + ' · ' + siteLabel(i.site) + ' · ' + i.author + (i.docNo ? ' · ' + i.docNo : '')));
      c.appendChild(r1); c.appendChild(r2);
      c.onclick = function () { showDetail(i); };
      c.onkeydown = function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); showDetail(i); } };
      box.appendChild(c);
    });
  }

  // ── 상세 ──
  function kv(box, k, v) { var g = box.querySelector('.kv') || box.appendChild(el('div', 'kv')); g.appendChild(el('b', '', k)); g.appendChild(el('span', '', v)); }

  /** 제출. 마감된 달 날짜면 서버가 누락분 청구월을 알려 주고, 확인하면 그 달로 다시 제출한다. */
  function submitAsk(id) {
    return E.api('submitExpense', { id: id }, 30000).then(function (r) {
      if (r && r.error === 'LATE') {
        if (confirm(r.message)) return E.api('submitExpense', { id: id, lateOk: r.claimMonth }, 30000);
        return { ok: false, error: 'CANCEL', message: '제출하지 않았습니다. 마감된 달의 경비는 누락분으로 올릴 때만 제출됩니다.' };
      }
      return r;
    });
  }

  function showDetail(i) {
    var me = E.me(), mine = i.authorId === me.loginId;
    var box = $('xDetail'); box.textContent = ''; pane('detail');
    var p = el('div', 'panel'); box.appendChild(p);
    var h = el('h3', '', '경비 상세 '); var b = el('button', 'sm', '목록으로'); b.type = 'button'; b.style.float = 'right'; b.onclick = function () { pane('list'); load(); }; h.appendChild(b); p.appendChild(h);
    var st = el('div'); st.appendChild(el('span', 'st st-' + i.status, i.status)); if (i.docNo) st.appendChild(document.createTextNode('  문서번호 ' + i.docNo)); p.appendChild(st);
    if (i.status === '반려' && i.reason) p.appendChild(el('div', 'rej', '반려 사유: ' + i.reason + (i.reviewer || i.approver ? '  (' + (i.approver || i.reviewer) + ')' : '')));
    kv(p, '사용일', i.date); kv(p, '사용처', i.vendor); kv(p, '적요', i.memo); kv(p, '합계', won(i.total));
    kv(p, '공급가 / 부가세', won(i.supply) + ' / ' + won(i.vat)); kv(p, '비목', i.category); kv(p, '예산 항목', i.budget); kv(p, '개소', siteLabel(i.site)); kv(p, '결제수단', i.pay);
    if (i.late) kv(p, '청구월', i.claimMonth + ' (누락분 · 사용일 ' + i.date.slice(0, 7) + '은 마감됨)');
    kv(p, '작성', i.author + ' · ' + i.created);
    if (i.reviewer) kv(p, '검토', i.reviewer + ' · ' + i.reviewedAt);
    if (i.approver && i.status === '승인') kv(p, '승인', i.approver + ' · ' + i.approvedAt);
    if (i.noReceipt) kv(p, '영수증 없음 사유', i.noReceipt);

    var rc = el('div'); p.appendChild(el('label', '', '영수증 사진 ' + i.receipts.length + '장'));
    i.receipts.forEach(function (r, idx) {
      var bt = el('button', 'sm', (idx + 1) + '번 사진 보기'); bt.type = 'button'; bt.style.marginRight = '6px';
      bt.onclick = function () {
        bt.disabled = true; bt.textContent = '불러오는 중…';
        E.api('getReceipt', { id: i.id, index: idx }, 30000).then(function (x) {
          if (E.authLost(x)) return;
          if (!x.ok || !/^image\/(jpeg|png|webp)$/.test(x.mime)) { bt.disabled = false; bt.textContent = '다시 시도'; setMsg('dMsg', (x && x.message) || '사진을 불러오지 못했습니다.'); return; }
          var img = el('img', 'rimg'); img.alt = (idx + 1) + '번 영수증'; img.src = 'data:' + x.mime + ';base64,' + x.data; bt.replaceWith(img);
        });
      };
      rc.appendChild(bt);
    });
    p.appendChild(rc);

    var btns = el('div', 'row-btns'); p.appendChild(btns);
    var msg = el('div', 'msg'); msg.id = 'dMsg'; p.appendChild(msg);
    function btn(text, cls, fn) { var x = el('button', cls || '', text); x.type = 'button'; x.onclick = fn; btns.appendChild(x); return x; }
    function callApi(action, data) {
      if (action !== 'submitExpense') return E.api(action, data, 30000);
      return submitAsk(data.id);
    }
    function act(action, data, okText) {
      if (busy) return; busy = true; setMsg('dMsg', '처리 중…', true);
      callApi(action, data).then(function (r) {
        busy = false;
        if (fail('dMsg', r)) return;
        if (!r.ok) return;
        if (action === 'deleteExpense') { pane('list'); load(); return; }
        showDetail(r.item); setMsg('dMsg', okText, true);
      });
    }
    function reasonBox(label, action) {
      btns.textContent = ''; var t = el('textarea'); t.id = 'dReason'; t.rows = 2; t.maxLength = 200; t.placeholder = '반려 사유 (예: 영수증 금액이 다릅니다)';
      var w = el('div'); w.style.width = '100%'; w.appendChild(t); btns.appendChild(w);
      btn('취소', '', function () { showDetail(i); });
      btn(label, 'warn', function () { var v = t.value.trim(); if (v.length < 2) { setMsg('dMsg', '반려 사유를 적어 주세요.'); return; } act(action, { id: i.id, decision: 'reject', reason: v }, '반려했습니다.'); });
    }

    if (mine && (i.status === '작성중' || i.status === '반려')) {
      btn('수정', '', function () { openForm(i); });
      btn(i.status === '반려' ? '다시 제출' : '제출', 'pri', function () { act('submitExpense', { id: i.id }, '제출했습니다.'); }).style.marginTop = '0';
      btn('삭제', 'warn', function () { if (confirm('이 경비를 삭제할까요?')) act('deleteExpense', { id: i.id }, ''); });
    }
    var byMgr = !!(M && M.manager && i.author === M.manager); // 현장소장이 쓴 경비는 현장소장이 직접 검토
    if (i.status === '검토대기' && (me.role === '현장소장' || (me.role === '공무' && !mine && !byMgr))) {
      btn('검토 완료 (승인 요청)', 'ok', function () { act('reviewExpense', { id: i.id, decision: 'ok' }, '검토했습니다. 현장소장 승인 대기로 넘어갔습니다.'); });
      btn('반려', 'warn', function () { reasonBox('반려 확정', 'reviewExpense'); });
    }
    if (i.status === '승인대기' && me.role === '현장소장') {
      btn('승인', 'ok', function () { act('approveExpense', { id: i.id, decision: 'ok' }, '승인했습니다.'); });
      btn('반려', 'warn', function () { reasonBox('반려 확정', 'approveExpense'); });
    }
    if (i.status === '검토대기' && mine && me.role !== '현장소장') p.appendChild(el('div', 'desc', '공무(또는 현장소장)의 검토를 기다리는 중입니다. 제출한 경비는 고칠 수 없습니다.'));
    if (i.status === '검토대기' && byMgr && me.role === '공무') p.appendChild(el('div', 'desc', '현장소장이 쓴 경비라 현장소장이 직접 검토합니다.'));
    if (i.status === '승인대기' && me.role !== '현장소장') p.appendChild(el('div', 'desc', '현장소장 승인을 기다리는 중입니다.'));
  }

  // ── 양식 ──
  function fillSelect(sel, values, labelFn) { sel.textContent = ''; values.forEach(function (v) { var o = el('option', '', labelFn ? labelFn(v) : v); o.value = typeof v === 'object' ? v.v : v; sel.appendChild(o); }); }
  function num(v) { var t = String(v || '').replace(/[,\s원]/g, ''); return /^\d{1,12}$/.test(t) ? Number(t) : NaN; }
  function calcVat() {
    var mode = $('fVatMode').value, total = num($('fTotal').value);
    var sup = $('fSupply'), vat = $('fVat'); sup.readOnly = vat.readOnly = mode !== 'manual';
    if (mode === 'manual') { sup.placeholder = '공급가액'; vat.placeholder = '부가세'; return; }
    if (isNaN(total)) { sup.value = vat.value = ''; return; }
    if (mode === 'none') { sup.value = String(total); vat.value = '0'; return; }
    var s = Math.round(total / 1.1); sup.value = String(s); vat.value = String(total - s);
  }
  ['fTotal', 'fVatMode'].forEach(function (id) { $(id).addEventListener('input', calcVat); $(id).addEventListener('change', calcVat); });
  $('fCat').addEventListener('change', function () { if (M && !$('fBudget').dataset.manual) $('fBudget').value = M.catBudget[$('fCat').value] || M.defaultBudget; });
  $('fBudget').addEventListener('change', function () { $('fBudget').dataset.manual = '1'; });

  function openForm(it) {
    withMaster(function () {
      F = { id: it ? it.id : '', keep: it ? it.receipts.slice() : [], drop: [], add: [] };
      fillSelect($('fCat'), M.categories); fillSelect($('fPay'), M.payMethods); fillSelect($('fBudget'), M.budgetItems);
      fillSelect($('fSite'), [{ v: '0', t: '공통 (개소 없음)' }].concat(M.sites.map(function (s) { return { v: String(s.no), t: s.code + ' · ' + s.route + ' ' + s.location + ' (' + s.work + ')' }; })), function (o) { return o.t; });
      $('fBudget').dataset.manual = '';
      $('fTitle').textContent = it ? (it.status === '반려' ? '경비 고치기 (반려됨)' : '경비 고치기') : '경비 등록';
      $('fDate').max = M.today; $('fDate').value = it ? it.date : M.today;
      $('fCat').value = it ? it.category : M.categories[0]; $('fPay').value = it ? it.pay : M.payMethods[0]; $('fSite').value = String(it ? it.site : 0);
      if (!it && E.workSite && E.workSite() && $('fSite').querySelector('option[value="' + E.workSite() + '"]')) $('fSite').value = String(E.workSite()); // 홈에서 고른 작업 개소
      $('fBudget').value = it ? it.budget : (M.catBudget[$('fCat').value] || M.defaultBudget); if (it) $('fBudget').dataset.manual = '1';
      $('fVendor').value = it ? it.vendor : ''; $('fMemo').value = it ? it.memo : ''; $('fTotal').value = it ? String(it.total) : '';
      var mode = 'auto'; if (it) { if (it.vat === 0) mode = 'none'; else if (it.vat !== it.total - Math.round(it.total / 1.1)) mode = 'manual'; }
      $('fVatMode').value = mode; calcVat(); if (it && mode === 'manual') { $('fSupply').value = String(it.supply); $('fVat').value = String(it.vat); }
      $('fNoReceipt').value = it ? (it.noReceipt || '') : ''; $('fFiles').value = ''; setMsg('fMsg', '');
      drawThumbs(); pane('form');
    }, 'xMsg');
  }
  $('xNew').onclick = function () { openForm(null); };
  $('fCancel').onclick = function () { F = null; pane('list'); };

  function totalReceipts() { return F.keep.length + F.add.length; }
  function drawThumbs() {
    var box = $('fThumbs'); box.textContent = '';
    F.keep.forEach(function (r) {
      var t = el('div', 'th', '저장됨\n' + r.name.replace(/^EXP-\d+-/, '')); var x = el('button', '', '×'); x.type = 'button'; x.title = '이 사진 빼기';
      x.onclick = function () { F.drop.push(r.n); F.keep = F.keep.filter(function (k) { return k !== r; }); drawThumbs(); };
      t.appendChild(x); box.appendChild(t);
    });
    F.add.forEach(function (a) {
      var t = el('div', 'th'); var img = el('img'); img.alt = '새 영수증'; img.src = 'data:image/jpeg;base64,' + a.data; t.appendChild(img);
      var x = el('button', '', '×'); x.type = 'button'; x.title = '이 사진 빼기';
      x.onclick = function () { F.add = F.add.filter(function (k) { return k !== a; }); drawThumbs(); }; t.appendChild(x); box.appendChild(t);
    });
    $('fRcCount').textContent = '(' + totalReceipts() + '/' + M.maxReceipts + '장)';
    show('fNoWrap', totalReceipts() === 0); $('fFiles').disabled = totalReceipts() >= M.maxReceipts;
  }

  // 사진을 긴 변 1600px 이하 JPEG 로 줄여서 올린다(휴대폰 사진 3~8MB → 약 0.3MB)
  function shrink(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var out = null, dims = [1280, 1024, 800];
        for (var k = 0; k < dims.length && !out; k++) {
          var w = img.naturalWidth, h = img.naturalHeight, s = Math.min(1, dims[k] / Math.max(w, h));
          var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
          var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
          var d = c.toDataURL('image/jpeg', 0.72).split(',')[1]; if (d.length <= 2000000) out = d;
        }
        URL.revokeObjectURL(url); out ? res(out) : rej(new Error('big'));
      };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('decode')); };
      img.src = url;
    });
  }
  $('fFiles').onchange = function () {
    var files = Array.prototype.slice.call($('fFiles').files || []); $('fFiles').value = '';
    var room = M.maxReceipts - totalReceipts(); if (!files.length) return;
    var note = '';
    if (files.length > room) { note = '사진은 최대 ' + M.maxReceipts + '장까지 올릴 수 있습니다. 앞의 ' + room + '장만 담았습니다.'; files = files.slice(0, room); }
    setMsg('fMsg', '사진을 줄이는 중…', true);
    Promise.all(files.map(function (f) { return shrink(f).then(function (d) { return { name: f.name, data: d }; }); })).then(function (list) {
      list.forEach(function (a) { F.add.push(a); }); drawThumbs(); setMsg('fMsg', note);
    }).catch(function () { setMsg('fMsg', '사진을 읽지 못했습니다. 다른 사진을 선택하거나 JPG로 저장해서 올려 주세요.'); });
  };

  function collect() {
    var total = num($('fTotal').value), mode = $('fVatMode').value, v = {
      date: $('fDate').value, category: $('fCat').value, pay: $('fPay').value, site: Number($('fSite').value), budget: $('fBudget').value,
      vendor: $('fVendor').value.trim(), memo: $('fMemo').value.trim(), total: total, noReceipt: totalReceipts() ? '' : $('fNoReceipt').value.trim()
    };
    v.supply = num($('fSupply').value); v.vat = num($('fVat').value);
    return v;
  }
  function problem(v) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) return '사용일을 입력해 주세요.';
    if (v.date > M.today) return '오늘 이후 날짜는 입력할 수 없습니다.';
    if (!v.vendor) return '사용처(거래처)를 입력해 주세요.';
    if (v.memo.length < 2) return '적요(지출 내용·목적)를 입력해 주세요.';
    if (isNaN(v.total) || v.total < 1 || v.total > 1000000000) return '합계 금액은 1원 이상의 숫자로 입력해 주세요.';
    if (isNaN(v.supply) || isNaN(v.vat) || v.supply + v.vat !== v.total) return '공급가액과 부가세를 더하면 합계 금액과 같아야 합니다.';
    return '';
  }

  function saveForm(submit, force) {
    if (busy) return;
    var v = collect(), bad = problem(v); if (bad) { setMsg('fMsg', bad); return; }
    var data = { id: F.id || undefined, date: v.date, category: v.category, pay: v.pay, site: v.site, budget: v.budget, vendor: v.vendor, memo: v.memo, total: v.total, supply: v.supply, vat: v.vat,
      noReceipt: v.noReceipt, removeReceipts: F.drop, newReceipts: F.add.map(function (a) { return { name: a.name, data: a.data }; }), force: !!force };
    busy = true; $('fDraft').disabled = $('fSubmit').disabled = true; setMsg('fMsg', F.add.length ? '사진과 함께 저장하는 중… (몇 초 걸립니다)' : '저장하는 중…', true);
    function done() { busy = false; $('fDraft').disabled = $('fSubmit').disabled = false; }
    E.api('saveExpense', data, 70000).then(function (r) {
      if (E.authLost(r)) { done(); return; }
      if (!r.ok) {
        done();
        if (r.error === 'DUP') { if (confirm(r.message + '\n\n그래도 저장할까요?')) saveForm(submit, true); else setMsg('fMsg', '저장하지 않았습니다.'); return; }
        setMsg('fMsg', r.message || '저장하지 못했습니다.'); return;
      }
      var saved = r.item; F = null;
      if (!submit) { done(); showDetail(saved); setMsg('dMsg', '임시저장했습니다. 제출하면 검토 단계로 넘어갑니다.', true); return; }
      submitAsk(saved.id).then(function (s) {
        done(); if (E.authLost(s)) return;
        if (!s.ok) { showDetail(saved); setMsg('dMsg', '저장은 했지만 제출하지 못했습니다: ' + (s.message || ''), false); return; }
        showDetail(s.item); setMsg('dMsg', '제출했습니다. ' + (s.item.status === '승인대기' ? '현장소장 승인을 기다립니다.' : (E.me().role === '현장소장' ? '검토대기입니다. 결재함에서 직접 검토·승인해 주세요.' : '공무 검토를 기다립니다.')), true);
      });
    });
  }
  $('fDraft').onclick = function () { saveForm(false); };
  $('fSubmit').onclick = function () { saveForm(true); };
})();
