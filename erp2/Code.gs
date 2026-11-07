/**
 * HN28 현장 ERP v2 — 서버 (Apps Script)  1단계 로그인·직원 관리 / 2단계 경비 입력·결재·문서번호·영수증 / 3단계 월 마감·누락분 / 4단계 작업일보
 *
 * 화면(GitHub Pages)이 보낸 요청에 JSON으로 답한다. 데이터는 구글 시트(HN28_ERP_DB)에만 둔다.
 *  - 모든 요청은 POST(text/plain, JSON 본문). GET 은 ping 만 허용한다(주소창에 PIN 이 남지 않게).
 *  - PIN 은 해시로만 저장한다. 5회 연속 실패하면 15분 잠긴다.
 *  - 로그인하지 않으면 아무 데이터도 주지 않는다. 권한은 서버에서 확인한다.
 *
 * 처음 한 번: 함수 선택에서 setup 을 실행 → 실행 로그에 직원별 임시 PIN 이 나온다.
 * 배포: 배포 > 배포 관리 > (기존 배포) 수정 > 새 버전  (주소는 그대로 유지된다)
 */

const DB_NAME = 'HN28_ERP_DB';
const SHEET_USERS = '직원';
const SHEET_AUDIT = '감사로그';
const USER_HEADERS = ['로그인ID', '이름', '역할', 'PIN해시', '솔트', '사용', '임시PIN', '실패횟수', '잠금해제', '수정일시'];
const COL = { id: 0, name: 1, role: 2, hash: 3, salt: 4, active: 5, temp: 6, fails: 7, lockUntil: 8, updated: 9 };
const ROLES = ['현장소장', '공무', '공사'];
const MANAGER_ROLE = '현장소장';
const SHEET_EXP = '경비';
const SHEET_SEQ = '번호';
const SHEET_CLOSE = '마감';
const SHEET_OPS = '작업일보';
const SHEET_HQ = '본사제출';
const SESSION_TTL_SEC = 21600; // 6시간 (CacheService 최대)
const MAX_FAILS = 5;
const LOCK_MIN = 15;
const INITIAL_STAFF = [
  { id: '임석인', name: '임석인', role: '현장소장' },
  { id: '강종민', name: '강종민', role: '공무' },
  { id: '곽호진', name: '곽호진', role: '공사' },
  { id: '박진우', name: '박진우', role: '공사' }
];

// ───────────────────────────── 시작 설정 ─────────────────────────────

/** 처음 한 번(또는 직원 시트를 다시 만들 때) 직접 실행. 새로 만든 직원의 임시 PIN 을 실행 로그에 보여 준다. */
function setup() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('PEPPER')) props.setProperty('PEPPER', Utilities.getUuid() + Utilities.getUuid());
  const ss = getDb_();
  const sh = ensureUsersSheet_(ss);
  ensureSheet_(ss, SHEET_AUDIT, ['시각', '로그인ID', '동작', '결과']);
  ensureExpSheet_(ss); ensureSheet_(ss, SHEET_SEQ, ['키', '마지막번호']); ensureCloseSheet_(ss); ensureOpsSheet_(ss); ensureHqSheet_(ss);
  receiptRoot_(); // 영수증 폴더를 만들면서 드라이브 권한 승인을 받는다
  const rows = readUsers_(sh);
  const made = [];
  INITIAL_STAFF.forEach(function (s) {
    if (rows.some(function (r) { return r[COL.id] === s.id; })) return;
    const temp = makeTempPin_();
    appendUser_(sh, s.id, s.name, s.role, temp);
    made.push(s.id + ' (' + s.role + ') 임시 PIN: ' + temp);
  });
  Logger.log('DB: ' + ss.getUrl());
  Logger.log('영수증 폴더: ' + receiptRoot_().getUrl());
  Logger.log(made.length ? '새로 만든 직원 ' + made.length + '명\n' + made.join('\n') : '새로 만든 직원 없음(이미 모두 있음)');
}

// ───────────────────────────── 요청 처리 ─────────────────────────────

function doGet(e) {
  const action = String((e && e.parameter && e.parameter.action) || 'ping');
  if (action !== 'ping') return json_({ ok: false, error: 'POST_ONLY', message: '이 요청은 POST 로만 보낼 수 있습니다.' });
  return json_(ping_());
}

// 브라우저 사전 요청(CORS preflight)을 피하려고 화면은 text/plain 으로 보낸다.
function doPost(e) {
  let req = {};
  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return json_({ ok: false, error: 'BAD_JSON', message: '요청 형식이 맞지 않습니다.' }); }
  return json_(route_(req));
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function ping_() { return { ok: true, now: new Date().toISOString(), tz: Session.getScriptTimeZone(), version: 'v2.5' }; }

function route_(req) {
  const t0 = Date.now();
  let out;
  try {
    switch (String(req.action || '')) {
      case 'ping': out = ping_(); break;
      case 'login': out = login_(req); break;
      case 'whoami': out = whoami_(req); break;
      case 'logout': out = logout_(req); break;
      case 'changePin': out = changePin_(req); break;
      case 'listUsers': out = listUsers_(req); break;
      case 'saveUser': out = saveUser_(req); break;
      case 'getMaster': out = getMaster_(req); break;
      case 'listExpenses': out = listExpenses_(req); break;
      case 'saveExpense': out = saveExpense_(req); break;
      case 'submitExpense': out = submitExpense_(req); break;
      case 'reviewExpense': out = reviewExpense_(req); break;
      case 'approveExpense': out = approveExpense_(req); break;
      case 'deleteExpense': out = deleteExpense_(req); break;
      case 'getReceipt': out = getReceipt_(req); break;
      case 'closeMonth': out = closeMonth_(req); break;
      case 'reopenMonth': out = reopenMonth_(req); break;
      case 'hqMonth': out = hqMonth_(req); break;
      case 'listOps': out = listOps_(req); break;
      case 'saveOps': out = saveOps_(req); break;
      case 'submitOps': out = submitOps_(req); break;
      case 'confirmOps': out = confirmOps_(req); break;
      case 'deleteOps': out = deleteOps_(req); break;
      default: out = fail_('UNKNOWN_ACTION', '알 수 없는 요청입니다.');
    }
  } catch (err) {
    out = fail_('SERVER_ERROR', '서버 오류: ' + String(err && err.message || err));
  }
  out.serverMs = Date.now() - t0;
  return out;
}

function fail_(code, message, extra) {
  const o = { ok: false, error: code, message: message };
  if (extra) for (const k in extra) o[k] = extra[k];
  return o;
}

// ───────────────────────────── 로그인 ─────────────────────────────

function login_(req) {
  const id = String(req.loginId || '').trim();
  const pin = String(req.pin || '').trim();
  if (!id || !pin) return fail_('PARAM', '로그인 ID와 PIN을 모두 입력해 주세요.');
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = ensureUsersSheet_(getDb_());
    const found = findUser_(sh, id);
    const GENERIC = '로그인 ID 또는 PIN이 맞지 않습니다.';
    if (!found) { audit_(id, '로그인', '실패(없는 ID)'); return fail_('INVALID', GENERIC); }
    const r = found.row;
    if (r[COL.active] !== 'Y') { audit_(id, '로그인', '실패(중지된 계정)'); return fail_('DISABLED', '사용이 중지된 계정입니다. 현장소장에게 문의하세요.'); }
    const now = Date.now();
    const lockUntil = Number(r[COL.lockUntil]) || 0;
    if (lockUntil > now) {
      const left = Math.ceil((lockUntil - now) / 60000);
      audit_(id, '로그인', '거절(잠김)');
      return fail_('LOCKED', 'PIN을 5번 틀려 잠겼습니다. ' + left + '분 뒤에 다시 시도하거나 현장소장에게 PIN 초기화를 요청하세요.');
    }
    if (hashPin_(pin, r[COL.salt]) !== r[COL.hash]) {
      const fails = (Number(r[COL.fails]) || 0) + 1;
      if (fails >= MAX_FAILS) {
        r[COL.fails] = 0; r[COL.lockUntil] = now + LOCK_MIN * 60000;
        writeUser_(sh, found.rowNo, r);
        audit_(id, '로그인', '실패→잠금');
        return fail_('LOCKED', 'PIN을 5번 틀려 ' + LOCK_MIN + '분간 잠겼습니다.');
      }
      r[COL.fails] = fails;
      writeUser_(sh, found.rowNo, r);
      audit_(id, '로그인', '실패(' + fails + '/' + MAX_FAILS + ')');
      return fail_('INVALID', GENERIC + ' (' + fails + '/' + MAX_FAILS + '회 실패)');
    }
    r[COL.fails] = 0; r[COL.lockUntil] = 0;
    writeUser_(sh, found.rowNo, r);
    const must = r[COL.temp] === 'Y';
    const token = newSession_(r, must);
    audit_(id, '로그인', must ? '성공(임시PIN)' : '성공');
    return { ok: true, token: token, mustChangePin: must, user: publicUser_(r) };
  } finally {
    lock.releaseLock();
  }
}

function whoami_(req) {
  const s = getSession_(req.token);
  if (!s) return fail_('AUTH', '로그인이 필요하거나 시간이 지나 만료되었습니다.');
  return { ok: true, mustChangePin: !!s.must, user: { loginId: s.id, name: s.name, role: s.role } };
}

function logout_(req) {
  if (req.token) CacheService.getScriptCache().remove('S_' + req.token);
  return { ok: true };
}

function changePin_(req) {
  const s = getSession_(req.token);
  if (!s) return fail_('AUTH', '로그인이 필요하거나 시간이 지나 만료되었습니다.');
  const oldPin = String(req.oldPin || '').trim();
  const newPin = String(req.newPin || '').trim();
  const bad = pinProblem_(newPin);
  if (bad) return fail_('PIN_RULE', bad);
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = ensureUsersSheet_(getDb_());
    const found = findUser_(sh, s.id);
    if (!found) return fail_('AUTH', '계정을 찾을 수 없습니다.');
    const r = found.row;
    if (!s.must && hashPin_(oldPin, r[COL.salt]) !== r[COL.hash]) return fail_('INVALID_OLD_PIN', '현재 PIN이 맞지 않습니다.');
    if (hashPin_(newPin, r[COL.salt]) === r[COL.hash]) return fail_('PIN_RULE', '현재 PIN과 다른 PIN을 입력해 주세요.');
    r[COL.salt] = Utilities.getUuid();
    r[COL.hash] = hashPin_(newPin, r[COL.salt]);
    r[COL.temp] = 'N';
    writeUser_(sh, found.rowNo, r);
    bumpEpoch_(s.id);
    const token = newSession_(r, false); // 이전 세션은 무효, 새 세션 발급
    audit_(s.id, 'PIN변경', '성공');
    return { ok: true, token: token, user: publicUser_(r) };
  } finally {
    lock.releaseLock();
  }
}

