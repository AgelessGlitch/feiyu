@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ============================================
echo   蓝色大肥鱼 · 一键关闭
echo ============================================
echo.

echo [1/4] 关闭 QQ 桥接
powershell -NoProfile -ExecutionPolicy Bypass -File "tools\procs.ps1" "bridge.mjs" -Stop >nul 2>&1
echo [2/4] 关闭 B站小管家
powershell -NoProfile -ExecutionPolicy Bypass -File "tools\procs.ps1" "serve.mjs" -Stop >nul 2>&1
echo [3/4] 关闭面板
powershell -NoProfile -ExecutionPolicy Bypass -File "tools\procs.ps1" "panel.mjs" -Stop >nul 2>&1
echo [4/4] 关闭微信同步
powershell -NoProfile -ExecutionPolicy Bypass -File "tools\procs.ps1" "sync.mjs" -Stop >nul 2>&1

echo.
echo 已停止（NapCat / QQ 没动；要连 QQ 一起关，用 qq-bridge\napcat\KillQQ.bat）
timeout /t 4 >nul
exit /b 0
