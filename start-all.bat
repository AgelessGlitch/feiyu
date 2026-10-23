@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   Feiyu Bilibili - start serve + panel
echo   panel: http://127.0.0.1:8899
echo ============================================
echo.

start "feiyu-bili-serve" cmd /k "node bili\serve.mjs"
start "feiyu-bili-panel" cmd /k "node bili\panel.mjs"
start "feiyu-weixin-sync" cmd /k "node weixin-memory\sync.mjs --watch"

timeout /t 2 >nul
start "" http://127.0.0.1:8899
exit