// ───────────────────────────── 직원 관리 (현장소장만) ─────────────────────────────

function requireManager_(req) {
  const s = getSession_(req.token);
  if (!s) return { err: fail_('AUTH', '로그인이 필요하거나 시간이 지나 만료되었습니다.') };
  if (s.must) return { err: fail_('MUST_CHANGE_PIN', '먼저 PIN을 변경해 주세요.') };
  if (s.role !== MANAGER_ROLE) return { err: fail_('FORBIDDEN', '현장소장만 직원을 관리할 수 있습니다.') };
  return { s: s };
}

function listUsers_(req) {
  const g = requireManager_(req); if (g.err) return g.err;
  const sh = ensureUsersSheet_(getDb_());
  const now = Date.now();
  return {
    ok: true,
    users: readUsers_(sh).map(function (r) {
      const u = publicUser_(r);
      u.locked = (Number(r[COL.lockUntil]) || 0) > now;
      u.mustChangePin = r[COL.temp] === 'Y';
      u.updated = String(r[COL.updated] || '');
      return u;
    })
  };
}

/** req: { token, loginId, create?:true, name?, role?, active?:bool, resetPin?:true } */
function saveUser_(req) {
  const g = requireManager_(req); if (g.err) return g.err;
  const me = g.s;
  const id = String(req.loginId || '').trim();
  if (!id) return fail_('PARAM', '로그인 ID를 입력해 주세요.');
  if (/[\s,;]/.test(id) || id.length > 20) return fail_('PARAM', '로그인 ID는 공백 없이 20자 이내로 입력해 주세요.');
  if (req.role !== undefined && ROLES.indexOf(String(req.role)) < 0) return fail_('PARAM', '역할은 ' + ROLES.join('/') + ' 중 하나여야 합니다.');
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = ensureUsersSheet_(getDb_());
    const found = findUser_(sh, id);
    if (req.create) {
      if (found) return fail_('EXISTS', '이미 있는 로그인 ID입니다.');
      const name = String(req.name || '').trim();
      if (!name) return fail_('PARAM', '이름을 입력해 주세요.');
      const role = String(req.role || '공사');
      const temp = makeTempPin_();
      appendUser_(sh, id, name, role, temp);
      audit_(me.id, '직원추가', id + ' / ' + role);
      return { ok: true, tempPin: temp };
    }
    if (!found) return fail_('NOT_FOUND', '없는 직원입니다.');
    const r = found.row;
    let tempPin;
    let changed = [];
    if (req.name !== undefined && String(req.name).trim()) { r[COL.name] = String(req.name).trim(); changed.push('이름'); }
    if (req.role !== undefined && String(req.role) !== r[COL.role]) {
      if (id === me.id) return fail_('SELF', '본인의 역할은 바꿀 수 없습니다.');
      r[COL.role] = String(req.role); changed.push('역할'); bumpEpoch_(id);
    }
    if (req.active !== undefined) {
      const want = req.active ? 'Y' : 'N';
      if (want !== r[COL.active]) {
        if (id === me.id) return fail_('SELF', '본인 계정은 중지할 수 없습니다.');
        r[COL.active] = want; changed.push(want === 'Y' ? '사용재개' : '사용중지'); bumpEpoch_(id);
      }
    }
    if (req.resetPin) {
      tempPin = makeTempPin_();
      r[COL.salt] = Utilities.getUuid();
      r[COL.hash] = hashPin_(tempPin, r[COL.salt]);
      r[COL.temp] = 'Y'; r[COL.fails] = 0; r[COL.lockUntil] = 0;
      changed.push('PIN초기화'); bumpEpoch_(id);
    }
    writeUser_(sh, found.rowNo, r);
    audit_(me.id, '직원수정', id + ' / ' + (changed.join(',') || '변경없음'));
    const out = { ok: true };
    if (tempPin) out.tempPin = tempPin;
    return out;
  } finally {
    lock.releaseLock();
  }
}

// ───────────────────────────── 세션 ─────────────────────────────

function newSession_(r, must) {
  const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  const s = { id: r[COL.id], name: r[COL.name], role: r[COL.role], must: !!must, epoch: getEpoch_(r[COL.id]) };
  CacheService.getScriptCache().put('S_' + token, JSON.stringify(s), SESSION_TTL_SEC);
  return token;
}

function getSession_(token) {
  if (!token || typeof token !== 'string' || token.length < 40) return null;
  const raw = CacheService.getScriptCache().get('S_' + token);
  if (!raw) return null;
  let s; try { s = JSON.parse(raw); } catch (e) { return null; }
  if (s.epoch !== getEpoch_(s.id)) return null; // PIN 변경·역할 변경·중지 등으로 무효화된 세션
  return s;
}

function getEpoch_(id) { return Number(PropertiesService.getScriptProperties().getProperty('EPOCH_' + id)) || 0; }
function bumpEpoch_(id) { PropertiesService.getScriptProperties().setProperty('EPOCH_' + id, String(getEpoch_(id) + 1)); }

// ───────────────────────────── PIN ─────────────────────────────

function hashPin_(pin, salt) {
  const pepper = PropertiesService.getScriptProperties().getProperty('PEPPER') || '';
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(pin) + ':' + salt + ':' + pepper, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { const v = (b < 0 ? b + 256 : b).toString(16); return v.length === 1 ? '0' + v : v; }).join('');
}

/** 규칙에 어긋나면 이유를, 괜찮으면 빈 문자열을 돌려준다. */
function pinProblem_(pin) {
  if (!/^\d{4,6}$/.test(pin)) return 'PIN은 숫자 4~6자리여야 합니다.';
  if (/^(\d)\1+$/.test(pin)) return '같은 숫자를 반복한 PIN은 쓸 수 없습니다.';
  let up = true, down = true;
  for (let i = 1; i < pin.length; i++) {
    if (Number(pin[i]) !== Number(pin[i - 1]) + 1) up = false;
    if (Number(pin[i]) !== Number(pin[i - 1]) - 1) down = false;
  }
  if (up || down) return '1234, 4321처럼 연속된 숫자 PIN은 쓸 수 없습니다.';
  return '';
}

function makeTempPin_() {
  for (let i = 0; i < 50; i++) {
    const p = String(Math.floor(Math.random() * 900000) + 100000);
    if (!pinProblem_(p)) return p;
  }
  return '739154';
}

// ───────────────────────────── 시트(DB) ─────────────────────────────

function getDb_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('DB_ID');
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) { /* 지워졌으면 새로 만든다 */ } }
  const ss = SpreadsheetApp.create(DB_NAME);
  props.setProperty('DB_ID', ss.getId());
  return ss;
}

function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(headers); }
  return sh;
}

function ensureUsersSheet_(ss) {
  let sh = ss.getSheetByName(SHEET_USERS);
  if (!sh) {
    sh = ss.insertSheet(SHEET_USERS);
    sh.getRange(1, 1, sh.getMaxRows(), USER_HEADERS.length).setNumberFormat('@'); // 전부 텍스트(해시가 숫자로 바뀌는 것을 막는다)
    sh.getRange(1, 1, 1, USER_HEADERS.length).setValues([USER_HEADERS]);
  }
  return sh;
}

function readUsers_(sh) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, USER_HEADERS.length).getValues().map(function (r) { return r.map(function (v) { return v === null || v === undefined ? '' : (typeof v === 'number' ? v : String(v)); }); });
}

function findUser_(sh, id) {
  const rows = readUsers_(sh);
  for (let i = 0; i < rows.length; i++) if (String(rows[i][COL.id]) === id) return { rowNo: i + 2, row: rows[i] };
  return null;
}

function writeUser_(sh, rowNo, r) {
  r[COL.updated] = nowStr_();
  sh.getRange(rowNo, 1, 1, USER_HEADERS.length).setValues([r]);
}

function appendUser_(sh, id, name, role, tempPin) {
  const salt = Utilities.getUuid();
  const row = [id, name, role, hashPin_(tempPin, salt), salt, 'Y', 'Y', 0, 0, nowStr_()];
  const next = sh.getLastRow() + 1;
  sh.getRange(next, 1, 1, USER_HEADERS.length).setNumberFormat('@');
  sh.getRange(next, 1, 1, USER_HEADERS.length).setValues([row]);
}

function publicUser_(r) { return { loginId: r[COL.id], name: r[COL.name], role: r[COL.role], active: r[COL.active] === 'Y' }; }

