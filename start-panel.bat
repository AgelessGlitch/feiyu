@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Bilibili panel: http://127.0.0.1:8899
echo (keep this window open; close it to stop the panel)
start "" http://127.0.0.1:8899
node bili\panel.mjs
pause
