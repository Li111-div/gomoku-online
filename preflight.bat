@echo off
chcp 65001 >nul
title 五子棋 - 提交前检查
cd /d "%~dp0"

set "PY="
where python >nul 2>nul && set "PY=python"
if not defined PY where py >nul 2>nul && set "PY=py"

if not defined PY (
  echo.
  echo   [错误] 没有找到 Python，无法运行提交前检查。
  echo   下载地址： https://www.python.org/downloads/
  echo.
  pause
  exit /b 1
)

%PY% tools\preflight.py %*
set "CODE=%errorlevel%"

echo.
if not "%CODE%"=="0" (
  echo   存在必须修复的问题，请处理后重新运行。
) else (
  echo   可以进入人工审查环节。
)
echo.
pause
exit /b %CODE%
