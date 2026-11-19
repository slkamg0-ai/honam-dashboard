# -*- coding: utf-8 -*-
"""HN28 출력본 변환기 (ERP v2.30)
ERP에서 「출력본 만들기」(또는 문서 확정)를 하면 공문 폴더\\_출력 에 준비물과 _출력요청.json 이 생긴다.
이 프로그램은 1분마다 실행되어(작업 스케줄러) 요청을 찾아
  ① 한글(hwp·hwpx) 파일을 PDF로 바꾸고  ② 순서대로 합쳐  ③ 공문 폴더에 「…_출력본.pdf」로 저장한다.
"""
import os, sys, json, time, shutil, tempfile, traceback, datetime

ROOTS = [r"G:\내 드라이브\Work\호남고속선\06_공사관리·감독협의\발신"]
HOME = os.path.join(os.environ.get("LOCALAPPDATA", tempfile.gettempdir()), "HN28print")
LOG = os.path.join(HOME, "log.txt")
LOCK = os.path.join(HOME, "run.lock")
REQ, ERR, SUB = "_출력요청.json", "_출력오류.txt", "_출력"
WAIT_SYNC_MIN = 20  # 준비물이 아직 내려받아지지 않았으면 이 시간(분)까지 다음 회차에 다시 본다


def log(msg):
    os.makedirs(HOME, exist_ok=True)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S ") + msg + "\n")
    try:  # 로그가 너무 커지면 뒷부분만 남긴다
        if os.path.getsize(LOG) > 2_000_000:
            with open(LOG, encoding="utf-8") as f: tail = f.readlines()[-3000:]
            with open(LOG, "w", encoding="utf-8") as f: f.writelines(tail)
    except Exception:
        pass


def take_lock():
    os.makedirs(HOME, exist_ok=True)
    try:
        if os.path.exists(LOCK) and time.time() - os.path.getmtime(LOCK) > 1800:
            os.remove(LOCK)  # 30분 넘은 잠금은 비정상 종료로 본다
        fd = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.write(fd, str(os.getpid()).encode()); os.close(fd)
        return True
    except FileExistsError:
        return False


class Hangul:
    """한글 프로그램을 한 번만 띄워 여러 파일을 변환한다."""
    def __init__(self):
        self.h = None; self.com = None

    def open(self):
        if self.com: return
        try:
            from pyhwpx import Hwp  # 보안 승인 모듈 등록을 대신 해 준다
            try: self.h = Hwp(new=True, visible=False)
            except TypeError: self.h = Hwp(visible=False)
            self.com = getattr(self.h, "hwp", None) or self.h
        except ImportError:
            import win32com.client as w
            self.com = w.gencache.EnsureDispatch("HWPFrame.HwpObject")
            try: self.com.RegisterModule("FilePathCheckDLL", "FilePathCheckerModule")
            except Exception: pass
            try: self.com.XHwpWindows.Item(0).Visible = False
            except Exception: pass

    def to_pdf(self, src, dst):
        self.open()
        if os.path.exists(dst): os.remove(dst)
        ok = self.com.Open(src, "", "forceopen:true;suspendpassword:true;versionwarning:false")
        if not ok: raise RuntimeError("한글에서 파일을 열지 못했습니다: " + os.path.basename(src))
        self.com.SaveAs(dst, "PDF", "")
        try: self.com.Clear(1)
        except Exception: pass
        for _ in range(40):  # 저장이 끝날 때까지 잠깐 기다린다
            if os.path.exists(dst) and os.path.getsize(dst) > 0: return
            time.sleep(0.5)
        raise RuntimeError("PDF로 저장하지 못했습니다: " + os.path.basename(src))

    def close(self):
        try:
            if self.h is not None and hasattr(self.h, "quit"): self.h.quit()
            elif self.com is not None: self.com.Quit()
        except Exception:
            pass


def find_requests():
    for root in ROOTS:
        if not os.path.isdir(root): continue
        for d, dirs, files in os.walk(root):
            dirs[:] = [x for x in dirs if x != "_구버전"]
            if os.path.basename(d) == SUB and REQ in files:
                yield os.path.dirname(d)


def handle(folder, hw):
    sub = os.path.join(folder, SUB)
    rq_path = os.path.join(sub, REQ)
    with open(rq_path, encoding="utf-8") as f:
        rq = json.load(f)
    age_min = (time.time() - os.path.getmtime(rq_path)) / 60
    srcs = [os.path.join(folder, *p["path"].split("/")) for p in rq["parts"]]
    missing = [s for s in srcs if not os.path.exists(s)]
    if missing:
        if age_min < WAIT_SYNC_MIN:
            log("대기(동기화 전) " + rq.get("docNo", "") + " " + str(len(missing)) + "건"); return
        raise RuntimeError("준비 파일이 PC에 내려오지 않았습니다: " + ", ".join(os.path.basename(m) for m in missing[:3]))
    tmp = tempfile.mkdtemp(prefix="hn28_")
    try:
        pdfs = []
        for p, s in zip(rq["parts"], srcs):
            local = os.path.join(tmp, "%02d%s" % (len(pdfs), os.path.splitext(s)[1].lower()))
            shutil.copyfile(s, local)  # 드라이브 경로에서 직접 열지 않고 내 PC 임시 폴더에서 처리
            if p.get("conv") == "hwp":
                out = os.path.splitext(local)[0] + ".pdf"
                hw.to_pdf(local, out); local = out
            pdfs.append(local)
        from pypdf import PdfWriter
        w = PdfWriter()
        for x in pdfs: w.append(x)
        merged = os.path.join(tmp, "merged.pdf")
        with open(merged, "wb") as f: w.write(f)
        dst = os.path.join(folder, rq["out"])
        if os.path.exists(dst): os.remove(dst)  # 지난 출력본(변환기가 만든 파일)
        shutil.copyfile(merged, dst)
        os.remove(rq_path)
        e = os.path.join(sub, ERR)
        if os.path.exists(e): os.remove(e)
        log("완료 " + rq.get("docNo", "") + " → " + rq["out"] + " (%d개 묶음)" % len(pdfs))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    if not take_lock(): return
    hw = Hangul()
    try:
        for folder in list(find_requests()):
            try:
                handle(folder, hw)
            except Exception as ex:
                msg = str(ex) or ex.__class__.__name__
                log("오류 " + folder + " : " + msg + "\n" + traceback.format_exc())
                try:
                    with open(os.path.join(folder, SUB, ERR), "w", encoding="utf-8") as f: f.write(msg)
                    os.remove(os.path.join(folder, SUB, REQ))  # 같은 오류를 1분마다 되풀이하지 않는다
                except Exception:
                    pass
    finally:
        hw.close()
        try: os.remove(LOCK)
        except Exception: pass


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--test":
        print("요청 폴더:", list(find_requests()) or "없음"); print("로그:", LOG)
    else:
        main()
