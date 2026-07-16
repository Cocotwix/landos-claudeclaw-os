@echo off
cd /d "%~dp0"
REM Compatibility wrapper. The repository runtime owns all Windows process,
REM metadata, log, duplicate-prevention, and health behavior.
"C:\Program Files\nodejs\node.exe" "%~dp0scripts\runtime\landos-runtime.mjs" start
exit /b %errorlevel%
