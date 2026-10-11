@echo off
chcp 65001 >nul
title 五子棋 - 开源前配置
cd /d "%~dp0"

set "PY="
where python >nul 2>nul && set "PY=python"
if not defined PY where py >nul 2>nul && set "PY=py"

if not defined PY (
  echo.
  echo   [错误] 没有找到 Python
  echo.
  echo   下载地址： https://www.python.org/downloads/
  echo   安装时请务必勾选 "Add Python to PATH"，装完重新双击本文件。
  echo.
  pause
  exit /b 1
)

rem 交互提示全部交给 Python 处理，避开批处理 set /p 的转义坑
%PY% tools\setup_repo.py %*

echo.
pause