function nowStr_() { return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss'); }

function audit_(id, action, result) {
  try {
    const sh = ensureSheet_(getDb_(), SHEET_AUDIT, ['시각', '로그인ID', '동작', '결과']);
    sh.appendRow([nowStr_(), id, action, result]);
  } catch (e) { /* 기록 실패가 로그인을 막지 않게 한다 */ }
}

// ═════════════════════════════ 2단계: 경비 ═════════════════════════════

const EXP_CATEGORIES = ['복리후생비(식대/간식)', '차량유지비(유류대/통행료)', '현장소모품(잡자재/공구)', '안전관리비(안전용품/TBM)', '여비교통비(숙박/출장)', '사무실운영비(통신/임대/공과금)', '업무추진비(회의/대관업무)', '기타현장경비'];
const EXP_PAY = ['법인카드', '현장전도금(현금/이체)', '개인카드(추후정산)', '세금계산서(외상)'];
const EXP_BUDGET = ['직접노무비', '장비사용료', '주요자재대', '가설재대', '외주공사비', '현장운영경비', '안전관리비', '품질관리비', '기타경비'];
const EXP_CAT_BUDGET = { '안전관리비(안전용품/TBM)': '안전관리비', '현장소모품(잡자재/공구)': '주요자재대' };
const EXP_DEFAULT_BUDGET = '현장운영경비';
// 실행예산(공급가액). 이전 ERP의 「호남고속선_실행예산.xlsx」 비목별 집계(계약금액 78%, 선공제 13항목 반영)를 그대로 옮긴 값. 간접노무비(상주 인력 급여) 4.8억은 경비 입력 대상이 아니라 제외.
const EXEC_BUDGET = [
  { label: '직접노무비', items: ['직접노무비'], budget: 2197913952 },
  { label: '주요자재대', items: ['주요자재대'], budget: 668175302 },
  { label: '장비·가설재·외주', items: ['장비사용료', '가설재대', '외주공사비'], budget: 625657852 },
  { label: '현장운영경비', items: ['현장운영경비'], budget: 110880000 },
  { label: '안전관리비', items: ['안전관리비'], budget: 155634276 },
  { label: '품질관리비', items: ['품질관리비'], budget: 55517837 },
  { label: '기타경비', items: ['기타경비'], budget: 91737863 }
];
// 개소 마스터(협업/master/개소_마스터.csv, 2026-11-06). 0 = 공통(개소 없음). 24번은 결번.
const SITES = [
  [27, 'S27', '전라선', '109k310', '비탈면완화'], [26, 'S26', '호남고속선', '83k138~473 (익산)', 'U형수로 이어올리기'],
  [1, 'S01', '호남고속선', '122k077 화룡터널 종점', 'U형수로'], [2, 'S02', '호남고속선', '150k653 달성터널 종점', 'U형수로'],
  [3, 'S03', '호남고속선', '151k023 죽청터널 시점', 'U형수로'], [4, 'S04', '호남고속선', '152k413 죽청터널 종점', 'U형수로'],
  [5, 'S05', '호남고속선', '152k784 성덕1터널 시점', '소단측구'], [6, 'S06', '호남고속선', '152k923 성덕1터널 종점', 'U형수로+격자블록'],
  [7, 'S07', '호남고속선', '153k113 성덕2터널 시점', 'U형수로'], [8, 'S08', '호남고속선', '153k213 성덕2터널 종점', 'U형수로'],
  [9, 'S09', '호남고속선', '156k968 송현제1 시점', 'U형수로+격자블록'], [10, 'S10', '호남고속선', '159k610 송현제3 종점', '격자블록'],
  [11, 'S11', '호남고속선', '162k368 용흥터널 시점', '격자블록'], [12, 'S12', '호남고속선', '162k673 용흥터널 종점', '격자블록'],
  [13, 'S13', '호남고속선', '172k058 마령터널 종점', '격자블록'], [14, 'S14', '호남고속선', '175k338 고룡터널 종점', '격자블록'],
  [15, 'S15', '호남선', '70k130', 'U형수로+게비온+말뚝식옹벽'], [16, 'S16', '광주선', '2k710~2k800', 'U형수로+게비온+울타리'],
  [17, 'S17', '전라선', '35k890', 'U형수로+낙석방지망+쏘일시멘트'], [18, 'S18', '전라선', '154k300', 'J형수로+토석류방호책'],
  [19, 'S19', '광양제철선', '4k920~5k000', '낙석방지책'], [20, 'S20', '광양제철선', '8k950~9k020', 'U형수로+옹벽인상'],
  [21, 'S21', '광양제철선', '10k680~10k800', 'U형수로+격자블록'], [22, 'S22', '광양제철선', '14k015', 'U형수로+낙석방지책'],
  [23, 'S23', '광양제철선', '15k390', 'U형수로+격자블록'], [25, 'S25', '경전선', '135k741', 'U형수로+격자블록']
];
const ST = { DRAFT: '작성중', REVIEW: '검토대기', APPROVAL: '승인대기', DONE: '승인', REJECT: '반려', DEL: '삭제' };
const EXP_FIELDS = [['id', 'ID'], ['docNo', '문서번호'], ['date', '사용일'], ['category', '비목'], ['pay', '결제수단'], ['site', '개소'], ['budget', '예산항목'],
  ['vendor', '거래처'], ['memo', '적요'], ['total', '합계'], ['supply', '공급가'], ['vat', '부가세'], ['authorId', '작성자ID'], ['author', '작성자'], ['status', '상태'],
  ['receipts', '영수증'], ['noReceipt', '영수증없음사유'], ['late', '누락분'], ['claimMonth', '청구월'], ['reviewer', '검토자'], ['reviewedAt', '검토일시'],
  ['approver', '승인자'], ['approvedAt', '승인일시'], ['reason', '반려사유'], ['created', '작성일시'], ['updated', '수정일시']];
const EXP_HEADERS = EXP_FIELDS.map(function (f) { return f[1]; });
const MAX_RECEIPTS = 3;
const MAX_RECEIPT_B64 = 2200000; // 약 1.6MB (화면에서 이미 줄여서 보낸다)

function expAuth_(req) {
  const s = getSession_(req.token);
  if (!s) return { err: fail_('AUTH', '로그인이 필요하거나 시간이 지나 만료되었습니다.') };
  if (s.must) return { err: fail_('MUST_CHANGE_PIN', '먼저 PIN을 변경해 주세요.') };
  return { s: s };
}

function getMaster_(req) {
  const g = expAuth_(req); if (g.err) return g.err;
  return {
    ok: true, categories: EXP_CATEGORIES, payMethods: EXP_PAY, budgetItems: EXP_BUDGET, catBudget: EXP_CAT_BUDGET, defaultBudget: EXP_DEFAULT_BUDGET,
    sites: SITES.map(function (r) { const p = OPS_PLAN[r[0]] || ['', '']; return { no: r[0], code: r[1], route: r[2], location: r[3], work: r[4], planStart: p[0], planEnd: p[1] }; }),
    holidays: OPS_HOLIDAYS, opsWeather: OPS_WEATHER, opsKinds: OPS_KINDS,
    execBudget: EXEC_BUDGET, closed: closedMonths_(true), manager: siteManagerName_(),
    maxReceipts: MAX_RECEIPTS, today: nowStr_().slice(0, 10)
  };
}

// ── 경비 시트 ──
function ensureExpSheet_(ss) {
  let sh = ss.getSheetByName(SHEET_EXP);
  if (!sh) {
    sh = ss.insertSheet(SHEET_EXP);
    sh.getRange(1, 1, sh.getMaxRows(), EXP_HEADERS.length).setNumberFormat('@');
    sh.getRange(1, 1, 1, EXP_HEADERS.length).setValues([EXP_HEADERS]);
  }
  return sh;
}

function expRows_(sh) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, EXP_HEADERS.length).getValues().map(function (r, i) {
    const o = { _row: i + 2 };
    EXP_FIELDS.forEach(function (f, k) { o[f[0]] = r[k] === null || r[k] === undefined ? '' : String(r[k]); });
    return o;
  });
}

function expWrite_(sh, o, rowNo) {
  o.updated = nowStr_();
  const arr = EXP_FIELDS.map(function (f) { return o[f[0]] === undefined || o[f[0]] === null ? '' : String(o[f[0]]); });
  const row = rowNo || (sh.getLastRow() + 1);
  sh.getRange(row, 1, 1, EXP_HEADERS.length).setNumberFormat('@');
  sh.getRange(row, 1, 1, EXP_HEADERS.length).setValues([arr]);
  o._row = row;
}

function expFind_(sh, id) {
  const rows = expRows_(sh);
  for (let i = 0; i < rows.length; i++) if (rows[i].id === id && rows[i].status !== ST.DEL) return rows[i];
  return null;
}

