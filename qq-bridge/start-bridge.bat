@echo off
setlocal DisableDelayedExpansion
cd /d "%~dp0"
if not exist "logs" mkdir "logs"
where node >nul 2>&1
if errorlevel 1 (
  echo [x] 找不到 node.exe，请先装 Node.js  ^(https://nodejs.org^)
  pause
  exit /b 1
)
echo ============================================
echo   蓝色大肥鱼 · QQ 桥接
echo   这个窗口关掉，她在 QQ 里就不回话了。
echo ============================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "node bridge.mjs *>&1 | Tee-Object -FilePath 'logs\bridge-console.log'"
set "CODE=%ERRORLEVEL%"
echo.
echo 桥接已退出（code=%CODE%）。日志：logs\bridge-console.log
pause
