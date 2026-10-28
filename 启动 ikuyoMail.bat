@echo off
rem ikuyoMail launcher
rem - 有 ikuyoMail.exe 就用它（原生窗口，自带服务进程管理）
rem - 没有 exe 时退回旧的 Chrome 应用窗口方案（assets\shell.ps1）
rem
rem Want it in your normal browser instead? just open http://127.0.0.1:7317/

cd /d "%~dp0"

if not exist "src\server.js" (
  echo [ikuyoMail] src\server.js not found. Put this file in the ikuyoMail folder.
  pause
  exit /b 1
)

if exist "ikuyoMail.exe" (
  start "" "ikuyoMail.exe"
  exit /b 0
)

start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "assets\shell.ps1"
exit /b 0
