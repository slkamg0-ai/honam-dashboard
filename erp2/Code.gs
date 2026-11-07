/**
 * HN28 현장 ERP v2 — 1단계: 로그인·직원 관리 서버 (Apps Script)
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
  const rows = readUsers_(sh);
  const made = [];
  INITIAL_STAFF.forEach(function (s) {
    if (rows.some(function (r) { return r[COL.id] === s.id; })) return;
    const temp = makeTempPin_();
    appendUser_(sh, s.id, s.name, s.role, temp);
    made.push(s.id + ' (' + s.role + ') 임시 PIN: ' + temp);
  });
  Logger.log('DB: ' + ss.getUrl());
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

function ping_() { return { ok: true, now: new Date().toISOString(), tz: Session.getScriptTimeZone(), version: 'v2.1' }; }

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
