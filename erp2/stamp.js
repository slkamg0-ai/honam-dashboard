/* HN28 현장 ERP v2 — 내 도장·서명 (본인이 직접 올리고 지운다)
 * index.html 이 열어 둔 window.ERP2 만 쓴다. */
(function () {
  'use strict';
  var E = window.ERP2, $ = E.$;
  var pending = '';
  function msg(t, info) { var m = $('stMsg'); m.className = 'msg' + (info ? ' info' : ''); m.textContent = t || ''; }
  function imgOf(b64) { var im = document.createElement('img'); im.src = 'data:image/png;base64,' + b64; im.alt = '도장'; im.style.cssText = 'max-width:100px;max-height:100px'; return im; }
  function showNow(b64) { var b = $('stNow'); b.textContent = ''; if (b64) b.appendChild(imgOf(b64)); else b.textContent = '등록된 도장 없음'; }
  function clearNew() { pending = ''; $('stNew').textContent = ''; $('stNew').classList.add('hide'); $('stSave').disabled = true; $('stFile').value = ''; }
  function load() {
    msg('불러오는 중…', true);
    E.api('getMyStamp', {}, 20000).then(function (r) {
      if (E.authLost(r)) return;
      if (!r.ok) { msg(r.message || '불러오지 못했습니다.'); return; }
      $('stWho').textContent = r.name + ' 님의 도장';
      showNow(r.stamp); msg('');
    });
  }
  function open() { if (document.getElementById('menu')) document.getElementById('menu').classList.add('hide'); E.showView('vStamp'); clearNew(); showNow(''); load(); window.scrollTo(0, 0); }
  $('btnStamp').onclick = open;
  $('stBack').onclick = function () { E.showView('vHome'); E.onEnter.forEach(function (f) { try { f(); } catch (e) {} }); };

  /** 사진·스캔 → 정사각 300px PNG, 흰 바탕은 투명하게 */
  function convert(file) {
    return new Promise(function (ok, no) {
      var url = URL.createObjectURL(file), im = new Image();
      im.onload = function () {
        try {
          var S = 300, c = document.createElement('canvas'); c.width = S; c.height = S;
          var x = c.getContext('2d'), k = Math.min(S / im.width, S / im.height), w = im.width * k, h = im.height * k;
          x.drawImage(im, (S - w) / 2, (S - h) / 2, w, h);
          var d = x.getImageData(0, 0, S, S), p = d.data;
          for (var i = 0; i < p.length; i += 4) { if (p[i] > 225 && p[i + 1] > 225 && p[i + 2] > 225) p[i + 3] = 0; }
          x.putImageData(d, 0, 0);
          URL.revokeObjectURL(url);
          ok(c.toDataURL('image/png').split(',')[1]);
        } catch (e) { no(e); }
      };
      im.onerror = function () { URL.revokeObjectURL(url); no(new Error('img')); };
      im.src = url;
    });
  }
  $('stFile').onchange = function () {
    var f = $('stFile').files[0]; pending = ''; $('stSave').disabled = true;
    if (!f) { clearNew(); return; }
    if (!/^image\/(png|jpeg)$/.test(f.type)) { clearNew(); msg('PNG 또는 JPG 이미지만 올릴 수 있습니다.'); return; }
    if (f.size > 10 * 1024 * 1024) { clearNew(); msg('파일이 너무 큽니다(10MB 이하).'); return; }
    convert(f).then(function (b64) {
      if (b64.length > 400000) { clearNew(); msg('이미지가 너무 복잡합니다. 도장 부분만 잘라서 올려 주세요.'); return; }
      pending = b64; var n = $('stNew'); n.textContent = ''; n.appendChild(imgOf(b64)); n.classList.remove('hide');
      $('stSave').disabled = false; msg('점선 칸이 새 도장입니다. 맞으면 「이 도장으로 저장」을 누르세요.', true);
    }, function () { clearNew(); msg('이미지를 읽지 못했습니다.'); });
  };
  $('stSave').onclick = function () {
    if (!pending) return;
    $('stSave').disabled = true; msg('저장 중…', true);
    E.api('saveMyStamp', { data: pending }, 60000).then(function (r) {
      if (E.authLost(r)) return;
      if (!r.ok) { $('stSave').disabled = false; msg(r.message || '저장하지 못했습니다.'); return; }
      if (E.resetStamps) E.resetStamps();
      clearNew(); load(); msg('저장했습니다. 이제 갑지 결재란에 이 도장이 찍힙니다.', true);
    });
  };
  $('stDel').onclick = function () {
    if (!window.confirm('내가 올린 도장을 지울까요?')) return;
    E.api('deleteMyStamp', {}, 30000).then(function (r) {
      if (E.authLost(r)) return;
      if (!r.ok) { msg(r.message || '지우지 못했습니다.'); return; }
      if (E.resetStamps) E.resetStamps();
      clearNew(); load();
    });
  };
})();
