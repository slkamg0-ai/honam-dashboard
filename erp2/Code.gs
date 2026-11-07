/**
 * HN28 현장 ERP v2 — 0단계: 연결 확인용 서버 (Apps Script)
 *
 * 하는 일: 화면(GitHub Pages)이 보낸 요청에 JSON으로 답한다.
 *   ping     : 서버가 살아 있는지 (시간 반환)
 *   dbTest   : 구글 시트 DB를 열고(없으면 자동 생성) 한 줄 쓰고 읽기
 *
 * 배포: 배포 > 새 배포 > 웹 앱 > 실행 계정 "나", 액세스 "모든 사용자"
 * 처음 한 번: 함수 선택에서 setup 을 실행하고 권한을 승인한다.
 */

const DB_NAME = 'HN28_ERP_DB';
const TEST_SHEET = '_연결테스트';

/** 처음 한 번 직접 실행: 권한 승인 + DB 시트 자동 생성 */
function setup() {
  const ss = getDb_();
  Logger.log('DB 준비 완료: ' + ss.getUrl());
}

function doGet(e) {
  return handle_((e && e.parameter) || {});
}

// 브라우저 사전 요청(CORS preflight)을 피하려고 화면은 text/plain 으로 보낸다.
function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) {}
  return handle_(body);
}

function handle_(req) {
  const t0 = Date.now();
  let out;
  try {
    switch (String(req.action || 'ping')) {
      case 'ping':
        out = { ok: true, now: new Date().toISOString(), tz: Session.getScriptTimeZone() };
        break;
      case 'dbTest':
        out = dbTest_(req);
        break;
      default:
        out = { ok: false, error: 'UNKNOWN_ACTION', message: '알 수 없는 요청: ' + req.action };
    }
  } catch (err) {
    out = { ok: false, error: 'SERVER_ERROR', message: String(err && err.message || err) };
  }
  out.serverMs = Date.now() - t0;
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function getDb_() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('DB_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) { /* 지워졌으면 새로 만든다 */ }
  }
  const ss = SpreadsheetApp.create(DB_NAME);
  props.setProperty('DB_ID', ss.getId());
  return ss;
}

function dbTest_(req) {
  const ss = getDb_();
  let sh = ss.getSheetByName(TEST_SHEET);
  if (!sh) {
    sh = ss.insertSheet(TEST_SHEET);
    sh.appendRow(['시각', '메모']);
  }
  sh.appendRow([new Date(), String(req.memo || '')]);
  return { ok: true, rows: sh.getLastRow() - 1, dbUrl: ss.getUrl() };
}