function expReceiptsOf_(o) { try { const a = JSON.parse(o.receipts || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }

function expPublic_(o) {
  return {
    id: o.id, docNo: o.docNo, date: o.date, category: o.category, pay: o.pay, site: Number(o.site) || 0, budget: o.budget, vendor: o.vendor, memo: o.memo,
    total: Number(o.total) || 0, supply: Number(o.supply) || 0, vat: Number(o.vat) || 0, authorId: o.authorId, author: o.author, status: o.status,
    receipts: expReceiptsOf_(o).map(function (r) { return { n: r.n, name: r.name, size: r.size }; }), noReceipt: o.noReceipt, late: o.late === 'Y', claimMonth: o.claimMonth,
    reviewer: o.reviewer, reviewedAt: o.reviewedAt, approver: o.approver, approvedAt: o.approvedAt, reason: o.reason, created: o.created, updated: o.updated
  };
}

/** 엑셀에 적을 현장소장 이름(사용 중인 현장소장 계정 중 첫 사람). */
function siteManagerName_() {
  const rows = readUsers_(ensureUsersSheet_(getDb_()));
  for (let i = 0; i < rows.length; i++) if (rows[i][COL.role] === MANAGER_ROLE && rows[i][COL.active] === 'Y') return String(rows[i][COL.name]);
  return '';
}

function expClaimMonth_(o) { return o.claimMonth || String(o.date || '').slice(0, 7); }

// ── 월 마감 ──
const CLOSE_HEADERS = ['연월', '상태', '처리자', '처리일시', '건수', '합계', '사유'];

function ensureCloseSheet_(ss) {
  let sh = ss.getSheetByName(SHEET_CLOSE);
  if (!sh) {
    sh = ss.insertSheet(SHEET_CLOSE);
    sh.getRange(1, 1, sh.getMaxRows(), CLOSE_HEADERS.length).setNumberFormat('@'); // 2026-11 이 날짜로 바뀌지 않게 글자로 둔다
    sh.getRange(1, 1, 1, CLOSE_HEADERS.length).setValues([CLOSE_HEADERS]);
  }
  return sh;
}

/** 연월별 가장 마지막 줄이 '마감'인 달만 마감된 달이다(해제하면 다음 줄에 '해제'가 쌓인다). */
function closedMonths_(withHq) {
  const sh = ensureCloseSheet_(getDb_());
  const last = sh.getLastRow();
  if (last < 2) return [];
  const latest = {};
  sh.getRange(2, 1, last - 1, CLOSE_HEADERS.length).getValues().forEach(function (r) { latest[String(r[0])] = r; });
  const hq = withHq ? hqStates_() : {};
  return Object.keys(latest).sort().filter(function (ym) { return String(latest[ym][1]) === '마감'; }).map(function (ym) {
    const r = latest[ym];
    return { ym: ym, by: String(r[2]), at: String(r[3]), count: Number(r[4]) || 0, total: Number(r[5]) || 0, hq: withHq ? (hq[ym] || hqNone_()) : undefined };
  });
}

// ── 본사 제출·확인 표시 (본사 결재는 메일·전화로 하므로 시스템은 기록만 한다) ──
const HQ_HEADERS = ['연월', '단계', '처리자', '처리일시', '메모'];
const HQ_STEPS = ['제출', '확인', '취소'];
function ensureHqSheet_(ss) {
  let sh = ss.getSheetByName(SHEET_HQ);
  if (!sh) {
    sh = ss.insertSheet(SHEET_HQ);
    sh.getRange(1, 1, sh.getMaxRows(), HQ_HEADERS.length).setNumberFormat('@');
    sh.getRange(1, 1, 1, HQ_HEADERS.length).setValues([HQ_HEADERS]);
  }
  return sh;
}
function hqNone_() { return { state: '', by: '', at: '', note: '', submitAt: '', submitBy: '' }; }
/** 연월별 가장 마지막 줄이 현재 상태다. 제출·확인이면 그 상태, 취소(또는 줄 없음)면 빈 상태. */
function hqStates_() {
  const sh = ensureHqSheet_(getDb_());
  const last = sh.getLastRow(), out = {};
  if (last < 2) return out;
  const by = {};
  sh.getRange(2, 1, last - 1, HQ_HEADERS.length).getValues().forEach(function (r) { (by[String(r[0])] = by[String(r[0])] || []).push(r); });
  Object.keys(by).forEach(function (ym) {
    const rows = by[ym], r = rows[rows.length - 1], st = String(r[1]);
    if (st === '취소') { out[ym] = hqNone_(); return; }
    let sub = null;
    for (let i = rows.length - 1; i >= 0; i--) { if (String(rows[i][1]) === '취소') break; if (String(rows[i][1]) === '제출') { sub = rows[i]; break; } }
    out[ym] = { state: st, by: String(r[2]), at: String(r[3]), note: String(r[4]), submitAt: sub ? String(sub[3]) : '', submitBy: sub ? String(sub[2]) : '' };
  });
  return out;
}
function hqState_(ym) { return hqStates_()[ym] || hqNone_(); }

function isClosed_(list, ym) { return list.some(function (c) { return c.ym === ym; }); }

function nextYm_(ym) {
  let y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)) + 1;
  if (m > 12) { m = 1; y += 1; }
  return y + '-' + pad_(m, 2);
}

/** 마감된 달의 영수증은 마감을 풀지 않고 다음에 열려 있는 달에 「누락분」으로 청구한다. */
function lateClaimMonth_(dateYm, list) {
  let ym = nowStr_().slice(0, 7);
  const nx = nextYm_(dateYm);
  if (ym < nx) ym = nx;
  for (let i = 0; i < 36 && isClosed_(list, ym); i++) ym = nextYm_(ym);
  return ym;
}

// ── 번호 ──
/** 키별 일련번호. 쓰기 잠금 안에서만 부른다. */
function nextSeq_(key) {
  const sh = ensureSheet_(getDb_(), SHEET_SEQ, ['키', '마지막번호']);
  const last = sh.getLastRow();
  let n = 0, rowNo = 0;
  if (last >= 2) {
    const v = sh.getRange(2, 1, last - 1, 2).getValues();
    for (let i = 0; i < v.length; i++) if (String(v[i][0]) === key) { n = Number(v[i][1]) || 0; rowNo = i + 2; }
  }
  n += 1;
  if (rowNo) sh.getRange(rowNo, 2).setValues([[n]]);
  else sh.appendRow([key, n]);
  return n;
}

function pad_(n, w) { let t = String(n); while (t.length < w) t = '0' + t; return t; }

/** 문서번호: 호남-경비-2026-001 (구분별로 해마다 001부터) */
function nextDocNo_(kind) {
  const y = nowStr_().slice(0, 4);
  return '호남-' + kind + '-' + y + '-' + pad_(nextSeq_('DOC:' + kind + ':' + y), 3);
}

// ── 입력 확인 ──
function intOrNull_(v) {
  if (typeof v === 'number') return (isFinite(v) && Math.floor(v) === v) ? v : null;
  if (typeof v === 'string' && /^\d{1,12}$/.test(v.trim())) return Number(v.trim());
  return null;
}

function validDate_(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)), dd = Number(d.slice(8, 10));
  if (m < 1 || m > 12 || dd < 1) return false;
  const dim = [31, (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return dd <= dim;
}

function cleanText_(v, max) { return String(v === undefined || v === null ? '' : v).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max); }

/** 경비 항목 확인. 문제가 있으면 {err}, 없으면 {v}. 화면도 같은 규칙으로 먼저 확인한다. */
function expValidate_(p) {
  const v = {};
  v.date = cleanText_(p.date, 10);
  if (!validDate_(v.date)) return { err: fail_('PARAM', '사용일을 올바르게 입력해 주세요.') };
  if (v.date > nowStr_().slice(0, 10)) return { err: fail_('PARAM', '오늘 이후 날짜는 입력할 수 없습니다.') };
  if (v.date < '2026-01-01') return { err: fail_('PARAM', '사용일이 너무 오래되었습니다. 날짜를 확인해 주세요.') };
  v.category = String(p.category || '');
  if (EXP_CATEGORIES.indexOf(v.category) < 0) return { err: fail_('PARAM', '비목을 선택해 주세요.') };
  v.pay = String(p.pay || '');
  if (EXP_PAY.indexOf(v.pay) < 0) return { err: fail_('PARAM', '결제수단을 선택해 주세요.') };
  const site = intOrNull_(p.site === undefined || p.site === '' ? 0 : p.site);
  if (site === null || (site !== 0 && !SITES.some(function (r) { return r[0] === site; }))) return { err: fail_('PARAM', '개소를 선택해 주세요. (개소 없는 비용은 「공통」)') };
  v.site = site;
  v.budget = cleanText_(p.budget, 20) || EXP_CAT_BUDGET[v.category] || EXP_DEFAULT_BUDGET;
  if (EXP_BUDGET.indexOf(v.budget) < 0) return { err: fail_('PARAM', '예산 항목을 선택해 주세요.') };
  v.vendor = cleanText_(p.vendor, 60);
  if (v.vendor.length < 1) return { err: fail_('PARAM', '사용처(거래처)를 입력해 주세요.') };
  v.memo = cleanText_(p.memo, 200);
  if (v.memo.length < 2) return { err: fail_('PARAM', '적요(지출 내용·목적)를 입력해 주세요.') };
  const total = intOrNull_(p.total);
  if (total === null || total < 1 || total > 1000000000) return { err: fail_('PARAM', '합계 금액은 1원 이상 10억원 이하의 숫자여야 합니다.') };
  v.total = total;
  let vat = (p.vat === undefined || p.vat === null || p.vat === '') ? null : intOrNull_(p.vat);
  let supply = (p.supply === undefined || p.supply === null || p.supply === '') ? null : intOrNull_(p.supply);
  if (vat === null && supply === null) { supply = Math.round(total / 1.1); vat = total - supply; }
  else if (vat === null) vat = total - supply;
  else if (supply === null) supply = total - vat;
  if (vat === null || supply === null || vat < 0 || supply < 0 || supply + vat !== total) return { err: fail_('PARAM', '공급가액과 부가세를 더하면 합계 금액과 같아야 합니다.') };
  v.supply = supply; v.vat = vat;
  v.noReceipt = cleanText_(p.noReceipt, 100);
  return { v: v };
}

// ── 영수증(드라이브) ──
function receiptRoot_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('RECEIPT_ROOT');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* 지워졌으면 새로 만든다 */ } }
  const f = DriveApp.createFolder('HN28_영수증');
  props.setProperty('RECEIPT_ROOT', f.getId());
  return f;
}

function receiptFolder_(ym) {
  const root = receiptRoot_();
  const it = root.getFoldersByName(ym);
  return it.hasNext() ? it.next() : root.createFolder(ym);
}

function imageKind_(b) {
  const u = function (i) { return (b[i] === undefined ? -1 : (b[i] & 255)); };
  if (u(0) === 0xFF && u(1) === 0xD8 && u(2) === 0xFF) return { mime: 'image/jpeg', ext: 'jpg' };
  if (u(0) === 0x89 && u(1) === 0x50 && u(2) === 0x4E && u(3) === 0x47) return { mime: 'image/png', ext: 'png' };
  if (u(0) === 0x52 && u(1) === 0x49 && u(2) === 0x46 && u(3) === 0x46 && u(8) === 0x57 && u(9) === 0x45 && u(10) === 0x42 && u(11) === 0x50) return { mime: 'image/webp', ext: 'webp' };
  return null;
}

/** 새 영수증 사진을 미리 확인한다(저장 전). 문제가 있으면 {err}, 없으면 {items:[{bytes,kind}]}. */
function receiptsPrecheck_(list) {
  const items = [];
  for (let i = 0; i < list.length; i++) {
    const r = list[i] || {};
    const data = String(r.data || '');
    if (!data || data.length > MAX_RECEIPT_B64 || !/^[A-Za-z0-9+\/=]+$/.test(data)) return { err: fail_('RECEIPT', '영수증 사진이 너무 크거나 형식이 맞지 않습니다. 다시 찍어 주세요.') };
    let bytes;
    try { bytes = Utilities.base64Decode(data); } catch (e) { return { err: fail_('RECEIPT', '영수증 사진을 읽지 못했습니다.') }; }
    const kind = imageKind_(bytes);
    if (!kind) return { err: fail_('RECEIPT', '사진(JPG·PNG·WEBP) 파일만 올릴 수 있습니다.') };
    items.push({ bytes: bytes, kind: kind });
  }
  return { items: items };
}

