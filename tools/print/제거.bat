@echo off
chcp 65001 >nul
schtasks /Delete /F /TN "HN28_PrintBundle"
echo 자동 실행을 껐습니다. (%LOCALAPPDATA%\HN28print 폴더는 직접 지워도 됩니다)
pause
