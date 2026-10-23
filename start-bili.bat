@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Feiyu Bilibili auto-runner (serve)
echo (keep this window open; it picks a random time each day)
node bili\serve.mjs
pause