function receiptsSave_(o, items) {
  const have = expReceiptsOf_(o);
  const folder = receiptFolder_(String(o.date).slice(0, 7));
  let n = have.reduce(function (m, r) { return Math.max(m, Number(r.n) || 0); }, 0);
  items.forEach(function (it) {
    n += 1;
    const name = o.id + '_' + n + '.' + it.kind.ext;
    const f = folder.createFile(Utilities.newBlob(it.bytes, it.kind.mime, name));
    have.push({ fid: f.getId(), name: name, size: it.bytes.length, n: n });
  });
  o.receipts = JSON.stringify(have);
}

// ── 목록 ──
function listExpenses_(req) {
  const g = expAuth_(req); if (g.err) return g.err;
  const sh = ensureExpSheet_(getDb_());
  const rows = expRows_(sh).filter(function (o) { return o.status !== ST.DEL; });
  let out;
  if (req.queue) out = rows.filter(function (o) { return o.status === ST.REVIEW || o.status === ST.APPROVAL; });
  else if (/^\d{4}-\d{2}$/.test(String(req.upTo || ''))) { // 착공일부터 이 달까지 승인된 경비(실행예산 누계용)
    out = rows.filter(function (o) { return o.status === ST.DONE && expClaimMonth_(o) <= String(req.upTo); });
  } else {
    const ym = /^\d{4}-\d{2}$/.test(String(req.month || '')) ? String(req.month) : nowStr_().slice(0, 7);
    out = rows.filter(function (o) { return expClaimMonth_(o) === ym; });
  }
  out.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (a.id < b.id ? 1 : -1); });
  return { ok: true, items: out.map(expPublic_), closed: closedMonths_(true) };
}

// ── 저장(새로 쓰기·고치기) ──
function saveExpense_(req) {
  const g = expAuth_(req); if (g.err) return g.err;
  const me = g.s;
  const chk = expValidate_(req); if (chk.err) return chk.err;
  const v = chk.v;
  const add = Array.isArray(req.newReceipts) ? req.newReceipts : [];
  const drop = Array.isArray(req.removeReceipts) ? req.removeReceipts.map(Number) : [];
  if (add.length > MAX_RECEIPTS) return fail_('RECEIPT', '영수증 사진은 최대 ' + MAX_RECEIPTS + '장까지 올릴 수 있습니다.');
  const pre = receiptsPrecheck_(add); if (pre.err) return pre.err;
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = ensureExpSheet_(getDb_());
    let o = null;
    if (req.id) {
      o = expFind_(sh, String(req.id));
      if (!o) return fail_('NOT_FOUND', '없는 경비입니다.');
      if (o.authorId !== me.id) return fail_('FORBIDDEN', '본인이 쓴 경비만 고칠 수 있습니다.');
      if (o.status !== ST.DRAFT && o.status !== ST.REJECT) return fail_('STATE', '이미 제출된 경비는 고칠 수 없습니다. 반려된 뒤에 고칠 수 있습니다.');
    }
    if (!req.force) {
      const dup = expRows_(sh).filter(function (x) { return x.status !== ST.DEL && (!o || x.id !== o.id) && x.date === v.date && x.vendor === v.vendor && Number(x.total) === v.total; });
      if (dup.length) return fail_('DUP', '같은 날짜·사용처·금액의 경비가 이미 있습니다. (' + (dup[0].docNo || dup[0].id) + ') 그래도 저장하려면 확인해 주세요.', { dup: dup.map(function (x) { return x.docNo || x.id; }) });
    }
    if (!o) {
      o = { id: 'EXP-' + nowStr_().slice(0, 7).replace('-', '') + '-' + pad_(nextSeq_('EXP:' + nowStr_().slice(0, 7)), 4), docNo: '', status: ST.DRAFT, authorId: me.id, author: me.name, receipts: '[]', late: '', claimMonth: '', reviewer: '', reviewedAt: '', approver: '', approvedAt: '', reason: '', created: nowStr_() };
    }
    const keep = expReceiptsOf_(o).filter(function (r) { return drop.indexOf(Number(r.n)) < 0; });
    if (keep.length + pre.items.length > MAX_RECEIPTS) return fail_('RECEIPT', '영수증 사진은 최대 ' + MAX_RECEIPTS + '장까지 올릴 수 있습니다.');
    o.receipts = JSON.stringify(keep);
    o.date = v.date; o.category = v.category; o.pay = v.pay; o.site = String(v.site); o.budget = v.budget; o.vendor = v.vendor; o.memo = v.memo;
    o.total = String(v.total); o.supply = String(v.supply); o.vat = String(v.vat); o.noReceipt = v.noReceipt;
    if (pre.items.length) receiptsSave_(o, pre.items);
    const isNew = !o._row;
    expWrite_(sh, o, o._row);
    audit_(me.id, isNew ? '경비작성' : '경비수정', o.id + (o.docNo ? ' / ' + o.docNo : ''));
    return { ok: true, item: expPublic_(o) };
  } finally {
    lock.releaseLock();
  }
}

function submitExpense_(req) {
  const g = expAuth_(req); if (g.err) return g.err;
  const me = g.s;
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = ensureExpSheet_(getDb_());
    const o = expFind_(sh, String(req.id || ''));
    if (!o) return fail_('NOT_FOUND', '없는 경비입니다.');
    if (o.authorId !== me.id) return fail_('FORBIDDEN', '본인이 쓴 경비만 제출할 수 있습니다.');
    if (o.status !== ST.DRAFT && o.status !== ST.REJECT) return fail_('STATE', '이미 제출된 경비입니다.');
    if (!expReceiptsOf_(o).length && !o.noReceipt) return fail_('RECEIPT', '영수증 사진을 올리거나, 영수증이 없는 사유를 적어 주세요.');
    const closed = closedMonths_();
    const dateYm = String(o.date).slice(0, 7);
    if (isClosed_(closed, dateYm)) {
      const cm = lateClaimMonth_(dateYm, closed);
      if (String(req.lateOk || '') !== cm) {
        return fail_('LATE', dateYm + '은(는) 이미 마감된 달입니다. 이 경비를 「' + dateYm + ' 누락분」으로 ' + cm + ' 청구분에 올릴까요? (사용일은 그대로입니다.)', { claimMonth: cm, dateYm: dateYm });
      }
      o.late = 'Y'; o.claimMonth = cm;
    } else { o.late = ''; o.claimMonth = ''; }
    if (!o.docNo) o.docNo = nextDocNo_('경비');
    o.reason = ''; o.reviewer = ''; o.reviewedAt = ''; o.approver = ''; o.approvedAt = '';
    o.status = me.role === '공무' ? ST.APPROVAL : ST.REVIEW; // 공무가 쓴 경비는 본인이 검토할 수 없으므로 검토 단계를 건너뛴다
    expWrite_(sh, o, o._row);
    audit_(me.id, '경비제출', o.docNo + ' → ' + o.status);
    return { ok: true, item: expPublic_(o) };
  } finally {
    lock.releaseLock();
  }
}

function reviewExpense_(req) {
  const g = expAuth_(req); if (g.err) return g.err;
  const me = g.s;
  if (me.role !== '공무' && me.role !== MANAGER_ROLE) return fail_('FORBIDDEN', '공무 또는 현장소장만 검토할 수 있습니다.');
  const reason = cleanText_(req.reason, 200);
  const ok = req.decision === 'ok';
  if (!ok && reason.length < 2) return fail_('PARAM', '반려 사유를 적어 주세요.');
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = ensureExpSheet_(getDb_());
    const o = expFind_(sh, String(req.id || ''));
    if (!o) return fail_('NOT_FOUND', '없는 경비입니다.');
    if (o.status !== ST.REVIEW) return fail_('STATE', '검토 대기 중인 경비가 아닙니다.');
    if (o.authorId === me.id) return fail_('SELF', '본인이 쓴 경비는 본인이 검토할 수 없습니다.');
    if (ok && isClosed_(closedMonths_(), expClaimMonth_(o))) return fail_('CLOSED', expClaimMonth_(o) + '은(는) 마감된 달입니다. 마감 뒤에 처리할 수 없으니 반려해서 작성자가 누락분으로 다시 제출하게 하거나, 현장소장이 마감을 해제해 주세요.');
    if (ok) { o.status = ST.APPROVAL; o.reviewer = me.name; o.reviewedAt = nowStr_(); o.reason = ''; }
    else { o.status = ST.REJECT; o.reviewer = me.name; o.reviewedAt = nowStr_(); o.reason = reason; }
    expWrite_(sh, o, o._row);
    audit_(me.id, ok ? '경비검토' : '경비반려(검토)', o.docNo);
    return { ok: true, item: expPublic_(o) };
  } finally {
    lock.releaseLock();
  }
}

function approveExpense_(req) {
  const g = expAuth_(req); if (g.err) return g.err;
  const me = g.s;
  if (me.role !== MANAGER_ROLE) return fail_('FORBIDDEN', '현장소장만 승인할 수 있습니다.');
  const reason = cleanText_(req.reason, 200);
  const ok = req.decision === 'ok';
  if (!ok && reason.length < 2) return fail_('PARAM', '반려 사유를 적어 주세요.');
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = ensureExpSheet_(getDb_());
    const o = expFind_(sh, String(req.id || ''));
    if (!o) return fail_('NOT_FOUND', '없는 경비입니다.');
    if (o.status !== ST.APPROVAL) return fail_('STATE', '승인 대기 중인 경비가 아닙니다.');
    if (ok && isClosed_(closedMonths_(), expClaimMonth_(o))) return fail_('CLOSED', expClaimMonth_(o) + '은(는) 마감된 달입니다. 마감 뒤에 승인할 수 없으니 반려해서 작성자가 누락분으로 다시 제출하게 하거나, 마감을 해제해 주세요.');
    if (ok) { o.status = ST.DONE; o.approver = me.name; o.approvedAt = nowStr_(); o.reason = ''; }
    else { o.status = ST.REJECT; o.approver = me.name; o.approvedAt = nowStr_(); o.reason = reason; }
    expWrite_(sh, o, o._row);
    audit_(me.id, ok ? '경비승인' : '경비반려(승인)', o.docNo);
    return { ok: true, item: expPublic_(o) };
  } finally {
    lock.releaseLock();
  }
}

