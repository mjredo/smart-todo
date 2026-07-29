@echo off
REM ===========================================================================
REM  Smart To Do - launcher
REM  Serves this folder on http://localhost:8400 and opens the dashboard.
REM  (A local web server is required because Microsoft sign-in won't work from
REM   a plain file:// page.)
REM ===========================================================================
cd /d "%~dp0"

set PORT=8400
set URL=http://localhost:%PORT%/index.html

REM Pick whichever Python launcher exists on this machine.
where py >nul 2>nul && set PY=py
if not defined PY ( where python >nul 2>nul && set PY=python )

if not defined PY (
  echo Python was not found on this PC.
  echo Install it from https://www.python.org/downloads/  ^(check "Add to PATH"^),
  echo then double-click launch.bat again.
  pause
  exit /b 1
)

echo Starting Smart To Do on %URL%
echo Leave this window open while you use the dashboard. Close it to stop.
start "" "%URL%"
%PY% -m http.server %PORT%
