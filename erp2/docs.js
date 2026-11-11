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
  function pane(name) { show('dList', name === 'list'); show('dDetail', name === 'detail'); show('dForm', name === 'form'); window.scrollTo(0, 0); setTimeout(fitAll, 0); }
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


  // ── 갑지(A4 기안문) ──
  var CATS = {
    품의: [['현장품의', '현장품의 — 하도급 기성·자재 반입 검수', '[현장품의] 하도급 기성 / 자재 반입 검수 품의'], ['본사품의', '본사품의 — 본사 예산·구매·외주·경비', '[본사품의] 본사 예산·구매·외주·현장경비 발의'], ['변경품의', '변경품의 — 실정보고·설계변경 승인', '[변경품의] 현장 실정보고 및 설계변경 승인 품의']],
    공문: [['본사문서', '본사문서 — 업무연락·현황보고·일반공문', '[본사문서] 본사 업무연락 / 현황보고 / 일반공문'], ['대관공문', '대관공문 — 감리단·국가철도공단', '[대관공문] 감리단 / 국가철도공단 대관 발신공문'], ['안전점검', '안전점검 — 작업계획서·재해예방 점검', '[안전점검] 안전관리 / 작업계획서 / 재해예방 점검 보고'], ['기타', '기타 — 대외협조·민원회신·일반', '[기타항목] 대외협조 / 민원회신 / 기타 일반문서']] };
  var MGR_NAME = '임석인';
  function catLong(kind, cat) { var l = CATS[kind] || []; for (var k = 0; k < l.length; k++) if (l[k][0] === cat) return l[k][2]; return ''; }
  function mmdd(s) { s = String(s || ''); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(5, 10).replace('-', '/') : ''; }
  function dots(s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? m[1] + '. ' + m[2] + '. ' + m[3] + '.' : ''; }
  function ph(text) { return el('span', 'gj-ph', text); }
  // 스캔 도장(서버가 로그인한 직원에게만 전달). 없거나 실패하면 글자 도장을 그대로 쓴다.
  var STAMPS = null, stampsLoading = null;
  function loadStamps() {
    if (stampsLoading) return stampsLoading;
    stampsLoading = E.api('getStamps', {}, 20000).then(function (r) { STAMPS = (r && r.ok && r.stamps) ? r.stamps : {}; return STAMPS; }, function () { STAMPS = {}; return STAMPS; });
    return stampsLoading;
  }
  function stampImg(name) {
    var im = document.createElement('img'); im.src = 'data:image/png;base64,' + STAMPS[name]; im.alt = '도장 ' + name;
    im.style.cssText = 'width:56px;height:56px;display:block;margin:0 auto'; return im;
  }
  E.resetStamps = function () { STAMPS = null; stampsLoading = null; };
  function seal(role, name) { if (STAMPS && STAMPS[name]) return stampImg(name);
    var s = el('span', 'gj-seal'); s.appendChild(el('small', '', role)); s.appendChild(document.createTextNode(String(name || '').slice(0, 4))); return s; }
  function gjBox(color, bg, l1, l2) { var b = el('span', 'gj-box'); b.style.color = color; b.style.background = bg; b.appendChild(document.createTextNode(l1)); if (l2) { b.appendChild(document.createElement('br')); b.appendChild(el('small', '', l2)); } return b; }

  /** 저장된 문서 → 갑지에 들어갈 값 */
  function sheetOfItem(i) {
    return { kind: i.kind, docNo: i.docNo, date: i.date, cat: i.cat, party: i.party, title: i.title, amount: i.amount, summary: i.summary, attach: i.attach, author: i.author, status: i.status,
      drafted: i.status === '검토대기' || i.status === '승인대기' || i.status === '확정', approver: i.status === '확정' ? i.approver : '', approvedAt: i.approvedAt,
      hq: i.hq || {}, mgr: (i.status === '확정' && i.approver) || MGR_NAME, files: i.files || [], seal: i.seal || '' };
  }
  /** 쓰는 중인 양식 → 갑지에 들어갈 값 (아직 제출 전이므로 도장은 모두 비어 있다) */
  function sheetOfForm() {
    var v = collect(), me = E.me();
    return { kind: F.kind, docNo: F.docNo || ((next[F.kind] || '') + ' (예정)'), date: v.date, cat: v.cat, party: v.party, title: v.title, amount: v.amount, summary: v.summary, attach: v.attach,
      author: F.author || (me ? me.name : ''), status: '작성중', drafted: false, approver: '', approvedAt: '', hq: {}, mgr: MGR_NAME, files: formFiles(), seal: '' };
  }

  function buildSheet(m) {
    var S = el('div', 'gj-sheet');
    S.appendChild(el('div', 'gj-site', '[현장명: 호남고속선 정읍~광주송정 등 28개소 재해예방공사]'));
    S.appendChild(el('h2', 'gj-head', m.kind === '품의' ? '품 의 서 (기 안 문 갑 지)' : '공 문 (발 신 기 안 갑 지)'));
    var top = el('div', 'gj-top'); S.appendChild(top);

    var meta = el('table', 'gj-meta'); top.appendChild(meta);
    function mrow(k, v) { var tr = meta.appendChild(el('tr')); tr.appendChild(el('th', '', k)); var td = tr.appendChild(el('td')); if (v) td.textContent = v; else td.appendChild(ph('-')); }
    mrow('문서번호', m.docNo); mrow('발신일자', dots(m.date)); mrow('문서구분', m.cat ? '[' + m.cat + ']' : '');

    // 결재란: 기안(작성자) · 현장소장(승인) · 본사 제출 · 부사장(=본사 확인) · 회장
    var st = el('table', 'gj-stamp'); top.appendChild(st);
    var r1 = st.appendChild(el('tr')), r2 = st.appendChild(el('tr')), r3 = st.appendChild(el('tr'));
    var lab = el('th', '', '결\n재'); lab.rowSpan = 3; lab.style.width = '28px'; lab.style.whiteSpace = 'pre'; r1.appendChild(lab);
    [['기 안', '(작성자)'], ['현장소장', '(현장대리인)'], ['부사장', '(본사 확인)'], ['회 장', '(본사 결재)']].forEach(function (h) {
      var th = el('th', '', h[0]); th.appendChild(el('small', '', h[1])); r1.appendChild(th);
    });
    function cell(row, node, cls) { var td = row.appendChild(el('td', cls || '')); td.appendChild(node); return td; }
    var hq = m.hq || {};
    // 기안
    // 기안 칸: 작성자가 직접 올린 도장이 있을 때만 찍는다(없으면 공란)
    if (m.drafted && STAMPS && STAMPS[m.author]) { cell(r2, stampImg(m.author)); cell(r3, document.createTextNode(mmdd(m.date)), 'gj-date'); }
    else { cell(r2, ph(' ')); cell(r3, ph(' '), 'gj-date'); }
    // 현장소장
    if (m.approver) { cell(r2, seal('현장소장', m.approver)); cell(r3, document.createTextNode(mmdd(m.approvedAt)), 'gj-date'); }
    else { cell(r2, ph(m.status === '승인대기' ? '승인대기' : '미날인')); cell(r3, ph(' '), 'gj-date'); }
    // 부사장 = 본사 확인
    if (hq.state === '확인') { cell(r2, gjBox('#15803d', '#f0fdf4', '확인', hq.by)); cell(r3, document.createTextNode(mmdd(hq.at)), 'gj-date'); }
    else { cell(r2, ph(hq.state === '제출' ? '회신대기' : '서명')); cell(r3, ph(' '), 'gj-date'); }
    // 회장
    cell(r2, ph('서명')); cell(r3, ph(' '), 'gj-date');

    var body = el('table', 'gj-body'); S.appendChild(body);
    function brow(k, sub, fill, style) {
      var tr = body.appendChild(el('tr')); var th = tr.appendChild(el('th', '')); th.appendChild(document.createTextNode(k)); if (sub) th.appendChild(el('small', '', sub));
      var td = tr.appendChild(el('td')); fill(td); if (style) for (var x in style) td.style[x] = style[x]; return tr;
    }
    function txt(v, empty) { return function (td) { if (v) td.textContent = v; else if (empty) td.appendChild(ph(empty)); }; }
    brow('수 신 처', '', txt(m.party || (m.kind === '품의' ? '회장' : ''), '(수신처 미입력)'));
    brow('제 목', '', txt(m.title, '(제목 미입력)'), { fontWeight: '800', fontSize: '13.5px' });
    if (m.kind === '품의') brow('집행금액', '', txt(m.amount), { fontWeight: '700', color: '#1d4ed8', height: '28px' });
    var sr = brow(m.kind === '품의' ? '기안요약' : '발신요약', '(표준갑지)', txt(m.summary, '(본문 요지 미입력)'), { height: '155px', verticalAlign: 'top', whiteSpace: 'pre-wrap', lineHeight: '1.65', padding: '12px' });
    sr.firstChild.style.verticalAlign = 'top'; sr.firstChild.style.paddingTop = '14px';
    var files = m.files || [];
    brow(m.kind === '공문' ? '붙 임' : '붙임/첨부', '', function (td) {
      if (m.attach) td.textContent = m.attach; else if (!files.length) td.appendChild(ph('(없음)'));
      if (files.length) {
        var ft = el('table', 'gj-files'); td.appendChild(ft);
        var hr = ft.appendChild(el('tr')); ['No', '파일명', '크기', 'SHA-256'].forEach(function (h) { hr.appendChild(el('th', '', h)); });
        files.forEach(function (f, k) {
          var tr = ft.appendChild(el('tr')); tr.appendChild(el('td', '', String(k + 1))); tr.appendChild(el('td', '', f.name)); tr.appendChild(el('td', '', fmtSize(f.size)));
          tr.appendChild(el('td', 'hx', f.sha || '계산 중…'));
        });
      }
    }, { padding: '8px 10px' });

    // 품의는 회사 안(본사)으로 올리는 문서라 회사명을 빼고, 공문은 밖으로 나가므로 회사명을 쓴다
    var f = el('div', 'gj-foot', ((m.kind === '품의' && m.cat === '본사품의') ? '' : '(주)동우건설 ') + '호남고속선 재해예방공사 현장 현장소장 ' + (m.mgr || MGR_NAME)); S.appendChild(f);
    if (m.seal) S.appendChild(el('div', 'gj-sealline', '문서 SHA-256 봉인(확정 시): ' + m.seal));
    return S;
  }
  /** 화면 너비에 맞춰 줄인다(숨은 화면은 건너뛴다) */
  function fit(wrap) {
    var S = wrap.firstChild; if (!S) return; var w = wrap.clientWidth; if (!w) return;
    var sc = Math.min(1, w / 794); S.style.transform = 'scale(' + sc + ')'; wrap.style.height = Math.ceil(S.offsetHeight * sc) + 'px';
  }
  function fitAll() { var a = document.querySelectorAll('.gj-wrap'); for (var k = 0; k < a.length; k++) fit(a[k]); }
  window.addEventListener('resize', fitAll);
  function paintSheet(host, m) {
    host.textContent = ''; var wrap = el('div', 'gj-wrap'); wrap.appendChild(buildSheet(m)); host.appendChild(wrap);
    fit(wrap); setTimeout(fitAll, 0);
    // 확정된 문서(현장소장 도장 칸이 있는 갑지)는 도장 이미지를 처음 한 번 받아 온 뒤 다시 그린다
    if ((m.approver || m.drafted) && STAMPS === null) {
      var tok = host._gjTok = {};
      loadStamps().then(function (st) { if (host._gjTok === tok && (st[m.approver] || st[m.author])) paintSheet(host, m); });
    }
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
  E.onLeave.push(function () { items = []; next = {}; F = null; filter = 'all'; query = ''; $('dItems').textContent = ''; $('dDetail').textContent = ''; $('dSum').textContent = ''; $('dSearch').value = ''; $('dPrev').textContent = ''; $('dFileList').textContent = ''; });

  // ── 목록 ──
  function openList() { E.showView('vDoc'); pane('list'); buildFilters(); load(); loadDrafts(); }
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

  // ── 자동 초안(초안함): 공무·현장소장에게만 보인다 ──
  function loadDrafts() {
    var box = $('dDrafts'); box.textContent = '';
    if (!isGm()) return;
    E.api('listDrafts', {}, 20000).then(function (r) {
      box.textContent = '';
      if (!r || !r.ok || !r.items || !r.items.length) return;
      var wrap = el('div', 'panel'); wrap.style.cssText = 'background:#fffbeb;border:1px solid #f59e0b;margin:8px 0';
      wrap.appendChild(el('div', '', '자동 작성된 초안 ' + r.items.length + '건 — 확인 후 「문서로 만들기」를 누르면 번호가 발급됩니다.')).style.fontWeight = '700';
      r.items.forEach(function (it) {
        var card = el('div'); card.style.cssText = 'margin-top:8px;padding-top:8px;border-top:1px dashed #f59e0b';
        card.appendChild(el('div', '', '[' + it.kind + (it.cat ? ' · ' + it.cat : '') + '] ' + it.title)).style.fontWeight = '700';
        card.appendChild(el('div', 'desc', (it.party ? (it.kind === '접수' ? '보낸 곳: ' : '수신: ') + it.party + ' · ' : '') + (it.amount ? '집행금액: ' + it.amount + ' · ' : '') + (it.due ? '회신기한: ' + it.due + ' · ' : '') + (it.files ? '원본파일 ' + it.files + '건 · ' : '') + '등록 ' + it.created));
        var det = el('details'); det.appendChild(el('summary', '', '내용 보기'));
        var pre = el('div', '', it.summary); pre.style.cssText = 'white-space:pre-wrap;font-size:13px;line-height:1.6;margin:6px 0'; det.appendChild(pre);
        if (it.attach) det.appendChild(el('div', 'desc', '붙임: ' + it.attach));
        card.appendChild(det);
        var row = el('div'); row.style.marginTop = '6px';
        var ok = el('button', 'sm', '문서로 만들기'); ok.type = 'button';
        var no = el('button', 'sm', '버리기'); no.type = 'button'; no.style.marginLeft = '6px';
        ok.onclick = function () {
          ok.disabled = no.disabled = true;
          E.api('importDraft', { id: it.id }, 60000).then(function (x) {
            if (E.authLost(x)) return;
            if (!x.ok) { ok.disabled = no.disabled = false; setMsg('dMsg', x.message || '문서를 만들지 못했습니다.'); return; }
            setMsg('dMsg', '「' + x.item.docNo + '」 문서를 만들었습니다.' + (it.kind === '접수' ? ' 접수 상태로 대장에 올랐습니다.' : ' 작성중 상태이니 열어서 고친 뒤 제출하세요.') + (x.warn && x.warn.length ? ' (경고: ' + [].concat(x.warn).join(' ') + ')' : ''), true);
            load(); loadDrafts();
          });
        };
        no.onclick = function () {
          if (!window.confirm('이 초안을 버릴까요? (시트에는 기록이 남습니다)')) return;
          ok.disabled = no.disabled = true;
          E.api('discardDraft', { id: it.id }, 20000).then(function (x) { if (E.authLost(x)) return; if (!x.ok) { ok.disabled = no.disabled = false; setMsg('dMsg', x.message || '실패했습니다.'); return; } loadDrafts(); });
        };
        row.appendChild(ok); row.appendChild(no); card.appendChild(row); wrap.appendChild(card);
      });
      box.appendChild(wrap);
    });
  }

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
      if (i.files && i.files.length) r3.appendChild(el('span', 'st st-접수', '첨부 ' + i.files.length));
      if (ri) r3.appendChild(el('span', 'st ' + (ri.late ? 'st-반려' : 'st-검토대기'), ri.late ? '회신 ' + (-ri.days) + '일 지연' : ri.days === 0 ? '오늘 회신기한' : '회신 D-' + ri.days));
      if (i.kind !== '품의' && i.replied) r3.appendChild(el('span', 'st st-승인', '회신 완료'));
      if (needsMe(i)) r3.appendChild(el('span', 'st st-검토대기', '내 차례'));
      c.appendChild(r1); c.appendChild(r2); if (r3.childNodes.length) c.appendChild(r3);
      c.onclick = function () { showDetail(i); };
      c.onkeydown = function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); showDetail(i); } };
      box.appendChild(c);
    });
  }

  // ── 첨부파일: 크기·종류·SHA-256 ──
  var MAX_FILES = 10, MAX_BYTES = 8 * 1024 * 1024;
  var EXTS = ['hwp', 'hwpx', 'xlsx', 'xls', 'docx', 'doc', 'pptx', 'ppt', 'pdf', 'jpg', 'jpeg', 'png', 'zip', 'dwg', 'dxf', 'txt', 'csv'];
  function fmtSize(n) { n = Number(n) || 0; return n >= 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB'; }
  function extOf(name) { var m = /\.([A-Za-z0-9]{1,6})$/.exec(String(name || '')); return m ? m[1].toLowerCase() : ''; }
  function hex(buf) { var a = new Uint8Array(buf), s = ''; for (var k = 0; k < a.length; k++) s += (a[k] < 16 ? '0' : '') + a[k].toString(16); return s; }
  function canHash() { return !!(window.crypto && window.crypto.subtle); }
  function readBuf(file) {
    return new Promise(function (ok, no) { var r = new FileReader(); r.onload = function () { ok(r.result); }; r.onerror = function () { no(r.error); }; r.readAsArrayBuffer(file); });
  }
  function sha256Of(buf) { return window.crypto.subtle.digest('SHA-256', buf).then(hex); }
  function toB64(buf) {
    var a = new Uint8Array(buf), s = '', step = 0x8000;
    for (var k = 0; k < a.length; k += step) s += String.fromCharCode.apply(null, a.subarray(k, k + step));
    return btoa(s);
  }
  function fromB64(b64) { var bin = atob(b64), a = new Uint8Array(bin.length); for (var k = 0; k < bin.length; k++) a[k] = bin.charCodeAt(k); return a; }


  // ── 첨부 미리보기 (PDF·이미지) ──
  var PREVIEW_MIME = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };
  function previewable(name) { return !!PREVIEW_MIME[extOf(name)]; }
  var PV = null; // { url }
  function closePreview() { var m = $('pvModal'); if (m) m.remove(); if (PV && PV.url) { try { URL.revokeObjectURL(PV.url); } catch (e) {} } PV = null; }
  function openPreview(name, blob) {
    closePreview();
    var ext = extOf(name), url = URL.createObjectURL(blob); PV = { url: url };
    if (ext === 'pdf' && /Android|iPhone|iPad/i.test(navigator.userAgent)) { window.open(url, '_blank'); return; } // 모바일 브라우저는 iframe PDF를 못 그리므로 새 탭으로
    var m = el('div'); m.id = 'pvModal'; m.className = 'pv-modal';
    var head = el('div', 'pv-head'); head.appendChild(el('span', 'pv-title', name));
    var dl = el('button', 'sm', '내려받기'); dl.type = 'button'; dl.onclick = function () { var a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); };
    var x = el('button', 'sm', '닫기'); x.type = 'button'; x.onclick = closePreview;
    head.appendChild(dl); head.appendChild(x); m.appendChild(head);
    var body = el('div', 'pv-body');
    if (ext === 'pdf') { var fr = document.createElement('iframe'); fr.src = url + '#toolbar=1&view=FitH'; fr.title = name; body.appendChild(fr); }
    else { var im = document.createElement('img'); im.src = url; im.alt = name; body.appendChild(im); }
    m.appendChild(body);
    m.onclick = function (ev) { if (ev.target === m) closePreview(); };
    document.body.appendChild(m);
  }
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && PV) closePreview(); });
  /** 이미지 파일의 작은 썸네일(양식·상세 목록용). PDF는 아이콘. */
  function thumbOf(name, blobOrNull) {
    var ext = extOf(name), t = el('span', 'th');
    if (blobOrNull && (ext === 'jpg' || ext === 'jpeg' || ext === 'png')) { var im = document.createElement('img'); im.src = URL.createObjectURL(blobOrNull); im.onload = function () { URL.revokeObjectURL(im.src); }; t.appendChild(im); }
    else t.textContent = ext === 'pdf' ? 'PDF' : (ext === 'jpg' || ext === 'jpeg' || ext === 'png') ? 'IMG' : ext.toUpperCase().slice(0, 4);
    return t;
  }
  /** 저장된 첨부를 받아 확인값을 검사한 뒤 미리보기로 연다. */
  function previewSaved(docId, f) {
    if (busy) return; busy = true;
    E.api('getDocFile', { id: docId, n: f.n }, 120000).then(function (r) {
      busy = false;
      if (E.authLost(r)) return;
      if (!r || !r.ok) { window.alert((r && r.message) || '파일을 받지 못했습니다.'); return; }
      var bytes = fromB64(r.data);
      sha256Of(bytes.buffer).then(function (h) {
        if (h !== f.sha) { window.alert('⚠ 「' + f.name + '」의 SHA-256이 기록된 값과 다릅니다. 파일이 바뀌었을 수 있어 열지 않았습니다.'); return; }
        openPreview(f.name, new Blob([bytes], { type: PREVIEW_MIME[extOf(f.name)] || 'application/octet-stream' }));
      });
    });
  }
  /** 양식에서 지금 붙어 있을(저장이 끝나면) 파일 목록 — 갑지 미리보기용 */
  function formFiles() {
    if (!F) return [];
    var out = (F.have || []).filter(function (f) { return F.drop.indexOf(f.n) < 0; }).map(function (f) { return { name: f.name, size: f.size, sha: f.sha }; });
    (F.pend || []).forEach(function (p) { out.push({ name: p.name, size: p.size, sha: p.sha || '' }); });
    return out;
  }
  function fileCount() { return formFiles().length; }
  function drawFiles() {
    var box = $('dFileList'); box.textContent = '';
    (F.have || []).forEach(function (f) {
      var gone = F.drop.indexOf(f.n) >= 0;
      var r = el('div', 'fr' + (gone ? ' gone' : '')); r.appendChild(thumbOf(f.name, null)); var nm = el('span', 'nm', f.name); nm.appendChild(el('span', 'sub', fmtSize(f.size) + ' · SHA-256 ' + String(f.sha).slice(0, 16) + '…' + (gone ? ' · 저장하면 삭제됩니다' : '')));
      r.appendChild(nm);
      if (previewable(f.name) && F.id) { var pv = el('button', '', '미리보기'); pv.type = 'button'; pv.onclick = function () { previewSaved(F.id, f); }; r.appendChild(pv); }
      var b = el('button', '', gone ? '되돌리기' : '삭제'); b.type = 'button';
      b.onclick = function () { var at = F.drop.indexOf(f.n); if (at >= 0) F.drop.splice(at, 1); else F.drop.push(f.n); drawFiles(); drawPrev(); };
      r.appendChild(b); box.appendChild(r);
    });
    (F.pend || []).forEach(function (p) {
      var r = el('div', 'fr'); r.appendChild(thumbOf(p.name, p.file)); var nm = el('span', 'nm', p.name); nm.appendChild(el('span', 'sub', fmtSize(p.size) + ' · ' + (p.sha ? 'SHA-256 ' + p.sha.slice(0, 16) + '…' : '확인값 계산 중…') + ' · 저장하면 올라갑니다'));
      r.appendChild(nm);
      if (previewable(p.name)) { var pv = el('button', '', '미리보기'); pv.type = 'button'; pv.onclick = function () { openPreview(p.name, p.file); }; r.appendChild(pv); }
      var b = el('button', '', '빼기'); b.type = 'button';
      b.onclick = function () { var at = F.pend.indexOf(p); if (at >= 0) F.pend.splice(at, 1); drawFiles(); drawPrev(); };
      r.appendChild(b); box.appendChild(r);
    });
  }
  function pickFiles(list) {
    var bad = [];
    for (var k = 0; k < list.length; k++) {
      var f = list[k];
      if (EXTS.indexOf(extOf(f.name)) < 0) { bad.push(f.name + ' (올릴 수 없는 종류)'); continue; }
      if (!f.size) { bad.push(f.name + ' (빈 파일)'); continue; }
      if (f.size > MAX_BYTES) { bad.push(f.name + ' (' + fmtSize(f.size) + ' — 8MB 초과)'); continue; }
      if (fileCount() >= MAX_FILES) { bad.push(f.name + ' (최대 ' + MAX_FILES + '개)'); continue; }
      if (formFiles().some(function (x) { return x.name === f.name && x.size === f.size; })) { bad.push(f.name + ' (이미 있음)'); continue; }
      (function (file) {
        var p = { file: file, name: file.name, size: file.size, sha: '' }; F.pend.push(p);
        readBuf(file).then(sha256Of).then(function (h) { p.sha = h; }, function () { p.err = true; }).then(function () {
          if (p.err) { var at = F.pend.indexOf(p); if (at >= 0) F.pend.splice(at, 1); setMsg('dFMsg', file.name + ' 파일을 읽지 못했습니다.'); }
          if (F) { drawFiles(); drawPrev(); }
        });
      })(f);
    }
    if (bad.length) setMsg('dFMsg', '붙이지 못한 파일:\n' + bad.join('\n')); else setMsg('dFMsg', '');
    if (!$('dAttach').value.trim() && F.pend.length) $('dAttach').value = F.pend.map(function (p) { return p.name; }).join(', ').slice(0, 200);
    drawFiles(); drawPrev();
  }
  $('dFileIn').onchange = function () {
    var list = Array.prototype.slice.call(this.files || []); this.value = '';
    if (!F || !list.length) return;
    if (!canHash()) { setMsg('dFMsg', '이 브라우저에서는 파일 확인값(SHA-256)을 만들 수 없어 파일을 붙일 수 없습니다. 최신 크롬·엣지·사파리에서 열어 주세요.'); return; }
    pickFiles(list);
  };
  /** 저장이 끝난 문서에 파일을 하나씩 올리고(삭제 먼저) 결과를 돌려준다: cb(실패 문구들, 마지막 문서, 로그인 끊김 여부) */
  function syncFiles(item, cb) {
    var jobs = [];
    F.drop.forEach(function (n) { jobs.push({ del: n }); });
    F.pend.forEach(function (p) { jobs.push({ up: p }); });
    if (!jobs.length) { cb([], item, false); return; }
    var fails = [], k = 0, cur = item;
    function step() {
      if (k >= jobs.length) { cb(fails, cur, false); return; }
      var j = jobs[k++], label = j.up ? j.up.name : '삭제';
      setMsg('dFMsg', '첨부 처리 중 (' + k + '/' + jobs.length + ') ' + label + ' …', true);
      var done = function (r, what) {
        if (E.authLost(r)) { cb(fails, cur, true); return; }
        if (r && r.ok) cur = r.item; else fails.push(what + ': ' + ((r && r.message) || '처리하지 못했습니다.'));
        step();
      };
      if (j.del) { E.api('deleteDocFile', { id: item.id, n: j.del }, 30000).then(function (r) { done(r, '파일 삭제'); }); return; }
      var p = j.up;
      if (!p.sha) { fails.push(p.name + ': 확인값이 아직 계산되지 않았습니다.'); step(); return; }
      readBuf(p.file).then(function (buf) { return E.api('uploadDocFile', { id: item.id, name: p.name, sha: p.sha, data: toB64(buf) }, 180000); }, function () { return { ok: false, message: '파일을 읽지 못했습니다.' }; })
        .then(function (r) { done(r, p.name); });
    }
    step();
  }
  function saveBlob(name, bytes) {
    var url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
    var a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  function downloadFile(i, f) {
    if (busy) return; busy = true; setMsg('dDMsg', f.name + ' 내려받는 중…', true);
    E.api('getDocFile', { id: i.id, n: f.n }, 120000).then(function (r) {
      if (fail('dDMsg', r)) { busy = false; return; }
      if (!r.ok) { busy = false; return; }
      var bytes = fromB64(r.data);
      sha256Of(bytes.buffer).then(function (h) {
        busy = false;
        if (h !== f.sha) { setMsg('dDMsg', '⚠ 내려받은 「' + f.name + '」의 SHA-256이 기록된 값과 다릅니다. 파일이 바뀌었을 수 있어 저장하지 않았습니다.'); return; }
        saveBlob(f.name, bytes); setMsg('dDMsg', '「' + f.name + '」를 내려받았습니다. SHA-256이 기록과 같습니다.', true);
      });
    });
  }
  function verify(i) {
    if (busy) return; busy = true; setMsg('dDMsg', '확인하는 중… (첨부파일을 다시 계산합니다)', true);
    E.api('verifyDoc', { id: i.id }, 120000).then(function (r) {
      busy = false;
      if (fail('dDMsg', r)) return;
      if (!r.ok) return;
      var bad = [];
      if (!r.sealOk) bad.push('문서 내용이 확정 때와 다릅니다');
      r.files.forEach(function (f) { if (f.missing) bad.push('첨부 「' + f.name + '」 파일이 드라이브에 없습니다'); else if (!f.ok) bad.push('첨부 「' + f.name + '」 내용이 확정 때와 다릅니다'); });
      if (!bad.length) setMsg('dDMsg', '무결성 확인: 문서 내용과 첨부 ' + r.files.length + '개가 확정 때와 같습니다.', true);
      else setMsg('dDMsg', '⚠ 달라진 곳이 있습니다.\n' + bad.join('\n'));
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
    if (i.gapji) kvLink(p, '갑지 PDF', '갑지 PDF 열기', i.gapji);
    if (i.pdf) kvLink(p, '확정본', '확정 PDF 열기', i.pdf);
    kv(p, '작성', i.author + ' · ' + i.created);
    if (i.reviewer && (i.status === '승인대기' || i.status === '확정')) kv(p, '검토', i.reviewer + ' · ' + i.reviewedAt);
    if (i.approver && i.status === '확정') kv(p, '승인', i.approver + ' · ' + i.approvedAt);
    if (i.hq && i.hq.state) kv(p, '본사', '본사 ' + i.hq.state + ' · ' + i.hq.by + ' · ' + String(i.hq.at).slice(0, 16) + (i.hq.state === '확인' && i.hq.submitAt ? ' (제출 ' + String(i.hq.submitAt).slice(0, 16) + ')' : '') + (i.hq.note ? ' · ' + i.hq.note : ''));
    if (i.mail) kv(p, '본사 메일', String(i.mail.at).slice(0, 16) + ' · ' + i.mail.by + ' → ' + String(i.mail.to).replace(/,/g, ', ') + ' (첨부 ' + i.mail.n + '건)');
    if (i.note) kv(p, '비고', i.note);
    var fbox = null;
    if (i.files && i.files.length) { p.appendChild(el('div', 'desc', '첨부파일 ' + i.files.length + '개 (파일마다 SHA-256 기록)')).style.marginTop = '10px'; fbox = el('div', 'fl'); p.appendChild(fbox); }

    if (i.kind !== '접수' && i.status !== '결번') {
      var sp = el('div', 'panel'); sp.id = 'dDSheet'; box.appendChild(sp);
      sp.appendChild(el('h3', '', '갑지 (A4 기안문)')); var host = el('div'); sp.appendChild(host); paintSheet(host, sheetOfItem(i));
    }
    var area = el('div'); p.appendChild(area);
    if (fbox) i.files.forEach(function (f) {
      var r = el('div', 'fr'); r.appendChild(thumbOf(f.name, null)); var nm = el('span', 'nm', f.name); nm.appendChild(el('span', 'sub', fmtSize(f.size) + ' · SHA-256 ' + String(f.sha).slice(0, 16) + '… · ' + f.by));
      r.appendChild(nm);
      if (previewable(f.name)) { var pv = el('button', '', '미리보기'); pv.type = 'button'; pv.onclick = function () { previewSaved(i.id, f); }; r.appendChild(pv); }
      var b = el('button', '', '내려받기'); b.type = 'button'; b.onclick = function () { downloadFile(i, f); }; r.appendChild(b); fbox.appendChild(r);
    });
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
        showDetail(r.item, okText + ((r.warn && r.warn.length) ? '\n※ ' + r.warn.join(' ') : ''));
      });
    }
    /** 사유·메모를 적는 칸을 버튼 자리에 연다 */
    function noteBox(label, placeholder, required, cls, fn) {
      btns.textContent = ''; var t = el('textarea'); t.id = 'dDNote'; t.rows = 2; t.maxLength = 200; t.placeholder = placeholder;
      var w = el('div'); w.style.width = '100%'; w.appendChild(t); btns.appendChild(w);
      btn('취소', '', function () { showDetail(i); });
      btn(label, cls, function () { var v = t.value.trim(); if (required && v.length < 2) { setMsg('dDMsg', '내용을 2자 이상 적어 주세요.'); return; } fn(v); });
    }
    /** 본사로 메일 보내기: 먼저 서버가 만든 제목·본문·첨부 목록을 보여 주고, 확인한 뒤에만 보낸다 */
    function mailBox() {
      if (busy) return; busy = true; setMsg('dDMsg', '메일 내용을 불러오는 중…', true);
      E.api('mailPreview', { id: i.id }, 30000).then(function (pv) {
        busy = false;
        if (fail('dDMsg', pv)) return;
        if (!pv.ok) return;
        setMsg('dDMsg', '');
        btns.textContent = '';
        var w = el('div', 'mailbox'); w.style.width = '100%'; btns.appendChild(w);
        w.appendChild(el('b', '', '본사로 메일 보내기 — 보내기 전에 확인하세요'));
        w.appendChild(el('label', '', '받는 사람'));
        var to = el('input'); to.type = 'text'; to.id = 'dMailTo'; to.value = pv.to; to.maxLength = 200; to.disabled = !pv.canEditTo; w.appendChild(to);
        w.appendChild(el('div', 'hint', pv.canEditTo ? '기본은 본사입니다. 바꾸려면 메일 주소를 쉼표로 구분해 ' + pv.maxTo + '명까지 적을 수 있습니다.' : '받는 사람은 현장소장만 바꿀 수 있습니다.'));
        w.appendChild(el('label', '', '제목')); var sj = el('div', 'mailsub', pv.subject); sj.id = 'dMailSubject'; w.appendChild(sj);
        w.appendChild(el('label', '', '본문')); var bd = el('pre', 'mailbody', pv.body + pv.tail); bd.id = 'dMailBody'; w.appendChild(bd);
        w.appendChild(el('label', '', '추가 메모 (본문 끝에 덧붙입니다, 선택)')); var mm = el('textarea'); mm.id = 'dMailMemo'; mm.rows = 2; mm.maxLength = 300; mm.placeholder = '예: 금일 중 검토 부탁드립니다.'; w.appendChild(mm);
        w.appendChild(el('label', '', '첨부 ' + (pv.files.length + 1) + '건 (합계 약 ' + fmtSize(pv.totalBytes) + ' + 갑지 PDF, 한도 ' + fmtSize(pv.maxBytes) + ')'));
        var fl = el('div', 'fl'); fl.id = 'dMailFiles'; w.appendChild(fl);
        var r0 = el('div', 'fr'); var n0 = el('span', 'nm', pv.gapjiName); n0.appendChild(el('span', 'sub', '갑지 PDF (보낼 때 새로 만듭니다)')); r0.appendChild(n0); fl.appendChild(r0);
        pv.files.forEach(function (f) { var r = el('div', 'fr'); var n = el('span', 'nm', f.name); n.appendChild(el('span', 'sub', fmtSize(f.size) + ' · SHA-256 ' + f.sha)); r.appendChild(n); fl.appendChild(r); });
        var ready = true;
        if (pv.quota === null) { ready = false; w.appendChild(el('div', 'rej', '메일 보내기 권한이 아직 승인되지 않았습니다. 현장소장이 서버(Apps Script)에서 한 번 승인하면 보낼 수 있습니다.')); }
        else { w.appendChild(el('div', 'hint', '오늘 남은 발송 한도: ' + pv.quota + '건')); }
        var chk = null;
        if (pv.already) {
          w.appendChild(el('div', 'rej', '이미 ' + String(pv.already.at).slice(0, 16) + ' 에 ' + pv.already.by + ' 님이 ' + String(pv.already.to).replace(/,/g, ', ') + ' (으)로 보냈습니다.'));
          var lb = el('label', 'chk'); chk = el('input'); chk.type = 'checkbox'; chk.id = 'dMailResend'; lb.appendChild(chk); lb.appendChild(document.createTextNode(' 알고 있습니다. 다시 보냅니다.')); w.appendChild(lb);
        }
        var row = el('div', 'row-btns'); w.appendChild(row);
        var cancel = el('button', '', '취소'); cancel.type = 'button'; cancel.onclick = function () { showDetail(i); }; row.appendChild(cancel);
        var send = el('button', 'pri', '메일 보내기'); send.type = 'button'; send.id = 'dMailSend'; send.style.marginTop = '0'; send.disabled = !ready; row.appendChild(send);
        send.onclick = function () {
          if (busy) return;
          if (pv.already && !chk.checked) { setMsg('dDMsg', '이미 보낸 문서입니다. 다시 보내려면 「알고 있습니다」에 표시해 주세요.'); return; }
          var tt = to.value.trim() === String(pv.to) ? '' : to.value.trim();
          if (!window.confirm('「' + i.docNo + '」을(를) ' + (tt || pv.to) + ' (으)로 메일을 보냅니다.\n첨부 ' + (pv.files.length + 1) + '건. 보낸 메일은 되돌릴 수 없습니다. 보낼까요?')) return;
          busy = true; send.disabled = true; cancel.disabled = true; setMsg('dDMsg', '메일을 보내는 중… (첨부가 크면 1분 가까이 걸릴 수 있습니다)', true);
          var data = { id: i.id, memo: mm.value.trim() }; if (tt) data.to = tt; if (pv.already) data.confirmResend = true;
          E.api('sendHqMail', data, 120000).then(function (r) {
            busy = false; send.disabled = !ready; cancel.disabled = false;
            if (fail('dDMsg', r)) return;
            if (!r.ok) return;
            showDetail(r.item, '본사로 메일을 보냈습니다. (' + r.sent.to.join(', ') + ' · 첨부 ' + r.sent.n + '건)' + ((r.item.hq && r.item.hq.state === '제출') ? ' 본사 제출로 표시했습니다.' : '') + ((r.warn && r.warn.length) ? '\n※ ' + r.warn.join(' ') : ''));
          });
        };
      });
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
    if (i.kind !== '접수' && i.status === '확정' && isGm()) btn(i.mail ? '본사로 메일 다시 보내기' : '본사로 메일 보내기', i.mail ? '' : 'pri', mailBox).style.marginTop = '0';
    if (i.kind !== '접수' && i.status === '확정' && (mine || isGm())) btn(i.gapji ? '갑지 PDF 다시 만들기' : '갑지 PDF 만들기', '', function () { act('gapjiDoc', { id: i.id }, '갑지 PDF를 만들었습니다.'); });
    if (i.kind !== '접수' && i.status === '확정' && i.seal) btn('무결성 확인', '', function () { verify(i); });
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
    F = { kind: kind, id: item ? item.id : '', docNo: item ? item.docNo : '', author: item ? item.author : '', have: item ? (item.files || []).slice() : [], drop: [], pend: [] };
    var L = LABELS[kind];
    $('dFTitle').textContent = (item ? kind + ' 수정 · ' + item.docNo : kind + (kind === '접수' ? ' 등록' : ' 쓰기') + (next[kind] ? ' · ' + next[kind] : ''));
    $('dPartyL').textContent = L.party; $('dParty').placeholder = L.ph; $('dSummaryL').textContent = L.summary; $('dAttachL').textContent = L.attach;
    $('dDate').value = item ? item.date : todayStr();
    $('dParty').value = item ? item.party : ''; $('dTitle').value = item ? item.title : '';
    $('dRef').value = item ? item.ref : ''; $('dSummary').value = item ? item.summary : ''; $('dAttach').value = item ? item.attach : '';
    $('dDue').value = item ? item.due : ''; $('dNote').value = item ? item.note : '';
    var cats = CATS[kind] || [], sel = $('dCat'); sel.textContent = '';
    cats.forEach(function (c) { var o = el('option', '', c[1]); o.value = c[0]; sel.appendChild(o); });
    sel.value = item && item.cat ? item.cat : (cats.length ? cats[0][0] : '');
    $('dAmount').value = item ? item.amount : '';
    show('dCatWrap', kind !== '접수'); show('dAmountWrap', kind === '품의'); show('dPrevPanel', kind !== '접수');
    prevOpen = window.innerWidth >= 600; syncPrevToggle();
    show('dRefWrap', kind !== '접수'); show('dDueWrap', kind !== '품의'); show('dSubmit', kind !== '접수');
    $('dDraft').textContent = item && kind !== '접수' ? '저장' : L.draft;
    drawFiles(); setMsg('dFMsg', ''); pane('form'); drawPrev(); setTimeout(function () { $('dTitle').focus(); }, 30);
  }
  $('dNewP').onclick = function () { openForm('품의'); };
  $('dNewG').onclick = function () { openForm('공문'); };
  $('dNewR').onclick = function () { openForm('접수'); };
  $('dCancel').onclick = function () { pane('list'); };

  function collect() {
    return { id: F.id || undefined, kind: F.kind, date: $('dDate').value, party: $('dParty').value.trim(), title: $('dTitle').value.trim(), ref: $('dRef').value.trim(),
      summary: $('dSummary').value, attach: $('dAttach').value.trim(), due: $('dDue').value, note: $('dNote').value.trim(),
      cat: F.kind === '접수' ? '' : $('dCat').value, amount: F.kind === '품의' ? $('dAmount').value.trim() : '' };
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
      syncFiles(r.item, function (fails, cur, lost) {
        if (lost) { done(); return; }
        var fnote = fails.length ? '\n※ 첨부 ' + fails.length + '건을 처리하지 못했습니다:\n' + fails.join('\n') : '';
        if (!thenSubmit || fails.length) {
          done();
          showDetail(cur, (thenSubmit ? '저장했습니다. 첨부에 문제가 있어 제출하지 않았습니다. 「수정」에서 다시 올린 뒤 제출해 주세요. 번호 ' : '저장했습니다. 번호 ') + cur.docNo + (warn ? '\n※ ' + warn : '') + fnote);
          return;
        }
        E.api('submitDoc', { id: cur.id }, 40000).then(function (s) {
          done();
          if (E.authLost(s)) return;
          if (!s.ok) { showDetail(cur, '저장은 했지만 제출하지 못했습니다: ' + (s.message || '') + (warn ? '\n※ ' + warn : '')); return; }
          showDetail(s.item, (isMgr() ? '확정했습니다.' : '제출했습니다.') + ' 번호 ' + s.item.docNo + (warn ? '\n※ ' + warn : '') + ((s.warn && s.warn.length) ? '\n※ ' + s.warn.join(' ') : ''));
        });
      });
    });
  }
  // ── 쓰는 대로 갑지 미리보기 ──
  var prevOpen = true;
  function syncPrevToggle() { $('dPrevToggle').textContent = prevOpen ? '접기' : '펼치기'; $('dPrev').classList.toggle('hide', !prevOpen); }
  function drawPrev() { if (!F || F.kind === '접수' || !prevOpen) return; paintSheet($('dPrev'), sheetOfForm()); }
  $('dPrevToggle').onclick = function () { prevOpen = !prevOpen; syncPrevToggle(); drawPrev(); };
  ['input', 'change'].forEach(function (ev) { $('dForm').addEventListener(ev, function () { drawPrev(); }); });
  $('dDraft').onclick = function () { save(false); };
  $('dSubmit').onclick = function () { save(true); };
})();
