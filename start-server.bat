@echo off
chcp 65001 >nul
title 五子棋 - 服务端
cd /d "%~dp0"

set "PY="
where python >nul 2>nul && set "PY=python"
if not defined PY where py >nul 2>nul && set "PY=py"

if not defined PY (
  echo.
  echo   [错误] 没有找到 Python
  echo.
  echo   服务端需要 Python 3.7 或更高版本。
  echo   下载地址： https://www.python.org/downloads/
  echo   安装时请务必勾选 "Add Python to PATH"，装完重新双击本文件即可。
  echo.
  pause
  exit /b 1
)

echo.
echo   正在启动服务端，稍后会自动打开浏览器...
%PY% server\server.py --open %*

echo.
pause