/** 작성중·반려 상태의 본인 경비만 지운다. 번호가 이미 나간 건은 기록을 남기고 삭제 표시만 한다. */
function deleteExpense_(req) {
  const g = expAuth_(req); if (g.err) return g.err;
  const me = g.s;
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = ensureExpSheet_(getDb_());
    const o = expFind_(sh, String(req.id || ''));
    if (!o) return fail_('NOT_FOUND', '없는 경비입니다.');
    if (o.authorId !== me.id) return fail_('FORBIDDEN', '본인이 쓴 경비만 지울 수 있습니다.');
    if (o.status !== ST.DRAFT && o.status !== ST.REJECT) return fail_('STATE', '제출된 경비는 지울 수 없습니다.');
    o.status = ST.DEL;
    expWrite_(sh, o, o._row);
    audit_(me.id, '경비삭제', o.docNo || o.id);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// ───────────────────────────── 4단계: 작업일보 ─────────────────────────────
// 개소별 계획 착수·완료(11.04 예정공정표 기준: 협업/master/개소_마스터.csv). 예정공정표를 다시 세우면 이 표만 고친다.
const OPS_PLAN = {
  27: ["2026-11-13", "2027-01-04"],
  26: ["2027-01-06", "2027-02-01"],
  1: ["2027-01-26", "2027-02-20"],
  2: ["2027-02-16", "2027-03-06"],
  3: ["2027-03-02", "2027-03-19"],
  4: ["2027-03-15", "2027-03-30"],
  5: ["2027-03-26", "2027-04-10"],
  6: ["2027-04-06", "2027-04-26"],
  7: ["2027-04-21", "2027-05-07"],
  8: ["2027-05-08", "2027-05-19"],
  9: ["2027-05-14", "2027-06-03"],
  10: ["2027-05-31", "2027-06-29"],
  11: ["2027-06-30", "2027-07-29"],
  12: ["2027-07-31", "2027-08-31"],
  13: ["2027-09-01", "2027-09-22"],
  14: ["2027-09-24", "2027-10-07"],
  15: ["2027-10-08", "2027-10-28"],
  16: ["2027-10-21", "2027-11-12"],
  17: ["2027-11-08", "2027-12-18"],
  18: ["2027-12-09", "2027-12-29"],
  19: ["2027-12-30", "2028-01-14"],
  20: ["2028-01-17", "2028-02-11"],
  21: ["2028-02-05", "2028-03-23"],
  22: ["2028-02-17", "2028-03-03"],
  23: ["2028-02-28", "2028-04-01"],
  25: ["2028-03-28", "2028-04-14"]
};
// 휴무일(일요일·법정공휴일·명절중지, 11.04 예정공정표 기준). [날짜, 구분]
const OPS_HOLIDAYS = [
  ["2026-11-08", "일요일"], ["2026-11-15", "일요일"], ["2026-11-22", "일요일"], ["2026-11-29", "일요일"], ["2026-12-06", "일요일"], ["2026-12-13", "일요일"],
  ["2026-12-20", "일요일"], ["2026-12-25", "법정공휴일"], ["2026-12-27", "일요일"], ["2027-01-01", "법정공휴일"], ["2027-01-03", "일요일"], ["2027-01-10", "일요일"],
  ["2027-01-17", "일요일"], ["2027-01-24", "일요일"], ["2027-01-31", "일요일"], ["2027-02-03", "명절중지"], ["2027-02-04", "명절중지"], ["2027-02-05", "명절중지"],
  ["2027-02-06", "법정공휴일"], ["2027-02-07", "법정공휴일"], ["2027-02-08", "법정공휴일"], ["2027-02-09", "법정공휴일"], ["2027-02-10", "명절중지"], ["2027-02-11", "명절중지"],
  ["2027-02-12", "명절중지"], ["2027-02-14", "일요일"], ["2027-02-21", "일요일"], ["2027-02-28", "일요일"], ["2027-03-01", "법정공휴일"], ["2027-03-07", "일요일"],
  ["2027-03-14", "일요일"], ["2027-03-21", "일요일"], ["2027-03-28", "일요일"], ["2027-04-04", "일요일"], ["2027-04-11", "일요일"], ["2027-04-18", "일요일"],
  ["2027-04-25", "일요일"], ["2027-05-01", "법정공휴일"], ["2027-05-02", "일요일"], ["2027-05-03", "법정공휴일"], ["2027-05-05", "법정공휴일"], ["2027-05-09", "일요일"],
  ["2027-05-13", "법정공휴일"], ["2027-05-16", "일요일"], ["2027-05-23", "일요일"], ["2027-05-30", "일요일"], ["2027-06-06", "법정공휴일"], ["2027-06-13", "일요일"],
  ["2027-06-20", "일요일"], ["2027-06-27", "일요일"], ["2027-07-04", "일요일"], ["2027-07-11", "일요일"], ["2027-07-17", "법정공휴일"], ["2027-07-18", "일요일"],
  ["2027-07-19", "법정공휴일"], ["2027-07-25", "일요일"], ["2027-08-01", "일요일"], ["2027-08-08", "일요일"], ["2027-08-15", "법정공휴일"], ["2027-08-16", "법정공휴일"],
  ["2027-08-22", "일요일"], ["2027-08-29", "일요일"], ["2027-09-05", "일요일"], ["2027-09-11", "명절중지"], ["2027-09-12", "명절중지"], ["2027-09-13", "명절중지"],
  ["2027-09-14", "법정공휴일"], ["2027-09-15", "법정공휴일"], ["2027-09-16", "법정공휴일"], ["2027-09-17", "명절중지"], ["2027-09-18", "명절중지"], ["2027-09-19", "명절중지"],
  ["2027-09-26", "일요일"], ["2027-10-03", "법정공휴일"], ["2027-10-04", "법정공휴일"], ["2027-10-09", "법정공휴일"], ["2027-10-10", "일요일"], ["2027-10-11", "법정공휴일"],
  ["2027-10-17", "일요일"], ["2027-10-24", "일요일"], ["2027-10-31", "일요일"], ["2027-11-07", "일요일"], ["2027-11-14", "일요일"], ["2027-11-21", "일요일"],
  ["2027-11-28", "일요일"], ["2027-12-05", "일요일"], ["2027-12-12", "일요일"], ["2027-12-19", "일요일"], ["2027-12-25", "법정공휴일"], ["2027-12-26", "일요일"],
  ["2027-12-27", "법정공휴일"], ["2028-01-01", "법정공휴일"], ["2028-01-02", "일요일"], ["2028-01-09", "일요일"], ["2028-01-16", "일요일"], ["2028-01-23", "명절중지"],
  ["2028-01-24", "명절중지"], ["2028-01-25", "명절중지"], ["2028-01-26", "법정공휴일"], ["2028-01-27", "법정공휴일"], ["2028-01-28", "법정공휴일"], ["2028-01-29", "명절중지"],
  ["2028-01-30", "명절중지"], ["2028-01-31", "명절중지"], ["2028-02-06", "일요일"], ["2028-02-13", "일요일"], ["2028-02-20", "일요일"], ["2028-02-27", "일요일"],
  ["2028-03-01", "법정공휴일"], ["2028-03-05", "일요일"], ["2028-03-12", "일요일"], ["2028-03-19", "일요일"], ["2028-03-26", "일요일"], ["2028-04-02", "일요일"],
  ["2028-04-09", "일요일"], ["2028-04-12", "법정공휴일"], ["2028-04-16", "일요일"], ["2028-04-23", "일요일"], ["2028-04-30", "일요일"], ["2028-05-01", "법정공휴일"],
  ["2028-05-02", "법정공휴일"], ["2028-05-05", "법정공휴일"], ["2028-05-07", "일요일"], ["2028-05-14", "일요일"], ["2028-05-21", "일요일"], ["2028-05-28", "일요일"]
];
const OPS_WEATHER = ['맑음', '구름조금', '흐림', '비', '눈', '강풍·한파'];
const OPS_KINDS = ['계획', '선행', '지연만회', '추가', '변경'];
const OST = { DRAFT: '작성중', WAIT: '확인대기', DONE: '확인완료', REJECT: '반려', DEL: '삭제' };
const OPS_FIELDS = [['id', 'ID'], ['docNo', '일보번호'], ['date', '작업일'], ['weather', '날씨'], ['site', '개소'], ['kind', '구분'], ['progress', '누계진행률'], ['offReason', '계획외사유'],
  ['staff', '직원'], ['worker', '기능공·일용'], ['safety', '열차감시원·신호수'], ['equip', '장비·자재'], ['memo', '작업내용'], ['authorId', '작성자ID'], ['author', '작성자'],
  ['status', '상태'], ['confirmer', '확인자'], ['confirmedAt', '확인일시'], ['reason', '반려사유'], ['created', '작성일시'], ['updated', '수정일시']];
const OPS_HEADERS = OPS_FIELDS.map(function (f) { return f[1]; });

function ensureOpsSheet_(ss) {
  let sh = ss.getSheetByName(SHEET_OPS);
  if (!sh) {
    sh = ss.insertSheet(SHEET_OPS);
    sh.getRange(1, 1, sh.getMaxRows(), OPS_HEADERS.length).setNumberFormat('@');
    sh.getRange(1, 1, 1, OPS_HEADERS.length).setValues([OPS_HEADERS]);
  }
  return sh;
}

function opsRows_(sh) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, OPS_HEADERS.length).getValues().map(function (r, i) {
    const o = { _row: i + 2 };
    OPS_FIELDS.forEach(function (f, k) { o[f[0]] = r[k] === null || r[k] === undefined ? '' : String(r[k]); });
    return o;
  });
}

function opsWrite_(sh, o, rowNo) {
  o.updated = nowStr_();
  const arr = OPS_FIELDS.map(function (f) { return o[f[0]] === undefined || o[f[0]] === null ? '' : String(o[f[0]]); });
  const row = rowNo || (sh.getLastRow() + 1);
  sh.getRange(row, 1, 1, OPS_HEADERS.length).setNumberFormat('@');
  sh.getRange(row, 1, 1, OPS_HEADERS.length).setValues([arr]);
  o._row = row;
}

