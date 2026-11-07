/* 월 마감 점검 + 본사 제출 엑셀(.xlsx) — 외부 라이브러리 없이 직접 만든다.
 * 이전 ERP에서 쓰던 엑셀 모양(지불요청서·경비상세·비목별·개소별·마감점검)을 그대로 옮겼다.
 * 작업일보(투입내역)는 4단계에서 추가한다.
 * 화면 점검 목록과 엑셀이 같은 값을 쓰도록 계산은 buildClose 한 곳에서 한다. */
(function (root) {
  'use strict';

  var num = function (n) { n = Number(n); return isFinite(n) ? n : 0; };
  var pad2 = function (n) { return (n < 10 ? '0' : '') + n; };
  var won = function (n) { return Math.round(num(n)).toLocaleString('ko-KR') + '원'; };

  function monthEnd(ym) { var y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)); return ym + '-' + pad2(new Date(Date.UTC(y, m, 0)).getUTCDate()); }
  function sum(list, k) { return list.reduce(function (a, e) { return a + num(e[k]); }, 0); }
  function siteLabel(master, no) {
    no = Number(no);
    if (!no) return '공통 (개소 없음)';
    var s = (master.sites || []).filter(function (x) { return x.no === no; })[0];
    return s ? (s.code + ' · ' + s.route + ' ' + s.location) : ('개소' + no);
  }
  function hasReceipt(e) { return (e.receipts || []).length > 0; }

  /** 한 달치 점검 결과와 엑셀 원본 값.
   * monthItems: 이 달 청구분 전체(삭제 제외, 모든 상태) / cumItems: 착공부터 이 달까지 승인된 경비 */
  function buildClose(opt) {
    var ym = opt.ym, master = opt.master, closed = opt.closed || null;
    var all = opt.monthItems || [];
    var items = all.filter(function (e) { return e.status === '승인'; }).sort(function (a, b) { return (a.date + a.id) < (b.date + b.id) ? -1 : 1; });
    var pendingItems = all.filter(function (e) { return e.status !== '승인'; });
    var cum = opt.cumItems || [];
    var late = items.filter(function (e) { return e.late; });
    var totals = { supply: sum(items, 'supply'), vat: sum(items, 'vat'), total: sum(items, 'total') };
    var noRec = items.filter(function (e) { return !hasReceipt(e); });

    var pendBy = {};
    pendingItems.forEach(function (e) { pendBy[e.status] = (pendBy[e.status] || 0) + 1; });

    var defs = master.execBudget || [];
    var budRows = defs.map(function (d) {
      var inM = items.filter(function (e) { return d.items.indexOf(e.budget) !== -1; });
      var inC = cum.filter(function (e) { return d.items.indexOf(e.budget) !== -1; });
      return { label: d.label, items: d.items, budget: d.budget, month: sum(inM, 'supply'), cum: sum(inC, 'supply') };
    });
    var known = [].concat.apply([], defs.map(function (d) { return d.items; }));
    var unkMonth = items.filter(function (e) { return known.indexOf(e.budget) === -1; });
    var unkCum = cum.filter(function (e) { return known.indexOf(e.budget) === -1; });
    var overBud = budRows.filter(function (r) { return r.cum > r.budget; });

    var siteMap = {};
    items.forEach(function (e) { var k = Number(e.site) || 0; (siteMap[k] = siteMap[k] || []).push(e); });
    var siteRows = (master.sites || []).slice().sort(function (a, b) { return a.no - b.no; }).filter(function (s) { return siteMap[s.no]; })
      .map(function (s) { return { s: s, supply: sum(siteMap[s.no], 'supply'), cnt: siteMap[s.no].length }; });
    var common = { supply: sum(siteMap[0] || [], 'supply'), cnt: (siteMap[0] || []).length };

    var checks = [];
    var add = function (level, title, detail) { checks.push({ level: level, title: title, detail: detail || '' }); };
    if (closed) add('info', ym + ' 마감됨 (' + closed.by + ', ' + closed.at + ')', '이 달 승인·검토 처리는 막혀 있습니다. 고쳐야 하면 현장소장이 사유를 적고 마감을 해제해야 합니다.');
    if (closed && (closed.count !== items.length || closed.total !== totals.total)) {
      add('bad', '마감 뒤에 승인 자료가 바뀌었습니다', '마감할 때 ' + closed.count + '건 ' + won(closed.total) + ' → 지금 ' + items.length + '건 ' + won(totals.total) + '. 마감 해제 후 다시 마감했는지 확인하세요.');
    }
    if (late.length) add('info', '전월 누락분 ' + late.length + '건 포함 (' + won(sum(late, 'total')) + ')', '마감된 달에 영수증이 늦게 나온 경비입니다. 사용일은 그대로이고, 이 달 지불요청에 「누락분」으로 표시되어 합산됩니다.');
    if (!all.length) add('mute', '이 달에는 청구할 경비가 없습니다', '승인된 경비도, 진행 중인 경비도 없습니다.');
    if (pendingItems.length) {
      add('warn', '승인이 끝나지 않은 경비 ' + pendingItems.length + '건', Object.keys(pendBy).map(function (k) { return k + ' ' + pendBy[k] + '건'; }).join(' · ') + ' — 엑셀에는 승인된 경비만 들어갑니다. 이 달에 청구하려면 마감 전에 승인을 마치세요.');
    } else if (all.length) add('ok', '이 달 경비가 모두 승인되었습니다', '경비 ' + items.length + '건 점검');
    if (noRec.length) add('warn', '영수증 사진 없이 승인된 경비 ' + noRec.length + '건 (' + won(sum(noRec, 'total')) + ')', noRec.slice(0, 6).map(function (e) { return e.docNo + '(' + (e.noReceipt || '사유 없음') + ')'; }).join(', ') + (noRec.length > 6 ? ' 외 ' + (noRec.length - 6) + '건' : '') + ' — 본사 제출 전에 사유를 정리하세요.');
    else if (items.length) add('ok', '승인된 모든 경비에 영수증 사진이 있습니다', '');
    if (unkMonth.length) add('warn', '예산 항목을 알 수 없는 경비 ' + unkMonth.length + '건', '비목별 실행예산 표에서 「미분류」로 잡힙니다.');
    if (overBud.length) add('bad', '실행예산을 넘은 비목 ' + overBud.length + '개', overBud.map(function (r) { return r.label + ' ' + won(r.cum) + ' / ' + won(r.budget); }).join(' · ') + ' (누계, 공급가 기준)');
    var bad = checks.filter(function (c) { return c.level === 'bad'; }).length;
    var warn = checks.filter(function (c) { return c.level === 'warn'; }).length;
    return {
      ym: ym, first: ym + '-01', last: monthEnd(ym), today: opt.today, manager: opt.manager || '', closed: closed, master: master,
      items: items, pendingItems: pendingItems, late: late, totals: totals, noRec: noRec, budRows: budRows, unkMonth: unkMonth, unkCum: unkCum,
      siteRows: siteRows, common: common, checks: checks, bad: bad, warn: warn, overBud: overBud
    };
  }

  // ───────────────────────── xlsx 쓰기 ─────────────────────────
  var CRC = (function () { var t = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
  function crc32(u8) { var c = 0xFFFFFFFF; for (var i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  var utf8 = function (s) { return new TextEncoder().encode(s); };
  function zip(files, now) { // files: [{name, data(Uint8Array)}], 저장 방식(압축 없음)
    var parts = [], central = [], off = 0;
    var u16 = function (n) { return [n & 255, (n >>> 8) & 255]; }, u32 = function (n) { return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]; };
    var d = now || new Date();
    var dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    files.forEach(function (f) {
      var nm = utf8(f.name), crc = crc32(f.data), sz = f.data.length;
      var lh = new Uint8Array([0x50, 0x4b, 3, 4].concat(u16(20), u16(0x0800), u16(0), u16(dosTime), u16(dosDate), u32(crc), u32(sz), u32(sz), u16(nm.length), u16(0)));
      parts.push(lh, nm, f.data);
      central.push({ nm: nm, crc: crc, sz: sz, off: off });
      off += lh.length + nm.length + sz;
    });
    var cdSize = 0, cds = [];
    central.forEach(function (c) {
      var h = new Uint8Array([0x50, 0x4b, 1, 2].concat(u16(20), u16(20), u16(0x0800), u16(0), u16(dosTime), u16(dosDate), u32(c.crc), u32(c.sz), u32(c.sz), u16(c.nm.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(c.off)));
      cds.push(h, c.nm); cdSize += h.length + c.nm.length;
    });
    var end = new Uint8Array([0x50, 0x4b, 5, 6].concat(u16(0), u16(0), u16(files.length), u16(files.length), u32(cdSize), u32(off), u16(0)));
    var all = parts.concat(cds, [end]), total = all.reduce(function (a, p) { return a + p.length; }, 0);
    var out = new Uint8Array(total), p = 0; all.forEach(function (x) { out.set(x, p); p += x.length; }); return out;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function colName(i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  // 스타일 번호: 0 기본 1 제목 2 머리글 3 글자(테두리) 4 숫자 5 합계글자 6 합계숫자 7 퍼센트 8 설명 9 강조(노랑) 10 굵은 글자 11 줄바꿈 글자(테두리)
  var STYLE = { def: 0, title: 1, head: 2, text: 3, num: 4, ttext: 5, tnum: 6, pct: 7, note: 8, warn: 9, bold: 10, wrap: 11 };
  var FONT = '<name val="맑은 고딕"/>';
  var STYLES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0%"/></numFmts>' +
    '<fonts count="4"><font><sz val="10"/>' + FONT + '</font><font><b/><sz val="10"/>' + FONT + '</font><font><b/><sz val="14"/>' + FONT + '</font><font><i/><sz val="9"/><color rgb="FF666666"/>' + FONT + '</font></fonts>' +
    '<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9E2F3"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/></patternFill></fill></fills>' +
    '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FF999999"/></left><right style="thin"><color rgb="FF999999"/></right><top style="thin"><color rgb="FF999999"/></top><bottom style="thin"><color rgb="FF999999"/></bottom><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="12">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>' +
    '<xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +
    '<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>' +
    '<xf numFmtId="3" fontId="1" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +
    '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

  // sheet = { name, widths:[...], freeze: 행수, rows: [[cell...]] }, cell = 값 | { v, f, s }
  function sheetXml(sh) {
    var rowsXml = '';
    sh.rows.forEach(function (row, ri) {
      var cx = '';
      row.forEach(function (cell, ci) {
        if (cell === null || cell === undefined) return;
        var o = (typeof cell === 'object') ? cell : { v: cell };
        var ref = colName(ci) + (ri + 1), st = STYLE[o.s || (typeof o.v === 'number' ? 'num' : 'text')], sa = st ? ' s="' + st + '"' : '';
        if (o.f) cx += '<c r="' + ref + '"' + sa + '><f>' + esc(o.f) + '</f><v>' + (typeof o.v === 'number' ? o.v : 0) + '</v></c>';
        else if (typeof o.v === 'number') cx += '<c r="' + ref + '"' + sa + '><v>' + o.v + '</v></c>';
        else if (o.v === '' || o.v === undefined || o.v === null) { if (sa) cx += '<c r="' + ref + '"' + sa + '/>'; }
        else cx += '<c r="' + ref + '"' + sa + ' t="inlineStr"><is><t xml:space="preserve">' + esc(o.v) + '</t></is></c>';
      });
      rowsXml += '<row r="' + (ri + 1) + '">' + cx + '</row>';
    });
    var cols = sh.widths ? '<cols>' + sh.widths.map(function (w, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'; }).join('') + '</cols>' : '';
    var pane = sh.freeze ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="' + sh.freeze + '" topLeftCell="A' + (sh.freeze + 1) + '" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
    var merges = (sh.merges && sh.merges.length) ? '<mergeCells count="' + sh.merges.length + '">' + sh.merges.map(function (m) { return '<mergeCell ref="' + m + '"/>'; }).join('') + '</mergeCells>' : '';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + pane + '<sheetFormatPr defaultRowHeight="15"/>' + cols + '<sheetData>' + rowsXml + '</sheetData>' + merges + '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape" fitToHeight="0"/></worksheet>';
  }
  function buildXlsx(sheets, now) {
    var f = function (name, text) { return { name: name, data: utf8(text) }; };
    var X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    var files = [
      f('[Content_Types].xml', X + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets.map(function (s, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('') + '</Types>'),
      f('_rels/.rels', X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
      f('xl/workbook.xml', X + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        sheets.map(function (s, i) { return '<sheet name="' + esc(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') + '</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>'),
      f('xl/_rels/workbook.xml.rels', X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets.map(function (s, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('') +
        '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'),
      f('xl/styles.xml', STYLES_XML)
    ];
    sheets.forEach(function (s, i) { files.push(f('xl/worksheets/sheet' + (i + 1) + '.xml', sheetXml(s))); });
    return zip(files, now);
  }

  // ───────────────────────── 엑셀 장 만들기 ─────────────────────────
  function buildSheets(d) {
    var T = function (v, s) { return { v: v, s: s || 'text' }; };
    var N = function (v, s) { return { v: num(v), s: s || 'num' }; };
    var F = function (f, v, s) { return { f: f, v: num(v), s: s || 'num' }; };
    var monthTxt = d.ym.slice(0, 4) + '년 ' + Number(d.ym.slice(5)) + '월';
    var items = d.items, n = items.length, lastRow = n + 1;

    // 경비상세 (다른 장이 이 장의 칸을 수식으로 모은다)
    var head = ['경비번호', '사용일자', '계정과목', '개소번호', '개소', '비목', '결제수단', '사용처(거래처)', '적요(상세내역)', '공급가액', '부가세', '합계금액', '사용자', '영수증', '구분', '원 사용월', '승인자', '승인일시'];
    var detailRows = [head.map(function (h) { return T(h, 'head'); })];
    items.forEach(function (e) {
      var site = Number(e.site) || 0;
      detailRows.push([T(e.docNo), T(e.date), T(e.category), N(site, 'text'), T(siteLabel(d.master, site)), T(e.budget || '미분류'), T(e.pay), T(e.vendor), T(e.memo, 'wrap'),
        N(e.supply), N(e.vat), N(e.total), T(e.author), hasReceipt(e) ? T('사진 ' + e.receipts.length + '장') : T('없음 (' + (e.noReceipt || '사유 없음') + ')', 'warn'),
        T(e.late ? '누락분' : ''), T(e.late ? String(e.date).slice(0, 7) : ''), T(e.approver || ''), T(e.approvedAt || '')]);
    });
    var blank = function () { return T('', 'ttext'); };
    detailRows.push([T('합계', 'ttext'), blank(), blank(), blank(), blank(), blank(), blank(), blank(), blank(),
      n ? F('SUM(J2:J' + lastRow + ')', d.totals.supply, 'tnum') : N(0, 'tnum'), n ? F('SUM(K2:K' + lastRow + ')', d.totals.vat, 'tnum') : N(0, 'tnum'), n ? F('SUM(L2:L' + lastRow + ')', d.totals.total, 'tnum') : N(0, 'tnum'),
      blank(), blank(), blank(), blank(), blank(), blank()]);
    var detail = { name: '경비상세', widths: [17, 11, 26, 8, 28, 14, 18, 22, 34, 14, 12, 14, 10, 24, 9, 11, 10, 19], freeze: 1, rows: detailRows };
    var rng = function (col) { return '경비상세!$' + col + '$2:$' + col + '$' + Math.max(lastRow, 2); };

    // 지불요청서(갑지)
    var cats = {}, pays = {};
    items.forEach(function (e) {
      [[cats, e.category], [pays, e.pay]].forEach(function (p) {
        var c = (p[0][p[1]] = p[0][p[1]] || { cnt: 0, s: 0, v: 0, t: 0 }); c.cnt++; c.s += num(e.supply); c.v += num(e.vat); c.t += num(e.total);
      });
    });
    var jr = [];
    jr.push([T('현장경비 지불요청서 (' + monthTxt + '분)', 'title')]);
    jr.push([T('공사명', 'bold'), T('호남고속선 정읍~광주송정 등 28개소 재해예방공사')]);
    jr.push([T('시공', 'bold'), T('(주)동우건설 (현장코드 HN28)')]);
    jr.push([T('대상 기간', 'bold'), T(d.first + ' ~ ' + d.last)]);
    jr.push([T('작성일', 'bold'), T(d.today)]);
    jr.push([T('작성', 'bold'), T('현장소장 ' + d.manager)]);
    jr.push([]);
    var section = function (title, map, col, label) {
      jr.push([T(title, 'bold')]);
      jr.push([T(label, 'head'), T('건수', 'head'), T('공급가액', 'head'), T('부가세', 'head'), T('합계금액', 'head')]);
      var keys = Object.keys(map).sort(function (a, b) { return map[b].t - map[a].t; });
      var start = jr.length + 1;
      keys.forEach(function (k) {
        var rr = jr.length + 1, m = map[k];
        jr.push([T(k), F('COUNTIFS(' + rng(col) + ',$A' + rr + ')', m.cnt), F('SUMIFS(' + rng('J') + ',' + rng(col) + ',$A' + rr + ')', m.s), F('SUMIFS(' + rng('K') + ',' + rng(col) + ',$A' + rr + ')', m.v), F('SUMIFS(' + rng('L') + ',' + rng(col) + ',$A' + rr + ')', m.t)]);
      });
      var end = jr.length, totRow = jr.length + 1;
      jr.push([T('합계', 'ttext'),
        keys.length ? F('SUM(B' + start + ':B' + end + ')', n, 'tnum') : N(0, 'tnum'), keys.length ? F('SUM(C' + start + ':C' + end + ')', d.totals.supply, 'tnum') : N(0, 'tnum'),
        keys.length ? F('SUM(D' + start + ':D' + end + ')', d.totals.vat, 'tnum') : N(0, 'tnum'), keys.length ? F('SUM(E' + start + ':E' + end + ')', d.totals.total, 'tnum') : N(0, 'tnum')]);
      jr.push([]);
      return totRow;
    };
    var catTot = section('1. 계정과목별 집계', cats, 'C', '계정과목');
    var payTot = section('2. 결제수단별 집계', pays, 'G', '결제수단');
    jr.push([T('지불 요청 금액 (합계금액)', 'bold'), F('E' + catTot, d.totals.total, 'tnum')]);
    if (d.late.length) {
      jr.push([T('└ 이 중 전월 누락분', 'note'), F('COUNTIFS(' + rng('O') + ',"누락분")', d.late.length), F('SUMIFS(' + rng('J') + ',' + rng('O') + ',"누락분")', sum(d.late, 'supply')), F('SUMIFS(' + rng('K') + ',' + rng('O') + ',"누락분")', sum(d.late, 'vat')), F('SUMIFS(' + rng('L') + ',' + rng('O') + ',"누락분")', sum(d.late, 'total'))]);
    }
    jr.push([T('검산: 계정과목 합계 − 결제수단 합계 (0이어야 함)', 'note'), F('E' + catTot + '-E' + payTot, 0)]);
    jr.push([]);
    jr.push([T('담당', 'head'), T('현장소장', 'head'), T('본사 확인', 'head')]);
    jr.push([T('', 'text'), T('', 'text'), T('', 'text')]);
    jr.push([T('※ 금액 단위 원. 합계는 「경비상세」 장의 전표(승인된 경비만)를 수식으로 모은 값입니다. 점검 결과는 「마감점검」 장 참고. 청구월 기준이며, 마감 뒤에 나온 전월 영수증은 「누락분」(경비상세 O열)으로 표시되어 이 달에 합산됩니다.', 'note')]);
    var jibji = { name: '지불요청서', widths: [34, 12, 16, 14, 16], rows: jr };

    // 비목별 실행예산 대비
    var br = [[T('비목별 실행예산 대비 집행 (' + monthTxt + ' 마감, 공급가액 기준)', 'title')], [],
      ['비목', '실행예산', '당월 집행', '누계 집행', '잔액', '누계 집행률', '비고'].map(function (h) { return T(h, 'head'); })];
    var bStart = br.length + 1;
    d.budRows.forEach(function (r) {
      var rr = br.length + 1;
      var monthF = r.items.map(function (it) { return 'SUMIFS(' + rng('J') + ',' + rng('F') + ',"' + it + '")'; }).join('+');
      br.push([T(r.label), N(r.budget), F(monthF, r.month), N(r.cum), F('B' + rr + '-D' + rr, r.budget - r.cum), F('IF(B' + rr + '=0,0,D' + rr + '/B' + rr + ')', r.budget ? r.cum / r.budget : 0, 'pct'),
        T(r.cum > r.budget ? '예산 초과' : (r.budget && r.cum / r.budget >= 0.9 ? '90% 이상' : ''), r.cum > r.budget ? 'warn' : 'text')]);
    });
    var unkM = sum(d.unkMonth, 'supply'), unkC = sum(d.unkCum, 'supply');
    if (d.unkMonth.length || d.unkCum.length) {
      var ur = br.length + 1;
      br.push([T('비목 미분류'), N(0), N(unkM), N(unkC), F('B' + ur + '-D' + ur, -unkC), T('', 'text'), T('비목 지정 필요', 'warn')]);
    }
    var bLast = br.length, tr = bLast + 1;
    var totB = d.budRows.reduce(function (a, r) { return a + r.budget; }, 0), totM = d.budRows.reduce(function (a, r) { return a + r.month; }, 0) + unkM, totC = d.budRows.reduce(function (a, r) { return a + r.cum; }, 0) + unkC;
    br.push([T('합계', 'ttext'), F('SUM(B' + bStart + ':B' + bLast + ')', totB, 'tnum'), F('SUM(C' + bStart + ':C' + bLast + ')', totM, 'tnum'), F('SUM(D' + bStart + ':D' + bLast + ')', totC, 'tnum'), F('SUM(E' + bStart + ':E' + bLast + ')', totB - totC, 'tnum'),
      F('IF(B' + tr + '=0,0,D' + tr + '/B' + tr + ')', totB ? totC / totB : 0, 'pct'), T('', 'ttext')]);
    br.push([]);
    br.push([T('※ 실행예산: 호남고속선_실행예산.xlsx 비목별 실행예산(공급가액)을 경비 예산 항목에 맞춰 묶은 값. 간접노무비(상주 인력 급여)는 경비 입력 대상이 아니라 제외. 누계는 착공일부터 이 달 청구분까지 승인된 경비의 합입니다. 당월 집행은 「경비상세」 장 수식입니다.', 'note')]);
    var bimok = { name: '비목별', widths: [24, 16, 16, 16, 16, 12, 18], rows: br };

    // 개소별
    var sr = [[T('개소별 집행 현황 (' + monthTxt + ')', 'title')], [], ['개소', '공종', '당월 경비(공급가)', '경비 건수'].map(function (h) { return T(h, 'head'); })];
    var sStart = sr.length + 1;
    d.siteRows.forEach(function (r) {
      sr.push([T(r.s.code + ' ' + r.s.route + ' ' + r.s.location), T(r.s.work), F('SUMIFS(' + rng('J') + ',' + rng('D') + ',' + r.s.no + ')', r.supply), F('COUNTIFS(' + rng('D') + ',' + r.s.no + ')', r.cnt)]);
    });
    sr.push([T('공통 (개소 없음)'), T(''), F('SUMIFS(' + rng('J') + ',' + rng('D') + ',0)', d.common.supply), F('COUNTIFS(' + rng('D') + ',0)', d.common.cnt)]);
    var sLast = sr.length;
    sr.push([T('합계', 'ttext'), T('', 'ttext'), F('SUM(C' + sStart + ':C' + sLast + ')', d.totals.supply, 'tnum'), F('SUM(D' + sStart + ':D' + sLast + ')', n, 'tnum')]);
    sr.push([]);
    sr.push([T('※ 경비 합계는 「지불요청서」 합계금액이 아니라 공급가액입니다. 개소 합계 + 공통 = 경비상세 공급가 합계. 작업일수·출역·진행률은 작업일보 연결(4단계) 뒤에 추가됩니다.', 'note')]);
    var gaeso = { name: '개소별', widths: [40, 28, 18, 12], rows: sr };

    // 마감점검
    var lv = { ok: '정상', warn: '보완', bad: '문제', info: '참고', mute: '참고' };
    var cr = [[T('마감 점검 결과 (' + monthTxt + ')', 'title')],
      [T('점검일 ' + d.today + ' · 문제 ' + d.bad + '건 · 보완 ' + d.warn + '건 · ' + (d.closed ? '마감됨(' + d.closed.by + ', ' + d.closed.at + ')' : '아직 마감 전'), 'note')], [],
      ['구분', '점검 항목', '내용'].map(function (h) { return T(h, 'head'); })];
    d.checks.forEach(function (c) { cr.push([T(lv[c.level], c.level === 'bad' || c.level === 'warn' ? 'warn' : 'text'), T(c.title, 'wrap'), T(c.detail || '', 'wrap')]); });
    var jum = { name: '마감점검', widths: [8, 44, 80], rows: cr };
    return [jibji, detail, bimok, gaeso, jum];
  }

  function makeWorkbook(d, now) { return buildXlsx(buildSheets(d), now); }
  function fileName(d) { return 'HN28_월마감_' + d.ym + (d.closed ? '' : '_마감전') + '_' + d.today.replace(/-/g, '') + '.xlsx'; }

  var api = { buildClose: buildClose, buildSheets: buildSheets, makeWorkbook: makeWorkbook, fileName: fileName, won: won, monthEnd: monthEnd, siteLabel: siteLabel, _zip: zip, _crc32: crc32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.HNExport = api;
})(typeof window !== 'undefined' ? window : globalThis);
