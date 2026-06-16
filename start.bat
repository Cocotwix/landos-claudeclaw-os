@echo off
REM LandOS dashboard launcher.
REM
REM IMPORTANT: do NOT redirect output to logs\main.log. The app's own pino
REM logger owns logs\main.log; a second writer (this OS redirect) collides and
REM crashes the process with EBUSY. Launcher output goes to separate
REM logs\start-out.log / logs\start-err.log instead.

cd /d "%~dp0"
if not exist logs mkdir logs

REM Port-in-use guard: don't start a second listener if 3141 is already up.
netstat -ano | findstr "LISTENING" | findstr /C:"127.0.0.1:3141 " >nul 2>&1
if not errorlevel 1 (
  echo LandOS dashboard already listening on port 3141; not starting a second instance.
  exit /b 0
)

"C:\Program Files\nodejs\node.exe" dist\index.js > logs\start-out.log 2> logs\start-err.log