function opsFind_(sh, id) {
  const rows = opsRows_(sh);
  for (let i = 0; i < rows.length; i++) if (rows[i].id === id && rows[i].status !== OST.DEL) return rows[i];
  return null;
}

function opsPublic_(o) {
  const staff = Number(o.staff) || 0, worker = Number(o.worker) || 0, safety = Number(o.safety) || 0;
  return {
    id: o.id, docNo: o.docNo, date: o.date, weather: o.weather, site: Number(o.site) || 0, kind: o.kind, progress: o.progress === '' ? null : Number(o.progress), offReason: o.offReason,
    staff: staff, worker: worker, safety: safety, people: staff + worker + safety, equip: o.equip, memo: o.memo, authorId: o.authorId, author: o.author, status: o.status,
    confirmer: o.confirmer, confirmedAt: o.confirmedAt, reason: o.reason, created: o.created, updated: o.updated
  };
}

/** 계획 대비 위치: 휴무일 이름(없으면 ''), 계획 기간 안(in)·앞(before)·뒤(after)·개소 없음(common) */
function opsJudge_(date, site) {
  let hol = '';
  for (let i = 0; i < OPS_HOLIDAYS.length; i++) if (OPS_HOLIDAYS[i][0] === date) { hol = OPS_HOLIDAYS[i][1]; break; }
  const p = site ? OPS_PLAN[site] : null;
  const pos = p ? (date < p[0] ? 'before' : date > p[1] ? 'after' : 'in') : 'common';
  return { hol: hol, pos: pos };
}

/** 계획 밖 사유가 필요한 이유 목록(없으면 빈 배열). 화면도 같은 규칙을 쓴다. */
function opsOffPlanWhy_(date, site, kind) {
  const j = opsJudge_(date, site), why = [];
  if (j.hol) why.push(j.hol + ' 작업');
  if (j.pos === 'before') why.push('계획 착수일보다 앞선 작업');
  if (j.pos === 'after') why.push('계획 완료일보다 늦은 작업');
  if (kind !== '계획') why.push('구분이 「' + kind + '」');
  return why;
}

function opsCount_(v, name) {
  const n = (v === undefined || v === null || v === '') ? 0 : intOrNull_(v);
  if (n === null || n < 0 || n > 999) return { err: fail_('PARAM', name + ' 인원은 0명 이상 999명 이하의 숫자로 입력해 주세요.') };
  return { n: n };
}

/** 작업일보 입력 확인. 문제가 있으면 {err}, 없으면 {v}. */
function opsValidate_(p) {
  const v = {};
  v.date = cleanText_(p.date, 10);
  if (!validDate_(v.date)) return { err: fail_('PARAM', '작업일을 올바르게 입력해 주세요.') };
  if (v.date > nowStr_().slice(0, 10)) return { err: fail_('PARAM', '오늘 이후 날짜의 작업일보는 쓸 수 없습니다.') };
  if (v.date < '2026-01-01') return { err: fail_('PARAM', '작업일이 너무 오래되었습니다. 날짜를 확인해 주세요.') };
  v.weather = String(p.weather || '');
  if (OPS_WEATHER.indexOf(v.weather) < 0) return { err: fail_('PARAM', '날씨를 선택해 주세요.') };
  const site = intOrNull_(p.site === undefined || p.site === '' ? 0 : p.site);
  if (site === null || (site !== 0 && !SITES.some(function (r) { return r[0] === site; }))) return { err: fail_('PARAM', '개소를 선택해 주세요. (개소 없는 일은 「공통」)') };
  v.site = site;
  v.kind = String(p.kind || '계획');
  if (OPS_KINDS.indexOf(v.kind) < 0) return { err: fail_('PARAM', '작업 구분을 선택해 주세요.') };
  const a = opsCount_(p.staff, '직원·관리자'); if (a.err) return a;
  const b = opsCount_(p.worker, '기능공·일용직'); if (b.err) return b;
  const c = opsCount_(p.safety, '열차감시원·신호수'); if (c.err) return c;
  v.staff = a.n; v.worker = b.n; v.safety = c.n;
  if (v.site) {
    const pg = intOrNull_(p.progress);
    if (pg === null || pg < 0 || pg > 100) return { err: fail_('PARAM', '누계 진행률은 0~100 사이의 정수(%)로 입력해 주세요.') };
    v.progress = pg;
  } else v.progress = '';
  v.equip = cleanText_(p.equip, 120);
  v.memo = cleanText_(p.memo, 300);
  if (v.memo.length < 2) return { err: fail_('PARAM', '금일 작업내용을 입력해 주세요. (작업이 없었다면 그 사유)') };
  const why = opsOffPlanWhy_(v.date, v.site, v.kind);
  v.offReason = cleanText_(p.offReason, 200);
  if (why.length) { if (v.offReason.length < 2) return { err: fail_('PARAM', '계획 밖 작업입니다 (' + why.join(' · ') + '). 사유를 적어 주세요.') }; }
  else v.offReason = '';
  return { v: v };
}

/** 같은 개소의 이미 올라간(확인대기·확인완료) 일보와 비교해 누계 진행률이 거꾸로 가지 않는지 본다. 문제가 있으면 안내 글을 돌려준다. */
function opsProgressProblem_(rows, o) {
  const site = Number(o.site) || 0; if (!site || o.progress === '') return '';
  const pg = Number(o.progress);
  let prev = null, next = null;
  rows.forEach(function (x) {
    if (x.id === o.id || Number(x.site) !== site || (x.status !== OST.WAIT && x.status !== OST.DONE) || x.progress === '') return;
    const xp = Number(x.progress);
    if (x.date <= o.date) { if (!prev || xp > prev.p) prev = { p: xp, d: x.date }; }
    else if (!next || xp < next.p) next = { p: xp, d: x.date };
  });
  if (prev && pg < prev.p) return '같은 개소의 ' + prev.d + ' 일보 누계 진행률이 ' + prev.p + '%입니다. 그보다 낮을 수 없습니다.';
  if (next && pg > next.p) return '같은 개소의 ' + next.d + ' 일보 누계 진행률이 ' + next.p + '%입니다. 그보다 높을 수 없습니다.';
  return '';
}

function opsClosedMsg_(ym) { return ym + '은(는) 마감된 달입니다. 현장소장이 마감을 해제해야 이 달 작업일보를 올리거나 확인할 수 있습니다.'; }

function listOps_(req) {
  const g = expAuth_(req); if (g.err) return g.err;
  const rows = opsRows_(ensureOpsSheet_(getDb_())).filter(function (o) { return o.status !== OST.DEL; });
  let out;
  if (req.queue) out = rows.filter(function (o) { return o.status === OST.WAIT; });
  else {
    const ym = /^\d{4}-\d{2}$/.test(String(req.month || '')) ? String(req.month) : nowStr_().slice(0, 7);
    out = rows.filter(function (o) { return String(o.date).slice(0, 7) === ym; });
  }
  // 개소별 가장 최근 누계 진행률(올라간 일보 기준) — 새 일보의 기본값으로 쓴다
  const latest = {};
  rows.forEach(function (o) {
    const s = Number(o.site) || 0; if (!s || o.progress === '' || (o.status !== OST.WAIT && o.status !== OST.DONE)) return;
    const cur = latest[s];
    if (!cur || o.date > cur.date || (o.date === cur.date && Number(o.progress) > cur.pct)) latest[s] = { date: o.date, pct: Number(o.progress) };
  });
  out.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (a.id < b.id ? 1 : -1); });
  return { ok: true, items: out.map(opsPublic_), closed: closedMonths_(true), latest: latest };
}

function saveOps_(req) {
  const g = expAuth_(req); if (g.err) return g.err;
  const me = g.s;
  const chk = opsValidate_(req); if (chk.err) return chk.err;
  const v = chk.v;
  if (isClosed_(closedMonths_(), v.date.slice(0, 7))) return fail_('CLOSED', opsClosedMsg_(v.date.slice(0, 7)));
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = ensureOpsSheet_(getDb_());
    const rows = opsRows_(sh);
    let o = null;
    if (req.id) {
      o = null; for (let i = 0; i < rows.length; i++) if (rows[i].id === String(req.id) && rows[i].status !== OST.DEL) o = rows[i];
      if (!o) return fail_('NOT_FOUND', '없는 작업일보입니다.');
      if (o.authorId !== me.id) return fail_('FORBIDDEN', '본인이 쓴 작업일보만 고칠 수 있습니다.');
      if (o.status !== OST.DRAFT && o.status !== OST.REJECT) return fail_('STATE', '이미 제출된 작업일보는 고칠 수 없습니다. 반려된 뒤에 고칠 수 있습니다.');
    }
    if (!req.force && v.site) {
      const dup = rows.filter(function (x) { return (!o || x.id !== o.id) && x.date === v.date && Number(x.site) === v.site && (x.status === OST.DRAFT || x.status === OST.WAIT || x.status === OST.DONE); });
      if (dup.length) return fail_('DUP', v.date + ' 같은 개소의 작업일보가 이미 있습니다. (' + (dup[0].docNo || dup[0].id) + ' · ' + dup[0].author + ') 그래도 저장하려면 확인해 주세요.', { dup: dup.map(function (x) { return x.docNo || x.id; }) });
    }
    if (!o) {
      const ym = nowStr_().slice(0, 7).replace('-', '');
      o = { id: 'OPS-' + ym + '-' + pad_(nextSeq_('OPS:' + ym), 4), docNo: '', status: OST.DRAFT, authorId: me.id, author: me.name, confirmer: '', confirmedAt: '', reason: '', created: nowStr_() };
    }
    o.date = v.date; o.weather = v.weather; o.site = String(v.site); o.kind = v.kind; o.progress = String(v.progress); o.offReason = v.offReason;
    o.staff = String(v.staff); o.worker = String(v.worker); o.safety = String(v.safety); o.equip = v.equip; o.memo = v.memo;
    const isNew = !o._row;
    opsWrite_(sh, o, o._row);
    audit_(me.id, isNew ? '일보작성' : '일보수정', o.id + (o.docNo ? ' / ' + o.docNo : ''));
    return { ok: true, item: opsPublic_(o) };
  } finally {
    lock.releaseLock();
  }
}

