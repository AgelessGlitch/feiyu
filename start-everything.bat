@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "DRY="
if /I "%~1"=="--dry" set "DRY=1"

echo ============================================
echo   蓝色大肥鱼 · 一键启动
echo   NapCat + QQ桥接 + B站小管家 + 面板 + 微信同步
echo ============================================
echo.

rem ---------- 1. NapCat ----------
call :port_listening 3001
if "%PORT_OK%"=="1" (
  echo [1/5] NapCat 已在运行（3001 在监听）
) else (
  echo [1/5] 启动 NapCat（会弹 UAC，请点“是”；会先关掉现有 QQ）
  if defined DRY (
    echo        ^> qq-bridge\napcat\start-napcat-admin.bat
  ) else (
    start "feiyu-napcat" cmd /c "qq-bridge\napcat\start-napcat-admin.bat"
    echo        等 12 秒让它把 QQ 拉起来...
    timeout /t 12 >nul
  )
)

rem ---------- 2. QQ bridge ----------
call :node_running bridge.mjs
if not errorlevel 1 (
  echo [2/5] QQ 桥接已在运行
) else (
  echo [2/5] 启动 QQ 桥接
  if defined DRY (
    echo        ^> start feiyu-qq cmd /k qq-bridge\start-bridge.bat
  ) else (
    start "feiyu-qq" cmd /k "qq-bridge\start-bridge.bat"
  )
)

rem ---------- 3. B站小管家 ----------
call :node_running serve.mjs
if not errorlevel 1 (
  echo [3/5] B站小管家已在运行
) else (
  echo [3/5] 启动 B站小管家
  if defined DRY (
    echo        ^> start feiyu-bili cmd /k node bili\serve.mjs
  ) else (
    start "feiyu-bili" cmd /k "node bili\serve.mjs"
  )
)

rem ---------- 4. 面板 ----------
call :port_listening 8899
if "%PORT_OK%"=="1" (
  echo [4/5] 面板已在运行（8899 在监听）
) else (
  call :node_running panel.mjs
  if not errorlevel 1 (
    echo [4/5] 面板已在运行
  ) else (
    echo [4/5] 启动面板
    if defined DRY (
      echo        ^> start feiyu-panel cmd /k node bili\panel.mjs
    ) else (
      start "feiyu-panel" cmd /k "node bili\panel.mjs"
    )
  )
)

rem ---------- 5. 微信记忆同步 ----------
call :node_running sync.mjs
if not errorlevel 1 (
  echo [5/5] 微信同步已在运行
) else (
  echo [5/5] 启动微信记忆同步
  if defined DRY (
    echo        ^> start feiyu-weixin cmd /k node weixin-memory\sync.mjs --watch
  ) else (
    start "feiyu-weixin" cmd /k "node weixin-memory\sync.mjs --watch"
  )
)

if not defined DRY (
  timeout /t 3 >nul
  start "" http://127.0.0.1:8899
)

echo.
echo 全部启动完成。面板: http://127.0.0.1:8899
echo 关掉对应的窗口 = 停掉那个服务；一键关闭用 stop-everything.bat
if not defined DRY timeout /t 5 >nul
exit /b 0

rem ---------- helpers ----------
:port_listening
set "PORT_OK=0"
netstat -ano | findstr /R /C:":%~1 .*LISTENING" >nul 2>&1
if not errorlevel 1 set "PORT_OK=1"
exit /b

:node_running
powershell -NoProfile -ExecutionPolicy Bypass -File "tools\procs.ps1" "%~1" >nul 2>&1
exit /b %errorlevel%
