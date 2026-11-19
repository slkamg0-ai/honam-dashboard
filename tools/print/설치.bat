@echo off
chcp 65001 >nul
setlocal
set "DST=%LOCALAPPDATA%\HN28print"
echo.
echo  HN28 출력본 변환기 설치 (ERP 「출력본 만들기」용)
echo  ------------------------------------------------
echo [1/4] Python 확인
where py >nul 2>nul
if errorlevel 1 (
  echo   Python이 없습니다. https://www.python.org/downloads/ 에서 설치하고
  echo   이 파일을 다시 실행해 주세요.
  pause
  exit /b 1
)
echo [2/4] 필요한 부품 설치 (pyhwpx, pypdf) - 1~2분 걸립니다
py -3 -m pip install --upgrade --quiet pyhwpx pypdf pywin32
if errorlevel 1 (
  echo   부품 설치에 실패했습니다. 인터넷 연결을 확인하고 다시 실행해 주세요.
  pause
  exit /b 1
)
echo [3/4] 변환기 복사
if not exist "%DST%" mkdir "%DST%"
copy /Y "%~dp0hn28_print.py" "%DST%\hn28_print.py" >nul
for /f "delims=" %%P in ('py -3 -c "import sys,os;print(os.path.join(os.path.dirname(sys.executable),'pythonw.exe'))"') do set "PYW=%%P"
echo [4/4] 1분마다 자동 실행 등록 (로그인해 있는 동안, 창 없이)
schtasks /Create /F /SC MINUTE /MO 1 /TN "HN28_PrintBundle" /TR "\"%PYW%\" \"%DST%\hn28_print.py\"" >nul
if errorlevel 1 (
  echo   자동 실행 등록에 실패했습니다.
  pause
  exit /b 1
)
py -3 "%DST%\hn28_print.py" --test
echo.
echo  설치 완료. 이제 ERP에서 「출력본 만들기」를 누르면 1~3분 뒤 출력본이 생깁니다.
echo  처음 한 번은 한글 보안 승인 창이 뜰 수 있습니다 - 「모두 허용」을 눌러 주세요.
echo  지우려면 같은 폴더의 「제거.bat」을 실행하세요.
pause