function submitOps_(req) {
  const g = expAuth_(req); if (g.err) return g.err;
  const me = g.s;
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = ensureOpsSheet_(getDb_());
    const rows = opsRows_(sh);
    let o = null; for (let i = 0; i < rows.length; i++) if (rows[i].id === String(req.id || '') && rows[i].status !== OST.DEL) o = rows[i];
    if (!o) return fail_('NOT_FOUND', '없는 작업일보입니다.');
    if (o.authorId !== me.id) return fail_('FORBIDDEN', '본인이 쓴 작업일보만 제출할 수 있습니다.');
    if (o.status !== OST.DRAFT && o.status !== OST.REJECT) return fail_('STATE', '이미 제출된 작업일보입니다.');
    if (isClosed_(closedMonths_(), o.date.slice(0, 7))) return fail_('CLOSED', opsClosedMsg_(o.date.slice(0, 7)));
    const pp = opsProgressProblem_(rows, o); if (pp) return fail_('PROGRESS', pp);
    if (!o.docNo) o.docNo = nextDocNo_('일보');
    o.reason = ''; o.confirmer = ''; o.confirmedAt = '';
    o.status = OST.WAIT;
    opsWrite_(sh, o, o._row);
    audit_(me.id, '일보제출', o.docNo);
    return { ok: true, item: opsPublic_(o) };
  } finally {
    lock.releaseLock();
  }
}

/** 확인(공무·현장소장, 작성자 본인 제외) 또는 반려. 현장소장은 이미 확인한 일보도 마감 전이면 사유를 적어 되돌릴 수 있다. */
function confirmOps_(req) {
  const g = expAuth_(req); if (g.err) return g.err;
  const me = g.s;
  if (me.role !== '공무' && me.role !== MANAGER_ROLE) return fail_('FORBIDDEN', '공무 또는 현장소장만 확인할 수 있습니다.');
  const reason = cleanText_(req.reason, 200);
  const ok = req.decision === 'ok';
  if (!ok && reason.length < 2) return fail_('PARAM', '반려 사유를 적어 주세요.');
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = ensureOpsSheet_(getDb_());
    const rows = opsRows_(sh);
    let o = null; for (let i = 0; i < rows.length; i++) if (rows[i].id === String(req.id || '') && rows[i].status !== OST.DEL) o = rows[i];
    if (!o) return fail_('NOT_FOUND', '없는 작업일보입니다.');
    const ym = o.date.slice(0, 7);
    if (o.status === OST.DONE) { // 확인 취소(되돌리기)
      if (ok || me.role !== MANAGER_ROLE) return fail_('STATE', '확인 대기 중인 작업일보가 아닙니다.');
      if (isClosed_(closedMonths_(), ym)) return fail_('CLOSED', opsClosedMsg_(ym));
    } else {
      if (o.status !== OST.WAIT) return fail_('STATE', '확인 대기 중인 작업일보가 아닙니다.');
      if (o.authorId === me.id) return fail_('SELF', '본인이 쓴 작업일보는 본인이 확인할 수 없습니다.');
      if (ok && isClosed_(closedMonths_(), ym)) return fail_('CLOSED', opsClosedMsg_(ym));
    }
    if (ok) { o.status = OST.DONE; o.confirmer = me.name; o.confirmedAt = nowStr_(); o.reason = ''; }
    else { o.status = OST.REJECT; o.confirmer = me.name; o.confirmedAt = nowStr_(); o.reason = reason; }
    opsWrite_(sh, o, o._row);
    audit_(me.id, ok ? '일보확인' : '일보반려', o.docNo);
    return { ok: true, item: opsPublic_(o) };
  } finally {
    lock.releaseLock();
  }
}

/** 작성중·반려 상태의 본인 작업일보만 지운다. 번호가 이미 나간 건은 기록을 남기고 삭제 표시만 한다. */
function deleteOps_(req) {
  const g = expAuth_(req); if (g.err) return g.err;
  const me = g.s;
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = ensureOpsSheet_(getDb_());
    const o = opsFind_(sh, String(req.id || ''));
    if (!o) return fail_('NOT_FOUND', '없는 작업일보입니다.');
    if (o.authorId !== me.id) return fail_('FORBIDDEN', '본인이 쓴 작업일보만 지울 수 있습니다.');
    if (o.status !== OST.DRAFT && o.status !== OST.REJECT) return fail_('STATE', '제출된 작업일보는 지울 수 없습니다.');
    o.status = OST.DEL;
    opsWrite_(sh, o, o._row);
    audit_(me.id, '일보삭제', o.docNo || o.id);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/** 본사 제출·확인 표시. 제출: 현장소장·공무, 확인: 현장소장, 취소: 현장소장(사유 필수). 마감된 달만. */
function hqMonth_(req) {
  const g = expAuth_(req); if (g.err) return g.err;
  const me = g.s;
  const ym = String(req.ym || ''), step = String(req.step || ''), note = cleanText_(req.note, 200);
  if (HQ_STEPS.indexOf(step) < 0) return fail_('PARAM', '처리 단계를 알 수 없습니다.');
  if (step === '제출' && me.role !== MANAGER_ROLE && me.role !== '공무') return fail_('FORBIDDEN', '현장소장과 공무만 본사 제출을 표시할 수 있습니다.');
  if (step !== '제출' && me.role !== MANAGER_ROLE) return fail_('FORBIDDEN', '현장소장만 본사 확인·취소를 표시할 수 있습니다.');
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const ss = getDb_();
    if (!isClosed_(closedMonths_(), ym)) return fail_('STATE', ym + '은(는) 마감된 달이 아닙니다. 마감한 뒤에 본사 제출을 표시할 수 있습니다.');
    const cur = hqState_(ym).state;
    if (step === '제출' && cur) return fail_('STATE', ym + '은(는) 이미 본사 ' + cur + ' 상태입니다.');
    if (step === '확인' && cur !== '제출') return fail_('STATE', cur === '확인' ? '이미 본사 확인으로 표시되어 있습니다.' : '본사 제출을 먼저 표시해야 합니다.');
    if (step === '취소') {
      if (!cur) return fail_('STATE', '취소할 본사 제출 표시가 없습니다.');
      if (note.length < 2) return fail_('PARAM', '취소하는 사유를 적어 주세요.');
    }
    ensureHqSheet_(ss).appendRow([ym, step, me.name, nowStr_(), note]);
    audit_(me.id, '본사' + step, ym + (note ? ' / ' + note : ''));
    return { ok: true, closed: closedMonths_(true) };
  } finally {
    lock.releaseLock();
  }
}

/** 월 마감(현장소장만). 마감하면 그 달 청구분은 승인·검토 처리가 막히고, 늦게 나온 영수증은 누락분으로 다음 달에 올린다. */
function closeMonth_(req) {
  const g = expAuth_(req); if (g.err) return g.err;
  const me = g.s;
  if (me.role !== MANAGER_ROLE) return fail_('FORBIDDEN', '현장소장만 월 마감을 할 수 있습니다.');
  const ym = String(req.ym || '');
  if (!/^\d{4}-\d{2}$/.test(ym) || ym < '2026-01' || ym > nowStr_().slice(0, 7) || Number(ym.slice(5)) < 1 || Number(ym.slice(5)) > 12) return fail_('PARAM', '마감할 달을 올바르게 선택해 주세요. (아직 오지 않은 달은 마감할 수 없습니다.)');
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const ss = getDb_();
    if (isClosed_(closedMonths_(), ym)) return fail_('STATE', ym + '은(는) 이미 마감되었습니다.');
    const rows = expRows_(ensureExpSheet_(ss)).filter(function (o) { return o.status !== ST.DEL && expClaimMonth_(o) === ym; });
    const done = rows.filter(function (o) { return o.status === ST.DONE; });
    const total = done.reduce(function (a, o) { return a + (Number(o.total) || 0); }, 0);
    const at = nowStr_();
    ensureCloseSheet_(ss).appendRow([ym, '마감', me.name, at, String(done.length), String(total), '']);
    audit_(me.id, '월마감', ym + ' / 승인 ' + done.length + '건 ' + total + '원 / 미승인 ' + (rows.length - done.length) + '건');
    return { ok: true, closed: closedMonths_(true), count: done.length, total: total, pending: rows.length - done.length };
  } finally {
    lock.releaseLock();
  }
}

function reopenMonth_(req) {
  const g = expAuth_(req); if (g.err) return g.err;
  const me = g.s;
  if (me.role !== MANAGER_ROLE) return fail_('FORBIDDEN', '현장소장만 마감을 해제할 수 있습니다.');
  const ym = String(req.ym || '');
  const reason = cleanText_(req.reason, 200);
  if (reason.length < 2) return fail_('PARAM', '마감을 해제하는 사유를 적어 주세요.');
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const ss = getDb_();
    if (!isClosed_(closedMonths_(), ym)) return fail_('STATE', ym + '은(는) 마감된 달이 아닙니다.');
    ensureCloseSheet_(ss).appendRow([ym, '해제', me.name, nowStr_(), '', '', reason]);
    if (hqState_(ym).state) ensureHqSheet_(ss).appendRow([ym, '취소', me.name, nowStr_(), '마감 해제로 초기화']);
    audit_(me.id, '마감해제', ym + ' / ' + reason);
    return { ok: true, closed: closedMonths_(true) };
  } finally {
    lock.releaseLock();
  }
}

function getReceipt_(req) {
  const g = expAuth_(req); if (g.err) return g.err;
  const sh = ensureExpSheet_(getDb_());
  const o = expFind_(sh, String(req.id || ''));
  if (!o) return fail_('NOT_FOUND', '없는 경비입니다.');
  const list = expReceiptsOf_(o);
  const r = list[Number(req.index)];
  if (!r) return fail_('NOT_FOUND', '없는 영수증입니다.');
  let blob;
  try { blob = DriveApp.getFileById(r.fid).getBlob(); } catch (e) { return fail_('NOT_FOUND', '영수증 파일을 찾을 수 없습니다.'); }
  return { ok: true, name: r.name, mime: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
}
